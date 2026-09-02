// ════════════════════════════════════════════════════════════════════════════════════════════════
// A FILA DO MOTOR DE FLUXO — `RagnabotFluxoFila` ganha, enfim, quem a opere.
//
// Contrato S-FILA (02/09/2026). Este era o ÚLTIMO elo: a tabela existia no schema desde o começo,
// `rodadaDoExecutor()` já sabia usá-la, a portaria e o motor já gravavam trabalho nela — e ninguém
// nunca tirava nada de lá. Sem este arquivo, `exigirPorta('fila')` lançava `ConfiguracaoAusente` e
// o motor, com adaptador de canal pronto e catálogo de nós pronto, NÃO RODAVA COM CLIENTE NENHUM.
//
// Base: `28-MOTOR-DE-FLUXO-ESPECIFICACAO.md` §2.4 (o modelo da fila) e §3.2/B (o laço do executor).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O CONTRATO — as seis funções que `ragnabot-fluxo-motor.service.js` chama pelo nome
//
//   candidatos({limite})            → uma linha por PARTIÇÃO pronta para trabalhar
//   drenarParticao(chave, worker)   → reserva e devolve TODOS os trabalhos daquela conversa
//   concluirJob(id, {status,...})   → desfecho: 'feito' ou 'descartado'
//   adiarJob(id, {motivo, tentativaAtual, contarTentativa}) → devolve com recuo, ou descarta
//   enfileirar(job, tx?)            → cria trabalho (idempotente); o `tx` é a T1 do motor
//   devolverJobsDoWorker(worker)    → SIGTERM: solta o que este processo segurava
//
// E mais duas que são nossas, não do motor:
//   ceifarPresos()                  → devolve trabalho de réplica que morreu
//   resumoDaFila()                  → o que o `/saude` mostra
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS CINCO ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA EVITAR — todas medidas, nenhuma suposta
//
// F1. DUAS RÉPLICAS PEGANDO O MESMO TRABALHO. O Ragnabot roda em Kubernetes com mais de uma
//     réplica. `SELECT` seguido de `UPDATE` é correto num processo e errado em dois: as duas leem a
//     mesma linha `pendente` e as duas mandam a mensagem. A reserva aqui é UMA declaração só —
//     `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` — e é o Postgres, não o código, que
//     decide quem levou. `SKIP LOCKED` é o que impede a segunda réplica de FICAR ESPERANDO a
//     primeira: ela pula a linha travada e trabalha em outra conversa, que é o ponto de ter duas.
//
// F2. TRABALHO PRESO POR RÉPLICA MORTA. Um pod que morre no meio de um passo deixa a linha em
//     `processando` para sempre, e para o cliente isso é o robô emudecendo no meio da frase. Por
//     isso a reserva tem PRAZO DE VISIBILIDADE (`travadoEm` + `CEIFADOR_SEGUNDOS`) e existe o
//     ceifador. ⚠️ O ceifador CONTA a tentativa ao devolver: uma entrega que derrubou o processo é
//     uma tentativa gasta, e sem contá-la um trabalho que mata o pod gira para sempre, matando um
//     pod de cada vez.
//
// F3. ROUBAR O TRABALHO DOS VIZINHOS. A MESMA tabela guarda `atend_relogio` e `atend_mensagem`, que
//     são do consumidor de despertar, não do motor. `drenarParticao()` que drenasse «tudo o que é
//     desta conversa» reservaria esses dois, o motor os daria por FEITOS sem executá-los, e o
//     «ainda está aí?» simplesmente nunca sairia. Por isso todo filtro daqui carrega
//     `tipo = ANY(TIPOS_DO_MOTOR)`, e `TIPOS_DO_MOTOR` é lido do próprio motor — não copiado.
//
// F4. ORDEM DENTRO DA CONVERSA. Prioridade é para escolher ENTRE conversas; DENTRO de uma conversa
//     a ordem é a de chegada (`id ASC`) e ponto. Ordenar a drenagem por prioridade faria o passo 2
//     ser processado antes do passo 1 sempre que o segundo evento chegasse com prioridade menor —
//     e o índice `@@index([chaveParticao, status, id])` do schema diz, na própria estrutura, que
//     era isso que se esperava aqui.
//
// F5. `id` BIGINT VAZANDO PARA O JSON. A coluna é `BIGSERIAL`, o Prisma devolve `BigInt`, e a
//     portaria põe esse valor em `jobId` num objeto que vira resposta HTTP. `JSON.stringify` de
//     `BigInt` LANÇA — o webhook responderia 500 e o Chatwoot reenviaria a mensagem para sempre.
//     Por isso todo `id` sai daqui como `Number` (e entra de volta como `BigInt`).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE ARQUIVO **NÃO** FAZ, de propósito
//
//   • não decide nada de fluxo: quem sabe o que é um nó é o motor;
//   • não toma posse da execução — a posse é do motor (`tomarPosse`), e a ordem POSSE-ANTES-DE-
//     REIVINDICAÇÃO em `rodadaDoExecutor` depende de a fila NÃO marcar nada antes dela;
//   • não amarra laço nenhum no processo. Quem liga `iniciarExecutorDeFluxo()` é o arranque
//     (`servidor.js`), como o trabalhador e o despertar — a decisão é do chefe.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import { TIPOS_JOB } from './ragnabot-fluxo-motor.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES DECLARADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Os tipos que ESTA fila opera — os do motor de fluxo, e mais nenhum.
 *
 * ⚠️ LIDO DO MOTOR, NÃO COPIADO (armadilha F3). Uma lista paralela divergiria no dia em que alguém
 * acrescentasse um tipo de trabalho, e o sintoma seria trabalho novo que nunca sai da fila — sem
 * erro, sem log, sem nada. O `import` estático é seguro porque a seta é de mão única: o motor não
 * importa a fila (ele a recebe por porta injetada), então não há ciclo de arranque.
 */
export const TIPOS_DO_MOTOR = Object.freeze([...new Set(Object.values(TIPOS_JOB))]);

/** Estados que a coluna `status` assume. Vocabulário do schema, escrito aqui para poder ser lido. */
export const ESTADOS_FILA = Object.freeze({
  PENDENTE: 'pendente',
  PROCESSANDO: 'processando',
  FEITO: 'feito',
  /** TETO DE TENTATIVAS ESTOURADO — a "fila de descarte". Trabalho que falha para sempre não pode
   *  girar para sempre: uma linha defeituosa consumindo toda rodada é como o motor inteiro para. */
  FALHOU: 'falhou',
  /** Descartado DE PROPÓSITO (obsoleto, entrada já consumida). Não é defeito, é decisão. */
  DESCARTADO: 'descartado',
});

/** Prazo de visibilidade da reserva. Passado isso sem desfecho, o ceifador devolve o trabalho.
 *  90 s é o mesmo número que `retomarOrfas()` usa no motor para considerar um `processando`
 *  «recente o bastante para ser prova de que alguém está cuidando» — os dois têm de concordar,
 *  senão um devolve o que o outro ainda considera vivo. */
export const CEIFADOR_SEGUNDOS = 90;

/** Recuo exponencial: 2 s, 4 s, 8 s … com teto de 5 min. O teto existe porque sem ele a oitava
 *  tentativa cairia daqui a 4 minutos e a nona nunca — e o cliente não espera isso sentado. */
const RECUO_BASE_MS = 2_000;
const RECUO_TETO_MS = 300_000;
/** Devolução SEM defeito (posse perdida, desligamento) volta rápido: não houve nada de errado. */
const RECUO_SEM_DEFEITO_MS = 5_000;

const ERRO_MAX = 500; // a coluna é TEXT, mas log de erro inteiro na fila vira dump de stack

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS — mesmo desenho do motor, do trabalhador e do despertar
// ────────────────────────────────────────────────────────────────────────────────────────────────

const portas = {
  db: prismaPadrao,
  log: loggerPadrao,
  /** Fonte do jitter do recuo. Existe para o TESTE poder fixá-lo: recuo com aleatório de verdade
   *  não é verificável, e recuo sem jitter faz N réplicas voltarem no mesmo milissegundo. */
  aleatorio: Math.random,
};

export function configurarFila(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na fila do motor: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDaFila() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// FERRAMENTA MIÚDA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** `id` sai como Number (armadilha F5) e volta como BigInt para a consulta. */
const paraNumero = (v) => (typeof v === 'bigint' ? Number(v) : (v == null ? null : Number(v)));
const paraBigInt = (v) => (typeof v === 'bigint' ? v : BigInt(String(v)));

/** Normaliza a linha crua do Postgres no formato que o motor espera receber de `drenarParticao`. */
function normalizar(linha) {
  if (!linha) return null;
  return {
    id: paraNumero(linha.id),
    tipo: linha.tipo,
    chaveParticao: linha.chaveParticao,
    tenantId: linha.tenantId ?? null,
    execucaoId: linha.execucaoId ?? null,
    entradaId: linha.entradaId ?? null,
    tokenVisita: linha.tokenVisita ?? null,
    payload: linha.payload ?? {},
    prioridade: linha.prioridade ?? 100,
    tentativas: linha.tentativas ?? 0,
    maxTentativas: linha.maxTentativas ?? 8,
    status: linha.status ?? null,
    disponivelEm: linha.disponivelEm ?? null,
    chaveIdem: linha.chaveIdem ?? null,
  };
}

/**
 * Recuo exponencial com jitter. `tentativa` é a que ACABOU de falhar (1 = a primeira).
 *
 * O jitter não é enfeite: sem ele, N réplicas que falharam no mesmo incidente (o Chatwoot fora do
 * ar, por exemplo) voltam TODAS no mesmo milissegundo e batem no serviço que ainda está se
 * levantando — é a manada que transforma um susto de 10 s numa parada de 10 min.
 */
export function recuoMs(tentativa, { aleatorio = portas.aleatorio } = {}) {
  const n = Math.max(1, Number(tentativa) || 1);
  const base = Math.min(RECUO_BASE_MS * (2 ** (n - 1)), RECUO_TETO_MS);
  const jitter = 0.8 + (0.4 * aleatorio()); // ±20 %
  return Math.round(base * jitter);
}

/**
 * A CHAVE DE IDEMPOTÊNCIA, derivada do que torna o trabalho único.
 *
 * ⚠️ NULO É RESPOSTA VÁLIDA e significa «este trabalho não tem chave natural, deixe entrar». No
 * Postgres dois NULOS não são iguais, então esses nunca colidem — e é assim de propósito: um
 * `continuar` genérico repetido custa uma rodada à toa, enquanto um `continuar` PERDIDO custa a
 * conversa inteira. Entre os dois erros, este código escolhe o barato.
 *
 * Quem chama pode passar `chaveIdem` explícito e mandar nesta decisão.
 */
export function chaveIdemDe(job = {}) {
  if (job.chaveIdem !== undefined) return job.chaveIdem; // inclusive `null` explícito
  const tipo = job.tipo;
  const p = job.payload ?? {};
  // A ENTRADA do cliente: uma mensagem, um trabalho. É a defesa contra o Chatwoot reentregar o
  // mesmo webhook (ele reentrega por desenho quando não recebe 200).
  if ((tipo === TIPOS_JOB.ENTRADA || tipo === TIPOS_JOB.INICIAR) && job.entradaId) {
    return `${tipo}:${job.entradaId}`;
  }
  // A VISITA que dorme: um despertar por visita. É literalmente «a mesma visita não entra duas
  // vezes» — e `tokenVisita` é o campo que o schema criou para isso.
  if (tipo === TIPOS_JOB.DESPERTAR && job.execucaoId && job.tokenVisita != null) {
    return `despertar:${job.execucaoId}:${job.tokenVisita}`;
  }
  // O EFEITO em dúvida: um trabalho de conciliação por efeito, nunca dois.
  if (tipo === TIPOS_JOB.CONCILIAR && job.execucaoId && p.chaveEfeito) {
    return `conciliar:${job.execucaoId}:${p.chaveEfeito}`;
  }
  if (tipo === TIPOS_JOB.CONTINUAR_HTTP && job.execucaoId && p.chaveEfeito) {
    return `continuar_http:${job.execucaoId}:${p.chaveEfeito}`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ENFILEIRAR
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cria o trabalho. IDEMPOTENTE quando há chave natural (`chaveIdemDe`).
 *
 * @param {object} job
 * @param {object?} tx cliente da transação do motor (a T1). ⚠️ QUANDO VEM, É OBRIGATÓRIO USÁ-LO:
 *   o job de conciliação tem de nascer e morrer com a mesma transação que congelou a conversa.
 *   Enfileirar fora dela deixaria trabalho apontando para um congelamento que voltou atrás.
 * @returns {Promise<object>} a linha (nova OU a que já existia), com `novo:boolean`
 *
 * ⚠️ COLISÃO NÃO É ERRO, E TAMBÉM NÃO É «NÃO FAZER NADA». Quando o trabalho já está esperando, o
 * pedido novo pode ser MAIS URGENTE que ele — é exatamente o caso do Pix: existe um despertar
 * agendado para daqui a 5 min e o cliente acabou de pagar. Por isso o conflito ANTECIPA o
 * `disponivelEm` (`LEAST`) e SOBE a prioridade (`LEAST`, que aqui é menor = mais urgente) em vez de
 * descartar em silêncio. Descartar teria deixado o cliente esperando 5 min por uma resposta que já
 * estava pronta.
 */
export async function enfileirar(job = {}, tx = undefined) {
  const cliente = tx ?? db();
  if (!job?.tipo) throw new Error('enfileirar: `tipo` é obrigatório');
  if (!job?.chaveParticao) throw new Error('enfileirar: `chaveParticao` é obrigatória — é a unidade de serialização');

  const chaveIdem = chaveIdemDe(job);
  const disponivelEm = job.disponivelEm ? new Date(job.disponivelEm) : null;
  const prioridade = Number.isFinite(job.prioridade) ? job.prioridade : 100;
  const maxTentativas = Number.isFinite(job.maxTentativas) ? job.maxTentativas : 8;
  const payload = job.payload ?? {};

  // ⚠️ `atualizadoEm` é `@updatedAt` do Prisma, que é preenchido PELO CLIENTE — em SQL cru a coluna
  // é NOT NULL sem default e o INSERT falharia. Vale para todo UPDATE deste arquivo também.
  const linhas = await cliente.$queryRaw`
    INSERT INTO "RagnabotFluxoFila"
      ("tipo","chaveParticao","tenantId","execucaoId","entradaId","tokenVisita","payload",
       "prioridade","disponivelEm","status","tentativas","maxTentativas","chaveIdem",
       "criadoEm","atualizadoEm")
    VALUES
      (${job.tipo}, ${job.chaveParticao}, ${job.tenantId ?? null}, ${job.execucaoId ?? null},
       ${job.entradaId ?? null}, ${job.tokenVisita ?? null}, ${payload}::jsonb,
       ${prioridade}, COALESCE(${disponivelEm}::timestamptz, now()), 'pendente', 0,
       ${maxTentativas}, ${chaveIdem}, now(), now())
    ON CONFLICT ("chaveIdem") WHERE status = 'pendente' AND "chaveIdem" IS NOT NULL
    DO UPDATE SET
      "disponivelEm" = LEAST("RagnabotFluxoFila"."disponivelEm", EXCLUDED."disponivelEm"),
      "prioridade"   = LEAST("RagnabotFluxoFila"."prioridade",   EXCLUDED."prioridade"),
      "atualizadoEm" = now()
    RETURNING id, tipo, "chaveParticao", "tenantId", "execucaoId", "entradaId", "tokenVisita",
              payload, prioridade, status, tentativas, "maxTentativas", "disponivelEm", "chaveIdem",
              (xmax = 0) AS inserido`;

  const linha = Array.isArray(linhas) ? linhas[0] : null;
  if (!linha) throw new Error('enfileirar: o INSERT não devolveu linha — estrutura da fila divergente?');
  return { ...normalizar(linha), novo: linha.inserido === true };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ESCOLHER E RESERVAR
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Uma linha por PARTIÇÃO pronta para trabalhar, na ordem em que valem a pena.
 *
 * ⚠️ `DISTINCT ON (chaveParticao)` e não «as N primeiras linhas». `rodadaDoExecutor` já ignora
 * candidato repetido de partição (`vistas.has(chave)`); devolver dez linhas da MESMA conversa
 * gastaria o `limite` inteiro numa conversa só e deixaria as outras nove esperando a rodada
 * seguinte — sob carga, é a conversa barulhenta calando as caladas.
 *
 * Aqui, sim, a ordem é por PRIORIDADE: escolher ENTRE conversas é justamente o que a prioridade
 * decide (50 = tráfego de cliente, 200 = campanha). Dentro da conversa quem manda é `id` (F4).
 */
export async function candidatos({ limite = 20 } = {}) {
  const linhas = await db().$queryRaw`
    SELECT c.id, c."chaveParticao", c."execucaoId", c."tenantId", c.tipo, c.prioridade, c."disponivelEm"
      FROM (
        SELECT DISTINCT ON ("chaveParticao")
               id, "chaveParticao", "execucaoId", "tenantId", tipo, prioridade, "disponivelEm"
          FROM "RagnabotFluxoFila"
         WHERE status = 'pendente'
           AND "disponivelEm" <= now()
           AND tipo = ANY(${TIPOS_DO_MOTOR}::text[])
         ORDER BY "chaveParticao", prioridade ASC, "disponivelEm" ASC, id ASC
      ) c
     ORDER BY c.prioridade ASC, c."disponivelEm" ASC, c.id ASC
     LIMIT ${limite}`;
  return (linhas || []).map((l) => ({
    id: paraNumero(l.id),
    chaveParticao: l.chaveParticao,
    execucaoId: l.execucaoId ?? null,
    tenantId: l.tenantId ?? null,
    tipo: l.tipo,
    prioridade: l.prioridade,
  }));
}

/**
 * RESERVA todos os trabalhos pendentes e vencidos desta conversa, para este worker.
 *
 * A reserva é UMA declaração (armadilha F1): o `SELECT ... FOR UPDATE SKIP LOCKED` dentro do
 * `UPDATE` faz o Postgres decidir quem levou cada linha. Duas réplicas na mesma partição no mesmo
 * instante: uma leva as linhas, a outra recebe lista VAZIA e vai cuidar de outra conversa — nunca
 * as duas com a mesma linha, e nunca uma esperando a outra.
 *
 * ⚠️ NÃO INCREMENTA `tentativas`. Quem conta é o DESFECHO (`adiarJob`) ou o CEIFADOR. Incrementar
 * na reserva obriga quem chama a ler o contador ANTES de reivindicar — foi um defeito real do
 * consumidor de despertar (o teste 14 de lá existe por causa dele), e a forma de não repetir o
 * defeito é não criar a divergência.
 */
export async function drenarParticao(chaveParticao, workerId, { limite = 50 } = {}) {
  const linhas = await db().$queryRaw`
    WITH alvo AS (
      SELECT id
        FROM "RagnabotFluxoFila"
       WHERE "chaveParticao" = ${chaveParticao}
         AND status = 'pendente'
         AND "disponivelEm" <= now()
         AND tipo = ANY(${TIPOS_DO_MOTOR}::text[])
       ORDER BY id ASC
       LIMIT ${limite}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE "RagnabotFluxoFila" f
       SET status = 'processando',
           "donoWorker" = ${workerId},
           "travadoEm" = now(),
           "atualizadoEm" = now()
      FROM alvo
     WHERE f.id = alvo.id
    RETURNING f.id, f.tipo, f."chaveParticao", f."tenantId", f."execucaoId", f."entradaId",
              f."tokenVisita", f.payload, f.prioridade, f.tentativas, f."maxTentativas", f."chaveIdem"`;
  // `RETURNING` não promete ordem. A ordem DENTRO da conversa é o contrato (F4) — ordenar aqui é
  // barato e é a diferença entre o passo 1 antes do passo 2 e o contrário.
  return (linhas || []).map(normalizar).sort((a, b) => a.id - b.id);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DESFECHO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Fecha o trabalho. `status` é 'feito' (deu certo) ou 'descartado' (não se aplica mais).
 *
 * ⚠️ SOLTA `donoWorker`/`travadoEm`. Deixá-los preenchidos faria `devolverJobsDoWorker` no SIGTERM
 * ressuscitar trabalho já concluído — e o cliente receberia de novo a frase que já leu.
 */
export async function concluirJob(id, { status = ESTADOS_FILA.FEITO, erro = null, resultado = null } = {}) {
  const permitidos = [ESTADOS_FILA.FEITO, ESTADOS_FILA.DESCARTADO, ESTADOS_FILA.FALHOU];
  const alvo = permitidos.includes(status) ? status : ESTADOS_FILA.FEITO;
  const nota = erro ?? (resultado ? `resultado: ${resultado}` : null);
  const r = await db().$executeRaw`
    UPDATE "RagnabotFluxoFila"
       SET status = ${alvo},
           "ultimoErro" = ${nota ? String(nota).slice(0, ERRO_MAX) : null},
           "donoWorker" = NULL,
           "travadoEm" = NULL,
           "atualizadoEm" = now()
     WHERE id = ${paraBigInt(id)}`;
  return { atualizados: Number(r), status: alvo };
}

/**
 * Devolve o trabalho para a fila com recuo — ou o manda para o DESCARTE quando estourou o teto.
 *
 * @param {number|bigint} id
 * @param {object} opcoes
 * @param {string} opcoes.motivo           o que deu errado (vai para `ultimoErro`)
 * @param {number} opcoes.tentativaAtual   quantas tentativas o job JÁ tinha (o valor que
 *                                         `drenarParticao` devolveu — é assim que o motor chama)
 * @param {boolean} opcoes.contarTentativa `false` = devolver sem culpar o trabalho
 *
 * ⚠️ `contarTentativa:false` NÃO É DETALHE. O motor o usa quando perdeu a POSSE — não houve defeito
 * nenhum no trabalho, outro processo simplesmente estava com a conversa. Contar tentativa ali
 * envenenaria, em oito disputas, um trabalho perfeitamente sadio. É a mesma regra que o consumidor
 * de despertar aplica no `ADIADO_PARTICAO`.
 *
 * ⚠️ O TETO EXISTE PARA QUE ALGO PARE. Trabalho que falha para sempre e volta para sempre consome a
 * rodada inteira, todo tique, e cala as conversas sadias. Ao estourar, ele vai para `falhou` — a
 * fila de descarte —, fica gravado com o último erro e SAI do caminho. Quem quiser reprocessar
 * chama `reenfileirarDescartados()`; o que não pode é a fila decidir isso sozinha.
 */
export async function adiarJob(id, { motivo = null, tentativaAtual = 0, contarTentativa = true } = {}) {
  const anteriores = Number(tentativaAtual) || 0;
  const tentativas = contarTentativa ? anteriores + 1 : anteriores;
  const nota = motivo ? String(motivo).slice(0, ERRO_MAX) : null;

  if (contarTentativa) {
    // O teto é lido DA LINHA (`maxTentativas`), não de uma constante: o schema deixou o campo por
    // linha de propósito, e trabalho de campanha pode merecer teto diferente do de cliente.
    const linhas = await db().$queryRaw`
      SELECT "maxTentativas" FROM "RagnabotFluxoFila" WHERE id = ${paraBigInt(id)}`;
    const teto = Array.isArray(linhas) && linhas[0] ? (linhas[0].maxTentativas ?? 8) : 8;
    if (tentativas >= teto) {
      const r = await db().$executeRaw`
        UPDATE "RagnabotFluxoFila"
           SET status = 'falhou',
               tentativas = ${tentativas},
               "ultimoErro" = ${nota},
               "donoWorker" = NULL,
               "travadoEm" = NULL,
               "atualizadoEm" = now()
         WHERE id = ${paraBigInt(id)}`;
      log().warn?.(`[fluxo-fila] trabalho ${id} foi para o DESCARTE após ${tentativas} tentativas: ${nota ?? 'sem motivo'}`);
      return { atualizados: Number(r), status: ESTADOS_FILA.FALHOU, tentativas, descartado: true };
    }
  }

  const atraso = contarTentativa ? recuoMs(tentativas) : RECUO_SEM_DEFEITO_MS;
  const r = await db().$executeRaw`
    UPDATE "RagnabotFluxoFila"
       SET status = 'pendente',
           tentativas = ${tentativas},
           "ultimoErro" = ${nota},
           "donoWorker" = NULL,
           "travadoEm" = NULL,
           "disponivelEm" = now() + make_interval(secs => ${atraso / 1000}),
           "atualizadoEm" = now()
     WHERE id = ${paraBigInt(id)}`;
  return { atualizados: Number(r), status: ESTADOS_FILA.PENDENTE, tentativas, atrasoMs: atraso, descartado: false };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DEVOLUÇÃO: A ORDEIRA E A DO CEIFADOR
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * SIGTERM: devolve à fila o que ESTE processo segurava.
 *
 * ⚠️ NÃO CONTA TENTATIVA, e a diferença para o ceifador é a coisa toda: aqui o processo está
 * saindo de forma ordeira, o trabalho não falhou, e culpá-lo faria um RollingUpdate — que acontece
 * a cada implantação — envenenar trabalho sadio de conversas em curso.
 *
 * `disponivelEm = now()` (e não «daqui a pouco») porque a réplica que continua de pé pode pegar o
 * trabalho no tique seguinte; o cliente está no meio de uma frase.
 */
export async function devolverJobsDoWorker(workerId) {
  const r = await db().$executeRaw`
    UPDATE "RagnabotFluxoFila"
       SET status = 'pendente',
           "donoWorker" = NULL,
           "travadoEm" = NULL,
           "disponivelEm" = now(),
           "ultimoErro" = ${`devolvido no encerramento de ${String(workerId).slice(0, 120)}`},
           "atualizadoEm" = now()
     WHERE "donoWorker" = ${workerId}
       AND status = 'processando'
       AND tipo = ANY(${TIPOS_DO_MOTOR}::text[])`;
  return { count: Number(r) };
}

/**
 * O CEIFADOR — devolve trabalho preso por réplica que MORREU (armadilha F2).
 *
 * Prazo de visibilidade: `travadoEm` mais velho que `CEIFADOR_SEGUNDOS` sem desfecho significa que
 * ninguém está mais cuidando. Enquanto a réplica vive, ela conclui ou adia bem antes disso.
 *
 * ⚠️ AQUI A TENTATIVA CONTA. Uma entrega que derrubou o processo é uma tentativa gasta; sem
 * contá-la, um trabalho que mata o pod ao ser processado gira para sempre — matando um pod de cada
 * vez, e ninguém liga o sintoma à causa. Com a contagem, ele estoura o teto e vai para o descarte,
 * onde é diagnosticável.
 *
 * Faz as duas coisas numa declaração só: o que ainda tem tentativa volta para `pendente` com recuo,
 * o que estourou o teto vai para `falhou`.
 */
export async function ceifarPresos({ segundos = CEIFADOR_SEGUNDOS, limite = 200 } = {}) {
  const atraso = recuoMs(1) / 1000; // o recuo do reinício é curto: o defeito pode ter sido do pod
  const linhas = await db().$queryRaw`
    WITH presos AS (
      SELECT id
        FROM "RagnabotFluxoFila"
       WHERE status = 'processando'
         AND "travadoEm" < now() - make_interval(secs => ${segundos})
         AND tipo = ANY(${TIPOS_DO_MOTOR}::text[])
       ORDER BY "travadoEm" ASC
       LIMIT ${limite}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE "RagnabotFluxoFila" f
       SET tentativas = f.tentativas + 1,
           status = CASE WHEN f.tentativas + 1 >= f."maxTentativas" THEN 'falhou' ELSE 'pendente' END,
           "donoWorker" = NULL,
           "travadoEm" = NULL,
           "disponivelEm" = CASE WHEN f.tentativas + 1 >= f."maxTentativas"
                                 THEN f."disponivelEm"
                                 ELSE now() + make_interval(secs => ${atraso}) END,
           "ultimoErro" = ${'reaberto pelo ceifador — o dono não deu desfecho dentro do prazo'},
           "atualizadoEm" = now()
      FROM presos
     WHERE f.id = presos.id
    RETURNING f.id, f.status`;
  const devolvidos = (linhas || []).filter((l) => l.status === 'pendente').length;
  const descartados = (linhas || []).filter((l) => l.status === 'falhou').length;
  if (linhas?.length) {
    log().warn?.(`[fluxo-fila] ceifador: ${devolvidos} devolvido(s), ${descartados} para o descarte`);
  }
  return { vistos: (linhas || []).length, devolvidos, descartados };
}

/**
 * Reprocessa o que foi para o descarte. NÃO é automático de propósito: o descarte existe porque
 * alguma coisa tem de parar, e uma fila que se auto-reabilita é uma fila que nunca para.
 * Chamada por operação, com escopo, depois de alguém olhar o `ultimoErro`.
 */
export async function reenfileirarDescartados({ chaveParticao = null, limite = 100 } = {}) {
  const r = chaveParticao
    ? await db().$executeRaw`
        UPDATE "RagnabotFluxoFila" SET status='pendente', tentativas=0, "disponivelEm"=now(), "atualizadoEm"=now()
         WHERE id IN (SELECT id FROM "RagnabotFluxoFila"
                       WHERE status='falhou' AND "chaveParticao"=${chaveParticao}
                         AND tipo = ANY(${TIPOS_DO_MOTOR}::text[]) ORDER BY id LIMIT ${limite})`
    : await db().$executeRaw`
        UPDATE "RagnabotFluxoFila" SET status='pendente', tentativas=0, "disponivelEm"=now(), "atualizadoEm"=now()
         WHERE id IN (SELECT id FROM "RagnabotFluxoFila"
                       WHERE status='falhou' AND tipo = ANY(${TIPOS_DO_MOTOR}::text[])
                       ORDER BY id LIMIT ${limite})`;
  return { reenfileirados: Number(r) };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// OBSERVABILIDADE — o que o `/saude` mostra
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tamanho da fila, descarte e IDADE DO MAIS ANTIGO.
 *
 * ⚠️ A IDADE É O NÚMERO QUE IMPORTA, não o tamanho. Fila com 500 trabalhos girando em 2 s está
 * saudável; fila com 3 trabalhos parados há 40 min é o motor MORTO — e as duas leituras de
 * «tamanho» não distinguem uma da outra. Foi por não ter esse número que se descobre tarde.
 *
 * Uma consulta só, agregada, sobre o índice `[status, disponivelEm, prioridade]`.
 */
export async function resumoDaFila() {
  const linhas = await db().$queryRaw`
    SELECT status,
           COUNT(*)::int AS quantos,
           EXTRACT(EPOCH FROM (now() - MIN("criadoEm")))::int AS mais_antigo_segundos,
           EXTRACT(EPOCH FROM (now() - MIN("disponivelEm")))::int AS maior_espera_segundos,
           EXTRACT(EPOCH FROM (now() - MIN("travadoEm")))::int AS reserva_mais_velha_segundos
      FROM "RagnabotFluxoFila"
     WHERE tipo = ANY(${TIPOS_DO_MOTOR}::text[])
       AND status IN ('pendente','processando','falhou')
     GROUP BY status`;
  const por = Object.fromEntries((linhas || []).map((l) => [l.status, l]));
  const pendente = por.pendente ?? null;
  return {
    pendentes: pendente?.quantos ?? 0,
    processando: por.processando?.quantos ?? 0,
    // O «descarte»: trabalho que estourou o teto. Qualquer número acima de zero aqui é um pedido de
    // perícia — nenhuma conversa deveria terminar assim.
    descartados: por.falhou?.quantos ?? 0,
    /** Idade, em segundos, do trabalho pendente mais VELHO (desde que nasceu). */
    maisAntigoSegundos: pendente?.mais_antigo_segundos ?? 0,
    /** Há quanto tempo o mais atrasado JÁ PODERIA ter sido executado. Negativo = agendado para o
     *  futuro (um despertar, por exemplo) e portanto normal. */
    maiorAtrasoSegundos: pendente?.maior_espera_segundos ?? 0,
    /** Idade da reserva mais velha ainda em `processando`. ⚠️ Medida em `travadoEm`, e NÃO em
     *  `criadoEm`: o que interessa aqui é «há quanto tempo alguém está com esta conversa na mão»,
     *  não há quanto tempo o trabalho nasceu. Passando de `CEIFADOR_SEGUNDOS`, é réplica morta —
     *  o ceifador vai recolher, e este número é o aviso de que isso está acontecendo. */
    reservaMaisVelhaSegundos: por.processando?.reserva_mais_velha_segundos ?? 0,
    prazoDeVisibilidadeSegundos: CEIFADOR_SEGUNDOS,
  };
}

/**
 * A ESTRUTURA ESTÁ APLICADA? — a pergunta que tem de ser feita no arranque, não no primeiro cliente.
 *
 * ⚠️ ORDEM OBRIGATÓRIA: `prisma/sql/motor-fluxo/05-rb_fila_idempotencia.sql` ANTES de o executor
 * subir. Sem a coluna `chaveIdem`, todo `enfileirar()` estoura (o `ON CONFLICT` cita a coluna) — e
 * o sintoma seria o pior possível: a plataforma grava a mensagem do cliente, a portaria devolve
 * `motivoFila: falha_fila:…` num aviso de log, e o robô simplesmente não responde a ninguém. Sem o
 * ÍNDICE (e ele é PARCIAL, então um `prisma db push` o apaga em silêncio), a coluna existe e a
 * idempotência não — o cliente lê a mesma frase duas vezes, e isso só aparece sob concorrência.
 *
 * Perguntar aqui transforma as duas falhas numa linha de log e num campo do `/saude`, com o nome do
 * arquivo a aplicar. Falha declarada no arranque é barata; falha por conversa é cara.
 */
export async function conferirEstrutura() {
  const faltando = [];
  try {
    const [col] = await db().$queryRaw`
      SELECT 1 AS ok FROM information_schema.columns
       WHERE table_name = 'RagnabotFluxoFila' AND column_name = 'chaveIdem'`;
    if (!col) faltando.push('coluna `chaveIdem`');
    const [idx] = await db().$queryRaw`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'rb_fila_idem_pendente'`;
    if (!idx) faltando.push('índice `rb_fila_idem_pendente`');
    else if (!/UNIQUE/i.test(idx.indexdef)) faltando.push('índice `rb_fila_idem_pendente` existe mas NÃO é único');
  } catch (e) {
    return { ok: false, faltando: ['não consegui ler a estrutura'], erro: e.message };
  }
  return {
    ok: faltando.length === 0,
    faltando,
    comoCorrigir: faltando.length
      ? 'aplique prisma/sql/motor-fluxo/05-rb_fila_idempotencia.sql (NUNCA `prisma db push` — ele apaga o índice parcial)'
      : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O LAÇO DO EXECUTOR
// ────────────────────────────────────────────────────────────────────────────────────────────────

let rodadaEmCurso = false;
let tiquesDesdeCeifada = 0;
/** Ceifa a cada N tiques, não a cada tique: o ceifador varre por `travadoEm` e não tem pressa
 *  nenhuma — rodá-lo 2x por segundo seria consulta à toa em cima da tabela mais quente do motor. */
const TIQUES_POR_CEIFADA = 60;

/** Último resumo da rodada, para o `/saude` mostrar que o laço está de fato girando. */
let ultimaRodada = { instante: null, resumo: null, erro: null };
export function ultimaRodadaDoExecutor() { return { ...ultimaRodada }; }

async function tique(motor, workerId, opcoes) {
  if (rodadaEmCurso) {
    // Rodada mais lenta que o tique não é erro — é carga. Pular é o certo; empilhar rodadas seria
    // multiplicar conexões no banco justo no momento em que ele já está apertado.
    return { pulado: true };
  }
  rodadaEmCurso = true;
  try {
    tiquesDesdeCeifada += 1;
    if (tiquesDesdeCeifada >= TIQUES_POR_CEIFADA) {
      tiquesDesdeCeifada = 0;
      await ceifarPresos().catch((e) => log().warn?.(`[fluxo-fila] ceifador falhou: ${e.message}`));
    }
    const resumo = await motor.rodadaDoExecutor({ workerId, ...opcoes });
    ultimaRodada = { instante: new Date().toISOString(), resumo, erro: null };
    return resumo;
  } catch (e) {
    // ⚠️ NUNCA DEIXAR ESCAPAR. Exceção dentro de um `setInterval` não derruba o processo, mas mata
    // o entusiasmo: a rodada seguinte roda igual, e o defeito fica invisível. Registrar aqui é o
    // que faz «o motor parou» virar uma linha de log em vez de um silêncio.
    ultimaRodada = { instante: new Date().toISOString(), resumo: null, erro: e.message };
    log().error?.(`[fluxo-fila] rodada do executor falhou: ${e.message}`);
    return { erro: e.message };
  } finally {
    rodadaEmCurso = false;
  }
}

/**
 * Liga o executor de fluxo. Devolve a função que o desliga.
 *
 * ⚠️ INTERVALO. A especificação sugere 250 ms; o padrão aqui é 500 ms porque o alvo é o cliente
 * esperando NO MEIO DE UMA FRASE (diferente do despertar, de 15 s, cujo prazo já venceu há
 * minutos), mas 4 consultas por segundo por réplica, ociosas, em cima da tabela mais quente do
 * motor não se pagam. Configurável por `RAGNABOT_EXECUTOR_INTERVALO_MS`.
 *
 * ⚠️ TRAVA DE REENTRÂNCIA (`rodadaEmCurso`). Sem ela, uma rodada de 3 s com tique de 500 ms
 * empilharia seis rodadas concorrentes — e cada uma abrindo transação no mesmo banco.
 *
 * @param {object} motor o módulo do motor (injetado, para o teste poder passar um dublê)
 */
export function iniciarExecutorDeFluxo(motor, { workerId, intervaloMs = 500, ...opcoes } = {}) {
  if (!motor?.rodadaDoExecutor) throw new Error('iniciarExecutorDeFluxo: o motor não expõe rodadaDoExecutor()');
  if (!workerId) throw new Error('iniciarExecutorDeFluxo: `workerId` é obrigatório — é ele que identifica a réplica');
  const alca = setInterval(() => { tique(motor, workerId, opcoes).catch(() => {}); }, intervaloMs);
  if (typeof alca.unref === 'function') alca.unref(); // não segura o processo no encerramento
  log().info?.(`[fluxo-fila] executor de fluxo ligado (tique de ${intervaloMs} ms, worker ${workerId})`);
  return () => { clearInterval(alca); log().info?.('[fluxo-fila] executor de fluxo desligado'); };
}

/**
 * A variável que DESLIGA o executor sem tocar em código — para o aperto em que se quer o motor de
 * pé (rotas, editor, portaria gravando entrada) e o consumo da fila parado.
 *
 * Padrão LIGADO: o valor omitido tem de ser o que atende o cliente. Desliga com `0`, `off`,
 * `false` ou `nao`.
 */
export function executorHabilitado(env = process.env) {
  const v = String(env.RAGNABOT_EXECUTOR_FLUXO ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !['0', 'off', 'false', 'nao', 'não', 'no'].includes(v);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMO AMARRAR NO PROCESSO (quem faz isso é `servidor.js`, não este arquivo)
//
//   import * as motor from './services/ragnabot-fluxo-motor.service.js';
//   import * as fila  from './services/ragnabot-fluxo-fila.service.js';
//
//   motor.configurarMotor({ fila, canal, nos });
//   const desligar = fila.iniciarExecutorDeFluxo(motor, { workerId: `${os.hostname()}#${process.pid}` });
//   process.on('SIGTERM', async () => { desligar(); await motor.encerrarGraciosamente(workerId); });
//
// ⚠️ O `encerrarGraciosamente` NÃO é opcional. Ele espera os passos em voo, chama
// `devolverJobsDoWorker` e solta as posses. Sem ele, cada implantação deixa N conversas travadas
// por até 90 s (o prazo do ceifador) — e num RollingUpdate isso acontece toda vez.
// ════════════════════════════════════════════════════════════════════════════════════════════════
