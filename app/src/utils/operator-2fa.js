// ════════════════════════════════════════════════════════════════════════════════════════════════
// SEGUNDO FATOR DO OPERADOR — recusa por omissão, de propósito.
//
// No NOC este módulo manda um código por e-mail e o confere. Aqui ele ainda NÃO existe, e a decisão
// do chefe (doc 33 §7) é que identidade do Ragnabot é do Ragnabot — a do NOC não vem junto na
// mudança de casa.
//
// ⛔ Enquanto não existir, `checkOperator2fa` RECUSA. Quem usa isto é a rota de COBRANÇA: mexer em
// dinheiro sem segundo fator é exatamente o que o segundo fator existe para impedir. Um atalho
// "temporário" que devolvesse `true` seria a pior linha desta migração inteira — e a mais fácil de
// esquecer ligada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import logger from '../base/logger.js';

const MOTIVO = 'O segundo fator do operador ainda não foi implementado na aplicação do Ragnabot. '
  + 'Esta ação mexe em cobrança e por isso é recusada. Ver doc 33 §7 e §8.';

export async function checkOperator2fa(/* req */) {
  logger.warn('[2fa] ação de cobrança RECUSADA: segundo fator ainda não implementado aqui');
  return { ok: false, motivo: MOTIVO, codigo: 'SEGUNDO_FATOR_INDISPONIVEL' };
}

export async function requestOperatorOtp(/* dados */) {
  return { enviado: false, motivo: MOTIVO, codigo: 'SEGUNDO_FATOR_INDISPONIVEL' };
}

export default { checkOperator2fa, requestOperatorOtp };
