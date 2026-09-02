// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DAS RESPOSTAS RÁPIDAS (contrato S1, 02/09/2026 — doc 34 §F1.3)
//
// ⚠️ O BACKEND JÁ EXISTE E ESTÁ TESTADO. `services/ragnabot-respostas-rapidas.service.js` (593
// linhas) e `routes/ragnabot-respostas-rapidas.routes.js` (284) estão no ar desde o contrato C9,
// montados em `servidor.js` com `autenticar` e SEM `adminOnly` — de propósito, porque quem mais usa
// resposta rápida é o atendente. O que faltava era TELA. Este arquivo é só o lado da rede dela;
// nenhuma regra de negócio nova nasce aqui.
//
// ── POR QUE UM ARQUIVO SEPARADO ─────────────────────────────────────────────────────────────────
// Mesma razão de `api-empresas.js`: `lib/api.js` tem `BASE_FLUXO` fixo e a convenção do editor de
// fluxo (sem envelope). Esta API mora em outro prefixo e responde objetos crus (`{itens,total}`,
// `{resposta}`, `{criada,resposta}`). Função com dois modos erra no modo errado. O que se
// reaproveita é o que TEM de ser único: `sessaoExpirada`, para 401 derrubar a sessão por um
// caminho só.
//
// ⛔ NENHUMA CREDENCIAL AQUI. A sessão é cookie HttpOnly assinado — daí `credentials: 'same-origin'`
// em todo pedido, e nenhum cabeçalho de ator (`x-ragnabot-ator-papel` só vale com o token de
// serviço, e mandá-lo do navegador é exatamente a escalada que o cookie fechou).
//
// ── A VALIDAÇÃO É CÓPIA DECLARADA DO SERVIDOR ───────────────────────────────────────────────────
// `normalizarAtalho` e `LIMITES` abaixo são cópia fiel de
// `services/ragnabot-respostas-rapidas.service.js`. Não é duplicação por descuido: é o que permite
// a tela mostrar "vai virar /bomdia" ENQUANTO se digita, e recusar antes da viagem perdida. Quem dá
// o veredito continua sendo o servidor (e o índice único do banco). ⚠️ Mudou lá, muda aqui.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-respostas-rapidas.routes.js`.
 *  ⭐ Passa pelo prefixo do deploy desde 02/09/2026 — ver `lib/prefixo.js`. */
export const BASE_RESPOSTAS = caminhoDoApp('/api/ragnabot-respostas-rapidas');

/** Cópia de `LIMITES` do serviço. */
export const LIMITES = Object.freeze({ atalho: 40, titulo: 120, mensagem: 4000 });

/** Cópia de `VISIBILIDADES` do serviço — o vocabulário fechado do escopo. */
export const VISIBILIDADES = Object.freeze([
  { valor: 'empresa', rotulo: 'Todos', apoio: 'Toda a equipe da empresa usa este atalho' },
  { valor: 'pessoal', rotulo: 'Só eu', apoio: 'Fica na sua gaveta; ninguém mais vê' },
]);

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. O PEDIDO
// ────────────────────────────────────────────────────────────────────────────────────────────────
function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

export async function chamarRespostas(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
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
    resposta = await fetch(`${BASE_RESPOSTAS}${caminho}`, opcoes);
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
    throw erro(dados?.error || `Erro HTTP ${resposta.status}`, {
      status: resposta.status, code: dados?.code, dados,
    });
  }
  return dados || {};
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. AS REGRAS DO ATALHO (cópia do servidor — ver o cabeçalho)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A forma canônica do atalho: minúscula, sem acento, sem espaço, sem a barra da frente.
 *
 * ⚠️ É o defeito nº 1 do recurso na origem: o atendente cadastra «Bom Dia», digita `/bomdia` e jura
 * que a resposta sumiu. Acento, maiúscula, espaço e barra são ruído de digitação, não identidade.
 *
 * ⛔ Esta função LANÇA, como a do servidor. Quem chama trata — é o que permite a tela dizer o que
 * está errado no campo em vez de mandar um atalho impossível para a rede.
 */
export function normalizarAtalho(valor) {
  const cru = String(valor ?? '').trim();
  if (!cru) throw erro('atalho: informe o atalho (ex.: /bomdia)', { campo: 'atalho' });

  const semAcento = cru.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const semBarra = semAcento.replace(/^\/+/u, '');
  const limpo = semBarra.replace(/\s+/gu, '_').replace(/[^a-z0-9_.-]/gu, '');

  if (!limpo) throw erro('atalho: use letras ou números (ex.: /bomdia)', { campo: 'atalho' });
  if (limpo.length > LIMITES.atalho) throw erro(`atalho: acima de ${LIMITES.atalho} caracteres`, { campo: 'atalho' });
  if (!/^[a-z0-9]/u.test(limpo)) throw erro('atalho: comece com letra ou número (ex.: /bomdia)', { campo: 'atalho' });
  return limpo;
}

/** Como o atalho é MOSTRADO e digitado. O banco guarda "bomdia"; a tela mostra "/bomdia". */
export function atalhoExibido(atalho) {
  return `/${atalho}`;
}

/**
 * A prévia do atalho ENQUANTO se digita — nunca lança. Devolve `{ ok, valor, erro }`.
 * Existe porque a tela precisa mostrar "vai virar /bom_dia" sem que cada tecla vire uma exceção.
 */
export function preverAtalho(valor) {
  try { return { ok: true, valor: normalizarAtalho(valor), erro: null }; }
  catch (e) { return { ok: false, valor: null, erro: e.message }; }
}

/**
 * Confere o formulário inteiro ANTES da rede. Devolve `{}` quando está bom, ou `{campo: motivo}`.
 * ⚠️ Recusar aqui é uma propriedade do MÓDULO — por isso `tests/respostas-rapidas.smoke.mjs`
 * consegue medir com um dublê de `fetch` que nada vazou para a rede. Validação escondida dentro de
 * um `onSubmit` de componente é validação que ninguém consegue provar.
 */
export function conferirFormulario(dados = {}) {
  const problemas = {};

  try { normalizarAtalho(dados.atalho); }
  catch (e) { problemas.atalho = e.message; }

  const titulo = String(dados.titulo ?? '').trim();
  if (!titulo) problemas.titulo = 'titulo: informe um nome curto para a resposta';
  else if (titulo.length > LIMITES.titulo) problemas.titulo = `titulo: acima de ${LIMITES.titulo} caracteres`;

  const mensagem = String(dados.mensagem ?? '');
  if (!mensagem.trim()) problemas.mensagem = 'mensagem: informe o texto da resposta';
  else if (mensagem.length > LIMITES.mensagem) problemas.mensagem = `mensagem: acima de ${LIMITES.mensagem} caracteres`;

  const vis = dados.visibilidade ?? 'empresa';
  if (!VISIBILIDADES.some((v) => v.valor === vis)) problemas.visibilidade = 'visibilidade: use "empresa" ou "pessoal"';

  return problemas;
}

/** Erro de validação com a forma que a tela espera — mesmo nome que `api-empresas.js` usa. */
export class ErroDeValidacao extends Error {
  constructor(problemas) {
    super(Object.values(problemas)[0] || 'Formulário inválido.');
    this.name = 'ErroDeValidacao';
    this.erros = problemas;
    this.status = 400;
  }
}

/** O corpo que vai para a rota, já normalizado. Nada de campo a mais: o servidor ignora o que não
 *  conhece, mas mandar lixo esconde o que a tela realmente controla. */
export function corpoParaSalvar(dados = {}) {
  const problemas = conferirFormulario(dados);
  if (Object.keys(problemas).length) throw new ErroDeValidacao(problemas);
  const corpo = {
    atalho: normalizarAtalho(dados.atalho),
    titulo: String(dados.titulo).trim(),
    mensagem: String(dados.mensagem),
    visibilidade: dados.visibilidade ?? 'empresa',
  };
  if (dados.ativa !== undefined) corpo.ativa = Boolean(dados.ativa);
  return corpo;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. AS CHAMADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** O vocabulário do servidor (visibilidades, variáveis, limites). Fica FORA da guarda de migração
 *  lá na rota, de propósito: a tela consegue se desenhar e mostrar o aviso mesmo num banco onde a
 *  tabela ainda não passou. Tela em branco esconde o motivo. */
export const lerOpcoes = () => chamarRespostas('/opcoes');

/** A lista. `incluirInativas` é escolha da tela — o servidor esconde as desligadas por padrão. */
export function lerRespostas({ busca = '', visibilidade = '', incluirInativas = false } = {}) {
  const q = new URLSearchParams();
  if (busca) q.set('busca', busca);
  if (visibilidade) q.set('visibilidade', visibilidade);
  if (incluirInativas) q.set('incluirInativas', 'true');
  const cauda = q.toString();
  return chamarRespostas(`/${cauda ? `?${cauda}` : ''}`);
}

// ⚠️ `async` DE PROPÓSITO, e não é estilo: `corpoParaSalvar` LANÇA quando o formulário está
// errado. Numa arrow comum (`const criar = (d) => chamar(..., corpoParaSalvar(d))`) esse erro sai
// de forma SÍNCRONA, e a mesma função passa a falhar de dois jeitos — exceção num caso, promessa
// recusada no outro. Quem chama com `.catch()` perde o erro de validação inteiro. Com `async`, há
// um caminho só. (Medido: foi o que reprovou duas medições de `tests/respostas-rapidas.smoke.mjs`
// na primeira versão deste arquivo.)
export async function criarResposta(dados) {
  return chamarRespostas('/', { metodo: 'POST', corpo: corpoParaSalvar(dados) });
}

export async function editarResposta(id, dados) {
  return chamarRespostas(`/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: corpoParaSalvar(dados) });
}

/** Liga/desliga sem abrir o formulário — é PATCH parcial, então vai só o campo. */
export const alternarAtiva = (id, ativa) =>
  chamarRespostas(`/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: { ativa: Boolean(ativa) } });

export const removerResposta = (id) =>
  chamarRespostas(`/${encodeURIComponent(id)}`, { metodo: 'DELETE' });

/** Como o texto vai ficar depois de trocadas as variáveis. Não grava nada. */
export const preverTexto = (mensagem) =>
  chamarRespostas('/previa', { metodo: 'POST', corpo: { mensagem } });

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. QUEM PODE MEXER — cópia de `podeMexerNesta`/`podeEscreverDaEmpresa` do serviço
//
// ⚠️ ISTO NÃO É PERMISSÃO, É CORTESIA. Serve para não desenhar um botão que o servidor vai recusar.
// A trava é o serviço (403), e o teste de aceite do isolamento é a API recusando — nunca o botão
// sumindo. Mesma regra escrita em `lib/navegacao.js`.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Resposta da EMPRESA é configuração: administrador. */
export function podeEscreverDaEmpresa(ator) {
  if (!ator) return false;
  return ator.isSuperuser === true || ator.papel === 'admin';
}

/** Resposta PESSOAL é de quem a criou; a da empresa, de quem administra. */
export function podeMexerNesta(ator, linha) {
  if (!ator || !linha) return false;
  if (ator.isSuperuser === true) return true;
  if (linha.visibilidade === 'pessoal') return String(linha.userId) === String(ator.id);
  return podeEscreverDaEmpresa(ator);
}
