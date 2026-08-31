// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIO DE E-MAIL DO RAGNABOT — a QUINTA amarra com o NOC, cortada aqui.
//
// POR QUE EXISTE: o nó de e-mail do motor de fluxo (`ragnabot-fluxo-nos.service.js`) importa
// `./smtp.service.js`. Na mudança de casa esse arquivo não veio, e o que existia no NOC lia a
// configuração de SMTP da tabela `Settings` DELE — uma dependência que nenhum `import` denunciava e
// que o plano (doc 33) só listava como "4 peças". Eram cinco.
//
// Aqui a configuração vem do AMBIENTE (Secret do Kubernetes), como todo o resto do motor. Nenhuma
// consulta a banco de outro sistema para conseguir mandar um e-mail ao cliente.
//
// ⚠️ Sem SMTP configurado, `sendEmail` RECUSA com mensagem clara em vez de fingir que enviou. Um nó
// de fluxo que diz "enviei" sem ter enviado é pior que um que falha: o operador só descobre quando
// o cliente reclama que nunca recebeu.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import nodemailer from 'nodemailer';
import logger from '../base/logger.js';

function config() {
  const host = (process.env.SMTP_HOST || '').trim();
  const porta = Number(process.env.SMTP_PORT || 465);
  return {
    host,
    porta,
    // `SMTP_SECURE` explícito manda; sem ele, 465 é TLS direto e o resto não é.
    seguro: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : porta === 465,
    usuario: (process.env.SMTP_USER || '').trim(),
    senha: process.env.SMTP_PASSWORD || '',
    de: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
    nomeDe: process.env.SMTP_FROM_NAME || 'Ragnabot',
  };
}

let cache = null;
let chaveCache = null;

function transporte() {
  const c = config();
  if (!c.host || !c.de) {
    const e = new Error('SMTP não configurado no Ragnabot (SMTP_HOST/SMTP_FROM ausentes) — e-mail não enviado.');
    e.codigo = 'SMTP_INDISPONIVEL';
    throw e;
  }
  // A chave do cache NÃO leva a senha: ela acabaria num despejo de memória sem necessidade.
  const chave = `${c.host}|${c.porta}|${c.seguro}|${c.usuario}|${c.de}`;
  if (cache && chaveCache === chave) return { t: cache, c };
  cache = nodemailer.createTransport({
    host: c.host,
    port: c.porta,
    secure: c.seguro,
    ...(c.usuario ? { auth: { user: c.usuario, pass: c.senha } } : {}),
  });
  chaveCache = chave;
  return { t: cache, c };
}

/**
 * Envia um e-mail. Mesma assinatura do equivalente do NOC, para o nó de fluxo encaixar sem mudança.
 * `replyTo` e `bcc` são repassados — no NOC eles eram descartados em silêncio, e campo que a tela
 * pede e o transporte joga fora é pior que campo inexistente.
 */
export async function sendEmail({ to, subject, html, text, attachments, replyTo, bcc }) {
  const { t, c } = transporte();
  const info = await t.sendMail({
    from: `"${c.nomeDe}" <${c.de}>`,
    to,
    subject,
    html,
    text: text || String(html || '').replace(/<[^>]+>/g, ''),
    ...(replyTo ? { replyTo } : {}),
    ...(bcc ? { bcc } : {}),
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
  });
  // ⚠️ `bcc` fora do registro, de propósito: cópia oculta que aparece no log deixa de ser oculta.
  logger.info(`[smtp] enviado para=${to} assunto="${subject}" id=${info.messageId}`);
  return info;
}

/** Diz se dá para enviar, sem revelar credencial. Usado pelo `/saude`. */
export function smtpPronto() {
  const c = config();
  return { configurado: Boolean(c.host && c.de), host: c.host || null, remetente: c.de || null };
}

export default { sendEmail, smtpPronto };
