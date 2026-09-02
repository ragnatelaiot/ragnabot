-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CAIXA DE ATENDIMENTO — ISOLAMENTO POR AGENTE E POR SETOR (contrato S2, 02/09/2026)
--
-- Cria as TRÊS tabelas do isolamento:
--   RagnabotSetor        — espelho do time da plataforma (nome do setor, para a etiqueta e o filtro)
--   RagnabotAgenteSetor  — de que setores cada atendente é membro. É esta tabela que decide quem vê
--                          a conversa que está na FILA, sem atendente nenhum. Sem linha aqui, o
--                          agente NÃO vê fila — falha fechada, de propósito.
--   RagnabotConversa     — o índice de roteamento das conversas (caixa · setor · atendente ·
--                          estado · contato · tempos). SEM NENHUM TEXTO DE MENSAGEM.
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO (LEI 2 da casa).
-- Este arquivo foi gerado pelo caminho certo, e OFFLINE — o banco `ragnabot` vive dentro do
-- cluster e não é alcançável da máquina de trabalho:
--   1. cópia do schema ANTES da edição;
--   2. `prisma migrate diff --from-schema-datamodel <antes> --to-schema-datamodel <depois> --script`
--      (o `--from-schema-datasource` do procedimento padrão exige o banco de pé; o `datamodel`
--      compara dois ARQUIVOS e chega ao mesmo resultado sem tocar em nada);
--   3. conferido que o resultado tem ZERO `DROP` (medido: 0 ocorrências de "drop", sem distinção de
--      caixa) — nenhuma das 3 chaves estrangeiras compostas é ameaçada por este arquivo;
--   4. aplicar com `npx prisma db execute --file prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql`.
--
-- ORDEM: pode ser aplicado a qualquer momento depois de `saas/01-rb_saas_multiempresa.sql`. Não há
-- chave estrangeira de banco para nenhuma outra tabela — `tenantId`, `cwInboxId` e `cwTeamId` são
-- chaves LÓGICAS, no mesmo estilo já usado em `RagnabotAtend*` e no motor de fluxo.
--
-- ⚠️ DEPOIS DE APLICAR: o cliente Prisma é carregado no arranque do processo. A tabela existir no
-- banco NÃO basta — o serviço precisa ser reiniciado para enxergá-la (e reinício é decisão do
-- chefe, só sem sessão ativa). Enquanto isso, as rotas da caixa respondem 503 com
-- `code: MODELO_AUSENTE`, em vez de 500 sem pista.
--
-- Gerado em: 02/09/2026 · APLICADO em 02/09/2026 no LÍDER MEDIDO NA HORA — `pg133`
-- (172.17.20.133, hostname `rgtpstgsql002`), confirmado por `SELECT NOT pg_is_in_recovery()` = t
-- ANTES de escrever. Transação única, `ON_ERROR_STOP=1`, `SET ROLE ragnabot_app` (as 40 tabelas
-- existentes são desse dono; aplicar como `postgres` deixaria as 3 novas com dono diferente).
-- Resultado medido: 3 tabelas + 15 índices (12 daqui + 3 chaves primárias), base de 40 para 43
-- tabelas, as 3 chaves estrangeiras compostas (`rb_no/rb_aresta/rb_exec_versao_fk`) de pé, e a
-- réplica `pg132` com as 3 tabelas e os 15 índices, lag 0.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotSetor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwTeamId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "sincronizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotSetor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAgenteSetor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwUserId" INTEGER NOT NULL,
    "cwTeamId" INTEGER NOT NULL,
    "agenteNome" TEXT,
    "agenteEmail" TEXT,
    "sincronizadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAgenteSetor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotConversa" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwConversationId" INTEGER NOT NULL,
    "cwInboxId" INTEGER,
    "caixaNome" TEXT,
    "canal" TEXT,
    "cwTeamId" INTEGER,
    "setorNome" TEXT,
    "cwAssigneeId" INTEGER,
    "atendenteNome" TEXT,
    "estado" TEXT NOT NULL,
    "estadoPlataforma" TEXT,
    "comRobo" BOOLEAN NOT NULL DEFAULT false,
    "ehGrupo" BOOLEAN NOT NULL DEFAULT false,
    "cwContactId" INTEGER,
    "contatoNome" TEXT,
    "contatoChave" TEXT,
    "protocolo" TEXT,
    "abertaEm" TIMESTAMP(3) NOT NULL,
    "ultimaAtividadeEm" TIMESTAMP(3),
    "resolvidaEm" TIMESTAMP(3),
    "resolvidaPorCwUserId" INTEGER,
    "resolvidaPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotConversa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotSetor_tenantId_ativo_idx" ON "RagnabotSetor"("tenantId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotSetor_cwAccountId_cwTeamId_key" ON "RagnabotSetor"("cwAccountId", "cwTeamId");

-- CreateIndex
CREATE INDEX "RagnabotAgenteSetor_tenantId_cwUserId_idx" ON "RagnabotAgenteSetor"("tenantId", "cwUserId");

-- CreateIndex
CREATE INDEX "RagnabotAgenteSetor_cwAccountId_cwTeamId_idx" ON "RagnabotAgenteSetor"("cwAccountId", "cwTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotAgenteSetor_cwAccountId_cwUserId_cwTeamId_key" ON "RagnabotAgenteSetor"("cwAccountId", "cwUserId", "cwTeamId");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_estado_ultimaAtividadeEm_idx" ON "RagnabotConversa"("tenantId", "estado", "ultimaAtividadeEm");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_estado_resolvidaEm_idx" ON "RagnabotConversa"("tenantId", "estado", "resolvidaEm");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_cwAssigneeId_estado_idx" ON "RagnabotConversa"("tenantId", "cwAssigneeId", "estado");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_resolvidaPorCwUserId_resolvidaEm_idx" ON "RagnabotConversa"("tenantId", "resolvidaPorCwUserId", "resolvidaEm");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_cwTeamId_estado_idx" ON "RagnabotConversa"("tenantId", "cwTeamId", "estado");

-- CreateIndex
CREATE INDEX "RagnabotConversa_tenantId_cwTeamId_contatoChave_abertaEm_idx" ON "RagnabotConversa"("tenantId", "cwTeamId", "contatoChave", "abertaEm");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotConversa_cwAccountId_cwConversationId_key" ON "RagnabotConversa"("cwAccountId", "cwConversationId");

