#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EXECUTÁVEL DO SERVIÇO DE PUBLICAÇÃO DE FLUXO — Etapa A2 do plano (doc 32)
//
// Roda contra o PostgreSQL REAL (o mesmo cliente Prisma que o serviço usa: schema `public`), cria
// uma empresa e um fluxo DESCARTÁVEIS, exercita o serviço de verdade e APAGA tudo no `finally` —
// aconteça o que acontecer. Nada de dublê em memória: publicar/reverter fazem transações reais, e o
// Postgres é o juiz da imutabilidade da versão e das FKs compostas.
//
// O QUE ESTE ARQUIVO PROVA (as cinco garantias do contrato + duas de reforço):
//   1. publicar rascunho válido cria a VERSÃO 1 e aponta `RagnabotFluxo.versaoPublicadaId` para ela,
//      materializando a projeção do grafo (nós e arestas).
//   2. republicar só ARRASTANDO um bloco (muda `no.ui`) NÃO cria versão nova — LEI 5: coordenada de
//      tela não é estrutura, e não pode orfanar conversa.
//   3. republicar mudando a ESTRUTURA (novo nó + novas arestas) cria a VERSÃO 2.
//   4. rascunho INVÁLIDO é recusado com erros e NENHUMA versão nasce.
//   5. reverter para a versão 1 faz o fluxo voltar a SERVIR o conteúdo da versão 1 (copiado para a
//      frente como versão nova, mesmo `hashDocumento`, `origemVersaoId` preenchido).
//   6. (reforço) hashEstrutura ignora `ui`; muda com aresta/tipo.
//   7. (reforço) retrofit MOVE uma conversa viva; fixar a deixa onde está.
//
// COMO RODAR
//     node tests/ragnabot-fluxo-publicacao.test.mjs
//     VERBOSE=1 node tests/ragnabot-fluxo-publicacao.test.mjs   (mostra a pilha do erro)
//
// CÓDIGOS DE SAÍDA — silêncio verde seria pior que a falha:
//   0 = tudo verde   1 = alguma verificação reprovou   3 = erro inesperado
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`, e este script
// usa `process.exit`. NOC 2026-08-29.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import prisma from '../src/base/db.js';
import * as pub from '../src/services/ragnabot-fluxo-publicacao.service.js';

const VERBOSE = !!process.env.VERBOSE;
const marca = `pubteste_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

let passou = 0; let falhou = 0;
async function verificar(titulo, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  ✓ ${titulo}`);
  } catch (e) {
    falhou += 1;
    console.log(`  ✗ ${titulo}`);
    console.log(`      ${e.message}`);
    if (VERBOSE) console.log(e.stack);
  }
}

// ── documentos de teste ─────────────────────────────────────────────────────────────────────────
const docBase = () => ({
  variaveis: [],
  nos: [
    { id: 'inicio', tipo: 'inicio', config: {}, ui: { x: 0, y: 0 } },
    { id: 'msg', tipo: 'texto', config: { corpo: 'Olá! Sou o Ragnabot de teste.' }, ui: { x: 100, y: 0 } },
    { id: 'fim', tipo: 'encerrar', config: {}, ui: { x: 200, y: 0 } },
  ],
  arestas: [
    { de: 'inicio', saida: 'padrao', para: 'msg' },
    { de: 'msg', saida: 'padrao', para: 'fim' },
  ],
});

// mesmo documento, bloco arrastado (só muda ui)
const docArrastado = () => {
  const d = docBase();
  d.nos[1].ui = { x: 640, y: 480 };
  return d;
};

// mudança ESTRUTURAL válida: insere um nó novo no meio (inicio → msg → msg2 → fim)
const docEstrutural = () => ({
  variaveis: [],
  nos: [
    { id: 'inicio', tipo: 'inicio', config: {}, ui: { x: 0, y: 0 } },
    { id: 'msg', tipo: 'texto', config: { corpo: 'Olá! Sou o Ragnabot de teste.' }, ui: { x: 100, y: 0 } },
    { id: 'msg2', tipo: 'texto', config: { corpo: 'Segunda mensagem, agora com um passo a mais.' }, ui: { x: 200, y: 0 } },
    { id: 'fim', tipo: 'encerrar', config: {}, ui: { x: 300, y: 0 } },
  ],
  arestas: [
    { de: 'inicio', saida: 'padrao', para: 'msg' },
    { de: 'msg', saida: 'padrao', para: 'msg2' },
    { de: 'msg2', saida: 'padrao', para: 'fim' },
  ],
});

// mudança só de TEXTO (compatível: mesma topologia) — para o cenário de retrofit
const docSoTexto = () => {
  const d = docBase();
  d.nos[1].config.corpo = 'Olá! Texto trocado, mesma estrutura.';
  return d;
};

// inválido: aresta aponta para nó que não existe
const docInvalido = () => {
  const d = docBase();
  d.arestas[1].para = 'nao_existe';
  return d;
};

const setDoc = (fluxoId, documento) =>
  prisma.ragnabotFluxoRascunho.update({ where: { fluxoId }, data: { documento, rev: { increment: 1 } } });

const contarVersoes = (fluxoId) => prisma.ragnabotFluxoVersao.count({ where: { fluxoId } });

// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  let tenantId = null; let fluxoId = null;
  console.log(`\nSERVIÇO DE PUBLICAÇÃO DE FLUXO — prova real (marca ${marca})\n`);

  try {
    // ── preparo: empresa + fluxo + rascunho descartáveis ─────────────────────────────────────────
    const tenant = await prisma.ragnabotTenant.create({
      data: {
        name: `Empresa de teste ${marca}`,
        slug: marca,
        contactName: 'Teste NOC',
        contactEmail: `${marca}@teste.ragnatela.local`,
        limits: {},
      },
    });
    tenantId = tenant.id;
    const fluxo = await prisma.ragnabotFluxo.create({
      data: { tenantId, nome: `Fluxo de teste ${marca}`, entrada: 'subfluxo' },
    });
    fluxoId = fluxo.id;
    await prisma.ragnabotFluxoRascunho.create({ data: { fluxoId, tenantId, documento: docBase() } });

    let v1 = null; let v2 = null;

    // ── 1. publicar rascunho válido → versão 1 + ponteiro ────────────────────────────────────────
    await verificar('1. publicar válido cria versão 1 e aponta versaoPublicadaId', async () => {
      const r = await pub.publicar(fluxoId, { userId: null });
      assert.equal(r.criouVersao, true, 'deveria criar versão');
      assert.equal(r.numero, 1, `numero esperado 1, veio ${r.numero}`);
      const f = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
      assert.equal(f.versaoPublicadaId, r.versaoId, 'versaoPublicadaId deve apontar para a versão nova');
      v1 = await prisma.ragnabotFluxoVersao.findUnique({ where: { id: r.versaoId } });
      const nNos = await prisma.ragnabotFluxoNo.count({ where: { versaoId: v1.id } });
      const nArestas = await prisma.ragnabotFluxoAresta.count({ where: { versaoId: v1.id } });
      assert.equal(nNos, 3, `esperava 3 nós projetados, vieram ${nNos}`);
      assert.equal(nArestas, 2, `esperava 2 arestas projetadas, vieram ${nArestas}`);
      assert.equal(await contarVersoes(fluxoId), 1, 'deveria haver exatamente 1 versão');
    });

    // ── 2. arrastar bloco (só ui) → NÃO cria versão nova ─────────────────────────────────────────
    await verificar('2. republicar arrastando bloco (só ui) NÃO cria versão nova (LEI 5)', async () => {
      await setDoc(fluxoId, docArrastado());
      const r = await pub.publicar(fluxoId, { userId: null });
      assert.equal(r.criouVersao, false, `NÃO deveria criar versão; motivo do serviço: ${r.motivo}`);
      assert.match(r.motivo, /ui/, 'o motivo deve deixar claro que só o ui mudou');
      assert.equal(await contarVersoes(fluxoId), 1, 'continua com 1 versão');
      const f = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
      assert.equal(f.versaoPublicadaId, v1.id, 'ponteiro não pode mudar');
    });

    // ── 3. mudança estrutural → versão 2 ─────────────────────────────────────────────────────────
    await verificar('3. republicar mudando estrutura cria versão 2', async () => {
      await setDoc(fluxoId, docEstrutural());
      const r = await pub.publicar(fluxoId, { userId: null });
      assert.equal(r.criouVersao, true, 'deveria criar versão');
      assert.equal(r.numero, 2, `numero esperado 2, veio ${r.numero}`);
      assert.notEqual(v1.hashEstrutura, r.hashEstrutura, 'hashEstrutura deve mudar numa mudança estrutural');
      v2 = await prisma.ragnabotFluxoVersao.findUnique({ where: { id: r.versaoId } });
      const f = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
      assert.equal(f.versaoPublicadaId, v2.id, 'ponteiro deve ir para a versão 2');
      assert.equal(await contarVersoes(fluxoId), 2, 'deveria haver 2 versões');
      const nNos = await prisma.ragnabotFluxoNo.count({ where: { versaoId: v2.id } });
      assert.equal(nNos, 4, `versão 2 deveria projetar 4 nós, vieram ${nNos}`);
    });

    // ── 4. rascunho inválido → recusado, sem versão nova ─────────────────────────────────────────
    await verificar('4. rascunho inválido é recusado com erros e não cria versão', async () => {
      const val = pub.validarDocumento(docInvalido(), { tenantId });
      assert.equal(val.ok, false, 'validarDocumento deveria reprovar');
      assert.ok(val.erros.length > 0, 'deveria listar erros');
      await setDoc(fluxoId, docInvalido());
      let lancou = false;
      try { await pub.publicar(fluxoId, { userId: null }); } catch (e) { lancou = true; assert.equal(e.codigo, 'VALIDACAO', `codigo esperado VALIDACAO, veio ${e.codigo}`); }
      assert.equal(lancou, true, 'publicar deveria lançar em documento inválido');
      assert.equal(await contarVersoes(fluxoId), 2, 'nenhuma versão nova pode nascer de rascunho inválido');
      const f = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
      assert.equal(f.versaoPublicadaId, v2.id, 'ponteiro intacto');
    });

    // ── 5. reverter para a versão 1 ──────────────────────────────────────────────────────────────
    await verificar('5. reverter para a versão 1 volta a servir o conteúdo da versão 1', async () => {
      const r = await pub.reverterPara(fluxoId, 1, { userId: null });
      assert.equal(r.criouVersao, true, 'reverter copia para a frente: cria versão nova');
      assert.equal(r.numero, 3, `numero esperado 3, veio ${r.numero}`);
      assert.equal(r.revertidoDe, 1);
      assert.equal(r.origemVersaoId, v1.id, 'origemVersaoId deve apontar para a versão 1');
      const nova = await prisma.ragnabotFluxoVersao.findUnique({ where: { id: r.versaoId } });
      assert.equal(nova.hashDocumento, v1.hashDocumento, 'o conteúdo revertido deve ser IDÊNTICO ao da versão 1');
      const f = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
      assert.equal(f.versaoPublicadaId, nova.id, 'o fluxo agora serve a versão revertida');
    });

    // ── 6. reforço: hashEstrutura ignora ui, muda com aresta ─────────────────────────────────────
    await verificar('6. hashEstrutura ignora ui e muda com aresta/tipo', async () => {
      assert.equal(pub.hashEstrutura(docBase()), pub.hashEstrutura(docArrastado()), 'arrastar não muda hashEstrutura');
      assert.notEqual(pub.hashEstrutura(docBase()), pub.hashEstrutura(docEstrutural()), 'estrutura diferente muda o hash');
      assert.equal(pub.classificarMudanca(docBase(), docArrastado()), 'compativel');
      assert.equal(pub.classificarMudanca(docBase(), docEstrutural()), 'estrutural');
    });

    // ── 7. reforço: retrofit MOVE conversa viva; fixar não ───────────────────────────────────────
    await verificar('7. retrofit move uma conversa viva; fixar a deixa onde está', async () => {
      // estado atual: vigente é a versão 3 (revertida = conteúdo base). Semeio uma execução viva nela.
      const vigenteId = (await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } })).versaoPublicadaId;
      const exec = await prisma.ragnabotFluxoExecucao.create({
        data: {
          tenantId, cwAccountId: 1, cwConversationId: Math.floor(Math.random() * 1e8),
          fluxoId, versaoId: vigenteId, versaoInicialId: vigenteId,
          noAtualId: 'msg', estado: 'esperando', aguardando: 'resposta',
          expiraEm: new Date(Date.now() + 3600_000),
        },
      });

      // publicar mudança SÓ de texto (compatível) com modo fixar → a viva NÃO se move
      await setDoc(fluxoId, docSoTexto());
      const rFixar = await pub.publicar(fluxoId, { userId: null, modoMigracao: 'fixar' });
      assert.equal(rFixar.criouVersao, true, 'troca de texto deve gerar versão (medição N vs N-1)');
      assert.equal(rFixar.migradas, 0, 'fixar não move ninguém');
      let e1 = await prisma.ragnabotFluxoExecucao.findUnique({ where: { id: exec.id } });
      assert.equal(e1.versaoId, vigenteId, 'com fixar, a conversa fica na versão em que entrou');

      // agora publicar outra mudança de texto com retrofit → a viva (ainda na versão 3) se move
      // reposiciono a execução na última versão publicada por fixar para exercitar o retrofit
      const aposFixar = (await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId } })).versaoPublicadaId;
      await prisma.ragnabotFluxoExecucao.update({ where: { id: exec.id }, data: { versaoId: aposFixar, versaoInicialId: aposFixar } });
      await setDoc(fluxoId, (() => { const d = docBase(); d.nos[1].config.corpo = 'Terceiro texto, retrofit.'; return d; })());
      const rRetro = await pub.publicar(fluxoId, { userId: null, modoMigracao: 'retrofit' });
      assert.equal(rRetro.criouVersao, true);
      assert.equal(rRetro.migradas, 1, `retrofit deveria mover 1 conversa, moveu ${rRetro.migradas}`);
      let e2 = await prisma.ragnabotFluxoExecucao.findUnique({ where: { id: exec.id } });
      assert.equal(e2.versaoId, rRetro.versaoId, 'com retrofit, a conversa passa para a versão nova');
      assert.equal(e2.noAtualId, 'msg', 'nó ainda existe: a conversa segue congelada onde estava');
    });

  } catch (e) {
    console.log('\n✗ ERRO INESPERADO no preparo/execução:');
    console.log(`  ${e.message}`);
    if (VERBOSE) console.log(e.stack);
    falhou += 1;
  } finally {
    // ── limpeza: apaga tudo o que este teste criou, em ordem segura de FK ────────────────────────
    if (tenantId) {
      try {
        await prisma.ragnabotFluxoAresta.deleteMany({ where: { tenantId } });
        await prisma.ragnabotFluxoNo.deleteMany({ where: { tenantId } });
        await prisma.ragnabotFluxoExecucao.deleteMany({ where: { tenantId } });
        await prisma.ragnabotFluxoVersao.deleteMany({ where: { tenantId } });
        await prisma.ragnabotFluxoRascunho.deleteMany({ where: { tenantId } });
        await prisma.ragnabotFluxo.deleteMany({ where: { tenantId } });
        await prisma.ragnabotTenant.delete({ where: { id: tenantId } });
        // prova de que não sobrou rastro
        const sobra = await prisma.ragnabotFluxo.count({ where: { tenantId } })
          + await prisma.ragnabotFluxoVersao.count({ where: { tenantId } });
        console.log(`\nlimpeza: ok (rastro remanescente = ${sobra})`);
      } catch (e) {
        console.log(`\n⚠️ limpeza incompleta: ${e.message} — marca ${marca}`);
      }
    }
    await prisma.$disconnect();
  }

  console.log(`\nRESULTADO: ${passou} verde(s), ${falhou} vermelho(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main();
