# Pendente — o que só muda mexendo em arquivo da imagem

> **Nada aqui está feito.** Este documento existe para o chefe decidir, não para ser aplicado.
> Conforme o contrato, **não escrevi o remendo**: os blocos de configuração abaixo estão no texto
> como *ilustração da forma que teria*, não como arquivo pronto para `kubectl apply`.
>
> Base de comparação: em `deploy/identidade/LEIA-ME.md` o chefe **rejeitou** sobrepor arquivo da
> imagem quando havia alternativa por configuração. Aqui **não há alternativa por configuração** —
> por isso a pergunta volta para ele.

---

## Item 1 — A logomarca das telas de super admin

### O que é

As três telas do console de super administrador referenciam a logomarca por **caminho fixo escrito
na view**, sem passar por configuração:

```
super_admin/devise/sessions/new.html.erb:12   /brand-assets/logo.svg
super_admin/devise/sessions/new.html.erb:13   /brand-assets/logo_dark.svg
super_admin/application/_navigation.html.erb:26  /brand-assets/logo_thumbnail.svg
```

Hoje esses três arquivos, dentro do pod, são os do Chatwoot:

```
eb58549b…  /app/public/brand-assets/logo.svg
dc1e4b03…  /app/public/brand-assets/logo_dark.svg
a2bf806b…  /app/public/brand-assets/logo_thumbnail.svg
```

### O que seria

Acrescentar três montagens ao `ConfigMap ragnabot-branding`, apontando as **chaves que já
existem** (`ragnabot-logo.svg`, `ragnabot-logo-dark.svg`, `ragnabot-logo-thumb.svg`) para os
**nomes que a view procura**. A forma seria esta — *ilustração, não aplicar*:

```yaml
# ILUSTRAÇÃO — não é arquivo aplicável. Só depois de decisão do chefe.
- mountPath: /app/public/brand-assets/logo.svg
  name: branding
  subPath: ragnabot-logo.svg
- mountPath: /app/public/brand-assets/logo_dark.svg
  name: branding
  subPath: ragnabot-logo-dark.svg
- mountPath: /app/public/brand-assets/logo_thumbnail.svg
  name: branding
  subPath: ragnabot-logo-thumb.svg
```

Note que **é o mesmo mecanismo e o mesmo volume já em produção** — o `Deployment ragnabot-web`
hoje tem exatamente três montagens deste volume, com esta mesma sintaxe. Seriam mais três linhas
de três, no mesmo lugar. Não exige reconstruir imagem, não exige registro novo, não exige nada
além de um `rollout`.

### O custo real

- **Reaplicação a cada troca de versão do Chatwoot: NÃO.** A montagem é do Kubernetes, não da
  imagem. Ela é refeita a cada início de pod, com qualquer imagem. Sobrevive a atualização
  sozinha.
- **Risco de quebrar em silêncio: baixo, e do tipo benigno.** Se um dia o Chatwoot renomear esses
  arquivos, a montagem continua válida (só cria um arquivo que ninguém lê) e a tela volta a mostrar
  a logomarca deles. Ou seja: **degrada para o estado de hoje**, não para tela quebrada.
- **Efeito colateral:** substituir `logo.svg` afeta **todos** os lugares que apontam para esse
  caminho — incluindo a tela de primeira instalação (`installation/onboarding/index.html.erb:12`)
  e o cartão de compartilhamento do "Ano em Revisão"
  (`ShareModal.vue:98`). Nos dois casos o efeito é **desejável** (nossa marca no lugar da deles).
- **Redundância com as App Configs:** se as configurações `LOGO`/`LOGO_DARK`/`LOGO_THUMBNAIL`
  forem apontadas para `ragnabot-*.svg` (como recomenda `valores-de-marca.md`), este item vira
  redundante *para o painel do atendente* — mas continua sendo **a única forma** de mudar o super
  admin.

### Recomendação honesta

**Fazer.** É o único item desta lista com custo desproporcionalmente baixo em relação ao ganho:
resolve a metade visualmente mais gritante da foto do dono (a logomarca do Chatwoot no topo),
usando um mecanismo que já está em produção, sem custo de manutenção recorrente e com falha
benigna. Chamar isso de "sobrepor arquivo da imagem" é tecnicamente correto, mas o arquivo é um
desenho, não código — não há comportamento para divergir entre versões.

---

## Item 2 — Os textos em inglês do super admin

### O que é

```
super_admin/devise/sessions/new.html.erb:4    <title>SuperAdmin | Chatwoot</title>
super_admin/devise/sessions/new.html.erb:15   Howdy, admin 👋
super_admin/devise/sessions/new.html.erb:26   Email Address
super_admin/devise/sessions/new.html.erb:34   Password
super_admin/devise/sessions/new.html.erb:41   Login
super_admin/application/_navigation.html.erb:28  Chatwoot <versão>
super_admin/application/_navigation.html.erb:29  Super Admin Console
```

Todos **literais**, sem chave de tradução. Trocar o idioma da instalação não os alcança (prova em
`DIAGNOSTICO.md` §2.1, item 2).

### O que seria

Montar por `subPath` a **nossa cópia** de `devise/sessions/new.html.erb` e de
`application/_navigation.html.erb` por cima das da imagem — o mesmo caminho que a proposta inicial
do R1 tinha para o `vueapp.html.erb`, e que foi abandonado.

### O custo real

Este é o custo que o chefe já recusou uma vez, e com razão:

- **A cópia congela.** A partir da montagem, o pod renderiza **a nossa versão** dessas views, do
  digest de hoje, para sempre. Toda atualização do Chatwoot passa a ignorar as mudanças que eles
  fizerem nesses dois arquivos.
- **A falha é silenciosa e pode ser grave.** A view de login carrega
  `vite_client_tag` / `vite_javascript_tag 'superadmin'` e monta o formulário do `devise` com
  `form_for(resource, ...)`. Se uma versão futura mudar o nome do pacote do Vite, o token de
  segurança do formulário ou o caminho de `sign_in`, a nossa cópia congelada continua sendo
  servida — e o resultado é **não conseguir entrar no super admin**, sem mensagem de erro que
  aponte a causa. Perder a porta do super administrador em plena atualização é um estado ruim de
  se estar.
- **Manutenção obrigatória a cada troca de imagem:** reextrair os dois `.erb` da imagem nova,
  comparar com os nossos, reaplicar as traduções, regerar o ConfigMap, refazer o rollout — e
  conferir que a diferença voltou a ser só de texto. É procedimento manual, e é fácil de esquecer.

### Recomendação honesta

**Não fazer agora.** Custo-benefício ruim: o ganho é cosmético e para **uma única pessoa** — o
super administrador é o dono/o NOC, não é tela de cliente. O risco é travar a entrada do console
numa atualização futura.

Se o dono insistir (é direito dele; é a marca da empresa dele), a versão **menos ruim** é sobrepor
**só** `devise/sessions/new.html.erb` — a tela da foto — e **deixar** o
`_navigation.html.erb` como está. Uma view congelada em vez de duas, e a que menos muda entre
versões. Ainda assim exige o procedimento de reextração a cada atualização, e isso precisa entrar
como item fixo do runbook de upgrade, não como boa intenção.

---

## Item 3 — Ícones pequenos e `manifest.json`

### O que é

`/app/public/` traz os ícones do Chatwoot em PNG (`favicon-16x16.png`, `favicon-32x32.png`,
`favicon-96x96.png`, `favicon-512x512.png`, `apple-icon-*.png` em 9 tamanhos,
`android-icon-*.png` em 6, `apple-icon-precomposed.png`, `ms-icon-144x144.png`) e o
`manifest.json`, cujo conteúdo começa com:

```json
{ "name": "Chatwoot", "short_name": "Chatwoot", "icons": [ ... ] }
```

A configuração `LOGO_THUMBNAIL` só cobre **um** ícone (o de 512px, `layouts/vueapp.html.erb:31`).
Todo o resto é arquivo.

*(Nota: a tela de super admin não declara ícone nenhum e `/app/public/favicon.ico` não existe —
conferido. A aba dessa tela fica sem ícone, no branco padrão do navegador.)*

### O que seria

Gerar os PNG do ícone do Ragnabot em todos os tamanhos, mais um `manifest.json` nosso, e montar
cada um por `subPath` — cerca de **20 montagens novas**.

### O custo real

- Mesmo perfil do item 1 (montagem sobrevive a atualização, falha é benigna), **mas em volume**:
  20 montagens deixam o `Deployment` grande e chato de ler, e é preciso produzir e versionar 20
  imagens rasterizadas a partir do SVG.
- Não resolve o super admin. Só melhora o ícone da aba e o atalho de tela inicial do celular no
  painel do atendente.

### Recomendação honesta

**Adiar.** Ganho pequeno, trabalho de design ainda não feito (não existem os PNG do Ragnabot nos
tamanhos certos — o repositório tem `icone-marca-180/192/512.png` em `design/v2/assets/marca/`,
que cobre parte, mas não o conjunto). Se e quando o dono pedir, o caminho é claro e é o mesmo do
item 1.

---

## Resumo para a decisão do chefe

| Item | Resolve o que o dono viu? | Custo de manutenção | Risco | Recomendação |
|---|---|---|---|---|
| 1 — logomarca (3 SVG) | **Sim, metade** (a logomarca) | **nenhum** | baixo, falha benigna | **fazer** |
| 2 — textos em inglês | Sim, a outra metade | **alto** (a cada upgrade) | pode travar o login do super admin | **não fazer agora** |
| 3 — ícones/manifest | Não | médio (20 montagens) | baixo | adiar |

E, antes de qualquer um dos três: aplicar as chaves de `valores-de-marca.md`, que **não têm custo
nenhum** e resolvem a marca em tudo o que o cliente vê.
