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

---

## 7. DECISÃO DO CHEFE — quem autentica na aplicação nova (30/08/2026)

O agente da Etapa 1 fez a pergunta certa e **não** copiou o `authMiddleware` do NOC — copiar seria
levar o acoplamento junto na mudança. Enquanto a decisão não existia, ele deixou o processo subir
com as rotas privadas recusando `503 AUTH_NAO_CONFIGURADA` — **falha fechada, nunca aberta**. Certo.

### A decisão: identidade PRÓPRIA, com uma ponte explícita e temporária

**1. Serviço a serviço (NOC → Ragnabot), a partir de agora.**
O NOC chama a API do Ragnabot com um **token de serviço próprio** (`RAGNABOT_SERVICE_TOKEN`, no
cofre dos dois lados), e **declara em cabeçalho quem é o operador humano** que pediu a ação.
O Ragnabot registra na auditoria que aquela identidade foi **asserida pelo NOC** — nunca como se
tivesse sido verificada por ele.

**Por que isto é aceitável aqui:** o NOC é console de operação, autentica os próprios operadores e
já decide o escopo deles. Delegar identidade entre serviços confiáveis é padrão — desde que o
registro diga que foi delegação, e é isso que a marca "via NOC" faz.

**2. O limite dessa ponte, que é onde muita gente erra.**
A identidade asserida vale **somente** para escopo de OPERADOR (nós administrando). Ela **NUNCA**
pode servir para o cliente final se atender: no dia em que o admin de uma empresa cliente usar a
plataforma, a identidade dele tem de ser verificada **pelo Ragnabot**, contra a própria plataforma —
senão quem controla o cabeçalho controla o escopo, e o isolamento entre empresas que provamos com
teste vira enfeite.

⚠️ A regra da auditoria continua valendo, sem exceção: **o escopo sai de quem está autenticado,
nunca do que a tela mandou.** Com a ponte, "quem está autenticado" para chamada de operador é o
**par (token de serviço + operador asserido)** — e o token de serviço é a parte que não se falsifica.

**3. Etapa 4 encerra a ponte.** Quando as telas mudarem de casa, a autenticação passa a ser da
plataforma (o cliente entra no Ragnabot, não no NOC) e a assertiva do NOC fica restrita ao que é
operação nossa. A ponte é **transitória por desenho**, e está escrita aqui para não virar
permanente por esquecimento.

### Consequência imediata
`base/auth.js` expõe `authMiddleware`, `adminOnly` e `superuserOnly` com essa semântica. Sem
`RAGNABOT_SERVICE_TOKEN` definido, tudo que é privado recusa — falha fechada.

---

## 8. Pendências abertas ao fim da Etapa 1

1. **Quatro dependências do NOC ainda estáticas**, e por isso `/api/ragnabot-cobranca` e
   `/api/ragnabot-cluster` não sobem: `auth.middleware.js`, `validate.js`, `operator-2fa.js` e
   `ssh-pool.service.js`.
   **Destino decidido:** `auth`/`validate`/`2fa` viram peça da camada de base do Ragnabot (são
   identidade e validação, coisa de quem atende); **`ssh-pool` NÃO muda de casa** — ler o cluster por
   SSH é observação, e observação é do NOC. A rota de cluster passa a consumir a API do NOC, ou some
   da aplicação nova. (A tela do cluster já é do NOC e continua sendo.)
2. **Dependências dinâmicas:** `otp.service` e `device.service` seguem o mesmo destino da identidade;
   **`smtp.service` MUDA DE CASA** (o nó de e-mail do fluxo atende cliente); `evolution.service`
   fica no NOC e vira **porta injetada** (mandar alerta no WhatsApp é operação, não atendimento).
3. **A aplicação precisa do próprio `node_modules` e do próprio cliente Prisma gerado.** Lição cara
   da Etapa 1: um atalho para as dependências do NOC fez o cliente gerado carregar o `.env` do NOC,
   e testes locais bateram no **banco de produção** sem avisar. Conferido depois: nenhum esquema
   órfão, nenhum dado a mais. Mas a lição fica — ambiente emprestado mente sobre onde você está.


---

## 9. ETAPA 2 — CONCLUÍDA (30/08/2026)

### O que foi feito, na ordem
1. **Conferência antes de tocar em qualquer coisa real.** Apliquei os 11 arquivos SQL num esquema
   descartável e comparei **coluna a coluna** contra as tabelas de produção do NOC:
   **zero divergência**. A suspeita de desvio silencioso (o motivo de 13 tabelas não terem SQL) está
   descartada para as outras 27.
2. **Base própria criada** no mesmo cluster Patroni que já serve a plataforma — mesma alta
   disponibilidade, mesmo backup, sem máquina nova. **Usuário e dono próprios** (`ragnabot_app`):
   o app do Ragnabot não alcança a base do Chatwoot, e vice-versa.
3. **40 tabelas, 154 índices**, as **3 chaves compostas de isolamento entre empresas** e o gatilho
   que torna a versão publicada imutável — tudo em transação única.
4. **Dados migrados:** 39 linhas (1 empresa, 2 eventos, 2 contadores, 28 protocolos, 6 registros de
   auditoria), conferidas uma a uma na chegada. Nenhum segredo cifrado no conjunto.
5. **Posse ajustada:** as tabelas nasceram do superusuário; o dono da base passou a ser dono do
   conteúdo, senão a aplicação conecta e é recusada no esquema.
6. **Regras de acesso** nos dois nós do banco, liberando só as redes dos nós do Kubernetes.

### ⚠️ Acoplamento escondido DENTRO do SQL versionado — corrigido
`03-rb_versao_imutavel.sql` continha `GRANT UPDATE … TO ragnatela_app` — o usuário **do NOC**. Na
base própria esse papel não existe, e a **transação inteira era revertida**. Um arquivo versionado
que só funciona se o outro sistema estiver do lado é acoplamento, mesmo sem `import`. Trocado por
concessão ao **dono da base corrente**, que serve nos dois.

### O NOC NÃO entra no `pg_hba`, de propósito
Tentar ler a base nova a partir do NOC devolve `no pg_hba.conf entry`. **Isso é o resultado
desejado**, não um defeito: o banco do produto não deve ser alcançável pelo console de operação.
Provado de dentro do cluster (pod → `banco-lider`): 1 empresa, 28 protocolos, 40 tabelas.

⚠️ **A mensagem do Prisma engana:** ele diz *"User was denied access on the database"* quando a
causa real é `pg_hba`. Quem for diagnosticar isso um dia: teste com `psql` antes de caçar permissão
de esquema.

### O que falta para a Etapa 3
Construir a imagem, criar o `Secret` (a credencial já está guardada no `.env` do NOC para isso),
subir o `ragnabot-motor`, apontar o webhook da plataforma para ele e **desligar os trabalhadores no
NOC na mesma janela** — nunca os dois rodando, senão dois relógios agem na mesma conversa.
