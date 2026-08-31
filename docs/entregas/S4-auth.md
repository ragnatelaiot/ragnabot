# S4-AUTH — o motor ganhou login próprio, validado contra a plataforma

> **Contrato S4-AUTH · 30/08/2026 · caminho (C) do `app/web/COMO-SERVIR.md` §3.**
> Nada foi aplicado, nada foi reiniciado, nada foi commitado. O código está na árvore de trabalho
> do repositório do Ragnabot, com teste, esperando a decisão do chefe.

---

## 1. O defeito que esta entrega fecha

O agente da interface preparou a tela para ser servida pelo motor e **recusou-se a ligá-la**.
Estava certo. Do jeito anterior:

1. o motor injetaria `window.__RAGNABOT__ = { token: RAGNABOT_SERVICE_TOKEN, … }` — **qualquer
   navegador que alcançasse a página receberia a credencial de serviço**;
2. o papel viajava em `x-ragnabot-ator-papel`, **cabeçalho que o cliente escolhe**. Quem tivesse o
   token se declarava `super` e passava por `superuserOnly` — o que tranca **cobrança e criação de
   empresa** deixaria de trancar.

É exatamente o limite escrito no doc 33 §7.2: *"quem controla o cabeçalho controla o escopo"*.
A ponte `base/auth.js` foi desenhada **serviço a serviço** (NOC → motor). Estendê-la ao navegador
seria atravessar essa linha.

**A tela nunca chegou a ir ao ar assim.** O defeito foi apontado antes de ligar.

---

## 2. O que foi construído

| Arquivo | Estado | O que é |
|---|---|---|
| `app/src/rotas-sessao.js` | **novo** | `POST /sessao/entrar`, `POST /sessao/sair`, `GET /sessao/eu` |
| `app/src/base/auth.js` | editado | dois caminhos: **cookie de sessão** (pessoa) e **token de serviço** (máquina) |
| `app/src/base/testes/auth.test.mjs` | **novo** | 13 verificações, com Express de verdade em porta efêmera |
| `app/src/COMO-MONTAR-SESSAO.md` | **novo** | o trecho para o `servidor.js` e as variáveis — para o chefe |
| `app/web/src/paginas/Entrada.jsx` | **novo** | tela de entrada + portão de sessão |
| `app/web/src/lib/api.js` | editado | parou de mandar credencial e papel em cabeçalho |
| `app/web/src/main.jsx` | editado (mínimo) | envolve o editor no portão; rodapé reage à sessão |
| `app/web/index.html` | editado | o `<script>` da credencial **saiu** |
| `app/web/COMO-SERVIR.md` · `app/web/tests/servir.smoke.mjs` | editados | o endereço da credencial saiu do trecho e do teste |
| `VERSAO` · `docs/VERSOES.md` · `docs/MANUAL.md` | editados | **v1.04.00** (Lei 6) |

**`app/src/servidor.js` e `app/Dockerfile` NÃO foram tocados**, como o contrato mandou.

---

## 3. Como funciona

### Entrada
1. `POST /sessao/entrar { email, senha, codigo?, contaId? }`.
2. O motor chama `POST /auth/sign_in` **na plataforma**. Quem confere a senha é o Chatwoot.
   A senha **não é guardada** — nem em cache, nem em log, nem em variável de módulo.
3. Da resposta saem `id`, `name`, `email` e o papel **da conta escolhida**
   (`accounts[].role`, e **não** o `role` do topo — este é o da conta mais recentemente ativa, que
   pode ser outra para quem participa de mais de uma).
4. A empresa (`RagnabotTenant`) é resolvida **no servidor** por `cwAccountId`, uma vez, na entrada.
5. Cookie assinado: `HttpOnly`, `SameSite=Strict`, `Secure`, `Max-Age ≤ 8 h`, HMAC-SHA256 com
   `RAGNABOT_SESSAO_SEGREDO`. **O papel vai dentro do conteúdo assinado.**

### A trava
`base/auth.js` tenta o **cookie primeiro**. Se o cookie vale, `x-ragnabot-ator-*` é **ignorado
inteiro** — nem para "enriquecer" a identidade. Se não há cookie válido, tenta o token de serviço,
onde o cabeçalho de papel continua valendo (a ponte NOC→motor não regrediu).

### Falha fechada
Sem nenhum dos dois segredos → **503** em tudo que é privado. Sem `RAGNABOT_SESSAO_SEGREDO` →
`/sessao/entrar` e `/sessao/eu` respondem **503**, não abrem.

---

## 4. O mapeamento de papéis (decisão, com o porquê)

| Na plataforma | Vira | `adminOnly` | `superuserOnly` |
|---|---|---|---|
| `administrator` da conta | `role: 'admin'`, `isSuperuser: false` | passa | **não passa** |
| `agent` da conta | `role: 'user'`, `isSuperuser: false` | não passa | **não passa** |
| NOC (token de serviço + `papel: super`) | `isSuperuser: true` | passa | **passa** |

**Nenhuma sessão de navegador vira super usuário.** `superuserOnly` guarda cobrança e criação/
exclusão de empresa — operação **nossa**, do console de operação. Um `administrator` é dono da
empresa **dele**, não do SaaS. Promovê-lo devolveria pela porta da frente o buraco que o cabeçalho
forjado abria pela porta dos fundos. Ponto único de mudança, se o chefe discordar:
`usuarioDaSessao()` em `base/auth.js`.

---

## 5. A saída real dos testes

```
══ AUTENTICAÇÃO DO RAGNABOT — cookie de sessão × token de serviço ══

   ✅ (a) sem cookie e sem token de serviço → 401
   ✅ (b) cookie válido → papel vem do conteúdo ASSINADO
   ✅ (c) ⭐ cookie válido + cabeçalho de papel forjado "super" → cabeçalho IGNORADO
   ✅ (d) token de serviço + papel no cabeçalho → continua funcionando (ponte intacta)
   ✅ (e) cookie adulterado → recusado
   ✅ (f) cookie vencido → recusado (mesmo com assinatura VÁLIDA)
   ✅ (g) sem RAGNABOT_SESSAO_SEGREDO → a entrada RECUSA (503), e não abre
   ✅ (h) GET /sessao/eu: 401 sem cookie, e quem sou eu com cookie — sem segredo nenhum
   ✅ (i) POST /sessao/sair: apaga o cookie no navegador E revoga nesta réplica
   ✅ (j) o cookie emitido é HttpOnly + SameSite=Strict + Secure e ≤ 8 h
   ✅ (k) o teto de 8 h não é negociável por variável de ambiente
   ✅ (l) sem NENHUM dos dois segredos → 503 falha fechada (nunca aberta)
   ✅ (m) POST /sessao/entrar sem e-mail/senha → 400, e não vai à plataforma

   13 verificações passaram.
```

Sem regressão nos vizinhos: `npm run test:base` → **8 + 10 verificações**, todas verdes.
`app/web`: `npm run build` → `✓ built in 3.77s`; `node tests/servir.smoke.mjs` → **8 de 8**;
`node tests/monta.smoke.mjs` → **5 de 5**.

---

## 6. O que foi MEDIDO na plataforma, e como

Lido no código da versão em uso (`chatwoot v4.17.1`, `DeviseOverrides::SessionsController` e
`app/views/api/v1/models/_user.json.jbuilder`) e conferido contra o serviço no ar:

- sucesso → `200 { data: { id, name, email, account_id, role, accounts:[{id,name,status,role,…}] } }`;
- **segundo fator → 206** `{ mfa_required, mfa_token }` (5 min). O `mfa_token` **não vai ao
  navegador**: a tela pede o código, a senha é conferida de novo e o token é usado dentro do motor;
- credencial errada → 401, **a mesma frase** para e-mail inexistente e senha errada (a plataforma
  não deixa enumerar usuário, e não estragamos isso);
- **limite de sessões → 409 só para navegador**, decidido por `request.user_agent.include?('Mozilla')`.
  Por isso esta chamada **não repassa o User-Agent do navegador**: com o nosso, a plataforma
  descarta a sessão mais velha e segue, em vez de devolver uma tela que não sabemos desenhar.

### ⚠️ A armadilha medida hoje, que muda a configuração
Pelo endereço **público**, `POST /auth/sign_in` responde **401 em HTML do nginx** — é o guarda do
"não sou robô" (`deploy/turnstile/`, `auth_request`), que barra antes de chegar ao Chatwoot.
**Servidor não resolve desafio de robô.** Por isso:

- a entrada procura primeiro `RAGNABOT_PLATAFORMA_INTERNA` (`http://ragnabot-web:3000`), que não
  passa pelo guarda;
- se cair no caminho público e levar HTML, o motor responde **`PLATAFORMA_INACESSIVEL`** com essa
  explicação — **nunca** "e-mail ou senha inválidos", que mandaria a equipe caçar o defeito na senha.

Medição bruta (30/08, do NOC, forçando Host e SNI):

```
POST /auth/sign_in   -> 401 <html>… 401 Authorization Required … nginx …
GET  /api/v1/profile -> 401 {"errors":["Você precisa entrar ou se cadastrar antes de continuar."]}
```

A segunda linha é o Chatwoot respondendo (em português, inclusive) — prova que o caminho de rede
está bom e que o 401 do `/auth/sign_in` é do guarda, não da aplicação.

---

## 7. O que eu NÃO consegui medir

1. **Uma entrada de verdade.** Não tenho conta na plataforma. Todo o resto está provado por
   observação; a conversa com o Chatwoot está provada **por leitura do código da versão em uso**.
   O primeiro login real é o ensaio — e precisa do `RAGNABOT_PLATAFORMA_INTERNA` configurado.
2. **O papel que uma conta real devolve.** O contrato do campo está lido no `jbuilder`; o valor
   concreto de uma conta nossa, não.
3. **A tela num navegador.** Não há navegador aqui: o build passa e a renderização do lado do
   servidor passa, mas ninguém clicou em "Entrar".

---

## 8. Pendências e limites, ditos em voz alta

- **Revogação é por réplica.** O cookie é autocontido; "sair" apaga no navegador e revoga **na
  memória da réplica que atendeu**. São 2 réplicas. Para quem sai da tela isso não muda nada; para
  um cookie **roubado**, o pior caso é sobreviver até vencer (≤ 8 h) na outra réplica. Fechar de
  verdade exige **tabela de sessões no banco** — mudança de esquema, decisão do chefe.
- **Freio de tentativas também é por réplica** (memória). O freio que conta continua sendo o da
  plataforma (`limit_req` + rack-attack).
- **`conferir2FA` do editor de fluxo não funciona no motor** — e isso **já era assim antes desta
  tarefa**: `ragnabot-fluxo.routes.js` consulta `prisma.user` e importa `otp.service.js`, e nenhum
  dos dois existe na aplicação nova (não há `model User` no schema do Ragnabot). A publicação com
  2FA forçada vai dar 500. **Não é meu arquivo e não consertei**; é pendência da separação.
- **`/api/ragnabot` (SaaS) para um admin de empresa dá 500**, porque o router importa
  `device.service.js`, que não veio. Falha **fechada** (ninguém entra), mas com erro feio.
- **`npm run test:mjs` está quebrado** (`node --test tests/` não resolve o diretório no Node 22:
  `MODULE_NOT_FOUND`). **Pré-existente**, sem relação com esta entrega — só o registro.
- **Esta é a sessão do OPERADOR na tela do editor.** O cliente final atendido pelo bot não entra em
  lugar nenhum; nada muda para ele.

---

## 9. Decisões que ficam com o chefe

1. **Aplicar o trecho** de `app/src/COMO-MONTAR-SESSAO.md` no `servidor.js` (montar `/sessao` depois
   do webhook e **antes** do desvio-para-a-página).
2. **Criar `RAGNABOT_SESSAO_SEGREDO`** no `Secret` (`openssl rand -hex 32`) e
   **`RAGNABOT_PLATAFORMA_INTERNA`** no ConfigMap.
3. **Confirmar o mapeamento de papéis** do §4 (super só pelo NOC).
4. **Decidir sobre a tabela de sessões** (revogação entre réplicas) — ou aceitar o limite de 8 h.
5. **Versão v1.04.00** já registrada em `VERSAO`, `docs/VERSOES.md` e `docs/MANUAL.md`. Se outro
   agente também tiver bumpado, o chefe arbitra.
