# R2 — A marca do Chatwoot no painel de super administrador

> **Estado: diagnosticado e preparado, NADA aplicado.** Os arquivos estão em `deploy/marca/` do
> repositório `ragnatelaiot/ragnabot`. Aplicar é decisão do chefe/dono.
>
> **Ordem do dono (30/08/2026, com foto):** *"olha como está a tela do super admin, já tinha
> solicitado para adequar ao frontend do Ragnabot"* — a tela mostra a logomarca do Chatwoot, o
> texto **"Howdy, admin 👋"** e os campos **"Email Address" / "Password" / "Login"** em inglês.
>
> Levantamento feito em 30/08/2026 lendo os arquivos **dentro do pod em produção**
> (`ragnabot-web-646797487f-7xcmn`, namespace `ragnabot`, Chatwoot 4.17.1). Só leitura.

---

## 1. A resposta que o dono precisa ouvir primeiro

**As telas de super administrador do Chatwoot não são personalizáveis por configuração.**

Não é falta de vontade nem descuido de quem trabalhou antes: é como o programa foi escrito. Aquela
tela não faz parte do painel do Ragnabot — é uma tela **do Rails**, separada, que a plataforma
desenha com a logomarca e o texto **escritos à mão dentro do próprio arquivo**. Ela não pergunta a
nenhuma configuração qual é a marca da instalação. Simplesmente desenha o que está escrito lá.

Por isso o pedido anterior não teve efeito ali: o mecanismo que usamos para personalizar o painel
(o campo `DASHBOARD_SCRIPTS`, das configurações da instalação) **existe apenas no painel do
atendente**. Ele nem chega perto da tela de super admin.

---

## 2. O que muda na tela, o que não muda

### 2.1 O que MUDA — e ainda não foi feito

Uma descoberta desta tarefa, que vale mais que o pedido original: **a marca do produto nunca foi
configurada em lugar nenhum da instalação**. Todas as chaves oficiais de identidade continuam no
valor de fábrica do Chatwoot. Lido da própria aplicação hoje:

```
INSTALLATION_NAME = "Chatwoot"
BRAND_NAME        = "Chatwoot"
LOGO              = "/brand-assets/logo.svg"
BRAND_URL         = "https://www.chatwoot.com"
```

Preenchendo essas chaves (lista pronta em `deploy/marca/valores-de-marca.md`), passam a mostrar
**Ragnabot / Ragnatela**:

- a **tela de login do atendente** — aquela que o cliente abre todos os dias;
- o **título da aba** e a descrição do painel;
- o **ícone** de 512px da aba;
- os textos do painel que hoje dizem "Chatwoot" (a plataforma tem um substituidor automático que
  troca a palavra pelo nome da instalação);
- os **e-mails** que a plataforma envia (nome e link do "fornecido por");
- o **widget** de site e a **pesquisa de satisfação**;
- a **central de ajuda**.

Isso é feito **pela tela**, em `/super_admin` → Settings → App Configs, leva um minuto, vale na
hora, e **não reinicia nada**. Sem janela de risco, sem derrubar sessão de ninguém.

### 2.2 O que NÃO MUDA — a tela da foto

| O que aparece | Sai por configuração? |
|---|---|
| Logomarca do Chatwoot no topo do login do super admin | **Não** — o endereço do desenho está escrito dentro do arquivo da tela |
| "Howdy, admin 👋" | **Não** — texto fixo, nem sequer é frase traduzível |
| "Email Address" / "Password" / "Login" | **Não** — texto fixo |
| Título da aba "SuperAdmin \| Chatwoot" | **Não** — texto fixo |
| Logomarca e "Chatwoot 4.17.1 / Super Admin Console" na barra do console | **Não** — texto e endereço fixos |
| Título "… - Chatwoot" das telas de dentro do console | **Não** — vem do nome interno do programa |
| Ícones pequenos da aba e o arquivo de aplicativo (`manifest.json`) | **Não** — são figuras que vêm dentro da imagem |

Cada linha desta tabela foi conferida **abrindo o arquivo dentro do pod**, com número de linha
anotado em `deploy/marca/DIAGNOSTICO.md`. Não é suposição.

---

## 3. Por quê — em uma passada, sem jargão

O Ragnabot roda sobre o Chatwoot, e o Chatwoot tem **dois programas dentro dele**:

1. **O painel do atendente** — moderno, montado no navegador. Ele *pergunta* ao servidor qual é a
   marca antes de desenhar. Por isso obedece a configuração.
2. **O console de super administrador** — uma tela administrativa antiga, gerada por uma biblioteca
   de prateleira (`administrate`). Ela **não pergunta nada**: o endereço da logomarca e as palavras
   estão datilografados no arquivo da tela.

Como a imagem do Chatwoot é fixada por assinatura (não compilamos o programa deles), mudar o que
está datilografado significa **colocar uma cópia nossa do arquivo por cima da deles**. E aí começa
o custo — que é o assunto da próxima seção.

---

## 4. O que dá para fazer, e quanto custa cada coisa

| Passo | Efeito | Custo de manutenção | Recomendação |
|---|---|---|---|
| **1. Preencher as configurações de marca** | Marca certa em tudo o que o **cliente** vê | nenhum | **fazer já** |
| **2. Trocar a logomarca do super admin** | Resolve **metade** da foto: some a logomarca do Chatwoot | **nenhum** | **fazer**, com aval do chefe |
| **3. Traduzir os textos do super admin** | Resolve a outra metade | **alto** — refazer a cada atualização do Chatwoot | **não fazer agora** |
| 4. Trocar os ícones pequenos | Cosmético, não toca o super admin | médio | adiar |

### Sobre o passo 2 (logomarca)

As três logomarcas do Ragnabot **já estão dentro do contêiner** — foram montadas em agosto e
conferidas hoje, arquivo por arquivo. Falta apenas apontá-las também para os três nomes que a tela
do super admin procura. É o **mesmo mecanismo já em produção** (o Kubernetes entrega o arquivo ao
contêiner), mais três linhas onde hoje há três.

O ponto importante: **isso não é um remendo que precisa ser refeito a cada atualização.** A entrega
é feita pelo Kubernetes toda vez que o programa sobe, com qualquer versão. E se um dia o Chatwoot
mudar o nome desses arquivos, o pior que acontece é a logomarca deles voltar — nada quebra.

### Sobre o passo 3 (traduzir os textos) — a recomendação honesta

Aqui eu recomendo **não fazer**, e é preciso dizer o motivo com todas as letras:

Para trocar "Howdy, admin 👋" por português, teríamos de **congelar uma cópia nossa da tela de
login do super admin**. A partir daí, toda atualização do Chatwoot passaria a ser ignorada naquele
arquivo. Se numa versão futura eles mudarem algo do formulário de entrada — e essa é a tela que
**valida a senha** —, a nossa cópia congelada continuaria sendo usada, e o resultado seria **não
conseguir entrar no console de super administrador**, sem mensagem que explique o motivo. Perder a
porta de entrada do administrador durante uma atualização é um problema de outra ordem de grandeza
do que ver "Howdy, admin" na tela.

Some-se a isso: essa tela é vista por **uma pessoa** — o dono ou o NOC. Não é tela de cliente, não
é tela de atendente. O ganho é de brio; o risco é operacional.

**Se mesmo assim o dono quiser** (e é direito dele — é a marca da empresa dele), a versão menos
arriscada é congelar **apenas a tela de login**, deixando a barra lateral do console como está, e
inscrever no procedimento de atualização do Chatwoot o passo obrigatório de reconferir esse
arquivo. Isso precisa virar item fixo do roteiro, não boa intenção.

---

## 5. Um caminho que investiguei e descartei

Existe a possibilidade técnica de **reescrever o texto da página no caminho**, antes de ela chegar
ao navegador, usando um recurso do servidor de entrada (o `sub_filter` do nginx). Medi: o recurso
está compilado e disponível no controlador do cluster.

**Descartei**, e o motivo é proporcional: na versão em uso, habilitar esse recurso exige afrouxar
uma trava de segurança **do controlador inteiro**, que é a porta de entrada de tudo o que roda no
cluster. Baixar a guarda da portaria para trocar a palavra de uma tela de login é troca ruim.

O nginx externo que fica na frente do domínio também poderia fazer isso — mas ele é compartilhado
com cerca de vinte sites de clientes, e **eu não medi** se tem o recurso. Registro como **não
medido**, não como impossível.

---

## 6. Um achado de passagem (não é marca)

O console de super administrador carrega o **widget de suporte do próprio Chatwoot**, apontado
para o servidor deles, e envia junto o identificador da instalação e o **e-mail e o nome do
primeiro super administrador**. A bolha fica escondida — não aparece na tela e **não é** o que o
dono viu. Mas é uma chamada para fora, com dado nosso, toda vez que o console abre. Fica
registrado para o chefe decidir se vira tarefa separada.

---

## 7. O que eu NÃO consegui medir

Sendo honesto sobre os limites deste levantamento:

- **A aparência final na tela.** Tudo aqui foi lido do código e do HTML servido pela aplicação.
  Como as três logomarcas do Ragnabot ficam no lugar das do Chatwoot — tamanho, respiro, contraste
  no tema escuro — **só se vê aplicando**.
- **O nginx externo** em frente ao domínio: não conferi se tem o recurso de reescrita de texto.
- **As páginas de Termos de Uso e Privacidade da Ragnatela:** não confirmei se existem, e por isso
  **não** preenchi essas duas configurações (hoje apontam para as páginas do Chatwoot). Colocar um
  link quebrado num campo chamado "Termos de Uso" é pior do que deixar como está. Precisa de
  resposta do dono — e, sendo assunto de site, passa pelo agente `site-ragnatela`.

---

## 8. Onde estão os arquivos

Repositório `ragnatelaiot/ragnabot`, diretório `deploy/marca/`:

| Arquivo | Conteúdo |
|---|---|
| `DIAGNOSTICO.md` | O que pinta a tela, com arquivo e linha. O que é e o que não é configurável. |
| `valores-de-marca.md` | A lista pronta de chave → valor para colar em App Configs, com o efeito de cada uma. |
| `PENDENTE-IMAGEM.md` | O que só muda mexendo em arquivo da imagem: o que seria, o custo, a recomendação. |
| `LEIA-ME.md` | Como aplicar, como reverter, e a lista final do que não tem solução por configuração. |

Nenhum arquivo aplicável foi escrito de propósito: o contrato pede que o **chefe decida** antes de
qualquer remendo na imagem.
