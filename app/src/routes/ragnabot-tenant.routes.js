// =============================================================================
// RAGNABOT — rotas administrativas do SaaS (empresas/tenants e multiconexão).
//
// Montagem esperada em src/server.js (o mount JÁ carrega auth + adminOnly):
//   app.use('/api/ragnabot', authMiddleware, adminOnly,
//     (await import('./routes/ragnabot-tenant.routes.js')).default);
//
// REGRAS APLICADAS AQUI:
//   · adminOnly já inclui superuser (política permanente da casa).
//   · Ação que muda o mundo exige 2FA do operador + justificativa: sem código →
//     devolve `needs2fa` (200); código inválido → 403 com code INVALID_2FA,
//     NUNCA 401 (401 fora do login derruba a sessão inteira no front).
//   · Ato irreversível (exclusão definitiva de dados de terceiros) é só superuser.
//   · Nenhuma credencial de canal volta na resposta nem entra no log.
//
// NOC 2026-08-28.
// =============================================================================
import { Router } from 'express';
import prisma from '../base/db.js';
import * as tenants from '../services/ragnabot-tenant.service.js';
import { PLANOS, CANAIS, limitesDoPlano } from '../config/ragnabot-plans.js';

const router = Router();

// ── DEFESA EM PROFUNDIDADE (mesmo padrão de ragnabot-cluster.routes.js) ─────
// O mount documentado já é `authMiddleware + adminOnly`, mas um router que
// provisiona, suspende e EXCLUI conta de cliente não pode depender de uma linha
// do server.js estar certa. Aqui a checagem é refeita, e some a brecha de um
// admin cujo escopo é outro cliente operar o SaaS do RAGNABOT: o modelo de três
// papéis da casa diz que admin é pleno SÓ nos grupos dele. Superusuário passa
// sempre (política permanente: superuser ⊇ admin em tudo).
router.use(async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Não autenticado.' });
    }
    if (req.user.isSuperuser) return next();
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Ação restrita a administradores.' });
    }
    const { userHasGroupAccess } = await import('../services/device.service.js');
    if (await userHasGroupAccess(req.user.id, req.user.role, 'RAGNATELA')) return next();
    return res.status(403).json({ success: false, error: 'Sem acesso ao grupo RAGNATELA — o SaaS do RAGNABOT é operado por ele.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ── 2FA do operador logado (mesmo mecanismo do noc-power) ───────────────────
async function checar2fa(req) {
  const { otpChannel, otpCode } = req.body || {};
  if (!otpCode) {
    // S5: os canais saem da SESSÃO, não de `prisma.user` — aquela era a tabela de usuários DO NOC,
    // que não existe na base do Ragnabot (o resultado era um 500 com "findUnique of undefined").
    // O e-mail vem da plataforma no login; sem ele (chamada pela ponte de serviço), não há para
    // onde mandar código — e adivinhar destino de código de segurança é o erro a evitar.
    const otp = await import('../services/otp.service.js');
    return {
      needs2fa: true,
      channels: otp.canaisDe(req.user),
      emailHint: otp.dicaDeEmail(req.user?.email),
    };
  }
  const otp = await import('../services/otp.service.js');
  const vr = (otpChannel === 'totp')
    ? await otp.verifyTotp(req.user.id, otpCode)
    : await otp.verifyEmailOtp(req.user.id, otpCode, 'access_2fa');
  return { ok: !!vr?.ok };
}

/**
 * Envelopa uma ação sensível: 2FA + justificativa obrigatória.
 * Devolve `false` quando já respondeu (precisa de 2FA / recusado / sem motivo).
 */
async function portao(req, res, { exigirJustificativa = true } = {}) {
  const g = await checar2fa(req);
  if (g.needs2fa) { res.json({ success: true, data: g }); return false; }
  if (!g.ok) { res.status(403).json({ success: false, error: 'Código 2FA inválido ou expirado.', code: 'INVALID_2FA' }); return false; }
  if (exigirJustificativa && !String(req.body?.justificativa || '').trim()) {
    res.status(400).json({ success: false, error: 'Justificativa obrigatória.' });
    return false;
  }
  return true;
}

function somenteSuperuser(req, res, next) {
  if (req.user?.isSuperuser) return next();
  return res.status(403).json({ success: false, error: 'Ação restrita ao superusuário.' });
}

function responder(res, promessa) {
  return promessa
    .then((data) => res.json({ success: true, data }))
    .catch((err) => res.status(400).json({ success: false, error: err.message }));
}

// ── Prepara o canal do 2FA (e-mail ou app autenticador) ─────────────────────
router.post('/2fa/request-otp', async (req, res) => {
  try {
    const canal = req.body?.channel === 'totp' ? 'totp' : 'email';
    const otp = await import('../services/otp.service.js');
    if (canal === 'email') {
      // S5: o ator (3º argumento) é de onde sai o e-mail — da sessão da plataforma.
      const r = await otp.createAndSendEmailOtp(req.user.id, 'access_2fa', req.user);
      if (!r?.ok) {
        // Falha fechada e HONESTA: a tela não pode receber `sent: true` sem o código ter saído.
        const st = r?.code === 'SMTP_INDISPONIVEL' ? 503 : 400;
        return res.status(st).json({ success: false, error: r?.error || 'Não consegui enviar o código.' });
      }
      return res.json({ success: true, data: { channel: 'email', sent: true, emailHint: otp.dicaDeEmail(req.user?.email), ttlMinutes: r.ttlMinutes } });
    }
    // S5: o aplicativo autenticador NÃO existe nesta aplicação — o segredo dele ficou na tabela de
    // usuários do NOC. Dizer isso é melhor que fingir que existe e falhar na conferência.
    if (!otp.canaisDe(req.user).totp) {
      return res.status(400).json({ success: false, error: 'Aplicativo autenticador não está disponível aqui — use o código por e-mail.' });
    }
    res.json({ success: true, data: { channel: 'totp', sent: false } });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── Catálogo e saúde (leitura) ──────────────────────────────────────────────

// Planos disponíveis e o que cada um libera. Sem preço — preço é decisão do dono
// e, quando existir, vive em Configurações (encrypted), nunca no código.
router.get('/planos', (req, res) => {
  const lista = Object.keys(PLANOS).map((chave) => ({ chave, ...limitesDoPlano(chave) }));
  res.json({ success: true, data: { planos: lista, canais: CANAIS } });
});

// A integração com a plataforma está de pé? (não cria nada)
router.get('/saude', (req, res) => responder(res, tenants.verificarIntegracao()));

// ── Empresas (tenants) ──────────────────────────────────────────────────────

router.get('/tenants', (req, res) => responder(res, tenants.listarEmpresas({ status: req.query.status || null })));

router.get('/tenants/:id', (req, res) => responder(res, tenants.obterEmpresa(req.params.id)));

// PROVISIONAR EM UMA AÇÃO — cria conta, admin e vínculo; rollback se falhar no meio.
router.post('/tenants', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const dados = {
      nome: req.body?.nome,
      slug: req.body?.slug,
      cnpj: req.body?.cnpj,
      contatoNome: req.body?.contatoNome,
      contatoEmail: req.body?.contatoEmail,
      contatoWhatsapp: req.body?.contatoWhatsapp,
      plano: req.body?.plano,
      limitesOverride: req.body?.limitesOverride || null,
      retencaoDias: req.body?.retencaoDias,
    };
    const out = await tenants.provisionarEmpresa(dados, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.patch('/tenants/:id/plan', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.alterarPlano(req.params.id, req.body?.plano, {
      override: req.body?.limitesOverride || null, ator: req.user, req,
    });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/tenants/:id/suspend', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.suspenderEmpresa(req.params.id, {
      motivo: String(req.body?.justificativa || '').trim(), ator: req.user, req,
    });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/tenants/:id/reactivate', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.reativarEmpresa(req.params.id, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/tenants/:id/close', somenteSuperuser, async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.encerrarEmpresa(req.params.id, {
      motivo: String(req.body?.justificativa || '').trim(), ator: req.user, req,
    });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// IRREVERSÍVEL: apaga a conta e TODAS as conversas dos clientes do cliente.
// Exige superusuário, 2FA, justificativa e a digitação exata do identificador.
router.post('/tenants/:id/purge', somenteSuperuser, async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.excluirDefinitivamente(req.params.id, {
      confirmacaoSlug: req.body?.confirmacaoSlug, ator: req.user, req,
    });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// Link de acesso ao painel do cliente. É dado de terceiro: 2FA + motivo + auditoria.
router.post('/tenants/:id/sso', somenteSuperuser, async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.linkDeAcesso(req.params.id, {
      ator: req.user, req, motivo: String(req.body?.justificativa || '').trim(),
    });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── MULTICONEXÃO: caixas de entrada da empresa ──────────────────────────────

router.get('/tenants/:id/inboxes', (req, res) => responder(res, tenants.listarCaixas(req.params.id)));

router.post('/tenants/:id/inboxes/sync', (req, res) => responder(res, tenants.sincronizarCaixas(req.params.id)));

// Cria a conexão. O corpo carrega credencial de canal (token da Meta, bot do
// Telegram) — por isso 2FA obrigatório e nada disso volta na resposta.
router.post('/tenants/:id/inboxes', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const { otpChannel, otpCode, justificativa, ...dados } = req.body || {};
    const out = await tenants.criarCaixa(req.params.id, dados, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// Alias em POST: cliente HTTP que não envia corpo em DELETE (o corpo carrega o
// código 2FA e a justificativa) usa esta rota — mesmo efeito, mesmo portão.
router.post('/tenants/:id/inboxes/:inboxId/remove', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.removerCaixa(req.params.id, req.params.inboxId, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.delete('/tenants/:id/inboxes/:inboxId', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.removerCaixa(req.params.id, req.params.inboxId, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── Atendentes da empresa ───────────────────────────────────────────────────

router.get('/tenants/:id/agents', (req, res) => responder(res, tenants.listarAgentes(req.params.id)));

router.post('/tenants/:id/agents', async (req, res) => {
  try {
    if (!(await portao(req, res))) return;
    const out = await tenants.convidarAgente(req.params.id, {
      nome: req.body?.nome, email: req.body?.email, papel: req.body?.papel,
    }, { ator: req.user, req });
    res.json({ success: true, data: out });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

export default router;
