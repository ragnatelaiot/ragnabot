// ════════════════════════════════════════════════════════════════════════════════════════════════
// SEGUNDO FATOR DO RAGNABOT — próprio, com o e-mail que a PLATAFORMA já nos disse.
//
// Contrato S5-INDEPENDENCIA. Substitui o `otp.service.js` DO NOC, que lia o e-mail e o segredo do
// aplicativo autenticador na tabela `User` do NOC e enviava pelo `smtp.service.js` do NOC, cuja
// configuração vinha da tabela `Settings` do NOC. Eram TRÊS amarras num arquivo só; aqui elas
// morrem: o e-mail vem da SESSÃO (a plataforma nos disse quem entrou), e o envio vem do AMBIENTE.
//
// ── O QUE ESTE ARQUIVO PROTEGE ──────────────────────────────────────────────────────────────────
// Operação sensível: cobrar, criar/suspender/EXCLUIR empresa, PUBLICAR fluxo. Publicar fluxo é
// mandar um robô falar com o cliente de alguém — confirmar quem apertou o botão não é burocracia.
//
// ── AS DECISÕES, DITAS EM VOZ ALTA ──────────────────────────────────────────────────────────────
// 1. CÓDIGO DE 6 DÍGITOS, 10 MINUTOS, 5 TENTATIVAS. Depois da 5ª errada o código é QUEIMADO — quem
//    errou muito não ganha tentativas novas contra o MESMO código; tem de pedir outro (e o pedido
//    é limitado, ver `MAX_ENVIOS`).
// 2. GUARDADO EM MEMÓRIA, POR PROCESSO. ⚠️ LIMITE MEDIDO, NÃO ESCONDIDO: o motor sobe com 2
//    RÉPLICAS. O código vale na réplica que o emitiu; se o pedido de conferência cair na outra, ele
//    é recusado como "inválido ou expirado" e a pessoa pede outro. Não há brecha de segurança
//    nisso (a falha é FECHADA), há incômodo — e a correção definitiva é uma tabela de OTP no banco,
//    que é mudança de esquema e portanto decisão do chefe. Está no relatório de entrega.
// 3. NUNCA GUARDAMOS O CÓDIGO EM CLARO — só o resumo SHA-256 com o par (ator, propósito) dentro.
//    E o código NÃO APARECE EM LOG NENHUM, nem em erro. Nem o e-mail: log com destinatário é
//    lista de alvo pronta para quem ler o log.
// 4. SEM SMTP CONFIGURADO, FALHA FECHADA NOS DOIS SENTIDOS: pedir o código responde que não
//    consegue enviar, e CONFERIR RECUSA. Um segundo fator que "passa" porque o e-mail não foi
//    configurado é pior que não ter segundo fator — ele mente para quem confia nele.
// 5. APLICATIVO AUTENTICADOR (TOTP) NÃO EXISTE AQUI, e isso é dito, não simulado. O segredo do
//    autenticador do NOC ficou na tabela `User` do NOC; o da plataforma é conferido por ela, no
//    `POST /auth/sign_in`, e para conferi-lo precisaríamos da senha da pessoa — que não temos e não
//    queremos ter. Então `verifyTotp` recusa SEMPRE, com a razão escrita. O caminho por e-mail é o
//    que funciona, e é o que as telas oferecem.
//
// ── A INTERFACE É A DOS CHAMADORES, NÃO A MINHA ─────────────────────────────────────────────────
// Lida em `src/routes/ragnabot-tenant.routes.js` (linhas 60-63 e 97-101) e em
// `src/routes/ragnabot-fluxo.routes.js` (linhas 307-310 e 325-330):
//     otp.createAndSendEmailOtp(req.user.id, 'access_2fa')
//     otp.verifyEmailOtp(req.user.id, otpCode, 'access_2fa')
//     otp.verifyTotp(req.user.id, otpCode)
// Os nomes e a ordem dos argumentos são exatamente esses. O ÚNICO acréscimo é um TERCEIRO argumento
// OPCIONAL em `createAndSendEmailOtp` — o ator (`req.user`), de onde sai o endereço de destino.
// Quem não o passa recebe `{ ok:false, code:'SEM_EMAIL' }`: não há tabela de usuários para
// adivinhar o destino, e adivinhar destino de código de segurança seria exatamente o erro a evitar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import logger from '../base/logger.js';

// ── Parâmetros ──────────────────────────────────────────────────────────────────────────────────
const TTL_TETO_MS = 10 * 60_000;   // 10 minutos — o TETO, não um padrão negociável
const MAX_TENTATIVAS = 5;          // erradas, por código
const MAX_ENVIOS = 5;              // por (ator, propósito), dentro de uma janela de TTL
const DIGITOS = 6;

/**
 * Validade do código. A variável de ambiente só consegue ENCURTAR — nunca alargar. Variável de
 * ambiente é fácil demais de mexer para poder esticar a vida de um código de segurança.
 * (Existe para o teste conseguir provar o vencimento sem esperar 10 minutos.)
 */
function ttlMs() {
  const n = Number(process.env.RAGNABOT_OTP_TTL_MS || 0);
  if (!Number.isFinite(n) || n <= 0) return TTL_TETO_MS;
  return Math.min(n, TTL_TETO_MS);
}

// ── Memória do processo (ver decisão 2 no cabeçalho) ────────────────────────────────────────────
const codigos = new Map(); // chave -> { resumo, expiraEm, tentativas }
const envios = new Map();  // chave -> { contador, janelaAte }

const chaveDe = (ator, proposito) => `${ator}|${proposito}`;

/** Limpeza oportunista: sem isto os dois mapas crescem para sempre sob ataque distribuído. */
function limpar(agora = Date.now()) {
  for (const [k, v] of codigos) if (v.expiraEm <= agora) codigos.delete(k);
  for (const [k, v] of envios) if (v.janelaAte <= agora) envios.delete(k);
}

/** Resumo do código AMARRADO ao par (ator, propósito): o mesmo código não vale em outro contexto. */
function resumoDe(ator, proposito, codigo) {
  return crypto.createHash('sha256').update(`${ator}|${proposito}|${codigo}`).digest('hex');
}

/** Comparação resistente a tempo — comparar resumo com `===` vaza o tamanho do prefixo certo. */
function iguais(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/** Sorteio UNIFORME. `Math.random()` não serve para código de segurança, e `% 10` enviesa. */
function sortearCodigo() {
  let s = '';
  for (let i = 0; i < DIGITOS; i++) s += String(crypto.randomInt(0, 10));
  return s;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O TRANSPORTE — configuração do AMBIENTE, nunca da tabela `Settings` do NOC (era a 5ª amarra)
// ────────────────────────────────────────────────────────────────────────────────────────────────
function configuracaoSmtp() {
  const host = (process.env.SMTP_HOST || '').trim();
  const porta = parseInt(process.env.SMTP_PORT || '587', 10);
  const bruto = String(process.env.SMTP_SECURE ?? '').trim().toLowerCase();
  const usuario = (process.env.SMTP_USER || '').trim();
  const senha = process.env.SMTP_PASSWORD || '';
  const de = (process.env.SMTP_FROM || '').trim();
  const nomeDe = (process.env.SMTP_FROM_NAME || 'Ragnabot — Ragnatela IoT Solutions').trim();
  return {
    host,
    porta: Number.isFinite(porta) && porta > 0 ? porta : 587,
    // Só `true`/`1` ligam TLS implícito. Sem valor, seguimos a convenção: 465 é implícito, o resto não.
    seguro: bruto === 'true' || bruto === '1' || (bruto === '' && porta === 465),
    usuario,
    senha,
    de,
    nomeDe,
  };
}

/**
 * O envio está utilizável? Devolve o MOTIVO quando não — "não consegui enviar" sem motivo manda a
 * equipe procurar o defeito na conta da pessoa.
 * @returns {{ok:boolean, motivo?:string}}
 */
export function smtpConfigurado() {
  const c = configuracaoSmtp();
  const falta = [];
  if (!c.host) falta.push('SMTP_HOST');
  if (!c.de) falta.push('SMTP_FROM');
  // Usuário e senha são OPCIONAIS de propósito: relay interno autenticado por rede é caso real.
  // Mas MEIA credencial é quase sempre engano de configuração, e vale dizer.
  if ((c.usuario && !c.senha) || (!c.usuario && c.senha)) falta.push('SMTP_USER e SMTP_PASSWORD juntos');
  if (falta.length) return { ok: false, motivo: `faltando: ${falta.join(', ')}` };
  return { ok: true };
}

let transporteCache = null;
let chaveDoCache = null;

function transporte() {
  const c = configuracaoSmtp();
  // A chave do cache NÃO leva a senha: ela acabaria num heap dump e num `--inspect` sem necessidade.
  const chave = `${c.host}|${c.porta}|${c.seguro}|${c.usuario}|${c.de}`;
  if (transporteCache && chaveDoCache === chave) return { t: transporteCache, c };
  transporteCache = nodemailer.createTransport({
    host: c.host,
    port: c.porta,
    secure: c.seguro,
    auth: c.usuario ? { user: c.usuario, pass: c.senha } : undefined,
  });
  chaveDoCache = chave;
  return { t: transporteCache, c };
}

function escapar(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mensagem({ nome, codigo, minutos }) {
  const texto = `Olá${nome ? ` ${nome}` : ''},

Seu código de verificação do Ragnabot é: ${codigo}

Ele vale por ${minutos} minuto(s) e serve para UMA confirmação. Se você não pediu esta ação,
ignore esta mensagem e avise o administrador — alguém tentou confirmar algo em seu nome.

Ragnatela IoT Solutions`;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0f172a;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1e293b;border-radius:12px;">
        <tr><td style="padding:20px 24px;border-bottom:3px solid #16a34a;">
          <div style="font-size:17px;font-weight:700;color:#f1f5f9;">RAGNABOT</div>
          <div style="font-size:12px;color:#94a3b8;">Ragnatela IoT Solutions</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 12px;">Olá${nome ? ` <b>${escapar(nome)}</b>` : ''},</p>
          <p style="margin:0 0 8px;">Use o código abaixo para confirmar a ação que você pediu:</p>
          <div style="margin:20px 0;text-align:center;">
            <span style="display:inline-block;padding:16px 28px;background:#16a34a1a;border:2px dashed #16a34a;
              border-radius:10px;font-family:'Courier New',monospace;font-size:30px;font-weight:800;
              letter-spacing:8px;color:#4ade80;">${escapar(codigo)}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#94a3b8;">Vale por <b>${minutos} minuto(s)</b> e serve
          para uma confirmação só. Se você não pediu esta ação, ignore esta mensagem e avise o administrador.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { texto, html };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A INTERFACE QUE OS ROUTERS JÁ CHAMAM
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Emite e envia o código por e-mail.
 *
 * @param {string} userId      id do ator (`req.user.id`, ex.: `cw:42`) — a chave do código
 * @param {string} proposito   contexto ('access_2fa'); isola o código do resto
 * @param {object} [ator]      `req.user` — de onde saem `email` e `name`. SEM ele não há destino.
 * @returns {Promise<{ok:boolean, expiresAt?:Date, ttlMinutes?:number, error?:string, code?:string}>}
 */
export async function createAndSendEmailOtp(userId, proposito = 'access_2fa', ator = null) {
  const chave = chaveDe(userId, proposito);
  const agora = Date.now();
  limpar(agora);

  const smtp = smtpConfigurado();
  if (!smtp.ok) {
    // Falha FECHADA e FALANTE: quem lê a resposta descobre que o defeito é de configuração do
    // serviço, não da conta dele. O motivo lista NOMES de variável, nunca valores.
    logger.error(`[2fa] pedido de código recusado — SMTP não configurado (${smtp.motivo}).`);
    return {
      ok: false,
      code: 'SMTP_NAO_CONFIGURADO',
      error: `O envio de e-mail não está configurado neste serviço (${smtp.motivo}). `
        + 'Sem ele não há como mandar o código — a ação continua bloqueada.',
    };
  }

  const destino = String(ator?.email || '').trim();
  if (!destino) {
    // É AQUI que a ponte de serviço (NOC → Ragnabot) para: ela afirma um operador, mas não traz
    // e-mail de pessoa nenhuma. Seguir sem segundo fator seria transformar a ponte num contorno.
    return {
      ok: false,
      code: 'SEM_EMAIL',
      error: 'Não sei para qual e-mail mandar o código: esta sessão não tem endereço de pessoa. '
        + 'Entre pela plataforma com a sua conta para confirmar esta ação.',
    };
  }

  const janela = envios.get(chave);
  if (janela && janela.janelaAte > agora && janela.contador >= MAX_ENVIOS) {
    return {
      ok: false,
      code: 'MUITOS_ENVIOS',
      error: 'Você pediu códigos demais em pouco tempo. Espere alguns minutos e tente de novo.',
    };
  }

  const validade = ttlMs();
  const codigo = sortearCodigo();
  const { t, c } = transporte();
  const minutos = Math.max(1, Math.round(validade / 60_000));
  const { texto, html } = mensagem({ nome: ator?.name || ator?.nome || null, codigo, minutos });

  try {
    await t.sendMail({
      from: c.nomeDe ? `"${c.nomeDe}" <${c.de}>` : c.de,
      to: destino,
      subject: 'Ragnabot — código de verificação',
      text: texto,
      html,
    });
  } catch (e) {
    // ⛔ A mensagem do transporte pode conter o destinatário; o log leva só o ator e a causa curta.
    logger.error(`[2fa] falha ao enviar código para o ator ${userId}: ${String(e.code || e.name || 'erro')}`);
    return {
      ok: false,
      code: 'FALHA_NO_ENVIO',
      error: 'Não consegui enviar o código por e-mail agora. Tente de novo em instantes.',
    };
  }

  // Só existe código depois que ele SAIU. Guardar antes deixaria um código vivo que ninguém recebeu.
  codigos.set(chave, {
    resumo: resumoDe(userId, proposito, codigo),
    expiraEm: agora + validade,
    tentativas: 0,
  });
  const j = (janela && janela.janelaAte > agora) ? janela : { contador: 0, janelaAte: agora + validade };
  j.contador += 1;
  envios.set(chave, j);

  // Sem código, sem e-mail, sem nome. Só o suficiente para correlacionar com a auditoria.
  logger.info(`[2fa] código emitido · ator=${userId} · proposito=${proposito} · validade=${minutos}min`);
  return { ok: true, expiresAt: new Date(agora + validade), ttlMinutes: minutos };
}

/**
 * Confere e CONSOME o código. Nunca lança: devolve `{ok:false, error}` para o chamador decidir o
 * status HTTP (a casa manda 403 + `INVALID_2FA`, nunca 401).
 */
export async function verifyEmailOtp(userId, codigo, proposito = 'access_2fa') {
  // Falha fechada também na CONFERÊNCIA: se o envio não está configurado, nenhum código legítimo
  // pôde ter saído daqui — e o que aparecer não vem de nós.
  const smtp = smtpConfigurado();
  if (!smtp.ok) {
    return {
      ok: false,
      code: 'SMTP_NAO_CONFIGURADO',
      error: 'A verificação em duas etapas está indisponível neste serviço (envio de e-mail não configurado).',
    };
  }

  const chave = chaveDe(userId, proposito);
  const agora = Date.now();
  const e = codigos.get(chave);
  if (!e) return { ok: false, code: 'INVALIDO', error: 'Código inválido ou expirado.' };
  if (e.expiraEm <= agora) {
    codigos.delete(chave);
    return { ok: false, code: 'EXPIRADO', error: 'O código expirou. Peça um novo.' };
  }

  const limpo = String(codigo ?? '').trim();
  const formatoOk = new RegExp(`^\\d{${DIGITOS}}$`).test(limpo);
  const acertou = formatoOk && iguais(e.resumo, resumoDe(userId, proposito, limpo));

  if (!acertou) {
    e.tentativas += 1;
    if (e.tentativas >= MAX_TENTATIVAS) {
      // QUEIMA o código: quem errou o teto não ganha mais tentativas contra ele, nem acertando.
      codigos.delete(chave);
      logger.warn(`[2fa] código queimado após ${e.tentativas} tentativas erradas · ator=${userId} · proposito=${proposito}`);
      return {
        ok: false,
        code: 'MUITAS_TENTATIVAS',
        queimado: true,
        error: 'Muitas tentativas erradas. O código foi invalidado — peça um novo.',
      };
    }
    codigos.set(chave, e);
    return {
      ok: false,
      code: 'INVALIDO',
      error: 'Código inválido ou expirado.',
      restantes: MAX_TENTATIVAS - e.tentativas,
    };
  }

  codigos.delete(chave);          // uso único
  envios.delete(chave);           // acertou: a janela de envios recomeça limpa
  logger.info(`[2fa] código conferido · ator=${userId} · proposito=${proposito}`);
  return { ok: true };
}

/**
 * Aplicativo autenticador — RECUSA SEMPRE, e diz por quê (ver decisão 5 no cabeçalho).
 * Existe para manter a assinatura que os routers chamam: sem ela, `otp.verifyTotp` seria
 * `undefined` e a chamada estouraria com um TypeError que ninguém consegue diagnosticar da tela.
 */
export async function verifyTotp(userId, _token) {
  logger.debug(`[2fa] pedido por aplicativo autenticador recusado (não existe no Ragnabot) · ator=${userId}`);
  return {
    ok: false,
    code: 'TOTP_INDISPONIVEL',
    error: 'O aplicativo autenticador não é conferido pelo Ragnabot. Use o código enviado por e-mail.',
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Auxiliares das telas — para os routers não repetirem regra (e não divergirem dela)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Quais canais de segundo fator este ator tem, de fato. */
export function canaisDe(ator) {
  return { email: !!String(ator?.email || '').trim(), totp: false };
}

/** `f***@empresa.com` — o bastante para a pessoa reconhecer o endereço, e não para um terceiro. */
export function dicaDeEmail(email) {
  const e = String(email || '').trim();
  return e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : null;
}

/** Só para teste: apaga a memória do processo. Não é chamado por rota nenhuma. */
export function esquecerTudo() {
  codigos.clear();
  envios.clear();
  transporteCache = null;
  chaveDoCache = null;
}

export default {
  createAndSendEmailOtp, verifyEmailOtp, verifyTotp,
  smtpConfigurado, canaisDe, dicaDeEmail, esquecerTudo,
};
