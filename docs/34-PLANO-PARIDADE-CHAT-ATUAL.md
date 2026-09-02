# 34 — PLANO DE PARIDADE COM O CHAT ATUAL (extensão do doc 32)
> Levantado em 02/09/2026 a partir de 12 telas do chat atual enviadas pelo dono + medição
> do que o motor do Ragnabot JÁ TEM. Complementa `32-PLANO-DE-EXECUCAO.md`; não o substitui.
> **Regra:** nada entra aqui como "a construir" sem eu ter medido que não existe.

---

## ⚠️ O QUE JÁ EXISTE (medido, não suposto)

Antes de planejar, o inventário — porque metade do que parecia faltar está construído e sem tela:

| Já existe no motor | Onde | Falta |
|---|---|---|
| **Motor de fluxo** com nós `texto · botoes · lista · condicao · variavel · espera · aguardar · encerrar · transferir_time · email · audio · video` | `ragnabot-fluxo-{motor,nos,publicacao}.service.js` + `ragnabot-fluxo.routes.js` | nós novos (ver F3) |
| **Construtor de fluxo** (tela) | `app/web/src/paginas/FluxosRagnabot.jsx` | o dono não consegue usar (ver **F1**) |
| **Respostas rápidas** com conceito pessoal × global | `ragnabot-respostas-rapidas.service.js` + rotas | **não tem tela nenhuma** |
| Turnos, expediente, automações de atendimento | `ragnabot-turno.service.js`, `ragnabot-atendimento*.js` | tela |
| Protocolo, auditoria, empresas (SaaS), cobrança | serviços próprios | — |
| **Agendamento de mensagem** | ❌ **não existe** | tudo |

📌 **Conclusão que muda a prioridade:** o problema nº 1 do dono ("não consigo construir fluxo")
provavelmente **não é falta de construtor** — é falta de acesso/uso da tela que já existe.
Medir isso ANTES de escrever qualquer código novo de fluxo.

---

## FASE 1 — DESTRAVAR O QUE JÁ ESTÁ PRONTO 🔴 URGENTE
> O dono disse "com urgência" sobre construir fluxo. Se a tela existe e ele não chega nela,
> construir mais nada é desperdício.

| # | Item | Nota |
|---|---|---|
| 1.1 | ~~Descobrir por que o dono não constrói fluxo hoje~~ → ✅ **MEDIDO EM 02/09/2026, causa encontrada** (ver abaixo) | ⚠️ bloqueava F3 |
| 1.2 | Menu/atalho visível para o construtor de fluxo, sem precisar decorar URL | |
| 1.3 | **Tela de respostas rápidas** — o backend está pronto, inclusive pessoal × global (item 8 do dono). Formulário: atalho, escopo (só eu / todos), N mensagens, anexos (modelo na 3ª imagem) | |
| 1.4 | Puxar resposta rápida **dentro da conversa** (atalho `/`), como no chat atual | |

### ✅ 1.1 — CAUSA MEDIDA: são DOIS painéis, com DUAS entradas

Medido no código, não suposto:

- `app/web/src/main.jsx`: *"NÃO há roteador e NÃO há menu lateral — a interface tem uma página só"*
- `app/web/src/paginas/Entrada.jsx`: **tela de login própria** (e-mail + senha + 2FA), servida em
  `/motor-api/`, que só responde a quem pede `Accept: text/html`

Ou seja: o construtor de fluxo **existe e funciona**, mas mora num aplicativo separado, atrás de
uma segunda tela de entrada, sem link, sem menu e sem atalho a partir do painel que o dono usa
todo dia. Ele nunca chegou lá porque **não há caminho até lá**.

📌 Atenuante já feito: a entrada aceita **a mesma conta da plataforma** (*"Não há senha separada
aqui"*), então não são duas senhas — são duas portas.

**Consequência para o plano inteiro:** o chat atual tem **um** menu lateral com tudo
(Atendimentos, Kanban, Fluxo, Conexões, Ajustes…). Enquanto o Ragnabot for painel-do-fornecedor +
aplicativo-do-motor separados, cada funcionalidade nova nasce escondida do mesmo jeito. A
unificação da casca deixa de ser estética e vira **pré-requisito de adoção** — está na F10.

| # | Item | Nota |
|---|---|---|
| 1.1.a | Entrar em sessão única: quem está logado no painel entra no motor sem digitar de novo | 🔴 |
| 1.1.b | Link para o construtor a partir do painel (item de menu, não URL decorada) | 🔴 imediato |
| 1.1.c | Roteador na interface do motor (hoje é página única — não cabe nem uma tela a mais) | 🔴 bloqueia F1.3, F4.6, F9.2.3 |


## FASE 2 — A CAIXA DE ATENDIMENTO 🔴
> É onde o agente vive. Hoje o Ragnabot usa a caixa do fornecedor, sem essas regras.

| # | Item | Nota |
|---|---|---|
| 2.1 | **Transferência entre agentes e entre setores** (item 1) | o motor tem `transferir_time`; falta `transferir_agente` e a ação na tela |
| 2.2 | **Conversa em aberto só é vista pelo agente que atende** (item 4) | ⚠️ é regra de **isolamento**, não de tela: tem de ser imposta no servidor, nunca por esconder botão |
| 2.3 | **Submenu "Resolvidos"** (item 5): ordem por resolução mais recente; **admin vê tudo, agente vê só o que ele resolveu** | mesma regra do 2.2 |
| 2.4 | **Segmentação por SETOR** — histórico por setor, não global. Um cliente tem conversas em setores diferentes e elas não se misturam (item 5) | ⚠️ decisão de modelo de dados; mexe em consulta, não em CSS |
| 2.5 | **Iniciar conversa a partir de Contatos** (item 11): escolher conexão + setor → cria atendimento | telas 10-12 |
| 2.6 | Ações da conversa: devolver ao setor, participantes, exportar PDF, mensagem interna, assinar mensagem, enviar contato/localização | 1ª e 2ª imagens |
| 2.7 | **Etiquetas no cartão da conversa** (imagem 13): cada conversa da lista mostra **caixa de entrada · setor · atendente** em etiquetas coloridas. Sem isso o agente não sabe, olhando a fila, de quem é o quê | pedido do dono |
| 2.8 | **Navegação da caixa** como no chat atual: abas **Abertas · Resolvidos · Grupos · Filtros**, e dentro de Abertas as sub-abas **Atendendo · Aguardando · ChatBot** com contador em cada uma | imagem 13 |
| 2.9 | Busca por nome ou número do contato dentro da fila | |

## FASE 3 — CONSTRUTOR DE FLUXO: PARIDADE 🟠
> Comparação nó a nó com as telas do chat atual (imagens 6 a 9).

**Já temos:** Mensagem · Botões · Menu Lista · Condição · Variável · Espera · Aguardar
Interação · Mídia (áudio/vídeo) · Encerrar · Transferir para time

**Falta construir:**

| # | Nó | Nota |
|---|---|---|
| 3.1 | **Testador de fluxo** (pedido explícito do dono) — simulador de conversa dentro do editor | 🔴 o mais pedido |
| 3.2 | **Pergunta** (pergunta e aguarda resposta, distinta de "aguardar") | |
| 3.3 | **Atendente** (transferir para pessoa) — hoje só temos setor/time | casa com 2.1 |
| 3.4 | **Conectar fluxos** (sub-fluxo) | |
| 3.5 | **Randomizador** (saídas com porcentagem) — teste A/B | |
| 3.6 | **Notificação** (avisa por WhatsApp quando o cliente entra em contato) | |
| 3.7 | **Etiqueta / Tag Kanban** | |
| 3.8 | **Estatística por opção no canvas** (enviado, clicado, CTR) — no chat atual aparece em cada saída | ajuda a decidir o que muda |
| 3.9 | **Botões por canal**: OficialAPI, Facebook, Instagram, Telegram (máx. 3 botões) · CTA com URL · Carrossel de mídia · Reagir com emoji · Responder comentário do Instagram | ⏳ depende da Análise do App da Meta |
| 3.10 | **Cobrança no fluxo via Efí Bank** (Pix primeiro) | ✅ **decidido em 02/09**: provedor único = **Efí Bank**. Detalhamento completo em `36-EFI-BANK-PAGAMENTOS.md` |

## FASE 4 — AGENDAMENTO 🟠
> Item 9. Não existe nada; é construção do zero. Telas 4 e 5.

| # | Item |
|---|---|
| 4.1 | Modelo + serviço de agendamento (contato, mensagem, data, conexão, setor) |
| 4.2 | **Recorrência** (única / recorrente) |
| 4.3 | **Multi-contatos** (um agendamento, vários destinatários) |
| 4.4 | **Abrir ticket ao enviar** (sim/não) — decide se vira atendimento |
| 4.5 | Anexo de mídia |
| 4.6 | Tela de lista com filtros (período, status, recorrência) e status por item |
| 4.7 | Trabalhador que dispara no horário e registra o resultado |

## FASE 5 — MARCA E MIÚDOS 🟢
| # | Item |
|---|---|
| 5.1 | **"Desenvolvido por Ragnatela IoT Solutions" no widget do site** (item 3) — mudança pequena |
| 5.2 | Empresa + versão no rodapé do usuário logado ⚠️ **na interface própria**, nunca injetando script no painel do fornecedor (quebrou o painel 2× em 31/08) |

---

## ❓ ITEM 2 — O QUE É O "CAPITÃO"

**Captain é o agente de IA nativo da plataforma base.** Não é nosso. Ele lê documentos que você
alimenta (site, central de ajuda, PDFs), responde o cliente sozinho e passa para um humano quando
não sabe. Confirmado pelas chaves de configuração no ambiente: `CAPTAIN_OPEN_AI_API_KEY`,
`CAPTAIN_OPEN_AI_MODEL`, `CAPTAIN_EMBEDDING_MODEL`, `CAPTAIN_FIRECRAWL_API_KEY`,
`CAPTAIN_DOCUMENT_AUTO_SYNC_*` — e pelos limites por conta `captain_responses` e
`captain_documents`.

**Estado hoje: desligado.** A chave da OpenAI está VAZIA, então ele não responde nada.

⚠️ **Três coisas a decidir antes de ligar:**
1. **Custo por conversa** — cada resposta consome API da OpenAI, cobrada por uso. Já temos o caso
   do Gemini pré-pago acabando (~09/09) para lembrar que crédito acaba.
2. **É recurso de plano pago** da plataforma base, e a instalação está na edição comunidade —
   o alerta "Unauthorized premium changes detected" já apareceu no painel em 31/08.
3. **Sobreposição com o nosso motor de fluxo.** Captain responde por IA; o fluxo responde por
   regra. Não são a mesma coisa e podem brigar pelo mesmo atendimento. Definir quem atende o quê
   ANTES de ligar, senão o cliente recebe duas respostas.

📌 **Recomendação que eu havia dado:** deixar desligado até o motor de fluxo estar em paridade.

### ⚖️ DECISÃO DO DONO (02/09/2026) — ADOTAR O CAPITÃO

> *"pode manter o capitão como agente no lugar do chat, não precisa construir do zero, só adequa
> de como ele é usado para o nosso atual"*

**Decidido: não construímos agente de IA próprio. Adaptamos o Captain.** É a decisão barata e
certa — construir do zero um agente que lê documento, vetoriza e responde seria meses para chegar
onde a plataforma já está.

O que "adequar ao nosso" quer dizer, em itens executáveis:

| # | Item | Nota |
|---|---|---|
| 2.C.1 | **Ligar a chave da OpenAI** (`CAPTAIN_OPEN_AI_API_KEY` está VAZIA — por isso ele não responde nada hoje) | 🔴 primeiro passo |
| 2.C.2 | **Fronteira com o motor de fluxo**: quem atende o quê. Regra proposta — o **fluxo atende primeiro** (é previsível e de graça); o Captain entra **só quando o fluxo não tem saída** para o que o cliente disse, e devolve ao humano quando não sabe | 🔴 **definir antes de ligar**, senão o cliente recebe duas respostas |
| 2.C.3 | **Alimentar com a base da casa**: site da Ragnatela, artigos do blog, central de ajuda, PDFs de produto — é disso que ele responde | usa `CAPTAIN_DOCUMENT_AUTO_SYNC_*` |
| 2.C.4 | **Por empresa cliente**: cada empresa alimenta os documentos dela e o agente responde só com eles | multi-inquilino; `captain_documents` é por conta |
| 2.C.5 | **Teto de consumo** por conta/plano (`captain_responses`) + medição de custo por atendimento antes de abrir para todos | ⚠️ lição do Gemini pré-pago secando em ~09/09 |
| 2.C.6 | Nó **"passar ao agente de IA"** dentro do construtor de fluxo | liga a F3 |
| 2.C.7 | Marca: o agente se apresenta como agente da empresa cliente (nome, tom), não como produto de terceiro | casa com F8.3 (whitelabel) |

⚠️ **Um ponto que é decisão sua, e não minha, porque é comercial/jurídico:** o Captain é recurso
de **edição paga** da plataforma base, e a instalação está na edição comunidade — o alerta
*"Unauthorized premium changes detected"* apareceu no painel em 31/08. Ligar e vender em cima
disso sem licença é risco de licenciamento, não risco técnico. Os caminhos honestos são: (a)
contratar a licença da edição paga, ou (b) usar o modelo próprio da F8.11 (que ajuda o atendente
e não exige recurso premium). **Vou preparar tudo o que é técnico (2.C.1 a 2.C.7) e deixar a
chave desligada até você dizer qual caminho.**

---

## ORDEM SUGERIDA

```
1º  F1.1  descobrir por que o fluxo não é construído hoje   ← mede antes de construir
2º  F1.3/1.4  respostas rápidas (backend pronto, só tela)   ← maior retorno por esforço
3º  F3.1  testador de fluxo                                  ← pedido explícito
4º  F2.2/2.3/2.4  isolamento por agente e por setor          ← é segurança, não tela
5º  F4  agendamento                                          ← construção do zero
6º  F3.2-3.8  nós que faltam
7º  F3.9/3.10  botões por canal e cobrança                   ⏳ dependem de terceiros
```

⚠️ **F2.2, F2.3 e F2.4 são regra de servidor.** Se forem feitas só na tela, o dado continua
exposto por API e o isolamento é aparência. Teste obrigatório: um agente pedindo a conversa de
outro **pela API** tem de receber recusa, não a conversa.

---

## FASE 6 — AUTOMAÇÃO POR CAIXA DE ENTRADA 🟢 (quase tudo pronto)
> Telas 14-17. O dono: *"em cada caixa de entrada (whatsapp, facebook, instagram e site) tem
> todas essas opções de configurações e automatização"*.

⚠️ **MEDIÇÃO QUE MUDA O TAMANHO DO TRABALHO:** o modelo `RagnabotAtendPolitica` já cobre
**quase tudo** o que essas telas mostram — e com escopo mais fino que o chat atual (a política
pode ser **por conexão E por setor**, via `escopo` + `cwInboxId` + `cwTeamId`; lá é só por
conexão). Já modelado e implementado no serviço:

```
inatividade:  ativa · minutos · conta(cliente|atendente) · ação · time de destino ·
              mensagem · aviso em N min + mensagem do aviso · conta fora do expediente
transbordo:   ativo · minutos · time · mensagem            ← é o "Mover para Fila" da tela
fluxos:       fluxoPrimeiroContatoId · fluxoPadraoId · fluxoForaExpedienteId
mensagens:    saudação · fora de expediente · intervalo · feriado · transferência p/ time ·
              transferência p/ agente · atendente indisponível · despedida de espera
outros:       encerrarAposForaExpediente · distribuição pausada (+ motivo, até quando, por quem)
tabelas:      Expediente · ExceçãoDeData · Turno · Relógio · Transferência
```

**Ou seja: falta a TELA, não o motor.**

| # | Item | Esforço |
|---|---|---|
| 6.1 | **Tela de configuração por caixa de entrada**, com as seções da imagem: Configurações · Automação Avançada de Tickets · Mensagens · Integrações | 🟢 só tela |
| 6.2 | Ligar os campos de mensagem à política que já existe, com as variáveis `{{firstName}}`, `{{ticket_id}}`, `{attendantName}` | 🟢 |
| 6.3 | Seletores de **Fluxo para Primeiro Contato** e **Fluxo ChatBot Padrão** (campos já existem no modelo) | 🟢 |
| 6.4 | **Cor da conexão na lista de tickets** | 🟡 campo novo |
| 6.5 | **"Digitando" e "Gravando"** (simular indicador antes de responder) | 🟡 campo novo + envio |
| 6.6 | **"Não receber mensagens por esta conexão"** (silenciar a caixa) | 🟡 campo novo |
| 6.7 | **Mover de "Atendendo" para "Aguardando"** por inatividade, e **fechar automático** o que está em Aguardando | 🟡 conferir se `inatividadeAcao` já cobre; se cobrir, é só tela |
| 6.8 | Token da conexão (exibir/regenerar) · importar mensagens do aparelho | 🟡 depende do canal |

📌 **O padrão que se repete neste plano:** Fases 1, 6 e parte da 3 são **telas para motor que já
existe**. É onde está o maior retorno por esforço — e é o que faz o produto parecer pronto,
porque hoje ele já faz coisas que ninguém consegue configurar.

---

## COMO ESTE PLANO É MANTIDO

**Ordem do dono (02/09/2026):** *"tudo que estou te passando vai adicionando ao plano"*.

Este documento é **vivo**. Toda tela, print ou pedido novo do dono entra aqui **na hora**, na fase
que couber — não numa conversa que se perde. Se não couber em nenhuma fase, abre-se fase nova.

### Regra de método — item 7 do dono
> *"o agente que você criou para investigar o chat atual deve ver novamente o que precisa ser
> construído... qualquer dúvida o agente deve consultar como é feito no atual chat"*

**O chat atual é a referência viva.** Diante de dúvida sobre COMO uma função deve se comportar
— e não sobre se deve existir — a resposta se busca lá, não no palpite:
- acesso: `chat001.ragnatela.com.br` · usuário `castro@ragnatela.com.br`
- levantamento anterior: `18-LEVANTAMENTO-CHAT-ATUAL.md` e `19-COMPARATIVO-E-BACKLOG-RAGNABOT.md`
- ⚠️ **copiar comportamento, não código.** A base do chat atual é de procedência não confirmada;
  o que se leva é a REGRA que o usuário já conhece, escrita por nós.

### Regra de medição — a que mais economizou trabalho aqui
⚠️ **Antes de planejar construir qualquer coisa, medir se já existe.** Neste levantamento,
respostas rápidas, automação por caixa e o motor de fluxo estavam TODOS construídos e sem tela.
Planejar sem medir teria feito reconstruir o que já roda.

### Onde cada coisa mora
```
32-PLANO-DE-EXECUCAO.md            plano original (funcionalidades do produto)
34-PLANO-PARIDADE-CHAT-ATUAL.md    ESTE — o que o chat atual tem e o Ragnabot ainda não
10-ETAPAS-RAGNABOT.md              mapa de etapas (o que está pronto)
29-AUTOMACOES-DO-ATENDIMENTO.md    especificação da automação por conexão/setor
28-MOTOR-DE-FLUXO-ESPECIFICACAO.md especificação do motor de fluxo
```

---

## FASE 7 — LISTA DE FLUXOS E CONFIGURAÇÕES DO FLUXO 🟢🟡
> Telas 18-20. Complementa a F3 (que trata dos NÓS); esta trata do fluxo como objeto.

⚠️ **MEDIÇÃO:** de novo, boa parte do motor está pronta —
- `RagnabotFluxo` já tem **`palavrasChave`**, `entrada`, `cwInboxId`, e as travas de execução
  (`passosPorEvento`, `visitasPorNoMax`, `ttlExecucaoSegundos`, `retomada`)
- `RagnabotFluxoNoMetricaDia` já grava **`apresentados` · `respondidos` · `expirados` ·
  `invalidos` · `porSaida`** — que é exatamente o dado de "Menus Enviados / Clicados / CTR"
  e o CTR **por saída** que aparece em cada opção no canvas

**Ou seja: o número existe e ninguém vê.**

### 7.1 — Tela de lista de fluxos (imagem 18)
| # | Item | Esforço |
|---|---|---|
| 7.1.1 | Tabela com **Nome · Menus Enviados · Menus Clicados · CTR** (dado já gravado) | 🟢 só tela |
| 7.1.2 | CTR com cor por faixa (verde alto, laranja baixo) — leitura em um relance | 🟢 |
| 7.1.3 | Ações por fluxo: **editar · excluir · compartilhar · duplicar · configurações** | 🟡 duplicar e compartilhar são novos |
| 7.1.4 | **Criar Fluxo · Importar Fluxo · Integrações** no topo + busca + paginação | 🟡 importar/exportar é novo |

### 7.2 — Configurações do fluxo (imagens 19-20)
| # | Item | Esforço |
|---|---|---|
| 7.2.1 | **Horário de expediente POR FLUXO**: dia a dia, início/fim, "usar intervalo", mensagem fora de expediente, "fechar atendimento após enviar" | 🟡 hoje o expediente é por conexão/setor (`RagnabotAtendExpediente`), não por fluxo — decidir se herda ou sobrescreve |
| 7.2.2 | **Palavras-chave** com **tipo de correspondência** (igual/contém/começa com) e **sensível a maiúsculas** | 🟡 o campo `palavrasChave` existe; falta o tipo de correspondência |
| 7.2.3 | **Limite de reenvio do menu** (quantas vezes o mesmo menu pode ser reapresentado) | 🟡 campo novo — evita o robô repetindo menu em laço |
| 7.2.4 | **Modo de teste: ativar o fluxo apenas para um número** | 🔴 **alto valor** — é o que permite publicar um fluxo novo sem expor cliente. Casa com o testador da F3.1, e é mais seguro: testa no WhatsApp de verdade, sem simulação |

📌 **7.2.4 + 3.1 juntos resolvem o item 10 do dono por dois caminhos complementares:**
o **testador** simula dentro do editor (rápido, sem custo, sem risco); o **modo de teste** roda
o fluxo real num número só (fiel, prova o canal de ponta a ponta). Os dois valem; nenhum
substitui o outro.

---

## FASE 8 — MENU CONFIGURAÇÕES 🟡
> Telas 21-25. **O dono avisou que virão mais telas** — esta fase cresce.
> Abas: `Opções · Variáveis Personalizadas · Horários · Whitelabel · Empresas · Planos · Ajuda · WHATSAPP API`

### ⛔ REGRA DE VISIBILIDADE — ordem do dono (02/09/2026)
> *"colunas whitelabel, empresas e planos só aparecem na conta que vende o SaaS, no caso na
> Ragnatela; na conta de cliente elas não aparecem"*

**Whitelabel · Empresas · Planos são abas do OPERADOR DO SaaS, não do cliente.**

⚠️ Isto é **isolamento**, não interface. A aba escondida no menu, com a rota respondendo, é
falha de segurança: o cliente descobre a URL e vê a base comercial de todos os outros — plano,
valor, vencimento, e-mail. **A trava é no servidor**, e o teste de aceite é: um usuário de conta
cliente chamando `/configuracoes/empresas` **pela API** recebe recusa, não a lista.
📌 Mesmo princípio dos itens 2.2, 2.3 e 2.4. É o mesmo defeito, em lugar diferente.

### 8.1 — Aba "Opções" (tela 21)
Painéis: `Atendimento · Notificações · Agenda · Aparência · Mensagens · Integrações ·
Inteligência artificial · Sistema`. Do painel **Atendimento**:

| # | Ajuste | Nota |
|---|---|---|
| 8.1.1 | Enviar saudação automaticamente · Enviar mensagem ao transferir | casa com as msgs da F6 |
| 8.1.2 | **Exibir histórico como: "Por setor"** | 📌 **é o item 5 do dono, e aqui vira AJUSTE, não regra fixa** — o cliente escolhe entre global e por setor |
| 8.1.3 | Ignorar mensagens de grupo · Aceitar ligações pelo WhatsApp · Aceitar mensagens de áudio | |
| 8.1.4 | **Exigir escolha de setor ao aceitar** o ticket | |
| 8.1.5 | **Atendente pode enviar assinatura** | casa com "Assinar Mensagem" da F2.6 |
| 8.1.6 | Pausar atendimento (mostrar/ocultar o botão) | |
| 8.1.7 | **Carteira de clientes: por contato × por atendimento** — *"por contato: um responsável para todo o cliente; por atendimento: cada ticket pode ter dono diferente"* | 📌 decisão de modelo, não de tela: muda a quem pertence o histórico |

### 8.2 — Horários (tela 22)
Expediente **global** por dia da semana, com abertura/fechamento e **almoço opcional**
(início/retorno da pausa). ⚠️ Já existe `RagnabotAtendExpediente` (por conexão/setor) — decidir a
**hierarquia**: global → conexão → setor → fluxo. Sem hierarquia definida, quatro lugares
configuram a mesma coisa e ninguém sabe qual vale.

### 8.3 — Whitelabel (telas 23-24) — só operador do SaaS
| # | Item |
|---|---|
| 8.3.1 | **Identidade**: nome do sistema · número de suporte · mostrar link de cadastro |
| 8.3.2 | **Cores** modo claro E escuro: primária · ícones · app bar · sidebar |
| 8.3.3 | **Fundos** da página e dos cartões, claro e escuro |
| 8.3.4 | **Logos**: logotipo (900×300) · logo de login (900×300) · banner (1280×720), com recorte |
| 8.3.5 | Template da tela de login · fundo do login (URL + cor) |
| 8.3.6 | URLs de Política de Privacidade e Termos de Uso |
| 8.3.7 | **Mensagens do sistema**: boas-vindas WhatsApp · boas-vindas e-mail · redefinição de senha (`{tokenSenha}`) com pré-visualização de HTML · mensagem OTP |
📌 Já temos identidade visual própria e SMTP próprio; falta a TELA que deixa o operador mudar
sem código — que é o que torna o produto revendável.

### 8.4 — Empresas (tela 25) — só operador do SaaS
Cartões com nome · e-mail · telefone · **plano · valor · vencimento · último acesso** · status
ativo · editar/excluir · **Nova Empresa** · busca e filtro por status.
⚠️ Já existe `Empresas.jsx` + `EmpresaFormulario.jsx` + `ragnabot-tenant.service.js`. **Comparar
campo a campo** com esta tela antes de construir: provavelmente é completar, não criar.

### 8.6 — Painel "Notificações" (tela 26)
| # | Item | Nota |
|---|---|---|
| 8.6.1 | **Permitir avaliações** do atendimento (CSAT) | 🔴 **conceito NOVO no plano** — não existe nada no Ragnabot |
| 8.6.2 | **Exibir avaliações** direto na lista de tickets | depende de 8.6.1 |
| 8.6.3 | Notificações e alerta sonoro de conversas em **grupo** | |
📌 Avaliação de atendimento puxa modelo próprio (nota, comentário, quando perguntar, o que fazer
com nota baixa) e é o insumo do futuro painel de SLA. Não é ajuste, é funcionalidade.

### 8.7 — Painel "Agenda" (tela 27) — ✅ RESPONDE A PERGUNTA DA 8.2
```
Agendamento de Expediente → Tipo de gerenciamento → "Por Empresa"
```
📌 **A hierarquia do expediente não é fixa: é ESCOLHA do cliente.** Ele decide se o expediente é
gerido por empresa, por setor ou por conexão — e isso resolve o problema dos "quatro lugares
configurando a mesma coisa" que eu tinha levantado. O ajuste diz **quem manda**; os outros níveis
ficam inertes. Implementar assim, e não com precedência fixa.

### 8.8 — Painel "Aparência" (tela 28)
| # | Item | Nota |
|---|---|---|
| 8.8.1 | **Exibir tickets fechados no Kanban** | 🔴 **Kanban é conceito NOVO** — aparece aqui e no nó "Tag Kanban" da F3.7 |
| 8.8.2 | **Modo de exibição das tags**: bolinha colorida × etiqueta com texto | casa com a F2.7 |

### 8.9 — Painel "Mensagens" (tela 29)
Mensagens automáticas do sistema, além das da conexão (F6):
chamadas recusadas · áudio não aceito · **ao aceitar o ticket** · **transferência de setor**.
⚠️ São **outro nível** das mensagens da F6.2 (que são por conexão). Definir a precedência junto
com a 8.7, senão duas telas escrevem a mesma mensagem.

### 8.10 — Painel "Integrações" (tela 30)
| Integração | Situação no Ragnabot |
|---|---|
| **Servidor SMTP** | ✅ já temos (`smtp.service.js`) — falta a TELA |
| ConnectAi (Facebook, Instagram) · Integração OficialAPI | ⏳ casa com a Análise do App da Meta |
| **Efí Bank** (Client_Id, Client_Secret, certificado `.p12`) | ✅ provedor único decidido em 02/09 — ver doc 36. PagHiper/Asaas/Atlaz **não entram** |
| **HubSoft** (parâmetros de autenticação) | 🔴 novo — sistema de gestão de provedor. ⚠️ **perguntar ao dono se é usado**; integração com terceiro que ninguém usa é dívida de manutenção de graça |

### 8.11 — Painel "Inteligência artificial" (tela 31)
```
Modelo de IA (global) → Provedor (Openai) → Modelo (gpt-4o-mini) → Chave API
"usados em resumos, sugestão de resposta e demais recursos de IA"
```
📌 **NÃO é o Captain.** São coisas diferentes e vale não confundir:
- **Captain** (plataforma base) = agente de IA que **atende o cliente** sozinho
- **este** = IA que **ajuda o ATENDENTE** — resume o atendimento, sugere resposta

O segundo é muito mais barato e menos arriscado: erra para o lado de "sugestão ruim que o humano
descarta", não de "resposta errada enviada ao cliente". Casa com o "Resumir Atendimento" que
aparece no menu da conversa (F2.6).

| # | Item | Nota |
|---|---|---|
| 8.11.1 | Provedor de IA **trocável** (catálogo), não amarrado a um fornecedor | 📌 bom desenho: hoje OpenAI, amanhã outro, sem migração |
| 8.11.2 | Modelo e chave configuráveis por instalação | |
| 8.11.3 | **Resumir atendimento** e **sugerir resposta** ao agente | 🟡 funcionalidade nova |
⚠️ Custo por uso, cobrado por token. Mesma disciplina do Gemini: medir consumo por atendimento
ANTES de ligar para todos, e decidir quem paga (a Ragnatela ou o cliente, por plano).

### 8.12 — Painel "Sistema" (tela 32) — só super admin
| # | Item | Nota |
|---|---|---|
| 8.12.1 | Correção ortográfica automática do que o agente digita | |
| 8.12.2 | **Senha forte obrigatória** (mín. 8, maiúscula, minúscula, número, especial) | ✅ o Ragnabot já tem login e 2FA próprios — conferir se já cobre |
| 8.12.3 | **Permitir múltiplas sessões** — se desligado, entrar noutro aparelho derruba a sessão anterior | 📌 o NOC já faz isso no portal; reaproveitar a regra |
| 8.12.4 | **Dias de teste** (período de avaliação da empresa nova) | casa com `ragnabot-tenant.service.js` e cobrança |

### 8.13 — Aba "WHATSAPP API" (tela 33) — só operador do SaaS
```
api whats · Whatsmeow · https://chatapi001.ragnatela.com.br
Instâncias Totais: 200 · Conectadas: 8 · Ativa
```
📌 **Esta é a camada que torna o SaaS viável.** O operador cadastra **provedores de API de
WhatsApp** com cota de instâncias, e as empresas clientes consomem dessa cota — em vez de cada
cliente precisar do próprio aplicativo na Meta e passar por análise. É o que explica "8 de 200
online".

| # | Item | Nota |
|---|---|---|
| 8.13.1 | Cadastro de provedores de API (nome, tipo, URL, chave) | 🔴 novo |
| 8.13.2 | Contador de **instâncias totais × conectadas**, com estado | 🔴 novo |
| 8.13.3 | Vincular empresa cliente → instância do provedor | 🔴 **decisão de arquitetura do SaaS** |
⚠️ Isto muda a resposta que dei ao dono sobre "cada cliente precisa da própria conta na Meta".
Pelo caminho **não-oficial** (Whatsmeow), não precisa. Pelo **oficial** (Cloud API), precisa.
São dois modelos de negócio diferentes, com riscos diferentes — **decisão do dono**, e ela
precisa ser tomada antes de F8.13 virar código.


### 8.5 — Planos · Ajuda · WHATSAPP API · Variáveis Personalizadas
⏳ **Telas ainda não enviadas.** `ragnabot-cobranca.service.js` já existe e cobre planos e
assinatura — medir antes de planejar, como nas outras fases.

---

## FASE 9 — CONEXÃO DE CANAIS: O MODELO DE INTERMEDIÁRIO 🔴 (telas 34-40)

> Enviado pelo dono em 02/09/2026. **Esta é a fase mais importante do plano inteiro**, porque
> não é uma tela faltando: é uma **decisão de arquitetura e de negócio** que muda como toda
> empresa cliente entra na plataforma.

### 9.0 — O que as telas revelam (leitura, não suposição)

O chat atual **não fala com a Meta**. Ele delega para **dois intermediários externos**, cada um
com portal próprio, login próprio e credencial própria:

| Intermediário | Portal | O que conecta | Como volta ao CRM |
|---|---|---|---|
| **ConnectAi** (`apis.devconnectai.com.br`) | externo, login próprio | Facebook, Instagram e demais | Conexões → **ConnectAi** sincroniza os canais |
| **OficialAPI** | externo, login próprio (tem menu **Revenda**) | WhatsApp business, WhatsApp em nuvem, Instagram Direct, Facebook + Messenger, WebChat, Telegram | Conexões → **OficialAPI** → o número aparece |

O fluxo que o dono descreveu, na ordem: **conectar os DOIS tipos de WhatsApp no portal
OficialAPI** (business e em nuvem) → voltar ao CRM → **Conexões → Nova Conexão → OficialAPI** →
o número aparece para importar.

E o próprio CRM admite a limitação na tela 34: *"em nova aba o login das redes sociais funciona
corretamente (iframe costuma ser bloqueado)"* — ou seja, o cliente **sai da plataforma** para
conectar o canal dele, faz login num terceiro, e volta. É uma costura, não um produto.

### 9.1 — Onde o Ragnabot já está À FRENTE (medido)

| | Chat atual | Ragnabot hoje |
|---|---|---|
| Facebook / Instagram | via ConnectAi (terceiro) | ✅ **direto na Meta**, 4 canais no ar com tráfego real |
| WhatsApp Cloud | via OficialAPI (terceiro) | ✅ direto (WABA Cloud API própria) |
| Site | via ConnectAi | ✅ próprio |
| Mensagens do cliente transitam por terceiro | **sim** | **não** |

📌 **Não copiar esta parte.** Reproduzir ConnectAi/OficialAPI seria trocar uma integração
própria e funcionando por dependência de terceiro — com a mensagem do cliente passando pela
infra de outra empresa (implicação de LGPD: dado pessoal de paciente/cliente em operador não
contratado) e com o negócio pendurado no preço e na disponibilidade deles.

### 9.2 — Onde ele está À FRENTE de NÓS (o que realmente falta)

O que o intermediário resolve e nós ainda não resolvemos é **a entrada da empresa cliente**:
hoje só a Ragnatela tem canal ligado. Falta o caminho em que **o cliente liga o canal DELE
sozinho**.

| # | Item | Estado | Nota |
|---|---|---|---|
| 9.2.1 | **Embedded Signup da Meta** — o cliente clica um botão no Ragnabot, faz login na Meta numa janela da própria Meta, escolhe a página/WABA dele e volta conectado | 🔴 novo | é a resposta CERTA ao problema que o ConnectAi resolve errado; **depende da Análise do App** |
| 9.2.2 | **Camada de provedor de canal** — abstração `provedor` no cadastro de conexão (`meta_direto` \| `whatsmeow` \| `terceiro`) | 🔴 novo | não amarrar o motor a um caminho só; é o que permite decidir depois sem reescrever |
| 9.2.3 | **Tela de Conexões** com cartão por canal: ID, nome, número, última atualização, sinal de estado, desconectar/editar/excluir | 🟡 dados já existem | paridade visual da tela 40 |
| 9.2.4 | **Transferir tickets entre conexões** (botão da tela 40) | 🔴 novo | necessário ao trocar de número sem perder histórico |
| 9.2.5 | **Reiniciar conexões** | 🟡 | operação de suporte; hoje só no `kubectl` |
| 9.2.6 | **Logs de requisição por canal** + relatório (tela 37) | 🟡 | o motor já registra; falta a tela |
| 9.2.7 | **Cota de canais por empresa** (Limite × Ativos × Uso %) | 🔴 novo | casa com F8.13 e com `ragnabot-cobranca.service.js` |

### 9.3 — Templates (HSM) — 🔴 LACUNA REAL, independente de intermediário

As abas **Templates** (ConnectAI) e os menus **Templates OficialAPI** / **Posts OficialAPI** não
são enfeite: pela Cloud API oficial, **fora da janela de 24h só se envia mensagem por modelo
aprovado pela Meta**. Sem gestão de modelo, campanha e retomada de conversa não existem.

| # | Item | Nota |
|---|---|---|
| 9.3.1 | Cadastro de modelo (nome, idioma, categoria, corpo, variáveis, botões) | |
| 9.3.2 | Submeter à Meta e **acompanhar o estado** (pendente/aprovado/rejeitado + motivo) | via Graph API `message_templates` |
| 9.3.3 | Enviar por modelo, preenchendo as variáveis | liga direto na F4 (agendamento) e nas campanhas |
| 9.3.4 | Modelo por empresa cliente (cada WABA tem os seus) | multi-inquilino desde o início |
⚠️ Isto vale **mesmo que o dono escolha o caminho do intermediário** — a exigência é da Meta,
não do fornecedor.

### 9.4 — API pública e webhook de saída (tela 36) — 🟡

O OficialAPI expõe ao cliente: **API Key + Secret** (com botão *Regenerar credenciais*) e
**webhooks de saída** com `Authorization: Bearer` e assinatura `X-Hub-Signature-256:
sha256=<hex>` (HMAC-SHA256 do corpo, com o mesmo token como segredo).

📌 Padrão idêntico ao da Meta — então **o mesmo verificador de assinatura que já escrevemos para
receber da Meta serve para assinar o que sai**. Reaproveitar, não reescrever.

| # | Item | Nota |
|---|---|---|
| 9.4.1 | Credencial de API por empresa (chave + segredo), com regeneração | casa com o *botão de gerar token* que o dono já pediu |
| 9.4.2 | Cadastro de webhooks de saída por empresa (N URLs) | |
| 9.4.3 | Assinatura HMAC-SHA256 no corpo + `Bearer` no cabeçalho | reusar `verificarAssinaturaMeta` |
| 9.4.4 | Reentrega com recuo exponencial + registro de falha | sem isto, webhook que cai perde evento em silêncio |

### 9.5 — Canais que eles têm e nós não

Da lista da tela 38-39: **Telegram Bot** e — abaixo da dobra, ainda não visto — provavelmente
mais. 🟢 baixa prioridade; Telegram é barato de somar (bot API simples, sem análise de
aplicativo), mas não é o que trava cliente nenhum hoje.

### ⚖️ DECISÃO DO DONO — precisa vir antes de 9.2 virar código

**Como a empresa cliente liga o WhatsApp dela?** Três caminhos, e dá para ter mais de um:

| | Caminho | A favor | Contra |
|---|---|---|---|
| **A** | **Cloud API oficial, cliente traz a conta dele** (Embedded Signup) | legítimo, estável, sem risco de banimento, cliente é dono do número | exige nossa Análise do App aprovada; cliente precisa de conta comercial verificada |
| **B** | **Whatsmeow** (nosso, 200 instâncias — F8.13) | cliente entra em minutos, só lê o QR; sem Meta no caminho | **não é oficial**; número pode ser banido pela Meta; nós carregamos o risco |
| **C** | **Intermediário** (ConnectAi/OficialAPI) | zero desenvolvimento | mensagem do cliente passa por terceiro (LGPD), custo por instância, dependência |

**Recomendação, e o motivo:** **A como produto, B como porta de entrada, C nunca.** O A é o que
sustenta contrato com hospital e provedor — que é o cliente que a Ragnatela tem. O B serve para
o cliente pequeno experimentar no mesmo dia, desde que o **risco esteja escrito no contrato**.
O C entrega o dado do nosso cliente para uma empresa que também vende a mesma coisa.

*Não bloqueia o plano:* 9.2.2 (camada de provedor) e toda a 9.3/9.4 são iguais nos três
caminhos — dá para construir agora e decidir depois.

---

## FASE 10 — PAINEL ÚNICO 🔴 (pré-requisito de adoção, descoberto na F1.1)

> Não estava previsto. Nasceu da medição da F1.1: o dono não usa o que já construímos porque o
> que construímos mora fora do painel dele.

O chat atual tem **um** menu lateral com tudo. O Ragnabot hoje tem **dois mundos**:

```
   painel do fornecedor (Chatwoot)              aplicativo do motor (nosso)
   ├─ conversas, contatos, relatórios           ├─ construtor de fluxo
   └─ o dono vive aqui                          └─ entrada própria em /motor-api/
                    ✗ sem link, sem menu, sem sessão compartilhada ✗
```

| # | Item | Nota |
|---|---|---|
| 10.1 | **Roteador** na interface do motor (hoje: página única) | 🔴 bloqueia toda tela nova |
| 10.2 | **Casca**: menu lateral + cabeçalho + rodapé com empresa e versão | espelha o menu do chat atual |
| 10.3 | **Sessão única** painel ↔ motor (quem entrou num não digita no outro) | 🔴 |
| 10.4 | **Entrada do motor a partir do painel** (item de menu) | 🔴 ganho imediato, custo baixo |
| 10.5 | Decidir o destino: painel do fornecedor **embutido** na nossa casca, ou nossa casca assumindo tela a tela até o fornecedor sair do caminho | ⚖️ **decisão de rumo** — mas ela **não bloqueia** 10.1-10.4 |
⛔ **Nunca injetar script no painel do fornecedor** para simular unificação: quebrou o painel duas
vezes em 31/08. A casca é nossa e serve as nossas telas; o painel do fornecedor entra por moldura,
não por remendo no JavaScript dele.
