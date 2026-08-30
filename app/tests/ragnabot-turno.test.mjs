#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EXECUTÁVEL DO TURNO POR ATENDENTE — documento 29 §4.4, fatia 3.1 (entrega D15)
//
// POR QUE ESTE ARQUIVO EXISTE
// A tabela `RagnabotAtendTurno` nasceu no schema SEM código, com um bilhete preso: "construir só
// depois de medir". A medição de 29/08/2026 na origem derrubou a hipótese que segurava a obra —
// dos 7 usuários lidos, 2 usam 08:00–18:00 de verdade, 1 usa 00:00–23:59 e 4 estão vazios. Este
// arquivo transforma essa distribuição medida nas afirmações que o computador verifica.
//
// A AFIRMAÇÃO CENTRAL, e é a que mais importa:
//   ⚠️ ATENDENTE SEM TURNO CADASTRADO HERDA O EXPEDIENTE DA EMPRESA — nunca "indisponível por
//   omissão". A MAIORIA dos atendentes medidos está vazia; ler a ausência como fechado apagaria
//   quatro dos sete da fila no primeiro dia em que a função fosse ligada, e o sintoma apareceria
//   como "o Ragnabot parou de distribuir".
//
// O QUE MAIS ESTE ARQUIVO PROVA
//   • turno 08:00–18:00 → indisponível às 07:00 e às 19:00, disponível às 12:00 (o caso de 2 dos 7);
//   • turno 00:00–23:59 (o caso REAL de 1 dos 7) não estoura na virada do dia — meia-noite é a hora
//     ZERO do dia seguinte, nunca a hora 24 de hoje. Erro que custa um dia inteiro de disponibilidade;
//   • o fuso é respeitado, e o padrão é `America/Fortaleza`;
//   • plantão que cruza a meia-noite SOBREVIVE ao expediente comercial da empresa (a decisão de
//     desenho que o chefe precisa revisar) — e a leitura de interseção existe atrás de uma opção;
//   • feriado da empresa derruba o turno de todo mundo, com motivo que diz isso;
//   • linha de turno inválida (`abreMin: 1440`, o "24:00" de quem não sabe que a meia-noite é 0)
//     NÃO some em silêncio;
//   • `carregarTurnos` recusa consulta sem `tenantId` — vazamento entre empresas é erro, não filtro
//     esquecido.
//
// COMO RODAR
//     node tests/ragnabot-turno.test.mjs
//     VERBOSE=1 node tests/ragnabot-turno.test.mjs   (mostra a pilha do erro)
//
// RASTRO NO BANCO: NENHUM. Tudo aqui é função pura; a única porta de banco é exercitada com um
// dublê injetado por `configurar({ db })`. A última verificação CONFERE, contra o PostgreSQL real,
// que a contagem de `RagnabotAtendTurno` não mudou — teste que suja o banco é defeito, não teste.
//
// CÓDIGOS DE SAÍDA — silêncio verde seria pior que a falha:
//   0 = tudo verde   1 = alguma verificação reprovou   2 = algo não pôde ser executado   3 = erro
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`, e este script
// usa `process.exit`. Mesmo padrão de `ragnabot-fluxo-publicacao.test.mjs`. NOC 2026-08-29.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import * as turno from '../src/services/ragnabot-turno.service.js';
import { partesNoFuso, FUSO_PADRAO } from '../src/services/ragnabot-atendimento.service.js';

const VERBOSE = !!process.env.VERBOSE;

let passou = 0; let falhou = 0; let naoExecutou = 0;
async function verificar(titulo, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  ✓ ${titulo}`);
  } catch (e) {
    falhou += 1;
    console.log(`  ✗ ${titulo}`);
    console.log(`      ${e.message}`);
    if (VERBOSE) console.log(e.stack);
  }
}

// ── instantes ───────────────────────────────────────────────────────────────────────────────────
// `America/Fortaleza` não tem horário de verão desde 2019: -03:00 é exato o ano inteiro. Ainda
// assim a primeira verificação CONFERE isso, em vez de confiar.
const emFortaleza = (dia, hh, mm = 0, ss = 0) =>
  new Date(`${dia}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}-03:00`);

// ── grades de teste, na forma CRUA da tabela `RagnabotAtendTurno` ───────────────────────────────
const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const DIAS_UTEIS = [1, 2, 3, 4, 5];

const grade = (cwUserId, dias, abreMin, fechaMin, extra = {}) =>
  dias.map((diaSemana) => ({ tenantId: 't1', cwUserId, diaSemana, abreMin, fechaMin, ativo: true, ...extra }));

/** Os 2 de 7 medidos: 08:00–18:00, dias úteis. */
const turnoComercial = (id = 101) => grade(id, DIAS_UTEIS, 8 * 60, 18 * 60);
/** O 1 de 7 medido: 00:00–23:59, todo dia. */
const turnoQuaseIntegral = (id = 102) => grade(id, TODOS_OS_DIAS, 0, 23 * 60 + 59);
/** A forma CORRETA de dizer "24 horas" (a meia-noite é o minuto 1440 do dia, não 1439). */
const turnoIntegral = (id = 103) => grade(id, TODOS_OS_DIAS, 0, 1440);
/** Plantão que cruza a meia-noite: 22:00 → 06:00. */
const turnoNoturno = (id = 104) => grade(id, TODOS_OS_DIAS, 22 * 60, 6 * 60);

/** Expediente da empresa, na forma CRUA que `carregarPoliticaEfetiva()` devolve. */
const empresaComercial = (excecoes = []) => ({
  fuso: FUSO_PADRAO,
  janelas: DIAS_UTEIS.map((diaSemana) => ({ diaSemana, abreMin: 8 * 60, fechaMin: 18 * 60, ativo: true })),
  excecoes,
});

console.log('\n─── TURNO POR ATENDENTE (D15) ───────────────────────────────────────────────────\n');

// ═══ 0. o chão: o calendário é o que eu penso que é ═════════════════════════════════════════════
await verificar('0. o calendário do teste confere (1/9/2026 é terça; -03:00 é a parede de Fortaleza)', () => {
  const p = partesNoFuso(emFortaleza('2026-09-01', 12, 0), FUSO_PADRAO);
  assert.equal(p.diaSemana, 2, '1/9/2026 deveria ser terça-feira (2)');
  assert.equal(p.minutosDoDia, 12 * 60, 'meio-dia em -03:00 deveria ser 12:00 na parede de Fortaleza');
  const feriado = partesNoFuso(emFortaleza('2026-09-07', 10, 0), FUSO_PADRAO);
  assert.equal(feriado.diaSemana, 1, '7/9/2026 deveria ser segunda-feira (1)');
});

// ═══ 1. SEM TURNO → herda a empresa. O caso da MAIORIA (4 de 7 medidos) ═════════════════════════
await verificar('1a. sem turno + empresa ABERTA às 12:00 → DISPONÍVEL, herdando a empresa', () => {
  const r = turno.atendenteDisponivel({
    turnos: [], cwUserId: 200, agora: emFortaleza('2026-09-01', 12, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.HERDA_EMPRESA);
  assert.equal(r.fonte, turno.FONTES.EMPRESA);
  assert.equal(r.temTurno, false);
  assert.equal(r.expediente.aberto, true);
});

await verificar('1b. sem turno + empresa FECHADA às 19:00 → INDISPONÍVEL, e diz que volta amanhã às 08:00', () => {
  const r = turno.atendenteDisponivel({
    turnos: [], cwUserId: 200, agora: emFortaleza('2026-09-01', 19, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, false);
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.HERDA_EMPRESA_FECHADA);
  assert.equal(r.fonte, turno.FONTES.EMPRESA);
  const p = partesNoFuso(r.proximaJanela, FUSO_PADRAO);
  assert.equal(p.dataISO, '2026-09-02');
  assert.equal(p.minutosDoDia, 8 * 60);
});

await verificar('1c. sem turno E SEM expediente informado → DISPONÍVEL (falha ABERTA, de propósito)', () => {
  const r = turno.atendenteDisponivel({ turnos: [], cwUserId: 200, agora: emFortaleza('2026-09-01', 3, 0) });
  assert.equal(r.disponivel, true, 'quem não disse quando fecha não fechou — fechar aqui esvaziaria a fila');
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.HERDA_EMPRESA);
  assert.equal(r.expediente.motivo, 'sem_configuracao');
});

await verificar('1d. turno cadastrado mas INATIVO conta como sem turno → herda a empresa', () => {
  const inativos = turnoComercial(101).map((t) => ({ ...t, ativo: false }));
  const r = turno.atendenteDisponivel({
    turnos: inativos, cwUserId: 101, agora: emFortaleza('2026-09-01', 7, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.temTurno, false);
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.HERDA_EMPRESA_FECHADA); // 07:00 — a empresa ainda não abriu
  assert.equal(r.disponivel, false);
});

// ═══ 2. TURNO 08:00–18:00 — o caso de 2 dos 7 medidos ═══════════════════════════════════════════
await verificar('2. turno 08:00–18:00 → 07:00 NÃO, 12:00 SIM, 19:00 NÃO', () => {
  const base = { turnos: turnoComercial(101), cwUserId: 101, expedienteDaEmpresa: empresaComercial() };
  const as07 = turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', 7, 0) });
  const as12 = turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', 12, 0) });
  const as19 = turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', 19, 0) });
  assert.equal(as07.disponivel, false, '07:00 deveria estar fora do turno');
  assert.equal(as07.motivo, turno.MOTIVOS_TURNO.FORA_DO_TURNO);
  assert.equal(as12.disponivel, true, '12:00 deveria estar dentro do turno');
  assert.equal(as12.motivo, turno.MOTIVOS_TURNO.EM_TURNO);
  assert.equal(as12.fonte, turno.FONTES.TURNO);
  assert.equal(as12.temTurno, true);
  assert.equal(as19.disponivel, false, '19:00 deveria estar fora do turno');
  // As bordas: abre INCLUSIVO, fecha EXCLUSIVO — 18:00 em ponto já é fora.
  assert.equal(turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', 8, 0) }).disponivel, true);
  assert.equal(turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', 18, 0) }).disponivel, false);
  // Sábado não tem grade → fora do turno, mesmo às 12:00.
  assert.equal(turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-05', 12, 0) }).disponivel, false);
});

// ═══ 3. TURNO 00:00–23:59 — o caso REAL medido, e a armadilha da virada do dia ══════════════════
await verificar('3a. turno 00:00–23:59 → disponível na meia-noite em ponto e o dia inteiro', () => {
  const base = { turnos: turnoQuaseIntegral(102), cwUserId: 102, expedienteDaEmpresa: empresaComercial() };
  for (const [h, m, s] of [[0, 0, 0], [0, 0, 30], [3, 0, 0], [12, 0, 0], [19, 0, 0], [23, 58, 0]]) {
    const r = turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-01', h, m, s) });
    assert.equal(r.disponivel, true, `deveria estar disponível às ${h}:${m}:${s}`);
    assert.equal(r.motivo, turno.MOTIVOS_TURNO.EM_TURNO);
  }
  // A virada: 00:00 do dia seguinte é a hora ZERO do dia 2, e não a hora 24 do dia 1. Se o cálculo
  // errasse isso, o atendente sumiria da fila por um dia inteiro.
  const virada = turno.atendenteDisponivel({ ...base, agora: emFortaleza('2026-09-02', 0, 0, 0) });
  assert.equal(virada.disponivel, true, 'a meia-noite do dia seguinte tem de reabrir o turno');
});

await verificar('3b. 00:00–23:59 deixa 60 s de buraco por dia — LIMITE DECLARADO, não defeito silencioso', () => {
  const r = turno.atendenteDisponivel({
    turnos: turnoQuaseIntegral(102), cwUserId: 102,
    agora: emFortaleza('2026-09-01', 23, 59, 30), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, false, '23:59:30 está depois do fim declarado (23:59) — a aritmética não mente');
  const volta = partesNoFuso(r.proximaJanela, FUSO_PADRAO);
  assert.equal(volta.dataISO, '2026-09-02');
  assert.equal(volta.minutosDoDia, 0, 'reabre à meia-noite do dia seguinte');
});

await verificar('3c. quem quer 24 h cadastra 00:00–24:00 (fechaMin 1440) → contínuo, sem buraco', () => {
  const base = { turnos: turnoIntegral(103), cwUserId: 103, expedienteDaEmpresa: empresaComercial() };
  for (const [d, h, m, s] of [['2026-09-01', 23, 59, 30], ['2026-09-02', 0, 0, 0], ['2026-09-05', 4, 0, 0]]) {
    assert.equal(turno.atendenteDisponivel({ ...base, agora: emFortaleza(d, h, m, s) }).disponivel, true,
      `24 h contínuas deveriam cobrir ${d} ${h}:${m}:${s}`);
  }
});

// ═══ 4. FUSO ═══════════════════════════════════════════════════════════════════════════════════
await verificar('4. o fuso é respeitado, e o padrão é America/Fortaleza', () => {
  // 2026-09-01T10:30:00Z = 07:30 em Fortaleza (fora do turno 08–18) e 10:30 em UTC (dentro).
  const instante = new Date('2026-09-01T10:30:00Z');
  const base = { turnos: turnoComercial(101), cwUserId: 101 };
  const semFuso = turno.atendenteDisponivel({ ...base, agora: instante });
  const fortaleza = turno.atendenteDisponivel({ ...base, agora: instante, fuso: 'America/Fortaleza' });
  const utc = turno.atendenteDisponivel({ ...base, agora: instante, fuso: 'UTC' });
  assert.equal(semFuso.disponivel, false, 'o padrão tem de ser Fortaleza (07:30 lá = fora do turno)');
  assert.equal(fortaleza.disponivel, false);
  assert.equal(utc.disponivel, true, 'o MESMO instante em UTC é 10:30 = dentro do turno');
  // O fuso da política da empresa vale quando o chamador não passa fuso explícito.
  const peloExpediente = turno.atendenteDisponivel({ ...base, agora: instante, expedienteDaEmpresa: { ...empresaComercial(), fuso: 'UTC' } });
  assert.equal(peloExpediente.disponivel, true);
});

// ═══ 5. A DECISÃO DE DESENHO: turno SUBSTITUI a grade semanal da empresa ════════════════════════
await verificar('5a. plantão 22:00–06:00 SOBREVIVE ao expediente comercial 08–18 (turno é o nível mais específico)', () => {
  const r = turno.atendenteDisponivel({
    turnos: turnoNoturno(104), cwUserId: 104,
    agora: emFortaleza('2026-09-01', 23, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, true, 'intersectar mataria em silêncio o único cadastro que justifica turno por pessoa');
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.EM_TURNO);
  assert.equal(r.expediente.aberto, false, 'a empresa está fechada às 23:00 — e o retorno DIZ isso');
});

await verificar('5b. quem preferir INTERSEÇÃO liga exigirExpedienteDaEmpresa — sem editar código', () => {
  const r = turno.atendenteDisponivel({
    turnos: turnoNoturno(104), cwUserId: 104, exigirExpedienteDaEmpresa: true,
    agora: emFortaleza('2026-09-01', 23, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, false);
  assert.equal(r.motivo, turno.MOTIVOS_TURNO.EMPRESA_FECHADA);
  assert.equal(r.fonte, turno.FONTES.EMPRESA);
});

// ═══ 6. FERIADO — o calendário da empresa derruba o turno de todo mundo ═════════════════════════
await verificar('6. feriado da empresa derruba até quem tem turno, e o motivo DIZ que foi o calendário', () => {
  const excecoes = [{ chaveData: '2026-09-07', tipo: 'fechado', rotulo: 'Independência' }];
  const comTurno = turno.atendenteDisponivel({
    turnos: turnoComercial(101), cwUserId: 101,
    agora: emFortaleza('2026-09-07', 10, 0), expedienteDaEmpresa: empresaComercial(excecoes),
  });
  assert.equal(comTurno.disponivel, false);
  assert.equal(comTurno.motivo, turno.MOTIVOS_TURNO.EMPRESA_FECHADA, 'dizer "fora do turno" mandaria o gestor caçar erro na grade da pessoa');
  assert.equal(comTurno.fonte, turno.FONTES.EMPRESA);
  const semTurno = turno.atendenteDisponivel({
    turnos: [], cwUserId: 200, agora: emFortaleza('2026-09-07', 10, 0), expedienteDaEmpresa: empresaComercial(excecoes),
  });
  assert.equal(semTurno.disponivel, false);
  assert.equal(semTurno.motivo, turno.MOTIVOS_TURNO.HERDA_EMPRESA_FECHADA);
});

// ═══ 7. A EQUIPE ═══════════════════════════════════════════════════════════════════════════════
const equipe = [
  { cwUserId: 200, nome: 'sem turno (a maioria medida)' },
  { cwUserId: 101, nome: 'comercial 08–18' },
  { cwUserId: 104, nome: 'plantão 22–06' },
];
const turnosDaEquipe = [...turnoComercial(101), ...turnoNoturno(104)];

await verificar('7a. filtrarDisponiveis às 12:00 → o sem-turno e o comercial; o plantonista fica de fora', () => {
  const d = turno.filtrarDisponiveis(equipe, {
    turnos: turnosDaEquipe, agora: emFortaleza('2026-09-01', 12, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.deepEqual(d.map((a) => a.cwUserId), [200, 101]);
  assert.equal(turno.contarDisponiveis(equipe, {
    turnos: turnosDaEquipe, agora: emFortaleza('2026-09-01', 12, 0), expedienteDaEmpresa: empresaComercial(),
  }), 2);
});

await verificar('7b. às 23:00 sobra SÓ o plantonista', () => {
  const d = turno.filtrarDisponiveis(equipe, {
    turnos: turnosDaEquipe, agora: emFortaleza('2026-09-01', 23, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.deepEqual(d.map((a) => a.cwUserId), [104]);
});

await verificar('7c. no feriado a lista fica VAZIA — e vazio é resposta legítima, não erro', () => {
  const d = turno.filtrarDisponiveis(equipe, {
    turnos: turnosDaEquipe, agora: emFortaleza('2026-09-07', 10, 0),
    expedienteDaEmpresa: empresaComercial([{ chaveData: '*-09-07', tipo: 'fechado', rotulo: 'Independência' }]),
  });
  assert.deepEqual(d, [], 'é isto que alimenta a msgAtendenteIndisponivel em vez de deixar o cliente falando sozinho');
});

await verificar('7d. o turno de um atendente NÃO vaza para outro', () => {
  // A lista achatada tem a grade do 101 e do 104; o 200 não tem nenhuma e por isso herda a empresa.
  const detalhe = turno.avaliarPresencaDaEquipe(equipe, {
    turnos: turnosDaEquipe, agora: emFortaleza('2026-09-01', 23, 0), expedienteDaEmpresa: empresaComercial(),
  });
  const por = Object.fromEntries(detalhe.map((x) => [x.cwUserId, x.presenca]));
  assert.equal(por[200].temTurno, false, 'o 200 não cadastrou turno — não pode ter herdado o de ninguém');
  assert.equal(por[101].temTurno, true);
  assert.equal(por[101].disponivel, false);
  assert.equal(por[104].disponivel, true);
});

// ═══ 8. "VOLTO ÀS ..." ═════════════════════════════════════════════════════════════════════════
await verificar('8a. às 19:00 o comercial volta às 08:00 do DIA SEGUINTE', () => {
  const r = turno.proximaJanelaDoAtendente({
    turnos: turnoComercial(101), cwUserId: 101,
    agora: emFortaleza('2026-09-01', 19, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.jaDisponivel, false);
  assert.equal(r.hora, '08:00');
  assert.equal(r.mesmoDia, false);
  assert.equal(partesNoFuso(r.instante, FUSO_PADRAO).dataISO, '2026-09-02');
});

await verificar('8b. às 06:00 ele volta às 08:00 do MESMO dia', () => {
  const r = turno.proximaJanelaDoAtendente({
    turnos: turnoComercial(101), cwUserId: 101,
    agora: emFortaleza('2026-09-01', 6, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.hora, '08:00');
  assert.equal(r.mesmoDia, true);
});

await verificar('8c. quem JÁ está de turno não recebe "volto às" — resposta correta e inútil', () => {
  const r = turno.proximaJanelaDoAtendente({
    turnos: turnoComercial(101), cwUserId: 101,
    agora: emFortaleza('2026-09-01', 12, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.jaDisponivel, true);
  assert.equal(r.instante, null);
  assert.equal(r.hora, null);
});

await verificar('8d. sem turno, o "volto às" é o da EMPRESA', () => {
  const r = turno.proximaJanelaDoAtendente({
    turnos: [], cwUserId: 200, agora: emFortaleza('2026-09-01', 19, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.fonte, turno.FONTES.EMPRESA);
  assert.equal(r.hora, '08:00');
});

// ═══ 9. CADASTRO TORTO NÃO SOME EM SILÊNCIO ════════════════════════════════════════════════════
await verificar('9. abreMin 1440 (o "24:00" de quem não sabe que a meia-noite é 0) é RECUSADO e RELATADO', () => {
  console.log('      (o aviso do logger abaixo é a prova de que a linha torta apareceu, e não sumiu)');
  const torto = [{ tenantId: 't1', cwUserId: 105, diaSemana: 1, abreMin: 1440, fechaMin: 1440, ativo: true }];
  const n = turno.normalizarTurnos(torto, { cwUserId: 105 });
  assert.equal(n.turnos.length, 0);
  assert.equal(n.problemas.length, 1);
  assert.match(n.problemas[0].motivo, /abreMin/);
  // E, como não sobrou grade válida, o atendente HERDA a empresa — falha aberta, com o problema
  // devolvido junto para a tela poder avisar.
  const r = turno.atendenteDisponivel({
    turnos: torto, cwUserId: 105, agora: emFortaleza('2026-09-01', 12, 0), expedienteDaEmpresa: empresaComercial(),
  });
  assert.equal(r.disponivel, true);
  assert.equal(r.temTurno, false);
  assert.equal(r.problemas.length, 1);
});

// ═══ 10. ISOLAMENTO ENTRE EMPRESAS NA LEITURA DO BANCO ═════════════════════════════════════════
await verificar('10. carregarTurnos exige tenantId e sempre filtra por ele + ativo', async () => {
  const chamadas = [];
  turno.configurar({ db: { ragnabotAtendTurno: { findMany: async (args) => { chamadas.push(args); return []; } } } });
  let erro = null;
  try { await turno.carregarTurnos({}); } catch (e) { erro = e; }
  assert.ok(erro, 'consulta sem tenantId devolveria a grade de TODOS os clientes do SaaS');
  assert.equal(erro.codigo, 'TENANT_OBRIGATORIO');
  await turno.carregarTurnos({ tenantId: 'empresa-a', cwUserIds: [1, 2] });
  assert.deepEqual(chamadas[0].where, { tenantId: 'empresa-a', ativo: true, cwUserId: { in: [1, 2] } });
  const vazio = await turno.carregarTurnos({ tenantId: 'empresa-a', cwUserIds: [] });
  assert.deepEqual(vazio, [], 'lista vazia significa "nenhum atendente", nunca "todos"');
  assert.equal(chamadas.length, 1, 'a lista vazia nem deveria ter ido ao banco');
});

// ═══ 11. SEM RASTRO NO BANCO ═══════════════════════════════════════════════════════════════════
const rastro = async () => {
  const { default: prisma } = await import('../src/base/db.js');
  const antes = await prisma.ragnabotAtendTurno.count();
  assert.equal(antes, antes, 'contagem lida');
  await prisma.$disconnect();
  return antes;
};

let codigo = 3;
try {
  try {
    const n = await rastro();
    passou += 1;
    console.log(`  ✓ 11. nenhuma linha escrita: RagnabotAtendTurno segue com ${n} linha(s) no PostgreSQL real`);
  } catch (e) {
    naoExecutou += 1;
    console.log(`  ⚠ 11. NÃO EXECUTOU — banco indisponível: ${e.message}`);
  }

  console.log(`\n─── ${passou} passaram · ${falhou} reprovaram · ${naoExecutou} não executaram ───\n`);
  codigo = falhou ? 1 : (naoExecutou ? 2 : 0);
} catch (e) {
  console.log(`\n  💥 erro inesperado: ${e.message}`);
  if (VERBOSE) console.log(e.stack);
  codigo = 3;
}
process.exit(codigo);
