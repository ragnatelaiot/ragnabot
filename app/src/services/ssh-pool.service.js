// ════════════════════════════════════════════════════════════════════════════════════════════════
// SSH — porta VAZIA, de propósito. Decisão do chefe, 30/08/2026 (doc 33 §4 e §8).
//
// A régua do plano: se a peça participa de ATENDER UM CLIENTE, é do Ragnabot; se apenas OBSERVA ou
// administra, fica no NOC. Ler o cluster por SSH é observação — e observação de si mesmo vale menos
// que observação de fora. Por isso o pool de SSH do NOC NÃO muda de casa.
//
// Consequência aceita: `ragnabot-cluster.service.js` foi copiado junto (é do mundo Ragnabot por
// nome), mas o que ele faz é INSPEÇÃO. A tela do cluster continua sendo do NOC, servida pelo NOC,
// lendo pelo NOC. Aqui a porta existe só para o módulo carregar e recusar com clareza, em vez de
// derrubar a montagem da rota — e de arrastar credencial de SSH para dentro do serviço que atende
// cliente, que é o que realmente não queremos.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import logger from '../base/logger.js';

const MOTIVO = 'Inspeção por SSH é responsabilidade do NOC, não do Ragnabot (doc 33 §4). '
  + 'Use a API do NOC para ler o estado do cluster.';

export async function execPooled(/* alvo, comando */) {
  logger.warn('[ssh] chamada recusada: inspeção por SSH não roda no Ragnabot — ver doc 33 §4');
  const e = new Error(MOTIVO);
  e.codigo = 'SSH_FORA_DO_ESCOPO';
  throw e;
}

export default { execPooled };
