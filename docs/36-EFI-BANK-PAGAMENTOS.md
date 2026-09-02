# 36 — PAGAMENTOS: EFÍ BANK (decisão fechada)
> Decisão do dono em 02/09/2026: *"vamos deixar como provedor de pagamento apenas o Efí Bank"*.
> Fecha a F3.10 do doc 34 (que estava aberta entre Pix avulso, Asaas, PagHiper e Atlaz).
> Apurado na documentação oficial `dev.efipay.com.br` em 02/09/2026 — não de memória.

---

## 1. POR QUE UM SÓ PROVEDOR É A DECISÃO CERTA

Quatro provedores significam quatro contratos, quatro conjuntos de credenciais, quatro formatos de
retorno e quatro maneiras de falhar às 3 da manhã. Um só provedor com **duas APIs** cobre tudo o
que o atendimento precisa cobrar. Se um dia entrar um segundo, ele entra pela **camada de
provedor** (mesma ideia da F9.2.2) — não por um segundo caminho no motor.

---

## 2. SÃO DUAS APIS DIFERENTES, COM EXIGÊNCIAS DIFERENTES

⚠️ Este é o ponto que mais custa caro se for descoberto tarde: **a API Pix exige certificado e
mTLS; a API de Cobranças não exige nada disso.**

| | **API Pix** | **API Cobranças** (boleto, carnê, cartão) |
|---|---|---|
| Autenticação | OAuth2 (Basic com Client_Id:Client_Secret) | OAuth2 (Basic com Client_Id:Client_Secret) |
| **Certificado** | **obrigatório**, `.p12`/PFX gerado no painel da Efí | **não exige** |
| URL produção | `https://pix.api.efipay.com.br` | conforme a API de Emissões |
| URL homologação | `https://pix-h.api.efipay.com.br` | par de chaves separado |
| Webhook | **mTLS obrigatório** (exigência do Banco Central) | webhook comum |
| Escopos | granulares: `cob.read`, `cob.write`, `pix.read`, `pix.write`, `pix.send`, `webhook.read`, `webhook.write` | escopos da API de Emissões |

📌 **Recomendação: começar pelo Pix.** É o que o cliente de atendimento usa de fato (cobrança no
meio da conversa, paga na hora, confirma sozinho). Boleto e cartão entram depois, e entram fácil
— porque a parte difícil (certificado e mTLS) é justamente a que boleto não tem.

---

## 3. ⚠️ A ARMADILHA: O WEBHOOK DO PIX EXIGE mTLS **DO NOSSO LADO**

Não é o nosso servidor que apresenta certificado ao chamar a Efí — é a **Efí que apresenta
certificado ao nos chamar**, e o Banco Central exige que **nós validemos**. Em texto claro: o
endereço que recebe a confirmação de Pix tem de **exigir certificado de cliente**.

Como a Efí faz, medido na documentação:
1. primeira requisição **sem** certificado — só para conferir que o nosso servidor exige mTLS;
2. segunda requisição **com** certificado — e aí sim o handshake acontece.

**Requisitos apurados:**

| Item | Valor |
|---|---|
| Protocolo | HTTPS apenas, **porta 443** |
| TLS mínimo | **1.2** |
| Cadeia pública da Efí (produção) | `https://certificados.efipay.com.br/webhooks/certificate-chain-prod.crt` |
| Cadeia pública da Efí (homologação) | `https://certificados.efipay.com.br/webhooks/certificate-chain-homolog.crt` |
| Registro do webhook | `PUT /v2/webhook/:chave` — a chave é a **chave Pix** |
| Caminho | a Efí **acrescenta `/pix`** ao fim da URL registrada; para evitar, registrar com `?ignorar=` |
| Camadas extras recomendadas | restringir ao IP `34.193.116.226` e pôr um HMAC na própria URL |

### 3.1 O que isso significa na NOSSA infra (e por que não é trivial)

O Ragnabot fica atrás do proxy reverso **XSEPRXRVS001**, que serve ~20 domínios. Exigir
certificado de cliente é configuração de `server{}` — **não dá para ligar no vhost errado sem
derrubar site de terceiro.** O desenho seguro é o mesmo que já usamos no `same01`:

- **hospedeiro próprio** para o webhook (ex.: `pix.ragnatela.com.br`), vhost isolado;
- `ssl_client_certificate` = cadeia da Efí + `ssl_verify_client on` **só nesse vhost**;
- caminho único aceito, tudo mais **444** (drop silencioso), como no capítulo do `same01`;
- log dedicado (`pix_access.log`) — sem ele não há como provar recebimento de cobrança;
- **`nginx -t` obrigatório** antes de qualquer `reload`, e **nunca** deixar cópia de vhost dentro
  de `sites-enabled` (derrubou o proxy por 2h47 em 22/08);
- ⚠️ **nome do symlink não pode ordenar em primeiro** — senão vira o `default_server` da 443 e
  muda o catch-all de SNI (armadilha já documentada no capítulo do `app.sisacbrasil.com`).

📌 Enquanto o vhost com mTLS não existir, dá para trabalhar inteiro em **homologação** — o que
permite escrever e testar o código antes de mexer no proxy de produção.

---

## 4. 📋 O QUE VOCÊ PRECISA COLETAR NO PAINEL DA EFÍ

Checklist para você, na sua conta Efí. **Nada disso vai para o git** — tudo entra como Secret do
Kubernetes / `.env`, conforme a lei da casa.

### Para o Pix (o que vamos usar primeiro)
| # | Item | Onde |
|---|---|---|
| 1 | **Chave Pix** cadastrada na conta Efí (CNPJ, e-mail ou aleatória) | painel Efí |
| 2 | Criar uma **Aplicação** com a **API Pix** habilitada | painel → Aplicações |
| 3 | **Client_Id** e **Client_Secret** de **produção** | na aplicação |
| 4 | **Client_Id** e **Client_Secret** de **homologação** | na mesma aplicação |
| 5 | **Certificado `.p12`** de produção | painel → API → Certificados |
| 6 | **Certificado `.p12`** de homologação | idem |
| 7 | **Escopos** marcados: `cob.write`, `cob.read`, `pix.read`, `webhook.write`, `webhook.read` | ao criar a aplicação |
| 8 | *(só se formos pagar/estornar por API)* `pix.send` | ⚠️ escopo perigoso — **não marcar** sem necessidade |

### Para boleto e cartão (fase 2, quando quiser)
| # | Item |
|---|---|
| 9 | Aplicação com **API de Emissões** habilitada |
| 10 | Client_Id / Client_Secret de produção e de homologação (par próprio, diferente do Pix) |
| 11 | Para cartão: identificador de conta usado pelo SDK de tokenização no navegador |

### Decisões suas, de negócio (não técnicas)
| # | Pergunta | Por que importa |
|---|---|---|
| A | A conta Efí é **da Ragnatela** e o cliente paga a nós, ou **cada empresa cliente** liga a conta Efí dela? | muda o modelo de dados: credencial única × credencial por inquilino |
| B | Cobra-se **só Pix** ou também boleto/cartão? | define se a fase 2 entra |

📌 **Recomendação:** começar com a **conta da Ragnatela** (mais simples, e é assim que se cobra
assinatura do próprio SaaS) e já deixar o modelo preparado para credencial **por empresa** — o
campo existe, fica nulo, e o dia que um cliente quiser receber direto não há migração.

---

## 5. COMO VAI SER CONSTRUÍDO

| # | Entrega | Aceite |
|---|---|---|
| 5.1 | `ragnabot-pagamento-efi.service.js` — OAuth2 com certificado, cache do token até expirar | token renovado sozinho; certificado lido de arquivo montado por Secret, nunca do repositório |
| 5.2 | Criar cobrança Pix imediata (`cob`) + **QR Code copia-e-cola** | a conversa recebe o código; o cliente paga |
| 5.3 | Endpoint de webhook com validação de origem (mTLS no nginx + IP + HMAC na URL) | Pix pago → conversa atualizada em segundos |
| 5.4 | **Idempotência**: o mesmo `txid` chegando duas vezes não cobra nem credita duas vezes | ⚠️ webhook repete por desenho; a lição do CRCMA vale aqui |
| 5.5 | Nó **"Cobrar via Pix"** no construtor de fluxo (valor fixo ou de variável) | o fluxo cobra sem humano |
| 5.6 | Estado da cobrança na conversa (aguardando / pago / expirado) + registro em auditoria | rastro de dinheiro é auditoria de primeira classe |
| 5.7 | Credencial por empresa cliente (campo preparado, nulo = usa a da Ragnatela) | multi-inquilino sem migração futura |
| 5.8 | Homologação × produção por variável de ambiente | ninguém testa cobrança em produção por engano |

⛔ **Nunca** registrar valor de credencial, certificado ou `txid` completo em log de nível
informativo — mesma disciplina do `redactCommandForLog`.
