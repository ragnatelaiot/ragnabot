# 22 — Auditoria de Segurança do Ragnabot (Chatwoot 4.17.1)
Data: 2026-08-28 · Escopo: aplicação `https://chat002.ragnatela.com.br` + infraestrutura (Kubernetes 3 nós, proxy nginx XSEPRXRVS001, PostgreSQL/Redis, plano de controle). Sistema 100% nosso, autorização total de teste. Toda credencial usada só em memória; nenhum segredo neste laudo (apenas nomes de chaves).

> **Método:** acesso pelo padrão da casa (SSH pool no hypervisor → `qm guest exec` nos guests, `kubectl` no nó 10601, SSH direto no proxy; testes HTTP externos via `curl --resolve` a partir do próprio proxy por causa do hairpin NAT). Cada achado abaixo tem prova reproduzível (comando + saída resumida).

---

## 0. Placar

| Gravidade | Qtde | Itens |
|---|---|---|
| **Crítica** | 1 | Papel PostgreSQL `chatwoot` é SUPERUSER |
| **Alta** | 3 | Pods como root sem `securityContext`; ausência de NetworkPolicy (egresso irrestrito); Secrets do k8s sem cifragem em repouso no etcd |
| **Média** | 4 | Token da default ServiceAccount montado; Redis sem `rename-command`; NodePort sem firewall de host; redirect `http://` no `/super_admin` |
| **Baixa** | 2 | CSP ausente; OCSP stapling desabilitado |
| **Corrigido nesta auditoria** | 3 | Cookie de sessão sem `Secure`; HSTS ausente; Permissions-Policy ausente |
| **Positivos validados** | 8 | Isolamento multi-tenant íntegro; sem enumeração de usuário; freio de força-bruta ativo; TLS moderno; signup fechado; plano de controle endurecido; Redis/PG autenticados; RBAC do default SA vazio |

---

# PARTE A — Testes de ATAQUE (superfície externa e aplicação)

## A0. Correções JÁ APLICADAS (seguras e reversíveis) ✅

Aplicadas no vhost do proxy `XSEPRXRVS001:/etc/nginx/sites-available/chat002-ragnatela`. Backup em `/root/nginx-backups/chat002-ragnatela.bak-sec-<epoch>`. Validado com `nginx -t` + `systemctl reload nginx` (reload gracioso, zero-downtime; NÃO reinicia o serviço, não derruba conexão). App seguiu respondendo `200`.

**Rollback:** `cp /root/nginx-backups/chat002-ragnatela.bak-sec-<epoch> /etc/nginx/sites-available/chat002-ragnatela && nginx -t && systemctl reload nginx`.

### A0.1 — Cookie de sessão sem flag `Secure` (era MÉDIA) — CORRIGIDO
Antes, o `_chatwoot_session` vinha `path=/; httponly; samesite=lax` **sem `Secure`** — um cookie de sessão sem `Secure` pode vazar em qualquer trânsito HTTP (ex.: o bypass de NodePort da parte B).
- **Prova (antes):** `curl -sSI .../ | grep set-cookie` → `...; path=/; httponly; samesite=lax`
- **Correção:** `proxy_cookie_flags ~ secure;` nas `location /` e `location = /auth/sign_in`.
- **Prova (depois):** `...; path=/; httponly; samesite=lax; Secure` ✅

### A0.2 — HSTS ausente (era MÉDIA) — CORRIGIDO
Sem `Strict-Transport-Security` — cliente podia ser rebaixado para HTTP num primeiro acesso (SSL-strip).
- **Correção:** `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` no `server{}` 443 e replicado nas 2 `location` de assets (que têm `add_header` próprio e por isso não herdam). **Sem `preload`** de propósito (evita comprometer o apex/outros subdomínios).
- **Prova (depois):** `strict-transport-security: max-age=31536000; includeSubDomains` em `/` e nos assets. ✅

### A0.3 — Permissions-Policy ausente (era BAIXA) — CORRIGIDO
- **Correção:** `add_header Permissions-Policy "geolocation=(), payment=(), usb=()" always;` (conservador — NÃO restringe microfone/câmera para não quebrar áudio/vídeo do Chatwoot).
- **Prova (depois):** `permissions-policy: geolocation=(), payment=(), usb=()` ✅

## A1. Cabeçalhos setados pela própria aplicação (POSITIVO)
O Rails (gem secure_headers) já entrega, em todas as respostas: `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff`, `x-download-options: noopen`, `x-permitted-cross-domain-policies: none`, `referrer-policy: strict-origin-when-cross-origin`, `x-xss-protection: 0`. Por isso NÃO duplicamos esses no proxy (evita cabeçalho duplo).

## A2. TLS (POSITIVO)
`openssl s_client` no proxy:
- TLSv1.0 e TLSv1.1 = recusados (`Cipher is (NONE)`).
- TLSv1.2 = `ECDHE-ECDSA-AES256-GCM-SHA384`; TLSv1.3 = `TLS_AES_256_GCM_SHA384`. Chave pública ECDSA 256-bit. `Verify return code: 0 (ok)`.
- **BAIXA — OCSP stapling desabilitado:** `-status` → `OCSP response: no response sent`. Proposta em C-B7.

## A3. Autenticação
- **Sem enumeração de usuário (POSITIVO).** `POST /auth/sign_in` com e-mails inexistentes → `401 {"errors":["Invalid login credentials. Please try again."]}` (idêntico para qualquer e-mail). `POST /auth/password` (reset) → `200` com mensagem genérica *"…será enviado …, caso ele exista em nosso sistema."*
- **Freio de força-bruta funciona (POSITIVO).** 15 POSTs rápidos ao `/auth/sign_in`: sequência `401 401 401 401 401 401 429 429 429 …` — a partir da 6ª tentativa/minuto retorna `429` (nginx `limit_req zone=ragnabot_login rate=10r/m burst=5`). Complementado no app pelo `ENABLE_RACK_ATTACK=true` (`RACK_ATTACK_LIMIT=3000`).
- **Fixação de sessão:** o Rails/Devise rotaciona o cookie no login; cookie de sessão é criptografado/assinado (formato `--HMAC`). Sem indício de fixação.

## A4. Isolamento multi-tenant — CRÍTICO, VALIDADO ÍNTEGRO (POSITIVO)
Teste real: criei 2 contas descartáveis (empresa A e B), 1 agente admin em cada e um contato "secreto" em B, via `rails runner` no pod. Com o token do agente A tentei ler recursos da conta B (IDOR trocando `account_id` na URL):

| Requisição (token do agente A → conta B) | Resultado |
|---|---|
| `GET /api/v1/accounts/<B>/contacts` | **HTTP 401** "Você não está autorizado a acessar esta conta" |
| `GET /api/v1/accounts/<B>/conversations` | **HTTP 401** (idem) |
| `GET /api/v1/accounts/<B>/contacts/<id>` | **HTTP 401** (idem) |
| `GET /api/v1/accounts/<B>/agents` | **HTTP 401** (idem) |
| `GET /api/v1/accounts/<A>/contacts` (própria — sanidade) | **HTTP 200** |
| `GET /api/v1/profile` | **200**, lista **apenas** `account_id` de A |

**Conclusão:** o vazamento entre empresas do sistema antigo **NÃO** existe no Chatwoot — o escopo por `account_id` é forçado no `current_account` e recusa acesso cruzado. As contas/usuários/contatos de teste foram **destruídos**; verificação final: `SECTEST-* = 0 contas, 0 usuários`.

## A5. Signup público
`ENABLE_ACCOUNT_SIGNUP=false` (ConfigMap). Rota de criação de conta fechada — confere com a diretiva.

## A6. Console super-admin
`GET /super_admin/` → `302` para `/super_admin/sign_in` (protegido por login de super admin).
- **MÉDIA — redirect em `http://`:** o `Location` do super_admin sai como `http://chat002…` (o app não força https na geração de URL nessa rota). Mitigado por HSTS (A0.2) + 301 do proxy, mas idealmente o app deveria gerar https. Proposta em C-B8.

## A7. SSRF / webhooks
O Chatwoot permite cadastrar URL de webhook/integração. O metadado de nuvem `169.254.169.254` **não** existe nesta topologia (Proxmox, não cloud) — teste do pod: `closed`. **Porém** o pod tem egresso irrestrito (ver B2): um webhook apontado para a rede interna (`172.17.20.0/24`, PG, Redis, outros nós) ou para a internet é alcançável. O controle definitivo é a NetworkPolicy de egresso (B2), ausente hoje. **Prova do alcance** na parte B.

---

# PARTE B — ISOLAMENTO e CONTENÇÃO

## B1. Pods rodam como root, sem `securityContext` — ALTA
`kubectl exec` no pod web:
```
uid=0(root) gid=0(root) groups=0(root),1(bin),...
CapEff: 00000000a80425fb   (cap set padrão do Docker: NET_RAW, CHOWN, DAC_OVERRIDE, SETUID, SETGID, NET_BIND_SERVICE, KILL...)
touch / → ROOTFS_WRITABLE
```
`securityContext` dos containers e do pod = `{}` (vazio) nos dois Deployments (web e worker). Sem `runAsNonRoot`, sem `drop ALL`, sem `readOnlyRootFilesystem`, sem `allowPrivilegeEscalation:false`, sem `seccompProfile`.
- **Impacto:** um RCE dentro do container começa como root com cap set amplo (NET_RAW = sniffing/spoofing na rede do pod), rootfs gravável (persistência), e nenhuma barreira seccomp — facilita escalar para o nó.
- **Correção:** proposta C-B1 (`securityContext` endurecido). **Requer teste + rollout** (a imagem oficial do Chatwoot historicamente roda como root e grava em `/app/tmp`) → janela.

## B2. Ausência de NetworkPolicy — egresso do pod IRRESTRITO — ALTA
`kubectl get networkpolicy -A` → só existe uma em `calico-apiserver`; **nada** no namespace `ragnabot`. Teste de egresso do pod (Ruby `TCPSocket`, método confiável):
```
PG 172.17.20.132:5432 = OPEN      (necessário)
PG standby .133:5432   = OPEN      (necessário)
Redis 172.17.20.132:6379 = OPEN   (necessário)
k8s-api 10.96.0.1:443  = OPEN      (necessário)
internet 1.1.1.1:53    = OPEN      (NÃO deveria — exfiltração/SSRF externo)
outro nó 172.17.20.5:22 = OPEN     (NÃO deveria — movimento lateral)
```
- **Impacto:** pod comprometido alcança toda a `172.17.20.0/24` e a internet. Combinado com B1 (root+NET_RAW) e A7 (webhooks), é o maior vetor de contenção.
- **Correção:** proposta C-B2 (NetworkPolicy default-deny + allowlist). **Egresso default-deny pode quebrar SMTP/webhooks externos** → aplicar em janela com validação.

## B3. PostgreSQL: papel `chatwoot` é SUPERUSER — CRÍTICA
```
SELECT rolname,rolsuper FROM pg_roles → chatwoot|t   (SUPERUSER)
```
- **Impacto:** SQLi ou comprometimento da app com esse papel = **superuser** no cluster PG → `COPY … FROM PROGRAM` (RCE como usuário `postgres` na VM do banco 10603), leitura/escrita arbitrária de arquivos, `ALTER SYSTEM`, bypass de RLS. Ser cluster dedicado limita o dano ao banco, mas superuser excede em muito o que a aplicação precisa.
- **Mitigações existentes:** `pg_hba` escopado (`host chatwoot chatwoot 172.17.20.0/27` e `.160/27`, `scram-sha-256`); `listen_addresses = localhost,172.17.20.132`.
- **Correção:** proposta C-B3 (rebaixar para dono-do-schema sem superuser, pré-criando extensões). **Requer testar migrações** → janela.

## B4. Secrets do k8s sem cifragem em repouso — ALTA
`kube-apiserver.yaml` **sem** `--encryption-provider-config` (grep → `NO_ENCRYPTION_PROVIDER`). O Secret `ragnabot-env` (`SECRET_KEY_BASE`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ACTIVE_RECORD_ENCRYPTION_*`) fica **base64 em claro** no etcd e em qualquer backup/snapshot do etcd.
- **Impacto:** quem obtiver um dump do etcd (backup, disco, nó) lê todos os segredos — inclusive as chaves que decifram os atributos sensíveis do banco.
- **Correção:** proposta C-B4 (`EncryptionConfiguration` aescbc/secretbox nos 3 apiservers + re-encriptar). **Mexe no manifesto do apiserver dos 3 nós** → janela.

## B5. Token da default ServiceAccount montado no pod — MÉDIA
`automountServiceAccountToken` não desabilitado; `/var/run/secrets/kubernetes.io/serviceaccount/token` presente (1184 bytes). **Mitigado:** a default SA não tem RBAC — `kubectl auth can-i '*' '*' --as=system:serviceaccount:ragnabot:default` → **no** para list/get/create secrets/pods e `*`. Risco residual baixo, mas boa prática desligar (o app não fala com a API do k8s).
- **Correção:** proposta C-B5 (`automountServiceAccountToken: false`). Baixo risco, mas dispara rollout dos pods (derruba websockets de agentes ativos) → juntar com C-B1 numa janela.

## B6. Redis sem `rename-command` — MÉDIA
`grep -c '^rename-command' redis.conf = 0`. Comandos perigosos (`FLUSHALL`, `FLUSHDB`, `CONFIG`, `DEBUG`, `KEYS`) disponíveis para quem tiver a senha.
- **Mitigado:** `requirepass` **definido**, `protected-mode yes`, `bind 127.0.0.1 172.17.20.132` (não `0.0.0.0`).
- **Correção:** proposta C-B6 (renomear os perigosos com cautela — Sidekiq usa alguns comandos). Testar.

## B7. NodePort 30080/30443 sem firewall de host — MÉDIA
Os nós **não** têm firewall de host (`ufw inactive`, sem regra iptables INPUT para 30080/30443); o `kube-proxy` (nftables) aceita de qualquer origem. Bypass do proxy comprovado:
```
Do proxy:      172.17.20.{4,5,162}:30080 e :30443 = OPEN
Do hypervisor: todos = closed   (há segmentação parcial entre subredes)
HTTP direto na :30080 (Host: chat002…) → 200 + Set-Cookie SEM Secure (tráfego em claro)
```
- **Impacto:** qualquer host que roteie até `172.17.20.0/24:30080` fala com o app em **HTTP puro**, fora do TLS e do freio de login do proxy.
- **Correção:** proposta C-B7 (firewall na CHR/RB: permitir 30080/30443 só de `172.20.11.2`; restringir também `6443/10250/2379` à subrede do cluster). Rede — janela/cuidado.

## B8. Plano de controle — endurecido (POSITIVO)
- etcd: `--client-cert-auth=true`, `--peer-client-cert-auth=true`, escuta `127.0.0.1` + IP do nó (subrede do cluster), TLS.
- kubelet: `anonymous.enabled=false`, `authorization.mode=Webhook`.
- apiserver: `--authorization-mode=Node,RBAC` (sem AlwaysAllow); `anonymous-auth` no default (só health, guardado por RBAC).
- Portas `6443/10250` escutam em `*` mas **autenticadas**; alcance limitado à subrede do cluster (hypervisor de outra subrede não alcança). Reforço de rede em C-B7.

## B9. Redis/PG autenticados + bind restrito (POSITIVO)
`REDIS_URL` com senha; `POSTGRES_*` com `scram-sha-256`; `pg_hba` escopado às faixas do cluster. `TRUSTED_PROXIES=10.244.0.0/16,172.17.20.0/24,172.20.11.2` (correto — não é `0.0.0.0/0`, então o `X-Forwarded-For` só é confiado vindo do proxy/cluster).

## B10. Armazenamento local num único nó — INFO (DR, não segurança direta)
`ACTIVE_STORAGE_SERVICE=local` + StorageClass `local-path`; os anexos vivem em disco do `rgtk8s001`. Nota de resiliência/DR (não replicado), sem impacto direto de confidencialidade.

---

# PARTE C — Correções PROPOSTAS (pendentes de decisão/janela)

> Ordenadas por prioridade. Todas reversíveis. Nenhuma foi aplicada por exigir teste, janela ou decisão do dono (política "não derrube nada" + "deploy só sem sessão ativa").

### C-B3 (CRÍTICA) — Rebaixar o papel PostgreSQL `chatwoot`
Numa janela, com backup lógico recente:
```sql
-- pré-criar o que exige superuser (uma vez), como postgres:
\c chatwoot
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- se usada
-- rebaixar:
ALTER ROLE chatwoot NOSUPERUSER;
-- garantir que segue dono do schema/tabelas (migrações):
ALTER SCHEMA public OWNER TO chatwoot;   -- confirmar
```
Validar: subir uma migração de teste / `rails db:migrate:status`. Se uma migração futura pedir extensão nova, pré-criar como postgres. **Rollback:** `ALTER ROLE chatwoot SUPERUSER;`.

### C-B2 (ALTA) — NetworkPolicy no namespace `ragnabot`
Aplicar e **validar em segundos** (app 200 via proxy + pod ainda alcança PG/Redis); se falhar, `kubectl delete -f`. Cuidado: egresso default-deny bloqueia SMTP/webhooks externos — ajustar o bloco de internet conforme necessidade real.
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: ragnabot-default-deny, namespace: ragnabot }
spec: { podSelector: {}, policyTypes: [Ingress, Egress] }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: ragnabot-allow, namespace: ragnabot }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ingress-nginx } }
        - podSelector: {}            # web<->worker no mesmo ns
      ports: [ { port: 3000, protocol: TCP } ]
  egress:
    - to: [ { ipBlock: { cidr: 172.17.20.132/32 } }, { ipBlock: { cidr: 172.17.20.133/32 } } ]
      ports: [ {port: 5432, protocol: TCP}, {port: 6379, protocol: TCP} ]
    - to: [ { namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } } ]
      ports: [ {port: 53, protocol: UDP}, {port: 53, protocol: TCP} ]   # CoreDNS
    - to: [ { ipBlock: { cidr: 10.96.0.1/32 } } ]
      ports: [ {port: 443, protocol: TCP} ]                              # kube-apiserver
    # + regra explícita para SMTP externo/webhooks se forem usados (portas/destinos reais).
```
⚠️ Testar as liveness/readiness probes após aplicar (algumas CNIs bloqueiam probe do kubelet sob default-deny; se os pods reiniciarem, remover a policy).

### C-B4 (ALTA) — Cifragem de Secrets em repouso (etcd)
Nos 3 nós: criar `/etc/kubernetes/enc/encryption-config.yaml` (provider `aescbc` ou `secretbox` com chave nova), adicionar `--encryption-provider-config=` ao `kube-apiserver.yaml`, reiniciar apiserver (um nó por vez, esperar `Ready`), e re-encriptar: `kubectl get secrets -A -o json | kubectl replace -f -`. **Rollback:** manter provider `identity` como 2º na lista para leitura.

### C-B1 + C-B5 (ALTA/MÉDIA) — securityContext + desligar automount (mesmo rollout)
Adicionar aos dois Deployments (testar antes — a imagem grava em `/app/tmp`, `/app/log`; provavelmente precisa `emptyDir` nesses caminhos se `readOnlyRootFilesystem:true`):
```yaml
spec:
  template:
    spec:
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: web
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
            readOnlyRootFilesystem: true      # exige emptyDir p/ /app/tmp etc. — VALIDAR
          volumeMounts: [ { name: tmp, mountPath: /app/tmp } ]
      volumes: [ { name: tmp, emptyDir: {} } ]
```
Aplicação de menor risco (aplicáveis isolados primeiro): `allowPrivilegeEscalation:false`, `capabilities.drop:[ALL]`, `seccompProfile:RuntimeDefault`. Maior risco (testar): `runAsNonRoot`/`readOnlyRootFilesystem`. **Dispara rollout** (derruba websockets) → janela sem atendimento.

### C-B6 (MÉDIA) — Redis rename-command
No `redis.conf` (backup antes), renomear para strings aleatórias e recarregar: `FLUSHALL`, `FLUSHDB`, `DEBUG`, `KEYS`. Avaliar `CONFIG` (Sidekiq/algumas libs consultam) — testar em janela. **Rollback:** restaurar o `redis.conf`.

### C-B7 (MÉDIA) — Firewall de rede do NodePort e do plano de controle
Na CHR/RB que roteia para `172.17.20.0/24`: permitir `dst-port 30080,30443` **só** de `172.20.11.2` (proxy); dropar o resto. Restringir também `6443/10250/2379` à própria subrede do cluster + estações de administração. (Segmentação parcial já existe — o hypervisor de outra subrede não alcança.)

### C-B8 (BAIXA) — `/super_admin` gera redirect http
Forçar https na geração de URL do app (`config.force_ssl` / `default_url_options` já deriva de `FRONTEND_URL=https://…`) — investigar por que o super_admin ignora. Mitigado por HSTS.

### C-A4 / C-B7b (BAIXA) — CSP e OCSP stapling no proxy
- **CSP:** o Chatwoot não envia `Content-Security-Policy`. Uma CSP restritiva pode quebrar o SPA (Vite/inline) → montar em modo `Content-Security-Policy-Report-Only` primeiro, com endpoint de report, e só então aplicar. **Não aplicado** para não arriscar a interface.
- **OCSP stapling:** `ssl_stapling on; ssl_stapling_verify on; resolver <dns> valid=300s;` no vhost. Baixo impacto; aplicar quando conveniente.

---

# PARTE D — O que depende do dono / janela

1. **[CRÍTICA] Rebaixar `chatwoot` de SUPERUSER** (C-B3) — janela + teste de migração.
2. **[ALTA] NetworkPolicy** (C-B2) — aplicar com validação; decidir destinos externos (SMTP/webhooks) a liberar.
3. **[ALTA] Cifragem de Secrets no etcd** (C-B4) — mexe no apiserver dos 3 nós (um a um).
4. **[ALTA/MÉDIA] securityContext + automount off** (C-B1/C-B5) — rollout dos pods → **janela sem atendimento ativo** (derruba websockets).
5. **[MÉDIA] Firewall de rede do NodePort/plano de controle** (C-B7) — mudança na CHR/RB.
6. **[MÉDIA] Redis rename-command** (C-B6) — testar Sidekiq.
7. **[BAIXA] CSP (report-only→enforce), OCSP, redirect http do super_admin.**

---

## Anexo — comandos de prova (resumo)
- Contexto k8s: `kubectl get pods,deploy,svc -n ragnabot -o wide`; `kubectl get networkpolicy -A`.
- Pod root/caps: `kubectl exec … -- id; grep ^Cap /proc/1/status`.
- Egresso: `ruby -e 'TCPSocket.new(host,port)'` dentro do pod.
- PG superuser: `sudo -u postgres psql -tAc "SELECT rolname,rolsuper FROM pg_roles WHERE rolname='chatwoot'"`.
- Cifragem etcd: `grep encryption-provider-config /etc/kubernetes/manifests/kube-apiserver.yaml`.
- HTTP/TLS/cookie: `curl --resolve chat002.ragnatela.com.br:443:127.0.0.1 -sSI https://chat002.ragnatela.com.br/` a partir do proxy.
- Multi-tenant: `rails runner` (contas descartáveis, destruídas ao fim) + `Net::HTTP` cruzado.

*Fim do laudo.*
