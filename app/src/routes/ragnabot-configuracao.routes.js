// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — MENU CONFIGURAÇÕES.  Contrato S7 (doc 34 §F8), 02/09/2026
//
// ── MONTAGEM (a linha é do CHEFE; em src/servidor.js, junto das outras) ─────────────────────────
//   await montar('/api/ragnabot-config', './routes/ragnabot-configuracao.routes.js', autenticar);
//
// ⚠️ O mount leva SÓ `autenticar`, de propósito — NÃO ponha `adminOnly`. Mesma razão dos vizinhos:
// o ATENDENTE precisa LER ajustes que mudam a tela dele (tema, modo das etiquetas, assinatura).
// Quem pode ESCREVER é decidido aqui dentro, rota a rota.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ A ORDEM DO DONO, E ONDE ELA É CUMPRIDA (02/09/2026)
//
//   > "colunas whitelabel, empresas e planos só aparecem na conta que vende o SaaS — no caso, na
//   >  Ragnatela. Na conta de cliente elas não aparecem."
//
// Esconder a aba no menu NÃO cumpre a ordem. É a mesma lição do contrato S2: o cliente descobre a
// URL, chama a API e lê a base comercial de todas as outras empresas. Por isso as três rotas
// abaixo passam por `exigirOperadorDoSaas` (`src/base/operador-saas.js`), que responde 403 com
// `code: NAO_E_OPERADOR_DO_SAAS` — e o teste de aceite é a RECUSA pela API, não o botão sumido.
//
//   GET/PUT /whitelabel   → operador do SaaS
//   GET     /empresas     → operador do SaaS   (leitura; o cadastro segue em /api/ragnabot/tenants)
//   GET     /planos       → operador do SaaS   (leitura; a escrita segue em /api/ragnabot-cobranca)
//
// 📌 As duas rotas canônicas JÁ recusavam antes desta entrega, e isso foi MEDIDO, não suposto:
//   · `/api/ragnabot/tenants` tem defesa em profundidade exigindo super (`device.service.js`);
//   · `/api/ragnabot-cobranca/*` tem `router.use(superuserOnly)`.
// O que faltava era a trava do WHITELABEL (que não existia) e um lugar onde a TELA pudesse
// perguntar, sem adivinhar, o que desenhar — que é o `GET /quem-sou`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { registrar } from '../services/ragnabot-auditoria.service.js';
import { logAction } from '../base/auditoria.js';
import { exigirOperadorDoSaas, avaliarOperadorDoSaas } from '../base/operador-saas.js';
import {
  PAINEIS, PENDENTES_DE_DECISAO, PROVEDORES_DE_IA, chavesDoPainel,
} from '../services/ragnabot-configuracao.catalogo.js';
import {
  modeloPronto, lerPainel, lerTodosOsPaineisDaEmpresa, salvarPainel, resolverEscopo,
} from '../services/ragnabot-configuracao.service.js';

const router = Router();

const PAINEL_WHITELABEL = 'whitelabel';

/** Tradução de erro → HTTP. O serviço carimba `status` quando a recusa TEM um código certo. */
function erro(res, e, padrao = 400) {
  const status = Number(e?.status) || padrao;
  const corpo = { error: (e && e.message) || String(e) };
  if (e?.code) corpo.code = e.code;
  return res.status(status).json(corpo);
}

// ── GUARDA DE MIGRAÇÃO ──────────────────────────────────────────────────────────────────────────
// A tabela é do `schema.prisma` e pode ainda não ter migrado no banco onde este processo subiu.
// ⚠️ Vale também para o processo que subiu ANTES da migração: o cliente Prisma é carregado no
// arranque, então a tabela existir no banco não basta — o processo precisa ter sido reiniciado
// (decisão do chefe, e só sem sessão ativa).
function exigeModelo(_req, res, next) {
  if (modeloPronto()) return next();
  return res.status(503).json({
    error: 'A tabela de configurações ainda não está disponível neste processo. '
      + 'Aplique prisma/sql/configuracoes/01-rb_configuracoes.sql e reinicie o serviço.',
    code: 'MODELO_AUSENTE',
  });
}

/** Escrever configuração é ato de administrador. Ler, não — o atendente lê o que muda a tela dele. */
function exigirAdmin(req, res, next) {
  if (req.user?.isSuperuser || req.user?.role === 'admin') return next();
  return res.status(403).json({
    error: 'SEM_PERMISSAO', code: 'EXIGE_ADMIN',
    message: 'Mudar configurações exige perfil de administrador.',
  });
}

// ── AUDITORIA ───────────────────────────────────────────────────────────────────────────────────
// Em DOIS lugares, como os vizinhos: a do Ragnabot (isolada por empresa) e o log do NOC. Nenhuma
// derruba a gravação — auditoria que quebra a operação é pior que auditoria ausente.
//
// ⚠️ O ANTES→DEPOIS É O PONTO. Uma ação sem `payloadBefore` não prova transição: "ficou ligado"
// não distingue "estava desligado e alguém ligou" de "já estava ligado e alguém salvou de novo".
// ⛔ E o `depois` de um SEGREDO é a impressão digital, nunca o valor — quem monta isso é o
// serviço, aqui só repassamos o que ele devolveu.
async function auditarMudancas({ req, painel, tenantId, mudancas }) {
  if (!mudancas.length) return;
  const resumo = mudancas.map((m) => m.rotulo).join(' · ');
  const antes = Object.fromEntries(mudancas.map((m) => [m.chave, m.antes]));
  const depois = Object.fromEntries(mudancas.map((m) => [m.chave, m.depois]));

  await registrar({
    tenantId,
    atorTipo: req.user?.isSuperuser ? 'super' : 'usuario',
    atorId: req.user?.id || null,
    atorNome: req.user?.name || req.user?.username || null,
    atorEmail: req.user?.email || null,
    categoria: 'configuracao',
    acao: `configuracao.${painel}.salvar`,
    descricao: `${mudancas.length} ajuste(s) em "${painel}": ${resumo}`,
    entidade: 'RagnabotConfiguracao',
    entidadeId: painel,
    antes,
    depois,
    ip: req.ip || null,
    userAgent: req.headers?.['user-agent'] || null,
  }).catch(() => null);

  await logAction({
    user: req.user, req,
    action: `ragnabot.configuracao.${painel}.salvar`,
    category: 'settings',
    entityType: 'RagnabotConfiguracao', entityId: painel,
    description: `${mudancas.length} ajuste(s) em "${painel}": ${resumo}`,
    payloadBefore: antes, payloadAfter: depois,
    tenantId,
  }).catch(() => null);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. QUEM SOU — o que a TELA pode desenhar
//
// A tela NÃO decide isso sozinha. Ela pergunta, e o servidor responde — assim há um lugar só onde
// a regra do dono vive, e o menu nunca discorda da API. (Se um dia discordarem, quem manda é a
// API: o menu é desenho, ela é a tranca.)
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/quem-sou', (req, res) => {
  const op = avaliarOperadorDoSaas(req.user);
  const admin = Boolean(req.user?.isSuperuser || req.user?.role === 'admin');
  return res.json({
    ator: {
      id: req.user?.id || null,
      nome: req.user?.name || null,
      papel: req.user?.role || 'user',
      superUsuario: Boolean(req.user?.isSuperuser),
      empresaId: req.user?.ragnabotTenantId || null,
      contaNaPlataforma: req.user?.cwAccountId ?? null,
    },
    operadorDoSaas: op.ok,
    operadorVia: op.via,
    // Motivo escrito: quem for legitimamente da Ragnatela e cair no 403 precisa saber que falta
    // declarar a empresa operadora, e não ficar com um "o sistema não deixa" sem próximo passo.
    operadorMotivo: op.motivo,
    podeEscrever: admin,
    // Os painéis que ESTA pessoa pode abrir. Whitelabel só entra para o operador do SaaS.
    paineis: PAINEIS
      .filter((p) => p.escopo !== 'operador' || op.ok)
      .map((p) => ({ id: p.id, rotulo: p.rotulo, escopo: p.escopo, doc: p.doc })),
    // ⚠️ Declarado, não escondido: as abas do operador que esta conta NÃO vê.
    paineisOcultos: op.ok ? [] : PAINEIS.filter((p) => p.escopo === 'operador').map((p) => p.id),
  });
});

/** O catálogo cru de um painel (rótulos, tipos, opções) — útil para a tela montar o formulário
 *  antes mesmo de ter os valores. Whitelabel só para o operador. */
router.get('/catalogo/:painel', (req, res) => {
  const { painel } = req.params;
  if (painel === PAINEL_WHITELABEL && !avaliarOperadorDoSaas(req.user).ok) {
    return res.status(403).json({
      error: 'SEM_PERMISSAO', code: 'NAO_E_OPERADOR_DO_SAAS',
      message: 'Este painel é da conta que opera o SaaS.',
    });
  }
  const defs = chavesDoPainel(painel);
  if (defs.length === 0) return res.status(404).json({ error: 'Painel desconhecido.', code: 'PAINEL_DESCONHECIDO' });
  return res.json({
    painel,
    rotulo: PAINEIS.find((p) => p.id === painel)?.rotulo || painel,
    // ⛔ `padrao` de segredo sai como `null`: nem o padrão de uma chave secreta vaza por aqui.
    itens: defs.map((d) => ({
      chave: d.chave, rotulo: d.rotulo, tipo: d.tipo, ajuda: d.ajuda || '',
      padrao: d.segredo ? null : d.padrao, opcoes: d.opcoes || null,
      min: d.min ?? null, max: d.max ?? null, maxLen: d.maxLen ?? null,
      efeito: d.efeito, jaExiste: d.jaExiste || null, informativo: Boolean(d.informativo),
    })),
  });
});

/** As decisões que dependem do DONO. Ficam na API para não virarem promessa esquecida num .md. */
router.get('/pendentes-de-decisao', (_req, res) => res.json({
  total: PENDENTES_DE_DECISAO.length,
  itens: PENDENTES_DE_DECISAO,
}));

/** O catálogo de provedores de IA (8.11.1) — trocável, não amarrado a um fornecedor. */
router.get('/provedores-de-ia', (_req, res) => res.json({ itens: PROVEDORES_DE_IA }));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. WHITELABEL (8.3) — ⛔ SÓ O OPERADOR DO SaaS
//
// Rota PRÓPRIA, e não só um painel a mais, porque é ela que o teste de aceite chama. Um caminho
// nomeado é o que se cola numa prova; "o painel X do endpoint genérico" não é.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/whitelabel', exigirOperadorDoSaas, exigeModelo, async (req, res) => {
  try {
    return res.json(await lerPainel(req.user, PAINEL_WHITELABEL));
  } catch (e) { return erro(res, e); }
});

router.put('/whitelabel', exigirOperadorDoSaas, exigeModelo, exigirAdmin, async (req, res) => {
  try {
    const r = await salvarPainel(req.user, PAINEL_WHITELABEL, req.body?.valores || req.body || {});
    await auditarMudancas({ req, painel: PAINEL_WHITELABEL, tenantId: null, mudancas: r.mudancas });
    return res.json({
      ...r,
      // Devolve o painel relido: a tela não precisa adivinhar o que ficou gravado, e um valor
      // normalizado (cor em minúsculas, por exemplo) aparece na hora em vez de na próxima abertura.
      painelAtual: await lerPainel(req.user, PAINEL_WHITELABEL),
    });
  } catch (e) { return erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. EMPRESAS (8.4) e PLANOS (8.5) — ⛔ SÓ O OPERADOR DO SaaS
//
// LEITURA apenas, e de propósito: o cadastro já tem casa (`/api/ragnabot/tenants`,
// `/api/ragnabot-cobranca/planos`), com 2FA e justificativa em tudo que muda o mundo. Duplicar a
// escrita seria criar um segundo caminho para o mesmo ato — e um segundo caminho é um segundo
// lugar onde a trava pode ficar para trás.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/empresas', exigirOperadorDoSaas, async (req, res) => {
  try {
    const tenants = await import('../services/ragnabot-tenant.service.js');
    const lista = await tenants.listarEmpresas({ status: req.query.status || null });
    return res.json(lista);
  } catch (e) { return erro(res, e, 500); }
});

router.get('/planos', exigirOperadorDoSaas, async (req, res) => {
  try {
    const cobranca = await import('../services/ragnabot-cobranca.service.js');
    const itens = await cobranca.listarPlanos({ incluirInativos: req.query.inativos === '1' });
    return res.json({ itens });
  } catch (e) { return erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. OS PAINÉIS DA EMPRESA (8.1, 8.2, 8.6 a 8.12)
//
// ⚠️ Toda leitura e toda escrita são POR EMPRESA. O `tenantId` sai de `escopoDe(user)` dentro do
// serviço, nunca do corpo nem da consulta — e por isso empresa A pedindo o painel de B recebe o
// painel DELA. O teste `ragnabot-configuracao.test.mjs` prova as duas pontas.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/paineis', exigeModelo, async (req, res) => {
  try {
    return res.json({ paineis: await lerTodosOsPaineisDaEmpresa(req.user, { tenantIdAlvo: req.query.empresa || null }) });
  } catch (e) { return erro(res, e); }
});

router.get('/painel/:painel', exigeModelo, async (req, res) => {
  const { painel } = req.params;
  // Whitelabel não é atendido por aqui — ele tem rota própria, atrás da trava do operador. Sem
  // esta linha, o painel do operador seria alcançável pelo endpoint genérico, e a trava viraria
  // enfeite. É o mesmo raciocínio que o serviço aplica em `CHAVE_DE_OUTRO_PAINEL`.
  if (painel === PAINEL_WHITELABEL) {
    if (!avaliarOperadorDoSaas(req.user).ok) {
      return res.status(403).json({
        error: 'SEM_PERMISSAO', code: 'NAO_E_OPERADOR_DO_SAAS',
        message: 'Este painel é da conta que opera o SaaS.',
      });
    }
  }
  try {
    return res.json(await lerPainel(req.user, painel, { tenantIdAlvo: req.query.empresa || null }));
  } catch (e) { return erro(res, e); }
});

router.put('/painel/:painel', exigeModelo, exigirAdmin, async (req, res) => {
  const { painel } = req.params;
  if (painel === PAINEL_WHITELABEL) {
    if (!avaliarOperadorDoSaas(req.user).ok) {
      return res.status(403).json({
        error: 'SEM_PERMISSAO', code: 'NAO_E_OPERADOR_DO_SAAS',
        message: 'Este painel é da conta que opera o SaaS.',
      });
    }
  }
  try {
    const alvo = req.query.empresa || req.body?.empresa || null;
    const r = await salvarPainel(req.user, painel, req.body?.valores || {}, { tenantIdAlvo: alvo });
    await auditarMudancas({ req, painel, tenantId: r.tenantId, mudancas: r.mudancas });
    return res.json({
      ...r,
      painelAtual: await lerPainel(req.user, painel, { tenantIdAlvo: alvo }),
    });
  } catch (e) { return erro(res, e); }
});

/** Diagnóstico: qual escopo ESTA chamada usaria. Existe porque "por que salvou na empresa errada?"
 *  é a pergunta que o suporte faz, e adivinhar escopo é o que faz a resposta demorar. */
router.get('/escopo/:painel', (req, res) => {
  try {
    return res.json(resolverEscopo(req.user, req.params.painel, { tenantIdAlvo: req.query.empresa || null }));
  } catch (e) { return erro(res, e); }
});

export default router;
