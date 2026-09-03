# S6 — CONEXÕES E CAMADA DE PROVEDOR

> **Data:** 02/09/2026 · **Onde:** `ragnatelaiot/ragnabot`, pacotes `app/` e `app/web/`
> **Plano:** doc 34 §F9.2.2 a §F9.2.7 e §F9.4 · doc 36 (Efí, só no que toca à assinatura reusada)
> **Estado:** código escrito e provado com dublê. **Migração NÃO aplicada, nada publicado, versão
> NÃO alterada, carteiro de webhook DESLIGADO.** Tudo isso é decisão do chefe (lote).

---

## 0. A decisão que moldou esta entrega

O sistema que a empresa usa hoje delega os canais a **dois intermediários externos** (ConnectAi e
OficialAPI, doc 34 §F9.0). Decisão registrada do dono: **não copiar isso** — a mensagem do cliente
não transita pela infra de outra empresa. O Ragnabot fala direto com a Meta.

O que faltava, então, não era o transporte: era **a entrada da empresa cliente**. E a peça que
permite decidir DEPOIS qual caminho contratar, sem reescrever nada, é a **camada de provedor** —
por isso ela é a estrela desta entrega, e não a tela.

---

## 1. O que JÁ EXISTIA (medido antes de escrever uma linha)

| Peça | Onde | O que faltava |
|---|---|---|
| Cadastro das conexões (`RagnabotInbox`) | `schema.prisma` | quem OPERA, o estado, o reinício |
| Reconciliação automática com a plataforma (15 min) | `ragnabot-tenant.service.js#sincronizarCaixasDeTodasAsEmpresas` | nada — foi reusada inteira |
| **Regra** de cota por plano | `config/ragnabot-plans.js#cabeMaisUmaCaixa` | a LEITURA (limite × ativos × uso %) e uma recusa que não dependa da plataforma estar de pé |
| Registro de cada envio ao canal | `RagnabotFluxoEfeito` (`httpStatus`, `erro`, `resposta`) | a leitura por conexão — **nenhuma tabela nova de log** |
| Projeção da fila com `cwInboxId` | `RagnabotConversa` | de ONDE a conversa veio ao trocar de conexão |
| Assinatura HMAC-SHA256 de corpo | embutida em `ragnabot-cobranca.routes.js:365` | ser uma peça só, servindo aos DOIS sentidos |
| Cache de canal por conversa | `ragnabot-canal.porta.js#esquecerCanais` | alguém que o soltasse sem `kubectl` |

⚠️ **Correção de um erro do plano:** o doc 34 §F9.4 cita `verificarAssinaturaMeta` como se
existisse. **Não existe** no repositório — `grep -rn "createHmac" src/` em 02/09/2026 devolveu três
pontos e nenhum módulo comum. O que existia era a conferência do retorno da Efí. Ela foi extraída
para `src/base/assinatura.js` e agora serve para receber **e** para assinar.

---

## 2. O que foi construído

### 2.1 Backend

| Arquivo | Linhas | O que é |
|---|---|---|
| `app/src/base/assinatura.js` | 128 | HMAC-SHA256 de corpo — assinar, conferir, comparar sem vazar tempo. **A mesma peça nos dois sentidos** |
| `app/src/services/ragnabot-provedor.service.js` | 261 | ⭐ **a camada de provedor**: catálogo, combinação canal×provedor, composição da capacidade |
| `app/src/services/ragnabot-conexao.service.js` | 801 | cartão, cota, estado, reinício, transferência, registro por canal |
| `app/src/services/ragnabot-api-publica.service.js` | 357 | credencial de API por empresa: emitir, listar, regenerar, revogar, autenticar |
| `app/src/services/ragnabot-webhook-saida.service.js` | 633 | webhook de saída: cadastro, fila, assinatura, recuo, disjuntor, reenvio manual |
| `app/src/routes/ragnabot-conexao.routes.js` | 379 | as rotas das três frentes |
| `app/prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql` | 225 | a migração, **zero `DROP` executável** |

**Tocados (extensão, nunca reescrita):** `ragnabot-canal.porta.js` (4 pontos),
`ragnabot-chatwoot.porta.js` (2), `ragnabot-tenant.service.js` (4), `ragnabot-cobranca.routes.js`
(passou a usar a peça comum), `servidor.js` (1 montagem + 1 trabalhador declarado desligado).

### 2.2 Interface

| Arquivo | Linhas | O que é |
|---|---|---|
| `app/web/src/lib/api-conexoes.js` | 175 | camada de rede + vocabulário puro (sinal, frescor, cota) |
| `app/web/src/paginas/Conexoes.jsx` | 344 | a tela: cartão por canal, painel de cota, busca, ações |

**Tocados:** `navegacao.js` (+1 item de menu), `main.jsx` (+1 rota), `Casca.jsx` (a nota do menu
passou a dizer a verdade nova).

### 2.3 Banco

**+4 tabelas** (`RagnabotApiCredencial`, `RagnabotWebhookSaida`, `RagnabotWebhookEntrega`,
`RagnabotConexaoTransferencia`) e **+10 colunas** (8 em `RagnabotInbox`, 2 em `RagnabotConversa`).
Total do schema: **57 tabelas** — o mesmo número de modelos `Ragnabot*`.

---

## 3. A camada de provedor, e por que ela é a peça central

```
   CANAL     o meio pelo qual o cliente fala      whatsapp · instagram · web_widget · email · …
   PROVEDOR  quem opera esse meio para nós        meta_direto · whatsmeow · terceiro · nativo
```

Eixos **independentes**. O motor de fluxo nunca soube o que é um provedor e continua sem saber: o
único ponto de contato é `capacidadeEfetiva(canal, provedor)`, cujo resultado tem **exatamente a
mesma forma** de `CAPACIDADES[canal]`. O motor lê `capacidade.interativo` e `capacidade.botoesMax`
como sempre leu.

**Composição sempre RESTRITIVA:** provedor pode tirar capacidade, nunca acrescentar. Se um provedor
novo fizer algo que o canal não faz, o lugar de mudar é a tabela do CANAL — porque aí a novidade é
do canal e vale para todos.

⚠️ **O quarto valor, fora dos três do documento.** O doc 34 escreve
`meta_direto | whatsmeow | terceiro`, e os três dizem respeito a WhatsApp/redes da Meta. Metade das
conexões da casa não é disso: site, e-mail e Telegram são operados pela própria plataforma. Marcar
um widget como «meta_direto» seria gravar uma mentira no banco para caber num enum. `nativo` diz a
verdade: não há terceiro no caminho.

⚠️ **Capacidade de `whatsmeow` e `terceiro` veio de LEITURA, não de medição** — e cada uma carrega
`origem: 'documentacao'`, igual ao que `RagnabotFluxoLimiteCanal` faz com os limites da Meta. Vale o
pior caso até alguém medir.

---

## 4. O que foi provado, e como

| Bateria | Arquivo | Medições |
|---|---|---|
| Camada de provedor (estático + dinâmico) | `app/tests/ragnabot-provedor.test.mjs` | **22 / 22** |
| Conexões: cota, reinício, transferência, registro | `app/tests/ragnabot-conexao.test.mjs` | **36 / 36** |
| Credencial de API + assinatura HMAC | `app/tests/ragnabot-api-publica.test.mjs` | **28 / 28** |
| Webhook de saída: fila, recuo, teto, disjuntor | `app/tests/ragnabot-webhook-saida.test.mjs` | **36 / 36** |
| A tela | `app/web/tests/conexoes.smoke.mjs` | **21 / 21** |
| **Total** | | **143 / 143, zero reprovações** |

### As três provas que mais importam

**(a) O provedor não vaza para o motor** — por dois caminhos independentes:
- *estático*: varre `ragnabot-fluxo-{motor,nos,fila,publicacao}.service.js`,
  `ragnabot-portaria.service.js` e `ragnabot-atend-despertar.service.js` atrás de
  `whatsmeow`/`meta_direto`/`terceiro`/`oficialapi`/`connectai` → **zero ocorrências**; e confere
  que nenhum dos catorze despachos do adaptador cita `provedor`;
- *dinâmico*: o MESMO menu, com o MESMO código, sai como **botões interativos** quando a conexão
  está em `meta_direto` e como **texto numerado** quando está em `whatsmeow`. Entre as duas
  medições muda **um campo do banco**, nada mais.

**(b) A assinatura confere DO LADO DO DESTINO.** O dublê de rede guarda os bytes que trafegaram, e
a conferência é feita com o `crypto` do Node, **sem chamar o nosso código de assinar** — que é a
única forma de o teste não provar a si mesmo.

**(c) O evento não some.** Destino responde 503 → a entrega vira `falhou` com a próxima tentativa
gravada numa **coluna** (não num `setTimeout`) → antes da hora ela não é tentada → depois da hora
é, com o corpo **byte a byte igual** (senão a assinatura mudaria entre tentativas) → esgotadas as
tentativas vira `desistiu`, grita no log como **erro** e **não se repete sozinha**.

---

## 5. O que este trabalho NÃO prova — dito antes de alguém descobrir

1. **Nada em produção.** Em 02/09/2026 o Ragnabot tem **ZERO caixas de WhatsApp** e nenhum webhook
   cadastrado na plataforma. Tudo aqui é dublê e contrato lido.
2. **A plataforma não move a caixa de entrada de uma conversa.** `PATCH …/conversations/:id` aceita
   status, prioridade e times — não `inbox_id`. Isto é **leitura do contrato da API**, não medição.
   Consequência assumida e declarada em coluna (`moveuNaPlataforma: false`), na mensagem da tela e
   no registro: o que a transferência move é o NOSSO roteamento (a projeção que o agente lê e que o
   motor consulta), a origem registrada em cada conversa, e um **aviso interno** na conversa lá fora.
3. **Reiniciar conexão de `whatsmeow`/`terceiro` não faz nada** — e o botão **diz isso**, com o
   motivo. Botão que pisca «pronto» sem ter feito nada é o pior resultado possível numa tela de
   suporte.
4. **Os dois testes vermelhos da bateria** (`ragnabot-fluxo-publicacao` e
   `ragnabot-respostas-rapidas`) já estavam vermelhos antes: exigem PostgreSQL alcançável, e esta
   estação não tem. **Não foram quebrados por esta entrega.**

---

## 6. Pendências e decisões

| # | O quê | De quem é |
|---|---|---|
| 1 | Aplicar `prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql` e **reiniciar** (o cliente Prisma só carrega no arranque) | chefe |
| 2 | Ligar (ou não) o carteiro de webhook — `webhooks.iniciarCarteiro()` | chefe |
| 3 | **Qual provedor contratar** (caminho A/B/C do doc 34 §F9) | **dono** — a camada já permite escolher sem reescrever |
| 4 | Medir de verdade a capacidade de `whatsmeow` quando houver instância | depois da decisão 3 |
| 5 | Emissão de eventos: só `conexao.estado` e `conexao.transferencia` são emitidos hoje. `conversa.*` e `mensagem.*` estão no catálogo e ainda não têm quem os enfileire | próxima frente |
| 6 | Autenticar chamadas EXTERNAS pela credencial de API — o serviço `autenticar()` existe e está provado; **falta o roteador público** que o consuma | próxima frente |
