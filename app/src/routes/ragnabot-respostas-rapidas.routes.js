// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — RESPOSTAS RÁPIDAS (os atalhos de texto do atendente).  C9
//
// É a tela "Gestão ➜ Respostas rápidas": cadastrar as frases que a equipe repete o dia inteiro e
// acioná-las por um atalho (`/bomdia`) dentro da caixa de resposta, já com o nome do cliente e o
// protocolo trocados.
//
// ── MONTAGEM (a linha é do CHEFE; escrever em src/server.js, perto das outras rotas do Ragnabot) ─
//   app.use('/api/ragnabot-respostas-rapidas', authMiddleware,
//     (await import('./routes/ragnabot-respostas-rapidas.routes.js')).default);
//
// ⚠️ O mount leva SÓ `authMiddleware`, de propósito — NÃO ponha `adminOnly`. Mesma razão já
// registrada em `ragnabot-atendimento.routes.js` e em `ragnabot-auditoria.routes.js`: quem mais usa
// resposta rápida é o ATENDENTE, cuja `role` do NOC é 'user'. Trancar o mount em admin entregaria a
// tela justamente a quem não a usa. Quem pode ESCREVER o quê é decidido aqui dentro (resposta da
// empresa = administrador; resposta pessoal = o próprio dono), pelo serviço.
//
// ── A REGRA INEGOCIÁVEL DESTE ARQUIVO ───────────────────────────────────────────────────────────
// O `tenantId` NUNCA vem da tela para ampliar alcance: é derivado do usuário logado por `escopoDe()`
// dentro do serviço. Um `tenantId` no corpo ou na consulta só é aceito de quem é super — e aí ele
// ESTREITA, jamais ALARGA. Foi confiando na empresa que a TELA mandava que o sistema antigo vazou.
//
// ── 404, NÃO 403, PARA O QUE ESTÁ FORA DO ESCOPO ────────────────────────────────────────────────
// Um id de outra empresa responde "não encontrada". 403 confirmaria ao curioso que aquele id EXISTE
// — que é metade do vazamento. 403 aqui é usado só para o caso legítimo: a linha É sua/da sua
// empresa e você não tem o papel para mexer nela.
//
// ── FRONTEIRA DE DONO ───────────────────────────────────────────────────────────────────────────
// Toda decisão de domínio (o que é atalho válido, qual resposta ganha o desempate, quais são as
// variáveis, como o texto expande) vem de `ragnabot-respostas-rapidas.service.js`. À rota cabe o
// que é dela: validar a entrada, chamar o serviço, auditar e traduzir o erro em código HTTP.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { registrar } from '../services/ragnabot-auditoria.service.js';
import { logAction } from '../base/auditoria.js';
import {
  VISIBILIDADES, LIMITES, VARIAVEIS, NOMES_DE_VARIAVEL,
  atalhoExibido, normalizarAtalho, contextoDeVariaveis, expandir,
  variaveisUsadas, variaveisDesconhecidas, modeloPronto,
  listar, obter, criar, editar, remover, resolverAtalho,
} from '../services/ragnabot-respostas-rapidas.service.js';

const router = Router();

/**
 * Tradução de erro → HTTP. O serviço carimba `status` no erro quando a recusa TEM um código certo
 * (403 de permissão, 409 de atalho duplicado); o resto é entrada inválida, que é 400.
 * Sem isto, "já existe /bomdia" viraria 500 e a tela diria "erro no servidor" para um erro do
 * usuário — a pior mensagem possível, porque manda caçar defeito onde não há.
 */
function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.code) corpo.code = e.code;
  return res.status(status).json(corpo);
}

// ── GUARDA DE MIGRAÇÃO ──────────────────────────────────────────────────────────────────────────
// O modelo é do `schema.prisma` e pode ainda não ter migrado no banco onde este processo subiu.
// Sem a guarda, a rota estouraria um TypeError cru ("Cannot read properties of undefined") e o
// operador leria "erro 500" sem a menor pista do que fazer. 503 com texto claro diz.
//
// ⚠️ Vale também para o processo que subiu ANTES da migração: o cliente Prisma é carregado no boot,
// então a tabela existir no banco não basta — o processo precisa ter sido reiniciado (decisão do
// chefe, e só sem sessão ativa).
function exigeModelo(_req, res, next) {
  if (modeloPronto()) return next();
  return res.status(503).json({
    error: 'A tabela de respostas rápidas ainda não está disponível neste processo. '
      + 'Aplique prisma/sql/respostas-rapidas/01-rb_respostas_rapidas.sql e reinicie o serviço.',
    code: 'MODELO_AUSENTE',
  });
}

/** Auditoria em DOIS lugares: a do Ragnabot (por empresa) e o log do NOC. Nenhuma derruba a gravação. */
async function auditar({ req, acao, tenantId, entidadeId, descricao, antes, depois }) {
  await registrar({
    tenantId, atorTipo: 'usuario', atorId: req.user?.id || null,
    atorNome: req.user?.name || req.user?.username || null,
    categoria: 'configuracao', acao, descricao,
    ip: req.ip, userAgent: req.headers?.['user-agent'],
    entidade: 'RagnabotRespostaRapida', entidadeId, antes, depois,
  }).catch(() => {});
  await logAction({
    user: req.user, req, action: acao, category: 'settings',
    entityType: 'RagnabotRespostaRapida', entityId: entidadeId, description: descricao,
    payloadBefore: antes || undefined, payloadAfter: depois || undefined, rollbackable: false,
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OPÇÕES — o vocabulário para a tela montar os menus sem repetir listas do lado de lá.
// Duas listas iguais em dois lugares divergem no primeiro valor novo, e quem descobre é o usuário.
// Fica FORA da guarda de migração de propósito: a tela precisa conseguir se desenhar e mostrar o
// aviso mesmo num banco onde a tabela ainda não passou. Tela em branco esconde o motivo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/opcoes', (_req, res) => {
  res.json({
    visibilidades: [
      { valor: 'empresa', rotulo: 'Da empresa — todo mundo usa' },
      { valor: 'pessoal', rotulo: 'Só minha' },
    ],
    variaveis: VARIAVEIS,
    nomesDeVariavel: NOMES_DE_VARIAVEL,
    limites: LIMITES,
    comoUsar: 'Na caixa de resposta, digite / seguido do atalho (ex.: /bomdia) e confirme.',
  });
});

router.use(exigeModelo);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LISTAR — `?busca=` procura no atalho E no título
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const r = await listar(req.user, {
      tenantId: req.query.tenantId,
      busca: req.query.busca,
      visibilidade: req.query.visibilidade,
      cwInboxId: req.query.cwInboxId,
      cwTeamId: req.query.cwTeamId,
      incluirInativas: req.query.incluirInativas === 'true',
      limite: req.query.limite,
    });
    res.json(r);
  } catch (e) { erro(res, e); }
});

// ⚠️ ROTAS FIXAS ANTES DE `/:id`. O Express casa na ORDEM: com `/:id` declarada primeiro,
// `GET /resolver` viraria "buscar a resposta de id 'resolver'" e devolveria 404 para sempre. Já
// custou uma sessão de caça no NOC (fase 9.4, rota `/logs` interceptada por `/:id`).
// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — o que a caixa de resposta chama quando o atendente digita `/bomdia`
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/resolver', async (req, res) => {
  try {
    if (!req.query.atalho) return erro(res, new Error('Informe ?atalho= (ex.: ?atalho=/bomdia)'));
    const contexto = contextoDaConsulta(req.query);
    const r = await resolverAtalho(req.user, req.query.atalho, contexto);
    if (!r) {
      // 404 aqui é sobre o ATALHO, não sobre escopo: não existe resposta ativa com esse atalho ao
      // alcance deste atendente. A tela mostra "atalho não encontrado" e segue a vida.
      return res.status(404).json({
        error: `Nenhuma resposta rápida ativa com o atalho "${atalhoExibido(normalizarAtalho(req.query.atalho))}".`,
        code: 'ATALHO_NAO_ENCONTRADO',
      });
    }
    res.json(r);
  } catch (e) { erro(res, e); }
});

/**
 * PRÉVIA — expande um texto QUALQUER sem gravar nada, para a tela mostrar como vai ficar.
 *
 * Existe porque variável errada só aparece depois de enviada, e aí já foi para o cliente. Aqui o
 * atendente vê `{{protocolo}}` virar vazio ANTES, e a lista `desconhecidas` denuncia o
 * `{{contatoNome}}` que ele inventou e que nunca vai preencher nada.
 */
router.post('/previa', (req, res) => {
  try {
    const corpo = req.body || {};
    const texto = String(corpo.mensagem ?? '');
    if (texto.length > LIMITES.mensagem) return erro(res, new Error(`mensagem: acima de ${LIMITES.mensagem} caracteres`));
    const contexto = { ...contextoDaConsulta(corpo.contexto || {}), ...exemplosSeVazio(corpo) };
    const r = expandir(texto, contexto);
    res.json({
      texto: r.texto,
      usadas: r.usadas,
      ausentes: r.ausentes,
      desconhecidas: variaveisDesconhecidas(texto),
    });
  } catch (e) { erro(res, e); }
});

/**
 * Contexto vindo da consulta/corpo. Nada aqui abre escopo — são só os dados da CONVERSA que a tela
 * já tem na mão (nome do contato, protocolo, número do atendimento). O `user` cai para o nome do
 * usuário logado quando a tela não mandar: `{{user}}` é o atendente que está escrevendo, e deixar a
 * tela decidir isso permitiria assinar a mensagem com o nome de um colega.
 */
function contextoDaConsulta(q = {}) {
  return {
    contactName: q.contactName ?? q.contato ?? undefined,
    contactFirstName: q.contactFirstName ?? undefined,
    protocolo: q.protocolo ?? q.protocolNumber ?? undefined,
    ticket_id: q.ticket_id ?? q.ticketId ?? q.cwConversationId ?? undefined,
    queue: q.queue ?? q.fila ?? undefined,
    connection: q.connection ?? q.conexao ?? undefined,
    empresa: q.empresa ?? undefined,
    cwInboxId: q.cwInboxId ?? undefined,
    cwTeamId: q.cwTeamId ?? undefined,
    fuso: q.fuso ?? undefined,
  };
}

/** Na prévia sem dados de conversa, usa os exemplos do catálogo — texto de prévia todo vazio não
 *  mostra nada e o atendente conclui que a variável "não funciona". */
function exemplosSeVazio(corpo) {
  if (corpo.comExemplos === false) return {};
  const ctx = corpo.contexto || {};
  const temAlgo = Object.values(ctx).some((v) => v !== undefined && v !== null && v !== '');
  if (temAlgo) return {};
  const ex = {};
  for (const v of VARIAVEIS) ex[v.nome] = v.exemplo;
  return { ...ex, user: ex.user, extras: {} };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// UMA RESPOSTA
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const r = await obter(req.user, req.params.id);
    // Fora do escopo: 404, NUNCA 403. Ver o cabeçalho.
    if (!r) return res.status(404).json({ error: 'resposta rápida não encontrada' });
    res.json({ resposta: r });
  } catch (e) { erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CRIAR
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const corpo = req.body || {};
    if (corpo.visibilidade !== undefined && !VISIBILIDADES.includes(corpo.visibilidade)) {
      return erro(res, new Error(`visibilidade: use um de ${VISIBILIDADES.join(' | ')}`));
    }
    const criada = await criar(req.user, corpo);
    await auditar({
      req, acao: 'ragnabot_resposta_rapida_criada', tenantId: criada.tenantId, entidadeId: criada.id,
      descricao: `Resposta rápida ${atalhoExibido(criada.atalho)} ("${criada.titulo}") criada `
        + `— visibilidade ${criada.visibilidade}`,
      depois: criada,
    });
    res.status(201).json({ criada: true, resposta: criada });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EDITAR — parcial; só o que veio no corpo
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', async (req, res) => {
  try {
    const antes = await obter(req.user, req.params.id);
    if (!antes) return res.status(404).json({ error: 'resposta rápida não encontrada' });
    const nova = await editar(req.user, req.params.id, req.body || {});
    if (!nova) return res.status(404).json({ error: 'resposta rápida não encontrada' });
    await auditar({
      req, acao: 'ragnabot_resposta_rapida_alterada', tenantId: nova.tenantId, entidadeId: nova.id,
      descricao: `Resposta rápida ${atalhoExibido(nova.atalho)} alterada: `
        + `${Object.keys(req.body || {}).join(', ') || '(sem campos)'}`,
      antes, depois: nova,
    });
    res.json({ alterada: true, resposta: nova });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REMOVER
//
// Sem `?confirmar=`, ao contrário da política de automações: apagar uma frase custa recadastrar uma
// frase; apagar a configuração de uma caixa cala o robô de um cliente inteiro. Exigir cerimônia
// onde ela não é necessária ensina o operador a clicar em "sim" sem ler — e aí ele clica também
// onde importa.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', async (req, res) => {
  try {
    const removida = await remover(req.user, req.params.id);
    if (!removida) return res.status(404).json({ error: 'resposta rápida não encontrada' });
    await auditar({
      req, acao: 'ragnabot_resposta_rapida_removida', tenantId: removida.tenantId, entidadeId: removida.id,
      descricao: `Resposta rápida ${atalhoExibido(removida.atalho)} ("${removida.titulo}") REMOVIDA`,
      antes: removida,
    });
    res.json({ removida: true, resposta: removida });
  } catch (e) { erro(res, e); }
});

/** Exportado só para o teste conferir a lista sem levantar o Express. */
export const _internos = { contextoDaConsulta, exemplosSeVazio, contextoDeVariaveis, variaveisUsadas };

export default router;
