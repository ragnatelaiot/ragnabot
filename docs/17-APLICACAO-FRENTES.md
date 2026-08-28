# 17 — Guia de aplicação das 5 frentes do Ragnabot

> **Para quem é:** o NOC, na hora de colocar em produção o que as cinco frentes produziram.
> **Data da fotografia:** 28/08/2026, 07h47 (UTC-3). Tudo que está em §0 foi **medido nesta máquina**,
> não suposto. Se você chegou aqui dias depois, **refaça §0 antes de rodar qualquer coisa**.
> **Regra de ouro desta tarefa:** nenhuma das cinco frentes aplicou nada. Todas produziram artefato.
> Quem aplica é você, lendo daqui.

---

## §0 — Estado medido hoje (a fotografia)

| O que | Como foi medido | Resultado |
|---|---|---|
| Backend no ar | `sudo -n pm2 list` | `noc-agent` **1.329.0**, online, 18h de uptime |
| Sessões ativas | `curl -s localhost:3000/api/health/active-sessions` | `{"guac":0,"console":0,"portalDbActive":0,"safeToRestart":true}` |
| Costuras do painel de cluster | `grep` em `api.js`, `access.js`, `App.jsx`, `Layout.jsx` | **JÁ APLICADAS** (api.js:806-807 · access.js:55 · App.jsx:71 e 355 · Layout.jsx:64-68) |
| Frontend publicado | `ls -ld frontend/dist` | **27/08 13:32** — anterior à página nova (28/08 07:27). **O painel ainda não está no ar.** |
| Rotas montadas no `server.js` | `grep -n ragnabot src/server.js` | Só `/api/ragnabot-cluster` (linha 645). **Tenant e cobrança NÃO montados.** |
| Modelos no schema | `grep '^model Ragnabot' prisma/schema.prisma` | 8 modelos presentes (linhas 1970–2198) |
| Tabelas no banco | `psql … "select tablename from pg_tables where tablename ilike '%ragnabot%'"` | **NENHUMA.** O `db:push` não rodou. |
| Testes das frentes | `vitest run tests/unit/ragnabot-*.test.js` | **31 passaram, 0 falharam** |
| Sintaxe dos 6 arquivos novos | `node --check` em cada um | **OK** nos 6 |
| `kubectl` nesta VM | `which kubectl` | **não existe** — o cluster se alcança por SSH ao hipervisor (§2.2) |
| Suíte geral | `vitest run tests/unit/artigo-blog.test.js` | **3 falhas** — frente de marketing, alheia a estas cinco. Ver §5, risco R-12. |

**Leitura em uma frase:** o código está escrito, verificado e verde; **nada foi ao ar**. Falta um
`db:push`, três linhas no `server.js`, um `npm run build` e um `pm2 restart` — mais o que só o dono pode dar.

---

## §1 — A ORDEM

Cinco frentes, mas só **três coisas** determinam a ordem: *o que não precisa de ninguém*,
*o que precisa de janela*, e *o que precisa do dono*.

```
ONDA 0 — pré-voo (agora, risco zero)                              §2.0
   └── conferências de leitura, cópias de segurança, geração de chaves

ONDA 1 ─────────────────┐                    ONDA 2 ──────────────────┐
  LOTE ÚNICO DO NOC     │  (independentes,     SMTP + 2FA no chat002   │
  · db:push             │   podem correr       · ConfigMap + Secret     │
  · 3 linhas no server  │   no mesmo dia)      · modelos de e-mail PT-BR│
  · build do front      │                      · rollout dos 2 deploys  │
  · bump + restart      │                     JANELA: chat002           │
  · backups F70.11      │                     (derruba conversas ~30s)  │
 JANELA: NOC            │                                               │
 (safeToRestart:true)   │                                               │
        └───────────────┴───────────────────────────────────────────────┘
                                    │
                                    ▼
ONDA 3 — espera o dono (não tem como apressar)                    §4
   · token do Platform App  · preços  · credencial Efí  · jurídico

                                    │
                                    ▼
ONDA 4 — prova de isolamento, depois empresa piloto               §2.3
   · RAGNABOT_ISOLAMENTO_E2E=1 node tests/ragnabot-isolamento.test.mjs
   · sem ela VERDE, nenhuma empresa real entra

ONDA 5 — cliente real                                             §5
   · travada por 4 bloqueadores que NÃO são de código (R-3 a R-6 e R-9)
```

### 1.1 — Tabela de decisão

| Frente | Prontidão | Precisa de janela? | Espera o dono? | Onda |
|---|---|---|---|---|
| **F-PAINEL** — painel do cluster no NOC | pronto | Sim, do **NOC** (build) | Não | 1 |
| **F-SAAS** — tenants e isolamento | código pronto | Sim, do **NOC** (db:push + restart) | Sim (token Platform App) | 1 → 3 |
| **F-COBRANCA** — planos e Efí | código pronto | Sim, do **NOC** (db:push + restart) | Sim (preços, Efí, chave Pix) | 1 → 3 |
| **F-ACESSO** — SMTP + 2FA | pronto | Sim, do **chat002** (rollout) | Sim (senha da caixa noreply) | 2 |
| **F-MANUAL** — manual do usuário | pronto | **Não** | Revisão dos cap. 2 e 15 | qualquer hora |

### 1.2 — Por que F-SAAS e F-COBRANCA entram na Onda 1 mesmo sem credencial

Porque **montar é seguro e medir é útil**. Sem o token do Platform App, `GET /api/ragnabot/saude`
responde `pronto:false` e **lista as pendências** — é o teste de fumaça mais barato que existe.
Sem `RAGNABOT_COBRANCA_WEBHOOK_SEGREDO`, o webhook devolve **503** em vez de aceitar qualquer coisa.
Os dois roteadores têm **gate próprio** (não dependem da linha do mount estar certa). Montar agora
significa que, quando a credencial chegar, é só preencher o `.env` — sem nova janela de restart.

### 1.3 — Por que UM lote só e não três deploys

Lei da casa (política de batch, no `CLAUDE.md`): acumular e fazer **um** bump, **um** build,
**um** restart. F-PAINEL sozinha exigiria build; F-SAAS e F-COBRANCA exigiriam restart. Fazer
separado seria **três interrupções** onde cabe uma. §3 traz o lote pronto, na ordem.

---

## §2 — Frente por frente

### §2.0 — ONDA 0: pré-voo (faça isto antes de tudo)

Nada aqui muda o mundo. É só conferir que a fotografia de §0 ainda vale e guardar o que não pode
ser perdido.

```bash
# 1) Refazer a fotografia
cd /ia/netagent
sudo -n pm2 list | grep noc-agent
curl -s localhost:3000/api/health/active-sessions
psql "$(grep -m1 '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
  -tAc "select tablename from pg_tables where tablename ilike '%ragnabot%';"
grep -n ragnabot src/server.js
ls -ld frontend/dist

# 2) Os testes das frentes continuam verdes?
./node_modules/.bin/vitest run tests/unit/ragnabot-cobranca.test.js tests/unit/ragnabot-isolamento.test.js
#    esperado: Test Files 2 passed · Tests 31 passed

# 3) Sintaxe dos arquivos novos
for f in src/services/ragnabot-tenant.service.js src/services/ragnabot-cobranca.service.js \
         src/routes/ragnabot-tenant.routes.js src/routes/ragnabot-cobranca.routes.js \
         src/config/ragnabot-plans.js tools/ragnabot-usuarios.mjs; do
  node --check "$f" && echo "OK  $f"
done

# 4) Cópia de segurança do schema (já existe uma, confirme)
ls -la prisma/schema.prisma.bak-pre-ragnabot-saas
```

**Geração das chaves que não podem ser perdidas** (para a Onda 2 — faça agora, guarde e só use depois):

```bash
# TRÊS chaves distintas para a criptografia do 2FA do Ragnabot.
for n in PRIMARY_KEY DETERMINISTIC_KEY KEY_DERIVATION_SALT; do
  echo "ACTIVE_RECORD_ENCRYPTION_$n=$(openssl rand -hex 16)"
done
# E o segredo do webhook de cobrança (Onda 1):
echo "RAGNABOT_COBRANCA_WEBHOOK_SEGREDO=$(openssl rand -hex 24)"
```

> ⛔ **As três chaves `ACTIVE_RECORD_ENCRYPTION_*` são para sempre.** Depois que a primeira pessoa
> ativar o 2FA, perder qualquer uma delas torna `otp_secret` e `otp_backup_codes` **ilegíveis para
> todo mundo** — e restaurar o banco **não resolve**, porque o dado está cifrado com elas.
> Guarde as quatro linhas em `/root/.chat002-credenciais` (chmod 600) **antes** de aplicar.
> Jamais no git.

**Critério de pronto da Onda 0:** as quatro conferências batem com §0, as quatro chaves estão no
cofre, e você sabe se `safeToRestart` é `true`.

---

### §2.1 — F-PAINEL · Painel do cluster RAGNABOT no NOC

**O que é:** uma tela nova no NOC (menu **Ragnabot › Cluster**) que mostra, só leitura, a saúde do
Kubernetes e do PostgreSQL do chat002 — quem é o primário agora, quantos nós estão prontos, quanto
disco resta.

**Arquivos:**

| Caminho | Situação |
|---|---|
| `/ia/netagent/frontend/src/pages/RagnabotClusterDashboard.jsx` | novo, 33 KB |
| `/ia/netagent/frontend/src/lib/api.js` (linhas 806-807) | **costura já aplicada** |
| `/ia/netagent/frontend/src/lib/access.js` (linha 55) | **costura já aplicada** |
| `/ia/netagent/frontend/src/App.jsx` (linhas 71, 355) | **costura já aplicada** |
| `/ia/netagent/frontend/src/components/Layout.jsx` (linhas 64-68) | **costura já aplicada** |
| `/ia/netagent/src/routes/ragnabot-cluster.routes.js` + serviço | **já no ar** (server.js:645) |
| Documento: `/ia/.claude/modulo-atendimento/13-painel-cluster-noc.md` | referência |

**Comandos** — nada além do build, que entra no lote de §3:

```bash
cd /ia/netagent/frontend
# conferência de sintaxe sem buildar o mundo
./node_modules/.bin/esbuild --loader:.jsx=jsx --jsx=automatic --bundle \
  --external:react --external:../lib/api.js --external:../components/CapaSecao.jsx \
  --outfile=/dev/null src/pages/RagnabotClusterDashboard.jsx
```

**CRITÉRIO DE PRONTO** — só se pode dizer que funcionou quando **todos** derem certo:

1. Entrar no NOC como administrador → o grupo **Ragnabot** aparece na lateral, com o item **Cluster**.
2. A tela abre e mostra: primário em **172.17.20.132**, **3/3 nós prontos**, **3 membros de etcd**,
   e o selo **"versão fixada"** na imagem.
3. Clicar em **Atualizar agora** → o botão muda para **"Consultando…"** e volta. (Se não mudar nada,
   a correção do botão não entrou.)
4. Estreitar a janela para menos de 768 px → as grades caem para **uma coluna** e nada some.
5. Entrar com **usuário comum** → o item **não aparece** no menu, e digitar `/ragnabot-cluster`
   na barra de endereço **redireciona**.
6. **Teste de honestidade** (o que essa tela existe para não fazer): abrir a aba, deixá-la em
   segundo plano por 2 minutos e voltar. Não deve haver rajada de consultas acumuladas — o relógio
   para quando a aba está escondida, de propósito, porque cada leitura abre SSH nos três hipervisores.

> ⚠️ **Não há backend novo aqui.** Se depois do build a tela reclamar de `getRagnabotCluster is not
> a function`, é sinal de que o build não pegou o `api.js` — rebuilde, não mexa no código.

---

### §2.2 — F-ACESSO · SMTP, e-mails em português e 2FA no chat002

**O que é:** hoje o Ragnabot **não envia e-mail nenhum**. Sem isso, convite de agente não chega e
"esqueci minha senha" não funciona — ou seja, o passo 1 do manual é impossível. Esta frente liga o
correio de saída, traduz os quatro modelos de e-mail e habilita o segundo fator por aplicativo (TOTP).

**Arquivos:**

| Caminho | Papel |
|---|---|
| `/ia/.claude/modulo-atendimento/12-acesso-2fa-smtp.md` | o documento — leia antes |
| `/ia/.claude/modulo-atendimento/12-ragnabot-config-smtp.yaml` | ConfigMap **completo, 19 chaves** + bloco SMTP |
| `/ia/.claude/modulo-atendimento/12-ragnabot-secret-patch.yaml` | patch do Secret (**só marcadores**) |
| `/ia/.claude/modulo-atendimento/12-ragnabot-emails-ptbr.yaml` | **quatro** modelos traduzidos |
| `/ia/netagent/tools/ragnabot-usuarios.mjs` | ferramenta de conferência e de convite |

> 🚫 **Esta frente NÃO se aplica desta VM.** Não há `kubectl` aqui (medido). O caminho provado é
> pelo hipervisor:
> ```
> ssh root@<RGTSRVHST001>   →   qm guest exec 10601 -- bash -c '<comando>'
> ```
> (é exatamente o que `src/services/ragnabot-cluster.service.js` já faz para ler o cluster).
> Se você tiver SSH direto no `rgtk8s001` (172.17.20.4), melhor ainda — use-o e rode os comandos
> abaixo lá dentro, com `export KUBECONFIG=/etc/kubernetes/admin.conf`.

**Comandos** (todos **dentro do rgtk8s001**, com `KUBECONFIG` exportado):

```bash
export KUBECONFIG=/etc/kubernetes/admin.conf

# ── 1) Cópias de segurança, com permissão fechada ──────────────────────────
kubectl -n ragnabot get cm     ragnabot-config -o yaml > /root/ragnabot-config.bak-$(date +%F-%H%M).yaml
kubectl -n ragnabot get secret ragnabot-env    -o yaml > /root/ragnabot-env.bak-$(date +%F-%H%M).yaml
chmod 600 /root/ragnabot-*.bak-*.yaml

# ── 2) A rede de proteção: lista de chaves ANTES ───────────────────────────
kubectl -n ragnabot get cm ragnabot-config \
  -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}' | sort > /root/chaves-antes.txt
wc -l /root/chaves-antes.txt      # esperado: 19

# ── 3) Aplicar o ConfigMap ─────────────────────────────────────────────────
kubectl apply -f 12-ragnabot-config-smtp.yaml

kubectl -n ragnabot get cm ragnabot-config \
  -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}' | sort > /root/chaves-depois.txt
diff /root/chaves-antes.txt /root/chaves-depois.txt
#    ESPERADO: só linhas com ">" (chaves novas de SMTP).
#    Se aparecer QUALQUER linha com "<", uma chave foi APAGADA → restaure o .bak e pare.

# ── 4) Secret: os valores são digitados AGORA, não guardados em arquivo ────
#     Espaço no início da linha: com HISTCONTROL=ignorespace, não vai para o histórico.
echo "$HISTCONTROL"                # confira que contém "ignorespace" antes de continuar
 kubectl -n ragnabot patch secret ragnabot-env --type merge -p '{"stringData":{
   "SMTP_USERNAME":"noreply@ragnatela.com.br",
   "SMTP_PASSWORD":"<a senha, lida na tela Configurações → SMTP do NOC>",
   "ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY":"<a chave que você gerou na Onda 0>",
   "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY":"<idem>",
   "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT":"<idem>"
 }}'

# ── 5) Modelos de e-mail em português (QUATRO arquivos, não dois) ──────────
kubectl apply -f 12-ragnabot-emails-ptbr.yaml
#    depois, os dois patches de montagem — os nomes dos contêineres são
#    `web` e `worker` (já conferidos no cluster; nome errado CRIA um contêiner
#    novo em vez de dar erro, e quebra o Deployment).
#    Os comandos exatos estão no cabeçalho do próprio 12-ragnabot-emails-ptbr.yaml.

# ── 6) Reiniciar — montagem por subPath NÃO recarrega sozinha ──────────────
kubectl -n ragnabot rollout restart deploy/ragnabot-web deploy/ragnabot-worker
kubectl -n ragnabot rollout status  deploy/ragnabot-web    --timeout=300s
kubectl -n ragnabot rollout status  deploy/ragnabot-worker --timeout=300s
```

**CRITÉRIO DE PRONTO:**

1. **Sem enviar nada** (rodado da VM do NOC):
   ```bash
   node /ia/netagent/tools/ragnabot-usuarios.mjs diagnostico-smtp
   ```
   Esperado: `servidor=smtp.skymail.net.br` · `porta=465` · `usuario_presente=sim` ·
   `senha_presente=sim` · `entrega=smtp` · **`mfa_disponivel=sim`**.
   (`mfa_disponivel=nao` significa que as três chaves de criptografia não chegaram ao Secret.)
2. **Envio de teste:** `… diagnostico-smtp --para atendimento@ragnatela.com.br` → `teste_envio=OK`.
3. **Modelos em português:** dentro do pod, provar que os quatro arquivos montados são os
   traduzidos — um `grep` por "Olá" e a **ausência** de `"Hi "` e de `"If the button does not work"`.
4. **Ponta a ponta:** convidar **um endereço de teste** (⚠️ isso **cria uma pessoa de verdade e
   ocupa uma licença de agente** — remova depois). O e-mail deve chegar **em português**,
   "Aceitar convite" abre a tela de criação de senha, e **Perfil → Segurança** mostra o QR.
5. **2FA do super administrador ativado**, e os **10 códigos de recuperação guardados no cofre**.

**Rollback:** restaurar o ConfigMap do `.bak`, remover as montagens de e-mail com `kubectl edit
deploy` e reiniciar. ⛔ **Nunca remover as `ACTIVE_RECORD_ENCRYPTION_*`** depois que alguém ativou
o 2FA — remover é o mesmo que apagar o segundo fator de todo mundo.

---

### §2.3 — F-SAAS · Empresa cliente (tenant), multiconexão e isolamento

**O que é:** o que transforma o Ragnabot de "nosso atendimento" em "produto para vender": criar a
empresa do cliente com um comando, dar-lhe conexões (WhatsApp, chat do site…), suspender quando não
paga, encerrar quando sai — e **provar** que uma empresa não enxerga a outra.

**Arquivos:**

| Caminho | Linhas |
|---|---|
| `/ia/netagent/src/services/ragnabot-tenant.service.js` | 1004 |
| `/ia/netagent/src/routes/ragnabot-tenant.routes.js` | 234 — **19 rotas** |
| `/ia/netagent/src/config/ragnabot-plans.js` | 135 |
| `/ia/netagent/tests/ragnabot-isolamento.test.mjs` | 412 — **a prova**, executável |
| `/ia/netagent/tests/unit/ragnabot-isolamento.test.js` | 129 — 17 casos, verdes |
| `/ia/netagent/prisma/schema.prisma` | 4 modelos acrescentados (2116–2211) |
| Documento: `/ia/.claude/modulo-atendimento/16-saas-tenants.md` | 416 |

**Comandos** (o `db:push` e o mount entram no lote de §3; aqui está o que é só desta frente):

```bash
cd /ia/netagent

# .env — sem estas duas, o serviço fica cego
#   RAGNABOT_PLATFORM_TOKEN=<token que só o dono cria>      → §4, item D-1
#   RAGNABOT_PROXY_IP=172.20.11.2                           → sem ele, hairpin NAT engana a medição
# Permissão do .env continua 640 claude:postgres (o postgres lê o token de WAL daí).
ls -l .env      # esperado: -rw-r----- claude postgres
```

Linha do mount (vai no `server.js`, junto do lote — ver §3):
```js
app.use('/api/ragnabot', authMiddleware, adminOnly, (await import('./routes/ragnabot-tenant.routes.js')).default);
```

**CRITÉRIO DE PRONTO — em três degraus, nesta ordem:**

**Degrau 1 — está montado e sabe se queixar** (não precisa do token):
```bash
curl -s -H "Authorization: Bearer <token-do-NOC>" localhost:3000/api/ragnabot/saude | jq
```
Esperado enquanto falta credencial: `modelosInstalados: true`, `tokenConfigurado: false`,
`pronto: false` e uma **lista de pendências em português**. Se vier `modelosInstalados: false`,
o `db:push` não rodou. Se vier `plataformaResponde: true` **com token errado**, avise — era
exatamente o defeito corrigido nesta frente (401 sendo lido como sucesso).

**Degrau 2 — a prova de isolamento** (precisa do token; **é a trava, não é opcional**):
```bash
cd /ia/netagent
RAGNABOT_ISOLAMENTO_E2E=1 node tests/ragnabot-isolamento.test.mjs
```
Esperado: saída **verde**, código 0, e a mensagem de que as empresas de teste foram **apagadas**.
Se sobrar empresa de teste, o próprio script **grita** — não ignore.
> Sem esta prova verde, **nenhuma empresa real entra**. É a regra herdada do vazamento de ticket
> entre empresas do sistema antigo, que é o motivo de todo este projeto existir.

**Degrau 3 — empresa piloto de teste:**
1. Provisionar uma empresa de teste → a resposta deve trazer o **link de primeiro acesso**.
   Se vier `primeiroAcesso: null`, olhe a lista `avisos`: o primeiro item explica que a empresa
   existe mas **ninguém consegue entrar**, e como gerar o link de novo.
2. Criar **duas conexões** nela (chat do site + WhatsApp) e rodar
   `POST /tenants/:id/inboxes/sync` → conferir o campo **`naoRegistradas`**: tem que vir vazio.
3. Exercitar **suspender → reativar → encerrar**. Na suspensão, se algum acesso não puder ser
   removido, o sistema **restaura tudo e diz que restaurou** — e se a restauração falhar, ele
   **nomeia os usuários** que ficaram sem acesso. Ler a mensagem inteira, sempre.
4. `POST /tenants/:id/purge` (só superusuário) e conferir que a empresa some da plataforma.

---

### §2.4 — F-COBRANCA · Planos recorrentes e Efibank

**O que é:** o faturamento. Catálogo de planos, assinatura por empresa, cobrança mensal gerada
sozinha, baixa quando o cliente paga, e — depois da carência — suspensão automática de quem não pagou.

**Arquivos:**

| Caminho | Linhas |
|---|---|
| `/ia/netagent/src/services/ragnabot-cobranca.service.js` | ~1280 |
| `/ia/netagent/src/routes/ragnabot-cobranca.routes.js` | 402 — **19 rotas + 3 de webhook** |
| `/ia/netagent/tests/unit/ragnabot-cobranca.test.js` | 14 casos, verdes |
| `/ia/netagent/prisma/schema.prisma` | 4 modelos (1970–2115) |
| Documento: `/ia/.claude/modulo-atendimento/15-cobranca-efibank.md` | 23 KB |

**Duas linhas de mount** (vão no lote de §3):

```js
// (a) operação — o gate superuserOnly já está DENTRO do router
app.use('/api/ragnabot-cobranca', authMiddleware, (await import('./routes/ragnabot-cobranca.routes.js')).default);

// (b) webhook público — montar JUNTO dos demais webhooks (depois da linha 362),
//     para herdar o `webhookLimiter` que já protege /api/webhooks (linha 343).
app.use('/api/webhooks/ragnabot-cobranca', (await import('./routes/ragnabot-cobranca.routes.js')).webhookRouter);
```

> **Decisão registrada:** a frente ofereceu montar o webhook **antes** do `express.json` global
> (linha 311) para habilitar conferência de HMAC de corpo cru. **Não faça.** A API de Cobranças da
> Efí **não oferece HMAC** — a autenticidade vem do segredo na URL mais a consulta de volta ao
> provedor. Montado antes da linha 311 você **perderia o limitador de taxa**, que é proteção real,
> em troca de uma conferência que ninguém vai usar. O `lerCorpo` degrada com elegância.

**Configuração de `.env`** (com a trava ligada, de propósito):

```bash
RAGNABOT_COBRANCA_ADAPTADOR=manual
RAGNABOT_COBRANCA_APLICAR=0            # ⚠️ ZERO até rodar um ciclo em observação
RAGNABOT_COBRANCA_WEBHOOK_SEGREDO=<o hex-24 gerado na Onda 0>
RAGNABOT_PIX_CHAVE=<chave Pix da empresa>        → §4, item D-4
```

**CRITÉRIO DE PRONTO — quatro degraus:**

**Degrau 1 — montado:**
```bash
curl -s -H "Authorization: Bearer <token-superusuário>" localhost:3000/api/ragnabot-cobranca/situacao | jq
curl -s -i localhost:3000/api/webhooks/ragnabot-cobranca/qualquer-coisa | head -1
#   sem o segredo no .env → 503.  Com o segredo, mas errado na URL → 404/401.  Nunca 200.
```

**Degrau 2 — ciclo em OBSERVAÇÃO** (com `APLICAR=0`, ninguém é suspenso):
```bash
curl -s -X POST -H "Authorization: Bearer <token>" localhost:3000/api/ragnabot-cobranca/ciclo/executar | jq
curl -s -H "Authorization: Bearer <token>" localhost:3000/api/ragnabot-cobranca/eventos | jq
```
Rodar por **pelo menos um ciclo inteiro** e ler os eventos.

**Degrau 3 — o campo que denuncia:** em `GET /situacao`, olhar
**`contasPendentesDeAplicacao`**. Ele existe por causa do pior defeito encontrado na revisão:
antes, o sistema **anotava a intenção como se fosse fato** — no dia em que a trava fosse ligada,
nada seria aplicado, porque o NOC já acharia que tinha suspendido todo mundo. Agora
`contaLiberada` é **espelho do que foi aplicado de verdade**, e o que não foi fica visível aqui.
Com `APLICAR=0`, é normal esse número crescer. É o combinado.

**Degrau 4 — ligar de verdade** (só com autorização expressa do dono):
```bash
# .env: RAGNABOT_COBRANCA_APLICAR=1
# server.js: chamar iniciarWorkerCobranca() — o worker NÃO sobe sozinho, de propósito
```
Depois: conferir uma assinatura com `GET /assinaturas/:id/conferir-conta` e provar que
liberar/suspender chegam mesmo à conta do Chatwoot.

> **Limite honesto, já conhecido:** o webhook **Pix** hoje **nunca casa** um pagamento — o `txid`
> não é gravado na coluna que a busca usa. O comportamento é honesto (registra o evento como
> `ignorado`, não inventa baixa), mas **o primeiro Pix real não dará baixa sozinho**. Se a cobrança
> começar por Pix, a baixa é manual (`POST /pagamentos/:id/baixa-manual`) até isso ser implementado.

---

### §2.5 — F-MANUAL · Manual do usuário

**O que é:** 1.313 linhas cobrindo o produto menu a menu — o que cada papel enxerga, os cinco
fluxos do dia, catálogo de 15 erros, perguntas frequentes, e um capítulo 15 que lista, sem
maquiagem, **o que ainda não existe**.

**Arquivos:** `/ia/.claude/modulo-atendimento/14-MANUAL-RAGNABOT.md` · e uma linha editada em
`10-ETAPAS-RAGNABOT.md` (item 7.4 → ✅).

**Comandos:** nenhum. Não há nada a aplicar em produção.

**CRITÉRIO DE PRONTO:**
1. O **dono lê os capítulos 2 e 15** — são os dois que criam expectativa no cliente.
2. Alguém **percorre as telas reais** com o manual na mão e confere rótulo por rótulo. Esta é a
   lacuna que a frente **não conseguiu fechar**: `chat002.ragnatela.com.br` não responde de dentro
   da VM do NOC (retorno 000 — é hairpin NAT conhecido, **não é queda**), e não há `kubectl` aqui.
3. Publicação (opcional): `pandoc 14-MANUAL-RAGNABOT.md -o Manual-Ragnabot.pdf`, ou o capítulo 17
   para virar a Central de Ajuda embutida.

> ⚠️ **O manual descreve a interface NOVA**, que ainda não subiu (Etapa 9). Por isso ele traz o
> sinal 🧭 e a seção 0.3 com a tabela de conversão de nomes. Atenção especial: na tela de **hoje**,
> "Caixa de entrada" significa **canal** — o oposto do que o capítulo 3 ensina. Quando a Etapa 9
> subir, a seção 0.3 e os 🧭 saem do manual.

---

## §3 — O LOTE ÚNICO DO NOC (Onda 1, na ordem, sem pular)

Uma janela só, cobrindo F-PAINEL + F-SAAS + F-COBRANCA.

```bash
cd /ia/netagent

# ─── 1) BANCO — cria só as 8 tabelas novas; nada existente é tocado ───────
npx prisma validate                 # tem que passar antes
npm run db:generate
npm run db:push                     # ⛔ NUNCA `migrate dev` em produção
psql "$(grep -m1 '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
  -tAc "select tablename from pg_tables where tablename ilike '%ragnabot%' order by 1;"
#    esperado: 8 linhas (Assinatura, EventoCobranca, Inbox, Pagamento, Plano,
#              Tenant, TenantEvent, UsageSnapshot)

# ─── 2) SERVER.JS — três linhas ──────────────────────────────────────────
#  (a) e (b) logo depois da linha 645 (onde já está o ragnabot-cluster):
#      app.use('/api/ragnabot', authMiddleware, adminOnly, (await import('./routes/ragnabot-tenant.routes.js')).default);
#      app.use('/api/ragnabot-cobranca', authMiddleware, (await import('./routes/ragnabot-cobranca.routes.js')).default);
#  (c) junto dos demais webhooks, DEPOIS da linha 362:
#      app.use('/api/webhooks/ragnabot-cobranca', (await import('./routes/ragnabot-cobranca.routes.js')).webhookRouter);
node --check src/server.js
grep -n ragnabot src/server.js      # esperado: 4 linhas agora

# ─── 3) .ENV — o que já se pode preencher ────────────────────────────────
#      RAGNABOT_PROXY_IP=172.20.11.2
#      RAGNABOT_COBRANCA_APLICAR=0
#      RAGNABOT_COBRANCA_WEBHOOK_SEGREDO=<hex-24 da Onda 0>
ls -l .env                          # continua 640 claude:postgres

# ─── 4) VERSÃO + MANUAL (lei da casa, antes do backup) ───────────────────
#      package.json  →  1.330.0
#      frontend/src/lib/versions-content.js  →  changelog cobrindo AS TRÊS frentes

# ─── 5) BUILD DO FRONT — isto JÁ É o deploy do front (dist é servido do disco)
cd /ia/netagent/frontend && npm run build && cd /ia/netagent

# ─── 6) A CHECAGEM QUE NÃO SE ENCADEIA ───────────────────────────────────
curl -s localhost:3000/api/health/active-sessions
#    ⛔ LEIA A SAÍDA. Só siga com "safeToRestart": true.
#    ⛔ JAMAIS escreva `curl ... && pm2 restart` — o && testa se o curl RODOU,
#       não se a resposta AUTORIZA. Isso já derrubou a sessão RDP de um cliente real.

# ─── 7) RESTART — comando SEPARADO, depois de ler ────────────────────────
sudo -n pm2 restart noc-agent
sudo -n pm2 logs noc-agent --lines 40 --nostream

# ─── 8) FUMAÇA ───────────────────────────────────────────────────────────
curl -s -H "Authorization: Bearer <token>" localhost:3000/api/ragnabot/saude | jq
curl -s -H "Authorization: Bearer <token>" localhost:3000/api/ragnabot-cobranca/situacao | jq
curl -s -i localhost:3000/api/webhooks/ragnabot-cobranca/x | head -1

# ─── 9) BACKUPS IMEDIATOS (política F70.11) ──────────────────────────────
curl -s -X POST -H "Authorization: Bearer <token>" 'localhost:3000/api/backup/manual-full?destination=s3'
curl -s -X POST -H "Authorization: Bearer <token>" localhost:3000/api/backup/run-job/code

# ─── 10) REGISTRO ────────────────────────────────────────────────────────
#   · /ia/.claude/noc-actions-log.md          (fonte canônica)
#   · /ia/.claude/ragnabot-actions-log.md     (histórico da plataforma)
#   · commit RICO em ragnatelaiot/ragnabot — o quê, o porquê, arquivos, validação.
#     ⛔ Zero segredo no commit. Confira `git diff --cached` antes.
```

**Rollback do lote:** `git checkout -- src/server.js` (desmonta as rotas) + `npm run build` de
novo + restart. As **tabelas novas podem ficar** — são aditivas e ninguém as lê se as rotas não
estiverem montadas. `prisma/schema.prisma.bak-pre-ragnabot-saas` reverte o schema em uma linha.

> 🧹 **Faxina antes do commit:** há **9 arquivos `tmp-*.mjs`** soltos em `/ia/netagent`
> (`tmp-chat-exec.mjs`, `tmp-iis.mjs`, `tmp-marca.mjs`, `tmp-puma.mjs`, `tmp-ra.mjs`, `tmp-ra2.mjs`,
> `tmp-ra3.mjs`, `tmp-rp.mjs`, `tmp-slow.mjs`). Não são destas frentes, mas vão junto num
> `git add .` distraído. Apague ou ignore explicitamente.

---

## §4 — O QUE DEPENDE DO DONO (ordenado pelo que mais destrava)

| # | O que | Quem faz | Destrava | Bloqueia |
|---|---|---|---|---|
| **D-1** | **Token do Platform App.** Criar em `/super_admin` → *Platform Apps* → app `noc-ragnatela`, e entregar o token. **Só o dono consegue.** | Dono | Toda a F-SAAS: provisionar empresa, suspender, reativar, encerrar | Prova de isolamento, empresa piloto, **todo o SaaS** |
| **D-2** | **Senha da caixa `noreply@ragnatela.com.br`.** Está na tela Configurações → SMTP do NOC; precisa ser **digitada na hora** por quem tem acesso. Não foi transportada para arquivo nenhum, de propósito. | Dono/NOC | Correio de saída do Ragnabot | Convite de agente, "esqueci minha senha", relatório agendado |
| **D-3** | **Preço de cada plano.** Os modelos nascem com `precoCentavos = null` e o sistema **recusa emitir cobrança sem preço** — de propósito, para não chutar valor. | Dono | Emissão de cobrança | Todo o faturamento |
| **D-4** | **Chave Pix da Ragnatela** (`RAGNABOT_PIX_CHAVE`). **Só isso já destrava o faturamento pelo adaptador manual**, sem depender da Efí. | Dono | Cobrar sem integração | Faturamento do piloto |
| **D-5** | **Janela do chat002** para o rollout dos dois Deployments (derruba as conversas abertas por alguns segundos). | Dono | Onda 2 inteira | SMTP e 2FA |
| **D-6** | **Quem é o gestor e quem é o SEGUNDO super administrador.** A redundância certa são **duas pessoas com poder, cada uma com o seu fator** — não uma chave copiada entre elas. | Dono | Governança do 2FA | Ativação segura do 2FA |
| **D-7** | **Decisão sobre 2FA por e-mail.** Ele **não existe** no Chatwoot 4.17.1. Recomendado: **TOTP por aplicativo + 10 códigos de recuperação** (cobre o "perdi o celular" e é mais forte que código por e-mail, que pode ser interceptado). A alternativa exige virar mantenedor de uma imagem própria, com rebase a cada atualização. | Dono | Onda 2 | Desenho final do 2FA |
| **D-8** | **Revisão jurídica:** Termos de Uso, DPA e Política de Privacidade. Somos **operadores de dado de terceiro**. | Dono/jurídico | — | ⛔ **O PRIMEIRO CLIENTE REAL** |
| **D-9** | **Credenciais Efí:** conta aprovada, aplicação criada, `Client_Id`/`Client_Secret` de **homologação** e de **produção**, e o `.p12` se formos usar a API Pix. | Dono | Cobrança automática | Baixa automática |
| **D-10** | **Carência e corte** (sugerido: 5 e 10 dias) e **dia de vencimento padrão** (sugerido: 10). | Dono | Ciclo automático | Suspensão por inadimplência |
| **D-11** | **Autorização expressa** para `RAGNABOT_COBRANCA_APLICAR=1` e para ligar o worker. | Dono | Suspensão automática de conta | Degrau 4 de §2.4 |
| **D-12** | **Meta/WhatsApp:** verificar o número por ligação de voz e registrar na Cloud API. | Dono | WhatsApp, modelos de mensagem, campanhas pontuais | Metade do capítulo 15 do manual |
| **D-13** | **Aceite formal** de que **grupo de WhatsApp deixa de existir** na API oficial. | Dono | Expectativa correta no piloto | Frustração no primeiro dia |
| **D-14** | **Revisão dos capítulos 2 e 15 do manual.** | Dono | Publicação do manual | Central de Ajuda |
| **D-15** | Usuário de banco para `RAGNABOT_DB_URL` (só no caminho direto, para contas sem tenant). | Dono/NOC | Caso de borda da cobrança | — |

**A leitura curta:** **D-1 e D-2** destravam quase tudo — são duas ações de minutos. **D-8** é a
única que trava o cliente real por fora da tecnologia.

---

## §5 — Riscos de gravidade alta que sobraram

Os defeitos que a revisão encontrou **já foram corrigidos no código** (28 achados, 22 corrigidos).
O que segue é o que **não é corrigível escrevendo código** — mora na operação, na infraestrutura ou
na decisão.

| # | Risco | Por que é grave | Mitigação |
|---|---|---|---|
| **R-1** | **Perder as chaves `ACTIVE_RECORD_ENCRYPTION_*`** | Depois que a primeira pessoa ativar o 2FA, é **irreversível**: `otp_secret` e `otp_backup_codes` viram ilegíveis **para todo mundo**, e **restaurar o banco não resolve** — o dado está cifrado com elas. | Gerar e guardar em `/root/.chat002-credenciais` (chmod 600) **antes** de aplicar. Conferir que estão no cofre **antes** de o primeiro usuário ativar o 2FA. Nunca no git. |
| **R-2** | **`kubectl apply` do ConfigMap apaga chave** | O `apply` **substitui o bloco `data` inteiro**. Um arquivo com 17 chaves aplicado sobre um mapa de **19** apagaria `ENABLE_RACK_ATTACK` e `RACK_ATTACK_LIMIT` — o Ragnabot subiria **sem o freio de força bruta** no login. Isso *era* um defeito real do artefato; foi corrigido, mas a armadilha continua existindo para qualquer edição futura. | O `diff` de listas de chaves em §2.2, passo 3. Qualquer linha com `<` = pare e restaure. |
| **R-3** | **Anexos num disco local de um nó só** (PVC RWO, item 2.5) | **Anula a alta disponibilidade** e, pior: perder aquele nó = **perder a mídia de todas as empresas**. Não há cópia. | ⛔ Bloqueador de cliente real. Resolver o item 2.5 (armazenamento compartilhado) antes de entrar dado de terceiro. |
| **R-4** | **Sem backup dos bancos do chat002** (itens 2.1/2.2, adiados para pós-piloto) | Replicação **não é backup**: não protege contra apagamento acidental nem contra corrupção lógica, que se replicam junto. | ⛔ Bloqueador de cliente real. O manual já foi corrigido para **não prometer** o que não existe. |
| **R-5** | **Prova de isolamento nunca executada** (item 3.5) | O motivo de todo este projeto é que o sistema antigo **vazava ticket entre empresas**. Enquanto a prova não roda verde, "isolamento absoluto" é intenção, não fato. | Depende de **D-1**. Assim que o token chegar: §2.3, degrau 2. **Sem verde, nenhuma empresa real.** |
| **R-6** | **Sem monitoramento nas VMs de banco** | Replicação quebrada é **invisível hoje**. E a medição de consumo lê da réplica — leria número velho sem avisar. | Cadastrar 172.17.20.132/.133 no Zabbix. O painel de §2.1 ajuda, mas mostra **o instante**, não histórico. |
| **R-7** | **`pm2 restart` derruba sessões RDP/console** | Já aconteceu com cliente real conectado. E já aconteceu de alguém encadear `curl … && pm2 restart`, que **reinicia mesmo com `safeToRestart:false`** — o `&&` testa se o curl **rodou**, não se a resposta **autoriza**. | §3, passos 6 e 7: comandos **separados**, com leitura humana no meio. |
| **R-8** | **Segredo do webhook viaja na URL** | Cai em texto claro no `access_log` do nginx do proxy reverso. | A API de Cobranças da Efí não aceita header próprio — a URL é o único canal. Compensar com `access_log off` (ou máscara) nesse caminho do vhost, e **rotacionar o segredo** se um dump de log for compartilhado. |
| **R-9** | **Primeiro Pix real não dá baixa sozinho** | O `txid` não é gravado na coluna que a busca usa; o evento vira `ignorado`. É honesto (não inventa baixa), mas surpreende. | Se o piloto começar por Pix: baixa manual via `POST /pagamentos/:id/baixa-manual` até a API Pix da Efí ser implementada (exige o `.p12` de **D-9**). |
| **R-10** | **Empresa encerrada não é reaberta em silêncio** — mas fica *pendente* | Um pagamento atrasado de contrato `closed` **não** reabre o contrato (corrigido). Ele vira **pendência**, e pendência que ninguém olha é pendência que não existe. | Olhar `contasPendentesDeAplicacao` em `GET /situacao` na rotina. Reabrir contrato é **ato deliberado** no cadastro. |
| **R-11** | **Mapa VM→hipervisor fixo** nas ferramentas | Se a VM 10601 ou 10603 **migrar de nó** no cluster Proxmox, o `qm guest exec` falha com "no such VM" e **todos** os comandos morrem sem explicar a causa. | Sintoma conhecido, documentado no topo de `tools/ragnabot-usuarios.mjs`. Conserto: corrigir a constante, ou adotar `resolveVmNode` (`client-access.service.js`), que já resolve o nó ao vivo. |
| **R-12** | **3 testes falhando** em `tests/unit/artigo-blog.test.js` | **Alheio a estas cinco frentes** (frente de marketing; `src/utils/artigo-blog.js` mexido em 27/08). Confirmado ainda falhando hoje. Se houver gate de teste no build, **trava o lote de §3**. | Avisar a frente de marketing **antes** de abrir a janela. Não corrigir por conta própria: mexer em teste alheio troca um erro por outro. |
| **R-13** | **Sem servidor de e-mail, o link SSO é a única porta** | Até a Onda 2 subir, provisionar uma empresa e perder o link de primeiro acesso = **empresa em que ninguém entra**. | O provisionamento agora **avisa em primeiro lugar** quando o link falha. Regenerar por `POST /tenants/:id/sso` (só superusuário). Melhor: fazer a **Onda 2 antes** da primeira empresa. |

---

## §6 — Resumo, em linguagem de dono

**O que passou a existir, em cinco frases:**

1. **Uma tela no NOC** que mostra a saúde do Ragnatela de atendimento — quem é o banco principal
   agora, se os três servidores estão de pé, quanto disco resta. E ela foi feita para **não mentir**:
   quando nenhum servidor responde, ela escreve *"sem leitura"* em vermelho, em vez de mostrar um
   tranquilizador **0% em verde** — que era exatamente o que ela fazia antes da revisão.

2. **O correio da plataforma**, pronto para ser ligado: hoje o Ragnabot **não manda e-mail nenhum**,
   o que significa que convidar um atendente ou recuperar uma senha simplesmente não funciona. Junto
   vai o **segundo fator de segurança** (aquele código que muda a cada 30 segundos no celular) e os
   e-mails **traduzidos para o português** — que ainda vinham metade em inglês.

3. **A máquina de criar empresa cliente:** cadastrar a empresa, dar-lhe as conexões de WhatsApp e
   chat, suspender quem não paga, encerrar quem sai. E, principalmente, **uma prova automática** de
   que uma empresa não enxerga a conversa da outra — que é o defeito que nos fez trocar de sistema.
   Essa prova ainda **não rodou**, e é ela que autoriza o primeiro cliente real.

4. **O faturamento:** planos, assinatura mensal, cobrança gerada sozinha, baixa quando o cliente
   paga, corte depois da carência. Está montado com o **freio de mão puxado** de propósito: roda
   primeiro só observando e anotando, e só passa a agir de verdade com autorização sua.

5. **O manual do usuário**, menu a menu, com um capítulo que diz **sem maquiagem o que ainda não
   existe** — porque prometer no manual o que o produto não faz é a maneira mais rápida de perder
   a confiança do cliente no primeiro dia.

**O que falta para virar produto vendável, na sua mão:**
duas ações de minutos (**criar o token de plataforma** e **entregar a senha da caixa de e-mail**),
três decisões comerciais (**preço**, **chave Pix**, **carência**) e uma que não é técnica e trava
tudo: **a revisão jurídica dos termos e da política de privacidade** — porque, a partir do primeiro
cliente, passamos a guardar dado de gente que não é nossa.

**O que ainda não está pronto e não depende de você:** os anexos das conversas moram no disco de um
servidor só, e não há backup dos bancos. Perder aquele servidor hoje é perder a mídia de todas as
empresas. Isso precisa ser resolvido **antes** de entrar cliente de verdade — não depois.

---

## §7 — Encerramento da aplicação

Ao terminar cada onda, na ordem:

1. **Registrar** em `/ia/.claude/noc-actions-log.md` (fonte canônica) e em
   `/ia/.claude/ragnabot-actions-log.md`.
2. **Atualizar** `/ia/.claude/modulo-atendimento/10-ETAPAS-RAGNABOT.md` — os itens 3.1 (SMTP),
   3.4 (piloto) e 3.5 (isolamento) mudam de estado. *(De passagem: o item 2.4 — pin da imagem por
   digest — ainda consta ⬜, mas o item 8.4 e o ACTIONLOG registram a imagem já fixada. Um dos dois
   está errado; acertar com quem aplicou o digest.)*
3. **Bump de versão + manual** antes do backup (lei da casa).
4. **Backups imediatos** `manual-full` + `run-job/code` (política F70.11).
5. **Commit rico** no `ragnatelaiot/ragnabot` — o quê, o porquê, os arquivos, a validação.
   ⛔ Zero segredo. Confira `git diff --cached` antes de empurrar.

---

*Escrito em 28/08/2026. Estado de §0 medido nesta máquina, não suposto.
Nenhuma das cinco frentes aplicou nada em produção — todas produziram artefato. Quem aplica é o NOC.*
