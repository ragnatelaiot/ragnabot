// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DE RESPOSTAS RÁPIDAS (contrato S1, 02/09/2026 · doc 34 §F1.3)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE, e é bom deixar claro antes: o BACKEND. Ele já existe, já roda e
// já tem teste próprio (`app/tests/ragnabot-respostas-rapidas.test.mjs`). Aqui se mede a TELA e a
// camada de rede dela — que é tudo o que este contrato acrescentou.
//
// Como cada coisa é medida:
// · `lib/api-respostas-rapidas.js` é JavaScript puro: o Node importa direto e o `fetch` é trocado
//   por um DUBLÊ que CONTA as chamadas. É assim que «recusa antes de chamar a API» vira medição em
//   vez de opinião: se a recusa vazasse para a rede, o contador subiria.
// · Os componentes são JSX: empacotados com o Vite em modo SSR e renderizados com `renderToString`,
//   mesmo caminho de `empresas.smoke.mjs`.
//
// ⛔ O QUE NÃO DÁ PARA PROVAR AQUI, e não vou fingir que prova: `useEffect` não roda em SSR, então
// a busca da lista, o atraso da digitação, a inserção de variável no cursor e o clique nos botões
// ficam de fora — isso só com navegador contra o motor no ar. E, sobretudo: **o isolamento entre
// empresas não é medido aqui**. Quem tranca é o servidor; o botão desligado é cortesia.
//
// Rodar (a partir de `app/web/`):   node tests/respostas-rapidas.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'respostas');

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
  rede.chamadas.push({
    url: String(url), metodo: opcoes.method || 'GET',
    corpo: opcoes.body ? JSON.parse(opcoes.body) : null, opcoes,
  });
  const r = rede.proxima || { status: 200, corpo: {} };
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    text: async () => JSON.stringify(r.corpo),
  };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-respostas-rapidas.js');

console.log('\nRESPOSTAS RÁPIDAS — o que eu consegui medir\n');
console.log('1) O ATALHO (cópia declarada da regra do servidor)');

medir('acento, maiúscula, espaço e barra são ruído de digitação, não identidade', () => {
  // ⚠️ É o defeito nº 1 do recurso na origem: cadastra «Bom Dia», digita /bomdia e jura que sumiu.
  assert.equal(api.normalizarAtalho('/Bom Dia'), 'bom_dia');
  assert.equal(api.normalizarAtalho('Não Pagou'), 'nao_pagou');
  assert.equal(api.normalizarAtalho('///BOLETO'), 'boleto');
  assert.equal(api.normalizarAtalho('  segunda.via  '), 'segunda.via');
});

medir('atalho impossível é recusado com frase que diz o que fazer', () => {
  for (const ruim of ['', '   ', '!!!', '/', '_comeco', 'a'.repeat(41)]) {
    assert.throws(() => api.normalizarAtalho(ruim), /atalho:/, `passou: ${JSON.stringify(ruim)}`);
  }
});

medir('a prévia do atalho nunca lança (a tela mostra a cada tecla)', () => {
  assert.deepEqual(api.preverAtalho('/Bom Dia'), { ok: true, valor: 'bom_dia', erro: null });
  const r = api.preverAtalho('!!!');
  assert.equal(r.ok, false);
  assert.match(r.erro, /atalho:/);
});

console.log('\n2) A CAMADA DE REDE');

await medirAsync('formulário inválido NÃO chega na rede', async () => {
  zerar();
  await assert.rejects(() => api.criarResposta({ atalho: '!!!', titulo: 'x', mensagem: 'y' }),
    (e) => e.name === 'ErroDeValidacao' && !!e.erros.atalho);
  await assert.rejects(() => api.criarResposta({ atalho: '/oi', titulo: '', mensagem: 'y' }),
    (e) => e.name === 'ErroDeValidacao' && !!e.erros.titulo);
  await assert.rejects(() => api.criarResposta({ atalho: '/oi', titulo: 'Oi', mensagem: '   ' }),
    (e) => e.name === 'ErroDeValidacao' && !!e.erros.mensagem);
  assert.equal(rede.chamadas.length, 0, `vazou ${rede.chamadas.length} chamada(s) para a rede`);
});

await medirAsync('mensagem acima do teto do servidor é recusada aqui, antes da viagem', async () => {
  zerar();
  await assert.rejects(() => api.criarResposta({
    atalho: '/longo', titulo: 'Longo', mensagem: 'x'.repeat(api.LIMITES.mensagem + 1),
  }), (e) => e.name === 'ErroDeValidacao');
  assert.equal(rede.chamadas.length, 0);
});

await medirAsync('cadastro válido vai na rota certa, com o atalho JÁ normalizado', async () => {
  zerar();
  rede.proxima = { status: 201, corpo: { criada: true, resposta: { id: 'r1' } } };
  await api.criarResposta({ atalho: '/Bom Dia', titulo: '  Saudação  ', mensagem: 'Olá!', visibilidade: 'pessoal' });
  assert.equal(rede.chamadas.length, 1);
  const c = rede.chamadas[0];
  assert.equal(c.url, '/api/ragnabot-respostas-rapidas/');
  assert.equal(c.metodo, 'POST');
  assert.equal(c.corpo.atalho, 'bom_dia', 'o atalho tem de ir canônico — o banco guarda sem a barra');
  assert.equal(c.corpo.titulo, 'Saudação', 'espaço nas pontas do nome é digitação, não nome');
  assert.equal(c.corpo.visibilidade, 'pessoal');
  assert.equal(c.opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não viaja');
});

await medirAsync('a edição é PATCH e o desligar manda SÓ o campo `ativa`', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { alterada: true, resposta: {} } };
  await api.editarResposta('r1', { atalho: '/oi', titulo: 'Oi', mensagem: 'texto' });
  assert.equal(rede.chamadas[0].metodo, 'PATCH');
  assert.equal(rede.chamadas[0].url, '/api/ragnabot-respostas-rapidas/r1');

  zerar();
  rede.proxima = { status: 200, corpo: { alterada: true, resposta: {} } };
  await api.alternarAtiva('r1', false);
  // ⚠️ PATCH parcial: mandar o corpo inteiro no «desligar» faria a tela reescrever texto e escopo
  // com o que ela tinha em memória — e sobrescrever a edição de um colega feita no meio-tempo.
  assert.deepEqual(rede.chamadas[0].corpo, { ativa: false });
});

await medirAsync('excluir usa DELETE, e o id vai escapado na URL', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { removida: true, resposta: {} } };
  await api.removerResposta('id com espaço');
  assert.equal(rede.chamadas[0].metodo, 'DELETE');
  assert.equal(rede.chamadas[0].url, '/api/ragnabot-respostas-rapidas/id%20com%20espa%C3%A7o');
});

await medirAsync('a busca e os filtros viram consulta na URL, não corpo', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.lerRespostas({ busca: 'boleto', visibilidade: 'pessoal', incluirInativas: true });
  const u = rede.chamadas[0].url;
  assert.match(u, /busca=boleto/);
  assert.match(u, /visibilidade=pessoal/);
  assert.match(u, /incluirInativas=true/);
  assert.equal(rede.chamadas[0].metodo, 'GET');
});

await medirAsync('nenhum pedido carrega credencial nem papel de ator', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { itens: [] } };
  await api.lerRespostas({});
  const nomes = Object.keys(rede.chamadas[0].opcoes.headers || {}).map((n) => n.toLowerCase());
  assert.ok(!nomes.some((n) => n.includes('token') || n.includes('ator') || n.includes('authorization')),
    `cabeçalho suspeito: ${nomes.join(', ')}`);
});

await medirAsync('o 503 de tabela não migrada chega com o código, para a tela explicar', async () => {
  zerar();
  rede.proxima = { status: 503, corpo: { error: 'A tabela ainda não está disponível…', code: 'MODELO_AUSENTE' } };
  await assert.rejects(() => api.lerRespostas({}), (e) => e.status === 503 && e.code === 'MODELO_AUSENTE');
});

console.log('\n3) QUEM PODE MEXER (cortesia da tela — a trava é o servidor)');

const ADMIN = { id: 'cw:1', papel: 'admin', isSuperuser: false };
const AGENTE = { id: 'cw:9', papel: 'user', isSuperuser: false };
const DA_EMPRESA = { id: 'a', visibilidade: 'empresa', userId: null };
const MINHA = { id: 'b', visibilidade: 'pessoal', userId: 'cw:9' };
const DO_COLEGA = { id: 'c', visibilidade: 'pessoal', userId: 'cw:8' };

medir('resposta da empresa: administrador mexe, atendente não', () => {
  assert.equal(api.podeMexerNesta(ADMIN, DA_EMPRESA), true);
  assert.equal(api.podeMexerNesta(AGENTE, DA_EMPRESA), false);
});

medir('resposta pessoal é do DONO — nem o administrador mexe na do atendente', () => {
  assert.equal(api.podeMexerNesta(AGENTE, MINHA), true);
  assert.equal(api.podeMexerNesta(AGENTE, DO_COLEGA), false);
  assert.equal(api.podeMexerNesta(ADMIN, DO_COLEGA), false, 'admin não é dono da gaveta alheia');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n4) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'RespostasRapidas.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/RespostasRapidas.jsx', '--outDir', 'tests/.ssr/respostas', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { default: RespostasRapidas, ListaDeRespostas, LinhaDeResposta, FormularioDeResposta, resumir } = tela;

/** O React marca a fronteira entre nós de texto com `<!-- -->`; sem tirar isso, procurar uma frase
 *  inteira no HTML falha por um comentário no meio dela. */
const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

const RESPOSTAS = [
  {
    id: 'r1', atalho: 'bomdia', atalhoExibido: '/bomdia', titulo: 'Saudação de bom dia',
    mensagem: 'Bom dia, {{contactFirstName}}! Aqui é a {{empresa}}.',
    visibilidade: 'empresa', userId: null, ativa: true, variaveis: ['contactFirstName', 'empresa'],
  },
  {
    id: 'r2', atalho: 'boleto', atalhoExibido: '/boleto', titulo: 'Segunda via do boleto',
    mensagem: 'Já mandei a segunda via para o seu e-mail.',
    visibilidade: 'pessoal', userId: 'cw:9', ativa: false, variaveis: [],
  },
];

const listaComoAgente = semMarcas(renderToString(React.createElement(ListaDeRespostas, {
  respostas: RESPOSTAS, busca: '', ator: AGENTE,
})));

medir('a lista mostra atalho, nome, escopo e o começo do texto', () => {
  assert.match(listaComoAgente, /\/bomdia/);
  assert.match(listaComoAgente, /Saudação de bom dia/);
  assert.match(listaComoAgente, /Todos/);
  assert.match(listaComoAgente, /Só eu/);
  assert.match(listaComoAgente, /Bom dia, \{\{contactFirstName\}\}/);
});

medir('resposta desligada é ETIQUETADA, não escondida', () => {
  // Escondê-la faria o operador cadastrar de novo e levar «já existe» sem entender de onde: o
  // atalho continua trancado no índice único mesmo desligado.
  assert.match(listaComoAgente, /Desligada/);
  assert.match(listaComoAgente, /Segunda via do boleto/);
  assert.match(listaComoAgente, />Ligar</);
});

medir('as variáveis usadas aparecem na linha', () => {
  assert.match(listaComoAgente, /\{\{empresa\}\}/);
});

medir('o atendente NÃO consegue clicar em editar a resposta da EMPRESA', () => {
  const so = semMarcas(renderToString(React.createElement(LinhaDeResposta, {
    resposta: RESPOSTAS[0], ator: AGENTE,
  })));
  assert.match(so, /disabled/, 'os botões deviam vir desligados para quem não pode mexer');
  const comoAdmin = semMarcas(renderToString(React.createElement(LinhaDeResposta, {
    resposta: RESPOSTAS[0], ator: ADMIN,
  })));
  assert.doesNotMatch(comoAdmin, /disabled/, 'o administrador tinha de poder editar a da empresa');
});

medir('lista vazia DIZ que está vazia; busca sem resultado diz OUTRA coisa', () => {
  const vazia = semMarcas(renderToString(React.createElement(ListaDeRespostas, { respostas: [], busca: '', ator: AGENTE })));
  assert.match(vazia, /Nenhuma resposta rápida cadastrada ainda/);
  assert.match(vazia, /vazio de verdade/);
  assert.match(vazia, /Cadastrar a primeira/);

  const semResultado = semMarcas(renderToString(React.createElement(ListaDeRespostas, { respostas: [], busca: 'boleto', ator: AGENTE })));
  assert.match(semResultado, /casa com/);
  assert.match(semResultado, /boleto/);
  assert.doesNotMatch(semResultado, /Cadastrar a primeira/, 'com filtro ligado, «cadastre a primeira» é mentira');
});

medir('o formulário do ATENDENTE não deixa publicar para a empresa, e DIZ por quê', () => {
  const html = semMarcas(renderToString(React.createElement(FormularioDeResposta, {
    valores: { atalho: '', titulo: '', mensagem: '', visibilidade: 'pessoal', ativa: true },
    aoMudar: () => {}, ator: AGENTE, variaveis: [],
  })));
  assert.match(html, /Só eu/);
  assert.match(html, /Todos/);
  assert.match(html, /disabled/, 'a opção «Todos» tinha de vir desligada para o atendente');
  assert.match(html, /é do administrador/, 'botão desligado sem explicação vira chamado de suporte');
});

medir('o formulário do ADMINISTRADOR deixa escolher os dois escopos', () => {
  const html = semMarcas(renderToString(React.createElement(FormularioDeResposta, {
    valores: { ...tela.FORMULARIO_VAZIO },
    aoMudar: () => {}, ator: ADMIN, variaveis: [],
  })));
  assert.doesNotMatch(html, /disabled/);
});

medir('o formulário mostra a prévia do atalho enquanto se digita', () => {
  const html = semMarcas(renderToString(React.createElement(FormularioDeResposta, {
    valores: { atalho: 'Bom Dia', titulo: '', mensagem: '', visibilidade: 'pessoal', ativa: true },
    aoMudar: () => {}, ator: AGENTE, variaveis: [],
  })));
  assert.match(html, /o atendente digita \/bom_dia/);
});

medir('as variáveis do servidor viram botões de inserir', () => {
  const html = semMarcas(renderToString(React.createElement(FormularioDeResposta, {
    valores: { ...tela.FORMULARIO_VAZIO },
    aoMudar: () => {}, ator: ADMIN,
    variaveis: [{ nome: 'contactFirstName', rotulo: 'Primeiro nome do contato', exemplo: 'Maria' }],
  })));
  assert.match(html, /\{\{contactFirstName\}\}/);
});

medir('a tela DIZ o que ainda não faz (uma mensagem só, sem anexo)', () => {
  // ⚠️ Isto é medição de honestidade, e é de propósito: quem vem do chat atual vai procurar «várias
  // mensagens» e «anexo». Dizer que não tem é melhor que deixar a pessoa concluir que quebrou.
  const html = semMarcas(renderToString(React.createElement(FormularioDeResposta, {
    valores: { ...tela.FORMULARIO_VAZIO }, aoMudar: () => {}, ator: ADMIN, variaveis: [],
  })));
  assert.match(html, /ainda não aceita anexo/);
});

medir('a página monta sozinha, com capa e o botão de nova resposta', () => {
  const html = semMarcas(renderToString(React.createElement(RespostasRapidas)));
  assert.ok(html.length > 1500, `veio curto demais (${html.length} caracteres)`);
  assert.match(html, /class="capa"/);
  assert.match(html, /Respostas rápidas/);
  assert.match(html, /Nova resposta/);
});

medir('o resumo do texto não corta palavra no meio', () => {
  const t = 'palavra '.repeat(40);
  const r = resumir(t, 40);
  assert.ok(r.length <= 41, `veio com ${r.length}`);
  assert.match(r, /…$/);
  assert.doesNotMatch(r, /palav…$/, 'cortou no meio da palavra');
  assert.equal(resumir('curto'), 'curto', 'texto curto não ganha reticências');
});

medir('nada do NOC ficou pendurado no HTML', () => {
  const html = semMarcas(renderToString(React.createElement(RespostasRapidas)));
  assert.doesNotMatch(html, /noc_user/);
  assert.doesNotMatch(html, /noc:auth-expired/);
  assert.doesNotMatch(html, /__RAGNABOT__/);
});

console.log(falhas === 0
  ? `\nRESULTADO: ${medicoes} de ${medicoes} medições passaram.\n`
  : `\nRESULTADO: ${falhas} FALHA(S) em ${medicoes} medições.\n`);
process.exit(falhas === 0 ? 0 : 1);
