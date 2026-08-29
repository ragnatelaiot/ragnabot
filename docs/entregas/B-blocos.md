# B-MOTOR — LISTA e BOTÕES enriquecidos, e o bloco novo de E-MAIL

**Arquivos:** `/ia/netagent/src/services/ragnabot-fluxo-nos.service.js` ·
`/ia/netagent/tests/ragnabot-fluxo-blocos.test.mjs`
**Base:** estruturas REAIS extraídas do bot atual em produção (`menuListaNode` com 419 envios /
300 cliques, `botoes2Node`, `emailNode`, `ctaUrlNode`) · doc 28 §4.1 (contrato do executor), §4.4
(escada de exceção), §4.6 (orçamento de caracteres), §4.8 (interpolação e escape por destino),
§5.4 (janela de 24 h e template).
**Estado:** implementado e provado por teste — **23 verificações, todas verdes**, sem tocar banco
nem rede. As duas baterias vizinhas (`motor` 18/18, `publicacao` 7/7) seguem verdes.
**Não amarrado ao processo:** nada de build, restart ou commit — decisão do chefe.

---

## 1. O que existia, e o que faltava

| | Tinha | Ganhou agora |
|---|---|---|
| `lista` | corpo, rodapé, rótulo do botão, espera, itens `{id,titulo,descricao}` | **`cabecalho`** e **`itens[].secao`** |
| `botoes` | corpo, rodapé, espera, botões `{id,rotulo}` | **`cabecalho`**, **validação do rodapé**, **`botoes[].tipo`** (`resposta`\|`url`) e **`botoes[].url`** |
| e-mail | só existia como *canal* do nó `notificar` (destinatário por papel/time/usuário) | **bloco `email` próprio**, para o endereço que a CONVERSA produziu |

O bot atual já usa `header` e `sectionTitle` no `menuListaNode`. Sem cabeçalho e seção, migrar os 35
fluxos medidos exigiria jogar o agrupamento fora e entregar ao cliente um menu corrido de dez linhas.

---

## 2. Como o operador usa

### 2.1 Lista com cabeçalho e seções

* **Cabeçalho** — o título em negrito acima do texto. Teto de **60** caracteres. Aceita variável, e
  aceita a forma de bloco com reserva (`{ "texto": "...", "reserva": { "empresa": 20 } }`), igual ao
  corpo.
* **Seção** — escreve-se **no item** (`"secao": "Técnico"`), que é como a pessoa pensa: ela lista as
  opções e diz a que grupo cada uma pertence. O motor agrupa sozinho, preservando a ordem.

Três regras que o editor cobra na publicação, e o porquê de cada uma:

1. **Se um item tem seção, todos precisam ter.** Com mais de uma seção a Meta exige título em todas
   e **recusa a mensagem inteira** quando falta um — o cliente não receberia nada. Por isso é erro,
   não aviso: não há como adivinhar o nome do grupo dos itens soltos sem inventar texto de menu.
2. **Até 10 seções**, e **título de seção até 24** caracteres.
3. **Itens da mesma seção separados na tela** geram **aviso** (não erro): a mensagem sai e funciona,
   mas o celular do cliente vai **juntar** os pedaços, e a ordem que ele lê deixa de ser a da tela.

### 2.2 Botão de URL

Cada botão agora tem um **tipo**:

* `resposta` (o padrão, e o que todo fluxo antigo é) — o cliente toca e o fluxo segue por aquela saída;
* `url` — o cliente toca e o navegador abre o endereço.

Um botão de URL exige o campo `url`, que precisa começar por `https://` (o `http://` sai com aviso) e
**não pode ter variável na posição do host** — senão o destino do clique passa a ser escolhido por
quem respondeu a pergunta anterior.

### 2.3 ⚠️ A RESTRIÇÃO DA META — não misture botão de resposta com botão de URL

**Este é o ponto mais importante desta entrega.**

No WhatsApp Cloud API, botão de resposta e botão de URL são **tipos de mensagem interativa
diferentes**: `interactive.type: "button"` (até 3 respostas) e `interactive.type: "cta_url"` (um
link). **Não existe payload que carregue os dois.**

Um nó com dois botões de resposta e um de URL **não sai "com dois botões e um link"**: a Meta
**recusa a mensagem inteira** e o cliente **não recebe nada** — nem o corpo, nem os botões, nem o
link. É a mesma falha do 4º botão: não há entrega parcial.

Por isso o motor só aceita:

* **(a) até 3 botões de resposta**, ou
* **(b) exatamente 1 botão de URL.**

A mistura é **bloqueada na publicação** (código `BOTOES_MISTURADOS`, com a ação rápida "Separar em
dois nós") e **recusada de novo em execução**, para o caso de um fluxo publicado por outro caminho
(importação, restauração de backup). Em execução ele falha pela saída `erro`, com uma frase honesta
ao cliente — nunca em silêncio.

**Como fazer o que o operador queria:** dois nós em sequência. Primeiro os botões de resposta;
depois o nó do link. Se o link for opcional, ofereça-o como resposta rápida ("Ver 2ª via") que leva a
um nó com o botão de URL sozinho.

### 2.4 O bloco de e-mail

Campos: **`para`** (obrigatório, aceita variável), **`assunto`** (obrigatório), **`corpo`**
(obrigatório, aceita variável e quebra de linha), **`responderPara`** e **`copiaOculta`** (opcionais).

**`para` e `copiaOculta` são TEXTO, não lista** — vários endereços vão **separados por vírgula**
(`"cliente@empresa.com.br, financeiro@empresa.com.br"`), que é o formato que a tela do editor grava.
O motor **interpola o texto inteiro primeiro e separa depois**, nesta ordem de propósito: uma
variável sozinha pode trazer dois endereços dentro (`{{copias}}` → `"a@x.com, b@y.com"`), e separar
antes deixaria isso passar como um "endereço" só, que nenhum servidor entrega. Cada endereço é
validado individualmente, e a mensagem de erro aponta o índice (`config.para[1]`). Tetos: **10**
destinatários e **10** cópias ocultas; `responderPara` aceita **um** só (dois endereços ali é
ambiguidade que cada cliente de e-mail resolve do seu jeito).

Saídas: **`padrao`** e **`erro`**. **Não estaciona** — não há resposta do cliente a esperar.

Ele **não se confunde com o nó `notificar`**: aquele avisa **gente da casa** por papel/time/usuário e
recusa endereço cravado no fluxo (para trocar de plantonista não exigir editar o fluxo). Este escreve
para o **endereço que a conversa produziu** — o comprovante com o protocolo, o resumo do pedido.

---

## 3. As decisões, e por que foram tomadas assim

### 3.1 A REGRA DO MODO DO NÓ `botoes` — decisão do chefe, 29/08/2026

Registrada aqui porque, se ficar só no código, o próximo a mexer desfaz sem saber. O **motor é quem
manda**: o editor prefere o catálogo do servidor, então esta é a definição única.

| Modo | Quando | Saídas | Estaciona? |
|---|---|---|---|
| **`resposta`** (padrão) | nenhum botão com `tipo:'url'`; até **3** botões | **uma por botão** + `sem_resposta`, `opcao_invalida`, `erro` + `sem_janela` | **Sim** — espera a escolha |
| **`url`** | exatamente **1** botão `tipo:'url'` | **só `padrao`** + `sem_janela` | **Não** — envia e segue |
| **`misto`** | tem os dois tipos | recusado na publicação **e** na execução | — |

`sem_janela` continua valendo nos dois modos: fora das 24 h a mensagem interativa não sai, com ou sem
link. Foi a validação da mistura (item 3.3 abaixo) que tornou "modo" **não-ambíguo** — sem ela, não
haveria como derivar saídas de um nó que é as duas coisas ao mesmo tempo.

**O defeito que esta regra evita:** com `saidas(config)` derivando uma saída por botão também no modo
URL, o editor passaria a exigir ligação para um pino **que nunca é percorrido**, e o validador
acusaria `ARESTA_AUSENTE` num fluxo correto.

⚠️ **Como isso foi implementado, já que `estaciona` é booleano fixo no contrato §4.1.** Não forcei o
contrato: o objeto do executor **mantém `estaciona: true`** (o valor do caso comum, que é o que o
§4.1 pede e o que quem só lê o campo estático encontra) e **ganhou `estacionaCom(config)`**. O
arquivo exporta **`noEstaciona(no)`**, e `saidasDe()` já o usa. O **motor não lê `estaciona` em lugar
nenhum** (conferido: quem decide parar é o `ResultadoNo` de `executar()`), então nada no contrato do
executor precisou mudar. O único leitor do campo estático é a projeção de publicação — ver a
pendência 3 no §5.

#### 3.1.1 Por que o modo URL não pode estacionar

**Decisão: em modo URL o nó devolve `seguir/padrao` no mesmo passo, e não declara as saídas de
exceção de espera.**

A Meta **não avisa que o cliente tocou** num botão `cta_url` — não existe webhook de clique. Se o nó
continuasse estacionando, a conversa ficaria parada esperando uma resposta que nunca chega, até o
prazo vencer; então o motor tomaria `sem_resposta`, gastaria uma tentativa da escada de exceção e,
no fim, transferiria a pessoa para um humano — **tudo isso porque ela fez exatamente o que o botão
pediu**. Seria o "laço de exceção" do §4.4 renascendo por um caminho que ninguém desenhou.

Consequências concretas:

* `saidas(config)` em modo URL devolve **só `padrao`** (um botão de URL não é bifurcação: não há como
  saber se foi clicado). Declarar uma saída por botão faria o editor desenhar um pino que nunca
  dispara — e alguém penduraria um ramo inteiro nele, como já aconteceu com o 11º item da lista.
* `validar()` **não cobra** `esperaResposta` nem a escada de exceção em modo URL; se estiverem
  declarados, sai um **aviso** dizendo que serão ignorados.
* A **janela de 24 h continua valendo** (é mensagem interativa livre, iniciada por nós): fora dela o
  nó toma `sem_janela`, como antes.
* Quem quiser dar tempo ao cliente põe um **nó de espera** depois — decisão do autor do fluxo, não
  efeito colateral do bloco.

Como `estaciona` é um booleano fixo no contrato §4.1, o executor ganhou `estacionaCom(config)` e o
arquivo exporta **`noEstaciona(no)`**. `saidasDe()` já usa a versão com configuração.

### 3.2 O e-mail não é enviado dentro de `executar()`

Regra **R1** do motor: nada de rede dentro da transação curta. SMTP é rede — um servidor de e-mail
lento seguraria a trava da linha da execução pelo tempo dele.

Então: **`preparar()` monta a intenção `{tipo:'email', ...}`**, o motor reserva o efeito, e o
**despacho depois do COMMIT** chama **`enviarEmailDaIntencao(intencao, ctx)`**, exportada do mesmo
arquivo. Para o adaptador da `PortaCanal` isso é uma linha:

```js
if (intencao.tipo === 'email') return enviarEmailDaIntencao(intencao, ctx);
```

A porta segue os três degraus de `garantirProtocolo()`: `ctx.email` com `sendEmail` → `ctx.email`
como função → import dinâmico de `smtp.service.js`. É o que permite ao teste usar dublê sem mandar
e-mail de verdade.

### 3.3 Três defesas que não são cosméticas

* **Injeção de cabeçalho SMTP.** `assunto`, `para`, `responderPara` e `copiaOculta` usam o escape
  novo `cabecalho_email`, que remove CR/LF/TAB. Sem ele, um `\r\nBcc: espiao@fora.com` digitado pelo
  cliente e caído em `{{assunto}}` viraria um **cabeçalho novo** na mensagem SMTP.
* **HTML vivo na caixa de quem recebe.** O corpo é tratado como **texto puro**; o HTML é gerado
  escapando o texto **inteiro uma única vez** e trocando a quebra de linha por `<br>`. Sem isso, um
  `<img src=x onerror=...>` digitado no WhatsApp chegaria como HTML executável no e-mail.
* **Endereço inválido.** `para` sem `@` é **erro de validação**: literal, é cobrado na publicação;
  com variável e com valores à mão (modo de teste/prévia), é interpolado e julgado pelo **resultado**;
  sem valores, não há o que julgar e a guarda de `executar()` recusa **antes de qualquer envio**,
  pela saída `erro`, com o valor exato no incidente.

Há ainda um **aviso** (não bloqueia) quando destinatário **e** corpo vêm inteiros de variáveis: nesse
desenho o nó vira um relé — quem escrever para o número da empresa escolhe para quem a nossa
infraestrutura manda e-mail e o que vai escrito nele. O conserto sugerido é pedir o endereço num nó
`pergunta` com validação `email` e manter no corpo um esqueleto fixo.

### 3.4 Por que o e-mail não exige "reserva" por variável, e a lista exige

Na lista/botões a reserva existe porque a Meta **recusa a mensagem inteira** acima do teto: publicar
sem reserva é publicar no escuro. No e-mail o teto é **nosso**, o excedente é **cortado** e o e-mail
sai igual, com o fim encurtado e um incidente de corte registrado. Exigir reserva num corpo de 50 000
caracteres seria burocracia sem defeito por trás — e regra sem defeito por trás é a que o operador
aprende a contornar.

O corte do e-mail usa reticências simples, **não** o sufixo padrão da casa
("… (texto completo registrado no chamado)"): num assunto de e-mail aquela frase prometeria um
chamado que este nó não abriu, e ainda consumiria os últimos caracteres do assunto para dizê-lo.

---

## 4. Compatibilidade

Fluxo publicado **antes** desta entrega continua idêntico:

* sem `cabecalho` e sem `secao`, a intenção da lista sai **com as mesmas chaves de antes** (provado:
  `["tipo","corpo","rotuloBotao","itens","sufixo",…]` — `cabecalho` e `secoes` não aparecem);
* botão sem `tipo` é **botão de resposta**, o nó **continua estacionando** e mantém uma saída por
  botão mais as de exceção;
* `secoes` só nasce quando **algum** item declara seção.

⚠️ **`itens` continua plano no topo da intenção**, ao lado de `secoes`, e a duplicação é deliberada:
é do array plano que o motor monta `congelarNo()` (congela o que o cliente está vendo) e é ele que a
escada de casamento percorre quando a pessoa responde "2" em vez de tocar a linha. Trocar o plano
pelas seções quebraria a resposta de **toda** lista agrupada — em silêncio.

---

## 5. Pendências declaradas (não são minhas de resolver nesta entrega)

1. **`sendEmail()` descarta `replyTo` e `bcc`.** O `src/services/smtp.service.js` do NOC aceita
   `{to, subject, html, text, attachments}` e nada mais. `responderPara` e `copiaOculta` são
   **configuráveis e hoje ignorados pelo transporte**. `enviarEmailDaIntencao()` já os manda, para
   passarem a valer no dia em que o `smtp.service.js` ganhar as duas linhas. **Provado só contra o
   dublê** — não medi contra o SMTP real.
2. **Adaptador da `PortaCanal` não existe no repositório.** Nenhum código chama `configurarMotor()`
   em produção ainda, então nenhuma intenção (nem `texto`, nem `email`) é despachada hoje. Quando o
   adaptador nascer, precisa conhecer os tipos `lista` (com `cabecalho`/`secoes`), `botoes` (com
   `modo: 'resposta'|'url'`) e `email` (rota para `enviarEmailDaIntencao`).
3. **Projeção `RagnabotFluxoNo.estaciona`.** `ragnabot-fluxo-publicacao.service.js` a grava lendo o
   campo **estático** `executorDe(tipo).estaciona`. Trocar por `noEstaciona(n)` deixa a projeção
   exata para o nó de botão de URL. Aquele arquivo é de outro dono nesta entrega. Efeito de não
   trocar: o nó aparece como "estaciona" no relatório de onde as conversas estão paradas — nenhuma
   conversa fica parada de verdade, porque quem decide é o `ResultadoNo` de `executar()`.
4. **⚠️ ALINHAMENTO COM O EDITOR — as saídas do bloco de e-mail.** O editor espelhou `padrao` e
   **`erro_interno`**; o motor declara `padrao` e **`erro`**. **O motor está certo, e é medição, não
   preferência:** `ragnabot-fluxo-motor.service.js:1763` classifica uma intenção como interna por uma
   lista fechada — `['nota','notificar','etiqueta','atribuir','resolver']` — que **não contém
   `email`**. Logo, na linha 2016, `preferida = 'erro'`, e um pino `erro_interno` desenhado na tela
   **nunca seria percorrido**. **Peço ao chefe que mande o editor alinhar para `erro`.**
   Se a intenção do produto for outra — que a falha de e-mail **nunca** derrube a conversa do cliente,
   como acontece com o aviso ao plantonista —, então o conserto é em **dois** lugares e é decisão do
   chefe: acrescentar `'email'` àquela lista do motor (arquivo que não é meu nesta entrega) **e**
   trocar a saída aqui para `erro_interno`. Mudar só um dos dois cria o pino morto.
5. **Nada disto foi exercitado contra a Meta.** Não há caixa de WhatsApp criada. Os limites usados
   (cabeçalho 60, rótulo 20, título 24, descrição 72, seção 24, URL 2000, 1 botão em `cta_url`) vêm
   da **documentação**, e o perfil continua declarado como `origem: 'documentacao'` — ou seja, a
   contagem é pelo pior caso das três unidades até alguém calibrar.

---

## 6. A prova (saída real)

```
node tests/ragnabot-fluxo-blocos.test.mjs     → 26 verde(s), 0 vermelho(s)
node tests/ragnabot-fluxo-motor.test.mjs      → 18 passaram, 0 falharam
node tests/ragnabot-fluxo-publicacao.test.mjs → 7 verde(s), 0 vermelho(s)
```

Destaques colados da execução:

```
✓ 2. preparar() monta cabeçalho, seções agrupadas E mantém `itens` plano
    → {"cabecalho":"*RAGNATELA IOT SOLUTIONS*",
       "secoes":[{"titulo":"Técnico","itens":["suporte","rede"]},
                 {"titulo":"Financeiro","itens":["boleto"]}],
       "itensPlanos":["suporte","rede","boleto"]}

✓ 7. botão de URL NÃO ESTACIONA
    → {"saidas":["padrao","sem_janela"],"estaciona":false}

✓ 9. ⚠️ MISTURA de botão de resposta com botão de URL é RECUSADA na validação
    → {"codigo":"BOTOES_MISTURADOS","campo":"config.botoes", ...}

✓ 14. e-mail é ENVIADO PELA PORTA (dublê) com as variáveis interpoladas
    → {"to":"cliente@empresa.com.br","subject":"Chamado RGT-2026-000123 registrado",
       "textoPrimeiraLinha":"Olá, Emmanuel!","htmlEscapou":true,
       "replyTo":"atendimento@ragnatela.com.br","idExterno":"<dublê-1@ragnatela>"}

✓ 20. fluxo ANTIGO produz a MESMA intenção de antes (sem cabecalho, sem secoes)
    → {"listaChaves":["tipo","corpo","rotuloBotao","itens","sufixo","_achados",
                      "_excedeuItens","_itensDescartados"],
       "botoesModo":"resposta","estacionaBotoes":true}

✓ 24. `para` e `copiaOculta` são TEXTO com vírgula (formato que o editor grava)
    → {"to":"cliente@empresa.com.br, financeiro@empresa.com.br",
       "bcc":"auditoria@ragnatela.com.br, arquivo@ragnatela.com.br",
       "subject":"Comprovante RGT-2026-000777"}

✓ 25. UM endereço ruim no meio da lista já reprova na validação
    → {"campo":"config.para[1]", "mensagem":"... \"ruim-sem-arroba\" ... falta o \"@\" ou o domínio."}
```
