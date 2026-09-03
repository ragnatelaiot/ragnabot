#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ A ORDEM DO DONO, MEDIDA PELA API — contrato S7 (02/09/2026)
//
//   > "colunas whitelabel, empresas e planos só aparecem na conta que vende o SaaS — no caso, na
//   >  Ragnatela. Na conta de cliente elas não aparecem."
//
// ── POR QUE ESTE ARQUIVO SOBE UM SERVIDOR DE VERDADE ───────────────────────────────────────────
// Porque o teste de aceite do contrato NÃO é "o item some do menu". Item de menu escondido com a
// rota respondendo é falha de segurança: o cliente descobre a URL e lê a base comercial de todas
// as outras empresas — plano, valor, vencimento, e-mail. Então aqui não se chama função: sobe-se
// o `app` do `src/servidor.js`, emite-se um cookie de sessão ASSINADO de verdade (o mesmo que o
// navegador receberia em `POST /sessao/entrar`) e mede-se o STATUS HTTP.
//
// O QUE ESTE ARQUIVO TENTA REPROVAR:
//   · conta de CLIENTE pedindo whitelabel / empresas / planos pela API  → tem de dar 403
//   · a mesma conta pedindo pelo endpoint GENÉRICO de painel            → tem de dar 403
//   · as rotas CANÔNICAS (/api/ragnabot/tenants, /api/ragnabot-cobranca) → tem de dar 403
//   · a conta OPERADORA (declarada no ambiente) e o super pelo token    → tem de PASSAR
//   · sem empresa operadora declarada, ninguém de navegador passa       → falha FECHADA
//
// COMO RODAR:  node tests/ragnabot-configuracao-visibilidade.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ⚠️ O AMBIENTE VEM ANTES DO IMPORT. `src/base/auth.js` lê os segredos em constantes de módulo, no
// carregamento — declarar depois seria declarar para ninguém.
const EMPRESA_OPERADORA = '00000000-0000-4000-8000-00000000ffff'; // a Ragnatela, neste teste
const EMPRESA_CLIENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_SERVICO = 'token-de-servico-so-deste-teste';

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';
process.env.RAGNABOT_SESSAO_SEGREDO = crypto.randomBytes(32).toString('hex');
process.env.RAGNABOT_SERVICE_TOKEN = TOKEN_SERVICO;
process.env.RAGNABOT_TENANT_OPERADOR = EMPRESA_OPERADORA;
process.env.NODE_ENV = 'test';

import { criarFakeSimples } from './fixtures/fake-prisma-simples.mjs';

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

const { app } = await import('../src/servidor.js');
const { emitirSessao, cookieDeSessao } = await import('../src/base/auth.js');
const cfg = await import('../src/services/ragnabot-configuracao.service.js');

// Banco de mentira para as rotas que gravam — o que se mede aqui é a TRAVA, não o Postgres.
cfg.configurar({
  db: criarFakeSimples(['ragnabotConfiguracao'], { ragnabotConfiguracao: [['chaveEscopo', 'chave']] }),
});

// ── Sobe o servidor numa porta livre ───────────────────────────────────────────────────────────
const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
const BASE = `http://127.0.0.1:${servidor.address().port}`;

/** O cookie que o navegador receberia. Assinado com o segredo do processo — não é maquete. */
function cookieDe({ sub, nome, papel, tenantId, conta }) {
  const { token } = emitirSessao({ sub, nome, email: `${sub}@exemplo.com`, papel, conta, tenantId });
  return cookieDeSessao(token);
}

const COOKIE_CLIENTE_ADMIN = cookieDe({ sub: 501, nome: 'Admin da empresa cliente', papel: 'administrator', tenantId: EMPRESA_CLIENTE, conta: 7 });
const COOKIE_CLIENTE_AGENTE = cookieDe({ sub: 502, nome: 'Atendente da empresa cliente', papel: 'agent', tenantId: EMPRESA_CLIENTE, conta: 7 });
const COOKIE_OPERADORA = cookieDe({ sub: 1, nome: 'Admin da Ragnatela', papel: 'administrator', tenantId: EMPRESA_OPERADORA, conta: 1 });

async function pedir(caminho, { cookie, metodo = 'GET', corpo = null, servico = false } = {}) {
  const cabecalhos = {};
  if (cookie) cabecalhos.cookie = cookie;
  if (corpo) cabecalhos['content-type'] = 'application/json';
  if (servico) {
    cabecalhos['x-ragnabot-service-token'] = TOKEN_SERVICO;
    cabecalhos['x-ragnabot-ator-papel'] = 'super';
    cabecalhos['x-ragnabot-ator-nome'] = 'Operação Ragnatela (via NOC)';
    cabecalhos['x-ragnabot-ator-id'] = 'noc:1';
  }
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo, headers: cabecalhos, body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

console.log('\n══ A PROVA PRINCIPAL: CONTA DE CLIENTE PEDINDO OS PAINÉIS DO SaaS PELA API ══════════\n');

const AS_TRES = [
  ['WHITELABEL (§8.3)', '/api/ragnabot-config/whitelabel'],
  ['EMPRESAS   (§8.4)', '/api/ragnabot-config/empresas'],
  ['PLANOS     (§8.5)', '/api/ragnabot-config/planos'],
];

for (const [rotulo, caminho] of AS_TRES) {
  await medir(`${rotulo}: ADMINISTRADOR da empresa cliente → 403 NAO_E_OPERADOR_DO_SAAS`, async () => {
    const r = await pedir(caminho, { cookie: COOKIE_CLIENTE_ADMIN });
    console.log(`      ↳ GET ${caminho}  →  ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.status, 403, `esperava 403, veio ${r.status}`);
    assert.equal(r.json.code, 'NAO_E_OPERADOR_DO_SAAS');
    // ⛔ E a recusa não pode vazar nada do conteúdo protegido.
    assert.ok(!JSON.stringify(r.json).includes('plan'), 'a recusa vazou dado comercial');
  });
  await medir(`${rotulo}: ATENDENTE da empresa cliente → 403`, async () => {
    const r = await pedir(caminho, { cookie: COOKIE_CLIENTE_AGENTE });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'NAO_E_OPERADOR_DO_SAAS');
  });
}

await medir('WHITELABEL: cliente tentando ESCREVER (PUT) → 403, não só a leitura', async () => {
  const r = await pedir('/api/ragnabot-config/whitelabel', {
    cookie: COOKIE_CLIENTE_ADMIN, metodo: 'PUT',
    corpo: { valores: { 'whitelabel.nomeDoSistema': 'Marca do cliente' } },
  });
  console.log(`      ↳ PUT /api/ragnabot-config/whitelabel  →  ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NAO_E_OPERADOR_DO_SAAS');
});

await medir('⛔ O DESVIO ÓBVIO: cliente pedindo whitelabel pelo endpoint GENÉRICO de painel → 403', async () => {
  // Sem esta trava, a rota nomeada seria enfeite: bastava trocar /whitelabel por /painel/whitelabel.
  const r = await pedir('/api/ragnabot-config/painel/whitelabel', { cookie: COOKIE_CLIENTE_ADMIN });
  console.log(`      ↳ GET /api/ragnabot-config/painel/whitelabel  →  ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NAO_E_OPERADOR_DO_SAAS');
});

await medir('⛔ O SEGUNDO DESVIO: PUT no painel genérico "whitelabel" → 403', async () => {
  const r = await pedir('/api/ragnabot-config/painel/whitelabel', {
    cookie: COOKIE_CLIENTE_ADMIN, metodo: 'PUT', corpo: { valores: { 'whitelabel.nomeDoSistema': 'x' } },
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NAO_E_OPERADOR_DO_SAAS');
});

await medir('⛔ O TERCEIRO DESVIO: cliente pedindo o CATÁLOGO do whitelabel → 403', async () => {
  const r = await pedir('/api/ragnabot-config/catalogo/whitelabel', { cookie: COOKIE_CLIENTE_ADMIN });
  assert.equal(r.status, 403);
});

console.log('\n══ AS ROTAS CANÔNICAS (que JÁ existiam) TAMBÉM RECUSAM ═════════════════════════════\n');

await medir('EMPRESAS canônica — GET /api/ragnabot/tenants com cookie de cliente → 403', async () => {
  const r = await pedir('/api/ragnabot/tenants', { cookie: COOKIE_CLIENTE_ADMIN });
  console.log(`      ↳ GET /api/ragnabot/tenants  →  ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 403, 'a base comercial de TODAS as empresas ficaria exposta');
});

await medir('PLANOS canônica — GET /api/ragnabot-cobranca/planos com cookie de cliente → 403', async () => {
  const r = await pedir('/api/ragnabot-cobranca/planos', { cookie: COOKIE_CLIENTE_ADMIN });
  console.log(`      ↳ GET /api/ragnabot-cobranca/planos  →  ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 403);
});

await medir('ASSINATURAS canônica — GET /api/ragnabot-cobranca/assinaturas → 403', async () => {
  const r = await pedir('/api/ragnabot-cobranca/assinaturas', { cookie: COOKIE_CLIENTE_ADMIN });
  assert.equal(r.status, 403);
});

console.log('\n══ QUEM DEVE PASSAR, PASSA ═════════════════════════════════════════════════════════\n');

await medir('a conta OPERADORA (declarada no ambiente) NÃO é barrada pela trava', async () => {
  const r = await pedir('/api/ragnabot-config/whitelabel', { cookie: COOKIE_OPERADORA });
  console.log(`      ↳ GET /api/ragnabot-config/whitelabel (operadora)  →  ${r.status}`);
  assert.notEqual(r.status, 403, `a Ragnatela levou 403: ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.escopo, 'operador');
  assert.ok(r.json.itens.length >= 20, 'o painel voltou vazio');
});

await medir('a conta operadora SALVA o whitelabel, e relê o que salvou', async () => {
  const r = await pedir('/api/ragnabot-config/whitelabel', {
    cookie: COOKIE_OPERADORA, metodo: 'PUT',
    corpo: { valores: { 'whitelabel.nomeDoSistema': 'Ragnabot', 'whitelabel.corPrimariaClara': '#0F766E' } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.mudancas.length, 2);
  const nome = r.json.painelAtual.itens.find((i) => i.chave === 'whitelabel.nomeDoSistema');
  assert.equal(nome.valor, 'Ragnabot');
  // A cor volta NORMALIZADA (minúscula) — a tela vê o que ficou gravado, não o que ela mandou.
  const cor = r.json.painelAtual.itens.find((i) => i.chave === 'whitelabel.corPrimariaClara');
  assert.equal(cor.valor, '#0f766e');
});

await medir('o SUPER pelo token de serviço (o NOC) passa — é o caminho do console de operação', async () => {
  const r = await pedir('/api/ragnabot-config/whitelabel', { servico: true });
  console.log(`      ↳ GET /api/ragnabot-config/whitelabel (token de serviço)  →  ${r.status}`);
  assert.equal(r.status, 200);
});

console.log('\n══ O QUE O CLIENTE **PODE**: a configuração DELE ════════════════════════════════════\n');

await medir('o cliente lê e escreve o painel de ATENDIMENTO da empresa dele — 200', async () => {
  const ler = await pedir('/api/ragnabot-config/painel/atendimento', { cookie: COOKIE_CLIENTE_ADMIN });
  assert.equal(ler.status, 200);
  assert.equal(ler.json.tenantId, EMPRESA_CLIENTE);
  const salvar = await pedir('/api/ragnabot-config/painel/atendimento', {
    cookie: COOKIE_CLIENTE_ADMIN, metodo: 'PUT',
    corpo: { valores: { 'atendimento.historicoPor': 'setor' } },
  });
  console.log(`      ↳ PUT /api/ragnabot-config/painel/atendimento  →  ${salvar.status}`);
  assert.equal(salvar.status, 200);
  assert.equal(salvar.json.painelAtual.itens.find((i) => i.chave === 'atendimento.historicoPor').valor, 'setor');
});

await medir('o ATENDENTE lê, mas NÃO escreve — 403 EXIGE_ADMIN (e não 401, que derrubaria a sessão)', async () => {
  const ler = await pedir('/api/ragnabot-config/painel/aparencia', { cookie: COOKIE_CLIENTE_AGENTE });
  assert.equal(ler.status, 200);
  const escrever = await pedir('/api/ragnabot-config/painel/aparencia', {
    cookie: COOKIE_CLIENTE_AGENTE, metodo: 'PUT', corpo: { valores: { 'aparencia.tema': 'escuro' } },
  });
  console.log(`      ↳ PUT (atendente)  →  ${escrever.status} ${JSON.stringify(escrever.json)}`);
  assert.equal(escrever.status, 403);
  assert.equal(escrever.json.code, 'EXIGE_ADMIN');
});

console.log('\n══ O QUE A TELA PERGUNTA AO SERVIDOR (para o menu nunca discordar da API) ══════════\n');

await medir('/quem-sou diz ao cliente que ele NÃO é operador, e omite o painel do operador', async () => {
  const r = await pedir('/api/ragnabot-config/quem-sou', { cookie: COOKIE_CLIENTE_ADMIN });
  console.log(`      ↳ ${JSON.stringify({ operadorDoSaas: r.json.operadorDoSaas, ocultos: r.json.paineisOcultos, paineis: r.json.paineis.length })}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.operadorDoSaas, false);
  assert.deepEqual(r.json.paineisOcultos, ['whitelabel']);
  assert.ok(!r.json.paineis.some((p) => p.id === 'whitelabel'));
  assert.equal(r.json.podeEscrever, true); // é administrador DA EMPRESA DELE
});

await medir('/quem-sou diz à operadora que ela É operadora, e lista o painel do operador', async () => {
  const r = await pedir('/api/ragnabot-config/quem-sou', { cookie: COOKIE_OPERADORA });
  assert.equal(r.json.operadorDoSaas, true);
  assert.equal(r.json.operadorVia, 'empresa-operadora');
  assert.ok(r.json.paineis.some((p) => p.id === 'whitelabel'));
  assert.deepEqual(r.json.paineisOcultos, []);
});

await medir('as decisões do DONO aparecem na API — HubSoft entre elas', async () => {
  const r = await pedir('/api/ragnabot-config/pendentes-de-decisao', { cookie: COOKIE_CLIENTE_ADMIN });
  assert.equal(r.status, 200);
  assert.ok(r.json.itens.some((i) => i.id === 'hubsoft'));
});

console.log('\n══ FALHA FECHADA: SEM EMPRESA OPERADORA DECLARADA, NINGUÉM DE NAVEGADOR PASSA ══════\n');

await medir('tirando RAGNABOT_TENANT_OPERADOR, até a conta da Ragnatela leva 403 — com o MOTIVO', async () => {
  // Permissão que erra para o lado aberto é como se vaza empresa. No pior caso alguém legítimo
  // leva 403 e o chefe declara a variável — com nome e critério.
  delete process.env.RAGNABOT_TENANT_OPERADOR;
  const r = await pedir('/api/ragnabot-config/whitelabel', { cookie: COOKIE_OPERADORA });
  console.log(`      ↳ ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(r.status, 403);
  assert.equal(r.json.motivo, 'empresa-operadora-nao-declarada');
  // …mas o super pelo token de serviço continua passando: o console de operação não depende disso.
  const s = await pedir('/api/ragnabot-config/whitelabel', { servico: true });
  assert.equal(s.status, 200);
  process.env.RAGNABOT_TENANT_OPERADOR = EMPRESA_OPERADORA;
});

await new Promise((ok) => servidor.close(ok));
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
