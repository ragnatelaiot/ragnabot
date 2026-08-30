-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO 4 — AS FKs COMPOSTAS QUE IMPEDEM JUNÇÃO CRUZADA ENTRE EMPRESAS
--
-- Apontam para "RagnabotFluxoVersao"("tenantId","id") — o @@unique([tenantId, id]) do schema
-- existe para ser o alvo destas três restrições, e não por necessidade de consulta.
--
-- O caso concreto que elas recusam: um sub-fluxo apontando para versão de OUTRA empresa. Mesmo
-- que o código erre o filtro de tenant — que é exatamente como o sistema antigo vazou dados —,
-- o BANCO recusa a linha.
--
-- Execução usa RESTRICT, não CASCADE: versão NUNCA é apagada, e o RESTRICT é a segunda tranca
-- dessa regra. Apagar uma versão órfã telemetria e auditoria de uma vez só.
--
-- ⚠️ O Prisma NÃO expressa FK composta para uma chave que não é a primária. `prisma db push`
-- apaga as três EM SILÊNCIO.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "RagnabotFluxoNo" DROP CONSTRAINT IF EXISTS rb_no_versao_fk;
ALTER TABLE "RagnabotFluxoNo" ADD CONSTRAINT rb_no_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES "RagnabotFluxoVersao"("tenantId","id")
  ON DELETE CASCADE;

ALTER TABLE "RagnabotFluxoAresta" DROP CONSTRAINT IF EXISTS rb_aresta_versao_fk;
ALTER TABLE "RagnabotFluxoAresta" ADD CONSTRAINT rb_aresta_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES "RagnabotFluxoVersao"("tenantId","id")
  ON DELETE CASCADE;

ALTER TABLE "RagnabotFluxoExecucao" DROP CONSTRAINT IF EXISTS rb_exec_versao_fk;
ALTER TABLE "RagnabotFluxoExecucao" ADD CONSTRAINT rb_exec_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES "RagnabotFluxoVersao"("tenantId","id")
  ON DELETE RESTRICT;
