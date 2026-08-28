# 🏛️ ESTRUTURA DO RAGNABOT — como a plataforma é construída
> Documentação técnica de referência. NOC, 28/08/2026.
> Cluster **RAGNABOT**, grupo **RAGNATELA** no NOC. Aplicação: https://chat002.ragnatela.com.br

---

## 1. Visão geral

O Ragnabot é uma **plataforma de atendimento omnichannel multi-empresa (SaaS)**. A arquitetura
separa deliberadamente **quem processa** (Kubernetes, descartável) de **quem guarda** (banco de
dados, replicado). Essa separação é o que permite perder um servidor inteiro sem perder uma
conversa.

```
                            INTERNET
                               │ HTTPS (certificado Let's Encrypt)
                 ┌─────────────▼──────────────┐
                 │  PROXY REVERSO (nginx)     │  termina o TLS · cache de assets
                 │  XSEPRXRVS001              │  injeta o tema visual
                 └─────────────┬──────────────┘
                               │ distribui entre os 3 nós (se um cai, usa outro)
    ┌──────────────────────────▼───────────────────────────┐
    │           KUBERNETES — 3 nós, alta disponibilidade    │
    │  ┌───────────────┐ ┌───────────────┐ ┌─────────────┐ │
    │  │ RGTK8S001     │ │ RGTK8S002     │ │ RGTK8S003   │ │
    │  │ datacenter FLZ│ │ datacenter FLZ│ │ site XSE    │ │
    │  │ 172.17.20.4   │ │ 172.17.20.5   │ │ .162        │ │
    │  └───────────────┘ └───────────────┘ └─────────────┘ │
    │   aplicação (web) + trabalhador de filas (worker)     │
    └──────────────────────────┬───────────────────────────┘
                               │ rede dedicada de dados
        ┌──────────────────────▼──────────────────────┐
        │  RGTPSTGSQL001 (PRIMÁRIO) 172.17.20.132     │
        │  PostgreSQL 18 · Redis                      │
        └──────────────────────┬──────────────────────┘
                               │ replicação contínua (streaming)
        ┌──────────────────────▼──────────────────────┐
        │  RGTPSTGSQL002 (RÉPLICA) 172.17.20.133      │
        │  PostgreSQL 18 (somente leitura) · Redis    │
        └─────────────────────────────────────────────┘
```

## 2. Os servidores (o que cada um faz)

| Servidor | Onde vive | Endereço | Função |
|---|---|---|---|
| **RGTK8S001** | RGTSRVHST001 | 172.17.20.4 | Nó do Kubernetes; hoje roda a aplicação e o trabalhador |
| **RGTK8S002** | RGTSRVHST002 | 172.17.20.5 | Nó do Kubernetes |
| **RGTK8S003** | **XSESRVHST001** | 172.17.20.162 | Nó do Kubernetes — fica em **outro site**, é o 3º voto |
| **RGTPSTGSQL001** | RGTSRVHST001 | 172.17.20.132 | **Banco primário** (escrita) + Redis primário |
| **RGTPSTGSQL002** | RGTSRVHST002 | 172.17.20.133 | **Réplica** (leitura) + Redis réplica |

> Por que o terceiro nó fica em outro site: se os dois nós do datacenter caírem juntos (queda de
> energia, incidente local), o terceiro continua de pé. É ele que impede o "empate" na decisão.

## 3. Alta disponibilidade — como funciona na prática

### 3.1 A camada que processa (Kubernetes)
- Os 3 nós são **iguais em poder de decisão** (todos são plano de controle).
- O "cérebro" do cluster é o **etcd**, com **3 membros**. Decisões exigem **maioria (2 de 3)**.
- **Perder 1 nó:** o cluster continua funcionando normalmente. Os programas que rodavam nele são
  recriados nos outros.
- **Perder 2 nós:** o cluster **para de aceitar mudanças** (não há maioria). É a matemática do
  quórum, não uma limitação da instalação.
- O proxy distribui as visitas entre os 3 nós e **pula automaticamente** o que não responder.

### 3.2 A camada que guarda (PostgreSQL)
- **Um** servidor é o primário: só ele aceita escrita.
- O outro é **réplica**: recebe tudo o que o primário grava, continuamente (*streaming
  replication*), e serve para leitura.
- Atraso medido hoje: **praticamente zero** (a réplica aplica o que recebe imediatamente).
- Uma **vaga de replicação** (slot) garante que o primário guarde o histórico enquanto a réplica
  estiver desconectada, para ela conseguir alcançar depois.

### 3.3 Quem é o primário, e como se decide
- **Hoje a promoção é MANUAL e proposital.** Não existe eleição automática entre os dois bancos.
- Como o sistema sabe quem é quem: o servidor responde se está "em recuperação". Quem **não**
  está em recuperação é o **primário**. É assim que o painel do NOC identifica o papel — sem
  depender de configuração escrita em lugar nenhum, então nunca fica desatualizado.
- **Por que manual:** promoção automática exige um árbitro externo para evitar "cérebro dividido"
  (dois primários aceitando escrita ao mesmo tempo, o pior cenário possível para dados). Enquanto
  não há esse árbitro, **promover é decisão humana**, com o passo documentado no runbook.
- **Vigilância:** o painel alerta se houver **nenhum** primário ou **mais de um**.

## 4. Onde ficam as mídias (anexos das conversas)
- Hoje: **disco local do nó** onde a aplicação roda (volume `ragnabot-storage`, 20 GB).
- ⚠️ **Limite conhecido e assumido:** por ser disco local, a aplicação e o trabalhador ficam
  **presos ao mesmo nó**, e a perda desse nó levaria as mídias junto. O banco **não** é afetado
  (é replicado).
- **Evolução planejada:** mover anexos para armazenamento de objetos (S3). Isso solta a aplicação
  do nó e permite que ela rode nos três ao mesmo tempo. *(Adiado por decisão do dono para depois
  do piloto.)*

## 5. Espaço em disco
| Servidor | Total | Livre | Uso |
|---|---|---|---|
| Banco primário | 196 GB | ~180 GB | 4% |
| Banco réplica | 196 GB | ~180 GB | 4% |
| Nós do Kubernetes | 117 GB cada | — | folga confortável |

O banco da plataforma ocupa hoje **19 MB** (instalação nova). O painel alerta a partir de **85%**
de uso e avisa sobre **vagas de replicação inativas**, que é a causa clássica de disco cheio
inesperado (a vaga segura histórico indefinidamente se ninguém consome).

## 6. Atualização da plataforma
- A versão em uso é **fixada por digest** (a "impressão digital" exata da versão), não pela
  etiqueta `latest`. Isso impede que um simples reinício traga uma versão nova sem querer —
  o que poderia alterar o banco de dados de forma irreversível.
- **Versão fixada hoje:** `chatwoot/chatwoot@sha256:18f280a6…` (Chatwoot 4.17.1).
- **Para atualizar de propósito** (runbook): fazer cópia de segurança → descobrir o digest da
  versão nova → rodar a preparação do banco → trocar a imagem → acompanhar. Se algo der errado,
  voltar para o digest anterior (anotado antes).
- O painel do NOC **avisa** se a versão deixar de estar fixada.

## 7. O que o painel do cluster mostra (NOC → grupo RAGNATELA → RAGNABOT)
| Bloco | Conteúdo |
|---|---|
| Kubernetes | nós prontos / total · membros do etcd · programas no ar · versão fixada |
| Bancos | **quem é o primário** · réplica em dia · atraso real · vagas inativas · tamanho |
| Espaço | total, livre e percentual em cada servidor de banco |
| Redis | papel de cada um (primário/réplica) |
| Alertas | lista objetiva do que precisa de atenção — vazio = tudo certo |

### Como o painel evita alarme falso
O atraso da réplica é medido **por posição de dados**, não por "tempo desde a última transação".
Num banco parado, a segunda medida cresce sozinha e acusaria horas de atraso com a replicação
perfeita — falso positivo real, detectado e corrigido em 28/08. Se o que a réplica recebeu já foi
aplicado, ela está **em dia**, ponto.

## 8. Endereços técnicos (referência rápida)
- Aplicação: `https://chat002.ragnatela.com.br`
- Painel do cluster (API): `GET /api/ragnabot-cluster/health` e `/servidores` (admin)
- Rede dedicada do cluster: `172.17.20.0/24` · nós `.4 .5 .162` · bancos `.132 .133`
- Repositório: `ragnatelaiot/ragnabot` (manifestos, tema, documentação)
