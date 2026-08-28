# Ragnabot — guia de frontend
### Sistema visual, mapa de aplicação sobre o Chatwoot e as provas de cada decisão

> **Estado: PARA REVISÃO DO NOC. Nada aqui foi publicado.**
> Produzido em 28/08/2026 pelo agente `site-ragnatela`.
> Aprovação do conteúdo publicado é do dono (delegada ao NOC nesta entrega).

---

## 0. O que este pacote é — e por que ele existe

A versão anterior do tema foi reprovada pelo dono com estas palavras: *"péssima, totalmente
amadora"*. A reprovação estava certa, e o motivo é verificável — não é gosto:

| o que a versão no ar faz | por que é defeito |
|---|---|
| usa a paleta `#055508` / `#2CC54E` / `#04150B` | **não é a paleta do produto.** A aprovada é a do site e da Área do Cliente: fundo `#03151f`, ação `#2ee879` (`96-IDENTIDADE-PAINEL-CLIENTE` §2). Lado a lado com o painel, lê-se como outra empresa |
| cartão de vidro (`rgba` + `backdrop-filter`) | proibido onde há texto (96 §3.2 e §7.2): o contraste final depende do que estiver atrás e **ninguém consegue afirmar o resultado lendo a regra** |
| aurora animada + malha de hexágonos | decoração que o site não tem, animada para sempre, inclusive em celular fraco, numa tela de oito segundos (96 §7.1) |
| formulário centralizado sobre gradiente | é literalmente o que o dono chamou de genérico. O padrão da casa é **duas colunas com chão fotográfico** |
| briga classe a classe com `!important` | desnecessário: o Chatwoot monta as superfícies por **variáveis CSS**. Ver §5 |

**A régua desta entrega:** cada decisão abaixo tem um número medido ou uma linha de especificação
já aprovada por trás. Onde eu não consegui verificar, está escrito que não consegui.

---

## 1. A decisão que governa tudo: uma paleta, duas densidades

O Ragnabot é dois produtos numa casca só:

| tela | quem usa | por quanto tempo | o que otimiza |
|---|---|---|---|
| entrada, painel, configurações | administrador, gestor | minutos | **reconhecimento** |
| caixa de entrada | atendente | o expediente inteiro | **densidade** |

A tentação é dar uma cara a cada uma. **É o erro**: o produto passaria a parecer dois.
A solução é a mesma que a casa já usa entre o painel (96) e o NOC (97) — o que muda entre eles
**não é a matiz, é a escala**.

```css
.rb-app            /* apresentação: linha 44px, respiro 22px */
.rb-app.rb-denso   /* operação:     linha 36px, respiro 16px */
```

⚠️ **A fonte não encolhe entre as duas.** Densidade se ganha no espaçamento. Apertar texto é
como se perde legibilidade fingindo que se ganhou espaço.

---

## 2. Paleta — e o par medido de cada uso

Todos os valores vêm de `96-IDENTIDADE-PAINEL-CLIENTE.md` §2, que é a especificação **aprovada
pelo dono em 23/08/2026**. O prefixo muda (`--pnl-` → `--rb-`); os valores, não.

| token | valor | uso | contraste medido |
|---|---|---|---|
| `--rb-bg` | `#03151f` | fundo da aplicação | título 17,80:1 |
| `--rb-lateral` | `#061e29` | trilho e navegação | título 16,42:1 |
| `--rb-surface` | `#082532` | cartão | título 15,23:1 · corpo 9,93:1 · apoio 6,49:1 |
| `--rb-surface-alt` | `#0d2f3f` | campo, linha alternada | título 13,46:1 |
| `--rb-heading` | `#f5fbff` | título | — |
| `--rb-text` | `#bad0d9` | corpo | — |
| `--rb-muted` | `#8faab4` | rótulo, hora, eixo | 6,49:1 no cartão |
| `--rb-green` | `#2ee879` | ação e “resolvido” | 9,79:1 no cartão |
| `--rb-on-green` | `#03151f` | **texto sobre o verde** | **11,44:1** |
| `--rb-cyan` | `#37dff7` | foco por teclado | 9,89:1 |
| `--rb-erro` / `--rb-aviso` / `--rb-ok` | `#ff8a8a` / `#ffc46b` / `#7cf0a8` | estado | 7,01 / 10,11 / 11,27:1 |

> ⛔ **Branco sobre o verde dá 1,62:1.** É o defeito mais fácil de cometer neste sistema, porque
> o Chatwoot põe texto branco sobre o azul dele — trocar só o fundo produz um botão ilegível em
> todo o produto. Por isso a regra do `.bg-n-brand` **força a cor do texto junto** (§5).

**Duas bordas, dois papéis.** `--rb-borda` (`.26`) agrupa — é o contorno do cartão, e cartão é
agrupamento. `--rb-borda-campo` (`.46`) **identifica um controle**, e a WCAG 1.4.11 cobra 3:1
disso: mede 3,73:1 contra o cartão e 3,29:1 contra o próprio preenchimento. Um token só servindo
aos dois falharia justamente no que importa.

**A prova:** `_prova/medir-contraste.py` — 60 pares, todos medidos com o fundo e o texto
**escolhidos juntos**. Saída atual: `TODOS OS PARES PASSARAM`.

---

## 3. Tipografia

| elemento | tamanho | peso | família |
|---|---|---|---|
| frase da foto (entrada) | `clamp(26px, 2.7vw, 38px)` | 700 | Poppins |
| título de cartão / h1 | 28 px | 700 | Poppins |
| título de seção | 17 px | 700 | Poppins |
| corpo | 14 px | 400 | Open Sans |
| **campo de formulário** | **16 px** | 400 | Open Sans |
| rótulo, eixo, hora | 11–13 px | 600/700 | Open Sans |
| número de indicador | 32 px | 700 | Poppins, `tabular-nums` |

⚠️ **16 px em campo é piso, não escolha.** Abaixo disso o iOS dá zoom ao focar e desloca a tela —
o pior defeito possível numa tela de entrada, e o que mais se esquece.

As duas famílias são **auto-hospedadas** (`assets/fontes/`, `font-display: swap`). Nada de CDN:
fonte de terceiro vaza o IP do visitante e atrasa a pintura, e este é o produto de uma empresa
que vende privacidade.

---

## 4. Componentes — e a regra que vale para todos

> **Todo estado carrega três coisas: a cor-sinal, o par fundo+texto medido, e a FORMA**
> (um ícone e a palavra escrita). É a regra de severidade do NOC (97 §3), aplicada aqui.
> **Nunca só a cor**: cerca de 1 em 12 homens tem alguma deficiência de visão de cor, e
> vermelho × verde é o eixo mais afetado — que é exatamente a diferença entre
> “Estourado” e “No prazo”.

### 4.1 Selos de canal
Cada canal tem uma cor-sinal (o ponto/ícone) e um par próprio de fundo+texto:

| canal | sinal | fundo do selo | texto | contraste |
|---|---|---|---|---|
| WhatsApp | `#25d366` | `#0d3d24` | `#c6f5d8` | 10,21:1 |
| Instagram | `#e15aa8` | `#4a1636` | `#ffd4ec` | 10,88:1 |
| Messenger | `#4aa8ff` | `#123049` | `#cfe6ff` | 10,63:1 |
| Telegram | `#37dff7` | `#0d3444` | `#c9eef8` | 10,72:1 |
| E-mail | `#ffc46b` | `#4a3608` | `#ffe7bd` | 9,56:1 |
| Chat do site | `#b8a3ff` | `#2c2450` | `#ded4ff` | 10,15:1 |

> ⚠️ **Estas cores NUNCA viram escala de gráfico.** Elas são identidade, e identidade em gráfico
> é a decisão errada quando o trabalho do gráfico é **comparar magnitude** — que é o caso de
> “volume por canal”. Ali a forma certa é **barra com rampa de uma matiz só**, com o canal
> identificado pelo ícone e pelo nome. Validei a tentativa oposta: como paleta categórica, o par
> ciano↔azul reprova o piso de visão normal (ΔE 9,9 contra o mínimo de 15). A forma certa
> dissolve o problema em vez de contorná-lo.

### 4.2 Botões
Altura 38 px (44 px onde há toque, via `@media (pointer:coarse)`). Quatro variantes:
`--pri` (verde, texto escuro) · padrão · `--fant` · `--perigo`.
Carregando mantém o **verde a 70%** com `aria-busy` — nunca vira cinza: cinza é
“não dá para clicar”, não “estou trabalhando”.

### 4.3 A nota interna — quatro sinais somados
É o estado que **não pode** ser confundido, porque errar significa mandar para o cliente um texto
que era da equipe. Ela se anuncia por:
1. a **aba** em âmbar; 2. a **faixa** lateral no campo; 3. o **campo tingido**;
4. a **frase escrita**: *“Isto fica só para a equipe. A cliente não recebe e não vê esta mensagem.”*

No fio da conversa a nota tem fundo âmbar, **borda tracejada** (forma, não só cor), ícone e o
rótulo *“Nota interna — o cliente não vê”*.

### 4.4 Ícones
53 símbolos de traço 1,7 px em `assets/_icones.svg`, herdando `currentColor`, em quatro tamanhos.

> ⛔ **Emoji nunca é ícone de interface** (96 §7.6): desenha diferente em cada sistema, não herda
> cor, e o leitor de tela lê o nome do emoji no meio da frase.

---

## 5. O mapa de aplicação sobre o Chatwoot

### 5.1 A descoberta que mudou a abordagem
O Chatwoot 4.17.1 pinta **todas as superfícies** com variáveis CSS em canais RGB, no padrão
Radix de 12 degraus:

```css
.bg-n-slate-3{ background-color: rgb(var(--slate-3) / var(--tw-bg-opacity,1)) }
```

**Redefinindo `--slate-1..12`, o aplicativo inteiro se reveste** — inclusive telas que nunca
abrimos. É por isso que o `tema.css` desta entrega cobre mais e é mais curto que o do ar, que
tentava vencer classe a classe.

O mapeamento (em `:root` e `.dark`, com os mesmos valores):

| degrau | valor | papel |
|---|---|---|
| `--slate-1` | `3 21 31` | fundo da aplicação |
| `--slate-2` | `6 30 41` | navegação |
| `--slate-3` | `8 37 50` | cartão |
| `--slate-4` | `13 47 63` | campo |
| `--slate-5` | `18 57 75` | elevado |
| `--slate-6..8` | `24 68 88` → `45 105 128` | bordas |
| `--slate-9..10` | `106 133 145` → `143 170 180` | ícone e apoio |
| `--slate-11` | `186 208 217` | corpo |
| `--slate-12` | `245 251 255` | título |

Mais `--solid-1..3`, `--alpha-1..3`, e as famílias de estado: `--teal-*` (passa a ser o **nosso**
verde, porque é o “resolvido” do Chatwoot), `--amber-*` e `--ruby-*`.

### 5.2 A marca — a única cor que não é variável
`.bg-n-brand` e família estão **fixas no código** (`#2781f6`). Aqui não há variável: só o
seletor. O arquivo cobre as 10 classes base (`bg`, `text`, `border`, `ring`, `outline`, as
frações `/5 /10 /20 /50` e `from-n-brand/15`) e os modificadores gerados
(`hover:`, `dark:`, `checked:`, `focus-visible:`…).

### 5.3 A tela de entrada
Ativa só com `body:has(input[type="password"])` — entrada e redefinição de senha. Depois de
entrar, o seletor deixa de casar e o aplicativo volta ao normal.

⚠️ **Os seletores saíram da árvore RENDERIZADA, não de suposição.** A primeira versão que escrevi
estilizou o `<form>`, que parecia ser o cartão. **Não é.** A árvore real:

```
#app > div.min-h-screen > main.min-h-screen
   ├─ section.max-w-5xl        (logomarca + "Entrar no Ragnabot")
   └─ section.bg-white.shadow  ← o cartão   >  div  >  form
```

Estilizar o `form` produziu um cartão escuro **dentro de uma caixa branca**, e os dois
`min-h-screen` (100vh cada) empilharam 200vh e cortaram a frase da foto. Os dois defeitos só
apareceram **olhando a captura** — nenhuma leitura de CSS os denunciaria.

### 5.4 Como publicar
O gancho **já existe**: a página serve `/tema-ragnabot.css`, injetado pelo proxy. Basta
substituir o conteúdo desse arquivo pelo `tema.css` desta pasta. Não exige rebuild da imagem,
sobrevive a upgrade do Chatwoot e é reversível em segundos.

**Por isso o arquivo é autocontido:** as três imagens (foto do monitor, faixa do celular e
logomarca) vão como **data URI**, declaradas como token e usadas por referência — a logomarca é
usada duas vezes e repetir os dados dela dobrava o peso à toa. Total: **72 KB**, sem nenhuma
requisição externa.

### 5.5 O que este tema **não** resolve, e é honesto dizer
- **Só medi a tela de entrada no produto real.** Não tenho credencial para entrar, e não deveria
  ter. As telas internas foram tratadas pela via segura — a escala de variáveis (§5.1) —, que é
  ampla, mas **não é o mesmo que ter olhado**. Antes de publicar, alguém com acesso precisa
  percorrer caixa de entrada, contatos, relatórios e configurações **com o tema aplicado** e
  reportar o que destoar. É a Lei do Olhar, e ela não tem atalho.
- **A frase da coluna da foto é escrita por `content:` no CSS**, porque não há DOM onde pendurá-la.
  Funciona e é decorativa, mas não é selecionável nem ideal para leitor de tela. **A correção
  certa** é uma linha de `sub_filter` no nginx injetando um `<div>` logo após `<body>` — aí a
  frase vira HTML de verdade. Recomendo fazer assim quando houver oportunidade.
- **Tema claro não existe** e não deve nascer invertendo o escuro. Se for pedido, nasce como par
  completo — fundo **e** texto de cada componente (97 §1.1).

---

## 6. As cinco telas entregues

| arquivo | o que demonstra |
|---|---|
| `login.html` | a entrada no padrão da casa: duas colunas, foto real, cartão sólido |
| `dashboard.html` | painel do administrador: 6 indicadores, série por hora, volume por canal, filas, prazo, equipe |
| `conversas.html` | caixa de entrada em três painéis, com a nota interna inconfundível |
| `configuracoes.html` | canais conectados, formulário completo e **todos os estados de campo** |
| `menus.html` | a árvore de navegação, os três leiautes do trilho e o mostruário de componentes |

**Todas carregam o aviso de que os dados são de demonstração.** Um protótipo com números que
parecem reais é um protótipo que vira print fora de contexto.

### 6.1 As formas escolhidas no painel, e por quê
| dado | forma | por quê |
|---|---|---|
| valor atual + tendência | **azulejo de indicador** (número + variação + mini-série) | um gráfico de uma barra só seria pior |
| conversas por hora | **linha com ênfase**: hoje em verde cheio, média em cinza tracejado | “uma série é o assunto, o resto é contexto” — categórico enterraria o ponto |
| volume por canal | **barra horizontal, rampa de uma matiz** | o trabalho é comparar magnitude, não distinguir identidade |
| prazo de resposta | **medidor** | é uma razão contra um limite |
| equipe e filas | **tabela** | mais de 7 classes com significado próprio pedem tabela, não mais cores |

A camada de leitura (dica ao passar o ponteiro) é feita com `<title>` **dentro do SVG** — dica
nativa, sem uma linha de JavaScript.

---

## 7. Responsividade — o que encolhe primeiro, e por quê

A ordem de sacrifício é decidida, não acidental:

| largura | o que acontece |
|---|---|
| ≤ 1280 px | some o **painel do contato** (é consulta, não trabalho) |
| ≤ 1200 px | as ações secundárias da conversa viram **só ícone** (o rótulo custava uma segunda linha, e cada linha ali sai do fio da conversa) |
| ≤ 1080 px | a grade principal do painel vira uma coluna |
| ≤ 900 px | o **trilho desce para o pé da tela** — a mão alcança o pé com o polegar, o topo não |
| ≤ 560 px | tudo em uma coluna |

**Na caixa de entrada, quem rola é cada painel — nunca a página** (`.rb-app--tela`).
No celular isso se inverte de propósito: `100vh` briga com a barra de endereços e com o teclado
virtual, e o campo de texto acabaria escondido embaixo deles.

---

## 8. As armadilhas que morderam nesta entrega — registradas para não voltarem

1. **`1fr` não é `minmax(0,1fr)`.** Item de grade nasce com `min-width:auto` e **se recusa a
   encolher abaixo do conteúdo**. Uma tabela larga empurrou a página inteira: rolagem horizontal
   de 538 px medida em 360 px de largura. A cura é `min(100%, X)` nas trilhas e `min-width:0`
   nos filhos.
2. **`min-height:0` em cada nível, até a coluna.** Sem isso a rolagem interna dos painéis nunca
   entra em ação e o corpo inteiro é que estica — as colunas terminam em alturas diferentes no
   meio da tela.
3. **A seta e a cor são duas informações.** “Aguardando resposta +9” saía com seta para **baixo**
   porque era ruim — ou seja, a arte dizia o contrário do que aconteceu. Direção do número e
   juízo sobre ele são argumentos separados.
4. **Véu pesado demais não é “seguro”: mata a foto.** O primeiro véu media 13,18:1 e transformava a
   imagem num borrão. O véu final é bem mais leve e ainda entrega 8,33:1 no pior bloco, contra um
   piso de 3:1 para aquele tamanho de texto. `_prova/buscar-veu.py` procura o **mais leve que
   ainda passa**.
5. **Estilizei o elemento errado no Chatwoot** (§5.3) — cartão escuro dentro de caixa branca.
6. **`file://` mente na auditoria.** Sob `file://` o Chromium trata cada arquivo como origem
   opaca, não consegue ler as regras da folha externa e acusa `classe-sem-estilo` para **todas**
   as classes. Falso positivo que esconderia um defeito real. Por isso `_prova/olhar.sh` serve
   por HTTP.
7. **A foto gerada trazia marca de terceiro e texto em inglês** (`plantronics`, `STATION 14 /
   PORT C`). As duas coisas são proibidas. Tentei reparar e o remendo ficou pior que o defeito —
   **regerar saiu mais barato e melhor que consertar**.
8. **Hairpin NAT.** `curl` ao domínio público devolveu `000` com o serviço no ar. Só com
   `--resolve` para o endereço interno do proxy (`172.20.11.2`) a página respondeu 200.

---

## 9. Como verificar esta entrega

```bash
cd /ia/ragnabot-frontend-v2
python3 -m http.server 8899 --bind 127.0.0.1 &      # a auditoria precisa de HTTP, não file://

_prova/olhar.sh login.html                          # 360 · 390 · 768 · 1024 · 1440
_prova/olhar.sh dashboard.html
_prova/olhar.sh conversas.html
_prova/olhar.sh configuracoes.html
_prova/olhar.sh menus.html

python3 _prova/medir-contraste.py                   # 60 pares, fundo e texto medidos juntos
python3 _prova/medir-login.py                       # o véu da foto, por região do texto
```

Os geradores (`_prova/gerar-*.py`) reconstroem cada página. **Edite o gerador, não o HTML** —
senão a próxima geração apaga a correção.

⚠️ **Um aviso conhecido e benigno:** em `conversas.html` a 1024 px o auditor acusa
`texto-cortado` em `main.rb-corpo`. Não é defeito: é a caixa de entrada rolando **por dentro**,
como deve. Provado com o documento em `scrollWidth − innerWidth = 0` e
`scrollHeight − innerHeight = 0`, com os dois painéis rolando internamente. A heurística não
distingue “texto cortado” de “contêiner de rolagem interna”.

---

## 10. O que fica pendente para o NOC

1. **Percorrer as telas internas com o tema aplicado** (§5.5) — é o furo real desta entrega.
2. **Decidir sobre a injeção do `<div>` da frase** por `sub_filter` (§5.5), que troca texto de
   CSS por HTML de verdade.
3. **Servir as fontes** (`assets/fontes/`) pelo proxy, se quiserem Poppins também dentro do
   aplicativo. Hoje o `tema.css` não embute fonte de propósito: são +60 KB num arquivo que
   bloqueia a pintura, e o Chatwoot já traz uma família próxima.
4. **Favicon e ícone de aplicativo**: `assets/marca/icone-marca-{180,192,512}.png` estão prontos;
   trocar os do Chatwoot é passo de servidor, não de CSS.
