# Diagnóstico — a marca do Chatwoot no painel de SUPER ADMINISTRADOR

> Levantamento feito em 30/08/2026 lendo os arquivos **dentro do pod em produção**
> (`ragnabot-web-646797487f-7xcmn`, namespace `ragnabot`, Chatwoot 4.17.1, imagem fixada por digest).
> Tudo abaixo é leitura — nada foi aplicado, nada foi escrito no cluster.

---

## 1. Qual tela é essa

O que o dono fotografou — logomarca do Chatwoot, **"Howdy, admin 👋"**, campos *Email Address* /
*Password* e botão *Login* — é a tela de entrada do console de super administrador:

```
https://bot.ragnatela.com.br/super_admin        →  redireciona para
https://bot.ragnatela.com.br/super_admin/sign_in
```

Confirmado ao vivo, pedindo a página ao próprio pod (GET, sem escrever nada):

```
GET http://10.244.229.207:3000/super_admin/sign_in
  4:    <title>SuperAdmin | Chatwoot</title>
 12:          <img src="/brand-assets/logo.svg" alt="Chatwoot" ...>
 13:          <img src="/brand-assets/logo_dark.svg" alt="Chatwoot" ...>
 15:            Howdy, admin 👋
```

A raiz `/` é outra tela (o painel do atendente, layout `vueapp`) e responde `200` com
`<title>Chatwoot</title>` — ou seja, **as duas estão com a marca errada**, mas por motivos
diferentes, e só uma delas tem conserto por configuração.

---

## 2. Quem pinta a tela do super admin

O console de super administrador **não é o aplicativo Vue**. É Rails puro, gerado pela gem
`administrate 0.20.1`, com views próprias em `/app/app/views/super_admin/` e um layout dedicado em
`/app/app/views/layouts/super_admin/application.html.erb`. O login é `devise`.

### 2.1 A tela de login — `/app/app/views/super_admin/devise/sessions/new.html.erb`

```erb
 4:    <title>SuperAdmin | Chatwoot</title>
...
12:          <img src="/brand-assets/logo.svg"      alt="Chatwoot" class="mx-auto h-8 w-auto block dark:hidden">
13:          <img src="/brand-assets/logo_dark.svg" alt="Chatwoot" class="mx-auto h-8 w-auto hidden dark:block">
14:          <h2 class="mt-6 text-center text-3xl font-medium ...">
15:            Howdy, admin 👋
16:          </h2>
...
26:                Email Address
34:                  Password
41:                <span>Login</span>
```

**Três fatos que decidem tudo:**

1. **A logomarca está com o caminho escrito à mão na view** (`/brand-assets/logo.svg`). Ela **não**
   passa por `GlobalConfig`, **não** lê a configuração `LOGO` nem `LOGO_DARK`.
2. **"Howdy, admin 👋" é texto literal** dentro do `<h2>`. Não é chave de tradução — foi conferido:
   a palavra "Howdy" só existe em dois arquivos da aplicação inteira, e nenhum deles é arquivo de
   idioma:
   ```
   /app/app/views/installation/onboarding/index.html.erb:15:  Howdy, Welcome to Chatwoot 👋
   /app/app/views/super_admin/devise/sessions/new.html.erb:15: Howdy, admin 👋
   ```
   Logo: **mudar o idioma da instalação não traduz esta tela.**
3. **"Email Address", "Password" e "Login" também são literais** (linhas 26, 34 e 41), pelo mesmo
   motivo.

### 2.2 A barra lateral de dentro do console — `/app/app/views/super_admin/application/_navigation.html.erb`

```erb
26:      <%= link_to image_tag('/brand-assets/logo_thumbnail.svg', alt: 'Chatwoot Admin Dashboard', class: 'h-10'), super_admin_root_url %>
27:      <div class="flex flex-col ml-3">
28:        <div class="text-sm">Chatwoot <%= Chatwoot.config[:version] %></div>
29:        <div class="text-xs text-slate-700 mt-0.5">Super Admin Console</div>
30:      </div>
```

Mesma história: caminho da logomarca escrito à mão, e as palavras "Chatwoot 4.17.1" e
"Super Admin Console" são literais.

### 2.3 O título da aba, dentro do console — `/app/app/views/layouts/super_admin/application.html.erb`

```erb
21:  <title>
22:    <%= content_for(:title) %> - <%= application_title %>
23:  </title>
```

`application_title` vem da gem, não da nossa configuração:

```ruby
# /gems/ruby/3.4.0/gems/administrate-0.20.1/app/helpers/administrate/application_helper.rb
6:    def application_title
7:      Rails.application.class.module_parent_name.titlecase
8:    end
```

Isso devolve o nome do **módulo Ruby da aplicação** — que é `Chatwoot`. Não há configuração
nenhuma nesse caminho: o título "… - Chatwoot" só mudaria renomeando o módulo Ruby, ou seja,
recompilando a aplicação.

---

## 3. O ponto de injeção que usamos hoje (`DASHBOARD_SCRIPTS`) **NÃO alcança** estas telas

Era a suspeita do chefe, e está **confirmada**. A configuração aparece em exatamente três lugares:

```
/app/app/controllers/dashboard_controller.rb:34:  before_action :set_dashboard_scripts
/app/app/controllers/dashboard_controller.rb:54:    @dashboard_scripts = sensitive_path? ? nil : GlobalConfig.get_value('DASHBOARD_SCRIPTS')
/app/app/views/layouts/vueapp.html.erb:81:    <% if @dashboard_scripts.present? %>
/app/app/views/layouts/vueapp.html.erb:82:      <%= @dashboard_scripts.html_safe %>
```

Só `vueapp.html.erb` — o layout do **painel do atendente**. O layout do super admin
(`layouts/super_admin/application.html.erb`) e a view de login (`devise/sessions/new.html.erb`)
não têm essa injeção, e a view de login nem sequer usa layout: é um HTML completo, do `<!DOCTYPE>`
ao `</html>`, escrito dentro do próprio arquivo.

**Não existe, na imagem, nenhum outro ponto oficial de injeção que alcance o super admin.** O
único parente é `Administrate::Engine.javascripts` (iterado em
`super_admin/application/_javascript.html.erb:10`), mas essa lista é preenchida por código Ruby de
inicialização — não por configuração de instalação — e mesmo assim ela só entra nas telas *de
dentro* do console, nunca no login.

---

## 4. As configurações oficiais de marca — o que elas realmente alcançam

`/app/config/installation_config.yml`, bloco "Branding Related Config" (linhas 17–58):

| Chave | Valor de fábrica (linha) |
|---|---|
| `INSTALLATION_NAME` | `Chatwoot` (18) |
| `LOGO_THUMBNAIL` | `/brand-assets/logo_thumbnail.svg` (22) |
| `LOGO` | `/brand-assets/logo.svg` (26) |
| `LOGO_DARK` | `/brand-assets/logo_dark.svg` (30) |
| `BRAND_URL` | `https://www.chatwoot.com` (34) |
| `WIDGET_BRAND_URL` | `https://www.chatwoot.com` (38) |
| `BRAND_NAME` | `Chatwoot` (42) |
| `TERMS_URL` | `https://www.chatwoot.com/terms-of-service` (46) |
| `PRIVACY_URL` | `https://www.chatwoot.com/privacy-policy` (50) |
| `DISPLAY_MANIFEST` | `true` (54) |

### 4.1 Estado medido hoje: **nenhuma delas foi alterada**

Lido da própria página do painel (o Rails publica os valores efetivos em `window.globalConfig`):

```json
{"LOGO":"/brand-assets/logo.svg","LOGO_DARK":"/brand-assets/logo_dark.svg",
 "LOGO_THUMBNAIL":"/brand-assets/logo_thumbnail.svg","INSTALLATION_NAME":"Chatwoot",
 "WIDGET_BRAND_URL":"https://www.chatwoot.com","TERMS_URL":"https://www.chatwoot.com/terms-of-service",
 "BRAND_URL":"https://www.chatwoot.com","BRAND_NAME":"Chatwoot",
 "PRIVACY_URL":"https://www.chatwoot.com/privacy-policy","DISPLAY_MANIFEST":true, ...}
```

Ou seja: **a marca do produto nunca foi configurada em lugar nenhum da instalação.** O trabalho
anterior (R1) tratou de outra coisa — nome da empresa e versão no rodapé do painel do atendente,
por `DASHBOARD_SCRIPTS` — e não mexeu nestas chaves. Preenchê-las é ganho real e imediato, mas
**no painel do atendente**, não no super admin.

### 4.2 Onde cada chave é de fato consumida (grep na aplicação)

- `INSTALLATION_NAME` → título e descrição do painel do atendente
  (`layouts/vueapp.html.erb:5` e `:12`), widget (`widgets/show.html.erb:4`), pesquisa de satisfação,
  central de ajuda, notificação push de teste.
  **E mais:** o front tem um substituidor de marca,
  `/app/app/javascript/shared/composables/useBranding.js`, que troca a palavra literal "Chatwoot"
  pelo `INSTALLATION_NAME` nos textos do painel. Isso limpa boa parte do "Chatwoot" que aparece
  escrito nas telas do atendente.
- `LOGO` / `LOGO_DARK` / `LOGO_THUMBNAIL` → `window.globalConfig` (painel Vue: tela de login do
  atendente, cabeçalhos), favicon 512px do painel (`layouts/vueapp.html.erb:31`), rodapé da central
  de ajuda (`portals/_footer.html.erb:9`).
- `BRAND_NAME` / `BRAND_URL` → **e-mails** (`app/mailers/application_mailer.rb:15` e `:57`;
  `layouts/mailer/base.liquid:93` e `:97`), widget, central de ajuda.
- `WIDGET_BRAND_URL` → "Powered by" do widget e da pesquisa de satisfação.

**Nenhuma delas aparece em qualquer arquivo de `super_admin/`.** Grep completo por
`brand-assets` na aplicação:

```
/app/app/views/installation/onboarding/index.html.erb:12,13   ← caminho literal
/app/app/views/super_admin/application/_navigation.html.erb:26 ← caminho literal
/app/app/views/super_admin/devise/sessions/new.html.erb:12,13  ← caminho literal
/app/app/javascript/dashboard/components-next/year-in-review/ShareModal.vue:98
```

---

## 5. O que dá para mudar, separado com clareza

### (a) O que dá para mudar **só por configuração** (App Configs, pela tela)

Tudo isto passa a mostrar **Ragnabot / Ragnatela** sem tocar em arquivo nenhum:

- tela de **login do atendente** (a que o cliente vê) — logomarca e nome;
- **título da aba** e descrição do painel do atendente;
- **favicon 512px** do painel;
- textos do painel do atendente que hoje dizem "Chatwoot" (via `useBranding`);
- **e-mails** transacionais (nome e link do "Powered by");
- **widget** de site e **pesquisa de satisfação**;
- **central de ajuda** (rodapé).

Valores prontos para colar: `valores-de-marca.md` (ao lado deste arquivo).

### (b) O que **só** mudaria mexendo em arquivo da imagem

- **A logomarca das telas de super admin** (login e barra lateral do console) — porque o caminho
  `/brand-assets/logo.svg`, `logo_dark.svg` e `logo_thumbnail.svg` está escrito na view.
  *Atenuante importante:* aqui o "arquivo" é um **SVG**, não código. Trocá-lo é o item de menor
  risco desta lista, e o mecanismo (montagem por `subPath` de ConfigMap) **já existe e já está em
  produção** neste mesmo diretório do contêiner — não exige reconstruir imagem.
- **Os textos em inglês do super admin** — "Howdy, admin 👋", "Email Address", "Password",
  "Login", "Chatwoot 4.17.1", "Super Admin Console", "SuperAdmin | Chatwoot". São literais dentro
  de `.erb`. Mudar significa **sobrepor código da imagem** — exatamente o caminho que o chefe já
  rejeitou em `deploy/identidade/LEIA-ME.md` quando havia alternativa. Aqui **não há alternativa
  por configuração**.
- **O título "… - Chatwoot"** das telas de dentro do console — vem do nome do módulo Ruby. Nem
  sobrepondo view resolve direito; só recompilando.
- **Os favicons pequenos e o `manifest.json`** (`/app/public/favicon-32x32.png`,
  `android-icon-*.png`, `apple-icon-*.png`, `manifest.json` com `"name": "Chatwoot"`) — são
  arquivos PNG/JSON da imagem. A configuração `LOGO_THUMBNAIL` só cobre o ícone de 512px.

Detalhe, custo e recomendação honesta: `PENDENTE-IMAGEM.md`.

### (c) Um terceiro caminho que existe, e por que eu **não** recomendo

Reescrever o HTML na saída, no proxy, com `sub_filter` do nginx — trocando "Howdy, admin 👋" por
texto em português antes de a página chegar ao navegador.

**É tecnicamente possível:** o controlador de entrada do cluster tem o módulo compilado —
`nginx -V` no pod `ingress-nginx-controller-79bf79fcc6-ftd4h` mostra `--with-http_sub_module`.

**Mas o custo é alto e é do tipo errado.** A versão em uso é `ingress-nginx v1.12.0`, e nela os
"snippets" de configuração vêm **desligados de fábrica**: o `ConfigMap` do controlador hoje tem
apenas `{"enable-underscores-in-headers":"true"}`. Para usar `sub_filter` seria preciso ligar
`allow-snippet-annotations` e afrouxar o nível de risco de anotações — **no controlador inteiro**,
que atende todo o cluster. Trocar a marca de uma tela de login não justifica baixar a guarda da
porta de entrada de tudo.

Há ainda o nginx externo em `185.100.215.99` (para onde `bot.ragnatela.com.br` resolve), que é o
proxy compartilhado com cerca de 20 sites. **Eu não medi** se ele tem `ngx_http_sub_module` — não
está cadastrado como dispositivo no NOC e a checagem sai do escopo desta tarefa. Registro como não
medido, não como impossível. Mesmo que tivesse, mexer no proxy compartilhado por causa de estética
de uma tela é risco desproporcional (memória da casa: cópia de vhost em `sites-enabled` já derrubou
site por 2h47).

---

## 6. Um achado de passagem (não é marca, mas o dono deve saber)

`/app/app/views/super_admin/application/_javascript.html.erb`, linhas 23–48: o console de super
admin carrega o **widget de suporte do próprio Chatwoot**, apontando para o hub deles
(`/app/lib/chatwoot_hub.rb:3` → `DEFAULT_BASE_URL = 'https://hub.2.chatwoot.com'`), e chama
`setUser` com o identificador da instalação e o **e-mail e nome do primeiro super admin**:

```erb
43:  window.$chatwoot.setUser('<%= ChatwootHub.installation_identifier %>', {
44:    identifier_hash: '<%= ChatwootHub.support_config[:support_identifier_hash] %>',
45:    email: '<%= SuperAdmin.first.email %>',
46:    name: '<%= SuperAdmin.first.name %>'
47:  });
```

A bolha fica escondida (`hideMessageBubble: true`), então **não aparece na tela** — não é o
problema visual que o dono relatou. Mas é uma chamada para fora, com dado nosso, a cada abertura do
console. Fica registrado para o chefe decidir se vira tarefa separada.

---

## 7. Resumo em uma frase

**As telas de super administrador do Chatwoot 4.17.1 não são personalizáveis por configuração.**
A logomarca dá para trocar sem tocar em código (substituindo o arquivo SVG que a view referencia
por caminho fixo, usando a montagem de ConfigMap que já está em produção); **o "Howdy, admin 👋" e
os rótulos em inglês, não** — eles estão escritos dentro do `.erb` e só mudam sobrepondo código da
imagem, com o custo de refazer a cada atualização do Chatwoot.

O que a configuração **resolve de verdade, hoje, e ainda não foi feito** é a marca em tudo o que o
**cliente** vê: login do atendente, painel, e-mails, widget e central de ajuda — todas as chaves
ainda estão no valor de fábrica do Chatwoot.
