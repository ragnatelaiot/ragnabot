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

export default {
  ABAS, SUBABAS, BASE_CAIXA, chamarCaixa,
  opcoesDaCaixa, listarConversas, contadores, obterConversa, historicoDoContato,
  listarSetores, sincronizarSetores, retrocarregarConversas,
};
