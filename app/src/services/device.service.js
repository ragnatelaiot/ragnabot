// ════════════════════════════════════════════════════════════════════════════════════════════════
// PERMISSÃO POR "GRUPO" — a peça fina que substitui o `device.service.js` DO NOC.
//
// Contrato S5-INDEPENDENCIA. Dois routers (`ragnabot-tenant.routes.js` e `ragnabot-cluster.routes.js`)
// chamam `userHasGroupAccess(id, papel, 'RAGNATELA')` como defesa em profundidade. No NOC essa
// função consultava `UserGroupPermission`/`UserDevice` — a matriz de acesso a GRUPOS DE
// DISPOSITIVOS (Zabbix, Proxmox, switches). Sem o módulo, os dois routers respondiam 500 e NENHUMA
// escrita do Ragnabot funcionava.
//
// ── A DECISÃO (chefe, 30/08/2026): grupo de dispositivo NÃO EXISTE no Ragnabot ──────────────────
// Grupo é conceito do console de operação: agrupa equipamento monitorado. Aqui o que isola é a
// EMPRESA, e isso já existe e já é testado — `escopoDe()`/`clausulaEscopo()` em
// `ragnabot-auditoria.service.js`, lendo `user.ragnabotTenantId`. Recriar a matriz de grupos seria
// trazer o acoplamento junto na mudança de casa, com um modelo de dados que este produto não tem.
//
// Então esta peça NÃO INVENTA PERMISSÃO NOVA. Ela responde uma pergunta só:
//   · o ator é SUPER (o que, por desenho de `base/auth.js`, só chega pelo token de serviço)? concede;
//   · qualquer outro caso? NÃO concede — e quem chamou cai na trava por empresa, que é a correta.
//
// ⛔ POR QUE NÃO DEVOLVER `true` POR PADRÃO "PARA NÃO QUEBRAR": porque estes dois routers
// provisionam, suspendem e EXCLUEM conta de cliente. Uma permissão que erra para o lado aberto é,
// literalmente, como se vaza empresa — o erro aparece no vazamento, não no monitor. Falha fechada:
// no pior caso alguém legítimo recebe 403 e o chefe decide o que abrir, com nome e critério.
//
// ── QUEM É "SUPER" AQUI, MEDIDO EM `base/auth.js` ───────────────────────────────────────────────
//   · cookie de sessão (pessoa) → `isSuperuser` é SEMPRE `false`, sem exceção;
//   · token de serviço + `x-ragnabot-ator-papel: super` (o NOC) → `isSuperuser: true`, `role: 'admin'`.
// ⚠️ Repare que o super chega com `role === 'admin'`: o PAPEL SOZINHO NÃO DISTINGUE super de admin.
// Por isso esta função aceita, no primeiro argumento, tanto o id em texto quanto o próprio
// `req.user` — quando recebe o objeto, ela lê `isSuperuser`, que é o único campo que carrega o fato.
// Os dois chamadores de hoje já testam `req.user.isSuperuser` ANTES de chegar aqui, então na
// prática esta função só é consultada para quem NÃO é super. O suporte ao objeto existe para o dia
// em que alguém a chamar direto — e para que esse dia não vire um `false` silencioso e inexplicável.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import logger from '../base/logger.js';

/** O ator é super usuário do produto? Lê o FATO (`isSuperuser`), nunca o papel em texto sozinho. */
function ehSuper(ator, papel) {
  if (ator && typeof ator === 'object') {
    if (ator.isSuperuser === true) return true;
    // Objeto sem a marca: ainda assim aceitamos o papel declarado 'super', que é o que o
    // `authMiddleware` recebe do NOC antes de traduzir para `isSuperuser`.
    if (String(ator.role || '').toLowerCase() === 'super') return true;
  }
  return String(papel || '').toLowerCase() === 'super';
}

/**
 * O ator pode operar o "grupo" pedido?
 *
 * Assinatura IDÊNTICA à do NOC, de propósito — os routers já a chamam assim e não são meus:
 *   `await userHasGroupAccess(req.user.id, req.user.role, 'RAGNATELA')`
 *
 * @param {string|object} ator  id do ator (texto) ou o próprio `req.user`
 * @param {string} papel        'super' | 'admin' | 'user'
 * @param {string} nomeDoGrupo  mantido na assinatura; aqui é apenas registrado
 * @returns {Promise<boolean>}  true SOMENTE para super usuário
 */
export async function userHasGroupAccess(ator, papel, nomeDoGrupo) {
  if (ehSuper(ator, papel)) return true;
  const quem = (ator && typeof ator === 'object') ? (ator.id ?? '?') : (ator ?? '?');
  // `debug`, e não `warn`: para um admin de empresa este 403 é o funcionamento normal, e um aviso
  // por pedido normal é como um log vira ruído que ninguém mais lê.
  logger.debug(`[permissao] "${quem}" (papel=${papel ?? '?'}) não é super — grupo `
    + `"${nomeDoGrupo ?? '?'}" não se aplica no Ragnabot; o escopo por empresa decide.`);
  return false;
}

/**
 * Espelho de escrita, pela mesma regra. Não é chamado por ninguém hoje; existe porque o módulo do
 * NOC tinha o par (leitura/escrita) e um dia alguém copia a linha de lá para cá — e é melhor que
 * ela caia numa função com a MESMA política do que num `undefined` no meio de uma escrita.
 */
export async function userCanModifyGroup(ator, papel, nomeDoGrupo) {
  return userHasGroupAccess(ator, papel, nomeDoGrupo);
}

export default { userHasGroupAccess, userCanModifyGroup };
