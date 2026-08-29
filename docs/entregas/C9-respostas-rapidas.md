# C9 — Respostas rápidas (atalhos de texto do atendente)

> Entrega de 29/08/2026 · código em `/ia/netagent` · **não** commitado, **não** deployado, **rota
> ainda não montada em `src/server.js`** (é decisão do chefe).

---

## 1. O que é, em uma frase

O atendente digita `/bomdia` na caixa de resposta e o texto inteiro aparece pronto, já com o nome do
cliente, o número do protocolo e o número do atendimento trocados.

**Por que existe:** medido em 29/08/2026, o menu **Gestão** do chat atual tem "Respostas rápidas" e
a origem tem o recurso (o levantamento de fevereiro contou **39 respostas em 4 empresas**; a
instância de referência está hoje com **zero** cadastradas). O Chatwoot 4.17.1 tem *canned
responses* nativas, mas **sem escopo por caixa/time, sem resposta pessoal do atendente e sem as
variáveis** que a operação já usa — que é exatamente o que esta entrega acrescenta.

---

## 2. Como o atendente usa

### Criar
1. **Gestão ➜ Respostas rápidas ➜ Nova**.
2. **Atalho** — a palavra que aciona o texto: `bomdia`, `boleto`, `prazo`. Pode digitar com a barra
   (`/bomdia`); ela é só a forma de acionar, não faz parte do nome.
3. **Título** — como a resposta aparece na lista ("Saudação da manhã").
4. **Conteúdo** — o texto, com as variáveis que quiser (ver §3).
5. **Quem usa** — *"Da empresa"* (todo mundo) ou *"Só minha"*.
6. Opcionalmente, **restringir a uma caixa de entrada ou a um time**.

### Usar
Na caixa de resposta, digite **`/`** seguido do atalho (`/bomdia`) e confirme. O texto entra já
expandido — o atendente ainda pode editar antes de enviar. **Revise sempre antes de mandar.**

### O que o sistema não deixa fazer (e por quê)
| Situação | O que acontece | Por quê |
|---|---|---|
| Cadastrar `Bom Dia` com espaço e acento | vira `bom_dia` automaticamente | acento/maiúscula/espaço são ruído de digitação — sem normalizar, o atendente cadastra `Horário` e jura que `/horario` sumiu |
| Cadastrar `/bomdia` duas vezes na mesma empresa | recusado, com a frase *"Já existe uma resposta rápida com o atalho /bomdia neste mesmo escopo"* | duas respostas idênticas na lista é o atendente escolhendo no escuro |
| Um atendente comum criar resposta **da empresa** | recusado (403) — a dele nasce como **pessoal** | resposta da empresa é configuração; espelha o `editQuickMessages` da origem |
| Alguém abrir a resposta de outra empresa | **404, "não encontrada"** | 403 confirmaria que aquele id existe — metade do vazamento |
| Resposta rápida da empresa A com o mesmo atalho da empresa B | **permitido** | a unicidade é **por empresa**, nunca global |

---

## 3. Variáveis suportadas

A lista veio da **medição**, não de gosto: as dez primeiras são as do chat atual
(`18-LEVANTAMENTO-CHAT-ATUAL.md` §4.1) e os apelidos `firstName`/`ticket_id` são os das mensagens
automáticas por conexão (`31-FUNCIONALIDADES-A-IMPLEMENTAR.md` §8).

| Escreva | Também aceita | Vira |
|---|---|---|
| `{{contactFirstName}}` | `{{firstName}}`, `{{primeiroNome}}` | Primeiro nome do contato — *Maria* |
| `{{contactName}}` | `{{name}}`, `{{nome}}` | Nome completo — *Maria Magnólia* |
| `{{user}}` | `{{atendente}}`, `{{agentName}}` | Nome de quem está atendendo |
| `{{greeting}}` | `{{saudacao}}` | *Bom dia / Boa tarde / Boa noite*, pelo relógio |
| `{{protocolo}}` | `{{protocolNumber}}` | Número do protocolo |
| `{{ticket_id}}` | `{{ticketId}}`, `{{atendimento}}` | Número do atendimento |
| `{{queue}}` | `{{fila}}`, `{{setor}}`, `{{time}}` | Setor / time |
| `{{connection}}` | `{{conexao}}`, `{{canal}}`, `{{caixa}}` | Conexão / caixa de entrada |
| `{{date}}` | `{{data}}` | Data de hoje |
| `{{hour}}` | `{{hora}}` | Hora agora |
| `{{empresa}}` | `{{company}}` | Nome da empresa |

**Por que existem dois nomes para a mesma coisa:** são dois vocabulários *medidos* para as mesmas
ideias. Escolher um e recusar o outro faria todo texto migrado da origem chegar quebrado — e
variável que não existe vira **string vazia**, que é o pior defeito possível: a mensagem sai sem o
nome do cliente e ninguém percebe.

**Três garantias do comportamento:**
- **Variável sem valor vira vazio, mas é denunciada.** A resposta da API traz `ausentes: ["protocolo"]`
  — a tela consegue avisar *"esta resposta usa {{protocolo}}, que esta conversa ainda não tem"*.
- **Variável inventada é apontada.** A prévia devolve `desconhecidas: ["contatoNomee"]`.
- **Passada única.** O valor substituído **nunca** é reinterpolado: um contato chamado
  `{{protocolo}}` recebe de volta o texto `{{protocolo}}`, e **não** o número do protocolo. Sem esta
  regra, o nome do contato viraria um canal para ler dados da conversa.

O fuso padrão é **America/Fortaleza** (não UTC). Herdar o fuso da plataforma erraria em 3 horas e às
21h o cliente receberia *"Bom dia"*.

---

## 4. Como funciona por dentro

### 4.1 Arquivos

| Arquivo | Papel |
|---|---|
| `prisma/schema.prisma` (modelo `RagnabotRespostaRapida`) | a tabela |
| `prisma/sql/respostas-rapidas/01-rb_respostas_rapidas.sql` | a migração versionada, **já aplicada** |
| `src/services/ragnabot-respostas-rapidas.service.js` | **as decisões**: atalho válido, quem ganha o desempate, variáveis, expansão, isolamento |
| `src/routes/ragnabot-respostas-rapidas.routes.js` | valida entrada, chama o serviço, audita, traduz erro em HTTP |
| `tests/ragnabot-respostas-rapidas.test.mjs` | 69 verificações contra o PostgreSQL real |

### 4.2 A coluna calculada `chaveAtalho` — a parte que morde

O índice único "natural" seria `(tenantId, atalho, cwInboxId, cwTeamId, visibilidade, userId)`.
**Quatro dessas colunas são anuláveis, e no PostgreSQL NULO ≠ NULO** — logo `/bomdia` da empresa
poderia ser cadastrado dez vezes sem uma única violação. É a mesma lição já registrada em
`RagnabotAtendPolitica.escopoChave` e em `RagnabotFluxoEntrada.chave`.

Por isso a linha carrega uma chave **calculada, NOT NULL e comparável**:

```
bomdia|geral|empresa        → resposta da empresa, vale em qualquer caixa
bomdia|caixa:42|empresa     → só na caixa 42
bomdia|time:7|u:<uuid>      → pessoal de um atendente, dentro do time 7
```

com `@@unique([tenantId, chaveAtalho])`. A chave **nunca** é aceita de quem chama — é sempre
derivada. Aceitá-la permitiria gravar escopo "empresa" com chave "caixa:42" e furar a unicidade por
fora. Trocar o atalho pelo PATCH **recalcula a chave**, senão o atalho antigo ficaria trancado para
sempre e o novo poderia duplicar sem violação nenhuma.

### 4.3 Qual resposta o `/bomdia` aciona (a ordem de desempate)

Duas respostas podem casar com o mesmo atalho. Sem ordem declarada, "qual texto aparece" viraria o
que o banco devolvesse primeiro, e o atendente veria um texto diferente a cada dia sem ninguém ter
mexido em nada. A ordem é **do mais específico para o mais geral**:

1. pessoal + escopo da caixa/time desta conversa
2. pessoal geral
3. empresa + escopo da caixa/time desta conversa
4. empresa geral

Resposta presa a **outra** caixa/time é **descartada**, não despriorizada. A resposta da API traz
`alternativas: N` — quantas outras casaram —, que é o que explica "por que veio este e não aquele".

### 4.4 Isolamento por empresa

O `tenantId` **nunca** vem da tela para ampliar alcance: é derivado do usuário logado por
`escopoDe()` (a mesma função de `ragnabot-auditoria.service.js`, que segue sendo a única fonte da
verdade sobre escopo). Um `tenantId` no corpo/consulta só é aceito de quem é **super**, e aí ele
**estreita**, jamais alarga.

- Fora do escopo → **404** ("não encontrada"), nunca 403.
- **403** só no caso legítimo: a linha é sua/da sua empresa e você não tem o papel para mexer nela.
- Usuário sem empresa vinculada → **vê zero**. Falha **fechada**: vazio é o lado seguro do erro.
- Resposta **pessoal** é o rascunho de uma pessoa — nem o administrador da empresa a lista por
  padrão. Só o dono e o super usuário a enxergam.

### 4.5 A interpolação é importada, não reescrita

`expandir()` usa o `interpolar()` de `ragnabot-fluxo-nos.service.js` — a interpolação da casa
(passada única, escape por destino, relatório de ausentes). Escrever uma segunda seria assinar que
um dia as duas divergem, e quem descobriria é o cliente, lendo `{{contactFirstName}}` cru numa
mensagem.

---

## 5. Endpoints (a rota **ainda não está montada** — a linha é do chefe)

```js
app.use('/api/ragnabot-respostas-rapidas', authMiddleware,
  (await import('./routes/ragnabot-respostas-rapidas.routes.js')).default);
```

⚠️ **Sem `adminOnly` no mount**, de propósito: quem mais usa resposta rápida é o **atendente**, cuja
`role` do NOC é `user`. Quem pode escrever o quê é decidido dentro da rota, pelo serviço.

| Verbo | Rota | Função |
|---|---|---|
| GET | `/opcoes` | vocabulário para a tela (variáveis, visibilidades, limites) — fora da guarda de migração |
| GET | `/` | lista; `?busca=` procura no atalho **e** no título; `?incluirInativas=true`; `?cwInboxId=`; `?visibilidade=` |
| GET | `/resolver?atalho=/bomdia` | **o que a caixa de resposta chama** — resolve o desempate e devolve o texto já expandido |
| POST | `/previa` | expande um texto qualquer sem gravar; devolve `usadas`, `ausentes` e `desconhecidas` |
| GET | `/:id` | uma resposta (404 fora do escopo) |
| POST | `/` | cria (201; **409** com `code: ATALHO_DUPLICADO` se repetir) |
| PATCH | `/:id` | altera parcialmente |
| DELETE | `/:id` | remove |

Enquanto o processo não for reiniciado com o cliente Prisma novo, as rotas que tocam a tabela
respondem **503 `MODELO_AUSENTE`** com o texto do que fazer — não 500 mudo.

---

## 6. Migração — o caminho da casa

Feito exatamente como manda a lei 2 (nunca `db push`, nunca `migrate dev`):

1. `npx prisma migrate diff --from-schema-datasource --to-schema-datamodel --script`
2. o resultado bruto veio com **os 3 `ALTER TABLE … DROP CONSTRAINT rb_*_versao_fk` no topo** —
   foram **recortados à mão**;
3. conferido que sobrou só `CREATE TABLE` / `CREATE INDEX` (nenhum `DROP`, `ALTER`, `TRUNCATE` ou
   `DELETE` no arquivo);
4. `npx prisma db execute --file prisma/sql/respostas-rapidas/01-rb_respostas_rapidas.sql` →
   *Script executed successfully*;
5. as 3 chaves estrangeiras compostas conferidas **vivas antes e depois** — e a conferência virou
   verificação permanente na seção 10 do teste.

---

## 7. O que ficou de fora (e é decisão de outra pessoa)

- **Montar a rota em `src/server.js`** e **reiniciar o serviço** (o cliente Prisma novo só vale no
  processo após restart) — do chefe, e só com `safeToRestart:true`.
- **A tela.** Não há UI: só API. O componente de sugestão na caixa de resposta (digitar `/` e ver a
  lista) é trabalho de frontend.
- **Anexo na resposta rápida.** A origem guarda `mediaPath` nas quick messages; aqui é só texto.
- **Migrar as 39 respostas da origem.** Nada foi importado — a instância de referência está com
  zero cadastradas hoje.
- **Prova em conversa real.** Não existe nenhuma caixa de WhatsApp criada ainda no ambiente; o
  `/resolver` foi provado com contexto passado à mão, **não** com uma conversa de verdade.
