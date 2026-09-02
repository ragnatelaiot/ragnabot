// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — PAGAMENTO PIX (EFÍ BANK).  S-EFÍ / doc 36
//
// Duas metades no mesmo arquivo, e a ordem entre elas é o desenho:
//   1. o WEBHOOK, PÚBLICO — é a Efí avisando que o cliente pagou. Fica ANTES de qualquer trava;
//   2. a GESTÃO, PRIVADA — criar cobrança, ver estado, guardar credencial, registrar o webhook.
//
// ── MONTAGEM (linha do CHEFE, em src/servidor.js) ───────────────────────────────────────────────
//   await montar('/api/ragnabot-pagamento', './routes/ragnabot-pagamento.routes.js');
//
// ⚠️ O MOUNT É PÚBLICO DE PROPÓSITO — e é UMA linha só. A autenticação da metade privada é
// aplicada AQUI DENTRO (`router.use(autenticar)`, depois das rotas de webhook). Se o mount levasse
// `autenticar`, o webhook da Efí bateria em 401 e nenhum pagamento seria confirmado — a falha mais
// cara possível, porque acontece em silêncio e em dinheiro.
//
// ── ⚠️ O QUE ESTE ARQUIVO **NÃO** FAZ: o mTLS DE ENTRADA ────────────────────────────────────────
// O Banco Central exige que o endereço que recebe a confirmação EXIJA certificado de cliente (a Efí
// apresenta, nós validamos). Isso é `ssl_client_certificate` + `ssl_verify_client on` num vhost
// ISOLADO do nginx (doc 36 §3.1) — infraestrutura, não código. Aqui ficam a SEGUNDA e a TERCEIRA
// cercas: HMAC na URL e IP de origem, mais a validação do corpo.
// ⛔ Enquanto o vhost com mTLS não existir, trabalhe em HOMOLOGAÇÃO (que é o padrão).
//
// ── POR QUE DOIS CAMINHOS DE WEBHOOK ────────────────────────────────────────────────────────────
// A Efí ACRESCENTA `/pix` ao fim da URL registrada. Registramos com `?ignorar=` para evitar, mas o
// caminho `/pix/:hmac/pix` fica aceito também — se um dia alguém registrar sem o `?ignorar=`, a
// confirmação continua chegando em vez de sumir em silêncio.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import logger from '../base/logger.js';
import { escopoDe } from '../services/ragnabot-auditoria.service.js';
import * as pix from '../services/ragnabot-pagamento-efi.service.js';

const router = Router();

function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.codigo) corpo.code = e.codigo;
  return res.status(status).json(corpo);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. WEBHOOK — PÚBLICO, e antes de qualquer trava
// ════════════════════════════════════════════════════════════════════════════════════════════════

async function receberNotificacao(req, res) {
  const origem = await pix.validarOrigem({ ip: req.ip, hmac: req.params.hmac });
  if (!origem.ok) {
    // ⛔ O log NUNCA carrega o HMAC recebido — seria escrever o segredo tentado no arquivo de log.
    logger.warn(`[pix-webhook] recusado (${origem.motivo}) ip=${pix.normalizarIp(req.ip)}`);
    return res.status(origem.status).json({ error: 'não autorizado', code: origem.motivo });
  }

  // 200 SOMENTE DEPOIS DE GRAVAR — a mesma lição do webhook da plataforma. A Efí reentrega até
  // receber 2xx; responder antes de gravar transforma uma falha passageira em pagamento perdido
  // para sempre, e ninguém descobre até a conciliação.
  try {
    const r = await pix.tratarNotificacaoPix({ corpo: req.body, ip: req.ip });
    if (!r.ok) {
      // Corpo que não é do formato da Efí: 400 (reenviar não muda nada), já registrado na trilha.
      return res.status(400).json({ error: 'corpo inesperado', code: r.motivo });
    }
    return res.json({ ok: true, aplicados: r.aplicados, duplicados: r.duplicados, desconhecidos: r.desconhecidos });
  } catch (e) {
    // Tabela ausente NESTE processo: 503 e não 500. Os dois fazem a Efí reentregar, mas o 503 com
    // código diz ao operador o que fazer (aplicar o SQL e reiniciar) em vez de mandar caçar defeito.
    if (e?.codigo === 'MODELO_AUSENTE') {
      logger.error(`[pix-webhook] ${e.message}`);
      return res.status(503).json({ error: e.message, code: 'MODELO_AUSENTE' });
    }
    // 500 = "não gravei, mande de novo". É o que faz o reenvio da Efí trabalhar a nosso favor.
    logger.error(`[pix-webhook] erro ao processar: ${e.message}`);
    return res.status(500).json({ error: 'falha ao processar; reenvie' });
  }
}

router.post('/pix/:hmac', receberNotificacao);
router.post('/pix/:hmac/pix', receberNotificacao);

// A Efí faz uma primeira chamada SEM certificado só para conferir que o endereço exige mTLS
// (doc 36 §3). Quem responde a essa é o nginx; se ela chegar aqui, o mTLS NÃO está configurado —
// e é melhor dizer isso alto no log do que responder 200 e todo mundo achar que está pronto.
router.get('/pix/:hmac', (req, res) => {
  logger.warn('[pix-webhook] GET no endereço do webhook — se veio da Efí, o mTLS do nginx NÃO está no lugar');
  return res.status(405).json({ error: 'este endereço só aceita POST' });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. GESTÃO — PRIVADA. A trava é aplicada AQUI, depois do webhook.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Import tolerante, igual ao do `servidor.js`: se a autenticação não estiver disponível, a metade
// privada RECUSA (503) — nunca abre. O webhook acima continua funcionando, porque é ele que
// sustenta a confirmação de pagamento.
let autenticar;
try {
  const auth = await import('../base/auth.js');
  autenticar = auth.authMiddleware ?? auth.autenticar ?? auth.default;
  if (typeof autenticar !== 'function') throw new Error('base/auth.js não exporta authMiddleware');
} catch (e) {
  logger.error(`[ragnabot-pagamento] autenticação indisponível (${e.message}) — a gestão vai recusar com 503`);
  autenticar = (_req, res) => res.status(503).json({ error: 'autenticação indisponível', code: 'AUTH_NAO_CONFIGURADA' });
}
router.use(autenticar);

function empresaDoPedido(req) {
  const esc = escopoDe(req.user);
  const pedido = req.body?.tenantId || req.query?.tenantId || null;
  if (esc.global) return pedido ? String(pedido) : null;
  return esc.tenantId ?? null;
}

const ehAdmin = (req) => req.user?.isSuperuser === true || req.user?.role === 'admin' || req.user?.clientRole === 'admin';
const ehSuper = (req) => req.user?.isSuperuser === true;

/** O que falta para a cobrança funcionar — em texto acionável, sem revelar valor de credencial. */
router.get('/situacao', (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador', code: 'SEM_PERMISSAO' });
  return res.json(pix.situacaoDaIntegracao());
});

/** Cria uma cobrança à mão (a do fluxo nasce pelo nó `pagamento_pix`). */
router.post('/cobrancas', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador cria cobrança', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const r = await pix.criarCobrancaPix({ ...(req.body ?? {}), tenantId, userId: req.user?.id ?? null });
    return res.status(201).json(r);
  } catch (e) { return erro(res, e, 502); }
});

/** B6 — o estado da cobrança na conversa (aguardando / pago / expirado). */
router.get('/cobrancas/conversa/:cwAccountId/:cwConversationId', async (req, res) => {
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const lista = await pix.estadoNaConversa({
      cwAccountId: req.params.cwAccountId, cwConversationId: req.params.cwConversationId,
    });
    // Isolamento na saída: a consulta é por conversa, e conversa de outra empresa não aparece.
    const daEmpresa = [];
    for (const c of lista) {
      const linha = await pix.portasDoPagamento().db.ragnabotCobrancaPix.findUnique({ where: { txid: c.txid } });
      if (linha?.tenantId === tenantId) daEmpresa.push(c);
    }
    return res.json({ itens: daEmpresa });
  } catch (e) { return erro(res, e, 500); }
});

router.post('/cobrancas/:txid/cancelar', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador cancela cobrança', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const r = await pix.cancelarCobranca({ tenantId, txid: req.params.txid, userId: req.user?.id ?? null });
    // 404 e não 403 para cobrança de outra empresa: 403 confirmaria que aquele txid existe.
    if (!r.ok) {
      const status = r.motivo === 'ja_paga' ? 409 : 404;
      return res.status(status).json({ error: r.motivo, code: r.motivo.toUpperCase() });
    }
    return res.json(r);
  } catch (e) { return erro(res, e, 502); }
});

/**
 * B7 — credencial por empresa. SÓ SUPER: é dinheiro de terceiro entrando em conta.
 * ⛔ A resposta NUNCA devolve o que foi gravado — só o escopo e o ambiente.
 */
router.put('/credenciais', async (req, res) => {
  if (!ehSuper(req)) return res.status(403).json({ error: 'só o super usuário cadastra credencial de pagamento', code: 'SEM_PERMISSAO' });
  try {
    const r = await pix.salvarCredencial({ ...(req.body ?? {}), userId: req.user?.id ?? null });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

/** Registra o endereço do webhook na Efí (`PUT /v2/webhook/:chave`). */
router.post('/webhook/registrar', async (req, res) => {
  if (!ehSuper(req)) return res.status(403).json({ error: 'só o super usuário registra o webhook', code: 'SEM_PERMISSAO' });
  try {
    return res.json(await pix.registrarWebhookNaEfi({ tenantId: req.body?.tenantId ?? null, url: req.body?.url ?? null }));
  } catch (e) { return erro(res, e, 502); }
});

export default router;
