// ════════════════════════════════════════════════════════════════════════════════════════════════
// PORTARIA DO RAGNABOT — o elo que faltava entre a mensagem que chega e o fluxo que responde.
//
// Base: 28-MOTOR-DE-FLUXO-ESPECIFICACAO.md §1.1 (o papel `portaria`) e §1.2/(2), e
// 29-AUTOMACOES-DO-ATENDIMENTO.md §5.2 (o resolvedor de entrada), §5.3 (quem manda no relógio) e
// §5.4 (a serialização por conversa).
//
// O BURACO MEDIDO, e a razão deste arquivo existir: `resolverEntrada()` já sabe QUAL fluxo atende a
// mensagem, e `iniciarOuRecuperarExecucao()` já sabe nascer uma execução — e `[medido 29/08]`
// NINGUÉM chamava a segunda. As duas metades estavam prontas e não se falavam: o cliente mandava
// "oi" e o motor de fluxo, inteiro, nunca era acionado. É esse aperto de mão que mora aqui.
//
// O QUE ESTE ARQUIVO FAZ:
//   1. GRAVA a entrada bruta (`RagnabotFluxoEntrada`) com chave calculada — é a idempotência e é a
//      prova de que a mensagem chegou;
//   2. DECIDE, por `resolverEntrada()`, o que fazer com ela (iniciar fluxo, só mensagem, gente);
//   3. NASCE ou RECUPERA a execução, quando a decisão for iniciar fluxo;
//   4. ENFILEIRA o trabalho na fila durável do motor, sempre com `chaveParticao = "conta:conversa"`.
//
// O QUE ELE NÃO FAZ, DE PROPÓSITO (é a fronteira do papel `portaria` no §1.1 do doc 28):
//   • não executa nó de fluxo — quem anda no grafo é o executor;
//   • não fala com o Chatwoot nem com a Meta — nem para mandar "estamos fechados". Mensagem para o
//     cliente vira TRABALHO NA FILA, porque só o executor sabe respeitar a janela de 24 h e a caixa
//     de saída de duas fases. Portaria que envia direto é portaria que duplica mensagem na retentativa;
//   • não decide precedência de fluxo — isso está escrito uma vez só, em `resolverFluxoDeEntrada()`;
//   • não cria rota, não amarra no processo e não mexe em schema — outro dono, outro arquivo.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA EVITAR
//
// 1. A MENSAGEM ENTREGUE DUAS VEZES. O Chatwoot reentrega webhook, e reentrega é o comportamento
//    DESEJADO (§1.2/(2): responder 200 só depois de gravar). Sem a chave única da entrada, a segunda
//    entrega do mesmo "oi" nasceria como mensagem nova — e o cliente receberia a saudação duas vezes,
//    ou pior, responderia um menu que já tinha respondido. Aqui a colisão de `chave` é RESULTADO
//    CORRETO, não erro: devolve `duplicada` e não enfileira nada.
//
// 2. O "ESTAMOS FECHADOS" NO MEIO DO MENU. Se a conversa JÁ TEM execução viva, a mensagem é resposta
//    do fluxo em andamento e vai direto ao motor — sem passar pelo resolvedor. Sem esse desvio, o
//    cliente que está escolhendo a opção 2 às 18h01 receberia "voltamos amanhã" em vez de ter a
//    escolha dele processada, e a execução ficaria estacionada para sempre esperando uma resposta
//    que a portaria consumiu e jogou fora.
//
// 3. DOIS DONOS DO MESMO SILÊNCIO (§5.3). Enquanto o fluxo está vivo, o prazo é do nó `espera`; o
//    relógio de atendimento (minutos) só vale com a conversa em mão humana. Por isso, quando uma
//    execução NASCE aqui, os relógios ainda não disparados daquela conversa são cancelados — senão o
//    cliente lê "não entendi, escolha uma opção" e "ainda está aí?" no mesmo minuto.
//
// 4. A CORRIDA ENTRE DUAS RÉPLICAS DE PORTARIA. São duas por desenho (§1.1). Duas mensagens quase
//    simultâneas da mesma conversa caem em processos diferentes; a serialização é da PARTIÇÃO
//    `"conta:conversa"`, e quem perde a corrida do nascimento recebe `PARTICAO_OCUPADA` — que aqui é
//    tratado com uma segunda tentativa e, no pior caso, com a entrada gravada e `resultado` nulo, que
//    é exatamente o que o caminho de retomada do motor (`carregarEntradas` sem ids) recolhe depois.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// DEGRADAÇÃO: NUNCA LANÇA POR FALTA DE DEPENDÊNCIA
//
// Mesma escolha do trabalhador de atendimento: falta de porta vira AVISO no log e um resultado
// declarado no retorno, nunca exceção. A entrada bruta já está gravada — a mensagem do cliente não
// se perde — e o operador vê no retorno por que nada mais aconteceu. Portaria que estoura é portaria
// que devolve 500 e faz o Chatwoot reentregar em laço enquanto o defeito é de CADASTRO nosso.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import * as atendimentoService from './ragnabot-atendimento.service.js';
import {
  iniciarOuRecuperarExecucao as iniciarNoMotor,
  chaveParticaoDe,
  ehErroDoMotor,
  ESTADOS_ATIVOS,
  TIPOS_JOB,
} from './ragnabot-fluxo-motor.service.js';

/** O que a portaria fez com a mensagem. É o vocabulário do retorno, e é o que vai para o log. */
export const RESULTADOS_PORTARIA = Object.freeze({
  /** Nasceu execução de fluxo agora — o primeiro "oi" virou conversa com o robô. */
  EXECUCAO_INICIADA: 'execucao_iniciada',
  /** Já havia execução viva: a mensagem é resposta dela e foi entregue ao motor. */
  EXECUCAO_CONTINUADA: 'execucao_continuada',
  /** Nenhum fluxo: só o texto (almoço, fora de hora sem fluxo próprio). */
  SO_MENSAGEM: 'so_mensagem',
  /** A conversa é de gente. Nunca fica sem dono. */
  FILA_HUMANA: 'fila_humana',
  /** Reentrega da MESMA mensagem. Gravada uma vez, processada uma vez. */
  DUPLICADA: 'duplicada',
  /** Gravada, mas não é resposta de cliente (evento de controle, eco nosso). */
  REGISTRADA: 'registrada',
  /** Faltou porta/dependência ou a corrida foi perdida. A entrada está gravada; o resto não houve. */
  DEGRADADA: 'degradada',
  /** Chamada sem os campos que endereçam a conversa. Defeito de quem chama, não do cadastro. */
  RECUSADA: 'recusada',
});

/** Classes possíveis da entrada bruta (`RagnabotFluxoEntrada.classe`). Só `resposta_cliente` é
 *  candidata a acionar fluxo — criação de conversa NUNCA é resposta de pergunta. */
export const CLASSES_ENTRADA = Object.freeze({
  RESPOSTA_CLIENTE: 'resposta_cliente',
  CONTROLE: 'controle',
  ECO_PROPRIO: 'eco_proprio',
});

/**
 * TIPO DE TRABALHO NOVO, DECLARADO. `RagnabotFluxoFila.tipo` é String livre e o próprio motor já
 * registra que o conjunto foi ampliado antes (o `continuar`); o doc 29 §5.4 repete o raciocínio ao
 * acrescentar `atend_relogio`. Aqui entra `atend_mensagem`: a mensagem avulsa ao cliente decidida
 * pelo resolvedor (almoço, fora de hora, saudação sem fluxo).
 *
 * ⚠️ O CONSUMIDOR DELE AINDA NÃO EXISTE — é trabalho da fatia do relógio (A4). Até existir, a linha
 * fica na fila como REGISTRO DURÁVEL da intenção, e é isso que se quer: melhor a mensagem pendente e
 * visível do que a portaria falando com o canal por fora da caixa de saída de duas fases.
 */
export const TIPO_JOB_MENSAGEM = 'atend_mensagem';

/** Campos que o emissor REESCREVE. Entram no canonicalizador para serem REMOVIDOS: incluir um campo
 *  volátil na chave anula a idempotência — a reentrega gera chave nova e passa direto, como se fosse
 *  mensagem nova do cliente (é o aviso escrito no próprio schema). */
const CAMPOS_VOLATEIS = Object.freeze([
  'updated_at', 'updatedAt', 'last_activity_at', 'lastActivityAt', 'last_seen_at', 'lastSeenAt',
  'agent_last_seen_at', 'contact_last_seen_at', 'timestamp', 'created_at_ms',
]);
const REGEX_CONTADOR = /(_count|Count)$/;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS
//
// Injeção como no resto da casa. Não é ponto de bifurcação de comportamento: o teste injeta OUTRA
// implementação das MESMAS portas, nunca outro caminho de código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,

  /** Fila durável do motor (`RagnabotFluxoFila`). Ausente: a execução ainda nasce e o varredor de
   *  órfãos do motor (`retomarOrfas`) reenfileira sozinho — mas a latência vira a do varredor.
   *  @type {null | { enfileirar: Function }} */
  fila: null,

  /** O resolvedor de entrada e o cancelamento de relógios, do serviço de atendimento. O padrão é o
   *  serviço REAL — a porta existe para o teste, nunca para trocar a regra.
   *  @type {{ resolverEntrada: Function, cancelarRelogios?: Function }} */
  atendimento: {
    resolverEntrada: atendimentoService.resolverEntrada,
    cancelarRelogios: atendimentoService.cancelarRelogios,
  },

  /** O motor de fluxo. Mesma ideia: o padrão é o motor real.
   *  @type {{ iniciarOuRecuperarExecucao: Function }} */
  motor: { iniciarOuRecuperarExecucao: iniciarNoMotor },

  /** Relógio. Só o teste troca. Em produção a hora vem do BANCO, nunca do processo.
   *  @type {null | { agora: () => Promise<Date>|Date }} */
  relogio: null,

  log: logger,
};

/** Amarra as dependências. Chamada uma vez pelo processo, e pelo teste. */
export function configurarPortaria(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na portaria: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDaPortaria();
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDaPortaria() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/** A hora vem do BANCO. Dois pods com relógio dessincronizado decidem expediente diferente para a
 *  mesma empresa, e o sintoma aparece como "o robô respondeu fora de hora". */
async function agoraDoBanco() {
  if (portas.relogio) {
    const v = await portas.relogio.agora();
    return v instanceof Date ? v : new Date(v);
  }
  const cliente = db();
  if (typeof cliente?.$queryRaw !== 'function') return new Date();
  const linhas = await cliente.$queryRaw`SELECT now() AS agora`;
  const valor = Array.isArray(linhas) && linhas[0] ? linhas[0].agora : null;
  if (!valor) throw new Error('o banco não devolveu now() — a portaria não carimba entrada sem hora confiável');
  return valor instanceof Date ? valor : new Date(valor);
}

const inteiroOuNulo = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A CHAVE DA ENTRADA — a idempotência inteira mora aqui
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Remove o que o emissor reescreve e ORDENA as chaves. Sem a ordenação, o mesmo corpo com os
 *  campos em outra ordem produziria outro sha256 — e a "idempotência" seria decorativa. */
function canonicalizar(valor) {
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    const saida = {};
    for (const k of Object.keys(valor).sort()) {
      if (CAMPOS_VOLATEIS.includes(k)) continue;
      if (REGEX_CONTADOR.test(k)) continue;
      const v = valor[k];
      if (v === undefined) continue;
      saida[k] = canonicalizar(v);
    }
    return saida;
  }
  return valor instanceof Date ? valor.toISOString() : valor;
}

/** Só para teste e diagnóstico: o texto exato que vira sha256. */
export function canonicalizarCorpo(corpo) { return JSON.stringify(canonicalizar(corpo ?? {})); }

/**
 * `cw:<conta>:<evento>:<tipoObjeto>:<idObjeto>` quando existe id estável; senão o sha256 do corpo
 * canonicalizado. Nunca um par com coluna anulável: dois NULOS não são iguais no Postgres, e o
 * índice único viraria carimbo decorativo.
 */
export function chaveDeEntrada({ cwAccountId, evento, tipoObjeto = 'm', idObjeto = null, corpo = null }) {
  const conta = cwAccountId ?? 'sem_conta';
  const ev = String(evento || 'desconhecido');
  if (idObjeto !== null && idObjeto !== undefined && String(idObjeto) !== '') {
    return `cw:${conta}:${ev}:${tipoObjeto}:${idObjeto}`;
  }
  const h = crypto.createHash('sha256').update(canonicalizarCorpo(corpo)).digest('hex');
  return `cw:${conta}:${ev}:h:${h}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O ATENDIMENTO DA MENSAGEM
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Acha a execução viva da conversa. O vocabulário de estados ativos vem do MOTOR — copiar a lista
 *  aqui seria abrir a porta para ela divergir do índice único parcial do banco. */
async function execucaoViva(cliente, cwAccountId, cwConversationId) {
  const modelo = cliente?.ragnabotFluxoExecucao;
  if (!modelo?.findFirst) return null;
  return modelo.findFirst({
    where: { cwAccountId, cwConversationId, estado: { in: [...ESTADOS_ATIVOS] } },
  });
}

/** Enfileira e NUNCA derruba a chamada por causa disso. O motivo devolvido chama-se `motivoFila` de
 *  propósito: o retorno da portaria espalha este objeto ao lado do `motivo` DA DECISÃO, e dois campos
 *  com o mesmo nome fazem um apagar o outro em silêncio — o defeito que o primeiro teste pegou.
 * sem job, o varredor de órfãos do motor
 *  recolhe a execução; sem execução, a entrada com `resultado` nulo é recolhida no próximo trabalho
 *  da mesma conversa. Perder o job atrasa; estourar aqui perderia a mensagem. */
async function enfileirar(job) {
  if (!portas.fila?.enfileirar) {
    log().warn(`[portaria] porta "fila" ausente — trabalho ${job.tipo} não enfileirado (${job.chaveParticao})`);
    return { enfileirado: false, jobId: null, motivoFila: 'fila_ausente' };
  }
  try {
    const j = await portas.fila.enfileirar(job);
    return { enfileirado: true, jobId: j?.id ?? null, motivoFila: null };
  } catch (e) {
    log().warn(`[portaria] falha ao enfileirar ${job.tipo} (${job.chaveParticao}): ${e.message}`);
    return { enfileirado: false, jobId: null, motivoFila: `falha_fila:${e.message}` };
  }
}

/**
 * A MENSAGEM CHEGOU. Grava, decide e aciona — nessa ordem, e a ordem é o desenho.
 *
 * @param {object} m
 * @param {string}  m.tenantId          empresa no NOC (uuid) — NÃO é o `cwAccountId`
 * @param {number}  m.cwAccountId       conta na plataforma
 * @param {number}  m.cwConversationId  conversa na plataforma
 * @param {number?} m.cwInboxId         caixa — é ela que escolhe o fluxo `entrada='caixa'`
 * @param {string}  m.texto             o que a pessoa escreveu
 * @param {number?} m.mensagemId        `cwMessageId`; é ele que dá chave estável e dedupe de consumo
 * @param {Date?}   m.agora             só o teste passa
 * @param {Date?}   m.origemEm          carimbo de ORIGEM (Meta/`created_at`), não o de recepção
 * @param {string?} m.classe            resposta_cliente | controle | eco_proprio
 * @param {object?} m.janela            janela de 24 h já conhecida por quem chama (opcional)
 * @returns {Promise<object>} o que foi feito, com motivo — nunca lança por falta de porta
 */
export async function atenderMensagemRecebida(m = {}) {
  const {
    tenantId = null,
    cwAccountId = null,
    cwConversationId = null,
    cwInboxId = null,
    texto = '',
    mensagemId = null,
    agora = null,
    evento = 'message_created',
    classe = CLASSES_ENTRADA.RESPOSTA_CLIENTE,
    wamid = null,
    origemEm = null,
    interativo = null,
    anexos = [],
    cwContactId = null,
    contatoChave = null,
    inboxSegredoId = null,
    janela = null,
    chave: chaveDada = null,
    extra = null,
  } = m;

  const conta = inteiroOuNulo(cwAccountId);
  const conversa = inteiroOuNulo(cwConversationId);

  // Endereçamento incompleto é defeito de QUEM CHAMA, e ele precisa saber disso agora. Gravar uma
  // entrada sem conversa seria criar lixo que nenhum executor consegue recolher.
  if (!tenantId || conta === null || conversa === null) {
    log().warn(`[portaria] chamada sem endereço (tenantId=${tenantId} conta=${cwAccountId} conversa=${cwConversationId}) — recusada`);
    return { ok: false, resultado: RESULTADOS_PORTARIA.RECUSADA, motivo: 'endereco_incompleto', entradaId: null };
  }

  const cliente = db();
  const quando = agora ? (agora instanceof Date ? agora : new Date(agora)) : await agoraDoBanco();
  const chaveParticao = chaveParticaoDe({ cwAccountId: conta, cwConversationId: conversa });
  const idMensagem = inteiroOuNulo(mensagemId);

  // O corpo vai REDIGIDO: só o que o motor precisa para casar a resposta. Corpo cru de terceiro
  // guarda token de anexo e cabeçalho de webhook, e isso não pode virar linha permanente do banco.
  const corpo = {
    texto: typeof texto === 'string' ? texto : String(texto ?? ''),
    interativo: interativo ?? null,
    anexos: Array.isArray(anexos) ? anexos : [],
    ...(extra && typeof extra === 'object' ? { extra: canonicalizar(extra) } : {}),
  };

  const chave = chaveDada || chaveDeEntrada({
    cwAccountId: conta, evento,
    tipoObjeto: idMensagem !== null ? 'm' : (wamid ? 'w' : 'c'),
    idObjeto: idMensagem !== null ? idMensagem : (wamid || null),
    corpo: { conversa, corpo, origemEm: origemEm ? new Date(origemEm).toISOString() : null },
  });

  const carimboOrigem = origemEm ? new Date(origemEm) : null;
  const atrasoMs = carimboOrigem ? Math.max(0, quando.getTime() - carimboOrigem.getTime()) : null;

  // ── 1. GRAVA A ENTRADA. É a prova e é a primeira barreira de idempotência ────────────────────
  let linha = null;
  let duplicada = false;
  try {
    linha = await cliente.ragnabotFluxoEntrada.create({
      data: {
        chave, tenantId, inboxSegredoId,
        cwAccountId: conta, cwInboxId: inteiroOuNulo(cwInboxId), cwConversationId: conversa,
        cwMessageId: idMensagem, wamid: wamid ?? null,
        evento, classe, corpo,
        origemEm: carimboOrigem, atrasoMs,
        resultado: null,
      },
    });
  } catch (e) {
    if (e?.code !== 'P2002') {
      // Banco fora não é para engolir: quem chama tem de devolver 500 e o Chatwoot reentrega. Este
      // é o ÚNICO caminho em que a portaria propaga — e propaga porque a alternativa é perder a
      // mensagem em silêncio, que é o defeito que o §1.2/(2) do doc 28 existe para fechar.
      throw e;
    }
    duplicada = true;
    linha = await cliente.ragnabotFluxoEntrada.findUnique({ where: { chave } });
  }

  if (duplicada) {
    // REENTREGA. Resultado correto, não erro. Não enfileira de novo: o trabalho da primeira entrega
    // já existe, e se o processo daquela vez morreu antes de enfileirar, a entrada continua com
    // `resultado` nulo e é recolhida pelo caminho de retomada do motor (`carregarEntradas` sem ids)
    // no próximo trabalho desta mesma conversa.
    log().info(`[portaria] reentrega ignorada (chave=${chave})`);
    return {
      ok: true, resultado: RESULTADOS_PORTARIA.DUPLICADA, motivo: 'chave_repetida',
      entradaId: linha?.id ?? null, duplicada: true, chave, chaveParticao,
    };
  }

  // ── 2. NÃO É RESPOSTA DE CLIENTE: grava e para ───────────────────────────────────────────────
  // Criação de conversa, mudança de status, eco da nossa própria mensagem. Nada disso aciona fluxo,
  // e tratar como resposta faria a saudação sair no evento errado.
  if (classe !== CLASSES_ENTRADA.RESPOSTA_CLIENTE) {
    return {
      ok: true, resultado: RESULTADOS_PORTARIA.REGISTRADA, motivo: `classe:${classe}`,
      entradaId: linha.id, duplicada: false, chave, chaveParticao,
    };
  }

  // ── 3. JÁ EXISTE EXECUÇÃO VIVA? Então a mensagem é DELA ──────────────────────────────────────
  // Antes do resolvedor, de propósito (armadilha 2 do cabeçalho). Quem está no meio do menu não
  // recebe "estamos fechados": recebe o próximo passo do fluxo em que já está.
  let viva = null;
  try {
    viva = await execucaoViva(cliente, conta, conversa);
  } catch (e) {
    log().warn(`[portaria] não consegui ler execução viva (${chaveParticao}): ${e.message}`);
  }
  if (viva) {
    const f = await enfileirar({
      tipo: TIPOS_JOB.ENTRADA, chaveParticao, tenantId, execucaoId: viva.id,
      entradaId: linha.id, prioridade: 50,
      payload: { entradaIds: [linha.id], origem: 'portaria' },
    });
    return {
      ok: true, resultado: RESULTADOS_PORTARIA.EXECUCAO_CONTINUADA, motivo: 'execucao_viva',
      entradaId: linha.id, execucaoId: viva.id, nova: false, duplicada: false,
      chave, chaveParticao, ...f,
    };
  }

  // ── 4. O RESOLVEDOR DECIDE ───────────────────────────────────────────────────────────────────
  let decisao = null;
  try {
    decisao = await portas.atendimento.resolverEntrada({
      tenantId, cwAccountId: conta, cwConversationId: conversa,
      cwInboxId: inteiroOuNulo(cwInboxId), texto: corpo.texto, agora: quando,
    });
  } catch (e) {
    // Cadastro incompleto (política ausente, modelo não migrado) NÃO pode derrubar o atendimento. A
    // entrada está gravada; o operador vê o motivo no retorno e no log.
    log().warn(`[portaria] resolvedor de entrada falhou (${chaveParticao}): ${e.message}`);
    return {
      ok: false, resultado: RESULTADOS_PORTARIA.DEGRADADA, motivo: `resolvedor_falhou:${e.message}`,
      entradaId: linha.id, duplicada: false, chave, chaveParticao,
    };
  }

  const acoes = atendimentoService.ACOES_ENTRADA;

  // ── 5A. INICIAR FLUXO ────────────────────────────────────────────────────────────────────────
  if (decisao.acao === acoes.INICIAR_FLUXO && decisao.fluxoId && decisao.versaoId) {
    let nascimento = null;
    for (let tentativa = 1; tentativa <= 2 && !nascimento; tentativa += 1) {
      try {
        nascimento = await portas.motor.iniciarOuRecuperarExecucao({
          tenantId, cwAccountId: conta, cwConversationId: conversa,
          cwContactId: inteiroOuNulo(cwContactId), contatoChave,
          fluxoId: decisao.fluxoId, versaoId: decisao.versaoId,
          janela, origemEm: carimboOrigem,
        });
      } catch (e) {
        // Outra réplica de portaria está criando a execução DESTA conversa neste instante. O motor
        // manda quem chamou reenfileirar; uma segunda tentativa curta resolve o caso comum, porque
        // a transação do outro processo dura milissegundos.
        if (ehErroDoMotor(e, 'PARTICAO_OCUPADA') && tentativa === 1) {
          await new Promise((r) => { setTimeout(r, 60); });
          continue;
        }
        log().warn(`[portaria] não consegui iniciar execução (${chaveParticao}): ${e.message}`);
        return {
          ok: false, resultado: RESULTADOS_PORTARIA.DEGRADADA,
          motivo: `inicio_falhou:${e?.codigo || e.message}`,
          entradaId: linha.id, duplicada: false, chave, chaveParticao, decisao,
        };
      }
    }

    const execucao = nascimento?.execucao ?? null;
    const nova = nascimento?.nova === true;
    if (!execucao) {
      // Não deveria acontecer: o motor devolve execução ou lança. Se acontecer, o silêncio seria
      // pior que o aviso — a entrada fica gravada e o motivo aparece no retorno.
      log().warn(`[portaria] motor devolveu nascimento sem execução (${chaveParticao})`);
      return {
        ok: false, resultado: RESULTADOS_PORTARIA.DEGRADADA, motivo: 'motor_sem_execucao',
        entradaId: linha.id, duplicada: false, chave, chaveParticao, decisao,
      };
    }

    // §5.3 — QUEM MANDA NO RELÓGIO. A partir daqui o dono do silêncio é o nó `espera` do fluxo. Um
    // relógio de inatividade armado enquanto a conversa estava com gente tem de morrer agora, senão
    // o cliente recebe "ainda está aí?" no meio do menu do robô.
    if (nova && portas.atendimento?.cancelarRelogios) {
      try {
        await portas.atendimento.cancelarRelogios({ cwAccountId: conta, cwConversationId: conversa });
      } catch (e) {
        log().warn(`[portaria] relógios não cancelados (${chaveParticao}): ${e.message}`);
      }
    }

    // Execução NOVA anda pelo trabalho `iniciar`; execução recuperada (a outra réplica venceu a
    // corrida, ou ela já existia entre a leitura e agora) recebe a mensagem como `entrada`.
    const f = await enfileirar({
      tipo: nova ? TIPOS_JOB.INICIAR : TIPOS_JOB.ENTRADA,
      chaveParticao, tenantId, execucaoId: execucao.id,
      entradaId: linha.id, prioridade: 50,
      payload: { entradaIds: [linha.id], origem: 'portaria', motivo: decisao.motivo },
    });

    return {
      ok: true,
      resultado: nova ? RESULTADOS_PORTARIA.EXECUCAO_INICIADA : RESULTADOS_PORTARIA.EXECUCAO_CONTINUADA,
      motivo: decisao.motivo, entradaId: linha.id, execucaoId: execucao.id, nova,
      fluxoId: decisao.fluxoId, versaoId: decisao.versaoId, protocolo: execucao.protocolo ?? null,
      primeiroContato: decisao.primeiroContato === true,
      duplicada: false, chave, chaveParticao, ...f,
    };
  }

  // ── 5B. SÓ MENSAGEM, OU FILA HUMANA ──────────────────────────────────────────────────────────
  // Nenhuma execução nasce, e é isso que mantém o relógio de atendimento como dono do silêncio
  // (§5.3): sem execução viva, `relogioDeveArmar()` libera o trabalhador a armar o prazo em minutos.
  const soMensagem = decisao.acao === acoes.SO_MENSAGEM;
  let entregaDaMensagem = { enfileirado: false, jobId: null, motivoFila: 'sem_mensagem' };
  if (decisao.mensagem) {
    entregaDaMensagem = await enfileirar({
      tipo: TIPO_JOB_MENSAGEM, chaveParticao, tenantId, entradaId: linha.id, prioridade: 50,
      payload: {
        acao: 'mensagem_de_entrada', texto: decisao.mensagem, motivo: decisao.motivo,
        cwConversationId: conversa, cwInboxId: inteiroOuNulo(cwInboxId),
        encerrarApos: decisao.encerrarApos === true,
      },
    });
  }

  return {
    ok: true,
    resultado: soMensagem ? RESULTADOS_PORTARIA.SO_MENSAGEM : RESULTADOS_PORTARIA.FILA_HUMANA,
    motivo: decisao.motivo, entradaId: linha.id, execucaoId: null, nova: false,
    fluxoId: null, versaoId: null, mensagem: decisao.mensagem ?? null,
    encerrarApos: decisao.encerrarApos === true,
    expediente: decisao.expediente ?? null,
    primeiroContato: decisao.primeiroContato === true,
    duplicada: false, chave, chaveParticao, ...entregaDaMensagem,
  };
}

export default {
  configurarPortaria, portasDaPortaria,
  atenderMensagemRecebida, chaveDeEntrada, canonicalizarCorpo,
  RESULTADOS_PORTARIA, CLASSES_ENTRADA, TIPO_JOB_MENSAGEM,
};
