// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DE EMPRESAS (contrato S4-EMPRESAS, 30/08/2026)
//
// Quatro coisas foram exigidas, e são estas quatro que este arquivo mede:
//   1. a lista mostra o que veio;
//   2. a lista vazia DIZ que está vazia;
//   3. o formulário recusa identificador fora do formato ANTES de chamar a API;
//   4. excluir exige a confirmação digitada.
//
// ── COMO MEÇO CADA COISA (e o que isso não prova) ───────────────────────────────────────────────
// · A camada de rede (`lib/api-empresas.js`) é JavaScript puro: o Node a importa direto. O `fetch`
//   é trocado por um DUBLÊ que CONTA as chamadas — é assim que "recusa antes de chamar a API" vira
//   medição, e não opinião: se a recusa vazasse para a rede, o contador subiria.
// · Os componentes são JSX: o Node não os lê. Então eles são empacotados com o Vite em modo SSR
//   (mesmo caminho de `monta.smoke.mjs`) e renderizados com `renderToString`.
// ⚠️ O QUE ISTO NÃO PROVA, e não vou fingir que prova: `useEffect` não roda em SSR. A busca da
//   lista, o aperto de mão de 2FA contra o servidor de verdade e o clique nos botões ficam de fora
//   — isso só se mede com navegador contra o motor no ar, e o motor hoje NÃO executa nenhuma
//   escrita desta API (três peças ficaram no NOC; ver o relatório e o cabeçalho de `Empresas.jsx`).
//
// Rodar (a partir de `app/web/`):   node tests/empresas.smoke.mjs
// Ele mesmo constrói o pacote SSR se faltar — não depende de script no package.json.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
// Sai dentro de `tests/.ssr/`, que o `.gitignore` já cobre — e numa SUBPASTA própria, não solta lá
// dentro: o Vite ESVAZIA o `outDir` antes de escrever, e apontar para `tests/.ssr` apagaria o
// pacote do `monta.smoke.mjs`, que é de outro dono.
const SAIDA_SSR = path.join(AQUI, '.ssr', 'empresas');

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

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O DUBLÊ DA API — conta chamadas e devolve o que eu mandar. Instalado ANTES de importar o módulo
// de rede, porque `fetch` é lido na hora da chamada (não na importação), mas prefiro não depender
// disso: instalar antes vale para os dois casos.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const rede = { chamadas: [], proxima: null };
globalThis.fetch = async (url, opcoes = {}) => {
  rede.chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null, opcoes });
  const r = rede.proxima || { status: 200, corpo: { success: true, data: {} } };
  return {
    status: r.status,
    ok: r.status >= 200 && r.status < 300,
    text: async () => JSON.stringify(r.corpo),
  };
};
function zerarRede() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-empresas.js');

console.log('\nTELA DE EMPRESAS — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE E AS REGRAS DO CADASTRO');

// ── 3. Recusa ANTES de chamar a API ─────────────────────────────────────────────────────────────
const CADASTRO_BOM = {
  nome: 'Clínica Bem Estar', slug: 'clinica-bem-estar',
  contatoNome: 'Maria Souza', contatoEmail: 'maria@bemestar.com.br', plano: 'essencial',
};

// ⚠️ MAIÚSCULA NÃO ENTRA NESTA LISTA, e a primeira versão deste teste errou nisso. O servidor faz
// `exigirTexto(...).toLowerCase()` ANTES de testar a expressão — logo «Clinica-Bem» é ACEITO e
// normalizado, não recusado. A validação daqui copia esse comportamento; quem estava errado era a
// minha expectativa. A prova de que a normalização acontece está na medição do corpo, mais abaixo.
for (const [rotulo, slugRuim] of [
  ['espaço', 'clinica bem'],
  ['acento', 'clínica-bem'],
  ['curto demais (2)', 'ab'],
  ['começa com hífen', '-clinica'],
  ['termina com hífen', 'clinica-'],
  ['41 caracteres', 'a'.repeat(41)],
  ['vazio', ''],
]) {
  await medirAsync(`identificador recusado ANTES da rede — ${rotulo}: "${slugRuim}"`, async () => {
    zerarRede();
    await assert.rejects(
      () => api.criarEmpresa({ ...CADASTRO_BOM, slug: slugRuim }),
      (e) => e.name === 'ErroDeValidacao' && !!e.erros.slug,
    );
    assert.equal(rede.chamadas.length, 0, `vazou ${rede.chamadas.length} chamada(s) para a rede`);
  });
}

await medirAsync('e-mail inválido também é recusado antes da rede', async () => {
  zerarRede();
  await assert.rejects(() => api.criarEmpresa({ ...CADASTRO_BOM, contatoEmail: 'maria@semponto' }));
  assert.equal(rede.chamadas.length, 0);
});

await medirAsync('cadastro válido CHEGA na rota certa, com o corpo normalizado', async () => {
  zerarRede();
  rede.proxima = { status: 200, corpo: { success: true, data: { needs2fa: true, channels: { email: true }, emailHint: 'm***@bemestar.com.br' } } };
  const r = await api.criarEmpresa({
    ...CADASTRO_BOM, slug: 'CLINICA-Bem-Estar', contatoEmail: 'Maria@BemEstar.com.br',
    cnpj: '12.345.678/0001-90', contatoWhatsapp: '(98) 98335-1000',
  });
  assert.equal(rede.chamadas.length, 1);
  const c = rede.chamadas[0];
  assert.equal(c.url, '/api/ragnabot/tenants');
  assert.equal(c.metodo, 'POST');
  assert.equal(c.corpo.slug, 'clinica-bem-estar', 'o identificador tem de ir em minúsculas');
  assert.equal(c.corpo.contatoEmail, 'maria@bemestar.com.br');
  assert.equal(c.corpo.cnpj, '12345678000190', 'CNPJ vai só com dígitos');
  assert.equal(c.corpo.contatoWhatsapp, '98983351000');
  assert.equal(c.opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não viaja');
  // O 200 com `needs2fa` NÃO é sucesso — é o primeiro passo do aperto de mão.
  assert.equal(r.precisaDe2fa, true);
  assert.equal(r.dicaDeEmail, 'm***@bemestar.com.br');
});

await medirAsync('nenhum pedido carrega credencial nem papel de ator', async () => {
  zerarRede();
  rede.proxima = { status: 200, corpo: { success: true, data: {} } };
  await api.lerEmpresas();
  const cab = rede.chamadas[0].opcoes.headers || {};
  const nomes = Object.keys(cab).map((k) => k.toLowerCase());
  assert.ok(!nomes.some((n) => n.includes('token') || n.includes('ator') || n.includes('authorization')),
    `cabeçalho suspeito: ${nomes.join(', ')}`);
});

// ── 4. Excluir exige a confirmação digitada ─────────────────────────────────────────────────────
console.log('\n2) EXCLUSÃO E ENCERRAMENTO — a confirmação digitada');

await medirAsync('excluir com identificador ERRADO não chega na rede', async () => {
  zerarRede();
  await assert.rejects(
    () => api.excluirDefinitivamente('id-1', { slugDaEmpresa: 'clinica-bem-estar', confirmacaoSlug: 'clinica-bem' }),
    (e) => e.name === 'ErroDeValidacao',
  );
  assert.equal(rede.chamadas.length, 0, 'a exclusão não pode nem tentar sem a confirmação certa');
});

await medirAsync('excluir sem digitar nada não chega na rede', async () => {
  zerarRede();
  await assert.rejects(() => api.excluirDefinitivamente('id-1', { slugDaEmpresa: 'clinica-bem-estar' }));
  assert.equal(rede.chamadas.length, 0);
});

await medirAsync('excluir com o identificador EXATO vai, e leva `confirmacaoSlug` no corpo', async () => {
  zerarRede();
  rede.proxima = { status: 200, corpo: { success: true, data: { needs2fa: true, channels: { totp: true } } } };
  await api.excluirDefinitivamente(
    'id-1',
    { slugDaEmpresa: 'clinica-bem-estar', confirmacaoSlug: 'clinica-bem-estar' },
    { otpCode: '123456', otpChannel: 'totp', justificativa: 'encerramento pedido pelo cliente' },
  );
  assert.equal(rede.chamadas.length, 1);
  const c = rede.chamadas[0];
  assert.equal(c.url, '/api/ragnabot/tenants/id-1/purge');
  assert.equal(c.corpo.confirmacaoSlug, 'clinica-bem-estar');
  assert.equal(c.corpo.otpCode, '123456');
  assert.equal(c.corpo.justificativa, 'encerramento pedido pelo cliente');
});

await medirAsync('encerrar contrato também exige a confirmação digitada (regra desta tela)', async () => {
  zerarRede();
  await assert.rejects(() => api.encerrarEmpresa('id-1', { slugDaEmpresa: 'x-cliente', confirmacaoSlug: 'outro' }));
  assert.equal(rede.chamadas.length, 0);
});

medir('a comparação da confirmação é exata (não aceita parecido)', () => {
  assert.equal(api.confirmacaoConfere('clinica-bem-estar', 'clinica-bem-estar'), true);
  assert.equal(api.confirmacaoConfere('clinica-bem-estar', 'Clinica-Bem-Estar'), false);
  assert.equal(api.confirmacaoConfere('clinica-bem-estar', 'clinica-bem-estar '), true, 'espaço no fim é digitação, não outro nome');
  assert.equal(api.confirmacaoConfere('clinica-bem-estar', ''), false);
  assert.equal(api.confirmacaoConfere('', ''), false);
});

medir('o identificador sugerido a partir do nome sai válido', () => {
  assert.equal(api.sugerirSlug('Ragnatela IoT Solutions'), 'ragnatela-iot-solutions');
  assert.equal(api.sugerirSlug('Clínica São José & Cia.'), 'clinica-sao-jose-cia');
  assert.ok(api.RE_SLUG.test(api.sugerirSlug('Clínica São José & Cia.')));
});

medir('a mensagem de erro do servidor é traduzida em causa, quando é uma das três conhecidas', () => {
  assert.match(api.diagnosticar({ message: "Cannot find module '/app/src/services/device.service.js'" }), /device\.service\.js/);
  assert.match(api.diagnosticar({ message: "Cannot read properties of undefined (reading 'findUnique')" }), /prisma\.user|tabela de usuários/);
  assert.equal(api.diagnosticar({ message: 'Já existe empresa com o identificador "x".' }), null,
    'erro de negócio NÃO pode ganhar um diagnóstico inventado');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A TELA — empacotada com o Vite em modo SSR e renderizada
// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'Empresas.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/Empresas.jsx', '--outDir', 'tests/.ssr/empresas', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { default: Empresas, ListaDeEmpresas, CartaoDeEmpresa, SITUACOES } = tela;

const EMPRESAS = [
  {
    id: 'e1', nome: 'Clínica Bem Estar', slug: 'clinica-bem-estar', status: 'active',
    plano: 'profissional', planoRotulo: 'Profissional', cwAccountId: 7,
    cnpj: '12345678000190', contato: { nome: 'Maria Souza', email: 'maria@bemestar.com.br' },
    criadoEm: '2026-08-28T12:00:00.000Z',
  },
  {
    id: 'e2', nome: 'Transportes Aurora', slug: 'transportes-aurora', status: 'suspended',
    plano: 'essencial', planoRotulo: 'Essencial', cwAccountId: 8,
    contato: { nome: 'João Lima', email: 'joao@aurora.com.br' },
    criadoEm: '2026-08-29T12:00:00.000Z',
  },
];

// ── 1. A lista mostra o que veio ────────────────────────────────────────────────────────────────
/** O React marca a fronteira entre dois nós de texto com `<!-- -->`; sem tirar isso, procurar
 *  «conta na plataforma: 7» no HTML falha por um comentário no meio da frase. */
const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

const htmlLista = semMarcas(renderToString(React.createElement(ListaDeEmpresas, {
  empresas: EMPRESAS, busca: '', ehSuperusuario: true, aoCriar: () => {}, aoAgir: () => {},
})));

medir('a lista mostra o nome e o identificador de cada empresa que veio', () => {
  assert.match(htmlLista, /Clínica Bem Estar/);
  assert.match(htmlLista, /clinica-bem-estar/);
  assert.match(htmlLista, /Transportes Aurora/);
  assert.match(htmlLista, /transportes-aurora/);
});

medir('mostra plano, situação, conta na plataforma e data de criação', () => {
  assert.match(htmlLista, /Profissional/);
  assert.match(htmlLista, /Ativa/);
  assert.match(htmlLista, /Suspensa/);
  assert.match(htmlLista, /conta na plataforma: 7/);
  assert.match(htmlLista, /criada em 28\/08\/2026/);
});

medir('mostra o contato e o CNPJ formatado', () => {
  assert.match(htmlLista, /maria@bemestar\.com\.br/);
  assert.match(htmlLista, /12\.345\.678\/0001-90/);
});

medir('a empresa suspensa oferece «Reativar» e NÃO oferece «Suspender»', () => {
  const soAurora = semMarcas(renderToString(React.createElement(CartaoDeEmpresa, {
    empresa: EMPRESAS[1], ehSuperusuario: false, aoAgir: () => {},
  })));
  assert.match(soAurora, /Reativar/);
  assert.doesNotMatch(soAurora, />Suspender</);
});

medir('«Excluir definitivamente» só aparece em empresa ENCERRADA e para o super usuário', () => {
  const ativa = semMarcas(renderToString(React.createElement(CartaoDeEmpresa, { empresa: EMPRESAS[0], ehSuperusuario: true, aoAgir: () => {} })));
  assert.doesNotMatch(ativa, /Excluir definitivamente/, 'empresa ativa não pode oferecer exclusão');

  const encerrada = { ...EMPRESAS[0], status: 'closed' };
  const comoSuper = semMarcas(renderToString(React.createElement(CartaoDeEmpresa, { empresa: encerrada, ehSuperusuario: true, aoAgir: () => {} })));
  assert.match(comoSuper, /Excluir definitivamente/);

  const comoAdmin = semMarcas(renderToString(React.createElement(CartaoDeEmpresa, { empresa: encerrada, ehSuperusuario: false, aoAgir: () => {} })));
  assert.doesNotMatch(comoAdmin, /Excluir definitivamente/, 'admin comum não pode nem ver o botão');
});

// ── 2. A lista vazia diz que está vazia ─────────────────────────────────────────────────────────
medir('lista vazia DIZ que está vazia e oferece o botão de cadastrar', () => {
  const html = semMarcas(renderToString(React.createElement(ListaDeEmpresas, {
    empresas: [], busca: '', ehSuperusuario: true, aoCriar: () => {}, aoAgir: () => {},
  })));
  assert.match(html, /Nenhuma empresa cadastrada ainda/);
  assert.match(html, /não é falha de carregamento/, 'o vazio tem de dizer que é vazio de verdade');
  assert.match(html, /Cadastrar a primeira empresa/);
});

medir('busca sem resultado diz OUTRA coisa, e não oferece cadastrar', () => {
  const html = semMarcas(renderToString(React.createElement(ListaDeEmpresas, {
    empresas: [], busca: 'aurora', ehSuperusuario: true, aoCriar: () => {}, aoAgir: () => {},
  })));
  assert.match(html, /Nenhuma empresa casa com/);
  assert.match(html, /aurora/);
  assert.doesNotMatch(html, /Cadastrar a primeira empresa/);
});

// ── A página inteira monta ──────────────────────────────────────────────────────────────────────
medir('a página monta sozinha, com capa e o botão de nova empresa', () => {
  const html = semMarcas(renderToString(React.createElement(Empresas, { ehSuperusuario: true })));
  assert.ok(html.length > 1500, `veio curto demais (${html.length} caracteres)`);
  assert.match(html, /class="capa"/);
  assert.match(html, /Empresas/);
  assert.match(html, /Nova empresa/);
  assert.match(html, /class="btn btn-primary"/);
});

medir('as cinco situações do schema têm rótulo em português', () => {
  for (const chave of ['trial', 'active', 'past_due', 'suspended', 'closed']) {
    assert.ok(SITUACOES[chave]?.rotulo, `faltou rótulo para "${chave}"`);
  }
});

medir('nada do NOC ficou pendurado no HTML', () => {
  const html = semMarcas(renderToString(React.createElement(Empresas, { ehSuperusuario: true })));
  assert.doesNotMatch(html, /noc_user/);
  assert.doesNotMatch(html, /localStorage/);
});

console.log(
  falhas === 0
    ? `\nRESULTADO: ${medicoes} de ${medicoes} medições passaram.\n`
    : `\nRESULTADO: ${falhas} FALHA(S) em ${medicoes} medições.\n`,
);
process.exit(falhas === 0 ? 0 : 1);
