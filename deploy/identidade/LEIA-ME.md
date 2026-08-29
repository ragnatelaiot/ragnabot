# Identidade no painel do Ragnabot — empresa e versão junto do usuário logado

**Ordem do dono (29/08/2026):** *"a versão do Ragnabot atual sempre deve ser apresentada abaixo do
nome do usuário logado e no usuário logado deve ter o nome da empresa (empresa registrada como
SaaS)"*.

Este diretório **prepara** a customização. Nada aqui foi aplicado no cluster — aplicar é decisão do
chefe.

---

## 1. O que passa a aparecer

No rodapé da barra lateral, onde hoje há avatar + nome + e-mail, passam a existir mais duas linhas:

```
 (avatar)  Fulano de Tal                     ← nativo (nome do usuário)
           fulano@empresa.com.br             ← nativo (e-mail)
           Empresa Exemplo Ltda              ← NOSSO (nome da empresa do SaaS)
           Ragnabot v1.01.00                 ← NOSSO (versão do produto)
```

As duas linhas novas herdam a classe da linha do e-mail, então acompanham tema claro/escuro e
truncamento sem estilo próprio nenhum. Com a barra lateral **recolhida** o painel não desenha o bloco
de texto — nesse estado as linhas simplesmente não aparecem (é o comportamento correto: não há onde
escrever).

## 2. Os arquivos

| Arquivo | O que é |
|---|---|
| `vueapp-original.html.erb` | Cópia **crua** do layout extraída do pod em execução, para servir de referência do `diff`. Não é montada. |
| `vueapp.html.erb` | A cópia acima **mais uma única linha**: a tag `<script>`. É esta que vai montada. |
| `ragnabot-identidade.js` | O script. JS puro, sem dependência externa. |
| `teste-identidade.mjs` | Teste sem navegador (DOM mínimo reproduzindo a estrutura real do rodapé). `node deploy/identidade/teste-identidade.mjs` |
| `ragnabot-identidade.configmap.yaml` | O ConfigMap com os dois arquivos. |
| `patch-deployment.yaml` | O trecho de patch do Deployment (os `volumeMounts` a acrescentar). |

A linha acrescentada ao layout, e só ela:

```diff
       window.errorLoggingConfig = '<%= ENV.fetch('SENTRY_FRONTEND_DSN', '') || ENV.fetch('SENTRY_DSN', '') %>'
     </script>
+    <script src="/brand-assets/ragnabot-identidade.js" defer></script>
     <% if @global_config['CLOUD_ANALYTICS_TOKEN'].present? %>
```

## 3. Como funciona por dentro

- **Onde o script entra.** O mesmo mecanismo que já monta as três logomarcas: `ConfigMap` +
  `subPath` no Deployment `ragnabot-web`. Como o Rails serve `/app/public` como estático
  (`RAILS_SERVE_STATIC_FILES=true`, medido no ConfigMap `ragnabot-config`), o arquivo fica acessível
  em `https://bot.ragnatela.com.br/brand-assets/ragnabot-identidade.js` — **mesma origem**, o que o
  deixa imune a qualquer política de segurança de conteúdo (CSP). Por isso ele é um arquivo, e não
  um `<script>` embutido, e por isso não há CDN.
- **De onde sai o nome da empresa.** Do estado do próprio painel: `#app.__vue_app__` (o Vue 3 grava
  a instância no elemento de montagem) → `config.globalProperties.$store` (o Vuex 4 publica a store
  aí) → getter `getCurrentAccount.name`. Os dois caminhos foram conferidos no pacote compilado em
  produção. É a fonte mais estável porque **é exatamente o que a tela desenha**: sem rede, sem token
  e sem risco de encostar na sessão do operador. Esse nome **é** o da empresa do SaaS: o NOC cria a
  conta na plataforma com `name: <nome da empresa>` (`ragnabot-tenant.service.js`, chamada
  `POST /platform/api/v1/accounts`). Plano B, se a store não estiver disponível: o texto do seletor
  de conta do topo da barra (`#sidebar-account-switcher`), que já mostra o mesmo nome.
- **De onde sai a versão.** De uma constante no topo do próprio script (`var VERSAO = '1.01.00';`).
  É dado de montagem, atualizado junto com o arquivo `VERSAO` da raiz do repositório. **De propósito
  não há chamada a serviço nenhum** — uma chamada de rede aqui seria um ponto de falha dentro do
  painel do cliente.
- **Onde encaixa no DOM.** Procura a folha cujo texto é exatamente o e-mail do usuário logado e
  pendura as linhas no elemento que a contém. A âncora é o **e-mail** (único na tela) e não classe do
  Tailwind — classe utilitária muda a cada versão do Chatwoot, e-mail não.
- **Robustez.** `MutationObserver` no documento inteiro devolve as linhas sempre que o painel
  redesenha (troca de rota, recolher/expandir, troca de conta). A aplicação é **idempotente**: se as
  linhas já existem, só reescreve o texto quando ele mudou — é isso que impede o observador de se
  realimentar. Há ainda uma rede de segurança de 1 em 1 segundo durante os primeiros 60 segundos (a
  store só existe depois que o pacote do painel monta). **Tudo dentro de `try/catch`: falha em
  silêncio.** No pior caso as duas linhas não aparecem e o painel segue idêntico ao de hoje.
- **Apoio ao suporte.** `window.ragnabotIdentidade.versao` no console diz a versão montada.

## 4. Como aplicar (chefe)

```bash
# 1. o ConfigMap com os dois arquivos
kubectl -n ragnabot apply -f deploy/identidade/ragnabot-identidade.configmap.yaml

# 2. os volumeMounts no Deployment (patch estratégico: NÃO remove os 3 montes das logomarcas)
kubectl -n ragnabot patch deploy ragnabot-web \
  --patch-file deploy/identidade/patch-deployment.yaml

# 3. o patch do passo 2 já altera o template do pod, logo já dispara o rollout.
#    Acompanhar:
kubectl -n ragnabot rollout status deploy/ragnabot-web

# 4. conferir que o arquivo chegou e que o layout tem a linha
POD=$(kubectl -n ragnabot get pods -l app=ragnabot-web -o jsonpath='{.items[0].metadata.name}')
kubectl -n ragnabot exec "$POD" -- head -3 /app/public/brand-assets/ragnabot-identidade.js
kubectl -n ragnabot exec "$POD" -- grep -n ragnabot-identidade /app/app/views/layouts/vueapp.html.erb
```

⚠️ **Volume montado por `subPath` não se atualiza sozinho** quando o ConfigMap muda. Toda alteração
no script (inclusive o bump de versão) exige `kubectl -n ragnabot rollout restart deploy/ragnabot-web`
depois do `apply`.

## 5. Como reverter

Reverter é tirar os dois `volumeMounts` — o layout volta a ser o da imagem e o script deixa de ser
servido. O ConfigMap pode ficar (não faz nada sozinho).

```bash
# remove só os 2 montes novos e o volume, preservando os das logomarcas.
# Confira os índices antes: eles dependem da ordem atual da lista.
kubectl -n ragnabot get deploy ragnabot-web \
  -o jsonpath='{range .spec.template.spec.containers[0].volumeMounts[*]}{.mountPath}{"\n"}{end}'

kubectl -n ragnabot patch deploy ragnabot-web --type=json -p '[
  {"op":"remove","path":"/spec/template/spec/containers/0/volumeMounts/4"},
  {"op":"remove","path":"/spec/template/spec/containers/0/volumeMounts/3"},
  {"op":"remove","path":"/spec/template/spec/volumes/1"}
]'
kubectl -n ragnabot rollout status deploy/ragnabot-web
```

Remover de trás para a frente (índice maior primeiro) — senão o segundo `remove` acerta o item
errado. Caminho alternativo, mais seguro se a lista tiver mudado: editar `deploy/k8s/ragnabot.yaml`
e reaplicar o manifesto inteiro.

## 6. ⚠️ Ponto de manutenção — leia antes de subir a versão do Chatwoot

**Montar o layout por cima é customização, e customização de layout tem custo recorrente.**

O arquivo `/app/app/views/layouts/vueapp.html.erb` **pertence à imagem do Chatwoot**. Ao montar o
nosso por cima, o pod passa a renderizar a NOSSA cópia — que é a do digest
`chatwoot/chatwoot@sha256:18f280a6…` (extraída em 29/08/2026). Consequência direta:

> Quando a imagem do Chatwoot subir de versão, o layout novo dela **não será usado** — o pod vai
> continuar renderizando a nossa cópia antiga. Isso pode quebrar o painel em silêncio (por exemplo,
> se a versão nova passar a injetar uma configuração nova no `window.chatwootConfig` que o nosso
> `.erb` congelado não tem).

**O procedimento obrigatório a cada troca de imagem:**

1. Subir a imagem **sem** o monte do `.erb` (ou aceitar que o painel roda o layout velho por alguns
   minutos).
2. Reextrair o layout da imagem NOVA:
   `kubectl -n ragnabot exec <pod> -- cat /app/app/views/layouts/vueapp.html.erb > vueapp-original.html.erb`
3. Conferir o `diff` contra a cópia antiga — para saber o que mudou.
4. Reaplicar a **única** linha do `<script>` logo após o `</script>` que fecha o bloco do
   `window.chatwootConfig`, regravar `vueapp.html.erb`, regenerar o ConfigMap e refazer o rollout.
5. Conferir que `diff vueapp-original.html.erb vueapp.html.erb` mostra **exatamente uma** linha.

O script `ragnabot-identidade.js` **não** tem esse custo: ele não substitui arquivo da imagem, só é
acrescentado. Se um dia a estrutura do rodapé mudar, ele deixa de achar a âncora e fica em silêncio —
o painel não quebra, as linhas somem, e aí é só ajustar a âncora.

### Alternativa sem montar o layout (medida, não implementada)

A imagem tem uma configuração de instalação chamada **`DASHBOARD_SCRIPTS`**
(`config/installation_config.yml`, descrição: *"Scripts are loaded as the last item in the `<body>`
tag"*), renderizada pelo layout como `<%= @dashboard_scripts.html_safe %>`. Pondo ali apenas
`<script src="/brand-assets/ragnabot-identidade.js"></script>`, a mesma tag entra na página **sem
substituir arquivo nenhum da imagem** — e o ponto de manutenção da seção 6 deixa de existir; sobra só
o monte do `.js`, que é acréscimo puro.

Não foi o caminho entregue porque o contrato pediu o `.erb`, e porque essa configuração é **por
instalação** e gravada no banco (`installation_configs`) — o que muda a natureza da alteração: deixa
de ser infraestrutura versionada em Git e passa a ser um dado do banco. Fica registrado como opção
para o chefe decidir.

## 7. Ao subir a versão do produto

Bump em três lugares, sempre juntos:

1. `VERSAO` (raiz do repositório);
2. bloco novo no topo de `docs/VERSOES.md`;
3. a constante `var VERSAO = '…'` em `deploy/identidade/ragnabot-identidade.js` — e regerar o
   ConfigMap + `rollout restart`, senão o painel continua mostrando a versão anterior.

O passo 3 é fácil de esquecer. Um painel mostrando versão errada é pior do que não mostrar versão
nenhuma.
