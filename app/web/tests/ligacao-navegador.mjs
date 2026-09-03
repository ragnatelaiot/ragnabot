// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EM NAVEGADOR DE VERDADE — a que mede PIXEL, e a única que pegou o defeito de 03/09/2026
//
// ⚠️ POR QUE ELA EXISTE, e por que `ligacao.smoke.mjs` (jsdom) não bastava: o defeito era
// GEOMÉTRICO. Tocar o conector abria o painel de inspeção — 380 px à direita, ou uma gaveta de
// 70 % da altura abaixo de 900 px — e o painel ficava POR CIMA do nó de destino. Nada disso existe
// em jsdom, que não faz layout: lá tudo passava. Aqui se mede o que o navegador pinta, e a
// pergunta é a única que importa: **no lugar onde está o nó de destino, quem recebe o toque?**
//
// ⛔ NÃO ENTRA no `npm test`: ela precisa de um Chromium no disco, e a imagem de produção não tem
// (nem deve ter). É a prova que se roda quando há navegador — e o resultado vai no relatório.
//
// COMO RODAR (na máquina do NOC, onde há Chromium do Playwright):
//     node tests/_servidor-de-laboratorio.mjs &        # serve o dist + finge o motor
//     RAGNABOT_PW=/ia/noc-tools/render/node_modules/playwright-core \
//     LD_LIBRARY_PATH=/ia/noc-tools/render/libs/usr/lib/x86_64-linux-gnu \
//     node tests/ligacao-navegador.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';

const BASE = process.env.RAGNABOT_LAB || 'http://127.0.0.1:4599';
const PW = process.env.RAGNABOT_PW || 'playwright';

let falhas = 0;
let medicoes = 0;
const medir = (t, ok, detalhe) => {
  medicoes += 1;
  if (ok) console.log(`  ✓ ${t}`);
  else { falhas += 1; console.log(`  ✗ ${t}${detalhe ? `\n      ${detalhe}` : ''}`); }
};

const pw = await import(PW);
const chromium = pw.chromium || pw.default?.chromium;
assert.ok(chromium, `não achei o Playwright em "${PW}" — informe RAGNABOT_PW`);

// As larguras que importam: as duas primeiras são desktop confortável; 1100 e 1024 são a janela
// não-maximizada de todo dia (e foi exatamente ali que o defeito vivia); 820 e 390, tela de toque.
const LARGURAS = [[1440, 900, false], [1280, 800, false], [1100, 800, false], [1024, 768, false], [820, 1180, true], [390, 844, true]];

const nav = await chromium.launch({ args: ['--no-sandbox'] });
const centro = (c) => ({ x: c.x + c.width / 2, y: c.y + c.height / 2 });

console.log('\nLIGAR DOIS NÓS, EM NAVEGADOR DE VERDADE\n');

for (const [w, h, toque] of LARGURAS) {
  await fetch(`${BASE}/__lab/zerar`);
  const ctx = await nav.newContext({ viewport: { width: w, height: h }, hasTouch: toque, isMobile: toque, locale: 'pt-BR' });
  const pag = await ctx.newPage();
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  await pag.goto(`${BASE}/fluxos#fluxo=f1`, { waitUntil: 'networkidle' });
  await pag.waitForTimeout(1000);

  const rotulo = `${w}×${h}${toque ? ' (toque)' : ''}`;
  const pino = pag.locator('.rgfx-pino').filter({ hasText: 'segue' }).first();
  const destino = pag.locator('.rgfx-bloco').filter({ hasText: 'Confirma?' }).first();

  const p = centro(await pino.boundingBox());
  if (toque) await pag.touchscreen.tap(p.x, p.y); else await pag.mouse.click(p.x, p.y);
  await pag.waitForTimeout(350);
  const armou = (await pag.locator('body').innerText()).includes('Ligando a saída');

  // ⭐ A MEDIÇÃO QUE PEGOU O DEFEITO: no lugar do nó de destino, quem está por cima?
  let cd = await destino.boundingBox();
  let usouVerTudo = false;
  // Em tela estreita o nó de destino pode estar INTEIRO fora do quadro — não existe toque num nó
  // que não está desenhado. A tela oferece «Ver tudo» na própria faixa da ligação; é o caminho que
  // o operador tem, e é ele que se mede aqui.
  if (armou && (cd.x + 30 >= w || cd.y + 15 >= h || cd.x + cd.width <= 0)) {
    const verTudo = pag.getByRole('button', { name: 'Ver tudo' });
    if (await verTudo.count()) { await verTudo.first().click(); await pag.waitForTimeout(500); usouVerTudo = true; cd = await destino.boundingBox(); }
  }
  const alvo = { x: cd.x + 30, y: cd.y + 15 };
  const dentroDaJanela = alvo.x > 0 && alvo.x < w && alvo.y > 0 && alvo.y < h;
  const sob = dentroDaJanela ? await pag.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest('[data-no-id]') ? el.closest('[data-no-id]').getAttribute('data-no-id') : (el ? `COBERTO por ${el.className || el.tagName}` : 'NADA');
  }, alvo) : 'FORA DA JANELA';

  if (dentroDaJanela) { if (toque) await pag.touchscreen.tap(alvo.x, alvo.y); else await pag.mouse.click(alvo.x, alvo.y); }
  await pag.waitForTimeout(1200);
  const depoisDoToque = (await (await fetch(`${BASE}/__lab/puts`)).json()).arestas;

  // E agora o outro caminho: ARRASTAR do conector até o nó.
  await fetch(`${BASE}/__lab/zerar`);
  await pag.reload({ waitUntil: 'networkidle' });
  await pag.waitForTimeout(900);
  // Antes do arraste, reenquadra: arrastar até um nó fora do quadro não é gesto, é adivinhação.
  const enquadrar = pag.getByRole('button', { name: 'Ajustar à tela' });
  if (await enquadrar.count()) { await enquadrar.first().click({ force: true }).catch(() => {}); await pag.waitForTimeout(500); }
  const a = centro(await pag.locator('.rgfx-pino').filter({ hasText: 'segue' }).first().boundingBox());
  const b = centro(await pag.locator('.rgfx-bloco').filter({ hasText: 'Confirma?' }).first().boundingBox());
  const bx = Math.min(Math.max(b.x, 4), w - 4);
  const by = Math.min(Math.max(b.y, 4), h - 4);
  await pag.mouse.move(a.x, a.y);
  await pag.mouse.down();
  await pag.mouse.move(a.x + 30, a.y + 8, { steps: 4 });
  await pag.mouse.move(bx, by, { steps: 12 });
  await pag.mouse.up();
  await pag.waitForTimeout(1400);
  const depoisDoArraste = (await (await fetch(`${BASE}/__lab/puts`)).json()).arestas;

  console.log(`\n  ── ${rotulo} ── conector armou=${armou ? 'sim' : 'NÃO'} · sob o lugar do nó de destino: ${sob}`);
  medir(`${rotulo}: tocar o conector arma a ligação`, armou);
  medir(`${rotulo}: o nó de destino continua ALCANÇÁVEL depois de armar${usouVerTudo ? ' (via «Ver tudo», porque estava fora do quadro)' : ' (ninguém o cobriu)'}`, sob === 'no_botoes', `quem está lá: ${sob}`);
  medir(`${rotulo}: dois toques ligam e gravam`, depoisDoToque.length === 1, JSON.stringify(depoisDoToque));
  medir(`${rotulo}: arrastar do conector até o nó liga e grava`, depoisDoArraste.length === 1, JSON.stringify(depoisDoArraste));
  medir(`${rotulo}: nenhum erro de página`, erros.length === 0, erros.join(' | '));
  await ctx.close();
}

await nav.close();
console.log(`\n${medicoes} medições · ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
