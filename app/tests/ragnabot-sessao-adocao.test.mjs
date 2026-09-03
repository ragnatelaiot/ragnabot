#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// UMA ENTRADA SÓ — a adoção da sessão da plataforma (contrato S-CLAREZA, 03/09/2026)
//
// POR QUE ESTE ARQUIVO EXISTE. O dono relatou, com todas as letras: *«não entendi nada, por que tem
// outra autenticação para acessar esse /painel… tá muito confuso»*. A senha é a MESMA — a nossa
// entrada confere contra a plataforma —, mas a pessoa digitava duas vezes. A v1.11.00 resolveu um
// sentido (sair do nosso painel para a tela embutida não pede senha de novo). Faltava o inverso, e
// era o que ele vivia: quem JÁ está autenticado na plataforma, ao abrir `/painel/`, levava a NOSSA
// tela de login.
//
// ── ⭐ O QUE ESTE TESTE MEDE DE VERDADE, e é a razão de ele existir ────────────────────────────
// Que o motor **valida contra a plataforma antes de emitir sessão**. O cookie `cw_d_session_info`
// NÃO é `HttpOnly` (por desenho do fornecedor): qualquer script, extensão ou pessoa com o inspetor
// aberto escreve um. Se a PRESENÇA dele bastasse, escrever
// `cw_d_session_info={"access-token":"x","client":"y","uid":"chefe@empresa"}` seria entrar como
// quem se quisesse. A medição «cookie forjado NÃO vira sessão» é o coração deste arquivo.
//
// ── COMO ELE MEDE (sem tocar em produção) ──────────────────────────────────────────────────────
// Sobe uma PLATAFORMA DE MENTIRA em `127.0.0.1` que responde `GET /api/v1/profile` como a de
// verdade responde — o formato foi lido no código da versão em uso (`Api::V1::ProfilesController`
// renderiza a parcial `api/v1/models/_user`, a MESMA do `/auth/sign_in`) — e aponta o motor para
// ela por `RAGNABOT_PLATAFORMA_INTERNA`. O cadastro de empresas é dublado por `mock.module`, porque
// aqui não há banco e um teste que exige Postgres é um teste que ninguém roda.
//
// ── O QUE ELE NÃO MEDE, e não vou fingir que mede ──────────────────────────────────────────────
// Não abre navegador. Que o navegador do dono realmente mande o cookie da plataforma no pedido só
// se prova entrando de verdade no ambiente no ar — essa prova está no relatório, não aqui.
//
// COMO RODAR:  node --experimental-test-module-mocks tests/ragnabot-sessao-adocao.test.mjs
// (a bandeira é do dublê de módulo; o `node --test tests/` da suíte a herda pelo cabeçalho)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import http from 'node:http';
import { mock } from 'node:test';

// A chave de assinatura tem de existir ANTES de `base/auth.js` ser carregado: ele a lê no topo do
// módulo. Definida aqui, e não no ambiente de quem roda — teste que depende do `.env` da máquina
// passa numa e falha noutra.
process.env.RAGNABOT_SESSAO_SEGREDO = 'segredo-de-teste-nao-vale-em-lugar-nenhum';
process.env.NODE_ENV = 'production';   // é onde o cookie tem de sair `Secure`
// `base/crypto.js` entra na carga pela auditoria e recusa subir sem chave — falha FECHADA, e está
// certo assim. Aqui ela é um valor de mentira, e nada é cifrado com ela nesta medição.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

// ── O cadastro de empresas, dublado ────────────────────────────────────────────────────────────
// `empresaDaConta()` consulta `RagnabotTenant`. Sem banco, o módulo real derruba a medição com
// BASE_INDISPONIVEL e o teste passaria a medir a ausência do Postgres, não a adoção.
const EMPRESA = { id: 'emp-1', name: 'Ragnatela', status: 'active' };
let empresaAtual = EMPRESA;
// A trilha de auditoria também é dublada — e não por conforto: «auditoria é requisito de primeira
// classe» nesta casa, e um caminho novo de ENTRADA que não deixasse rastro seria um buraco na
// trilha justamente onde ela mais é lida. Aqui os registros ficam num vetor para serem medidos.
const trilha = [];
mock.module(new URL('../src/base/db.js', import.meta.url).href, {
  defaultExport: {
    ragnabotTenant: { findUnique: async () => empresaAtual },
    ragnabotAuditoria: { create: async (arg) => { trilha.push(arg?.data ?? arg); return { id: 'aud-1' }; } },
  },
});

// ── A plataforma de mentira ────────────────────────────────────────────────────────────────────
// Responde `GET /api/v1/profile` no formato MEDIDO na versão em uso. Guarda os cabeçalhos que
// recebeu, porque parte do que se mede aqui é o que NÃO foi enviado.
const chamadas = [];
let contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'administrator' }];

const plataforma = http.createServer((req, res) => {
  chamadas.push({ url: req.url, metodo: req.method, cabecalhos: req.headers });
  if (req.url !== '/api/v1/profile') { res.writeHead(404).end('{}'); return; }
  if (req.headers['access-token'] !== 'credencial-boa') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: ['You need to sign in or sign up before continuing.'] }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 77,
    uid: 'pessoa@empresa.com.br',
    name: 'Pessoa de Teste',
    email: 'pessoa@empresa.com.br',
    account_id: 1,
    // ⚠️ O papel do TOPO é o da conta mais recentemente ativa, e é a armadilha: quem manda é o
    // `role` de dentro de `accounts[]`, da conta escolhida.
    role: 'agent',
    accounts: contas,
    // O perfil traz o token pessoal de API da pessoa. Ele está aqui de propósito: a medição
    // «nada do perfil vaza para o navegador» só vale se houver algo sensível para vazar.
    access_token: 'token-pessoal-de-api-que-nao-pode-sair-daqui',
  }));
});

await new Promise((ok) => plataforma.listen(0, '127.0.0.1', ok));
process.env.RAGNABOT_PLATAFORMA_INTERNA = `http://127.0.0.1:${plataforma.address().port}`;

// ── O motor, com as rotas de sessão montadas como o servidor as monta ──────────────────────────
const { default: express } = await import('express');
const { default: rotasSessao } = await import('../src/base/../rotas-sessao.js');
const { emitirSessao } = await import('../src/base/auth.js');

const app = express();
app.use(express.json());
app.use('/sessao', rotasSessao);
const motor = app.listen(0, '127.0.0.1');
await new Promise((ok) => motor.once('listening', ok));
const BASE = `http://127.0.0.1:${motor.address().port}`;

// ── Ferramentas de medição ─────────────────────────────────────────────────────────────────────
let verdes = 0; let vermelhos = 0;

async function medir(titulo, fn) {
  chamadas.length = 0;
  trilha.length = 0;
  try { await fn(); console.log(`  ✓ ${titulo}`); verdes++; }
  catch (e) { console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); vermelhos++; }
}

/** O cookie da plataforma como o navegador o manda (o valor é o JSON codificado — medido). */
function cookieDaPlataforma(cred) {
  return `cw_d_session_info=${encodeURIComponent(JSON.stringify(cred))}`;
}

const CREDENCIAL_BOA = {
  'access-token': 'credencial-boa', 'token-type': 'Bearer', client: 'cli-1',
  expiry: String(Math.floor(Date.now() / 1000) + 3600), uid: 'pessoa@empresa.com.br',
};

async function adotar(cookie) {
  const r = await fetch(`${BASE}/sessao/adotar`, {
    method: 'POST',
    headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch { corpo = null; }
  return { status: r.status, corpo, cookies: r.headers.getSetCookie?.() || [], texto };
}

console.log('\nUMA ENTRADA SÓ — adoção da sessão da plataforma\n');

// ── 1. A porta fechada ─────────────────────────────────────────────────────────────────────────
await medir('sem credencial da plataforma, recusa NA HORA — e nem fala com ela', async () => {
  const r = await adotar(null);
  assert.equal(r.status, 401);
  assert.equal(r.corpo.error, 'SEM_CREDENCIAL_DA_PLATAFORMA');
  assert.equal(r.corpo.autenticado, false);
  assert.equal(chamadas.length, 0, 'gastou uma ida à plataforma sem ter o que perguntar');
  assert.equal(r.cookies.length, 0, 'emitiu cookie sem ninguém provar quem é');
});

await medir('cookie ilegível não vira credencial pela metade', async () => {
  const r = await adotar('cw_d_session_info=isto-nao-e-json');
  assert.equal(r.status, 401);
  assert.equal(r.corpo.error, 'SEM_CREDENCIAL_DA_PLATAFORMA');
  assert.equal(chamadas.length, 0);
});

await medir('cookie sem `client` é recusado — meia credencial é nenhuma credencial', async () => {
  const r = await adotar(cookieDaPlataforma({ 'access-token': 'credencial-boa', uid: 'x@y.z' }));
  assert.equal(r.status, 401);
  assert.equal(r.corpo.error, 'SEM_CREDENCIAL_DA_PLATAFORMA');
  assert.equal(chamadas.length, 0);
});

// ── 2. ⭐ O CORAÇÃO: cookie FORJADO não vira sessão ───────────────────────────────────────────
await medir('⛔ COOKIE FORJADO NÃO VIRA SESSÃO — quem responde quem é a pessoa é a plataforma', async () => {
  const r = await adotar(cookieDaPlataforma({
    'access-token': 'inventado-por-quem-abriu-o-inspetor',
    client: 'inventado',
    uid: 'chefe@empresa.com.br',
  }));
  assert.equal(chamadas.length, 1, 'não perguntou à plataforma — aceitou o cookie na palavra');
  assert.equal(r.status, 401);
  assert.equal(r.corpo.error, 'CREDENCIAL_DA_PLATAFORMA_INVALIDA');
  assert.ok(!r.cookies.some((c) => c.startsWith('rb_sessao=')),
    'EMITIU A NOSSA SESSÃO para uma credencial que a plataforma recusou');
});

// ── 3. A validação, por dentro ─────────────────────────────────────────────────────────────────
await medir('a conferência vai com a credencial DA PESSOA e SEM `api_access_token`', async () => {
  await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  const c = chamadas.at(-1);
  assert.equal(c.url, '/api/v1/profile');
  assert.equal(c.metodo, 'GET');
  assert.equal(c.cabecalhos['access-token'], 'credencial-boa');
  assert.equal(c.cabecalhos.client, 'cli-1');
  assert.equal(c.cabecalhos.uid, 'pessoa@empresa.com.br');
  // ⛔ MEDIDO no `Api::BaseController`: com `api_access_token` presente, a plataforma autentica o
  // TOKEN DO PLATFORM APP e não a pessoa. Mandá-lo aqui seria validar a nós mesmos e chamar isso
  // de validação — a falha mais cara possível, porque passa em todo teste ingênuo.
  assert.equal(c.cabecalhos.api_access_token, undefined,
    'mandou o token do Platform App — a plataforma responderia «sim» para nós, não para a pessoa');
});

// ── 4. O caminho feliz ─────────────────────────────────────────────────────────────────────────
await medir('credencial boa vira a NOSSA sessão, sem formulário nenhum', async () => {
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.autenticado, true);
  assert.equal(r.corpo.adotada, true, 'não disse que ninguém digitou nada');
  assert.equal(r.corpo.ator.id, 'cw:77');
  assert.equal(r.corpo.empresa.id, 'emp-1');
  assert.equal(r.corpo.conta.id, 1);
});

await medir('o papel sai da CONTA escolhida, nunca do topo da resposta', async () => {
  // O topo diz `agent`; a conta diz `administrator`. Quem manda é a conta.
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.corpo.ator.papelNaPlataforma, 'administrator');
  assert.equal(r.corpo.ator.papel, 'admin');
});

await medir('a sessão emitida tem as MESMAS travas da entrada por senha', async () => {
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  const nosso = r.cookies.find((c) => c.startsWith('rb_sessao='));
  assert.ok(nosso, 'não emitiu a nossa sessão');
  assert.match(nosso, /HttpOnly/u, 'sessão legível por script');
  assert.match(nosso, /SameSite=Strict/u);
  assert.match(nosso, /Secure/u);
  assert.match(nosso, /Path=\/(;|$)/u);
  // ≤ 8 h é teto do contrato, não padrão negociável.
  const idade = Number((/Max-Age=(\d+)/u.exec(nosso) || [])[1]);
  assert.ok(idade > 0 && idade <= 8 * 3600, `validade fora do teto: ${idade}s`);
});

await medir('⛔ nada do perfil vaza para o navegador (o token pessoal de API fica na plataforma)', async () => {
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.ok(!r.texto.includes('token-pessoal-de-api'), 'o token pessoal saiu na resposta');
  assert.ok(!r.cookies.join(' ').includes('token-pessoal-de-api'));
});

await medir('a adoção NÃO regrava o cookie da plataforma — ele já é do navegador', async () => {
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.ok(!r.cookies.some((c) => c.startsWith('cw_d_session_info=')),
    'reescreveu a credencial do fornecedor sem necessidade');
});

// ── 5. As recusas que continuam recusando ──────────────────────────────────────────────────────
await medir('conta inativa na plataforma continua barrada', async () => {
  contas = [{ id: 1, name: 'Ragnatela', status: 'suspended', role: 'administrator' }];
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.status, 403);
  assert.equal(r.corpo.error, 'CONTA_INATIVA');
  assert.ok(!r.cookies.some((c) => c.startsWith('rb_sessao=')));
});

await medir('papel que a plataforma não reconhece não vira papel padrão generoso', async () => {
  contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'visitante' }];
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.status, 403);
  assert.equal(r.corpo.error, 'PAPEL_DESCONHECIDO');
});

await medir('empresa suspensa no NOSSO cadastro barra a entrada por este caminho também', async () => {
  contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'administrator' }];
  empresaAtual = { ...EMPRESA, status: 'suspended' };
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.status, 403);
  assert.equal(r.corpo.error, 'EMPRESA_SUSPENSA');
  empresaAtual = EMPRESA;
});

await medir('conta da plataforma sem empresa no nosso cadastro ENTRA, mas é avisada', async () => {
  empresaAtual = null;
  const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.empresa, null);
  assert.match(r.corpo.aviso || '', /ainda não está cadastrada/u);
  empresaAtual = EMPRESA;
});

// ── 5b. A trilha ───────────────────────────────────────────────────────────────────────────────
await medir('a adoção deixa rastro com NOME PRÓPRIO na auditoria', async () => {
  contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'administrator' }];
  await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  // Nome próprio, e não «entrada»: quem lê a trilha meses depois precisa distinguir «digitou a
  // senha aqui» de «trouxe a sessão da plataforma». São dois fatos diferentes sobre a mesma pessoa.
  // ⚠️ Os campos da trilha são os NOSSOS (`acao`, `atorId`), não os do NOC (`action`, `userId`):
  // `base/auditoria.js` é um adaptador entre os dois vocabulários. Medir pelo nome errado daria um
  // teste verde que não olha para lugar nenhum.
  const r = trilha.find((x) => x.acao === 'ragnabot_sessao_adotada');
  assert.ok(r, `nenhum registro de adoção: ${JSON.stringify(trilha.map((x) => x.acao))}`);
  assert.equal(r.atorId, 'cw:77');
  assert.equal(r.tenantId, 'emp-1');
  // `auth` é o vocabulário do NOC; o adaptador o traduz para a categoria da casa, `acesso`.
  assert.equal(r.categoria, 'acesso');
});

await medir('recusa que NÃO é credencial vencida também deixa rastro', async () => {
  contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'visitante' }];
  await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
  assert.ok(trilha.some((x) => x.acao === 'ragnabot_sessao_adocao_recusada'),
    'uma recusa de papel desconhecido passou sem registro');
  contas = [{ id: 1, name: 'Ragnatela', status: 'active', role: 'administrator' }];
});

await medir('credencial vencida NÃO enche a trilha (é o caso normal de quem passou da hora)', async () => {
  await adotar(cookieDaPlataforma({ 'access-token': 'venceu', client: 'c', uid: 'x@y.z' }));
  assert.equal(trilha.length, 0,
    'um registro por aba aberta afogaria a trilha justamente quando ela precisar ser lida');
});

// ── 6. Quem já está dentro ─────────────────────────────────────────────────────────────────────
await medir('já tendo a nossa sessão, devolve ela e NÃO bate na plataforma (o caso do F5)', async () => {
  const { token } = emitirSessao({
    sub: 77, nome: 'Pessoa de Teste', email: 'pessoa@empresa.com.br',
    papel: 'administrator', conta: 1, tenantId: 'emp-1',
  });
  const r = await adotar(`rb_sessao=${encodeURIComponent(token)}`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.autenticado, true);
  assert.equal(r.corpo.adotada, false, 'disse que adotou quando a sessão já era dela');
  assert.equal(chamadas.length, 0, 'foi à plataforma sem precisar');
});

// ── 7. A plataforma fora do ar não é «senha inválida» ──────────────────────────────────────────
await medir('resposta que não é JSON vira PLATAFORMA_INACESSIVEL, nunca «não está logado»', async () => {
  const antes = process.env.RAGNABOT_PLATAFORMA_INTERNA;
  // Um endereço que responde HTML — é o que o guarda do "não sou robô" e o proxy fazem.
  const html = http.createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>guarda</html>'); });
  await new Promise((ok) => html.listen(0, '127.0.0.1', ok));
  process.env.RAGNABOT_PLATAFORMA_INTERNA = `http://127.0.0.1:${html.address().port}`;
  try {
    const r = await adotar(cookieDaPlataforma(CREDENCIAL_BOA));
    assert.equal(r.status, 503);
    assert.equal(r.corpo.error, 'PLATAFORMA_INACESSIVEL');
  } finally {
    process.env.RAGNABOT_PLATAFORMA_INTERNA = antes;
    html.close();
  }
});

// ── Fecho ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\nRESULTADO: ${verdes} de ${verdes + vermelhos} medições passaram.\n`);
motor.close();
plataforma.close();
process.exit(vermelhos === 0 ? 0 : 1);
