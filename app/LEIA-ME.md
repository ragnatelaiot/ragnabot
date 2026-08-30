# `app/` — a aplicação do Ragnabot

O produto, como aplicação de verdade: schema próprio, camada de base própria, imagem própria.
Até 30/08/2026 este código morava dentro do NOC (`/ia/netagent`) e usava o banco dele. Se o NOC
caísse, o chatbot parava. Aqui ele deixa de depender.

> **Estado:** Etapa 1 do `33-PLANO-SEPARACAO-RAGNABOT.md` — **repositório**. Nada em produção
> mudou. O NOC continua rodando exatamente como estava, e nada foi removido dele.

## O que tem aqui

```
app/
├── package.json                 aplicação Node 18+ ESM
├── Dockerfile                   imagem enxuta, usuário não-root, sem segredo embutido
├── prisma/
│   ├── schema.prisma            as 40 tabelas `Ragnabot*` — e SÓ elas
│   └── sql/                     a estrutura do banco de verdade (ver prisma/sql/00-LEIA-ME.md)
├── src/
│   ├── base/                    ⭐ as 4 peças que substituem as do NOC
│   ├── config/                  configuração do produto (planos)
│   ├── services/                os serviços do produto
│   └── routes/                  a API do produto
└── deploy/ragnabot-motor.yaml   o Deployment ×2 réplicas (NÃO aplicado — entrega para revisão)
```

## `src/base/` — as 4 peças

Medido antes de escrever: os serviços do Ragnabot importavam do NOC exatamente quatro coisas.
Aqui elas têm equivalente com a **mesma interface**, para os serviços funcionarem trocando só o
caminho do `import`.

| No NOC | Aqui | O que muda |
|---|---|---|
| `src/database/client.js` | `src/base/db.js` | aponta para a base **`ragnabot`**; fecha o pool no SIGTERM |
| `src/utils/logger.js` | `src/base/logger.js` | **mesmo formato** (o NOC continua lendo); `service` vira `ragnabot-motor` |
| `src/utils/crypto.js` | `src/base/crypto.js` | **cópia fiel** — nada muda, e é assim de propósito |
| `src/services/audit.service.js` | `src/base/auditoria.js` | adaptador fino → grava em `RagnabotAuditoria` |

O adaptador de auditoria existe **para poder ser apagado**: cinco pontos do produto ainda chamam
`logAction({...})` com o vocabulário do NOC. Trocá-los por `registrar()` direto na mesma etapa em
que o banco muda de lugar misturaria duas mudanças — se algo falhasse, não saberíamos qual.
Provado por `src/base/testes/auditoria.test.mjs` (o `registrar` é trocado por um espião; não toca
em banco).

Mais duas, que o NOC resolvia de outro jeito:

- `src/base/config.js` — só o mínimo (chave de cifragem, ambiente, nível de log). O
  `config/index.js` do NOC carrega dezenas de chaves que não são do Ragnabot; a superfície de
  segredo do motor tem de ser pequena e auditável.
- `src/base/versao.js` — lê o arquivo `VERSAO` da raiz do repositório.

### ⚠️ A cifragem — o ponto delicado da migração inteira

`src/base/crypto.js` é **cópia fiel** de `src/utils/crypto.js` do NOC. **Não "melhore" aquele
arquivo.** Tudo que já está cifrado no banco foi cifrado por aquela implementação; qualquer
diferença — algoritmo, tamanho do IV, derivação da chave, formato — e o segredo gravado **não
abre**. E não abre com erro obscuro (`unable to authenticate data`), no meio de um atendimento.

Consequência prática: **`ENCRYPTION_KEY` tem de ser a MESMA do NOC**. Ela viaja para o `Secret`
do Kubernetes **antes** de qualquer dado migrar, e isso se confere rodando:

```bash
node src/base/testes/crypto.test.mjs
```

O teste cifra e decifra na implementação nova **e** faz a prova cruzada: importa a do NOC e
verifica que uma abre o que a outra fechou, nos dois sentidos. Se ele falhar, **não migre dado
cifrado** — resolva antes. Se a implementação do NOC não estiver na máquina, ele **pula** a prova
cruzada e diz isso em voz alta, em vez de fingir que passou.

## Rodar local

```bash
cd app
npm install

# Chave de teste (NÃO é a de produção — 32 bytes em hex):
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export DATABASE_URL='postgresql://ragnabot@localhost:5432/ragnabot'

npx prisma generate          # gera o cliente a partir do schema
npm run test:base            # cifragem + adaptador de auditoria (não precisam de banco)
```

Os dois testes da camada de base rodam **sem banco nenhum**, de propósito: são justamente os que
precisam passar *antes* de existir a base `ragnabot`.

⚠️ **Nunca `prisma db push` nem `prisma migrate dev`** (LEI 2 da casa). A base se cria pelos SQL
de `prisma/sql/`, na ordem do `prisma/sql/00-LEIA-ME.md`. Os dois comandos apagam **em silêncio**
as 3 chaves estrangeiras compostas que impedem juntar dado de empresas diferentes.

## Versão

O produto usa `A.BB.CC` (hoje **1.03.00**, no arquivo `VERSAO` da raiz do repositório). O npm
exige semver sem zero à esquerda, então o `package.json` carrega o equivalente **`1.3.0`**.
**As duas mudam juntas** — `VERSAO` é a que aparece na tela e no `/saude`; a do `package.json`
existe só para o npm não recusar.

## O que este diretório ainda NÃO tem

- **`src/servidor.js`** — o processo que sobe o Express, registra as rotas, liga o trabalhador de
  60s e o consumidor de 15s, e expõe `/saude` e `/pronto` (as sondas do manifesto contam com eles).
- **A base `ragnabot`** — é a Etapa 2. Nada aqui foi aplicado em banco nenhum.
- **O `Secret` `ragnabot-motor-env`** — criado à mão no servidor; a lista de chaves está no fim de
  `deploy/ragnabot-motor.yaml`.
