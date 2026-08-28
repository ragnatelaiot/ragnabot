# Marca e tema do Ragnabot

## Estado atual
- **Marca aplicada sem rebuild** (via `InstallationConfig` do Chatwoot 4.17.1): nome "Ragnabot",
  URLs da Ragnatela, e logomarca SVG (3 variantes em `design/marca/`).
- **Persistencia:** ConfigMap `ragnabot-branding` (`deploy/branding/`) montado por subPath.

## Para o tema COMPLETO (cor primaria + login "noite de vidro" do design aprovado)
Exige **imagem custom** (build do frontend do Chatwoot com a paleta e o login do `design/`),
publicada no **GHCR** (`ghcr.io/ragnatelaiot/ragnabot`). Pre-requisito: token `write:packages`.
Enquanto nao houver, a marca (nome/logo/favicon/URLs) esta aplicada sobre o layout padrao.

## Multi-tenant (SaaS)
A marca do PRODUTO (Ragnabot) e global. Cada empresa cliente e uma **Account** isolada; o
white-label por tenant (logo/cor da empresa) entra na fase SaaS.
