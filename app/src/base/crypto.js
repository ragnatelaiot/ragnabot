// ════════════════════════════════════════════════════════════════════════════════════════════════
// CIFRAGEM — CÓPIA FIEL de `src/utils/crypto.js` do NOC. NÃO "melhore" este arquivo.
//
// Este é o ponto mais delicado da separação (doc 33 §2). Tudo que já está cifrado no banco foi
// cifrado por aquela implementação. Qualquer diferença — algoritmo, tamanho do IV, derivação da
// chave, formato do texto cifrado — e o segredo gravado NÃO ABRE. Não dá erro claro: dá
// "Unsupported state or unable to authenticate data" no meio de um atendimento.
//
// O que tem de ser idêntico, e é:
//   • aes-256-gcm
//   • IV de 16 bytes aleatórios
//   • chave = os primeiros 64 caracteres hex de ENCRYPTION_KEY, lidos como bytes (SEM derivação
//     tipo scrypt/pbkdf2 — a chave é usada crua; mudar isso quebra tudo que já existe)
//   • formato de saída: `ivHex:tagHex:cifradoHex`
//
// Provado por `src/base/testes/crypto.test.mjs`, que decifra um valor produzido pela
// implementação do NOC importando as duas lado a lado.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import config from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getKey() {
  const hex = config.chaveDeCifragem;
  if (!hex || hex.length < 64) {
    throw new Error('ENCRYPTION_KEY must be at least 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

export function encrypt(text) {
  if (!text) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

// Variante tolerante: devolve o valor original se a decifragem falhar
// (ex.: campo legado gravado em plaintext). Usar para campos que
// historicamente foram salvos das duas formas.
export function decryptSafe(value) {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

export function decrypt(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return encryptedText;

  const key = getKey();
  const [ivHex, tagHex, encrypted] = encryptedText.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
