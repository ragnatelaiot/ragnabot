// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — Auditoria e Protocolo do Ragnabot.
//
// Montagem (src/server.js) com auth. NÃO usa adminOnly no router inteiro porque o admin de EMPRESA
// (que não é admin do NOC) também consulta a auditoria DELE — o isolamento é feito por `escopoDe`,
// não pelo middleware. Quem não tiver escopo simplesmente não vê nada (falha fechada no serviço).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import * as auditoria from '../services/ragnabot-auditoria.service.js';
import * as protocolo from '../services/ragnabot-protocolo.service.js';

const router = Router();
const erro = (res, e, s = 400) => res.status(s).json({ error: e.message || String(e) });

// ── AUDITORIA ────────────────────────────────────────────────────────────────────────────────────
// O escopo (empresa) vem SEMPRE de req.user — a tela só manda filtros que estreitam.
router.get('/auditoria', async (req, res) => {
  try {
    const r = await auditoria.consultar(req.user, {
      tenantId: req.query.tenantId, categoria: req.query.categoria, acao: req.query.acao,
      atorId: req.query.atorId, ip: req.query.ip, protocolo: req.query.protocolo,
      de: req.query.de, ate: req.query.ate, limite: req.query.limite,
    });
    res.json(r);
  } catch (e) { erro(res, e, 500); }
});

// Dados do relatório (o PDF é montado no frontend com o motor que o NOC já tem).
router.get('/auditoria/relatorio', async (req, res) => {
  try {
    res.json(await auditoria.dadosParaRelatorio(req.user, req.query));
  } catch (e) { erro(res, e, 500); }
});

// ── PROTOCOLO ──────────────────────────────────────────────────────────────────────────────────
// Busca respeitando isolamento: super user vê qualquer um; admin de empresa só o da empresa dele.
router.get('/protocolo/:protocolo', async (req, res) => {
  try {
    const escopo = auditoria.escopoDe(req.user);
    const reg = await protocolo.buscarPorProtocolo(req.params.protocolo, {
      tenantIdEscopo: escopo.global ? null : escopo.tenantId,
    });
    if (!reg) return res.status(404).json({ error: 'protocolo não encontrado' });
    res.json(reg);
  } catch (e) { erro(res, e, 500); }
});

router.get('/protocolos', async (req, res) => {
  try {
    const escopo = auditoria.escopoDe(req.user);
    if (!escopo.global && !escopo.tenantId) return res.json([]);
    res.json(await protocolo.listarProtocolos({
      tenantIdEscopo: escopo.global ? null : escopo.tenantId, limite: req.query.limite,
    }));
  } catch (e) { erro(res, e, 500); }
});

export default router;
