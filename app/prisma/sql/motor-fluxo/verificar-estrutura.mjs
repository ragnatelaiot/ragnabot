import prisma from '/ia/netagent/src/database/client.js';
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
