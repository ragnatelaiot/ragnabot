// Roda o trabalhador de automações de atendimento DE VERDADE contra um dublê de Prisma em memória
// e uma porta de Chatwoot falsa. Nada é simulado dentro do serviço: é o mesmo código, com outras
// portas — igual ao teste do motor de fluxo.
//
// O que este arquivo prova, e por que cada prova existe:
//   1. o expediente com INTERVALO (08–12 e 13–18), que é impossível no modelo do Chatwoot
//   2. o plantão que CRUZA A MEIA-NOITE
//   3. o prazo que começa às 17h50 e NÃO vence às 3 da manhã (a armadilha A1)
//   4. a herança empresa → caixa → time, com o booleano que não pode ser sobrescrito por padrão
//   5. de quem é o silêncio: contato, atendente, qualquer
//   6. o relógio que NÃO arma enquanto o fluxo do robô está vivo (a armadilha A2)
//   7. dois trabalhadores ao mesmo tempo produzindo UMA ação (a armadilha A3, camada a)
//   8. o cliente que respondeu antes do prazo: descarte e re-armação
//   9. a queda no meio da ação: ceifador reabre e a segunda passada CONVERGE sem repetir a mensagem
//  10. a virada do expediente: primeira observação não avisa; a virada avisa uma vez por dia
//  11. a pausa de emergência que vence sozinha
import assert from 'node:assert/strict';
import * as w from '../src/services/ragnabot-atendimento-worker.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DUBLÊ DE PRISMA — só o suficiente, e com o índice único que o banco tem
// ────────────────────────────────────────────────────────────────────────────────────────────────
const MODELOS = [
  'ragnabotAtendPolitica', 'ragnabotAtendExpediente', 'ragnabotAtendExcecaoData',
  'ragnabotAtendRelogio', 'ragnabotAtendTransferencia', 'ragnabotAuditoria', 'ragnabotFluxoExecucao',
];
const UNICOS = { ragnabotAtendRelogio: ['chave'] };

function casaValor(v, cond) {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v != null && new Date(v).getTime() === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, alvo] of Object.entries(cond)) {
      if (op === 'in' && !alvo.includes(v)) return false;
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
const casa = (reg, where) => !where || Object.entries(where).every(([k, c]) => casaValor(reg[k], c));

function ordenar(linhas, orderBy) {
  if (!orderBy) return linhas;
  const [campo, dir] = Object.entries(orderBy)[0];
  return [...linhas].sort((a, b) => {
    const x = a[campo] == null ? 0 : new Date(a[campo]).getTime();
    const y = b[campo] == null ? 0 : new Date(b[campo]).getTime();
    return dir === 'desc' ? y - x : x - y;
  });
}

function criarDb() {
  const t = Object.fromEntries(MODELOS.map((m) => [m, []]));
  let seq = 0;
  const conferirUnico = (nome, reg, ignorarId = null) => {
    for (const campo of (UNICOS[nome] || [])) {
      if (t[nome].some((r) => r.id !== ignorarId && r[campo] === reg[campo])) {
        const e = new Error(`Unique constraint failed on the fields: (\`${campo}\`)`);
        e.code = 'P2002';
        throw e;
      }
    }
  };
  const modelo = (nome) => ({
    findMany: async ({ where, orderBy, take } = {}) => {
      const r = ordenar(t[nome].filter((x) => casa(x, where)), orderBy);
      return take ? r.slice(0, take) : r;
    },
    findFirst: async ({ where, orderBy } = {}) => ordenar(t[nome].filter((x) => casa(x, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }) => t[nome].find((x) => casa(x, where)) ?? null,
    create: async ({ data }) => {
      seq += 1;
      const reg = { id: data.id ?? `${nome}-${seq}`, criadoEm: new Date(), ...data };
      conferirUnico(nome, reg);
      t[nome].push(reg);
      return reg;
    },
    update: async ({ where, data }) => {
      const reg = t[nome].find((x) => casa(x, where));
      if (!reg) throw new Error(`update sem alvo em ${nome}`);
      Object.assign(reg, data, { atualizadoEm: new Date() });
      return reg;
    },
    updateMany: async ({ where, data }) => {
      const alvos = t[nome].filter((x) => casa(x, where));
      alvos.forEach((r) => Object.assign(r, data, { atualizadoEm: new Date() }));
      return { count: alvos.length };
    },
    upsert: async ({ where, create, update }) => {
      const reg = t[nome].find((x) => casa(x, where));
      if (reg) { Object.assign(reg, update, { atualizadoEm: new Date() }); return reg; }
      seq += 1;
      const novo = { id: `${nome}-${seq}`, criadoEm: new Date(), ...create };
      conferirUnico(nome, novo);
      t[nome].push(novo);
      return novo;
    },
  });
  const cliente = Object.fromEntries(MODELOS.map((m) => [m, modelo(m)]));
  cliente.__tabelas = t;
  return cliente;
}

const silencioso = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── ajudantes de fuso: escrever a hora local pretendida sem contar 3 horas na cabeça ────────────
const FUSO = 'America/Fortaleza';
const local = (ano, mes, dia, hora, minuto = 0) => w.instanteDe({ ano, mes, dia, minutoDoDia: hora * 60 + minuto }, FUSO);
const horaLocal = (d) => {
  const p = w.partesNoFuso(d, FUSO);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')} ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};

// Expediente comercial clássico COM ALMOÇO: 08–12 e 13–18, de segunda a sexta.
const JANELAS_COMERCIAIS = [];
for (let d = 1; d <= 5; d += 1) {
  JANELAS_COMERCIAIS.push({ politicaId: 'p-empresa', diaSemana: d, abreMin: 480, fechaMin: 720, rotulo: 'manhã', ativo: true });
  JANELAS_COMERCIAIS.push({ politicaId: 'p-empresa', diaSemana: d, abreMin: 780, fechaMin: 1080, rotulo: 'tarde', ativo: true });
}
const CTX_COMERCIAL = { fuso: FUSO, janelas: JANELAS_COMERCIAIS, excecoes: [], contaForaExpediente: false };

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. EXPEDIENTE COM INTERVALO — o que o modelo do Chatwoot não consegue representar
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('expediente: aberto de manhã, INTERVALO no almoço, fora de hora à noite', () => {
  // 2026-08-31 é uma segunda-feira.
  const manha = w.avaliarExpediente(CTX_COMERCIAL, local(2026, 8, 31, 10, 0));
  assert.equal(manha.aberto, true);
  assert.equal(manha.motivo, 'aberto');
  assert.equal(horaLocal(manha.fechaEm), '2026-08-31 12:00');

  const almoco = w.avaliarExpediente(CTX_COMERCIAL, local(2026, 8, 31, 12, 30));
  assert.equal(almoco.aberto, false);
  assert.equal(almoco.motivo, 'intervalo', 'almoço NÃO é "estamos fechados" — é intervalo');
  assert.equal(horaLocal(almoco.proximaAbertura), '2026-08-31 13:00');

  const noite = w.avaliarExpediente(CTX_COMERCIAL, local(2026, 8, 31, 19, 0));
  assert.equal(noite.motivo, 'fora_hora');
  assert.equal(horaLocal(noite.proximaAbertura), '2026-09-01 08:00', 'a próxima abertura é a manhã seguinte');

  const domingo = w.avaliarExpediente(CTX_COMERCIAL, local(2026, 8, 30, 10, 0));
  assert.equal(domingo.aberto, false);
  assert.equal(horaLocal(domingo.proximaAbertura), '2026-08-31 08:00');
});

teste('expediente: feriado recorrente fecha o dia e a próxima abertura pula para o dia seguinte', () => {
  const ctx = {
    ...CTX_COMERCIAL,
    excecoes: [{ politicaId: 'p-empresa', chaveData: '*-12-25', tipo: 'fechado', rotulo: 'Natal' }],
  };
  // 2026-12-25 é uma sexta-feira: sem a exceção, estaria aberto às 10h.
  const semExcecao = w.avaliarExpediente(CTX_COMERCIAL, local(2026, 12, 25, 10, 0));
  assert.equal(semExcecao.aberto, true, 'controle: sem feriado cadastrado a sexta está aberta');

  const natal = w.avaliarExpediente(ctx, local(2026, 12, 25, 10, 0));
  assert.equal(natal.aberto, false);
  assert.equal(natal.motivo, 'feriado');
  assert.equal(natal.rotulo, 'Natal');
  assert.equal(horaLocal(natal.proximaAbertura), '2026-12-28 08:00', 'pula o feriado E o fim de semana');
});

teste('expediente: a exceção de DATA FIXA vence a recorrente', () => {
  const ctx = {
    ...CTX_COMERCIAL,
    excecoes: [
      { chaveData: '*-12-25', tipo: 'fechado', rotulo: 'Natal' },
      { chaveData: '2026-12-25', tipo: 'janela_especial', abreMin: 480, fechaMin: 720, rotulo: 'plantão de Natal' },
    ],
  };
  const r = w.avaliarExpediente(ctx, local(2026, 12, 25, 10, 0));
  assert.equal(r.aberto, true, 'a decisão específica daquele ano tem de vencer a regra geral');
  assert.equal(horaLocal(w.avaliarExpediente(ctx, local(2026, 12, 25, 13, 0)).proximaAbertura), '2026-12-28 08:00');
});

teste('expediente: plantão que CRUZA A MEIA-NOITE é uma janela só, e não some', () => {
  // Sexta 22:00 → sábado 02:00. fechaMin (120) <= abreMin (1320) declara a virada do dia.
  const ctx = { fuso: FUSO, janelas: [{ diaSemana: 5, abreMin: 1320, fechaMin: 120, rotulo: 'plantão', ativo: true }], excecoes: [] };
  assert.equal(w.avaliarExpediente(ctx, local(2026, 8, 28, 23, 0)).aberto, true, 'sexta 23h: dentro');
  const madrugada = w.avaliarExpediente(ctx, local(2026, 8, 29, 0, 30));
  assert.equal(madrugada.aberto, true, 'sábado 00h30 ainda é o plantão de sexta');
  assert.equal(w.avaliarExpediente(ctx, local(2026, 8, 29, 3, 0)).aberto, false, 'sábado 03h: fechou');
});

teste('expediente: política SEM nenhuma janela cadastrada é SEMPRE ABERTA, nunca sempre fechada', () => {
  const r = w.avaliarExpediente({ fuso: FUSO, janelas: [], excecoes: [] }, local(2026, 8, 31, 3, 0));
  assert.equal(r.aberto, true, 'uma política recém-criada não pode calar o atendimento da empresa');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. ARMADILHA A1 — o prazo que começa às 17h50 não pode vencer às 3 da manhã
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('minutos úteis: 30 min a partir de 17h50 vencem às 08h20 do dia seguinte', () => {
  const inicio = local(2026, 8, 31, 17, 50); // segunda
  const vence = w.somarMinutosUteis(inicio, 30, CTX_COMERCIAL);
  assert.equal(horaLocal(vence), '2026-09-01 08:20',
    '10 minutos são consumidos até as 18h; os outros 20 correm a partir da abertura do dia seguinte');
});

teste('minutos úteis: o almoço não conta — 60 min a partir de 11h30 vencem às 13h30', () => {
  const vence = w.somarMinutosUteis(local(2026, 8, 31, 11, 30), 60, CTX_COMERCIAL);
  assert.equal(horaLocal(vence), '2026-08-31 13:30');
});

teste('minutos úteis: sexta 17h50 atravessa o FIM DE SEMANA inteiro', () => {
  const vence = w.somarMinutosUteis(local(2026, 8, 28, 17, 50), 30, CTX_COMERCIAL); // sexta
  assert.equal(horaLocal(vence), '2026-08-31 08:20', 'segunda de manhã, não sábado de madrugada');
});

teste('minutos úteis: com contaForaExpediente o relógio corre 24h — quem quer isso, tem', () => {
  const ctx = { ...CTX_COMERCIAL, contaForaExpediente: true };
  assert.equal(horaLocal(w.somarMinutosUteis(local(2026, 8, 31, 17, 50), 30, ctx)), '2026-08-31 18:20');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. HERANÇA DE POLÍTICA — o booleano que não pode ser sobrescrito pelo padrão do banco
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('herança: o campo do time vence o da empresa quando o time o DECLAROU', () => {
  const empresa = { id: 'e', escopo: 'empresa', escopoChave: 'empresa', inatividadeAtiva: true, inatividadeMinutos: 30, msgForaExpediente: 'Fechado.' };
  const time = { id: 't', escopo: 'time', escopoChave: 'time:7', inatividadeMinutos: 10, camposDefinidos: ['inatividadeMinutos'] };
  const r = w.mesclarPoliticas([empresa, time]);
  assert.equal(r.inatividadeMinutos, 10, 'o setor declarou 10 minutos');
  assert.equal(r.inatividadeAtiva, true, 'o que o setor não declarou continua vindo da empresa');
  assert.equal(r.msgForaExpediente, 'Fechado.');
  assert.equal(r.id, 't', 'a identidade é a da camada mais específica');
});

teste('herança: o "false" que veio do PADRÃO do banco não desliga o relógio da empresa', () => {
  const empresa = { id: 'e', escopo: 'empresa', inatividadeAtiva: true, inatividadeMinutos: 30 };
  // Linha de time recém-criada: `inatividadeAtiva` chega como `false` por @default(false), e a tela
  // não registrou o campo em camposDefinidos porque o administrador não o tocou.
  const time = { id: 't', escopo: 'time', inatividadeAtiva: false, camposDefinidos: ['transbordoAtivo'] };
  const r = w.mesclarPoliticas([empresa, time]);
  assert.equal(r.inatividadeAtiva, true,
    'sem esta regra, criar a política de um setor desligaria o relógio dele sem ninguém ter pedido');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. DE QUEM É O SILÊNCIO — a escolha que o dono citou nominalmente
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('lado do silêncio: contato, atendente e qualquer medem coisas diferentes', () => {
  const t0 = new Date('2026-08-31T13:00:00Z');
  const t1 = new Date('2026-08-31T13:20:00Z');

  // O CONTATO falou e ninguém respondeu: waitingSince preenchido.
  const esperando = { lastActivityAt: t1, waitingSince: t1 };
  assert.equal(w.ladoDoSilencio(esperando, 'atendente').desde.getTime(), t1.getTime(),
    'o silêncio do atendente é medido desde quando o cliente começou a esperar');
  assert.equal(w.ladoDoSilencio(esperando, 'contato'), null,
    'não há silêncio do contato: a bola está com o atendente');

  // O ATENDENTE respondeu: waitingSince zerado.
  const respondida = { lastActivityAt: t1, waitingSince: null, firstReplyCreatedAt: t0 };
  assert.equal(w.ladoDoSilencio(respondida, 'contato').desde.getTime(), t1.getTime());
  assert.equal(w.ladoDoSilencio(respondida, 'atendente'), null);
  assert.equal(w.ladoDoSilencio(respondida, 'qualquer').desde.getTime(), t1.getTime());
  assert.equal(w.ladoDoSilencio(esperando, 'qualquer').desde.getTime(), t1.getTime());
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. ARMADILHA A2 — o relógio não arma enquanto o fluxo do robô está vivo
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('§5.3: com o fluxo rodando ou esperando resposta, o relógio de atendimento NÃO manda', () => {
  assert.equal(w.podeArmarRelogio(null), true, 'sem fluxo nenhum, a conversa é de humano');
  assert.equal(w.podeArmarRelogio({ estado: 'rodando' }), false);
  assert.equal(w.podeArmarRelogio({ estado: 'esperando' }), false,
    'aqui o prazo é do nó `espera`; dois donos do mesmo silêncio produzem duas mensagens');
  assert.equal(w.podeArmarRelogio({ estado: 'pausado_duvida' }), false);
  assert.equal(w.podeArmarRelogio({ estado: 'pausado_humano' }), true, 'o robô entregou para gente');
  assert.equal(w.podeArmarRelogio({ estado: 'concluido' }), true);
  assert.equal(w.podeArmarRelogio({ estado: 'abandonado' }), true,
    'execução transferida termina como concluído/abandonado — "transferido" é motivoFim, não estado');
});

teste('convergência de estado: já está no alvo ⇒ a ação é dada por cumprida', () => {
  assert.equal(w.estadoAlvoJaAtingido({ status: 'pending', cwAssigneeId: null }, 'devolver_fila'), true);
  assert.equal(w.estadoAlvoJaAtingido({ status: 'pending', cwAssigneeId: 9 }, 'devolver_fila'), false);
  assert.equal(w.estadoAlvoJaAtingido({ status: 'open' }, 'devolver_fila'), false);
  assert.equal(w.estadoAlvoJaAtingido({ status: 'resolved' }, 'resolver'), true);
  assert.equal(w.estadoAlvoJaAtingido({ cwTeamId: 7 }, 'transferir_time', 7), true);
  assert.equal(w.estadoAlvoJaAtingido({ cwTeamId: 3 }, 'transferir_time', 7), false);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. O TRABALHADOR INTEIRO — banco em memória, Chatwoot falso, relógio controlado
// ════════════════════════════════════════════════════════════════════════════════════════════════

const POLITICA_BASE = {
  id: 'p-empresa', tenantId: 't1', cwAccountId: 1, escopo: 'empresa', escopoChave: 'empresa',
  ativa: true, fuso: FUSO,
  inatividadeAtiva: true, inatividadeMinutos: 30, inatividadeConta: 'contato',
  inatividadeAcao: 'devolver_fila', inatividadeMensagem: 'Ficamos sem resposta e devolvemos seu atendimento para a fila.',
  inatividadeContaForaExpediente: false,
  transbordoAtivo: false, encerrarAposForaExpediente: false, distribuicaoPausada: false,
  msgForaExpediente: 'Nosso expediente encerrou. Voltamos amanhã às 8h.',
  msgIntervalo: 'Estamos no intervalo do almoço. Voltamos às 13h.',
};

function montarMundo({ instante, politica = {}, conversas = [], janelas = JANELAS_COMERCIAIS }) {
  const db = criarDb();
  db.__tabelas.ragnabotAtendPolitica.push({ ...POLITICA_BASE, ...politica });
  janelas.forEach((j, i) => db.__tabelas.ragnabotAtendExpediente.push({ id: `j${i}`, ...j, politicaId: 'p-empresa' }));

  const mundo = {
    db, agora: instante,
    conversas: new Map(conversas.map((c) => [c.id, { cwAccountId: 1, status: 'open', ...c }])),
    chamadas: { devolverParaFila: [], transferirTime: [], resolver: [], mensagens: [], notas: [] },
  };

  const chatwoot = {
    conversasEmAtendimento: async ({ cwAccountId }) => [...mundo.conversas.values()].filter((c) => c.cwAccountId === cwAccountId),
    lerConversa: async ({ cwConversationId }) => mundo.conversas.get(cwConversationId) ?? null,
    devolverParaFila: async (a) => {
      mundo.chamadas.devolverParaFila.push(a);
      const c = mundo.conversas.get(a.cwConversationId);
      // O dublê reflete o efeito REAL da ação: é isso que permite provar a convergência depois.
      if (c) { c.status = 'pending'; c.cwAssigneeId = null; }
    },
    transferirTime: async (a) => {
      mundo.chamadas.transferirTime.push(a);
      const c = mundo.conversas.get(a.cwConversationId);
      if (c) c.cwTeamId = a.cwTeamId;
    },
    resolver: async (a) => {
      mundo.chamadas.resolver.push(a);
      const c = mundo.conversas.get(a.cwConversationId);
      if (c) c.status = 'resolved';
    },
    enviarMensagem: async (a) => { mundo.chamadas.mensagens.push(a); return { ok: true }; },
    notaInterna: async (a) => { mundo.chamadas.notas.push(a); },
  };

  w.configurarTrabalhador({
    db, chatwoot, log: silencioso, relogio: { agora: () => mundo.agora },
    fila: null, politicas: null, auditoria: null,
  });
  return mundo;
}

const relogiosDe = (mundo, tipo) => mundo.db.__tabelas.ragnabotAtendRelogio.filter((r) => r.tipo === tipo);

teste('ponta a ponta: arma o relógio, vence, devolve para a fila e avisa o cliente UMA vez', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 4242, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });

  const r1 = await w.reconciliarRelogios();
  assert.equal(r1.armados, 1, 'um relógio de inatividade armado');
  const rel = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(horaLocal(rel.venceEm), '2026-08-31 09:30');
  assert.equal(rel.pausadoMotivo, null, 'às 9h da segunda o expediente está aberto');

  // Ainda não venceu: nada acontece.
  mundo.agora = local(2026, 8, 31, 9, 29);
  assert.deepEqual((await w.dispararVencidos()).vistos, 0);
  assert.equal(mundo.chamadas.devolverParaFila.length, 0);

  // Venceu.
  mundo.agora = local(2026, 8, 31, 9, 31);
  const d = await w.dispararVencidos();
  assert.equal(d.aplicados, 1);
  assert.equal(mundo.chamadas.devolverParaFila.length, 1);
  assert.equal(mundo.chamadas.mensagens.length, 1);
  assert.match(mundo.chamadas.mensagens[0].texto, /devolvemos seu atendimento para a fila/);
  assert.equal(mundo.conversas.get(4242).status, 'pending');

  const depois = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(depois.resultado, 'aplicado');
  assert.ok(depois.disparadoEm, 'o disparo fica carimbado na linha');

  // ⭐ E NÃO REPETE. A varredura seguinte não pode re-armar um relógio já disparado sem atividade
  // nova — foi o defeito que este teste encontrou.
  mundo.agora = local(2026, 8, 31, 9, 32);
  await w.reconciliarRelogios();
  await w.dispararVencidos();
  assert.equal(mundo.chamadas.devolverParaFila.length, 1, 'a ação continua tendo acontecido UMA vez');
  assert.equal(mundo.chamadas.mensagens.length, 1);

  const auditoria = mundo.db.__tabelas.ragnabotAuditoria.filter((a) => a.acao === 'atendimento.relogio.inatividade');
  assert.equal(auditoria.length, 1, 'o disparo foi auditado exatamente uma vez');
  assert.equal(auditoria[0].atorTipo, 'sistema');
});

teste('a conversa da noite NÃO é devolvida de madrugada: o relógio congela e o motivo fica escrito', async () => {
  const t1750 = local(2026, 8, 31, 17, 50);
  const mundo = montarMundo({
    instante: t1750,
    conversas: [{ id: 77, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t1750, waitingSince: null, firstReplyCreatedAt: t1750 }],
  });
  await w.reconciliarRelogios();
  const rel = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(horaLocal(rel.venceEm), '2026-09-01 08:20', 'o prazo pulou a noite inteira');

  // Às 3 da manhã ninguém é incomodado.
  mundo.agora = local(2026, 9, 1, 3, 0);
  const d = await w.dispararVencidos();
  assert.equal(d.vistos, 0, 'não há relógio vencido às 3h — este é o defeito que o documento chama de A1');
  assert.equal(mundo.chamadas.mensagens.length, 0);

  // Às 8h21 do dia seguinte, sim.
  mundo.agora = local(2026, 9, 1, 8, 21);
  assert.equal((await w.dispararVencidos()).aplicados, 1);
  assert.equal(mundo.chamadas.devolverParaFila.length, 1);
});

teste('fora de expediente por mudança tardia: o disparo RECUSA e adia para a próxima abertura', async () => {
  const t1150 = local(2026, 8, 31, 11, 50);
  const mundo = montarMundo({
    instante: t1150,
    conversas: [{ id: 88, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t1150, waitingSince: null, firstReplyCreatedAt: t1150 }],
  });
  await w.reconciliarRelogios();
  // Alguém força o prazo para dentro do almoço (é o que um feriado cadastrado depois faria).
  const rel = relogiosDe(mundo, 'inatividade')[0];
  rel.venceEm = local(2026, 8, 31, 12, 30);

  mundo.agora = local(2026, 8, 31, 12, 31);
  const d = await w.dispararVencidos();
  assert.equal(d.recusados, 1);
  assert.equal(mundo.chamadas.devolverParaFila.length, 0, 'ninguém é devolvido para a fila no almoço');
  const depois = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(depois.disparadoEm, null, 'a reserva foi revertida: nada saiu para fora');
  assert.equal(depois.pausadoMotivo, 'intervalo');
  assert.equal(horaLocal(depois.venceEm), '2026-08-31 13:00');
});

teste('dois trabalhadores ao mesmo tempo produzem UMA ação (reserva condicional)', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 5, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  await w.reconciliarRelogios();
  mundo.agora = local(2026, 8, 31, 9, 31);

  const [a, b] = await Promise.all([
    w.dispararVencidos({ workerId: 'pod-a' }),
    w.dispararVencidos({ workerId: 'pod-b' }),
  ]);
  assert.equal(a.aplicados + b.aplicados, 1, 'só um dos dois aplicou');
  assert.equal(a.disputados + b.disputados, 1, 'o outro viu a linha já reservada e seguiu em frente');
  assert.equal(mundo.chamadas.devolverParaFila.length, 1);
  assert.equal(mundo.chamadas.mensagens.length, 1, 'e o cliente recebeu UMA mensagem');
});

teste('o cliente respondeu antes do prazo: descarta o despertar e re-arma', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 9, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  await w.reconciliarRelogios();

  // O cliente falou às 9h29 — e a varredura não chegou a rodar entre a fala e o vencimento.
  mundo.conversas.get(9).lastActivityAt = local(2026, 8, 31, 9, 29);
  mundo.agora = local(2026, 8, 31, 9, 31);

  const d = await w.dispararVencidos();
  assert.equal(d.obsoletos, 1);
  assert.equal(d.aplicados, 0);
  assert.equal(mundo.chamadas.devolverParaFila.length, 0, 'quem acabou de falar não vai para a fila');
  const rel = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(rel.disparadoEm, null);
  assert.equal(horaLocal(rel.venceEm), '2026-08-31 09:59', 'o prazo foi recontado a partir da fala nova');
});

teste('queda no meio da ação: o ceifador reabre e a segunda passada CONVERGE sem repetir a mensagem', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    // A conversa JÁ está `pending`: a ação chegou a acontecer antes de o processo morrer.
    conversas: [{ id: 31, cwInboxId: 1, cwAssigneeId: null, status: 'pending', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  // Estado deixado por um trabalhador que morreu entre reservar e fechar o disparo.
  mundo.db.__tabelas.ragnabotAtendRelogio.push({
    id: 'r-preso', chave: '1:31:inatividade', tenantId: 't1', cwAccountId: 1, cwConversationId: 31,
    politicaId: 'p-empresa', tipo: 'inatividade',
    ultimaAtividadeEm: t09, ultimaAtividadeLado: 'atendente',
    venceEm: local(2026, 8, 31, 9, 30),
    disparadoEm: local(2026, 8, 31, 9, 31), resultado: 'em_curso', erro: 'worker:pod-morto',
  });

  mundo.agora = local(2026, 8, 31, 9, 45); // 14 minutos depois: passou do prazo do ceifador
  const c = await w.ceifarDisparosPresos();
  assert.equal(c.reabertos, 1, 'trabalho preso não pode ser abandonado: é uma conversa parada');

  const d = await w.dispararVencidos();
  assert.equal(d.aplicados, 1);
  assert.equal(mundo.chamadas.devolverParaFila.length, 0, 'a plataforma NÃO foi tocada de novo');
  assert.equal(mundo.chamadas.mensagens.length, 0, '⭐ e o cliente NÃO recebeu a mensagem duas vezes');
  const rel = mundo.db.__tabelas.ragnabotAtendRelogio.find((r) => r.id === 'r-preso');
  assert.equal(rel.resultado, 'aplicado');
  assert.match(rel.erro, /estado-alvo já atingido/);
});

teste('aviso prévio sai ANTES da ação, e cada um sai uma vez só', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: { inatividadeAvisoMinutos: 20, inatividadeAvisoMensagem: 'Você ainda está aí?' },
    conversas: [{ id: 12, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  await w.reconciliarRelogios();
  assert.equal(relogiosDe(mundo, 'aviso').length, 1);
  assert.equal(horaLocal(relogiosDe(mundo, 'aviso')[0].venceEm), '2026-08-31 09:20');

  mundo.agora = local(2026, 8, 31, 9, 21);
  await w.dispararVencidos();
  assert.equal(mundo.chamadas.mensagens.length, 1);
  assert.equal(mundo.chamadas.mensagens[0].texto, 'Você ainda está aí?');
  assert.equal(mundo.chamadas.devolverParaFila.length, 0, 'avisar não é agir');

  // Varreduras seguintes, com o cliente ainda calado: o aviso NÃO se repete.
  for (const m of [22, 23, 24]) {
    mundo.agora = local(2026, 8, 31, 9, m);
    await w.reconciliarRelogios();
    await w.dispararVencidos();
  }
  assert.equal(mundo.chamadas.mensagens.length, 1, '⭐ "ainda está aí?" uma vez, não a cada 60 segundos');

  // E a ação vem no prazo dela.
  mundo.agora = local(2026, 8, 31, 9, 31);
  await w.reconciliarRelogios();
  await w.dispararVencidos();
  assert.equal(mundo.chamadas.devolverParaFila.length, 1);
  assert.equal(mundo.chamadas.mensagens.length, 2);
});

teste('aviso configurado depois da ação é ignorado — configuração assim é engano', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: { inatividadeAvisoMinutos: 45, inatividadeAvisoMensagem: 'Ainda aí?' },
    conversas: [{ id: 13, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  await w.reconciliarRelogios();
  assert.equal(relogiosDe(mundo, 'aviso').length, 0,
    'aviso de 45 min com ação de 30 min sairia depois da devolução para a fila');
});

teste('o fluxo do robô está vivo: o relógio existe, mas congelado e com o motivo escrito', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 21, cwInboxId: 1, cwAssigneeId: null, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: null }],
  });
  mundo.db.__tabelas.ragnabotFluxoExecucao.push({
    id: 'x1', tenantId: 't1', cwAccountId: 1, cwConversationId: 21, estado: 'esperando',
  });
  await w.reconciliarRelogios();
  const rel = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(rel.pausadoMotivo, 'fluxo_ativo',
    'sem isto o cliente lê "não entendi, escolha uma opção" e "ainda está aí?" no mesmo minuto');

  // Mesmo forçando o vencimento, o disparo recusa enquanto o fluxo estiver vivo.
  rel.venceEm = local(2026, 8, 31, 9, 1);
  mundo.agora = local(2026, 8, 31, 9, 2);
  const d = await w.dispararVencidos();
  assert.equal(d.recusados, 1);
  assert.equal(mundo.chamadas.mensagens.length, 0);

  // O robô entregou para gente: agora o relógio vale.
  mundo.db.__tabelas.ragnabotFluxoExecucao[0].estado = 'pausado_humano';
  await w.reconciliarRelogios();
  assert.equal(relogiosDe(mundo, 'inatividade')[0].pausadoMotivo, null);
});

teste('transbordo: ninguém assumiu em X minutos, a conversa muda de setor e fica registrada', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: {
      inatividadeAtiva: false,
      transbordoAtivo: true, transbordoMinutos: 15, transbordoTimeId: 7,
      transbordoMensagem: 'Encaminhamos você para outro setor.',
    },
    conversas: [{ id: 55, cwInboxId: 1, cwAssigneeId: null, cwTeamId: 3, status: 'pending', waitingSince: t09, lastActivityAt: t09, firstReplyCreatedAt: null }],
  });
  await w.reconciliarRelogios();
  assert.equal(horaLocal(relogiosDe(mundo, 'transbordo')[0].venceEm), '2026-08-31 09:15');

  mundo.agora = local(2026, 8, 31, 9, 16);
  assert.equal((await w.dispararVencidos()).aplicados, 1);
  assert.equal(mundo.chamadas.transferirTime.length, 1);
  assert.equal(mundo.chamadas.transferirTime[0].cwTeamId, 7);

  const t = mundo.db.__tabelas.ragnabotAtendTransferencia[0];
  assert.equal(t.deTipo, 'time'); assert.equal(t.deId, 3);
  assert.equal(t.paraTipo, 'time'); assert.equal(t.paraId, 7);
  assert.equal(t.origem, 'transbordo');
  assert.equal(t.motivo, 'tempo em fila excedido',
    '«por que essa conversa mudou de setor às 14h32» tem de ter resposta sem cruzar três logs');
});

teste('transbordo: alguém assumiu antes ⇒ o ciclo encerra sem ação (não se rouba a conversa de quem assumiu)', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: { inatividadeAtiva: false, transbordoAtivo: true, transbordoMinutos: 15, transbordoTimeId: 7 },
    conversas: [{ id: 56, cwInboxId: 1, cwAssigneeId: null, cwTeamId: 3, status: 'pending', waitingSince: t09, lastActivityAt: t09 }],
  });
  await w.reconciliarRelogios();
  mundo.conversas.get(56).cwAssigneeId = 42; // a analista assumiu
  mundo.conversas.get(56).status = 'open';
  mundo.agora = local(2026, 8, 31, 9, 10);
  const r = await w.reconciliarRelogios();
  assert.equal(r.encerrados >= 1, true);
  assert.equal(relogiosDe(mundo, 'transbordo')[0].resultado, 'sem_acao');

  mundo.agora = local(2026, 8, 31, 9, 16);
  assert.equal((await w.dispararVencidos()).vistos, 0);
  assert.equal(mundo.chamadas.transferirTime.length, 0);
});

teste('a distribuição pausada recusa a transferência, e a pausa vencida volta sozinha', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: {
      inatividadeAtiva: false, transbordoAtivo: true, transbordoMinutos: 15, transbordoTimeId: 7,
      distribuicaoPausada: true, pausadaAte: local(2026, 8, 31, 9, 20), pausadaMotivo: 'incidente na operadora',
    },
    conversas: [{ id: 57, cwInboxId: 1, cwAssigneeId: null, cwTeamId: 3, status: 'pending', waitingSince: t09, lastActivityAt: t09 }],
  });
  await w.reconciliarRelogios();
  mundo.agora = local(2026, 8, 31, 9, 16);
  await w.dispararVencidos();
  assert.equal(mundo.chamadas.transferirTime.length, 0, 'com a distribuição pausada, ninguém é atribuído');
  assert.equal(relogiosDe(mundo, 'transbordo')[0].resultado, 'recusado_pausa');
  assert.equal(relogiosDe(mundo, 'transbordo')[0].erro, 'incidente na operadora',
    'pausa sem motivo escrito é pausa que ninguém consegue explicar depois');

  // 09h21: a pausa venceu.
  mundo.agora = local(2026, 8, 31, 9, 21);
  assert.equal((await w.expirarPausasDeDistribuicao()).retomadas, 1);
  assert.equal(mundo.db.__tabelas.ragnabotAtendPolitica[0].distribuicaoPausada, false);
  assert.ok(mundo.db.__tabelas.ragnabotAuditoria.some((a) => a.acao === 'atendimento.distribuicao.retomada'));
});

teste('quem entrou na fila e desistiu recebe a DESPEDIDA, não "você voltou para a fila"', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    politica: { inatividadeConta: 'qualquer', msgDespedidaEspera: 'Não conseguimos falar com você. Estamos por aqui quando precisar.' },
    // Nunca teve atendente: firstReplyCreatedAt nulo e sem responsável.
    conversas: [{ id: 61, cwInboxId: 1, cwAssigneeId: null, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: null }],
  });
  await w.reconciliarRelogios();
  mundo.agora = local(2026, 8, 31, 9, 31);
  await w.dispararVencidos();
  assert.equal(mundo.chamadas.mensagens.length, 1);
  assert.match(mundo.chamadas.mensagens[0].texto, /Não conseguimos falar com você/);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. A VIRADA DO EXPEDIENTE — duas camadas duráveis contra a repetição
// ════════════════════════════════════════════════════════════════════════════════════════════════
teste('virada: primeira observação NÃO avisa; a virada avisa uma vez; e o carimbo do dia segura o resto', async () => {
  const t10 = local(2026, 8, 31, 10, 0);
  const mundo = montarMundo({
    instante: t10,
    conversas: [{ id: 71, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t10, waitingSince: null, firstReplyCreatedAt: t10 }],
  });

  const v1 = await w.tratarViradaDeExpediente();
  assert.equal(v1.viradas, 0, 'primeira leitura não é virada — senão toda implantação vira disparo em massa');
  assert.equal(mundo.chamadas.mensagens.length, 0);

  // 18h05: fechou.
  mundo.agora = local(2026, 8, 31, 18, 5);
  const v2 = await w.tratarViradaDeExpediente();
  assert.equal(v2.viradas, 1);
  assert.equal(v2.avisadas, 1);
  assert.equal(mundo.chamadas.mensagens.length, 1);
  assert.match(mundo.chamadas.mensagens[0].texto, /expediente encerrou/);

  // 18h30: nada virou. O marcador segura.
  mundo.agora = local(2026, 8, 31, 18, 30);
  await w.tratarViradaDeExpediente();
  assert.equal(mundo.chamadas.mensagens.length, 1);

  // ⭐ SEGUNDA CAMADA: mesmo que o marcador oscile (expediente mal cadastrado, ou leitura fora de
  //   ordem), o índice único com a DATA na chave impede o segundo aviso no mesmo dia.
  const marcador = mundo.db.__tabelas.ragnabotAuditoria
    .filter((a) => a.acao === 'atendimento.expediente.virada').pop();
  marcador.depois = { estado: 'aberto' };
  mundo.agora = local(2026, 8, 31, 19, 0);
  const v4 = await w.tratarViradaDeExpediente();
  assert.equal(v4.viradas, 1, 'a virada foi detectada de novo…');
  assert.equal(v4.avisadas, 0, '…mas o cliente NÃO recebeu a mensagem duas vezes no mesmo dia');
  assert.equal(mundo.chamadas.mensagens.length, 1);
});

teste('virada: no almoço a mensagem é a do INTERVALO, e ninguém é encerrado', async () => {
  const t10 = local(2026, 8, 31, 10, 0);
  const mundo = montarMundo({
    instante: t10,
    politica: { encerrarAposForaExpediente: true },
    conversas: [{ id: 72, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t10, waitingSince: null, firstReplyCreatedAt: t10 }],
  });
  await w.tratarViradaDeExpediente(); // primeira observação: aberto

  mundo.agora = local(2026, 8, 31, 12, 10);
  const v = await w.tratarViradaDeExpediente();
  assert.equal(v.avisadas, 1);
  assert.match(mundo.chamadas.mensagens[0].texto, /intervalo do almoço/);
  assert.equal(v.encerradas, 0, 'ninguém encerra atendimento no almoço, mesmo com o encerramento ligado');
  assert.equal(mundo.conversas.get(72).status, 'open');
});

teste('virada: com encerrarAposForaExpediente a conversa é encerrada no fim do dia', async () => {
  const t10 = local(2026, 8, 31, 10, 0);
  const mundo = montarMundo({
    instante: t10,
    politica: { encerrarAposForaExpediente: true },
    conversas: [{ id: 73, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t10, waitingSince: null, firstReplyCreatedAt: t10 }],
  });
  await w.tratarViradaDeExpediente();
  mundo.agora = local(2026, 8, 31, 18, 5);
  const v = await w.tratarViradaDeExpediente();
  assert.equal(v.encerradas, 1);
  assert.equal(mundo.conversas.get(73).status, 'resolved');
});

teste('a rodada inteira não lança e é reentrante-segura', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 91, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });
  const r = await w.rodarTrabalhadorDeAtendimento();
  assert.equal(r.pulado, false);
  assert.equal(r.reconciliacao.armados, 1);
  assert.ok(typeof r.duracaoMs === 'number');

  mundo.agora = local(2026, 8, 31, 9, 31);
  const r2 = await w.rodarTrabalhadorDeAtendimento();
  assert.equal(r2.disparo.aplicados, 1);
  assert.equal(mundo.chamadas.devolverParaFila.length, 1);
});

teste('sem porta de Chatwoot o trabalhador avisa e não quebra', async () => {
  const db = criarDb();
  w.configurarTrabalhador({ db, chatwoot: null, log: silencioso, relogio: { agora: () => new Date() } });
  const r = await w.rodarTrabalhadorDeAtendimento();
  assert.equal(r.pulado, false);
  assert.ok(!r.erro, 'trabalhador que morre por falta de porta deixa TODAS as conversas sem relógio');
});

teste('fuso: a conversão local→instante acerta dos DOIS lados de uma virada de horário de verão', () => {
  // Fortaleza não tem horário de verão, mas um cliente em outro fuso pode ter — e o erro de uma
  // hora na abertura do expediente é o tipo de defeito que ninguém liga ao fuso.
  const ny = 'America/New_York';
  const antes = w.instanteDe({ ano: 2026, mes: 3, dia: 7, minutoDoDia: 8 * 60 }, ny);  // ainda EST (-5)
  const depois = w.instanteDe({ ano: 2026, mes: 3, dia: 9, minutoDoDia: 8 * 60 }, ny); // já EDT (-4)
  assert.equal(antes.toISOString(), '2026-03-07T13:00:00.000Z');
  assert.equal(depois.toISOString(), '2026-03-09T12:00:00.000Z');
  assert.equal(w.partesNoFuso(antes, ny).minutoDoDia, 480, 'ida e volta sem perda');
  assert.equal(w.partesNoFuso(depois, ny).minutoDoDia, 480);
});

teste('fuso: a meia-noite é hora 0, nunca hora 24 (o erro de um dia inteiro)', () => {
  const mn = w.instanteDe({ ano: 2026, mes: 8, dia: 31, minutoDoDia: 0 }, FUSO);
  const p = w.partesNoFuso(mn, FUSO);
  assert.equal(p.hora, 0);
  assert.equal(p.minutoDoDia, 0);
  assert.equal(p.dia, 31, 'hora 24 jogaria o instante para o dia seguinte');
});

teste('a porta de expediente aceita a assinatura do serviço IRMÃO, e o trabalhador obedece a ela', async () => {
  const t09 = local(2026, 8, 31, 9, 0);
  const mundo = montarMundo({
    instante: t09,
    conversas: [{ id: 101, cwInboxId: 1, cwAssigneeId: 5, status: 'open', lastActivityAt: t09, waitingSince: null, firstReplyCreatedAt: t09 }],
  });

  // Dublê com a assinatura de `ragnabot-atendimento.service.js`: um ÚNICO objeto nomeado.
  // Se o adaptador chamasse com a forma errada, `janelas` chegaria vazio e a resposta seria
  // "aberto" em silêncio — o defeito de integração viraria "o robô respondeu de madrugada".
  const vistos = [];
  w.configurarTrabalhador({
    politicas: {
      avaliarExpediente: ({ agora, fuso, janelas, excecoes }) => {
        vistos.push({ temAgora: agora instanceof Date, fuso, qtdJanelas: janelas.length, qtdExcecoes: excecoes.length });
        return { aberto: false, motivo: 'feriado', rotulo: 'Ponto facultativo', proximaAbertura: local(2026, 9, 1, 8, 0), fechaEm: null, excecao: null };
      },
    },
  });

  await w.reconciliarRelogios();
  assert.ok(vistos.length > 0, 'a porta injetada precisa ser realmente chamada');
  assert.equal(vistos[0].temAgora, true, 'o instante chega como Date no campo `agora`');
  assert.equal(vistos[0].fuso, FUSO);
  assert.equal(vistos[0].qtdJanelas, 10, 'as 10 janelas da política chegam à porta — não um array vazio');

  const rel = relogiosDe(mundo, 'inatividade')[0];
  assert.equal(rel.pausadoMotivo, 'feriado', 'o veredito da porta manda no congelamento');

  // E o motivo `sem_configuracao`, que só o irmão devolve, é lido como ABERTO.
  w.configurarTrabalhador({ politicas: { avaliarExpediente: () => ({ aberto: true, motivo: 'sem_configuracao' }) } });
  mundo.agora = local(2026, 8, 31, 9, 5);
  await w.reconciliarRelogios();
  assert.equal(relogiosDe(mundo, 'inatividade')[0].pausadoMotivo, null);

  w.configurarTrabalhador({ politicas: null }); // não vaza para os testes seguintes
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
let falhas = 0;
for (const [nome, fn] of testes) {
  try {
    await fn();
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas += 1;
    console.log(`  FALHA ${nome}\n        ${e.message}`);
    if (process.env.DETALHE) console.log(e.stack);
  }
}
console.log(`\n${testes.length - falhas}/${testes.length} testes passaram`);
process.exit(falhas ? 1 : 0);
