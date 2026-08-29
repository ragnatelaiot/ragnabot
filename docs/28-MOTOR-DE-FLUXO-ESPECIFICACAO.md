# 🧠 28 — MOTOR DE FLUXO DE CONVERSA DO RAGNABOT
### Especificação definitiva, pronta para construir

> **Data:** 28/08/2026 · **Base de medição:** documentos `25-FLUXO-ABERTURA-DE-CHAMADO.md` (engenharia
> reversa do fluxo real, 35 nós / 37 arestas), `19-COMPARATIVO-E-BACKLOG-RAGNABOT.md` (§3/B1, catálogo
> de nós) e `18-LEVANTAMENTO-CHAT-ATUAL.md` (§4.17, editor atual).
> **Código verificado nesta sessão:** `/ia/netagent/prisma/schema.prisma` (modelos `Ragnabot*`),
> `src/routes/ragnabot-webhook.routes.js`, `src/services/ragnabot-protocolo.service.js`,
> `src/utils/crypto.js`, `src/utils/redact.js`, `.env.example`.
> **Regra que atravessa o documento:** número sem medição é declarado como não medido. Ponto cego é
> declarado, não maquiado.

---

## 0. O que está sendo especificado, em dez linhas

O motor de fluxo é uma **aplicação nossa**, acoplada ao Chatwoot 4.17.1 como **Agent Bot**: o Chatwoot
entrega a conversa por webhook, e o motor responde pela API de aplicação. O Chatwoot **não é
bifurcado** — ele não tem editor de fluxo e não vai passar a ter.

O desenho separa quatro coisas que o sistema atual mistura numa linha só: o **documento** do fluxo
(imutável), o **estado** de cada conversa (uma linha por conversa), a **prova** do que foi enviado
(caixa de saída de duas fases) e a **telemetria** (tabela de fatos). É essa separação que mata o
defeito D10 medido — hoje cada interação de cliente reescreve a linha inteira de `Flows`.

O motor assume **pelo-menos-uma-vez** na entrega e diz isso em voz alta, em vez de prometer
exatamente-uma-vez e entregar "chamado registrado com sucesso" sem prova (defeito D3 medido). Todo
efeito irreversível tem política declarada para o caso duvidoso, e o caso duvidoso acorda gente.

---

## 1. Decisão de arquitetura

### 1.1 O desenho, em prosa

Um único artefato de código (`ragnabot-motor`, Node 18 ESM, Express onde precisa de HTTP), com
**quatro papéis** selecionados por variável de ambiente `RB_PAPEL`. São quatro processos porque cada
um tem uma superfície de risco diferente, e misturá-los foi como um `pod` do Chatwoot acabou com saída
de rede irrestrita (medido em `22-AUDITORIA-SEGURANCA.md`, §A7/§B2).

| papel | réplicas | o que faz | o que **nunca** faz |
|---|---:|---|---|
| `portaria` | 2 | recebe o webhook, confere o segredo **da caixa**, grava a entrada e enfileira, responde 200 | executar nó; chamar Chatwoot; chamar terceiro |
| `executor` | 2–3 | toma posse da conversa, anda no grafo, reserva e confirma efeitos, fala com o Chatwoot | receber HTTP de fora; chamar terceiro diretamente |
| `egresso` | 1–2 | executa **só** as chamadas HTTP de nó para fora, atrás de proxy com lista de permissão | ter `DATABASE_URL` do NOC, `ENCRYPTION_KEY`, ou qualquer ferramenta de SSH no mesmo processo |
| `vigias` | — | roda **dentro** do `executor`, cada vigia protegido por `pg_try_advisory_lock` de id fixo | duplicar-se; depender de eleição ou de coordenador externo |

```
WhatsApp Cloud API ──► Chatwoot (Inbox)
                          │  webhook do Agent Bot + webhook de conta
                          ▼
              ┌───────────────────────────────────────┐
              │  PORTARIA (2)                         │
              │  segredo POR CAIXA, timing-safe       │
              │  INSERT entrada (chave NOT NULL)      │──► RagnabotFluxoEntrada
              │  INSERT job na fila                   │──► RagnabotFluxoFila
              │  atualiza janela de 24 h              │──► RagnabotFluxoJanela
              │  COMMIT ──────────► só ENTÃO 200      │
              └───────────────┬───────────────────────┘
                              │  chaveParticao = "conta:conversa"
              ┌───────────────▼───────────────────────┐
              │  EXECUTOR (2–3)                       │
              │  1. escolhe candidato                 │
              │  2. TOMA POSSE (lease + cerca)        │
              │  3. drena a rajada da partição        │
              │  4. passo: T1 (reserva + avança)      │
              │  5. efeito FORA de transação          │
              │  6. T2 (confirma / marca falha)       │
              └───┬───────────────────┬───────────────┘
                  │ PortaCanal        │ intenção de saída externa
                  ▼                   ▼
        Chatwoot / Cloud API     ┌───────────────────┐
                                 │ EGRESSO (1–2)     │──► proxy com lista
                                 │ sem chave, sem DB │    de permissão
                                 └───────────────────┘
              ┌───────────────────────────────────────┐
              │  VIGIAS (singleton por advisory lock) │
              │  conciliador · ceifador de jobs ·     │
              │  varredor de órfãos · expirador ·     │
              │  escalador de pausa · podador         │
              └───────────────────────────────────────┘
```

**Ids de trava consultiva reservados** (para nenhum outro serviço da casa colidir):
`811001` conciliador · `811002` varredor de órfãos · `811003` expirador de TTL · `811004` podador ·
`811005` ceifador de jobs · `811006` escalador de pausa · `811007` agregador (fase 2).

### 1.2 As oito decisões estruturais, e por que cada uma

**(1) O PostgreSQL é o único árbitro de estado, fila e trava. O Redis fica fora da corretude.**
O Redis medido no aglomerado é primário/réplica com senha, replicação assíncrona, e o blueprint
`09-BLUEPRINT-EXECUCAO-RAGNABOT.md` não registra Sentinel nem ensaio de troca. Numa promoção de
réplica, a cauda de uma fila desaparece e uma trava distribuída se duplica — que é exatamente o
cenário que este motor precisa sobreviver. O Postgres dá transação, `FOR UPDATE SKIP LOCKED`, índice
único parcial e o mesmo backup WORM/PITR que a casa já opera: a fila entra no
`RESTORE-INSTRUCTIONS` de graça. *Rejeitado:* BullMQ/Redis (perda e duplicação no failover, segunda
verdade a restaurar); Kafka/RabbitMQ (dependência com estado nova para um volume projetado de poucos
trabalhos por segundo); `pg_notify` como entrega (é fogo-e-esquece — serve como cutucão de latência
sobre a sondagem, nunca como fonte).

**(2) A portaria responde 200 depois de gravar, nunca antes.**
Isto é conserto de código **vivo**, não só desenho novo. Em `src/routes/ragnabot-webhook.routes.js`,
o `res.json({ ok: true })` está na **linha 53** e o processamento começa na **linha 55**; o comentário
das linhas 51–52 justifica com "o processamento é idempotente". Idempotência protege contra
reprocessamento — **não** contra perda. Se o processo morrer entre o 200 e a gravação, o Chatwoot
considera entregue e a mensagem do cliente evapora sem rastro. O `INSERT` custa cerca de um
milissegundo; responder depois dele fecha um buraco de perda silenciosa.

**(3) A posse da conversa é um arrendamento com token de cerca, e ela é tomada ANTES de reivindicar
o trabalho.** Trava consultiva de **sessão** morre em silêncio atrás de pgbouncer em modo transação, e
um processo congelado por pausa longa de coletor de lixo mantém a sessão TCP viva enquanto acredita
ser o dono. A cerca troca "eu tenho a trava" por "o banco aceitou meu `UPDATE` porque o meu token
ainda é o vigente": zero linhas afetadas significa perdi a posse, e a transação inteira volta atrás
**antes de qualquer efeito**. E a ordem importa: quem não tem a posse **não toca no trabalho** — não
marca como em processamento, não incrementa tentativas, não adia. Só ignora o candidato nesta rodada.

**(4) O estado avança e o efeito é reservado na MESMA transação; o efeito acontece depois do
commit.** Se o estado avançasse depois do envio, uma queda entre enviar e gravar replicaria o nó e a
mensagem sairia duas vezes **sem nenhum registro durável de que saiu uma vez** — impossível de
conciliar, impossível de auditar. Com reserva prévia, sempre existe prova de que o efeito foi
*tentado*. O preço assumido é que uma queda pode deixar mensagem não enviada, e o conciliador
reenvia. Silêncio seguido de repetição é falha melhor que "chamado registrado" fantasma.
**Nenhuma transação aberta atravessa chamada de rede** — isso esgota o pool e segura bloqueios pelo
tempo do terceiro, e o terceiro aqui é o Typebot, que a medição mostra não responder de forma
confiável.

**(5) O executor de nó nunca fala com o Chatwoot nem com a Meta.** Ele devolve uma **intenção**
canônica; uma `PortaCanal` com adaptadores traduz. O maior desconhecido de todo o projeto — se o
Chatwoot 4.17.1 entrega mensagem interativa de WhatsApp — fica contido em um arquivo de adaptador,
em vez de contaminar os quinze executores, o validador e o modo de teste. A escolha é por caixa, no
campo `RagnabotInbox.metadata.capacidadeInterativa`, decidida pela prova da fatia 0.

**(6) O documento do fluxo é imutável; a telemetria mora fora dele; a versão é escolhida por
classificação de mudança, não por decreto.** Publicar cria versão nova. Quem já entrou não muda de
versão no meio — **exceto** quando a mudança não tocou o esqueleto do grafo, caso em que as execuções
vivas são levadas junto e só o nó em que a pessoa está **parada** fica congelado. Fixar sempre é
tecnicamente limpo e operacionalmente errado: o operador conserta uma palavra, ou fecha um beco sem
saída, e a correção não alcança ninguém que já esteja dentro.

**(7) A credencial nunca é literal e nunca é o ambiente do processo.** O nó guarda um **apelido**; o
cofre é por empresa, cifrado com `src/utils/crypto.js`, e a resolução recebe o `tenantId` **da
execução**, jamais do nó. O cofre **não** endereça variável de ambiente: o `.env` deste processo
carrega `RAGNABOT_PLATFORM_TOKEN`, `RAGNABOT_DB_URL` e `ENCRYPTION_KEY`, e um formulário de cofre que
apontasse para `env` transformaria o editor de fluxo em leitura arbitrária do ambiente mais
privilegiado que temos.

**(8) A saída HTTP de nó sai de um processo separado, atrás de proxy com lista de permissão.** O nó
HTTP é, por definição de produto, uma URL de texto livre escrita pelo cliente — ou seja, um primitivo
de falsificação de requisição do lado do servidor. A auditoria já mediu e fechou esse vetor no
Chatwoot; recriá-lo num processo que carrega a chave de decifragem do NOC seria desfazer o conserto.

### 1.3 O que foi enxertado das propostas perdedoras

| enxerto | origem | por que entra |
|---|---|---|
| `noCongelado` — congelar a configuração **renderizada** só do nó em que a conversa está parada | modelo | Sem isso, trocar o título de um item enquanto alguém está com a lista aberta corrompe a resposta em silêncio. Com isso, o retrofit passa a valer **do próximo nó em diante**, e o horizonte de incompatibilidade cai de "o fluxo todo" para "um nó" |
| `hashEstrutura` + `classificarMudanca` | modelo | Decide automaticamente e de forma auditável se uma publicação alcança quem está dentro. Prévia numérica antes de confirmar |
| `noResgateId` obrigatório quando existe nó que estaciona | modelo | Execução órfã cai em texto honesto e vai para humano, em vez de esperar resposta que nunca vem. **Recusa explícita** de reencaixe por semelhança: errar em silêncio no meio de uma conversa é pior que parar |
| Reverter **copia para a frente**, nunca move o ponteiro | modelo | Ponteiro voltando faz o número da versão cobrir dois períodos colados, e envenena a comparação entre versões |
| `REVOKE UPDATE` na tabela de versão, além do gatilho | modelo | O gatilho recusa quando o grafo muda; o `REVOKE` cobre qualquer coluna e é conferível por consulta a `information_schema` |
| `RagnabotLimiteCanal` como **tabela datada** | modelo | Constante espalhada em cinco arquivos nunca é reconferida. O documento 25 §10 avisa que aqueles números não são medição nossa |
| `segredosRef` na projeção do nó + `ondeUsado()` | modelo | Responder "quais fluxos e nós usam este token" **antes** de rotacionar — pergunta que hoje não tem resposta, com o Bearer replicado em dez nós |
| 120 caracteres do texto do cliente **só** em `opcao_invalida` | modelo | É o único lugar onde o texto **é** o achado: as 151 pessoas estão dizendo o que querem, e hoje ninguém lê |
| `RagnabotFluxoRascunho` em tabela separada | modelo | É o que permite a tabela de versões ser estritamente de inserção |
| `PortaCanal` com três adaptadores | execução | Contém o maior risco não medido em ~200 linhas |
| `preparar()` — monta o payload **sem enviar**, usado por prévia, teste e envio real | execução | Torna mecanicamente impossível o aviso do editor divergir da execução |
| `sucessoQuando` declarativo no nó HTTP | execução | Trata o caso **respondido e errado** (200 sem `sessionId`), que a política de dúvida não cobre. É o D3 morto como configuração |
| Nota **privada** na conversa quando o robô desiste | execução | O analista que pega a conversa não repete as cinco perguntas que o cliente já respondeu |
| `RagnabotFluxoIncidente` agrupado por (versão, nó, código) com amostras | execução | Transforma 151 eventos em uma linha acionável, com as frases recusadas ao lado |
| `medir()` = maior entre grafemas e UTF-16 | execução | O título medido está a **um** caractere do teto, e ninguém sabe em que unidade a Meta conta |
| `viaCasamento` na telemetria | execução | Mede **da produção** se o caminho interativo está mesmo devolvendo o identificador do item |
| Disjuntor por conta | execução | Chatwoot indisponível vira adiamento, não trabalho envenenado em bloco |
| `acaoFinal` obrigatória + recusa de laço de exceção sem teto na **publicação** | execução | O laço 32→34→16 do fluxo real nem chega a nascer no sistema novo |
| `Idempotency-Key` no nó HTTP — **corrigido** para incluir visita e tentativa | execução | Permite que o nó que abre chamado desça de "parar" para "conciliar", encolhendo a fila de trabalho manual |

**O que foi conscientemente recusado dos perdedores:** a chave `@@unique([cwAccountId,
cwConversationId, versaoId])`. Incluir a versão permite duas execuções vivas na mesma conversa em
versões diferentes — dois robôs falando com a mesma pessoa — e proíbe um segundo chamado legítimo
meses depois. O construto correto é o índice único **parcial** por estado ativo.

---

## 2. Modelo de dados

Convenção da casa: `uuid` como chave, nomes em português nos campos de domínio, chaves lógicas para o
Chatwoot (sem `@relation`), `@@index` explícito e comentado. Nenhum modelo existente é alterado —
`RagnabotTenant`, `RagnabotInbox`, `RagnabotProtocolo`, `RagnabotContadorProtocolo`,
`RagnabotAuditoria` e `RagnabotOrigemAutorizada` são consumidos como estão.

### 2.1 Identidade, rascunho e documento

```prisma
// ─────────────────────────────────────────────────────────────────────────────
// IDENTIDADE. Tráfego de cliente NUNCA escreve aqui. `updatedAt` volta a
// significar "quando alguém EDITOU este fluxo" — no sistema medido ele significa
// "quando alguém conversou", porque a telemetria mora dentro do documento (D10).
// ─────────────────────────────────────────────────────────────────────────────
model RagnabotFluxo {
  id                String    @id @default(uuid())
  tenantId          String                                   // → RagnabotTenant.id
  nome              String
  descricao         String?
  estado            String    @default("rascunho")           // rascunho|publicado|desligado
  versaoPublicadaId String?   @unique
  entrada           String    @default("subfluxo")           // caixa|subfluxo|palavra_chave
  cwInboxId         Int?                                     // quando entrada='caixa'
  palavrasChave     Json      @default("[]")                 // [{palavra,tipo,diferenciaMaiuscula}]

  // Freios de execução, por fluxo (o fluxo medido tem DOIS laços reais: 31→4 e 34→16)
  passosPorEvento     Int     @default(50)
  passosTotalMax      Int     @default(500)
  visitasPorNoMax     Int     @default(10)
  ttlExecucaoSegundos Int     @default(82800)                // 23 h: margem de 1 h sobre a janela

  arquivadoEm     DateTime?
  criadoPorUserId String?
  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  @@unique([tenantId, nome])   // nome duplicado na mesma empresa é o D11 nascendo de novo
  @@index([tenantId, estado])
  @@index([cwInboxId])
}

// RASCUNHO em tabela separada. Existe por UM motivo: é o que permite a tabela de
// versões ser estritamente de inserção, sem nenhum caminho de UPDATE.
// `rev` é concorrência otimista — dois administradores no mesmo fluxo é evento real,
// e `rev` divergente devolve 409 em vez de sobrescrever em silêncio.
model RagnabotFluxoRascunho {
  fluxoId             String   @id
  tenantId            String
  documento           Json
  rev                 Int      @default(0)
  validacao           Json?
  atualizadoPorUserId String?
  atualizadoEm        DateTime @updatedAt
}

// ─────────────────────────────────────────────────────────────────────────────
// O DOCUMENTO — IMUTÁVEL, SÓ INSERÇÃO. Duas camadas de defesa, porque o D10
// sobreviveu catorze meses em produção justamente por ninguém perceber:
//   (a) gatilho  rb_recusa_update()  BEFORE UPDATE
//   (b) REVOKE UPDATE ON "RagnabotFluxoVersao" FROM <papel da aplicação>
// e um teste que roda 50 turnos e afirma que `RagnabotFluxo.atualizadoEm` não mudou.
// ─────────────────────────────────────────────────────────────────────────────
model RagnabotFluxoVersao {
  id                 String   @id @default(uuid())
  fluxoId            String
  tenantId           String                        // desnormalizado: todo filtro é por empresa
  numero             Int                           // 1,2,3… monotônico NO TEMPO
  documento          Json                          // { nos:[], arestas:[], variaveis:[] }

  hashDocumento      String                        // sha256 do JSON canônico
  hashEstrutura      String                        // sha256 SÓ do esqueleto: (no.id, no.tipo,
                                                   // saídas ordenadas) + (aresta.de, saida, para).
                                                   // Ignora texto, tempo, limiar e coordenada de tela.
  variaveis          Json      @default("[]")      // [{nome,tipo,obrigatoria,origem}]
  noInicialId        String
  noResgateId        String?                       // OBRIGATÓRIO se houver nó que estaciona (I7)
  perfilLimite       String                        // "whatsapp_cloud@2026-08" — contra o que validou
  validacao          Json      @default("{}")      // problemas no momento da publicação
  modoMigracao       String    @default("fixar")   // fixar|retrofit|retrofit_forcado
  origemVersaoId     String?                       // de onde foi copiada (reversão/duplicação)
  notaPublicacao     String?
  publicadoPorUserId String?
  publicadoEm        DateTime?
  criadoEm           DateTime  @default(now())

  @@unique([fluxoId, numero])
  @@unique([tenantId, id])        // ← chave alvo das FKs COMPOSTAS: o banco recusa junção cruzada
                                  //   entre empresas mesmo se o código errar (sub-fluxo de outra empresa)
  @@index([fluxoId, publicadoEm])
  @@index([hashDocumento])        // detecta fluxo gêmeo (D11). NÃO é unique: reverter republica
                                  // um documento idêntico a uma versão antiga, e isso é legítimo.
  @@index([hashEstrutura])
}
```

> **`hashDocumento` não é único, de propósito.** A regra fica no serviço: documento idêntico à versão
> **vigente** é no-op (clique duplo); idêntico a uma versão **antiga** é reversão e gera versão nova.

### 2.2 Projeção do grafo — onde a integridade tem dentes

```prisma
// Derivada do documento na MESMA transação da publicação. Existe porque as perguntas
// de operação são de conjunto e são péssimas em JSONB: "quais nós usam este segredo?",
// "o nó em que esta execução parou existe na versão nova?", "quais listas podem
// estourar 1024 por interpolação?". `reprojetar(versaoId)` reconstrói e é teste de
// integridade — nunca há duas verdades.
model RagnabotFluxoNo {
  id            String  @id @default(uuid())
  versaoId      String
  tenantId      String
  noId          String                            // id dentro do documento
  tipo          String                            // ver §4
  titulo        String?
  ordem         Int
  estaciona     Boolean @default(false)           // espera resposta do cliente
  efeito        String  @default("nenhum")        // nenhum|repetivel|irrepetivel|condicional
  segredosRef   String[]                          // apelidos de cofre referenciados → ondeUsado()
  destinosRef   String[]                          // hosts externos referenciados → lista de permissão
  resumo        String?                           // ~120 caracteres, para busca no editor

  @@unique([versaoId, noId])
  @@index([versaoId])
  @@index([tenantId, tipo])
}

// ★ A ESTRELA DO MODELO. O fan-out acidental (D5 — duas arestas na mesma saída do
//   TYPEBOT-ENVIO4, com o encerramento pendurado em apenas um dos ramos) passa a ser
//   RECUSADO PELO BANCO. Validador tem defeito, tem caminho que o contorna e tem o
//   botão "publicar mesmo assim" que o documento 19 §4.1 exige que exista.
//   Restrição de banco não tem nada disso.
model RagnabotFluxoAresta {
  id       String @id @default(uuid())
  versaoId String
  de       String
  saida    String
  para     String

  @@unique([versaoId, de, saida])
  @@index([versaoId, para])
}
```

### 2.3 O estado vivo

```prisma
model RagnabotFluxoExecucao {
  id               String    @id @default(uuid())
  tenantId         String
  cwAccountId      Int
  cwConversationId Int
  cwContactId      Int?
  contatoChave     String?                        // telefone normalizado (só dígitos) — janela de 24 h
  protocolo        String?                        // RGT-0000000001 — mata o D12

  fluxoId          String
  versaoId         String                         // versão em que roda AGORA
  versaoInicialId  String                         // com qual começou — a migração fica visível

  noAtualId        String?
  // Configuração RENDERIZADA do nó em que a conversa está PARADA. É o que torna o
  // retrofit seguro: a pessoa está olhando no celular uma mensagem que já saiu, e
  // responde ÀQUILO. Guarda referências, NUNCA binário nem base64.
  noCongelado      Json?
  visitaSeq        Int       @default(0)          // token contra despertar obsoleto
  aguardando       String    @default("nada")     // nada|resposta|temporizador|http|humano
  aguardaDesde     DateTime?                      // início da espera — casamento posicional no tempo
  acordarEm        DateTime?
  saidaAoVencer    String?                        // normalmente 'sem_resposta'
  tentativasNo     Json      @default("{}")       // {noId:{semResposta:n,opcaoInvalida:n}}
  visitasPorNo     Json      @default("{}")
  passosTotal      Int       @default(0)

  vars             Json      @default("{}")       // DADO PESSOAL — purga por retentionDays
  caixaPendente    Json      @default("[]")       // rajada estacionada (teto 10)
  pilha            Json      @default("[]")       // sub-fluxo modo 'chamar': [{versaoId,noRetornoId}]
  ultimaVariavel   String?                        // alvo da política de continuação

  // Trilha compacta [[noId, saida, msDesdeInicio], …], teto 200 + marcador.
  // Responde "por onde essa pessoa passou" com UMA leitura, sem junção.
  trilha           Json      @default("[]")
  trilhaTruncada   Boolean   @default(false)

  estado           String    @default("rodando")
  // rodando | esperando | pausado_humano | pausado_duvida | concluido | abandonado | erro
  motivoFim        String?
  ultimoErro       String?

  // Posse: arrendamento com token de CERCA. Todo UPDATE de avanço leva
  // "AND leaseToken = $meu AND leaseExpiraEm > now()".
  donoWorker       String?
  leaseToken       String?
  leaseExpiraEm    DateTime?

  // Estado pausado tem RELÓGIO e PRAZO próprios. Estado sem relógio é estado que some.
  prazoEm          DateTime?
  escalonamentos   Int       @default(0)

  expiraEm         DateTime                       // min(início+ttl, janela.expiraEm)
  origemExecucaoId String?                        // retomada depois de abandono
  iniciadaEm       DateTime  @default(now())
  atualizadaEm     DateTime  @updatedAt
  encerradaEm      DateTime?

  @@index([estado, acordarEm])        // o despertador vive deste índice
  @@index([estado, leaseExpiraEm])    // varredor de órfãos
  @@index([estado, prazoEm])          // escalador de pausa
  @@index([estado, expiraEm])         // expirador de TTL
  @@index([versaoId, estado])         // "alguma execução viva aponta para esta versão?"
  @@index([tenantId, iniciadaEm])
  @@index([cwAccountId, cwConversationId])
  @@index([protocolo])
}
```

**Migração escrita à mão** (o Prisma não expressa índice único parcial):

```sql
-- UMA execução viva por conversa. Os quatro estados abaixo são os ATIVOS.
-- `pausado_humano` e `pausado_duvida` ficam DENTRO: senão uma mensagem nova do
-- cliente abriria execução nova e ele receberia a saudação outra vez.
-- `abandonado` e `concluido` ficam FORA: retomada legítima precisa poder nascer.
CREATE UNIQUE INDEX rb_exec_uma_viva_por_conversa
  ON "RagnabotFluxoExecucao" ("cwAccountId", "cwConversationId")
  WHERE estado IN ('rodando','esperando','pausado_humano','pausado_duvida');
```

> ⚠️ **Isto é ponto de falha se o vocabulário de estados crescer.** Acrescentar um estado ativo novo
> sem incluí-lo no `WHERE` reabre a porta para duas execuções na mesma conversa, e o sintoma só
> aparece sob concorrência. Por isso existe o teste `estados-ativos-vs-indice.test.mjs`, que lê a
> constante `ESTADOS_ATIVOS` do código, lê a definição do índice em `pg_indexes`, e falha se
> divergirem. É teste, não disciplina.

### 2.4 Entrada, consumo e fila

```prisma
// A ENTRADA BRUTA. Imutável. É a idempotência e é a prova.
model RagnabotFluxoEntrada {
  id                String   @id @default(uuid())

  // Chave NOT NULL CALCULADA. Nunca um par com coluna anulável (dois NULOS não são
  // iguais no Postgres — e o próprio schema da casa registra esse comportamento em
  // RagnabotInbox.activeKey; aqui ele seria um buraco, não um recurso).
  // Com id estável:  "cw:<conta>:<evento>:<tipoObjeto>:<idObjeto>"
  // Sem id estável:  "cw:<conta>:<evento>:h:<sha256 do corpo canonicalizado>"
  //   → o canonicalizador REMOVE campos voláteis (updated_at, last_activity_at,
  //     contadores). Incluir campo que o emissor reescreve ANULA a idempotência:
  //     a reentrega gera chave nova e passa direto.
  chave             String   @unique

  tenantId          String?
  inboxSegredoId    String?                       // POR QUAL segredo entrou (define o escopo)
  cwAccountId       Int?
  cwInboxId         Int?
  cwConversationId  Int?
  cwMessageId       Int?
  wamid             String?                       // id da Meta — dedupe do eco do adaptador direto
  evento            String
  classe            String                        // resposta_cliente | controle | eco_proprio
  corpo             Json                          // REDIGIDO antes do INSERT (§6, achado 26)
  origemEm          DateTime?                     // carimbo de ORIGEM (Meta, ou created_at do Chatwoot)
  atrasoMs          Int?                          // recebidoEm − origemEm → saúde do canal
  resultado         String?                       // aplicado|ignorado|duplicado|recusado|erro
  erro              String?
  recebidaEm        DateTime @default(now())
  processadaEm      DateTime?

  @@index([cwAccountId, cwConversationId, origemEm])
  @@index([resultado, recebidaEm])
  @@index([wamid])
}

// SEGUNDA BARREIRA de idempotência, no CONSUMO. A da entrada protege contra
// reentrega; esta protege contra trabalho ceifado e reprocessado, dreno duplicado e
// migração de fila. Antes de gravar QUALQUER variável a partir de uma mensagem, se o
// cwMessageId já foi consumido por esta execução, descarta e registra 'entrada_repetida'.
model RagnabotFluxoEntradaConsumida {
  execucaoId  String
  cwMessageId Int
  noId        String
  consumidaEm DateTime @default(now())

  @@id([execucaoId, cwMessageId])
}

// FILA DURÁVEL. É o relógio, é a retentativa e é a serialização por conversa.
model RagnabotFluxoFila {
  id             BigInt    @id @default(autoincrement())
  tipo           String    // entrada|despertar|continuar_http|iniciar|conciliar|expirar
  chaveParticao  String    // "conta:conversa" — a unidade de serialização
  tenantId       String?
  execucaoId     String?
  entradaId      String?
  tokenVisita    Int?      // descarta despertar obsoleto (cliente respondeu antes do prazo)
  payload        Json      @default("{}")
  prioridade     Int       @default(100)   // 50 = tráfego de cliente · 200 = campanha
  disponivelEm   DateTime  @default(now())
  status         String    @default("pendente") // pendente|processando|feito|falhou|descartado
  tentativas     Int       @default(0)
  maxTentativas  Int       @default(8)
  ultimoErro     String?
  donoWorker     String?
  travadoEm      DateTime?
  criadoEm       DateTime  @default(now())
  atualizadoEm   DateTime  @updatedAt

  @@index([status, disponivelEm, prioridade])
  @@index([chaveParticao, status, id])
  @@index([execucaoId, status])
  @@index([status, travadoEm])   // ← o CEIFADOR vive deste índice: trabalho preso em
                                 //   'processando' por worker morto congela a conversa
}
```

### 2.5 Caixa de saída de duas fases

```prisma
// A reserva nasce na MESMA transação que avança o estado; a confirmação vem depois
// do efeito. O que fica no meio é o que o conciliador resolve.
model RagnabotFluxoEfeito {
  id                    String    @id @default(uuid())
  execucaoId            String
  tenantId              String
  noId                  String
  visitaSeq             Int
  tentativa             Int       @default(1)
  sufixo                String    @default("")   // destinatário, quando há vários (mata D5/D6:
                                                 // um efeito por destino, e a falha de um não
                                                 // reenvia para o outro)
  // sha256(execucaoId|noId|visitaSeq|tentativa|sufixo). É TAMBÉM o `rgt_efeito` que
  // viaja em content_attributes da mensagem — a nossa marca no destino.
  chave                 String    @unique

  tipo                  String    // msg_texto|msg_lista|msg_botoes|midia|template|nota|
                                  // http|notificar|etiqueta|atribuir|resolver
  politicaEmDuvida      String    @default("conciliar")  // conciliar|reenviar|condicional|seguir|parar
  estadoAnterior        Json?     // carimbo do estado observado, para ESCRITA CONDICIONAL
                                  // (resolver/atribuir/remover etiqueta NÃO são idempotentes)
  status                String    @default("reservado")  // reservado|confirmado|falhou|
                                                         // descartado|duvidoso
  motivoDescarte        String?   // fora_da_janela|limite_meta|estado_mudou|humano_assumiu
  idExterno             String?   // id devolvido pelo destino (id da mensagem no Chatwoot, wamid)
  httpStatus            Int?
  resposta              Json?     // NUNCA corpo cru — ver §6, achado 26
  erro                  String?
  custoEstimadoCentavos Int?      // template pago: torna o prejuízo de um replay visível
  reservadoEm           DateTime  @default(now())
  confirmadoEm          DateTime?

  @@index([status, reservadoEm])     // conciliador
  @@index([execucaoId, visitaSeq])
  @@index([tenantId, tipo, reservadoEm])
}
```

### 2.6 Telemetria, incidentes e saúde do canal

```prisma
// TELEMETRIA FORA DO DOCUMENTO — a correção direta do D10. Só INSERT.
model RagnabotFluxoEvento {
  id            BigInt   @id @default(autoincrement())
  tenantId      String
  versaoId      String
  execucaoId    String
  noId          String?
  tipo          String   // no_entrou|no_saiu|mensagem_enviada|resposta_recebida|sem_resposta|
                         // opcao_invalida|erro_no|texto_cortado|limite_visitas|prazo_adiado_por_canal|
                         // ordem_incerta|entrada_repetida|versao_migrada|resgatado|
                         // entregue_humano|abandonado
  saida         String?
  viaCasamento  String?  // interativo|indice|titulo|prefixo|apelido — se a maioria vier por
                         // índice ou apelido, o menu está mal escrito, e isso aparece sozinho
  latenciaMs    Int?
  cwMessageId   Int?
  detalhe       Json?    // LGPD: NÃO carrega o texto do cliente. UMA exceção, no tipo
                         // 'opcao_invalida': 120 caracteres do que a pessoa digitou, porque
                         // ali o texto É o achado. Herda RagnabotTenant.retentionDays.
  criadoEm      DateTime @default(now())

  @@index([versaoId, noId, tipo, criadoEm])
  @@index([execucaoId, criadoEm])
  @@index([tenantId, tipo, criadoEm])
}

// AGREGADO — FASE 2, com gatilho medido. Deriva 100 % do bruto, então acrescentar
// depois é recarga, não migração de risco. Justificativa para ADIAR: o nó mais
// movimentado medido acumulou 518 apresentações em catorze meses; varrer o bruto
// responde instantaneamente nessa ordem de grandeza. Construir agora é otimizar
// por presunção. Gatilho declarado: ~200 mil eventos/mês por empresa.
model RagnabotFluxoNoMetricaDia {
  id            BigInt   @id @default(autoincrement())
  tenantId      String
  versaoId      String
  noId          String
  dia           DateTime @db.Date
  apresentados  Int      @default(0)
  respondidos   Int      @default(0)
  expirados     Int      @default(0)
  invalidos     Int      @default(0)
  porSaida      Json     @default("{}")
  latenciaP50Ms Int?
  latenciaP95Ms Int?

  @@unique([versaoId, noId, dia])
  @@index([tenantId, dia])
}

// A CAIXA DE ENTRADA DE DEFEITOS DO OPERADOR. Agrupada, não uma linha por evento:
// "CONFIRMACAO · opção inválida · 151 vezes · última há 3 min" é acionável;
// 151 linhas iguais são ruído que se aprende a ignorar.
model RagnabotFluxoIncidente {
  id             String   @id @default(uuid())
  tenantId       String
  versaoId       String
  noId           String
  codigo         String   // catálogo em §4.6
  nivel          String   @default("erro")   // erro|aviso
  mensagem       String                      // para o operador, em português
  comoCorrigir   String?                     // escrito pelo executor que detectou
  amostras       Json     @default("[]")     // até 5, REDIGIDAS
  ocorrencias    Int      @default(1)
  primeiraEm     DateTime @default(now())
  ultimaEm       DateTime @default(now())
  reconhecidoPor String?
  reconhecidoEm  DateTime?
  resolvidoEm    DateTime?

  @@unique([versaoId, noId, codigo])
  @@index([tenantId, resolvidoEm, ultimaEm])
}

// SAÚDE DO CANAL por conta. Existe porque "canal ruim NUNCA é queda" e porque o
// relógio do motor não pode continuar andando enquanto o canal está surdo.
// Duas evidências INDEPENDENTES marcam degradação: falha de SAÍDA (disjuntor) e
// SILÊNCIO anormal de ENTRADA — numa parada total não há falha de saída a detectar
// se ninguém tentar enviar naquela janela.
model RagnabotFluxoCanalSaude {
  cwAccountId     Int      @id
  ultimaEntradaEm DateTime?
  ultimoEnvioOkEm DateTime?
  atrasoP95Ms     Int?
  degradadoDesde  DateTime?
  degradadoAte    DateTime?
  janelas         Json     @default("[]")   // [[inicio,fim], …] últimas 24 h — usado para
                                            // descontar tempo de canal caído do prazo dos nós
  atualizadoEm    DateTime @updatedAt
}
```

### 2.7 Janela de 24 h, cofre, egresso, limites e templates

```prisma
// JANELA DE SERVIÇO DA META — estado de primeira classe.
// ⚠️ A chave é (número DA EMPRESA, destinatário), NÃO (conta, contato): a Ragnatela
// tem DUAS conexões de WhatsApp medidas na mesma empresa (Whatsapps 42 "RAGNATELA" e
// 45 "Suporte Ragnatela"). Uma janela aberta por um número não vale pelo outro.
model RagnabotFluxoJanela {
  id                     String   @id @default(uuid())
  phoneNumberId          String                    // o número DA EMPRESA que recebeu
  destinatarioWaId       String                    // só dígitos
  cwAccountId            Int
  ultimaEntradaEm        DateTime                  // carimbo de ORIGEM, não de recepção
  expiraEm               DateTime
  margemSegurancaSegundos Int     @default(300)    // visível na tela, não escondida em constante
  fechadaPeloDestinoEm   DateTime?                 // a Meta recusou: a nossa contabilidade APRENDE
  atualizadaEm           DateTime @updatedAt

  @@unique([phoneNumberId, destinatarioWaId])
  @@index([expiraEm])
}

// COFRE POR EMPRESA. Valor cifrado com src/utils/crypto.js (AES-256-GCM, ENCRYPTION_KEY).
// NENHUMA rota devolve `valorCifrado` — só o fingerprint, mesmo padrão de
// RagnabotInbox.credentialFingerprint. E NÃO EXISTE cofre do tipo "variável de
// ambiente": o .env deste processo carrega RAGNABOT_PLATFORM_TOKEN, RAGNABOT_DB_URL
// e ENCRYPTION_KEY, e um apelido apontando para lá tornaria o editor de fluxo uma
// leitura arbitrária do ambiente mais privilegiado que temos.
model RagnabotFluxoSegredo {
  id            String    @id @default(uuid())
  tenantId      String
  apelido       String                     // "typebot_token" — é isto que vai no documento
  valorCifrado  String
  fingerprint   String                     // sha256 truncado: mostra que trocou, sem reconstruir
  descricao     String?
  criadoPorUserId String?
  rotacionadoEm DateTime?
  usadoEm       DateTime?
  criadoEm      DateTime  @default(now())

  @@unique([tenantId, apelido])   // resolver() usa findUnique com o tenantId DA EXECUÇÃO.
                                  // findFirst por apelido devolveria a linha de OUTRA empresa.
  @@index([tenantId])
}

// LISTA DE PERMISSÃO DE SAÍDA, por empresa. O nó HTTP é uma URL de texto livre
// escrita pelo cliente — sem cerca, é um primitivo de falsificação de requisição do
// lado do servidor, e a auditoria já mediu esse vetor no Chatwoot.
model RagnabotFluxoDestinoPermitido {
  id              String   @id @default(uuid())
  tenantId        String
  host            String                     // "typebot.io" — sem curinga de terceiro nível
  esquema         String   @default("https")
  portas          Int[]    @default([443])
  aprovadoPorUserId String?
  observacao      String?
  criadoEm        DateTime @default(now())

  @@unique([tenantId, host])
  @@index([tenantId])
}

// LIMITES DO CANAL — tabela, não constante. Os números mudam, e constante espalhada
// em cinco arquivos nunca é reconferida. `unidade` existe porque NINGUÉM MEDIU em
// que unidade a Meta conta caracteres, e `origem` separa regra medida de palpite.
model RagnabotLimiteCanal {
  id          String   @id @default(uuid())
  perfil      String                        // "whatsapp_cloud@2026-08"
  chave       String                        // botoes_max|lista_itens_max|lista_titulo_max|
                                            // lista_descricao_max|lista_botao_max|corpo_max|
                                            // rodape_max|texto_max|janela_servico_horas
  valor       Int
  unidade     String   @default("indefinida") // grafema|ponto_de_codigo|utf16|byte_utf8|
                                              // indefinida|contagem
  origem      String   @default("documentacao") // medido|documentacao
  fonte       String?
  conferidoEm DateTime

  @@unique([perfil, chave])
}

// ESPELHO DOS TEMPLATES DA WABA. O validador consulta antes de deixar publicar
// qualquer caminho que dependa de template: template em análise é fluxo quebrado no ar.
model RagnabotFluxoTemplate {
  id             String   @id @default(uuid())
  tenantId       String
  wabaId         String
  nome           String
  idioma         String   @default("pt_BR")
  categoria      String
  status         String                     // aprovado|em_analise|reprovado|pausado
  componentes    Json                       // estrutura: nº de parâmetros, botões, limites
  sincronizadoEm DateTime @default(now())

  @@unique([tenantId, nome, idioma])
  @@index([tenantId, status])
}

// SEGREDO DO WEBHOOK **POR CAIXA**. É ele que define o escopo — a empresa é
// identificada por QUAL segredo verificou, nunca pelo account.id do corpo.
// Duas linhas ativas por caixa durante a rotação.
model RagnabotFluxoWebhookSegredo {
  id            String    @id @default(uuid())
  tenantId      String
  cwInboxId     Int?
  cwAccountId   Int
  valorCifrado  String
  fingerprint   String
  ativo         Boolean   @default(true)
  expiraEm      DateTime?                   // janela de rotação
  criadoEm      DateTime  @default(now())

  @@index([cwAccountId, ativo])
  @@index([tenantId])
}
```

### 2.8 Migrações, em ordem

| # | migração | conteúdo |
|---:|---|---|
| 1 | `rb_motor_base` | os 18 modelos acima |
| 2 | `rb_indice_unico_parcial` | `rb_exec_uma_viva_por_conversa` (SQL cru) |
| 3 | `rb_versao_imutavel` | função `rb_recusa_update()` + gatilho + `REVOKE UPDATE` para o papel da aplicação |
| 4 | `rb_fk_compostas` | FKs compostas `(tenantId, versaoId)` de nó, aresta e execução para `RagnabotFluxoVersao(tenantId, id)` |
| 5 | `rb_poda` | funções de poda chamadas pelo vigia podador |

> ⚠️ **Três coisas deste modelo não cabem no `schema.prisma`:** o índice único parcial, o `REVOKE` e
> as FKs compostas. Um `prisma db push` num ambiente derruba as três em silêncio. Mitigação: arquivos
> de migração versionados no git **mais** um teste que consulta `pg_indexes`, `pg_trigger` e
> `information_schema.role_table_grants` e falha se sumirem.

### 2.9 Retenção

| tabela | retenção | por quê |
|---|---|---|
| `RagnabotFluxoFila` (feito/descartado) | 7 dias | é operacional, não é prova |
| `RagnabotFluxoEntrada` | `RagnabotTenant.retentionDays` (padrão 365); `corpo` anonimizado aos 90 dias | LGPD; o campo já existe no schema |
| `RagnabotFluxoEntradaConsumida` | 30 dias | só serve enquanto a execução vive |
| `RagnabotFluxoEvento` | 30 dias no grão fino; depois só o agregado. **Poda anonimiza `detalhe`, não apaga a linha** | apagar a linha destrói o fato contável junto com o dado pessoal |
| `RagnabotFluxoEfeito` | 180 dias | é a prova de "nós avisamos o cliente?" e do que custou |
| `RagnabotFluxoExecucao` encerradas | 180 dias; `vars` limpas aos 30 | `vars` carrega dado pessoal |
| `RagnabotFluxoVersao` | **nunca apagada** | apagar versão órfã telemetria e auditoria |

> **Conflito declarado, não resolvido por mim:** `RagnabotTenant.retentionDays` (padrão 365) pode
> discordar dos prazos acima. Não encontrei a regra escrita que diga qual vence. Precisa da decisão de
> quem responde por LGPD **antes** da fatia que liga a poda.

---

## 3. Máquina de estado

### 3.1 Os estados e as transições

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
   (1ª mensagem)    ▼                                              │
  ────────────► [rodando] ──envia e precisa esperar──► [esperando] ─┘  (resposta / prazo)
                    │  ▲                                    │
                    │  └────────── retomada ────────────────┘
                    │
                    ├── efeito irreversível DUVIDOSO ──► [pausado_duvida] ──┐
                    │                                     (prazo 15 min,    │
                    │                                      escala, mensagem │
                    │                                      honesta JÁ)      │
                    ├── humano assumiu ───────────────► [pausado_humano] ───┤
                    │                                     (prazo 15 min,    │
                    │                                      volta se devolver)│
                    │                                                        │
                    ├── nó terminal ─────────────────► [concluido]           │
                    ├── TTL / janela vencida ────────► [abandonado] ◄────────┘
                    └── teto de passos, erro fatal ──► [erro]
```

Os quatro primeiros são **ativos** e estão dentro do índice único parcial. `concluido`,
`abandonado` e `erro` são terminais e ficam fora, o que permite a retomada legítima — o cliente
escreve de novo dias depois, nasce execução nova com `origemExecucaoId` apontando para a anterior e
`vars` herdadas conforme `RagnabotFluxo.retomada` (`reiniciar` é o padrão). **O protocolo não muda**:
ele é da conversa, e `ragnabot-protocolo.service.js` já é idempotente por
`@@unique([cwAccountId, cwConversationId])`.

### 3.2 O ciclo de um evento, passo a passo

#### Etapa A — Portaria (`POST /api/ragnabot/fluxo/webhook`)

1. Lê o segredo **do cabeçalho** `x-ragnabot-fluxo-token`. **Nunca da query string** — a política
   §13 do `CLAUDE.md` grava a linha de acesso inteira num log dedicado por site, e segredo em URL
   entra no log.
2. Procura o segredo entre os `RagnabotFluxoWebhookSegredo` ativos, com comparação em tempo
   constante. **A empresa é definida por qual segredo verificou.** O `account.id` do corpo é apenas
   **conferido** contra ela; divergiu, recusa com 401 e registra.
3. Classifica o evento: `resposta_cliente` (`message_created` com `message_type='incoming'` **e**
   `sender_type='Contact'`), `eco_proprio` (saída que carrega a nossa marca `rgt_efeito`), ou
   `controle` (criação de conversa, mudança de status, atribuição). **Só `resposta_cliente` é
   candidata a responder um nó.** Criação de conversa nunca é resposta de pergunta.
4. Calcula `origemEm` e `atrasoMs`, e atualiza `RagnabotFluxoCanalSaude`.
5. `INSERT` idempotente em `RagnabotFluxoEntrada` com `ON CONFLICT (chave) DO NOTHING`. Zero linhas
   significa reentrega: responde 200 e para.
6. Se é mensagem de entrada, atualiza `RagnabotFluxoJanela` **pelo carimbo de origem**, na mesma
   transação.
7. Enfileira o trabalho na mesma transação.
8. **COMMIT. Só então `res.json({ ok: true })`.**

#### Etapa B — Executor: escolher, tomar posse, drenar

A ordem aqui é a correção do defeito mais sutil do desenho original. **Posse antes de reivindicação.**

```sql
-- B1. candidatos, sem bloquear ninguém, e já excluindo partição arrendada
SELECT f.id, f."chaveParticao", f."execucaoId", f.tipo, f.payload, f."tokenVisita"
  FROM "RagnabotFluxoFila" f
 WHERE f.status = 'pendente' AND f."disponivelEm" <= now()
   AND NOT EXISTS (SELECT 1 FROM "RagnabotFluxoExecucao" e
                    WHERE e.id = f."execucaoId" AND e."leaseExpiraEm" > now())
 ORDER BY f.prioridade, f."disponivelEm", f.id
 LIMIT 20;
```

```sql
-- B2. tomar posse: comparar-e-trocar. Ninguém ESPERA a posse.
UPDATE "RagnabotFluxoExecucao"
   SET "donoWorker" = $2,
       "leaseToken" = gen_random_uuid()::text,
       "leaseExpiraEm" = now() + interval '30 seconds'
 WHERE id = $1
   AND ("leaseExpiraEm" IS NULL OR "leaseExpiraEm" < now())
RETURNING "leaseToken";
```

Zero linhas significa que outro executor tem a posse. **Ele ignora o candidato nesta rodada e segue
para o próximo** — não marca como em processamento, não incrementa tentativas, não adia. Isso elimina
o efeito colateral de queimar tentativas de um trabalho sadio só porque outro processo estava com a
conversa.

Com a posse na mão, a **mesma transação** marca em processamento **todos** os trabalhos pendentes e
disponíveis daquela partição — a rajada inteira, não um item — com `donoWorker = eu`. O dreno só
consome linhas que ele mesmo marcou (`WHERE donoWorker = $eu AND status='processando'`), nunca um
`status='pendente'` genérico, que por definição é território de outro.

**Para a PRIMEIRA mensagem**, quando ainda não existe execução para arrendar, a serialização é a da
partição: `pg_try_advisory_xact_lock(hashtextextended(chaveParticao, 0))` segurado **do início ao fim**
da transação que reivindica e cria a execução, soltando no commit. O índice único parcial é a segunda
barreira, não a primeira; a corrida vira `P2002`, tratado recuperando a existente — o mesmo padrão que
`ragnabot-protocolo.service.js` já usa e já provou.

Batimento de posse a cada 10 segundos enquanto o passo roda (`renovarPosse`). E **todo** `UPDATE` de
avanço carrega a cerca:

```sql
UPDATE "RagnabotFluxoExecucao"
   SET "noAtualId" = $2, "visitaSeq" = "visitaSeq" + 1, vars = $4, ...
 WHERE id = $1 AND "leaseToken" = $3 AND "leaseExpiraEm" > now();
```

Zero linhas afetadas ⇒ `PossePerdida` ⇒ a transação inteira volta atrás, **incluindo a reserva do
efeito**. Nenhum efeito é executado.

#### Etapa C — Coleta de rajada: o problema semântico das duas mensagens

Serializar por conversa resolve a corrida técnica e cria um erro pior: a segunda mensagem do cliente
seria consumida pela **próxima** pergunta. O cliente escreve «preciso de ajuda» e depois «o servidor
não liga», e a segunda vira o e-mail dele. As respostas trocam de lugar em silêncio — o pior tipo de
defeito, porque ninguém descobre.

**Ordem da rajada:** por `origemEm` (carimbo do cliente), com `cwMessageId` como desempate e
`RagnabotFluxoFila.id` só como último critério. `RagnabotFluxoFila.id` sozinho é a ordem de chegada à
**nossa** porta: com duas réplicas de portaria e latência desigual, duas mensagens quase simultâneas
entram invertidas, e a regra "vale a última" escolhe exatamente o contrário do que a pessoa quis.

**Regra de consumo, por estado:**

| estado da execução | o que acontece com a rajada | por quê |
|---|---|---|
| `aguardando='resposta'` em nó `pergunta` | **concatena** com `\n` na variável, na ordem disponível | o cliente parte o pensamento em várias mensagens; é onde o `detalhes` deste fluxo sofre |
| `aguardando='resposta'` em nó `lista`/`botoes` | usa a **última**, descarta as anteriores | quem toca duas vezes está se corrigindo |
| **ordem não provável** (duas entradas a menos de 2 s sem carimbo de origem confiável) | em `lista`/`botoes`: **não aplica "vale a última"** — responde `opcao_invalida` e repergunta. Em `pergunta`: concatena e grava evento `ordem_incerta`, e a nota interna mostra as duas com horário | escolher a opção errada dispara efeito irreversível; concatenar duas frases fora de ordem ainda preserva a informação |
| `aguardando='temporizador'`, último nó consumido foi `pergunta`, dentro de `politicaContinuacao.janelaSegundos` (padrão 20 s) | **anexa** à variável da pergunta anterior | o motor impõe **22 segundos** de silêncio medidos neste fluxo, e a continuação natural do cliente cai bem no meio deles |
| fora disso | vai para `caixaPendente` (teto 10) | é contexto, não resposta |
| item da `caixaPendente` quando um nó de pergunta **começa** a esperar | vira **nota interna** («o cliente escreveu isto antes da pergunta: …») e é descartado como resposta, salvo `aceitaAdiantada: true` | responder pergunta que ainda não foi feita é o jeito clássico de trocar as respostas de lugar |

**Casamento posicional no tempo.** Toda entrada carrega `origemEm`, e o motor **recusa** casar uma
mensagem com um nó que só passou a esperar depois daquele carimbo (`origemEm < execucao.aguardaDesde`).
Mensagem anterior ao início da espera do nó atual não é resposta dele — é nota interna com texto e
horário. Sem essa regra, uma mensagem que chegou atrasada porque o canal esteve surdo é gravada na
variável errada, e o chamado nasce com os campos trocados.

#### Etapa D — O passo, e onde exatamente fica o commit

```
T1 (uma transação, curta, ZERO chamada de rede dentro):
     SELECT execucao FOR UPDATE
     conferir lease + cerca
     conferir se a entrada já foi consumida (RagnabotFluxoEntradaConsumida)
     resolver a saída do nó atual → aresta ÚNICA → nó de destino
     calcular varsPatch (interpolação estrutural, passada única — §4.8)
     conferir janela de 24 h, disjuntor e saúde do canal
     INSERT RagnabotFluxoEfeito (status='reservado', chave determinística)   ← a RESERVA
     UPDATE RagnabotFluxoExecucao ... AND leaseToken = $token                ← a CERCA
     INSERT RagnabotFluxoEvento + RagnabotFluxoEntradaConsumida
   COMMIT
efeito (FORA de transação): PortaCanal → Chatwoot / Cloud API / egresso
T2 (curta): UPDATE RagnabotFluxoEfeito → 'confirmado' | 'falhou' | 'descartado'
            se falhou e o nó tem saída de erro → enfileira continuação por ela
```

**Conferência no último momento responsável.** Antes de qualquer envio ao cliente, o adaptador faz
`GET /conversations/{id}` (cache de 10 segundos) e **recusa** enviar se a conversa tiver responsável
que não é o bot, ou se o status mudou. Uma leitura por envio é barata; torcer para o evento de
atribuição chegar é como o robô acaba falando por cima da analista.

#### Etapa E — Efeitos e a política de dúvida

Exatamente-uma-vez não existe atravessando uma fronteira de rede sem deduplicação no destinatário, e
a Cloud API não oferece cabeçalho de idempotência. Então cada efeito é classificado e cada nó declara
o que fazer no caso duvidoso.

| classe | exemplos | política padrão em dúvida |
|---|---|---|
| `nenhum` | `inicio`, `variavel`, `condicao` | não gera efeito |
| `repetivel` | aplicar etiqueta que já existe, aviso interno | `reenviar` |
| **`condicional`** | `resolver`, `atribuir`, **remover** etiqueta | `condicional` |
| `irrepetivel` | `texto`, `midia`, `lista`, `botoes`, `nota` | `conciliar` |
| `irrepetivel` caro/irreversível | `http` que cria chamado, `template` pago | `parar` |

**`condicional` é a correção de um erro fácil de cometer.** `resolver` e `atribuir` **não** são
idempotentes: são escritas de "último a escrever vence" sobre um estado compartilhado e editável por
humano. Reaplicar 45 segundos depois fecha a conversa embaixo da analista que acabou de assumir, ou
rouba a conversa dela. Por isso a reserva carimba `estadoAnterior` (`{status, assigneeId, labels}`) e
o conciliador só reaplica se o estado **atual** ainda for igual ao carimbado; diferente ⇒
`descartado` com `motivoDescarte='estado_mudou'` e nota privada.

**`conciliar` funciona porque a marca é nossa.** Toda mensagem criada pelo motor carrega
`content_attributes.rgt_efeito = <chave do efeito>`. Conciliar é procurar a nossa chave, não depender
de `source_id` — que em canal de WhatsApp é preenchido pelo provedor e pode não ser um campo que o
criador define.

**Retentativa de efeito irrepetível sai do cliente HTTP.** Tempo limite esgotado **não é falha, é
dúvida**: uma tentativa só, o efeito fica `reservado`, e quem decide é o conciliador — e só depois de
uma conciliação **negativa**. Retentativa cega dentro do cliente é como três listas idênticas chegam
no celular do cliente quando o Chatwoot está apenas **lento**, não fora: nesse caso a caixa de saída
não protege nada, porque ninguém morreu.

**`parar`** congela a execução em `pausado_duvida` — e a mensagem honesta ao cliente é o **primeiro**
efeito desse caminho, despachada na mesma transação em que a execução congela, enquanto a janela está
comprovadamente aberta (está: o cliente acabou de escrever). Nunca deixada para "quando um humano
decidir", porque aí a janela já é outra.

#### Etapa F — Temporizadores, prazos e o que sobrevive a reinício

Nada em memória. Nenhum `setTimeout`. Este fluxo tem **14 nós de espera** somando **22 segundos** de
pausa no caminho feliz, e um `RollingUpdate` no Kubernetes com temporizador em memória abandonaria em
silêncio toda conversa que estivesse dentro de uma pausa.

Todo `espera` e todo prazo de resposta gravam **duas** coisas: `RagnabotFluxoExecucao.acordarEm`
(cópia desnormalizada, para o varredor) e uma linha na fila com `tipo='despertar'`,
`disponivelEm = acordarEm` e `tokenVisita = visitaSeq`. Ao processar, se
`job.tokenVisita !== execucao.visitaSeq`, o cliente respondeu antes do prazo e o despertar é
descartado. Sem isso, resposta e expiração mandam a conversa por dois caminhos ao mesmo tempo.

**Prazo medido em tempo de canal de pé.** Antes de tomar `sem_resposta`, o despertador subtrai a
interseção entre `[aguardaDesde, agora]` e as janelas de degradação registradas em
`RagnabotFluxoCanalSaude`. Se o que sobra é menor que o prazo do nó, ele **não** toma a exceção:
adia `acordarEm` e grava `prazo_adiado_por_canal`. Um prazo de 4 minutos e um atraso mediano de 6
minutos são matematicamente incompatíveis — nessa condição `sem_resposta` não pode significar "o
cliente não respondeu", e o motor não pode afirmar que significa.

**Janela de graça reversível.** Se a resposta do cliente chega até 3 minutos depois de um
`sem_resposta` cujo **único** efeito foi uma repergunta, o motor volta ao nó da pergunta com
`visitaSeq` novo e consome a resposta ali. Se a exceção já transferiu para humano, **não volta** —
vira nota interna.

#### Etapa G — Os seis vigias

| vigia | período | o que faz |
|---|---:|---|
| **ceifador de jobs** | 30 s | devolve a `pendente` trabalho preso em `processando` há mais de 90 s **cuja execução não tem lease vivo** (90 s = 3× o arrendamento, para nunca ceifar trabalho de processo vivo que está renovando) |
| **varredor de órfãos** | 60 s | reenfileira execução em `rodando` **ou** `esperando` com lease vencido e sem trabalho pendente ou recém-travado |
| **conciliador** | 30 s | resolve efeito `reservado` com mais de 45 s pela `politicaEmDuvida` do nó |
| **expirador de TTL** | 60 s | marca `abandonado` o que passou de `expiraEm` |
| **escalador de pausa** | 60 s | pausa vencida sem alguém assumir: escala para o segundo destinatário, por canal diferente, e manda nova mensagem ao cliente com o protocolo |
| **podador** | diário | aplica §2.9 |

A consulta do varredor precisa cobrir os dois estados **e** aceitar trabalho recém-travado como prova
de que alguém está cuidando — trabalho **velho** em `processando` não é prova de nada:

```sql
SELECT e.id FROM "RagnabotFluxoExecucao" e
 WHERE e.estado IN ('rodando','esperando')
   AND (e."leaseExpiraEm" IS NULL OR e."leaseExpiraEm" < now() - interval '60 seconds')
   AND NOT EXISTS (
        SELECT 1 FROM "RagnabotFluxoFila" f
         WHERE f."execucaoId" = e.id
           AND (f.status = 'pendente'
                OR (f.status = 'processando' AND f."travadoEm" > now() - interval '90 seconds')));
```

#### Etapa H — Encerramento gracioso

`SIGTERM` ⇒ (a) para de reivindicar; (b) termina os passos em voo, teto de 25 s; (c) **devolve a
`pendente`** todo trabalho que este processo marcou e não terminou; (d) **libera as posses
explicitamente** (`leaseExpiraEm = null`); (e) sai. `terminationGracePeriodSeconds: 40`.

Sem (c) e (d), cada implantação deixa N conversas travadas por até 30 segundos — para o cliente é o
robô ficando mudo bem no meio da conversa, e num `RollingUpdate` isso acontece toda vez. Encaixa na
regra da casa de só reiniciar sem sessão ativa, com uma diferença que precisa estar escrita: aqui a
"sessão" é a conversa de um cliente, e ela **não** aparece em `/api/health/active-sessions`. Por isso
a proteção tem de estar no processo, não no procedimento.

### 3.3 Freios contra laço e explosão

O fluxo medido tem **dois laços reais** (nó 31 → nó 4 «Recomece», nó 34 → nó 16 «Não entendi»), e o
segundo é acionado justamente pelas **151 de 518** apresentações sem resposta ou com opção inválida.

| freio | padrão | ao estourar |
|---|---:|---|
| `passosPorEvento` | 50 | para o passo e enfileira continuação em 1 s — cede a vez, não perde a conversa |
| `passosTotalMax` | 500 | `estado='erro'`, incidente `TETO_DE_PASSOS` com o caminho percorrido, transfere |
| `visitasPorNoMax` | 10 | força `opcao_invalida` e, na visita seguinte, executa a `acaoFinal` do nó |
| `maxTentativas` da fila | 8 | `status='falhou'` + incidente (trabalho envenenado) |
| recuo entre tentativas | `min(2^n, 300) s` ± 20 % de variação | evita rebanho batendo no terceiro que caiu |
| disjuntor por conta | 5 falhas seguidas → abre 60 s | Chatwoot fora do ar vira adiamento, não trabalho morto em bloco |

### 3.4 Ciclo de vida da versão, com gente dentro

```
rascunho ──publicar()──► versão N (imutável)
                          ├─ modo=fixar             → execuções vivas ficam em N−1
                          ├─ modo=retrofit          → passam para N (só o nó parado fica congelado)
                          └─ modo=retrofit_forcado  → passam para N; as que estão num nó que
                                                      sumiu vão ao nó de RESGATE (evento 'resgatado')
```

`classificarMudanca(docA, docB)` compara `hashEstrutura`. Igual ⇒ `compativel` ⇒ o editor oferece
**retrofit** como padrão. Diferente ⇒ `estrutural` ⇒ oferece **fixar** como padrão, e
`retrofit_forcado` exige 2FA, prévia numérica («47 conversas seriam movidas, 3 seriam resgatadas»),
teto de lote e registro em `RagnabotAuditoria` com antes/depois.

**Nada de reencaixe por semelhança.** Nunca mandar uma execução órfã para o nó "mais parecido" por
título, posição ou similaridade: erra em silêncio, e errar em silêncio no meio de uma conversa de
cliente é pior que parar.

**Reverter copia para a frente.** `reverterPara(fluxoId, numero)` copia o documento antigo e publica
como versão nova, com `origemVersaoId` preenchido. Se o ponteiro voltasse, o número da versão deixaria
de mapear um período contínuo e toda comparação entre versões ficaria envenenada — e é justamente essa
comparação que transforma a recomendação 9 do documento 25 («reduzir os 22 segundos de pausa e medir o
efeito sobre os 29 % de abandono») de opinião em medição:

```sql
SELECT v.numero,
       count(*)                                                          AS execucoes,
       count(*) FILTER (WHERE e.estado = 'concluido')::float
         / nullif(count(*), 0)                                           AS taxa_conclusao,
       avg(extract(epoch FROM e."encerradaEm" - e."iniciadaEm"))         AS segundos_medios
  FROM "RagnabotFluxoExecucao" e
  JOIN "RagnabotFluxoVersao"   v ON v.id = e."versaoId"
 WHERE e."fluxoId" = $1
 GROUP BY v.numero ORDER BY v.numero;
```

### 3.5 Sub-fluxo é quadro de pilha, não execução aninhada

`pilha` guarda `[{versaoId, noRetornoId}]`. `chamar` empilha; `saltar` **substitui** o quadro do topo
(é o que o fluxo medido usa nas duas chamadas — `fluxoNode` entrega o controle e não volta). A razão é
operacional: «por onde essa pessoa passou» precisa devolver uma linha contínua, e o fluxo real
atravessa três fluxos (`Principal NORMAL` → `SUPORTE` → `ABERTURA DE CHAMADO`) numa conversa só. Com
execução por fluxo, a trilha viraria junção recursiva e «em qual fluxo esta conversa está?» ficaria
ambíguo na tela do atendente.

**A travessia é sempre resolvida com a empresa junto.** Na publicação e na execução — e também **ao
retomar** uma execução que já tem pilha gravada, porque a versão pode ter sido arquivada desde que o
quadro foi empilhado. O `tenantId` usado é o **da execução**, nunca o do fluxo chamado.

---

## 4. Catálogo de nós

### 4.1 O contrato — quatro funções, um arquivo por tipo

Cada tipo vive em `src/motor/nos/<tipo>.js` e exporta o mesmo objeto:

```js
export default {
  tipo: 'lista',
  efeito: 'irrepetivel',            // nenhum|repetivel|condicional|irrepetivel
  politicaEmDuvida: 'conciliar',    // conciliar|reenviar|condicional|seguir|parar
  estaciona: true,                  // espera resposta do cliente
  aceitaModeloFora: false,          // pode ser entregue por template fora da janela? (§4.5)

  /** Saídas declaradas. O editor desenha os conectores a partir daqui. */
  saidas: (config) => [...config.itens.map(i => i.id), 'sem_resposta', 'opcao_invalida', 'erro'],

  /** PUBLICAÇÃO. Roda no editor a cada mudança (com recuo de 300 ms) e de novo ao publicar.
   *  → Problema[]  { nivel:'erro'|'aviso', codigo, campo, mensagem, comoCorrigir, acaoRapida? } */
  validar(no, ctx) {},

  /** Monta o que SAIRIA, sem enviar. A MESMA função alimenta a prévia do editor,
   *  o modo de teste e o envio real — por isso o aviso não pode divergir da execução. */
  preparar(no, ctx) {},             // → IntencaoSaida | IntencaoSaida[]

  /** EFEITO. Recebe ContextoExecucao, devolve ResultadoNo. Não conhece Chatwoot nem Meta. */
  async executar(ctx) {},

  /** Só em nós que estacionam: interpreta a resposta e decide a saída. */
  async receber(ctx, entrada) {},   // → { saida, varsPatch, viaCasamento }
};
```

`ContextoExecucao`:

```js
{
  no,          // nó já normalizado (do noCongelado, quando é retomada de nó parado)
  vars,        // leitura das variáveis
  entrada,     // { texto, interativo:{tipo,id,titulo}, anexos, origemEm, cwMessageId, wamid } | null
  execucao,    // { id, tenantId, cwAccountId, cwConversationId, protocolo, visitaSeq, tentativasNo }
  canal,       // PortaCanal — ÚNICA saída permitida em direção ao cliente
  egresso,     // cliente do worker de saída — ÚNICA saída permitida em direção a terceiro
  cofre,       // resolver(apelido) → valor. O tenantId vem da EXECUÇÃO, nunca do nó.
  limites,     // perfil de limites da caixa, com unidade e origem
  janela,      // { aberta, expiraEm, margemSegurancaSegundos }
  agora,       // Date vinda do BANCO (now()), nunca Date.now() do processo
  registrar,   // (evento) => void — telemetria
  incidente,   // (codigo, dados) => void — caixa de defeitos do operador
}
```

`ResultadoNo` — união fechada; o motor não aceita outra coisa:

```js
{ tipo:'seguir',   saida:'padrao' }
{ tipo:'aguardar', motivo:'resposta'|'temporizador', acordarEm, saidaAoVencer:'sem_resposta' }
{ tipo:'saltar',   fluxoId, modo:'chamar'|'saltar' }
{ tipo:'terminar', estado:'concluido'|'transferido' }
{ tipo:'falhar',   saida:'erro'|'erro_interno'|'sem_janela',
                   incidente:{ codigo, mensagemOperador, mensagemCliente, reparavel } }
```

### 4.2 Os quinze tipos

| tipo | efeito | estaciona | saídas | o que faz |
|---|---|:--:|---|---|
| `inicio` | nenhum | não | `padrao` | emite o protocolo (idempotente por conversa) e grava o carimbo de fluxo/versão na conversa |
| `texto` | irrepetível | não | `padrao`, `erro`, `sem_janela` | interpola e envia |
| `midia` | irrepetível | não | `padrao`, `erro`, `sem_janela` | envia anexo, conferindo tipo e tamanho pelo perfil |
| `pergunta` | irrepetível | **sim** | `padrao`, `sem_resposta`, `opcao_invalida`, `erro` | pergunta, valida a resposta e repergunta (A2/A4) |
| `lista` | irrepetível | **sim** | uma por item + as três de exceção | lista interativa, com orçamento de caracteres (A1/A5) |
| `botoes` | irrepetível | **sim** | uma por botão + as três | máximo estrutural de botões, bloqueante na publicação |
| `espera` | nenhum | não | `padrao` | grava `acordarEm` na fila |
| `condicao` | nenhum | não | `verdadeiro`, `falso` | regras sobre variáveis, dia e hora (fuso da empresa) |
| `http` | irrepetível | não | `sucesso`, `erro` | chamada externa pelo egresso, com `sucessoQuando` e extração (A3/A8) |
| `variavel` | nenhum | não | `padrao`, `erro` | atribui e calcula: `cortar`, `higienizar`, `maiusculas`, `somenteDigitos`, `formatarData`, `concatenar` (A5) |
| `etiqueta` | repetível (aplicar) / **condicional** (remover) | não | `padrao`, `erro_interno` | aplica ou remove etiqueta |
| `time` | condicional | não | *(terminal)* | atribui a um time e sai do bot |
| `notificar` | depende do canal | não | `padrao`, `erro_interno` | avisa destinatário **nomeado**, N destinos numa chamada (A7) |
| `subfluxo` | nenhum | não | `padrao` (só em `chamar`) | `chamar` empilha · `saltar` substitui o quadro (A6) |
| `encerrar` | irrepetível + condicional | não | *(terminal)* | despede-se, resolve a conversa, avaliação **opcional** |

### 4.3 Os oito acréscimos do §11 do documento 25 — onde cada um mora

| # | acréscimo | onde está resolvido |
|---:|---|---|
| **A1** | Saídas de exceção padronizadas | **Geradas pelo motor**, não pelo autor, em todo nó que estaciona (§4.4). Deixar como conector opcional garante que metade dos fluxos esquece — e a medição diz que 151 de 518 apresentações vivem ali |
| **A2** | Tempo limite com valor **e unidade** obrigatórios | `esperaResposta: { valor, unidade }`, tipado no schema do nó. O validador recusa unidade ausente; o tradutor do legado **recusa adivinhar** (§4.9) |
| **A3** | Extração de campo e saída de erro no HTTP | `extrair[]` + `sucessoQuando` + saída `erro` obrigatória no grafo, recusada pelo validador se ficar órfã (§4.5) |
| **A4** | Validação e repergunta | `validacao` no nó `pergunta` (`email`, `telefone`, `cpf`, `regex`, `tamanhoMin`) + `excecoes.opcaoInvalida.tentativas` |
| **A5** | Definir variável / montar texto | Tipo `variavel` + **orçamento de caracteres declarado** no campo interpolado (§4.6) |
| **A6** | Semântica de sub-fluxo | `modo: 'chamar' \| 'saltar'`, explícito e obrigatório; `chamar` empilha, `saltar` substitui |
| **A7** | Disparo paralelo declarado | Proibido pelo banco (`@@unique([versaoId, de, saida])`); quem quer paralelo usa `notificar` com **lista de destinatários**, cada um virando um efeito com `sufixo` próprio |
| **A8** | Segredo por referência | `{"cofre":"typebot_token"}` no documento; resolução por `(tenantId da execução, apelido)`; segredo literal **bloqueia** a publicação |

### 4.4 Saídas de exceção — o padrão obrigatório

Todo nó que estaciona recebe do **motor** três saídas, mais uma de nível de execução que não é saída
de nó:

| saída | quando | quem gera |
|---|---|---|
| `sem_resposta` | prazo venceu **em tempo de canal de pé** | despertador |
| `opcao_invalida` | veio resposta que não casou com opção nenhuma | `receber()` do executor |
| `erro` | o envio ao **cliente** falhou | PortaCanal |
| `erro_interno` | um efeito **interno** falhou (aviso, etiqueta, atribuição) | PortaCanal |
| *(nível de execução)* `interrompido` | humano assumiu | portaria/adaptador |

> **`erro_interno` é separado de propósito.** Falha de encanamento interno **jamais** pode tomar a
> mesma saída que falha de conversa com o cliente. Sem essa separação, o aviso ao plantonista que não
> saiu derruba o atendimento de quem está do outro lado — o cliente é transferido a um humano porque
> o Fernando não recebeu uma mensagem. `erro_interno` segue o fluxo e abre incidente.

Configuração obrigatória, com teto:

```jsonc
"excecoes": {
  "semResposta": {
    "esperar": { "valor": 4, "unidade": "minutos" },     // A2 — unidade OBRIGATÓRIA
    "tentativas": 2,
    "reforco": "Ainda estou por aqui. Escolha uma das opções acima, por favor.",
    "acaoFinal": "transferir_time", "time": "Suporte"
  },
  "opcaoInvalida": {
    "tentativas": 2,
    "reforco": "Não entendi. Responda com o *número* da opção (1, 2 ou 3).",
    "acaoFinal": "transferir_time", "time": "Suporte"
  }
}
```

`acaoFinal` ∈ `transferir_time` · `encerrar` · `ir_para_no` · `seguir_saida`. **O validador recusa a
publicação** (`LACO_DE_EXCECAO_SEM_TETO`) de um nó cuja saída de exceção volte a ele mesmo sem
`tentativas` finito. O fluxo real faz exatamente isso — 32 → 34 → 16 para sempre — e é a explicação
estrutural do abandono medido.

**O reforço e a mensagem de `acaoFinal` são mensagem livre**, portanto inexistentes fora da janela. Ao
acordar por prazo, o motor **reconfere a janela antes de tentar o reforço**: fechada, pula direto para
a `acaoFinal` (transferir e registrar), sem gastar uma tentativa numa mensagem que a Meta vai recusar.
E a nota interna distingue os dois motivos — «o robô parou porque a janela fechou» é informação
diferente de «o cliente sumiu», e é ela que o analista precisa de madrugada.

**Casamento de resposta — escada determinística**, em `src/motor/casar-opcao.js`:

```js
/** @returns {{ id:string, via:'interativo'|'indice'|'titulo'|'prefixo'|'apelido' } | null} */
export function casarOpcao(entrada, itens) { /* … */ }
```

1. `interactive.list_reply.id` / `button_reply.id` — o caso canônico, exato;
2. índice numérico (`"1"`, `"2"`) — posição do item;
3. título exato normalizado (minúsculas, sem acento, sem emoji, aparado);
4. prefixo único do título, mínimo 4 caracteres, **só se não for ambíguo**;
5. `apelidos: ["sim","confirmo","ok","pode abrir"]` declarados por item no editor;
6. nada disso → `opcao_invalida`.

Sem casamento aproximado e sem modelo de linguagem na primeira versão. Confundir «Sim! Abra o
chamado!» com «Não! Recomece!» abre um chamado que a pessoa não pediu ou joga fora cinco perguntas já
respondidas; errar para o lado de `opcao_invalida` custa uma repergunta que agora tem teto e destino.
O `via` é gravado na telemetria: se a maioria vier por índice ou apelido, o menu está mal escrito, e
isso aparece sozinho.

### 4.5 O nó `http` — o contrato que mata o D3

```jsonc
{ "id": "n_registrar_chamado", "tipo": "http",
  "config": {
    "metodo": "POST",
    "url": "https://{{host_aprovado}}/api/v1/chamados",
    "cabecalhos": { "Authorization": { "cofre": "erp_bearer" } },
    "corpo": { "protocolo": "{{protocolo}}", "assunto": "{{assunto}}",
               "descricao": "{{detalhes}}", "email": "{{email}}", "empresa": "{{empresa}}" },
    "tempoLimiteMs": 15000,
    "tentativas": { "max": 1 },                       // irrepetível: uma só. Dúvida é do conciliador.
    "idempotencia": {
      "cabecalho": "Idempotency-Key",
      "de": "chaveEfeito"                             // = sha256(execucao|no|visita|tentativa|sufixo)
    },
    "sucessoQuando": { "status": [200, 201],
                       "e": [{ "caminho": "data.chamadoId", "existe": true }] },
    "extrair": [{ "caminho": "data.chamadoId", "para": "chamado", "obrigatorio": true }],
    "registrarResposta": "resumo"                      // resumo | nenhum — NUNCA corpo cru
  },
  "saidas": ["sucesso", "erro"]
}
```

Três coisas fazem a diferença aqui:

- **`sucessoQuando` é a peça central.** 200 com corpo sem `data.chamadoId` é **falha**, não sucesso.
  Hoje o fluxo real segue adiante e promete registro que pode não ter acontecido.
- **A chave de idempotência é a `chaveEfeito`**, que inclui visita e tentativa. Uma chave derivada só
  de `protocolo:no` é **constante entre visitas**: não distingue a primeira da segunda tentativa — que
  é onde serviria — e faz um segundo chamado legítimo na mesma conversa colidir com o primeiro num
  destino que respeite idempotência, sendo descartado em silêncio enquanto o cliente lê «registrado
  com sucesso». O D3 renascido por outro caminho.
- **A saída `erro` é obrigatória no grafo.** O validador recusa publicar nó `http` com `erro` órfã
  (`SAIDA_DE_ERRO_ORFA`), e a recomendação 3 do documento 25 vira estrutura: mensagem honesta ao
  cliente + transferência para o time de Suporte.

**Onde a chamada sai:** pelo processo `egresso`, atrás de um proxy próprio com:
recusa de `127.0.0.0/8`, `::1`, `169.254.0.0/16`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10` e das
nossas faixas; **resolução de DNS uma vez**, com a conexão feita ao endereço resolvido e `Host`/SNI
preservados (fixação, contra a troca de resposta de DNS entre a validação e o envio); **zero
redirecionamentos seguidos** — um 302 é falha do nó e toma a saída `erro`, porque clientes HTTP
populares repetem o cabeçalho `Authorization` ao seguir redirecionamento para outro host, e isso
entrega o segredo a quem controlar o destino; tempo limite e teto de corpo. O host precisa estar em
`RagnabotFluxoDestinoPermitido` da empresa; fora dela, o editor mostra «destino não aprovado — peça a
liberação» **na publicação**, e não deixa o operador descobrir por acidente que alcança a rede interna.

### 4.6 O orçamento de caracteres — limite que só se conhece na renderização

O corpo do nó de confirmação é esqueleto fixo mais `email`, `assunto` e `detalhes`. Nos **171** casos
medidos que ainda têm o corpo gravado, o maior deu **718** caracteres, e nenhum passou de 1024. Mas o
teto do que o cliente pode escrever é a mensagem de WhatsApp inteira, e o nó anterior pede literalmente
«para encerrar, *escreva em detalhes* sua solicitacao». **Nenhuma validação de publicação resolve
isso** — o comprimento depende de texto que ainda não existe.

Por isso o comprimento interpolado **sai** do território de aviso e vira política declarada por campo:

```jsonc
"corpo": {
  "texto": "*{{nomes}}*, poderia me confirmar se está tudo correto?\n\nEmail: *{{email}}*\n\nAssunto: *{{assunto}}*\n\nDescrição: *{{detalhes}}*",
  "aoEstourar": "cortar",                       // cortar | recusar
  "reserva": { "detalhes": 400, "assunto": 80, "email": 60, "nomes": 40 }
}
```

Na publicação o validador **calcula** `tetoDoCampo − comprimento(esqueleto) − Σ(reservas)` e
**bloqueia** quando alguma variável interpolada num campo com teto não tem reserva declarada: corpo
que depende de texto ilimitado do cliente não tem publicação segura, logo é erro, não aviso.

Na renderização, o corte é **seguro por grafema** (nunca parte sequência ZWJ nem par substituto),
nunca deixa `*` de formatação sem par (o WhatsApp mostra o asterisco cru e o resumo vira lixo visual),
e acrescenta «… (texto completo registrado no chamado)». O texto integral segue para o registro do
chamado e para a nota interna; só o resumo na tela do cliente é aparado.

**Regra geral do motor:** *limite que um corte resolve nunca derruba o nó.* Recusar só quando truncar
mudaria o sentido — e nesse caso o nó declara `aoEstourar: "recusar"` explicitamente.

**Contagem de caracteres.** Ninguém mediu em que unidade a Meta conta. O título medido «Sim! Abra o
chamado! ✅ » tem 23 em qualquer unidade e o teto documentado da linha de lista é 24 — sobra **um**, e
o título termina em espaço, que conta. Trocar o `✅` por uma bandeira (dois indicadores regionais) dá
23 grafemas, 24 pontos de código e 26 unidades UTF-16: três vereditos para a mesma linha. Enquanto o
perfil de limites estiver com `origem = 'documentacao'`, o validador aplica o **pior caso** e **escreve
isso na tela**: «regra não medida — estamos contando pelo pior caso; rode a calibração para saber o
número real». Aviso que se declara palpite não corrói a confiança nos avisos que são regra.

```js
export function medir(texto) {
  const grafemas = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(texto)].length;
  const utf16 = texto.length;
  const pontos = [...texto].length;
  return { grafemas, pontos, utf16, piorCaso: Math.max(grafemas, pontos, utf16) };
}
```

### 4.7 O nó `notificar` — e por que ele deixa de ser um problema

O fluxo medido notifica **dois celulares cravados no nó**, um deles com espaço no fim
(`"559883351000 "`). Na API oficial isso não sobrevive: são mensagens de texto livre para números que
não iniciaram conversa, e o caso normal é estar fora da janela.

```jsonc
{ "id": "n_avisar_plantao", "tipo": "notificar",
  "config": {
    "canal": "interno",                              // interno | email | whatsapp_template
    "destinatarios": [
      { "tipo": "papel",  "valor": "plantonista_suporte" },
      { "tipo": "time",   "valor": "Suporte" }
    ],
    "assunto": "Chamado aberto pelo robô",
    "modelo": "chamado_aberto"                       // só quando canal='whatsapp_template'
  },
  "saidas": ["padrao", "erro_interno"]
}
```

- Destinatário **nomeado por papel**, resolvido em tempo de execução dentro da empresa. Trocar de
  plantonista deixa de exigir editar o fluxo (D4), e cada destinatário vira um efeito com `sufixo`
  próprio — a falha de um não reenvia para o outro (D5/D6).
- `canal: 'whatsapp_template'` só publica se o template estiver **`aprovado`** no espelho da WABA.
- **O canal de alerta do NOC não é destino selecionável por fluxo de cliente.** Ele nem aparece no
  enum. Qualquer pessoa pode escrever para o número público de atendimento de uma empresa, digitar um
  texto com cara de alerta de infraestrutura no campo `detalhes`, e esse texto seria despejado no
  mesmo canal onde o plantonista lê os alertas do Zabbix. A casa tem lei escrita sobre reinício de
  host Proxmox precisamente porque o custo do engano ali não é incidente, é parada geral. Quando algum
  aviso precisar mesmo chegar a nós, ele vai por um canal **separado** do de alertas de
  infraestrutura, com prefixo fixo e não editável pelo fluxo —
  `[RAGNABOT · empresa <slug> · protocolo RGT-…]` — **sem o texto do cliente no corpo**, só um link
  para a conversa no Chatwoot, e sem criar registro de alerta do NOC.

### 4.8 Interpolação — estrutural, passada única, escape por destino

Nenhuma das propostas discutia isto, e é onde uma resposta de cliente vira injeção. O corpo medido do
fluxo real é `{"message": "{{{detalhes}}}"}` — texto com marcador dentro, que naturalmente sugere
substituir e depois interpretar como JSON.

**Regras, e elas não são negociáveis:**

1. O motor percorre o objeto de configuração **já interpretado** e substitui apenas folhas de texto.
   Nunca monta texto e interpreta depois. O validador **recusa** publicar nó `http` cujo corpo seja
   texto livre em vez de objeto.
2. **Uma passada.** O resultado de uma substituição jamais é reinterpolado. Sem isso, o cliente digita
   `{{chamado}}` no campo `detalhes` e o resumo devolve a ele o valor que o motor obteve do terceiro.
3. **O escape é declarado por destino**, porque o destino é quem define o perigo:

| destino | escape |
|---|---|
| corpo JSON | valor de string escapado pelo serializador — nunca concatenação de texto |
| caminho de URL | `encodeURIComponent` por segmento; esqueleto fixo; variável **não pode** introduzir `/`, `?`, `#`, `@`, nem aparecer em posição de esquema ou de host |
| parâmetro de consulta | `encodeURIComponent` |
| WhatsApp | texto, com corte no limite e fechamento de marcação |
| parâmetro de template | higienizado: sem quebra de linha, sem sequência de espaços (exigência da Meta) |
| nota interna | texto sem marcação |

Como o `preparar()` monta o payload sem enviar, o escape acontece **uma vez** e vale igualmente para a
prévia, o modo de teste e o envio real.

### 4.9 Migração dos fluxos legados — o tradutor recusa adivinhar

`traduzirFluxoLegado(documento)` devolve `{ documento, achados[] }`. Achado **bloqueante** impede
publicar. A regra que importa: onde o legado traz `responseTimeout: 4` **sem unidade**, o tradutor
emite `unidade: null` mais achado bloqueante, e um humano escolhe. Traduzir 4 minutos como 4 horas
muda a taxa de abandono **e** o comportamento de janela ao mesmo tempo — é decisão de operação, não de
migração. Consequência declarada: **a migração não é totalmente automática**, e não sei quantos nós
exigirão essa decisão manual.

Outros achados bloqueantes do tradutor: número de telefone literal em nó de notificação; segredo
literal em cabeçalho; aresta dupla na mesma saída; variável criada e nunca usada (é o D1 — a pergunta
da empresa — e ele obriga a escolher entre remover a pergunta ou dar destino a ela).

### 4.10 Catálogo de códigos de incidente

| código | o que aconteceu | o que o painel mostra | corrige no editor? |
|---|---|---|:--:|
| `SEM_RESPOSTA_ESGOTADA` | cliente não respondeu N vezes | quanto esperou, o que já tinha respondido | não |
| `OPCAO_INVALIDA_ESGOTADA` | respostas fora do menu | **as frases que as pessoas escreveram** | sim |
| `LIMITE_EXCEDIDO` | payload passou do teto no envio | campo, tamanho medido, teto, perfil e unidade usados | sim |
| `JANELA_FECHADA` | envio livre fora das 24 h | há quanto tempo fechou, e se a Meta ou nós fechamos | sim |
| `TEMPLATE_REPROVADO` | modelo não aprovado na Meta | nome e status | sim |
| `HTTP_FALHOU` | status ou `sucessoQuando` não bateu | status, tempo, e quais caminhos vieram/faltaram | depende |
| `HTTP_SEM_CAMPO` | extração obrigatória não achou o caminho | caminho esperado × chaves recebidas | sim |
| `DESTINO_NAO_PERMITIDO` | host fora da lista de permissão | host pedido | sim |
| `VARIAVEL_AUSENTE` | interpolou variável nunca criada | nome e nó que deveria criá-la | sim |
| `ARESTA_AUSENTE` | saída sem ligação em execução | nó e saída órfã | sim |
| `TETO_DE_PASSOS` | teto num evento | o caminho percorrido, na ordem | sim |
| `CANAL_RECUSOU` | erro do Chatwoot ou da Meta | código e mensagem do provedor | depende |
| `SEGREDO_AUSENTE` | cofre não resolveu para esta empresa | o apelido pedido (**nunca** o valor) | sim |
| `EFEITO_DUVIDOSO` | efeito irreversível sem veredito | nó, protocolo, há quanto tempo | não — chama humano |
| `ORDEM_INCERTA` | duas entradas sem ordem provável | as duas, com horário | não |
| `EXECUCAO_RESGATADA` | nó sumiu na migração de versão | de onde veio, para onde foi | sim |

> **`OPCAO_INVALIDA_ESGOTADA` guardar as frases é o que fecha o buraco de verdade.** As 151 pessoas
> estão dizendo o que querem, e hoje ninguém lê. Com a amostra na tela, o operador transforma «quero
> falar com alguem» num apelido de item ou num item novo. O defeito vira conserto.

---

## 5. Integração com o Chatwoot

### 5.1 Entrada — o webhook

**Duas fontes assinadas**, porque não está medido qual conjunto de eventos cada uma entrega:
o `outgoing_url` do **Agent Bot** ligado à caixa, e o **webhook de conta**. A portaria aceita as
duas, deduplica pela `chave` calculada, e a fatia 0 prova qual traz o quê.

| evento | classe | para que serve |
|---|---|---|
| `conversation_created` | controle | abrir execução, emitir protocolo |
| `message_created` (`incoming` + `sender_type='Contact'`) | **resposta_cliente** | única classe que pode responder um nó |
| `message_created` (`outgoing`) **com** `content_attributes.rgt_efeito` | eco_proprio | confirma efeito, deduplica o espelho |
| `message_created` (`outgoing`) **sem** a nossa marca | controle | **humano assumiu** |
| `conversation_updated` / `assignee_changed` | controle | responsável mudou |
| `conversation_status_changed` | controle | conversa resolvida/reaberta por fora |

**Identidade nunca é inferida por ausência.** Toda mensagem que o motor cria carrega
`content_attributes.rgt_efeito = <chave do efeito>`. Saída **com** a nossa marca é nossa; saída **sem**
marca é humana — independentemente de `sender_type`, do tipo de token com que o bot foi registrado e
da versão do Chatwoot. Sem essa marca, um bot ligado com token de **usuário** (o atalho comum, porque
registrar Agent Bot pela Platform API exige o token de plataforma e um passo a mais) veria toda
mensagem que ele mesmo envia voltar carimbada como humana, e se mataria na primeira coisa que falasse.

**Atribuição automática não é presença humana.** O Chatwoot tem *auto assignment* por padrão nas
caixas. Um `assignee` preenchido por automação (`performed_by` nulo ou de sistema) **não** conta como
takeover. Conta: (a) mensagem de saída sem a nossa marca; ou (b) atribuição a um usuário diferente do
bot **e** posterior à primeira interação real.

E o resultado do takeover é `pausado_humano` — **não terminal**, dentro do índice único parcial, com
`prazoEm` de 15 minutos e critério de retomada escrito. Estado destrutivo apoiado em evidência frágil
tem de ser reversível: falso positivo custa «robô calado por 15 minutos», não «cliente abandonado para
sempre e recebendo a saudação de novo a cada mensagem».

**Invariante nova, testável:** nenhuma transição para estado terminal ou pausado acontece sem gravar
um incidente e postar a nota privada na conversa. Hoje uma execução pode morrer sem que exista um
único lugar onde alguém veja que morreu — foi assim que o D10 passou catorze meses.

### 5.2 Segurança do webhook

O código que existe hoje (`ragnabot-webhook.routes.js`) usa **um segredo global**
(`RAGNABOT_WEBHOOK_SEGREDO`), aceito também por **query string** (linha 40), com a empresa saindo do
**corpo** da requisição (linha 59). A rota está montada sem `authMiddleware` — o segredo é a única
barreira. O motor **não** reusa esse padrão:

1. Segredo **por caixa/empresa**, cifrado, com `fingerprint` visível na tela (mesmo padrão de
   `RagnabotInbox.credentialFingerprint`).
2. **A empresa é definida por qual segredo verificou.** O `account.id` do corpo é conferido contra ela;
   divergiu, recusa 401 e registra.
3. **Só cabeçalho.** Nunca query — o log de acesso dedicado por site grava a linha inteira.
4. Rotação com dois segredos válidos durante a janela.

Sem isso, um único vazamento (log de proxy, `Secret` do Kubernetes ainda sem cifra em repouso —
pendência 3 de `23-PENDENCIAS-SEGURANCA.md`, aberta) permitiria a qualquer detentor dirigir o fluxo de
**qualquer** empresa com um POST: responder por um cliente, emudecer o robô numa conversa, ou forjar
criação de conversa e queimar números do contador de protocolo de forma **irreversível**.

**Nenhum identificador do Chatwoot define escopo.** Vale também para as rotas de leitura: a trilha de
uma conversa é `GET /api/ragnabot/fluxo/conversas/:cwAccountId/:cwConversationId/trilha`, com o
`cwAccountId` derivado do **usuário logado**, nunca de parâmetro de tela — `conversations.id` é global
no Chatwoot, e o próprio schema da casa já registra esse cuidado no
`@@unique([cwAccountId, cwConversationId])` do `RagnabotProtocolo`.

### 5.3 Saída — a PortaCanal

O executor devolve uma **intenção canônica**:

```js
{ tipo:'texto',    corpo, privada:false }
{ tipo:'lista',    corpo, rodape, rotuloBotao, itens:[{id,titulo,descricao}] }
{ tipo:'botoes',   corpo, rodape, botoes:[{id,rotulo}] }
{ tipo:'midia',    url, legenda, mime }
{ tipo:'template', nome, idioma, parametros:[] }
{ tipo:'nota',     corpo }                       // nota privada, para o operador
{ tipo:'atribuir', timeId } | { tipo:'etiqueta', aplicar:[], remover:[] } | { tipo:'resolver' }
```

Três adaptadores implementam a mesma porta:

| adaptador | como manda interativo | quando usar |
|---|---|---|
| `AdaptadorChatwoot` | `content_type:'input_select'` + `content_attributes.items` | se a 4.17.1 traduzir isso para `interactive` da Cloud API |
| `AdaptadorChatwootMaisCloud` | monta `interactive` na Graph API com o `phoneNumberId` da caixa e **espelha** no Chatwoot como `outgoing`, com a marca `rgt_efeito` e o `wamid` | se não traduzir |
| `AdaptadorFalso` | grava o payload num array | modo de teste e testes automatizados |

A escolha é por caixa (`RagnabotInbox.metadata.capacidadeInterativa`: `nativo` · `direto` · `texto`),
decidida pela prova da fatia 0. **O motor e os quinze executores não mudam uma linha entre os dois
caminhos.** No caminho `direto`, o espelho é dedupado pelo `wamid` na entrada — a mensagem que **nós**
mandamos pela Graph API volta como evento pelo webhook, e sem isso entraria na fila como se fosse do
cliente.

Chamadas de saída usadas:

| intenção | chamada |
|---|---|
| texto / nota privada | `POST /api/v1/accounts/{conta}/conversations/{conversa}/messages` |
| interativo (nativo) | idem + `content_type:'input_select'` + `content_attributes.items[]` |
| interativo (direto) | `POST https://graph.facebook.com/v.../{phoneNumberId}/messages` → espelha |
| atribuir a time | `POST …/conversations/{conversa}/assignments` |
| etiqueta | `POST …/conversations/{conversa}/labels` |
| resolver | `POST …/conversations/{conversa}/toggle_status` |
| carimbo de fluxo, versão e protocolo | atributos personalizados da conversa |

**O carimbo na conversa é cópia deliberadamente desnormalizada** (`rgt_protocolo`, `rgt_fluxo`,
`rgt_fluxo_versao`, `rgt_no_atual`, `rgt_resultado`). A razão é operacional e é de madrugada: o
atendente enxerga por onde a pessoa passou **mesmo com o nosso backend fora do ar**. Em divergência, o
nosso banco é a verdade, a gravação no Chatwoot é melhor esforço, e a reconciliação acontece no
encerramento — regra que precisa estar escrita, senão alguém relata defeito a partir do atributo
errado.

### 5.4 A janela de 24 horas como estado, não como esperança

```js
podeEnviarLivre({ phoneNumberId, destinatarioWaId })   // → { aberta, expiraEm, margem }
```

Repare no que **não** está na assinatura: a execução. A janela é do par (número da empresa,
destinatário), e o nó `notificar` manda para um **terceiro** — cujo par com o número da empresa é
independente do cliente que está conversando. Conferir a janela «da execução» aprova um envio ao
plantonista porque **o cliente** acabou de escrever, e a Meta recusa.

E a chave é o `phoneNumberId`, não a conta: a Ragnatela tem **duas** conexões de WhatsApp medidas na
mesma empresa (`Whatsapps` 42 «RAGNATELA» e 45 «Suporte Ragnatela»). Uma janela aberta por um número
não vale pelo outro, e `RagnabotFluxoJanela` grava **em qual número** a entrada chegou, porque com
duas caixas na mesma conta essa informação não é derivável depois.

**A janela é contada pelo carimbo de origem**, não pelo instante em que recebemos: entre a Meta e nós
há o Chatwoot ingerindo, gravando e disparando o webhook. Enquanto **não estiver medido** se o
Chatwoot 4.17.1 repassa o `timestamp` da Meta, o motor trata a janela como fechada
`margemSegurancaSegundos` (padrão 300) **antes** do vencimento nominal, e nenhum despertar pode ser
agendado em função de `expiraEm` sem descontar essa margem. A margem é campo do modelo e aparece na
tela; não é constante escondida.

**Quando o envio é recusado**, o código de fora-de-janela da Meta é mapeado para a saída
**`sem_janela`** do nó, não para `erro` — e a recusa **corrige** a nossa linha de janela
(`fechadaPeloDestinoEm`). Sem isso, a saída `sem_janela` só dispararia pela nossa contabilidade
otimista e nunca no caso em que a fonte autoritativa afirmou o fechamento; o template configurado
exatamente para esse caso não seria usado exatamente no caso em que ele existe, e a nossa linha
continuaria dizendo «aberta» até a próxima mensagem de entrada.

**Fora da janela, nem tudo tem alternativa.** `modeloFora` deixa de ser campo uniforme e passa a ser
propriedade **do tipo de nó**, declarada em `aceitaModeloFora`:

| tipo | aceita template fora da janela? | por quê |
|---|:--:|---|
| `texto`, `midia` | sim | são o que um template renderiza |
| `botoes` | sim, **com rótulos literais** (sem interpolação) e dentro do número de respostas rápidas que o template comporta | rótulo de botão de template é fixo no momento da aprovação |
| `lista` | **não** | não existe template que renderize o seletor de lista |
| `pergunta` | não | resposta livre fora da janela não tem como ser solicitada |

Nó `lista` fora da janela toma a saída obrigatória **`sem_janela`**, e o desenho escolhe entre
(i) template de reengajamento com resposta rápida que, ao ser tocada, reabre a janela e só então
apresenta a lista de verdade — dois passos, honesto, e é assim que a Meta pretende que se faça — ou
(ii) entregar a um humano. Sem isso, o cliente recebe um texto sem nada para tocar, responde «sim,
resolveu», o casamento não acha nem identificador nem índice nem título, e ele é tratado como quem
errou.

**Análise estática de caminho na publicação:** o validador soma a espera máxima acumulada de cada
caminho da raiz até cada nó de envio — incluindo `esperar × (tentativas + 1)` dos caminhos de exceção,
que são os que mais consomem tempo e são o caminho de 29 % das conversas medidas. Passou de 24 h, ou é
**indeterminado** por causa de ciclo, o validador **exige a decisão** (declarar `sem_janela` ou
configurar template) em vez de emitir um aviso. Indeterminado precisa virar pergunta ao operador, não
alerta repetido que ele aprende a ignorar.

### 5.5 Os limites da Meta, impostos NA HORA DE MONTAR o nó

Esta é a exigência textual do documento 19, §3/B1: *«O editor precisa avisar isso na hora de montar o
nó, não deixar o erro aparecer no cliente.»* O mecanismo que garante isso é o `preparar()`: a prévia
do editor, o modo de teste e o envio real chamam **a mesma função**. Não existe «validação do editor»
separada da validação real, e por isso ela não pode divergir em três semanas.

**Duas classes de problema, e a fronteira é deliberada.**

**Classe A — ESTRUTURAL: bloqueia a publicação, sem botão de forçar.** São contagens inteiramente
conhecidas na publicação, e **não existe contexto de operador que torne quatro botões corretos**:

- número de botões acima do teto; número de linhas de lista somando **todas** as seções; número de
  seções; cabeçalho duplicado;
- segredo literal em cabeçalho ou corpo (heurística `Bearer\s+\S{20,}`, `(sk|pk|ghp|xox)[-_]…`, forma
  de JWT, hex/base64 longo);
- aresta duplicada na mesma saída (recusada também pelo banco);
- saída sem ligação; nó inalcançável; saída `erro` de `http` órfã;
- laço de exceção sem teto; `esperaResposta` sem unidade;
- variável usada e nunca criada; campo com teto interpolando variável **sem reserva declarada**;
- referência a apelido de cofre inexistente **naquela empresa**; host fora da lista de permissão;
- sub-fluxo apontando para versão de **outra empresa**;
- versão com nó que estaciona e **sem** `noResgateId`;
- template referenciado que não está `aprovado`;
- corpo de nó `http` como texto livre em vez de objeto.

**Classe B — JULGAMENTO: avisa e pede confirmação**, honrando o documento 19 §4.1 («publicar com
problemas abre confirmação, não é bloqueado em silêncio — a decisão é do operador»):

- comprimento de título/descrição/rodapé próximo do teto (com o número medido e a unidade usada);
- perfil de limites com mais de 180 dias desde `conferidoEm`;
- espera total alta num caminho; prazo de nó **menor que o atraso p95 medido do canal** (defeito de
  configuração que o editor avisa ali, do mesmo jeito que avisa o limite da Meta);
- corpo interpolado que **tem** reserva mas ainda assim pode ficar apertado.

> **Divergência consciente com o documento 19, registrada:** ele manda avisar e deixar a decisão com o
> operador. Mantenho isso para a classe B. **Discordo para a classe A** — segredo em claro, aresta
> duplicada e quatro botões não são julgamento, são corrupção do documento. E a frase do aviso precisa
> descrever o modo de falha **real**: a Meta **recusa a mensagem inteira** acima do teto de botões;
> ela não entrega três e descarta o quarto. Um aviso que promete degradação parcial é pior que aviso
> nenhum, porque compra a confiança do operador antes de traí-la. A frase correta é
> *«A Meta recusa a mensagem inteira acima de 3 botões — nenhum deles é entregue. Transforme em lista
> (até 10 itens).»*, com o botão **«Converter em lista»** ao lado.

**Ações rápidas do validador** (um clique, não um parágrafo): «Converter em lista» · «Aplicar corte»
(insere a reserva no campo) · «Mover para o cofre» (tira o segredo literal e cria o apelido) ·
«Declarar saída sem_janela» · «Pedir liberação do destino».

### 5.6 O que o operador vê quando dá errado

Três superfícies, e a ordem importa: a primeira não é uma tela nova, é a própria conversa.

**(a) Nota privada na conversa.** Sempre que o fluxo desiste, falha ou transfere:

```
🤖 ABERTURA DE CHAMADO · versão 7 · nó CONFIRMACAO
Motivo: sem resposta após 2 tentativas (esperou 4 min cada · canal de pé o tempo todo)
Última coisa que o cliente disse: "quero falar com alguem"
Protocolo: RGT-0000000123 · execução 8f2c…a91
Já respondidos: nomes, email, assunto · Faltou: confirmação
Transferido para: Suporte
```

Nenhum segredo, nenhum corpo de resposta HTTP cru — só o que ajuda o analista a não repetir as cinco
perguntas.

**(b) `RagnabotFluxoIncidente` — a caixa de defeitos.** Agrupada, com `comoCorrigir` e amostras.

**(c) `/fluxos/:id/execucoes` — as conversas vivas.** Tabela densa: protocolo · contato · nó atual ·
esperando o quê · há quanto tempo (contador vivo, no mesmo padrão da página de Alertas do NOC) ·
última saída · estado. Filtro «só com problema». Ações por linha: *Ver conversa*, *Reenviar o nó
atual*, *Encerrar a execução* (não a conversa), *Transferir agora*.

**Mensagem ao cliente ≠ mensagem ao operador.** O nó tem `mensagemFalha` opcional e a empresa tem um
padrão: «Não consegui concluir por aqui agora. Já chamei um analista para falar com você.» Nunca
detalhe técnico, nunca silêncio — e **nunca** «chamado registrado com sucesso» sem prova de sucesso.

### 5.7 Observabilidade (Zabbix, padrão da casa)

| chave | o que mede | alerta |
|---|---|---|
| `rb.fila.pendentes` | profundidade da fila | > 500 por 5 min |
| `rb.fila.mais_velho_seg` | idade do trabalho pendente mais velho | > 120 s = high |
| `rb.fila.processando_velhos` | trabalho preso em `processando` | > 0 por 3 min = high |
| `rb.fila.falhados` | trabalho envenenado | > 0 = high |
| `rb.execucao.rodando_sem_lease` | execução ativa sem posse viva | > 0 por 2 min = high |
| `rb.efeito.reservados_velhos` | **medidor do risco de duplicata** | > 5 = warning |
| `rb.efeito.duvidosos` | efeito irreversível sem veredito | **> 0 = disaster** |
| `rb.cliente.esperando_humano_mais_antigo_min` | **dano ao cliente**, em minutos | > 15 = high · > 30 = disaster |
| `rb.canal.atraso_entrada_p95` | atraso de entrega do webhook, por conta | tendência + validação de prazo |
| `rb.janela.bloqueios_dia` | envios barrados por janela fechada | tendência |

Dois deles acordam gente, e por razões diferentes: `rb.efeito.duvidosos > 0` significa que alguém pode
ter sido informado de um chamado que não existe; `rb.cliente.esperando_humano_mais_antigo_min`
significa que existe uma pessoa esperando **agora**. O alerta diz o que está em jogo — «cliente
esperando há N minutos, protocolo RGT-…, conversa <link>» — e vai para o plantão de **atendimento**,
não só para o do NOC.

---

## 6. Como cada achado dos céticos foi endereçado

Vinte e oito achados. **Vinte e seis foram corrigidos por construção**, um foi corrigido de forma
parcial e declarada, e um teve a correção **adiada com gatilho escrito**. Nenhum ficou sem resposta.

| # | achado | correção adotada | onde |
|---:|---|---|---|
| C01 | Atribuição automática do Chatwoot lida como takeover, execução morre no nascimento e o cliente recebe a saudação de novo | Takeover exige **mensagem de saída sem a nossa marca `rgt_efeito`** ou atribuição a usuário ≠ bot **e** posterior à primeira interação; atribuição por automação não conta. Estado vira **`pausado_humano`, não terminal**, dentro do índice único parcial, com prazo e retomada. Invariante: nenhuma transição terminal ou pausada sem incidente + nota privada | §5.1, §3.1 |
| C02 | Trabalho preso em `processando` congela a conversa por 23 h; o varredor de órfãos é cego para o caso | **Ceifador de jobs** (sexto vigia, 30 s, corte de 90 s = 3× o arrendamento). Varredor corrigido para cobrir `rodando` **e** `esperando` e para aceitar só trabalho **recém**-travado como prova. Medidores de **idade** para todo estado intermediário. Encerramento gracioso devolve a `pendente` | §3.2/G, §3.2/H, §5.7 |
| C03 | `resolver` e `atribuir` classificados como repetíveis: o conciliador fecha a conversa por cima do atendente | Classe nova **`condicional`**: a reserva carimba `estadoAnterior`; o conciliador só reaplica se o estado atual ainda for igual; diferente ⇒ `descartado` com `motivoDescarte='estado_mudou'` + nota privada. `reenviar` fica só para o comutativo de verdade. `sourceId` substituído pela marca **nossa** `rgt_efeito`, gravada em T1 | §3.2/E, §2.5 |
| C04 | O dreno procura trabalho `pendente` que outro executor já reivindicou; a 2ª mensagem some e volta como opção inválida | **Posse ANTES da reivindicação.** Quem não tem a posse não toca no trabalho. A mesma transação marca a rajada inteira com `donoWorker = eu`; o dreno só consome o que ele marcou. Candidatos já filtram partição arrendada. Primeira mensagem: trava de partição do início ao fim da transação | §3.2/B |
| C05 | A ordem da rajada vem do relógio da nossa fila, não do cliente | Ordem por **`origemEm`**, `cwMessageId` como desempate, `RagnabotFluxoFila.id` só por último. **Correção parcial declarada** — ver §6.1 | §3.2/C |
| C06 | `updated_at` dentro da chave de idempotência: reentrega cria evento novo e a resposta vai para a variável errada | Chave **NOT NULL calculada**, só com identidade imutável; sem id estável, `sha256` do corpo **com campos voláteis removidos**. Segunda barreira no consumo: `RagnabotFluxoEntradaConsumida` | §2.4, §3.2/D |
| C07 | Trava bloqueante segurada por cima de cinco chamadas HTTP; chave de idempotência constante entre visitas | **Zero rede dentro de transação.** `pg_try_advisory_xact_lock` (quem não pega adia). Chave de idempotência = `chaveEfeito`, com visita e tentativa. Índice único **parcial** por estado ativo no lugar da chave com `versaoId` | §3.2/D, §4.5, §2.3 |
| C08 | Limite estrutural (3 botões) tratado como aviso, e a frase descreve uma falha que a Meta não produz | Duas classes: **estrutural bloqueia sem botão de forçar**; julgamento avisa. Frase reescrita para o modo de falha real («recusa a mensagem inteira»), com ação rápida «Converter em lista» | §5.5 |
| C09 | O corpo da lista é montado com texto livre do cliente; o teto só se conhece na renderização | **Orçamento de caracteres declarado** (`aoEstourar` + `reserva` por variável); publicação **bloqueia** variável sem reserva em campo com teto; corte seguro por grafema, fechando marcação. Regra: limite que um corte resolve nunca derruba o nó | §4.6 |
| C10 | Janela chaveada pela conta e conferida contra a conversa — ela é do par (número da empresa, destinatário) | `RagnabotFluxoJanela` chaveada por `(phoneNumberId, destinatarioWaId)`; assinatura `podeEnviarLivre({phoneNumberId, destinatarioWaId})`; `notificar` para terceiro nasce com canal interno travado; **`erro_interno` separado de `erro`** | §5.4, §4.7, §4.4 |
| C11 | Fora da janela não existe lista interativa; `modeloFora` uniforme promete um caminho que a Meta não tem | `aceitaModeloFora` é propriedade **do tipo de nó**; `lista` não aceita e exige saída `sem_janela`; reengajamento em dois passos. Análise estática **exige decisão** quando o caminho é indeterminado | §5.4 |
| C12 | Janela decidida pelo nosso relógio e pelo carimbo de recepção; a recusa da Meta não volta para `sem_janela` | Janela contada pelo **carimbo de origem**; `margemSegurancaSegundos` (300) visível na tela enquanto não medido; nenhum despertar derivado de `expiraEm` sem descontar a margem; **todo tempo pelo `now()` do banco**; recusa mapeada para `sem_janela` e **corrige** a nossa linha | §5.4 |
| C13 | A máquina de exceção é feita de mensagem livre, e o prazo que a dispara não tem unidade medida | Tradutor **recusa adivinhar** unidade (achado bloqueante); validador soma `esperar × (tentativas+1)` mais as esperas do caminho; ao acordar, **reconfere a janela antes do reforço** e pula para `acaoFinal` se fechada; nota interna distingue «janela fechou» de «cliente sumiu» | §4.4, §4.9, §5.4 |
| C14 | Os limites da Meta são guardados como número sem unidade, e ninguém mediu o que a Meta conta | `RagnabotLimiteCanal` ganha **`unidade` e `origem`**; com `origem='documentacao'` o validador aplica o **pior caso** e **escreve na tela que é palpite**; rotina de calibração prevista na fatia 5 | §2.7, §4.6, §7 |
| C15 | O relógio do motor anda enquanto o canal está surdo: resposta gravada na variável errada | `RagnabotFluxoCanalSaude` com **duas** evidências (falha de saída e silêncio de entrada); prazo medido em **tempo de canal de pé**; **janela de graça reversível** de 3 min; **casamento posicional no tempo** (recusa casar mensagem anterior a `aguardaDesde`) | §2.6, §3.2/F, §3.2/C |
| C16 | «Humano assumiu» inferido de sinal negativo e não verificado: o robô se mata ou fala por cima da analista | Marca `rgt_efeito` em toda mensagem nossa; `pausado_humano` reversível com relógio; **conferência no último momento** (`GET /conversations/{id}`, cache 10 s) antes de todo envio ao cliente; **as duas fontes de webhook assinadas** e provadas na fatia 0 | §5.1, §3.2/D |
| C17 | A conciliação depende de identificador que não é nosso, e a retentativa ocorre antes de a caixa de saída existir | Identidade **nossa** em `content_attributes`; **retentativa de efeito irrepetível sai do cliente HTTP** (uma tentativa; tempo limite é dúvida, não falha); tempo limite dimensionado por latência medida sob carga | §3.2/E, §8 |
| C18 | Coluna anulável dentro da chave única: `conversation_created` repetido nunca é deduplicado | Chave calculada NOT NULL (mesma correção de C06) + **barreira de classe de evento** com teste: só `incoming` + `sender_type='Contact'` pode responder um nó | §2.4, §5.1 |
| C19 | `pausado` é congelamento sem relógio numa conversa trancada; a mensagem honesta só sai depois de a janela fechar | A mensagem honesta é o **primeiro** efeito do caminho de dúvida, na mesma transação em que congela; `pausado_duvida` ganha `prazoEm` e **escalador**; a conversa continua recebendo (entrada em execução pausada vira nota + reforça a escalada, sem abrir execução nova); alerta novo `rb.cliente.esperando_humano_mais_antigo_min` para o plantão de atendimento | §3.1, §3.2/E, §5.7 |
| C20 | Chatwoot lento atrasa o webhook e converte cliente que respondeu em cliente que desistiu | `origemEm` + `atrasoMs` em toda entrada; prazo contra o carimbo de origem; freio de sanidade comparando o prazo do nó com o atraso p95 da conta; **validação na publicação**: prazo menor que o p95 do canal é defeito de configuração e o editor avisa ali | §2.4, §3.2/F, §5.5 |
| C21 | Um segredo global aceito por query, com a empresa vindo do corpo: qualquer detentor dirige qualquer empresa | Segredo **por caixa**, cifrado, com fingerprint e rotação; **a empresa é definida por qual segredo verificou**; `account.id` só é conferido; **nunca query string**; nenhum identificador do Chatwoot define escopo, inclusive nas rotas de leitura | §5.2 |
| C22 | Cofre endereçado por apelido sem escopo de empresa: o segredo de B vaza para A | `resolver(execucao.tenantId, apelido)` com **`findUnique`**, jamais `findFirst`; apelido inexistente é erro **bloqueante** (`SEGREDO_AUSENTE`) e o nó não executa; validador recusa apelido que não exista na empresa dona do rascunho | §2.7, §4.1, §5.5 |
| C23 | `cofre: 'env'` entrega o ambiente do processo ao editor de fluxo | **Não existe cofre do tipo ambiente.** Só valor cifrado por empresa. Se algum dia uma variável de ambiente precisar ser referenciada, entra por lista de permissão **fechada, em código, revisada** — jamais por campo livre gravado pelo cliente | §2.7 |
| C24 | O nó HTTP é um primitivo de falsificação de requisição e herda a posição de rede do motor | Processo **`egresso` separado**, sem `DATABASE_URL` do NOC, sem `ENCRYPTION_KEY` e sem ferramenta de SSH; `NetworkPolicy` de saída em recusa por padrão; proxy com recusa de faixas internas, **fixação de endereço** (DNS resolvido uma vez) e **zero redirecionamento**; lista de permissão de host **por empresa** | §1.1, §4.5, §2.7 |
| C25 | Sub-fluxo referenciado por identificador sem verificação de dono: o grafo de B executa na conversa de A | Toda travessia resolvida **com o `tenantId` junto**, na publicação, na execução **e na retomada**; erro bloqueante quando não achar; **FK composta `(tenantId, versaoId)`** para o banco recusar a junção cruzada mesmo se o código errar | §3.5, §2.2, §2.8 |
| C26 | O segredo volta no corpo da resposta HTTP e é persistido em claro — e o backup imutável o torna inapagável | Padrão é **não persistir corpo cru**: status, tipo, tamanho, tempo e presença/ausência de cada caminho de `extrair`. Quando indispensável, redação **por valor e ANTES do `INSERT`** (troca literal de cada segredo resolvido naquela execução) mais varredor de formas, no espírito de `src/utils/redact.js`. Mesmo tratamento em `RagnabotFluxoEntrada.corpo` | §2.5, §2.4, §4.5 |
| C27 | O canal de alerta do NOC como padrão deixa o cliente final escrever alerta forjado na nossa operação | Canal do NOC **fora do enum** do nó. `notificar` de fluxo de cliente só alcança destinatários daquela empresa. Aviso que precise chegar a nós vai por canal separado, com prefixo fixo não editável, **sem o texto do cliente** (só link para a conversa) e sem criar registro de alerta do NOC | §4.7 |
| C28 | Injeção pela resposta do cliente no destino HTTP: sem contrato de escape nem passada única | Interpolação **estrutural** sobre o objeto interpretado; **uma passada**, nunca reinterpolação; escape declarado **por destino**; variável proibida em posição de esquema ou host; corpo de `http` como texto livre é recusado na publicação | §4.8 |

### 6.1 O que foi corrigido só em parte, ou adiado — e por quê

**C05 — correção parcial, declarada.** O cético propôs que, sem ordem provável, o motor **nunca**
aplique «vale a última» e sempre repergunte. Adoto isso **para `lista` e `botoes`**, onde a escolha
errada dispara efeito irreversível. **Não adoto para `pergunta` aberta**: ali o motor concatena as
duas mensagens na ordem disponível, grava o evento `ordem_incerta` e mostra as duas com horário na
nota interna. A razão é que concatenar duas frases fora de ordem **preserva a informação** — quem lê o
chamado entende —, enquanto repreguntar num campo aberto joga fora texto que o cliente já escreveu de
boa-fé, e o abandono medido já é alto. É uma escolha de qual erro é mais barato, e ela está escrita
para poder ser revista com dado.

**C14 — a calibração é adiada, com gatilho.** A tabela com `unidade` e `origem` entra na fatia 1; a
rotina que **mede** a fronteira real (enviar pares no limite e no limite+1 com conteúdo do plano astral
e sequência ZWJ) entra na fatia 5, porque ela **envia mensagem** e só pode rodar contra o número de
teste. Até lá, o pior caso vale e a tela diz que é palpite.

**Adiamentos que não são achados, mas precisam estar declarados:**

| item | decisão | gatilho para reavaliar |
|---|---|---|
| `RagnabotFluxoNoMetricaDia` (agregado) | **adiado.** O nó mais movimentado medido acumulou 518 apresentações em catorze meses; varrer o bruto responde instantaneamente nessa ordem. Como deriva 100 % do bruto, acrescentar depois é recarga | ~200 mil eventos/mês por empresa |
| Particionamento de `RagnabotFluxoEvento` | **adiado.** A retenção de 30 dias no grão fino atenua; sem partição, a poda em massa é a dor clássica | quando a poda diária passar de 60 s |
| Canário / publicação por percentual | **não construído.** Com 33 encerramentos medidos em agosto de 2026, um canário a 50 % levaria meses para dar diferença confiável entre duas versões. Para este fluxo, publicar direto e comparar por período — aceitando a confusão com sazonalidade — é a leitura honesta | empresa com volume que sustente; não tenho medição de nenhuma para dizer a partir de que número |
| Spool em disco na portaria | **não construído.** Ele reintroduz estado local no processo e só faz sentido se o Chatwoot **não** reentregar webhook — o que ninguém mediu | resultado da medição da fatia 0 |
| Fila dedicada (BullMQ/Kafka) | **não construída.** O Postgres com `FOR UPDATE SKIP LOCKED` cobre o volume projetado com folga de várias ordens de grandeza | `rb.fila.pendentes` sustentado acima de 5.000, ou mais de ~50 despertares por segundo |

---

## 7. Ordem de construção

Fatias que entregam valor. A **fatia 1 é o mínimo para rodar o ABERTURA DE CHAMADO de ponta a
ponta** — e a fatia 0 existe porque, se a resposta dela for a inesperada, a fatia 1 muda de adaptador.

### Fatia 0 — A prova (não é código de produto)

**Entrega:** um relatório de uma página com quatro respostas medidas, na conta de teste do chat002.

1. O Chatwoot 4.17.1 entrega **lista interativa** de WhatsApp pela API de aplicação
   (`content_type: 'input_select'`), e a escolha volta **com o identificador do item**?
2. Ele aceita e devolve **`content_attributes`** arbitrários (a nossa marca `rgt_efeito`) na criação e
   na leitura de mensagem?
3. O **Agent Bot reentrega** webhook quando não recebe 200? Com qual recuo, quantas vezes? E qual
   conjunto de eventos cada fonte (Agent Bot × webhook de conta) entrega — inclusive
   `assignee_changed` na atribuição automática?
4. O payload carrega o **carimbo de origem** da Meta, ou só o `created_at` do Chatwoot? E qual
   `sender_type` ele carimba numa mensagem postada com token de **usuário**?

**Por que primeiro:** as respostas 1 e 2 escolhem o adaptador e decidem se `conciliar` é viável; a 3
decide se a portaria precisa de spool; a 4 decide a margem da janela de 24 h. Escrever o motor antes
disso é apostar em quatro coisas de uma vez.

**Custo de ficar sem:** o desenho sobrevive às quatro respostas — é para isso que existe a
`PortaCanal`. Mas cada resposta desconhecida vira uma configuração conservadora que custa qualidade
(pior caso de contagem, margem de 5 minutos na janela, `parar` em vez de `conciliar`).

---

### Fatia 1 — O ABERTURA DE CHAMADO de ponta a ponta

**Entrega:** o fluxo real medido rodando no Ragnabot, para um número de teste, com os defeitos
corrigidos.

| bloco | conteúdo |
|---|---|
| **Dados** | migrações 1–4 (18 modelos, índice único parcial, imutabilidade da versão, FKs compostas) |
| **Portaria** | segredo por caixa · classificação de evento · chave calculada · `origemEm` · 200 **depois** do commit |
| **Executor** | posse com cerca (antes da reivindicação) · coleta de rajada · passo com T1/efeito/T2 · caixa de saída de duas fases |
| **Vigias** | ceifador · varredor de órfãos · conciliador · expirador · escalador de pausa |
| **PortaCanal** | adaptador escolhido na fatia 0 + `AdaptadorFalso` |
| **Nós** | `inicio` · `texto` · `pergunta` (com A2/A4) · `lista` (com A1) · `espera` · `variavel` (A5) · `http` (A3/A8, pelo egresso) · `notificar` (canal interno) · `etiqueta` · `encerrar` · `subfluxo` no modo `saltar` |
| **Egresso** | processo separado + proxy com lista de permissão, fixação e zero redirecionamento |
| **Cofre** | `RagnabotFluxoSegredo` por empresa, resolução com `tenantId` da execução |
| **Janela** | `RagnabotFluxoJanela` por `(phoneNumberId, waId)` + margem |
| **Validador** | classes A e B, com `preparar()` compartilhado |
| **Publicação** | rascunho → versão → projeção → `classificarMudanca` → `noResgateId` |
| **Operador** | nota privada + `RagnabotFluxoIncidente` + `/fluxos/:id/execucoes` |
| **Telemetria** | `RagnabotFluxoEvento` (bruto; sem agregado) |

**As nove correções que o fluxo migrado já nasce com** (documento 25, §12.6):

1. `empresa` deixa de ser descartada — vira campo do registro e atributo do contato (D1).
2. E-mail validado, com duas reperguntas e destino declarado (D2).
3. Saída `erro` do nó HTTP ligada a mensagem honesta + transferência para Suporte; `sucessoQuando`
   exigindo o identificador do chamado no corpo (D3).
4. Números cravados trocados por destinatário nomeado por papel (D4).
5. Aresta dupla substituída por `notificar` com dois destinatários (D5/D6).
6. Prazo da confirmação com unidade explícita (D7).
7. Etiqueta `chamado-aberto-pelo-bot` antes de encerrar (D8) — sem ela não há relatório.
8. Resumo com orçamento de caracteres e corte por grafema; título do item aparado para sair do limite.
9. Pausas reduzidas — **e medidas** contra a versão anterior pela consulta de §3.4. Uma coisa de cada
   vez: mudar as pausas junto com o canal e o motor torna impossível saber qual das três mudou o
   abandono.

**Critério de aceite:** cinquenta conversas de ponta a ponta no número de teste, e
`RagnabotFluxo.atualizadoEm` **não muda** durante nenhuma delas (é o teste do invariante que mata o
D10). Mais: matar o processo executor no meio de um passo e provar que a conversa retoma sozinha em
menos de 90 segundos.

---

### Fatia 2 — Editor visual

Sobre o formato de documento já existente: tela com nós arrastáveis, paleta agrupada, painel de
propriedades com o aviso de limite **ao vivo** (é onde `validar()` e `preparar()` aparecem para o
operador), barra inferior com o resultado da validação, e as ações rápidas de §5.5. Publicação com
prévia numérica de migração. **Modo leitura abaixo de 900 px** — editar fluxo no celular é armadilha,
e é mais honesto dizer isso do que entregar uma tela que erra.

### Fatia 3 — Modo de teste (B18)

Rodar o fluxo contra um número próprio, ver a **sequência de payloads que sairia** (via
`AdaptadorFalso`), e **percorrer os ramos de exceção sem esperar 4 minutos** de prazo. É parte de
«consegue montar»: o administrador precisa experimentar antes de o fluxo atingir um cliente. É a
lacuna que nenhuma das três propostas originais desenhou.

### Fatia 4 — Os nós restantes e a migração em massa

`midia` · `botoes` · `condicao` · `time` · `subfluxo` no modo `chamar`. Tradutor do legado com achados
bloqueantes. Migração dos fluxos pais (`Principal NORMAL`, `SUPORTE`) — que dependem de `botoes` e
`time`. **Antes disso, uma decisão que não é técnica:** qual das duas árvores sobrevive
(`Principal NORMAL` × `Router_Principal`) e o que acontece com o gêmeo `Sub_Suporte_Abertura`, que é
cópia byte a byte. Levar os dois é criar o D11 dentro do sistema novo.

### Fatia 5 — Calibração, agregado e relatório

Rotina de calibração dos limites da Meta (marca `origem='medido'` e apaga o aviso de pior caso).
`RagnabotFluxoNoMetricaDia` **se** o gatilho de §6.1 tiver disparado. Funil por nó, comparação entre
versões, e o relatório que responde «quantos chamados vieram por robô, de que assunto, com que
resultado» — que hoje não existe porque `Tickets.flowId` está nulo nos 439 tickets medidos.

---

## 8. Pontos cegos

O que continua indeterminado. Saída vazia não é prova de ausência, e nenhum destes foi medido nesta
sessão. Estão em ordem de risco.

### 8.1 Bloqueantes — precisam ser medidos antes de escrever a fatia 1

1. **Se o Chatwoot 4.17.1 entrega e recebe conteúdo interativo do WhatsApp pela API de aplicação.**
   Herdado do ponto cego 7 do documento 25 e **não reduzido**. A `PortaCanal` contém a consequência,
   mas a pergunta continua aberta e é a primeira a fechar.
2. **Se ele aceita e devolve `content_attributes` arbitrários.** Toda a conciliação («minha mensagem
   saiu?»), a detecção de takeover e o dedupe do eco dependem da marca `rgt_efeito` viajar e voltar.
   Se não devolver, `conciliar` degrada para `parar` em nós de mensagem, a taxa de trabalho manual
   sobe, e a detecção de humano volta a depender de `sender_type` — que é o sinal frágil de C16.
3. **Se o Agent Bot reentrega webhook, com qual recuo e quantas vezes.** É a premissa do modelo de
   pelo-menos-uma-vez na entrada. Sem reentrega, o `INSERT` da portaria vira ponto único de perda:
   banco indisponível por cinco segundos = mensagens de cliente perdidas em silêncio.
4. **Qual conjunto de eventos cada fonte de webhook entrega**, e se `conversation_updated` /
   `assignee_changed` chegam pelo canal do Agent Bot. Se não chegarem, o takeover fica apoiado só na
   mensagem sem marca — o que funciona, mas atrasa a detecção até o humano falar.
5. **Se o payload carrega o carimbo de origem da Meta.** Decide se a margem de segurança de 5 minutos
   na janela de 24 h pode encolher, e decide a precisão do prazo de nó em canal atrasado.

### 8.2 Decidem configuração, não arquitetura

6. **Em que unidade a Meta conta caracteres** (grafemas, pontos de código, UTF-16 ou bytes). Adotei o
   pior caso por escolha consciente diante da ignorância — não é medição. Importa porque o título
   medido está a **um** caractere do teto documentado.
7. **Os próprios limites numéricos da Meta** (3 botões, 10 itens, 24/20/72/1024/4096 caracteres). Vêm
   do documento 19 e da documentação da Meta, e o documento 25 §10 avisa explicitamente que não são
   medição nossa. A tabela datada torna a dívida visível; ela continua sendo dívida.
8. **O modelo de cobrança atual da Meta.** O desenho fala em «template = conversa paga de 24 h», que é
   o vocabulário antigo; a cobrança migrou para modelo por mensagem. `custoEstimadoCentavos` precisa da
   mesma disciplina de `unidade`/`origem`/`conferidoEm` **antes** de virar número em relatório — hoje
   ele somaria um custo que talvez não seja mais o custo. **Não medi.**
9. **A latência real do `POST /messages` do Chatwoot sob carga** (por exemplo, com a fila do Sidekiq
   ocupada por campanha). É o que dimensiona o tempo limite de saída, e um tempo limite mais curto que
   o tempo em que o destino ainda grava **fabrica** duplicata em vez de evitar lentidão.
10. **O limite de requisições da API de aplicação do Chatwoot.** Dimensiona o despertador e o
    disjuntor. Os 20 candidatos por rodada e os 50 despertares por varredura são números escolhidos,
    não calculados.
11. **A estatística real de rajada:** com que frequência duas mensagens do mesmo contato chegam dentro
    da mesma janela de processamento, e qual o intervalo típico. Dá para medir na tabela `Messages` da
    VM 10016. Sem isso, os 1.500 ms de coleta, os 20 s de continuação e os 2 s de ambiguidade são
    chute fundamentado, não número calibrado.
12. **A pior pausa de coletor de lixo do Node 18 sob a carga real deste motor.** É o que deveria
    dimensionar os 30 segundos de arrendamento e os 90 do ceifador. Escolhi por convenção, não por
    medição nesta máquina.
13. **Se o PostgreSQL do aglomerado fica atrás de pgbouncer e em qual modo.** Como rejeitei trava
    consultiva de **sessão** para corretude, não bloqueia — mas se houver modo transação, é preciso
    conferir que nada mais no motor dependa de estado de sessão (`SET`, tabela temporária, comando
    preparado nomeado).

### 8.3 Fora do nosso alcance técnico — dependem de gente

14. **O que o Typebot faz com os quatro campos.** É o ponto cego número 1 do documento 25 e continua
    intacto: **onde o chamado efetivamente nasce, quem o recebe, e se existe número de chamado,
    permanece desconhecido.** Ele decide se o nó `http` pode ter política `conciliar` (exige um jeito
    de perguntar «você recebeu?» ou um cabeçalho de idempotência aceito) ou se é obrigatoriamente
    `parar`. Adoto `parar` até que se saiba — que é conservador e **cria uma fila de trabalho manual
    cuja taxa ninguém conhece**. Se essa taxa for alta, o gargalo sai do motor e vai para a operação.
15. **A semântica de `responseTimeout: 4` sem unidade** nos fluxos legados (D7). Herdado. O tradutor
    recusa adivinhar, o que resolve a corretude e **cria trabalho manual de volume desconhecido** —
    não sei quantos nós exigirão a decisão.
16. **Qual árvore de fluxos é a oficial** e o que fazer com o gêmeo `Sub_Suporte_Abertura`. É decisão
    do dono da operação, e ela **precede** a migração em massa.
17. **Se a operação quer retrofit por padrão.** Deixei «mudança compatível migra» como padrão, mas
    isso é política, não conclusão de medição — há operações que preferem que nenhuma conversa em
    andamento mude de comportamento. O modelo suporta as duas: é trocar `modoMigracao` por fluxo.
18. **Se `RagnabotTenant.retentionDays` tem precedência sobre os prazos de poda de §2.9**, e quem
    responde por essa decisão sob LGPD. Encontrei o campo no schema; não encontrei a regra escrita que
    diga qual prazo vence quando os dois discordam.
19. **Se a telemetria de fluxo conta como «histórico de conversas»** para efeito da retenção contratada
    com cada empresa, ou se é dado operacional nosso com retenção própria. É questão do acordo de
    tratamento de dados, e decide se o funil por nó pode viver mais tempo que a conversa que o gerou.
20. **Se os processos do motor alcançam o caminho interno de aviso** que o nó `notificar` usa como
    canal padrão. Não verifiquei. Se a rota não existir, o padrão não funciona no primeiro dia.
21. **Se `RagnabotInbox.metadata` traz `phoneNumberId` preenchido em todas as caixas.** O schema
    permite nulo. O adaptador direto e a chave da janela de 24 h dependem desse campo.

### 8.4 Inferências que assumi e que não provei

22. **Que a perda de atualização existe hoje** entre o salvamento do editor e a gravação de telemetria
    dentro do JSON de `Flows`. É inferência do documento 25 (§2.1): o `updatedAt` muda durante a
    operação e os contadores moram nos nós. O backend está cifrado e ninguém leu o código que grava. A
    separação que proponho elimina a classe de qualquer jeito — mas **não provei que o problema
    existe**.
23. **Que o Chatwoot entrega os eventos em ordem** e que o id de mensagem é monotônico por conta.
    Assumi FIFO por `origemEm` com desempate por `cwMessageId`. Se a entrega for fora de ordem sob
    carga, a regra de ambiguidade de §3.2/C absorve o caso — mas ela foi dimensionada por chute (2 s),
    e não por medição.
24. **Que os códigos de erro de fora-de-janela da Meta formam uma família estável** mapeável para a
    saída `sem_janela`. Vêm de documentação, não de medição minha. A tabela de códigos precisa do
    mesmo `conferidoEm` dos limites.

