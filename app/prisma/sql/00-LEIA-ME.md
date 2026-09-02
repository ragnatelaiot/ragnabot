# SQL da base `ragnabot` — ordem de aplicação

Esta pasta é a **fonte de verdade** da estrutura do banco. O `schema.prisma` descreve o mesmo
desenho para o cliente Prisma, mas **não é ele que cria a base**.

## Por que não `prisma db push` (LEI 2 da casa)

Quatro coisas deste banco o Prisma **não sabe declarar** e apaga **em silêncio**:

1. as **3 chaves estrangeiras compostas** (`rb_no_versao_fk`, `rb_aresta_versao_fk`,
   `rb_exec_versao_fk`) — a tranca que recusa, no próprio banco, juntar dado de empresas
   diferentes;
2. o **índice único parcial** de fluxo publicado por caixa;
3. o **gatilho de imutabilidade** da versão publicada;
4. o **índice único parcial da fila** (`rb_fila_idem_pendente`) — sem ele a mesma visita entra duas
   vezes e o cliente lê a mesma frase duas vezes.

Sem os arquivos 02, 03 e 04 do `motor-fluxo/`, a base nasce **sem isolamento** — parecendo certa.
Sem o 05, ela nasce **sem idempotência de fila** — e isso só aparece sob concorrência, em produção.

## Ordem

Aplique nesta ordem (as dependências de chave estrangeira são entre arquivos, não só dentro deles):

| # | Arquivo | O que cria |
|---|---|---|
| 1 | `saas/01-rb_saas_multiempresa.sql` | `RagnabotTenant`, `RagnabotTenantEvent`, `RagnabotInbox`, `RagnabotUsageSnapshot` |
| 2 | `origem/01-rb_origem_e_recusados.sql` | `RagnabotOrigemAutorizada` (FK → `RagnabotTenant`), `RagnabotContatoRecusado` |
| 3 | `cobranca/01-rb_cobranca.sql` | `RagnabotPlano`, `RagnabotAssinatura`, `RagnabotPagamento`, `RagnabotEventoCobranca` |
| 4 | `protocolo/01-rb_protocolo.sql` | `RagnabotProtocolo`, `RagnabotContadorProtocolo` |
| 5 | `auditoria/01-rb_auditoria.sql` | `RagnabotAuditoria` |
| 6 | `atendimento/01-rb_atendimento_base.sql` | as 6 tabelas dos relógios/expediente/turno/transferência |
| 7 | `motor-fluxo/01-rb_motor_base.sql` | as 20 tabelas do motor de fluxo |
| 8 | `motor-fluxo/02-rb_indice_unico_parcial.sql` | um fluxo publicado por caixa |
| 9 | `motor-fluxo/03-rb_versao_imutavel.sql` | gatilho: versão publicada não muda |
| 10 | **`motor-fluxo/04-rb_fk_compostas.sql`** | ⚠️ **as 3 FKs compostas — o isolamento entre empresas** |
| 11 | `respostas-rapidas/01-rb_respostas_rapidas.sql` | `RagnabotRespostaRapida` |
| 12 | `capitao/01-rb_capitao.sql` | `RagnabotCapitaoConfig`, `RagnabotCapitaoDocumento`, `RagnabotCapitaoInteracao`, `RagnabotCapitaoConsumoMes` |
| 13 | `pagamento-pix/01-rb_pagamento_pix.sql` | `RagnabotPagamentoCredencial`, `RagnabotCobrancaPix`, `RagnabotCobrancaPixEvento` |
| 14 | **`motor-fluxo/05-rb_fila_idempotencia.sql`** | ⚠️ `RagnabotFluxoFila.chaveIdem` + o índice único **parcial** `rb_fila_idem_pendente` — a mesma visita não entra duas vezes na fila |
| 15 | `caixa-atendimento/01-rb_caixa_atendimento.sql` | `RagnabotSetor`, `RagnabotAgenteSetor`, `RagnabotConversa` — o índice de conversas e o **isolamento por agente e por setor** (contrato S2). ⚠️ Sem `RagnabotAgenteSetor` preenchido, nenhum agente enxerga fila (falha fechada, de propósito) |

Total: **50 tabelas** — o mesmo número de modelos `Ragnabot*` no `schema.prisma`.

## Como aplicar

```bash
# DATABASE_URL aponta para a base `ragnabot` no cluster Patroni (via `banco-lider`, nunca um nó fixo)
npx prisma db execute --file prisma/sql/saas/01-rb_saas_multiempresa.sql --schema prisma/schema.prisma
# ... na ordem da tabela acima
```

Depois de aplicar tudo, confira com os dois verificadores que já existem:

```bash
node prisma/sql/motor-fluxo/verificar-estrutura.mjs      # as trancas estão lá?
node prisma/sql/motor-fluxo/verificar-comportamento.mjs  # elas realmente recusam?
```

## Procedência dos arquivos

- `atendimento/`, `motor-fluxo/`, `respostas-rapidas/` — **cópia fiel** do que já foi aplicado no
  banco do NOC. Não foram reescritos.
- `saas/`, `origem/`, `cobranca/`, `protocolo/`, `auditoria/` — **novos nesta etapa**. Estas 13
  tabelas nasceram no NOC sem SQL versionado; a DDL foi gerada por
  `prisma migrate diff --from-empty --to-schema-datamodel --script` a partir do `schema.prisma`
  e conferida: **zero comando `DROP`**.
  ⚠️ Não foram aplicadas em nenhum banco ainda — a base `ragnabot` é a Etapa 2.

## Quando mudar o schema daqui para a frente

```bash
prisma migrate diff --from-schema-datasource --to-schema-datamodel --script > /tmp/novo.sql
grep -i drop /tmp/novo.sql        # tem de sair VAZIO; se não sair, recorte cada DROP à mão
prisma db execute --file /tmp/novo.sql
# e versione o resultado aqui, em prisma/sql/<assunto>/NN-*.sql
```

## Acréscimos de 02/09/2026 (S5 + S-EFÍ)

- `capitao/` e `pagamento-pix/` — **gerados** por `prisma migrate diff --from-empty
  --to-schema-datamodel <só os modelos novos> --script` e conferidos: **zero `DROP`**.
  ⛔ **Ainda não aplicados em nenhum banco** — não havia `DATABASE_URL` alcançável na estação em
  que foram escritos. Quem aplicar deve rodar, logo depois, os dois verificadores do motor
  (`verificar-estrutura.mjs` e `verificar-comportamento.mjs`) para provar que as 3 FKs compostas
  continuam vivas — e lembrar que o cliente Prisma novo só vale no processo APÓS reinício.
