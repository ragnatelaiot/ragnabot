// ════════════════════════════════════════════════════════════════════════════════════════════════
// WEBHOOK DO RAGNABOT (Chatwoot) — recebe eventos da plataforma e alimenta protocolo + auditoria.
//
// COMO O RAGNABOT AVISA: no Chatwoot, cada Account (= uma empresa nossa) tem um webhook apontando
// para cá. Ele dispara em conversation_created, conversation_status_changed, etc. Aqui a gente:
//   • emite o PROTOCOLO quando a conversa nasce (RGT-0000000001, sequência da empresa);
//   • registra a AUDITORIA de início/fim de atendimento.
//
// A PONTE empresa↔plataforma é `RagnabotTenant.cwAccountId` (1 empresa = 1 Account). Evento de
// account que não é nossa é IGNORADO — nunca cria protocolo para empresa desconhecida.
//
// SEGURANÇA: valida um segredo compartilhado (comparação resistente a timing). Montado ANTES do
// express.json global se precisar do corpo cru; aqui usa JSON já parseado (Chatwoot manda JSON).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import crypto from 'node:crypto';
import prisma from '../base/db.js';
import * as protocolo from '../services/ragnabot-protocolo.service.js';
import * as auditoria from '../services/ragnabot-auditoria.service.js';
import logger from '../base/logger.js';

const router = Router();

// Comparação de segredo resistente a timing — mesmo padrão do webhook do Zabbix e da cobrança.
function segredoConfere(recebido) {
  const esperado = process.env.RAGNABOT_WEBHOOK_SEGREDO || '';
  if (!esperado) return null; // null = não configurado (recusa com log claro)
  const a = Buffer.from(String(recebido || ''));
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function tenantDaAccount(cwAccountId) {
  if (cwAccountId == null) return null;
  return prisma.ragnabotTenant.findUnique({ where: { cwAccountId: Number(cwAccountId) } });
}

router.post('/', async (req, res) => {
  const token = req.get('x-ragnabot-token') || req.query.token;
  const ok = segredoConfere(token);
  if (ok === null) {
    logger.error('[ragnabot-webhook] RAGNABOT_WEBHOOK_SEGREDO vazio — recusado');
    return res.status(503).json({ error: 'webhook não configurado' });
  }
  if (!ok) {
    logger.warn(`[ragnabot-webhook] token inválido (ip=${req.ip})`);
    return res.status(401).json({ error: 'não autorizado' });
  }

  // ⚠️ 200 SOMENTE DEPOIS DE GRAVAR. (Corrigido em 28/08/2026 — a versão anterior respondia 200
  // ANTES de processar, justificando com "o processamento é idempotente". O raciocínio estava
  // errado: idempotência protege contra DUPLICAR, não contra PERDER. Se o processo morresse entre
  // o 200 e a emissão do protocolo, o Chatwoot já teria recebido sucesso e NUNCA reenviaria —
  // aquele atendimento ficaria sem protocolo para sempre, em silêncio.)
  //
  // Agora: erro devolve 500, e o Chatwoot reenvia. Reenvio é seguro porque a emissão de protocolo
  // é idempotente por conversa — é AQUI que a idempotência tem o papel dela: tornar a repetição
  // inofensiva, permitindo que a gente exija a repetição.
  try {
    const evt = req.body || {};
    const tipo = evt.event; // conversation_created | conversation_status_changed | ...
    const conv = evt.conversation || evt;
    const cwAccountId = evt.account?.id ?? conv.account_id ?? conv.inbox?.account_id;
    const cwConversationId = conv.id ?? conv.display_id;

    const tenant = await tenantDaAccount(cwAccountId);
    if (!tenant) {
      logger.warn(`[ragnabot-webhook] evento ${tipo} de account ${cwAccountId} sem empresa mapeada — ignorado`);
      // 200: não é erro nosso, e reenviar não mudaria nada. Não deve virar fila de repetição.
      return res.json({ ok: true, ignorado: 'empresa não mapeada' });
    }

    if (tipo === 'conversation_created') {
      // 1) protocolo (idempotente)
      // Falha aqui PROPAGA de propósito (antes era engolida e o fluxo seguia sem protocolo).
      // Sem protocolo, o atendimento nasce órfão — melhor devolver 500 e deixar o Chatwoot
      // reenviar do que registrar um começo de atendimento sem o número que o dono exigiu.
      const r = await protocolo.emitirProtocolo({ tenantId: tenant.id, cwAccountId, cwConversationId });
      const proto = r.protocolo;
      if (r.novo) logger.info(`[ragnabot-webhook] protocolo ${proto} emitido (empresa ${tenant.slug})`);

      // 2) auditoria de início — SOMENTE quando o protocolo é NOVO.
      // ⚠️ Sem este `if`, o reenvio do mesmo evento gravava um SEGUNDO "atendimento_iniciado" para
      // a mesma conversa (achado pelo teste de ponta a ponta: 3 registros onde deviam ser 2).
      // Passou a importar porque agora o erro devolve 500 e o reenvio é ESPERADO — a auditoria
      // encheria de linhas repetidas justamente quando a rede está ruim. `r.novo` é a única
      // fonte confiável de "isto aconteceu pela primeira vez": vem do unique da conversa no banco.
      if (r.novo) {
        await auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'sistema', categoria: 'atendimento', acao: 'atendimento_iniciado',
          protocolo: proto, entidade: 'conversation', entidadeId: String(cwConversationId),
          descricao: `Conversa ${cwConversationId} aberta`,
        });
      }
      return res.json({ ok: true, protocolo: proto });
    }

    if (tipo === 'conversation_status_changed' || tipo === 'conversation_resolved') {
      const status = conv.status;
      if (status === 'resolved' || tipo === 'conversation_resolved') {
        const reg = await prisma.ragnabotProtocolo.findUnique({
          where: { cwAccountId_cwConversationId: { cwAccountId: Number(cwAccountId), cwConversationId: Number(cwConversationId) } },
        }).catch(() => null);
        await auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'agent',
          atorId: evt.assignee?.id ? String(evt.assignee.id) : null,
          atorNome: evt.assignee?.name || null,
          categoria: 'atendimento', acao: 'atendimento_encerrado',
          protocolo: reg?.protocolo || null, entidade: 'conversation', entidadeId: String(cwConversationId),
          descricao: `Conversa ${cwConversationId} encerrada`,
        });
      }
      return res.json({ ok: true });
    }

    // Outros eventos (config, agentes) podem ser mapeados aqui conforme o Chatwoot os expuser.
    logger.debug(`[ragnabot-webhook] evento ${tipo} recebido (empresa ${tenant.slug}) — sem ação`);
    return res.json({ ok: true, semAcao: tipo });
  } catch (e) {
    // 500 = "não gravei, mande de novo". É o que transforma uma falha passageira (banco
    // reiniciando, rede piscando) em reenvio, em vez de evento perdido em silêncio.
    logger.error(`[ragnabot-webhook] erro ao processar: ${e.message}`);
    return res.status(500).json({ error: 'falha ao processar; reenvie' });
  }
});

export default router;
