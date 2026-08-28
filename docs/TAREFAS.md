# 📋 ORDENS DO DONO → TAREFAS ORGANIZADAS
> Toda ordem dada vira tarefa rastreável aqui. Atualizado em **28/08/2026, manhã**.
> ✅ feito · 🔧 em execução · ⏳ depende do dono · ⬜ na fila

---

## BLOCO A — SEGURANÇA DE ACESSO

| # | Ordem (palavras do dono) | Tarefa | Estado |
|---|---|---|---|
| A1 | *"prepara no login o sistema de eu não sou robô da Cloudflare e tenta criar você mesmo o código"* | Criar o widget na Cloudflare | ⏳ **bloqueado** — o token que temos só tem permissão de DNS; criar o widget exige permissão de conta (ver §Pendências) |
| A2 | idem | Preparar o código para aplicar assim que houver a chave | ⬜ |
| A3 | *"sistema de prevenção de ataque força bruta igual temos no NOC, após 7 logins errados começa a ter penalidade de tempo"* | Freio de taxa no `/auth/sign_in` (proxy) | ✅ **provado**: 12 tentativas seguidas → passa a devolver 429 |
| A4 | idem | Ligar a proteção nativa do produto | ✅ `ENABLE_RACK_ATTACK=true` — cobre login (5/5min por IP, 10/15min por e-mail), redefinição de senha e verificação de 2FA |
| A5 | idem | Penalidade **progressiva** idêntica à do NOC (7 erros → 30s +15s a cada erro, recupera em 2h) | ⬜ exige código próprio — a nativa é janela fixa, não escalonada |
| A6 | *"criação de usuários no mesmo padrão do NOC: manda e-mail, usuário cria senha e 2FA por QR e por e-mail"* | Fluxo de convite + senha + 2FA | 🔧 agente |
| A7 | *"copia os acessos de todos os superadmins com as chaves de segundo fator"* | Usuário gestor com poder total | 🔧 agente — ⚠️ com ressalva de segurança: chave de 2FA é credencial pessoal; o certo é o gestor cadastrar a própria |

## BLOCO B — IDENTIDADE E FRONTEND

| # | Ordem | Tarefa | Estado |
|---|---|---|---|
| B1 | *"entrada padrão ouro conforme o painel Ragnatela e a ia.ragnatela"* | Login em duas colunas com imagem impactante | ✅ no ar |
| B2 | *"gerar imagens impactantes, menus internos e configurações elegantes, funcionais, intuitivas"* | Telas de menus, configurações, painel e conversas | ✅ produzidas · ⬜ aplicar as internas |
| B3 | *"tirar tudo do nome do opensource e deixar apenas Ragnabot"* | Eliminar o nome de origem da interface | ✅ **"Entrar no Ragnabot"** · 🔧 varredura completa com o agente |
| B4 | *"ao clicar em exibir a senha o frontend muda completamente"* | Corrigir o seletor frágil | ✅ identificado (era `:has(input[type=password])`) · 🔧 correção com o agente |
| B5 | *"só errar credencial ele responde em inglês"* | Todas as mensagens em português | 🔧 agente |
| B6 | *"review completo do código e responsividade para celular"* | Auditoria + mobile 360→1440 | 🔧 agente |
| B7 | *"favicon da Ragnatela"* | Ícone da marca | ✅ SVG · ⬜ formatos PNG que o navegador pede |
| B8 | *"cards de resumo, relatórios, dashboards com indicadores (só admin)"* | Painel de indicadores | ✅ desenhado · ⬜ aplicar no produto |

## BLOCO C — PLATAFORMA E SaaS

| # | Ordem | Tarefa | Estado |
|---|---|---|---|
| C1 | *"será um serviço SaaS; outras empresas com outras conexões"* | Provisionamento de empresa em uma ação | 🔧 agente |
| C2 | *"permitir multiconexões na mesma conta de empresa"* | Várias conexões por empresa | 🔧 agente |
| C3 | *"planos de cobrança recorrentes e integração Efibank"* | Cobrança + liberação automática | 🔧 agente · ⏳ credenciais |
| C4 | Isolamento entre empresas (lição do sistema antigo) | Teste que prova o isolamento | 🔧 agente |
| C5 | *"deixa a parte da Meta comigo"* | Verificar número e registrar na Cloud API | ⏳ **com o dono** |

## BLOCO D — NOC E OPERAÇÃO

| # | Ordem | Tarefa | Estado |
|---|---|---|---|
| D1 | *"criar no NOC o cluster, subgrupo RAGNABOT, com servidores, banco, espaço, quem é primário, atualização"* | Cluster no NOC | ✅ 5 servidores + saúde ao vivo, zero alertas |
| D2 | idem | Página visual do cluster | 🔧 agente · ⏳ janela de deploy |
| D3 | *"acopla ao NOC como menu Atendimento"* | Menu + entrada sem digitar senha de novo | 🔧 caminho achado |
| D5 | *"só os super users do NOC gerenciam o SaaS do Ragnabot"* (regra do dono) | **SSO por link**: superuser do NOC entra sem senha própria e gerencia empresas/contas | ⬜ próximo · ⏳ janela |
| D4 | *"questão de banco fica como pendência pós-piloto"* | Cópia de segurança, recuperação, ensaios | ⏸️ **adiado por decisão** |

## BLOCO E — CONHECIMENTO E DOCUMENTAÇÃO

| # | Ordem | Tarefa | Estado |
|---|---|---|---|
| E1 | *"agente para descobrir todas as funções do chat atual e comparar com o que você tem"* | Engenharia reversa do sistema atual | 🔧 agente |
| E2 | *"extrair desse bot somente o que faz sentido"* | Decisão função a função: levar / adaptar / descartar | 🔧 agente |
| E3 | *"manual de cada função por menu"* | Manual do usuário | 🔧 agente |
| E4 | *"documentação rica: Kubernetes, bancos, mídias, alta disponibilidade, eleição do primário"* | Estrutura técnica | ✅ `11-ESTRUTURA-RAGNABOT.md` |
| E5 | *"no final da nossa documentação, DOCX"* | Consolidar tudo em DOCX | ⬜ ao final |
| E6 | *"mostra todas as fases que já criou e executou e as que faltam"* | Painel de fases | ✅ `20-PAINEL-DE-FASES.md` |
| E7 | *"documente tudo, guarde na memória, se a sessão cair volte de onde parou"* | Memória de retomada | ✅ ativa |


## BLOCO F — SEGURANÇA (auditoria de 28/08)

| # | Item | Estado |
|---|---|---|
| F1 | Banco sem poder total (superuser removido) | ✅ provado |
| F2 | Cerca de rede: isolamento restritivo do pod | ✅ provado |
| F3 | Pod endurecido (privilégio, capacidades, seccomp, token) | ✅ |
| F4 | Cookie seguro + HSTS + Permissions-Policy | ✅ |
| F5 | Isolamento entre empresas (o que o sistema antigo vazava) | ✅ **401 provado** |
| F6 | Rodar sem ser administrador (não-root) | ⬜ exige mapear diretórios |
| F7 | Cifrar segredos do Kubernetes em repouso | ⬜ reinicia API, um nó por vez |
| F8 | Fechar porta interna (NodePort) no firewall | ✅ **feito** nas 3 bordas, clientes intactos |
| F9 | Comandos perigosos do Redis | ⬜ |
| F10 | Política de conteúdo do navegador (CSP) | ⬜ em modo relatar primeiro |
| F11 | OCSP + HTTPS no /super_admin | ⬜ |

> Detalhe de cada um, com o porquê e como reverter: `23-PENDENCIAS-SEGURANCA.md`

---

## ⏳ PENDÊNCIAS COM O DONO (curtas e objetivas)

1. **Meta** — verificar o número por ligação de voz e registrá-lo na Cloud API. *Trava todos os canais.*
2. **Cloudflare** — para eu criar o "não sou robô", preciso de **um token com permissão de Turnstile**
   (o atual só faz DNS). No painel: *Meu perfil → Tokens de API → Criar → permissão **Account ·
   Turnstile · Edit***. Ou crie o widget você mesmo em *Turnstile → Add site* (domínio
   `chat002.ragnatela.com.br`) e me mande a **chave do site** e a **chave secreta**.
3. **Efibank** — credenciais para a cobrança automática.
4. **Preços dos planos.**
5. **Janela sem sessão ativa** — para reiniciar o NOC e publicar o painel do cluster e o menu.

## 🧭 Observação honesta sobre o "não sou robô"
O produto **não tem** suporte nativo ao verificador da Cloudflare (tem a outro, o hCaptcha).
Colocar só o quadradinho na tela sem validação no servidor seria **decorativo — não protegeria nada**.
Os caminhos reais são: (a) usar o verificador que o produto já valida, (b) pôr a verificação na
borda da Cloudflare, ou (c) construir a validação no proxy. Vou detalhar os três com prós e contras
quando você me passar a chave — e enquanto isso o **freio de força bruta já está protegendo** (A3/A4).
