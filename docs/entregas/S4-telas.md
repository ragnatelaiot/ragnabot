# S4 — TELAS: o editor de fluxo muda de casa

> **Ordem do dono (30/08/2026):** *"nada fica no noc, absolutamente nada, o Ragnabot deve ser 100%
> dentro do ecossistema dele com kubernetes e o PostgreSQL, o noc eh apenas monitoramento"*.
> **Plano:** doc 33, Etapa 4. **Estado:** código pronto e provado; **não implantado** — o chefe revisa
> e decide.

## 0. O que era, e o que passou a ser

| | Antes (NOC) | Agora (Ragnabot) |
|---|---|---|
| A tela | `frontend/src/pages/FluxosRagnabot.jsx`, dentro do pacote do NOC | `app/web/src/paginas/FluxosRagnabot.jsx`, pacote próprio |
| Quem serve | `nginx` servindo o `dist` do NOC | o `ragnabot-motor`, mesma origem da API |
| Quem autentica | cookie de sessão do NOC | esquema de `app/src/base/auth.js` (token de serviço + ator declarado) |
| Tema | `styles/index.css` do NOC (3.127 linhas) | `app/web/src/estilos/tema.css` (só o que a tela usa) |

Era a última peça de produto morando na casa errada.

## 1. O que veio, e o que ficou

O levantamento foi por `grep` nos `import`, não por presunção. A tela importa **quatro** coisas:
`react`, `lucide-react`, `components/CapaSecao.jsx` e `forceSessionExpired` de `lib/api.js`.

**Veio:**

| Peça | Como veio |
|---|---|
| `FluxosRagnabot.jsx` (5.091 linhas; 5.119 no NOC) | cópia fiel — 3 mudanças funcionais, listadas no §2 |
| `CapaSecao.jsx` | **byte a byte idêntico** (`diff -q` limpo) |
| `public/capas/capa-clientes.jpg` | idêntica (`md5` confere) — é a única `secao` que a tela pede |
| ~22 tokens de cor + `.btn`/`.btn-primary`/`.btn-secondary`/`.spinner`/`.capa*` + reinício de caixa | recortados do `index.css` do NOC com os **valores literais**, em `estilos/tema.css` |

**NÃO veio, e o porquê:**

| O que | Por que ficou |
|---|---|
| `lib/api.js` do NOC (~98 KB) | dezenas de métodos de Zabbix, Proxmox, Guacamole, alertas e backup. Nada é do Ragnabot. Vieram as **convenções**, não o código |
| `forceSessionExpired` | limpa `localStorage.noc_user` e emite `noc:auth-expired`, que o layout do NOC escuta. Nada disso existe aqui |
| As outras 11 fotos de capa | esta tela só pede `clientes`. Foto sem tela que a use é peso |
| `--sev-*`, `--serie-*` (menos a 5), tema de impressão, esqueleto, aviso flutuante, menu lateral | a tela não referencia nenhum |
| Do `main.jsx` do NOC: service worker, captura de IP por WebRTC, remendo do `vite:preloadError`, troca de título por subdomínio | nenhum é desta tela; entram quando houver decisão |
| `react-router-dom` | a tela guarda o fluxo aberto no `#hash`, não no caminho — nunca precisou de roteador |

## 2. As TRÊS mudanças funcionais (e só três)

`diff` contra o original: 5 blocos, sendo 2 só de comentário.

1. **A camada de rede saiu do arquivo** e virou `src/lib/api.js`. O corpo do `chamarFluxo` é o mesmo;
   o que mudou é de onde sai a credencial — antes cookie do NOC, agora `window.__RAGNABOT__`
   injetado pelo motor, repassado nos cabeçalhos que `base/auth.js` confere.
2. **`lerUsuarioDoNavegador()`** deixou de ler `localStorage.noc_user` (chave do login do NOC) e
   passou a ler o ator injetado. **Sem isto o defeito seria calado:** a função devolveria `null` para
   todo mundo e o campo de empresa da modal de criação sumiria — o super usuário perderia a única
   forma de criar fluxo para outra empresa, e ninguém veria erro nenhum.
3. **O caminho de `CapaSecao`** acompanhou a pasta (`componentes/`, não `components/`).

`BASE_FLUXO` **não** mudou: o motor monta `/api/ragnabot-fluxo` no mesmo caminho do NOC, então
nenhuma das 21 chamadas da tela precisou ser reescrita.

## 3. O que foi medido

`npm run build` → `✓ built in 4.11s`, `dist/assets/index-*.js` 287 kB (88,86 kB comprimido).

Dois testes, rodados com `node` puro (mesmo hábito do motor):

- **`tests/servir.smoke.mjs` — 8 de 8.** Sobe o trecho de `COMO-SERVIR.md §1` **literalmente** e mede:
  a raiz devolve a página · a credencial chega com `no-store` · o módulo servido é o pacote certo ·
  a foto está no pacote · a API **não** é engolida pelo desvio-para-a-página · a sonda `/vivo`
  também não · URL antiga de fluxo devolve a página · arquivo inexistente dá **404**.
- **`tests/monta.smoke.mjs` — 5 de 5.** Renderização do lado do servidor: a tela **monta** sem nada
  do NOC por perto, com a capa, a folha de estilo própria e as classes do tema; e sem `noc_user`
  nem `noc:auth-expired` no HTML.

⚠️ **O que os testes NÃO provam, e não vou fingir que provam:** não há navegador aqui. Os `useEffect`
não rodam — busca de `/saude`, lista de fluxos, arraste, zoom e atalhos ficam de fora. Isso só se
mede com navegador contra um motor no ar, depois de implantar.

### O defeito que o teste achou no meu próprio trecho
A primeira versão do desvio-para-a-página usava `req.accepts('html')`. Um pedido com `Accept: */*`
(o padrão do `fetch` e de várias sondas) **casa** com `html`: um `.js` inexistente voltava **200 com a
página dentro**, e o navegador falharia com `Unexpected token '<'` — erro que não diz nada a ninguém.
Trocado por `Accept` explícito + recusa de caminho com extensão. Está comentado no lugar, para não
ser "simplificado" de volta.

## 4. O que o chefe precisa fazer

`app/web/COMO-SERVIR.md` tem os dois trechos prontos, com o porquê de cada linha:
- **`app/src/servidor.js`** — `express.static` + `/interface/configuracao.js` + desvio-para-a-página,
  a ser colado **depois** do `/vivo` (montado antes, o curinga engole a API inteira).
- **`app/Dockerfile`** — etapa `interface` (node_modules próprio) + `COPY --from=interface`.

Eu **não** editei nenhum dos dois — são de outro dono.

## 5. ⛔ A pendência que decide se isto pode ir ao ar

`base/auth.js` só aceita `RAGNABOT_SERVICE_TOKEN`. Para a tela funcionar **hoje**, é esse valor que
o motor injeta no navegador. Consequência medida:

1. qualquer navegador que alcance a página recebe o **token de serviço** — não há login no motor;
2. o papel viaja em cabeçalho que o cliente controla (`x-ragnabot-ator-papel`), então **quem tiver o
   token se declara `super`** e `superuserOnly` passa.

É exatamente o limite que o doc 33 §7.2 escreveu: *"quem controla o cabeçalho controla o escopo, e o
isolamento entre empresas que provamos com teste vira enfeite"*. A ponte foi desenhada para
**serviço a serviço** (dois processos nossos); estendê-la ao **navegador** é outra coisa.

Três caminhos, detalhados em `COMO-SERVIR.md §3`: **(A)** ligar com a interface só na rede interna
(reduz quem alcança, não resolve o papel) · **(B)** o motor emitir credencial curta por sessão com o
papel dentro dela (pequeno, e **a tela não muda**) · **(C)** autenticar contra a plataforma, como o
doc 33 §7.3 já previa para o fim da Etapa 4.

**A costura foi desenhada para os três:** `src/lib/api.js` só lê `window.__RAGNABOT__` e repassa.

**Pendência menor, do mesmo nó:** com o ator vindo de variável de ambiente, a auditoria registra um
**operador genérico** para todo mundo. No NOC ela registrava quem clicou. Some sozinha em **B** ou **C**.

## 6. Fora do alcance desta etapa
- **Implantação.** Nada foi commitado, aplicado no cluster ou reiniciado.
- **A tela do cluster do Ragnabot** continua sendo do NOC de propósito (doc 33 §4: monitorar é dele).
- **Divergência achada de passagem:** `EXPOSE 3000` no `Dockerfile` × `PORT || 3100` no
  `servidor.js`. Não mexi (o `EXPOSE` é declarativo), mas alguém vai tropeçar.
