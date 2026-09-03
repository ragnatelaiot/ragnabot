# 35 — PLANO DETALHADO DE EXECUÇÃO
> Escrito em 02/09/2026 a pedido do dono: *"registra tudo e monta um plano detalhado de execução
> de tudo, só me pergunte o que precisa realmente, pode seguir o máximo que der com as melhores
> práticas sem me perguntar nada"*.
>
> O **doc 34** diz O QUE construir e por quê (10 fases, 90+ itens, tudo medido).
> **Este doc diz EM QUE ORDEM, COM QUE CRITÉRIO DE ACEITE e QUANDO PARA PERGUNTAR.**
> Fonte de verdade da execução: quando um item for entregue, marca-se aqui.

---

## 0. AS LEIS QUE VALEM EM TODO SPRINT

Não são recomendações — são as regras da casa, cada uma paga com incidente:

| Lei | O que significa aqui |
|---|---|
| **Medir antes de construir** | metade do que parecia faltar já existia. Todo item começa com uma medição de 10 min |
| **Nunca segredo no git** | chave da OpenAI, token da Meta, credencial de provedor → Secret do k8s, nunca no repositório |
| **Nunca `prisma db push`** | migração versionada, sempre. O banco é Patroni com réplica |
| **Deploy só sem sessão ativa** | conferir antes de qualquer rollout; ler a saída, nunca encadear com `&&` |
| **Jamais reiniciar host Proxmox** | vale para toda automação que este plano criar |
| **Isolamento é do servidor** | esconder botão não é segurança. Todo item de visibilidade tem teste de API |
| **Versão + manual + backup** | toda entrega: `VERSAO`, `VERSOES.md`, `MANUAL.md` e backup depois de validada |
| **Lote de rebuilds** | acumular durante o sprint, **um** build/versão/deploy no fim |

---

## 1. O GRAFO DE DEPENDÊNCIA (o que trava o quê)

```
 F10.1 roteador ──┬─► F1.3 respostas rápidas (tela)
 (painel único)   ├─► F4.6 lista de agendamentos
                  ├─► F9.2.3 tela de conexões
                  └─► toda tela nova daqui pra frente        ◄── GARGALO Nº 1

 F10.3 sessão única ─► F10.4 entrada pelo menu ─► adoção real do que já existe

 F2.4 setor no modelo ─┬─► F2.2 conversa só do agente
                       ├─► F2.3 resolvidos por agente
                       └─► F2.7 etiquetas no cartão

 Análise do App (Meta) ─┬─► F3.9 botões por canal
                        ├─► F9.2.1 Embedded Signup
                        └─► F9.3 templates (HSM)

 F9.2.2 camada de provedor ─► independe da decisão A/B/C  ◄── construir já
```

📌 **Dois gargalos, e os dois são nossos** (não dependem de terceiro): o **roteador** e o
**setor no modelo de dados**. Tudo o que é caro e demorado está atrás deles.

---

## 2. OS SPRINTS

### S1 — DESTRAVAR (F1, F10.1-10.4) 🔴
**Por que primeiro:** o construtor de fluxo existe e o dono nunca o usou porque não há caminho
até ele. É o maior retorno por esforço do plano inteiro.

| Entrega | Aceite (testável) |
|---|---|
| Roteador na interface do motor | 3 rotas navegáveis; recarregar em `/fluxos` cai em `/fluxos`, não em erro |
| Casca com menu lateral | menu mostra apenas o que o papel do usuário pode ver |
| Sessão única painel → motor | logado no painel, abrir o motor **não** pede senha |
| Item de menu para o construtor | o dono chega ao construtor sem digitar URL |
| Tela de respostas rápidas | criar atalho pessoal e global; **o backend já existe**, é só tela |
| Atalho `/` na conversa | digitar `/atalho` insere o texto |

**Risco:** a sessão única cruza dois sistemas de autenticação. Se der mais de meio dia, entrega-se
o item de menu (10.4) sozinho — ele já resolve 80% da dor — e a sessão única vira S2.

### S2 — ISOLAMENTO E SETOR (F2.2, 2.3, 2.4, 2.7, 2.8) 🔴
**Por que segundo:** é segurança, e mexe no modelo de dados. Quanto mais tarde, mais caro.

| Entrega | Aceite (testável) |
|---|---|
| Setor no modelo de conversa | migração versionada; histórico por setor, não global |
| Conversa aberta só do agente | ⚠️ **teste obrigatório**: agente A pedindo a conversa de B **pela API** recebe recusa |
| Resolvidos: admin vê tudo, agente vê os dele | mesmo teste, pela API |
| Etiquetas caixa · setor · atendente no cartão | visível na fila sem abrir a conversa |
| Abas Abertas/Resolvidos/Grupos/Filtros + contadores | contador bate com a consulta |

### S3 — TESTADOR DE FLUXO + NÓS QUE FALTAM (F3.1-3.8) 🟠
Pedido explícito do dono, e o que torna o construtor utilizável de verdade.
| Entrega | Aceite |
|---|---|
| Testador (simulador de conversa no editor) | percorre um fluxo real de ponta a ponta sem enviar mensagem a ninguém |
| Nós: Pergunta · Atendente · Sub-fluxo · Randomizador · Notificação · Etiqueta | cada nó com teste de motor |
| Estatística por saída no canvas | `RagnabotFluxoNoMetricaDia` **já grava** apresentados/respondidos/CTR — é só desenhar |

### S4 — AGENDAMENTO (F4) 🟠
Construção do zero. Modelo + serviço + trabalhador + tela.
**Aceite:** agendamento único e recorrente disparam no horário, com multi-contato, anexo, opção de
abrir ticket, e registro do resultado (enviado/falhou/motivo).
⚠️ O trabalhador não pode disparar duas vezes se o pod reiniciar — **idempotência por carimbo**,
igual à lição do alerta de backup do CRCMA.

### S5 — CAPITÃO ADAPTADO (2.C.1-2.C.7) 🟠
Decisão do dono: adotar, não construir.
| Entrega | Aceite |
|---|---|
| Fronteira fluxo × IA escrita e implementada | cliente **nunca** recebe duas respostas |
| Base de conhecimento por empresa | empresa A não vê documento da empresa B |
| Teto de consumo por conta + medição de custo | custo por atendimento medido antes de abrir a todos |
| Nó "passar ao agente de IA" no construtor | |
⛔ **A chave da OpenAI fica desligada** até o dono decidir a questão de licença (edição paga).

### S6 — CONEXÕES E PROVEDOR (F9.2.2-9.2.7, F9.4) 🟠
| Entrega | Aceite |
|---|---|
| Camada de provedor (`meta_direto`/`whatsmeow`/`terceiro`) | trocar o provedor de um canal não reescreve o motor |
| Tela de Conexões (cartão, estado, desconectar, editar) | paridade com a tela 40 |
| Transferir tickets entre conexões | trocar de número sem perder histórico |
| API pública por empresa + webhook de saída assinado | HMAC-SHA256 + `Bearer`; reentrega com recuo |

### S7 — CONFIGURAÇÕES (F8) 🟡
As 13 telas do menu Configurações. Whitelabel/Empresas/Planos **só na conta que vende o SaaS**.
**Aceite:** conta de cliente que peça esses painéis **pela API** recebe recusa (não é só menu escondido).

### S8 — CANAIS OFICIAIS (F3.9, F9.2.1, F9.3) ⏳
Preso à Análise do App da Meta. **Templates (F9.3) pode começar antes** — a exigência é da Meta,
vale em qualquer caminho.

### S9 — AUTOMAÇÃO POR CAIXA (F6) e FLUXOS (F7) 🟢
Quase tudo pronto no motor (`RagnabotAtendPolitica` é mais rico que o do chat atual). É tela.

### S10 — MARCA E MIÚDOS (F5) 🟢
"Desenvolvido por Ragnatela IoT Solutions" no widget; empresa e versão no rodapé.
⛔ Na interface própria — **nunca** injetando script no painel do fornecedor.

---

## 3. O QUE EU FAÇO SEM PERGUNTAR

Autorizado pelo dono em 02/09: S1, S2, S3, S4, S6, S7, S9, S10 e a parte técnica do S5.
Toda entrega segue: medir → implementar → teste automatizado → acumular → **um** build no fim →
conferir sessão ativa → deploy → versão/manual → backup → registro no log de ações.

## 4. O QUE **PRECISA** DE VOCÊ (curto, de propósito)

| # | Decisão | Por que só você decide | Trava o quê |
|---|---|---|---|
| 1 | **Como o cliente liga o WhatsApp dele**: A oficial · B Whatsmeow · C intermediário (minha recomendação: **A como produto, B como entrada, C nunca**) | modelo de negócio e risco de banimento | S6 vira produto; **não** trava o código |
| 2 | **Licença da edição paga** para usar o Captain | jurídico/comercial | ✅ **construção liberada em 02/09** — o código fica pronto e a chave DESLIGADA; a licença só trava o dia de ligar |
| 3 | **HubSoft é usado?** | integração que ninguém usa é dívida de graça | um item do S7 |
| 4 | ~~Provedores de pagamento~~ → ✅ **RESPONDIDO 02/09: só Efí Bank** (doc 36). Restam duas escolhas de negócio: a conta é da Ragnatela ou de cada cliente? Só Pix ou também boleto/cartão? | modelo de recebimento | detalhe do S-Efí, não trava o código |

Nada disso trava o começo. **S1 e S2 já estão liberados e começam agora.**

---

## 5. PLACAR
| Sprint | Estado |
|---|---|
| S1 destravar | 🔄 em execução |
| S2 isolamento e setor | ⏳ |
| S3 testador e nós | ⏳ |
| S4 agendamento | ⏳ |
| S5 Capitão | 🔄 em execução (chave desligada por decisão) |
| S6 conexões e provedor | ⏳ |
| S-Efí pagamento | 🔄 em execução (doc 36) |
| S7 configurações | ✅ código pronto · **62 medições (40 do serviço + 22 pela API, com servidor de verdade no ar)** · migração **não aplicada** e **não publicado** (lote do chefe) |
| S8 canais oficiais | ⛔ preso à Meta |
| S9 automação por caixa | ⏳ |
| S10 marca | ⏳ |
