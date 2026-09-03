// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DO AGENDAMENTO DE MENSAGENS (contrato S4, 02/09/2026 — doc 34 §F4)
//
// ── POR QUE UM ARQUIVO SEPARADO ─────────────────────────────────────────────────────────────────
// Mesma razão de `api-respostas-rapidas.js` e `api-empresas.js`: `lib/api.js` tem `BASE_FLUXO` fixo
// e a convenção do editor de fluxo. Esta API mora em outro prefixo e responde objetos crus
// (`{itens,total}`, `{agendamento}`, `{envios}`). Função com dois modos erra no modo errado.
// O que se reaproveita é o que TEM de ser único: `sessaoExpirada`, para 401 derrubar a sessão por
// um caminho só.
//
// ⛔ NENHUMA CREDENCIAL AQUI. A sessão é cookie HttpOnly assinado — daí `credentials: 'same-origin'`
// em todo pedido, e nenhum cabeçalho de ator.
//
// ── A VALIDAÇÃO É CÓPIA DECLARADA DO SERVIDOR ───────────────────────────────────────────────────
// `LIMITES`, `RECORRENCIAS` e `normalizarContatoChave` abaixo são cópia fiel de
// `services/ragnabot-agendamento.service.js`. Não é duplicação por descuido: é o que permite a tela
// dizer «este número está curto» ENQUANTO se digita, em vez de mandar uma lista inteira para o
// servidor devolver erro. Quem dá o veredito continua sendo o servidor (e o índice único do banco).
// ⚠️ Mudou lá, muda aqui.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-agendamento.routes.js`. */
export const BASE_AGENDAMENTO = caminhoDoApp('/api/ragnabot-agendamento');

/** Cópia de `LIMITES` do serviço. */
export const LIMITES = Object.freeze({ titulo: 160, mensagem: 4000, destinos: 500, intervalo: 365 });

/** Cópia de `RECORRENCIAS`, já com o rótulo em português da tela. */
export const RECORRENCIAS = Object.freeze([
  { valor: 'unica', rotulo: 'Uma vez só', apoio: 'Dispara na data marcada e encerra' },
  { valor: 'diaria', rotulo: 'Diária', apoio: 'A cada N dias, no mesmo horário' },
  { valor: 'semanal', rotulo: 'Semanal', apoio: 'Nos dias da semana escolhidos' },
  { valor: 'mensal', rotulo: 'Mensal', apoio: 'No mesmo dia do mês (fim de mês é aparado)' },
]);

export const DIAS_SEMANA = Object.freeze([
  { valor: 0, rotulo: 'Dom' }, { valor: 1, rotulo: 'Seg' }, { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' }, { valor: 4, rotulo: 'Qui' }, { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
]);

/**
 * Como cada estado de ENVIO é mostrado. O vocabulário é maior que «enviado/falhou» de propósito:
 * as situações do meio são justamente as que não podem virar silêncio na tela.
 */
export const STATUS_ENVIO = Object.freeze({
  reservado: { rotulo: 'Saindo agora', cor: '#8b8b8b', apoio: 'Reservado; o envio ainda não voltou' },
  enviado: { rotulo: 'Enviada', cor: '#1f9d55', apoio: 'O destino confirmou' },
  sem_janela: { rotulo: 'Fora da janela de 24 h', cor: '#c47f00', apoio: 'NÃO saiu: sem modelo aprovado da Meta não há caminho fora da janela' },
  adiado: { rotulo: 'Adiada', cor: '#2b6cb0', apoio: 'Não havia por onde sair; será tentada de novo' },
  falhou: { rotulo: 'Falhou', cor: '#c53030', apoio: 'O destino recusou' },
  duvidoso: { rotulo: 'Em dúvida', cor: '#805ad5', apoio: 'Pode ter saído. Não repetimos sozinhos — confira e reenvie se precisar' },
  cancelado: { rotulo: 'Cancelada', cor: '#718096', apoio: 'O agendamento foi cancelado antes de este envio sair' },
});

export const STATUS_AGENDAMENTO = Object.freeze({
  pendente: { rotulo: 'Pendente', cor: '#2b6cb0' },
  pausado: { rotulo: 'Pausado', cor: '#c47f00' },
  concluido: { rotulo: 'Concluído', cor: '#1f9d55' },
  cancelado: { rotulo: 'Cancelado', cor: '#718096' },
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. O PEDIDO
// ────────────────────────────────────────────────────────────────────────────────────────────────
function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

export async function chamarAgendamento(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
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
    resposta = await fetch(`${BASE_AGENDAMENTO}${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw erro('O servidor demorou demais para responder.', { status: 0 });
    throw erro('Não consegui falar com o servidor.', { status: 0 });
  } finally {
    if (idTempo) clearTimeout(idTempo);
  }

  // Ler como TEXTO antes do JSON.parse: um 404 em HTML do proxy vira mensagem legível em vez de
  // "Unexpected token <", que não diz nada a ninguém.
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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. AS REGRAS COPIADAS DO SERVIDOR (ver o cabeçalho)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O telefone, na forma que o servidor guarda: só dígitos.
 *
 * ⚠️ NUNCA LANÇA. A tela precisa mostrar «(98) 9 8335-1000 → 98983351000» a cada tecla, e uma
 * exceção por tecla transformaria o campo num campo minado. Quem recusa é o servidor.
 */
export function preverContato(valor, canal = 'whatsapp') {
  const cru = String(valor ?? '').trim();
  if (!cru) return { ok: false, valor: '', erro: 'informe o telefone' };
  const numerico = ['whatsapp', 'telegram', 'sms'].includes(String(canal || '').toLowerCase());
  if (!numerico) return { ok: true, valor: cru.slice(0, 200), erro: null };
  const digitos = cru.replace(/\D+/gu, '');
  if (digitos.length < 8) return { ok: false, valor: digitos, erro: 'número curto demais' };
  return { ok: true, valor: digitos, erro: null };
}

/** Uma lista colada («um por linha, ou separados por vírgula») vira destinatários únicos. */
export function lerListaDeContatos(texto, canal = 'whatsapp') {
  const partes = String(texto ?? '').split(/[\n;,]+/u).map((p) => p.trim()).filter(Boolean);
  const vistos = new Set();
  const bons = [];
  const ruins = [];
  for (const p of partes) {
    const r = preverContato(p, canal);
    if (!r.ok) { ruins.push({ entrada: p, erro: r.erro }); continue; }
    if (vistos.has(r.valor)) continue; // repetido some sem alarde: o índice único faria o mesmo
    vistos.add(r.valor);
    bons.push(r.valor);
  }
  return { bons, ruins };
}

/**
 * O que o `<input type="datetime-local">` devolve («2026-09-03T08:00») → ISO absoluto.
 *
 * ⚠️ ARMADILHA CONHECIDA: `new Date('2026-09-03T08:00')` é interpretado no fuso DO NAVEGADOR, e o
 * navegador do operador pode não estar no fuso da empresa. Como o servidor canoniza a hora usando o
 * `fuso` do agendamento, mandamos o ISO e deixamos a decisão lá — mas a tela AVISA quando os dois
 * fusos divergem, em vez de deixar a pessoa descobrir pela mensagem saindo uma hora errada.
 */
export function paraISO(valorLocal) {
  if (!valorLocal) return null;
  const d = new Date(valorLocal);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** O fuso do navegador — para a tela poder comparar com o fuso escolhido no agendamento. */
export function fusoDoNavegador() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/** Data e hora legíveis NO FUSO DO AGENDAMENTO — que é o único relógio que importa aqui. */
export function noFuso(iso, fuso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso || 'America/Fortaleza', hourCycle: 'h23',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return String(iso); }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. AS CHAMADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────
const q = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const opcoesDoAgendamento = () => chamarAgendamento('/opcoes');
export const listarAgendamentos = (filtros = {}) => chamarAgendamento(`/${q(filtros)}`);
export const obterAgendamento = (id, params = {}) => chamarAgendamento(`/${encodeURIComponent(id)}${q(params)}`);
export const historicoDoAgendamento = (id, params = {}) => chamarAgendamento(`/${encodeURIComponent(id)}/historico${q(params)}`);
export const criarAgendamento = (corpo) => chamarAgendamento('/', { metodo: 'POST', corpo });
export const editarAgendamento = (id, corpo) => chamarAgendamento(`/${encodeURIComponent(id)}`, { metodo: 'PUT', corpo });
export const pausarAgendamento = (id, corpo = {}) => chamarAgendamento(`/${encodeURIComponent(id)}/pausar`, { metodo: 'POST', corpo });
export const retomarAgendamento = (id, corpo = {}) => chamarAgendamento(`/${encodeURIComponent(id)}/retomar`, { metodo: 'POST', corpo });
export const cancelarAgendamento = (id, corpo = {}) => chamarAgendamento(`/${encodeURIComponent(id)}/cancelar`, { metodo: 'POST', corpo });
export const reenviarEnvio = (chave, corpo = {}) => chamarAgendamento(`/envios/${encodeURIComponent(chave)}/reenviar`, { metodo: 'POST', corpo });

/** A prévia da grade: as próximas N ocorrências, sem gravar nada. É o que evita descobrir que
 *  «a cada 2 semanas, terça e quinta» não era o que se queria só depois de o cliente reclamar. */
export const previaDaGrade = (corpo) => chamarAgendamento('/previa', { metodo: 'POST', corpo });

export default {
  BASE_AGENDAMENTO, LIMITES, RECORRENCIAS, DIAS_SEMANA, STATUS_ENVIO, STATUS_AGENDAMENTO,
  chamarAgendamento, preverContato, lerListaDeContatos, paraISO, fusoDoNavegador, noFuso,
  opcoesDoAgendamento, listarAgendamentos, obterAgendamento, historicoDoAgendamento,
  criarAgendamento, editarAgendamento, pausarAgendamento, retomarAgendamento, cancelarAgendamento,
  reenviarEnvio, previaDaGrade,
};
