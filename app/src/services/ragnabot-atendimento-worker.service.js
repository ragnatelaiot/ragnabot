// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRABALHADOR PERIÓDICO DAS AUTOMAÇÕES DE ATENDIMENTO DO RAGNABOT
//
// Base: /ia/.claude/modulo-atendimento/29-AUTOMACOES-DO-ATENDIMENTO.md (§4.5, §5.3, §5.4, §5.6).
// Responde ao pedido nº 1 e nº 2 do dono: «tempo para um atendimento ir para fila de aguardando se
// não tiver mais interação ou do atendente ou do contato (isso é escolhido nas configurações)» e
// «horário fora de expediente, o horário de intervalo».
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É
//
// É o RELÓGIO: varre, decide quem venceu, e aplica a ação (devolver para a fila, transferir de
// setor, resolver, notificar). Trata também a virada do expediente — fechar e abrir.
//
// NÃO é o resolvedor de entrada (§5.2, quem escolhe o fluxo do primeiro «oi»), não é a tela de
// automações, não é a porta do Chatwoot e não é a fila. Tudo isso entra por PORTA INJETÁVEL, pelo
// mesmo motivo que o motor de fluxo faz assim: cada arquivo tem um autor, e o teste roda a máquina
// inteira sem Chatwoot e sem banco.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS TRÊS ARMADILHAS QUE ESTE CÓDIGO EXISTE PARA EVITAR
//
// A1. «Ainda está aí?» às 3 da manhã. Um relógio ingênuo (venceEm = último evento + N minutos)
//     amanhece com TODA conversa da noite devolvida para a fila, e o cliente recebendo pergunta de
//     madrugada. Aqui o prazo é somado em MINUTOS ÚTEIS: fora do expediente o relógio não anda
//     (a menos que a política mande contar). Ver `somarMinutosUteis`.
//
// A2. Duas mensagens no mesmo minuto. Enquanto a execução do fluxo está viva, o prazo é do nó
//     `espera` (segundos); o relógio de atendimento (minutos) só arma quando a conversa está com
//     humano — §5.3. Sem essa regra o cliente lê «não entendi, escolha uma opção» e «ainda está
//     aí?» juntos, e conclui que o robô quebrou. Ver `podeArmarRelogio`.
//
// A3. Ação duplicada depois de um reinício. O trabalhador pode morrer entre RESERVAR o disparo e
//     APLICAR a ação. A proteção é em três camadas, e nenhuma delas é «torcer para não cair»:
//       (a) a reserva é uma escrita CONDICIONAL (`disparadoEm: null` no WHERE) — dois processos
//           nunca reservam a mesma linha;
//       (b) o trabalho preso em `em_curso` é REABERTO pelo ceifador, nunca abandonado — trabalho
//           que some aqui é uma conversa parada que ninguém vai devolver para a fila;
//       (c) antes de agir, o estado é RELIDO e comparado: se a conversa já está no estado-alvo, a
//           ação é dada por cumprida e a mensagem NÃO sai de novo. É convergência de estado, que é
//           o único jeito honesto de reexecutar com segurança uma ação que envia texto para o
//           cliente.
//     É a mesma lição já registrada na casa em `noc-monitor-restart-safe-recovery.md`: monitor
//     resolve reconciliando com o BANCO, nunca só por evento.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES DECLARADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Fuso padrão. Explícito DE PROPÓSITO: a caixa 1 do Ragnabot está em UTC (medido em 29/08), e
 *  herdar o fuso da plataforma erraria todo expediente em 3 horas. O erro apareceria como «o robô
 *  respondeu fora de hora», que ninguém liga ao fuso. */
export const FUSO_PADRAO = 'America/Fortaleza';

/** Tipos de relógio. `inatividade`, `aviso` e `transbordo` vêm do §4.5.
 *  ⚠️ ACRÉSCIMO DECLARADO: `fora_expediente` e `despedida_espera`.
 *  Eles não são relógio de prazo — são CARIMBO de «isto já foi feito uma vez». O campo `chave` é
 *  único, então criar a linha É a garantia de não repetir; e como a chave do carimbo carrega a
 *  DATA, o «uma vez» é «uma vez por dia», que é exatamente a regra da mensagem de fora de
 *  expediente. Sem esse uso, a virada do expediente precisaria de uma tabela nova só para lembrar
 *  a quem já avisou — e uma tabela a mais é uma tabela a mais para provar isolamento por empresa. */
export const TIPOS_RELOGIO = Object.freeze({
  INATIVIDADE: 'inatividade',
  AVISO: 'aviso',
  TRANSBORDO: 'transbordo',
  FORA_EXPEDIENTE: 'fora_expediente',
  DESPEDIDA_ESPERA: 'despedida_espera',
});

/** Os tipos que são RELÓGIO DE PRAZO de verdade — os únicos que podem ser disparados e reabertos.
 *
 * ⚠️ DEFEITO REAL CORRIGIDO EM 29/08/2026 (auditoria adversarial, 3 céticos independentes, 0
 * refutações). Sem esta separação acontecia o seguinte encadeamento, e ele derrubava conversa de
 * cliente sem prazo nenhum ter corrido:
 *   1. `avisarUmaVezPorDia` grava o CARIMBO `fora_expediente` com `venceEm = instante` (já vencido)
 *      e `resultado = em_curso`; o fecho logo abaixo é `.catch(() => {})`;
 *   2. o processo morre no meio (um `pm2 restart`, um failover do Patroni) e a linha fica presa;
 *   3. `ceifarDisparosPresos` reabre QUALQUER linha presa — não olhava o tipo — zerando
 *      `disparadoEm`/`resultado`;
 *   4. `dispararVencidos` filtra só por `venceEm <= agora AND disparadoEm = null` — também não
 *      olhava o tipo — e o carimbo casa;
 *   5. `acaoDoRelogio` não conhece `fora_expediente` e caía no `politica.inatividadeAcao ||
 *      'devolver_fila'`.
 * Resultado: um carimbo de «já avisei hoje que estamos fechados» virava relógio de inatividade
 * vencido e devolvia a conversa para a fila (ou a RESOLVIA, se a ação configurada fosse `resolver`).
 *
 * A premissa do ceifador — «reabrir é seguro porque a segunda passada relê o estado e converge» —
 * é verdadeira para relógio de prazo e FALSA para carimbo, que não tem estado a reler. */
export const TIPOS_DE_PRAZO = Object.freeze([
  TIPOS_RELOGIO.INATIVIDADE, TIPOS_RELOGIO.AVISO, TIPOS_RELOGIO.TRANSBORDO,
]);

/** Resultados gravados em `RagnabotAtendRelogio.resultado`.
 *  O §4.5 declara `aplicado | descartado_obsoleto | recusado_fora_expediente | erro`; os três
 *  abaixo são ACRÉSCIMO DECLARADO, e cada um existe porque a ausência dele produziria um estado
 *  que ninguém consegue explicar depois:
 *    EM_CURSO        — reservado, ainda não aplicado. É o que o ceifador procura.
 *    RECUSADO_PAUSA  — a distribuição está pausada (interruptor de emergência): a ação que
 *                      ATRIBUI alguém não pode acontecer, e o motivo tem de ficar escrito.
 *    SEM_ACAO        — venceu, mas a conversa já não é candidata (mudou de dono, foi resolvida).
 *                      Diferente de `descartado_obsoleto`, que é «o cliente falou antes do prazo». */
export const RESULTADOS = Object.freeze({
  APLICADO: 'aplicado',
  DESCARTADO_OBSOLETO: 'descartado_obsoleto',
  RECUSADO_FORA_EXPEDIENTE: 'recusado_fora_expediente',
  RECUSADO_PAUSA: 'recusado_pausa',
  SEM_ACAO: 'sem_acao',
  EM_CURSO: 'em_curso',
  ERRO: 'erro',
});

/** Motivos de congelamento. Estado congelado SEM motivo declarado é estado que ninguém consegue
 *  explicar depois — e a primeira pergunta do dono vai ser «por que essa conversa não voltou». */
export const MOTIVOS_PAUSA = Object.freeze({
  FORA_EXPEDIENTE: 'fora_expediente',
  INTERVALO: 'intervalo',
  FERIADO: 'feriado',
  FLUXO_ATIVO: 'fluxo_ativo',
  DISTRIBUICAO_PAUSADA: 'distribuicao_pausada',
});

/** Estados do expediente devolvidos por `avaliarExpediente`. `intervalo` é separado de `fora_hora`
 *  de propósito: dizer «estamos fechados» às 12h é mentira, e o cliente percebe. */
export const MOTIVOS_EXPEDIENTE = Object.freeze({
  ABERTO: 'aberto',
  FORA_HORA: 'fora_hora',
  INTERVALO: 'intervalo',
  FERIADO: 'feriado',
});

/** Estados ativos da execução de fluxo. Cópia local e DECLARADA do que o motor exporta
 *  (`ESTADOS_ATIVOS`). Não importo o motor aqui de propósito: este arquivo precisa carregar e ser
 *  testado sem arrastar as portas do motor junto. Se a lista lá mudar, esta precisa mudar — e é
 *  por isso que está escrita num lugar só, com este aviso. */
const ESTADOS_ATIVOS_DO_FLUXO = Object.freeze(['rodando', 'esperando', 'pausado_humano', 'pausado_duvida']);

/** Prazo para o ceifador reabrir trabalho preso em `em_curso`. Generoso de propósito: reabrir cedo
 *  demais é competir com um trabalhador que ainda está vivo e apenas lento. */
const CEIFADOR_MINUTOS = 10;

/** Teto de dias que `somarMinutosUteis` caminha procurando janela aberta. Uma política sem nenhuma
 *  janela (ou com todas inativas) faria o laço andar para sempre; com o teto ele desiste e devolve
 *  o prazo corrido, que é o comportamento menos surpreendente. */
const TETO_DIAS_BUSCA = 30;

/** Quanto de folga o relógio dá antes de considerar que houve atividade nova. Sem essa folga, o
 *  arredondamento de milissegundos entre o que o Chatwoot devolve e o que gravamos faria toda
 *  varredura achar que «o cliente acabou de falar» e re-armar o relógio para sempre — a conversa
 *  nunca venceria, e o defeito seria invisível. */
const TOLERANCIA_ATIVIDADE_MS = 1000;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PORTAS INJETÁVEIS
//
// Mesmo desenho do motor de fluxo, e pelo mesmo motivo: este arquivo tem UM autor; a porta do
// Chatwoot, a fila e a auditoria têm outros. As portas existem para (a) o processo amarrar tudo num
// lugar só e (b) o teste rodar o trabalhador inteiro sem Chatwoot e sem banco.
//
// ⚠️ NÃO é ponto de bifurcação de comportamento. Não existe «modo de teste» que siga caminho
// diferente: o teste injeta OUTRAS implementações das MESMAS portas.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const portas = {
  db: prismaPadrao,
  log: loggerPadrao,

  /**
   * Porta do Chatwoot — a única coisa deste arquivo que fala com a plataforma.
   * @type {null | {
   *   conversasEmAtendimento: (f:{cwAccountId:number, limite:number}) => Promise<Array<ConversaCw>>,
   *   lerConversa: (f:{cwAccountId:number, cwConversationId:number}) => Promise<ConversaCw|null>,
   *   devolverParaFila?: Function, transferirTime?: Function, resolver?: Function,
   *   enviarMensagem?: Function, notaInterna?: Function,
   * }}
   *
   * @typedef {object} ConversaCw
   * @property {number}  id
   * @property {number}  cwInboxId
   * @property {number?} cwTeamId
   * @property {number?} cwAssigneeId
   * @property {string}  status                 open | pending | resolved | snoozed
   * @property {Date?}   waitingSince           preenchido quando o CONTATO falou e ninguém respondeu
   * @property {Date?}   lastActivityAt         qualquer atividade, dos dois lados
   * @property {Date?}   firstReplyCreatedAt    nulo = nenhum atendente falou nesta conversa ainda
   * @property {Date?}   statusChangedAt
   */
  chatwoot: null,

  /** Fila durável do motor (`RagnabotFluxoFila`), usada só para NOTIFICAR e para mandar mensagem
   *  pelo caminho que respeita a janela de 24 h. Opcional: sem ela, a ação de ESTADO ainda
   *  acontece e a mensagem fica registrada como não enviada — §5.6, «fora da janela, a ação de
   *  estado acontece e a mensagem não; o motivo fica na nota interna».
   *  @type {null | { enfileirar: Function }} */
  fila: null,

  /** Avaliador de expediente. Quando o serviço de políticas expuser o seu, ele manda; enquanto não
   *  expuser, vale a implementação local deste arquivo (que é a mesma regra, e é testada aqui).
   *  @type {null | { avaliarExpediente: Function }} */
  politicas: null,

  /** Registro de auditoria. Ausente vira INSERT direto em `RagnabotAuditoria` (§4.7: a tabela de
   *  eventos da automação é ela, não uma nova).
   *  @type {null | { registrar: Function }} */
  auditoria: null,

  /** Relógio. Só o teste troca. Em produção a hora vem do BANCO, nunca do processo — relógio de pod
   *  fora de sincronia decide prazo e virada de expediente errados.
   *  @type {null | { agora: () => Promise<Date>|Date }} */
  relogio: null,
};

/** Amarra as dependências. Chamada uma vez pelo processo, e pelo teste. */
export function configurarTrabalhador(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no trabalhador de atendimento: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDoTrabalhador() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/**
 * A hora vem do BANCO. Mesma regra do motor de fluxo: `Date` vinda de `now()`, nunca `Date.now()`
 * do processo. Dois pods com relógio dessincronizado decidiriam viradas de expediente diferentes
 * para a mesma empresa, e o sintoma seria «a mensagem de fora de hora saiu duas vezes».
 */
async function agora() {
  if (portas.relogio) return normalizarData(await portas.relogio.agora());
  const cliente = db();
  if (typeof cliente?.$queryRaw !== 'function') return new Date();
  const linhas = await cliente.$queryRaw`SELECT now() AS agora`;
  const valor = Array.isArray(linhas) && linhas[0] ? linhas[0].agora : null;
  if (!valor) throw new Error('o banco não devolveu now() — o trabalhador de atendimento não decide prazo sem hora confiável');
  return normalizarData(valor);
}

const normalizarData = (v) => (v == null ? null : (v instanceof Date ? v : new Date(v)));
const somarMs = (data, milis) => new Date(new Date(data).getTime() + milis);
const emMs = (minutos) => Math.round(minutos * 60_000);

/** Chave de partição da fila do motor. Precisa bater EXATAMENTE com `chaveParticaoDe` de
 *  `ragnabot-fluxo-motor.service.js` — é a unidade de serialização que impede o relógio de mexer na
 *  conversa enquanto um nó do fluxo está no meio de um passo (§5.4). Está copiada, e não importada,
 *  para este arquivo carregar sem arrastar as portas do motor; se o formato lá mudar, muda aqui. */
export function chaveParticaoDe({ cwAccountId, cwConversationId }) {
  return `${cwAccountId}:${cwConversationId}`;
}

/** Chave do relógio: «conta:conversa:tipo». NOT NULL e única — mata dois defeitos de uma vez: dois
 *  relógios do mesmo tipo na mesma conversa (o cliente recebendo «ainda está aí?» duas vezes) e a
 *  corrida entre o trabalhador e o evento de mensagem nova. O sufixo existe só para os carimbos de
 *  «uma vez por dia» (ver TIPOS_RELOGIO). */
export function chaveRelogio({ cwAccountId, cwConversationId, tipo, sufixo = '' }) {
  const base = `${cwAccountId}:${cwConversationId}:${tipo}`;
  return sufixo ? `${base}:${sufixo}` : base;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FUSO HORÁRIO — sem biblioteca, e com o cuidado que a falta dela exige
// ════════════════════════════════════════════════════════════════════════════════════════════════

const CACHE_FORMATADORES = new Map();

function formatador(fuso) {
  let f = CACHE_FORMATADORES.get(fuso);
  if (!f) {
    // `hourCycle: 'h23'` DE PROPÓSITO: com `hour12:false` puro há versões de Node que devolvem
    // «24» para a meia-noite, e 24*60 = 1440 minutos jogaria o instante para o dia seguinte — um
    // erro de um dia inteiro que só aparece em quem trabalha de madrugada.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    CACHE_FORMATADORES.set(fuso, f);
  }
  return f;
}

/** Decompõe um instante no fuso pedido. Devolve também `minutoDoDia`, que é a unidade em que o
 *  expediente é guardado (minutos desde a meia-noite) — comparar um inteiro é o que evita a
 *  validação que, no Chatwoot, proibiu a segunda janela do dia. */
export function partesNoFuso(instante, fuso = FUSO_PADRAO) {
  const p = Object.fromEntries(
    formatador(fuso).formatToParts(new Date(instante)).map((x) => [x.type, x.value]),
  );
  const hora = Number(p.hour) % 24;
  const minuto = Number(p.minute);
  const data = new Date(instante);
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    hora, minuto, segundo: Number(p.second),
    minutoDoDia: hora * 60 + minuto,
    // `getUTCDay` do instante NÃO serve: o dia da semana precisa ser o do fuso da política.
    diaSemana: diaDaSemanaLocal(p, data),
    chaveData: `${p.year}-${p.month}-${p.day}`,
  };
}

function diaDaSemanaLocal(p) {
  // Date.UTC com os componentes JÁ no fuso local devolve o dia da semana daquele calendário.
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
}

/**
 * Converte «ano-mês-dia + minuto do dia, no fuso X» de volta para um instante absoluto.
 *
 * ⚠️ POR QUE ISTO É ITERATIVO E NÃO UMA SUBTRAÇÃO: o deslocamento do fuso depende do instante, e o
 * instante é justamente o que estamos procurando. Um chute com o deslocamento errado cai do lado
 * errado de uma virada de horário de verão e erra em uma hora — o suficiente para a mensagem de
 * abertura sair 60 minutos antes do expediente. Duas passadas convergem em todos os fusos reais
 * (Fortaleza não tem horário de verão; outros clientes podem ter).
 */
export function instanteDe({ ano, mes, dia, minutoDoDia = 0 }, fuso = FUSO_PADRAO) {
  const alvoUtc = Date.UTC(ano, mes - 1, dia, 0, 0, 0) + minutoDoDia * 60_000;
  let palpite = new Date(alvoUtc);
  for (let i = 0; i < 2; i += 1) {
    const desloc = deslocamentoMs(palpite, fuso);
    palpite = new Date(alvoUtc - desloc);
  }
  return palpite;
}

/** Deslocamento do fuso, em milissegundos, para um instante. Positivo a leste de Greenwich. */
function deslocamentoMs(instante, fuso) {
  const p = Object.fromEntries(
    formatador(fuso).formatToParts(new Date(instante)).map((x) => [x.type, x.value]),
  );
  const comoSeFosseUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  // Segundos inteiros dos dois lados: os milissegundos não aparecem no formatador e entrariam como
  // ruído no deslocamento.
  return comoSeFosseUtc - Math.floor(new Date(instante).getTime() / 1000) * 1000;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXPEDIENTE — funções PURAS, e é de propósito
//
// Tudo o que decide «está aberto?» e «quando o prazo vence?» é função pura: recebe as janelas, as
// exceções e um instante, e devolve a resposta. Sem banco, sem rede, sem relógio do processo. É o
// que torna possível provar por teste o caso que ninguém consegue reproduzir à mão — o do prazo que
// começa às 17h50 e não pode vencer às 3 da manhã.
//
// A linha do expediente é a JANELA, não o dia (§4.2). Segunda com almoço são DUAS linhas. Plantão
// que vira a madrugada são duas linhas. É a correção direta do defeito medido no Chatwoot, onde
// `working_hours` guarda um único par abre/fecha por dia e representar 08–12 e 13–18 é impossível.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Soma dias a uma data de calendário, sem tocar em fuso (é aritmética de calendário, não de tempo). */
function somarDias({ ano, mes, dia }, n) {
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), diaSemana: d.getUTCDay() };
}

const doisDigitos = (n) => String(n).padStart(2, '0');
const chaveDataDe = ({ ano, mes, dia }) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;

/**
 * Exceção que vale para um dia de calendário. Aceita as duas formas do §4.3:
 *   data fixa    "2026-12-25"
 *   recorrente   "*-12-25"
 * A fixa VENCE a recorrente quando as duas existem — é o caso do ano em que o feriado cai diferente
 * ou em que a empresa decide abrir; sem essa precedência, a exceção específica seria escrita e
 * ignorada, que é o pior tipo de configuração.
 */
export function excecaoDoDia(excecoes, dataLocal) {
  if (!Array.isArray(excecoes) || !excecoes.length) return null;
  const fixa = chaveDataDe(dataLocal);
  const recorrente = `*-${doisDigitos(dataLocal.mes)}-${doisDigitos(dataLocal.dia)}`;
  return excecoes.find((e) => e?.chaveData === fixa)
      ?? excecoes.find((e) => e?.chaveData === recorrente)
      ?? null;
}

/**
 * Janelas de um dia de calendário, já em instantes absolutos.
 *
 * ⚠️ `fechaMin <= abreMin` significa que a janela CRUZA A MEIA-NOITE (plantão). Representá-la como
 * «fecha às 02:00 do dia seguinte» aqui, e não como aritmética de módulo espalhada por três
 * funções, é o que impede o plantão de ser lido como janela de duração negativa — que é como uma
 * janela some sem ninguém perceber.
 */
export function janelasAbsolutasDoDia(ctx, dataLocal) {
  const fuso = ctx.fuso || FUSO_PADRAO;
  const excecao = excecaoDoDia(ctx.excecoes, dataLocal);

  if (excecao && excecao.tipo === 'fechado') return [];

  let brutas;
  if (excecao && excecao.tipo === 'janela_especial' && excecao.abreMin != null && excecao.fechaMin != null) {
    // Meio expediente de véspera, por exemplo. Substitui o dia inteiro: a exceção é a regra do dia.
    brutas = [{ abreMin: excecao.abreMin, fechaMin: excecao.fechaMin, rotulo: excecao.rotulo || 'janela especial' }];
  } else {
    brutas = (ctx.janelas || [])
      .filter((j) => j && j.ativo !== false && Number(j.diaSemana) === dataLocal.diaSemana);
  }

  return brutas
    .map((j) => {
      const abre = Number(j.abreMin);
      const fecha = Number(j.fechaMin);
      if (!Number.isFinite(abre) || !Number.isFinite(fecha)) return null;
      const cruzaMeiaNoite = fecha <= abre;
      return {
        inicio: instanteDe({ ...dataLocal, minutoDoDia: abre }, fuso),
        fim: instanteDe({ ...(cruzaMeiaNoite ? somarDias(dataLocal, 1) : dataLocal), minutoDoDia: fecha }, fuso),
        rotulo: j.rotulo || null,
        cruzaMeiaNoite,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.inicio - b.inicio);
}

/** Janelas relevantes em torno de um instante: o dia anterior (por causa do plantão que cruza a
 *  meia-noite), o dia e o seguinte. */
function janelasEmVolta(ctx, dataLocal) {
  return [
    ...janelasAbsolutasDoDia(ctx, somarDias(dataLocal, -1)),
    ...janelasAbsolutasDoDia(ctx, dataLocal),
    ...janelasAbsolutasDoDia(ctx, somarDias(dataLocal, 1)),
  ].sort((a, b) => a.inicio - b.inicio);
}

/**
 * Está aberto AGORA? E, se não, por quê e até quando?
 *
 * O `motivo` separa `intervalo` de `fora_hora` DE PROPÓSITO. São mensagens diferentes para o
 * cliente: «voltamos às 13h» é verdade no almoço; «estamos fechados» é mentira no almoço, e o
 * cliente que acabou de ver a empresa respondendo às 11h59 percebe.
 *
 * @returns {{aberto:boolean, motivo:string, rotulo:?string, proximaAbertura:?Date, fechaEm:?Date, excecao:?object}}
 */
export function avaliarExpediente(ctx, instante) {
  const fuso = ctx?.fuso || FUSO_PADRAO;
  const agoraMs = new Date(instante).getTime();
  const p = partesNoFuso(instante, fuso);
  const dataLocal = { ano: p.ano, mes: p.mes, dia: p.dia, diaSemana: p.diaSemana };

  // Sem nenhuma janela cadastrada o expediente NÃO existe — e «não existe» tem de significar
  // SEMPRE ABERTO, nunca sempre fechado. Uma política recém-criada, ainda sem horários, que
  // respondesse «fechado» calaria o atendimento inteiro da empresa no instante em que fosse salva.
  const temAlgumaJanela = (ctx?.janelas || []).some((j) => j && j.ativo !== false);
  const excecao = excecaoDoDia(ctx?.excecoes, dataLocal);
  if (!temAlgumaJanela && !excecao) {
    return { aberto: true, motivo: MOTIVOS_EXPEDIENTE.ABERTO, rotulo: null, proximaAbertura: null, fechaEm: null, excecao: null };
  }

  const janelas = janelasEmVolta(ctx, dataLocal);
  const atual = janelas.find((j) => agoraMs >= j.inicio.getTime() && agoraMs < j.fim.getTime());
  if (atual) {
    return {
      aberto: true, motivo: MOTIVOS_EXPEDIENTE.ABERTO, rotulo: atual.rotulo,
      proximaAbertura: null, fechaEm: atual.fim, excecao: excecao || null,
    };
  }

  const proximaAbertura = proximaAberturaApos(ctx, instante);

  if (excecao && excecao.tipo === 'fechado') {
    return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.FERIADO, rotulo: excecao.rotulo || null, proximaAbertura, fechaEm: null, excecao };
  }

  // INTERVALO = dentro do mesmo dia de calendário, com janela já encerrada antes e outra ainda por
  // abrir depois. É a definição operacional do almoço, e ela cai naturalmente do modelo de janelas.
  const doDia = janelasAbsolutasDoDia(ctx, dataLocal);
  const houveAntes = doDia.some((j) => j.fim.getTime() <= agoraMs);
  const haDepois = doDia.some((j) => j.inicio.getTime() > agoraMs);
  if (houveAntes && haDepois) {
    return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.INTERVALO, rotulo: null, proximaAbertura, fechaEm: null, excecao: excecao || null };
  }

  return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.FORA_HORA, rotulo: null, proximaAbertura, fechaEm: null, excecao: excecao || null };
}

/** Próximo instante de abertura estritamente depois de `instante`. Devolve nulo se não houver
 *  nenhuma janela nos próximos TETO_DIAS_BUSCA dias — política com expediente vazio ou só com
 *  janelas inativas. */
export function proximaAberturaApos(ctx, instante) {
  const fuso = ctx?.fuso || FUSO_PADRAO;
  const alvo = new Date(instante).getTime();
  let dia = partesNoFuso(instante, fuso);
  dia = { ano: dia.ano, mes: dia.mes, dia: dia.dia, diaSemana: dia.diaSemana };
  for (let i = 0; i <= TETO_DIAS_BUSCA; i += 1) {
    const doDia = janelasAbsolutasDoDia(ctx, somarDias(dia, i));
    const proxima = doDia.find((j) => j.inicio.getTime() > alvo);
    if (proxima) return proxima.inicio;
  }
  return null;
}

/**
 * ⭐ O CORAÇÃO DA ARMADILHA A1: soma `minutos` de tempo ÚTIL a partir de `inicio`.
 *
 * Fora do expediente o relógio não anda. Um prazo de 30 minutos iniciado às 17h50, com expediente
 * até 18h, vence às 08h10 do dia seguinte — e não às 18h20, que é quando o cliente estaria dormindo
 * e receberia «ainda está aí?».
 *
 * Quando `contaForaExpediente` é verdadeiro, a soma é corrida: há operação que roda 24 h e quer
 * exatamente isso. O padrão é falso porque o estrago do padrão contrário é feito de madrugada,
 * quando ninguém está olhando.
 *
 * ⚠️ Se as janelas acabarem (política sem expediente cadastrado, ou todas inativas), a função
 * devolve a soma CORRIDA em vez de nulo. Prazo que nunca vence é conversa que nunca volta para a
 * fila — o silêncio seria pior que a imprecisão, e ficaria invisível.
 */
export function somarMinutosUteis(inicio, minutos, ctx = {}) {
  const totalMs = emMs(minutos);
  if (totalMs <= 0) return new Date(inicio);
  if (ctx.contaForaExpediente) return somarMs(inicio, totalMs);

  const fuso = ctx.fuso || FUSO_PADRAO;
  const temAlgumaJanela = (ctx.janelas || []).some((j) => j && j.ativo !== false);
  if (!temAlgumaJanela) return somarMs(inicio, totalMs);

  let restante = totalMs;
  let cursor = new Date(inicio).getTime();
  const p = partesNoFuso(inicio, fuso);
  const base = { ano: p.ano, mes: p.mes, dia: p.dia, diaSemana: p.diaSemana };

  // Começa no dia ANTERIOR por causa do plantão que cruza a meia-noite: a janela que contém o
  // instante inicial pode ter começado ontem.
  for (let i = -1; i <= TETO_DIAS_BUSCA; i += 1) {
    for (const j of janelasAbsolutasDoDia(ctx, somarDias(base, i))) {
      const ini = Math.max(j.inicio.getTime(), cursor);
      const fim = j.fim.getTime();
      if (fim <= ini) continue;
      const disponivel = fim - ini;
      if (restante <= disponivel) return new Date(ini + restante);
      restante -= disponivel;
      cursor = fim;
    }
  }
  // Teto estourado: devolve o prazo corrido, pelo motivo escrito acima.
  return somarMs(inicio, totalMs);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POLÍTICA EFETIVA — herança empresa → caixa → time
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Campos em que NULO significa «herda do escopo mais geral», nunca «desligado» (§4.1). */
const CAMPOS_HERDAVEIS = Object.freeze([
  'fuso',
  'inatividadeAtiva', 'inatividadeMinutos', 'inatividadeConta', 'inatividadeAcao',
  'inatividadeTimeDestino', 'inatividadeMensagem', 'inatividadeAvisoMinutos',
  'inatividadeAvisoMensagem', 'inatividadeContaForaExpediente',
  'transbordoAtivo', 'transbordoMinutos', 'transbordoTimeId', 'transbordoMensagem',
  'fluxoPrimeiroContatoId', 'fluxoPadraoId', 'fluxoForaExpedienteId', 'reiniciaFluxoAposHoras',
  'msgSaudacao', 'msgForaExpediente', 'msgIntervalo', 'msgFeriado',
  'msgTransferenciaTime', 'msgTransferenciaAgente', 'msgAtendenteIndisponivel', 'msgDespedidaEspera',
  'encerrarAposForaExpediente',
  'distribuicaoPausada', 'pausadaAte', 'pausadaMotivo',
]);

/**
 * Mescla as políticas do mais geral para o mais específico.
 *
 * ⚠️ O BOOLEANO É O CASO DELICADO. `inatividadeAtiva` tem `@default(false)` no schema, então uma
 * política de TIME recém-criada chega aqui com `false` — e um «false» que sobrescreve o «true» da
 * empresa desligaria o relógio daquele setor sem ninguém ter pedido. Por isso a regra é: o nível
 * mais específico só vence quando o campo é DIFERENTE DE NULO **e** a linha daquele nível declara o
 * campo em `camposDefinidos`. Sem essa lista, herança e padrão do banco viram a mesma coisa, e a
 * configuração passa a depender de qual linha foi salva por último.
 *
 * `camposDefinidos` é um array de nomes com o que o administrador realmente tocou ao salvar.
 *
 * ⚠️ ESTADO REAL, MEDIDO NO SCHEMA EM 29/08 — a coluna `camposDefinidos` **ainda não existe** em
 * `RagnabotAtendPolitica`, e os cinco booleanos da política são `Boolean @default(false)`, isto é,
 * NÃO anuláveis. Enquanto for assim, o risco descrito acima está VIVO: salvar uma política de setor
 * grava `inatividadeAtiva = false` e este merge desliga o relógio daquele setor sem ninguém ter
 * pedido. Este código já está pronto para o remédio — no dia em que a coluna existir (ou em que os
 * booleanos virarem anuláveis, que resolve igual), ele passa a valer sozinho, sem mudar uma linha
 * aqui. Até lá, a tela precisa impedir que se crie política de escopo mais específico sem repetir os
 * interruptores herdados. Está registrado como pendência, e não como resolvido, de propósito.
 */
export function mesclarPoliticas(camadas) {
  const vivas = (camadas || []).filter(Boolean);
  if (!vivas.length) return null;
  const alvo = { ...vivas[0] };
  for (const camada of vivas.slice(1)) {
    const declarados = Array.isArray(camada.camposDefinidos) ? new Set(camada.camposDefinidos) : null;
    for (const campo of CAMPOS_HERDAVEIS) {
      const v = camada[campo];
      if (v === null || v === undefined) continue;
      if (declarados && !declarados.has(campo)) continue;
      alvo[campo] = v;
    }
  }
  // A identidade é sempre a da camada MAIS ESPECÍFICA: é dela que sai `politicaId` no relógio, e é
  // por ela que a tela mostra «esta conversa está seguindo a política do setor Suporte».
  const especifica = vivas[vivas.length - 1];
  alvo.id = especifica.id;
  alvo.escopo = especifica.escopo;
  alvo.escopoChave = especifica.escopoChave;
  alvo.camadas = vivas.map((c) => ({ id: c.id, escopo: c.escopo, escopoChave: c.escopoChave }));
  return alvo;
}

/**
 * De quem é o silêncio que conta. É a escolha que o dono citou nominalmente, e a que não existe nem
 * como conceito no Chatwoot.
 *
 *   contato    → o CLIENTE sumiu. `waitingSince` NULO quer dizer que o atendente já respondeu e a
 *                bola está com o cliente; o silêncio a medir é o dele.
 *   atendente  → o ATENDENTE sumiu. `waitingSince` PREENCHIDO quer dizer que o cliente falou e
 *                ninguém respondeu — é a hora desde quando ele espera.
 *   qualquer   → ninguém falou, de lado nenhum: `lastActivityAt`. É o único que o `auto_resolve_after`
 *                nativo sabe fazer, e nem de forma configurável.
 *
 * Devolve nulo quando a conversa NÃO é candidata àquele lado — e nulo aqui significa «não arme»,
 * não «arme com o padrão». Armar com o padrão é como o relógio do atendente acabaria contando o
 * silêncio do cliente.
 */
export function ladoDoSilencio(conversa, modo) {
  const ultima = normalizarData(conversa?.lastActivityAt) || normalizarData(conversa?.statusChangedAt);
  const esperaDesde = normalizarData(conversa?.waitingSince);

  if (modo === 'atendente') {
    if (!esperaDesde) return null; // ninguém está esperando resposta: não há silêncio de atendente
    return { desde: esperaDesde, lado: 'contato' }; // quem falou por último foi o CONTATO
  }
  if (modo === 'contato') {
    if (esperaDesde) return null; // a bola está com o atendente, não com o cliente
    if (!ultima) return null;
    return { desde: ultima, lado: 'atendente' };
  }
  // 'qualquer' (e o padrão, quando a política não escolheu)
  if (!ultima) return null;
  return { desde: ultima, lado: esperaDesde ? 'contato' : 'atendente' };
}

/**
 * §5.3 — a regra que evita duas mensagens no mesmo minuto.
 *
 * Enquanto a execução do fluxo está VIVA, o prazo é do nó `espera` (segundos). O relógio de
 * atendimento (minutos) só arma quando a conversa está com humano: sem execução nenhuma, ou com a
 * execução parada em `pausado_humano`, ou com a execução já terminada.
 *
 * ⚠️ DIVERGÊNCIA MEDIDA ENTRE A ESPECIFICAÇÃO E O SCHEMA, e é preciso saber dela: o §5.3 fala em
 * «terminou com estado = 'transferido'», mas `RagnabotFluxoExecucao.estado` só admite
 * `concluido | abandonado | erro` — «transferido» é `motivoFim`, não estado. Por isso a regra aqui
 * é escrita pelo conjunto de estados ATIVOS, que é o que o schema garante: se não está ativo, a
 * conversa é de humano. Escrever a regra pelo campo errado a faria devolver falso para toda
 * conversa transferida — e nenhuma transferência ganharia relógio.
 */
export function podeArmarRelogio(execucao) {
  if (!execucao) return true;                              // nunca houve fluxo nesta conversa
  if (!ESTADOS_ATIVOS_DO_FLUXO.includes(execucao.estado)) return true; // fluxo terminou
  return execucao.estado === 'pausado_humano';             // parado esperando gente
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LEITURA DA CONFIGURAÇÃO — uma vez por rodada, nunca uma consulta por conversa
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Carrega políticas ativas, janelas e exceções, e monta o índice por conta.
 *
 * Três consultas por rodada, e não três por conversa: uma operação com 400 conversas abertas faria
 * 1.200 idas ao banco a cada minuto, e o primeiro sintoma seria o pool esgotado — que aparece como
 * o atendimento inteiro travando, não como «o relógio está lento».
 */
export async function carregarIndiceDePoliticas() {
  const cliente = db();
  const politicas = await cliente.ragnabotAtendPolitica.findMany({ where: { ativa: true } });
  if (!politicas.length) return { contas: new Map(), total: 0 };

  const ids = politicas.map((p) => p.id);
  const [janelas, excecoes] = await Promise.all([
    cliente.ragnabotAtendExpediente.findMany({ where: { politicaId: { in: ids }, ativo: true } }),
    cliente.ragnabotAtendExcecaoData.findMany({ where: { politicaId: { in: ids } } }),
  ]);

  const janelasPor = new Map();
  for (const j of janelas) {
    if (!janelasPor.has(j.politicaId)) janelasPor.set(j.politicaId, []);
    janelasPor.get(j.politicaId).push(j);
  }
  const excecoesPor = new Map();
  for (const e of excecoes) {
    if (!excecoesPor.has(e.politicaId)) excecoesPor.set(e.politicaId, []);
    excecoesPor.get(e.politicaId).push(e);
  }

  const contas = new Map();
  for (const p of politicas) {
    if (!contas.has(p.cwAccountId)) {
      contas.set(p.cwAccountId, { cwAccountId: p.cwAccountId, tenantId: p.tenantId, empresa: null, porCaixa: new Map(), porTime: new Map() });
    }
    const bloco = contas.get(p.cwAccountId);
    if (p.escopo === 'empresa') bloco.empresa = p;
    else if (p.escopo === 'caixa' && p.cwInboxId != null) bloco.porCaixa.set(p.cwInboxId, p);
    else if (p.escopo === 'time' && p.cwTeamId != null) bloco.porTime.set(p.cwTeamId, p);
  }

  return { contas, janelasPor, excecoesPor, total: politicas.length };
}

/**
 * Política efetiva de uma conversa: empresa → caixa → time, nesta ordem.
 * Devolve também o contexto de expediente já montado, porque quem decide o prazo precisa dos dois
 * juntos e separá-los só criaria a chance de usar a janela de uma política com o fuso de outra.
 */
export function politicaEfetivaPara(indice, conversa) {
  const bloco = indice?.contas?.get(conversa.cwAccountId);
  if (!bloco) return null;
  const camadas = [
    bloco.empresa,
    conversa.cwInboxId != null ? bloco.porCaixa.get(conversa.cwInboxId) : null,
    conversa.cwTeamId != null ? bloco.porTime.get(conversa.cwTeamId) : null,
  ].filter(Boolean);
  const politica = mesclarPoliticas(camadas);
  if (!politica) return null;
  return { politica, ctx: contextoDeExpediente(indice, politica) };
}

/**
 * Contexto de expediente da política efetiva.
 *
 * ⚠️ AS JANELAS NÃO SE MISTURAM ENTRE CAMADAS. Vale o expediente da camada MAIS ESPECÍFICA QUE
 * TIVER JANELAS. Somar as janelas do setor às da empresa produziria um expediente que ninguém
 * cadastrou — o setor que abre só de manhã continuaria «aberto» à tarde porque a empresa abre, e o
 * operador olharia para a tela do setor sem entender de onde veio aquela tarde.
 */
export function contextoDeExpediente(indice, politica) {
  const camadas = politica.camadas || [{ id: politica.id }];
  let janelas = [];
  let excecoes = [];
  for (const c of camadas) {
    const j = indice?.janelasPor?.get(c.id) || [];
    const e = indice?.excecoesPor?.get(c.id) || [];
    if (j.length) janelas = j;
    if (e.length) excecoes = e;
  }
  return {
    fuso: politica.fuso || FUSO_PADRAO,
    janelas,
    excecoes,
    contaForaExpediente: politica.inatividadeContaForaExpediente === true,
  };
}

/**
 * Avalia o expediente pela porta injetada, quando existir; senão pela implementação local.
 *
 * ⚠️ O ADAPTADOR ACEITA AS DUAS ASSINATURAS, e isto não é indecisão. O serviço irmão
 * `ragnabot-atendimento.service.js` (de outro autor) expõe
 * `avaliarExpediente({ agora, fuso, janelas, excecoes })`, enquanto a função local deste arquivo
 * recebe `(ctx, instante)`. Chamar a porta com a forma errada devolveria «aberto» em silêncio —
 * `janelas` chegaria vazio, e a regra de «sem janela = sempre aberto» transformaria o defeito de
 * integração em «o robô respondeu de madrugada». O adaptador manda os dois formatos de uma vez:
 * o objeto nomeado como primeiro argumento (que é o que o irmão lê) e `(ctx, instante)` na
 * posição que a versão local espera.
 *
 * O motivo `sem_configuracao`, que só o irmão devolve, é tratado como ABERTO — é a mesma decisão da
 * versão local, e pelo mesmo motivo: política recém-criada não pode calar a empresa.
 */
function expedienteAgora(ctx, instante) {
  const avaliador = portas.politicas?.avaliarExpediente;
  if (!avaliador) return avaliarExpediente(ctx, instante);
  const argumento = { agora: instante, fuso: ctx.fuso || FUSO_PADRAO, janelas: ctx.janelas || [], excecoes: ctx.excecoes || [], ...ctx };
  const r = avaliador(argumento, instante) || {};
  return {
    aberto: r.aberto === true || r.motivo === 'sem_configuracao',
    motivo: r.motivo === 'sem_configuracao' ? MOTIVOS_EXPEDIENTE.ABERTO : (r.motivo ?? MOTIVOS_EXPEDIENTE.ABERTO),
    rotulo: r.rotulo ?? null,
    proximaAbertura: normalizarData(r.proximaAbertura),
    fechaEm: normalizarData(r.fechaEm),
    excecao: r.excecao ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AUDITORIA — §4.7: a tabela de eventos da automação é `RagnabotAuditoria`, não uma nova
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Falha de auditoria NUNCA derruba a rodada: registro perdido é ruim; atendimento parado por causa
 *  do registro é pior. Mas o erro é logado — auditoria que falha em silêncio é auditoria que não
 *  existe, e a casa trata auditoria como requisito de primeira classe. */
async function auditar(evento) {
  try {
    if (portas.auditoria?.registrar) { await portas.auditoria.registrar(evento); return; }
    await db().ragnabotAuditoria.create({
      data: {
        tenantId: evento.tenantId ?? null,
        atorTipo: 'sistema',
        atorId: null,
        atorNome: 'Automação de atendimento',
        categoria: 'atendimento',
        acao: evento.acao,
        descricao: evento.descricao ?? null,
        protocolo: evento.protocolo ?? null,
        entidade: evento.entidade ?? 'conversa',
        entidadeId: evento.entidadeId != null ? String(evento.entidadeId) : null,
        antes: evento.antes ?? null,
        depois: evento.depois ?? null,
      },
    });
  } catch (e) {
    log().error?.(`[atend-worker] auditoria falhou (${evento?.acao}): ${e.message}`);
  }
}

/** Registro de «quem passou para quem, e por quê» (§4.6). Toda transferência feita pelo relógio
 *  passa por aqui — é o que responde «por que essa conversa mudou de setor às 14h32» sem cruzar log
 *  de três serviços. */
async function registrarTransferencia(dados) {
  try {
    await db().ragnabotAtendTransferencia.create({ data: dados });
  } catch (e) {
    log().error?.(`[atend-worker] registro de transferência falhou: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FASE A — RECONCILIAÇÃO: semear e re-armar os relógios a partir do BANCO
//
// Esta fase é a que torna o trabalhador à prova de reinício. Ela NÃO depende de ter visto o evento
// de mensagem nova: ela lê o estado atual das conversas e conserta o que estiver diferente. Um
// processo que passou uma hora morto volta e, na primeira rodada, tem todos os relógios certos.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Prazo de um relógio, já com o expediente descontado, e o motivo do congelamento quando há um. */
function calcularPrazo({ desde, minutos, ctx, instante, expediente }) {
  const venceEm = somarMinutosUteis(desde, minutos, ctx);
  let pausadoMotivo = null;
  if (!ctx.contaForaExpediente && !expediente.aberto) {
    pausadoMotivo = expediente.motivo === MOTIVOS_EXPEDIENTE.INTERVALO ? MOTIVOS_PAUSA.INTERVALO
      : expediente.motivo === MOTIVOS_EXPEDIENTE.FERIADO ? MOTIVOS_PAUSA.FERIADO
        : MOTIVOS_PAUSA.FORA_EXPEDIENTE;
  }
  // O prazo nunca fica no passado por efeito de arredondamento: se a conta deu «já venceu», o
  // instante atual é o vencimento, e a fase de disparo decide. Prazo no passado por 3 milissegundos
  // e prazo no passado por 3 horas devem ter o mesmo comportamento.
  return { venceEm: venceEm < instante ? new Date(instante) : venceEm, pausadoMotivo };
}

function precisaAtualizarRelogio(atual, alvo) {
  if (!atual) return true;
  // ⚠️ RELÓGIO JÁ DISPARADO SÓ RENASCE COM ATIVIDADE NOVA.
  // Este é o defeito que o teste do aviso prévio revelou: re-armar todo relógio disparado a cada
  // varredura fazia o «ainda está aí?» sair DE NOVO a cada 60 segundos, para sempre, enquanto o
  // cliente continuasse calado — exatamente o silêncio que o aviso existe para tratar. O ciclo novo
  // começa quando alguém fala, e só então.
  if (atual.disparadoEm) {
    return new Date(alvo.ultimaAtividadeEm).getTime()
      > new Date(atual.ultimaAtividadeEm).getTime() + TOLERANCIA_ATIVIDADE_MS;
  }
  if (Math.abs(new Date(atual.venceEm).getTime() - alvo.venceEm.getTime()) > TOLERANCIA_ATIVIDADE_MS) return true;
  if (Math.abs(new Date(atual.ultimaAtividadeEm).getTime() - alvo.ultimaAtividadeEm.getTime()) > TOLERANCIA_ATIVIDADE_MS) return true;
  if ((atual.pausadoMotivo ?? null) !== (alvo.pausadoMotivo ?? null)) return true;
  if ((atual.ultimaAtividadeLado ?? null) !== (alvo.ultimaAtividadeLado ?? null)) return true;
  return false;
}

/**
 * Grava o relógio. `upsert` pela `chave` única: é ela que impede dois relógios do mesmo tipo na
 * mesma conversa, mesmo com dois trabalhadores rodando ao mesmo tempo.
 *
 * ⚠️ Ao re-armar (ciclo novo), `disparadoEm`, `resultado` e `erro` VOLTAM A NULO de propósito. A
 * linha é o estado VIVO do prazo, não o histórico — o histórico de cada disparo vai para
 * `RagnabotAuditoria`. Guardar as duas coisas na mesma linha faria «já disparou» significar duas
 * coisas ao mesmo tempo, e a fase de disparo pararia de saber o que ainda deve.
 */
async function gravarRelogio(alvo) {
  const dados = {
    tenantId: alvo.tenantId,
    cwAccountId: alvo.cwAccountId,
    cwConversationId: alvo.cwConversationId,
    politicaId: alvo.politicaId,
    tipo: alvo.tipo,
    ultimaAtividadeEm: alvo.ultimaAtividadeEm,
    ultimaAtividadeLado: alvo.ultimaAtividadeLado,
    venceEm: alvo.venceEm,
    pausadoMotivo: alvo.pausadoMotivo ?? null,
    disparadoEm: null,
    resultado: null,
    erro: null,
  };
  return db().ragnabotAtendRelogio.upsert({
    where: { chave: alvo.chave },
    create: { chave: alvo.chave, ...dados },
    update: dados,
  });
}

/** Encerra o ciclo de um relógio sem ação — a conversa deixou de ser candidata (mudou de dono, foi
 *  resolvida, ou a política desligou aquele relógio). Não apaga a linha: apagar perderia a resposta
 *  a «por que essa conversa parou de ser vigiada». */
async function encerrarCicloSemAcao(relogio, instante, motivo) {
  await db().ragnabotAtendRelogio.updateMany({
    where: { id: relogio.id, disparadoEm: null },
    data: { disparadoEm: instante, resultado: RESULTADOS.SEM_ACAO, erro: motivo ?? null },
  });
}

/**
 * Uma rodada de reconciliação.
 * @returns {{conversas:number, armados:number, reArmados:number, encerrados:number, ignorados:number}}
 */
export async function reconciliarRelogios({ limitePorConta = 500 } = {}) {
  const resumo = { conversas: 0, armados: 0, reArmados: 0, encerrados: 0, ignorados: 0 };
  const cw = portas.chatwoot;
  if (!cw?.conversasEmAtendimento) {
    log().warn?.('[atend-worker] porta do Chatwoot ausente — reconciliação não roda sem ler as conversas');
    return resumo;
  }

  const indice = await carregarIndiceDePoliticas();
  if (!indice.total) return resumo;
  const instante = await agora();

  for (const [cwAccountId] of indice.contas) {
    const conversas = await cw.conversasEmAtendimento({ cwAccountId, limite: limitePorConta });
    if (!conversas?.length) continue;
    resumo.conversas += conversas.length;

    // Execuções de fluxo vivas destas conversas, numa consulta só (§5.3).
    const idsConversa = conversas.map((c) => c.id);
    const execucoes = await db().ragnabotFluxoExecucao.findMany({
      where: { cwAccountId, cwConversationId: { in: idsConversa }, estado: { in: ESTADOS_ATIVOS_DO_FLUXO } },
      select: { cwConversationId: true, estado: true },
    }).catch(() => []);
    const execPor = new Map((execucoes || []).map((e) => [e.cwConversationId, e]));

    // Relógios já existentes destas conversas, numa consulta só.
    const relogios = await db().ragnabotAtendRelogio.findMany({
      where: { cwAccountId, cwConversationId: { in: idsConversa } },
    });
    const relPor = new Map(relogios.map((r) => [r.chave, r]));

    for (const conversa of conversas) {
      const efetiva = politicaEfetivaPara(indice, conversa);
      if (!efetiva) { resumo.ignorados += 1; continue; }
      const { politica, ctx } = efetiva;
      const expediente = expedienteAgora(ctx, instante);
      const podeArmar = podeArmarRelogio(execPor.get(conversa.id));

      const alvos = alvosDeRelogio({ conversa, politica, ctx, instante, expediente, podeArmar });

      for (const alvo of alvos) {
        const atual = relPor.get(alvo.chave) || null;
        if (alvo.encerrar) {
          if (atual && !atual.disparadoEm) { await encerrarCicloSemAcao(atual, instante, alvo.motivo); resumo.encerrados += 1; }
          continue;
        }
        if (!precisaAtualizarRelogio(atual, alvo)) continue;
        await gravarRelogio(alvo);
        if (atual) resumo.reArmados += 1; else resumo.armados += 1;
      }
    }
  }
  return resumo;
}

/**
 * Quais relógios esta conversa deve ter agora, e com que prazo. Função pura — recebe a conversa e a
 * política, devolve os alvos. É onde mora a decisão, e por isso é a parte mais testada do arquivo.
 *
 * Cada alvo devolvido é «o estado que a linha do relógio deveria ter»; quem grava é a reconciliação.
 * Separar decidir de gravar é o que permite provar a decisão sem banco.
 */
export function alvosDeRelogio({ conversa, politica, ctx, instante, expediente, podeArmar }) {
  const base = {
    tenantId: politica.tenantId,
    cwAccountId: conversa.cwAccountId,
    cwConversationId: conversa.id,
    politicaId: politica.id,
  };
  const alvos = [];

  const chaveDe = (tipo) => chaveRelogio({ cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id, tipo });
  const encerrar = (tipo, motivo) => ({ ...base, tipo, chave: chaveDe(tipo), encerrar: true, motivo });

  // ── INATIVIDADE e AVISO — só valem para conversa EM ATENDIMENTO (`open`) ────────────────────
  // Em `pending` a conversa já está na fila: devolvê-la para a fila de novo não é ação, é ruído. E
  // em `resolved`/`snoozed` não há atendimento para vigiar.
  const emAtendimento = conversa.status === 'open';
  const querInatividade = politica.inatividadeAtiva === true && Number(politica.inatividadeMinutos) > 0;

  if (!emAtendimento || !querInatividade) {
    alvos.push(encerrar(TIPOS_RELOGIO.INATIVIDADE, !emAtendimento ? 'conversa fora de atendimento' : 'relógio desligado na política'));
    alvos.push(encerrar(TIPOS_RELOGIO.AVISO, 'sem relógio de inatividade'));
  } else {
    const lado = ladoDoSilencio(conversa, politica.inatividadeConta);
    if (!lado) {
      // Não é candidata a ESTE lado do silêncio. Encerrar o ciclo é o certo: manter o prazo antigo
      // faria o relógio do «atendente sumiu» disparar depois que o atendente já respondeu.
      alvos.push(encerrar(TIPOS_RELOGIO.INATIVIDADE, `sem silêncio do lado "${politica.inatividadeConta || 'qualquer'}"`));
      alvos.push(encerrar(TIPOS_RELOGIO.AVISO, 'sem silêncio a medir'));
    } else if (!podeArmar) {
      // §5.3: o fluxo está vivo e o prazo é dele. O relógio existe, mas congelado e com o motivo
      // escrito — «por que essa conversa não voltou» tem de ter resposta.
      const prazo = calcularPrazo({ desde: instante, minutos: Number(politica.inatividadeMinutos), ctx, instante, expediente });
      alvos.push({
        ...base, tipo: TIPOS_RELOGIO.INATIVIDADE, chave: chaveDe(TIPOS_RELOGIO.INATIVIDADE),
        ultimaAtividadeEm: lado.desde, ultimaAtividadeLado: lado.lado,
        venceEm: prazo.venceEm, pausadoMotivo: MOTIVOS_PAUSA.FLUXO_ATIVO,
      });
      alvos.push(encerrar(TIPOS_RELOGIO.AVISO, 'fluxo de conversa ativo'));
    } else {
      const prazo = calcularPrazo({ desde: lado.desde, minutos: Number(politica.inatividadeMinutos), ctx, instante, expediente });
      alvos.push({
        ...base, tipo: TIPOS_RELOGIO.INATIVIDADE, chave: chaveDe(TIPOS_RELOGIO.INATIVIDADE),
        ultimaAtividadeEm: lado.desde, ultimaAtividadeLado: lado.lado,
        venceEm: prazo.venceEm, pausadoMotivo: prazo.pausadoMotivo,
      });

      // O aviso só existe se couber ANTES da ação. Aviso com prazo maior ou igual ao da ação sairia
      // junto com a devolução para a fila — o cliente leria «ainda está aí?» e, no mesmo minuto,
      // «você voltou para a fila». Configuração assim é engano, e o lugar de tratá-la é aqui.
      const avisoMin = Number(politica.inatividadeAvisoMinutos);
      if (avisoMin > 0 && avisoMin < Number(politica.inatividadeMinutos) && politica.inatividadeAvisoMensagem) {
        const pAviso = calcularPrazo({ desde: lado.desde, minutos: avisoMin, ctx, instante, expediente });
        alvos.push({
          ...base, tipo: TIPOS_RELOGIO.AVISO, chave: chaveDe(TIPOS_RELOGIO.AVISO),
          ultimaAtividadeEm: lado.desde, ultimaAtividadeLado: lado.lado,
          venceEm: pAviso.venceEm, pausadoMotivo: pAviso.pausadoMotivo,
        });
      } else {
        alvos.push(encerrar(TIPOS_RELOGIO.AVISO, 'aviso não configurado ou não cabe antes da ação'));
      }
    }
  }

  // ── TRANSBORDO — o `timeToTransfer` da origem: ninguém assumiu em X minutos ──────────────────
  // Vale para quem está NA FILA (`pending`) e sem dono. Assim que alguém assume, o ciclo encerra —
  // transferir de setor uma conversa que acabou de ser assumida é roubá-la da analista.
  const naFila = conversa.status === 'pending' || (conversa.status === 'open' && conversa.cwAssigneeId == null);
  const querTransbordo = politica.transbordoAtivo === true
    && Number(politica.transbordoMinutos) > 0
    && politica.transbordoTimeId != null;

  if (naFila && querTransbordo && conversa.cwAssigneeId == null) {
    const desde = normalizarData(conversa.waitingSince) || normalizarData(conversa.statusChangedAt)
      || normalizarData(conversa.lastActivityAt) || instante;
    const prazo = calcularPrazo({ desde, minutos: Number(politica.transbordoMinutos), ctx, instante, expediente });
    alvos.push({
      ...base, tipo: TIPOS_RELOGIO.TRANSBORDO, chave: chaveDe(TIPOS_RELOGIO.TRANSBORDO),
      ultimaAtividadeEm: desde, ultimaAtividadeLado: 'contato',
      venceEm: prazo.venceEm, pausadoMotivo: prazo.pausadoMotivo,
    });
  } else {
    alvos.push(encerrar(TIPOS_RELOGIO.TRANSBORDO, conversa.cwAssigneeId != null ? 'alguém assumiu' : 'transbordo desligado na política'));
  }

  return alvos;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FASE B — DISPARO: quem venceu, e o que fazer
//
// A sequência é sempre a mesma, e a ordem importa:
//   1. RESERVA condicional  (dois processos nunca pegam a mesma linha)
//   2. RELÊ a conversa      (o estado pode ter mudado desde a última varredura)
//   3. DESCARTA se obsoleto (o cliente respondeu antes do prazo)
//   4. RECUSA se fechado    (não devolver para a fila às 3 da manhã)
//   5. CONVERGE ou AGE      (se já está no estado-alvo, não repete a mensagem)
//   6. REGISTRA             (auditoria sempre, transferência quando for o caso)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Reserva o disparo. Escrita CONDICIONAL: o `disparadoEm: null` no WHERE é o que faz dois
 * trabalhadores nunca aplicarem a mesma ação. Quem escreve, age; quem não escreve, segue em frente
 * sem reclamar — não é erro, é outro processo tendo chegado primeiro.
 */
async function reservarDisparo(relogio, instante, workerId) {
  const r = await db().ragnabotAtendRelogio.updateMany({
    where: { id: relogio.id, disparadoEm: null },
    data: { disparadoEm: instante, resultado: RESULTADOS.EM_CURSO, erro: `worker:${workerId}` },
  });
  return (r?.count ?? 0) === 1;
}

/** Devolve a linha ao estado ARMADO. Usado quando o disparo foi reservado mas nada aconteceu do
 *  lado de fora — obsoleto, fora de expediente, ou fluxo do robô voltou a correr. Reverter é seguro
 *  exatamente porque nenhum efeito externo saiu. */
async function reArmar(relogio, { venceEm, pausadoMotivo = null, ultimaAtividadeEm = null, ultimaAtividadeLado = null }) {
  await db().ragnabotAtendRelogio.update({
    where: { id: relogio.id },
    data: {
      disparadoEm: null, resultado: null, erro: null,
      venceEm,
      pausadoMotivo,
      ...(ultimaAtividadeEm ? { ultimaAtividadeEm } : {}),
      ...(ultimaAtividadeLado ? { ultimaAtividadeLado } : {}),
    },
  });
}

async function fecharDisparo(relogio, resultado, erro = null) {
  await db().ragnabotAtendRelogio.update({
    where: { id: relogio.id },
    data: { resultado, erro: erro ? String(erro).slice(0, 500) : null },
  });
}

/**
 * O estado-alvo já foi atingido? É a terceira camada da proteção contra ação duplicada depois de um
 * reinício (armadilha A3). Se a conversa já está onde a ação a levaria, damos por cumprido e — o
 * que mais importa — a mensagem ao cliente NÃO sai de novo.
 */
export function estadoAlvoJaAtingido(conversa, acao, alvoTimeId = null) {
  if (!conversa) return false;
  if (acao === 'devolver_fila') return conversa.status === 'pending' && conversa.cwAssigneeId == null;
  if (acao === 'resolver') return conversa.status === 'resolved';
  if (acao === 'transferir_time') return alvoTimeId != null && conversa.cwTeamId === alvoTimeId;
  return false; // 'notificar' e as mensagens não têm estado observável: nunca convergem sozinhas
}

/** Qual ação cada tipo de relógio executa. */
function acaoDoRelogio(tipo, politica) {
  if (tipo === TIPOS_RELOGIO.TRANSBORDO) return 'transferir_time';
  if (tipo === TIPOS_RELOGIO.AVISO) return 'avisar';
  // Segunda trava, de propósito: mesmo que uma linha de CARIMBO chegue aqui por algum caminho novo,
  // ela não vira ação sobre a conversa. O `null` é tratado por quem chama como "nada a fazer".
  if (!TIPOS_DE_PRAZO.includes(tipo)) return null;
  return politica.inatividadeAcao || 'devolver_fila';
}

/** Envia texto ao cliente pelo caminho que respeita a janela de 24 h.
 *  §5.6: fora da janela, a AÇÃO DE ESTADO acontece e a mensagem não — e o motivo fica escrito. Por
 *  isso a falha de envio nunca derruba o disparo: devolve o motivo, e quem chama registra. */
async function enviarAoCliente({ conversa, texto, politica, motivo }) {
  if (!texto) return { enviado: false, motivo: 'sem texto configurado' };
  const cw = portas.chatwoot;
  if (!cw?.enviarMensagem) return { enviado: false, motivo: 'porta de mensagem ausente' };
  try {
    const r = await cw.enviarMensagem({
      cwAccountId: conversa.cwAccountId,
      cwConversationId: conversa.id,
      texto,
      tenantId: politica.tenantId,
      origem: motivo,
    });
    if (r === false || r?.ok === false) return { enviado: false, motivo: r?.motivo || 'o canal recusou o envio' };
    return { enviado: true, motivo: null };
  } catch (e) {
    return { enviado: false, motivo: e.message };
  }
}

/** Nota interna. É onde o motivo de uma mensagem NÃO enviada fica visível para o atendente que
 *  abrir a conversa — sem isso, o cliente foi devolvido para a fila em silêncio e ninguém sabe. */
async function anotar({ conversa, texto, politica }) {
  const cw = portas.chatwoot;
  if (!cw?.notaInterna || !texto) return;
  try {
    await cw.notaInterna({
      cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id,
      texto, tenantId: politica.tenantId,
    });
  } catch (e) { log().warn?.(`[atend-worker] nota interna falhou: ${e.message}`); }
}

/**
 * Aplica a ação de um relógio vencido. Devolve `{resultado, detalhe}` — nunca lança por falha de
 * ação: falha vira `resultado='erro'` com o motivo gravado, e a linha fica disponível para leitura
 * humana. Trabalhador que morre por causa de uma conversa deixa as outras 399 sem relógio.
 */
async function aplicarAcao({ relogio, conversa, politica, ctx, instante }) {
  const acao = acaoDoRelogio(relogio.tipo, politica);
  // Tipo que não é relógio de prazo (carimbo) não tem ação. Sai como SEM_ACAO e não como ERRO:
  // não há nada errado acontecendo — é uma linha que simplesmente não se dispara.
  if (acao === null) {
    return { resultado: RESULTADOS.SEM_ACAO, detalhe: `tipo "${relogio.tipo}" é carimbo, não relógio de prazo` };
  }
  const cw = portas.chatwoot;

  // ── AVISO: só fala, não mexe no estado. «Ainda está aí?» antes de devolver para a fila ────────
  if (acao === 'avisar') {
    const env = await enviarAoCliente({ conversa, texto: politica.inatividadeAvisoMensagem, politica, motivo: 'aviso_inatividade' });
    if (!env.enviado) return { resultado: RESULTADOS.ERRO, detalhe: `aviso não enviado: ${env.motivo}` };
    return { resultado: RESULTADOS.APLICADO, detalhe: 'aviso enviado' };
  }

  // ── Interruptor de emergência: ação que ATRIBUI alguém não roda com a distribuição pausada ────
  const pausaViva = politica.distribuicaoPausada === true
    && (!politica.pausadaAte || new Date(politica.pausadaAte) > instante);
  if (pausaViva && (acao === 'transferir_time')) {
    return { resultado: RESULTADOS.RECUSADO_PAUSA, detalhe: politica.pausadaMotivo || 'distribuição pausada' };
  }

  const alvoTime = relogio.tipo === TIPOS_RELOGIO.TRANSBORDO
    ? politica.transbordoTimeId
    : politica.inatividadeTimeDestino;

  // ⚠️ A ORIGEM DA TRANSFERÊNCIA É FOTOGRAFADA ANTES DE AGIR.
  // Lê-la depois é ler o destino: a porta do Chatwoot pode devolver (ou mutar) o mesmo objeto de
  // conversa já atualizado, e o registro sairia dizendo «passou do time 7 para o time 7». O teste
  // do transbordo pegou exatamente isso. Um registro de transferência que não sabe de onde veio não
  // responde à pergunta para a qual ele existe.
  const origemDaConversa = {
    tipo: conversa.cwTeamId != null ? 'time' : (conversa.cwAssigneeId != null ? 'agente' : 'ninguem'),
    id: conversa.cwTeamId ?? conversa.cwAssigneeId ?? null,
  };

  // ── Convergência: já está no estado-alvo? Então a ação foi cumprida (talvez por nós, antes de um
  //    reinício; talvez por um atendente). Não repetir a mensagem é o ponto todo desta verificação.
  if (estadoAlvoJaAtingido(conversa, acao, alvoTime)) {
    return { resultado: RESULTADOS.APLICADO, detalhe: 'estado-alvo já atingido — ação dada por cumprida, sem repetir a mensagem' };
  }

  // ── Texto ao cliente. Quem entrou na fila e desistiu (nenhum atendente falou nesta conversa)
  //    recebe a despedida própria, e não o texto de «você voltou para a fila» — que não faz sentido
  //    para quem nunca foi atendido. É o `sendFarewellWaitingTicket` da origem, de carona no relógio.
  const nuncaAtendida = !conversa.firstReplyCreatedAt && conversa.cwAssigneeId == null;
  const textoPadrao = relogio.tipo === TIPOS_RELOGIO.TRANSBORDO
    ? (politica.transbordoMensagem || politica.msgTransferenciaTime)
    : (nuncaAtendida && politica.msgDespedidaEspera ? politica.msgDespedidaEspera : politica.inatividadeMensagem);

  let feito = false;
  let detalhe = '';
  try {
    if (acao === 'devolver_fila') {
      if (!cw?.devolverParaFila) return { resultado: RESULTADOS.ERRO, detalhe: 'porta devolverParaFila ausente' };
      await cw.devolverParaFila({
        cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id, tenantId: politica.tenantId,
      });
      feito = true; detalhe = 'conversa devolvida para a fila (pending) e sem responsável';
    } else if (acao === 'transferir_time') {
      if (alvoTime == null) return { resultado: RESULTADOS.ERRO, detalhe: 'ação transferir_time sem time de destino configurado' };
      if (!cw?.transferirTime) return { resultado: RESULTADOS.ERRO, detalhe: 'porta transferirTime ausente' };
      await cw.transferirTime({
        cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id,
        cwTeamId: alvoTime, tenantId: politica.tenantId,
      });
      feito = true; detalhe = `conversa transferida para o time ${alvoTime}`;
      await registrarTransferencia({
        tenantId: politica.tenantId,
        cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id,
        deTipo: origemDaConversa.tipo,
        deId: origemDaConversa.id,
        paraTipo: 'time', paraId: alvoTime,
        motivo: relogio.tipo === TIPOS_RELOGIO.TRANSBORDO ? 'tempo em fila excedido' : 'inatividade',
        origem: relogio.tipo === TIPOS_RELOGIO.TRANSBORDO ? 'transbordo' : 'inatividade',
        atorUserId: null,
      });
    } else if (acao === 'resolver') {
      if (!cw?.resolver) return { resultado: RESULTADOS.ERRO, detalhe: 'porta resolver ausente' };
      await cw.resolver({ cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id, tenantId: politica.tenantId });
      feito = true; detalhe = 'conversa resolvida por inatividade';
    } else if (acao === 'notificar') {
      // §5.6: sai pelo nó `notificar` do motor, com destinatário por PAPEL — nunca número cravado.
      if (!portas.fila?.enfileirar) return { resultado: RESULTADOS.ERRO, detalhe: 'porta da fila ausente para notificar' };
      await portas.fila.enfileirar({
        tipo: 'atend_relogio',
        chaveParticao: chaveParticaoDe({ cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id }),
        tenantId: politica.tenantId, prioridade: 80,
        payload: { acao: 'notificar', relogioId: relogio.id, politicaId: politica.id, cwConversationId: conversa.id },
      });
      feito = true; detalhe = 'notificação enfileirada';
    } else {
      return { resultado: RESULTADOS.ERRO, detalhe: `ação desconhecida: ${acao}` };
    }
  } catch (e) {
    return { resultado: RESULTADOS.ERRO, detalhe: `falha ao aplicar "${acao}": ${e.message}` };
  }

  // A mensagem sai DEPOIS da mudança de estado, e a falha dela não desfaz a mudança: o cliente na
  // fila com aviso não entregue é recuperável; o cliente com aviso entregue e ainda preso num
  // atendimento morto, não.
  // ⚠️ `notificar` NÃO envia por aqui — de propósito, e isto foi um defeito real pego na revisão
  // de 29/08. O ramo `notificar` acima só ENFILEIRA (`atend_relogio`); quem manda o texto é o
  // consumidor `ragnabot-atend-despertar.service.js`. Sem esta exclusão, ligar o consumidor faria o
  // cliente receber a MESMA mensagem duas vezes — e por dois caminhos diferentes, sendo que este
  // atalho aqui NÃO confere a janela de 24 h do WhatsApp. O caminho do §5.6 (consumidor) confere a
  // janela, é idempotente por efeito reservado e escreve a nota interna quando a mensagem não sai.
  if (feito && textoPadrao && acao !== 'notificar') {
    const env = await enviarAoCliente({ conversa, texto: textoPadrao, politica, motivo: `relogio_${relogio.tipo}` });
    if (!env.enviado) {
      detalhe += ` · mensagem NÃO enviada (${env.motivo})`;
      await anotar({
        conversa, politica,
        texto: `Automação: ${detalhe}. O texto para o cliente não saiu — motivo: ${env.motivo}.`,
      });
    }
  }
  return { resultado: RESULTADOS.APLICADO, detalhe };
}

/**
 * Varre os relógios vencidos e aplica cada um.
 * @returns {{vistos:number, aplicados:number, obsoletos:number, recusados:number, semAcao:number, erros:number, disputados:number}}
 */
export async function dispararVencidos({ limite = 50, workerId = 'atend-worker' } = {}) {
  const resumo = { vistos: 0, aplicados: 0, obsoletos: 0, recusados: 0, semAcao: 0, erros: 0, disputados: 0 };
  const indice = await carregarIndiceDePoliticas();
  if (!indice.total) return resumo;
  const instante = await agora();

  // O índice `@@index([venceEm, disparadoEm])` do §4.5 existe exatamente para esta consulta.
  const vencidos = await db().ragnabotAtendRelogio.findMany({
    // `tipo` filtrado pelo mesmo motivo do ceifador: carimbo nasce com `venceEm` no passado e
    // casaria com esta consulta para sempre. Ver TIPOS_DE_PRAZO.
    where: { venceEm: { lte: instante }, disparadoEm: null, tipo: { in: TIPOS_DE_PRAZO } },
    orderBy: { venceEm: 'asc' },
    take: limite,
  });
  resumo.vistos = vencidos.length;

  for (const relogio of vencidos) {
    try {
      if (!(await reservarDisparo(relogio, instante, workerId))) { resumo.disputados += 1; continue; }

      const cw = portas.chatwoot;
      const conversa = cw?.lerConversa
        ? await cw.lerConversa({ cwAccountId: relogio.cwAccountId, cwConversationId: relogio.cwConversationId })
        : null;

      if (!conversa) {
        // Conversa ilegível ou apagada. `SEM_ACAO` e não `erro`: não há defeito a corrigir, e marcar
        // como erro encheria a tela de diagnóstico de linhas que ninguém pode resolver.
        await fecharDisparo(relogio, RESULTADOS.SEM_ACAO, 'conversa não encontrada na plataforma');
        resumo.semAcao += 1;
        continue;
      }

      const efetiva = politicaEfetivaPara(indice, { ...conversa, cwAccountId: relogio.cwAccountId });
      if (!efetiva) {
        await fecharDisparo(relogio, RESULTADOS.SEM_ACAO, 'nenhuma política ativa alcança esta conversa');
        resumo.semAcao += 1;
        continue;
      }
      const { politica, ctx } = efetiva;

      // ── 3. OBSOLETO: o cliente (ou o atendente) falou antes do prazo ────────────────────────
      // Mesmo raciocínio do `tokenVisita` do motor: resposta e expiração mandariam a conversa por
      // dois caminhos ao mesmo tempo. Aqui o «token» é a marca de atividade que gravamos ao armar.
      const lado = ladoDoSilencio(conversa, politica.inatividadeConta);
      const houveAtividadeNova = lado
        && new Date(lado.desde).getTime() > new Date(relogio.ultimaAtividadeEm).getTime() + TOLERANCIA_ATIVIDADE_MS;
      if (houveAtividadeNova) {
        // ⚠️ DEFEITO REAL CORRIGIDO EM 29/08/2026 (auditoria adversarial). Antes eram só dois
        // ramos — AVISO ou "o resto" —, e o TRANSBORDO caía no "resto", sendo re-armado com
        // `inatividadeMinutos`. Numa política de transbordo puro (`transbordoAtivo: true`,
        // `inatividadeAtiva: false`) esse campo é NULO, e `Number(null)` é ZERO: o prazo virava o
        // próprio instante e o transbordo disparava IMEDIATAMENTE assim que o cliente falasse —
        // transferindo de setor uma conversa que acabara de receber atenção. Cada tipo re-arma com
        // o SEU minuto.
        const minutos = relogio.tipo === TIPOS_RELOGIO.AVISO
          ? Number(politica.inatividadeAvisoMinutos)
          : relogio.tipo === TIPOS_RELOGIO.TRANSBORDO
            ? Number(politica.transbordoMinutos)
            : Number(politica.inatividadeMinutos);
        const expediente = expedienteAgora(ctx, instante);
        const prazo = calcularPrazo({ desde: lado.desde, minutos, ctx, instante, expediente });
        await reArmar(relogio, { venceEm: prazo.venceEm, pausadoMotivo: prazo.pausadoMotivo, ultimaAtividadeEm: lado.desde, ultimaAtividadeLado: lado.lado });
        resumo.obsoletos += 1;
        continue;
      }

      // ── 4. FORA DE EXPEDIENTE: adia para a próxima abertura ─────────────────────────────────
      // É a armadilha A1 pela segunda vez: mesmo com o prazo calculado em minutos úteis, uma janela
      // pode ter mudado (feriado cadastrado depois) entre armar e vencer. A recusa aqui é o cinto.
      const expediente = expedienteAgora(ctx, instante);
      if (!ctx.contaForaExpediente && !expediente.aberto) {
        const proxima = expediente.proximaAbertura || somarMs(instante, 60 * 60_000);
        await reArmar(relogio, {
          venceEm: proxima,
          pausadoMotivo: expediente.motivo === MOTIVOS_EXPEDIENTE.INTERVALO ? MOTIVOS_PAUSA.INTERVALO
            : expediente.motivo === MOTIVOS_EXPEDIENTE.FERIADO ? MOTIVOS_PAUSA.FERIADO : MOTIVOS_PAUSA.FORA_EXPEDIENTE,
        });
        resumo.recusados += 1;
        continue;
      }

      // ── 5. FLUXO VIVO: o prazo voltou a ser do robô (§5.3) ──────────────────────────────────
      const execucao = await db().ragnabotFluxoExecucao.findFirst({
        where: {
          cwAccountId: relogio.cwAccountId, cwConversationId: relogio.cwConversationId,
          estado: { in: ESTADOS_ATIVOS_DO_FLUXO },
        },
        select: { estado: true },
      }).catch(() => null);
      if (!podeArmarRelogio(execucao)) {
        const minutos = Number(politica.inatividadeMinutos) || 30;
        await reArmar(relogio, { venceEm: somarMinutosUteis(instante, minutos, ctx), pausadoMotivo: MOTIVOS_PAUSA.FLUXO_ATIVO });
        resumo.recusados += 1;
        continue;
      }

      // ── 6. AGE ──────────────────────────────────────────────────────────────────────────────
      // Fotografia do estado ANTES de agir: a porta pode entregar de volta o objeto já atualizado, e
      // uma auditoria cujo «antes» é igual ao «depois» não registra nada.
      const estadoAntes = { status: conversa.status, responsavel: conversa.cwAssigneeId ?? null, time: conversa.cwTeamId ?? null };
      const r = await aplicarAcao({ relogio, conversa, politica, ctx, instante });
      await fecharDisparo(relogio, r.resultado, r.detalhe);
      if (r.resultado === RESULTADOS.APLICADO) resumo.aplicados += 1;
      else if (r.resultado === RESULTADOS.ERRO) resumo.erros += 1;
      else resumo.recusados += 1;

      await auditar({
        tenantId: relogio.tenantId,
        acao: `atendimento.relogio.${relogio.tipo}`,
        descricao: `Relógio de ${relogio.tipo} venceu na conversa ${relogio.cwConversationId}: ${r.detalhe}`,
        entidade: 'conversa', entidadeId: relogio.cwConversationId,
        antes: estadoAntes,
        depois: { resultado: r.resultado, acao: acaoDoRelogio(relogio.tipo, politica), politicaId: politica.id },
      });
    } catch (e) {
      resumo.erros += 1;
      log().error?.(`[atend-worker] falha no relógio ${relogio.id}: ${e.message}`);
      await fecharDisparo(relogio, RESULTADOS.ERRO, e.message).catch(() => {});
    }
  }
  return resumo;
}

/**
 * CEIFADOR — reabre disparo preso em `em_curso`.
 *
 * Trabalho preso é o sintoma exato de um processo que morreu segurando a conversa. Deixá-lo parado
 * seria a conversa que nunca volta para a fila; reabri-lo é seguro porque a segunda passada relê o
 * estado e converge (armadilha A3, camadas b e c).
 */
export async function ceifarDisparosPresos({ minutos = CEIFADOR_MINUTOS } = {}) {
  const instante = await agora();
  const corte = somarMs(instante, -emMs(minutos));
  const presos = await db().ragnabotAtendRelogio.findMany({
    // `tipo` filtrado: carimbo (fora_expediente/despedida_espera) NÃO se reabre — ver TIPOS_DE_PRAZO.
    where: { resultado: RESULTADOS.EM_CURSO, disparadoEm: { lt: corte }, tipo: { in: TIPOS_DE_PRAZO } },
    take: 200,
  });
  for (const r of presos) {
    await db().ragnabotAtendRelogio.update({
      where: { id: r.id },
      data: { disparadoEm: null, resultado: null, erro: `reaberto pelo ceifador (preso em "em_curso" desde ${new Date(r.disparadoEm).toISOString()})` },
    });
    log().warn?.(`[atend-worker] ceifador reabriu o relógio ${r.id} (conversa ${r.cwConversationId})`);
  }
  return { reabertos: presos.length };
}

/**
 * Pausa de emergência com prazo vencido volta sozinha.
 *
 * Pausa sem hora de volta é pausa que alguém esquece ligada — e ninguém descobre até o cliente
 * reclamar. É o mesmo remédio do `reactivateExpiredSilences` do NOC, e pela mesma razão.
 */
export async function expirarPausasDeDistribuicao() {
  const instante = await agora();
  const vencidas = await db().ragnabotAtendPolitica.findMany({
    where: { distribuicaoPausada: true, pausadaAte: { lte: instante } },
  });
  for (const p of vencidas) {
    await db().ragnabotAtendPolitica.update({
      where: { id: p.id },
      data: { distribuicaoPausada: false, pausadaAte: null, pausadaMotivo: null },
    });
    await auditar({
      tenantId: p.tenantId,
      acao: 'atendimento.distribuicao.retomada',
      descricao: `A pausa de emergência da distribuição venceu e foi retomada automaticamente (motivo registrado: ${p.pausadaMotivo || 'não informado'}).`,
      entidade: 'politica', entidadeId: p.id,
      antes: { distribuicaoPausada: true, pausadaAte: p.pausadaAte, pausadaMotivo: p.pausadaMotivo },
      depois: { distribuicaoPausada: false },
    });
    log().info?.(`[atend-worker] pausa de distribuição expirou na política ${p.escopoChave} — retomada`);
  }
  return { retomadas: vencidas.length };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FASE C — A VIRADA DO EXPEDIENTE
//
// Fechou: quem estava em atendimento recebe o texto certo (fora de hora, intervalo ou feriado) e,
// se a política mandar, a conversa é encerrada. Abriu: só o registro — os prazos já voltam a andar
// sozinhos, porque o cálculo é em minutos úteis (não há «descongelar» a fazer).
//
// ⚠️ COMO A REPETIÇÃO É EVITADA, e por que não basta uma variável no processo: o marcador da última
// virada é uma linha de `RagnabotAuditoria`, e o «já avisei esta conversa hoje» é uma linha de
// `RagnabotAtendRelogio` com a DATA na chave única. Os dois são duráveis. Um `let ultimoEstado` em
// memória seria zerado por qualquer reinício — e foi exatamente esse defeito que, no NOC, mandou o
// resumo matinal duas vezes no WhatsApp (corrigido na v1.40.50, persistindo em Settings).
// ════════════════════════════════════════════════════════════════════════════════════════════════

const ACAO_MARCADOR_VIRADA = 'atendimento.expediente.virada';

async function lerMarcadorDeVirada(politicaId) {
  try {
    return await db().ragnabotAuditoria.findFirst({
      where: { acao: ACAO_MARCADOR_VIRADA, entidade: 'politica', entidadeId: String(politicaId) },
      orderBy: { criadoEm: 'desc' },
    });
  } catch { return null; }
}

/** Texto certo para cada motivo. Intervalo NÃO cai no texto de fora de expediente: dizer «estamos
 *  fechados» às 12h é mentira, e o cliente que viu a empresa respondendo às 11h59 percebe. */
export function mensagemDaVirada(politica, motivo) {
  if (motivo === MOTIVOS_EXPEDIENTE.FERIADO) return politica.msgFeriado || politica.msgForaExpediente || null;
  if (motivo === MOTIVOS_EXPEDIENTE.INTERVALO) return politica.msgIntervalo || null;
  if (motivo === MOTIVOS_EXPEDIENTE.FORA_HORA) return politica.msgForaExpediente || null;
  return null;
}

/**
 * Uma rodada da virada do expediente.
 * @returns {{politicas:number, viradas:number, avisadas:number, encerradas:number}}
 */
export async function tratarViradaDeExpediente({ limitePorConta = 500 } = {}) {
  const resumo = { politicas: 0, viradas: 0, avisadas: 0, encerradas: 0 };
  const cw = portas.chatwoot;
  if (!cw?.conversasEmAtendimento) return resumo;

  const indice = await carregarIndiceDePoliticas();
  if (!indice.total) return resumo;
  const instante = await agora();

  for (const [cwAccountId] of indice.contas) {
    const conversas = await cw.conversasEmAtendimento({ cwAccountId, limite: limitePorConta });
    if (!conversas?.length) continue;

    // Agrupa por POLÍTICA EFETIVA: duas conversas da mesma caixa compartilham o expediente, mas uma
    // conversa de um setor com horário próprio não pode ser avisada pela virada da empresa.
    const grupos = new Map();
    for (const conversa of conversas) {
      const efetiva = politicaEfetivaPara(indice, conversa);
      if (!efetiva) continue;
      const chave = efetiva.politica.id;
      if (!grupos.has(chave)) grupos.set(chave, { ...efetiva, conversas: [] });
      grupos.get(chave).conversas.push(conversa);
    }

    for (const [politicaId, grupo] of grupos) {
      resumo.politicas += 1;
      const { politica, ctx } = grupo;
      const expediente = expedienteAgora(ctx, instante);
      const estadoAgora = expediente.aberto ? MOTIVOS_EXPEDIENTE.ABERTO : expediente.motivo;

      const marcador = await lerMarcadorDeVirada(politicaId);
      const estadoAnterior = marcador?.depois?.estado ?? null;
      if (estadoAnterior === estadoAgora) continue; // nada virou

      // PRIMEIRA OBSERVAÇÃO NÃO É VIRADA. Sem esta guarda, o primeiro tique depois de uma
      // implantação dispararia a mensagem de fora de expediente para TODA conversa aberta de TODA
      // empresa — de uma vez, e sem que nada tivesse mudado de verdade.
      const primeiraObservacao = marcador == null;

      await auditar({
        tenantId: politica.tenantId,
        acao: ACAO_MARCADOR_VIRADA,
        descricao: primeiraObservacao
          ? `Primeira leitura do expediente desta política: ${estadoAgora}. Nenhuma mensagem enviada — primeira observação não é virada.`
          : `Expediente virou de "${estadoAnterior}" para "${estadoAgora}".`,
        entidade: 'politica', entidadeId: politicaId,
        antes: { estado: estadoAnterior },
        depois: { estado: estadoAgora, proximaAbertura: expediente.proximaAbertura ?? null },
      });
      if (primeiraObservacao) continue;
      resumo.viradas += 1;

      if (expediente.aberto) continue; // abriu: nada a fazer com as conversas

      const texto = mensagemDaVirada(politica, expediente.motivo);
      const podeEncerrar = politica.encerrarAposForaExpediente === true
        && expediente.motivo !== MOTIVOS_EXPEDIENTE.INTERVALO; // ninguém encerra conversa no almoço
      if (!texto && !podeEncerrar) continue;

      const dia = partesNoFuso(instante, ctx.fuso).chaveData;
      for (const conversa of grupo.conversas) {
        if (conversa.status !== 'open' && conversa.status !== 'pending') continue;
        const r = await avisarUmaVezPorDia({ conversa, politica, texto, dia, motivo: expediente.motivo, instante, podeEncerrar });
        if (r.avisada) resumo.avisadas += 1;
        if (r.encerrada) resumo.encerradas += 1;
      }
    }
  }
  return resumo;
}

/**
 * Avisa a conversa UMA VEZ POR DIA, e a garantia é do banco, não do código.
 *
 * O carimbo é uma linha de `RagnabotAtendRelogio` cuja `chave` única carrega a data. Criar a linha
 * é a reserva; se o `create` bater no índice único, alguém já avisou hoje — e isso é resposta, não
 * erro. Em seguida a mensagem sai e a linha é confirmada. Duas fases, pela mesma razão da caixa de
 * saída do motor: uma queda entre avisar e registrar mandaria o texto duas vezes SEM registro de
 * que saiu uma vez.
 */
async function avisarUmaVezPorDia({ conversa, politica, texto, dia, motivo, instante, podeEncerrar }) {
  const chave = chaveRelogio({
    cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id,
    tipo: TIPOS_RELOGIO.FORA_EXPEDIENTE, sufixo: `${motivo}:${dia}`,
  });
  let carimbo;
  try {
    carimbo = await db().ragnabotAtendRelogio.create({
      data: {
        chave, tenantId: politica.tenantId,
        cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id,
        politicaId: politica.id, tipo: TIPOS_RELOGIO.FORA_EXPEDIENTE,
        ultimaAtividadeEm: normalizarData(conversa.lastActivityAt) || instante,
        ultimaAtividadeLado: 'sistema',
        venceEm: instante, disparadoEm: instante, resultado: RESULTADOS.EM_CURSO,
      },
    });
  } catch {
    return { avisada: false, encerrada: false }; // já avisada hoje — o índice único respondeu
  }

  let avisada = false;
  let encerrada = false;
  let detalhe = '';

  if (texto) {
    const env = await enviarAoCliente({ conversa, texto, politica, motivo: `expediente_${motivo}` });
    avisada = env.enviado;
    detalhe = env.enviado ? 'mensagem de expediente enviada' : `mensagem NÃO enviada (${env.motivo})`;
  } else {
    detalhe = 'sem texto configurado para este motivo';
  }

  if (podeEncerrar && portas.chatwoot?.resolver) {
    try {
      await portas.chatwoot.resolver({ cwAccountId: conversa.cwAccountId, cwConversationId: conversa.id, tenantId: politica.tenantId });
      encerrada = true;
      detalhe += ' · conversa encerrada por fim de expediente';
    } catch (e) { detalhe += ` · falha ao encerrar: ${e.message}`; }
  }

  await db().ragnabotAtendRelogio.update({
    where: { id: carimbo.id },
    data: { resultado: avisada || encerrada ? RESULTADOS.APLICADO : RESULTADOS.ERRO, erro: detalhe.slice(0, 500) },
  }).catch(() => {});

  await auditar({
    tenantId: politica.tenantId,
    acao: `atendimento.expediente.${motivo}`,
    descricao: `Conversa ${conversa.id}: ${detalhe}`,
    entidade: 'conversa', entidadeId: conversa.id,
    antes: { status: conversa.status },
    depois: { avisada, encerrada, politicaId: politica.id, dia },
  });

  return { avisada, encerrada };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A RODADA — a ordem das fases não é arbitrária
//
//   1. pausas vencidas   → uma política ainda pausada recusaria transferências desta mesma rodada
//   2. reconciliação     → os prazos ficam certos ANTES de alguém decidir quem venceu
//   3. ceifador          → trabalho preso volta a ser candidato JÁ nesta rodada, não na próxima
//   4. disparo           → aplica
//   5. virada            → por último: encerrar conversa no fim do expediente é a ação mais
//                          agressiva do trabalhador, e ela não deve competir com o disparo pela
//                          mesma conversa no mesmo tique
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Trava de reentrância. Um tique que demore mais que o intervalo NÃO pode se sobrepor ao seguinte:
 *  duas rodadas simultâneas no mesmo processo é a receita para dois disparos da mesma conversa —
 *  e a reserva condicional protegeria o banco, mas o log ficaria ilegível e o trabalho, dobrado. */
let rodadaEmCurso = false;

/**
 * Uma rodada completa. É esta função que o processo chama a cada 60 segundos.
 * Nunca lança: uma exceção aqui derrubaria o `setInterval` do processo e o trabalhador pararia em
 * silêncio — que é a pior falha possível num relógio.
 */
export async function rodarTrabalhadorDeAtendimento({ workerId = 'atend-worker', limite = 50, limitePorConta = 500 } = {}) {
  if (rodadaEmCurso) {
    log().warn?.('[atend-worker] rodada anterior ainda em curso — este tique foi pulado');
    return { pulado: true };
  }
  rodadaEmCurso = true;
  const inicio = Date.now();
  const resumo = { pulado: false };
  try {
    resumo.pausas = await expirarPausasDeDistribuicao().catch((e) => { log().error?.(`[atend-worker] pausas: ${e.message}`); return null; });
    resumo.reconciliacao = await reconciliarRelogios({ limitePorConta }).catch((e) => { log().error?.(`[atend-worker] reconciliação: ${e.message}`); return null; });
    resumo.ceifador = await ceifarDisparosPresos().catch((e) => { log().error?.(`[atend-worker] ceifador: ${e.message}`); return null; });
    resumo.disparo = await dispararVencidos({ limite, workerId }).catch((e) => { log().error?.(`[atend-worker] disparo: ${e.message}`); return null; });
    resumo.virada = await tratarViradaDeExpediente({ limitePorConta }).catch((e) => { log().error?.(`[atend-worker] virada: ${e.message}`); return null; });

    const houveTrabalho = (resumo.disparo?.aplicados || 0) + (resumo.virada?.viradas || 0)
      + (resumo.reconciliacao?.armados || 0) + (resumo.reconciliacao?.reArmados || 0);
    if (houveTrabalho) {
      log().info?.(
        `[atend-worker] rodada em ${Date.now() - inicio}ms · armados ${resumo.reconciliacao?.armados ?? 0} · `
        + `re-armados ${resumo.reconciliacao?.reArmados ?? 0} · aplicados ${resumo.disparo?.aplicados ?? 0} · `
        + `obsoletos ${resumo.disparo?.obsoletos ?? 0} · recusados ${resumo.disparo?.recusados ?? 0} · `
        + `viradas ${resumo.virada?.viradas ?? 0}`,
      );
    }
  } catch (e) {
    log().error?.(`[atend-worker] erro não previsto na rodada: ${e.message}`);
    resumo.erro = e.message;
  } finally {
    rodadaEmCurso = false;
  }
  resumo.duracaoMs = Date.now() - inicio;
  return resumo;
}

/**
 * Liga o trabalhador. Devolve a função que o desliga — e ela precisa ser chamada no encerramento do
 * processo: um `setInterval` órfão continua tocando o banco depois do desligamento gracioso.
 *
 * 60 segundos é o mesmo tique do `notification-scheduler` do NOC, e pela mesma razão: prazos são em
 * minutos, e um tique mais curto só multiplicaria consultas sem melhorar a resposta.
 */
export function iniciarTrabalhadorDeAtendimento({ intervaloMs = 60_000, ...opcoes } = {}) {
  const alca = setInterval(() => { rodarTrabalhadorDeAtendimento(opcoes).catch(() => {}); }, intervaloMs);
  if (typeof alca.unref === 'function') alca.unref(); // não segura o processo no encerramento
  log().info?.(`[atend-worker] trabalhador de automações de atendimento ligado (tique de ${Math.round(intervaloMs / 1000)}s)`);
  return () => { clearInterval(alca); log().info?.('[atend-worker] trabalhador desligado'); };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMO AMARRAR NO PROCESSO
//
//   import * as atend from './services/ragnabot-atendimento-worker.service.js';
//   import * as fila  from './services/ragnabot-fluxo-fila.service.js';
//   import * as cw    from './services/ragnabot-chatwoot.porta.js';
//
//   atend.configurarTrabalhador({ chatwoot: cw, fila });
//   const desligar = atend.iniciarTrabalhadorDeAtendimento();
//   process.on('SIGTERM', desligar);
//
// ⚠️ A regra da casa vale aqui: `pm2 restart` derruba sessão de cliente. Este trabalhador é
// desenhado para sobreviver ao reinício sem duplicar ação — mas o reinício em si continua sujeito à
// checagem de `GET /api/health/active-sessions`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
