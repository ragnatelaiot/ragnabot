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
import { comoAdminDaEmpresa, comoAdminDaEmpresaMultipart } from './ragnabot-tenant.service.js';
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
export async function enviarMensagem({
  cwAccountId, cwConversationId, texto,
  privada = false, tipoConteudo = null, atributosConteudo = null,
} = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !texto) return false;
  const corpo = { content: texto, message_type: 'outgoing', private: privada === true };
  // `content_type` só viaja quando existe. Mandar `null` faz o Rails gravar o tipo como nulo em vez
  // de usar o padrão 'text', e a mensagem sai sem renderização em canal nenhum.
  if (tipoConteudo) corpo.content_type = tipoConteudo;
  if (atributosConteudo && Object.keys(atributosConteudo).length) corpo.content_attributes = atributosConteudo;
  const r = await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/messages`,
    corpo);
  // ⚠️ DEVOLVE OBJETO, não `true`. Quem chamava antes só testava veracidade (`r === false`), então
  // nada quebra — mas o motor PRECISA do id para gravar `RagnabotFluxoEfeito.idExterno`, que é o
  // que permite conciliar "esta mensagem saiu?" sem depender de adivinhação.
  return { ok: true, id: r?.id ?? r?.payload?.id ?? null, tipoConteudo: tipoConteudo || 'text' };
}

/**
 * Mensagem INTERATIVA (lista ou botões), no formato que o Chatwoot conhece: `content_type` =
 * `input_select` com `content_attributes.items`.
 *
 * ⚠️ NÃO MEDIDO EM PRODUÇÃO — e a distinção importa. Pelo código do Chatwoot 4.x, o provedor do
 * WhatsApp Cloud traduz `input_select` em mensagem interativa da Meta (botões até 3 itens, lista
 * acima disso) e o widget do site renderiza os itens como escolha. Facebook, Instagram e Telegram
 * NÃO têm essa tradução: lá a mensagem chegaria sem as opções. Quem decide se este caminho pode ser
 * usado é `ragnabot-canal.porta.js`, pela tabela de capacidade do canal — aqui só se sabe COMO
 * mandar, nunca SE pode.
 */
export async function enviarInterativo({
  cwAccountId, cwConversationId, corpo, itens = [], atributosConteudo = null,
} = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !corpo) return false;
  const lista = (Array.isArray(itens) ? itens : []).map((i) => ({
    title: String(i.titulo ?? i.rotulo ?? i.title ?? ''),
    // `value` é o que volta quando a pessoa toca. Guardamos o ID DO ITEM DO FLUXO, não o rótulo:
    // rótulo muda com a redação e a saída do nó não pode mudar junto.
    value: String(i.id ?? i.value ?? ''),
  })).filter((i) => i.title && i.value);
  return enviarMensagem({
    cwAccountId,
    cwConversationId,
    texto: corpo,
    tipoConteudo: 'input_select',
    atributosConteudo: { ...(atributosConteudo || {}), items: lista },
  });
}

/**
 * Anexo (imagem, vídeo, áudio, documento) a partir de uma URL https.
 *
 * A API do Chatwoot só aceita anexo como ARQUIVO em `multipart/form-data` — não existe campo de
 * URL. Então o caminho é: buscar o arquivo, respeitar um teto de bytes e repassar. O teto não é
 * zelo: sem ele, uma URL apontando para um arquivo de 2 GB derruba o processo por memória, e quem
 * escolhe a URL é quem edita o fluxo.
 *
 * ⚠️ Só https, e a conferência é REPETIDA aqui de propósito. O validador do nó já recusa http, mas
 * a intenção pode ser reconstruída de uma linha antiga de efeito, e um `http://` aqui viraria
 * requisição em claro saindo do nosso pod.
 */
export async function enviarAnexo({
  cwAccountId, cwConversationId, url, legenda = null, tetoBytes = 16 * 1024 * 1024, tempoLimiteMs = 20_000,
} = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  const endereco = String(url || '');
  if (!/^https:\/\//i.test(endereco)) {
    const e = new Error(`anexo recusado: a URL "${endereco.slice(0, 80)}" não é https`);
    e.status = 400;
    throw e;
  }

  const ctrl = new AbortController();
  const alarme = setTimeout(() => ctrl.abort(), tempoLimiteMs);
  let bytes;
  let mime;
  try {
    const r = await fetch(endereco, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) {
      const e = new Error(`não consegui buscar a mídia (${r.status}) em ${endereco.slice(0, 80)}`);
      e.status = r.status;
      throw e;
    }
    const declarado = Number(r.headers.get('content-length') || 0);
    if (declarado && declarado > tetoBytes) {
      const e = new Error(`a mídia tem ${declarado} bytes e o teto de envio é ${tetoBytes}`);
      e.status = 413;
      throw e;
    }
    mime = r.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await r.arrayBuffer());
    if (buffer.length > tetoBytes) {
      const e = new Error(`a mídia tem ${buffer.length} bytes e o teto de envio é ${tetoBytes}`);
      e.status = 413;
      throw e;
    }
    bytes = buffer;
  } finally {
    clearTimeout(alarme);
  }

  const nome = nomeDeArquivoDaUrl(endereco);
  const form = new FormData();
  // Legenda vai como `content` da MESMA mensagem: mandar duas mensagens (uma com o arquivo, outra
  // com o texto) faz o cliente receber a legenda antes ou depois da imagem, dependendo da fila do
  // canal — e a legenda de uma foto que chega sozinha não quer dizer nada.
  if (legenda) form.append('content', String(legenda));
  form.append('message_type', 'outgoing');
  form.append('private', 'false');
  form.append('attachments[]', new Blob([bytes], { type: mime }), nome);

  const r = await comoAdminDaEmpresaMultipart(tenantId,
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/messages`, form);
  return { ok: true, id: r?.id ?? r?.payload?.id ?? null, bytes: bytes.length, mime };
}

/** Nome do arquivo tirado da URL. Serve só para o anexo não chegar chamado "blob" na conversa. */
function nomeDeArquivoDaUrl(url) {
  try {
    const caminho = new URL(url).pathname;
    const bruto = decodeURIComponent(caminho.split('/').filter(Boolean).pop() || '');
    const limpo = bruto.replace(/[^\w.\-]/gu, '_').slice(0, 120);
    return limpo || 'anexo';
  } catch { return 'anexo'; }
}

/**
 * Aplica e remove etiquetas.
 *
 * ⚠️ A API do Chatwoot SUBSTITUI o conjunto inteiro (`POST /labels` recebe a lista final), não
 * acrescenta. Por isso lemos as atuais antes: mandar só as de `aplicar` APAGARIA as etiquetas que
 * o atendente pôs na mão — e isso é perda de trabalho de gente, em silêncio.
 */
export async function aplicarEtiquetas({ cwAccountId, cwConversationId, aplicar = [], remover = [] } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  const atual = await comoAdminDaEmpresa(tenantId, 'get',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/labels`);
  const atuais = Array.isArray(atual?.payload) ? atual.payload.map(String) : [];
  const tirar = new Set((remover || []).map(String));
  const finais = [...new Set([...atuais.filter((e) => !tirar.has(e)), ...(aplicar || []).map(String)])];
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/labels`,
    { labels: finais });
  return { ok: true, etiquetas: finais };
}

/** Transfere para uma PESSOA (não para o time). `null` devolve a conversa para a fila do time. */
export async function atribuirAgente({ cwAccountId, cwConversationId, cwAssigneeId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/assignments`,
    { assignee_id: cwAssigneeId ?? null });
  return { ok: true };
}

/**
 * Carimbo na conversa (atributos personalizados): por qual fluxo, por qual versão, qual protocolo.
 *
 * É CÓPIA, nunca a verdade — em divergência, o nosso banco manda. Existe para o atendente enxergar
 * por onde a pessoa passou MESMO COM O NOSSO MOTOR FORA DO AR.
 */
export async function carimbar({ cwAccountId, cwConversationId, atributos = {} } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return false;
  const limpos = {};
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v === null || v === undefined || v === '') continue;
    limpos[String(k)] = typeof v === 'object' ? JSON.stringify(v).slice(0, 500) : String(v).slice(0, 500);
  }
  if (!Object.keys(limpos).length) return { ok: true, carimbados: 0 };
  await comoAdminDaEmpresa(tenantId, 'post',
    (conta) => `/api/v1/accounts/${conta}/conversations/${cwConversationId}/custom_attributes`,
    { custom_attributes: limpos });
  return { ok: true, carimbados: Object.keys(limpos).length };
}

/** A caixa de entrada de uma conversa, com o tipo de canal — é o que decide botão × texto numerado.
 *  Devolve `null` quando não dá para saber; quem chama trata «não sei» como «o canal mais pobre». */
export async function caixaDaConversa({ cwAccountId, cwConversationId } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId) return null;
  const conversa = await lerConversa({ cwAccountId, cwConversationId });
  if (!conversa?.cwInboxId) return null;
  const caixa = await prisma.ragnabotInbox.findFirst({
    where: { tenantId, cwInboxId: conversa.cwInboxId, removedAt: null },
    select: { id: true, name: true, channelType: true, identifier: true, metadata: true },
  }).catch(() => null);
  return {
    tenantId,
    cwInboxId: conversa.cwInboxId,
    // Caixa que existe na plataforma e não no nosso banco é possível (conta que o NOC administra
    // mas cuja conexão foi criada direto lá). Dizer «desconhecido» é honesto; chutar «whatsapp»
    // mandaria botão para um canal que não sabe desenhar botão.
    channelType: caixa?.channelType || null,
    nome: caixa?.name || null,
    identificador: caixa?.identifier || null,
    phoneNumberId: caixa?.metadata && typeof caixa.metadata === 'object' ? (caixa.metadata.phoneNumberId ?? null) : null,
  };
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

/**
 * Acha um TIME pelo nome, quando o fluxo só guardou o nome e não o id.
 *
 * O nó `time` do motor aceita as duas formas (`config.timeId` e `config.time`), porque quem desenha
 * o fluxo escolhe o setor por nome numa lista. Sem esta tradução, todo fluxo desenhado por nome
 * falharia no despacho com "time sem id" — e o cliente ficaria sem transferência por um detalhe de
 * cadastro. A comparação ignora caixa e espaços das pontas: «Suporte » e «suporte» são o mesmo
 * setor para quem digitou.
 */
export async function timePorNome({ cwAccountId, nome } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !nome) return null;
  const alvo = String(nome).trim().toLocaleLowerCase('pt-BR');
  const r = await comoAdminDaEmpresa(tenantId, 'get', (conta) => `/api/v1/accounts/${conta}/teams`);
  const lista = Array.isArray(r?.payload) ? r.payload : (Array.isArray(r) ? r : []);
  const achado = lista.find((t) => String(t?.name ?? '').trim().toLocaleLowerCase('pt-BR') === alvo);
  return achado ? { id: achado.id, nome: achado.name } : null;
}

/**
 * Endereços de e-mail de um destinatário NOMEADO do nó `notificar` (`{tipo, valor}`), onde `tipo` é
 * `papel`, `time` ou `usuario`.
 *
 * ⚠️ POR QUE NOMEADO E NÃO CRAVADO: o fluxo medido no bot atual tinha DOIS celulares escritos dentro
 * do nó, um deles com espaço no fim. Trocar de plantonista exigia editar o fluxo — e quem esquecia
 * mandava aviso para quem saiu da empresa. Resolver aqui, em tempo de execução, é o que faz o aviso
 * seguir o cadastro.
 */
export async function enderecosDoDestinatario({ cwAccountId, destinatario } = {}) {
  const tenantId = await empresaDaConta(cwAccountId);
  if (!tenantId || !destinatario?.tipo) return [];
  const tipo = String(destinatario.tipo);
  const valor = String(destinatario.valor ?? '').trim();
  if (!valor) return [];

  const agentes = await comoAdminDaEmpresa(tenantId, 'get', (conta) => `/api/v1/accounts/${conta}/agents`);
  const todos = (Array.isArray(agentes?.payload) ? agentes.payload : (Array.isArray(agentes) ? agentes : []))
    .map((a) => ({ id: a?.id, email: a?.email, papel: a?.role, nome: a?.name }))
    .filter((a) => a.email);

  if (tipo === 'papel') {
    const p = valor.toLocaleLowerCase('pt-BR');
    // `administrator`/`agent` é o vocabulário da plataforma; `admin`/`atendente` é o da nossa tela.
    const equivalentes = { admin: 'administrator', administrador: 'administrator', atendente: 'agent', agente: 'agent' };
    const alvo = equivalentes[p] || p;
    return todos.filter((a) => String(a.papel || '').toLocaleLowerCase('pt-BR') === alvo).map((a) => a.email);
  }
  if (tipo === 'usuario') {
    return todos.filter((a) => String(a.id) === valor || String(a.email).toLocaleLowerCase('pt-BR') === valor.toLocaleLowerCase('pt-BR')).map((a) => a.email);
  }
  if (tipo === 'time') {
    let timeId = /^\d+$/.test(valor) ? valor : null;
    if (!timeId) timeId = (await timePorNome({ cwAccountId, nome: valor }))?.id ?? null;
    if (!timeId) return [];
    const r = await comoAdminDaEmpresa(tenantId, 'get',
      (conta) => `/api/v1/accounts/${conta}/teams/${timeId}/team_members`);
    const membros = Array.isArray(r?.payload) ? r.payload : (Array.isArray(r) ? r : []);
    return membros.map((m) => m?.email).filter(Boolean);
  }
  return [];
}

/** Limpa o cache de conta→empresa. Existe para o teste, e para depois de provisionar empresa. */
export function esquecerCache() { cache.clear(); }

export default {
  conversasEmAtendimento, lerConversa, devolverParaFila, transferirTime,
  resolver, enviarMensagem, notaInterna, esquecerCache,
  // Acrescentados pelo contrato S-ADAPTADOR (02/09/2026): é o que a `PortaCanal` do motor precisa
  // para despachar as intenções dos nós — antes disto o motor montava a mensagem e ninguém a levava.
  enviarInterativo, enviarAnexo, aplicarEtiquetas, atribuirAgente, carimbar, caixaDaConversa,
  timePorNome, enderecosDoDestinatario,
};
