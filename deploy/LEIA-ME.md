# Infraestrutura do Ragnabot — o que está aqui e por quê

Este diretório é a **fonte para recriar o Ragnabot do zero**. Cada subdiretório descreve uma peça
da plataforma como ela está de fato no ar, medida no dia da última atualização — não como foi
planejada. Onde a realidade divergiu do plano, vale a realidade, e a divergência está anotada.

**Nenhum arquivo aqui contém segredo.** Onde havia senha ou chave, está escrito
`«DEFINIR — valor real só no servidor»`. Os valores vivem no `.env` do NOC, no `Secret` do
Kubernetes e nos arquivos de configuração dos servidores, nunca no Git.

---

## O desenho em uma passada

```
                    Internet
                       │  https://bot.ragnatela.com.br
                       ▼
        ┌──────────────────────────────┐
        │  Proxy reverso XSEPRXRVS001  │  TLS público
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────────────────────────────┐
        │  Kubernetes — 3 nós, 1 por HIPERVISOR                 │
        │  .4 · .5 · .162   (VLAN 34, rede de fundo)            │
        │                                                       │
        │   ragnabot-web ×2      ragnabot-worker ×1             │
        │   banco-lider  ×2  ← quem aponta para o líder do PG   │
        └───────┬───────────────────────┬───────────────┬──────┘
                │                       │               │
         anexos │                Postgres│         Redis │
                ▼                       ▼               ▼
        ┌───────────────┐      ┌────────────────┐  ┌──────────────┐
        │ MinIO 6 discos│      │ Patroni + etcd │  │Redis Sentinel│
        │ nos MESMOS 3  │      │ .132 .133 .134 │  │ .132 .133 .134│
        │ nós do k8s    │      │ failover só ele│  │ quorum 2 de 3 │
        └───────────────┘      └────────────────┘  └──────────────┘
                                        │
                                        ▼  1× por dia
                              ┌────────────────────────┐
                              │ Bucket externo iDrive  │
                              │ Object Lock (imutável) │
                              │ só o DUMP do banco     │
                              └────────────────────────┘
```

**A regra que explica o desenho todo:** cada peça é redundante **entre hipervisores diferentes**.
Perder um hipervisor inteiro tira 1 nó do Kubernetes, 2 dos 6 discos do MinIO e 1 dos 3 votos do
consenso — e nada disso, sozinho, para a plataforma.

---

## `k8s/` — a aplicação

`ragnabot.yaml` é o **estado vivo do cluster**, extraído com `kubectl get -o yaml` e limpo dos
campos que o próprio cluster preenche (`status`, `uid`, `resourceVersion`, `managedFields`).
A imagem está fixada por **digest**, não por etiqueta: `chatwoot/chatwoot@sha256:18f280a6…`.
Etiqueta muda debaixo do pé; digest é o mesmo binário para sempre — e é isso que faz uma
restauração reproduzir o que estava no ar, e não a versão de hoje.

Para reaplicar: `kubectl -n ragnabot apply -f ragnabot.yaml`.

**O que este arquivo NÃO traz, de propósito:** o `Secret` `ragnabot-env`. Só as chaves, para
conferência — os valores têm de ser recriados à mão:

| Chave | O que é |
|---|---|
| `SECRET_KEY_BASE` | assinatura de sessão do Rails |
| `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY` / `…_DETERMINISTIC_KEY` / `…_KEY_DERIVATION_SALT` | criptografia dos campos sensíveis no banco |
| `POSTGRES_PASSWORD` | usuário `chatwoot` do banco |
| `REDIS_URL` · `REDIS_PASSWORD` | fila e cache |
| `REDIS_SENTINELS` · `REDIS_SENTINEL_MASTER_NAME` · `REDIS_SENTINEL_PASSWORD` | descoberta do mestre do Redis |
| `STORAGE_ACCESS_KEY_ID` · `STORAGE_SECRET_ACCESS_KEY` | acesso ao MinIO dos anexos |
| `SMTP_PASSWORD` | envio de e-mail |

⚠️ **`REDIS_SENTINEL_PASSWORD` tem de existir, ainda que VAZIA.** Se a chave não existir, o
Chatwoot usa a senha do Redis para falar com o Sentinel — e o Sentinel **ignora `requirepass`**
(medido: responde `PONG` sem autenticação nenhuma). O resultado é uma recusa silenciosa na
descoberta do mestre. No Rails, `"".present?` é falso, então a string vazia é o jeito de dizer
"não mande senha" sem apagar a chave.

---

## `minio/` — os anexos

Seis discos de 100 GB, dois em cada um dos três nós do Kubernetes, formando **1 pool com 1
conjunto de 6 discos**. Para um conjunto desse tamanho o MinIO usa **paridade 3**: cada objeto
vira 3 pedaços de dado e 3 de paridade.

- **Leitura** sobrevive à perda de **3** discos.
- **Escrita** exige **4 dos 6** no ar.

Como os discos estão 2-a-2 por hipervisor, **um hipervisor inteiro pode cair** (leva 2 discos) e a
plataforma continua gravando anexo. Dois hipervisores fora ao mesmo tempo (4 discos) **param a
escrita** — e isso é correto: melhor recusar a gravação do que aceitar um anexo que não se
consegue mais reconstruir.

**Retenção:** regra de ciclo de vida `expira-versoes-antigas-14d` — versões antigas de um objeto
somem em 14 dias. A versão atual **nunca** expira. É o que dá desfazer sem virar depósito eterno.

**Por que o anexo NÃO vai para o bucket imutável externo:** anexo de conversa é o **original**, e
original precisa poder ser apagado (LGPD). Object Lock impede apagar — virtude no backup, defeito
aqui. São buckets diferentes de propósito.

---

## `patroni/` — o banco que se promove sozinho

Cluster `ragnabot-pg`, PostgreSQL 18, dois nós de dados (`.132`, `.133`) e três votos de etcd
(`.132`, `.133`, `.134`).

**Por que existe:** em 28/08/2026 o primário morreu num ensaio e a plataforma ficou ~4 minutos
fora. A promoção em si leva 7 segundos; o resto era espera por gente. Pior: ao religar, o nó antigo
voltou como primário e por alguns minutos **existiram dois primários**. Só não houve perda porque
ninguém escreveu naquele intervalo.

**`failsafe_mode: true`** é a linha mais importante do arquivo. Sem ela, perder o etcd faria o
líder se rebaixar sozinho — deixando o banco fora do ar por um problema que **não é do banco**.

**Tudo na rede de fundo (VLAN 34, `172.17.20.128/27`)**, por decisão do dono: consenso e replicação
são conversa interna e ficam isolados da rede da frente.

⚠️ **O líder MUDA, e código nenhum pode supor qual é.** Em 29/08 o líder era `.133` — o nó que
nasceu como reserva. O backup do NOC apontava para um nó fixo e passou a se recusar a rodar
("não é o primário agora"). A guarda estava certa; a suposição é que estava errada. Quem escrever
código que fala com este banco deve **descobrir o líder a cada vez**, perguntando
`SELECT NOT pg_is_in_recovery()` a cada nó.

---

## `redis/` — a fila

Três Sentinelas (`.132`, `.133`, `.134`) vigiando um mestre e uma réplica, **quorum 2 de 3**.
`down-after-milliseconds 5000` e `failover-timeout 10000`: cinco segundos para declarar morto, dez
para concluir a troca.

O mestre também **migra**. Em 29/08 estava em `.133`, com `config-epoch 1` — ou seja, já houve uma
troca de verdade, e ela funcionou.

---

## `postgres/` e `nginx/` e `turnstile/` e `branding/`

Peças anteriores, já documentadas nos seus próprios README.

---

## Ordem de recriação, do zero

1. **VMs e rede** — 3 nós k8s + 3 nós de dados, VLAN 34 para o fundo.
2. **etcd** nos três nós de dados (é o que sustenta o Patroni).
3. **Patroni** nos dois nós de banco → confirmar com `patronictl -c /etc/patroni/config.yml list`
   que existe **um** líder.
4. **Redis + Sentinel** nos três → `redis-cli -p 26379 sentinel masters` deve apontar um mestre.
5. **MinIO** nos três nós k8s, com os dois discos de cada → `mc admin info` com 6/6 discos OK,
   e recriar a regra de 14 dias.
6. **Kubernetes** → recriar o `Secret` (tabela acima), depois `kubectl apply -f k8s/ragnabot.yaml`.
7. **Restaurar o banco** a partir do dump mais recente no bucket imutável
   (`backup-postgres/chatwoot_*.dump.gz` → `gunzip` → `pg_restore`).
8. **Proxy reverso** e DNS de `bot.ragnatela.com.br`.
