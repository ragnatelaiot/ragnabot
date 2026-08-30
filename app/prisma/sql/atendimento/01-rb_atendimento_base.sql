-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AUTOMAÇÕES DE ATENDIMENTO DO RAGNABOT — estrutura base (6 tabelas)
--
-- POR QUE ESTE ARQUIVO EXISTE: a estrutura foi aplicada no banco de produção em 29/08/2026 por
-- `prisma db execute`, e o SQL ficou só num diretório temporário. Sem ele versionado, recriar o
-- banco do zero (RECUPERACAO-DO-ZERO.md) NÃO reproduz estas 6 tabelas — o schema.prisma sozinho
-- não basta, porque a casa NÃO roda `prisma migrate dev` aqui (ver aviso abaixo).
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (rb_no_versao_fk, rb_aresta_versao_fk, rb_exec_versao_fk, em 04-rb_fk_compostas.sql). Elas são
-- a tranca de banco contra juntar nó de um fluxo com versão de OUTRA empresa. Qualquer um desses
-- dois comandos as APAGA EM SILÊNCIO. O caminho correto é o que foi usado aqui:
--   1. `npx prisma migrate diff --from-schema-datasource --to-schema-datamodel --script`
--   2. RECORTAR à mão todo `DROP CONSTRAINT` do resultado
--   3. conferir que sobrou só CREATE TABLE / CREATE INDEX
--   4. `npx prisma db execute --file <arquivo>`
--
-- O QUE CADA TABELA GUARDA:
--   RagnabotAtendPolitica     — a configuração em si (inatividade, transbordo, expediente).
--                               Vale por empresa, por caixa ou por time; `escopoChave` é campo
--                               CALCULADO porque no Postgres dois NULL não são iguais entre si, e
--                               sem ele o índice único deixaria cadastrar a mesma política duas vezes.
--   RagnabotAtendExpediente   — as janelas de atendimento (dia da semana + hora de início/fim).
--                               Várias linhas por dia é o que permite INTERVALO de almoço — o que o
--                               Chatwoot de origem não consegue fazer (lá é uma janela por dia).
--   RagnabotAtendExcecaoData  — feriados e datas especiais; `*-12-25` é o feriado que se repete todo ano.
--   RagnabotAtendTurno        — expediente por atendente. ⚠️ Tabela criada, código NÃO escrito de
--                               propósito: falta medir se os 77 usuários da origem realmente usam
--                               os campos de turno ou se estão todos em 00:00–00:00 (medição presa
--                               na VM 10016, cujo agente convidado está parado desde 29/08).
--   RagnabotAtendRelogio      — um relógio armado por conversa: quando vence e o que fazer no
--                               vencimento. Congela fora do expediente.
--   RagnabotAtendTransferencia— o histórico de quem passou a conversa para quem, e por quê.
--
-- SEM CHAVE ESTRANGEIRA entre Expediente/ExcecaoData e Politica de propósito (`politicaId` é chave
-- lógica, no mesmo estilo do motor de fluxo). Consequência prática: apagar uma política NÃO apaga
-- as janelas e feriados dela — a limpeza em cascata é responsabilidade do código do serviço.
--
-- Aplicado em: 29/08/2026 · Prova: as 6 tabelas respondem count()=0 pelo cliente Prisma, a chave
-- única foi exercitada (2ª política idêntica recusada com P2002) e as 3 FKs compostas seguem vivas.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotAtendPolitica" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "escopo" TEXT NOT NULL,
    "cwInboxId" INTEGER,
    "cwTeamId" INTEGER,
    "escopoChave" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "fuso" TEXT NOT NULL DEFAULT 'America/Fortaleza',
    "inatividadeAtiva" BOOLEAN NOT NULL DEFAULT false,
    "inatividadeMinutos" INTEGER,
    "inatividadeConta" TEXT,
    "inatividadeAcao" TEXT,
    "inatividadeTimeDestino" INTEGER,
    "inatividadeMensagem" TEXT,
    "inatividadeAvisoMinutos" INTEGER,
    "inatividadeAvisoMensagem" TEXT,
    "inatividadeContaForaExpediente" BOOLEAN NOT NULL DEFAULT false,
    "transbordoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "transbordoMinutos" INTEGER,
    "transbordoTimeId" INTEGER,
    "transbordoMensagem" TEXT,
    "fluxoPrimeiroContatoId" TEXT,
    "fluxoPadraoId" TEXT,
    "fluxoForaExpedienteId" TEXT,
    "reiniciaFluxoAposHoras" INTEGER NOT NULL DEFAULT 24,
    "msgSaudacao" TEXT,
    "msgForaExpediente" TEXT,
    "msgIntervalo" TEXT,
    "msgFeriado" TEXT,
    "msgTransferenciaTime" TEXT,
    "msgTransferenciaAgente" TEXT,
    "msgAtendenteIndisponivel" TEXT,
    "msgDespedidaEspera" TEXT,
    "encerrarAposForaExpediente" BOOLEAN NOT NULL DEFAULT false,
    "distribuicaoPausada" BOOLEAN NOT NULL DEFAULT false,
    "pausadaAte" TIMESTAMP(3),
    "pausadaMotivo" TEXT,
    "pausadaPorUserId" TEXT,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "criadoPorUserId" TEXT,
    "atualizadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAtendPolitica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAtendExpediente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "politicaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "abreMin" INTEGER NOT NULL,
    "fechaMin" INTEGER NOT NULL,
    "rotulo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAtendExpediente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAtendExcecaoData" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "politicaId" TEXT NOT NULL,
    "chaveData" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "abreMin" INTEGER,
    "fechaMin" INTEGER,
    "rotulo" TEXT NOT NULL,
    "mensagem" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotAtendExcecaoData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAtendTurno" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwUserId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "abreMin" INTEGER NOT NULL,
    "fechaMin" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotAtendTurno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAtendRelogio" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwConversationId" INTEGER NOT NULL,
    "politicaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ultimaAtividadeEm" TIMESTAMP(3) NOT NULL,
    "ultimaAtividadeLado" TEXT NOT NULL,
    "venceEm" TIMESTAMP(3) NOT NULL,
    "pausadoMotivo" TEXT,
    "disparadoEm" TIMESTAMP(3),
    "resultado" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAtendRelogio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAtendTransferencia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwConversationId" INTEGER NOT NULL,
    "protocolo" TEXT,
    "deTipo" TEXT NOT NULL,
    "deId" INTEGER,
    "deNome" TEXT,
    "paraTipo" TEXT NOT NULL,
    "paraId" INTEGER,
    "paraNome" TEXT,
    "motivo" TEXT,
    "notaInterna" TEXT,
    "origem" TEXT NOT NULL,
    "atorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotAtendTransferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotAtendPolitica_tenantId_ativa_idx" ON "RagnabotAtendPolitica"("tenantId", "ativa");

-- CreateIndex
CREATE INDEX "RagnabotAtendPolitica_cwAccountId_cwInboxId_idx" ON "RagnabotAtendPolitica"("cwAccountId", "cwInboxId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAtendPolitica_tenantId_escopoChave_key" ON "RagnabotAtendPolitica"("tenantId", "escopoChave");

-- CreateIndex
CREATE INDEX "RagnabotAtendExpediente_politicaId_diaSemana_abreMin_idx" ON "RagnabotAtendExpediente"("politicaId", "diaSemana", "abreMin");

-- CreateIndex
CREATE INDEX "RagnabotAtendExpediente_tenantId_idx" ON "RagnabotAtendExpediente"("tenantId");

-- CreateIndex
CREATE INDEX "RagnabotAtendExcecaoData_tenantId_idx" ON "RagnabotAtendExcecaoData"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAtendExcecaoData_politicaId_chaveData_key" ON "RagnabotAtendExcecaoData"("politicaId", "chaveData");

-- CreateIndex
CREATE INDEX "RagnabotAtendTurno_tenantId_cwUserId_diaSemana_idx" ON "RagnabotAtendTurno"("tenantId", "cwUserId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAtendRelogio_chave_key" ON "RagnabotAtendRelogio"("chave");

-- CreateIndex
CREATE INDEX "RagnabotAtendRelogio_venceEm_disparadoEm_idx" ON "RagnabotAtendRelogio"("venceEm", "disparadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAtendRelogio_cwAccountId_cwConversationId_idx" ON "RagnabotAtendRelogio"("cwAccountId", "cwConversationId");

-- CreateIndex
CREATE INDEX "RagnabotAtendRelogio_tenantId_tipo_idx" ON "RagnabotAtendRelogio"("tenantId", "tipo");

-- CreateIndex
CREATE INDEX "RagnabotAtendTransferencia_tenantId_criadoEm_idx" ON "RagnabotAtendTransferencia"("tenantId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAtendTransferencia_cwAccountId_cwConversationId_cri_idx" ON "RagnabotAtendTransferencia"("cwAccountId", "cwConversationId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAtendTransferencia_tenantId_paraTipo_paraId_criadoE_idx" ON "RagnabotAtendTransferencia"("tenantId", "paraTipo", "paraId", "criadoEm");

