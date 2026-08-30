// Roda o CONSUMIDOR DO DESPERTAR de verdade contra um dublê de Prisma em memória.
// Nada aqui é simulado dentro do serviço: é o mesmo código, com outras portas.
//
// Cobre o que o contrato A4 exige provar:
//   1. idempotência — o mesmo trabalho entregue duas vezes NÃO manda duas mensagens;
//   2. fora da janela de 24 h — a ação de ESTADO acontece, a MENSAGEM não, e o motivo fica escrito;
//   3. partição (§5.3) — não age enquanto houver passo de fluxo vivo naquela conversa;
//   4. sem porta — degrada com aviso e não quebra.
//
// Rodar:  node tests/ragnabot-atend-despertar.test.mjs
import assert from 'node:assert/strict';
import { criarFake } from './fixtures/fake-prisma-motor.mjs';
import * as motor from '../src/services/ragnabot-fluxo-motor.service.js';
import * as despertar from '../src/services/ragnabot-atend-despertar.service.js';
import * as portaria from '../src/services/ragnabot-portaria.service.js';

const TENANT = 'tenant-1';
const CONTA = 7;
const CONVERSA = 4242;
const PARTICAO = `${CONTA}:${CONVERSA}`;
const CONTATO = '5598983351000';
const PHONE = '111222333';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O dublê de Prisma do motor não conhece as tabelas de atendimento nem a fila (ele foi escrito para
// a máquina de estado). Em vez de tocar no fixture — que é de outro dono e é usado por outros
// testes — este arquivo ACRESCENTA os modelos que faltam, com a mesma semântica de `where` que o
// serviço realmente usa: in, not, lte, lt e {increment}.
// ────────────────────────────────────────────────────────────────────────────────────────────────
function casaValor(v, cond) {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v && new Date(v).getTime() === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, alvo] of Object.entries(cond)) {
      if (op === 'in' && !alvo.includes(v)) return false;
      if (op === 'notIn' && alvo.includes(v)) return false;
      if (op === 'not' && v === alvo) return false;
      if (op === 'lt' && !(v != null && new Date(v) < new Date(alvo))) return false;
      if (op === 'lte' && !(v != null && new Date(v) <= new Date(alvo))) return false;
      if (op === 'gt' && !(v != null && new Date(v) > new Date(alvo))) return false;
      if (op === 'gte' && !(v != null && new Date(v) >= new Date(alvo))) return false;
    }
    return true;
  }
  return v === cond;
}
function casa(reg, where) {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) if (!casaValor(reg[k], cond)) return false;
  return true;
}
function aplicar(reg, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'increment' in v) {
      reg[k] = (reg[k] ?? 0) + v.increment;
    } else reg[k] = v;
  }
}
function modeloExtra(linhas) {
  const ordenar = (lista, orderBy) => {
    if (!orderBy) return lista;
    const [campo, dir] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0];
    return [...lista].sort((a, b) => {
      const cmp = new Date(a[campo] ?? 0) - new Date(b[campo] ?? 0) || String(a[campo]).localeCompare(String(b[campo]));
      return dir === 'desc' ? -cmp : cmp;
    });
  };
  return {
    linhas,
    findUnique: async ({ where }) => linhas.find((r) => casa(r, where)) ?? null,
    findFirst: async ({ where, orderBy } = {}) => ordenar(linhas.filter((r) => casa(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take } = {}) => {
      const l = ordenar(linhas.filter((r) => casa(r, where)), orderBy);
      return take ? l.slice(0, take) : l;
    },
    count: async ({ where } = {}) => linhas.filter((r) => casa(r, where)).length,
    create: async ({ data }) => { const reg = { ...data }; linhas.push(reg); return reg; },
    updateMany: async ({ where, data }) => {
      const alvo = linhas.filter((r) => casa(r, where));
      alvo.forEach((r) => aplicar(r, data));
      return { count: alvo.length };
    },
  };
}

let db; let enviados; let notas; let resolvidas; let avisosLog; let falharEnvioCom; let seqJob;

function montar({ comCanal = true, janelaAberta = true } = {}) {
  db = criarFake();
  enviados = [];
  notas = [];
  resolvidas = [];
  avisosLog = [];
  falharEnvioCom = null;
  seqJob = 1;

  db.ragnabotFluxoFila = modeloExtra([]);
  db.ragnabotAtendRelogio = modeloExtra([]);
  db.ragnabotAtendPolitica = modeloExtra([]);
  db.ragnabotInbox = modeloExtra([]);

  const canal = {
    portaDa: async () => ({
      enviar: async (intencao) => {
        if (falharEnvioCom) { const e = falharEnvioCom; falharEnvioCom = null; throw e; }
        enviados.push(intencao);
        return { idExterno: `cw-${enviados.length}` };
      },
      lerConversa: async () => ({ status: 'open', assigneeId: null }),
    }),
  };

  motor.configurarMotor({ db });
  despertar.configurarDespertar({
    db,
    log: {
      info: () => {}, debug: () => {},
      warn: (m) => avisosLog.push(String(m)),
      error: (m) => avisosLog.push(String(m)),
    },
    canal: comCanal ? canal : null,
    chatwoot: {
      notaInterna: async (n) => { notas.push(n); },
      resolver: async (r) => { resolvidas.push(r); },
    },
    janela: { avaliar: async () => ({ aberta: janelaAberta, motivo: janelaAberta ? 'aberta' : 'vencida' }) },
    relogio: { agora: () => new Date() },
  });
}

// ── semeadura ───────────────────────────────────────────────────────────────────────────────────
async function semearPolitica(extra = {}) {
  return db.ragnabotAtendPolitica.create({
    data: {
      id: 'pol-1', tenantId: TENANT, cwAccountId: CONTA, escopo: 'empresa', escopoChave: `${TENANT}:empresa`,
      ativa: true, fuso: 'America/Fortaleza', inatividadeAtiva: true, inatividadeMinutos: 30,
      inatividadeAcao: 'notificar', inatividadeMensagem: 'Ainda está aí? Se precisar, é só responder.',
      cwInboxId: 9, ...extra,
    },
  });
}
async function semearRelogio(extra = {}) {
  return db.ragnabotAtendRelogio.create({
    data: {
      id: 'rel-1', tenantId: TENANT, cwAccountId: CONTA, cwConversationId: CONVERSA, politicaId: 'pol-1',
      tipo: 'inatividade', chave: `${CONTA}:${CONVERSA}:inatividade`,
      ultimaAtividadeEm: new Date(Date.now() - 40 * 60_000), ultimaAtividadeLado: 'contato',
      venceEm: new Date(Date.now() - 60_000),
      disparadoEm: new Date('2026-08-29T12:00:00.000Z'), resultado: 'em_curso', erro: null,
      ...extra,
    },
  });
}
/** Exatamente o que `ragnabot-atendimento-worker.service.js` enfileira no ramo `acao === 'notificar'`. */
function jobDoWorker(extra = {}) {
  return db.ragnabotFluxoFila.create({
    data: {
      id: seqJob++, tipo: 'atend_relogio', chaveParticao: PARTICAO, tenantId: TENANT,
      execucaoId: null, prioridade: 80, status: 'pendente', tentativas: 0, maxTentativas: 8,
      disponivelEm: new Date(Date.now() - 1000), criadoEm: new Date(),
      payload: { acao: 'notificar', relogioId: 'rel-1', politicaId: 'pol-1', cwConversationId: CONVERSA },
      ...extra,
    },
  });
}
/** Exatamente o que `ragnabot-portaria.service.js` enfileira no ramo «só mensagem / fila humana». */
function jobDaPortaria(extra = {}) {
  const { payload: extraPayload, ...resto } = extra;
  return db.ragnabotFluxoFila.create({
    data: {
      id: seqJob++, tipo: 'atend_mensagem', chaveParticao: PARTICAO, tenantId: TENANT,
      entradaId: 'entrada-1', prioridade: 50, status: 'pendente', tentativas: 0, maxTentativas: 8,
      disponivelEm: new Date(Date.now() - 1000), criadoEm: new Date(),
      payload: {
        acao: 'mensagem_de_entrada', texto: 'Estamos fora do expediente. Voltamos às 13h.',
        motivo: 'fora_hora', cwConversationId: CONVERSA, cwInboxId: 9, encerrarApos: false,
        ...(extraPayload ?? {}),
      },
      ...resto,
    },
  });
}

async function semearExecucao(estado) {
  return db.ragnabotFluxoExecucao.create({
    data: {
      id: `exec-${estado}`, tenantId: TENANT, fluxoId: 'f1', versaoId: 'v1',
      cwAccountId: CONTA, cwConversationId: CONVERSA, contatoChave: CONTATO,
      estado, iniciadaEm: new Date(), visitaSeq: 1,
    },
  });
}

const efeitos = () => db.__tabelas.ragnabotFluxoEfeito;

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
teste('1. caminho feliz: o cliente parado recebe o «ainda está aí?» e o efeito fica confirmado', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'notificado');
  assert.equal(enviados.length, 1, 'uma mensagem, exatamente uma');
  assert.equal(enviados[0].corpo, 'Ainda está aí? Se precisar, é só responder.');
  assert.equal(enviados[0].chaveEfeito, r.chave, 'a mensagem carrega a NOSSA marca no destino');
  assert.equal(efeitos().length, 1);
  assert.equal(efeitos()[0].status, 'confirmado');
  assert.equal(efeitos()[0].politicaEmDuvida, 'seguir', 'encanamento do relógio nunca congela conversa de cliente');
  assert.equal(notas.length, 1, 'a supervisão fica sabendo');
  return { resultado: r.resultado, enviados: enviados.length, nota: notas[0].texto };
});

teste('2. IDEMPOTÊNCIA: o mesmo trabalho entregue duas vezes manda UMA mensagem só', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  const job = await jobDoWorker();

  const a = await despertar.processarDespertar(job, { workerId: 'w1' });
  const b = await despertar.processarDespertar(job, { workerId: 'w2' }); // reentrega: outro worker

  assert.equal(a.resultado, 'notificado');
  assert.equal(b.resultado, 'ja_notificado');
  assert.equal(a.chave, b.chave, 'a chave é determinística por ciclo do relógio');
  assert.equal(enviados.length, 1, 'DUAS entregas, UMA mensagem');
  assert.equal(notas.length, 1, 'a nota interna também não duplica');
  assert.equal(efeitos().length, 1);
  return { primeira: a.resultado, segunda: b.resultado, enviados: enviados.length };
});

teste('3. IDEMPOTÊNCIA entre CICLOS: relógio re-armado e disparado de novo PODE avisar de novo', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  const job1 = await jobDoWorker();
  const r1 = await despertar.processarDespertar(job1, { workerId: 'w1' });

  // ciclo novo: o trabalhador re-armou e disparou outra vez (disparadoEm muda)
  await db.ragnabotAtendRelogio.updateMany({
    where: { id: 'rel-1' }, data: { disparadoEm: new Date('2026-08-29T18:30:00.000Z'), resultado: 'em_curso' },
  });
  const job2 = await jobDoWorker();
  const r2 = await despertar.processarDespertar(job2, { workerId: 'w1' });

  assert.notEqual(r1.chave, r2.chave, 'ciclo diferente = chave diferente, senão o 2º aviso nunca sairia');
  assert.equal(r2.resultado, 'notificado');
  assert.equal(enviados.length, 2);
  return { chave1: r1.chave.slice(0, 12), chave2: r2.chave.slice(0, 12), enviados: enviados.length };
});

teste('4. FORA DA JANELA DE 24 H: a ação de estado acontece, a mensagem NÃO, e o motivo fica escrito', async () => {
  montar({ janelaAberta: false }); await semearPolitica(); await semearRelogio();
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'sem_janela');
  assert.equal(enviados.length, 0, 'nada sai para o cliente fora da janela');
  assert.equal(notas.length, 1, 'a AÇÃO DE ESTADO (a nota à supervisão) acontece assim mesmo');
  assert.match(notas[0].texto, /janela de 24 h/i, 'o motivo tem de estar legível para quem abrir a conversa');
  assert.equal(efeitos()[0].status, 'descartado');
  assert.equal(efeitos()[0].motivoDescarte, 'fora_da_janela');
  return { resultado: r.resultado, nota: notas[0].texto, efeito: efeitos()[0].status };
});

teste('5. FORA DA JANELA por RECUSA DO CANAL (janela indeterminada): mesmo desfecho, e não é erro', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  // o avaliador diz "aberta", mas a autoridade é a Meta — e ela recusou
  const recusa = new Error('24h window closed'); recusa.foraDaJanela = true;
  falharEnvioCom = recusa;
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'sem_janela', 'recusa autoritativa do canal NÃO é falha do trabalho');
  assert.equal(enviados.length, 0);
  assert.equal(efeitos()[0].motivoDescarte, 'fora_da_janela');
  assert.match(notas[0].texto, /recusa do canal/i);
  return { resultado: r.resultado, motivoDescarte: efeitos()[0].motivoDescarte };
});

teste('6. PARTIÇÃO (§5.3): execução de fluxo VIVA em "esperando" adia — nada é enviado', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  await semearExecucao('esperando');
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'adiado_particao');
  assert.equal(enviados.length, 0, 'o dono do silêncio é o nó `espera`, não o relógio');
  assert.equal(notas.length, 0);
  assert.equal(efeitos().length, 0, 'nem sequer reserva efeito: não houve tentativa de agir');
  return { resultado: r.resultado, detalhe: r.detalhe };
});

teste('7. PARTIÇÃO: "pausado_humano" LIBERA o relógio (a conversa está com gente)', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  await semearExecucao('pausado_humano');
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'notificado');
  assert.equal(enviados.length, 1);
  return { resultado: r.resultado };
});

teste('8. PARTIÇÃO: trabalho de FLUXO em "processando" na mesma partição adia (passo vivo agora)', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  await db.ragnabotFluxoFila.create({
    data: { id: 900, tipo: 'entrada', chaveParticao: PARTICAO, status: 'processando', donoWorker: 'motor-1', travadoEm: new Date(), payload: {} },
  });
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'adiado_particao');
  assert.match(r.detalhe, /passo_em_curso/);
  assert.equal(enviados.length, 0);
  return { detalhe: r.detalhe };
});

teste('9. SEM PORTA de canal: degrada com aviso, registra a nota e NÃO quebra', async () => {
  montar({ comCanal: false }); await semearPolitica(); await semearRelogio();
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'sem_porta');
  assert.equal(notas.length, 1, 'a nota interna sai mesmo sem canal');
  assert.match(notas[0].texto, /porta de canal ausente/i);
  assert.ok(avisosLog.some((m) => /porta de canal ausente/i.test(m)), 'degradar não pode ser silencioso');
  assert.equal(efeitos()[0].motivoDescarte, 'porta_ausente');
  return { resultado: r.resultado, aviso: avisosLog[0] };
});

teste('10. OBSOLETO: relógio re-armado (disparadoEm nulo) — o cliente falou antes do prazo', async () => {
  montar(); await semearPolitica(); await semearRelogio({ disparadoEm: null, resultado: null });
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'descartado_obsoleto');
  assert.equal(enviados.length, 0);
  assert.equal(efeitos().length, 0);
  return { resultado: r.resultado, detalhe: r.detalhe };
});

teste('11. trabalho que não é nosso é IGNORADO, nunca marcado como erro', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  const outro = await jobDoWorker({ id: 800, tipo: 'despertar' });
  const acaoOutra = await jobDoWorker({ id: 801, payload: { acao: 'devolver_fila', relogioId: 'rel-1' } });

  const a = await despertar.processarDespertar(outro, { workerId: 'w1' });
  const b = await despertar.processarDespertar(acaoOutra, { workerId: 'w1' });

  assert.equal(a.resultado, 'ignorado');
  assert.equal(b.resultado, 'ignorado');
  assert.equal(enviados.length, 0);
  return { porTipo: a.detalhe, porAcao: b.detalhe };
});

teste('12. RODADA: reivindica, processa, fecha — e não encosta em trabalho de outro tipo', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  const meu = await jobDoWorker();
  await db.ragnabotFluxoFila.create({
    data: { id: 950, tipo: 'entrada', chaveParticao: '9:9', status: 'pendente', disponivelEm: new Date(Date.now() - 1000), payload: {} },
  });

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.vistos, 1, 'só os `atend_relogio` são candidatos');
  assert.equal(resumo.notificados, 1);
  assert.equal(enviados.length, 1);
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === meu.id);
  assert.equal(depois.status, 'feito');
  assert.equal(depois.tentativas, 1);
  const alheio = db.ragnabotFluxoFila.linhas.find((j) => j.id === 950);
  assert.equal(alheio.status, 'pendente', 'o trabalho de fluxo continua intacto na fila do motor');
  return resumo;
});

teste('13. RODADA: fora da janela fecha o trabalho como FEITO (não reentrega 8 vezes)', async () => {
  montar({ janelaAberta: false }); await semearPolitica(); await semearRelogio();
  const meu = await jobDoWorker();

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.semJanela, 1);
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === meu.id);
  assert.equal(depois.status, 'feito', 'reentregar o que jamais pode dar certo é só barulho');
  return { resumo: { semJanela: resumo.semJanela }, status: depois.status };
});

teste('14. RODADA: adiado por partição volta para "pendente" com prazo novo, sem gastar desfecho', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  await semearExecucao('rodando');
  const meu = await jobDoWorker();
  const antes = new Date(meu.disponivelEm).getTime();

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.adiados, 1);
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === meu.id);
  assert.equal(depois.status, 'pendente');
  assert.ok(new Date(depois.disponivelEm).getTime() > antes, 'volta com prazo adiante, não em laço quente');
  assert.equal(depois.tentativas, 0, 'adiar não é defeito do trabalho: não pode gastar tentativa');
  return { adiados: resumo.adiados, status: depois.status, tentativas: depois.tentativas };
});

teste('15. RODADA: erro de envio reenfileira, e ao estourar o teto vira "falhou" (envenenado)', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  falharEnvioCom = Object.assign(new Error('Chatwoot 500'), { status: 500 });
  const meu = await jobDoWorker({ tentativas: 7 }); // a próxima é a 8ª

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.erros, 1);
  assert.equal(resumo.envenenados, 1);
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === meu.id);
  assert.equal(depois.status, 'falhou');
  assert.equal(efeitos()[0].status, 'falhou', 'o efeito registra a falha — nunca "confirmado" fantasma');
  assert.match(notas[0].texto, /NÃO saiu/);
  return { status: depois.status, efeito: efeitos()[0].status };
});

teste('16. CEIFADOR: trabalho preso em "processando" volta a ser candidato', async () => {
  montar(); await semearPolitica(); await semearRelogio();
  await jobDoWorker({ status: 'processando', donoWorker: 'morto', travadoEm: new Date(Date.now() - 30 * 60_000) });

  const r = await despertar.ceifarDespertaresPresos({ minutos: 10 });

  assert.equal(r.reabertos, 1);
  assert.equal(db.ragnabotFluxoFila.linhas[0].status, 'pendente');
  return r;
});

teste('17. o laço liga, desliga e NÃO segura o processo (unref)', async () => {
  montar();
  const desligar = despertar.iniciarConsumidorDeDespertar({ intervaloMs: 60_000 });
  assert.equal(typeof desligar, 'function');
  desligar(); // rastro limpo: nenhum timer sobra
  return { ok: true };
});

teste('18. política que age em silêncio (sem mensagem): notifica por dentro, sem texto ao cliente', async () => {
  montar(); await semearPolitica({ inatividadeMensagem: null }); await semearRelogio();
  const job = await jobDoWorker();

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'notificado');
  assert.equal(enviados.length, 0, 'mensagem vazia é configuração legítima: "age em silêncio"');
  assert.equal(notas.length, 1);
  assert.equal(efeitos()[0].motivoDescarte, 'sem_texto_configurado');
  return { resultado: r.resultado, nota: notas[0].texto };
});

teste('19. a constante de tipo é a MESMA que a portaria enfileira (duas fontes não podem divergir)', async () => {
  assert.equal(despertar.TIPO_JOB_MENSAGEM, portaria.TIPO_JOB_MENSAGEM,
    'se divergirem, a mensagem da portaria volta a ficar órfã na fila — em silêncio');
  assert.deepEqual([...despertar.TIPOS_TRATADOS], ['atend_relogio', 'atend_mensagem']);
  return { tipo: despertar.TIPO_JOB_MENSAGEM };
});

teste('20. ATEND_MENSAGEM: a mensagem da portaria é consumida e NÃO fica na fila', async () => {
  montar();
  const job = await jobDaPortaria();

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.vistos, 1);
  assert.equal(resumo.notificados, 1);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].corpo, 'Estamos fora do expediente. Voltamos às 13h.');
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === job.id);
  assert.equal(depois.status, 'feito', 'órfã na fila é exatamente o defeito que este consumidor existe para corrigir');
  assert.equal(notas.length, 0, 'saudação de fora de expediente não polui a conversa com nota interna');
  return { resumo: { vistos: resumo.vistos, notificados: resumo.notificados }, status: depois.status };
});

teste('21. ATEND_MENSAGEM: reentrega NÃO manda a mesma frase duas vezes', async () => {
  montar();
  const job = await jobDaPortaria();

  const a = await despertar.processarDespertar(job, { workerId: 'w1' });
  const b = await despertar.processarDespertar(job, { workerId: 'w2' }); // reentrega

  assert.equal(a.resultado, 'notificado');
  assert.equal(b.resultado, 'ja_notificado');
  assert.equal(a.chave, b.chave, 'a chave é a ENTRADA, e a entrada é a mesma');
  assert.equal(enviados.length, 1, 'DUAS entregas, UMA mensagem');
  assert.equal(efeitos().length, 1);
  return { primeira: a.resultado, segunda: b.resultado, enviados: enviados.length };
});

teste('22. ATEND_MENSAGEM: entrada DIFERENTE gera chave diferente (o 2º cliente também é atendido)', async () => {
  montar();
  await despertar.processarDespertar(await jobDaPortaria(), { workerId: 'w1' });
  await despertar.processarDespertar(await jobDaPortaria({ entradaId: 'entrada-2' }), { workerId: 'w1' });
  assert.equal(enviados.length, 2, 'idempotência por entrada não pode virar mordaça');
  return { enviados: enviados.length };
});

teste('23. ATEND_MENSAGEM fora da janela: a AÇÃO DE ESTADO (encerrar) acontece, a mensagem não', async () => {
  montar({ janelaAberta: false });
  const job = await jobDaPortaria({ payload: { encerrarApos: true } });

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'sem_janela');
  assert.equal(enviados.length, 0);
  assert.equal(resolvidas.length, 1, '§5.6: a ação de estado acontece mesmo sem a mensagem');
  assert.equal(notas.length, 1);
  assert.match(notas[0].texto, /janela de 24 h/i);
  assert.match(notas[0].texto, /encerrada automaticamente/i);
  assert.equal(efeitos()[0].motivoDescarte, 'fora_da_janela');
  return { resultado: r.resultado, resolvidas: resolvidas.length, nota: notas[0].texto };
});

teste('24. ATEND_MENSAGEM com encerrarApos na janela: fala e depois encerra, nessa ordem', async () => {
  montar();
  const job = await jobDaPortaria({ payload: { texto: 'Até logo!', motivo: 'despedida_espera', encerrarApos: true } });

  const r = await despertar.processarDespertar(job, { workerId: 'w1' });

  assert.equal(r.resultado, 'notificado');
  assert.equal(enviados.length, 1);
  assert.equal(resolvidas.length, 1);
  return { resultado: r.resultado, texto: enviados[0].corpo };
});

teste('25. ATEND_MENSAGEM velha na fila é DESCARTADA — «voltamos às 13h» às 16h é pior que nada', async () => {
  montar();
  const job = await jobDaPortaria({ criadoEm: new Date(Date.now() - 3 * 60 * 60_000) });

  const resumo = await despertar.rodadaDeDespertar({ workerId: 'w1' });

  assert.equal(resumo.obsoletos, 1);
  assert.equal(enviados.length, 0);
  const depois = db.ragnabotFluxoFila.linhas.find((j) => j.id === job.id);
  assert.equal(depois.status, 'descartado');
  return { obsoletos: resumo.obsoletos, status: depois.status };
});

teste('26. ATEND_MENSAGEM: partição e ausência de porta valem igual para os dois tipos', async () => {
  montar(); await semearExecucao('esperando');
  const a = await despertar.processarDespertar(await jobDaPortaria(), { workerId: 'w1' });
  assert.equal(a.resultado, 'adiado_particao');
  assert.equal(enviados.length, 0);

  montar({ comCanal: false });
  const b = await despertar.processarDespertar(await jobDaPortaria(), { workerId: 'w1' });
  assert.equal(b.resultado, 'sem_porta');
  assert.match(notas[0].texto, /porta de canal ausente/i);
  assert.equal(efeitos()[0].motivoDescarte, 'porta_ausente');
  return { particao: a.resultado, semPorta: b.resultado };
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
