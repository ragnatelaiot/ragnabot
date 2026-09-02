// ════════════════════════════════════════════════════════════════════════════════════════════════
// ONDE ESTA INTERFACE ESTÁ PENDURADA — a raiz, ou um prefixo
//
// Contrato S1 (02/09/2026). Nasceu de uma medição feita ao ligar o roteador, e ela é desagradável:
// o motor está publicado em `bot.ragnatela.com.br/motor-api/` (`app/deploy/ragnabot-motor-ingress.
// yaml`, com `rewrite-target: /$2` — o prefixo some antes de chegar à aplicação). Nesse arranjo,
// TODO caminho absoluto que a tela escreve sai errado:
//     · `/assets/index-*.js`      → cai no Ingress da plataforma, não no motor  → tela BRANCA
//     · `/api/ragnabot-fluxo/…`   → idem                                        → «não consigo
//                                                                                  falar com o
//                                                                                  servidor»
//     · `/capas/capa-clientes.jpg`→ idem  (defeito PRÉ-EXISTENTE, já anotado em COMO-SERVIR.md §4)
//
// ── A SAÍDA: UM BOTÃO SÓ ────────────────────────────────────────────────────────────────────────
// `vite.config.js` lê `RAGNABOT_PREFIXO_WEB` na hora de construir e o grava em
// `import.meta.env.BASE_URL`. Este módulo é a ÚNICA leitura desse valor no código da tela; todo o
// resto (rede, roteador, fotos) pergunta aqui. Padrão `/` — ou seja, nada muda para quem serve na
// raiz, e o pacote continua o mesmo.
//
//     construir para a raiz          →  npm run build
//     construir para /motor-api/     →  RAGNABOT_PREFIXO_WEB=/motor-api/ npm run build
//
// ⛔ NÃO tente adivinhar o prefixo em tempo de execução lendo `window.location.pathname`. Já pensei
// nisso e não funciona: `/fluxos` e `/motor-api` são indistinguíveis para quem só olha a URL, e a
// primeira navegação do roteador já mudaria o caminho — o palpite viraria outro a cada clique.
// O prefixo é uma propriedade do DEPLOY, e deploy se declara, não se adivinha.
//
// ⚠️ DECISÃO QUE NÃO É MINHA, e está no relatório: hoje `/motor-api/` é a porta de SERVIÇO (o proxy
// tem `allow <IP do NOC>; deny all;` — nenhum navegador de usuário passa por ali). Se a interface
// vai ganhar host próprio (`base` continua `/`) ou um caminho público em `bot.` (`base` passa a ser
// esse caminho) é decisão do chefe. Este módulo faz os dois funcionarem sem reescrever nada.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O que o Vite gravou. Sempre começa e termina com `/` quando bem formado; `/` é o padrão. */
const CRU = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

/** Normalizado: começa com `/` e TERMINA com `/`. `/` quando é a raiz. */
export const PREFIXO = normalizarPrefixo(CRU);

/**
 * O `basename` do roteador: sem a barra final, e string VAZIA na raiz.
 * ⚠️ O `react-router` quer `''` (não `'/'`) para "sem prefixo" — passar `'/'` faz ele tratar a
 * barra como parte do nome e todo caminho nasce com uma barra a mais.
 */
export const BASENAME = PREFIXO === '/' ? '' : PREFIXO.replace(/\/$/u, '');

export function normalizarPrefixo(valor) {
  let p = String(valor || '/').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p.replace(/\/{2,}/gu, '/');
}

/**
 * Um caminho ABSOLUTO da aplicação, com o prefixo do deploy na frente.
 *
 * ⚠️ Escrito para o literal continuar VISÍVEL no pacote: quem chama passa `'/api/ragnabot-fluxo'`
 * inteiro, e não `'api/…'` concatenado. Não é capricho — `tests/servir.smoke.mjs` procura essa
 * cadeia dentro do módulo construído para provar que a tela fala com o motor certo, e um
 * `'/' + 'api/…'` que o minificador não junte faria a prova sumir sem nada ter quebrado de fato.
 */
export function caminhoDoApp(absoluto) {
  const p = String(absoluto || '/');
  if (PREFIXO === '/') return p;
  return `${PREFIXO.replace(/\/$/u, '')}${p.startsWith('/') ? p : `/${p}`}`;
}
