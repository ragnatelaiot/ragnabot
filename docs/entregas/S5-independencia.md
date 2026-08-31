# S5-INDEPENDENCIA — as três peças que ainda amarravam o Ragnabot ao NOC

> **Contrato S5-INDEPENDENCIA · 30/08/2026.**
> Nada foi aplicado, nada foi reiniciado, nada foi commitado. O código está na árvore de trabalho
> do repositório do Ragnabot, com teste, esperando a decisão do chefe.

---

## 1. O defeito que esta entrega fecha

O motor já rodava no cluster, com banco próprio, login próprio e servindo a interface — **mas
nenhuma escrita funcionava.** Três peças ficaram no NOC e não vieram na mudança de casa:

| Falta | Quem usava | O que era no NOC |
|---|---|---|
| `services/device.service.js` (`userHasGroupAccess`) | `ragnabot-tenant.routes.js`, `ragnabot-cluster.routes.js` | permissão por **grupo de dispositivos** (Zabbix/Proxmox/switch) |
| `services/otp.service.js` | `ragnabot-tenant.routes.js`, `ragnabot-fluxo.routes.js` | segundo fator por e-mail, lendo `Settings` do NOC |
| `prisma.user` | `ragnabot-fluxo.routes.js` (3 pontos) | tabela de usuários **do NOC** |

**Medido antes de tocar em nada** (Express de verdade, router de verdade, sessão de administrador
de empresa vinda do cookie):

```
ADMIN   /api/ragnabot/planos → 500 {"success":false,"error":"Cannot find module '.../services/device.service.js'"}
SUPER   POST /tenants        → 400 {"success":false,"error":"Cannot read properties of undefined (reading 'findUnique')"}
```

O segundo erro é o `prisma.user` — a base do Ragnabot tem os **40 modelos do produto** e nenhuma
tabela `User`. `prisma.user` é, literalmente, `undefined`.

---

## 2. O que foi construído

| Arquivo | Estado | O que é |
|---|---|---|
| `app/src/services/device.service.js` | **novo** | permissão de "grupo" — concede a **super**, nega ao resto |
| `app/src/services/otp.service.js` | **novo** | segundo fator próprio: código por e-mail, SMTP do **ambiente** |
| `app/src/routes/ragnabot-fluxo.routes.js` | editado (só os 3 pontos) | quem é a pessoa sai da **sessão**, não da tabela do NOC |
| `app/src/base/testes/independencia.test.mjs` | **novo** | 22 verificações, com SMTP de verdade e HTTP de verdade |

`base/auth.js`, `rotas-sessao.js`, `servidor.js`, `web/**` e `/ia/netagent/**` **não foram tocados**,
como o contrato mandou.

---

## 3. As três decisões, e por que elas ficaram assim

### 3.1 `device.service.js` — grupo de dispositivo **não existe** no Ragnabot

Grupo é conceito do console de operação. Aqui o que isola é a **empresa**, e isso já existe e já é
testado (`escopoDe`/`clausulaEscopo`). A peça nova não inventa permissão nova: **super concede,
todo o resto nega.**

⛔ **Não devolve `true` por padrão "para não quebrar".** Estes routers provisionam, suspendem e
**excluem** conta de cliente. Permissão que erra para o lado aberto é como se vaza empresa — e o
erro aparece no vazamento, não no monitor.

⚠️ **Consequência que o chefe precisa saber (medida, não suposta):** com esta regra,
`/api/ragnabot/*` (o SaaS) passa a ser **só do operador**. Um administrador de empresa entrando
pelo cookie recebe **403**, porque `base/auth.js` nunca marca `isSuperuser` por cookie — por
desenho (doc 33 §7). O 500 morreu; **o 403 é a política, não um defeito**. O editor de fluxo
(`/api/ragnabot-fluxo/*`) **não** é afetado: ele monta sem `adminOnly` e isola por empresa.

### 3.2 `otp.service.js` — segundo fator próprio, com o e-mail da plataforma

- código de **6 dígitos**, **10 minutos** (teto, não negociável por variável), **5 tentativas**;
  na 5ª errada o código é **queimado** — nem o certo passa depois;
- guardado **só como resumo SHA-256** amarrado ao par (ator, propósito). Nunca em claro;
- o e-mail do destino vem de `req.user` (a plataforma nos disse quem entrou). **Sem e-mail de
  pessoa, recusa** — é o que acontece na ponte de serviço (NOC → Ragnabot), que afirma um operador
  em cabeçalho sem endereço nenhum. Seguir sem segundo fator ali transformaria a ponte no contorno;
- envio por `nodemailer` com **configuração do AMBIENTE** — a tabela `Settings` do NOC era a **5ª
  amarra**, e morre aqui;
- **sem SMTP configurado, falha fechada nos DOIS sentidos:** pedir avisa (com o nome da variável
  que falta, nunca o valor) e **conferir recusa**. Um segundo fator que aprova porque o e-mail não
  foi configurado é pior que não ter segundo fator — ele mente para quem confia nele;
- **aplicativo autenticador (TOTP) não existe aqui, e isso é dito, não simulado.** O segredo do
  autenticador do NOC ficou na tabela `User` do NOC; o da plataforma só ela confere, no
  `sign_in`, e para isso precisaríamos da senha da pessoa — que não temos e não queremos ter.

⚠️ **Limite medido, não escondido: o código vive na MEMÓRIA DO PROCESSO, e o motor tem 2 réplicas.**
O código vale na réplica que o emitiu. Se a conferência cair na outra, ela recusa como "inválido ou
expirado" e a pessoa pede outro. **A falha é fechada** (nunca aprova o que não emitiu), mas o
incômodo é real: com balanceamento redondo, ~50% das confirmações pedem uma segunda tentativa.
Fechar isso de verdade exige **tabela de OTP no banco** — mudança de esquema, e portanto decisão do
chefe (Lei 2: SQL pelo `migrate diff`, recortando os `DROP`).

### 3.3 `prisma.user` no editor de fluxo → a sessão

Os três pontos (`conferir2FA` e as duas leituras do `POST /request-otp`) passaram a ler
`req.user.email`. **Quando a sessão não tem e-mail, a operação é recusada com mensagem clara**
(`SEM_CANAL_2FA`) em vez de seguir sem segundo fator. Publicar fluxo é mandar um robô falar com o
cliente de alguém: isso não pode passar batido.

De quebra, o `POST /request-otp` **parou de responder `sent: true` quando nada saiu** — antes ele
ignorava o retorno do envio, e a pessoa ficaria esperando um e-mail que nunca chega, procurando o
defeito na caixa de spam dela.

---

## 4. Variáveis novas (no `Secret`/`ConfigMap` — ⛔ nenhum valor aqui)

| Chave | Onde | Obrigatória? | Para quê |
|---|---|---|---|
| `SMTP_HOST` | ConfigMap | **sim** (sem ela o 2FA recusa) | servidor de e-mail |
| `SMTP_FROM` | ConfigMap | **sim** | remetente |
| `SMTP_PORT` | ConfigMap | não (padrão 587) | porta |
| `SMTP_SECURE` | ConfigMap | não | `true` = TLS implícito. Sem valor, 465 é implícito e o resto não |
| `SMTP_USER` / `SMTP_PASSWORD` | **Secret** | não (relay por rede existe) | **as duas juntas ou nenhuma** — meia credencial é recusada com aviso |
| `SMTP_FROM_NAME` | ConfigMap | não | nome de exibição do remetente |
| `RAGNABOT_OTP_TTL_MS` | — | não | só **encurta** a validade (teto 10 min). Existe para o teste |

---

## 5. A prova (saída real, 30/08/2026)

`node src/base/testes/independencia.test.mjs` → **22 verificações**, todas verdes. O teste sobe um
**servidor SMTP falso que fala o protocolo de verdade** (o `nodemailer` percorre o caminho de
produção) e um **Express de verdade** com o router de verdade:

```
   ✅ (a1) papel "super" (só chega pelo token de serviço) → CONCEDE
   ✅ (a2) req.user com isSuperuser=true (mesmo com role "admin") → CONCEDE
   ✅ (a3) ADMIN de empresa (cookie de sessão) → NEGA — não devolve true "para não quebrar"
   ✅ (a4) atendente e ator desconhecido → NEGA
   ✅ (b1) sem e-mail na sessão (ponte de serviço) → RECUSA com SEM_EMAIL, e nada é enviado
   ✅ (b2) emite → mensagem SAI pelo SMTP com um código de 6 dígitos
   ✅ (b3) o código e o e-mail NÃO aparecem no log — nem no caminho feliz
   ✅ (b4) código ERRADO → recusa (e conta a tentativa)
   ✅ (b5) código CERTO → confere; e o MESMO código não vale duas vezes
   ✅ (b6) código de OUTRO propósito não vale aqui
   ✅ (b7) código VENCIDO → recusa com EXPIRADO
   ✅ (b8) 5 tentativas erradas QUEIMAM o código — nem o certo passa depois
   ✅ (b9) formato inválido conta como erro, e não estoura
   ✅ (b10) aplicativo autenticador RECUSA sempre, e diz por quê
   ✅ (c1) sem SMTP: emitir AVISA (e não envia nada)
   ✅ (c2) sem SMTP: CONFERIR recusa — mesmo com um código emitido antes
   ✅ (c3) meia credencial (usuário sem senha) é dita, não engolida
      grep -c 'prisma\s*\.\s*user\s*\.' → 0
   ✅ (d) grep por uso de `prisma.user.<algo>` em ragnabot-fluxo.routes.js → ZERO
   ✅ (e1) POST /request-otp com sessão de PESSOA → 200 e o código sai por e-mail
   ✅ (e2) POST /request-otp pela PONTE DE SERVIÇO (sem e-mail de pessoa) → RECUSA
   ✅ (e3) POST /request-otp pedindo aplicativo autenticador → 400 dizendo que não existe
   ✅ (e4) sem SMTP, POST /request-otp → 503, e a tela NÃO recebe "sent:true"

   22 verificações passaram.
```

O caso **(b3)** captura a saída padrão durante a emissão e falha se o **código** ou o **e-mail do
destinatário** aparecerem em qualquer linha de log. O caso **(e1)** confere que o código também não
volta no corpo da resposta HTTP — quem vê a resposta não é quem lê o e-mail.

**Nada regrediu:** `npm run test:base` (8 + 10 verificações) e `auth.test.mjs` (13) seguem verdes.

**Antes × depois, medido no mesmo roteiro:**

| Pedido | Antes | Depois |
|---|---|---|
| `GET /planos` (super, via token de serviço) | 200 | 200 |
| `GET /planos` (admin de empresa, por cookie) | **500** módulo ausente | **403** política declarada |
| `GET /tenants` (super) | 500 | chega ao banco (400 só porque o teste não tem banco) |
| `POST /tenants` (super) | 400 `prisma.user` | **400 `prisma.user` — continua quebrado, ver §6** |

---

## 6. O que CONTINUA amarrado ao NOC depois desta entrega

1. ⚠️ **`ragnabot-tenant.routes.js` ainda lê `prisma.user` em 3 pontos** (linhas ~53, ~99, ~104).
   O arquivo **não é meu** por contrato, e por isso **não foi tocado**. Consequência medida: toda
   escrita do SaaS que passa pelo portão de 2FA (`POST /tenants`, suspender, excluir, cobrança)
   ainda responde `Cannot read properties of undefined (reading 'findUnique')`. **O conserto é o
   mesmo dos 3 pontos do fluxo** — trocar a leitura por `otp.canaisDe(req.user)` /
   `otp.dicaDeEmail(req.user.email)` e passar `req.user` como terceiro argumento de
   `createAndSendEmailOtp`. Precisa de uma decisão do chefe sobre quem edita.
2. **`ssh-pool.service.js`** continua no motor, e `ragnabot-cluster.routes.js` continua sendo
   observação — que é do NOC (doc 33 §8.1). Não é amarra de atendimento, mas é código do NOC vivendo
   na aplicação nova.
3. **`smtp.service.js` ainda não existe** nesta aplicação: o **nó de e-mail do fluxo**
   (`ragnabot-fluxo-nos.service.js`, `portaDeEmail()`) faz `import('./smtp.service.js')` e vai
   falhar em produção. Esta entrega resolveu o envio **do segundo fator**, não o do fluxo. O
   transporte que escrevi em `otp.service.js` é a base pronta para esse arquivo — decisão do chefe
   sobre quem o extrai.
4. **A ponte de serviço continua sendo a única porta para `super`** — por desenho, e ela é
   transitória (doc 33 §7.3).

---

## 7. O que o chefe precisa decidir

1. **Versionamento (Lei 6):** **não** bumpei `VERSAO` nem escrevi em `VERSOES.md`/`MANUAL.md`.
   Os três arquivos já estão modificados na árvore por outra entrega da mesma noite (`1.04.00`), e
   dois agentes escrevendo no mesmo bloco de versão é conflito garantido. **Falta o bump.**
2. **`ragnabot-tenant.routes.js`** (§6.1) — sem ele, escrita de SaaS continua fora do ar.
3. **Tabela de OTP no banco** (§3.2) — se o incômodo das 2 réplicas incomodar de verdade.
4. **`SMTP_*` no `Secret`/`ConfigMap`** — enquanto não existirem, o segundo fator recusa
   (de propósito), e portanto **publicar fluxo fica bloqueado**.
5. **`npm run test:unit` (vitest) já estava quebrado antes desta entrega** — ele coleta os
   `*.test.mjs` que são roteiros de mão (15 arquivos falhando antes, 16 depois, porque o meu entra
   na mesma lista). O glob do vitest devia ser só `.test.js`, como manda a lei da casa. Medido nos
   dois estados; **não é regressão minha**, e o conserto é no `package.json`, que não é meu.
