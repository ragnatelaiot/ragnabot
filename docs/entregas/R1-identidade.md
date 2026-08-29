# R1 — Empresa e versão no painel, junto do usuário logado

> **Estado:** preparado, **não aplicado**. Os arquivos estão prontos em
> `deploy/identidade/` do repositório `ragnatelaiot/ragnabot`. Aplicar no cluster é decisão do chefe.
>
> **Ordem do dono (29/08/2026):** *"a versão do Ragnabot atual sempre deve ser apresentada abaixo do
> nome do usuário logado e no usuário logado deve ter o nome da empresa (empresa registrada como
> SaaS)"*.

---

## 1. O que o operador passa a ver

No rodapé da barra lateral do painel — o cantinho onde já aparecem o avatar, o nome e o e-mail de
quem está logado — passam a existir mais duas linhas:

```
 (avatar)  Fulano de Tal                     ← já existia: nome do usuário
           fulano@empresa.com.br             ← já existia: e-mail
           Empresa Exemplo Ltda              ← NOVO: o nome da empresa
           Ragnabot v1.01.00                 ← NOVO: a versão do produto
```

Em uma frase: **quem olha o rodapé sabe, sem clicar em nada, em que empresa está trabalhando e em
que versão do Ragnabot o painel está rodando.**

Detalhes de comportamento que o operador percebe:

- As duas linhas novas usam a **mesma aparência** da linha do e-mail — mesmo tamanho, mesma cor,
  mesmo corte quando o texto é longo. Acompanham tema claro e escuro sozinhas, porque herdam o
  estilo da linha vizinha em vez de trazer estilo próprio.
- Texto longo é cortado com reticências, mas **passar o mouse mostra o texto inteiro**.
- Com a **barra lateral recolhida** (só ícones), o painel não desenha bloco de texto nenhum — nesse
  estado as duas linhas não aparecem. Ao expandir, voltam.
- **Trocar de empresa** (para quem tem acesso a mais de uma) atualiza a linha da empresa.
- Navegar entre telas, recolher/expandir a barra, abrir e fechar conversas: as linhas continuam lá.

## 2. Como funciona por dentro

### 2.1 Por que não é uma alteração no código do painel

O painel é a imagem oficial do Chatwoot, **fixada por digest** — nós não compilamos o front dele. A
customização entra por fora, exatamente como as **três logomarcas do Ragnabot** já entram hoje: um
`ConfigMap` do Kubernetes cujos arquivos são montados por `subPath` dentro do contêiner. É mecanismo
já em produção, conferido no `Deployment ragnabot-web` antes de escrever qualquer coisa.

Duas montagens novas:

| Arquivo no ConfigMap | Onde entra no contêiner |
|---|---|
| `ragnabot-identidade.js` | `/app/public/brand-assets/ragnabot-identidade.js` |
| `vueapp.html.erb` | `/app/app/views/layouts/vueapp.html.erb` |

O primeiro é **acréscimo puro**. O segundo **substitui** o layout da imagem — e é daí que vem o ponto
de manutenção da seção 4.

### 2.2 O gancho: uma linha no layout

O layout do painel já tem um bloco `<script>` onde a plataforma injeta a própria configuração
(`window.chatwootConfig`). Logo depois desse bloco entra **uma única linha**:

```html
<script src="/brand-assets/ragnabot-identidade.js" defer></script>
```

O arquivo é servido pela própria aplicação como estático (`RAILS_SERVE_STATIC_FILES=true`), portanto
é **mesma origem** — não depende de CDN nem esbarra em política de segurança de conteúdo (CSP). Foi
por isso que o script virou arquivo em vez de código embutido na página: script embutido é a primeira
coisa que uma CSP derruba.

### 2.3 De onde sai o nome da empresa

Do **estado do próprio painel**, não de uma chamada de rede.

O painel é um aplicativo Vue 3 com Vuex. O Vue guarda a instância do aplicativo no elemento onde ele
monta (`#app.__vue_app__`) e o Vuex publica a sua "loja de estado" em
`config.globalProperties.$store` — os dois caminhos foram conferidos dentro do pacote compilado que
está em produção, não presumidos. Dali sai o getter `getCurrentAccount`, e o campo `name` dele é o
nome da conta.

**Esse nome É o da empresa registrada no SaaS.** Quando o NOC cria uma empresa, ele cria a conta na
plataforma com `POST /platform/api/v1/accounts { name: <nome da empresa> }`
(`ragnabot-tenant.service.js`). Ou seja: `RagnabotTenant.name` → nome da conta no Chatwoot → o texto
que aparece na linha.

Foi a fonte escolhida por três motivos:

1. **É o que a tela já desenha.** Não há como ficar dessincronizada com o resto do painel.
2. **Zero rede.** Nenhuma requisição a mais, nenhum token manipulado, nenhum risco de encostar na
   sessão do operador.
3. **Zero acoplamento com a API.** Se um dia o formato de `/api/v1/profile` mudar, isto aqui não quebra.

Existe um **plano B**: se a loja de estado não estiver disponível (por exemplo, numa versão futura
que mude esse caminho), o script lê o texto do seletor de conta do topo da barra lateral
(`#sidebar-account-switcher`), que já mostra o mesmo nome na tela.

### 2.4 De onde sai a versão

De uma **constante no topo do próprio script**:

```js
var VERSAO = '1.01.00';
```

É dado de montagem, atualizado a cada entrega junto com o arquivo `VERSAO` da raiz do repositório.
**De propósito não há consulta a serviço nenhum** — uma chamada de rede aqui seria um ponto de falha
dentro do painel do cliente, para mostrar um dado que já é conhecido na hora de montar.

### 2.5 Como o script sobrevive ao painel se redesenhar

O painel é um aplicativo de página única: ele apaga e redesenha pedaços da tela o tempo todo. Três
mecanismos garantem que as linhas não somem:

- **Âncora pelo e-mail, não por classe de estilo.** O script procura o elemento cujo texto é
  exatamente o e-mail do usuário logado e pendura as linhas ao lado. E-mail é único na tela; classe
  utilitária de CSS muda a cada versão do Chatwoot. Havendo mais de um candidato, prefere o que tem
  o **nome do usuário** como vizinho — a assinatura do rodapé.
- **Observador de mudanças (`MutationObserver`)** no documento: sempre que o painel redesenha, o
  script reaplica. Um pedido de aplicação por quadro de vídeo, para não gastar trabalho à toa.
- **Idempotência.** Se as linhas já existem, o script só reescreve o texto **quando ele mudou**. É
  isso que impede o observador de se realimentar num laço infinito — e é isso que garante que a
  linha nunca aparece duplicada.

Além disso há uma rede de segurança que tenta de 1 em 1 segundo durante os primeiros 60 segundos,
porque a loja de estado só existe depois que o pacote do painel termina de montar.

### 2.6 A regra que vale mais que a funcionalidade

**Se qualquer coisa falhar, o painel não pode quebrar.** Todo caminho do script está dentro de
`try/catch` e a falha é silenciosa. No pior caso as duas linhas não aparecem e o painel fica
exatamente como está hoje. Identidade é enfeite; atendimento é o produto.

Para o suporte, `window.ragnabotIdentidade.versao` no console do navegador diz a versão montada.

## 3. O que foi provado, e como

- **O layout entregue difere do original da imagem em exatamente uma linha** — `diff` contra o
  arquivo extraído do contêiner em execução, e o extraído reconferido por `sha256sum` contra o pod.
- **O script é sintaticamente válido** — `node --check`.
- **A lógica foi exercitada em 13 verificações** (`deploy/identidade/teste-identidade.mjs`), com um
  DOM mínimo reproduzindo a estrutura real do rodapé: encaixe correto, idempotência após 5
  reaplicações, atualização quando a empresa muda, silêncio com a barra recolhida, silêncio sem a
  loja de estado, plano B pelo seletor de conta e recusa de uma âncora falsa.
- **O ConfigMap contém os arquivos byte a byte** — validado relendo o YAML e comparando `sha256`.

**O que ainda não foi medido** (só se mede com a customização aplicada no cluster): a aparência real
na tela, o casamento dos seletores pelo motor do navegador e o comportamento do observador sob o
painel de verdade.

## 4. ⚠️ Ponto de manutenção — a cada troca de versão da imagem do Chatwoot

O arquivo `vueapp.html.erb` **pertence à imagem do Chatwoot**. Ao montar a nossa cópia por cima, o
painel passa a renderizar a NOSSA versão dele — congelada no digest de 29/08/2026.

> Quando a imagem do Chatwoot subir de versão, o layout novo **não será usado**: o pod vai continuar
> renderizando a nossa cópia antiga. Isso pode quebrar o painel **em silêncio** — por exemplo, se a
> versão nova passar a injetar uma configuração nova que a nossa cópia congelada não tem.

**Procedimento obrigatório a cada troca de imagem:** reextrair o `.erb` da imagem nova, conferir o
`diff` contra o antigo, reaplicar a única linha do `<script>`, regerar o ConfigMap e refazer o
rollout — sempre conferindo que a diferença voltou a ser de **exatamente uma linha**. O passo a passo
está em `deploy/identidade/LEIA-ME.md`.

O `ragnabot-identidade.js` **não** tem esse custo: ele não substitui arquivo da imagem. Se a
estrutura do rodapé mudar um dia, ele deixa de achar a âncora e fica em silêncio.

**Alternativa registrada:** a imagem tem uma configuração de instalação chamada `DASHBOARD_SCRIPTS`
("scripts carregados como último item do `<body>`"). Usá-la elimina a necessidade de montar o layout
— e com ela o ponto de manutenção acima. Não foi o caminho entregue porque essa configuração vive no
**banco**, e não em arquivo versionado no Git; fica como decisão do chefe.

## 5. Ao subir a versão do produto

Três lugares, sempre juntos:

1. `VERSAO` (raiz do repositório);
2. bloco novo no topo de `docs/VERSOES.md`;
3. a constante `var VERSAO` em `deploy/identidade/ragnabot-identidade.js`, com `apply` do ConfigMap
   **e** `rollout restart` — volume montado por `subPath` não se atualiza sozinho.

O passo 3 é o fácil de esquecer. Painel mostrando versão errada é pior do que painel sem versão.
