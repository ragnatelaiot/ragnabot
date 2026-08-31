// ════════════════════════════════════════════════════════════════════════════════════════════════
// TESTE DA AUTENTICAÇÃO — os dois caminhos, e a trava entre eles.
//
// Este arquivo existe por causa de um defeito concreto (contrato S4-AUTH): para servir a tela, o
// motor injetaria o token de serviço no navegador e o papel viajaria em `x-ragnabot-ator-papel`,
// cabeçalho que o cliente escolhe. Quem tivesse o token se declarava `super` e passava por
// `superuserOnly` — o que tranca dinheiro e criação de empresa deixava de trancar.
//
// O teste (c) é a razão de ser deste arquivo: cookie válido + cabeçalho de papel forjado tem de
// resultar no papel DO COOKIE. Se um dia alguém "melhorar" o `authMiddleware` lendo o cabeçalho
// para "enriquecer" a identidade, é aqui que a luz fica vermelha.
//
// Prova por OBSERVAÇÃO: sobe um Express de verdade em porta efêmera e mede a resposta HTTP. Nada
// de espiar variável interna — o que vale é o que o servidor responde.
//
// Como roda (de dentro de `app/`):   node src/base/testes/auth.test.mjs
// Não precisa de banco, nem de plataforma, nem de segredo de produção.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = join(AQUI, '..', '..', '..');           // .../app

// Segredos de teste, gerados na hora. Definidos ANTES do import: `base/auth.js` os lê no momento
// em que o módulo é avaliado (mesma decisão do teste de cifragem).
const SEGREDO = crypto.randomBytes(32).toString('hex');
const TOKEN_SERVICO = crypto.randomBytes(24).toString('hex');
process.env.RAGNABOT_SESSAO_SEGREDO = SEGREDO;
process.env.RAGNABOT_SERVICE_TOKEN = TOKEN_SERVICO;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';   // o teste mede resposta, não enche a tela de linha de log

const auth = await import('../auth.js');
const rotasSessao = (await import('../../rotas-sessao.js')).default;

// ── O servidor de teste ─────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/sessao', rotasSessao);
app.get('/privado', auth.authMiddleware, (req, res) => res.json({ user: req.user }));
app.get('/adm', auth.authMiddleware, auth.adminOnly, (req, res) => res.json({ ok: true, role: req.user.role }));
app.get('/super', auth.authMiddleware, auth.superuserOnly, (req, res) => res.json({ ok: true }));

const servidor = app.listen(0);
await new Promise((ok) => servidor.once('listening', ok));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

async function pedir(caminho, { cookie, cabecalhos = {}, metodo = 'GET', corpo } = {}) {
  const h = { ...cabecalhos };
  if (cookie) h.cookie = `${auth.NOME_COOKIE_SESSAO}=${encodeURIComponent(cookie)}`;
  if (corpo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados, cookies: r.headers.getSetCookie?.() || [] };
}

/** Forja um cookie com o MESMO formato, para os casos de adulteração e vencimento. */
function forjar(corpo, { segredo = SEGREDO } = {}) {
  const conteudo = Buffer.from(JSON.stringify(corpo), 'utf8').toString('base64url');
  const assinatura = crypto.createHmac('sha256', segredo).update(conteudo).digest('base64url');
  return `${conteudo}.${assinatura}`;
}

let ok = 0;
async function teste(nome, fn) {
  try {
    await fn();
    ok++;
    console.log(`   ✅ ${nome}`);
  } catch (e) {
    console.error(`   ❌ ${nome}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n══ AUTENTICAÇÃO DO RAGNABOT — cookie de sessão × token de serviço ══\n');

// Uma sessão legítima de ATENDENTE e uma de ADMINISTRADOR, emitidas como o `/sessao/entrar` emite.
const sessaoAgente = auth.emitirSessao({
  sub: 42, nome: 'Fulana Atendente', email: 'fulana@empresa.test',
  papel: 'agent', conta: 7, tenantId: 'empresa-uuid-a',
});
const sessaoAdmin = auth.emitirSessao({
  sub: 9, nome: 'Beltrano Admin', email: 'beltrano@empresa.test',
  papel: 'administrator', conta: 7, tenantId: 'empresa-uuid-a',
});

// ── (a) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(a) sem cookie e sem token de serviço → 401', async () => {
  const r = await pedir('/privado');
  assert.equal(r.status, 401);
  assert.equal(r.dados.error, 'NAO_AUTENTICADO');
});

// ── (b) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(b) cookie válido → papel vem do conteúdo ASSINADO', async () => {
  const r = await pedir('/privado', { cookie: sessaoAgente.token });
  assert.equal(r.status, 200);
  assert.equal(r.dados.user.role, 'user');                  // agent → user
  assert.equal(r.dados.user.papelNaPlataforma, 'agent');
  assert.equal(r.dados.user.isSuperuser, false);
  assert.equal(r.dados.user.id, 'cw:42');
  assert.equal(r.dados.user.ragnabotTenantId, 'empresa-uuid-a');
  assert.equal(r.dados.user.viaNoc, false);
  assert.equal(r.dados.user.viaPlataforma, true);

  const adm = await pedir('/privado', { cookie: sessaoAdmin.token });
  assert.equal(adm.dados.user.role, 'admin');               // administrator → admin
  assert.equal(adm.dados.user.isSuperuser, false);          // e NUNCA super
});

// ── (c) ⭐ O TESTE QUE ESTA TAREFA EXISTE PARA ESCREVER ─────────────────────────────────────────
await teste('(c) ⭐ cookie válido + cabeçalho de papel forjado "super" → cabeçalho IGNORADO', async () => {
  const forjado = {
    'x-ragnabot-ator-papel': 'super',
    'x-ragnabot-ator-id': 'invasor-1',
    'x-ragnabot-ator-nome': 'Eu Sou o Dono',
  };

  // 1. o papel continua o do cookie, e o id/nome forjados não entram em `req.user`
  const r = await pedir('/privado', { cookie: sessaoAgente.token, cabecalhos: forjado });
  assert.equal(r.status, 200);
  assert.equal(r.dados.user.role, 'user', 'o cabeçalho conseguiu mudar o papel — ESCALADA ABERTA');
  assert.equal(r.dados.user.isSuperuser, false, 'virou super pelo cabeçalho — ESCALADA ABERTA');
  assert.equal(r.dados.user.id, 'cw:42', 'o id do cabeçalho vazou para req.user');
  assert.equal(r.dados.user.name, 'Fulana Atendente');

  // 2. e o que o cabeçalho queria destravar continua trancado
  const s = await pedir('/super', { cookie: sessaoAgente.token, cabecalhos: forjado });
  assert.equal(s.status, 403, 'superuserOnly passou com papel forjado — É O DEFEITO ORIGINAL');

  // 3. nem mesmo o ADMINISTRADOR da conta vira super por cabeçalho
  const sa = await pedir('/super', { cookie: sessaoAdmin.token, cabecalhos: forjado });
  assert.equal(sa.status, 403);

  // 4. mas o administrador continua sendo admin de verdade (a trava não pode virar muro cego)
  const a = await pedir('/adm', { cookie: sessaoAdmin.token, cabecalhos: forjado });
  assert.equal(a.status, 200);
  assert.equal(a.dados.role, 'admin');

  // 5. e o atendente não é admin
  const na = await pedir('/adm', { cookie: sessaoAgente.token, cabecalhos: forjado });
  assert.equal(na.status, 403);
});

// ── (d) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(d) token de serviço + papel no cabeçalho → continua funcionando (ponte intacta)', async () => {
  const comum = { 'x-ragnabot-service-token': TOKEN_SERVICO };

  const sup = await pedir('/super', {
    cabecalhos: { ...comum, 'x-ragnabot-ator-papel': 'super', 'x-ragnabot-ator-id': 'noc-1' },
  });
  assert.equal(sup.status, 200, 'a ponte NOC→motor regrediu');

  const u = await pedir('/privado', {
    cabecalhos: { ...comum, 'x-ragnabot-ator-papel': 'super', 'x-ragnabot-ator-nome': 'Operador NOC' },
  });
  assert.equal(u.dados.user.isSuperuser, true);
  assert.equal(u.dados.user.viaNoc, true, 'a marca de delegação sumiu — a auditoria mentiria');
  assert.equal(u.dados.user.name, 'Operador NOC');

  // token errado não passa
  const mau = await pedir('/privado', { cabecalhos: { 'x-ragnabot-service-token': 'x'.repeat(48) } });
  assert.equal(mau.status, 401);

  // e um cookie ruim junto com o token bom não impede a máquina de trabalhar
  const misto = await pedir('/privado', { cookie: 'lixo.lixo', cabecalhos: { ...comum, 'x-ragnabot-ator-papel': 'admin' } });
  assert.equal(misto.status, 200);
  assert.equal(misto.dados.user.viaNoc, true);
});

// ── (e) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(e) cookie adulterado → recusado', async () => {
  // 1. conteúdo trocado mantendo a assinatura antiga (a tentativa óbvia: virar administrator)
  const partes = sessaoAgente.token.split('.');
  const corpo = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  corpo.papel = 'administrator';
  const conteudoNovo = Buffer.from(JSON.stringify(corpo), 'utf8').toString('base64url');
  const r1 = await pedir('/privado', { cookie: `${conteudoNovo}.${partes[1]}` });
  assert.equal(r1.status, 401, 'conteúdo trocado com assinatura velha foi ACEITO');
  assert.equal(r1.dados.motivo, 'assinatura');

  // 2. assinado com OUTRA chave (quem não tem a nossa não emite sessão)
  const outro = forjar({ ...corpo, papel: 'administrator' }, { segredo: crypto.randomBytes(32).toString('hex') });
  const r2 = await pedir('/privado', { cookie: outro });
  assert.equal(r2.status, 401);

  // 3. lixo sem ponto
  const r3 = await pedir('/privado', { cookie: 'nao-e-um-cookie-de-sessao' });
  assert.equal(r3.status, 401);
  assert.equal(r3.dados.motivo, 'formato');
});

// ── (f) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(f) cookie vencido → recusado (mesmo com assinatura VÁLIDA)', async () => {
  const vencido = forjar({
    v: 1, jid: 'abc', sub: '42', nome: 'Fulana', email: null,
    papel: 'administrator', conta: 7, tenantId: 'empresa-uuid-a',
    iat: Date.now() - 9 * 3600_000, exp: Date.now() - 1000,
  });
  const r = await pedir('/privado', { cookie: vencido });
  assert.equal(r.status, 401, 'sessão vencida foi aceita');
  assert.equal(r.dados.motivo, 'vencida');
});

// ── (g) ─────────────────────────────────────────────────────────────────────────────────────────
await teste('(g) sem RAGNABOT_SESSAO_SEGREDO → a entrada RECUSA (503), e não abre', async () => {
  const roteiro = `
    import express from 'express';
    const rotas = (await import(${JSON.stringify(join(RAIZ_APP, 'src', 'rotas-sessao.js'))})).default;
    const app = express(); app.use(express.json()); app.use('/sessao', rotas);
    const s = app.listen(0);
    await new Promise((ok) => s.once('listening', ok));
    const base = 'http://127.0.0.1:' + s.address().port;
    const r = await fetch(base + '/sessao/entrar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', senha: 'seja-la-o-que-for' }),
    });
    const eu = await fetch(base + '/sessao/eu');
    console.log(JSON.stringify({ entrar: r.status, entrarCorpo: await r.json(), eu: eu.status }));
    s.close();
  `;
  const amb = { ...process.env, LOG_LEVEL: 'error' };
  delete amb.RAGNABOT_SESSAO_SEGREDO;           // ← o ponto do teste
  const filho = spawnSync(process.execPath, ['--input-type=module', '-e', roteiro],
    { cwd: RAIZ_APP, env: amb, encoding: 'utf8' });
  assert.equal(filho.status, 0, `o filho morreu: ${filho.stderr}`);
  const linha = filho.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const out = JSON.parse(linha);
  assert.equal(out.entrar, 503, 'a entrada NÃO recusou sem a chave de assinatura');
  assert.equal(out.entrarCorpo.error, 'SESSAO_NAO_CONFIGURADA');
  assert.equal(out.eu, 503);
});

// ── Extras que valem o preço de rodar ───────────────────────────────────────────────────────────
await teste('(h) GET /sessao/eu: 401 sem cookie, e quem sou eu com cookie — sem segredo nenhum', async () => {
  const sem = await pedir('/sessao/eu');
  assert.equal(sem.status, 401);
  assert.equal(sem.dados.autenticado, false);

  const com = await pedir('/sessao/eu', { cookie: sessaoAdmin.token });
  assert.equal(com.status, 200);
  assert.equal(com.dados.ator.papel, 'admin');
  assert.equal(com.dados.ator.papelNaPlataforma, 'administrator');
  assert.equal(com.dados.empresa.id, 'empresa-uuid-a');
  const texto = JSON.stringify(com.dados);
  assert.ok(!texto.includes(SEGREDO), 'a chave de assinatura vazou na resposta');
  assert.ok(!texto.includes(TOKEN_SERVICO), 'o token de serviço vazou na resposta');
  assert.ok(!texto.includes(sessaoAdmin.token), 'o cookie inteiro voltou no corpo');
});

await teste('(i) POST /sessao/sair: apaga o cookie no navegador E revoga nesta réplica', async () => {
  const efemera = auth.emitirSessao({
    sub: 77, nome: 'Sai Daqui', email: 's@e.test', papel: 'agent', conta: 7, tenantId: 'empresa-uuid-a',
  });
  assert.equal((await pedir('/privado', { cookie: efemera.token })).status, 200);

  const saida = await pedir('/sessao/sair', { cookie: efemera.token, metodo: 'POST' });
  assert.equal(saida.status, 200);
  const set = saida.cookies.join(' | ');
  assert.match(set, /rb_sessao=/);
  assert.match(set, /Max-Age=0/);
  assert.match(set, /HttpOnly/);

  const depois = await pedir('/privado', { cookie: efemera.token });
  assert.equal(depois.status, 401, 'o cookie continuou valendo depois do "sair"');
  assert.equal(depois.dados.motivo, 'revogada');
});

await teste('(j) o cookie emitido é HttpOnly + SameSite=Strict + Secure e ≤ 8 h', async () => {
  const cab = auth.cookieDeSessao('conteudo.assinatura');
  assert.match(cab, /HttpOnly/);
  assert.match(cab, /SameSite=Strict/);
  assert.match(cab, /Secure/);
  assert.match(cab, /Path=\//);
  assert.ok(auth.DURACAO_SESSAO_MS <= 8 * 3600_000, 'a sessão passou de 8 h');
});

await teste('(k) o teto de 8 h não é negociável por variável de ambiente', async () => {
  const amb = { ...process.env, RAGNABOT_SESSAO_HORAS: '720', LOG_LEVEL: 'error' };
  const roteiro = `
    const a = await import(${JSON.stringify(join(RAIZ_APP, 'src', 'base', 'auth.js'))});
    console.log(JSON.stringify({ ms: a.DURACAO_SESSAO_MS }));
  `;
  const filho = spawnSync(process.execPath, ['--input-type=module', '-e', roteiro],
    { cwd: RAIZ_APP, env: amb, encoding: 'utf8' });
  assert.equal(filho.status, 0, filho.stderr);
  const out = JSON.parse(filho.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop());
  assert.equal(out.ms, 8 * 3600_000, '30 dias no ambiente viraram 30 dias de sessão');
});

await teste('(l) sem NENHUM dos dois segredos → 503 falha fechada (nunca aberta)', async () => {
  const roteiro = `
    import express from 'express';
    const a = await import(${JSON.stringify(join(RAIZ_APP, 'src', 'base', 'auth.js'))});
    const app = express();
    app.get('/privado', a.authMiddleware, (req, res) => res.json({ user: req.user }));
    const s = app.listen(0);
    await new Promise((ok) => s.once('listening', ok));
    const r = await fetch('http://127.0.0.1:' + s.address().port + '/privado');
    console.log(JSON.stringify({ status: r.status, corpo: await r.json() }));
    s.close();
  `;
  const amb = { ...process.env, LOG_LEVEL: 'error' };
  delete amb.RAGNABOT_SESSAO_SEGREDO;
  delete amb.RAGNABOT_SERVICE_TOKEN;
  const filho = spawnSync(process.execPath, ['--input-type=module', '-e', roteiro],
    { cwd: RAIZ_APP, env: amb, encoding: 'utf8' });
  assert.equal(filho.status, 0, filho.stderr);
  const out = JSON.parse(filho.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop());
  assert.equal(out.status, 503);
  assert.equal(out.corpo.error, 'AUTH_NAO_CONFIGURADA');
});

await teste('(m) POST /sessao/entrar sem e-mail/senha → 400, e não vai à plataforma', async () => {
  const r = await pedir('/sessao/entrar', { metodo: 'POST', corpo: { email: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.dados.error, 'DADOS_FALTANDO');
});

servidor.close();
console.log(`\n   ${ok} verificações passaram.\n`);
