-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- MENU CONFIGURAÇÕES  ·  contrato S7 (doc 34 §F8, painéis 8.1 a 8.13)
-- 02/09/2026
--
-- ⚠️ NUNCA RODE `prisma db push` NEM `prisma migrate dev` NESTE REPOSITÓRIO.
-- O banco tem 3 chaves estrangeiras COMPOSTAS que o Prisma não sabe declarar
-- (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`, em
-- `prisma/sql/motor-fluxo/04-rb_fk_compostas.sql`). São a tranca de BANCO contra juntar dado de
-- empresas diferentes, e os dois comandos as apagam EM SILÊNCIO.
--
-- CAMINHO USADO PARA GERAR ESTE ARQUIVO (o da LEI 2 da casa):
--   1. `prisma migrate diff --from-empty --to-schema-datamodel <schema só com o modelo novo>
--       --script`   →  o `--from-empty` evita que o diff enxergue o resto do banco e proponha DROPs
--   2. `grep -ci drop` no resultado  →  **0**, medido em 02/09/2026
--   3. `IF NOT EXISTS` e a chave estrangeira para `RagnabotTenant` escritos À MÃO (o diff isolado
--      não vê a tabela de empresas, então não teria como propor a FK)
--   4. `prisma db execute --file prisma/sql/configuracoes/01-rb_configuracoes.sql`
--   5. logo depois, `node prisma/sql/motor-fluxo/verificar-estrutura.mjs` e
--      `verificar-comportamento.mjs` — para PROVAR que as 3 FKs compostas continuam vivas
--
-- ⚠️ O CLIENTE PRISMA NOVO SÓ VALE NO PROCESSO APÓS REINÍCIO. A tabela existir no banco não basta:
-- o cliente é carregado no arranque. Por isso as rotas de configuração têm guarda de modelo e
-- respondem 503 com o motivo escrito, em vez de estourar um TypeError cru.
--
-- ⚠️ ORDEM: aplicar DEPOIS de `saas/01-rb_saas_multiempresa.sql` (é ele que cria `RagnabotTenant`,
-- alvo da chave estrangeira abaixo).
--
-- ── POR QUE UMA TABELA CHAVE/VALOR, E NÃO UMA COLUNA POR AJUSTE ────────────────────────────────
-- 29 itens no plano, e o dono já avisou que "virão mais telas". Coluna por caixinha marcada seria
-- uma migração por ajuste — e migração é o item mais caro deste banco. Com catálogo em código
-- (`src/services/ragnabot-configuracao.catalogo.js`), ajuste novo é UMA LINHA: sem SQL, sem
-- reinício, sem risco às 3 FKs compostas. O preço — `jsonb` não é validado pelo banco — está pago
-- pelo `validar()` do catálogo, que roda ANTES de qualquer gravação.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS "RagnabotConfiguracao" (
    "id"                TEXT NOT NULL,

    -- ⚠️ ANULÁVEL: a linha do OPERADOR do SaaS (whitelabel, dias de teste) não pertence a empresa
    -- nenhuma. É exatamente por isso que o índice único NÃO é sobre esta coluna — no Postgres dois
    -- NULOS não colidem, e o whitelabel da casa poderia ser cadastrado dez vezes.
    "tenantId"          TEXT,

    -- A chave materializada que o banco TRANCA: 'casa' | 'tenant:<uuid>'. NOT NULL, sempre.
    "chaveEscopo"       TEXT NOT NULL,

    "painel"            TEXT NOT NULL,
    "chave"             TEXT NOT NULL,

    -- '{"v": <valor>}' para ajuste comum; '{"c": "iv:tag:cifrado"}' para SEGREDO.
    -- ⛔ Segredo entra cifrado (aes-256-gcm, src/base/crypto.js) e NUNCA volta pela API.
    "valor"             JSONB NOT NULL,

    "segredo"           BOOLEAN NOT NULL DEFAULT false,

    -- sha256 do valor em claro, 12 primeiros hex. É o que a tela mostra no lugar do segredo e o
    -- que a auditoria registra para provar que MUDOU — sem ninguém poder reconstruir o valor.
    "impressaoDigital"  TEXT,

    "atualizadoPorId"   TEXT,
    "atualizadoPorNome" TEXT,

    "criadoEm"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotConfiguracao_pkey" PRIMARY KEY ("id")
);

-- ⭐ A TRANCA. Um ajuste por escopo — nunca dois valores para a mesma chave da mesma empresa.
-- Sem ela, salvar duas vezes em paralelo (dois administradores na mesma tela é evento real, não
-- hipótese) deixaria duas linhas, e a leitura devolveria a que o banco resolvesse primeiro.
CREATE UNIQUE INDEX IF NOT EXISTS "RagnabotConfiguracao_chaveEscopo_chave_key"
  ON "RagnabotConfiguracao"("chaveEscopo", "chave");

-- Leitura de painel inteiro (é o que a tela faz ao abrir): escopo + aba.
CREATE INDEX IF NOT EXISTS "RagnabotConfiguracao_chaveEscopo_painel_idx"
  ON "RagnabotConfiguracao"("chaveEscopo", "painel");

CREATE INDEX IF NOT EXISTS "RagnabotConfiguracao_tenantId_idx"
  ON "RagnabotConfiguracao"("tenantId");

-- ⭐ ISOLAMENTO E LGPD NUMA LINHA SÓ. Mesmo padrão de `RagnabotOrigemAutorizada` e
-- `RagnabotInbox`: quando a empresa é excluída definitivamente, a configuração dela vai junto.
-- Sem o CASCADE, sobrariam senhas de SMTP e chaves de IA cifradas de uma empresa que já não
-- existe — segredo órfão é a pior espécie, porque ninguém mais é dono dele para mandar apagar.
-- ⚠️ A linha do OPERADOR tem `tenantId` NULO e é ignorada pela FK, que é o comportamento certo:
-- o whitelabel da casa não morre com nenhum cliente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RagnabotConfiguracao_tenantId_fkey'
  ) THEN
    ALTER TABLE "RagnabotConfiguracao"
      ADD CONSTRAINT "RagnabotConfiguracao_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "RagnabotTenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ⭐ COERÊNCIA ENTRE `tenantId` E `chaveEscopo`, no BANCO e não só no serviço.
-- O serviço materializa a chave certa, mas serviço é código que muda. Esta restrição é o que
-- impede, para sempre, uma linha com `tenantId` da empresa A e `chaveEscopo` 'tenant:<B>' — que
-- seria vazamento silencioso: a empresa B leria e escreveria o ajuste guardado como sendo de A.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RagnabotConfiguracao_escopo_coerente'
  ) THEN
    ALTER TABLE "RagnabotConfiguracao"
      ADD CONSTRAINT "RagnabotConfiguracao_escopo_coerente" CHECK (
        ("tenantId" IS NULL     AND "chaveEscopo" = 'casa')
        OR
        ("tenantId" IS NOT NULL AND "chaveEscopo" = 'tenant:' || "tenantId")
      );
  END IF;
END $$;

COMMIT;
