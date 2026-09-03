// ════════════════════════════════════════════════════════════════════════════════════════════════
// WEBHOOK DO RAGNABOT (Chatwoot) — a PORTA DE ENTRADA do atendimento.
//
// COMO O RAGNABOT É AVISADO: no Chatwoot, cada Account (= uma empresa nossa) tem um webhook
// apontando para cá. Ele dispara em `conversation_created`, `message_created`,
// `conversation_status_changed`, etc.
//
// O QUE ESTA ROTA FAZ:
//   • emite o PROTOCOLO quando a conversa nasce (RGT-0000000001, sequência da empresa);
//   • registra a AUDITORIA de início/fim de atendimento;
//   • ⭐ ENTREGA A MENSAGEM DO CLIENTE À PORTARIA (contrato S-PORTARIA, 02/09/2026) — é o elo que
//     faltava. `atenderMensagemRecebida()` existia, estava testada, e NINGUÉM a chamava: o cliente
//     mandava "oi" e o motor de fluxo inteiro nunca era acionado. A corrente agora é
//     `Chatwoot → webhook → portaria → fila → motor → canal → cliente`.
//
// A PONTE empresa↔plataforma é `RagnabotTenant.cwAccountId` (1 empresa = 1 Account). Evento de
// account que não é nossa é DESCARTADO com registro — nunca cria protocolo nem aciona fluxo para
// empresa desconhecida.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO ARMADILHAS QUE A LIGAÇÃO COM A PORTARIA EXISTE PARA EVITAR
//
// 1. O ROBÔ CONVERSANDO SOZINHO. Toda mensagem que o motor envia volta como webhook
//    (`message_created`, `outgoing`). Se ela realimentar o fluxo, o robô responde à própria
//    resposta, para sempre, gastando a janela de 24 h e a paciência do cliente. Por isso a
//    classificação é POSITIVA (`classificarEvento`): só `incoming` + não-privada + remetente que
//    não é agente vira `resposta_cliente`. Todo o resto é gravado com outra classe e não acorda nó
//    nenhum. **Identidade nunca é inferida por ausência** (doc 28 §5.1).
//
// 2. A NOTA INTERNA VIRANDO RESPOSTA DO CLIENTE. `private:true` é o atendente falando com o time.
//    Sem a guarda, uma nota "cliente é chato" seria consumida como escolha de menu.
//
// 3. A REENTREGA VIRANDO SEGUNDA CONVERSA. O Chatwoot reentrega quando não recebe 2xx — e
//    reentregar é o comportamento DESEJADO. A idempotência mora em duas camadas já prontas:
//    `RagnabotFluxoEntrada.chave` (única, calculada a partir do `id` da mensagem) e
//    `RagnabotFluxoFila.chaveIdem`. Aqui só passamos o `mensagemId`, que é o que torna a chave
//    estável; a portaria devolve `duplicada` e nada é enfileirado de novo.
//
// 4. O 500 QUE ENTOPE A FILA DO CHATWOOT. Erro NOSSO (política ausente, motor sem porta) não pode
//    virar 500: o Chatwoot reentregaria para sempre um evento que vai falhar sempre. A regra desta
//    rota é: **a mensagem foi GRAVADA → 2xx, sempre**, mesmo que o resto tenha degradado; a
//    mensagem NÃO foi gravada → 503, porque aí reentregar é a única forma de não perdê-la.
//    (Isto NÃO afrouxa o §1.2/(2) do doc 28: continua valendo "2xx só depois de gravar".)
//
// SEGURANÇA: valida um segredo compartilhado (comparação resistente a timing).
// ⚠️ PENDÊNCIA CONHECIDA, NÃO FECHADA AQUI (doc 28 §5.2): o desenho pede segredo POR CAIXA/EMPRESA
// (`RagnabotFluxoWebhookSegredo`, tabela já no schema) e SÓ por cabeçalho — hoje é um segredo
// global aceito também por query string. `RagnabotFluxoWebhookSegredo` não tem NENHUMA escrita no
// repositório (medido: zero usos em `src/` e `web/`), então implementar só a verificação criaria
// código morto e derrubaria a única credencial que funciona. Fica declarado, não maquiado.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import crypto from 'node:crypto';
import prismaGlobal from '../base/db.js';
import * as protocolo from '../services/ragnabot-protocolo.service.js';
import * as auditoria from '../services/ragnabot-auditoria.service.js';
import * as portariaModulo from '../services/ragnabot-portaria.service.js';
import * as caixaModulo from '../services/ragnabot-caixa.service.js';
import * as aoVivoModulo from '../services/ragnabot-tempo-real.service.js';
import loggerGlobal from '../base/logger.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — mesma injeção do resto da casa. Não é ponto de bifurcação de comportamento: o teste
// injeta OUTRA implementação das MESMAS portas, nunca outro caminho de código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  portaria: portariaModulo,
  protocolo,
  auditoria,
  // Índice da caixa de atendimento (contrato S2). É por aqui que a fila do agente se enche.
  // ⚠️ NUNCA pode derrubar o webhook: ver `projetarNaCaixa()` mais abaixo.
  caixa: caixaModulo,
  // ⭐ O AVISO AO VIVO (contrato S-TEMPO-REAL, 03/09/2026). Porta, e não import direto lá embaixo,
  // pela mesma razão das outras: o teste injeta um dublê e mede o que foi anunciado, sem precisar
  // de banco nem de navegador. ⛔ NUNCA derruba o webhook — ver `anunciarNaCaixa`.
  aoVivo: aoVivoModulo,
  // ⭐ S-CREDENCIAL-IG (03/09/2026). Quem responde ao TOQUE no botão do Telegram
  // (`answerCallbackQuery`) e quem resolve a credencial para isso. Carregados por importação
  // preguiçosa em `responderToqueDoTelegram` — aqui ficam `null` para o teste injetar dublê sem
  // tocar na rede e sem precisar de banco.
  canalNativo: null,
  log: loggerGlobal,
};

export function configurarWebhook(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no webhook: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoWebhook() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTADORES — o que o `/saude` mostra.
//
// ⚠️ Sem isto, "o robô não responde" não tem onde ser olhado: o evento entra, é descartado por uma
// regra correta (ou por uma errada) e some. `descartados` por motivo é o que distingue "ninguém
// escreveu" de "estamos descartando tudo o que chega".
// ────────────────────────────────────────────────────────────────────────────────────────────────
const contadores = {
  recebidos: 0,
  aceitos: 0,          // viraram entrada gravada pela portaria
  descartados: 0,      // regra nossa disse "não é para o fluxo"
  contaDesconhecida: 0,
  degradados: 0,       // gravou, mas o resto falhou (a mensagem NÃO se perdeu)
  naoGravados: 0,      // nem gravou → devolvemos 503 e o Chatwoot reentrega
  // Contador PRÓPRIO da projeção na caixa (contrato S2), e não `degradados`, de propósito:
  // `degradados` significa «a mensagem do cliente foi gravada mas o resto do processamento dela
  // falhou». A projeção do índice da caixa não é processamento da mensagem — ela pode falhar sem
  // que nada do atendimento tenha degradado. Somar as duas coisas no mesmo número faria o /saude
  // acusar degradação onde não há, e um alarme que dispara à toa é um alarme que se ignora.
  caixaNaoProjetada: 0,
  // Quantos avisos ao vivo saíram daqui. Separado dos outros de propósito: aviso que não sai NÃO é
  // degradação do atendimento (a mensagem foi gravada e o cliente será atendido) — é uma tela que
  // vai demorar mais para se atualizar. Somar as duas coisas faria o /saude acusar degradação onde
  // não há, e alarme que dispara à toa é alarme que se ignora.
  avisosAoVivo: 0,
  // ⭐ Toques de botão do Telegram respondidos (`answerCallbackQuery`). Contadores PRÓPRIOS, e não
  // `degradados`: um toque não respondido deixa a barrinha girando no aparelho do cliente, o que é
  // ruim — mas a mensagem dele foi gravada e ele SERÁ atendido. Misturar com degradação do
  // atendimento faria o /saude acusar problema onde há incômodo.
  toquesRespondidos: 0,
  toquesNaoRespondidos: 0,
  porMotivo: Object.create(null),
  ultimoEm: null,
  ultimoErro: null,
};
function contar(campo, motivo = null) {
  contadores[campo] += 1;
  if (motivo) contadores.porMotivo[motivo] = (contadores.porMotivo[motivo] ?? 0) + 1;
}
export function estatisticasDoWebhook() {
  return { ...contadores, porMotivo: { ...contadores.porMotivo } };
}
export function zerarEstatisticasDoWebhook() {
  contadores.recebidos = 0; contadores.aceitos = 0; contadores.descartados = 0;
  contadores.contaDesconhecida = 0; contadores.degradados = 0; contadores.naoGravados = 0;
  contadores.caixaNaoProjetada = 0; contadores.avisosAoVivo = 0;
  contadores.toquesRespondidos = 0; contadores.toquesNaoRespondidos = 0;
  contadores.porMotivo = Object.create(null);
  contadores.ultimoEm = null; contadores.ultimoErro = null;
}

// Comparação de segredo resistente a timing — mesmo padrão do webhook do Zabbix e da cobrança.
function segredoConfere(recebido) {
  const esperado = process.env.RAGNABOT_WEBHOOK_SEGREDO || '';
  if (!esperado) return null; // null = não configurado (recusa com log claro)
  const a = Buffer.from(String(recebido || ''));
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function tenantDaAccount(cwAccountId) {
  if (cwAccountId == null) return null;
  const n = Number(cwAccountId);
  if (!Number.isInteger(n)) return null;
  return db().ragnabotTenant.findUnique({ where: { cwAccountId: n } });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DO EVENTO — função PURA, exportada, e é a regra inteira num lugar só.
//
// Doc 28 §5.1, tabela "evento → classe". Traduzida para o corpo REAL do Chatwoot 4.x, com as
// tolerâncias que o corpo real exige:
//
//   · `message_type` chega como texto ('incoming') na maioria das versões e como INTEIRO (0/1/2/3)
//     quando o serializador usa `*_before_type_cast`. Aceitar só o texto faria toda mensagem de
//     cliente virar "controle" — o robô ficaria mudo e o log diria que estava tudo certo.
//   · `conversation.id` do webhook é o `display_id` (Chatwoot serializa assim), que é EXATAMENTE o
//     identificador que a API v1 usa em `/conversations/:id`. Por isso ele é o `cwConversationId`
//     da casa inteira, e é o mesmo que o protocolo já grava. Não confundir com `conversation_id`
//     interno, que não serve para chamar a API.
//   · o remetente agente vem com `sender.type = 'user'` (e `'agent_bot'` para bot). Contato não
//     traz `type` em algumas versões — por isso a checagem é NEGATIVA sobre o agente e a decisão
//     principal continua sendo `incoming`, que no Chatwoot só existe vindo do contato.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Os valores de `message_type` do Chatwoot, nas duas formas em que ele os serializa. */
const TIPOS_MENSAGEM = Object.freeze({
  0: 'incoming', 1: 'outgoing', 2: 'activity', 3: 'template',
  incoming: 'incoming', outgoing: 'outgoing', activity: 'activity', template: 'template',
});

function tipoDeMensagem(valor) {
  if (valor === null || valor === undefined) return null;
  return TIPOS_MENSAGEM[valor] ?? TIPOS_MENSAGEM[String(valor)] ?? null;
}

/** Aceita ISO, epoch em segundos e epoch em milissegundos. O Chatwoot manda os três, conforme a
 *  versão e o serializador — e um carimbo lido errado desloca a ordenação da rajada em 55 anos. */
export function carimboDeOrigem(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number' || /^\d+$/.test(String(valor))) {
    const n = Number(valor);
    // Menos de 10^11 é segundo (até o ano 5138); acima é milissegundo.
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

const inteiroOuNulo = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * O QUE ESTE EVENTO É, e o que fazer com ele.
 *
 * @returns {{acao:'portaria'|'protocolo'|'encerramento'|'nada', classe:string|null,
 *            motivo:string, cwAccountId:number|null, cwConversationId:number|null, ...}}
 */
export function classificarEvento(evt = {}) {
  const tipo = String(evt.event || '');
  const conv = evt.conversation || {};
  const cwAccountId = inteiroOuNulo(evt.account?.id ?? conv.account_id ?? evt.inbox?.account_id ?? evt.account_id);
  // `conv.id` primeiro: no `message_created` ele já é o display_id. `evt.id` no topo é o id da
  // MENSAGEM, nunca da conversa — usá-lo aqui misturaria duas numerações e o protocolo casaria com
  // a conversa errada.
  const cwConversationId = inteiroOuNulo(conv.id ?? conv.display_id ?? evt.display_id ?? (tipo.startsWith('conversation') ? evt.id : null));
  const cwInboxId = inteiroOuNulo(evt.inbox?.id ?? conv.inbox_id ?? evt.inbox_id);

  const base = { tipo, cwAccountId, cwConversationId, cwInboxId };

  if (tipo === 'conversation_created') {
    return { ...base, acao: 'protocolo', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'conversa_nasceu' };
  }
  if (tipo === 'conversation_status_changed' || tipo === 'conversation_resolved') {
    return { ...base, acao: 'encerramento', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `status:${conv.status ?? '?'}`, status: conv.status ?? null };
  }

  if (tipo !== 'message_created') {
    // `message_updated`, `conversation_updated`, `webwidget_triggered`, `contact_updated`… Nada
    // disso responde nó, e inventar comportamento para evento não medido é como se cria laço.
    return { ...base, acao: 'nada', classe: null, motivo: `evento_sem_acao:${tipo || 'vazio'}` };
  }

  // ── daqui para baixo: message_created ────────────────────────────────────────────────────────
  const mt = tipoDeMensagem(evt.message_type);
  const privada = evt.private === true || evt.private === 'true';
  const remetente = String(evt.sender?.type ?? evt.sender_type ?? '').toLowerCase();
  const marcaNossa = evt.content_attributes?.rgt_efeito ?? null;

  const campos = {
    ...base,
    mensagemId: inteiroOuNulo(evt.id),
    wamid: evt.source_id ? String(evt.source_id) : null,
    texto: typeof evt.content === 'string' ? evt.content : (evt.content == null ? '' : String(evt.content)),
    origemEm: carimboDeOrigem(evt.created_at),
    cwContactId: inteiroOuNulo(evt.sender?.id ?? conv.meta?.sender?.id),
    contatoChave: evt.sender?.phone_number ?? evt.sender?.identifier
      ?? conv.meta?.sender?.phone_number ?? null,
    anexos: Array.isArray(evt.attachments) ? evt.attachments.map((a) => ({
      tipo: a?.file_type ?? null, url: a?.data_url ?? a?.file_url ?? null,
    })) : [],
    interativo: evt.content_attributes?.submitted_values ?? null,
    marcaNossa: marcaNossa ? String(marcaNossa) : null,
  };

  // ARMADILHA 2 — nota interna NUNCA é resposta de cliente, venha de onde vier.
  if (privada) {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'nota_interna' };
  }
  // ARMADILHA 1 — o eco da NOSSA própria mensagem. Identidade por MARCA, não por ausência.
  if (mt === 'outgoing' && campos.marcaNossa) {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.ECO_PROPRIO, motivo: 'eco_do_motor' };
  }
  // Saída SEM a nossa marca = gente digitou. Registra (é o sinal de takeover do doc 28 §5.1), não
  // aciona nó. ⚠️ A TRANSIÇÃO para `pausado_humano` ainda NÃO está implementada — fica registrada.
  if (mt === 'outgoing') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'saida_humana' };
  }
  // `activity` (mudou de status, atribuiu) e `template` não são fala de cliente.
  if (mt === 'activity' || mt === 'template') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `mensagem_${mt}` };
  }
  // Tipo que não sabemos ler: trata como controle. Adivinhar aqui é o que faz o robô responder ao
  // que não é pergunta.
  if (mt !== 'incoming') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `message_type_desconhecido:${evt.message_type}` };
  }
  // Entrada, mas assinada por agente/bot: não é o cliente. Cinto e suspensório sobre o `incoming`.
  if (remetente === 'user' || remetente === 'agent_bot') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `remetente:${remetente}` };
  }

  return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.RESPOSTA_CLIENTE, motivo: 'mensagem_do_cliente' };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROJEÇÃO NA CAIXA DE ATENDIMENTO (contrato S2)
//
// O índice `RagnabotConversa` é o que permite impor, num `where`, "aberta só do agente que atende",
// "resolvidos só os dele" e "histórico por setor". Ele se enche AQUI, no mesmo evento que já chega.
//
// ⛔ NUNCA DERRUBA O WEBHOOK. Perder uma projeção atrasa uma linha da fila e a próxima
// sincronização conserta; derrubar o webhook perderia a MENSAGEM DO CLIENTE, que é
// incomparavelmente pior. Por isso o `catch` engole, conta e segue.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * O que o evento diz sobre o ROTEAMENTO da conversa. Função PURA — é o pedaço fácil de errar
 * (o assignee vem em dois lugares, o time em outros dois) e o barato de provar.
 *
 * Campos AUSENTES ficam `undefined` de propósito: `projetarConversa()` só escreve o que veio, e um
 * evento de mensagem (que não carrega o setor) não pode apagar o setor da conversa.
 */
export function roteamentoDoEvento(evt = {}) {
  const conv = evt.conversation || {};
  const meta = conv.meta || {};
  const num = (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isInteger(n) ? n : undefined;
  };

  // O responsável chega como `conversation.meta.assignee` e, em alguns eventos, no topo como
  // `evt.assignee`. `assignee_id: null` é informação legítima («devolveram para a fila») — por isso
  // o nulo EXPLÍCITO é preservado, e só a ausência total vira `undefined`.
  let assignee;
  if ('assignee_id' in conv) assignee = conv.assignee_id === null ? null : num(conv.assignee_id);
  else if (meta.assignee) assignee = num(meta.assignee.id);
  else if (evt.assignee) assignee = num(evt.assignee.id);

  let team;
  if ('team_id' in conv) team = conv.team_id === null ? null : num(conv.team_id);
  else if (meta.team) team = num(meta.team.id);

  const remetente = meta.sender || (String(evt.sender?.type ?? '').toLowerCase() === 'contact' ? evt.sender : null);
  const chave = remetente?.phone_number ?? remetente?.identifier ?? undefined;

  return {
    cwInboxId: num(evt.inbox?.id ?? conv.inbox_id ?? evt.inbox_id),
    caixaNome: evt.inbox?.name ?? undefined,
    canal: evt.inbox?.channel_type ? String(evt.inbox.channel_type).replace(/^Channel::/u, '').toLowerCase() : undefined,
    cwTeamId: team,
    setorNome: meta.team?.name ?? undefined,
    cwAssigneeId: assignee,
    atendenteNome: meta.assignee?.name ?? evt.assignee?.name ?? undefined,
    cwContactId: num(remetente?.id),
    contatoNome: remetente?.name ?? undefined,
    contatoChave: chave === undefined ? undefined : String(chave),
    // Grupo de WhatsApp: o identificador termina em `@g.us`. É o único sinal que a plataforma dá
    // sem consultar o canal, e é estável — o mesmo sufixo que o NOC já usa nos alertas.
    ehGrupo: chave === undefined ? undefined : String(chave).endsWith('@g.us'),
    statusPlataforma: conv.status ?? undefined,
    abertaEm: carimboDeOrigem(conv.created_at) ?? undefined,
  };
}

/**
 * Projeta e NUNCA estoura. Devolve o resultado só para o registro/diagnóstico.
 *
 * ⭐ E ANUNCIA AO VIVO (contrato S-TEMPO-REAL, 03/09/2026). Este é o único funil por onde o índice
 * da caixa muda a partir do mundo real — conversa que nasce, mensagem que chega, atribuição que
 * muda, conversa que é resolvida. Anunciar em qualquer outro lugar seria ter dois lugares para
 * lembrar, e um deles seria esquecido.
 *
 * ⚠️ POR QUE LER O «ANTES»: transferir muda QUEM VÊ. Sem o retrato anterior, o atendente que
 * perdeu a conversa não seria avisado e o cartão ficaria morto na tela dele até um F5 — que é o
 * defeito que este contrato veio matar. Custa uma leitura por chave primária, num caminho de
 * volume baixo.
 *
 * ⚠️ O ANÚNCIO NÃO ESPERA E NÃO DERRUBA: `anunciarConversa` engole o próprio erro, e o `await`
 * aqui existe só para o teste poder medir. Aviso perdido atrasa uma tela; exceção aqui perderia a
 * MENSAGEM DO CLIENTE, que é incomparavelmente pior.
 */
async function projetarNaCaixa(tenantId, c, evt, extra = {}, motivoAoVivo = 'mudou') {
  let antes = null;
  try {
    if (!portas.caixa?.projetarConversa) return null;
    antes = await portas.aoVivo?.lerResumo?.({
      db: db(), cwAccountId: c.cwAccountId, cwConversationId: c.cwConversationId,
    }) ?? null;
    const r = await portas.caixa.projetarConversa({
      tenantId,
      cwAccountId: c.cwAccountId,
      cwConversationId: c.cwConversationId,
      ultimaAtividadeEm: c.origemEm instanceof Date ? c.origemEm : new Date(),
      ...roteamentoDoEvento(evt),
      ...extra,
    });
    await anunciarAoVivo(c, motivoAoVivo, antes);
    return r;
  } catch (e) {
    contar('caixaNaoProjetada', 'caixa_nao_projetou');
    log().warn(`[ragnabot-webhook] caixa não projetada (conversa ${c.cwConversationId}): ${e.message.slice(0, 160)}`);
    return null;
  }
}

/** O anúncio, isolado para nunca contaminar o caminho da mensagem. */
async function anunciarAoVivo(c, motivo, antes) {
  try {
    if (!portas.aoVivo?.anunciarConversa) return null;
    const r = await portas.aoVivo.anunciarConversa({
      db: db(), cwAccountId: c.cwAccountId, cwConversationId: c.cwConversationId, motivo, antes,
    });
    if (r?.ok) contadores.avisosAoVivo += 1;
    return r;
  } catch (e) {
    log().warn(`[ragnabot-webhook] aviso ao vivo não saiu (conversa ${c.cwConversationId}): ${e.message.slice(0, 160)}`);
    return null;
  }
}

/**
 * Que MOTIVO o aviso carrega. É só um rótulo para a tela decidir se precisa recarregar a conversa
 * aberta ou só a lista — nenhuma decisão de permissão passa por aqui.
 */
export function motivoAoVivoDe(c = {}) {
  if (c.tipo === 'conversation_created') return 'nova';
  if (c.acao === 'encerramento') return 'resolvida';
  if (c.classe === portariaModulo.CLASSES_ENTRADA.RESPOSTA_CLIENTE) return 'mensagem';
  // Saída humana e eco do motor também são fala NOVA dentro da conversa: quem está com ela aberta
  // precisa ver aparecer. `activity` (atribuiu, mudou de setor) não é fala — é mudança de estado.
  if (c.motivo === 'saida_humana' || c.motivo === 'eco_do_motor') return 'mensagem';
  return 'mudou';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A ROTA
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════════════════════════
// O TOQUE NO BOTÃO DO TELEGRAM — `answerCallbackQuery` (contrato S-CREDENCIAL-IG, 03/09/2026)
//
// POR QUE ISTO PRECISA EXISTIR. A referência da Bot API é explícita: «After the user presses a
// callback button, Telegram clients will display a progress bar until you call
// answerCallbackQuery. It is, therefore, necessary to react by calling answerCallbackQuery even if
// no notification to the user is needed». E a plataforma NÃO chama — `answerCallbackQuery` não
// aparece em lugar nenhum do repositório da v4.17.1. Sem isto, o cliente toca no botão e a
// barrinha fica girando no aparelho dele até a espera estourar, mesmo com o robô já respondendo.
//
// ─── COMO EU SEI QUE ESTE EVENTO É UM TOQUE, E NÃO UMA MENSAGEM DIGITADA ────────────────────────
// Não sei com certeza, e é honesto dizer isso antes de escrever a regra. A plataforma **apaga a
// diferença**: `Telegram::ParamHelpers#telegram_params_message_id` (lido na v4.17.1) devolve
//     params[:callback_query][:id]   quando é toque
//     params[:message][:message_id]  quando é mensagem
// e `Telegram::IncomingMessageService` grava os DOIS em `source_id: …to_s`. Ou seja, no webhook os
// dois chegam como mensagem `incoming` com `source_id` — o corpo original não vem junto.
//
// O que separa um do outro é a NATUREZA do número:
//   · `message_id` é um contador POR CONVERSA. Começa em 1 e cresce devagar — 4, 5, 87, 1204.
//   · `callback_query.id` é único no Telegram inteiro; na prática, 18-19 dígitos.
// Daí o corte em 13 dígitos: nenhuma conversa de atendimento chega a 10^13 mensagens, e nenhum
// `callback_query.id` observado é curto.
//
// ⚠️ E SE A HEURÍSTICA ERRAR? O estrago é ZERO, e essa é a razão de ela ser aceitável:
//   · falso POSITIVO (mensagem digitada tratada como toque) → mandamos um `answerCallbackQuery`
//     com um id que o Telegram não conhece; ele responde «query ID is invalid», que é 4xx, que
//     entra no contador `toquesNaoRespondidos` e no log. O cliente não vê nada;
//   · falso NEGATIVO (toque não reconhecido) → é exatamente o que acontecia antes deste contrato.
// O que NÃO pode acontecer, em nenhum dos dois casos, é a mensagem do cliente se perder — por isso
// esta função é chamada SEM `await` e engole tudo.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Quantos dígitos separam um `callback_query.id` de um `message_id`. Ver o bloco acima. */
const DIGITOS_DE_TOQUE = 13;

/** O canal da caixa, normalizado (`Channel::Telegram` → `telegram`). */
function canalDoEvento(evt = {}) {
  return String(evt.inbox?.channel_type ?? evt.conversation?.channel ?? '')
    .replace(/^Channel::/u, '').toLowerCase();
}

/**
 * ISTO PARECE UM TOQUE EM BOTÃO DO TELEGRAM? Função PURA — é a parte que erra por engano de regra,
 * e a barata de provar.
 */
export function pareceToqueDeBotao(evt = {}) {
  const nao = (motivo) => ({ ehToque: false, callbackQueryId: null, motivo });
  if (canalDoEvento(evt) !== 'telegram') return nao('canal_nao_telegram');
  if (String(evt.event || '') !== 'message_created') return nao('evento_nao_e_mensagem');
  if (tipoDeMensagem(evt.message_type) !== 'incoming') return nao('mensagem_nao_e_entrada');
  if (evt.private === true || evt.private === 'true') return nao('nota_interna');
  const id = String(evt.source_id ?? '');
  if (!id) return nao('sem_source_id');
  if (!/^\d+$/u.test(id)) return nao('source_id_nao_numerico');
  if (id.length < DIGITOS_DE_TOQUE) return nao('source_id_curto_demais');
  return { ehToque: true, callbackQueryId: id, motivo: 'toque_de_botao' };
}

async function moduloNativo() {
  if (portas.canalNativo) return portas.canalNativo;
  portas.canalNativo = await import('../services/ragnabot-canal-nativo.porta.js');
  return portas.canalNativo;
}

/**
 * RESPONDE AO TOQUE. **Nunca rejeita e nunca atrasa a resposta do webhook** — é chamada sem
 * `await`, de propósito: o toque tem prazo (o `callback_query` expira), mas a mensagem do cliente
 * tem PRIORIDADE, e uma ida à API do Telegram no meio do caminho quente seria latência colada na
 * gravação da mensagem.
 *
 * Exportada para o teste poder esperar por ela sem inventar temporizador.
 */
export async function responderToqueDoTelegram(evt = {}, c = {}, tenant = null) {
  try {
    const t = pareceToqueDeBotao(evt);
    if (!t.ehToque) return { respondido: false, motivo: t.motivo };
    const mod = await moduloNativo();
    await mod.responderCliqueTelegram({
      tenantId: tenant?.id ?? null,
      cwInboxId: c.cwInboxId ?? null,
      callbackQueryId: t.callbackQueryId,
    });
    contar('toquesRespondidos', 'toque_telegram_respondido');
    return { respondido: true, motivo: null };
  } catch (e) {
    const codigo = e?.codigo ?? 'ERRO';
    contar('toquesNaoRespondidos', `toque_telegram:${codigo}`);
    // ⛔ Sem o valor do token e sem a URL (que o carrega na consulta) — só o código e a descrição.
    log().warn(`[ragnabot-webhook] o toque no botão do Telegram não foi respondido (${codigo}): ${e.message}. `
      + 'A barrinha vai ficar girando no aparelho do cliente; a mensagem dele, não, foi gravada.');
    return { respondido: false, motivo: codigo };
  }
}

router.post('/', async (req, res) => {
  const token = req.get('x-ragnabot-token') || req.query.token;
  const ok = segredoConfere(token);
  if (ok === null) {
    log().error('[ragnabot-webhook] RAGNABOT_WEBHOOK_SEGREDO vazio — recusado');
    return res.status(503).json({ error: 'webhook não configurado' });
  }
  if (!ok) {
    log().warn(`[ragnabot-webhook] token inválido (ip=${req.ip})`);
    return res.status(401).json({ error: 'não autorizado' });
  }

  contadores.recebidos += 1;
  contadores.ultimoEm = new Date().toISOString();

  const evt = req.body || {};
  let c;
  try {
    c = classificarEvento(evt);
  } catch (e) {
    // Classificar é função pura sobre JSON de terceiro. Se ela estourar, o corpo é malformado —
    // reentregar não conserta corpo malformado. Descarta com registro e devolve 2xx.
    contar('descartados', 'corpo_ilegivel');
    contadores.ultimoErro = `classificacao:${e.message}`;
    log().warn(`[ragnabot-webhook] corpo ilegível: ${e.message}`);
    return res.json({ ok: true, descartado: 'corpo ilegível' });
  }

  // ── MULTI-INQUILINO: a empresa sai do evento, e conta desconhecida NUNCA é processada ────────
  let tenant = null;
  try {
    tenant = await tenantDaAccount(c.cwAccountId);
  } catch (e) {
    // O banco fora é o único caso em que vale reentregar: não gravamos nada.
    contar('naoGravados', 'banco_fora');
    contadores.ultimoErro = `tenant:${e.message}`;
    log().error(`[ragnabot-webhook] não consegui resolver a empresa da account ${c.cwAccountId}: ${e.message}`);
    return res.status(503).json({ error: 'indisponível; reenvie', code: 'BANCO_FORA' });
  }
  if (!tenant) {
    contar('contaDesconhecida', 'empresa_nao_mapeada');
    log().warn(`[ragnabot-webhook] evento ${c.tipo} de account ${c.cwAccountId} sem empresa mapeada — descartado`);
    // 2xx: não é erro nosso e reentregar não mudaria nada. Não deve virar fila de repetição.
    return res.json({ ok: true, descartado: 'empresa não mapeada', account: c.cwAccountId });
  }

  // ⭐ O TOQUE NO BOTÃO DO TELEGRAM, antes de tudo e SEM `await` (S-CREDENCIAL-IG).
  // Antes de tudo porque o `callback_query` tem prazo de validade; sem `await` porque a mensagem do
  // cliente é que não pode esperar. A função engole todo erro — o `.catch` aqui é cinto e
  // suspensório contra uma exceção síncrona que escape dela.
  responderToqueDoTelegram(evt, c, tenant).catch(() => { /* já registrado lá dentro */ });

  // ── MENSAGEM: o caminho novo, o do cliente ───────────────────────────────────────────────────
  if (c.acao === 'portaria') {
    if (c.cwConversationId === null) {
      contar('descartados', 'sem_conversa');
      log().warn(`[ragnabot-webhook] ${c.tipo} sem conversa identificável (empresa ${tenant.slug}) — descartado`);
      return res.json({ ok: true, descartado: 'sem conversa' });
    }

    let r;
    try {
      r = await portas.portaria.atenderMensagemRecebida({
        tenantId: tenant.id,
        cwAccountId: c.cwAccountId,
        cwConversationId: c.cwConversationId,
        cwInboxId: c.cwInboxId,
        texto: c.texto,
        mensagemId: c.mensagemId,
        evento: c.tipo,
        classe: c.classe,
        wamid: c.wamid,
        origemEm: c.origemEm,
        interativo: c.interativo,
        anexos: c.anexos,
        cwContactId: c.cwContactId,
        contatoChave: c.contatoChave,
      });
    } catch (e) {
      // ⚠️ ÚNICO caminho de não-2xx do fluxo de mensagem. A portaria só propaga quando NÃO
      // CONSEGUIU GRAVAR a entrada (P2002 ela mesma trata). Aí reentregar é a única forma de a
      // mensagem do cliente não sumir em silêncio — que é o defeito que o §1.2/(2) fecha.
      contar('naoGravados', 'portaria_nao_gravou');
      contadores.ultimoErro = `portaria:${e.message}`;
      log().error(`[ragnabot-webhook] a portaria não gravou a entrada (conversa ${c.cwConversationId}): ${e.message}`);
      return res.status(503).json({ error: 'não gravei; reenvie', code: 'NAO_GRAVADO' });
    }

    // Gravou. A partir daqui é SEMPRE 2xx — inclusive quando o resto degradou. O problema fica
    // visível no contador (e por ele no `/saude`) e no log, não na fila do Chatwoot.
    if (r?.ok === false && r?.resultado === portariaModulo.RESULTADOS_PORTARIA.DEGRADADA) {
      contar('degradados', `degradada:${String(r.motivo || '?').split(':')[0]}`);
      contadores.ultimoErro = `degradada:${r.motivo}`;
      log().warn(`[ragnabot-webhook] entrada gravada mas degradada (conversa ${c.cwConversationId}): ${r.motivo}`);
    } else if (r?.resultado === portariaModulo.RESULTADOS_PORTARIA.RECUSADA) {
      contar('descartados', 'endereco_incompleto');
    } else if (c.classe === portariaModulo.CLASSES_ENTRADA.RESPOSTA_CLIENTE) {
      contar('aceitos', `${c.motivo}→${r?.resultado}`);
    } else {
      contar('descartados', c.motivo);
    }

    // Índice da caixa: a conversa passa a existir na fila do agente. Depois do 2xx garantido pela
    // portaria e sem poder alterá-lo — ver o aviso de `projetarNaCaixa`.
    // `comRobo` sai do resultado da própria portaria: se ela acabou de criar (ou já achou) uma
    // execução de fluxo viva, a conversa está com o ROBÔ, e é isso que separa a sub-aba ChatBot da
    // sub-aba Aguardando. Sem este campo as duas colunas mostrariam o mesmo número.
    const comRobo = Boolean(r?.execucaoId);
    await projetarNaCaixa(tenant.id, c, evt, comRobo ? { comRobo: true } : {}, motivoAoVivoDe(c));

    return res.json({
      ok: true,
      classe: c.classe,
      motivo: c.motivo,
      resultado: r?.resultado ?? null,
      entradaId: r?.entradaId ?? null,
      execucaoId: r?.execucaoId ?? null,
      jobId: r?.jobId ?? null,
    });
  }

  // ── CONVERSA NASCEU: protocolo + auditoria (comportamento anterior, preservado) ──────────────
  //
  // ⚠️ 2xx SOMENTE DEPOIS DE GRAVAR. (Corrigido em 28/08/2026 — a versão anterior respondia 200
  // ANTES de processar, justificando com "o processamento é idempotente". O raciocínio estava
  // errado: idempotência protege contra DUPLICAR, não contra PERDER. Se o processo morresse entre
  // o 200 e a emissão do protocolo, o Chatwoot já teria recebido sucesso e NUNCA reenviaria —
  // aquele atendimento ficaria sem protocolo para sempre, em silêncio.)
  try {
    if (c.acao === 'protocolo') {
      if (c.cwConversationId === null) {
        contar('descartados', 'conversa_sem_id');
        return res.json({ ok: true, descartado: 'conversa sem id' });
      }
      const r = await portas.protocolo.emitirProtocolo({
        tenantId: tenant.id, cwAccountId: c.cwAccountId, cwConversationId: c.cwConversationId,
      });
      const proto = r.protocolo;
      if (r.novo) log().info(`[ragnabot-webhook] protocolo ${proto} emitido (empresa ${tenant.slug})`);

      // Auditoria de início — SOMENTE quando o protocolo é NOVO.
      // ⚠️ Sem este `if`, o reenvio do mesmo evento gravava um SEGUNDO "atendimento_iniciado" para
      // a mesma conversa. `r.novo` é a única fonte confiável de "isto aconteceu pela primeira vez":
      // vem do unique da conversa no banco.
      if (r.novo) {
        await portas.auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'sistema', categoria: 'atendimento', acao: 'atendimento_iniciado',
          protocolo: proto, entidade: 'conversation', entidadeId: String(c.cwConversationId),
          descricao: `Conversa ${c.cwConversationId} aberta`,
        });
      }
      // A conversa nasce na caixa AQUI — antes de qualquer mensagem. Sem isto, uma conversa criada
      // e nunca respondida ficaria fora da fila, que é justamente a que precisa ser vista.
      await projetarNaCaixa(tenant.id, c, evt, { protocolo: proto }, 'nova');

      contar('aceitos', 'protocolo');
      return res.json({ ok: true, protocolo: proto });
    }

    if (c.acao === 'encerramento') {
      if (c.status === 'resolved' || c.tipo === 'conversation_resolved') {
        const reg = await db().ragnabotProtocolo.findUnique({
          where: { cwAccountId_cwConversationId: { cwAccountId: Number(c.cwAccountId), cwConversationId: Number(c.cwConversationId) } },
        }).catch(() => null);
        await portas.auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'agent',
          atorId: evt.assignee?.id ? String(evt.assignee.id) : null,
          atorNome: evt.assignee?.name || null,
          categoria: 'atendimento', acao: 'atendimento_encerrado',
          protocolo: reg?.protocolo || null, entidade: 'conversation', entidadeId: String(c.cwConversationId),
          descricao: `Conversa ${c.cwConversationId} encerrada`,
        });
        // Quem resolveu é quem estava com a conversa na mão. É este par (carimbo + autor) que faz
        // o submenu Resolvidos ordenar por resolução mais recente e mostrar ao agente SÓ o que ele
        // resolveu — as duas metades do pedido nº 2 do dono.
        await projetarNaCaixa(tenant.id, c, evt, {
          statusPlataforma: 'resolved',
          resolvidaEm: new Date(),
          resolvidaPorCwUserId: evt.assignee?.id ?? null,
          resolvidaPorNome: evt.assignee?.name ?? null,
          protocolo: reg?.protocolo || undefined,
        }, 'resolvida');

        contar('aceitos', 'encerramento');
        return res.json({ ok: true });
      }
      contar('descartados', c.motivo);
      return res.json({ ok: true });
    }

    // Outros eventos (config, agentes) podem ser mapeados aqui conforme o Chatwoot os expuser.
    contar('descartados', c.motivo);
    log().debug(`[ragnabot-webhook] evento ${c.tipo} recebido (empresa ${tenant.slug}) — sem ação`);
    return res.json({ ok: true, semAcao: c.tipo });
  } catch (e) {
    // 503 = "não gravei, mande de novo". É o que transforma uma falha passageira (banco
    // reiniciando, rede piscando) em reenvio, em vez de evento perdido em silêncio. Vale só para o
    // caminho de protocolo/auditoria, que não tem gravação prévia da mensagem para se apoiar.
    contar('naoGravados', 'protocolo_ou_auditoria');
    contadores.ultimoErro = `${c.acao}:${e.message}`;
    log().error(`[ragnabot-webhook] erro ao processar ${c.tipo}: ${e.message}`);
    return res.status(503).json({ error: 'falha ao processar; reenvie' });
  }
});

export default router;
