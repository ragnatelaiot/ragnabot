// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA AO VIVO (contrato S-TEMPO-REAL, 03/09/2026 — doc 35 §6.8)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE: o isolamento e a travessia entre réplicas. Os dois são do
// SERVIDOR, e a prova deles é `app/tests/ragnabot-tempo-real.test.mjs` — inclusive com dois
// PROCESSOS de verdade no mesmo Postgres. Aqui se mede a metade da TELA: que o selo diz a verdade
// quando o cano cai (item 5 do contrato: *"tela que congela em silêncio é pior que tela que
// avisa"*), que o endereço do cano respeita o prefixo do painel, e que o recuo da reconexão não é
// um laço apertado.
//
// ⛔ E o que não dá para provar sem navegador, e não vou fingir que prova: `EventSource` não existe
// em SSR. A conexão de verdade só se mede contra o motor no ar — está no relatório da entrega.
//
// Rodar (a partir de `app/web/`):   node tests/ao-vivo.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'ao-vivo');

let falhas = 0; let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

// A camada de rede é importada por `ao-vivo.js`; sem um `fetch` global o import estoura.
globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => '{}' });

console.log('\n── O CANO AO VIVO (biblioteca pura) ─────────────────────────────────────────────');
const aoVivo = await import('../src/lib/ao-vivo.js');

medir('o endereço do cano é o do MOTOR, e respeita o prefixo do painel', () => {
  assert.ok(aoVivo.BASE_AO_VIVO.endsWith('/api/ragnabot-tempo-real'),
    `veio "${aoVivo.BASE_AO_VIVO}" — servido em /painel/, um caminho relativo cairia no Ingress da PLATAFORMA`);
});

medir('o recuo cresce (1s, 2s, 4s, 8s) com sorteio neutro', () => {
  const r = (n) => aoVivo.recuoDaTentativa(n, 0.5);
  assert.equal(r(0), 1000); assert.equal(r(1), 2000);
  assert.equal(r(2), 4000); assert.equal(r(3), 8000);
});

medir('o recuo tem teto de 30 s — reconexão não vira martelo no servidor', () => {
  assert.equal(aoVivo.recuoDaTentativa(20, 0.5), 30000);
});

medir('⛔ e nunca é zero: laço apertado com 30 atendentes derruba o motor junto', () => {
  for (const n of [0, 1, 2, 5, 20]) assert.ok(aoVivo.recuoDaTentativa(n, 0) >= 500);
});

medir('sem `EventSource` a tela NÃO quebra — ela declara que não está ao vivo', () => {
  const antes = globalThis.EventSource;
  delete globalThis.EventSource;
  const estados = [];
  const l = aoVivo.ligarAoVivo({ aoEstado: (e) => estados.push(e) });
  assert.equal(l.estado().suportado, false);
  assert.equal(estados[0]?.ligado, false);
  l.desligar();
  if (antes) globalThis.EventSource = antes;
});

console.log('\n── O SELO NA TELA (item 5: tela que avisa) ──────────────────────────────────────');
const PACOTE = path.join(SAIDA_SSR, 'CaixaDeAtendimento.js');
if (!fs.existsSync(PACOTE)) {
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/CaixaDeAtendimento.jsx', '--outDir', 'tests/.ssr/ao-vivo', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}
const { renderToString } = await import('react-dom/server');
const React = (await import('react')).default;
const pagina = await import(path.join(SAIDA_SSR, 'CaixaDeAtendimento.js'));
const { SeloAoVivo } = pagina;

medir('ligado: diz «Ao vivo»', () => {
  const html = renderToString(React.createElement(SeloAoVivo, { ligado: true }));
  assert.ok(html.includes('Ao vivo'), html);
});

medir('⭐ caído: diz «Reconectando», não fica calado', () => {
  const html = renderToString(React.createElement(SeloAoVivo, { ligado: false, tentativas: 3 }));
  assert.ok(html.includes('Reconectando'), html);
  assert.ok(html.includes('3'), 'e mostra a tentativa, para provar que não travou');
});

medir('e explica, no título, o que «ao vivo» significa para quem atende', () => {
  const html = renderToString(React.createElement(SeloAoVivo, { ligado: true }));
  assert.ok(/sem recarregar a p/.test(html), html.slice(0, 300));
});

console.log(`\n${medicoes - falhas}/${medicoes} medições passaram`);
process.exit(falhas ? 1 : 0);
