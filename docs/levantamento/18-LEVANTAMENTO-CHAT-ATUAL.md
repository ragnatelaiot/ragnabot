# 🔎 18 — LEVANTAMENTO DO SISTEMA DE ATENDIMENTO EM PRODUÇÃO (VM 10016)
### Engenharia reversa funcional, somente leitura — insumo para decidir o que vai ao Ragnabot

> **Data da medição:** 28/08/2026, entre 07h18 e 09h10 (UTC−3).
> **Alvo:** VM **10016 — RGTSRVCHAT001**, hipervisor RGTSRVHST001.
> **Método:** leitura de arquivos e consultas `SELECT` via `qm guest exec`. **Nenhuma escrita**,
> nenhum reinício, nenhuma alteração de banco. O sistema ficou atendendo o tempo todo.
> **Companheiro deste documento:** `19-COMPARATIVO-E-BACKLOG-RAGNABOT.md` (a decisão função a função).

---

## 0. Sumário executivo — o que a medição mostrou

| pergunta | resposta medida |
|---|---|
| Que produto é? | Fork comercial de Whaticket, marca **ConnectAi / DevConnectAi**, `versionSystem` **8.1.1**, **ofuscado** (código do fornecedor, com `LICENSE_KEY` e um processo "porteiro" que fala com a nuvem dele) |
| Quantas telas tem? | **61 itens de menu** — 7 soltos e 54 em **9 grupos** — servindo mais de **80 rotas** de front-end (há telas com rota e sem item de menu, §4.32) |
| Quantas tabelas tem o banco? | **189** tabelas no schema `public` |
| Quantas guardam algum dado? | **48**. **141 estão completamente vazias** — ou seja, **74,6% do produto nunca foi usado** |
| Está vivo? | Sim: **23.482 mensagens em agosto/2026**, média de **~24 mil/mês** nos últimos 7 meses |
| Quantos clientes? | **10 empresas** (tenants) ativas, **77 usuários**, **8 conexões** de WhatsApp |
| O WhatsApp é oficial? | **Não.** As 8 conexões são `channel = whatsmeow` — biblioteca não oficial, num binário fechado do fornecedor (`connectzap-x86_64`, porta 3000) |
| Qual é o coração do produto, na prática? | **Caixa de atendimento + Setores + Tags + Fluxo de conversa (chatbot visual)**. O resto é acessório ou morto |

**A conclusão que governa o comparativo:** este sistema tem uma superfície enorme e um uso
pequeno e muito bem definido. A tentação de "levar tudo" é o erro caro. O que sustenta a operação
real cabe em pouco mais de uma dúzia de funções — e várias delas o Chatwoot já entrega.

---

## 1. Como o levantamento foi feito (para poder ser refeito)

1. **Acesso:** `execPooled` do NOC até o hipervisor RGTSRVHST001, e de lá
   `qm guest exec 10016 -- /bin/bash -c "<script em base64>"`. Nenhum arquivo foi escrito na VM.
2. **Banco:** as credenciais foram lidas **dentro da VM** (`. backend/.env`) e usadas ali mesmo pelo
   `psql`. **Nenhuma credencial saiu da máquina** nem foi gravada em lugar nenhum.
3. **Contagem exata:** `query_to_xml` sobre `pg_class` para rodar `COUNT(*)` real em todas as
   tabelas de uma vez — estimativa (`reltuples`) não serve, porque a base nunca passou por
   `ANALYZE` e devolvia `-1` para quase tudo.
4. **Front-end:** o pacote JavaScript é **ofuscado** (`javascript-obfuscator`, com arranjo de
   textos rotacionado). Foi escrito um decodificador próprio que:
   - extrai o arranjo de textos e o deslocamento do acessador;
   - descobre a **rotação** por ancoragem (`0x7d1 = "Atendimentos"`) ou, quando não há âncora, por
     pontuação de frequência de identificadores comuns;
   - substitui cada chamada `f(0xNNN)` pelo texto correspondente.
   Com isso saíram **6.643 chaves de tradução pt-BR** e o **modelo de navegação completo**.
   ⚠️ Nada do código do fornecedor foi copiado — o decodificador é nosso e só serviu para **ler**.

> **O que não foi possível determinar:** o backend Node também está ofuscado com textos
> **cifrados** (não só rotacionados), então as rotas do servidor **não** foram lidas literalmente.
> A superfície de API foi inferida pelos **107 arquivos de rota** (nomes preservados), pelos
> **171 modelos Sequelize** e pelas chamadas que o front-end faz. Onde havia dúvida, está escrito.

---

## 2. O sistema por fora

### 2.1 Identidade e versão
| item | valor medido |
|---|---|
| Marca no pacote | `nomeEmpresa: "ConnectAi"`, tela de entrada diz **DevConnectAi** |
| Versão declarada | `versionSystem: 8.1.1` |
| Caminho | `/home/deployautomatizaai/whaticket/` (`backend/automatizaai`, `frontend/automatizaai`) |
| Front-end | React 18 + Material UI 5 + Recharts, empacotado e **ofuscado** (34 MB de JS) |
| Back-end | Node/Express + **Sequelize**, 8 processos em modo `cluster` (pm2), porta **8080** |
| Licenciamento | `.env` traz `LICENSE_KEY`, `GATE_HTTP_ADDR`, `GATE_IPC_SECRET` — há um processo **`devconnectai-gate`** (127.0.0.1:9471) que é o porteiro de licença do fornecedor |

### 2.2 O que roda na máquina (medido em `pm2 list` e `ss -lntp`)
| processo | porta | papel |
|---|---|---|
| `whaticket-backend` × 8 (cluster) | 8080 | API + WebSocket. ~770 MB **cada** |
| `whaticket-frontend` | 3333 | servidor estático do pacote React |
| **`connectzap`** (`connectzap-x86_64`) | 3000 | **o motor de WhatsApp** — binário fechado, biblioteca **whatsmeow** (Go, não oficial) |
| `devconnectai-gate` | 9471 (local) | porteiro de licença / ponte com a nuvem do fornecedor |
| `qr-refresher` | — | renova o QR das sessões |
| PostgreSQL 15.18 | 5432 (local) | banco |
| Redis (Docker) | 6379 (local) | filas e cache |
| **NATS** (Docker) | 4222 (local) | mensageria interna (`NATS_ENABLED` no `.env`) |
| nginx | 80/443 | `chatapi001`, `whaticket-backend`, `whaticket-frontend` |

**Recursos:** 12 vCPU, 15 GB de RAM (7 GB em uso), disco 117 GB com **48 %** ocupados.
**Tempo no ar:** 9 dias e 18 horas na hora da medição.
**API pública do front:** `https://chatbk001.ragnatela.com.br` (definida em `frontend/automatizaai/config.js`).

⚠️ **Dependência de terceiro que importa para a decisão:** o produto não funciona sem o binário
`connectzap` **e** sem o porteiro de licença. Nenhum dos dois é nosso, nenhum dos dois é legível,
e o primeiro é justamente a peça que o dono mandou abandonar (WhatsApp não oficial).

---

## 3. Árvore completa de navegação

Reconstruída do modelo de navegação decodificado (`navModel`), com os identificadores reais, o
destino de cada item e a condição que o torna visível. O menu tem **três leiautes** (trilho
lateral, barra superior e versão compacta), mas **o conteúdo é o mesmo** — na versão compacta os
grupos são refundidos em quatro: *Atendimento*, *Conexões e API*, *Administração* e *Ajuda*.

```
RAIZ (itens soltos, fora de grupo)
├── Atendimentos ................. /tickets            [acesso: tickets]
├── Kanban ....................... /Kanban             [acesso: Kanban · modo "clássico"]
├── Kanban (Pro) ................. /kanban-board       [acesso: Kanban · modo "pro" + licença]
├── Funil de vendas .............. /funil-vendas       [acesso: Kanban + licença de funil]
├── Quadros (tarefas) ............ /quadros            [acesso: TaskBoards + licença]
├── Painel (de atendimento) ...... /AtendimentoPanel   [acesso: AtendimentoPanel]
└── Chat Interno ................. /chats              [contador de não lidas no ícone]

📊 GRUPO "Dashboard"
├── Dashboard .................... /dashboard
├── Relatórios ................... /relatorios
├── Relatório por usuário ........ /relatorio-usuario
├── Relatório de ligações ........ /relatorio-ligacoes     [só perfil admin + licença VoIP]
├── Relatório de tags ............ /relatorio-tags         [licença]
├── Relatório de avaliações ...... /relatorio-avaliacoes   [licença]
├── Relatório sem retorno ........ /relatorio-sem-retorno  [licença]
├── Relatório do funil ........... /relatorio-funil        [licença]
├── Relatório de vendas .......... /relatorio-vendas       [licença]
├── Relatórios Gerados ........... /relatorios-gerados
└── Relatório de fechamentos ..... /relatorio-fechamentos  [licença]

📅 GRUPO "Agenda"  (CRM de compromissos — licença `useAgenda`)
├── Calendário ................... /agenda/calendar
├── Compromissos ................. /agenda/appointments
├── Profissionais ................ /agenda/professionals
├── Serviços ..................... /agenda/services
├── Feriados ..................... /agenda/holidays
├── Formulários .................. /agenda/forms
├── Regras ....................... /agenda/rules
├── Notificações ................. /agenda/notifications
├── Pagamentos Asaas ............. /agenda/asaas
└── Relatórios ................... /agenda/reports

🗂️ GRUPO "Gestão"
├── StudioSign (assinatura) ...... /esign-documents   [licença `useAssinaturaEletronica`]
├── Contatos ..................... /contacts
├── Tags ......................... /tags
├── Carteira De Clientes ......... /wallets
├── Respostas Rápidas ............ /quick-messages
├── Tarefas (lista) .............. /todolist
├── Agendamentos ................. /schedules         [licença `useSchedules`]
└── Avaliação .................... /ratings

🛡️ GRUPO "Administração"
├── Usuários ..................... /users
├── Setores ...................... /queues
├── Anúncios ..................... /announcements     [só `super`]
├── Administração ................ /Administration    [só `super`]
├── Logs de Requisições .......... /LogsPage          [só `super`]
└── Financeiro ................... /financeiro

⚙️ GRUPO "Ajustes"
├── ConnectAI .................... /ConnectAI
├── Integrações .................. /queue-integration [Typebot · n8n · Dialogflow · webhook]
├── Configurações ................ /settings
├── Armazenamento ................ /storage           [só perfil admin]
├── Templates OficialAPI ......... /oficialapi-templates
└── Posts OficialAPI ............. /oficialapi-posts

📣 GRUPO "Campanhas"
└── Campanhas .................... /campaigns
    └── (abas internas) Listagem · Lista de contatos · Configurações · Extrator de leads
        rotas: /campaigns/:section · /contact-lists · /contact-lists/:id/contacts · /campaigns-config
               /campaigns/report/:campaignId

📚 GRUPO "Documentação API"
├── Teste Api .................... /messages-api
├── Credenciais API .............. /api-credentials
└── Integração Api ............... /ApiDocumentation

🤖 GRUPO "Automação"
├── Automações ................... /Automacao   (+ /Automacao/pixelfb — Pixel FB, Remarketing, Webhook)
├── Chatbot (fluxo) .............. /FluxoPage   (+ /edit-fluxo/:id, /fluxo-studio, /fluxo-progresso/:id)
├── Agente Pro ................... /agents      (+ /agents/list/:section, /agents/:agentId/:section)
├── LLM Proxy .................... /llm-proxy   (+ /llm-proxy/catalog)
└── Tele Mensagens ............... /tele-mensagens  ["campanhas de ligação com áudio pré-gravado"]

🆘 GRUPO "Ajuda, conexões e grupos"
├── Ajuda ........................ /helps
├── Aquecimento de números ....... /number-warming
├── Conexões ..................... /connections
└── Gerenciar Grupos ............. /gerenciar-grupos
    └── (telas de grupo) /ListarGrupos · /CriarGrupo · /EditarGrupo
                         /AdicionarParticipante · /EnviarMensagemGrupo · /ExtrairContatos

ROTAS PÚBLICAS (sem login)
├── /login · /signup · /forgetpsw · /reset-password/:token · /2fa
├── /web-rating/:token ........... página web de avaliação do cliente
├── /agenda-form/:token .......... formulário público de agendamento
├── /esign/:token ................ assinatura eletrônica pelo signatário
└── /ConfirmPage/:confirmationCode

OUTRAS ROTAS INTERNAS SEM ITEM DE MENU
/Email, /EmailLis, /EmailScheduler, /EmailsAgendado (disparo de e-mail),
/Calendario, /Gerenciamento, /meta-ads, /pixelfb, /integrations/{asaas,bling,hinova,mikweb,siprov},
/TagsKanban, /number-warming, /storage, /ticket-sales, /prompts, /files
```

---

## 4. Função a função — o que cada tela faz

### 4.1 Atendimentos (`/tickets`) — o coração
A tela é a caixa de trabalho: lista de conversas à esquerda, conversa no meio, ficha do contato à
direita.

- **Abas da lista:** *Abertas*, *Resolvidos*, *Busca*, mais os cabeçalhos **Aguardando** /
  **Atendendo** / **ChatBot** / **Aquecimento** dentro da lista.
- **Busca:** por contato **ou** por texto dentro das mensagens (dois modos distintos), com
  tickets-por-página configurável.
- **Filtros:** ordenação (mais recentes / mais antigos), só não lidas, por **canal**
  (WhatsApp, Facebook, Instagram, WebChat, Telegram, E-mail, Mercado Livre), por **setor** e por
  **tag**; botão de redefinir.
- **Ações na conversa:** aceitar, transferir (para **usuário**, **setor** e opcionalmente **outra
  conexão**), resolver, *finalizar sem despedida*, deletar, agendar mensagem, registrar
  **observação do contato**, criar **compromisso na Agenda**, aceitar/recusar áudios do contato,
  **exportar a conversa em PDF**, encaminhar mensagens.
- **Ações na lista:** **arquivar/desarquivar**, **fixar/desafixar**, **marcar como não lida**.
- **Campo de escrita:** anexos, **gravação de áudio com escuta antes de enviar**, **ditado por
  voz** (reconhecimento do navegador), assinatura do atendente, menção `@` em grupos (inclusive
  *"Todos"*), respostas rápidas por atalho.
- **Variáveis de mensagem** (medidas): `{{contactFirstName}}`, `{{contactName}}`, `{{user}}`,
  `{{greeting}}`, **`{{protocolNumber}}`**, `{{date}}`, `{{hour}}`, `{{ticket_id}}`, `{{queue}}`,
  `{{connection}}`.
- **Avisos de canal:** *"Alcance temporariamente limitado"* — bloqueio do próprio WhatsApp para
  iniciar conversa com quem nunca interagiu, com data prevista de liberação.

### 4.2 Kanban (`/Kanban`) e Kanban Pro (`/kanban-board`)
- **Clássico:** as colunas **são as tags** marcadas como "kanban". Arrasta-se o cartão do
  atendimento de uma tag para outra; filtros por usuário, setor, conexão e status (Aberto /
  Pendente). Cartão mostra perfil, nº do ticket e botão *"Ver Ticket"*.
- **Pro:** quadros com colunas próprias (`KanbanBoards`, `KanbanBoardColumns`,
  `KanbanBoardTickets`), pré-visualização da conversa dentro do quadro. **Licença separada.**

### 4.3 Funil de vendas (`/funil-vendas`)
Etapas próprias (`SalesFunnelStages`), tickets posicionados por etapa, **motivos de perda**
(`SalesLossReasons`), histórico de mudança de etapa e relatório dedicado (abertos no funil,
*snapshot* por coluna, lista de tickets por etapa).

### 4.4 Quadros (`/quadros`) — gestão de tarefas estilo Trello
Dezessete tabelas: quadros, listas, cartões, etiquetas, membros, comentários, anexos, listas de
verificação, **automações de quadro** e *presets* de mensagem.

### 4.5 Painel de Atendimento (`/AtendimentoPanel`)
Visão operacional ao vivo por atendente: nome, atendimentos concluídos, tempo médio de
atendimento, estado e avaliações (`atendentestatus.*`).

### 4.6 Chat Interno (`/chats`)
Conversas entre usuários da mesma empresa, com contador de não lidas no menu
(`Chats`, `ChatUsers`, `ChatMessages`).

### 4.7 Dashboard e Relatórios
- **Dashboard:** *Aguardando atendimento*, *Atendentes online*, *Atendimentos finalizados*,
  *Total de mensagens enviadas/recebidas*, *Novos leads*, *Tempo médio de atendimento*,
  *Tempo médio de espera*, atendimentos criados no período, total por usuário, filtro de datas.
- **Dashboard avançado** (`/dashboard-advanced`) e **relatórios especializados**, cada um com
  licença própria: **tags** (top tags no período, exportação CSV por tag e de "sem tag"),
  **avaliações** (CSAT/NPS), **sem retorno** (quem não respondeu), **funil**, **vendas**,
  **fechamentos** (motivos de encerramento), **ligações** (VoIP), **por usuário**.
- **Relatórios Gerados** (`/relatorios-gerados`): geração assíncrona com barra de progresso e
  entrega em **PDF ou HTML**; os parâmetros medidos incluem período, usuários, status, conexões,
  *incluir dashboard / tickets / avaliações / rastreamento*, e se exporta a **primeira** ou a
  **última** mensagem de cada ticket.

### 4.8 Contatos (`/contacts`)
Nome, número, e-mail, **data de nascimento**, empresa, **CNPJ**, endereço, **campos adicionais
livres**, conexão preferencial, carteira, lista negra, aceitar áudio, desativar bot.
Importação e exportação. Contatos de grupo em rota própria.

### 4.9 Tags (`/tags`) e Tags-Kanban (`/TagsKanban`)
Nome, cor, marcação "kanban" (vira coluna), contagem de registros marcados. Também há
`TagWhatsAppMappings` (mapear tag ↔ etiqueta nativa do WhatsApp) — **tabela vazia**.

### 4.10 Carteira de Clientes (`/wallets`)
Vincula contato **ou** atendimento a um responsável fixo. Dois modos configuráveis
(**por contato** ou **por atendimento**); ao trocar de modo, oferece migrar os vínculos
existentes. Ações em massa: marcar/desmarcar todos, transferir, excluir.

### 4.11 Respostas Rápidas (`/quick-messages`)
Atalho + texto + anexo; permissões separadas de **"permitir editar"** e **"permitir visão"**;
no perfil do usuário há a chave `editQuickMessages`.

### 4.12 Agendamentos (`/schedules`)
Mensagem programada para um contato numa data/hora, com anexo e **recorrência**.
Estados: `PENDENTE`, `AGENDADA`, `ENVIADA`, `ERRO`.
**Extra medido:** o mesmo modal publica **Status do WhatsApp** (o "stories") com imagem/vídeo ou
só texto, com cor de fundo, cor de texto, fonte, pré-visualização e **avisos de contraste** —
recurso que **só funciona em conexão whatsmeow**.

### 4.13 Avaliação (`/ratings`)
Menus de satisfação em dois formatos: **por mensagem** (o cliente responde 1/2/3 no WhatsApp) ou
**página web** com link personalizado (`/web-rating/:token`) — logotipo, cores, bordas, sombras,
mensagens de agradecimento, tudo configurável. Opção de **pedir comentário** do cliente.
Escala com nome e valor por opção (`RatingsOptions`).

### 4.14 Usuários (`/users`)
Nome, e-mail, senha, **perfil** (`admin` / `adminSetor` / `user`), mensagem de despedida própria,
conexão padrão, **início e fim de expediente**, cor na lista de tickets, WhatsApp para
notificações, e as chaves: *ver conversas de outras filas*, *ver tickets sem setor*,
*permitir editar respostas rápidas*, **ocultar atendimentos de chatbot**, permitir grupos,
`accessPages` (lista de páginas liberadas), `whatsappIds` (conexões liberadas),
`allowedGroupContactIds`/`allowedGroupPairs` (grupos liberados), `twoFactorEnabled`.

### 4.15 Setores (`/queues`)
Nome, cor, **mensagem de saudação**, de conclusão, **de fora de expediente**, de avaliação,
token, **ordem na fila do bot**, integração e prompt vinculados, e **`schedules`**: o
**horário de atendimento por dia da semana** (medido: todas as filas com 08:00–18:00 de
segunda a sexta).

### 4.16 Conexões (`/connections`)
Cartões com estado (**Online / Desligada / Aguardando QR / Abrindo / Pareando / Aguardando
passkey / Timeout**), busca e filtro por status e canal. O modal tem **cinco abas**:
*Conexão*, *Configurações*, *Automação*, *Mensagens*, *Integrações*, com:
saudação, conclusão, despedida, **fora de expediente**, **atendente indisponível** (com
`{attendantName}`), **encerrar conversas abertas após X horas**, limite de vezes que o chatbot é
enviado, transferência automática para setor após X minutos, **mover "atendendo" de volta para
"aguardando"**, prompt de IA, Typebot, n8n, ChatGPT, **proxy** (host/porta/usuário/senha),
fluxo padrão, fluxo de primeiro contato, token para integração externa, cor na lista, e
**importação do histórico do aparelho** (janela de datas, incluir grupos, encerrar tickets
depois de importar).

### 4.17 Chatbot — Fluxo de conversa (`/FluxoPage`, `/edit-fluxo/:id`)
Editor visual de fluxo (nós e arestas, React-Flow). É **o chatbot realmente usado**.
**Catálogo de nós medido nos 35 fluxos em produção** (`type` → uso real):

| nó | ocorrências | o que faz |
|---|---:|---|
| `waitNode` | 137 | espera / pausa |
| `filaNode` | 53 | encaminha para um **setor** |
| `fluxoNode` | 51 | chama **outro fluxo** (sub-fluxo) |
| `customNode` | 37 | envia texto (com opção `isInternal` = nota interna) |
| `saudationNode` | 34 | início / saudação |
| `notyNode` | 23 | **notifica um número** de WhatsApp |
| `menuListaNode` | 20 | **lista interativa** do WhatsApp (título, cabeçalho, rodapé, botão, tempo de resposta) |
| `perguntaNode` | 19 | pergunta e **guarda a resposta em variável** |
| `interactionWaitNode` | 18 | aguarda interação com tempo limite |
| `midiaNode` | 16 | envia mídia |
| `botoes2Node` | 15 | **botões de resposta rápida** |
| `ticketNode` | 11 | encerra/atualiza o ticket, dispara **avaliação** |
| `httpRequestNode` | 10 | **chamada HTTP** (URL, método, cabeçalhos, corpo, respostas mapeadas) |
| `menuNode` | 7 | menu numérico clássico |
| `conditionNode` | 1 | condição |
| `tagNode` | 1 | aplica/remove **tag** |

O fluxo guarda ainda: `schedule` (horário próprio), `offHoursMessage`,
`closeAfterOffHoursMessage`, `keywords` (palavras que disparam o fluxo), `flowVariables`,
`useMenuLimit`, **modo de teste com número de teste**.

### 4.18 Campanhas (`/campaigns`)
Assistente em três passos (**destino → conteúdo → atendimento**):
- **Destino:** lista de contatos **ou** tags; conexão; data/hora do envio.
- **Conteúdo:** até **10 mensagens** com **randomização** (uma sorteada por contato), anexo,
  **templates da API oficial** com editor de variáveis (cabeçalho, corpo, link de documento/
  imagem/vídeo), e **pré-visualização em forma de conversa**.
- **Três modos de disparo:** *Mensagem*, *Fluxo* (dispara um fluxo em vez de mensagem fixa) e
  *Agente IA* (o agente inicia a conversa com prompt de contexto).
- **Modo híbrido:** templates saem pela API oficial, texto/mídia preferem o canal paralelo com
  *fallback*, ou sorteio por percentual.
- **Atendimento:** status do ticket resultante, setor, atendente, tag.
- **Confirmação:** até 5 mensagens de confirmação.
- **Sub-telas:** listas de contatos, itens da lista, configurações de campanha
  (intervalos entre envios, `CampaignSettings`), relatório por campanha, cancelar/reiniciar.
- **Extrator de leads** (`LeadExtract*`): busca por consulta, geocodificação, varredura de sites,
  enriquecimento, pontuação por faixa (*Excelente → Baixa*), exigir WhatsApp, exportação.

### 4.19 Integrações (`/queue-integration`)
Tipos suportados (medidos no modal): **Typebot** (slug, expiração da conversa, palavra de
finalizar, palavra de reiniciar, mensagem de reinício, mensagem de opção inválida, intervalo
entre mensagens), **n8n** (URL), **Dialogflow** (projeto, linguagem, JSON de credencial),
**webhook** e o tipo próprio `automatiza-ai`. Botão **"Testar Bot"**.

### 4.20 Automação (`/Automacao`, `/Automacao/pixelfb`)
Quatro blocos declarados no menu: **Pixel FB**, **Notificações de Visitas**, **Remarketing**,
**Webhook** — mais um marcado como *"Em desenvolvimento"*.
Modelos associados: `Pixels`, `PixelConversionLogs`, `MetaConversionsApiService`.
Há aviso explícito sobre `ctwa_clid` (Click-to-WhatsApp) e envio como evento *offline* quando o
identificador do clique não existe.

### 4.21 Agente Pro (`/agents`) e LLM Proxy (`/llm-proxy`)
- **Agente Pro:** agentes de IA com **ferramentas** (`AgentTools`), **RAG** com documentos e
  fragmentos (`AgentRAGDocuments`, `AgentRAGChunks`), registro de execução, métricas por
  ferramenta e **follow-up** automático.
- **LLM Proxy:** cadastro de provedores e chaves (OpenAI, Anthropic, Gemini, DeepSeek…),
  catálogo de modelos, medição de uso e custo por evento.

### 4.22 Aquecimento de números (`/number-warming`)
As próprias conexões conversam entre si, com texto gerado por IA, por um tempo definido, com
intervalo mínimo/máximo aleatório e teto de mensagens por hora. Exige no mínimo 2 conexões.
**Só faz sentido em WhatsApp não oficial.**

### 4.23 Gerenciar Grupos
Listar grupos (com participantes, dono, data de criação), criar grupo — **inclusive em massa**,
por lista de nomes —, editar, adicionar participante individual **ou em massa** por lista de
números, enviar mensagem ao grupo e **extrair os contatos do grupo** (copiar números /
exportar CSV).

### 4.24 Agenda / CRM (`/agenda/*`)
Profissionais, serviços, calendário, compromissos (com anexos, séries e eventos), feriados,
**formulários públicos de agendamento** (`/agenda-form/:token`), regras de *follow-up*,
notificações, **cobrança via Asaas** e relatórios.

### 4.25 StudioSign — assinatura eletrônica (`/esign-documents`)
Documentos, signatários, eventos e **evidências**; link público `/esign/:token` e verificação
`/esign/verify/:publicId`.

### 4.26 E-mail (`/Email`, `/EmailLis`, `/EmailScheduler`, `/EmailsAgendado`)
Disparo de e-mail para vários destinatários, lista de enviados com leitura do conteúdo,
agendamento e fila de agendados. Configuração SMTP fica em Configurações.

### 4.27 Armazenamento (`/storage`)
Varredura do disco, índice de arquivos, **duplicados**, lixeira e trilha de auditoria
(`StorageScanJobs`, `StorageFileIndexes`, `StorageAuditLogs`). Só para perfil `admin`.

### 4.28 Financeiro (`/financeiro`) e Empresas
Faturas por empresa (`Invoices`), planos, vencimento, bloqueio por inadimplência.
Integrações de cobrança presentes nas **chaves de configuração**: Asaas, Gerencianet/Efí (PIX),
Mercado Pago, Stripe, PagHiper e **Kiwify** (webhooks `/payment/webhook/kiwify`).
Integrações de provedor de internet: **IXC**, **MK-Auth**, **SGP** — e rotas
`/integrations/{bling,hinova,mikweb,siprov}`.

### 4.29 Documentação da API externa (`/ApiDocumentation`, `/messages-api`, `/api-credentials`)
Documentação embutida, testador de API e emissão de credenciais. Endpoints documentados
(medidos nas chaves de tradução e nas rotas): enviar mensagem de **texto** e de **mídia**,
criar/listar/atualizar/excluir **contato**, atualizar **ticket**, criar **empresa**, criar/listar/
excluir **tag**, criar/excluir **agendamento**, listar **planos**, consultar **inadimplentes**.
Autenticação por `Bearer <token da conexão>`.

### 4.30 Administração e Logs (só `super`)
- `/Administration`: painel do dono da instalação.
- `/LogsPage`: **Logs de Requisições** (`RequestLogs`) — método, URL, quem chamou, quando.
- `/announcements`: **Anúncios** com prioridade, texto, anexo e visibilidade por empresa —
  aparecem como aviso dentro do produto.

### 4.31 Configurações (`/settings`)
As opções reais foram lidas da tabela `Settings` (288 registros, **93 chaves distintas**).
Agrupadas por assunto:

| assunto | chaves medidas |
|---|---|
| Atendimento | `scheduleType` (horário por empresa/fila/desligado), `chatBotType`, `showClosedTickets`, `hoursCloseTicketsAuto`, `tempofila`, `moveQueue`, `sendQueuePosition`, `pauseAttendance`, `requireDepartmentOnAccept`, `ticketModeContact`, `historyMessages` |
| Mensagens automáticas | `sendGreetingAccepted`, `sendGreetingMessageOneQueues`, `sendMsgTransfTicket`, `transferMessage`, `attendantTransferMessage`, `sendFarewellWaitingTicket`, `sendSignMessage`, `outsidemessage`, `outsidequeue`, `acceptTicketMessage`, `noAudioMessage`, `noCallMessage` |
| Encerramento | `requireTicketCloseReason`, `ticketCloseReasonCustomCategories` |
| Avaliação | `userRating`, `userRatingList` |
| Grupos e chamadas | `CheckMsgIsGroup`, `blockGroups`, `groupNotifications`, `call`, `acceptCallWhatsapp`, `acceptAudioMessageContact` |
| Carteira | `walletAssignmentMode` |
| IA | `openAiApiKey`, `selectedModel`, `autoCorrectEnabled` |
| Bots externos | `urlBotTypebot`, `tokenTypebot`, `urlTypebot`, `urlN8N`, `connectAiClientId`, `connectAiClientSecret`, `connectAiTicket` |
| Marca / aparência | `mainColor`, `scrollbarColor`, `toolbarBackground`, `backgroundPages`, `whitelabelCreation`, `tagDisplayMode` |
| Cadastro | `userCreation`, `userRandom`, `disablesignup`, `confirmAccount` |
| E-mail | `smtpauth`, `usersmtpauth`, `clientsecretsmtpauth`, `smtpPort`, `emailsender`, `sendgridapi` |
| Cobrança | `asaas`, `asaastoken`, `mpaccesstoken`, `stripeprivatekey`, `eficlientid`, `eficlientsecret`, `efichavepix`, `paghiper`, `paghipertoken`, `kiwifyToken`, `pixDefaultKey`, `pixDefaultKeyType`, `pixDefaultName`, `paymentMethod` |
| Provedor de internet | `ipixc`, `tokenixc`, `ipmkauth`, `clientidmkauth`, `clientsecretmkauth`, `ipsgp`, `tokensgp`, `appsgp` |
| Facebook | `clientIdFacebook`, `clientSecretFacebook` |
| Importação | `blockImport` |

### 4.32 Funções que existem no código mas **não têm item de menu**
`Tele Mensagens` (campanha de ligação com áudio pré-gravado, `ConnectzapCallRecords`),
`Central de Notificações` (`NotificationCenterRules` — regras que avisam por WhatsApp quando há
N tickets pendentes ou espera acima de X minutos), `Controle de Tickets` (`TicketUnify*` —
automação em lote de unificação/encerramento, com janelas de execução e **horário de pico**),
`Console Pessoal` (`PersonalConsole*`), `Meta Ads` (`MetaAds*`), `TickHub`
(protocolo externo — `Tickets.tickHubTicketId`, `tickHubProtocol`), `Vendas`
(`TicketSales`, `/ticket-sales`, `/relatorio-vendas`), `Lista negra`
(`BlackLists`, `BlackListContacts`), `Palavras-chave` (`Keywords`, `KeywordMessages`),
`Notas de ticket` (`TicketNotes`), `Push` (`PushSubscriptions`, `AppPushDevices`),
`Extensões de navegador` (dois `.zip` servidos: *llm-session-extension* e
*passkey-connector-extension*), `Webfone` (`/webfone/webfone.iife.js`, WebRTC).

---

## 5. Modelo de dados

**189 tabelas**, Sequelize, PostgreSQL 15.18. Abaixo o núcleo — o que guarda o atendimento de
verdade — e depois os blocos periféricos.

### 5.1 Núcleo do atendimento

| tabela | registros | o que guarda (campos que importam) |
|---|---:|---|
| **Companies** | **10** | o tenant: nome, status, `planId`, `dueDate`, dados de cobrança |
| **Plans** | **4** | **45 colunas**, quase todas chaves de licença (§5.3) |
| **Users** | **77** | `profile`, `super`, `companyId`, `accessPages[]`, `whatsappIds[]`, expediente (`startWork`/`endWork`), `allTicket`/`allHistoric`, `hideChatbotTickets`, `twoFactorEnabled`, `notifyWhatsappNumber` |
| **Queues** (Setores) | **52** | nome, cor, saudação, conclusão, fora de expediente, avaliação, `orderQueue`, **`schedules`** (horário por dia), `integrationId`, `promptId` |
| **UserQueues** | 227 | quais setores cada usuário atende |
| **Whatsapps** (Conexões) | **8** | **70 colunas**: sessão, QR, status, `channel`, mensagens automáticas, `expiresTicket`, `maxUseBotQueues`, `transferQueueId`/`timeToTransfer`, `flowId`, `firstContactFlowId`, proxy, importação de histórico, `chatGPTEnabled`/`typebotEnabled`/`n8nEnabled` |
| **Contacts** | **4.337** | nome, número, e-mail, `channel`, `isGroup`, `disableBot`, `isBlacklisted`, `walleteUserId`, `birthDate`, `additionalData` (JSON), `lid` |
| **Tickets** | **2.529** | **66 colunas** — status, contato, usuário, setor, conexão, `uuid`, `chatbot`, `isBot`, `useIntegration`, estado do fluxo (`flowId`, `currentNodeId`, `awaitingResponseNodeId`, `lastNodeIdSent`, `etapa`), Typebot, avaliação (`awaitingRating*`, `webRatingToken`), `walleteUserId`, `isArchived`/`isPinned`, `tickHubProtocol`, `responseWindowExpiresAt`, `ctwaFep*` |
| **Messages** | **234.031** | corpo, `mediaType`, `fromMe`, `ack`, citação, reação, `companyId` |
| **TicketTraking** | **16.974** | a linha do tempo de cada atendimento: `queuedAt`, `startedAt`, `finishedAt`, `chatbotAt`, `ratingAt`, `rated` — **é a fonte dos indicadores** |
| **TicketLogs** | **182.461** | auditoria de tudo o que acontece com o ticket |
| **Tags** / **TicketTags** | 77 / 1.631 | etiqueta com cor e a marca `kanban` (vira coluna); vínculo tag↔ticket |
| **QuickMessages** | 39 | atalho, texto, anexo, permissões |
| **Schedules** | **527** | mensagem programada com anexo e recorrência |
| **Ratings** / **RatingsOptions** / **UserRatings** | 3 / 13 / **178** | menu de avaliação, opções da escala, e a nota efetivamente dada |
| **TicketClosures** | **502** | motivo/tabulação do encerramento (categoria, resumo, detalhes) |
| **Chats / ChatUsers / ChatMessages** | 50 / 121 / 453 | chat interno da equipe |
| **Flows** | **35** | o chatbot visual: `nodes`, `edges`, `keywords`, `schedule`, `flowVariables` |
| **Settings** | 288 | configuração por empresa (chave/valor) |
| **Invoices** | 26 | faturas — 18 pagas (R$ 8.622) e 8 abertas (R$ 3.832) |
| **RequestLogs** | 7.438 | log de requisições da API |
| **WhatsappLidMaps** | 432 | mapeamento do identificador interno do WhatsApp (`lid`) — **artefato do canal não oficial** |
| **Reports** | 11 | relatórios gerados sob demanda (PDF/HTML) com os parâmetros usados |
| **Announcements** | 1 | avisos do dono da instalação |

### 5.2 Blocos periféricos (todos com **zero** registros)

| bloco | tabelas | o que seria |
|---|---:|---|
| Agenda / CRM | 13 (`Agenda*`, `Appointment*`, `AgendamentoEmails`) | agendamento de serviços com profissionais e cobrança |
| Quadros de tarefas | 17 (`TaskBoard*`, `Tasks`) | Trello interno |
| Agentes de IA | 11 (`Agent*`, `CoreAIAgents`, `WorkflowAgent*`) | agentes com RAG e ferramentas |
| Proxy de LLM | 5 (`LlmProxy*`) | roteador de provedores de IA com medição |
| Funil de vendas | 6 (`SalesFunnel*`, `SalesLossReasons`) | pipeline comercial |
| Kanban Pro | 4 (`KanbanBoard*`, `KanbanConfigs`) | quadros com colunas próprias |
| Assinatura eletrônica | 4 (`Esign*`) | StudioSign |
| Meta Ads | 6 (`MetaAds*`) | anúncios e sincronização de leads |
| Console pessoal | 4 (`PersonalConsole*`) | bots pessoais com memória |
| Armazenamento | 3 (`Storage*`) | varredura de disco e duplicados |
| Extrator de leads | 2 (`LeadExtract*`) | prospecção automática |
| Aquecimento | 2 (`NumberWarming*`) | conversas artificiais entre números |
| Chatbot antigo | 3 (`QueueOptions`, `Chatbots`, `DialogChatBots`) | menu por opção de fila — **substituído pelo Fluxo** |
| Diversos | `Webhooks`, `ApiClients`, `Prompts`, `Pixels`, `TicketSales`, `TicketNotes`, `BlackLists`, `Keywords`, `Files`, `Integrations`, `SiteIntegrations`, `Subscriptions`, `TicketUnify*`, `ScheduleAutomations`, `NotificationCenterRules`, `TagWhatsAppMappings`, `ContactCustomFields`, `PushSubscriptions`, `AppPushDevices` | — |

### 5.3 As chaves de licença (colunas de `Plans`)
`useFacebook`, `useInstagram`, `useWhatsapp`, `useCampaigns`, `useExternalApi`, `useInternalChat`,
`useSchedules`, `useKanban`, `useOpenAi`, `useIntegrations`, `useTypebot`, `useN8n`, `useChatGPT`,
`usePlanoTeste`, `useConnectAi`, `useAgenteIA`, `useBotoes`, `useOficialAPI`, `useOficialAPIEmbed`,
`useAgentePro`, `useAgenda`, `usePersonalAgent`, `useConnectzapVoip`, `useScheduleAutomation`,
`useTickHub`, `useAssinaturaEletronica`, `useLlmProxy`, `useLlmProxyApi`, `useStorage`,
`useMetaAds`, `useLeadExtractor`; mais limites numéricos: `users`, `connections`, `queues`,
`memory`, `limiteFluxo`, `maxPersonalAgents`, `personalAgentDiskGB`,
`oficialApiFacebook/Instagram/Whatsapp`.

**Os 4 planos cadastrados:**

| plano | usuários | conexões | setores | valor | destaque |
|---|---:|---:|---:|---:|---|
| ADM (Interno) | 10 | 10 | 10 | R$ 100 | tudo ligado, `limiteFluxo` 999 |
| BASIC | 3 | 1 | 5 | R$ 297 | sem campanhas, sem API externa |
| PLUS | 20 | 3 | 99 | R$ 479 | com campanhas, API, `useStorage` |
| ESPECIAL-RAGNA | 20 | 5 | 30 | R$ 0 | plano da casa; `useAgenda` ligado, 10 agentes pessoais |

---

## 6. Papéis e permissões

### 6.1 Os três perfis + o superusuário
| perfil | quantos (medido) | o que enxerga |
|---|---:|---|
| `admin` | **39** | tudo da **sua empresa**: configurações, usuários, setores, conexões, campanhas, relatórios, armazenamento |
| `adminSetor` | **3** | administrador **limitado ao(s) setor(es)** que atende |
| `user` | **35** | só atendimento, dentro do que `accessPages` e `whatsappIds` permitem |
| `super` (coluna booleana) | **1** | dono da instalação: `/Administration`, `/LogsPage`, `/announcements`, `/companies`, `/plans`, Controle de Tickets |

### 6.2 O mecanismo real de permissão
Não é RBAC por papel — é uma **lista de páginas por usuário** (`Users.accessPages`, tipo *array*),
somada a três recortes independentes: `whatsappIds` (conexões visíveis),
`allowedGroupContactIds`/`allowedGroupPairs` (grupos visíveis) e as chaves booleanas
`allTicket`, `allHistoric`, `allUserChat`, `hideChatbotTickets`, `editQuickMessages`, `allowGroups`.
Acima disso ainda incidem duas camadas: **`requiredFuncionalidade`** (licença do produto) e
**`requiredPlanFlag`** (a chave do plano).

**Distribuição real de `accessPages` (contagem de usuários com cada página liberada):**

```
tags 60 · chats 60 · tickets 60 · quick-messages 60 · helps 60 · Kanban 59
contacts 17 · dashboard 15 · schedules 14
todolist 6 · AtendimentoPanel 6 · ExtrairContatos 6 · connections 6
files 5 · ratings 5 · campaigns 5 · announcements 5
Grupos 4 · EnviarMensagemGrupo 4 · EditarGrupo 4 · relatorios 4 · prompts 4 · queues 4
Automacao 4 · queue-integration 4 · users 4 · CriarGrupo 4 · ListarGrupos 4
FluxoPage 3 · financeiro 3 · wallets 3 · settings 3 · ApiDocumentation 3 · Email/EmailScheduler/EmailLis/Emails/EmailsAgendado 3
TaskBoards 2 · Modulos 1
```

> **Leitura:** o conjunto que quase todo mundo tem é `tickets · chats · tags · quick-messages ·
> Kanban · helps`. **Esse é o produto de verdade.** Tudo abaixo de 6 usuários é vitrine.

### 6.3 Segurança — o que foi medido
- **2FA disponível** (`twoFactorEnabled`, rota `/2fa`) mas **ligado em 0 dos 77 usuários**.
- Sem trilha de auditoria por ação de atendente além de `TicketLogs` (que é sobre o ticket) e
  `RequestLogs` (que é sobre a requisição).

---

## 7. Volume real de uso — o que está vivo e o que é vitrine

### 7.1 Movimento
| medida | valor |
|---|---|
| Mensagens totais | **234.031** (140.427 enviadas · 93.604 recebidas) |
| Mensagens em ago/2026 | **23.482** |
| Média mensal (fev–ago/2026) | **~24.600** |
| Tickets totais | **2.529** (pico em fev/2026: 887) |
| Atendimentos rastreados | 16.974 |
| Contatos | 4.337 |

**Mensagens por empresa:** Analise Consultoria 72.524 · Multiplique 71.440 · **Ragnatela 55.797** ·
Duailibe 24.969 · Instituto JK 6.454 · Unopar 2.645 · demais < 200.

**Tipos de mensagem:** texto 132.645 · texto estendido 27.844 · conversation 14.939 ·
**imagem 11.247** · **lista interativa 10.966** · documento 6.668 · **áudio 4.274** ·
resposta de lista 1.414 · **botões interativos 843** · vídeo 371 · registro de ligação 563 ·
vCard 149.

> O peso de **lista interativa (10.966) + botões (843) + resposta de lista (1.414)** prova que o
> **fluxo com menus interativos é o modo de operar** — não é enfeite.

### 7.2 Placar de uso por função

| função | evidência | veredito de uso |
|---|---|---|
| Atendimento (tickets/mensagens) | 234 mil mensagens | 🟢 **espinha dorsal** |
| Setores + horário de atendimento | 52 filas, todas com 08–18h seg–sex | 🟢 intenso |
| Fluxo de conversa (chatbot) | **35 fluxos**, as **8 conexões** com `flowId` | 🟢 intenso |
| Tags | 77 tags, **1.631** marcações | 🟢 intenso |
| Kanban clássico (por tag) | 17 tags marcadas como coluna | 🟡 moderado |
| Respostas rápidas | 39 em 4 empresas | 🟡 moderado |
| Agendamento de mensagem | **527** (488 enviadas; 97 % de uma empresa só) | 🟡 concentrado |
| Chat interno | 50 conversas, 453 mensagens | 🟡 moderado |
| Avaliação (CSAT) | 178 notas, mas `userRating` **ligado em 1 das 10 empresas** | 🟡 pontual |
| Relatórios gerados | 11 gerados por 5 usuários | 🟡 pontual |
| Financeiro | 26 faturas | 🟡 pontual |
| Anúncios | 1 | 🟠 vestigial |
| **Campanhas** | **2** (1 concluída, 1 com erro), 7 registros de log | 🟠 quase nulo |
| Listas de contatos | 3 listas, **2 itens** | 🟠 quase nulo |
| Tabulação manual de encerramento | 502 registros, **100 % categoria `automatic`**; `requireTicketCloseReason` **desligado em todas as empresas** | 🔴 **não usado por gente** |
| Chatbot por opção de fila | `QueueOptions` = 0 | 🔴 morto (substituído) |
| Kanban Pro / Funil / Quadros | 0 / 0 / 0 | 🔴 nunca usado |
| Agenda-CRM · Assinatura · Meta Ads · Agente Pro · LLM Proxy · Aquecimento · Extrator de leads · Console pessoal · Armazenamento · Vendas · Lista negra · Webhooks · Clientes de API · Prompts · Pixels | **0 registros em todas** | 🔴 nunca usado |

### 7.3 Chaves de configuração — o que as empresas realmente ligaram
| chave | como está |
|---|---|
| `scheduleType` (horário de atendimento) | **`company`** em 4 empresas (1, 2, 6, 11); `disabled` em 6 |
| `chatBotType` | `text` em **todas** |
| `userRating` | `enabled` em **1** empresa (Duailibe) |
| `requireTicketCloseReason` | `disabled` em **todas** |
| `showClosedTickets` | `true` em 5 |
| `call` (aceitar ligação) | `disabled` em **todas** |
| `sendGreetingAccepted` | `enabled` em 2 |

---

## 8. Integrações ativas — o que está de fato conectado

| integração | estado medido |
|---|---|
| **WhatsApp** | 8 conexões, **todas `channel = whatsmeow`** (não oficial). 5 conectadas, 3 desconectadas |
| **API oficial da Meta** | **nenhuma conexão ativa.** O código existe (`OficialApiServices`, templates, posts, modo híbrido), mas os contatos por `whatsappapi` são **7** e por `instagramdevconnectai` são **8** — resíduo de teste |
| **Typebot** | 1 projeto cadastrado (empresa 1) — `Chamado-Ranatela`. Nenhuma conexão com `typebotEnabled` |
| **automatiza-ai** | 1 projeto (empresa 1) |
| **n8n / Dialogflow / ChatGPT por conexão** | cadastrados no modelo, **nenhuma conexão com a chave ligada** |
| **Webhooks de saída** | tabela `Webhooks` **vazia** |
| **API externa** | `ApiClients` vazia; `RequestLogs` mostra tráfego só do próprio front (`/auth/*`, `/messages/*`, `/tickets/*`) — ou seja, **nenhum sistema de terceiro consumindo** |
| **Redis** | ativo (Docker, 127.0.0.1:6379) — filas Bull |
| **NATS** | ativo (Docker, 127.0.0.1:4222) — mensageria interna do produto |
| **Porteiro de licença** | `devconnectai-gate` em 127.0.0.1:9471, com `LICENSE_KEY` e `GATE_IPC_SECRET` |
| **Cobrança** | chaves de Asaas, Efí/Gerencianet, Mercado Pago, Stripe, PagHiper e Kiwify presentes na configuração |
| **Provedor de internet** | chaves de IXC, MK-Auth e SGP presentes |
| **Facebook** | `FACEBOOK_APP_ID` / `SECRET` e `VERIFY_TOKEN` no `.env` |
| **SMTP / SendGrid** | chaves presentes |
| **OpenAI** | `OPENAI_API_KEY` no `.env`; `Prompts` vazia |

---

## 9. Os cinco achados que mudam a decisão

1. **Três quartos do produto nunca foram ligados.** 141 de 189 tabelas vazias. Copiar
   funcionalidade daqui por "paridade" seria copiar principalmente vitrine de vendas do
   fornecedor, não necessidade da operação.

2. **O chatbot visual é insubstituível na prática.** São 35 fluxos, todas as conexões apontam
   para um, e 13 mil mensagens interativas saíram deles. O Chatwoot **não tem** editor visual de
   fluxo. Este é, de longe, o maior buraco funcional da migração.

3. **A dependência do canal não oficial é estrutural, não acessória.** `whatsmeow` num binário
   fechado, `WhatsappLidMaps`, aquecimento de números, publicação de Status, gerenciamento e
   extração de contatos de grupos, importação do histórico do aparelho — tudo isso **só existe
   porque o canal é não oficial** e some por definição no Ragnabot.

4. **A tabulação de encerramento é uma promessa não cumprida.** Existe tela, existe tabela, e os
   502 registros são **todos automáticos** — a exigência está desligada nas 10 empresas. É um
   caso onde o requisito é real (todo NOC quer tabular) mas a implementação atual não prova nada.

5. **Segurança está atrás do padrão da casa.** 2FA disponível e ligado em zero usuários; permissão
   por lista de páginas por usuário, sem papéis compostos; sem trilha de auditoria por atendente.
   O Ragnabot já nasce melhor nesses três pontos, e isso é argumento de venda.

---

## 10. O que ficou fora do alcance desta leitura

- **Rotas do back-end lidas uma a uma:** o código do servidor tem os textos **cifrados**, não só
  rotacionados. A superfície foi inferida (107 arquivos de rota + 171 modelos + chamadas do
  front). Onde a inferência era frágil, o item está marcado como não determinado.
- **Comportamento em tempo de execução:** nada foi executado, nenhum fluxo foi disparado, nenhuma
  tela foi aberta com usuário real. Tudo aqui é leitura de artefato e de dado.
- **Regras de negócio internas do fornecedor** (o que o porteiro de licença faz, o que o binário
  `connectzap` envia para a nuvem dele): **não determinado**, e propositalmente não investigado.

