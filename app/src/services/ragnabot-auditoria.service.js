// ════════════════════════════════════════════════════════════════════════════════════════════════
// AUDITORIA POR USUÁRIO — quando mexer em config, logar, deslogar, IP, início/fim de atendimento.
//
// Ordem do dono: "auditoria geral por usuário em tudo"; e o ISOLAMENTO — admin da empresa vê "tudo
// da empresa dele — e nada das outras". O sistema antigo vazou por confiar na empresa que a TELA
// mandava. Aqui o filtro vem SEMPRE do escopo do usuário logado, calculado no servidor.
//
// REGRA DE OURO deste arquivo: nenhuma função de consulta aceita um tenantId "de fora" que amplie o
// alcance. O escopo é derivado do usuário; a tela só pode ESTREITAR (filtrar dentro do que já pode
// ver), nunca ALARGAR.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';

const CATEGORIAS = ['acesso', 'atendimento', 'configuracao', 'pessoas', 'dados'];

/**
 * Registra um evento. Chamado pelo webhook do Ragnabot, pela autenticação e por qualquer ponto que
 * mude configuração. Nunca lança para não derrubar o fluxo principal — auditoria que quebra a
 * operação é pior que auditoria ausente; falha é logada, não propagada.
 */
export async function registrar(evento) {
  try {
    const {
      tenantId = null, atorTipo = 'sistema', atorId = null, atorNome = null, atorEmail = null,
      categoria, acao, descricao = null, ip = null, userAgent = null,
      protocolo = null, entidade = null, entidadeId = null, antes = null, depois = null,
    } = evento || {};

    if (!acao) return null;
    const cat = CATEGORIAS.includes(categoria) ? categoria : 'configuracao';

    return await prisma.ragnabotAuditoria.create({
      data: {
        tenantId, atorTipo, atorId, atorNome, atorEmail,
        categoria: cat, acao, descricao,
        ip: ip ? String(ip).slice(0, 64) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
        protocolo, entidade, entidadeId, antes, depois,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ragnabot-auditoria] falha ao registrar:', e.message);
    return null;
  }
}

/**
 * Deriva o ESCOPO de leitura a partir do usuário logado. É a única fonte de verdade sobre o que
 * alguém pode ver — nada além disto amplia alcance.
 *
 * @param {object} user  usuário do NOC (req.user) ou contexto do admin de empresa
 * @returns {{ global:boolean, tenantId:(string|null) }}
 *   global=true  → super user do NOC: vê tudo, de todas as empresas.
 *   tenantId=X   → admin de empresa: vê SÓ a empresa X.
 */
export function escopoDe(user) {
  if (!user) return { global: false, tenantId: null };
  if (user.isSuperuser === true) return { global: true, tenantId: null };
  // Admin de empresa cliente: o vínculo com a empresa vem do usuário, nunca da tela.
  const tid = user.ragnabotTenantId || user.clientCompanyId || null;
  return { global: false, tenantId: tid };
}

/**
 * Consulta com filtros. `user` decide o ESCOPO (empresa); `filtros` só ESTREITA dentro dele.
 *
 * ⚠️ O `tenantId` de `filtros` é IGNORADO quando não-global, EXCETO para estreitar dentro do
 * próprio escopo. Um admin da empresa A que mandar `filtros.tenantId = B` continua vendo só A —
 * a cláusula de escopo prevalece. Isto é o que o teste de isolamento prova.
 */
export async function consultar(user, filtros = {}) {
  const escopo = escopoDe(user);

  // Admin sem empresa vinculada não vê NADA — falha fechada, não aberta.
  if (!escopo.global && !escopo.tenantId) {
    return { total: 0, itens: [], escopo, aviso: 'usuário sem empresa vinculada' };
  }

  const where = {};

  // Cláusula de ISOLAMENTO — a primeira e inegociável.
  if (!escopo.global) {
    where.tenantId = escopo.tenantId; // trava dura na empresa do usuário
  } else if (filtros.tenantId) {
    // Super user PODE estreitar por empresa, porque ele já pode ver todas.
    where.tenantId = String(filtros.tenantId);
  }

  // Filtros que apenas estreitam:
  if (filtros.categoria && CATEGORIAS.includes(filtros.categoria)) where.categoria = filtros.categoria;
  if (filtros.acao) where.acao = String(filtros.acao);
  if (filtros.atorId) where.atorId = String(filtros.atorId);
  if (filtros.ip) where.ip = String(filtros.ip);
  if (filtros.protocolo) where.protocolo = String(filtros.protocolo).toUpperCase();
  if (filtros.de || filtros.ate) {
    where.criadoEm = {};
    if (filtros.de) where.criadoEm.gte = new Date(filtros.de);
    if (filtros.ate) where.criadoEm.lte = new Date(filtros.ate);
  }

  const take = Math.min(Number(filtros.limite) || 200, 2000);
  const [total, itens] = await Promise.all([
    prisma.ragnabotAuditoria.count({ where }),
    prisma.ragnabotAuditoria.findMany({ where, orderBy: { criadoEm: 'desc' }, take }),
  ]);
  return { total, itens, escopo };
}

/** Dados para o PDF: os mesmos registros da consulta + o cabeçalho de filtros aplicados. */
export async function dadosParaRelatorio(user, filtros = {}) {
  const r = await consultar(user, { ...filtros, limite: filtros.limite || 2000 });
  return {
    geradoEm: new Date().toISOString(),
    escopo: r.escopo.global ? 'Todas as empresas' : r.escopo.tenantId,
    filtros: {
      periodo: [filtros.de || null, filtros.ate || null],
      categoria: filtros.categoria || null,
      acao: filtros.acao || null,
      ator: filtros.atorId || null,
      ip: filtros.ip || null,
      protocolo: filtros.protocolo || null,
    },
    total: r.total,
    registros: r.itens,
  };
}
