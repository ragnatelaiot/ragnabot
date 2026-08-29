# Identidade no painel — nome da empresa + versão do Ragnabot

**Ordem do dono (29/08/2026):** *"a versão do Ragnabot atual sempre deve ser apresentada abaixo do
nome do usuário logado e no usuário logado deve ter o nome da empresa (empresa registrada como SaaS)."*

## O caminho escolhido, e por que é o melhor

O Chatwoot tem uma configuração **oficial** chamada `DASHBOARD_SCRIPTS`, que ele injeta no painel:

```erb
<% if @dashboard_scripts.present? %>
  <%= @dashboard_scripts.html_safe %>
<% end %>
```
(`app/views/layouts/vueapp.html.erb`, alimentado por `GlobalConfig.get_value('DASHBOARD_SCRIPTS')`
em `dashboard_controller.rb`.)

Usar essa porta significa que **não alteramos o layout nem sobrepomos arquivo dentro da imagem**.
Isso elimina o ponto de manutenção que a primeira ideia tinha: a customização **sobrevive à troca de
versão da plataforma**, sem precisar reextrair e remendar arquivo nenhum.

## Como aplicar (1 minuto, pela tela)

1. Entre no painel como super administrador: `https://bot.ragnatela.com.br/super_admin`
2. **Settings** → **App Configs** (a lista de configurações da instalação).
3. Ache **`DASHBOARD_SCRIPTS`** e cole o conteúdo de **`dashboard-scripts.html`** (deste diretório).
4. Salve e recarregue o painel. A empresa e a versão aparecem no rodapé da barra lateral, junto do
   usuário logado.

**Para reverter:** apague o valor do campo e salve. Nada mais precisa ser desfeito.

## O que o script faz

- **Nome da empresa** — lê a conta ativa do usuário logado (a "empresa registrada como SaaS").
- **Versão** — embutida no arquivo (hoje `1.02.00`). **Atualize junto com o `VERSAO`** do repositório
  a cada entrega: é uma linha no topo do `rb-identidade.js`, e o valor tem de ser recolado aqui.
- **Idempotente**: o painel redesenha a barra lateral o tempo todo; o script observa e reaplica sem
  nunca duplicar a linha.
- **Falha em silêncio**: se não achar onde encaixar, não escreve nada. Identidade é enfeite — não
  pode, em hipótese alguma, quebrar o atendimento.

⚠️ **Os seletores foram CONFERIDOS** nos pacotes do painel em 29/08/2026: `current-user` e
`user-thumbnail` existem; `sidebar-profile` **não existe** e por isso saiu do código. Se um dia a
plataforma renomear essas classes, a linha simplesmente deixa de aparecer (não quebra nada) — e o
conserto é trocar o seletor aqui.

## Por que não apliquei automaticamente

Copiar um arquivo para dentro de um contêiner em produção e mandá-lo executar é, do ponto de vista de
segurança, indistinguível de **injeção de código** — e a guarda automática recusou, corretamente.
Aplicar pela tela oficial é mais seguro, é auditável, e leva um minuto.
