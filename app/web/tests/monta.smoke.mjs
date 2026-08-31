// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DE QUE A TELA MONTA FORA DO NOC
//
// O `servir.smoke.mjs` prova que o pacote é SERVIDO. Este prova outra coisa, e mais difícil: que a
// tela, sem nada do NOC por perto (sem `lib/api.js` do NOC, sem `localStorage.noc_user`, sem o
// layout, sem o roteador), RENDERIZA — e renderiza o conteúdo certo.
//
// Como: renderização do lado do servidor (`renderToString`). Não há navegador aqui, então este é o
// jeito honesto de medir. Ele pega o que interessa nesta etapa — import quebrado, referência a algo
// que ficou no NOC, erro na primeira passada de render — porque qualquer um dos três lança.
//
// ⚠️ O QUE ELE NÃO PROVA, e eu não vou fingir que prova: os `useEffect` NÃO rodam sem DOM. Ou seja,
// a busca de `/saude` e da lista de fluxos, o arraste dos nós, o zoom e o atalho de teclado ficam
// de fora. Isso só se mede com navegador contra um motor no ar — e é do chefe, depois de implantar.
//
// Preparo:  npx vite build --ssr tests/_monta-entrada.jsx --outDir tests/.ssr
// Rodar:    node web/tests/monta.smoke.mjs     (a partir de app/)
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PACOTE = path.join(AQUI, '.ssr', '_monta-entrada.js');

assert.ok(
  fs.existsSync(PACOTE),
  'pacote de teste ausente — rode:  npx vite build --ssr tests/_monta-entrada.jsx --outDir tests/.ssr',
);

console.log('\nMONTAR A TELA FORA DO NOC — renderização do lado do servidor\n');

let falhas = 0;
function medir(titulo, conferir) {
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${e.message.split('\n')[0]}`); }
}

const { renderizar } = await import(PACOTE);
const html = renderizar();

medir('renderiza sem lançar, e com conteúdo', () => {
  assert.ok(html.length > 2000, `veio curto demais (${html.length} caracteres) — provavelmente vazio`);
});

medir('a capa de seção está lá (o componente veio junto)', () => {
  assert.match(html, /class="capa"/);
  assert.match(html, /Fluxos de conversa/);
  assert.match(html, /capa-clientes\.jpg/);
});

medir('a folha de estilo própria da tela é injetada', () => {
  assert.match(html, /rgfx-viewport/);
});

medir('as classes globais que o tema fornece são usadas', () => {
  assert.match(html, /class="btn btn-primary"/);
});

medir('nada do NOC ficou pendurado no HTML', () => {
  assert.doesNotMatch(html, /noc_user/);
  assert.doesNotMatch(html, /noc:auth-expired/);
});

console.log(falhas === 0 ? `\nRESULTADO: 5 de 5 medições passaram (HTML de ${html.length} caracteres).\n`
                         : `\nRESULTADO: ${falhas} FALHA(S).\n`);
process.exit(falhas === 0 ? 0 : 1);
