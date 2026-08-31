// ════════════════════════════════════════════════════════════════════════════════════════════════
// TESTE DA INDEPENDÊNCIA — as três peças que ainda amarravam o Ragnabot ao NOC.
//
// Contrato S5-INDEPENDENCIA. Até 30/08/2026 NENHUMA ESCRITA funcionava neste serviço: os routers
// importavam `services/device.service.js` e `services/otp.service.js` (que ficaram no NOC) e liam
// `prisma.user` (tabela que a base do Ragnabot não tem). Este arquivo prova, por OBSERVAÇÃO, que
// as três amarras se foram — e prova principalmente que elas se foram PARA O LADO FECHADO.
//
// O que é medido aqui:
//   (a) permissão de "grupo": concede a SUPER, NEGA a todo o resto (inclusive a `admin`);
//   (b) segundo fator: emite por e-mail de verdade (servidor SMTP falso, diálogo real), confere,
//       e RECUSA código errado, vencido e depois de 5 tentativas;
//   (c) sem SMTP configurado: emitir AVISA e conferir RECUSA — falha fechada nos dois sentidos;
//   (d) os três pontos do editor de fluxo não tocam mais `prisma.user` (prova por leitura);
//   (e) ponta a ponta por HTTP: `POST /request-otp` com sessão de pessoa manda o código; com a
//       ponte de serviço (token do NOC, sem e-mail de pessoa) RECUSA em vez de passar batido.
//
// ⛔ E o teste também vigia o que NÃO pode aparecer: o código de 6 dígitos e o e-mail do
//    destinatário NÃO podem sair em log nenhum, nem no caminho de erro. O caso (b3) captura a
//    saída padrão durante a emissão e falha se qualquer um dos dois aparecer.
//
// Como roda (de dentro de `app/`):   node src/base/testes/independencia.test.mjs
// Não precisa de banco, nem de plataforma, nem de segredo de produção, nem de rede externa.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_APP = join(AQUI, '..', '..', '..');            // .../app

// Ambiente ANTES dos imports: `base/auth.js` lê os segredos no momento em que é avaliado.
const SEGREDO = crypto.randomBytes(32).toString('hex');
const TOKEN_SERVICO = crypto.randomBytes(24).toString('hex');
process.env.RAGNABOT_SESSAO_SEGREDO = SEGREDO;
process.env.RAGNABOT_SERVICE_TOKEN = TOKEN_SERVICO;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'info';   // `info` de propósito: é o nível em que o 2FA registra a emissão
// Endereço IMPOSSÍVEL de propósito. Lição cara da Etapa 1 (doc 33 §8.3): teste com ambiente
// emprestado bateu no banco de PRODUÇÃO sem avisar. Aqui, se algum caminho tentar consultar o
// banco, ele falha na porta fechada do 127.0.0.1 — nunca em algo real.
process.env.DATABASE_URL = 'postgresql://ninguem:nada@127.0.0.1:1/base_que_nao_existe';

const otp = await import('../../services/otp.service.js');
const { userHasGroupAccess } = await import('../../services/device.service.js');
const auth = await import('../auth.js');

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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// SERVIDOR SMTP FALSO — diálogo de verdade, para o `nodemailer` percorrer o caminho de produção.
// Um dublê de função ("finge que enviou") provaria a nossa própria imaginação; isto prova que a
// mensagem SAI, com o código dentro, pelo transporte real.
// ────────────────────────────────────────────────────────────────────────────────────────────────
function subirSmtpFalso() {
  const recebidas = [];
  const servidor = net.createServer((sock) => {
    let buffer = '';
    let corpo = '';
    let emDados = false;
    sock.write('220 falso ESMTP pronto\r\n');
    sock.on('error', () => { /* o cliente às vezes fecha antes do QUIT; não é falha do teste */ });
    sock.on('data', (pedaco) => {
      buffer += pedaco.toString('utf8');
      for (;;) {
        if (emDados) {
          const fim = buffer.indexOf('\r\n.\r\n');
          if (fim < 0) { corpo += buffer; buffer = ''; return; }
          corpo += buffer.slice(0, fim);
          buffer = buffer.slice(fim + 5);
          emDados = false;
          recebidas.push(corpo);
          corpo = '';
          sock.write('250 2.0.0 aceita\r\n');
          continue;
        }
        const q = buffer.indexOf('\r\n');
        if (q < 0) return;
        const linha = buffer.slice(0, q);
        buffer = buffer.slice(q + 2);
        const c = linha.toUpperCase();
        if (c.startsWith('EHLO')) sock.write('250-falso\r\n250-AUTH PLAIN\r\n250 SIZE 10485760\r\n');
        else if (c.startsWith('HELO')) sock.write('250 falso\r\n');
        else if (c.startsWith('AUTH')) sock.write('235 2.7.0 autenticado\r\n');
        else if (c.startsWith('DATA')) { emDados = true; sock.write('354 pode mandar\r\n'); }
        else if (c.startsWith('QUIT')) { sock.write('221 2.0.0 tchau\r\n'); sock.end(); return; }
        else sock.write('250 2.0.0 ok\r\n');
      }
    });
  });
  return { servidor, recebidas };
}

const { servidor: smtp, recebidas } = subirSmtpFalso();
smtp.listen(0, '127.0.0.1');
await new Promise((pronto) => smtp.once('listening', pronto));
const PORTA_SMTP = smtp.address().port;

/** Liga/desliga a configuração de SMTP — é o interruptor dos casos (b) e (c). */
function ligarSmtp(ligado) {
  if (ligado) {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(PORTA_SMTP);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'motor';
    process.env.SMTP_PASSWORD = 'nao-e-segredo-de-verdade';
    process.env.SMTP_FROM = 'ragnabot@teste.local';
  } else {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
  }
  otp.esquecerTudo();   // limpa o transporte em cache junto com a memória dos códigos
}

/** Decodifica a parte texto da mensagem e devolve o código de 6 dígitos que veio nela. */
function codigoDaMensagem(bruta) {
  const partes = String(bruta).split(/\r\n--[^\r\n]+\r\n/);
  for (const p of partes) {
    if (!/content-type:\s*text\/plain/i.test(p)) continue;
    const corpo = p.slice(p.indexOf('\r\n\r\n') + 4);
    const cte = (p.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1] || '7bit';
    let texto = corpo;
    if (/base64/i.test(cte)) texto = Buffer.from(corpo.replace(/\s+/g, ''), 'base64').toString('utf8');
    else if (/quoted-printable/i.test(cte)) {
      texto = corpo.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g,
        (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
    const achados = [...new Set(texto.match(/\d{6}/g) || [])];
    assert.equal(achados.length, 1, `esperava UM número de 6 dígitos na parte texto, achei ${achados.length}`);
    return achados[0];
  }
  throw new Error('a mensagem não tinha parte "text/plain"');
}

console.log('\n══ INDEPENDÊNCIA DO RAGNABOT — permissão, segundo fator e sessão ══\n');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (a) PERMISSÃO DE "GRUPO" — concede a super, NEGA ao resto
// ════════════════════════════════════════════════════════════════════════════════════════════════
await teste('(a1) papel "super" (só chega pelo token de serviço) → CONCEDE', async () => {
  assert.equal(await userHasGroupAccess('noc:operador', 'super', 'RAGNATELA'), true);
});

await teste('(a2) req.user com isSuperuser=true (mesmo com role "admin") → CONCEDE', async () => {
  assert.equal(await userHasGroupAccess(
    { id: 'noc:op', role: 'admin', isSuperuser: true }, 'admin', 'RAGNATELA'), true);
});

await teste('(a3) ADMIN de empresa (cookie de sessão) → NEGA — não devolve true "para não quebrar"', async () => {
  assert.equal(await userHasGroupAccess('cw:9', 'admin', 'RAGNATELA'), false);
  assert.equal(await userHasGroupAccess(
    { id: 'cw:9', role: 'admin', isSuperuser: false }, 'admin', 'RAGNATELA'), false);
});

await teste('(a4) atendente e ator desconhecido → NEGA', async () => {
  assert.equal(await userHasGroupAccess('cw:42', 'user', 'RAGNATELA'), false);
  assert.equal(await userHasGroupAccess(null, undefined, 'RAGNATELA'), false);
  assert.equal(await userHasGroupAccess('cw:42', 'user', null), false);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (b) SEGUNDO FATOR — emite, confere e recusa
// ════════════════════════════════════════════════════════════════════════════════════════════════
ligarSmtp(true);
const PESSOA = { id: 'cw:42', name: 'Fulana Atendente', email: 'fulana@empresa.test' };

await teste('(b1) sem e-mail na sessão (ponte de serviço) → RECUSA com SEM_EMAIL, e nada é enviado', async () => {
  const antes = recebidas.length;
  const r = await otp.createAndSendEmailOtp('noc:op', 'access_2fa', { id: 'noc:op', name: 'operador (via NOC)' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SEM_EMAIL');
  assert.equal(recebidas.length, antes, 'não podia ter saído mensagem nenhuma');
});

let codigoValido = null;
await teste('(b2) emite → mensagem SAI pelo SMTP com um código de 6 dígitos', async () => {
  const antes = recebidas.length;
  const r = await otp.createAndSendEmailOtp(PESSOA.id, 'access_2fa', PESSOA);
  assert.equal(r.ok, true, r.error || '');
  assert.equal(r.ttlMinutes, 10);
  assert.equal(recebidas.length, antes + 1, 'esperava exatamente UMA mensagem enviada');
  codigoValido = codigoDaMensagem(recebidas[recebidas.length - 1]);
  assert.match(codigoValido, /^\d{6}$/);
});

await teste('(b3) o código e o e-mail NÃO aparecem no log — nem no caminho feliz', async () => {
  const capturado = [];
  const escreverSaida = process.stdout.write.bind(process.stdout);
  const escreverErro = process.stderr.write.bind(process.stderr);
  process.stdout.write = (t, ...r) => { capturado.push(String(t)); return escreverSaida(t, ...r); };
  process.stderr.write = (t, ...r) => { capturado.push(String(t)); return escreverErro(t, ...r); };
  let enviado;
  try {
    enviado = await otp.createAndSendEmailOtp('cw:77', 'access_2fa',
      { id: 'cw:77', name: 'Sicrano', email: 'sicrano@empresa.test' });
  } finally {
    process.stdout.write = escreverSaida;
    process.stderr.write = escreverErro;
  }
  assert.equal(enviado.ok, true);
  const codigo = codigoDaMensagem(recebidas[recebidas.length - 1]);
  const log = capturado.join('');
  assert.ok(log.includes('[2fa] código emitido'), 'o log tinha de registrar a emissão');
  assert.ok(!log.includes(codigo), 'o CÓDIGO vazou para o log');
  assert.ok(!log.includes('sicrano@empresa.test'), 'o E-MAIL do destinatário vazou para o log');
});

await teste('(b4) código ERRADO → recusa (e conta a tentativa)', async () => {
  const errado = String((Number(codigoValido) + 1) % 1000000).padStart(6, '0');
  const r = await otp.verifyEmailOtp(PESSOA.id, errado, 'access_2fa');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALIDO');
  assert.equal(r.restantes, 4);
});

await teste('(b5) código CERTO → confere; e o MESMO código não vale duas vezes', async () => {
  const r1 = await otp.verifyEmailOtp(PESSOA.id, codigoValido, 'access_2fa');
  assert.equal(r1.ok, true);
  const r2 = await otp.verifyEmailOtp(PESSOA.id, codigoValido, 'access_2fa');
  assert.equal(r2.ok, false, 'uso único: a segunda vez tem de recusar');
});

await teste('(b6) código de OUTRO propósito não vale aqui', async () => {
  const r = await otp.createAndSendEmailOtp(PESSOA.id, 'outra_coisa', PESSOA);
  assert.equal(r.ok, true);
  const c = codigoDaMensagem(recebidas[recebidas.length - 1]);
  assert.equal((await otp.verifyEmailOtp(PESSOA.id, c, 'access_2fa')).ok, false);
  assert.equal((await otp.verifyEmailOtp(PESSOA.id, c, 'outra_coisa')).ok, true);
});

await teste('(b7) código VENCIDO → recusa com EXPIRADO', async () => {
  process.env.RAGNABOT_OTP_TTL_MS = '80';      // a variável só ENCURTA; nunca alarga além de 10min
  const r = await otp.createAndSendEmailOtp('cw:55', 'access_2fa',
    { id: 'cw:55', email: 'zezinho@empresa.test' });
  assert.equal(r.ok, true);
  const c = codigoDaMensagem(recebidas[recebidas.length - 1]);
  await new Promise((s) => setTimeout(s, 160));
  const v = await otp.verifyEmailOtp('cw:55', c, 'access_2fa');
  assert.equal(v.ok, false);
  assert.equal(v.code, 'EXPIRADO');
  delete process.env.RAGNABOT_OTP_TTL_MS;
});

await teste('(b8) 5 tentativas erradas QUEIMAM o código — nem o certo passa depois', async () => {
  const r = await otp.createAndSendEmailOtp('cw:66', 'access_2fa',
    { id: 'cw:66', email: 'mariazinha@empresa.test' });
  assert.equal(r.ok, true);
  const certo = codigoDaMensagem(recebidas[recebidas.length - 1]);
  const errado = String((Number(certo) + 7) % 1000000).padStart(6, '0');
  const resultados = [];
  for (let i = 0; i < 5; i++) resultados.push(await otp.verifyEmailOtp('cw:66', errado, 'access_2fa'));
  assert.deepEqual(resultados.map((x) => x.code), ['INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'MUITAS_TENTATIVAS']);
  assert.equal(resultados[4].queimado, true);
  const depois = await otp.verifyEmailOtp('cw:66', certo, 'access_2fa');
  assert.equal(depois.ok, false, 'código queimado não pode voltar a valer');
});

await teste('(b9) formato inválido conta como erro, e não estoura', async () => {
  const r = await otp.createAndSendEmailOtp('cw:88', 'access_2fa', { id: 'cw:88', email: 'a@b.test' });
  assert.equal(r.ok, true);
  for (const lixo of ['', '12345', 'abcdef', '1234567', null, { a: 1 }]) {
    const v = await otp.verifyEmailOtp('cw:88', lixo, 'access_2fa');
    assert.equal(v.ok, false);
  }
});

await teste('(b10) aplicativo autenticador RECUSA sempre, e diz por quê', async () => {
  const v = await otp.verifyTotp(PESSOA.id, '123456');
  assert.equal(v.ok, false);
  assert.equal(v.code, 'TOTP_INDISPONIVEL');
  assert.equal(otp.canaisDe(PESSOA).totp, false);
  assert.equal(otp.canaisDe(PESSOA).email, true);
  assert.equal(otp.canaisDe({ id: 'noc:op' }).email, false);
  assert.equal(otp.dicaDeEmail('fulana@empresa.test'), 'f***@empresa.test');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (c) SEM SMTP — falha FECHADA nos dois sentidos
// ════════════════════════════════════════════════════════════════════════════════════════════════
await teste('(c1) sem SMTP: emitir AVISA (e não envia nada)', async () => {
  ligarSmtp(false);
  const antes = recebidas.length;
  const r = await otp.createAndSendEmailOtp(PESSOA.id, 'access_2fa', PESSOA);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SMTP_NAO_CONFIGURADO');
  assert.match(r.error, /SMTP_HOST/);          // diz QUAL variável falta, sem revelar valor nenhum
  assert.equal(recebidas.length, antes);
  assert.equal(otp.smtpConfigurado().ok, false);
});

await teste('(c2) sem SMTP: CONFERIR recusa — mesmo com um código emitido antes', async () => {
  ligarSmtp(true);
  const r = await otp.createAndSendEmailOtp('cw:99', 'access_2fa', { id: 'cw:99', email: 'x@y.test' });
  assert.equal(r.ok, true);
  const c = codigoDaMensagem(recebidas[recebidas.length - 1]);
  delete process.env.SMTP_HOST;               // o SMTP some, o código continua na memória
  const v = await otp.verifyEmailOtp('cw:99', c, 'access_2fa');
  assert.equal(v.ok, false, 'segundo fator sem envio configurado NÃO pode aprovar');
  assert.equal(v.code, 'SMTP_NAO_CONFIGURADO');
  ligarSmtp(true);
});

await teste('(c3) meia credencial (usuário sem senha) é dita, não engolida', async () => {
  ligarSmtp(true);
  delete process.env.SMTP_PASSWORD;
  const s = otp.smtpConfigurado();
  assert.equal(s.ok, false);
  assert.match(s.motivo, /SMTP_USER e SMTP_PASSWORD/);
  ligarSmtp(true);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (d) O EDITOR DE FLUXO NÃO TOCA MAIS `prisma.user` — prova por LEITURA
// ════════════════════════════════════════════════════════════════════════════════════════════════
await teste('(d) grep por uso de `prisma.user.<algo>` em ragnabot-fluxo.routes.js → ZERO', async () => {
  const alvo = join(RAIZ_APP, 'src', 'routes', 'ragnabot-fluxo.routes.js');
  const g = spawnSync('grep', ['-c', '-E', 'prisma[[:space:]]*\\.[[:space:]]*user[[:space:]]*\\.', alvo],
    { encoding: 'utf8' });
  const quantos = parseInt((g.stdout || '0').trim(), 10) || 0;
  console.log(`      grep -c 'prisma\\s*\\.\\s*user\\s*\\.' → ${quantos}`);
  assert.equal(quantos, 0, 'ainda há uso da tabela de usuários DO NOC no editor de fluxo');
  // Cinto e suspensório: a leitura direta do arquivo, para o caso de o `grep` do sistema faltar.
  const fonte = fs.readFileSync(alvo, 'utf8');
  assert.equal((fonte.match(/prisma\s*\.\s*user\s*\./g) || []).length, 0);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// (e) PONTA A PONTA POR HTTP — o router de verdade, com a autenticação de verdade
// ════════════════════════════════════════════════════════════════════════════════════════════════
ligarSmtp(true);
const rotasFluxo = (await import('../../routes/ragnabot-fluxo.routes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/ragnabot-fluxo', auth.authMiddleware, rotasFluxo);
const http = app.listen(0, '127.0.0.1');
await new Promise((pronto) => http.once('listening', pronto));
const BASE = `http://127.0.0.1:${http.address().port}`;

const sessaoPessoa = auth.emitirSessao({
  sub: 42, nome: 'Fulana Atendente', email: 'fulana@empresa.test',
  papel: 'administrator', conta: 7, tenantId: 'empresa-uuid-a',
});

async function pedir(caminho, { cookie, cabecalhos = {}, corpo } = {}) {
  const h = { 'content-type': 'application/json', ...cabecalhos };
  if (cookie) h.cookie = `${auth.NOME_COOKIE_SESSAO}=${encodeURIComponent(cookie)}`;
  const r = await fetch(`${BASE}${caminho}`, { method: 'POST', headers: h, body: JSON.stringify(corpo || {}) });
  return { status: r.status, dados: await r.json().catch(() => null) };
}

await teste('(e1) POST /request-otp com sessão de PESSOA → 200 e o código sai por e-mail', async () => {
  const antes = recebidas.length;
  const r = await pedir('/api/ragnabot-fluxo/request-otp', { cookie: sessaoPessoa.token, corpo: { channel: 'email' } });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.sent, true);
  assert.equal(r.dados.emailHint, 'f***@empresa.test');
  assert.equal(recebidas.length, antes + 1);
  // ⛔ o corpo da resposta NÃO pode conter o código: quem vê a resposta não é quem lê o e-mail.
  const codigo = codigoDaMensagem(recebidas[recebidas.length - 1]);
  assert.ok(!JSON.stringify(r.dados).includes(codigo), 'o código voltou na resposta HTTP');
});

await teste('(e2) POST /request-otp pela PONTE DE SERVIÇO (sem e-mail de pessoa) → RECUSA', async () => {
  const antes = recebidas.length;
  const r = await pedir('/api/ragnabot-fluxo/request-otp', {
    cabecalhos: {
      'x-ragnabot-service-token': TOKEN_SERVICO,
      'x-ragnabot-ator-id': 'noc:emmanuel',
      'x-ragnabot-ator-papel': 'super',
    },
    corpo: { channel: 'email' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.dados.code, 'SEM_CANAL_2FA');
  assert.equal(recebidas.length, antes, 'não podia ter saído e-mail nenhum');
});

await teste('(e3) POST /request-otp pedindo aplicativo autenticador → 400 dizendo que não existe', async () => {
  const r = await pedir('/api/ragnabot-fluxo/request-otp', { cookie: sessaoPessoa.token, corpo: { channel: 'totp' } });
  assert.equal(r.status, 400);
  assert.equal(r.dados.code, 'TOTP_INDISPONIVEL');
});

await teste('(e4) sem SMTP, POST /request-otp → 503, e a tela NÃO recebe "sent:true"', async () => {
  ligarSmtp(false);
  const r = await pedir('/api/ragnabot-fluxo/request-otp', { cookie: sessaoPessoa.token, corpo: { channel: 'email' } });
  assert.equal(r.status, 503);
  assert.equal(r.dados.code, 'SMTP_NAO_CONFIGURADO');
  assert.notEqual(r.dados.sent, true);
  ligarSmtp(true);
});

http.close();
smtp.close();
console.log(`\n   ${ok} verificações passaram.\n`);
