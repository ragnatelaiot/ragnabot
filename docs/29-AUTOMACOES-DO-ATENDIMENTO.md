# 🕰️ 29 — AUTOMAÇÕES DO ATENDIMENTO
### Transferência, relógios de inatividade, expediente, intervalo e fluxo do primeiro "oi" — o que existe, o que falta e como construir

> Escrito em **29/08/2026**. Origem desta tarefa: a reclamação do dono de 28/08, transcrita
> na íntegra no §0. Este documento **corrige um erro meu**: eu havia afirmado que a
> transferência "é nativa" olhando o modelo de dados. Modelo existir não é funcionalidade
> existir. O §1 traz a causa medida.
>
> **Documentos irmãos:** `18-LEVANTAMENTO-CHAT-ATUAL.md` (engenharia reversa da origem),
> `19-COMPARATIVO-E-BACKLOG-RAGNABOT.md` (veredito função a função),
> `25-FLUXO-ABERTURA-DE-CHAMADO.md` (o fluxo real, nó a nó),
> `28-MOTOR-DE-FLUXO-ESPECIFICACAO.md` (a especificação do motor já construído).

---

## 0. A reclamação, nas palavras do dono (28/08/2026)

> "não consigo transferir para outro agente uma conversa, essas coisas sinto falta do agente ter
> investigado no atual chat. A transferência de chamados é extremamente importante. E fora outros,
> a parte de conexões WhatsApp tem opções de automações que são extremamente necessárias, tipo
> tempo para um atendimento ir para fila de aguardando se não tiver mais interação ou do atendente
> ou do contato (isso é escolhido nas configurações), qual o fluxo será usado no primeiro 'oi',
> horário fora de expediente, o horário de intervalo, enfim, uma infinidade de coisas importantes
> que falta. Você precisa rastrear tudo isso e fazer."

Cinco pedidos nominais, e é por eles que este documento é organizado:

| # | pedido do dono | veredito medido | onde está neste documento |
|---|---|---|---|
| 1 | Transferir conversa para outro agente | **Funciona para agente. Impossível para setor** — a conta tem zero Times | §1 |
| 2 | Tempo até o atendimento voltar para "aguardando" por falta de interação | **Não existe.** Nenhum gatilho de tempo no produto | §2.1, §4.1, §6 fatia 1.2 |
| 3 | Escolher se o relógio conta o **atendente** ou o **contato** | **Não existe** — e não existe nem como conceito | §2.1, §4.1 |
| 4 | Qual fluxo é usado no primeiro "oi" | **Não existe o amarrado.** O motor existe, a amarração não | §2.3, §5.2, §6 fatia 1.3 |
| 5 | Horário fora de expediente e **horário de intervalo** | Expediente existe, **capado a uma janela por dia**. Intervalo é impossível hoje | §2.4, §4.2 |

---

## 0.1 Como cada afirmação deste documento foi obtida

Três procedências, sempre marcadas no texto:

- **`[medido 29/08]`** — eu mesmo rodei a consulta no Ragnabot em produção nesta sessão, pelo
  caminho já usado pelo NOC (`ragnabot-cluster.service.js`): hipervisor RGTSRVHST001 →
  `qm guest exec 10601` → `kubectl exec` no pod `ragnabot-web-646797487f-7xcmn` →
  `rails runner`. Tudo leitura; nenhuma escrita.
- **`[medido 28/08]`** / **`[medido 19/08]`** — vem dos levantamentos anteriores da casa, com a
  data de origem preservada. Não reconferi (ver §8).
- **`[não medido]`** — declarado como buraco, de propósito. Não inventei número nenhum.

**O que NÃO foi feito:** não abri a tela do produto num navegador com a conta do dono, e não li a
VM 10016 (o agente convidado continua parado — `[medido 29/08]`, §8.1).

---

## 1. A RESPOSTA DA TRANSFERÊNCIA

### 1.1 A causa, medida

Não é permissão, não é bug, não é ausência de funcionalidade. São **três coisas somadas**, e só a
segunda é impeditiva de verdade.

**(a) Transferir para AGENTE funciona.** `[medido 29/08]`
A caixa de entrada 1 devolve **5 agentes atribuíveis** (`Inbox#assignable_agents` → ids `[1, 4, 5,
6, 7]`), e os 5 usuários da conta são **todos `administrator`** — permissão não é o obstáculo. O
endpoint `POST /api/v1/accounts/1/conversations/:display_id/assignments` só exige poder **ver** a
conversa. O caminho está aberto.

**(b) Transferir para SETOR é impossível hoje — a conta tem ZERO Times.** `[medido 29/08]`
`Account.first.teams.count` devolveu **0**. No Chatwoot, "Setor" chama-se **Time**. Sem nenhum time
cadastrado o campo "Time atribuído" abre vazio, e o submenu do menu de contexto fica **inerte por
desenho**: o componente traz `:sub-menu-available="!!teams.length"`. O operador clica e nada
acontece — que é exatamente a sensação de "não consigo transferir".
**Isto não é engenharia. É cadastro.**

**(c) A palavra "Transferir" não existe na interface em português.** `[medido 29/08]`
Os rótulos em pt-BR são **"Agente atribuído"** e **"Time atribuído"** (`ASSIGNEE_LABEL` /
`TEAM_LABEL` em `pt_BR/conversation.json`). A palavra "transferir" aparece uma única vez em todo o
pacote de tradução do painel, e é em `integrations.json` — assunto sem relação. Quem procura
"Transferir" **não acha**, porque não existe. Some a isso que o controle mora dentro de um acordeão
arrastável do painel direito, cujo estado de aberto/fechado é gravado **por usuário** — se o dono o
fechou uma vez, ele não vê o campo de novo.

### 1.2 O passo a passo para o dono — resolve hoje, sem escrever uma linha de código

> ⚠️ **Nada disto foi executado por mim.** Cadastrar time é **escrita** na plataforma, e o meu
> mandato nesta tarefa era medir e especificar. O passo a passo abaixo é para o dono executar, ou
> para autorizar que eu execute.

1. **Criar os Times (= Setores).** Painel → *Configurações* → *Times* → *Criar novo time*.
   Um por setor real: Suporte, Comercial, Financeiro, NOC — os mesmos que existem hoje na origem.
   ➜ Assim que o primeiro time existir, o campo "Time atribuído" e o submenu "Atribuir um Time"
   passam a funcionar na mesma hora, sem reinício de nada.
2. **Pôr agente em cada time.** Time vazio transfere para o nada, e a conversa fica órfã.
3. **Ligar `allow_auto_assign` no time** se quiser que a conversa transferida caia automaticamente
   em alguém do time. Sem isso, ela chega ao time e fica esperando alguém puxar.
4. **Achar o controle de agente na tela:** abrir a conversa → painel da direita → acordeão
   **"Ações da conversa"** → **"Agente atribuído"**. Se o acordeão estiver fechado, arraste-o para
   cima e abra — o estado fica salvo por usuário.
   Caminho alternativo, mais rápido: **clique com o botão direito na conversa na lista** →
   *Atribuir ao Agente* / *Atribuir um Time*.

### 1.3 O que ainda precisa ser construído na transferência

Cadastrar times destrava o botão, mas **não** entrega a transferência que uma operação séria usa.
Três buracos medidos:

- **Transferência é silenciosa.** `[medido 29/08]` O que acontece é a troca do `assignee_id`, uma
  mensagem de atividade e uma notificação interna. **Não existe motivo, não existe nota de
  passagem, não existe aceite e não existe aviso ao agente que recebe** — nem por WhatsApp, nem por
  nada fora do painel. Quem recebe a conversa não sabe por que ela chegou.
- **Não há relatório de transferência.** Não há "quem passou para quem, quando e por quê". Isso
  some no ruído das mensagens de atividade.
- **O escopo de empresa não é checado no caminho manual.** `[medido 29/08]` O
  `Conversations::AssignmentService` procura o destinatário com
  `conversation.account.users.find_by(id: assignee_id)` — ou seja, pela API dá para atribuir a
  conversa a **qualquer usuário da conta**, mesmo sem acesso àquela caixa de entrada. A checagem de
  pertencimento (`agent_belongs_to_inbox?`) só existe no caminho de automação e macro. A tela
  esconde o problema porque só lista agentes atribuíveis; a API, não.
  ➜ **Isto é falha de escopo e entra na fatia 2**, com teste provando que a empresa A não alcança a B
  (mesmo padrão do `tests/ragnabot-isolamento.test.mjs` já existente).

---

## 2. O CATÁLOGO COMPLETO DAS AUTOMAÇÕES

Como ler as colunas:

- **onde mora hoje** — o lugar exato na origem (sistema atual, VM 10016).
- **Ragnabot tem?** — ✅ nativo · ⚠️ parcial (existe algo, mas não a mesma coisa) · ❌ não existe.
- **usada hoje?** — se a operação real usa. Tabela vazia depois de 14 meses e 10 empresas **não é
  requisito, é vitrine do fornecedor**.
- **veredito** — **CONSTRUIR** (código nosso) · **CONFIGURAR** (existe, é cadastro/manual) ·
  **DESCARTAR** (não reconstruir) · **MEDIR ANTES** (custo alto e uso desconhecido — a medição é
  mais barata que a construção).

> A regra que governa os descartes: **reconstruir fachada é o erro caro deste projeto**. Campo que
> existe há catorze meses e nunca foi preenchido não vira requisito só porque estava na tela do
> fornecedor.

### 2.1 Relógios de tempo — o núcleo do pedido do dono

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Mover "atendendo" → "aguardando" por falta de interação** | modal da Conexão + chave `moveQueue` / `tempofila` | ❌ | ❌ `moveQueue` = `disabled` no global `[medido 19/08]` | **CONSTRUIR** | É o pedido nº 1. `[medido 29/08]` Os quatro estados existem, e a **ação** existe (`pending_conversation` no `ActionService`) — o que não existe é o **gatilho de tempo**. Nenhum trabalho periódico devolve conversa para `pending`; `pending!` só aparece em ação explícita de automação/macro e ao desatribuir agente |
| **Escolher se o relógio conta o ATENDENTE ou o CONTATO** | presumivelmente coluna do modal da Conexão | ❌ | `[não medido]` | **CONSTRUIR** | O dono citou nominalmente. Não existe nem como conceito no destino. Mas a **matéria-prima existe** `[medido 29/08]`: a tabela `conversations` tem `waiting_since`, `last_activity_at`, `first_reply_created_at` e `status_changed_at`. `waiting_since` é preenchido quando entra mensagem do contato e zerado quando o agente responde em público — é o campo que separa os dois silêncios, e hoje nenhuma automação configurável o consome |
| **Transferência automática para setor após X minutos (transbordo)** | `Whatsapps.transferQueueId` + `timeToTransfer` | ⚠️ | `[não medido]` | **CONSTRUIR** | Regra de automação **quase** resolve: a ação `assign_team` existe e o `execution_delay` existe. Mas `[medido 29/08]` o atraso está atrás da bandeira `delayed_automations`, que devolveu **`false`**, e só admite condição sobre `status` e `inbox_id` (`DELAYED_CONVERSATION_ATTRIBUTES`), com o episódio chaveado em `status_changed_at`. Ou seja: dá para dizer "está aberta há 30 min", **não** dá para dizer "ninguém falou nada há 30 min" — mensagem nova não muda o status e portanto não rearma o relógio |
| **Encerrar conversa aberta após X horas de inatividade** | `Whatsapps.expiresTicket` + `hoursCloseTicketsAuto` | ✅ | ✅ conexões 42 e 45 com `expiresTicket = 1` `[medido 28/08]` | **CONFIGURAR** (e completar) | Nativo: `auto_resolve_after` em minutos, faixa de 10 a 1.439.856. `[medido 29/08]` está **`nil`** na conta 1, e `Account.settings` tem só quatro chaves, todas desta família (`auto_resolve_after`, `auto_resolve_ignore_waiting`, `auto_resolve_label`, `auto_resolve_message`). **Três limites duros:** o escopo é a **conta inteira** (não a caixa, não o time); a ação é **só resolver**, nunca devolver para a fila; e o relógio é `last_activity_at`, que qualquer mensagem **dos dois lados** atualiza — logo, não distingue quem ficou calado |
| **Tempo de fila (`tempofila`)** | Configurações → Atendimento | ❌ | `[não medido]` | **MEDIR ANTES** | A chave existe, mas a **semântica nunca foi lida** — o backend do fornecedor tem os textos cifrados, e o significado foi inferido do rótulo traduzido da tela. Pode ser tempo máximo em fila antes de uma ação, ou só limite de exibição. Não construir sobre suposição |
| **Avisar a posição na fila para o cliente** | `sendQueuePosition` | ❌ | `[não medido]` | **DESCARTAR** (por ora) | Recurso de percepção de espera, não de operação. Custa fila ordenada e ao vivo por setor. Volta se o dono pedir |
| **Pausar a distribuição (interruptor de emergência)** | `pauseAttendance` | ⚠️ | `[não medido]` | **CONSTRUIR** (barato) | No destino o mais próximo é desligar `enable_auto_assignment` da caixa — é por caixa, não avisa ninguém e não tem prazo. Um campo com motivo e hora de volta resolve o dia de incidente |

### 2.2 Expediente, intervalo e feriado

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Horário de expediente** | `scheduleType` (empresa) + `Queues.schedules` (setor) + `Flows.schedule` (fluxo) | ⚠️ | ✅ `company` em 4 empresas, `disabled` em 6; as 52 filas com 08:00–18:00 seg-sex `[medido 28/08]` | **CONSTRUIR** (por cima do nativo) | `[medido 29/08]` No destino o expediente é **sempre por caixa de entrada** (`inboxes.working_hours_enabled` + `inboxes.timezone` + tabela `working_hours`). **Não existe expediente por empresa nem por time.** Hoje: `working_hours_enabled = false` e `timezone = UTC` — **não** `America/Fortaleza`, o que sozinho já erra o expediente em 3 horas |
| **Horário de INTERVALO (almoço)** | teria de estar dentro do jsonb `Queues.schedules` | ❌ | `[não medido]` na origem | **CONSTRUIR** | O dono citou nominalmente. `[medido 29/08]` `working_hours` guarda **uma janela por dia** — colunas `day_of_week, open_hour, open_minutes, close_hour, close_minutes, open_all_day, closed_all_day` — e a caixa 1 tem exatamente **7 linhas, uma por dia da semana**. É **impossível** representar 08–12 e 13–18. Intervalo não existe no destino e nasce do zero (§4.2) |
| **Feriados** | só dentro do módulo Agenda | ❌ | ❌ o módulo Agenda inteiro tem **zero** registros em 14 meses `[medido 28/08]` | **CONSTRUIR** (de carona) | Não existe nem na origem (fora de um módulo morto) nem no destino. Mas pendurar na mesma estrutura do expediente custa uma tabela pequena, e "atender no Natal por engano" é erro que o cliente enxerga |
| **Mensagem de fora de expediente** | 4 lugares: conexão, `Queues.outOfHoursMessage`, `Settings`, `Flows.offHoursMessage` | ⚠️ | parcial — as 52 filas têm o campo; o fluxo ABERTURA DE CHAMADO está **vazio** `[medido 28/08]` | **CONFIGURAR** + consolidar | `[medido 29/08]` No destino é **um só lugar**: `inboxes.out_of_office_message`, hoje `nil`. Consolidar quatro lugares em um é ganho, não perda — a dispersão é a razão de o operador não achar a chave. ⚠️ **Armadilha medida:** a mensagem sai no máximo uma vez por dia por conversa, e o teste conta **qualquer** mensagem do tipo `template` naquele dia, **inclusive a saudação**. Se a saudação saiu, a de fora de expediente **não sai** |
| **Encerrar a conversa depois da mensagem de fora de expediente** | `Flows.closeAfterOffHoursMessage` | ❌ | ❌ `false` no fluxo medido `[medido 28/08]` | **CONSTRUIR** (barato) | Decide se o robô fala e vai embora, ou fala e deixa a conversa esperando o dia seguinte. Um booleano na política |
| **Expediente POR ATENDENTE (`startWork`/`endWork`)** | cadastro de Usuários | ❌ | `[não medido]` — o campo é citado, a distribuição de valores nos 77 usuários nunca foi lida | **MEDIR ANTES** | `[medido 29/08]` No destino **não existe turno por agente** — só o status que a própria pessoa marca (online/ausente/ocupado). É o item B10 do documento 19. Se os 77 usuários estiverem todos com 00:00–00:00, o requisito nunca foi usado e a construção não se justifica agora |

### 2.3 Fluxo, chatbot e roteamento de entrada

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Fluxo do PRIMEIRO CONTATO (o primeiro "oi")** | `Whatsapps.firstContactFlowId` — campo distinto do `flowId` | ⚠️ | ✅ as duas conexões da Ragnatela apontam para o fluxo "Principal NORMAL" `[medido 28/08]` | **CONSTRUIR** (a amarração) | O dono citou nominalmente. **O motor já está construído** — 16 tipos de nó, 20 tabelas, testado. O que falta é **quem escolhe o fluxo**: `[medido 29/08]` `iniciarOuRecuperarExecucao()` exige `fluxoId` e `versaoId` e **nenhum código do repositório a chama** — o resolvedor de entrada é o elo que falta (§5.2). Do lado do Chatwoot não há fluxo nenhum: só saudação de texto fixo e **um** bot-webhook por caixa, sem palavra-chave, sem horário, sem alternativa |
| **Fluxo padrão da conexão (`flowId`)** | modal da Conexão | ⚠️ | ✅ `[medido 28/08]` | **CONSTRUIR** (mesma amarração) | `RagnabotFluxo` já tem `entrada = 'caixa'` e `cwInboxId` — a metade do caminho existe no schema. Falta a precedência declarada e o resolvedor |
| **Palavras-chave que disparam um fluxo** | `Flows.keywords` | ⚠️ | ❌ no fluxo principal: `keywords` com string vazia `[medido 28/08]` | **CONFIGURAR** | `RagnabotFluxo.entrada = 'palavra_chave'` + `palavrasChave` já estão no schema. É preencher e ordenar a precedência |
| **Horário próprio do FLUXO (`Flows.schedule`)** | editor de fluxo | ❌ | ❌ os 7 dias com `active:false` `[medido 28/08]` | **DESCARTAR** | É o **quarto** lugar onde mora horário. Concentrar em um só (§4.2) é decisão de produto, não perda de função. Ninguém usa |
| **Limite de reenvio do chatbot na mesma conversa** | `Whatsapps.maxUseBotQueues` | ⚠️ | ✅, mas neutralizado: `9999` nas duas conexões da Ragnatela `[medido 28/08]` | **DESCARTAR** (já resolvido melhor) | O valor 9999 mostra que a operação desligou o freio na prática. No nosso motor isso já é responsabilidade do desenho do fluxo: `visitasPorNoMax` (10), `passosPorEvento` (50), `passosTotalMax` (500) e as saídas de exceção `sem_resposta`/`opcao_invalida`. Reconstruir o campo seria trocar um freio bom por um pior |
| **Espera e tempo limite dentro do fluxo** | `waitNode`, `interactionWaitNode`, `responseTimeout` | ✅ | ✅ intensamente — 137 usos de `waitNode` e 18 de `interactionWaitNode` nos 35 fluxos `[medido 28/08]` | **CONFIGURAR** | O nó `espera` existe e é a forma correta. ⚠️ O `responseTimeout = 4` da lista de confirmação está **sem unidade declarada** no banco da origem — segundos ou minutos não foi determinado (§8) |
| **Modo de teste do fluxo com número de teste** | `isTestMode`, `testNumber` | ⚠️ | ❌ `false`/nulo no fluxo medido `[medido 28/08]` | **CONSTRUIR** (fatia 3) | O motor já tem rascunho e versão imutável — a base de publicar sem quebrar existe. Falta o "dispare num número de teste". Item B18 do documento 19 |
| **ChatGPT / Typebot / n8n / Dialogflow por conexão** | modal da Conexão, aba Integrações | ⚠️ | ❌ nenhuma conexão com qualquer chave ligada `[medido 28/08]` | **DESCARTAR** | Superfície enorme, uso **zero** em 14 meses. No destino o equivalente é o Agent Bot por caixa (`[medido 29/08]`: **0 agent bots**) |
| **Integração e prompt de IA amarrados ao SETOR** | `Queues.integrationId`, `Queues.promptId` | ⚠️ | ❌ 1 projeto Typebot cadastrado, **zero** conexões ligadas; tabela `Prompts` vazia `[medido 28/08]` | **DESCARTAR** | Mesma razão |

### 2.4 Mensagens automáticas

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Saudação da conexão** | modal da Conexão + `Queues.greetingMessage` | ✅ | `[não medido]` por conexão; os 52 setores têm o campo | **CONFIGURAR** | `[medido 29/08]` `greeting_enabled = true` na caixa 1. Perde-se a saudação **por setor** (só existe por caixa) — cobrir com o nó `texto` do fluxo, que é mais flexível que o campo |
| **Mensagem automática ao TRANSFERIR** | `sendMsgTransfTicket` + `transferMessage` + `attendantTransferMessage` | ⚠️ | `[não medido]` | **CONSTRUIR** | São três chaves: ligar/desligar, texto ao mudar de **setor** e texto ao mudar de **atendente**. Liga direto na reclamação nº 1. Cobrível com regra de automação em `conversation_updated`, mas o texto certo por tipo de transferência é da política (§4.1) |
| **Mensagem de "atendente indisponível" (`{attendantName}`)** | modal da Conexão | ❌ | `[não medido]` | **CONSTRUIR** (barato) | Evita o cliente falando sozinho ao cair numa fila sem ninguém em turno. Já marcado como LEVAR no documento 19 §1.6 |
| **Enviar saudação ao ACEITAR o atendimento** | `sendGreetingAccepted` | ⚠️ | ✅ pouco — `enabled` em 2 das 10 empresas `[medido 28/08]` | **CONFIGURAR** | Regra de automação no evento de atribuição, ou macro. Não precisa de campo dedicado |
| **Mensagem ao aceitar o atendimento** | `acceptTicketMessage` | ⚠️ | `[não medido]` | **CONFIGURAR** | Macro ou automação |
| **Saudação quando a empresa tem um único setor** | `sendGreetingMessageOneQueues` | ❌ | `[não medido]` | **DESCARTAR** | Regra de canto que só existe porque o menu de setor é obrigatório na origem. No nosso desenho o fluxo decide se mostra menu |
| **Mensagem de conclusão / despedida** | modal da Conexão + `Users.farewellMessage` | ⚠️ | `[não medido]` | **CONFIGURAR** | No destino só existe `auto_resolve_message` (a do encerramento automático). Despedida ao resolver manualmente e despedida própria por atendente saem por macro — ao custo de um clique |
| **Despedida ao ticket que ficou só esperando** | `sendFarewellWaitingTicket` | ❌ | `[não medido]` | **CONSTRUIR** (de carona no relógio) | Fecha o ciclo de quem entrou na fila e desistiu. Sai de graça junto com o relógio de inatividade — é a mesma máquina |
| **Assinatura do atendente na mensagem** | `sendSignMessage` | ✅ | `[não medido]` | **CONFIGURAR** | Nativo: `inboxes.sender_name_type` |
| **Etiquetas automáticas** | tabela `TagWhatsAppMappings` | ✅ | ❌ tabela **vazia** `[medido 28/08]` | **CONFIGURAR** | Nativo: ação `add_label` de automação e `auto_resolve_label` no encerramento |
| **Mapeamento tag ↔ etiqueta nativa do WhatsApp** | `TagWhatsAppMappings` | ❌ | ❌ vazia | **DESCARTAR** | Só existe no canal **não oficial**. Some por definição na API da Meta |
| **Palavras-chave com resposta automática** | `Keywords` / `KeywordMessages` | ✅ | ❌ tabelas **vazias** | **CONFIGURAR** | Nativo e melhor: regra de automação em `message_created` com condição de conteúdo |

### 2.5 Distribuição e capacidade

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Limite de atendimentos simultâneos por atendente** | **não encontrado** na origem | ✅ | `[não medido]` na origem | **CONFIGURAR** | `[medido 29/08]` Existe e é melhor que a origem: `inboxes.auto_assignment_config['max_assignment_limit']` — hoje `{}`, **sem limite**. Ganho puro na migração |
| **Distribuição: sequencial × equilibrada; prioridade da fila** | **não encontrado** (`selectedfila` = `{}` e `sendIdQueue` nulo nas 9 conexões `[medido 19/08]`) | ✅ | ❌ | **CONFIGURAR** | `[medido 29/08]` `assignment_policies` tem `assignment_order`, `conversation_priority`, `fair_distribution_limit`, `fair_distribution_window`, `exclude_older_than_hours` e `enabled`. Bandeira `assignment_v2` **ligada**. Hoje: **0 políticas cadastradas** e nenhuma amarrada à caixa. Redistribuição periódica a cada 30 min já existe |
| **Distribuir só para quem está de plantão** | `Users.startWork`/`endWork` | ❌ | `[não medido]` | **MEDIR ANTES** | Ver §2.2. O único filtro nativo é o status manual do agente. `[medido 29/08]` os 5 usuários estão todos `online` |
| **Exigir escolha de setor ao aceitar** | `requireDepartmentOnAccept` | ❌ | ❌ `disabled` na empresa 2 e no global `[medido 28/08]` | **DESCARTAR** | Ninguém liga. Só faria sentido se o relatório por setor fosse levado a sério, e hoje não é |
| **Ordem do setor na fila do bot** | `Queues.orderQueue` | ❌ | ❌ **nulo nas 52 filas** `[medido 19/08]` | **DESCARTAR** | Exemplo perfeito de campo que existe e ninguém preencheu. Não reconstruir |
| **Ocultar atendimentos de chatbot para certos usuários** | `hideChatbotTickets` | ⚠️ | `[não medido]` | **CONFIGURAR** | Filtro salvo, ou o bot só atribuir ao final |
| **Carteira de clientes (dono fixo por contato)** | `walletAssignmentMode` + `Contacts.walleteUserId` | ❌ | `[não medido]`; a página está liberada para 3 usuários | **MEDIR ANTES** | É atribuição **permanente**, coisa que o Chatwoot não tem (ele atribui conversa a conversa). Aproximável com atributo do contato + automação na criação. Item B5 do documento 19 |

### 2.6 Encerramento, avaliação e supervisão

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Avaliação (CSAT) ao encerrar** | `userRating` + mensagem por fila + nó do fluxo | ✅ | quase não — habilitado em **1** das 10 empresas; 178 notas `[medido 28/08]` | **CONFIGURAR** | `[medido 29/08]` `csat_survey_enabled = false` e `csat_config = {}` na caixa 1. Nativo, com emoji ou estrela |
| **Tabulação obrigatória no encerramento** | `requireTicketCloseReason` | ❌ | ❌ `disabled` nas 10 empresas; os 502 registros de encerramento são **100% `automatic`** `[medido 28/08]` | **MEDIR ANTES** | Requisito legítimo, mas **nunca validado com gente** na origem. Construir simples, ligar em UMA operação e medir adoção — recomendação do documento 19 (B6) |
| **Central de Notificações operacionais (avisar por WhatsApp: N pendentes, espera > X min)** | `NotificationCenterRules`, sem item de menu | ❌ | ❌ tabela **vazia** `[medido 28/08]` | **CONSTRUIR** (fatia 3) | O fornecedor construiu e ninguém ligou — mas o requisito é real e combina com a cultura do NOC. `[medido 29/08]` No destino há `sla_policies` com os três limites certos, **porém** a bandeira `sla` devolveu **`false`**, e no estouro o serviço **só grava um evento e notifica dentro do produto**: não transfere, não escala, não avisa no WhatsApp. Item B9 do documento 19 |
| **Notificar um número de WhatsApp a partir de uma automação** | — | ❌ | — | **CONSTRUIR** | `[medido 29/08]` As 19 ações do `ActionService` são: `send_message, send_attachment, add_private_note, add_label, remove_label, send_email_to_team, send_email_transcript, send_webhook_event, assign_agent, assign_team, remove_assigned_agent, remove_assigned_team, mute_conversation, change_status, change_priority, open_conversation, pending_conversation, resolve_conversation, snooze_conversation`. Não há "avisar o número X no WhatsApp". Do nosso lado é barato — o nó `notificar` do motor já faz isso, com destinatário por **papel**, nunca número cravado |
| **Controle de Tickets em lote com horário de pico** | tabelas `TicketUnify*`, sem item de menu | ❌ | ❌ **vazias** `[medido 28/08]` | **DESCARTAR** | Zero uso. Só volta com demanda declarada |
| **Automação de agendamento** | `ScheduleAutomations` | ❌ | ❌ **vazia** | **DESCARTAR** | Já era o veredito do documento 19 |
| **Intervalo entre disparos de campanha** | `CampaignSettings` | ✅ | quase não — 2 campanhas no total | **CONFIGURAR** | No destino o canal respeita o limite, e ainda existe `trigger_only_during_business_hours`, que a origem **não** tem |

### 2.7 O que muda o que o atendente enxerga (não é relógio, mas entra no catálogo)

| automação | onde mora hoje | Ragnabot tem? | usada hoje? | veredito | por quê |
|---|---|---|---|---|---|
| **Modo do histórico visível ao atendente** | `historyMessages` | ❌ | ✅ `queue` na empresa 1, `complete` no global `[medido 28/08]` | **DESCARTAR** | No Chatwoot o histórico do contato é sempre completo dentro da conta. Recortar por fila seria construir uma restrição que o produto não tem — e que o operador raramente quer |
| **Modo do ticket** (`ticketModeContact`) | Configurações → Atendimento | ❌ | ✅ `connection` no global `[medido 28/08]` | **MEDIR ANTES** | Semântica **não lida** (textos cifrados). Não construir sobre rótulo traduzido |
| **Mostrar atendimentos encerrados na lista** | `showClosedTickets` | ✅ | ✅ `true` em 5 das 10 empresas `[medido 28/08]` | **CONFIGURAR** | Filtro/segmento salvo, e reutilizável — melhor que um interruptor global |
| **Correção automática de texto por IA** | `autoCorrectEnabled` | ⚠️ | `[não medido]` | **CONFIGURAR** (depois) | No destino é o Captain. `[medido 29/08]` `captain_tasks` ligada, `captain_integration` **desligada**, 0 caixas do Captain |
| **Recusa automática de áudio e de ligação** | `noAudioMessage`, `noCallMessage`, `call` | ❌ | parcial — `call` = `disabled` nas 10 empresas `[medido 28/08]` | **DESCARTAR** (quase todo) | Na API oficial da Meta não há chamada de voz pelo mesmo caminho: some por definição. Só a **recusa de áudio com texto explicativo** faria sentido, e sai de graça como nó `condicao` no fluxo |
| **Proxy por conexão, importação do histórico do aparelho, pareamento por QR** | modal da Conexão | ❌ | QR em uso (as 8 conexões são da biblioteca não oficial) | **DESCARTAR** | Some por definição na API oficial. Registrado só para o catálogo ficar completo |
| **Permissão "quem pode editar resposta rápida"** | `editQuickMessages` por usuário | ⚠️ | `[não medido]` | **CONSTRUIR** (fatia 3) | `[medido 29/08]` `custom_roles` devolveu **`false`** — só existem `administrator` e `agent`. Vira permissão do nosso papel |

---

## 3. O QUE GANHAMOS DE GRAÇA — e a origem não tem

Vale registrar, porque migração é troca, não só perda. Tudo `[medido 29/08]`, tudo hoje **em zero**:

| ganho | estado hoje | o que destrava |
|---|---|---|
| Limite de conversas simultâneas por agente | `auto_assignment_config = {}` | Impede o agente com 40 conversas abertas e o colega com 2 |
| Distribuição sequencial ou equilibrada, com prioridade por mais antigo ou por quem espera há mais tempo | **0** políticas cadastradas | É a fila justa que a origem nunca teve (`selectedfila` = `{}` nas 9 conexões) |
| Redistribuição periódica a cada 30 minutos | ligada por bandeira, sem política | Conversa esquecida volta a circular |
| Estado **"Adiado"** (`snoozed`), além dos três da origem | disponível | "Volte a me mostrar isto às 14h" — a origem não tem |
| Campanha só em horário comercial | disponível | A origem só tem intervalo entre disparos |
| Segmentos de filtro salvos e reutilizáveis | 0 | Substitui vários interruptores globais da origem |
| Canal WhatsApp pela **API oficial da Meta** | `Channel::Whatsapp` com provedores `default` e `whatsapp_cloud`; **0 caixas de WhatsApp criadas** | É o canal que o dono mandou adotar. Ver §8.2 |

---

## 4. MODELO DE DADOS — o que precisa ser construído

**Prefixo `RagnabotAtend`.** Conferido antes de escrever: `grep -c RagnabotAtend prisma/schema.prisma`
devolve **0** — o prefixo está livre e nada colide com os modelos já existentes
(`RagnabotTenant`, `RagnabotInbox`, `RagnabotProtocolo`, `RagnabotAuditoria`, `RagnabotFluxo*`,
`RagnabotPlano`/`Assinatura`/`Pagamento`, `RagnabotOrigemAutorizada`, `RagnabotContatoRecusado`).

Três regras herdadas do schema já em produção, e mantidas aqui pelos mesmos motivos:

1. **Nenhum modelo existente é alterado.** Por isso não há um único `@relation` daqui para
   `RagnabotTenant` — um `@relation` exigiria acrescentar o campo inverso **dentro** dele, que é a
   alteração proibida. O vínculo com a empresa é chave lógica (`tenantId`), no mesmo estilo já
   usado pelos modelos do motor de fluxo.
2. **Chave única nunca é um par com coluna anulável.** Dois NULOS não são iguais no Postgres, e um
   único campo nulo transforma o índice único em carimbo decorativo. Onde precisamos de unicidade
   sobre algo opcional, materializamos uma **chave calculada NOT NULL** — o mesmo remédio de
   `RagnabotFluxoEntrada.chave`.
3. **Toda consulta filtra pela empresa do usuário logado, nunca por parâmetro da tela.** Foi assim
   que o sistema antigo vazou, e há teste provando que a empresa A não alcança a B.

### 4.1 `RagnabotAtendPolitica` — a aba de automações que a conexão não tem

`[medido 29/08]` As abas que uma caixa de entrada oferece hoje são: Ajustes, Colaboradores,
Horário comercial, CSAT, Configuração, Configuração do bot e Saúde da conta. **Não existe aba de
automações.** Nada do que o dono pediu cabe em nenhuma delas. Esta tabela é essa aba.

```prisma
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AUTOMAÇÕES DO ATENDIMENTO — a "aba de automação da conexão" que o Chatwoot 4.17.1 não tem.
//
// POR QUE UMA TABELA NOSSA, E NÃO CAMPOS NA CAIXA DE ENTRADA DA PLATAFORMA:
//   (a) o que o dono pediu não existe lá em campo nenhum (relógio de inatividade com escolha de
//       lado, intervalo de almoço, fluxo do primeiro contato);
//   (b) escrever direto nas tabelas da plataforma nos amarraria a uma base cuja procedência ainda
//       não confirmamos (§8.3) — no próximo upgrade, some;
//   (c) o escopo por SETOR não existe lá, e quatro empresas da origem usam expediente por setor.
//
// TRÊS NÍVEIS DE ESCOPO, com herança do mais geral para o mais específico:
//   empresa  →  caixa de entrada  →  time (setor)
// O valor efetivo é o do nível mais específico que TIVER o campo preenchido. É por isso que quase
// todo campo aqui é ANULÁVEL: nulo significa "herda", não "desligado". Um booleano não-anulável
// aqui obrigaria cada setor a repetir a configuração inteira da empresa — que é exatamente a
// dispersão em quatro lugares que fez o operador da origem não achar a chave certa.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
model RagnabotAtendPolitica {
  id       String @id @default(uuid())
  tenantId String // → RagnabotTenant.id (chave lógica; ver regra 1 acima)

  cwAccountId Int
  escopo      String // empresa | caixa | time
  cwInboxId   Int? // preenchido só quando escopo='caixa'
  cwTeamId    Int? // preenchido só quando escopo='time'

  // Chave calculada NOT NULL: "empresa" | "caixa:42" | "time:7". Sem ela, duas políticas de
  // empresa (ambas com cwInboxId e cwTeamId nulos) escapariam do índice único, porque no Postgres
  // NULO não é igual a NULO — e a empresa acordaria com duas configurações contraditórias sem
  // ninguém ter feito nada errado.
  escopoChave String

  ativa Boolean @default(true)

  // ── FUSO ────────────────────────────────────────────────────────────────────────────────────
  // Explícito e com padrão brasileiro DE PROPÓSITO. Medido em 29/08: a caixa 1 do Ragnabot está em
  // UTC. Herdar o fuso da plataforma erraria todo expediente em 3 horas, e o erro apareceria como
  // "o robô respondeu fora de hora", que ninguém liga ao fuso.
  fuso String @default("America/Fortaleza")

  // ── RELÓGIO DE INATIVIDADE (pedido nº 1 e nº 2 do dono) ─────────────────────────────────────
  inatividadeAtiva   Boolean @default(false)
  inatividadeMinutos Int? // silêncio tolerado antes de agir

  // ⭐ A ESCOLHA QUE O DONO CITOU NOMINALMENTE: de quem é o silêncio que conta.
  //   'contato'   → o CLIENTE sumiu (usa conversations.waiting_since = nulo, isto é, o contato já
  //                 foi respondido e parou de falar)
  //   'atendente' → o ATENDENTE sumiu (waiting_since preenchido: o cliente está esperando)
  //   'qualquer'  → ninguém falou, de lado nenhum (usa last_activity_at)
  // O Chatwoot só sabe fazer 'qualquer', e nem isso de forma configurável — o auto_resolve_after
  // dele é da conta inteira e só resolve. Esta coluna é a funcionalidade.
  inatividadeConta String? // contato | atendente | qualquer

  inatividadeAcao        String? // devolver_fila | transferir_time | resolver | notificar
  inatividadeTimeDestino Int? // usado quando a ação é transferir_time
  inatividadeMensagem    String? // texto enviado ao cliente ao agir (vazio = age em silêncio)

  // Aviso ANTES de agir ("ainda está aí?"). Sem isso, devolver para a fila é uma surpresa para o
  // cliente que só demorou a digitar.
  inatividadeAvisoMinutos  Int?
  inatividadeAvisoMensagem String?

  // ⚠️ ARMADILHA QUE ESTE CAMPO EVITA: se o relógio correr de madrugada, TODA conversa da noite
  // amanhece devolvida para a fila às 3h — e o cliente recebe "ainda está aí?" às 3h. Falso por
  // padrão significa: o relógio congela fora do expediente e volta a contar na abertura.
  inatividadeContaForaExpediente Boolean @default(false)

  // ── TRANSBORDO POR TEMPO EM FILA ────────────────────────────────────────────────────────────
  // "Ninguém assumiu em X minutos → passa para outro setor." É o timeToTransfer da origem.
  transbordoAtivo    Boolean @default(false)
  transbordoMinutos  Int?
  transbordoTimeId   Int?
  transbordoMensagem String?

  // ── FLUXO (pedido nº 4 do dono) ─────────────────────────────────────────────────────────────
  // Ponteiros para RagnabotFluxo.id — chave lógica, mesma regra 1.
  fluxoPrimeiroContatoId String? // o fluxo do primeiro "oi"
  fluxoPadraoId          String? // retomada, ou quando não é primeiro contato
  fluxoForaExpedienteId  String? // fluxo próprio de fora de hora (nulo = só a mensagem)

  // Quanto silêncio faz o próximo "oi" contar como PRIMEIRO contato de novo. Sem este número a
  // pergunta "é primeiro contato?" não tem resposta objetiva, e cada trecho de código inventaria a
  // sua — que é como nascem dois comportamentos para a mesma conversa.
  reiniciaFluxoAposHoras Int @default(24)

  // ── MENSAGENS ───────────────────────────────────────────────────────────────────────────────
  // Anuláveis porque nulo = herda do escopo mais geral (ver nota de escopo acima).
  msgSaudacao             String?
  msgForaExpediente       String?
  msgIntervalo            String? // texto próprio do almoço — dizer "estamos fechados" às 12h é mentira
  msgFeriado              String?
  msgTransferenciaTime    String? // ao mudar de SETOR
  msgTransferenciaAgente  String? // ao mudar de ATENDENTE
  msgAtendenteIndisponivel String? // ninguém em turno na fila de destino
  msgDespedidaEspera      String? // para quem entrou na fila e desistiu (sendFarewellWaitingTicket)

  // Depois de avisar que está fora de hora: encerra a conversa ou deixa aberta esperando amanhã?
  encerrarAposForaExpediente Boolean @default(false)

  // ── PAUSA DE EMERGÊNCIA ─────────────────────────────────────────────────────────────────────
  // O pauseAttendance da origem, com o que falta lá: prazo e motivo. Pausa sem hora de volta é
  // pausa que alguém esquece ligada — e ninguém descobre até o cliente reclamar.
  distribuicaoPausada  Boolean   @default(false)
  pausadaAte           DateTime?
  pausadaMotivo        String?
  pausadaPorUserId     String?

  // ── AUDITORIA E CONCORRÊNCIA ────────────────────────────────────────────────────────────────
  // `rev` é concorrência otimista, igual ao rascunho de fluxo: dois administradores na mesma tela
  // é evento real, não hipótese. Divergência devolve 409 em vez de sobrescrever o colega em
  // silêncio. O antes/depois da mudança vai para RagnabotAuditoria (§4.7), não para cá.
  rev                 Int      @default(0)
  criadoPorUserId     String?
  atualizadoPorUserId String?
  criadoEm            DateTime @default(now())
  atualizadoEm        DateTime @updatedAt

  @@unique([tenantId, escopoChave])
  @@index([tenantId, ativa])
  @@index([cwAccountId, cwInboxId])
}
```

### 4.2 `RagnabotAtendExpediente` — uma linha por JANELA, e é isso que torna o intervalo possível

```prisma
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EXPEDIENTE — a correção direta do defeito medido no destino.
//
// O Chatwoot guarda UMA linha por dia da semana, com um único par abre/fecha
// (day_of_week, open_hour, open_minutes, close_hour, close_minutes), e o modelo valida que o
// fechamento não pode vir antes da abertura. Medido em 29/08: a caixa 1 tem exatamente 7 linhas,
// uma por dia. Representar 08–12 e 13–18 é IMPOSSÍVEL naquele formato — e é por isso que o
// intervalo de almoço que o dono pediu não é ajuste, é modelo novo.
//
// Aqui a linha é a JANELA, não o dia. Segunda-feira com almoço são duas linhas. Plantão que vira a
// madrugada são duas linhas. Sábado só de manhã é uma linha. O dia deixa de ser um limite.
//
// MINUTOS DESDE A MEIA-NOITE, e não hora+minuto em colunas separadas: comparar dois campos é
// exatamente o que empurrou o modelo do Chatwoot para a validação que proibiu a segunda janela.
// Um inteiro entre 0 e 1440 ordena, soma e compara sem caso especial.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
model RagnabotAtendExpediente {
  id         String @id @default(uuid())
  tenantId   String
  politicaId String // → RagnabotAtendPolitica.id

  diaSemana Int // 0 = domingo … 6 = sábado
  abreMin   Int // minutos desde 00:00 — 480 = 08:00
  fechaMin  Int // 720 = 12:00. Se fechaMin <= abreMin, a janela cruza a meia-noite (plantão)
  rotulo    String? // "manhã", "tarde", "plantão" — aparece na tela e no relatório
  ativo     Boolean @default(true)

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  @@index([politicaId, diaSemana, abreMin])
  @@index([tenantId])
}
```

### 4.3 `RagnabotAtendExcecaoData` — feriado e data especial

```prisma
// Feriado NÃO EXISTE em nenhum dos dois lados: medido em 29/08, a palavra "holiday" não aparece
// nos modelos, serviços nem no pacote enterprise do Chatwoot 4.17.1; e na origem o único lugar era
// o módulo Agenda, que tem ZERO registros em 14 meses. É requisito novo — mas de carona na mesma
// estrutura do expediente, e "atender no Natal por engano" é erro que o cliente enxerga.
model RagnabotAtendExcecaoData {
  id         String @id @default(uuid())
  tenantId   String
  politicaId String

  // Chave calculada NOT NULL, mesma razão de escopoChave (§4.1): feriado recorrente não tem ano, e
  // um `ano Int?` nulo escaparia do índice único, deixando cadastrar o mesmo Natal dez vezes.
  //   data fixa:    "2026-12-25"
  //   recorrente:   "*-12-25"
  chaveData String

  tipo     String // fechado | janela_especial
  abreMin  Int? // preenchidos só quando tipo='janela_especial' (ex.: véspera, meio expediente)
  fechaMin Int?

  rotulo    String // "Natal", "Ponto facultativo"
  mensagem  String? // texto próprio do dia; nulo = usa msgForaExpediente da política

  criadoEm DateTime @default(now())

  @@unique([politicaId, chaveData])
  @@index([tenantId])
}
```

### 4.4 `RagnabotAtendTurno` — expediente por atendente

```prisma
// O startWork/endWork da origem. Medido em 29/08: no Chatwoot NÃO existe turno por agente — só o
// status que a própria pessoa marca (online/ausente/ocupado), e o distribuidor do núcleo devolve
// TODOS os membros da caixa sem filtrar presença.
//
// ⚠️ CONSTRUIR SÓ DEPOIS DE MEDIR (§6, fatia 3). Se os 77 usuários da origem estiverem todos com
// 00:00–00:00, o requisito nunca foi usado e esta tabela nasce morta — que é precisamente o erro
// que este documento existe para evitar. A consulta que decide está no §8.1.
model RagnabotAtendTurno {
  id       String @id @default(uuid())
  tenantId String
  cwUserId Int // agente na plataforma

  diaSemana Int
  abreMin   Int
  fechaMin  Int
  ativo     Boolean @default(true)

  criadoEm DateTime @default(now())

  @@index([tenantId, cwUserId, diaSemana])
}
```

### 4.5 `RagnabotAtendRelogio` — o estado vivo, e a razão de ele existir

```prisma
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O RELÓGIO POR CONVERSA. Fonte da verdade do prazo.
//
// POR QUE UMA TABELA, e não só um trabalho agendado na fila: trabalho agendado que reinicia, é
// ceifado, ou é migrado de fila, some — e o que some aqui é uma conversa parada que ninguém vai
// devolver para a fila. É a mesma lição já registrada na casa em
// `noc-monitor-restart-safe-recovery.md`: monitor resolve reconciliando com o BANCO, nunca só por
// evento. A fila (RagnabotFluxoFila, tipo 'atend_relogio') é o DESPERTADOR; a verdade é esta linha.
//
// `chave` NOT NULL e única mata dois defeitos de uma vez: dois relógios do mesmo tipo na mesma
// conversa (o cliente recebendo "ainda está aí?" duas vezes) e a corrida entre o trabalhador e o
// evento de mensagem nova.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
model RagnabotAtendRelogio {
  id       String @id @default(uuid())
  tenantId String

  cwAccountId      Int
  cwConversationId Int
  politicaId       String

  tipo String // inatividade | aviso | transbordo

  // "conta:conversa:tipo" — materializada, NOT NULL, única.
  chave String @unique

  // Quem falou por último, e quando. É deste par que sai a resposta a "de quem é o silêncio",
  // sem depender de reler o histórico inteiro da conversa a cada tique.
  ultimaAtividadeEm   DateTime
  ultimaAtividadeLado String // contato | atendente | sistema

  venceEm DateTime

  // Congelado, e por quê. Estado congelado SEM motivo declarado é estado que ninguém consegue
  // explicar depois — e a primeira pergunta do dono vai ser "por que essa conversa não voltou".
  pausadoMotivo String? // fora_expediente | intervalo | feriado | silenciado | efeito_pendente

  disparadoEm DateTime?
  resultado   String? // aplicado | descartado_obsoleto | recusado_fora_expediente | erro
  erro        String?

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  // O trabalhador vive deste índice: "o que venceu e ainda não disparou".
  @@index([venceEm, disparadoEm])
  @@index([cwAccountId, cwConversationId])
  @@index([tenantId, tipo])
}
```

### 4.6 `RagnabotAtendTransferencia` — quem passou para quem, e por quê

```prisma
// Medido em 29/08: no Chatwoot a transferência é a troca silenciosa de assignee_id. Gera mensagem
// de atividade e uma notificação interna — que ainda é suprimida quando a conversa está 'pending'.
// Não há motivo, não há nota de passagem, não há aceite, não há aviso ao agente que recebe, e não
// há relatório. Esta tabela é o registro que falta nos DOIS lados.
model RagnabotAtendTransferencia {
  id       String @id @default(uuid())
  tenantId String

  cwAccountId      Int
  cwConversationId Int
  protocolo        String? // número humano, quando a conversa já tem (RagnabotProtocolo)

  deTipo   String // agente | time | bot | ninguem
  deId     Int?
  deNome   String?
  paraTipo String // agente | time
  paraId   Int?
  paraNome String?

  motivo      String? // categoria curta, escolhida numa lista (vira relatório)
  notaInterna String? // o texto livre que o próximo atendente precisa ler

  // De onde partiu. Sem isto, "por que essa conversa mudou de setor às 14h32" só se responde
  // cruzando log de três serviços.
  origem      String // manual | automacao | fluxo | transbordo | inatividade | turno
  atorUserId  String? // nulo = automático

  criadoEm DateTime @default(now())

  @@index([tenantId, criadoEm])
  @@index([cwAccountId, cwConversationId, criadoEm])
  @@index([tenantId, paraTipo, paraId, criadoEm])
}
```

### 4.7 O que NÃO ganha tabela — de propósito

| tentação | decisão | por quê |
|---|---|---|
| Tabela de eventos da automação | **reusar `RagnabotAuditoria`** | Ela já tem `atorTipo='sistema'`, `categoria='atendimento'`, `protocolo`, `antes`/`depois` em Json e índices por empresa e por data. Uma tabela nova seria a mesma coisa com outro nome, e o isolamento por empresa teria de ser provado de novo |
| Tabela de limite por agente | **usar o nativo** | `inboxes.auto_assignment_config['max_assignment_limit']` já existe e já é respeitado pelo distribuidor. Duplicar cria duas verdades |
| Tabela de política de distribuição | **usar o nativo** | `assignment_policies` + `inbox_assignment_policies` já existem, com a bandeira `assignment_v2` ligada. É cadastro |
| Versionamento da política | **`rev` + auditoria** | `RagnabotAuditoria.antes`/`depois` já guarda a mudança. Uma tabela de versões só se justifica quando a versão precisa ser **executada** — que é o caso do fluxo, não o da política |
| Fila própria do relógio | **reusar `RagnabotFluxoFila`** | Ver §5.4 |

---

## 5. COMO CADA AUTOMAÇÃO SE LIGA AO MOTOR DE FLUXO JÁ CONSTRUÍDO

Base: `src/services/ragnabot-fluxo-motor.service.js` e `ragnabot-fluxo-nos.service.js`.

### 5.1 O que o motor já resolve, e não deve ser reescrito

`[medido 29/08, lendo o código]`

- **16 tipos de nó:** `inicio, texto, midia, pergunta, lista, botoes, espera, condicao, http,
  variavel, etiqueta, time, notificar, subfluxo, chamado, encerrar`.
- **O nó `time` é a transferência para setor**, e já carrega o cuidado certo: `politicaEmDuvida:
  'condicional'`, com o comentário no próprio código explicando a armadilha — *"reaplicar 45
  segundos depois rouba a conversa da analista que acabou de assumir"*. E transfere **mesmo com a
  janela de 24 h fechada**, porque adiar a transferência por não poder avisar é o pior dos dois
  mundos.
- **O nó `notificar` já recusa número de telefone cravado no fluxo** e exige destinatário por
  papel, time ou usuário — a correção do defeito D4. É por aqui que sai o aviso ao agente que
  recebe a transferência.
- **Freios contra laço:** `passosPorEvento` (50), `passosTotalMax` (500), `visitasPorNoMax` (10) —
  que é o que torna o `maxUseBotQueues` da origem desnecessário.
- **Fila durável em Postgres**, com posse, ceifador de trabalho preso, retentativa e serialização
  por `chaveParticao = "conta:conversa"`.
- **Caixa de saída em duas fases**, protocolo por conversa, versão imutável do fluxo.

### 5.2 O elo que falta: o resolvedor de entrada

**O buraco medido:** `iniciarOuRecuperarExecucao()` exige `tenantId`, `fluxoId` e `versaoId` — e
`[medido 29/08]` **nenhum código do repositório a chama**. `RagnabotFluxo` já tem
`entrada = 'caixa' | 'subfluxo' | 'palavra_chave'`, `cwInboxId` e `palavrasChave`. Metade do
caminho está no schema; falta quem decide.

**Precedência declarada** — uma só, escrita em um lugar, porque duas decisões sobre a mesma coisa
é como nascem dois comportamentos para a mesma conversa:

```
1. Palavra-chave        → RagnabotFluxo.entrada='palavra_chave' e a mensagem casa
2. Feriado              → RagnabotAtendExcecaoData (tipo='fechado')  → fluxoForaExpedienteId
3. Fora de expediente   → nenhuma janela de RagnabotAtendExpediente aberta agora → idem
4. Intervalo            → dentro do dia, mas fora das janelas → msgIntervalo (e o fluxo de fora
                          de expediente SÓ se o dono quiser; por padrão só a mensagem, porque
                          almoço não é "estamos fechados")
5. Primeiro contato     → política.fluxoPrimeiroContatoId
6. Fluxo padrão         → política.fluxoPadraoId, ou RagnabotFluxo com entrada='caixa' e cwInboxId
7. Nenhum               → a conversa vai direto para a fila humana (nunca fica sem dono)
```

**"Primeiro contato" definido por medição, não por adivinhação:** é primeiro contato quando **não
existe execução anterior** para aquela conversa, **ou** a última terminou há mais de
`reiniciaFluxoAposHoras`. Os dois dados já existem — `RagnabotFluxoExecucao.encerradaEm` e
`origemExecucaoId`. Nada novo precisa ser gravado.

### 5.3 Quem manda no relógio, e quando — a regra que evita duas mensagens

Esta é a regra mais importante da integração, e a mais fácil de errar:

> **Enquanto a execução do fluxo está viva, o prazo é do nó `espera` (segundos). O relógio de
> atendimento (minutos) só arma quando a conversa está com humano.**

Concretamente, o relógio de `RagnabotAtendRelogio` **só nasce** quando a execução está em
`pausado_humano`, ou já terminou com `estado = 'transferido'` (a saída do nó `time`), ou nunca
existiu execução para aquela conversa.

**Por que a regra existe:** sem ela, o cliente que está no meio de um menu recebe, no mesmo minuto,
o "não entendi, escolha uma opção" do fluxo e o "ainda está aí?" do relógio. Dois donos do mesmo
silêncio produzem duas mensagens, e o cliente conclui que o robô está quebrado.

### 5.4 A fila: um tipo novo, nenhuma máquina nova

`RagnabotFluxoFila.tipo` é String livre — os próprios comentários do motor registram que o
conjunto de tipos foi **ampliado de forma declarada** antes (o tipo `continuar`). Acrescentar
`atend_relogio` **não é mudança de schema**, e traz de graça: posse por trabalhador, ceifador de
trabalho preso, retentativa com teto, prioridade e — o que mais importa — **serialização por
`chaveParticao = "conta:conversa"`**.

Essa serialização é o que impede o relógio de mexer na conversa **enquanto o nó do fluxo está no
meio de um passo**. Sem ela, a devolução para a fila poderia acontecer entre a reserva e a
confirmação de um efeito, e a mensagem sairia para uma conversa que já mudou de estado.

**Despertar obsoleto** segue o padrão que já existe: se o cliente respondeu antes do prazo, o
relógio foi reagendado e o trabalho antigo é **descartado** (`resultado =
'descartado_obsoleto'`) — o mesmo raciocínio do `tokenVisita`, cujo comentário no schema já diz
por quê: *"sem isso, resposta e expiração mandam a conversa por dois caminhos ao mesmo tempo — e
ela chega em dois nós diferentes"*.

### 5.5 Expediente como variável, não como nó novo

Nenhum tipo de nó novo. O nó `condicao` já lê variável; o resolvedor injeta no contexto:

| variável | significado |
|---|---|
| `{{expediente.aberto}}` | verdadeiro/falso agora, no fuso da política |
| `{{expediente.motivo}}` | `aberto` \| `fora_hora` \| `intervalo` \| `feriado` |
| `{{expediente.proximaAbertura}}` | data e hora da próxima janela — é o que permite dizer "voltamos às 13h" em vez de "estamos fechados" |
| `{{fila.aguardandoMinutos}}` | espera acumulada, para o fluxo decidir avisar |
| `{{atendentes.disponiveis}}` | quantos em turno na fila de destino — alimenta `msgAtendenteIndisponivel` |

**Por que não um nó "horário":** um nó novo obrigaria todo fluxo existente a ser reeditado para
ganhar a regra, e espalharia a decisão de expediente pelos 35 fluxos — que é a dispersão em quatro
lugares nascendo de novo, com outro nome.

### 5.6 As ações do relógio, e por qual caminho cada uma sai

| ação | caminho | observação |
|---|---|---|
| `devolver_fila` | `pending_conversation` + `remove_assigned_agent` pela API da plataforma | A ação existe nativamente; o gatilho é nosso |
| `transferir_time` | mesma intenção `atribuir` do nó `time` | Reusa o cuidado já escrito, inclusive a política em dúvida |
| `resolver` | `auto_resolve_after` nativo **ou** ação `resolve_conversation` | Preferir o nativo quando o escopo for a conta inteira |
| `notificar` | nó `notificar` do motor, destinatário por **papel** | Nunca número cravado — a validação já recusa |
| mensagem ao cliente | porta canal do motor, com respeito à janela de 24 h | Fora da janela, a ação de estado acontece e a mensagem não; o motivo fica na nota interna |

---

## 6. ORDEM DE CONSTRUÇÃO — por valor sobre custo

### Fatia 0 — hoje, sem código

| passo | quem faz | efeito |
|---|---|---|
| **Criar os Times (setores) e pôr agentes neles** | dono, ou eu com autorização | **Destrava a transferência por setor na hora** (§1.2) |
| Corrigir o fuso da caixa de UTC para `America/Fortaleza` | idem | Sem isso todo horário nasce 3 h errado |
| Criar uma caixa de entrada de **WhatsApp** (`whatsapp_cloud`) | idem | `[medido 29/08]` hoje há **uma** caixa e ela é do widget do site. Sem uma caixa de WhatsApp, nada do que é "por conexão" pode ser exercitado de verdade |

### Fatia 1 — o que o dono citou nominalmente

| # | entrega | depende de |
|---|---|---|
| 1.1 | `RagnabotAtendPolitica` + `RagnabotAtendExpediente` + a tela **"Automações"** na conexão | — |
| 1.2 | **Relógio de inatividade** com a escolha `contato` / `atendente` / `qualquer`, ação `devolver_fila`, aviso prévio e congelamento fora do expediente | 1.1 |
| 1.3 | **Resolvedor de entrada**: fluxo do primeiro "oi", fluxo padrão, precedência do §5.2 — e com ele o motor de fluxo finalmente recebe o chamador que lhe falta | 1.1 |
| 1.4 | **Fora de expediente + intervalo + feriado**: mensagens próprias e o "encerra ou deixa aberta" | 1.1 |

> A fatia 1 é indivisível na prática: 1.2 e 1.4 dividem a mesma tabela e o mesmo trabalhador, e 1.3
> é o que faz o motor já pronto começar a valer. Entregar só o relógio, sem o expediente, produz o
> "ainda está aí?" às 3 h da manhã descrito no §4.1.

### Fatia 2 — completa a transferência e o transbordo

| # | entrega |
|---|---|
| 2.1 | `RagnabotAtendTransferencia`: motivo, nota de passagem, aviso ao agente que recebe (pelo nó `notificar`) e relatório de "quem passou para quem" |
| 2.2 | Rótulo **"Transferir"** na interface em português — hoje a palavra não existe (§1.1c) |
| 2.3 | **Transbordo por tempo em fila** (`transbordoAtivo`) — o `timeToTransfer` da origem, agora com gatilho de tempo de verdade |
| 2.4 | **Correção de escopo** no caminho manual de atribuição, com teste provando que a empresa A não alcança a B (§1.3) |
| 2.5 | Mensagem de **atendente indisponível** e **despedida de quem desistiu na fila** |
| 2.6 | **Pausa de emergência** da distribuição, com prazo e motivo |

### Fatia 3 — só depois de medir

| # | entrega | o que medir antes |
|---|---|---|
| 3.1 | `RagnabotAtendTurno` (expediente por atendente) | A distribuição de `startWork`/`endWork` nos 77 usuários da origem. Todos em 00:00–00:00 = nunca foi usado |
| 3.2 | Tabulação obrigatória no encerramento | Já se sabe que **nunca foi validada com gente**: 502 encerramentos, 100% automáticos. Construir simples, ligar em UMA operação, medir adoção |
| 3.3 | Central de notificações operacionais por WhatsApp (N pendentes, espera > X) | Se a bandeira `sla` pode ser ligada nesta edição, ou se é recurso pago |
| 3.4 | Carteira de clientes (dono fixo por contato) | `walletAssignmentMode` na origem |
| 3.5 | Modo de teste do fluxo com número de teste | — |

### Fatia 4 — configuração e manual, sem código

Ligar e documentar o que já existe e está em zero: política de distribuição, limite por agente,
CSAT, saudação, encerramento automático, etiquetas automáticas por regra, respostas prontas,
segmentos salvos. **`[medido 29/08]` tudo isto está em zero hoje** — e uma boa parte da queixa do
dono é ambiente vazio, não produto faltando.

---

## 7. OS DESCARTES, e a razão de cada um

Reconstruir fachada é o erro caro deste projeto. Descartado, com o motivo:

| descartado | motivo |
|---|---|
| Ordem do setor na fila do bot | **Nulo nas 52 filas.** Existe há 14 meses e ninguém preencheu |
| Exigir escolha de setor ao aceitar | `disabled` nas 10 empresas |
| Controle de tickets em lote com horário de pico | Tabelas **vazias** |
| Automação de agendamento | Tabela **vazia** |
| Mapeamento tag ↔ etiqueta nativa do WhatsApp | Só existe no canal não oficial. Some por definição |
| Recusa de ligação, proxy por conexão, importação do histórico do aparelho, pareamento por QR | Idem — dependem da biblioteca não oficial |
| Menção `@` em grupo | Grupo de WhatsApp não existe na API oficial |
| ChatGPT / Typebot / n8n / Dialogflow por conexão e por setor | **Zero** conexões ligadas; tabela `Prompts` vazia. Superfície enorme, uso nenhum |
| Limite de reenvio do chatbot (`maxUseBotQueues`) | Neutralizado na prática (9999), e o motor já tem freios melhores |
| Horário próprio do fluxo | Quarto lugar para a mesma regra, e desligado onde foi medido |
| Modo do histórico por fila | O produto não recorta histórico por fila, e o operador raramente quer |
| Saudação quando a empresa tem um único setor | Regra de canto de um menu obrigatório que não teremos |
| Avisar posição na fila | Custa fila ao vivo por setor; valor de percepção, não de operação. Volta se o dono pedir |
| Transferir para **outra conexão** | Quebra a janela de 24 h e o histórico de consentimento (já era o veredito do documento 19) |

---

## 8. PONTOS CEGOS QUE CONTINUAM

### 8.1 — ⭐ RESOLVIDO em 29/08 (tarde): o levantamento saiu pela API do app, não pela VM

**O ponto cego abaixo deixou de valer.** As sete consultas que dependiam do guest agent foram
respondidas por outro caminho: o **app respondeu na porta da frente** (`chatbk001.ragnatela.com.br`,
login de admin fornecido pelo dono), e a leitura da API é mais fiel à *funcionalidade* do que ler o
banco por dentro. O resultado completo — automações por conexão, `inatividadeLastMessageType`
(a resposta "atendente ou contato"), turnos dos atendentes (turno **É** usado), o menu Ajustes e os
recursos do plano (canais Facebook/Instagram já pagos) — está no **doc 31**. O guest agent **não
precisou** ser religado. O texto original abaixo fica como registro histórico.

---

### 8.1 (histórico) A VM 10016 continua ilegível `[medido 29/08 de manhã]`

`qm guest cmd 10016 ping` devolveu **"QEMU guest agent is not running"** nesta sessão, confirmando
o bloqueio que a investigação de 28/08 já havia encontrado em sete tentativas. A VM está **rodando**
— foi o serviço **dentro** do convidado que caiu, não a máquina. Os levantamentos 18 e 25 foram
feitos por esse mesmo caminho na manhã de 28/08, logo o agente caiu depois.

Não há caminho alternativo: do hipervisor, o ICMP responde, mas as portas TCP 22, 3333, 8080 e 5432
estão fechadas; o PostgreSQL da VM escuta só em `127.0.0.1`.

> **Recomendação ao dono:** religar o `qemu-guest-agent` **pelo console**. Ele não pode ser
> reiniciado pelo próprio agente, que está morto. **Não tentei recuperar:** é escrita em produção
> com dez empresas, e está fora do meu mandato.
>
> **Efeito colateral a conferir:** o painel `/painel-noc` do chat001 lê pelo mesmo caminho, então
> provavelmente está cego também. Não confirmei — não tenho permissão de leitura no pm2 do root.

**As sete consultas que fecham o levantamento numa rodada, assim que o caminho voltar** (todas
`SELECT`, credenciais lidas dentro da VM):

1. `SELECT ordinal_position, column_name, data_type, column_default FROM information_schema.columns WHERE table_name='Whatsapps' ORDER BY 1;` — **as 92 colunas com o PADRÃO**. Nenhum documento da casa jamais enumerou mais que ~10 delas, e é aqui que mora a resposta sobre "atendente ou contato" na origem.
2. O mesmo para `Queues`, `Companies`, `Users`, `Flows`, `Settings`.
3. Todas as colunas de automação das 8 conexões, não só as ~8 já conhecidas.
4. `SELECT key, "companyId", value FROM "Settings" ORDER BY key, "companyId";` — as 288 linhas / 94 chaves inteiras (hoje só ~15 chaves têm valor medido).
5. `SELECT jsonb_pretty(schedules) FROM "Queues" LIMIT 3;` e o mesmo em `Companies` — **responde se a estrutura da origem aceita mais de uma janela por dia**, isto é, se o intervalo é paridade ou requisito novo.
6. `SELECT "startWork","endWork",count(*) FROM "Users" GROUP BY 1,2 ORDER BY 3 DESC;` — decide a fatia 3.1.
7. `SELECT id,name,keywords,schedule,"offHoursMessage","closeAfterOffHoursMessage","isTestMode" FROM "Flows";` — **nos 35 fluxos**, não só no ABERTURA DE CHAMADO.

### 8.2 O ambiente do Ragnabot está vazio, e isso limita o que foi exercitado

`[medido 29/08]` Conta 1, **uma** caixa de entrada e ela é do **widget do site** — **nenhuma caixa
de WhatsApp existe**. Logo, nada do que é "por caixa" (expediente, saudação, encerramento
automático, CSAT, atribuição automática) foi exercitado com WhatsApp de verdade. Contadores: **0**
times, **0** regras de automação, **0** macros, **0** etiquetas, **0** agent bots, **0** políticas
de atribuição, **0** campanhas; `working_hours` com 7 linhas, mas desligado e em UTC.

`Channel::Whatsapp` existe e aceita os provedores `default` e `whatsapp_cloud` — o canal oficial da
Meta está disponível, e **não** é gated por bandeira de recurso (não existe
`feature_channel_whatsapp?` neste build). Falta criar a caixa.

### 8.3 A procedência da imagem continua não confirmada

`config/app.yml` diz **4.17.1** `[medido 29/08]`, mas há código que não bate com o 4.x conhecido:
`AutomationRule.execution_delay` com `EXECUTION_DELAY_RANGE = 10..43200`, o modelo
`AutomationRulePendingExecution`, `AssignmentPolicy`/`assignment_v2`. **Não há `.git` no contêiner**
para confirmar a origem.

> **Isto importa antes de qualquer remendo nosso na base dela.** É a principal razão pela qual o
> §4 põe as automações em **tabelas nossas**, e não em colunas da plataforma: patch sobre base de
> procedência desconhecida quebra no próximo upgrade, em silêncio.

### 8.4 Não abri a tela num navegador

Todo o veredito sobre "o controle aparece ou não" vem de ler o Vue e medir os dados. A hipótese que
sobra de pé para o caso do dono é o acordeão **"Ações da conversa"**, arrastável e com abertura
gravada **por usuário** (`is_conv_actions_open`): se ele o fechou, não vê o campo. Isso só se mata
entrando no painel com a conta dele. **Também não conferi o idioma selecionado** — se estiver em
inglês, os rótulos são "Assigned Agent"/"Assigned Team", o que afasta ainda mais da palavra
"Transferir".

### 8.5 Buracos menores, declarados

- **A semântica das chaves da origem nunca foi lida** — o backend do fornecedor tem os textos
  **cifrados**, não só ofuscados. O que `tempofila`, `moveQueue`, `pauseAttendance` e
  `ticketModeContact` fazem é **inferido do rótulo traduzido da tela**. Vale também para a unidade
  de `timeToTransfer` e do `responseTimeout` da lista interativa.
- **Divergência de contagem, registrada de propósito:** o levantamento de 19/08 mediu **9** linhas
  em `Whatsapps`; o de 28/08 mediu **8** conexões. Uma foi apagada no intervalo. Os valores citados
  de `selectedfila` e `sendIdQueue` vêm da leitura de 19/08 e podem já não valer.
- **Só um dos 35 fluxos foi aberto.** Toda afirmação sobre `keywords`, `schedule` e
  `offHoursMessage` de fluxo vale apenas para o ABERTURA DE CHAMADO — pode haver regra de horário
  escondida nos outros 34, e a migração precisa varrer todos.
- **Não confirmei se `set_conversation_activity` roda também para nota privada.** Se rodar, uma
  nota interna do atendente adia o encerramento automático sem que o cliente tenha visto nada.
  **Medir antes de ligar o `auto_resolve_after`** — e a mesma dúvida vale para o nosso relógio, que
  deve contar **mensagem pública**, nunca nota.
- **Não testei o Agent Bot ponta a ponta** (webhook saindo, resposta entrando); descrevi o desenho
  pelo código.
- **`captain_tasks` está ligada e `captain_integration` desligada** `[medido 29/08]`. Não sei
  explicar a diferença e não vou inventar.
- **Achado incidental, fora do escopo:** durante as medições, o pod `ragnabot-web` registrou por
  duas vezes `Failed to configure AI Agents SDK: connection to server at "10.104.79.194", port 5432
  failed: server closed the connection unexpectedly`. Não investiguei — não era a tarefa —, mas
  fica registrado.

---

## 9. Resumo em uma página

- **A transferência para agente funciona.** A transferência para setor não funciona porque a conta
  tem **zero Times** — é cadastro, não engenharia. E a palavra "Transferir" não existe na tela em
  português.
- **O relógio de inatividade não existe** no destino, em nenhuma forma configurável. A ação existe
  (`pending_conversation`), o campo que separa os dois silêncios existe (`waiting_since`) — falta o
  **gatilho de tempo**, e é o item nº 1 a construir.
- **O intervalo de almoço é impossível hoje**: o expediente do destino guarda uma janela por dia.
  A correção é modelar a **janela**, não o dia.
- **O fluxo do primeiro "oi" tem motor e não tem amarração**: `iniciarOuRecuperarExecucao()` não é
  chamada por ninguém. O resolvedor de entrada é o elo que falta, e é barato.
- **Metade da queixa é ambiente vazio**, não produto faltando: 0 times, 0 automações, 0 etiquetas,
  0 políticas, expediente desligado e em UTC, e nenhuma caixa de WhatsApp criada.
- **Nada foi escrito em produção** nesta tarefa. Tudo o que está aqui é leitura, e cada afirmação
  carrega a data em que foi medida.
