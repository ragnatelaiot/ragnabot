// ════════════════════════════════════════════════════════════════════════════════════════════════
// QUEM RESOLVE A CREDENCIAL DE UM CANAL — a porta `credenciais` que o envio nativo esperava.
//
// Contrato S-CREDENCIAL-IG (03/09/2026). Este arquivo é o resolvedor que faltava: até ontem
// `ragnabot-canal-nativo.porta.js` nascia com `credenciais: null` e TODA escolha no Instagram caía
// em `SEM_CREDENCIAL` → texto numerado. O cabeçalho daquele arquivo dizia, corretamente, que
// «no dia em que o cofre existir, plugar o resolvedor é uma linha». O cofre existe agora
// (`ragnabot-segredo.service.js`); esta é a linha, e mais o que ela precisa saber.
//
// ─── A ORDEM DA BUSCA, E O PORQUÊ DE CADA DEGRAU ────────────────────────────────────────────────
//
//   1. COFRE, apelido da CONEXÃO      `RagnabotInbox.provedorConfig.segredoApelido`
//        O mais específico vence: duas conexões do mesmo canal na mesma empresa (dois perfis de
//        Instagram) precisam de tokens diferentes, e é aqui que isso se expressa.
//   2. COFRE, apelido convencional    `canal_<canal>_token`  (por empresa)
//        O caso comum: uma conexão por canal. Evita ter de tocar em `provedorConfig`.
//   3. AMBIENTE, token direto         `RAGNABOT_CANAL_<CANAL>_TOKEN`
//        ⭐ ESTE É O PONTO DE TROCA pedido pelo contrato. Ver o bloco «A DECISÃO DE SEGURANÇA».
//   4. AMBIENTE, token de SISTEMA     `RAGNABOT_META_TOKEN_SISTEMA` → token da PÁGINA, derivado
//        Só para a família Meta, e só quando não houve token direto. É o que temos hoje.
//
// Nenhum degrau é obrigatório e nenhum é fatal: se todos falharem, devolvemos `null`, o envio
// nativo recusa com `SEM_CREDENCIAL` e a escolha DEGRADA para texto numerado, declarando o motivo.
// A degradação é a rede que existia antes deste contrato e continua inteira — provada por teste.
//
// ─── ⚠️ A DECISÃO DE SEGURANÇA QUE O DONO PRECISA TOMAR (registrada, não escondida) ─────────────
// O token de sistema que temos hoje é o MESMO que o marketing usa para PUBLICAR. Ele carrega 29
// escopos, entre eles `instagram_content_publish` e `instagram_manage_insights` — ou seja, dar esse
// token ao motor de atendimento concede a ele publicar conteúdo e ler métricas, que ele não precisa.
// O motor precisa de dois: `instagram_manage_messages` e `pages_messaging`.
//
// Por isso o degrau 3 vem ANTES do 4: no dia em que o dono quiser separar, basta gerar um token de
// usuário de sistema só com os dois escopos de mensagem e gravá-lo em
// `RAGNABOT_CANAL_INSTAGRAM_TOKEN` no `Secret ragnabot-motor-env`. **Nenhuma linha de código muda**
// — o degrau 4 deixa de ser alcançado sozinho. É troca de valor no cofre, como o contrato pediu.
//
// ─── ⚠️ DOIS SABORES DE API DO INSTAGRAM, E POR QUE O `base` PASSOU A SER RESOLVÍVEL ────────────
// A Meta tem DOIS caminhos para mandar mensagem no Instagram, com URL diferente:
//   · «Instagram API with Instagram Login» → POST https://graph.instagram.com/vXX/me/messages
//     com um token de USUÁRIO DO INSTAGRAM;
//   · «Instagram API with Facebook Login»  → POST https://graph.facebook.com/vXX/<IG_ID>/messages
//     com o token da PÁGINA.
// O nosso token de sistema resolve o segundo caminho (ele devolve o token da Página em
// `GET /<paginaId>?fields=access_token`). O padrão de `LIMITES_NATIVOS.instagram` é o primeiro.
// Se este resolvedor devolvesse só `{ token }`, mandaríamos um token de Página para
// `graph.instagram.com` e a Meta recusaria — com um erro que parece "token inválido" e mandaria
// quem diagnostica trocar a credencial certa. Então o resolvedor declara também `base`, `versao` e
// `contaId`, e a porta nativa usa o que ele declarou (caindo no padrão quando ele não declara).
//
// ⚠️ NÃO EXERCITADO COM TRÁFEGO REAL. Em 03/09/2026 não há conversa de Instagram entrando. O que
// está provado é a cadeia de resolução, o cache, a degradação e o não-vazamento — com dublê.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import loggerGlobal from '../base/logger.js';
import cofreGlobal from './ragnabot-segredo.service.js';
import { digitalDoSegredo } from '../base/assinatura.js';

const portas = { db: prismaGlobal, cofre: cofreGlobal, buscar: null, log: null, ambiente: null };

export function configurarCredenciais(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no resolvedor de credencial: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDasCredenciais() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? loggerGlobal;
const env = () => portas.ambiente ?? process.env;

/** Canais da família Meta: mesmo dialeto de envio e mesma forma de derivar o token da Página. */
const FAMILIA_META = new Set(['instagram', 'facebook']);

const PADRAO_GRAFO = 'https://graph.facebook.com';
const PADRAO_VERSAO = 'v22.0';
/** 30 min. O token da Página derivado de um usuário de SISTEMA não expira sozinho, mas a página
 *  pode ser desvinculada e o token revogado a qualquer momento — validade curta é o que faz uma
 *  revogação virar erro em minutos em vez de ficar servida de um cache eterno. */
const PADRAO_CACHE_MS = 30 * 60 * 1000;

function numeroDoAmbiente(chave, padrao) {
  const n = Number(env()[chave]);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CACHE — por (empresa, canal, conexão), com validade
//
// Sem ele, cada escolha com botão no Instagram custaria uma leitura no banco e, no degrau 4, uma
// ida à Graph API ANTES de a mensagem sair. Numa fila de atendimento isso é latência multiplicada
// pelo número de clientes.
//
// ⛔ FALHA NÃO ENTRA NO CACHE. Guardar «não achei» faria uma credencial recém-cadastrada demorar até
// 30 min para valer — e o sintoma seria «guardei o token e o robô continua mandando texto».
// ────────────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map();

function chaveDeCache(tenantId, canal, cwInboxId) {
  return `${tenantId || '-'}|${canal}|${cwInboxId ?? '-'}`;
}

/** Limpa o cache. Chamada pelo teste e por quem trocar credencial em tempo de execução. */
export function esquecerCredenciais() { cache.clear(); }

/** O que o `/saude` pode mostrar: quantas entradas e quais chaves — NUNCA o token. */
export function estadoDoCache() {
  const agora = Date.now();
  return {
    entradas: cache.size,
    chaves: [...cache.entries()].map(([k, v]) => ({
      chave: k, fingerprint: v.fingerprint, origem: v.origem, expiraEmMs: Math.max(0, v.expiraEm - agora),
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A MONTAGEM DA CREDENCIAL — o token é propriedade NÃO-ENUMERÁVEL
//
// Mesmo desenho do cofre: `JSON.stringify(cred)` e `console.log(cred)` não publicam o token. É o
// vazamento por descuido que isto fecha, e é o que acontece de verdade num diagnóstico às pressas.
// ────────────────────────────────────────────────────────────────────────────────────────────────
function credencial(token, publico = {}) {
  const c = { ...publico, fingerprint: digitalDoSegredo(token) };
  Object.defineProperty(c, 'token', { value: token, enumerable: false, writable: false });
  Object.defineProperty(c, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => ({ ...c, token: '«oculto»' }), enumerable: false,
  });
  return c;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DEGRAU 4 — o token da PÁGINA, derivado do token de SISTEMA
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function chamarGrafo(url, { contexto }) {
  const buscar = portas.buscar || globalThis.fetch;
  if (typeof buscar !== 'function') return null;
  const cancelar = new AbortController();
  const relogio = setTimeout(() => cancelar.abort(), 10_000);
  try {
    const r = await buscar(url, { method: 'GET', signal: cancelar.signal });
    let dados = null;
    try { dados = await r.json(); } catch { dados = null; }
    if (!r.ok || dados?.error) {
      // ⛔ A URL NUNCA entra no log: ela carrega o token de sistema na consulta.
      const desc = dados?.error?.message || `HTTP ${r.status}`;
      log().warn?.(`[credencial] ${contexto}: a Meta recusou (${String(desc).slice(0, 200)})`);
      return null;
    }
    return dados ?? null;
  } catch (e) {
    log().warn?.(`[credencial] ${contexto}: falha de rede (${e.name === 'AbortError' ? 'tempo esgotado' : e.message})`);
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * `GET /<paginaId>?fields=access_token,instagram_business_account` com o token de SISTEMA.
 *
 * Devolve `{ token, contaId }` — o token da Página e, quando a página tem perfil de Instagram
 * vinculado, o id da conta de Instagram, que é o caminho do `POST …/messages` neste sabor de API.
 * Sem o vínculo, devolvemos a própria página: é o certo para o Messenger e é o que faz um erro
 * aparecer como «recipient inválido» em vez de silêncio.
 */
async function tokenDaPagina({ tokenDeSistema, paginaId, grafo, versao }) {
  const url = `${grafo}/${versao}/${encodeURIComponent(paginaId)}`
    + `?fields=access_token,instagram_business_account`
    + `&access_token=${encodeURIComponent(tokenDeSistema)}`;
  const r = await chamarGrafo(url, { contexto: `derivar o token da página ${paginaId}` });
  if (!r?.access_token) return null;
  return { token: String(r.access_token), contaId: r.instagram_business_account?.id ? String(r.instagram_business_account.id) : String(paginaId) };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A CADEIA
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function conexaoDoBanco(tenantId, cwInboxId) {
  if (!tenantId || cwInboxId === null || cwInboxId === undefined) return null;
  return db().ragnabotInbox
    .findFirst({ where: { tenantId, cwInboxId: Number(cwInboxId) }, select: { provedorConfig: true, metadata: true } })
    .catch(() => null);
}

/** Nome da variável de ambiente de um canal. `instagram` → `RAGNABOT_CANAL_INSTAGRAM_TOKEN`. */
function nomeDeAmbiente(canal, sufixo) {
  return `RAGNABOT_CANAL_${String(canal).toUpperCase().replace(/[^A-Z0-9]/gu, '_')}_${sufixo}`;
}

/**
 * A CREDENCIAL DE UM CANAL, ou `null`.
 *
 * @returns {Promise<null | { token: string, contaId?: string, base?: string, versao?: string,
 *                            origem: string, fingerprint: string }>}
 *   `token` é NÃO-ENUMERÁVEL de propósito (ver `credencial()`).
 */
export async function doCanal({ tenantId, cwInboxId = null, canal } = {}) {
  const c = String(canal || '').toLowerCase();
  if (!c) return null;

  const chave = chaveDeCache(tenantId, c, cwInboxId);
  const guardada = cache.get(chave);
  if (guardada && guardada.expiraEm > Date.now()) return guardada.cred;

  const validade = numeroDoAmbiente('RAGNABOT_CREDENCIAL_CACHE_MS', PADRAO_CACHE_MS);
  const guardar = (cred) => {
    if (!cred) return null;
    cache.set(chave, { cred, expiraEm: Date.now() + validade, fingerprint: cred.fingerprint, origem: cred.origem });
    return cred;
  };

  const conexao = await conexaoDoBanco(tenantId, cwInboxId);
  const cfg = (conexao?.provedorConfig && typeof conexao.provedorConfig === 'object') ? conexao.provedorConfig : {};
  const meta = (conexao?.metadata && typeof conexao.metadata === 'object') ? conexao.metadata : {};

  // O endereço da API é o mesmo em todos os degraus de token DIRETO: quem declarou, manda; senão
  // fica `undefined` e a porta nativa usa o padrão documentado do canal.
  const enderecoDeclarado = {
    contaId: cfg.contaId ?? meta.instagramId ?? meta.pageId ?? env()[nomeDeAmbiente(c, 'CONTA')] ?? undefined,
    base: cfg.grafo ?? env()[nomeDeAmbiente(c, 'GRAFO')] ?? undefined,
    versao: cfg.versaoGrafo ?? env()[nomeDeAmbiente(c, 'VERSAO')] ?? undefined,
  };

  // ── DEGRAU 1: apelido da CONEXÃO ────────────────────────────────────────────────────────────
  if (cfg.segredoApelido) {
    const s = await portas.cofre.ler({ tenantId, apelido: cfg.segredoApelido });
    if (s?.valor) return guardar(credencial(s.valor, { ...enderecoDeclarado, origem: `cofre:conexao:${s.apelido}` }));
    log().warn?.(`[credencial] a conexão ${cwInboxId} aponta para o segredo "${cfg.segredoApelido}", `
      + 'que não está no cofre desta empresa — seguindo para o próximo degrau');
  }

  // ── DEGRAU 2: apelido convencional da EMPRESA ───────────────────────────────────────────────
  const convencional = `canal_${c}_token`;
  const s2 = await portas.cofre.ler({ tenantId, apelido: convencional });
  if (s2?.valor) return guardar(credencial(s2.valor, { ...enderecoDeclarado, origem: `cofre:${convencional}` }));

  // ── DEGRAU 3: token DIRETO no ambiente (o ponto de troca) ───────────────────────────────────
  const direto = env()[nomeDeAmbiente(c, 'TOKEN')];
  if (direto) return guardar(credencial(String(direto), { ...enderecoDeclarado, origem: `ambiente:${nomeDeAmbiente(c, 'TOKEN')}` }));

  // ── DEGRAU 4: só Meta — derivar o token da PÁGINA a partir do token de SISTEMA ──────────────
  if (!FAMILIA_META.has(c)) {
    log().info?.(`[credencial] sem credencial para o canal "${c}" na empresa ${tenantId} `
      + `(procurei em ${cfg.segredoApelido ? 'apelido da conexão, ' : ''}"${convencional}" e ${nomeDeAmbiente(c, 'TOKEN')})`);
    return null;
  }

  const tokenDeSistema = (await portas.cofre.ler({ tenantId, apelido: 'meta_token_de_sistema' }))?.valor
    || env().RAGNABOT_META_TOKEN_SISTEMA;
  const paginaId = cfg.paginaId ?? meta.pageId ?? env().RAGNABOT_META_PAGINA_ID;
  if (!tokenDeSistema || !paginaId) {
    log().info?.(`[credencial] canal "${c}" sem token direto e sem `
      + `${!tokenDeSistema ? 'token de sistema' : 'id da página'} — não há de onde derivar`);
    return null;
  }

  const grafo = cfg.grafo ?? env().RAGNABOT_META_GRAFO ?? PADRAO_GRAFO;
  const versao = cfg.versaoGrafo ?? env().RAGNABOT_META_VERSAO ?? PADRAO_VERSAO;
  const derivada = await tokenDaPagina({ tokenDeSistema, paginaId, grafo, versao });
  if (!derivada) return null;

  // ⚠️ O sabor «Facebook Login» é o que combina com um token de PÁGINA: `graph.facebook.com` e a
  // conta no caminho. Declarar isto aqui é o que impede o token de Página de ir para
  // `graph.instagram.com` (ver o cabeçalho).
  return guardar(credencial(derivada.token, {
    contaId: enderecoDeclarado.contaId ?? derivada.contaId,
    base: enderecoDeclarado.base ?? grafo,
    versao: enderecoDeclarado.versao ?? versao,
    origem: 'derivada:token_de_sistema',
  }));
}

export default { configurarCredenciais, portasDasCredenciais, doCanal, esquecerCredenciais, estadoDoCache };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ
//
// • NÃO guarda o «não achei» em cache. Credencial recém-cadastrada vale na próxima mensagem.
// • NÃO renova nada sozinho. Um token de usuário de sistema não expira; um token de usuário comum
//   expira, e este resolvedor NÃO sabe trocá-lo por um de longa duração. Se um dia entrar token de
//   usuário comum aqui, a troca (`fb_exchange_token`) tem de ser escrita — e declarada.
// • NÃO fala com a plataforma de atendimento. O token do canal NÃO é publicado por ela (medido em
//   `_inbox.json.jbuilder`: para Instagram saem `instagram_id` e `reauthorization_required`, nunca
//   o token). Por isso o cofre e o ambiente são os únicos caminhos.
// • NÃO tem rota HTTP. Nada aqui pode virar resposta de API: `token` não é enumerável justamente
//   para que um `res.json(cred)` distraído não publique o segredo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
