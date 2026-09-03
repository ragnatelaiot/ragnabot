// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA TELA DE CONEXÕES (contrato S6, 02/09/2026 — doc 34 §F9.2 e §F9.4)
//
// ── POR QUE UM ARQUIVO SEPARADO (a mesma razão de `api-caixa.js` e `api-empresas.js`) ───────────
// `lib/api.js` é do editor de fluxo, com `BASE_FLUXO` fixo e sem envelope. `api-empresas.js` fala
// com `/api/ragnabot`, que responde SEMPRE `{success, data}`. Este router responde JSON CRU, como o
// da caixa de atendimento. Três convenções, três arquivos — uma função com três modos erraria no
// modo errado. O que se reaproveita é o que TEM de ser único: `sessaoExpirada`, para 401 derrubar
// a sessão por um caminho só.
//
// ⛔ NENHUM SEGREDO PASSA POR AQUI EM REPOUSO. O valor em claro de uma credencial de API ou de um
// segredo de webhook chega UMA vez, na resposta de emitir/regenerar, é mostrado na tela e some com
// ela. Não vai para `localStorage`, não entra em estado que sobrevive à navegação, e não volta em
// nenhuma listagem — o que a listagem traz é `digital` (sha256 truncado).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-conexao.routes.js`. */
export const BASE_CONEXOES = caminhoDoApp('/api/ragnabot-conexao');

function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

export async function chamarConexoes(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
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
    resposta = await fetch(`${BASE_CONEXOES}${caminho}`, opcoes);
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

function consulta(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── LEITURA ────────────────────────────────────────────────────────────────────────────────────
export const opcoesDeConexao = () => chamarConexoes('/opcoes');
export const lerConexoes = (filtros = {}) => chamarConexoes(`/conexoes${consulta(filtros)}`);
export const lerCota = (filtros = {}) => chamarConexoes(`/cota${consulta(filtros)}`);
export const lerRequisicoes = (cwInboxId, filtros = {}) =>
  chamarConexoes(`/conexoes/${encodeURIComponent(cwInboxId)}/requisicoes${consulta(filtros)}`);
export const lerRelatorio = (cwInboxId, filtros = {}) =>
  chamarConexoes(`/conexoes/${encodeURIComponent(cwInboxId)}/relatorio${consulta(filtros)}`);
export const lerTransferencias = (filtros = {}) => chamarConexoes(`/transferencias${consulta(filtros)}`);

// ── ESCRITA ────────────────────────────────────────────────────────────────────────────────────
export const trocarProvedor = (cwInboxId, corpo) =>
  chamarConexoes(`/conexoes/${encodeURIComponent(cwInboxId)}/provedor`, { metodo: 'PUT', corpo });
export const reiniciarConexao = (cwInboxId, motivo = null) =>
  chamarConexoes(`/conexoes/${encodeURIComponent(cwInboxId)}/reiniciar`, { metodo: 'POST', corpo: { motivo } });
export const previaDeTransferencia = (corpo) =>
  chamarConexoes('/transferencias/previa', { metodo: 'POST', corpo });
export const transferir = (corpo) => chamarConexoes('/transferencias', { metodo: 'POST', corpo });

// ── API PÚBLICA E WEBHOOKS ─────────────────────────────────────────────────────────────────────
export const lerCredenciais = (filtros = {}) => chamarConexoes(`/credenciais${consulta(filtros)}`);
export const emitirCredencial = (corpo) => chamarConexoes('/credenciais', { metodo: 'POST', corpo });
export const regenerarCredencial = (id, motivo = null) =>
  chamarConexoes(`/credenciais/${encodeURIComponent(id)}/regenerar`, { metodo: 'POST', corpo: { motivo } });
export const revogarCredencial = (id, motivo = null) =>
  chamarConexoes(`/credenciais/${encodeURIComponent(id)}/revogar`, { metodo: 'POST', corpo: { motivo } });
export const lerWebhooks = (filtros = {}) => chamarConexoes(`/webhooks${consulta(filtros)}`);
export const cadastrarWebhook = (corpo) => chamarConexoes('/webhooks', { metodo: 'POST', corpo });
export const lerEntregas = (filtros = {}) => chamarConexoes(`/webhooks/entregas${consulta(filtros)}`);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO DA TELA — puro, medível sem navegador
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O sinal de estado: cor, símbolo e a frase que o operador lê. */
export const SINAIS = Object.freeze({
  conectado: { rotulo: 'Conectada', cor: '#16a34a', simbolo: '●' },
  degradado: { rotulo: 'Instável', cor: '#d97706', simbolo: '◐' },
  desconectado: { rotulo: 'Desconectada', cor: '#dc2626', simbolo: '○' },
  // ⚠️ «Não medida» e NÃO «desconhecida»: a diferença importa numa tela de operação. O operador
  // precisa entender que ninguém olhou, e não que houve uma medição inconclusiva.
  desconhecido: { rotulo: 'Não medida', cor: '#64748b', simbolo: '◌' },
});

export function sinalDe(conexao) {
  return SINAIS[conexao?.estado] || SINAIS.desconhecido;
}

/**
 * A idade da medição, em português — e o AVISO quando ela envelheceu.
 *
 * ⚠️ Isto não é enfeite. «Conectada» medida há três dias é uma afirmação sobre o passado; numa
 * tela de operação isso é PIOR que «não medida», porque parece atual e ninguém desconfia.
 */
export function frescorDaMedicao(conexao, { minutosParaEnvelhecer = 60 } = {}) {
  if (conexao?.estado === 'desconhecido' || conexao?.estadoIdadeMin == null) {
    return { texto: 'nunca medida', velha: true };
  }
  const m = conexao.estadoIdadeMin;
  const texto = m < 1 ? 'medida agora há pouco'
    : m < 60 ? `medida há ${m} min`
      : m < 2880 ? `medida há ${Math.round(m / 60)} h`
        : `medida há ${Math.round(m / 1440)} d`;
  return { texto, velha: m >= minutosParaEnvelhecer };
}

/** «há 3 min», «há 2 h», «há 4 d» — a coluna «última atualização» da tela 40. */
export function desdeQuando(iso, agora = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const seg = Math.max(0, Math.round((agora - t) / 1000));
  if (seg < 60) return 'agora há pouco';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/**
 * A frase da cota, em português. Contador solto («4/5 · 80%») não diz a ninguém se pode ligar mais
 * uma — e é essa a única pergunta que se faz olhando para a cota.
 */
export function frasearCota(cota) {
  if (!cota) return 'Cota desconhecida.';
  const limite = cota.limite ?? '?';
  const base = `${cota.ativos} de ${limite} conexão(ões) — ${cota.usoPct ?? '?'}% do plano ${cota.planoRotulo || cota.plano}.`;
  if (cota.esgotado) return `${base} Não cabe mais nenhuma: desligue uma conexão que não é mais usada ou mude o plano.`;
  const sobra = Number.isFinite(cota.limite) ? cota.limite - cota.ativos : null;
  return sobra === null ? base : `${base} Ainda cabe${sobra === 1 ? 'm' : 'm'} ${sobra}.`;
}

/** A cor da barra de uso — verde, laranja, vermelho. Faixas iguais às do CTR da lista de fluxos. */
export function corDoUso(pct) {
  if (pct == null) return '#64748b';
  if (pct >= 100) return '#dc2626';
  if (pct >= 80) return '#d97706';
  return '#16a34a';
}
