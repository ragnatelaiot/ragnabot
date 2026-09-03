// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA TELA DE CONFIGURAÇÕES (contrato S7, 02/09/2026 — doc 34 §F8)
//
// Mesma convenção de `api-conexoes.js` e `api-caixa.js`: o router responde JSON CRU (sem envelope
// `{success, data}`), e o 401 derruba a sessão por UM caminho só (`sessaoExpirada`).
//
// ── ⛔ O QUE ESTA CAMADA NÃO FAZ, E É O PONTO DO ARQUIVO ────────────────────────────────────────
// Ela NÃO decide o que a pessoa pode ver. `quemSou()` PERGUNTA ao servidor quais painéis existem
// para esta conta; a tela desenha o que vier. Se um dia a tela e a API discordarem, quem manda é
// a API — a tela é desenho, ela é a tranca. Um `if (papel === 'admin')` aqui seria exatamente o
// erro que o doc 34 §F8 alerta: aba escondida com a rota respondendo é falha de segurança.
//
// ⛔ E NENHUM SEGREDO PASSA POR AQUI EM REPOUSO. A senha de SMTP e a chave de IA sobem uma vez, no
// corpo do PUT, e nunca voltam: o que a listagem traz é `definido` e `impressaoDigital`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-configuracao.routes.js`. */
export const BASE_CONFIG = caminhoDoApp('/api/ragnabot-config');

function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

export async function chamarConfig(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
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
    resposta = await fetch(`${BASE_CONFIG}${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw erro('O servidor demorou demais para responder.', { status: 0 });
    throw erro('Não consegui falar com o servidor.', { status: 0 });
  } finally {
    if (idTempo) clearTimeout(idTempo);
  }

  // Texto antes do JSON.parse: um 404 em HTML do proxy vira mensagem legível.
  const texto = await resposta.text();
  let dados = null;
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = null; } }

  if (resposta.status === 401) {
    sessaoExpirada('expired');
    throw erro('Sessão encerrada — entre de novo.', { status: 401 });
  }
  if (!resposta.ok) {
    throw erro(dados?.error || `Erro HTTP ${resposta.status}`, { status: resposta.status, code: dados?.code, dados });
  }
  return dados || {};
}

// ── QUEM SOU: o que ESTA conta pode desenhar (a resposta vem do servidor, não daqui) ────────────
export const quemSou = () => chamarConfig('/quem-sou');

// ── PAINÉIS DA EMPRESA ─────────────────────────────────────────────────────────────────────────
export const lerPaineis = () => chamarConfig('/paineis');
export const lerPainel = (painel) => chamarConfig(`/painel/${encodeURIComponent(painel)}`);
export const salvarPainel = (painel, valores) =>
  chamarConfig(`/painel/${encodeURIComponent(painel)}`, { metodo: 'PUT', corpo: { valores } });

// ── PAINÉIS DO OPERADOR DO SaaS (403 para conta de cliente — a trava é do servidor) ────────────
export const lerWhitelabel = () => chamarConfig('/whitelabel');
export const salvarWhitelabel = (valores) => chamarConfig('/whitelabel', { metodo: 'PUT', corpo: { valores } });
export const lerEmpresasDoSaas = (status = null) =>
  chamarConfig(`/empresas${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const lerPlanosDoSaas = () => chamarConfig('/planos');

// ── APOIO ──────────────────────────────────────────────────────────────────────────────────────
export const lerPendentesDeDecisao = () => chamarConfig('/pendentes-de-decisao');
export const lerProvedoresDeIa = () => chamarConfig('/provedores-de-ia');

export default {
  BASE_CONFIG, chamarConfig, quemSou, lerPaineis, lerPainel, salvarPainel,
  lerWhitelabel, salvarWhitelabel, lerEmpresasDoSaas, lerPlanosDoSaas,
  lerPendentesDeDecisao, lerProvedoresDeIa,
};
