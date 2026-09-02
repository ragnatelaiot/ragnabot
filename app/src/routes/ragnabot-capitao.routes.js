// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — CAPITÃO (o agente de IA da plataforma, adaptado ao nosso uso).  S5
//
// É a tela "Gestão ➜ Agente de IA": ligar/desligar por empresa, dar nome e tom ao agente, alimentar
// a base de conhecimento DAQUELA empresa, ver o teto e o consumo do mês.
//
// ── MONTAGEM (linha do CHEFE, em src/servidor.js, junto das outras) ─────────────────────────────
//   await montar('/api/ragnabot-capitao', './routes/ragnabot-capitao.routes.js', autenticar);
//
// ⚠️ SEM `adminOnly` no mount, pela mesma razão já registrada em `ragnabot-atendimento.routes.js`:
// o isolamento é feito por `escopoDe()`, não pelo middleware. Quem pode ESCREVER é decidido aqui
// dentro (ligar o agente e mexer na base = administrador da empresa; ler = qualquer um dela).
//
// ── A REGRA INEGOCIÁVEL ─────────────────────────────────────────────────────────────────────────
// `tenantId` NUNCA vem da tela para ampliar alcance: é derivado do usuário logado. Um `tenantId` no
// corpo só é aceito de quem é super — e aí ESTREITA, jamais ALARGA. Foi confiando na empresa que a
// tela mandava que o sistema antigo vazou.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { escopoDe, registrar } from '../services/ragnabot-auditoria.service.js';
import * as capitao from '../services/ragnabot-capitao.service.js';

const router = Router();

function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.codigo) corpo.code = e.codigo;
  return res.status(status).json(corpo);
}

/**
 * A empresa do pedido. Super pode escolher outra; ninguém mais pode.
 * Devolve `null` quando não há empresa — e aí a rota responde 400, nunca "todas".
 */
function empresaDoPedido(req) {
  const esc = escopoDe(req.user);
  const pedido = req.body?.tenantId || req.query?.tenantId || null;
  if (esc.global) return pedido ? String(pedido) : null;
  return esc.tenantId ?? null;
}

function ehAdmin(req) {
  return req.user?.isSuperuser === true || req.user?.role === 'admin' || req.user?.clientRole === 'admin';
}

/** O modelo pode não ter migrado no banco onde este processo subiu (e o cliente Prisma é do boot). */
function exigeModelo(_req, res, next) {
  if (capitao.modeloPronto()) return next();
  return res.status(503).json({
    error: 'As tabelas do agente de IA ainda não estão disponíveis neste processo. '
      + 'Aplique prisma/sql/capitao/01-rb_capitao.sql e reinicie o serviço.',
    code: 'MODELO_AUSENTE',
  });
}

router.use(exigeModelo);

// ── LEITURA ─────────────────────────────────────────────────────────────────────────────────────

/**
 * O retrato honesto: o que está ligado, quanto já gastou, e — de propósito —
 * `verificadoNaPlataforma:false` enquanto ninguém puder exercitar o agente de verdade.
 */
router.get('/estado', async (req, res) => {
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    return res.json(await capitao.estadoDaEmpresa(tenantId));
  } catch (e) { return erro(res, e, 500); }
});

/** Interruptor mestre e preços configurados — sem revelar segredo nenhum. */
router.get('/ambiente', (req, res) => {
  const c = capitao.configuracaoCapitao();
  return res.json({
    ativo: c.ativo,
    custoPorRespostaCentavos: c.custoPorRespostaCentavos,
    custoPorMilTokensCentavos: c.custoPorMilTokensCentavos,
    tetoGlobalRespostasMes: c.tetoGlobalRespostasMes || null,
    aviso: c.ativo
      ? null
      : 'CAPITAO_ATIVO está desligado: o agente não responde nada, mesmo ligado na empresa.',
  });
});

router.get('/documentos', async (req, res) => {
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    return res.json({ itens: await capitao.documentosDaEmpresa(tenantId, { status: req.query.status || null }) });
  } catch (e) { return erro(res, e, 500); }
});

router.get('/consumo', async (req, res) => {
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const [consumo, teto, custo] = await Promise.all([
      capitao.consumoDoMes(tenantId),
      capitao.tetoDaEmpresa(tenantId),
      capitao.custoPorAtendimento(tenantId, { de: req.query.de || null, ate: req.query.ate || null }),
    ]);
    return res.json({ consumo, teto, custo });
  } catch (e) { return erro(res, e, 500); }
});

// ── ESCRITA (administrador da empresa) ──────────────────────────────────────────────────────────

router.put('/config', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador liga o agente de IA', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const antes = await capitao.configDaEmpresa(tenantId);
    const linha = await capitao.definirConfig(tenantId, req.body ?? {}, { userId: req.user?.id ?? null });
    await registrar({
      tenantId, atorTipo: 'usuario', atorId: req.user?.id ?? null,
      atorNome: req.user?.name || req.user?.username || null,
      categoria: 'configuracao', acao: 'capitao_config_alterada',
      ip: req.ip, userAgent: req.headers?.['user-agent'],
      entidade: 'RagnabotCapitaoConfig', entidadeId: linha.id,
      antes: { ativo: antes.ativo, nomeAgente: antes.nomeAgente },
      depois: { ativo: linha.ativo, nomeAgente: linha.nomeAgente },
    }).catch(() => {});
    return res.json(linha);
  } catch (e) { return erro(res, e); }
});

router.post('/documentos', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador mexe na base de conhecimento', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    return res.status(201).json(await capitao.registrarDocumento(tenantId, req.body ?? {}, { userId: req.user?.id ?? null }));
  } catch (e) { return erro(res, e); }
});

router.post('/documentos/sincronizar', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador sincroniza', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    return res.json(await capitao.sincronizarDocumentos(tenantId));
  } catch (e) { return erro(res, e, 502); }
});

// 404 e não 403 para id de outra empresa: 403 confirmaria que aquele id existe.
router.delete('/documentos/:id', async (req, res) => {
  if (!ehAdmin(req)) return res.status(403).json({ error: 'só administrador remove documento', code: 'SEM_PERMISSAO' });
  const tenantId = empresaDoPedido(req);
  if (!tenantId) return res.status(400).json({ error: 'sem empresa no escopo', code: 'SEM_EMPRESA' });
  try {
    const r = await capitao.removerDocumento(tenantId, req.params.id, { userId: req.user?.id ?? null });
    if (!r.ok) return res.status(404).json({ error: 'documento não encontrado', code: 'NAO_ENCONTRADO' });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

/**
 * SIMULAÇÃO DA FRONTEIRA — não fala com o agente, não gasta nada, não manda mensagem.
 * Serve para o operador conferir, ANTES de ligar, quem responderia em cada situação.
 */
router.post('/simular-fronteira', (req, res) => {
  const c = capitao.configuracaoCapitao();
  const decisao = capitao.decidirQuemResponde({ ...(req.body ?? {}), interruptorMestre: c.ativo });
  return res.json({ ...decisao, interruptorMestre: c.ativo });
});

export default router;
