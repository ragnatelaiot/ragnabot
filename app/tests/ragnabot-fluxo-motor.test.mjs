// Roda a máquina de estado DE VERDADE contra um dublê de Prisma em memória.
// Nada aqui é simulado no motor: é o mesmo código, com outras portas.
import assert from 'node:assert/strict';
import { criarFake } from './fixtures/fake-prisma-motor.mjs';
import * as motor from '../src/services/ragnabot-fluxo-motor.service.js';

const TENANT = 'tenant-1';
const CONTA = 7;
const CONVERSA = 4242;

let db; let fila; let canal; let enviados; let falharEnvio; let lerConversaChamadas;

// ── catálogo mínimo de executores de nó, seguindo o contrato declarado no motor ─────────────────
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
  variavel: {
    tipo: 'variavel', efeito: 'nenhum', politicaEmDuvida: 'seguir', estaciona: false,
    saidas: () => ['padrao'], validar: () => [], preparar: () => [],
    executar: async (ctx) => ({ tipo: 'seguir', saida: 'padrao', varsPatch: { ...ctx.no.config.definir } }),
  },
  lista: {
    tipo: 'lista', efeito: 'irrepetivel', politicaEmDuvida: 'conciliar', estaciona: true,
    saidas: (c) => [...c.itens.map((i) => i.id), 'sem_resposta', 'opcao_invalida', 'erro'],
    validar: () => [],
    preparar: (no) => ({ tipo: 'lista', corpo: no.config.corpo, itens: no.config.itens, sufixo: '' }),
    executar: async (ctx) => ({
      tipo: 'aguardar', motivo: 'resposta',
      acordarEm: new Date(new Date(ctx.agora).getTime() + 4 * 60 * 1000), saidaAoVencer: 'sem_resposta',
    }),
    receber: async (ctx, entrada) => {
      const itens = ctx.no.itens ?? ctx.no.config?.itens ?? [];
      if (entrada.interativo?.id) return { saida: entrada.interativo.id, varsPatch: {}, viaCasamento: 'interativo' };
      const idx = Number(String(entrada.texto).trim());
      if (Number.isInteger(idx) && itens[idx - 1]) return { saida: itens[idx - 1].id, varsPatch: {}, viaCasamento: 'indice' };
      return { saida: 'opcao_invalida', varsPatch: {}, viaCasamento: null };
    },
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
    { id: 'n2', tipo: 'texto', config: { corpo: 'Ola! Sou o Ragnabot.' } },
    {
      id: 'n3',
      tipo: 'lista',
      config: {
        corpo: 'O que você precisa?',
        itens: [{ id: 'abrir', titulo: 'Abrir chamado' }, { id: 'sair', titulo: 'Falar depois' }],
        excecoes: {
          semResposta: { esperar: { valor: 4, unidade: 'minutos' }, tentativas: 1, acaoFinal: 'encerrar' },
          opcaoInvalida: { tentativas: 1, acaoFinal: 'encerrar' },
        },
      },
    },
    { id: 'n4', tipo: 'pergunta', config: { corpo: 'Descreva o problema.', variavel: 'detalhes' } },
    { id: 'n5', tipo: 'variavel', config: { definir: { classificado: 'sim' } } },
    { id: 'n6', tipo: 'texto', config: { corpo: 'Chamado registrado.' } },
    { id: 'n7', tipo: 'encerrar', config: {} },
    { id: 'n8', tipo: 'texto', config: { corpo: 'Tudo bem, até logo.' } },
    { id: 'n9', tipo: 'texto', config: { corpo: 'Nao consegui enviar antes.' } },
  ],
  arestas: [
    { de: 'n1', saida: 'padrao', para: 'n2' },
    { de: 'n2', saida: 'padrao', para: 'n3' },
    { de: 'n2', saida: 'erro', para: 'n9' },
    { de: 'n3', saida: 'abrir', para: 'n4' },
    { de: 'n3', saida: 'sair', para: 'n8' },
    { de: 'n3', saida: 'opcao_invalida', para: 'n3' },
    { de: 'n4', saida: 'padrao', para: 'n5' },
    { de: 'n5', saida: 'padrao', para: 'n6' },
    { de: 'n6', saida: 'padrao', para: 'n7' },
    { de: 'n8', saida: 'padrao', para: 'n7' },
    { de: 'n9', saida: 'padrao', para: 'n7' },
  ],
};

function montarPortas() {
  db = criarFake();
  enviados = [];
  falharEnvio = null;
  lerConversaChamadas = 0;
  const jobs = [];
  let seq = 1;

  fila = {
    itens: jobs,
    enfileirar: async (job) => { const j = { id: seq++, status: 'pendente', tentativas: 0, ...job }; jobs.push(j); return j; },
    candidatos: async ({ limite = 20 } = {}) => jobs.filter((j) => j.status === 'pendente').slice(0, limite),
    drenarParticao: async (chave, worker) => {
      const meus = jobs.filter((j) => j.status === 'pendente' && j.chaveParticao === chave);
      meus.forEach((j) => { j.status = 'processando'; j.donoWorker = worker; j.travadoEm = new Date(); });
      return meus;
    },
    concluirJob: async (id, { status }) => { const j = jobs.find((x) => x.id === id); if (j) j.status = status; },
    adiarJob: async (id, { motivo }) => { const j = jobs.find((x) => x.id === id); if (j) { j.status = 'pendente'; j.ultimoErro = motivo; } },
    devolverJobsDoWorker: async (worker) => {
      const meus = jobs.filter((j) => j.donoWorker === worker && j.status === 'processando');
      meus.forEach((j) => { j.status = 'pendente'; j.donoWorker = null; });
      return meus.length;
    },
  };

  canal = {
    portaDa: async () => ({
      enviar: async (intencao) => {
        if (falharEnvio) { const e = falharEnvio; falharEnvio = null; throw e; }
        enviados.push(intencao);
        return { idExterno: `cw-${enviados.length}` };
      },
      lerConversa: async () => { lerConversaChamadas += 1; return { status: 'open', assigneeId: null, labels: [] }; },
      carimbar: async () => {},
    }),
  };

  motor.limparCacheDeVersao();
  motor.configurarMotor({
    db,
    fila,
    canal,
    nos: { obter: (t) => NOS[t] ?? null },
    cofre: { resolver: async () => 'segredo-de-teste' },
    limites: null,
    protocolo: { emitirProtocolo: async () => ({ protocolo: 'RGT-0000000042', numero: 42, novo: true }) },
  });
}

async function semear() {
  await db.ragnabotFluxo.create({
    data: {
      id: 'fluxo-1', tenantId: TENANT, nome: 'ABERTURA DE CHAMADO', estado: 'publicado',
      versaoPublicadaId: 'versao-1', passosPorEvento: 50, passosTotalMax: 500, visitasPorNoMax: 10,
      ttlExecucaoSegundos: 82800, retomada: 'reiniciar', politicaContinuacao: { janelaSegundos: 20, ambiguidadeMs: 2000 },
    },
  });
  await db.ragnabotFluxoVersao.create({
    data: {
      id: 'versao-1', fluxoId: 'fluxo-1', tenantId: TENANT, numero: 1, documento: DOCUMENTO,
      hashDocumento: 'h1', hashEstrutura: 'e1', noInicialId: 'n1', perfilLimite: 'whatsapp_cloud@2026-08',
    },
  });
}

async function novaExecucao() {
  const { execucao, nova } = await motor.iniciarOuRecuperarExecucao({
    tenantId: TENANT, cwAccountId: CONTA, cwConversationId: CONVERSA,
    contatoChave: '5598983351000', fluxoId: 'fluxo-1', versaoId: 'versao-1',
  });
  return { execucao, nova };
}

async function gravarEntrada({ texto, cwMessageId, origemEm, interativo = null }) {
  return db.ragnabotFluxoEntrada.create({
    data: {
      chave: `cw:${CONTA}:message_created:m:${cwMessageId}`, tenantId: TENANT, cwAccountId: CONTA,
      cwConversationId: CONVERSA, cwMessageId, evento: 'message_created', classe: 'resposta_cliente',
      corpo: { texto, interativo }, origemEm, resultado: null,
    },
  });
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
teste('1. caminho feliz: nasce, marcha ate a lista e ESTACIONA', async () => {
  montarPortas(); await semear();
  const { execucao, nova } = await novaExecucao();
  assert.equal(nova, true);
  assert.equal(execucao.protocolo, 'RGT-0000000042');

  const r = await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const e = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });

  assert.equal(e.estado, 'esperando', 'deveria parar esperando resposta');
  assert.equal(e.noAtualId, 'n3');
  assert.equal(e.aguardando, 'resposta');
  assert.ok(e.aguardaDesde, 'aguardaDesde e obrigatorio: sem ele nao ha casamento posicional no tempo');
  assert.equal(enviados.length, 2, 'saiu o texto e a lista');
  assert.equal(enviados[0].tipo, 'texto');
  assert.equal(enviados[1].tipo, 'lista');
  assert.ok(e.noCongelado, 'o no parado precisa estar congelado');
  assert.equal(e.noCongelado.itens.length, 2);
  const despertar = fila.itens.filter((j) => j.tipo === 'despertar');
  assert.equal(despertar.length, 1, 'o prazo precisa virar linha na fila, nunca setTimeout');
  assert.equal(despertar[0].tokenVisita, e.visitaSeq);
  return { passos: r.passos, resultado: r.resultado, enviados: enviados.length };
});

teste('2. efeitos: um por intencao, chave deterministica, confirmados', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const efeitos = await db.ragnabotFluxoEfeito.findMany({ where: { execucaoId: execucao.id } });
  assert.equal(efeitos.length, 2);
  assert.ok(efeitos.every((f) => f.status === 'confirmado'), 'todos confirmados apos o despacho');
  for (const f of efeitos) {
    assert.equal(f.chave, motor.chaveEfeito({
      execucaoId: f.execucaoId, noId: f.noId, visitaSeq: f.visitaSeq, tentativa: f.tentativa, sufixo: f.sufixo,
    }), 'a chave tem de ser reproduzivel a partir da propria linha');
  }
  const a = motor.chaveEfeito({ execucaoId: 'x', noId: 'n', visitaSeq: 1, tentativa: 1, sufixo: '' });
  const b = motor.chaveEfeito({ execucaoId: 'x', noId: 'n', visitaSeq: 2, tentativa: 1, sufixo: '' });
  const c = motor.chaveEfeito({ execucaoId: 'x', noId: 'n', visitaSeq: 1, tentativa: 2, sufixo: '' });
  assert.notEqual(a, b, 'visita diferente = chave diferente');
  assert.notEqual(a, c, 'tentativa diferente = chave diferente');
  return { chaves: efeitos.map((f) => f.chave.slice(0, 12)) };
});

teste('3. resposta do cliente: consome, segue e chega ao fim', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const e1 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });

  const ent = await gravarEntrada({ texto: '1', cwMessageId: 101, origemEm: new Date(Date.now() + 10) });
  await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [ent.id] } }, 'w1');
  const e2 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(e2.noAtualId, 'n4', 'escolheu "abrir" pelo indice 1');
  assert.equal(e2.estado, 'esperando');

  const ent2 = await gravarEntrada({ texto: 'o servidor nao liga', cwMessageId: 102, origemEm: new Date(Date.now() + 20) });
  await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [ent2.id] } }, 'w1');
  const e3 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(e3.estado, 'concluido');
  assert.equal(e3.vars.detalhes, 'o servidor nao liga');
  assert.equal(e3.vars.classificado, 'sim', 'o no `variavel` gravou pelo varsPatch');
  assert.ok(e3.trilha.length >= 5, 'a trilha precisa contar por onde a pessoa passou');
  return { trilha: e3.trilha.map((t) => `${t[0]}->${t[1]}`).join(' '), estado: e3.estado };
});

teste('4. IDEMPOTENCIA: reprocessar a MESMA entrada nao grava de novo', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const ent = await gravarEntrada({ texto: '1', cwMessageId: 201, origemEm: new Date(Date.now() + 10) });
  const job = { tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [ent.id] } };
  await motor.processarTrabalho(job, 'w1');
  const depois1 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });

  let capturado = null;
  try { await motor.processarTrabalho(job, 'w1'); } catch (e) { capturado = e; }
  assert.ok(capturado, 'reprocessar tem de LANCAR, nao seguir em silencio');
  assert.equal(capturado.codigo, 'ENTRADA_JA_CONSUMIDA');
  const depois2 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(depois2.noAtualId, depois1.noAtualId, 'a conversa nao pode ter andado');
  return { codigo: capturado.codigo, noAtual: depois2.noAtualId };
});

teste('5. POSSE: dois processos, so um entra', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  const t1 = await motor.tomarPosse(execucao.id, 'w1');
  const t2 = await motor.tomarPosse(execucao.id, 'w2');
  assert.ok(t1, 'w1 tomou a posse');
  assert.equal(t2, null, 'w2 NAO pode tomar a posse de uma execucao arrendada');
  assert.equal(await motor.renovarPosse(execucao.id, 'token-inventado'), false);
  assert.equal(await motor.renovarPosse(execucao.id, t1), true);
  assert.equal(await motor.liberarPosse(execucao.id, t1), true);
  const t3 = await motor.tomarPosse(execucao.id, 'w2');
  assert.ok(t3, 'depois de liberada, w2 entra');
  return { t1: !!t1, t2, t3: !!t3 };
});

teste('6. CERCA: passo com token errado lanca e NAO deixa efeito reservado', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  const token = await motor.tomarPosse(execucao.id, 'w1');
  let erro = null;
  try { await motor.passo(execucao.id, 'token-de-outro', { tipo: 'iniciar' }); } catch (e) { erro = e; }
  assert.ok(erro && erro.codigo === 'POSSE_PERDIDA', 'tem de ser PossePerdida');
  const efeitos = await db.ragnabotFluxoEfeito.findMany({ where: { execucaoId: execucao.id } });
  assert.equal(efeitos.length, 0, 'nenhum efeito pode sobrar de uma transacao que voltou atras');
  assert.equal(enviados.length, 0, 'nada pode ter sido enviado');
  await motor.liberarPosse(execucao.id, token);
  return { codigo: erro.codigo, efeitos: efeitos.length };
});

teste('7. DESPERTAR OBSOLETO: cliente respondeu antes do prazo', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const antes = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  const tokenVelho = antes.visitaSeq - 1;

  const r = await motor.processarTrabalho({ tipo: 'despertar', execucaoId: execucao.id, tokenVisita: tokenVelho }, 'w1');
  assert.equal(r.resultado, 'despertar_obsoleto');
  const depois = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(depois.noAtualId, 'n3', 'a conversa nao pode ter sido movida por um despertar velho');
  return { resultado: r.resultado };
});

teste('8. SEM_RESPOSTA: dentro do teto revisita o no; estourado aplica a acao final', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const e1 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });

  await motor.processarTrabalho({ tipo: 'despertar', execucaoId: execucao.id, tokenVisita: e1.visitaSeq }, 'w1');
  const e2 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(e2.tentativasNo.n3.semResposta, 1);
  assert.equal(e2.estado, 'esperando', 'primeira falta: repergunta o mesmo no');
  assert.equal(e2.noAtualId, 'n3');
  assert.equal(enviados.length, 3, 'a lista saiu de novo (reforco)');

  await motor.processarTrabalho({ tipo: 'despertar', execucaoId: execucao.id, tokenVisita: e2.visitaSeq }, 'w1');
  const e3 = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(e3.estado, 'concluido', 'teto estourado: acaoFinal=encerrar');
  const inc = await db.ragnabotFluxoIncidente.findMany({ where: { codigo: 'SEM_RESPOSTA_ESGOTADA' } });
  assert.equal(inc.length, 1, 'o operador precisa ver isso agrupado');
  return { tentativas: e2.tentativasNo.n3.semResposta, estadoFinal: e3.estado, incidentes: inc[0].ocorrencias };
});

teste('9. FALHA DE DESPACHO: reroteia pela saida `erro` do no que falhou', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  const e = new Error('canal recusou'); e.status = 422;
  falharEnvio = e;
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const fim = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  const efeitos = await db.ragnabotFluxoEfeito.findMany({ where: { execucaoId: execucao.id } });
  const falhou = efeitos.find((f) => f.status === 'falhou');
  assert.ok(falhou, 'o efeito precisa ficar registrado como falho');
  assert.equal(falhou.noId, 'n2');
  assert.equal(fim.estado, 'concluido', 'seguiu por n2 --erro--> n9 --padrao--> n7');
  assert.ok(enviados.some((i) => i.corpo === 'Nao consegui enviar antes.'), 'o desvio de erro foi percorrido');
  return { efeitoFalho: falhou.noId, estado: fim.estado, enviados: enviados.map((i) => i.tipo) };
});

teste('10. DUVIDA (tempo limite): efeito fica duvidoso, marcha PARA, conciliacao agendada', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  const e = new Error('socket hang up'); e.code = 'ETIMEDOUT';
  falharEnvio = e;
  const r = await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  assert.equal(r.resultado, 'efeito_duvidoso');
  const efeitos = await db.ragnabotFluxoEfeito.findMany({ where: { execucaoId: execucao.id } });
  assert.equal(efeitos.length, 1);
  assert.equal(efeitos[0].status, 'duvidoso', 'tempo limite NAO e falha, e duvida');
  const conciliar = fila.itens.filter((j) => j.tipo === 'conciliar');
  assert.equal(conciliar.length, 1, 'sem este job o varredor de orfaos faria a conversa marchar por cima');
  return { status: efeitos[0].status, jobsConciliar: conciliar.length };
});

teste('11. RAJADA: duas mensagens numa pergunta sao CONCATENADAS, nao trocadas', async () => {
  montarPortas(); await semear();
  const exec = {
    aguardando: 'resposta', aguardaDesde: new Date('2026-08-28T12:00:00Z'),
    noCongelado: { tipo: 'pergunta' }, ultimaVariavel: null,
  };
  const base = new Date('2026-08-28T12:00:10Z').getTime();
  const entradas = [
    { id: 'b', cwMessageId: 2, origemEm: new Date(base + 5000), corpo: { texto: 'o servidor nao liga' } },
    { id: 'a', cwMessageId: 1, origemEm: new Date(base), corpo: { texto: 'preciso de ajuda' } },
  ];
  const r = motor.coletarRajada(exec, entradas, { janelaSegundos: 20, ambiguidadeMs: 2000 });
  assert.equal(r.montagem, 'concatenar');
  assert.equal(r.consumir.length, 2);
  assert.equal(r.consumir[0].cwMessageId, 1, 'ordem pelo carimbo do CLIENTE, nao pela chegada a nossa porta');
  assert.equal(r.ordemIncerta, false);

  // lista/botoes com duas mensagens quase simultaneas: NAO aplica "vale a ultima"
  const exec2 = { ...exec, noCongelado: { tipo: 'lista' } };
  const juntas = [
    { id: 'a', cwMessageId: 1, origemEm: new Date(base), corpo: { texto: '1' } },
    { id: 'b', cwMessageId: 2, origemEm: new Date(base + 500), corpo: { texto: '2' } },
  ];
  const r2 = motor.coletarRajada(exec2, juntas, { janelaSegundos: 20, ambiguidadeMs: 2000 });
  assert.equal(r2.ordemIncerta, true);
  assert.equal(r2.montagem, 'ultima');
  return { montagem: r.montagem, ordem: r.consumir.map((x) => x.cwMessageId), incertaNaLista: r2.ordemIncerta };
});

teste('12. CASAMENTO NO TEMPO: mensagem anterior ao inicio da espera nao e resposta', async () => {
  const exec = { aguardaDesde: new Date('2026-08-28T12:00:00Z') };
  assert.equal(motor.podeCasarNoTempo(exec, { origemEm: new Date('2026-08-28T11:59:59Z') }), false);
  assert.equal(motor.podeCasarNoTempo(exec, { origemEm: new Date('2026-08-28T12:00:01Z') }), true);
  assert.equal(motor.podeCasarNoTempo(exec, { origemEm: null }), true, 'sem carimbo nao se REPROVA, so se marca incerto');

  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
  const parada = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  const velha = await gravarEntrada({ texto: '1', cwMessageId: 301, origemEm: new Date(new Date(parada.aguardaDesde).getTime() - 60000) });
  const r = await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [velha.id] } }, 'w1');
  assert.equal(r.resultado, 'guardado_como_contexto');
  const depois = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(depois.noAtualId, 'n3', 'a mensagem velha nao move a conversa');
  assert.equal(depois.caixaPendente.length, 1, 'ela vira contexto, com texto e horario');
  return { resultado: r.resultado, caixaPendente: depois.caixaPendente.length };
});

teste('13. UMA execucao viva por conversa (indice unico parcial)', async () => {
  montarPortas(); await semear();
  const a = await novaExecucao();
  const b = await novaExecucao();
  assert.equal(b.nova, false, 'a segunda chamada RECUPERA, nao cria');
  assert.equal(a.execucao.id, b.execucao.id);
  const todas = await db.ragnabotFluxoExecucao.findMany({ where: { cwConversationId: CONVERSA } });
  assert.equal(todas.length, 1);

  // conversa concluida: retomada legitima nasce execucao NOVA, com o MESMO protocolo
  await db.ragnabotFluxoExecucao.updateMany({ where: { id: a.execucao.id }, data: { estado: 'concluido', encerradaEm: new Date() } });
  const c = await novaExecucao();
  assert.equal(c.nova, true, 'depois de concluida, a retomada precisa poder nascer');
  assert.equal(c.execucao.origemExecucaoId, a.execucao.id, 'a retomada aponta para a anterior');
  assert.equal(c.execucao.protocolo, a.execucao.protocolo, 'o protocolo e da CONVERSA, nao da execucao');
  return { recuperou: !b.nova, retomada: c.nova, protocoloIgual: c.execucao.protocolo === a.execucao.protocolo };
});

teste('14. RETOMADA APOS REINICIO: devolve trabalho e solta as posses do worker morto', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  const token = await motor.tomarPosse(execucao.id, 'w-morto');
  await fila.enfileirar({ tipo: 'continuar', chaveParticao: `${CONTA}:${CONVERSA}`, execucaoId: execucao.id });
  await fila.drenarParticao(`${CONTA}:${CONVERSA}`, 'w-morto');
  assert.equal(fila.itens.filter((j) => j.status === 'processando').length, 1);

  const r = await motor.devolverTrabalhoDoWorker('w-morto');
  assert.equal(r.jobs, 1, 'o trabalho volta para pendente');
  assert.equal(r.posses, 1, 'a posse e solta EXPLICITAMENTE, nao esperando o arrendamento vencer');
  const depois = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(depois.leaseToken, null);
  const novo = await motor.tomarPosse(execucao.id, 'w-vivo');
  assert.ok(novo, 'outro processo assume na hora, sem esperar 30 s');
  return { jobs: r.jobs, posses: r.posses, assumiuNaHora: !!novo };
});

teste('15. TELEMETRIA NAO TOCA O DOCUMENTO (D10)', async () => {
  montarPortas(); await semear();
  const fluxoAntes = await db.ragnabotFluxo.findUnique({ where: { id: 'fluxo-1' } });
  const versaoAntes = await db.ragnabotFluxoVersao.findUnique({ where: { id: 'versao-1' } });
  const carimboFluxo = fluxoAntes.atualizadoEm ?? null;
  const carimboVersao = JSON.stringify(versaoAntes.documento);

  const { execucao } = await novaExecucao();
  for (let i = 0; i < 12; i += 1) {
    await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');
    const ent = await gravarEntrada({ texto: 'xyz', cwMessageId: 400 + i, origemEm: new Date(Date.now() + 1000 + i) });
    await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [ent.id] } }, 'w1');
  }
  const fluxoDepois = await db.ragnabotFluxo.findUnique({ where: { id: 'fluxo-1' } });
  const versaoDepois = await db.ragnabotFluxoVersao.findUnique({ where: { id: 'versao-1' } });
  assert.equal(fluxoDepois.atualizadoEm ?? null, carimboFluxo, 'conversa NAO pode carimbar edicao do fluxo');
  assert.equal(JSON.stringify(versaoDepois.documento), carimboVersao, 'o documento e imutavel');
  const eventos = await db.ragnabotFluxoEvento.findMany({});
  assert.ok(eventos.length >= 10, `a telemetria foi para a tabela dela (foram ${eventos.length})`);
  return { eventos: eventos.length, fluxoIntacto: true, documentoIntacto: true };
});

teste('16. REDE DENTRO DA T1 e IMPOSSIVEL de cometer em silencio', async () => {
  montarPortas(); await semear();
  const original = NOS.texto.executar;
  NOS.texto.executar = async (ctx) => { await ctx.canal.enviar({ tipo: 'texto' }); return { tipo: 'seguir', saida: 'padrao' }; };
  const { execucao } = await novaExecucao();
  let erro = null;
  try { await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1'); } catch (e) { erro = e; }
  NOS.texto.executar = original;
  assert.ok(erro, 'tocar a rede na T1 tem de estourar');
  assert.equal(erro.codigo, 'REDE_DENTRO_DA_TRANSACAO');
  return { codigo: erro.codigo };
});

teste('17. rodadaDoExecutor: dois workers na mesma particao, um so trabalha', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await fila.enfileirar({ tipo: 'iniciar', chaveParticao: `${CONTA}:${CONVERSA}`, tenantId: TENANT, execucaoId: execucao.id });
  const token = await motor.tomarPosse(execucao.id, 'w-ocupado'); // outro processo ja esta com ela
  const r = await motor.rodadaDoExecutor({ workerId: 'w2' });
  assert.equal(r.particoes, 0, 'sem posse, nao trabalha');
  assert.equal(r.ignorados, 1);
  assert.equal(fila.itens[0].status, 'pendente', 'e NAO marca o job nem queima tentativa');
  await motor.liberarPosse(execucao.id, token);
  const r2 = await motor.rodadaDoExecutor({ workerId: 'w2' });
  assert.equal(r2.particoes, 1);
  assert.equal(fila.itens[0].status, 'feito');
  return { primeira: r, segunda: r2 };
});

teste('18. OPCAO_INVALIDA esgotada: acao final encerra E marca as entradas consumidas', async () => {
  montarPortas(); await semear();
  const { execucao } = await novaExecucao();
  await motor.processarTrabalho({ tipo: 'iniciar', execucaoId: execucao.id }, 'w1');

  const e1 = await gravarEntrada({ texto: 'nao sei', cwMessageId: 501, origemEm: new Date(Date.now() + 10) });
  await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [e1.id] } }, 'w1');
  const meio = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(meio.noAtualId, 'n3', 'primeira opcao invalida: repergunta (n3 --opcao_invalida--> n3)');

  const e2 = await gravarEntrada({ texto: 'continuo sem saber', cwMessageId: 502, origemEm: new Date(Date.now() + 20) });
  await motor.processarTrabalho({ tipo: 'entrada', execucaoId: execucao.id, payload: { entradaIds: [e2.id] } }, 'w1');
  const fim = await db.ragnabotFluxoExecucao.findUnique({ where: { id: execucao.id } });
  assert.equal(fim.estado, 'concluido', 'teto estourado: acaoFinal=encerrar');

  const brutas = await db.ragnabotFluxoEntrada.findMany({ where: { cwMessageId: { in: [501, 502] } } });
  assert.ok(brutas.every((b) => b.resultado === 'aplicado'),
    'entrada com resultado nulo pode ser reconsumida por uma execucao futura');
  const consumidas = await db.ragnabotFluxoEntradaConsumida.findMany({});
  assert.equal(consumidas.length, 2, 'as duas barreiras de consumo precisam estar gravadas');
  const inc = await db.ragnabotFluxoIncidente.findMany({ where: { codigo: 'OPCAO_INVALIDA_ESGOTADA' } });
  assert.equal(inc.length, 1);
  assert.ok(inc[0].amostras.length >= 1, 'a amostra do que a pessoa digitou e o achado');
  return { estado: fim.estado, marcadas: brutas.map((b) => b.resultado), amostra: inc[0].amostras[0] };
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
console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
