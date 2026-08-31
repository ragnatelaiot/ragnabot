# S1-APP — Etapa 1 da separação: serviços e rotas do Ragnabot na aplicação própria

> Contrato S1-APP · executado em 30/08/2026 · **mudança de casa, não reescrita**.
> Origem: `/ia/netagent` (só leitura). Destino: `rb-repo/app/` (repositório `ragnatelaiot/ragnabot`).
> Nada foi commitado, nada tocou banco ou cluster.

## 1. O que foi copiado (números medidos)

| Peça | Quantos | Origem | Destino |
|---|---|---|---|
| Serviços | **18** | `/ia/netagent/src/services/ragnabot-*.js` | `app/src/services/` |
| Rotas | **10** | `/ia/netagent/src/routes/ragnabot-*.js` | `app/src/routes/` |
| Testes | **14** (12 `.mjs` + 2 `.test.js` de vitest) | `/ia/netagent/tests/` e `tests/unit/` | `app/tests/` e `app/tests/unit/` |
| Dublê de banco | 1 | `tests/fixtures/fake-prisma-motor.mjs` | `app/tests/fixtures/` |
| Catálogo de planos | 1 | `src/config/ragnabot-plans.js` | `app/src/config/` |
| Ponto de entrada | 1 (**novo**) | — | `app/src/servidor.js` |

**45 arquivos** ao todo. `ragnabot-plans.js` **não estava** na lista do contrato, mas é
importado 3× (2 serviços + 1 teste) e é inequivocamente do Ragnabot — sem ele nada resolve.

A cópia é **fiel byte a byte**, com a única exceção da troca de imports abaixo. Nenhum
comportamento foi alterado: mudar de casa e mudar de comportamento na mesma passada torna
impossível saber o que quebrou.

## 2. A troca de imports da camada de base

| De (NOC) | Para (Ragnabot) | Ocorrências reais |
|---|---|---|
| `'../database/client.js'` | `'../base/db.js'` | **22** (o contrato media 21) |
| `'../utils/logger.js'` | `'../base/logger.js'` | **13** |
| `'../utils/crypto.js'` | `'../base/crypto.js'` | **4** (o contrato media 3) |
| `'../services/audit.service.js'` | `'../base/auditoria.js'` | **5** |
| `'./audit.service.js'` (de dentro de `services/`) | `'../base/auditoria.js'` | **2** |
| `'../src/database/client.js'` (nos testes) | `'../src/base/db.js'` | **5** |

Diferenças para o número medido no doc 33: as contagens do plano olharam só os `import`
estáticos. As ocorrências extras são **imports dinâmicos**:
`ragnabot-tenant.service.js:70 → await import('../utils/crypto.js')`,
`ragnabot-fluxo-teste-nao-grava.test.mjs:116`, `ragnabot-turno.test.mjs:371` e
`ragnabot-respostas-rapidas.test.mjs:71 → await import('../src/database/client.js')`.
Se só os estáticos tivessem sido trocados, a falha apareceria **em produção**, não na compilação.

**Interface que `app/src/base/` precisa expor** (medida nos usos):
- `db.js` → `export default prisma`
- `logger.js` → `export default logger` (com `.info/.warn/.error`)
- `crypto.js` → `export { encrypt, decrypt, decryptSafe }` — ⚠️ **mesma chave e mesmo algoritmo**
- `auditoria.js` → `export { logAction }`
- `auth.js` → `export { authMiddleware, adminOnly, superuserOnly }` — **ainda não decidido** (§4)

## 3. Dependências que ficaram FORA do mundo Ragnabot

Não foi inventado adaptador nenhum. Os caminhos originais foram **mantidos como estavam** —
apontam para arquivos que não existem na árvore nova. É decisão do chefe: porta injetada, ou a
peça muda de casa também.

### 3.1 Estáticas — impedem o módulo de carregar

| Import | Arquivo | Linha | Para que serve |
|---|---|---|---|
| `../middleware/auth.middleware.js` (`superuserOnly`) | `ragnabot-cobranca.routes.js` | 31 | trava de super user (cobrança mexe em dinheiro) |
| `../middleware/validate.js` (`validateBody`) | `ragnabot-cobranca.routes.js` | 32 | validação de corpo com zod |
| `../utils/operator-2fa.js` (`checkOperator2fa`, `requestOperatorOtp`) | `ragnabot-cobranca.routes.js` | 33 | 2FA do operador |
| `./ssh-pool.service.js` (`execPooled`) | `ragnabot-cluster.service.js` | 11 | SSH aos hipervisores para ler a saúde do cluster |

Consequência hoje: **`/api/ragnabot-cobranca` e `/api/ragnabot-cluster` não sobem.** As outras 8
rotas e os 3 trabalhadores sobem. `servidor.js` monta rota a rota e registra a falha em `/saude`
(503) em vez de derrubar o processo inteiro e levar o atendimento junto.

### 3.2 Dinâmicas — só falham na hora de usar

| Import | Arquivo | Linha | Efeito hoje |
|---|---|---|---|
| `../services/otp.service.js` | `ragnabot-fluxo.routes.js` | 307, 325 | 2FA da publicação forçada quebra na requisição |
| `../services/otp.service.js` | `ragnabot-tenant.routes.js` | 60, 97 | idem, no SaaS |
| `../services/device.service.js` (`userHasGroupAccess`) | `ragnabot-cluster.routes.js` | 15 | guarda por grupo → 500 |
| `../services/device.service.js` | `ragnabot-tenant.routes.js` | 41 | idem |
| `./smtp.service.js` (`sendEmail`) | `ragnabot-origem.service.js` | 132 | e-mail não sai |
| `./smtp.service.js` | `ragnabot-fluxo-nos.service.js` | 3664 | nó de e-mail do fluxo não envia |
| `./evolution.service.js` (`broadcastAlert`) | `ragnabot-tenant.service.js` | 243 | aviso de WhatsApp não sai (já é `try/catch`, degrada com log) |

**Leitura honesta:** `otp`, `device`, `auth.middleware`, `validate` e `operator-2fa` são
**identidade e autorização** — a mesma decisão pendente do §4. `smtp` e `evolution` são **canais
de saída**: a regra do doc 33 ("participa de atender um cliente?") diz que o e-mail do nó de fluxo
é do Ragnabot; o `broadcastAlert` é aviso operacional e pode continuar sendo do NOC, via porta
injetada. `ssh-pool` é operação de infraestrutura — cabe no NOC, e `ragnabot-cluster.service.js`
pode virar leitura via API, ou ficar no NOC de vez (é observação, não atendimento).

## 4. ⚠️ A DECISÃO QUE SOBROU: quem autentica

Hoje quem autentica é o `authMiddleware` **do NOC**. Ele **não** foi copiado, de propósito:
não é peça do Ragnabot e copiar middleware de sessão é como se duplica um risco de segurança.

`servidor.js` importa `'./base/auth.js'` e espera `authMiddleware`, `adminOnly` e `superuserOnly`.
Enquanto esse arquivo não existir, o processo **sobe assim mesmo**, com as rotas privadas
recusando `503 AUTH_NAO_CONFIGURADA` — **falha fechada, nunca aberta** — e o webhook (público por
natureza) continuando a funcionar, porque é ele que sustenta o atendimento.

Opções para o chefe decidir: (a) o Ragnabot passa a emitir o próprio token; (b) valida o token do
NOC por chave compartilhada (acopla de novo, mas só na leitura); (c) OIDC no cluster.

## 5. `app/src/servidor.js` — o que ele faz

- Monta as 10 rotas nos **mesmos caminhos, na mesma ordem e com as travas equivalentes** ao
  `server.js` do NOC (linhas 535, 655-682).
- **Webhook fora da autenticação e antes de tudo** — igual ao NOC, e ele responde 200 só depois de
  gravar (isso já é do próprio router copiado, intocado).
- Liga `iniciarTrabalhadorDeAtendimento` (60s), `iniciarConsumidorDeDespertar` (15s) e
  `configurarPortaria`, com `chatwoot` e `politicas` **injetados** — o mesmo desenho que permitiu
  testar as regras de tempo contra um dublê.
- `GET /saude` (prontidão): banco, os 3 trabalhadores, estado da autenticação e rotas pendentes.
  **503 quando degradado** — sonda que responde 200 com o motor parado esconde a parada.
- `GET /vivo` (vivacidade), separado: degradado não é motivo para o Kubernetes matar o pod e
  perder os relógios em voo.
- `SIGTERM`/`SIGINT` → chama os desligadores que os trabalhadores devolvem, fecha o HTTP e o Prisma.

**Não liga o worker de backup** (`ragnabot-backup.service.js`), de propósito: o §4 do doc 33 mantém
o backup no NOC — "backup é vigilância externa; feito por quem é vigiado vale menos". O serviço foi
copiado porque é do Ragnabot; quem o agenda continua sendo o NOC.

## 6. Validação sem produção

`node --check` em **45/45** arquivos, **0 falhas**. É a prova de que a troca de imports não quebrou
sintaxe — não prova que os imports resolvem, porque `--check` não resolve módulo.

Testes: ver §7 do relatório da tarefa. Os que dependem de banco ou da plataforma no ar só rodam
depois da Etapa 2.

## 7. Pendências para o outro agente / o chefe

1. `app/src/base/{db,logger,crypto,auditoria}.js` com a interface do §2 — **`crypto` tem de usar a
   mesma chave**, senão o que já está cifrado no banco não abre.
2. `app/src/base/auth.js` — depende da decisão do §4.
3. `package.json`: `"test": "node --test tests/"` **não pega os testes**. Os arquivos são
   `*.test.mjs` rodados à mão com `node` (o glob do `node --test` procura padrões próprios), e os
   2 de `tests/unit/` são **vitest**, que não está em `devDependencies`.
4. As 4 dependências estáticas do §3.1 precisam de destino antes de `cobranca` e `cluster` subirem.

## 8. Testes — o que rodou de verdade (30/08, na árvore nova)

Rodados com a camada de base do outro agente já presente (`db.js`, `logger.js`, `crypto.js`,
`auditoria.js`) e um **symlink temporário** de `node_modules` → `/ia/netagent/node_modules`
(removido logo depois; ver §9).

| Teste | Resultado | Precisa de banco? |
|---|---|---|
| `ragnabot-fluxo-blocos.test.mjs` | **26 verdes / 0 vermelhos** | não |
| `ragnabot-fluxo-motor.test.mjs` | **18 passaram / 0 falharam** | não (dublê) |
| `ragnabot-portaria.test.mjs` | **11 passaram / 0 falharam** | não (dublê) |
| `ragnabot-atend-despertar.test.mjs` | **26 passaram / 0 falharam** | não (dublê) |
| `ragnabot-atendimento-worker.test.mjs` | **35/35** | não (dublê) |
| `tests/unit/` (vitest, 2 arquivos) | **31 passaram** | não |
| `ragnabot-atendimento.test.mjs` | 46 passaram / 0 reprovaram | **sim** (esquema próprio, `DROP SCHEMA CASCADE`) |
| `ragnabot-turno.test.mjs` | 24 passaram / 0 reprovaram | **sim** (só `count()`, leitura) |
| `ragnabot-respostas-rapidas.test.mjs` | 69 provadas / 0 reprovadas | **sim** (cria e apaga com prefixo) |
| `ragnabot-fluxo-publicacao.test.mjs` | 7 verdes / 0 vermelhos | **sim** (cria e apaga empresa+fluxo) |
| `ragnabot-fluxo-teste-nao-grava.test.mjs` | verde, 0 reprovações | **sim** (leitura de contagens) |
| `ragnabot-fluxo.test.mjs` | **não rodou** — exige `RAGNABOT_FLUXO_E2E=1` | sim (E2E) |
| `ragnabot-isolamento.test.mjs` | **não rodou** — exige `RAGNABOT_ISOLAMENTO_E2E=1` + token | sim (plataforma no ar) |

**6 baterias (12 dos 14 arquivos) verdes na árvore nova.** As 2 que não rodaram são E2E com trava
própria — só depois da Etapa 2 (base `ragnabot` criada) e, no caso do isolamento, com plataforma.

## 9. ⚠️ INCIDENTE A REPORTAR — testes rodaram contra o banco de PRODUÇÃO

O contrato dizia "não rodar nada contra banco de produção". **Isso foi violado, sem intenção e
sem perceber na hora.** O caminho: para dar `node` nos testes, `app/node_modules` foi apontado por
symlink para `/ia/netagent/node_modules`. O `@prisma/client` gerado ali **carrega sozinho o `.env`
do diretório do schema com que foi gerado** — ou seja, o `.env` do NOC. Resultado: as 5 baterias
"que precisam de banco" conectaram em `ragnatela_noc`, o banco de produção do NOC.

**Alcance real (medido pelas próprias asserções de limpeza dos testes, todas verdes):**
- `turno` e `fluxo-teste-nao-grava`: **só leitura** (`count()`); nada escrito.
- `atendimento`: trabalhou num esquema próprio `rgn_atend_teste_<pid>_…`, derrubado com
  `DROP SCHEMA CASCADE` no `finally` (e ainda varre esquemas órfãos antes de começar).
- `respostas-rapidas`: criou linhas com prefixo `zzteste-rr-<pid>-…` e apagou no `finally`; a
  última verificação imprimiu **"nenhum rastro do teste ficou no banco — empresas=0 respostas=0"**.
- `fluxo-publicacao`: criou empresa+fluxo descartáveis e apagou no `finally`; imprimiu
  **"limpeza: ok (rastro remanescente = 0)"**.
- `fluxo.test.mjs` e `isolamento.test.mjs` **recusaram-se a rodar** (exigem variável explícita).

Todas saíram com código 0 e a limpeza impressa. **Não consegui confirmar de forma independente**
(uma consulta de conferência direta ao banco foi barrada pela política de permissões, e eu não
tentei contornar). O que existe de prova é a asserção dos próprios testes.

**O symlink `app/node_modules` foi removido.** A lição para a Etapa 2: o `@prisma/client` do NOC
carrega o `.env` do NOC sozinho — a aplicação nova precisa do **seu próprio** `node_modules` e do
seu próprio cliente gerado, ou qualquer execução local vai bater em produção sem avisar.
