// ════════════════════════════════════════════════════════════════════════════════════════════════
// ESCOLHER A CAIXA PELO NOME (contrato S-CLAREZA, 03/09/2026)
//
// A FRASE DO DONO, diante do campo de criar fluxo: *«seria melhor que esse campo já puxasse em menu
// lista as opções com o nome para não confundir»*. Até aqui o campo era um NÚMERO digitado à mão, e
// errar um dígito não dá erro nenhum: grava, publica e o fluxo simplesmente nunca dispara.
//
// ── O QUE ESTE TESTE MEDE ──────────────────────────────────────────────────────────────────────
//   · a camada de rede pede a lista à API DE FLUXO (e não ao console de operação do SaaS, que é
//     fechado a administrador do grupo RAGNATELA — pendurar a lista lá deixaria o campo vazio
//     justamente para quem o usa);
//   · o rótulo tem NOME e identificador, e NÃO tem o número — repetir o número no texto seria
//     devolver a confusão que a lista veio tirar;
//   · os quatro estados da tela, e nenhum deles é uma lista vazia sem explicação.
//
// ⛔ O QUE ELE NÃO MEDE: `useEffect` não roda em renderização de servidor, então a busca automática
// ao abrir a modal não é exercitada aqui — o estado é passado à mão, que é o que dá para medir sem
// navegador. E a GUARDA continua sendo do servidor: `problemaNaCaixaDoFluxo()` tem teste próprio.
//
// Rodar (a partir de `app/web/`):   node tests/escolha-de-caixa.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'escolha-caixa');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}
async function medirAsync(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

// ── O DUBLÊ DA REDE ─────────────────────────────────────────────────────────────────────────────
const rede = { chamadas: [], proxima: null };
globalThis.fetch = async (url, opcoes = {}) => {
  rede.chamadas.push({ url: String(url), metodo: opcoes.method || 'GET' });
  const r = rede.proxima || { status: 200, corpo: { total: 0, itens: [] } };
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    text: async () => JSON.stringify(r.corpo),
  };
};

const api = await import('../src/lib/api.js');

// As caixas MEDIDAS na conta 1 em 02/09/2026 — id, nome e canal são os de verdade.
const CAIXAS = [
  { cwInboxId: 1, nome: 'Site - Ragnatela', tipoCanal: 'web_widget', canalRotulo: 'Site (widget)', identificador: 'ragnatela.com.br', ativa: true },
  { cwInboxId: 34, nome: 'WhatsApp Ragnatela', tipoCanal: 'whatsapp', canalRotulo: 'WhatsApp', identificador: '+559831970997', ativa: true },
  { cwInboxId: 35, nome: 'Facebook-Ragnatela', tipoCanal: 'facebook', canalRotulo: 'Facebook', identificador: '35', ativa: true },
];

console.log('\nESCOLHER A CAIXA PELO NOME — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE');

await medirAsync('a lista vem da API DE FLUXO, não do console de operação do SaaS', async () => {
  rede.chamadas = [];
  rede.proxima = { status: 200, corpo: { total: 3, itens: CAIXAS } };
  const r = await api.listarCaixasDoEscopo();
  assert.equal(r.itens.length, 3);
  const url = rede.chamadas.at(-1).url;
  assert.match(url, /\/api\/ragnabot-fluxo\/caixas$/u, `pediu em ${url}`);
  // ⛔ `/api/ragnabot/inboxes` é o console do SaaS: só administrador do grupo RAGNATELA passa lá.
  assert.doesNotMatch(url, /\/api\/ragnabot\/inboxes/u);
});

await medirAsync('o super usuário pode estreitar por empresa, e isso viaja na URL', async () => {
  rede.chamadas = [];
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarCaixasDoEscopo({ tenantId: 'emp 1/2' });
  assert.match(rede.chamadas.at(-1).url, /\?tenantId=emp%201%2F2$/u);
});

await medirAsync('resposta sem lista NÃO quebra a tela — devolve vetor vazio', async () => {
  rede.proxima = { status: 200, corpo: { total: 0 } };
  const r = await api.listarCaixasDoEscopo();
  assert.deepEqual(r.itens, []);
});

await medirAsync('o aviso do servidor («sem empresa vinculada») chega inteiro à tela', async () => {
  rede.proxima = { status: 200, corpo: { total: 0, itens: [], aviso: 'usuário sem empresa vinculada' } };
  const r = await api.listarCaixasDoEscopo();
  assert.equal(r.aviso, 'usuário sem empresa vinculada');
});

console.log('\n2) O RÓTULO — o que a pessoa lê na lista');

medir('o rótulo tem o NOME e o identificador da conexão', () => {
  assert.equal(api.rotuloDaCaixa(CAIXAS[1]), 'WhatsApp Ragnatela · +559831970997');
});

medir('⛔ o rótulo NÃO acrescenta o número da plataforma (ele é o VALOR do campo)', () => {
  // Pôr «34» no texto devolveria a confusão que a lista veio tirar. A medição é feita nas caixas
  // cujo identificador é DIFERENTE do id — que é onde a diferença aparece.
  //
  // ⚠️ MEDIDO, e por isso a ressalva: na conta 1, o `identifier` das caixas de Facebook e Instagram
  // É o próprio id («35», «36») — a plataforma não guarda outro endereço para elas. Nesses casos o
  // número aparece no rótulo porque é o identificador REAL da conexão, não porque nós o
  // acrescentamos. Exigir o contrário seria escrever um teste que manda o código mentir.
  for (const c of CAIXAS.filter((x) => x.identificador !== String(x.cwInboxId))) {
    const r = api.rotuloDaCaixa(c);
    assert.doesNotMatch(r, new RegExp(`\\b${c.cwInboxId}\\b`), `«${r}» carrega o id`);
  }
  // E o rótulo nunca vira «nome (id 34)» — nenhum enfeite com o número.
  assert.doesNotMatch(api.rotuloDaCaixa(CAIXAS[1]), /\(id|#\d/u);
});

medir('sem identificador, o rótulo cai para o canal — nunca para vazio', () => {
  assert.equal(api.rotuloDaCaixa({ cwInboxId: 9, nome: 'Só nome', canalRotulo: 'WhatsApp' }),
    'Só nome · WhatsApp');
});

medir('caixa sem nome ainda é identificável (não vira linha em branco)', () => {
  assert.match(api.rotuloDaCaixa({ cwInboxId: 9, canalRotulo: 'WhatsApp' }), /caixa 9/u);
});

console.log('\n3) O CAMPO (renderização do lado do servidor)');
console.log('  … empacotando o componente com o Vite (modo SSR)');
execFileSync(process.execPath,
  [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build', '--ssr', 'src/componentes/EscolhaDeCaixa.jsx',
    '--outDir', 'tests/.ssr/escolha-caixa', '--logLevel', 'warn'],
  { cwd: RAIZ, stdio: 'inherit' });

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const { CampoDeCaixa } = await import(path.join(SAIDA_SSR, 'EscolhaDeCaixa.js'));

const desenhar = (caixas, valor = '') => renderToString(React.createElement(CampoDeCaixa, {
  valor, aoMudar: () => {}, caixas,
}));

medir('com cadastro, o campo é uma LISTA com os nomes — não uma caixa de número', () => {
  const h = desenhar({ estado: 'pronto', itens: CAIXAS, erro: null });
  assert.match(h, /<select/u, 'continuou um campo de digitar');
  assert.doesNotMatch(h, /type="number"/u);
  assert.match(h, /WhatsApp Ragnatela/u);
  assert.match(h, /Site - Ragnatela/u);
  // O valor de cada opção é o id da plataforma — é ele que o servidor confere.
  assert.match(h, /value="34"/u);
});

medir('⛔ o nome interno do banco saiu do rótulo («cwInboxId» não é português)', () => {
  const h = desenhar({ estado: 'pronto', itens: CAIXAS, erro: null });
  assert.doesNotMatch(h, /cwInboxId/u);
  assert.match(h, /Caixa de entrada/u);
});

medir('cadastro VAZIO diz o que fazer, em vez de mostrar lista vazia', () => {
  const h = desenhar({ estado: 'pronto', itens: [], erro: null });
  assert.match(h, /Sincronizar\s+agora/u, 'não ensinou o caminho');
  assert.match(h, /Caixas de entrada/u, 'não disse em que tela');
  // E não tranca quem sabe o número: o campo continua lá.
  assert.match(h, /type="number"/u);
});

medir('falha na consulta DIZ o motivo e deixa seguir pelo número', () => {
  const h = desenhar({ estado: 'falhou', itens: [], erro: 'Erro HTTP 503' });
  assert.match(h, /Erro HTTP 503/u, 'engoliu o motivo');
  assert.match(h, /o servidor confere se ela existe/u, 'não disse que a guarda continua de pé');
  assert.match(h, /type="number"/u);
});

medir('enquanto carrega, o campo fica — desabilitado, mas visível', () => {
  const h = desenhar({ estado: 'carregando', itens: [], erro: null });
  assert.match(h, /Procurando as caixas/u);
  assert.match(h, /disabled/u);
});

medir('valor fora do cadastro NÃO some do campo em silêncio', () => {
  // Um fluxo antigo apontando para caixa removida: sem a opção extra, abrir a tela apagaria o
  // valor e salvar gravaria vazio sem ninguém perceber.
  const h = desenhar({ estado: 'pronto', itens: CAIXAS, erro: null }, '99');
  assert.match(h, /value="99"/u);
  assert.match(h, /fora do cadastro/u);
});

console.log(`\nRESULTADO: ${medicoes - falhas} de ${medicoes} medições passaram.\n`);
process.exit(falhas === 0 ? 0 : 1);
