import prisma from '/ia/netagent/src/database/client.js';

// ⚠️ GUARDA DE BASE ERRADA — acrescentada em 02/09/2026 (contrato S-DEPLOY-3).
//
// POR QUE ELA EXISTE: este verificador nasceu quando as tabelas do motor moravam na base do NOC.
// Depois da ETAPA 4 da separação, o Ragnabot ganhou banco PRÓPRIO (`ragnabot`, no líder do
// Patroni), mas as 20 tabelas antigas FICARAM na base do NOC, abandonadas e com zero linhas.
// Resultado medido em 02/09: rodar este arquivo aqui do NOC devolvia TUDO VERDE — índice único
// parcial presente, gatilho de imutabilidade ligado, as 3 chaves estrangeiras compostas de pé —
// só que olhando a CÓPIA MORTA. Verde falso é pior que vermelho: um vermelho manda investigar,
// um verde falso manda publicar.
//
// A base certa NÃO é alcançável daqui de propósito (o `pg_hba` do líder só aceita `ragnabot_app`
// vindo de 172.17.20.0/24 e da rede de pods). O caminho provado é rodar dentro do cluster, ou
// medir por `qm guest exec` no nó de banco. Por isso a guarda RECUSA em vez de tentar adivinhar.
const onde = (await prisma.$queryRawUnsafe(
  `SELECT current_database() AS base, coalesce(inet_server_addr()::text,'local') AS servidor`))[0];
if (onde.base !== 'ragnabot') {
  console.error(`\n⛔ BASE ERRADA — este verificador está ligado a «${onde.base}» (${onde.servidor}).`);
  console.error('   As tabelas do motor moram na base «ragnabot», no líder do Patroni, desde a');
  console.error('   ETAPA 4 da separação. O que existe aqui é a cópia abandonada, com zero linhas:');
  console.error('   medir esta cópia devolve VERDE sobre um banco que ninguém mais usa.');
  console.error('   Rode de dentro do cluster (ou por `qm guest exec` no nó de banco) contra o');
  console.error('   líder medido na hora com `SELECT NOT pg_is_in_recovery()`.\n');
  await prisma.$disconnect();
  process.exit(2);
}
console.log(`base: ${onde.base} @ ${onde.servidor}\n`);
const tabelas = ['RagnabotFluxo','RagnabotFluxoRascunho','RagnabotFluxoVersao','RagnabotFluxoNo',
 'RagnabotFluxoAresta','RagnabotFluxoExecucao','RagnabotFluxoEntrada','RagnabotFluxoEntradaConsumida',
 'RagnabotFluxoFila','RagnabotFluxoEfeito','RagnabotFluxoEvento','RagnabotFluxoNoMetricaDia',
 'RagnabotFluxoIncidente','RagnabotFluxoCanalSaude','RagnabotFluxoJanela','RagnabotFluxoSegredo',
 'RagnabotFluxoDestinoPermitido','RagnabotFluxoLimiteCanal','RagnabotFluxoTemplate','RagnabotFluxoWebhookSegredo'];
console.log('=== CONTAGEM POR TABELA (20) ===');
for (const t of tabelas) {
  const r = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`);
  console.log(String(r[0].n).padStart(4), t);
}
console.log('\n=== ÍNDICE ÚNICO PARCIAL ===');
console.log((await prisma.$queryRawUnsafe(
  `SELECT indexdef FROM pg_indexes WHERE indexname='rb_exec_uma_viva_por_conversa'`))[0]?.indexdef ?? 'AUSENTE');
console.log('\n=== GATILHO DE IMUTABILIDADE ===');
console.log(await prisma.$queryRawUnsafe(
  `SELECT tgname, tgenabled::text FROM pg_trigger WHERE tgname='rb_versao_imutavel'`));
console.log('\n=== GRANTS EM RagnabotFluxoVersao (UPDATE deve ter sumido) ===');
console.log((await prisma.$queryRawUnsafe(
  `SELECT privilege_type FROM information_schema.role_table_grants
   WHERE table_name='RagnabotFluxoVersao' AND grantee='ragnatela_app' ORDER BY 1`)).map(r=>r.privilege_type).join(', '));
console.log('\n=== FKs COMPOSTAS ===');
console.log(await prisma.$queryRawUnsafe(
  `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN
   ('rb_no_versao_fk','rb_aresta_versao_fk','rb_exec_versao_fk') ORDER BY conname`));
await prisma.$disconnect();
