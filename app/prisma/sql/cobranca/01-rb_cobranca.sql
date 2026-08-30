-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- COBRANCA — planos, assinaturas, pagamentos e o diario de eventos do provedor.
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
CREATE TABLE "RagnabotPlano" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "precoCentavos" INTEGER,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "cicloMeses" INTEGER NOT NULL DEFAULT 1,
    "limiteAgentes" INTEGER,
    "limiteCaixas" INTEGER,
    "limiteMensagensMes" INTEGER,
    "recursos" JSONB NOT NULL DEFAULT '[]',
    "codigoCapacidade" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "publico" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "idExterno" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotPlano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotAssinatura" (
    "id" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "tenantId" TEXT,
    "contaChatwootId" INTEGER,
    "rotuloConta" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'teste',
    "cicloMeses" INTEGER NOT NULL DEFAULT 1,
    "valorCentavos" INTEGER,
    "diaVencimento" INTEGER NOT NULL DEFAULT 10,
    "inicioEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fimTesteEm" TIMESTAMP(3),
    "proximoVencimento" TIMESTAMP(3),
    "ultimoPagamentoEm" TIMESTAMP(3),
    "inadimplenteDesde" TIMESTAMP(3),
    "suspensaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "diasCarencia" INTEGER NOT NULL DEFAULT 5,
    "diasParaSuspender" INTEGER NOT NULL DEFAULT 10,
    "meioPreferido" TEXT NOT NULL DEFAULT 'pix',
    "adaptador" TEXT NOT NULL DEFAULT 'manual',
    "idExterno" TEXT,
    "idExternoPlano" TEXT,
    "emailCobranca" TEXT,
    "documentoCobranca" TEXT,
    "contatoNome" TEXT,
    "contatoTelefone" TEXT,
    "contaLiberada" BOOLEAN NOT NULL DEFAULT true,
    "aplicadoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "metadados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotAssinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotPagamento" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "meio" TEXT NOT NULL DEFAULT 'manual',
    "vencimentoEm" TIMESTAMP(3) NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "valorPagoCentavos" INTEGER,
    "idExterno" TEXT,
    "idExternoAssinatura" TEXT,
    "linkPagamento" TEXT,
    "linhaDigitavel" TEXT,
    "pixCopiaECola" TEXT,
    "observacao" TEXT,
    "baixadoPorUserId" TEXT,
    "payload" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotEventoCobranca" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "tipo" TEXT,
    "assinaturaId" TEXT,
    "pagamentoId" TEXT,
    "statusExterno" TEXT,
    "resultado" TEXT,
    "erro" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotEventoCobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotPlano_codigo_key" ON "RagnabotPlano"("codigo");

-- CreateIndex
CREATE INDEX "RagnabotPlano_ativo_ordem_idx" ON "RagnabotPlano"("ativo", "ordem");

-- CreateIndex
CREATE INDEX "RagnabotAssinatura_status_proximoVencimento_idx" ON "RagnabotAssinatura"("status", "proximoVencimento");

-- CreateIndex
CREATE INDEX "RagnabotAssinatura_clientCompanyId_idx" ON "RagnabotAssinatura"("clientCompanyId");

-- CreateIndex
CREATE INDEX "RagnabotAssinatura_tenantId_idx" ON "RagnabotAssinatura"("tenantId");

-- CreateIndex
CREATE INDEX "RagnabotAssinatura_contaChatwootId_idx" ON "RagnabotAssinatura"("contaChatwootId");

-- CreateIndex
CREATE INDEX "RagnabotAssinatura_idExterno_idx" ON "RagnabotAssinatura"("idExterno");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotPagamento_idExterno_key" ON "RagnabotPagamento"("idExterno");

-- CreateIndex
CREATE INDEX "RagnabotPagamento_status_vencimentoEm_idx" ON "RagnabotPagamento"("status", "vencimentoEm");

-- CreateIndex
CREATE INDEX "RagnabotPagamento_assinaturaId_vencimentoEm_idx" ON "RagnabotPagamento"("assinaturaId", "vencimentoEm");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotPagamento_assinaturaId_competencia_key" ON "RagnabotPagamento"("assinaturaId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotEventoCobranca_chaveIdempotencia_key" ON "RagnabotEventoCobranca"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "RagnabotEventoCobranca_origem_recebidoEm_idx" ON "RagnabotEventoCobranca"("origem", "recebidoEm");

-- CreateIndex
CREATE INDEX "RagnabotEventoCobranca_assinaturaId_idx" ON "RagnabotEventoCobranca"("assinaturaId");

-- AddForeignKey
ALTER TABLE "RagnabotAssinatura" ADD CONSTRAINT "RagnabotAssinatura_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "RagnabotPlano"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagnabotPagamento" ADD CONSTRAINT "RagnabotPagamento_assinaturaId_fkey" FOREIGN KEY ("assinaturaId") REFERENCES "RagnabotAssinatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
