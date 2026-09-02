// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DA CAIXA DE ATENDIMENTO (contrato S2, 02/09/2026)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE, E É O MAIS IMPORTANTE DE DIZER: o ISOLAMENTO. Ele é do
// SERVIDOR, e a prova dele é `app/tests/ragnabot-caixa-isolamento.test.mjs` — 57 medições contra
// PostgreSQL de verdade e o router de verdade, onde um agente pedindo a conversa de outro PELA API
// recebe 404. Aqui se mede a TELA: que as três etiquetas aparecem, que o contador fica no botão da
// aba e que a camada de rede fala com o caminho certo. Nada do que este arquivo mede protege dado
// nenhum, e não pode ser lido como se protegesse.
//
// ⛔ O que não dá para provar aqui, e não vou fingir que prova: `useEffect` não roda em SSR — a
// busca inicial, o clique nas abas e o painel de histórico só com navegador contra o motor no ar.
//
// Rodar (a partir de `app/web/`):   node tests/caixa.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'caixa');

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
  const r = rede.proxima || { status: 200, corpo: {} };
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.corpo) };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-caixa.js');

/** Uma conversa como o SERVIDOR a entrega (`paraTela`), com as três etiquetas já montadas. */
const CONVERSA = {
  id: 'x1', cwConversationId: 1001, cwAccountId: 1, protocolo: 'RGT-0000000001',
  estado: 'atendendo', ehGrupo: false, comRobo: false,
  caixa: { id: 34, nome: 'WhatsApp Ragnatela', canal: 'whatsapp' },
  setor: { id: 7, nome: 'Suporte' },
  atendente: { id: 11, nome: 'Ana' },
  contato: { id: 5, nome: 'Cliente Um', chave: '+5598911110000' },
  abertaEm: new Date(Date.now() - 3600000).toISOString(),
  ultimaAtividadeEm: new Date(Date.now() - 300000).toISOString(),
  resolvidaEm: null, resolvidaPor: null,
  etiquetas: [
    { tipo: 'caixa', rotulo: 'WhatsApp Ragnatela', valor: 34, canal: 'whatsapp', vazia: false },
    { tipo: 'setor', rotulo: 'Suporte', valor: 7, vazia: false },
    { tipo: 'atendente', rotulo: 'Ana', valor: 11, vazia: false },
  ],
};

const NA_FILA = {
  ...CONVERSA,
  id: 'x2', cwConversationId: 1003, protocolo: null, estado: 'aguardando',
  atendente: { id: null, nome: null },
  etiquetas: [
    { tipo: 'caixa', rotulo: 'WhatsApp Ragnatela', valor: 34, canal: 'whatsapp', vazia: false },
    { tipo: 'setor', rotulo: 'Suporte', valor: 7, vazia: false },
    { tipo: 'atendente', rotulo: 'Sem atendente', valor: null, vazia: true },
  ],
};

console.log('\nCAIXA DE ATENDIMENTO — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE (JavaScript puro, com o fetch trocado por dublê)');

await medirAsync('a lista vai ao caminho da caixa, com a aba e a sub-aba na consulta', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarConversas({ aba: 'abertas', sub: 'aguardando', pagina: 2 });
  assert.equal(rede.chamadas.length, 1);
  assert.match(rede.chamadas[0].url, /\/api\/ragnabot-caixa\/conversas\?/);
  assert.match(rede.chamadas[0].url, /aba=abertas/);
  assert.match(rede.chamadas[0].url, /sub=aguardando/);
  assert.equal(rede.chamadas[0].opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não vai junto');
});

await medirAsync('parâmetro vazio NÃO vira `?busca=` na URL', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarConversas({ aba: 'abertas', busca: '', cwTeamId: undefined });
  assert.ok(!rede.chamadas[0].url.includes('busca='), rede.chamadas[0].url);
  assert.ok(!rede.chamadas[0].url.includes('cwTeamId='), rede.chamadas[0].url);
});

await medirAsync('o contador tem rota PRÓPRIA — a tela não conta o que está na página', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { abertas: 12, atendendo: 3 } };
  const n = await api.contadores({});
  assert.match(rede.chamadas[0].url, /\/contadores/);
  assert.equal(n.abertas, 12);
});

await medirAsync('o histórico SEMPRE leva o setor — é a regra do dono, e ela começa aqui', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { permitido: true, total: 0, itens: [] } };
  await api.historicoDoContato({ cwTeamId: 7, contatoChave: '+5598911110000' });
  assert.match(rede.chamadas[0].url, /\/historico\?/);
  assert.match(rede.chamadas[0].url, /cwTeamId=7/);
});

await medirAsync('403 do servidor vira mensagem legível, com o código preservado', async () => {
  zerar();
  rede.proxima = { status: 403, corpo: { error: 'Você não participa deste setor.', code: 'FORA_DO_SEU_SETOR' } };
  await assert.rejects(
    () => api.historicoDoContato({ cwTeamId: 9, contatoChave: 'x' }),
    (e) => e.status === 403 && e.code === 'FORA_DO_SEU_SETOR' && /não participa/.test(e.message),
  );
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'CaixaDeAtendimento.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/CaixaDeAtendimento.jsx', '--outDir', 'tests/.ssr/caixa', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { CartaoDeConversa, Abas, SubAbas, EtiquetasDoCartao, desdeQuando } = tela;

const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

medir('⭐ o cartão traz as TRÊS etiquetas: caixa · setor · atendente', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: CONVERSA, aba: 'abertas' })));
  assert.match(html, /data-conversa="1001"/);
  assert.ok(html.includes('WhatsApp Ragnatela'), 'faltou a caixa de entrada');
  assert.ok(html.includes('Suporte'), 'faltou o setor');
  assert.ok(html.includes('Ana'), 'faltou o atendente');
  assert.ok(html.includes('RGT-0000000001'), 'faltou o protocolo');
});

medir('⭐ etiqueta vazia NÃO some: a fila mostra «Sem atendente»', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: NA_FILA, aba: 'abertas' })));
  assert.ok(html.includes('Sem atendente'), 'a etiqueta sumiu, e o cartão mudou de forma na fila');
  // Sem protocolo ainda, mostra o número da conversa — nunca um espaço em branco.
  assert.ok(html.includes('#1003'));
});

medir('o estado aparece em PALAVRA, não só em cor', () => {
  const atendendo = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: CONVERSA, aba: 'abertas' })));
  const fila = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: NA_FILA, aba: 'abertas' })));
  assert.ok(atendendo.includes('Atendendo'));
  assert.ok(fila.includes('Aguardando'));
});

medir('na aba Resolvidos o cartão mostra QUANDO foi resolvida e POR QUEM', () => {
  const resolvida = {
    ...CONVERSA, estado: 'resolvida',
    resolvidaEm: new Date(Date.now() - 600000).toISOString(),
    resolvidaPor: { id: 11, nome: 'Ana' },
  };
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: resolvida, aba: 'resolvidos' })));
  assert.ok(html.includes('resolvida há 10 min'), html.slice(0, 400));
  assert.ok(html.includes('por Ana'));
});

medir('⭐ as abas mostram o contador que veio do SERVIDOR', () => {
  const html = semMarcas(renderToString(React.createElement(Abas, {
    aba: 'abertas', contagem: { abertas: 12, resolvidos: 340, grupos: 2 },
  })));
  for (const [aba, n] of [['abertas', 12], ['resolvidos', 340], ['grupos', 2]]) {
    assert.match(html, new RegExp(`data-contador="${aba}"[^>]*>${n}<`), `contador de ${aba} errado`);
  }
});

medir('⭐ as sub-abas de Abertas são Todas · Atendendo · Aguardando · ChatBot, com contador', () => {
  const html = semMarcas(renderToString(React.createElement(SubAbas, {
    sub: null, contagem: { abertas: 12, atendendo: 5, aguardando: 4, chatbot: 3 },
  })));
  for (const s of ['todas', 'atendendo', 'aguardando', 'chatbot']) {
    assert.match(html, new RegExp(`data-subaba="${s}"`), `faltou a sub-aba ${s}`);
  }
  assert.match(html, /data-contador="atendendo"[^>]*>5</);
  assert.match(html, /data-contador="chatbot"[^>]*>3</);
});

medir('contador ausente vira 0 na tela, e não «undefined»', () => {
  const html = semMarcas(renderToString(React.createElement(Abas, { aba: 'abertas', contagem: {} })));
  assert.ok(!html.includes('undefined'), html.slice(0, 300));
  assert.match(html, /data-contador="grupos"[^>]*>0</);
});

medir('as etiquetas isoladas mantêm a ordem caixa → setor → atendente', () => {
  const html = semMarcas(renderToString(React.createElement(EtiquetasDoCartao, { etiquetas: CONVERSA.etiquetas })));
  const iCaixa = html.indexOf('WhatsApp Ragnatela');
  const iSetor = html.indexOf('Suporte');
  const iAgente = html.indexOf('Ana');
  assert.ok(iCaixa >= 0 && iCaixa < iSetor && iSetor < iAgente, `ordem: ${iCaixa}/${iSetor}/${iAgente}`);
});

medir('«há quanto tempo» é relativo — data crua obriga o olho a fazer conta', () => {
  assert.equal(desdeQuando(null), '—');
  assert.equal(desdeQuando('não é data'), '—');
  assert.equal(desdeQuando(new Date(Date.now() - 30000).toISOString()), 'agora');
  assert.equal(desdeQuando(new Date(Date.now() - 5 * 60000).toISOString()), 'há 5 min');
  assert.equal(desdeQuando(new Date(Date.now() - 3 * 3600000).toISOString()), 'há 3 h');
});

// ── RETROCARGA (contrato S3) — a camada de rede fala com o caminho certo ────────────────────────
await medirAsync('«Conferir conversas existentes» chama a rota de SIMULAÇÃO (não grava nada)', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, retrocarga: { lidas: 7, simulacao: true, porEstado: { atendendo: 1 } } } };
  const r = await api.retrocarregarConversas({ simular: true });
  assert.equal(rede.chamadas.length, 1);
  assert.equal(rede.chamadas[0].metodo, 'POST');
  assert.match(rede.chamadas[0].url, /\/ragnabot-caixa\/retrocarga\?simular=1$/, rede.chamadas[0].url);
  assert.equal(r.retrocarga.simulacao, true);
});

await medirAsync('«Trazer conversas existentes» chama a rota SEM simular', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, retrocarga: { lidas: 7, criadas: 7, atualizadas: 0 } } };
  await api.retrocarregarConversas();
  assert.match(rede.chamadas[0].url, /\/ragnabot-caixa\/retrocarga$/, rede.chamadas[0].url);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${medicoes - falhas}/${medicoes} medições passaram`);
if (falhas > 0) process.exit(1);
