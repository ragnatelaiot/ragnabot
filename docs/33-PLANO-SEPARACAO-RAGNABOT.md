# 🏗️ 33 — PLANO DE SEPARAÇÃO: TUDO DO RAGNABOT NO ECOSSISTEMA DO RAGNABOT

> **Ordem do dono (30/08/2026):** *"execute agora fazendo um plano onde tudo, absolutamente tudo
> deve rodar no ecossistema do RAGNABOT"* — depois de ele próprio identificar o problema:
> *"o Ragnabot tem alguma dependência de funcionamento com o NOC? porque não deveria"*.

## 0. O diagnóstico, medido em 30/08

**A plataforma é independente; o que construímos por cima, não.**

| Peça | Onde roda hoje | Independente do NOC? |
|---|---|---|
| Chatwoot (web, worker) | Kubernetes, 3 nós | ✅ sim |
| Banco, fila e anexos da plataforma | Patroni · Sentinel · MinIO | ✅ sim |
| **Motor de fluxo, portaria, relógios** | processo `noc-agent` | ❌ **não** |
| **40 tabelas do Ragnabot** | banco `ragnatela_noc` | ❌ **não** |
| **SaaS, protocolo, auditoria, cobrança** | processo `noc-agent` | ❌ **não** |
| **Telas (editor de fluxo)** | frontend do NOC | ❌ **não** |

**Consequência:** o NOC cai → o chatbot para de responder, os relógios param, o protocolo não é
emitido e o webhook da plataforma bate em porta fechada. Só o atendimento humano sobrevive.

**Incoerência de versionamento, também apontada pelo dono:** numeramos `VERSAO` do Ragnabot num
repositório que **não contém o código do produto**. A versão aponta para código que mora em outro
lugar.

### Por que ficou assim
Não foi decisão de arquitetura — foi inércia. Nasceu como "uma funcionalidade do NOC" e virou
produto sem que a fronteira fosse redesenhada.

### A boa notícia: o acoplamento é FINO
Medido — os 18 serviços e 10 rotas do Ragnabot importam do NOC apenas:

| Importado | Usos | O que é |
|---|---|---|
| `database/client.js` | 21 | o cliente Prisma |
| `utils/logger.js` | 13 | o registrador de log |
| `utils/crypto.js` | 3 | cifrar/decifrar segredo |
| `services/audit.service.js` | 5 | auditoria do NOC |

**Quatro peças.** Nenhuma regra de negócio do NOC está entranhada no Ragnabot. Isso é o que torna a
separação uma **mudança de casa**, não uma reescrita.

---

## 1. O desenho de destino

```
┌───────────────────────────── ECOSSISTEMA RAGNABOT (Kubernetes) ─────────────────────────────┐
│                                                                                              │
│   ragnabot-web ×2        ragnabot-worker ×1        ⭐ ragnabot-motor ×2  (NOVO)              │
│   (Chatwoot)             (filas do Chatwoot)          motor de fluxo · portaria · relógios   │
│                                                       SaaS · protocolo · auditoria           │
│                                                       API própria + webhook                  │
│                                                                                              │
│   banco: Patroni  ──►  base `chatwoot`  +  ⭐ base `ragnabot` (NOVA, 40 tabelas)             │
│   fila: Redis Sentinel        anexos: MinIO                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                                     │  só LEITURA e OPERAÇÃO (nunca no caminho da conversa)
┌────────────────────────────────────┴─────────────────────────────────────────────────────────┐
│  NOC — monitora, opera e mostra. Se cair, o Ragnabot continua atendendo.                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**A regra que decide qualquer dúvida:** se a peça participa de **atender um cliente**, ela é do
Ragnabot. Se ela apenas **observa ou administra**, pode ficar no NOC.

---

## 2. As quatro peças a substituir (a "camada de base" do Ragnabot)

| Hoje (NOC) | No Ragnabot |
|---|---|
| `database/client.js` | cliente Prisma próprio, apontando para a base `ragnabot` |
| `utils/logger.js` | registrador próprio (mesmo formato, para o NOC continuar lendo) |
| `utils/crypto.js` | **cópia idêntica** — ⚠️ o algoritmo e a chave têm de ser os mesmos, senão o que já está cifrado no banco não abre |
| `audit.service.js` | a auditoria do Ragnabot (`ragnabot-auditoria.service.js`) já existe e é dele |

⚠️ **A cifragem é o ponto delicado da migração.** Senhas e tokens guardados cifrados só abrem com a
mesma chave. A chave viaja para o `Secret` do Kubernetes **antes** de qualquer dado migrar, e isso
é conferido com um decifra-de-teste antes de seguir.

---

## 3. Etapas, na ordem, com o risco de cada uma

### Etapa 1 — REPOSITÓRIO (risco: nenhum; nada em produção muda)
O código do produto passa a morar em `ragnatelaiot/ragnabot`, como aplicação de verdade:
`package.json` próprio · `prisma/schema.prisma` só com os 40 modelos · os 18 serviços · as 10 rotas
· os 14 testes · a camada de base (§2) · `Dockerfile` · manifesto do `ragnabot-motor`.
**O NOC continua rodando exatamente como está.** Nada é removido dele nesta etapa.
✅ Ao fim: `VERSAO` do Ragnabot passa a apontar para o código do Ragnabot — a incoerência morre.

### Etapa 2 — BANCO (risco: médio; é onde mora o dado)
Criar a base `ragnabot` no cluster Patroni (o mesmo que já serve a plataforma — mesma alta
disponibilidade, sem máquina nova). Aplicar as 40 tabelas pelo SQL já versionado
(`prisma/sql/**`), **incluindo as 3 chaves compostas** que isolam empresas.
Copiar os dados (hoje: 1 empresa, 0 fluxos — **a janela mais barata que vamos ter**).
⚠️ Conferir a cifragem ANTES: decifrar um segredo conhecido do lado novo.

### Etapa 3 — PROCESSO (risco: médio; é a virada)
Subir o `ragnabot-motor` no Kubernetes (2 réplicas, um por hipervisor, como o resto).
Ele passa a: receber o webhook da plataforma · rodar o trabalhador de atendimento (60s) · rodar o
consumidor do despertar (15s) · executar o motor de fluxo · servir a API própria.
**Virada:** o webhook da plataforma passa a apontar para o serviço novo; os trabalhadores são
desligados no NOC **na mesma janela** — nunca os dois rodando, senão dois relógios agem na mesma
conversa.

### Etapa 4 — TELAS (risco: baixo)
O editor de fluxo e as telas de administração passam a ser servidos pelo Ragnabot. Enquanto não
forem, o NOC continua servindo — mas falando com a **API do Ragnabot**, não com o banco dele.

### Etapa 5 — LIMPEZA (risco: baixo, mas irreversível)
Remover do NOC os serviços, rotas, modelos e testes do Ragnabot. **Só depois** de o novo estar
atendendo e com backup validado. O NOC guarda apenas o que é dele: o painel do cluster, os alertas
e o acesso operacional.

---

## 4. O que o NOC MANTÉM, de propósito

- **Monitoramento** do cluster do Ragnabot (a tela que já existe).
- **Alertas** para o WhatsApp quando algo degrada.
- **Backup** do banco para o cofre imutável — backup é vigilância externa; feito por quem é vigiado
  vale menos.
- **Acesso operacional** (SSH, `kubectl`) para consertar.

Nada disso está no caminho de atender um cliente. É a fronteira correta.

---

## 5. Como saber que deu certo

O teste é único e honesto: **desligar o `noc-agent` e mandar uma mensagem para o número do
Ragnabot.** O chatbot tem de responder, o relógio tem de correr, o protocolo tem de ser emitido.
Hoje esse teste falha — e é ele que define o fim da migração.

---

## 6. O que continua fora do nosso alcance

Nenhuma caixa de WhatsApp existe. A migração pode ser feita e provada com o motor e os relógios,
mas a prova final — mensagem real chegando — depende de a Meta liberar o número.
