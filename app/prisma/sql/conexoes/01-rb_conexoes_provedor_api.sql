-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CONEXÕES: CAMADA DE PROVEDOR, API PÚBLICA E WEBHOOK DE SAÍDA  ·  contrato S6 (doc 34 §F9.2/§F9.4)
-- 02/09/2026
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`, em
-- `prisma/sql/motor-fluxo/04-rb_fk_compostas.sql`). São a tranca de BANCO contra juntar dado de
-- empresas diferentes, e os dois comandos as apagam EM SILÊNCIO.
--
-- CAMINHO USADO PARA GERAR ESTE ARQUIVO (o da LEI 2 da casa):
--   1. `prisma migrate diff --from-empty --to-schema-datamodel <schema só com os 4 modelos novos>
--       --script`   →  o `--from-empty` evita que o diff enxergue o resto do banco e proponha DROPs
--   2. `grep -ci drop` no resultado  →  **0**, medido em 02/09/2026
--   3. os `ALTER TABLE` das colunas novas foram escritos À MÃO, com `IF NOT EXISTS`, porque o diff
--      de tabela EXISTENTE é justamente onde nascem os DROPs silenciosos
--   4. `prisma db execute --file prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql`
--   5. logo depois, `node prisma/sql/motor-fluxo/verificar-estrutura.mjs` e
--      `verificar-comportamento.mjs` — para PROVAR que as 3 FKs compostas continuam vivas
--
-- ⚠️ O CLIENTE PRISMA NOVO SÓ VALE NO PROCESSO APÓS REINÍCIO. A coluna existir no banco não basta:
-- o cliente é carregado no arranque. Por isso as rotas de conexão têm guarda de modelo e respondem
-- 503 com o motivo escrito, em vez de estourar um TypeError cru.
--
-- ── O QUE ESTE ARQUIVO FAZ, EM TRÊS PARTES ──────────────────────────────────────────────────────
--   PARTE 1  colunas novas em `RagnabotInbox`   — provedor, estado, reinício  (F9.2.2/9.2.3/9.2.5)
--   PARTE 2  colunas novas em `RagnabotConversa` — origem da transferência    (F9.2.4)
--   PARTE 3  4 tabelas novas                     — credencial de API, webhook de saída, fila de
--                                                  entrega e histórico de transferência (F9.4/9.2.4)
--
-- ⚠️ ORDEM: aplicar DEPOIS de `saas/01-rb_saas_multiempresa.sql` (cria `RagnabotInbox`) e de
-- `caixa-atendimento/01-rb_caixa_atendimento.sql` (cria `RagnabotConversa`).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — `RagnabotInbox`: quem OPERA a conexão, e como ela está
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "provedor"       TEXT NOT NULL DEFAULT 'nativo';
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "provedorRef"    TEXT;
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "provedorConfig" JSONB;
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "estado"         TEXT NOT NULL DEFAULT 'desconhecido';
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "estadoDetalhe"  TEXT;
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "estadoEm"       TIMESTAMP(3);
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "reiniciadaEm"        TIMESTAMP(3);
ALTER TABLE "RagnabotInbox" ADD COLUMN IF NOT EXISTS "reiniciadaPorUserId" TEXT;

-- RETROCARGA. O padrão da coluna é 'nativo' porque é o único valor que não mente sobre NENHUMA das
-- linhas existentes (Site, e-mail, Telegram). Mas as conexões da Meta são `meta_direto` de fato —
-- é o que a casa usa hoje —, e deixá-las em 'nativo' faria a tela de Conexões mostrar «sem
-- provedor externo» para um canal que fala com a Graph API. Esta é a MESMA regra de
-- `provedorPadraoDoCanal()` em `ragnabot-provedor.service.js`; se uma das duas mudar, a outra tem
-- de mudar junto.
UPDATE "RagnabotInbox"
   SET "provedor" = 'meta_direto'
 WHERE "channelType" IN ('whatsapp', 'instagram', 'facebook')
   AND "provedor" = 'nativo';

-- «quantas conexões desta empresa em cada provedor» é a consulta da tela e do relatório de cota.
CREATE INDEX IF NOT EXISTS "RagnabotInbox_tenantId_provedor_idx"
    ON "RagnabotInbox" ("tenantId", "provedor");

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — `RagnabotConversa`: de onde o atendimento veio quando trocou de conexão
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "RagnabotConversa" ADD COLUMN IF NOT EXISTS "origemCwInboxId" INTEGER;
ALTER TABLE "RagnabotConversa" ADD COLUMN IF NOT EXISTS "transferidaEm"   TIMESTAMP(3);

-- Tabela nova
CREATE TABLE "RagnabotApiCredencial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "segredoCifrado" TEXT NOT NULL,
    "segredoDigital" TEXT NOT NULL,
    "escopos" TEXT[] DEFAULT ARRAY['ler']::TEXT[],
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "revogadaEm" TIMESTAMP(3),
    "revogadaPorUserId" TEXT,
    "motivoRevogacao" TEXT,
    "substituiuId" TEXT,
    "criadaPorUserId" TEXT,
    "ultimoUsoEm" TIMESTAMP(3),
    "ultimoUsoIp" TEXT,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotApiCredencial_pkey" PRIMARY KEY ("id")
);

-- Tabela nova
CREATE TABLE "RagnabotWebhookSaida" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cwInboxId" INTEGER,
    "segredoCifrado" TEXT NOT NULL,
    "segredoDigital" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "falhasSeguidas" INTEGER NOT NULL DEFAULT 0,
    "pausadoAte" TIMESTAMP(3),
    "ultimaEntregaEm" TIMESTAMP(3),
    "ultimoStatus" INTEGER,
    "ultimoErro" TEXT,
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "removidoEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotWebhookSaida_pkey" PRIMARY KEY ("id")
);

-- Tabela nova
CREATE TABLE "RagnabotWebhookEntrega" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "idDoEvento" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "corpo" JSONB NOT NULL,
    "tentativa" INTEGER NOT NULL DEFAULT 0,
    "maxTentativas" INTEGER NOT NULL DEFAULT 6,
    "estado" TEXT NOT NULL DEFAULT 'pendente',
    "proximaEm" TIMESTAMP(3) NOT NULL,
    "httpStatus" INTEGER,
    "respostaResumo" TEXT,
    "erro" TEXT,
    "duracaoMs" INTEGER,
    "entregueEm" TIMESTAMP(3),
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotWebhookEntrega_pkey" PRIMARY KEY ("id")
);

-- Tabela nova
CREATE TABLE "RagnabotConexaoTransferencia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "origemCwInboxId" INTEGER NOT NULL,
    "destinoCwInboxId" INTEGER NOT NULL,
    "origemNome" TEXT,
    "destinoNome" TEXT,
    "filtroEstados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encontradas" INTEGER NOT NULL DEFAULT 0,
    "movidas" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "resultado" TEXT NOT NULL,
    "detalhes" JSONB,
    "avisoNaConversa" BOOLEAN NOT NULL DEFAULT false,
    "moveuNaPlataforma" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT NOT NULL,
    "solicitadaPorUserId" TEXT,
    "solicitadaPorNome" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotConexaoTransferencia_pkey" PRIMARY KEY ("id")
);

-- Índice
CREATE UNIQUE INDEX "RagnabotApiCredencial_chave_key" ON "RagnabotApiCredencial"("chave");

-- Índice
CREATE INDEX "RagnabotApiCredencial_tenantId_ativa_idx" ON "RagnabotApiCredencial"("tenantId", "ativa");

-- Índice
CREATE INDEX "RagnabotApiCredencial_tenantId_criadaEm_idx" ON "RagnabotApiCredencial"("tenantId", "criadaEm");

-- Índice
CREATE INDEX "RagnabotWebhookSaida_tenantId_ativo_idx" ON "RagnabotWebhookSaida"("tenantId", "ativo");

-- Índice
CREATE INDEX "RagnabotWebhookSaida_tenantId_cwInboxId_idx" ON "RagnabotWebhookSaida"("tenantId", "cwInboxId");

-- Índice
CREATE UNIQUE INDEX "RagnabotWebhookEntrega_chave_key" ON "RagnabotWebhookEntrega"("chave");

-- Índice
CREATE INDEX "RagnabotWebhookEntrega_estado_proximaEm_idx" ON "RagnabotWebhookEntrega"("estado", "proximaEm");

-- Índice
CREATE INDEX "RagnabotWebhookEntrega_webhookId_criadaEm_idx" ON "RagnabotWebhookEntrega"("webhookId", "criadaEm");

-- Índice
CREATE INDEX "RagnabotWebhookEntrega_tenantId_evento_criadaEm_idx" ON "RagnabotWebhookEntrega"("tenantId", "evento", "criadaEm");

-- Índice
CREATE INDEX "RagnabotConexaoTransferencia_tenantId_criadaEm_idx" ON "RagnabotConexaoTransferencia"("tenantId", "criadaEm");

-- Índice
CREATE INDEX "RagnabotConexaoTransferencia_origemCwInboxId_idx" ON "RagnabotConexaoTransferencia"("origemCwInboxId");

-- Índice
CREATE INDEX "RagnabotConexaoTransferencia_destinoCwInboxId_idx" ON "RagnabotConexaoTransferencia"("destinoCwInboxId");


COMMIT;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA APÓS APLICAR (cole e rode; os três devem responder o que está escrito)
--
--   -- 1. as 8 colunas novas da conexão existem
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'RagnabotInbox'
--      AND column_name IN ('provedor','provedorRef','provedorConfig','estado','estadoDetalhe',
--                          'estadoEm','reiniciadaEm','reiniciadaPorUserId')
--    ORDER BY 1;                                              -- esperado: 8 linhas
--
--   -- 2. nenhuma conexão da Meta ficou como 'nativo'
--   SELECT "channelType", "provedor", count(*) FROM "RagnabotInbox" GROUP BY 1,2 ORDER BY 1;
--
--   -- 3. a tranca de «não entrega duas vezes» é ÚNICA (e NÃO parcial)
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'RagnabotWebhookEntrega_chave_key';
--        -- esperado: CREATE UNIQUE INDEX … ON public."RagnabotWebhookEntrega" USING btree (chave)
--
--   -- 4. E, SEMPRE, que as 3 FKs compostas continuam vivas:
--   --    node prisma/sql/motor-fluxo/verificar-estrutura.mjs
-- ════════════════════════════════════════════════════════════════════════════════════════════════
