// PORTARIA — o primeiro "oi" tem de acordar o fluxo, e a mesma mensagem duas vezes não pode acordar
// dois. Roda o CÓDIGO DE VERDADE (portaria + resolvedor de entrada + motor) contra um dublê de
// Prisma em memória. Nada é simulado dentro dos serviços: só as PORTAS mudam.
//
// Rodar:  node tests/ragnabot-portaria.test.mjs      (o vitest só pega `.test.js`)
import assert from 'node:assert/strict';
import { criarFake } from './fixtures/fake-prisma-motor.mjs';
import * as motor from '../src/services/ragnabot-fluxo-motor.service.js';
import * as atendimento from '../src/services/ragnabot-atendimento.service.js';
import * as portaria from '../src/services/ragnabot-portaria.service.js';

const TENANT = 'tenant-1';
const CONTA = 7;
const CONVERSA = 4242;
const CAIXA = 3;
const AGORA = new Date('2026-08-29T14:00:00.000Z'); // quarta-feira, 11h em Fortaleza

let db; let fila; let enviados; let relogiosApagados; let politicasNoBanco;
const avisos = [];
const logMudo = {
  info: () => {}, debug: () => {},
  warn: (m) => avisos.push(String(m)),
  error: (m) => avisos.push(String(m)),
};

// Guarda a configuração original dos serviços para devolver tudo no fim — teste não pode deixar
// serviço da casa apontando para dublê.
const ORIGINAIS = {
  atendimento: atendimento.portasDoAtendimento(),
  portaria: portaria.portasDaPortaria(),
  motor: motor.portasDoMotor(),
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

/**
 * O dublê do motor NÃO conhece as tabelas `RagnabotAtend*` (a fixture é de outro dono e não pode ser
 * editada nesta tarefa). Elas entram aqui, com o mínimo que `carregarPoliticaEfetiva()` e
 * `cancelarRelogios()` chamam de verdade — e é o mínimo de propósito: política ausente é o estado
 * REAL do ambiente hoje (nenhuma caixa de WhatsApp criada), e é ele que precisa não quebrar.
 */
function comTabelasDeAtendimento(cliente) {
  // ⚠️ ÍNDICE ÚNICO DECLARADO AQUI, e não na fixture (que é de outro dono e não pode ser editada
  // nesta tarefa): `RagnabotFluxoEntrada.chave` é `@unique` em prisma/schema.prisma, e é ELE que
  // transforma a reentrega em P2002. Sem emular o índice, o teste de idempotência mediria o dublê,
  // não a regra — e passaria por engano no dia em que a portaria parasse de tratar a colisão.
  const criarEntrada = cliente.ragnabotFluxoEntrada.create;
  cliente.ragnabotFluxoEntrada.create = async (args) => {
    const jaTem = await cliente.ragnabotFluxoEntrada.findUnique({ where: { chave: args?.data?.chave } });
    if (jaTem) { const e = new Error('Unique constraint failed on the fields: (`chave`)'); e.code = 'P2002'; throw e; }
    return criarEntrada(args);
  };

  const casa = (r, w = {}) => Object.entries(w).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(r[k]);
    return r[k] === cond;
  });
  cliente.ragnabotAtendPolitica = {
    findMany: async ({ where } = {}) => politicasNoBanco.filter((p) => casa(p, where)),
  };
  cliente.ragnabotAtendExpediente = { findMany: async () => [] };
  cliente.ragnabotAtendExcecaoData = { findMany: async () => [] };
  cliente.ragnabotAtendRelogio = {
    findMany: async () => [],
    deleteMany: async () => { relogiosApagados += 1; return { count: 0 }; },
  };
  return cliente;
}

function montar({ resolverEntradaDuble = null, semFila = false } = {}) {
  db = comTabelasDeAtendimento(criarFake());
  enviados = [];
  relogiosApagados = 0;
  politicasNoBanco = [];
  avisos.length = 0;
  const jobs = [];
  let seq = 1;

  fila = {
    itens: jobs,
    enfileirar: async (job) => { const j = { id: seq++, status: 'pendente', ...job }; jobs.push(j); return j; },
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
      portaDa: async () => ({
        enviar: async (intencao) => { enviados.push(intencao); return { idExterno: `cw-${enviados.length}` }; },
        lerConversa: async () => ({ status: 'open', assigneeId: null, labels: [] }),
        carimbar: async () => {},
      }),
    },
    nos: { obter: (t) => NOS[t] ?? null },
    cofre: { resolver: async () => 'segredo-de-teste' },
    // Relógio congelado nos DOIS lados: o casamento posicional no tempo (§3.2/C) compara o
    // `origemEm` da mensagem com o `aguardaDesde` da execução, e um lado no relógio de parede com o
    // outro num instante fixo reprovaria resposta legítima.
    relogio: { agora: () => AGORA },
    protocolo: { emitirProtocolo: async () => ({ protocolo: 'RGT-0000000042', numero: 42, novo: true }) },
  });

  // O resolvedor de entrada é código REAL: ele fala com o mesmo dublê de banco.
  atendimento.configurar({ db, relogio: { agora: () => AGORA } });

  portaria.configurarPortaria({
    db,
    fila: semFila ? null : fila,
    relogio: { agora: () => AGORA },
    log: logMudo,
    atendimento: {
      resolverEntrada: resolverEntradaDuble ?? atendimento.resolverEntrada,
      cancelarRelogios: atendimento.cancelarRelogios,
    },
    motor: { iniciarOuRecuperarExecucao: motor.iniciarOuRecuperarExecucao },
  });
}

async function semearFluxoPublicado({ versaoPublicadaId = 'versao-1' } = {}) {
  await db.ragnabotFluxo.create({
    data: {
      id: 'fluxo-1', tenantId: TENANT, nome: 'ATENDIMENTO', estado: 'publicado',
      entrada: 'caixa', cwInboxId: CAIXA, versaoPublicadaId,
      passosPorEvento: 50, passosTotalMax: 500, visitasPorNoMax: 10,
      ttlExecucaoSegundos: 82800, retomada: 'reiniciar',
      politicaContinuacao: { janelaSegundos: 20, ambiguidadeMs: 2000 },
    },
  });
  if (versaoPublicadaId) {
    await db.ragnabotFluxoVersao.create({
      data: {
        id: versaoPublicadaId, fluxoId: 'fluxo-1', tenantId: TENANT, numero: 1, documento: DOCUMENTO,
        hashDocumento: 'h1', hashEstrutura: 'e1', noInicialId: 'n1', perfilLimite: 'whatsapp_cloud@2026-08',
      },
    });
  }
}

const oi = (extra = {}) => ({
  tenantId: TENANT, cwAccountId: CONTA, cwConversationId: CONVERSA, cwInboxId: CAIXA,
  texto: 'oi', mensagemId: 9001, agora: AGORA, origemEm: new Date(AGORA.getTime() - 1200),
  contatoChave: '5598983351000', ...extra,
});

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
teste('(a) o primeiro "oi" INICIA a execução do fluxo publicado — e o fluxo responde', async () => {
  montar(); await semearFluxoPublicado();

  const r = await portaria.atenderMensagemRecebida(oi());

  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.EXECUCAO_INICIADA);
  assert.equal(r.nova, true, 'a execução tem de NASCER no primeiro oi');
  assert.equal(r.primeiroContato, true);
  assert.equal(r.motivo, 'fluxo_da_caixa', 'sem política cadastrada, vale o fluxo declarado pela caixa');
  assert.equal(r.protocolo, 'RGT-0000000042', 'o protocolo é da conversa e nasce junto');
  assert.equal(r.chaveParticao, `${CONTA}:${CONVERSA}`, 'a serialização é por conta:conversa (§5.4)');

  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(execs.length, 1);
  assert.equal(execs[0].versaoId, 'versao-1', 'a versão publicada vem resolvida do resolvedor');

  const jobs = fila.itens;
  assert.equal(jobs.length, 1, 'um trabalho, não dois');
  assert.equal(jobs[0].tipo, 'iniciar');
  assert.equal(jobs[0].chaveParticao, `${CONTA}:${CONVERSA}`);
  assert.deepEqual(jobs[0].payload.entradaIds, [r.entradaId], 'a mensagem viaja junto do trabalho');

  // A prova que interessa ao dono: o cliente mandou "oi" e o robô FALOU.
  await motor.processarTrabalho(jobs[0], 'w1');
  const e = await db.ragnabotFluxoExecucao.findUnique({ where: { id: r.execucaoId } });
  assert.equal(enviados.length, 2, 'saiu a saudação e a pergunta');
  assert.equal(enviados[0].corpo, 'Olá! Sou o Ragnabot.');
  assert.equal(e.estado, 'esperando');
  assert.equal(e.noAtualId, 'n3');
  assert.equal(relogiosApagados, 1, '§5.3: nascendo o fluxo, o relógio de atendimento cala a boca');
  return { resultado: r.resultado, motivo: r.motivo, enviados: enviados.map((x) => x.corpo), estado: e.estado };
});

teste('(b) a MESMA mensagem entregue duas vezes não inicia duas execuções', async () => {
  montar(); await semearFluxoPublicado();

  const r1 = await portaria.atenderMensagemRecebida(oi());
  const r2 = await portaria.atenderMensagemRecebida(oi()); // reentrega idêntica do Chatwoot

  assert.equal(r1.resultado, portaria.RESULTADOS_PORTARIA.EXECUCAO_INICIADA);
  assert.equal(r2.resultado, portaria.RESULTADOS_PORTARIA.DUPLICADA);
  assert.equal(r2.motivo, 'chave_repetida');
  assert.equal(r1.chave, r2.chave, 'a chave da entrada é determinística');

  const entradas = await db.ragnabotFluxoEntrada.findMany({});
  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(entradas.length, 1, 'uma linha de entrada, não duas');
  assert.equal(execs.length, 1, 'UMA execução — reentrega não pode acordar um segundo fluxo');
  assert.equal(fila.itens.length, 1, 'e não pode duplicar o trabalho na fila');

  // E o efeito também não duplica: rodar o trabalho uma vez manda 2 mensagens, não 4.
  await motor.processarTrabalho(fila.itens[0], 'w1');
  assert.equal(enviados.length, 2);
  return { primeira: r1.resultado, segunda: r2.resultado, entradas: entradas.length, execucoes: execs.length, enviados: enviados.length };
});

teste('(b2) reentrega com carimbo diferente e MESMO cwMessageId continua sendo a mesma mensagem', async () => {
  montar(); await semearFluxoPublicado();
  const r1 = await portaria.atenderMensagemRecebida(oi());
  const r2 = await portaria.atenderMensagemRecebida(oi({ origemEm: new Date(AGORA.getTime() - 50) }));
  assert.equal(r2.resultado, portaria.RESULTADOS_PORTARIA.DUPLICADA, 'o id estável manda, não o carimbo');
  assert.equal(r1.chave, r2.chave);
  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(execs.length, 1);
  return { chave: r1.chave };
});

teste('(c) decisão "fila humana": NENHUMA execução é criada', async () => {
  montar({
    resolverEntradaDuble: async () => ({
      acao: atendimento.ACOES_ENTRADA.FILA_HUMANA, fluxoId: null, versaoId: null,
      motivo: 'sem_fluxo', mensagem: 'Olá! Já chamamos um atendente.', encerrarApos: false,
      expediente: { aberto: true, motivo: 'aberto' }, primeiroContato: true,
    }),
  });
  await semearFluxoPublicado(); // existe fluxo, mas a DECISÃO foi outra — e ela é quem manda

  const r = await portaria.atenderMensagemRecebida(oi());

  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.FILA_HUMANA);
  assert.equal(r.execucaoId, null);
  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(execs.length, 0, 'fila humana NÃO acorda robô');
  const entradas = await db.ragnabotFluxoEntrada.findMany({});
  assert.equal(entradas.length, 1, 'mas a mensagem fica gravada — ela é a prova de que chegou');
  assert.equal(fila.itens.length, 1);
  assert.equal(fila.itens[0].tipo, portaria.TIPO_JOB_MENSAGEM, 'o texto vira TRABALHO, não chamada direta ao canal');
  assert.equal(fila.itens[0].payload.texto, 'Olá! Já chamamos um atendente.');
  assert.equal(relogiosApagados, 0, '§5.3: sem execução viva, o relógio continua sendo o dono do silêncio');
  return { resultado: r.resultado, execucoes: execs.length, job: fila.itens[0].tipo };
});

teste('(d) empresa SEM fluxo publicado não quebra: cai para fila humana com motivo', async () => {
  montar(); // nenhum fluxo semeado — é o estado real do ambiente hoje

  const r = await portaria.atenderMensagemRecebida(oi());

  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.FILA_HUMANA);
  assert.equal(r.motivo, 'sem_fluxo');
  assert.equal(r.execucaoId, null);
  const execs = await db.ragnabotFluxoExecucao.findMany({});
  assert.equal(execs.length, 0);
  assert.equal(fila.itens.length, 0, 'sem mensagem configurada, nada é enfileirado');
  assert.equal(avisos.length, 0, 'e isto NÃO é anomalia: nada de aviso no log');
  return { resultado: r.resultado, motivo: r.motivo };
});

teste('(d2) fluxo apontado mas NUNCA publicado também cai para gente, com o motivo certo', async () => {
  montar(); await semearFluxoPublicado({ versaoPublicadaId: null });
  const r = await portaria.atenderMensagemRecebida(oi());
  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.FILA_HUMANA);
  assert.equal((await db.ragnabotFluxoExecucao.findMany({})).length, 0);
  return { resultado: r.resultado, motivo: r.motivo };
});

teste('(e) conversa COM execução viva: a mensagem vai ao motor sem passar pelo resolvedor', async () => {
  let chamouResolvedor = 0;
  montar({
    resolverEntradaDuble: async (...args) => { chamouResolvedor += 1; return atendimento.resolverEntrada(...args); },
  });
  await semearFluxoPublicado();

  const r1 = await portaria.atenderMensagemRecebida(oi());
  await motor.processarTrabalho(fila.itens[0], 'w1'); // fica esperando resposta em n3

  const r2 = await portaria.atenderMensagemRecebida(oi({
    texto: 'o servidor não liga', mensagemId: 9002, origemEm: new Date(AGORA.getTime() + 5000),
  }));

  assert.equal(r2.resultado, portaria.RESULTADOS_PORTARIA.EXECUCAO_CONTINUADA);
  assert.equal(r2.execucaoId, r1.execucaoId);
  assert.equal(chamouResolvedor, 1, 'o resolvedor só decide quando NÃO há execução viva (armadilha 2)');
  const job = fila.itens.find((j) => j.tipo === 'entrada');
  assert.ok(job, 'a resposta entra como trabalho `entrada`');

  await motor.processarTrabalho(job, 'w1');
  const e = await db.ragnabotFluxoExecucao.findUnique({ where: { id: r1.execucaoId } });
  assert.equal(e.vars.detalhes, 'o servidor não liga', 'a resposta foi gravada na variável do nó');
  assert.equal(e.estado, 'concluido');
  return { resultado: r2.resultado, var: e.vars.detalhes, estado: e.estado, chamadasDoResolvedor: chamouResolvedor };
});

teste('(f) evento de CONTROLE é gravado e não acorda fluxo nenhum', async () => {
  montar(); await semearFluxoPublicado();
  const r = await portaria.atenderMensagemRecebida(oi({
    evento: 'conversation_created', classe: portaria.CLASSES_ENTRADA.CONTROLE, mensagemId: null, texto: '',
  }));
  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.REGISTRADA);
  assert.equal((await db.ragnabotFluxoExecucao.findMany({})).length, 0, 'criação de conversa NUNCA é resposta');
  assert.equal(fila.itens.length, 0);
  return { resultado: r.resultado, chave: r.chave.slice(0, 34) };
});

teste('(g) sem porta de fila: degrada com AVISO, não estoura, e a execução ainda nasce', async () => {
  montar({ semFila: true }); await semearFluxoPublicado();
  const r = await portaria.atenderMensagemRecebida(oi());
  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.EXECUCAO_INICIADA);
  assert.equal(r.enfileirado, false);
  assert.equal(r.motivo, 'fluxo_da_caixa', 'o motivo da DECISÃO não pode ser apagado pelo motivo da FILA');
  assert.equal(r.motivoFila, 'fila_ausente');
  assert.ok(avisos.some((a) => a.includes('fila')), 'a falta da porta tem de aparecer no log');
  assert.equal((await db.ragnabotFluxoExecucao.findMany({})).length, 1,
    'o varredor de órfãos do motor recolhe a execução sem job — perder o job atrasa, não perde a conversa');
  return { resultado: r.resultado, enfileirado: r.enfileirado, aviso: avisos[0] };
});

teste('(h) endereço incompleto é RECUSADO sem gravar lixo', async () => {
  montar();
  const r = await portaria.atenderMensagemRecebida({ texto: 'oi', cwAccountId: CONTA });
  assert.equal(r.ok, false);
  assert.equal(r.resultado, portaria.RESULTADOS_PORTARIA.RECUSADA);
  assert.equal((await db.ragnabotFluxoEntrada.findMany({})).length, 0);
  return { resultado: r.resultado, motivo: r.motivo };
});

teste('(i) a chave: id estável manda; sem id, sha256 do corpo SEM campos voláteis', async () => {
  const a = portaria.chaveDeEntrada({ cwAccountId: 7, evento: 'message_created', tipoObjeto: 'm', idObjeto: 55 });
  const b = portaria.chaveDeEntrada({ cwAccountId: 7, evento: 'message_created', tipoObjeto: 'm', idObjeto: 56 });
  assert.equal(a, 'cw:7:message_created:m:55');
  assert.notEqual(a, b);

  const c1 = portaria.chaveDeEntrada({ cwAccountId: 7, evento: 'x', corpo: { texto: 'oi', updated_at: '1', messages_count: 3 } });
  const c2 = portaria.chaveDeEntrada({ cwAccountId: 7, evento: 'x', corpo: { messages_count: 9, texto: 'oi', updated_at: '2' } });
  assert.equal(c1, c2, 'campo que o emissor reescreve NÃO pode entrar na chave — senão a reentrega passa direto');
  const c3 = portaria.chaveDeEntrada({ cwAccountId: 7, evento: 'x', corpo: { texto: 'ola' } });
  assert.notEqual(c1, c3, 'texto diferente é mensagem diferente');
  return { comId: a, semId: c1.slice(0, 24), canonico: portaria.canonicalizarCorpo({ b: 1, a: 2, updated_at: 'z' }) };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
let ok = 0; let falhou = 0;
for (const [nome, fn] of testes) {
  try {
    const detalhe = await fn();
    ok += 1;
    console.log(`  PASSOU  ${nome}${detalhe ? `\n            -> ${JSON.stringify(detalhe)}` : ''}`);
  } catch (e) {
    falhou += 1;
    console.log(`  FALHOU  ${nome}\n            -> ${e.message}`);
    if (process.env.VERBOSE) console.log(e.stack);
  }
}

// LIMPEZA: o banco foi um dublê em memória (nada tocou o Postgres), mas os serviços da casa ficaram
// apontando para ele. Devolver a configuração original é o que impede este teste de contaminar
// qualquer coisa que rode no mesmo processo depois.
atendimento.configurar(ORIGINAIS.atendimento);
portaria.configurarPortaria(ORIGINAIS.portaria);
motor.configurarMotor(ORIGINAIS.motor);
motor.limparCacheDeVersao();
console.log(`\n  ${ok} passaram, ${falhou} falharam  ·  serviços devolvidos à configuração original`);
process.exit(falhou ? 1 : 0);
