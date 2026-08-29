# 🔗 26 — CADASTRO INCORPORADO (Embedded Signup)
### Conectar a conta de WhatsApp do cliente em três cliques, sem ele mexer no Gerenciador de Negócios

> **Origem:** ordem do dono em 28/08/2026 — *"no chatbot atual eles têm uma conexão direta onde o
> cliente novo pela API oficial nem precisa fazer nada no Business Manager"*. Está certo: é isto.
> **Decisão de execução na mesma conversa:** *"vamos terminar nosso próprio número, fazer todas as
> melhorias com ele"* — este documento é **preparação**, não execução imediata.

---

## 1. O que é, e por que o sistema atual consegue

Hoje, para uma empresa cliente usar a API oficial, ela precisa percorrer cinco etapas no painel da
Meta (verificar empresa, criar conta comercial, verificar número, registrar na API, criar
aplicativo e token). É trabalhoso, e a etapa de verificação depende da Meta, não de nós.

O **Cadastro Incorporado** troca tudo isso por um botão. O cliente clica dentro do nosso painel,
entra com o Facebook dele, escolhe (ou cria) a conta comercial, e a Meta devolve **número, token e
webhook já configurados** para a nossa plataforma.

**Por que o fornecedor do sistema atual consegue e nós ainda não:** porque *ele* está cadastrado
junto à Meta como **provedor**. O cliente não precisa criar aplicativo próprio porque usa o
aplicativo do provedor. É um papel formal, não um recurso de software.

---

## 2. Custo — a pergunta do dono, respondida

> *"veja também se tem custo para nós como provedor, ou será apenas o custo do cliente para
> pagamento de conversas que gerar na conta dele"*

**Resposta: apenas o custo do cliente. Nada nos é cobrado — desde que escolhamos o papel certo.**

A Meta tem **dois papéis** possíveis, e a diferença entre eles é exatamente quem recebe a fatura:

| | **Provedor de Tecnologia** *(Tech Provider)* | **Parceiro de Solução** *(Solution Partner)* |
|---|---|---|
| Linha de crédito da Meta | **não tem** | tem |
| Quem cadastra a forma de pagamento | **o cliente**, na conta dele | pode ser o parceiro |
| Quem a Meta cobra pelas mensagens | **o cliente, direto** | **o parceiro** |
| Quem fatura o cliente pelas conversas | ninguém — é direto Meta↔cliente | o parceiro, com ou sem margem |
| O que nós cobramos | **só a assinatura da plataforma** | assinatura + repasse das conversas |
| Risco de inadimplência das conversas | **nenhum nosso** | **nosso** — pagamos a Meta de todo jeito |

**A escolha é Provedor de Tecnologia.** Ela preserva exatamente o modelo que já havia sido
decidido em `16-saas-tenants.md §6`: a conta é do cliente, o número é do cliente, e **o custo por
conversa sai do cartão do cliente**. Não passa por nós, não vira repasse, não vira suporte
financeiro, e não vira risco de crédito.

### Taxa de cadastro
**Não foi encontrada taxa de inscrição** para nenhum dos dois papéis. O que existe são as tarifas
por mensagem da Meta — e essas, no modelo de Provedor de Tecnologia, são cobradas **do cliente**.

### ⚠️ O que muda com o tempo, e precisa ser reconferido antes de assinar contrato
A Meta trocou o modelo de cobrança em **1º de julho de 2025**: saiu do preço por *conversa* de 24 h
e passou para **preço por mensagem**. Isso não altera *quem paga* — altera *quanto*. Antes de
publicar tabela de preço para cliente, **reconferir a tarifa vigente** no material oficial da Meta,
não em blog de terceiro.

> **Nota de honestidade:** a ausência de taxa foi apurada em documentação pública e material de
> mercado, não num contrato assinado. Antes de comprometer preço com cliente, confirmar direto com
> a Meta no processo de cadastro.

---

## 3. Estado medido no nosso ambiente (28/08/2026)

| Item | Situação | Como foi medido |
|---|---|---|
| Ragnabot suporta o recurso | ✅ **sim** | versão `4.17.1`; rota `/super_admin/app_config?config=whatsapp_embedded` respondeu **302** (existe, pede login) e não 404 |
| Aplicativo Meta próprio | ✅ **existe** — `WHATS-0997` | criado em 28/08; identificador registrado no log de ações |
| Segredo do aplicativo | ✅ existe | campo oculto na aba *Básico* do aplicativo |
| Identificador da configuração de cadastro incorporado | ❌ **falta criar** | ainda não existe no aplicativo |
| Papel de Provedor de Tecnologia | ❌ **falta solicitar** | não iniciado |
| Painel super admin com nossa identidade | ❌ **cru** (marca do software de origem, em inglês, sem verificação anti-robô) | visto pelo dono em 28/08 |

---

## 4. Os três valores que o Ragnabot pede

Configuram-se no painel super admin, em **`/super_admin/app_config?config=whatsapp_embedded`**:

| Chave | O que é | Onde obter |
|---|---|---|
| `WHATSAPP_APP_ID` | identificador do nosso aplicativo Meta | aplicativo `WHATS-0997` → Configurações → Básico |
| `WHATSAPP_APP_SECRET` | segredo do mesmo aplicativo — usado na troca de token | mesma tela (campo oculto) |
| `WHATSAPP_CONFIGURATION_ID` | identificador da **configuração de cadastro incorporado** | aplicativo → WhatsApp → Cadastro Incorporado → criar configuração |

> 🔒 **Nenhum desses valores entra neste documento nem no git.** Vão para o painel do Ragnabot
> (que os guarda no banco dele) e, se precisarem ser referenciados pelo NOC, para Settings cifrado.
> Regra permanente da casa: `noc-no-secrets-in-git`.

**⚠️ Uma condição fácil de esquecer:** antes de sobrescrever o endereço de retorno, o aplicativo
**precisa já estar inscrito** para receber mensagens da conta comercial. Sem essa inscrição prévia,
o fluxo falha na hora de assinar o webhook — e o erro que aparece não aponta para a causa.

---

## 5. Roteiro de execução

> **Pré-condição obrigatória:** o nosso próprio número deve estar **funcionando de ponta a ponta**
> pelo caminho manual antes de qualquer passo daqui. Motivo abaixo, na §7.

### Etapa A — virar Provedor de Tecnologia
1. No portfólio **MOTA E CIA LTDA**, solicitar o papel de provedor junto à Meta.
2. Submeter o aplicativo `WHATS-0997` à análise, declarando o caso de uso (plataforma de
   atendimento que conecta contas de clientes).
3. Aguardar aprovação. **O prazo é da Meta** — planeje sem depender de data.

### Etapa B — criar a configuração de cadastro incorporado
4. No aplicativo → **WhatsApp → Cadastro Incorporado** → criar configuração.
5. Definir o que o fluxo vai pedir ao cliente e o endereço de retorno.
6. Copiar o **identificador da configuração**.

### Etapa C — ligar no Ragnabot
7. Publicar o aplicativo (sair de *Em desenvolvimento* — sem isso não há dado de produção).
8. Preencher os três valores no painel super admin.
9. Conferir que a opção de cadastro incorporado passa a aparecer na criação de caixa de entrada.

### Etapa D — provar
10. Testar com uma conta **de teste**, nunca com a de um cliente real na primeira vez.
11. Conferir os quatro sinais: número aparece, token chega, webhook assina, **mensagem entra**.
12. Só então oferecer a clientes.

---

## 6. O que muda para o cliente

| | Hoje (manual, assistido) | Com cadastro incorporado |
|---|---|---|
| Etapas do cliente no painel da Meta | **5** | **0** |
| Aplicativo próprio do cliente | necessário | desnecessário |
| Token gerado à mão | sim | não — vem no fluxo |
| Webhook configurado à mão | sim | não — vem no fluxo |
| Tempo típico de onboarding | horas a dias | **minutos** |
| Verificação da empresa | **continua sendo do cliente** | **continua sendo do cliente** |

**O que NÃO muda:** a verificação do Gerenciador de Negócios do cliente continua sendo dele, e
continua sendo o gargalo. O cadastro incorporado elimina o trabalho técnico, não a burocracia da
Meta.

---

## 7. Riscos conhecidos, ditos antes de doer

**1. Em instalação própria isso dá trabalho.** Há falhas abertas e discussões públicas de gente com
cenário igual ao nosso — o fluxo falha em pontos como a inscrição do webhook e o carregamento do
componente da Meta. Não é impeditivo; é motivo para reservar tempo de depuração.

**2. Fazer os dois caminhos ao mesmo tempo esconde a causa do erro.** Se o cadastro incorporado for
montado antes de o nosso número funcionar pelo caminho manual, um erro de webhook pode ser do
cadastro incorporado **ou** da nossa configuração — e não haverá como separar. **Por isso a ordem
da §5 é obrigatória, não preferência.**

**3. Dependência de aprovação externa.** O papel de provedor passa por análise da Meta. Enquanto ela
não sair, o onboarding continua sendo o roteiro assistido de 8 etapas — que funciona, só é mais
lento. **Não prometa a clientes o fluxo de três cliques antes da aprovação.**

**4. O painel super admin vira porta de configuração.** Ele estava marcado para possível bloqueio;
com este documento, **fica** — e precisa de identidade nossa, português e verificação anti-robô,
porque passa a guardar segredo de aplicativo.

---

## 8. Pontos cegos deste documento

- A **ausência de taxa** foi apurada em documentação pública e material de mercado. Não houve
  contrato nem confirmação direta da Meta.
- O **prazo de aprovação** do papel de provedor não foi apurado; varia por caso.
- A **tarifa por mensagem** muda por país e por categoria, e mudou de modelo em julho/2025.
  Qualquer número usado comercialmente precisa ser reconferido na fonte oficial.
- Não foi testado no nosso ambiente — a confirmação de suporte é da **rota existir** na versão
  4.17.1, não de um fluxo executado com sucesso.

---

## 9. Fontes

- Meta — [Solution Partner / visão geral dos papéis de provedor](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)
- Meta — [Preços da plataforma WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- Chatwoot — [Cadastro incorporado em instalação própria](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/whatsapp-embedded-signup)
- Chatwoot — [Guia do usuário](https://www.chatwoot.com/hc/user-guide/articles/1752129193-how-to-use-whatsapp-embedded-signup)
- Chatwoot — [Falhas conhecidas em instalação própria (#13154)](https://github.com/chatwoot/chatwoot/issues/13154)
- Comparativo — [Provedor de Tecnologia x Parceiro de Solução](https://whautomate.com/whatsapp-tech-provider-vs-bsp)
