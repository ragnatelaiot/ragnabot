-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PAGAMENTO PIX (EFÍ BANK) — estrutura base (3 tabelas) · S-EFÍ / doc 36
--
-- POR QUE ESTE ARQUIVO EXISTE: a casa NÃO roda `prisma migrate dev` neste repositório (LEI 2).
-- Mesmo aviso do arquivo do Capitão: `db push`/`migrate dev` apagam EM SILÊNCIO as 3 chaves
-- estrangeiras COMPOSTAS do motor de fluxo. Caminho usado aqui:
--   1. `npx prisma migrate diff --from-empty --to-schema-datamodel <só os modelos novos> --script`
--   2. conferido: `grep -ci drop` devolveu 0
--   3. `npx prisma db execute --file <este arquivo>`
--
-- ⛔ AINDA NÃO APLICADO EM NENHUM BANCO (02/09/2026) — sem `DATABASE_URL` alcançável desta estação.
--
-- O QUE AS TABELAS GUARDAM
--   RagnabotPagamentoCredencial — credencial do provedor POR EMPRESA. Linha com `tenantId` NULO é
--                                 a conta da RAGNATELA (o padrão de hoje). `chaveEscopo` é NOT NULL
--                                 e é ela que o único tranca — `tenantId` é anulável, e no Postgres
--                                 dois NULOS não colidem (a "conta da casa" entraria dez vezes).
--   RagnabotCobrancaPix         — a cobrança imediata (`cob`) e o estado dela na conversa.
--                                 O `txid` é NOSSO: `PUT /v2/cob/:txid` torna a CRIAÇÃO idempotente.
--   RagnabotCobrancaPixEvento   — a trilha crua do webhook. `chaveIdempotencia` única é o que faz a
--                                 segunda entrega ser REGISTRADA e não aplicada.
--
-- ⛔ NENHUMA CREDENCIAL EM CLARO: `clientId`, `clientSecret`, senha do certificado e o HMAC do
--    webhook ficam CIFRADOS (aes-256-gcm, `src/base/crypto.js`). O certificado .p12 NÃO entra no
--    banco — fica em arquivo montado por Secret, e aqui guardamos só o CAMINHO.
--
-- SEM CHAVE ESTRANGEIRA para `RagnabotTenant`: `tenantId` é chave LÓGICA (mesmo estilo da casa).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "RagnabotPagamentoCredencial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "chaveEscopo" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'efi',
    "ambiente" TEXT NOT NULL DEFAULT 'homologacao',
    "clientIdCifrado" TEXT,
    "clientSecretCifrado" TEXT,
    "certificadoSenhaCifrada" TEXT,
    "webhookHmacCifrado" TEXT,
    "certificadoCaminho" TEXT,
    "chavePix" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoErro" TEXT,
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotPagamentoCredencial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotCobrancaPix" (
    "id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER,
    "cwConversationId" INTEGER,
    "cwContactId" INTEGER,
    "protocolo" TEXT,
    "execucaoId" TEXT,
    "noId" TEXT,
    "visitaSeq" INTEGER,
    "chaveEfeito" TEXT,
    "valorCentavos" INTEGER NOT NULL,
    "descricao" TEXT,
    "devedorNome" TEXT,
    "devedorDoc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aguardando',
    "ambiente" TEXT NOT NULL,
    "chavePixRecebedora" TEXT,
    "locId" INTEGER,
    "copiaECola" TEXT,
    "expiracaoSegundos" INTEGER NOT NULL DEFAULT 3600,
    "expiraEm" TIMESTAMP(3),
    "e2eId" TEXT,
    "valorPagoCentavos" INTEGER,
    "pagoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

CONSTRAINT "RagnabotCobrancaPix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotCobrancaPixEvento" (
    "id" TEXT NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "cobrancaId" TEXT,
    "txid" TEXT,
    "tipo" TEXT NOT NULL,
    "statusExterno" TEXT,
    "resultado" TEXT,
    "erro" TEXT,
    "valorCentavos" INTEGER,
    "ip" TEXT,
    "payload" JSONB,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

CONSTRAINT "RagnabotCobrancaPixEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotPagamentoCredencial_chaveEscopo_key" ON "RagnabotPagamentoCredencial"("chaveEscopo");

-- CreateIndex
CREATE INDEX "RagnabotPagamentoCredencial_tenantId_idx" ON "RagnabotPagamentoCredencial"("tenantId");

-- CreateIndex
CREATE INDEX "RagnabotPagamentoCredencial_provedor_ambiente_idx" ON "RagnabotPagamentoCredencial"("provedor", "ambiente");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCobrancaPix_txid_key" ON "RagnabotCobrancaPix"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCobrancaPix_chaveEfeito_key" ON "RagnabotCobrancaPix"("chaveEfeito");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPix_tenantId_status_idx" ON "RagnabotCobrancaPix"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPix_cwAccountId_cwConversationId_idx" ON "RagnabotCobrancaPix"("cwAccountId", "cwConversationId");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPix_status_expiraEm_idx" ON "RagnabotCobrancaPix"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPix_e2eId_idx" ON "RagnabotCobrancaPix"("e2eId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotCobrancaPixEvento_chaveIdempotencia_key" ON "RagnabotCobrancaPixEvento"("chaveIdempotencia");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPixEvento_txid_recebidoEm_idx" ON "RagnabotCobrancaPixEvento"("txid", "recebidoEm");

-- CreateIndex
CREATE INDEX "RagnabotCobrancaPixEvento_resultado_recebidoEm_idx" ON "RagnabotCobrancaPixEvento"("resultado", "recebidoEm");

-- AddForeignKey
ALTER TABLE "RagnabotCobrancaPixEvento" ADD CONSTRAINT "RagnabotCobrancaPixEvento_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "RagnabotCobrancaPix"("id") ON DELETE SET NULL ON UPDATE CASCADE;
