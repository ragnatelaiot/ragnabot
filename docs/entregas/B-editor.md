# B-EDITOR — Lista, Botões e E-mail na tela do editor de fluxo

> Entrega de 29/08/2026 · código em `/ia/netagent` · **não** commitado, **não** versionado no repo
> do Ragnabot (bump de `VERSAO`/`VERSOES.md`/`MANUAL.md` é decisão do chefe).
> Arquivos tocados: `frontend/src/pages/FluxosRagnabot.jsx` e `frontend/tests/fluxos-ragnabot.test.jsx`.

---

## 1. O que mudou, em uma frase

Os blocos **Lista** e **Botões** ganharam os campos que faltavam (cabeçalho, seções, tipo de botão),
os limites do WhatsApp passaram a aparecer **enquanto o operador digita** — e entrou um bloco novo
na paleta: **E-mail**.

---

## 2. Bloco **Lista**

### O que o operador vê agora

| Campo | O que é | Limite mostrado |
|---|---|---|
| **Cabeçalho** *(novo, opcional)* | texto curto que sai **em negrito** acima do corpo | 60 |
| Texto acima da lista | o corpo da mensagem | 1024 |
| Rodapé | linha discreta no pé | 60 |
| Rótulo do botão que abre a lista | o botão que o cliente toca para ver as opções | 20 |
| **Seção** *(novo, por item)* | agrupa itens sob um título | — |
| Título do item | o que o cliente lê na opção | 24 |
| Descrição do item | a linha menor abaixo do título | 72 |

- **Itens: no máximo 10, somando TODAS as seções.** O título da lista mostra `7/10`, e o botão
  «Acrescentar» **desabilita** no décimo. Acima disso o motor descarta os itens que sobram — e o
  cliente escolhe entre opções que o fluxo nem previu.
- **Seções: no máximo 10.**
- Itens **sem seção aparecem soltos no topo**, antes de qualquer título de seção. É assim que o
  canal desenha, e é assim que o resumo mostra.

### O quadro «Como o cliente vai ver a lista»
Aparece assim que a primeira seção é nomeada, listando cada grupo e os itens dentro dele. Existe por
um motivo bem específico: **seção é campo por ITEM e o efeito dele é na LISTA inteira**. Sem esse
resumo, quem digitasse `Suporte ` com espaço no fim só descobriria o erro quando o cliente visse
duas seções com o mesmo nome na tela do WhatsApp. O campo **Seção** também sugere as seções já
digitadas (autocompletar), pelo mesmo motivo.

### O que **não** muda
Mexer na seção **não mexe em saída nenhuma** do desenho — ela só agrupa na tela do cliente. Quem
cria e destrói saída continua sendo o **identificador** do item (e renomear identificador continua
órfãos a aresta, com o mesmo aviso de sempre).

---

## 3. Bloco **Botões** — a escolha «resposta OU link»

### A regra
No WhatsApp, **botão de resposta e botão de link não convivem na mesma mensagem**. Se forem
misturados, a Meta **recusa a mensagem inteira**: o cliente não recebe nem os botões, nem o texto.
Não é degradação — é silêncio.

### Por que a escolha é do BLOCO, e não de cada botão
Porque validar depois já é tarde para o operador. Se o formulário deixasse marcar o tipo botão a
botão, ele passaria dez minutos montando três respostas e um link — e só então levaria um "não pode".
O tempo dele já teria sido gasto construindo o que nunca ia sair.

Então, logo acima da lista de botões, há **duas opções, e só uma pode estar ativa**:

- **Botões de resposta** — até **3**. O cliente toca, a resposta volta e o fluxo segue pela saída
  daquele botão.
- **Botão de link** — **1** só. Abre um endereço no navegador.

Trocar a opção **converte todos os botões de uma vez**. O formulário passa a oferecer só o que
aquele tipo aceita: **o campo «Endereço que o botão abre» simplesmente não existe no modo resposta.**
A mistura não é montável pelo formulário.

### O que ainda pode dar errado (e como a tela avisa)
| Situação | O que aparece |
|---|---|
| 4+ botões de resposta | erro: `4 botões de resposta — o teto é 3`, com a sugestão de usar o bloco **Lista** (até 10) |
| 2+ botões de link | erro: `2 botões de link — o canal aceita 1` |
| Mistura vinda do **editor de JSON cru** (aba Avançado) | erro `Esta mensagem tem os dois tipos ao mesmo tempo` + botão **«Converter tudo para resposta»** (que também remove a `url` pendurada — botão de resposta com `url` é a mistura outra vez, disfarçada) |

A tela **converte, mas nunca apaga botão em silêncio**: passar de 2 respostas para link deixa os 2
botões e reclama do excesso, em vez de o operador voltar no dia seguinte e achar que a tela comeu o
trabalho dele.

### ⚠️ Botão de link não devolve resposta
Está escrito no próprio campo: o cliente sai para o navegador e **não volta com nada**. A saída
daquele botão no desenho **não chega a ser percorrida** — quem recebe a conversa depois é a exceção
**«sem resposta»**. Ligue essa exceção a algum lugar.

*(Ponto em aberto para o motor: hoje a saída do botão de link continua sendo desenhada como saída
normal, e por isso ela pede uma aresta. Ver §7.)*

---

## 4. Bloco **E-mail** (novo na paleta)

Entre «Notificar» e «Sub-fluxo». Sigla **EM**, família externo, saídas `segue` e `erro interno`.

| Campo | Obrigatório | Observação |
|---|---|---|
| **Para** | **sim** | vários endereços separados por vírgula |
| **Assunto** | **sim** | |
| **Corpo** | **sim** | |
| Responder para | não | para onde vai a resposta de quem receber |
| Cópia oculta | não | os outros destinatários não veem |

Todos aceitam variáveis.

Os três obrigatórios nascem **vazios de propósito** — assunto de exemplo é assunto que chega ao
cliente — e cada um tem a sua própria faixa vermelha, que some sozinha quando o campo é preenchido.
Preencher um **não cala os outros dois**.

Este bloco **não fala com o cliente pelo canal**: manda um e-mail pelo SMTP da empresa. Se o SMTP
não estiver configurado, o envio falha e a conversa segue pela saída **«erro interno»** — ligue essa
saída a algum lugar.

---

## 5. Contador de caracteres — orientação, não veredito

Até agora a tela **não contava caractere de propósito**, e o motivo era bom: contagem escrita na tela
vira uma segunda verdade que diverge do motor em algumas semanas. O que mudou é o preço do silêncio —
o operador escrevia um título de 40 caracteres, salvava, publicava, e **só descobria o corte quando
o cliente recebia a mensagem picada**. Régua que só aparece depois do erro não é régua, é laudo.

Como ficou:
- O contador vive **colado ao nome do campo** (`Cabeçalho 22/60`), fica **amarelo** perto do teto e
  **vermelho com «— o canal corta»** quando passa.
- Os números são **cópia** de `LIMITES.valores` do motor (`ragnabot-fluxo-nos.service.js`).
- A contagem mostrada é o **pior caso** entre grafemas, pontos de código e unidades UTF-16 — porque
  ninguém mediu em qual dessas unidades a Meta conta, e é o único número que nunca diz «cabe» para
  algo que não cabe. (`Sim! Abra o chamado! ✅ ` dá 23, 24 e 26 para o mesmo teto de 24.)
- **Quem dá o veredito continua sendo o motor**, na aba **Prévia** e no modo de teste. A régua da
  tela erra para o lado seguro: um campo que ela aprova ainda pode ser cortado pelo motor; o
  contrário é que não pode acontecer.

---

## 6. Variáveis à vista

Todo formulário de Lista, Botões e E-mail abre com o quadro **«Variáveis que valem nos textos deste
bloco»**: `{{firstName}}`, `{{ticket_id}}`, `{{protocolo}}` — mais as que **este fluxo** declarou.
Antes o operador tinha de adivinhar o nome exato, e `{{primeiroNome}}` (que não existe) **saía como
texto vazio na cara do cliente**, sem ninguém perceber até alguém reclamar. O quadro diz isso com
todas as letras e aponta a aba Prévia, que lista quais variáveis ficaram sem valor.

---

## 7. Compatibilidade e pontos em aberto

**Fluxo publicado antes destes campos abre normal.** Campo ausente vira **string vazia**, nunca
`undefined` (que trocaria o input por não-controlado no meio da digitação e comeria a primeira
tecla). Botão sem `tipo` é lido como **resposta**, sem acusar mistura. E **abrir um bloco antigo não
é edição**: nenhuma gravação é disparada, o rascunho continua limpo. Há teste para os dois casos.

**Bloco que a tela conhece e o motor daquele servidor ainda não:** a aba Conteúdo abre com o aviso
*«O motor deste servidor ainda não conhece o bloco X — a publicação vai recusar com
TIPO_DE_NO_DESCONHECIDO»*. Isso vale hoje para o **E-mail**, enquanto o executor não subir no motor.

**Em aberto, para o motor decidir:**
1. **Saída do botão de link.** Ela nunca é percorrida (o cliente não responde), mas continua sendo
   desenhada como saída normal e por isso pede uma aresta. A tela **não mudou** essa derivação de
   propósito — se ela filtrasse e o motor não, ou o contrário, nasceria aresta fantasma.
2. **Formato de `para` / `copiaOculta` no bloco E-mail.** A tela grava **texto** (vários endereços
   separados por vírgula), como o contrato escreveu. Se o executor esperar lista, é um ajuste de uma
   linha em cada campo.
