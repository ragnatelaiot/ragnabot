#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AGENDAMENTO — A PARTE PURA (contrato S4, 02/09/2026)
//
// O que se mede aqui NÃO precisa de banco, de rede nem do relógio do processo: recorrência, fuso,
// virada do dia, virada do horário de verão, chave de idempotência e validação de entrada. É de
// propósito que essas regras sejam funções puras — é o que permite provar o caso que ninguém
// reproduz à mão (a mensagem que devia sair às 8h e sairia às 7h no dia da virada).
//
// A parte que só existe DENTRO do Postgres — reserva por chave única, posse entre réplicas,
// reinício no meio do disparo — está em `tests/ragnabot-agendamento-worker.test.mjs`, contra banco
// de verdade. Um dublê em memória responderia o que eu programasse nele: provaria a minha opinião,
// não o comportamento.
//
// COMO RODAR:  node tests/ragnabot-agendamento.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';

const S = await import('../src/services/ragnabot-agendamento.service.js');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try {
    const r = conferir();
    console.log(`  ✓ ${titulo}${r !== undefined && r !== null ? `  →  ${r}` : ''}`);
  } catch (e) {
    falhas += 1;
    console.log(`  ✗ ${titulo}\n      ${e.message}`);
  }
}
function igual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'esperava'}: «${b}», veio «${a}»`);
}
function verdade(v, msg) { if (!v) throw new Error(msg || 'esperava verdadeiro'); }
function recusa(fn, trecho) {
  try { fn(); } catch (e) {
    if (trecho && !String(e.message).includes(trecho)) throw new Error(`recusou, mas por outro motivo: ${e.message}`);
    return `recusado: ${String(e.message).slice(0, 70)}`;
  }
  throw new Error('NÃO recusou — devia ter recusado');
}
const secao = (t) => console.log(`\n${t}`);

/** Hora local legível, no fuso — para a medição dizer o que a pessoa veria no relógio DELA, que é
 *  a única coisa que importa numa agenda. Sem o dia da semana, que vai separado em `dow()`. */
function local(instante, fuso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(instante);
}
/** O dia da semana no fuso — usado só para o relatório ficar legível. */
function dow(instante, fuso) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'short' }).format(instante);
}

console.log('\nAGENDAMENTO DE MENSAGENS — a parte pura (recorrência, fuso, chaves, validação)');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('1. A CHAVE DE IDEMPOTÊNCIA — é dela que sai «não dispara duas vezes»');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const AG = 'ag-0001';
const D1 = 'destino-1';
const D2 = 'destino-2';
const OC1 = new Date('2026-09-03T11:00:00.000Z');
const OC2 = new Date('2026-09-10T11:00:00.000Z');

medir('a MESMA (agendamento, destino, ocorrência) dá SEMPRE a mesma chave', () => {
  const a = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1 });
  const b = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: new Date(OC1.getTime()) });
  igual(a, b, 'as duas chaves');
  return a.slice(0, 16) + '…';
});

medir('DOIS DESTINATÁRIOS do mesmo agendamento NÃO colidem (senão o 2º nunca receberia)', () => {
  const a = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1 });
  const b = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D2, ocorrenciaEm: OC1 });
  verdade(a !== b, 'as chaves dos dois destinatários ficaram IGUAIS');
});

medir('DUAS OCORRÊNCIAS do mesmo destinatário NÃO colidem (senão o recorrente sairia 1× na vida)', () => {
  const a = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1 });
  const b = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC2 });
  verdade(a !== b, 'as chaves de duas ocorrências ficaram IGUAIS');
});

medir('o REENVIO MANUAL tem chave própria — senão o botão não faria nada', () => {
  const a = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1, tentativaManual: 0 });
  const b = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1, tentativaManual: 1 });
  verdade(a !== b, 'a tentativa manual não mudou a chave');
});

medir('a chave é opaca: não carrega identificador interno legível', () => {
  const a = S.chaveDeEnvio({ agendamentoId: AG, destinoId: D1, ocorrenciaEm: OC1 });
  verdade(!a.includes(AG) && !a.includes(D1), 'a chave vazou identificador interno');
  igual(a.length, 64, 'tamanho do sha256 em hexa');
});

medir('chave sem destino é RECUSADA (nunca uma chave frouxa por descuido)',
  () => recusa(() => S.chaveDeEnvio({ agendamentoId: AG, ocorrenciaEm: OC1 }), 'obrigatórios'));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('2. RECORRÊNCIA DIÁRIA — e a VIRADA DO DIA no fuso de Fortaleza');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const FORTALEZA = 'America/Fortaleza'; // UTC-3, sem horário de verão

// 23h50 do dia 2 em Fortaleza = 02h50 UTC do dia 3.
const inicio2350 = new Date('2026-09-03T02:50:00.000Z');
const diaria2350 = {
  recorrencia: 'diaria', intervalo: 1, fuso: FORTALEZA, minutoLocal: 23 * 60 + 50, inicioEm: inicio2350,
};

medir('23h50 + 1 dia = 23h50 do dia SEGUINTE, no relógio do cliente', () => {
  const p = S.proximaOcorrencia(diaria2350, inicio2350);
  igual(local(inicio2350, FORTALEZA), '02/09/2026, 23:50', 'a âncora, no relógio do cliente');
  igual(local(p, FORTALEZA), '03/09/2026, 23:50', 'hora local da próxima');
  igual(p.toISOString(), '2026-09-04T02:50:00.000Z', 'instante absoluto');
});

medir('a virada do dia NÃO duplica: cinco ocorrências seguidas, todas às 23h50, todas distintas', () => {
  const vistos = new Set();
  let cursor = inicio2350;
  const lidas = [];
  for (let i = 0; i < 5; i += 1) {
    cursor = S.proximaOcorrencia(diaria2350, cursor);
    verdade(cursor, 'a grade parou antes da hora');
    verdade(!vistos.has(cursor.getTime()), `a ocorrência ${cursor.toISOString()} REPETIU`);
    vistos.add(cursor.getTime());
    lidas.push(`${dow(cursor, FORTALEZA)} ${local(cursor, FORTALEZA).split(',')[0]}`);
    verdade(local(cursor, FORTALEZA).endsWith('23:50'), `a hora local escorregou: ${local(cursor, FORTALEZA)}`);
  }
  return lidas.join(' · ');
});

// ⚠️ A âncora é 02/09 23:50 LOCAL (o instante 2026-09-03T02:50Z é 02/09 às 23h50 em Fortaleza,
// que é UTC-3). Confundir as duas leituras é a armadilha clássica do fuso — e ela mordeu este
// próprio teste na primeira execução: eu esperava 06/09 raciocinando pelo dia do ISO, não pelo dia
// do cliente. O código estava certo; a expectativa é que estava lendo o relógio errado.
medir('«a cada 3 dias» anda de 3 em 3, e não de 1 em 1', () => {
  const cfg = { ...diaria2350, intervalo: 3 };
  const p1 = S.proximaOcorrencia(cfg, inicio2350);
  const p2 = S.proximaOcorrencia(cfg, p1);
  igual(local(p1, FORTALEZA), '05/09/2026, 23:50', '1ª');
  igual(local(p2, FORTALEZA), '08/09/2026, 23:50', '2ª');
});

medir('a próxima é SEMPRE estritamente maior que a anterior (a trava contra duplicar)', () => {
  const p = S.proximaOcorrencia(diaria2350, inicio2350);
  verdade(p.getTime() > inicio2350.getTime(), 'a próxima não avançou');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('3. A VIRADA DO HORÁRIO DE VERÃO — o caso que a conta em milissegundos erra');
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Fortaleza não tem horário de verão, então ela NÃO prova este ponto. Nova York tem: em 08/03/2026
// o relógio pula de 02h para 03h. Uma agenda «todo dia às 8h» tem de continuar às 8h — somar
// 86.400.000 ms faria a de domingo sair às 7h no relógio de quem recebe.

const NY = 'America/New_York';
const inicioNY = new Date('2026-03-07T13:00:00.000Z'); // 08h00 de 07/03 em Nova York (UTC-5)
const diariaNY = { recorrencia: 'diaria', intervalo: 1, fuso: NY, minutoLocal: 8 * 60, inicioEm: inicioNY };

medir('atravessando a virada, a hora LOCAL fica em 8h (o instante absoluto é que muda)', () => {
  const p1 = S.proximaOcorrencia(diariaNY, inicioNY); // 08/03 — o DIA DA VIRADA
  const p2 = S.proximaOcorrencia(diariaNY, p1); // 09/03 — já no horário de verão
  igual(local(inicioNY, NY), '07/03/2026, 08:00', 'a âncora, na véspera da virada');
  igual(local(p1, NY), '08/03/2026, 08:00', 'a do DIA da virada');
  igual(local(p2, NY), '09/03/2026, 08:00', 'a do dia seguinte');
  // A prova de que a conta NÃO é de milissegundos: da véspera para o dia da virada passaram 23 h.
  const horas = (p1.getTime() - inicioNY.getTime()) / 3_600_000;
  igual(horas, 23, 'horas absolutas atravessando a virada');
  return `${local(inicioNY, NY)} → ${local(p1, NY)} (${horas} h absolutas, e não 24)`;
});

medir('a conta ingênua (somar 24 h) ERRARIA em uma hora — é isto que o código evita', () => {
  const ingenua = new Date(inicioNY.getTime() + 86_400_000);
  const certa = S.proximaOcorrencia(diariaNY, inicioNY);
  verdade(ingenua.getTime() !== certa.getTime(), 'a ingênua deu o mesmo resultado — o teste não prova nada');
  igual(local(ingenua, NY), '08/03/2026, 09:00', 'o que a conta ingênua entregaria ao cliente');
  igual(local(certa, NY), '08/03/2026, 08:00', 'o que o código entrega');
  return `ingênua: ${local(ingenua, NY)}  ×  certa: ${local(certa, NY)}`;
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('4. RECORRÊNCIA SEMANAL');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// 03/09/2026 é uma QUINTA. 08h00 em Fortaleza = 11h00 UTC.
const inicioQui = new Date('2026-09-03T11:00:00.000Z');
const semanal = {
  recorrencia: 'semanal', intervalo: 1, diasSemana: '2,4', // terça e quinta
  fuso: FORTALEZA, minutoLocal: 8 * 60, inicioEm: inicioQui,
};

medir('terça e quinta: da quinta vai para a TERÇA seguinte, e daí para a quinta', () => {
  const p1 = S.proximaOcorrencia(semanal, inicioQui);
  const p2 = S.proximaOcorrencia(semanal, p1);
  igual(local(p1, FORTALEZA), '08/09/2026, 08:00', '1ª (terça)');
  igual(local(p2, FORTALEZA), '10/09/2026, 08:00', '2ª (quinta)');
});

medir('«a cada 2 semanas» pula a semana do meio, ancorado na semana do PRIMEIRO envio', () => {
  const cfg = { ...semanal, intervalo: 2, diasSemana: '4' }; // só quinta
  const p1 = S.proximaOcorrencia(cfg, inicioQui);
  const p2 = S.proximaOcorrencia(cfg, p1);
  igual(local(p1, FORTALEZA), '17/09/2026, 08:00', '1ª');
  igual(local(p2, FORTALEZA), '01/10/2026, 08:00', '2ª');
});

medir('sem dia escolhido, herda o dia da PRIMEIRA ocorrência (em vez de ficar mudo)', () => {
  const p = S.proximaOcorrencia({ ...semanal, diasSemana: null }, inicioQui);
  igual(local(p, FORTALEZA), '10/09/2026, 08:00', 'próxima quinta');
});

medir('dias da semana em CSV são normalizados (lixo fora, ordenado, sem repetição)', () => {
  igual(S.normalizarDiasSemana(' 4, 2,2, 9 ,x').join(','), '2,4');
  igual(S.normalizarDiasSemana([6, 0, 0]).join(','), '0,6');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('5. RECORRÊNCIA MENSAL — e o fim de mês, que é onde ela costuma escorregar');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// 31/01/2026 às 09h em Fortaleza = 12h UTC.
const inicio31 = new Date('2026-01-31T12:00:00.000Z');
const mensal = { recorrencia: 'mensal', intervalo: 1, fuso: FORTALEZA, minutoLocal: 9 * 60, inicioEm: inicio31 };

medir('dia 31 + 1 mês vira 28/02 (fevereiro APARA), não 03/03', () => {
  const p = S.proximaOcorrencia(mensal, inicio31);
  igual(local(p, FORTALEZA), '28/02/2026, 09:00', 'fevereiro');
});

medir('e em MARÇO volta para o dia 31 — a âncora não é perdida no aparo', () => {
  const p1 = S.proximaOcorrencia(mensal, inicio31);
  const p2 = S.proximaOcorrencia(mensal, p1);
  igual(local(p2, FORTALEZA), '31/03/2026, 09:00', 'março');
});

medir('«a cada 3 meses» anda de trimestre em trimestre', () => {
  const cfg = { recorrencia: 'mensal', intervalo: 3, fuso: FORTALEZA, minutoLocal: 9 * 60, inicioEm: new Date('2026-01-15T12:00:00.000Z') };
  const p1 = S.proximaOcorrencia(cfg, cfg.inicioEm);
  const p2 = S.proximaOcorrencia(cfg, p1);
  igual(local(p1, FORTALEZA), '15/04/2026, 09:00', '1ª');
  igual(local(p2, FORTALEZA), '15/07/2026, 09:00', '2ª');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('6. A AGENDA ACABA — e acabar é desfecho, não defeito');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

medir('«unica» não tem próxima — nunca', () => {
  igual(S.proximaOcorrencia({ recorrencia: 'unica', inicioEm: inicioQui }, inicioQui), null);
});

medir('`ateEm` corta a grade: a ocorrência DEPOIS do limite não nasce', () => {
  const cfg = { ...diaria2350, ateEm: new Date('2026-09-04T12:00:00.000Z') };
  const p1 = S.proximaOcorrencia(cfg, inicio2350); // 04/09 02h50 UTC — dentro
  verdade(p1, 'a de dentro do limite não saiu');
  igual(S.proximaOcorrencia(cfg, p1), null, 'a de FORA do limite');
});

medir('`maxOcorrencias` corta: batido o teto, não há próxima', () => {
  const cfg = { ...diaria2350, maxOcorrencias: 3 };
  igual(S.proximaOcorrencia({ ...cfg, ocorrenciasFeitas: 2 }, inicio2350) !== null, true, 'ainda dentro do teto');
  igual(S.proximaOcorrencia({ ...cfg, ocorrenciasFeitas: 3 }, inicio2350), null, 'no teto');
});

medir('recorrência desconhecida devolve null em vez de inventar uma grade', () => {
  igual(S.proximaOcorrencia({ recorrencia: 'quinzenal-do-mario', inicioEm: inicioQui }, inicioQui), null);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('7. CANONIZAÇÃO DO INÍCIO — segundos do clique não entram na chave');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

medir('os segundos e milissegundos do navegador são zerados', () => {
  const { instante, minutoLocal } = S.canonizarInicio('2026-09-03T11:00:37.412Z', FORTALEZA);
  igual(instante.toISOString(), '2026-09-03T11:00:00.000Z', 'instante canônico');
  igual(minutoLocal, 8 * 60, 'minuto local (08h em Fortaleza)');
});

medir('data inválida é recusada em vez de virar «Invalid Date» no banco',
  () => recusa(() => S.canonizarInicio('quinta que vem', FORTALEZA), 'inválida'));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('8. VALIDAÇÃO DA ENTRADA — o que a tela pode mandar, e o que é recusado na porta');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const base = {
  titulo: 'Lembrete de consulta',
  mensagem: 'Olá! Sua consulta é amanhã às 14h.',
  cwAccountId: 1,
  cwInboxId: 34,
  inicioEm: '2026-09-03T11:00:00.000Z',
};

medir('um agendamento mínimo válido é aceito e já nasce com `proximaEm`', () => {
  const d = S.validarAgendamento(base);
  igual(d.proximaEm.toISOString(), '2026-09-03T11:00:00.000Z');
  igual(d.minutoLocal, 8 * 60);
  igual(d.fuso, 'America/Fortaleza');
});

medir('SEM CONEXÃO é RECUSADO — «nada sai sem canal» começa no cadastro',
  () => recusa(() => S.validarAgendamento({ ...base, cwInboxId: undefined }), 'sem canal ela não sairia'));

medir('sem mensagem é recusado',
  () => recusa(() => S.validarAgendamento({ ...base, mensagem: '   ' }), 'só espaços'));

medir('semanal sem dia da semana é recusado (senão a agenda ficaria muda)',
  () => recusa(() => S.validarAgendamento({ ...base, recorrencia: 'semanal' }), 'ao menos um dia'));

medir('`usarTemplate` sem o nome do modelo é recusado — é a exigência da Meta, não nossa',
  () => recusa(() => S.validarAgendamento({ ...base, usarTemplate: true }), 'modelo aprovado'));

medir('anexo que não é http(s) é recusado (nada de ler o disco do pod)',
  () => recusa(() => S.validarAgendamento({ ...base, anexoUrl: 'file:///etc/passwd' }), 'http(s)'));

medir('fuso inventado é recusado com o nome dele na mensagem',
  () => recusa(() => S.validarAgendamento({ ...base, fuso: 'America/Nao_Existe' }), 'não é um fuso conhecido'));

medir('`ateEm` antes do começo é recusado',
  () => recusa(() => S.validarAgendamento({ ...base, ateEm: '2026-01-01T00:00:00Z' }), 'antes do começo'));

medir('recorrência fora do vocabulário é recusada, com a lista do que vale',
  () => recusa(() => S.validarAgendamento({ ...base, recorrencia: 'de vez em quando' }), 'unica | diaria'));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('9. DESTINATÁRIOS — o multi-contato começa aqui');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

medir('telefone é normalizado para DÍGITO — as duas formas do mesmo contato viram uma', () => {
  igual(S.normalizarContatoChave('(98) 9 8335-1000'), '98983351000');
  igual(S.normalizarContatoChave('+55 98 98335-1000'), '5598983351000');
});

medir('o mesmo contato repetido no pedido entra UMA vez (senão receberia em dobro)', () => {
  const r = S.validarDestinos(['5598983351000', '+55 98 98335-1000', '5511999998888']);
  igual(r.length, 2, 'destinos distintos');
  return r.map((d) => d.contatoChave).join(' · ');
});

medir('lista vazia é recusada — agenda que dispara para ninguém e diz que deu certo é o pior defeito',
  () => recusa(() => S.validarDestinos([]), 'ao menos um contato'));

medir('número curto demais é recusado, com o valor na mensagem',
  () => recusa(() => S.validarDestinos(['123']), 'curto demais'));

medir('acima do teto de destinatários é recusado (acima disso é campanha)', () => {
  const muitos = Array.from({ length: S.LIMITES.destinos + 1 }, (_, i) => `55989${String(i).padStart(8, '0')}`);
  return recusa(() => S.validarDestinos(muitos), 'no máximo');
});

medir('canal não numérico (e-mail, widget) mantém o identificador como veio', () => {
  igual(S.normalizarContatoChave('cliente@empresa.com.br', 'email'), 'cliente@empresa.com.br');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(80)}`);
console.log(falhas === 0
  ? `✅ ${medicoes} medições, 0 reprovações — a parte pura do agendamento está provada.`
  : `❌ ${medicoes} medições, ${falhas} reprovação(ões).`);
console.log(`${'─'.repeat(80)}\n`);
process.exit(falhas === 0 ? 0 : 1);
