# A4 — O CONSUMIDOR: quem tira da fila a ação `notificar` e a mensagem de entrada

**Arquivos:** `/ia/netagent/src/services/ragnabot-atend-despertar.service.js` ·
`/ia/netagent/tests/ragnabot-atend-despertar.test.mjs`
**Base documental:** doc 29 §1.4 (encerra ou deixa aberta), §5.3 (quem manda no relógio), §5.4 (a
fila `atend_relogio`), §5.6 (por qual caminho cada ação sai) · doc 28 §2.4 (contrato da fila) e
§3.2/D (caixa de saída de duas fases).
**Estado:** implementado e provado por teste (26 casos, todos passando). **Não amarrado ao
processo** — ligar o laço e injetar as portas é decisão do chefe.

> **Cobre DOIS tipos de trabalho da fila**, não um: `atend_relogio` (a ação `notificar` do relógio de
> inatividade) e `atend_mensagem` (a mensagem avulsa da portaria de entrada, entregue por A1). Os
> dois nasciam órfãos na `RagnabotFluxoFila` pelo mesmo motivo, e recebem aqui exatamente as mesmas
> garantias.

---

## 1. O que faltava, em uma frase

`RagnabotFluxoFila` é a fila do motor, e quem a roda **ignora trabalho sem `execucaoId`**. Dois
produtores gravam ali trabalhos que, por natureza, **não pertencem a nenhuma execução de fluxo**:

- o **relógio de inatividade**, na ação `notificar` — as outras três ações (devolver para a fila,
  transferir de setor, resolver) acontecem dentro do próprio trabalhador; só essa sai pela fila;
- a **portaria de entrada**, quando o resolvedor decide responder *sem* iniciar fluxo — o aviso de
  fora de expediente, o de intervalo, o de feriado, a despedida de quem estava na fila.

Nos dois casos a linha entrava na fila e ficava lá para sempre. Este serviço é o consumidor que
faltava para os dois.

### Por que um consumidor só, e não dois

As garantias exigidas pelos dois tipos são **literalmente as mesmas quatro**: idempotência por
efeito reservado, janela de 24 h com a ação de estado acontecendo mesmo quando a mensagem não sai,
partição respeitada e degradação declarada quando falta porta. Dois consumidores seriam duas
implementações dessas quatro regras, dois laços disputando a mesma tabela e dois lugares para
alguém corrigir no dia em que uma delas mudar. O que de fato difere — **de onde vem o texto**, **o
que conta como ciclo** e **se há ação de estado depois da entrega** — cabe em duas funções curtas de
entrada, e é só isso que existe separado.

## 2. O que o operador percebe

### 2a. `notificar` — o «ainda está aí?»

A conversa está com um atendente (ou parada na fila) e **ninguém fala há N minutos** — o tempo que a
empresa configurou, contado só em minutos de expediente. Vencido o prazo, com a ação configurada em
**`notificar`**, acontecem duas coisas:

1. **O cliente recebe o "ainda está aí?"** — o texto que a empresa escreveu no campo
   *Mensagem de inatividade*. A conversa **não muda de dono, não muda de status e não é resolvida**:
   o objetivo é só desencalhar a pessoa.
2. **A supervisão fica sabendo**, por uma **nota interna** na própria conversa — a nota que só a
   equipe lê, nunca o cliente.

Se a empresa deixar a *Mensagem de inatividade* **vazia**, isso não é erro: é a configuração "age em
silêncio". Sai só a nota interna, e nada chega ao cliente.

Quando o cliente (ou o atendente) responde **antes** do prazo, o relógio é rearmado e o despertar
antigo é **descartado**. O cliente nunca lê "ainda está aí?" logo depois de ter acabado de escrever.

### 2b. A mensagem de entrada — «voltamos às 13h»

O cliente escreve fora do expediente (ou no almoço, ou num feriado). A portaria decide que ali **não
nasce fluxo nenhum** e enfileira a frase que a empresa cadastrou. Este consumidor a entrega, e:

- **se a política mandar encerrar depois**, a conversa é resolvida logo em seguida — nessa ordem,
  porque encerrar antes fecharia a conversa sem a despedida chegar;
- **não é escrita nota interna** no caso normal, de propósito: uma nota a cada saudação de fora de
  hora encheria de ruído a conversa que o atendente vai abrir no dia seguinte. A nota sai só quando
  há algo que **só ela** conta — a mensagem que não saiu, ou o encerramento automático.

Essa mensagem tem **prazo de validade: 30 minutos**. «Voltamos às 13h» entregue às 16h contradiz o
que o cliente está vendo na tela e faz o robô parecer quebrado — então, se o trabalho ficou preso na
fila mais que isso, ele é **descartado** em vez de entregue. O «ainda está aí?» do relógio **não**
expira, porque continua verdadeiro depois.

## 3. O limite honesto: a janela de 24 horas do WhatsApp

**O WhatsApp só aceita mensagem livre até 24 horas depois da última mensagem do cliente.** Passado
esse prazo, a plataforma da Meta recusa qualquer texto que não seja um modelo aprovado por ela. Isso
não é escolha nossa e não tem contorno.

Então, quando o prazo do relógio vence **fora dessa janela**:

- **a ação de estado acontece** — a nota interna é escrita, e a supervisão sabe que aquela conversa
  está parada;
- **a mensagem não sai**;
- **o motivo fica escrito na própria conversa**, em português: *"O texto para o cliente NÃO saiu — a
  janela de 24 h do WhatsApp está fechada"*. Sem essa frase, o atendente abriria a conversa e
  concluiria que o robô simplesmente não funcionou.

O trabalho é dado por **concluído**, não por falho — reentregar oito vezes algo que jamais poderá
dar certo só produz barulho no log.

E há um caso em que **nós não temos como saber** se a janela está aberta: quando a conexão de
WhatsApp ainda não tem `phoneNumberId` cadastrado, ou quando não conhecemos o telefone do contato.
Nesse caso o serviço **não chuta**: tenta enviar e deixa a Meta responder. Se a recusa vier de lá, o
desfecho é o mesmo do parágrafo acima — nota interna com o motivo, mensagem não enviada, trabalho
concluído.

> ⚠️ **Nada disso pôde ser exercitado contra um WhatsApp de verdade**: o ambiente ainda não tem
> nenhuma caixa de WhatsApp criada. O comportamento está provado por teste, com a porta do canal
> substituída — não por observação em produção.

## 4. Como funciona por dentro

`processarDespertar(job, { workerId })` executa, nesta ordem — e a ordem é o que impede cada uma das
armadilhas:

| # | passo | por que está aí |
|---|---|---|
| 1 | é trabalho nosso? (`tipo='atend_relogio'` e `acao='notificar'`) | trabalho de outro dono devolve `ignorado`, nunca `erro` — erro queimaria as 8 tentativas de uma linha sadia |
| 2 | o trabalho ainda vale? | **relógio:** rearmar repõe `disparadoEm=null` na **mesma** linha; se está nulo, o cliente falou antes do prazo → `descartado_obsoleto`. **mensagem:** passou dos 30 min na fila → `descartado_obsoleto` |
| 3 | **a partição está livre?** (§5.3) | se existe execução de fluxo viva que não seja `pausado_humano`, ou um trabalho de fluxo em `processando` na mesma conversa, o despertar é **adiado 30 s** e volta para a fila |
| 4 | **o portão da idempotência** | procura o efeito pela chave determinística do ciclo; se já existe, devolve `ja_notificado` e **não faz mais nada** |
| 5 | monta o texto | `{{placeholders}}` resolvidos pelo mesmo `aplicarModelo()` já usado no resto do atendimento |
| 6 | avalia a janela de 24 h | leitura de `RagnabotFluxoJanela` pela chave (número da empresa, destinatário) — a mesma regra do motor |
| 7 | reserva o efeito | `reservarEfeito()` do motor — a caixa de saída de duas fases, não uma cópia dela |
| 8 | despacha pela porta do canal | é aqui, e só aqui, que há rede |
| 9 | confirma / descarta / falha o efeito | `confirmarEfeito`, `descartarEfeito`, `falharEfeito` — todos do motor |
| 10 | escreve a nota interna | sempre, inclusive quando a mensagem não saiu, **carregando o motivo** |

### A chave que garante "uma mensagem, uma vez só"

A idempotência não é um `if` nem um contador: é a **chave de efeito** do motor, calculada por
`chaveEfeito()`, e montada de propósito com estas peças:

- um **alvo** que identifica o ciclo: para o relógio, a linha do relógio (única por
  *conta:conversa:tipo*); para a mensagem de entrada, a **entrada** que a originou — e a portaria já
  deduplica entrega repetida do Chatwoot antes de chegar aqui;
- um nó sintético fixo (`atend_relogio:notificar` ou `atend_mensagem:entrada`) — não há nó de fluxo
  aqui, mas a chave exige um, e fixo é rastreável num `grep`;
- o **carimbo do ciclo** no sufixo — no relógio, o `disparadoEm`: rearmar zera esse campo e o disparo
  seguinte grava outro. Sem essa peça, ou o cliente nunca receberia um segundo aviso, ou receberia
  todos os avisos em dobro;
- **tentativa fixa em 1** — ao contrário do que o motor faz nos nós de fluxo, onde a tentativa entra
  na chave para que um reenvio legítimo não colida com o anterior. Aqui reentrega é justamente o que
  **não** pode virar segunda mensagem.

### Duas decisões que merecem estar escritas

**O efeito não se pendura na execução de fluxo do cliente.** Ele usa um identificador sintético
(`relogio:<id>`). O motivo é concreto: o motor **congela a marcha** de uma execução enquanto houver
efeito dela sem desfecho. Se o processo caísse entre reservar e enviar o nosso aviso, um encanamento
do relógio passaria a segurar o atendimento de um cliente. Com o identificador sintético, o efeito é
invisível para o motor — que é exatamente o que ele deve ser. (`RagnabotFluxoEfeito.execucaoId` é
texto e não tem chave estrangeira — conferido no banco de produção.)

**O consumidor não usa `drenarParticao()` do motor.** Aquela função drena **todos** os trabalhos
pendentes da conversa, de qualquer tipo. Um consumidor que a chamasse roubaria os trabalhos de fluxo
da mesma conversa e os daria por processados sem executá-los — a conversa ficaria muda. Aqui a
reivindicação é linha a linha, condicional (`status='pendente'` no WHERE), e só sobre os dois tipos
que são dele.

**O nome do tipo `atend_mensagem` está escrito em dois lugares** — aqui e na portaria. É duplicação
declarada: um `import` estático entre dois serviços da mesma leva é dependência de arranque, e
arquivo ausente derruba o processo inteiro ao subir. A defesa contra as duas fontes divergirem não é
disciplina: é um teste que importa a portaria e compara as constantes. Se alguém renomear lá sem
renomear aqui, o teste fica vermelho antes de a mensagem voltar a ficar órfã em silêncio.

## 5. O laço

`iniciarConsumidorDeDespertar({ intervaloMs })` liga um tique de **15 segundos** (e não 60 como o
trabalhador de atendimento): quando o trabalho chega aqui, o prazo **já venceu** — quem esperou os
minutos foi o relógio, e daí em diante cada segundo é o cliente esperando. O laço tem trava de
reentrância, `unref()` no timer (não segura o processo no encerramento) e devolve a função que o
desliga.

Junto vem um **ceifador**: trabalho preso em `processando` por um consumidor que morreu volta a ser
candidato depois de 10 minutos. Sem ele, um reinício no meio de um despertar deixaria a linha presa
para sempre, e o sintoma seria "essa conversa nunca recebeu o aviso", sem nenhum registro dizendo
por quê.

## 6. Degradação declarada

| falta | o que acontece |
|---|---|
| porta do **canal** ausente (Chatwoot/WhatsApp não amarrados) | nota interna sai, aviso no log, resultado `sem_porta`. **Não quebra e não trava a fila** |
| porta de **nota interna** ausente | o aviso ao cliente sai normalmente; a nota é apenas registrada como não escrita no log |
| política sem mensagem | age em silêncio (só nota interna) — é configuração legítima, não erro |
| envio falhou por outro motivo (rede, 500) | efeito marcado `falhou`, motivo escrito na nota interna, trabalho reenfileirado; ao estourar o teto de tentativas vira `falhou` na fila |
| porta de **resolução** ausente com `encerrarApos` | a mensagem sai normalmente; a nota interna registra que a conversa **não** foi encerrada e por quê |
| passo de fluxo vivo na conversa | o trabalho volta para a fila com 30 s de prazo e **sem gastar tentativa** — adiar não é defeito do trabalho, e sem essa regra uma conversa com fluxo demorado envenenaria um trabalho sadio em oito adiamentos |

**Um limite conhecido, e ele é escolha:** se o processo morrer exatamente entre reservar o efeito e
enviar a mensagem, a reentrega seguinte vê o efeito já reservado e **não reenvia**. O cliente fica
sem o aviso daquele ciclo. É a troca deliberada da casa — silêncio é falha melhor que mensagem
repetida —, e o ciclo seguinte do relógio volta a avisar normalmente.
