// ════════════════════════════════════════════════════════════════════════════════════════════════
// QUEM AUTENTICA NA APLICAÇÃO DO RAGNABOT — decisão do chefe, 30/08/2026 (doc 33 §7)
//
// O agente da Etapa 1 fez a pergunta certa e NÃO copiou o `authMiddleware` do NOC: copiar seria
// levar o acoplamento junto na mudança de casa. Este arquivo é a resposta — hoje com DOIS caminhos.
//
// ── CAMINHO 1: PESSOA (navegador) — cookie de sessão assinado ────────────────────────────────────
// A pessoa entra com a conta DELA na plataforma (`POST /sessao/entrar`, em `src/rotas-sessao.js`).
// Quem confere e-mail e senha é o Chatwoot, não nós; nós recebemos de volta QUEM É e QUAL O PAPEL
// (`administrator` | `agent`) e emitimos um cookie ASSINADO com esse papel DENTRO do conteúdo.
// A senha não é guardada em lugar nenhum — nem em memória além da chamada.
//
// ── CAMINHO 2: MÁQUINA (NOC → Ragnabot) — token de serviço + ator asserido ───────────────────────
// Continua exatamente como estava: o NOC chama com `RAGNABOT_SERVICE_TOKEN` e DECLARA em cabeçalho
// quem é o operador humano que pediu a ação. A auditoria registra `viaNoc: true` — identidade
// AFIRMADA por outro serviço, nunca verificada aqui.
//
// ── ⛔ A REGRA QUE NÃO PODE SER QUEBRADA (é o defeito que esta tarefa fecha) ─────────────────────
// O cabeçalho `x-ragnabot-ator-papel` SÓ é aceito JUNTO COM O TOKEN DE SERVIÇO. Num pedido que
// veio por COOKIE ele é IGNORADO — inteiro, sem exceção.
//
// Por quê: cabeçalho é coisa que o cliente escolhe. Se o papel do navegador saísse dele, qualquer
// pessoa com uma sessão de atendente acrescentaria `x-ragnabot-ator-papel: super` e passaria por
// `superuserOnly` — o que tranca dinheiro e criação de empresa deixaria de trancar. O papel do
// navegador sai do conteúdo ASSINADO do cookie, que o cliente não consegue reescrever sem a chave.
// Está provado em `src/base/testes/auth.test.mjs` (teste "c").
//
// ── MAPEAMENTO DE PAPÉIS (decisão registrada; ver COMO-MONTAR-SESSAO.md §5) ──────────────────────
//   plataforma `administrator` → role 'admin' , isSuperuser false
//   plataforma `agent`         → role 'user'  , isSuperuser false
//   SUPER USUÁRIO DO PRODUTO   → NÃO EXISTE por cookie. Só pelo token de serviço.
// Razão: super usuário aqui é quem cria empresa, muda plano e mexe em cobrança — operação NOSSA,
// do console de operação. Um administrador da EMPRESA CLIENTE é dono da empresa dele, não do SaaS.
// Deixar o `administrator` de uma conta virar super seria devolver, pela porta da frente, o mesmo
// buraco que o cabeçalho forjado abria pela porta dos fundos.
//
// ── FALHA FECHADA ───────────────────────────────────────────────────────────────────────────────
// Sem NENHUM dos dois segredos (`RAGNABOT_SESSAO_SEGREDO`, `RAGNABOT_SERVICE_TOKEN`), tudo que é
// privado recusa com 503. Um serviço de atendimento que sobe sem saber quem é quem é pior que um
// serviço fora do ar: o fora do ar aparece no monitor; o aberto só aparece no vazamento.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import logger from './logger.js';

const TOKEN_SERVICO = (process.env.RAGNABOT_SERVICE_TOKEN || '').trim();
const CAB_TOKEN = 'x-ragnabot-service-token';
const CAB_ATOR_ID = 'x-ragnabot-ator-id';
const CAB_ATOR_NOME = 'x-ragnabot-ator-nome';
const CAB_ATOR_PAPEL = 'x-ragnabot-ator-papel'; // super | admin | user — SÓ com token de serviço

// ── Sessão de navegador ─────────────────────────────────────────────────────────────────────────
const SEGREDO_SESSAO = (process.env.RAGNABOT_SESSAO_SEGREDO || '').trim();
export const NOME_COOKIE_SESSAO = 'rb_sessao';

// Validade curta, por ordem do contrato: 8 h é o TETO, não o padrão negociável. Um valor maior no
// ambiente é REBAIXADO para 8 h em silêncio proposital — variável de ambiente é fácil demais de
// mexer para poder alargar sessão de quem atende cliente.
const HORAS_TETO = 8;
const HORAS_SESSAO = (() => {
  const n = Number(process.env.RAGNABOT_SESSAO_HORAS || HORAS_TETO);
  if (!Number.isFinite(n) || n <= 0) return HORAS_TETO;
  return Math.min(n, HORAS_TETO);
})();
export const DURACAO_SESSAO_MS = Math.round(HORAS_SESSAO * 3600 * 1000);

// `Secure` é o padrão. Só cai em ambiente que NÃO é produção e com pedido explícito — porque
// cookie `Secure` não é guardado por navegador em `http://localhost`, e sem esta válvula o
// desenvolvimento local vira "a sessão não cola" sem nenhuma mensagem que explique.
const COOKIE_SEGURO = !(process.env.NODE_ENV !== 'production'
  && String(process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO || '') === '1');

/** Comparação resistente a tempo. Comparar segredo com `===` vaza o tamanho do prefixo certo. */
function iguais(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

const b64u = {
  paraTexto: (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url'),
  deTexto: (s) => JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')),
};

function assinar(conteudo) {
  return crypto.createHmac('sha256', SEGREDO_SESSAO).update(conteudo).digest('base64url');
}

/** A autenticação por cookie está utilizável? (o `/sessao/entrar` recusa quando não.) */
export function sessaoConfigurada() {
  return SEGREDO_SESSAO.length > 0;
}

// ── REVOGAÇÃO (o "sair") ────────────────────────────────────────────────────────────────────────
// O cookie é autocontido e assinado: sem uma lista, "sair" seria só apagar o cookie do navegador —
// e um cookie já copiado continuaria valendo até vencer. A lista fecha isso NO PROCESSO.
//
// ⚠️ LIMITE MEDIDO, NÃO ESCONDIDO: o motor sobe com 2 réplicas, e esta lista é de MEMÓRIA. Sair
// numa réplica não revoga na outra. Para quem apenas sai da tela isso não muda nada (o navegador
// perdeu o cookie na hora); para um cookie ROUBADO, o pior caso é ele sobreviver até o vencimento
// (≤ 8 h) se o ladrão cair na outra réplica. Fechar isso de verdade exige uma tabela de sessões no
// banco — mudança de esquema, e portanto decisão do chefe (está no relatório).
const revogadas = new Map(); // jid -> instante de vencimento (ms)

function limparRevogadas(agora = Date.now()) {
  for (const [jid, exp] of revogadas) if (exp <= agora) revogadas.delete(jid);
}

export function revogarSessao(jid, expMs) {
  if (!jid) return;
  revogadas.set(String(jid), Number(expMs) || (Date.now() + DURACAO_SESSAO_MS));
  limparRevogadas();
}

/**
 * Emite o conteúdo assinado da sessão. O que entra aqui é o que o servidor MEDIU na plataforma —
 * nada que tenha vindo do navegador.
 *
 * @param {object} d { sub, nome, email, papel, conta, tenantId }
 * @returns {{token:string, expiraEm:Date, jid:string}}
 */
export function emitirSessao(d) {
  if (!sessaoConfigurada()) {
    throw new Error('RAGNABOT_SESSAO_SEGREDO não está definido — não emito sessão.');
  }
  const agora = Date.now();
  const jid = crypto.randomBytes(9).toString('base64url');
  const corpo = {
    v: 1,
    jid,
    sub: String(d.sub),
    nome: d.nome || null,
    email: d.email || null,
    // ⭐ O PAPEL VIVE AQUI DENTRO, sob assinatura. É a diferença entre esta tarefa e o defeito que
    // ela fecha: o cliente pode reenviar o cookie, mas não pode reescrever este campo.
    papel: d.papel,
    conta: d.conta ?? null,
    tenantId: d.tenantId ?? null,
    iat: agora,
    exp: agora + DURACAO_SESSAO_MS,
  };
  const conteudo = b64u.paraTexto(corpo);
  return { token: `${conteudo}.${assinar(conteudo)}`, expiraEm: new Date(corpo.exp), jid };
}

/**
 * Confere o conteúdo assinado. NUNCA lança: devolve o motivo, para o chamador decidir.
 * @returns {{ok:boolean, sessao?:object, motivo?:string}}
 */
export function verificarSessao(token) {
  if (!sessaoConfigurada()) return { ok: false, motivo: 'sem-segredo' };
  const bruto = String(token || '');
  const corte = bruto.lastIndexOf('.');
  if (corte <= 0) return { ok: false, motivo: 'formato' };
  const conteudo = bruto.slice(0, corte);
  const assinatura = bruto.slice(corte + 1);
  // Assinatura ANTES de desserializar: JSON.parse em texto de terceiro é superfície que não
  // precisamos oferecer a quem ainda não provou ter a chave.
  if (!iguais(assinatura, assinar(conteudo))) return { ok: false, motivo: 'assinatura' };
  let s;
  try { s = b64u.deTexto(conteudo); } catch { return { ok: false, motivo: 'conteudo' }; }
  if (!s || s.v !== 1 || !s.sub || !s.papel) return { ok: false, motivo: 'conteudo' };
  if (!Number.isFinite(s.exp) || s.exp <= Date.now()) return { ok: false, motivo: 'vencida' };
  limparRevogadas();
  if (s.jid && revogadas.has(String(s.jid))) return { ok: false, motivo: 'revogada' };
  return { ok: true, sessao: s };
}

/** Lê UM cookie do pedido sem depender de `cookie-parser` (uma dependência a menos para auditar). */
export function lerCookie(req, nome = NOME_COOKIE_SESSAO) {
  const cru = req?.headers?.cookie;
  if (!cru) return null;
  for (const parte of String(cru).split(';')) {
    const eq = parte.indexOf('=');
    if (eq < 0) continue;
    if (parte.slice(0, eq).trim() !== nome) continue;
    return decodeURIComponent(parte.slice(eq + 1).trim());
  }
  return null;
}

/** Cabeçalho `Set-Cookie` da entrada. `SameSite=Strict` por ordem do contrato. */
export function cookieDeSessao(token) {
  const p = [
    `${NOME_COOKIE_SESSAO}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}`,
  ];
  if (COOKIE_SEGURO) p.push('Secure');
  return p.join('; ');
}

/** Cabeçalho `Set-Cookie` da saída — mesmos atributos, validade zero. Atributo diferente do de
 *  emissão faz o navegador guardar DOIS cookies em vez de apagar o que existia. */
export function cookieDeSaida() {
  const p = [`${NOME_COOKIE_SESSAO}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (COOKIE_SEGURO) p.push('Secure');
  return p.join('; ');
}

/** Forma de `req.user` a partir do conteúdo assinado. Ponto ÚNICO — duas versões divergem. */
export function usuarioDaSessao(s) {
  const admin = s.papel === 'administrator';
  return {
    // Prefixo `cw:` de propósito: este id é da PLATAFORMA, não do NOC. Sem a marca, um dia alguém
    // procura o número 7 na tabela de usuários do NOC e acha outra pessoa.
    id: `cw:${s.sub}`,
    name: s.nome || `usuário ${s.sub}`,
    email: s.email || null,
    role: admin ? 'admin' : 'user',
    // ⛔ NUNCA true por cookie. Ver o mapeamento de papéis no cabeçalho.
    isSuperuser: false,
    // Escopo: `escopoDe()` (ragnabot-auditoria.service.js) lê exatamente este campo. Ele foi
    // resolvido NO SERVIDOR, na entrada, a partir da conta que a plataforma disse — não da tela.
    ragnabotTenantId: s.tenantId || null,
    cwUserId: Number(s.sub) || s.sub,
    cwAccountId: s.conta ?? null,
    papelNaPlataforma: s.papel,
    sessaoId: s.jid || null,
    sessaoExpiraEm: new Date(s.exp).toISOString(),
    // Marcas de PROCEDÊNCIA, que a auditoria registra. `viaNoc:false` é tão informativo quanto o
    // `true`: diz que esta identidade foi CONFERIDA contra a plataforma, não afirmada por terceiro.
    viaNoc: false,
    viaPlataforma: true,
  };
}

/**
 * Autentica o pedido. Popula `req.user` com a MESMA forma que os routers já esperam
 * (`id`, `name`, `role`, `isSuperuser`), por um dos dois caminhos.
 */
export function authMiddleware(req, res, next) {
  if (!TOKEN_SERVICO && !sessaoConfigurada()) {
    return res.status(503).json({
      error: 'AUTH_NAO_CONFIGURADA',
      message: 'Nem RAGNABOT_SESSAO_SEGREDO nem RAGNABOT_SERVICE_TOKEN estão definidos — '
        + 'o serviço recusa tudo que é privado.',
    });
  }

  // ── 1. Caminho da PESSOA ──────────────────────────────────────────────────────────────────────
  const cru = lerCookie(req);
  let motivoCookie = null;
  if (cru) {
    const r = verificarSessao(cru);
    if (r.ok) {
      req.user = usuarioDaSessao(r.sessao);
      // ⛔ AQUI ESTÁ A TRAVA. Chegamos por cookie: o que o cliente escreveu em
      // `x-ragnabot-ator-papel` (ou nos outros dois cabeçalhos de ator) NÃO é lido, nem para
      // "enriquecer", nem para registro. Enriquecer com dado do cliente é como a escalada volta.
      return next();
    }
    motivoCookie = r.motivo;
  }

  // ── 2. Caminho da MÁQUINA ─────────────────────────────────────────────────────────────────────
  const oferecido = req.get(CAB_TOKEN);
  if (TOKEN_SERVICO && oferecido && iguais(oferecido, TOKEN_SERVICO)) {
    const papel = String(req.get(CAB_ATOR_PAPEL) || 'user').toLowerCase();
    req.user = {
      id: req.get(CAB_ATOR_ID) || null,
      name: req.get(CAB_ATOR_NOME) || 'operador (via NOC)',
      role: papel === 'super' ? 'admin' : papel,
      isSuperuser: papel === 'super',
      // ⚠️ A marca que a auditoria PRECISA registrar: esta identidade foi afirmada por outro
      // serviço, não verificada aqui. Sem ela, o registro mentiria dizendo que conferimos quem era.
      viaNoc: true,
      viaPlataforma: false,
    };
    return next();
  }

  // Não dizemos QUAL parte falhou para quem não tinha nada: mensagem detalhada de autenticação é
  // mapa para quem tenta. Já para quem TINHA cookie, o motivo volta — ele já tem o cookie, não há
  // o que revelar, e a tela precisa saber se manda recarregar ou pedir a senha de novo.
  logger.warn(`[auth] recusado · ip=${req.ip} · rota=${req.originalUrl}`
    + (motivoCookie ? ` · cookie=${motivoCookie}` : ''));
  return res.status(401).json({
    error: 'NAO_AUTENTICADO',
    code: motivoCookie ? 'SESSAO_INVALIDA' : 'NAO_AUTENTICADO',
    motivo: motivoCookie || undefined,
  });
}

/** Exige papel de administrador (ou super). */
export function adminOnly(req, res, next) {
  if (req.user?.isSuperuser || req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'SEM_PERMISSAO', message: 'Esta ação exige administrador.' });
}

/**
 * Exige super usuário. Usado no que mexe em dinheiro e em empresa.
 * ⚠️ Por desenho, NENHUMA sessão de navegador passa aqui — só o token de serviço (o NOC).
 */
export function superuserOnly(req, res, next) {
  if (req.user?.isSuperuser) return next();
  return res.status(403).json({ error: 'SEM_PERMISSAO', message: 'Esta ação exige super usuário.' });
}

/** Para o `/saude`: diz o que está configurado, SEM revelar segredo nenhum. */
export function autenticacaoPronta() {
  const caminhos = [];
  if (sessaoConfigurada()) caminhos.push('cookie-de-sessao (plataforma)');
  if (TOKEN_SERVICO) caminhos.push('token-de-servico + ator-asserido (via NOC)');
  return {
    configurada: caminhos.length > 0,
    modo: caminhos.join(' + ') || 'nenhum',
    sessaoHoras: sessaoConfigurada() ? HORAS_SESSAO : null,
    cookieSeguro: COOKIE_SEGURO,
  };
}

export default {
  authMiddleware, adminOnly, superuserOnly, autenticacaoPronta,
  sessaoConfigurada, emitirSessao, verificarSessao, revogarSessao,
  lerCookie, cookieDeSessao, cookieDeSaida, usuarioDaSessao,
  NOME_COOKIE_SESSAO, DURACAO_SESSAO_MS,
};
