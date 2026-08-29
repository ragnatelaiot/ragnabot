# 📘 MANUAL DO RAGNABOT — como usar cada função, menu a menu

> **Para quem é este manual:** para quem vai *usar* a plataforma — atendente, supervisor,
> administrador da empresa. Não é preciso saber nada de tecnologia para acompanhar.
> **Endereço da plataforma:** `https://chat002.ragnatela.com.br`
> **Versão de referência:** Ragnabot (base Chatwoot 4.17.1) · manual escrito em 28/08/2026 pelo NOC.
> **Destino final:** este texto foi escrito já no formato da futura **Central de Ajuda embutida** —
> cada capítulo vira um artigo, cada seção `###` vira um tópico. Ver o capítulo 17.

> ⚠️ **LEIA ANTES DE COMEÇAR — a interface que você vê hoje não é a deste manual, ainda.**
> A plataforma está no ar sobre a base **Chatwoot 4.17.1**, revestida com o **tema visual
> Ragnabot** (cores, tipografia e tela de entrada). A **interface própria do Ragnabot** — o
> trilho de menus *Caixa · Painel · Contatos · Campanhas · Relatórios · Ajustes*, os cartões de
> canal, o Painel de indicadores — **está em construção** (Etapa 9 do mapa de etapas). Até ela
> entrar no ar, os nomes na tela são os da base traduzida para o português.
> **As funções descritas aqui existem**; o que muda é o **nome do menu** e, em alguns pontos, o
> caminho até ele. A tabela **0.3** faz a conversão, nome por nome. O que estiver marcado com
> 🧭 é tela ou botão da interface nova e **ainda não aparece** para você.

---

## 0. Como ler este manual

O manual segue **a ordem dos menus**. Se você está com uma dúvida na frente do computador,
procure aqui o nome que está escrito na tela e vá direto ao capítulo — e, se não achar o nome,
passe pela tabela **0.3**, que converte o nome da tela de hoje para o nome usado aqui.

Cada capítulo tem sempre as mesmas quatro partes:

| Parte | O que responde |
|---|---|
| **Para que serve** | Por que essa tela existe e quando você precisa dela |
| **Como usar, passo a passo** | A sequência exata de cliques |
| **O que cada campo significa** | Campo por campo, em português claro |
| **Erros comuns e o que fazer** | O que costuma dar errado e a saída |

### 0.1 Sinais usados no texto

- **➜** indica um caminho de menu. Exemplo: *Configurações ➜ Canais ➜ Conectar canal*.
- 💡 é uma dica que economiza tempo.
- ⚠️ é um aviso: se ignorar, alguém do outro lado sente o efeito.
- 🔒 marca o que **só o administrador** enxerga.
- ⏳ marca o que **ainda não está disponível** e depende de uma etapa em andamento. Está no
  manual de propósito, para ninguém procurar o que não existe. A lista completa está no capítulo 15.
- 🧭 marca **nome, tela ou botão da interface nova do Ragnabot**, que ainda não foi publicada.
  A função existe hoje, com outro nome ou em outro caminho — a tabela 0.3 mostra onde.

### 0.2 Mapa de nomes — o nosso e o de origem

O Ragnabot é construído sobre uma base internacional chamada **Chatwoot**. Nós traduzimos e
renomeamos tudo para o português. Em alguns lugares (documentação de fora, telas ainda não
traduzidas, suporte técnico) você pode esbarrar no nome original. Esta tabela liga os dois:

| Nome no Ragnabot | Nome de origem (inglês) | O que é, em uma frase |
|---|---|---|
| Caixa de entrada | *Conversations* | A lista de conversas em andamento |
| Conversa | *Conversation* | Todo o histórico de mensagens com uma pessoa em um canal |
| Canal / Conexão | *Inbox* | Uma porta de entrada: um número de WhatsApp, uma página, um e-mail |
| Contato | *Contact* | A pessoa do outro lado, com telefone, e-mail e histórico |
| Agente / Atendente | *Agent* | Quem responde as conversas |
| Time | *Team* | Um grupo de atendentes que recebe conversas em conjunto |
| Fila | — | Como chamamos um Time quando ele é usado para distribuir conversas |
| Etiqueta | *Label* | Uma marca colorida para classificar a conversa |
| Resposta rápida | *Canned response* | Um texto pronto, chamado por um atalho |
| Macro | *Macro* | Uma sequência de ações aplicada com um clique |
| Automação | *Automation rule* | Uma regra do tipo "quando acontecer X, faça Y" |
| Campo personalizado | *Custom attribute* | Uma informação sua, criada por você (ex.: "nº do contrato") |
| Painel | *Dashboard / Reports overview* | Os números do atendimento em tempo real |
| Central de ajuda | *Help Center / Portal* | O site de artigos de autoatendimento |
| Satisfação (CSAT) | *CSAT survey* | A nota que o cliente dá ao fim do atendimento |
| Prazo (SLA) | *SLA policy* | O tempo máximo combinado para responder e resolver |

💡 Sempre que um termo em inglês aparecer na tela, ele está explicado no **Glossário**
(capítulo 16).

### 0.3 A tela de hoje × os nomes deste manual 🧭

Enquanto a interface própria do Ragnabot não entra no ar, use esta tabela para achar na tela o
que o manual chama de outro jeito:

| Neste manual | Na tela de hoje | Observação |
|---|---|---|
| **Caixa** / Caixa de entrada (cap. 3) | **Conversas** | É a mesma tela: lista de conversas, conversa aberta e dados do contato |
| **Painel** (cap. 4) | **Relatórios ➜ Visão geral** | O menu *Painel* separado, com os seis indicadores e os nove submenus, é da interface nova 🧭 |
| **Ajustes** / Configurações (cap. 9) | **Configurações** | Igual |
| **Canal** / Conexão | **Caixas de entrada** (*Inboxes*) | ⚠️ **Atenção:** na tela de hoje, "Caixa de entrada" significa **canal**, e não a lista de conversas. É a maior chance de confusão entre o manual e a tela |
| **Fila** | **Equipe** (*Team*) | São a mesma coisa (cap. 9.3) |
| **Central de ajuda** (cap. 8) | **Central de Ajuda** | Igual |
| **Adiar** | **Adiar** / *Soneca* | Igual — deixa a conversa como Pendente |
| **Etiqueta** | **Etiqueta** / *Rótulo* | Igual |
| Cartões de canal com **Testar**, **Testar todos** e *última sincronização* | não existem hoje | São da interface nova 🧭. Hoje o teste do canal é feito abrindo a caixa de entrada e conferindo o erro que ela mostra |

💡 Quando a interface nova entrar no ar, esta tabela sai do manual e o capítulo 15 perde a linha
correspondente. Enquanto ela estiver aqui, **é ela que vale** em caso de divergência com a tela.

---

## 1. Primeiros passos — do login ao primeiro atendimento

Este capítulo é o caminho completo de quem nunca entrou. Leva cerca de dez minutos.

### 1.1 Passo 1 — Entrar na plataforma

1. Abra o navegador (Chrome, Edge, Firefox ou Safari) e vá para
   **`https://chat002.ragnatela.com.br`**.
2. Digite o **e-mail** que a sua empresa cadastrou e a **senha** que você recebeu.
3. Clique em **Entrar**.

**Na primeira vez**, você recebe um e-mail com um convite. Clique no botão do e-mail, **crie a
sua própria senha** e só depois faça o login normal. O convite tem prazo — se expirou, peça ao
administrador da sua empresa para reenviar.

⏳ **Hoje o envio de e-mail pela plataforma ainda não está ligado** (o servidor de envio, item 3.1
do mapa de etapas). Enquanto isso, **o convite e a senha inicial são entregues pela Ragnatela por
um canal combinado**, e a recuperação de senha ("Esqueci minha senha") **não envia e-mail** — peça
a redefinição ao administrador da sua empresa ou ao suporte da Ragnatela.

💡 Marque o endereço como favorito no navegador. E deixe a aba aberta durante o expediente: é
por ela que chegam os avisos sonoros de mensagem nova.

⚠️ **Nunca compartilhe o seu usuário com um colega.** Cada resposta fica registrada com o nome
de quem a enviou; com usuário emprestado, o histórico deixa de servir para qualquer coisa — e a
plataforma registra tudo, inclusive quem leu o quê.

### 1.2 Passo 2 — Conferir o seu nome e a sua foto

Clique no seu nome, no **pé do menu lateral** (canto inferior esquerdo) ➜ **Perfil**.

- **Nome de exibição:** é o nome que aparece para os colegas. Use nome e sobrenome.
- **Foto:** ajuda a equipe a se achar na lista. Opcional.
- **Assinatura de mensagem:** um texto curto que pode ser acrescentado automaticamente ao fim
  das suas respostas (por exemplo, *"— Rafael, Pós-venda"*). Cuidado ao usar em WhatsApp: a
  assinatura conta caracteres e aparece em toda mensagem.

### 1.3 Passo 3 — Ficar disponível

No pé do menu lateral, ao lado do seu nome, há um **ponto colorido**. Ele é a sua
disponibilidade:

| Cor | Estado | O que significa na prática |
|---|---|---|
| 🟢 Verde | **Disponível** | Você recebe conversas novas na distribuição automática |
| 🟡 Amarelo | **Ocupado** | Você continua atendendo o que já tem, mas não recebe conversa nova |
| ⚪ Cinza | **Ausente / offline** | Você não recebe nada; a distribuição pula você |

⚠️ Esquecer o estado em **Disponível** ao sair para o almoço é a causa número um de conversa
parada sem resposta. A conversa é entregue a você, e ninguém mais a vê como "não atribuída".

### 1.4 Passo 4 — Encontrar a sua primeira conversa

1. Clique em **Caixa** (primeiro item do menu lateral).
2. No painel de filtros, clique em **Atribuídas a mim** — são as conversas que já são suas.
3. Se estiver vazio, clique em **Não atribuídas** — são as que estão esperando alguém pegar.
4. Clique em uma conversa da lista. Ela abre ao centro.

### 1.5 Passo 5 — Responder

1. Confira, na aba de escrita (abaixo da conversa), se está selecionado **Responder** — e não
   **Nota interna**. Elas têm cores diferentes de propósito.
2. Escreva a mensagem.
3. Pressione **Enter** para enviar (ou **Ctrl + Enter**, conforme a sua preferência de perfil).

### 1.6 Passo 6 — Encerrar

Quando o assunto acabar, clique em **Resolver**, no alto à direita da conversa.

Resolver **não apaga nada**: a conversa sai da sua lista de abertas e passa para
**Resolvidas**. Se a pessoa escrever de novo, a mesma conversa **reabre sozinha** e volta
para a fila — o histórico continua inteiro.

### 1.7 Roteiro de dez minutos para o administrador que está começando

Se você é quem vai montar a operação, esta é a ordem que funciona:

1. **Configurações ➜ Dados da empresa** — nome, fuso horário e idioma.
2. **Configurações ➜ Agentes** — convide a equipe.
3. **Configurações ➜ Times** — crie ao menos *Comercial* e *Suporte*.
4. **Configurações ➜ Canais** — conecte o primeiro canal (o **Chat do site** é o mais rápido).
5. **Configurações ➜ Etiquetas** — crie de três a cinco etiquetas, não mais que isso no começo.
6. **Configurações ➜ Respostas rápidas** — cadastre as cinco frases que a equipe mais repete.
7. **Configurações ➜ Automação** — uma regra só: encaminhar o canal novo para o time certo.
8. Faça um **teste real**: mande uma mensagem pelo canal, veja chegar, responda e resolva.

⚠️ Não configure automação antes de existir conversa passando pelo canal. Regra criada sobre
suposição quase sempre encaminha para o lugar errado — e você só descobre com o cliente esperando.

---

## 2. Papéis — o que cada pessoa enxerga

O Ragnabot tem **três níveis de acesso**. O que muda entre eles não é só o botão disponível: é o
menu inteiro.

### 2.1 Atendente (*Agent*)

Quem responde. Vê:

- **Caixa de entrada** — as conversas atribuídas a ele, as menções, as não atribuídas e as
  resolvidas dos canais a que tem acesso.
- **Contatos** — para consultar histórico e corrigir dados.
- **O próprio perfil** — nome, foto, senha, notificações, disponibilidade.

**Não vê:** Painel, Relatórios, Campanhas, Configurações. Também **não vê** o desempenho dos
colegas — isso é proposital, não é limitação técnica.

### 2.2 Administrador da empresa (*Administrator*)

Quem responde por uma conta. Vê **tudo do atendente**, e mais:

- **Painel** com os indicadores do dia.
- **Relatórios** completos, incluindo desempenho por atendente.
- **Campanhas**.
- **Central de ajuda**.
- **Configurações** inteiras: agentes, times, canais, etiquetas, respostas rápidas, automações,
  horário de atendimento, pesquisa de satisfação.

⚠️ O administrador enxerga **as conversas da empresa dele, e apenas dela**. A separação entre
empresas é feita pela própria base da plataforma, que trata cada empresa como uma conta
independente. **Isolamento entre empresas é requisito de projeto do Ragnabot** — foi justamente a
falha do sistema antigo que motivou a troca — e a sua **validação formal** (teste dirigido de
isolamento entre contas) é um item ainda em aberto no plano (item 3.5 do mapa de etapas). Até esse
teste sair, a afirmação correta é esta: *a plataforma separa por conta e não conhecemos caminho de
vazamento; a prova documentada ainda será feita.*

### 2.3 Gestor da Ragnatela (*SuperAdmin* da instalação)

É a equipe da Ragnatela. Além de tudo o que o administrador vê **dentro de cada conta a que for
adicionado**, tem acesso a um console separado de instalação, onde pode:

- criar e desativar **empresas (contas)**;
- criar usuários e redefinir acessos;
- ver a saúde técnica da plataforma;
- acompanhar o cluster pelo **NOC** (menu do grupo RAGNATELA ➜ RAGNABOT).

⚠️ **Regra da casa:** o gestor da Ragnatela entra na conta de um cliente para **resolver um
chamado do cliente**, e o acesso fica registrado. Não é uma janela de leitura livre.

### 2.4 Tabela rápida de permissões

| Função | Atendente | Administrador | Gestor Ragnatela |
|---|:---:|:---:|:---:|
| Responder conversas | ✅ | ✅ | ✅ |
| Ver conversas de outros atendentes | conforme o canal | ✅ | ✅ |
| Atribuir conversa a um colega | ✅ | ✅ | ✅ |
| Criar e editar contatos | ✅ | ✅ | ✅ |
| Exportar contatos | ❌ | ✅ | ✅ |
| Ver o Painel e os Relatórios | ❌ | ✅ | ✅ |
| Criar campanhas | ❌ | ✅ | ✅ |
| Conectar ou desconectar canais | ❌ | ✅ | ✅ |
| Convidar e remover agentes | ❌ | ✅ | ✅ |
| Criar automações e etiquetas | ❌ | ✅ | ✅ |
| Criar outra empresa (conta) | ❌ | ❌ | ✅ |

---

## 3. Menu **Caixa de entrada** — onde o atendimento acontece

> Na interface nova aparece como **Caixa** 🧭. **Na tela de hoje o menu se chama
> "Conversas"** — é a mesma tela. É onde o atendente passa o dia.

### 3.1 Para que serve

Reunir, em uma lista só, **tudo o que chega por todos os canais** — WhatsApp, Instagram,
Messenger, Telegram, e-mail e chat do site. Quem atende não precisa abrir seis aplicativos: a
mensagem chega no mesmo lugar, com o mesmo jeito de responder.

### 3.2 A tela tem três colunas

```
┌────────┬──────────────────┬────────────────────────┬──────────────┐
│ Menu   │ Filtros          │ A conversa aberta      │ Dados do     │
│ lateral│ (minha visão,    │ (histórico + campo de  │ contato      │
│        │ canais, filas,   │  escrita)              │              │
│        │ etiquetas)       │                        │              │
└────────┴──────────────────┴────────────────────────┴──────────────┘
```

No **celular**, as colunas viram telas: você toca na conversa, ela abre inteira, e o botão de
voltar retorna à lista.

### 3.3 Coluna de filtros — o que cada item mostra

**Minha visão**

| Filtro | Mostra |
|---|---|
| **Atribuídas a mim** | As conversas que são sua responsabilidade. É por aqui que se começa o dia. |
| **Menções** | Conversas em que um colega escreveu `@seunome` em uma nota interna. Precisa da sua leitura, mesmo que a conversa não seja sua. |
| **Não atribuídas** | Chegaram e ninguém pegou. É a fila de trabalho coletiva. |
| **Resolvidas** | Já encerradas. Ficam guardadas para consulta e reabrem sozinhas se a pessoa voltar a escrever. |

**Canais conectados** — filtra por porta de entrada. Útil para quem cuida de um canal só
("hoje eu cubro o Instagram").

**Filas** — filtra pelas conversas do seu time (Comercial, Suporte técnico, Financeiro…).

**Etiquetas** — filtra pelo assunto que a equipe marcou ("Entrega atrasada", "Segunda via").

💡 O número cinza ao lado de cada filtro é a **quantidade em espera**. Se "Não atribuídas" está
alto e "Atribuídas a mim" está baixo, é sinal de que a distribuição parou — avise o administrador.

### 3.4 Coluna do meio — a lista de conversas

No alto há a **busca** (por nome, telefone ou trecho de texto) e três abas de estado:

| Aba | Significa |
|---|---|
| **Abertas** | Em andamento. O relógio do prazo está correndo. |
| **Pendentes** | Você está esperando algo — o cliente, um fornecedor, outro setor. Sai da correria do dia sem ser encerrada. |
| **Resolvidas** | Encerradas. |

Cada linha da lista mostra:

- **avatar** com um pontinho da cor do canal;
- **nome** do contato e **horário** da última mensagem;
- **prévia** da última mensagem;
- **selo do canal** (WhatsApp, Instagram…);
- **selo do prazo** 🧭 ⏳ — *No prazo*, *Em risco*, *Estourado* ou *Pausado*. Depende do controle
  de prazos (SLA), que **ainda não está disponível** (capítulo 15); hoje a linha não traz esse selo;
- **contador** de mensagens não lidas.

💡 Os selos de prazo nunca dependem só da cor: trazem também o **ícone** e a **palavra escrita**.
Quem não distingue verde de vermelho continua entendendo a tela.

### 3.5 Coluna do meio — a conversa aberta

No **alto** da conversa ficam quatro botões:

| Botão | O que faz |
|---|---|
| **Responsável** (nome do agente) | Transfere a conversa para outro atendente ou para um time |
| **Etiquetar** | Aplica uma etiqueta de assunto |
| **Adiar** | Marca como **Pendente** — some da lista de abertas e volta quando o cliente responder |
| **Resolver** | Encerra a conversa |

No **corpo** aparece o histórico. Quatro tipos de bloco:

1. **Mensagem recebida** (alinhada à esquerda) — o que a pessoa escreveu.
2. **Mensagem enviada** (alinhada à direita) — o que a equipe respondeu, com o nome de quem
   respondeu e a confirmação de leitura, quando o canal informa.
3. **Nota interna** (fundo âmbar, com cadeado) — só a equipe vê.
4. **Evento do sistema** (linha discreta com ícone de robô) — "conversa atribuída à fila
   Pós-venda pela regra Assunto: entrega". Serve para você entender **por que** a conversa
   chegou até você.

### 3.6 O campo de escrita — três abas

⚠️ **Esta é a parte mais importante do manual.** A confusão entre responder e anotar é o erro
que mais causa constrangimento com cliente.

| Aba | Cor | Quem lê | Para quê |
|---|---|---|---|
| **Responder** | neutra | **O cliente lê** | A resposta de verdade |
| **Nota interna** | âmbar, com cadeado e a frase *"Isto fica só para a equipe"* | Só a equipe | Combinar, registrar contexto, chamar colega com `@` |
| **Resposta rápida** | neutra | O cliente lê | Inserir um texto pronto |

A aba de nota interna se anuncia por **quatro sinais somados**: a aba âmbar, a faixa lateral, o
campo tingido e a frase escrita. Isso é proposital — nunca depende só da cor.

**Botões do rodapé do campo:**

- 📎 **Anexar arquivo** — imagem, PDF, áudio. Cada canal tem limite próprio de tamanho.
- 🙂 **Emoji**.
- 👥 **Mencionar alguém** — funciona **só em nota interna**; a pessoa mencionada recebe aviso e
  a conversa aparece no filtro *Menções* dela.

### 3.7 Coluna da direita — dados do contato

Mostra, em blocos:

- **Contato:** telefone, e-mail, cidade e fuso horário.
- **Etiquetas** aplicadas, com botão para adicionar.
- **Esta conversa:** há quanto tempo está aberta, quanto tempo levou a primeira resposta, em
  qual fila está e quem é o responsável.
- **Conversas anteriores:** quantas vezes essa pessoa já falou com você e como terminou a
  última (inclusive a nota de satisfação).

💡 Antes de responder, dê uma olhada em *Conversas anteriores*. Descobrir que é o terceiro
contato sobre o mesmo assunto muda completamente o tom da resposta.

### 3.8 Como usar — os cinco fluxos do dia a dia

**Pegar uma conversa da fila**
1. Filtro **Não atribuídas** ➜ clique na conversa.
2. Clique no botão de **responsável** no alto ➜ escolha **você mesmo**.
3. Responda.

**Transferir para um colega**
1. Com a conversa aberta, clique no botão de **responsável**.
2. Escolha a pessoa ou o **time**.
3. 💡 Antes de transferir, escreva uma **nota interna** com o resumo. Transferência sem contexto
   faz o cliente repetir tudo — e é a reclamação mais comum sobre plataformas de atendimento.

**Marcar como pendente (esperando terceiro)**
1. Clique em **Adiar**.
2. Escreva uma nota interna dizendo o que se está esperando e de quem.
3. A conversa some das abertas e volta quando o cliente escrever.

**Usar uma resposta pronta**
1. Na aba **Responder**, digite `/` seguido do atalho (exemplo: `/horario`).
2. A lista aparece; escolha com as setas e confirme com **Enter**.
3. **Leia antes de enviar** e ajuste o nome da pessoa. Texto pronto enviado sem revisão soa
   automático, e o cliente percebe.

**Encerrar**
1. Clique em **Resolver**.
2. Se a pesquisa de satisfação estiver ligada naquele canal, ela é enviada automaticamente.

### 3.9 Erros comuns na Caixa de entrada

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **"Escrevi e o cliente não recebeu"** | A aba **Nota interna** estava selecionada | Copie o texto, mude para **Responder**, envie de novo. A nota pode ficar — ela ajuda o histórico |
| **"Não chega mensagem nova nesta aba"** | A aba do navegador ficou muito tempo em segundo plano | Atualize a página (**F5**). Se persistir, avise o administrador: pode ser o canal desconectado |
| **"Não consigo enviar no WhatsApp"** | Passaram-se mais de **24 horas** desde a última mensagem do cliente | É regra do WhatsApp, não da plataforma. Fora dessa janela só é possível enviar um **modelo aprovado** (ver capítulo 6) |
| **"A conversa sumiu da minha lista"** | Alguém resolveu, adiou ou transferiu | Procure em **Resolvidas** ou use a busca pelo nome |
| **"Anexo não sobe"** | Arquivo acima do limite do canal | Reduza o tamanho ou envie um link. O WhatsApp aceita menos que o e-mail |
| **"Respondi e voltou como não lida"** | O cliente escreveu de novo depois | Normal. A conversa reabre a cada mensagem nova |
| **"Aparece conversa de outro setor"** | O filtro está em **Não atribuídas**, que é coletivo | Use **Atribuídas a mim** para o seu trabalho, e o filtro de **Fila** para o do seu time |

---

## 4. Menu **Painel** 🔒 — como o atendimento está indo agora

> Só administradores. O atendente não vê este menu.

> 🧭 **Onde isto está hoje:** o menu **Painel** como entrada separada do trilho é da interface
> nova. Na tela de hoje, os números do atendimento ficam em **Relatórios ➜ Visão geral**. Os
> indicadores existem; a organização em seis cartões, os mini-gráficos de tendência e os nove
> submenus descritos abaixo são o desenho aprovado da interface nova (Etapa 9.4) e podem chegar
> com nomes ligeiramente diferentes.

### 4.1 Para que serve

Responder, em cinco segundos, à pergunta *"está tudo sob controle agora?"*. Diferente dos
**Relatórios** (capítulo 7), que olham para trás, o Painel olha para **agora**.

### 4.2 Como usar

1. Clique em **Painel** no menu lateral.
2. Escolha o período no alto: **Hoje**, **7 dias**, **30 dias** ou **Personalizado**.
3. Use **Todos os canais** para restringir a um canal específico.
4. **Exportar** baixa os números do período em planilha.

### 4.3 Os indicadores do topo, um a um

| Indicador | O que conta | Como ler |
|---|---|---|
| **Em atendimento** | Conversas abertas neste momento | É o tamanho da fila viva. Subiu muito? Falta gente ou entrou campanha |
| **Aguardando resposta** | Conversas em que a última mensagem é do cliente | ⚠️ É o número mais importante do painel. Cada unidade é uma pessoa esperando |
| **Resolvidas hoje** | Encerradas no período | Compare com a meta do dia |
| **1ª resposta (média)** | Da chegada até a primeira resposta humana | É o que o cliente sente como "eles atendem rápido" |
| **Resolução (média)** | Da abertura até o encerramento | Tempo alto com 1ª resposta baixa = o problema é a solução, não o atendimento |
| **Satisfação (CSAT)** | Média das notas dadas pelos clientes | Considere junto o número de respostas: 5,0 com 3 respostas não é indicador |

Cada indicador traz um **mini-gráfico** de tendência e a **comparação com o período anterior**.

### 4.4 Os blocos abaixo

- **Conversas abertas por hora** — a linha cheia é hoje; a tracejada é a média das últimas
  semanas no mesmo dia. Serve para saber se hoje é atípico.
- **Volume por canal** — de onde vem a demanda. É o que orienta onde investir.
- **Filas agora** — quem está esperando e há quanto tempo, fila por fila.
- **Prazo de primeira resposta** — quantas conversas ficaram no prazo, em risco e estouradas.
- **Equipe de atendimento** — quem está disponível, quantas conversas cada um tem em mãos.

### 4.5 Submenus do Painel

| Item | Mostra |
|---|---|
| **Visão geral** | A tela descrita acima |
| **Atendimento** | Volume, tempos e distribuição no período |
| **Canais** | Desempenho comparado entre canais |
| **Equipe** | Carga e produtividade por atendente e por time |
| **Prazos (SLA)** | Cumprimento dos tempos combinados ⏳ |
| **Assuntos** | O que os clientes mais procuram, pelas etiquetas |
| **Automação** | Quanto as regras resolveram sem intervenção humana |
| **Satisfação** | Notas, comentários e evolução |
| **Exportar dados** | Baixa qualquer visão em planilha |

### 4.6 Erros comuns no Painel

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **"Os números não batem com o relatório"** | Períodos ou fusos diferentes | Confira o período selecionado e o fuso da conta (*Configurações ➜ Dados da empresa*) |
| **"Satisfação vazia"** | A pesquisa não está ligada naquele canal | *Configurações ➜ Pesquisa de satisfação* e ative por canal |
| **"Tempo médio absurdo"** | Uma conversa esquecida aberta há dias distorce a média | Procure conversas antigas abertas e resolva-as. Considere olhar a **mediana**, quando disponível |
| **"Não vejo o menu Painel"** | Você entrou como atendente | É por desenho. Peça acesso de administrador a quem responde pela conta |

---

## 5. Menu **Contatos** — a pessoa, não a conversa

### 5.1 Para que serve

A conversa termina; a **pessoa** continua. Contatos é o cadastro de quem já falou com a sua
empresa, reunindo o histórico de todos os canais **numa ficha só** — o mesmo cliente que
escreveu pelo Instagram em março e pelo WhatsApp em agosto é uma pessoa, não duas.

### 5.2 Submenus

| Item | O que faz |
|---|---|
| **Todos os contatos** | A lista completa, com busca e filtros |
| **Segmentos salvos** | Filtros complexos guardados com nome, para reutilizar |
| **Importar** | Sobe uma planilha com muitos contatos de uma vez 🔒 |
| **Campos personalizados** | Cria informações próprias da sua empresa 🔒 |

### 5.3 Como usar — buscar um contato

1. Clique em **Contatos**.
2. Digite na busca: nome, telefone ou e-mail (basta um pedaço).
3. Clique no resultado — a ficha abre.

### 5.4 Como usar — criar um contato à mão

1. **Contatos ➜ Novo contato**.
2. Preencha **nome** e ao menos **telefone** ou **e-mail**.
3. Salve.

⚠️ Criar contato à mão **não abre conversa**. Para falar com alguém que nunca escreveu, é preciso
uma **campanha** com modelo aprovado (capítulo 6) — regra dos canais, não nossa.

### 5.5 O que cada campo significa

| Campo | Significa | Cuidado |
|---|---|---|
| **Nome** | Como a pessoa é chamada | É o que aparece na lista de conversas |
| **E-mail** | Endereço principal | Serve de chave para não duplicar contato |
| **Telefone** | Formato internacional: `+55 98 98335-1000` | Sem o `+55` o WhatsApp não reconhece |
| **Empresa** | Onde a pessoa trabalha | Útil para atendimento entre empresas |
| **Cidade / País** | Localização | Preenchido automaticamente por alguns canais |
| **Identificador externo** | O código dessa pessoa no **seu** sistema (ERP, CRM) | É o que permite ligar o atendimento ao seu cadastro |
| **Campos personalizados** | O que você criar: nº do contrato, plano, vencimento | Ver 5.8 |

### 5.6 A ficha do contato

Abrindo um contato você vê:

- os **dados de cadastro**, editáveis ali mesmo;
- **todas as conversas** dele, de todos os canais, em ordem;
- as **etiquetas** já aplicadas;
- as **notas** que a equipe deixou sobre a pessoa (não sobre uma conversa específica);
- os **campos personalizados**.

### 5.7 Segmentos salvos

Um **segmento** é um filtro guardado com nome. Exemplos úteis:

- *Clientes de São Luís que abriram conversa nos últimos 30 dias*;
- *Contatos com a etiqueta "Entrega atrasada"*;
- *Quem nunca respondeu a nenhuma campanha*.

**Como criar:** monte o filtro na lista de contatos ➜ **Salvar segmento** ➜ dê um nome.
O segmento fica no menu e é o que você seleciona depois como público de uma campanha.

### 5.8 Campos personalizados 🔒

*Configurações ➜ Campos personalizados* (ou *Contatos ➜ Campos personalizados*).

Servem para guardar o que **só a sua empresa** precisa. Cada campo tem:

| Propriedade | Explicação |
|---|---|
| **Nome** | O rótulo que a equipe vê ("Número do contrato") |
| **Chave** | O nome técnico, sem espaço nem acento (`numero_contrato`) — usado por integrações |
| **Tipo** | Texto, número, link, lista de opções, data, sim/não |
| **Aplica-se a** | **Contato** (viaja com a pessoa) ou **Conversa** (vale só para aquele atendimento) |
| **Descrição** | Uma linha explicando para que serve; aparece como dica na tela |

💡 Regra prática: se a informação **é da pessoa**, é campo de contato. Se ela **muda a cada
atendimento** (nº do pedido, protocolo), é campo de conversa.

### 5.9 Importar contatos 🔒

1. **Contatos ➜ Importar**.
2. Baixe o **modelo de planilha** oferecido na tela — use exatamente as colunas dele.
3. Preencha e salve como **CSV**.
4. Suba o arquivo e acompanhe o resultado.

**Regras que evitam dor de cabeça:**

- Telefone **sempre** em formato internacional (`+5598983351000`), sem parênteses nem traço.
- Uma linha por pessoa.
- Se o e-mail ou o telefone já existir, o contato é **atualizado**, não duplicado.
- Planilhas grandes levam alguns minutos; a tela avisa quando termina.

⚠️ **Antes de importar, confira a base legal.** Importar lista comprada ou de origem
desconhecida e disparar mensagem é a receita mais rápida para o número ser bloqueado pelo
WhatsApp — e é problema de LGPD, além de problema de canal.

### 5.10 Erros comuns em Contatos

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **Contato duplicado** | Escreveu por dois canais sem dado em comum | Abra os dois e use **Mesclar contatos**, mantendo o mais completo |
| **"Contato já existe"** na criação | O e-mail ou o telefone já está cadastrado | Busque pelo dado; edite o existente |
| **A importação falhou** | Coluna renomeada, arquivo em Excel em vez de CSV, acento no cabeçalho | Refaça a partir do modelo baixado, sem alterar os títulos |
| **Telefone não vira conversa de WhatsApp** | Falta o código do país | Corrija para `+55…` |
| **Não consigo excluir um contato** | Você é atendente | Exclusão é do administrador. ⚠️ Excluir apaga também o histórico de conversas da pessoa; prefira **anonimizar** quando a pessoa pedir remoção por LGPD |

---

## 6. Menu **Campanhas** — falar primeiro, dentro das regras

### 6.1 Para que serve

Enviar mensagem para muita gente ao mesmo tempo, ou abordar quem está no seu site. São **dois
tipos completamente diferentes**, e confundi-los causa bloqueio de número.

| Tipo | Onde funciona | Quando dispara |
|---|---|---|
| **Campanha contínua** (*ongoing*) | Chat do site | Quando o visitante cumpre uma condição (está há X segundos numa página, por exemplo) |
| **Campanha pontual** (*one-off*) | WhatsApp, SMS | Em uma data e hora, para uma lista escolhida |

### 6.2 Submenus

> 🧭 **Na tela de hoje** o menu Campanhas traz apenas as duas abas — *contínuas* e *pontuais*. Os
> itens **Modelos de mensagem** e **Históricos** como entradas próprias são da interface nova; os
> modelos aprovados aparecem hoje dentro da própria campanha, no momento de escolher a mensagem.

| Item | Conteúdo |
|---|---|
| **Em andamento** | Campanhas contínuas ativas no chat do site |
| **Agendadas** | Campanhas pontuais com data marcada |
| **Modelos de mensagem** | Os textos aprovados pelo WhatsApp (ver 6.5) |
| **Históricos** | O que já foi enviado, com números de entrega |

### 6.3 Como criar uma campanha contínua (chat do site)

1. **Campanhas ➜ Em andamento ➜ Nova campanha**.
2. **Título** — só para a sua equipe se organizar.
3. **Canal** — escolha a caixa de entrada do chat do site.
4. **Mensagem** — curta e útil. *"Precisa de ajuda com o orçamento?"* funciona melhor que
   *"Olá! Como posso ajudar?"*.
5. **Enviado por** — o atendente que aparece como remetente.
6. **Condições:**
   - **Páginas** — em quais endereços a campanha aparece (deixe em branco para todas);
   - **Tempo na página** — quantos segundos antes de aparecer (30 a 60 costuma ser o ponto);
   - **Público** — todos os visitantes ou só os que já são contatos identificados.
7. **Ativar**.

### 6.4 Como criar uma campanha pontual (WhatsApp)

1. **Campanhas ➜ Agendadas ➜ Nova campanha**.
2. **Título**.
3. **Canal** — a caixa de entrada de WhatsApp.
4. **Público** — escolha um **segmento salvo** (capítulo 5.7).
5. **Modelo de mensagem** — escolha um modelo **já aprovado**; preencha as variáveis.
6. **Agendar para** — data e hora.
7. **Salvar**.

⚠️ **Nunca dispare para toda a base de uma vez na primeira campanha.** Comece com algumas
dezenas de contatos que esperam a sua mensagem. Uma taxa alta de bloqueio derruba a **qualidade
do número** e, na sequência, o limite diário de envio — e recuperar isso leva semanas.

### 6.5 Modelos de mensagem (*templates* / HSM) — a regra que mais gera dúvida

O WhatsApp permite conversa livre **apenas dentro de 24 horas** desde a última mensagem do
cliente. Fora dessa janela, e para iniciar contato, só é possível enviar um **modelo aprovado
previamente pela Meta**.

**Como funciona:**

1. O modelo é escrito, com espaços marcados como variáveis: *"Olá {{1}}, seu pedido {{2}} saiu
   para entrega."*
2. É submetido à Meta e leva de minutos a alguns dias para ser **aprovado** ou **recusado**.
3. Aprovado, aparece na lista e pode ser usado em campanhas e respostas fora da janela.

**Por que um modelo é recusado, na prática:** texto promocional em categoria de utilidade,
variável no começo ou no fim da frase, erro de português, ou promessa que a empresa não pode
cumprir. Corrija e submeta de novo.

⏳ **Hoje o canal de WhatsApp oficial ainda não está ativo no Ragnabot.** Falta a verificação do
número junto à Meta, que depende do titular da conta (ligação de voz + registro na Cloud API).
Enquanto isso, campanhas pontuais por WhatsApp não podem ser enviadas. O chat do site funciona
normalmente.

### 6.6 Erros comuns em Campanhas

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **"Campanha enviada, ninguém recebeu"** | Segmento vazio ou contatos sem telefone válido | Abra o segmento e confira quantos contatos ele tem antes de agendar |
| **"Modelo recusado"** | Categoria errada ou texto promocional | Reescreva, ajuste a categoria e submeta novamente |
| **Muitos bloqueios** | Lista fria ou frequência alta | Pare a campanha, reduza o público, mande só para quem espera contato |
| **Campanha do site não aparece** | Condição de página errada ou tempo alto demais | Confira o endereço exato configurado e baixe o tempo |
| **"Não consigo criar campanha"** | Você é atendente | Campanha é do administrador |

---

## 7. Menu **Relatórios** — o que vira reunião

### 7.1 Para que serve

Enquanto o Painel mostra **agora**, os Relatórios mostram **o que aconteceu** — e permitem
comparar períodos, exportar e mandar por e-mail.

### 7.2 Submenus

| Relatório | Responde |
|---|---|
| **Conversas** | Quantas entraram, quantas foram resolvidas, em que horários |
| **Agentes** | Quantas cada atendente resolveu, com que tempo de resposta e que nota |
| **Filas** | Como cada time se comportou |
| **Canais** | De onde vem a demanda e qual canal é mais lento |
| **Satisfação** | Notas e comentários dos clientes |
| **Agendados por e-mail** | Relatórios enviados automaticamente, toda semana ou todo mês |

### 7.3 Como usar

1. Escolha o relatório no menu de filtros.
2. Selecione o **período** no alto.
3. Refine por **canal**, **time**, **agente** ou **etiqueta**.
4. Clique em **Exportar** para baixar em planilha.

### 7.4 O que cada número significa — sem margem para interpretação

| Indicador | Definição exata |
|---|---|
| **Conversas abertas** | Conversas cuja **primeira mensagem** caiu no período |
| **Conversas resolvidas** | Conversas **encerradas** no período, mesmo que abertas antes |
| **Tempo de primeira resposta** | Da entrada da mensagem até a **primeira resposta humana**. Resposta automática não conta |
| **Tempo de resolução** | Da abertura até o clique em Resolver |
| **CSAT** | Média das notas. Só entram conversas em que o cliente respondeu à pesquisa |
| **Taxa de resposta da pesquisa** | Quantos por cento dos convidados responderam |

⚠️ **Não compare atendentes só por "conversas resolvidas".** Quem atende o canal de dúvida
simples resolve muito mais que quem atende o canal técnico. Olhe o número junto com o **tempo de
resolução** e o **CSAT**.

### 7.5 Relatórios agendados por e-mail ⏳

⏳ **Depende de duas coisas que ainda não estão prontas:** o servidor de envio de e-mail da
plataforma (item 3.1) e a confirmação de que o recurso existe nesta edição. Até lá, exporte a
planilha à mão (7.3). O passo a passo abaixo é o previsto:

1. **Relatórios ➜ Agendados por e-mail ➜ Novo agendamento**.
2. Escolha o relatório, a **frequência** (semanal ou mensal) e os **destinatários**.
3. Salve. O arquivo chega por e-mail, no dia marcado, sem ninguém precisar entrar.

### 7.6 Erros comuns em Relatórios

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **Relatório vazio** | O período escolhido não teve movimento, ou o filtro é restritivo demais | Amplie o período e limpe os filtros |
| **CSAT com poucas respostas** | A pesquisa está desligada em canais importantes | Ligue em cada canal (*Configurações ➜ Pesquisa de satisfação*) |
| **Exportação não baixa** | O navegador bloqueou o download | Autorize downloads do site e tente novamente |
| **Número diferente do Painel** | Fuso, período ou definição diferente (aberta × resolvida) | Confira a definição exata em 7.4 |

---

## 8. Menu **Central de ajuda** — o cliente que se resolve sozinho

### 8.1 Para que serve

Publicar artigos que respondem as dúvidas repetidas, num site público. Cada dúvida bem escrita
lá é uma conversa a menos na fila — e, quando a conversa acontece, o atendente cola o link em
vez de digitar tudo de novo.

### 8.2 Os três níveis

```
Portal  →  Categoria  →  Artigo
(o site)   (a prateleira)  (o texto)
```

- **Portal** — o site em si. Tem nome, endereço, logotipo, cor e idioma.
- **Categoria** — agrupa artigos ("Entregas", "Pagamentos", "Primeiros passos").
- **Artigo** — o texto de fato.

### 8.3 Como criar o portal 🔒

1. **Central de ajuda ➜ Novo portal**.
2. **Nome** — aparece no topo do site ("Ajuda Ragnatela").
3. **Endereço (slug)** — o trecho do endereço: só letras minúsculas, sem espaço nem acento.
4. **Idioma** — português do Brasil.
5. **Logotipo e cor** — para o site ficar com a cara da empresa.
6. Salve e crie as **categorias**.

### 8.4 Como escrever um artigo

1. **Central de ajuda ➜ o portal ➜ Novo artigo**.
2. **Título** — escreva como o cliente pergunta, não como a empresa fala.
   ✅ *"Como faço a segunda via do boleto?"* · ❌ *"Reemissão de título"*.
3. **Categoria**.
4. **Conteúdo** — parágrafos curtos, passos numerados, imagens quando ajudarem.
5. **Estado:**
   - **Rascunho** — só a equipe vê;
   - **Publicado** — está no ar.
6. Salve.

💡 O melhor jeito de descobrir o que escrever é olhar as **etiquetas mais usadas** no relatório
de assuntos. Os cinco assuntos mais frequentes viram os cinco primeiros artigos.

### 8.5 Erros comuns na Central de ajuda

| O que acontece | Por quê | O que fazer |
|---|---|---|
| **O artigo não aparece no site** | Ficou como rascunho | Mude o estado para **Publicado** |
| **Endereço do portal não abre** | O domínio ainda não foi apontado | ⏳ Depende de configuração técnica do NOC; abra chamado |
| **Artigo desorganizado** | Texto em bloco único | Quebre em passos numerados e em subtítulos |

---

## 9. Menu **Configurações** 🔒

> Só administradores. O menu se divide em quatro grupos: **A conta**, **Atendimento**,
> **Inteligência** e **Administração**.

### 9.1 Dados da empresa

**Para que serve:** a identidade da conta e as definições que valem para tudo.

| Campo | O que faz | Cuidado |
|---|---|---|
| **Nome da conta** | Aparece no cabeçalho e nos e-mails enviados | Use o nome que o cliente reconhece |
| **Idioma** | Idioma da interface para toda a equipe | Português (Brasil) |
| **Fuso horário** | Base de **todos** os relatórios e do horário de atendimento | ⚠️ Fuso errado desloca todos os números do dia |
| **Domínio da Central de ajuda** | Endereço próprio do portal de artigos | Exige configuração técnica |
| **Excluir a conta** | Apaga tudo, sem volta | ⚠️ Não existe desfazer |

### 9.2 Agentes — quem trabalha aqui

**Para que serve:** convidar, editar e remover as pessoas que usam a plataforma.

**Como convidar:**
1. **Configurações ➜ Agentes ➜ Adicionar agente**.
2. **Nome completo** e **e-mail** (é por ele que a pessoa entra).
3. **Função:** **Agente** (só atende) ou **Administrador** (atende e configura).
4. Enviar convite. A pessoa recebe um e-mail, cria a própria senha e já entra.
   ⏳ **Hoje o e-mail ainda não sai da plataforma** (item 3.1): combine com a Ragnatela a
   criação do acesso e a entrega da senha inicial por um canal seguro.

**Editar:** clique no agente para trocar a função ou reenviar o convite.

**Remover:** remove o acesso. ⚠️ **As conversas dele continuam**, com o nome preservado no
histórico — nada é apagado. As conversas que estavam atribuídas a ele ficam **sem responsável**;
redistribua-as no mesmo dia.

| Erro comum | Causa | Saída |
|---|---|---|
| "O convite não chegou" | Caixa de spam, ou e-mail digitado errado | Peça para olhar o spam; se não estiver, reenvie conferindo o endereço |
| "Convite expirado" | Passou o prazo | Reenvie |
| "Não consigo remover a mim mesmo" | Proteção contra a conta ficar sem administrador | Peça a outro administrador |

### 9.3 Times (as "Filas")

**Para que serve:** agrupar atendentes por assunto — *Comercial*, *Suporte técnico*,
*Financeiro*, *Pós-venda* — para que a conversa chegue ao grupo certo em vez de a uma pessoa só.

💡 **Time e fila são a mesma coisa aqui.** Chamamos de **fila** quando falamos da conversa
entrando; de **time**, quando falamos das pessoas.

**Como criar:**
1. **Configurações ➜ Times ➜ Novo time**.
2. **Nome** — o que a equipe vê no filtro.
3. **Descrição** — uma linha sobre o que esse time trata.
4. **Atribuir automaticamente** — se ligado, a conversa que cai no time é distribuída
   automaticamente entre os membros disponíveis, por rodízio. Se desligado, fica na fila do
   time até alguém pegar.
5. **Membros** — marque quem faz parte.

⚠️ **Todo time precisa de pelo menos duas pessoas.** Time com um membro só vira ponto cego
quando essa pessoa entra de férias.

| Erro comum | Causa | Saída |
|---|---|---|
| Conversa parada na fila do time | Distribuição automática desligada e ninguém pegando | Ligue a distribuição automática ou combine quem varre a fila |
| Distribuição concentrada em uma pessoa | Os outros estão como Ausente | Confira a disponibilidade da equipe (capítulo 1.3) |

### 9.4 Canais / Caixas de entrada — as portas de entrada

**Para que serve:** ligar, testar e desligar cada canal por onde o cliente fala com você.

> 🧭 **Na tela de hoje** este menu se chama **Configurações ➜ Caixas de entrada**, e a lista é
> simples: nome do canal e botão de configurar. Os **cartões** com estado, contagem de conversas,
> *última sincronização* e os botões **Testar** / **Testar todos** são da interface nova.

A tela lista os canais em cartões 🧭. Cada cartão traz:

- o **nome** do canal e o **estado** (*Conectado*, *Renovação pendente*, *Desconectado*);
- a **identificação** (número, perfil, endereço de e-mail);
- **conversas nos últimos 30 dias**;
- **última sincronização** — o momento em que o canal **confirmou que está recebendo**.
  ⚠️ Não é o horário da última mensagem: um canal sem mensagens há duas horas pode estar
  perfeitamente saudável;
- os botões **Configurar**, **Testar** e **Desativar**.

No alto há **Testar todos** e **Conectar canal**.

#### 9.4.1 Chat do site — o mais rápido de ligar

1. **Conectar canal ➜ Chat do site**.
2. **Nome da caixa de entrada** — o nome interno ("Site institucional").
3. **Endereço do site**.
4. Personalize saudação, cor e posição da janelinha.
5. A plataforma gera um **trecho de código**. Copie e peça a quem cuida do site para colar
   antes do fechamento da página. Pronto.

#### 9.4.2 WhatsApp — API oficial

**Campos da tela de conexão:**

| Campo | O que é | Onde encontrar |
|---|---|---|
| **Nome da caixa de entrada** | O nome que a equipe vê | Você escolhe |
| **Número de telefone** | Formato internacional, com código do país | O número da empresa |
| **Identificador da conta** (*Business Account ID*) | O código da sua conta comercial | Gerenciador de Negócios da Meta |
| **Token permanente** | A chave de acesso | Gerenciador de Negócios. 🔒 Depois de salvo **não é exibido de volta na tela** — para trocar, cola-se um novo. Trate-o como senha: quem o tem fala pelo seu número. O acesso ao valor guardado é restrito à administração da plataforma |
| **Fila que recebe por padrão** | Para onde vai a conversa que chega sem regra | Um dos seus times |
| **Endereço do webhook** | Gerado por nós; é onde a Meta entrega as mensagens | Copie e cole no aplicativo da Meta. Não pode ser alterado |

**Opções (chaves liga/desliga):**

- **Atribuir automaticamente ao atendente livre** — rodízio entre quem está disponível.
- **Responder fora do horário** — envia a mensagem de ausência e mantém a conversa na fila
  para o dia seguinte.
- **Pedir avaliação ao resolver** — dispara a pesquisa de satisfação ao encerrar.

Ao final: **Salvar e testar**, **Salvar como rascunho** ou **Cancelar**.

⏳ **Estado atual:** o número `+55 98 3197-0997` está cadastrado na conta comercial, mas ainda
**não verificado** junto à Meta. Faltam três passos que só o titular pode dar: verificar por
ligação de voz, registrar na Cloud API e submeter o nome de exibição. Enquanto isso, o canal
não recebe nem envia.

#### 9.4.3 Instagram e Messenger ⏳

⏳ **Previstos para depois do WhatsApp** (item 4.6 do mapa de etapas). O passo a passo abaixo
vale para quando o canal for liberado.

Conectados pelo login da Meta, autorizando o perfil ou a página.

⚠️ **O token da página expira.** Quando expira, as mensagens **param de entrar e ninguém é
avisado do outro lado** — o cliente acha que foi ignorado. A tela mostra o aviso com
antecedência ("expira em 14 dias"): renove antes, clicando em **Configurar ➜ Renovar acesso**.

#### 9.4.4 E-mail ⏳

⏳ **Previsto para depois do WhatsApp** (item 4.6). Depende também do servidor de envio da
plataforma (item 3.1).

Recebe mensagens em um endereço da empresa e as transforma em conversas.

| Campo | Significa |
|---|---|
| **Endereço de e-mail** | A caixa que será atendida (`atendimento@suaempresa.com.br`) |
| **Encaminhamento** | A plataforma gera um endereço interno; configure a sua caixa para encaminhar as mensagens para ele |
| **SPF e DKIM** | Assinaturas técnicas que provam que o e-mail é seu. ⚠️ Sem elas, as suas respostas caem no spam do cliente |

#### 9.4.5 Telegram ⏳

⏳ **Previsto para depois do WhatsApp** (item 4.6).

1. Fale com o `@BotFather` no Telegram e crie um robô.
2. Copie o **token** que ele entrega.
3. Cole no Ragnabot. Pronto — é o canal mais simples de todos.

#### 9.4.6 Desconectar um canal

⚠️ **A conversa que já existe continua guardada.** O que para é a **entrada de mensagens
novas** — e o cliente do outro lado **não recebe aviso nenhum**: ele escreve e nada acontece.
Desconecte apenas com essa consequência clara.

| Erro comum | Causa | Saída |
|---|---|---|
| **"Parou de chegar mensagem"** | Token expirado (Meta) ou webhook alterado | Abra o canal, clique em **Testar** e leia a mensagem de erro. Token expirado é o caso mais comum |
| **"O identificador tem menos dígitos que o esperado"** | Colou o código errado, ou faltou um dígito | Confira no Gerenciador de Negócios da Meta. A tela avisa quantos dígitos faltam |
| **"O chat não aparece no site"** | Código colado no lugar errado, ou cache do site | Confira se o trecho está antes do fim da página e limpe o cache |
| **"Responde no WhatsApp e volta erro"** | Fora da janela de 24 horas | Use um modelo aprovado (capítulo 6.5) |
| **E-mail no spam do cliente** | SPF/DKIM não configurados | Peça ao responsável pelo domínio; a tela indica o que falta |

### 9.5 Etiquetas — classificar o assunto

**Para que serve:** marcar a conversa com o assunto, para filtrar depois e para os relatórios
saberem **o que os clientes procuram**.

**Como criar:**
1. **Configurações ➜ Etiquetas ➜ Nova etiqueta**.
2. **Nome** — curto e no mesmo padrão das outras ("Entrega atrasada", "Segunda via").
3. **Descrição** — quando usar esta e não outra.
4. **Cor**.
5. **Mostrar na barra lateral** — se ligado, vira um filtro fixo na Caixa de entrada.

⚠️ **Menos é mais.** Comece com cinco. Trinta etiquetas parecidas fazem cada atendente escolher
uma diferente para o mesmo caso, e o relatório de assuntos deixa de significar qualquer coisa.

💡 Padronize a redação: ou tudo no singular, ou tudo no plural. "Entrega atrasada" e "Entregas
atrasadas" viram duas linhas diferentes no relatório.

### 9.6 Respostas rápidas — o texto que a equipe repete

**Para que serve:** guardar frases usadas o tempo todo e inseri-las com um atalho.

**Como criar:**
1. **Configurações ➜ Respostas rápidas ➜ Nova**.
2. **Atalho** — a palavra que aciona o texto, sem espaço (`horario`, `boleto`, `prazo`).
3. **Conteúdo** — o texto.

**Como usar:** na aba **Responder**, digite `/` e o atalho. Escolha na lista e confirme.

💡 Deixe **espaço para personalizar**: escreva *"Olá! O nosso horário é…"* em vez de *"Olá,
[nome]…"*, e complete o nome na hora. E revise sempre antes de enviar.

| Erro comum | Causa | Saída |
|---|---|---|
| O atalho não aparece | Tem espaço ou acento | Refaça com uma palavra só, sem acento |
| Enviou o texto para a pessoa errada | Não revisou depois de colar | Torne regra da equipe: colou, leu, ajustou, enviou |

### 9.7 Macros — várias ações com um clique

**Para que serve:** encadear ações que se repetem sempre juntas. Exemplo de macro *"Encerrar
segunda via"*: aplicar a etiqueta **Segunda via** ➜ enviar a mensagem padrão ➜ atribuir ao time
**Financeiro** ➜ marcar como **Resolvida**.

**Como criar:**
1. **Configurações ➜ Macros ➜ Nova macro**.
2. **Nome**.
3. **Visibilidade** — **pública** (toda a equipe usa) ou **privada** (só você).
4. Monte a sequência de ações, na ordem em que devem acontecer.

**Como usar:** com a conversa aberta, escolha a macro no menu de ações e confirme.

**Diferença para automação:** a **macro** é disparada **por uma pessoa**, quando ela quer. A
**automação** dispara **sozinha**, quando a condição acontece.

### 9.8 Horário e ausência

**Para que serve:** dizer à plataforma quando a sua empresa atende, para que fora desse horário
o cliente receba uma resposta honesta em vez de silêncio.

**Como configurar:** é definido **em cada canal** — *Configurações ➜ Canais ➜ (o canal) ➜
Configurar ➜ Horário de atendimento*.

| Campo | Significa |
|---|---|
| **Ativar horário de atendimento** | Liga a checagem |
| **Fuso horário** | O da sua operação |
| **Dias e horários** | Um intervalo por dia da semana; dias sem intervalo ficam fechados |
| **Mensagem de ausência** | O que o cliente recebe fora do horário |

💡 Escreva a mensagem de ausência com **quando** a resposta chega, não só com um pedido de
desculpas: *"Recebemos a sua mensagem. Nosso atendimento é de segunda a sexta, das 8h às 18h —
respondemos a partir das 8h de amanhã."*

⚠️ Feriado não é reconhecido sozinho. Na véspera de feriado, ajuste a mensagem ou o intervalo.

### 9.9 Automação — "quando acontecer X, faça Y"

**Para que serve:** encaminhar, etiquetar e responder sem depender de alguém lembrar.

**Como criar:**
1. **Configurações ➜ Automação ➜ Nova regra**.
2. **Nome** — descreva o efeito ("Encaminhar Instagram para o Comercial").
3. **Evento** — o gatilho:
   - *Conversa criada* — quando a conversa nasce;
   - *Conversa atualizada* — quando algo muda (estado, responsável);
   - *Mensagem criada* — a cada mensagem nova.
4. **Condições** — o "se". Podem ser combinadas por **E** (todas precisam valer) ou **OU**
   (basta uma). Exemplos: canal é *Instagram*; conteúdo contém *"boleto"*; contato tem a
   etiqueta *"VIP"*; é fora do horário de atendimento.
5. **Ações** — o "então": atribuir a um time ou agente, aplicar etiqueta, enviar mensagem,
   enviar e-mail para alguém da equipe, mudar o estado da conversa.
6. Salvar e **testar com uma mensagem de verdade**.

**Três receitas que valem para quase toda operação:**

| Objetivo | Evento | Condição | Ação |
|---|---|---|---|
| Direcionar por canal | Conversa criada | Canal = Instagram | Atribuir ao time Comercial |
| Priorizar cliente antigo | Conversa criada | Contato tem etiqueta *VIP* | Atribuir ao agente responsável + etiqueta *Prioridade* |
| Avisar fora do horário | Conversa criada | Fora do horário de atendimento | Enviar mensagem de ausência |

⚠️ **Regra demais atrapalha.** Quando duas regras agem sobre a mesma conversa, a ordem importa e
o resultado fica difícil de prever. Crie uma, observe uma semana, crie a próxima.

| Erro comum | Causa | Saída |
|---|---|---|
| A regra não dispara | O evento escolhido não é o certo (ex.: *conversa atualizada* quando o caso é *criada*) | Reveja o evento antes de mexer nas condições |
| Dispara em conversa que não devia | Condições ligadas por **OU** quando deviam ser **E** | Troque o conector |
| Cliente recebeu duas respostas automáticas | Duas regras com ação de mensagem | Desative uma |

### 9.10 Pesquisa de satisfação (CSAT)

**Para que serve:** perguntar ao cliente, ao fim do atendimento, como foi. É o que alimenta o
indicador de satisfação do Painel e dos Relatórios.

**Como ligar:** *Configurações ➜ Canais ➜ (o canal) ➜ Configurar ➜ **Pedir avaliação ao
resolver***.

**Como funciona:** ao clicar em **Resolver**, o cliente recebe a pergunta e responde com uma
nota. A nota entra na ficha da conversa e nos relatórios.

💡 Não ligue em todos os canais de uma vez. Comece por um, veja a taxa de resposta e o texto que
funciona.

⚠️ Pesquisa em conversa **muito curta** (uma pergunta e uma resposta) costuma irritar. Se for
possível, restrinja o envio às conversas com mais trocas.

### 9.11 Integrações e aplicativos

**Para que serve:** ligar o Ragnabot a outros sistemas.

- **Webhooks** — a cada evento (conversa criada, mensagem enviada), a plataforma avisa um
  endereço do seu sistema. É o caminho para integrar com ERP e CRM.
- **Painel de aplicativo** (*dashboard app*) — permite exibir uma tela do seu sistema **dentro**
  da conversa, ao lado dos dados do contato. É como se mostra o pedido do cliente sem sair da tela.
- **Chaves de acesso (API)** — para desenvolvedores.

⚠️ Integração é assunto técnico. Peça ao NOC: uma chave mal configurada pode expor dado de
cliente para fora.

### 9.12 Segurança e acesso

| Item | O que é |
|---|---|
| **Senha** | Cada pessoa troca a sua em *Perfil ➜ Senha*. Mínimo recomendado: 12 caracteres, sem relação com o nome da empresa |
| **Verificação em duas etapas (2FA)** | Além da senha, um código de seis dígitos do aplicativo do celular. ⏳ Em implantação no padrão do NOC (código pelo aplicativo + e-mail) |
| **Sessões ativas** | Onde a sua conta está aberta, com opção de encerrar as demais. ⏳ Não confirmado nesta edição da plataforma; enquanto isso, ao desconfiar de acesso indevido, **troque a senha** — isso encerra as sessões abertas |
| **Login único (SSO)** | Entrar com a conta corporativa. ⏳ Não disponível nesta edição |

⚠️ Ao **desligar alguém da equipe**, remova o agente **no mesmo dia** (9.2). O histórico dele
continua íntegro; o que acaba é o acesso.

### 9.13 Registro de auditoria

**Para que serve:** saber **quem fez o quê e quando** — quem trocou uma configuração, removeu um
agente, exportou contatos.

⏳ **Ainda não disponível nesta instalação.** O registro por ação de atendente está previsto na
etapa de produção do projeto (item 2.9 do mapa de etapas). Enquanto isso, mudanças de
infraestrutura ficam registradas no NOC, e o histórico das conversas — que é o que mais importa
no dia a dia — **é imutável e completo** desde já: cada mensagem guarda autor e horário.

### 9.14 Plano e cobrança

**Para que serve:** ver o plano contratado, os limites (agentes, canais, volume) e as faturas.

⏳ **Ainda não disponível.** A cobrança recorrente com integração ao Efibank está planejada para
a etapa de SaaS (item 5.3). Enquanto isso, o plano é acordado diretamente com a Ragnatela e a
cobrança segue o processo comercial normal.

---

## 10. Meu perfil, avisos e disponibilidade

Clique no seu nome, no pé do menu lateral.

| Item | O que faz |
|---|---|
| **Perfil** | Nome, foto, e-mail, assinatura de mensagem |
| **Senha** | Trocar a sua senha |
| **Notificações** | Escolher o que avisa: no navegador, por e-mail, com som |
| **Disponibilidade** | Disponível · Ocupado · Ausente (capítulo 1.3) |
| **Idioma** | Idioma da interface para você |
| **Sair** | Encerra a sessão neste computador |

**Recomendação de notificações para quem atende:**

- ✅ **Aviso no navegador** para conversa atribuída a mim e para menção — é o que garante que
  você não perca um chamado;
- ✅ **Som** ligado;
- ⬜ **E-mail** desligado durante o expediente (vira ruído), ligado para menções, se você
  costuma sair da tela.

⚠️ Se os avisos não aparecem, é quase sempre **permissão do navegador**: clique no cadeado ao
lado do endereço e autorize notificações para o site.

---

## 11. Usando pelo celular

A plataforma funciona no navegador do celular, com a mesma conta.

- O menu principal desce para o **pé da tela** — a mão alcança o pé com o polegar, o topo não.
- A **lista** e a **conversa** viram telas separadas; o botão de voltar retorna à lista.
- Os dados do contato ficam num botão no alto da conversa.
- 🧭 Na interface nova, todos os alvos de toque têm ao menos 44 pixels de altura, para não errar
  o botão. Na tela de hoje o aplicativo é responsivo, mas essa medida ainda não foi verificada
  botão a botão (item 9.7 do mapa de etapas).

💡 **Adicione à tela de início:** no menu do navegador, escolha *Adicionar à tela de início*. Um
ícone aparece como se fosse um aplicativo, abrindo direto na plataforma.

⚠️ O celular é ótimo para **acompanhar e responder pontualmente**. Para configurar canais,
automações e relatórios, use o computador — são telas com muitos campos.

---

## 12. Catálogo geral de erros — os quinze mais frequentes

| # | Sintoma | Causa provável | O que fazer |
|---|---|---|---|
| 1 | Não consigo entrar | Senha errada ou usuário desativado | ⏳ Enquanto o envio de e-mail da plataforma não estiver ligado (item 3.1), **"Esqueci minha senha" não envia mensagem**: peça a redefinição ao administrador da sua empresa ou ao suporte da Ragnatela |
| 2 | Entrei e a tela ficou em branco | Página velha em cache | **Ctrl + F5**. Se persistir, teste em janela anônima |
| 3 | O cliente não recebeu a resposta | Estava na aba **Nota interna** | Reenvie pela aba **Responder** |
| 4 | Não chegam mensagens novas | Aba parada há muito tempo, ou canal caído | **F5**; se continuar, teste o canal em Configurações |
| 5 | WhatsApp recusa o envio | Fora da janela de 24 horas | Use um modelo aprovado |
| 6 | Instagram/Messenger pararam | Token da página expirado | Renove em *Configurações ➜ Canais ➜ Configurar* |
| 7 | E-mail nosso cai no spam do cliente | SPF/DKIM ausentes | Acione o responsável pelo domínio |
| 8 | Conversa sumiu | Resolvida, adiada ou transferida | Procure em **Resolvidas** ou na busca |
| 9 | Ninguém pega as conversas | Todos como Ausente, ou distribuição desligada | Confira disponibilidade e a configuração do time |
| 10 | Números do relatório estranhos | Fuso horário errado na conta | *Configurações ➜ Dados da empresa* |
| 11 | Contatos duplicados | Mesma pessoa por canais diferentes | Mesclar contatos |
| 12 | Importação de planilha falhou | Colunas alteradas ou arquivo não é CSV | Refaça a partir do modelo |
| 13 | Campanha sem entrega | Segmento vazio ou telefones sem `+55` | Confira o segmento antes de agendar |
| 14 | Automação não dispara | Evento errado | Reveja o evento antes das condições |
| 15 | Não vejo um menu | Você é atendente e o menu é de administrador | É por desenho; peça acesso a quem responde pela conta |

---

## 13. Perguntas frequentes

**O cliente vê a nota interna?**
Não. Nunca. A nota interna tem fundo âmbar, cadeado e a frase *"Isto fica só para a equipe"* —
quatro sinais somados, justamente para não haver dúvida.

**Resolver a conversa apaga o histórico?**
Não. Ela sai da lista de abertas e vai para **Resolvidas**. Se a pessoa escrever de novo, a
mesma conversa reabre com tudo o que já existia.

**Dois atendentes podem responder a mesma conversa?**
Tecnicamente sim, mas a plataforma mostra quem é o **responsável**, e é ele quem conduz. Antes
de entrar numa conversa de outra pessoa, escreva uma nota interna avisando.

**Por que não consigo mandar mensagem no WhatsApp para quem não me escreveu?**
É regra do WhatsApp. Só é possível iniciar contato com um **modelo aprovado pela Meta**
(capítulo 6.5). Não é limitação do Ragnabot.

**O que é a "janela de 24 horas"?**
O período em que se pode conversar livremente no WhatsApp, contado a partir da **última mensagem
do cliente**. Fora dela, só modelo aprovado.

**Perdi minha senha.**
⏳ **Hoje o pedido não chega por e-mail** — o envio de e-mail da plataforma ainda não está ligado
(item 3.1 do mapa de etapas). Peça a redefinição ao **administrador da sua empresa** ou ao
**suporte da Ragnatela**. Quando o envio for ligado, o caminho passa a ser o normal: **Esqueci
minha senha** na tela de entrada, link por e-mail (conferindo o spam).

**Posso usar em dois computadores ao mesmo tempo?**
Pode. As duas telas ficam sincronizadas. Só lembre de **sair** em computador compartilhado.

**A conversa é apagada depois de um tempo?**
Não. A plataforma não apaga conversa por tempo; a retenção segue o contrato com a Ragnatela. O
**texto das conversas** fica no banco de dados, que é replicado para uma segunda máquina em tempo
real. ⚠️ **Rotina de backup dos bancos (cópia imutável e restauração no tempo) é item do plano
ainda pendente** (itens 2.1 e 2.2, adiados por decisão para depois do piloto) — replicação
protege contra falha de uma máquina, **não** contra apagamento acidental. Os **anexos** seguem a
ressalva da pergunta anterior.

**Consigo exportar as conversas?**
Os relatórios exportam **números** e listas. Para exportar o conteúdo das mensagens (por
exigência legal, por exemplo), abra chamado com a Ragnatela.

**Quem consegue ver as conversas da minha empresa?**
Os usuários da sua conta e, quando acionada para um chamado, a equipe da Ragnatela. Cada empresa é
uma **conta separada** na plataforma, e um usuário só enxerga as contas de que participa —
isolamento entre empresas é requisito de projeto (capítulo 2.2). O **teste dirigido** que
documenta essa separação está no plano e ainda será executado (item 3.5).

**Quantos atendentes cabem?**
Depende do plano contratado. Tecnicamente a plataforma escala; o limite é comercial.

**A plataforma cai quando um servidor cai?**
Depende de qual servidor. O que é verdade hoje, sem arredondar:

- O **agrupamento de servidores** tem três máquinas, em **dois locais diferentes**, e sobrevive à
  perda de uma delas.
- O **banco de dados** é replicado continuamente para uma segunda máquina. Nenhuma conversa
  depende de um disco só. ⚠️ A troca de papéis entre banco principal e réplica é **manual, por
  decisão de projeto** (evita dois bancos gravando ao mesmo tempo) — ou seja, existe um tempo de
  reação humana.
- ⚠️ **A aplicação, hoje, roda concentrada em um dos três servidores**, porque os **anexos**
  (imagens, PDFs, áudios) ficam em disco local. Perder **esse** servidor interrompe o atendimento
  até a aplicação ser trazida de volta em outro nó, e os anexos ali guardados dependem dessa
  máquina. Mover os anexos para armazenamento de objetos — o que solta a aplicação e permite rodar
  nos três ao mesmo tempo — é item conhecido do plano (item 2.5), adiado para depois do piloto.

A explicação completa está em `11-ESTRUTURA-RAGNABOT.md`.

**Funciona no celular?**
Funciona, pelo navegador (capítulo 11).

**Posso mudar as cores para a minha marca?**
Personalização por empresa (*white-label*) está prevista na etapa de SaaS. Hoje a plataforma usa
a identidade Ragnabot.

**Como peço ajuda?**
Pelo canal de suporte da Ragnatela. Descreva **o que você fez**, **o que esperava** e **o que
aconteceu**, com o horário. Isso resolve a maioria dos casos na primeira resposta.

---

## 14. Quinze hábitos que separam a operação boa da ruim

1. Comece o dia por **Não atribuídas**, não pelas suas — a fila coletiva é a que gera espera.
2. Atualize a **disponibilidade** ao sair e ao voltar.
3. **Transferiu, escreveu nota.** Sem exceção.
4. Etiquete **antes** de resolver: depois ninguém lembra.
5. Resolva o que terminou. Conversa aberta sem motivo estraga todos os tempos médios.
6. Use **Pendente** para o que depende de terceiro — não deixe aberta "para não esquecer".
7. Leia **Conversas anteriores** antes de responder.
8. Revise a resposta rápida antes de enviar.
9. Não prometa prazo que a operação não cumpre. É o que vira nota 1 na pesquisa.
10. Confira a aba (**Responder** × **Nota interna**) antes de cada envio.
11. Administrador: olhe **Aguardando resposta** três vezes ao dia.
12. Administrador: reveja as **etiquetas** todo mês e junte as repetidas.
13. Administrador: teste os canais toda semana com **Testar todos**.
14. Administrador: renove os tokens da Meta **antes** do aviso virar interrupção.
15. Escreva um artigo na **Central de ajuda** para cada dúvida que aparecer pela terceira vez.

---

## 15. O que ainda **não** está disponível — lista honesta

Este manual descreve a plataforma completa. Nem tudo está no ar hoje (28/08/2026). O que falta,
e por quê:

| Função | Estado | Do que depende |
|---|---|---|
| **Canal de WhatsApp oficial** | ⏳ Bloqueado | Verificação do número junto à Meta: ligação de voz, registro na Cloud API e nome de exibição. **São passos do titular da conta**, não do NOC |
| **Modelos de mensagem (HSM)** | ⏳ | Depende do item acima |
| **Campanhas pontuais por WhatsApp** | ⏳ | Depende do item acima |
| **Instagram, Messenger, Telegram, E-mail** | ⏳ | Previstos para depois do WhatsApp |
| **Registro de auditoria por atendente** | ⏳ | Etapa de produção (item 2.9) |
| **Plano e cobrança / Efibank** | ⏳ | Etapa de SaaS (item 5.3); depende de credenciais do titular |
| **Verificação em duas etapas (2FA)** | ⏳ | Etapa funcional (item 3.2), no padrão do NOC |
| **Login único (SSO)** | ❌ | Não disponível nesta edição da plataforma |
| **Prazos (SLA) automatizados** | ⏳ | Recurso de edição empresarial; a ser avaliado |
| **Personalização por empresa (white-label)** | ⏳ | Etapa de SaaS (item 5.4) |
| **Central de ajuda com domínio próprio** | ⏳ | Configuração técnica de domínio, sob demanda |
| **Interface própria do Ragnabot** (trilho *Caixa/Painel/Ajustes*, cartões de canal, Painel de indicadores) | 🧭 ⏳ Em construção | Etapa 9 do mapa. Hoje a plataforma roda a base traduzida com o tema Ragnabot aplicado. Ver a tabela 0.3 |
| **Envio de e-mail pela plataforma** (convite, "esqueci minha senha", relatório agendado) | ⏳ | Servidor de envio da plataforma (item 3.1). Enquanto isso, acesso e senha inicial são entregues pela Ragnatela |
| **Caixa de entrada do chat do site criada e em uso** | ⏳ | O recurso existe na plataforma; a caixa de entrada do piloto, com atendentes e times, é o item 3.4 |
| **Backup dos bancos (cópia imutável e restauração no tempo)** | ⏳ | Itens 2.1 e 2.2, adiados por decisão para depois do piloto. Hoje há **replicação**, que não substitui backup |
| **Anexos fora do disco local (alta disponibilidade da aplicação)** | ⏳ | Item 2.5. Hoje a aplicação fica concentrada em um nó por causa dos anexos |
| **Relatórios agendados por e-mail** | ⏳ | Depende do item 3.1 e de confirmação do recurso nesta edição |
| **Lista de sessões ativas no perfil** | ⏳ | Não confirmada nesta edição |

O que **está** funcionando hoje: plataforma no ar em `chat002.ragnatela.com.br`, sobre três
servidores em dois locais e banco replicado (com as ressalvas do capítulo 13 sobre a aplicação
concentrada em um nó); conta da Ragnatela criada; **cadastro fechado ao público**; idioma
português; tema visual Ragnabot aplicado; e os recursos de atendimento da plataforma —
conversas, contatos, times, etiquetas, respostas rápidas, macros, automações, campanhas de chat
do site, central de ajuda e relatórios — **disponíveis para serem configurados**. O que ainda não
foi feito é a montagem do piloto em si (caixa de entrada do chat do site, atendentes e times do
item 3.4).

---

## 16. Glossário

| Termo | Significa |
|---|---|
| **Agente** | Quem atende |
| **Atribuir** | Definir quem é o responsável por uma conversa |
| **Caixa de entrada** | A lista de conversas |
| **Canal / Conexão** | Uma porta de entrada (número, página, e-mail, site) |
| **Cloud API** | O serviço oficial da Meta pelo qual o WhatsApp de empresa funciona |
| **CSAT** | *Customer Satisfaction* — a nota que o cliente dá ao fim do atendimento |
| **Etiqueta** | Marca colorida de assunto |
| **Fila** | Um time, visto do ponto de vista das conversas que esperam |
| **HSM / Modelo** | Mensagem pré-aprovada pela Meta, exigida fora da janela de 24 horas |
| **Janela de 24 horas** | Período de conversa livre no WhatsApp após a última mensagem do cliente |
| **Macro** | Sequência de ações aplicada por uma pessoa, com um clique |
| **Nota interna** | Anotação visível só para a equipe |
| **Omnichannel** | Vários canais reunidos numa tela só |
| **Pendente** | Conversa parada à espera de um terceiro |
| **Resolver** | Encerrar a conversa |
| **Segmento** | Filtro de contatos salvo com nome |
| **SLA** | O tempo máximo combinado para responder e resolver |
| **Token** | Chave de acesso que autoriza a plataforma a falar com outro serviço |
| **Webhook** | Endereço para onde um serviço avisa que algo aconteceu |
| **Widget** | A janelinha de chat que aparece no site |

---

## 17. Como este manual vira a Central de Ajuda embutida

Este documento foi escrito já com a estrutura da futura Central de Ajuda. A conversão é direta:

| No manual | Na Central de Ajuda |
|---|---|
| Capítulo `##` | Uma **categoria** do portal |
| Seção `###` | Um **artigo** dentro da categoria |
| A tabela "erros comuns" de cada capítulo | Um artigo do tipo *"Resolvendo problemas em…"* |
| Capítulo 1 (Primeiros passos) | Categoria **Comece por aqui** — a primeira do portal |
| Capítulo 13 (Perguntas frequentes) | Categoria **Perguntas frequentes** |
| Capítulo 16 (Glossário) | Artigo único, ligado por links dos demais |

**Portal sugerido:** nome *Ajuda Ragnabot*; categorias, nesta ordem: **Comece por aqui** ·
**Atendimento no dia a dia** · **Contatos** · **Campanhas** · **Relatórios** ·
**Configurações** · **Perguntas frequentes**.

**Três regras de escrita a manter na conversão:**

1. **Título como o cliente pergunta**, não como a empresa fala.
2. **Um assunto por artigo.** Se o texto precisa de dois títulos diferentes, são dois artigos.
3. **Sem captura de tela com dado real de cliente.** Toda imagem deve usar dados de demonstração,
   como nos protótipos.

---

## 18. Onde este manual se conecta com o resto da documentação

| Documento | Para quê |
|---|---|
| `11-ESTRUTURA-RAGNABOT.md` | Como a plataforma é construída (servidores, banco, alta disponibilidade) |
| `10-ETAPAS-RAGNABOT.md` | O que está pronto e o que falta |
| `09-BLUEPRINT-EXECUCAO-RAGNABOT.md` | O plano completo de execução |
| `/ia/ragnabot-frontend-v2/GUIA-FRONTEND.md` | Paleta, componentes e regras visuais |
| `/ia/.claude/ragnabot-actions-log.md` | Histórico do que foi feito, dia a dia |

---

> **Manutenção deste manual:** toda função nova ou alterada entra aqui **na mesma tarefa** em que
> for entregue — capítulo do menu, campos, erros comuns e, quando for o caso, a linha do capítulo
> 15 sai da lista de pendências. Manual desatualizado gera mais chamado que manual inexistente,
> porque ensina o caminho errado com autoridade.
