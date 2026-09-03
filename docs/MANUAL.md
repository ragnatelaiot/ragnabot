# 📖 Manual do Ragnabot — como cada função funciona

> **Manual vivo.** Cresce a cada versão. Para cada função, três perguntas: **o que faz**, **como o
> operador usa**, **como funciona por dentro** (o suficiente para operar e diagnosticar, sem virar
> código). Quando uma versão nova entra em `VERSOES.md`, a função correspondente entra ou muda aqui —
> os dois arquivos andam juntos.
>
> Estado coberto: **v1.11.00**. O que ainda não existe está marcado _(planejado)_ e aponta o item
> do `docs/32-PLANO-DE-EXECUCAO.md`.

---

## Sumário
0. [Como abrir o Ragnabot (o endereço do painel)](#0-como-abrir-o-ragnabot-o-endereço-do-painel)
0-A. [Por onde se anda no Ragnabot (menu e telas)](#0-a-por-onde-se-anda-no-ragnabot-menu-e-telas)
1. [Conexões e automações](#1-conexões-e-automações)
1-A. [Caixas de entrada — o cadastro que o robô consulta](#1-a-caixas-de-entrada--o-cadastro-que-o-robô-consulta)
1-B. [A caixa de atendimento — quem vê qual conversa](#1-b-a-caixa-de-atendimento--quem-vê-qual-conversa)
1-C. [Retrocarga — trazer para a caixa as conversas que já existiam](#1-c-retrocarga--trazer-para-a-caixa-as-conversas-que-já-existiam)
1-D. [Agendamento de mensagens — marcar para sair na hora certa](#1-d-agendamento-de-mensagens--marcar-uma-mensagem-para-sair-na-hora-certa)
2. [Relógios de atendimento](#2-relógios-de-atendimento)
3. [Expediente, intervalo e feriado](#3-expediente-intervalo-e-feriado)
4. [Transferência](#4-transferência)
5. [Fluxo de conversa (chatbot)](#5-fluxo-de-conversa-chatbot)
5-F. [Testador de fluxo](#5-f-testador-de-fluxo)
5-G. [A tela das respostas rápidas](#5-g-a-tela-das-respostas-rápidas)
5-H. [O caminho do primeiro "oi"](#5-h-o-caminho-do-primeiro-oi--inteiro-e-por-que-ele-está-desligado)
5-I. [Ainda não ligado: Capitão e Pix](#5-i-ainda-não-ligado-capitão-agente-de-ia-e-cobrança-por-pix)
5-J. [Os números em cada saída do fluxo](#5-j-os-números-em-cada-saída-do-fluxo)
6. [Multiempresa, planos e cobrança](#6-multiempresa-planos-e-cobrança)
6-A. [Conexões: por onde o cliente fala](#6-a-conexões-por-onde-o-cliente-fala)
6-B. [API própria da empresa e avisos para o sistema dela](#6-b-api-própria-da-empresa-e-avisos-para-o-sistema-dela)
6-C. [Configurações: como o atendimento se comporta](#6-c-configurações-como-o-atendimento-se-comporta)
7. [Protocolo e auditoria](#7-protocolo-e-auditoria)
7-A. [Entrar no Ragnabot (login da tela)](#7-a-entrar-no-ragnabot-login-da-tela)
8. [Infraestrutura (o que sustenta tudo)](#8-infraestrutura)
9. [Backup e recuperação](#9-backup-e-recuperação)

---

## 0. Como abrir o Ragnabot (o endereço do painel)

**O que faz.** Dá o caminho para a tela onde se constrói o atendimento automático.

**Como o operador usa.** Abre no navegador, e é **este o único endereço que a equipe precisa saber**:

```
https://bot.ragnatela.com.br/painel/
```

Pede e-mail e senha — **a mesma conta da plataforma de atendimento**, sem senha nova (§7-A). Depois
de entrar, cai direto na fila de **Atendimentos**, com o menu completo à esquerda.

### ⭐ Desde a v1.11.00 o painel é UM SÓ

Até a v1.10.00 havia **duas interfaces** no mesmo domínio, e a equipe trocava de aba o dia inteiro.
Agora não: **Conversas, Contatos e Relatórios abrem dentro desta mesma casca**, com este mesmo menu
ao lado. Elas continuam sendo **telas do painel de atendimento** (do fornecedor) — a diferença é que
não se sai mais daqui para chegar nelas, e elas **não pedem senha outra vez**.

No menu, essas telas vêm com um **ponto ao lado do nome**. O ponto quer dizer: *«esta tela ainda é do
painel de atendimento»*. Serve para você saber de quem é a tela quando ela se comportar diferente
das nossas (um atalho de teclado, o botão de voltar). Conforme substituirmos cada uma pela nossa
versão, o ponto some sozinho — e nada mais muda: mesmo lugar no menu, mesmo nome, mesmo endereço.

⚠️ **Dentro do quadro aparece também a barra lateral do fornecedor**, e por isso você vê dois menus.
É de propósito: escondê-la exigiria mexer por dentro do painel dele, o que é **proibido** pela regra
da casa (o remendo por JavaScript já quebrou aquele painel duas vezes, em 31/08/2026). Preferimos o
menu duplo a um painel quebrado.

### ⚠️ Quem já estava logado precisa SAIR e ENTRAR uma vez

A credencial da plataforma de atendimento é entregue ao navegador **no momento da entrada**. Quem
estava com a aba aberta desde antes desta versão tem a nossa sessão, mas não a dela: ao abrir
Conversas, Contatos ou Relatórios, vai ver a **tela de login do fornecedor dentro do quadro**.

**Sair e entrar de novo resolve**, e só é preciso fazer isso **uma vez**. A própria tela avisa,
quando isso acontece, em vez de deixar você adivinhar.

⚠️ **O que ainda existe em separado.** O mesmo domínio continua servindo três coisas:

| Endereço | O que é | Para quem |
|---|---|---|
| `bot.ragnatela.com.br/painel/` | **o Ragnabot** — o painel único, com tudo dentro | toda a equipe |
| `bot.ragnatela.com.br/` | painel de conversas do fornecedor, **acessado direto** | segue funcionando, intacto, para quem preferir |
| `bot.ragnatela.com.br/motor-api/` | porta de **serviço** do console de operação (NOC) | ninguém, pelo navegador |

A segunda linha **não foi tocada**: o painel do fornecedor continua exatamente como estava, e quem
tem o hábito de abri-lo direto pode continuar. A terceira é fechada por endereço de origem no proxy:
só o NOC passa. **Publicar o painel não abriu essa porta** — são entradas diferentes, com travas
diferentes, de propósito.

**Como funciona por dentro (e a armadilha que isto evita).** O caminho `/painel/` é *declarado na
construção do pacote*, não configurado no proxy. Motivo: a tela pede os arquivos dela por caminho
absoluto, e um pacote construído para a raiz publicado em `/painel/` pediria `/assets/…` — que no
mesmo domínio é o **painel de atendimento**, não o motor. O resultado seria **tela branca com 200 na
rede**: o pior sintoma possível, porque tudo parece ter dado certo. Por isso o `/saude` do motor
passou a dizer, em `interface.prefixo`, para qual caminho o pacote foi construído — confira ali
antes de acreditar que uma publicação deu certo.

**Se a tela não abrir.**

| Sintoma | Onde olhar |
|---|---|
| abre o painel de conversas em vez do Ragnabot | faltou a barra final: use `/painel/` |
| tela branca | `GET /saude` → `interface.prefixo` tem de ser `/painel/` |
| "não consegui falar com a plataforma" ao entrar | `RAGNABOT_PLATAFORMA_INTERNA` no pod (§7-A) |
| "não encontrei esta tela" | é a tela do próprio Ragnabot dizendo que a rota não existe — o painel está de pé |

---

## 0-A. Por onde se anda no Ragnabot (menu e telas)

**O que faz.** É a casca da interface: menu à esquerda, cabeçalho com a empresa e a versão, e o
botão de sair. Antes disto a interface era **uma página só** — o construtor de fluxo existia e
ninguém chegava nele, porque não havia caminho.

**Como o operador usa.** Entra com a conta da plataforma e cai direto em **Atendimentos**. No menu:

A ordem abaixo é a ordem do menu, e ela **espelha o sistema que a empresa usa hoje** — não a ordem
em que fomos construindo. As linhas marcadas com **·** são as telas que ainda são do fornecedor e
abrem dentro da casca (§0).

| Item | Para quê | Quem vê |
|---|---|---|
| **Atendimentos** | a sua fila: abertas, resolvidos e grupos | todos |
| **Conversas** · | responder o cliente — a tela do painel de atendimento, aqui dentro | todos |
| **Contatos** · | a agenda de quem já falou com a empresa | todos |
| **Fluxos** | desenhar e publicar o atendimento automático | todos |
| **Testador de fluxo** | conversar com o fluxo antes de qualquer cliente | todos |
| **Conexões** | operar a conexão: quem opera, como está, quanto do plano já foi usado, transferir (§6-A) | administrador |
| **Caixas de entrada** | conferir as conexões que o robô conhece e acertá-las com a plataforma | administrador |
| **Agendamentos** | mensagens marcadas para sair na hora certa, uma vez ou repetindo (**o disparo ainda está desligado** — ver §1-D) | todos |
| **Respostas rápidas** | os atalhos de texto que a equipe repete o dia inteiro | todos |
| **Relatórios** · | números do atendimento: volume, tempo de resposta e resolução | administrador |
| **Configurações** | como o atendimento se comporta — dez painéis de ajuste, por empresa (§6-C) | todos leem; **só administrador altera** |
| **Empresas** | cadastro comercial de quem contrata (é tela de operador do SaaS) | ⛔ **só a conta que opera o SaaS** |

⭐ **A regra do SaaS, em uma linha:** toda empresa tem **o mesmo menu**. A conta que vende o serviço
tem a mais exatamente **um** item — «Empresas». Whitelabel e Planos não são itens de menu: são abas
dentro de Configurações, e quem as esconde é o servidor (§6-C).

O menu recolhe no botão do canto (fica só o ícone) e a escolha é lembrada no navegador. Os itens são
**links de verdade**: abrem em nova aba, o endereço pode ser copiado e o botão "voltar" funciona.

**Como funciona por dentro.** O catálogo de telas é um arquivo só (`web/src/lib/navegacao.js`), o que
permite medir "quem vê o quê" sem abrir navegador. ⚠️ **Esconder item de menu não é segurança** —
quem tranca é o servidor, e o teste que vale é a API recusando, não o botão sumindo.

⚠️ **Onde a interface está pendurada é uma declaração, não um palpite.** O pacote é construído com o
caminho em que vai morar (desde a v1.07.00, **`/painel/`** — ver §0). Mudar esse caminho exige
**construir a imagem de novo**; não basta mexer no proxy.

⚠️ **O endereço das telas embutidas NÃO leva o nosso prefixo.** A nossa interface mora em `/painel/`;
o painel do fornecedor mora na **raiz** do mesmo endereço. Um quadro apontando para
`/painel/app/accounts/…` responderia **200** e mostraria a **nossa** tela de «não encontrei» lá
dentro — certo na rede, errado no olho, e sem nada apontando para a causa. Há uma medição só para
isso, que reprova se o prefixo vazar para o quadro.

⛔ **Mover a casca para um subdomínio próprio quebraria todas as telas embutidas de uma vez.** O
painel do fornecedor responde `X-Frame-Options: SAMEORIGIN`: ele aceita ser embutido por páginas do
**mesmo endereço**, e é por isso que isto funciona hoje. Em `painel.ragnatela.com.br` o navegador
passaria a barrar o quadro **em silêncio** — tela em branco, sem mensagem. É decisão de
infraestrutura, não de código.

🔒 **A nossa casca também passou a se proteger.** Desde a v1.11.00 o `/painel/` responde
`X-Frame-Options: SAMEORIGIN`. Antes, um site de terceiro podia embutir o **nosso** painel numa
moldura invisível e colher o clique de quem estivesse logado.

---

## 1. Conexões e automações

**O que faz.** Cada número de WhatsApp (e, _planejado_, cada página de Facebook/Instagram) é uma
**conexão**. As automações moram **nas propriedades da conexão** — inatividade, relógios de
"aguardando", expira-ticket e qual fluxo dispara no primeiro contato.

**Como o operador usa.** Abre a conexão e configura: quantos minutos de silêncio até agir, qual lado
conta esse silêncio (contato, atendente ou qualquer um), e o que acontece no vencimento.

**Como funciona por dentro.** A configuração vive em `RagnabotAtendPolitica`, com **escopo** por
empresa, por caixa ou por time. O campo que decide o silêncio é `inatividadeConta`
(`contato`/`atendente`/`qualquer`) — o mesmo conceito que na origem se chamava
`inatividadeLastMessageType`. O trabalhador de atendimento (a cada 60s) lê a política e age.

---

## 1-A. Caixas de entrada — o cadastro que o robô consulta

**O que faz.** Mantém, do NOSSO lado, a lista das caixas de entrada que existem na plataforma:
número da caixa, nome, canal, empresa e se está ativa. É esse cadastro que o robô lê **durante o
atendimento** — não a plataforma.

**Por que existe.** Em 02/09/2026 a plataforma tinha **quatro** caixas na conta 1 (1 Site ·
34 WhatsApp · 35 Facebook · 36 Instagram) e o nosso cadastro estava **vazio**. Ninguém tinha como
perceber: não havia tela e a rotina de conferência nunca era chamada. Cadastro vazio não derruba
nada de cara — ele **degrada em silêncio**: o robô passa a tratar todo canal como o mais pobre
(manda lista numerada onde caberia botão) e não conhece a janela de 24 h do WhatsApp.

**Como o operador usa.** Menu → **Caixas de entrada**. A tela lista o que está registrado, com o
**número da caixa em destaque** — é ele que se informa num fluxo com entrada por caixa. O botão
**Sincronizar agora** confere tudo com a plataforma e diz, em uma frase, o que mudou.

**As quatro situações que a conferência resolve:**

| Situação | O que acontece |
|---|---|
| caixa nova na plataforma | entra no cadastro |
| caixa que mudou (nome, número) | a linha é atualizada — nunca duplicada |
| caixa que voltou depois de desligada | a **mesma** linha é reativada |
| caixa que sumiu da plataforma | é marcada como **inativa** |

⚠️ **Nenhuma linha é apagada, jamais.** Conversa, protocolo, política de atendimento e fluxo apontam
para o número daquela caixa; apagar a linha transformaria histórico em número solto.

**Rodar duas vezes não duplica nada.** A segunda passada devolve tudo zerado e diz "nada mudou" — é
assim que se confere que a rotina é honesta.

**Quando roda sozinha.** No arranque do motor (poucos segundos depois de subir, para não competir
com a partida) e a cada **15 minutos**. `GET /saude` mostra em `cadastroDeCaixas` quando foi a
última passada e qual foi o último erro.

**A guarda que veio junto.** Ao amarrar um fluxo a uma caixa, o número informado é conferido contra
este cadastro. Número que não existe é **recusado**, com a lista das caixas que existem — em vez de
gravar, publicar e o fluxo nunca disparar. ⚠️ Se o cadastro estiver **vazio**, a guarda **deixa
passar com aviso**: cadastro vazio significa "a conferência ainda não rodou", não "este número é
falso", e guarda que trava por dúvida vira guarda contornada.

⛔ **Nenhuma credencial passa por aqui.** O token da Meta, o do bot e as senhas de IMAP/SMTP ficam só
na plataforma. Do nosso lado fica a **impressão digital** da credencial (um resumo irreversível),
que serve para saber se o token foi trocado sem nunca poder reconstruí-lo.

**O que esta tela NÃO faz:** criar e remover conexão. As duas pedem segundo fator e credencial de
canal — continuam em **Empresas** e no painel de atendimento.

---

## 1-B. A caixa de atendimento — quem vê qual conversa

**O que faz.** É a tela **Atendimentos**: a fila do agente, com as abas **Abertas · Resolvidos ·
Grupos** e, dentro de Abertas, as sub-abas **Atendendo · Aguardando · ChatBot**, cada uma com o seu
contador. Cada conversa aparece num cartão com **três etiquetas — caixa de entrada · setor ·
atendente** — para que, olhando a fila, se saiba de quem é o quê sem abrir nada.

**⭐ A regra que define esta tela — quem vê o quê:**

| Quem | Vê |
|---|---|
| **Administrador** da empresa | todas as conversas da empresa dele |
| **Atendente** | as conversas **atribuídas a ele**; as que **ele resolveu**; e a **fila (sem atendente) dos setores de que ele participa** |
| Qualquer um | **nada** de outra empresa |

E as consequências, ditas em voz alta porque elas se notam no uso:

- **Conversa em aberto de outro atendente você não vê** — nem na lista, nem pedindo pelo número.
- **Conversa na fila sem setor nenhum** só aparece para o administrador. Não há a que amarrar a
  permissão, e a regra da casa em caso de dúvida é mostrar **menos**.
- **Atendente que não está em nenhum setor não vê fila alguma** — só as conversas dele. É proposital:
  sem saber a que setor a pessoa pertence, mostrar a fila seria mostrar conversa de outra equipe. O
  administrador resolve isso no botão **«Sincronizar setores»**, que traz da plataforma os times e
  quem é membro de cada um.

**Resolvidos.** Ordenados pela **resolução mais recente**. O administrador vê todos os da empresa;
o atendente vê **só os que ele mesmo resolveu**. O que o robô resolveu sozinho aparece para o
administrador.

**Histórico por setor.** No cartão há **«Histórico do setor»**: os atendimentos anteriores daquele
contato **naquele setor**. Não existe histórico global — nem para o administrador. O mesmo cliente
pode falar com o Financeiro e com o Suporte, e uma conversa não entra dentro da outra. Pedir o
histórico de um setor de que você não participa recebe uma recusa explicada.

**⚠️ O que a tela NÃO guarda.** Nenhum texto de mensagem. O índice de conversas guarda apenas
roteamento — de quem é, de que setor, em que estado, quando — e o conteúdo continua na plataforma,
lido só ao abrir a conversa, depois de a permissão já ter sido conferida.

**Como funciona por dentro.** O isolamento é do **servidor**, não da tela: ele é uma cláusula
`where` na consulta (`ragnabot-caixa.service.js`), e não um botão escondido. Um atendente pedindo a
conversa de outro **pela API** recebe **404** («não encontrada») — e 404, e não 403, porque um 403
confirmaria ao curioso que aquele número existe. Filtro mandado pela tela (`?cwAssigneeId=`,
`?cwTeamId=`, `?tenantId=`) só **estreita** dentro do que já era visível; nunca alarga.
Os **contadores** das abas saem da **mesma consulta** da lista — contador que mente é pior que
contador ausente.

O índice se enche pelo aviso da plataforma (webhook), e essa gravação **nunca derruba o webhook**:
perder uma projeção atrasa uma linha da fila; derrubar o webhook perderia a mensagem do cliente.

*Prova:* `app/tests/ragnabot-caixa-isolamento.test.mjs` — 63 medições contra PostgreSQL de verdade
e o servidor de verdade, incluindo a recusa por API nos dois sentidos.

---

## 1-C. Retrocarga — trazer para a caixa as conversas que já existiam

**O problema que ela resolve.** A caixa se enche pelo aviso da plataforma (webhook). Conversa que
começou **antes** de o aviso existir nunca gerou aviso nenhum — então ela não estaria na fila, e a
tela nasceria vazia sem explicação. A retrocarga vai buscar essas conversas e monta o índice.

**Como o administrador usa.** Botão **«Trazer conversas existentes»** (ou
`POST /api/ragnabot-caixa/retrocarga`). Só administrador; atendente recebe recusa. Aceita
`?simular=1`, que **mede e mostra o relatório sem gravar nada** — é como conferir antes.

**O que ela traz, e de onde.** A plataforma não devolve tudo o que o cartão precisa; cada dado vem
do dono certo:

| Dado | Vem de |
|---|---|
| estado, contato, setor, atendente, datas | a **plataforma** (todos os estados: abertas, na fila, resolvidas e adiadas) |
| **nome da caixa de entrada** | o **nosso** cadastro de conexões (a plataforma só manda o número) |
| **protocolo** | o **nosso** registro de protocolos |
| **«está com o robô»** | a **nossa** execução de fluxo viva — a plataforma não sabe distinguir «robô atendendo» de «ninguém atendendo» |

**Pode rodar quantas vezes quiser.** É idempotente: a segunda passada não duplica nem muda uma
linha. E ela **não piora** o que o aviso já tinha gravado: quem resolveu a conversa e quando são
informação do **evento**, e a retrocarga não os sobrescreve — a plataforma, lida depois, não guarda
esses dois campos.

**O que ela deduz, e diz que deduziu.** Numa conversa resolvida, o instante da resolução é
aproximado (vem da última mudança de estado) e o autor é deduzido do responsável atual. As
aproximações saem **contadas no relatório**, com o motivo escrito — não escondidas.

*Prova:* `app/tests/ragnabot-caixa-retrocarga.test.mjs` — 43 medições contra PostgreSQL de verdade,
com o relatório real das conversas indexadas, a idempotência e a recusa por API.

---

## 1-D. Agendamento de mensagens — marcar uma mensagem para sair na hora certa

**O que faz.** Deixa a mensagem escrita hoje e combinada para sair depois: numa data e hora, para um
ou vários contatos, **uma vez ou repetindo** (todo dia, toda semana, todo mês). Serve para o aviso de
manutenção da madrugada, a cobrança do dia 5, o «bom dia» de segunda da equipe de campo — tudo o que
alguém hoje faz na mão, no horário errado, ou esquece.

**Onde fica.** Menu **Agendamentos**. Não é tela só de administrador: quem agenda uma mensagem é o
atendente ou o supervisor, e a tela é deles também. Cada empresa vê **só os seus** — um agendamento
de outra empresa responde «não encontrado».

---

### Como marcar um envio

1. **Título** — o nome pelo qual você vai reconhecer a agenda na lista.
2. **Por qual conexão sai** — obrigatório. *Nada sai sem canal*: uma mensagem agendada sem conexão é
   uma mensagem que não sai, então a tela nem deixa salvar. É aqui que se escolhe o WhatsApp, o chat
   do site, o Instagram.
3. **Para quem** — um ou vários contatos, até **500** por agendamento (acima disso o desenho certo é
   campanha, que é outra coisa). O telefone é normalizado **enquanto se digita**: `(98) 98335-1000` e
   `5598983351000` são o mesmo contato, e o mesmo contato repetido entra **uma vez só** — senão ele
   receberia em dobro por erro de cadastro.
4. **A mensagem** — texto livre, com as mesmas variáveis das respostas rápidas. Pode levar **anexo**
   (imagem, vídeo, áudio, documento); com anexo, o texto vira a **legenda**.
5. **Quando e com que repetição** — data e hora de início, e a recorrência: **única · diária ·
   semanal · mensal**, com «a cada N». Na semanal escolhem-se os dias. Dá para pôr um **fim**
   (`até`) ou um **teto de repetições**.
6. **Abrir atendimento?** — marcado, a conversa fica **aberta** depois do envio e vai para o setor
   escolhido: virou atendimento e alguém vai responder. Desmarcado, a conversa é **resolvida** logo
   depois — mas só se **fomos nós que a abrimos**. Conversa que já estava com um atendente **não é
   fechada por baixo dele**.

> **O horário é o do cliente, não o do servidor.** Cada agendamento guarda o seu **fuso**. «Toda
> terça às 8h» é 8h no relógio de quem recebe, inclusive no dia em que o horário de verão vira — a
> conta é feita em calendário, não somando 24 horas, que é onde esse tipo de agenda costuma
> escorregar uma hora exatamente no dia em que o cliente mais repara.

---

### O que aparece depois: o histórico, por destinatário

Cada disparo gera **uma linha por destinatário e por ocorrência** — e é isso que permite dizer
«saiu para o João às 08h02 e não saiu para a Maria, porque…». Os estados são estes:

| Estado | O que quer dizer | Repete sozinho? |
|---|---|---|
| **Enviado** | o destino confirmou o recebimento | — |
| **Fora da janela** | passaram-se mais de 24 h desde a última mensagem do contato e este agendamento não usa modelo aprovado. **Não saiu** | não — é regra da Meta, não defeito nosso |
| **Adiado** | não havia por onde sair naquele instante (conexão desligada, caixa inativa). Fica com motivo e horário da nova tentativa | **sim**, com recuo crescente, até 6 tentativas |
| **Falhou** | o destino disse não (número inválido, por exemplo), ou acabaram as tentativas | não |
| **Em dúvida** | o processo caiu entre reservar e confirmar, ou a rede caiu no meio do envio | **não — e é de propósito** |
| **Cancelado** | a agenda foi cancelada antes de este item sair | não |

**Por que «em dúvida» não se repete sozinho.** Porque a mensagem **pode ter saído**. Quando a rede
cai no meio de um envio, ninguém sabe se ela chegou ou não; reenviar por conta própria transformaria
uma dúvida em **duas mensagens iguais** no WhatsApp de um cliente. Então o item para ali, marcado, e
**só uma pessoa** manda repetir — no botão **«Reenviar»**, que aparece apenas nos itens que precisam
de decisão humana. O reenvio nasce com registro próprio: **a tentativa antiga fica no histórico**,
não é apagada.

> **A tela não esconde o que é incômodo.** «Fora da janela» e «em dúvida» aparecem na lista com o
> motivo por extenso. Um relatório que só mostra «enviado» é um relatório que mente por omissão.

---

### A mesma mensagem nunca sai duas vezes

É a garantia central desta função, e ela **não é um cuidado do programa: é uma tranca do banco**.
Cada par «destinatário × ocorrência» ganha uma chave única, e o envio começa reservando essa chave.
Quem reserva, manda; quem esbarra numa chave já reservada, **não manda**. Isso vale mesmo com o
sistema rodando em várias cópias ao mesmo tempo, e sobrevive a um reinício no meio do disparo.

Por isso também **não existe botão «disparar agora»**. Ele pularia a reserva — que é justamente o
que segura a mensagem dobrada. Quem quiser antecipar, **edita o horário**.

---

### Pausar, retomar e cancelar

- **Pausar** congela a agenda. Nada sai enquanto estiver pausada.
- **Retomar** volta à grade **para a frente**: se ficou três dias pausada, ela **não** dispara os três
  «bom dia» atrasados de uma vez.
- **Cancelar** encerra a agenda. O que **já disparou continua no histórico** — agendamento cancelado
  não apaga o passado —, e o que estava a caminho é fechado com o motivo escrito, sem ficar pendurado.

---

### ⛔ Hoje o disparo está DESLIGADO — e isto é decisão, não pendência

O cadastro **funciona por inteiro**: a tela abre, os agendamentos são criados, editados, pausados e
cancelados, e ficam **pendentes**. O que ainda não acontece é a **saída da mensagem**.

**Por quê.** Todo o resto do Ragnabot **responde** a quem escreveu. Este é o primeiro pedaço que
**começa** conversa — ele fala com quem não pediu nada naquele instante. Um mecanismo assim, ligado
sozinho num sistema recém-publicado com agendas vencidas guardadas, dispararia **de uma vez tudo o
que ficou para trás**. Ligar é, portanto, um ato deliberado.

**Como ligar** (quando for a hora): a variável `RAGNABOT_AGENDAMENTO=1`. **A recomendação registrada
é estrear com uma agenda de teste, para um número da casa, com alguém do outro lado** — nunca em
cima de agenda de cliente.

*Prova:* `app/tests/ragnabot-agendamento.test.mjs` — 40 medições da parte pura (recorrência, fusos,
virada do dia, virada do horário de verão, validação). E
`app/tests/ragnabot-agendamento-worker.test.mjs` — 37 medições contra PostgreSQL de verdade, com
**duas cópias do sistema disputando a mesma ocorrência**, reinício no meio do disparo, contato que
falha sozinho sem derrubar os outros, e a recusa do banco à chave repetida.

---

## 2. Relógios de atendimento

**O que faz.** Devolve para a fila, encerra ou avisa uma conversa parada — sozinho.

**Como o operador usa.** Liga o relógio de inatividade na conexão e define minutos + ação. Fora do
expediente, o relógio **congela** (não dispara de madrugada).

**Como funciona por dentro.** Cada conversa ganha uma linha em `RagnabotAtendRelogio` com quando
vence e o que fazer. O trabalhador reconcilia a cada tique: arma o relógio quando a conversa fica
elegível, re-arma quando há nova interação, e no vencimento despacha a ação — **devolver para a
fila**, **transferir de time**, **resolver** ou **notificar**. A entrega é idempotente: o mesmo
vencimento entregue duas vezes não repete o efeito nem a mensagem (`updateMany where disparadoEm:
null`). A ação **notificar** agora tem consumidor próprio, com tique de 15 s: quando o trabalho chega a ele
o prazo já venceu. Ele cobre **dois tipos** de trabalho — o aviso do relógio e a mensagem avulsa da
portaria — e respeita a **janela de 24 h** do WhatsApp: fora dela a ação de estado acontece, a
mensagem não sai, e o motivo fica na nota interna. O texto sai **só** por esse caminho: o envio
direto do trabalhador foi removido em 29/08 porque fazia o cliente receber a mesma mensagem duas
vezes, por um atalho que não conferia a janela.

---

## 3. Expediente, intervalo e feriado

**O que faz.** Define quando a empresa atende, inclusive **intervalo de almoço** e **feriado**.

**Como o operador usa.** Cadastra as janelas do dia (ex.: 08:00–12:00 e 13:00–18:00) e as datas
especiais (avulsas ou que se repetem todo ano, como `*-12-25`).

**Como funciona por dentro.** `RagnabotAtendExpediente` guarda **uma linha por janela** — é isso que
torna o intervalo possível (o chat anterior guardava uma janela por dia e não conseguia).
`RagnabotAtendExcecaoData` guarda os feriados. O cálculo de "próxima abertura" e de "minutos de
expediente" respeita fuso (padrão `America/Fortaleza`) e o dia é conferido **duas vezes**: quando o
prazo é calculado e de novo na hora de disparar.

---

## 4. Transferência

**O que faz.** Passa a conversa para outro atendente ou para um time — e **tira o atendente
anterior junto**.

**Como o operador usa.** Escolhe o destino; a conversa sai da sua mão e aparece livre para quem
recebe.

**Como funciona por dentro.** `devolverParaFila` põe a conversa em `pending` **e** remove o
`assignee`; `transferirTime` atribui o `team` **e** zera o `assignee`. Manter o atendente antigo
colado não é transferência, é etiqueta — por isso os dois passos, nessa ordem. O histórico vai para
`RagnabotAtendTransferencia` _(o registro amarrado ao caminho de entrada é §A5)_.

---

## 5. Fluxo de conversa (chatbot)

**O que faz.** O roteiro que responde ao cliente automaticamente — menus, perguntas, condições.

**Como o operador usa.** Monta o fluxo arrastando blocos no editor; publica quando pronto.

**Como funciona por dentro.** Motor nativo, 20 tabelas. Uma **versão publicada é imutável** (o motor
recusa editá-la); uma conversa tem **uma execução por vez** (recusa duas). Se o processo morre no
meio, a execução **retoma sozinha**. A fila do motor (`RagnabotFluxoFila`) particiona por
`conta:conversa`, o que impede o relógio de mexer na conversa no meio de um passo do fluxo.
**Publicação (v1.01.00).** Publicar congela o rascunho numa **versão imutável** e reaponta o fluxo.
A assinatura de estrutura **ignora as coordenadas do editor** — arrastar um bloco não cria versão
nova e não órfã quem está no meio da conversa; mudar uma ligação/tipo, sim. Reverter **copia para a
frente** (versão nova com o conteúdo antigo), mantendo a numeração contínua.

⭐ **v1.06.00:** o **resolvedor de entrada** deixou de ser promessa — o caminho do primeiro "oi" está
inteiro (§5-H). Ele sobe **desligado** nesta versão, de propósito, e o §5-H explica o porquê e como
se percebe isso pelo `/saude`.

---

## 5-A. A portaria de entrada (o primeiro "oi")

**O que faz.** É quem decide o que acontece quando o cliente escreve: começar um fluxo, mandar para
a fila humana, ou responder só um aviso.

**Como o operador percebe.** O cliente manda "oi" e o chatbot responde. Fora do expediente, recebe o
aviso configurado em vez de ficar no vácuo.

**Como funciona por dentro.** Grava a entrada (reentrega da mesma mensagem é reconhecida e
descartada), e então: se a conversa **já tem um fluxo em andamento**, a mensagem vai direto ao motor
— sem passar pelo resolvedor. Essa exceção existe por um motivo concreto: sem ela, quem estivesse no
meio de um menu às 18h01 receberia "estamos fechados" e ficaria travado esperando uma resposta que a
portaria tinha engolido. Se não há fluxo vivo, o resolvedor decide, e o que não vira fluxo vira
trabalho na fila para o consumidor entregar.

---

## 5-B. Respostas rápidas

**O que faz.** Atalhos de texto do atendente.

**Como o operador usa.** Cadastra `/bomdia` com o texto, e ao usar o atalho o texto sai pronto — com
`{{firstName}}`, `{{ticket_id}}` e `{{protocolo}}` já preenchidos. A resposta pode ser **da empresa**
(todo mundo usa) ou **pessoal** (só de quem criou), e pode valer só numa caixa ou num time.

**Como funciona por dentro.** O atalho repetido é recusado **pelo banco**, não só pela tela — e o
truque para isso é uma chave calculada, porque no Postgres dois nulos não são iguais e um índice
sobre colunas anuláveis deixaria cadastrar `/bomdia` dez vezes. Uma empresa nunca enxerga a resposta
da outra: o filtro vem sempre do usuário logado, e o que está fora do escopo responde **404**, nunca
403 — 403 confirmaria que existe.

---

## 5-C. Turno por atendente

**O que faz.** Define o horário de cada atendente, quando ele difere do horário da empresa.

**Como o gestor usa.** Cadastra a janela de quem tem horário próprio. **Quem não cadastrar nada
continua herdando o horário da empresa** — é o caso da maioria, e é de propósito: se a ausência de
turno significasse "indisponível", ligar a função esvaziaria a fila no primeiro dia.

**Como funciona por dentro.** Quem tem turno é avaliado pela própria grade; as **exceções do
calendário da empresa** (feriado, meio expediente) continuam valendo e derrubam o turno — e o motivo
diz "empresa fechada", não "fora do turno", senão o gestor procuraria defeito na grade da pessoa. O
plantão 22:00–06:00 numa empresa 08–18 **funciona**: se o sistema exigisse as duas coisas ao mesmo
tempo, esse plantonista ficaria disponível nunca, sem erro nenhum aparecendo.

---

## 5-D. Identidade no painel (empresa + versão)

**O que faz.** Mostra, junto do usuário logado, o **nome da empresa** e a **versão do Ragnabot**.

**Como o operador percebe.** No rodapé da barra lateral, abaixo do nome de quem está logado.

**Como funciona por dentro.** Usa a configuração oficial `DASHBOARD_SCRIPTS` do Chatwoot — não
altera o layout nem sobrepõe arquivo dentro da imagem, então **sobrevive à troca de versão da
plataforma**. Idempotente (o painel redesenha o tempo todo e a linha nunca duplica) e falha em
silêncio: se não achar onde encaixar, não escreve nada, porque identidade é enfeite e não pode
quebrar o atendimento.

⚠️ **A versão é embutida no arquivo** — atualize junto com o `VERSAO` a cada entrega.
Aplicação e reversão em `deploy/identidade/LEIA-ME.md`.

---

## 5-E. Os blocos do fluxo (21 tipos)

**Fala:** início · texto · mídia (imagem, áudio, vídeo, documento).
**Pergunta:** pergunta · botões · lista · espera.
**Decide:** condição · variável · subfluxo · **randomizador**.
**Age:** etiqueta · passa para time · **passa para atendente** · abre chamado · aviso interno ·
chamada externa · **e-mail** · encerra.
**Ainda sem tela no editor:** agente de IA e cobrança por Pix existem no motor e ainda **não**
aparecem na paleta — ver 5-I.

### Lista
Menu de até 10 opções. Aceita **cabeçalho** em negrito, corpo com variáveis, rodapé, rótulo do botão
que abre o menu, e cada item com título, descrição e **seção** (para agrupar). Se um item tem seção,
**todos** precisam ter — com mais de uma seção a Meta exige título em todas e recusa a mensagem
inteira se faltar.

### Botões
Ou até **3 botões de resposta**, ou **1 botão de link** — nunca os dois juntos. Isso não é escolha
nossa: no WhatsApp são tipos de mensagem diferentes, e misturar faz a Meta recusar tudo, com o
cliente sem receber nada. O **botão de link não espera resposta** (a Meta não avisa o clique), então
o fluxo segue adiante em vez de ficar parado esperando alguém que já foi embora.

### Passa para atendente
Entrega a conversa a uma **pessoa**, e não a um setor. A pessoa é escolhida por **e-mail, nome ou
id** — prefira o e-mail: se houver duas pessoas com o mesmo nome na conta, a transferência é
**recusada** em vez de sortear uma, porque mandar para a pessoa errada ninguém percebe.

Há um **setor alternativo**: se a pessoa não for encontrada (saiu da empresa, trocou de e-mail) ou,
opcionalmente, se não estiver disponível, a conversa vai para lá. Sem setor alternativo a
transferência falha de propósito, com incidente — melhor uma falha barulhenta que alguém conserta
do que uma conversa sem dono que ninguém vê.

⚠️ Este bloco **muda quem enxerga a conversa**: ela entra na caixa daquela pessoa e sai da fila do
setor (ver 1-B). Fora da janela de 24 h a transferência **acontece assim mesmo** — só o aviso ao
cliente é que não sai.

### Randomizador (teste A/B)
Divide o tráfego por **porcentagem**, uma saída por faixa. As porcentagens têm de somar exatamente
**100 %** — o editor não «normaliza» números errados em silêncio. Para três saídas iguais use
**33,33 · 33,33 · 33,34**; a última faixa absorve o arredondamento, e nenhum sorteio cai no vazio.

O sorteio é **reprodutível**: a mesma passagem dá sempre o mesmo ramo. Isso importa porque o motor
repete passos quando um envio falha — com dado de verdade, o cliente receberia as **duas** variantes
uma atrás da outra. Você escolhe o que se repete:

| Repete por | Quando usar |
|---|---|
| **visita** | sortear a cada passagem — serve para dividir carga |
| **conversa** | a pessoa não muda de variante no meio do atendimento |
| **contato** *(recomendado)* | a mesma pessoa vê **sempre** a mesma variante — é o único que faz um teste A/B honesto; do contrário a comparação mede a alternância, não a variante |

No **testador** há o campo **«Forçar caminho»** (`bloco=saida`, uma por linha): é assim que se
confere a variante que o sorteio não tomou. O testador avisa, no próprio passo, que o caminho foi
desviado por você.

### Sub-fluxo — a guarda contra laço
`chamar` volta ao fim do sub-fluxo; `saltar` entrega o controle e não volta. **Fluxo que chama a si
mesmo — direta ou indiretamente — é recusado na publicação**, com o caminho do laço escrito por
extenso («Atendimento → Menu → Atendimento»). Antes disso, o laço só aparecia em produção: a
conversa andava em círculo até bater no teto de passos, depois de gastar mensagens com o cliente.
A mesma guarda vale ao **reverter** uma versão antiga.

### E-mail
Destinatário, assunto, corpo, responder-para e cópia oculta — todos aceitam variáveis. Não espera
resposta e **não** verifica a janela de 24 h (e-mail não passa pela Meta). O cabeçalho remove
quebras de linha de propósito: sem isso, um texto digitado pelo cliente poderia acrescentar
destinatários ocultos ao nosso e-mail. A cópia oculta nunca entra no registro — senão deixaria de
ser oculta.

---

## 5-F. Testador de fluxo

**O que faz.** Deixa você conversar com o fluxo **antes** de publicar — sem mandar nada para
ninguém, sem gravar nada e sem chamar nenhum serviço de fora.

**Como o operador usa.** Abre **Testador de fluxo**, escolhe o fluxo, aperta *Começar* e digita como
se fosse o cliente. Quando o fluxo espera uma escolha de menu, os botões aparecem prontos para
clicar. A tela é dividida em duas leituras, e a divisão é o ponto:

- **O que o cliente veria** — só as mensagens, do jeito que chegariam no aparelho dele.
- **Nos bastidores** — etiqueta aplicada, protocolo carimbado, nota interna, resolução, transferência.
  Isso **não** são mensagens; numa lista única o operador contaria cinco balões numa conversa que
  tem dois, e "corrigiria" um envio repetido que não existe.

Os problemas encontrados vêm separados em **erro** (trava a publicação) e **aviso** (não trava). Uma
tela que grita igual para os dois ensina o operador a ignorar os dois.

Há sempre uma faixa dizendo, em português, que aquilo é **simulação**. Ela não some.

**Como funciona por dentro.** Quem percorre o fluxo é o **motor de produção**, no servidor, com os
mesmos executores — o navegador não simula nada. Um simulador escrito à parte diverge do motor em
poucas semanas, e a divergência aparece justamente quando alguém confia nele para publicar. O relógio
(expediente, feriado) vem do banco, como em produção, e a resposta diz de onde veio. Fluxo de outra
empresa responde **404**, nunca o documento.

---

## 5-G. A tela das respostas rápidas

**O que faz.** Dá tela ao que já funcionava desde 29/08 (§5-B): cadastrar, buscar, editar e apagar os
atalhos de texto.

**Como o operador usa.** Menu **Respostas rápidas**. A lista mostra o atalho em destaque, o escopo em
uma palavra — **"Só eu"** ou **"Todos"** — e o começo do texto. O campo de busca filtra por atalho,
por título e pelo conteúdo. No formulário: o atalho (sem a barra), o título, o texto, o escopo e,
opcionalmente, a caixa ou o time em que ele vale.

⚠️ **Duas coisas do chat atual ainda não existem, e a tela diz isso em vez de fingir:**
**várias mensagens por atalho** (o modelo guarda um texto só) e **anexo** (não há campo nem lugar
definido para o arquivo). As duas exigem mudança de banco, que neste produto é caminho longo de
propósito.

---

## 5-H. O caminho do primeiro "oi" — inteiro, e por que ele está desligado

**O que faz.** É a corrente que leva a mensagem de quem escreve até a resposta do robô:

```
plataforma → webhook → portaria → fila do motor → motor → adaptador de canal → cliente
```

**O que mudou na v1.06.00.** Faltavam três elos, e os três nasceram juntos:

1. **O webhook passou a entregar a mensagem à portaria.** A função existia, estava testada, e
   ninguém a chamava: o cliente mandava "oi" e o motor nunca era acionado.
2. **O adaptador de canal** — quem transforma a intenção do fluxo ("mande este menu") em mensagem de
   verdade na plataforma. Sem ele, o motor montava a frase e não havia ninguém do outro lado.
3. **A fila do motor com o seu executor** — quem tira o trabalho da fila e faz a conversa andar. A
   fila existia e recebia trabalho; ninguém o retirava.

**⚠️ O executor sobe DESLIGADO, e isso é decisão, não defeito.** O produto já tem conversa real de
gente. Enquanto ele estiver desligado: a mensagem continua sendo **recebida e gravada**, o trabalho
continua **entrando na fila**, e **ninguém o consome** — ou seja, o robô não responde. É um freio
para um aperto, nunca um estado de repouso. Ligar é mexer numa variável e reiniciar; acompanhe o
tamanho e a **idade** da fila em `GET /saude`, campo `filaDoMotor`.

**Como o operador percebe que está desligado.** No `/saude`, `filaDoMotor.executor.ligado` é `false`
e o motivo aparece escrito. No registro do arranque, uma linha em amarelo diz a mesma coisa.

**Quatro armadilhas que a ligação com a portaria evita, e vale conhecer:**

- **O robô conversando sozinho** — toda mensagem que o robô envia volta como evento. A classificação
  é *positiva*: só mensagem que entra, não privada, de quem não é atendente vira "resposta do
  cliente". Todo o resto é registrado e não acorda ninguém.
- **A nota interna virando escolha de menu** — nota é o atendente falando com o time, e nunca conta
  como resposta.
- **A reentrega virando segunda conversa** — a plataforma reentrega quando não recebe um "ok", e isso
  é desejado; a mesma mensagem é reconhecida e descartada em duas camadas (uma delas é o índice
  criado nesta versão).
- **O erro nosso entupindo a fila da plataforma** — mensagem gravada devolve "ok" mesmo que o resto
  tenha degradado; só mensagem **não** gravada pede reentrega.

---

## 5-I. Ainda não ligado: Capitão (agente de IA) e cobrança por Pix

Duas frentes entraram no produto **sem serem ligadas**. Estão aqui para que ninguém as procure na
tela e ache que sumiram.

**Capitão — o agente de IA.** É a camada da casa sobre o agente nativo da plataforma: quem está
ligado, com quais documentos, com que marca (o agente se apresenta como agente **da empresa
cliente**, nunca como produto de terceiro), com que teto de gasto e a partir de que confiança ele
pode responder. **Nasce desligado**, sem chave configurada, e **não tem tela**. Abaixo da confiança
mínima ele devolve ao humano em vez de chutar — chutar é pior, porque o cliente acredita.
⚠️ Nenhum texto de cliente é guardado: a pergunta vira impressão digital e a resposta vira contagem
de caracteres.

**Cobrança por Pix (Efí).** O caminho técnico existe e **não tem nenhuma credencial**; por padrão ele
**recusa**. Nada é cobrado por aqui enquanto o dono não decidir a conta, o certificado e o ambiente.

⚠️ **As tabelas das duas frentes ainda não existem no banco.** A publicação de 02/09 aplicou apenas a
migração da fila. Enquanto isso, abrir uma dessas rotas responde erro — e é por isso que elas não
estão no menu.

---

## 5-J. Os números em cada saída do fluxo

**O que faz.** Com a camada de números ligada no editor, **cada saída de cada bloco** mostra quantas
pessoas foram por ali e a porcentagem sobre o total de vezes que aquele bloco foi apresentado —
«enviado · clicado · CTR». É o que responde, sem adivinhar, qual opção do menu ninguém escolhe.

**Como ler.**

- O **denominador** é sempre quantas vezes **aquele bloco** foi apresentado no período.
- **Exceção não conta como clique.** «Sem resposta», «opção inválida», «erro» e «fora da janela de
  24 h» aparecem com o número, mas **fora** do CTR do bloco. Contá-las inflaria justamente os menus
  que estão dando errado — e são esses que precisam aparecer mal.
- Bloco que **não foi apresentado nenhuma vez** no período mostra traço, e não «0 %». «0 %» diria
  que ninguém clicou num menu que ninguém viu.

**De onde sai o número.** Do registro cru de cada passagem do fluxo — o mesmo que alimenta o funil
por bloco. Não há uma segunda contabilidade a manter, então o número da saída e o número do bloco
não têm como divergir.

---

## 6. Multiempresa, planos e cobrança

**O que faz.** Cada empresa cliente é isolada, com seu plano e sua cobrança.

**Como funciona por dentro.** Provisionamento cria a conta na plataforma; planos e assinaturas
controlam limites (usuários, conexões, filas) e módulos ligados. Cobrança integrada. O isolamento
entre empresas é feito **sempre a partir do usuário logado**, nunca do que a tela manda — admin de
uma empresa não enxerga outra (provado contra o ataque real).

---

## 6-A. Conexões: por onde o cliente fala

**O que faz.** Uma tela com um cartão para cada canal ligado — WhatsApp, Instagram, Facebook, site,
e-mail. Cada cartão mostra o **número da conexão** (é ele que se digita ao amarrar um fluxo), o
nome, o número/endereço, **quem opera** aquele canal, **como ele está** e quando isso foi medido.
No topo, a **cota do plano**: quantas conexões já estão ligadas, de quantas, e se ainda cabe mais
uma.

**Quem opera o canal — e por que isso é um campo.** Existe o *canal* (o meio pelo qual a pessoa
fala) e existe o *provedor* (quem opera esse meio para nós). São coisas diferentes: o mesmo
WhatsApp pode chegar pela conta oficial da Meta, por uma sessão não-oficial ou por um
intermediário. Guardar isso num campo é o que permite **trocar de caminho depois sem reescrever o
robô** — trocar o provedor de uma conexão é mudar um campo, e o construtor de fluxo nem fica
sabendo. O que muda sozinho é o que dá para mandar: um canal que não desenha botão passa a receber
o mesmo menu em **texto numerado**, e o cartão avisa isso em português antes de acontecer.

**O sinal de estado, e a idade dele.** O estado nasce **«não medida»**, e é de propósito: dizer
«conectada» sem ter olhado é o pior erro possível numa tela de plantão. Quando há medição, o cartão
diz o estado **e há quanto tempo** ele foi medido — «conectada (medida há 3 dias)» é uma afirmação
sobre o passado, e quem está resolvendo um problema precisa saber disso.

**Reiniciar a conexão.** Solta o que o robô tinha guardado sobre aquele canal, confere o cadastro
com a plataforma e remede o estado. Antes, isso só se conseguia reiniciando o serviço inteiro — o
que derrubava o atendimento junto. ⚠️ Para provedores com sessão própria (que ainda não estão
ligados), o botão **diz que não fez nada**, em vez de piscar «pronto».

**Transferir atendimentos entre conexões.** Serve para trocar de número sem perder o histórico. Ele
mostra uma **prévia** do que seria movido, pede o **motivo**, e move: os atendimentos abertos passam
a ser roteados pela conexão nova, cada conversa **guarda de onde veio** (mesmo depois de três
transferências, a origem continua sendo a primeira), e fica um **aviso interno** na conversa
explicando a mudança. ⚠️ **Limite honesto:** a plataforma de atendimento não permite trocar a caixa
de entrada de uma conversa já aberta — lá ela continua na caixa original, e é por isso que deixamos
o aviso. A tela diz isso com todas as letras em vez de fingir sucesso.

**Cota.** O plano diz quantas conexões cabem, no total e por canal. Estourou, a criação é
**recusada** com o número na frente: quantas há, de quantas, e o que fazer (desligar uma que não é
mais usada ou mudar o plano). A conferência é feita de dois jeitos independentes — pelo nosso
cadastro e pela plataforma —, para a cota continuar valendo mesmo quando a plataforma está fora.

**Registro por canal.** Cada mensagem que o robô mandou por aquela conexão já ficava registrada
(com o resultado, o erro e o código HTTP); o que faltava era onde olhar. A tela lista, filtra só as
falhas e resume: quantas confirmaram, quantas falharam, e a taxa de falha.

---

## 6-B. API própria da empresa e avisos para o sistema dela

**O que faz.** Cada empresa cliente pode ter a **chave e o segredo** dela para conversar com o
Ragnabot por programa — e pode pedir que o Ragnabot **avise o sistema dela** quando algo acontece
(uma conversa nasceu, foi resolvida, uma conexão mudou de estado).

**A credencial.** A **chave** é pública: aparece na tela, entra no registro, e serve para dizer
*qual* integração está falando. O **segredo** aparece **uma única vez**, na hora de gerar, e nunca
mais — ele é guardado cifrado, e nem nós conseguimos lê-lo depois. Perdeu, **regenera**: a
credencial anterior **para de valer na hora**, e fica registrado quem regenerou e por quê.

**O aviso (webhook).** A empresa cadastra o endereço do sistema dela e escolhe quais eventos quer.
Cada aviso vai **assinado**: o Ragnabot calcula uma assinatura do conteúdo com o segredo daquele
destino e a manda no cabeçalho `X-Hub-Signature-256`. É **o mesmo padrão que a Meta usa** — quem já
integra com a Meta não escreve uma linha nova para integrar conosco.

**Se o sistema do cliente estiver fora do ar, nada se perde.** O aviso não é «tentou e desistiu»:
ele fica gravado e é reentregue com espera crescente — meio minuto, dois minutos, oito, meia hora,
duas horas, seis horas. O conteúdo reenviado é **idêntico ao primeiro** (senão a assinatura mudaria
e o outro lado não conseguiria conferir). Esgotadas as tentativas, o aviso fica marcado como
**desistido**, com o motivo escrito, e **não se repete sozinho** — alguém precisa mandar reenviar.
É a mesma regra do agendamento, e pelo mesmo motivo: repetição automática sem ninguém olhando é
como um sistema manda a mesma coisa trezentas vezes.

⚠️ **Estado em 02/09/2026 (v1.10.00, no ar):** o cadastro da credencial e do destino do aviso
**já funciona**, e cada aviso **já é gravado na fila assinado**. Mas **o carteiro está desligado**:
nada sai para fora até alguém ligá-lo, e **nenhum webhook está cadastrado** na plataforma de
atendimento. Ligar é decisão do responsável pela publicação — e é assim de propósito, porque um
carteiro ligado sozinho num sistema recém-publicado despeja de uma vez tudo o que ficou para trás.

---

## 6-C. Configurações: como o atendimento se comporta

**O que faz.** Reúne num lugar só os ajustes que mudam o comportamento do atendimento da sua
empresa, em dez painéis: **Atendimento · Horários · Notificações · Agenda · Aparência · Mensagens ·
Integrações · Inteligência artificial · Sistema** e, **só para quem opera o serviço**, **Whitelabel**.

**Tudo é por empresa.** Um ajuste salvo na sua empresa vale só nela. A empresa vizinha não lê nem
escreve o seu — e isso não é «a tela não mostra»: é o servidor que decide, a partir de quem entrou.

**Quem pode mexer.** Qualquer pessoa da equipe **lê** os ajustes (o atendente precisa saber o tema,
o modo das etiquetas e se pode assinar a mensagem). **Alterar** exige perfil de administrador.

### O que cada painel guarda

| Painel | Para que serve |
|---|---|
| **Atendimento** | Saudação automática · aviso ao transferir · **histórico global ou por setor** · ignorar grupo · aceitar ligação e áudio · exigir setor ao aceitar · assinatura do atendente · botão de pausar · **carteira de clientes por contato ou por atendimento** |
| **Horários** | ⚠️ O expediente em si (dias, janelas, **almoço**, plantão que vira a madrugada, **feriado**) já tem tela própria no motor de atendimento e **não é duplicado aqui** — este painel abre aquela. |
| **Notificações** | Permitir e exibir **avaliação do atendimento** · notificação e som para conversa de grupo |
| **Agenda** | **Quem manda no expediente**: a empresa, o setor ou a conexão. É escolha sua, e não uma ordem fixa — por isso os outros níveis ficam parados em vez de brigar entre si |
| **Aparência** | Tema padrão · etiqueta com texto ou bolinha · atendimentos fechados no Kanban |
| **Mensagens** | Textos automáticos que não existiam por conexão: chamada recusada, áudio recusado, ao aceitar o atendimento e ao transferir de setor. ⚠️ Quando a conexão tiver texto próprio, **o da conexão vence** — é o mais específico |
| **Integrações** | **Servidor de e-mail próprio** da empresa (a senha é guardada cifrada e **nunca volta**) · interruptor da cobrança por Pix, cujas credenciais ficam na tela de pagamento, não aqui |
| **Inteligência artificial** | A IA que **ajuda o atendente** — resumir o atendimento e sugerir resposta. Provedor **trocável** (OpenAI, Anthropic, Google, Azure ou um servidor nosso), modelo, chave e **teto de gasto no mês**. ⚠️ **Não é** o agente que atende o cliente sozinho: aqui a pessoa continua sendo quem envia |
| **Sistema** | Correção ortográfica · política de senha forte · sessão única. ⚠️ Os dois últimos são **registro da sua política**: quem confere a senha no login é a plataforma de atendimento, não o Ragnabot |
| **Whitelabel** | ⛔ **Só da conta que vende o serviço.** Nome do sistema, cores (claro e escuro), fundos, logotipos, tela de entrada, links de política e termos, mensagens de boas-vindas/redefinição de senha/código, e os dias de teste da empresa nova |

### ⛔ Marca, Empresas e Planos são de quem vende o serviço

Por ordem do dono: **Whitelabel, Empresas e Planos não aparecem na conta de cliente** — e não é só
o menu. Uma conta de cliente que peça esses painéis **pelo endereço direto** recebe recusa do
servidor, não a lista. É proposital: quem visse a lista de empresas veria o plano, o valor, o
vencimento e o e-mail de **todos os outros clientes**.

### Segredo é segredo

Senha do servidor de e-mail e chave de IA são guardadas **cifradas**. Depois de salvas, **ninguém as
lê de volta** — nem a tela, nem o suporte, nem o registro. O que aparece é uma **impressão digital**
curta, que serve para você conferir «é a chave que eu coloquei?» sem que ela possa ser reconstruída.
Para trocar, digite a nova; deixar o campo em branco mantém a que está lá.

### Tudo o que muda fica registrado

Toda alteração vai para a auditoria com **quem**, **quando** e o **antes → depois**. Salvar o mesmo
valor de novo **não** vira registro — auditoria cheia de ruído é auditoria que ninguém lê, e a que
ninguém lê é a que não pega o dia em que mudou de verdade. Para um segredo, o registro guarda a
impressão digital antes e depois: prova que **mudou**, sem guardar o valor.

### Um aviso honesto na própria tela

Ajuste que ainda **não é lido por nenhuma parte do produto** aparece marcado como
**«guardado, ainda sem efeito»**. É de propósito: painel cheio de interruptor que não faz nada
ensina a desconfiar de todos, inclusive dos que funcionam. Hoje quase todos estão nesse estado — o
que existe é o lugar de guardar, auditado e isolado por empresa; ligar cada comportamento é a
próxima etapa de cada assunto.

### O que depende de decisão do dono

A tela lista, no próprio painel, o que está esperando resposta: **HubSoft** (só entra se for usado),
**Facebook/Instagram oficiais** (presos à análise da Meta), **provedor de API de WhatsApp** (depende
do caminho comercial escolhido) e **ligar o agente de IA que atende sozinho**.

⚠️ **Estado em 02/09/2026 (v1.10.00, no ar):** a tabela **foi criada** e a tela **está publicada**
em `/painel/configuracoes`. O que continua valendo é o aviso acima: **quase todo ajuste está
«guardado, ainda sem efeito»** — o painel guarda, audita e isola por empresa; quem ainda não lê o
ajuste é o resto do produto.

---

## 7. Protocolo e auditoria

**O que faz.** Todo atendimento tem um número humano; toda ação sensível fica registrada.

**Como funciona por dentro.** O protocolo (`RGT-0000000001`, três letras por empresa) é gerado quando
a conversa nasce, à prova de corrida (25 emissões simultâneas → 25 números únicos). A auditoria
registra acesso, atendimento, configuração e dados — com quem, quando, onde e o antes/depois.

---

## 7-A. Entrar no Ragnabot (login da tela)

**O que faz.** Quem abre a tela do Ragnabot entra com **a conta dele da plataforma de atendimento**
— o mesmo e-mail e a mesma senha do painel de conversas. Não existe senha separada.

**Como funciona por dentro.** O motor manda e-mail e senha para a plataforma (`POST /auth/sign_in`)
e é ela quem confere. A senha **não é guardada em lugar nenhum**. Da resposta saem o nome, o e-mail
e o **papel real** na conta (`administrator` ou `agent`), e daí o motor emite um **cookie de sessão
assinado**: `HttpOnly` (nenhum script da página consegue lê-lo), `SameSite=Strict`, `Secure` e
validade de no máximo **8 horas**. O papel viaja **dentro** do conteúdo assinado — não em cabeçalho.

**Segundo fator.** Se a conta tem verificação em duas etapas na plataforma, a tela pede o código de
6 dígitos do aplicativo autenticador (ou um código de recuperação). O bilhete intermediário dessa
etapa nunca chega ao navegador: nasce e morre dentro do motor.

**O que cada papel pode.** *Administrador da conta* administra os fluxos da empresa dele.
*Atendente* entra, mas com alcance de leitura do que é dele. **Nenhum dos dois** mexe em cobrança
nem cria/exclui empresa — isso é operação da Ragnatela, feita pelo NOC, e continua trancada.

### ⭐ Desde a v1.11.00: uma entrada, duas sessões

Como as telas de Conversas, Contatos e Relatórios abrem **dentro** da nossa casca (§0), a entrada
passou a devolver ao navegador **dois** cookies, com papéis diferentes:

| Cookie | De quem | Como é |
|---|---|---|
| `rb_sessao` | **nosso** | assinado, `HttpOnly`, `SameSite=Strict`, ≤ 8 h — **nada nele mudou** |
| `cw_d_session_info` | **da plataforma de atendimento** | no formato que a interface dela lê, com a validade que **ela** definiu |

O segundo é exatamente o que a plataforma gravaria se a pessoa tivesse digitado a senha na tela
dela: mesmo nome, mesmo formato, mesma validade. **Nada foi afrouxado** — o valor só existe depois
de ela ter conferido a senha (e o segundo fator, quando há). Nós não emitimos credencial nenhuma:
repassamos a que ela acabou de emitir, para a mesma pessoa, no mesmo navegador.

⚠️ Esse segundo cookie **não** é `HttpOnly`, e isso é decisão consciente, não esquecimento: é o
JavaScript da própria plataforma que o lê. Marcá-lo `HttpOnly` faria o quadro abrir deslogado — o
defeito que essa peça existe para consertar. **O nosso cookie continua `HttpOnly` e não ficou mais
fraco por causa dele.** E guardamos só as **cinco chaves** que a interface dela usa, não a resposta
inteira: cookie legível por JavaScript é o pior lugar para carregar cabeçalho que ninguém pediu.

**Se a plataforma não devolver essa credencial, a entrada acontece do mesmo jeito** — só as telas
embutidas é que pedirão login. Entrar no Ragnabot não pode falhar por causa de uma tela de terceiro.

**Sair.** Encerra a sessão na hora e apaga o cookie. Trocar de pessoa na mesma máquina recarrega a
tela, para que nenhum rascunho da pessoa anterior sobreviva.

⭐ **Desde a v1.11.00, sair sai dos DOIS lados.** O botão apaga **os dois** cookies e ainda pede à
plataforma que invalide o token (`DELETE /auth/sign_out`). Sem isso, «Sair» deixaria a sessão dela
viva no navegador até vencer sozinha — e a próxima pessoa na mesma máquina abriria uma tela embutida
**dentro da conta de quem saiu**. Nesta ordem, de propósito: primeiro apagamos os cookies (o que
sempre funciona e é o que protege a próxima pessoa), e só depois avisamos a plataforma. Se ela
estiver fora do ar, **a saída acontece igual**.

**Limite honesto.** O encerramento imediato vale na réplica que atendeu o pedido; a sessão vence
sozinha em até 8 horas de qualquer jeito. E o pedido de invalidação à plataforma é **melhor
esforço**: ele não é esperado, e uma falha ali não devolve erro para quem só quis sair.

---

## 8. Infraestrutura

**O que faz.** Mantém a plataforma de pé mesmo perdendo uma máquina.

**Como funciona por dentro.** Kubernetes de 3 nós (1 por hipervisor); banco com **troca automática
de líder** (Patroni + etcd, 3 votos, `failsafe_mode`); fila com Redis Sentinel (quórum 2 de 3);
anexos em MinIO próprio (6 discos, paridade 3 — um hipervisor pode cair e continua gravando). Regra
de ouro: **cada peça redundante entre hipervisores diferentes**. Detalhe completo em
`deploy/LEIA-ME.md` e `docs/30-INFRAESTRUTURA-RAGNABOT.md`.

> ⚠️ **O líder do banco muda.** Nenhum código pode supor qual é — descobre a cada vez com
> `SELECT NOT pg_is_in_recovery()`. E **nunca** `prisma db push`/`migrate dev` no repositório do NOC
> (apaga em silêncio as chaves compostas que isolam empresas).

---

## 9. Backup e recuperação

**O que faz.** Guarda uma cópia fria do banco, imune a apagar por engano ou ransomware.

**Como funciona por dentro.** Uma vez por dia, o NOC descobre o líder do cluster, roda `pg_dump` nele
e envia para bucket com **Object Lock** (nem o administrador apaga). A recriação do zero está em 8
passos no `deploy/LEIA-ME.md`.

---

<!-- MODELO DE NOVA SEÇÃO (uma por função nova; entra junto com a versão em VERSOES.md):

## N. <Nome da função>
**O que faz.** ...
**Como o operador usa.** ...
**Como funciona por dentro.** ...
-->
