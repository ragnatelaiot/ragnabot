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
