// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA CAIXA DE ATENDIMENTO (contrato S2, 02/09/2026 — doc 34 §F2.2/2.3/2.4/2.7/2.8)
//
// ⛔ ESTA CAMADA NÃO FILTRA NADA. Quem decide o que este usuário enxerga é o servidor, no `where`
// da consulta (`services/ragnabot-caixa.service.js`). Aqui só se pede e se desenha. Se um dia
// alguém precisar acrescentar um filtro de visibilidade NESTE arquivo, o defeito está do outro
// lado — e resolvê-lo aqui seria trocar segurança por aparência, que é exatamente o que o contrato
// proíbe.
//
// ── POR QUE UM ARQUIVO SEPARADO ─────────────────────────────────────────────────────────────────
// Mesma razão de `api-respostas-rapidas.js` e `api-empresas.js`: `lib/api.js` tem `BASE_FLUXO` fixo
// e a convenção do editor de fluxo. O que se reaproveita é o que TEM de ser único — `sessaoExpirada`,
// para 401 derrubar a sessão por um caminho só.
//
// ⛔ NENHUMA CREDENCIAL AQUI. A sessão é cookie HttpOnly assinado; daí `credentials: 'same-origin'`
// em todo pedido e nenhum cabeçalho de ator.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-caixa.routes.js`. */
export const BASE_CAIXA = caminhoDoApp('/api/ragnabot-caixa');

/** As abas, com o rótulo em português. Cópia declarada do vocabulário do servidor (`ABAS`). */
export const ABAS = Object.freeze([
  { valor: 'abertas', rotulo: 'Abertas' },
  { valor: 'resolvidos', rotulo: 'Resolvidos' },
  { valor: 'grupos', rotulo: 'Grupos' },
]);

/** As sub-abas de "Abertas" (cópia de `SUBABAS`). A ordem é a da tela do chat atual. */
export const SUBABAS = Object.freeze([
  { valor: null, rotulo: 'Todas', contador: 'abertas' },
  { valor: 'atendendo', rotulo: 'Atendendo', contador: 'atendendo', apoio: 'Com atendente' },
  { valor: 'aguardando', rotulo: 'Aguardando', contador: 'aguardando', apoio: 'Na fila, sem atendente' },
  { valor: 'chatbot', rotulo: 'ChatBot', contador: 'chatbot', apoio: 'Com o robô' },
]);

function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

export async function chamarCaixa(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (corpo !== undefined) opcoes.body = JSON.stringify(corpo);

  let idTempo = null;
  if (tempoLimiteMs && typeof AbortController === 'function') {
    const ctrl = new AbortController();
    idTempo = setTimeout(() => ctrl.abort(), tempoLimiteMs);
    opcoes.signal = ctrl.signal;
  }

  let resposta;
  try {
    resposta = await fetch(`${BASE_CAIXA}${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw erro('O servidor demorou demais para responder.', { status: 0 });
    throw erro('Não consegui falar com o servidor.', { status: 0 });
  } finally {
    if (idTempo) clearTimeout(idTempo);
  }

  // Texto antes do JSON.parse: um 404 em HTML do proxy vira mensagem legível, não "Unexpected token <".
  const texto = await resposta.text();
  let dados = null;
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = null; } }

  if (resposta.status === 401) {
    sessaoExpirada('expired');
    throw erro('Sessão encerrada — entre de novo.', { status: 401 });
  }
  if (!resposta.ok) {
    throw erro(dados?.error || `Erro HTTP ${resposta.status}`, {
      status: resposta.status, code: dados?.code, dados,
    });
  }
  return dados || {};
}

function consulta(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function opcoesDaCaixa() { return chamarCaixa('/opcoes'); }

export function listarConversas(filtros = {}) {
  return chamarCaixa(`/conversas${consulta(filtros)}`);
}

export function contadores(filtros = {}) {
  return chamarCaixa(`/contadores${consulta(filtros)}`);
}

export function obterConversa(cwConversationId) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}`);
}

/** Histórico do contato DENTRO de um setor. `cwTeamId` é obrigatório — não existe modo global. */
export function historicoDoContato({ cwTeamId, contatoChave, cwContactId, limite } = {}) {
  return chamarCaixa(`/historico${consulta({ cwTeamId, contatoChave, cwContactId, limite })}`);
}

export function listarSetores() { return chamarCaixa('/setores'); }

/** Espelha setores e membros da plataforma. Administrador. É o que faz a fila do setor aparecer. */
export function sincronizarSetores() {
  return chamarCaixa('/sincronizar', { metodo: 'POST', corpo: {}, tempoLimiteMs: 120000 });
}

/**
 * RETROCARGA — traz para o índice as conversas que já existiam na plataforma.
 *
 * ⚠️ Necessária porque o índice se enche pelo AVISO da plataforma (webhook), e conversa que começou
 * antes de o aviso existir nunca gerou aviso nenhum. Sem isto, a fila nasce vazia com conversas
 * existentes invisíveis — e o operador conclui, com razão aparente, que o produto não funciona.
 *
 * `simular: true` mede e devolve o relatório SEM gravar nada. Tempo limite generoso: é varredura
 * de plataforma, página a página.
 */
export function retrocarregarConversas({ simular = false } = {}) {
  const caminho = simular ? '/retrocarga?simular=1' : '/retrocarga';
  return chamarCaixa(caminho, { metodo: 'POST', corpo: {}, tempoLimiteMs: 180000 });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ A MESA — aceitar · abrir/espiar · escrever · transferir (contrato S-ATENDER, 03/09/2026)
//
// ⛔ NENHUMA destas funções decide permissão. Todas perguntam ao servidor e desenham a resposta:
// `escrita.pode` vem de lá, `escrita.explicacao` vem de lá, a recusa vem de lá. Se um dia alguém
// precisar de um `if (usuario.role === …)` NESTE arquivo, a regra está no lugar errado.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Abre a conversa: a ficha, o histórico e a resposta a «posso escrever aqui?».
 *
 * É a MESMA chamada para ler a sua conversa e para espiar a da fila — quem separa os dois casos é o
 * servidor, e é ele quem registra a espiada. Uma rota só = um lugar só onde a permissão é resolvida.
 */
export function abrirConversa(cwConversationId, { antesDe, semMensagens } = {}) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}/abrir${consulta({ antesDe, semMensagens: semMensagens ? 1 : '' })}`, { tempoLimiteMs: 45000 });
}

/**
 * O endereço do anexo — do NOSSO painel, nunca o da plataforma.
 *
 * ⚠️ É uma URL, não um `fetch`: quem busca é a própria tag `<img>`/`<audio>`, com o cookie de
 * sessão de mesma origem. O endereço interno da plataforma não chega ao navegador em momento nenhum.
 */
export function enderecoDoAnexo(cwConversationId, cwMessageId, indice = 0) {
  return `${BASE_CAIXA}/conversas/${encodeURIComponent(cwConversationId)}/anexos/${encodeURIComponent(cwMessageId)}/${Number(indice) || 0}`;
}

/** ⭐ ACEITAR: a conversa passa a ser minha. Dois cliques ao mesmo tempo, um só vencedor (409 ao outro). */
export function aceitarConversa(cwConversationId, { cwTeamId } = {}) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}/aceitar`, { metodo: 'POST', corpo: { cwTeamId } });
}

/** ASSUMIR: só quem administra, e só para conversa que já tem dono. Registra como transferência. */
export function assumirConversa(cwConversationId) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}/assumir`, { metodo: 'POST', corpo: {} });
}

/** Escreve na conversa. `privada: true` = nota interna (fica para a equipe, não vai ao cliente). */
export function enviarMensagem(cwConversationId, { texto, privada = false } = {}) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}/mensagens`, { metodo: 'POST', corpo: { texto, privada } });
}

/** ⭐ TRANSFERIR para outro atendente e/ou outro setor. */
export function transferirConversa(cwConversationId, dados = {}) {
  return chamarCaixa(`/conversas/${encodeURIComponent(cwConversationId)}/transferir`, { metodo: 'POST', corpo: dados });
}

/** Os destinos possíveis — já filtrados pelo servidor conforme quem está pedindo. */
export function destinosDeTransferencia() { return chamarCaixa('/destinos'); }

export default {
  ABAS, SUBABAS, BASE_CAIXA, chamarCaixa,
  opcoesDaCaixa, listarConversas, contadores, obterConversa, historicoDoContato,
  listarSetores, sincronizarSetores, retrocarregarConversas,
  abrirConversa, enderecoDoAnexo, aceitarConversa, assumirConversa,
  enviarMensagem, transferirConversa, destinosDeTransferencia,
};
