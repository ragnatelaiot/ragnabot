<div align="center">

# 🕸️ Ragnabot

**Plataforma de Atendimento Omnichannel — Ragnatela IoT Solutions**

*Toda conversa, de qualquer canal, cai na mesma teia.*

[![Produção](https://img.shields.io/badge/produção-chat002.ragnatela.com.br-055508)](https://chat002.ragnatela.com.br)
![Base](https://img.shields.io/badge/base-Chatwoot%20(open--source)-449344)
![Infra](https://img.shields.io/badge/infra-Kubernetes%203%20nós%20HA-2CC54E)

</div>

---

## 📌 O que é

O Ragnabot é a plataforma de atendimento **multi-tenant (SaaS)** da Ragnatela. Atendentes
organizados em **times e filas** respondem clientes que chegam por **qualquer canal**, numa
única caixa de entrada, com histórico unificado por contato.

| | |
|---|---|
| **Endereço** | https://chat002.ragnatela.com.br |
| **Base** | [Chatwoot](https://www.chatwoot.com/) open-source, com identidade visual Ragnabot |
| **WhatsApp** | **API oficial da Meta (Cloud API)** — nada de gambiarras não-oficiais |
| **Acoplamento** | menu "Atendimento" no NOC Ragnatela (SSO) |

## ✨ Funcionalidades

### Canais (omnichannel)
- 💬 **WhatsApp** via Cloud API oficial (templates, mídia, janela de 24 h)
- 📸 **Instagram Direct** · 💙 **Messenger** · ✈️ **Telegram**
- 📧 **E-mail** como canal de ticket
- 🌐 **Webchat** (widget para embutir em sites)

### Atendimento
- Caixa de entrada unificada com selo do canal em cada conversa
- **Times/filas** (setores), transferência entre atendentes, participantes
- **Notas internas** (invisíveis ao cliente), respostas rápidas, etiquetas
- Contatos unificados: o mesmo cliente por 3 canais = 1 histórico
- Relatórios: volume, tempo de resposta, CSAT, por agente/time/canal

### SaaS
- **Multi-tenant nativo**: cada empresa cliente é uma conta isolada
- Cadastro público **fechado** — tenants são provisionados pelo NOC
- Modelo "traga sua WABA": cada cliente conecta o próprio número oficial

## 🏛️ Arquitetura

```
                       INTERNET
                          │ https (TLS Let's Encrypt)
        ┌─────────────────▼─────────────────┐
        │  Proxy reverso nginx (multi-site) │  vhost chat002 → deploy/nginx/
        └─────────────────┬─────────────────┘
                          │ upstream: 3 nós, failover automático
        ┌─────────────────▼─────────────────────────────┐
        │  KUBERNETES — 3 nós control-plane (HA real)   │
        │  2 nós no datacenter FLZ + 1 nó em site remoto│
        │  ingress-nginx :30080 → web (Rails) + worker  │
        │  (Sidekiq) · Calico VXLAN · etcd quórum de 3  │
        └───────┬───────────────────────────────────────┘
                │ VLAN dedicada de dados
   ┌────────────▼────────────┐      ┌─────────────────────────┐
   │ PostgreSQL 18 PRIMÁRIO  │─────▶│ PostgreSQL 18 STANDBY   │
   │ + Redis    (VM 10603)   │ 4,5ms│ + Redis réplica (10604) │
   └─────────────────────────┘      └─────────────────────────┘
```

**Por que o banco fora do cluster?** Dado de cliente pagante vive em VM dedicada com replicação
por streaming e backup imutável — o padrão de produção da casa. O Kubernetes fica *stateless*:
qualquer nó pode morrer sem perder um byte de conversa.

## 🚀 Instalação (por subitem)

> Pré-requisitos: cluster Kubernetes ≥ 1.31 com ingress-nginx e StorageClass; PostgreSQL ≥ 16
> com `pgvector`; Redis; um proxy reverso com TLS. Os passos abaixo reproduzem o ambiente real.

### 1. Fundação de dados (PostgreSQL + Redis replicados)
Siga **[`deploy/postgres/README.md`](deploy/postgres/README.md)** — inclui o passo a passo do
primário, do standby (`pg_basebackup -c fast`), do Redis com réplica, e a armadilha de MTU que
custou uma tarde (documentada para não se repetir).

### 2. Encanamento do cluster
```bash
# ingress-nginx (NodePort fixo 30080/30443) e StorageClass local-path
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.0/deploy/static/provider/baremetal/deploy.yaml
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.30/deploy/local-path-storage.yaml
kubectl patch storageclass local-path -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

### 3. Proxy reverso + certificado
Instale **[`deploy/nginx/chat002-upstream.conf`](deploy/nginx/chat002-upstream.conf)** em
`conf.d/` e **[`deploy/nginx/chat002-vhost.conf`](deploy/nginx/chat002-vhost.conf)** em
`sites-available/` (symlink com prefixo `zzz-` para não sequestrar o catch-all da 443).
Certificado: `certbot certonly --webroot -w /var/www/html -d <domínio>`.
⚠️ Confira se o domínio não aparece em NENHUM outro vhost — `server_name` exato duplicado
entrega a requisição a quem carrega primeiro.

### 4. A aplicação
```bash
# 1. Edite deploy/k8s/ragnabot.yaml e preencha os <PLACEHOLDER> do Secret
#    (SECRET_KEY_BASE: openssl rand -hex 64 · senhas do PG/Redis)
kubectl apply -f deploy/k8s/ragnabot.yaml
# 2. Aguarde a migração
kubectl -n ragnabot wait --for=condition=complete job/ragnabot-migracao --timeout=900s
# 3. Acompanhe
kubectl -n ragnabot get pods -w
```

### 5. Primeira conta (o cadastro público nasce fechado)
```bash
POD=$(kubectl -n ragnabot get pods -l app=ragnabot-web -o name | head -1)
kubectl -n ragnabot exec -it $POD -- bundle exec rails c
# > u = User.new(name:'Admin', email:'...', password:'...', password_confirmation:'...', type:'SuperAdmin')
# > u.skip_confirmation!; u.save!
# > acc = Account.create!(name:'Minha Empresa', locale:'pt_BR')
# > AccountUser.create!(account_id: acc.id, user_id: u.id, role: :administrator)
# > ::Redis::Alfred.delete(::Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
```

### 6. Atualização de versão
```bash
kubectl -n ragnabot delete job ragnabot-migracao
kubectl apply -f deploy/k8s/ragnabot.yaml           # re-cria o job com a imagem nova
kubectl -n ragnabot wait --for=condition=complete job/ragnabot-migracao --timeout=900s
kubectl -n ragnabot rollout restart deploy/ragnabot-web deploy/ragnabot-worker
```

## 🎨 Identidade visual
A proposta aprovada vive em **[`design/`](design/)** — [`login.html`](design/login.html)
(autenticação "noite de vidro"), [`app-mockup.html`](design/app-mockup.html) (telas de uso) e
[`identidade.md`](design/identidade.md) (paleta com contrastes WCAG **medidos**, tipografia,
estados e o mapa de aplicação sobre o Chatwoot). Responsividade validada em 360/390/768/1440.

## 📜 Histórico e operação
- **[`docs/ACTIONLOG.md`](docs/ACTIONLOG.md)** — registro cronológico da construção, com os
  problemas reais e como foram resolvidos (MTU, server_name duplicado, checkpoint do basebackup…)
- Diários completos de execução: infra do NOC (documentos 06/07/08 do módulo de atendimento)

## 🔐 Segurança (leis da casa)
- ⛔ **Nenhuma credencial válida neste repositório. JAMAIS.** Secrets aplicados direto no
  cluster; valores reais só no cofre local das VMs de banco.
- TLS terminado no proxy; origem HTTP apenas em VLANs internas isoladas por firewall.
- Cadastro público desabilitado; tenants criados apenas pela operação.

## Versão, novidades e manual
- **`VERSAO`** — a versão vigente do produto (começa em `1.00.00`).
- **`docs/VERSOES.md`** — o que cada versão entregou (cresce a cada release).
- **`docs/MANUAL.md`** — manual vivo: como cada função funciona.
- **`docs/32-PLANO-DE-EXECUCAO.md`** — a fila de construção, medida do chat atual.
