// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — CONEXÕES, API PÚBLICA E WEBHOOK DE SAÍDA.  Contrato S6 (02/09/2026)
//
// ── MONTAGEM (em src/servidor.js) ───────────────────────────────────────────────────────────────
//   await montar('/api/ragnabot-conexao', './routes/ragnabot-conexao.routes.js', autenticar);
//
// ⚠️ O mount leva SÓ `autenticar`, sem `adminOnly` — e a razão é a mesma já registrada na caixa de
// atendimento e nas respostas rápidas: o ESCOPO vem de `escopoDe(req.user)`, calculado no servidor
// a partir do usuário, nunca do corpo da requisição. O que trava não é o middleware do mount; é o
// `where`. Dentro do router, o que MUDA o mundo (trocar provedor, transferir atendimento, emitir e
// regenerar credencial) exige `administra`.
//
// ── ⛔ AS DUAS REGRAS INEGOCIÁVEIS DESTE ARQUIVO ────────────────────────────────────────────────
// 1. NENHUM SEGREDO SAI EM LISTAGEM. O valor em claro de uma credencial de API ou de um segredo de
//    webhook aparece UMA vez — na resposta da emissão/regeneração — e nunca mais. Toda listagem
//    devolve `digital` (sha256 truncado). Isto não é conforto: é a diferença entre um segredo que
//    vaza numa tela aberta e um que só existe no cofre de quem o recebeu.
// 2. `tenantId` DO CORPO SÓ VALE PARA O SUPER USUÁRIO. Administrador de empresa opera a empresa
//    DELE — e mandar `tenantId` de outra não amplia nada. É a mesma regra da auditoria.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import * as conexoes from '../services/ragnabot-conexao.service.js';
import * as api from '../services/ragnabot-api-publica.service.js';
import * as webhooks from '../services/ragnabot-webhook-saida.service.js';
import * as provedores from '../services/ragnabot-provedor.service.js';
import { escopoDe } from '../services/ragnabot-auditoria.service.js';
import prisma from '../base/db.js';

const router = Router();

function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.code) corpo.code = e.code;
  if (e?.detalhes) corpo.detalhes = e.detalhes;
  return res.status(status).json(corpo);
}

/** Quem administra: super usuário ou admin. O atendente LÊ as conexões (precisa saber por qual
 *  linha o atendimento dele chega); ele não troca provedor nem emite credencial. */
function administra(user) {
  return user?.isSuperuser === true || user?.role === 'admin';
}

function exigirAdmin(req, res) {
  if (administra(req.user)) return true;
  res.status(403).json({ error: 'Ação restrita ao administrador da empresa.', code: 'SEM_PERMISSAO' });
  return false;
}

/**
 * A empresa desta requisição.
 * Super usuário DIZ qual (`?tenantId=` ou no corpo); administrador de empresa não escolhe — é a
 * dele, derivada do usuário. Sem empresa, 400 com o nome do campo que falta.
 */
function empresaDe(req, res) {
  const esc = escopoDe(req.user);
  const tenantId = esc.global ? String(req.query?.tenantId || req.body?.tenantId || '') : esc.tenantId;
  if (!tenantId) {
    res.status(400).json({
      error: esc.global
        ? 'Informe "tenantId" — o super usuário opera qualquer empresa, e por isso precisa dizer qual.'
        : 'A sua conta não está ligada a nenhuma empresa do Ragnabot.',
      code: 'TENANT_OBRIGATORIO',
    });
    return null;
  }
  return tenantId;
}

// ── GUARDA DE MIGRAÇÃO ──────────────────────────────────────────────────────────────────────────
// O cliente Prisma carrega no ARRANQUE: a coluna existir no banco não basta. 503 com o que fazer.
function modeloDeConexaoPronto() {
  return typeof prisma?.ragnabotInbox?.findMany === 'function'
    && typeof prisma?.ragnabotConexaoTransferencia?.findMany === 'function';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO — fora de qualquer guarda, para a tela conseguir se desenhar e mostrar o aviso mesmo
// numa instalação onde a migração ainda não passou.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/opcoes', (req, res) => {
  res.json({
    provedores: provedores.IDS_DE_PROVEDOR.map((id) => {
      const p = provedores.provedor(id);
      return {
        id, rotulo: p.rotulo, descricao: p.descricao, oficial: p.oficial,
        canais: p.canais, podeReiniciar: p.podeReiniciar,
        origemDaCapacidade: p.origem, contraDecisaoRegistrada: p.contraDecisaoRegistrada === true,
      };
    }),
    estados: conexoes.ESTADOS,
    estadosTransferiveis: conexoes.ESTADOS_TRANSFERIVEIS,
    eventosDeWebhook: webhooks.EVENTOS,
    escoposDeApi: api.ESCOPOS,
    administra: administra(req.user),
    migracaoAplicada: {
      conexoes: modeloDeConexaoPronto(),
      apiPublica: api.disponivel(),
      webhookDeSaida: webhooks.disponivel(),
    },
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. CONEXÕES (F9.2.3)
// ════════════════════════════════════════════════════════════════════════════════════════════════

router.get('/conexoes', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const lista = await conexoes.listarConexoes(tenantId, { incluirRemovidas: req.query.incluirRemovidas !== '0' });
    return res.json({ conexoes: lista });
  } catch (e) { return erro(res, e, 500); }
});

router.get('/conexoes/:cwInboxId/provedores', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await conexoes.opcoesDeProvedor(tenantId, req.params.cwInboxId));
  } catch (e) { return erro(res, e); }
});

/** ⭐ F9.2.2 — trocar QUEM OPERA a conexão. Um `UPDATE` de coluna: nem o motor nem o adaptador
 *  mudam. É o ponto inteiro da camada. */
router.put('/conexoes/:cwInboxId/provedor', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await conexoes.definirProvedor(tenantId, req.params.cwInboxId, {
      provedor: req.body?.provedor,
      provedorRef: req.body?.provedorRef ?? null,
      urlBase: req.body?.urlBase ?? null,
    }, { ator: req.user, req });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

/** F9.2.3 — o sinal do cartão, gravado por quem MEDIU. */
router.put('/conexoes/:cwInboxId/estado', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await conexoes.registrarEstado(tenantId, req.params.cwInboxId, {
      estado: req.body?.estado, detalhe: req.body?.detalhe ?? null,
    });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

/** ⭐ F9.2.5 — reiniciar. Pode responder `naoDisponivel` COM O MOTIVO: botão que mente é pior que
 *  botão que falta. */
router.post('/conexoes/:cwInboxId/reiniciar', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await conexoes.reiniciarConexao(tenantId, req.params.cwInboxId, { motivo: req.body?.motivo || null }, { ator: req.user, req });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

// ── COTA (F9.2.7) ──────────────────────────────────────────────────────────────────────────────
router.get('/cota', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await conexoes.cotaDeCanais(tenantId));
  } catch (e) { return erro(res, e, 500); }
});

// ── TRANSFERÊNCIA (F9.2.4) ─────────────────────────────────────────────────────────────────────
router.post('/transferencias/previa', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await conexoes.previaDaTransferencia(tenantId, {
      deCwInboxId: req.body?.de, paraCwInboxId: req.body?.para, estados: req.body?.estados || null,
    }));
  } catch (e) { return erro(res, e); }
});

router.post('/transferencias', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await conexoes.transferirConversas(tenantId, {
      deCwInboxId: req.body?.de, paraCwInboxId: req.body?.para,
      estados: req.body?.estados || null, motivo: req.body?.motivo,
      forcarCanalDiferente: req.body?.forcarCanalDiferente === true,
      avisarNaConversa: req.body?.avisarNaConversa !== false,
    }, { ator: req.user, req });
    return res.json(r);
  } catch (e) { return erro(res, e); }
});

router.get('/transferencias', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json({ transferencias: await conexoes.listarTransferencias(tenantId, { limite: req.query.limite }) });
  } catch (e) { return erro(res, e, 500); }
});

// ── REGISTRO POR CANAL (F9.2.6) ────────────────────────────────────────────────────────────────
router.get('/conexoes/:cwInboxId/requisicoes', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await conexoes.registroPorConexao(tenantId, {
      cwInboxId: req.params.cwInboxId,
      desde: req.query.desde || null, ate: req.query.ate || null,
      limite: req.query.limite, somenteFalhas: req.query.somenteFalhas === '1',
    }));
  } catch (e) { return erro(res, e); }
});

router.get('/conexoes/:cwInboxId/relatorio', async (req, res) => {
  try {
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await conexoes.relatorioPorConexao(tenantId, {
      cwInboxId: req.params.cwInboxId, desde: req.query.desde || null, ate: req.query.ate || null,
    }));
  } catch (e) { return erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. CREDENCIAIS DA API PÚBLICA (F9.4.1)
// ════════════════════════════════════════════════════════════════════════════════════════════════

router.get('/credenciais', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json({ credenciais: await api.listarCredenciais(tenantId) });
  } catch (e) { return erro(res, e); }
});

/** ⚠️ ESTA é a única resposta do produto inteiro que carrega um segredo em claro. Ela diz isso ao
 *  cliente, em português, para ele não fechar a tela achando que consegue ver de novo depois. */
router.post('/credenciais', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await api.emitirCredencial(tenantId, { nome: req.body?.nome, escopos: req.body?.escopos }, { ator: req.user, req });
    return res.status(201).json({
      ...r,
      aviso: 'Guarde o segredo agora. Ele não é exibido de novo, e não temos como recuperá-lo — só regenerar, o que invalida este.',
    });
  } catch (e) { return erro(res, e); }
});

/** ⭐ F9.4.1 — regenerar INVALIDA a anterior na mesma transação. Não existe janela em que as duas
 *  valem: «regenerar» que deixa a antiga viva não é rotação, é uma segunda credencial. */
router.post('/credenciais/:id/regenerar', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await api.regenerarCredencial(tenantId, req.params.id, { motivo: req.body?.motivo || null }, { ator: req.user, req });
    return res.json({
      ...r,
      aviso: 'A credencial anterior parou de valer AGORA. Qualquer integração que a usava vai receber recusa até ser atualizada.',
    });
  } catch (e) { return erro(res, e); }
});

router.post('/credenciais/:id/revogar', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await api.revogarCredencial(tenantId, req.params.id, { motivo: req.body?.motivo || null }, { ator: req.user, req }));
  } catch (e) { return erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. WEBHOOKS DE SAÍDA (F9.4.2 a F9.4.4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

router.get('/webhooks', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json({ webhooks: await webhooks.listarWebhooks(tenantId, { incluirRemovidos: req.query.incluirRemovidos === '1' }) });
  } catch (e) { return erro(res, e); }
});

router.post('/webhooks', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await webhooks.cadastrarWebhook(tenantId, {
      nome: req.body?.nome, url: req.body?.url,
      eventos: req.body?.eventos || [], cwInboxId: req.body?.cwInboxId ?? null,
    }, { ator: req.user, req });
    return res.status(201).json({
      ...r,
      aviso: 'Guarde o segredo agora. Ele assina cada entrega no cabeçalho X-Hub-Signature-256 (sha256=<hex>, '
        + 'HMAC-SHA256 do corpo) e vai também como Bearer no Authorization. Não é exibido de novo.',
    });
  } catch (e) { return erro(res, e); }
});

router.patch('/webhooks/:id', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await webhooks.alterarWebhook(tenantId, req.params.id, req.body || {}, { ator: req.user, req }));
  } catch (e) { return erro(res, e); }
});

router.post('/webhooks/:id/regenerar', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    const r = await webhooks.regenerarSegredoDoWebhook(tenantId, req.params.id, { ator: req.user, req });
    return res.json({ ...r, aviso: 'O segredo anterior parou de valer AGORA — as assinaturas antigas deixam de conferir no destino.' });
  } catch (e) { return erro(res, e); }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await webhooks.removerWebhook(tenantId, req.params.id, { ator: req.user, req }));
  } catch (e) { return erro(res, e); }
});

router.get('/webhooks/entregas', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json({
      entregas: await webhooks.listarEntregas(tenantId, {
        webhookId: req.query.webhookId || null, estado: req.query.estado || null,
        evento: req.query.evento || null, limite: req.query.limite,
      }),
      carteiro: webhooks.estadoDoCarteiro(),
    });
  } catch (e) { return erro(res, e); }
});

/** ⭐ F9.4.4 — reenvio MANUAL. Entrega que desistiu não se repete sozinha: é a mesma decisão
 *  registrada no agendamento (S4) e na caixa de saída do motor, pelo mesmo motivo. */
router.post('/webhooks/entregas/:id/reenviar', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    const tenantId = empresaDe(req, res);
    if (!tenantId) return undefined;
    return res.json(await webhooks.reenviar(tenantId, req.params.id, { ator: req.user, req }));
  } catch (e) { return erro(res, e); }
});

/** Uma passada do carteiro, à mão. O laço automático está DESLIGADO (decisão do chefe); esta rota é
 *  como se prova a entrega sem ligar nada permanentemente. */
router.post('/webhooks/entregar-agora', async (req, res) => {
  try {
    if (!exigirAdmin(req, res)) return undefined;
    return res.json(await webhooks.entregarPendentes({ limite: Number(req.body?.limite) || 50 }));
  } catch (e) { return erro(res, e); }
});

export default router;
