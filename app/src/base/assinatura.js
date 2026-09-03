// ════════════════════════════════════════════════════════════════════════════════════════════════
// ASSINATURA HMAC-SHA256 DE CORPO — a MESMA peça para RECEBER e para ENVIAR.
//
// Contrato S6 (02/09/2026), doc 34 §F9.4.3. A ordem foi explícita: *"é o mesmo padrão da Meta —
// então o verificador de assinatura que já usamos para RECEBER serve para ASSINAR o que sai.
// Reaproveite, não reescreva."*
//
// ── O QUE EU MEDI ANTES DE ESCREVER ─────────────────────────────────────────────────────────────
// `grep -rn "createHmac" src/` em 02/09/2026 devolveu TRÊS pontos e nenhum módulo comum:
//   · `src/base/auth.js:86`                     — assina o COOKIE de sessão (base64url, propósito
//                                                  diferente; NÃO entra aqui)
//   · `src/routes/ragnabot-cobranca.routes.js:365` — confere `x-ragnabot-assinatura` do retorno de
//                                                  pagamento: hex, com `sha256=` opcional na frente
//   · `src/base/testes/auth.test.mjs:69`        — o teste do cookie
// Ou seja: NÃO havia `verificarAssinaturaMeta` no repositório (o doc 34 §F9.4 o cita como se
// existisse — não existe; o que existe é a conferência de cobrança acima). Este arquivo é a
// extração daquela conferência para um lugar só, e o webhook de cobrança passou a chamá-lo.
// Duas implementações do mesmo HMAC divergindo é como um lado passa a assinar o que o outro recusa.
//
// ── O FORMATO, E POR QUE ESTE ──────────────────────────────────────────────────────────────────
//   cabeçalho:  X-Hub-Signature-256: sha256=<hex minúsculo de 64 caracteres>
//   conteúdo:   HMAC-SHA256(segredo, CORPO CRU EM BYTES)
// É o formato da Meta (WhatsApp Cloud API, Messenger, Instagram) e o mesmo que o portal medido no
// chat atual expõe aos clientes dele. Adotá-lo significa que quem já integra com a Meta não
// escreve uma linha nova para integrar conosco — e que a nossa própria entrada da Meta poderá usar
// ESTA função quando o webhook direto existir, sem um segundo dialeto.
//
// ── ⚠️ CORPO CRU, SEMPRE ────────────────────────────────────────────────────────────────────────
// Assina-se o BYTE que trafega, nunca o objeto re-serializado. `JSON.stringify(JSON.parse(x))` não
// devolve `x`: reordena chave, muda escape de unicode, some com espaço. O emissor assinaria uma
// coisa e o receptor conferiria outra — e a falha aparece só em alguns corpos, o que é pior que
// falhar sempre. Por isso `assinar()` devolve TAMBÉM o corpo exato que foi assinado: quem envia
// manda AQUELE `Buffer`, não uma nova serialização.
//
// ── ⚠️ COMPARAÇÃO RESISTENTE A TEMPO ───────────────────────────────────────────────────────────
// `a === b` em segredo vaza o tamanho do prefixo correto pelo tempo de resposta. `timingSafeEqual`
// exige buffers do MESMO tamanho (lança, se não forem) — por isso o tamanho é conferido antes, e a
// conferência de tamanho é feita sobre a forma NORMALIZADA (hex), nunca sobre o cabeçalho cru.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

/** O cabeçalho padrão. Constante exportada para o emissor, o receptor e o teste dizerem a MESMA
 *  coisa — um cabeçalho digitado à mão em três lugares vira três cabeçalhos no terceiro mês. */
export const CABECALHO_ASSINATURA = 'x-hub-signature-256';

/** O prefixo do valor. A Meta manda `sha256=<hex>`; aceitamos com e sem, e emitimos SEMPRE com. */
export const PREFIXO = 'sha256=';

/**
 * O corpo, em bytes, exatamente como vai trafegar.
 *
 * String e Buffer passam intactos. Objeto vira JSON UMA vez — e é esse JSON que sai no envio,
 * devolvido por `assinar()`. Nunca serialize de novo depois de assinar.
 */
export function corpoEmBytes(corpo) {
  if (Buffer.isBuffer(corpo)) return corpo;
  if (typeof corpo === 'string') return Buffer.from(corpo, 'utf8');
  if (corpo === null || corpo === undefined) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(corpo), 'utf8');
}

/**
 * Assina um corpo.
 *
 * @param {string} segredo   o segredo compartilhado, em claro (decifrado ANTES de chegar aqui)
 * @param {*} corpo          Buffer, string ou objeto
 * @returns {{assinatura:string, hex:string, corpo:Buffer}}
 *   `assinatura` já vem com o prefixo, pronta para o cabeçalho; `corpo` é o que DEVE ser enviado.
 */
export function assinar(segredo, corpo) {
  const s = String(segredo ?? '');
  if (!s) throw new Error('assinatura: segredo vazio — assinar com segredo vazio produz assinatura que qualquer um reproduz.');
  const bytes = corpoEmBytes(corpo);
  const hex = crypto.createHmac('sha256', s).update(bytes).digest('hex');
  return { assinatura: `${PREFIXO}${hex}`, hex, corpo: bytes };
}

/** Tira o prefixo e baixa a caixa. Cabeçalho ausente vira string vazia, nunca `undefined` solto. */
export function normalizarAssinatura(valor) {
  const cru = String(valor ?? '').trim();
  const sem = cru.toLowerCase().startsWith(PREFIXO) ? cru.slice(PREFIXO.length) : cru;
  return sem.toLowerCase();
}

/**
 * Confere uma assinatura recebida.
 *
 * @returns {boolean} `true` só quando o HMAC bate. Segredo vazio, cabeçalho ausente ou tamanho
 *   diferente devolvem `false` — nunca lançam. Quem recebe webhook não pode quebrar por cabeçalho
 *   malformado: isso transforma uma tentativa de fraude em queda do processo.
 */
export function conferir(segredo, corpo, assinaturaRecebida) {
  const s = String(segredo ?? '');
  if (!s) return false;
  const recebida = normalizarAssinatura(assinaturaRecebida);
  if (!/^[0-9a-f]{64}$/u.test(recebida)) return false;
  const { hex } = assinar(s, corpo);
  return iguaisComSeguranca(hex, recebida);
}

/**
 * Comparação de tamanho fixo, resistente a análise de tempo.
 * Exportada porque a conferência de SEGREDO da API pública (`ragnabot-api-publica.service.js`) e a
 * do segredo-no-caminho do webhook de cobrança precisam exatamente disto — e cada um tinha a sua.
 */
export function iguaisComSeguranca(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Um segredo novo. 32 bytes de aleatoriedade forte, em hex — o mesmo tamanho da chave do HMAC. */
export function novoSegredo(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Impressão digital de um segredo: mostra que ele MUDOU sem permitir reconstruí-lo. Mesmo formato
 *  de `RagnabotInbox.credentialFingerprint`, para a tela ler os dois do mesmo jeito. */
export function digitalDoSegredo(valor) {
  if (!valor) return null;
  return `sha256:${crypto.createHash('sha256').update(String(valor)).digest('hex').slice(0, 16)}`;
}

export default {
  CABECALHO_ASSINATURA, PREFIXO,
  assinar, conferir, normalizarAssinatura, iguaisComSeguranca, corpoEmBytes, novoSegredo, digitalDoSegredo,
};
