-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MIGRAÇÃO 3 — A VERSÃO PUBLICADA É IMUTÁVEL (SÓ INSERT)
--
-- O gatilho BEFORE UPDATE recusa qualquer UPDATE, de qualquer coluna, com mensagem que diz ao
-- desenvolvedor o que fazer em vez disso. É a correção direta do D10: no sistema antigo a linha da
-- definição do fluxo era reescrita a cada interação de cliente, e isso sobreviveu catorze meses
-- em produção justamente por não haver nada que recusasse a escrita.
--
-- ⚠️ O `REVOKE UPDATE` PREVISTO NO CONTRATO FOI REMOVIDO — POR MEDIÇÃO, NÃO POR PREFERÊNCIA.
-- Ele foi aplicado, e quebrou o INSERT em RagnabotFluxoNo, RagnabotFluxoAresta e
-- RagnabotFluxoExecucao: `permission denied for table RagnabotFluxoVersao` (SQLSTATE 42501).
-- Causa medida — a checagem das FKs compostas da migração 4 trava a linha do PAI
-- (SELECT ... FOR KEY SHARE), e travamento de linha exige privilégio de UPDATE sobre a tabela
-- travada. Com o REVOKE em pé, NENHUM nó, NENHUMA aresta e NENHUMA execução podem ser gravados —
-- ou seja, o motor inteiro não roda. Causalidade confirmada devolvendo o GRANT e reexecutando a
-- mesma prova, que passou a completar.
--
-- Trocar as três FKs de integridade entre empresas por uma segunda camada de imutabilidade seria
-- péssimo negócio, e a segunda camada era fraca de qualquer forma: `ragnatela_app` é a DONA da
-- tabela (pg_tables.tableowner), então quem podia remover o gatilho também podia se reconceder o
-- privilégio. O REVOKE nunca defendeu contra ato deliberado — só contra engano, que é exatamente
-- o que o gatilho já cobre, e cobre melhor (erro nomeado P0001, não "permission denied").
--
-- BLINDAGEM REAL, se um dia for exigida: a tabela precisa pertencer a OUTRO papel, com a aplicação
-- recebendo SELECT + INSERT + REFERENCES. Isso muda a operação de migração da casa inteira
-- (`prisma db execute` roda como `ragnatela_app`) e não cabia nesta tarefa.
--
-- ⚠️ O Prisma NÃO expressa gatilho. Um `prisma db push` NÃO o apaga (gatilho não é objeto que ele
-- gerencie), mas um restore feito só a partir do schema.prisma nasce SEM ele — daí este arquivo
-- ser versionado e conferido por teste que lê pg_trigger.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rb_recusa_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'RagnabotFluxoVersao é imutável (só INSERT). Publique uma versão nova.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rb_versao_imutavel ON "RagnabotFluxoVersao";
CREATE TRIGGER rb_versao_imutavel BEFORE UPDATE ON "RagnabotFluxoVersao"
  FOR EACH ROW EXECUTE FUNCTION rb_recusa_update();

-- Reparo idempotente: em ambiente onde o REVOKE chegou a ser aplicado (foi o caso deste banco em
-- 28/08/2026), esta linha devolve o privilégio de que as FKs compostas dependem.
GRANT UPDATE ON "RagnabotFluxoVersao" TO ragnatela_app;
