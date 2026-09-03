// ════════════════════════════════════════════════════════════════════════════════════════════════
// WEBHOOK DE SAÍDA — o Ragnabot avisando o sistema do cliente  ·  contrato S6, doc 34 §F9.4.2-9.4.4
//
// ── O QUE FOI MEDIDO ANTES DE ESCREVER ──────────────────────────────────────────────────────────
// O padrão do portal do chat atual (doc 34 §F9.4): `Authorization: Bearer <token>` no cabeçalho e
// `X-Hub-Signature-256: sha256=<hex>` com HMAC-SHA256 do corpo. É o MESMO da Meta — e a ordem do
// contrato foi explícita: *"reaproveite, não reescreva"*. Reaproveitado: `src/base/assinatura.js`,
// que nasceu da conferência que já existia embutida em `ragnabot-cobranca.routes.js` e agora serve
// aos DOIS sentidos (o webhook de cobrança passou a chamá-lo também).
//
// ── ⚠️ A FUNCIONALIDADE É A FILA, NÃO O `fetch` ────────────────────────────────────────────────
// Mandar um POST é trivial. O que faz um webhook servir para alguma coisa é o que acontece quando
// o destino está fora: sem reentrega, o evento some em silêncio — e «em silêncio» é o pior jeito de
// perder informação, porque ninguém procura o que não sabe que faltou.
// Desenho, e ele é DELIBERADAMENTE o mesmo de `RagnabotAtendRelogio` e `RagnabotAgendamentoEnvio`:
//   A LINHA É A VERDADE, O LAÇO É O CARTEIRO. A próxima tentativa é uma COLUNA (`proximaEm`), não
//   um `setTimeout`. Reiniciar o pod não perde nada; duas réplicas não brigam, porque quem entrega
//   é quem consegue marcar a linha primeiro.
//
// ── AS CINCO REGRAS ─────────────────────────────────────────────────────────────────────────────
// R-1. IDEMPOTÊNCIA DE BANCO. `chave = sha256(webhookId|evento|idDoEvento)` com índice ÚNICO. O
//      enfileiramento tolera colisão (`DO NOTHING`): o mesmo fato reprocessado não vira duas
//      entregas. Não é um `if` em memória — é o Postgres recusando, e por isso vale entre réplicas.
// R-2. O CORPO É GRAVADO UMA VEZ E REENVIADO IGUAL. Remontar entre tentativas mudaria a ASSINATURA
//      (a ordem das chaves do JSON basta), e o destino receberia a mesma entrega assinada de dois
//      jeitos — impossível de conciliar do lado dele.
// R-3. RECUO EXPONENCIAL COM TETO, e a função é PURA (`recuoMs`), medida sem relógio e sem rede.
// R-4. DESISTÊNCIA NÃO SE REPETE SOZINHA. Esgotadas as tentativas, a entrega vira `desistiu` com o
//      motivo escrito e só um humano manda reenviar — a MESMA decisão registrada no agendamento
//      (S4) e na caixa de saída do motor. O preço é assumido: um destino fora por muito tempo
//      exige ação humana. O preço do contrário seria uma fila que nunca esvazia.
// R-5. DISJUNTOR POR DESTINO. Destino que falha seguidamente entra em repouso (`pausadoAte`), para
//      não consumir a passada inteira. O repouso é do DESTINO; a fila continua guardando os fatos.
//
// ── ⛔ O QUE ESTE ARQUIVO NÃO FAZ ──────────────────────────────────────────────────────────────
// • NÃO liga sozinho. `iniciarCarteiro()` existe e NÃO é chamado por padrão — em 02/09/2026 não há
//   webhook cadastrado e o executor de fluxo está desligado por decisão do chefe. Ligar é decisão
//   dele, e o motivo está no relatório, não escondido num `if (process.env)`.
// • NÃO valida o destino contra lista de permissão. `RagnabotFluxoDestinoPermitido` existe para o
//   nó `http` (URL escrita por quem desenha o fluxo). Aqui a URL é cadastrada pelo ADMINISTRADOR da
//   empresa, num portão com 2FA — categoria diferente. Ainda assim, `validarUrl()` recusa esquema
//   que não seja https e endereço de rede interna: administrador enganado também aponta webhook
//   para 169.254.169.254, e esse é o mesmo tiro no pé com outra arma.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import { encrypt, decrypt } from '../base/crypto.js';
import {
  CABECALHO_ASSINATURA, assinar, digitalDoSegredo, novoSegredo,
} from '../base/assinatura.js';

/** Os eventos que o Ragnabot sabe emitir. Lista fechada de propósito: evento inventado por quem
 *  chama vira contrato que ninguém documentou e que o cliente passa a depender. */
export const EVENTOS = Object.freeze([
  'conversa.criada',
  'conversa.atribuida',
  'conversa.resolvida',
  'mensagem.recebida',
  'mensagem.enviada',
  'conexao.estado',
  'conexao.transferencia',
  'agendamento.enviado',
]);

/** Recuo: 30 s · 2 min · 8 min · 32 min · 2 h · 6 h (teto). São 6 tentativas cobrindo ~9 h — tempo
 *  de sobra para um destino voltar de uma manutenção, sem deixar a fila viva por dias. */
export const RECUOS_MS = Object.freeze([30_000, 120_000, 480_000, 1_920_000, 7_200_000, 21_600_000]);
export const TETO_RECUO_MS = 21_600_000; // 6 h
export const MAX_TENTATIVAS_PADRAO = 6;

/** Depois de tantas falhas seguidas, o destino descansa. */
export const FALHAS_PARA_PAUSAR = 5;
export const PAUSA_MS = 900_000; // 15 min

// ── PORTAS INJETÁVEIS ──────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaPadrao,
  log: loggerPadrao,
  agora: () => new Date(),
  /** Quem fala com a rede. Trocável no teste — é a única porta que sai da máquina. */
  buscar: (...args) => globalThis.fetch(...args),
  /** `ragnabot-auditoria.service.js`. Injetável para o teste não escrever no banco de verdade. */
  auditoria: null,
};

export function configurarWebhookSaida(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no webhook de saída: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoWebhookSaida() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log || loggerPadrao;
const agora = () => portas.agora();

export function disponivel() {
  return typeof db()?.ragnabotWebhookSaida?.findMany === 'function'
    && typeof db()?.ragnabotWebhookEntrega?.findMany === 'function';
}
function exigirModelo() {
  if (!disponivel()) {
    const e = new Error('As tabelas de webhook de saída ainda não existem nesta instalação. '
      + 'Aplique prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql e reinicie o processo.');
    e.code = 'MODELO_AUSENTE'; e.status = 503;
    throw e;
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PEÇAS PURAS — mediveis sem banco, sem rede e sem relógio
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Quanto esperar antes da tentativa nº `tentativa` (1 = a primeira repetição, após a falha nº 1).
 * Exponencial com TETO. O teto não é enfeite: sem ele, a 12ª tentativa cairia daqui a 40 dias, o
 * que na prática é «nunca», e a linha ficaria viva ocupando índice para sempre.
 */
export function recuoMs(tentativa) {
  const n = Math.max(1, Math.floor(Number(tentativa) || 1));
  if (n <= RECUOS_MS.length) return RECUOS_MS[n - 1];
  return TETO_RECUO_MS;
}

/** A chave de idempotência. Determinística e sem relógio — é o que faz o mesmo fato colidir. */
export function chaveDaEntrega(webhookId, evento, idDoEvento) {
  return crypto.createHash('sha256')
    .update(`${webhookId}|${evento}|${idDoEvento}`)
    .digest('hex');
}

/**
 * Este webhook quer este evento, desta conexão?
 * `eventos: []` = todos. `cwInboxId: null` = todas as conexões.
 */
export function interessa(webhook, evento, cwInboxId = null) {
  if (!webhook || webhook.ativo !== true || webhook.removidoEm) return false;
  const lista = Array.isArray(webhook.eventos) ? webhook.eventos : [];
  if (lista.length && !lista.includes(evento)) return false;
  if (webhook.cwInboxId != null && cwInboxId != null && Number(webhook.cwInboxId) !== Number(cwInboxId)) return false;
  // Webhook preso a UMA conexão não recebe evento que não tem conexão (ex.: um relatório global):
  // ele pediu uma linha específica, e mandar o que não é dela é ruído que o cliente não pediu.
  if (webhook.cwInboxId != null && cwInboxId == null) return false;
  return true;
}

/**
 * Recusa URL que não deve virar webhook.
 * @returns {{ok:true, url:URL} | {ok:false, motivo:string}}
 */
export function validarUrl(bruta) {
  let u;
  try { u = new URL(String(bruta || '')); } catch { return { ok: false, motivo: 'Endereço inválido — informe uma URL completa, começando por https://.' }; }
  if (u.protocol !== 'https:') {
    return { ok: false, motivo: 'Só aceitamos https. Em http a assinatura protege o conteúdo de adulteração, mas não de leitura — e o corpo carrega dado de atendimento.' };
  }
  const host = u.hostname.toLowerCase();
  const interno = host === 'localhost' || host === '::1'
    || /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
    || /^169\.254\./u.test(host) // metadados de nuvem — o clássico
    || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.svc') || host.endsWith('.cluster.local');
  if (interno) {
    return { ok: false, motivo: `O endereço "${host}" é da rede interna. Webhook de saída aponta para o sistema do cliente, na internet — apontá-lo para dentro transformaria o cadastro numa sonda da nossa própria rede.` };
  }
  return { ok: true, url: u };
}

/** O que sai no corpo. Envelope estável — quem integra escreve o leitor uma vez só. */
export function montarCorpo({ evento, idDoEvento, tenantId, cwInboxId = null, dados = {}, quando = null }) {
  return {
    evento,
    id: idDoEvento,
    empresa: tenantId,
    conexao: cwInboxId ?? null,
    emitidoEm: (quando || new Date()).toISOString(),
    dados,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CADASTRO DOS DESTINOS
// ════════════════════════════════════════════════════════════════════════════════════════════════

export function comoPublico(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    tenantId: linha.tenantId,
    nome: linha.nome,
    url: linha.url,
    eventos: linha.eventos || [],
    cwInboxId: linha.cwInboxId ?? null,
    digital: linha.segredoDigital, // ⛔ nunca o segredo
    ativo: linha.ativo === true && !linha.removidoEm,
    removidoEm: linha.removidoEm || null,
    falhasSeguidas: linha.falhasSeguidas ?? 0,
    pausadoAte: linha.pausadoAte || null,
    ultimaEntregaEm: linha.ultimaEntregaEm || null,
    ultimoStatus: linha.ultimoStatus ?? null,
    ultimoErro: linha.ultimoErro || null,
    criadoEm: linha.criadoEm,
  };
}

function validarEventos(lista) {
  const brutos = Array.isArray(lista) ? lista : [];
  const limpos = [...new Set(brutos.map((e) => String(e || '').trim()))].filter(Boolean);
  const desconhecido = limpos.find((e) => !EVENTOS.includes(e));
  if (desconhecido) {
    const e = new Error(`Evento "${desconhecido}" não existe. Conhecidos: ${EVENTOS.join(', ')}.`);
    e.status = 400;
    throw e;
  }
  return limpos;
}

/** Cadastra um destino. Devolve o segredo em CLARO uma única vez — igual à credencial de API. */
export async function cadastrarWebhook(tenantId, { nome, url, eventos = [], cwInboxId = null } = {}, { ator = null, req = null } = {}) {
  exigirModelo();
  const t = String(tenantId || '').trim();
  if (!t) { const e = new Error('Empresa não informada.'); e.status = 400; throw e; }
  const rotulo = String(nome || '').trim();
  if (rotulo.length < 2 || rotulo.length > 80) { const e = new Error('Dê um nome ao webhook (2 a 80 caracteres).'); e.status = 400; throw e; }
  const veredito = validarUrl(url);
  if (!veredito.ok) { const e = new Error(veredito.motivo); e.status = 400; throw e; }
  const listaEventos = validarEventos(eventos);

  const segredo = novoSegredo();
  const linha = await db().ragnabotWebhookSaida.create({
    data: {
      tenantId: t, nome: rotulo, url: veredito.url.toString(),
      eventos: listaEventos,
      cwInboxId: cwInboxId == null ? null : Number(cwInboxId),
      segredoCifrado: encrypt(segredo),
      segredoDigital: digitalDoSegredo(segredo),
      // Escritos à mão pela mesma razão da credencial de API: bandeira de operação não pode
      // depender de o `@default` do banco estar como esperamos.
      ativo: true,
      falhasSeguidas: 0,
      removidoEm: null,
      criadoPorUserId: ator?.id || null,
    },
  });
  log().info?.(`[webhook-saida] destino "${rotulo}" cadastrado para a empresa ${t} — ${veredito.url.origin}${veredito.url.pathname}, digital ${linha.segredoDigital}`);
  await auditar({ tenantId: t, ator, req, acao: 'ragnabot.webhook.cadastrar', entidadeId: linha.id,
    descricao: `Webhook de saída "${rotulo}" cadastrado para ${veredito.url.origin}${veredito.url.pathname}`,
    depois: { url: linha.url, eventos: listaEventos, digital: linha.segredoDigital } });
  return { webhook: comoPublico(linha), segredo };
}

export async function listarWebhooks(tenantId, { incluirRemovidos = false } = {}) {
  exigirModelo();
  const where = { tenantId: String(tenantId || '') };
  if (!incluirRemovidos) where.removidoEm = null;
  const linhas = await db().ragnabotWebhookSaida.findMany({ where, orderBy: [{ ativo: 'desc' }, { criadoEm: 'desc' }] });
  return linhas.map(comoPublico);
}

async function exigirWebhook(tenantId, id) {
  const linha = await db().ragnabotWebhookSaida.findFirst({ where: { id: String(id || ''), tenantId: String(tenantId || '') } });
  if (!linha) { const e = new Error('Webhook não encontrado.'); e.code = 'WEBHOOK_NAO_ENCONTRADO'; e.status = 404; throw e; }
  return linha;
}

/** Regenera o segredo do destino. Igual à credencial de API: a assinatura antiga deixa de conferir
 *  IMEDIATAMENTE — que é o ponto de regenerar. */
export async function regenerarSegredoDoWebhook(tenantId, id, { ator = null, req = null } = {}) {
  exigirModelo();
  const antigo = await exigirWebhook(tenantId, id);
  const segredo = novoSegredo();
  const linha = await db().ragnabotWebhookSaida.update({
    where: { id: antigo.id },
    data: { segredoCifrado: encrypt(segredo), segredoDigital: digitalDoSegredo(segredo) },
  });
  log().warn?.(`[webhook-saida] segredo do destino ${antigo.id} regenerado (digital ${antigo.segredoDigital} → ${linha.segredoDigital}) — assinaturas antigas deixam de conferir agora`);
  await auditar({ tenantId, ator, req, acao: 'ragnabot.webhook.regenerar', entidadeId: antigo.id,
    descricao: `Segredo do webhook "${antigo.nome}" regenerado — a assinatura anterior deixou de valer`,
    antes: { digital: antigo.segredoDigital }, depois: { digital: linha.segredoDigital } });
  return { webhook: comoPublico(linha), segredo };
}

export async function alterarWebhook(tenantId, id, mudancas = {}, { ator = null, req = null } = {}) {
  exigirModelo();
  const antigo = await exigirWebhook(tenantId, id);
  const data = {};
  if (mudancas.nome !== undefined) data.nome = String(mudancas.nome).trim().slice(0, 80);
  if (mudancas.url !== undefined) {
    const v = validarUrl(mudancas.url);
    if (!v.ok) { const e = new Error(v.motivo); e.status = 400; throw e; }
    data.url = v.url.toString();
  }
  if (mudancas.eventos !== undefined) data.eventos = validarEventos(mudancas.eventos);
  if (mudancas.cwInboxId !== undefined) data.cwInboxId = mudancas.cwInboxId == null ? null : Number(mudancas.cwInboxId);
  if (mudancas.ativo !== undefined) {
    data.ativo = mudancas.ativo === true;
    // Reativar zera o disjuntor: quem religou o destino está afirmando que ele voltou.
    if (data.ativo) { data.falhasSeguidas = 0; data.pausadoAte = null; }
  }
  const linha = await db().ragnabotWebhookSaida.update({ where: { id: antigo.id }, data });
  await auditar({ tenantId, ator, req, acao: 'ragnabot.webhook.alterar', entidadeId: antigo.id,
    descricao: `Webhook "${antigo.nome}" alterado`, antes: comoPublico(antigo), depois: comoPublico(linha) });
  return comoPublico(linha);
}

/** Remove (marca). Nunca apaga: as entregas apontariam para o nada e o histórico morreria junto. */
export async function removerWebhook(tenantId, id, { ator = null, req = null } = {}) {
  exigirModelo();
  const antigo = await exigirWebhook(tenantId, id);
  const linha = await db().ragnabotWebhookSaida.update({
    where: { id: antigo.id }, data: { ativo: false, removidoEm: agora() },
  });
  await auditar({ tenantId, ator, req, acao: 'ragnabot.webhook.remover', entidadeId: antigo.id,
    descricao: `Webhook "${antigo.nome}" removido`, antes: { ativo: true }, depois: { ativo: false } });
  return comoPublico(linha);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENFILEIRAR
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Enfileira um fato para todos os destinos interessados da empresa.
 *
 * @param {string} tenantId
 * @param {string} evento     um de EVENTOS
 * @param {object} opcoes
 * @param {string} opcoes.idDoEvento  o id do fato NO NOSSO LADO. É ele que torna a chave estável —
 *   e é por isso que ele é OBRIGATÓRIO: sem um id do fato, «o mesmo evento» não existe, e a
 *   idempotência vira decoração.
 * @returns {{enfileiradas:number, repetidas:number, destinos:number}}
 */
export async function enfileirar(tenantId, evento, { idDoEvento, cwInboxId = null, dados = {} } = {}) {
  exigirModelo();
  if (!EVENTOS.includes(evento)) {
    const e = new Error(`Evento "${evento}" não existe. Conhecidos: ${EVENTOS.join(', ')}.`);
    e.status = 400;
    throw e;
  }
  const id = String(idDoEvento || '').trim();
  if (!id) {
    const e = new Error('Evento sem identificador do fato — sem ele a entrega não é idempotente e o destino recebe repetido.');
    e.status = 400;
    throw e;
  }

  const destinos = await db().ragnabotWebhookSaida.findMany({
    where: { tenantId: String(tenantId || ''), ativo: true, removidoEm: null },
  });
  const interessados = destinos.filter((w) => interessa(w, evento, cwInboxId));
  const quando = agora();
  const corpo = montarCorpo({ evento, idDoEvento: id, tenantId, cwInboxId, dados, quando });

  let enfileiradas = 0; let repetidas = 0;
  for (const w of interessados) {
    const chave = chaveDaEntrega(w.id, evento, id);
    try {
      await db().ragnabotWebhookEntrega.create({
        data: {
          webhookId: w.id, tenantId: w.tenantId, evento, idDoEvento: id, chave,
          corpo, proximaEm: quando, maxTentativas: MAX_TENTATIVAS_PADRAO,
          estado: 'pendente', tentativa: 0,
        },
      });
      enfileiradas++;
    } catch (e) {
      // P2002 = já havia entrega para este par (webhook, fato). É o caminho FELIZ da idempotência,
      // não um erro — e por isso ele é contado, não logado como falha.
      if (e?.code === 'P2002') { repetidas++; continue; }
      log().error?.(`[webhook-saida] não consegui enfileirar ${evento} para o destino ${w.id}: ${e.message}`);
      throw e;
    }
  }
  return { enfileiradas, repetidas, destinos: interessados.length };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTREGAR
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Aparado e sem segredo. Corpo de terceiro pode carregar dado pessoal — guardamos o mínimo. */
function resumirResposta(texto) {
  if (!texto) return null;
  return String(texto).replace(/\s+/gu, ' ').trim().slice(0, 200);
}

/**
 * Entrega UMA linha. Separada do laço para poder ser medida sozinha.
 * ⚠️ Não lança por falha de rede: falha de entrega é ESTADO da linha, não exceção do processo.
 */
export async function entregarUma(entrega, { webhook = null, timeoutMs = 10_000 } = {}) {
  exigirModelo();
  const w = webhook || await db().ragnabotWebhookSaida.findUnique({ where: { id: entrega.webhookId } });
  if (!w) {
    await db().ragnabotWebhookEntrega.update({
      where: { id: entrega.id },
      data: { estado: 'desistiu', erro: 'o destino foi apagado do cadastro' },
    });
    return { ok: false, estado: 'desistiu', motivo: 'destino inexistente' };
  }

  let segredo = '';
  try { segredo = decrypt(w.segredoCifrado); } catch {
    log().error?.(`[webhook-saida] o segredo do destino ${w.id} não decifra — confira ENCRYPTION_KEY`);
    return await marcarFalha(entrega, w, { erro: 'segredo do destino não decifra nesta instalação', status: null });
  }

  // R-2: assina o corpo GRAVADO, e envia EXATAMENTE os bytes assinados.
  const { assinatura, corpo } = assinar(segredo, entrega.corpo);
  const inicio = Date.now();
  let resposta = null; let erro = null;
  try {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), timeoutMs);
    try {
      resposta = await portas.buscar(w.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // O segredo TAMBÉM vai como portador, porque é o padrão que o cliente já conhece do
          // portal medido. Quem prefere só a assinatura pode ignorar o cabeçalho — mas quem só
          // sabe conferir portador não fica de fora.
          authorization: `Bearer ${segredo}`,
          [CABECALHO_ASSINATURA]: assinatura,
          'x-ragnabot-evento': entrega.evento,
          'x-ragnabot-entrega': entrega.id,
          'x-ragnabot-tentativa': String((entrega.tentativa ?? 0) + 1),
          'user-agent': 'Ragnabot-Webhook/1',
        },
        body: corpo,
        signal: controle.signal,
      });
    } finally { clearTimeout(relogio); }
  } catch (e) {
    erro = e?.name === 'AbortError' ? `sem resposta em ${timeoutMs} ms` : (e?.message || 'falha de rede');
  }
  const duracaoMs = Date.now() - inicio;

  if (!resposta) return await marcarFalha(entrega, w, { erro, status: null, duracaoMs });

  const status = resposta.status;
  let texto = '';
  try { texto = await resposta.text?.(); } catch { texto = ''; }

  // 2xx = aceito. Qualquer outra coisa é falha — inclusive 3xx: seguir redirecionamento levaria o
  // segredo portador para um host que o administrador não cadastrou.
  if (status >= 200 && status < 300) {
    const quando = agora();
    await db().ragnabotWebhookEntrega.update({
      where: { id: entrega.id },
      data: {
        estado: 'entregue', tentativa: (entrega.tentativa ?? 0) + 1,
        httpStatus: status, respostaResumo: resumirResposta(texto), erro: null,
        duracaoMs, entregueEm: quando,
      },
    });
    await db().ragnabotWebhookSaida.update({
      where: { id: w.id },
      data: { falhasSeguidas: 0, pausadoAte: null, ultimaEntregaEm: quando, ultimoStatus: status, ultimoErro: null },
    });
    return { ok: true, estado: 'entregue', status, duracaoMs };
  }
  return await marcarFalha(entrega, w, { erro: `o destino respondeu ${status}`, status, duracaoMs, resposta: texto });
}

/** Marca a falha, agenda a próxima tentativa (ou desiste) e mexe no disjuntor do destino. */
async function marcarFalha(entrega, webhook, { erro, status = null, duracaoMs = null, resposta = null }) {
  const tentativa = (entrega.tentativa ?? 0) + 1;
  const max = entrega.maxTentativas ?? MAX_TENTATIVAS_PADRAO;
  const desistiu = tentativa >= max;
  const quando = agora();
  const proximaEm = desistiu ? quando : new Date(quando.getTime() + recuoMs(tentativa));

  await db().ragnabotWebhookEntrega.update({
    where: { id: entrega.id },
    data: {
      estado: desistiu ? 'desistiu' : 'falhou',
      tentativa, httpStatus: status, erro: String(erro || 'falha').slice(0, 300),
      respostaResumo: resumirResposta(resposta), duracaoMs, proximaEm,
    },
  });

  const falhas = (webhook.falhasSeguidas ?? 0) + 1;
  const pausar = falhas >= FALHAS_PARA_PAUSAR;
  await db().ragnabotWebhookSaida.update({
    where: { id: webhook.id },
    data: {
      falhasSeguidas: falhas,
      pausadoAte: pausar ? new Date(quando.getTime() + PAUSA_MS) : webhook.pausadoAte,
      ultimoStatus: status, ultimoErro: String(erro || 'falha').slice(0, 300),
    },
  });

  if (desistiu) {
    // ⚠️ Log de ERRO, e não aviso: uma entrega desistida é informação perdida até alguém agir.
    log().error?.(`[webhook-saida] DESISTI da entrega ${entrega.id} (${entrega.evento}) para o destino ${webhook.id} após ${tentativa} tentativa(s): ${erro}. Só reenvio manual.`);
  } else {
    log().warn?.(`[webhook-saida] entrega ${entrega.id} falhou (tentativa ${tentativa}/${max}): ${erro} — próxima em ${Math.round(recuoMs(tentativa) / 1000)} s`);
  }
  return { ok: false, estado: desistiu ? 'desistiu' : 'falhou', status, tentativa, proximaEm, motivo: erro };
}

/**
 * Uma passada do carteiro: pega o que venceu e tenta entregar.
 * @returns {{olhadas:number, entregues:number, falhas:number, desistidas:number, pausadas:number}}
 */
export async function entregarPendentes({ limite = 50, timeoutMs = 10_000 } = {}) {
  exigirModelo();
  const quando = agora();
  const pendentes = await db().ragnabotWebhookEntrega.findMany({
    where: { estado: { in: ['pendente', 'falhou'] }, proximaEm: { lte: quando } },
    orderBy: { proximaEm: 'asc' },
    take: limite,
  });

  const conta = { olhadas: pendentes.length, entregues: 0, falhas: 0, desistidas: 0, pausadas: 0 };
  const cacheDestino = new Map();
  for (const e of pendentes) {
    let w = cacheDestino.get(e.webhookId);
    if (w === undefined) {
      w = await db().ragnabotWebhookSaida.findUnique({ where: { id: e.webhookId } }).catch(() => null);
      cacheDestino.set(e.webhookId, w);
    }
    // R-5: destino em repouso não é tentado — e a linha NÃO é marcada como falha por isso. Só
    // adia. Contar como falha aqui queimaria as tentativas do evento por culpa do destino estar
    // descansando, que é o oposto do que o repouso existe para fazer.
    if (w && w.pausadoAte && new Date(w.pausadoAte) > quando) {
      await db().ragnabotWebhookEntrega.update({
        where: { id: e.id }, data: { proximaEm: new Date(w.pausadoAte) },
      }).catch(() => {});
      conta.pausadas++;
      continue;
    }
    const r = await entregarUma(e, { webhook: w, timeoutMs });
    if (r.ok) conta.entregues++;
    else if (r.estado === 'desistiu') conta.desistidas++;
    else conta.falhas++;
  }
  return conta;
}

/** Reenvio MANUAL de uma entrega desistida (R-4). O humano é o gatilho, por decisão registrada. */
export async function reenviar(tenantId, entregaId, { ator = null, req = null } = {}) {
  exigirModelo();
  const e = await db().ragnabotWebhookEntrega.findFirst({ where: { id: String(entregaId || ''), tenantId: String(tenantId || '') } });
  if (!e) { const err = new Error('Entrega não encontrada.'); err.status = 404; throw err; }
  if (e.estado === 'entregue') return { ok: true, jaEntregue: true, entrega: e };
  const linha = await db().ragnabotWebhookEntrega.update({
    where: { id: e.id },
    // Tentativa volta a zero: é uma decisão HUMANA nova, não a continuação da rodada anterior.
    data: { estado: 'pendente', tentativa: 0, proximaEm: agora(), erro: null },
  });
  await auditar({ tenantId, ator, req, acao: 'ragnabot.webhook.reenviar', entidadeId: e.id,
    descricao: `Reenvio manual da entrega ${e.id} (${e.evento})`, antes: { estado: e.estado }, depois: { estado: 'pendente' } });
  return { ok: true, entrega: linha };
}

/** O histórico, para a tela e para o relatório (F9.2.6 no que toca a webhook). */
export async function listarEntregas(tenantId, { webhookId = null, estado = null, evento = null, limite = 100 } = {}) {
  exigirModelo();
  const where = { tenantId: String(tenantId || '') };
  if (webhookId) where.webhookId = String(webhookId);
  if (estado) where.estado = String(estado);
  if (evento) where.evento = String(evento);
  const linhas = await db().ragnabotWebhookEntrega.findMany({
    where, orderBy: { criadaEm: 'desc' }, take: Math.min(500, Math.max(1, Number(limite) || 100)),
  });
  // ⛔ O corpo NÃO sai na listagem: ele carrega dado de atendimento. Sai o resumo do que aconteceu.
  return linhas.map((l) => ({
    id: l.id, webhookId: l.webhookId, evento: l.evento, idDoEvento: l.idDoEvento,
    estado: l.estado, tentativa: l.tentativa, maxTentativas: l.maxTentativas,
    httpStatus: l.httpStatus, erro: l.erro, duracaoMs: l.duracaoMs,
    proximaEm: l.proximaEm, entregueEm: l.entregueEm, criadaEm: l.criadaEm,
  }));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O CARTEIRO — ⛔ DESLIGADO POR PADRÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════
let relogio = null;
let estado = { ligado: false, intervaloMs: null, erro: null, ultimaPassada: null, motivo: 'nunca ligado' };

export function estadoDoCarteiro() { return { ...estado }; }

/**
 * Liga o laço de entrega. **NÃO é chamado no arranque** — em 02/09/2026 não há webhook cadastrado
 * na plataforma e o executor de fluxo está desligado por decisão do chefe. Ligar é decisão dele.
 */
export function iniciarCarteiro({ intervaloMs = 30_000, limite = 50 } = {}) {
  if (relogio) return estadoDoCarteiro();
  const ms = Math.max(5_000, Number(intervaloMs) || 30_000);
  relogio = setInterval(() => {
    entregarPendentes({ limite })
      .then((r) => { estado.ultimaPassada = { quando: agora().toISOString(), ...r }; estado.erro = null; })
      .catch((e) => { estado.erro = e.message; log().error?.(`[webhook-saida] passada do carteiro falhou: ${e.message}`); });
  }, ms);
  relogio.unref?.();
  estado = { ligado: true, intervaloMs: ms, erro: null, ultimaPassada: null, motivo: null };
  log().info?.(`[webhook-saida] carteiro ligado (a cada ${ms} ms)`);
  return estadoDoCarteiro();
}

export function pararCarteiro() {
  if (relogio) { clearInterval(relogio); relogio = null; }
  estado = { ...estado, ligado: false, motivo: 'parado' };
  return estadoDoCarteiro();
}

async function auditar({ tenantId, ator, req, acao, descricao, entidadeId = null, antes = null, depois = null }) {
  try {
    const aud = portas.auditoria || (await import('./ragnabot-auditoria.service.js'));
    await aud.registrar({
      tenantId,
      atorTipo: ator ? 'usuario' : 'sistema',
      atorId: ator?.id || null, atorNome: ator?.name || ator?.nome || null, atorEmail: ator?.email || null,
      categoria: 'configuracao', acao, descricao,
      ip: req?.ip || null, userAgent: req?.headers?.['user-agent'] || null,
      entidade: 'RagnabotWebhookSaida', entidadeId, antes, depois,
    });
  } catch (e) { log().warn?.(`[webhook-saida] auditoria não registrada: ${e.message}`); }
}

export default {
  EVENTOS, RECUOS_MS, TETO_RECUO_MS, MAX_TENTATIVAS_PADRAO, FALHAS_PARA_PAUSAR, PAUSA_MS,
  recuoMs, chaveDaEntrega, interessa, validarUrl, montarCorpo,
  cadastrarWebhook, listarWebhooks, alterarWebhook, removerWebhook, regenerarSegredoDoWebhook,
  enfileirar, entregarUma, entregarPendentes, reenviar, listarEntregas,
  iniciarCarteiro, pararCarteiro, estadoDoCarteiro, disponivel,
  configurarWebhookSaida, portasDoWebhookSaida, comoPublico,
};
