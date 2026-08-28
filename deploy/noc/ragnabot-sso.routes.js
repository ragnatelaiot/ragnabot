// Entrada integrada no Ragnabot — SOMENTE super users do NOC (ordem do dono).
// NOC 2026-08-28.
import { Router } from 'express';
import { entradaDireta, integracaoDisponivel } from '../services/ragnabot-sso.service.js';
import { logAction } from '../services/audit.service.js';

const router = Router();

// Trava dupla: o mount já é autenticado, mas aqui exigimos SUPER USER — é a regra
// do dono ("só os super users do NOC gerenciam o SaaS do Ragnabot").
router.use((req, res, next) => {
  if (req.user?.isSuperuser) return next();
  return res.status(403).json({ error: 'Somente super users acessam o Ragnabot pelo NOC.' });
});

// A ponte está de pé? (o menu usa para mostrar ou esconder o item)
router.get('/status', async (req, res) => {
  try { res.json(await integracaoDisponivel()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Gera o endereço de entrada direta para o super user logado.
router.post('/entrar', async (req, res) => {
  try {
    const r = await entradaDireta(req.user);
    // auditoria: entrar no atendimento é ação sensível e fica registrada
    await logAction({
      userId: req.user.id,
      userName: req.user.name,
      action: 'ragnabot_sso_entrada',
      details: `Entrou no Ragnabot como ${r.email}`,
      ipAddress: req.ip,
    }).catch(() => {});
    res.json({ url: r.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
