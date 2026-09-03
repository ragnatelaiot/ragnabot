// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DO CATÁLOGO DE TELAS E DA CASCA (contrato S1, 02/09/2026)
//
// Duas coisas são medidas aqui, e as duas são critério de aceite do contrato:
//   1. «o menu mostra apenas o que o papel do usuário pode ver» — medido no catálogo, que é
//      JavaScript puro e o Node importa direto;
//   2. o MENU DESENHADO obedece ao catálogo — medido renderizando a casca de verdade, com o
//      roteador em memória, para os dois papéis.
//
// A segunda medição existe porque a primeira sozinha não bastaria: um catálogo certo com um
// componente que ignora `itensVisiveis` passaria no teste e falharia na tela. É o mesmo raciocínio
// de `empresas.smoke.mjs` — regra de módulo E renderização, não uma só.
//
// ⚠️ O QUE ISTO NÃO PROVA, e não vou fingir que prova: `useEffect` não roda em renderização de
// servidor, então o título da aba, o fechamento do menu ao trocar de tela e o clique nos links
// ficam de fora. Isso só se mede com navegador. E, principalmente: ISTO NÃO É TESTE DE
// ISOLAMENTO. Esconder item de menu não tranca nada — quem tranca é o servidor, e aquele teste é
// outro (`app/tests/ragnabot-isolamento.test.mjs`).
//
// Rodar (a partir de `app/web/`):   node tests/navegacao.smoke.mjs
// Ele mesmo constrói o pacote SSR se faltar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'navegacao');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

console.log('\nROTEADOR E MENU DA INTERFACE DO RAGNABOT\n');
console.log('1) O CATÁLOGO (JavaScript puro)');

const nav = await import('../src/lib/navegacao.js');

medir('há pelo menos 3 rotas navegáveis (critério de aceite do contrato)', () => {
  assert.ok(nav.MENU.length >= 3, `só ${nav.MENU.length} tela(s) no catálogo`);
  const caminhos = nav.MENU.map((i) => i.caminho);
  assert.deepEqual([...new Set(caminhos)], caminhos, 'há caminho repetido no catálogo');
  for (const c of caminhos) assert.match(c, /^\/[a-z0-9-]+$/, `caminho fora do padrão: ${c}`);
});

medir('toda tela do catálogo tem rótulo em português e um apoio que explica', () => {
  for (const i of nav.MENU) {
    assert.ok(i.rotulo && i.rotulo.trim(), `${i.id} sem rótulo`);
    assert.ok(i.apoio && i.apoio.length > 12, `${i.id} sem apoio que explique`);
    assert.doesNotMatch(i.rotulo, /^[A-Z_]+$/, `${i.id}: rótulo parece chave de código, não texto`);
  }
});

// ⭐ REESCRITA EM 02/09/2026 (contrato S7). Esta medição dizia «o administrador VÊ Empresas», e
// estava certa enquanto a única distinção era papel. A ordem do dono acrescentou uma segunda:
// Empresas é do OPERADOR DO SaaS — um administrador de empresa CLIENTE também é `admin`, e via um
// item que a API já lhe recusava. Menu que promete o que o servidor nega é pior que menu sem item.
medir('Empresas é do OPERADOR do SaaS: nem o atendente nem o admin de empresa cliente a veem', () => {
  const doAtendente = nav.itensVisiveis('user').map((i) => i.id);
  const doAdminCliente = nav.itensVisiveis('admin').map((i) => i.id);
  const doAdminOperador = nav.itensVisiveis('admin', { operadorDoSaas: true }).map((i) => i.id);
  assert.ok(!doAtendente.includes('empresas'), 'o atendente está vendo Empresas');
  assert.ok(!doAdminCliente.includes('empresas'), 'o admin de empresa CLIENTE está vendo Empresas');
  assert.ok(doAdminOperador.includes('empresas'), 'o operador do SaaS NÃO está vendo Empresas');
  // ⚠️ E a regra do topo de `lib/navegacao.js`, repetida porque é onde ela mais tenta: isto é
  // DESENHO. A recusa de verdade está em `app/tests/ragnabot-configuracao-visibilidade.test.mjs`,
  // que sobe o servidor e mede 403 pela API.
});

medir('Configurações é de TODO MUNDO — o atendente lê o que muda a tela dele', () => {
  // ⭐ Contrato S7. O que ele NÃO pode é escrever, e quem recusa isso é o servidor (403 EXIGE_ADMIN).
  for (const papel of ['user', 'admin']) {
    assert.ok(nav.itensVisiveis(papel).map((i) => i.id).includes('configuracoes'),
      `${papel} não vê Configurações`);
  }
  const item = nav.itemPorCaminho('/configuracoes');
  assert.ok(item, '/configuracoes não está no catálogo');
  assert.equal(item.id, 'configuracoes');
});

medir('o que é de todo mundo aparece para os dois papéis', () => {
  for (const papel of ['user', 'admin']) {
    const ids = nav.itensVisiveis(papel).map((i) => i.id);
    assert.ok(ids.includes('fluxos'), `${papel} não vê Fluxos`);
    assert.ok(ids.includes('respostas-rapidas'), `${papel} não vê Respostas rápidas`);
  }
});

medir('papel desconhecido cai para o MENOS poderoso (falha fechada)', () => {
  // ⚠️ É a regra que importa: `papel: undefined` acontece de verdade (sessão ainda carregando).
  // Cair para admin abriria a tela comercial para quem quer que seja, por meio segundo.
  for (const ruim of [undefined, null, '', 'super', 'administrator', 'root', 0, {}]) {
    const ids = nav.itensVisiveis(ruim).map((i) => i.id);
    assert.ok(!ids.includes('empresas'), `papel ${JSON.stringify(ruim)} abriu Empresas`);
    // ⭐ S7: e o mesmo vale para o fato do operador — valor estranho não abre o menu do SaaS.
    for (const talvez of [undefined, null, '', 'sim', 1, 'true', {}]) {
      const comContexto = nav.itensVisiveis('admin', { operadorDoSaas: talvez }).map((i) => i.id);
      assert.ok(!comContexto.includes('empresas'),
        `operadorDoSaas=${JSON.stringify(talvez)} abriu o menu do SaaS`);
    }
  }
});

medir('barra no fim é a MESMA tela (colar URL com / não pode dar «não encontrei»)', () => {
  assert.equal(nav.normalizarCaminho('/fluxos/'), '/fluxos');
  assert.equal(nav.normalizarCaminho('//fluxos'), '/fluxos');
  assert.equal(nav.normalizarCaminho('/fluxos?x=1'), '/fluxos');
  assert.equal(nav.normalizarCaminho('/fluxos#no-3'), '/fluxos');
  assert.equal(nav.normalizarCaminho(''), '/');
  assert.ok(nav.itemPorCaminho('/fluxos/'));
});

medir('o item continua ACESO dentro da tela (subcaminho não apaga o menu)', () => {
  const fluxos = nav.MENU.find((i) => i.id === 'fluxos');
  assert.equal(nav.ehItemAtivo(fluxos, '/fluxos'), true);
  assert.equal(nav.ehItemAtivo(fluxos, '/fluxos/abc-123'), true);
  assert.equal(nav.ehItemAtivo(fluxos, '/fluxosaurus'), false, 'prefixo solto não pode acender o item');
  assert.equal(nav.ehItemAtivo(fluxos, '/empresas'), false);
});

medir('a raiz e a URL antiga do NOC têm destino declarado', () => {
  assert.equal(nav.destinoDeCaminhoAntigo('/'), nav.CAMINHO_PADRAO);
  assert.equal(nav.destinoDeCaminhoAntigo('/ragnabot-fluxos/abc-123'), '/fluxos');
  assert.equal(nav.destinoDeCaminhoAntigo('/respostas-rapidas'), null, 'rota viva não é caminho antigo');
});

medir('o destino padrão é uma tela que existe no catálogo', () => {
  assert.ok(nav.itemPorCaminho(nav.CAMINHO_PADRAO), `${nav.CAMINHO_PADRAO} não está no catálogo`);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A CASCA RENDERIZADA
// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A CASCA DESENHADA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, '_monta-casca.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a casca com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'tests/_monta-casca.jsx', '--outDir', 'tests/.ssr/navegacao', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const { renderizarCasca } = await import(PACOTE);
const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

const comoAdmin = semMarcas(renderizarCasca({ papel: 'admin', caminho: '/fluxos' }));
const comoAtendente = semMarcas(renderizarCasca({ papel: 'user', caminho: '/fluxos' }));

medir('o menu desenhado do ATENDENTE não traz Empresas', () => {
  assert.match(comoAtendente, /data-item="fluxos"/);
  assert.match(comoAtendente, /data-item="respostas-rapidas"/);
  assert.doesNotMatch(comoAtendente, /data-item="empresas"/, 'o item comercial vazou para o atendente');
  assert.doesNotMatch(comoAtendente, />Empresas</);
});

medir('o menu desenhado do ADMINISTRADOR de empresa cliente NÃO traz Empresas', () => {
  for (const id of ['fluxos', 'respostas-rapidas', 'configuracoes']) {
    assert.match(comoAdmin, new RegExp(`data-item="${id}"`), `faltou ${id}`);
  }
  // ⭐ S7: o administrador de empresa CLIENTE é `admin`, e o item comercial não é dele.
  assert.doesNotMatch(comoAdmin, /data-item="empresas"/, 'o item comercial vazou para o cliente');
});

medir('o menu desenhado do OPERADOR do SaaS traz Empresas', () => {
  const comoOperador = semMarcas(renderizarCasca({ papel: 'admin', caminho: '/fluxos', operadorDoSaas: true }));
  assert.match(comoOperador, /data-item="empresas"/, 'o operador do SaaS perdeu o item comercial');
  assert.match(comoOperador, /data-item="configuracoes"/);
});

medir('Caixas de entrada é do ADMINISTRADOR — o atendente não a vê desenhada', () => {
  // ⭐ Contrato S-CAIXAS. ⚠️ E vale a regra escrita no topo de `lib/navegacao.js`: esconder item de
  // menu NÃO é isolamento. Quem tranca é o servidor (o router de empresas já é fechado a
  // administrador do grupo RAGNATELA); isto aqui só evita o tropeço.
  assert.doesNotMatch(comoAtendente, /data-item="caixas"/);
  assert.match(comoAdmin, /data-item="caixas"/);
  assert.match(comoAdmin, /Caixas de entrada/);
});

medir('os itens são LINKS de verdade (abrem em nova aba, copiam endereço)', () => {
  // Botão com `navigate()` não faz nada disso — e a dor que este contrato conserta é «não consigo
  // chegar lá». Link que não se pode copiar continua sendo caminho que ninguém acha.
  assert.match(comoAdmin, /<a[^>]+href="\/fluxos"/);
  assert.match(comoAdmin, /<a[^>]+href="\/respostas-rapidas"/);
});

medir('a tela em que estou vem marcada como ativa', () => {
  const emRespostas = semMarcas(renderizarCasca({ papel: 'user', caminho: '/respostas-rapidas' }));
  assert.match(emRespostas, /class="casca__item casca__item--ativo"[^>]*data-item="respostas-rapidas"|data-item="respostas-rapidas"[^>]*class="casca__item casca__item--ativo"/);
});

medir('o cabeçalho diz quem entrou, em que papel, e oferece a saída', () => {
  assert.match(comoAdmin, /administrador/);
  assert.match(comoAtendente, /atendente/);
  assert.match(comoAdmin, /Sair/);
});

medir('o rodapé traz a versão do motor — e DIZ quando não sabe, em vez de inventar', () => {
  assert.match(semMarcas(renderizarCasca({ papel: 'user', caminho: '/fluxos', versao: '1.05.00' })), /versão 1\.05\.00/);
  assert.match(comoAtendente, /versão não informada pelo motor/);
});

medir('o rodapé assina o produto (doc 34 §F5.2)', () => {
  assert.match(comoAdmin, /Ragnatela IoT Solutions/);
  assert.match(comoAdmin, /RAGNABOT/);
});

medir('o menu DIZ o que ainda não tem tela, em vez de fingir que não existe', () => {
  // ⭐ 02/09/2026, contrato S2: «Atendimentos» saiu desta frase porque a tela passou a existir.
  // ⭐ 02/09/2026, contrato S6: «Conexões» também ganhou tela (a de OPERAÇÃO). A frase tem de dizer
  // exatamente a metade que falta — dizer «não existe» com a tela no ar manda o operador procurar
  // no lugar errado, e dizer «existe tudo» o faz abrir chamado quando não achar o botão de criar.
  assert.match(comoAtendente, /Configurações ainda não tem tela/);
  assert.match(comoAtendente, /Conexões entrou pela metade/);
  assert.match(comoAtendente, /criar e remover conexão/);
});

medir('a casca não trouxe nada do NOC pendurado', () => {
  assert.doesNotMatch(comoAdmin, /noc_user/);
  assert.doesNotMatch(comoAdmin, /noc:auth-expired/);
  assert.doesNotMatch(comoAdmin, /__RAGNABOT__/);
});

console.log(falhas === 0
  ? `\nRESULTADO: ${medicoes} de ${medicoes} medições passaram.\n`
  : `\nRESULTADO: ${falhas} FALHA(S) em ${medicoes} medições.\n`);
process.exit(falhas === 0 ? 0 : 1);
