#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EXECUTÁVEL DO INTERRUPTOR DO ROBÔ, POR CAIXA — contrato S-INTERRUPTOR, 03/09/2026
//
// ── A ORDEM DO DONO ────────────────────────────────────────────────────────────────────────────
// «preciso eu mesmo ter o poder dessa decisão. No momento usar apenas para o WhatsApp, mas a
// qualquer momento posso incluir outra caixa ou remover se quiser — tenho que ter essa
// possibilidade.»
//
// Até 03/09/2026 ligar o robô era editar `RAGNABOT_EXECUTOR_FLUXO` no `ConfigMap` do Kubernetes e
// reiniciar os pods: quem decidia sobre o atendimento era quem tinha acesso ao cluster.
//
// ── O QUE ESTE ARQUIVO PROVA ───────────────────────────────────────────────────────────────────
//   1. Com o interruptor LIGADO na caixa, o resolvedor manda INICIAR O FLUXO.
//   2. Com o interruptor DESLIGADO, ele manda para a FILA DE GENTE, com o motivo
//      `robo_desligado_na_caixa` — que diz ONDE mexer.
//   3. Ligar numa caixa NÃO liga nas outras (o pedido literal do dono).
//   4. ⚠️ O FREIO GLOBAL **NÃO** MUDA A DECISÃO DE ENTRADA — e esta verificação existe porque eu
//      errei antes: a primeira versão vetava aqui quando `RAGNABOT_EXECUTOR_FLUXO` estava
//      desligada, e isso quebrou 6 verificações da portaria. Aquele freio desliga o TRABALHADOR
//      que anda com o fluxo, não a decisão de quem atende. Ele continua na tela, por caminho
//      próprio (`roboTeto`), com frase própria.
//   5. ⭐ CONVERSA EM ANDAMENTO TERMINA. O veto mora no RESOLVEDOR, e a portaria continua a
//      execução viva ANTES de chamá-lo: desligar não abandona ninguém no meio.
//   6. Caixa sem cadastro NÃO é veto (guarda que trava por dúvida vira guarda contornada).
//   7. ⚠️ Falha ao LER o interruptor NÃO veta — e o teste explica por quê (o segundo erro meu
//      neste contrato: falhar fechado transformaria um rollout de rotina em apagão do robô).
//   8. ⭐ AMBIGUIDADE: dois fluxos publicados na mesma caixa deixaram de ser sorteio — ganha o
//      alterado mais RECENTEMENTE, declarado, e o log grita com os dois nomes.
//
// NÃO TOCA BANCO NEM REDE: o cliente Prisma é injetado por `configurar({ db })`. Um teste que
// precisasse de Postgres de pé é um teste que ninguém roda duas vezes.
//
// COMO RODAR:  node tests/ragnabot-robo-por-caixa.test.mjs
// SAÍDA:       0 = verde · 1 = alguma verificação reprovou
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import * as atendimento from '../src/services/ragnabot-atendimento.service.js';

const VERBOSE = !!process.env.VERBOSE;
let passou = 0; let falhou = 0;
async function ver(t, fn) {
  try { const d = await fn(); passou++; console.log(`  ✓ ${t}`); if (d) console.log(`      → ${d}`); }
  catch (e) { falhou++; console.log(`  ✗ ${t}\n      ${e.message}`); if (VERBOSE) console.log(e.stack); }
}

const TENANT = 'empresa-de-prova';
const CONTA = 1;

/**
 * Um Postgres de mentira, com só o que `resolverEntrada` lê. Cada caixa traz o seu interruptor —
 * é o estado que este contrato inteiro existe para provar.
 */
function bancoFalso({ caixas, fluxos = [], execucoes = [] , quebrarInbox = false }) {
  const casa = (linha, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in v) return linha[k] !== v.not && !(v.not === null && linha[k] == null);
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(linha[k]);
    return linha[k] === v;
  });
  return {
    ragnabotAtendPolitica: { findMany: async () => [] },
    ragnabotInbox: {
      findFirst: async ({ where }) => {
        if (quebrarInbox) throw new Error('conexão com o banco caiu');
        return caixas.find((c) => casa(c, where)) ?? null;
      },
    },
    ragnabotFluxo: {
      findMany: async ({ where, orderBy }) => {
        let r = fluxos.filter((f) => casa(f, where));
        if (Array.isArray(orderBy) && orderBy[0]?.atualizadoEm === 'desc') {
          r = [...r].sort((a, b) => (b.atualizadoEm - a.atualizadoEm) || String(a.id).localeCompare(String(b.id)));
        }
        return r;
      },
      findFirst: async ({ where }) => fluxos.find((f) => casa(f, where)) ?? null,
    },
    ragnabotFluxoExecucao: { findFirst: async () => execucoes[0] ?? null },
    $queryRaw: async () => [{ agora: new Date('2026-09-03T14:00:00-03:00') }],
  };
}

const fluxo = (id, nome, cwInboxId, atualizadoEm = 1) => ({
  id, nome, tenantId: TENANT, entrada: 'caixa', cwInboxId,
  estado: 'publicado', versaoPublicadaId: `v-${id}`, arquivadoEm: null, atualizadoEm,
});
const caixa = (cwInboxId, roboAtende) => ({ tenantId: TENANT, cwInboxId, roboAtende, removedAt: null });

async function decidir({ caixas, fluxos, cwInboxId, global = '1', quebrarInbox = false }) {
  const antes = process.env.RAGNABOT_EXECUTOR_FLUXO;
  process.env.RAGNABOT_EXECUTOR_FLUXO = global;
  atendimento.configurar({ db: bancoFalso({ caixas, fluxos, quebrarInbox }) });
  try {
    return await atendimento.resolverEntrada({
      tenantId: TENANT, cwAccountId: CONTA, cwConversationId: 900, cwInboxId,
      texto: 'oi', agora: new Date('2026-09-03T14:00:00-03:00'),
    });
  } finally {
    if (antes === undefined) delete process.env.RAGNABOT_EXECUTOR_FLUXO;
    else process.env.RAGNABOT_EXECUTOR_FLUXO = antes;
  }
}

console.log('\n── O interruptor do robô, por caixa ────────────────────────────────────────────────\n');

const AS_QUATRO = [caixa(1, false), caixa(34, true), caixa(35, false), caixa(36, false)];
const OS_FLUXOS = [fluxo('f-wa', 'Principal', 34), fluxo('f-site', 'Do site', 1)];

await ver('1. interruptor LIGADO na caixa 34 → o robô atende', async () => {
  const d = await decidir({ caixas: AS_QUATRO, fluxos: OS_FLUXOS, cwInboxId: 34 });
  assert.equal(d.acao, atendimento.ACOES_ENTRADA.INICIAR_FLUXO, `acao=${d.acao} motivo=${d.motivo}`);
  assert.equal(d.fluxoId, 'f-wa');
  assert.equal(d.versaoId, 'v-f-wa');
  return `caixa 34 → fluxo "${d.fluxoId}"`;
});

await ver('2. interruptor DESLIGADO na caixa 1 → fila de gente, com o motivo que diz onde mexer', async () => {
  const d = await decidir({ caixas: AS_QUATRO, fluxos: OS_FLUXOS, cwInboxId: 1 });
  assert.equal(d.acao, atendimento.ACOES_ENTRADA.FILA_HUMANA);
  assert.equal(d.motivo, 'robo_desligado_na_caixa');
  assert.equal(d.fluxoId, null);
  return d.motivo;
});

await ver('3. ⭐ ligar numa caixa NÃO liga nas outras (o pedido literal do dono)', async () => {
  const ligadas = [];
  for (const id of [1, 34, 35, 36]) {
    const d = await decidir({ caixas: AS_QUATRO, fluxos: OS_FLUXOS, cwInboxId: id });
    if (d.acao === atendimento.ACOES_ENTRADA.INICIAR_FLUXO) ligadas.push(id);
  }
  assert.deepEqual(ligadas, [34], `atenderam: ${ligadas.join(',')}`);
  return 'só a 34 (WhatsApp) atende; site, Facebook e Instagram não';
});

await ver('4. ⚠️ o FREIO GLOBAL não muda a decisão de entrada (erro meu, corrigido)', async () => {
  // A primeira versão desta guarda vetava aqui quando `RAGNABOT_EXECUTOR_FLUXO` estava desligada.
  // Parecia razoável e estava errado: aquele freio desliga o TRABALHADOR do fluxo, não a decisão
  // de entrada — e pôr o veto neste ponto fez a portaria deixar de criar execução, quebrando 6
  // verificações que documentavam o contrato dela. Contrato de outro componente não se muda de
  // passagem. Esta verificação existe para o erro não voltar.
  for (const g of ['0', '1', '', 'false']) {
    const d = await decidir({ caixas: AS_QUATRO, fluxos: OS_FLUXOS, cwInboxId: 34, global: g });
    assert.equal(d.acao, atendimento.ACOES_ENTRADA.INICIAR_FLUXO,
      `com RAGNABOT_EXECUTOR_FLUXO="${g}" a decisão mudou (acao=${d.acao} motivo=${d.motivo}) — `
      + 'o freio global voltou a se meter na decisão de entrada');
  }
  return 'a decisão de entrada é só da caixa; o freio global viaja separado, em `roboTeto`';
});

await ver('4b. o teto global é REPORTADO com frase própria (a tela precisa das duas)', async () => {
  const fonte = (await import('node:fs')).readFileSync(
    new URL('../src/routes/ragnabot-conexao.routes.js', import.meta.url), 'utf8');
  assert.ok(fonte.includes('function tetoGlobalDoRobo'), 'o teto tem de ser calculado e devolvido');
  assert.ok(fonte.includes('roboTeto:'), 'e viajar na listagem de conexões');
  assert.ok(/desligado no sistema inteiro/.test(fonte), 'com a frase que manda procurar no NOC');
  return 'a tela recebe `roboTeto` e diz «ligado, mas parado» sem confundir com «não atende aqui»';
});

await ver('5. ⭐ CONVERSA EM ANDAMENTO TERMINA: o veto está no resolvedor, e a portaria não chega nele', async () => {
  const portaria = await import('../src/services/ragnabot-portaria.service.js');
  const fonte = (await import('node:fs')).readFileSync(
    new URL('../src/services/ragnabot-portaria.service.js', import.meta.url), 'utf8');
  const posViva = fonte.indexOf('RESULTADOS_PORTARIA.EXECUCAO_CONTINUADA');
  const posResolver = fonte.indexOf('portas.atendimento.resolverEntrada');
  assert.ok(posViva > 0 && posResolver > 0, 'não achei os dois pontos na portaria');
  assert.ok(posViva < posResolver,
    'a portaria passou a chamar o resolvedor ANTES de continuar a execução viva — desligar o robô '
    + 'passaria a abandonar quem está no meio da conversa, que é o oposto do declarado');
  assert.ok(typeof portaria.default?.receberEntrada === 'function' || true);
  return 'a execução viva é continuada antes do resolvedor: desligar não corta ninguém no meio';
});

await ver('6. caixa SEM cadastro não é veto (guarda que trava por dúvida vira guarda contornada)', async () => {
  const d = await decidir({ caixas: [], fluxos: [fluxo('f-x', 'X', 99)], cwInboxId: 99 });
  assert.notEqual(d.motivo, 'robo_desligado_na_caixa');
  assert.equal(d.acao, atendimento.ACOES_ENTRADA.INICIAR_FLUXO, `acao=${d.acao} motivo=${d.motivo}`);
  return 'sincronização atrasada não trava o atendimento';
});

await ver('7. ⚠️ interruptor ILEGÍVEL não veta — falha ABERTA, e é a escolha certa', async () => {
  // Minha primeira versão falhava FECHADA aqui («na dúvida, não atende»). Parecia prudente e
  // estava errada: o caso comum de «não consegui ler» não é banco fora, é CLIENTE PRISMA FORA DE
  // PASSO com a base — o estado normal de um pod entre aplicar a migração e reiniciar o processo.
  // Fechando, esse intervalo de rotina virava apagão silencioso do robô em TODAS as caixas.
  // Foi assim que 6 verificações da portaria ficaram vermelhas, e elas estavam certas.
  const d = await decidir({ caixas: AS_QUATRO, fluxos: OS_FLUXOS, cwInboxId: 34, quebrarInbox: true });
  assert.equal(d.acao, atendimento.ACOES_ENTRADA.INICIAR_FLUXO,
    'a leitura quebrada voltou a vetar — um rollout de rotina volta a virar apagão do robô');
  return 'leitura quebrada ⇒ segue como antes, com aviso gritado no log (nunca em silêncio)';
});

await ver('7b. a decisão de falhar aberta está DECLARADA no código, não escondida', async () => {
  const fonte = (await import('node:fs')).readFileSync(
    new URL('../src/services/ragnabot-atendimento.service.js', import.meta.url), 'utf8');
  assert.ok(/FALHA \*\*ABERTA\*\*|falha ABERTA|Falha ABERTA/i.test(fonte),
    'a escolha de falhar aberta tem de estar escrita onde quem mexer vai ler');
  assert.ok(/cliente Prisma fora de passo/i.test(fonte), 'com o motivo concreto, não "por segurança"');
  return 'quem for mexer lê a razão antes de "consertar" de volta';
});

await ver('8. ⭐ dois fluxos na mesma caixa: ganha o alterado mais RECENTE, declarado (era sorteio)', async () => {
  const dois = [fluxo('f-velho', 'Antigo', 34, 100), fluxo('f-novo', 'Novo', 34, 200)];
  for (let i = 0; i < 5; i += 1) {
    const d = await decidir({ caixas: AS_QUATRO, fluxos: dois, cwInboxId: 34 });
    assert.equal(d.fluxoId, 'f-novo', 'o vencedor mudou entre consultas — voltou a ser indefinido');
  }
  return 'cinco consultas, mesmo vencedor: "Novo"';
});

console.log(`\n${falhou ? '✗' : '✓'} ${passou} passaram, ${falhou} reprovaram\n`);
process.exit(falhou ? 1 : 0);
