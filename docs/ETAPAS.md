# ✅ RAGNABOT — O QUE ESTÁ PRONTO E O QUE FALTA (mapa de etapas)
> Documento de controle. Atualizado em 27/08/2026 (noite). Fonte da ordem: `09-BLUEPRINT-EXECUCAO-RAGNABOT.md`.
> Legenda: ✅ pronto · 🔧 em execução · ⏳ depende do dono · ⬜ a fazer

---

## ETAPA 0 — Fundação (CONCLUÍDA)
| # | item | estado |
|---|---|---|
| 0.1 | Cluster Kubernetes 3 nós HA (etcd quórum 3) | ✅ |
| 0.2 | PostgreSQL 18 replicado (lag 4,5 ms) + Redis réplica | ✅ |
| 0.3 | Domínio `chat002.ragnatela.com.br` + TLS + WebSocket | ✅ |
| 0.4 | Chatwoot 4.17.1 no ar, conta 1, signup fechado, PT-BR | ✅ |
| 0.5 | Repositório `ragnatelaiot/ragnabot` + docs + ACTIONLOG | ✅ |

## ETAPA 1 — Aparência (EM CURSO)
| # | item | estado |
|---|---|---|
| 1.1 | Marca: nome "Ragnabot", logomarca SVG (3 variantes), URLs | ✅ |
| 1.2 | Logos persistidos (ConfigMap — sobrevivem a deploy) | ✅ |
| 1.3 | **Tema visual**: azul do Chatwoot → verde Ragnatela em TODO o app | ✅ |
| 1.4 | **Login "noite de vidro"**: gradiente, teia de hexágonos, aurora animada, cartão de vidro, botão verde, campos escuros, responsivo | ✅ |
| 1.5 | Favicon Ragnabot + `theme-color` verde | ✅ |
| 1.6 | Lentidão do login corrigida (cache + puma) | ✅ |
| 1.7 | Descrição/meta em inglês → PT-BR | ⬜ |
| 1.8 | Ícones PNG (apple-touch/android) com a marca | ⬜ |
| 1.9 | **Dashboards e cards de indicadores** (padrão painel-NOC, só admin) | ⬜ |
| 1.10 | Validação visual em navegador real (360/768/1440) pelo agente | ⬜ |

> ⚙️ **Como o tema foi feito:** CSS injetado pelo proxy (`sub_filter`), **fora** da imagem.
> Vantagem: sobrevive a upgrade do Chatwoot e reverte em segundos. O token GHCR fica guardado
> para quando quisermos ir além do que CSS alcança (ex.: reordenar componentes).

## ETAPA 2 — Produção/segurança (P0 do blueprint)
| # | item | estado |
|---|---|---|
| 2.1 | **Backup WORM (S3 Object Lock) dos bancos** — hoje RPO = ∞ para erro lógico | ⬜ CRÍTICO |
| 2.2 | WAL archiving / PITR | ⬜ CRÍTICO |
| 2.3 | **Zabbix nas VMs 10603/10604** (replicação, lag, disco) — hoje quebra é invisível | ⬜ CRÍTICO |
| 2.4 | **Pin da imagem por digest** (hoje `:latest` = upgrade silencioso possível) | ⬜ ALTA |
| 2.5 | Anexos para S3 (hoje PVC local: perda do nó = perda de mídia; anula HA) | ⬜ ALTA |
| 2.6 | Fechar NodePort :30080/:30443 (hoje alcançável além do proxy) | ⬜ ALTA |
| 2.7 | Ensaio de promoção do standby (failover PG) | ⬜ |
| 2.8 | Fase C do k8s: derrubar um nó com a plataforma no ar | ⬜ |
| 2.9 | Trilha de auditoria por ação de atendente | ⬜ |
| 2.10 | Runbook + capítulo chat002 no DR | ⬜ |

## ETAPA 3 — Funcional (prova de que atende)
| # | item | estado |
|---|---|---|
| 3.1 | SMTP de sistema (usar o do NOC) | ⬜ |
| 3.2 | **Criação de usuário no padrão NOC**: e-mail → senha → 2FA (QR + e-mail) | ⬜ |
| 3.3 | Export dos superadmins com chaves de 2FA (usuário gestor) | ⬜ |
| 3.4 | Inbox webchat + 2 atendentes + times + ciclo completo de atendimento | ⬜ |
| 3.5 | **Teste de isolamento multi-tenant** (bloqueia tenant real) | ⬜ |

## ETAPA 4 — Canais (⏳ depende da Meta)
| # | item | estado |
|---|---|---|
| 4.1 | Verificar número por **ligação de voz** | ⏳ DONO |
| 4.2 | Registrar na **Cloud API** (migra ON_PREMISE→CLOUD) | ⏳ DONO |
| 4.3 | Submeter **display name** | ⏳ DONO |
| 4.4 | Webhook + assinar app na WABA + inbox WhatsApp | ⬜ (nosso, após 4.1-4.3) |
| 4.5 | Templates HSM | ⬜ |
| 4.6 | Telegram · E-mail · Instagram · Messenger | ⬜ |
| 4.7 | **Multiconexão por empresa** (várias inboxes por conta) | ⬜ |

## ETAPA 5 — SaaS
| # | item | estado |
|---|---|---|
| 5.1 | Provisionamento de tenant a partir do NOC (1 ação) | ⬜ |
| 5.2 | Planos e limites (agentes/canais/mensagens) + medição | ⬜ |
| 5.3 | **Cobrança recorrente + integração Efibank** (liberação automática) | ⬜ |
| 5.4 | White-label por empresa cliente | ⬜ |
| 5.5 | LGPD: termos, DPA, retenção | ⬜ ⏳ jurídico |

## ETAPA 6 — Integração com o NOC
| # | item | estado |
|---|---|---|
| 6.1 | Menu "Atendimento" no NOC + SSO | ⬜ (dono já criou o menu) |
| 6.2 | Painel-resumo no NOC (filas, espera) | ⬜ |
| 6.3 | Alertas da plataforma no fluxo WhatsApp do NOC | ⬜ |
| 6.4 | **Cluster "ragnabot"** no grupo Ragnatela do NOC | ⬜ |

## ETAPA 7 — Documentação
| # | item | estado |
|---|---|---|
| 7.1 | Diários de execução (06 k8s, 08 chat002) + ACTIONLOG | ✅ |
| 7.2 | Blueprint mestre (09) — 700 linhas | ✅ |
| 7.3 | **MD da estrutura**: Kubernetes, bancos, mídias, HA, eleição de primário | ⬜ |
| 7.4 | **Manual por menu** (para o usuário final, integrável ao sistema) | ⬜ |

---

## 🔑 O que depende de VOCÊ (fila curta)
1. **Meta — 2 passos** (itens 4.1 e 4.2): verificar por ligação de voz e registrar na Cloud API.
   É o que trava TODOS os canais. Os demais itens andam sem isso.
2. **Efibank**: credenciais/conta para a integração de cobrança (item 5.3).
3. **Janela de deploy do NOC** (sem sessão RDP/console) para o item 6.1.

## 🎯 Próximos passos meus (nesta ordem)
1. Etapa 2.1–2.4 (backup WORM, Zabbix, pin) — protege o que já existe
2. Etapa 3.1–3.3 (SMTP, criação de usuário com 2FA, export superadmin)
3. Etapa 1.7–1.9 (PT-BR nos metas, ícones, dashboards)
4. Etapa 6.4 (cluster ragnabot no NOC) e Etapa 7.3–7.4 (documentação e manual)
