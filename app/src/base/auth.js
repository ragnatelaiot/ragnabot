// ════════════════════════════════════════════════════════════════════════════════════════════════
// QUEM AUTENTICA NA APLICAÇÃO DO RAGNABOT — decisão do chefe, 30/08/2026 (doc 33 §7)
//
// O agente da Etapa 1 fez a pergunta certa e NÃO copiou o `authMiddleware` do NOC: copiar seria
// levar o acoplamento junto na mudança de casa. Este arquivo é a resposta.
//
// ── O DESENHO ───────────────────────────────────────────────────────────────────────────────────
// 1. SERVIÇO A SERVIÇO (NOC → Ragnabot). O NOC chama com um TOKEN DE SERVIÇO próprio
//    (`RAGNABOT_SERVICE_TOKEN`, no cofre dos dois lados) e DECLARA em cabeçalho quem é o operador
//    humano que pediu a ação. A auditoria registra que aquela identidade foi ASSERIDA pelo NOC —
//    nunca como se tivesse sido verificada aqui.
//
//    Por que é aceitável: o NOC é console de operação, autentica os próprios operadores e já decide
//    o escopo deles. Delegar identidade entre serviços confiáveis é padrão — desde que o registro
//    diga que foi delegação. É o que a marca `viaNoc: true` faz.
//
// 2. ⛔ O LIMITE, que é onde muita gente erra. A identidade asserida vale SOMENTE para escopo de
//    OPERADOR (nós administrando). NUNCA pode servir para o cliente final se atender: no dia em que
//    o admin de uma empresa cliente usar a plataforma, a identidade dele tem de ser verificada PELO
//    RAGNABOT, contra a própria plataforma. Senão quem controla o cabeçalho controla o escopo, e o
//    isolamento entre empresas que provamos com teste vira enfeite.
//
//    Concretamente: um pedido autenticado por token de serviço JAMAIS recebe `tenantId` do
//    cabeçalho como se fosse dono da empresa. O `escopoDe()` dos routers continua mandando, e para
//    o super usuário do NOC o `tenantId` é FILTRO (estreita), nunca concessão (alarga).
//
// 3. A ponte é TRANSITÓRIA POR DESENHO. A Etapa 4 do doc 33 a encerra: quando as telas mudarem de
//    casa, quem autentica é a plataforma. Está escrito para não virar permanente por esquecimento.
//
// ── FALHA FECHADA ───────────────────────────────────────────────────────────────────────────────
// Sem `RAGNABOT_SERVICE_TOKEN` definido, TUDO que é privado recusa com 503. Um serviço de
// atendimento que sobe sem saber quem é quem é pior que um serviço fora do ar: o fora do ar aparece
// no monitor; o aberto só aparece no vazamento.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import logger from './logger.js';

const TOKEN_SERVICO = (process.env.RAGNABOT_SERVICE_TOKEN || '').trim();
const CAB_TOKEN = 'x-ragnabot-service-token';
const CAB_ATOR_ID = 'x-ragnabot-ator-id';
const CAB_ATOR_NOME = 'x-ragnabot-ator-nome';
const CAB_ATOR_PAPEL = 'x-ragnabot-ator-papel'; // super | admin | user

/** Comparação resistente a tempo. Comparar segredo com `===` vaza o tamanho do prefixo certo. */
function iguais(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * Autentica o pedido. Popula `req.user` com a MESMA forma que os routers já esperam
 * (`id`, `name`, `role`, `isSuperuser`) — os routers foram copiados sem mudança e continuam
 * lendo isso —, acrescido de `viaNoc: true`, que a auditoria usa para registrar a delegação.
 */
export function authMiddleware(req, res, next) {
  if (!TOKEN_SERVICO) {
    return res.status(503).json({
      error: 'AUTH_NAO_CONFIGURADA',
      message: 'RAGNABOT_SERVICE_TOKEN não está definido — o serviço recusa tudo que é privado.',
    });
  }
  const oferecido = req.get(CAB_TOKEN);
  if (!oferecido || !iguais(oferecido, TOKEN_SERVICO)) {
    // Não dizemos QUAL parte falhou: mensagem detalhada de autenticação é mapa para quem tenta.
    logger.warn(`[auth] token de serviço recusado · ip=${req.ip} · rota=${req.originalUrl}`);
    return res.status(401).json({ error: 'NAO_AUTENTICADO' });
  }

  const papel = String(req.get(CAB_ATOR_PAPEL) || 'user').toLowerCase();
  req.user = {
    id: req.get(CAB_ATOR_ID) || null,
    name: req.get(CAB_ATOR_NOME) || 'operador (via NOC)',
    role: papel === 'super' ? 'admin' : papel,
    isSuperuser: papel === 'super',
    // ⚠️ A marca que a auditoria PRECISA registrar: esta identidade foi afirmada por outro serviço,
    // não verificada aqui. Sem ela, o registro mentiria dizendo que conferimos quem era.
    viaNoc: true,
  };
  return next();
}

/** Exige papel de administrador (ou super). */
export function adminOnly(req, res, next) {
  if (req.user?.isSuperuser || req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'SEM_PERMISSAO', message: 'Esta ação exige administrador.' });
}

/** Exige super usuário. Usado no que mexe em dinheiro e em empresa. */
export function superuserOnly(req, res, next) {
  if (req.user?.isSuperuser) return next();
  return res.status(403).json({ error: 'SEM_PERMISSAO', message: 'Esta ação exige super usuário.' });
}

/** Para o `/saude`: diz se a autenticação está configurada, SEM revelar o segredo. */
export function autenticacaoPronta() {
  return { configurada: Boolean(TOKEN_SERVICO), modo: 'token-de-servico + ator-asserido (via NOC)' };
}

export default { authMiddleware, adminOnly, superuserOnly, autenticacaoPronta };
