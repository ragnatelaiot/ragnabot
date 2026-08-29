# 🗺️ 32 — PLANO DE EXECUÇÃO DO RAGNABOT (a partir do chat atual)

> **De onde vem.** Varredura dos menus **Administração**, **Gestão** e **Ajustes** do chat atual
> (whaticket **4.7.2**, API 1.0.5), medida em **29/08/2026** pela API do app (login admin do dono,
> só leitura). Cada submenu abaixo foi **confirmado batendo no endpoint real** — o que não respondeu
> está marcado. Objetivo: virar isto num **plano de execução** do Ragnabot, implementando a
> *funcionalidade*, não a cópia.
>
> **Achados de contexto medidos:**
> - **10 empresas** cadastradas na origem (`/companies` = 10).
> - **528 contatos**, **9 agendamentos**, **2 campanhas**, **9 etiquetas**, **4 planos**.
> - Os **tickets vêm cifrados em trânsito** (`encryptedDataSegury`) — o fornecedor embaralha o corpo
>   da resposta. É por isso que a semântica interna sempre foi difícil de ler direto; a leitura da
>   *estrutura* (endpoints acima) é o caminho limpo.
> - **Segredos em texto puro** na origem (senha SMTP = senha de login do dono; chave OpenAI) — ver
>   doc 31 §10. Não replicar esse erro.

---

## Legenda de estado no Ragnabot
✅ pronto · 🔧 falta ligar/completar (base existe) · ⬜ não construído (decidir se entra) · ❌ não usar

---

## 1. Menu ADMINISTRAÇÃO

| Submenu | Endpoint medido | O que faz na origem | Ragnabot |
|---|---|---|---|
| **Conexões** | `/whatsapp` (2) | Canais de WhatsApp + **todas as automações por conexão** (inatividade, relógios de "aguardando", expira-ticket, fluxo do 1º "oi") | ✅ política de atendimento + porta do Chatwoot; 🔧 ligar `openWaiting`/`closeWaiting`/`moveQueue` |
| **Filas & Chatbot** | `/queue` (4) | Setores (Suporte, Comercial, Outros, AGUARDANDO), cada um com cor, saudação, msg fora-de-hora e **horário por dia** | ✅ times/caixas no Chatwoot + expediente nativo (superior: janela, não dia) |
| **Usuários** | `/users` (23) | Atendentes, perfis (admin/adminSetor/user), **turno** (startWork/endWork), páginas de acesso, filas ligadas | ✅ papéis; 🔧 **turno por atendente** (medido: é usado — doc 31 §3) |
| **Prompts (OpenAI)** | `/prompt` (0) | Prompts de IA por fila | ⬜ decidir integração de IA nativa |
| **Integrações** | `/queueIntegration` (2) | Typebot + n8n por fila (`jsonContent`, `urlN8N`, `typebotSlug`) | 🔧 **substituído pelo nosso motor de fluxo** (doc 28) — não recriar dependência externa |
| **Empresas** | `/companies` (10) | Gestão multiempresa (nome, telefone, documento, vencimento, status, whitelabel) | ✅ SaaS multiempresa (provisionamento, planos) |
| **Planos** | `/plans` (4) | Planos com **feature flags** (canais e módulos ligados) | ✅ planos/cobrança |
| **Informativos** | `/announcements` (1) | Avisos/novidades para os usuários (título, texto, prioridade, mídia) | 🔧 casa com o nosso **VERSOES.md**/novidades |
| **Financeiro** | `/invoices` (0) | Faturas/assinatura | ✅ cobrança (efibank) |
| **Configurações** | `/settings` (23) | O menu Ajustes (ver §3) | ✅/🔧 conforme a chave |

---

## 2. Menu GESTÃO

| Submenu | Endpoint medido | O que faz | Ragnabot |
|---|---|---|---|
| **Dashboard** | `/dashboard` (7 atendentes) | Painel: por atendente, nº de tickets, **tempo médio de atendimento**, avaliação, online/offline | 🔧 painel de métricas por atendente — **construir** |
| **Contatos** | `/contacts` (528) | Agenda: nome, número, e-mail, **canal**, aniversário, `disableBot`, `acceptAudioMessage`, grupo | ✅ nativo do Chatwoot (contatos) |
| **Etiquetas (Tags)** | `/tags` (9) | Marcadores de conversa, com **cor**, **Kanban**, `kanbanMessage`, `webhookUrl`, `syncWhatsApp` | ✅ labels nativos; 🔧 Kanban e webhook por etiqueta |
| **Agendamentos** | `/schedules` (9) | Mensagem programada (corpo, `sendAt`, **recorrência**, mídia, contato/ticket) | 🔧 **construir** (o plano liga `useSchedules`) |
| **Campanhas** | `/campaigns` (2) | Disparo em massa (lista de contatos, conexão, **fluxo**, agendamento, confirmação, status do ticket) | 🔧 **construir** (o plano liga `useCampaigns`) |
| **Listas de contatos** | `/contact-lists` (1) | Público-alvo das campanhas | 🔧 junto de campanhas |
| **Respostas rápidas** | `/quick-messages` (0) | Atalhos de texto do atendente | 🔧 **construir** (barato, alto uso no dia a dia) |
| **Kanban** | via `/tags` + `/tickets` | Quadro de tickets por etiqueta | 🔧 depende de etiquetas+Kanban |
| **Chat interno** | (plano `useInternalChat`) | Conversa entre atendentes | 🔧 **construir** (nativo do Chatwoot tem equivalente) |
| **Ajuda** | `/helps` (0) | Central de ajuda embutida | ⬜ opcional (temos o manual) |

---

## 3. Menu AJUSTES / CONFIGURAÇÕES (`/settings`, 23 chaves)

| Chave medida | Valor hoje | Decide | Ragnabot |
|---|---|---|---|
| `scheduleType` | `company` | expediente por empresa/fila/desligado | ✅ escopo empresa/caixa/time |
| `sendMsgTransfTicket` | `disabled` | avisar cliente ao transferir | 🔧 opção no ato da transferência |
| `sendGreetingAccepted` | `disabled` | saudação ao aceitar o ticket | 🔧 mensagem automática |
| `userRating` / `userRatingList` | `disabled` | **avaliação (CSAT)** | ⬜ decidir |
| `requireTicketCloseReason` + categorias | `disabled` | **motivo de encerramento** | ⬜ casa com auditoria |
| `historyMessages` | `queue` | escopo do histórico visível | 🔧 política de visão |
| `CheckMsgIsGroup` | `disabled` | ignorar grupos | 🔧 filtro de entrada |
| `showClosedTickets` | `true` | mostrar fechados na busca | ✅ |
| `acceptCallWhatsapp` + `noCallMessage` | `disabled` + texto | recusar chamada com aviso | 🔧 recurso do canal |
| `autoCorrectEnabled` | `enabled` | corretor do texto do atendente | ⬜ cosmético |
| `smtp*` | skymail:465 | SMTP do sistema | ✅ já temos |
| `selectedModel` | `gpt-4o-mini` | modelo de IA | ✅ decidimos nós |
| `trial` | `3` | dias de teste | ✅ SaaS |
| segredos (`*secret*`, `openAiApiKey`) | — | credenciais | ⚠️ ver doc 31 §10 (trocar/rotacionar) |

---

## 4. CANAIS E MÓDULOS DO PLANO — o escopo de produto

Medido em `/plans` (o plano `ESPECIAL-RAGNA`): o que a origem entrega hoje.

**Ligados (temos de cobrir):**
`useWhatsapp` · `useOficialAPI` (Meta) · **`useFacebook`** · **`useInstagram`** · `useCampaigns` ·
`useSchedules` · `useInternalChat` · `useExternalApi` · `useTickHub` · `useTypebot`/`useN8n` (→ nosso
motor) · `useChatGPT`/`useConnectAi` · `useBotoes` · `useStorage`.

**Desligados (fora do escopo mínimo):**
`useAgenda` · `useAgenteIA` · `useMetaAds` · `useLeadExtractor` · `useScheduleAutomation` ·
`useAssinaturaEletronica` · `useConnectzapVoip`.

> **Facebook e Instagram já estão pagos e ligados** no plano da origem, e são **nativos do nosso
> Chatwoot** — ligar, não construir.

---

## 5. O PLANO DE EXECUÇÃO — por onde ir, na ordem

### Etapa A — fechar o núcleo já construído (o pedido original do dono)
1. **Resolvedor de entrada** (fluxo do primeiro "oi") — destrava o motor já pronto. Barato.
2. **Publicação de fluxo** (`ragnabot-fluxo-publicacao.service.js`) — ⚠️ a assinatura da estrutura
   tem de **ignorar `no.ui`**, senão arrastar bloco órfã conversas em curso.
3. **Ligar `openWaiting`/`closeWaiting`/`moveQueue`** no trabalhador (campos já no schema).
4. **Consumidor da ação `notificar`** (a fila do relógio).
5. **Registrar a transferência** em `RagnabotAtendTransferencia` + opção de avisar o cliente.

### Etapa B — criar a primeira caixa e ligar os canais pagos
6. **Primeira caixa de WhatsApp** (hoje há zero) — sem ela nada é exercitado com conversa real.
7. **Instagram Direct** e **Facebook Messenger** (nativos do Chatwoot).
8. **Botões/listas interativas** como nó do motor de fluxo.

### Etapa C — os módulos de Gestão que faltam
9. **Respostas rápidas** (barato, alto uso).
10. **Etiquetas com Kanban** + webhook por etiqueta.
11. **Agendamento de mensagens** (recorrência).
12. **Campanhas** + listas de contato.
13. **Dashboard por atendente** (tickets, tempo médio, avaliação).
14. **Chat interno** entre atendentes.

### Etapa D — turno e configurações opinativas
15. **Turno por atendente** (`RagnabotAtendTurno`) — liberado (medição provou uso).
16. Decidir: **CSAT**, **motivo de encerramento**, **ignorar grupos**, **recusar chamada**.

### Etapa E — segurança e higiene
17. Provisionar as **10 empresas** da origem no SaaS (quando migrar).
18. **Novidades in-app** alimentado pelo `VERSOES.md`.
19. Trocar/rotacionar os **segredos** da origem (doc 31 §10) antes de qualquer integração.

---

## 6. Resumo em uma página

- **Administração** = Conexões (automações ✅), Filas/Chatbot (✅), Usuários+turno (🔧), Empresas/
  Planos/Financeiro (✅ SaaS), Integrações externas (🔧 → nosso motor).
- **Gestão** = Contatos (✅), Etiquetas (🔧 Kanban), Agendamentos/Campanhas/Respostas rápidas/Chat
  interno/Dashboard (🔧 **construir**).
- **Ajustes** = 23 chaves; a maioria já coberta, algumas a decidir (CSAT, motivo de encerramento).
- **Canais Facebook e Instagram** já pagos e nativos — ligar.
- **A ordem** está na §5: fechar o núcleo → criar a 1ª caixa e ligar canais → módulos de Gestão →
  turno/opinativos → segurança.
- Cada entrega vira uma **versão nova** em `VERSOES.md` (começamos em **v1.00.00**).
