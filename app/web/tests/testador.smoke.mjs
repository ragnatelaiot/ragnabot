// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DO TESTADOR DE FLUXO (contrato S3.1, 02/09/2026 · doc 34 §F3.1)
//
// ⚠️ O QUE ESTE ARQUIVO **NÃO** MEDE, e é melhor dizer antes: a SIMULAÇÃO. Quem percorre o fluxo é
// o motor de produção, na rota `POST /fluxos/:id/testar`, e ele tem teste próprio de ponta a ponta
// em `app/tests/ragnabot-testador-fluxo.test.mjs` (quatro conversas: botões, condição,
// transferência e fim). Aqui se mede a TELA e a camada de rede dela — que é tudo o que este
// contrato acrescentou do lado do navegador.
//
// Como cada coisa é medida:
// · `lib/api-testador.js` é JavaScript puro: o Node importa direto e o `fetch` vira um DUBLÊ que
//   registra rota, método e corpo. É assim que «o toque no botão vira `interativo.id`» deixa de ser
//   opinião.
// · Os componentes são JSX: empacotados com o Vite em modo SSR e renderizados com `renderToString`,
//   o mesmo caminho de `respostas-rapidas.smoke.mjs` e `empresas.smoke.mjs`.
//
// ⛔ O QUE NÃO DÁ PARA PROVAR AQUI: `useEffect` não roda em SSR, então a busca da lista de fluxos, o
// clique real e o avanço passo a passo ficam de fora — isso só com navegador contra o motor no ar.
//
// Rodar (a partir de `app/web/`):   node tests/testador.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'testador');

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
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.corpo) };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-testador.js');

console.log('\nTESTADOR DE FLUXO — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE');

await medirAsync('o primeiro passo vai na rota do teste, por POST, sem estado', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { saidas: [], estado: {} } };
  await api.passoDoTeste('f1', { vars: { nome: 'Ana' } });
  const c = rede.chamadas[0];
  assert.equal(c.metodo, 'POST');
  assert.equal(c.url, '/api/ragnabot-fluxo/fluxos/f1/testar');
  assert.deepEqual(c.corpo, { vars: { nome: 'Ana' } });
  assert.equal(c.opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não viaja');
});

await medirAsync('o passo seguinte reenvia o estado do servidor SEM alterar', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { saidas: [] } };
  const estado = { noAtualId: 'menu', vars: { a: '1' }, visitaSeq: 1, parado: true };
  await api.passoDoTeste('f1', { estado, resposta: 'oi' });
  assert.deepEqual(rede.chamadas[0].corpo.estado, estado,
    'a sessão de teste é do servidor; a tela devolve o que recebeu');
  assert.equal(rede.chamadas[0].corpo.resposta, 'oi');
});

await medirAsync('testar a versão publicada manda `origem: versao`', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: {} };
  await api.passoDoTeste('f1', { origem: 'versao' });
  assert.equal(rede.chamadas[0].corpo.origem, 'versao');
});

await medirAsync('o id do fluxo vai escapado na URL', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: {} };
  await api.passoDoTeste('id com espaço', {});
  assert.equal(rede.chamadas[0].url, '/api/ragnabot-fluxo/fluxos/id%20com%20espa%C3%A7o/testar');
});

await medirAsync('a lista de fluxos é GET com busca e limite na consulta, não no corpo', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarFluxos({ busca: 'menu' });
  assert.equal(rede.chamadas[0].metodo, 'GET');
  assert.match(rede.chamadas[0].url, /busca=menu/);
});

medir('tocar numa opção vira `interativo.id`; digitar vira texto — como na conversa real', () => {
  // ⚠️ Não é firula: a escada de casamento do motor tem degraus diferentes para os dois. Simular o
  // toque como texto esconderia justamente o degrau que mais quebra na vida real.
  assert.deepEqual(api.respostaDeOpcao('fin'), { interativo: { id: 'fin' }, texto: '' });
  assert.equal(api.respostaDigitada(' 2 '), ' 2 ');
});

console.log('\n2) O VOCABULÁRIO (traduzir a intenção crua para o que a pessoa vê)');

medir('mensagem, botões e lista são coisas que o CLIENTE vê', () => {
  for (const t of ['texto', 'midia', 'lista', 'botoes', 'template', 'cobranca_pix']) {
    assert.equal(api.ehParaOCliente({ tipo: t }), true, t);
  }
});

medir('etiqueta, carimbo, resolução e nota interna NÃO são mensagens', () => {
  // Numa lista única, o operador contaria cinco balões numa conversa que tem dois.
  for (const t of ['etiqueta', 'carimbar', 'resolver', 'nota', 'atribuir', 'http', 'email']) {
    assert.equal(api.ehParaOCliente({ tipo: t }), false, t);
  }
});

medir('botões viram opções numeradas, com o id preservado', () => {
  const r = api.resumirIntencao({
    tipo: 'botoes', corpo: 'Escolha', cabecalho: 'Menu',
    botoes: [{ id: 'sup', rotulo: 'Suporte' }, { id: 'l', rotulo: 'Portal', tipo: 'url', url: 'https://x' }],
  });
  assert.equal(r.rotulo, 'Botões');
  assert.match(r.texto, /Menu/);
  assert.match(r.texto, /Escolha/);
  assert.deepEqual(r.opcoes.map((o) => o.id), ['sup', 'l']);
  assert.equal(r.opcoes[1].url, 'https://x');
});

medir('a cobrança Pix mostra o MARCADOR, não um código inventado', () => {
  // Mostrar um copia-e-cola falso ensinaria o operador a confiar num valor que não existe: no teste
  // nenhuma cobrança é criada. O que ele precisa conferir é se o marcador está no lugar certo.
  const r = api.resumirIntencao({ tipo: 'cobranca_pix', valorCentavos: 2490, mensagemModelo: 'Pague: {{pix_copia_e_cola}}' });
  assert.match(r.texto, /\{\{pix_copia_e_cola\}\}/);
  assert.deepEqual(r.detalhes[0], ['Valor', api.formatarCentavos(2490)]);
});

medir('valor inválido vira "—", nunca "R$ NaN"', () => {
  assert.equal(api.formatarCentavos(undefined), '—');
  assert.equal(api.formatarCentavos('abc'), '—');
  assert.match(api.formatarCentavos(2490), /24,90/);
});

medir('o fim da conversa é dito em português, com a causa e o tom certo', () => {
  assert.equal(api.rotuloDoFim({ motivo: 'concluido' }).tom, 'ok');
  const transferido = api.rotuloDoFim({ motivo: 'concluido', estado: 'transferido' });
  assert.match(transferido.frase, /entregue a um atendente humano/);
  const orfa = api.rotuloDoFim({ motivo: 'aresta_ausente' });
  assert.equal(orfa.tom, 'erro');
  assert.match(orfa.frase, /ficaria sem resposta/);
  assert.equal(api.rotuloDoFim(null), null);
});

medir('erro e aviso são separados — gritar igual nos dois ensina a ignorar os dois', () => {
  const { erros, avisos } = api.separarProblemas([
    { nivel: 'erro', mensagem: 'a' }, { nivel: 'aviso', mensagem: 'b' }, { mensagem: 'c' },
  ]);
  assert.equal(erros.length, 2, 'problema sem nível declarado conta como erro, não como aviso');
  assert.equal(avisos.length, 1);
});

medir('as variáveis saem em ordem estável (senão a lista dança a cada passo)', () => {
  assert.deepEqual(api.variaveisEmLista({ zeta: 1, alfa: 'x', meio: null }),
    [['alfa', 'x'], ['meio', ''], ['zeta', '1']]);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'TestadorDeFluxo.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/TestadorDeFluxo.jsx', '--outDir', 'tests/.ssr/testador', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { Balao, Conversa, LinhaDeBastidor, ListaDeProblemas, ListaDeVariaveis, PainelDeResposta, SeletorDeFluxo, SeloDeSimulacao } = tela;

const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');
const render = (C, props) => semMarcas(renderToString(React.createElement(C, props)));

medir('o SELO de simulação diz, em português, tudo o que o teste NÃO faz', () => {
  const html = render(SeloDeSimulacao, {});
  assert.match(html, /SIMULAÇÃO/);
  assert.match(html, /nenhuma mensagem é enviada/i);
  assert.match(html, /nada é gravado/i);
});

medir('a conversa separa o balão do cliente da ação de bastidor', () => {
  const html = render(Conversa, {
    saidas: [
      { tipo: 'texto', corpo: 'Bom dia, Ana!' },
      { tipo: 'etiqueta', aplicar: ['vip'], remover: [] },
      { tipo: 'resolver' },
    ],
  });
  assert.match(html, /Bom dia, Ana!/);
  assert.match(html, /Etiqueta na conversa/);
  assert.match(html, /Encerrar a conversa/);
  assert.match(html, /Aplica/);
});

medir('passo sem saída DIZ que é normal, em vez de mostrar vazio', () => {
  const html = render(Conversa, { saidas: [] });
  assert.match(html, /Nada sairia neste passo/);
  assert.match(html, /condição, variável/);
});

medir('o balão de menu mostra as opções numeradas, como o cliente as leria', () => {
  const html = render(Balao, {
    resumo: api.resumirIntencao({
      tipo: 'lista', corpo: 'Escolha o setor:',
      itens: [{ id: 'sup', titulo: 'Suporte' }, { id: 'fin', titulo: 'Financeiro', descricao: 'boletos' }],
    }),
  });
  assert.match(html, /1\./);
  assert.match(html, /Suporte/);
  assert.match(html, /2\./);
  assert.match(html, /boletos/);
});

medir('a mídia mostra o endereço do arquivo — é o que o operador precisa conferir', () => {
  const html = render(Balao, { resumo: api.resumirIntencao({ tipo: 'midia', url: 'https://cdn/a.png', legenda: 'planta' }) });
  assert.match(html, /planta/);
  assert.match(html, /https:\/\/cdn\/a\.png/);
});

medir('a chamada externa aparece como BASTIDOR, com método e endereço', () => {
  const html = render(LinhaDeBastidor, { resumo: api.resumirIntencao({ tipo: 'http', metodo: 'POST', url: 'https://erp/x' }) });
  assert.match(html, /Chamada a sistema externo/);
  assert.match(html, /POST/);
  assert.match(html, /https:\/\/erp\/x/);
});

medir('parado esperando resposta: as opções viram botões e ainda dá para digitar', () => {
  const html = render(PainelDeResposta, {
    parado: { motivo: 'resposta', opcoes: [{ id: 'sup', rotulo: 'Suporte' }, { id: 'fin', rotulo: 'Financeiro' }] },
    fim: null, digitado: '',
  });
  assert.match(html, /1\. Suporte/);
  assert.match(html, /2\. Financeiro/);
  assert.match(html, /ou digite/i, 'o texto livre é o degrau que mais quebra na vida real');
  assert.match(html, /mesma escada de casamento/);
});

medir('parado por RELÓGIO diz que o testador não adianta o tempo', () => {
  const html = render(PainelDeResposta, { parado: { motivo: 'temporizador', saidaAoVencer: 'expirado', opcoes: [] }, fim: null });
  assert.match(html, /esperando o relógio/i);
  assert.match(html, /expirado/);
  assert.doesNotMatch(html, /Enviar<\/button>/, 'não faz sentido responder a um relógio');
});

medir('o fim é dito com o tom certo: concluído é verde, saída órfã é erro', () => {
  const bom = render(PainelDeResposta, { parado: null, fim: { motivo: 'concluido' } });
  assert.match(bom, /chegou ao fim/);
  const ruim = render(PainelDeResposta, { parado: null, fim: { motivo: 'aresta_ausente' } });
  assert.match(ruim, /ficaria sem resposta/);
});

medir('problema traz o "como corrigir" junto — erro sem conserto é só reclamação', () => {
  const html = render(ListaDeProblemas, {
    problemas: [
      { nivel: 'erro', codigo: 'ARESTA_AUSENTE', campo: 'menu.sup', mensagem: 'Sem destino.', comoCorrigir: 'Ligue essa saída a um nó.' },
      { nivel: 'aviso', campo: 'x', mensagem: 'só um aviso' },
    ],
  });
  assert.match(html, /Problema em menu\.sup/);
  assert.match(html, /Como corrigir/);
  assert.match(html, /Ligue essa saída/);
  assert.match(html, /Aviso em x/);
});

medir('sem variáveis, a tela EXPLICA de onde elas viriam', () => {
  const html = render(ListaDeVariaveis, { vars: {} });
  assert.match(html, /Nenhuma variável ainda/);
  assert.match(html, /do que o cliente responde/);
});

medir('com variáveis, cada uma aparece com o nome e o valor; vazia é dita como vazia', () => {
  const html = render(ListaDeVariaveis, { vars: { nome: 'Ana', cpf: '' } });
  assert.match(html, /nome/);
  assert.match(html, /Ana/);
  assert.match(html, /\(vazia\)/);
});

medir('sem fluxo cadastrado, o seletor manda para a tela de Fluxos em vez de deixar em branco', () => {
  const html = render(SeletorDeFluxo, { fluxos: [], carregando: false });
  assert.match(html, /Nenhum fluxo cadastrado ainda/);
  assert.match(html, /Fluxos/);
});

medir('o seletor marca o fluxo escolhido e mostra o estado de cada um', () => {
  const fluxos = [{ id: 'a', nome: 'Menu principal', estado: 'publicado', versaoPublicadaId: 'v1' }, { id: 'b', nome: 'Rascunho novo', estado: 'rascunho' }];
  const html = render(SeletorDeFluxo, { fluxos, escolhido: fluxos[0] });
  assert.match(html, /Menu principal/);
  assert.match(html, /publicado/);
  assert.match(html, /tem versão publicada/);
  assert.match(html, /Rascunho novo/);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. A LIGAÇÃO COM O MENU (a lição do doc 34 §F1.1: tela sem caminho é tela que ninguém usa)
// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n4) O CAMINHO ATÉ A TELA');

const nav = await import('../src/lib/navegacao.js');

medir('o testador está no menu, para todo mundo que entra', () => {
  const doAdmin = nav.itensVisiveis('admin').map((i) => i.id);
  const doAgente = nav.itensVisiveis('user').map((i) => i.id);
  assert.ok(doAdmin.includes('testador'));
  assert.ok(doAgente.includes('testador'), 'quem desenha fluxo não é só administrador');
});

medir('o item continua ACESO quando a URL traz o fluxo (`/testador/f1`)', () => {
  // Sem isto, ao abrir um fluxo o menu apaga e a pessoa perde a referência de onde está.
  const item = nav.itemPorCaminho('/testador');
  assert.ok(item);
  assert.equal(nav.ehItemAtivo(item, '/testador/f1'), true);
  assert.equal(nav.ehItemAtivo(item, '/testador/'), true);
});

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
