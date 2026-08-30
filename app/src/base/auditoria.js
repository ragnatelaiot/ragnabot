// ════════════════════════════════════════════════════════════════════════════════════════════════
// ADAPTADOR DE AUDITORIA — a mesma assinatura de `logAction` do NOC, gravando na auditoria do
// RAGNABOT (`RagnabotAuditoria`), não na do NOC (`AuditLog`).
//
// Por que um adaptador, e não um "logAction" novo: cinco pontos do produto (SSO, origem, cobrança,
// atendimento, respostas rápidas) já chamam `logAction({...})` com o vocabulário do NOC. Reescrever
// os cinco na mesma etapa em que se troca o banco de lugar seria misturar duas mudanças — se algo
// falhasse, não saberíamos qual delas. O adaptador deixa a Etapa 1 ser só mudança de casa.
//
// ⚠️ NÃO é a mesma tabela. A auditoria do NOC guarda IP público, impressão digital do navegador e
// rollback; a do Ragnabot guarda o que é do produto e é ISOLADA POR EMPRESA (`tenantId`). Os
// campos que não têm par aqui (rollbackable, sessionId, durationSec) são DESCARTADOS, de propósito
// — não existe rollback de ação do Ragnabot pela auditoria dele.
//
// Migração futura (não é desta etapa): trocar os 5 pontos por `registrar()` direto e apagar este
// arquivo. Ele existe para poder ser apagado.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { registrar } from '../services/ragnabot-auditoria.service.js';

// Categorias do NOC → as 5 do Ragnabot. O que não casa vira 'configuracao', que é o default
// conservador do próprio serviço (mudança de configuração é a suposição mais provável e a menos
// enganosa: nunca marca como "acesso" algo que não foi login).
const CATEGORIA_EQUIVALENTE = {
  auth: 'acesso',
  user: 'pessoas',
  chat: 'atendimento',
  settings: 'configuracao',
  system: 'configuracao',
  device: 'configuracao',
  group: 'configuracao',
  alert: 'dados',
  trigger: 'dados',
  task: 'dados',
};

// Categorias que o Ragnabot aceita — se alguém já passar a nossa, ela vale sem tradução.
const CATEGORIAS_RAGNABOT = new Set(['acesso', 'atendimento', 'configuracao', 'pessoas', 'dados']);

function traduzirCategoria(categoria, acao = '', temProtocolo = false) {
  if (CATEGORIAS_RAGNABOT.has(categoria)) return categoria;
  if (CATEGORIA_EQUIVALENTE[categoria]) return CATEGORIA_EQUIVALENTE[categoria];
  // Sem categoria: infere pelo prefixo da ação, como o NOC fazia.
  const prefixo = String(acao).split(/[._]/)[0];
  if (CATEGORIA_EQUIVALENTE[prefixo]) return CATEGORIA_EQUIVALENTE[prefixo];
  if (/login|logout|senha|otp|totp|sso|entrada/.test(acao)) return 'acesso';
  if (/atendimento|conversa|protocolo|transfer|relogio|rel[oó]gio|encerr|fila|mensagem/.test(acao)) return 'atendimento';
  // Ter protocolo é a prova mais forte que existe de que o evento é de ATENDIMENTO: o protocolo
  // só é emitido dentro de uma conversa. Vale mais que qualquer palpite pelo nome da ação.
  if (temProtocolo) return 'atendimento';
  return 'configuracao';
}

function limparIp(ip) {
  if (!ip) return null;
  let s = String(ip).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7); // IPv4 mapeado em IPv6
  return s.slice(0, 64) || null;
}

function ehPrivado(ip) {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(ip || '');
}

/**
 * IP REAL de quem fez a ação. Mesma ordem do NOC, e pelo mesmo motivo: o domínio fica atrás do
 * Cloudflare e de um proxy reverso, então `req.ip` é a borda, não o cliente.
 * Ordem: CF-Connecting-IP → primeiro IP PÚBLICO do X-Forwarded-For → req.ip → X-Real-IP → socket.
 */
export function extractIp(req) {
  if (!req) return null;
  const h = req.headers || {};
  const cf = limparIp(h['cf-connecting-ip'] || h['true-client-ip']);
  if (cf) return cf;
  const xff = h['x-forwarded-for'];
  if (xff) {
    const partes = String(xff).split(',').map(limparIp).filter(Boolean);
    const publico = partes.find((ip) => !ehPrivado(ip));
    if (publico) return publico;
  }
  if (req.ip) return limparIp(req.ip);
  return limparIp(h['x-real-ip'] || req.socket?.remoteAddress || req.connection?.remoteAddress);
}

/**
 * Registra uma ação. Aceita o vocabulário do `audit.service.js` do NOC e o traduz para
 * `RagnabotAuditoria`. Como o original, NUNCA lança — auditoria que derruba a operação é pior
 * que auditoria ausente.
 *
 * @param {object}  p
 * @param {object} [p.user]         { id, name, username, email, isSuperuser, ragnabotTenantId }
 * @param {string} [p.userId]       alternativa a `user` (o SSO chama assim)
 * @param {string} [p.userName]     alternativa a `user`
 * @param {string}  p.action        chave da ação → `acao`
 * @param {string} [p.category]     categoria do NOC ou do Ragnabot → `categoria`
 * @param {string} [p.entityType]   → `entidade`
 * @param {string} [p.entityId]     → `entidadeId`
 * @param {string} [p.description]  → `descricao`
 * @param {string} [p.details]      apelido de `description` (usado no SSO)
 * @param {any}    [p.payloadBefore] → `antes`
 * @param {any}    [p.payloadAfter]  → `depois`
 * @param {string} [p.tenantId]     empresa; se ausente, deduzida do usuário
 * @param {string} [p.protocolo]    quando o evento é de atendimento
 * @param {string} [p.ipAddress]    IP já resolvido (tem prioridade sobre `req`)
 * @param {object} [p.req]          requisição Express, para IP e User-Agent
 * @returns {Promise<object|null>}  a linha gravada, ou null se falhou (nunca lança)
 */
export async function logAction({
  user, userId, userName, action, category, entityType, entityId,
  description, details, payloadBefore, payloadAfter,
  tenantId, protocolo, ipAddress, req,
  // Campos do NOC sem par aqui — desestruturados só para não caírem em lugar nenhum por engano.
  rollbackable, sessionId, durationSec, // eslint-disable-line no-unused-vars
} = {}) {
  try {
    if (!action) return null;

    const ator = user || null;
    const id = ator?.id || userId || null;
    const nome = ator?.name || ator?.username || userName || null;

    // Sem ator identificado = ação de trabalhador/relógio: 'sistema'. Super user do NOC é 'super'
    // porque a tela de auditoria distingue quem tem alcance global de quem tem alcance de empresa.
    let atorTipo = 'sistema';
    if (id || nome) atorTipo = ator?.isSuperuser === true ? 'super' : 'usuario';

    return await registrar({
      // A empresa nunca vem "de fora" ampliando alcance: ou foi passada explicitamente pelo
      // serviço (que já a calculou), ou sai do vínculo do próprio usuário.
      tenantId: tenantId || ator?.ragnabotTenantId || ator?.clientCompanyId || null,
      atorTipo,
      atorId: id,
      atorNome: nome,
      atorEmail: ator?.email || null,
      categoria: traduzirCategoria(category, action, Boolean(protocolo)),
      acao: action,
      descricao: description || details || null,
      ip: ipAddress ? limparIp(ipAddress) : extractIp(req),
      userAgent: req?.headers?.['user-agent'] || null,
      protocolo: protocolo || null,
      entidade: entityType || null,
      entidadeId: entityId || null,
      antes: payloadBefore ?? null,
      depois: payloadAfter ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[base/auditoria] falha ao registrar:', e.message);
    return null;
  }
}

export default { logAction, extractIp };
