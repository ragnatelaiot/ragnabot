# S4-EMPRESAS — a tela de cadastro de empresas

> **Data:** 30/08/2026 · **Onde:** `ragnatelaiot/ragnabot`, pacote `app/web/`
> **Motivo:** cobrança do dono — *"ainda não vi tela para criar empresas"*. A API de multiempresa
> existe desde 28/08 e funciona (o chefe criou a primeira empresa por ela), mas **nunca houve tela**.
> Sem tela, "cadastrar empresa" quer dizer "pedir para o Claude cadastrar" — e isso não é produto.
> **A tela nasceu no Ragnabot**, nunca no NOC (ordem geral: *"nada fica no NOC, absolutamente nada"*).

---

## 1. O que foi entregue

| Arquivo | Linhas | O que é |
|---|---|---|
| `app/web/src/lib/api-empresas.js` | 341 | camada de rede + validação copiada do servidor |
| `app/web/src/paginas/EmpresaFormulario.jsx` | 365 | tijolos visuais, formulário e modal de cadastro |
| `app/web/src/paginas/Empresas.jsx` | 668 | a página: lista, busca, filtro, ações, modal de 2FA |
| `app/web/tests/empresas.smoke.mjs` | 330 | 27 medições — **27 passaram** |
| `app/web/src/paginas/COMO-LIGAR-EMPRESAS.md` | — | o trecho que o chefe acrescenta em `main.jsx` |

**Nada** de `main.jsx`, `lib/api.js`, `app/src/**` ou `/ia/netagent` foi tocado. Nada foi commitado,
aplicado no cluster nem reiniciado.

---

## 2. O que a API REALMENTE exige (medido, não suposto)

Lido em `services/ragnabot-tenant.service.js#provisionarEmpresa`:

| Campo | Obrigatório | Regra REAL |
|---|---|---|
| `nome` | sim | 2 a 120 caracteres |
| `slug` | sim | **minusculado antes de validar**; `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` (3 a 40) |
| `contatoNome` | sim | 2 a 120 |
| `contatoEmail` | sim | `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`, minusculado, ≤160, **único entre empresas** |
| `plano` | não | cai em `essencial`; precisa existir no catálogo |
| `cnpj` | não | só dígitos, corta em 14 |
| `contatoWhatsapp` | não | só dígitos, corta em 15 |
| `limitesOverride` | não | contrato negociado — **não exposto na tela, de propósito** |
| `retencaoDias` | não | só aceito como **número** (`Number.isFinite`); string é descartada em silêncio |
| `justificativa` | **sim** | exigida pelo portão do router em toda ação que muda o mundo |
| `otpCode` + `otpChannel` | **sim** | segundo passo do aperto de mão de 2FA |

**Armadilha do contrato:** o primeiro pedido, **sem** `otpCode`, responde **HTTP 200** com
`{needs2fa:true, channels, emailHint}`. Quem tratar "200 = deu certo" mostra «empresa criada» sem
ter criado nada. Por isso a camada de rede devolve `precisaDe2fa` como **campo**, e a modal tem
duas etapas visíveis: preparar → confirmar com o código.

**Estados do contrato** (`RagnabotTenant.status`): `trial` · `active` · `past_due` · `suspended` ·
`closed`. Os cinco têm rótulo em português na tela.

---

## 3. ⚠️ TRÊS DEFEITOS DO SERVIDOR, MEDIDOS — nenhuma escrita funciona hoje

Montei `routes/ragnabot-tenant.routes.js` num Express de teste (banco apontado para porta morta de
propósito, sem `.env`, sem tocar em produção) e bati nas rotas:

```
### ator com papel «admin» (o que o cookie da plataforma dá)
GET  /planos      → 500 Cannot find module '…/src/services/device.service.js'
GET  /tenants     → 500 (mesma causa)
POST /tenants     → 500 (mesma causa)

### ator com papel «super» (ponte NOC→Ragnabot)
GET  /planos      → 200 {"success":true,"data":{"planos":[…]}}
GET  /tenants     → 400 Can't reach database server (esperado: a porta morta era minha)
POST /tenants     → 400 Cannot read properties of undefined (reading 'findUnique')
POST /tenants+2fa → 400 Cannot find module '…/src/services/otp.service.js'
```

1. **`device.service.js` ficou no NOC.** O guarda do router (`router.use`) o importa para conferir
   acesso ao grupo RAGNATELA. Superusuário sai antes por `return next()`; **todo o resto toma 500**.
2. **`prisma.user` não existe na base do Ragnabot.** O schema daqui tem só os 40 modelos do produto;
   `User` é do NOC. O passo que pergunta "por onde você quer o código" quebra aí.
3. **`otp.service.js` ficou no NOC.** Conferir o código é impossível.

Somando com o **`base/auth.js`**, que devolve `isSuperuser: false` para **toda** sessão de cookie:
**quem entra pela tela nunca passa do guarda**. Leitura só funciona pela ponte de serviço.

As três peças já estão no **doc 33 §8** com destino decidido (identidade, validação e 2FA mudam de
casa). A tela foi escrita para o contrato **certo** e mostra o diagnóstico exato quando esbarra
neles — `diagnosticar()` em `api-empresas.js` traduz as três mensagens em causa, **ao lado** da
mensagem do servidor, nunca no lugar dela.

---

## 4. Decisões desta tela

- **Validação na camada de rede, não no componente.** `criarEmpresa` e `excluirDefinitivamente`
  **recusam antes de tocar na rede**. Isso torna a recusa uma propriedade do módulo — e por isso ela
  é mensurável com um dublê de `fetch` que **conta chamadas**. Validação que só existe dentro de um
  `onSubmit` ninguém consegue medir.
- **Confirmação digitada em ENCERRAR também**, e não só em excluir. O servidor só exige no expurgo;
  a exigência a mais é decisão do contrato S4-EMPRESAS — encerrar tira o acesso de toda a equipe do
  cliente.
- **Botão só aparece quando a ação é possível**, com a MESMA regra do servidor (reativar só de
  `suspended`; excluir só de `closed`). Botão que existe para dar erro ensina o operador a
  desconfiar da tela.
- **Dois vazios diferentes.** «Nenhuma empresa cadastrada ainda» (com o botão de cadastrar, e
  dizendo em voz alta que **não é falha de carregamento**) ≠ «nenhuma empresa casa com a busca».
- **Tijolos visuais copiados de `FluxosRagnabot.jsx`, e declarado que são cópia.** Aquele arquivo é
  autocontido por decisão registrada e não exporta tijolo nenhum; importar de lá exigiria editá-lo,
  e ele é de outro dono. Quando alguém extrair os tijolos para `componentes/`, as duas telas trocam
  o import.
- **Zero cor literal, zero biblioteca nova.** Só `react`, `lucide-react` e `CapaSecao` — o mesmo
  conjunto da tela vizinha. Tokens de `estilos/tema.css`.
- **Nenhuma credencial na tela.** `credentials: 'same-origin'` em todo pedido; nada em
  `localStorage`; nenhum cabeçalho de ator (mandar papel do navegador foi o defeito que o cookie
  fechou, contrato S4-AUTH).

---

## 5. Prova

`node tests/empresas.smoke.mjs` — **27 de 27**. Cobre: recusa do identificador antes da rede (7
formas), normalização do corpo, ausência de credencial nos cabeçalhos, confirmação digitada em
excluir e encerrar, a lista mostrando o que veio, os dois vazios, os botões por estado e por papel,
e a página montando inteira.

`npm run build` — **compila** (1401 módulos, 3,88 s).
⚠️ Esse build **ainda não inclui** a tela nova, porque `main.jsx` (que não é meu) não a importa. O
que compila os três arquivos novos de ponta a ponta é o empacotamento SSR que o próprio teste faz
(`vite build --ssr src/paginas/Empresas.jsx`) — Vite + esbuild + rollup, com `lucide-react` e tudo.

---

## 6. O que falta na API para a tela ficar completa

1. **As três peças do §3** (sem elas, nenhuma escrita funciona).
2. **Busca no servidor.** `GET /tenants` só filtra por `status`. A tela busca no cliente por
   nome/identificador. Com poucas empresas é honesto; com centenas, tem de subir.
3. **Paginação.** Não existe. `listarEmpresas` devolve tudo.
4. **Contagem de uso por empresa** (quantos atendentes, quantas caixas, conversas do mês). Existe
   `RagnabotUsageSnapshot` no schema, mas nenhuma rota de leitura — a tela mostra o **limite** do
   plano, e não o **consumo**. É o número que o dono vai pedir primeiro.
5. **Editar cadastro.** Não há rota para trocar nome, contato, CNPJ ou WhatsApp depois de criado —
   só plano e ciclo de vida. Hoje, corrigir um e-mail digitado errado exige mexer no banco.
6. **Reabrir contrato encerrado.** `exigirTenant` recusa empresa `closed` para tudo, e `reativar`
   só aceita `suspended`. Uma empresa encerrada por engano fica sem caminho de volta pela API.
