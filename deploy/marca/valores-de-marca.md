# Valores de marca — para colar em `/super_admin` → **Settings → App Configs**

> Caminho: `https://bot.ragnatela.com.br/super_admin` → menu **Settings** → **App Configs**.
> É a mesma tela já usada para o `DASHBOARD_SCRIPTS` (`deploy/identidade/LEIA-ME.md`).
>
> **Estado medido em 30/08/2026: todas as chaves abaixo ainda estão no valor de fábrica do
> Chatwoot.** Nenhuma foi alterada até hoje.
>
> ⚠️ **Isto NÃO muda a tela de super admin** (logomarca do Chatwoot + "Howdy, admin 👋").
> Aquelas telas não leem estas configurações — o motivo, com arquivo e linha, está em
> `DIAGNOSTICO.md` §2 e §4.2. O que muda aqui é **tudo o que o cliente e o atendente veem**.

---

## 1. A lista, chave por chave

| # | Chave | Valor a colar |
|---|---|---|
| 1 | `INSTALLATION_NAME` | `Ragnabot` |
| 2 | `BRAND_NAME` | `Ragnabot` |
| 3 | `LOGO` | `/brand-assets/ragnabot-logo.svg` |
| 4 | `LOGO_DARK` | `/brand-assets/ragnabot-logo-dark.svg` |
| 5 | `LOGO_THUMBNAIL` | `/brand-assets/ragnabot-logo-thumb.svg` |
| 6 | `BRAND_URL` | `https://ragnatela.com.br` |
| 7 | `WIDGET_BRAND_URL` | `https://ragnatela.com.br` |
| 8 | `DISPLAY_MANIFEST` | *manter ligado* (ver §3) |
| 9 | `TERMS_URL` | **decisão pendente** — ver §4 |
| 10 | `PRIVACY_URL` | **decisão pendente** — ver §4 |

Os três caminhos de logomarca (3, 4, 5) **já existem dentro do contêiner** — foram conferidos
hoje, arquivo por arquivo, por `sha256sum` no pod:

```
8403f235…  /app/public/brand-assets/ragnabot-logo.svg        == design/marca/logo.svg        (repo)
a509fed7…  /app/public/brand-assets/ragnabot-logo-dark.svg   == design/marca/logo_dark.svg   (repo)
a7cc5424…  /app/public/brand-assets/ragnabot-logo-thumb.svg  == design/marca/logo_thumbnail.svg (repo)
```

Chegam lá pelo `ConfigMap ragnabot-branding`, montado por `subPath` no `Deployment ragnabot-web`
(3 montagens, conferidas no `deploy` em execução). **Nada precisa ser montado a mais para esta
lista funcionar** — basta apontar as configurações para esses caminhos.

Detalhe de forma: `ragnabot-logo.svg` e `ragnabot-logo-dark.svg` têm `viewBox="0 0 200 48"`
(proporção ~4,2:1, logomarca deitada) e `ragnabot-logo-thumb.svg` é quadrado (`0 0 48 48`) —
as mesmas proporções que o Chatwoot espera nesses três papéis.

---

## 2. O que cada valor muda na tela (medido no código, com arquivo e linha)

**`INSTALLATION_NAME` = Ragnabot**
- Título da aba do painel do atendente — `layouts/vueapp.html.erb:5`.
- Descrição da página (o que aparece quando alguém compartilha o link) — `vueapp.html.erb:12`.
- Título do widget de site — `widgets/show.html.erb:4`; da pesquisa de satisfação —
  `survey/responses/show.html.erb:4`; rodapé da central de ajuda —
  `portals/_footer.html.erb:14` e `documentation_layout/_footer.html.erb:33`.
- **E o principal:** o painel tem um substituidor de marca,
  `shared/composables/useBranding.js`, que troca a palavra "Chatwoot" pelo `INSTALLATION_NAME`
  nos textos do aplicativo. Com isso, a maior parte do "Chatwoot" escrito nas telas do atendente
  passa a ler "Ragnabot" sem tocar em código.

**`BRAND_NAME` = Ragnabot**
- **E-mails transacionais** — `app/mailers/application_mailer.rb:15` e `:57`;
  `layouts/mailer/base.liquid:93`.
- Widget e pesquisa de satisfação — `widgets_controller.rb:19`,
  `api/v1/widget/configs_controller.rb:14`.
- Central de ajuda (texto alternativo da logomarca) — `portals/_footer.html.erb:8`.

**`LOGO` / `LOGO_DARK`**
- Publicados em `window.globalConfig` e lidos pelo painel Vue (`shared/store/globalConfig.js:19-20`)
  → **tela de login do atendente** (a que o cliente abre) e cabeçalhos, nos temas claro e escuro.

**`LOGO_THUMBNAIL`**
- Favicon 512px do painel — `layouts/vueapp.html.erb:31`.
- Ícone do rodapé da central de ajuda — `documentation_layout/_footer.html.erb:31`.
- Ícone da pesquisa de satisfação — `survey/responses_controller.rb:8`.

**`BRAND_URL` = https://ragnatela.com.br**
- Link do "Powered by" nos **e-mails** — `layouts/mailer/base.liquid:97`.
- Link do rodapé da central de ajuda — `portals/_footer.html.erb:14`.

**`WIDGET_BRAND_URL` = https://ragnatela.com.br**
- Link do "Powered by" **dentro do widget** de site e da pesquisa de satisfação.

> Por que `BRAND_URL` e `WIDGET_BRAND_URL` apontam para `ragnatela.com.br` e não para
> `bot.ragnatela.com.br`: esses dois links são a assinatura de **quem fornece a plataforma**.
> Quem fornece é a **Ragnatela IoT Solutions**; `Ragnabot` é o nome do produto. É a mesma leitura
> do rodapé "Infraestrutura cloud gerenciada por Ragnatela IoT Solutions" já usado em produção.

---

## 3. `DISPLAY_MANIFEST` — deixe ligado, e por quê

Ligado (`true`, valor de hoje), o painel emite o bloco de ícones e metadados
(`layouts/vueapp.html.erb:8-30`). Nesse bloco:

- o **ícone de 512px** já passa a ser o nosso, porque sai de `LOGO_THUMBNAIL` (linha 31);
- os **ícones pequenos** (`favicon-32x32.png`, `apple-icon-*.png`, `android-icon-*.png`) e o
  `manifest.json` continuam sendo **arquivos PNG/JSON da imagem do Chatwoot** — configuração
  nenhuma alcança isso (ver `PENDENTE-IMAGEM.md`, item 3).

Desligar (`false`) tiraria o "Chatwoot" do `manifest.json`, mas tiraria junto **todos** os ícones,
o `theme-color` e a instalação como aplicativo. **Trocar um ícone errado por nenhum ícone é
piorar.** Recomendação: manter ligado e tratar os PNG separadamente, se o dono quiser.

---

## 4. As duas chaves que eu **não** preenchi — e por que não

`TERMS_URL` e `PRIVACY_URL` apontam hoje para as páginas do Chatwoot
(`https://www.chatwoot.com/terms-of-service` e `/privacy-policy`). Elas aparecem na tela de
cadastro e no painel.

Eu **não escolhi um endereço** por dois motivos, e os dois são honestos:

1. **Não confirmei que existe página nossa de termos e de privacidade.** Chutar
   `https://ragnatela.com.br/termos` e o link dar erro é pior do que a página do Chatwoot: vira
   promessa quebrada em documento jurídico. E medir isso daqui de dentro é cego — a rede da casa
   tem retorno de NAT que faz `curl` ao nosso próprio endereço público responder errado.
2. **Site e conteúdo público passam pelo agente `site-ragnatela`**, que é quem decide texto,
   endereço e publicação. Não é decisão minha.

**Encaminhamento sugerido ao chefe:** perguntar ao dono se as páginas existem. Se existirem, colar
os dois endereços. Se não existirem, **deixar as duas chaves como estão** até a publicação — um
link do Chatwoot é constrangedor, mas um link quebrado em "Termos de Uso" é problema de outra
ordem.

---

## 5. Depois de salvar

- O valor vale **na hora**, para toda requisição nova — as configurações vivem no banco
  (`InstallationConfig`), não em arquivo. **Não precisa reiniciar pod nem fazer rollout.**
- Basta **recarregar a página** do painel (Ctrl+F5) para ver a logomarca e o título novos.
- Se algo ficar estranho: reverta colando o valor de fábrica da tabela de
  `DIAGNOSTICO.md` §4 (a coluna "Valor de fábrica"). A tela guarda o histórico do que você digitou;
  nada é destrutivo.

---

## 6. O que continua com a marca do Chatwoot depois de tudo isso

Para não haver ilusão. Depois de aplicar as 7 chaves acima, **continuam mostrando "Chatwoot"**:

1. `https://bot.ragnatela.com.br/super_admin/sign_in` — logomarca, "Howdy, admin 👋",
   "Email Address", "Password", "Login", título "SuperAdmin | Chatwoot". **É exatamente a tela da
   foto do dono.**
2. A barra lateral de dentro do console de super admin — logomarca, "Chatwoot 4.17.1",
   "Super Admin Console".
3. O título das abas de dentro do console — "… - Chatwoot".
4. Os ícones pequenos (`favicon-32x32.png` e companhia) e o `manifest.json`.

Os motivos, com arquivo e linha, estão em `DIAGNOSTICO.md`. O que seria preciso para atacar cada
um deles — e quanto custa — está em `PENDENTE-IMAGEM.md`.
