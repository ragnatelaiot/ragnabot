// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DE CAIXAS DE ENTRADA (contrato S-CAIXAS, 02/09/2026)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE: a sincronização em si. Ela é do servidor e tem teste próprio
// (`app/tests/ragnabot-caixas.test.mjs`, 15 medições). Aqui se mede a TELA e a camada de rede —
// que é tudo o que este contrato acrescentou do lado do navegador.
//
// ⛔ O QUE NÃO DÁ PARA PROVAR AQUI, e não vou fingir que prova: `useEffect` não roda em SSR, então
// a busca inicial, o clique em «Sincronizar agora» e o recado que aparece depois ficam de fora —
// isso só com navegador contra o motor no ar. E o ISOLAMENTO entre empresas não é medido aqui:
// quem tranca é o servidor; o menu escondido é cortesia.
//
// Rodar (a partir de `app/web/`):   node tests/caixas.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'caixas');

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
  rede.chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', opcoes });
  const r = rede.proxima || { status: 200, corpo: { success: true, data: [] } };
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.corpo) };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-caixas.js');

// ── AS 4 CAIXAS MEDIDAS EM 02/09/2026 (id, nome e canal são os de verdade) ─────────────────────
const CAIXAS = [
  { id: 'a', tenantId: 't1', cwInboxId: 1, nome: 'Site - Ragnatela', tipoCanal: 'web_widget', canalRotulo: 'Site (widget)', identificador: 'ragnatela.com.br', ativa: true, sincronizadaEm: new Date(Date.now() - 120000).toISOString(), empresa: { nome: 'Ragnatela IoT Solutions' } },
  { id: 'b', tenantId: 't1', cwInboxId: 34, nome: 'WhatsApp Ragnatela', tipoCanal: 'whatsapp', canalRotulo: 'WhatsApp', identificador: '+559831970997', ativa: true, phoneNumberId: '801234567890123', sincronizadaEm: new Date(Date.now() - 120000).toISOString(), empresa: { nome: 'Ragnatela IoT Solutions' } },
  { id: 'c', tenantId: 't1', cwInboxId: 35, nome: 'Facebook-Ragnatela', tipoCanal: 'facebook', canalRotulo: 'Facebook', identificador: '35', ativa: true, sincronizadaEm: null, empresa: { nome: 'Ragnatela IoT Solutions' } },
  { id: 'd', tenantId: 't1', cwInboxId: 36, nome: 'Instagram-Ragnatela', tipoCanal: 'instagram', canalRotulo: 'Instagram', identificador: '36', ativa: false, removidaEm: '2026-09-01T10:00:00.000Z', sincronizadaEm: null, empresa: { nome: 'Ragnatela IoT Solutions' } },
];

console.log('\nCAIXAS DE ENTRADA — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE (JavaScript puro, com o fetch trocado por dublê)');

await medirAsync('a leitura vai ao NOSSO cadastro, e traz também as removidas', async () => {
  // As removidas vêm de propósito: «esta caixa sumiu da plataforma» é justamente o que explica um
  // fluxo que parou de disparar. Escondê-las devolveria o mistério.
  zerar();
  rede.proxima = { status: 200, corpo: { success: true, data: CAIXAS } };
  const r = await api.lerCaixas();
  assert.equal(r.length, 4);
  assert.equal(rede.chamadas.length, 1);
  assert.match(rede.chamadas[0].url, /\/api\/ragnabot\/inboxes$/, 'sem `?incluirRemovidas=0`');
  assert.equal(rede.chamadas[0].opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não vai junto');
});

await medirAsync('«sincronizar agora» é POST — leitura não muda o mundo, reconciliação muda', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { success: true, data: { empresas: 1, caixasNaPlataforma: 4, novasNoCadastro: 4 } } };
  const r = await api.sincronizarAgora();
  assert.equal(rede.chamadas[0].metodo, 'POST');
  assert.match(rede.chamadas[0].url, /\/inboxes\/sincronizar$/);
  assert.equal(r.novasNoCadastro, 4);
});

medir('o resumo da passada é uma FRASE, não três números soltos', () => {
  const primeira = api.resumirPassada({ empresas: 1, caixasNaPlataforma: 4, novasNoCadastro: 4 });
  assert.match(primeira, /4 caixa\(s\) na plataforma/);
  assert.match(primeira, /4 caixa\(s\) registrada\(s\)/);
  // A SEGUNDA passada é o que prova idempotência a quem clicou: tem de dizer «nada mudou».
  const segunda = api.resumirPassada({ empresas: 1, caixasNaPlataforma: 4, novasNoCadastro: 0 });
  assert.match(segunda, /Nada mudou/);
  const sumiu = api.resumirPassada({ empresas: 1, caixasNaPlataforma: 3, marcadasComoRemovidas: 1 });
  assert.match(sumiu, /1 marcada\(s\) como removida\(s\)/);
});

medir('canal desconhecido aparece com o nome técnico em vez de sumir da tela', () => {
  assert.equal(api.rotuloDoCanal({ tipoCanal: 'whatsapp' }), 'WhatsApp');
  assert.equal(api.rotuloDoCanal({ tipoCanal: 'web_widget' }), 'Site (widget)');
  assert.equal(api.rotuloDoCanal({ tipoCanal: 'canal_novo_da_plataforma' }), 'canal_novo_da_plataforma');
  assert.equal(api.rotuloDoCanal(null), 'Desconhecido');
});

medir('«nunca conferida» é null, e não uma data inventada', () => {
  assert.equal(api.desdeQuando(null), null);
  assert.equal(api.desdeQuando('não é data'), null);
  const agora = Date.parse('2026-09-02T12:00:00Z');
  assert.equal(api.desdeQuando('2026-09-02T11:58:00Z', agora), 'há 2 min');
  assert.equal(api.desdeQuando('2026-09-02T09:00:00Z', agora), 'há 3 h');
  assert.equal(api.desdeQuando('2026-08-29T12:00:00Z', agora), 'há 4 d');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'CaixasDeEntrada.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/CaixasDeEntrada.jsx', '--outDir', 'tests/.ssr/caixas', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { default: CaixasDeEntrada, ListaDeCaixas, LinhaDeCaixa, filtrar } = tela;

/** O React marca a fronteira entre nós de texto com `<!-- -->`; sem tirar isso, procurar uma frase
 *  inteira no HTML falha por um comentário no meio dela. */
const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

const listaHtml = semMarcas(renderToString(React.createElement(ListaDeCaixas, { caixas: CAIXAS, busca: '' })));

medir('AS 4 CAIXAS MEDIDAS aparecem com id, nome e canal', () => {
  for (const c of CAIXAS) {
    assert.match(listaHtml, new RegExp(`data-caixa="${c.cwInboxId}"`), `faltou a caixa ${c.cwInboxId}`);
    assert.ok(listaHtml.includes(c.nome), `faltou o nome ${c.nome}`);
  }
  for (const rotulo of ['Site (widget)', 'WhatsApp', 'Facebook', 'Instagram']) {
    assert.ok(listaHtml.includes(rotulo), `faltou o canal ${rotulo}`);
  }
});

medir('o id da caixa está VISÍVEL — é ele que se digita ao amarrar um fluxo', () => {
  // O contrato inteiro nasceu de um número trocado. Se a tela não mostrar o número, ela não serve
  // para o que foi feita.
  assert.ok(listaHtml.includes('>34<'), 'o 34 (WhatsApp) tem de aparecer em destaque');
  assert.ok(listaHtml.includes('>35<'), 'o 35 (Facebook) também — é o que foi confundido com a conta');
});

medir('estado NUNCA viaja só na cor: a palavra diz Ativa / Inativa', () => {
  assert.ok(listaHtml.includes('Ativa'));
  assert.ok(listaHtml.includes('Inativa'), 'a caixa removida tem de aparecer marcada, não sumir');
});

medir('«nunca conferida» é dito, em vez de aparecer um traço', () => {
  assert.ok(listaHtml.includes('nunca conferida'));
});

medir('cadastro VAZIO explica o que fazer — foi o estado real de 02/09/2026', () => {
  const vazio = semMarcas(renderToString(React.createElement(ListaDeCaixas, { caixas: [], busca: '' })));
  assert.match(vazio, /Sincronizar agora/);
  const semResultado = semMarcas(renderToString(React.createElement(ListaDeCaixas, { caixas: [], busca: 'zap' })));
  assert.match(semResultado, /Nenhuma caixa casa com/, 'busca sem resultado é outra coisa que cadastro vazio');
});

medir('a busca casa por nome, número, canal, empresa e id', () => {
  assert.equal(filtrar(CAIXAS, '34').length, 1);
  assert.equal(filtrar(CAIXAS, 'whats').length, 1);
  assert.equal(filtrar(CAIXAS, '+5598').length, 1);
  assert.equal(filtrar(CAIXAS, 'ragnatela').length, 4, 'o nome da empresa casa com todas');
  assert.equal(filtrar(CAIXAS, '').length, 4);
  assert.equal(filtrar(CAIXAS, 'não existe').length, 0);
});

medir('a caixa inativa aparece esmaecida, e não escondida', () => {
  const inativa = semMarcas(renderToString(React.createElement(LinhaDeCaixa, { caixa: CAIXAS[3] })));
  assert.match(inativa, /opacity:0\.62/, 'o esmaecido é o sinal secundário; o primário é a palavra');
  assert.ok(inativa.includes('Inativa'));
});

medir('a tela monta sem sessão e sem servidor (não estoura no primeiro quadro)', () => {
  // Um componente que só monta DEPOIS de a rede responder é um componente que mostra tela branca
  // quando a rede falha — que é justamente quando o operador mais precisa dela.
  const html = semMarcas(renderToString(React.createElement(CaixasDeEntrada)));
  assert.match(html, /Caixas de entrada/);
  assert.match(html, /Sincronizar agora/);
});

medir('⛔ NENHUMA CREDENCIAL na tela nem na camada de rede', () => {
  const fonteTela = fs.readFileSync(path.join(RAIZ, 'src', 'paginas', 'CaixasDeEntrada.jsx'), 'utf8');
  const fonteRede = fs.readFileSync(path.join(RAIZ, 'src', 'lib', 'api-caixas.js'), 'utf8');
  for (const proibido of ['api_key', 'access_token', 'bot_token', 'localStorage', 'x-ragnabot-service-token']) {
    assert.ok(!fonteTela.includes(proibido), `a tela menciona ${proibido}`);
    assert.ok(!fonteRede.includes(proibido), `a camada de rede menciona ${proibido}`);
  }
});

console.log(`\nRESULTADO: ${falhas ? `${falhas} FALHA(S) em ${medicoes} medições.` : `${medicoes} de ${medicoes} medições passaram.`}\n`);
process.exit(falhas ? 1 : 0);
