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
