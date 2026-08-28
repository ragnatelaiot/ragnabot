# ⚖️ 19 — COMPARATIVO E BACKLOG DO RAGNABOT
### O que levar do sistema atual, o que adaptar e o que descartar — função por função

> Escrito em 28/08/2026, a partir da medição registrada em `18-LEVANTAMENTO-CHAT-ATUAL.md`.
> **Destino:** Ragnabot — Chatwoot 4.17.1 multi-tenant, WhatsApp pela **API oficial da Meta**,
> omnichannel. **Origem:** ConnectAi/Whaticket 8.1.1 na VM 10016 (WhatsApp **não** oficial).
> Padrão visual das propostas de tela: `/ia/ragnabot-frontend-v2/GUIA-FRONTEND.md`.

---

## 0. Como cada veredito foi decidido

Três perguntas, nesta ordem. A primeira que responde "não" encerra o caso.

1. **A operação real usa?** Se a tabela está vazia depois de 14 meses e 10 empresas, a função não
   é requisito — é vitrine do fornecedor. O ônus da prova é de quem quer levar.
2. **Sobrevive ao canal oficial?** Metade das funções mais chamativas só existe porque o WhatsApp
   é acessado por biblioteca não oficial. Levá-las seria reconstruir a dependência que o dono
   mandou abandonar.
3. **O destino já faz?** Se o Chatwoot já resolve — ainda que com outro nome ou outro caminho —
   o trabalho é de **configuração e manual**, não de engenharia.

**Legenda de esforço** (para nós, já com o Ragnabot de pé):
**baixo** = até ~2 dias · **médio** = ~1 a 2 semanas · **alto** = mais de 2 semanas, ou depende
de terceiro / de decisão do dono.

---

## 1. A tabela de decisão

### 1.1 Atendimento — o núcleo

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| Caixa de atendimento em 3 colunas (lista · conversa · ficha) | ✅ *Conversations* | **ADAPTAR** | É a mesma tela. Muda o nome (*Caixa de entrada*) e a densidade visual, já resolvida no tema | baixo |
| Filas / Setores | ✅ *Teams* + regras de atribuição | **ADAPTAR** | Time do Chatwoot = Setor. Atribuição automática por time é nativa | baixo |
| Abas Aguardando / Atendendo / Resolvido | ✅ *Open / Pending / Resolved* + *Snoozed* | **ADAPTAR** | Correspondência direta; "Adiar" (*snooze*) é um ganho que não existe hoje | baixo |
| Filtro por canal, setor, tag, não lidas | ✅ filtros + *segmentos salvos* | **ADAPTAR** | Chatwoot salva o filtro como visão reutilizável — melhor que o atual | baixo |
| Busca **dentro das mensagens** | ✅ busca global | **ADAPTAR** | Nativa | baixo |
| Transferir para usuário **e** setor | ✅ atribuir a agente / a time | **ADAPTAR** | Nativo | baixo |
| Transferir para **outra conexão** | ⚠️ não | **DESCARTAR** | No desenho oficial a conversa pertence à caixa de entrada (número). Mover entre números quebra a janela de 24 h e o histórico de consentimento | — |
| Nota interna | ✅ *Private note* | **ADAPTAR** | Nativa, e o tema já a torna inconfundível (§4.3 do guia) | baixo |
| Respostas rápidas por atalho | ✅ *Canned responses* | **ADAPTAR** | Nativa. Migrar as **39** existentes | baixo |
| Permissão "quem pode **editar** resposta rápida" | ❌ | **LEVAR** | Regra que a operação usa (`editQuickMessages` por usuário). No Ragnabot vira permissão do papel | baixo |
| Anexos e gravação de áudio | ✅ | **ADAPTAR** | Nativo | baixo |
| **Ouvir o áudio antes de enviar** | ❌ | **LEVAR** | Detalhe pequeno de altíssimo valor para o atendente; evita reenvio e constrangimento | baixo |
| **Ditado por voz** (falar para escrever) | ❌ | **LEVAR** | Ganho real de velocidade; é API do navegador, custo baixo | baixo |
| Assinatura do atendente na mensagem | ✅ *Agent signature* (por caixa/por agente) | **ADAPTAR** | Nativa | baixo |
| Variáveis na mensagem (`{{contactName}}`, `{{greeting}}`…) | ✅ variáveis de mensagem | **ADAPTAR** | Nativas; faltam duas (abaixo) | baixo |
| **`{{protocolNumber}}` — número de protocolo** | ❌ | **LEVAR** | Exigência de operação séria e de cliente corporativo: o cliente precisa de um número para citar. Hoje existe e é usado nas mensagens | médio |
| Arquivar / fixar / marcar como não lida | ⚠️ parcial (*snooze* e *unread* sim; **fixar** não) | **LEVAR** (só "fixar") | Fixar conversa é organização do atendente, barato de fazer e sentido falta na hora | baixo |
| **Exportar conversa em PDF** | ❌ | **LEVAR** | Pedido recorrente de cliente e de jurídico. Encaixa no que já sabemos fazer (o NOC já gera PDF com marca d'água) | médio |
| Encaminhar mensagens | ✅ | **ADAPTAR** | Nativo | baixo |
| Menção `@` em grupo, inclusive "Todos" | ❌ (e grupos não existem na API oficial) | **DESCARTAR** | Depende de grupo de WhatsApp, que a Cloud API não atende | — |
| Aviso "alcance temporariamente limitado" | ⚠️ diferente | **ADAPTAR** | O equivalente oficial é a **janela de 24 h** e o limite de qualidade do número. Deve virar aviso claro na tela, com a mesma clareza da mensagem atual | médio |
| Observações do contato | ✅ *Contact notes* | **ADAPTAR** | Nativas | baixo |
| Ocultar atendimentos de chatbot para certos usuários | ⚠️ via filtro/atribuição | **ADAPTAR** | Resolve-se com bot atribuindo só ao final; se não bastar, vira filtro salvo | baixo |
| Expediente do atendente (`startWork`/`endWork`) | ❌ | **LEVAR** | Não distribuir conversa para quem não está em turno é regra básica de operação com escala | médio |

### 1.2 Automação e chatbot

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| **Editor visual de fluxo** (16 tipos de nó, 35 fluxos em uso) | ❌ **não existe** | **LEVAR** ⭐ | É o maior buraco da migração e a função mais usada depois do próprio atendimento. Sem ele a migração não acontece | **alto** |
| Nós: texto, mídia, espera, pergunta-com-variável, condição, sub-fluxo | ❌ | **LEVAR** | Parte do item acima | (incluso) |
| Nó "encaminhar para setor" | ❌ (existe como *ação de automação*) | **LEVAR** | Parte do item acima | (incluso) |
| Nó **lista interativa** e **botões** | ⚠️ a Cloud API tem *interactive list* e *reply buttons* | **LEVAR (adaptado)** | Os 10.966 envios de lista provam que é essencial. Na API oficial existe, com limites diferentes (máx. 3 botões, 10 itens de lista) — o editor precisa conhecer o limite e avisar | (incluso) |
| Nó **chamada HTTP** | ⚠️ via *webhook* de saída, não dentro do fluxo | **LEVAR** | É como o fluxo consulta o ERP no meio do atendimento. Sem isso o bot vira só menu | (incluso) |
| Nó **aplicar/remover tag** | ✅ como ação de automação | **LEVAR** | Parte do editor; a ação em si já existe | (incluso) |
| Nó **notificar um número** | ⚠️ o Chatwoot notifica por e-mail | **LEVAR** | Aviso por WhatsApp para o gestor é o que a operação usa hoje | (incluso) |
| Nó "encerrar ticket + pedir avaliação" | ✅ CSAT ao resolver | **ADAPTAR** | Nativo | baixo |
| Palavras-chave que disparam fluxo | ✅ condição "conteúdo contém" | **ADAPTAR** | Nativo nas regras de automação | baixo |
| Horário próprio do fluxo + mensagem fora de expediente | ✅ *Business hours* por caixa + mensagem de ausência | **ADAPTAR** | Nativo, e melhor: fica por canal, não escondido no fluxo | baixo |
| **Modo de teste do fluxo com número de teste** | ❌ | **LEVAR** | Publicar bot sem testar é como fazer deploy sem *staging*. Barato e evita incidente com cliente | médio |
| Chatbot por opção de fila (menu numérico antigo) | — | **DESCARTAR** | `QueueOptions` = **0 registros**. Já morto no próprio sistema de origem | — |
| Regras "quando X, faça Y" | ✅ *Automation rules* | **ADAPTAR** | Nativas, e mais completas que o que existe hoje | baixo |
| Macros (várias ações em um clique) | ✅ *Macros* | **ADAPTAR** | Nativo — ganho que o sistema atual não tem | baixo |
| Typebot / n8n / Dialogflow por conexão | ⚠️ Dialogflow e *Agent Bots* nativos; n8n por webhook | **ADAPTAR** | 1 projeto cadastrado, **0 conexões com a chave ligada**. Cobrir com webhook + *Agent Bot* | baixo |
| Central de Notificações (avisa por WhatsApp quando há N pendentes / espera > X) | ❌ | **LEVAR** | É supervisão de SLA de verdade e casa com a cultura do NOC (alerta no WhatsApp). Tabela vazia hoje, mas o requisito é legítimo e o Ragnabot é SaaS vendido a quem precisa disso | médio |
| Controle de Tickets (encerramento em lote com janela e horário de pico) | ⚠️ *auto-resolve após N dias* é nativo | **ADAPTAR** | O nativo cobre 90 % do caso. Janela e horário de pico só se aparecer demanda | baixo |
| Automação de agendamento (`ScheduleAutomations`) | — | **DESCARTAR** | 0 registros | — |
| Agente Pro (IA com RAG e ferramentas) | ⚠️ *Captain* (IA do Chatwoot 4.x) | **ADAPTAR** | 0 registros de uso. Avaliar o Captain antes de construir qualquer coisa. **Não determinado:** se o Captain está habilitado nesta imagem | médio |
| LLM Proxy (roteador de provedores com medição) | ❌ | **DESCARTAR** | 0 registros. E nós já temos decisão própria de IA no plano do módulo de atendimento | — |
| Console pessoal / bots pessoais | ❌ | **DESCARTAR** | 0 registros | — |

### 1.3 Contatos, organização e vendas

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| Contatos com campos extras livres | ✅ *Custom attributes* | **ADAPTAR** | Nativo e melhor (tipado, filtrável) | baixo |
| Campos empresa / CNPJ / endereço | ✅ como atributos personalizados | **ADAPTAR** | Configuração | baixo |
| Data de nascimento + mensagem de aniversário | ⚠️ campo sim, automação de aniversário não | **LEVAR** | `Contacts.birthDate` e `lastBirthdayMessageYear` existem no atual. É gancho comercial que os clientes pedem | médio |
| Importar / exportar contatos | ✅ CSV | **ADAPTAR** | Nativo | baixo |
| Tags | ✅ *Labels* | **ADAPTAR** | Nativas. Migrar as 77 e as 1.631 marcações | baixo |
| **Kanban por tag** (colunas = tags) | ❌ | **LEVAR** | 17 tags já são coluna; é como as equipes enxergam a fila de trabalho. **A forma certa no Ragnabot é uma visão de quadro sobre as etiquetas**, não um módulo novo de dados | médio |
| Kanban Pro (quadros com colunas próprias) | ❌ | **DESCARTAR** | 0 registros. Se o Kanban por etiqueta atender, não há caso | — |
| Funil de vendas (etapas, motivo de perda) | ❌ | **DESCARTAR** (rever depois) | 0 registros em 14 meses. É produto de CRM, não de atendimento. Reavaliar só com pedido de cliente pagante | — |
| Vendas / `TicketSale` | ❌ | **DESCARTAR** | Tabela vazia; a tela existe mas nunca registrou uma venda | — |
| Quadros de tarefas (Trello interno) | ❌ | **DESCARTAR** | 0 registros em 17 tabelas | — |
| Lista de tarefas (`/todolist`) | ❌ | **DESCARTAR** | `Tasks` = 0 | — |
| **Carteira de clientes** (contato/atendimento com dono fixo) | ⚠️ há atribuição, não há vínculo permanente | **LEVAR** | É como se faz atendimento consultivo e de conta-chave: o cliente sempre cai com o mesmo responsável. 3 empresas com a página liberada; o conceito é forte e o Chatwoot não tem | médio |
| Lista negra de contatos | ❌ | **DESCARTAR** | 0 registros; e bloquear número é melhor resolvido no canal | — |
| Segmentos salvos de contato | ✅ nativo | **ADAPTAR** | Ganho que não existe hoje | baixo |

### 1.4 Campanhas e envio ativo

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| Campanha para lista de contatos | ✅ *Campanha pontual* | **ADAPTAR** | Nativa, com uma diferença dura: na API oficial **só sai template aprovado** | baixo |
| Campanha por **tag** (em vez de lista) | ⚠️ por *segmento/label* | **ADAPTAR** | Segmento salvo resolve | baixo |
| Templates HSM com editor de variáveis | ✅ | **ADAPTAR** | Nativo no canal WhatsApp Cloud | baixo |
| Até 10 mensagens com **randomização** | ❌ | **DESCARTAR** | Randomizar texto é técnica **anti-bloqueio** de canal não oficial. Na API oficial o template é aprovado e imutável — randomizar é impossível e desnecessário | — |
| Mensagens de confirmação (até 5) | ⚠️ | **DESCARTAR** | Mesma origem: contorno de canal não oficial | — |
| Intervalo entre disparos / `CampaignSettings` | ✅ o Chatwoot respeita o limite do canal | **ADAPTAR** | Deixar de ser problema do operador é um ganho | baixo |
| **Modo híbrido** (template oficial + canal paralelo com *fallback*) | ❌ | **DESCARTAR** | É explicitamente o contrário da decisão do dono: metade do tráfego sairia por canal não oficial | — |
| Modo de disparo "**Fluxo**" (a campanha inicia um fluxo) | ❌ | **LEVAR** | Casa com o editor de fluxo (item ⭐). Campanha que abre conversa e entrega ao bot é o padrão moderno de ativação | médio |
| Modo de disparo "Agente IA" | ⚠️ depende do Captain | **DESCARTAR por ora** | Sem uso real; reavaliar quando a decisão de IA estiver fechada | — |
| **Campanha contínua no chat do site** | ✅ nativa no Chatwoot | **ADAPTAR** | **Ganho puro**: não existe no sistema atual | baixo |
| Extrator de leads (varredura de sites) | ❌ | **DESCARTAR** | 0 registros; e prospecção por raspagem tem risco de LGPD que não queremos vender | — |
| Tele Mensagens (ligação com áudio pré-gravado) | ❌ | **DESCARTAR** | 0 registros; depende de VoIP do fornecedor; e ligação automatizada é terreno regulatório escorregadio | — |
| Disparo e agendamento de **e-mail** | ⚠️ o Chatwoot tem **canal** de e-mail, não disparo em massa | **DESCARTAR** | 4 registros. Marketing por e-mail é outro produto; não misturar com atendimento | — |
| **Agendamento de mensagem individual** (527 registros) | ❌ | **LEVAR** ⭐ | Segunda função mais usada da lista de "não existe no destino". O atendente combina o retorno e programa. Na API oficial exige atenção à janela de 24 h — se estourar, sai como template | médio |
| Recorrência do agendamento | ❌ | **LEVAR** | Vem junto do item acima | (incluso) |
| Publicar **Status do WhatsApp** pelo agendador | ❌ | **DESCARTAR** | Status não existe na Cloud API. Puramente dependente do canal não oficial | — |

### 1.5 Qualidade, relatórios e supervisão

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| Dashboard operacional (aguardando, online, TMA, TME) | ✅ *Reports overview* | **ADAPTAR** | Nativo; o Painel próprio já está desenhado no `dashboard.html` do tema | baixo |
| Painel de Atendimento ao vivo por atendente | ✅ relatório de agentes + presença | **ADAPTAR** | Nativo | baixo |
| Relatórios por agente / caixa / etiqueta / time | ✅ | **ADAPTAR** | Nativo | baixo |
| Relatório de CSAT | ✅ | **ADAPTAR** | Nativo | baixo |
| **Relatório "sem retorno"** (quem não respondeu) | ❌ | **LEVAR** | Lista de dinheiro na mesa: contatos abandonados. Fácil de fazer sobre os dados que o Chatwoot já guarda | médio |
| Relatório por tag | ✅ *label report* | **ADAPTAR** | Nativo | baixo |
| Relatório de fechamentos (por motivo) | ⚠️ depende de tabulação | **LEVAR** | Vem junto da tabulação (§1.6) | (incluso) |
| Relatório de funil / de vendas / de ligações | ❌ | **DESCARTAR** | Dependem de funções descartadas | — |
| **Relatório gerado sob demanda em PDF/HTML**, com progresso e escolha do conteúdo | ⚠️ o Chatwoot exporta CSV | **LEVAR** | 11 relatórios gerados e é o formato que vai para reunião de cliente. O NOC já domina geração de PDF | médio |
| Relatório agendado por e-mail | ❌ | **LEVAR** (depois) | Fecha o ciclo do item acima; sem urgência | médio |
| **Avaliação (CSAT) por mensagem no WhatsApp** | ✅ CSAT nativo | **ADAPTAR** | Nativo | baixo |
| **Página web de avaliação personalizável** (logo, cores, agradecimento) | ❌ | **LEVAR** | Diferencial de marca branca e de SaaS: o cliente vê a **marca dele**, não a nossa. Já existe e funciona hoje | médio |
| Pedir **comentário** junto da nota | ✅ nativo | **ADAPTAR** | Nativo | baixo |
| **Tabulação/motivo de encerramento obrigatória** | ❌ | **LEVAR** | Requisito legítimo (todo NOC e toda cobrança querem). ⚠️ Registrar com honestidade: no sistema atual **está desligada em todas as 10 empresas** e os 502 registros são automáticos — ou seja, **o requisito nunca foi validado na prática**. Construir simples e medir adoção | médio |
| Logs de requisição (`/LogsPage`) | ⚠️ auditoria é recurso pago no Chatwoot | **LEVAR** | Já está no mapa de etapas (item 2.9). Auditoria é requisito de primeira classe da casa | médio |

### 1.6 Configuração, canais e administração

| função do sistema atual | existe no Chatwoot/Ragnabot? | veredito | por quê | esforço |
|---|---|---|---|---|
| Conexões com QR Code, pareamento, reconexão | — | **DESCARTAR** | Não existe QR na Cloud API. Some por definição | — |
| Mensagem de saudação / conclusão / despedida por conexão | ✅ mensagens da caixa + automação | **ADAPTAR** | Nativo | baixo |
| **Horário de atendimento** (por empresa e por setor) | ✅ *Business hours* por caixa de entrada | **ADAPTAR** | Nativo. ⚠️ **Diferença real:** hoje 4 empresas usam horário **por empresa** e cada setor tem o seu; no Chatwoot o horário é **da caixa**. Se a operação precisar de horário por time, é desenvolvimento | baixo (médio se por time) |
| Mensagem de fora de expediente | ✅ | **ADAPTAR** | Nativo | baixo |
| Mensagem de "atendente indisponível" com `{attendantName}` | ❌ | **LEVAR** | Detalhe humano que evita o cliente falando sozinho | baixo |
| Encerrar conversas abertas após X horas | ✅ *auto-resolve* | **ADAPTAR** | Nativo | baixo |
| Mover "atendendo" de volta para "aguardando" por inatividade | ❌ | **LEVAR** | Impede conversa presa com atendente ausente — problema clássico de operação | médio |
| Transferência automática para setor após X minutos | ⚠️ via automação com SLA | **ADAPTAR** | Aproximável com regra de automação | baixo |
| Proxy por conexão | — | **DESCARTAR** | Existe para disfarçar origem de sessão não oficial | — |
| Importar histórico do aparelho | — | **DESCARTAR** | Impossível e desnecessário na Cloud API | — |
| Limite de vezes que o chatbot é enviado | ⚠️ | **ADAPTAR** | Resolve-se no desenho do fluxo | baixo |
| Usuários com perfil admin / adminSetor / user | ✅ *Administrator* / *Agent* (+ papéis personalizados, recurso pago) | **ADAPTAR** | ⚠️ **`adminSetor` não tem equivalente direto** na edição aberta. Ou se aceita a simplificação, ou se constrói | médio |
| Permissão por **lista de páginas** por usuário | ❌ | **DESCARTAR** | É desenho ruim: permissão deve vir do papel, não de uma lista por pessoa. O Ragnabot já nasce com o modelo de 3 papéis da casa | — |
| Limitar usuário a **conexões específicas** | ✅ agente pertence a caixas de entrada | **ADAPTAR** | Nativo | baixo |
| **2FA** | ⏳ em implantação no padrão do NOC | **LEVAR** | Já está no mapa (etapa 3.2). No sistema atual está disponível e **ligado em 0 de 77 usuários** — nós ligamos por padrão | médio |
| Multi-empresa (tenant) | ✅ *Accounts* + Platform API | **ADAPTAR** | Nativo, e já é a espinha do plano SaaS (doc 16) | — |
| Planos com 31 chaves de licença + limites | ⚠️ | **LEVAR (simplificado)** | Precisamos de plano e limite para vender, mas **não de 31 chaves**. 3 ou 4 planos com limites de agentes, canais e mensagens | médio |
| Financeiro / faturas / bloqueio por inadimplência | ❌ | **LEVAR** | Já previsto (etapa 5.3, Efibank). Não copiar as 6 integrações de cobrança do atual: **uma só**, a nossa | alto |
| Integrações de provedor de internet (IXC, MK-Auth, SGP) | ❌ | **DESCARTAR** | Nenhum cliente nosso é provedor. Se um dia for, entra como integração pontual | — |
| Anúncios / avisos dentro do produto | ❌ | **LEVAR** | 1 registro só, mas em SaaS é o canal para comunicar manutenção e novidade. Barato | baixo |
| Ajuda / base de conhecimento interna | ✅ *Help Center* (e é público) | **ADAPTAR** | Nativo e melhor: serve também para o cliente final se resolver sozinho | baixo |
| Chat interno da equipe | ❌ | **LEVAR (reduzido)** | 50 conversas e 453 mensagens — usado, mas pouco. O caminho barato é **menção `@` + participantes na conversa**, que o Chatwoot tem. Chat separado só se a operação reclamar | baixo |
| Documentação de API embutida + testador + credenciais | ✅ API + tokens; documentação é externa | **ADAPTAR** | Nativo. Documentar em português na nossa Central de Ajuda | baixo |
| Armazenamento (varredura de disco, duplicados, lixeira) | ❌ | **DESCARTAR** | 0 registros; e no Ragnabot os anexos vão para S3 — a gestão é nossa, no NOC | — |
| Gerenciar grupos de WhatsApp (criar em massa, adicionar em massa, extrair contatos) | — | **DESCARTAR** | Grupos não existem na Cloud API. Além disso, extrair contatos de grupo para disparo é prática que **não** queremos vender | — |
| Aquecimento de números | — | **DESCARTAR** | Existe só para enganar antifraude de canal não oficial | — |
| Meta Ads (anúncios, sincronização de leads) | ⚠️ o Chatwoot registra origem da conversa | **DESCARTAR por ora** | 0 registros. O rastreio de Click-to-WhatsApp entra depois, e o marketing tem dono próprio (agente `site-ragnatela`) | — |
| Pixel FB / Remarketing / notificações de visita | ❌ | **DESCARTAR** | 0 registros; assunto de marketing, não de atendimento | — |
| Agenda / CRM de compromissos com pagamento Asaas | ❌ | **DESCARTAR** | 13 tabelas, **0 registros**, em 14 meses | — |
| Assinatura eletrônica (StudioSign) | ❌ | **DESCARTAR** | 4 tabelas, 0 registros. É outro produto | — |
| Extensões de navegador (llm-session, passkey) | ❌ | **DESCARTAR** | Acopladas ao fornecedor | — |
| Webfone (WebRTC) | ❌ | **DESCARTAR** | Voz é outro projeto | — |
| TickHub (protocolo externo) | ❌ | **DESCARTAR** | Integração com produto do fornecedor | — |

---

## 2. Placar

| veredito | quantidade |
|---|---:|
| **LEVAR** (vira backlog) | **36** |
| **ADAPTAR** (existe no destino, é configuração + manual) | **51** |
| **DESCARTAR** | **36** |
| **Total de funções avaliadas** | **123** |

> As 36 marcadas como LEVAR se condensam em **20 itens de backlog** (§3), porque catorze delas são
> nós do editor de fluxo e sub-itens que viajam junto do mesmo trabalho.

**Onde estão os descartes:** **10** caem por dependerem do WhatsApp não oficial (QR, grupos,
aquecimento, Status, proxy, importação de histórico, modo híbrido, randomização…) e **16** por
**nunca terem sido usadas** em 14 meses e 10 empresas — as demais por serem produto à parte
(assinatura eletrônica, agenda-CRM, e-mail em massa) ou desenho que não queremos repetir
(permissão por lista de páginas, integrações de provedor de internet).

---

## 3. Backlog priorizado — o que construir, em ordem

> A ordem é por **valor sobre custo**, respeitando dependência. Cada item traz *o que é*,
> *por que importa* e *como fica no Ragnabot*.

### 🥇 B1 — Editor visual de fluxo de conversa  ·  esforço **alto**  ·  bloqueia a migração
- **O que é:** editor de fluxo em tela, com nós arrastáveis, ligações e teste antes de publicar.
- **Por que importa:** é a função mais usada depois do atendimento — **35 fluxos**, todas as
  **8 conexões** apontando para um, **13 mil** mensagens interativas geradas. **Sem isso não há
  migração**, porque o Chatwoot não tem nada equivalente.
- **Como fica no Ragnabot:** aplicação própria acoplada como *Agent Bot* do Chatwoot (o Chatwoot
  entrega a conversa ao bot por webhook e recebe a resposta pela API). Assim o fluxo é **nosso**,
  o Chatwoot continua atualizável, e nada é bifurcado no código dele.
- **Catálogo mínimo de nós (o que a operação usa hoje):** início · mensagem de texto ·
  mídia · **pergunta com variável** · **lista interativa** · **botões** · **encaminhar para time** ·
  **sub-fluxo** · espera · condição · **chamada HTTP** · aplicar/remover etiqueta ·
  **notificar por WhatsApp** · encerrar + pedir avaliação.
- **⚠️ O que muda por causa da API oficial:** botões limitados a **3**, lista a **10 itens**,
  e a **janela de 24 h** — fora dela só sai template aprovado. **O editor precisa avisar isso na
  hora de montar o nó**, não deixar o erro aparecer no cliente.

### 🥈 B2 — Agendamento de mensagem  ·  esforço **médio**
- **O que é:** o atendente combina o retorno e programa a mensagem para data e hora, com anexo e
  recorrência opcional.
- **Por que importa:** **527 agendamentos** já criados (488 entregues). É a função "não existe no
  destino" mais usada de todas.
- **Como fica no Ragnabot:** botão no campo de escrita (**"Enviar depois"**) e uma tela
  *Agendamentos* com a fila do que vai sair. Se a hora do envio cair **fora da janela de 24 h**,
  a tela avisa **no momento do agendamento** e pede a escolha de um template.

### 🥉 B3 — Número de protocolo  ·  esforço **médio**
- **O que é:** todo atendimento ganha um número estável, exibido na conversa e disponível como
  variável de mensagem.
- **Por que importa:** é o que o cliente cita ao voltar e o que a empresa cita no relatório. Já é
  usado hoje (`{{protocolNumber}}`).
- **Como fica no Ragnabot:** atributo da conversa, gerado na abertura, no formato
  `AAAAMMDD-NNNNNN`; visível no cabeçalho da conversa com **botão de copiar** (o mesmo padrão que
  a página de Alertas do NOC já usa) e disponível nas respostas rápidas e no fluxo.

### B4 — Visão de quadro (Kanban) sobre as etiquetas  ·  esforço **médio**
- **O que é:** as conversas em colunas, arrastáveis entre etiquetas.
- **Por que importa:** 17 etiquetas já são coluna; é como as equipes enxergam a carga do dia.
- **Como fica no Ragnabot:** **visão**, não módulo — as colunas são etiquetas marcadas como
  "coluna", arrastar troca a etiqueta. Sem tabela nova, sem estado paralelo que possa divergir
  da conversa.

### B5 — Carteira de clientes  ·  esforço **médio**
- **O que é:** o contato (ou o atendimento) tem um responsável fixo; ao voltar, cai com ele.
- **Por que importa:** é o padrão do atendimento consultivo e de conta-chave, e o Chatwoot só
  sabe atribuir conversa a conversa.
- **Como fica no Ragnabot:** atributo `responsável` no contato + regra de automação que atribui na
  criação da conversa. Tela *Carteira* com filtro por responsável e ações em massa
  (transferir carteira inteira quando alguém sai da equipe).

### B6 — Tabulação de encerramento  ·  esforço **médio**
- **O que é:** ao resolver, o atendente escolhe o motivo (lista configurável por empresa) e pode
  escrever um resumo.
- **Por que importa:** é o que transforma volume em informação de gestão.
- **⚠️ Honestidade obrigatória:** no sistema atual **está desligada nas 10 empresas** e os 502
  registros são automáticos. **O requisito nunca foi validado com gente.** Por isso: construir a
  versão simples, ligar em **uma** operação, medir adoção em 30 dias, e só então investir mais.
- **Como fica no Ragnabot:** ao clicar em *Resolver*, um painel lateral com os motivos em
  botões grandes (um clique) + campo de resumo opcional. Relatório de fechamentos vem junto.

### B7 — Relatório em PDF sob demanda  ·  esforço **médio**
- **O que é:** o gestor escolhe período, times, agentes e o que incluir; a plataforma gera e
  entrega um PDF.
- **Por que importa:** é o artefato que vai para a reunião com o cliente. O Chatwoot só exporta CSV.
- **Como fica no Ragnabot:** reuso direto do que o NOC já faz (geração assíncrona com anel de
  progresso e marca d'água). Formato PDF e HTML, com capa da marca do tenant.

### B8 — Página web de avaliação com a marca do cliente  ·  esforço **médio**
- **O que é:** em vez de responder "1, 2 ou 3" no chat, o cliente abre um link e avalia numa
  página com o logotipo e as cores da empresa dele.
- **Por que importa:** é argumento de venda de marca branca, e a taxa de resposta é maior.
- **Como fica no Ragnabot:** página pública `/avaliacao/<token>` servida pelo nosso lado,
  gravando a nota de volta como CSAT do Chatwoot pela API. Editor de marca dentro de *Ajustes*.

### B9 — Central de notificações operacionais  ·  esforço **médio**
- **O que é:** regras do tipo "se houver mais de N conversas aguardando **ou** alguém esperando
  mais de X minutos, avise fulano no WhatsApp".
- **Por que importa:** é supervisão de SLA de verdade, e fala a língua da casa (alerta no
  WhatsApp, como o NOC).
- **Como fica no Ragnabot:** serviço próprio lendo a API do Chatwoot em intervalo curto, com
  regras por conta, *cooldown* entre envios e envio pelo canal oficial.

### B10 — Expediente do atendente + devolver conversa parada  ·  esforço **médio**
- **O que é:** turno por agente (não distribuir fora dele) e devolução automática de conversa
  presa com atendente inativo.
- **Por que importa:** os dois problemas clássicos de operação com escala: cliente esperando por
  quem já foi embora, e conversa "atendendo" sem ninguém atendendo.
- **Como fica no Ragnabot:** campo de turno no agente + trabalho periódico que devolve a conversa
  para a fila do time depois de N minutos sem resposta, registrando o motivo na conversa.

### B11 — Relatório "sem retorno"  ·  esforço **médio**
- **O que é:** lista de conversas em que a última mensagem foi nossa e o cliente não voltou.
- **Por que importa:** é dinheiro parado, e sai de graça dos dados que o Chatwoot já guarda.
- **Como fica no Ragnabot:** aba do Painel com filtro de período e canal, exportável, e com ação
  de **criar campanha de retomada** a partir da seleção.

### B12 — Trilha de auditoria por ação  ·  esforço **médio**
- **O que é:** quem fez o quê e quando — trocou configuração, exportou contato, removeu agente.
- **Por que importa:** é requisito de primeira classe da casa e já está no mapa de etapas (2.9).
  No Chatwoot aberto isso é recurso pago.
- **Como fica no Ragnabot:** registro próprio alimentado pelos webhooks do Chatwoot mais os
  eventos das nossas telas, com consulta filtrável e retenção definida.

### B13 — Melhorias pequenas do atendente  ·  esforço **baixo** (podem ir juntas)
- Ouvir o áudio antes de enviar · ditado por voz · fixar conversa · mensagem de
  "atendente indisponível" com o nome · permissão de editar resposta rápida.
- **Por que importam:** custam pouco, aparecem no primeiro dia de uso e são exatamente o tipo de
  coisa que faz o atendente dizer que "o sistema novo é melhor".

### B14 — Aviso de novidade / manutenção dentro do produto  ·  esforço **baixo**
- Faixa no topo, por conta ou global, com prioridade e anexo. É como se comunica manutenção sem
  depender de e-mail.

### B15 — Mensagem de aniversário  ·  esforço **médio**
- Campo de nascimento + automação diária que dispara o template de felicitação, com controle para
  não repetir no mesmo ano.

### B16 — Planos, limites e faturamento  ·  esforço **alto**  ·  já previsto na etapa 5
- 3 ou 4 planos com limites de agentes, canais e mensagens; medição; cobrança recorrente pelo
  Efibank; bloqueio e liberação automáticos. **Não** replicar as 31 chaves nem as 6 integrações
  de cobrança do sistema atual.

### B17 — Exportar conversa em PDF  ·  esforço **médio**
- Botão na conversa, PDF paginado com mídias, cabeçalho da empresa e protocolo. Reuso do mesmo
  motor do B7.

### B18 — Modo de teste do fluxo  ·  esforço **médio**  ·  depende de B1
- Publicar bot sem testar é *deploy* sem homologação. Número de teste, execução passo a passo e
  registro do caminho percorrido.

### B19 — Papel intermediário (equivalente a `adminSetor`)  ·  esforço **médio**
- 3 usuários usam hoje. Verificar primeiro se o modelo de 3 papéis da casa já cobre; se não,
  construir o papel "gestor de time".

### B20 — Relatório agendado por e-mail  ·  esforço **médio**  ·  depende de B7
- Fecha o ciclo: o gestor recebe o PDF toda segunda sem pedir.

---

## 4. As telas — propostas no padrão visual do Ragnabot

> Paleta e regras de `/ia/ragnabot-frontend-v2/GUIA-FRONTEND.md`: fundo `--rb-bg #03151f`,
> trilho `--rb-lateral #061e29`, cartão `--rb-surface #082532`, campo `--rb-surface-alt #0d2f3f`,
> título `--rb-heading #f5fbff`, corpo `--rb-text #bad0d9`, apoio `--rb-muted #8faab4`,
> ação `--rb-green #2ee879` **sempre com texto `--rb-on-green #03151f`**, foco `--rb-cyan #37dff7`.
> ⛔ Nada de cartão de vidro onde há texto. ⛔ Emoji nunca é ícone de interface.
> ✅ Todo estado carrega **cor + par medido + forma** (ícone e palavra escrita).
> ✅ Campo de formulário em **16 px** (piso, por causa do zoom do iOS).
> ✅ Densidade pela classe `.rb-denso` nas telas de operação — a fonte **não** encolhe.

### 4.1 Editor de fluxo (B1) — `/fluxos` e `/fluxos/:id`

**Lista (`/fluxos`).** Grade de cartões `--rb-surface`, um por fluxo: nome em título de cartão
(17 px/700), abaixo em `--rb-muted` a contagem de nós e a data da última publicação; um selo de
estado com forma e palavra — **● Publicado** (`--rb-ok`), **◐ Rascunho** (`--rb-aviso`),
**◯ Desligado** (`--rb-muted`); e o canal a que está ligado, usando o selo de canal do §4.1 do
guia. Botão primário verde **"Novo fluxo"** no topo direito.

**Editor (`/fluxos/:id`).** Três faixas:

| região | conteúdo |
|---|---|
| **Coluna esquerda, 260 px** | Paleta de nós agrupada: *Falar* (texto, mídia) · *Perguntar* (pergunta, lista, botões) · *Decidir* (condição, espera) · *Agir* (encaminhar ao time, etiqueta, chamada HTTP, notificar, sub-fluxo) · *Encerrar* (resolver + avaliação). Cada nó com ícone de traço 1,7 px e o nome escrito |
| **Tela central** | Malha de pontos sobre `--rb-bg`. Nó = cartão `--rb-surface` com **borda esquerda de 3 px na cor da família** e borda geral `--rb-borda`; título em `--rb-heading`, prévia do conteúdo em `--rb-text` com no máximo duas linhas. Ligações em `--rb-borda-campo`; a ligação **selecionada** em `--rb-cyan`. Nó com erro ganha borda `--rb-erro` **e** um triângulo com o número de problemas — nunca só a cor |
| **Coluna direita, 360 px** | Propriedades do nó selecionado. É onde mora o **aviso de limite da API oficial**: ao passar de 3 botões ou 10 itens de lista, o campo fica com borda `--rb-erro` e a frase escrita *"A API oficial da Meta aceita no máximo 3 botões. Os demais não serão entregues."* |

**Barra inferior fixa:** à esquerda o resultado da validação (*"Pronto para publicar"* em
`--rb-ok`, ou *"2 problemas"* em `--rb-erro`, sempre com ícone); à direita
**"Testar"** (botão fantasma) e **"Publicar"** (verde, texto escuro). Publicar com problemas
abre confirmação, não é bloqueado em silêncio — a decisão é do operador, o aviso é nosso.

**Responsivo:** abaixo de 1200 px a paleta vira gaveta pelo botão *"Adicionar nó"*; abaixo de
900 px o editor entra em **modo leitura** com aviso escrito — editar fluxo no celular é armadilha,
e é mais honesto dizer isso do que entregar uma tela que erra.

### 4.2 Agendamentos (B2) — `/agendamentos` + botão na conversa

**Na conversa:** ao lado do botão de enviar, um botão fantasma com ícone de relógio e rótulo
**"Enviar depois"**. Abre um painel com data e hora (campos de 16 px), o texto, o anexo e um
**bloco de aviso** quando o horário escolhido cai fora da janela de 24 h:
fundo `--rb-surface-alt`, faixa `--rb-aviso` à esquerda, ícone e a frase
*"Nesse horário a janela de 24 horas terá fechado. Escolha um modelo aprovado."* seguida do
seletor de template. **A regra da Meta aparece antes do erro, não depois.**

**Tela `/agendamentos`:** tabela densa (`.rb-denso`, linha 36 px) com Contato · Canal (selo) ·
Mensagem (uma linha, reticências) · **Quando** · Autor · Estado. Estado com forma e palavra:
**◷ Agendada** (`--rb-aviso`) · **✓ Enviada** (`--rb-ok`) · **✕ Erro** (`--rb-erro`, com a causa
na dica) · **⊘ Cancelada** (`--rb-muted`). Filtros no topo por período, canal e estado.
Abaixo de 768 px a tabela vira cartões, um por agendamento.

### 4.3 Quadro por etiqueta (B4) — `/quadro`

Colunas de largura fixa (300 px) com rolagem horizontal **dentro do painel**, nunca da página.
Cabeçalho da coluna: ponto na cor da etiqueta + nome + contagem em `--rb-muted`.
Cartão: nome do contato (título), última mensagem em uma linha, e um rodapé com o selo do canal,
o **protocolo** e o avatar do responsável. Arrastar troca a etiqueta e mostra um aviso curto de
confirmação com **desfazer**. Um seletor no topo escolhe **quais** etiquetas são colunas.
Abaixo de 900 px vira uma coluna por vez, com abas roláveis no topo.

### 4.4 Tabulação ao resolver (B6) — painel sobre a conversa

Ao clicar em **Resolver**, desliza da direita um painel de 380 px:
título *"Como este atendimento terminou?"*, e os motivos como **botões grandes de 44 px**
(um clique resolve o caso comum), depois um campo de resumo opcional e o botão verde
**"Resolver"**. Se a empresa marcou o motivo como obrigatório, o botão nasce desabilitado e o
painel explica por quê **em texto**, não só pelo cinza. Fecha com `Esc` e o rascunho é preservado.

### 4.5 Carteira (B5) — `/carteira`

Tabela com Contato · Telefone · **Responsável** · Conversas no período · Última interação.
Um seletor no topo troca o modo (**por contato** / **por atendimento**) e, ao trocar, mostra o
mesmo aviso honesto que o sistema atual mostra: quantos vínculos serão migrados e o que muda.
Seleção múltipla habilita a barra de ações — **Transferir carteira**, **Remover** — com contagem
escrita ("12 selecionados"). É a tela que se usa quando alguém sai da equipe.

### 4.6 Relatórios gerados (B7) — `/relatorios/gerados`

Formulário à esquerda (período, times, agentes, canais e caixas de seleção do que incluir),
prévia do sumário à direita. Ao gerar, o item entra numa lista com **anel de progresso verde**
— exatamente o componente que o NOC já usa para gravação — e, ao concluir, o anel fecha em
`--rb-green` e o botão vira **"Baixar PDF"**. Falha mostra a causa escrita e um botão
**"Tentar novamente"**, nunca só um X vermelho.

### 4.7 Protocolo (B3) — no cabeçalho da conversa

Ao lado do nome do contato, uma etiqueta monoespaçada em `--rb-surface-alt` com o protocolo e um
botão de copiar; ao copiar, o botão confirma com a palavra **"Copiado"** por dois segundos.
O mesmo valor aparece na exportação em PDF e na lista de conversas quando a busca é por protocolo.

---

## 5. Riscos que o backlog precisa carregar

| risco | por que é real | o que fazer |
|---|---|---|
| **Subestimar o editor de fluxo** | É o item mais caro e o único que **bloqueia** a migração. 35 fluxos precisam ser refeitos à mão | Começar por ele; migrar **um** fluxo real da Ragnatela como prova antes de prometer prazo |
| **A janela de 24 h muda o comportamento** | Metade do que a operação faz hoje (retomar contato, agendar, disparar) só funciona porque o canal não oficial ignora a regra | Tratar a janela como cidadã de primeira classe na interface: avisar **antes** do envio, sempre |
| **Templates aprovados demoram** | Campanha e retomada dependem de template aprovado pela Meta | Criar cedo o conjunto básico (retomada, aviso, cobrança, agradecimento) e aprovar antes do piloto |
| **Confundir "tem tela" com "é usado"** | 141 tabelas vazias provam que o fornecedor construiu para vender, não para operar | Todo item de backlog nasce com uma medida de adoção; o que não for usado em 90 dias é removido |
| **`adminSetor` sem equivalente** | 3 usuários dependem dele hoje | Decidir cedo: aceitar a simplificação ou orçar o papel novo (B19) |
| **Auditoria e 2FA são recursos pagos no Chatwoot** | O plano da casa exige os dois | Construir do nosso lado (B12) e ligar 2FA por padrão, não como opção |

---

## 6. Recomendação em uma frase

**Levar 36 funções (20 itens de backlog), adaptar 51 e descartar 36** — e, dessas 25, tratar **B1 (editor de fluxo)**,
**B2 (agendamento de mensagem)** e **B3 (protocolo)** como o caminho crítico: são as três que a
operação usa todo dia, que o Chatwoot não tem, e sem as quais a migração da VM 10016 não pode
sequer ser proposta ao dono.

