# 📌 Versões do Ragnabot

> **O que é este arquivo.** É o diário de bordo das funcionalidades do Ragnabot — a nossa
> plataforma de atendimento omnichannel. Cada versão registra, em português claro, **o que passou a
> existir** e **o que ainda depende de quê**. É a fonte para acompanhar as novidades e para explicar
> ao cliente o que mudou.
>
> **Como versionamos.** `MAIOR.MENOR.CORREÇÃO` (ex.: `1.04.02`).
> - **MAIOR** — mudança de patamar (um canal novo inteiro, um módulo grande).
> - **MENOR** — funcionalidade nova dentro do que já existe.
> - **CORREÇÃO** — conserto ou ajuste sem funcionalidade nova.
>
> A versão vigente fica no arquivo `VERSAO` na raiz do repositório. **Toda entrega nova acrescenta
> um bloco no topo desta lista** — nunca reescreve os antigos.
>
> **O que é o número da plataforma-base.** O Ragnabot roda sobre o Chatwoot; a versão dele é técnica
> e separada. Este arquivo versiona **o nosso produto** — a soma da infraestrutura, das automações e
> das integrações que construímos por cima.

---

## v1.16.00 — O sistema parou de saber e não contar: publicar agora diz o que está errado (03/09/2026)

A frase que resume: **acabaram os dois validadores que discordavam. Agora existe um número só, com
um dono só — e quando ele diz que há erro, ele diz QUAL erro, EM QUAL bloco, e leva você até lá.**

### O que aconteceu, na tela do dono

Ele terminou de desenhar o fluxo — Início → Boas-vindas → Botões → «Teste do sim» → Encerrar, com as
ligações de exceção todas desenhadas. A barra de cima dizia, **em verde: «desenho fechado»**. Clicou
em publicar e recebeu: **«Não consegui publicar — O fluxo tem 2 erro(s) e não pode ser publicado.»**
Sem dizer quais.

Duas conferências, dois veredictos opostos, e nenhuma pista. O fluxo dele estava a **dois cliques**
de publicar, e não havia como descobrir onde.

### Os dois erros, medidos no ar

| # | O que era | Por que era defeito NOSSO |
|---|---|---|
| 1 | O bloco de mídia tinha a categoria `imagem` e o motor só aceitava `image` | O seletor da tela oferecia «Imagem» e «Documento» **em português**, e gravava `imagem`/`documento`. O motor só falava o vocabulário da Meta. **Duas das quatro opções do seletor produziam um fluxo impossível de publicar.** |
| 2 | «O fluxo tem nó que espera resposta, mas não define nó de resgate» | O nó de resgate só é usado numa **migração forçada** de conversas vivas — e este fluxo nunca tinha sido publicado, com **zero conversa** dentro. Pior: a instrução mandava «marque um nó com `config.resgate=true`», e **a tela não tinha esse interruptor em lugar nenhum**. Uma regra que não dá para cumprir não protege nada: só trava o produto. |

### O que mudou

**1. Um validador só, e ele é o do servidor.** A tela tinha uma conferência própria que cobria
menos regras que a publicação — foi ela que pintou o verde mentiroso. Agora a barra do editor
**pergunta ao servidor** (a cada meio segundo depois de você parar de mexer) e mostra a resposta
**dele**: o número da barra e o número da publicação são, por construção, o mesmo número. Quando o
servidor não responde, a tela ainda mostra a conferência local — mas **diz que é local**.

**2. A caixa de publicar LISTA os erros.** Cada linha traz o que é, **em qual bloco** (pelo nome,
não pelo identificador), o que fazer, e um botão **«Ir para o nó»** que fecha a caixa e leva a vista
até o bloco. Quando o problema é uma ligação fantasma — dessas que não aparecem no desenho e não dá
para tocar —, a linha traz o botão que a apaga. E o botão «Publicar» fica desabilitado enquanto
houver erro, dizendo quantos são.

**3. O erro aparece enquanto você desenha.** Novo botão **«Problemas»** na barra de vista abre uma
gaveta com a lista completa — a mesma da caixa de publicar. O contador da barra virou botão: clicar
nele abre a gaveta.

**4. O seletor de mídia fala o vocabulário certo.** Continua escrito «Imagem», «Documento», «Áudio»,
«Vídeo» — e agora também «Figurinha» —, mas grava o valor que o motor entende. Fluxo já salvo com o
valor antigo em português **continua valendo**: o motor passou a reconhecer os dois.

**5. O nó de resgate deixou de travar quem não precisa dele.** Virou **aviso** na publicação normal
e continua **erro** só no retrofit forçado, que é onde ele realmente é usado. E o interruptor
**«Usar este nó como resgate»** passou a existir, na aba «Avançado» do bloco — para quem quiser
cumprir a regra de fato.

**6. O servidor ganhou as regras que só a tela tinha.** Duas ligações na mesma saída agora são
recusadas por ele (antes só a tela via, e o banco recusaria depois). E saída de exceção sem destino
virou **aviso** em vez de silêncio: sem destino ali, quem escrever fora da janela de 24 horas não
recebe nada — e o autor merece saber disso antes.

### Prova
`app/tests/ragnabot-fluxo-validacao-unica.test.mjs` — **27 verificações**, entre elas a que compara
o contador da barra com o da publicação sobre cinco documentos × três modos de migração. Se alguém
reintroduzir uma segunda conta em qualquer um dos lados, esse teste quebra.

### Achado de passagem
O arquivo `ragnabot-fluxo-publicacao.service.js` continha **três bytes NUL literais** (usados como
separador de chave composta). Efeito colateral: o `grep` tratava o arquivo inteiro como binário e
**não achava nada dentro dele** — num serviço crítico de 780 linhas. O separador continua sendo o
mesmo caractere, agora escrito como `\u0000`.

---

## v1.15.00 — O botão que o cliente toca passa a valer, e o segredo saiu do ambiente (03/09/2026)

> 🚀 **Este número publica TRÊS versões de uma vez.** A v1.13.00 (a mesa) e a v1.14.00 (o tempo
> real) estavam construídas e provadas, mas **nunca tinham subido**: no ar rodava a v1.12.01. Elas
> chegam ao usuário **no mesmo instante** que esta. Quem ler só o bloco abaixo entende metade —
> para o dono e para o atendente, o que muda hoje é a soma dos três.

A frase que resume: **o cliente que toca num botão passa a ser entendido; o atendente ganhou uma
mesa de trabalho que se atualiza sozinha; e a credencial que faz isso funcionar deixou de morar
num único lugar do ambiente.**

### 1. ⭐ O botão que o cliente tocava e não valia

Este é o conserto que mais dói admitir, porque o defeito era **nosso** e a documentação interna o
escondia. A nossa tabela de capacidades dizia que Telegram e Facebook **não** desenhavam botão. Fui
ler o código da plataforma antes de escrever qualquer linha, e o contrário é que era verdade:

| canal | desenha botão? | e o que voltava quando o cliente tocava |
|---|---|---|
| Telegram | **sempre desenhou** | o valor volta — mas como **texto**, não como campo de escolha |
| Facebook | **sempre desenhou** | o valor **se perde**; volta o **rótulo** do botão |
| Instagram | não desenha | (por isso existe o envio direto, item 2) |

Como o nosso casador só sabia comparar pelo **valor**, acontecia a pior combinação possível: o
cliente tocava no botão **certo** e ouvia **«não entendi»**. Um menu que pune quem obedece. Agora o
casamento é por valor **ou** por rótulo, e no Facebook o rótulo é cortado em 20 letras — porque
rótulo cortado é opção que não casa mais.

⚠️ **Efeito colateral bom, e para melhor:** como os dois canais já desenhavam botão, não é preciso
credencial nenhuma para eles. O caminho pela plataforma continua sendo o caminho.

### 2. O Instagram, que é a lacuna de verdade

Só o Instagram não traduz escolha em botão. Para ele, e **só** para ele, o motor fala direto com a
Meta e **em seguida registra a mensagem na conversa** — senão o atendente abriria o atendimento e
não veria o que o robô disse ao cliente. O registro é feito de um jeito que a plataforma **não
reentrega** a mesma mensagem: ninguém recebe duas vezes.

Achado que evitou trabalho jogado fora: o botão «bonito» (o de modelo) **não funciona para
escolha** — o toque nele é descartado em silêncio pela plataforma, que não escuta esse tipo de
evento. Por isso usamos **resposta rápida**, que volta como mensagem comum e atravessa o caminho
normal.

### 3. O cofre, e a credencial que se acha sozinha

O token do canal **não é publicado** pela plataforma — conferido no código dela. Então ele passa a
vir de fora, procurado nesta ordem, e nenhum degrau é obrigatório:

1. **cofre cifrado da empresa**, no apelido que a própria conexão declarar;
2. **cofre cifrado da empresa**, no apelido convencional do canal;
3. **ambiente**, token direto do canal;
4. **ambiente**, token de sistema da Meta — de onde se deriva o token da página.

O cofre por empresa é o caminho do SaaS (cada cliente com o seu token); o ambiente é o caminho da
instalação única. **Não achou nada? Degrada para texto numerado, dizendo o motivo** — nunca em
silêncio. A rede que já existia continua inteira.

⚠️ **Uma decisão de segurança fica com o dono.** O token gravado hoje é o **mesmo** que o marketing
usa para publicar: dá ao motor mais poder do que ele precisa (ele precisa de dois escopos; o token
tem 29). Foi construído de propósito para que **separar seja trocar um valor**, sem tocar em
código: basta gravar um token só de mensagens no degrau 3 e o degrau 4 deixa de ser usado.

### 4. A barrinha que girava no aparelho do cliente

No Telegram, tocar num botão deixa uma barrinha girando até alguém confirmar o recebimento. O motor
passou a confirmar. E a falha dessa confirmação é engolida de propósito: **ela nunca custa a
mensagem do cliente**.

### 5. A cópia do proxy, que estava mentindo (correção de recuperação de desastre)

A cópia versionada da configuração do proxy estava **defasada** em relação ao que roda de verdade:
faltavam as duas linhas que deixam a conexão virar fluxo contínuo. Quem recriasse o ambiente a
partir dela subiria um proxy em que **a caixa do item 6 volta a depender de F5**. Corrigida, com a
dependência do `map` escrita ao lado. Só o arquivo do repositório — o nginx não foi tocado.

### 6. E, no mesmo instante, tudo o que já estava pronto e não tinha subido

- **v1.13.00 — a mesa:** abrir a conversa, ler o histórico, aceitar em seu nome, responder e
  transferir. Antes era uma lista que não abria nada.
- **v1.14.00 — o tempo real:** conversa nova aparece sozinha, mudança de estado reflete na hora, e
  quando a ligação cai ela volta e relê o que perdeu. Sem botão «Atualizar», sem F5. Inclui o
  espelho de setores se conferindo sozinho a cada 15 minutos — o dado que decide **quem vê a fila
  de quem**, e que até então dependia de alguém lembrar de clicar num botão.

### O que **não** está provado, e é honesto dizer

**Não há caixa de Instagram, Facebook nem Telegram ligada.** Não se prova que o cliente **vê** o
botão, nem que a Meta aceita o token. O que se prova é que o formato certo sai pelo caminho certo,
que a busca da credencial percorre os quatro degraus, que a degradação acontece quando deve e que
nenhum segredo vaza. Os limites de tamanho vêm da documentação oficial, não de um envio recusado.

⛔ **Continuam desligados**, e medidos desligados: o executor de fluxo, o agendamento e o carteiro
de webhook. A plataforma segue com **zero webhooks** cadastrados — nada disto alcança um cliente
real ainda.

## v1.14.00 — A caixa se atualiza sozinha: sem botão, sem F5 (03/09/2026)

> ✅ **PUBLICADA em 03/09/2026, dentro do lote da v1.15.00.** A espera valeu e está registrada aqui
> porque explica a lei: em 03/09 a árvore tinha **três frentes ao mesmo tempo** (esta, os botões
> nativos e a mesa) e duas ainda estavam em obra, sem commit. Uma imagem tirada daquela árvore
> levaria para produção o trabalho inacabado de outra pessoa. As três fecharam e saíram juntas, num
> **único** build — que é o que a lei do lote manda.

A frase que resume: **a fila do atendente deixou de depender de alguém clicar. Conversa nova
aparece, mudança de estado reflete na hora, mensagem entra na conversa aberta — e, quando a ligação
cai, ela volta sozinha e relê tudo o que perdeu.**

### O que o dono pediu

*«Essa parte não deve ser necessário clicar em sincronizar; a atualização deve ser em tempo real, e
inclusive sem atualizar a página, como é hoje no chat atual.»*

Ele está certo, e isso vale para a caixa inteira. Botão «Atualizar» e botão «Sincronizar setores»
eram muleta: numa mesa de atendimento, conversa nova tem de **aparecer sozinha**.

### 1. Os setores se conferem sozinhos

O espelho de setores e da lotação deles passou a rodar **uma vez no arranque e a cada 15 minutos** —
o mesmo desenho e o mesmo intervalo das caixas de entrada, que já se conferiam assim.

⚠️ **Por que isso era grave e não apenas incômodo:** era o único dado da caixa que nascia de gesto
humano, e é justamente ele que decide **quem vê a fila de quem**. Em 03/09 todas as conversas
apareciam «sem setor» pelo motivo mais simples possível: ninguém nunca tinha clicado no botão. Um
atendente recém-incluído num setor não via a fila dele — e um atendente **retirado** de um setor
continuava vendo. Este segundo caso é o que dói.

O botão continua existindo como reforço, para quem acabou de criar um setor e não quer esperar.

### 2. A fila viva

Conversa nova entra na lista; aceitar tira de «Aguardando» e põe em «Atendendo»; transferir move o
cartão da tela de quem perdeu para a de quem recebeu; resolver muda de aba. **Os contadores das abas
acompanham** — eles vêm do servidor, do mesmo construtor de consulta da listagem, porque contador
que mente é pior que contador ausente.

Dentro da conversa aberta, **mensagem nova aparece sem F5**, sem piscar a tela e sem tirar do lugar
o que o atendente está lendo ou digitando.

### 3. O selo que não deixa a tela mentir

Verde, **«Ao vivo»**: está atualizando sozinha. Amarelo, **«Reconectando…»**: caiu e está voltando —
com recuo de 1 s, 2 s, 4 s… até 30 s, e com sorteio, para trinta navegadores que caíram juntos não
voltarem juntos em cima do motor. Quando volta, **relê a fila inteira**.

Sem o selo, «não chegou nada» e «a ligação morreu» seriam a mesma imagem para quem atende. Tela que
congela em silêncio é pior que tela que avisa.

### 4. ⭐ A armadilha que define esta entrega: duas réplicas

O motor roda em **2 pods**. O aviso nasce no pod que recebeu o webhook; o atendente pode estar
pendurado no outro. **Sem canal comum, ele nunca recebe** — e o defeito é intermitente por natureza:
some quando alguém testa com um pod só e volta em produção.

A resposta é **canal comum**, não afinidade de sessão no proxy (que amarraria a pessoa a um pod e
transformaria cada implantação em «a tela travou»). O canal usa `LISTEN/NOTIFY` do **PostgreSQL** —
que a aplicação já usa, com o segredo que já existe e a porta que a política de rede já libera.

**Provado com dois processos de verdade**, PIDs diferentes, no mesmo banco: o evento publicado por um
chega ao cliente conectado ao outro. E provado ao contrário também — desligando o canal comum, o
teste **reprova**, que é o que garante que o verde vale alguma coisa.

### 5. O isolamento vale no tempo real

O aviso **só é escrito para quem tem direito de ver aquela conversa**, com as **mesmas cláusulas** da
consulta — não há uma segunda cópia da regra para divergir em silêncio. Empurrar para todo mundo e
filtrar na tela seria vazamento: o roteamento de conversas de outro setor chegaria de verdade ao
navegador, e bastaria abrir o inspetor de rede.

**Nenhum texto de cliente viaja no aviso.** Ele diz «a conversa 41 mudou, motivo: mensagem»; o
conteúdo a tela busca na fonte.

### O que foi escolhido, e por quê

**Transporte: SSE, não WebSocket.** O motivo decisivo é **autenticação**: SSE é um `GET` comum,
entra no mesmo router e passa pelo **mesmo** guarda de sessão de todas as outras rotas, com o mesmo
cookie. O `upgrade` do WebSocket acontece antes disso e exigiria um **segundo** caminho de
identidade, escrito à mão, no ponto mais sensível do sistema. Somam-se: o tráfego é de mão única
(a tela já responde pelas rotas normais), nenhuma dependência nova, e reconexão nativa do navegador.

⚠️ **Correção honesta:** a primeira versão desta justificativa dizia que WebSocket «não passaria»
pelo proxy. **Medido no vhost que está no ar, é falso** — as linhas de `Upgrade` existem lá. Quem
mente é a **cópia versionada** do vhost (`app/deploy/nginx/bot-painel.conf`), que está defasada.
Fica registrado como achado para quem cuida do proxy: aquele arquivo é a fonte de recriação do
ambiente do zero, e fonte de recriação que mente é pior que fonte ausente. A escolha por SSE não
muda — muda a razão, que agora é a verdadeira.

As duas armadilhas de SSE atrás de nginx foram medidas e desarmadas de dentro da aplicação:
buferização (o bloco `/painel/` não declara `proxy_buffering`, então vale o padrão, que é ligado →
`X-Accel-Buffering: no`) e corte por ociosidade (proxy em 120 s, Ingress em 60 s → batimento de
20 s).

**Barramento: PostgreSQL, não Redis.** Mesmo critério. Redis exigiria dependência nova, três chaves
novas no `Secret` e uma porta de Sentinel que nunca foi medida na política de rede — ou seja, uma
decisão de infraestrutura antes da primeira mensagem andar. O PostgreSQL não custa nada disso. O
canal é uma peça trocável: quando o volume justificar, entra Redis mudando uma linha.

### Onde conferir

`GET /saude` ganhou `tempoReal` (canal, se é compartilhado, conexões abertas, avisos recusados por
isolamento) e `cadastroDeSetores` (quando o espelho rodou, e com que resultado).

### Limite honesto

Ainda **não há caixa de WhatsApp criada** no ambiente. A travessia entre réplicas, o isolamento e os
cabeçalhos foram provados; o volume de uma mesa real com dezenas de atendentes ainda não foi medido
porque não existe mesa real ainda.

---

## v1.13.00 — A caixa virou mesa de trabalho: aceitar, ver, responder e transferir (03/09/2026)

A frase que resume: **a nossa tela de Atendimentos era uma lista que não abria nada. Agora o
atendente abre a conversa, lê o que o cliente escreveu, aceita o atendimento em seu nome, responde —
e passa adiante quando o assunto é de outro.**

### O que o dono viu

Ele abriu a tela e disse: *«quando chega uma mensagem eu não consigo aceitar ela, para ficar
associada a mim como agente. Eu não deveria ter condição de escrever ou interagir com o chat senão
aceitar como agente. Pode haver, como o outro chat que está em uso hoje, apenas um botão com símbolo
de olhos para ver o que tem dentro da conversa — mas para escrever, apenas se tiver atribuída a mim
como agente. E também ainda não tem o botão de transferência para outro analista e/ou setor.»*

E, no mesmo dia: *«não consigo aceitar, transferir e ver nada da conversa»*. Ele tinha razão nas
três: clicar num cartão não abria coisa nenhuma.

### 1. Abrir a conversa — e ela abre de verdade

Clicando no cartão, o atendimento se abre inteiro: o histórico na ordem em que aconteceu, com **quem
falou escrito por extenso** em cada mensagem (Cliente · Atendente · Robô · Nota interna), separador
de dia com «Hoje» e «Ontem», e as **fotos, áudios e documentos** que o cliente mandou aparecendo ali
mesmo.

**O horário é sempre o de quem atende (UTC−3)** — nunca o do relógio do navegador. Duas pessoas
olhando a mesma conversa de máquinas diferentes leem a mesma hora. Sem isso, uma delas responderia
«acabei de ver» a uma mensagem de três horas atrás.

**A mídia é entregue pelo painel.** O endereço do arquivo na plataforma **não chega ao navegador**:
quem busca o arquivo é o nosso servidor, e ele o entrega. É o que impede endereço interno de vazar
na tela — e o que faz a foto abrir mesmo quando a rota pública não serve de dentro do cluster.

**O conteúdo continua morando na plataforma.** Nada do que se lê aqui é copiado para as nossas
tabelas. Texto de cliente tem dono, e uma segunda cópia é uma segunda verdade para vazar.

### 2. ⭐ Aceitar — e a briga de dois cliques ao mesmo tempo

Conversa na fila ganhou o botão **«Aceitar»**: um clique e ela passa a ser de quem clicou, aqui e
**também na plataforma** — senão a tela dela e a nossa contariam histórias diferentes.

**O caso difícil é dois atendentes clicando no mesmo instante.** Isso não se resolve escondendo
botão: quando duas pessoas olham a mesma fila no horário de pico, elas clicam juntas. A decisão é
tomada **no banco**, numa única sentença que só grava se a conversa ainda não tiver dono. Quem
chega primeiro leva; quem chega meio segundo depois **recebe o nome de quem levou** — «Esta conversa
já foi aceita por Ana» —, não um «erro ao aceitar» que o mandaria recarregar a tela para descobrir
sozinho o que o servidor já sabia.

Medido: 2 cliques simultâneos → 1 vencedor. **20 cliques simultâneos → 1 vencedor.**

### 3. 👁 Espiar — ver sem assumir, e ficar registrado

Como no chat que a empresa usa hoje, há o **botão do olho**: abre a conversa **em leitura**, sem
tomá-la para si. Vale para a **fila dos setores de que a pessoa participa** — e **não** para conversa
que já está com um colega: essa continua invisível, como sempre foi.

**Toda espiada fica na auditoria**: quem espiou, qual conversa, quando. Ver conversa de cliente é
ato que se registra. Abrir a *própria* conversa não gera registro — isso é o trabalho, já registrado
no aceite, e carimbar cada abertura encheria a auditoria de ruído até ninguém mais a ler.

### 4. ⛔ Escrever só se for sua — e quem recusa é o servidor

Sem atribuição, **o campo de escrita não existe**. No lugar dele aparece a frase que explica o
porquê e o botão que resolve.

**E a trava não é a tela.** Um atendente que mandar a mensagem direto pela API, com a sessão dele,
numa conversa que não é dele, **é recusado pelo servidor**. Esconder o campo no navegador não teria
impedido nada; isto impede.

**O administrador também precisa aceitar para escrever** — e essa foi uma decisão, não um esquecimento.
Mensagem sem dono é responsabilidade que se perde: seis meses depois, «quem respondeu isso?» fica sem
resposta. O que o administrador tem a mais é **«Assumir para mim»**: toma a conversa de quem estiver
com ela, num clique — e o clique **fica registrado como transferência**, com o nome dele.

Há também a **nota interna**: fica na conversa para a equipe, e o cliente não recebe.

### 5. ⭐ Transferir — para outro atendente e/ou outro setor

O botão que faltava. Escolhe-se a pessoa, o setor, ou os dois; escreve-se o motivo (que vira
relatório) e uma observação para quem receber. Dá para avisar o cliente, se quiser.

**A conversa muda de dono na hora — e com ela muda quem a enxerga.** Quem recebeu já a vê e já pode
responder; quem mandou deixa de vê-la no mesmo instante. Não há espera nem atualização de tela: a
regra de visibilidade é uma condição de consulta, então mudou a linha, mudou a resposta.

**Transferir para um setor sem escolher atendente devolve a conversa à fila daquele setor** — quem
for membro dele já a encontra na aba «Aguardando».

Tudo fica registrado: de quem, para quem, quando, por quê, e quem mandou.

### 6. O histórico da conversa transferida — a decisão, escrita

A conversa **vai inteira** para o setor novo: quem recebe lê tudo o que já foi dito dentro dela.
O que **não** vai junto é o histórico das **outras** conversas daquele cliente no setor de origem —
essas continuam invisíveis para quem recebeu.

É deliberado. Se o histórico seguisse a transferência, uma única transferência abriria o histórico
inteiro de outro setor — exatamente o que o dono proibiu ao dizer *«os históricos devem ficar a cada
setor e não global»*. A ponte entre os dois lados é a **nota interna da transferência**, que quem
recebe lê dentro da própria conversa.

### O que foi provado, e por observação

**54 medições** contra PostgreSQL de verdade e a API de verdade
(`app/tests/ragnabot-mesa-atender.test.mjs`), entre elas: a corrida com vencedor único; a recusa de
escrita pela API; a espiada que não atribui e fica auditada; a transferência que muda quem vê na
hora; o histórico que **não** atravessa a fronteira de setor. Mais **33 medições** da tela
(`app/web/tests/caixa.smoke.mjs`), incluindo que o campo de escrita **não é renderizado** sem
atribuição e que o endereço da mídia é o do nosso painel.

De passagem, a rede de segurança irmã (o teste de isolamento do S2) **estava quebrada em silêncio**
desde uma migração anterior e voltou a rodar: 63 medições verdes.

### O que ficou de fora, e é bom dizer

- **Respostas rápidas pelo atalho `/`** dentro da conversa: **não entrou**. O recurso existe e tem
  tela própria; ligá-lo ao campo de escrita é trabalho separado, e fazer pela metade seria pior.
- **Atualização automática** da conversa aberta: hoje o histórico recarrega quando você age. Nova
  mensagem do cliente aparece ao reabrir ou ao responder.
- **Enviar anexo** pela nossa tela: só recebemos mídia; mandar arquivo ainda é pela tela do
  fornecedor.

---

## v1.12.01 — Dá para ligar as caixas do fluxo (03/09/2026)

A frase que resume: **tocar o conector abria, por cima do nó de destino, o painel que mandava tocar
nele. Agora o conector só liga — e ligar passou a ter dois caminhos, o arraste e o toque.**

### O que o dono viu

Ele abriu um fluxo com duas caixas, «Início» e «Botões», e disse: *«não estou conseguindo criar e
ligar as caixas do fluxo»*. A tela mostrava o diagnóstico certo — `ARESTA_AUSENTE`, «a saída "segue"
do nó "no_inicio" não leva a lugar nenhum» — e a instrução certa: «toque no conector e depois no nó
de destino». Ele fazia exatamente isso, e não acontecia nada.

### A causa, medida em navegador de verdade

Tocar o conector fazia duas coisas: armava a ligação **e selecionava o nó**. Selecionar o nó abre o
**painel de inspeção** — 380 px à direita no computador, e uma gaveta que toma 70 % da altura em
janela estreita. Esse painel cobre justamente a área onde costuma estar o nó de destino.

Medido em Chromium, com o mesmo documento do dono, perguntando **quem está por baixo do dedo no
lugar do nó de destino**:

| Largura da janela | Antes | Depois |
|---|---|---|
| 1440 px · 1280 px | o nó (`no_botoes`) — ligava | o nó — liga |
| **1100 px · 1024 px** | **`DIV.rgfx-lateral`** — o painel. **Não ligava** | o nó — liga |
| 820 px (toque) | o nó — ligava | o nó — liga |
| **390 px (celular)** | **o nó estava fora do quadro.** Não ligava | alcançável pelo botão «Ver tudo» — liga |

Ou seja: em qualquer janela de computador **não maximizada** — que é como o dono usa, e foi a mesma
condição do defeito da v1.11.01 — a tela pedia para tocar num nó que ela mesma acabara de esconder.

E havia um segundo buraco: **arrastar do conector até o nó não fazia absolutamente nada**. Nem
ligava, nem armava, nem avisava. É o primeiro gesto que qualquer pessoa tenta, porque é o de todo
editor de fluxo.

### O que mudou

**Tocar o conector não seleciona mais o nó.** Uma linha a menos, e o painel deixou de aparecer no
meio do gesto. Para inspecionar o nó, toque o cabeçalho ou o corpo dele, como antes. E, enquanto uma
ligação está armada, o painel de inspeção não é desenhado: naquele momento o quadro é da ligação.

**Arrastar passou a ligar.** Puxe do conector de saída até o nó de destino: um fio pontilhado segue
o dedo e a ligação fecha ao soltar em cima do nó. Soltar no vazio **não joga o gesto fora** — a
ligação continua armada e a tela diz o que fazer.

**O nó inteiro é alvo.** Com uma ligação armada, tocar em qualquer parte do nó de destino fecha —
inclusive nos conectores dele, que antes re-armavam a ligação e faziam parecer erro de mira.

**«Ver tudo» na faixa da ligação.** Em tela estreita o nó de destino pode estar inteiramente fora do
quadro, e não existe toque num nó que não está desenhado. O botão reenquadra o fluxo **sem cancelar
a ligação** — quem move a vista é o operador, não a tela sozinha no meio do gesto.

**A faixa deixou de roubar o toque.** Ela desceu para o rodapé do quadro e ficou transparente ao
ponteiro (só os botões recebem toque): a tela não pode impedir o toque que ela própria está pedindo.

**Nada fica mudo.** Sem permissão para administrar fluxos, ou em fluxo sem rascunho no servidor, o
conector deixou de ser um botão desligado que não faz nada: o toque chega e a tela **diz o motivo**.
Ligar duas vezes a mesma saída continua recusado, com a frase que explica por quê.

### `GET /catalogo` — os conectores passaram a vir do motor

A tela desenhava os conectores por uma **cópia local** dos tipos de nó, e dizia isso numa faixa
amarela, porque a rota que devia informá-los não existia. A cópia já tinha envelhecido: o motor tem
**21 tipos** e ela conhecia 19 — faltavam o agente de IA e a cobrança por Pix. Saída que o editor não
desenha é **aresta indesenhável**: o motor resolve a saída, não acha destino, grava `ARESTA_AUSENTE`
e a conversa do cliente morre calada. Foi exatamente assim que `sem_janela` mordeu antes.

A rota agora existe e **tudo nela sai de `saidasDe()`** — a mesma função que o motor usa para andar
no fluxo. Ela não mantém uma segunda lista: separa em «fixas», «de exceção» e «de falha» subtraindo,
de modo que divergir é impossível. A faixa amarela some porque o problema acabou, não porque alguém
apagou o aviso — e ela continua lá, com texto novo, para o dia em que a rota não responder.

### O que ficou provado

- **`web/tests/ligacao.smoke.mjs`** — 15 medições da INTERAÇÃO (não da pintura): o toque arma, o
  painel **não** abre, o nó de destino fecha a ligação, a aresta é **gravada** no servidor e volta ao
  reabrir; o arraste liga; soltar no vazio explica; sem permissão a tela fala. **Conferido que ele
  falha** ao reintroduzir o defeito (a linha que selecionava o nó) — teste que só sabe passar não
  prova nada.
- **`web/tests/ligacao-navegador.mjs`** — 30 medições em **Chromium de verdade**, em seis larguras,
  sobre o pacote CONSTRUÍDO. É a única que enxerga geometria, e é a que pegou o defeito: com a
  correção desfeita, ela acusa 1100, 1024 e 390 px.
- **`tests/ragnabot-fluxo-catalogo.test.mjs`** — 9 medições da rota nova contra os executores de
  produção, incluindo a que garante que ela nunca divergirá de `saidasDe()`.

### O que continua desligado

Executor de fluxo, disparo do agendamento e carteiro de webhook de saída: **nada disparou** por
causa desta entrega. Nenhuma migração de banco — nenhum arquivo sob `app/prisma/`.

---

## v1.12.00 — Uma entrada só, e a caixa escolhida pelo nome (03/09/2026)

A frase que resume: **quem já está logado na plataforma de atendimento entra no painel sem digitar
nada — e o campo que pedia o número da conexão virou uma lista com o nome dela.**

### O que aconteceu

O dono abriu o painel e disse, com todas as letras: *«não entendi nada, por que tem outra
autenticação para acessar esse /painel… tá muito confuso»*. E, diante do formulário de criar fluxo:
*«seria melhor que esse campo já puxasse em menu lista as opções com o nome para não confundir»*.

As duas reclamações são a mesma coisa vista de dois lugares: o produto pedia à pessoa que soubesse
o que a máquina sabe — a senha que ela já tinha dado, e o número que identifica uma conexão.

### 1. Uma entrada só

A senha nunca foi outra: quem confere e-mail e senha é a própria plataforma de atendimento, e o
Ragnabot só recebe de volta quem é a pessoa. O incômodo era ter de **digitar duas vezes**.

A v1.11.00 tinha resolvido metade: depois de entrar aqui, as telas do painel de atendimento abrem
dentro da nossa casca **já logadas**. Faltava o sentido inverso — e era o que ele vivia: quem já
estava autenticado na plataforma, ao abrir o painel, levava a **nossa** tela de login.

Agora não. Se o navegador já traz a credencial da plataforma, o painel **a reconhece, confirma com
a plataforma de quem ela é, e emite a nossa sessão sozinho**. Formulário nenhum. Só vê a tela de
entrada quem realmente não tem sessão em lugar nenhum.

**Nada foi afrouxado, e isso importa mais do que a comodidade.** A credencial da plataforma fica num
cookie que o navegador deixa qualquer script ler — é assim por desenho do fornecedor, porque a
interface dele precisa lê-la. Quer dizer que **a presença dela não prova nada**: qualquer um a
escreve. Por isso o motor **pergunta à plataforma quem é o dono daquela credencial** antes de abrir
a porta. Se ela responder que a credencial não vale, a tela de entrada aparece como sempre apareceu.
A sessão emitida por este caminho tem a **mesma validade** (no máximo 8 horas), o **mesmo papel**
medido na plataforma, o **mesmo escopo de empresa** e a **mesma saída**.

### 2. A caixa de entrada, escolhida pelo nome

Ao criar um fluxo que começa numa conexão, o campo pedia `cwInboxId` — um número. Agora é uma
**lista**: *«WhatsApp Ragnatela · +55 98 3197-0997»*, *«Site - Ragnatela · ragnatela.com.br»*. O
campo só aparece quando o fluxo de fato começa por uma caixa; perguntar de qual conexão vem um
sub-fluxo é pergunta sem resposta.

Não é conforto. Errar um dígito ali **não dá erro**: grava, publica, e o fluxo simplesmente nunca
dispara — o robô fica mudo, dias depois e longe da causa. A mesma lista foi aplicada ao campo
«Conexão» do agendamento de mensagens, que tinha o mesmo problema.

Se o cadastro de caixas estiver vazio, a tela **diz o que fazer** («Sincronizar agora», em Caixas de
entrada) em vez de mostrar uma lista vazia. E se a consulta falhar, ela explica o motivo e deixa
seguir pelo número — porque **a recusa continua sendo do servidor**: o motor confere a caixa antes
de gravar, tanto pela tela quanto por quem chamar a API direto. A lista é conveniência; a guarda
não mudou de lugar.

### 3. O bastidor saiu da tela

O pé do menu explicava que *«os itens marcados com ● ainda são telas do painel de atendimento…
vamos substituindo uma a uma»*. Isso é anotação de obra: fala com quem constrói o produto, no lugar
onde está quem o usa. Saiu. **O ponto ao lado do item fica** — ele explica, sem parágrafo nenhum,
por que aquela tela se comporta um pouco diferente.

### O que ficou medido

Duas suítes novas, e as duas foram **conferidas quebrando o código de propósito** — teste que só
sabe passar não prova nada:

- `app/tests/ragnabot-sessao-adocao.test.mjs` (**19 medições**) sobe uma plataforma de mentira e
  mede a entrada por credencial existente. A medição central é **«cookie forjado não vira sessão»**:
  ao trocar a conferência por «acredite no cookie», ela ficou vermelha junto com outras seis
  (12 de 19), e voltou a 19 de 19 com o código restaurado.
- `app/web/tests/escolha-de-caixa.smoke.mjs` (**14 medições**) mede a lista: de onde ela vem, o que
  o rótulo mostra, e os quatro estados da tela.

Interface: **197 medições em 12 suítes, zero reprovações**. Motor: **26 suítes verdes**; as 7
restantes falham por falta de `DATABASE_URL` ou por serem de ponta a ponta — o mesmo conjunto do
lote anterior, não regressão.

### O que ficou de fora, e por quê

**O endereço único ainda não foi ligado.** Hoje `bot.ragnatela.com.br` entrega o painel do
fornecedor e o nosso vive em `/painel/`. A mudança é de quatro linhas no proxy compartilhado (a raiz
passa a desviar para o painel único, sem tocar em mais nada), foi medida e está escrita e comentada
em `app/deploy/nginx/bot-painel.conf` — **mas não foi aplicada**: escrever no proxy que serve ~20
domínios exige a mão do chefe. Enquanto isso, quem entra pelo painel do fornecedor e vai ao nosso
não digita senha de novo, que era o pior da confusão.

---

## v1.11.01 — O botão de criar fluxo voltou a existir em qualquer tela (03/09/2026)

A frase que resume: **uma linha de CSS apagava a ação principal de oito telas em qualquer janela
estreita. O botão nunca esteve quebrado — estava escondido. E agora, quando de fato não dá para
criar, a tela diz o motivo e o que fazer, em vez de ficar muda.**

### O que aconteceu

O dono abriu «Fluxos de conversa» e relatou: *«ainda não existe o botão de criar o fluxo»*. Ele
tinha razão no que via, e o problema não era nenhum dos suspeitos: a sessão estava válida, o motor
respondia que administrar fluxos estava liberado, e criar um fluxo pela API publicada funcionava de
ponta a ponta. O que apagava o botão era isto, na folha de estilo:

```css
@media (max-width: 900px) { .capa__acoes { display: none; } }
```

A capa de seção é a barra de título de **toda** tela do painel, e é nela que mora a ação principal
de cada uma. Abaixo de 900 px de largura — celular, tablet, ou simplesmente um navegador que não
está maximizado — essa linha apagava a única porta de entrada de **oito telas**: Fluxos, Conexões,
Empresas, Agendamentos, Respostas rápidas, Caixas de entrada, Atendimentos e Testador.

### O que mudou

**A capa cresce em vez de cortar.** Em telas estreitas ela deixou de ter altura fixa: o título fica
em cima, os botões logo abaixo, com quebra de linha. Altura automática sempre cabe no conteúdo — não
existe mais largura de tela em que um botão desapareça.

**Botão apagado agora fala.** Quando criar um fluxo realmente não é possível, a tela mostra o motivo
e o que fazer, no lugar do botão — e cada motivo tem a sua frase:

| Situação | O que a tela passa a dizer |
|---|---|
| A sessão venceu | «Sua sessão terminou — saia e entre de novo.» |
| Faltou a migração do motor no banco | «Não é problema da sua conta nem da sua permissão. Avise a Ragnatela.» |
| A sessão foi aberta sem empresa vinculada | «Saia e entre uma vez: a empresa é resolvida na entrada e fica dentro da sessão.» |
| Você entrou como atendente | «Criar e publicar é de quem administra a empresa.» |

**O estado vazio oferece o botão que o próprio texto manda apertar.** A tela sem nenhum fluxo dizia
«crie o primeiro» e não oferecia nada para clicar — a única porta era a da capa, justamente a que o
CSS apagava. Agora o botão está ali também, que é onde a pessoa está olhando no primeiro uso.

**Um diagnóstico errado foi corrigido.** O aviso de conta sem empresa afirmava que «o campo da
empresa ainda não viaja no token de sessão». Isso deixou de ser verdade na v1.11.00, quando a
entrada passou a resolver a empresa. Diagnóstico errado é pior que nenhum: mandava procurar defeito
no produto quando bastava sair e entrar.

### O que ficou medido

Teste novo (`web/tests/capa-acoes.smoke.mjs`, 6 medições) que lê o **CSS construído** — não o
arquivo-fonte — e reprova se alguém mandar esconder as ações da capa outra vez. Foi conferido que
ele falha de verdade quando o defeito é reintroduzido; um teste que só passa não prova nada.

E o caminho inteiro foi percorrido em produção pela porta pública: criar um fluxo, vê-lo na lista,
abrir o modo de teste e arquivá-lo depois. O ambiente ficou como estava — nenhum fluxo de mentira
foi deixado para trás.

---

## v1.11.00 — Um painel só (03/09/2026)

A frase que resume: **acabou o vaivém entre dois sistemas. O Ragnabot passou a ter um menu só, e as
telas que ainda são do fornecedor abrem dentro dele — sem pedir senha de novo.**

Até ontem o mesmo endereço servia **duas interfaces diferentes**: o painel de conversas em
`bot.ragnatela.com.br/` e o nosso em `/painel/`. Quem atendia trocava de aba o dia inteiro e entrava
duas vezes no mesmo produto. Esta versão junta as duas numa casca só.

### O que o cliente ganha

**Um menu, na ordem do dia a dia.** Atendimentos · Conversas · Contatos · Fluxos · Testador ·
Conexões · Caixas de entrada · Agendamentos · Respostas rápidas · Relatórios · Configurações — na
ordem que espelha o sistema que a empresa usa hoje, e não a ordem em que fomos construindo.

**As telas que ainda são do fornecedor abrem AQUI dentro.** Conversas, Contatos e Relatórios
continuam sendo as telas do painel de atendimento, mas agora aparecem dentro da nossa casca, com o
mesmo menu à esquerda. Cada uma tem um **ponto ao lado do nome no menu** dizendo, honestamente, de
quem é aquela tela — porque no dia em que uma delas se comportar diferente das nossas, a pessoa
precisa saber por quê, em vez de concluir que o Ragnabot quebrou.

**Entrar uma vez, valer para os dois lados.** A entrada no Ragnabot passou a entregar ao navegador
também a credencial da plataforma de atendimento — a mesma que ela entregaria se a pessoa tivesse
digitado a senha na tela dela. Resultado: as telas embutidas abrem **já logadas**. E **sair sai dos
dois lados**: o botão «Sair» apaga as duas sessões e ainda pede à plataforma que invalide o token.
Sem isso, a pessoa seguinte na mesma máquina abriria uma tela embutida dentro da conta de quem saiu.

### ⚠️ Quem já estava logado precisa sair e entrar uma vez

A credencial da plataforma só é entregue **na entrada**. Quem estiver com a aba aberta desde ontem
tem a nossa sessão, mas não a dela — as telas embutidas vão pedir login dentro do quadro. **Sair e
entrar uma vez resolve**, e é preciso fazer isso só uma vez.

### ⭐ A regra do SaaS, medida e não prometida

**Toda empresa tem o mesmo menu.** O que a conta que vende o serviço tem a mais é exatamente um
item: **Empresas**. Whitelabel e Planos não são itens de menu — são abas dentro de Configurações, e
quem as esconde é o servidor. Isso deixou de ser promessa de comentário e virou medição: o teste
compara os dois menus item por item e reprova se sobrar ou faltar qualquer coisa além de «Empresas».

### ⛔ O que NÃO foi feito, de propósito

- **Nada foi injetado no painel do fornecedor.** Nenhum script, nenhum estilo, nenhuma função dele
  substituída. O remendo por JavaScript já quebrou o painel duas vezes em 31/08. A casca **envolve**;
  ela não remenda. Por isso a barra lateral dele continua aparecendo dentro do quadro — esconder
  exigiria mexer no que é dele, e isso é proibido. O menu duplo é decisão do dono.
- **Nenhuma proteção do fornecedor foi afrouxada.** Ele responde `X-Frame-Options: SAMEORIGIN` e
  isso **permite** o quadro, porque a nossa casca mora no mesmo endereço (`bot.ragnatela.com.br`).
  Foi medido antes de escrever a primeira linha, não suposto.
- **A casca ganhou a proteção que faltava:** `/painel/` passou a responder
  `X-Frame-Options: SAMEORIGIN`. Antes, qualquer site de terceiro podia embutir o **nosso** painel
  numa moldura invisível e colher clique de quem estava logado.

### ⛔ Se um dia a casca mudar de endereço, tudo isto quebra junto

Mover a interface para um subdomínio próprio (`painel.ragnatela.com.br`) faz o `SAMEORIGIN` do
fornecedor **barrar** o quadro, e **todas** as telas embutidas somem de uma vez — em branco, sem
mensagem, porque o navegador barra em silêncio. É decisão de infraestrutura, e está escrita em três
lugares do código de propósito.

### ⛔ O que sobe DESLIGADO (e continua desligado)

- **Executor de fluxo** (`RAGNABOT_EXECUTOR_FLUXO=0`) — nenhuma conversa é conduzida por robô.
- **Disparo do agendamento** (`RAGNABOT_AGENDAMENTO=0`) — agendas são cadastradas, ninguém as envia.
- **Carteiro do webhook de saída** — a fila existe e é gravada; **nada sai** até alguém ligar.
- **Nenhum webhook cadastrado** na plataforma de atendimento.

### O que mudou por baixo

- **Zero mudança no banco.** Nenhuma tabela, nenhuma coluna, nenhuma migração — é a primeira versão
  do produto que entra no ar sem tocar no schema.
- **`src/base/plataforma-sessao.js`**, peça nova e isolada: sabe ler a credencial da resposta da
  plataforma e devolvê-la ao navegador no formato que a interface dela lê. Guarda **só as cinco
  chaves** que ela usa, e não a resposta inteira — cookie legível por JavaScript é o pior lugar do
  mundo para carregar cabeçalho que ninguém pediu.
- **`web/src/paginas/PainelDoFornecedor.jsx`**, uma tela genérica para todas as embutidas: o que
  muda entre elas é o item do catálogo, não o componente. Quando substituirmos uma pela nossa, some
  um campo do catálogo e o menu continua igual.
- **As rotas embutidas nascem do catálogo**, e não escritas uma a uma — não há como sobrar rota órfã
  apontando para um item que deixou de existir.

---

## v1.10.00 — Onde o cliente fala, e como o atendimento se comporta (02/09/2026)

A frase que resume: **duas telas que faltavam para o Ragnabot deixar de ser «o que a gente
configura por fora» — a lista das conexões e o painel de ajustes da empresa.**

Até aqui, saber por onde o cliente falava exigia abrir a plataforma de atendimento, e mudar o
comportamento do atendimento exigia pedir a alguém da Ragnatela. Esta versão traz as duas coisas
para dentro do painel, cada empresa vendo só o que é dela.

### O que o cliente ganha

**Conexões (`/painel/conexoes`).** Um cartão por conexão, dizendo em português: **qual canal**
(WhatsApp, Instagram, Facebook, site, e-mail, Telegram), **quem opera** aquele canal, **como está**
(conectada, com falha, sem notícia) e **quanto do plano já foi usado** — «3 de 5 conexões, 60%».
Dá para ver o registro do que saiu por cada conexão (com contagem por resultado e taxa de falha),
soltar o cache do canal sem chamar o suporte, e **transferir os atendimentos de uma conexão para
outra** quando um número morre — com opção de avisar o cliente na conversa.

**API própria da empresa.** A empresa emite a sua **credencial** (chave + segredo), escolhe o que
ela pode fazer, e o sistema dela consulta o Ragnabot sem passar por ninguém. Segredo aparece
**uma vez só**, na hora de criar; depois vira impressão digital. Dá para **regenerar** (o antigo
morre) e **revogar** com motivo registrado.

**Avisos para o sistema da empresa (webhook de saída).** Cadastrar um endereço para receber os
acontecimentos do atendimento, **assinados** (HMAC-SHA256) — quem recebe consegue provar que veio
de nós. Com fila, repetição com recuo crescente e **disjuntor**: destino que falha seguidas vezes
é pausado em vez de continuar sendo martelado.

**Configurações (`/painel/configuracoes`).** Dez painéis — Atendimento, Horários, Notificações,
Agenda, Aparência, Mensagens, Integrações, Inteligência artificial, Sistema e, **só para quem
opera o serviço**, Whitelabel. Cada ajuste é **por empresa**: o que você salva vale só na sua.
Ler é de todos; **alterar exige administrador**. Toda mudança vai para a auditoria com quem,
quando e o antes → depois.

### ⭐ A regra que essa versão trancou: cliente não vê o negócio dos outros

Por ordem do dono, **Whitelabel, Empresas e Planos são da conta que vende o serviço**. Isso deixou
de ser «o menu não mostra» e passou a ser **o servidor recusando**: uma conta de cliente que peça
esses painéis pelo endereço direto recebe **403**, não a lista. Quem visse essa lista veria plano,
valor, vencimento e e-mail de **todos os outros clientes**.

A decisão de quem é o operador não sai de nome nem de apelido — sai de uma **variável do ambiente**
(`RAGNABOT_TENANT_OPERADOR`), que o cliente não escreve. E, se ninguém declarar a variável, a
resposta é **negar**: falha fechada, de propósito. Permissão que erra para o lado aberto só aparece
no vazamento.

### ⚠️ Segredo entra e não volta

Senha do servidor de e-mail, chave de IA, segredo de credencial e segredo de webhook são guardados
**cifrados**. Depois de salvos ninguém os lê de volta — nem a tela, nem o suporte, nem o registro.
O que aparece é uma **impressão digital** curta: serve para conferir «é a chave que eu coloquei?»
sem que ela possa ser reconstruída.

### ⚠️ «Guardado, ainda sem efeito» — o aviso honesto na própria tela

Ajuste que ainda **não é lido por nenhuma parte do produto** aparece marcado assim, na cara. Hoje
quase todos estão nesse estado: o que existe é **o lugar de guardar** — auditado, isolado por
empresa e com a trança de escopo no banco. Ligar cada comportamento é a etapa seguinte de cada
assunto. Painel cheio de interruptor que não faz nada ensina a desconfiar de todos, inclusive dos
que funcionam.

### ⛔ O que sobe DESLIGADO (e continua desligado)

- **Executor de fluxo** (`RAGNABOT_EXECUTOR_FLUXO=0`) — nenhuma conversa é conduzida por robô.
- **Disparo do agendamento** (`RAGNABOT_AGENDAMENTO=0`) — agendas são cadastradas, ninguém as envia.
- **Carteiro do webhook de saída** — a fila existe e é gravada; **nada sai** até alguém ligar.
- **Nenhum webhook cadastrado** na plataforma de atendimento.

### O que mudou por baixo

- **5 tabelas novas** e **10 colunas novas** no banco do Ragnabot (46 → 51 tabelas, 185 → 206
  índices), aplicadas pelo caminho manual da casa — nunca `prisma db push`.
- **A trava de coerência de escopo** (`RagnabotConfiguracao_escopo_coerente`): o banco recusa uma
  linha cujo dono e cujo escopo não batam. É o que impede, para sempre, o ajuste de uma empresa
  ser lido como sendo de outra — e foi **provado no banco de produção**, em transação desfeita.
- **Camada de provedor:** o Ragnabot fala **direto** com a Meta (decisão registrada do dono: a
  mensagem do cliente não transita pela infraestrutura de outra empresa). A camada existe para que
  contratar outro caminho amanhã não exija reescrever nada — e o intermediário aparece no catálogo
  **marcado como contrário à decisão do dono**, em vez de escondido.
- **Assinatura HMAC** virou peça única (`src/base/assinatura.js`), servindo para **receber** (Efí) e
  para **assinar** (webhook de saída) — antes era código repetido em três pontos.

---

## v1.09.00 — A mensagem que sai na hora certa, sem ninguém acordar para mandar (02/09/2026)

A frase que resume: **até aqui o Ragnabot só sabia responder; agora ele sabe começar uma conversa —
na hora marcada, e uma vez só.**

Esta versão traz a tela **Agendamentos**: escrever hoje a mensagem que deve sair amanhã às 8h, ou
toda terça, ou todo dia 5 — para um contato ou para quinhentos.

### O que o cliente ganha

- **Marcar uma mensagem para sair depois.** Data, hora e **por qual conexão** ela sai (obrigatório:
  *nada sai sem canal*). Texto livre com as mesmas variáveis das respostas rápidas, e **anexo**
  (imagem, vídeo, áudio, documento) — com anexo, o texto vira a legenda.
- **Uma vez ou repetindo:** única, diária, semanal (escolhendo os dias) ou mensal, com «a cada N».
  Com fim por data (`até`) ou por teto de repetições.
- **Vários destinatários, até 500** por agendamento. O telefone é normalizado enquanto se digita —
  `(98) 98335-1000` e `5598983351000` são o mesmo contato —, e o repetido entra uma vez só.
- **Decidir se aquilo vira atendimento.** Marcado, a conversa fica **aberta** e vai para o setor
  escolhido. Desmarcado, ela é **resolvida** depois do envio — mas **só se fomos nós que a abrimos**:
  conversa que já estava com um atendente não é fechada por baixo dele.
- **Pausar, retomar e cancelar.** Retomar volta à grade **para a frente**: agenda que ficou três dias
  pausada não dispara três «bom dia» de uma vez. Cancelar **não apaga o passado** — o que já saiu
  fica no histórico.

### O horário é o do cliente, não o do servidor

Cada agendamento guarda o seu **fuso**. «Toda terça às 8h» é 8h no relógio de quem recebe — inclusive
no dia em que o horário de verão vira. A conta anda em **calendário** (dia + 1, semana + 1), não
somando 24 horas: a conta ingênua erraria **uma hora exatamente no dia em que o cliente mais
repara**. E o dia 31 + 1 mês vira 28/02 sem perder a âncora — em março ele volta para o 31.

### O histórico não esconde o que é incômodo

Cada disparo gera **uma linha por destinatário e por ocorrência** — dá para dizer «saiu para o João
às 08h02 e não saiu para a Maria, porque…». Além de *enviado* e *falhou*, existem três desfechos que
a maioria dos sistemas engole em silêncio e que aqui **aparecem escritos**:

- **Fora da janela** — passaram-se mais de 24 h desde a última mensagem do contato e a agenda não usa
  modelo aprovado. **Não saiu**, e não é defeito nosso: é regra da Meta.
- **Adiado** — não havia por onde sair (conexão desligada, caixa inativa). Fica com motivo e horário
  da nova tentativa, e é retentado com recuo, até seis vezes.
- **Em dúvida** — o processo caiu entre reservar e confirmar, ou a rede caiu no meio do envio.

**«Em dúvida» não se repete sozinho, e isso é a funcionalidade.** A mensagem **pode ter saído**;
reenviar por conta própria transformaria uma dúvida em duas mensagens iguais no WhatsApp de um
cliente. O item para ali, marcado, e **só uma pessoa** manda repetir — no botão **Reenviar**, que
aparece apenas em quem precisa de decisão humana. A tentativa antiga **fica no histórico**.

### A mesma mensagem nunca sai duas vezes — e a tranca é do banco

Cada par «destinatário × ocorrência» ganha uma chave única, e o envio começa **reservando** essa
chave. Quem reserva, manda; quem esbarra numa chave já reservada, **não manda**. Não é um cuidado do
programa: é o PostgreSQL recusando. Por isso vale com o sistema rodando em várias cópias ao mesmo
tempo, e sobrevive a reinício no meio do disparo.

É também por isso que **não existe botão «disparar agora»**: ele pularia a reserva, que é exatamente
o que segura a mensagem dobrada. Quem quiser antecipar, edita o horário.

### ⛔ O disparo sobe DESLIGADO — e é decisão, não pendência

O cadastro funciona por inteiro: a tela abre, as agendas nascem, são editadas, pausadas, canceladas —
e ficam **pendentes**. O que ainda não acontece é a saída da mensagem.

Todo o resto do Ragnabot **responde** a quem escreveu. Este é o primeiro pedaço que **começa**
conversa. Ligado sozinho num sistema recém-publicado, com agendas vencidas guardadas, ele dispararia
de uma vez tudo o que ficou para trás. Ligar é ato deliberado (`RAGNABOT_AGENDAMENTO=1`), e a
recomendação registrada é **estrear com uma agenda de teste, para um número da casa, com alguém do
outro lado**.

### Por baixo

- **Três tabelas novas** (a agenda, os destinatários, o resultado por envio) — 46 tabelas na base,
  aplicadas por SQL versionado, com **zero `DROP`**, no líder do banco medido na hora.
- **O Ragnabot aprendeu a abrir conversa.** Até esta versão, todo caminho partia de uma conversa que
  **já existia**. Agora ele procura o contato, reaproveita a conversa daquela conexão e só cria uma
  nova se não houver — senão, uma agenda semanal deixaria treze conversas abertas do mesmo assunto em
  três meses.
- **Provado:** 40 medições da parte pura (recorrência, fusos, virada do dia e do horário de verão,
  validação) e 37 contra PostgreSQL de verdade, com **duas cópias do sistema disputando a mesma
  ocorrência**, reinício no meio do disparo e a recusa do banco à chave repetida.

### Dois consertos de casa, achados nesta publicação

- **Dois verificadores do motor mentiam.** Depois de o Ragnabot ganhar banco próprio, eles
  continuaram apontados para a base antiga do NOC — onde as tabelas ficaram abandonadas e vazias. Um
  deles **respondia tudo verde** olhando a cópia morta; agora os dois **recusam** dizendo por quê.
  Verde falso é pior que vermelho: um vermelho manda investigar, um verde falso manda publicar.
- **Um teste estava vermelho desde que o construtor passou de 19 para 21 blocos** — e saiu vermelho
  na v1.08.00. Corrigido, e passou a comparar **a lista** em vez do número, para a próxima falha
  dizer *qual* bloco entrou ou sumiu.

---

## v1.08.00 — A fila passou a ter dono, e o construtor ganhou cinco peças (02/09/2026)

A frase que resume: **até aqui o Ragnabot sabia atender; agora ele sabe de quem é cada conversa.**
Esta versão traz a tela **Atendimentos** com isolamento de verdade — por atendente e por setor —, a
rotina que traz para dentro dela as conversas que já existiam, e cinco peças novas no construtor de
fluxo.

### A caixa de atendimento — quem vê qual conversa

- **Tela nova, «Atendimentos»**, com as abas **Abertas · Resolvidos · Grupos** e, dentro de Abertas,
  as sub-abas **Atendendo · Aguardando · ChatBot**, cada uma com o seu contador. Cada conversa é um
  cartão com **três etiquetas — caixa de entrada · setor · atendente**: olhando a fila já se sabe de
  quem é o quê, sem abrir nada.
- **A regra, dita em voz alta.** O administrador vê a operação inteira da empresa dele. O atendente
  vê **as conversas atribuídas a ele**, **as que ele mesmo resolveu** e a **fila sem atendente dos
  setores de que ele participa**. Ninguém vê nada de outra empresa.
- **Falha fechada, de propósito.** Atendente que não está em nenhum setor **não vê fila alguma** —
  só o que é dele. Sem saber a que equipe a pessoa pertence, mostrar a fila seria mostrar conversa
  de outro time. O administrador resolve no botão **«Sincronizar setores»**, que traz da plataforma
  os times e quem é membro de cada um.
- **O isolamento é do servidor, não da tela.** É uma cláusula da consulta, não um item de menu
  escondido. Atendente que pedir pela API a conversa de outro recebe **404** — «não encontrada», e
  não «proibido», porque um «proibido» confirmaria ao curioso que aquele número existe. Filtro
  mandado pela tela só **estreita** o que já era visível; nunca alarga.
- **Histórico por setor, e só por setor.** No cartão há «Histórico do setor»: os atendimentos
  anteriores daquele contato **naquele setor**. Não existe histórico global — nem para o
  administrador. O mesmo cliente pode falar com o Financeiro e com o Suporte sem que uma conversa
  entre dentro da outra.
- **Nenhum texto de mensagem sai do lugar.** As três tabelas novas guardam **só roteamento** — de
  quem é, de que setor, em que estado, quando. O conteúdo continua na plataforma, lido apenas ao
  abrir a conversa, depois de a permissão já ter sido conferida.

### Retrocarga — a fila não nasce vazia

A caixa se enche pelo aviso da plataforma. Conversa que começou **antes** de o aviso existir nunca
gerou aviso nenhum — então a tela nasceria vazia, sem explicação. O botão **«Trazer conversas
existentes»** vai buscá-las.

- **Cada dado vem do dono certo:** estado, contato, setor, atendente e datas vêm da plataforma; o
  **nome da caixa de entrada** e o **protocolo** vêm do nosso cadastro (a plataforma só manda o
  número); e o «está com o robô» vem da nossa execução de fluxo viva — a plataforma não distingue
  «robô atendendo» de «ninguém atendendo».
- **Pode rodar quantas vezes quiser** — a segunda passada não duplica nem altera linha nenhuma. E
  **não piora** o que o aviso já tinha gravado: quem resolveu e quando são informação do evento, e a
  retrocarga não os sobrescreve.
- **Tem modo de simulação** (`?simular=1`): mede e mostra o relatório **sem gravar nada**.
- **O que ela deduz, ela declara.** Numa conversa já resolvida, o instante da resolução é aproximado
  e o autor é deduzido do responsável atual. As aproximações saem **contadas no relatório, com o
  motivo escrito** — não escondidas.

### Cinco peças novas no construtor de fluxo

- **Passa para atendente.** Entrega a conversa a uma **pessoa**, e não a um setor — por e-mail, nome
  ou id. Havendo duas pessoas com o mesmo nome, a transferência é **recusada** em vez de sortear
  uma: mandar para a pessoa errada ninguém percebe. Há setor alternativo para quando a pessoa não
  for encontrada; sem ele a transferência falha de propósito, com incidente — melhor uma falha
  barulhenta que alguém conserta do que uma conversa sem dono que ninguém vê.
- **Randomizador (teste A/B).** Divide o tráfego por porcentagem, uma saída por faixa, e as
  porcentagens têm de somar exatamente 100 % — o editor não «normaliza» número errado em silêncio.
  O sorteio é **reprodutível**, e você escolhe o que se repete: por visita, por conversa ou **por
  contato** (recomendado — é o único que faz um teste A/B honesto; do contrário a comparação mede a
  alternância, e não a variante).
- **Guarda contra laço de sub-fluxo.** Fluxo que chama a si mesmo — direta ou indiretamente — passou
  a ser **recusado na publicação**, com o caminho do laço escrito por extenso («Atendimento → Menu →
  Atendimento»). Antes disso o laço só aparecia em produção, como conversa andando em círculo até
  bater no teto de passos — depois de gastar mensagens com um cliente de verdade. A mesma guarda
  vale ao **reverter** uma versão antiga. Desenhar o laço no rascunho continua permitido: o rascunho
  é privado; publicar é o instante em que o desenho passa a atender gente.
- **Os números em cada saída do bloco.** Cada conector do canvas mostra «enviado · clicado · CTR».
  **Exceção não conta como clique**: «sem resposta», «opção inválida», «erro» e «fora da janela de
  24 h» aparecem com o número, mas fora do CTR — contá-las inflaria justamente os menus que estão
  dando errado, que são os que precisam aparecer mal. Bloco que não foi apresentado no período
  mostra **traço, e não «0 %»**: «0 %» diria que ninguém clicou num menu que ninguém viu.
- **«Forçar caminho» no testador.** Campo novo (`bloco=saida`, uma por linha) para conferir a
  variante que o sorteio não tomou. O testador avisa, no próprio passo, que o caminho foi desviado
  por você.

### Onde os números moram

Três tabelas novas — `RagnabotSetor`, `RagnabotAgenteSetor` e `RagnabotConversa` — aplicadas no
**líder do banco medido na hora** (`pg133`, e não o de ontem), em transação única, com **zero
`DROP`** no arquivo e as três chaves estrangeiras compostas conferidas depois, de pé. O SQL está
versionado em `app/prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql`.

### ⛔ O que continua desligado, de propósito

`RAGNABOT_EXECUTOR_FLUXO=0` e **zero webhooks cadastrados** na plataforma. Ou seja: **nada muda
para quem conversa com a gente hoje.** A caixa mostra a operação; o robô ainda não responde
sozinho. Ligar é um passo separado e deliberado, com o dono avisado — e a recomendação registrada é
fazer isso primeiro numa caixa de teste, com ele do outro lado.

---

## v1.07.01 — A rota até a plataforma passou a ser uma só (02/09/2026)

Correção apanhada **na própria subida da v1.07.00**, pelo `/saude` novo — antes de qualquer pessoa
usar o painel.

- **O que estava errado.** A regra de "por onde o motor fala com a plataforma" existia em **dois
  lugares**: a nova (com o caminho interno do cluster) e uma antiga, que só sabia sair para a
  internet. A sincronização das caixas usava a antiga — e, de dentro do cluster, sair para a
  internet e voltar não funciona. Resultado: a rotina rodava, esperava 20 segundos e desistia, com
  o cadastro de caixas em zero.
- **O que mudou.** A regra passou a ter **um dono só**, e há um teste permanente que prende a ordem
  dos caminhos. As mensagens de erro passaram a dizer **por onde** tentaram — sem isso, "não
  consegui falar com a plataforma" obriga quem diagnostica a adivinhar entre três rotas.
- **Como se viu.** O `/saude` da v1.07.00 já dizia `cadastroDeCaixas.ultimoErro` e
  `caixasNaPlataforma: 0`. Foi ele que denunciou, em vez de a falha aparecer semanas depois como
  "o robô não responde direito".

---

## v1.07.00 — A porta abriu: o painel do Ragnabot é alcançável por navegador (02/09/2026)

A frase que resume: **o que estava pronto deixou de ser invisível.** Desde 28/08 o construtor de
fluxo, o testador, as respostas rápidas e a tela de caixas existiam e funcionavam — e ninguém
conseguia abri-los, porque a interface era servida numa porta de serviço fechada por endereço de
origem. A partir desta versão o endereço é **https://bot.ragnatela.com.br/painel/**, e quem entra
usa a conta que já tem na plataforma.

### O que muda para quem usa

- **O painel do Ragnabot abre no navegador**, em `bot.ragnatela.com.br/painel/`. Mesmo domínio de
  sempre — sem endereço novo para decorar, sem certificado novo para vencer no fim de semana.
- **A entrada é a mesma conta de sempre.** Nenhuma senha nova e nenhuma trava foi afrouxada para
  publicar: continua sendo a tela de login do próprio motor, com a conta da plataforma.
- **O login passou a funcionar de verdade.** Ele estava quebrado e ninguém sabia, porque ninguém
  alcançava a tela: de dentro do cluster, o motor tentava falar com a plataforma pelo endereço
  público e o pedido morria no tempo limite. Agora ele fala pelo caminho interno.
- **As quatro caixas de entrada apareceram no cadastro.** A plataforma tinha quatro conexões (Site,
  WhatsApp, Facebook e Instagram) e o cadastro do Ragnabot estava **vazio** — a reconciliação
  existia desde 28/08 e nunca havia sido chamada por ninguém. Agora ela roda sozinha ao subir e a
  cada 15 minutos, e há uma tela para conferir o resultado.
- **Uma caixa que não existe deixou de ser aceita num fluxo.** Digitar o número errado ao amarrar um
  fluxo gravava, publicava e o fluxo simplesmente nunca disparava — sem nenhuma reclamação.
- **O endereço da empresa na plataforma passou a ser conferido.** Havia o id de uma **caixa** no
  campo da **conta**; nesse estado, todo evento do robô seria descartado como "empresa não mapeada".

### O que passou a existir por dentro

- **`/painel/` é uma porta própria**, separada do painel de atendimento: nela não entram o tema, a
  tela de carregamento nem o desafio "não sou robô" do produto de atendimento — cada uma dessas
  peças serve à outra tela e atrapalharia esta.
- **`/motor-api/` continua restrita** ao console de operação. Publicar a interface não abriu a porta
  de serviço; são duas portas, com duas travas diferentes, de propósito.
- **A credencial que faltava entrou no cofre.** O motor rodava sem o token da plataforma, e por isso
  toda leitura falhava em silêncio. Havia um "plano B" que lia uma tabela de configurações —
  **código morto**, porque essa tabela ficou no NOC. Foi removido: plano B que não pode funcionar
  esconde a causa em vez de cobrir a falha.
- **O `/saude` ficou mais honesto.** Passou a dizer se o token está configurado (sim/não, nunca o
  valor), quando a última reconciliação de caixas rodou e **para qual caminho a tela foi
  construída** — este último resolve de véspera a única armadilha séria desta publicação.

### Depende de / ainda não está pronto

- ⛔ **O executor de fluxo continua DESLIGADO**, e **nenhum webhook está cadastrado** na plataforma.
  Ou seja: esta publicação **não muda nada** para quem conversa com a gente hoje. Ligar o motor é um
  passo separado, deliberado e com aviso.
- **Nenhum fluxo cadastrado ainda.** O painel abre no construtor, e ele está vazio — é exatamente o
  que esta versão existe para destravar.
- **Sem caixa de WhatsApp própria.** Muita coisa "por caixa" só se prova de verdade quando a
  primeira existir.

---

## v1.06.00 — O Ragnabot ganhou casa: menu, telas e o caminho do primeiro "oi" (02/09/2026)

Esta versão junta o trabalho de um dia inteiro. A frase que resume: **o produto passou a ter uma
casa por onde se anda** — menu, telas próprias e um testador — e o caminho que leva a mensagem do
cliente até o robô ficou **inteiro pela primeira vez**, ainda que **desligado de propósito** nesta
subida.

### O que você vê e pode usar hoje

- **Menu e navegação.** Até aqui a interface do Ragnabot era **uma página só**: o construtor de
  fluxo existia desde 28/08 e ninguém chegava nele, porque não havia caminho. Agora há menu lateral
  (com o modo recolhido), cabeçalho com a empresa, a versão e o botão de sair, e endereços de
  verdade — dá para abrir em nova aba, copiar o endereço e usar o botão "voltar" do navegador.
- **Tela de respostas rápidas.** O recurso já funcionava desde 29/08 e **não tinha tela nenhuma**.
  Agora dá para cadastrar, buscar, editar e apagar atalho pela interface, escolhendo entre
  **"Só eu"** e **"Todos"**, e restringindo a uma caixa ou a um time.
- **Testador de fluxo** — o item mais pedido do plano. Conversa com o fluxo **antes** de qualquer
  cliente conversar com ele: você digita, vê o que o cliente veria, e vê **em separado** o que
  acontece nos bastidores (etiqueta, carimbo, nota interna, resolução). Nada é enviado, nada é
  gravado, nenhum terceiro é chamado — e há um teste permanente que prende essa promessa.

### O que passou a existir por dentro (e ainda não está ligado)

- **O caminho do primeiro "oi" ficou inteiro.** `plataforma → webhook → portaria → fila → motor →
  canal → cliente`. Faltavam três elos e os três nasceram aqui: o **adaptador de canal** (quem
  transforma a intenção do fluxo em mensagem de verdade), a **fila do motor com seu executor**
  (quem tira o trabalho da fila e faz a conversa andar) e a **ligação do webhook com a portaria**
  (a mensagem do cliente finalmente chega ao motor).
- ⚠️ **O executor sobe DESLIGADO nesta versão, por decisão.** O Ragnabot já tem conversa real de
  gente. Ligar o motor para processar mensagem de cliente sem alguém olhando é risco que não se
  corre num dia de publicação. O código está no ar; ligar é um segundo passo, deliberado.
- **Capitão (o agente de IA)** — a camada da casa sobre o agente nativo da plataforma: quem está
  ligado, com que documentos, com que marca e quanto já gastou. **Nasce desligado** e sem nenhuma
  chave configurada. Nenhum texto de cliente é guardado nessas tabelas: a pergunta vira impressão
  digital e a resposta vira contagem de caracteres.
- **Cobrança por Pix (Efí)** — o caminho técnico existe, **sem nenhuma credencial**, e por padrão
  ele **recusa**. Enquanto o dono não decidir a conta e o certificado, nada é cobrado por aqui.

### As duas correções silenciosas que evitam dor

- **Encerramento gracioso de verdade.** Ao reiniciar, o processo agora espera os passos em voo,
  devolve o trabalho para a fila e solta as posses. Antes, um desligamento no meio deixava conversas
  paradas por até 90 segundos — e, numa implantação, isso acontecia toda vez.
- **O aviso "ainda está aí?" tinha estado, mas não tinha voz.** O consumidor mudava a conversa de
  estado e o texto não saía, por falta do adaptador de canal. Agora sai.

### Depende de / ainda não está pronto

- **A interface não é alcançável por navegador de usuário.** Ela é servida em
  `bot.ragnatela.com.br/motor-api/`, que é a **porta de serviço** — o proxy só deixa passar o console
  de operação. Publicar num caminho de gente é decisão do chefe (a escolha registrada é
  `bot.ragnatela.com.br/painel/`).
- **A plataforma ainda não avisa o motor.** Medido no dia da publicação: **nenhum webhook cadastrado**
  na conta do Chatwoot. Enquanto ele não for cadastrado, a portaria não recebe mensagem nenhuma.
- **Nenhuma automação está configurada** (zero políticas de atendimento, zero fluxos publicados). É
  por isso que esta subida **não muda nada** para quem conversa com a gente hoje.
- **Capitão, Pix e agente de IA não têm tela** — e as tabelas deles **ainda não foram criadas no
  banco**. Só a migração da fila (`motor-fluxo/05`) foi aplicada nesta publicação.

---

## v1.05.00 — Casa própria de verdade (30/08/2026)

O Ragnabot deixou de depender do NOC para **qualquer coisa** de atendimento e administração.

- **Interface própria.** A tela do editor de fluxo é servida pelo próprio Ragnabot, não mais pelo
  NOC. Junto veio uma **tela de cadastro de empresas**, que nunca existiu — até agora só dava para
  cadastrar empresa por chamada de programação, o que na prática queria dizer "só o Claude cadastra".
- **Login próprio.** Você entra com a **sua conta da plataforma** — nada de senha nova. E a trava
  que importa: o papel de quem entra vem **assinado pelo servidor**, nunca do que o navegador diz.
  Sem isso, qualquer um se declararia super usuário e passaria pelas travas de cobrança e de criação
  de empresa.
- **Segundo fator próprio**, usando o e-mail que a plataforma já conhece.
- **E-mail próprio.** A configuração de envio vinha de uma tabela **do NOC** — uma dependência que
  nenhuma linha de código denunciava. Agora é do Ragnabot.
- **Permissão por grupo removida** — era conceito do NOC. Aqui o que separa é a empresa.

### Depende de
- O código do segundo fator vive na memória da réplica que o emitiu: com duas réplicas, parte das
  confirmações pede um segundo envio. A falha é fechada (nunca aprova o que não emitiu).
- Continua sem caixa de WhatsApp: nada foi exercitado com conversa real.

---


## v1.04.00 — A tela do fluxo saiu do NOC e ganhou login próprio (30/08/2026)

O editor de fluxo passou a ser servido pelo **próprio motor do Ragnabot** — e, com ele, veio a
**entrada de sessão**: quem abre a tela agora **entra com a conta dele da plataforma de
atendimento**. Não há senha nova para decorar e não há identidade emprestada do NOC.

- **Entrar com a conta da plataforma.** E-mail e senha são conferidos pelo Chatwoot, não por nós.
  Quem tem verificação em duas etapas informa o código de 6 dígitos (ou um código de recuperação).
- **O papel vem de quem confere, não de quem pede.** Administrador da conta entra como
  administrador; atendente entra como atendente. O papel viaja **dentro de um cookie assinado**,
  que o navegador não consegue reescrever.
- **Sessão curta e trancada.** Cookie `HttpOnly` (script da página não o lê), `SameSite=Strict`,
  `Secure`, validade máxima de **8 horas**. Sair encerra na hora.
- **A auditoria voltou a registrar QUEM.** Antes o plano era registrar um "operador" genérico para
  todo mundo; agora entra o nome e o identificador de quem realmente entrou.
- **Freio de tentativas** por IP + e-mail, além do que a própria plataforma já tem.

### O defeito que esta versão fecha
No desenho anterior, para servir a tela o motor teria de **entregar ao navegador o token de serviço**
(a credencial que o NOC usa para falar com o Ragnabot) e o papel do operador viajaria num
**cabeçalho que o próprio cliente escolhe**. Na prática: quem alcançasse a página recebia a
credencial, e bastava declarar-se `super` para passar pelo que tranca **cobrança e criação de
empresa**. A tela nunca chegou a ir ao ar assim — o defeito foi apontado antes de ligar, e esta
versão o fecha. Há um teste dedicado só para impedir que ele volte.

### Depende de
- **Uma conta real da plataforma para a primeira entrada de verdade.** Todo o mecanismo está
  testado (13 verificações automáticas), mas a conversa com o Chatwoot só se prova com uma conta
  existente — e o cadastro real ainda não foi exercitado por ninguém.
- **O endereço interno da plataforma** (`RAGNABOT_PLATAFORMA_INTERNA`): pelo endereço público, a
  entrada passa pelo guarda do "não sou robô", que um servidor não resolve.
- **Super usuário continua sendo só do NOC.** Administrador de empresa é dono da empresa dele, não
  do SaaS: cobrança e criação de empresa seguem trancadas para a tela.

---

## v1.03.00 — Lista com seções, botão de link e e-mail no fluxo (29/08/2026)

Os blocos do montador de fluxo passaram a ter o que o bot atual tem — desenhado a partir da leitura
dos **35 fluxos dele em produção**, não de suposição.

- **Menu lista com seções e cabeçalho.** Itens agrupados sob títulos, com cabeçalho em negrito.
- **Botão de link**, ao lado dos botões de resposta.
- **A mistura é impedida na origem:** no WhatsApp, botão de resposta e botão de link não convivem na
  mesma mensagem — a Meta recusa tudo. A tela oferece a escolha no nível do bloco em vez de deixar
  errar e reclamar depois; o motor recusa nos dois pontos (validação e execução).
- **O botão de link não espera resposta.** A Meta não avisa o clique; se o fluxo esperasse, a
  conversa travaria e a pessoa seria transferida para um humano por ter feito o que o botão pediu.
- **Bloco de e-mail** — destinatário, assunto, corpo, responder-para e cópia oculta, com variáveis.
  O cabeçalho remove quebras de linha (impede acrescentar destinatários ocultos por texto digitado)
  e o corpo escapa HTML. "Responder para" e "cópia oculta" agora chegam ao envio de verdade.

### Depende de
- Nenhuma caixa de WhatsApp existe: nada disso foi visto chegando num aparelho. Os limites de
  tamanho vêm da documentação da Meta, não de observação.
- O adaptador que entrega as mensagens ao canal ainda não existe no repositório — quando nascer,
  precisa conhecer os campos novos.

---

## v1.02.00 — O chatbot atende, o relógio fala, e quatro defeitos a menos (29/08/2026)

Quatro automações novas — e uma auditoria que encontrou quatro defeitos reais no que já rodava.

### O que passou a existir
- **A portaria do primeiro "oi".** O motor de conversa estava pronto e ninguém o acionava quando a
  mensagem chegava. Agora a conversa é encaminhada para o fluxo, para a fila humana ou recebe só um
  aviso — e quem já está no meio de um menu **não é interrompido** por uma mensagem de expediente.
- **O aviso "ainda está aí?" sai de verdade**, pelo caminho que respeita a **janela de 24 h** do
  WhatsApp. Fora dela, a conversa muda de estado do mesmo jeito e o motivo fica na nota interna.
- **Respostas rápidas** — atalho vira texto pronto, com nome do cliente e número do chamado
  preenchidos. Atalho repetido é recusado pelo banco; uma empresa nunca vê a resposta da outra.
- **Turno por atendente** — opcional. Quem não cadastrar herda o horário da empresa; o plantão
  noturno sobrevive ao horário comercial; feriado derruba todos, dizendo que foi o calendário.

### Quatro defeitos corrigidos (auditoria adversarial: 25 examinados, 4 confirmados)
Cada um foi verificado por três céticos independentes, cuja tarefa era **derrubar** o achado.

1. Um **carimbo** de "já avisei hoje que estamos fechados" podia ser reaberto por uma rotina de
   manutenção e virar **relógio de inatividade vencido**, devolvendo a conversa à fila (ou
   resolvendo-a) sem prazo nenhum ter corrido. Bastava o processo reiniciar na hora errada.
2. **Transbordo disparando na hora:** re-armado com o minuto da inatividade, que é nulo quando a
   inatividade está desligada — e zero minuto significa "agora".
3. **Conversa em espera sumia da varredura para sempre** — a leitura só trazia conversas "abertas",
   mas é para "aguardando" que o relógio devolve.
4. **Mensagem dupla ao cliente**, por dois caminhos, sendo que um não conferia a janela de 24 h.

### Depende de
- Ainda **não existe caixa de WhatsApp** criada: tudo acima é correto por construção e por teste,
  não por observação em atendimento real.
- A tela das respostas rápidas (sugerir ao digitar `/`) e a tela de cadastro de turno são frontend.
- O turno ainda não é consultado pela distribuição — o serviço responde, falta quem pergunte.

---

## v1.01.00 — Publicação de fluxo (29/08/2026)

O editor de fluxo volta a **publicar**. Antes, publicar/validar/reverter respondiam erro 503 porque
o serviço não existia; agora existe, testado contra o banco.

- **Publicar** congela o rascunho numa **versão imutável**, valida a estrutura do grafo (nó inicial,
  arestas ligadas, sem nó órfão) e reaponta o fluxo — tudo numa transação.
- **Arrastar um bloco na tela NÃO cria versão nova** e nunca deixa órfã quem está no meio da
  conversa — a assinatura de estrutura ignora as coordenadas do editor. Mudar uma ligação ou um tipo
  de nó, sim.
- **Reverter copia para a frente** (cria uma versão nova com o conteúdo antigo), mantendo a linha do
  tempo contínua para a medição de eficácia.

### Depende de
- O **resolvedor de entrada** (fluxo do primeiro "oi") ainda não amarra o motor — próximo item (A1).
- Sem caixa de WhatsApp real, o retrofit de conversa viva foi provado com execução semeada, não sob
  tráfego.

---

## v1.00.00 — A fundação (29/08/2026)

Primeira versão marcada. Reúne tudo que já está no ar e sustentado por teste, para servir de
**marco zero** — daqui para frente cada novidade entra como uma versão nova.

### Infraestrutura — a plataforma sobrevive à morte de uma máquina

- **Kubernetes de 3 nós, 1 por hipervisor.** Perder um hipervisor inteiro tira um nó só, e a
  plataforma continua de pé.
- **Banco com troca automática de líder (Patroni + etcd, 3 votos).** O primário morre e o outro
  assume sozinho, sem ninguém promover à mão. Provado matando a máquina primária.
- **Fila com troca automática de mestre (Redis Sentinel, quórum 2 de 3).**
- **Armazenamento de anexos próprio (MinIO, 6 discos em 3 hipervisores).** Um hipervisor pode cair
  e a plataforma continua **gravando** anexo.
- **Backup do banco em bucket imutável** (Object Lock), que descobre o líder sozinho a cada rodada —
  imune a troca de primário.

### Atendimento — as automações que o dono sentia falta

- **Relógio de inatividade** com escolha do lado que conta o silêncio (contato, atendente ou
  qualquer um) — a conversa parada volta sozinha para a fila.
- **Expediente com intervalo de almoço** (várias janelas por dia) e **feriado** (data avulsa e
  recorrente) — coisas que o chat anterior não fazia.
- **Fora de expediente o relógio congela** — ninguém recebe "ainda está aí?" de madrugada.
- **Transferência entre atendentes e times** que tira o atendente anterior junto.
- **Trabalhador rodando a cada 60s**, à prova de reinício (não duplica ação).

### Plataforma SaaS — multiempresa

- **Planos, assinaturas e cobrança.**
- **Protocolo de atendimento** por empresa (`RGT-0000000001`), à prova de corrida.
- **Auditoria por usuário** com isolamento entre empresas à prova de vazamento.
- **E-mail funcionando** (convites, canal de suporte).

### Motor de fluxo de conversa — nativo

- **20 tabelas, motor próprio** (sem depender de Typebot/n8n). Recusa editar versão publicada,
  recusa duas execuções na mesma conversa, retoma sozinho se o processo morre no meio.
- **Editor de fluxo** (tela de arrastar blocos).

### O que esta versão AINDA não entrega (declarado)

- **Zero caixas de WhatsApp criadas** — nada foi exercitado com conversa real.
- **Canais Facebook e Instagram** ainda não ligados (são nativos, falta ligar).
- **Publicação de fluxo** e o **elo de entrada do primeiro "oi"** faltam.
- **Ação "notificar" do relógio** só enfileira; falta quem consuma a fila.

> Referência completa da fundação: `deploy/LEIA-ME.md` (infraestrutura) e
> `docs/30-INFRAESTRUTURA-RAGNABOT.md`. Levantamento do que falta implementar do chat atual:
> `docs/31-FUNCIONALIDADES-A-IMPLEMENTAR.md` e o plano em `docs/32-PLANO-DE-EXECUCAO.md`.

<!-- MODELO PARA A PRÓXIMA VERSÃO (copie e preencha no topo, acima deste comentário):

## vX.YY.ZZ — <título curto> (DD/MM/AAAA)

<uma linha do que mudou e por quê>

- **<funcionalidade>** — <o que passou a existir, na visão de quem usa>.
- ...

### Depende de
- <o que falta / o que espera do dono>
-->
