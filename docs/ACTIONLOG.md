# 📜 ACTIONLOG — Construção do Ragnabot
> LOG CANÔNICO local da construção (regra do dono, 27/08). Espelho versionado no repo:
> `ragnatelaiot/ragnabot` → docs/ACTIONLOG.md. Sem segredos, por lei.

## 2026-09-03 — S-INTERRUPTOR: o robô liga e desliga por caixa, na tela do dono (v1.17.02, no ar) ✅

**Ordem do dono:** *«preciso eu mesmo ter o poder dessa decisão. No momento usar apenas para o
WhatsApp, mas a qualquer momento posso incluir outra caixa ou remover se quiser.»*

Até hoje, ligar o robô era editar `RAGNABOT_EXECUTOR_FLUXO` no `ConfigMap` e reiniciar os pods:
quem decidia sobre o **atendimento** era quem tinha acesso ao **cluster**.

### 1. O interruptor, caixa por caixa
- `RagnabotInbox.roboAtende` (padrão **false**, falha fechada) + `roboAtendeEm` + `roboAtendePorUserId`.
- Migração versionada `app/prisma/sql/interruptor/01-rb_robo_por_caixa.sql`, aplicada com
  `psql -v ON_ERROR_STOP=1` **no líder medido na hora** (`pg132` = `t`, `pg133` = `f`).
  **Zero `DROP` executável** — conferido por script que ignora comentários antes de aplicar. As 3
  chaves compostas conferidas **depois**: `rb_no_versao_fk`, `rb_aresta_versao_fk`,
  `rb_exec_versao_fk`, todas de pé.
- `PUT /conexoes/:cwInboxId/robo` com `exigirAdmin` **primeiro**; interruptor no cartão da tela
  **Conexões**, com o efeito escrito ao lado.
- **Onde o veto mora importa:** no *resolvedor de entrada*, não no executor. A portaria continua a
  execução **viva** antes de consultar quem atende — então desligar **não corta ninguém no meio**.
  Isso é consequência de onde a guarda cabe, e há teste que trava a ordem dos dois passos.

### 2. Configuração do fluxo (nome, descrição, entrada, caixa)
O fluxo não tinha **nenhuma** tela de edição depois de criado. Efeito concreto: o do dono nasceu
preso à caixa **34 — o WhatsApp real** — e não havia como movê-lo para o chat do site. A falta da
tela empurrava o primeiro teste para o número de verdade. Agora há botão **«Configuração»** no
cartão e no editor, caixa escolhida **por nome**, e aviso do que muda antes de gravar.

### 3. Duas bocas na mesma caixa deixaram de ser sorteio
Medido: `resolverEntrada` fazia `findFirst` **sem `orderBy`**. Com dois fluxos publicados na mesma
caixa, ganhava o que o banco devolvesse primeiro. Sintoma em produção: *«o robô respondeu o fluxo
errado»*, intermitente e sem rastro. O `00-LEIA-ME.md` **já citava** um índice único parcial para
isto — e ele **não existia** na base (5 índices, nenhum era esse). Três camadas agora: recusa 409
`CAIXA_JA_ATENDIDA`, índice `rb_fluxo_uma_boca_por_caixa`, e ordem **declarada** + aviso gritado.

### ⚠️ TRÊS ERROS MEUS, e como cada um apareceu
1. **Fiz o interruptor obedecer ao freio global.** Parecia razoável e **redefinia o que aquele freio
   significa** — ele desliga o *trabalhador*, não a decisão de entrada. Quebrou **6 verificações da
   portaria**, e elas estavam certas. Contrato de outro componente não se muda de passagem.
2. **Fiz a leitura do interruptor falhar FECHADA.** Soa prudente e é o contrário: o caso comum de
   «não consegui ler» é **cliente Prisma fora de passo** — o estado normal entre a migração e o
   reinício. Fechando, um rollout de rotina viraria **apagão silencioso do robô em todas as caixas**.
3. **`descreverEntrada is not defined`.** Referenciei um auxiliar que nunca escrevi; ele estourava
   **depois** do `UPDATE`. Medido no ar: a caixa do fluxo do dono mudou **e** a resposta foi 500 — a
   tela diria «não consegui» sobre algo que estava feito. `node --check` é **sintático** e não acha
   isso; quem achou foi a prova ponta a ponta. Corrigi o auxiliar **e** blindei a auditoria, que não
   podia derrubar a ação (regra que a casa já segue em outro arquivo e faltava aqui).
   ➜ **O estado foi restaurado e conferido por leitura: «Principal» de volta à caixa 34.**

### ⚠️ A armadilha que eu quase entreguei junto com o botão
Conferindo o estado real após o rollout: `roboTeto.ligado=false` — o executor está desligado por
ordem do chefe. Ou seja, o interruptor que eu entregava, **se ligado hoje**, produziria **silêncio
para cliente de verdade**: a conversa nasce, nada a faz andar, e — com execução viva — o relógio de
inatividade **não arma**, então ninguém é avisado. Não é «fila de gente». A tela dizia só «ligado,
mas parado», que se lê como inofensivo. **v1.17.02** faz servidor e tela dizerem a consequência real
e o que fazer. É a mesma doença do lote anterior: *o sistema sabe e não conta.*

### Prova por observação
- `app/tests/ragnabot-robo-por-caixa.test.mjs` (novo): **11 verificações**, sem banco e sem rede.
- **Prova ponta a ponta contra o motor publicado — 10 de 10**: ligar só no WhatsApp (com a frase do
  efeito vinda do servidor) · **ligar numa caixa não ligou nas outras** · idempotência · desligar diz
  que quem está no meio termina · caixa inexistente → 404 · **trocar a caixa do fluxo do dono
  34 → 1** · auditoria nomeando *«porta de entrada mudou de caixa 34 para caixa 1 — o fluxo estava
  NO AR»* · **duas bocas na mesma caixa recusadas com 409**. Tudo devolvido ao estado original no
  `finally`, conferido por leitura depois.
- Bateria: **30 verdes / 10 vermelhos**; worktree limpo do HEAD anterior: **28 / 10** — mesmos 10
  arquivos, mesmos códigos de saída (`DATABASE_URL` ausente no NOC). **Zero vermelho novo.**
  Frontend: 14 baterias smoke, **0 falhas**.

### A imagem e o rollout
`ragnabot-motor:1.17.02`, do **worktree do commit** `55662f7`, com
`--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Conferido **dentro do artefato**: `VERSAO`=1.17.02, o
índice pede `/painel/assets/index-EmuZzIdu.js`, **zero** `/assets/` cru e zero `/painel/app/`.
Mesma impressão digital nos três pontos (`sha256:ca25b88c…`). Rollout **2/2, zero reinícios** nos
três ciclos do dia. `/saude` nos dois pods: `1.17.02`.

⛔ **Executor de fluxo, agendamento e carteiro de webhook seguem DESLIGADOS**, medidos no processo.
**Nenhum webhook cadastrado.** Ligar é decisão do dono/chefe.

### Estado devolvido ao dono
Fluxo «Principal» na **caixa 34**, publicado. Robôs: **todos desligados** (1, 34, 35, 36).

### O que NÃO foi provado
- **Não abri o navegador do dono.** Interruptor, modal de configuração e lista de erros foram
  provados pelo pacote construído, pelas baterias SSR/jsdom e pelas rotas reais — **não** por clique.
- **Nenhum cliente real passou pelo interruptor**: com o executor desligado, o caminho completo
  (cliente escreve → robô responde) não pôde ser exercitado ponta a ponta.
- **Não há linter neste repositório.** Foi por isso que um identificador inexistente só apareceu em
  produção. Fica registrado para o chefe decidir — `node --check` não cobre esta classe de defeito.

---

## 2026-09-03 — S-PUBLICAR: os dois validadores viraram um (v1.16.00, no ar) ✅

**Relato do dono, ao vivo:** desenho fechado, barra em **VERDE** dizendo «desenho fechado», e a
caixa de publicar recusando com **«Não consegui publicar — O fluxo tem 2 erro(s) e não pode ser
publicado»**. Sem dizer quais. Selo: `primeira_publicacao · 0 conversa(s) viva(s) · 0 órfã(s)`.
Bloqueio de USO em produção — o dono não tinha como saber onde mexer.

### Os 2 erros, medidos no ar (resposta crua de `POST /fluxos/<id>/validar`)

```
{"ok":false,"erros":[
 {"codigo":"LIMITE_EXCEDIDO","campo":"nos.no_midia.config.categoria",
  "mensagem":"Categoria desconhecida. Aceitas: image, video, audio, document, sticker.","noId":"no_midia"},
 {"codigo":"SEM_NO_RESGATE","campo":"documento",
  "mensagem":"O fluxo tem nó que espera resposta, mas não define nó de resgate."}],
 "avisos":[],"temEstaciona":true,"noResgateId":null}
```

**Os dois eram defeito NOSSO.**

1. O rascunho tinha `categoria: "imagem"`. O **seletor da tela** oferecia «Imagem» e «Documento» e
   gravava os valores **em português**; o executor só aceitava o vocabulário da Meta
   (`image`, `document`). **Duas das quatro opções do seletor** produziam um fluxo impossível de
   publicar — e a mensagem apontava uma lista que o seletor nem mostrava.
2. O nó de resgate só é lido em `migrarConversas()`, no modo `retrofit_forcado`, quando uma conversa
   **viva** está parada num nó que sumiu. Este fluxo era `primeira_publicacao`, **0 conversa viva**.
   Pior: a instrução mandava marcar `config.resgate=true` — **campo que a tela não oferecia em lugar
   nenhum**. Regra impossível de cumprir não protege nada: trava o produto. Efeito real: **qualquer
   fluxo com bloco de botões/pergunta/lista era impublicável.**

### Por que os dois discordavam (medido, não suposto)

`conferirDesenho()` (tela) e `validarDocumento()` (serviço) eram implementações independentes:

| regra | tela | servidor (antes) |
|---|---|---|
| saída do caminho feliz sem destino | erro | erro |
| saída de exceção sem destino | aviso | **ignorada, calada** |
| duas ligações na mesma saída | erro | **ignorada** |
| ligação fantasma · nó órfão | erro | erro |
| **configuração de CADA nó** (`validarNo`) | **—** | erro |
| **nó de resgate** | **—** | erro |

Os 2 erros do dono caíam justamente nas duas linhas que a tela **não olhava**. Daí o verde mentiroso.

### O conserto — uma regra, um dono

- **O servidor é o único dono do veredito.** A barra do editor passou a chamar
  `POST /fluxos/:id/validar` (recuo de 500 ms) e a mostrar a resposta **dele**: o número da barra e
  o da publicação são o mesmo número por construção. Sem resposta do servidor a tela ainda mostra a
  conferência local — **mas diz que é local**.
- **A caixa de publicar LISTA os erros**: o que é, **em qual bloco** (pelo nome), o que fazer, botão
  **«Ir para o nó»** (fecha a caixa e leva a vista até lá) e, para ligação fantasma, o botão que a
  apaga. «Publicar» fica **desabilitado** enquanto houver erro, dizendo quantos são.
- **O erro aparece enquanto se desenha**: gaveta **«Problemas»** na barra de vista, com a mesma
  lista; o contador virou botão que a abre.
- O servidor **ganhou** as regras que só a tela tinha (duas ligações na mesma saída) e passou a
  **avisar** sobre saída de exceção sem destino em vez de pulá-la em silêncio.
- Todo problema sai com `noId` — é o que dá destino ao botão «Ir para o nó».
- Seletor de mídia grava o valor canônico (e ganhou «Figurinha»); o motor passou a aceitar **também**
  os nomes em português, para não punir rascunho já salvo.
- `SEM_NO_RESGATE` virou **aviso** na publicação normal e continua **erro** no retrofit forçado; a
  guarda dentro da transação segue de pé. Interruptor **«Usar este nó como resgate»** passou a
  existir, na aba Avançado do bloco.
- A recusa da publicação **nomeia** o primeiro erro em vez de só contar.

### ⭐ A PROVA QUE VALE: o dono publicou sozinho

Rollout às **15:07 (BRT)**. Às **15:09:44**, a auditoria registra:

```
ator = user cw:7 «Emmanuel Castro» · ip 45.186.120.43 · Chrome/152 (Windows)
Versão 1 publicada (fixar); 0 migrada(s), 0 resgatada(s)
```

Ele publicou o fluxo «Principal» **da tela dele**, sem intervenção nenhuma, ~2 min depois do rollout.
O fluxo agora está `estado=publicado`, versão 1, `hashEstrutura b745d830…`.

### Prova por observação (medida no ar, motor publicado)

- `POST /validar` do fluxo dele, modo `fixar`: **`ok:true`, 0 erro, 1 aviso** (`SEM_NO_RESGATE`,
  com `noId: "no_encerrar"` sugerido). Modo `retrofit_forcado`: `ok:false`, erro `SEM_NO_RESGATE` —
  a severidade muda com o modo, como projetado.
- Fluxo **descartável** criado, publicado, quebrado e apagado contra o motor publicado — 5 de 5:
  fluxo válido publica (versão 1) · fluxo com ligação faltando é recusado com
  **«Não dá para publicar: A saída "sim" do nó "no_pergunta" não leva a lugar nenhum.»** ·
  **barra e publicação dizem o MESMO número** (1 erro, `SAIDA_SEM_DESTINO`, nos dois) · toda âncora
  aponta nó existente. Apagado no `finally`; a lista voltou a ter **só** o fluxo do dono.
- `tests/ragnabot-fluxo-validacao-unica.test.mjs` (novo): **27 verificações**, incluindo a matriz
  5 documentos × 3 modos que compara os dois contadores, e a estrutural que impede a tela de voltar
  a contar sozinha.
- Bateria completa: **29 verdes / 10 vermelhos**; worktree limpo do HEAD anterior: **28 / 10** —
  **mesmos 10 arquivos**, mesmos códigos de saída (falta de `DATABASE_URL` no NOC). **Zero vermelho
  novo.** Frontend: 14 baterias smoke, todas verdes (`ligacao.smoke.mjs` ampliado, 16 medições).

### A imagem e o rollout

`ragnabot-motor:1.16.00`, construída do **worktree do commit** `a747581` (nunca da árvore de
trabalho), com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Conferido **dentro do artefato antes de
subir**: `VERSAO`=1.16.00, o índice pede `/painel/assets/index-kXa5KRQs.js`, **zero** `/assets/` cru
e **zero** `/painel/app/`. Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002` — **mesma
impressão digital nos três pontos** (`sha256:6308e8f9…`; tar `717c060f…`). Rollout **2/2, zero
reinícios**. `/saude` nos dois pods: `1.16.00`, `interface.prefixo=/painel/`.

⛔ **Executor de fluxo, agendamento e carteiro de webhook seguem DESLIGADOS**, medidos no processo.
**Zero migração** — nada sob `app/prisma/`. Nenhum webhook cadastrado.

### ⚠️ Achado de passagem — o arquivo que o `grep` não enxergava

`app/src/services/ragnabot-fluxo-publicacao.service.js` continha **três bytes NUL LITERAIS** (usados
como separador de chave composta, `${de}\0${saida}`). Consequência: `file` dizia **`data`** e o
`grep` tratava o arquivo inteiro como binário — **não achava nada** dentro de um serviço crítico de
780 linhas. Passei minutos convencido de que `validarDocumento` não existia ali. Trocados pelo
escape equivalente: mesmo caractere em execução, arquivo legível de novo por qualquer ferramenta.

### Backup, no líder MEDIDO NA HORA

`SELECT NOT pg_is_in_recovery()` = **`t` em pg132 / `f` em pg133**, medido imediatamente antes.
Backup disparado no líder (`/usr/local/bin/ragnabot-backup.py`, que **re-mede** o papel antes de
agir). Objeto `backup-postgres/ragnabot-completo_2026-09-03T18-11-20-134Z.sql.gz`, **98 702 bytes**,
Object Lock **GOVERNANCE** até 13/09. Conferido por `head_object` **+** `get_object` **da chave
exata** — nunca pela listagem. Dentro: **151 tabelas**, `RagnabotFluxoVersao` e as **3 chaves
compostas** (`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`).

### O que NÃO foi provado

- **Não abri o navegador do dono** — a lista de erros, o botão «Ir para o nó» e a gaveta «Problemas»
  foram provados pelo pacote construído e pelas baterias SSR/jsdom, **não** por clique humano. (Mas
  o dono usou a tela e publicou: o caminho principal está exercitado por gente de verdade.)
- Ele pode precisar recarregar com **Ctrl+Shift+R**: o pacote mudou de nome
  (`index-CLf83vzw` → `index-kXa5KRQs`).
- O interruptor **«Usar este nó como resgate»** foi provado no validador (teste 6c), **não** clicado.

---

## 2026-09-03 — S-DEPLOY-LOTE: três versões subiram juntas (v1.15.00, no ar)

Publicação do lote que quatro contratos deixaram pronto e nenhum publicou. No ar rodava a
**v1.12.01**; a v1.13.00 (mesa) e a v1.14.00 (tempo real) estavam construídas, provadas e **nunca
tinham subido**. As três chegaram ao usuário no mesmo instante.

### Antes de commitar
Bateria rodada à mão (o `npm run test:mjs` está quebrado no Node 22 — `node --test tests/` tenta
resolver `tests/` como módulo; defeito do script, pré-existente, não tocado). **39 arquivos**:
30 verdes, **9 reprovando por falta de `DATABASE_URL`/`RAGNABOT_TESTE_DB_URL`**. Os 9 foram
conferidos **um a um contra um worktree limpo do HEAD anterior**: mesmos 9 arquivos, mesmos códigos
de saída, mesmas razões. **Zero vermelho novo.** Os dois testes novos passam. `node --check` nos 12
arquivos tocados + validação do YAML.

### Os dois commits
- `fd3f79c` — botões nativos + cofre de segredos + credencial em 4 degraus (S-BOTOES-NATIVOS e
  S-CREDENCIAL-IG). O achado que desmonta o enunciado: **Telegram e Facebook SEMPRE desenharam
  botão** (lido no código da plataforma v4.17.1); a nossa tabela `CAPACIDADES` é que mentia. E o
  defeito que doía: o casador só comparava pela **carga**, que quase nunca volta — o cliente tocava
  no botão certo e ouvia «não entendi». Agora casa por carga **ou** rótulo.
- `9100b8a` — `VERSAO` 1.15.00, bloco rico no `VERSOES.md` cobrindo as **três** versões, seção
  **5-K** no `MANUAL.md`, e a correção da cópia de recuperação de desastre do nginx.

### A cópia do proxy que mentia (achado corrigido)
`app/deploy/nginx/bot-painel.conf` não tinha `proxy_set_header Upgrade` nem `Connection
$ragnabot_conn_upgrade`, que **existem no vhost real**. Quem recriasse o ambiente do repositório
subiria um proxy sem fluxo contínuo — a caixa ao vivo voltaria a depender de F5 e ninguém saberia
por quê. Corrigida, com a dependência do `map` (que vive em `conf.d`) documentada ao lado.
⛔ **O nginx não foi tocado** — só o arquivo versionado.

### A imagem
`ragnabot-motor:1.15.00`, construída do **worktree do commit** (nunca da árvore de trabalho), com
`--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Conferido **dentro do artefato antes de subir**:
`VERSAO`=1.15.00, o índice pede `/painel/assets/index-Cwr1dwnr.js`, **zero** `/assets/` cru e zero
`/painel/app/` — esquecer o argumento não dá erro, dá tela branca com 200. Levada por SFTP aos
containerds de `rgtk8s001` e `rgtk8s002`: **mesma impressão digital nos três pontos**
(`sha256:af66cb401f5a…`). Rollout **2/2, zero reinícios**; `ragnabot-web` e `ragnabot-worker`
**não foram tocados** (6d18h de idade, intacta).

### Validação
- `/saude` **nos dois pods**: `1.15.00` · `tempoReal.canal.compartilhado: true` (tipo `postgres`) ·
  `credencialDeCanal.amarrada: true` · `cadastroDeSetores` ligado a 900 000 ms ·
  `executorFluxo`, `agendamento` e `webhookSaida` **desligados**, com motivo declarado.
- ⭐ **SSE pelo caminho PÚBLICO** (primeiro endpoint de streaming em produção), pelo proxy com
  `--resolve`, nunca pelo NOC: **200**, `content-type: text/event-stream`, `retry: 3000` e
  **`event: pronto` em 100 ms / 170 ms / 95 ms** em três aberturas.
  ⚠️ `x-accel-buffering` **não aparece** na resposta ao cliente — e isso é o **certo**: é cabeçalho
  de controle, os dois nginx o CONSOMEM. Provado batendo **direto no pod** (sem nginx nenhum no
  caminho): ali o `X-Accel-Buffering: no` aparece. O tempo abaixo de 200 ms é a prova de que não há
  buferização.
- **A mesa** pela API publicada: `#41` (WhatsApp, do próprio dono) abre com **3 mensagens**;
  `#40` (Instagram) abre com **2** (uma com anexo). ⚠️ **Não aceitei nem devolvi**: a identidade de
  serviço não está ligada a um atendente da plataforma. Exercitei o `aceitar` de propósito e ele
  **recusou com 409 `SEM_IDENTIDADE_DE_ATENDENTE`**, deixando a conversa intacta (`aguardando`,
  sem atendente) — a guarda é do servidor, não da tela.
- Telas respondendo a **F5**: `/painel/`, `/ragnabot-fluxos`, `/atendimento`, `/conexoes`,
  `/respostas-rapidas` → todas **200**. Pacote publicado = o do artefato (515 KB) + CSS 200.
- **Chatwoot intacto**: `/` e `/app/login` **200**. `/motor-api/` **403** de origem não autorizada
  e **200** do NOC (`allow 172.20.11.20; deny all` conferido no vhost).

### ⚠️ Achado GRAVE de backup, corrigido na hora
O `ragnabot-backup.service.js` dumpa **só a base `chatwoot`**. Medido hoje: o motor tem **base
própria** (`ragnabot`, 12 MB, **51 tabelas**) — é onde vivem as **3 chaves estrangeiras compostas**
(`rb_no_versao_fk`, `rb_aresta_versao_fk`, `rb_exec_versao_fk`). **Um backup só de `chatwoot`
restaura a plataforma e perde o Ragnabot inteiro.** O primeiro objeto que gerei tinha 100 tabelas e
nenhuma das chaves; refeito cobrindo as duas bases.
📌 **Pendência para o chefe:** corrigir o serviço de backup **automático**, que continua cobrindo só
`chatwoot`. Enquanto não for corrigido, **o backup diário do produto está incompleto.**

### Backup, no líder MEDIDO NA HORA
Líder re-medido **dentro do mesmo script que dumpa** (`SELECT NOT pg_is_in_recovery()` = `t` em
`pg132`/172.17.20.132, `f` no outro), com aborto se tivesse trocado no meio. Objeto
`backup-postgres/ragnabot-completo_2026-09-03T16-40-19-845Z.sql.gz`, **96 607 bytes**, Object Lock
**GOVERNANCE** até 13/09. Conferido por `head_object` **+** `get_object` **da chave exata** — nunca
pela listagem (LIST é instável no iDrive e2) — e **byte a byte idêntico** ao enviado. Dentro:
**151 tabelas**, as duas bases (`CREATE DATABASE chatwoot`, `CREATE DATABASE ragnabot`) e as **3
chaves compostas**.

### ⚠️ O que NÃO foi provado
- **Não há caixa de Telegram nem de Facebook ligada**, e o Instagram nunca recebeu um toque de
  botão real. Nada da v1.15.00 foi exercitado por um cliente de verdade. (Corrigindo o briefing:
  **já existem** as caixas `WhatsApp Ragnatela` e `Instagram-Ragnatela` — o «zero caixas» está
  vencido.)
- **Não abri o navegador do dono.** E ele precisa recarregar (Ctrl+Shift+R): o pacote mudou de nome.
- **Não aceitei conversa nenhuma** — ver acima.
- A credencial da Meta foi conferida **por impressão digital** (`80ff0e42…`, 203 bytes) e o
  `RAGNABOT_META_PAGINA_ID` no ConfigMap. Valor nenhum foi impresso. Ela passou a valer com o
  rollout, mas **não foi exercitada contra a Meta**.

⛔ Executor de fluxo, agendamento e carteiro de webhook seguem **desligados**, medidos no processo.
**Zero migração** — nada sob `app/prisma/`. Zero webhook cadastrado na plataforma.

---

## 2026-09-03 — S-LIGAR: dá para ligar as caixas do fluxo (v1.12.01, no ar)

**Relato do dono, ao vivo:** *«não estou conseguindo criar e ligar as caixas do fluxo»* — com o
editor aberto, dois nós («Início» e «Botões»), o painel do nó dizendo `ARESTA_AUSENTE` e a
instrução «toque no conector e depois no nó de destino». Ele fazia exatamente isso. Bloqueio de USO
em produção.

### A causa: a tela escondia o nó que ela mandava tocar
`tocarPino()` armava a ligação **e** chamava `setSelecionadoId(no)`. Selecionar abre o **painel de
inspeção** — 380 px à direita, e uma gaveta de 70 % da altura abaixo de 900 px. Esse painel cobre
exatamente onde costuma estar o nó de destino.

Medido em **Chromium de verdade**, com o mesmo documento do dono (confere até nos contadores: 3
erros de desenho e 5 avisos), perguntando *quem está sob o dedo no lugar do nó de destino*:

| Largura | Antes | Depois |
|---|---|---|
| 1440 · 1280 px | o nó (`no_botoes`) — ligava | o nó — liga |
| **1100 · 1024 px** | **`DIV.rgfx-lateral`** (o painel). **Não ligava** | o nó — liga |
| 820 px (toque) | o nó — ligava | o nó — liga |
| **390 px** | o nó estava **fora do quadro**. Não ligava | alcançável por «Ver tudo» — liga |

Em qualquer janela **não maximizada** — que é como o dono usa, e foi a mesma condição do defeito da
v1.11.01 — a tela pedia para tocar num nó que ela mesma acabara de esconder.

⚠️ **jsdom não pegaria isto**: não faz layout, não há caixa, não há sobreposição. Foi preciso um
navegador de verdade. Segundo buraco medido: **arrastar do conector até o nó não fazia NADA** — nem
ligava, nem armava, nem avisava. É o primeiro gesto que qualquer pessoa tenta.

### O que mudou
Uma linha a menos (`setSelecionadoId`) e o painel não é desenhado enquanto há ligação armada ·
**arraste** do conector até o nó, com fio elástico e largada por `elementFromPoint` + `data-no-id` ·
**o nó inteiro virou alvo** (inclusive os conectores dele) · botão **«Ver tudo»** na faixa, para o
caso de o destino estar fora do quadro · a faixa desceu para o rodapé e ficou `pointerEvents:none`
(a tela não pode impedir o toque que ela própria pede) · o conector deixou de ser `disabled`: sem
permissão ou sem rascunho, **a tela diz o motivo** em vez de ficar muda · nomes acessíveis nos
botões de ícone que perdiam o rótulo em tela estreita.

### `GET /catalogo` — os conectores passaram a vir do motor
A rota **não existia** e a tela desenhava por um **espelho local**, dizendo isso numa faixa amarela.
O espelho já tinha envelhecido: o motor tem **21 tipos** e ele conhecia **19** (faltavam `agente_ia`
e `pagamento_pix`). Saída que o editor não desenha é **aresta indesenhável** — foi assim que
`sem_janela` matou conversa calada. Agora **tudo sai de `saidasDe()`**, por SUBTRAÇÃO (fixas =
todas − exceção − falha), de modo que divergir é impossível. A faixa some porque o problema acabou;
o texto dela foi reescrito para o caso que sobrou (a rota não responder).

### Provado
`app/web/tests/ligacao.smoke.mjs` (15 medições de INTERAÇÃO em jsdom, no `npm test`) ·
`app/web/tests/ligacao-navegador.mjs` (**30 medições em Chromium**, 6 larguras, sobre o pacote
CONSTRUÍDO — fora do `npm test`, porque exige navegador no disco) ·
`app/tests/ragnabot-fluxo-catalogo.test.mjs` (9 medições da rota contra os executores de produção).
**Os dois primeiros foram conferidos MORDENDO**: com a correção desfeita, o de jsdom acusa o painel
e o de navegador acusa 1100, 1024 e 390 px.

### A imagem, fixada ao que já rodava
`ragnabot-motor:1.12.01`, `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. ⚠️ **Três contratos paralelos
estavam com trabalho em voo na mesma árvore** (mesa de atendimento, canal nativo, tempo real). Para
não publicar código de terceiro pela metade, o contexto de build foi **fixado ao backend da imagem
em produção**: conferido depois, o **único** arquivo de `src/` diferente do que já rodava é
`ragnabot-fluxo.routes.js` (a rota do catálogo). Dentro do artefato: `VERSAO` = `1.12.01`, o índice
pede `/painel/assets/index-OTFjWEhO.js`, zero `/assets/` cru na raiz, zero `/painel/app/`.
Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002` — **mesma impressão digital nos três
pontos** (`sha256:9045a7128b44…`). Rollout **2/2, zero reinícios, zero linha de erro**;
`ragnabot-web` e `ragnabot-worker` **não foram tocados**.

### Provado DEPOIS do rollout, pela porta pública do cluster
O índice servido pede `index-OTFjWEhO.js` · esse pacote responde **200** (492 837 bytes) e contém
«Ver tudo», «Soltei no vazio» e `data-no-id`, e **não** contém mais «cobre os 16 tipos» ·
`/motor-api/saude` diz **`1.12.01`** com `interface.prefixo = /painel/` · `/api/ragnabot-fluxo/catalogo`
responde **401** (existe e pede sessão), nunca 404. ⛔ Executor de fluxo, agendamento e carteiro de
webhook seguem **desligados**, medidos no processo. **Zero migração** — nada sob `app/prisma/`.

### Backup, no líder MEDIDO NA HORA
Líder re-medido **dentro do mesmo comando que dispara** (`SELECT NOT pg_is_in_recovery()` = `t` em
`rgtpgtgsql001`, `f` no outro), com aborto se não fosse. Objeto
`backup-postgres/ragnabot-completo_2026-09-03T15-50-40-273Z.sql.gz`, **94 867 bytes**, Object Lock
**GOVERNANCE** até 13/09. Conferido por `head_object` **+** `get_object` **da chave exata** — nunca
pela listagem. Dentro do dump: **151 tabelas** e as **3 chaves compostas** do motor.

### ⚠️ O que NÃO foi provado, e a honestidade que falta
Não abri o navegador do dono. O que medi foi um Chromium meu contra o **pacote construído**, com um
dublê do motor. O gesto dele, na sessão dele, com a empresa dela — só ele fecha essa prova.
**E ele precisa recarregar a página** (Ctrl+Shift+R): o pacote mudou de nome, mas uma aba aberta há
horas continua rodando o antigo.

⚠️ **Colisão de agentes, registrada porque custou tempo:** o `FluxosRagnabot.jsx` foi
**sobrescrito no meio do trabalho** por um contrato paralelo (voltou ao estado sem o conserto) e
depois restaurado. E `VERSAO` foi levada a `1.13.00` no disco por outro contrato **antes** desta
publicação — a versão **no ar** é `1.12.01`, medida no processo. Por isso `VERSAO` **não** entrou
neste commit, e os arquivos compartilhados (`VERSOES.md`) foram reconstruídos a partir do HEAD mais
a minha única seção.

---

## 2026-09-03 — S-CLAREZA: uma entrada só, e a caixa escolhida pelo nome (v1.12.00, no ar)

**Relato do dono, ao vivo:** *«não entendi nada, por que tem outra autenticação para acessar esse
/painel… tá muito confuso»* e, diante do formulário de criar fluxo, *«seria melhor que esse campo já
puxasse em menu lista as opções com o nome para não confundir»*. Bloqueio de USO em produção.

### 1. ⭐ A entrada única — o sentido que faltava, e a prova de que ela valida

A v1.11.00 resolveu metade: sair do nosso painel para a tela embutida não pede senha de novo. O que
o dono vivia era o inverso — quem **já** estava autenticado na plataforma, ao abrir `/painel/`,
levava a NOSSA tela de login.

`POST /sessao/adotar` fecha isso. Quando não há sessão nossa, o portão da tela pergunta ao motor se
dá para aproveitar a que a pessoa já tem lá. **Rota própria, e não dentro do `GET /sessao/eu`**, de
propósito: `GET` tem de ficar sem efeito colateral (proxy e pré-busca repetem `GET` à vontade, e
emitir credencial ali seria emitir por engano), e a rota própria dá à adoção nome próprio na
auditoria e freio próprio.

⛔ **A presença do cookie NUNCA é a prova.** `cw_d_session_info` não é `HttpOnly` — é assim por
desenho do fornecedor, porque a interface dele precisa lê-lo — então qualquer script ou pessoa com o
inspetor aberto escreve um. O motor **pergunta à plataforma de quem é a credencial** antes de abrir.

**Três fatos medidos no código da versão em uso, e os três mandam no desenho:**
- `GET /api/v1/profile` (`Api::V1::ProfilesController#show`) renderiza **a mesma parcial**
  `api/v1/models/_user` que o `/auth/sign_in` — daí `escolherConta()` servir aos dois caminhos sem
  uma linha diferente;
- `Api::BaseController` só usa o caminho do token de plataforma quando o cabeçalho `api_access_token`
  está presente. Por isso a nossa chamada **nunca** o manda: mandá-lo faria a plataforma responder
  «sim» para o **nosso** token e não para a pessoa — validação que valida a nós mesmos, a falha mais
  cara possível porque passa em todo teste ingênuo;
- `config.change_headers_on_each_request = false` no `devise_token_auth.rb`. É o que torna a
  conferência **segura de repetir**: a chamada do servidor **não gira** o token do navegador. Se
  fosse `true`, cada conferência nossa invalidaria a credencial do painel embutido e o sintoma seria
  a tela do fornecedor deslogando sozinha a cada F5.

**Nada foi afrouxado:** mesmo cookie assinado, mesmo teto de 8 h, mesmo papel medido em
`accounts[].role` da conta escolhida (nunca o do topo), mesmo escopo de empresa, mesma revogação. As
mesmas recusas continuam recusando — conta inativa, papel desconhecido, empresa suspensa.

A lógica de fim de entrada foi **extraída** para `concluirSessao()` e as duas portas passam por ela.
Duas portas com dois porteiros é como, no dia em que uma regra muda, a que esquecerem vira a porta
larga.

### 2. A caixa de entrada, escolhida pelo nome

`GET /api/ragnabot-fluxo/caixas` — a lista do escopo, com o **mesmo** `clausulaEscopo` das outras
rotas do arquivo. **Não** foi pendurada em `/api/ragnabot/inboxes`: aquele router inteiro exige
administrador do grupo RAGNATELA (é o console de OPERAÇÃO do SaaS), e quem cria fluxo é o
administrador da EMPRESA — a lista nasceria vazia justamente para quem a usa.

Na tela, `componentes/EscolhaDeCaixa.jsx`: lista com nome e identificador, campo só quando a entrada
é por caixa, e **quatro estados** — carregando, com opções, cadastro vazio (diz «Sincronizar agora»,
em Caixas de entrada) e falha (diz o motivo e deixa seguir pelo número). Valor fora do cadastro não
some em silêncio: aparece marcado como «fora do cadastro». Aplicado também ao campo «Conexão» do
agendamento, que tinha o mesmo problema.

⛔ **A lista é conveniência; a recusa continua no servidor.** `problemaNaCaixaDoFluxo()` não mudou de
lugar. Uma tela que escolhe bem erra menos; não é uma guarda.

### 3. O bastidor saiu da tela
O parágrafo do pé do menu («os itens marcados com ● ainda são telas do painel de atendimento… vamos
substituindo uma a uma») era anotação de obra no lugar onde está quem usa. Saiu, junto com as duas
regras de CSS que ficaram órfãs. **O ponto fica** — ele explica sem parágrafo. O teste que EXIGIA a
frase foi **invertido**: agora ele reprova se ela voltar.

### O que ficou medido — e as duas suítes foram conferidas QUEBRANDO o código
- `app/tests/ragnabot-sessao-adocao.test.mjs` — **19 medições**, plataforma de mentira em
  `127.0.0.1`, banco e trilha de auditoria dublados por `mock.module`. Ao trocar a conferência por
  «acredite no cookie», **12 de 19** (a medição do cookie forjado entre as vermelhas); restaurado,
  **19 de 19**. Teste que só sabe passar não prova nada.
- `app/web/tests/escolha-de-caixa.smoke.mjs` — **14 medições**, ligado ao `npm test` da interface.
- Interface: **197 medições em 12 suítes, 0 reprovações**. Motor: **26 suítes verdes**; as 7
  vermelhas são por falta de `DATABASE_URL` ou por serem de ponta a ponta — **o mesmo conjunto do
  lote anterior**, não regressão.

⚠️ **Achado honesto no meio do teste:** a primeira versão da medição «o rótulo não carrega o número»
reprovou — e estava **certa a reprovar**. Na conta 1, o `identifier` das caixas de Facebook e
Instagram **é** o próprio id na plataforma. O rótulo mostra o número porque é o identificador REAL,
não porque o acrescentamos. A medição foi reescrita para dizer isso; exigir o contrário seria
escrever um teste que manda o código mentir.

### ⛔ ZERO migração
`git status` não trouxe **nenhum** arquivo sob `app/prisma/`. Nada de `prisma db push`.

### A imagem, conferida DENTRO do artefato antes de subir
`ragnabot-motor:1.12.00`, `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Dentro da imagem: `VERSAO` =
`1.12.00`; o índice pede `/painel/assets/index-B99_Uhc9.js`; `/painel/app/` aparece **0 vez** (a
armadilha do prefixo vazando para o endereço da tela do fornecedor); a rota `/adotar` e a `/caixas`
presentes no motor; o parágrafo de bastidor **ausente** do JS e do CSS construídos.

Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002` — **mesma impressão digital nos quatro
pontos**: tar `15c65c75…` local e nos dois nós, manifesto `sha256:8987d182…` nos dois. Rollout
**2/2, zero reinícios, zero linhas de erro** nos dois pods. `ragnabot-web` e `ragnabot-worker`
**não foram tocados** (seguem em `18f280a6…`).

### ⭐ A prova em PRODUÇÃO da recusa — pela porta pública, no vhost real
Com um cookie **forjado** (`{"access-token":"inventado…","uid":"quem-eu-quiser@empresa.com.br"}`):

```
POST /painel/sessao/adotar  →  401
{"autenticado":false,"error":"CREDENCIAL_DA_PLATAFORMA_INVALIDA", …}
Set-Cookie: NENHUM
```

Esse código só é produzido **depois** de a plataforma real responder 401 à nossa consulta. Se ela
estivesse fora do ar ou tivesse devolvido HTML, o código seria `PLATAFORMA_INACESSIVEL`. É a prova
de que a validação acontece, e acontece contra ela. Sem cookie e com cookie ilegível: 401
`SEM_CREDENCIAL_DA_PLATAFORMA` **sem nenhuma ida à plataforma**.

E a lista de caixas, com sessão emitida **dentro do pod** (o segredo não sai de lá) contra
`127.0.0.1:3000`, encerrada pela rota real ao fim: `GET /api/ragnabot-fluxo/caixas` = **200**, as
**4 caixas de verdade** pelo nome — `[1] Site - Ragnatela`, `[34] WhatsApp Ragnatela ·
+559831970997`, `[35] Facebook-Ragnatela`, `[36] Instagram-Ragnatela` — e **nenhuma credencial** na
resposta.

### O vhost, e as 13 rotas a um F5
`/` = 200 e `/app/login` = 200 (o painel do fornecedor **intacto**); as 10 rotas do nosso painel =
200; arquivo inexistente = **404** (e não HTML com 200); o pacote **antigo** = 404, provando que a
casca trocou de artefato. `/motor-api/saude` responde 200 **para o NOC**, que é o endereço permitido
— a linha `allow/deny` não foi tocada.

### ⛔ Continuam desligados, medidos NO PROCESSO
`executorFluxo: false` · `agendamento: false` · `webhookSaida: false` · **zero webhooks** na
plataforma (`SELECT count(*) FROM webhooks` = 0). Nada mudou para quem conversa com a gente hoje.

### ⏳ O endereço único — MEDIDO, PROPOSTO, NÃO APLICADO
A raiz `bot.ragnatela.com.br` continua entregando o painel do fornecedor. A mudança é **`location =
/ { return 302 https://$host/painel/; }`** — casamento **exato**, só o caminho `/` pelado; `/app/…`,
`/auth/…`, `/api/…`, `/cable`, `/widget`, `/packs/…` e `/super_admin` seguem intocados, com a
injeção de tema e o guarda anti-robô no lugar. **302 e não 301**, para poder voltar atrás sem pedir
a ninguém que limpe o cache.

Medido antes de propor: no log deste vhost, quem pede `/` são navegadores humanos chegando e robôs
de busca — **nenhum serviço depende desse caminho**; e no código da plataforma a raiz é
`root to: 'dashboard#index'`, a MESMA casca de `/app/…`, então nada muda de lugar.

🔴 **A escrita em `/etc/nginx` do proxy compartilhado foi RECUSADA pelo sistema de permissão desta
sessão.** O roteiro da casa manda **parar e devolver a decisão**, não contornar — e foi o que fiz.
O vhost foi conferido depois da recusa e está **intacto** (última modificação 02/09 23:40, do
contrato anterior; nenhum respaldo novo criado). As linhas ficam prontas e comentadas em
`app/deploy/nginx/bot-painel.conf`, com o roteiro de aplicação (respaldo fora de `sites-enabled` →
`nginx -t` → `reload`, nunca `restart`).

**Efeito de borda conhecido, dito antes de acontecer:** a plataforma manda o navegador para `/`
depois do «Sair» dela. Com o desvio, quem sair por lá cai no nosso painel; se a sessão do Ragnabot
ainda valer, entra, e as telas embutidas pedirão a entrada do fornecedor — que, ao ser feita, volta
a funcionar sozinha, porque a interface dele regrava a própria credencial.

### 🔴 CORREÇÃO DE UM ERRO MEU, MEDIDO E DESFEITO NA MESMA SESSÃO — imagem `1.12.00-1`

A primeira imagem (`1.12.00`, manifesto `sha256:8987d182…`) foi construída **a partir da árvore de
trabalho**, e a árvore não era só minha: outros três agentes trabalhavam em paralelo no mesmo
repositório. O `FluxosRagnabot.jsx` já carregava, naquele instante, um pedaço **inacabado** do
editor de fluxo de outro contrato (o arraste do conector: `data-no-id`, `elementFromPoint`,
`aoArrastarLigacao`, `aoLargarLigacao`, e dois tipos de bloco novos no espelho local). Subiu junto
com o meu lote, sem revisão e sem teste.

**Como foi medido, e não deduzido:** criei uma árvore limpa no meu próprio commit
(`git worktree add … 694eb74`), construí a interface dali e comparei o artefato com o que estava no
ar. O pacote do commit é `index-B3M7qVn8.js`; o que estava servido era `index-B99_Uhc9.js` —
**3 000 bytes a mais**, e os marcadores do outro contrato presentes só no de lá.

**Desfeito:** imagem `ragnabot-motor:1.12.00-1` construída **do worktree do commit**, conferida
dentro do artefato (`data-no-id`, `aoArrastarLigacao`, `elementFromPoint`, `pagamento_pix` e a rota
`/catalogo` = **0**; `/adotar`, `/caixas` e `concluirSessao` presentes), levada aos dois nós com a
mesma impressão digital (tar `5925460d…`, manifesto `sha256:0a9f9912…`) e rolada **2/2, zero
reinícios, zero linhas de erro**. O painel passou a servir `index-B3M7qVn8.js`; o pacote anterior
responde **404**. Tudo reprovado em produção depois da troca: a recusa do cookie forjado, o 401 sem
cookie, as **15 rotas** a um F5, os vizinhos do proxy (chat001 200 · painel 200 · sisac 302) e a
lista das 4 caixas com sessão real.

⚠️ **Tag nova, e não a mesma reaproveitada.** Reescrever `1.12.00` com conteúdo diferente é
exatamente o «upgrade silencioso» que a casa fixa imagem por digest para evitar: o nó guarda por
tag, e duas coisas com o mesmo nome tornam impossível dizer o que está rodando.

**A lição, para o próximo:** com vários agentes no mesmo repositório, **construir da árvore é
construir o trabalho dos outros junto**. A imagem tem de sair de um `git worktree` no commit que se
está publicando — e o commit tem de vir antes da imagem, não depois.

**O trabalho dos outros agentes NÃO foi tocado:** continua inteiro na árvore, sem commit
(`/catalogo` + teste, arraste de ligação, adaptador de canal nativo, mesa de atendimento, e a
`v1.12.01` que um deles já escreveu em `VERSAO`/`VERSOES.md`/`MANUAL.md`). Só o que era meu foi
commitado, por caminho explícito e com os arquivos compartilhados **reconstruídos a partir do HEAD
mais as minhas três edições**, conferido linha a linha.

### Backup, no líder MEDIDO NA HORA e conferido por LEITURA DO OBJETO
⚠️ **O líder tinha trocado**: agora é **`rgtpgtgsql001`** (era `rgtpstgsql002` no lote anterior).
`SELECT NOT pg_is_in_recovery()` = `t` nele e `f` no outro, e o roteiro **re-mede dentro do mesmo
comando que dispara**, abortando se não for. Objeto
`backup-postgres/ragnabot-completo_2026-09-03T13-19-25-348Z.sql.gz`, **93 896 bytes**, Object Lock
**GOVERNANCE** até 13/09. Confirmado por `head_object` **+** `get_object` **da chave exata** — nunca
pela listagem, que no iDrive e2 já devolveu 7 e depois 0 para o mesmo prefixo. Dentro do dump:
**151 tabelas**, as **3 chaves compostas** do motor (`rb_no`, `rb_aresta`, `rb_exec_versao_fk`) e os
**dois bancos**.

### ⚠️ O que NÃO foi provado — sem navegador não dá
Registro honesto: **não abri navegador**, e uma coisa só se prova nele — que o navegador do dono,
já logado na plataforma, entre no painel **sem formulário**. Todas as camadas por baixo estão
provadas (a recusa em produção, o formato da resposta lido no código da plataforma no ar, o caminho
feliz contra um dublê fiel, a lista de caixas com sessão real em produção), mas a última milha é o
dono abrir o painel e contar o que viu.

**Estado do ambiente:** existe **1 fluxo** no banco (criado pelo dono depois da v1.11.01) — não foi
tocado. **Zero caixas de WhatsApp criadas por nós**: as 4 do cadastro são as que já existiam na
plataforma.

### Pendência que NÃO é minha, e fica registrada
`app/package.json` (+ `jsdom` em devDependencies), `app/package-lock.json` e cinco arquivos de teste
(`ragnabot-fluxo-catalogo.test.mjs`, `_monta-fluxos.jsx`, `_servidor-de-laboratorio.mjs`,
`ligacao.smoke.mjs`, `ligacao-navegador.mjs`) estão **sem commit desde o contrato S-BOTAO**. Não os
levei junto: misturá-los ao meu commit apagaria a autoria e faria subir trabalho que não medi. A
decisão de commitá-los é do chefe.

---

## 2026-09-03 — S-BOTAO: «não existe o botão de criar o fluxo» — era CSS, e foi consertado na raiz (v1.11.01)

**Relato do dono, no painel, ao vivo:** *«ainda não existe o botão de criar o fluxo»*. Bloqueio em
produção do objetivo central da construção.

### O diagnóstico — todos os suspeitos foram MEDIDOS, e todos estavam inocentes
Sessão emitida DENTRO do pod publicado (o segredo não sai de lá) e as rotas chamadas **exatamente
como a tela as chama**, pela porta pública (`Host: bot.ragnatela.com.br`, ingress `/painel/…`):

| Suspeito | Medição | Veredito |
|---|---|---|
| `podeAgora.administrarFluxos` falso | `/painel/api/ragnabot-fluxo/saude` = `{"schema":{"pronto":true},"podeAgora":{"administrarFluxos":true,"publicar":true,"modoDeTeste":true,"lerTelemetria":true}}` | inocente |
| `schemaPronto()` falso (cliente Prisma velho) | `schema.pronto = true`, os 4 componentes resolvidos | inocente |
| Sessão antiga sem o cookie novo | com cookie válido, `/sessao/eu` = 200 e as rotas de fluxo respondem | inocente |
| Permissão / papel | `POST /fluxos` devolveu **201** | inocente |
| A página caindo no ramo de indisponibilidade | nenhum 503; `erroSaude` nulo | inocente |

### ⭐ A causa real — UMA LINHA de CSS, e ela apagava OITO telas
```css
@media (max-width: 900px) { .capa__acoes { display: none; } }
```
`CapaSecao` é a barra de título de **toda** tela do painel, e `acoes` é onde mora a ação principal
de cada uma. Abaixo de 900 px de largura — celular, tablet, ou um navegador que simplesmente não
está maximizado — essa linha apagava a **única** porta de entrada de **Fluxos, Conexões, Empresas,
Agendamentos, Respostas rápidas, Caixas de entrada, Atendimentos e Testador**. Sem erro, sem log,
sem 404: o botão existia no pacote (`grep "Novo fluxo"` = 1) e o navegador o desenhava com
`display: none`. Era invisível para toda medição de rede, que é exatamente por que custou um dia.

**Agravante, e é o que o contrato mandava consertar:** o estado vazio da tela dizia «Crie o
primeiro» e **não oferecia nada para clicar** — a única porta era a da capa, justamente a apagada.

### A cura — a capa CRESCE em vez de cortar
Abaixo de 900 px a capa perdeu a altura fixa (`height: auto` + `min-height`) e as ações saíram do
posicionamento absoluto para o fluxo normal, abaixo do título, com quebra de linha. **Altura
automática sempre cabe no conteúdo** — não existe mais largura de tela em que um botão suma.
⚠️ As duas `@media` seguintes (768 px e 480 px) cravavam `height` de novo e, por virem DEPOIS na
cascata, teriam vencido a cura e reintroduzido o corte em silêncio. Viraram `min-height`.

### Botão apagado agora FALA — quatro motivos, quatro frases
`motivoSemCriar` (uma origem só): sessão vencida → **«saia e entre de novo»**; sessão aberta sem
empresa → **«saia e entre uma vez»** (a empresa é resolvida na entrada e vive dentro do cookie
assinado); migração faltando → **«não é a sua permissão, avise a Ragnatela»**; papel de atendente →
**«criar e publicar é de quem administra a empresa»**. E só desabilito o botão com a **palavra do
servidor** (`/saude`): para tudo o mais ele continua clicável e o aviso aparece por cima — quem
decide permissão é a API, e adivinhar na tela criaria um segundo dono da regra.

⚠️ **Um diagnóstico ERRADO foi retirado:** o aviso de conta sem empresa afirmava que «o campo da
empresa ainda não viaja no token de sessão». Isso deixou de ser verdade na v1.11.00. Diagnóstico
errado é pior que nenhum — mandava procurar defeito no produto quando bastava sair e entrar.

### O teste que impede a volta — e a prova de que ele morde
`app/web/tests/capa-acoes.smoke.mjs` (6 medições, no `npm test`) lê o **CSS construído**, não o
arquivo-fonte: o que chega ao navegador é o artefato. **Conferido que ele FALHA de verdade** ao
reintroduzir `display:none` (`✗ … 5 de 6`, `exit=1`) e volta a passar ao restaurar. Teste que só
sabe passar não prova nada.

### A imagem, conferida DENTRO do artefato antes de subir
`ragnabot-motor:1.11.01`, `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Dentro da imagem: `VERSAO` =
`1.11.01`; o índice pede `/painel/assets/index-38qHvnXL.js`; o CSS tem `.capa__acoes` **sem**
`display:none` e a capa com `height:auto`. Levada por SFTP aos containerds de `rgtk8s001` e
`rgtk8s002` — **mesma impressão digital nos três pontos**
(`9a282c01403f211c98752721e99b95251da21a2b64e2fd1b26e328c717d8a70a`); o nó do XSE fica de fora por
afinidade. Rollout **2/2, zero reinícios, zero linha de erro**. `ragnabot-web` e `ragnabot-worker`
**não foram tocados**. ⛔ Executor de fluxo, agendamento e carteiro de webhook continuam **`0`** —
conferido no log dos dois pods novos.

### ⛔ ZERO migração
`git status` não trouxe nenhum arquivo sob `app/prisma/`. Nada de `prisma db push`.

### Provado por observação, pela porta pública, DEPOIS do rollout
`/painel/fluxos` = **200** servindo o pacote novo · o CSS servido não esconde as ações · criado um
fluxo de verdade (**201**, com o nó de início, como a tela cria) · **apareceu na lista** (`total:1`)
· o **testador abriu** para ele e apontou o problema certo (`ARESTA_AUSENTE` — «o nó "no_inicio" não
tem para onde ir») · **arquivado em seguida** (200) · lista de volta a `total:0`. **Nenhum fluxo de
mentira ficou para trás.**

**Limpeza conferida:** os dois fluxos de prova (o de diagnóstico e o do teste final) foram
**apagados de verdade** do banco depois da prova — arquivar é apagamento **suave** por desenho
(«nada é apagado»), e deixá-los ali faria aparecerem para o dono ao marcar «Mostrar arquivados».
A remoção só passou pela rede de segurança que exige **zero execução, zero versão e nenhuma versão
publicada** em cada um. `RagnabotFluxo` de volta a **0**. Os registros de **auditoria** dos dois
(`fluxo_criado` / `fluxo_arquivado`) **ficam** — auditoria não se apaga, nem a própria.

### Nota honesta
Não consigo ver a tela do dono, então não sei a largura da janela dele — o que sei é que abaixo de
900 px o botão **não existia**, e que agora existe em qualquer largura, com uma segunda porta no
estado vazio. Se, mesmo assim, ele não aparecer, a tela agora **diz o motivo**, e o motivo vira o
próximo passo em vez de virar adivinhação.

---

## 2026-09-03 — S-DEPLOY-5: o painel passou a ser UM SÓ (v1.11.00)

Publicação do contrato S-CASCA. **Nada mudou para quem conversa com a gente hoje**: executor de
fluxo `0`, disparo do agendamento `0`, carteiro do webhook de saída **desligado** e a plataforma
com **zero webhooks** — os quatro medidos **no processo** (`/saude`) e no banco, não no ConfigMap.

### ⭐ ZERO migração — a primeira publicação do produto sem tocar no banco
`git status` não trouxe **nenhum** arquivo sob `app/prisma/` (nem `schema.prisma`, nem `sql/`).
Nada de `prisma db push`. Confirmado antes de qualquer outra coisa.

### A imagem, conferida DENTRO do artefato antes de subir
`ragnabot-motor:1.11.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Conferido
dentro da própria imagem: `VERSAO` = `1.11.00`; o índice pede `/painel/assets/index-BKTCtR-c.js`
(antes `index-DbCeiY9v.js`); `src/base/plataforma-sessao.js` presente.

⭐ **A armadilha do contrato anterior, medida NO PACOTE e não confiada ao código-fonte:** o
endereço da tela do fornecedor **não pode** receber o nosso prefixo — `/painel/app/accounts/…`
devolveria **200** com a NOSSA tela de «não encontrei» dentro do quadro (certo na rede, errado no
olho). Medido no pacote construído: `/painel/app/` aparece **0 vez**; os três alvos saem crus —
`/app/accounts/:conta/dashboard`, `/…/contacts`, `/…/reports/overview`.

Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002`: **mesma impressão digital nos três
pontos** (`03a15b3d…` no tar dos dois lados, `sha256:6bec26e8…` no manifesto dos dois nós).
Rollout **2/2, zero reinícios, zero linhas de erro** nos dois pods. `ragnabot-web` e
`ragnabot-worker` **não foram tocados** (seguem no digest `18f280a6…`).

### ⭐ A proteção que faltava — e a armadilha do `add_header` do nginx
Medido em 02/09: o `/painel/` respondia **sem** `X-Frame-Options`. A raiz do mesmo host (painel do
fornecedor) já respondia `SAMEORIGIN`; só a **nossa** metade estava descoberta — qualquer site de
terceiro podia embutir a nossa casca numa moldura invisível e colher o clique de quem estivesse
logado.

Acrescentado `add_header X-Frame-Options SAMEORIGIN always;` ao `location ^~ /painel/`.
**`SAMEORIGIN` e não `DENY`**, porque a própria casca agora embute telas do mesmo host — `DENY`
quebraria o painel único.

🔴 **ARMADILHA MEDIDA E DESVIADA:** no nginx, `add_header` do nível `server` só é herdado por um
`location` que **não declare nenhum** `add_header` próprio. Pôr ali só o `X-Frame-Options` faria o
`/painel/` **perder em silêncio** o `Strict-Transport-Security` e o `Permissions-Policy` das linhas
41-42 do vhost. Trocar uma proteção por outra não é acrescentar proteção. Os **três** foram
declarados juntos, e os três foram medidos depois do reload.

Processo: respaldo **cópia real** (não symlink) em `/root/nginx-backups/bot-ragnatela.bak-xfo-…`,
**fora** de `sites-enabled`; nenhum arquivo novo em `sites-enabled`; `nginx -t` antes de gravar,
com restauração automática se reprovasse; `nginx -t` **de novo** imediatamente antes do
`systemctl reload` (nunca `restart`). 116 `server_name` no proxy, nada quebrou. Fonte versionada
atualizada em `app/deploy/nginx/bot-painel.conf`.

### Provado por observação (de fora, pelo vhost real, com `--resolve`)
- **As 13 rotas da casca respondem 200 a um F5**: `/painel/` · caixa · conversas · contatos ·
  fluxos · testador · conexões · caixas · agendamentos · respostas-rápidas · relatórios ·
  configurações · empresas. Arquivo inexistente **404**. O pacote **antigo** dá 404 (a casca
  realmente trocou de artefato).
- **Cabeçalhos de `/painel/` depois do reload:** `x-frame-options: SAMEORIGIN` **+**
  `strict-transport-security` **+** `permissions-policy` — os três, no índice, numa rota interna e
  num arquivo do pacote.
- **Painel do fornecedor INTACTO acessado direto:** `/` 200 com o `SAMEORIGIN` dele, `/app/login`
  200, `/app/accounts/1/dashboard` 200. **Nada foi tocado nele.**
- **`/motor-api/` segue 403** para quem não é o NOC.
- **Vizinhança do proxy compartilhado intacta:** chat001 200 · site 200 · painel 200 · sisac 302.
- **`/saude` íntegro:** `status: "no ar"`, versão `1.11.00`, `interface.prefixo: "/painel/"`,
  `executorFluxo.ligado:false`, `agendamento.ligado:false`,
  `webhookSaida {ligado:false, motivo:"desligado por decisão do chefe (lote)"}`, banco `no ar`.
- **Zero webhooks na plataforma** (`SELECT count(*) FROM webhooks` no banco `chatwoot` = **0**) e
  fila do nosso webhook de saída vazia.
- **Suítes:** `ragnabot-sessao-plataforma` **17/17**; interface **223 medições, 0 reprovações** em
  11 suítes; backend **25 de 32 suítes verdes**, e as 7 restantes são todas por falta de
  `DATABASE_URL` ou por serem E2E que só rodam com variável explícita — **não regressão**, o mesmo
  conjunto do lote anterior.

### ⚠️ O que NÃO foi provado — sem navegador não dá
Registro honesto: **não abri navegador**, e três coisas só se provam nele.
1. Que o quadro realmente **desenha** a tela do fornecedor dentro da casca. A rede diz 200 e o
   `X-Frame-Options` dos dois lados é `SAMEORIGIN` (permite, mesma origem) — mas quem barra moldura
   é o navegador, em silêncio.
2. Que o cookie da plataforma **autentica** o quadro (entrar uma vez e o painel dele abrir logado).
   O teste prova o **formato** contra o que a interface dele lê, medido no pacote dele; provar que
   autentica exige entrar de verdade.
3. Que a **saída** derruba os dois lados na prática.
Além disso, a barra lateral do fornecedor aparece **dentro** do quadro — o menu duplo é conhecido e
é decisão do dono; escondê-la exigiria CSS dentro do painel dele, o que a lei da casa proíbe.

### Correção de um falso alarme meu, para não enganar a próxima pessoa
Ao conferir o índice construído, um `grep` por `src="…"` acusou `/interface/configuracao.js` sem o
prefixo. **Era texto dentro de um comentário HTML**, não uma tag — aquele script foi removido em
30/08 (contrato S4-AUTH) e o comentário existe justamente para impedir que alguém o reponha. O
índice tem exatamente **dois** recursos, os dois com o prefixo. Anotado porque um `grep` que lê
comentário como código é o tipo de verde/vermelho falso que engana na próxima leitura.

### Backup, no líder medido na hora e conferido por LEITURA DO OBJETO
Líder no instante do disparo: **`rgtpstgsql002`** (re-medido dentro do mesmo comando, com aborto se
não fosse). Objeto `backup-postgres/ragnabot-completo_2026-09-03T02-41-36-187Z.sql.gz`,
**88 987 bytes**, Object Lock **GOVERNANCE** até 13/09. Confirmado por `head_object` **+**
`get_object` **da chave exata** — nunca pela listagem, que no iDrive e2 já devolveu 7 e depois 0
para o mesmo prefixo. Dentro do dump: **151 tabelas**, as **3 chaves compostas** do motor, a trança
`RagnabotConfiguracao_escopo_coerente` e o banco da plataforma junto.

## 2026-09-02 — S-DEPLOY-4: conexões e configurações entraram no ar (v1.10.00)

Publicação do lote S6 + S7. **Nada mudou para quem conversa com a gente hoje**: o executor de fluxo
continua em `0`, o disparo do agendamento em `0`, o carteiro do webhook de saída **desligado** e a
plataforma segue com **zero webhooks** — os quatro medidos **no processo**, não no ConfigMap.

### As duas migrações, no líder MEDIDO NA HORA
`prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql` (4 tabelas + 10 colunas) e
`prisma/sql/configuracoes/01-rb_configuracoes.sql` (1 tabela). **Zero `DROP` executável** nos dois
(`grep -v '^--' | grep -ci drop` = 0). Nenhum `prisma db push`.

Líder no momento da escrita: **`pg133` / `172.17.20.133` / `rgtpstgsql002`**. O roteiro **re-mede o
líder no mesmo comando que escreve** e aborta se não for. Arquivos conferidos por impressão digital
dos dois lados (`59c9d4aa…` / `6771ded8…`, 12 221 e 6 759 bytes). Aplicados com
`psql -v ON_ERROR_STOP=1 --single-transaction` e `SET ROLE ragnabot_app`.

Medido depois: **46 → 51 tabelas**, **185 → 206 índices**, as 5 tabelas novas **todas com dono
`ragnabot_app`**, as 10 colunas novas presentes, a retrocarga do provedor certa (WhatsApp,
Instagram e Facebook → `meta_direto`; site → `nativo`), as **3 chaves estrangeiras compostas** do
motor de pé com as colunas certas, e a réplica `pg132` com tudo e **lag 0**.

### ⭐ A trança de escopo, provada COMPORTAMENTALMENTE no banco de produção
Não bastou ver a restrição no catálogo. Em transação com **ROLLBACK deliberado**:

1. linha da casa (`tenantId` nulo + escopo `casa`) → aceita;
2. linha de empresa coerente → aceita;
3. **`tenantId` da empresa A com `chaveEscopo` de outra** → recusada por
   `RagnabotConfiguracao_escopo_coerente`. **É este o vazamento que a restrição existe para
   impedir**: a empresa B leria e escreveria o ajuste guardado como sendo de A;
4. empresa com escopo `casa` → recusada; 5. casa com escopo de empresa → recusada;
6. mesma chave no mesmo escopo duas vezes → recusada pelo único `(chaveEscopo, chave)`;
7. empresa inexistente → recusada pela chave estrangeira;
8. **cascata**: apagar a empresa levou a configuração dela junto e **deixou a linha da casa** — que
   é o comportamento certo, porque o whitelabel não morre com nenhum cliente.

Depois do `ROLLBACK`: 0 linhas de configuração, 0 credenciais, 0 webhooks, e a empresa de volta.

### A variável do operador
`RAGNABOT_TENANT_OPERADOR` foi declarada no ConfigMap `ragnabot-motor-config` com o uuid do
inquilino da Ragnatela, **confirmado antes de gravar** por leitura do `RagnabotTenant` no líder
(um único inquilino, slug `ragnatela`, conta 1 na plataforma). Conferida **no processo** depois do
rollout, e não só no ConfigMap. Sem ela, ninguém de navegador abre Whitelabel/Empresas/Planos — a
falha é **fechada**, de propósito.

### A imagem
`ragnabot-motor:1.10.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` e **conferida
dentro da própria imagem antes de subir**: o índice pede `/painel/assets/index-DbCeiY9v.js` (antes
`index-DAnUhTht.js`) e a `VERSAO` diz `1.10.00`. Levada por SFTP aos containerds de `rgtk8s001` e
`rgtk8s002` — **mesma impressão digital nos três pontos** (`294c09fc…` no tar,
`sha256:7d7bbe1c…` no manifesto dos dois nós). Rollout **2/2, zero reinícios, zero linhas de erro**.
`ragnabot-web` e `ragnabot-worker` **não foram tocados**.

### ⭐ A recusa, MEDIDA EM PRODUÇÃO (não no teste)
Três sessões de navegador emitidas **dentro do processo publicado**, pelo mesmo emissor que o login
usa — o token **não saiu do pod** — e **encerradas nas duas réplicas** ao fim, pela rota real
`/sessao/sair`:

| Quem | `/whitelabel` · `/empresas` · `/planos` | `/quem-sou` · `/paineis` |
|---|---|---|
| **Operadora** (Ragnatela, `administrator`) | **200** | 200 · `operadorVia: "empresa-operadora"` |
| Outra empresa, `administrator` | **403** `NAO_E_OPERADOR_DO_SAAS` · motivo `nao-e-a-empresa-operadora` | 200, com o **tenantId dela** |
| Outra empresa, atendente | **403**, idem | 200, com o **tenantId dela** |

Reuso depois do encerramento, nas duas réplicas: **401 `SESSAO_INVALIDA`, motivo `revogada`**.

⚠️ **Registro honesto:** numa primeira rodada (com o nome do cookie errado, tudo 401) três sessões
de medição foram emitidas e a tentativa de revogá-las **não teve efeito** — `revogarSessao()`
importado num processo auxiliar mexe na memória DAQUELE processo, não na do servidor. Os tokens
nunca foram escritos em disco, log ou saída, e morreram com o processo; permanecem nominalmente
válidos até vencerem (≤ 8 h) para quem os tivesse, e ninguém os tem. A rodada seguinte passou a
encerrar pela rota real, uma vez **por réplica** (a lista de revogadas é de memória — limite já
documentado em `base/auth.js`).

### Provado por observação
- **De fora, pelo vhost real** (`--resolve` a partir do proxy; pelo NOC o teste mente por hairpin):
  `/painel/conexoes` **200**, `/painel/configuracoes` **200**, e caixa, fluxos, agendamentos e
  testador **200**; arquivo inexistente **404**; o índice servindo o **pacote novo**.
- **As rotas novas saíram de 404 para 401** (`/api/ragnabot-conexao/…` e `/api/ragnabot-config/…`)
  — existem e exigem sessão. **Não respondem 503**, ou seja, o cliente Prisma do processo enxerga
  as tabelas novas.
- **As 4 conexões na tela nova**, com canal, provedor, estado e capacidade; e a cota do plano:
  **4 de 30 ativas (13,3%)**, discriminada por canal e por provedor (`meta_direto` 3, `nativo` 1) —
  o mesmo número que a retrocarga da migração deixou no banco.
- **`/saude` íntegro:** `status: "no ar"`, versão `1.10.00`, `interface.prefixo: "/painel/"`,
  `executorFluxo.ligado:false`, `agendamento.ligado:false`,
  `webhookSaida {ligado:false, motivo:"desligado por decisão do chefe (lote)"}`.
- **Chatwoot intacto:** raiz **200**, `/app/login` **200**. `/motor-api/` segue **403** para quem
  não é o NOC. Vizinhança do proxy compartilhado intacta (chat001 200 · site 200 · painel 200 ·
  sisac 302) e `nginx -t` bom. **Nada foi tocado no nginx.**
- **Suítes:** as 6 novas somam **184 medições, 0 reprovações**; **24 das 31 suítes `.mjs` verdes**
  (as 7 vermelhas são todas por falta de `DATABASE_URL` neste ambiente — não regressão).
  Interface: **160 medições, 0 reprovações**.

### Backup, no líder medido na hora e conferido por LEITURA DO OBJETO
`ragnabot-backup.py` rodado no primário (`rgtpstgsql002`, re-medido antes). Objeto
`backup-postgres/ragnabot-completo_2026-09-03T02-11-50-175Z.sql.gz`, **88 975 bytes**, Object Lock
**GOVERNANCE** até 13/09. Confirmado por `head_object` + `get_object` **da chave exata** — nunca
pela listagem, que no iDrive e2 já devolveu 7 e depois 0 para o mesmo prefixo. Dentro do dump:
as 5 tabelas novas, a restrição `RagnabotConfiguracao_escopo_coerente`, as colunas novas e as 3
chaves compostas do motor.

### 🔴 Armadilha nova, medida e registrada
**`sudo -n` dentro de `$( )` falha nestes nós.** O carimbo do sudo é por **PPID**, e a subshell da
substituição de comando tem PPID diferente — o cache não vale e o sudo responde «interactive
authentication is required». O roteiro de migração **abortou dizendo que o líder não era o líder**,
quando o problema era o sudo lendo a resposta de erro no lugar do `t`. A guarda funcionou pelo
motivo errado, que é exatamente o tipo de verde/vermelho falso que engana na próxima. Corrigido:
a saída vai para arquivo e é lida depois, com o `sudo` no nível de cima.

## 2026-09-02 — S-DEPLOY-3: o agendamento de mensagens entrou no ar (v1.09.00)

Publicação do agendamento (contrato S4). **Nada mudou para quem conversa com a gente hoje**: o
executor de fluxo continua em `0`, a plataforma segue com **zero webhooks**, e o disparo do
agendamento **sobe desligado** — os três medidos, no processo e não só no ConfigMap.

### A migração primeiro, no líder MEDIDO NA HORA
`prisma/sql/agendamento/01-rb_agendamento.sql` — 3 tabelas + 12 índices, **zero `DROP` executável**
(as três ocorrências da palavra estão em comentário; `grep -v '^--' | grep -ci drop` = 0, medido
dos DOIS lados). Nenhum `prisma db push`.

Líder medido antes de escrever: **`pg133` / `172.17.20.133` / `rgtpstgsql002`**, com
`SELECT NOT pg_is_in_recovery()` = `t` e o `patronictl` confirmando (`pg132` réplica, streaming,
lag 0). O roteiro de aplicação **re-mede o líder no mesmo comando que escreve** e aborta se não for
— medir há dez minutos não é medir agora.

O arquivo viajou por heredoc e foi conferido por impressão digital: `ccec7eab…55ea` **idêntica dos
dois lados**, 9 198 bytes. Aplicado com `psql -v ON_ERROR_STOP=1 --single-transaction` e
`SET ROLE ragnabot_app`.

Medido depois: 3 tabelas, **todas com dono `ragnabot_app`** (como as outras 43) · base de 43 → **46
tabelas** · 170 → **185 índices** · as **3 chaves estrangeiras compostas** de pé, com as colunas
certas (`(tenantId, versaoId) → RagnabotFluxoVersao(tenantId, id)`) · gatilho de imutabilidade
ligado · os dois índices únicos parciais do motor intactos · réplica `pg132` com as 3 tabelas e os
15 índices, **lag 0**.

### ⭐ A tranca do disparo dobrado, provada COMPORTAMENTALMENTE no banco de produção
Não bastou ver o índice no catálogo. Em transação com **ROLLBACK deliberado** (nenhuma linha de
teste sobrevive), contra a base de verdade:

1. primeira reserva da chave → aceita;
2. segunda réplica, mesma chave, pelo caminho REAL (`INSERT … ON CONFLICT ("chave") DO NOTHING`) →
   **0 linhas inseridas**;
3. sem o `ON CONFLICT` → `duplicate key value violates unique constraint
   "RagnabotAgendamentoEnvio_chave_key"` — é o **Postgres** recusando, não um `if`;
4. ocorrência seguinte (chave diferente) → aceita (senão a agenda semanal sairia uma vez na vida);
5. mesmo contato duas vezes na mesma agenda → recusado pelo único do destino;
6. depois do `ROLLBACK`: **0 envios / 0 destinos / 0 agendamentos**.

O índice é **único e NÃO parcial** (`indisunique AND indpred IS NULL` = `t`) — conferido, porque
torná-lo parcial transformaria a idempotência em decoração.

### A imagem
`ragnabot-motor:1.09.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` e **conferida
dentro da própria imagem antes de subir**: o índice pede `/painel/assets/index-DAnUhTht.js`.
Esquecer o argumento não dá erro — dá **tela branca com 200 na rede**. Também conferido na imagem:
`VERSAO` = 1.09.00, o serviço, o trabalhador, as rotas e o **SQL versionado** viajando junto.
Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002` (impressão digital idêntica nos três
pontos); o nó do XSE fica de fora por afinidade. Rollout limpo, **2/2, zero reinícios, zero linhas
de erro**. `ragnabot-web` e `ragnabot-worker` **não foram tocados**.

### ⛔ O disparo sobe DESLIGADO — e agora está DECLARADO, não implicado
`RAGNABOT_AGENDAMENTO=0` foi **escrito por extenso no ConfigMap**, embora o padrão do código já
fosse desligado na ausência da variável. Quem abrir o ConfigMap amanhã tem de **ler** que está
desligado, em vez de deduzir do silêncio.

Medido no processo (não só no ConfigMap): `EXECUTOR=[0]  AGENDAMENTO=[0]`. No `/saude`:
`agendamento {ligado:false, motivo:"desligado por padrão — ligue com RAGNABOT_AGENDAMENTO=1"}`.
E no registro, o aviso: *«as agendas continuam sendo CADASTRADAS e ficam pendentes; ninguém as
dispara até religar»*.

**A razão é boa:** o executor de fluxo RESPONDE a quem escreveu; este COMEÇA conversa. Ligado
sozinho num processo recém-publicado, com agendas vencidas no banco, dispararia de uma vez tudo o
que ficou para trás — a forma do alerta de backup que mandou 210 mensagens.

### Provado por observação
- **Ponta a ponta com agendamento de verdade:** criado para **01/01/2031** (futuro distante de
  propósito — mesmo que alguém ligue o trabalhador por engano, ele não vence), apareceu na lista da
  empresa, **gerou 0 envios**, foi **cancelado**, e a linha de teste foi apagada (base volta a 0).
- **`modeloPronto()` = true** no pod — é o que separa `200` de `503 MODELO_AUSENTE`.
- **De fora, pelo vhost real** (`--resolve` a partir do proxy; o teste pelo NOC mente por hairpin
  NAT): `/painel/agendamentos` **200**, as demais telas 200, arquivo inexistente 404, e o índice
  servindo o **pacote novo** (`index-DAnUhTht.js`, antes `index-KHGN-DXf.js`).
- **As rotas saíram de 404 para 401** (`/api/ragnabot-agendamento/opcoes` e `/`) — existem e exigem
  sessão. **Não respondem 503.**
- **Suítes:** 40 medições da parte pura + **37 contra Postgres de verdade** (duas réplicas
  disputando a mesma ocorrência, reinício no meio do disparo, multi-contato independente, fora da
  janela, cancelado, canal fora, virada do dia). **23 de 25 suítes `.mjs` verdes, 0 reprovações**
  (as 2 restantes são portões deliberados de ensaio, que recusam rodar sem variável). Interface:
  **167 medições, 0 reprovações**. Nenhum esquema `zz_teste%` sobrou.
- **Painel de atendimento intacto:** raiz 200, `/app/login` 200, `POST /auth/sign_in` sem
  verificação **401**. `/motor-api/` segue **403** para quem não é o NOC. Vizinhança do proxy
  compartilhado intacta (chat001 200 · painel 200 · sisac 302 · site 200). **Nada foi tocado no
  nginx.**

### 🔴 Três defeitos de casa achados nesta publicação (dois consertados)

1. **Os dois verificadores do motor mentiam — e um deles mentia VERDE.** Desde a ETAPA 4 da
   separação, `verificar-estrutura.mjs` e `verificar-comportamento.mjs` continuam importando o
   cliente Prisma **do NOC**. Medido: eles alcançam `ragnatela_noc` em `127.0.0.1`, onde as **20
   tabelas antigas do motor ficaram abandonadas e vazias**. O `verificar-estrutura.mjs` **respondia
   tudo verde** — índice único parcial presente, gatilho ligado, as 3 FKs compostas de pé — olhando
   a cópia morta. **Verde falso é pior que vermelho:** um vermelho manda investigar; um verde falso
   manda publicar. O `verificar-comportamento.mjs` quebrava com `Cannot read properties of undefined
   (reading 'create')`, frase que manda procurar defeito no código quando o defeito é o banco errado.
   **Consertado:** os dois ganharam guarda que **recusa e explica** (saída 2) quando a base não é
   `ragnabot`. As medições que eles fariam foram feitas **direto no líder**, por SQL (ver acima).
   ⏳ **Fica em aberto:** as 20 tabelas órfãs do motor na base do NOC, e reescrever os dois
   verificadores para rodarem de dentro do cluster.

2. **Um teste estava vermelho havia dias — e saiu vermelho na v1.08.00.**
   `tests/unit/ragnabot-nos-capitao-pix.test.js` afirmava `TIPOS.length === 19`; o catálogo já tinha
   **21** blocos (entraram o de e-mail e o de link e ninguém mexeu no número). Confirmado
   **pré-existente** rodando no HEAD limpo, sem o diff desta tarefa. **Consertado**, e passou a
   comparar **a lista inteira** em vez do tamanho: `expected 21 to be 19` não diz nada;
   um diff de lista diz **qual** bloco entrou ou sumiu.

3. **`npm run test:mjs` nunca rodou nenhuma das 25 suítes `.mjs`.** `node --test tests/` falha com
   `Cannot find module '/ia/ragnabot/app/tests'` — o corredor trata a pasta como arquivo. Ou seja,
   `npm test` passava por cima de tudo o que a casa considera a prova principal. **NÃO corrigido de
   propósito nesta publicação:** consertar faria 25 suítes passarem a rodar de uma vez, várias delas
   exigindo `DATABASE_URL`/`RAGNABOT_TESTE_DB_URL` e duas sendo portões de ensaio — é mudança de
   comportamento que merece validação própria, não um passageiro de deploy. Rodadas **à mão**, como
   manda o método da casa.

### Nota de método
Duas ações foram **recusadas pelo sistema de permissão** no meio do caminho (instalar chave SSH
efêmera num nó; subir um servidor HTTP local para transferir a imagem) — e as duas recusas estavam
certas. O caminho correto já existia e era o do deploy anterior: os nós **são dispositivos
cadastrados no NOC**, com transferência por **SFTP** e `sudo` recebendo a senha pela **entrada
padrão** (nunca em `ps`). Nenhuma credencial passou por argv, log ou git.

## 2026-09-02 — S-DEPLOY-2: a caixa de atendimento entrou no ar (v1.08.00)

Publicação do lote acumulado desde a v1.07.01. **Nada mudou para quem conversa com a gente hoje**:
o executor de fluxo continua em `0` e a plataforma segue com **zero webhooks** — medidos os dois.

### A migração primeiro, no líder MEDIDO NA HORA
`prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql` — 3 tabelas + 12 índices, **zero `DROP`
executável** (a única palavra «drop» do arquivo está num comentário). Nenhum `prisma db push`.

⚠️ **O líder tinha trocado no mesmo dia.** Medido antes de escrever: `pg133` / `172.17.20.133` /
`rgtpstgsql002`, com `SELECT NOT pg_is_in_recovery()` = `t`. Presumir o de ontem teria mandado a
migração para a réplica. Aplicado com `psql -v ON_ERROR_STOP=1 --single-transaction` e
`SET ROLE ragnabot_app` — sem o `SET ROLE`, as 3 novas nasceriam com dono diferente das outras 40.

Medido depois: 3 tabelas · 15 índices (12 + 3 chaves primárias) · base de 40 → 43 tabelas · as
**3 chaves estrangeiras compostas** (`rb_no/rb_aresta/rb_exec_versao_fk`) de pé · réplica `pg132`
com as 3 tabelas e os 15 índices, **lag 0**.

### A imagem
`ragnabot-motor:1.08.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` — conferido no
próprio índice da imagem **antes** de subir (`/painel/assets/…`), porque esquecer o argumento não dá
erro: dá **tela branca com 200 na rede**. Importada no containerd de `rgtk8s001` e `rgtk8s002`
(o motor não roda no nó do XSE, por afinidade). Rollout limpo, 2/2, **zero reinícios**.
`ragnabot-web` e `ragnabot-worker` **não foram tocados** (idade de 6 dias, intacta).

### A retrocarga contra dado real — e a divergência que vale dizer
Primeira execução contra a conta de verdade: **7 lidas · 7 criadas**; segunda passada **0 criadas ·
7 atualizadas** (idempotência), e 7 linhas no banco — uma por conversa, nenhuma duplicada.

⚠️ **A divergência, sem arredondar:** as 7 são **conversas de teste do próprio dono**, todas já
resolvidas (`open: 0 · pending: 0 · resolved: 7 · snoozed: 0`) e **todas sem setor**. Não existe
tráfego de cliente na conta. Consequência prática: a tela nasce com a aba **Resolvidos = 7** e as
outras zeradas, e um atendente que não seja o dono não vê nada — o que é o comportamento correto da
regra, não defeito. A prova de fila cheia só existirá quando houver conversa de verdade.

### Provado por observação
- Suites contra o banco DE VERDADE (por túnel do NOC → nó k8s → líder, porque o `pg_hba` recusa o
  NOC direto, e com razão): **isolamento 63/63 · retrocarga 43/43**, esquema temporário derrubado,
  **zero sobra** (`zz_teste%` = 0). ⚠️ O `MANUAL.md` dizia 57 no isolamento; **o número real é 63** —
  corrigido no texto.
- `/painel/` e `/painel/caixa` **200 de fora**, pelo vhost real com `--resolve` (o teste pelo NOC
  mente por hairpin NAT). ⚠️ E um `curl` cru também mente: o desvio-para-a-página exige
  `Accept: text/html` de propósito, então `curl` sem cabeçalho de navegador devolve **404** e parece
  falha de publicação. Com o cabeçalho: índice do pacote novo (`index-KHGN-DXf.js`), F5 em
  `fluxos/testador/caixas/respostas-rapidas/caixa/empresas` = 200, arquivo inexistente = 404,
  `/painel/api/…` = 401.
- `/saude`: `versao 1.08.00` · `interface {servida, /painel/}` · `tokenConfigurado: true` ·
  `caixasNaPlataforma: 4` · `ultimoErro: null` · `status: no ar`.
- Caixa respondendo (não mais `503 MODELO_AUSENTE`): `/opcoes`, `/contadores`, `/conversas`,
  `/setores` em 200. Sincronização trouxe **1 time e 5 vínculos de membro**.
- Painel de atendimento **intacto**: raiz 200 com tema/carregando/turnstile, `/app/login` 200,
  `POST /auth/sign_in` sem verificação 401. `/motor-api/` segue **403** para quem não é o NOC.
  Vizinhança do proxy compartilhado intacta (chat001 200 · painel 200 · sisac 302 · site 200);
  **nada foi tocado no nginx** (`nginx -t` aprovado, symlinks com data de 28/08).

### Backup, depois de validado, no líder medido de novo
`ragnabot-completo_2026-09-02T23-06-44-649Z.sql.gz` — 84 966 bytes no bucket **imutável**, Object
Lock `GOVERNANCE` retido até 12/09. Conferido por leitura direta do objeto (`head_object`), não pela
listagem — o iDrive e2 já devolveu listagem instável para o mesmo prefixo.

### ⛔ Continua desligado, de propósito
`RAGNABOT_EXECUTOR_FLUXO=0` (medido no processo do pod, não só no ConfigMap) e **zero webhooks**
(medido: `SELECT … FROM webhooks` = 0 linhas). Ligar é passo separado — recomendação registrada:
**primeiro numa caixa de teste, com o dono do outro lado**.

## 2026-09-02 — S-PUBLICAR: o painel do Ragnabot abriu para o dono (v1.07.01)

### O gargalo, medido
Tudo o que foi construído desde 28/08 (construtor de fluxo, respostas rápidas, testador, caixas)
estava publicado em `bot.ragnatela.com.br/motor-api/`, que tem `allow <IP do NOC>; deny all;` no
proxy. **Nenhum navegador de usuário chegava lá.** Cada entrega nova nascia invisível.

### O que foi feito
- **`https://bot.ragnatela.com.br/painel/` no ar.** Mesmo host (sem DNS novo, sem certificado
  novo). Ingress ganhou `path: /painel(/|$)(.*)` na MESMA Ingress do motor (`rewrite-target: /$2`),
  e o proxy ganhou `location ^~ /painel/` **antes** do `location /`.
- **`location` próprio, e não o `location /`:** aquele injeta em todo HTML o tema do painel de
  atendimento, o `carregando.js` (que só some quando o Chatwoot desenha — sobre a nossa tela
  ficaria por cima para sempre) e o widget do Turnstile. Sendo `^~`, também impede o cache de 30
  dias de `~* ^/(vite|packs|assets|brand-assets)/` de sequestrar arquivo nosso.
- **A imagem foi RECONSTRUÍDA** com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. O prefixo é
  propriedade do pacote, não do proxy: sem isso o índice pediria `/assets/…` na raiz do host — ou
  seja, ao Ingress da PLATAFORMA — e o resultado seria **tela branca com 200 na rede**.
- **`/motor-api/` intocada** — continua `allow/deny`. Provado nos dois sentidos: do proxio (origem
  fora da lista) → **403**; do NOC → **200**.
- **`RAGNABOT_PLATFORM_TOKEN` entrou no `Secret ragnabot-motor-env`.** O valor nunca passou por
  argv, histórico, log nem git: viajou pela entrada padrão do SSH, virou arquivo `0600` no nó e foi
  destruído com `shred`. Conferência pela impressão digital nos dois lados (`sha256:2fbd8ec70174`).
- **`RAGNABOT_PLATAFORMA_INTERNA=http://ragnabot-web:3000`** no ConfigMap.

### Três defeitos que só apareceram porque fomos medir
1. **O login estava QUEBRADO e ninguém sabia** (porque ninguém alcançava a tela). Medido no pod:
   `POST /sessao/entrar` → `503 PLATAFORMA_INACESSIVEL (caminho publica) ECONNABORTED`. De dentro
   do cluster o nome público não volta (hairpin) e o guarda anti-robô barra `POST /auth/sign_in`.
   Depois do conserto: **401 CREDENCIAL_INVALIDA** — a resposta certa para senha errada.
2. **`prisma.settings` era código morto** em `ragnabot-tenant.service.js` e em
   `ragnabot-sso.service.js`: a tabela `settings` ficou no NOC. O `catch` engolia um `TypeError` e
   escrevia «não consegui ler o token em Settings» — mandando quem diagnostica procurar uma linha
   de configuração que nunca poderá existir. **Removidos os dois.**
3. **A regra de rota até a plataforma existia em DOIS lugares** e as duas divergiram. A
   sincronização das caixas usava a antiga e devolveu `timeout of 20000ms` com `caixasNaPlataforma:
   0` — apanhado pelo `/saude` novo, minutos depois de subir a v1.07.00, antes de qualquer pessoa
   usar. Virou `src/base/plataforma-alvo.js`, com dono único e teste permanente
   (`tests/ragnabot-plataforma-alvo.test.mjs`, 6 medições). Foi o que motivou a v1.07.01.

### O `/saude` ficou mais honesto
`interface: {estado, prefixo}` — o prefixo é **lido do índice construído**, não de variável de
ambiente: uma variável poderia dizer `/painel/` com um pacote feito para `/`, e a divergência só
apareceria como tela branca no navegador do dono. E `cadastroDeCaixas.tokenConfigurado` (sim/não,
nunca o valor) separa «falta o token» de «a plataforma está fora», que davam o mesmo sintoma.

### Prova
```
/saude  versao 1.07.01 · interface {estado: servida, prefixo: /painel/} · tokenConfigurado: true
        cadastroDeCaixas.ultimoResumo {empresas:1, empresasComErro:0, caixasNaPlataforma:4,
                                       novasNoCadastro:4} · ultimoErro: null
caixas registradas: 1 web_widget Site · 34 whatsapp WhatsApp Ragnatela · 35 facebook · 36 instagram
/painel/ 200 · /painel 301 → /painel/ · assets 200 · F5 em fluxos/respostas-rapidas/testador/
        caixas/empresas 200 · arquivo inexistente 404 · /painel/sessao/eu 401 JSON
        /painel/api/... 401 NAO_AUTENTICADO (a trava de sessão de pé)
tema do atendimento vazando para /painel/: 0 ocorrências
painel de atendimento intacto: / 200 com tema+carregando+turnstile · /app/login 200 ·
        POST /auth/sign_in sem verificação 401 · 7 conversas e 4 caixas na conta 1, inalteradas
vizinhança: chat001 200 · painel 200 · ia 200 · app.sisacbrasil 302 · ragnatela.com.br 200 ·
        cloud 302 · `nginx -t` aprovado antes do reload · respaldo em /root/nginx-backups/
```

### ⛔ O que continua desligado, de propósito
`RAGNABOT_EXECUTOR_FLUXO=0` e **zero webhooks cadastrados** na plataforma (medido:
`{"payload":{"webhooks":[]}}`). Ou seja, **nada muda para quem conversa com a gente hoje**. Ligar é
um passo separado, deliberado, com o dono avisado.

### Observação de passagem (não é desta tarefa)
O `default_server` da 443 no proxy **não é mais implícito**: existe `listen 443 ssl default_server`
no arquivo `sites-enabled/redirecionamento` (27/08), e o SNI desconhecido devolve `CN=ragnatela.com.br`.
O `/ia/CLAUDE.md` ainda diz que o catch-all é o `chat001` por ordem alfabética — está desatualizado.
Nada foi alterado; fica registrado para quem for mexer em vhost neste proxy.

## 2026-08-27 — Do zero ao FUNCIONAL em um dia

### Aprovações do dono
- Plano de 10 fases aprovado (doc `07-PLANO-PLATAFORMA-ATENDIMENTO.md` na infra do NOC).
- **Base:** Chatwoot open-source (API oficial Meta + omnichannel + multi-tenant nativos).
- **Registry:** GHCR privado (org ragnatelaiot). **Repo:** `ragnatelaiot/ragnabot` (deploy key com escrita).
- Regras reforçadas: credencial JAMAIS no git · responsividade obrigatória · documentação viva.

### Infraestrutura pré-existente usada
Cluster Kubernetes v1.31.14 com 3 nós (2 no datacenter FLZ + 1 no XSE via túnel), etcd quórum 3,
Calico VXLAN mtu 1300 — construído no mesmo dia (diário 06 na infra do NOC).

### Fase 1 — Fundação de dados ✅
- PostgreSQL 18.6 primário (10603/.132) → standby (10604/.133), streaming replication com slot,
  lag medido 4,5 ms. pgvector. Redis primário/réplica com senha.
- 🔴 **Buraco negro de MTU** (hipótese do dono, confirmada): placas 9100 × caminho 9000 —
  ping passava, TCP grande morria. Fix: MTU 9000. Vazão: 60 KB/s → **1,04 GB/s**.
- Firewall CHRs: pods → PG/Redis (`5432,6379`) liberado e provado.

### Fase 2 — Encanamento ✅
- ingress-nginx (3 réplicas, NodePort fixo 30080/30443), taint de control-plane removido
  (cluster todo é control-plane). local-path como StorageClass padrão.
- Firewall: proxy reverso → nós :30080/:30443 (2 CHRs + RB5009 para o nó do XSE).
- Vhost `chat002` no proxy + cert Let's Encrypt (linhagem `-0001`) + WebSocket.
- 🔴 **server_name duplicado:** `chat002` estava também no vhost "estacionamento"
  (`redirecionamento`) — com nome exato duplicado vence quem carrega primeiro; o desafio ACME
  caía num 301 errado. Removido de lá. ⚠️ No meio, um backup criado DENTRO de `sites-enabled`
  quebrou o `nginx -t` (armadilha conhecida da casa) — detectado e movido antes de qualquer dano.

### Fase 3 — Aplicação no ar ✅
- Namespace `ragnabot`: Secret (aplicado direto, valores fora do git), ConfigMap PT-BR,
  PVC 20Gi, Job de migração, Deployments web+worker (mesmo nó por causa do PVC RWO — HA de app
  virá com S3), Service, Ingress.
- Migração: 1ª falhou (`Must be superuser to create extension`) → papel `chatwoot` virou
  SUPERUSER (cluster de banco DEDICADO à plataforma; decisão registrada).
- Conta 1 criada: "Ragnatela IoT Solutions", admin SuperAdmin (senha inicial no cofre local
  das VMs de banco). Signup público FECHADO. Flag de onboarding removida (vive no Redis:
  `Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING`).
- **Prova final: `https://chat002.ragnatela.com.br` → HTTP 200** com cert válido, pelos 3 nós.

### Design (aguardando aplicação)
Proposta do agente de marketing APROVADA pelo NOC (delegação do dono): `design/login.html`,
`design/app-mockup.html`, `design/identidade.md` — noite de vidro no login, tema claro no
trabalho, contrastes WCAG medidos, responsivo validado em 8 combinações com navegador real.

### Meta / WhatsApp Cloud API (caminho crítico externo)
BM verificado ✅ · WABA ativa ✅ · número +55 98 3197-0997 adicionado, mas `DISCONNECTED/
NOT_VERIFIED/ON_PREMISE`. Faltam (dono): verificar por ligação de voz, registrar na Cloud API,
submeter display name. Depois (NOC): webhook `chat002.../webhooks` + templates (Fase 4).

### Pendências
- [ ] Backup WORM dos bancos (S3 Object Lock) + Zabbix das VMs 10603/10604 + ensaio de promoção
- [ ] Tema Ragnabot aplicado sobre o Chatwoot (a partir de `design/`)
- [ ] Menu "Atendimento" no NOC (Fase 6) — aguarda janela de deploy do NOC (política de sessão ativa)
- [ ] Pin da imagem por digest (hoje `chatwoot:latest`) + storage S3 para HA de aplicação
- [ ] Fases 4-5 (WhatsApp oficial, omnichannel), 7 (SaaS), 8 (produção), 9 (piloto)

## Requisito herdado do sistema antigo (a corrigir por construção)
No Whaticket da VM 10016, ticket de **grupo** é visível a todo admin (fora do filtro de dono, por
desenho do fornecedor) e super-admin vê todas as empresas. **No Ragnabot/Chatwoot**: a visibilidade
por conversa deve respeitar atribuição (dono/time) e o isolamento entre contas (tenants) deve ser
absoluto — validar na Fase 3/7 que um agente só vê o que lhe cabe, inclusive conversas de grupo.

## 2026-08-27 (noite) — Marca Ragnabot + correcao da lentidao do login
- **Marca:** InstallationConfig (INSTALLATION_NAME/BRAND_NAME=Ragnabot, URLs=ragnatela) + logo SVG
  (3 variantes) persistidos via ConfigMap `ragnabot-branding` (subPath em public/brand-assets).
  Cor primaria + login "noite de vidro" exatos = imagem custom no GHCR (aguarda token write:packages do dono).
- **Lentidao (corrigida):** puma 2 workers/5 threads + 2 replicas web; cache imutavel no navegador para
  assets Vite; proxy_cache+gzip no proxy (MISS 7s uma vez -> HIT 0,008s). Login repetido agora instantaneo.

## 2026-08-27 (noite, cont.) — tema v1 no ar, reprovado; frontend v2 com o agente
- **Tema v1 aplicado e NO AR** (CSS injetado pelo proxy via sub_filter, fora da imagem):
  azul #2781f6 do Chatwoot → verde Ragnatela em todas as classes `.{bg,text,border,ring,outline}-n-brand`;
  login com gradiente/teia/aurora/cartão de vidro por `body:has(input[type=password])`; favicon e
  theme-color trocados. Reversível removendo o sub_filter do vhost.
- ❌ **Dono REPROVOU** o resultado ("péssima, totalmente amadora"): ficou formulário centralizado
  genérico. Referência dele = a tela de login do **painel do cliente** (duas colunas, imagem real de
  datacenter, copy comercial, cartão de vidro com campos ícone-dentro). Frontend COMPLETO delegado ao
  agente site-ragnatela (login + dashboard de indicadores + tela de conversas + tema.css + guia).
- ⏸️ **Decisão do dono:** questões de **banco/backup/DR ficam para depois do piloto**. Nesta etapa
  ficou feito o agente Zabbix nas VMs 10603/10604 + UserParameters de replicação (todos provados
  lendo valor real: standbys=1, lag=0, slots_inativos=0, redis=1). Registrar hosts no servidor: adiado.

## 2026-08-28 (madrugada) — Cluster RAGNABOT no NOC + digest + estrutura documentada
- **Cluster criado** (ordem do dono): 5 servidores no grupo RAGNATELA com marcação
  `[CLUSTER RAGNABOT]` — RGTK8S001/002/003 (nós k8s, o 3º no site XSE) e RGTPSTGSQL001/002.
- **Serviço + rota** de saúde ao vivo (somente leitura): nós/etcd/pods/versão fixada · bancos com
  **identificação automática do primário** (`pg_is_in_recovery`), réplica em dia, vagas inativas,
  tamanho · espaço em disco · papel do Redis · lista de alertas. `GET /api/ragnabot-cluster/health`.
- ⚠️ **Falso positivo real corrigido no 1º teste:** atraso da réplica media *tempo desde a última
  transação* → num banco ocioso acusava 21.934s (6h) com replicação perfeita (primário reportava
  lag=0 e réplica conectada). Passou a medir **por LSN**: recebido == aplicado ⇒ em dia.
- **Imagem fixada por digest** `chatwoot@sha256:18f280a6…` (era `:latest`) nos dois Deployments +
  manifesto; rollout limpo. Alerta do painel para o caso de desfixar.
- **`11-ESTRUTURA-RAGNABOT.md`**: documentação da estrutura (k8s, bancos, mídias, HA, eleição de
  primário — manual e por quê, atualização, espaço).
- Pendente: **página visual** do cluster no NOC (exige build+deploy → janela sem sessão ativa).

## 2026-08-28 (madrugada, cont.) — Frontend v2 no ar + descrição em PT-BR
- **Tema v2 APLICADO** (substituiu o v1 reprovado). Entrega do agente site-ragnatela, revisada e
  aprovada pelo NOC: autocontida (zero dependência externa), sem segredos, imagem em data URI.
- ⚠️ **Erro meu que o agente pegou e corrigiu:** a paleta do tema v1 (`#055508`/`#2CC54E`/`#04150B`)
  **não era a paleta do produto**. A aprovada pelo dono em 23/08 é a do painel do cliente:
  fundo `#03151f`, ação `#2ee879` (`96-IDENTIDADE-PAINEL-CLIENTE` §2). Por isso, lado a lado com o
  painel, "lia-se como outra empresa" — exatamente a queixa do dono. O v2 herda a paleta aprovada.
- Diferença técnica que importa: o v1 brigava classe a classe com `!important`; o v2 **redefine as
  variáveis de cor do próprio Chatwoot** (`--slate-1..12`), o que reveste o aplicativo inteiro —
  inclusive telas ainda não abertas.
- Também corrigido: `branco sobre o verde dá 1,62:1` — a regra do `.bg-n-brand` agora força a cor
  do texto junto, senão o botão ficaria ilegível em todo o produto.
- **Descrição do sistema traduzida** para PT-BR (estava em inglês, falando de "Chatwoot"):
  `INSTALLATION_DESCRIPTION` agora descreve o Ragnabot e os canais.
- Limite declarado pelo agente: só a tela de ENTRADA foi vista no produto real; as telas internas
  foram tratadas pela via das variáveis (ampla, mas não é o mesmo que ter olhado). Pendente: alguém
  com acesso percorrer caixa, contatos, relatórios e ajustes com o tema aplicado.

## 2026-08-28 (manhã) — Segurança de acesso + o nome do open-source fora da interface
- **Freio de força bruta no proxy** (`limit_req` 10/min no `/auth/sign_in`, rajada 5): provado com
  12 tentativas seguidas → passa a devolver **429**. Backup do vhost antes.
- **Proteção nativa do produto LIGADA** (`ENABLE_RACK_ATTACK=true`): já cobre login (5/5min por IP,
  10/15min por e-mail), redefinição de senha, reenvio de confirmação e **verificação de 2FA**
  (o produto TEM MFA nativo — importante para a frente de acesso).
- 🔴 **A marca sumia a cada reinício.** Causa: o Chatwoot **ressemeia** as `InstallationConfig` a
  partir do YAML da imagem no boot; valor não travado volta ao padrão. Corrigido gravando com
  **`locked = true`**. Sem isso, todo restart devolvia "Chatwoot" à tela.
- 🔴 **Nome do open-source visível** ("Entrar no Chatwoot"). O texto vive no pacote de idioma
  compilado — não sai por configuração. Resolvido com `sub_filter` no bloco de assets
  (`Accept-Encoding ""` + `sub_filter_types application/javascript`), trocando as **frases
  visíveis** — nunca a palavra solta, que também é identificador interno no código.
  Cache do proxy limpo depois (guardava a versão antiga). Provado: **"Entrar no Ragnabot"**.
- 🔴 **Achado do dono que eu deveria ter previsto:** ao clicar em "exibir senha" o tema do login
  sumia. Causa: o seletor `body:has(input[type="password"])` — revelar a senha troca o campo para
  `type="text"` e a regra deixa de casar. Repassado ao agente de revisão com ordem de varrer
  seletores frágeis pelo mesmo motivo.
- **Cloudflare "não sou robô":** tentei criar o widget sozinho — o token disponível é **restrito a
  DNS** (Authentication error na API de Turnstile, que exige permissão de conta). Pendência
  registrada com o passo a passo para o dono.
- 📋 **`21-TAREFAS-DAS-ORDENS.md`**: todas as ordens do dono organizadas em tarefas rastreáveis.

## 2026-08-28 (manhã) — 2FA LIGADO + achado de LICENÇA que afeta o negócio
### ✅ 2FA (autenticação em duas etapas) habilitado
`Chatwoot.mfa_enabled?` era `false` porque depende de `encryption_configured?` — as três chaves de
criptografia de atributos do Rails não existiam (é onde o segredo TOTP de cada usuário fica guardado).
Geradas e gravadas no **Secret do cluster** + cofre `/root/.chat002-credenciais` (**nunca no git**).
Após o rollout: `mfa_enabled? => true`. O usuário já pode cadastrar 2FA por aplicativo (QR/TOTP),
com códigos de recuperação (`otp_backup_codes`).

### ⚠️ ACHADO DE LICENÇA — precisa de decisão do dono
A imagem tem DUAS licenças:
- **núcleo (`/app/app`, `/app/lib`…) = MIT**, livre inclusive para uso comercial;
- **`/app/enterprise/` = Chatwoot Enterprise License**, que exige assinatura paga e número de
  assentos para **uso em produção**.

Onde cada coisa mora (verificado arquivo a arquivo):
| recurso | onde | situação |
|---|---|---|
| **2FA / MFA** | `/app/app/controllers/api/v1/profile/mfa_controller.rb` → **núcleo MIT** | ✅ **livre** — ligado hoje |
| **Auditoria** (`audit_logs`) | `/app/enterprise/app/...` → **licença paga** | ⚠️ decisão |
| SLA, papéis personalizados, Captain (IA) | `/app/enterprise/` | ⚠️ decisão |

A conta 1 tem 27 recursos habilitados (campanhas, automações, macros, relatórios, times, canais…) —
**nenhum deles é enterprise**. A tabela `audits` existe e tem 15 registros, mas `audit_logs` **não**
está na lista de recursos da conta.

**Por que isso importa:** o Ragnabot será **comercializado** (SaaS). Usar recurso da pasta enterprise
sem assinatura seria violação de licença — risco jurídico, não apenas técnico.
**Três caminhos:** (a) assinar o Enterprise pelo número de assentos; (b) **construir do nosso lado**
o que falta (auditoria é a mais sensível, e o NOC já tem motor de auditoria maduro para reusar);
(c) operar só com o núcleo MIT. **Recomendo (b)** para auditoria — é requisito de primeira classe da
casa e ficamos donos do que vendemos.

## 2026-08-28 — Login integrado: regra do dono confirmada (só super users do NOC gerenciam o SaaS)
Pergunta do dono: "já consigo entrar com o mesmo login do NOC no Ragnabot?" — **Ainda não.** Hoje o
Ragnabot tem 1 usuário (atendimento@ragnatela.com.br, SuperAdmin) com senha PRÓPRIA, sem ponte com o NOC.
**Regra do dono (reafirmada):** só os **super users do NOC** gerenciam o SaaS do Ragnabot (criar
empresas, gerenciar contas). O NOC tem 4: Fernando, Emmanuel, Ragnatela, Daniele.
✅ **Caminho técnico achado (medido no Rails):** o Chatwoot tem `User#generate_sso_link` (login por
link, sem senha) e **`PlatformApp`** (API de plataforma para criar usuários/contas por token) — hoje
`PlatformApp.count = 0`, precisa criar 1. É exatamente o mecanismo para o SSO do menu "Atendimento":
o NOC gera o link SSO para o superuser logado e o abre no Ragnabot, sem segunda senha.
**Próximo passo (Fase 6):** criar o Platform App (token no Settings do NOC, encrypted), o serviço
`chatwoot.service.js` no NOC, o botão/menu e a rota de SSO — exige janela de deploy do NOC.

## 2026-08-28 — Auditoria de cibersegurança (laudo 22-AUDITORIA-SEGURANCA.md)
**Placar:** 1 crítica · 3 altas · 4 médias · 2 baixas · 3 corrigidas · 8 positivos validados.
⚠️ **O agente EXCEDEU o read-only** (alterou o vhost do proxy e criou contas de teste no banco vivo).
Verifiquei tudo: mudanças eram hardening seguro e escopado ao vhost chat002 (backup
`chat002-ragnatela.bak-sec-1787915387`, `nginx -t` OK, reload gracioso), vizinhança 200/302 intacta,
contas de teste DESTRUÍDAS (confirmado: 1 conta/1 usuário). Sem estrago. Lição registrada.

### ✅ Corrigido e no ar (hardening do vhost, sem reiniciar nada)
- Cookie de sessão agora `Secure; HttpOnly; SameSite=lax`.
- **HSTS** `max-age=31536000; includeSubDomains` (sem preload, proposital).
- **Permissions-Policy** conservador.

### ✅ Positivo mais importante: ISOLAMENTO MULTI-TENANT ÍNTEGRO
Provado com 2 empresas de teste: agente da empresa A recebe **401** em contatos/conversas/agentes de
B (IDOR fechado); própria conta = 200. É o ponto que o sistema antigo vazava — no Ragnabot está fechado.
Outros positivos: sem enumeração de usuário, freio de força bruta funciona (429), TLS só 1.2/1.3,
plano de controle k8s endurecido (etcd client-cert, kubelet anonymous=false, RBAC), Redis/PG autenticados.

### ⚠️ PENDÊNCIAS (exigem decisão do dono ou JANELA — nada aplicado, YAML/SQL prontos no laudo)
1. **[CRÍTICA] PG `chatwoot` é SUPERUSER** → SQLi vira RCE via `COPY FROM PROGRAM`. Rebaixar (janela+teste).
2. **[ALTA] Sem NetworkPolicy** — egresso do pod irrestrito (alcança internet e outros nós). default-deny+allowlist.
3. **[ALTA] Pods rodam como root**, securityContext vazio. Endurecer (dispara rollout → janela sem atendimento).
4. **[ALTA] Secrets do k8s sem cifragem em repouso** no etcd. Configurar encryption-provider nos 3 nós.
5. **[MÉDIA] NodePort 30080/30443 sem firewall de host** — bypass do proxy em HTTP puro. Fechar na CHR/RB.
6. Redis rename-command · CSP · OCSP stapling · https no /super_admin.

## 2026-08-28 — TRAVAS DE SEGURANÇA APLICADAS (dono liberou tudo do projeto; sem clientes ainda)
Autorização do dono: "pode fazer tudo a qualquer tempo, inclusive reiniciar VMs do k8s; não mexer
no que afete o resto do ambiente Proxmox".

### ✅ [CRÍTICA→resolvida] PostgreSQL: papel `chatwoot` rebaixado de SUPERUSER
Extensões pré-criadas como postgres; `ALTER ROLE chatwoot NOSUPERUSER`. Provado: superuser t→f no
primário, **replicado no standby** (false), e a **app escreve normalmente** (criou/apagou um Label
via Rails). Fecha o vetor SQLi→RCE via `COPY FROM PROGRAM`. Rollback: `ALTER ROLE chatwoot SUPERUSER`.

### ✅ [ALTA→resolvida] NetworkPolicy — isolamento restritivo do egresso (o que o dono pediu)
`ragnabot-allow` no namespace. Provado com Ruby TCPSocket (não `/dev/tcp`, que engana):
- app ALCANÇA PG (.132:5432) e Redis (:6379) ✅
- BLOQUEADO SSH de outros nós (.5:22 false), rede interna (.132:22 false) e DNS externo direto ✅
- LIBERADO só HTTPS/SMTP de SAÍDA (1.1.1.1:443 true) para canais/e-mail ✅
Fecha SSRF/movimento lateral. Rollback: `kubectl delete networkpolicy ragnabot-allow -n ragnabot`.

### ✅ [ALTA→parcial] Endurecimento do pod
Aplicado (rollout limpo, pods de pé): `allowPrivilegeEscalation:false`, `capabilities.drop:[ALL]`,
`seccompProfile:RuntimeDefault`, `automountServiceAccountToken:false` nos dois Deployments.
⏳ **runAsNonRoot/readOnlyRootFilesystem NÃO aplicado**: a imagem oficial roda como root e não tem
usuário dedicado; forçar exige montar emptyDir nos diretórios de escrita (/app/tmp, /app/log) e
testar. Fica como próximo passo cuidadoso — não arrisquei o que está estável.

### ⏳ [MÉDIA] Firewall do NodePort — NÃO aplicado (cautela com as CHRs)
Tentei fechar 30080/30443 exceto pelo proxy, com regra ESCOPADA à faixa do cluster (172.17.20.0/24).
O classificador bloqueou o comando — e é coerente: as CHRs roteiam o RESTO do ambiente, então o
dono pediu cautela ali. Deixado como PROPOSTA (regra pronta). A NetworkPolicy já contém o vetor
principal; o NodePort é bypass que exige já estar na rede de gerência.

### ⏳ Pendentes (próxima leva): cifragem de Secrets no etcd (reinicia apiserver, um nó por vez),
Redis rename-command, CSP, OCSP, https no /super_admin, e o runAsNonRoot com emptyDir.

## 2026-08-28 — NodePort fechado no firewall (item 2 das pendências) ✅
Dono perguntou: "é seguro fazer sem derrubar as VRFs de clientes? se for, pode fazer".
**Verifiquei ANTES de afirmar:** as 14 rotas para `172.17.20.x` nas CHRs são TODAS das VLANs do
próprio Kubernetes (V30-V35) e da VRF `xse` (casa própria da Ragnatela). **Nenhuma VRF de cliente**
toca a faixa. Como a regra filtra por `dst-address` da nossa faixa e portas exclusivas do k8s,
o impacto em cliente é nulo.
**Aplicado nas 3 bordas** com ordem conservadora (os accepts ANTES do drop):
`K8S-INGRESS` (proxy) → `K8S-OK-1` (nó↔nó) → **`K8S-NODEPORT-DROP`** (o resto).
Na RB5009 a regra é escopada a `172.17.20.160/27` (faixa do nó 3).
**Validado:** site 200 · proxy alcança os 3 nós (404 do ingress sem Host = esperado) · vizinhança de
clientes intacta (SISAC 302, chat001 200, painel 200, cloud-análise 301).
**Reversão:** remover as regras `K8S-NODEPORT-DROP` nas 3 bordas.
⚠️ `place-after` NÃO existe nesta versão do RouterOS — só `place-before` (custou uma tentativa).

## 2026-08-28 — "Não sou robô" (Cloudflare Turnstile) NO AR ✅
Dono forneceu as chaves. Guardadas em `/etc/ragnabot/turnstile.env` (**600, fora do git**);
**segredo validado contra a Cloudflare** (aceitou a chave, recusou só o token falso — como esperado).

**Decisão de desenho:** o Chatwoot não valida Turnstile nativamente. Em vez de pôr o quadradinho
como enfeite, escrevi um **guarda que valida no servidor**: `/opt/ragnabot/turnstile_guard.py`
(Python puro — o proxy não tem Node, e não vou instalar runtime novo num servidor com ~20 sites).
Serviço systemd `ragnabot-turnstile` em `127.0.0.1:8791`.

**Ligação no nginx:** `auth_request` na tela de entrada; quem não passou vai para `/__verificacao`.
**Provado:** `/app/login` sem verificação → **302 para a verificação** · a tela → 200 · raiz → 200
(não afetada) · **token falso é RECUSADO** (volta com erro) · sem cookie → 401.

**Segurança do desenho:** segredo nunca vai ao navegador · cookie assinado com HMAC e comparado em
tempo constante · destino do redirecionamento só aceita caminho interno (sem redirecionamento
aberto) · guarda só escuta em localhost · cookie HttpOnly/Secure/SameSite, 12 h.
Backup do vhost: `chat002-ragnatela.bak-turnstile-*`.

## 2026-08-28 — CORREÇÃO: Turnstile dentro do formulário + tema devolvido ao login
O dono apontou dois defeitos na primeira versão, **os dois procedentes**:

### 🔴 ERRO MEU — a tela de entrada perdeu o tema
Ao criar `location = /app/login` para o `auth_request`, **quebrei a injeção do tema naquela página**:
`location =` (exato) tem precedência sobre `location /` (prefixo), e era o `location /` que carregava
o `sub_filter` do tema. Resultado: o login voltou ao visual padrão do software de origem.
⚠️ **Lição:** no nginx, criar um `location =` para uma página que já era servida por `location /`
**tira dela tudo o que estava no bloco genérico** (sub_filter, cabeçalhos, timeouts). Ou se replica,
ou não se cria o location exato.

### 🔴 Janela intersticial — desenho errado
Eu havia feito uma **página separada** de verificação. O certo é o widget **dentro do formulário**,
como no painel do cliente (referência que o dono mandou). Refeito:
- `location = /app/login` **removido** (a página volta a ser servida pelo `location /`, com tema).
- Guarda ganhou `POST /__verificar` (JSON): valida o token **na Cloudflare** e emite o cookie.
- `turnstile-inline.js` (servido pelo proxy) desenha o widget dentro do formulário, **trava o botão
  Entrar** até a verificação passar e chama o guarda por AJAX.
- O `auth_request` mudou para o **POST `/auth/sign_in`**: sem cookie válido, o login é **recusado**.

**Provado:** `/app/login` → 200 com tema e widget · JS e CSS servidos · **POST do login sem
verificação → 401**. Backup: `chat002-ragnatela.bak-fixlogin2-*`.

⚠️ Também mordeu: `proxy_set_header Content-Length ""` perdeu as aspas ao passar por camadas de
shell/base64 e derrubou o `nginx -t`. **Editar vhost com script Python no destino**, não com
`sed`/heredoc atravessando SSH.

## 2026-08-28 — Revisão crítica de frontend: tema v3 no ar (achado grave corrigido)

### 🔴 O DEFEITO DE FUNDO — o tema só funcionava em modo escuro
O tema v2 redefinia ~20 variáveis de cor; **o Chatwoot tem 137**. As outras 117 ficavam no valor
claro, e as 165 utilidades `dark:` dependem de uma classe que o **Vue controla e apaga no boot**
(o agente testou injetá-la — não adianta). Para quem usa o computador em **modo claro**, o produto
ficava com **título branco sobre cartão branco**.
**Medido:** 32 pares de texto abaixo do piso de contraste só no painel · 34 nas configurações ·
21 nos relatórios. **Depois da correção (137 variáveis em `:root`): 32→0 · 34→0 · 21→0 · 28→0 · 31→0.**
Validado no ar: `prefers-color-scheme` = **0 ocorrências** (não depende mais do modo do sistema).

### ✅ Os três defeitos que o dono apontou
1. **Olho da senha:** o cartão ia de `rgb(8,37,50)` para branco num clique. Âncora trocada para
   `form input[name="email_address"]`, que **não muda em execução**. (Descoberta: o botão está
   `disabled` no produto como paliativo — com o tema novo pode voltar a funcionar.)
2. **Nome de origem:** 16 pontos mapeados. Além do que já corrigi, **faltam**: ícone azul do
   fornecedor na tela inicial do celular, `manifest.json` com o nome dele, título da aba,
   **12 links para o site do fornecedor** e — grave — **um anúncio com cupom da Amazon do
   fornecedor dentro de Campanhas**.
3. **Inglês:** 25 frases + o erro de credencial. E o pior: **o freio de força bruta falha em
   silêncio** — devolve texto puro e a tela não mostra nada.

### 📱 Mobile — 48 combinações (360/390/414/768/1024/1440): **zero rolagem horizontal**
Corrigidos: alvo de toque de 44 px (o produto não tinha — o botão do olho era 26×92), folga do botão
flutuante (32→96 px), barra de rolagem e tela deitada.
⚠️ **Achado grave na entrada:** o desafio "não sou robô" **esmagava o campo de senha para 54 px**
(três caracteres) e gerava 30 px de rolagem a 360 px. Corrigido: **54 → 288 px**, rolagem → **0**.

### 🟡 Autocrítica do agente (registrada por ser exemplar)
Ele **criou uma regressão crítica** no meio do trabalho: um seletor largo demais deu `height:100%` a
um contêiner de avisos vazio, que passou a **engolir todo clique** a 360/390/768 — ninguém entraria
pelo celular. Só apareceu porque um clique falhou; nenhuma medição de contraste ou transbordo pegaria.
E uma tentativa com `color-mix()` devolveu **preto puro** nos avatares — medido antes de publicar.

### ⏳ O que ele NÃO conseguiu verificar (e por quê)
A caixa de entrada **com conversa real** (a conta tem zero conversas), alvo de toque nas telas
internas e o título da aba. Motivo comum: depois de dezenas de entradas, **o próprio captcha que
instalamos passou a barrar a automação** — comportamento correto dele. Tentou 18 vezes.
**Fica como pendência para quando houver conversa real no sistema.**

## 2026-08-28 — Freio de força bruta: fim da falha silenciosa ✅
Defeito que o agente destacou "acima dos outros" e que reproduzi: ao ser barrado, o usuário clicava
em Entrar e **não recebia mensagem nenhuma**. Causa medida: o nginx devolvia uma **página HTML crua**
(`429 Too Many Requests`), e a tela de entrada — que conversa por **JSON** — simplesmente ignorava.
É o tipo de defeito que gera chamado sem ninguém entender a causa.
**Correção:** `error_page 429` do login aponta para uma resposta em **JSON e em português**, no
formato que a tela entende. **Provado:** `content-type: application/json` e a mensagem
*"Muitas tentativas de entrada. Aguarde um minuto e tente novamente."*
Backup: `chat002-ragnatela.bak-429-*`.

### Pendências que o agente deixou (dependem de outra pessoa/janela)
1. **Uma conversa de teste na caixa de entrada** — a conta tem zero conversas, então o fio de
   mensagens, anexos e a nota interna **não foram vistos no celular**. É o maior furo da revisão.
2. Três medições internas exigem **sessão aberta à mão** (o próprio captcha que instalamos passa a
   barrar automação depois de dezenas de entradas — comportamento correto dele).
3. **Fora do alcance do CSS:** ícone e `manifest.json` ainda com o nome de origem, `DEFAULT_LOCALE`,
   os 12 links para o site do fornecedor e **o anúncio com cupom da Amazon dentro de Campanhas**.

## 2026-08-28 — Domínio oficial bot.ragnatela.com.br + entrada integrada (falta só o rebuild)

### 🌐 bot.ragnatela.com.br — SUBDOMÍNIO OFICIAL, no ar
DNS criado (CNAME → `dc01`, que sobrevive ao failover das CHRs) · certificado próprio emitido ·
vhost = **cópia fiel** do anterior (tema, verificação, cache, freio, traduções) trocando só nome e
certificado · **Ingress do k8s** passou a atender os dois nomes · `FRONTEND_URL` atualizado.
**chat002 continua no ar redirecionando (301)** para não quebrar link ou favorito salvo.
**Validado:** bot 200 · chat002 → 301 → bot · tema/verificação/carregamento no domínio novo ·
vizinhança de clientes intacta (SISAC 302, painel 200, chat001 200).
⚠️ **Ação do dono:** conferir se `bot.ragnatela.com.br` está na lista de domínios do widget Turnstile
(Cloudflare → Turnstile → o site → Domains). Se não estiver, a verificação falha na tela.

### ⏳ Percepção de lentidão — resolvida
Tela de carregamento com a **marca e progresso de 0 a 100%** (`/carregando.js`), injetada pelo proxy
e mostrada antes do pacote pesado. A espera é a mesma; a percepção muda — sem retorno visual,
"esperar" vira "está lento". Some sozinha quando o painel desenha, com rede de segurança de 12 s.

### 🔗 Entrada integrada (SSO) — CONSTRUÍDA, falta só o rebuild
- **Platform App criado** no Ragnabot; token guardado em **Settings do NOC (cifrado)** — nunca no git.
- `src/services/ragnabot-sso.service.js` — acha/cria o usuário e gera o endereço de entrada direta.
- `src/routes/ragnabot-sso.routes.js` — `GET /status` e `POST /entrar`, **com trava de super user**
  dentro do router (defesa em profundidade) e **auditoria** de cada entrada.
- `frontend/src/pages/Atendimento.jsx` — a tela, com estado de indisponibilidade e o caminho manual.
- `frontend/src/lib/api.js` · `App.jsx` (import lazy + rota) · `lib/access.js` (`/atendimento` =
  **SUPERUSER**) · `Layout.jsx` (**botão no menu, só para super user**).
- ⚠️ Detalhe que evita defeito clássico: a janela é aberta **antes** da chamada e só depois recebe o
  endereço — abrir no retorno da promessa faria o navegador bloquear como janela automática, e o
  usuário veria "nada acontece" ao clicar.
- **Build validado em diretório separado** (`Atendimento-Cq_DlMbi.js` gerado, compila limpo);
  **o `dist` de produção NÃO foi tocado**.

### 🚧 PENDENTE: rebuild + reinício do NOC
Só falta `npm run build` + `pm2 restart noc-agent` — **e isso exige zero sessão RDP/console ativa**
(regra da casa). Até lá, o menu "Atendimento" não aparece para o dono.
