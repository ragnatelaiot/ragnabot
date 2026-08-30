// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — origens autorizadas (quem pode abrir chamado) e contatos recusados.
//
// Montagem em src/server.js (o mount JÁ carrega auth + adminOnly):
//   app.use('/api/ragnabot-origem', authMiddleware, adminOnly, ...)
// `adminOnly` já inclui superuser — política permanente da casa.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import * as origem from '../services/ragnabot-origem.service.js';
import { logAction } from '../base/auditoria.js';

const router = Router();

const erro = (res, e, status = 400) => res.status(status).json({ error: e.message || String(e) });

// ── consulta ───────────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    res.json(await origem.listarOrigens({ tenantId: req.query.tenantId || undefined }));
  } catch (e) { erro(res, e, 500); }
});

// Simulação: "este contato entraria, e em qual empresa?" — permite conferir o cadastro ANTES de
// um cliente real ser barrado, que é quando o erro custa caro.
router.get('/simular', async (req, res) => {
  try {
    const { canal = 'email', valor } = req.query;
    if (!valor) return erro(res, new Error('informe ?valor='));
    const r = await origem.resolverEmpresa(canal, valor);
    res.json({
      canal, valor,
      autorizado: r.autorizado,
      empresa: r.tenant ? { id: r.tenant.id, nome: r.tenant.name, status: r.tenant.status } : null,
      casouPor: r.origem ? { tipo: r.origem.tipo, valor: r.origem.valor } : null,
      motivo: r.motivo || null,
    });
  } catch (e) { erro(res, e, 500); }
});

router.get('/recusados', async (req, res) => {
  try {
    res.json(await origem.listarRecusados({
      apenasPendentes: req.query.todos !== 'true',
      limite: req.query.limite,
    }));
  } catch (e) { erro(res, e, 500); }
});

// Prévia do texto que o remetente barrado recebe — para o dono conferir a redação sem disparar nada.
router.get('/texto-recusa', (_req, res) => res.json(origem.textoDaRecusa()));

// ── cadastro ───────────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { tenantId, tipo, valor, observacao } = req.body || {};
    const criada = await origem.cadastrarOrigem({ tenantId, tipo, valor, observacao, usuarioId: req.user?.id });
    await logAction({ user: req.user, req, action: 'ragnabot_origem_cadastrada', category: 'settings',
      entityType: 'RagnabotOrigemAutorizada', entityId: criada.id, rollbackable: false,
      description: `Origem ${tipo}:${criada.valor} autorizada para a empresa ${tenantId}` }).catch(() => {});
    res.status(201).json(criada);
  } catch (e) { erro(res, e); }
});

router.patch('/:id/desativar', async (req, res) => {
  try {
    const r = await origem.desativarOrigem({ id: req.params.id, motivo: req.body?.motivo });
    await logAction({ user: req.user, req, action: 'ragnabot_origem_desativada', category: 'settings',
      entityType: 'RagnabotOrigemAutorizada', entityId: r.id, rollbackable: false,
      description: `Origem ${r.tipo}:${r.valor} desativada — ${req.body?.motivo}` }).catch(() => {});
    res.json(r);
  } catch (e) { erro(res, e); }
});

router.patch('/:id/reativar', async (req, res) => {
  try {
    const r = await origem.reativarOrigem({ id: req.params.id });
    await logAction({ user: req.user, req, action: 'ragnabot_origem_reativada', category: 'settings',
      entityType: 'RagnabotOrigemAutorizada', entityId: r.id, rollbackable: false,
      description: `Origem ${r.tipo}:${r.valor} reativada` }).catch(() => {});
    res.json(r);
  } catch (e) { erro(res, e); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await origem.removerOrigem({ id: req.params.id });
    await logAction({ user: req.user, req, action: 'ragnabot_origem_removida', category: 'settings',
      entityType: 'RagnabotOrigemAutorizada', entityId: r.id, rollbackable: false,
      description: `Origem ${r.tipo}:${r.valor} REMOVIDA do cadastro` }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});

export default router;
