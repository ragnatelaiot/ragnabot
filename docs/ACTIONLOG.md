# 📜 ACTIONLOG — Construção do Ragnabot
> LOG CANÔNICO local da construção (regra do dono, 27/08). Espelho versionado no repo:
> `ragnatelaiot/ragnabot` → docs/ACTIONLOG.md. Sem segredos, por lei.

## 2026-08-27 — Do zero ao FUNCIONAL em um dia

### Aprovações do dono
- Plano de 10 fases aprovado (doc `07-PLANO-PLATAFORMA-ATENDIMENTO.md` na infra do NOC).
- **Base:** Chatwoot open-source (API oficial Meta + omnichannel + multi-tenant nativos).
- **Registry:** GHCR privado (org ragnatelaiot). **Repo:** `ragnatelaiot/ragnabot` (deploy key com escrita).
- Regras reforçadas: credencial JAMAIS no git · responsividade obrigatória · documentação viva.

### Infraestrutura pré-existente usada
Cluster Kubernetes v1.31.14 com 3 nós (2 no datacenter FLZ + 1 no XSE via túnel), etcd quórum 3,
Calico VXLAN mtu 1300 — construído no mesmo dia (diário 06 na infra do NOC).

### Fase 1 — Fundação de dados ✅
- PostgreSQL 18.6 primário (10603/.132) → standby (10604/.133), streaming replication com slot,
  lag medido 4,5 ms. pgvector. Redis primário/réplica com senha.
- 🔴 **Buraco negro de MTU** (hipótese do dono, confirmada): placas 9100 × caminho 9000 —
  ping passava, TCP grande morria. Fix: MTU 9000. Vazão: 60 KB/s → **1,04 GB/s**.
- Firewall CHRs: pods → PG/Redis (`5432,6379`) liberado e provado.

### Fase 2 — Encanamento ✅
- ingress-nginx (3 réplicas, NodePort fixo 30080/30443), taint de control-plane removido
  (cluster todo é control-plane). local-path como StorageClass padrão.
- Firewall: proxy reverso → nós :30080/:30443 (2 CHRs + RB5009 para o nó do XSE).
- Vhost `chat002` no proxy + cert Let's Encrypt (linhagem `-0001`) + WebSocket.
- 🔴 **server_name duplicado:** `chat002` estava também no vhost "estacionamento"
  (`redirecionamento`) — com nome exato duplicado vence quem carrega primeiro; o desafio ACME
  caía num 301 errado. Removido de lá. ⚠️ No meio, um backup criado DENTRO de `sites-enabled`
  quebrou o `nginx -t` (armadilha conhecida da casa) — detectado e movido antes de qualquer dano.

### Fase 3 — Aplicação no ar ✅
- Namespace `ragnabot`: Secret (aplicado direto, valores fora do git), ConfigMap PT-BR,
  PVC 20Gi, Job de migração, Deployments web+worker (mesmo nó por causa do PVC RWO — HA de app
  virá com S3), Service, Ingress.
- Migração: 1ª falhou (`Must be superuser to create extension`) → papel `chatwoot` virou
  SUPERUSER (cluster de banco DEDICADO à plataforma; decisão registrada).
- Conta 1 criada: "Ragnatela IoT Solutions", admin SuperAdmin (senha inicial no cofre local
  das VMs de banco). Signup público FECHADO. Flag de onboarding removida (vive no Redis:
  `Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING`).
- **Prova final: `https://chat002.ragnatela.com.br` → HTTP 200** com cert válido, pelos 3 nós.

### Design (aguardando aplicação)
Proposta do agente de marketing APROVADA pelo NOC (delegação do dono): `design/login.html`,
`design/app-mockup.html`, `design/identidade.md` — noite de vidro no login, tema claro no
trabalho, contrastes WCAG medidos, responsivo validado em 8 combinações com navegador real.

### Meta / WhatsApp Cloud API (caminho crítico externo)
BM verificado ✅ · WABA ativa ✅ · número +55 98 3197-0997 adicionado, mas `DISCONNECTED/
NOT_VERIFIED/ON_PREMISE`. Faltam (dono): verificar por ligação de voz, registrar na Cloud API,
submeter display name. Depois (NOC): webhook `chat002.../webhooks` + templates (Fase 4).

### Pendências
- [ ] Backup WORM dos bancos (S3 Object Lock) + Zabbix das VMs 10603/10604 + ensaio de promoção
- [ ] Tema Ragnabot aplicado sobre o Chatwoot (a partir de `design/`)
- [ ] Menu "Atendimento" no NOC (Fase 6) — aguarda janela de deploy do NOC (política de sessão ativa)
- [ ] Pin da imagem por digest (hoje `chatwoot:latest`) + storage S3 para HA de aplicação
- [ ] Fases 4-5 (WhatsApp oficial, omnichannel), 7 (SaaS), 8 (produção), 9 (piloto)

## Requisito herdado do sistema antigo (a corrigir por construção)
No Whaticket da VM 10016, ticket de **grupo** é visível a todo admin (fora do filtro de dono, por
desenho do fornecedor) e super-admin vê todas as empresas. **No Ragnabot/Chatwoot**: a visibilidade
por conversa deve respeitar atribuição (dono/time) e o isolamento entre contas (tenants) deve ser
absoluto — validar na Fase 3/7 que um agente só vê o que lhe cabe, inclusive conversas de grupo.

## 2026-08-27 (noite) — Marca Ragnabot + correcao da lentidao do login
- **Marca:** InstallationConfig (INSTALLATION_NAME/BRAND_NAME=Ragnabot, URLs=ragnatela) + logo SVG
  (3 variantes) persistidos via ConfigMap `ragnabot-branding` (subPath em public/brand-assets).
  Cor primaria + login "noite de vidro" exatos = imagem custom no GHCR (aguarda token write:packages do dono).
- **Lentidao (corrigida):** puma 2 workers/5 threads + 2 replicas web; cache imutavel no navegador para
  assets Vite; proxy_cache+gzip no proxy (MISS 7s uma vez -> HIT 0,008s). Login repetido agora instantaneo.

## 2026-08-27 (noite, cont.) — tema v1 no ar, reprovado; frontend v2 com o agente
- **Tema v1 aplicado e NO AR** (CSS injetado pelo proxy via sub_filter, fora da imagem):
  azul #2781f6 do Chatwoot → verde Ragnatela em todas as classes `.{bg,text,border,ring,outline}-n-brand`;
  login com gradiente/teia/aurora/cartão de vidro por `body:has(input[type=password])`; favicon e
  theme-color trocados. Reversível removendo o sub_filter do vhost.
- ❌ **Dono REPROVOU** o resultado ("péssima, totalmente amadora"): ficou formulário centralizado
  genérico. Referência dele = a tela de login do **painel do cliente** (duas colunas, imagem real de
  datacenter, copy comercial, cartão de vidro com campos ícone-dentro). Frontend COMPLETO delegado ao
  agente site-ragnatela (login + dashboard de indicadores + tela de conversas + tema.css + guia).
- ⏸️ **Decisão do dono:** questões de **banco/backup/DR ficam para depois do piloto**. Nesta etapa
  ficou feito o agente Zabbix nas VMs 10603/10604 + UserParameters de replicação (todos provados
  lendo valor real: standbys=1, lag=0, slots_inativos=0, redis=1). Registrar hosts no servidor: adiado.

## 2026-08-28 (madrugada) — Cluster RAGNABOT no NOC + digest + estrutura documentada
- **Cluster criado** (ordem do dono): 5 servidores no grupo RAGNATELA com marcação
  `[CLUSTER RAGNABOT]` — RGTK8S001/002/003 (nós k8s, o 3º no site XSE) e RGTPSTGSQL001/002.
- **Serviço + rota** de saúde ao vivo (somente leitura): nós/etcd/pods/versão fixada · bancos com
  **identificação automática do primário** (`pg_is_in_recovery`), réplica em dia, vagas inativas,
  tamanho · espaço em disco · papel do Redis · lista de alertas. `GET /api/ragnabot-cluster/health`.
- ⚠️ **Falso positivo real corrigido no 1º teste:** atraso da réplica media *tempo desde a última
  transação* → num banco ocioso acusava 21.934s (6h) com replicação perfeita (primário reportava
  lag=0 e réplica conectada). Passou a medir **por LSN**: recebido == aplicado ⇒ em dia.
- **Imagem fixada por digest** `chatwoot@sha256:18f280a6…` (era `:latest`) nos dois Deployments +
  manifesto; rollout limpo. Alerta do painel para o caso de desfixar.
- **`11-ESTRUTURA-RAGNABOT.md`**: documentação da estrutura (k8s, bancos, mídias, HA, eleição de
  primário — manual e por quê, atualização, espaço).
- Pendente: **página visual** do cluster no NOC (exige build+deploy → janela sem sessão ativa).

## 2026-08-28 (madrugada, cont.) — Frontend v2 no ar + descrição em PT-BR
- **Tema v2 APLICADO** (substituiu o v1 reprovado). Entrega do agente site-ragnatela, revisada e
  aprovada pelo NOC: autocontida (zero dependência externa), sem segredos, imagem em data URI.
- ⚠️ **Erro meu que o agente pegou e corrigiu:** a paleta do tema v1 (`#055508`/`#2CC54E`/`#04150B`)
  **não era a paleta do produto**. A aprovada pelo dono em 23/08 é a do painel do cliente:
  fundo `#03151f`, ação `#2ee879` (`96-IDENTIDADE-PAINEL-CLIENTE` §2). Por isso, lado a lado com o
  painel, "lia-se como outra empresa" — exatamente a queixa do dono. O v2 herda a paleta aprovada.
- Diferença técnica que importa: o v1 brigava classe a classe com `!important`; o v2 **redefine as
  variáveis de cor do próprio Chatwoot** (`--slate-1..12`), o que reveste o aplicativo inteiro —
  inclusive telas ainda não abertas.
- Também corrigido: `branco sobre o verde dá 1,62:1` — a regra do `.bg-n-brand` agora força a cor
  do texto junto, senão o botão ficaria ilegível em todo o produto.
- **Descrição do sistema traduzida** para PT-BR (estava em inglês, falando de "Chatwoot"):
  `INSTALLATION_DESCRIPTION` agora descreve o Ragnabot e os canais.
- Limite declarado pelo agente: só a tela de ENTRADA foi vista no produto real; as telas internas
  foram tratadas pela via das variáveis (ampla, mas não é o mesmo que ter olhado). Pendente: alguém
  com acesso percorrer caixa, contatos, relatórios e ajustes com o tema aplicado.
