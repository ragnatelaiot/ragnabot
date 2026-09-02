// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — A CAIXA DE ATENDIMENTO.  Contrato S2 (02/09/2026)
//
// É a tela onde o agente vive: as abas Abertas · Resolvidos · Grupos, as sub-abas Atendendo ·
// Aguardando · ChatBot com contador, o cartão com as três etiquetas (caixa · setor · atendente) e
// o histórico do contato DENTRO do setor.
//
// ── MONTAGEM (em src/servidor.js, junto das outras) ─────────────────────────────────────────────
//   await montar('/api/ragnabot-caixa', './routes/ragnabot-caixa.routes.js', autenticar);
//
// ⚠️ O mount leva SÓ `autenticar` — NÃO ponha `adminOnly`. Mesma razão já registrada em
// `ragnabot-atendimento.routes.js` e em `ragnabot-respostas-rapidas.routes.js`: quem vive nesta
// tela é o ATENDENTE, cuja `role` é 'user'. Trancar o mount em admin entregaria a caixa justamente
// a quem não a usa. O que cada um ENXERGA é decidido pelo serviço, no `where` da consulta.
//
// ── ⛔ A REGRA INEGOCIÁVEL DESTE ARQUIVO ────────────────────────────────────────────────────────
// Nenhum parâmetro da tela ALARGA visibilidade. `cwAssigneeId`, `cwTeamId` e `cwInboxId` na
// consulta só ESTREITAM dentro do que o usuário já podia ver — a cláusula de visibilidade é
// aplicada SEMPRE, por fora, pelo serviço. Um agente que mande `?cwAssigneeId=outro` recebe lista
// vazia, não a lista do colega. (Provado em tests/ragnabot-caixa-isolamento.test.mjs, prova 4.)
//
// ── 404, NÃO 403 ───────────────────────────────────────────────────────────────────────────────
// Conversa que existe mas não é sua responde "não encontrada". 403 confirmaria ao curioso que
// aquele número existe — que é metade do vazamento. 403 fica para o caso legítimo em que a recusa
// PRECISA ser explicada: pedir histórico de um setor de que você não é membro (o operador tem de
// entender por que não vê, senão abre chamado achando que é defeito).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import {
  ABAS, SUBABAS, ESTADOS,
  listar, contar, obter, historicoDoContato, listarSetores,
  sincronizarSetores, sincronizarMembrosDosSetores,
  modeloPronto, podeAdministrar,
} from '../services/ragnabot-caixa.service.js';
import { retrocarregar } from '../services/ragnabot-caixa-retrocarga.service.js';
import { escopoDe } from '../services/ragnabot-auditoria.service.js';
import prisma from '../base/db.js';

const router = Router();

function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.code) corpo.code = e.code;
  return res.status(status).json(corpo);
}

// ── GUARDA DE MIGRAÇÃO ──────────────────────────────────────────────────────────────────────────
// O cliente Prisma é carregado no arranque: a tabela existir no banco não basta, o processo precisa
// ter sido reiniciado. 503 com texto claro diz o que fazer; 500 mandaria caçar defeito onde não há.
function exigeModelo(_req, res, next) {
  if (modeloPronto()) return next();
  return res.status(503).json({
    error: 'A caixa de atendimento ainda não está disponível neste processo. '
      + 'Aplique prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql e reinicie o serviço.',
    code: 'MODELO_AUSENTE',
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OPÇÕES — o vocabulário da tela, sem tocar no banco. Fora da guarda de propósito: a tela precisa
// conseguir se desenhar e mostrar o aviso mesmo num banco onde a migração ainda não passou.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/opcoes', (req, res) => {
  res.json({
    abas: [
      { valor: 'abertas', rotulo: 'Abertas' },
      { valor: 'resolvidos', rotulo: 'Resolvidos' },
      { valor: 'grupos', rotulo: 'Grupos' },
    ],
    subabas: [
      { valor: 'atendendo', rotulo: 'Atendendo', apoio: 'Com atendente' },
      { valor: 'aguardando', rotulo: 'Aguardando', apoio: 'Na fila, sem atendente' },
      { valor: 'chatbot', rotulo: 'ChatBot', apoio: 'Com o robô' },
    ],
    estados: ESTADOS,
    administra: podeAdministrar(req.user),
    comoLer: 'Você vê as conversas atribuídas a você, as que você resolveu e a fila dos setores de '
      + 'que participa. O administrador da empresa vê todas.',
  });
});

router.use(exigeModelo);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LISTAR — `?aba=abertas&sub=atendendo&pagina=1&porPagina=25&busca=&cwTeamId=&cwInboxId=`
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/conversas', async (req, res) => {
  try {
    const r = await listar(req.user, {
      aba: ABAS.includes(req.query.aba) ? req.query.aba : 'abertas',
      sub: SUBABAS.includes(req.query.sub) ? req.query.sub : null,
      pagina: req.query.pagina,
      porPagina: req.query.porPagina,
      busca: req.query.busca,
      cwTeamId: req.query.cwTeamId,
      cwInboxId: req.query.cwInboxId,
      cwAssigneeId: req.query.cwAssigneeId,
      // Só o super usuário estreita por empresa; para os demais o serviço IGNORA este campo.
      tenantId: req.query.tenantId,
    });
    return res.json(r);
  } catch (e) {
    return erro(res, e, 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTADORES — os números das abas e sub-abas.
// Vêm do MESMO construtor de `where` da lista. É por isso que existe rota separada e não um campo
// solto: o teste compara, aba por aba, o número desta rota com o tamanho da lista daquela aba.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/contadores', async (req, res) => {
  try {
    const r = await contar(req.user, {
      busca: req.query.busca,
      cwTeamId: req.query.cwTeamId,
      cwInboxId: req.query.cwInboxId,
      cwAssigneeId: req.query.cwAssigneeId,
      tenantId: req.query.tenantId,
    });
    return res.json(r);
  } catch (e) {
    return erro(res, e, 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// UMA CONVERSA — ⭐ o teste de aceite do contrato bate AQUI.
// Agente A pedindo a conversa do agente B recebe 404. Não há caminho alternativo: `obter()` já
// carrega a cláusula de visibilidade dentro da própria consulta.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/conversas/:cwConversationId', async (req, res) => {
  try {
    const c = await obter(req.user, req.params.cwConversationId);
    if (!c) {
      return res.status(404).json({
        error: 'Conversa não encontrada.',
        code: 'CONVERSA_NAO_ENCONTRADA',
      });
    }
    return res.json({ conversa: c });
  } catch (e) {
    return erro(res, e, 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HISTÓRICO DO CONTATO — SEMPRE dentro de um setor. `cwTeamId` é obrigatório, e não há modo global.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/historico', async (req, res) => {
  try {
    const r = await historicoDoContato(req.user, {
      cwTeamId: req.query.cwTeamId,
      contatoChave: req.query.contatoChave,
      cwContactId: req.query.cwContactId,
      limite: req.query.limite,
    });
    if (r.permitido) return res.json(r);

    // Aqui a recusa é EXPLICADA de propósito (ver o cabeçalho): o operador precisa saber que não é
    // defeito. Nenhuma destas mensagens revela a existência de conversa alheia — falam de SETOR,
    // que é estrutura da empresa e o próprio usuário já enxerga em /setores.
    const mapa = {
      SETOR_OBRIGATORIO: [400, 'Informe o setor: o histórico é por setor, nunca global.'],
      CONTATO_OBRIGATORIO: [400, 'Informe o contato (contatoChave ou cwContactId).'],
      FORA_DO_SEU_SETOR: [403, 'Você não participa deste setor.'],
      SEM_EMPRESA: [403, 'Seu usuário não está vinculado a uma empresa do Ragnabot.'],
    };
    const [status, msg] = mapa[r.motivo] || [400, 'Consulta inválida.'];
    return res.status(status).json({ error: msg, code: r.motivo });
  } catch (e) {
    return erro(res, e, 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SETORES — para o filtro da tela e para escolher o setor do histórico. Agente vê só os dele.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/setores', async (req, res) => {
  try {
    return res.json(await listarSetores(req.user));
  } catch (e) {
    return erro(res, e, 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SINCRONIZAR setores e membros com a plataforma — ADMINISTRADOR.
// É o que enche `RagnabotAgenteSetor`, e portanto o que faz a fila do setor aparecer para o agente.
// Enquanto ninguém rodar, o agente vê só as conversas dele (falha fechada, e é assim de propósito).
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.post('/sincronizar', async (req, res) => {
  if (!podeAdministrar(req.user)) {
    return res.status(403).json({ error: 'Esta ação exige administrador.', code: 'SEM_PERMISSAO' });
  }
  try {
    const esc = escopoDe(req.user);
    const tenantId = esc.global ? String(req.body?.tenantId || '') : esc.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Informe "tenantId".', code: 'TENANT_OBRIGATORIO' });
    }
    const t = await prisma.ragnabotTenant.findUnique({ where: { id: tenantId }, select: { cwAccountId: true } });
    if (!t?.cwAccountId) {
      return res.status(409).json({
        error: 'Esta empresa ainda não tem conta na plataforma.', code: 'SEM_CONTA',
      });
    }
    const setores = await sincronizarSetores({ tenantId, cwAccountId: t.cwAccountId });
    const membros = await sincronizarMembrosDosSetores({ tenantId, cwAccountId: t.cwAccountId });
    return res.json({ ok: true, setores, membros });
  } catch (e) {
    return erro(res, e, 500);
  }
});


// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETROCARGA — as conversas que JÁ EXISTIAM entram no índice.  Contrato S3 (02/09/2026).
//
// POR QUE ESTA ROTA EXISTE: o índice se enche pelo WEBHOOK, e o webhook ainda não está cadastrado
// na plataforma (decisão do chefe). Sem ela, a caixa nasceria vazia com conversas existentes
// invisíveis — e o operador concluiria, com razão aparente, que o produto não funciona.
//
// ⚠️ IDEMPOTENTE: rodar duas vezes não duplica (upsert pela chave única da conversa) e não piora o
// que o webhook já gravou melhor — `resolvidaEm`/`resolvidaPor` de linha já resolvida NÃO são
// reescritos. Ver o cabeçalho do serviço.
//
// `?simular=1` mede e devolve o relatório SEM gravar nada. É o modo de conferir antes.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.post('/retrocarga', async (req, res) => {
  if (!podeAdministrar(req.user)) {
    return res.status(403).json({ error: 'Esta ação exige administrador.', code: 'SEM_PERMISSAO' });
  }
  try {
    const esc = escopoDe(req.user);
    // Super usuário precisa DIZER a empresa; administrador de empresa não escolhe — é a dele.
    const tenantId = esc.global ? String(req.body?.tenantId || '') : esc.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Informe "tenantId".', code: 'TENANT_OBRIGATORIO' });
    }
    const t = await prisma.ragnabotTenant.findUnique({ where: { id: tenantId }, select: { cwAccountId: true } });
    if (!t?.cwAccountId) {
      return res.status(409).json({
        error: 'Esta empresa ainda não tem conta na plataforma — não há conversa para trazer.',
        code: 'SEM_CONTA',
      });
    }

    // Sincronizar os setores ANTES é o que faz o nome do setor aparecer no cartão e a fila do setor
    // ficar visível ao agente. Falha aqui NÃO impede a retrocarga: índice com o número do setor é
    // melhor que índice nenhum, e o relatório diz que o nome ficou faltando.
    let setores = null;
    let membros = null;
    if (req.body?.sincronizarSetores !== false && req.query.simular !== '1') {
      try {
        setores = await sincronizarSetores({ tenantId, cwAccountId: t.cwAccountId });
        membros = await sincronizarMembrosDosSetores({ tenantId, cwAccountId: t.cwAccountId });
      } catch (e) {
        setores = { erro: e.message };
      }
    }

    const resumo = await retrocarregar({
      tenantId,
      cwAccountId: t.cwAccountId,
      estados: Array.isArray(req.body?.estados) && req.body.estados.length ? req.body.estados : undefined,
      limite: Number(req.body?.limite) || undefined,
      simular: req.query.simular === '1' || req.body?.simular === true,
    });

    return res.json({ ok: true, setores, membros, retrocarga: resumo });
  } catch (e) {
    return erro(res, e, 500);
  }
});

export default router;
