# Ragnabot — Plataforma de Atendimento Omnichannel (Ragnatela IoT Solutions)

Plataforma de atendimento multi-tenant (SaaS) da Ragnatela, servida em
`chat002.ragnatela.com.br` e acoplada ao NOC (menu "Atendimento").

- **Base:** Chatwoot (open-source) com customizações Ragnatela
- **Canais:** WhatsApp **Cloud API oficial (Meta)**, Instagram Direct, Messenger,
  e-mail, Telegram e webchat
- **Infra:** Kubernetes (3 nós HA) · PostgreSQL 18 replicado · Redis · imagens no GHCR

## Documentação
O plano de execução (10 fases) e os diários de construção vivem na infraestrutura
do NOC (`/ia/.claude/modulo-atendimento/07-*.md` e `08-*.md`).

> ⚠️ **Nunca** commitar credenciais, tokens ou `.env` neste repositório.
