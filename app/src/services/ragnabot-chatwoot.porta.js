// ════════════════════════════════════════════════════════════════════════════════════════════════
// PORTA DO CHATWOOT — o que as automações de atendimento sabem fazer com uma conversa.
//
// POR QUE EXISTE COMO "PORTA": o trabalhador de automações (`ragnabot-atendimento-worker`) decide
// QUANDO agir; este arquivo sabe COMO agir. A separação não é enfeite — é o que permitiu testar
// todas as regras de tempo (expediente, intervalo, feriado, inatividade) contra um dublê, sem
// plataforma no ar. Sem porta, o trabalhador degrada com aviso e não quebra; com esta porta, ele
// passa a agir de verdade.
//
// ⚠️ NÃO ESTÁ EXERCITADO EM PRODUÇÃO. Em 29/08/2026 o Ragnabot tem ZERO caixas de WhatsApp e zero
// conversas — não existe onde exercitar. O código aqui é correto por construção e pelo contrato
// medido da API do Chatwoot 4.17.1, NÃO por observação. O primeiro atendimento real é o ensaio.
//
// O ENDEREÇAMENTO TEM DUAS FACES, e confundi-las é o erro clássico:
//   · `cwAccountId` é o número da conta NA PLATAFORMA (o que aparece na URL do Chatwoot);
//   · `tenantId` é o id da empresa NO NOC (uuid).
// O trabalhador varre por `cwAccountId` (é o que ele tem na política). O acesso à API exige o
// token do admin DAQUELA empresa, que só se acha pelo `tenantId`. A tradução entre os dois é feita
// aqui, uma vez por rodada, com cache curto — ver `empresaDaConta`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';
import { comoAdminDaEmpresa } from './ragnabot-tenant.service.js';
import logger from '../base/logger.js';

// Cache de conta→empresa. Curto de propósito: uma empresa nova provisionada no meio da rodada
// precisa ser vista sem esperar reinício, e a consulta é barata (índice único em cwAccountId).
const CACHE_MS = 60_000;
const cache = new Map(); // cwAccountId -> { tenantId, quando }

async function empresaDaConta(cwAccountId) {
  const agora = Date.now();
  const guardado = cache.get(cwAccountId);
  if (guardado && agora - guardado.quando < CACHE_MS) return guardado.tenantId;

  const t = await prisma.ragnabotTenant.findUnique({ where: { cwAccountId }, select: { id: true } });
  if (!t) {
    // Não é exceção: pode existir conta na plataforma que o NOC não administra. Quem chama trata
    // como "não sei agir nesta conta" e segue para a próxima.
    cache.set(cwAccountId, { tenantId: null, quando: agora });
    return null;
  }
  cache.set(cwAccountId, { tenantId: t.id, quando: agora });
  return t.id;
}

/** Converte data da API (string ISO ou epoch em SEGUNDOS) em Date. Nulo continua nulo. */
function paraData(v) {
  if (v === null || v === undefined || v === '') return null;
  // O Chatwoot devolve alguns carimbos como epoch em SEGUNDOS (não milissegundos). Multiplicar por
  // 1000 é o que separa "hoje" de "20 de janeiro de 1970" — e um relógio de inatividade lendo 1970
  // dispararia em TODAS as conversas de uma vez.
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Traduz a conversa da API para o formato que o trabalhador conhece (`ConversaCw`). */
function normalizarConversa(c, cwAccountId) {
  if (!c) return null;
  const meta = c.meta || {};
  return {
    id: c.id,
    cwAccountId,
    cwInboxId: c.inbox_id ?? null,
    cwTeamId: c.team_id ?? meta.team?.id ?? null,
    cwAssigneeId: c.assignee_id ?? meta.assignee?.id ?? null,
    status: c.status || null,
    waitingSince: paraData(c.waiting_since),
    lastActivityAt: paraData(c.last_activity_at),
    firstReplyCreatedAt: paraData(c.first_reply_created_at),
    statusChangedAt: paraData(c.status_changed_at ?? c.updated_at),
  };
}

/**
 * Conversas que estão SENDO ATENDIDAS numa conta — as `open` com atendente.
 *
 * ⚠️ DEFEITO REAL CORRIGIDO EM 29/08/2026 (auditoria adversarial, 3 céticos, 0 refutações).
 * Esta função listava SÓ `status=open`, com o argumento de que "`pending` já está na fila e não tem
 * relógio de inatividade para correr". O argumento estava errado por metade: inatividade de fato
 * não corre na fila, mas o **TRANSBORDO** corre — `alvosDeRelogio` arma o transbordo justamente
 * para `status === 'pending'` (ou `open` sem responsável), e a **virada de expediente** também
 * aceita `pending`.
 *
 * O buraco era circular e permanente: a própria ação `devolver_fila` põe a conversa em `pending`;
 * a partir daí ela sumia desta varredura para SEMPRE — nenhum transbordo era armado, ninguém era
 * transferido depois de N minutos na fila, e a mensagem de virada nunca a alcançava.
 *
 * `resolved` e `snoozed` continuam de fora, e aí o argumento vale: uma acabou, a outra foi adiada
 * por um humano de propósito.
 *
 * A paginação da API é de 25 por página e não há como pedir mais; por isso o laço, com um teto.
 */
const ESTADOS_VARRIDOS = ['open', 'pending'];

export async function conversasEmAtendimento({ cwAccountId, limite = 100 } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return [];

  const achadas = [];
  // Uma varredura por estado: o parâmetro `status` da API aceita um valor só, e pedir `all` traria
  // resolvidas e adiadas — desperdício de página num teto que já é curto.
  for (const estado of ESTADOS_VARRIDOS) {
    for (let pagina = 1; achadas.length < limite && pagina <= 20; pagina += 1) {
      let r;
      try {
        r = await comoAdminDaEmpresa(tenantId, 'get',
          (conta) => `/api/v1/accounts/${conta}/conversations?status=${estado}&page=${pagina}&sort_by=last_activity_at`);
      } catch (e) {
        logger.warn(`[cw-porta] conta ${cwAccountId} estado ${estado} página ${pagina}: ${e.message.slice(0, 160)}`);
        break;
      }
      const lote = r?.data?.payload || r?.payload || [];
      if (!lote.length) break;
      for (const c of lote) achadas.push(normalizarConversa(c, cwAccountId));
      if (lote.length < 25) break; // última página deste estado
    }
  }
  return achadas.slice(0, limite);
}

/** Lê UMA conversa. Devolve nulo se ela sumiu — apagada ou de conta que o NOC não administra. */
export async function lerConversa({ cwAccountId, cwConversationId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return null;
  try {
    const r = await comoAdminDaEmpresa(tenantId, 'get',
      (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}`);
    return normalizarConversa(r?.payload || r, cwAccountId);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * Devolve a conversa para a fila: status `pending` e SEM atendente.
 *
 * Os dois passos importam, e nesta ordem. Só mudar o status deixaria a conversa "aguardando" com
 * o nome do atendente antigo colado nela — que é justamente o que o dono não consegue desfazer
 * hoje na ferramenta atual. Tirar o atendente é o que devolve a conversa para o time.
 */
export async function devolverParaFila({ cwAccountId, cwConversationId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/toggle_status`,
    { status: 'pending' });
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/assignments`,
    { assignee_id: null });
  return true;
}

/**
 * Transfere a conversa para um TIME — a operação que o dono não consegue fazer hoje.
 *
 * `assignee_id: null` junto é deliberado: transferir para um time mantendo o atendente anterior
 * não é transferência, é etiqueta. Quem recebe precisa encontrar a conversa livre na fila do time.
 */
export async function transferirTime({ cwAccountId, cwConversationId, cwTeamId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !cwTeamId) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/assignments`,
    { team_id: cwTeamId, assignee_id: null });
  return true;
}

/** Marca a conversa como resolvida. */
export async function resolver({ cwAccountId, cwConversationId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/toggle_status`,
    { status: 'resolved' });
  return true;
}

/**
 * Manda mensagem AO CLIENTE.
 *
 * ⚠️ Sujeita à janela de 24 h do WhatsApp: fora dela a plataforma recusa, e recusar é o certo. Por
 * isso a ação de ESTADO (devolver para a fila, resolver) nunca depende do sucesso daqui — a regra
 * §5.6 diz que o estado muda e a mensagem não, com o motivo registrado em nota interna.
 */
export async function enviarMensagem({ cwAccountId, cwConversationId, texto } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !texto) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/messages`,
    { content: texto, message_type: 'outgoing', private: false });
  return true;
}

/**
 * Nota interna: aparece só para a equipe, nunca para o cliente, e NÃO passa pela janela de 24 h.
 * É onde fica o registro de "por que esta conversa voltou para a fila sozinha".
 */
export async function notaInterna({ cwAccountId, cwConversationId, texto } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !texto) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/messages`,
    { content: texto, message_type: 'outgoing', private: true });
  return true;
}

/** Limpa o cache de conta→empresa. Existe para o teste, e para depois de provisionar empresa. */
export function esquecerCache() { cache.clear(); }

export default {
  conversasEmAtendimento, lerConversa, devolverParaFila, transferirTime,
  resolver, enviarMensagem, notaInterna, esquecerCache,
};
