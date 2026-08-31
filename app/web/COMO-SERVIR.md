# Como o motor serve esta interface

> **Doc 33, Etapa 4.** Este pacote (`app/web/`) é a tela do editor de fluxo, mudada de casa do NOC
> para o ecossistema do Ragnabot. Ele constrói para **estático** (HTML/JS/CSS em `app/web/dist/`) e
> quem o serve é o `ragnabot-motor`.
>
> ⚠️ **Eu não editei `app/src/servidor.js` nem `app/Dockerfile`** — são de outro dono. O que segue é
> o trecho exato para o chefe acrescentar, e o porquê de cada linha.

---

## 1. O trecho para `app/src/servidor.js`

**Onde:** logo **depois** da linha do `/vivo` e **antes** da seção «DESLIGAMENTO ELEGANTE».

A ordem importa e não é gosto: o `express.static` e o desvio-para-a-página precisam vir **depois**
de todas as rotas `/api/ragnabot-*`, do `/saude` e do `/vivo`. Um desvio-para-a-página montado antes
engoliria a API inteira — todo `GET /api/…` responderia com o HTML da tela, e o operador veria
"resposta inválida" sem uma linha de erro em lugar nenhum.

```js
// ════════════════════════════════════════════════════════════════════════════════════════════════
// A INTERFACE (doc 33, Etapa 4) — a tela do editor de fluxo, servida pelo próprio motor.
//
// ⚠️ ESTE BLOCO VEM DEPOIS DE TODAS AS ROTAS. O desvio-para-a-página é um curinga: montado antes
// da API, ele responde HTML a `GET /api/…` e a tela quebra sem mensagem de erro.
//
// A pasta é opcional de propósito: se a imagem for construída sem a interface (ou em
// desenvolvimento, quando quem serve é o `vite`), o motor sobe igual e só não tem tela. Atendimento
// não pode depender de front-end existir.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_INTERFACE = process.env.RAGNABOT_INTERFACE_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const TEM_INTERFACE = fs.existsSync(path.join(PASTA_INTERFACE, 'index.html'));

if (TEM_INTERFACE) {
  // ⛔ AQUI HAVIA `app.get('/interface/configuracao.js', …)`. REMOVIDO em 30/08/2026 pelo
  // contrato S4-AUTH — era exatamente a pendência do §3 deste arquivo, e o chefe escolheu o
  // caminho (C). NÃO reponha: aquele endpoint injetava o RAGNABOT_SERVICE_TOKEN no navegador.
  // Quem autentica a tela agora é `src/rotas-sessao.js` (cookie de sessão). O que montar, e em que
  // ordem, está em `app/src/COMO-MONTAR-SESSAO.md`.

  // ── 2. Os arquivos ────────────────────────────────────────────────────────────────────────────
  // `index: false` porque quem responde a raiz é o desvio abaixo — assim há UM caminho só para o
  // HTML, e o cabeçalho de cache é o mesmo em `/` e em `/qualquer-coisa`.
  app.use(express.static(PASTA_INTERFACE, { index: false, maxAge: '7d', etag: true }));

  // ── 3. O desvio-para-a-página ─────────────────────────────────────────────────────────────────
  // A tela guarda o fluxo aberto no `#hash`, não no caminho — mas o operador ainda pode colar uma
  // URL antiga (`/ragnabot-fluxos/<id>`), e um F5 numa dessas tem de devolver a página, não 404.
  //
  // ⚠️ AS EXCLUSÕES NÃO SÃO ENFEITE. Sem elas, um `GET /api/ragnabot-fluxo/saude` digitado errado
  // devolveria HTML com status 200, e quem estivesse diagnosticando leria "o motor respondeu".
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path === '/saude' || req.path === '/vivo') return next();
    // A entrada de sessão responde JSON, sempre. Sem esta linha, um `GET /sessao/eu` com
    // `Accept: text/html` receberia a PÁGINA, e a tela leria "<" onde esperava JSON.
    if (req.path.startsWith('/sessao')) return next();
    // ⚠️ Só NAVEGAÇÃO. Um `.js`/`.css`/`.woff2` que não existe TEM de dar 404: devolver HTML no
    // lugar de um módulo faz o navegador falhar com "Unexpected token '<'", que não diz nada a
    // ninguém, e ainda por cima com status 200 — o pior dos dois mundos para quem diagnostica.
    //
    // ⛔ NÃO use `req.accepts('html')` aqui. Foi o que escrevi primeiro e o teste reprovou: um
    // pedido com `Accept: */*` (que é o que `fetch` manda por padrão, e o que várias sondas mandam)
    // CASA com 'html', e o arquivo inexistente voltava 200 com a página dentro.
    // Os dois filtros abaixo são o discriminador certo:
    //   · navegador navegando manda `Accept: text/html,…` explícito; buscar módulo/imagem, não;
    //   · caminho com extensão é pedido de ARQUIVO, e arquivo que não existe é 404, ponto.
    if (!(req.get('Accept') || '').includes('text/html')) return next();
    if (path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store');   // o index aponta para arquivos com hash; cachear o
    return res.sendFile(path.join(PASTA_INTERFACE, 'index.html'));   // index serve a versão velha
  });

  logger.info(`[ragnabot] interface servida de ${PASTA_INTERFACE}`);
} else {
  logger.warn('[ragnabot] interface NÃO encontrada — o motor sobe sem tela (só API)');
}
```

**Variáveis novas** (nenhuma obrigatória; sem elas o bloco se comporta como descrito):

| Variável | Para quê | Padrão |
|---|---|---|
| `RAGNABOT_INTERFACE_DIR` | onde está o `dist` construído | `<raiz>/web/dist` |


⛔ **As três variáveis `RAGNABOT_INTERFACE_ATOR_*` saíram** (30/08/2026). Elas registravam **um
operador genérico** para todo mundo na auditoria — perda de rastro apontada no §3 e resolvida pelo
caminho (C): agora a auditoria registra **quem entrou**, com o id da conta da plataforma.

**Sugestão para o `/saude`** (opcional, e por isso fora do bloco acima): acrescentar
`interface: TEM_INTERFACE ? 'servida' : 'ausente'` ao objeto `out`. Sem isso, "a tela não abre" e "a
imagem subiu sem a tela" são indistinguíveis de fora, e alguém vai passar uma tarde nisso.

---

## 2. O trecho para `app/Dockerfile`

O contexto de build **continua sendo a raiz do repositório** (é lá que mora `VERSAO`), então os
caminhos levam o prefixo `app/`, como os que já existem.

**(a) Nova etapa de construção — inserir depois da etapa `dependencias` e antes de `producao`:**

```dockerfile
# ── Etapa 1b: a interface (doc 33, Etapa 4) ─────────────────────────────────────────────────────
# Pacote próprio, com node_modules próprio: a tela não empresta as dependências do motor, e o motor
# não carrega React em produção. Foi a lição da Etapa 1 — ambiente emprestado mente sobre onde você
# está (naquele caso, um atalho para o node_modules do NOC fez teste local bater no banco de
# produção).
FROM node:20-alpine AS interface

WORKDIR /web

# package.json antes do código: se só a tela mudar, o npm ci reaproveita a camada.
COPY app/web/package.json app/web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY app/web/ ./
RUN npm run build
```

**(b) Na etapa `producao`, junto dos outros `COPY` (por exemplo depois de `COPY app/src ./src`):**

```dockerfile
# A tela construída. Fica em /app/web/dist porque é onde `PASTA_INTERFACE` a procura por padrão.
COPY --from=interface /web/dist ./web/dist
```

⚠️ **A linha `RUN mkdir -p logs && chown -R node:node /app` tem de continuar DEPOIS deste `COPY`.**
Ela é quem dá a posse dos arquivos ao usuário `node`; um `COPY` colocado abaixo dela entra como
`root` e o processo não-root lê — mas qualquer coisa que precise escrever ali falha. Hoje a ordem
no arquivo já está certa; é só não inverter.

⚠️ **`EXPOSE 3000` no Dockerfile, `PORT || 3100` no `servidor.js`.** Não é problema desta etapa e não
mexi nisso — o `EXPOSE` é declarativo e não muda o comportamento —, mas os dois números divergem e
alguém vai tropeçar. Vale alinhar quando o chefe for mexer no manifesto.

---

## 3. ⛔ A pendência de segurança — ✅ RESOLVIDA em 30/08/2026, caminho (C)

> **O chefe escolheu o caminho (C)**: a tela autentica contra a plataforma. Implementado no contrato
> S4-AUTH — `app/src/rotas-sessao.js` (entrada/saída/quem-sou-eu), `app/src/base/auth.js` (passou a
> aceitar cookie de sessão **além** do token de serviço, e a IGNORAR o cabeçalho de papel quando a
> chamada vem por cookie) e a tela de entrada em `app/web/src/paginas/Entrada.jsx`. Prova:
> `app/src/base/testes/auth.test.mjs` (13 verificações, o teste (c) é o que barra a escalada).
> Como montar: **`app/src/COMO-MONTAR-SESSAO.md`**.
>
> O texto original abaixo fica como está — é o diagnóstico que motivou a decisão, e apagá-lo
> apagaria o porquê.

### Diagnóstico original (mantido)

O contrato desta tarefa disse, com todas as letras: *"use o mesmo esquema do `src/base/auth.js` do
motor (token de serviço + ator declarado), lendo o token de onde o motor o injetar"*. Foi o que fiz.
Mas medi a consequência e ela precisa estar escrita:

1. `base/auth.js` compara o cabeçalho `x-ragnabot-service-token` **apenas** com
   `RAGNABOT_SERVICE_TOKEN`. Para a tela funcionar **hoje**, é esse valor que o motor injeta.
2. Injetá-lo significa que **qualquer navegador que alcance a página recebe o token de serviço.**
   Não há login no motor: quem chegar na URL, chega.
3. E o papel viaja em cabeçalho que o cliente controla (`x-ragnabot-ator-papel`). Quem tiver o token
   se declara `super` — e `superuserOnly` passa. **O que trava dinheiro e empresa deixa de travar.**

Isto é exatamente o limite que o próprio doc 33 §7.2 escreveu: *"quem controla o cabeçalho controla
o escopo, e o isolamento entre empresas que provamos com teste vira enfeite"*. A ponte era para ser
serviço-a-serviço (NOC → Ragnabot, dois processos nossos). Estendê-la ao **navegador** é outra coisa.

**Os três caminhos, para o chefe escolher — nenhum deles é meu para decidir:**

| | O que é | Custo | O que resolve |
|---|---|---|---|
| **A** | Ligar como está, com a interface alcançável só pela rede interna (sem Ingress público; acesso por `kubectl port-forward` ou VPN) | zero de código | Reduz quem alcança. **Não** resolve: qualquer operador com acesso interno vira `super`. |
| **B** | O motor emite credencial curta por sessão (assinada, com o papel DENTRO dela) e `base/auth.js` passa a aceitá-la além do token de serviço | pequeno, no motor — a tela **não muda** | O papel deixa de ser afirmado pelo cliente. Resolve o item 3. |
| **C** | A tela autentica contra a plataforma (Chatwoot), como o doc 33 §7.3 previu para o fim da Etapa 4 | maior | Resolve tudo, e encerra a ponte como estava planejado. |

**A tela está pronta para os três.** `src/lib/api.js` só lê `window.__RAGNABOT__` e repassa: se o
motor trocar o que injeta, **nenhuma linha da interface muda**. Foi essa a costura desenhada.

**Também pendente, e menor:** com o ator vindo de variável de ambiente, a auditoria registra **um
operador genérico** para todo mundo. No NOC ela registrava quem clicou. É perda real de rastro, e
some sozinha no caminho **B** ou **C**.

---

## 4. Como conferir que ficou de pé

```bash
cd app/web && npm ci && npm run build     # tem de terminar com "✓ built in …"
node web/tests/servir.smoke.mjs           # sobe o trecho do §1 e mede as 7 respostas
```

O `servir.smoke.mjs` **usa o trecho do §1 literalmente** — se o snippet acima estiver errado, o
teste fica vermelho. É o que impede este arquivo de virar documentação que descreve outra coisa.

⚠️ **A interface tem de ser montada na RAIZ**, e isto é medido, não opinião: `CapaSecao.jsx` pede a
foto em `/capas/capa-clientes.jpg`, caminho **absoluto** dentro do JavaScript. Montada sob prefixo
(`/interface/`), a foto dá 404 — a tela funciona, mas a capa nasce sem imagem. Os demais arquivos
(JS/CSS/fonte) são relativos (`base: './'` no `vite.config.js`) e sobrevivem ao prefixo. Se um dia o
prefixo for necessário, é **uma linha** em `CapaSecao.jsx` (o mapa `FOTO`), não uma reforma.
