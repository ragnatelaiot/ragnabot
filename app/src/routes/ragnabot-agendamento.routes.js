// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — AGENDAMENTO DE MENSAGENS (contrato S4, doc 34 §F4)
//
// É a tela «Agendamentos»: marcar uma mensagem para sair numa data e hora, para um ou vários
// contatos, uma vez ou repetindo, com anexo, decidindo se aquilo vira atendimento — e ver depois o
// que aconteceu com cada destinatário.
//
// ── MONTAGEM (a linha é do CHEFE; em src/servidor.js, perto das outras rotas do Ragnabot) ───────
//   await montar('/api/ragnabot-agendamento', './routes/ragnabot-agendamento.routes.js', autenticar);
//
// ⚠️ O mount leva SÓ `autenticar`, de propósito — NÃO ponha `adminOnly`. Mesma razão já registrada
// em `ragnabot-respostas-rapidas.routes.js` e em `ragnabot-caixa.routes.js`: quem agenda uma
// mensagem é o ATENDENTE ou o supervisor, cuja `role` do NOC é 'user'. Trancar o mount em admin
// entregaria a tela justamente a quem não a usa. O isolamento é por `escopoDe()`, dentro do serviço.
//
// ── 404, NÃO 403, PARA O QUE ESTÁ FORA DO ESCOPO ────────────────────────────────────────────────
// Um id de outra empresa responde «não encontrado». 403 confirmaria ao curioso que aquele id EXISTE
// — que é metade do vazamento.
//
// ── FRONTEIRA DE DONO ───────────────────────────────────────────────────────────────────────────
// Toda decisão de domínio (o que é recorrência válida, quando é a próxima ocorrência, o que pode ser
// editado) vem de `ragnabot-agendamento.service.js`. O disparo vem de
// `ragnabot-agendamento-worker.service.js`. À rota cabe o que é dela: validar a entrada, chamar o
// serviço, auditar e traduzir o erro em código HTTP.
//
// ⛔ NÃO EXISTE ROTA DE «DISPARAR AGORA» QUE MANDE MENSAGEM DIRETO. De propósito. Um botão assim
// pularia a reserva por chave — que é a única coisa que impede a mensagem de sair duas vezes — e
// seria justamente o caminho por onde a garantia se perde. Quem quiser antecipar, edita o horário.
// O reenvio de UM item duvidoso existe (`POST /envios/:chave/reenviar`) e passa pela MESMA reserva,
// com chave nova e registro de quem pediu.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { registrar } from '../services/ragnabot-auditoria.service.js';
import { logAction } from '../base/auditoria.js';
import {
  RECORRENCIAS, STATUS, STATUS_ENVIO, LIMITES, MAX_TENTATIVAS,
  modeloPronto, listar, obter, historico, criar, editar, pausar, retomar, cancelar,
  proximaOcorrencia,
} from '../services/ragnabot-agendamento.service.js';
import { reenviarManual } from '../services/ragnabot-agendamento-worker.service.js';

const router = Router();

/** Tradução de erro → HTTP. O serviço carimba `status` quando a recusa TEM um código certo (403 de
 *  permissão, 409 de estado); o resto é entrada inválida, que é 400. Sem isto, «este agendamento já
 *  está cancelado» viraria 500 e a tela mandaria caçar defeito onde não há. */
function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.code) corpo.code = e.code;
  return res.status(status).json(corpo);
}

const naoEncontrado = (res) => res.status(404).json({
  error: 'Agendamento não encontrado.', code: 'AGENDAMENTO_NAO_ENCONTRADO',
});

/**
 * GUARDA DE MIGRAÇÃO. O modelo é do `schema.prisma` e pode ainda não ter migrado no banco onde este
 * processo subiu. Sem a guarda, a rota estouraria um TypeError cru e o operador leria «erro 500»
 * sem a menor pista do que fazer.
 *
 * ⚠️ Vale TAMBÉM para o processo que subiu ANTES da migração: o cliente Prisma é carregado no boot,
 * então a tabela existir no banco não basta — o processo precisa ter sido reiniciado (decisão do
 * chefe, e só sem sessão ativa).
 */
function exigeModelo(_req, res, next) {
  if (modeloPronto()) return next();
  return res.status(503).json({
    error: 'A tabela de agendamentos ainda não está disponível neste processo. '
      + 'Aplique prisma/sql/agendamento/01-rb_agendamento.sql e reinicie o serviço.',
    code: 'MODELO_AUSENTE',
  });
}

/** Auditoria em DOIS lugares: a do Ragnabot (por empresa) e o log do NOC. Nenhuma derruba a ação. */
async function auditar({ req, acao, tenantId, entidadeId, descricao, antes, depois }) {
  await registrar({
    tenantId, atorTipo: 'usuario', atorId: req.user?.id || null,
    atorNome: req.user?.name || req.user?.username || null,
    categoria: 'configuracao', acao, descricao,
    ip: req.ip, userAgent: req.headers?.['user-agent'],
    entidade: 'RagnabotAgendamento', entidadeId, antes, depois,
  }).catch(() => {});
  await logAction({
    user: req.user, req, action: acao, category: 'settings',
    entityType: 'RagnabotAgendamento', entityId: entidadeId, description: descricao,
    payloadBefore: antes || undefined, payloadAfter: depois || undefined, rollbackable: false,
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OPÇÕES — o vocabulário, para a tela montar os menus sem repetir listas do lado de lá.
// FORA da guarda de migração de propósito: a tela precisa se desenhar e mostrar o aviso mesmo num
// banco onde a tabela ainda não passou. Tela em branco esconde o motivo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/opcoes', (_req, res) => {
  res.json({
    recorrencias: [
      { valor: 'unica', rotulo: 'Uma vez só', apoio: 'Dispara na data marcada e encerra' },
      { valor: 'diaria', rotulo: 'Diária', apoio: 'A cada N dias, no mesmo horário' },
      { valor: 'semanal', rotulo: 'Semanal', apoio: 'Nos dias da semana escolhidos' },
      { valor: 'mensal', rotulo: 'Mensal', apoio: 'No mesmo dia do mês (fim de mês é aparado)' },
    ],
    status: [
      { valor: STATUS.PENDENTE, rotulo: 'Pendente' },
      { valor: STATUS.PAUSADO, rotulo: 'Pausado' },
      { valor: STATUS.CONCLUIDO, rotulo: 'Concluído' },
      { valor: STATUS.CANCELADO, rotulo: 'Cancelado' },
    ],
    statusEnvio: [
      { valor: STATUS_ENVIO.RESERVADO, rotulo: 'Saindo agora' },
      { valor: STATUS_ENVIO.ENVIADO, rotulo: 'Enviada' },
      { valor: STATUS_ENVIO.SEM_JANELA, rotulo: 'Fora da janela de 24 h', apoio: 'Não saiu: sem modelo aprovado não há caminho fora da janela' },
      { valor: STATUS_ENVIO.ADIADO, rotulo: 'Adiada', apoio: 'Não havia por onde sair; será tentada de novo' },
      { valor: STATUS_ENVIO.FALHOU, rotulo: 'Falhou' },
      { valor: STATUS_ENVIO.DUVIDOSO, rotulo: 'Em dúvida', apoio: 'Pode ter saído. Não repetimos sozinhos — confira e reenvie se precisar' },
      { valor: STATUS_ENVIO.CANCELADO, rotulo: 'Cancelada' },
    ],
    diasSemana: [
      { valor: 0, rotulo: 'Dom' }, { valor: 1, rotulo: 'Seg' }, { valor: 2, rotulo: 'Ter' },
      { valor: 3, rotulo: 'Qua' }, { valor: 4, rotulo: 'Qui' }, { valor: 5, rotulo: 'Sex' },
      { valor: 6, rotulo: 'Sáb' },
    ],
    limites: LIMITES,
    maxTentativas: MAX_TENTATIVAS,
    recorrenciasValidas: RECORRENCIAS,
    aviso: 'Mensagem para contato fora da janela de 24 h do WhatsApp só sai por modelo aprovado pela Meta. '
      + 'Sem modelo, o item fica registrado como «fora da janela» e nada é enviado.',
  });
});

/**
 * PRÉVIA DA GRADE — as próximas N ocorrências, sem gravar nada.
 *
 * Existe porque recorrência é a configuração que mais se erra em silêncio: «a cada 2 semanas, terça
 * e quinta» tem uma resposta certa, e a pessoa só descobre que errou quando o cliente reclama. Ver
 * as seis próximas datas ANTES de salvar é o que transforma isso em conferência.
 */
router.post('/previa', (req, res) => {
  try {
    const c = req.body || {};
    const inicio = new Date(c.inicioEm);
    if (Number.isNaN(inicio.getTime())) return erro(res, new Error('inicioEm: data/hora inválida'));
    const quantas = Math.min(24, Math.max(1, Number(c.quantas) || 6));
    const datas = [inicio];
    let cursor = inicio;
    for (let i = 1; i < quantas; i += 1) {
      const p = proximaOcorrencia({ ...c, inicioEm: inicio, ocorrenciasFeitas: i }, cursor);
      if (!p) break;
      datas.push(p);
      cursor = p;
    }
    res.json({ ocorrencias: datas.map((d) => d.toISOString()), completa: datas.length === quantas });
  } catch (e) { erro(res, e); }
});

router.use(exigeModelo);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LISTAR — os filtros da tela (F4.6): período, status e recorrência
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const r = await listar(req.user, {
      tenantId: req.query.tenantId,
      de: req.query.de,
      ate: req.query.ate,
      status: req.query.status ? String(req.query.status).split(',') : undefined,
      recorrencia: req.query.recorrencia ? String(req.query.recorrencia).split(',') : undefined,
      cwInboxId: req.query.cwInboxId,
      busca: req.query.busca,
      pagina: req.query.pagina,
      porPagina: req.query.porPagina,
    });
    res.json(r);
  } catch (e) { erro(res, e); }
});

// ⚠️ ROTAS FIXAS ANTES DE `/:id`. O Express casa na ORDEM: com `/:id` declarada primeiro,
// `POST /envios/:chave/reenviar` viraria «agendamento de id envios» e responderia 404 para sempre.
// Já custou uma sessão de caça no NOC (fase 9.4, rota `/logs` interceptada por `/:id`).

/**
 * REENVIAR UM ITEM — a única forma de repetir um envio, e ela tem dono e registro.
 *
 * ⚠️ Só faz sentido para `duvidoso` e `falhou`. Reenviar um `enviado` mandaria a mensagem duas
 * vezes ao cliente por ordem humana — a rota recusa, e diz por quê, em vez de obedecer calada.
 */
router.post('/envios/:chave/reenviar', async (req, res) => {
  try {
    const chave = String(req.params.chave);
    const permitido = [STATUS_ENVIO.DUVIDOSO, STATUS_ENVIO.FALHOU, STATUS_ENVIO.SEM_JANELA];
    // A leitura de escopo é feita pelo agendamento dono do envio: um envio de outra empresa não é
    // alcançável, e a resposta é 404 — nunca 403.
    const r = await reenviarManual({ chave, workerId: `manual:${req.user?.id ?? 'anon'}` });
    if (!r) return res.status(404).json({ error: 'Envio não encontrado.', code: 'ENVIO_NAO_ENCONTRADO' });
    await auditar({
      req, acao: 'agendamento.envio.reenviado', tenantId: req.body?.tenantId,
      entidadeId: chave, descricao: `Reenvio manual do envio ${chave.slice(0, 12)}… (desfecho: ${r.desfecho})`,
    });
    res.json({ reenviado: true, ...r, permitido });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// UM AGENDAMENTO
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const r = await obter(req.user, req.params.id, { tenantId: req.query.tenantId });
    if (!r) return naoEncontrado(res);
    res.json({ agendamento: r });
  } catch (e) { erro(res, e); }
});

/** O HISTÓRICO — «status por item» da F4.6: o que aconteceu com cada destinatário, por ocorrência. */
router.get('/:id/historico', async (req, res) => {
  try {
    const r = await historico(req.user, req.params.id, {
      tenantId: req.query.tenantId,
      limite: req.query.limite,
      status: req.query.status ? String(req.query.status).split(',') : undefined,
    });
    if (!r) return naoEncontrado(res);
    res.json({ envios: r, total: r.length });
  } catch (e) { erro(res, e); }
});

router.post('/', async (req, res) => {
  try {
    const r = await criar(req.user, req.body || {});
    await auditar({
      req, acao: 'agendamento.criado', tenantId: r.tenantId, entidadeId: r.id,
      descricao: `Agendamento "${r.titulo}" criado para ${r.destinos.length} destinatário(s), ${r.recorrencia}, primeiro envio em ${r.inicioEm?.toISOString?.() ?? r.inicioEm}`,
      depois: { titulo: r.titulo, recorrencia: r.recorrencia, destinos: r.destinos.length, cwInboxId: r.cwInboxId },
    });
    res.status(201).json({ criado: true, agendamento: r });
  } catch (e) { erro(res, e); }
});

router.put('/:id', async (req, res) => {
  try {
    const antes = await obter(req.user, req.params.id, { tenantId: req.body?.tenantId });
    if (!antes) return naoEncontrado(res);
    const r = await editar(req.user, req.params.id, req.body || {});
    if (!r) return naoEncontrado(res);
    await auditar({
      req, acao: 'agendamento.editado', tenantId: r.tenantId, entidadeId: r.id,
      descricao: `Agendamento "${r.titulo}" editado`,
      antes: { titulo: antes.titulo, proximaEm: antes.proximaEm, destinos: antes.destinos.length },
      depois: { titulo: r.titulo, proximaEm: r.proximaEm, destinos: r.destinos.length },
    });
    res.json({ editado: true, agendamento: r });
  } catch (e) { erro(res, e); }
});

router.post('/:id/pausar', async (req, res) => {
  try {
    const r = await pausar(req.user, req.params.id, { tenantId: req.body?.tenantId });
    if (!r) return naoEncontrado(res);
    await auditar({ req, acao: 'agendamento.pausado', tenantId: r.tenantId, entidadeId: r.id, descricao: `Agendamento "${r.titulo}" pausado` });
    res.json({ pausado: true, agendamento: r });
  } catch (e) { erro(res, e); }
});

router.post('/:id/retomar', async (req, res) => {
  try {
    const r = await retomar(req.user, req.params.id, { tenantId: req.body?.tenantId });
    if (!r) return naoEncontrado(res);
    await auditar({
      req, acao: 'agendamento.retomado', tenantId: r.tenantId, entidadeId: r.id,
      descricao: `Agendamento "${r.titulo}" retomado (próxima ocorrência: ${r.proximaEm?.toISOString?.() ?? 'nenhuma'})`,
    });
    res.json({ retomado: true, agendamento: r });
  } catch (e) { erro(res, e); }
});

/**
 * CANCELAR. NÃO apaga: o que já disparou fica no histórico — que é a exigência nº 5 do contrato.
 * Por isso o verbo é POST /cancelar e NÃO existe DELETE: um `DELETE` sugeriria que a linha some, e
 * quem apagasse perderia a resposta a «esta mensagem saiu?».
 */
router.post('/:id/cancelar', async (req, res) => {
  try {
    const r = await cancelar(req.user, req.params.id, { tenantId: req.body?.tenantId });
    if (!r) return naoEncontrado(res);
    await auditar({ req, acao: 'agendamento.cancelado', tenantId: r.tenantId, entidadeId: r.id, descricao: `Agendamento "${r.titulo}" cancelado` });
    res.json({ cancelado: true, agendamento: r });
  } catch (e) { erro(res, e); }
});

export default router;
