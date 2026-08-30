#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O MODO DE TESTE DO EDITOR DE FLUXOS NÃO PODE ESCREVER NO BANCO.
//
// POR QUE ESTE ARQUIVO EXISTE (defeito medido em 28/08/2026, corrigido no mesmo dia)
// A rota POST /api/ragnabot-fluxo/fluxos/:id/testar responde, textualmente, que "nada foi gravado".
// Não era verdade. O nó `chamado` — e o `inicio` com `config.emitirProtocolo: true` — chama
// `garantirProtocolo(ctx)`, que tem três degraus: (1) protocolo já na execução, (2) a porta
// `ctx.protocolo`, (3) o serviço REAL, que grava. O contexto de teste não tinha o degrau 2, então
// todo clique em "Testar" caía no degrau 3 e:
//   • queimava um número da sequência humana da empresa (buraco visível para o cliente); e
//   • gravava a linha (cwAccountId=0, cwConversationId=0) — o MESMO par para TODAS as empresas.
//     Como o caminho rápido de `emitirProtocolo` casa só por (conta, conversa), sem comparar
//     empresa, a partir da primeira gravação TODO teste de TODA empresa passava a receber o
//     protocolo da PRIMEIRA. Vazamento de prefixo e de volume de atendimento entre clientes.
//
// Esta bateria prende as duas travas da correção. Sem ela, a porta some na próxima refatoração —
// ninguém percebe, porque o sintoma só aparece no banco de outra empresa.
//
// COMO RODAR
//     node tests/ragnabot-fluxo-teste-nao-grava.test.mjs
//
//   Sem DATABASE_URL utilizável, as verificações de comportamento (1 e 2) rodam mesmo assim — elas
//   não tocam o banco, que é justamente o que está sendo afirmado. A verificação 3 (contagem antes
//   e depois) é a única que precisa do Postgres e se declara PULADA quando ele não responde.
//
// ⚠️ FORA DO GLOB DO VITEST de propósito: o corredor varre `tests/**/*.test.js` e este arquivo é um
// script com `process.exit`, no mesmo padrão de `ragnabot-fluxo.test.mjs` e `ragnabot-isolamento.test.mjs`.
//
// CÓDIGOS DE SAÍDA:  0 = verde   1 = alguma verificação reprovou   3 = erro inesperado
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';

let falhas = 0;
let pulos = 0;

function ok(titulo)            { console.log(`  ✅ ${titulo}`); }
function reprovou(titulo, por) { falhas += 1; console.log(`  ❌ ${titulo}\n     ${por}`); }
function pulou(titulo, por)    { pulos += 1;  console.log(`  ⏭️  ${titulo}\n     ${por}`); }
function afirmar(condicao, titulo, por) { condicao ? ok(titulo) : reprovou(titulo, por); }

// Documento mínimo com o nó que emite protocolo. Não passa pela rota HTTP de propósito: a rota
// exige token, escopo e fluxo gravado, e o que está sob julgamento aqui é o CONTEXTO que ela monta.
const NO_CHAMADO = {
  id: 'abrir', tipo: 'chamado',
  config: { para: 'protocolo', camposObrigatorios: [] },
};

// A execução falsa é copiada da rota (linha do `execucaoFalsa`): conversa NULA, não zero.
function execucaoFalsaComoNaRota(tenantId) {
  return { id: 'teste', tenantId, cwAccountId: null, cwConversationId: null, protocolo: null, visitaSeq: 0, tentativasNo: {} };
}

async function principal() {
  const { contextoDeTeste } = await import('../src/routes/ragnabot-fluxo.routes.js');
  const nos = await import('../src/services/ragnabot-fluxo-nos.service.js');

  const limites = {
    perfil: 'whatsapp_cloud@2026-08', origem: 'documentacao', unidade: 'indefinida',
    valores: { botoes_max: 3, lista_itens_max: 10, lista_titulo_max: 24, janela_servico_horas: 24 },
  };
  const montar = (no, tenantId) => contextoDeTeste({
    no, vars: {}, entrada: null,
    execucaoFalsa: execucaoFalsaComoNaRota(tenantId),
    agora: new Date(), limites, intencoes: [], registros: [],
  });

  // ── 1) a porta existe e é ela que o nó usa ────────────────────────────────────────────────────
  console.log('\n1) O contexto de teste oferece a porta `protocolo` e o nó `chamado` a usa');
  const ctxA = montar(NO_CHAMADO, 'empresa-A');
  afirmar(typeof ctxA?.protocolo?.emitirProtocolo === 'function',
    'contextoDeTeste expõe `protocolo.emitirProtocolo`',
    'A porta sumiu. Sem ela, `garantirProtocolo` importa o serviço real e GRAVA no banco de produção.');

  const rA = await nos.EXECUTORES.chamado.executar(ctxA);
  afirmar(rA?.tipo === 'seguir' && rA?.varsPatch?.protocolo === 'TESTE-0000000000',
    'o nó `chamado` devolve o protocolo de ensaio, não um número real',
    `Devolveu ${JSON.stringify(rA)}. Se veio um número com prefixo de empresa, a emissão foi REAL.`);

  // A mesma pergunta para outra empresa: o ensaio não pode devolver nada que pertença à primeira.
  const rB = await nos.EXECUTORES.chamado.executar(montar(NO_CHAMADO, 'empresa-B'));
  afirmar(rB?.varsPatch?.protocolo === 'TESTE-0000000000',
    'empresa B recebe o mesmo protocolo de ensaio (nunca o da empresa A)',
    `Devolveu ${JSON.stringify(rB?.varsPatch)}. Protocolo de outra empresa aqui é vazamento entre clientes.`);

  // O `inicio` com emitirProtocolo:true queima número já no PRIMEIRO passo — a variante mais barata
  // de disparar o defeito, porque nem exige responder às perguntas do fluxo.
  const rInicio = await nos.EXECUTORES.inicio.executar(
    montar({ id: 'ini', tipo: 'inicio', config: { emitirProtocolo: true } }, 'empresa-A'),
  );
  afirmar(rInicio?.varsPatch?.protocolo === 'TESTE-0000000000',
    'o nó `inicio` com `emitirProtocolo: true` também passa pela porta',
    `Devolveu ${JSON.stringify(rInicio?.varsPatch)}.`);

  // ── 2) a rede de segurança: sem a porta, a falha é barulhenta e LOCAL ─────────────────────────
  console.log('\n2) Rede de segurança: sem a porta, a conversa nula faz o serviço recusar antes de gravar');
  const ctxSemPorta = montar(NO_CHAMADO, 'empresa-A');
  delete ctxSemPorta.protocolo; // simula o dia em que alguém apagar a porta numa refatoração
  let rSem;
  try {
    rSem = await nos.EXECUTORES.chamado.executar(ctxSemPorta);
  } catch (e) {
    rSem = { tipo: 'lancou', erro: e?.message };
  }
  const recusou = rSem?.tipo === 'falhar'
    || /conversa obrigatória/i.test(JSON.stringify(rSem ?? ''));
  afirmar(recusou,
    'o nó recusa em vez de emitir um número real',
    `Devolveu ${JSON.stringify(rSem)}. Se emitiu, a sentinela de conversa voltou a ser 0/0 — e 0/0 é `
    + 'o mesmo par em todas as empresas, o que faz uma receber o protocolo da outra.');

  // ── 3) o veredito do banco: nada foi escrito ─────────────────────────────────────────────────
  console.log('\n3) Contagem no banco antes e depois (a única verificação que precisa do Postgres)');
  let prisma = null;
  try {
    prisma = (await import('../src/base/db.js')).default;
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    pulou('contagem de protocolos inalterada', `Postgres indisponível nesta máquina: ${e?.message ?? e}`);
    prisma = null;
  }
  if (prisma) {
    try {
      const antes = await prisma.ragnabotProtocolo.count();
      const contadoresAntes = await prisma.ragnabotContadorProtocolo.findMany({
        select: { tenantId: true, ultimo: true }, orderBy: { tenantId: 'asc' },
      });

      // Usa uma empresa REAL, se houver: é o cenário do defeito (a rota sempre passa o tenantId do
      // fluxo, que existe). Sem nenhuma cadastrada, a asserção continua valendo com uma inventada.
      const tenantReal = contadoresAntes[0]?.tenantId ?? 'empresa-sem-cadastro';
      await nos.EXECUTORES.chamado.executar(montar(NO_CHAMADO, tenantReal));

      const depois = await prisma.ragnabotProtocolo.count();
      const contadoresDepois = await prisma.ragnabotContadorProtocolo.findMany({
        select: { tenantId: true, ultimo: true }, orderBy: { tenantId: 'asc' },
      });

      afirmar(antes === depois,
        `nenhuma linha nova em RagnabotProtocolo (${antes} → ${depois})`,
        `O modo de teste GRAVOU. A resposta da rota diz "nada foi gravado" — a rota estaria mentindo.`);
      afirmar(JSON.stringify(contadoresAntes) === JSON.stringify(contadoresDepois),
        'nenhum contador de empresa avançou',
        `Antes: ${JSON.stringify(contadoresAntes)}\n     Depois: ${JSON.stringify(contadoresDepois)}`);

      const sentinela = await prisma.ragnabotProtocolo.findFirst({
        where: { cwAccountId: 0, cwConversationId: 0 },
        select: { protocolo: true, tenantId: true },
      });
      afirmar(!sentinela,
        'não existe a linha (conta 0, conversa 0) — a que era compartilhada por todas as empresas',
        `Achei ${JSON.stringify(sentinela)}. Enquanto essa linha existir, todo teste de toda empresa `
        + 'recebe o protocolo dessa aí. Apagá-la é decisão do dono do dado, não deste teste.');
    } catch (e) {
      pulou('contagem de protocolos inalterada', `Tabelas do Ragnabot indisponíveis: ${e?.message ?? e}`);
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  }

  console.log(`\n${falhas === 0 ? '✅ VERDE' : '❌ VERMELHO'} — ${falhas} reprovação(ões), ${pulos} pulada(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((e) => { console.error('erro inesperado:', e); process.exit(3); });
