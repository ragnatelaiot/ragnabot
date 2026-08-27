# Fundação de dados do Ragnabot — PostgreSQL 18 replicado + Redis
> VMs dedicadas fora do Kubernetes (o cluster fica stateless). Sem segredos aqui —
> os valores reais vivem em `/root/.chat002-credenciais` (600) das próprias VMs.

## Topologia
| Papel | VM | IP (VLAN 34 — dados do atendimento) |
|---|---|---|
| **Primário** PG 18.6 + Redis | RGTPSTGSQL001 (10603) | `172.17.20.132` |
| **Standby** PG (streaming) + Redis réplica | RGTPSTGSQL002 (10604) | `172.17.20.133` |

## Como foi montado (passo a passo reproduzível)
### 1. Primário
```bash
apt-get install -y postgresql-18 postgresql-contrib postgresql-18-pgvector redis-server
# /etc/postgresql/18/main/conf.d/chat002.conf
#   listen_addresses = 'localhost,172.17.20.132'
#   wal_level = replica · max_wal_senders = 5 · max_replication_slots = 5 · wal_keep_size = 1GB
#   shared_buffers = 1536MB · effective_cache_size = 4GB
# pg_hba.conf (append):
#   host replication replicator 172.17.20.133/32   scram-sha-256
#   host chatwoot    chatwoot   172.17.20.0/27     scram-sha-256   # nós do cluster (pods saem c/ IP do nó)
#   host chatwoot    chatwoot   172.17.20.160/27   scram-sha-256   # nó 3 (XSE)
sudo -u postgres psql -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '<senha>'"
sudo -u postgres psql -c "CREATE ROLE chatwoot WITH LOGIN PASSWORD '<senha>'"
sudo -u postgres createdb -O chatwoot chatwoot
sudo -u postgres psql -c "SELECT pg_create_physical_replication_slot('standby_10604')"
# Extensões que o Chatwoot pede (criadas como postgres): pgcrypto, pg_trgm, vector, btree_gin
# O papel chatwoot recebeu SUPERUSER: cluster DEDICADO à plataforma (schema.rb cria extensões).
```
### 2. Standby
```bash
systemctl stop postgresql && rm -rf /var/lib/postgresql/18/main
sudo -u postgres PGPASSWORD='<senha>' pg_basebackup -h 172.17.20.132 -U replicator \
  -D /var/lib/postgresql/18/main -R -S standby_10604 -X stream -c fast   # ⚠️ -c fast: sem ele espera o checkpoint espalhado (minutos parado)
systemctl start postgresql   # sobe em hot standby (pg_is_in_recovery = t)
```
### 3. Redis
Primário: `bind 127.0.0.1 172.17.20.132` + `requirepass` + `masterauth`.
Réplica: idem com `.133` + `replicaof 172.17.20.132 6379`.

## ⚠️ Armadilha que custou uma tarde: MTU 9100 × caminho 9000
As placas das VMs vieram com MTU **9100**; o caminho entre os hipervisores comporta **9000**.
Ping passava (até jumbo de 9000) e TCP grande morria calado (buraco negro, DF ligado):
basebackup a 60 KB/s. **Prova:** `ping -M do -s 8972` passa, `-s 9072` não.
**Correção:** `mtu: 9000` no netplan das placas de dados (regra do dono: RGT001/002 = 9000).
Resultado: 1,04 GB/s.

## Verificações de saúde
```bash
# no primário
sudo -u postgres psql -c "SELECT application_name, state, replay_lag FROM pg_stat_replication"
# no standby
sudo -u postgres psql -c "SELECT pg_is_in_recovery()"   # t
redis-cli -a '<senha>' info replication | grep role     # slave
```
