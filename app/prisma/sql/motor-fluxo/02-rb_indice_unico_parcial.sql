-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO 2 — UMA EXECUÇÃO VIVA POR CONVERSA
--
-- Os QUATRO estados abaixo são os ATIVOS. `pausado_humano` e `pausado_duvida` ficam DENTRO do
-- índice: senão uma mensagem nova do cliente abriria execução nova e ele receberia a saudação de
-- novo, no meio de um problema. `abandonado` e `concluido` ficam FORA, porque retomada legítima
-- (o cliente escreve de novo dias depois) precisa poder nascer.
--
-- ⚠️ PONTO DE FALHA SE O VOCABULÁRIO DE ESTADOS CRESCER: acrescentar um estado ativo novo sem
-- incluí-lo neste WHERE reabre a porta para DUAS execuções na mesma conversa — dois robôs falando
-- com a mesma pessoa — e o sintoma só aparece sob concorrência. O antídoto é o teste que lê a
-- constante ESTADOS_ATIVOS do código e a definição do índice em pg_indexes, e falha se divergirem.
-- É teste, não disciplina.
--
-- ⚠️ O Prisma NÃO expressa índice parcial. Um `prisma db push` apaga este índice EM SILÊNCIO.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "rb_exec_uma_viva_por_conversa"
  ON "RagnabotFluxoExecucao" ("cwAccountId", "cwConversationId")
  WHERE estado IN ('rodando','esperando','pausado_humano','pausado_duvida');
