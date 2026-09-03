-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- O INTERRUPTOR DO ROBÔ, POR CAIXA — contrato S-INTERRUPTOR, 03/09/2026
--
-- ORDEM DO DONO, nas palavras dele: «preciso eu mesmo ter o poder dessa decisão. No momento usar
-- apenas para o WhatsApp, mas a qualquer momento posso incluir outra caixa ou remover se quiser».
--
-- Até aqui, ligar o robô era mexer em `RAGNABOT_EXECUTOR_FLUXO` — variável de ambiente do
-- Kubernetes. Quem decidia era quem tinha acesso ao cluster, não o dono do atendimento.
--
-- ⚠️ PADRÃO `false`: falha fechada. Caixa nova NÃO começa a ser atendida por robô por omissão —
-- nascer ligada poria um robô a falar com cliente de verdade sem ninguém ter dito que sim.
--
-- ⚠️ NENHUM `DROP` NESTE ARQUIVO. LEI 2 da casa: `prisma db push` / `migrate dev` apagam em
-- silêncio as 3 chaves estrangeiras COMPOSTAS do motor. Este SQL foi escrito à mão a partir do
-- diff, com todo `DROP` recortado, e aplicado com `prisma db execute`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "RagnabotInbox"
  ADD COLUMN IF NOT EXISTS "roboAtende"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "roboAtendeEm"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "roboAtendePorUserId" TEXT;

COMMENT ON COLUMN "RagnabotInbox"."roboAtende" IS
  'O robô atende NESTA caixa. A chave global RAGNABOT_EXECUTOR_FLUXO é o TETO: desligada, nenhuma caixa atende.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- DUAS BOCAS NA MESMA CAIXA — a tranca no próprio banco
--
-- ── O QUE FOI MEDIDO (03/09/2026) ───────────────────────────────────────────────────────────────
-- `resolverEntrada()` escolhe o fluxo da caixa com `findFirst(...)` SEM `orderBy`. Com dois fluxos
-- publicados na mesma caixa, quem ganha é o que o Postgres devolver primeiro — indefinido, e podendo
-- mudar de uma consulta para a outra. O sintoma em produção não é erro: é «o robô respondeu o fluxo
-- errado», intermitente e sem rastro no log.
--
-- O `prisma/sql/00-LEIA-ME.md` já CITAVA este índice como parte do desenho («o índice único parcial
-- de fluxo publicado por caixa»), mas ele NÃO existia na base: conferido em 03/09/2026, a
-- `RagnabotFluxo` tinha 5 índices e nenhum era este. Documento que descreve guarda inexistente é
-- pior que documento nenhum, porque alguém confia nela.
--
-- Conferido antes de criar: ZERO grupos duplicados na base de produção.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS "rb_fluxo_uma_boca_por_caixa"
  ON "RagnabotFluxo" ("tenantId", "cwInboxId")
  WHERE entrada = 'caixa'
    AND estado = 'publicado'
    AND "versaoPublicadaId" IS NOT NULL
    AND "arquivadoEm" IS NULL;
