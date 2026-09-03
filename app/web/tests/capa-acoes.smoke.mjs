// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DE QUE A AÇÃO PRINCIPAL DE UMA TELA NUNCA SOME (03/09/2026)
//
// ── O ACHADO QUE FEZ ESTE TESTE NASCER ──────────────────────────────────────────────────────────
// O dono abriu «Fluxos de conversa» e disse: «ainda não existe o botão de criar o fluxo». O botão
// existia no código, a rota `/api/ragnabot-fluxo/saude` respondia `administrarFluxos: true`, e a
// criação funcionava de ponta a ponta pela API publicada. O que o apagava era UMA LINHA de CSS:
//
//     @media (max-width: 900px) { .capa__acoes { display: none; } }
//
// `CapaSecao` é a barra de título de TODA tela do painel, e `acoes` é onde mora a ação principal de
// cada uma — «Novo fluxo», «Nova conexão», «Nova empresa», «Novo agendamento», «Nova resposta
// rápida», «Nova caixa». Em qualquer janela abaixo de 900 px (celular, tablet, navegador não
// maximizado) essa linha apagava a ÚNICA porta de entrada de OITO telas, sem uma palavra.
//
// ── O QUE ESTE TESTE MEDE, E POR QUE NO ARTEFATO ────────────────────────────────────────────────
// Ele lê o CSS **construído** (`dist/assets/*.css`), não o arquivo-fonte. É de propósito: o que
// chega ao navegador é o artefato, e uma regra pode ser reintroduzida por outra folha, por um
// `@media` novo ou por uma minificação que junte seletores. Medir a fonte responderia «o texto que
// eu escrevi continua lá»; medir o artefato responde «o botão continua na tela».
//
// ⚠️ Este teste NÃO garante que o botão cabe bonito — isso é olho humano. Ele garante que ninguém
// mandou ESCONDÊ-LO, que é o defeito que aconteceu de verdade e custou um dia.
//
// Rodar (a partir de `app/web/`):   node tests/capa-acoes.smoke.mjs
// Precisa de um `dist/` construído (`npm run build`).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const DIST = path.join(RAIZ, 'dist', 'assets');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

console.log('\nA AÇÃO PRINCIPAL DA CAPA NUNCA SOME\n');

assert.ok(fs.existsSync(DIST), `não achei ${DIST} — rode «npm run build» antes`);
const css = fs.readdirSync(DIST).filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
assert.ok(css.length, 'nenhum .css no pacote construído');

// O minificador remove espaços; a busca tem de aguentar `display:none` e `display: none`.
const semEspaco = css.replace(/\s+/gu, '');

medir('o CSS construído NÃO manda esconder as ações da capa', () => {
  // Qualquer bloco que contenha o seletor `.capa__acoes` e, dentro DELE, `display:none`.
  const blocos = [...semEspaco.matchAll(/\.capa__acoes[^{}]*\{([^}]*)\}/gu)];
  assert.ok(blocos.length, 'o seletor .capa__acoes sumiu do pacote — a capa perdeu as ações');
  for (const b of blocos) {
    assert.ok(!/display:none/u.test(b[1]),
      'alguém voltou a esconder .capa__acoes — foi exatamente assim que o botão «Novo fluxo» sumiu');
  }
});

medir('abaixo de 900 px a capa CRESCE em vez de cortar (altura automática)', () => {
  // A cura do defeito: sem altura fixa, não existe largura de tela que corte um botão.
  const media = semEspaco.match(/@media\(max-width:900px\)\{(.*?)\}\}/su);
  assert.ok(media, 'não achei o bloco @media (max-width:900px) no pacote');
  assert.ok(/\.capa\{[^}]*height:auto/u.test(semEspaco),
    'a capa voltou a ter altura fixa abaixo de 900 px — o botão volta a ser cortado');
});

medir('as duas faixas menores usam min-height, não height (senão vencem a regra acima)', () => {
  // `@media 768` e `@media 480` vêm DEPOIS na folha; se cravarem `height`, a altura automática
  // perde por ordem de cascata e o corte volta — sem nenhum erro em lugar nenhum.
  for (const largura of ['768px', '480px']) {
    const b = semEspaco.match(new RegExp(`@media\\(max-width:${largura}\\)\\{\\.capa\\{([^}]*)\\}`, 'u'));
    if (!b) continue;
    assert.ok(!/(^|;)height:/u.test(b[1]),
      `@media ${largura} voltou a cravar height na capa — isso reintroduz o corte`);
  }
});

// ── A segunda metade do defeito: quando NÃO dá para criar, a tela tem de DIZER ──────────────────
const pagina = fs.readFileSync(path.join(RAIZ, 'src', 'paginas', 'FluxosRagnabot.jsx'), 'utf8');

medir('quando criar está bloqueado, a tela explica o motivo em vez de só apagar o botão', () => {
  assert.ok(/motivoSemCriar/u.test(pagina), 'sumiu o cálculo do motivo de não dar para criar');
  assert.ok(/criarBloqueado/u.test(pagina), 'sumiu a condição única de bloqueio do botão');
});

medir('sessão sem empresa manda SAIR E ENTRAR — nunca «sem permissão»', () => {
  assert.ok(/SAIR E\s*\n?\s*ENTRAR|Saia e entre de novo/u.test(pagina),
    'a tela deixou de mandar sair e entrar; quem lê «sem permissão» vai pedir acesso à toa');
});

medir('o estado vazio oferece o botão que o próprio texto manda apertar', () => {
  assert.ok(/Criar o primeiro fluxo/u.test(pagina),
    'o estado vazio voltou a dizer «crie o primeiro» sem oferecer nada para clicar');
});

console.log(`\nRESULTADO: ${medicoes - falhas} de ${medicoes} medições passaram.\n`);
process.exit(falhas ? 1 : 0);
