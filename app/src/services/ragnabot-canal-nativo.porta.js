// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIO NATIVO POR CANAL — botão de verdade onde a PLATAFORMA não desenha botão.
//
// Contrato S-BOTOES-NATIVOS (03/09/2026). Este arquivo existe por causa de UMA lacuna medida, e só
// dela: o Instagram. Antes de escrever qualquer linha eu fui ler o código da plataforma (Chatwoot
// v4.17.1, tag exata, não "a versão mais ou menos"), e o resultado desmontou metade do enunciado:
//
//   CANAL      A PLATAFORMA TRADUZ `input_select`?   ONDE ISSO ESTÁ ESCRITO
//   telegram   SIM — teclado embutido                app/models/channel/telegram.rb#reply_markup
//   facebook   SIM — respostas rápidas               app/services/facebook/send_on_facebook_service.rb
//   instagram  NÃO — texto e só texto                app/services/instagram/base_send_service.rb
//
// Ou seja: para Telegram e Facebook, botão nativo se consegue **pela plataforma**, mandando
// `content_type: 'input_select'` — que é o que `ragnabot-canal.porta.js` já sabe fazer. Falar
// direto com a API desses dois seria trocar um caminho que funciona por um que precisa de
// credencial, de registro manual no histórico e de defesa contra eco. Pior em tudo.
//
// Sobra o Instagram. E é aqui que mora a armadilha do contrato:
//
// ─── ARMADILHA 1 — MENSAGEM QUE SAI POR FORA NÃO ENTRA NO HISTÓRICO ─────────────────────────────
// Se mandarmos direto para a Graph API do Instagram, a plataforma não fica sabendo. O atendente
// abre o atendimento e NÃO VÊ o que o robô falou com o cliente — pior que botão virar texto.
// Então todo envio nativo é seguido do REGISTRO na conversa. E o registro tem de ser feito de um
// jeito que a plataforma NÃO reentregue a mesma mensagem ao cliente; senão ele recebe duas.
// O que separa um caso do outro está medido em `app/services/base/send_on_channel_service.rb`:
//     def invalid_message?
//       message.private? || outgoing_message_originated_from_channel? || …
//     def outgoing_message_originated_from_channel?
//       message.source_id.present?
// Mensagem de saída COM `source_id` = "já nasceu no canal" = a plataforma NÃO manda de novo.
// É por isso que o registro carrega o `message_id` que a Graph API devolveu. Ver
// `enviarMensagem({ sourceId })` em `ragnabot-chatwoot.porta.js`.
//
// ─── ARMADILHA 2 — O REGISTRO NÃO PODE REALIMENTAR O MOTOR ──────────────────────────────────────
// A linha registrada volta para nós como webhook `message_created` do tipo `outgoing`. Sem marca,
// a portaria a classificaria como `saida_humana` (gente digitou) — e um dia como resposta. A marca
// é a MESMA da porta do canal, `content_attributes.rgt_efeito`, porque
// `ragnabot-webhook.routes.js#classificarEvento` já decide por ela:
//     if (mt === 'outgoing' && campos.marcaNossa) → classe ECO_PROPRIO
// e `ragnabot-portaria.service.js` para em `classe !== resposta_cliente`. Inventar uma marca nova
// aqui seria criar um laço em que o robô conversa sozinho.
//
// ─── A VOLTA DO CLIQUE, MEDIDA CANAL A CANAL ────────────────────────────────────────────────────
// (o que a PLATAFORMA entrega no webhook dela, que é o que a portaria enxerga)
//
//   TELEGRAM — `app/services/telegram/param_helpers.rb`:
//       telegram_params_message_content →  params[:callback_query][:data]
//       telegram_params_message_id      →  params[:callback_query][:id]
//     A CARGA VOLTA. `callback_data` é o nosso `value`, ou seja o id do item do fluxo, e ele chega
//     como o CONTEÚDO de uma mensagem recebida. ⚠️ Não chega em `submitted_values` nem em campo
//     interativo nenhum — chega como TEXTO. É por isso que o casador de opção precisa saber casar
//     "o texto é exatamente o id de um item" (ver `casarOpcao`).
//
//   FACEBOOK — `lib/integrations/facebook/message_parser.rb`:
//       def content;  @messaging.dig('message', 'text');  end
//     A CARGA SE PERDE. O parser nem lê `message.quick_reply.payload`. E não faria diferença: no
//     envio a plataforma manda `payload: item['title']` (o RÓTULO), jogando fora o nosso `value`.
//     Conclusão prática: no Facebook o casamento é PELO RÓTULO — e é por isso que
//     `CAPACIDADES.facebook.rotuloMax = 20`. Rótulo cortado é opção que não casa mais.
//
//   INSTAGRAM (resposta rápida) — `app/builders/messages/instagram/base_message_builder.rb`:
//       def message_content;  @messaging[:message][:text];  end
//     Mesma história do Facebook: volta o RÓTULO, a carga se perde.
//
//   INSTAGRAM (botão de modelo / postback) — `app/jobs/webhooks/instagram_events_job.rb`:
//       SUPPORTED_EVENTS = [:message, :read].freeze
//     ⛔ NÃO VOLTA NADA. `messaging_postbacks` não está na lista: o clique é DESCARTADO pela
//     plataforma em silêncio. O mesmo vale no Facebook — `config/initializers/facebook_messenger.rb`
//     engancha `:message`, `:delivery`, `:read` e `:message_echo`, e NÃO `:postback`.
//     É por isso que este arquivo NUNCA usa botão de modelo (`template_type: 'button'`) para
//     escolha: ele desenha bonito e o toque não chega em ninguém. Usa RESPOSTA RÁPIDA, que volta
//     como mensagem de texto e portanto atravessa o webhook da plataforma.
//
// ─── A CREDENCIAL — RESOLVIDA DESDE 03/09/2026 (contrato S-CREDENCIAL-IG) ───────────────────────
// O envio nativo precisa do `access_token` do canal, e a API da plataforma NÃO o expõe: conferido
// em `app/views/api/v1/models/_inbox.json.jbuilder`, que para Instagram publica só `instagram_id` e
// `reauthorization_required` — nunca o token (o mesmo vale para o `bot_token` do Telegram e o
// `page_access_token` do Facebook). Por isso a credencial vem de FORA da plataforma:
// `ragnabot-credencial-canal.service.js` (cofre cifrado da empresa → ambiente → token da Página
// derivado do token de sistema da Meta), amarrado em `servidor.js`.
//
// A porta `credenciais` abaixo continua nascendo VAZIA, e isso é de propósito: este arquivo não
// escolhe de onde vem o segredo. Quem não amarrar a porta (o teste, um processo de diagnóstico)
// recebe `SEM_CREDENCIAL` e DEGRADA para texto numerado, declarando. A degradação é a rede que
// existia antes e continua inteira.
//
// ⚠️ NÃO EXERCITADO COM TRÁFEGO REAL. Em 03/09/2026 não há conversa de Instagram nem de Telegram
// entrando. O que existe é o formato conferido contra a documentação oficial e o teste com dublê.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import logger from '../base/logger.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// OS LIMITES, COM A FONTE DE CADA NÚMERO
//
// Datado e com origem de propósito: limite de rede muda, e limite sem procedência vira folclore —
// alguém "lembra" que eram 10 e a mensagem começa a ser recusada em produção.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const LIMITES_NATIVOS = Object.freeze({
  instagram: Object.freeze({
    // «You can have a maximum of 13 buttons» + «up to 20 characters (will be truncated if more
    // than 20)» — Instagram Platform › Messaging API › Quick Replies (atualizada em 30/06/2026).
    respostasRapidasMax: 13,
    rotuloMax: 20,
    // «payload set to the content you would like to receive … in the webhook notification». O teto
    // de 1000 é o do Messenger (mesma família de API); a página do Instagram não repete o número.
    cargaMax: 1000,
    // «Set of 1-3 buttons that appear as call-to-actions» — Instagram › Button Template.
    // ⛔ INUTILIZÁVEL PARA ESCOLHA nesta plataforma: o `messaging_postbacks` do clique é descartado
    // por `Webhooks::InstagramEventsJob` (SUPPORTED_EVENTS = [:message, :read]). Fica registrado
    // como conhecimento, não como caminho.
    botoesDeModeloMax: 3,
    // «UTF-8-encoded text of up to 640 characters» — Instagram › Button Template.
    corpoMax: 640,
    base: 'https://graph.instagram.com',
    versao: 'v22.0', // o mesmo padrão que a plataforma usa em Instagram::SendOnInstagramService
    fonte: 'developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies',
  }),
  facebook: Object.freeze({
    // «A maximum of 13 quick replies are supported» · «20 character limit» (title) · «1000
    // character limit» (payload) — Messenger Platform › Send Messages › Quick Replies.
    respostasRapidasMax: 13,
    rotuloMax: 20,
    cargaMax: 1000,
    botoesDeModeloMax: 3, // «Set of 1-3 buttons» — Messenger › Templates › Button Template
    corpoMax: 640,
    base: 'https://graph.facebook.com',
    versao: 'v22.0',
    fonte: 'developers.facebook.com/docs/messenger-platform/send-messages/quick-replies/',
  }),
  telegram: Object.freeze({
    // ⚠️ A referência da Bot API NÃO fixa quantidade: `InlineKeyboardMarkup.inline_keyboard` é
    // «Array of Array of InlineKeyboardButton», sem teto. O que ela fixa é o tamanho da carga.
    respostasRapidasMax: null,
    rotuloMax: null,
    cargaMax: 64, // «callback_data … 1-64 bytes» — core.telegram.org/bots/api#inlinekeyboardbutton
    botoesDeModeloMax: null,
    corpoMax: 4096, // «Text of the message to be sent, 1-4096 characters» — sendMessage
    base: 'https://api.telegram.org',
    versao: null,
    fonte: 'core.telegram.org/bots/api',
  }),
});

/** Os limites de um canal, ou `null` se ele não tem caminho nativo conhecido. */
export function limitesNativosDe(canal) {
  return LIMITES_NATIVOS[String(canal || '').toLowerCase()] || null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  /** Cliente HTTP. O padrão é o `fetch` do processo — trocado por dublê no teste. */
  buscar: null,
  /**
   * QUEM RESOLVE A CREDENCIAL DO CANAL.
   * `({ tenantId, cwInboxId, canal }) => Promise<{ token, contaId?, base?, versao? } | null>`
   *
   * ⭐ Amarrada em `servidor.js` a `ragnabot-credencial-canal.service.js` (S-CREDENCIAL-IG). Nasce
   * NULA aqui de propósito: este arquivo sabe FALAR com o canal, não sabe (nem deve saber) de onde
   * vem o segredo. Sem a porta amarrada, `SEM_CREDENCIAL` → texto numerado.
   *
   * ⚠️ `token` chega como propriedade NÃO-ENUMERÁVEL do objeto do resolvedor: `JSON.stringify` e
   * `console.log` não o publicam. Não desestruture para um objeto novo antes de usar — isso o
   * tornaria enumerável de novo e devolveria o vazamento por descuido.
   * @type {null | { doCanal: Function }}
   */
  credenciais: null,
  log: null,
};

const log = () => portas.log || logger;

/** Amarra as dependências. Chamada pelo processo e pelo teste. */
export function configurarCanalNativo(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no canal nativo: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoCanalNativo();
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDoCanalNativo() { return { ...portas }; }

/** Há caminho nativo utilizável AGORA? Falso enquanto não houver resolvedor de credencial. */
export function nativoDisponivel(canal) {
  return Boolean(limitesNativosDe(canal)) && typeof portas.credenciais?.doCanal === 'function';
}

const bytes = (v) => Buffer.byteLength(String(v ?? ''), 'utf8');

/**
 * O erro deste arquivo, sempre com CÓDIGO. Quem chama decide degradar lendo o código, nunca
 * interpretando a frase — frase muda de redação, código não.
 */
function recusa(codigo, mensagem, status = null) {
  const e = new Error(mensagem);
  e.codigo = codigo;
  if (status !== null) e.status = status;
  return e;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A MONTAGEM DO CORPO — função PURA, e é ela que o teste julga
//
// Separada do envio de propósito: o formato é o que quebra em produção (campo com nome errado,
// item acima do teto, rótulo estourado), e formato se prova sem rede.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O corpo de uma escolha para a família Meta (Instagram e Messenger falam o mesmo dialeto aqui).
 *
 * Sempre RESPOSTA RÁPIDA, nunca botão de modelo — e o motivo está no cabeçalho: o `postback` do
 * botão de modelo é descartado pela plataforma, então ele desenharia um botão que não faz nada.
 *
 * @throws recusa('ACIMA_DO_TETO'|'ROTULO_LONGO'|'CARGA_LONGA'|'SEM_ITENS')
 */
export function montarRespostasRapidasMeta({ canal = 'instagram', destinatarioId, corpo = '', itens = [] } = {}) {
  const lim = limitesNativosDe(canal);
  if (!lim) throw recusa('CANAL_SEM_NATIVO', `não conheço caminho nativo para "${canal}"`);

  const lista = (Array.isArray(itens) ? itens : []).filter(Boolean);
  if (!lista.length) throw recusa('SEM_ITENS', 'escolha sem opção nenhuma não é escolha');
  if (lista.length > lim.respostasRapidasMax) {
    throw recusa('ACIMA_DO_TETO', `${lista.length} opções passam do teto de ${lim.respostasRapidasMax} do canal "${canal}"`);
  }

  const rapidas = lista.map((i) => {
    const titulo = String(i.titulo ?? i.rotulo ?? i.title ?? '').trim();
    const carga = String(i.id ?? i.value ?? '');
    if (!titulo) throw recusa('ROTULO_VAZIO', 'opção sem rótulo aparece em branco no aparelho do cliente');
    // ⛔ NÃO CORTA. Cortar mudaria o rótulo que o cliente lê E o rótulo que volta no clique — e é
    // pelo rótulo que a opção é casada nesta família de canais. Melhor degradar o menu inteiro
    // para texto numerado do que entregar uma opção que não casa mais.
    if (lim.rotuloMax && [...titulo].length > lim.rotuloMax) {
      throw recusa('ROTULO_LONGO', `o rótulo "${titulo}" passa de ${lim.rotuloMax} caracteres, que é o teto do canal "${canal}"`);
    }
    if (lim.cargaMax && bytes(carga) > lim.cargaMax) {
      throw recusa('CARGA_LONGA', `o id do item passa de ${lim.cargaMax} bytes, que é o teto de carga do canal "${canal}"`);
    }
    return { content_type: 'text', title: titulo, payload: carga || titulo };
  });

  const texto = String(corpo ?? '').trim();
  if (!texto) throw recusa('SEM_CORPO', 'resposta rápida sem texto acima não diz ao cliente o que escolher');
  if (lim.corpoMax && [...texto].length > lim.corpoMax) {
    throw recusa('CORPO_LONGO', `o texto passa de ${lim.corpoMax} caracteres, que é o teto do canal "${canal}"`);
  }

  return {
    recipient: { id: String(destinatarioId ?? '') },
    message: { text: texto, quick_replies: rapidas },
  };
}

/**
 * O teclado embutido do Telegram — mantido aqui como CONHECIMENTO, não como caminho.
 *
 * Hoje ninguém chama esta função no despacho: a plataforma já desenha este mesmo teclado sozinha
 * (`Channel::Telegram#reply_markup`), e passar por fora dela custaria credencial + registro manual
 * no histórico + defesa contra eco, sem ganhar nada. Ela existe para o dia em que o Telegram
 * chegue por um transporte que NÃO seja a plataforma — e para o teste poder provar que o formato
 * e o teto de 64 bytes estão certos antes daquele dia.
 */
export function montarTecladoTelegram({ chatId, texto = '', itens = [] } = {}) {
  const lim = LIMITES_NATIVOS.telegram;
  const lista = (Array.isArray(itens) ? itens : []).filter(Boolean);
  if (!lista.length) throw recusa('SEM_ITENS', 'teclado sem botão nenhum');
  const linhas = lista.map((i) => {
    const carga = String(i.id ?? i.value ?? '');
    if (bytes(carga) > lim.cargaMax) {
      throw recusa('CARGA_LONGA', `o id do item passa de ${lim.cargaMax} bytes, o teto de callback_data do Telegram`);
    }
    // Um botão por linha, igual ao que a plataforma faz — assim o texto longo não é cortado pela
    // largura da tela.
    return [{ text: String(i.titulo ?? i.rotulo ?? ''), callback_data: carga }];
  });
  return { chat_id: String(chatId ?? ''), text: String(texto ?? ''), reply_markup: { inline_keyboard: linhas } };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O ENVIO
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function chamar(url, corpo, { tempoLimiteMs = 15_000, contexto = '' } = {}) {
  const buscar = portas.buscar || globalThis.fetch;
  if (typeof buscar !== 'function') throw recusa('SEM_HTTP', 'não há cliente HTTP neste processo');

  const cancelar = new AbortController();
  const relogio = setTimeout(() => cancelar.abort(), tempoLimiteMs);
  let r;
  try {
    r = await buscar(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: cancelar.signal,
    });
  } catch (e) {
    // Rede caída é DÚVIDA, não recusa do destino: não sabemos se a requisição chegou. O código
    // `ECONNRESET` é o que faz o motor congelar e chamar gente em vez de rerrotear por `erro`.
    const falha = recusa('REDE', `${contexto}: falha de rede ao falar com o canal`);
    falha.code = 'ECONNRESET';
    throw falha;
  } finally {
    clearTimeout(relogio);
  }

  let dados = null;
  try { dados = await r.json(); } catch { dados = null; }
  if (!r.ok || dados?.error || dados?.ok === false) {
    // ⛔ A mensagem do erro NUNCA leva a URL: ela carrega o token na consulta. O que vai para o log
    // e para a coluna de diagnóstico é código + descrição do destino.
    const descricao = dados?.error?.message || dados?.description || `HTTP ${r.status}`;
    const falha = recusa('CANAL_RECUSOU', `${contexto}: o canal recusou (${String(descricao).slice(0, 200)})`, r.status);
    falha.codigoDoCanal = dados?.error?.code ?? dados?.error_code ?? null;
    throw falha;
  }
  return dados ?? {};
}

/**
 * MANDA A ESCOLHA PELA API DO CANAL e devolve o id da mensagem no canal.
 *
 * ⚠️ Este método NÃO registra nada na conversa. Quem registra é `ragnabot-canal.porta.js`, logo
 * depois, com o `sourceId` que sai daqui — a separação é de propósito: o registro é o passo que
 * NÃO pode ser esquecido, e deixá-lo do lado de quem já tem a porta da plataforma na mão evita a
 * versão "mandei e esqueci" deste arquivo.
 */
export async function enviarInterativoNativo({
  canal, tenantId, cwInboxId, destinatarioId, corpo, itens = [],
} = {}) {
  const lim = limitesNativosDe(canal);
  if (!lim) throw recusa('CANAL_SEM_NATIVO', `não conheço caminho nativo para "${canal}"`);
  if (!destinatarioId) throw recusa('SEM_DESTINATARIO', 'sem o identificador do cliente no canal não há para quem mandar');

  if (typeof portas.credenciais?.doCanal !== 'function') {
    throw recusa('SEM_CREDENCIAL',
      `o envio nativo no canal "${canal}" exige a credencial do canal, e esta instalação não tem de onde tirá-la `
      + '(a plataforma não publica o token e o cofre cifrado ainda não tem leitor)');
  }
  const cred = await portas.credenciais.doCanal({ tenantId, cwInboxId, canal });
  if (!cred?.token) {
    throw recusa('SEM_CREDENCIAL', `não há credencial cadastrada para a conexão ${cwInboxId} do canal "${canal}"`);
  }

  const corpoDaMeta = montarRespostasRapidasMeta({ canal, destinatarioId, corpo, itens });
  // ⭐ S-CREDENCIAL-IG (03/09/2026): o ENDEREÇO vem de quem resolveu a credencial, com o padrão
  // documentado do canal como rede. Não é enfeite — a Meta tem DOIS caminhos para o Instagram e a
  // URL certa depende de QUAL token foi resolvido:
  //   · token de USUÁRIO do Instagram → https://graph.instagram.com/vXX/me/messages
  //   · token da PÁGINA (o que o nosso usuário de sistema deriva) → https://graph.facebook.com/vXX/<IG_ID>/messages
  // Mandar um token de Página para `graph.instagram.com` devolve um erro que PARECE «token
  // inválido» — e manda quem diagnostica trocar justamente a credencial que está certa.
  const base = cred.base || lim.base;
  const versao = cred.versao || lim.versao;
  const conta = cred.contaId || 'me';
  const url = `${base}/${versao}/${conta}/messages?access_token=${encodeURIComponent(cred.token)}`;
  const r = await chamar(url, corpoDaMeta, { contexto: `envio nativo em ${canal}` });

  const idExterno = r?.message_id ?? null;
  if (!idExterno) {
    // Sem o id não há como registrar SEM REENVIO (é ele que vira `source_id`). Recusar aqui é
    // melhor que registrar sem ele e a plataforma mandar a mensagem uma segunda vez.
    throw recusa('SEM_ID_DE_MENSAGEM', `o canal "${canal}" aceitou mas não devolveu message_id — não dá para registrar sem reenviar`, 502);
  }
  return { idExterno: String(idExterno), quantidade: itens.length, canal };
}

/**
 * RESPONDE AO TOQUE NO BOTÃO DO TELEGRAM — `answerCallbackQuery`.
 *
 * Por que isto precisa existir: a referência da Bot API é explícita — «After the user presses a
 * callback button, Telegram clients will display a progress bar until you call answerCallbackQuery.
 * It is, therefore, necessary to react by calling answerCallbackQuery even if no notification to
 * the user is needed». E a plataforma NÃO chama: varri o repositório da versão 4.17.1 e
 * `answerCallbackQuery` não aparece em lugar nenhum. Resultado prático: o botão fica girando no
 * aparelho do cliente até a espera do cliente estourar.
 *
 * O `callbackQueryId` está ao nosso alcance: `Telegram::ParamHelpers#telegram_params_message_id`
 * usa `params[:callback_query][:id]` como `source_id` da mensagem, e o `source_id` chega no nosso
 * webhook (`Telegram::IncomingMessageService` grava `source_id: telegram_params_message_id.to_s`).
 *
 * ⭐ LIGADA AO WEBHOOK EM 03/09/2026 (S-CREDENCIAL-IG). O que faltava era o `bot_token` — a
 * plataforma publica só o `bot_name` (`_inbox.json.jbuilder`) — e agora ele vem do cofre/ambiente
 * pelo resolvedor de credencial. Quem chama é `responderToqueDoTelegram()` em
 * `ragnabot-webhook.routes.js`, e a chamada NUNCA pode derrubar o webhook: sem token, ou com um
 * `callback_query_id` velho, a recusa é registrada e a mensagem do cliente segue seu caminho.
 */
export async function responderCliqueTelegram({ tenantId, cwInboxId, callbackQueryId, texto = null } = {}) {
  if (!callbackQueryId) throw recusa('SEM_CALLBACK', 'sem o id da consulta não há o que responder');
  if (typeof portas.credenciais?.doCanal !== 'function') {
    throw recusa('SEM_CREDENCIAL', 'responder o toque no Telegram exige o token do bot, que esta instalação não tem de onde tirar');
  }
  const cred = await portas.credenciais.doCanal({ tenantId, cwInboxId, canal: 'telegram' });
  if (!cred?.token) throw recusa('SEM_CREDENCIAL', `não há token de bot cadastrado para a conexão ${cwInboxId}`);

  const corpo = { callback_query_id: String(callbackQueryId) };
  // «text … 0-200 characters» — a referência corta em 200; mandar mais é recusa da chamada inteira.
  if (texto) corpo.text = String(texto).slice(0, 200);
  await chamar(`${LIMITES_NATIVOS.telegram.base}/bot${cred.token}/answerCallbackQuery`, corpo,
    { contexto: 'resposta ao toque no Telegram' });
  return { respondido: true };
}

export default {
  configurarCanalNativo,
  portasDoCanalNativo,
  nativoDisponivel,
  limitesNativosDe,
  montarRespostasRapidasMeta,
  montarTecladoTelegram,
  enviarInterativoNativo,
  responderCliqueTelegram,
  LIMITES_NATIVOS,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ — declarado para ninguém confundir ausência com defeito
//
// • NÃO manda ao Telegram nem ao Facebook por fora da plataforma. Os dois já recebem botão nativo
//   PELA plataforma (medido no código dela), e sair por fora custaria credencial + registro manual
//   + defesa contra eco para ganhar zero.
// • NÃO usa botão de modelo (`template_type: 'button'`) para escolha, em canal nenhum da Meta. Ele
//   desenha, mas o clique vira `messaging_postbacks`, e a plataforma descarta esse evento — nem no
//   Instagram (`SUPPORTED_EVENTS = [:message, :read]`) nem no Facebook (o inicializador não
//   engancha `:postback`). Botão que não volta é botão que trava o atendimento.
// • NÃO decide de onde vem a credencial. Nasce sem resolvedor e recusa com `SEM_CREDENCIAL`; quem
//   amarra a porta é `servidor.js`, e quem sabe procurar o segredo é
//   `ragnabot-credencial-canal.service.js`. Misturar as duas coisas aqui faria este arquivo
//   depender do banco só para conseguir mandar uma mensagem.
// • NÃO foi exercitado com tráfego real. Zero caixas de Instagram/Telegram em 03/09/2026.
// ════════════════════════════════════════════════════════════════════════════════════════════════
