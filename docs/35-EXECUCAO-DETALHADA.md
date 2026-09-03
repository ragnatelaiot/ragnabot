# 35 — PLANO DETALHADO DE EXECUÇÃO
> Escrito em 02/09/2026 a pedido do dono: *"registra tudo e monta um plano detalhado de execução
> de tudo, só me pergunte o que precisa realmente, pode seguir o máximo que der com as melhores
> práticas sem me perguntar nada"*.
>
> O **doc 34** diz O QUE construir e por quê (10 fases, 90+ itens, tudo medido).
> **Este doc diz EM QUE ORDEM, COM QUE CRITÉRIO DE ACEITE e QUANDO PARA PERGUNTAR.**
> Fonte de verdade da execução: quando um item for entregue, marca-se aqui.

---

## 0. AS LEIS QUE VALEM EM TODO SPRINT

Não são recomendações — são as regras da casa, cada uma paga com incidente:

| Lei | O que significa aqui |
|---|---|
| **Medir antes de construir** | metade do que parecia faltar já existia. Todo item começa com uma medição de 10 min |
| **Nunca segredo no git** | chave da OpenAI, token da Meta, credencial de provedor → Secret do k8s, nunca no repositório |
| **Nunca `prisma db push`** | migração versionada, sempre. O banco é Patroni com réplica |
| **Deploy só sem sessão ativa** | conferir antes de qualquer rollout; ler a saída, nunca encadear com `&&` |
| **Jamais reiniciar host Proxmox** | vale para toda automação que este plano criar |
| **Isolamento é do servidor** | esconder botão não é segurança. Todo item de visibilidade tem teste de API |
| **Versão + manual + backup** | toda entrega: `VERSAO`, `VERSOES.md`, `MANUAL.md` e backup depois de validada |
| **Lote de rebuilds** | acumular durante o sprint, **um** build/versão/deploy no fim |

---

## 1. O GRAFO DE DEPENDÊNCIA (o que trava o quê)

```
 F10.1 roteador ──┬─► F1.3 respostas rápidas (tela)
 (painel único)   ├─► F4.6 lista de agendamentos
                  ├─► F9.2.3 tela de conexões
                  └─► toda tela nova daqui pra frente        ◄── GARGALO Nº 1

 F10.3 sessão única ─► F10.4 entrada pelo menu ─► adoção real do que já existe

 F2.4 setor no modelo ─┬─► F2.2 conversa só do agente
                       ├─► F2.3 resolvidos por agente
                       └─► F2.7 etiquetas no cartão

 Análise do App (Meta) ─┬─► F3.9 botões por canal
                        ├─► F9.2.1 Embedded Signup
                        └─► F9.3 templates (HSM)

 F9.2.2 camada de provedor ─► independe da decisão A/B/C  ◄── construir já
```

📌 **Dois gargalos, e os dois são nossos** (não dependem de terceiro): o **roteador** e o
**setor no modelo de dados**. Tudo o que é caro e demorado está atrás deles.

---

## 2. OS SPRINTS

### S1 — DESTRAVAR (F1, F10.1-10.4) 🔴
**Por que primeiro:** o construtor de fluxo existe e o dono nunca o usou porque não há caminho
até ele. É o maior retorno por esforço do plano inteiro.

| Entrega | Aceite (testável) |
|---|---|
| Roteador na interface do motor | 3 rotas navegáveis; recarregar em `/fluxos` cai em `/fluxos`, não em erro |
| Casca com menu lateral | menu mostra apenas o que o papel do usuário pode ver |
| Sessão única painel → motor | logado no painel, abrir o motor **não** pede senha |
| Item de menu para o construtor | o dono chega ao construtor sem digitar URL |
| Tela de respostas rápidas | criar atalho pessoal e global; **o backend já existe**, é só tela |
| Atalho `/` na conversa | digitar `/atalho` insere o texto |

**Risco:** a sessão única cruza dois sistemas de autenticação. Se der mais de meio dia, entrega-se
o item de menu (10.4) sozinho — ele já resolve 80% da dor — e a sessão única vira S2.

### S2 — ISOLAMENTO E SETOR (F2.2, 2.3, 2.4, 2.7, 2.8) 🔴
**Por que segundo:** é segurança, e mexe no modelo de dados. Quanto mais tarde, mais caro.

| Entrega | Aceite (testável) |
|---|---|
| Setor no modelo de conversa | migração versionada; histórico por setor, não global |
| Conversa aberta só do agente | ⚠️ **teste obrigatório**: agente A pedindo a conversa de B **pela API** recebe recusa |
| Resolvidos: admin vê tudo, agente vê os dele | mesmo teste, pela API |
| Etiquetas caixa · setor · atendente no cartão | visível na fila sem abrir a conversa |
| Abas Abertas/Resolvidos/Grupos/Filtros + contadores | contador bate com a consulta |

### S3 — TESTADOR DE FLUXO + NÓS QUE FALTAM (F3.1-3.8) 🟠
Pedido explícito do dono, e o que torna o construtor utilizável de verdade.
| Entrega | Aceite |
|---|---|
| Testador (simulador de conversa no editor) | percorre um fluxo real de ponta a ponta sem enviar mensagem a ninguém |
| Nós: Pergunta · Atendente · Sub-fluxo · Randomizador · Notificação · Etiqueta | cada nó com teste de motor |
| Estatística por saída no canvas | `RagnabotFluxoNoMetricaDia` **já grava** apresentados/respondidos/CTR — é só desenhar |

### S4 — AGENDAMENTO (F4) 🟠
Construção do zero. Modelo + serviço + trabalhador + tela.
**Aceite:** agendamento único e recorrente disparam no horário, com multi-contato, anexo, opção de
abrir ticket, e registro do resultado (enviado/falhou/motivo).
⚠️ O trabalhador não pode disparar duas vezes se o pod reiniciar — **idempotência por carimbo**,
igual à lição do alerta de backup do CRCMA.

### S5 — CAPITÃO ADAPTADO (2.C.1-2.C.7) 🟠
Decisão do dono: adotar, não construir.
| Entrega | Aceite |
|---|---|
| Fronteira fluxo × IA escrita e implementada | cliente **nunca** recebe duas respostas |
| Base de conhecimento por empresa | empresa A não vê documento da empresa B |
| Teto de consumo por conta + medição de custo | custo por atendimento medido antes de abrir a todos |
| Nó "passar ao agente de IA" no construtor | |
⛔ **A chave da OpenAI fica desligada** até o dono decidir a questão de licença (edição paga).

### S6 — CONEXÕES E PROVEDOR (F9.2.2-9.2.7, F9.4) 🟠
| Entrega | Aceite |
|---|---|
| Camada de provedor (`meta_direto`/`whatsmeow`/`terceiro`) | trocar o provedor de um canal não reescreve o motor |
| Tela de Conexões (cartão, estado, desconectar, editar) | paridade com a tela 40 |
| Transferir tickets entre conexões | trocar de número sem perder histórico |
| API pública por empresa + webhook de saída assinado | HMAC-SHA256 + `Bearer`; reentrega com recuo |

### S7 — CONFIGURAÇÕES (F8) 🟡
As 13 telas do menu Configurações. Whitelabel/Empresas/Planos **só na conta que vende o SaaS**.
**Aceite:** conta de cliente que peça esses painéis **pela API** recebe recusa (não é só menu escondido).

### S8 — CANAIS OFICIAIS (F3.9, F9.2.1, F9.3) ⏳
Preso à Análise do App da Meta. **Templates (F9.3) pode começar antes** — a exigência é da Meta,
vale em qualquer caminho.

### S9 — AUTOMAÇÃO POR CAIXA (F6) e FLUXOS (F7) 🟢
Quase tudo pronto no motor (`RagnabotAtendPolitica` é mais rico que o do chat atual). É tela.

### S10 — MARCA E MIÚDOS (F5) 🟢
"Desenvolvido por Ragnatela IoT Solutions" no widget; empresa e versão no rodapé.
⛔ Na interface própria — **nunca** injetando script no painel do fornecedor.

---

## 3. O QUE EU FAÇO SEM PERGUNTAR

Autorizado pelo dono em 02/09: S1, S2, S3, S4, S6, S7, S9, S10 e a parte técnica do S5.
Toda entrega segue: medir → implementar → teste automatizado → acumular → **um** build no fim →
conferir sessão ativa → deploy → versão/manual → backup → registro no log de ações.

## 4. O QUE **PRECISA** DE VOCÊ (curto, de propósito)

| # | Decisão | Por que só você decide | Trava o quê |
|---|---|---|---|
| 1 | **Como o cliente liga o WhatsApp dele**: A oficial · B Whatsmeow · C intermediário (minha recomendação: **A como produto, B como entrada, C nunca**) | modelo de negócio e risco de banimento | S6 vira produto; **não** trava o código |
| 2 | **Licença da edição paga** para usar o Captain | jurídico/comercial | ✅ **construção liberada em 02/09** — o código fica pronto e a chave DESLIGADA; a licença só trava o dia de ligar |
| 3 | **HubSoft é usado?** | integração que ninguém usa é dívida de graça | um item do S7 |
| 4 | ~~Provedores de pagamento~~ → ✅ **RESPONDIDO 02/09: só Efí Bank** (doc 36). Restam duas escolhas de negócio: a conta é da Ragnatela ou de cada cliente? Só Pix ou também boleto/cartão? | modelo de recebimento | detalhe do S-Efí, não trava o código |

Nada disso trava o começo. **S1 e S2 já estão liberados e começam agora.**

---

## 5. PLACAR — atualizado 02/09/2026, 21h
| Sprint | Estado |
|---|---|
| S1 destravar (roteador, casca, respostas rápidas) | ✅ código pronto · no ar em v1.06.00 |
| **S-adaptador** de canal *(não estava no plano — nasceu de uma lacuna medida)* | ✅ pronto · 28 testes |
| **S-fila** do motor + executor *(idem)* | ✅ pronto · 32 testes contra Postgres real |
| **S-portaria** (webhook → motor) *(idem)* | ✅ pronto · 12 testes, corrente inteira provada |
| **S-caixas** (cadastro das conexões) *(idem)* | ✅ pronto · 15 + 14 testes |
| S3.1 testador de fluxo | ✅ pronto (o motor já existia; faltava a tela) |
| S5 Capitão | ✅ camada pronta · **desligada por decisão** |
| S-Efí pagamento Pix | ✅ pronto · **sem credencial** |
| **S-publicar** a interface *(em execução)* | 🔄 `bot.ragnatela.com.br/painel/` |
| S2 isolamento por agente e setor | ✅ código pronto · **57 medições contra banco real** · migração **não aplicada** e **não publicado** (lote do chefe) |
| S3 nós que faltam (pergunta, atendente, sub-fluxo, randomizador…) | ⏳ 9 itens |
| S4 agendamento | ✅ código pronto · **40 + 37 (Postgres real, 2 réplicas) + 29 medições, 0 reprovações** · trabalhador **DESLIGADO** (`RAGNABOT_AGENDAMENTO`) · migração **não aplicada** e **não publicado** (lote do chefe) |
| S6 conexões e provedor | ⏳ 15 itens |
| S7 configurações | ⏳ 29 itens — o maior |
| S8 canais oficiais | ⛔ preso à Meta |
| S9 automação por caixa · S10 marca | ⏳ 10 itens, quase tudo é tela |

### A virada de chave (passo deliberado, ainda não dado)
1. cadastrar o aviso (webhook) na plataforma · 2. ligar `RAGNABOT_EXECUTOR_FLUXO`
📌 **Recomendação registrada:** fazer isso primeiro numa **caixa de teste**, com o dono do outro
lado — nunca estreando em cima de conversa de cliente. Tudo o que temos é "correto por contrato"
(lido na documentação da plataforma), não observado com tráfego real.

### O que a execução ensinou, e que o plano não previa
As quatro entregas marcadas *(não estava no plano)* foram **lacunas que só apareceram medindo**:
o motor decidia certo e **não tinha braço** (adaptador), **não tinha quem o acionasse** (fila),
**não recebia a mensagem** (portaria) e **não sabia por qual canal ela veio** (caixas). Nenhuma
delas aparecia no levantamento das 40 telas — telas mostram o que falta na frente, não o que
falta no meio.

---

## 6. PEDIDOS DO DONO EM 02-03/09 — direto da tela, com ele usando

> Estes não vieram do levantamento das 40 telas. Vieram dele **abrindo o produto**. Por isso
> valem mais: telas mostram o que falta na frente; usar mostra o que falta no meio.

### 6.1 — "Por que tem outra autenticação?" · o ecossistema explicado
**A confusão é real e é nossa.** São dois programas empilhados no mesmo endereço: a plataforma
base (`/app/...`, com o login dela) e o nosso motor (`/painel/`, com o nosso). **A senha é a
mesma** — a nossa entrada valida contra a plataforma —, mas a pessoa digita duas vezes.

**O modelo que vale:** uma empresa cliente = **uma conta na plataforma + um registro no motor**,
amarrados pelo mesmo número. Cada empresa ganha **o ambiente inteiro**, igual. Só a conta-mãe
(Ragnatela) vê **Whitelabel · Empresas · Planos** — e a recusa é do servidor, não menu escondido.

| # | Item | Estado |
|---|---|---|
| 6.1.1 | **Entrada única nos dois sentidos** — quem já está na plataforma abre `/painel/` sem ver formulário. Hoje só funciona de nós → para eles | 🔄 em execução |
| 6.1.2 | **Um endereço só** — a raiz leva ao painel; `/painel/` deixa de ser lugar que se precisa saber que existe | 🔄 (com cautela: a raiz serve a plataforma) |
| 6.1.3 | **Tirar o rodapé de bastidor** do menu ("os itens com ● ainda são telas do painel de atendimento…") — é anotação de obra, não pode aparecer para cliente | 🔄 |

### 6.2 — "O que eu preencho nessa caixa de entrada?"
Campo pedia o **número** da caixa (`cwInboxId`) sendo que temos a lista sincronizada com nome e
canal. **Vira lista de escolha** ("WhatsApp Ragnatela · +55 98 3197-0997"), some quando a entrada
não for por caixa, e a guarda do servidor continua recusando caixa inexistente. 🔄 em execução.

### 6.3 — "Não consigo ligar as caixas do fluxo" 🔴 BLOQUEIO
O editor abre, cria nó, e **não liga um no outro**. Junto apareceu a tarja: *"os conectores estão
sendo desenhados por um espelho local — a rota `GET /catalogo` ainda não existe neste servidor"*.
São duas coisas: **implementar a rota** (para a tarja sumir porque o problema acabou) e achar por
que o gesto não completa. Pedido também um segundo caminho (arrastar), porque dois caminhos para
a mesma coisa é a diferença entre usar e desistir. 🔄 em execução.

### 6.4 — Botões nativos em Instagram, Facebook e Telegram
Medido: **os canais suportam botão** — quem não traduz é a plataforma base, que só converte
interativo para WhatsApp Cloud e para o widget do site. Ordem do dono: *"verifique e faça logo
para os três."*
⚠️ **O coração não é mandar o botão** — é que mensagem enviada por fora **não aparece no histórico
da conversa**, e o atendente ficaria sem ver o que o robô falou com o cliente. Tem de ser
registrada como saída, com a marca que impede realimentar o motor. E **medir** o que o clique
devolve pelo webhook (texto? carga? nada?) — se a carga se perder, o casamento é pelo texto.
Degradação para texto numerado continua como rede. 🔄 em execução.

### 6.5 — A mesa de atendimento: aceitar · espiar · escrever · transferir 🔴
Palavras dele: *"não consigo **aceitar** para ficar associada a mim; não deveria poder escrever
sem aceitar; podia ter um **olho** para ver o que tem dentro; e falta o botão de **transferência**
para outro analista e/ou setor."*

| # | Item | Nota |
|---|---|---|
| 6.5.1 | **Ver a conversa** — histórico, quem falou, mídias | 🔴 **a tela é só uma LISTA hoje**; clicar não abre nada. Prioridade acima dos botões |
| 6.5.2 | **Aceitar** (atribuir a si) | corrida resolvida no banco: dois clicando, **um** leva; o outro recebe "já foi aceita por Fulano" |
| 6.5.3 | **Espiar** (olho, leitura sem assumir) | ⚠️ vale para a **fila do seu setor**, não para conversa **de outro atendente** — o isolamento do S2 continua. Toda espiada em auditoria |
| 6.5.4 | **Escrever só se for minha** | recusa **do servidor**: enviar pela API em conversa alheia é recusado. Esconder campo não é regra |
| 6.5.5 | **Transferir** para atendente e/ou setor | muda quem enxerga **na hora**; sem destinatário volta à fila do setor; tudo auditado |
| 6.5.6 | Administrador | **decidido: também aceita antes de escrever**, com um clique que atribui a ele. Mensagem sem dono é responsabilidade perdida |

⚠️ **Regra reforçada:** as mensagens vivem na plataforma. **Não copiar texto de cliente para as
nossas tabelas** — duas fontes de verdade para a mesma conversa é como uma fica desatualizada, e
a que fica é sempre a que alguém está lendo.

### 6.6 — Fatos novos medidos nesta rodada
- **A conta tem tráfego real**: `#41` do WhatsApp (número do dono) e `#40` do Instagram, ambas
  *Aguardando, sem setor, sem atendente*. "Sem setor" em tudo porque **ninguém clicou em
  "Sincronizar setores"** ainda.
- **O botão de criar fluxo sumia por uma linha de CSS** (`@media (max-width:900px){.capa__acoes{display:none}}`)
  — apagava a ação principal de **oito telas**, invisível para qualquer medição de rede. Corrigido
  na v1.11.01, com teste que lê o **CSS construído** e foi verificado falhando ao reintroduzir o defeito.

### 6.7 — Interrupção de 03/09
As quatro frentes acima caíram juntas por **erro temporário do servidor (529)**, não por defeito
do trabalho. Todas retomadas do ponto exato. Lição operacional registrada: com vários agentes na
mesma árvore, **commitar por caminho explícito**, nunca `git add -A`.

### 6.8 — Tempo real, sem botão e sem recarregar a página 🔴 (ordem do dono, 03/09)
> *"essa parte não deve ser necessário clicar em sincronizar; a atualização deve ser em tempo real,
> e inclusive sem atualizar a página, como é hoje no chat atual."*

Ele está certo, e isso vale para **toda** a caixa, não só para setores. Botão "Atualizar" e botão
"Sincronizar setores" são muleta: numa mesa de atendimento, conversa nova tem de **aparecer
sozinha**, e mudança de estado tem de refletir sem F5.

| # | Item | Nota |
|---|---|---|
| 6.8.1 | **Setores sincronizam sozinhos** — no arranque e periodicamente, como já acontece com as caixas (15 min). O botão vira reforço, não o caminho | |
| 6.8.2 | **Conversa nova aparece sozinha** na lista, sem recarregar | o webhook já recebe cada mensagem; falta empurrar para a tela |
| 6.8.3 | **Mudança de estado reflete ao vivo**: aceita, transferida, resolvida, novo contador nas abas | contador que mente é pior que contador ausente |
| 6.8.4 | **Mensagem nova dentro da conversa aberta** aparece sem F5 | |
| 6.8.5 | Queda de conexão **reconecta sozinha** e recupera o que perdeu | tela que congela em silêncio é pior que tela que avisa |

⚠️ **A ARMADILHA QUE DEFINE ESTA ENTREGA — duas réplicas.** O motor roda em **2 pods**. Um evento
chega no pod A e o atendente está conectado ao pod B: sem canal compartilhado, **ele nunca recebe**
— e o defeito é intermitente, some quando se testa com um pod só, e volta em produção. A resposta
é canal comum (Redis, que já existe no ambiente), não afinidade de sessão.

⚠️ **Não copiar texto de cliente para as nossas tabelas** — vale aqui também: o aviso em tempo real
carrega *que houve* mensagem, e a tela busca o conteúdo na fonte.

#### ✅ ENTREGUE na v1.14.00 (03/09/2026) — os cinco itens

| # | Estado | Como ficou |
|---|---|---|
| 6.8.1 | ✅ | Trabalhador próprio (`ragnabot-setores-sincronia.service.js`): arranque + 15 min, igual ao das caixas. O botão virou reforço. `/saude` → `cadastroDeSetores` |
| 6.8.2 | ✅ | Aviso empurrado do webhook (funil único: `projetarNaCaixa`), tela recarrega com freio de 400 ms |
| 6.8.3 | ✅ | Aceita/transferida/resolvida refletem; contadores vêm do servidor, do mesmo construtor de `where` da listagem |
| 6.8.4 | ✅ | `ConversaAberta` recebe `sinalAoVivo` e relê o histórico em silêncio (sem piscar, sem perder o que está sendo digitado) |
| 6.8.5 | ✅ | Recuo exponencial com sorteio (1 s→30 s), selo «Reconectando…» na tela, e recarga TOTAL a cada (re)conexão |

**A armadilha das duas réplicas: resolvida e PROVADA.** Canal comum por `LISTEN/NOTIFY` do
PostgreSQL. `app/tests/ragnabot-tempo-real.test.mjs` sobe **dois processos de verdade** (PIDs
diferentes) contra o mesmo banco: o evento publicado por um chega ao cliente conectado ao outro. E
o teste foi verificado **reprovando** quando o canal comum é desligado.

**Transporte: SSE.** Motivo decisivo: é um `GET` comum e passa pelo MESMO guarda de sessão das
outras rotas; WebSocket exigiria um segundo caminho de autenticação, escrito à mão, no ponto mais
sensível do sistema.

⚠️ **Achado de passagem, para quem cuida do proxy:** a cópia versionada do vhost
(`app/deploy/nginx/bot-painel.conf`) está **defasada** em relação ao que está no ar — faltam nela as
duas linhas de `Upgrade`/`Connection` que o vhost real tem. Aquele arquivo é fonte de recriação do
ambiente do zero; enquanto divergir, uma recriação sairia diferente do original em silêncio.

---

## 7. DECISÕES DE 03/09 — autorizadas pelo dono

### 7.1 — Credencial do Instagram: usar a que existe, apertar o cinto depois
**Medido:** o token de usuário de sistema que o marketing já usa tem **29 escopos**, entre eles
`instagram_manage_messages` e `pages_messaging`, e por ele se obtém o **token da Página**. Ou seja,
**o dono não precisa fornecer nada** — o que faltava era do nosso lado: o token mora no NOC e o
motor não o alcançava.

⚠️ **Ressalva de segurança registrada:** é o **mesmo** token que publica conteúdo. Dá ao motor mais
poder do que ele precisa. Por isso foi construído de modo que **trocar por um token só de mensagens
seja trocar um valor no Secret, sem mexer em código**.
**Ordem seguida:** destravar agora com o que existe; separar depois, se o dono quiser.

📌 **Correção importante ao que estava escrito antes:** **Telegram e Facebook já desenhavam botão**
pela plataforma — o defeito era a **nossa** tabela `CAPACIDADES` dizendo `interativo:false`. Só o
**Instagram** precisa do caminho nativo. E havia um defeito cruel no Telegram: o clique volta com o
**código** da opção e nós comparávamos contra os **títulos** — o cliente tocava no botão certo e
ouvia "não entendi".

### 7.2 — Endereço único: pendente de autorização de infra
`location = / { return 302 …/painel/; }` — casamento **exato**, só a raiz pelada; `/app/`, `/auth/`,
`/api/`, `/cable`, `/widget`, `/packs/` intocados; **302 e não 301**, para voltar atrás sem pedir
limpeza de cache a ninguém. Escrito e **não aplicado**: a escrita no nginx do proxy compartilhado
(~20 domínios) foi recusada pelo sistema de permissão, e o agente **parou em vez de contornar**.
Linhas prontas em `deploy/nginx/bot-painel.conf`, com o roteiro (respaldo fora de `sites-enabled` →
`nginx -t` → `reload`).

---

## 8. ⚠️ COMO ESTA DOCUMENTAÇÃO DEVE SER ESCRITA (ordem do dono, 03/09)

> *"lembre-se que depois tudo isso virará documentação em **docx** também, para conhecimento dos
> analistas."*

Isso muda **como** se escreve daqui para a frente, não só o que se escreve:

1. **O leitor final é o analista, não o programador.** Nome de arquivo, nome de função e código de
   erro entram como **detalhe de apoio**, nunca como a explicação principal.
2. **Toda funcionalidade precisa de um trecho "o que muda para quem usa"**, em português claro —
   é ele que vira o parágrafo do docx. Os contratos já exigem essa frase de cada agente; ela deixa
   de ser cortesia e passa a ser **matéria-prima da documentação**.
3. **O que está guardado mas ainda sem efeito tem de estar dito** — a tela já diz; o documento
   também precisa. Analista lendo manual e encontrando ajuste que não faz nada perde a confiança
   no manual inteiro.
4. **Passo a passo com o caminho na tela**, não com a rota da API: *"Atendimentos → Aceitar"*, e
   não `POST /api/ragnabot-caixa/:id/aceitar`.
5. **O que exige decisão ou credencial do dono fica numa lista à parte** — analista não deve
   tropeçar em pendência que não é dele.
6. **Fonte canônica:** `docs/MANUAL.md` (produto, para quem usa) e este doc 35 (execução, para
   quem constrói). O docx nasce do **MANUAL**, com o histórico do `VERSOES.md` como anexo.
