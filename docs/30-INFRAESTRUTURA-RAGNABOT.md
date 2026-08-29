# 🏗️ 30 — INFRAESTRUTURA DO RAGNABOT
### Como tudo funciona, por que foi construído assim, e o que acontece quando quebra

> **Documento vivo.** Estado em 28 de agosto de 2026. Todos os números aqui foram **medidos**, não
> estimados. Onde algo não pôde ser medido, está escrito que não pôde.
>
> Este documento existe para responder três perguntas, nesta ordem: **como funciona**, **por que
> foi feito assim**, e **o que acontece quando um pedaço morre**. A terceira é a que importa às
> três da manhã.

---

## 1. O retrato em uma página

O Ragnabot é a plataforma de atendimento omnichannel da Ragnatela. Ele roda sobre **Chatwoot
4.17.1**, num cluster **Kubernetes de três nós**, com banco **PostgreSQL 18.6** replicado,
armazenamento de anexos **próprio** e failover automático em todas as camadas.

```
                        INTERNET
                            │
                    proxy reverso (nginx)
                    XSEPRXRVS001 · 172.20.11.2
                            │  https://bot.ragnatela.com.br
        ┌───────────────────┴───────────────────┐
        │        CLUSTER KUBERNETES (3 nós)      │
        │                                        │
        │   rgtk8s001      rgtk8s002    rgtk8s003│
        │   172.17.20.4    .5           .162     │
        │   ┌────────┐    ┌────────┐   ┌───────┐ │
        │   │ web    │    │ web    │   │       │ │
        │   │ worker │    │        │   │       │ │
        │   │ MinIO  │    │ MinIO  │   │ MinIO │ │
        │   │ 2 disc.│    │ 2 disc.│   │2 disc.│ │
        │   └────────┘    └────────┘   └───────┘ │
        │        │             │                  │
        │   ┌────┴─────────────┴────┐             │
        │   │  banco-lider (HAProxy)│             │
        │   └───────────┬───────────┘             │
        └───────────────┼─────────────────────────┘
                        │ pergunta "quem é o líder?"
        ┌───────────────┴───────────────────────┐
        │   REDE DE FUNDO — VLAN 34             │
        │   172.17.20.128/27 (isolada)          │
        │                                        │
        │  pg132 (.132)   pg133 (.133)   witness │
        │  PostgreSQL     PostgreSQL     (.134)  │
        │  Redis          Redis          etcd    │
        │  Patroni        Patroni      sentinel  │
        │  etcd           etcd                   │
        │  sentinel       sentinel               │
        └────────────────────────────────────────┘
```

**Uma decisão governa esse desenho:** consenso e replicação são **conversa interna** e ficam
isolados na rede de fundo. A rede da frente carrega só o que o usuário vê.

---

## 2. O armazenamento de anexos (MinIO)

### 2.1 O problema que ele resolve

Quando um cliente manda um PDF pelo atendimento, aquele arquivo precisa morar em algum lugar. Até
28 de agosto ele morava **no disco de uma máquina só**. E aí vinha a armadilha que ninguém tinha
percebido: como o arquivo estava preso àquela máquina, **a aplicação também ficava presa** —
nenhum programa podia rodar em outro servidor, porque não alcançaria os anexos.

O resultado é que existiam três servidores, mas **todos os programas rodavam em um**. As "duas
cópias" da aplicação estavam na mesma máquina. Se ela caísse, caía tudo.

### 2.2 Como o MinIO guarda um arquivo

Ele **não** guarda o PDF inteiro num disco e faz cópias nos outros. Ele **fatia o arquivo e
espalha os pedaços**:

| | |
|---|---|
| Pedaços de **dado** | 3 |
| Pedaços de **paridade** | 3 |
| Total de discos | **6** |
| Necessário para remontar | **3 quaisquer** |

A paridade não é cópia — é um cálculo que permite **reconstruir** o que faltar. Por isso bastam
três pedaços quaisquer dos seis: tanto faz quais.

**Consequência prática:** o sistema tolera perder **até três discos** e ainda entregar todos os
arquivos, sem perder um byte.

### 2.3 Por que seis discos, e não quatro nem cinco

Esta foi a decisão mais consequente, e ela quase saiu errada.

O MinIO exige **maioria dos discos viva para aceitar arquivo novo**. Não basta conseguir ler —
para *gravar*, ele quer maioria. Isso muda tudo quando se conta quantos discos sobram depois de
uma máquina morrer:

| Desenho | Perde 1 máquina | Sobram | Resultado |
|---|---|---|---|
| 2 máquinas × 2 discos | −2 discos | 2 de 4 | ❌ **fica só leitura** |
| 5 discos em 5 máquinas | −1 disco | 4 de 5 | ✅ escreve |
| **3 máquinas × 2 discos** | −2 discos | **4 de 6** | ✅ **escreve** |

O primeiro desenho era o que parecia natural — pôr os discos nos dois servidores de banco. Mas ele
falha exatamente quando você mais precisa: o atendente tenta anexar um documento e recebe erro,
justamente durante um incidente.

O segundo foi descartado por outro motivo: **a porta 9000 não passa** entre a VLAN dos bancos e a
do Kubernetes (a CHR filtra por porta de destino), e a ordem era não mexer nas CHRs.

### 2.4 Onde os discos ficam

Dois em cada hipervisor — e isso não é detalhe:

| Hipervisor | Nó | Discos | Pool |
|---|---|---|---|
| RGTSRVHST001 | `rgtk8s001` | 2 × 100 GB | `POOL-SSDS-01` |
| RGTSRVHST002 | `rgtk8s002` | 2 × 100 GB | `POOL-SSDS-01` |
| XSESRVHST001 | `rgtk8s003` | 2 × 100 GB | `VMS-DB-INTERNO` |

Perder um **servidor físico inteiro** tira 2 discos dos 6. Sobram 4 — acima da maioria. Os anexos
continuam sendo lidos **e gravados**.

### 2.5 Espaço e retenção

- **600 GB brutos → 300 GB úteis.** Paridade custa: você grava 1 GB e ele ocupa cerca de 1,7 GB
  somando os pedaços. Não é desperdício — é o preço de não perder dado.
- **Retenção de 14 dias** (ordem do dono, 28/08). ⚠️ **Atenção ao que isso significa:** é
  expiração de **versões antigas**, não Object Lock. O anexo **atual** vive enquanto a conversa
  existir; o que some em 14 dias são as versões substituídas. Foi escolhido assim de propósito —
  Object Lock impediria a exclusão por LGPD.

### 2.6 Detalhes de implementação que importam

- Sistema de arquivos **XFS**, recomendado pelo MinIO para muitos arquivos pequenos.
- Montagens gravadas no `fstab` **por UUID** — sobrevivem a reinício.
- `discard=on` nos discos: espaço apagado volta ao pool do Proxmox.
- O Chatwoot fala com ele por `ACTIVE_STORAGE_SERVICE=s3_compatible` e variáveis `STORAGE_*`
  (⚠️ **não** `S3_*` nem `AWS_*` — conferido em `/app/config/storage.yml`, não presumido).

---

## 3. O banco de dados e o failover automático

### 3.1 O que existia antes, e por que não bastava

Havia replicação: um servidor principal e uma cópia em espera, em sincronia. Isso protege contra
**a queda de uma máquina** — mas não contra apagar uma tabela por engano nem contra ransomware,
porque esses replicam para a cópia em segundos.

E, pior: **a troca era manual**. Um ensaio em 28/08 mediu o custo disso:

```
19:54:01  primário morre
19:55:42  a promoção começa      ← 1 min 41 s de espera humana
19:55:49  promovido               ← o ato leva 7 segundos
19:57:57  aplicação reapontada
```

**Quatro minutos de apagão, e quase tudo foi espera por gente.** Às três da manhã, isso vira horas.

### 3.2 O acidente que decidiu o desenho

Ao religar o servidor que havia morrido, ele **voltou achando que ainda era o principal**. Por
alguns minutos existiram **dois principais ao mesmo tempo** — o que se chama de cérebro dividido.

Não houve perda de dados, mas **não por mérito do desenho**: foi porque ninguém escreveu no
servidor errado naquele intervalo. Se alguém tivesse escrito, os dados divergiriam e não haveria
como reconciliar sem escolher qual metade perder.

### 3.3 A solução: Patroni com três votos

**Patroni** é quem decide e executa a promoção. Ele guarda a decisão num **etcd** de três membros:

| Membro | Onde | Papel |
|---|---|---|
| `pg132` | 172.17.20.132 | banco + voto |
| `pg133` | 172.17.20.133 | banco + voto |
| `witness` | 172.17.20.134 | **só voto** (LXC 10606 `rgtpgwitness`, 1 vCPU / 1 GB) |

**Por que a testemunha existe** — e este é o ponto que não é óbvio: com **dois** votos, quando um
some, o sobrevivente **não sabe** se o outro morreu ou se a **rede partiu**. Se ele assumir que o
outro morreu e estiver errado, cria o segundo principal. Foi exatamente isso que aconteceu no
acidente acima.

Com três votos, a maioria decide. Quem ficar isolado sabe que está isolado, e não promove nada.

**A colocação da testemunha foi deliberada:** ela fica no **HST001, junto do standby**. Assim, a
morte do HST002 (que hospeda o líder) deixa 2 de 3 votos vivos — e a promoção acontece. É a falha
que importa.

### 3.4 O `failsafe_mode`

Configurado como `true`. Sem ele, perder o etcd faria o líder **se rebaixar sozinho** — derrubando
o banco por um problema que não é do banco. Com ele, o líder só se rebaixa se de fato perder
contato com todos os outros.

### 3.5 Como a aplicação encontra o líder

Ela **não procura**. Existe um roteador dentro do Kubernetes:

```
aplicação  →  banco-lider:5432  →  ┌─ pg132  (pergunta: você é o líder?)
                (HAProxy ×2)       └─ pg133  (pergunta: você é o líder?)
```

O Patroni expõe `/primary` na porta 8008 e responde **200 apenas no nó que é líder naquele
momento**. Qualquer outro devolve 503. O HAProxy usa isso como teste de saúde — **não adivinha,
pergunta**.

Quando o líder muda, o roteador muda o destino e **ninguém reconfigura nada**.

> **Por que não um endereço flutuante:** exigiria mexer na rede e nas CHRs. Aqui a decisão vive
> dentro do cluster, e a verdade vem do próprio Patroni.

O roteador tem **duas cópias, em nós diferentes** (anti-afinidade obrigatória) — ele mesmo não pode
ser o ponto único.

---

## 4. O Redis e o Sentinel

O Redis guarda a fila de trabalho da plataforma. **Sem ele, o Chatwoot não sobe** — o que fez a
plataforma cair num ensaio mesmo com o banco trocando sozinho.

A replicação já existia. Faltava o árbitro: **Redis Sentinel**, três instâncias (os dois bancos e a
testemunha), com **quórum 2**.

**Por que quórum 2 de 3:** dois árbitros precisam *concordar* que o mestre morreu antes de promover.
Com um só, uma piscada de rede promoveria à toa e criaria dois mestres.

### 4.1 A armadilha que custou horas

O Chatwoot faz isto:

```ruby
password = ENV.fetch('REDIS_SENTINEL_PASSWORD', base_config[:password])
sentinel_url_config[:password] = password if password.present?
```

Ou seja: **sem uma senha de sentinel definida, ele cai de volta na senha do Redis** — e manda
autenticação para o árbitro, que não pede nenhuma. O resultado é o pod em ciclo de reinício com
`ERR AUTH ... called without any password configured`.

Dar senha ao árbitro **não resolve**: foi medido que o **Sentinel ignora a diretiva `requirepass`**
— ele responde sem autenticação mesmo com a linha no arquivo.

**A solução** é definir a variável como **string vazia**. Em Rails, `"".present?` é falso — então
ele não manda autenticação nenhuma. Uma linha.

---

## 5. A alta disponibilidade da aplicação

### 5.1 Quatro travas em cascata

Soltar a aplicação do nó único não foi um passo — foram quatro. Cada uma produzia o **mesmo
sintoma** ("os programas não saem do lugar") e só aparecia depois de resolver a anterior:

| # | A trava | Por que enganava |
|---|---|---|
| 1 | `nodeSelector: hostname=rgtk8s001` cravado nos deployments | resquício não documentado de quando o volume morava lá; era o grilhão real |
| 2 | anti-afinidade **"preferida"** | perdeu para o bônus de imagem em cache (673 MB, baixada em 806 ms). Só `obrigatória` funcionou |
| 3 | a **política de rede** que nós mesmos criamos | barrava a porta do MinIO; a proteção estava certa, faltava a exceção |
| 4 | `rgtk8s003` (XSE, site remoto) **não alcança o banco** | pod em ciclo de reinício lá; resolvido com afinidade negativa |

> **A lição:** sintoma idêntico não significa causa única. Se eu tivesse parado na primeira e
> declarado resolvido, teria entregado a mesma fragilidade com aparência nova.

### 5.2 A armadilha do rollout

Com anti-afinidade **obrigatória** e número de nós igual ao de réplicas, a estratégia padrão do
Kubernetes (`maxSurge 25%`) **trava**: ele quer criar o pod novo antes de remover o velho, e não
sobra nó livre.

**Correção:** `maxSurge: 0` + `maxUnavailable: 1` — remove antes de criar.

### 5.3 O tempo de reação

O padrão do Kubernetes espera **5 minutos** para reagendar pods de um nó morto. Ajustado para
**60 segundos** (`tolerationSeconds`), senão o ensaio mede o padrão do Kubernetes, não o nosso HA.

---

## 6. Os ensaios de failover — números medidos

Todos executados em 28/08 com sonda externa amostrando a cada segundo, pelo **mesmo caminho do
usuário** (com `--resolve` para o proxy, porque o hairpin NAT faz o teste interno mentir).

Linha de base saudável: **200, entre 43 e 122 ms**.

| Ensaio | O que foi feito | Resultado |
|---|---|---|
| **A** | esvaziar um nó do Kubernetes, com aviso | **1 segundo** fora — e nem foi da aplicação (a porta de entrada mudou de nó) |
| **B** | **matar a VM** de um nó | **47 s de falha intermitente**, sem apagão |
| **C** | matar o principal do banco (**antes** do Patroni) | **4 minutos** — quase tudo espera humana |
| **D** | matar o líder do banco (**com** Patroni) | **promoveu sozinho** — linha do tempo saltou de 4 para 5 |
| **E** | matar o nó com **mestre do Redis *e* líder do banco juntos** | **os dois trocaram sozinhos** |
| **F** | matar nó do Kubernetes com tudo montado | **57 sucessos contra 6 falhas** |

**Ao religar:** tudo normalizou sozinho, e o nó que voltou **reassumiu como réplica** — sem os dois
principais que apareceram no ensaio C.

> ⚠️ **LEI DA CASA respeitada em todos os ensaios: apenas máquinas virtuais foram desligadas.
> Nenhum host Proxmox foi tocado em momento algum.**

---

## 7. Backup

### 7.1 O que não existia

O banco do Ragnabot **não tinha backup nenhum**. Nenhuma das oito rotinas do NOC o cobria.

A réplica protege contra a queda de uma máquina — mas **não** contra apagar uma tabela por engano,
corrupção lógica ou ransomware. Tudo isso replica para a cópia em segundos.

### 7.2 O que existe agora

`pg_dump` rodado **dentro do nó** por SSH, comprimido e enviado a um bucket **imutável** (Object
Lock, iDrive e2). Uma vez gravado, **nem o administrador apaga** — é a defesa contra ransomware.

**Duas guardas no código:**
- **Recusa se o nó não for o principal.** Dump em réplica pode ser cancelado por conflito de
  replicação no meio — falha intermitente, que é o pior defeito num backup.
- **Recusa dump abaixo de 1 KB** — vazio disfarçado de sucesso.

O dump viaja por `stdout`: **nada toca o disco do servidor de banco**.

**Prova:** `chatwoot_2026-08-28T20-58-25.dump.gz` — 58 KB em 2 segundos.

### 7.3 A separação que importa

| | Bucket **imutável** | Bucket de **anexos** |
|---|---|---|
| Guarda | cópia do banco (backup) | os arquivos das conversas (originais) |
| Object Lock | ✅ virtude — trava ransomware | ❌ defeito — impediria a LGPD |
| Pode apagar | não, por desenho | **sim, é requisito** |

Anexo **não é backup de nada** — é o original. Quando um cliente exerce o direito de exclusão, os
anexos precisam ir junto.

---

## 8. Rede e firewall

### 8.1 O padrão que se repete

Neste ambiente, **a CHR filtra por porta de destino** entre VLANs. Isso apareceu quatro vezes ao
longo da construção, sempre com o mesmo sintoma: a porta simplesmente não passa, sem erro claro.

Portas que precisaram de exceção explícita: `9000` (MinIO), `6443` (API do Kubernetes),
`26379` (Sentinel), `8008` (Patroni).

### 8.2 A exceção criada

Uma única regra, `K8S-OK-4`, irmã da que já existia:

```
chain=forward action=accept protocol=tcp
src-address-list=K8S-CLUSTER dst-address-list=K8S-BACK-ATD
dst-port=26379,8008
```

**Backup do conjunto de regras foi feito antes** (`backup-filtros-antes-26379.rsc`, 29,4 KiB), e a
contagem foi de 185 para 186 — exatamente uma regra.

⚠️ **`place-before` não funcionou** — a regra caiu na posição 184, não ao lado da irmã. Não foi
problema: testado do pod, as portas passam. Posição só importaria se houvesse bloqueio antes dela
nesse caminho.

### 8.3 Comunicação de mão única

Descoberta que mudou o desenho do etcd: os nós de banco **alcançam o NOC**, mas o **NOC não os
alcança**. Por isso o NOC não pôde ser o terceiro voto — etcd exige mão dupla. Daí a testemunha na
mesma VLAN.

---

## 9. Armadilhas registradas

Cada uma destas custou tempo real. Estão aqui para não morderem de novo.

| Armadilha | O que aprender |
|---|---|
| `lsblk` devolve tamanho **com espaço de alinhamento** | comparação de texto falha; comparar em **bytes** (`blockdev --getsize64`) |
| Disco adicionado com a VM **ligada** não aparece | é preciso mandar o sistema reler o barramento SCSI |
| Sintaxe de reticências do MinIO é `{1...2}`, não `{,2}` | ou usar lista explícita de destinos |
| Patroni do Debian vem **sem suporte a etcd** | instalar `python3-etcd` e `python3-etcd3` explicitamente |
| `systemctl mask postgresql` é **obrigatório** | Patroni e systemd disputando o mesmo processo dá resultado imprevisível |
| Template literal do JavaScript **come `${VAR}` do shell** | script de shell vai em **arquivo**, nunca em string com interpolação |
| Campo de endereço do Device é `hostname`, **não** `host` | `host: undefined` faz o ssh2 conectar em **localhost** silenciosamente |
| `null` no patch de merge **remove** a chave | objeto vazio **não** remove |
| Bloqueio de política de segurança **não dá erro — dá ausência** | a página carrega, o arquivo existe, e o elemento não aparece |
| Responder "recebi" **antes** de gravar | perde o evento para sempre; idempotência protege contra **duplicar**, não contra **perder** |
| Teste de janela de tempo com números pequenos | faz o sistema achar que "acabou de agir" e suprimir o primeiro alerta; usar o relógio real |

---

## 10. O que ainda falta

| Item | Situação |
|---|---|
| Editor de fluxo de conversa | motor e banco prontos (20 tabelas); **falta a tela** |
| Automações de atendimento | em levantamento — inatividade, expediente, intervalo, fluxo do primeiro contato |
| Transferência entre atendentes | **investigação em curso** — o modelo existe, mas o dono não consegue na prática |
| Número na Cloud API | preso na Meta; depende do suporte deles |
| Terceiro nó rodando aplicação | falta caminho de rede do XSE até o banco |
| Cópia dos anexos para fora | defesa contra ransomware do armazenamento quente |
| Poda de dados antigos | **precisa de decisão do dono** sobre prazo (LGPD) |

---

## 11. Como operar

### Ver o estado do banco
```
patronictl -c /etc/patroni/config.yml list
```
Mostra quem é líder, quem é réplica, e o atraso de cada uma.

### Ver o estado do armazenamento
```
mc admin info rb
```
Mostra discos online e offline, e o esquema de paridade.

### Ver quem é o mestre do Redis
```
redis-cli -p 26379 sentinel get-master-addr-by-name ragnabot-redis
```

### Forçar uma troca de líder do banco (manutenção planejada)
```
patronictl -c /etc/patroni/config.yml switchover
```
Troca **controlada** — espera a réplica alcançar antes de promover. Diferente do failover, que é a
reação a uma morte.

### ⚠️ Antes de qualquer reinício do NOC
```
GET /api/health/active-sessions   →   só reiniciar se safeToRestart: true
```
**Leia a saída e rode o restart em comando separado.** Encadear com `&&` já derrubou a sessão de um
usuário real — o `&&` testa se o comando *rodou*, não se a resposta *autoriza*.

---

*Ragnatela IoT Solutions · documento técnico · atualizado em 28 de agosto de 2026.*
