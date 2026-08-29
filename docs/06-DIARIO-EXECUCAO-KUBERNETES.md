# 📓 KUBERNETES — DIÁRIO DE EXECUÇÃO
> **Aberto em 27/08/2026**, a pedido do dono: *"documente tudo com riqueza passo a passo de tudo que
> está fazendo (…) para no final conseguir fazer uma documentação robusta em docx"*.
>
> **Regra deste diário:** tudo aqui é **medido**, com o comando que produziu o número. Onde houver
> inferência, está marcado como tal. Cada ação registra: o que foi feito · por quê · como reverter ·
> como se provou que funcionou.
>
> Irmãos: `05-ESTADO-E-RETOMADA-KUBERNETES.md` (estado de 25/08) ·
> `03-PLANO-REDE-VLANS-CHRS.md` · `00-PRE-REQUISITOS-INFRAESTRUTURA.md` · `04-PROXMOX-VMS-E-VLANS.md`

---

## SEÇÃO 0 — LEVANTAMENTO DE ABERTURA (27/08, 12:50–13:05)

**Objetivo:** confirmar, por medição, se o estado descrito em 25/08 ainda é o real, antes de tocar
em qualquer coisa. **Nada foi alterado nesta seção — 100% leitura.**

### 0.1 As cinco máquinas — conferidas no hipervisor E por dentro

| VM | nome | host | CPU/RAM | `onboot` | placas (tag VLAN) | estado |
|---|---|---|---|---|---|---|
| 10601 | RGTK8S001 | RGT001 | 10 / 8192 | ✅ 1 | net0=**55** · net1=**30** | running |
| 10602 | RGTK8S002 | RGT002 | 10 / 8192 | ✅ 1 | net0=**55** · net1=**30** | running |
| 10603 | RGTPSTGSQL001 | RGT001 | 10 / 8192 | ✅ 1 | net0=**55** · net1=**32** · net2=**34** | running |
| 10604 | RGTPSTGSQL002 | RGT002 | 10 / 8192 | ✅ 1 | net0=**55** · net1=**32** · net2=**34** | running |
| 10605 | RGTK8S003 (voto) | XSE001 | 12 / 12288 | ✅ 1 | net0=**230** | running |

**Por dentro (via `qm guest exec`):**

| VM | IP hoje | Kubernetes | containerd | disco no SO | `ip_forward` | SO |
|---|---|---|---|---|---|---|
| 10601 | 172.17.10.41/27 | ❌ ausente | inactive | **58G** | 0 ✅ | Ubuntu 26.04 LTS |
| 10602 | 172.17.10.42/27 | ❌ ausente | inactive | **58G** | 0 ✅ | Ubuntu 26.04 LTS |
| 10603 | 172.17.10.48/27 | ❌ ausente | inactive | **58G** | 0 ✅ | Ubuntu 26.04 LTS |
| 10604 | 172.17.10.49/27 | ❌ ausente | inactive | **58G** | 0 ✅ | Ubuntu 26.04 LTS |
| 10605 | 172.17.13.34/27 | ❌ ausente | inactive | 176G ✅ | 0 ✅ | Ubuntu 26.04 LTS |

⚠️ **Duas divergências entre hipervisor e sistema, ambas esperadas:**
1. **As placas novas (net1/net2) não têm endereço** no Ubuntu — existem só no hipervisor.
2. **O disco não cresceu no sistema**: 58G onde o hipervisor entrega 120G/200G. Falta `growpart`
   + `resize2fs`. (A 10605 já foi expandida: 176G.)

### 0.2 A rede nas duas CHRs — paridade perfeita

```
CHR001: VLANs=5  endereços=10  VRRP=5  filtro=10  NAT=1  · master em 5/5
CHR002: VLANs=5  endereços=10  VRRP=5  filtro=10  NAT=1  · master em 0/5
```
Estado correto: CHR001 primária em todas as cinco, CHR002 em espera.

Endereços conferidos na CHR001, todos na VRF **`main`**, comentados `[NOC 2026-08-24 k8s]`:

| VLAN | interface | CHR001 | VIP (gateway) | finalidade |
|---|---|---|---|---|
| 30 | `V30-K8S-CLUSTER` | `172.17.20.2/28` | `172.17.20.1` | nós — etcd, API, kubelet |
| 31 | `V31-K8S-FRONT-IA` | `172.17.20.18/28` | `172.17.20.17` | entrada da IA |
| 32 | `V32-K8S-BACK-IA` | `172.17.20.34/28` | `172.17.20.33` | dados da IA |
| 33 | `V33-K8S-FRONT-ATD` | `172.17.20.50/28` | `172.17.20.49` | entrada do atendimento |
| 34 | `V34-K8S-BACK-ATD` | `172.17.20.66/28` | `172.17.20.65` | dados do atendimento |
| 35 | — | **não existe** | — | **voto — a criar** |

### 0.3 🔴 AUDITORIA DE COLISÃO DAS FAIXAS (pedido expresso do dono)

**Pergunta do dono:** *"já checou se tem possibilidade de usar a faixa 172.17.10.X, não vai colidir
com nenhuma atual?"*

**`172.17.10.x` — ESTÁ EM USO, e numa VRF de outro contexto:**
```
172.17.10.61/27   V55-SERVIDORES-XSE        VRF: xse
172.17.10.33/27   VRRP-V55-SERVIDORES-XSE   VRF: xse   ← VIP
```
Rede `172.17.10.32/27` (de `.33` a `.62`) = **SERVIDORES DO XSE**, na **VRF `xse`**.
As cinco VMs do k8s estão em `.41 .42 .48 .49` — **dentro dessa rede**. É a "placa de internet
temporária" do documento de 25/08.

⚠️ **Não é colisão de endereço** (os IPs são únicos), **mas é pior em arquitetura**: o cluster da
Ragnatela está morando na rede e na VRF de outro contexto. Sair de lá é requisito, não estética.

**`172.17.20.x` — LIVRE e já preparada** na VRF `main`, sem nenhum vizinho.
**→ DECISÃO DO DONO (27/08): "pode usar a faixa 20 do IP".** Confirmada e adotada.

### 0.4 🔴 O BLOQUEADOR DO VOTO — medido, e é COLISÃO DE LOOPBACK

O documento de 25/08 dizia que faltava um loopback na RB5009. **A medição de hoje corrige isso:**

| equipamento | loopback |
|---|---|
| CHR001 | `10.255.255.1/32` |
| **CHR002** | **`10.255.255.2/32`** |
| **RB5009 do XSE** (`ROUTER-BORDA-XSE-RGT0010`, 172.16.1.27) | **`10.255.255.2/32`** |

**Dois equipamentos diferentes com o MESMO endereço.** Prova na CHR002:
```
DAc dst-address=10.255.255.2/32 routing-table=main gateway=lo immediate-gw=lo
    local-address=10.255.255.2%lo
```
A CHR002 resolve `10.255.255.2` para **ela mesma** — nunca alcança a RB5009 por esse IP.
Na CHR001 **não existe rota** para `10.255.255.2`.

⚠️ **Consequência se ancorássemos o voto nesse IP:** no failover, com a CHR002 assumindo, o tráfego
destinado à RB5009 iria para a própria CHR002. **O voto sumiria exatamente no failover** — que é o
defeito que a âncora existe para evitar.

**Vizinhos OSPF da CHR001 (para escolher endereço livre):**
```
10.255.255.2    DATACENTER-XSE            (RB5009 do XSE, via túnel)
10.255.255.2    WG-GFIMOVEIS-IMOBILIARIA  ← o .2 aparece DUAS vezes
10.255.255.22   WG-ANALISE-CONSULTORIA
10.255.255.102  V12-PONTE-XSE      (CHR002)
10.255.255.103  V10-PONTE-ANALISE  (CHR002)
10.255.255.104  V13-PONTE-GFIMOVEIS (CHR002)
10.255.255.254  router-id da instância ospf-crcma da RB5009
10.255.255.0    router-id da instância ospf-gfimoveis da RB5009
```

### 0.5 Onde a VM do voto vive hoje

```
VM 10605 → net0 tag 230 → V230-SERVIDORES-GERAL na RB5009
rede 172.17.13.32/27 · gateway 172.17.13.33 (a própria RB5009) · VRF main
IP atual da VM: 172.17.13.34
```
A rede `172.17.20.x` **ainda não é conhecida** na RB5009 (`/ip route` não devolve nada) — esperado.

---

## SEÇÃO 1 — PLANO DE EXECUÇÃO (a ser preenchida a cada passo)

*(as fases entram aqui à medida que forem executadas, com comando, prova e rollback)*

---

## FASE 0-A — RESOLVER A COLISÃO DE LOOPBACK (27/08, 13:05–13:10)

**Ordem do dono:** *"assim que resolver a atual questão de id de OSPF (cuidado para não derrubar
nada) pode seguir para fase de 1 a 4"*.

### Decisão de projeto e por quê

**NÃO trocar o `10.255.255.2` de ninguém.** A instância `ospf-xse` da RB5009 está com
`router-id=main`, ou seja, deriva do endereço principal — trocar o loopback mudaria o `router-id`,
forçaria reconvergência e **derrubaria adjacências**. Exatamente o que o dono mandou evitar.

**Caminho escolhido: ADICIONAR** um loopback novo e único, sem remover nada, e ancorar nele.

### Escolha do endereço — auditoria com fronteira exata

⚠️ **Armadilha encontrada e corrigida no meio do caminho:** o primeiro teste usou `includes()` e
deu **falso positivo** — `10.255.255.10` é *substring* de `10.255.255.102`. Refeito com fronteira
(`/10\.255\.255\.(\d{1,3})(?![\d])/`), lendo endereços + rotas + vizinhos OSPF + instâncias das 3
bordas (CHR001, CHR002, RB5009):

```
EM USO:  0, 1, 2, 22, 102, 103, 104, 105, 106, 107, 250, 252, 253, 254, 255
LIVRES:  3–21, 23–101 … (96 livres)
ESCOLHIDO: 10.255.255.10/32   (deixa .3–.9 livres caso o core cresça)
```

### Passos executados

| # | ação | comando | resultado |
|---|---|---|---|
| 1 | **Backup** da RB5009 | `/export file=noc-antes-loopback-20260827` | `noc-antes-loopback-20260827.rsc` · **120,7 KiB** |
| 2 | Adicionar loopback | `/ip address add address=10.255.255.10/32 interface=lo` | ✅ `.2` e `.10` convivem |
| 3 | Conferir saúde | `/routing ospf neighbor print` | **7 vizinhos em Full** (inalterado) |
| 4 | Publicar no OSPF | `interface-template add area=ospf-xse-1 networks=… passive` | ❌ **área errada** |
| 5 | Remover o errado | `interface-template remove [find …]` | ✅ 0 restantes |
| 6 | Publicar na área certa | `… area=area-datacenter networks=10.255.255.10/32 passive` | ✅ criado |
| 7 | Verificar nas CHRs | `/ip route print where dst-address="10.255.255.10/32"` | ✅ **as duas aprenderam** |

### ⚠️ Erros meus no caminho — registrados porque a lição volta

**Erro A — área OSPF errada.** Publiquei em `ospf-xse-1`, supondo que o XSE falasse com as CHRs por
ali. **Não fala.** A adjacência com o datacenter é da instância **`ospf-datacenter-flz`**, área
**`area-datacenter`** (`area-id=0.0.0.7`), interface `DATACENTER-FLZ-CHR002`. Só descobri lendo
`/routing ospf neighbor print`. **Regra: a área se descobre pelo VIZINHO, não pelo nome da instância.**

**Erro B — sintaxe.** `passive=yes` foi recusado (`expected end of command`). Nesta versão (ROS
7.23.2) `passive` é **flag**, sem valor — como nos templates existentes (`cost=1 passive`).

### ⚠️ Decisão que evitou um vazamento sério

Publiquei com **`networks=10.255.255.10/32`**, e **NÃO** com `interfaces=lo`.
Motivo: o `lo` da RB5009 carrega **três** endereços —
```
10.255.255.2/32     ← COLIDE com a CHR002
172.20.35.1/19
45.229.119.204/32   ← IP PÚBLICO
```
`interfaces=lo` publicaria **os três** no OSPF do datacenter: espalharia o endereço colidente e
vazaria o IP público para dentro da malha. **Nunca usar `interfaces=lo` nesta RB.**

### Estado ao fim da Fase 0-A

✅ Âncora `10.255.255.10/32` viva na RB5009, publicada como passiva, **aprendida pelas duas CHRs**.
✅ OSPF intacto: 7 vizinhos em Full antes e depois. Nenhuma adjacência caiu.
✅ Backup da configuração anterior salvo no próprio equipamento.

### 🔴 ACHADO QUE DEFINE A PRÓXIMA DECISÃO — a rota nasce na VRF `xse`

```
DAo dst-address=10.255.255.10/32 routing-table=xse
    gateway=172.31.31.255%DATACENTER-XSE@xse  distance=110
```

A âncora é aprendida **dentro da VRF `xse`**. Mas **todas as VLANs do Kubernetes vivem na VRF
`main`** (medido na §0.2). Ou seja: os nós (`172.17.20.0/28`, na `main`) e o voto (que nasceria no
XSE, alcançável pela `xse`) **estão em tabelas de roteamento diferentes**.

**Isso não é defeito — é a segregação funcionando.** Mas significa que o voto exige uma decisão de
arquitetura antes de existir, e ela é do dono. As opções estão na seção seguinte.

**Nota de passagem:** o template 29 da RB (`REDES PUBLICADAS PARA DATACENTER RAGNATELA FLZ`) já
publica `V230-SERVIDORES-GERAL` — a VLAN onde a VM do voto está hoje (`172.17.13.32/27`). Logo,
**a rede atual do voto já chega às CHRs**. O que falta é a VLAN exclusiva que o dono pediu.

### Rollback da Fase 0-A (dois comandos, na RB5009)
```
/routing ospf interface-template remove [find where networks="10.255.255.10/32"]
/ip address remove [find where address="10.255.255.10/32"]
```
Backup completo: `noc-antes-loopback-20260827.rsc` no `/file` da própria RB5009.

---

## FASE 0-B — LEVANTAMENTO PARA A DECISÃO DE ARQUITETURA (27/08, 13:15–13:17)

**Pedido do dono:** *"faz o levantamento para melhorar a decisão que você precisa"*.
**100% leitura + duas rotas de teste criadas e removidas** (para rede que ainda não existe).

### 0-B.1 O mapa das tabelas de roteamento

| equipamento | instância OSPF que liga os dois | VRF / tabela |
|---|---|---|
| **RB5009 do XSE** | `ospf-datacenter-flz` (`router-id=10.255.255.2`) | **`main`** |
| **CHR001/002** | `instancia-xse` (`router-id=10.255.255.1`) | **`xse`** |

⚠️ **A RB5009 NÃO TEM VRFs** — `/ip vrf print` devolve só a `main` builtin, `interfaces=all`.
Todo o XSE, do lado da RB, é `main`. A separação em VRF existe **só nas CHRs**.

**As VLANs do Kubernetes vivem na `main` das CHRs.** A âncora e tudo que vem do XSE chegam na
`xse`. Logo, o voto exige uma travessia entre tabelas — e ela já tem precedente na casa (abaixo).

### 0-B.2 O PADRÃO QUE JÁ EXISTE — como o XSE já vaza para o datacenter

Medido na CHR001:
```
As 10.35.28.0/24  gateway=172.31.31.255%DATACENTER-XSE@xse  routing-table=main
```
Rota **estática** na `main` apontando para um gateway **dentro da VRF `xse`** (sintaxe `@xse`).
É o mecanismo a replicar. ⚠️ **Mas com um defeito conhecido** (§3.3 do doc de 25/08): está presa
à interface `DATACENTER-XSE` (NETMANIA). Se essa WAN cair e a NETNOAR subir, o OSPF converge dentro
da VRF e **a rota morre com a interface**.

### 0-B.3 🔬 PROVA DE CONCEITO — os três testes

Feitos com `172.17.20.80/28` (a rede do voto, **que ainda não existe** — logo, inofensivo).
As três rotas foram **removidas** ao fim; conferido: `0 rotas de teste restantes`.

| teste | gateway | resultado |
|---|---|---|
| **A** — padrão atual | `172.31.31.255%DATACENTER-XSE@xse` | ✅ ativa — mas **morre junto com a WAN NETMANIA** |
| **B** — âncora, `target-scope` padrão | `10.255.255.10@xse` | ❌ **`immediate-gw=""`** — não resolveu |
| **C** — âncora, `target-scope=30` | `10.255.255.10@xse` | ✅ **`immediate-gw=172.31.31.255%DATACENTER-XSE`** |

### ⚠️ O ACHADO TÉCNICO QUE FARIA ISSO FALHAR EM SILÊNCIO

```
rota da ÂNCORA (aprendida por OSPF):   scope=20
rota ESTÁTICA (padrão do RouterOS):    target-scope=10
```
No RouterOS, uma rota recursiva só resolve se **`scope` do gateway ≤ `target-scope` de quem o usa**.
Com o padrão (`10`), a rota é **aceita, aparece na tabela e NÃO ENCAMINHA NADA** — `immediate-gw`
fica vazio. Não há erro, não há aviso.

> **REGRA PARA TODA ROTA ANCORADA EM LOOPBACK APRENDIDO POR OSPF: `target-scope=30`.**
> E a prova de que resolveu **não é a rota existir** — é o `immediate-gw` estar **preenchido**.

Isto vale também para a correção do vazamento do `10.35.28.0/24` (§3.3 do doc de 25/08), que tem
exatamente a mesma forma.

### 0-B.4 Onde o voto está hoje, e o que já chega às CHRs

```
VM 10605 → net0 tag 230 → V230-SERVIDORES-GERAL (RB5009)
rede 172.17.13.32/27 · gw 172.17.13.33 · IP da VM: 172.17.13.34
```
O template 29 da RB (`REDES PUBLICADAS PARA DATACENTER RAGNATELA FLZ`, área `area-datacenter`) já
lista `V230-SERVIDORES-GERAL` entre as interfaces publicadas — **a rede atual do voto já chega às
CHRs**. O que falta é a **VLAN exclusiva** que o dono pediu, e o caminho de volta ancorado.

---

## FASE 1 — VLAN EXCLUSIVA DO VOTO + ROTAS ANCORADAS (27/08, 13:19–13:20)

**Decisão do dono:** VLAN nova + rota ancorada · e corrigir o vazamento do `10.35.28.0/24` junto.

### 1.1 Na RB5009 do XSE

Tronco identificado: **`REDE-GERAL`** (bridge) — o mesmo pai das VLANs 211, 230 e 240.

```
/interface vlan add name=V35-K8S-VOTO vlan-id=35 interface=REDE-GERAL
/ip address add address=172.17.20.81/28 interface=V35-K8S-VOTO
/routing ospf interface-template add area=area-datacenter interfaces=V35-K8S-VOTO passive
```
| conferência | resultado |
|---|---|
| VLAN 35 | ✅ 1 |
| endereço | ✅ `172.17.20.81/28 · V35-K8S-VOTO · main` |
| template OSPF | ✅ 1 |
| vizinhos em Full | **7** (inalterado) |

**Plano de endereços da VLAN 35 (`172.17.20.80/28`):** `.81` = gateway (RB5009) · `.82` = VM 10605
(voto) · `.83–.94` livres.

### 1.2 Nas DUAS CHRs — rotas ancoradas (CHR002 primeiro, como o dono pediu)

```
/ip route add dst-address=172.17.20.80/28 gateway=10.255.255.10@xse \
              routing-table=main target-scope=30
/ip route add dst-address=10.35.28.0/24  gateway=10.255.255.10@xse \
              routing-table=main target-scope=30 distance=1
```

| CHR | rota do voto | vazamento 10.35.28 |
|---|---|---|
| CHR002 | ✅ resolveu (`immediate-gw=172.31.31.239%DATACENTER-XSE-R`) | ✅ ancorada, ativa |
| CHR001 | ✅ resolveu (`immediate-gw=172.31.31.255%DATACENTER-XSE`) | ✅ ancorada, ativa |

**PROVA do ganho, medida na CHR001:**
```
16  s  10.35.28.0/24 → 172.31.31.255%DATACENTER-XSE@xse   INATIVA (a antiga)
21 As  10.35.28.0/24 → 10.255.255.10@xse                  ATIVA   (a ancorada)
```
A ancorada assumiu; a presa-à-interface ficou de reserva. **A antiga NÃO foi removida de propósito**
— serve de rede de segurança enquanto a nova é observada.

---

## FASE 1-B — 🔴 TÚNEL MORTO DESCOBERTO E RESTABELECIDO (27/08, 13:20–13:29)

**Como apareceu:** o dono avisou que trocou a WAN principal do XSE de NETMANIA para NETNOAR e
perguntou se estava tudo certo. Ao conferir, achei um defeito **anterior** à troca.

### O achado

| CHR | túnel NETMANIA | túnel NETNOAR | OSPF |
|---|---|---|---|
| CHR001 | hs 1min · 3 GB / 5,3 GB | hs 1min · 35 MB / 75 MB | ✅ nos dois |
| **CHR002** | hs 1min · 24 MB / 24 MB | **hs VAZIO · rx=0 · tx=0** | ❌ **só NETMANIA** |

**Gravidade:** a CHR002 — a reserva — alcançava o XSE **só pela NETMANIA**, justamente a operadora
instável. Se ela caísse, a CHR001 seguia com dois caminhos e **a reserva ficaria cega**.
Último handshake: **3d 19h 54min** → quebrou por volta de **23/08**, antes da troca de WAN.

### Investigação — o que foi eliminado, na ordem

1. **Configuração das interfaces** — idênticas (`endpoint=:0`, `allowed=0.0.0.0/0`). As CHRs são
   **passivas**: quem inicia o handshake é a RB5009.
2. **Endpoint** — a RB aponta para `185.100.215.107:27014`; o `.107` **está** no `lo` da CHR002 e
   **responde ping** (0% de perda).
3. **Chaves públicas** — batem exatamente:
   `KRZIwGK17u9q5BlFizmk2j3Avdoy+gVAgY12wRKEn3w=` nos dois lados.
   ⚠️ **Erro meu no caminho:** o primeiro comando de leitura devolveu vazio e eu quase concluí
   "chaves não batem". Vazio era **falta de leitura**, não ausência do fato — a sintaxe estava
   errada. O túnel BOM também devolveu vazio, o que denunciou o comando.
4. **Marcação de rota** — as regras mangle existem e estão corretas:
   `src-port=1503 → LINK-NETNOAR` (T4 p/ CHR002) e `src-port=1502 → LINK-NETNOAR` (T3 p/ CHR001).
   A interface `DATACENTER-FLZ-CHR002-NETNOAR` escuta na **1503**. Bate.
5. **Rotas padrão da RB** — a `main` agora sai por `8.8.4.4` (**NETNOAR**), confirmando a troca
   feita pelo dono.

**Conclusão:** tudo configurado corretamente. O peer simplesmente **ficou preso num estado morto** e
não se recuperava sozinho, porque o WireGuard só reenvia handshake enquanto há tráfego a entregar.

### A correção

```
/interface wireguard peers disable [find where interface="DATACENTER-FLZ-CHR002-NETNOAR"]
   (2 segundos)
/interface wireguard peers enable  [find where interface="DATACENTER-FLZ-CHR002-NETNOAR"]
```
| | antes | depois |
|---|---|---|
| handshake | **3d 19h 54min** | **21 segundos** |
| tráfego | rx=0 tx=0 | rx=4684 tx=5524 |
| adjacência OSPF na CHR002 | só NETMANIA | ✅ **NETMANIA + NETNOAR** |

**Risco da ação: mínimo** — o túnel já estava morto há 4 dias; não havia o que derrubar.

### ⚠️ LIÇÃO — e ela vale para toda a malha WireGuard

**Túnel de reserva morto não avisa.** A interface fica `R` (running), a configuração continua
perfeita, e nada no painel muda — só o `last-handshake` envelhece em silêncio. Este ficou 4 dias
fora e só apareceu porque o dono perguntou.

> **Vigia recomendado:** alarmar quando `last-handshake` de peer WireGuard passar de ~10 min.
> É barato, e é a única forma de enxergar um caminho de reserva que morreu.

---

## 📍 ONDE ESTAMOS NO PLANO

| fase | o quê | estado |
|---|---|---|
| **0** | VMs, VLANs 30–34, VRRP, filtro, NAT | ✅ **feito** (24/08) |
| **0-A** | Colisão de loopback → âncora `10.255.255.10` | ✅ **feito hoje** |
| **0-B** | Levantamento + prova de conceito das rotas | ✅ **feito hoje** |
| **1** | VLAN 35 do voto + rotas ancoradas nas 2 CHRs | ✅ **feito hoje** |
| **1-B** | Túnel NETNOAR da CHR002 restabelecido | ✅ **feito hoje** (achado extra) |
| **2** | Endereçar as placas nas 5 VMs + crescer partições | ⏳ **próximo** |
| **3** | Placa da VM 10605 na VLAN 35 + endereço `.82` | ⏳ |
| **4** | Firewall do voto (etcd 2379/2380, API 6443) + NAT de saída | ⏳ |
| **5** | Fase C dos failovers — **precisa de janela com o dono** | ⏳ |
| **6** | Instalar o Kubernetes | ⏳ |

### Decisões ainda em aberto (do doc de 25/08, §3.5)
1. **Área OSPF do voto** — ⚠️ **resolvida na prática**: usamos `area-datacenter`, que é a que já
   liga a RB5009 às CHRs. Não foi preciso criar área nova.
2. **`V32` fica `/28` ou `/27`?** — depende de as réplicas dos ERPs serem internas. O dono indicou
   externas ⇒ `/28` basta. **Confirmar antes da Fase 2.**
3. **HA do Proxmox para essas VMs?** — em aberto; `onboot=1` já cobre o caso comum.

---

## FASE 1-C — REORGANIZAÇÃO DO PLANO DE ENDEREÇOS PARA /27 (27/08, 13:37–13:40)

**Ordem do dono:** *"pode usar a faixa 20 do ip"* + *"faz logo um /27, melhor pecar pelo excesso do
que pela falta"* + *"pode seguir com todo o cronograma"*.

### Por que TODAS mudaram, e não só a V32

Um `/27` só na V32 **engoliria a V33**:
```
V32 /28 = .32–.47      V32 /27 = .32–.63   ← invade
V33 /28 = .48–.63      ← aqui
```
Como **nenhuma VM estava endereçada ainda**, este era o momento de custo mínimo para uniformizar.
Depois do cluster no ar, a mesma mudança exigiria parada.

### O plano novo

| VLAN | rede `/27` | VIP | CHR001 | CHR002 | úteis |
|---|---|---|---|---|---|
| 30 cluster | `172.17.20.0/27` | `.1` | `.2` | `.3` | 30 |
| 31 frente IA | `172.17.20.32/27` | `.33` | `.34` | `.35` | 30 |
| 32 dados IA | `172.17.20.64/27` | `.65` | `.66` | `.67` | 30 |
| 33 frente ATD | `172.17.20.96/27` | `.97` | `.98` | `.99` | 30 |
| 34 dados ATD | `172.17.20.128/27` | `.129` | `.130` | `.131` | 30 |
| 35 voto (RB5009) | `172.17.20.160/27` | `.161` (gw) | — | — | 30 |
| — | `.192–.255` | | | | **livre** |

### ⚠️ A armadilha da migração, e como foi evitada

Vários endereços **novos colidiam com endereços antigos ainda existentes** (ex.: a V32 vira `.66`,
que era o valor da V34). Trocar por valor causaria conflito no meio do caminho.
**Solução: `find` pela INTERFACE, nunca pelo endereço:**
```
/ip address set [find interface="V32-K8S-BACK-IA"] address=172.17.20.66/27
```

### O que precisou mudar junto — e o que NÃO precisou

| item | mudou? | por quê |
|---|---|---|
| 10 endereços por CHR | ✅ | o plano novo |
| 6 entradas de address-list | ✅ | continham as redes antigas |
| **as 10 regras de filtro** | ❌ **não** | usam **address-list**, não IP literal — decisão feliz de quem montou em 24/08 |
| VRRP | ❌ não | o VRID e a interface não mudam |
| rota do voto (2 CHRs) | ✅ | `172.17.20.80/28` → `172.17.20.160/27` |
| VLAN 35 na RB5009 | ✅ | `.81/28` → `.161/27` |

**Conferência:** CHR001 **master em 5 de 5** · nenhuma referência a `/28` sobrou nas listas ·
rotas do voto resolvendo nas duas (`immediate-gw` preenchido).

**Backups antes de tudo:** `noc-antes-k8s-27-20260827.rsc` nas TRÊS bordas
(CHR001 173,4 KiB · CHR002 168,3 KiB · RB5009 121,6 KiB).

---

## FASE 2 — ENDEREÇAR AS PLACAS E CRESCER AS PARTIÇÕES (27/08, 13:40–13:44)

### 2.1 Placas — arquivo NOVO, sem tocar no que segura o acesso

Interfaces confirmadas **pelo MAC**, não pelo nome (o nome pode trocar de ordem):
`ens19` = net1 · `ens20` = net2.

Criado `/etc/netplan/90-noc-k8s.yaml` em cada VM — o `00-installer-config.yaml`, que mantém o
acesso pela `ens18`, **não foi tocado**. Rollback = apagar o arquivo novo e `netplan apply`.

⚠️ **SEM gateway padrão nas placas novas.** A `ens18` já tem um; dois `default` brigariam e a VM
poderia ficar inacessível. Em vez disso, **rota específica** para `172.17.20.0/24` pelo VIP da
própria VLAN (`.1` / `.65` / `.129`), com `metric: 100`.

| VM | ens18 (antiga) | ens19 | ens20 |
|---|---|---|---|
| 10601 | 172.17.10.41/27 | **172.17.20.4/27** | — |
| 10602 | 172.17.10.42/27 | **172.17.20.5/27** | — |
| 10603 | 172.17.10.48/27 | **172.17.20.68/27** | **172.17.20.132/27** |
| 10604 | 172.17.10.49/27 | **172.17.20.69/27** | **172.17.20.133/27** |

### 2.2 Partições — o disco do hipervisor finalmente chega ao sistema

| VM | antes | depois |
|---|---|---|
| 10601 | 58G | **117G** (7% usado) |
| 10602 | 58G | **117G** (7% usado) |
| 10603 | 58G | **196G** (4% usado) |
| 10604 | 58G | **196G** (4% usado) |

`growpart /dev/sda 2` + `resize2fs` — partição simples, sem LVM. Sem reinício, sem parada.

---

## 📍 ESTADO ATUALIZADO DO PLANO

| fase | o quê | estado |
|---|---|---|
| 0 | VMs, VLANs, VRRP, filtro, NAT | ✅ 24/08 |
| 0-A | colisão de loopback → âncora `10.255.255.10` | ✅ 27/08 |
| 0-B | levantamento + prova de conceito | ✅ 27/08 |
| 1 | VLAN 35 do voto + rotas ancoradas | ✅ 27/08 |
| 1-B | túnel NETNOAR da CHR002 restabelecido | ✅ 27/08 |
| **1-C** | **plano de endereços para /27** | ✅ **27/08** |
| **2** | **placas endereçadas + partições crescidas** | ✅ **27/08** |
| 3 | placa da VM 10605 na VLAN 35 + IP `.162` | ⏳ **próximo** |
| 4 | firewall do voto (2379/2380/6443) + NAT de saída | ⏳ |
| 5 | Fase C dos failovers — **janela com o dono** | ⏳ |
| 6 | instalar o Kubernetes | ⏳ |

---

## FASE 3 — PLACA DO VOTO NA VLAN 35 (27/08, 13:45–13:52)

### O que foi feito

| passo | resultado |
|---|---|
| rollback salvo | `/root/rollback-vm-10605-net1-20260827.conf` no XSESRVHST001 |
| `qm set 10605 -net1 virtio,bridge=vmbr0,firewall=1,tag=35` | ✅ **a quente**, sem desligar a VM |
| netplan `90-noc-k8s.yaml` na VM | ✅ `ens19 = 172.17.20.162/27`, rota p/ `172.17.20.0/24` via `.161` |
| firewall da RB — INPUT do voto | ✅ regra `accept src-address=172.17.20.160/27 in-interface=V35-K8S-VOTO`, **antes dos drops** |

### 🔴 BLOQUEADO — a VLAN 35 não chega ao host do XSE

```
do VOTO (172.17.20.162):
  gateway .161  → FALHA       ARP: 172.17.20.161 INCOMPLETE
  nó .4         → FALHA
  nó .5         → FALHA
```

### O caminho, e onde ele quebra

```
VM 10605 ──tap──> bridge vmbr0 (host XSE) ──bond2──> SWITCH CISCO ──LACP──> RB5009 ──> V35
   ✅              ✅ VLAN 35 PVID na porta      ❓ NÃO VERIFICADO        ✅ tudo pronto
```

**O que foi ELIMINADO por medição, um a um:**

| camada | verificação | resultado |
|---|---|---|
| VM | `ens19` UP, com IP e rota | ✅ |
| Proxmox | `fwpr10605p1` com **VLAN 35 PVID** | ✅ o host entrega tagueado |
| Proxmox | `bond2` permite VLANs 2–4094 | ✅ |
| RB5009 | interface `V35-K8S-VOTO` **RUNNING** | ✅ |
| RB5009 | bridge `vlan-filtering=yes`; entrada da VLAN 35 com **4 portas tagged**, incluindo `LACP-SWITCH-CISCO` | ✅ |
| RB5009 | **aprendeu o MAC da VM** `BC:24:11:94:FD:9D` em `vid=35` (5 MACs na VLAN) | ✅ **o quadro CHEGA** |
| RB5009 | firewall input liberado para a rede do voto | ✅ |

⚠️ **O paradoxo que aponta o culpado:** a RB **aprende o MAC da VM** (logo, quadro dela chega lá),
mas o **ARP da VM não é respondido**. Ou seja: o caminho de **ida** existe e o de **volta** não —
assinatura clássica de VLAN faltando **em um sentido** num equipamento intermediário.

**Único elo não verificado: o SWITCH CISCO** entre o `bond2` do host e a porta `LACP-SWITCH-CISCO`
da RB. Ele precisa ter a **VLAN 35 no tronco**, nos dois sentidos.

⛔ **Esse switch NÃO está no inventário do NOC** — a busca por switches devolveu só MikroTik de
GM, CRCMA, HEMOLAB e ONCOVIDA. Sem acesso a ele, não há como concluir a Fase 3.

**A VLAN 230 funciona** porque já está no tronco do Cisco desde antes; a 35 nasceu hoje.

### O que está pronto e esperando só isso
Tudo o mais: VLAN na RB, endereço, OSPF, rotas ancoradas nas duas CHRs, firewall, placa na VM,
netplan, IP. **Assim que a VLAN 35 entrar no tronco do switch Cisco, o voto passa a responder.**

### Rollback da Fase 3
```
# na VM (pelo host XSE):
qm set 10605 -delete net1
# dentro da VM: rm /etc/netplan/90-noc-k8s.yaml && netplan apply
# na RB5009:
/ip firewall filter remove [find comment~"K8S-VOTO"]
```

---

## FASE 3 CONCLUÍDA — O VOTO ALCANÇA O CLUSTER (27/08, 15:10–15:20)

### 🟢 Prova final — comunicação BIDIRECIONAL

```
DO VOTO (172.17.20.162):   .4 (nó 10601)=OK   .5 (nó 10602)=OK
DO NÓ  (172.17.20.4):      .162 (voto)=OK     .5 (nó 10602)=OK
```

### A cadeia de causas — foram QUATRO camadas, uma de cada vez

| # | onde | o que faltava | como apareceu |
|---|---|---|---|
| 1 | **RB5009** | VLAN 35 sem a `ether5` | comparação com a entrada de SERVIDORES (que tem 5 portas, não 4) — ⚠️ mas a `ether5` está **sem cabo**, então não era a causa |
| 2 | **Cisco SW001** | nada — já estava certo | VLAN 35 `VOTO-KUBERNETES` ativa e em *forwarding* em `Gi1/0/49`, `Po1`, `Po2` |
| 3 | **Dell N2024** | **a VLAN 35 não estava no `Po1`** | `show mac address-table` do MAC do host devolveu **`Po1`**, e o `show vlan id 35` listava só `Po2-3, Gi1/0/24, Te1/0/1-2` |
| 4 | **roteamento** | a RB não tinha rota para o cluster, e as CHRs não tinham a volta | ARP resolveu mas os nós não respondiam — sinal claro de que L2 fechou e o problema virou L3 |

### O que foi configurado

**Na RB5009** — rota para o cluster, com reserva:
```
/ip route add dst-address=172.17.20.0/24 gateway=172.31.31.254 distance=1   (via CHR001)
/ip route add dst-address=172.17.20.0/24 gateway=172.31.31.238 distance=2   (via CHR002)
```
⚠️ A `/27` local da VLAN 35 é **mais específica** e continua vencendo — sem conflito.

**Nas DUAS CHRs** — o vazamento no sentido inverso, que faltava:
```
/ip route add dst-address=172.17.20.0/24 gateway=V30-K8S-CLUSTER@main routing-table=xse
```
O pacote do voto chega pela VRF `xse`; os nós vivem na `main`. Sem esta rota, ida sem volta.

### ⚠️ Lições

**A ordem do diagnóstico importa:** ARP `INCOMPLETE` é sempre camada 2 — não adianta olhar rota.
Assim que o ARP resolveu (`REACHABLE`), o problema **mudou de camada** e a investigação teve de
mudar junto. Insistir em L2 depois disso teria custado horas.

**`show mac address-table` do MAC do host é o que localiza a porta.** Foi ele que apontou o `Po1` —
nenhuma leitura de configuração teria mostrado isso, porque a config do `Po1` estava "correta" para
todas as outras VLANs.

**Duas coisas ainda não respondem, e não bloqueiam o voto:**
- `.1` (VIP do VRRP) — VIP costuma não responder ICMP de fora do segmento;
- `.68` (banco, VLAN 32) — o voto não precisa do banco; o quórum é entre os nós. Investigar depois.

### Credenciais e acesso (documentado, sem segredo em texto)
- **Cisco `SW001-RAGNATELA`** `10.35.28.9` — SSH user `RagnatelA`, credencial das CHRs. Entra direto.
- **Dell `RGT0005-SW002`** `10.35.28.1` — SSH user `RagnatelA`; ⚠️ o `enable` **também** usa a mesma
  senha. Enviar `enable` e, na LINHA SEGUINTE, a senha — foi o que me faltou na primeira tentativa.

---

## FASE 3-B — OS DOIS SWITCHES NA GUIA L2 DO AMBIENTE RAGNATELA (27/08, 15:25–15:45)

**Ordem do dono:** *"já monta toda a configuração no ambiente ragnatela da guia switch L2 com esses
dois switches e identifica as portas trunk a comunicação com a rb5009 igual tem nos outros ambientes"*.

### Os equipamentos

| device (NOC) | modelo | IP | acesso |
|---|---|---|---|
| `RGT0004-SW001-RAGNATELA-CPD1` | **Cisco WS-C2960S-48FPS-L** · IOS 15.2(2)E9 | `10.35.28.9` | SSH `RagnatelA` (senha das CHRs) |
| `RGT0005-SW002-RAGNATELA-CPD1` | **Dell EMC N2024** · 6.7.1.24 | `10.35.28.1` | SSH `RagnatelA`; ⚠️ o **`enable` usa a MESMA senha** |

⚠️ **Armadilha do Dell:** mandar `enable` e, **na linha seguinte**, a senha. Na primeira tentativa
enviei `enable` seguido de linha VAZIA e li "Authentication failed" como "a senha é outra" — era
erro meu de sequência, não credencial errada.

### Topologia (levantada por CDP, não suposta)

```
RB5009 (ROUTER-BORDA-XSE) ──> Cisco Gi1/0/47
Cisco Gi1/0/49 ──> Dell Te1/0/1
Cisco Gi1/0/47 ──> Dell Te1/0/2 e Gi1/0/24
Dell Po1 ──> XSESRVHST001   (achado por `show mac address-table` do MAC do host)
```

**Troncos do Cisco** (802.1q, native vlan 27):

| porta | VLANs permitidas |
|---|---|
| `Gi1/0/7` | 27,100-101,105,300 |
| `Gi1/0/8` | 27,100,105,300 |
| `Gi1/0/49` | 2-4094 |
| `Po1` | 2-4094 |
| `Po2` | 27,35,100-101,105,220,230 |

### O que a guia L2 exigia — e por que não apareciam

O backend filtra **`type: 'mikrotik'`** e separa por **`mikrotikRole`**; a coleta é escolhida por
`agentMode`. Para switch **não-MikroTik** o caminho da casa é `agentMode='ZABBIX_SNMP'`
(`collectSwitchZabbix`), que lê tudo do **Zabbix por SNMP** em vez de SSH RouterOS.

⚠️ **Cadastrei primeiro com `type='switch_snmp'` e eles não apareceram.** O tipo não é livre — a
guia só enxerga `mikrotik`. Corrigido para:
```
type='mikrotik'  mikrotikRole='switch'  agentMode='ZABBIX_SNMP'  parentDeviceId=<RB5009>
```

### SNMP — o que faltava em cada um

| | Dell | Cisco |
|---|---|---|
| SNMP antes | ✅ já respondia (`public`) | ❌ **nenhuma linha de `snmp-server`** |
| ação | nenhuma | habilitado **RO** + ACL 55 |

No Cisco:
```
access-list 55 permit 172.20.11.20      (NOC)
access-list 55 permit 10.35.28.0 0.0.0.255
access-list 55 permit 172.17.13.44      (ZABBIX)  <-- faltou na 1a vez
snmp-server community public RO 55
```

⚠️ **ERRO MEU, e o sintoma foi claro:** criei a ACL sem o **IP do Zabbix**. Resultado: `ICMP ping=1`
mas **`SNMP agent availability=0`** e só 4 itens com valor. Ao incluir `172.17.13.44`, a própria ACL
mostrou **10 matches imediatos** — o Zabbix já vinha tentando e sendo barrado. Saltou para **485**
itens com valor.

> **Regra: ACL de SNMP precisa liberar o COLETOR (Zabbix `172.17.13.44`), não só o NOC.**

### Zabbix

| host | id | template | itens com valor |
|---|---|---|---|
| `RGT0004-SW001-RAGNATELA-CPD1` | **10855** | Cisco IOS by SNMP (10218) | **485** |
| `RGT0005-SW002-RAGNATELA-CPD1` | **10856** | Network Generic Device by SNMP (10226) | **437** |

Grupo Zabbix `RAGNATELA` (22) · community por macro `{$SNMP_COMMUNITY}` · `zabbixHostId` gravado
nos dois devices do NOC.

---

## FASE 4 — FIREWALL DO PLANO DE CONTROLE E NAT DE SAÍDA (27/08, 16:30–16:55)

### O que já estava pronto (e não precisou de nada)
Ao ler as bordas antes de mexer, quase toda a fase **já estava feita desde 24/08**:

| item | CHR001 | CHR002 |
|---|---|---|
| `K8S-OK-1` — accept tcp `2379,2380,6443,10250` entre `K8S-CLUSTER` | ✅ pos. **[13]** | ✅ |
| `K8S-CLUSTER` contém a rede do nó 3 (`172.17.20.160/27`) | ✅ | ✅ |
| isolamento IA ↔ ATD (`K8S-ISOLA-1..6`) | ✅ | ✅ |
| `K8S-OK-2/3` — pods → PostgreSQL (5432) | ✅ | ✅ |
| NAT de saída `src-nat 172.17.20.0/24` → `185.100.215.99` via lista `WAN` | ✅ | ✅ |

⭐ Detalhe feliz de quem montou: o NAT usa **`to-addresses=185.100.215.99`**, que é um dos IPs que
**migram no failover** — o mascaramento sobrevive à troca de CHR. Se tivesse sido escolhido um dos
IPs presos à máquina (`.106`/`.107`), a saída morreria junto com a CHR.

### 🔴 O QUE FALTAVA — e o ping escondia

**Ping não valida caminho liberado.** A Fase 3 fechou com ICMP bidirecional e deu o voto como
alcançável. Testando **TCP nas portas reais** (escuta temporária de 30 s + tentativa de conexão):

```
ANTES:   nó2 → nó1  :6443 :2379   ABERTO      (mesma VLAN 30, nem passa pela RB)
         nó3 → nó1  :6443 :2379 :2380  BLOQUEADO
         nó1 → nó3  :6443 :2379 :2380  BLOQUEADO
```

**Causa:** na **RB5009 do XSE**, o chain `forward` tinha um `accept protocol=icmp` genérico na
posição **[38]** e **nenhuma regra para `172.17.20.x`**. O ICMP era aceito ali; o TCP seguia até o
`drop src=!ANTI-SPOOFING dst=!ANTI-SPOOFING` da posição [70] e morria. A Fase 3 criou regra de
**INPUT** na RB (tráfego *para* a RB), mas o tráfego entre nó 3 e cluster é **FORWARD** (atravessa
a RB) — essa faltou.

**Prova de que a CHR não era culpada:** o contador da `K8S-OK-1` na CHR001 marcava
`packets=10 bytes=600` — ela estava aceitando os SYNs. E o nó 3 **abria listener** de verdade
(`ss -ltnp` mostrou o `python3` em LISTEN na 6443), então "bloqueado" era caminho, não porta fechada.

### O que foi feito
Backup primeiro: `noc-antes-k8s-fase4-20260827.rsc` (125.184 bytes) na RB5009.

```
/ip firewall filter add chain=forward action=accept \
  src-address=172.17.20.160/27 dst-address=172.17.20.0/24 place-before=<drop ANTISPOOFING> \
  comment="K8S-OK-RB-1: no 3 (VLAN 35) -> cluster e bancos k8s ..."
/ip firewall filter add chain=forward action=accept \
  src-address=172.17.20.0/24 dst-address=172.17.20.160/27 place-before=<drop ANTISPOOFING> \
  comment="K8S-OK-RB-2: cluster e bancos k8s -> no 3 (VLAN 35). O sentido da volta"
```
Ficaram nas posições **[70] e [71]**, com o `drop` logo em seguida na [72].

⚠️ **Todos os protocolos, de propósito** (não só as 4 portas): o Kubernetes entre nós precisa de
muito mais que etcd/API/kubelet — encapsulamento do CNI (VXLAN 4789/UDP ou IPIP), BGP do Calico
(179), NodePort (30000-32767). Restringir aqui só criaria uma segunda caça ao fantasma adiante.
O **isolamento IA ↔ ATD continua intacto**: aquele tráfego passa pelas **CHRs**, que são as
gateways das VLANs 31-34 — a RB só é caminho da VLAN 35, então liberar aqui não fura nada.

### 🟢 Prova final — malha TCP completa entre os três nós
```
DEPOIS:  nó3 → nó1  :6443 ABERTO  :2379 ABERTO  :2380 ABERTO
         nó1 → nó3  :6443 ABERTO  :2379 ABERTO  :2380 ABERTO
         nó2 → nó1  :6443 ABERTO  :2379 ABERTO
         nó2 → nó3  :6443 ABERTO  :2379 ABERTO
```

⚠️ **Armadilha do próprio teste:** na primeira rodada o nó 2 apareceu BLOQUEADO em tudo — e antes
estava ABERTO. Não era regressão: as escutas duravam 30 s e o nó 2 era a **última** etapa da
sequência; elas já tinham expirado. Com escuta de 90 s aceitando várias conexões, deu ABERTO.
**Lição: teste com prazo curto em sequência longa produz falso negativo — e um falso negativo aqui
teria mandado a investigação para o lado errado.**

### Inventário dos nós (confirmado ao vivo)
| VM | nome | host | ens18 (gerência) | rede do k8s |
|---|---|---|---|---|
| 10601 | RGTK8S001 | RGTSRVHST001 | 172.17.10.41 | **172.17.20.4** |
| 10602 | RGTK8S002 | RGTSRVHST002 | 172.17.10.42 | **172.17.20.5** |
| 10605 | RGTK8S003 | **XSESRVHST001** | — | **172.17.20.162** (VLAN 35) |
| 10603 | RGTPSTGSQL001 | RGTSRVHST001 | 172.17.10.48 | 172.17.20.68 / .132 |
| 10604 | RGTPSTGSQL002 | RGTSRVHST002 | 172.17.10.49 | 172.17.20.69 / .133 |

**Também verificado:** firewall interno das VMs inativo (ufw `inactive`, iptables `-P INPUT ACCEPT`,
nftables vazio) e firewall do Proxmox sem política (`cluster.fw`/`host.fw`/`10605.fw` inexistentes),
apesar de `firewall=1` nas placas — ou seja, nenhum filtro escondido nessas camadas.

---

# FASE 6 — O CLUSTER KUBERNETES NO AR (27/08/2026, 16:55–17:40)

> **Resultado:** cluster **v1.31.14** com **três nós de plano de controle**, etcd com **quórum de 3**,
> rede de pods atravessando três VLANs e dois datacenters. Malha de conectividade **9/9**.

## 6.0 As decisões de arquitetura, e por que cada uma

Nenhuma delas estava escrita no plano — foram tomadas aqui, com medição antes.

### (a) Topologia: três planos de controle com etcd empilhado
O desenho pede **três votos**. Com etcd empilhado, cada nó carrega API server + etcd, e o quórum
de 3 tolera a perda de **um** nó inteiro (2 de 3 continuam decidindo). Perder dois derruba o
cluster — é a matemática do quórum, não uma limitação da instalação.

### (b) O endereço do plano de controle: balanceador LOCAL, não um VIP
Este foi o ponto mais delicado, porque os três nós **não estão no mesmo lugar**:

| nó | onde vive | rede |
|---|---|---|
| rgtk8s001 | RGTSRVHST001 (datacenter FLZ) | VLAN 30 |
| rgtk8s002 | RGTSRVHST002 (datacenter FLZ) | VLAN 30 |
| rgtk8s003 | **XSESRVHST001 (XSE)** | **VLAN 35**, atrás da RB5009 e de um túnel |

- Um **VIP de camada 2** (kube-vip em ARP) só existe dentro de um segmento — **não alcança o nó 3**.
- Um VIP preso à VLAN 30 morreria justamente quando sobrasse **só** o nó 3 — ou seja, falharia no
  caso que o HA existe para cobrir.

**Escolha:** um **HAProxy em cada nó**, ouvindo em `127.0.0.1:8443` e balanceando para os três
API servers com verificação de saúde. O endereço do cluster é
`k8sapi.ragnatela.local:8443`, resolvido para `127.0.0.1` pelo `/etc/hosts` de cada nó. Assim o
plano de controle **não depende de nenhum nó em particular** nem de um endereço que possa migrar.
Config em `/etc/haproxy/haproxy.cfg` (original preservado em `haproxy.cfg.original`).

### (c) Faixas de IP: escolhidas por medição, não por padrão
| faixa | uso | rotas existentes nas bordas | decisão |
|---|---|---|---|
| `10.244.0.0/16` | **pods** | **0** | ✅ adotada |
| `192.168.0.0/16` | padrão do Calico | **9** | ❌ **colidiria** |
| `172.16.0.0/16` | — | 18 | ❌ colidiria |
| `10.96.0.0/12` | **services** | 0 | ✅ adotada |

⚠️ Se tivéssemos aceitado o padrão do Calico (`192.168.0.0/16`), o cluster teria nascido em cima
de nove rotas em produção.

### (d) CNI: Calico com VXLAN
Os nós estão em **sub-redes roteadas diferentes** — sem encapsular, a rede de pods não atravessa o
roteamento. BGP desligado (não há sessão BGP com as bordas). NetworkPolicy fica disponível para o
isolamento IA ↔ atendimento no futuro.

### (e) IP do nó fixado à mão
`/etc/default/kubelet` com `--node-ip=<IP da VLAN do cluster>` em cada nó. **Sem isso o kubelet
escolheria o IP da rede de gerência (`ens18`)** e o cluster nasceria na VLAN errada — erro caríssimo
de desfazer depois que há carga em cima.

---

## 6.1 A sequência do que foi feito

| # | passo | observação |
|---|---|---|
| 1 | `conntrack`, `socat`, `ethtool`, `iptables` nos 3 nós | o preflight do kubeadm barrou por falta do `conntrack` — **falhou antes de tocar em nada**, nó permaneceu limpo |
| 2 | HAProxy + `/etc/hosts` nos 3 nós | validado: escutando em 8443, nome resolvendo |
| 3 | `kubeadm config images pull` | adianta o download e revela problema de rede cedo |
| 4 | `kubeadm init` no nó 1 | `--control-plane-endpoint`, `--upload-certs`, CIDRs medidos, SANs com os 3 IPs |
| 5 | Calico via operador Tigera v3.29.1 | `Installation` com `mtu: 1300`, `encapsulation: VXLAN` |
| 6 | join do nó 3 | entrou de primeira |
| 7 | join do nó 2 | **falhou duas vezes** — ver 6.2 |
| 8 | ampliação do firewall entre nós | ver 6.3 |
| 9 | offload de checksum | **a causa mais difícil** — ver 6.4 |

---

## 6.2 🔴 PRIMEIRO PROBLEMA — o join do nó 2 morria ao baixar os certificados

**Sintoma:** `error downloading the secret: ... request canceled while reading body`. Sempre no
mesmo ponto: ao **ler o corpo** da resposta. Conexão abria, requisição pequena passava, resposta
grande morria no meio. O secret `kubeadm-certs` tem **14.808 bytes**.

**Ironia que vale registrar:** o nó **distante** (XSE, atrás do túnel) entrou de primeira, e o
**vizinho de VLAN** falhou. O motivo: o balanceador local do nó 2 distribui entre os três API
servers — quando caía no nó 3, a resposta grande atravessava o trecho estreito.

**Causa:** MTU heterogêneo. O caminho até o nó 3 comporta **1360 bytes** (medido por busca binária
com `ping -M do`), mas as placas do datacenter usam **quadro jumbo** e anunciavam segmentos que o
caminho não entrega.

**Correção — ajuste de MSS na borda**, aplicado nas **duas CHRs e na RB5009**:
```
/ip firewall mangle add chain=forward action=change-mss new-mss=1300 passthrough=yes \
  protocol=tcp tcp-flags=syn dst-address=172.17.20.160/27   (e o simétrico, src=)
```
**Cirúrgico de propósito:** só o tráfego de/para a rede do nó 3. O jumbo entre nó 1 e nó 2
continua intacto.

⚠️ **Determinação do dono (27/08), respeitada:** *as VMs em RGT001/RGT002 usam MTU **9000** e a do
XSE usa **1500***. Por isso a solução **não** foi uniformizar MTU, e sim tratar na borda — que é o
tratamento correto para travessia de túnel, e não desperdiça o jumbo do datacenter.

**Prova:** depois do ajuste, buscar o mesmo secret do nó 2 passou a funcionar pelos **três**
caminhos — contra o nó 1 (517 ms), contra o nó 3 (314 ms) e pelo balanceador local (314 ms). O
join então concluiu.

### ⚠️ Erro meu no meio do caminho, registrado para não se repetir
Para validar a hipótese de MTU montei um servidor HTTP na porta **8899** e conclui "buraco negro de
MTU confirmado" quando a transferência travou. **O teste era inválido:** a porta 8899 nunca esteve
liberada no firewall das CHRs. O `ss` mostrou a conexão em **`SYN-SENT`** e **nem 1 KB** passava —
se fosse MTU, o handshake completaria e a falha viria depois.
**Lição: teste de caminho tem de usar porta comprovadamente liberada; senão mede firewall e chama
de MTU.** A hipótese original estava certa — o instrumento é que estava errado.

---

## 6.3 🔴 SEGUNDO PROBLEMA — o Calico do nó 3 nunca ficava pronto

**Sintoma:** `calico-node` do nó 3 parado em `0/1 Running` por mais de 25 minutos, mesmo com o nó
`Ready`.

**Como apareceu:** no log do pod —
`Found ready Typha addresses ... 172.17.20.4:5473, 172.17.20.5:5473`. A porta **5473** (Typha)
**não estava liberada**: as CHRs só permitiam `2379,2380,6443,10250`.

**Correção:** a regra `K8S-OK-1` das duas CHRs passou a aceitar **todos os protocolos** entre nós
do cluster (`K8S-CLUSTER` ↔ `K8S-CLUSTER`, faixa dedicada `172.17.20.x`).

**Por que liberar tudo entre os nós é a decisão certa, e não preguiça:** o Kubernetes entre nós usa
muito mais que as quatro portas do plano de controle — **5473** (Typha), **4789/UDP** (VXLAN),
**30000-32767** (NodePort), sondas de saúde, e o que cada complemento futuro trouxer. Manter lista
de portas aqui só produz caça ao fantasma a cada componente novo. **O isolamento que importa
continua de pé:** as regras `K8S-ISOLA-1..6` seguem separando IA de atendimento, e elas atuam sobre
as VLANs 31-34, cujo gateway são as próprias CHRs.

---

## 6.4 🔴 TERCEIRO PROBLEMA — o mais difícil: ping funcionava, TCP nunca

**Sintoma, e por que enganava tanto:**
```
ping  pod(nó3) -> pod(nó1)  =  2 pacotes, 0% de perda, 17 ms   ✅
TCP   pod(nó3) -> pod(nó1):8080  =  NUNCA conecta               ❌
```
A porta estava comprovadamente escutando e o pod respondia a si mesmo (`http=200`).

**A investigação, passo a passo:**
1. Capturei no nó 1 na interface do túnel: **ICMP aparecia (4 pacotes, ida e volta), porta 8080
   aparecia ZERO vezes**.
2. Capturei no nó 3: o SYN **saía** normalmente (`vxlan.calico Out`, `mss 1260` — coerente com MTU
   1300), retransmitindo três vezes sem resposta.
3. Contei os pacotes VXLAN nas duas pontas: **466 enviados pelo nó 3, 482 recebidos pelo nó 1**.
   Ou seja, **o encapsulamento CHEGAVA** — e mesmo assim o TCP desencapsulado não existia no destino.
4. Suspeitei primeiro do que **eu** tinha mudado (as regras de MSS): desliguei as seis, testei,
   **não era**. Religuei.

**Causa raiz: `tx-checksum-ip-generic` ligado.** Com o offload de checksum ativo, os pacotes TCP
encapsulados em VXLAN saíam com **checksum inválido** e eram descartados na entrada do destino.
O ICMP escapava e mascarava tudo — daí o sintoma "a rede funciona, mas nada conecta".

Também apareceu uma **assimetria entre os hosts**: o nó 3 tinha `tx-udp_tnl-segmentation: on`,
enquanto o nó 1 tinha `off [fixed]` — placas configuradas de forma diferente nos dois hipervisores.

**Correção, permanente:** serviço `k8s-sem-offload.service` nos três nós, habilitado no boot:
```
ExecStart=/bin/sh -c 'for i in ens19 ens20 vxlan.calico; do
    /sbin/ethtool -K $i tx-checksum-ip-generic off 2>/dev/null || true; done'
```
⚠️ **Não remover.** Sem ele o cluster volta a quebrar no próximo reinício, **e o sintoma não aponta
para cá** — aponta para "a rede está boa, o ping passa". O próprio arquivo da unidade carrega essa
explicação, para quem abrir daqui a um ano.

---

## 6.5 🟢 Estado final, medido

```
NAME        STATUS   ROLES           VERSION    INTERNAL-IP
rgtk8s001   Ready    control-plane   v1.31.14   172.17.20.4
rgtk8s002   Ready    control-plane   v1.31.14   172.17.20.5
rgtk8s003   Ready    control-plane   v1.31.14   172.17.20.162
```

**etcd — quórum de 3, todos saudáveis:**
| endpoint | saúde | tempo |
|---|---|---|
| 172.17.20.4:2379 | true | 79 ms |
| 172.17.20.162:2379 | true | 95 ms |
| 172.17.20.5:2379 | true | 154 ms |

**Malha de rede de pods — 9 de 9** (cada pod chamando todos, inclusive ele mesmo), atravessando
VLAN 30 ↔ VLAN 35, dois datacenters e um túnel. **DNS interno** resolvendo (`kubernetes.default`
→ `10.96.0.1`).

**Calico aplicado:** `mtu=1300`, `encapsulation=VXLAN`, `cidr=10.244.0.0/16`.

---

## 6.6 O que fica para a próxima sessão

| # | item | observação |
|---|---|---|
| 1 | **Fase C — validação de failover** | por ordem do dono, *"por último do último"*. É o único passo que **prova** o HA: derrubar um nó de propósito e ver o cluster seguir com 2 de 3 |
| 2 | Remover o DaemonSet `teste-rede` | usado só para provar a malha |
| 3 | Acesso ao cluster a partir do NOC | hoje o `kubectl` só roda dentro dos nós; o endereço é `127.0.0.1:8443` em cada um |
| 4 | Ingress, storage class e o operador de banco | camada de aplicação, ainda não iniciada |
| 5 | Rever a permissão ampla entre nós | se um dia houver exigência de auditoria mais fina, listar portas *com* a lista completa dos componentes |

## 6.7 Onde estão as coisas
- **Diário (este arquivo):** `/ia/.claude/modulo-atendimento/06-DIARIO-EXECUCAO-KUBERNETES.md`
- **Log de saída do init:** `/root/kubeadm-init.log` no nó 1
- **Manifesto do Calico:** `/root/calico-ragnatela.yaml` no nó 1 (com os comentários do porquê)
- **kubeconfig:** `/etc/kubernetes/admin.conf` nos três nós (também em `/root/.kube/config`)
- **Backups das bordas:** `noc-antes-k8s-fase4-20260827.rsc` (RB5009),
  `noc-antes-k8s-27-20260827.rsc` (CHR001, CHR002, RB5009)
