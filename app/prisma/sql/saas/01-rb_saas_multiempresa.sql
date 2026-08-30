-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- MULTIEMPRESA (SaaS) — a empresa cliente, suas caixas, os eventos do ciclo de vida e a foto de uso.
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
CREATE TABLE "RagnabotTenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactWhatsapp" TEXT,
    "cwAccountId" INTEGER,
    "cwAdminUserId" INTEGER,
    "plan" TEXT NOT NULL DEFAULT 'essencial',
    "status" TEXT NOT NULL DEFAULT 'trial',
    "limits" JSONB NOT NULL,
    "wabaId" TEXT,
    "brandLogoUrl" TEXT,
    "brandColor" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "dpaSignedAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotInbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwInboxId" INTEGER,
    "name" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "credentialFingerprint" TEXT,
    "metadata" JSONB,
    "activeKey" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotTenantEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotTenantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotUsageSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "agentsActive" INTEGER NOT NULL DEFAULT 0,
    "inboxes" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "messagesIn" INTEGER NOT NULL DEFAULT 0,
    "messagesOut" INTEGER NOT NULL DEFAULT 0,
    "storageMb" INTEGER,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotTenant_slug_key" ON "RagnabotTenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotTenant_contactEmail_key" ON "RagnabotTenant"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotTenant_cwAccountId_key" ON "RagnabotTenant"("cwAccountId");

-- CreateIndex
CREATE INDEX "RagnabotTenant_status_idx" ON "RagnabotTenant"("status");

-- CreateIndex
CREATE INDEX "RagnabotTenant_plan_idx" ON "RagnabotTenant"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotInbox_activeKey_key" ON "RagnabotInbox"("activeKey");

-- CreateIndex
CREATE INDEX "RagnabotInbox_tenantId_removedAt_idx" ON "RagnabotInbox"("tenantId", "removedAt");

-- CreateIndex
CREATE INDEX "RagnabotInbox_channelType_identifier_idx" ON "RagnabotInbox"("channelType", "identifier");

-- CreateIndex
CREATE INDEX "RagnabotTenantEvent_tenantId_createdAt_idx" ON "RagnabotTenantEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "RagnabotTenantEvent_type_idx" ON "RagnabotTenantEvent"("type");

-- CreateIndex
CREATE INDEX "RagnabotUsageSnapshot_tenantId_periodStart_idx" ON "RagnabotUsageSnapshot"("tenantId", "periodStart");

-- AddForeignKey
ALTER TABLE "RagnabotInbox" ADD CONSTRAINT "RagnabotInbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "RagnabotTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagnabotTenantEvent" ADD CONSTRAINT "RagnabotTenantEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "RagnabotTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagnabotUsageSnapshot" ADD CONSTRAINT "RagnabotUsageSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "RagnabotTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
