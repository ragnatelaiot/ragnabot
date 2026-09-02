-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO 5 — A MESMA VISITA NÃO ENTRA DUAS VEZES NA FILA
--
-- Contrato S-FILA (02/09/2026). `ragnabot-fluxo-fila.service.js` nasceu neste contrato e precisa de
-- UM lugar onde o banco — e não a boa intenção do código — recuse o trabalho repetido.
--
-- POR QUE NO BANCO, E NÃO NO CÓDIGO
-- O Ragnabot roda em Kubernetes com mais de uma réplica. «Consulta se já existe, e se não existir
-- insere» é correto em um processo e errado em dois: as duas réplicas consultam no mesmo
-- milissegundo, as duas não acham nada, as duas inserem — e o cliente lê a mesma frase duas vezes.
-- A única barreira que vale sob concorrência é a que o Postgres aplica no momento do INSERT.
--
-- ⚠️ POR QUE O ÍNDICE É **PARCIAL**, SÓ SOBRE `status='pendente'`
-- Se ele valesse para todo o histórico, um trabalho de despertar NUNCA poderia reagendar a si
-- mesmo — e reagendar é o caminho normal do motor em três lugares (`prazo_adiado_por_canal`,
-- `despertar_adiado_por_efeito_pendente`, teto de passos por evento). Nesses casos o job corrente
-- está em `processando` e insere o seu sucessor; com escopo maior, o INSERT seria engolido pelo
-- conflito e a conversa congelaria em silêncio, que é o defeito mais caro que este motor tem.
-- O escopo `pendente` diz exatamente o que se quer dizer: «não pode haver DOIS trabalhos iguais
-- ESPERANDO ao mesmo tempo». O que já foi entregue não estorva ninguém.
--
-- ⚠️ NULO NÃO COLIDE COM NULO no Postgres (e este índice NÃO usa NULLS NOT DISTINCT, de propósito).
-- Então trabalho sem chave natural — o `continuar` genérico, por exemplo — entra sempre, sem
-- dedupe. É a degradação escolhida: perder um reagendamento é pior que enfileirar duas vezes um
-- trabalho que o motor já sabe descartar por `tokenVisita`/entrada consumida.
--
-- ⚠️ O Prisma NÃO expressa índice parcial. Um `prisma db push` apaga este índice EM SILÊNCIO e a
-- idempotência da fila vira decoração — sem nenhum erro, sem nenhum log. É a mesma armadilha das
-- migrações 02, 03 e 04 desta pasta (LEI 2 da casa).
--
-- IDEMPOTENTE: pode ser reaplicada. `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- AlterTable (saída literal de `prisma migrate diff`, com o IF NOT EXISTS acrescentado para poder
-- reaplicar: o diff não gera DROP nenhum, foi conferido antes de escrever este arquivo)
ALTER TABLE "RagnabotFluxoFila" ADD COLUMN IF NOT EXISTS "chaveIdem" TEXT;

-- A TRANCA. Sem ela a coluna acima é só um campo de texto bonito.
CREATE UNIQUE INDEX IF NOT EXISTS "rb_fila_idem_pendente"
  ON "RagnabotFluxoFila" ("chaveIdem")
  WHERE status = 'pendente' AND "chaveIdem" IS NOT NULL;
