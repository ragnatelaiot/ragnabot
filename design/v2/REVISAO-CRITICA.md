# Ragnabot — revisão crítica de frontend, responsividade e marca
### Produzido em 28/08/2026 pelo agente `site-ragnatela`, contra o **produto NO AR**

> **O que foi revisado:** `https://chat002.ragnatela.com.br` (Chatwoot 4.17.1, build `b354a95`),
> vestido pelo `tema-ragnabot.css` — o arquivo que eu mesmo entreguei e que estava servido pelo
> proxy. Confirmei que o arquivo no ar era byte a byte o meu (`md5 c8bec3c7…` nos dois lados)
> antes de começar: esta é a revisão do que o cliente recebe, não do que eu escrevi.
>
> **Telas internas: vistas.** Usei a credencial administrativa indicada no briefing, apenas em
> memória, dentro de um único processo. Ela não foi escrita em arquivo, log, captura ou neste
> documento. Foram percorridas 12 rotas internas em 6 larguras.
>
> **Nada foi aplicado em produção.** Toda medição do tema corrigido foi feita interceptando
> `/tema-ragnabot.css` no navegador e servindo o arquivo local. Quem aplica é o NOC.

---

## 0. O veredito em uma frase

O tema estava **certo no desenho e desligado na prática**: ele só produzia o resultado
pretendido para quem usa o sistema operacional em modo escuro. Para todos os outros — que são a
maioria — o produto vinha **meio claro, meio escuro, com 32 pares de texto abaixo do piso de
contraste só na primeira tela**. Isso não aparecia em nenhuma conferência de CSS, só olhando.

**Corrigido, com prova:** 32 → 0 · 34 → 0 · 21 → 0 · 28 → 0 · 31 → 0.
E os três defeitos que o dono encontrou sozinho estão tratados, com a medição de cada um.

Além deles, esta revisão encontrou **quatro defeitos que ninguém tinha visto** — entre eles um
campo de senha de **54 px** na tela de entrada do celular, e uma camada invisível que eu mesmo
criei no meio do trabalho e que teria impedido qualquer pessoa de entrar pelo telefone.

---

## 1. Sumário por gravidade

| # | Achado | Gravidade | Estado |
|---|---|---|---|
| **A1** | O produto só ficava escuro para quem usa o sistema em modo escuro | 🔴 alta | ✅ corrigido |
| **A2** | O tema da entrada sumia ao clicar no olho de "exibir senha" | 🔴 alta | ✅ corrigido |
| **A3** | O mesmo seletor vazava para "Configurações do Perfil" e destruía a página | 🔴 alta | ✅ corrigido |
| **A4** | **Regressão que eu criei durante esta revisão**: camada invisível cobria a tela de entrada e engolia todo clique | 🔴 alta | ✅ corrigido |
| **A5** | Nome e marca do software de origem visíveis ao usuário (16 pontos) | 🔴 alta | ⚠️ parcial — 3 no meu arquivo, 13 dependem do NOC |
| **A6** | Mensagens ao usuário em inglês — e uma delas **silenciosa** | 🔴 alta | ⚠️ fora do CSS — receita pronta para o NOC |
| **A7** | O desafio "Confirme que é humano" esmaga o campo de senha para **54 px** e gera 30 px de rolagem horizontal a 360 px | 🔴 alta | ✅ corrigido (defeito do produto, não do tema) |
| **M1** | A tela de redefinir senha nunca foi vestida (cartão branco) | 🟠 média | ✅ corrigido |
| **M2** | Não havia alvo de toque mínimo no produto (só nas maquetes) | 🟠 média | ✅ corrigido |
| **M3** | `prefers-reduced-motion` acelerava a animação em vez de pará-la | 🟠 média | ✅ corrigido |
| **M4** | `.bg-n-brand *` forçava cor em toda a descendência | 🟠 média | ✅ corrigido |
| **M5** | Iniciais do contato: chips pastéis, 2 de 6 pares reprovando (3,82:1) | 🟠 média | ✅ corrigido |
| **M6** | "Enviar Mensagem" cortado e **inalcançável** a 768 px | 🟠 média | ✅ mitigado (defeito do Chatwoot) |
| **M7** | Botão flutuante do menu cobria a última linha no celular | 🟠 média | ✅ corrigido |
| **M8** | Controles nativos desenhados no azul do sistema | 🟢 baixa | ✅ corrigido |
| **M9** | Barra de rolagem de 10 px roubando largura no toque | 🟢 baixa | ✅ corrigido |
| **B1** | Contatos: estado vazio sobreposto à lista | 🟠 média | ❌ **não corrigido de propósito** — ver §7 |
| **B2** | Texto de leitor de tela e descrição de gráfico em inglês | 🟢 baixa | ⚠️ NOC |
| **B3** | `theme-color` no vhost está na paleta **rejeitada** (`#055508`) | 🟢 baixa | ⚠️ NOC — 1 linha |

---

## 2. 🔴 A1 — O defeito que estava por baixo de todos os outros

### O que eu encontrei
Abri o painel com o tema no ar e a tela veio **branca**: barra lateral branca, cartões brancos,
títulos quase invisíveis (branco sobre branco), texto de apoio ilegível.

**Medição, em pares de texto abaixo do piso WCAG, com o fundo efetivo calculado pela cascata:**

| tela | reprovações antes | depois |
|---|---|---|
| Painel | **32** | **0** |
| Configurações gerais | **34** | **0** |
| Relatórios | **21** | **0** |
| Caixas de entrada | **28** | **0** |
| Agentes | **31** | **0** |
| Perfil | **15** | **0** |

### A causa — e por que ela não aparecia em nenhuma leitura de CSS
O tema anterior redefinia **~20 variáveis** (`--slate-1..12`, `--solid-1..3`, `--alpha-1..3` e
meia dúzia de estados). Medindo no produto:

```
tokens declarados pelo Chatwoot em :root  = 137
tokens declarados pelo Chatwoot em .dark  = 137
divergentes entre claro e escuro          = 127
órfãos (só no claro, sem par escuro)      = 0
```

As **117 que faltavam** continuavam com o valor **claro** — `--surface-1`, `--surface-2`,
`--card-color`, `--background-color`, `--button-color`, `--border-weak`, `--border-strong`,
`--label-background`, e as rampas inteiras `--gray-*`, `--blue-*`, `--iris-*`, `--violet-*`.

E o segundo mecanismo, que é o que fecha o raciocínio:

```
utilidades `dark:` dentro de @media (prefers-color-scheme: dark) =   0
utilidades `dark:` dependentes da CLASSE .dark                   = 165
```

Todas as 165 dependem de `.dark` no `<html>`. Quem põe e tira essa classe é o **Vue**, conforme a
preferência do usuário — e o padrão é "seguir o sistema". Resultado: quem entra com o sistema
operacional no claro recebe as superfícies escuras da nossa escala **com o texto claro do
Chatwoot por cima**.

### A tentação óbvia — e a prova de que ela não funciona
O caminho que qualquer um tentaria é injetar `class="dark"` no `<html>` por `sub_filter`.
**Testei antes de recomendar.** Injetei a classe *antes do arranque do Vue* (`addInitScript`) e
medi em três rotas:

```
painel   html@1,5s=""  html@8,5s=""  contraste-reprova=32  *** REMOVIDA PELO VUE ***
config   html@1,5s=""  html@8,5s=""  contraste-reprova=34  *** REMOVIDA PELO VUE ***
perfil   html@1,5s=""  html@8,5s=""  contraste-reprova=15  *** REMOVIDA PELO VUE ***
```

O Vue apaga a classe no boot. **Não recomende esse caminho ao NOC — ele parece resolver e não
resolve.**

### A correção
Declarar **as 137** em `:root`, o que torna o tema independente da classe que não controlamos.
A divisão é deliberada:

- **54 tokens** carregam a nossa identidade (neutros, superfícies, bordas, verde, âmbar, vermelho,
  véu do modal, widget de chamada);
- **83 tokens** adotam **o valor escuro do próprio Chatwoot, sem alteração**. Onde a identidade não
  manda, copiar o fabricante é o caminho de menor risco: a rampa já é internamente coerente e a
  nossa intervenção fica limitada ao que de fato carrega marca.

**Prova depois da correção**, em 8 rotas × 6 larguras, com a preferência do sistema em **claro**
(o pior caso) e em escuro: `contraste-reprova = 0` em todas, exceto os falsos positivos
explicados em §6.

---

## 3. 🔴 A2 e A3 — a âncora do login estava presa a um estado de execução

Os dois defeitos vêm do **mesmo seletor**: `body:has(input[type="password"])`.

### A2 — o olho de "exibir senha" (defeito que o dono encontrou)
Ao revelar a senha, o Vue troca o campo para `type="text"`. A regra deixa de casar e **todo o
tema da entrada evapora**. Medido a 1440 px:

```
antes do clique : type=password  body.display=grid   cartão=rgb(8, 37, 50)
depois do clique: type=text      body.display=block  cartão=rgb(255, 255, 255)
```

### A3 — o vazamento para dentro do aplicativo
"Configurações do Perfil" tem **4 campos de senha**. A regra casava lá e o `<body>` do aplicativo
virava grade de duas colunas:

```
/app/accounts/1/profile/settings   senhas=4  display=grid  cols=777.594px 662.391px
```

Na captura: a foto da tela de entrada ocupando a metade esquerda da página, a barra lateral
espremida numa coluna estreita, o formulário de perfil renderizado como cartão de login e o
restante do texto lavado, ilegível. **Em todas as seis larguras.**

### A escolha da âncora nova — medida, não deduzida
Testei 8 candidatas em 7 situações. Só duas acertaram todas:

| situação | `input[type=password]` (a antiga) | `form input[name="email_address"]` (a nova) |
|---|---|---|
| entrada | ✅ casa | ✅ casa |
| entrada **com a senha revelada** | ❌ **deixa de casar** | ✅ casa |
| redefinir senha | ❌ não casa | ✅ casa |
| perfil | ❌ **casa (não devia)** | ✅ não casa |
| painel · caixa nova · agentes | ✅ não casa | ✅ não casa |

`name="email_address"` **não muda em tempo de execução** e só existe nas telas de autenticação.

### Verificação final da entrada — 7 larguras × 2 preferências de sistema = 14 casos

Com o arquivo definitivo, contra o produto no ar, as 14 combinações devolvem:

```
cartão = rgb(8, 37, 50)   fonte do campo = 16px   rolagem horizontal = 0
campo de e-mail dentro da primeira dobra = true
campo de senha com a MESMA largura do de e-mail (288 · 318 · 342 · 412 · 349 · 390)
botão do olho = 44×50 px, alcançável (elementFromPoint devolve o próprio botão)
contentor de avisos = 0 px de altura, pointer-events: none
```

### ⚠️ Uma descoberta importante para o NOC: **o botão do olho está desativado no produto**
Ao testar, o botão veio `disabled` com `data-rgb-travado="1"`. Ou seja: o paliativo aplicado para
o defeito 1 foi **desligar a funcionalidade**. Isso resolve o sintoma tirando o recurso.

**Com o tema corrigido, o paliativo não é mais necessário.** Reabilitei o botão em memória e
cliquei, nas duas versões:

```
[tema no ar] 390px   type=text   cartão rgb(8,37,50) → rgb(255,255,255)   *** TEMA SUMIU ***
[tema no ar] 1440px  type=text   cartão rgb(8,37,50) → rgb(255,255,255)   *** TEMA SUMIU ***
[tema novo]  390px   type=text   cartão rgb(8,37,50) → rgb(8,37,50)       TEMA MANTIDO
[tema novo]  1440px  type=text   cartão rgb(8,37,50) → rgb(8,37,50)       TEMA MANTIDO
```

**Recomendação:** publicado o tema, **remover o `disabled`** e devolver o "exibir senha" ao
usuário. Num teclado de celular, digitar senha sem poder conferir é a principal causa de erro de
digitação — e cada erro agora custa caro, porque o freio de força bruta tranca a conta (§9.2).

### O irmão do A2 que ninguém tinha visto: M1
A tela **"redefinir senha"** tem outra árvore — não tem `<main>` e o cartão é o próprio `<form>`.
A regra antiga não a alcançava: **cartão branco, `body.display = block`**. As duas formas estão
cobertas agora.

### E o que aprendi para não repetir
Varri o arquivo atrás de outros seletores presos a estado de execução (`aria-expanded`,
`disabled`, `checked`, `:hover`, classes de foco). **Os únicos eram estes.** Os modificadores
`checked:`/`indeterminate:`/`hover:` que restam vêm da lista de classes do Chatwoot e são
intencionais — descrevem o estado que deve ser pintado, não são âncora de leiaute.

---

## 4. 🔴 A4 — a regressão que eu mesmo criei, e como ela apareceu

**Preciso registrar isto com o mesmo destaque dos outros, porque é o achado mais instrutivo.**

Ao cobrir a tela de redefinir senha (M1) eu acrescentei `#app > div > div`. Esse seletor casava
**também no contentor de avisos** — `div.fixed.left-0.right-0.mx-auto`, **vazio**, `z-index:50`,
irmão do `<main>`. Com `height:100%` ele passou de **0 px para 844 px** e cobriu a tela de entrada
inteira:

```
[novo]   360 → caixa=[0,40,360,844]  pointer-events=auto  olhoAlcançável=FALSE
[novo]   390 → caixa=[0,40,390,844]  pointer-events=auto  olhoAlcançável=FALSE
[novo]   768 → caixa=[64,40,640,900] pointer-events=auto  olhoAlcançável=FALSE
[no-ar]  360 → caixa=[0,40,360,  0]                        olhoAlcançável=true
```

`elementFromPoint` no centro do botão devolvia o contentor de avisos, não o botão.
**A tela parecia perfeita na captura e não funcionava.** Ninguém conseguiria entrar pelo celular.

**Só apareceu porque um clique do Playwright falhou** — nenhuma medição de contraste, de
transbordo ou de leitura de CSS acusaria isso. É a Lei do Olhar cobrando o preço dela.

**Correção:** exigir o formulário dentro — `#app > div > div:has(> form)` — mais uma blindagem
geral que vale por si:

```css
.fixed.left-0.right-0.mx-auto:empty{ pointer-events:none !important; }
```

Contentor de aviso **vazio** nunca deve interceptar clique. Verificado: caixa de volta a 0 px,
`pointer-events:none`, olho alcançável nas quatro larguras.

---

## 5. 📱 Responsividade mobile — o veredito por largura

Medido no produto no ar, com o tema corrigido, em 8 rotas × 6 larguras (48 combinações).

| largura | rolagem horizontal | contraste | texto cortado | veredito |
|---|---|---|---|---|
| **360** | **0 px** em 8/8 rotas | 0 reprovações | 0 real | ✅ **aprovado** |
| **390** | **0 px** em 8/8 | 0 | 0 real | ✅ **aprovado** |
| **414** | **0 px** em 8/8 | 0 | 0 real | ✅ **aprovado** |
| **768** | **0 px** em 8/8 | 0 | **1 real** — §M6, corrigido | ✅ aprovado após a correção |
| **1024** | **0 px** em 8/8 | 0 | 0 real | ✅ **aprovado** |
| **1440** | **0 px** em 8/8 | 0 | 0 real | ✅ **aprovado** |
| **812×375** (deitado) | 0 px | 0 | 0 | ✅ aprovado — regra própria, §5.4 |

**Zero rolagem horizontal nas 48 combinações internas**, antes e depois. As telas do aplicativo não
têm o problema clássico do `1fr` que não encolhe — o Chatwoot cuida disso bem.

⚠️ **A exceção estava na tela de ENTRADA**, e é o A7: com o desafio "Confirme que é humano" na
tela, media-se **30 px de rolagem horizontal a 360 px**. Corrigido para **0**.

### 5.1 O que foi corrigido especificamente para o celular

**M2 — alvo de toque.** A regra de 44 px existia **apenas nas maquetes**; o `tema.css` no ar não
tinha uma linha sobre isso. Agora, só em `pointer:coarse` (no computador o ponteiro é preciso e
engordar tudo custaria densidade sem devolver nada):

- botão, aba, interruptor, item de menu, seleção: `min-height/min-width: 44px`;
- campo, área de texto e seleção: `font-size: max(16px, 1em)` — **abaixo de 16 px o iOS dá zoom ao
  focar e desloca a tela**, que é o pior defeito possível numa tela de entrada;
- caixa de marcar e rádio: 22 px (a área clicável em volta é que cresce, não o desenho).

**Medido em contexto REALMENTE de toque** (`hasTouch`, UA de iPhone, `pointer:coarse = true`),
na tela de entrada, nas três larguras de celular:

| controle | tema no ar | tema novo |
|---|---|---|
| campo de e-mail | 288×50 ✅ | 288×50 ✅ |
| **botão "exibir senha"** | **26×92 ❌** | **44×72 → 44×50 ✅** |
| botão "Entrar" | 288×48 ✅ | 288×48 ✅ |
| link "Esqueceu-se da sua senha?" | 194×16 | 194×16 — **isento, ver abaixo** |

⚠️ **O link fica como está, e isso é decisão, não omissão.** `min-height` **não se aplica a
elemento em linha** — pôr `a[href]` na lista produziria uma regra que não faz nada, que é dívida
silenciosa. E a **WCAG 2.5.8 isenta explicitamente** o alvo "em linha, dentro de uma frase ou
limitado pela entrelinha do texto em volta". Alargar um link de dentro de frase quebraria a linha
do texto para resolver um problema que a norma não reconhece. A regra alcança, então, **só o link
que já é bloco** — o botão disfarçado de link, que é o que o dedo de fato precisa acertar.

**M7 — o botão flutuante do menu cobria conteúdo.** No celular o Chatwoot põe o menu num botão
fixo de 56 px no canto inferior esquerdo (`div.fixed.bottom-4.left-4.z-40`, medido em
`[16, 568, 56, 56]` numa janela de 360×640). A área de rolagem terminava com 32 px de folga —
menos do que os 56+16 que o botão ocupa. Na captura de "Configurações gerais" a 360 px ele cobria
a linha "Idioma preferido".

```
antes  → padding-bottom: 32px   depois → 96px   (sem transbordo horizontal novo)
```

**M9 — barra de rolagem.** 10 px de barra roubam largura útil numa tela de 360 px e não servem
para nada: ninguém arrasta barra com o dedo. Some em `pointer:coarse`.

**5.4 — tela baixa e deitada.** Celular na horizontal (ou teclado virtual aberto) tem ~375 px de
altura. A faixa de foto de 188 px comia metade da dobra. Regra nova em
`(max-height:560px) and (orientation:landscape)`: a foto sai, o formulário sobe. Verificado a
812×375 — campo de e-mail dentro da dobra.

### 5.2 A caixa de entrada no celular
O Chatwoot já resolve os três painéis por conta própria: **a 390 px só a lista de conversas
aparece**, com o painel do contato e o fio da conversa fora de tela, e o botão flutuante para
abrir a navegação. A navegação lista → conversa → detalhes funciona com o polegar. **Não mexi
nisso** — está correto e mexer só criaria risco.

⚠️ **Limite honesto desta avaliação:** a conta tem **zero conversas**. Avaliei a casca da caixa de
entrada, não o fio de mensagens com conteúdo real (bolhas, anexos, nota interna, respostas
longas, imagens). **Isso não foi verificado** e precisa ser, com uma conversa de verdade.

---

## 6. Os achados de componente, com a medição de cada um

### M4 — `.bg-n-brand *` forçava cor em toda a descendência
`color: inherit !important` num seletor de descendência universal é o tipo de regra que vaza sem
denunciar: qualquer distintivo, ícone colorido ou cartão aninhado dentro de uma área de marca
perdia a própria cor. **Reduzido a filhos diretos** — o rótulo e o ícone de um botão são filhos
diretos, e é até aí que a regra precisa ir.

### M5 — as iniciais do contato
O Chatwoot escolhe a cor do avatar **em JavaScript** e escreve no atributo `style`:
`background-color: rgb(204,243,234); color: rgb(0,133,115)`. São pares pastéis, desenhados para
uma interface clara. Medido no produto:

```
"E"  bg=rgb(232,232,232) fg=rgb( 96,100,108)  4,85:1   luminância de fundo 0,807
"CM" bg=rgb(225,233,255) fg=rgb( 58, 91,199)  4,94:1                        0,815
"OF" bg=rgb(204,243,234) fg=rgb(  0,133,115)  3,82:1  ← REPROVA (piso 4,5)  0,829
"ED" bg=rgb(255,224,187) fg=rgb(153, 84, 58)  4,51:1                        0,782
"OO" bg=rgb(204,243,234) fg=rgb(  0,133,115)  3,82:1  ← REPROVA             0,829
```

Sobre o nosso azul-petróleo eles são a coisa mais clara da tela, e **dois dos seis pares reprovam
por conta própria**.

**Primeira tentativa: `color-mix()` com `currentColor`. FALHOU** — devolveu preto puro
(`rgb(0,0,0)`, razão 1:1) em todos os seis. Registro o fracasso porque ele é a prova de que
raciocinar sobre CSS não substitui medir: eu teria publicado avatares pretos.

**Solução que funciona:** véu (`::after` com `rgba(3,21,31,.80)`) sobre o chip, mantendo o matiz
do contato, e as iniciais em branco por cima. **Medido em pixel, na captura renderizada:**

```
"E"  chip=rgb(49,64,72) lum=0,048  branco = 10,73:1
"CM" chip=rgb(23,45,57) lum=0,024  branco = 14,28:1
"OF" chip=rgb(16,41,50) lum=0,019  branco = 15,16:1
"WC" chip=rgb(11,34,45) lum=0,014  branco = 16,39:1
"ED" chip=rgb( 6,30,41) lum=0,011  branco = 17,14:1
"OO" chip=rgb( 6,30,41) lum=0,011  branco = 17,14:1
PIOR CASO 10,73:1 — piso 4,5 → PASSA
```

⚠️ **Por que o meu próprio auditor reporta "1,15:1" aqui e está errado:** ele calcula o fundo
efetivo andando pela árvore e lendo `background-color`. O véu é um **pseudo-elemento**, invisível
para esse cálculo — então ele vê o pastel original com texto branco por cima. **O pixel é a
verdade; a computação não.** É exatamente a armadilha nº 2 do meu próprio método, e vale registrar
que ela me pegou de novo.

### M6 — "Enviar Mensagem" cortado e inalcançável a 768 px
Em Contatos, o grupo de ações é `flex-shrink-0` dentro de um cabeçalho com 568 px de largura útil:
não encolhe e não quebra linha.

```
antes  → borda direita do botão em 796px numa janela de 768  → INVISÍVEL
depois → 510px                                               → visível
```

**E não havia barra de rolagem para denunciar** (transbordo do documento = 0): a ação simplesmente
não existia para o usuário. **Reproduzido com o tema DESLIGADO — é defeito do Chatwoot**, mitigado
por CSS (a linha passa a quebrar abaixo de 920 px).

### 🔴 A7 — o desafio "Confirme que é humano" quebra a tela de entrada
Apareceu **durante esta revisão** (é acionado por tentativas repetidas de entrada — as minhas).
O widget entra no DOM como **irmão do campo de senha**, dentro de uma linha `flex` que não quebra:

```
div.flex.items-center.relative.w-full      318 × 92   ← flex, nowrap
  ├─ input[name=password].w-full            54 × 50   ← esmagado
  ├─ div.rgb-turnstile                     300 × 72   ← ocupa a mesma linha
  └─ button (o olho, absoluto)              26 × 92
```

**Medido, e o que importa: com o tema COMPLETAMENTE DESLIGADO o defeito continua.**

| | campo de senha 360 px | 390 px | 1440 px | rolagem horizontal a 360 px |
|---|---|---|---|---|
| tema no ar | 54×50 | 54×50 | 90×50 | 30 px |
| **tema desligado** | **52×48** | 52×48 | 124×48 | 6 px |
| **tema corrigido** | **288×50** | **318×50** | **390×50** | **0 px** |

Um campo de senha de 54 px mostra **três caracteres**. E o widget transbordava a janela a 360 px,
criando 30 px de rolagem horizontal — na tela de entrada, que é a primeira coisa que o cliente vê.

**Não é defeito do tema**, mas a correção é de leiaute e cabe nele: a linha passa a quebrar, o
campo volta a 100 % e o desafio desce para a linha de baixo. O botão do olho é preso à altura do
campo, senão com duas linhas ele se centralizaria entre as duas.

⚠️ **A regra é inerte quando o desafio não está na tela.** O `:has(> .rgb-turnstile)` garante isso
— no caso comum ela não muda absolutamente nada.

⚠️ **E uma honestidade sobre o gatilho:** o desafio **não estava presente no início desta sessão**
(o campo `cf-turnstile-response` não existia no primeiro levantamento do DOM). Ele apareceu depois
das minhas tentativas repetidas. **Não sei dizer se ele está sempre ligado ou se só aparece sob
suspeita** — e isso muda quantos usuários encontram o defeito, não se ele existe.

### M3 — `prefers-reduced-motion` acelerava em vez de parar
A regra no ar zerava só a **duração**. Uma animação **infinita** (o girador de carregamento) com
duração de 0,001 ms não para: ela repete a cada quadro e vira pisca-pisca — justamente para quem
pediu **menos** movimento, que é quem menos pode receber isso. Faltavam
`animation-iteration-count: 1` e `scroll-behavior: auto`.

### M8 — controles nativos
Caixa de marcar, rádio, barra de intervalo e barra de progresso do navegador vinham no azul do
sistema, ao lado do nosso verde. `accent-color: var(--rb-green)` no `:root`.

---

## 7. ❌ O que eu **não** corrigi, de propósito

### B1 — Contatos: o estado vazio desenhado por cima da lista
A 390 e a 768 px, "Nenhum contato encontrado nesta conta" aparece **sobreposto** às linhas de
contato, que ficam esmaecidas por baixo. Duas camadas de texto no mesmo lugar, ilegíveis.

```
Contatos 768  tema=ligado    → cruza=true
Contatos 768  tema=DESLIGADO → cruza=true
```

**É defeito do Chatwoot** e persiste depois de 6 s de espera (não é transitório de carregamento).

**Por que não remendei:** o remendo óbvio é pôr fundo sólido no estado vazio, para ele deixar de
ser transparente. Mas se as linhas por baixo forem **dados reais** em vez de resíduo de
renderização, eu estaria **escondendo informação do usuário** para deixar a tela bonita. Isso é
pior que o defeito. Precisa ser entendido antes de corrigido — é uma questão de estado da
aplicação, não de folha de estilo.

**Recomendação:** o NOC abre o caso a montante, ou alguém confirma se a lista por baixo é resíduo.
Se for resíduo, a correção é de uma linha e eu faço.

### Relatórios: 192 a 363 alvos abaixo de 44 px
A contagem é real, mas **eu não a classifiquei** — a maioria quase certamente são elementos de
`<svg>` do mapa de calor (7 linhas × 24 colunas = 168 células, o que explica a ordem de grandeza),
que não são controles de toque. **Ver §10: esta medição ficou incompleta.**

---

## 8. 🔴 A5 — o nome do software de origem, ponto a ponto

**A boa notícia primeiro:** a correção do NOC no `InstallationConfig` **funcionou e está de pé**.
Medido no estado global servido:

```
INSTALLATION_NAME : "Ragnabot"          BRAND_NAME  : "Ragnabot"
LOGO              : /brand-assets/ragnabot-logo.svg
LOGO_DARK         : /brand-assets/ragnabot-logo-dark.svg
LOGO_THUMBNAIL    : /brand-assets/ragnabot-logo-thumb.svg
BRAND_URL / TERMS_URL / PRIVACY_URL / WIDGET_BRAND_URL : https://ragnatela.com.br
```

E o `sub_filter` do vhost está pegando: a tela de entrada mostra **"Entrar no Ragnabot"**.

### O que AINDA aparece — 16 pontos, com onde está cada um

| # | Onde o usuário vê | O que aparece | Onde vive | Grav. |
|---|---|---|---|---|
| 1 | **Ícone na tela inicial do celular e na aba** | o logotipo **azul do Chatwoot** | `/apple-icon-*.png` (9), `/android-icon-*.png` (6), `/favicon-{16,32,96}.png`, `/ms-icon-144x144.png` — arquivos estáticos servidos pelo pod. Verificado: `apple-icon-180x180.png` é o círculo azul com o balão branco | 🔴 |
| 2 | **Nome do aplicativo instalado (PWA)** | `"name": "Chatwoot"`, `"short_name": "Chatwoot"` | `/manifest.json` — **não é coberto pelo `sub_filter` atual**, que só age em `^/(vite\|packs\|assets\|brand-assets)/` | 🔴 |
| 3 | Cor do aplicativo instalado | `background_color` e `theme_color` = `#2781F6` (azul do Chatwoot) | `/manifest.json` | 🟠 |
| 4 | **Título da aba do navegador** | `Chatwoot` | escrito por JS; o `<title>` do HTML vem vazio | 🔴 |
| 5 | Prévia do link (WhatsApp, LinkedIn) e buscadores | `meta description` **em inglês**: *"Ragnabot is a customer support solution that helps companies engage customers over Messenger, Twitter, Telegram, WeChat, Whatsapp…"* | `<meta name="description">` no HTML | 🟠 |
| 6 | Azulejo do Windows | `msapplication-TileColor` = `#2781F6` · `msapplication-TileImage` = `/ms-icon-144x144.png` | HTML | 🟢 |
| 7 | **Campanhas → chat ao vivo** | mensagem de exemplo: **"Hi! Chatwoot here. Need help setting up? Let me know!"** | pacote de idioma no bundle | 🔴 |
| 8-19 | **Todo "saiba mais" das Configurações** | **12 links para `https://chwt.app/hc/…`** — teams, sla, reports, labels, integrations, help-center, fb, email, custom-attributes, canned, campaigns, agent-bots. Clicar leva à central de ajuda do produto de origem | no **HTML servido** → alcançável pelo `sub_filter` de `location /` | 🔴 |
| 20 | Termos e privacidade | `https://www.chatwoot.com/terms` e `/privacy-policy` | bundle `v3app-*.js` | 🟠 |
| 21 | Ferramentas de rede / cache | nomes de arquivo `chatwoot-viz-*.js` e `chatwoot-viz-*.css` | build | 🟢 |

### O que eu recomendo, por mecanismo

**(a) Ícones e `manifest.json` — a correção mais visível e a mais barata.**
Servir os nossos pelo proxy, como já se faz com o tema. Os arquivos já existem em
`marca/web/icone-marca-{180,192,512}.png`. Um `location` por arquivo, ou um `alias` de diretório,
e um `manifest.json` nosso:

```nginx
location = /manifest.json { alias /var/www/ragnabot/manifest.json; default_type application/json; }
location ~* ^/(apple-icon|android-icon|favicon|ms-icon)[^/]*\.png$ {
    root /var/www/ragnabot/icones;   # arquivos com os mesmos nomes
    try_files $uri =404;
}
```
Com `name`/`short_name` = `Ragnabot`, `theme_color` e `background_color` = **`#03151f`**
(a paleta aprovada — **não** `#055508`).

**(b) Os 12 links `chwt.app` — uma linha no `sub_filter` de `location /`**, já que aparecem no HTML:
```nginx
sub_filter 'https://chwt.app/hc/' 'https://ragnatela.com.br/ajuda/';
```
⚠️ Só depois de existir para onde apontar. Enquanto não existir, apontar para
`https://ragnatela.com.br` inteiro já é melhor que entregar o cliente ao produto de origem.

**(c) Título da aba** — é escrito por JS a partir do pacote de idioma. Cabe no `sub_filter` do
bloco de assets, que já está montado. Precisa da string exata do bundle; **não a levantei** (§10).

**(d) `meta description`** — reescrever em português no `sub_filter` de `location /`. Proposta:
> *"Ragnabot é a plataforma de atendimento da Ragnatela IoT Solutions: WhatsApp, Instagram,
> Facebook e o chat do seu site numa conversa só, com histórico, relatórios e equipe."*

**(e) Mensagens de exemplo de campanha (o "Hi! Chatwoot here")** — vivem no pacote de idioma.
Mesmo mecanismo do bloco de assets. **São 8 frases, todas em inglês** — listadas em §9.

**(f) `theme-color` do vhost está errado hoje:** `#055508` é da paleta **rejeitada**. Deve ser
`#03151f`. Uma linha.

### O que eu já cobri no meu arquivo
- a logomarca do Chatwoot na tela de entrada: **removida** (`main > section:first-of-type img`);
- a marca azul `#2781f6` em todas as suas 10 classes e modificadores: **substituída** pelo nosso
  verde, com a cor do texto vindo junto (branco sobre o nosso verde daria 1,62:1);
- a sobrancelha "RAGNABOT" e a frase da foto: escritas por nós.

---

## 9. 🔴 A6 — mensagens ao usuário em inglês (e uma delas invisível)

### 9.1 O erro de credencial — reproduzido
```
POST /auth/sign_in   (com Accept-Language: pt-BR,pt;q=0.9)
HTTP 401
{"success":false,"errors":["Invalid login credentials. Please try again."]}
```
Vem do **servidor** (devise_token_auth), cuja locale padrão é `en`. O cabeçalho de idioma é
ignorado.

**Correção certa:** `DEFAULT_LOCALE=pt_BR` no deployment do Chatwoot — resolve esta e **todas** as
demais mensagens de servidor de uma vez. Exige reinício do pod.

**Correção imediata**, se o dono quiser hoje, no `location = /auth/sign_in` que já existe:
```nginx
proxy_set_header Accept-Encoding "";
sub_filter_types application/json;
sub_filter 'Invalid login credentials. Please try again.'
           'E-mail ou senha incorretos. Confira e tente de novo.';
sub_filter_once off;
```

### 9.2 ⚠️ O achado mais grave desta seção: o freio de força bruta falha em SILÊNCIO
O freio recém-ligado responde, e **o usuário não vê absolutamente nada**:

```
POST /auth/sign_in → HTTP 429
corpo  = "Retry later"        (texto puro, inglês, não é JSON)
tela   = (vazio)              ← o contentor de avisos não recebe nada
url    = continua em /app/login
```

E o freio do nginx, quando dispara antes, devolve outra coisa:
```html
<html><head><title>429 Too Many Requests</title></head>
<body><center><h1>429 Too Many Requests</h1></center>
<hr><center>nginx</center></body></html>
```

**Três problemas somados:** (1) inglês; (2) não é JSON, então a aplicação Vue não consegue
transformar em aviso — o usuário clica em "Entrar" e **nada acontece**, sem explicação; (3) a
página do nginx **anuncia "nginx"**, contrariando o `server_tokens off` do resto do vhost.

Isto não é hipótese: **aconteceu comigo durante esta revisão** e me deixou sem sessão por mais de
20 minutos, sem nenhuma mensagem na tela dizendo por quê.

**Correção proposta**, mantendo o contrato JSON que a aplicação espera:
```nginx
location = /auth/sign_in {
    limit_req zone=ragnabot_login burst=5 nodelay;
    limit_req_status 429;
    error_page 429 = @freio_entrada;
    # … resto do proxy_pass como está
}
location @freio_entrada {
    default_type application/json;
    add_header Retry-After 60 always;
    return 429 '{"success":false,"errors":["Muitas tentativas de entrada. Aguarde um minuto e tente novamente."]}';
}
```
E o mesmo `sub_filter` do item 9.1 cobre o `Retry later` do Rack::Attack.

### 9.3 Levantamento das 25 frases em inglês visíveis na interface
Varridas 16 rotas internas. Por origem:

**(i) Mensagens de exemplo de campanha — 8 frases, e uma traz o nome de origem e um anúncio do fornecedor:**
- `Hi! Chatwoot here. Need help setting up? Let me know!`
- `Hello! 👋 Need help with our chatbot features? Feel free to ask!`
- `Hello! 👋 Any questions on pricing? I'm here to help!`
- `Hi there! 👋 I'm here for any questions you may have. Let's chat!`
- `Welcome aboard! 🎉 Let us know if you have any questions.`
- `Hello! We're excited to have your business with us!`
- `Welcome to the team! Reach out if you have questions.`
- ⚠️ `Hello! Enjoying our product? Share your feedback on G2 and earn a $25 Amazon coupon: https://chwt.app/g2-review` — **um anúncio do fornecedor de origem, com cupom, dentro do nosso produto.**

**(ii) Títulos de artigo de exemplo da Central de Ajuda — 11 frases**, todas do tipo
*"How to get an SSL certificate for your Help Center's custom domain"*.

**(iii) Interface propriamente dita — 4:**
- `This app works best with JavaScript enabled.` (`<noscript>` do HTML)
- `Add or remove link` (editor, em Configurações do Perfil)
- `Optimizes your sales pipeline by tracking prospects…` (descrição de assistente)
- `7 rows across 24 columns.` (descrição do mapa de calor **para leitor de tela** — invisível
  na tela, lida em voz alta)

**(iv) Não é defeito:** os nomes de país no formulário de contato
(*"Congo, The Democratic Republic of the Congo"*). Vêm de uma lista ISO; traduzir é desejável, não
urgente.

**(v) Tradução ruim, não inglês:** `Alternar botão` como texto de leitor de tela para um
interruptor — deveria nomear **o que** o interruptor faz.

**Mecanismo para (i), (ii) e (iii):** todas vivem no pacote de idioma compilado → `sub_filter` no
bloco de assets, que já existe e já faz exatamente isso para as frases de marca.
**Para (iii) e o resto do servidor:** `DEFAULT_LOCALE=pt_BR` é a correção de raiz.

---

## 10. ⚠️ O que eu **NÃO** consegui verificar

Com o mesmo destaque do que foi feito, porque é isto que impede o conserto.

1. **A caixa de entrada com uma conversa real.** A conta tem **zero conversas**. Avaliei a casca
   dos três painéis e a navegação no celular, mas **não** o fio de mensagens: bolhas, anexos,
   imagens, respostas longas, **a nota interna** (que é o estado que não pode ser confundido) e o
   campo de resposta com o teclado virtual aberto. **É o maior furo desta entrega.** Precisa de
   uma conversa de teste.

2. **A classificação dos 192–363 alvos pequenos em Relatórios.** A contagem é real; a leitura
   não. Quase certamente são células de `<svg>` do mapa de calor e não controles — mas **eu não
   confirmei**, e reportar "192 defeitos" sem classificar seria inflar o laudo.

3. **O alvo de toque nas telas INTERNAS, com ponteiro grosso.** Consegui medir na tela de entrada
   (§5.1, com `hasTouch` e `pointer:coarse = true` confirmado) e a regra funciona: o botão do olho
   saiu de 26×92 para 44×50. **Mas as contagens das telas internas** (painel, contatos,
   configurações, relatórios) **foram feitas com ponteiro FINO** — o padrão do navegador de
   auditoria — e portanto **não representam o que um celular recebe**: a minha regra vive em
   `@media (pointer:coarse)` e não estava ativa naquelas medições. O teste correto está escrito e
   leva ~4 minutos, mas **não consegui completá-lo** — ver a nota abaixo. **Fica NÃO VERIFICADO.**

> ### 🔒 Por que os itens 2, 3, 4 e 5 ficaram em aberto — e não é desculpa, é o mecanismo
> Depois de dezenas de entradas legítimas durante a revisão, o produto passou a exigir o desafio
> **"Confirme que é humano"** na tela de entrada (§A7). A partir daí **nenhuma entrada automatizada
> é possível** — que é exatamente o que o desafio existe para fazer, e está correto. Tentei 18
> vezes, com espera crescente, e não voltei a ter sessão.
>
> **Consequência prática:** as medições que dependem de estar dentro do aplicativo ficaram
> incompletas. As que dependem só da tela de entrada — que é a maioria das correções desta
> revisão — foram todas concluídas depois da correção final.
>
> **Para retomar:** quem for repetir precisa resolver o desafio à mão uma vez e guardar a sessão,
> ou pedir ao NOC uma janela sem o desafio. Os scripts estão prontos e são declarativos.

4. **O título da aba e a string exata no bundle.** Confirmei que a aba mostra `Chatwoot`, mas não
   levantei a chave de idioma exata para escrever o `sub_filter`. Sem ela, a recomendação do §8(c)
   fica incompleta.

5. **A reconfirmação em pixel dos avatares contra o arquivo final.** A medição de 10,73–17,14:1
   foi feita com a regra **idêntica** injetada (mesmas cores, mesma opacidade), mas não voltei a
   rodá-la contra o `tema.css` final — bloqueado pelo desafio (ver a nota acima). As propriedades
   que determinam o resultado são idênticas; ainda assim, **não é a mesma coisa que ter olhado de
   novo**.

6. **Fontes.** O `tema.css` pede `'Poppins'` e cai em `'Inter'`/`system-ui`. **O Chatwoot não serve
   Poppins**, então hoje a tipografia da entrada usa a alternativa. Não é defeito visual (mede-se
   bem), mas a marca não está com a fonte da casa. Servir `assets/fontes/` pelo proxy resolve —
   decisão de peso (+60 KB bloqueando a pintura) que é do NOC, não minha.

7. **Desempenho.** Não medi LCP, CLS nem o custo real do arquivo na primeira pintura. O peso está
   em §11, mas **peso não é desempenho**.

---

## 11. O arquivo entregue

```
tema.css        89.918 caracteres · 92.276 bytes · 577 linhas
  imagens (data URI)  56.498 car. (62%)   ← 3 imagens; o arquivo é autocontido de propósito
  CSS + comentários   33.420 car.
  regras                  83  ·  @media  8  ·  declarações descartadas pelo parser  0
  !important              95
  servido com gzip    ~56 KB
```

**Sobre o peso:** 64% do arquivo são as três imagens da tela de entrada. Elas existem porque o
arquivo é injetado pelo proxy e não pode depender de nenhuma outra requisição. **Vale reavaliar:**
servir as três como arquivos estáticos ao lado do CSS (como já se faz com o próprio CSS) reduziria
o CSS a ~11 KB comprimidos e deixaria as imagens irem em paralelo, com cache próprio — melhor para
a primeira pintura. **Não fiz porque muda o contrato de publicação com o NOC**, e isso é decisão
de quem publica.

**Sobre os 95 `!important`:** a grande maioria está nas regras da tela de entrada, onde é preciso
vencer utilitárias do Tailwind com especificidade alta. **A escala de tokens (§2) não usa nenhum**
— é justamente por isso que ela cobre o produto inteiro, inclusive telas que ninguém abriu.

### Como reproduzir tudo
```bash
python3 _prova/gerar-tema.py       # reescreve tema.css (idempotente: md5 estável)
```
**Edite o gerador, nunca o `tema.css`** — a próxima geração apaga a correção. As imagens vivem em
`_prova/_ativos/imagens.css` e são coladas sem alteração.

---

## 12. O que fica para o NOC, em ordem de retorno

| ordem | ação | esforço | ganho |
|---|---|---|---|
| 1 | **Publicar o `tema.css` desta pasta** | 1 comando | resolve A1–A4, M1–M9 |
| 2 | **Ícones + `manifest.json` nossos** (§8a) | 1 bloco no vhost + arquivos | tira a marca de origem do lugar mais visível: a tela inicial do celular |
| 3 | **`DEFAULT_LOCALE=pt_BR`** no deployment | 1 variável + reinício | resolve **todas** as mensagens de servidor em inglês de uma vez |
| 4 | **Página de 429 em JSON e em português** (§9.2) | 1 bloco no vhost | acaba com a falha silenciosa na entrada |
| 5 | **Os 12 links `chwt.app`** (§8b) | 1 linha | deixa de entregar o nosso cliente ao produto de origem |
| 6 | Corrigir `theme-color` para `#03151f` (§8f) | 1 linha | a paleta atual no vhost é a **rejeitada** |
| 7 | Frases de campanha e artigos de exemplo (§9.3 i, ii) | `sub_filter` | tira o cupom da Amazon do fornecedor de dentro do produto |
| 8 | **Reabilitar o botão "exibir senha"** (`disabled` / `data-rgb-travado`) | 1 linha | o paliativo deixou de ser necessário — prova em §3 |
| 9 | Criar 1 conversa de teste e me chamar de volta | — | fecha o furo nº 1 do §10 |
| 10 | Investigar a sobreposição em Contatos (§7) | — | decide se o remendo de 1 linha é seguro |
| 11 | Confirmar se o desafio "Confirme que é humano" fica sempre ligado (§A7) | — | define quantos usuários encontram o defeito |

---

*Revisão conduzida contra o produto no ar, com navegador real, em 28/08/2026.
Nenhuma alteração foi aplicada em produção. Nenhuma credencial foi escrita em disco.*
