-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PORTARIA — quem tem permissao de falar com o bot, e o registro de todo contato barrado.
-- DEPENDE de saas/01 (RagnabotOrigemAutorizada tem FK para RagnabotTenant).
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
CREATE TABLE "RagnabotOrigemAutorizada" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "ativo" TEXT,
    "observacao" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotOrigemAutorizada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotContatoRecusado" (
    "id" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "assunto" TEXT,
    "resumo" TEXT,
    "resolvido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotContatoRecusado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagnabotOrigemAutorizada_tenantId_idx" ON "RagnabotOrigemAutorizada"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotOrigemAutorizada_tipo_valor_key" ON "RagnabotOrigemAutorizada"("tipo", "valor");

-- CreateIndex
CREATE INDEX "RagnabotContatoRecusado_canal_criadoEm_idx" ON "RagnabotContatoRecusado"("canal", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotContatoRecusado_resolvido_idx" ON "RagnabotContatoRecusado"("resolvido");

-- AddForeignKey
ALTER TABLE "RagnabotOrigemAutorizada" ADD CONSTRAINT "RagnabotOrigemAutorizada_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "RagnabotTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
