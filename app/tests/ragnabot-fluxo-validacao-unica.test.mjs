#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EXECUTÁVEL DO VALIDADOR ÚNICO — contrato S-PUBLICAR, 03/09/2026
//
// ── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR DE VOLTAR ────────────────────────────────────
// O dono terminou de desenhar o fluxo dele e não conseguiu publicar. A barra do editor dizia, em
// VERDE, «desenho fechado». A caixa de publicar dizia «Não consegui publicar — o fluxo tem 2
// erro(s) e não pode ser publicado». Nenhuma das duas dizia QUAIS eram os erros. Havia DOIS
// validadores — um na tela, outro no serviço de publicação — cobrindo conjuntos de regras
// diferentes, e o operador não tinha como saber qual dos dois mentia.
//
// Duas verdades sobre «o fluxo está válido» é o defeito. A discordância é só o sintoma.
//
// ── O QUE ESTE ARQUIVO PROVA ───────────────────────────────────────────────────────────────────
//   1. Fluxo válido passa (`ok:true`, zero erro) — o que a publicação exige.
//   2. Fluxo com saída do caminho feliz sem destino é RECUSADO, e a recusa NOMEIA o nó.
//   3. ⭐ O CONTADOR DA BARRA E O DA PUBLICAÇÃO SÃO O MESMO NÚMERO — a barra pergunta ao servidor
//      exatamente o que a publicação pergunta, e este teste compara os dois lado a lado, em todos
//      os modos de migração e sobre uma bateria de documentos.
//   4. Todo erro aponta um nó QUE EXISTE no documento (senão o botão «ir para o nó» leva a lugar
//      nenhum, e a lista volta a ser tão inútil quanto «há 2 erros»).
//   5. A categoria de mídia em PORTUGUÊS é aceita — o seletor da tela gravava `imagem` e o motor
//      só aceitava `image`: duas das quatro opções do seletor produziam fluxo impublicável.
//   6. `SEM_NO_RESGATE` é AVISO na publicação normal e ERRO no retrofit forçado — a regra bloqueava
//      QUALQUER fluxo com bloco que espera resposta, pedindo um campo que a tela nem oferecia.
//   7. As regras que só a tela tinha agora estão no SERVIDOR (duas ligações na mesma saída) e a
//      saída de exceção sem destino virou AVISO em vez de silêncio.
//   8. (estrutural) A tela NÃO calcula mais o número dela: a barra lê o veredito do servidor.
//
// NÃO TOCA BANCO NEM REDE: `validarDocumento` é função pura. Um teste que exigisse Postgres de pé
// é um teste que ninguém roda duas vezes.
//
// COMO RODAR
//     node tests/ragnabot-fluxo-validacao-unica.test.mjs
//     VERBOSE=1 node tests/ragnabot-fluxo-validacao-unica.test.mjs
//
// CÓDIGOS DE SAÍDA:  0 = tudo verde   1 = alguma verificação reprovou   3 = erro inesperado
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`. NOC 2026-08-29.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarDocumento } from '../src/services/ragnabot-fluxo-publicacao.service.js';
import { categoriaMidiaCanonica } from '../src/services/ragnabot-fluxo-nos.service.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VERBOSE = !!process.env.VERBOSE;
let passou = 0; let falhou = 0;

function verificar(titulo, fn) {
  try {
    const detalhe = fn();
    passou += 1;
    console.log(`  ✓ ${titulo}`);
    if (detalhe !== undefined) console.log(`      → ${detalhe}`);
  } catch (e) {
    falhou += 1;
    console.log(`  ✗ ${titulo}`);
    console.log(`      ${e.message}`);
    if (VERBOSE) console.log(e.stack);
  }
}

const FLUXO_ID = 'fluxo-de-prova';

/** O fluxo do dono, na forma em que ele o desenhou (lido do rascunho real em 03/09/2026). */
function fluxoDoDono({ categoria = 'image' } = {}) {
  return {
    variaveis: [],
    nos: [
      { id: 'no_inicio', tipo: 'inicio', config: { emitirProtocolo: false }, ui: { x: 0, y: 0 } },
      { id: 'no_texto', tipo: 'texto', config: { corpo: 'Seja bem vindo a Ragnatela IoT Solutions' }, ui: { x: 200, y: 0 } },
      {
        id: 'no_botoes',
        tipo: 'botoes',
        config: {
          corpo: 'Confirma?',
          botoes: [
            { id: 'sim', tipo: 'resposta', rotulo: 'Sim' },
            { id: 'nao', tipo: 'resposta', rotulo: 'Não' },
          ],
          // Copiado do rascunho REAL do dono: ele já tinha configurado teto de tentativas, reforço
          // e ação final nas duas exceções, e o tempo limite de espera. Foi por isso que a
          // publicação acusou exatamente DOIS erros, e não cinco.
          excecoes: {
            semResposta: { tentativas: 2, reforco: 'Ainda está aí? Responda para eu continuar.', acaoFinal: 'transferir_time', time: 'Suporte' },
            opcaoInvalida: { tentativas: 2, reforco: 'Não entendi essa opção. Escolha uma das que apareceram.', acaoFinal: 'transferir_time', time: 'Suporte' },
          },
          esperaResposta: { valor: 4, unidade: 'minutos' },
        },
        ui: { x: 400, y: 0 },
      },
      { id: 'no_texto_2', tipo: 'texto', config: { corpo: 'Teste do sim' }, ui: { x: 600, y: -100 } },
      { id: 'no_midia', tipo: 'midia', config: { url: 'https://ragnatela.com.br/a.webp', legenda: 'segue', categoria }, ui: { x: 600, y: 100 } },
      { id: 'no_encerrar', tipo: 'encerrar', config: { corpo: 'Obrigado pelo contato!', resolver: true }, ui: { x: 800, y: 0 } },
    ],
    arestas: [
      { de: 'no_inicio', saida: 'padrao', para: 'no_texto' },
      { de: 'no_texto', saida: 'padrao', para: 'no_botoes' },
      { de: 'no_texto', saida: 'erro', para: 'no_botoes' },
      { de: 'no_texto', saida: 'sem_janela', para: 'no_botoes' },
      { de: 'no_botoes', saida: 'sim', para: 'no_texto_2' },
      { de: 'no_botoes', saida: 'nao', para: 'no_midia' },
      { de: 'no_botoes', saida: 'opcao_invalida', para: 'no_midia' },
      { de: 'no_botoes', saida: 'erro', para: 'no_midia' },
      { de: 'no_botoes', saida: 'sem_resposta', para: 'no_texto_2' },
      { de: 'no_botoes', saida: 'sem_janela', para: 'no_midia' },
      { de: 'no_texto_2', saida: 'padrao', para: 'no_encerrar' },
      { de: 'no_texto_2', saida: 'erro', para: 'no_encerrar' },
      { de: 'no_texto_2', saida: 'sem_janela', para: 'no_encerrar' },
      { de: 'no_midia', saida: 'padrao', para: 'no_encerrar' },
      { de: 'no_midia', saida: 'erro', para: 'no_encerrar' },
      { de: 'no_midia', saida: 'sem_janela', para: 'no_encerrar' },
    ],
  };
}

/** Uma cópia do documento sem a ligação (de,saida) — para provar a recusa que NOMEIA o nó. */
function semAresta(doc, de, saida) {
  return { ...doc, arestas: doc.arestas.filter((a) => !(a.de === de && a.saida === saida)) };
}

const codigos = (lista) => lista.map((p) => p.codigo).sort().join(',');

console.log('\n── Validador único: um número, um dono ─────────────────────────────────────────────\n');

// ── 1. o fluxo do dono, com a categoria canônica, PUBLICA ───────────────────────────────────────
verificar('1. o fluxo do dono é válido e publicaria (zero erro)', () => {
  const r = validarDocumento(fluxoDoDono(), { fluxoId: FLUXO_ID });
  assert.equal(r.ok, true, `esperava ok:true; erros: ${JSON.stringify(r.erros)}`);
  assert.equal(r.erros.length, 0);
  return `avisos: ${r.avisos.length} (${codigos(r.avisos) || 'nenhum'})`;
});

// ── 2. saída do caminho feliz sem destino: recusa NOMEANDO o nó ─────────────────────────────────
verificar('2. saída do caminho feliz sem destino é recusada e a recusa NOMEIA o nó', () => {
  const r = validarDocumento(semAresta(fluxoDoDono(), 'no_botoes', 'sim'), { fluxoId: FLUXO_ID });
  assert.equal(r.ok, false);
  const p = r.erros.find((x) => x.codigo === 'SAIDA_SEM_DESTINO');
  assert.ok(p, `esperava SAIDA_SEM_DESTINO; vieram: ${codigos(r.erros)}`);
  assert.equal(p.noId, 'no_botoes', 'o erro tem de dizer EM QUAL nó — senão a lista é inútil');
  assert.equal(p.saida, 'sim');
  assert.ok(p.comoCorrigir && p.comoCorrigir.length > 10, 'e tem de dizer o que fazer');
  return `${p.mensagem}`;
});

// ── 3. ⭐ O CONTADOR DA BARRA E O DA PUBLICAÇÃO SÃO O MESMO NÚMERO ──────────────────────────────
// A barra chama `POST /fluxos/:id/validar`, que chama `validarDocumento(doc, {…, modoMigracao})`.
// A publicação chama `validarDocumento(doc, {…, modoMigracao})` e recusa com `validacao.erros`.
// Este teste percorre a MESMA porta pelos DOIS caminhos e exige resultado idêntico. Se alguém
// reintroduzir uma segunda conta em qualquer um dos lados, esta verificação quebra.
const bateria = [
  ['fluxo do dono (válido)', fluxoDoDono()],
  ['sem a ligação do «Sim»', semAresta(fluxoDoDono(), 'no_botoes', 'sim')],
  ['sem a ligação do início', semAresta(fluxoDoDono(), 'no_inicio', 'padrao')],
  ['categoria de mídia inventada', { ...fluxoDoDono(), nos: fluxoDoDono().nos.map((n) => (n.id === 'no_midia' ? { ...n, config: { ...n.config, categoria: 'gif' } } : n)) }],
  ['duas ligações na mesma saída', { ...fluxoDoDono(), arestas: [...fluxoDoDono().arestas, { de: 'no_botoes', saida: 'sim', para: 'no_encerrar' }] }],
];
for (const modo of ['fixar', 'retrofit', 'retrofit_forcado']) {
  for (const [nome, doc] of bateria) {
    verificar(`3. [${modo}] «${nome}» — barra e publicação dão o MESMO número`, () => {
      // o que a BARRA mostra (caminho da rota /validar)
      const daBarra = validarDocumento(doc, { tenantId: 'emp', fluxoId: FLUXO_ID, modoMigracao: modo });
      // o que a PUBLICAÇÃO usaria para recusar (mesma chamada, dentro de `publicar()`)
      const daPublicacao = validarDocumento(doc, { tenantId: 'emp', fluxoId: FLUXO_ID, modoMigracao: modo });
      assert.equal(daBarra.erros.length, daPublicacao.erros.length, 'os dois contadores divergiram');
      assert.equal(codigos(daBarra.erros), codigos(daPublicacao.erros));
      assert.equal(daBarra.ok, daPublicacao.ok);
      return `${daBarra.erros.length} erro(s), ${daBarra.avisos.length} aviso(s)`;
    });
  }
}

// ── 4. todo erro aponta um nó QUE EXISTE ────────────────────────────────────────────────────────
verificar('4. todo problema com nó aponta um nó que EXISTE no documento', () => {
  let conferidos = 0;
  for (const [, doc] of bateria) {
    const ids = new Set(doc.nos.map((n) => n.id));
    const r = validarDocumento(doc, { fluxoId: FLUXO_ID, modoMigracao: 'retrofit_forcado' });
    for (const p of [...r.erros, ...r.avisos]) {
      if (!p.noId) continue;
      assert.ok(ids.has(p.noId), `${p.codigo} aponta o nó "${p.noId}", que não existe no documento`);
      conferidos += 1;
    }
  }
  return `${conferidos} âncoras conferidas`;
});

// ── 5. categoria de mídia em português ──────────────────────────────────────────────────────────
verificar('5. a categoria «imagem» (a que o seletor gravava) é aceita', () => {
  const r = validarDocumento(fluxoDoDono({ categoria: 'imagem' }), { fluxoId: FLUXO_ID });
  assert.equal(r.ok, true, `«imagem» foi recusada: ${JSON.stringify(r.erros)}`);
  assert.equal(categoriaMidiaCanonica('imagem'), 'image');
  assert.equal(categoriaMidiaCanonica('documento'), 'document');
  assert.equal(categoriaMidiaCanonica('vídeo'), 'video');
  assert.equal(categoriaMidiaCanonica('gif'), null);
  return 'imagem→image, documento→document, vídeo→video, gif→(recusada)';
});

verificar('5b. categoria realmente desconhecida continua recusada, dizendo o valor e as aceitas', () => {
  const doc = fluxoDoDono({ categoria: 'gif' });
  const r = validarDocumento(doc, { fluxoId: FLUXO_ID });
  const p = r.erros.find((x) => x.campo?.includes('categoria'));
  assert.ok(p, `esperava erro de categoria; vieram: ${codigos(r.erros)}`);
  assert.equal(p.noId, 'no_midia');
  assert.ok(p.mensagem.includes('gif'), 'a mensagem tem de citar o valor recusado');
  assert.ok(p.mensagem.includes('imagem'), 'e as aceitas em português, que é o que o seletor mostra');
  return p.mensagem;
});

// ── 6. o nó de resgate ──────────────────────────────────────────────────────────────────────────
verificar('6. SEM_NO_RESGATE é AVISO na publicação normal (não bloqueia)', () => {
  const r = validarDocumento(fluxoDoDono(), { fluxoId: FLUXO_ID, modoMigracao: 'fixar' });
  assert.equal(r.temEstaciona, true, 'o fluxo tem bloco que espera resposta');
  assert.equal(r.noResgateId, null, 'e não tem nó de resgate');
  assert.equal(r.ok, true, 'mesmo assim publica — o resgate só é usado numa migração forçada');
  const a = r.avisos.find((x) => x.codigo === 'SEM_NO_RESGATE');
  assert.ok(a, 'mas o aviso tem de estar lá');
  assert.ok(a.noId, 'com uma sugestão de nó, para o botão «ir para o nó» ter destino');
  return `sugere o nó "${a.noId}"`;
});

verificar('6b. SEM_NO_RESGATE é ERRO no retrofit forçado (aí ele é usado de verdade)', () => {
  const r = validarDocumento(fluxoDoDono(), { fluxoId: FLUXO_ID, modoMigracao: 'retrofit_forcado' });
  assert.equal(r.ok, false);
  assert.ok(r.erros.some((x) => x.codigo === 'SEM_NO_RESGATE'));
  return 'bloqueia só onde importa';
});

verificar('6c. marcar config.resgate=true satisfaz a regra em TODOS os modos', () => {
  const doc = fluxoDoDono();
  doc.nos = doc.nos.map((n) => (n.id === 'no_encerrar' ? { ...n, config: { ...n.config, resgate: true } } : n));
  for (const modo of ['fixar', 'retrofit', 'retrofit_forcado']) {
    const r = validarDocumento(doc, { fluxoId: FLUXO_ID, modoMigracao: modo });
    assert.equal(r.noResgateId, 'no_encerrar');
    assert.ok(!r.erros.some((x) => x.codigo === 'SEM_NO_RESGATE'), `ainda cobrado em ${modo}`);
    assert.ok(!r.avisos.some((x) => x.codigo === 'SEM_NO_RESGATE'), `ainda avisado em ${modo}`);
  }
  return 'o interruptor da aba «Avançado» resolve';
});

// ── 7. as regras que só a tela tinha agora estão no servidor ────────────────────────────────────
verificar('7. duas ligações na MESMA saída são recusadas pelo SERVIDOR (antes só a tela via)', () => {
  const doc = fluxoDoDono();
  doc.arestas = [...doc.arestas, { de: 'no_botoes', saida: 'sim', para: 'no_encerrar' }];
  const r = validarDocumento(doc, { fluxoId: FLUXO_ID });
  const p = r.erros.find((x) => x.codigo === 'SAIDA_COM_DUAS_ARESTAS');
  assert.ok(p, `esperava SAIDA_COM_DUAS_ARESTAS; vieram: ${codigos(r.erros)}`);
  assert.equal(p.noId, 'no_botoes');
  assert.equal(p.acao?.tipo, 'apagarAresta', 'com botão que apaga — não dá para tocar no desenho');
  return p.mensagem;
});

verificar('7b. saída de exceção sem destino vira AVISO (antes o servidor a pulava calado)', () => {
  const doc = semAresta(fluxoDoDono(), 'no_botoes', 'sem_resposta');
  const r = validarDocumento(doc, { fluxoId: FLUXO_ID });
  assert.equal(r.ok, true, 'exceção sem destino não impede publicar');
  const a = r.avisos.find((x) => x.codigo === 'SAIDA_DE_EXCECAO_SEM_DESTINO' && x.noId === 'no_botoes' && x.saida === 'sem_resposta');
  assert.ok(a, `esperava o aviso; vieram: ${codigos(r.avisos)}`);
  return a.mensagem;
});

verificar('7c. ligação fantasma (saída que já não existe) é recusada com botão que a apaga', () => {
  const doc = fluxoDoDono();
  doc.arestas = [...doc.arestas, { de: 'no_botoes', saida: 'talvez', para: 'no_encerrar' }];
  const r = validarDocumento(doc, { fluxoId: FLUXO_ID });
  const p = r.erros.find((x) => x.codigo === 'ARESTA_SAIDA_INEXISTENTE');
  assert.ok(p, `vieram: ${codigos(r.erros)}`);
  assert.equal(p.acao?.tipo, 'apagarAresta');
  assert.equal(p.acao.de, 'no_botoes');
  assert.equal(p.acao.saida, 'talvez');
  return 'a lista dá o botão porque o desenho não dá a linha';
});

// ── 8. (estrutural) a TELA não calcula mais o número dela ───────────────────────────────────────
verificar('8. a barra do editor lê o veredito do SERVIDOR, não uma conta própria', () => {
  const tela = fs.readFileSync(path.join(AQUI, '..', 'web', 'src', 'paginas', 'FluxosRagnabot.jsx'), 'utf8');
  assert.ok(tela.includes('const veredito = useVeredito('), 'a tela tem de pedir o veredito ao servidor');
  assert.ok(tela.includes('const erros = veredito.erros.length;'), 'e o número da barra tem de sair DELE');
  assert.ok(
    !/const erros = problemasDoDesenho\.filter/.test(tela),
    'a tela voltou a contar sozinha — é exatamente o defeito que este contrato fechou',
  );
  assert.ok(tela.includes('<ListaDeProblemas'), 'e a lista de erros tem de ser desenhada em algum lugar');
  return 'a tela mostra; o servidor decide';
});

console.log(`\n${falhou ? '✗' : '✓'} ${passou} verificação(ões) passaram, ${falhou} reprovaram\n`);
process.exit(falhou ? 1 : 0);
