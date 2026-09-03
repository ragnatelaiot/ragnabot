// =============================================================================
// RAGNABOT — rotas de cobrança recorrente.
//
// DOIS ROTEADORES, DE PROPÓSITO:
//   • `default`        → operação (planos, assinaturas, cobranças). AUTENTICADO.
//                        Gate interno `superuserOnly`: isto mexe em dinheiro e pode
//                        suspender a conta de um cliente. Se um dia o dono quiser abrir
//                        para admins de NOC, troque uma linha (superuserOnly → adminOnly).
//   • `webhookRouter`  → retorno do provedor de pagamento. PÚBLICO por natureza.
//
// COMO O WEBHOOK É AUTENTICADO (leia antes de julgar)
//   A Efí NÃO assina a notificação da API de Cobranças: o POST traz apenas um token opaco
//   no campo `notification` (confirmado na documentação técnica). Portanto a autenticidade
//   se apoia em três camadas, nesta ordem:
//     1. SEGREDO NO CAMINHO — a URL registrada no provedor termina em /<segredo>. Quem não
//        conhece o segredo não chega ao processamento (comparação com timingSafeEqual).
//     2. A PROVA REAL — o token não carrega valor nenhum. Quem manda o webhook não consegue
//        dizer "foi pago": nós é que consultamos GET /v1/notification/:token na Efí, com as
//        NOSSAS credenciais, e o status vem de lá. Um atacante que adivinhe o segredo só
//        consegue nos fazer consultar um token inválido.
//     3. ASSINATURA HMAC OPCIONAL — se o provedor (ou um intermediário nosso) enviar o header
//        `x-ragnabot-assinatura`, ele é conferido contra o corpo cru. Existe para o dia em que
//        houver assinatura; não é exigido hoje porque hoje ela não existe.
//   Idempotência é obrigação, não zelo: a Efí repete a entrega até 9 vezes sem 2XX.
//
// NOC 2026-08-28.
// =============================================================================
import { Router } from 'express';
import { z } from 'zod';
import { superuserOnly } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { checkOperator2fa, requestOperatorOtp } from '../utils/operator-2fa.js';
import { logAction } from '../base/auditoria.js';
// ⭐ S6 (02/09/2026): a assinatura HMAC virou peça compartilhada. Nasceu DESTE arquivo (a
// conferência do retorno da Efí) e agora serve também para ASSINAR o que sai (webhook de saída,
// doc 34 §F9.4.3) — que era exatamente a ordem: «reaproveite, não reescreva».
import { conferir as conferirAssinatura, iguaisComSeguranca as comparacaoSegura } from '../base/assinatura.js';
import logger from '../base/logger.js';
import prisma from '../base/db.js';
import * as cobranca from '../services/ragnabot-cobranca.service.js';

// ═════════════════════════════════════════════════════════════════════════════
// ROTEADOR DE OPERAÇÃO
// ═════════════════════════════════════════════════════════════════════════════
const router = Router();
router.use(superuserOnly);

const erro = (res, e, http = 400) => {
  logger.warn(`[ragnabot-cobranca] ${e.message}`);
  return res.status(http).json({ success: false, error: e.message });
};

// ── Situação geral: adaptadores, o que falta configurar, receita recorrente ──
router.get('/situacao', async (req, res) => {
  try { res.json({ success: true, data: await cobranca.panoramaFinanceiro() }); }
  catch (e) { erro(res, e, 500); }
});

// ── 2FA do operador: pede o código antes das ações sensíveis ─────────────────
router.post('/2fa/solicitar', async (req, res) => {
  try { res.json({ success: true, data: await requestOperatorOtp(req, req.body?.canal) }); }
  catch (e) { erro(res, e); }
});

// ── PLANOS ───────────────────────────────────────────────────────────────────
const esquemaPlano = z.object({
  codigo: z.string().min(2).max(40).optional(),
  nome: z.string().min(2).max(80),
  descricao: z.string().max(500).nullish(),
  // Plano de CAPACIDADE correspondente (src/config/ragnabot-plans.js) — a validação
  // de existência é feita no serviço, que é quem conhece a matriz.
  codigoCapacidade: z.enum(['essencial', 'profissional', 'avancado', 'custom']).nullish(),
  // Preço em CENTAVOS e OPCIONAL: plano pode nascer sem preço — o valor é decisão do dono.
  precoCentavos: z.number().int().min(0).max(100_000_000).nullish(),
  cicloMeses: z.number().int().min(1).max(36).optional(),
  limiteAgentes: z.number().int().min(0).max(100_000).nullish(),
  limiteCaixas: z.number().int().min(0).max(100_000).nullish(),
  limiteMensagensMes: z.number().int().min(0).max(100_000_000).nullish(),
  recursos: z.array(z.string().max(160)).max(30).optional(),
  ativo: z.boolean().optional(),
  publico: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});

router.get('/planos', async (req, res) => {
  try {
    const planos = await cobranca.listarPlanos({ incluirInativos: req.query.todos === '1' });
    res.json({ success: true, data: planos });
  } catch (e) { erro(res, e, 500); }
});

router.post('/planos', validateBody(esquemaPlano), async (req, res) => {
  try {
    const plano = await cobranca.criarPlano(req.body);
    await logAction({
      user: req.user, req, category: 'settings', action: 'ragnabot.plano.criar',
      entityType: 'RagnabotPlano', entityId: plano.id,
      description: `Plano "${plano.nome}" criado (${plano.precoCentavos === null ? 'preço a definir' : cobranca.formatarBRL(plano.precoCentavos)}/${plano.cicloMeses}m)`,
      payloadAfter: plano,
    });
    res.json({ success: true, data: plano });
  } catch (e) { erro(res, e); }
});

router.patch('/planos/:id', validateBody(esquemaPlano.partial()), async (req, res) => {
  try {
    const antes = await prisma.ragnabotPlano.findUnique({ where: { id: req.params.id } });
    if (!antes) return res.status(404).json({ success: false, error: 'Plano não encontrado.' });
    const plano = await cobranca.atualizarPlano(req.params.id, req.body);
    await logAction({
      user: req.user, req, category: 'settings', action: 'ragnabot.plano.atualizar',
      entityType: 'RagnabotPlano', entityId: plano.id,
      description: `Plano "${plano.nome}" atualizado`, payloadBefore: antes, payloadAfter: plano,
    });
    res.json({ success: true, data: plano });
  } catch (e) { erro(res, e); }
});

// ── ASSINATURAS ──────────────────────────────────────────────────────────────
const esquemaAssinatura = z.object({
  planoId: z.string().min(1),
  // Com `tenantId`, o rótulo pode vir da empresa; sem ele, é obrigatório.
  rotuloConta: z.string().min(2).max(120).optional(),
  clientCompanyId: z.string().nullish(),
  tenantId: z.string().nullish(),          // empresa provisionada pela frente SaaS
  contaChatwootId: z.number().int().positive().nullish(),
  cicloMeses: z.number().int().min(1).max(36).optional(),
  valorCentavos: z.number().int().min(0).max(100_000_000).nullish(),
  diaVencimento: z.number().int().min(1).max(28).optional(), // até 28: todo mês tem
  diasDeTeste: z.number().int().min(0).max(90).optional(),
  diasCarencia: z.number().int().min(0).max(60).optional(),
  diasParaSuspender: z.number().int().min(0).max(120).optional(),
  meioPreferido: z.enum(['pix', 'boleto', 'cartao', 'manual']).optional(),
  adaptador: z.enum(['manual', 'efibank']).optional(),
  emailCobranca: z.string().email().nullish(),
  documentoCobranca: z.string().max(20).nullish(),
  contatoNome: z.string().max(120).nullish(),
  contatoTelefone: z.string().max(20).nullish(),
  inicioEm: z.string().datetime().optional(),
  metadados: z.record(z.any()).nullish(),
});

router.get('/assinaturas', async (req, res) => {
  try {
    const lista = await cobranca.listarAssinaturas({
      status: req.query.status || undefined,
      clientCompanyId: req.query.empresa || undefined,
      busca: req.query.busca || undefined,
    });
    res.json({ success: true, data: lista });
  } catch (e) { erro(res, e, 500); }
});

router.get('/assinaturas/:id', async (req, res) => {
  try {
    const a = await cobranca.obterAssinatura(req.params.id);
    if (!a) return res.status(404).json({ success: false, error: 'Assinatura não encontrada.' });
    res.json({ success: true, data: a });
  } catch (e) { erro(res, e, 500); }
});

router.post('/assinaturas', validateBody(esquemaAssinatura), async (req, res) => {
  try {
    const a = await cobranca.criarAssinatura(req.body, { usuario: req.user, req });
    res.json({ success: true, data: a });
  } catch (e) { erro(res, e); }
});

router.patch('/assinaturas/:id', validateBody(esquemaAssinatura.partial()), async (req, res) => {
  try {
    const a = await cobranca.atualizarAssinatura(req.params.id, req.body, { usuario: req.user, req });
    res.json({ success: true, data: a });
  } catch (e) { erro(res, e); }
});

// Emite a cobrança de um ciclo. Idempotente por competência.
router.post('/assinaturas/:id/cobrancas', async (req, res) => {
  try {
    const r = await cobranca.gerarCobrancaDoCiclo(req.params.id, {
      competencia: req.body?.competencia,
      vencimentoEm: req.body?.vencimentoEm,
      usuario: req.user, req,
    });
    res.json({ success: true, data: r.pagamento, jaExistia: r.jaExistia });
  } catch (e) { erro(res, e); }
});

// Reavalia a assinatura a partir dos fatos (pagamentos) e aplica a consequência.
router.post('/assinaturas/:id/reconciliar', async (req, res) => {
  try {
    const a = await cobranca.reconciliarAssinatura(req.params.id, {
      motivo: 'reconciliação manual', usuario: req.user, req,
    });
    res.json({ success: true, data: a });
  } catch (e) { erro(res, e); }
});

// Confere se o NOC e o Chatwoot contam a mesma história sobre a conta.
router.get('/assinaturas/:id/conferir-conta', async (req, res) => {
  try { res.json({ success: true, data: await cobranca.conferirEstadoDaConta(req.params.id) }); }
  catch (e) { erro(res, e); }
});

// ── AÇÕES SENSÍVEIS: 2FA do operador + justificativa obrigatória ─────────────
// Mesmo padrão das ações de energia de VM e de comando em AP. Suspender a conta de um
// cliente pagante é do mesmo tamanho: precisa de segundo fator, motivo e trilha.
async function exigir2faEJustificativa(req, res) {
  const g = await checkOperator2fa(req);
  if (g.needs2fa) { res.json({ success: true, data: g }); return null; }
  if (!g.ok) { res.status(403).json({ success: false, error: 'Código 2FA inválido ou expirado.', code: 'INVALID_2FA' }); return null; }
  const justificativa = String(req.body?.justificativa || '').trim();
  if (!justificativa) { res.status(400).json({ success: false, error: 'Justificativa obrigatória.' }); return null; }
  return justificativa;
}

router.post('/assinaturas/:id/suspender', async (req, res) => {
  try {
    const justificativa = await exigir2faEJustificativa(req, res);
    if (justificativa === null) return;
    const r = await cobranca.suspenderConta(req.params.id, { motivo: justificativa, usuario: req.user, req });
    res.json({ success: true, data: r });
  } catch (e) { erro(res, e); }
});

router.post('/assinaturas/:id/liberar', async (req, res) => {
  try {
    const justificativa = await exigir2faEJustificativa(req, res);
    if (justificativa === null) return;
    const r = await cobranca.liberarConta(req.params.id, { motivo: justificativa, usuario: req.user, req });
    res.json({ success: true, data: r });
  } catch (e) { erro(res, e); }
});

router.post('/assinaturas/:id/cancelar', async (req, res) => {
  try {
    const justificativa = await exigir2faEJustificativa(req, res);
    if (justificativa === null) return;
    const r = await cobranca.cancelarAssinatura(req.params.id, {
      motivo: justificativa, suspenderAgora: req.body?.suspenderAgora === true,
      usuario: req.user, req,
    });
    res.json({ success: true, data: r });
  } catch (e) { erro(res, e); }
});

// ── PAGAMENTOS ───────────────────────────────────────────────────────────────
router.get('/pagamentos', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.assinaturaId) where.assinaturaId = String(req.query.assinaturaId);
    const lista = await prisma.ragnabotPagamento.findMany({
      where,
      include: { assinatura: { select: { id: true, rotuloConta: true, status: true } } },
      orderBy: { vencimentoEm: 'desc' },
      take: Math.min(500, parseInt(req.query.limite || '200', 10) || 200),
    });
    res.json({ success: true, data: lista });
  } catch (e) { erro(res, e, 500); }
});

const esquemaBaixa = z.object({
  valorCentavos: z.number().int().min(0).max(100_000_000).optional(),
  pagoEm: z.string().datetime().optional(),
  justificativa: z.string().min(3).max(300),
});

// Baixa manual — quem conferiu o extrato confirma. Exige justificativa (de onde veio a
// confirmação) porque é a única baixa sem prova do provedor por trás.
router.post('/pagamentos/:id/baixa-manual', validateBody(esquemaBaixa), async (req, res) => {
  try {
    const r = await cobranca.registrarPagamentoManual(req.params.id, {
      valorCentavos: req.body.valorCentavos,
      pagoEm: req.body.pagoEm,
      observacao: req.body.justificativa,
      usuario: req.user, req,
    });
    res.json({ success: true, data: r });
  } catch (e) { erro(res, e); }
});

// ── CICLO E TRILHA ───────────────────────────────────────────────────────────
router.post('/ciclo/executar', async (req, res) => {
  try {
    const resumo = await cobranca.executarCicloDeCobranca({
      diasDeAntecedencia: Number(req.body?.diasDeAntecedencia) || 5,
    });
    await logAction({
      user: req.user, req, category: 'settings', action: 'ragnabot.ciclo.executar',
      entityType: 'RagnabotAssinatura', entityId: 'todas',
      description: `Ciclo de cobrança executado manualmente: ${resumo.emitidas} emitida(s), ${resumo.reconciliadas} reconciliada(s)`,
      payloadAfter: resumo, rollbackable: false,
    });
    res.json({ success: true, data: resumo });
  } catch (e) { erro(res, e, 500); }
});

// Últimos retornos recebidos do provedor — é aqui que se descobre webhook silencioso.
router.get('/eventos', async (req, res) => {
  try {
    const lista = await prisma.ragnabotEventoCobranca.findMany({
      orderBy: { recebidoEm: 'desc' },
      take: Math.min(200, parseInt(req.query.limite || '50', 10) || 50),
    });
    res.json({ success: true, data: lista });
  } catch (e) { erro(res, e, 500); }
});

// ═════════════════════════════════════════════════════════════════════════════
// ROTEADOR DO WEBHOOK (público)
// ═════════════════════════════════════════════════════════════════════════════
export const webhookRouter = Router();

// Comparação de segredo resistente a timing attack.
// ⭐ 02/09/2026 (contrato S6): o corpo desta função MUDOU DE LUGAR, não de comportamento. A
// implementação passou a ser `src/base/assinatura.js#iguaisComSeguranca` — a MESMA que a API
// pública e o webhook de SAÍDA usam. O envoltório continua aqui só para preservar a guarda de
// «vazio nunca casa»: dois vazios são iguais byte a byte, e sem esta linha um segredo não
// configurado passaria a conferir contra um cabeçalho ausente.
function iguaisComSeguranca(a, b) {
  if (!a || !b) return false;
  return comparacaoSegura(a, b);
}

/**
 * Lê o corpo funcionando nas DUAS formas que a Efí usa:
 *   • API de Cobranças → application/x-www-form-urlencoded com o campo `notification`
 *   • API Pix          → application/json com a lista `pix`
 * E guarda o corpo CRU para conferir HMAC quando houver assinatura.
 * Se um parser global já consumiu o fluxo, aproveita o que ele produziu (sem corpo cru).
 */
function lerCorpo(req, res, next) {
  if (req._body && req.body !== undefined) { req.corpoBruto = null; return next(); }
  const pedacos = [];
  let tamanho = 0;
  req.on('data', (c) => {
    tamanho += c.length;
    if (tamanho > 262_144) { req.destroy(); return; } // 256 KB: notificação legítima é minúscula
    pedacos.push(c);
  });
  req.on('end', () => {
    const bruto = Buffer.concat(pedacos).toString('utf8');
    req.corpoBruto = bruto;
    const tipo = String(req.headers['content-type'] || '');
    try {
      if (tipo.includes('application/json')) req.body = bruto ? JSON.parse(bruto) : {};
      else if (tipo.includes('x-www-form-urlencoded')) req.body = Object.fromEntries(new URLSearchParams(bruto));
      else req.body = bruto ? (bruto.trim().startsWith('{') ? JSON.parse(bruto) : Object.fromEntries(new URLSearchParams(bruto))) : {};
    } catch { req.body = {}; }
    next();
  });
  req.on('error', next);
}

// Camada 1 (segredo no caminho) + camada 3 (HMAC, quando houver).
function conferirAutenticidade(req, res, next) {
  const cfg = cobranca.configuracao();
  if (!cfg.segredoWebhook) {
    logger.error('[ragnabot-cobranca] webhook recebido com RAGNABOT_COBRANCA_WEBHOOK_SEGREDO vazio — recusado');
    return res.status(503).json({ ok: false });
  }
  if (!iguaisComSeguranca(req.params.segredo, cfg.segredoWebhook)) {
    logger.warn(`[ragnabot-cobranca] webhook com segredo inválido (ip=${req.ip})`);
    return res.status(404).end(); // 404, não 403: não confirma que a rota existe
  }
  const assinatura = req.headers['x-ragnabot-assinatura'];
  if (assinatura) {
    if (!req.corpoBruto) {
      logger.warn('[ragnabot-cobranca] assinatura enviada mas o corpo cru não está disponível — monte o webhook ANTES do express.json global');
    } else {
      // ⭐ 02/09/2026 (contrato S6): era um `createHmac` solto aqui. Passou a ser
      // `assinatura.conferir()` — a MESMA peça que assina o webhook de SAÍDA. Duas implementações
      // do mesmo HMAC divergindo é como um lado passa a assinar o que o outro recusa.
      if (!conferirAssinatura(cfg.segredoWebhook, req.corpoBruto, assinatura)) {
        logger.warn(`[ragnabot-cobranca] assinatura HMAC inválida (ip=${req.ip})`);
        return res.status(401).json({ ok: false });
      }
    }
  }
  next();
}

/**
 * A Efí entrega no caminho registrado e, no caso do Pix, ACRESCENTA "/pix" ao final.
 * As duas formas caem aqui. Respondemos 2XX assim que o retorno é aceito: a Efí repete
 * a entrega até 9 vezes quando não recebe 2XX, e o reprocessamento é barrado pela
 * idempotência — nunca por demora nossa em responder.
 */
async function tratar(origem, req, res) {
  try {
    const r = await cobranca.tratarRetornoPagamento({
      origem, corpo: req.body, ip: req.ip,
      adaptador: origem === 'manual' ? 'manual' : 'efibank',
    });
    logger.info(`[ragnabot-cobranca] webhook ${origem}: ${r.recebidos} evento(s) — ` +
      r.resultados.map((x) => `${x.chave}=${x.resultado}`).join(', '));
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    logger.error(`[ragnabot-cobranca] webhook ${origem} falhou: ${e.message}`);
    // 500 de propósito: a Efí reenvia, e a idempotência garante que reenvio não duplica.
    return res.status(500).json({ ok: false, erro: e.message });
  }
}

// Verificação de vida (a Efí testa a URL antes de registrar o webhook Pix).
webhookRouter.get('/:segredo', lerCorpo, conferirAutenticidade, (req, res) => res.status(200).json({ ok: true }));
webhookRouter.post('/:segredo', lerCorpo, conferirAutenticidade, (req, res) => tratar('efibank-cobrancas', req, res));
webhookRouter.post('/:segredo/pix', lerCorpo, conferirAutenticidade, (req, res) => tratar('efibank-pix', req, res));

export default router;
