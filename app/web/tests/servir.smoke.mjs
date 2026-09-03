// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DE QUE O TRECHO DE `COMO-SERVIR.md §1` REALMENTE SERVE A INTERFACE
//
// Por que este teste existe: `COMO-SERVIR.md` diz ao chefe o que colar em `app/src/servidor.js` —
// um arquivo que eu não posso editar. Documentação que ninguém executa envelhece calada, e a mais
// cara é a que descreve um servidor que nunca subiu. Aqui o MESMO bloco sobe de verdade, sobre o
// `dist` construído de verdade, e as respostas são medidas.
//
// ⚠️ Este teste NÃO prova que a tela renderiza (não há navegador aqui). Ele prova o que dá para
// medir sem um: o pacote é servido, o desvio-para-a-página não engole a API nem a entrada de
// sessão, e o arquivo que não existe dá 404 em vez de HTML disfarçado.
//
// ⭐ ATUALIZADO EM 30/08/2026 (contrato S4-AUTH). O `/interface/configuracao.js` SAIU: ele injetava
// o token de serviço no navegador e deixava o papel viajar em cabeçalho escolhido pelo cliente.
// Agora quem autentica a tela é o cookie de sessão emitido por `/sessao/entrar`. As medições
// abaixo passaram a EXIGIR a ausência do que era o defeito — teste que só confere presença deixa
// a volta do defeito passar em silêncio.
//
// Rodar:  node web/tests/servir.smoke.mjs      (a partir de app/)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VERSAO = '1.03.01-teste';
const logger = { info: () => {}, warn: () => {} };

// Dublê das rotas que o motor teria no pod. NÃO há mais variável de credencial para a tela:
// a credencial é o cookie, e quem o emite é `src/rotas-sessao.js`.

const app = express();

// ── Um dublê das rotas do motor, para provar que o desvio-para-a-página NÃO as engole ───────────
app.get('/api/ragnabot-fluxo/saude', (req, res) => res.json({ dublê: true }));
app.get('/saude', (req, res) => res.json({ servico: 'ragnabot-motor' }));
app.get('/vivo', (req, res) => res.json({ vivo: true }));
// A entrada de sessão é montada ANTES do desvio-para-a-página, e por isso não é engolida por ele.
app.get('/sessao/eu', (req, res) => res.status(401).json({ autenticado: false }));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⬇⬇⬇  A PARTIR DAQUI É CÓPIA LITERAL DE `web/COMO-SERVIR.md §1`  ⬇⬇⬇
// (só os três `import` de topo é que subiram para o cabeçalho deste arquivo, porque em ESM eles
//  não podem ficar no meio; o comportamento é idêntico)
// ════════════════════════════════════════════════════════════════════════════════════════════════
const PASTA_INTERFACE = process.env.RAGNABOT_INTERFACE_DIR
  || path.join(AQUI, '..', 'dist');   // no servidor real: <raiz>/web/dist
const TEM_INTERFACE = fs.existsSync(path.join(PASTA_INTERFACE, 'index.html'));

if (TEM_INTERFACE) {
  // ⛔ AQUI HAVIA `app.get('/interface/configuracao.js', …)` — REMOVIDO em 30/08/2026.
  // Ele servia `window.__RAGNABOT__ = { token: RAGNABOT_SERVICE_TOKEN, ator: {…} }` ao navegador.
  // Ou seja: entregava o segredo de serviço a quem alcançasse a página, e o papel do operador vinha
  // de variável de ambiente e viajava depois em cabeçalho que o cliente controla. Ver
  // `app/src/COMO-MONTAR-SESSAO.md`. NÃO reponha.

  // ── 2. Os arquivos ────────────────────────────────────────────────────────────────────────────
  // `index: false` porque quem responde a raiz é o desvio abaixo — assim há UM caminho só para o
  // HTML, e o cabeçalho de cache é o mesmo em `/` e em `/qualquer-coisa`.
  app.use(express.static(PASTA_INTERFACE, { index: false, maxAge: '7d', etag: true }));

  // ── 3. O desvio-para-a-página ─────────────────────────────────────────────────────────────────
  // A tela guarda o fluxo aberto no `#hash`, não no caminho — mas o operador ainda pode colar uma
  // URL antiga (`/ragnabot-fluxos/<id>`), e um F5 numa dessas tem de devolver a página, não 404.
  //
  // ⚠️ AS EXCLUSÕES NÃO SÃO ENFEITE. Sem elas, um `GET /api/ragnabot-fluxo/saude` digitado errado
  // devolveria HTML com status 200, e quem estivesse diagnosticando leria "o motor respondeu".
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path === '/saude' || req.path === '/vivo') return next();
    // A entrada de sessão nunca pode receber HTML no lugar de JSON: a tela leria "<" e mostraria
    // um erro sem sentido em vez de "e-mail ou senha inválidos".
    if (req.path.startsWith('/sessao')) return next();
    // ⚠️ Só NAVEGAÇÃO. Um `.js`/`.css`/`.woff2` que não existe TEM de dar 404: devolver HTML no
    // lugar de um módulo faz o navegador falhar com "Unexpected token '<'", que não diz nada a
    // ninguém, e ainda por cima com status 200 — o pior dos dois mundos para quem diagnostica.
    //
    // ⛔ NÃO use `req.accepts('html')` aqui. Foi o que escrevi primeiro e o teste reprovou: um
    // pedido com `Accept: */*` (que é o que `fetch` manda por padrão, e o que várias sondas mandam)
    // CASA com 'html', e o arquivo inexistente voltava 200 com a página dentro.
    // Os dois filtros abaixo são o discriminador certo:
    //   · navegador navegando manda `Accept: text/html,…` explícito; buscar módulo/imagem, não;
    //   · caminho com extensão é pedido de ARQUIVO, e arquivo que não existe é 404, ponto.
    if (!(req.get('Accept') || '').includes('text/html')) return next();
    if (path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store');   // o index aponta para arquivos com hash; cachear o
    return res.sendFile(path.join(PASTA_INTERFACE, 'index.html'));   // index serve a versão velha
  });

  logger.info(`[ragnabot] interface servida de ${PASTA_INTERFACE}`);
} else {
  logger.warn('[ragnabot] interface NÃO encontrada — o motor sobe sem tela (só API)');
}
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⬆⬆⬆  FIM DA CÓPIA LITERAL  ⬆⬆⬆
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────────────────────────
assert.equal(TEM_INTERFACE, true, 'dist/index.html não existe — rode `npm run build` antes');

const servidor = app.listen(0);
await new Promise((ok) => servidor.once('listening', ok));
const base = `http://127.0.0.1:${servidor.address().port}`;

let falhas = 0;
// Contado, e não escrito à mão no rodapé: o número fixo ("8 de 8") mente na primeira medição nova,
// e mente para MENOS — o que faz um teste acrescentado passar despercebido.
let medicoes = 0;
async function medir(titulo, caminho, conferir, opcoes = {}) {
  medicoes += 1;
  const r = await fetch(`${base}${caminho}`, opcoes);
  const corpo = await r.text();
  try {
    conferir({ status: r.status, tipo: r.headers.get('content-type') || '', cache: r.headers.get('cache-control') || '', corpo });
    console.log(`  ✓ ${titulo}  →  ${r.status} ${(r.headers.get('content-type') || '').split(';')[0]}`);
  } catch (e) {
    falhas += 1;
    console.log(`  ✗ ${titulo}  →  ${r.status}  ${e.message}`);
  }
}

const HTML = { headers: { Accept: 'text/html,application/xhtml+xml' } };

console.log('\nSERVIR A INTERFACE DO RAGNABOT — trecho de COMO-SERVIR.md §1');
console.log(`pasta: ${PASTA_INTERFACE}\n`);

await medir('a raiz devolve a página', '/', ({ status, tipo, corpo, cache }) => {
  assert.equal(status, 200);
  assert.match(tipo, /text\/html/);
  assert.match(corpo, /<div id="raiz">/);
  // ⛔ O CONTRÁRIO DO QUE ESTE TESTE PEDIA ANTES: a página NÃO pode voltar a carregar um script de
  // credencial.
  // ⚠️ Os COMENTÁRIOS saem antes da conferência: o `index.html` cita o caminho antigo de propósito,
  // para explicar por que ele foi removido, e sem tirar o comentário o teste acusaria a própria
  // explicação. (Foi o que aconteceu na primeira tentativa: `<script[^>]*configuracao\.js` casa
  // dentro do comentário, porque não há `>` entre `<script` e o caminho.)
  const semComentarios = corpo.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(semComentarios, /configuracao\.js/);
  assert.doesNotMatch(semComentarios, /__RAGNABOT__/);
  assert.match(cache, /no-store/);
}, HTML);

await medir('o caminho da credencial antiga NÃO existe mais', '/interface/configuracao.js',
  ({ status, corpo }) => {
    // 404 é o certo: o endpoint não é montado. Se um dia voltar 200, alguém repôs a escalada.
    assert.equal(status, 404);
    assert.doesNotMatch(corpo, /__RAGNABOT__/);
  });

const indice = await (await fetch(`${base}/`, HTML)).text();
const arquivoJs = indice.match(/src="\.?(\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(arquivoJs, 'não achei o arquivo de módulo no índice');

await medir('o módulo é servido e é o pacote certo', arquivoJs, ({ status, tipo, corpo }) => {
  assert.equal(status, 200);
  assert.match(tipo, /javascript/);
  // marcas do que mudou de casa: a base da API e a entrada de sessão
  assert.match(corpo, /\/api\/ragnabot-fluxo/);
  assert.match(corpo, /\/sessao/);
  // ⛔ E AS MARCAS DO DEFEITO QUE NÃO PODEM VOLTAR: nenhum cabeçalho de credencial nem de papel
  // dentro do pacote da tela, e nenhum `window.__RAGNABOT__`.
  assert.doesNotMatch(corpo, /x-ragnabot-service-token/);
  assert.doesNotMatch(corpo, /x-ragnabot-ator-papel/);
  assert.doesNotMatch(corpo, /__RAGNABOT__/);
  // ⛔ e a marca de que a casa velha NÃO veio junto
  assert.doesNotMatch(corpo, /noc_user/);
  assert.doesNotMatch(corpo, /noc:auth-expired/);
});

await medir('a foto da capa está no pacote', '/capas/capa-clientes.jpg', ({ status, tipo }) => {
  assert.equal(status, 200);
  assert.match(tipo, /image\/jpeg/);
});

await medir('a API NÃO é engolida pelo desvio', '/api/ragnabot-fluxo/saude', ({ status, tipo, corpo }) => {
  assert.equal(status, 200);
  assert.match(tipo, /application\/json/);
  assert.match(corpo, /"dublê":true/);
}, HTML);   // com Accept: text/html de propósito — é o caso que o curinga engoliria

await medir('a sonda do Kubernetes NÃO é engolida', '/vivo', ({ status, corpo }) => {
  assert.equal(status, 200);
  assert.match(corpo, /"vivo":true/);
}, HTML);

await medir('URL antiga de fluxo devolve a página (F5 não dá 404)', '/ragnabot-fluxos/abc-123', ({ status, corpo }) => {
  assert.equal(status, 200);
  assert.match(corpo, /<div id="raiz">/);
}, HTML);

// ── ⭐ AS ROTAS DO ROTEADOR (contrato S1, 02/09/2026) ────────────────────────────────────────────
// O critério de aceite do contrato é literal: «recarregar em /fluxos cai em /fluxos, não em erro».
// Quem cumpre isso é o SERVIDOR — o roteador do navegador só entra em cena depois que o índice
// carrega. Sem o desvio-para-a-página, um F5 em `/fluxos` daria 404 e o construtor de fluxo ficaria
// inalcançável de novo, que é exatamente a dor que este contrato existe para consertar.
// ⭐ 02/09/2026 (contrato S-CASCA): `/conversas`, `/contatos` e `/relatorios` entraram na lista.
// São as telas que ainda são do FORNECEDOR e passaram a abrir dentro da nossa casca — o quadro é
// que aponta para o painel dele; a ROTA continua sendo nossa, e um F5 nela tem de devolver a
// página, como em qualquer outra. Sem esta medição, o F5 numa tela embutida cairia em 404 e o
// diagnóstico começaria olhando para o fornecedor, que não tem nada com isso.
for (const rota of ['/fluxos', '/respostas-rapidas', '/empresas',
  '/caixa', '/testador', '/conexoes', '/caixas', '/agendamentos', '/configuracoes',
  '/conversas', '/contatos', '/relatorios']) {
  await medir(`F5 em ${rota} devolve a página (não 404)`, rota, ({ status, corpo, cache }) => {
    assert.equal(status, 200);
    assert.match(corpo, /<div id="raiz">/);
    assert.match(cache, /no-store/);
  }, HTML);
}

// ⚠️ ESTA MEDIÇÃO É O PORQUÊ DE `vite.config.js` TER MUDADO DE `base: './'` PARA `base: '/'`.
// Com caminho relativo, o índice servido em `/ragnabot-fluxos/abc-123` pediria
// `./assets/index-*.js` = `/ragnabot-fluxos/assets/index-*.js` — 404, tela BRANCA e 200 na rede,
// o pior sintoma possível. Com base absoluta, o mesmo índice serve em qualquer profundidade.
await medir('o índice pede os arquivos por caminho ABSOLUTO (funciona em rota aninhada)', '/',
  ({ corpo }) => {
    const pedidos = [...corpo.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    const relativos = pedidos.filter((p) => p.startsWith('./') || p.startsWith('../'));
    assert.deepEqual(relativos, [], `pedido relativo no índice quebraria rota aninhada: ${relativos.join(', ')}`);
    assert.ok(pedidos.some((p) => /^\/assets\/index-.*\.js$/.test(p)), 'não achei o módulo em /assets/');
  }, HTML);

await medir('arquivo inexistente dá 404, e NÃO HTML disfarçado', '/assets/nao-existe-Ab12.js', ({ status, corpo }) => {
  assert.equal(status, 404);
  assert.doesNotMatch(corpo, /<div id="raiz">/);
});

servidor.close();
console.log(falhas === 0 ? `\nRESULTADO: ${medicoes} de ${medicoes} medições passaram.\n` : `\nRESULTADO: ${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
