# Como montar a entrada de sessão no motor

> **Contrato S4-AUTH, 30/08/2026 — caminho (C) do `web/COMO-SERVIR.md` §3.** O motor ganhou login
> próprio, validado contra a plataforma (Chatwoot). Este arquivo é o que o chefe precisa acrescentar
> em `app/src/servidor.js` e no `Secret` — **eu não editei nenhum dos dois**, por ordem do contrato.
>
> ⚠️ Nada aqui foi aplicado, nada foi reiniciado e nada foi commitado.

---

## 1. O que foi construído

| Arquivo | O que faz |
|---|---|
| `app/src/rotas-sessao.js` | `POST /sessao/entrar`, `POST /sessao/sair`, `GET /sessao/eu` |
| `app/src/base/auth.js` | passou a aceitar **cookie de sessão** além do token de serviço |
| `app/src/base/testes/auth.test.mjs` | 13 verificações, incluindo a que barra a escalada |
| `app/web/src/paginas/Entrada.jsx` | a tela de entrada e o portão de sessão |
| `app/web/src/lib/api.js` | deixou de mandar credencial e papel em cabeçalho |
| `app/web/index.html` | o `<script>` da credencial **saiu** |

---

## 2. O trecho para `app/src/servidor.js`

**Onde:** logo **depois** do bloco do webhook (`/api/ragnabot-webhook`) e **antes** das rotas
privadas. A ordem importa por dois motivos, e nenhum é gosto:

1. `/sessao/entrar` é **público por natureza** — é onde a pessoa ainda não tem sessão. Montá-lo
   depois de qualquer trava geral o deixaria inalcançável, e ninguém entraria nunca.
2. Ele tem de vir **antes** do desvio-para-a-página do `COMO-SERVIR.md §1`; senão um
   `GET /sessao/eu` vindo do navegador (que manda `Accept: text/html,…`) receberia **a página**, e
   a tela leria `<` onde esperava JSON.

```js
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTRADA DE SESSÃO (contrato S4-AUTH) — a pessoa entra com a conta DELA, da plataforma.
//
// Público de propósito: é onde ainda não há sessão. A proteção dele é a própria plataforma (que
// confere a senha), o freio de tentativas de `rotas-sessao.js` e o `RAGNABOT_SESSAO_SEGREDO` —
// sem o segredo, a entrada RECUSA com 503 (falha fechada, como todo o resto da casa).
// ════════════════════════════════════════════════════════════════════════════════════════════════
await montar('/sessao', './rotas-sessao.js');
```

`montar()` já é tolerante: se o arquivo não carregar, a rota responde 503 e o resto do motor segue
de pé — o que é o comportamento certo, porque atendimento não pode parar por causa de tela.

**No `/saude`** (opcional, e recomendado): trocar

```js
autenticacao: authIndisponivel ? { ok: false, motivo: authIndisponivel } : { ok: true },
```

por

```js
// `autenticacaoPronta()` diz QUAIS caminhos estão configurados (cookie, token de serviço, os dois)
// sem revelar segredo nenhum. Sem isto, "ninguém consegue entrar" e "o motor subiu sem a chave de
// sessão" são indistinguíveis de fora — e alguém vai passar uma tarde nisso.
autenticacao: authIndisponivel
  ? { ok: false, motivo: authIndisponivel }
  : { ok: true, ...(await import('./base/auth.js')).autenticacaoPronta() },
```

---

## 3. Variáveis novas (no `Secret`/`ConfigMap` — ⛔ nenhum valor aqui)

| Chave | Onde | Obrigatória? | Para quê |
|---|---|---|---|
| `RAGNABOT_SESSAO_SEGREDO` | **Secret** | **sim** (sem ela a entrada recusa 503) | assina o cookie. 32 bytes aleatórios: `openssl rand -hex 32` |
| `RAGNABOT_PLATAFORMA_INTERNA` | ConfigMap | **sim, na prática** | endereço da plataforma **por dentro do cluster**: `http://ragnabot-web:3000` |
| `RAGNABOT_SESSAO_HORAS` | ConfigMap | não | validade da sessão. Padrão e **teto** 8 h — valor maior é rebaixado |
| `RAGNABOT_SESSAO_COOKIE_INSEGURO` | — | não | só fora de produção, para desenvolver em `http://localhost` |

⚠️ **Trocar `RAGNABOT_SESSAO_SEGREDO` derruba todas as sessões abertas** (as assinaturas deixam de
conferir). É o comportamento desejado num incidente; é surpresa desagradável num rollout de rotina.

⚠️ **`RAGNABOT_PLATAFORMA_INTERNA` não é luxo — é obrigatório na prática.** Medido em 30/08/2026:
pelo endereço público, `POST /auth/sign_in` responde **401 em HTML do nginx**, porque o guarda do
"não sou robô" (`deploy/turnstile/`) está na frente dele. Servidor não resolve desafio de robô.
Sem essa variável a entrada devolve `PLATAFORMA_INACESSIVEL` com essa explicação — de propósito,
para ninguém procurar o defeito na senha do operador.

---

## 4. O que muda no `Dockerfile`

**Nada.** `rotas-sessao.js` está dentro de `app/src`, que já é copiado inteiro. As duas etapas
descritas em `web/COMO-SERVIR.md §2` (construir a interface e copiar `web/dist`) continuam valendo
sem alteração.

---

## 5. O mapeamento de papéis — a decisão, e o porquê

| Na plataforma | Vira aqui | Passa em `adminOnly`? | Passa em `superuserOnly`? |
|---|---|---|---|
| `administrator` da conta | `role: 'admin'` | sim | **não** |
| `agent` da conta | `role: 'user'` | não | **não** |
| operador do NOC com `x-ragnabot-ator-papel: super` **+ token de serviço** | `isSuperuser: true` | sim | **sim** |

**Nenhuma sessão de navegador vira super usuário.** Não é conservadorismo gratuito: `superuserOnly`
guarda cobrança, criação e exclusão de empresa — operação **nossa**, do console de operação. Um
`administrator` é dono da **empresa dele**, não do SaaS. Promovê-lo a super devolveria, pela porta
da frente, o mesmo buraco que o cabeçalho forjado abria pela porta dos fundos.

**Se o chefe discordar**, o ponto de mudança é um só: `usuarioDaSessao()` em `base/auth.js`. Mas aí
é preciso decidir *quem*, exatamente — "administrador da conta 1 (a nossa)" é diferente de
"administrador de qualquer conta", e a segunda leitura entrega o SaaS a todo cliente.

---

## 6. Como conferir que ficou de pé

```bash
cd app
node src/base/testes/auth.test.mjs      # 13 verificações; a (c) é a que barra a escalada
npm run test:base                       # cifragem + auditoria, sem regressão
cd web && npm run build && node tests/servir.smoke.mjs   # 8 medições
```

Depois de subir, no pod:

```bash
curl -s localhost:3000/saude | jq .autenticacao        # tem de listar os caminhos configurados
curl -s -X POST localhost:3000/sessao/entrar \
     -H 'content-type: application/json' -d '{"email":"","senha":""}'   # 400 DADOS_FALTANDO
curl -s localhost:3000/sessao/eu                       # 401 (sem cookie)
```

Uma entrada de verdade só pode ser medida com **uma conta real da plataforma** — que eu não tenho.
É o único item deste contrato que ficou por medir, e está dito assim no relatório.
