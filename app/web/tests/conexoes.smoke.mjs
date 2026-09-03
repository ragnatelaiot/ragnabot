// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DE CONEXÕES (contrato S6, 02/09/2026 — doc 34 §F9.2.3 a §F9.2.7)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE, e não vou fingir que mede:
//   · a regra de negócio (cota, transferência, reinício, provedor) — ela é do servidor e tem teste
//     próprio (`app/tests/ragnabot-conexao.test.mjs`, 36 medições, e `…-provedor.test.mjs`, 22);
//   · o `useEffect`, o clique e o recado que aparece depois: SSR não roda efeito. Isso só com
//     navegador contra o motor no ar;
//   · o ISOLAMENTO entre empresas. Quem tranca é o servidor; o botão escondido é cortesia.
//
// Rodar (a partir de `app/web/`):   node tests/conexoes.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'conexoes');

let falhas = 0; let medicoes = 0;
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
  const r = rede.proxima || { status: 200, corpo: {} };
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.corpo) };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-conexoes.js');

// As 4 conexões MEDIDAS na conta 1 em 02/09/2026, no formato do cartão.
const CONEXOES = [
  { id: 'a', tenantId: 't1', cwInboxId: 1, nome: 'Site - Ragnatela', tipoCanal: 'web_widget', canalRotulo: 'Site (widget)', identificador: 'ragnatela.com.br', provedor: 'nativo', provedorRotulo: 'Plataforma (nativo)', provedorOficial: true, capacidadeResumo: 'menu com até 10 botão(ões) e 20 item(ns) de lista · anexo de mídia · sem modelo aprovado', ativa: true, estado: 'conectado', estadoIdadeMin: 3, atualizadaEm: new Date(Date.now() - 120000).toISOString() },
  { id: 'b', tenantId: 't1', cwInboxId: 34, nome: 'WhatsApp Ragnatela', tipoCanal: 'whatsapp', canalRotulo: 'WhatsApp (Cloud API da Meta)', identificador: '+559831970997', provedor: 'meta_direto', provedorRotulo: 'Meta (direto)', provedorOficial: true, capacidadeResumo: 'menu com até 3 botão(ões) e 10 item(ns) de lista · anexo de mídia · modelo aprovado pela Meta', ativa: true, estado: 'desconhecido', estadoIdadeMin: null, atualizadaEm: new Date(Date.now() - 120000).toISOString() },
  { id: 'c', tenantId: 't1', cwInboxId: 35, nome: 'Facebook-Ragnatela', tipoCanal: 'facebook', canalRotulo: 'Messenger (página do Facebook)', identificador: 'pagina-1', provedor: 'meta_direto', provedorRotulo: 'Meta (direto)', provedorOficial: true, capacidadeResumo: 'menu em texto numerado (o canal não desenha botão) · anexo de mídia · sem modelo aprovado', ativa: true, estado: 'degradado', estadoIdadeMin: 4300, estadoDetalhe: 'entrega intermitente', atualizadaEm: new Date(Date.now() - 7200000).toISOString() },
  { id: 'd', tenantId: 't1', cwInboxId: 36, nome: 'Instagram-Ragnatela', tipoCanal: 'instagram', canalRotulo: 'Instagram Direct', identificador: 'insta-1', provedor: 'terceiro', provedorRotulo: 'Intermediário externo', provedorOficial: false, capacidadeResumo: 'menu em texto numerado (o canal não desenha botão) · anexo de mídia · sem modelo aprovado', ativa: false, estado: 'desconectado', estadoIdadeMin: 60, removidaEm: '2026-09-01T10:00:00.000Z', atualizadaEm: '2026-09-01T10:00:00.000Z' },
];

const COTA = {
  tenantId: 't1', empresa: 'Ragnatela IoT Solutions', plano: 'profissional', planoRotulo: 'Profissional',
  limite: 5, ativos: 3, usoPct: 60, esgotado: false,
  porCanal: [
    { canal: 'whatsapp', canalRotulo: 'WhatsApp (Cloud API da Meta)', incluidoNoPlano: true, limite: 2, ativos: 1, usoPct: 50, esgotado: false },
    { canal: 'web_widget', canalRotulo: 'Webchat (widget no site)', incluidoNoPlano: true, limite: 2, ativos: 1, usoPct: 50, esgotado: false },
    { canal: 'telegram', canalRotulo: 'Telegram (bot do BotFather)', incluidoNoPlano: false, limite: 0, ativos: 0, usoPct: null, esgotado: false },
  ],
  porProvedor: [{ provedor: 'meta_direto', rotulo: 'Meta (direto)', ativos: 2 }],
};

console.log('\nCONEXÕES — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE (JavaScript puro, com o fetch trocado por dublê)');

await medirAsync('a leitura vai ao router de conexões, com o cookie de sessão junto', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { conexoes: CONEXOES } };
  const r = await api.lerConexoes();
  assert.equal(r.conexoes.length, 4);
  assert.match(rede.chamadas[0].url, /\/api\/ragnabot-conexao\/conexoes$/);
  assert.equal(rede.chamadas[0].opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não vai junto');
});

await medirAsync('trocar provedor é PUT — leitura não muda o mundo, troca muda', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { cwInboxId: 34, provedor: 'whatsmeow' } };
  await api.trocarProvedor(34, { provedor: 'whatsmeow' });
  assert.equal(rede.chamadas[0].metodo, 'PUT');
  assert.match(rede.chamadas[0].url, /\/conexoes\/34\/provedor$/);
  assert.deepEqual(JSON.parse(rede.chamadas[0].opcoes.body), { provedor: 'whatsmeow' });
});

await medirAsync('a recusa do servidor chega com o texto DELE, e com o código', async () => {
  zerar();
  rede.proxima = { status: 409, corpo: { error: 'Limite de 5 caixa(s) de entrada atingido neste plano.', code: 'COTA_DE_CANAIS_ESGOTADA' } };
  try { await api.trocarProvedor(34, { provedor: 'whatsmeow' }); assert.fail('devia ter lançado'); }
  catch (e) {
    assert.match(e.message, /Limite de 5 caixa/u, 'a mensagem do servidor tem de chegar inteira à tela');
    assert.equal(e.code, 'COTA_DE_CANAIS_ESGOTADA');
    assert.equal(e.status, 409);
  }
});

medir('o SINAL nunca depende só da cor: cada estado tem palavra e símbolo', () => {
  for (const estado of ['conectado', 'degradado', 'desconectado', 'desconhecido']) {
    const s = api.SINAIS[estado];
    assert.ok(s.rotulo && s.cor && s.simbolo, `estado ${estado} incompleto`);
  }
  assert.equal(api.sinalDe({ estado: 'coisa_nova' }).rotulo, 'Não medida', 'estado desconhecido cai no mais honesto');
});

medir('⚠️ «Não medida» e não «desconhecida» — a diferença importa numa tela de plantão', () => {
  assert.equal(api.SINAIS.desconhecido.rotulo, 'Não medida');
});

medir('a IDADE da medição é dita, e a medição velha é marcada como velha', () => {
  assert.deepEqual(api.frescorDaMedicao({ estado: 'conectado', estadoIdadeMin: 0 }), { texto: 'medida agora há pouco', velha: false });
  assert.deepEqual(api.frescorDaMedicao({ estado: 'conectado', estadoIdadeMin: 5 }), { texto: 'medida há 5 min', velha: false });
  assert.deepEqual(api.frescorDaMedicao({ estado: 'conectado', estadoIdadeMin: 180 }), { texto: 'medida há 3 h', velha: true });
  assert.deepEqual(api.frescorDaMedicao({ estado: 'conectado', estadoIdadeMin: 4320 }), { texto: 'medida há 3 d', velha: true });
  // Nunca medida é SEMPRE velha: é o pior caso, e a tela tem de tratá-lo como tal.
  assert.deepEqual(api.frescorDaMedicao({ estado: 'desconhecido' }), { texto: 'nunca medida', velha: true });
});

medir('a COTA vira frase que responde «posso ligar mais uma?»', () => {
  assert.match(api.frasearCota(COTA), /3 de 5 conexão\(ões\)/u);
  assert.match(api.frasearCota(COTA), /Ainda cabem 2/u);
  const cheia = { ...COTA, ativos: 5, usoPct: 100, esgotado: true };
  assert.match(api.frasearCota(cheia), /Não cabe mais nenhuma/u);
  assert.match(api.frasearCota(cheia), /Desligue uma conexão|mude o plano/u);
});

medir('a cor do uso vai de verde a vermelho, e nunca inventa cor sem número', () => {
  assert.equal(api.corDoUso(10), '#16a34a');
  assert.equal(api.corDoUso(85), '#d97706');
  assert.equal(api.corDoUso(100), '#dc2626');
  assert.equal(api.corDoUso(null), '#64748b');
});

medir('«última atualização» é null quando não há data — nunca uma data inventada', () => {
  assert.equal(api.desdeQuando(null), null);
  assert.equal(api.desdeQuando('não é data'), null);
  const agora = Date.parse('2026-09-02T12:00:00Z');
  assert.equal(api.desdeQuando('2026-09-02T11:58:00Z', agora), 'há 2 min');
  assert.equal(api.desdeQuando('2026-08-29T12:00:00Z', agora), 'há 4 d');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'Conexoes.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/Conexoes.jsx', '--outDir', 'tests/.ssr/conexoes', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { ListaDeConexoes, CartaoDeConexao, PainelDeCota, Sinal, filtrar } = tela;

const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');
const listaHtml = semMarcas(renderToString(React.createElement(ListaDeConexoes, { conexoes: CONEXOES, busca: '' })));

medir('as 4 conexões aparecem com id, nome, número e canal (a tela 40 do chat atual)', () => {
  for (const c of CONEXOES) {
    assert.match(listaHtml, new RegExp(`data-conexao="${c.cwInboxId}"`), `faltou a conexão ${c.cwInboxId}`);
    assert.ok(listaHtml.includes(c.nome), `faltou o nome ${c.nome}`);
    assert.ok(listaHtml.includes(c.identificador), `faltou o identificador de ${c.nome}`);
  }
  assert.ok(listaHtml.includes('+559831970997'), 'o NÚMERO tem de aparecer — é o que o operador procura');
});

medir('⭐ o cartão diz QUEM OPERA a conexão — a coluna que o chat atual não tem', () => {
  assert.ok(listaHtml.includes('Meta (direto)'));
  assert.ok(listaHtml.includes('Plataforma (nativo)'));
  assert.ok(listaHtml.includes('Intermediário externo'));
});

medir('o cartão diz, em português, o que aquele canal+provedor consegue fazer', () => {
  assert.ok(listaHtml.includes('modelo aprovado pela Meta'));
  assert.ok(listaHtml.includes('menu em texto numerado'));
});

medir('o SINAL aparece com palavra E símbolo — e a idade da medição junto', () => {
  assert.ok(listaHtml.includes('Conectada'));
  assert.ok(listaHtml.includes('Instável'));
  assert.ok(listaHtml.includes('Desconectada'));
  assert.ok(listaHtml.includes('Não medida'), 'o estado não medido tem de ser dito, não escondido');
  assert.ok(listaHtml.includes('nunca medida'));
  assert.ok(listaHtml.includes('medida há 3 d'), 'medição velha tem de aparecer como velha');
});

medir('a conexão DESLIGADA aparece marcada, e não some da tela', () => {
  assert.ok(listaHtml.includes('Desligada'));
  assert.match(listaHtml, /data-conexao="36"/u, 'a conexão removida sumiu — o histórico dela some junto');
});

medir('sem administrar, NÃO há botão de reiniciar/trocar/transferir', () => {
  const doAtendente = semMarcas(renderToString(React.createElement(ListaDeConexoes, { conexoes: CONEXOES, administra: false })));
  assert.ok(!doAtendente.includes('Reiniciar'));
  assert.ok(!doAtendente.includes('Transferir atendimentos'));
  assert.ok(doAtendente.includes('WhatsApp Ragnatela'), 'o atendente ainda LÊ as conexões');
});

medir('administrando, os três botões aparecem — e só nas conexões ATIVAS', () => {
  const doAdmin = semMarcas(renderToString(React.createElement(ListaDeConexoes, { conexoes: CONEXOES, administra: true })));
  assert.ok(doAdmin.includes('Reiniciar'));
  assert.ok(doAdmin.includes('Trocar provedor'));
  assert.ok(doAdmin.includes('Transferir atendimentos'));
  const soDesligada = semMarcas(renderToString(React.createElement(CartaoDeConexao, { conexao: CONEXOES[3], administra: true })));
  assert.ok(!soDesligada.includes('Reiniciar'), 'conexão desligada não pode oferecer reinício');
});

medir('o painel de cota mostra a barra, a frase e o uso por canal', () => {
  const html = semMarcas(renderToString(React.createElement(PainelDeCota, { cota: COTA })));
  assert.match(html, /data-cota="total"/u);
  assert.ok(html.includes('3 de 5 conexão(ões)'));
  assert.ok(html.includes('Ainda cabem 2'));
  assert.ok(html.includes('WhatsApp (Cloud API da Meta): 1/2'));
  assert.ok(!html.includes('Telegram'), 'canal fora do plano não polui o painel');
});

medir('cota ESGOTADA diz o que fazer, não só que acabou', () => {
  const html = semMarcas(renderToString(React.createElement(PainelDeCota, { cota: { ...COTA, ativos: 5, usoPct: 100, esgotado: true } })));
  assert.ok(html.includes('Não cabe mais nenhuma'));
  assert.match(html, /Desligue uma conexão|mude o plano/u);
});

medir('⛔ nenhum segredo é desenhado na tela', () => {
  for (const p of ['segredoCifrado', 'api_key', 'Bearer ', 'provedorConfig', 'credentialFingerprint']) {
    assert.ok(!listaHtml.includes(p), `a tela desenhou "${p}"`);
  }
});

medir('a busca casa por nome, número, canal e provedor', () => {
  assert.equal(filtrar(CONEXOES, '').length, 4);
  assert.equal(filtrar(CONEXOES, '559831970997').length, 1);
  assert.equal(filtrar(CONEXOES, 'meta_direto').length, 2);
  assert.equal(filtrar(CONEXOES, 'Instagram').length, 1);
  assert.equal(filtrar(CONEXOES, '34').length, 1);
  assert.equal(filtrar(CONEXOES, 'nada disso').length, 0);
});

medir('lista vazia explica onde se cria conexão, em vez de mostrar o nada', () => {
  const vazia = semMarcas(renderToString(React.createElement(ListaDeConexoes, { conexoes: [], busca: '' })));
  assert.ok(vazia.includes('Nenhuma conexão cadastrada'));
  assert.ok(vazia.includes('Empresas'), 'a tela vazia tem de dizer PARA ONDE ir');
  const semCasar = semMarcas(renderToString(React.createElement(ListaDeConexoes, { conexoes: [], busca: 'xpto' })));
  assert.ok(semCasar.includes('xpto'));
});

console.log(`\nRESULTADO: ${falhas === 0 ? `${medicoes} de ${medicoes} medições passaram.` : `${falhas} FALHA(S) em ${medicoes} medições.`}`);
process.exit(falhas === 0 ? 0 : 1);
