# Marca do Ragnabot na plataforma — como aplicar, como reverter, e o que não tem conserto

**Ordem do dono (30/08/2026, com foto):** *"olha como está a tela do super admin, já tinha
solicitado para adequar ao frontend do Ragnabot"* — a tela mostra a logomarca do Chatwoot,
"Howdy, admin 👋" e os campos "Email Address" / "Password" / "Login" em inglês.

**Estado deste diretório: preparado, NADA aplicado.** Levantamento feito só com leitura no cluster
(`kubectl get`, `kubectl exec … cat/grep/ls` e `GET` na própria aplicação). Quem aplica é o
chefe/dono.

---

## Os arquivos daqui

| Arquivo | Para que serve |
|---|---|
| `DIAGNOSTICO.md` | O que exatamente pinta aquela tela, com arquivo e linha. O que é configurável e o que não é. |
| `valores-de-marca.md` | **A lista pronta** de chave → valor para colar em App Configs. |
| `PENDENTE-IMAGEM.md` | O que só muda mexendo em arquivo da imagem, com custo e recomendação. Decisão do chefe. |

---

## A resposta curta, antes de tudo

> **As telas de super administrador do Chatwoot 4.17.1 NÃO são personalizáveis por configuração.**

A logomarca (`/brand-assets/logo.svg`) e o texto ("Howdy, admin 👋", "Email Address", "Password",
"Login") estão **escritos à mão** dentro de `app/views/super_admin/devise/sessions/new.html.erb`.
Não passam por `GlobalConfig`, não passam por arquivo de idioma, e o ponto de injeção que usamos
hoje (`DASHBOARD_SCRIPTS`) **não alcança** essas telas — ele só existe no layout do painel do
atendente (`layouts/vueapp.html.erb:81`).

Isso significa, sem rodeio: **preencher as App Configs não muda a tela da foto do dono.** Muda
tudo o mais.

O que dá para fazer, em ordem de custo:

1. **De graça, agora:** aplicar `valores-de-marca.md` → marca correta no login do atendente, no
   painel, nos e-mails, no widget e na central de ajuda. *(Descoberta desta tarefa: **nenhuma**
   dessas chaves foi alterada até hoje — a instalação inteira ainda está com a marca de fábrica do
   Chatwoot.)*
2. **Barato, com decisão do chefe:** trocar a **logomarca** das telas de super admin, montando os
   SVG do Ragnabot por cima dos do Chatwoot — item 1 de `PENDENTE-IMAGEM.md`. Sem custo de
   manutenção.
3. **Caro, e eu recomendo não fazer:** traduzir os textos do super admin, sobrepondo a view da
   imagem — item 2 de `PENDENTE-IMAGEM.md`. Custa reextrair e remendar a cada atualização do
   Chatwoot, e pode travar a entrada do console se falhar.

---

## Como aplicar (passo 1 — o único que está pronto para uso)

1. Entrar como super administrador: `https://bot.ragnatela.com.br/super_admin`
2. Menu **Settings** → **App Configs**.
3. Preencher as 7 chaves da tabela de `valores-de-marca.md` §1 (as duas últimas, `TERMS_URL` e
   `PRIVACY_URL`, **ficam como estão** até o dono confirmar se as páginas existem — §4 daquele
   arquivo explica).
4. Salvar e recarregar o painel com Ctrl+F5.

**Não precisa de `rollout`, não precisa reiniciar pod.** Os valores vivem no banco
(`InstallationConfig`) e passam a valer na requisição seguinte.

**Não há janela de risco de sessão** — este passo não reinicia nada.

## Como reverter (passo 1)

Voltar cada campo ao valor de fábrica, listado em `DIAGNOSTICO.md` §4 (coluna "Valor de fábrica"):

```
INSTALLATION_NAME = Chatwoot
BRAND_NAME        = Chatwoot
LOGO              = /brand-assets/logo.svg
LOGO_DARK         = /brand-assets/logo_dark.svg
LOGO_THUMBNAIL    = /brand-assets/logo_thumbnail.svg
BRAND_URL         = https://www.chatwoot.com
WIDGET_BRAND_URL  = https://www.chatwoot.com
```

Salvar. Nada mais precisa ser desfeito — não há arquivo, volume nem pod envolvido.

---

## O que NÃO tem solução por configuração (a lista final)

Mesmo com tudo do passo 1 aplicado, **continuam com a marca do Chatwoot**:

| O quê | Onde está escrito | Sai por configuração? |
|---|---|---|
| Logomarca do login do super admin | `super_admin/devise/sessions/new.html.erb:12-13` | **Não** — caminho fixo. Só trocando o arquivo SVG. |
| "Howdy, admin 👋" | `…/new.html.erb:15` | **Não** — texto literal. |
| "Email Address" / "Password" / "Login" | `…/new.html.erb:26, 34, 41` | **Não** — texto literal. |
| Título "SuperAdmin \| Chatwoot" | `…/new.html.erb:4` | **Não** — texto literal. |
| Logomarca da barra do console | `super_admin/application/_navigation.html.erb:26` | **Não** — caminho fixo. |
| "Chatwoot 4.17.1" / "Super Admin Console" | `…/_navigation.html.erb:28-29` | **Não** — texto literal. |
| Título "… - Chatwoot" das telas do console | `layouts/super_admin/application.html.erb:22` + gem `administrate` | **Não** — vem do nome do módulo Ruby. |
| Ícones pequenos e `manifest.json` | `/app/public/*.png`, `/app/public/manifest.json` | **Não** — arquivos da imagem. `LOGO_THUMBNAIL` só cobre o de 512px. |

---

## Uma observação que não é de marca, mas convém

O console de super admin carrega o **widget de suporte do próprio Chatwoot**
(`super_admin/application/_javascript.html.erb:23-48`), apontado para `https://hub.2.chatwoot.com`,
e envia para lá o identificador da instalação e o **e-mail e o nome do primeiro super admin**. A
bolha fica escondida (`hideMessageBubble: true`), então não aparece na tela — não é o que o dono
viu. Mas é uma chamada para fora com dado nosso, a cada abertura do console. Fica registrado para
o chefe decidir se vira tarefa.

---

## Versionamento do produto

Este diretório é **diagnóstico e preparação** — ainda não é funcionalidade entregue e por isso
**não** subi `VERSAO`, `VERSOES.md` nem `MANUAL.md`. Quando o chefe decidir o que aplicar, a
entrada de versão deve descrever o que efetivamente mudou na tela, e não a intenção.
