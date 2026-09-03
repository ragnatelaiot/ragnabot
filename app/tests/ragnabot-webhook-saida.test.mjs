#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WEBHOOK DE SAÍDA — contrato S6 (02/09/2026), doc 34 §F9.4.2 a §F9.4.4
//
// O QUE ESTE ARQUIVO TENTA REPROVAR, item a item do contrato:
//   · «assinatura HMAC do webhook de saída confere»           → conferida NO FIO, do lado do
//                                                                destino, com o crypto do Node
//   · «reentrega com recuo e teto»                            → recuo puro + fila que reagenda
//   · «webhook que cai sem retentativa perde evento em silêncio» → o oposto disso, medido
//   · «segredo cifrado e nunca em log»                        → varredura do log capturado
//
// ⚠️ O QUE ELE **NÃO** PROVA: que um destino REAL na internet aceita a nossa entrega. Em
// 02/09/2026 não há nenhum webhook cadastrado na plataforma e o carteiro está DESLIGADO por
// decisão do chefe. A rede é um dublê — o que se mede é o que SAI pelo fio (cabeçalhos, bytes,
// assinatura) e o que o nosso lado faz com a resposta.
//
// COMO RODAR:  node tests/ragnabot-webhook-saida.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';

import { criarFakeSimples } from './fixtures/fake-prisma-simples.mjs';

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const wh = await import('../src/services/ragnabot-webhook-saida.service.js');
const cripto = await import('../src/base/crypto.js');

const LOG = [];
const logEspiao = { info: (m) => LOG.push(String(m)), warn: (m) => LOG.push(String(m)), error: (m) => LOG.push(String(m)), debug: (m) => LOG.push(String(m)) };

const TENANT = 'empresa-1';

// ── O DESTINO DE MENTIRA ───────────────────────────────────────────────────────────────────────
// Ele guarda TUDO que recebeu (url, cabeçalhos, corpo cru) e responde o que mandarmos. É por ele
// que se afirma «a assinatura confere» — porque a conferência é feita do lado DELE, com o crypto
// do Node, sem usar o nosso código de assinar.
function criarDestino() {
  const recebidas = [];
  let resposta = { status: 200, corpo: 'ok' };
  return {
    recebidas,
    responderCom(r) { resposta = r; },
    async buscar(url, opcoes) {
      recebidas.push({ url, metodo: opcoes.method, cabecalhos: opcoes.headers, corpo: opcoes.body });
      if (resposta instanceof Error) throw resposta;
      return { status: resposta.status, text: async () => resposta.corpo };
    },
  };
}

// Relógio controlado: é o que permite medir o recuo sem esperar 30 segundos.
let RELOGIO = new Date('2026-09-02T12:00:00.000Z');
const agora = () => new Date(RELOGIO);
const avancar = (ms) => { RELOGIO = new Date(RELOGIO.getTime() + ms); };

const db = criarFakeSimples(
  ['ragnabotWebhookSaida', 'ragnabotWebhookEntrega'],
  { ragnabotWebhookEntrega: [['chave']] },
);
const destino = criarDestino();
wh.configurarWebhookSaida({ db, log: logEspiao, agora, buscar: destino.buscar, auditoria: { registrar: async () => null } });

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) O RECUO — peça PURA, medida sem relógio e sem rede');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('o recuo CRESCE a cada tentativa (30 s · 2 min · 8 min · 32 min · 2 h · 6 h)', () => {
  const vistos = [1, 2, 3, 4, 5, 6].map(wh.recuoMs);
  assert.deepEqual(vistos, [30_000, 120_000, 480_000, 1_920_000, 7_200_000, 21_600_000]);
  for (let i = 1; i < vistos.length; i++) assert.ok(vistos[i] > vistos[i - 1], 'o recuo tem de crescer');
});

await medir('⚠️ o recuo tem TETO — sem ele a 12ª tentativa cairia daqui a semanas', () => {
  assert.equal(wh.recuoMs(7), wh.TETO_RECUO_MS);
  assert.equal(wh.recuoMs(50), wh.TETO_RECUO_MS);
  assert.equal(wh.TETO_RECUO_MS, 21_600_000);
});

await medir('tentativa inválida (0, negativa, texto) não vira NaN nem espera infinita', () => {
  for (const ruim of [0, -3, null, undefined, 'abc']) {
    const r = wh.recuoMs(ruim);
    assert.ok(Number.isFinite(r) && r > 0, `recuo inválido para ${String(ruim)}: ${r}`);
  }
});

await medir('a chave de idempotência é determinística e não depende do relógio', () => {
  const a = wh.chaveDaEntrega('w1', 'conversa.criada', 'c-99');
  const b = wh.chaveDaEntrega('w1', 'conversa.criada', 'c-99');
  const c = wh.chaveDaEntrega('w2', 'conversa.criada', 'c-99');
  assert.equal(a, b);
  assert.notEqual(a, c, 'destinos diferentes têm de gerar entregas diferentes');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) O CADASTRO DO DESTINO');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('URL http é RECUSADA com o motivo (o corpo carrega dado de atendimento)', () => {
  const r = wh.validarUrl('http://exemplo.com.br/hook');
  assert.equal(r.ok, false);
  assert.match(r.motivo, /Só aceitamos https/u);
});

await medir('⛔ endereço da rede INTERNA é recusado — inclusive o de metadados de nuvem', () => {
  for (const u of ['https://localhost/h', 'https://127.0.0.1/h', 'https://10.0.0.5/h',
    'https://192.168.1.1/h', 'https://172.20.11.2/h', 'https://169.254.169.254/latest/meta-data',
    'https://banco-lider.svc/h', 'https://algo.cluster.local/h']) {
    const r = wh.validarUrl(u);
    assert.equal(r.ok, false, `deixou passar ${u}`);
    assert.match(r.motivo, /rede interna/u);
  }
});

await medir('URL https pública é aceita', () => {
  assert.equal(wh.validarUrl('https://erp.cliente.com.br/ragnabot').ok, true);
});

const cadastro = await wh.cadastrarWebhook(TENANT, {
  nome: 'ERP do cliente', url: 'https://erp.cliente.com.br/ragnabot',
  eventos: ['conversa.criada', 'conversa.resolvida'],
}, { ator: { id: 'u1', name: 'Operador' } });

await medir('o cadastro devolve o segredo em claro UMA vez, e guarda cifrado', () => {
  assert.match(cadastro.segredo, /^[0-9a-f]{64}$/u);
  const linha = db.__tabelas.ragnabotWebhookSaida[0];
  assert.notEqual(linha.segredoCifrado, cadastro.segredo);
  assert.equal(cripto.decrypt(linha.segredoCifrado), cadastro.segredo);
  assert.match(linha.segredoDigital, /^sha256:[0-9a-f]{16}$/u);
});

await medir('⛔ a listagem não devolve o segredo nem o cifrado', async () => {
  const texto = JSON.stringify(await wh.listarWebhooks(TENANT));
  assert.ok(!texto.includes(cadastro.segredo));
  assert.ok(!texto.includes('segredoCifrado'));
});

await medir('evento inventado é recusado, listando os conhecidos', async () => {
  await assert.rejects(
    () => wh.cadastrarWebhook(TENANT, { nome: 'Destino de teste', url: 'https://a.com.br/h', eventos: ['coisa.qualquer'] }),
    /Conhecidos:/u,
  );
});

await medir('o filtro de interesse respeita evento e conexão', () => {
  const todos = { ativo: true, eventos: [], cwInboxId: null };
  const soUm = { ativo: true, eventos: ['conversa.criada'], cwInboxId: null };
  const daConexao = { ativo: true, eventos: [], cwInboxId: 34 };
  assert.equal(wh.interessa(todos, 'mensagem.recebida', 34), true);
  assert.equal(wh.interessa(soUm, 'mensagem.recebida', 34), false);
  assert.equal(wh.interessa(soUm, 'conversa.criada', 34), true);
  assert.equal(wh.interessa(daConexao, 'conversa.criada', 35), false);
  assert.equal(wh.interessa(daConexao, 'conversa.criada', 34), true);
  assert.equal(wh.interessa({ ...todos, ativo: false }, 'conversa.criada', 34), false);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) ENFILEIRAR — o mesmo fato NÃO vira duas entregas');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const primeira = await wh.enfileirar(TENANT, 'conversa.criada', { idDoEvento: 'conversa-777', cwInboxId: 34, dados: { protocolo: 'RGT-0000000001' } });

await medir('o fato entrou na fila para o destino interessado', () => {
  assert.equal(primeira.enfileiradas, 1);
  assert.equal(primeira.repetidas, 0);
  assert.equal(db.__tabelas.ragnabotWebhookEntrega.length, 1);
});

await medir('⭐ o MESMO fato reprocessado NÃO enfileira de novo — é o Postgres recusando', async () => {
  const r = await wh.enfileirar(TENANT, 'conversa.criada', { idDoEvento: 'conversa-777', cwInboxId: 34, dados: { protocolo: 'RGT-0000000001' } });
  assert.equal(r.enfileiradas, 0);
  assert.equal(r.repetidas, 1, 'colisão de chave é o caminho FELIZ, não erro');
  assert.equal(db.__tabelas.ragnabotWebhookEntrega.length, 1);
});

await medir('evento que o destino NÃO pediu não entra na fila dele', async () => {
  const r = await wh.enfileirar(TENANT, 'mensagem.recebida', { idDoEvento: 'msg-1', cwInboxId: 34 });
  assert.equal(r.destinos, 0);
  assert.equal(r.enfileiradas, 0);
});

await medir('evento SEM identificador do fato é recusado — sem ele não há idempotência', async () => {
  await assert.rejects(() => wh.enfileirar(TENANT, 'conversa.criada', { cwInboxId: 34 }), /identificador do fato/u);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ⭐ A ENTREGA — a assinatura conferida DO LADO DO DESTINO');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const passada = await wh.entregarPendentes({});

await medir('a entrega saiu e foi aceita', () => {
  assert.equal(passada.entregues, 1);
  assert.equal(destino.recebidas.length, 1);
  assert.equal(db.__tabelas.ragnabotWebhookEntrega[0].estado, 'entregue');
  assert.equal(db.__tabelas.ragnabotWebhookEntrega[0].httpStatus, 200);
});

await medir('⭐ a assinatura CONFERE: HMAC-SHA256 do corpo cru, com o segredo do destino', () => {
  const r = destino.recebidas[0];
  const cabecalho = r.cabecalhos['x-hub-signature-256'];
  assert.ok(cabecalho, 'não veio o cabeçalho de assinatura');
  assert.match(cabecalho, /^sha256=[0-9a-f]{64}$/u);
  // ⚠️ Conferência feita AQUI, com o crypto do Node, sobre os BYTES que trafegaram — sem chamar
  // nada do nosso código de assinar. É a única forma de o teste não provar a si mesmo.
  const esperado = crypto.createHmac('sha256', cadastro.segredo).update(r.corpo).digest('hex');
  assert.equal(cabecalho, `sha256=${esperado}`);
});

await medir('o segredo vai TAMBÉM como portador (padrão que o cliente já conhece do portal medido)', () => {
  assert.equal(destino.recebidas[0].cabecalhos.authorization, `Bearer ${cadastro.segredo}`);
});

await medir('o corpo tem o envelope estável: evento, id, empresa, conexão, hora e dados', () => {
  const corpo = JSON.parse(destino.recebidas[0].corpo.toString('utf8'));
  assert.equal(corpo.evento, 'conversa.criada');
  assert.equal(corpo.id, 'conversa-777');
  assert.equal(corpo.empresa, TENANT);
  assert.equal(corpo.conexao, 34);
  assert.equal(corpo.dados.protocolo, 'RGT-0000000001');
  assert.ok(corpo.emitidoEm);
});

await medir('os cabeçalhos de diagnóstico dizem qual entrega e qual tentativa', () => {
  const c = destino.recebidas[0].cabecalhos;
  assert.equal(c['x-ragnabot-evento'], 'conversa.criada');
  assert.equal(c['x-ragnabot-tentativa'], '1');
  assert.ok(c['x-ragnabot-entrega']);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ⭐ REENTREGA COM RECUO — o destino cai e o evento NÃO some');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await wh.enfileirar(TENANT, 'conversa.resolvida', { idDoEvento: 'conversa-888', cwInboxId: 34, dados: {} });
destino.responderCom({ status: 503, corpo: 'em manutenção' });
const antesDaFalha = destino.recebidas.length;
await wh.entregarPendentes({});

const linhaFalha = () => db.__tabelas.ragnabotWebhookEntrega.find((l) => l.idDoEvento === 'conversa-888');

await medir('o destino respondeu 503 e a entrega ficou como FALHOU, não como perdida', () => {
  assert.equal(linhaFalha().estado, 'falhou');
  assert.equal(linhaFalha().tentativa, 1);
  assert.equal(linhaFalha().httpStatus, 503);
  assert.match(linhaFalha().erro, /503/u);
});

await medir('⭐ a próxima tentativa foi AGENDADA no banco (coluna, não `setTimeout`)', () => {
  const esperado = new Date(RELOGIO.getTime() + wh.recuoMs(1));
  assert.equal(new Date(linhaFalha().proximaEm).getTime(), esperado.getTime());
});

await medir('antes da hora, o carteiro NÃO tenta de novo (é o recuo funcionando)', async () => {
  avancar(10_000); // 10 s < 30 s
  const antes = destino.recebidas.length;
  await wh.entregarPendentes({});
  assert.equal(destino.recebidas.length, antes, 'tentou antes do recuo vencer');
});

await medir('vencido o recuo, ele TENTA de novo — e o recuo cresce', async () => {
  avancar(25_000); // agora já passou de 30 s desde a falha
  const antes = destino.recebidas.length;
  await wh.entregarPendentes({});
  assert.equal(destino.recebidas.length, antes + 1, 'não repetiu a entrega');
  assert.equal(linhaFalha().tentativa, 2);
  assert.equal(new Date(linhaFalha().proximaEm).getTime(), RELOGIO.getTime() + wh.recuoMs(2));
});

await medir('o corpo REENVIADO é byte a byte o mesmo — a assinatura continua conferindo', () => {
  const a = destino.recebidas[antesDaFalha];
  const b = destino.recebidas[destino.recebidas.length - 1];
  assert.equal(a.corpo.toString('utf8'), b.corpo.toString('utf8'), 'remontar o corpo mudaria a assinatura entre tentativas');
  assert.equal(a.cabecalhos['x-hub-signature-256'], b.cabecalhos['x-hub-signature-256']);
  assert.equal(b.cabecalhos['x-ragnabot-tentativa'], '2');
});

await medir('quando o destino volta, a entrega é aceita e o disjuntor zera', async () => {
  destino.responderCom({ status: 200, corpo: 'ok' });
  avancar(wh.recuoMs(2) + 1000);
  await wh.entregarPendentes({});
  assert.equal(linhaFalha().estado, 'entregue');
  assert.equal(db.__tabelas.ragnabotWebhookSaida[0].falhasSeguidas, 0);
  assert.equal(db.__tabelas.ragnabotWebhookSaida[0].pausadoAte, null);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n6) ⭐ O TETO — esgotadas as tentativas, DESISTE e registra (nunca em silêncio)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await wh.enfileirar(TENANT, 'conversa.resolvida', { idDoEvento: 'conversa-999', cwInboxId: 34, dados: {} });
destino.responderCom(new Error('ECONNREFUSED'));
const teimosa = () => db.__tabelas.ragnabotWebhookEntrega.find((l) => l.idDoEvento === 'conversa-999');

for (let i = 0; i < 8; i++) {
  await wh.entregarPendentes({});
  avancar(wh.TETO_RECUO_MS + 1000);
  // O disjuntor pode ter posto o destino em repouso: avançamos além dele também.
  const w = db.__tabelas.ragnabotWebhookSaida[0];
  if (w.pausadoAte && new Date(w.pausadoAte) > RELOGIO) RELOGIO = new Date(new Date(w.pausadoAte).getTime() + 1000);
}

await medir('depois de esgotar as tentativas, a entrega vira DESISTIU com o motivo escrito', () => {
  assert.equal(teimosa().estado, 'desistiu');
  assert.equal(teimosa().tentativa, teimosa().maxTentativas);
  assert.match(teimosa().erro, /ECONNREFUSED|falha/u);
});

await medir('desistir grita no log como ERRO — informação perdida não pode passar como aviso', () => {
  assert.ok(LOG.some((l) => /DESISTI da entrega/u.test(l)), 'o log não registrou a desistência');
});

await medir('⭐ desistida NÃO se repete sozinha (mesma decisão do agendamento e da caixa de saída)', async () => {
  const antes = destino.recebidas.length;
  avancar(wh.TETO_RECUO_MS * 10);
  await wh.entregarPendentes({});
  assert.equal(destino.recebidas.length, antes, 'uma entrega desistida voltou a tentar sozinha');
});

await medir('o disjuntor pôs o destino em repouso depois de falhas seguidas', () => {
  const w = db.__tabelas.ragnabotWebhookSaida[0];
  assert.ok(w.falhasSeguidas >= wh.FALHAS_PARA_PAUSAR, `falhas seguidas: ${w.falhasSeguidas}`);
});

await medir('o REENVIO MANUAL devolve a entrega à fila, zerando a rodada', async () => {
  destino.responderCom({ status: 200, corpo: 'ok' });
  const r = await wh.reenviar(TENANT, teimosa().id, { ator: { id: 'u1' } });
  assert.equal(r.ok, true);
  assert.equal(teimosa().estado, 'pendente');
  assert.equal(teimosa().tentativa, 0, 'é decisão humana NOVA, não a continuação da rodada anterior');
  // e agora ela entrega
  db.__tabelas.ragnabotWebhookSaida[0].pausadoAte = null;
  await wh.entregarPendentes({});
  assert.equal(teimosa().estado, 'entregue');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n7) SEGREDO E ESTADO');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('⛔ nenhum segredo entrou no log em NENHUM momento desta bateria', () => {
  const tudo = LOG.join('\n');
  assert.ok(tudo.length > 0);
  assert.ok(!tudo.includes(cadastro.segredo), 'o segredo do webhook vazou para o log');
  assert.ok(!tudo.includes(cadastro.segredo.slice(0, 16)));
});

await medir('regenerar o segredo do destino faz a assinatura MUDAR na entrega seguinte', async () => {
  const r = await wh.regenerarSegredoDoWebhook(TENANT, cadastro.webhook.id, { ator: { id: 'u1' } });
  assert.notEqual(r.segredo, cadastro.segredo);
  await wh.enfileirar(TENANT, 'conversa.criada', { idDoEvento: 'conversa-1010', cwInboxId: 34, dados: {} });
  const antes = destino.recebidas.length;
  await wh.entregarPendentes({});
  assert.equal(destino.recebidas.length, antes + 1);
  const ultima = destino.recebidas[destino.recebidas.length - 1];
  const comNovo = crypto.createHmac('sha256', r.segredo).update(ultima.corpo).digest('hex');
  const comVelho = crypto.createHmac('sha256', cadastro.segredo).update(ultima.corpo).digest('hex');
  assert.equal(ultima.cabecalhos['x-hub-signature-256'], `sha256=${comNovo}`);
  assert.notEqual(ultima.cabecalhos['x-hub-signature-256'], `sha256=${comVelho}`);
  assert.equal(ultima.cabecalhos.authorization, `Bearer ${r.segredo}`);
});

await medir('o carteiro está DESLIGADO por padrão — nada liga sozinho', () => {
  const e = wh.estadoDoCarteiro();
  assert.equal(e.ligado, false);
});

await medir('a listagem de entregas NÃO devolve o corpo (ele carrega dado de atendimento)', async () => {
  const lista = await wh.listarEntregas(TENANT, {});
  assert.ok(lista.length > 0);
  for (const l of lista) assert.equal(l.corpo, undefined);
  assert.ok(lista[0].estado && lista[0].evento);
});

await medir('empresa 2 não enxerga entrega nenhuma da empresa 1', async () => {
  assert.deepEqual(await wh.listarEntregas('empresa-2', {}), []);
  assert.deepEqual(await wh.listarWebhooks('empresa-2'), []);
});

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
