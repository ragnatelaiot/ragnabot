/*
 * Teste do ragnabot-identidade.js sem navegador.
 *
 * Não há jsdom nem Chrome nesta máquina, então montamos um DOM mínimo — só o que o
 * script usa de verdade — e reproduzimos a estrutura REAL do rodapé da barra lateral
 * do Chatwoot 4.17 (aside > ... > button > div > [div nome, div e-mail]), extraída
 * de SidebarProfileMenu.vue no contêiner em execução.
 *
 * O que este teste prova: encaixe no lugar certo, idempotência (nunca duplica),
 * atualização quando a empresa muda, silêncio quando a barra está recolhida e
 * silêncio quando a store do painel não existe.
 *
 * O que ele NÃO prova: o casamento real dos seletores CSS pelo motor do navegador e
 * o comportamento do MutationObserver de verdade — isso só se mede no painel no ar.
 *
 * Rodar:  node deploy/identidade/teste-identidade.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

/* ── DOM mínimo ───────────────────────────────────────────────────────────── */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.className = '';
    this.title = '';
    this._texto = '';
  }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  appendChild(f) { f.parentElement = this; this.children.push(f); return f; }
  get textContent() {
    if (this.children.length === 0) return this._texto;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this.children = []; this._texto = String(v); }
  descendentes(saida = []) {
    for (const c of this.children) { saida.push(c); c.descendentes(saida); }
    return saida;
  }
  // suporta só o que o script usa: cadeia de tags separada por espaço
  querySelectorAll(sel) {
    const passos = sel.trim().split(/\s+/).map((s) => s.toUpperCase());
    let atual = [this];
    for (const passo of passos) {
      const prox = [];
      for (const no of atual) for (const d of no.descendentes()) if (d.tagName === passo) prox.push(d);
      atual = prox;
    }
    return atual;
  }
  // suporta só [attr="valor"]
  querySelector(sel) {
    const m = /^\[([^\]=]+)="([^"]*)"\]$/.exec(sel.trim());
    if (!m) return null;
    for (const d of this.descendentes()) if (d.getAttribute(m[1]) === m[2]) return d;
    return null;
  }
}

function montarDom({ recolhida = false, email = 'operador@empresa.com.br', nome = 'Operador Teste' } = {}) {
  const html = new El('html');
  const body = new El('body');
  html.appendChild(body);

  const app = new El('div');
  app.setAttribute('id', 'app');
  body.appendChild(app);

  const aside = new El('aside');
  app.appendChild(aside);

  const seletorConta = new El('button');
  seletorConta.setAttribute('id', 'sidebar-account-switcher');
  aside.appendChild(seletorConta);

  const botao = new El('button');
  aside.appendChild(botao);
  botao.appendChild(new El('div')); // avatar

  if (!recolhida) {
    const caixa = new El('div');
    caixa.className = 'min-w-0';
    botao.appendChild(caixa);
    const lNome = new El('div');
    lNome.className = 'text-sm font-medium leading-4 truncate text-n-slate-12';
    lNome.textContent = nome;
    caixa.appendChild(lNome);
    const lEmail = new El('div');
    lEmail.className = 'text-xs truncate text-n-slate-11';
    lEmail.textContent = email;
    caixa.appendChild(lEmail);
  }
  return { html, body, app, aside, botao };
}

function instalarAmbiente({ dom, store }) {
  const doc = {
    readyState: 'complete',
    documentElement: dom.html,
    body: dom.body,
    getElementById(id) {
      for (const d of dom.html.descendentes()) if (d.getAttribute('id') === id) return d;
      return null;
    },
    querySelectorAll: (sel) => dom.html.querySelectorAll(sel),
    querySelector: (sel) => dom.html.querySelector(sel),
    createElement: (t) => new El(t),
    addEventListener() {},
  };
  if (store) dom.app.__vue_app__ = { config: { globalProperties: { $store: store } } };
  const win = {
    document: doc,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn) => { fn(); return 1; },
    setInterval: () => 1, // não queremos relógio vivo no teste
    clearInterval: () => {},
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.setInterval = win.setInterval;
  globalThis.clearInterval = win.clearInterval;
  return { doc, win };
}

function storaFalsa(nomeEmpresa, email) {
  return {
    getters: {
      get getCurrentAccount() { return { id: 7, name: nomeEmpresa }; },
      get getCurrentUser() { return { email, available_name: 'Operador Teste' }; },
    },
  };
}

function linhas(caixa) {
  return caixa.children.map((c) => ({ papel: c.getAttribute('data-rgt-identidade'), texto: c.textContent }));
}
function caixaDoUsuario(dom) {
  const b = dom.botao.children.find((c) => c.className === 'min-w-0');
  return b || null;
}

/* ── Casos ────────────────────────────────────────────────────────────────── */
const fonte = fs.readFileSync(path.join(aqui, 'ragnabot-identidade.js'), 'utf8');
const VERSAO_ESPERADA = /var VERSAO = '([^']+)'/.exec(fonte)[1];
const ROTULO = `Ragnabot v${VERSAO_ESPERADA}`;

let falhas = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`);
  if (!cond) falhas += 1;
}

function carregar() {
  // reexecuta a IIFE num escopo limpo
  // eslint-disable-next-line no-new-func
  new Function(fonte)();
  return globalThis.window.ragnabotIdentidade;
}

console.log(`\n== versão lida do arquivo: ${VERSAO_ESPERADA} ==\n`);

// 1) caminho feliz
{
  const dom = montarDom();
  instalarAmbiente({ dom, store: storaFalsa('Ragnatela IoT Solutions', 'operador@empresa.com.br') });
  const api = carregar();
  const c = caixaDoUsuario(dom);
  const l = linhas(c);
  ok(l.length === 4, `1. insere 2 linhas (achou ${l.length}): ${JSON.stringify(l.map((x) => x.texto))}`);
  ok(l[2].papel === 'empresa' && l[2].texto === 'Ragnatela IoT Solutions', '1. linha da empresa com o nome da conta');
  ok(l[3].papel === 'versao' && l[3].texto === ROTULO, `1. linha da versão = "${ROTULO}"`);
  ok(api.versao === VERSAO_ESPERADA, '1. window.ragnabotIdentidade.versao exposto');

  // 2) idempotência: 5 reaplicações não duplicam nada
  for (let i = 0; i < 5; i += 1) api.reaplicar();
  ok(linhas(c).length === 4, `2. idempotente após 5 reaplicações (linhas=${linhas(c).length})`);
}

// 3) troca de empresa é refletida sem duplicar
{
  const dom = montarDom();
  let nomeConta = 'Empresa Um';
  const store = {
    getters: {
      get getCurrentAccount() { return { id: 1, name: nomeConta }; },
      get getCurrentUser() { return { email: 'operador@empresa.com.br' }; },
    },
  };
  instalarAmbiente({ dom, store });
  const api = carregar();
  const c = caixaDoUsuario(dom);
  nomeConta = 'Empresa Dois';
  api.reaplicar();
  const l = linhas(c);
  ok(l.length === 4 && l[2].texto === 'Empresa Dois', `3. atualiza o nome da empresa sem duplicar: ${JSON.stringify(l.map((x) => x.texto))}`);
}

// 4) barra recolhida: não há onde escrever → não faz nada e não quebra
{
  const dom = montarDom({ recolhida: true });
  instalarAmbiente({ dom, store: storaFalsa('Empresa X', 'operador@empresa.com.br') });
  let quebrou = false;
  try { carregar().reaplicar(); } catch (e) { quebrou = true; }
  ok(!quebrou, '4. barra recolhida: não lança exceção');
  ok(dom.botao.children.length === 1, '4. barra recolhida: nada foi inserido');
}

// 5) sem store (painel ainda montando, ou versão futura que mude o caminho):
//    sem e-mail não há âncora → silêncio total
{
  const dom = montarDom();
  instalarAmbiente({ dom, store: null });
  let quebrou = false;
  try { carregar().reaplicar(); } catch (e) { quebrou = true; }
  ok(!quebrou, '5. sem store: não lança exceção');
  ok(linhas(caixaDoUsuario(dom)).length === 2, '5. sem store: nada foi inserido (painel intacto)');
}

// 6) plano B da empresa: store sem conta, mas o seletor de conta do topo tem o nome
{
  const dom = montarDom();
  dom.aside.children[0].textContent = 'Empresa Pelo Seletor';
  const store = {
    getters: {
      get getCurrentAccount() { return {}; },
      get getCurrentUser() { return { email: 'operador@empresa.com.br' }; },
    },
  };
  instalarAmbiente({ dom, store });
  carregar();
  const l = linhas(caixaDoUsuario(dom));
  ok(l.length === 4 && l[2].texto === 'Empresa Pelo Seletor', `6. plano B lê o seletor de conta: ${JSON.stringify(l.map((x) => x.texto))}`);
}

// 7) isca: um painel lateral anterior mostrando o MESMO e-mail, sem o nome ao lado.
//    A caixa certa (a que tem nome + e-mail) e a que deve receber as linhas.
{
  const dom = montarDom();
  const isca = new El('aside');
  const botaoIsca = new El('button');
  const caixaIsca = new El('div');
  const linhaIsca = new El('div');
  linhaIsca.textContent = 'operador@empresa.com.br';
  caixaIsca.appendChild(linhaIsca);
  botaoIsca.appendChild(caixaIsca);
  isca.appendChild(botaoIsca);
  // entra ANTES do aside verdadeiro na ordem do documento
  dom.app.children.unshift(isca);
  isca.parentElement = dom.app;

  instalarAmbiente({ dom, store: storaFalsa('Empresa Certa', 'operador@empresa.com.br') });
  carregar();
  ok(caixaIsca.children.length === 1, '7. isca NAO recebeu as linhas');
  const l = linhas(caixaDoUsuario(dom));
  ok(l.length === 4 && l[2].texto === 'Empresa Certa', `7. caixa verdadeira recebeu: ${JSON.stringify(l.map((x) => x.texto))}`);
}

console.log(`\n${falhas === 0 ? 'TODOS OS CASOS PASSARAM' : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
