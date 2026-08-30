-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- RESPOSTAS RÁPIDAS DO RAGNABOT — estrutura base (1 tabela)  ·  C9
--
-- POR QUE ESTE ARQUIVO EXISTE: a casa NÃO roda `prisma migrate dev` neste repositório, então o
-- `schema.prisma` sozinho não reconstrói o banco. Sem este SQL versionado, recriar do zero
-- (RECUPERACAO-DO-ZERO.md) deixaria a tabela de fora e a tela de Respostas rápidas responderia 503.
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`, em
-- `prisma/sql/motor-fluxo/04-rb_fk_compostas.sql`). São a tranca de BANCO contra juntar nó de um
-- fluxo com versão de OUTRA empresa, e os dois comandos as apagam EM SILÊNCIO.
-- O caminho correto — o que foi usado aqui:
--   1. `npx prisma migrate diff --from-schema-datasource --to-schema-datamodel --script`
--   2. RECORTAR à mão todo `DROP` do resultado  ← o diff desta migração veio com exatamente os
--      3 `ALTER TABLE … DROP CONSTRAINT rb_*_versao_fk` no topo. Foram recortados. Se um dia este
--      arquivo tiver um DROP, alguém colou o diff cru sem ler.
--   3. conferir que sobrou só CREATE TABLE / CREATE INDEX
--   4. `npx prisma db execute --file <arquivo>`
--
-- O QUE A TABELA GUARDA
--   Frases que a equipe repete o dia inteiro ("bom dia", "prazo de entrega", "segunda via do
--   boleto"), acionadas por um ATALHO que o atendente digita na caixa de resposta (`/bomdia`).
--   O texto pode conter VARIÁVEIS ({{contactFirstName}}, {{protocolo}}, {{ticket_id}}…) trocadas
--   na hora da inserção pelo serviço `ragnabot-respostas-rapidas.service.js`.
--
-- ⚠️ POR QUE EXISTE A COLUNA CALCULADA `chaveAtalho` (a parte que morde)
--   O índice único natural seria (tenantId, atalho, cwInboxId, cwTeamId, visibilidade, userId).
--   Quatro dessas colunas são ANULÁVEIS, e no PostgreSQL NULO ≠ NULO — logo o índice deixaria
--   cadastrar `/bomdia` dez vezes na mesma empresa sem UMA violação, e o atendente veria dez
--   sugestões idênticas sem entender por quê. `chaveAtalho` materializa escopo + dono + atalho numa
--   string NOT NULL comparável ("bomdia|geral|empresa", "bomdia|caixa:42|u:<uuid>"), e o único
--   passa a valer de verdade. Mesma lição já registrada em `RagnabotAtendPolitica.escopoChave` e
--   em `RagnabotFluxoEntrada.chave`.
--
-- SEM CHAVE ESTRANGEIRA para `RagnabotTenant`/`User`: `tenantId`, `userId` e `criadoPorUserId` são
-- chaves LÓGICAS, no mesmo estilo dos modelos `RagnabotAtend*` e do motor de fluxo. Consequência
-- prática: apagar uma empresa NÃO apaga as respostas dela — a limpeza é do código do serviço.
--
-- Aplicado em: 29/08/2026 · Prova: `tests/ragnabot-respostas-rapidas.test.mjs` (CRUD, atalho
-- duplicado recusado com P2002, isolamento entre empresas e expansão de variáveis) e as 3 FKs
-- compostas conferidas VIVAS antes e depois da execução.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotRespostaRapida" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "atalho" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "cwInboxId" INTEGER,
    "cwTeamId" INTEGER,
    "visibilidade" TEXT NOT NULL DEFAULT 'empresa',
    "userId" TEXT,
    "chaveAtalho" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotRespostaRapida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotRespostaRapida_tenantId_ativa_atalho_idx" ON "RagnabotRespostaRapida"("tenantId", "ativa", "atalho");

-- CreateIndex
CREATE INDEX "RagnabotRespostaRapida_tenantId_visibilidade_userId_idx" ON "RagnabotRespostaRapida"("tenantId", "visibilidade", "userId");

-- CreateIndex
CREATE INDEX "RagnabotRespostaRapida_tenantId_cwInboxId_idx" ON "RagnabotRespostaRapida"("tenantId", "cwInboxId");

-- CreateIndex
CREATE INDEX "RagnabotRespostaRapida_tenantId_cwTeamId_idx" ON "RagnabotRespostaRapida"("tenantId", "cwTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotRespostaRapida_tenantId_chaveAtalho_key" ON "RagnabotRespostaRapida"("tenantId", "chaveAtalho");
