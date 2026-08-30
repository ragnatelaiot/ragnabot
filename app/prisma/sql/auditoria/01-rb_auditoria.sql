-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AUDITORIA DO RAGNABOT — o registro isolado por empresa de tudo que alguem faz.
--
-- Gerado por `prisma migrate diff --from-empty --to-schema-datamodel` a partir de
-- `prisma/schema.prisma` (Etapa 1 do doc 33) e conferido: ZERO comando DROP.
-- Estas tabelas nasceram no NOC sem SQL versionado; aqui elas passam a ter, porque a base
-- `ragnabot` sera criada do zero por estes arquivos — nunca por `prisma db push` (LEI 2).
--
-- Idempotencia: NAO ha `IF NOT EXISTS`. Rodar duas vezes falha, de proposito — aplicar em base
-- nova, e conferir o resultado, e mais seguro que um script que "passa" sem dizer o que fez.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotAuditoria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "atorTipo" TEXT NOT NULL,
    "atorId" TEXT,
    "atorNome" TEXT,
    "atorEmail" TEXT,
    "categoria" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "protocolo" TEXT,
    "entidade" TEXT,
    "entidadeId" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotAuditoria_tenantId_criadoEm_idx" ON "RagnabotAuditoria"("tenantId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAuditoria_tenantId_categoria_criadoEm_idx" ON "RagnabotAuditoria"("tenantId", "categoria", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAuditoria_tenantId_atorId_criadoEm_idx" ON "RagnabotAuditoria"("tenantId", "atorId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotAuditoria_tenantId_ip_idx" ON "RagnabotAuditoria"("tenantId", "ip");

-- CreateIndex
CREATE INDEX "RagnabotAuditoria_protocolo_idx" ON "RagnabotAuditoria"("protocolo");
