# 📊 RAGNABOT — PAINEL DE FASES: o que já foi feito e o que falta
> Documento de controle geral. Atualizado em **28/08/2026 (madrugada)**.
> Complementa o `10-ETAPAS-RAGNABOT.md` (detalhe por item) com a visão de fases.
> Legenda: ✅ concluída · 🔧 em execução agora · ⏳ depende do dono · ⬜ a fazer · ⏸️ adiada por decisão

---

## PARTE 1 — FASES JÁ CONCLUÍDAS ✅

### Fase 0 — Decisão e plano *(27/08)*
Plano de 10 fases aprovado · base **Chatwoot** escolhida (API oficial + omnichannel + multi-tenant
nativos) · registro **GHCR** · repositório `ragnatelaiot/ragnabot` criado com chave de escrita.
📄 `07-PLANO-PLATAFORMA-ATENDIMENTO.md`

### Fase 1 — Fundação de dados *(27/08)*
PostgreSQL 18 primário (172.17.20.132) → réplica (.133) com replicação contínua · Redis
primário/réplica · pgvector · firewall liberado para os nós.
**Achado grande:** buraco de MTU (placas 9100 num caminho de 9000) — ping passava e transferência
grande morria calada. Corrigido; vazão saltou para **1,04 GB/s**.

### Fase 2 — Encanamento *(27/08)*
`ingress-nginx` com porta fixa nos 3 nós · StorageClass · **vhost `chat002` + certificado**
Let's Encrypt · firewall proxy→nós nas 2 CHRs e na RB5009.
**Achado:** `chat002` estava também num vhost de estacionamento — nome duplicado sequestrava o
desafio do certificado.

### Fase 3 — Aplicação no ar *(27/08)*
Chatwoot 4.17.1 rodando · conta "Ragnatela IoT Solutions" · cadastro público fechado · PT-BR ·
**`https://chat002.ragnatela.com.br` responde 200**.

### Fase 4 — Desempenho da entrada *(27/08)*
Login estava lento: o navegador rebaixava ~800 KB a cada acesso e o servidor entregava estático a
~40 KB/s. Corrigido com cache imutável + cache no proxy + mais processos.
**1º acesso paga uma vez; os demais: 0,008 s.**

### Fase 5 — Identidade visual *(27–28/08)*
Marca (nome, logomarca, favicon, descrição em PT-BR) · **tema v1 reprovado pelo dono** ·
**tema v2 no ar**: paleta correta do produto (a mesma aprovada do painel do cliente), entrada em
duas colunas com foto real, e revestimento do aplicativo inteiro pelas variáveis de cor.
📄 `design/v2/` no repositório + `GUIA-FRONTEND.md`

### Fase 6 — Cluster RAGNABOT no NOC *(28/08)*
5 servidores cadastrados no grupo RAGNATELA · serviço de saúde ao vivo (quem é o primário, réplica
em dia, espaço, pods, etcd, versão) · **zero alertas**.
**Dois achados:** imagem sem fixação (corrigido: **fixada por digest**) e um falso positivo de
"6 h de atraso" na réplica (era banco ocioso; passou a medir por posição de dados).
📄 `11-ESTRUTURA-RAGNABOT.md`

### Fase 7 — Documentação viva *(27–28/08)*
Diários de execução · blueprint de 700 linhas revisado adversarialmente · mapa de etapas ·
estrutura técnica · registro de ações — tudo versionado no repositório.

---

## PARTE 2 — EM EXECUÇÃO AGORA 🔧

| Fase | O que está sendo produzido | Quem |
|---|---|---|
| **8 — Acesso** | E-mail de convite, criação de senha e **2FA (QR + e-mail)** no padrão do NOC, usando o SMTP que já temos | agente |
| **9 — Painel do cluster no NOC** | A tela visual que consome o serviço já pronto | agente |
| **10 — Manual do usuário** | Manual por menu, função a função, para virar a ajuda embutida | agente |
| **11 — Cobrança** | Planos recorrentes + integração **Efibank** (liberação automática) | agente |
| **12 — SaaS** | Provisionamento de empresa em uma ação, **multiconexão** por empresa e **teste de isolamento** | agente |
| **13 — Engenharia reversa do chat atual** | Levantar TODAS as funções do sistema de hoje e decidir, uma a uma: **levar, adaptar ou descartar** | agente |

---

## PARTE 3 — O QUE FALTA ⬜

### Depende do dono ⏳
| # | Item | Trava o quê |
|---|---|---|
| 1 | **Meta:** verificar o número por ligação de voz e registrar na Cloud API | **todos os canais** |
| 2 | Credenciais do **Efibank** | cobrança automática |
| 3 | Preços dos planos | proposta comercial |
| 4 | Janela sem sessão ativa (para reiniciar o NOC) | painel do cluster e menu no NOC |

### Nossa fila
| # | Item | Observação |
|---|---|---|
| 5 | Canais: WhatsApp oficial → Telegram → e-mail → Instagram/Messenger | 4 e 5 dependem do item 1 |
| 6 | Menu "Atendimento" no NOC + entrada sem digitar senha de novo | precisa da janela |
| 7 | Indicadores dentro do produto real (hoje existem como mockup) | após o tema estabilizar |
| 8 | Percorrer as telas internas com o tema aplicado | preciso de acesso ou do dono conferindo |
| 9 | Ícones da marca (formatos que o navegador pede) | acabamento |
| 10 | **Documentação final em DOCX** | consolida todos os MD ao fim |

### Adiado por decisão do dono ⏸️
Cópia de segurança dos bancos, recuperação em ponto no tempo, ensaio de troca de primário e
teste de queda de nó — **retomar depois do piloto**. *(Zabbix já instalado nas VMs de banco.)*

---

## PARTE 4 — LINHA DO TEMPO

```
27/08  ├─ Fase 0  decisão e plano
       ├─ Fase 1  bancos replicados        ← achado: MTU
       ├─ Fase 2  domínio, certificado     ← achado: nome duplicado
       ├─ Fase 3  APLICAÇÃO NO AR ✅
       ├─ Fase 4  entrada rápida
       └─ Fase 5  identidade (v1 reprovado)
28/08  ├─ Fase 5  identidade v2 NO AR ✅
       ├─ Fase 6  cluster no NOC ✅        ← achados: digest + falso positivo
       ├─ Fase 7  documentação ✅
       └─ Fases 8-13 em produção paralela 🔧
```

## PARTE 5 — ONDE ESTÁ CADA DOCUMENTO
| Documento | Conteúdo |
|---|---|
| `07-PLANO-PLATAFORMA-ATENDIMENTO.md` | o plano original de 10 fases |
| `09-BLUEPRINT-EXECUCAO-RAGNABOT.md` | passos corrigidos por revisão adversarial |
| `10-ETAPAS-RAGNABOT.md` | mapa detalhado item a item |
| `11-ESTRUTURA-RAGNABOT.md` | como a plataforma é construída |
| `18-LEVANTAMENTO-CHAT-ATUAL.md` | *(em produção)* funções do sistema de hoje |
| `19-COMPARATIVO-E-BACKLOG-RAGNABOT.md` | *(em produção)* levar / adaptar / descartar |
| `20-PAINEL-DE-FASES.md` | **este documento** |
| `docs/` no repositório | espelho versionado (ACTIONLOG, ESTRUTURA, ETAPAS) |

> 📘 **Ao final, tudo isto vira a documentação em DOCX** — os MD são a fonte; o DOCX, a entrega.
