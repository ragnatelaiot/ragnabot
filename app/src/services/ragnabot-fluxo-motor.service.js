// ════════════════════════════════════════════════════════════════════════════════════════════════
// MOTOR DE FLUXO DE CONVERSA DO RAGNABOT — A MÁQUINA DE ESTADO
//
// Base: /ia/.claude/modulo-atendimento/28-MOTOR-DE-FLUXO-ESPECIFICACAO.md §3 (estados, ciclo do
// evento, freios) e §4.1/§4.4 (contrato do nó e saídas de exceção).
//
// O QUE ESTE ARQUIVO FAZ, em uma frase: recebe um trabalho da fila, descobre onde a conversa está,
// executa UM avanço, e persiste — com posse por arrendamento, retomada após reinício e caixa de
// saída de duas fases.
//
// O QUE ELE NÃO FAZ, de propósito:
//   • não implementa os executores de nó (§4.2, quinze tipos) — ele os CHAMA por uma interface
//     declarada aqui, na seção «CONTRATO DO EXECUTOR DE NÓ»;
//   • não fala com o Chatwoot nem com a Meta — quem fala é a PortaCanal, injetada;
//   • não é a portaria do webhook — quem grava a entrada bruta é a portaria, e ela só responde 200
//     depois de gravar (a idempotência protege contra DUPLICAR, nunca contra PERDER).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA EVITAR
//
// 1. DOIS PROCESSOS NA MESMA CONVERSA. Trava consultiva de SESSÃO morre em silêncio atrás de
//    pgbouncer em modo transação, e um processo congelado por pausa longa de coletor de lixo mantém
//    a sessão TCP viva enquanto acredita ser o dono. Por isso a posse aqui é ARRENDAMENTO COM CERCA:
//    todo UPDATE de avanço carrega `AND leaseToken=$t AND leaseExpiraEm>now()`. Zero linhas
//    afetadas não é "tenta de novo", é `PossePerdida` — e a transação inteira volta atrás ANTES de
//    qualquer efeito.
//
// 2. CHAMADA DE REDE DENTRO DE TRANSAÇÃO ABERTA. Esgota o pool e segura bloqueios pelo tempo do
//    terceiro — e o terceiro aqui é o Typebot, que a medição mostra não responder de forma
//    confiável. A T1 é curta e não tem rede. Para tornar isso IMPOSSÍVEL de cometer em silêncio,
//    `ctx.canal` e `ctx.egresso` entregues dentro da T1 são sentinelas que LANÇAM ao serem tocadas
//    (ver `sentinelaDeRede`). O executor de nó descobre o erro no primeiro teste, não em produção.
//
// 3. RESPOSTA E EXPIRAÇÃO MANDANDO A CONVERSA POR DOIS CAMINHOS. Todo despertar carrega
//    `tokenVisita`; se o cliente respondeu antes do prazo, `visitaSeq` avançou e o despertar é
//    descartado. Sem isso a conversa chega em dois nós ao mesmo tempo.
//
// 4. "REGISTRADO COM SUCESSO" FANTASMA (o D3 medido). A ordem é reservar → efetivar → confirmar,
//    nunca efetivar → gravar. O preço assumido é que uma queda pode deixar mensagem NÃO enviada;
//    silêncio seguido de repetição é falha melhor que promessa falsa.
//    ⚠️ RESERVAR NÃO BASTA: enquanto existir efeito sem desfecho, a conversa NÃO PODE ANDAR. Quem
//    garante isso é a BARREIRA DO EFEITO PENDENTE, na T1 do passo, somada à exclusão equivalente no
//    varredor de órfãos. Sem as duas, o fantasma renascia por um caminho novo — o dono do passo
//    morria entre o COMMIT e o despacho, o varredor reenfileirava a marcha e o cliente lia
//    «Chamado RGT-… aberto!» sem que o chamado existisse. E "a marcha para" jamais pode ser só o
//    retorno de uma função: o job de despertar já está GRAVADO e ressuscita a conversa sozinho.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// INVARIANTE CENTRAL — leia antes de mexer em qualquer coisa aqui:
//
//   `noAtualId` aponta para o nó que AINDA VAI SER EXECUTADO, exceto quando `aguardando !== 'nada'`,
//   e aí ele aponta para o nó em que a conversa está PARADA.
//
// É o que permite não precisar de uma coluna "saída pendente": quando um nó de efeito é executado,
// a T1 já move o ponteiro para o destino da saída dele, e a T2 CORRIGE o ponteiro para o destino da
// saída `erro`/`sem_janela` se o despacho falhar. Sem esse invariante escrito, a próxima pessoa
// inventa uma coluna nova ou, pior, reexecuta o nó de efeito e o cliente recebe a mensagem duas
// vezes.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prisma from '../base/db.js';
import * as protocoloService from './ragnabot-protocolo.service.js';
import logger from '../base/logger.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES
//
// ⚠️ DUPLICAÇÃO DECLARADA: o contrato coloca `ESTADOS_ATIVOS` em `src/motor/tipos.js`, que é de
// outro autor e pode ainda não existir. Um `import` estático de arquivo ausente derruba o processo
// inteiro no arranque, então a cópia vive aqui. A defesa contra as duas fontes divergirem NÃO é
// disciplina: é o teste `estados-ativos-vs-indice.test.mjs`, que compara ESTA constante, a de
// `tipos.js` e o `WHERE` do índice único parcial lido de `pg_indexes`. Acrescentar um estado ativo
// sem incluí-lo no índice reabre a porta para DUAS execuções na mesma conversa — dois robôs
// falando com a mesma pessoa —, e o sintoma só aparece sob concorrência.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const ESTADOS_ATIVOS = Object.freeze(['rodando', 'esperando', 'pausado_humano', 'pausado_duvida']);
export const ESTADOS_TERMINAIS = Object.freeze(['concluido', 'abandonado', 'erro']);

/** Estados ativos em que o motor NÃO avança sozinho: quem destrava é gente ou o conciliador. */
export const ESTADOS_PAUSADOS = Object.freeze(['pausado_humano', 'pausado_duvida']);

/** Ids de trava consultiva reservados (espelham `src/motor/tipos.js`; nenhum outro serviço da casa
 *  pode colidir). O motor usa só o de partição, que é calculado, não fixo. */
export const TRAVAS = Object.freeze({
  CONCILIADOR: 811001, VARREDOR_ORFAOS: 811002, EXPIRADOR_TTL: 811003,
  PODADOR: 811004, CEIFADOR_JOBS: 811005, ESCALADOR_PAUSA: 811006, AGREGADOR: 811007,
});

/** Tipos de trabalho da fila que este motor sabe processar.
 *  ⚠️ ACRÉSCIMO DECLARADO ao enum do §2.4 (`entrada|despertar|continuar_http|iniciar|conciliar|
 *  expirar`): falta ali um tipo para "retomar a marcha" — usado pelo teto de `passosPorEvento`, pelo
 *  varredor de órfãos e pela T2 quando reroteia por `erro`. `iniciar` não serve, porque significa
 *  CRIAR a execução. `RagnabotFluxoFila.tipo` é String livre, então isto não é mudança de schema. */
export const TIPOS_JOB = Object.freeze({
  INICIAR: 'iniciar', CONTINUAR: 'continuar', ENTRADA: 'entrada',
  DESPERTAR: 'despertar', CONTINUAR_HTTP: 'continuar_http', CONCILIAR: 'conciliar', EXPIRAR: 'expirar',
});

/** Padrões dos freios (§3.3). Só valem quando o fluxo não declarou o seu. */
const FREIOS_PADRAO = Object.freeze({
  passosPorEvento: 50, passosTotalMax: 500, visitasPorNoMax: 10, ttlExecucaoSegundos: 82800,
});

const LEASE_SEGUNDOS_PADRAO = 30;
const BATIMENTO_MS = 10_000;      // §3.2/B: renova a posse a cada 10 s enquanto o passo roda
const TRILHA_MAX = 200;           // §2.3: teto + marcador de truncagem
const CAIXA_PENDENTE_MAX = 10;    // §3.2/C
const DUVIDA_CONCILIAR_SEGUNDOS = 45; // §3.2/E: o conciliador só olha efeito reservado há 45 s
/** Prazo dado ao escalador de pausa quando a conversa é congelada por efeito pendente. Estado
 *  congelado SEM relógio é estado que some — e o que some aqui é uma pessoa esperando resposta. */
const BLOQUEIO_DUVIDA_MINUTOS = 15;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ERROS DE FRONTEIRA
//
// ⚠️ CLASSIFIQUE POR `e.codigo`, NUNCA por `instanceof`. Se `src/motor/tipos.js` também declarar
// `PossePerdida`, serão DUAS classes diferentes e `instanceof` devolve falso para o objeto vindo do
// outro módulo — o chamador trataria posse perdida como erro genérico e queimaria as 8 tentativas
// de um trabalho sadio. `ehErroDoMotor()` existe exatamente para tornar isso impossível.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export class ErroDoMotor extends Error {
  constructor(codigo, mensagem, dados = {}) {
    super(mensagem);
    this.name = 'ErroDoMotor';
    this.codigo = codigo;
    this.dados = dados;
    this.ehErroDoMotor = true;
  }
}
export class PossePerdida extends ErroDoMotor {
  constructor(m = 'a posse da execução foi perdida', d) { super('POSSE_PERDIDA', m, d); this.name = 'PossePerdida'; }
}
export class EntradaJaConsumida extends ErroDoMotor {
  constructor(m = 'esta entrada já foi consumida por esta execução', d) { super('ENTRADA_JA_CONSUMIDA', m, d); this.name = 'EntradaJaConsumida'; }
}
export class JanelaFechada extends ErroDoMotor {
  constructor(m = 'a janela de 24 h está fechada para este destinatário', d) { super('JANELA_FECHADA', m, d); this.name = 'JanelaFechada'; }
}
export class RedeDentroDaTransacao extends ErroDoMotor {
  constructor(m, d) { super('REDE_DENTRO_DA_TRANSACAO', m, d); this.name = 'RedeDentroDaTransacao'; }
}
export class ConfiguracaoAusente extends ErroDoMotor {
  constructor(m, d) { super('CONFIGURACAO_AUSENTE', m, d); this.name = 'ConfiguracaoAusente'; }
}

/** Único jeito correto de classificar um erro deste motor entre módulos. */
export function ehErroDoMotor(e, codigo = null) {
  if (!e || e.ehErroDoMotor !== true) return false;
  return codigo ? e.codigo === codigo : true;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONTRATO DO EXECUTOR DE NÓ — a interface por onde este motor chama os quinze tipos
//
// Um arquivo por tipo em `src/motor/nos/<tipo>.js`, exportando default o mesmo objeto (§4.1). Este
// motor NÃO conhece nenhum tipo em particular: ele pede o executor ao catálogo injetado e conversa
// só pelo que está declarado abaixo.
//
// @typedef {object} ExecutorDeNo
// @property {string}  tipo
// @property {'nenhum'|'repetivel'|'condicional'|'irrepetivel'} efeito
// @property {'conciliar'|'reenviar'|'condicional'|'seguir'|'parar'} politicaEmDuvida
// @property {boolean} estaciona
// @property {boolean} [aceitaModeloFora]
// @property {(config:object)=>string[]} saidas
// @property {(no:object, ctx:object)=>Array} validar
// @property {(no:object, ctx:ContextoExecucao)=>IntencaoSaida|IntencaoSaida[]} preparar
// @property {(ctx:ContextoExecucao)=>Promise<ResultadoNo>} executar
// @property {(ctx:ContextoExecucao, entrada:object)=>Promise<{saida,varsPatch,viaCasamento}>} [receber]
// @property {(ctx:ContextoExecucao, resultado:object)=>Promise<{saida,varsPatch}>} [continuar]
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// TRÊS REGRAS QUE O CONTRATO ORIGINAL NÃO DIZ E ESTE MOTOR IMPÕE — quem escrever os nós precisa
// saber, porque a violação é DETECTADA, não tolerada:
//
// R1. `preparar()`, `executar()`, `receber()` e `continuar()` rodam DENTRO da T1 e são PROIBIDOS de
//     tocar a rede. Para não virar acordo de cavalheiros, `ctx.canal` e `ctx.egresso` ali são
//     sentinelas que lançam `RedeDentroDaTransacao` ao primeiro acesso. Quem precisa da rede devolve
//     uma INTENÇÃO em `preparar()`, e o motor despacha depois do COMMIT.
//
// R2. `executar()` devolve a transição PRETENDIDA, independente de o despacho dar certo. Falha de
//     despacho não é problema do executor: a T2 reroteia pela saída `erro` (ou `sem_janela`), que é
//     o que o §4.4 manda. Executor que tenta adivinhar sucesso de envio duplica responsabilidade.
//
// R3. Nó que depende do RESULTADO de uma chamada externa (o `http`) devolve
//     `{tipo:'aguardar', motivo:'http'}` e implementa `continuar(ctx, resultado)`. Sem `continuar`,
//     o motor aplica o mapeamento genérico `ok → 'sucesso'` / `!ok → 'erro'` — que é conservador o
//     bastante para não travar quem ainda não implementou, e explícito o bastante para não parecer
//     mágica. `motivo:'http'` é acréscimo declarado à união fechada do §4.1; a coluna
//     `RagnabotFluxoExecucao.aguardando` já enumera 'http', ou seja, o modelo de dados já contava
//     com ele.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS
//
// Este motor é dono de UM arquivo; a fila, a PortaCanal, a telemetria, o cofre e o catálogo de nós
// são de outros autores. As portas existem para (a) o processo executor amarrar tudo num lugar só e
// (b) o teste rodar a máquina de estado inteira sem Chatwoot, sem Meta e sem banco.
//
// ⚠️ NÃO é um ponto de bifurcação de comportamento. Não existe "modo de teste" que siga caminho
// diferente: o teste injeta OUTRAS implementações das MESMAS portas. Motor que se comporta
// diferente sob teste não é testado.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prisma,
  /** @type {{enfileirar,candidatos,drenarParticao,concluirJob,adiarJob,devolverJobsDoWorker}} */
  fila: null,
  /** @type {{portaDa:(execucao:object)=>Promise<PortaCanal>}} */
  canal: null,
  /** @type {{obter:(tipo:string)=>ExecutorDeNo|null}} */
  nos: null,
  /** @type {{registrarEvento?, abrirIncidente?}} — ausente vira INSERT direto (ver `registrarEvento`) */
  telemetria: null,
  /** @type {{resolver:(tenantId:string, apelido:string)=>Promise<string>}} */
  cofre: null,
  /** @type {{chamarExterno:Function}} */
  egresso: null,
  /** @type {{perfilDe:Function}} */
  limites: null,
  /** Emissor de protocolo. O padrão é o serviço JÁ EXISTENTE e JÁ PROVADO em produção — este motor
   *  NÃO reimplementa numeração. A porta existe para o teste não depender de a empresa ter prefixo
   *  cadastrado, nunca para trocar a regra. */
  protocolo: protocoloService,
  /** Relógio. Só o teste troca. Em produção a hora vem do BANCO, nunca do processo — relógio de pod
   *  fora de sincronia decide prazo e janela de 24 h errados. */
  relogio: null,
};

/** Amarra as dependências. Chamada uma vez pelo processo executor, e pelo teste. */
export function configurarMotor(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new ConfiguracaoAusente(`porta desconhecida: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoMotor();
}

/** Cópia rasa para diagnóstico e teste. Não expõe nada que já não tenha sido injetado. */
export function portasDoMotor() { return { ...portas }; }

function exigirPorta(nome) {
  const p = portas[nome];
  if (!p) throw new ConfiguracaoAusente(`a porta "${nome}" não foi configurada — chame configurarMotor()`);
  return p;
}

const db = () => portas.db;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A hora vem do BANCO. §4.1: «Date vinda do banco (now()), nunca Date.now() do processo».
 *  Quando a porta `relogio` está injetada (teste), ela manda — e é a ÚNICA exceção. */
async function agoraDoBanco(tx) {
  if (portas.relogio) return portas.relogio.agora();
  const linhas = await tx.$queryRaw`SELECT now() AS agora`;
  const valor = Array.isArray(linhas) && linhas[0] ? linhas[0].agora : null;
  if (!valor) throw new ErroDoMotor('RELOGIO_INDISPONIVEL', 'o banco não devolveu now()');
  return valor instanceof Date ? valor : new Date(valor);
}

const ms = (a, b) => Math.max(0, new Date(a).getTime() - new Date(b).getTime());
const somarMs = (data, milis) => new Date(new Date(data).getTime() + milis);

/** JSON puro, sem herdar protótipo — vai para colunas Json e não pode carregar surpresa. */
const clonar = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Chave de partição: a UNIDADE de serialização. Duas conversas nunca se atrapalham; a mesma
 *  conversa nunca roda em dois processos. */
export function chaveParticaoDe({ cwAccountId, cwConversationId }) {
  return `${cwAccountId}:${cwConversationId}`;
}

/**
 * Sentinela de rede: substitui `canal`/`egresso` dentro da T1.
 * O acesso a QUALQUER propriedade lança. É a diferença entre um defeito que aparece no primeiro
 * teste do executor de nó e um defeito que aparece em produção como pool esgotado às 3 da manhã.
 */
function sentinelaDeRede(nome) {
  return new Proxy({}, {
    get(_alvo, prop) {
      if (prop === 'then' || prop === Symbol.toStringTag) return undefined; // não confundir await
      throw new RedeDentroDaTransacao(
        `"${nome}.${String(prop)}" foi tocado dentro da transação do passo. Nó que precisa da rede ` +
        `devolve uma intenção em preparar() e o motor despacha depois do COMMIT.`,
      );
    },
  });
}

/**
 * CHAVE DETERMINÍSTICA DO EFEITO — sha256(execucaoId|noId|visitaSeq|tentativa|sufixo).
 *
 * ⚠️ VISITA e TENTATIVA entram de propósito. Uma chave derivada só de "protocolo:nó" é constante
 * entre visitas: não distingue a primeira da segunda tentativa — que é justamente onde ela serviria
 * — e faz um segundo chamado legítimo na mesma conversa colidir com o primeiro num destino que
 * respeite idempotência, sendo descartado em silêncio enquanto o cliente lê «registrado com
 * sucesso». Seria o D3 renascido por outro caminho.
 *
 * É TAMBÉM o `rgt_efeito` que viaja em `content_attributes` — a NOSSA marca no destino. Conciliar é
 * procurar a nossa chave, não depender de `source_id`, que em canal de WhatsApp é preenchido pelo
 * provedor.
 */
export function chaveEfeito({ execucaoId, noId, visitaSeq, tentativa = 1, sufixo = '' }) {
  if (!execucaoId || !noId) throw new ErroDoMotor('CHAVE_EFEITO_INCOMPLETA', 'execucaoId e noId são obrigatórios');
  const material = [execucaoId, noId, String(visitaSeq ?? 0), String(tentativa), String(sufixo ?? '')].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// TELEMETRIA E INCIDENTE
//
// Telemetria é SÓ INSERT em RagnabotFluxoEvento. NUNCA escreve em RagnabotFluxo nem em
// RagnabotFluxoVersao — é a correção direta do D10, em que a telemetria morava dentro do documento
// e cada interação de cliente reescrevia a linha, fazendo `atualizadoEm` deixar de significar
// "alguém editou" para significar "alguém conversou".
//
// Falha de telemetria NUNCA derruba o passo: registro perdido é ruim, atendimento derrubado por
// causa de registro é pior. É a mesma escolha já feita em ragnabot-auditoria.service.js.
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function registrarEvento(tx, evento) {
  try {
    if (portas.telemetria?.registrarEvento) return await portas.telemetria.registrarEvento(evento, tx);
    return await tx.ragnabotFluxoEvento.create({
      data: {
        tenantId: evento.tenantId, versaoId: evento.versaoId, execucaoId: evento.execucaoId,
        noId: evento.noId ?? null, tipo: evento.tipo, saida: evento.saida ?? null,
        viaCasamento: evento.viaCasamento ?? null, latenciaMs: evento.latenciaMs ?? null,
        cwMessageId: evento.cwMessageId ?? null, detalhe: evento.detalhe ?? null,
      },
    });
  } catch (e) {
    logger.warn(`[fluxo-motor] telemetria nao gravada (${evento?.tipo}): ${e.message}`);
    return null;
  }
}

/** UPSERT por (versaoId, noId, codigo): 151 eventos iguais viram UMA linha acionável, com contagem
 *  e última ocorrência. 151 linhas idênticas são ruído que se aprende a ignorar — e ignorar foi
 *  exatamente o que aconteceu nos catorze meses medidos. */
async function abrirIncidente(tx, dados) {
  try {
    if (portas.telemetria?.abrirIncidente) return await portas.telemetria.abrirIncidente(dados, tx);
    const { tenantId, versaoId, noId, codigo, nivel = 'erro', mensagem, comoCorrigir = null, amostra = null } = dados;
    const cliente = tx ?? db();
    const existente = await cliente.ragnabotFluxoIncidente.findUnique({
      where: { versaoId_noId_codigo: { versaoId, noId, codigo } },
    });
    if (!existente) {
      return await cliente.ragnabotFluxoIncidente.create({
        data: {
          tenantId, versaoId, noId, codigo, nivel, mensagem, comoCorrigir,
          amostras: amostra ? [amostra] : [],
        },
      });
    }
    const amostras = Array.isArray(existente.amostras) ? existente.amostras.slice(0, 4) : [];
    if (amostra) amostras.unshift(amostra);
    return await cliente.ragnabotFluxoIncidente.update({
      where: { versaoId_noId_codigo: { versaoId, noId, codigo } },
      data: { ocorrencias: { increment: 1 }, ultimaEm: new Date(), amostras: amostras.slice(0, 5), mensagem },
    });
  } catch (e) {
    logger.warn(`[fluxo-motor] incidente nao registrado (${dados?.codigo}): ${e.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// GRAFO — leitura da versão
//
// A versão é IMUTÁVEL por gatilho no banco (rb_versao_imutavel). Isso torna o cache correto POR
// CONSTRUÇÃO: não existe invalidação a acertar, porque não existe UPDATE. É o raro caso em que
// cachear para sempre é a opção conservadora.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const cacheDeVersao = new Map();
const CACHE_VERSAO_MAX = 200;

async function carregarVersao(tx, versaoId) {
  if (cacheDeVersao.has(versaoId)) return cacheDeVersao.get(versaoId);
  const versao = await (tx ?? db()).ragnabotFluxoVersao.findUnique({ where: { id: versaoId } });
  if (!versao) throw new ErroDoMotor('VERSAO_AUSENTE', `versao ${versaoId} nao encontrada`);

  const documento = versao.documento || {};
  const nosPorId = new Map();
  for (const no of documento.nos || []) nosPorId.set(no.id, no);
  // Índice de arestas por "de saida". O banco já garante UMA aresta por saída
  // (@@unique([versaoId, de, saida])) — o fan-out acidental do D5 é recusado lá, não aqui.
  const arestas = new Map();
  for (const a of documento.arestas || []) arestas.set(`${a.de} ${a.saida}`, a);

  const compilada = { ...versao, nosPorId, arestas };
  if (cacheDeVersao.size >= CACHE_VERSAO_MAX) cacheDeVersao.delete(cacheDeVersao.keys().next().value);
  cacheDeVersao.set(versaoId, compilada);
  return compilada;
}

/** Só para o teste e para a publicação: a versão é imutável, mas um `prisma db push` num ambiente de
 *  desenvolvimento pode recriar a linha com outro conteúdo. */
export function limparCacheDeVersao(versaoId = null) {
  if (versaoId) cacheDeVersao.delete(versaoId); else cacheDeVersao.clear();
}

const destinoDaSaida = (versao, noId, saida) => versao.arestas.get(`${noId} ${saida}`)?.para ?? null;

function executorDoNo(no) {
  const catalogo = exigirPorta('nos');
  const ex = catalogo.obter(no.tipo);
  if (!ex) throw new ErroDoMotor('TIPO_DE_NO_DESCONHECIDO', `nenhum executor registrado para o tipo "${no.tipo}"`);
  return ex;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POSSE POR ARRENDAMENTO
//
// Comparar-e-trocar, e NINGUÉM ESPERA a posse. Zero linhas afetadas significa que outro executor é o
// dono: o chamador IGNORA o candidato nesta rodada — não marca em processamento, não incrementa
// tentativas, não adia. Sem essa regra, um trabalho SADIO queima as 8 tentativas só porque outro
// processo estava com a conversa naquele instante, e a conversa morre por envenenamento fabricado.
//
// O token é gerado aqui, em Node, e não por gen_random_uuid() no SQL. São equivalentes para o fim
// (é um valor opaco que só precisa ser irrepetível), e gerar em Node deixa o mesmo código rodar
// contra um banco de teste sem depender de extensão nem de dialeto.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export async function tomarPosse(execucaoId, workerId, { segundos = LEASE_SEGUNDOS_PADRAO, tx = null } = {}) {
  const cliente = tx ?? db();
  const token = crypto.randomUUID();
  const agora = await agoraDoBanco(cliente);
  const r = await cliente.ragnabotFluxoExecucao.updateMany({
    where: {
      id: execucaoId,
      OR: [{ leaseExpiraEm: null }, { leaseExpiraEm: { lt: agora } }],
    },
    data: { donoWorker: workerId, leaseToken: token, leaseExpiraEm: somarMs(agora, segundos * 1000) },
  });
  return r.count === 1 ? token : null;
}

export async function renovarPosse(execucaoId, leaseToken, { segundos = LEASE_SEGUNDOS_PADRAO } = {}) {
  const cliente = db();
  const agora = await agoraDoBanco(cliente);
  const r = await cliente.ragnabotFluxoExecucao.updateMany({
    where: { id: execucaoId, leaseToken, leaseExpiraEm: { gt: agora } },
    data: { leaseExpiraEm: somarMs(agora, segundos * 1000) },
  });
  return r.count === 1;
}

/** Libertação EXPLÍCITA. Sem ela, cada implantação deixa N conversas travadas por até 30 s — e num
 *  RollingUpdate isso acontece toda vez. Para o cliente é o robô ficando mudo no meio da frase. */
export async function liberarPosse(execucaoId, leaseToken) {
  const r = await db().ragnabotFluxoExecucao.updateMany({
    where: { id: execucaoId, leaseToken },
    data: { donoWorker: null, leaseToken: null, leaseExpiraEm: null },
  });
  return r.count === 1;
}

/** Batimento enquanto o passo roda. Devolve `parar()`; quem chama SEMPRE para no `finally`.
 *  Se a renovação falhar, não adianta insistir: a posse já é de outro, e a cerca do UPDATE de
 *  avanço vai descobrir isso — ela é a autoridade, não este relógio. */
function iniciarBatimento(execucaoId, leaseToken, aoPerder) {
  const t = setInterval(async () => {
    try {
      const ok = await renovarPosse(execucaoId, leaseToken);
      if (!ok) { clearInterval(t); aoPerder?.(); }
    } catch (e) {
      logger.warn(`[fluxo-motor] batimento de posse falhou (${execucaoId}): ${e.message}`);
    }
  }, BATIMENTO_MS);
  if (typeof t.unref === 'function') t.unref(); // nao segura o processo no encerramento
  return () => clearInterval(t);
}

/** A cerca, aplicada na LEITURA. A autoridade continua sendo o WHERE do UPDATE de avanço; esta
 *  conferência só evita gastar trabalho quando já dá para saber que a posse não é nossa. */
function conferirCerca(exec, leaseToken, agora) {
  if (!exec) throw new PossePerdida('execucao nao encontrada');
  if (!leaseToken || exec.leaseToken !== leaseToken) {
    throw new PossePerdida('o arrendamento e de outro processo', { execucaoId: exec.id, dono: exec.donoWorker });
  }
  if (!exec.leaseExpiraEm || new Date(exec.leaseExpiraEm) <= new Date(agora)) {
    throw new PossePerdida('o arrendamento venceu durante o passo', { execucaoId: exec.id });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// NASCIMENTO DA EXECUÇÃO
//
// A primeira mensagem é o único momento em que NÃO existe execução para arrendar. A serialização
// então é da PARTIÇÃO: pg_try_advisory_xact_lock(hashtextextended(chaveParticao,0)), segurado do
// início ao fim da transação e solto no COMMIT. O índice único parcial é a SEGUNDA barreira, não a
// primeira: sob corrida a colisão vira P2002, tratado recuperando a execução existente — o mesmo
// padrão que ragnabot-protocolo.service.js já usa e já provou em produção.
//
// ⚠️ O PROTOCOLO É EMITIDO ANTES DE ABRIR A TRANSAÇÃO, de propósito. emitirProtocolo() abre a
// transação DELE, no cliente global; chamá-lo de dentro da nossa seria uma segunda conexão presa
// enquanto a primeira segura a trava de partição — receita de esgotar o pool sob rajada. Emitir
// antes é seguro porque ele é idempotente por conversa: se a corrida for perdida logo em seguida, o
// número emitido é o mesmo que o vencedor usou.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Trava consultiva de PARTIÇÃO, presa à transação. Solta sozinha no COMMIT ou no ROLLBACK — não
 *  existe caminho de código que "esqueça de soltar", que é o modo de falha das travas de sessão. */
async function travarParticao(tx, chaveParticao) {
  const linhas = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${chaveParticao}, 0)) AS obtida`;
  return Array.isArray(linhas) && linhas[0] ? linhas[0].obtida === true : false;
}

/**
 * @returns {Promise<{execucao:object, nova:boolean}>}
 *
 * `janela` é opcional e vem de quem conhece a caixa (a portaria). Quando informada, o TTL da
 * execução é o MENOR entre (início + ttl do fluxo) e (fim da janela de 24 h − margem): manter uma
 * execução viva depois que a janela fechou é prometer a si mesmo que dá para responder quando não
 * dá mais.
 */
export async function iniciarOuRecuperarExecucao({
  tenantId, cwAccountId, cwConversationId, cwContactId = null, contatoChave = null,
  fluxoId, versaoId, janela = null, origemEm = null,
}) {
  if (!tenantId || !fluxoId || !versaoId) throw new ErroDoMotor('DADOS_INSUFICIENTES', 'tenantId, fluxoId e versaoId sao obrigatorios');
  const cliente = db();
  const chave = chaveParticaoDe({ cwAccountId, cwConversationId });

  // Caminho rápido, fora de qualquer trava: a esmagadora maioria dos eventos cai aqui.
  const viva = await acharExecucaoViva(cliente, cwAccountId, cwConversationId);
  if (viva) return { execucao: viva, nova: false };

  // O protocolo é da CONVERSA, não da execução. Uma retomada dias depois herda o mesmo número —
  // é o que faz "buscar pelo protocolo" continuar valendo depois de o cliente sumir e voltar.
  let protocolo = null;
  try {
    const emitido = await portas.protocolo.emitirProtocolo({ tenantId, cwAccountId, cwConversationId });
    protocolo = emitido?.protocolo ?? null;
  } catch (e) {
    // Empresa sem prefixo cadastrado é erro de cadastro, não de conversa. A execução nasce sem
    // protocolo e o incidente aparece para o operador; recusar a conversa seria punir o cliente por
    // um campo que ninguém preencheu.
    logger.warn(`[fluxo-motor] protocolo nao emitido (tenant=${tenantId}): ${e.message}`);
  }

  const fluxo = await cliente.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
  const ttl = fluxo?.ttlExecucaoSegundos ?? FREIOS_PADRAO.ttlExecucaoSegundos;

  try {
    return await cliente.$transaction(async (tx) => {
      const obtida = await travarParticao(tx, chave);
      if (!obtida) {
        // Outro processo está criando a execução desta MESMA conversa neste instante. Não
        // esperamos: devolvemos o que existir, e se ainda não existir, quem chamou reenfileira.
        const jaCriada = await acharExecucaoViva(tx, cwAccountId, cwConversationId);
        if (jaCriada) return { execucao: jaCriada, nova: false };
        throw new ErroDoMotor('PARTICAO_OCUPADA', 'outro processo esta criando a execucao desta conversa');
      }

      const dentroDaTrava = await acharExecucaoViva(tx, cwAccountId, cwConversationId);
      if (dentroDaTrava) return { execucao: dentroDaTrava, nova: false };

      const agora = await agoraDoBanco(tx);
      const anterior = await tx.ragnabotFluxoExecucao.findFirst({
        where: { cwAccountId, cwConversationId, estado: { in: [...ESTADOS_TERMINAIS] } },
        orderBy: { encerradaEm: 'desc' },
      });

      // Herança de variáveis conforme RagnabotFluxo.retomada. "reiniciar" é o padrão: o cliente que
      // volta uma semana depois quase nunca quer continuar de onde parou, e reaproveitar respostas
      // velhas em silêncio abre chamado com dado vencido.
      const herdaVars = fluxo?.retomada === 'herdar_vars' && anterior ? clonar(anterior.vars || {}) : {};

      const limiteTtl = somarMs(agora, ttl * 1000);
      const limiteJanela = janela?.expiraEm
        ? somarMs(janela.expiraEm, -1000 * (janela.margemSegurancaSegundos ?? 300))
        : null;
      const expiraEm = limiteJanela && limiteJanela < limiteTtl ? limiteJanela : limiteTtl;

      const execucao = await tx.ragnabotFluxoExecucao.create({
        data: {
          tenantId, cwAccountId, cwConversationId, cwContactId, contatoChave, protocolo,
          fluxoId, versaoId, versaoInicialId: versaoId,
          noAtualId: null, estado: 'rodando', aguardando: 'nada',
          vars: herdaVars, expiraEm, iniciadaEm: agora,
          origemExecucaoId: anterior?.id ?? null,
        },
      });

      await registrarEvento(tx, {
        tenantId, versaoId, execucaoId: execucao.id, tipo: 'no_entrou', noId: null,
        detalhe: { evento: 'execucao_iniciada', protocolo, retomadaDe: anterior?.id ?? null, origemEm },
      });

      return { execucao, nova: true };
    }, { timeout: 15_000 });
  } catch (e) {
    // O índice único parcial recusou: outro processo venceu a corrida entre a nossa leitura e o
    // nosso INSERT. Não é erro — é o resultado correto, e a execução dele serve para nós.
    if (e?.code === 'P2002') {
      const vencedora = await acharExecucaoViva(cliente, cwAccountId, cwConversationId);
      if (vencedora) return { execucao: vencedora, nova: false };
    }
    throw e;
  }
}

function acharExecucaoViva(cliente, cwAccountId, cwConversationId) {
  return cliente.ragnabotFluxoExecucao.findFirst({
    where: { cwAccountId, cwConversationId, estado: { in: [...ESTADOS_ATIVOS] } },
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COLETA DE RAJADA E CASAMENTO POSICIONAL NO TEMPO (§3.2/C)
//
// Serializar por conversa resolve a corrida técnica e cria um erro pior: a segunda mensagem do
// cliente seria consumida pela PRÓXIMA pergunta. O cliente escreve "preciso de ajuda" e depois "o
// servidor não liga", e a segunda vira o e-mail dele. As respostas trocam de lugar em silêncio — o
// pior tipo de defeito, porque ninguém descobre.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ORDEM: origemEm (carimbo do CLIENTE) → cwMessageId → id da fila.
 *
 * ⚠️ O id da fila sozinho é a ordem de chegada à NOSSA porta. Com duas réplicas de portaria e
 * latência desigual, duas mensagens quase simultâneas entram invertidas, e a regra "vale a última"
 * escolhe exatamente o contrário do que a pessoa quis.
 */
function ordenarRajada(entradas) {
  return [...entradas].sort((a, b) => {
    const ta = a.origemEm ? new Date(a.origemEm).getTime() : null;
    const tb = b.origemEm ? new Date(b.origemEm).getTime() : null;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if ((a.cwMessageId ?? 0) !== (b.cwMessageId ?? 0)) return (a.cwMessageId ?? 0) - (b.cwMessageId ?? 0);
    return Number(a.filaId ?? 0) - Number(b.filaId ?? 0);
  });
}

/**
 * CASAMENTO POSICIONAL NO TEMPO. Recusa casar mensagem cujo `origemEm` seja anterior ao início da
 * espera do nó atual: ela não é resposta dele — é nota interna, com texto e horário.
 *
 * Sem essa regra, uma mensagem que chegou atrasada porque o canal esteve surdo é gravada na variável
 * errada, e o chamado nasce com os campos trocados.
 *
 * ⚠️ `origemEm` ausente NÃO reprova. Não conseguimos provar que a mensagem é velha, e reprovar por
 * falta de carimbo jogaria fora resposta legítima de canal que não carimba. O risco residual (ordem
 * incerta) é tratado por `ordemIncerta`, não por descarte.
 */
export function podeCasarNoTempo(execucao, entrada) {
  if (!execucao?.aguardaDesde) return true;
  if (!entrada?.origemEm) return true;
  return new Date(entrada.origemEm).getTime() >= new Date(execucao.aguardaDesde).getTime();
}

/**
 * @returns {{consumir:object[], paraCaixaPendente:object[], ordemIncerta:boolean,
 *            montagem:'concatenar'|'ultima'|'anexar_variavel'|'nenhuma'}}
 *
 * `montagem` é acréscimo declarado ao contrato: sem ele, quem chama teria de reimplementar a tabela
 * de regras do §3.2/C, e duas cópias da mesma tabela divergem.
 */
export function coletarRajada(execucao, entradas, politicaContinuacao = {}) {
  const janelaSegundos = Number(politicaContinuacao.janelaSegundos ?? 20);
  const ambiguidadeMs = Number(politicaContinuacao.ambiguidadeMs ?? 2000);
  const ordenadas = ordenarRajada(entradas || []);

  // Ordem não provável: duas entradas a menos de `ambiguidadeMs` sem carimbo de origem confiável.
  let ordemIncerta = false;
  for (let i = 1; i < ordenadas.length; i += 1) {
    const a = ordenadas[i - 1]; const b = ordenadas[i];
    const semCarimbo = !a.origemEm || !b.origemEm;
    const juntas = a.origemEm && b.origemEm
      && Math.abs(new Date(b.origemEm).getTime() - new Date(a.origemEm).getTime()) < ambiguidadeMs;
    if (semCarimbo || juntas) { ordemIncerta = true; break; }
  }

  const noParado = execucao.noCongelado?.tipo ?? null;
  const aptas = ordenadas.filter((e) => podeCasarNoTempo(execucao, e));
  const foraDeTempo = ordenadas.filter((e) => !podeCasarNoTempo(execucao, e));

  if (execucao.aguardando === 'resposta') {
    if (noParado === 'lista' || noParado === 'botoes') {
      // Quem toca duas vezes está se corrigindo: vale a ÚLTIMA. Salvo ordem incerta — aí escolher
      // errado dispara efeito irreversível, e o certo é reperguntar (o passo transforma isso em
      // `opcao_invalida`).
      return { consumir: aptas, paraCaixaPendente: foraDeTempo, ordemIncerta, montagem: 'ultima' };
    }
    // `pergunta` e qualquer outro nó que estacione: CONCATENA. O cliente parte o pensamento em
    // várias mensagens, e é exatamente onde o campo "detalhes" do fluxo medido sofre.
    return { consumir: aptas, paraCaixaPendente: foraDeTempo, ordemIncerta, montagem: 'concatenar' };
  }

  if (execucao.aguardando === 'temporizador' && execucao.ultimaVariavel) {
    // O motor impõe 22 segundos de silêncio medidos neste fluxo, e a continuação natural do cliente
    // cai bem no meio deles. Anexar à variável da pergunta anterior é o que preserva a frase.
    const desde = execucao.aguardaDesde ? new Date(execucao.aguardaDesde).getTime() : null;
    const primeira = aptas[0]?.origemEm ? new Date(aptas[0].origemEm).getTime() : null;
    const dentro = desde != null && primeira != null && (primeira - desde) <= janelaSegundos * 1000;
    if (dentro) return { consumir: aptas, paraCaixaPendente: foraDeTempo, ordemIncerta, montagem: 'anexar_variavel' };
  }

  // Fora disso é contexto, não resposta.
  return { consumir: [], paraCaixaPendente: ordenadas, ordemIncerta, montagem: 'nenhuma' };
}

/** Monta a entrada única que vai para `receber()` do executor, segundo a `montagem` decidida. */
function montarEntradaDaRajada(consumir, montagem) {
  if (!consumir.length) return null;
  const ultima = consumir[consumir.length - 1];
  const corpoDe = (e) => (e.corpo && typeof e.corpo === 'object' ? e.corpo : {});
  const base = {
    origemEm: ultima.origemEm ?? null,
    cwMessageId: ultima.cwMessageId ?? null,
    wamid: ultima.wamid ?? null,
    interativo: corpoDe(ultima).interativo ?? null,
    anexos: corpoDe(ultima).anexos ?? [],
  };
  if (montagem === 'concatenar' || montagem === 'anexar_variavel') {
    const texto = consumir.map((e) => corpoDe(e).texto ?? '').filter(Boolean).join('\n');
    return { ...base, texto, partes: consumir.length };
  }
  return { ...base, texto: corpoDe(ultima).texto ?? '', partes: 1 };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAIXA DE SAÍDA DE DUAS FASES
//
// A reserva nasce na MESMA transação que avança o estado; a confirmação vem DEPOIS do efeito. O que
// fica no meio é o que o conciliador resolve.
//
// A ordem inversa (enviar e depois gravar) foi rejeitada por medição de consequência: uma queda
// entre enviar e gravar replicaria o nó e a mensagem sairia duas vezes SEM NENHUM registro durável
// de que saiu uma vez — impossível de conciliar, impossível de auditar. O preço assumido é que uma
// queda pode deixar mensagem não enviada. Silêncio seguido de repetição é falha melhor que
// "chamado registrado com sucesso" fantasma.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DENTRO da T1, com o MESMO `tx` que avança o estado. Nunca fora — reservar fora da transação é
 * exatamente como se cria um efeito órfão de uma transação que depois voltou atrás.
 *
 * A reserva é idempotente pela chave: se a mesma tentativa do mesmo nó na mesma visita for reservada
 * duas vezes (retentativa do job depois de a T1 ter commitado mas o processo ter morrido antes do
 * despacho), o P2002 devolve a linha existente em vez de criar uma segunda.
 */
export async function reservarEfeito(dados, tx) {
  const {
    execucaoId, tenantId, noId, visitaSeq, tentativa = 1, sufixo = '',
    tipo, politicaEmDuvida = 'conciliar', estadoAnterior = null, custoEstimadoCentavos = null,
  } = dados;
  const chave = chaveEfeito({ execucaoId, noId, visitaSeq, tentativa, sufixo });
  const cliente = tx ?? db();
  try {
    return await cliente.ragnabotFluxoEfeito.create({
      data: {
        execucaoId, tenantId, noId, visitaSeq, tentativa, sufixo, chave, tipo,
        politicaEmDuvida, estadoAnterior, custoEstimadoCentavos, status: 'reservado',
      },
    });
  } catch (e) {
    if (e?.code === 'P2002') return cliente.ragnabotFluxoEfeito.findUnique({ where: { chave } });
    throw e;
  }
}

export async function confirmarEfeito(chave, { idExterno = null, httpStatus = null, resposta = null } = {}) {
  const r = await db().ragnabotFluxoEfeito.updateMany({
    where: { chave, status: { in: ['reservado', 'duvidoso'] } },
    data: { status: 'confirmado', confirmadoEm: new Date(), idExterno, httpStatus, resposta },
  });
  return r.count === 1;
}

export async function falharEfeito(chave, { erro = null, httpStatus = null } = {}) {
  const r = await db().ragnabotFluxoEfeito.updateMany({
    where: { chave, status: { in: ['reservado', 'duvidoso'] } },
    data: { status: 'falhou', erro: erro ? String(erro).slice(0, 500) : null, httpStatus },
  });
  return r.count === 1;
}

export async function descartarEfeito(chave, { motivoDescarte }) {
  const r = await db().ragnabotFluxoEfeito.updateMany({
    where: { chave, status: { in: ['reservado', 'duvidoso'] } },
    data: { status: 'descartado', motivoDescarte },
  });
  return r.count === 1;
}

/**
 * Marca o efeito como DUVIDOSO e agenda a conciliação.
 *
 * ⚠️ TEMPO LIMITE ESGOTADO NÃO É FALHA, É DÚVIDA. Uma tentativa só; o efeito NÃO vira 'falhou'. Quem
 * decide é o conciliador, e só depois de uma conciliação NEGATIVA. Retentativa cega dentro do
 * cliente HTTP é como três listas idênticas chegam no celular do cliente quando o Chatwoot está
 * apenas LENTO, não fora: nesse caso a caixa de saída não protege nada, porque ninguém morreu.
 *
 * ⚠️ ESTA FUNÇÃO **NÃO PARA A MARCHA** — e o comentário que dizia o contrário estava errado, o que
 * custou um defeito medido. O job `conciliar` que ela agenda é prova para o varredor de órfãos,
 * mas o job de DESPERTAR do mesmo nó JÁ FOI COMMITADO na T1 (ramo `aguardar` de `marchar`) e
 * ressuscitava a conversa quatro minutos depois: a pergunta era reenviada ao cliente que já a tinha
 * lido e um `sem_resposta` era contado contra ele. Quem para a marcha de verdade, no BANCO, é
 * `bloquearPorEfeitoPendente` — e ela precisa da CERCA, por isso mora fora daqui.
 */
async function marcarEfeitoDuvidoso(cliente, efeito, execucao, motivo, { tx = null, agora = null } = {}) {
  await cliente.ragnabotFluxoEfeito.updateMany({
    where: { chave: efeito.chave, status: 'reservado' },
    data: { status: 'duvidoso', erro: String(motivo).slice(0, 500) },
  });
  const fila = portas.fila;
  if (fila?.enfileirar) {
    // ⚠️ `tx` quando a chamada vem de dentro da T1: o job de conciliação tem de nascer e morrer com a
    // mesma transação que congelou a conversa. Enfileirar fora dela deixaria trabalho apontando para
    // um congelamento que voltou atrás. E o `disponivelEm` sai do relógio do BANCO quando ele está à
    // mão — pod fora de sincronia agenda conciliação para o passado ou para daqui a uma hora.
    await fila.enfileirar({
      tipo: TIPOS_JOB.CONCILIAR,
      chaveParticao: chaveParticaoDe(execucao),
      tenantId: execucao.tenantId,
      execucaoId: execucao.id,
      payload: { chaveEfeito: efeito.chave, motivo: String(motivo).slice(0, 200) },
      disponivelEm: somarMs(agora ?? new Date(), DUVIDA_CONCILIAR_SEGUNDOS * 1000),
    }, tx ?? undefined);
  }
}

/**
 * O EFEITO QUE SEGURA A CONVERSA — a consulta que a barreira do passo e o varredor de órfãos fazem.
 *
 * Devolve o efeito mais antigo desta execução que continua sem desfecho (`reservado` ou `duvidoso`)
 * depois da carência do conciliador. Enquanto ele existir, ninguém sabe se o cliente recebeu a
 * mensagem, nem se o ERP recebeu o chamado — e marchar por cima disso é como nasce a promessa falsa.
 *
 * ⚠️ EFEITO COM POLÍTICA 'seguir' É EXCLUÍDO DE PROPÓSITO. É o aviso ao plantonista, a nota interna,
 * o carimbo idempotente: falha de encanamento nosso NUNCA pode congelar o atendimento de quem está
 * do outro lado. É a mesma separação que faz `erro_interno` seguir o fluxo.
 *
 * ⚠️ O filtro por `status` + `reservadoEm` é o que usa o `@@index([status, reservadoEm])` do modelo:
 * a esmagadora maioria das linhas está 'confirmado' e nem é lida. `execucaoId` não tem índice
 * próprio, e é filtro secundário exatamente por isso.
 */
async function efeitoPendenteBloqueante(cliente, execucaoId, agora) {
  return cliente.ragnabotFluxoEfeito.findFirst({
    where: {
      execucaoId,
      status: { in: ['reservado', 'duvidoso'] },
      politicaEmDuvida: { not: 'seguir' },
      reservadoEm: { lt: somarMs(agora, -DUVIDA_CONCILIAR_SEGUNDOS * 1000) },
    },
    orderBy: { reservadoEm: 'asc' },
  });
}

/** Efeito sem desfecho de UMA visita específica de UM nó — sem carência, porque quem pergunta é o
 *  despertar do próprio nó, e ali a espera já foi de minutos. */
async function efeitoPendenteDoNo(cliente, execucaoId, noId, visitaSeq) {
  if (!noId) return null;
  return cliente.ragnabotFluxoEfeito.findFirst({
    where: {
      execucaoId, noId, visitaSeq,
      status: { in: ['reservado', 'duvidoso'] },
      politicaEmDuvida: { not: 'seguir' },
    },
  });
}

/**
 * CONGELA A CONVERSA, NO BANCO E COM A CERCA COMPLETA.
 *
 * `estado='pausado_duvida'` não é enfeite: ele está em `ESTADOS_PAUSADOS`, e o ramo 'pausada' do
 * `passo` recusa marchar — inclusive um DESPERTAR, que é justamente o que ressuscitava a conversa e
 * contava `sem_resposta` indevido. Retorno de função não segura nada: o job já está gravado.
 *
 * ⚠️ A CERCA É `id + leaseToken + leaseExpiraEm > agora`, e não só `id`. Um trabalhador que ficou
 * numa pausa longa de coletor de lixo perde o arrendamento sem saber, volta minutos depois e, com um
 * WHERE só por `id`, CONGELA a conversa que outro processo já assumiu e está tocando normalmente —
 * o cliente fica esperando para sempre uma resposta que ninguém vai dar. Zero linhas afetadas é
 * `PossePerdida`, e quem chama para tudo.
 *
 * ⚠️ NÃO MEXE em `acordarEm`, `aguardaDesde`, `saidaAoVencer` nem `noCongelado` — de propósito.
 * Destravar esta conversa (conciliador, ou pessoa devolvendo ao bot) é: repor `estado='esperando'`
 * ou `'rodando'`, repor `aguardando` para o valor que o nó pedia, e reenfileirar um DESPERTAR com
 * `tokenVisita = visitaSeq`. Apagar o prazo aqui destruiria a informação necessária para isso.
 */
async function bloquearPorEfeitoPendente(cliente, exec, leaseToken, agora, motivo) {
  const r = await cliente.ragnabotFluxoExecucao.updateMany({
    where: { id: exec.id, leaseToken, leaseExpiraEm: { gt: agora } },
    data: {
      estado: 'pausado_duvida',
      aguardando: 'humano',
      prazoEm: somarMs(agora, BLOQUEIO_DUVIDA_MINUTOS * 60 * 1000),
      ultimoErro: String(motivo).slice(0, 500),
    },
  });
  if (r.count !== 1) {
    throw new PossePerdida('a cerca recusou o congelamento por efeito pendente', { execucaoId: exec.id });
  }
}

/**
 * O QUE FAZER COM UM EFEITO QUE NÃO SE SABE SE ACONTECEU — decidido pela política que o PRÓPRIO
 * efeito carrega na linha (`RagnabotFluxoEfeito.politicaEmDuvida`), nunca por um padrão único.
 *
 *   'seguir'      → aviso interno. A marcha CONTINUA; a barreira do passo também o ignora.
 *   'parar'       → congela e fala com o cliente a verdade, enquanto a janela ainda está aberta.
 *   'conciliar' | 'condicional' | 'reenviar' → congela e agenda a conciliação, SEM falar nada.
 *
 * ⚠️ 'reenviar' cai no congelamento e não no reenvio porque reenviar exige remontar a intenção
 * (corpo, itens, mídia) a partir do nó, e nada disso está gravado na linha do efeito. Reenviar
 * "quase igual" a um destino que não honre o `rgt_efeito` é o D3 pelo avesso: a mesma mensagem duas
 * vezes. Enquanto o conciliador não existir (conferido: NENHUM serviço deste repositório lê
 * `RagnabotFluxoEfeito`), congelar com prazo é a única resposta que não mente.
 */
async function tratarEfeitoDuvidoso({ exec, efeito, motivo, politica, leaseToken, porta }) {
  const cliente = db();
  const agora = await agoraDoBanco(cliente);

  if (politica === 'seguir') {
    await marcarEfeitoDuvidoso(cliente, efeito, exec, motivo, { agora });
    return { continuarMarcha: true, resultado: 'efeito_duvidoso_seguiu' };
  }

  // A CERCA PRIMEIRO, ANTES DE QUALQUER PALAVRA AO CLIENTE. Se o arrendamento não é mais nosso,
  // `PossePerdida` sobe daqui e o cliente não recebe um aviso contraditório no meio de uma conversa
  // que OUTRO trabalhador está tocando normalmente.
  await bloquearPorEfeitoPendente(cliente, exec, leaseToken, agora, `efeito "${efeito.tipo}" sem confirmacao: ${motivo}`);
  await marcarEfeitoDuvidoso(cliente, efeito, exec, motivo, { agora });

  if (politica === 'parar') {
    await avisarClienteDaDuvida(exec, efeito, porta);
    await abrirIncidente(null, {
      tenantId: exec.tenantId, versaoId: exec.versaoId, noId: efeito.noId, codigo: 'EFEITO_DUVIDOSO', nivel: 'erro',
      mensagem: `nao foi possivel confirmar o efeito "${efeito.tipo}" — a conversa foi congelada e o cliente avisado`,
      comoCorrigir: 'confira no destino se a acao aconteceu e devolva a conversa ao bot, ou conclua manualmente',
    });
    return { continuarMarcha: false, resultado: 'pausado_duvida' };
  }

  await abrirIncidente(null, {
    tenantId: exec.tenantId, versaoId: exec.versaoId, noId: efeito.noId, codigo: 'EFEITO_DUVIDOSO', nivel: 'erro',
    mensagem: `nao foi possivel confirmar o efeito "${efeito.tipo}" — a conversa foi congelada aguardando conciliacao`,
    comoCorrigir: 'procure a chave rgt_efeito no destino; se a acao aconteceu, confirme o efeito e devolva a conversa ao bot',
  });
  return { continuarMarcha: false, resultado: 'efeito_duvidoso' };
}

/**
 * Um erro de despacho é DÚVIDA ou FALHA?
 *
 * Falha = o destino disse não (recusa explícita, 4xx, código da Meta). Dúvida = não sabemos se
 * chegou (tempo limite, conexão cortada, 5xx sem corpo, aborto). A distinção não é firula: tratar
 * dúvida como falha faz o motor rerotear por `erro` e, se a mensagem tiver saído, o cliente recebe a
 * mensagem E o desvio de erro.
 */
function classificarErroDeDespacho(e) {
  const codigo = String(e?.code || e?.codigo || '').toUpperCase();
  const msg = String(e?.message || '').toLowerCase();
  const status = Number(e?.status ?? e?.httpStatus ?? e?.response?.status ?? 0);
  if (e?.foraDaJanela === true || ehErroDoMotor(e, 'JANELA_FECHADA')) return 'fora_da_janela';
  if (status >= 400 && status < 500) return 'falha';
  if (codigo.includes('TIMEOUT') || codigo === 'ECONNRESET' || codigo === 'ECONNABORTED'
      || codigo === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('aborted')) return 'duvida';
  if (status >= 500 || codigo === 'ECONNREFUSED' || codigo === 'ENOTFOUND' || codigo === 'EAI_AGAIN') return 'duvida';
  return 'falha';
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// JANELA DE 24 HORAS
//
// ⚠️ A chave é (número DA EMPRESA, destinatário), NÃO (conta, contato): há DUAS conexões de WhatsApp
// medidas na MESMA empresa. Uma janela aberta por um número não vale pelo outro.
//
// ⚠️ QUANDO NÃO DÁ PARA DECIDIR, O MOTOR NÃO CHUTA. Sem `phoneNumberId` conhecido, devolve
// `aberta: null` (indeterminada) e deixa a decisão para a PortaCanal, que é quem fala com a Meta e
// recebe a recusa autoritativa. Um padrão otimista ("deve estar aberta") transformaria a política
// inteira em esperança; um padrão pessimista travaria todo envio de caixa cujo número ainda não foi
// cadastrado. Indeterminado é a única resposta honesta, e ela é registrada.
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function avaliarJanela(cliente, execucao, phoneNumberId) {
  if (!phoneNumberId || !execucao.contatoChave) {
    return { aberta: null, expiraEm: null, margemSegurancaSegundos: 300, motivo: 'indeterminada' };
  }
  const linha = await cliente.ragnabotFluxoJanela.findUnique({
    where: { phoneNumberId_destinatarioWaId: { phoneNumberId, destinatarioWaId: execucao.contatoChave } },
  });
  if (!linha) return { aberta: false, expiraEm: null, margemSegurancaSegundos: 300, motivo: 'sem_registro' };
  const agora = await agoraDoBanco(cliente);
  const margem = linha.margemSegurancaSegundos ?? 300;
  const limite = somarMs(linha.expiraEm, -margem * 1000);
  if (linha.fechadaPeloDestinoEm) {
    return { aberta: false, expiraEm: linha.expiraEm, margemSegurancaSegundos: margem, motivo: 'fechada_pelo_destino' };
  }
  return {
    aberta: new Date(agora) < limite,
    expiraEm: linha.expiraEm,
    margemSegurancaSegundos: margem,
    motivo: new Date(agora) < limite ? 'aberta' : 'vencida',
  };
}

/**
 * PRAZO MEDIDO EM TEMPO DE CANAL DE PÉ (§3.2/F).
 *
 * Desconta do prazo a interseção entre [aguardaDesde, agora] e as janelas de degradação do canal.
 * Um prazo de 4 minutos e um atraso mediano de 6 minutos são matematicamente incompatíveis — nessa
 * condição `sem_resposta` NÃO pode significar "o cliente não respondeu", e o motor não pode afirmar
 * que significa.
 *
 * @returns {Promise<number>} milissegundos de degradação a descontar
 */
async function msDeCanalCaido(cliente, cwAccountId, desde, ate) {
  if (!desde) return 0;
  const saude = await cliente.ragnabotFluxoCanalSaude.findUnique({ where: { cwAccountId } }).catch(() => null);
  if (!saude) return 0;
  const janelas = Array.isArray(saude.janelas) ? saude.janelas : [];
  const emAberto = saude.degradadoDesde && !saude.degradadoAte ? [[saude.degradadoDesde, ate]] : [];
  const a = new Date(desde).getTime(); const b = new Date(ate).getTime();
  let total = 0;
  for (const [ini, fim] of [...janelas, ...emAberto]) {
    if (!ini) continue;
    const i = new Date(ini).getTime();
    const f = fim ? new Date(fim).getTime() : b;
    const inter = Math.min(b, f) - Math.max(a, i);
    if (inter > 0) total += inter;
  }
  return total;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O PASSO — onde exatamente fica o commit (§3.2/D)
//
//   T1 (transação CURTA, ZERO chamada de rede dentro):
//       SELECT execucao FOR UPDATE
//       conferir lease + cerca
//       conferir RagnabotFluxoEntradaConsumida            -> EntradaJaConsumida
//       resolver a saída -> aresta ÚNICA -> nó de destino
//       marchar pelos nós SEM efeito (interpolação e condição são baratas e locais)
//       conferir janela de 24 h e saúde do canal
//       INSERT RagnabotFluxoEfeito status='reservado', chave determinística   <- A RESERVA
//       UPDATE RagnabotFluxoExecucao ... AND leaseToken=$t AND leaseExpiraEm>now()  <- A CERCA
//       INSERT RagnabotFluxoEvento + RagnabotFluxoEntradaConsumida
//     COMMIT
//   despacho FORA de transação: PortaCanal -> Chatwoot / Cloud API / egresso
//   T2 (curta): confirma | falha | dúvida; se falhou e o nó tem saída de erro, reroteia por ela
//
// A T1 marcha por nós de efeito 'nenhum' e PARA no primeiro nó que produz efeito ou que estaciona.
// Marchar além disso reservaria a mensagem do nó seguinte antes de saber se a do nó anterior saiu —
// e, se a primeira falhasse, a segunda já teria ido, deixando o cliente com a resposta sem a
// pergunta.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** SELECT ... FOR UPDATE. A cerca do arrendamento já protege contra outro PROCESSO; esta trava de
 *  linha protege contra o vigia que toca a mesma linha por outro caminho (expirador, escalador). */
async function travarLinhaDaExecucao(tx, execucaoId) {
  try {
    await tx.$queryRaw`SELECT id FROM "RagnabotFluxoExecucao" WHERE id = ${execucaoId} FOR UPDATE`;
  } catch (e) {
    // Banco que não entende FOR UPDATE (ou dublê de teste) não invalida o passo: a cerca do UPDATE
    // continua sendo a autoridade. Registrar e seguir é honesto; abortar seria trocar uma proteção
    // secundária por indisponibilidade.
    logger.debug(`[fluxo-motor] FOR UPDATE indisponivel: ${e.message}`);
  }
}

function montarContexto({ no, exec, versao, entrada, agora, janela, limites, coletor, mensagemFalhaPadrao = null }) {
  return {
    no,
    vars: clonar(exec.vars || {}),
    entrada: entrada ?? null,
    execucao: {
      id: exec.id, tenantId: exec.tenantId, cwAccountId: exec.cwAccountId,
      cwConversationId: exec.cwConversationId, protocolo: exec.protocolo,
      visitaSeq: exec.visitaSeq, tentativasNo: clonar(exec.tentativasNo || {}),
      fluxoId: exec.fluxoId, versaoId: versao.id,
      // Degrau do meio de `mensagemDeFalha()` no executor de nó: config do nó → ISTO → constante.
      // Sem ele o degrau é morto por construção e cada empresa fica presa à frase do código.
      mensagemFalhaPadrao,
    },
    // ⚠️ Sentinelas: tocar a rede aqui dentro LANÇA. Ver a regra R1 do contrato do executor.
    canal: sentinelaDeRede('canal'),
    egresso: sentinelaDeRede('egresso'),
    // O cofre é permitido dentro da T1 porque é leitura LOCAL do nosso banco mais decifragem — não
    // atravessa fronteira de rede. E o tenantId vem da EXECUÇÃO, jamais do nó: um findFirst por
    // apelido devolveria a linha de OUTRA empresa, e o cliente A mandaria requisição com o token do
    // cliente B.
    cofre: { resolver: (apelido) => exigirPorta('cofre').resolver(exec.tenantId, apelido) },
    limites,
    janela,
    agora,
    registrar: (evento) => coletor.eventos.push({ ...evento, tenantId: exec.tenantId, versaoId: versao.id, execucaoId: exec.id }),
    incidente: (codigo, dados = {}) => coletor.incidentes.push({
      tenantId: exec.tenantId, versaoId: versao.id, noId: dados.noId ?? no?.id ?? null,
      codigo, nivel: dados.nivel ?? 'erro',
      mensagem: dados.mensagem ?? codigo, comoCorrigir: dados.comoCorrigir ?? null, amostra: dados.amostra ?? null,
    }),
  };
}

/** Congela o que o cliente ESTÁ VENDO no celular. Sem isso, trocar o título de um item enquanto
 *  alguém está com a lista aberta corrompe a resposta em silêncio — a pessoa responde ao que já
 *  saiu, não ao documento novo. Guarda REFERÊNCIAS (ids, títulos, apelidos), nunca binário. */
function congelarNo(no, intencoes) {
  const itens = [];
  for (const i of intencoes || []) {
    for (const it of i.itens || i.botoes || []) {
      itens.push({ id: it.id, titulo: it.titulo ?? it.rotulo ?? null, apelidos: it.apelidos ?? [] });
    }
  }
  return { id: no.id, tipo: no.tipo, titulo: no.titulo ?? null, config: clonar(no.config ?? {}), itens };
}

/**
 * UM passo: T1 + despacho + T2.
 *
 * @returns {Promise<{resultado:string, continuar:boolean, execucao:object|null, noId:string|null}>}
 *   `continuar:true` significa que a marcha desta conversa ainda tem trabalho AGORA — quem chama
 *   deve pedir outro passo (respeitando `passosPorEvento`).
 * @throws {PossePerdida}
 */
export async function passo(execucaoId, leaseToken, job = {}) {
  const cliente = db();
  const coletor = { eventos: [], incidentes: [] };

  // ── T1 ────────────────────────────────────────────────────────────────────────────────────────
  const plano = await cliente.$transaction(async (tx) => {
    const agora = await agoraDoBanco(tx);
    await travarLinhaDaExecucao(tx, execucaoId);

    const exec = await tx.ragnabotFluxoExecucao.findUnique({ where: { id: execucaoId } });
    conferirCerca(exec, leaseToken, agora);

    if (ESTADOS_TERMINAIS.includes(exec.estado)) return { resultado: 'terminada', continuar: false, exec };
    if (ESTADOS_PAUSADOS.includes(exec.estado) && job.tipo !== TIPOS_JOB.CONTINUAR_HTTP) {
      // Conversa pausada não marcha sozinha. Quem destrava é gente (devolveu ao bot) ou o
      // conciliador. Avançar aqui seria o robô falando por cima da analista.
      return { resultado: 'pausada', continuar: false, exec };
    }
    if (exec.expiraEm && new Date(exec.expiraEm) <= new Date(agora)) {
      await encerrarNaTransacao(tx, exec, 'abandonado', 'ttl_ou_janela_vencida', agora);
      return { resultado: 'expirada', continuar: false, exec };
    }

    // ── BARREIRA DO EFEITO PENDENTE — impede o renascimento do D3 ───────────────────────────────
    //
    // MEDIDO: o trabalhador commita a T1 (efeito 'reservado', ponteiro JÁ no nó seguinte, mensagem
    // marcada como consumida) e o processo morre antes do despacho. O ceifador devolve o job, o
    // segundo trabalhador o descarta como "entrada já consumida" e o VARREDOR DE ÓRFÃOS reenfileirava
    // a marcha: a conversa andava por cima do efeito reservado e o cliente lia «Chamado RGT-… aberto!»
    // sem que o ERP tivesse recebido nada. É palavra por palavra a armadilha nº 4 do topo do arquivo.
    //
    // Piorava com o tempo: NENHUM serviço deste repositório varre `status='reservado'` (conferido),
    // então o efeito ficava reservado para sempre e ninguém era avisado.
    //
    // Depois da carência do conciliador, a conversa PARA no banco e ganha prazo de gente. Congelar é
    // a falha aceitável; marchar por cima é a inaceitável.
    const pendente = await efeitoPendenteBloqueante(tx, exec.id, agora);
    if (pendente) {
      const motivo = `efeito "${pendente.tipo}" do no "${pendente.noId}" continua ${pendente.status} desde ${new Date(pendente.reservadoEm).toISOString()}`;
      await bloquearPorEfeitoPendente(tx, exec, leaseToken, agora, motivo);
      // 'reservado' vira 'duvidoso' porque é EXATAMENTE isso: não se sabe se aconteceu. Também é o
      // que coloca a linha na fila do conciliador — que só olha o que está marcado como duvidoso.
      await marcarEfeitoDuvidoso(tx, pendente, exec, motivo, { tx, agora });
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: exec.versaoId, noId: pendente.noId,
        codigo: 'EFEITO_DUVIDOSO', nivel: 'erro',
        mensagem: `a conversa foi congelada: ${motivo}`,
        comoCorrigir: 'procure a chave rgt_efeito no destino; se a acao aconteceu, confirme o efeito e devolva a conversa ao bot',
        amostra: { chaveEfeito: pendente.chave, jobTipo: job?.tipo ?? null },
      });
      await gravarColetor(tx, coletor);
      return { resultado: 'efeito_pendente', continuar: false, exec };
    }

    const versao = await carregarVersao(tx, exec.versaoId);
    const fluxo = await tx.ragnabotFluxo.findUnique({ where: { id: exec.fluxoId } });
    const freios = {
      passosPorEvento: fluxo?.passosPorEvento ?? FREIOS_PADRAO.passosPorEvento,
      passosTotalMax: fluxo?.passosTotalMax ?? FREIOS_PADRAO.passosTotalMax,
      visitasPorNoMax: fluxo?.visitasPorNoMax ?? FREIOS_PADRAO.visitasPorNoMax,
    };
    const politicaContinuacao = fluxo?.politicaContinuacao ?? {};
    // Degrau do MEIO da cascata de `mensagemDeFalha()` (nó → empresa → constante do código).
    // ⚠️ A coluna `RagnabotFluxo.mensagemFalhaPadrao` AINDA NÃO EXISTE no schema (conferido em
    // prisma/schema.prisma) e é de outro dono. Lida por opcional aqui de propósito: enquanto ela não
    // existir isto é `null` e a cascata cai na constante, que é o comportamento seguro; no dia em que
    // for criada, passa a valer sem tocar em uma linha deste arquivo.
    const mensagemFalhaPadrao = fluxo?.mensagemFalhaPadrao ?? null;
    const limites = portas.limites ? await portas.limites.perfilDe(exec).catch(() => null) : null;
    const janela = await avaliarJanela(tx, exec, job.phoneNumberId ?? null);

    const estado = {
      vars: clonar(exec.vars || {}),
      visitasPorNo: clonar(exec.visitasPorNo || {}),
      tentativasNo: clonar(exec.tentativasNo || {}),
      caixaPendente: clonar(exec.caixaPendente || []),
      pilha: clonar(exec.pilha || []),
      trilha: clonar(exec.trilha || []),
      trilhaTruncada: exec.trilhaTruncada === true,
      passosTotal: exec.passosTotal ?? 0,
      visitaSeq: exec.visitaSeq ?? 0,
      ultimaVariavel: exec.ultimaVariavel ?? null,
    };

    // ── 1. RESOLVER A SAÍDA DO NÓ PARADO (quando há um) ─────────────────────────────────────────
    const decisao = await decidirSaida({ tx, exec, versao, job, agora, janela, limites, coletor, estado, politicaContinuacao, leaseToken, mensagemFalhaPadrao });
    if (decisao.encerrarPasso) {
      await gravarColetor(tx, coletor);
      return { resultado: decisao.resultado, continuar: decisao.continuar === true, exec, extra: decisao.extra ?? null };
    }

    // ── 2. A MARCHA ─────────────────────────────────────────────────────────────────────────────
    let noId;
    if (decisao.acaoFinal) {
      // Ação final da exceção: o teto de tentativas estourou e o motor decide o destino, porque a
      // saída de exceção é gerada por ELE e não pelo autor do fluxo (§4.4/A1).
      const af = decisao.acaoFinal;
      if (af.terminar) {
        const efeitos = [];
        if (af.intencao) {
          const efeito = await reservarEfeito({
            execucaoId: exec.id, tenantId: exec.tenantId, noId: exec.noAtualId, visitaSeq: estado.visitaSeq + 1,
            tentativa: (job?.tentativas ?? 0) + 1, sufixo: af.intencao.sufixo ?? 'acao_final',
            tipo: af.intencao.tipo, politicaEmDuvida: 'condicional',
          }, tx);
          efeitos.push({ efeito, intencao: af.intencao, politicaEmDuvida: 'condicional', condicional: true, interno: true });
        }
        await salvarComCerca(tx, exec, leaseToken, agora, {
          estado: 'concluido', motivoFim: af.terminar, encerradaEm: agora, aguardando: 'nada',
          acordarEm: null, tentativasNo: estado.tentativasNo, visitaSeq: estado.visitaSeq + 1,
        });
        await marcarConsumidas(tx, exec, agora, decisao.consumidas);
        await gravarColetor(tx, coletor);
        return {
          resultado: `acao_final:${af.terminar}`, continuar: false, exec, agora, efeitos,
          versaoId: versao.id, noEfeitoId: exec.noAtualId,
        };
      }
      noId = af.irParaNo ?? destinoDaSaida(versao, exec.noAtualId, af.saida ?? 'padrao');
      if (!noId) {
        await encerrarNaTransacao(tx, exec, 'erro', 'acao_final_sem_destino', agora);
        await gravarColetor(tx, coletor);
        return { resultado: 'acao_final_sem_destino', continuar: false, exec };
      }
      estado.trilha.push([exec.noAtualId, `acao_final:${af.saida ?? af.irParaNo}`, ms(agora, exec.iniciadaEm)]);
    } else if (decisao.revisitarNoAtual) {
      // Dentro do teto de `sem_resposta`: revisita o MESMO nó. O texto de reforço é do NÓ (só ele
      // conhece a própria configuração); o motor é dono da CONTAGEM e da ação final, não da redação.
      noId = exec.noAtualId;
    } else if (decisao.saida) {
      noId = destinoDaSaida(versao, exec.noAtualId, decisao.saida);
      if (!noId) {
        // ARESTA_AUSENTE: a saída existe no nó mas ninguém a ligou a lugar nenhum. Parar é a única
        // resposta honesta — mandar a conversa para o nó "mais parecido" erra em silêncio, e errar
        // em silêncio no meio de uma conversa de cliente é pior que parar.
        coletor.incidentes.push({
          tenantId: exec.tenantId, versaoId: versao.id, noId: exec.noAtualId, codigo: 'ARESTA_AUSENTE', nivel: 'erro',
          mensagem: `a saida "${decisao.saida}" do no "${exec.noAtualId}" nao esta ligada a nenhum no`,
          comoCorrigir: 'ligue essa saida a um no no editor e publique de novo',
        });
        await encerrarNaTransacao(tx, exec, 'erro', `aresta_ausente:${exec.noAtualId}:${decisao.saida}`, agora);
        await gravarColetor(tx, coletor);
        return { resultado: 'aresta_ausente', continuar: false, exec };
      }
      estado.trilha.push([exec.noAtualId, decisao.saida, ms(agora, exec.iniciadaEm)]);
    } else {
      noId = exec.noAtualId ?? versao.noInicialId;
    }

    const marcha = await marchar({
      tx, exec, versao, noId, agora, janela, limites, coletor, estado, freios,
      entrada: decisao.entrada ?? null, job, leaseToken, mensagemFalhaPadrao,
    });

    // ── 3. A CERCA ──────────────────────────────────────────────────────────────────────────────
    const dados = {
      // `versaoId` entra no UPDATE por causa do sub-fluxo: `saltar` troca a versão em que a conversa
      // roda. A FK composta (tenantId, versaoId) do banco recusa amarrar a execução a uma versão de
      // OUTRA empresa — mesmo que este código errasse o filtro.
      versaoId: marcha.versaoId ?? exec.versaoId,
      noAtualId: marcha.noAtualId,
      noCongelado: marcha.noCongelado,
      visitaSeq: estado.visitaSeq,
      aguardando: marcha.aguardando,
      aguardaDesde: marcha.aguardaDesde,
      acordarEm: marcha.acordarEm,
      saidaAoVencer: marcha.saidaAoVencer,
      vars: estado.vars,
      visitasPorNo: estado.visitasPorNo,
      tentativasNo: estado.tentativasNo,
      caixaPendente: estado.caixaPendente,
      pilha: estado.pilha,
      trilha: estado.trilha.slice(-TRILHA_MAX),
      trilhaTruncada: estado.trilhaTruncada || estado.trilha.length > TRILHA_MAX,
      passosTotal: estado.passosTotal,
      ultimaVariavel: estado.ultimaVariavel,
      estado: marcha.estadoExecucao,
      motivoFim: marcha.motivoFim ?? null,
      encerradaEm: ESTADOS_TERMINAIS.includes(marcha.estadoExecucao) ? agora : null,
    };
    const aplicado = await tx.ragnabotFluxoExecucao.updateMany({
      where: { id: exec.id, leaseToken, leaseExpiraEm: { gt: agora } },
      data: dados,
    });
    if (aplicado.count !== 1) {
      // Zero linhas ⇒ o arrendamento não é mais nosso. A transação inteira volta atrás, INCLUSIVE as
      // reservas de efeito — nenhum efeito é executado. É por isso que a reserva mora aqui dentro.
      throw new PossePerdida('a cerca do UPDATE recusou o avanco', { execucaoId: exec.id });
    }

    // ── 4. IDEMPOTÊNCIA DE CONSUMO (segunda barreira) ───────────────────────────────────────────
    await marcarConsumidas(tx, exec, agora, decisao.consumidas);

    await gravarColetor(tx, coletor);

    return {
      resultado: marcha.resultado, continuar: marcha.continuar, exec, agora,
      efeitos: marcha.efeitos, versaoId: marcha.versaoId ?? versao.id, noEfeitoId: marcha.noEfeitoId,
    };
  }, { timeout: 20_000 });

  // ── DESPACHO + T2 ─────────────────────────────────────────────────────────────────────────────
  if (!plano.efeitos || plano.efeitos.length === 0) {
    return { resultado: plano.resultado, continuar: plano.continuar === true, execucao: plano.exec, noId: plano.exec?.noAtualId ?? null };
  }
  const desfecho = await despacharEConfirmar(plano, leaseToken);
  return { resultado: desfecho.resultado, continuar: desfecho.continuar, execucao: plano.exec, noId: plano.noEfeitoId };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// AUXILIARES DA T1
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function gravarColetor(tx, coletor) {
  for (const ev of coletor.eventos) await registrarEvento(tx, ev);
  for (const inc of coletor.incidentes) await abrirIncidente(tx, inc);
  coletor.eventos.length = 0;
  coletor.incidentes.length = 0;
}

async function encerrarNaTransacao(tx, exec, estado, motivoFim, agora) {
  await tx.ragnabotFluxoExecucao.updateMany({
    where: { id: exec.id },
    data: { estado, motivoFim, encerradaEm: agora, aguardando: 'nada', acordarEm: null },
  });
}

/** Grava estado COM a cerca, nos caminhos que terminam o passo antes da marcha. Sem a cerca aqui,
 *  um processo que perdeu a posse ainda conseguiria mexer na caixa pendente da conversa. */
async function salvarComCerca(tx, exec, leaseToken, agora, data) {
  const r = await tx.ragnabotFluxoExecucao.updateMany({
    where: { id: exec.id, leaseToken, leaseExpiraEm: { gt: agora } }, data,
  });
  if (r.count !== 1) throw new PossePerdida('a cerca recusou a gravacao', { execucaoId: exec.id });
}

/** Marca as entradas consumidas nas DUAS barreiras: a linha de consumo (por execução + mensagem) e
 *  o `resultado` da entrada bruta. Precisa rodar em TODO caminho que consome — inclusive o da ação
 *  final, que termina a conversa: entrada que fica com `resultado` nulo é entrada que uma execução
 *  futura pode tentar consumir de novo. */
async function marcarConsumidas(tx, exec, agora, consumidas) {
  for (const e of consumidas || []) {
    if (e.cwMessageId != null) {
      await tx.ragnabotFluxoEntradaConsumida.create({
        data: { execucaoId: exec.id, cwMessageId: e.cwMessageId, noId: exec.noAtualId ?? '' },
      }).catch((err) => { if (err?.code !== 'P2002') throw err; });
    }
    await tx.ragnabotFluxoEntrada.updateMany({
      where: { id: e.id }, data: { resultado: 'aplicado', processadaEm: agora },
    });
  }
}

async function carregarEntradas(tx, exec, job) {
  const ids = job?.payload?.entradaIds || (job?.entradaId ? [job.entradaId] : []);
  if (ids.length) {
    const linhas = await tx.ragnabotFluxoEntrada.findMany({ where: { id: { in: ids } } });
    return linhas.map((l) => ({ ...l, filaId: job.id ?? null }));
  }
  // Sem lista explícita, pega o que ainda não foi aplicado nesta conversa. É o caminho da retomada
  // após reinício: o job morreu, mas a entrada bruta está gravada e continua valendo.
  const linhas = await tx.ragnabotFluxoEntrada.findMany({
    where: {
      cwAccountId: exec.cwAccountId, cwConversationId: exec.cwConversationId,
      classe: 'resposta_cliente', resultado: null,
    },
    orderBy: { origemEm: 'asc' }, take: 20,
  });
  return linhas.map((l) => ({ ...l, filaId: job?.id ?? null }));
}

/** Guarda o que não é resposta. Teto de 10: caixa sem teto é vazamento de memória com nome bonito. */
function empilharNaCaixaPendente(estado, entradas) {
  for (const e of entradas) {
    estado.caixaPendente.push({
      cwMessageId: e.cwMessageId ?? null,
      origemEm: e.origemEm ?? null,
      texto: String(e.corpo?.texto ?? '').slice(0, 500),
    });
  }
  if (estado.caixaPendente.length > CAIXA_PENDENTE_MAX) {
    estado.caixaPendente = estado.caixaPendente.slice(-CAIXA_PENDENTE_MAX);
  }
}

/**
 * ACÃO FINAL das exceções (§4.4). É do MOTOR, não do autor do fluxo: deixar como conector opcional
 * garante que metade dos fluxos esquece — e a medição diz que 151 de 518 apresentações vivem
 * exatamente aí, num laço 32 -> 34 -> 16 sem teto que é a explicação estrutural do abandono medido.
 *
 * @returns {{saida?:string, irParaNo?:string, terminar?:string, intencao?:object}}
 */
function aplicarAcaoFinal(no, qual) {
  const cfg = no?.config?.excecoes?.[qual] ?? {};
  const acao = cfg.acaoFinal ?? 'encerrar';
  if (acao === 'seguir_saida') return { saida: cfg.saida ?? 'padrao' };
  if (acao === 'ir_para_no') return { irParaNo: cfg.noId };
  if (acao === 'transferir_time') {
    return {
      terminar: 'transferido',
      intencao: { tipo: 'atribuir', timeId: cfg.timeId ?? null, nomeTime: cfg.time ?? null, sufixo: 'acao_final' },
    };
  }
  return { terminar: 'concluido' };
}

/**
 * DECIDE A SAÍDA DO NÓ EM QUE A CONVERSA ESTÁ PARADA.
 * Devolve `{saida}` para a marcha continuar, ou `{encerrarPasso:true}` quando o evento não produz
 * avanço (despertar obsoleto, mensagem que virou contexto, entrada já consumida).
 */
async function decidirSaida({ tx, exec, versao, job, agora, janela, limites, coletor, estado, politicaContinuacao, leaseToken, mensagemFalhaPadrao = null }) {
  const tipo = job?.tipo ?? TIPOS_JOB.CONTINUAR;

  if (tipo === TIPOS_JOB.INICIAR || tipo === TIPOS_JOB.CONTINUAR) return { saida: null };

  if (tipo === TIPOS_JOB.CONCILIAR || tipo === TIPOS_JOB.EXPIRAR) {
    // Não são do passo: quem cuida são os vigias. Devolver "ignorado" evita que o executor os
    // trate como trabalho envenenado e queime as tentativas.
    return { encerrarPasso: true, resultado: 'nao_e_do_passo', continuar: false };
  }

  const noParado = exec.noCongelado ?? versao.nosPorId.get(exec.noAtualId) ?? null;

  // ── DESPERTAR ────────────────────────────────────────────────────────────────────────────────
  if (tipo === TIPOS_JOB.DESPERTAR) {
    if (job.tokenVisita != null && job.tokenVisita !== exec.visitaSeq) {
      // O cliente respondeu antes do prazo. Sem este descarte, resposta e expiração mandariam a
      // conversa por dois caminhos ao mesmo tempo — e ela chegaria em dois nós diferentes.
      return { encerrarPasso: true, resultado: 'despertar_obsoleto', continuar: false };
    }
    if (exec.aguardando !== 'resposta' && exec.aguardando !== 'temporizador') {
      return { encerrarPasso: true, resultado: 'despertar_sem_espera', continuar: false };
    }

    if (exec.aguardando === 'temporizador') {
      return { saida: exec.saidaAoVencer ?? 'padrao' };
    }

    // Prazo medido em TEMPO DE CANAL DE PÉ.
    const caido = await msDeCanalCaido(tx, exec.cwAccountId, exec.aguardaDesde, agora);
    if (caido > 0) {
      const decorridoUtil = ms(agora, exec.aguardaDesde) - caido;
      const prazoMs = ms(exec.acordarEm ?? agora, exec.aguardaDesde ?? agora);
      if (decorridoUtil < prazoMs) {
        const novoAcordar = somarMs(agora, prazoMs - decorridoUtil);
        await salvarComCerca(tx, exec, leaseToken, agora, { acordarEm: novoAcordar });
        coletor.eventos.push({
          execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
          tipo: 'prazo_adiado_por_canal', detalhe: { descontadoMs: caido, novoAcordarEm: novoAcordar },
        });
        if (portas.fila?.enfileirar) {
          await portas.fila.enfileirar({
            tipo: TIPOS_JOB.DESPERTAR, chaveParticao: chaveParticaoDe(exec), tenantId: exec.tenantId,
            execucaoId: exec.id, tokenVisita: exec.visitaSeq, disponivelEm: novoAcordar,
          }, tx);
        }
        return { encerrarPasso: true, resultado: 'prazo_adiado_por_canal', continuar: false };
      }
    }

    // ⚠️ `sem_resposta` SIGNIFICA "O CLIENTE NÃO RESPONDEU". Se a entrega da própria pergunta não
    // foi confirmada, não se sabe sequer se ele RECEBEU — contar falta aqui é acusar a pessoa de um
    // silêncio que pode ser nosso, e ainda reenviar a pergunta que ela já leu (a segunda cópia
    // chegava quatro minutos depois da primeira, medido). Adiar é a única leitura honesta.
    // Na quase totalidade dos casos a barreira do passo já congelou a conversa antes de chegar aqui;
    // esta guarda cobre a janela curta entre a dúvida e o congelamento.
    const efeitoDaPergunta = await efeitoPendenteDoNo(tx, exec.id, exec.noAtualId, exec.visitaSeq);
    if (efeitoDaPergunta) {
      const novoPrazo = somarMs(agora, 2 * DUVIDA_CONCILIAR_SEGUNDOS * 1000);
      coletor.eventos.push({
        execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
        tipo: 'despertar_adiado_por_efeito_pendente',
        detalhe: { chaveEfeito: efeitoDaPergunta.chave, status: efeitoDaPergunta.status, novoAcordarEm: novoPrazo },
      });
      if (portas.fila?.enfileirar) {
        await portas.fila.enfileirar({
          tipo: TIPOS_JOB.DESPERTAR, chaveParticao: chaveParticaoDe(exec), tenantId: exec.tenantId,
          execucaoId: exec.id, tokenVisita: exec.visitaSeq, disponivelEm: novoPrazo,
        }, tx);
      }
      return { encerrarPasso: true, resultado: 'despertar_adiado_por_efeito_pendente', continuar: false };
    }

    // Contagem de `sem_resposta`, com teto. Reperguntar para sempre é o laço medido.
    const cfg = noParado?.config?.excecoes?.semResposta ?? {};
    const teto = Number.isFinite(cfg.tentativas) ? cfg.tentativas : 2;
    const chave = exec.noAtualId ?? 'sem_no';
    const contagem = { ...(estado.tentativasNo[chave] || {}) };
    contagem.semResposta = (contagem.semResposta ?? 0) + 1;
    estado.tentativasNo[chave] = contagem;

    coletor.eventos.push({
      execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
      tipo: 'sem_resposta', detalhe: { tentativa: contagem.semResposta, teto },
    });

    // Janela fechada ⇒ pula direto para a ação final, sem gastar uma tentativa numa mensagem que a
    // Meta vai recusar. E a nota interna distingue "o robô parou porque a janela fechou" de "o
    // cliente sumiu" — que é a informação que o analista precisa de madrugada.
    const janelaFechada = janela?.aberta === false;
    if (contagem.semResposta <= teto && !janelaFechada) {
      // Dentro do teto: revisita o MESMO nó. O texto de reforço é do NÓ (ele conhece a própria
      // configuração); o motor é dono da CONTAGEM e da AÇÃO FINAL, não da redação.
      return { saida: null, revisitarNoAtual: true };
    }
    const final = aplicarAcaoFinal(noParado, 'semResposta');
    coletor.incidentes.push({
      tenantId: exec.tenantId, versaoId: versao.id, noId: exec.noAtualId,
      codigo: 'SEM_RESPOSTA_ESGOTADA', nivel: 'aviso',
      mensagem: janelaFechada
        ? 'o prazo venceu com a janela de 24 h fechada — o reforco nao foi tentado'
        : `o cliente nao respondeu ${contagem.semResposta} vezes neste no`,
      comoCorrigir: 'revise o texto da pergunta e o destino da acao final',
    });
    return { saida: null, acaoFinal: final };
  }

  // ── CONTINUAÇÃO DE CHAMADA EXTERNA ───────────────────────────────────────────────────────────
  if (tipo === TIPOS_JOB.CONTINUAR_HTTP) {
    if (!noParado) return { encerrarPasso: true, resultado: 'sem_no_parado', continuar: false };
    const resultado = job?.payload?.resultado ?? {};
    const ex = executorDoNo(noParado);
    const ctx = montarContexto({ no: noParado, exec, versao, entrada: null, agora, janela, limites, coletor, mensagemFalhaPadrao });
    let saida; let varsPatch = {};
    if (typeof ex.continuar === 'function') {
      const r = await ex.continuar(ctx, resultado);
      saida = r?.saida; varsPatch = r?.varsPatch ?? {};
    } else {
      // Mapeamento genérico e declarado (regra R3): conservador o bastante para não travar quem
      // ainda não implementou `continuar`, explícito o bastante para não parecer mágica.
      saida = resultado?.ok === true ? 'sucesso' : 'erro';
    }
    Object.assign(estado.vars, varsPatch);
    return { saida };
  }

  // ── ENTRADA DO CLIENTE ───────────────────────────────────────────────────────────────────────
  if (tipo === TIPOS_JOB.ENTRADA) {
    const todas = await carregarEntradas(tx, exec, job);
    if (!todas.length) return { encerrarPasso: true, resultado: 'sem_entrada', continuar: false };

    // SEGUNDA barreira de idempotência: antes de gravar QUALQUER variável, se o cwMessageId já foi
    // consumido por esta execução, descarta. Protege contra trabalho ceifado e reprocessado, dreno
    // duplicado e migração de fila — coisas que a barreira da ENTRADA (reentrega) não cobre.
    const naoConsumidas = [];
    for (const e of todas) {
      if (e.cwMessageId == null) { naoConsumidas.push(e); continue; }
      const ja = await tx.ragnabotFluxoEntradaConsumida.findUnique({
        where: { execucaoId_cwMessageId: { execucaoId: exec.id, cwMessageId: e.cwMessageId } },
      });
      if (ja) {
        coletor.eventos.push({
          execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
          tipo: 'entrada_repetida', cwMessageId: e.cwMessageId,
        });
      } else naoConsumidas.push(e);
    }
    if (!naoConsumidas.length) {
      throw new EntradaJaConsumida('todas as entradas deste trabalho ja foram consumidas', { execucaoId: exec.id });
    }

    const rajada = coletarRajada(exec, naoConsumidas, politicaContinuacao);

    if (rajada.montagem === 'nenhuma' || !rajada.consumir.length) {
      empilharNaCaixaPendente(estado, rajada.paraCaixaPendente);
      await salvarComCerca(tx, exec, leaseToken, agora, { caixaPendente: estado.caixaPendente });
      for (const e of rajada.paraCaixaPendente) {
        await tx.ragnabotFluxoEntrada.updateMany({ where: { id: e.id }, data: { resultado: 'ignorado', processadaEm: agora } });
      }
      return { encerrarPasso: true, resultado: 'guardado_como_contexto', continuar: false };
    }

    if (rajada.paraCaixaPendente.length) empilharNaCaixaPendente(estado, rajada.paraCaixaPendente);
    const entrada = montarEntradaDaRajada(rajada.consumir, rajada.montagem);

    if (!noParado) return { encerrarPasso: true, resultado: 'sem_no_parado', continuar: false };

    // Ordem incerta em lista/botões: NÃO aplica "vale a última". Escolher a opção errada dispara
    // efeito irreversível; reperguntar custa uma repergunta, que agora tem teto e destino.
    if (rajada.ordemIncerta && (noParado.tipo === 'lista' || noParado.tipo === 'botoes')) {
      coletor.eventos.push({
        execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
        tipo: 'ordem_incerta', detalhe: { mensagens: rajada.consumir.length },
      });
      return { saida: 'opcao_invalida', consumidas: rajada.consumir, entrada };
    }
    if (rajada.ordemIncerta) {
      coletor.eventos.push({
        execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
        tipo: 'ordem_incerta', detalhe: { mensagens: rajada.consumir.length, montagem: rajada.montagem },
      });
    }

    const ex = executorDoNo(noParado);
    if (typeof ex.receber !== 'function') {
      throw new ErroDoMotor('NO_SEM_RECEBER', `o no "${noParado.tipo}" estaciona mas nao implementa receber()`);
    }
    const ctx = montarContexto({ no: noParado, exec, versao, entrada, agora, janela, limites, coletor, mensagemFalhaPadrao });
    const r = await ex.receber(ctx, entrada);
    const saida = r?.saida ?? 'opcao_invalida';
    Object.assign(estado.vars, r?.varsPatch ?? {});
    if (r?.varsPatch && Object.keys(r.varsPatch).length) estado.ultimaVariavel = Object.keys(r.varsPatch)[0];

    coletor.eventos.push({
      execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
      tipo: 'resposta_recebida', saida, viaCasamento: r?.viaCasamento ?? null,
      cwMessageId: entrada.cwMessageId, latenciaMs: exec.aguardaDesde ? ms(agora, exec.aguardaDesde) : null,
    });

    if (saida === 'opcao_invalida') {
      const cfg = noParado?.config?.excecoes?.opcaoInvalida ?? {};
      const teto = Number.isFinite(cfg.tentativas) ? cfg.tentativas : 2;
      const chave = exec.noAtualId ?? 'sem_no';
      const contagem = { ...(estado.tentativasNo[chave] || {}) };
      contagem.opcaoInvalida = (contagem.opcaoInvalida ?? 0) + 1;
      estado.tentativasNo[chave] = contagem;
      coletor.eventos.push({
        execucaoId: exec.id, versaoId: versao.id, tenantId: exec.tenantId, noId: exec.noAtualId,
        tipo: 'opcao_invalida',
        // ⚠️ ÚNICA exceção de LGPD do evento: 120 caracteres do que a pessoa digitou. Aqui o texto É
        // o achado — as 151 pessoas medidas estão dizendo o que querem, e hoje ninguém lê.
        detalhe: { texto: String(entrada.texto ?? '').slice(0, 120), tentativa: contagem.opcaoInvalida, teto },
      });
      if (contagem.opcaoInvalida > teto) {
        coletor.incidentes.push({
          tenantId: exec.tenantId, versaoId: versao.id, noId: exec.noAtualId,
          codigo: 'OPCAO_INVALIDA_ESGOTADA', nivel: 'aviso',
          mensagem: `o cliente errou a opcao ${contagem.opcaoInvalida} vezes neste no`,
          comoCorrigir: 'reescreva as opcoes ou acrescente apelidos aos itens',
          amostra: { texto: String(entrada.texto ?? '').slice(0, 120) },
        });
        return { saida: null, acaoFinal: aplicarAcaoFinal(noParado, 'opcaoInvalida'), consumidas: rajada.consumir, entrada };
      }
    }

    return { saida, consumidas: rajada.consumir, entrada };
  }

  return { encerrarPasso: true, resultado: `tipo_de_job_desconhecido:${tipo}`, continuar: false };
}

/**
 * A MARCHA — executa nós até estacionar, terminar, ou encontrar o primeiro nó com efeito.
 *
 * Anda de graça pelos nós de efeito 'nenhum' (início, variável, condição, sub-fluxo, espera): são
 * baratos, locais e não têm o que confirmar. Para no primeiro nó com efeito porque a mensagem
 * seguinte não pode ser reservada antes de sabermos se a anterior saiu.
 */
async function marchar({ tx, exec, versao, noId, agora, janela, limites, coletor, estado, freios, entrada, job, leaseToken, mensagemFalhaPadrao = null }) {
  const resposta = {
    noAtualId: noId, noCongelado: null, aguardando: 'nada', aguardaDesde: null, acordarEm: null,
    saidaAoVencer: null, estadoExecucao: 'rodando', motivoFim: null, versaoId: versao.id,
    efeitos: [], resultado: 'seguiu', continuar: false, noEfeitoId: null,
  };
  let atual = noId;
  let versaoCorrente = versao;
  let primeiroNo = true;
  let passosNesteEvento = 0;

  const encerrar = (estadoExecucao, motivoFim) => {
    resposta.estadoExecucao = estadoExecucao;
    resposta.motivoFim = motivoFim;
    resposta.aguardando = 'nada';
    resposta.acordarEm = null;
    resposta.continuar = false;
    resposta.resultado = motivoFim;
    return resposta;
  };

  while (true) {
    const no = versaoCorrente.nosPorId.get(atual);
    if (!no) {
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual, codigo: 'ARESTA_AUSENTE', nivel: 'erro',
        mensagem: `o no "${atual}" nao existe nesta versao`,
        comoCorrigir: 'republique o fluxo, ou use o no de resgate na migracao',
      });
      return encerrar('erro', `no_ausente:${atual}`);
    }

    estado.passosTotal += 1;
    if (estado.passosTotal > freios.passosTotalMax) {
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual, codigo: 'TETO_DE_PASSOS', nivel: 'erro',
        mensagem: `a conversa passou de ${freios.passosTotalMax} passos — ha laco no fluxo`,
        comoCorrigir: 'procure a saida de excecao que volta ao proprio no sem teto de tentativas',
        amostra: { trilha: estado.trilha.slice(-10) },
      });
      return encerrar('erro', 'teto_de_passos');
    }

    const visitas = (estado.visitasPorNo[atual] ?? 0) + 1;
    estado.visitasPorNo[atual] = visitas;
    if (visitas > freios.visitasPorNoMax) {
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual, codigo: 'LIMITE_EXCEDIDO', nivel: 'erro',
        mensagem: `o no "${atual}" foi visitado ${visitas} vezes na mesma conversa`,
        comoCorrigir: 'de destino a saida de excecao deste no, com tentativas finitas',
      });
      coletor.eventos.push({ execucaoId: exec.id, versaoId: versaoCorrente.id, tenantId: exec.tenantId, noId: atual, tipo: 'limite_visitas' });
      const escape = destinoDaSaida(versaoCorrente, atual, 'opcao_invalida');
      if (!escape) return encerrar('erro', 'limite_de_visitas');
      atual = escape;
      continue;
    }

    estado.visitaSeq += 1;
    const ex = executorDoNo(no);
    const ctx = montarContexto({ no, exec, versao: versaoCorrente, entrada: primeiroNo ? entrada : null, agora, janela, limites, coletor, mensagemFalhaPadrao });
    primeiroNo = false;

    coletor.eventos.push({ execucaoId: exec.id, versaoId: versaoCorrente.id, tenantId: exec.tenantId, noId: atual, tipo: 'no_entrou' });

    const res = await ex.executar(ctx);
    if (!res || typeof res.tipo !== 'string') {
      // União FECHADA: devolver undefined ou um objeto solto é erro de fronteira, não comportamento
      // padrão silencioso. Silêncio aqui vira conversa parada sem ninguém saber por quê.
      throw new ErroDoMotor('RESULTADO_DE_NO_INVALIDO', `o executor de "${no.tipo}" nao devolveu um ResultadoNo`);
    }
    // `varsPatch` no ResultadoNo é acréscimo declarado: o nó `variavel` precisa de um caminho para
    // devolver o que calculou, e a união do §4.1 não previu nenhum.
    if (res.varsPatch) { Object.assign(estado.vars, res.varsPatch); Object.assign(ctx.vars, res.varsPatch); }

    let intencoes = [];
    if (ex.efeito !== 'nenhum' && typeof ex.preparar === 'function') {
      const p = ex.preparar(no, ctx);
      intencoes = (Array.isArray(p) ? p : [p]).filter(Boolean);
    }

    // A RESERVA. Uma linha por intenção: a falha de um destino não reenvia para o outro.
    for (const intencao of intencoes) {
      const efeito = await reservarEfeito({
        execucaoId: exec.id, tenantId: exec.tenantId, noId: atual, visitaSeq: estado.visitaSeq,
        tentativa: (job?.tentativas ?? 0) + 1, sufixo: intencao.sufixo ?? '',
        tipo: intencao.tipo, politicaEmDuvida: ex.politicaEmDuvida ?? 'conciliar',
        custoEstimadoCentavos: intencao.custoEstimadoCentavos ?? null,
      }, tx);
      resposta.efeitos.push({
        efeito, intencao, politicaEmDuvida: ex.politicaEmDuvida ?? 'conciliar',
        condicional: ex.efeito === 'condicional',
        // `atribuir_agente` entra aqui pela MESMA razão que `atribuir`: entregar a conversa a uma
        // pessoa é operação NOSSA na plataforma, não mensagem ao cliente. Falha dela vira
        // `erro_interno` e não transfere ninguém por engano. (Contrato S3, nó `atendente`.)
        interno: ['nota', 'notificar', 'etiqueta', 'atribuir', 'atribuir_agente', 'resolver'].includes(intencao.tipo),
      });
      resposta.noEfeitoId = atual;
    }

    passosNesteEvento += 1;

    if (res.tipo === 'aguardar') {
      resposta.noAtualId = atual;
      resposta.noCongelado = congelarNo(no, intencoes);
      resposta.aguardando = res.motivo === 'temporizador' ? 'temporizador' : (res.motivo === 'http' ? 'http' : 'resposta');
      resposta.aguardaDesde = agora;
      resposta.acordarEm = res.acordarEm ?? null;
      resposta.saidaAoVencer = res.saidaAoVencer ?? (resposta.aguardando === 'resposta' ? 'sem_resposta' : 'padrao');
      resposta.estadoExecucao = 'esperando';
      resposta.resultado = 'aguardando';
      resposta.continuar = false;
      if (res.acordarEm && portas.fila?.enfileirar) {
        // Nada em memória. Nenhum setTimeout. Este fluxo tem 14 nós de espera somando 22 segundos no
        // caminho feliz; um RollingUpdate com temporizador em memória abandonaria em silêncio toda
        // conversa dentro de uma pausa.
        await portas.fila.enfileirar({
          tipo: TIPOS_JOB.DESPERTAR, chaveParticao: chaveParticaoDe(exec), tenantId: exec.tenantId,
          execucaoId: exec.id, tokenVisita: estado.visitaSeq, disponivelEm: res.acordarEm,
        }, tx);
      }
      return resposta;
    }

    if (res.tipo === 'terminar') {
      resposta.noAtualId = atual;
      return encerrar('concluido', res.estado === 'transferido' ? 'transferido' : 'concluido');
    }

    if (res.tipo === 'saltar') {
      const salto = await montarSalto({ tx, exec, versaoCorrente, no, res, estado, coletor });
      if (salto.erro) return encerrar('erro', salto.erro);
      versaoCorrente = salto.versao;
      resposta.versaoId = salto.versao.id;
      atual = salto.noId;
      continue;
    }

    let saida = null;
    if (res.tipo === 'seguir') saida = res.saida ?? 'padrao';
    if (res.tipo === 'falhar') {
      saida = res.saida ?? 'erro';
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual,
        // `ERRO_NO` é acréscimo declarado ao catálogo do §4.10: ele não tem um código genérico para
        // "o nó falhou e o autor do executor não disse por quê". Cair num código do catálogo que
        // não descreve o defeito seria pior — o operador leria a causa errada.
        codigo: res.incidente?.codigo ?? 'ERRO_NO', nivel: 'erro',
        mensagem: res.incidente?.mensagemOperador ?? 'o no falhou',
        comoCorrigir: res.incidente?.comoCorrigir ?? null,
      });
      coletor.eventos.push({ execucaoId: exec.id, versaoId: versaoCorrente.id, tenantId: exec.tenantId, noId: atual, tipo: 'erro_no', saida });

      // ── O AVISO AO CLIENTE, QUE ANTES ERA JOGADO FORA ────────────────────────────────────────
      //
      // `falhar()` monta `incidente.mensagemCliente` a partir de `config.mensagemFalha` do nó, e o
      // motor lia SÓ `mensagemOperador`: a frase que o operador escreveu no editor não tinha nenhum
      // leitor no backend inteiro. Quando a saída `erro` levava a um nó de texto, o cliente lia o
      // texto DAQUELE nó (nunca a frase configurada); quando não levava a lugar nenhum, o cliente
      // não recebia NADA. O contrato manda o contrário: «nunca detalhe técnico, NUNCA SILÊNCIO».
      //
      // Sai como efeito à parte, com política 'seguir': ele nunca derruba a marcha, nunca congela a
      // conversa (a barreira do passo ignora 'seguir') e é idempotente pela chave sha256 — reprocessar
      // o mesmo passo não manda a frase duas vezes.
      const avisoAoCliente = res.incidente?.mensagemCliente;
      const janelaFechadaAgora = janela?.aberta === false || saida === 'sem_janela';
      // `erro_interno` é encanamento NOSSO (o aviso ao plantonista que não saiu). O cliente não tem
      // o que fazer com essa informação e não pode ser incomodado por ela.
      const assuntoDoCliente = saida !== 'erro_interno';
      if (avisoAoCliente && assuntoDoCliente && !janelaFechadaAgora) {
        const efeitoAviso = await reservarEfeito({
          execucaoId: exec.id, tenantId: exec.tenantId, noId: atual, visitaSeq: estado.visitaSeq,
          tentativa: (job?.tentativas ?? 0) + 1, sufixo: 'aviso_falha',
          tipo: 'msg_texto', politicaEmDuvida: 'seguir',
        }, tx);
        resposta.efeitos.push({
          efeito: efeitoAviso,
          intencao: { tipo: 'texto', sufixo: 'aviso_falha', corpo: String(avisoAoCliente) },
          politicaEmDuvida: 'seguir', condicional: false, interno: false,
        });
        resposta.noEfeitoId = atual;
      } else if (avisoAoCliente && janelaFechadaAgora) {
        // Fora da janela de 24 h só sai template aprovado e pago — tentar seria receber recusa da
        // Meta. O certo é o fluxo mandar `sem_janela` para um nó que transfira a um humano; o motor
        // NÃO força essa transferência sozinho, porque isso é decisão do grafo, não dele. O que ele
        // faz é deixar registrado que uma pessoa ficou sem o aviso — silêncio anotado não é silêncio.
        coletor.eventos.push({
          execucaoId: exec.id, versaoId: versaoCorrente.id, tenantId: exec.tenantId, noId: atual,
          tipo: 'aviso_de_falha_nao_enviado', detalhe: { saida, motivoJanela: janela?.motivo ?? null },
        });
        coletor.incidentes.push({
          tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual,
          codigo: 'JANELA_FECHADA', nivel: 'aviso',
          mensagem: 'o no falhou com a janela de 24 h fechada — o cliente NAO foi avisado',
          comoCorrigir: 'ligue a saida sem_janela deste no a um no que transfira a conversa a um atendente',
        });
      }
    }

    const destino = destinoDaSaida(versaoCorrente, atual, saida);
    if (!destino) {
      // `erro_interno` SEGUE o fluxo. Falha de encanamento interno — o aviso ao plantonista que não
      // saiu — jamais pode derrubar o atendimento de quem está do outro lado.
      if (saida === 'erro_interno') {
        const seguir = destinoDaSaida(versaoCorrente, atual, 'padrao');
        if (seguir) { estado.trilha.push([atual, 'erro_interno', ms(agora, exec.iniciadaEm)]); atual = seguir; continue; }
      }
      coletor.incidentes.push({
        tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: atual, codigo: 'ARESTA_AUSENTE', nivel: 'erro',
        mensagem: `a saida "${saida}" do no "${atual}" nao esta ligada a nenhum no`,
        comoCorrigir: 'ligue essa saida a um no no editor e publique de novo',
      });
      resposta.noAtualId = atual;
      return encerrar('erro', `aresta_ausente:${atual}:${saida}`);
    }

    estado.trilha.push([atual, saida, ms(agora, exec.iniciadaEm)]);
    coletor.eventos.push({ execucaoId: exec.id, versaoId: versaoCorrente.id, tenantId: exec.tenantId, noId: atual, tipo: 'no_saiu', saida });

    if (resposta.efeitos.length) {
      // Há efeito para despachar: o ponteiro já vai para o destino (invariante do topo do arquivo) e
      // a T2 corrige para a saída de erro se o despacho falhar.
      resposta.noAtualId = destino;
      resposta.resultado = 'efeito_reservado';
      resposta.continuar = true;
      return resposta;
    }

    if (passosNesteEvento >= freios.passosPorEvento) {
      // Cede a vez, não perde a conversa.
      resposta.noAtualId = destino;
      resposta.resultado = 'teto_por_evento';
      resposta.continuar = false;
      if (portas.fila?.enfileirar) {
        await portas.fila.enfileirar({
          tipo: TIPOS_JOB.CONTINUAR, chaveParticao: chaveParticaoDe(exec), tenantId: exec.tenantId,
          execucaoId: exec.id, disponivelEm: somarMs(agora, 1000), prioridade: 50,
        }, tx);
      }
      return resposta;
    }

    atual = destino;
  }
}

/** Sub-fluxo é QUADRO DE PILHA, não execução aninhada: "por onde essa pessoa passou" precisa
 *  devolver uma linha contínua, e o fluxo real atravessa três fluxos numa conversa só.
 *  ⚠️ A travessia é sempre resolvida com a EMPRESA junto — o tenantId usado é o da EXECUÇÃO, nunca o
 *  do fluxo chamado. É a diferença entre chamar o sub-fluxo certo e vazar o fluxo de outra empresa. */
async function montarSalto({ tx, exec, versaoCorrente, no, res, estado, coletor }) {
  const alvo = await tx.ragnabotFluxo.findUnique({ where: { id: res.fluxoId } });
  if (!alvo || alvo.tenantId !== exec.tenantId || !alvo.versaoPublicadaId) {
    coletor.incidentes.push({
      tenantId: exec.tenantId, versaoId: versaoCorrente.id, noId: no.id, codigo: 'ARESTA_AUSENTE', nivel: 'erro',
      mensagem: `sub-fluxo "${res.fluxoId}" nao existe nesta empresa ou nao tem versao publicada`,
      comoCorrigir: 'publique o sub-fluxo, ou aponte o no para um fluxo da mesma empresa',
    });
    return { erro: 'subfluxo_indisponivel' };
  }
  const versaoAlvo = await carregarVersao(tx, alvo.versaoPublicadaId);
  if (res.modo === 'chamar') {
    const retorno = destinoDaSaida(versaoCorrente, no.id, 'padrao');
    estado.pilha.push({ versaoId: versaoCorrente.id, noRetornoId: retorno ?? null });
  } else if (estado.pilha.length) {
    estado.pilha[estado.pilha.length - 1] = { versaoId: versaoCorrente.id, noRetornoId: null };
  }
  return { versao: versaoAlvo, noId: versaoAlvo.noInicialId };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DESPACHO E T2
//
// Aqui a rede é permitida — e SÓ aqui. Nenhuma transação está aberta.
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function despacharEConfirmar(plano, leaseToken) {
  const exec = plano.exec;
  const porta = await exigirPorta('canal').portaDa(exec);
  let falha = null;

  for (const item of plano.efeitos) {
    const { efeito, intencao, condicional, interno } = item;
    try {
      if (condicional) {
        // ⚠️ `resolver` e `atribuir` NÃO são idempotentes: são escritas de "último a escrever vence"
        // sobre um estado compartilhado e editável por humano. O carimbo é lido AGORA, imediatamente
        // antes do envio — e não na reserva, como diz o §2.5 — porque ler a conversa é chamada de
        // rede e a T1 não pode ter rede dentro. Ler agora também é mais correto: um carimbo feito na
        // reserva estaria velho se o despacho tivesse atrasado.
        const estadoAtual = await porta.lerConversa(exec.cwConversationId);
        await db().ragnabotFluxoEfeito.updateMany({
          where: { chave: efeito.chave }, data: { estadoAnterior: estadoAtual ?? null },
        });
      }
      const r = await porta.enviar({ ...intencao, chaveEfeito: efeito.chave }, {
        execucao: exec, noId: efeito.noId, visitaSeq: efeito.visitaSeq,
      });
      await confirmarEfeito(efeito.chave, {
        idExterno: r?.idExterno ?? r?.wamid ?? null, httpStatus: r?.httpStatus ?? null, resposta: r?.resumo ?? null,
      });
      if (r?.aguardarResultado === true && portas.fila?.enfileirar) {
        // Nó que depende do RESULTADO da chamada externa (o `http`): a continuação vem por job, não
        // por retorno de função, para sobreviver a um reinício no meio da chamada.
        await portas.fila.enfileirar({
          tipo: TIPOS_JOB.CONTINUAR_HTTP, chaveParticao: chaveParticaoDe(exec), tenantId: exec.tenantId,
          execucaoId: exec.id, payload: { resultado: r.resultado ?? null, chaveEfeito: efeito.chave },
        });
      }
    } catch (e) {
      const classe = classificarErroDeDespacho(e);
      if (classe === 'duvida') {
        // A marcha só para de verdade quando o BANCO a segura: o job de despertar deste nó já foi
        // commitado na T1, e devolver `continuar:false` não o apaga. Quem congela é
        // `tratarEfeitoDuvidoso`, com a cerca do arrendamento.
        const desfecho = await tratarEfeitoDuvidoso({
          exec, efeito, motivo: e.message, politica: item.politicaEmDuvida ?? 'conciliar', leaseToken, porta,
        });
        if (desfecho.continuarMarcha) continue; // política 'seguir': aviso interno não segura cliente
        return { resultado: desfecho.resultado, continuar: false };
      }
      await falharEfeito(efeito.chave, { erro: e.message, httpStatus: e.status ?? e.httpStatus ?? null });
      falha = { efeito, erro: e, classe, interno };
      break;
    }
  }

  if (!falha) return { resultado: plano.resultado, continuar: plano.continuar === true };
  return rerotearPorFalha(plano, falha, leaseToken);
}

/**
 * A T2 corrige o ponteiro quando o despacho falha (§3.2/D: "se falhou e o nó tem saída de erro,
 * enfileira continuação por ela").
 *
 * `erro_interno` SEGUE o fluxo: o aviso ao plantonista que não saiu não pode derrubar o atendimento
 * de quem está do outro lado. Sem essa separação, o cliente é transferido a um humano porque o
 * Fernando não recebeu uma mensagem.
 */
async function rerotearPorFalha(plano, falha, leaseToken) {
  const exec = plano.exec;
  const versao = await carregarVersao(null, plano.versaoId ?? exec.versaoId);
  const noId = falha.efeito.noId;
  // ⚠️ A CERCA É `leaseToken` **E** `leaseExpiraEm > agora`. Só o token não basta: um trabalhador que
  // ficou numa pausa longa perde o arrendamento sem que o token dele mude na linha — se ninguém o
  // substituiu ainda, um WHERE só por token continua movendo o ponteiro de uma conversa que ele já
  // não tem direito de tocar. E a hora vem do BANCO, nunca do relógio deste processo.
  const agora = await agoraDoBanco(db());

  const preferida = falha.classe === 'fora_da_janela' ? 'sem_janela' : (falha.interno ? 'erro_interno' : 'erro');
  const destino = destinoDaSaida(versao, noId, preferida)
    ?? (falha.interno ? destinoDaSaida(versao, noId, 'padrao') : null)
    ?? destinoDaSaida(versao, noId, 'erro');

  await abrirIncidente(null, {
    tenantId: exec.tenantId, versaoId: versao.id, noId,
    codigo: falha.classe === 'fora_da_janela' ? 'JANELA_FECHADA' : 'CANAL_RECUSOU',
    nivel: falha.interno ? 'aviso' : 'erro',
    mensagem: `o despacho do efeito "${falha.efeito.tipo}" falhou: ${falha.erro.message}`.slice(0, 400),
    comoCorrigir: falha.classe === 'fora_da_janela'
      ? 'de destino a saida sem_janela deste no, com um template aprovado'
      : 'confira a caixa no Chatwoot e a saude do canal',
  });

  if (!destino) {
    const encerrado = await db().ragnabotFluxoExecucao.updateMany({
      where: { id: exec.id, leaseToken, leaseExpiraEm: { gt: agora } },
      data: { estado: 'erro', motivoFim: `despacho_falhou:${preferida}`, ultimoErro: String(falha.erro.message).slice(0, 500), encerradaEm: agora, aguardando: 'nada' },
    });
    // Encerrar a conversa de outro trabalhador é pior que não encerrar a nossa: quem perdeu a posse
    // devolve o trabalho à fila sem contar tentativa, e quem tem a posse decide o desfecho.
    if (encerrado.count !== 1) throw new PossePerdida('a cerca recusou o encerramento da T2', { execucaoId: exec.id });
    return { resultado: 'despacho_falhou_sem_saida', continuar: false };
  }

  const r = await db().ragnabotFluxoExecucao.updateMany({
    where: { id: exec.id, leaseToken, leaseExpiraEm: { gt: agora } },
    data: {
      noAtualId: destino, aguardando: 'nada', acordarEm: null, saidaAoVencer: null, noCongelado: null,
      ultimoErro: String(falha.erro.message).slice(0, 500),
    },
  });
  if (r.count !== 1) throw new PossePerdida('a cerca recusou o reroteamento da T2', { execucaoId: exec.id });
  return { resultado: `rerroteado_por_${preferida}`, continuar: true };
}

/**
 * A PALAVRA HONESTA AO CLIENTE quando a política do nó é `parar`.
 *
 * ⚠️ SÓ É CHAMADA DEPOIS DE `bloquearPorEfeitoPendente` TER AFETADO EXATAMENTE UMA LINHA. A ordem
 * importa e antes estava invertida: o congelamento vinha DEPOIS do envio e com um WHERE só por `id`,
 * então um trabalhador atrasado — que já tinha perdido o arrendamento para outro — mandava "um
 * atendente vai assumir daqui" no meio de uma conversa que estava fluindo normalmente com o novo
 * dono, e ainda congelava a execução dele. O cliente ficava esperando para sempre, depois de ler um
 * aviso que não correspondia a nada. Gravar primeiro, com a cerca, faz o atrasado descobrir que
 * perdeu a posse ANTES de abrir a boca.
 *
 * A mensagem sai enquanto a janela está comprovadamente aberta (o cliente acabou de escrever). Nunca
 * é deixada para "quando um humano decidir" — aí a janela já é outra, e a pessoa fica sem resposta E
 * sem explicação.
 */
async function avisarClienteDaDuvida(exec, efeito, porta) {
  const chaveAviso = chaveEfeito({ execucaoId: exec.id, noId: efeito.noId, visitaSeq: efeito.visitaSeq, tentativa: efeito.tentativa, sufixo: 'aviso_duvida' });
  try {
    await db().ragnabotFluxoEfeito.create({
      data: {
        execucaoId: exec.id, tenantId: exec.tenantId, noId: efeito.noId, visitaSeq: efeito.visitaSeq,
        tentativa: efeito.tentativa, sufixo: 'aviso_duvida', chave: chaveAviso, tipo: 'msg_texto',
        politicaEmDuvida: 'seguir', status: 'reservado',
      },
    });
    await porta.enviar({
      tipo: 'texto', sufixo: 'aviso_duvida', chaveEfeito: chaveAviso,
      corpo: exec.protocolo
        ? `Tive um problema para concluir esta etapa e não consigo confirmar se ela foi registrada. Um atendente vai assumir daqui. Protocolo ${exec.protocolo}.`
        : 'Tive um problema para concluir esta etapa e não consigo confirmar se ela foi registrada. Um atendente vai assumir daqui.',
    }, { execucao: exec, noId: efeito.noId });
    await confirmarEfeito(chaveAviso, {});
  } catch (e) {
    // Este efeito não pode ficar 'reservado' para sempre: seria uma barreira permanente para a
    // conversa quando ela for destravada. Ele é um aviso, não um registro — dar por falho é honesto.
    await falharEfeito(chaveAviso, { erro: e.message }).catch(() => {});
    logger.warn(`[fluxo-motor] aviso honesto de duvida nao saiu (${exec.id}): ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O LAÇO DE TRABALHO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Processa UM trabalho da fila, do início ao fim da marcha que ele destrava.
 * @returns {Promise<{resultado:string, passos:number}>}
 */
export async function processarTrabalho(job, workerId, { leaseToken = null, execucaoId = null } = {}) {
  const alvo = execucaoId ?? job.execucaoId;
  if (!alvo) throw new ErroDoMotor('JOB_SEM_EXECUCAO', 'trabalho sem execucaoId — quem cria execucao e iniciarOuRecuperarExecucao()');

  let token = leaseToken;
  let posseNossa = false;
  if (!token) {
    token = await tomarPosse(alvo, workerId);
    if (!token) return { resultado: 'posse_de_outro', passos: 0 };
    posseNossa = true;
  }

  let perdeuNoBatimento = false;
  // O batimento é de quem TOMOU a posse. Quando o arrendamento veio do chamador (rodadaDoExecutor),
  // ele já está batendo — dois batimentos na mesma posse só gastam consulta.
  const pararBatimento = posseNossa
    ? iniciarBatimento(alvo, token, () => { perdeuNoBatimento = true; })
    : () => {};
  // Marca o passo em voo para o encerramento gracioso saber o que esperar antes de sair. Sem isto,
  // um SIGTERM cortaria a conversa exatamente no meio de um passo.
  const desmarcar = registrarEmVoo(`${alvo}:${workerId}`);
  let passos = 0;
  let ultimo = 'nada';
  try {
    let corrente = job;
    for (;;) {
      const r = await passo(alvo, token, corrente);
      passos += 1;
      ultimo = r.resultado;
      if (!r.continuar) break;
      if (perdeuNoBatimento) throw new PossePerdida('a posse foi perdida durante a marcha', { execucaoId: alvo });
      // Os passos seguintes desta mesma marcha são continuação, não repetição do evento: repetir o
      // job de entrada consumiria a mesma mensagem de novo (a segunda barreira barraria, mas com
      // ruído). `tentativas` é preservado para a chave do efeito continuar mudando entre tentativas.
      corrente = { tipo: TIPOS_JOB.CONTINUAR, tentativas: corrente.tentativas ?? 0 };
      if (passos >= 200) { ultimo = 'teto_de_seguranca_do_laco'; break; }
    }
    return { resultado: ultimo, passos };
  } finally {
    desmarcar();
    pararBatimento();
    if (posseNossa) await liberarPosse(alvo, token).catch(() => {});
  }
}

/**
 * UMA rodada do executor: escolher, tomar posse, drenar, processar (§3.2/B).
 *
 * ⚠️ POSSE ANTES DE REIVINDICAÇÃO. Se a posse não vier, o candidato é IGNORADO nesta rodada — não é
 * marcado em processamento, não incrementa tentativas, não é adiado. Sem isso, um trabalho sadio
 * queima as 8 tentativas só porque outro processo estava com a conversa naquele instante.
 */
export async function rodadaDoExecutor({ workerId, limite = 20 } = {}) {
  const fila = exigirPorta('fila');
  const candidatos = await fila.candidatos({ limite });
  const vistas = new Set();
  const resumo = { particoes: 0, jobs: 0, ignorados: 0, erros: 0 };

  for (const candidato of candidatos) {
    const chave = candidato.chaveParticao;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    if (!candidato.execucaoId) { resumo.ignorados += 1; continue; }

    const token = await tomarPosse(candidato.execucaoId, workerId);
    if (!token) { resumo.ignorados += 1; continue; }
    resumo.particoes += 1;

    let pararBatimento = () => {};
    try {
      const jobs = await fila.drenarParticao(chave, workerId);
      pararBatimento = iniciarBatimento(candidato.execucaoId, token, () => {});
      for (const job of jobs) {
        resumo.jobs += 1;
        try {
          const r = await processarTrabalho(job, workerId, { leaseToken: token, execucaoId: job.execucaoId ?? candidato.execucaoId });
          await fila.concluirJob(job.id, { status: 'feito', erro: null, resultado: r.resultado });
        } catch (e) {
          resumo.erros += 1;
          if (ehErroDoMotor(e, 'POSSE_PERDIDA')) {
            // Devolve para a fila SEM contar tentativa: não houve defeito no trabalho.
            await fila.adiarJob(job.id, { motivo: 'posse_perdida', tentativaAtual: job.tentativas ?? 0, contarTentativa: false });
            break;
          }
          if (ehErroDoMotor(e, 'ENTRADA_JA_CONSUMIDA')) {
            await fila.concluirJob(job.id, { status: 'descartado', erro: 'entrada ja consumida' });
            continue;
          }
          logger.error(`[fluxo-motor] falha ao processar job ${job.id}: ${e.message}`);
          await fila.adiarJob(job.id, { motivo: e.message, tentativaAtual: job.tentativas ?? 0 });
        }
      }
    } finally {
      pararBatimento();
      await liberarPosse(candidato.execucaoId, token).catch(() => {});
    }
  }
  return resumo;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETOMADA DEPOIS DE REINÍCIO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Reenfileira execução viva cujo dono sumiu (§3.2/G, varredor de órfãos).
 *
 * ⚠️ COBRE OS DOIS ESTADOS ativos que marcham (`rodando` e `esperando`) e aceita trabalho
 * RECÉM-travado como prova de que alguém está cuidando. Trabalho VELHO em 'processando' não é prova
 * de nada — é exatamente o sintoma de um processo que morreu segurando a conversa.
 *
 * ⚠️ E SÃO DUAS VARREDURAS, NÃO UMA. A que manda MARCHAR (`continuar`) exclui, no WHERE, toda
 * execução que tenha efeito sem desfecho. Sem essa exclusão o varredor era o gatilho do D3: o
 * trabalhador morria entre o COMMIT da T1 e o despacho, o varredor via "ninguém cuidando" e mandava
 * a conversa andar por cima do efeito reservado — o ERP nunca recebia o chamado e o cliente lia que
 * o chamado existe. Essas execuções vão para a SEGUNDA varredura, que agenda `conciliar` com a
 * chave do efeito, e não `continuar`.
 *
 * Efeito com política 'seguir' (aviso interno) não conta como pendência: ele nunca segura conversa
 * de cliente. É a mesma regra de `efeitoPendenteBloqueante`, escrita aqui em SQL porque esta
 * varredura roda em uma consulta só.
 */
export async function retomarOrfas({ workerId = 'varredor', limite = 50 } = {}) {
  const cliente = db();
  const linhas = await cliente.$queryRaw`
    SELECT e.id, e."tenantId", e."cwAccountId", e."cwConversationId"
      FROM "RagnabotFluxoExecucao" e
     WHERE e.estado IN ('rodando','esperando')
       AND (e."leaseExpiraEm" IS NULL OR e."leaseExpiraEm" < now() - interval '60 seconds')
       AND NOT EXISTS (
            SELECT 1 FROM "RagnabotFluxoFila" f
             WHERE f."execucaoId" = e.id
               AND (f.status = 'pendente'
                    OR (f.status = 'processando' AND f."travadoEm" > now() - interval '90 seconds')))
       AND NOT EXISTS (
            SELECT 1 FROM "RagnabotFluxoEfeito" ef
             WHERE ef."execucaoId" = e.id
               AND ef.status IN ('reservado','duvidoso')
               AND ef."politicaEmDuvida" <> 'seguir')
     ORDER BY e."atualizadaEm" ASC
     LIMIT ${limite}`;

  // As excluídas acima: existe efeito sem desfecho, então a conversa NÃO pode andar. Elas ganham um
  // `conciliar` carregando a chave — que é a marca `rgt_efeito` a procurar no destino.
  const comEfeitoPendente = await cliente.$queryRaw`
    SELECT e.id, e."tenantId", e."cwAccountId", e."cwConversationId",
           (SELECT ef.chave FROM "RagnabotFluxoEfeito" ef
             WHERE ef."execucaoId" = e.id
               AND ef.status IN ('reservado','duvidoso')
               AND ef."politicaEmDuvida" <> 'seguir'
             ORDER BY ef."reservadoEm" ASC LIMIT 1) AS "chaveEfeito"
      FROM "RagnabotFluxoExecucao" e
     WHERE e.estado IN ('rodando','esperando')
       AND (e."leaseExpiraEm" IS NULL OR e."leaseExpiraEm" < now() - interval '60 seconds')
       AND NOT EXISTS (
            SELECT 1 FROM "RagnabotFluxoFila" f
             WHERE f."execucaoId" = e.id
               AND (f.status = 'pendente'
                    OR (f.status = 'processando' AND f."travadoEm" > now() - interval '90 seconds')))
       AND EXISTS (
            SELECT 1 FROM "RagnabotFluxoEfeito" ef
             WHERE ef."execucaoId" = e.id
               AND ef.status IN ('reservado','duvidoso')
               AND ef."politicaEmDuvida" <> 'seguir'
               AND ef."reservadoEm" < now() - interval '45 seconds')
     ORDER BY e."atualizadaEm" ASC
     LIMIT ${limite}`;

  const fila = portas.fila;
  let reenfileiradas = 0;
  let conciliacoes = 0;
  for (const l of linhas || []) {
    if (!fila?.enfileirar) break;
    await fila.enfileirar({
      tipo: TIPOS_JOB.CONTINUAR,
      chaveParticao: chaveParticaoDe({ cwAccountId: l.cwAccountId, cwConversationId: l.cwConversationId }),
      tenantId: l.tenantId, execucaoId: l.id, prioridade: 60,
      payload: { origem: 'varredor_orfaos', workerId },
    });
    reenfileiradas += 1;
  }
  for (const l of comEfeitoPendente || []) {
    if (!fila?.enfileirar) break;
    await fila.enfileirar({
      tipo: TIPOS_JOB.CONCILIAR,
      chaveParticao: chaveParticaoDe({ cwAccountId: l.cwAccountId, cwConversationId: l.cwConversationId }),
      tenantId: l.tenantId, execucaoId: l.id, prioridade: 60,
      payload: { origem: 'varredor_orfaos', workerId, chaveEfeito: l.chaveEfeito ?? null, motivo: 'efeito sem desfecho apos queda do dono' },
    });
    conciliacoes += 1;
  }
  return {
    candidatas: (linhas || []).length + (comEfeitoPendente || []).length,
    reenfileiradas,
    conciliacoes,
  };
}

/** SIGTERM: devolve a `pendente` o trabalho deste processo e SOLTA as posses.
 *  Sem isto, cada implantação deixa N conversas travadas por até 30 s, e num RollingUpdate isso
 *  acontece toda vez. Para o cliente é o robô ficando mudo no meio da conversa. */
export async function devolverTrabalhoDoWorker(workerId) {
  let jobs = 0;
  if (portas.fila?.devolverJobsDoWorker) {
    const r = await portas.fila.devolverJobsDoWorker(workerId);
    jobs = typeof r === 'number' ? r : (r?.count ?? 0);
  }
  const posses = await db().ragnabotFluxoExecucao.updateMany({
    where: { donoWorker: workerId },
    data: { donoWorker: null, leaseToken: null, leaseExpiraEm: null },
  });
  return { jobs, posses: posses.count };
}

const emVoo = new Set();

/** Encerramento gracioso. A "sessão" a proteger aqui é a CONVERSA de um cliente, e ela NÃO aparece
 *  em /api/health/active-sessions — por isso a proteção tem de estar no PROCESSO, não no
 *  procedimento de implantação. */
export async function encerrarGraciosamente(workerId, { tetoMs = 25_000 } = {}) {
  const limite = Date.now() + tetoMs;
  while (emVoo.size > 0 && Date.now() < limite) {
    await new Promise((r) => { setTimeout(r, 200); });
  }
  const devolvido = await devolverTrabalhoDoWorker(workerId);
  return { emVooRestantes: emVoo.size, ...devolvido };
}

/** Marca/desmarca passo em voo, para o encerramento gracioso saber o que esperar. */
export function registrarEmVoo(id) { emVoo.add(id); return () => emVoo.delete(id); }

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMO AMARRAR ESTE MOTOR NO PROCESSO EXECUTOR
//
//   import * as motor from './services/ragnabot-fluxo-motor.service.js';
//   import * as fila   from './services/ragnabot-fluxo-fila.service.js';
//   import { portaCanalDa } from './motor/porta-canal.js';
//   import catalogo from './motor/nos/index.js';
//   import * as cofre from './services/ragnabot-fluxo-cofre.service.js';
//
//   motor.configurarMotor({
//     fila,
//     canal: { portaDa: async (exec) => portaCanalDa(await inboxDa(exec)) },
//     nos:   { obter: (tipo) => catalogo[tipo] ?? null },
//     cofre, limites, egresso, telemetria,
//   });
//
//   setInterval(() => motor.rodadaDoExecutor({ workerId }), 250);
//   process.on('SIGTERM', () => motor.encerrarGraciosamente(workerId));
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE FOI ACRESCENTADO À ESPECIFICAÇÃO, E POR QUÊ — nada aqui é silencioso
//
// 1. `TIPOS_JOB.CONTINUAR` — o enum do §2.4 não tem um tipo para "retomar a marcha" (teto de passos,
//    varredor de órfãos, reroteamento da T2). `iniciar` significa CRIAR. Coluna String livre.
// 2. `aguardar` com `motivo:'http'` — a união do §4.1 só previa `resposta` e `temporizador`, mas a
//    coluna `aguardando` já enumera 'http': o modelo de dados contava com ele.
// 3. `ResultadoNo.varsPatch` — o nó `variavel` precisa devolver o que calculou e a união não previa
//    nenhum caminho. Sem isso, cada executor inventaria o seu.
// 4. `continuar(ctx, resultado)` no executor — opcional, com mapeamento genérico ok→'sucesso'.
// 5. `coletarRajada().montagem` — sem ele, quem chama reimplementaria a tabela do §3.2/C, e duas
//    cópias da mesma tabela divergem.
// 6. `estadoAnterior` do efeito `condicional` é carimbado NO DESPACHO, não na reserva (§2.5 dizia
//    reserva). Ler a conversa é chamada de rede, e a T1 não pode ter rede dentro. Ler no despacho é
//    também mais correto: um carimbo feito na reserva estaria velho se o despacho atrasasse.
// 7. Dúvida (tempo limite) agenda um job `conciliar` para a própria execução. Sem esse job, o
//    varredor de órfãos veria "sem trabalho pendente" e reenfileiraria a marcha por cima de uma
//    mensagem que talvez não tenha saído.
// 8. CONGELAMENTO POR EFEITO PENDENTE (`estado='pausado_duvida'` + `prazoEm`). A especificação
//    descreve a caixa de saída de duas fases mas não diz o que segura a conversa entre a reserva e a
//    confirmação. Este motor responde com um estado que JÁ EXISTIA no modelo, em vez de inventar
//    coluna nova: `pausado_duvida` está em ESTADOS_PAUSADOS, o passo recusa marchar nele (inclusive
//    despertar) e o escalador de pausa tem relógio para chamar gente. Destravar é repor `estado`,
//    repor `aguardando` e reenfileirar um despertar com `tokenVisita = visitaSeq` — por isso
//    `acordarEm`, `aguardaDesde`, `saidaAoVencer` e `noCongelado` NÃO são apagados no congelamento.
// 9. Aviso de falha ao cliente (`incidente.mensagemCliente`) vira efeito próprio, sufixo
//    'aviso_falha', política 'seguir'. Sem ele, `config.mensagemFalha` do nó não tinha nenhum leitor
//    no backend e o §5.6 ("nunca silêncio") era letra morta na metade dos caminhos de erro.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE ARQUIVO **NÃO** MEDIU — declarado para ninguém confundir com regra
//
// • Se o Chatwoot 4.17.1 entrega mensagem interativa de WhatsApp. É o maior risco não medido do
//   projeto e mora inteiro na PortaCanal, não aqui.
// • Em que unidade a Meta conta caracteres. Enquanto o perfil de limites vier com
//   `origem='documentacao'`, quem valida aplica o pior caso e escreve isso na tela.
// • O comportamento sob pgbouncer em modo transação. O desenho evita trava consultiva de SESSÃO
//   justamente por isso (só usa `pg_try_advisory_xact_lock`, que morre no commit), mas a afirmação
//   "funciona atrás do pgbouncer" não foi medida — foi projetada.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// DÍVIDAS DECLARADAS, que este arquivo não pode pagar sozinho
//
// • O CONCILIADOR NÃO EXISTE. Nenhum serviço deste repositório lê `RagnabotFluxoEfeito` (conferido
//   por varredura). Até ele existir, todo efeito sem desfecho termina em conversa congelada com
//   prazo de 15 min para o escalador — que é a falha honesta, não a solução. Quem escrever o
//   conciliador destrava repondo `estado`/`aguardando` e reenfileirando o despertar (ver acréscimo 8).
// • `RagnabotFluxo.mensagemFalhaPadrao` NÃO EXISTE no schema. O motor já propaga o campo para
//   `ctx.execucao.mensagemFalhaPadrao`; enquanto a coluna não for criada pelo dono do schema, o
//   degrau do meio da cascata de `mensagemDeFalha()` continua valendo `null` e a frase cai na
//   constante do executor de nó.
// • Política de efeito 'reenviar' é tratada como 'conciliar' (congela). Reenviar exigiria remontar a
//   intenção a partir do nó, e nada disso está gravado na linha do efeito — reenviar "quase igual"
//   a um destino que não honre o `rgt_efeito` é o D3 pelo avesso.
// ════════════════════════════════════════════════════════════════════════════════════════════════
