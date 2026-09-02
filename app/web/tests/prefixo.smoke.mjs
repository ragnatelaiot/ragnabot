// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DE QUE A INTERFACE FUNCIONA SOB PREFIXO (contrato S1, 02/09/2026)
//
// ── POR QUE ESTE TESTE EXISTE (achado, não capricho) ────────────────────────────────────────────
// Ao ligar o roteador eu medi onde o motor está publicado: `app/deploy/ragnabot-motor-ingress.yaml`
// o pendura em `bot.ragnatela.com.br/motor-api/` com `rewrite-target: /$2` — o prefixo some antes
// de chegar à aplicação, que se enxerga na raiz. Nesse arranjo, TODO caminho absoluto escrito pela
// tela sai errado: os arquivos, as chamadas de API e as fotos das capas caem no Ingress da
// PLATAFORMA, não no motor. O sintoma é tela branca com 200 na rede — o pior de diagnosticar.
//
// O conserto é um botão só (`RAGNABOT_PREFIXO_WEB` → `import.meta.env.BASE_URL` → `lib/prefixo.js`).
// Este teste CONSTRÓI de verdade com o prefixo e mede o resultado, porque um botão que ninguém
// aperta é um botão que enferruja: sem esta medição, a próxima tela nova voltaria a escrever
// caminho absoluto e ninguém saberia até o deploy.
//
// ⚠️ ISTO NÃO DECIDE O DEPLOY. Onde a interface vai ser publicada é decisão do chefe — hoje
// `/motor-api/` é porta de SERVIÇO (o proxy tem `allow <IP do NOC>; deny all;`, ver
// `app/deploy/nginx/bot-motor-api.conf`), então nenhum navegador de usuário passa por ali. Este
// teste só garante que, decidido o que for, o pacote sabe se comportar.
//
// Rodar (a partir de `app/web/`):   node tests/prefixo.smoke.mjs
// ⚠️ Ele constrói numa pasta PRÓPRIA (`dist-prefixo`) — nunca em `dist/`, que é o que o motor serve
// e o que `servir.smoke.mjs` mede. Sobrescrever ali deixaria o `dist` de produção com o prefixo
// embutido sem ninguém pedir.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const PREFIXO = '/motor-api/';
const SAIDA = path.join(RAIZ, 'dist-prefixo');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

console.log(`\nA INTERFACE SOB PREFIXO (${PREFIXO})\n`);
process.stdout.write('  … construindo com RAGNABOT_PREFIXO_WEB\n');
execFileSync(
  process.execPath,
  [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', 'dist-prefixo', '--logLevel', 'warn'],
  { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, RAGNABOT_PREFIXO_WEB: PREFIXO } },
);

const indice = fs.readFileSync(path.join(SAIDA, 'index.html'), 'utf8');

medir('o índice pede os arquivos DENTRO do prefixo', () => {
  const pedidos = [...indice.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const deAssets = pedidos.filter((p) => p.includes('/assets/'));
  assert.ok(deAssets.length, 'o índice não pede nenhum arquivo de /assets/');
  for (const p of deAssets) assert.ok(p.startsWith(PREFIXO), `pedido fora do prefixo: ${p}`);
});

medir('a construção PADRÃO continua na raiz (o botão é opt-in)', () => {
  // `dist/` foi construído sem a variável, no `npm run build` normal. Se esta medição falhar, o
  // padrão mudou sem ninguém pedir — e todo deploy de raiz quebraria.
  const indiceRaiz = fs.readFileSync(path.join(RAIZ, 'dist', 'index.html'), 'utf8');
  assert.doesNotMatch(indiceRaiz, /motor-api/);
  assert.match(indiceRaiz, /(?:src|href)="\/assets\//);
});

// ── Os VALORES resolvidos (ver o cabeçalho de `_expoe-prefixo.jsx`) ─────────────────────────────
process.stdout.write('  … empacotando os valores em modo SSR\n');
execFileSync(
  process.execPath,
  [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build', '--ssr', 'tests/_expoe-prefixo.jsx', '--outDir', 'tests/.ssr/prefixo', '--logLevel', 'warn'],
  { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, RAGNABOT_PREFIXO_WEB: PREFIXO } },
);
const { valores, capaHtml } = await import(path.join(RAIZ, 'tests', '.ssr', 'prefixo', '_expoe-prefixo.js'));

medir('o prefixo chega normalizado, e o basename vem SEM a barra final', () => {
  // `react-router` quer `''` para "sem prefixo" e `/x` (sem barra no fim) para prefixo. Uma barra a
  // mais aqui faz todo caminho nascer com barra dupla, e nenhuma rota casa.
  assert.equal(valores.PREFIXO, '/motor-api/');
  assert.equal(valores.BASENAME, '/motor-api');
});

medir('as chamadas de API vão para dentro do prefixo (senão caem na plataforma)', () => {
  // ⚠️ É O DEFEITO CENTRAL que este botão conserta: `/api/ragnabot-fluxo` na RAIZ do domínio é o
  // Ingress do Chatwoot, não o motor. A tela diria «não consigo falar com o servidor» com o motor
  // de pé, e a caça começaria no lugar errado.
  assert.equal(valores.BASE_FLUXO, '/motor-api/api/ragnabot-fluxo');
  assert.equal(valores.BASE_SESSAO, '/motor-api/sessao');
  assert.equal(valores.BASE_RESPOSTAS, '/motor-api/api/ragnabot-respostas-rapidas');
  assert.equal(valores.BASE_EMPRESAS, '/motor-api/api/ragnabot');
});

medir('a foto da capa também respeita o prefixo (defeito de COMO-SERVIR.md §4)', () => {
  assert.match(capaHtml(), /\/motor-api\/capas\/capa-clientes\.jpg/);
});

fs.rmSync(SAIDA, { recursive: true, force: true });

console.log(falhas === 0
  ? `\nRESULTADO: ${medicoes} de ${medicoes} medições passaram.\n`
  : `\nRESULTADO: ${falhas} FALHA(S) em ${medicoes} medições.\n`);
process.exit(falhas === 0 ? 0 : 1);
