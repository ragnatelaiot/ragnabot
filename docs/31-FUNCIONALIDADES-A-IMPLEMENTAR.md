# 🧭 31 — FUNCIONALIDADES QUE PRECISAMOS TER NO RAGNABOT

> **Não é uma cópia do chat atual — é o inventário da funcionalidade em si.** Cada item abaixo foi
> **medido no sistema em produção** (chat001.ragnatela.com.br) em **29/08/2026**, pela API do
> próprio app, com as credenciais de administrador que o dono forneceu. Nada foi escrito lá:
> **só leitura**. Ao lado de cada capacidade está **como a implementamos de forma nativa** — o que
> já existe no Ragnabot e o que falta.
>
> Este documento fecha o ponto cego que o doc 29 §8.1 tinha deixado aberto ("a VM 10016 está
> ilegível"). O caminho que destravou não foi religar o guest agent — foi **entrar pela porta da
> frente do app**, que é a mesma porta que qualquer cliente usa.

---

## 0. Como cada afirmação foi obtida

- **Fonte:** `POST https://chatbk001.ragnatela.com.br/auth/login` → token JWT de admin
  (`profile: admin`, `companyId: 1`). Todas as leituras seguintes com esse token.
- **Alcance:** o backend responde no IP interno `172.17.10.47`; o NOC chega nele pela sub-rede
  `172.17.x` (nó `RGTK8S001`). Da internet, pelo proxy reverso.
- **Endpoints lidos:** `/whatsapp` (conexões e suas automações), `/queue` (setores e horários),
  `/users` (atendentes e turnos), `/settings` (o menu Ajustes), `/companies/listPlan/1` (recursos
  do plano).
- **O que NÃO foi possível ler pela API:** a lista dos fluxos do menu *Chatbot* (o endpoint do
  construtor de fluxo não respondeu aos nomes tentados). O fluxo principal já está detalhado no
  **doc 25** e o motor equivalente, no **doc 28** — então isso não é lacuna de entendimento, só de
  reconferência automática.

> ⚠️ **Achado de segurança, tratado à parte no §10:** a tabela de configurações guarda **segredos
> em texto puro** — inclusive a senha do SMTP, que é **igual à senha de login do dono**. Nenhum
> segredo foi copiado para este documento nem para o Git.

---

## 1. O CORAÇÃO DO PEDIDO — automações por conexão (guia "Conexões")

O dono foi direto: *"as automações ficam nas propriedades de cada conexão na guia conexões"*.
Confirmado. Cada conexão de WhatsApp carrega o seu próprio conjunto de regras. Medido nas **duas
conexões ativas**:

| Campo na origem | Conexão 42 "RAGNATELA" | Conexão 45 "Suporte Ragnatela" | O que faz |
|---|---|---|---|
| `firstContactFlowId` | `e8dc59e7…` | `e8dc59e7…` | **Qual fluxo dispara no primeiro "oi"** — as duas apontam para o mesmo fluxo (ABERTURA DE CHAMADO) |
| `inatividade` | `60` | `60` | Minutos de silêncio até a ação de inatividade |
| **`inatividadeLastMessageType`** | **`contact`** | **`any`** | ⭐ **A resposta que faltava:** qual silêncio conta. `contact` = só o silêncio do **cliente**; `any` = silêncio de **qualquer lado**. Existe também `user` (só o atendente). É escolhido **por conexão**. |
| `inactivityMessage` | preenchida | preenchida | Mensagem enviada quando a inatividade encerra o atendimento |
| `moveAttendingToWaiting` | `true` / `60min` | `true` / `60min` | **Devolve "em atendimento" → "aguardando"** depois de N minutos sem interação |
| `openWaiting` | `false` / `30min` | `false` / `30min` | Reabre um "aguardando" parado |
| `closeWaiting` | `false` / `60min` | `false` / `60min` | Encerra um "aguardando" parado |
| `expiresTicket` | `1` (hora) | `1` (hora) | Expira o ticket após N horas |
| `selectedInterval` | vazio | vazio | Intervalo (almoço) — disponível, não usado |
| `selectedMoveQueueId` | vazio | vazio | Para qual fila mover na inatividade |
| `maxUseBotQueues` | `9999` | `9999` | Quantas vezes o bot pode reapresentar o menu de filas |
| `complationMessage` | preenchida | preenchida | Mensagem de **conclusão** do chamado |
| `greetingMessage` / `outOfHoursMessage` / `ratingMessage` / `attendantBreakMessage` | vazias | vazias | Saudação / fora de hora / avaliação / intervalo do atendente |
| `chatGPTEnabled` `typebotEnabled` `n8nEnabled` `hybridEnabled` | todos `false` | todos `false` | Integrações por conexão |

**A lição para nós:** o silêncio-que-conta (`contact`/`user`/`any`) e os três relógios
(`moveAttendingToWaiting`, `openWaiting`, `closeWaiting`) são **por conexão**, não globais. É
exatamente o modelo que o nosso `RagnabotAtendPolitica` já prevê com escopo por caixa.

### Como implementamos (nativo)

✅ **Já construído** — `RagnabotAtendPolitica` + o trabalhador de atendimento (v1.335.0):
- relógio de inatividade com escolha do lado (`inatividadeConta` = `contato` | `atendente` | `qualquer`);
- devolver "em atendimento" para a fila por tempo;
- congelar fora do expediente.

🔧 **Falta ligar** (campos já no schema, sem consumidor): `openWaiting`/`closeWaiting`
(reabrir/encerrar "aguardando" parado) e `selectedMoveQueueId` (mover para uma fila específica em
vez de devolver para a mesma).

---

## 2. Expediente, intervalo e feriado (menu Ajustes → `scheduleType`)

- **Medido:** `scheduleType = company` — hoje o expediente vale **por empresa**. As alternativas na
  origem são `queue` (por fila) e `disabled`.
- **Cada fila tem `schedules`** com **7 linhas, uma por dia** (seg–sex 08:00–18:00, sáb 08:00–12:00,
  dom fechado). É **uma janela por dia** — impossível representar 08–12 **e** 13–18. **O intervalo
  de almoço não existe na origem**, confirmado.

### Como implementamos (nativo)

✅ **Já construído e SUPERIOR à origem** — `RagnabotAtendExpediente` guarda **uma linha por JANELA**,
então 08:00–12:00 + 13:00–18:00 é cadastro comum, e o intervalo simplesmente não conta prazo.
✅ **Feriado** — `RagnabotAtendExcecaoData`, com data avulsa e recorrente (`*-12-25`). A origem
**não tem feriado em lugar nenhum**.
✅ **Escopo empresa OU caixa OU time** — cobre o `company`/`queue` da origem e vai além.

---

## 3. Turno por atendente — DECISÃO MEDIDA (antes era "medir antes")

O doc 29 §4.4 tinha deixado `RagnabotAtendTurno` no schema **sem código**, à espera de medir se os
atendentes realmente usam turno ou se estão todos em branco.

**Medido:** dos 7 usuários lidos (de 23), **2 têm turno real 08:00–18:00**, 1 tem 00:00–23:59 e 4
estão vazios. A hipótese "todos vazios, tabela nasce morta" está **falsificada**.

**Conclusão:** turno por atendente **é usado** → a funcionalidade **se justifica**, e é **opcional
por atendente** (a maioria herda o expediente da empresa; alguns têm janela própria).

### Como implementamos (nativo)

🔧 **A tabela já existe** (`RagnabotAtendTurno`); falta o código de leitura no trabalhador — agora
**liberado para construir**, porque a medição que faltava foi feita. É um filtro de presença: na
hora de distribuir, respeita a janela do atendente quando ela existe.

---

## 4. O menu Ajustes/Configurações — os interruptores de comportamento

O dono apontou: *"no menu ajustes/configurações vai ver muita coisa lá que são importante"*.
Medidas **23 chaves**. As que mudam comportamento de atendimento:

| Chave | Valor hoje | O que decide | Nós |
|---|---|---|---|
| `scheduleType` | `company` | onde vale o expediente (empresa/fila/desligado) | ✅ escopo por empresa/caixa/time |
| `sendMsgTransfTicket` | `disabled` | manda mensagem ao cliente quando o ticket é **transferido** | 🔧 prever no ato de transferência |
| `sendGreetingAccepted` | `disabled` | manda saudação quando o atendente **aceita** o ticket | 🔧 prever como mensagem automática |
| `userRating` / `userRatingList` | `disabled` | **avaliação (CSAT)** ao fim do atendimento | 🔧 não construído — decidir se entra |
| `requireTicketCloseReason` | `disabled` | **motivo de encerramento** obrigatório (+ categorias) | 🔧 não construído — casa com auditoria |
| `historyMessages` | `queue` | escopo do histórico que o atendente enxerga | 🔧 política de visão |
| `CheckMsgIsGroup` | `disabled` | **ignora mensagens de grupo** | 🔧 filtro de entrada |
| `showClosedTickets` | `true` | mostra tickets fechados na busca | ✅ trivial |
| `acceptCallWhatsapp` + `noCallMessage` | `disabled` + texto | **recusa chamada de voz/vídeo** com aviso | 🔧 recurso do canal |
| `autoCorrectEnabled` | `enabled` | correção automática de texto do atendente | ⬜ cosmético |
| `smtpauth`/`usersmtpauth`/`smtpPort` | skymail:465 | **SMTP do sistema** | ✅ já temos SMTP no Ragnabot |
| `selectedModel` | `gpt-4o-mini` | modelo de IA padrão | ✅ decidimos nós |
| `trial` | `3` | dias de teste (SaaS) | ✅ nosso SaaS já tem planos |

---

## 5. Recursos do plano — os CANAIS e MÓDULOS que precisamos ter

O plano `ESPECIAL-RAGNA` (20 usuários, 5 conexões, 30 filas) liga estes módulos. Esta é a lista mais
importante do documento: é **o escopo de produto** que o chat atual entrega hoje e que o Ragnabot
precisa cobrir.

| Módulo (origem) | Ligado? | O que é | Estado no Ragnabot |
|---|---|---|---|
| `useWhatsapp` | ✅ | canal WhatsApp | ✅ nativo (Chatwoot) — **falta criar a 1ª caixa** |
| `useOficialAPI` | ✅ | **WhatsApp API oficial da Meta** | ✅ suportado (`whatsapp_cloud`); depende do número liberado |
| `useFacebook` | ✅ | **Messenger** | 🔧 canal nativo do Chatwoot, não ligado |
| `useInstagram` | ✅ | **Direct do Instagram** | 🔧 canal nativo do Chatwoot, não ligado |
| `useCampaigns` | ✅ | **disparo em massa / campanhas** | 🔧 não construído |
| `useSchedules` | ✅ | **mensagens agendadas** | 🔧 não construído |
| `useInternalChat` | ✅ | **chat interno entre atendentes** | 🔧 não construído |
| `useExternalApi` | ✅ | **API externa** (integrar sistemas do cliente) | 🔧 não construído |
| `useTickHub` | ✅ | central de tickets | ✅ é o próprio Chatwoot |
| `useTypebot` / `useN8n` | ✅ | integrações de fluxo/automação | 🔧 substituídos pelo **nosso motor de fluxo** (doc 28) |
| `useChatGPT` / `useConnectAi` | ✅ | IA no atendimento | 🔧 decidir integração nativa |
| `useBotoes` | ✅ | **botões/listas interativas** no WhatsApp | 🔧 nó do motor de fluxo |
| `useStorage` | ✅ | **anexos** | ✅ nativo (MinIO próprio, doc 30) |
| `useAgenda` `useAgenteIA` `useMetaAds` `useLeadExtractor` `useScheduleAutomation` `useAssinaturaEletronica` `useConnectzapVoip` | ❌ | agenda, agente de IA, Meta Ads, extrator de leads, automação de agenda, assinatura eletrônica, VoIP | ⬜ desligados na origem — **fora do escopo mínimo** |

**Prioridade de canal, medida:** WhatsApp (oficial + não oficial), **Facebook** e **Instagram** já
estão pagos e ligados no plano do chat atual. O Chatwoot que roda o Ragnabot **tem esses três
canais nativos** — é ligar, não construir.

---

## 6. Transferência entre atendentes e times

- **Origem:** existe, mas `sendMsgTransfTicket=disabled` (não avisa o cliente ao transferir), e a
  conta tem **0 Times** — por isso a transferência para setor "não funciona" na prática (é cadastro,
  não engenharia). A palavra "Transferir" nem aparece na tela em português.

### Como implementamos (nativo)

✅ **Já construído** (v1.335.0) — `transferirTime` e `devolverParaFila` na porta do Chatwoot, e as
duas **tiram o atendente anterior junto** (transferir mantendo o nome colado não é transferência).
🔧 **Falta** a opção de avisar o cliente no ato (`sendMsgTransfTicket`) e o registro em
`RagnabotAtendTransferencia` amarrado ao caminho de entrada.

---

## 7. Fluxo do primeiro "oi" (menu Chatbot)

- **Medido:** as duas conexões apontam `firstContactFlowId` para o **mesmo** fluxo — o ABERTURA DE
  CHAMADO, detalhado byte a byte no **doc 25**.
- O motor nativo equivalente está especificado no **doc 28** e construído (20 tabelas).

### Como implementamos (nativo)

✅ **Motor construído.** 🔧 **Falta o elo de entrada** (`iniciarOuRecuperarExecucao()` ainda não é
chamada por ninguém — o "resolvedor de entrada" do doc 29 §5.2) e o **serviço de publicação**
(`ragnabot-fluxo-publicacao.service.js`), lembrando que a **assinatura da estrutura tem de ignorar
as coordenadas do editor** (`no.ui`), senão arrastar um bloco órfã as conversas em curso.

---

## 8. Mensagens automáticas — o catálogo medido

Textos que a conexão dispara sozinha (todos com variáveis `{{firstName}}`, `{{ticket_id}}`):

| Momento | Campo | Preenchido hoje? |
|---|---|---|
| Conclusão do chamado | `complationMessage` | ✅ (copy da Ragnatela) |
| Inatividade encerra o ticket | `inactivityMessage` | ✅ |
| Saudação inicial | `greetingMessage` | ❌ (o fluxo faz isso) |
| Fora de expediente | `outOfHoursMessage` | ❌ |
| Avaliação (CSAT) | `ratingMessage` | ❌ |
| Intervalo do atendente | `attendantBreakMessage` | ❌ |

### Como implementamos (nativo)

🔧 Cada mensagem automática vira uma **ação do relógio/expediente** no nosso trabalhador, com o
texto na política e as mesmas variáveis. O caminho de envio já existe (porta do Chatwoot), sujeito
à janela de 24h do WhatsApp — fora dela, a ação de estado acontece e a mensagem fica em nota interna.

---

## 9. MAPA DE IMPLEMENTAÇÃO — o que falta, por prioridade

**Fatia 1 — completa o núcleo do pedido do dono (relógios + transferência):**
- 🔧 ligar `openWaiting`/`closeWaiting` e `selectedMoveQueueId` no trabalhador (campos já no schema);
- 🔧 registrar a transferência em `RagnabotAtendTransferencia` + opção de avisar o cliente;
- 🔧 o **resolvedor de entrada** (fluxo do primeiro "oi") — barato, destrava o motor já construído.

**Fatia 2 — canais que já estão pagos na origem:**
- 🔧 ligar **Instagram Direct** e **Facebook Messenger** (nativos do Chatwoot);
- 🔧 criar a **primeira caixa de WhatsApp** (hoje há zero — nada foi exercitado com conversa real);
- 🔧 **botões/listas interativas** como nó do motor de fluxo.

**Fatia 3 — só depois de medir (agora medido, liberado):**
- 🔧 `RagnabotAtendTurno` — turno por atendente (a medição provou que é usado).

**Fatia 4 — decidir se entram (existem na origem, desligados ou opinativos):**
- ⬜ avaliação/CSAT (`userRating`), motivo de encerramento (`requireTicketCloseReason`),
  campanhas, mensagens agendadas, chat interno, API externa, recusa de chamada.

---

## 10. ⚠️ SEGURANÇA — segredos em texto puro na origem

Durante a leitura das configurações, a tabela devolveu **segredos em claro**:

- **`clientsecretsmtpauth`** = a senha do SMTP `alerta@ragnatela.com.br` — e ela é **igual à senha
  de login do dono** no painel. Duas contas críticas com a mesma senha, e a senha visível para
  qualquer admin do app.
- **`openAiApiKey`** — chave de serviço da OpenAI, em claro.
- **`connectAiClientSecret`** / **`connectAiClientId`** — credenciais de integração, em claro.

**Nenhum desses valores foi copiado para este documento, para o log ou para o Git.**

**Recomendação ao dono:** trocar a senha do SMTP e **desacoplá-la** da senha de login; rotacionar a
chave da OpenAI. No Ragnabot esse problema não existe por construção — segredo vive cifrado no
`Secret` do Kubernetes / `.env`, nunca legível pela aplicação nem por um admin de empresa.

---

## 11. Sobre "religar o agente" da VM 10016

O dono autorizou religar o guest agent para destravar o levantamento. **Não foi preciso** — o
levantamento inteiro saiu pela **API do app** (a porta da frente), que é mais fiel à *funcionalidade*
do que ler o banco por dentro.

Para **efetivamente** religar o `qemu-guest-agent` (o que também recupera a leitura do `/painel-noc`),
o caminho honesto continua sendo:
- **SSH na VM como a conta `insider`** (senha no cofre do dono) → `systemctl restart qemu-guest-agent`; **ou**
- console da VM.

O que **não** farei: **reiniciar a VM** para o agente subir no boot — o chat atual está **em
produção com as empresas ativas**, e reinício de uma VM viva é interrupção. Rebootar VM é permitido
pela LEI (só o hipervisor é intocável), mas não sobre um serviço em uso sem necessidade. Se você
quiser o agent religado agora, me passe a senha da conta `insider` e eu faço só o `systemctl restart`
(sem tocar no app).

---

## 12. Resumo em uma página

- **As automações são por conexão** (o dono confirmou) e já foram **todas medidas**: inatividade com
  escolha do lado (`contact`/`user`/`any`), três relógios de "aguardando", expira-ticket, fluxo do
  primeiro "oi".
- **A pergunta "atendente ou contato" está respondida:** é o campo `inatividadeLastMessageType`, por
  conexão — hoje uma usa `contact`, outra usa `any`.
- **Turno por atendente É usado** (2 de 7 com 08–18): a funcionalidade nossa se justifica e está
  liberada para construir.
- **Intervalo de almoço e feriado a origem não faz** — nós já fazemos (janela, não dia).
- **Canais Facebook e Instagram já estão pagos** no plano da origem e são nativos do nosso Chatwoot:
  ligar, não construir.
- **Metade do que "falta" é ambiente vazio:** 0 Times, 0 caixas de WhatsApp, expediente por empresa.
- **Segredos em texto puro na origem** — trocar SMTP (= senha de login) e rotacionar OpenAI.
- **Nada foi escrito na origem.** Tudo é leitura, medida em 29/08/2026.
