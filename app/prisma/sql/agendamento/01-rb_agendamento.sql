-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AGENDAMENTO DE MENSAGENS — estrutura base (3 tabelas)  ·  contrato S4 (doc 34 §F4)
--
-- POR QUE ESTE ARQUIVO EXISTE: a casa NÃO roda `prisma migrate dev` neste repositório, e o
-- `schema.prisma` sozinho não reconstrói o banco. Sem este SQL versionado, recriar do zero
-- (RECUPERACAO-DO-ZERO.md) deixaria as três tabelas de fora e a tela de Agendamentos responderia
-- 503 — que é como uma funcionalidade "pronta" some num restore.
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`, em
-- `prisma/sql/motor-fluxo/04-rb_fk_compostas.sql`). São a tranca de BANCO contra juntar dado de
-- empresas diferentes, e os dois comandos as apagam EM SILÊNCIO.
-- Caminho usado para gerar ESTE arquivo:
--   1. `prisma migrate diff --from-empty --to-schema-datamodel <schema só com os 3 modelos novos>
--       --script`  (o `--from-empty` evita que o diff enxergue o resto do banco e proponha DROPs)
--   2. conferir `grep -ci drop` no resultado  →  **0**, medido em 02/09/2026
--   3. `prisma db execute --file prisma/sql/agendamento/01-rb_agendamento.sql`
--   4. logo depois, `node prisma/sql/motor-fluxo/verificar-estrutura.mjs` e
--      `verificar-comportamento.mjs` — para PROVAR que as 3 FKs compostas continuam vivas
--
-- ⚠️ O CLIENTE PRISMA NOVO SÓ VALE NO PROCESSO APÓS REINÍCIO. A tabela existir no banco não basta:
-- o cliente é carregado no arranque. Por isso as rotas têm guarda de modelo e respondem 503 com o
-- motivo escrito, em vez de estourar um TypeError cru.
--
-- ── O QUE AS TRÊS TABELAS GUARDAM ───────────────────────────────────────────────────────────────
--   RagnabotAgendamento          O QUE mandar, QUANDO, com que RECORRÊNCIA e por qual CONEXÃO.
--                                `proximaEm` é o carimbo da ocorrência corrente — a verdade do
--                                relógio, no mesmo desenho de `RagnabotAtendRelogio`.
--   RagnabotAgendamentoDestino   PARA QUEM. N linhas por agendamento (multi-contato, F4.3).
--                                O único (agendamentoId, contatoChave) impede o mesmo contato
--                                entrar duas vezes e receber a mensagem em dobro.
--   RagnabotAgendamentoEnvio     O QUE ACONTECEU, por destinatário e por ocorrência.
--
-- ⚠️ `RagnabotAgendamentoEnvio_chave_key` É A TRANCA DE "NÃO DISPARA DUAS VEZES".
--   A chave é sha256(agendamentoId|destinoId|ocorrenciaISO|tentativaManual) e o disparo começa por
--   um `INSERT … ON CONFLICT ("chave") DO NOTHING`: quem inseriu manda, quem colidiu NÃO manda.
--   Não é um `if` em memória — é o Postgres recusando. Por isso vale entre réplicas do Kubernetes e
--   sobrevive a reinício de pod no meio do disparo. Este índice é ÚNICO e NÃO é parcial: apagá-lo
--   ou torná-lo comum transforma a idempotência em decoração e o cliente recebe a mensagem duas
--   vezes. É a lição do alerta de backup que mandou 210 mensagens.
--
-- SEM CHAVE ESTRANGEIRA entre as três tabelas nem para `RagnabotTenant`: `tenantId`,
-- `agendamentoId` e `destinoId` são chaves LÓGICAS, no mesmo estilo de todos os modelos
-- `RagnabotAtend*`, do motor de fluxo e das respostas rápidas. Duas consequências declaradas:
--   (a) apagar um agendamento NÃO apaga os envios — e é assim que se quer: o que JÁ disparou fica
--       no histórico. Por isso o serviço CANCELA e nunca apaga;
--   (b) a limpeza é do código, não do Postgres.
-- Uma FK aqui também custaria caro do outro lado: `prisma migrate diff --from-schema-datasource`
-- passaria a propor DROP dela em toda migração futura, que é a armadilha da LEI 2.
--
-- Gerado e conferido em: 02/09/2026 · Prova: `tests/ragnabot-agendamento-worker.test.mjs`
-- (idempotência entre réplicas, reinício no meio do disparo, multi-contato independente, fora da
-- janela, cancelado, canal fora e virada do dia no fuso).
-- ⛔ AINDA NÃO APLICADO em nenhum banco — é decisão do chefe (lote).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotAgendamento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "cwAccountId" INTEGER NOT NULL,
    "cwInboxId" INTEGER NOT NULL,
    "caixaNome" TEXT,
    "canal" TEXT,
    "cwTeamId" INTEGER,
    "setorNome" TEXT,
    "mensagem" TEXT NOT NULL,
    "anexoUrl" TEXT,
    "anexoNome" TEXT,
    "anexoTipo" TEXT,
    "usarTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateNome" TEXT,
    "templateIdioma" TEXT DEFAULT 'pt_BR',
    "templateParametros" JSONB,
    "abrirTicket" BOOLEAN NOT NULL DEFAULT true,
    "fuso" TEXT NOT NULL DEFAULT 'America/Fortaleza',
    "recorrencia" TEXT NOT NULL DEFAULT 'unica',
    "intervalo" INTEGER NOT NULL DEFAULT 1,
    "diasSemana" TEXT,
    "minutoLocal" INTEGER NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "ateEm" TIMESTAMP(3),
    "maxOcorrencias" INTEGER,
    "proximaEm" TIMESTAMP(3),
    "ultimaOcorrenciaEm" TIMESTAMP(3),
    "ocorrenciasFeitas" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "donoWorker" TEXT,
    "travadoEm" TIMESTAMP(3),
    "criadoPorUserId" TEXT,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAgendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAgendamentoDestino" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwContactId" INTEGER,
    "contatoChave" TEXT NOT NULL,
    "contatoNome" TEXT,
    "cwConversationId" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAgendamentoDestino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAgendamentoEnvio" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "ocorrenciaEm" TIMESTAMP(3) NOT NULL,
    "tentativaManual" INTEGER NOT NULL DEFAULT 0,
    "chave" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reservado',
    "motivo" TEXT,
    "erro" TEXT,
    "idExterno" TEXT,
    "degradado" TEXT,
    "cwConversationId" INTEGER,
    "conversaCriada" BOOLEAN NOT NULL DEFAULT false,
    "ticketAberto" BOOLEAN NOT NULL DEFAULT false,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "donoWorker" TEXT,
    "reservadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotAgendamentoEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotAgendamento_status_proximaEm_idx" ON "RagnabotAgendamento"("status", "proximaEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamento_tenantId_status_proximaEm_idx" ON "RagnabotAgendamento"("tenantId", "status", "proximaEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamento_tenantId_cwInboxId_idx" ON "RagnabotAgendamento"("tenantId", "cwInboxId");

-- CreateIndex
CREATE INDEX "RagnabotAgendamento_status_travadoEm_idx" ON "RagnabotAgendamento"("status", "travadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoDestino_tenantId_contatoChave_idx" ON "RagnabotAgendamentoDestino"("tenantId", "contatoChave");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoDestino_agendamentoId_ativo_idx" ON "RagnabotAgendamentoDestino"("agendamentoId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAgendamentoDestino_agendamentoId_contatoChave_key" ON "RagnabotAgendamentoDestino"("agendamentoId", "contatoChave");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAgendamentoEnvio_chave_key" ON "RagnabotAgendamentoEnvio"("chave");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoEnvio_status_proximaTentativaEm_idx" ON "RagnabotAgendamentoEnvio"("status", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoEnvio_agendamentoId_ocorrenciaEm_idx" ON "RagnabotAgendamentoEnvio"("agendamentoId", "ocorrenciaEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoEnvio_tenantId_status_reservadoEm_idx" ON "RagnabotAgendamentoEnvio"("tenantId", "status", "reservadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAgendamentoEnvio_destinoId_ocorrenciaEm_idx" ON "RagnabotAgendamentoEnvio"("destinoId", "ocorrenciaEm");

