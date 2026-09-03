#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /catalogo — QUAIS CONECTORES EXISTEM, dito pelo MOTOR e não por uma cópia
//
// ⚠️ POR QUE ESTA ROTA E ESTE TESTE (03/09/2026). O editor precisa saber, para cada tipo de nó,
// quais saídas desenhar. A rota não existia, e a tela desenhava os conectores por um ESPELHO local
// — uma cópia escrita à mão. A cópia envelheceu: `agente_ia` e `pagamento_pix` já estavam no motor
// e NÃO estavam nela. Saída que o editor não desenha é aresta INDESENHÁVEL — o motor resolve a
// saída, não acha destino, grava `ARESTA_AUSENTE` e a conversa do cliente morre calada. Foi assim
// que `sem_janela` mordeu antes, e é o mesmo defeito voltando por outra porta.
//
// ── O QUE ESTÁ SOB JULGAMENTO ──────────────────────────────────────────────────────────────────
// A ROTA REAL, montada num express de verdade, contra os EXECUTORES DE PRODUÇÃO. Nada de banco:
// esta rota não toca em prisma — é uma pergunta sobre o código, não sobre os dados.
//
// A medição que importa: para TODO tipo, `saidasFixas ∪ saidasDeExcecao ∪ saidasDeFalha` tem de ser
// exatamente `saidasDe({ tipo, config: {} })`. É isso que impede a rota de virar uma segunda lista
// que diverge da primeira — que é o defeito que ela veio consertar.
//
// COMO RODAR:   node tests/ragnabot-fluxo-catalogo.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import express from 'express';

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

const nos = await import('../src/services/ragnabot-fluxo-nos.service.js');
const { default: rotaFluxo } = await import('../src/routes/ragnabot-fluxo.routes.js');

const app = express();
app.use(express.json());
app.use((req, _res, prox) => { req.user = { id: 'u1', name: 'Operador', isSuperuser: true, role: 'admin' }; prox(); });
app.use('/api/ragnabot-fluxo', rotaFluxo);
const servidor = app.listen(0);
await new Promise((ok) => servidor.once('listening', ok));
const base = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-fluxo`;

const r = await fetch(`${base}/catalogo`);
const catalogo = await r.json();

console.log('\nCATÁLOGO DOS TIPOS DE NÓ — o que eu consegui medir\n');

await medir('a rota responde 200 (antes de 03/09/2026 ela não existia: era 404)', () => {
  assert.equal(r.status, 200, JSON.stringify(catalogo).slice(0, 300));
});

await medir('ela lista TODOS os tipos que o motor implementa — nenhum a mais, nenhum a menos', () => {
  assert.deepEqual(Object.keys(catalogo.tipos).sort(), [...nos.TIPOS].sort());
  assert.equal(catalogo.total, nos.TIPOS.length);
});

await medir('⭐ nenhuma saída inventada e nenhuma perdida: a união bate com `saidasDe()`, tipo a tipo', () => {
  for (const tipo of nos.TIPOS) {
    const d = catalogo.tipos[tipo];
    const doMotor = nos.saidasDe({ id: 'x', tipo, config: {} });
    const daRota = [...new Set([...d.saidasFixas, ...d.saidasDeExcecao, ...d.saidasDeFalha])];
    assert.deepEqual(daRota.sort(), [...doMotor].sort(), `divergiu em "${tipo}"`);
  }
});

await medir('as três saídas de exceção aparecem em TODO nó que estaciona — e só neles', () => {
  for (const tipo of nos.TIPOS) {
    const d = catalogo.tipos[tipo];
    const estaciona = nos.noEstaciona({ id: 'x', tipo, config: {} });
    assert.equal(d.estaciona, estaciona, `"${tipo}" discorda sobre estacionar`);
    assert.deepEqual(d.saidasDeExcecao, estaciona ? [...nos.SAIDAS_DE_EXCECAO] : [], `"${tipo}"`);
  }
});

await medir('`sem_janela` é declarada nos três tipos que a tomam — a saída que já matou conversa calada', () => {
  for (const tipo of ['pergunta', 'lista', 'botoes', 'texto', 'midia']) {
    assert.ok(catalogo.tipos[tipo].saidasDeFalha.includes('sem_janela'), `"${tipo}" perdeu sem_janela`);
  }
});

await medir('os dois tipos que o espelho da tela NÃO conhecia vêm no catálogo, com as saídas deles', () => {
  assert.ok(catalogo.tipos.agente_ia, 'agente_ia sumiu');
  assert.ok(catalogo.tipos.pagamento_pix, 'pagamento_pix sumiu');
  assert.deepEqual(catalogo.tipos.agente_ia.saidasFixas, ['respondeu', 'nao_sabe', 'erro']);
});

await medir('os tipos cujas saídas nascem da CONFIGURAÇÃO vêm marcados (a tela as monta do documento)', () => {
  for (const tipo of ['lista', 'botoes', 'randomizador', 'subfluxo']) {
    assert.equal(catalogo.tipos[tipo].saidasDependemDaConfig, true, `"${tipo}" devia estar marcado`);
  }
  // Terminal não é dinâmico: sem esta separação o editor ficaria esperando conector que nunca vem.
  for (const tipo of ['time', 'atendente', 'encerrar']) {
    assert.equal(catalogo.tipos[tipo].saidasDependemDaConfig, false, `"${tipo}" é terminal, não dinâmico`);
  }
});

await medir('nenhum tipo estourou ao ser perguntado com configuração vazia', () => {
  assert.equal(catalogo.tiposComProblema, undefined, JSON.stringify(catalogo.tiposComProblema));
});

await medir('os limites do canal viajam junto (é por eles que o editor conta caractere)', () => {
  assert.ok(catalogo.limites && typeof catalogo.limites === 'object', 'limites vieram vazios');
  assert.equal(catalogo.limites.perfil, nos.PERFIL_LIMITES_PADRAO.perfil);
  assert.equal(catalogo.limites.valores.corpo_max, nos.PERFIL_LIMITES_PADRAO.valores.corpo_max);
  assert.equal(catalogo.limites.valores.botoes_max, 3, 'o teto de botões da Meta sumiu do catálogo');
});

servidor.close();
console.log(`\n${medicoes} medições · ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
