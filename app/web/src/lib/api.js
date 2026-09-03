// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA INTERFACE DO RAGNABOT
//
// Doc 33, Etapa 4. Este arquivo é a ÚNICA coisa que mudou de comportamento na mudança de casa da
// tela — e mudou porque tinha de mudar: no NOC a tela falava com `/api/ragnabot-fluxo` do NOC, que
// autenticava por cookie de sessão do NOC. Aqui ela é servida pelo PRÓPRIO MOTOR e fala com ele,
// na mesma origem.
//
// ⛔ O QUE ESTE ARQUIVO NÃO É: uma cópia do `frontend/src/lib/api.js` do NOC. Aquele traz dezenas
// de métodos de Zabbix, Proxmox, Guacamole, alertas e backup — nada disso é do Ragnabot, e arrastá-lo
// junto seria mudar de casa levando a mudança inteira do vizinho. O que veio foram as CONVENÇÕES,
// não o código: `credentials`, ler como texto antes do `JSON.parse` (para que um 404 em HTML do
// proxy não vire "resposta inválida" enigmática) e a regra de 401/403.
//
// ── ⭐ A CREDENCIAL MUDOU (contrato S4-AUTH, 30/08/2026) — e é o ponto do arquivo ────────────────
// ANTES (versão que NUNCA foi ao ar, e por bom motivo): o motor injetava `window.__RAGNABOT__` com
// o `RAGNABOT_SERVICE_TOKEN` dentro, e esta camada o repassava em cabeçalho junto com o papel do
// operador. Duas consequências, as duas medidas e escritas em `web/COMO-SERVIR.md` §3:
//   1. qualquer navegador que alcançasse a página RECEBIA o segredo de serviço;
//   2. o papel viajava em `x-ragnabot-ator-papel`, cabeçalho que o cliente escolhe — quem tivesse
//      o token se declarava `super` e passava por `superuserOnly`.
//
// AGORA: a pessoa entra com a conta DELA da plataforma (`POST /sessao/entrar`) e o motor devolve um
// **cookie HttpOnly assinado**, com o papel dentro do conteúdo assinado. Esta camada não tem, não
// lê e não guarda credencial nenhuma: o navegador manda o cookie sozinho, por ser mesma origem.
// Por isso `credentials: 'same-origin'` em TODO pedido — sem ele o `fetch` não envia o cookie.
//
// ⛔ E NADA VAI PARA `localStorage`. Cookie HttpOnly não é legível por script: um XSS na página não
// consegue copiar a sessão. Guardar qualquer eco dela em `localStorage` jogaria essa proteção fora.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { caminhoDoApp } from './prefixo.js';

/** O caminho é o MESMO do NOC de propósito: o motor monta `/api/ragnabot-fluxo` no mesmo lugar
 *  (`app/src/servidor.js`), então nenhuma URL da tela precisou ser reescrita.
 *
 *  ⭐ MUDOU EM 02/09/2026 (contrato S1): o caminho passa por `caminhoDoApp`, que acrescenta o
 *  prefixo do deploy quando existe um. Sem isso, servida em `bot.ragnatela.com.br/motor-api/`, a
 *  tela pediria `/api/ragnabot-fluxo/…` na RAIZ do domínio — ou seja, no Ingress da plataforma, e
 *  não no motor. O sintoma seria «não consigo falar com o servidor» com o motor de pé.
 *  Na raiz (`RAGNABOT_PREFIXO_WEB` ausente) o valor é exatamente o de antes. */
export const BASE_FLUXO = caminhoDoApp('/api/ragnabot-fluxo');
/** Onde o motor monta `src/rotas-sessao.js` (ver `app/src/COMO-MONTAR-SESSAO.md`). */
export const BASE_SESSAO = caminhoDoApp('/sessao');

// ────────────────────────────────────────────────────────────────────────────────────────────────
// QUEM ESTÁ LOGADO
// Guardado em memória do módulo, e só depois de o SERVIDOR ter dito. Não é fonte de verdade de
// permissão nenhuma — serve para a tela saber o que desenhar. Quem decide escopo é o motor.
// ────────────────────────────────────────────────────────────────────────────────────────────────
let sessao = null;

/** Avisa a página que a sessão mudou (carregou, entrou, saiu). Sem isto, o rodapé leria a versão
 *  ANTES de o motor ter respondido quem é, e mostraria "versão não informada" para sempre. */
export const EVENTO_SESSAO_MUDOU = 'ragnabot:sessao-mudou';
function anunciar() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_MUDOU, { detail: { autenticado: Boolean(sessao) } }));
}

/** Pergunta ao motor quem está logado. `null` = ninguém (a tela mostra a entrada). */
export async function carregarSessao() {
  try {
    const r = await fetch(`${BASE_SESSAO}/eu`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (r.status === 401) { sessao = null; anunciar(); return null; }
    const texto = await r.text();
    let dados = null;
    try { dados = JSON.parse(texto); } catch { dados = null; }
    if (!r.ok || !dados?.autenticado) {
      sessao = null;
      anunciar();
      // 503 aqui é diagnóstico, não "sua senha está errada": o motor subiu sem a chave de sessão.
      if (r.status === 503) throw Object.assign(new Error(dados?.mensagem || 'A entrada está desligada nesta instalação.'), { status: 503 });
      return null;
    }
    sessao = dados;
    anunciar();
    return sessao;
  } catch (e) {
    if (e?.status === 503) throw e;
    sessao = null;
    anunciar();
    throw Object.assign(new Error('Não consegui falar com o servidor.'), { status: 0 });
  }
}

/**
 * Entra. A senha vai no corpo do pedido e NÃO fica em lugar nenhum aqui — nem em variável de
 * módulo, nem em `localStorage`. Quem confere é a plataforma; quem emite a sessão é o motor.
 *
 * @param {{email:string, senha:string, codigo?:string, contaId?:number}} dados
 */
export async function entrar({ email, senha, codigo, contaId }) {
  const r = await fetch(`${BASE_SESSAO}/entrar`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, senha, codigo: codigo || undefined, contaId: contaId ?? undefined }),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { dados = null; }
  if (!r.ok) {
    const e = new Error(dados?.mensagem || `Não consegui entrar (erro ${r.status}).`);
    e.status = r.status;
    e.code = dados?.error;
    e.dados = dados;      // 409 ESCOLHA_CONTA traz a lista de empresas
    throw e;
  }
  sessao = dados;
  anunciar();
  return sessao;
}

/** Sai. Sempre limpa o lado de cá, mesmo se o servidor não responder — sair tem de sair. */
export async function sair() {
  try {
    await fetch(`${BASE_SESSAO}/sair`, { method: 'POST', credentials: 'same-origin' });
  } catch { /* o cookie é HttpOnly e de sessão curta; o essencial é a tela voltar à entrada */ }
  sessao = null;
  anunciar();
}

/** Quem a interface acha que é. Serve só para MOSTRAR (rodapé, campo de empresa na modal).
 *  ⚠️ Nunca para decidir o que pode ser feito: quem decide escopo é o servidor. */
export function atorAtual() {
  return sessao?.ator || {};
}

/** A empresa da sessão, quando o motor a resolveu. `null` quando a conta ainda não é cadastrada. */
export function empresaAtual() {
  return sessao?.empresa || null;
}

/**
 * A CONTA na plataforma de atendimento (`cwAccountId`) desta sessão — `null` quando não se sabe.
 *
 * ⭐ 02/09/2026 (contrato S-CASCA). Existe por causa das telas EMBUTIDAS: o endereço do painel do
 * fornecedor é `/app/accounts/<conta>/…`, e esse número tem de vir da SESSÃO, nunca de um valor
 * escrito à mão. Chutar `1` abriria a conta de outra empresa para quem por acaso tivesse acesso a
 * ela — e um «acesso negado» para todo o resto, sem dizer por quê.
 *
 * ⚠️ Como tudo que sai daqui: serve para MOSTRAR e para montar endereço. Quem decide escopo é o
 * servidor — o do fornecedor, no caso das telas dele.
 */
export function contaAtual() {
  const id = sessao?.conta?.id;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Versão do motor, se ele a tiver informado. `null` é dito em voz alta na tela, em vez de virar
 *  "1.00.00" por otimismo. */
export function versaoDoMotor() {
  return sessao?.versao || null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// SESSÃO PERDIDA
// No NOC isto era `forceSessionExpired` de `lib/api.js`: limpava o `localStorage` do NOC e emitia
// `noc:auth-expired`, que o layout do NOC escutava para devolver ao login DELE. Aqui o equivalente
// honesto é emitir um evento próprio e deixar quem monta a página decidir — `main.jsx` escuta e
// devolve à tela de entrada, que agora existe.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const EVENTO_SESSAO_EXPIRADA = 'ragnabot:sessao-expirada';

export function sessaoExpirada(motivo = 'expired') {
  sessao = null;
  if (typeof window === 'undefined') return;
  anunciar();
  window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIRADA, { detail: { motivo } }));
}

/**
 * Chama a API de fluxo do motor.
 *
 * ⚠️ 403 com code INVALID_2FA NUNCA desloga — regra da casa. E 401 fora do login derruba a sessão
 * por um caminho só, para não haver dois comportamentos.
 * ⚠️ 404 destas rotas significa "fora do escopo OU rota não montada", e NUNCA "sem permissão":
 * o router responde 404 de propósito, para não virar oráculo de enumeração entre empresas.
 */
export async function chamarFluxo(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
  // Nenhum cabeçalho de credencial, e nenhum de ator: o cookie de sessão vai sozinho e o papel
  // está DENTRO dele, assinado. Mandar papel daqui é exatamente o defeito que o cookie fechou.
  const headers = { 'Content-Type': 'application/json' };
  const opcoes = { method: metodo, headers, credentials: 'same-origin' };
  if (corpo !== undefined) opcoes.body = JSON.stringify(corpo);

  let idTempo = null;
  if (tempoLimiteMs) {
    const ctrl = new AbortController();
    idTempo = setTimeout(() => ctrl.abort(), tempoLimiteMs);
    opcoes.signal = ctrl.signal;
  }
  let resposta;
  try {
    resposta = await fetch(`${BASE_FLUXO}${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error('O servidor demorou demais para responder.'), { status: 0 });
    throw Object.assign(new Error('Não consegui falar com o servidor.'), { status: 0 });
  } finally {
    if (idTempo) clearTimeout(idTempo);
  }

  const texto = await resposta.text();
  let dados = null;
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = null; } }

  if (resposta.status === 401) {
    sessaoExpirada('expired');
    throw Object.assign(new Error('Sessão encerrada — entre de novo.'), { status: 401 });
  }
  if (!resposta.ok) {
    const e = new Error(dados?.error || `Erro HTTP ${resposta.status}`);
    e.status = resposta.status;
    e.code = dados?.code;
    e.dados = dados;               // 503 traz `detalhe` e `procurado`; 409 traz revEnviada/revAtual
    throw e;
  }
  return dados || {};
}

/** Texto único para o 503 de componente ausente do motor — é diagnóstico, não erro do operador. */
export function textoDeIndisponibilidade(e) {
  if (!e || e.status !== 503) return null;
  const d = e.dados || {};
  return {
    titulo: e.message,
    detalhe: d.detalhe || null,
    procurado: Array.isArray(d.procurado) ? d.procurado : [],
    esperadas: Array.isArray(d.exportacoesEsperadas) ? d.exportacoesEsperadas : [],
  };
}
