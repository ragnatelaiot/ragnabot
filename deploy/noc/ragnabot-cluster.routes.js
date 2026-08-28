// Saúde do cluster RAGNABOT (plataforma de atendimento chat002). Somente LEITURA.
// Espelha o padrão do cluster SISAC, mas para esta pilha: Kubernetes + PostgreSQL.
// NOC 2026-08-28.
import { Router } from 'express';
import { getRagnabotClusterHealth, getRagnabotServidores } from '../services/ragnabot-cluster.service.js';

const router = Router();

// Defesa em profundidade por GRUPO: o mount já é adminOnly, mas este router
// fala de UM cliente (grupo RAGNATELA). Superuser passa; os demais precisam de
// acesso de leitura ao grupo. Mesma regra do router do SISAC.
router.use(async (req, res, next) => {
  try {
    if (req.user?.isSuperuser) return next();
    const { userHasGroupAccess } = await import('../services/device.service.js');
    if (await userHasGroupAccess(req.user.id, req.user.role, 'RAGNATELA')) return next();
    return res.status(403).json({ error: 'Sem acesso ao grupo RAGNATELA' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// Estado ao vivo: nós do Kubernetes, bancos (quem é primário), espaço, atualização.
router.get('/health', async (req, res) => {
  try { res.json(await getRagnabotClusterHealth()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Servidores do cluster conforme cadastrados no NOC.
router.get('/servidores', async (req, res) => {
  try { res.json(await getRagnabotServidores()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
