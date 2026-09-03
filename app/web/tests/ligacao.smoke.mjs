// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DE QUE DÁ PARA LIGAR DOIS NÓS — o gesto, não a pintura
//
// ⚠️ POR QUE ESTE ARQUIVO NASCEU (03/09/2026). O dono abriu o editor com dois nós soltos e disse:
// «não estou conseguindo criar e ligar as caixas do fluxo». Nenhum teste desta pasta media o GESTO
// — todos mediam renderização (SSR, `renderToString`), e renderização não clica em nada. O defeito
// vivia exatamente onde nenhum teste olhava.
//
// A CAUSA MEDIDA, para não voltar: tocar o conector chamava `setSelecionadoId(no)`, e isso ABRIA o
// painel de inspeção — 380 px à direita no desktop, gaveta de 70 % da altura abaixo de 900 px.
// Medido em Chromium de verdade: em janela de 1024 e de 1100 px, o nó de destino ficava DEBAixo do
// painel que o próprio toque acabara de abrir (`elementFromPoint` no lugar do nó devolvia
// `DIV.rgfx-lateral`). A ligação armava, a faixa mandava «toque no nó de destino», e não havia nó
// para tocar. A prova em navegador está em `tests/ligacao-navegador.mjs`; esta aqui trava a REGRA
// que corrige o caso — enquanto se liga, o painel não existe — e o resto da máquina de estado.
//
// ⛔ O QUE ESTE ARQUIVO NÃO MEDE: geometria. jsdom não faz layout — não há caixa, não há
// sobreposição, `elementFromPoint` devolve `null` sempre (e por isso o alvo da largada é injetado
// à mão, com isso dito em voz alta na medição). Quem mede pixel é o teste de navegador.
//
// Rodar (a partir de `app/web/`):
//     vite build --ssr tests/_monta-fluxos.jsx --outDir tests/.ssr/ligacao && node tests/ligacao.smoke.mjs
// ou simplesmente:  npm run test:ligacao
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PACOTE = path.join(AQUI, '.ssr', 'ligacao', '_monta-fluxos.js');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

// ── O DOCUMENTO DO DONO, o mesmo que ele tinha na tela ──────────────────────────────────────────
// Início + Botões, soltos. Confere até nos contadores: 3 erros de desenho e 5 avisos.
const DOCUMENTO = () => ({
  nos: [
    { id: 'no_inicio', tipo: 'inicio', titulo: 'Início', config: {}, ui: { x: 40, y: 40 } },
    {
      id: 'no_botoes', tipo: 'botoes', titulo: 'Confirma?',
      config: { corpo: 'Confirma?', botoes: [{ id: 'sim', rotulo: 'sim' }, { id: 'nao', rotulo: 'não' }] },
      ui: { x: 420, y: 40 },
    },
  ],
  arestas: [], variaveis: [],
});

// ── O NAVEGADOR DE MENTIRA ──────────────────────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="raiz"></div></body></html>', {
  url: 'http://localhost/fluxos#fluxo=f1', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const nome of ['HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'MouseEvent', 'localStorage', 'getComputedStyle']) {
  globalThis[nome] = window[nome];
}
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa PointerEvent nem captura de ponteiro — o editor usa os dois.
class PointerEvent extends window.MouseEvent {
  constructor(tipo, init = {}) {
    super(tipo, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType || 'mouse';
  }
}
window.PointerEvent = PointerEvent;
globalThis.PointerEvent = PointerEvent;
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.Element.prototype.hasPointerCapture = function () { return false; };

// ── O DUBLÊ DA REDE ─────────────────────────────────────────────────────────────────────────────
const rede = { chamadas: [], rascunho: null, podeAdministrar: true, temRascunho: true, catalogo: null };
function zerar({ podeAdministrar = true, temRascunho = true, catalogo = null } = {}) {
  rede.chamadas = [];
  rede.rascunho = { fluxoId: 'f1', documento: DOCUMENTO(), rev: 3 };
  rede.podeAdministrar = podeAdministrar;
  rede.temRascunho = temRascunho;
  rede.catalogo = catalogo;
}
globalThis.fetch = async (url, opcoes = {}) => {
  const u = String(url);
  const metodo = opcoes.method || 'GET';
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
  rede.chamadas.push({ u, metodo, corpo });
  const ok = (c) => ({ status: 200, ok: true, text: async () => JSON.stringify(c) });
  const nao = (s, c) => ({ status: s, ok: false, text: async () => JSON.stringify(c) });
  if (u.endsWith('/sessao/eu')) return ok({ autenticado: true, ator: { id: 'u1', nome: 'Dono', papel: 'super' }, versao: 'teste' });
  if (u.endsWith('/saude')) return ok({ schema: { pronto: true }, podeAgora: { administrarFluxos: rede.podeAdministrar, publicar: true }, componentes: {} });
  if (u.endsWith('/catalogo')) return rede.catalogo ? ok(rede.catalogo) : nao(404, { error: 'sem catálogo neste dublê' });
  if (/\/fluxos\/f1$/.test(u)) {
    return ok({
      fluxo: { id: 'f1', nome: 'Principal', estado: 'rascunho', entrada: 'caixa' },
      rascunho: rede.temRascunho ? rede.rascunho : null, versaoPublicada: null, totalVersoes: 0,
    });
  }
  if (/\/fluxos\/f1\/rascunho$/.test(u)) {
    if (metodo === 'PUT') { rede.rascunho = { ...rede.rascunho, documento: corpo.documento, rev: corpo.rev + 1 }; return ok({ rev: rede.rascunho.rev }); }
    return ok(rede.rascunho);
  }
  if (/\/fluxos(\?|$)/.test(u)) return ok({ total: 1, itens: [{ id: 'f1', nome: 'Principal', estado: 'rascunho' }] });
  return ok({ itens: [] });
};

const { React, act, createRoot, FluxosRagnabot } = await import(PACOTE);

let root = null;
async function montar(opcoes) {
  zerar(opcoes);
  if (root) { await act(async () => { root.unmount(); }); }
  document.getElementById('raiz').innerHTML = '';
  root = createRoot(document.getElementById('raiz'));
  await act(async () => { root.render(React.createElement(FluxosRagnabot)); });
  await assentar();
}
async function assentar(voltas = 8) {
  for (let i = 0; i < voltas; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 12)); });
}
/** O salvamento tem recuo (o editor não grava a cada pixel). Espera a gravação sair, com teto. */
async function esperarGravacao(quantos = 1, tetoMs = 4000) {
  const ate = Date.now() + tetoMs;
  while (Date.now() < ate) {
    if (rede.chamadas.filter((c) => c.metodo === 'PUT').length >= quantos) { await assentar(2); return true; }
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  }
  return false;
}
const texto = () => document.body.textContent || '';
const pinos = () => [...document.querySelectorAll('.rgfx-pino')];
const pinoDe = (rotulo) => pinos().find((p) => (p.textContent || '').trim().startsWith(rotulo));
const blocoDe = (titulo) => [...document.querySelectorAll('.rgfx-bloco')].find((b) => (b.textContent || '').includes(titulo));
const arestas = () => rede.rascunho.documento.arestas || [];
const puts = () => rede.chamadas.filter((c) => c.metodo === 'PUT');

async function clicar(el) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await assentar(3);
}

/** Arrasta do conector até um destino. `destino` = o elemento que estará sob o ponteiro ao soltar. */
async function arrastar(pino, destino, { pontos = 3 } = {}) {
  // jsdom não faz layout: `elementFromPoint` é sempre `null`. Injetamos o alvo, e dizemos isto na
  // cara — quem mede o acerto de verdade é o teste de navegador.
  const originalEFP = document.elementFromPoint;
  document.elementFromPoint = () => destino;
  await act(async () => {
    pino.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, clientX: 100, clientY: 100 }));
  });
  for (let i = 1; i <= pontos; i += 1) {
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 100 + i * 60, clientY: 100 + i * 10 }));
    });
  }
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 400, clientY: 140 }));
    // O navegador ainda dispara `click` no conector depois do arraste — é a armadilha que a trava
    // `refCliqueDoPinoSuprimido` fecha. Reproduzida aqui de propósito.
    pino.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  document.elementFromPoint = originalEFP;
  await assentar(4);
}

console.log('\nLIGAR DOIS NÓS — o que eu consegui medir\n');
console.log('1) O DESENHO CHEGA NA TELA');
await montar();
medir('os dois nós do dono aparecem, com os conectores de cada um', () => {
  assert.equal(document.querySelectorAll('.rgfx-bloco').length, 2);
  assert.ok(pinoDe('segue'), 'faltou o conector "segue" do nó de início');
  assert.ok(pinoDe('sim'), 'faltou o conector do botão "sim"');
});
// ⭐ 03/09/2026 (S-PUBLICAR): a barra deixou de dizer «erro(s) de desenho» — porque o número já não
// é da tela. Ele passou a ser o do SERVIDOR (`POST /validar`), o mesmo que a publicação usa. Este
// dublê de rede NÃO responde `/validar` de propósito, então aqui medimos o caminho de recuo: a
// tela mostra a conferência local E DIZ que é local. Número sem procedência foi exatamente como a
// barra ficou verde mentindo enquanto a publicação recusava.
medir('o diagnóstico é o mesmo que o dono viu: 3 erros e 5 avisos', () => {
  assert.match(texto(), /3 erro\(s\)/);
  assert.match(texto(), /5 aviso\(s\)/);
});
medir('⭐ sem resposta do servidor, a barra DECLARA que a conferência é local', () => {
  assert.match(texto(), /local|conferindo/);
  assert.equal(/do servidor/.test(texto()), false, 'não pode alegar procedência que não tem');
});

console.log('\n2) O CAMINHO DE DOIS TOQUES');
medir('tocar o conector ARMA a ligação', () => {
  assert.equal(texto().includes('Ligando a saída'), false, 'não podia estar armada antes');
});
await clicar(pinoDe('segue'));
medir('…e a faixa diz de qual saída, de qual nó', () => {
  assert.match(texto(), /Ligando a saída/);
  assert.match(texto(), /no_inicio/);
});
medir('⭐ tocar o conector NÃO abre o painel de inspeção — era ele que cobria o nó de destino', () => {
  assert.equal(document.querySelectorAll('.rgfx-lateral').length, 0,
    'o painel de 380 px voltou a abrir no toque do conector: é exatamente o defeito de 03/09');
});
await clicar(blocoDe('Confirma?').querySelector('.rgfx-punho'));
await esperarGravacao(1);
medir('tocar o nó de destino FECHA a ligação', () => {
  assert.deepEqual(arestas(), [{ de: 'no_inicio', saida: 'padrao', para: 'no_botoes' }]);
  assert.equal(texto().includes('Ligando a saída'), false, 'a ligação ficou armada depois de fechar');
});
medir('a ligação foi GRAVADA no servidor (não ficou só na tela)', () => {
  const p = puts();
  assert.ok(p.length >= 1, 'nenhum PUT de rascunho saiu');
  assert.deepEqual(p[p.length - 1].corpo.documento.arestas, [{ de: 'no_inicio', saida: 'padrao', para: 'no_botoes' }]);
});

console.log('\n3) REABRIR E A LIGAÇÃO CONTINUAR LÁ');
{
  const gravado = JSON.parse(JSON.stringify(rede.rascunho));
  await montar();
  rede.rascunho = gravado;                 // o servidor devolve o que foi gravado
  await act(async () => { root.render(React.createElement(FluxosRagnabot)); });
  await assentar();
  medir('a aresta gravada volta desenhada ao reabrir o fluxo', () => {
    assert.equal(document.querySelectorAll('.rgfx-bloco').length, 2);
    assert.deepEqual(rede.rascunho.documento.arestas, [{ de: 'no_inicio', saida: 'padrao', para: 'no_botoes' }]);
  });
}

console.log('\n4) O CAMINHO DO ARRASTE (o gesto que antes não fazia NADA)');
await montar();
await arrastar(pinoDe('segue'), blocoDe('Confirma?'));
await esperarGravacao(1);
medir('⭐ arrastar do conector até o nó liga — e grava', () => {
  assert.deepEqual(arestas(), [{ de: 'no_inicio', saida: 'padrao', para: 'no_botoes' }]);
});
medir('o `click` que o navegador dispara depois do arraste NÃO rearma nada', () => {
  assert.equal(texto().includes('Ligando a saída'), false,
    'sobrou uma ligação armada por engano: a trava do clique pós-arraste falhou');
});

console.log('\n5) QUANDO NÃO DÁ, A TELA DIZ O MOTIVO (nunca fica muda)');
await montar();
await arrastar(pinoDe('segue'), null);      // soltou no vazio
medir('soltar no vazio não joga o gesto fora: continua armado e explica', () => {
  assert.match(texto(), /Ligando a saída/);
  assert.match(texto(), /Soltei no vazio/);
});
await montar();
await clicar(pinoDe('segue'));
await clicar(blocoDe('Confirma?').querySelector('.rgfx-punho'));
await esperarGravacao(1);
await clicar(pinoDe('segue'));
await clicar(blocoDe('Confirma?').querySelector('.rgfx-punho'));
await assentar(6);
medir('a segunda ligação na MESMA saída é recusada com o motivo escrito', () => {
  assert.equal(arestas().length, 1, 'o banco recusa duas arestas na mesma saída; a tela tem de recusar antes');
  assert.match(texto(), /já tem destino/);
});
await montar({ podeAdministrar: false });
await clicar(pinoDe('segue'));
medir('sem permissão, tocar o conector NÃO fica em silêncio — diz por que não dá', () => {
  assert.equal(texto().includes('Ligando a saída'), false);
  assert.match(texto(), /não pode administrar fluxos/);
});

console.log('\n6) O CATÁLOGO DO SERVIDOR MANDA NOS CONECTORES');
await montar({ catalogo: {
  total: 2,
  tipos: {
    inicio: { tipo: 'inicio', estaciona: false, saidasFixas: ['padrao'], saidasDeExcecao: [], saidasDeFalha: [] },
    botoes: { tipo: 'botoes', estaciona: true, saidasFixas: [], saidasDeExcecao: ['sem_resposta', 'opcao_invalida', 'erro'], saidasDeFalha: ['sem_janela'] },
  },
} });
medir('com `GET /catalogo` respondendo, a faixa do espelho local SOME', () => {
  assert.equal(texto().includes('espelho local'), false, 'a faixa amarela continuou, com catálogo do servidor na mão');
});
medir('as saídas desenhadas são as que o servidor declarou (inclusive `fora da janela de 24 h`)', () => {
  const rotulos = pinos().map((p) => (p.textContent || '').trim());
  assert.ok(rotulos.some((r) => r.startsWith('fora da janela de 24 h')), `saídas desenhadas: ${rotulos.join(' | ')}`);
  assert.ok(rotulos.some((r) => r.startsWith('sim')), 'a saída do botão vem do documento, não do catálogo');
});

console.log(`\n${medicoes} medições · ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
