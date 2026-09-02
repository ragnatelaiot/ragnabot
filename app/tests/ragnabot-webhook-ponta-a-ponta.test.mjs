#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A CORRENTE INTEIRA, DE PONTA A PONTA — contrato S-PORTARIA (02/09/2026).
//
//   Chatwoot → HTTP → webhook → portaria → fila → motor → adaptador de canal → cliente
//
// POR QUE ESTE ARQUIVO EXISTE. Cada elo já tinha o seu teste, e todos passavam. A CORRENTE não
// tinha nenhum — e era exatamente ali que ela estava partida: `atenderMensagemRecebida()` não era
// chamada por ninguém (medido: zero referências fora do próprio serviço e do seu teste). Testes
// de elo verdes com a corrente partida é o modo mais caro de se enganar, porque o painel fica
// todo verde enquanto o cliente fala sozinho.
//
// O QUE É REAL AQUI, E O QUE É DUBLÊ — a distinção é o valor do teste:
//   REAL: o servidor HTTP (Express de verdade, porta de verdade, `fetch` de verdade), a rota do
//         webhook, o classificador, a portaria, o resolvedor de entrada, o motor de fluxo e a
//         máquina de estado. Nada disso é simulado.
//   DUBLÊ: o Prisma (em memória, com os índices únicos declarados — recusa o que o banco
//         recusaria), a fila (as mesmas 5 operações que `rodadaDoExecutor` chama) e o CANAL, que
//         em vez de falar com o Chatwoot GUARDA a intenção numa lista.
//
// ⚠️ NADA SAI PARA FORA. O canal é o último elo e é o único ponto onde uma chamada de rede
// aconteceria; ele é dublê justamente para que este teste possa rodar em qualquer máquina, sem
// plataforma no ar e sem risco de escrever numa conta de cliente.
//
// COMO RODAR:  node tests/ragnabot-webhook-ponta-a-ponta.test.mjs
// (o vitest só varre `.test.js`; este é `.test.mjs` de propósito, como os irmãos)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import express from 'express';

// ⚠️ O SEGREDO ANTES DO IMPORT. A rota lê `process.env.RAGNABOT_WEBHOOK_SEGREDO` a cada pedido,
// mas deixar isto depois do import é uma armadilha que já mordeu esta casa em outro serviço.
process.env.RAGNABOT_WEBHOOK_SEGREDO = 'segredo-de-teste-nao-vale-nada';

import { criarFake } from './fixtures/fake-prisma-motor.mjs';
import * as motor from '../src/services/ragnabot-fluxo-motor.service.js';
import * as atendimento from '../src/services/ragnabot-atendimento.service.js';
import * as portaria from '../src/services/ragnabot-portaria.service.js';
import webhookRouter, {
  configurarWebhook, portasDoWebhook, classificarEvento, estatisticasDoWebhook,
  zerarEstatisticasDoWebhook, carimboDeOrigem,
} from '../src/routes/ragnabot-webhook.routes.js';

const TENANT   = { id: 'tenant-1', slug: 'ragnatela', cwAccountId: 7 };
const CONTA    = 7;
const CONVERSA = 4242;   // no corpo do Chatwoot isto é `conversation.id`, que É o display_id
const CAIXA    = 3;
const AGORA    = new Date('2026-09-02T14:00:00.000Z'); // quarta-feira, 11h em Fortaleza

let db; let fila; let enviados; let politicasNoBanco; let servidor; let base;
const avisos = [];
const logMudo = {
  info: () => {}, debug: () => {},
  warn: (m) => avisos.push(String(m)),
  error: (m) => avisos.push(String(m)),
};

const ORIGINAIS = {
  atendimento: atendimento.portasDoAtendimento(),
  portaria: portaria.portasDaPortaria(),
  motor: motor.portasDoMotor(),
  webhook: portasDoWebhook(),
};

// ── catálogo mínimo de nós, no contrato declarado pelo motor ────────────────────────────────────
const NOS = {
  inicio: {
    tipo: 'inicio', efeito: 'nenhum', politicaEmDuvida: 'seguir', estaciona: false,
    saidas: () => ['padrao'], validar: () => [], preparar: () => [],
    executar: async () => ({ tipo: 'seguir', saida: 'padrao' }),
  },
  texto: {
    tipo: 'texto', efeito: 'irrepetivel', politicaEmDuvida: 'conciliar', estaciona: false,
    saidas: () => ['padrao', 'erro', 'sem_janela'], validar: () => [],
    preparar: (no) => ({ tipo: 'texto', corpo: no.config.corpo, sufixo: '' }),
    executar: async () => ({ tipo: 'seguir', saida: 'padrao' }),
  },
  pergunta: {
    tipo: 'pergunta', efeito: 'irrepetivel', politicaEmDuvida: 'conciliar', estaciona: true,
    saidas: () => ['padrao', 'sem_resposta', 'opcao_invalida', 'erro'], validar: () => [],
    preparar: (no) => ({ tipo: 'texto', corpo: no.config.corpo, sufixo: '' }),
    executar: async (ctx) => ({
      tipo: 'aguardar', motivo: 'resposta',
      acordarEm: new Date(new Date(ctx.agora).getTime() + 4 * 60 * 1000), saidaAoVencer: 'sem_resposta',
    }),
    receber: async (ctx, entrada) => ({
      saida: 'padrao', varsPatch: { [ctx.no.config.variavel]: entrada.texto }, viaCasamento: 'titulo',
    }),
  },
  encerrar: {
    tipo: 'encerrar', efeito: 'nenhum', politicaEmDuvida: 'seguir', estaciona: false,
    saidas: () => [], validar: () => [], preparar: () => [],
    executar: async () => ({ tipo: 'terminar', estado: 'concluido' }),
  },
};

const DOCUMENTO = {
  nos: [
    { id: 'n1', tipo: 'inicio', config: {} },
    { id: 'n2', tipo: 'texto', config: { corpo: 'Olá! Sou o Ragnabot.' } },
    { id: 'n3', tipo: 'pergunta', config: { corpo: 'Como posso ajudar?', variavel: 'detalhes' } },
    { id: 'n4', tipo: 'encerrar', config: {} },
  ],
  arestas: [
    { de: 'n1', saida: 'padrao', para: 'n2' },
    { de: 'n2', saida: 'padrao', para: 'n3' },
    { de: 'n3', saida: 'padrao', para: 'n4' },
  ],
};

/** As tabelas que o dublê do motor não conhece (é fixture de outro dono). Mínimo de propósito:
 *  política ausente é o estado REAL do ambiente hoje — nenhuma caixa de WhatsApp criada. */
function comTabelasDeFora(cliente, { falharAoGravarEntrada = false } = {}) {
  const criarEntrada = cliente.ragnabotFluxoEntrada.create;
  cliente.ragnabotFluxoEntrada.create = async (args) => {
    if (falharAoGravarEntrada) throw new Error('banco fora (simulado no dublê)');
    const jaTem = await cliente.ragnabotFluxoEntrada.findUnique({ where: { chave: args?.data?.chave } });
    if (jaTem) { const e = new Error('Unique constraint failed on the fields: (`chave`)'); e.code = 'P2002'; throw e; }
    return criarEntrada(args);
  };

  const casa = (r, w = {}) => Object.entries(w).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(r[k]);
    return r[k] === cond;
  });
  cliente.ragnabotAtendPolitica   = { findMany: async ({ where } = {}) => politicasNoBanco.filter((p) => casa(p, where)) };
  cliente.ragnabotAtendExpediente = { findMany: async () => [] };
  cliente.ragnabotAtendExcecaoData = { findMany: async () => [] };
  cliente.ragnabotAtendRelogio    = { findMany: async () => [], deleteMany: async () => ({ count: 0 }) };
  // A ponte empresa↔plataforma que a rota consulta.
  cliente.ragnabotTenant = {
    findUnique: async ({ where }) => (where?.cwAccountId === TENANT.cwAccountId ? { ...TENANT } : null),
  };
  cliente.ragnabotProtocolo = { findUnique: async () => null };
  return cliente;
}

async function montar({ falharAoGravarEntrada = false } = {}) {
  db = comTabelasDeFora(criarFake(), { falharAoGravarEntrada });
  enviados = [];
  politicasNoBanco = [];
  avisos.length = 0;
  zerarEstatisticasDoWebhook();

  const jobs = [];
  let seq = 1;
  fila = {
    itens: jobs,
    enfileirar: async (job) => {
      // O dublê emula o `ON CONFLICT ("chaveIdem") WHERE status='pendente'` do serviço real —
      // sem isso, «webhook repetido não duplica» mediria a minha opinião, não a regra.
      const idem = (job.tipo === 'entrada' || job.tipo === 'iniciar') && job.entradaId
        ? `${job.tipo}:${job.entradaId}` : null;
      if (idem) {
        const ja = jobs.find((j) => j.chaveIdem === idem && j.status === 'pendente');
        if (ja) return { ...ja, novo: false };
      }
      const j = { id: seq++, status: 'pendente', chaveIdem: idem, tentativas: 0, ...job };
      jobs.push(j);
      return { ...j, novo: true };
    },
    candidatos: async () => jobs.filter((j) => j.status === 'pendente'),
    drenarParticao: async (chave, worker) => {
      const meus = jobs.filter((j) => j.status === 'pendente' && j.chaveParticao === chave);
      meus.forEach((j) => { j.status = 'processando'; j.donoWorker = worker; });
      return meus;
    },
    concluirJob: async (id, { status }) => { const j = jobs.find((x) => x.id === id); if (j) j.status = status; },
    adiarJob: async (id) => { const j = jobs.find((x) => x.id === id); if (j) j.status = 'pendente'; },
    devolverJobsDoWorker: async () => 0,
  };

  motor.limparCacheDeVersao();
  motor.configurarMotor({
    db,
    fila,
    canal: {
      // O ÚLTIMO ELO. Em produção fala com o Chatwoot; aqui guarda a intenção. É o ponto exato em
      // que este teste prova «a intenção chegou ao adaptador» sem mandar nada para fora.
      portaDa: async () => ({
        enviar: async (intencao) => { enviados.push(intencao); return { idExterno: `cw-${enviados.length}` }; },
        lerConversa: async () => ({ status: 'open', assigneeId: null, labels: [] }),
        carimbar: async () => {},
      }),
    },
    nos: { obter: (t) => NOS[t] ?? null },
    cofre: { resolver: async () => 'segredo-de-teste' },
    relogio: { agora: () => AGORA },
    protocolo: { emitirProtocolo: async () => ({ protocolo: 'RGT-0000000042', numero: 42, novo: true }) },
  });

  atendimento.configurar({ db, relogio: { agora: () => AGORA } });

  portaria.configurarPortaria({
    db, fila, relogio: { agora: () => AGORA }, log: logMudo,
    atendimento: {
      resolverEntrada: atendimento.resolverEntrada,
      cancelarRelogios: atendimento.cancelarRelogios,
    },
    motor: { iniciarOuRecuperarExecucao: motor.iniciarOuRecuperarExecucao },
  });

  configurarWebhook({
    db, log: logMudo, portaria,
    protocolo: { emitirProtocolo: async () => ({ protocolo: 'RGT-0000000042', novo: true }) },
    auditoria: { registrar: async () => ({}) },
  });

  // ── O SERVIDOR DE VERDADE ────────────────────────────────────────────────────────────────────
  if (!servidor) {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/ragnabot-webhook', webhookRouter);
    await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
    base = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-webhook`;
  }
}

async function semearFluxoPublicado() {
  await db.ragnabotFluxo.create({
    data: {
      id: 'fluxo-1', tenantId: TENANT.id, nome: 'ATENDIMENTO', estado: 'publicado',
      entrada: 'caixa', cwInboxId: CAIXA, versaoPublicadaId: 'versao-1',
      passosPorEvento: 50, passosTotalMax: 500, visitasPorNoMax: 10,
      ttlExecucaoSegundos: 82800, retomada: 'reiniciar',
      politicaContinuacao: { janelaSegundos: 20, ambiguidadeMs: 2000 },
    },
  });
  await db.ragnabotFluxoVersao.create({
    data: {
      id: 'versao-1', fluxoId: 'fluxo-1', tenantId: TENANT.id, numero: 1, documento: DOCUMENTO,
      hashDocumento: 'h1', hashEstrutura: 'e1', noInicialId: 'n1', perfilLimite: 'whatsapp_cloud@2026-08',
    },
  });
}

// ── O CORPO REAL DO CHATWOOT ───────────────────────────────────────────────────────────────────
// Formato do `message.webhook_data` do Chatwoot 4.x com `event` no topo. Mantido COMPLETO (com os
// campos que não usamos) de propósito: corpo enxuto testaria o meu resumo do Chatwoot, não o
// Chatwoot. E é num campo «que não usamos» que mora a próxima armadilha.
function mensagemDoCliente(over = {}) {
  return {
    event: 'message_created',
    id: 9001,
    content: 'oi',
    created_at: '2026-09-02T13:59:58.800Z',
    message_type: 'incoming',
    content_type: 'text',
    content_attributes: {},
    source_id: 'wamid.EXEMPLO0000000000000000000000000000',
    private: false,
    sender: {
      id: 88, name: 'Maria', type: 'contact',
      phone_number: '+5598900000000', identifier: null, thumbnail: '',
    },
    account: { id: CONTA, name: 'Ragnatela' },
    inbox: { id: CAIXA, name: 'WhatsApp Ragnatela' },
    conversation: {
      id: CONVERSA,               // ⚠️ isto é o display_id — é o que a API v1 usa em /conversations/:id
      account_id: CONTA,
      inbox_id: CAIXA,
      status: 'open',
      channel: 'Channel::Whatsapp',
      can_reply: true,
      unread_count: 1,
      additional_attributes: {},
      custom_attributes: {},
      meta: { sender: { id: 88, name: 'Maria', phone_number: '+5598900000000' }, assignee: null },
      messages: [],
    },
    ...over,
  };
}

async function postar(corpo, { token = process.env.RAGNABOT_WEBHOOK_SEGREDO } = {}) {
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-ragnabot-token': token } : {}) },
    body: JSON.stringify(corpo),
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('(A) PONTA A PONTA: o "oi" entra por HTTP e a intenção chega ao adaptador de canal', async () => {
  await montar(); await semearFluxoPublicado();

  const r = await postar(mensagemDoCliente());

  assert.equal(r.status, 200, 'evento aceito responde 2xx');
  assert.equal(r.json.classe, 'resposta_cliente');
  assert.equal(r.json.resultado, 'execucao_iniciada', 'o primeiro oi NASCE a execução');
  assert.ok(r.json.entradaId, 'a mensagem foi gravada antes do 2xx (§1.2/(2))');

  // 1. virou ENTRADA gravada
  const entradas = await db.ragnabotFluxoEntrada.findMany({});
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].chave, `cw:${CONTA}:message_created:m:9001`, 'chave estável pelo id da mensagem');
  assert.equal(entradas[0].cwConversationId, CONVERSA);
  assert.equal(entradas[0].corpo.texto, 'oi');
  assert.equal(entradas[0].wamid, 'wamid.EXEMPLO0000000000000000000000000000');

  // 2. virou TRABALHO NA FILA
  assert.equal(fila.itens.length, 1, 'um trabalho, não dois');
  assert.equal(fila.itens[0].tipo, 'iniciar');
  assert.equal(fila.itens[0].chaveParticao, `${CONTA}:${CONVERSA}`, 'serialização por conta:conversa');

  // 3. foi CONSUMIDO PELO MOTOR — pelo mesmo laço que o processo roda
  const resumo = await motor.rodadaDoExecutor({ workerId: 'w-teste' });
  assert.equal(resumo.jobs, 1);
  assert.equal(resumo.erros, 0);
  assert.equal(fila.itens[0].status, 'feito');

  // 4. a INTENÇÃO chegou ao adaptador de canal — e NADA saiu para fora
  assert.equal(enviados.length, 2, 'saiu a saudação e a pergunta');
  assert.equal(enviados[0].corpo, 'Olá! Sou o Ragnabot.');
  assert.equal(enviados[1].corpo, 'Como posso ajudar?');

  const exec = await db.ragnabotFluxoExecucao.findUnique({ where: { id: r.json.execucaoId } });
  assert.equal(exec.estado, 'esperando');
  assert.equal(exec.noAtualId, 'n3');

  return {
    http: r.status, resultado: r.json.resultado,
    fila: fila.itens.map((j) => `${j.tipo}/${j.status}`),
    canal: enviados.map((e) => e.corpo), estado: exec.estado,
  };
});

teste('(A2) e a RESPOSTA do cliente continua a mesma execução, também pelo HTTP', async () => {
  await montar(); await semearFluxoPublicado();
  await postar(mensagemDoCliente());
  await motor.rodadaDoExecutor({ workerId: 'w-teste' });

  const r = await postar(mensagemDoCliente({
    id: 9002, content: 'o servidor não liga',
    created_at: '2026-09-02T14:00:20.000Z', source_id: 'wamid.SEGUNDA',
  }));
  assert.equal(r.status, 200);
  assert.equal(r.json.resultado, 'execucao_continuada', 'não nasce execução nova');

  await motor.rodadaDoExecutor({ workerId: 'w-teste' });
  const exec = await db.ragnabotFluxoExecucao.findFirst({ where: { cwConversationId: CONVERSA } });
  assert.equal(exec.vars.detalhes, 'o servidor não liga', 'a resposta virou variável do fluxo');
  assert.equal(exec.estado, 'concluido');
  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(execs.length, 1, 'UMA execução, do começo ao fim');
  return { resultado: r.json.resultado, var: exec.vars.detalhes, estado: exec.estado };
});

teste('(B) ECO DO ATENDENTE não realimenta o motor — é a armadilha do robô falando sozinho', async () => {
  await montar(); await semearFluxoPublicado();
  await postar(mensagemDoCliente());
  await motor.rodadaDoExecutor({ workerId: 'w-teste' });
  const enviadosAntes = enviados.length;
  const jobsAntes = fila.itens.length;

  // (b1) a NOSSA própria mensagem voltando (o Chatwoot devolve tudo que sai)
  const eco = await postar(mensagemDoCliente({
    id: 9101, message_type: 'outgoing', content: 'Como posso ajudar?',
    content_attributes: { rgt_efeito: 'ef-abc123' },
    sender: { id: 2, name: 'Ragnabot', type: 'agent_bot' },
  }));
  // (b2) o ATENDENTE humano digitando
  const humano = await postar(mensagemDoCliente({
    id: 9102, message_type: 'outgoing', content: 'Oi Maria, aqui é o João',
    content_attributes: {}, sender: { id: 5, name: 'João', type: 'user' },
  }));

  assert.equal(eco.status, 200);
  assert.equal(eco.json.classe, 'eco_proprio', 'a NOSSA marca identifica a nossa mensagem');
  assert.equal(eco.json.resultado, 'registrada');
  assert.equal(humano.status, 200);
  assert.equal(humano.json.classe, 'controle');
  assert.equal(humano.json.motivo, 'saida_humana');
  assert.equal(humano.json.resultado, 'registrada');

  assert.equal(enviados.length, enviadosAntes, 'NENHUMA mensagem nova saiu — o laço não fechou');
  assert.equal(fila.itens.length, jobsAntes, 'e nenhum trabalho novo entrou na fila');
  const exec = await db.ragnabotFluxoExecucao.findFirst({ where: { cwConversationId: CONVERSA } });
  assert.equal(exec.estado, 'esperando', 'a execução continua onde estava');
  return { eco: eco.json.classe, humano: humano.json.motivo, saidas: enviados.length };
});

teste('(C) NOTA INTERNA é ignorada — mesmo vindo com message_type de entrada', async () => {
  await montar(); await semearFluxoPublicado();
  await postar(mensagemDoCliente());
  await motor.rodadaDoExecutor({ workerId: 'w-teste' });
  const antes = enviados.length;

  const r = await postar(mensagemDoCliente({
    id: 9201, private: true, content: 'atenção: cliente já ligou 3x hoje',
    sender: { id: 5, name: 'João', type: 'user' },
  }));
  assert.equal(r.status, 200);
  assert.equal(r.json.classe, 'controle');
  assert.equal(r.json.motivo, 'nota_interna');

  // ⚠️ A pegadinha: nota interna com `message_type:'incoming'` existe no Chatwoot (nota criada por
  // automação). `private` tem de vencer o `message_type`, senão a nota vira escolha de menu.
  const r2 = await postar(mensagemDoCliente({
    id: 9202, private: true, message_type: 'incoming', content: '2',
  }));
  assert.equal(r2.json.motivo, 'nota_interna', 'private vence message_type');
  assert.equal(enviados.length, antes, 'nada saiu');
  const exec = await db.ragnabotFluxoExecucao.findFirst({ where: { cwConversationId: CONVERSA } });
  assert.equal(exec.vars.detalhes, undefined, 'a nota NÃO virou resposta da pergunta');
  return { um: r.json.motivo, dois: r2.json.motivo };
});

teste('(D) WEBHOOK REPETIDO não duplica: uma entrada, um trabalho, uma saudação', async () => {
  await montar(); await semearFluxoPublicado();

  const corpo = mensagemDoCliente();
  const r1 = await postar(corpo);
  const r2 = await postar(corpo);                                  // reentrega idêntica
  const r3 = await postar({ ...corpo, created_at: '2026-09-02T14:00:03.000Z' }); // reentrega com carimbo novo

  assert.equal(r1.json.resultado, 'execucao_iniciada');
  assert.equal(r2.status, 200); assert.equal(r2.json.resultado, 'duplicada');
  assert.equal(r3.status, 200); assert.equal(r3.json.resultado, 'duplicada',
    'o id da mensagem manda; carimbo diferente não faz mensagem nova');

  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 1);
  assert.equal((await db.ragnabotFluxoExecucao.findMany({})).length, 1);
  assert.equal(fila.itens.length, 1, 'UM trabalho na fila, não três');

  await motor.rodadaDoExecutor({ workerId: 'w-teste' });
  assert.equal(enviados.length, 2, 'o cliente ouviu a saudação UMA vez');
  return { r1: r1.json.resultado, r2: r2.json.resultado, r3: r3.json.resultado, jobs: fila.itens.length };
});

teste('(E) CONTA DESCONHECIDA é descartada com registro, nunca processada', async () => {
  await montar(); await semearFluxoPublicado();

  const r = await postar(mensagemDoCliente({ account: { id: 999, name: 'Outra Empresa' } }));
  assert.equal(r.status, 200, 'não é erro nosso — reentregar não mudaria nada');
  assert.equal(r.json.descartado, 'empresa não mapeada');
  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 0, 'nada gravado');
  assert.equal(fila.itens.length, 0, 'nada enfileirado');
  assert.equal(estatisticasDoWebhook().contaDesconhecida, 1, 'e fica CONTADO, não silencioso');
  assert.ok(avisos.some((a) => a.includes('sem empresa mapeada')));
  return { status: r.status, contado: estatisticasDoWebhook().contaDesconhecida };
});

teste('(F) ERRO INTERNO NOSSO não vira 500: a entrada foi gravada, então é 2xx com o problema visível', async () => {
  await montar(); // SEM fluxo publicado; e agora quebramos o resolvedor por dentro
  portaria.configurarPortaria({
    atendimento: {
      resolverEntrada: async () => { throw new Error('política de atendimento não migrada'); },
      cancelarRelogios: atendimento.cancelarRelogios,
    },
  });

  const r = await postar(mensagemDoCliente());
  assert.equal(r.status, 200, '⚠️ 500 aqui faria o Chatwoot reentregar para sempre um evento que vai falhar sempre');
  assert.equal(r.json.resultado, 'degradada');
  assert.ok(r.json.entradaId, 'a mensagem do cliente NÃO se perdeu');
  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 1);

  const st = estatisticasDoWebhook();
  assert.equal(st.degradados, 1, 'o problema fica visível no /saude');
  assert.equal(st.naoGravados, 0);
  assert.ok(String(st.ultimoErro).includes('resolvedor_falhou'));

  // devolve a porta boa para os próximos
  portaria.configurarPortaria({
    atendimento: { resolverEntrada: atendimento.resolverEntrada, cancelarRelogios: atendimento.cancelarRelogios },
  });
  return { status: r.status, resultado: r.json.resultado, degradados: st.degradados, ultimoErro: st.ultimoErro };
});

teste('(F2) mas NÃO GRAVAR é diferente de degradar: aí sim pede reentrega (503), para não perder a mensagem', async () => {
  await montar({ falharAoGravarEntrada: true });

  const r = await postar(mensagemDoCliente());
  assert.equal(r.status, 503, 'a única forma de a mensagem não sumir é o Chatwoot mandar de novo');
  assert.equal(r.json.code, 'NAO_GRAVADO');
  assert.equal(estatisticasDoWebhook().naoGravados, 1);
  assert.notEqual(r.status, 500, 'e mesmo assim não é 500 — 503 diz "tente de novo", não "eu quebrei"');
  return { status: r.status, code: r.json.code };
});

teste('(G) o segredo continua sendo a única porta: sem token, 401 e nada acontece', async () => {
  await montar(); await semearFluxoPublicado();
  const r = await postar(mensagemDoCliente(), { token: null });
  assert.equal(r.status, 401);
  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 0);
  assert.equal(estatisticasDoWebhook().recebidos, 0, 'nem contado — não passou da porta');
  return { status: r.status };
});

teste('(H) o classificador aguenta o corpo REAL: message_type inteiro, created_at em epoch', async () => {
  // ⚠️ Isto não é preciosismo. O Chatwoot serializa `message_type` como inteiro em parte dos
  // caminhos; um classificador que só entendesse texto mandaria TODA mensagem de cliente para
  // «controle» — o robô ficaria mudo e o log diria que estava tudo certo.
  const c1 = classificarEvento(mensagemDoCliente({ message_type: 0, created_at: 1788357598 }));
  assert.equal(c1.classe, 'resposta_cliente');
  assert.equal(c1.origemEm.toISOString(), '2026-09-02T13:59:58.000Z', 'epoch em SEGUNDOS');

  const c2 = classificarEvento(mensagemDoCliente({ message_type: 1, content_attributes: { rgt_efeito: 'x' } }));
  assert.equal(c2.classe, 'eco_proprio');
  const c3 = classificarEvento(mensagemDoCliente({ message_type: 2 }));
  assert.equal(c3.motivo, 'mensagem_activity');
  const c4 = classificarEvento({ event: 'conversation_typing_on', account: { id: CONTA } });
  assert.equal(c4.acao, 'nada');
  const c5 = classificarEvento({ event: 'conversation_created', account: { id: CONTA }, id: 77, conversation: { id: 4242 } });
  assert.equal(c5.acao, 'protocolo');
  assert.equal(c5.cwConversationId, 4242, 'a conversa vem de conversation.id, nunca do id da mensagem');

  assert.equal(carimboDeOrigem(1788357598000).toISOString(), '2026-09-02T13:59:58.000Z', 'epoch em MILISSEGUNDOS');
  assert.equal(carimboDeOrigem(null), null);
  assert.equal(carimboDeOrigem('lixo'), null, 'carimbo ilegível é NULO, não Invalid Date');
  return { c1: c1.classe, c2: c2.classe, c3: c3.motivo, c4: c4.acao, c5: c5.acao };
});

teste('(I) conversation_created continua emitindo protocolo — o caminho antigo não foi quebrado', async () => {
  await montar();
  const r = await postar({
    event: 'conversation_created', id: CONVERSA,
    account: { id: CONTA, name: 'Ragnatela' }, inbox: { id: CAIXA },
    conversation: { id: CONVERSA, account_id: CONTA, inbox_id: CAIXA, status: 'open' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.protocolo, 'RGT-0000000042');
  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 0,
    'criação de conversa NÃO vira entrada de fluxo — não é resposta de pergunta');
  return { protocolo: r.json.protocolo };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nWEBHOOK → PORTARIA → FILA → MOTOR → CANAL  (a corrente inteira)\n');
let passou = 0; let falhou = 0;
for (const [nome, fn] of testes) {
  try { const r = await fn(); passou += 1; console.log(`  PASSOU  ${nome}${r ? `\n            -> ${JSON.stringify(r)}` : ''}`); }
  catch (e) { falhou += 1; console.log(`  FALHOU  ${nome}\n            ${e.message}\n            ${String(e.stack).split('\n').slice(1, 4).join('\n            ')}`); }
}

// Devolve os serviços da casa à configuração original — teste não pode deixar serviço apontando
// para dublê. (O `configurarWebhook` original é restaurado pelo mesmo caminho.)
atendimento.configurar(ORIGINAIS.atendimento);
portaria.configurarPortaria(ORIGINAIS.portaria);
motor.configurarMotor(ORIGINAIS.motor);
configurarWebhook(ORIGINAIS.webhook);
if (servidor) await new Promise((ok) => servidor.close(ok));

console.log(`\n  ${passou} passaram, ${falhou} falharam  ·  serviços devolvidos à configuração original\n`);
process.exit(falhou ? 1 : 0);
