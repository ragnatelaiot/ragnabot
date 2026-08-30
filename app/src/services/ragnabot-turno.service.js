// ════════════════════════════════════════════════════════════════════════════════════════════════
// TURNO POR ATENDENTE — o filtro de presença (documento 29 §4.4, fatia 3.1)
//
// POR QUE ESTE ARQUIVO EXISTE AGORA, E NÃO ANTES
// O documento 29 deixou `RagnabotAtendTurno` no schema SEM código, de propósito, com um bilhete
// preso: "construir só depois de medir". A hipótese que segurava a obra era "todos os atendentes
// estão com 00:00–00:00, o requisito nunca foi usado, a tabela nasce morta".
//
//   `[medido 29/08/2026]` A hipótese está FALSIFICADA. Dos 7 usuários lidos na origem:
//       • 2 usam 08:00–18:00 de verdade;
//       • 1 usa 00:00–23:59;
//       • 4 estão vazios.
//
// É essa distribuição — e não uma preferência de desenho — que dita a regra central deste arquivo:
//
//   ⚠️ TURNO É OPCIONAL. QUEM NÃO CADASTROU HERDA O EXPEDIENTE DA EMPRESA.
//
// A MAIORIA está vazia. Se a ausência de turno fosse lida como "indisponível", ligar esta função
// apagaria da fila justamente os 4 atendentes que nunca configuraram nada — a operação inteira
// ficaria sem ninguém para receber conversa, e o sintoma apareceria como "o Ragnabot parou de
// distribuir", a três camadas de distância da causa. É a mesma decisão, pela mesma razão, que
// `avaliarExpediente()` já tomou para expediente sem janela cadastrada: falhar ABERTO. Fechar exige
// que alguém tenha DITO quando fecha.
//
// COMO A REGRA DE HORÁRIO É COMPARTILHADA (e por que não há uma segunda cópia dela aqui)
// Turno e expediente são a MESMA forma: dia da semana + minuto de abertura + minuto de fechamento.
// Este serviço IMPORTA `avaliarExpediente()`, `proximaAberturaApos()`, `normalizarJanelas()`,
// `partesNoFuso()` e `instanteDeParede()` de `ragnabot-atendimento.service.js` e alimenta o turno no
// lugar da janela. Duas implementações da mesma aritmética de horário divergem em silêncio — e o
// jeito de errar o horário de um cliente sem ninguém perceber é exatamente esse. Por tabela, o turno
// ganha de graça tudo o que já foi provado lá: fuso por `Intl`, janela que cruza a meia-noite,
// fusão de janelas sobrepostas e a conversão inversa parede→instante.
//
// A DECISÃO QUE O CHEFE PRECISA REVISAR (§ "modo de composição", abaixo)
// Quem TEM turno cadastrado: o turno SUBSTITUI as janelas semanais da empresa, mas continua sujeito
// às EXCEÇÕES do calendário (feriado, véspera com meio expediente). O raciocínio está inteiro no
// comentário de `atendenteDisponivel()`. Quem preferir a leitura de interseção ("turno só restringe
// dentro do expediente") liga `exigirExpedienteDaEmpresa: true` — sem editar código.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//   • Não distribui conversa, não transfere e não escreve nada. Ele RESPONDE "esta pessoa está de
//     turno agora?" — a amarração no trabalhador e na distribuição é do chefe.
//   • Não conhece o status que a pessoa marca no Chatwoot (online/ausente/ocupado). Turno é a grade
//     cadastrada pelo gestor; status é a vontade da pessoa no momento. Quem quiser as duas coisas
//     combina os dois sinais no chamador — de propósito, para não enterrar uma política dentro da
//     outra.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import {
  FUSO_PADRAO,
  MOTIVOS_EXPEDIENTE,
  ErroDeAtendimento,
  avaliarExpediente,
  proximaAberturaApos,
  normalizarJanelas,
  partesNoFuso,
  inteiroEstrito,
  hhmm,
} from './ragnabot-atendimento.service.js';

export { FUSO_PADRAO, MOTIVOS_EXPEDIENTE, ErroDeAtendimento };

// ────────────────────────────────────────────────────────────────────────────────────────────────
// MOTIVOS — a resposta "por quê", que é o que a tela e a mensagem ao cliente precisam
//
// Booleano sozinho não serve: "indisponível" porque é feriado, porque a pessoa saiu às 18h ou
// porque a empresa está no almoço são três conversas diferentes com o gestor.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const MOTIVOS_TURNO = Object.freeze({
  /** Tem turno cadastrado e o relógio está dentro dele. */
  EM_TURNO: 'em_turno',
  /** Tem turno cadastrado e o relógio está fora dele. */
  FORA_DO_TURNO: 'fora_do_turno',
  /** NÃO tem turno — herdou o expediente da empresa, que está aberto. O caso da MAIORIA (4 de 7). */
  HERDA_EMPRESA: 'herda_empresa',
  /** NÃO tem turno e a empresa está fechada (fora de hora, intervalo ou feriado). */
  HERDA_EMPRESA_FECHADA: 'herda_empresa_fechada',
  /** Está no turno, mas o calendário da empresa fechou o dia (feriado) — ou `exigirExpedienteDaEmpresa`
   *  está ligado e a empresa está fechada. */
  EMPRESA_FECHADA: 'empresa_fechada',
});

/** As fontes possíveis da resposta. Vai no retorno para a tela poder dizer "pelo turno dele" ou
 *  "pelo expediente da empresa" sem adivinhar. */
export const FONTES = Object.freeze({ TURNO: 'turno', EMPRESA: 'empresa' });

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — mesmo desenho do serviço de atendimento e do motor: injeção, para o teste rodar a
// decisão DE VERDADE sem banco e sem rede.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = { db: prismaGlobal };

export function configurar(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new ErroDeAtendimento('PORTA_DESCONHECIDA', `porta desconhecida: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoTurno();
}

export function portasDoTurno() { return { ...portas }; }

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. NORMALIZAÇÃO — funções puras
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Põe as linhas cruas de `RagnabotAtendTurno` na forma que a aritmética de horário entende.
 *
 * REUSA `normalizarJanelas()` inteira: os campos são os mesmos (`diaSemana`, `abreMin`, `fechaMin`,
 * `ativo`) e a validação de faixa que já está provada lá vale aqui sem uma linha nova.
 *
 * ⚠️ LINHA INVÁLIDA NÃO SOME EM SILÊNCIO. Um `abreMin: 1440` — que é como alguém escreve "24:00"
 * quando não sabe que a meia-noite é a hora ZERO do dia seguinte, e nunca a hora 24 de hoje — é
 * recusado e devolvido em `problemas`. Descartado calado, ele viraria um atendente que nunca
 * aparece na fila, e ninguém ligaria o sintoma ao cadastro.
 *
 * @param {Array} turnos linhas cruas (podem ser de vários atendentes)
 * @param {{cwUserId?:number|null}} opcoes filtra por atendente quando informado
 * @returns {{turnos:Array, problemas:Array, cwUserId:number|null}}
 */
export function normalizarTurnos(turnos = [], { cwUserId = null } = {}) {
  const alvo = inteiroEstrito(cwUserId);
  const doAtendente = (turnos ?? []).filter((t) => {
    if (alvo === null) return true;
    const dono = inteiroEstrito(t?.cwUserId);
    // Linha sem `cwUserId` é aceita quando o chamador já filtrou por atendente — é o caso de quem
    // monta a lista na mão, no teste e na tela de cadastro.
    return dono === null || dono === alvo;
  });
  const { janelas, problemas } = normalizarJanelas(doAtendente);
  return { turnos: janelas, problemas, cwUserId: alvo };
}

/** Tem grade própria? Só conta turno ATIVO e VÁLIDO — é isso que separa "herda a empresa" de
 *  "tem janela própria". */
export function temTurnoConfigurado(turnos = [], opcoes = {}) {
  return normalizarTurnos(turnos, opcoes).turnos.length > 0;
}

/** Agrupa uma lista achatada (o que o banco devolve para a equipe inteira) por atendente. */
export function agruparTurnosPorAtendente(turnos = []) {
  const m = new Map();
  for (const t of turnos ?? []) {
    const id = inteiroEstrito(t?.cwUserId);
    if (id === null) continue; // sem dono não dá para atribuir a ninguém — e chutar seria pior
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(t);
  }
  return m;
}

/**
 * Aceita o expediente da empresa em qualquer das duas formas que o resto do sistema produz, para o
 * chamador não precisar saber qual delas tem em mãos:
 *   • CRU  — `{ janelas, excecoes, fuso }`, como sai de `carregarPoliticaEfetiva()`;
 *   • JÁ AVALIADO — `{ aberto, motivo, proximaAbertura }`, como sai de `avaliarExpedienteAgora()`.
 *
 * AUSENTE é lido como ABERTO com motivo `sem_configuracao` — a mesma escolha, pela mesma razão, de
 * `avaliarExpediente()`: quem não disse quando fecha não fechou.
 */
function resolverExpedienteDaEmpresa(expediente, { agora, fuso }) {
  if (!expediente) {
    return {
      aberto: true, motivo: MOTIVOS_EXPEDIENTE.SEM_CONFIGURACAO, rotulo: null,
      proximaAbertura: null, fechaEm: null, janelas: [], excecoes: [], informado: false,
    };
  }
  const excecoes = Array.isArray(expediente.excecoes) ? expediente.excecoes : [];
  if (typeof expediente.aberto === 'boolean') {
    return {
      aberto: expediente.aberto,
      motivo: expediente.motivo ?? (expediente.aberto ? MOTIVOS_EXPEDIENTE.ABERTO : MOTIVOS_EXPEDIENTE.FORA_HORA),
      rotulo: expediente.rotulo ?? null,
      proximaAbertura: expediente.proximaAbertura ?? null,
      fechaEm: expediente.fechaEm ?? null,
      janelas: Array.isArray(expediente.janelas) ? expediente.janelas : [],
      excecoes,
      informado: true,
    };
  }
  const janelas = Array.isArray(expediente.janelas) ? expediente.janelas : [];
  const avaliado = avaliarExpediente({ agora, fuso, janelas, excecoes });
  return { ...avaliado, janelas, excecoes, informado: true };
}

/** O fuso a usar, na ordem: o explícito > o da política da empresa > o padrão da casa. */
function fusoEfetivo(fuso, expediente) {
  return fuso ?? expediente?.fuso ?? FUSO_PADRAO;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. A PERGUNTA — funções puras
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ESTA PESSOA ESTÁ DE TURNO AGORA? — e, quando não, por quê e até quando.
 *
 * AS DUAS REGRAS, e a razão de cada uma:
 *
 * 1. SEM TURNO CADASTRADO → HERDA O EXPEDIENTE DA EMPRESA.
 *    É o caso de 4 dos 7 atendentes medidos. Falhar FECHADO aqui esvaziaria a fila da operação
 *    inteira no primeiro dia em que a função fosse ligada.
 *
 * 2. COM TURNO CADASTRADO → O TURNO SUBSTITUI AS JANELAS SEMANAIS DA EMPRESA, MAS AS EXCEÇÕES DO
 *    CALENDÁRIO CONTINUAM VALENDO.
 *    Substituir, e não intersectar, é a leitura coerente com a herança que este produto já pratica
 *    em `mesclarPoliticas()`: vale o valor do nível MAIS ESPECÍFICO QUE EXISTIR. Intersectar mataria
 *    em silêncio o único cadastro que justifica existir turno por pessoa — o plantão das 22h às 6h
 *    numa empresa que atende das 8h às 18h ficaria disponível NUNCA, sem erro nenhum no caminho.
 *    Já o feriado NÃO é rotina semanal, é fato do calendário da empresa: no Natal ninguém está de
 *    turno, tenha cadastrado o que tiver. Por isso as exceções são repassadas para a avaliação.
 *    Quem quiser a leitura de interseção liga `exigirExpedienteDaEmpresa: true`.
 *
 * @param {object} args
 * @param {Array}  args.turnos linhas de `RagnabotAtendTurno` (deste atendente, ou da equipe + `cwUserId`)
 * @param {Date|string} args.agora instante a avaliar
 * @param {string} [args.fuso] padrão `America/Fortaleza`
 * @param {object|null} [args.expedienteDaEmpresa] cru `{janelas,excecoes}` ou já avaliado `{aberto,...}`
 * @param {number|null} [args.cwUserId] filtra `turnos` por atendente
 * @param {boolean} [args.exigirExpedienteDaEmpresa=false] liga a leitura de INTERSEÇÃO
 * @returns {{disponivel:boolean, motivo:string, fonte:string, cwUserId:number|null,
 *            temTurno:boolean, rotulo:string|null, fechaEm:Date|null, proximaJanela:Date|null,
 *            expediente:{aberto:boolean, motivo:string}, problemas:Array}}
 */
export function atendenteDisponivel({
  turnos = [],
  agora,
  fuso = null,
  expedienteDaEmpresa = null,
  cwUserId = null,
  exigirExpedienteDaEmpresa = false,
} = {}) {
  const fusoUsado = fusoEfetivo(fuso, expedienteDaEmpresa);
  const agoraD = agora instanceof Date ? agora : new Date(agora ?? Date.now());
  if (Number.isNaN(agoraD.getTime())) {
    throw new ErroDeAtendimento('DATA_INVALIDA', 'agora inválido', { agora });
  }

  const { turnos: meus, problemas, cwUserId: idAlvo } = normalizarTurnos(turnos, { cwUserId });
  const empresa = resolverExpedienteDaEmpresa(expedienteDaEmpresa, { agora: agoraD, fuso: fusoUsado });
  const resumoEmpresa = { aberto: empresa.aberto, motivo: empresa.motivo, rotulo: empresa.rotulo ?? null };

  if (problemas.length) {
    // Não derruba a decisão — mas também não deixa passar calado. Cadastro torto tem de aparecer
    // no log de quem opera, não só num campo de retorno que ninguém lê.
    logger.warn?.(
      `[ragnabot-turno] ${problemas.length} linha(s) de turno inválida(s) ignorada(s)` +
      `${idAlvo === null ? '' : ` (cwUserId=${idAlvo})`}: ${problemas.map((p) => p.motivo).join('; ')}`,
    );
  }

  // ── Caminho 1: SEM turno próprio → herda a empresa ────────────────────────────────────────────
  if (meus.length === 0) {
    return {
      disponivel: empresa.aberto,
      motivo: empresa.aberto ? MOTIVOS_TURNO.HERDA_EMPRESA : MOTIVOS_TURNO.HERDA_EMPRESA_FECHADA,
      fonte: FONTES.EMPRESA,
      cwUserId: idAlvo,
      temTurno: false,
      rotulo: empresa.rotulo ?? null,
      fechaEm: empresa.fechaEm ?? null,
      proximaJanela: empresa.aberto ? null : (empresa.proximaAbertura ?? null),
      expediente: resumoEmpresa,
      problemas,
    };
  }

  // ── Caminho 2: COM turno próprio ──────────────────────────────────────────────────────────────
  // As janelas são as DO ATENDENTE; as exceções continuam sendo as DA EMPRESA (feriado é do
  // calendário, não da rotina de cada um).
  const noTurno = avaliarExpediente({ agora: agoraD, fuso: fusoUsado, janelas: meus, excecoes: empresa.excecoes });

  // Feriado (`fechado` no calendário da empresa) derruba o turno — e o motivo tem de dizer isso, e
  // não "fora do turno", senão o gestor vai procurar erro na grade da pessoa.
  const derrubadoPeloCalendario = !noTurno.aberto && noTurno.motivo === MOTIVOS_EXPEDIENTE.FERIADO;

  if (noTurno.aberto && exigirExpedienteDaEmpresa && !empresa.aberto) {
    return {
      disponivel: false,
      motivo: MOTIVOS_TURNO.EMPRESA_FECHADA,
      fonte: FONTES.EMPRESA,
      cwUserId: idAlvo,
      temTurno: true,
      rotulo: empresa.rotulo ?? null,
      fechaEm: null,
      proximaJanela: empresa.proximaAbertura ?? proximaAberturaApos({
        agora: agoraD, fuso: fusoUsado, janelas: empresa.janelas, excecoes: empresa.excecoes,
      }),
      expediente: resumoEmpresa,
      problemas,
    };
  }

  return {
    disponivel: noTurno.aberto,
    motivo: noTurno.aberto
      ? MOTIVOS_TURNO.EM_TURNO
      : (derrubadoPeloCalendario ? MOTIVOS_TURNO.EMPRESA_FECHADA : MOTIVOS_TURNO.FORA_DO_TURNO),
    fonte: derrubadoPeloCalendario ? FONTES.EMPRESA : FONTES.TURNO,
    cwUserId: idAlvo,
    temTurno: true,
    rotulo: noTurno.rotulo ?? null,
    fechaEm: noTurno.fechaEm ?? null,
    proximaJanela: noTurno.aberto ? null : (noTurno.proximaAbertura ?? null),
    expediente: resumoEmpresa,
    problemas,
  };
}

/**
 * A equipe inteira, com o veredito de cada um. É o retorno detalhado — serve à tela ("quem está de
 * turno agora") e ao diagnóstico de "por que a fila não distribuiu".
 *
 * @param {Array} atendentes `[{ cwUserId, nome?, turnos? }]` (ou uma lista de ids)
 * @param {object} opcoes o mesmo de `atendenteDisponivel`, mais `turnos` achatado da equipe
 */
export function avaliarPresencaDaEquipe(atendentes = [], opcoes = {}) {
  const { turnos: turnosDaEquipe = null, ...resto } = opcoes ?? {};
  const porUsuario = turnosDaEquipe ? agruparTurnosPorAtendente(turnosDaEquipe) : null;
  return (atendentes ?? []).map((a) => {
    const id = inteiroEstrito(typeof a === 'object' && a !== null ? (a.cwUserId ?? a.id) : a);
    const meus = Array.isArray(a?.turnos) ? a.turnos : (porUsuario?.get(id) ?? []);
    return {
      atendente: a,
      cwUserId: id,
      presenca: atendenteDisponivel({ ...resto, cwUserId: id, turnos: meus }),
    };
  });
}

/**
 * SÓ OS QUE ESTÃO NO TURNO AGORA — devolve os objetos originais, na ordem original.
 *
 * ⚠️ LISTA VAZIA É RESPOSTA LEGÍTIMA, e o chamador PRECISA tratá-la: é ela que alimenta a mensagem
 * `msgAtendenteIndisponivel` (§1.6 do documento 19) em vez de deixar o cliente falando sozinho numa
 * fila sem ninguém. Quem usar isto para distribuir e não tratar o vazio inventa um transbordo mudo.
 */
export function filtrarDisponiveis(atendentes = [], opcoes = {}) {
  return avaliarPresencaDaEquipe(atendentes, opcoes)
    .filter((x) => x.presenca.disponivel)
    .map((x) => x.atendente);
}

/** Quantos estão de turno agora — alimenta `{{atendentes.disponiveis}}` do §5.5. */
export function contarDisponiveis(atendentes = [], opcoes = {}) {
  return filtrarDisponiveis(atendentes, opcoes).length;
}

/**
 * QUANDO ESTA PESSOA VOLTA. É o que transforma "estamos indisponíveis" em "volto às 08:00".
 *
 * Devolve `{ instante:null, jaDisponivel:true }` quando a pessoa JÁ está de turno — dizer "volto às"
 * para quem está disponível agora seria uma resposta correta e inútil.
 *
 * `instante` nulo com `jaDisponivel:false` é resposta HONESTA: não há abertura dentro do horizonte
 * de duas semanas de `proximaAberturaApos()`. Melhor devolver "não sei quando" do que prometer uma
 * hora que não existe.
 *
 * @returns {{instante:Date|null, hora:string|null, mesmoDia:boolean|null, jaDisponivel:boolean,
 *            fonte:string, motivo:string}}
 */
export function proximaJanelaDoAtendente({
  turnos = [],
  agora,
  fuso = null,
  expedienteDaEmpresa = null,
  cwUserId = null,
  exigirExpedienteDaEmpresa = false,
} = {}) {
  const fusoUsado = fusoEfetivo(fuso, expedienteDaEmpresa);
  const agoraD = agora instanceof Date ? agora : new Date(agora ?? Date.now());
  const presenca = atendenteDisponivel({ turnos, agora: agoraD, fuso: fusoUsado, expedienteDaEmpresa, cwUserId, exigirExpedienteDaEmpresa });

  if (presenca.disponivel) {
    return { instante: null, hora: null, mesmoDia: null, jaDisponivel: true, fonte: presenca.fonte, motivo: presenca.motivo };
  }

  let instante = presenca.proximaJanela ?? null;
  if (!instante) {
    // O caminho já avaliado (`{aberto:false}` sem `proximaAbertura`) não sabe quando reabre.
    // Recalcula com o que houver: a grade do atendente, se ele tiver; senão a da empresa.
    const { turnos: meus } = normalizarTurnos(turnos, { cwUserId });
    const empresa = resolverExpedienteDaEmpresa(expedienteDaEmpresa, { agora: agoraD, fuso: fusoUsado });
    const janelas = meus.length ? meus : empresa.janelas;
    if (janelas.length) {
      instante = proximaAberturaApos({ agora: agoraD, fuso: fusoUsado, janelas, excecoes: empresa.excecoes });
    }
  }
  if (!instante) {
    return { instante: null, hora: null, mesmoDia: null, jaDisponivel: false, fonte: presenca.fonte, motivo: presenca.motivo };
  }

  const dt = instante instanceof Date ? instante : new Date(instante);
  const p = partesNoFuso(dt, fusoUsado);
  return {
    instante: dt,
    hora: hhmm(p.minutosDoDia),
    mesmoDia: p.dataISO === partesNoFuso(agoraD, fusoUsado).dataISO,
    jaDisponivel: false,
    fonte: presenca.fonte,
    motivo: presenca.motivo,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. LEITURA DO BANCO — a única porta que toca o Postgres
//
// Só LÊ. Cadastro de turno é tela, e a tela é outra tarefa.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Falha cedo e com nome quando o modelo ainda não existe no cliente do Prisma — em vez de estourar
 * `Cannot read properties of undefined` três chamadas abaixo. Mesmo desenho de
 * `ragnabot-atendimento.service.js`.
 */
function modeloDeTurno() {
  const modelo = portas.db?.ragnabotAtendTurno;
  if (!modelo || typeof modelo.findMany !== 'function') {
    throw new ErroDeAtendimento(
      'MODELO_AUSENTE',
      'o modelo "ragnabotAtendTurno" não existe no cliente do Prisma. As funções puras deste ' +
      'serviço funcionam sem ele.',
      { modelo: 'ragnabotAtendTurno' },
    );
  }
  return modelo;
}

/**
 * Turnos ATIVOS de uma empresa (e, se pedido, de um conjunto de atendentes).
 *
 * ⚠️ `tenantId` É OBRIGATÓRIO E SEM VALOR PADRÃO. Uma consulta de turno sem empresa devolveria a
 * grade de TODOS os clientes do SaaS numa lista só — é o vazamento entre empresas que o documento 29
 * §1.3 mandou fechar, nascendo de novo por descuido. Aqui ele é um erro, não um filtro esquecido.
 */
export async function carregarTurnos({ tenantId, cwUserIds = null } = {}) {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new ErroDeAtendimento('TENANT_OBRIGATORIO', 'carregarTurnos exige tenantId — sem ele a consulta cruzaria empresas', { tenantId });
  }
  const where = { tenantId, ativo: true };
  if (Array.isArray(cwUserIds)) {
    const ids = cwUserIds.map((v) => inteiroEstrito(v)).filter((v) => v !== null);
    // Lista informada e VAZIA significa "nenhum atendente", não "todos" — devolver a empresa inteira
    // aqui seria o mesmo vazamento por outro caminho.
    if (ids.length === 0) return [];
    where.cwUserId = { in: ids };
  }
  return modeloDeTurno().findMany({
    where,
    orderBy: [{ cwUserId: 'asc' }, { diaSemana: 'asc' }, { abreMin: 'asc' }],
  });
}

export default {
  MOTIVOS_TURNO,
  FONTES,
  configurar,
  portasDoTurno,
  normalizarTurnos,
  temTurnoConfigurado,
  agruparTurnosPorAtendente,
  atendenteDisponivel,
  avaliarPresencaDaEquipe,
  filtrarDisponiveis,
  contarDisponiveis,
  proximaJanelaDoAtendente,
  carregarTurnos,
};
