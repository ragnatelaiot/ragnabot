// ════════════════════════════════════════════════════════════════════════════════════════════════
// AUTOMAÇÕES DO ATENDIMENTO — expediente, intervalo, relógio de inatividade, fluxo do primeiro
// "oi", transbordo e devolução à fila.
//
// Base: /ia/.claude/modulo-atendimento/29-AUTOMACOES-DO-ATENDIMENTO.md §4 (modelo de dados) e §5
// (ligação com o motor de fluxo). O documento é medição, não desejo: tudo que ele marca como
// `[medido 29/08]` foi lido no banco do Chatwoot 4.17.1 em produção nossa.
//
// A ORIGEM DISTO É UMA RECLAMAÇÃO DO DONO, e vale repetir para quem chegar depois: "tempo para um
// atendimento ir para fila de aguardando se não tiver mais interação ou do atendente ou do contato
// (isso é escolhido nas configurações), qual o fluxo será usado no primeiro 'oi', horário fora de
// expediente, o horário de intervalo".
//
// O QUE ESTE ARQUIVO FAZ:
//   • decide se a operação está ABERTA agora, no fuso da empresa, com almoço e feriado (§4.2/§4.3);
//   • decide QUANDO um silêncio vira ação, sabendo de quem é o silêncio que conta (§4.1);
//   • decide QUAL fluxo atende a mensagem que acabou de chegar (§5.2);
//   • planeja transbordo e devolução à fila, e registra quem passou para quem (§4.6).
//
// O QUE ELE NÃO FAZ, de propósito:
//   • não fala com o Chatwoot nem com a Meta — quem fala são as PORTAS injetadas (`configurar`);
//   • não executa nó de fluxo — isso é do motor (`ragnabot-fluxo-motor.service.js`), e a fronteira
//     entre os dois está escrita no §5.3 e implementada em `relogioDeveArmar()`;
//   • não cria tela, rota nem migração — outro dono, outro arquivo.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS CINCO ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA EVITAR
//
// 1. O "AINDA ESTÁ AÍ?" ÀS 3 DA MANHÃ. Relógio que corre de madrugada devolve toda a conversa da
//    noite para a fila enquanto ninguém trabalha, e o cliente recebe a cobrança de volta às 3h.
//    Por isso o padrão de `inatividadeContaForaExpediente` é FALSO e o vencimento é calculado em
//    MINUTOS DE EXPEDIENTE (`avancarMinutosDeExpediente`), não em minutos de relógio de parede.
//
// 2. DUAS MENSAGENS PELO MESMO SILÊNCIO. Enquanto a execução de fluxo está viva, o dono do prazo é
//    o nó `espera` (segundos). O relógio de atendimento (minutos) só arma com a conversa em mão
//    humana — `relogioDeveArmar()`. Sem essa regra o cliente lê "não entendi, escolha uma opção" e
//    "ainda está aí?" no mesmo minuto, e conclui que o robô quebrou.
//
// 3. O FUSO HERDADO. `[medido 29/08]` a caixa 1 está em UTC. Herdar o fuso da plataforma erra todo
//    expediente em 3 horas, e o sintoma aparece como "o robô respondeu fora de hora" — que ninguém
//    liga ao fuso. Aqui o fuso é campo da política, com padrão `America/Fortaleza`, e TODA conta de
//    hora passa por `partesNoFuso()`.
//
// 4. UM ÚNICO PAR ABRE/FECHA POR DIA. É o defeito do destino: `working_hours` tem uma linha por dia
//    da semana e valida que o fechamento não vem antes da abertura — 08–12 e 13–18 é IMPOSSÍVEL de
//    representar lá. Aqui a linha é a JANELA, não o dia, e o almoço é a ausência de janela entre
//    duas janelas. É por isso que `intervalosDoDia()` devolve uma LISTA.
//
// 5. DESPERTAR OBSOLETO. Se o cliente respondeu antes do prazo, o trabalho de despertar que já está
//    na fila não vale mais. Ele é descartado por comparação de carimbo (`carimboDoRelogio`), o
//    mesmo raciocínio do `tokenVisita` do motor — sem isso, resposta e vencimento mandam a conversa
//    por dois caminhos ao mesmo tempo.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ESTADO DAS TABELAS, DECLARADO SEM MAQUIAGEM
//
// Os modelos `RagnabotAtend*` do §4 do documento 29 AINDA NÃO ESTÃO no schema — conferido nesta
// sessão: `grep -c RagnabotAtend prisma/schema.prisma` devolveu 0, e o schema é de outro dono. As
// funções PURAS deste arquivo (a maior parte, e todas as decisões) funcionam sem banco nenhum e
// estão cobertas por teste. As funções que tocam o banco chamam `exigirModelo()`, que falha com uma
// mensagem que diz exatamente qual migração falta — em vez de estourar `undefined is not a
// function` a três chamadas de distância, que é o erro que custa a tarde de alguém.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES DO DOMÍNIO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Fuso padrão. Explícito e brasileiro DE PROPÓSITO — ver armadilha 3 no cabeçalho. */
export const FUSO_PADRAO = 'America/Fortaleza';

/** Minutos em um dia. O expediente é contado em minutos desde a meia-noite (§4.2): um inteiro
 *  ordena, soma e compara sem caso especial, que é justamente o que hora+minuto em duas colunas
 *  não faz — e foi essa comparação de dois campos que empurrou o Chatwoot para a validação que
 *  proibiu a segunda janela do dia. */
export const MIN_DIA = 1440;

/** Por que a operação está fechada. Vira `{{expediente.motivo}}` no contexto do fluxo (§5.5). */
export const MOTIVOS_EXPEDIENTE = Object.freeze({
  ABERTO: 'aberto',
  INTERVALO: 'intervalo',
  FORA_HORA: 'fora_hora',
  FERIADO: 'feriado',
  /** Nenhuma janela cadastrada. NÃO é "fechado" — ver `avaliarExpediente()`. */
  SEM_CONFIGURACAO: 'sem_configuracao',
});

/** De quem é o silêncio que conta. É a coluna que o dono citou nominalmente, e a funcionalidade
 *  inteira do pedido nº 2 mora nesta escolha.
 *    CONTATO   → o cliente sumiu depois de ter sido respondido (último a falar foi o atendente)
 *    ATENDENTE → o atendente sumiu e o cliente está esperando (último a falar foi o contato)
 *    QUALQUER  → ninguém falou, de lado nenhum
 *  O `auto_resolve_after` nativo só sabe fazer QUALQUER, e nem isso de forma configurável: ele é da
 *  conta inteira, só resolve, e o relógio dele é `last_activity_at`, que qualquer mensagem dos dois
 *  lados atualiza. */
export const MODOS_INATIVIDADE = Object.freeze({ CONTATO: 'contato', ATENDENTE: 'atendente', QUALQUER: 'qualquer' });

/** Quem falou por último. `sistema` é mensagem do robô/automação: ela NÃO é sinal de vida de
 *  ninguém, e por isso não rearma relógio nenhum (ver `atividadeRearma()`). Sem essa distinção, a
 *  própria mensagem "ainda está aí?" reiniciaria o relógio e a conversa nunca sairia da fila. */
export const LADOS = Object.freeze({ CONTATO: 'contato', ATENDENTE: 'atendente', SISTEMA: 'sistema' });

export const TIPOS_RELOGIO = Object.freeze({ INATIVIDADE: 'inatividade', AVISO: 'aviso', TRANSBORDO: 'transbordo' });

export const ACOES_INATIVIDADE = Object.freeze({
  DEVOLVER_FILA: 'devolver_fila', TRANSFERIR_TIME: 'transferir_time',
  RESOLVER: 'resolver', NOTIFICAR: 'notificar', NENHUMA: 'nenhuma',
});

/** Tipo de trabalho na fila do motor.
 *  ⚠️ ACRÉSCIMO DECLARADO, e NÃO é mudança de schema: `RagnabotFluxoFila.tipo` é String livre, e o
 *  próprio motor já registra ter ampliado o conjunto antes (o tipo `continuar`). Reusar a fila do
 *  motor traz de graça posse por trabalhador, ceifador de trabalho preso, retentativa com teto e —
 *  o que mais importa — serialização por `chaveParticao`, que é o que impede o relógio de mexer na
 *  conversa enquanto um nó do fluxo está no meio de um passo. */
export const TIPO_JOB_RELOGIO = 'atend_relogio';

/** Escopos da política, do mais geral para o mais específico. A ORDEM É SIGNIFICATIVA: é ela que
 *  `mesclarPoliticas()` percorre. */
export const ESCOPOS = Object.freeze(['empresa', 'caixa', 'time']);

/**
 * Campos NÃO ANULÁVEIS da política (§4.1).
 *
 * ⚠️ ARMADILHA DE HERANÇA, e ela é sutil: em todo campo anulável, NULO significa "herda do escopo
 * mais geral". Booleano não-anulável não tem como dizer "herda" — `false` é um valor, não uma
 * ausência. A regra adotada, e é preciso que ela esteja escrita em algum lugar antes que alguém
 * invente outra: para estes campos vale o valor da linha MAIS ESPECÍFICA QUE EXISTIR. Criar uma
 * política de time só para mudar a mensagem de almoço, portanto, herda os booleanos do time —
 * que é o comportamento óbvio para quem preenche a tela, e o contrário do que um `??` ingênuo faria.
 */
export const CAMPOS_NAO_ANULAVEIS = Object.freeze([
  'fuso', 'inatividadeAtiva', 'inatividadeContaForaExpediente', 'transbordoAtivo',
  'reiniciaFluxoAposHoras', 'encerrarAposForaExpediente', 'distribuicaoPausada',
]);

/** Horizonte de varredura ao procurar a próxima abertura. Duas semanas cobre operação que só
 *  atende em um dia da semana e ainda cai num feriado. Passou disso, devolve nulo — e nulo é
 *  resposta honesta ("não sei quando abre"), muito melhor que um laço que roda para sempre porque
 *  alguém cadastrou expediente vazio. */
const HORIZONTE_DIAS = 14;

/** Depois de quanto tempo um `resultado='processando'` é considerado ABANDONADO (dono morto) e a
 *  linha volta a poder ser processada. Dez minutos é folga larga para um despacho que faz três
 *  chamadas de rede — e curto o bastante para a conversa não passar a noite travada. */
const PROCESSANDO_PRESO_MS = 10 * 60_000;

/** Horizonte ao consumir minutos de expediente. 60 dias porque o relógio pode ser de 48 h de
 *  expediente e cair em recesso de fim de ano. */
const HORIZONTE_DIAS_CONSUMO = 60;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ERROS DE FRONTEIRA
//
// ⚠️ CLASSIFIQUE POR `e.codigo`, NUNCA por `instanceof` — mesma razão já registrada no motor: se
// dois módulos declararem a mesma classe, `instanceof` devolve falso para o objeto vindo do outro,
// e um erro tratável passa a queimar as tentativas de um trabalho sadio.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export class ErroDeAtendimento extends Error {
  constructor(codigo, mensagem, dados = {}) {
    super(mensagem);
    this.name = 'ErroDeAtendimento';
    this.codigo = codigo;
    this.dados = dados;
    this.ehErroDeAtendimento = true;
  }
}

export function ehErroDeAtendimento(e, codigo = null) {
  if (!e || e.ehErroDeAtendimento !== true) return false;
  return codigo == null || e.codigo === codigo;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS
//
// Mesmo desenho do motor: as dependências entram por injeção para que o teste rode a decisão DE
// VERDADE, sem banco e sem rede. `db` já vem preenchido com o cliente global porque o caminho de
// produção não deve precisar de cerimônia.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  /** Relógio. Só o teste troca. Em produção a hora vem do BANCO — relógio de pod fora de sincronia
   *  decide expediente e vencimento errados, e o erro aparece como "o robô agiu na hora errada". */
  relogio: null,
  /** Fala com o Chatwoot: `mudarStatus`, `atribuirTime`, `removerAgente`, `notaInterna`. */
  chatwoot: null,
  /** Fala com o canal (WhatsApp): `janelaAberta({cwConversationId})` e `enviarTexto(...)`. */
  canal: null,
  /** `registrar(evento)` de `ragnabot-auditoria.service.js`. Falha de auditoria NUNCA derruba a
   *  ação — registro perdido é ruim, atendimento derrubado por causa do registro é pior. */
  auditoria: null,
};

export function configurar(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new ErroDeAtendimento('PORTA_DESCONHECIDA', `porta desconhecida: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoAtendimento();
}

export function portasDoAtendimento() { return { ...portas }; }

const db = () => portas.db;

/**
 * Falha cedo e com nome, quando o modelo `RagnabotAtend*` ainda não existe no cliente do Prisma.
 * Sem isto o sintoma seria `Cannot read properties of undefined (reading 'findMany')` dentro de uma
 * transação, três chamadas abaixo de onde o problema está.
 */
function exigirModelo(nome) {
  const cliente = db();
  const modelo = cliente?.[nome];
  if (!modelo || typeof modelo.findMany !== 'function') {
    throw new ErroDeAtendimento(
      'MODELO_AUSENTE',
      `o modelo "${nome}" não existe no cliente do Prisma. Os modelos RagnabotAtend* do documento 29 §4 ` +
      'ainda não foram migrados; as funções puras deste serviço funcionam sem eles.',
      { modelo: nome },
    );
  }
  return modelo;
}

/** A hora vem do BANCO. A porta `relogio` é a única exceção, e existe para o teste. */
async function agoraDoBanco(tx = null) {
  if (portas.relogio) return portas.relogio.agora();
  const cliente = tx ?? db();
  const linhas = await cliente.$queryRaw`SELECT now() AS agora`;
  const valor = Array.isArray(linhas) && linhas[0] ? linhas[0].agora : null;
  if (!valor) throw new ErroDeAtendimento('RELOGIO_INDISPONIVEL', 'o banco não devolveu now()');
  return valor instanceof Date ? valor : new Date(valor);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. FUSO HORÁRIO — funções puras
//
// Sem biblioteca de fuso, de propósito: `Intl` faz o trabalho e já carrega a base de fusos do
// sistema. O que uma biblioteca daria a mais é conversão inversa, e ela está resolvida aqui em
// `instanteDeParede()` por convergência.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Cache dos formatadores. Construir um `Intl.DateTimeFormat` é caro e o relógio chama isto milhares
 *  de vezes por rodada — a versão sem cache aparecia no perfil como custo dominante. */
const formatadores = new Map();

function formatadorDe(fuso) {
  let f = formatadores.get(fuso);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      // ⚠️ `hourCycle:'h23'` e não `hour12:false`: com `hour12:false` alguns motores devolvem "24"
      // para a meia-noite, e um 24 silencioso vira minuto 1440 — que nenhuma janela cobre. O sintoma
      // seria "o expediente não abre exatamente à meia-noite", uma vez por dia, sem log.
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    throw new ErroDeAtendimento('FUSO_INVALIDO', `fuso horário desconhecido: ${fuso}`, { fuso });
  }
  formatadores.set(fuso, f);
  return f;
}

/**
 * Relógio de parede naquele fuso.
 * @returns {{ano:number, mes:number, dia:number, hora:number, minuto:number, segundo:number,
 *            diaSemana:number, minutosDoDia:number, dataISO:string}}
 *
 * `diaSemana` é calculado a partir do ano/mês/dia já convertidos, e NÃO lido do `weekday` do
 * `Intl`: nome de dia depende do idioma pedido, e ninguém quer descobrir em produção que a
 * comparação quebrou porque alguém trocou o locale.
 */
export function partesNoFuso(data, fuso = FUSO_PADRAO) {
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) throw new ErroDeAtendimento('DATA_INVALIDA', 'data inválida', { data });
  const p = {};
  for (const parte of formatadorDe(fuso).formatToParts(d)) {
    if (parte.type !== 'literal') p[parte.type] = parte.value;
  }
  const ano = Number(p.year);
  const mes = Number(p.month);
  const dia = Number(p.day);
  const hora = Number(p.hour) % 24; // cinto e suspensório contra o "24" descrito acima
  const minuto = Number(p.minute);
  const segundo = Number(p.second);
  return {
    ano, mes, dia, hora, minuto, segundo,
    diaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay(),
    minutosDoDia: hora * 60 + minuto,
    dataISO: `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
  };
}

export const minutosDoDia = (data, fuso = FUSO_PADRAO) => partesNoFuso(data, fuso).minutosDoDia;
export const diaSemanaNoFuso = (data, fuso = FUSO_PADRAO) => partesNoFuso(data, fuso).diaSemana;
export const dataLocalISO = (data, fuso = FUSO_PADRAO) => partesNoFuso(data, fuso).dataISO;

/**
 * O caminho inverso: dada uma hora de PAREDE naquele fuso, qual instante ela é.
 * É o que permite responder "voltamos às 13h" com um carimbo de verdade, em vez de um texto.
 *
 * COMO FUNCIONA: chuta que a parede é UTC, mede o erro convertendo de volta, corrige, e repete uma
 * vez. Duas passadas bastam para qualquer deslocamento, inclusive os de meia e de três quartos de
 * hora, e para a mudança de horário de verão.
 *
 * ⚠️ LIMITE DECLARADO: no salto de horário de verão existem horas de parede que NÃO EXISTEM (o
 * relógio pula de 23:59 para 01:00). Para essas, esta função devolve o instante mais próximo que
 * existe, e não há resposta melhor — não é defeito, é a realidade do calendário. `America/Fortaleza`
 * não tem horário de verão desde 2019, então na configuração padrão o caso nem aparece.
 */
export function instanteDeParede({ ano, mes, dia, minutos = 0 }, fuso = FUSO_PADRAO) {
  const alvo = Date.UTC(ano, mes - 1, dia, 0, 0, 0) + minutos * 60_000;
  let ts = alvo;
  for (let i = 0; i < 2; i += 1) {
    const p = partesNoFuso(new Date(ts), fuso);
    const obtido = Date.UTC(p.ano, p.mes - 1, p.dia, 0, 0, 0) + p.minutosDoDia * 60_000;
    const erro = alvo - obtido;
    if (erro === 0) break;
    ts += erro;
  }
  return new Date(ts);
}

/** Soma dias no CALENDÁRIO, não 24 h no relógio. Somar milissegundos atravessa a mudança de horário
 *  de verão errado e desloca o expediente do dia seguinte em uma hora. */
function somarDiasCivis({ ano, mes, dia }, n) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + n);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), diaSemana: d.getUTCDay() };
}

const iso = ({ ano, mes, dia }) => `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** "*-12-25" — a forma recorrente da chave de exceção (§4.3). */
const isoRecorrente = ({ mes, dia }) => `*-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** "08:00" a partir de minutos desde a meia-noite. Só para tela, log e mensagem ao cliente. */
export function hhmm(min) {
  const m = ((Math.round(Number(min)) % MIN_DIA) + MIN_DIA) % MIN_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Inteiro de verdade, ou nulo.
 *
 * ⚠️ ARMADILHA QUE CUSTOU UM DEFEITO REAL NESTE ARQUIVO, encontrada pelo teste: `Number(null)` é
 * ZERO, e `Number.isInteger(0)` é verdadeiro. O `Number.isInteger(Number(x))` ingênuo, portanto,
 * aceita `null`, `''` e `false` como identificador válido — e o efeito não é um erro, é pior: a
 * chave de escopo vira `time:0` e a transferência vai para o "agente 0". Um destino que não existe,
 * gravado como se existisse, sem nenhuma exceção no caminho.
 */
export function inteiroEstrito(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. EXPEDIENTE, INTERVALO E FERIADO — funções puras
//
// A LINHA É A JANELA, NÃO O DIA. Segunda com almoço são duas linhas; plantão que vira a madrugada
// são duas linhas; sábado só de manhã é uma linha. O dia deixa de ser um limite — e é exatamente
// isso que o `working_hours` do destino não sabe fazer.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Normaliza e valida as janelas cruas vindas do banco ou da tela.
 * Descartar janela inválida em silêncio seria pior que recusar: uma janela com `abreMin` fora da
 * faixa vira expediente que nunca abre, e ninguém liga o sintoma ao cadastro.
 */
export function normalizarJanelas(janelas = []) {
  const boas = [];
  const problemas = [];
  for (const j of janelas ?? []) {
    if (j?.ativo === false) continue;
    const dia = Number(j?.diaSemana);
    const abre = Number(j?.abreMin);
    const fecha = Number(j?.fechaMin);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) { problemas.push({ janela: j, motivo: 'diaSemana fora de 0..6' }); continue; }
    if (!Number.isInteger(abre) || abre < 0 || abre >= MIN_DIA) { problemas.push({ janela: j, motivo: 'abreMin fora de 0..1439' }); continue; }
    if (!Number.isInteger(fecha) || fecha < 0 || fecha > MIN_DIA) { problemas.push({ janela: j, motivo: 'fechaMin fora de 0..1440' }); continue; }
    boas.push({ diaSemana: dia, abreMin: abre, fechaMin: fecha, rotulo: j?.rotulo ?? null, id: j?.id ?? null });
  }
  boas.sort((a, b) => (a.diaSemana - b.diaSemana) || (a.abreMin - b.abreMin) || (a.fechaMin - b.fechaMin));
  return { janelas: boas, problemas };
}

/** Uma janela cruza a meia-noite quando fecha antes de abrir. `fechaMin === abreMin` é lido como
 *  VINTE E QUATRO HORAS — é a leitura consistente com a regra de cruzamento, e o plantão contínuo
 *  é o único jeito de alguém cadastrar os dois iguais de propósito. */
export const janelaCruzaMeiaNoite = (j) => j.fechaMin <= j.abreMin;

/**
 * Resolve o que vale para UM dia civil, já aplicando a exceção daquela data.
 *
 * PRECEDÊNCIA DAS EXCEÇÕES: data cravada (`2026-12-25`) vence recorrente (`*-12-25`). Quem cadastra
 * a data cheia está dizendo "neste ano é diferente", e essa intenção é mais específica.
 *
 * @returns {{fechadoTodoDia:boolean, janelas:Array, excecao:object|null}}
 */
export function janelasDoDiaCivil(civil, janelas, excecoesPorChave) {
  const excecao = excecoesPorChave?.get(iso(civil)) ?? excecoesPorChave?.get(isoRecorrente(civil)) ?? null;
  if (excecao && excecao.tipo === 'fechado') return { fechadoTodoDia: true, janelas: [], excecao };
  if (excecao && excecao.tipo === 'janela_especial' && Number.isInteger(excecao.abreMin) && Number.isInteger(excecao.fechaMin)) {
    // A janela especial SUBSTITUI o dia inteiro. Somar à do dia normal faria a véspera de Natal com
    // meio expediente continuar aberta à tarde — o oposto do que quem cadastrou quis dizer.
    return {
      fechadoTodoDia: false,
      janelas: [{ diaSemana: civil.diaSemana, abreMin: excecao.abreMin, fechaMin: excecao.fechaMin, rotulo: excecao.rotulo ?? 'especial' }],
      excecao,
    };
  }
  return { fechadoTodoDia: false, janelas: janelas.filter((j) => j.diaSemana === civil.diaSemana), excecao: excecao ?? null };
}

/** Índice das exceções pela chave calculada. Chave NOT NULL, exatamente como no §4.3 — feriado
 *  recorrente não tem ano, e um `ano Int?` nulo escaparia do índice único, deixando cadastrar o
 *  mesmo Natal dez vezes. */
export function indexarExcecoes(excecoes = []) {
  const m = new Map();
  for (const e of excecoes ?? []) {
    if (!e?.chaveData) continue;
    m.set(String(e.chaveData), e);
  }
  return m;
}

/**
 * GERADOR dos intervalos abertos, dia a dia, em ordem de início.
 *
 * PREGUIÇOSO DE PROPÓSITO, e a razão é medida: a versão que montava a lista inteira antes de
 * responder custava 8 ms por chamada, e `avancarMinutosDeExpediente()` roda a CADA mensagem que
 * entra. Oito milissegundos de CPU por mensagem travam o laço de eventos numa rajada de cliente —
 * e a resposta quase sempre está na primeira hora, não no 60º dia. Quem consome para no que precisa.
 *
 * Janela que cruza a meia-noite pertence ao dia em que ABRE e termina no dia seguinte. Sem essa
 * regra o plantão das 22h às 6h viraria uma janela de duração negativa e sumiria do cálculo em
 * silêncio.
 */
function* gerarIntervalos({ de, ate, fuso, janelas, excecoes }) {
  const { janelas: boas } = normalizarJanelas(janelas);
  if (boas.length === 0) return;
  const idx = indexarExcecoes(excecoes);
  const inicioD = new Date(de);
  const limite = new Date(ate).getTime();
  // Começa um dia ANTES: uma janela que abriu ontem às 22h ainda pode estar aberta agora às 2h.
  let civil = somarDiasCivis(partesNoFuso(inicioD, fuso), -1);
  for (let i = 0; i < HORIZONTE_DIAS_CONSUMO + 2; i += 1) {
    const { fechadoTodoDia, janelas: doDia } = janelasDoDiaCivil(civil, boas, idx);
    if (!fechadoTodoDia) {
      for (const j of doDia) {
        const inicio = instanteDeParede({ ...civil, minutos: j.abreMin }, fuso);
        const fimCivil = janelaCruzaMeiaNoite(j) ? somarDiasCivis(civil, 1) : civil;
        const fim = instanteDeParede({ ...fimCivil, minutos: j.fechaMin }, fuso);
        if (fim.getTime() > inicioD.getTime() && inicio.getTime() < limite) {
          yield { inicio, fim, rotulo: j.rotulo ?? null };
        }
      }
    }
    const proximoInicio = instanteDeParede({ ...somarDiasCivis(civil, 1), minutos: 0 }, fuso);
    if (proximoInicio.getTime() > limite) return;
    civil = somarDiasCivis(civil, 1);
  }
}

/**
 * O mesmo gerador, com intervalos SOBREPOSTOS fundidos.
 *
 * ⚠️ SOBREPOSIÇÃO É CENÁRIO REAL, não hipótese: um plantão de sábado 22h → domingo 10h engole a
 * janela de domingo de manhã, e contar as duas faria trinta minutos de tolerância consumirem
 * quinze — o relógio venceria na METADE do tempo que o dono configurou, e ninguém ligaria o sintoma
 * ao cadastro do plantão. A fusão é possível em fluxo porque o gerador já emite em ordem de início.
 */
function* intervalosMesclados(args) {
  let atual = null;
  for (const iv of gerarIntervalos(args)) {
    if (!atual) { atual = { ...iv }; continue; }
    if (iv.inicio.getTime() <= atual.fim.getTime()) {
      if (iv.fim.getTime() > atual.fim.getTime()) atual.fim = iv.fim;
      continue;
    }
    yield atual;
    atual = { ...iv };
  }
  if (atual) yield atual;
}

/** A lista inteira, já fundida. Usada onde a faixa é curta (o "está aberto agora?") e pelo teste. */
export function intervalosAbertos({ de, ate, fuso = FUSO_PADRAO, janelas = [], excecoes = [] }) {
  return [...intervalosMesclados({ de, ate, fuso, janelas, excecoes })];
}

/**
 * ESTÁ ABERTO AGORA? — e, quando não, por quê e até quando.
 *
 * ⚠️ SEM NENHUMA JANELA CADASTRADA A RESPOSTA É "ABERTO", não "fechado". Parece contraintuitivo e é
 * deliberado: ligar a política sem ter preenchido o expediente silenciaria a operação inteira, e o
 * operador leria isso como "o Ragnabot parou de responder". Fechar exige que alguém tenha DITO
 * quando fecha. O motivo `sem_configuracao` sai no retorno justamente para a tela poder avisar.
 *
 * @returns {{aberto:boolean, motivo:string, rotulo:string|null, excecao:object|null,
 *            proximaAbertura:Date|null, fechaEm:Date|null}}
 */
export function avaliarExpediente({ agora, fuso = FUSO_PADRAO, janelas = [], excecoes = [] }) {
  const { janelas: boas } = normalizarJanelas(janelas);
  const idx = indexarExcecoes(excecoes);
  const agoraD = agora instanceof Date ? agora : new Date(agora);

  if (boas.length === 0) {
    return { aberto: true, motivo: MOTIVOS_EXPEDIENTE.SEM_CONFIGURACAO, rotulo: null, excecao: null, proximaAbertura: null, fechaEm: null };
  }

  const hoje = partesNoFuso(agoraD, fuso);
  const doDia = janelasDoDiaCivil(hoje, boas, idx);

  // Cobertura: olha os intervalos reais em instantes, o que resolve de graça a janela de ontem que
  // ainda não fechou.
  const perto = intervalosAbertos({
    de: new Date(agoraD.getTime() - 36 * 3600_000),
    ate: new Date(agoraD.getTime() + 36 * 3600_000),
    fuso, janelas: boas, excecoes,
  });
  const atual = perto.find((iv) => iv.inicio <= agoraD && agoraD < iv.fim);
  if (atual) {
    return { aberto: true, motivo: MOTIVOS_EXPEDIENTE.ABERTO, rotulo: atual.rotulo, excecao: doDia.excecao, proximaAbertura: null, fechaEm: atual.fim };
  }

  const proxima = proximaAberturaApos({ agora: agoraD, fuso, janelas: boas, excecoes });

  if (doDia.fechadoTodoDia) {
    return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.FERIADO, rotulo: doDia.excecao?.rotulo ?? null, excecao: doDia.excecao, proximaAbertura: proxima, fechaEm: null };
  }

  // INTERVALO x FORA DE HORA. É intervalo quando o dia TEM expediente, já abriu e ainda não acabou —
  // ou seja, estamos no buraco entre duas janelas do mesmo dia. Dizer "estamos fechados" às 12h30 é
  // mentira, e é a diferença entre "voltamos às 13h" e o cliente indo procurar o concorrente.
  // Só janelas do mesmo dia entram nesta conta: plantão que cruza a meia-noite não tem "almoço".
  const mesmoDia = doDia.janelas.filter((j) => !janelaCruzaMeiaNoite(j));
  if (mesmoDia.length >= 2) {
    const primeiraAbre = Math.min(...mesmoDia.map((j) => j.abreMin));
    const ultimaFecha = Math.max(...mesmoDia.map((j) => j.fechaMin));
    if (hoje.minutosDoDia > primeiraAbre && hoje.minutosDoDia < ultimaFecha) {
      return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.INTERVALO, rotulo: null, excecao: doDia.excecao, proximaAbertura: proxima, fechaEm: null };
    }
  }

  return { aberto: false, motivo: MOTIVOS_EXPEDIENTE.FORA_HORA, rotulo: null, excecao: doDia.excecao, proximaAbertura: proxima, fechaEm: null };
}

/** Quando abre de novo. Nulo = não abre dentro do horizonte de duas semanas — resposta honesta,
 *  e é o que a mensagem ao cliente precisa saber para não prometer "voltamos às" sem hora. */
export function proximaAberturaApos({ agora, fuso = FUSO_PADRAO, janelas = [], excecoes = [] }) {
  const agoraD = agora instanceof Date ? agora : new Date(agora);
  const args = { de: agoraD, ate: new Date(agoraD.getTime() + HORIZONTE_DIAS * 86400_000), fuso, janelas, excecoes };
  for (const iv of intervalosMesclados(args)) {
    if (iv.inicio <= agoraD && agoraD < iv.fim) return agoraD; // já está aberto agora
    if (iv.inicio > agoraD) return iv.inicio;
  }
  return null;
}

/**
 * AVANÇA `minutos` DE EXPEDIENTE a partir de `inicio` — o coração da armadilha 1 do cabeçalho.
 *
 * Trinta minutos de tolerância às 17h50 vencem às 8h20 do dia seguinte, não às 18h20 de hoje. Sem
 * isto, o relógio corre de madrugada e a operação amanhece com todas as conversas devolvidas para a
 * fila e um "ainda está aí?" carimbado às 3h no celular do cliente.
 *
 * @returns {Date|null} nulo quando não há expediente suficiente no horizonte — e nulo aqui significa
 *          "não agende", nunca "agende para já".
 */
export function avancarMinutosDeExpediente({ inicio, minutos, fuso = FUSO_PADRAO, janelas = [], excecoes = [] }) {
  const restanteInicial = Number(minutos);
  if (!Number.isFinite(restanteInicial) || restanteInicial < 0) {
    throw new ErroDeAtendimento('MINUTOS_INVALIDOS', 'minutos deve ser um número não negativo', { minutos });
  }
  const inicioD = inicio instanceof Date ? inicio : new Date(inicio);
  const { janelas: boas } = normalizarJanelas(janelas);
  // Sem expediente cadastrado o tempo corre direto — coerente com `avaliarExpediente()`, que trata
  // ausência de janela como operação sempre aberta.
  if (boas.length === 0) return new Date(inicioD.getTime() + restanteInicial * 60_000);

  const args = { de: inicioD, ate: new Date(inicioD.getTime() + HORIZONTE_DIAS_CONSUMO * 86400_000), fuso, janelas: boas, excecoes };
  let restanteMs = restanteInicial * 60_000;
  for (const iv of intervalosMesclados(args)) {
    const de = Math.max(iv.inicio.getTime(), inicioD.getTime());
    const ate = iv.fim.getTime();
    if (ate <= de) continue;
    const disponivel = ate - de;
    if (disponivel >= restanteMs) return new Date(de + restanteMs);
    restanteMs -= disponivel;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. POLÍTICA E HERANÇA DE ESCOPO — funções puras
//
// empresa → caixa de entrada → time (setor). O valor efetivo é o do nível mais específico que TIVER
// o campo preenchido. Nulo significa "herda", nunca "desligado" — um booleano obrigatório em cada
// nível forçaria o setor a repetir a configuração inteira da empresa, que é a dispersão em quatro
// lugares nascendo de novo com outro nome.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Chave calculada NOT NULL do escopo (§4.1).
 * Sem ela, duas políticas de empresa (ambas com `cwInboxId` e `cwTeamId` nulos) escapariam do índice
 * único, porque no Postgres NULO não é igual a NULO — e a empresa acordaria com duas configurações
 * contraditórias sem ninguém ter feito nada errado.
 */
export function escopoChaveDe({ escopo, cwInboxId = null, cwTeamId = null }) {
  if (escopo === 'empresa') return 'empresa';
  if (escopo === 'caixa') {
    const id = inteiroEstrito(cwInboxId);
    if (id === null) throw new ErroDeAtendimento('ESCOPO_INCOMPLETO', 'escopo "caixa" exige cwInboxId');
    return `caixa:${id}`;
  }
  if (escopo === 'time') {
    const id = inteiroEstrito(cwTeamId);
    if (id === null) throw new ErroDeAtendimento('ESCOPO_INCOMPLETO', 'escopo "time" exige cwTeamId');
    return `time:${id}`;
  }
  throw new ErroDeAtendimento('ESCOPO_INVALIDO', `escopo desconhecido: ${escopo}`, { escopo });
}

/**
 * Junta as políticas dos três níveis numa só.
 *
 * `ativa === false` REMOVE a linha da mesclagem em vez de "vencer com false". "Ativa" quer dizer
 * "esta linha vale"; uma política de time desligada tem de deixar a da caixa valer, e não desligar
 * o atendimento do setor inteiro por engano.
 *
 * @returns {{valor:object, origem:object, niveis:string[]}} `origem` diz de qual escopo veio cada
 *          campo — é o que permite a tela responder "por que isto está assim" sem ninguém abrir o
 *          banco, que é a primeira pergunta de todo suporte.
 */
export function mesclarPoliticas(politicas = []) {
  const ordenadas = ESCOPOS
    .map((e) => (politicas ?? []).find((p) => p && p.escopo === e && p.ativa !== false))
    .filter(Boolean);

  const valor = {};
  const origem = {};
  for (const p of ordenadas) {
    for (const [campo, v] of Object.entries(p)) {
      if (['id', 'escopo', 'escopoChave', 'ativa', 'rev', 'criadoEm', 'atualizadoEm',
        'criadoPorUserId', 'atualizadoPorUserId'].includes(campo)) continue;
      const obrigatorio = CAMPOS_NAO_ANULAVEIS.includes(campo);
      if (obrigatorio ? v !== undefined : (v !== null && v !== undefined)) {
        valor[campo] = v;
        origem[campo] = p.escopo;
      }
    }
  }
  if (!valor.fuso) valor.fuso = FUSO_PADRAO;
  return { valor, origem, niveis: ordenadas.map((p) => p.escopo) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. RELÓGIO DE INATIVIDADE — funções puras
//
// É o pedido nº 1 e nº 2 do dono, e a coluna `inatividadeConta` é a funcionalidade inteira.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * O relógio deve estar ARMADO, dado quem falou por último?
 *
 * MODO `contato`   — mede o sumiço do CLIENTE. Só faz sentido depois de o atendente ter respondido:
 *                    enquanto o último a falar for o contato, quem está devendo resposta somos nós.
 * MODO `atendente` — mede o sumiço do ATENDENTE. Só arma enquanto o cliente estiver esperando.
 * MODO `qualquer`  — arma sempre; qualquer fala dos dois lados rearma.
 *
 * `sistema` (robô, automação, o próprio aviso "ainda está aí?") nunca é sinal de vida de ninguém, e
 * por isso não figura como lado que arma nem que rearma — senão o aviso reiniciaria o próprio
 * relógio e a conversa nunca sairia da fila.
 */
export function relogioDeveArmarPorLado(modo, ladoUltimaAtividade) {
  const m = modo ?? MODOS_INATIVIDADE.QUALQUER;
  if (m === MODOS_INATIVIDADE.QUALQUER) return true;
  if (m === MODOS_INATIVIDADE.CONTATO) return ladoUltimaAtividade === LADOS.ATENDENTE;
  if (m === MODOS_INATIVIDADE.ATENDENTE) return ladoUltimaAtividade === LADOS.CONTATO;
  throw new ErroDeAtendimento('MODO_INATIVIDADE_INVALIDO', `modo desconhecido: ${modo}`, { modo });
}

/** Uma nova atividade REARMA o relógio? Fala do sistema não conta, pelo motivo acima. */
export const atividadeRearma = (lado) => lado === LADOS.CONTATO || lado === LADOS.ATENDENTE;

/**
 * A FRONTEIRA ENTRE O MOTOR E O RELÓGIO (§5.3), e é a regra mais fácil de errar do documento 29:
 *
 *   > Enquanto a execução do fluxo está viva, o prazo é do nó `espera` (segundos). O relógio de
 *   > atendimento (minutos) só arma quando a conversa está com humano.
 *
 * Sem ela, quem está no meio de um menu recebe no mesmo minuto o "não entendi, escolha uma opção" do
 * fluxo e o "ainda está aí?" do relógio.
 *
 * ⚠️ DIVERGÊNCIA MEDIDA E DECLARADA: o §5.3 fala em «já terminou com `estado = 'transferido'`», mas
 * `transferido` NÃO É UM ESTADO no motor — os terminais são `concluido | abandonado | erro`, e a
 * saída do nó `time` aparece como `motivoFim`. Aceitamos as duas leituras aqui de propósito, porque
 * recusar a que o motor realmente produz deixaria toda conversa transferida por fluxo SEM relógio —
 * exatamente a conversa esquecida que este arquivo existe para resgatar.
 */
export function relogioDeveArmar(execucao) {
  if (!execucao) return true; // conversa que nunca passou por fluxo é conversa humana desde o "oi"
  const estado = execucao.estado ?? null;
  if (estado === 'pausado_humano') return true;
  if (['concluido', 'abandonado', 'erro', 'transferido'].includes(estado)) return true;
  if (execucao.motivoFim === 'transferido') return true;
  return false;
}

/**
 * Calcula quando este relógio vence.
 *
 * @returns {{venceEm:Date|null, congelado:boolean, motivoCongelado:string|null}}
 *          `venceEm` nulo com `congelado` verdadeiro significa "não há expediente suficiente no
 *          horizonte": não agende. Agendar para "já" seria a armadilha 1 por outro caminho.
 */
export function calcularVencimento({
  inicio, minutos, fuso = FUSO_PADRAO, janelas = [], excecoes = [], contaForaExpediente = false,
}) {
  const inicioD = inicio instanceof Date ? inicio : new Date(inicio);
  if (contaForaExpediente) {
    return { venceEm: new Date(inicioD.getTime() + Number(minutos) * 60_000), congelado: false, motivoCongelado: null };
  }
  const venceEm = avancarMinutosDeExpediente({ inicio: inicioD, minutos, fuso, janelas, excecoes });
  if (!venceEm) {
    return { venceEm: null, congelado: true, motivoCongelado: 'sem_expediente_no_horizonte' };
  }
  const naAbertura = avaliarExpediente({ agora: inicioD, fuso, janelas, excecoes });
  return {
    venceEm,
    congelado: !naAbertura.aberto,
    motivoCongelado: naAbertura.aberto ? null : naAbertura.motivo,
  };
}

/**
 * Planeja UM relógio a partir da política e do estado da conversa. Puro: nada de banco, nada de rede.
 * Devolve a intenção; quem executa é `dispararRelogio()`.
 *
 * @returns {{arma:boolean, motivo:string, tipo:string|null, venceEm:Date|null, congelado:boolean}}
 */
export function planejarRelogioDeInatividade({
  politica, agora, ultimaAtividadeEm, ultimaAtividadeLado, execucao = null, janelas = [], excecoes = [],
}) {
  const p = politica ?? {};
  if (!p.inatividadeAtiva) return { arma: false, motivo: 'desligada', tipo: null, venceEm: null, congelado: false };
  const minutos = Number(p.inatividadeMinutos);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    return { arma: false, motivo: 'sem_minutos', tipo: null, venceEm: null, congelado: false };
  }
  if (!relogioDeveArmar(execucao)) {
    return { arma: false, motivo: 'fluxo_no_comando', tipo: null, venceEm: null, congelado: false };
  }
  if (!relogioDeveArmarPorLado(p.inatividadeConta, ultimaAtividadeLado)) {
    return { arma: false, motivo: 'lado_nao_conta', tipo: null, venceEm: null, congelado: false };
  }

  const fuso = p.fuso ?? FUSO_PADRAO;
  const base = ultimaAtividadeEm ?? agora;

  // O AVISO PRÉVIO É UM RELÓGIO PRÓPRIO, e não um enfeite do principal: ele vence antes, dispara uma
  // mensagem e NÃO muda o estado da conversa. Devolver para a fila sem avisar é surpresa para o
  // cliente que só demorou a digitar.
  const avisoMin = Number(p.inatividadeAvisoMinutos);
  const temAviso = Number.isFinite(avisoMin) && avisoMin > 0 && avisoMin < minutos;

  const alvo = temAviso ? avisoMin : minutos;
  const tipo = temAviso ? TIPOS_RELOGIO.AVISO : TIPOS_RELOGIO.INATIVIDADE;
  const { venceEm, congelado } = calcularVencimento({
    inicio: base, minutos: alvo, fuso, janelas, excecoes,
    contaForaExpediente: p.inatividadeContaForaExpediente === true,
  });
  if (!venceEm) return { arma: false, motivo: 'sem_expediente_no_horizonte', tipo: null, venceEm: null, congelado: true };
  return { arma: true, motivo: 'armado', tipo, venceEm, congelado };
}

/**
 * O TRANSBORDO por tempo em fila — o `timeToTransfer` da origem, agora com gatilho de tempo de
 * verdade. "Ninguém assumiu em X minutos → passa para outro setor."
 *
 * ⚠️ POR QUE ISTO NÃO É UMA REGRA DE AUTOMAÇÃO DA PLATAFORMA: `[medido 29/08]` o atraso nativo está
 * atrás da bandeira `delayed_automations` (que devolveu `false`) e só admite condição sobre `status`
 * e `inbox_id`, com o episódio chaveado em `status_changed_at`. Dá para dizer "está aberta há 30
 * min"; NÃO dá para dizer "ninguém assumiu há 30 min", porque mensagem nova não muda o status e
 * portanto não rearma o relógio de lá.
 *
 * O relógio de transbordo é INDEPENDENTE do de inatividade: um mede a espera na fila, o outro mede
 * o silêncio no atendimento. Misturá-los num só faria a conversa transferida perder o prazo de
 * espera que ela já tinha acumulado.
 */
export function planejarRelogioDeTransbordo({ politica, entrouNaFilaEm, janelas = [], excecoes = [] }) {
  const p = politica ?? {};
  if (!p.transbordoAtivo) return { arma: false, motivo: 'desligado', tipo: null, venceEm: null, congelado: false };
  const minutos = Number(p.transbordoMinutos);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    return { arma: false, motivo: 'sem_minutos', tipo: null, venceEm: null, congelado: false };
  }
  if (inteiroEstrito(p.transbordoTimeId) === null) {
    // Transbordar para lugar nenhum deixaria a conversa órfã — pior que não transbordar.
    return { arma: false, motivo: 'sem_time_destino', tipo: null, venceEm: null, congelado: false };
  }
  const { venceEm, congelado } = calcularVencimento({
    inicio: entrouNaFilaEm, minutos, fuso: p.fuso ?? FUSO_PADRAO, janelas, excecoes,
    // A espera na fila também só conta em expediente: ninguém vai assumir a conversa às 3h, e
    // transbordar de madrugada só troca uma fila vazia por outra.
    contaForaExpediente: p.inatividadeContaForaExpediente === true,
  });
  if (!venceEm) return { arma: false, motivo: 'sem_expediente_no_horizonte', tipo: null, venceEm: null, congelado: true };
  return { arma: true, motivo: 'armado', tipo: TIPOS_RELOGIO.TRANSBORDO, venceEm, congelado };
}

/**
 * O que fazer quando o relógio vence. Puro — devolve um PLANO, e o plano é o que o teste inspeciona.
 *
 * A separação entre plano e execução não é purismo: a ação de estado e a mensagem ao cliente têm
 * destinos e falhas diferentes. Fora da janela de 24 h da Meta a mudança de estado ACONTECE e a
 * mensagem NÃO — e o motivo precisa sobrar escrito na nota interna, senão o atendente encontra uma
 * conversa devolvida para a fila sem nenhuma explicação.
 */
export function planejarAcaoDoRelogio({ politica, tipo, contexto = {} }) {
  const p = politica ?? {};
  if (tipo === TIPOS_RELOGIO.AVISO) {
    return {
      acao: ACOES_INATIVIDADE.NENHUMA,
      mudarStatus: null, removerAgente: false, timeDestino: null,
      mensagemAoCliente: aplicarModelo(p.inatividadeAvisoMensagem ?? null, contexto).texto,
      notaInterna: 'Aviso de inatividade enviado; o prazo principal continua correndo.',
      rearmarComo: TIPOS_RELOGIO.INATIVIDADE,
    };
  }
  if (tipo === TIPOS_RELOGIO.TRANSBORDO) {
    return {
      acao: ACOES_INATIVIDADE.TRANSFERIR_TIME,
      mudarStatus: null, removerAgente: false, timeDestino: p.transbordoTimeId ?? null,
      mensagemAoCliente: aplicarModelo(p.transbordoMensagem ?? null, contexto).texto,
      notaInterna: `Transbordo automático por tempo em fila (${p.transbordoMinutos ?? '?'} min).`,
      rearmarComo: null,
    };
  }

  const acao = p.inatividadeAcao ?? ACOES_INATIVIDADE.DEVOLVER_FILA;
  const mensagem = aplicarModelo(p.inatividadeMensagem ?? null, contexto).texto;
  const comum = { mensagemAoCliente: mensagem, rearmarComo: null };
  switch (acao) {
    case ACOES_INATIVIDADE.DEVOLVER_FILA:
      // `pending` + tirar o agente é o caminho nativo (a ação existe; o gatilho de tempo é nosso).
      return { ...comum, acao, mudarStatus: 'pending', removerAgente: true, timeDestino: null,
        notaInterna: 'Devolvida à fila por inatividade.' };
    case ACOES_INATIVIDADE.TRANSFERIR_TIME:
      return { ...comum, acao, mudarStatus: 'pending', removerAgente: true, timeDestino: p.inatividadeTimeDestino ?? null,
        notaInterna: 'Transferida de setor por inatividade.' };
    case ACOES_INATIVIDADE.RESOLVER:
      return { ...comum, acao, mudarStatus: 'resolved', removerAgente: false, timeDestino: null,
        notaInterna: 'Encerrada automaticamente por inatividade.' };
    case ACOES_INATIVIDADE.NOTIFICAR:
      // Sem mudança de estado: só avisa quem tem de saber. A saída é o nó `notificar` do motor, que
      // já recusa número de telefone cravado e exige destinatário por papel, time ou usuário.
      return { ...comum, acao, mudarStatus: null, removerAgente: false, timeDestino: null,
        notaInterna: 'Inatividade sinalizada à supervisão.' };
    default:
      throw new ErroDeAtendimento('ACAO_INVALIDA', `ação de inatividade desconhecida: ${acao}`, { acao });
  }
}

/**
 * Substituição de `{{caminho.pontilhado}}` nas mensagens.
 *
 * ⚠️ PLACEHOLDER DESCONHECIDO VIRA VAZIO, e a lista dos que faltaram volta no retorno. Deixar
 * `{{expediente.proximaAbertura}}` cru na tela do cliente é pior que a frase incompleta — mas
 * engolir a falha em silêncio impediria alguém de descobrir o erro de digitação no cadastro, e por
 * isso `faltantes` existe e é registrado no log de quem chama.
 */
export function aplicarModelo(texto, contexto = {}) {
  if (texto == null || texto === '') return { texto: texto ?? null, faltantes: [] };
  const faltantes = [];
  const saida = String(texto).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_todo, caminho) => {
    let v = contexto;
    for (const parte of caminho.split('.')) {
      v = v == null ? undefined : v[parte];
    }
    if (v === undefined || v === null) { faltantes.push(caminho); return ''; }
    return String(v);
  });
  return { texto: saida, faltantes };
}

/**
 * O contexto do §5.5 — as variáveis que o nó `condicao` lê. Expediente entra como VARIÁVEL, não como
 * nó novo: um tipo de nó novo obrigaria todo fluxo existente a ser reeditado para ganhar a regra, e
 * espalharia a decisão de horário pelos 35 fluxos.
 */
export function montarContextoDeExpediente({ expediente, fuso = FUSO_PADRAO, filaAguardandoMinutos = null, atendentesDisponiveis = null }) {
  const proxima = expediente?.proximaAbertura ?? null;
  const p = proxima ? partesNoFuso(proxima, fuso) : null;
  return {
    expediente: {
      aberto: !!expediente?.aberto,
      motivo: expediente?.motivo ?? MOTIVOS_EXPEDIENTE.SEM_CONFIGURACAO,
      rotulo: expediente?.rotulo ?? null,
      proximaAbertura: p ? `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} às ${hhmm(p.minutosDoDia)}` : null,
      proximaAberturaISO: proxima ? proxima.toISOString() : null,
      proximaAberturaHora: p ? hhmm(p.minutosDoDia) : null,
    },
    fila: { aguardandoMinutos: filaAguardandoMinutos },
    atendentes: { disponiveis: atendentesDisponiveis },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. RESOLVEDOR DE ENTRADA — qual fluxo atende esta mensagem (§5.2)
//
// É O ELO QUE FALTA, medido: `iniciarOuRecuperarExecucao()` exige `fluxoId` e `versaoId`, e nenhum
// código do repositório a chama. O motor está pronto há tempo e nunca recebeu o chamador.
//
// A PRECEDÊNCIA É ESCRITA UMA VEZ SÓ, aqui. Duas decisões sobre a mesma coisa é como nascem dois
// comportamentos para a mesma conversa — e depois ninguém consegue dizer qual é o certo.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O que o resolvedor manda fazer. */
export const ACOES_ENTRADA = Object.freeze({
  INICIAR_FLUXO: 'iniciar_fluxo',
  /** Manda a mensagem e para. Almoço é o caso típico: "voltamos às 13h" não é um fluxo. */
  SO_MENSAGEM: 'so_mensagem',
  /** Nada de robô: a conversa vai direto para gente. Nunca fica sem dono. */
  FILA_HUMANA: 'fila_humana',
});

/**
 * A mensagem casa com alguma palavra-chave configurada?
 *
 * ⚠️ COMPARAÇÃO SÓ POR CAIXA, SEM TIRAR ACENTO, e isto é uma escolha declarada. Tirar acento faria
 * "sao" casar com "são" — cômodo — mas também faria "cao" casar com "cão", e ninguém aqui pediu
 * casamento aproximado. Quem quiser tolerância a acento cadastra as duas formas, que é explícito e
 * auditável. Mudar isto em silêncio depois altera o roteamento de conversas já em produção.
 */
export function casaPalavraChave(texto, palavrasChave = []) {
  const cru = String(texto ?? '').trim();
  if (!cru) return null;
  for (const pc of palavrasChave ?? []) {
    const alvoCru = String(pc?.palavra ?? '').trim();
    if (!alvoCru) continue;
    const diferencia = pc?.diferenciaMaiuscula === true;
    const t = diferencia ? cru : cru.toLocaleLowerCase('pt-BR');
    const alvo = diferencia ? alvoCru : alvoCru.toLocaleLowerCase('pt-BR');
    const tipo = pc?.tipo ?? 'exata';
    let bateu = false;
    if (tipo === 'exata') bateu = t === alvo;
    else if (tipo === 'contem') bateu = t.includes(alvo);
    else if (tipo === 'comeca') bateu = t.startsWith(alvo);
    else {
      // Tipo desconhecido NÃO casa e NÃO estoura: um cadastro errado não pode derrubar o
      // atendimento inteiro. Ele fica visível no log de quem chama, via `problemas`.
      continue;
    }
    if (bateu) return { palavra: alvoCru, tipo };
  }
  return null;
}

/**
 * É primeiro contato?
 *
 * DEFINIDO POR MEDIÇÃO, não por adivinhação: é primeiro contato quando não existe execução anterior
 * para aquela conversa, OU a última terminou há mais de `reiniciaFluxoAposHoras`. Os dois dados já
 * existem (`RagnabotFluxoExecucao.encerradaEm`), e sem um número objetivo cada trecho de código
 * inventaria o seu — que é como nascem dois comportamentos para a mesma conversa.
 */
export function ehPrimeiroContato({ execucaoAnterior, agora, reiniciaFluxoAposHoras = 24 }) {
  if (!execucaoAnterior) return true;
  const fim = execucaoAnterior.encerradaEm ?? execucaoAnterior.atualizadaEm ?? null;
  if (!fim) return false; // existe execução e ela não terminou: a conversa está em andamento
  const horas = (new Date(agora).getTime() - new Date(fim).getTime()) / 3600_000;
  return horas > Number(reiniciaFluxoAposHoras ?? 24);
}

/**
 * A DECISÃO, pura. Recebe tudo mastigado e devolve o que fazer.
 *
 * @returns {{acao:string, fluxoId:string|null, motivo:string, mensagem:string|null,
 *            encerrarApos:boolean, expediente:object}}
 */
export function resolverFluxoDeEntrada({
  texto, politica, expediente, primeiroContato, fluxosPorPalavraChave = [], fluxoDaCaixa = null, contexto = {},
}) {
  const p = politica ?? {};
  const ctx = { ...montarContextoDeExpediente({ expediente, fuso: p.fuso ?? FUSO_PADRAO }), ...contexto };
  const msg = (campo) => aplicarModelo(p[campo] ?? null, ctx).texto;

  // 1. PALAVRA-CHAVE vence tudo, inclusive o expediente. Quem digita "2ª via" às 23h quer a segunda
  //    via, e o robô sabe entregar sem gente. Barrar por horário aqui seria transformar um serviço
  //    automático em fila de espera sem motivo.
  for (const f of fluxosPorPalavraChave ?? []) {
    const casou = casaPalavraChave(texto, f?.palavrasChave ?? []);
    if (casou) {
      return { acao: ACOES_ENTRADA.INICIAR_FLUXO, fluxoId: f.id, motivo: `palavra_chave:${casou.palavra}`, mensagem: null, encerrarApos: false, expediente };
    }
  }

  // 2 e 3. FERIADO e FORA DE HORA seguem o mesmo caminho: fluxo próprio se houver, senão a mensagem.
  if (!expediente?.aberto && (expediente?.motivo === MOTIVOS_EXPEDIENTE.FERIADO || expediente?.motivo === MOTIVOS_EXPEDIENTE.FORA_HORA)) {
    const ehFeriado = expediente.motivo === MOTIVOS_EXPEDIENTE.FERIADO;
    const texto1 = (ehFeriado ? (aplicarModelo(expediente?.excecao?.mensagem ?? null, ctx).texto || msg('msgFeriado')) : null) || msg('msgForaExpediente');
    if (p.fluxoForaExpedienteId) {
      return { acao: ACOES_ENTRADA.INICIAR_FLUXO, fluxoId: p.fluxoForaExpedienteId, motivo: expediente.motivo, mensagem: null, encerrarApos: false, expediente };
    }
    return {
      acao: texto1 ? ACOES_ENTRADA.SO_MENSAGEM : ACOES_ENTRADA.FILA_HUMANA,
      fluxoId: null, motivo: expediente.motivo, mensagem: texto1,
      encerrarApos: p.encerrarAposForaExpediente === true, expediente,
    };
  }

  // 4. INTERVALO tem texto PRÓPRIO e, por padrão, NÃO usa o fluxo de fora de expediente. Dizer
  //    "estamos fechados" às 12h30 é mentira — a operação volta em meia hora, e a frase certa é
  //    "voltamos às 13h". É a diferença entre segurar o cliente e mandá-lo para o concorrente.
  if (!expediente?.aberto && expediente?.motivo === MOTIVOS_EXPEDIENTE.INTERVALO) {
    const texto2 = msg('msgIntervalo') || msg('msgForaExpediente');
    return {
      acao: texto2 ? ACOES_ENTRADA.SO_MENSAGEM : ACOES_ENTRADA.FILA_HUMANA,
      fluxoId: null, motivo: MOTIVOS_EXPEDIENTE.INTERVALO, mensagem: texto2,
      encerrarApos: false, expediente, // almoço NUNCA encerra a conversa: a operação volta já
    };
  }

  // 5. PRIMEIRO "OI" — o `firstContactFlowId` da origem, que lá é um campo distinto do fluxo padrão.
  if (primeiroContato && p.fluxoPrimeiroContatoId) {
    return { acao: ACOES_ENTRADA.INICIAR_FLUXO, fluxoId: p.fluxoPrimeiroContatoId, motivo: 'primeiro_contato', mensagem: null, encerrarApos: false, expediente };
  }

  // 6. FLUXO PADRÃO: o da política, e só então o que a própria caixa declara (`entrada='caixa'`).
  const padrao = p.fluxoPadraoId ?? fluxoDaCaixa?.id ?? null;
  if (padrao) {
    return { acao: ACOES_ENTRADA.INICIAR_FLUXO, fluxoId: padrao, motivo: p.fluxoPadraoId ? 'fluxo_padrao' : 'fluxo_da_caixa', mensagem: null, encerrarApos: false, expediente };
  }

  // 7. NENHUM FLUXO. A conversa vai para gente — nunca fica sem dono, que é a única saída aceitável.
  return { acao: ACOES_ENTRADA.FILA_HUMANA, fluxoId: null, motivo: 'sem_fluxo', mensagem: msg('msgSaudacao'), encerrarApos: false, expediente };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. TRANSFERÊNCIA (§1.3 e §4.6)
//
// A reclamação que abriu esta frente. A causa medida do "não consigo transferir" é cadastro (a conta
// tem ZERO times), mas cadastrar times destrava o botão e NÃO entrega a transferência que uma
// operação séria usa: hoje ela é a troca silenciosa de `assignee_id`, sem motivo, sem nota de
// passagem, sem aviso a quem recebe e sem relatório.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const ORIGENS_TRANSFERENCIA = Object.freeze(['manual', 'automacao', 'fluxo', 'transbordo', 'inatividade', 'turno']);

/**
 * Valida e planeja uma transferência. Puro.
 *
 * ⚠️ O ESCOPO É CHECADO AQUI, E NÃO NA TELA. `[medido 29/08]` o `Conversations::AssignmentService` do
 * destino procura o destinatário com `conversation.account.users.find_by(id:)` — pela API dá para
 * atribuir a conversa a QUALQUER usuário da conta, mesmo sem acesso àquela caixa de entrada. A tela
 * esconde o problema porque só lista agentes atribuíveis; a API, não. Escopo que vem da tela é
 * escopo que o cliente escolhe.
 */
export function planejarTransferencia({
  conversa, de, para, motivo = null, notaInterna = null, origem = 'manual', ator = null,
  politica = null, agentesAtribuiveis = null, timesDaConta = null, contexto = {},
}) {
  if (!conversa?.cwAccountId || !conversa?.cwConversationId) {
    throw new ErroDeAtendimento('CONVERSA_INCOMPLETA', 'cwAccountId e cwConversationId são obrigatórios');
  }
  if (!ORIGENS_TRANSFERENCIA.includes(origem)) {
    throw new ErroDeAtendimento('ORIGEM_INVALIDA', `origem desconhecida: ${origem}`, { origem });
  }
  if (!para || !['agente', 'time'].includes(para.tipo)) {
    throw new ErroDeAtendimento('DESTINO_INVALIDO', 'destino precisa ser {tipo:"agente"|"time", id}');
  }
  const paraId = inteiroEstrito(para.id);
  if (paraId === null) {
    throw new ErroDeAtendimento('DESTINO_INVALIDO', 'destino precisa de um id numérico');
  }

  // A empresa do ATOR manda. Nunca a que veio no corpo da requisição.
  if (conversa.tenantId && ator?.tenantId && conversa.tenantId !== ator.tenantId) {
    throw new ErroDeAtendimento('ESCOPO_NEGADO', 'a conversa não pertence à empresa do usuário', {
      tenantDaConversa: conversa.tenantId, tenantDoAtor: ator.tenantId,
    });
  }
  if (para.tipo === 'agente' && Array.isArray(agentesAtribuiveis) && !agentesAtribuiveis.map(Number).includes(paraId)) {
    throw new ErroDeAtendimento('DESTINO_FORA_DA_CAIXA', 'o agente de destino não atende esta caixa de entrada', { agente: para.id });
  }
  if (para.tipo === 'time' && Array.isArray(timesDaConta) && !timesDaConta.map(Number).includes(paraId)) {
    // `[medido 29/08]` `Account.first.teams.count` = 0. Enquanto não houver time cadastrado, esta é
    // a mensagem que o operador precisa ler — e ela diz o que fazer, não só que falhou.
    throw new ErroDeAtendimento('TIME_INEXISTENTE',
      'o time de destino não existe nesta conta. Cadastre os Times (Setores) em Configurações → Times.', { time: para.id });
  }

  const p = politica ?? {};
  const ctx = { ...contexto, transferencia: { paraNome: para.nome ?? null, deNome: de?.nome ?? null, motivo } };
  const campoMsg = para.tipo === 'time' ? 'msgTransferenciaTime' : 'msgTransferenciaAgente';
  const mensagemAoCliente = aplicarModelo(p[campoMsg] ?? null, ctx).texto;

  return {
    registro: {
      tenantId: conversa.tenantId ?? ator?.tenantId ?? null,
      cwAccountId: conversa.cwAccountId,
      cwConversationId: conversa.cwConversationId,
      protocolo: conversa.protocolo ?? null,
      deTipo: de?.tipo ?? 'ninguem',
      deId: de?.id ?? null,
      deNome: de?.nome ?? null,
      paraTipo: para.tipo,
      paraId,
      paraNome: para.nome ?? null,
      motivo, notaInterna, origem,
      atorUserId: origem === 'manual' ? (ator?.id ?? null) : null,
    },
    mensagemAoCliente,
    // Quem recebe precisa SABER que recebeu, e por quê. Sai pelo nó `notificar` do motor, com
    // destinatário por papel/time/usuário — nunca número de telefone cravado, que a validação recusa.
    notificar: {
      destinatario: para.tipo === 'time' ? { tipo: 'time', id: paraId } : { tipo: 'usuario', id: paraId },
      texto: montarAvisoDeTransferencia({ de, para, motivo, notaInterna, protocolo: conversa.protocolo ?? null }),
    },
  };
}

/** O texto que quem recebe a conversa lê. Curto de propósito: quem está atendendo lê no celular. */
export function montarAvisoDeTransferencia({ de, para, motivo, notaInterna, protocolo }) {
  const linhas = [];
  linhas.push(`🔁 Atendimento transferido para você${para?.nome ? ` (${para.nome})` : ''}.`);
  if (protocolo) linhas.push(`Protocolo: ${protocolo}`);
  if (de?.nome) linhas.push(`De: ${de.nome}`);
  if (motivo) linhas.push(`Motivo: ${motivo}`);
  if (notaInterna) linhas.push(`Nota: ${notaInterna}`);
  return linhas.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. CAMINHOS QUE TOCAM O BANCO
//
// Daqui para baixo nada é puro. Toda consulta filtra pela empresa (`tenantId`) que veio do usuário
// logado — nunca por parâmetro da tela. Foi assim que o sistema antigo vazou.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Chave do relógio: "conta:conversa:tipo". NOT NULL e única — mata dois defeitos de uma vez, o
 *  relógio duplicado (o cliente lendo "ainda está aí?" duas vezes) e a corrida entre o trabalhador
 *  e o evento de mensagem nova. */
export const chaveRelogio = ({ cwAccountId, cwConversationId, tipo }) => `${cwAccountId}:${cwConversationId}:${tipo}`;

/** Chave de partição da fila do motor. ⚠️ DUPLICAÇÃO DECLARADA de `chaveParticaoDe()` do
 *  `ragnabot-fluxo-motor.service.js`: um `import` estático criaria dependência de arranque entre dois
 *  serviços em construção simultânea, e módulo que não carrega derruba o processo inteiro. É uma
 *  linha, e o formato "conta:conversa" está fixado no schema da fila. */
const chaveParticao = ({ cwAccountId, cwConversationId }) => `${cwAccountId}:${cwConversationId}`;

/** Carimbo de frescor. Se qualquer um destes mudou entre o agendamento e o processamento, o
 *  despertar é obsoleto — o cliente respondeu antes do prazo. Mesmo raciocínio do `tokenVisita`. */
const carimboDoRelogio = (r) => [
  r?.venceEm ? new Date(r.venceEm).toISOString() : '-',
  r?.ultimaAtividadeEm ? new Date(r.ultimaAtividadeEm).toISOString() : '-',
  r?.ultimaAtividadeLado ?? '-',
  r?.tipo ?? '-',
].join('|');

/**
 * Monta a política efetiva dos três escopos, já com janelas e exceções.
 * Uma leitura só por conversa; o resultado é o que alimenta todas as decisões.
 */
export async function carregarPoliticaEfetiva({ tenantId, cwAccountId, cwInboxId = null, cwTeamId = null }) {
  if (!tenantId) throw new ErroDeAtendimento('TENANT_OBRIGATORIO', 'tenantId é obrigatório');
  const modelo = exigirModelo('ragnabotAtendPolitica');

  const chaves = ['empresa'];
  const idCaixa = inteiroEstrito(cwInboxId);
  const idTime = inteiroEstrito(cwTeamId);
  if (idCaixa !== null) chaves.push(`caixa:${idCaixa}`);
  if (idTime !== null) chaves.push(`time:${idTime}`);

  const linhas = await modelo.findMany({ where: { tenantId, cwAccountId, escopoChave: { in: chaves } } });
  const { valor, origem, niveis } = mesclarPoliticas(linhas);

  // ── DE QUEM É O EXPEDIENTE ──────────────────────────────────────────────────────────────────
  // O calendário é herdado COMO BLOCO, e nunca misturado. Duas regras, e as duas por um motivo:
  //
  //   (a) NÃO SE MISTURA. Juntar as janelas da empresa com as do setor produziria um terceiro
  //       expediente que ninguém cadastrou, e ninguém conseguiria explicar de onde ele veio.
  //   (b) MAS SE HERDA INTEIRO. Uma política de time criada só para trocar a mensagem do almoço
  //       não tem janela nenhuma. Tratar isso como "expediente vazio" apagaria o horário da empresa
  //       e o setor passaria a atender 24 h — o oposto do que quem preencheu a tela quis dizer.
  //       Então vale o calendário do nível mais específico QUE TIVER JANELAS.
  //
  // `politicaBase` continua sendo a linha mais específica (é ela que o relógio guarda para
  // reconstruir o mesmo escopo no disparo); `politicaDoExpediente` diz de quem é o calendário.
  const candidatos = ESCOPOS.map((e) => linhas.find((l) => l.escopo === e && l.ativa !== false)).filter(Boolean);
  const base = candidatos.length ? candidatos[candidatos.length - 1] : null;
  let janelas = [];
  let excecoes = [];
  let politicaDoExpediente = null;
  if (candidatos.length) {
    const ids = candidatos.map((c) => c.id);
    const todas = await exigirModelo('ragnabotAtendExpediente').findMany({ where: { tenantId, politicaId: { in: ids }, ativo: true } });
    for (let i = candidatos.length - 1; i >= 0; i -= 1) {
      const doNivel = todas.filter((j) => j.politicaId === candidatos[i].id);
      if (doNivel.length) { politicaDoExpediente = candidatos[i]; janelas = doNivel; break; }
    }
    // Feriado acompanha o calendário: um recesso cadastrado junto do expediente da empresa não pode
    // desaparecer porque o setor tem uma política própria de mensagens.
    const dono = politicaDoExpediente ?? base;
    excecoes = await exigirModelo('ragnabotAtendExcecaoData').findMany({ where: { tenantId, politicaId: dono.id } });
  }
  return { politica: valor, origem, niveis, politicaBase: base, politicaDoExpediente, janelas, excecoes, linhas };
}

/**
 * A política efetiva a partir da linha-base que o relógio guardou.
 *
 * ⚠️ POR QUE NÃO BASTA RECARREGAR PELO `tenantId`: o relógio pode ter sido armado sob a política de
 * uma CAIXA ou de um TIME, e recarregar só o escopo de empresa devolveria outra configuração —
 * outro fuso, outro expediente, outra ação. A conversa seria devolvida à fila segundo uma regra que
 * ninguém aplicou a ela. `politicaId` é o que amarra o disparo à decisão que o armou.
 */
export async function carregarPoliticaPelaBase({ tenantId, politicaId }) {
  if (!politicaId) return null;
  const base = await exigirModelo('ragnabotAtendPolitica').findUnique({ where: { id: politicaId } });
  if (!base || base.tenantId !== tenantId) return null;
  return carregarPoliticaEfetiva({
    tenantId, cwAccountId: base.cwAccountId, cwInboxId: base.cwInboxId ?? null, cwTeamId: base.cwTeamId ?? null,
  });
}

/** "Está aberto agora?", com tudo já lido do banco. */
export async function avaliarExpedienteAgora({ tenantId, cwAccountId, cwInboxId = null, cwTeamId = null, agora = null }) {
  const { politica, janelas, excecoes } = await carregarPoliticaEfetiva({ tenantId, cwAccountId, cwInboxId, cwTeamId });
  const quando = agora ?? await agoraDoBanco();
  return {
    politica,
    expediente: avaliarExpediente({ agora: quando, fuso: politica.fuso ?? FUSO_PADRAO, janelas, excecoes }),
  };
}

/**
 * Uma mensagem chegou (ou o atendente respondeu): rearma ou desarma o relógio.
 *
 * É O ÚNICO CAMINHO que escreve `RagnabotAtendRelogio` no fluxo normal, e é idempotente por `chave`.
 * Chamado pela portaria a cada mensagem, e por quem atribui/devolve a conversa.
 */
export async function registrarAtividade({
  tenantId, cwAccountId, cwConversationId, lado, em = null, execucao = null,
  cwInboxId = null, cwTeamId = null,
}) {
  if (!atividadeRearma(lado)) return { acao: 'ignorado', motivo: 'lado_sistema' };
  const relogios = exigirModelo('ragnabotAtendRelogio');
  const agora = await agoraDoBanco();
  const quando = em ? new Date(em) : agora;

  const { politica, politicaBase, janelas, excecoes } = await carregarPoliticaEfetiva({ tenantId, cwAccountId, cwInboxId, cwTeamId });
  const plano = planejarRelogioDeInatividade({
    politica, agora, ultimaAtividadeEm: quando, ultimaAtividadeLado: lado, execucao, janelas, excecoes,
  });

  if (!plano.arma) {
    // Desarmar é APAGAR, e não deixar vencido: relógio parado no banco é relógio que um trabalhador
    // futuro acorda sem contexto. O histórico do que aconteceu mora na auditoria, não aqui.
    const apagados = await relogios.deleteMany({
      where: { cwAccountId, cwConversationId, tipo: { in: [TIPOS_RELOGIO.INATIVIDADE, TIPOS_RELOGIO.AVISO] }, disparadoEm: null },
    });
    return { acao: 'desarmado', motivo: plano.motivo, apagados: apagados?.count ?? 0 };
  }

  // ⚠️ `RagnabotAtendRelogio.politicaId` é NOT NULL no schema. Chegar aqui sem política-base só é
  // possível se alguém desacoplar `planejarRelogioDeInatividade()` da existência da linha — e o
  // sintoma seria um erro de restrição do Postgres no meio da rajada, com uma mensagem que não diz
  // nada sobre atendimento. Recusar armar é a falha legível.
  if (!politicaBase) return { acao: 'desarmado', motivo: 'sem_politica_base' };

  const chave = chaveRelogio({ cwAccountId, cwConversationId, tipo: plano.tipo });
  const dados = {
    tenantId, cwAccountId, cwConversationId, politicaId: politicaBase.id,
    tipo: plano.tipo, chave,
    ultimaAtividadeEm: quando, ultimaAtividadeLado: lado,
    venceEm: plano.venceEm,
    pausadoMotivo: plano.congelado ? 'fora_expediente' : null,
    disparadoEm: null, resultado: null, erro: null,
  };
  const salvo = await relogios.upsert({ where: { chave }, create: dados, update: dados });

  // O outro tipo some: se o aviso foi rearmado, o principal antigo não vale mais, e vice-versa.
  const outro = plano.tipo === TIPOS_RELOGIO.AVISO ? TIPOS_RELOGIO.INATIVIDADE : TIPOS_RELOGIO.AVISO;
  await relogios.deleteMany({ where: { chave: chaveRelogio({ cwAccountId, cwConversationId, tipo: outro }), disparadoEm: null } });

  return { acao: 'armado', tipo: plano.tipo, venceEm: plano.venceEm, congelado: plano.congelado, relogio: salvo };
}

/**
 * A conversa ENTROU NA FILA (virou `pending`, ou nasceu sem dono): arma o relógio de transbordo.
 * Chamado pela portaria e pelo próprio despacho de `devolver_fila`.
 */
export async function registrarEntradaNaFila({
  tenantId, cwAccountId, cwConversationId, em = null, cwInboxId = null, cwTeamId = null,
}) {
  const relogios = exigirModelo('ragnabotAtendRelogio');
  const agora = await agoraDoBanco();
  const quando = em ? new Date(em) : agora;
  const { politica, politicaBase, janelas, excecoes } = await carregarPoliticaEfetiva({ tenantId, cwAccountId, cwInboxId, cwTeamId });
  const plano = planejarRelogioDeTransbordo({ politica, entrouNaFilaEm: quando, janelas, excecoes });
  if (!plano.arma) {
    await relogios.deleteMany({ where: { cwAccountId, cwConversationId, tipo: TIPOS_RELOGIO.TRANSBORDO, disparadoEm: null } });
    return { acao: 'desarmado', motivo: plano.motivo };
  }
  if (!politicaBase) return { acao: 'desarmado', motivo: 'sem_politica_base' }; // NOT NULL — ver nota acima

  const chave = chaveRelogio({ cwAccountId, cwConversationId, tipo: TIPOS_RELOGIO.TRANSBORDO });
  const dados = {
    tenantId, cwAccountId, cwConversationId, politicaId: politicaBase.id,
    tipo: TIPOS_RELOGIO.TRANSBORDO, chave,
    ultimaAtividadeEm: quando, ultimaAtividadeLado: LADOS.SISTEMA,
    venceEm: plano.venceEm, pausadoMotivo: plano.congelado ? 'fora_expediente' : null,
    disparadoEm: null, resultado: null, erro: null,
  };
  const salvo = await relogios.upsert({ where: { chave }, create: dados, update: dados });
  return { acao: 'armado', tipo: TIPOS_RELOGIO.TRANSBORDO, venceEm: plano.venceEm, relogio: salvo };
}

/** Alguém ASSUMIU a conversa: o relógio de espera na fila morre. Sem isto, a conversa que acabou de
 *  ser atendida seria transferida de setor no meio do atendimento. */
export const registrarAssuncao = ({ cwAccountId, cwConversationId }) =>
  cancelarRelogios({ cwAccountId, cwConversationId, tipos: [TIPOS_RELOGIO.TRANSBORDO] });

/** A conversa saiu de cena (resolvida, silenciada, assumida pelo fluxo). Nenhum relógio sobra. */
export async function cancelarRelogios({ cwAccountId, cwConversationId, tipos = null }) {
  const relogios = exigirModelo('ragnabotAtendRelogio');
  const where = { cwAccountId, cwConversationId, disparadoEm: null };
  if (Array.isArray(tipos) && tipos.length) where.tipo = { in: tipos };
  const r = await relogios.deleteMany({ where });
  return { apagados: r?.count ?? 0 };
}

/**
 * O TRABALHADOR: acha o que venceu e entrega à fila do motor.
 *
 * A verdade é a linha do relógio; a fila é só o DESPERTADOR. É a lição já registrada na casa em
 * `noc-monitor-restart-safe-recovery.md`: monitor resolve reconciliando com o BANCO, nunca só por
 * evento — trabalho agendado que reinicia, é ceifado ou migra de fila, some. E o que some aqui é uma
 * conversa parada que ninguém vai devolver para a fila.
 */
export async function rodadaDoRelogio({ limite = 50 } = {}) {
  const cliente = db();
  const relogios = exigirModelo('ragnabotAtendRelogio');
  exigirModelo('ragnabotFluxoFila');
  const agora = await agoraDoBanco();

  const vencidos = await relogios.findMany({
    where: { disparadoEm: null, venceEm: { lte: agora } },
    orderBy: { venceEm: 'asc' },
    take: limite,
  });

  let enfileirados = 0;
  for (const r of vencidos) {
    try {
      await cliente.$transaction(async (tx) => {
        // GUARDA CONTRA DUPLA ENTREGA: só enfileira quem ainda não foi despertado. Zero linhas
        // afetadas significa que outro trabalhador chegou primeiro — não é erro, é a corrida
        // resolvida do jeito certo.
        const marcado = await tx.ragnabotAtendRelogio.updateMany({
          where: { id: r.id, disparadoEm: null },
          data: { disparadoEm: agora },
        });
        if ((marcado?.count ?? 0) === 0) return;
        await tx.ragnabotFluxoFila.create({
          data: {
            tipo: TIPO_JOB_RELOGIO,
            chaveParticao: chaveParticao(r),
            tenantId: r.tenantId,
            prioridade: 120, // abaixo do tráfego de cliente (50): gente esperando vem primeiro
            payload: { relogioId: r.id, carimbo: carimboDoRelogio(r), tipo: r.tipo },
          },
        });
        enfileirados += 1;
      }, { timeout: 15_000 });
    } catch (e) {
      logger.error(`[atendimento] falha ao enfileirar relógio ${r.id}: ${e.message}`);
    }
  }
  return { vistos: vencidos.length, enfileirados };
}

/**
 * O DESPACHO. Recebe o trabalho da fila do motor e aplica a ação — ou descarta, se o mundo mudou.
 *
 * Ordem deliberada: primeiro o estado (o que a operação precisa), depois a mensagem ao cliente (o
 * que é gentileza). Fora da janela de 24 h da Meta a mudança de estado ACONTECE e a mensagem NÃO —
 * e o motivo fica escrito na nota interna, senão o atendente encontra uma conversa devolvida à fila
 * sem nenhuma explicação.
 */
export async function processarTrabalhoDoRelogio(job = {}) {
  const relogios = exigirModelo('ragnabotAtendRelogio');
  const relogioId = job?.payload?.relogioId ?? job?.relogioId ?? null;
  if (!relogioId) throw new ErroDeAtendimento('JOB_INCOMPLETO', 'payload.relogioId é obrigatório');

  const r = await relogios.findUnique({ where: { id: relogioId } });
  if (!r) return { resultado: 'descartado_obsoleto', motivo: 'relogio_inexistente' };

  const esperado = job?.payload?.carimbo ?? null;
  if (esperado && esperado !== carimboDoRelogio(r)) {
    await relogios.update({ where: { id: r.id }, data: { resultado: 'descartado_obsoleto' } });
    return { resultado: 'descartado_obsoleto', motivo: 'carimbo_mudou' };
  }

  // ── CERCA CONTRA A SEGUNDA ENTREGA ──────────────────────────────────────────────────────────
  // A fila do motor é de entrega AO MENOS UMA VEZ: retentativa, ceifador de trabalho preso e
  // redespacho podem entregar o MESMO trabalho duas vezes — e nesse caso o carimbo acima não acusa
  // nada, porque ele não mudou. Sem esta cerca o efeito sai em dobro: a conversa é devolvida à fila
  // duas vezes e o cliente lê a mesma mensagem duas vezes, concluindo que o robô está quebrado.
  // Defeito encontrado pelo teste-oráculo independente, não por leitura do código.
  //
  // A cerca é ATÔMICA (`updateMany` condicional), nunca um `if` sobre o que acabamos de ler: entre
  // a leitura e a decisão cabe o outro trabalhador. Zero linhas afetadas não é erro — é a corrida
  // resolvida do jeito certo, exatamente como o `disparadoEm` da rodada.
  //
  // ⚠️ TRÊS TENTATIVAS DE IGUALDADE SIMPLES, e não um `OR` só. É deliberado: `OR` é Prisma legítimo,
  // mas obriga todo dublê de teste a implementá-lo, e a cerca é justamente o trecho que mais precisa
  // ser exercitado por teste. Igualdade simples roda igual no Postgres e em qualquer dublê.
  //   1. `resultado = null`   — o caso normal, ninguém pegou ainda;
  //   2. `resultado = 'erro'` — falha anterior; a retentativa da fila precisa poder repetir;
  //   3. TROCA-E-COMPARA sobre `disparadoEm` — o dono morreu entre a cerca e o desfecho. Comparar o
  //      carimbo EXATO que acabamos de ler é o que torna a retomada atômica sem `OR`: quem vence
  //      grava um carimbo novo, e o segundo pretendente deixa de casar. Sem esta terceira porta a
  //      linha ficaria travada para sempre — e o que trava aqui é uma conversa parada que ninguém
  //      vai devolver para a fila.
  const agoraCerca = await agoraDoBanco();
  const marca = { resultado: 'processando', disparadoEm: agoraCerca };
  let cerca = await relogios.updateMany({ where: { id: r.id, resultado: null }, data: marca });
  if ((cerca?.count ?? 0) === 0) {
    cerca = await relogios.updateMany({ where: { id: r.id, resultado: 'erro' }, data: marca });
  }
  if ((cerca?.count ?? 0) === 0 && r.resultado === 'processando' && r.disparadoEm
      && new Date(r.disparadoEm).getTime() < agoraCerca.getTime() - PROCESSANDO_PRESO_MS) {
    cerca = await relogios.updateMany({ where: { id: r.id, resultado: 'processando', disparadoEm: r.disparadoEm }, data: marca });
  }
  if ((cerca?.count ?? 0) === 0) {
    return { resultado: 'descartado_obsoleto', motivo: r.resultado === 'aplicado' ? 'ja_aplicado' : 'ja_processando' };
  }

  const carregado = await carregarPoliticaPelaBase({ tenantId: r.tenantId, politicaId: r.politicaId })
    ?? await carregarPoliticaEfetiva({ tenantId: r.tenantId, cwAccountId: r.cwAccountId });
  const { politica, janelas, excecoes } = carregado;
  const agora = await agoraDoBanco();

  // SEGUNDA CONFERÊNCIA DO EXPEDIENTE, e ela não é redundante: entre agendar e disparar pode ter
  // entrado um feriado, ou alguém pode ter mudado o expediente. Agir fechado quando a política diz
  // para congelar é a armadilha 1 do cabeçalho renascendo pelo caminho do atraso da fila.
  if (politica.inatividadeContaForaExpediente !== true) {
    const exp = avaliarExpediente({ agora, fuso: politica.fuso ?? FUSO_PADRAO, janelas, excecoes });
    if (!exp.aberto) {
      const proxima = exp.proximaAbertura ?? null;
      await relogios.update({
        where: { id: r.id },
        data: { disparadoEm: null, resultado: null, pausadoMotivo: exp.motivo, venceEm: proxima ?? r.venceEm },
      });
      return { resultado: 'recusado_fora_expediente', motivo: exp.motivo, reagendadoPara: proxima };
    }
  }

  const contexto = montarContextoDeExpediente({
    expediente: avaliarExpediente({ agora, fuso: politica.fuso ?? FUSO_PADRAO, janelas, excecoes }),
    fuso: politica.fuso ?? FUSO_PADRAO,
  });
  const plano = planejarAcaoDoRelogio({ politica, tipo: r.tipo, contexto });
  const feito = { estado: null, mensagem: null, notificacao: null };
  const alvo = { cwAccountId: r.cwAccountId, cwConversationId: r.cwConversationId };

  try {
    const cw = portas.chatwoot;
    if (plano.timeDestino && cw?.atribuirTime) { await cw.atribuirTime({ ...alvo, cwTeamId: plano.timeDestino }); feito.estado = 'time'; }
    if (plano.removerAgente && cw?.removerAgente) { await cw.removerAgente(alvo); feito.estado = 'agente_removido'; }
    if (plano.mudarStatus && cw?.mudarStatus) { await cw.mudarStatus({ ...alvo, status: plano.mudarStatus }); feito.estado = plano.mudarStatus; }

    let motivoSemMensagem = null;
    if (plano.mensagemAoCliente) {
      const canal = portas.canal;
      const aberta = canal?.janelaAberta ? await canal.janelaAberta(alvo) : true;
      if (aberta && canal?.enviarTexto) { await canal.enviarTexto({ ...alvo, texto: plano.mensagemAoCliente }); feito.mensagem = 'enviada'; }
      else { motivoSemMensagem = 'janela_24h_fechada'; feito.mensagem = 'suprimida'; }
    }

    const nota = motivoSemMensagem
      ? `${plano.notaInterna} (mensagem ao cliente não enviada: ${motivoSemMensagem})`
      : plano.notaInterna;
    if (cw?.notaInterna) await cw.notaInterna({ ...alvo, texto: nota });

    if (plano.acao === ACOES_INATIVIDADE.TRANSFERIR_TIME && plano.timeDestino) {
      await registrarTransferencia({
        registro: {
          tenantId: r.tenantId, cwAccountId: r.cwAccountId, cwConversationId: r.cwConversationId,
          deTipo: 'agente', deId: null, deNome: null,
          paraTipo: 'time', paraId: Number(plano.timeDestino), paraNome: null,
          motivo: r.tipo === TIPOS_RELOGIO.TRANSBORDO ? 'transbordo por tempo em fila' : 'inatividade',
          notaInterna: nota,
          origem: r.tipo === TIPOS_RELOGIO.TRANSBORDO ? 'transbordo' : 'inatividade',
          atorUserId: null,
        },
      });
    }

    // O AVISO NÃO ENCERRA O CICLO: ele reagenda o relógio principal para o resto do prazo. Sem isto,
    // "ainda está aí?" sairia e a conversa ficaria parada para sempre — pior que não avisar.
    if (plano.rearmarComo) {
      const restante = Math.max(1, Number(politica.inatividadeMinutos) - Number(politica.inatividadeAvisoMinutos ?? 0));
      const { venceEm } = calcularVencimento({
        inicio: agora, minutos: restante, fuso: politica.fuso ?? FUSO_PADRAO, janelas, excecoes,
        contaForaExpediente: politica.inatividadeContaForaExpediente === true,
      });
      if (venceEm) {
        const chave = chaveRelogio({ ...alvo, tipo: plano.rearmarComo });
        const dados = {
          tenantId: r.tenantId, cwAccountId: r.cwAccountId, cwConversationId: r.cwConversationId,
          politicaId: r.politicaId, tipo: plano.rearmarComo, chave,
          ultimaAtividadeEm: r.ultimaAtividadeEm, ultimaAtividadeLado: r.ultimaAtividadeLado,
          venceEm, pausadoMotivo: null, disparadoEm: null, resultado: null, erro: null,
        };
        await relogios.upsert({ where: { chave }, create: dados, update: dados });
      }
    }

    await relogios.update({ where: { id: r.id }, data: { resultado: 'aplicado' } });
    await auditar({
      tenantId: r.tenantId, acao: 'relogio_atendimento_aplicado',
      descricao: `${r.tipo} → ${plano.acao}`, entidade: 'conversa', entidadeId: String(r.cwConversationId),
      depois: { ...plano, feito },
    });
    return { resultado: 'aplicado', plano, feito };
  } catch (e) {
    await relogios.update({ where: { id: r.id }, data: { resultado: 'erro', erro: String(e?.message ?? e).slice(0, 500) } });
    throw e;
  }
}

/** Grava a transferência. É o registro que falta nos DOIS lados — a origem não tem, o destino também
 *  não: lá a transferência é a troca silenciosa de `assignee_id`. */
export async function registrarTransferencia({ registro }) {
  const modelo = exigirModelo('ragnabotAtendTransferencia');
  const linha = await modelo.create({ data: registro });
  await auditar({
    tenantId: registro.tenantId, acao: 'transferencia', protocolo: registro.protocolo ?? null,
    descricao: `${registro.deTipo}${registro.deNome ? ` (${registro.deNome})` : ''} → ${registro.paraTipo}${registro.paraNome ? ` (${registro.paraNome})` : ''}`,
    entidade: 'conversa', entidadeId: String(registro.cwConversationId), depois: registro,
  });
  return linha;
}

/** Auditoria nunca derruba a ação. Registro perdido é ruim; atendimento derrubado por causa do
 *  registro é pior — e é o tipo de falha que só aparece na hora do pico. */
async function auditar(evento) {
  try {
    if (portas.auditoria?.registrar) {
      await portas.auditoria.registrar({ atorTipo: 'sistema', categoria: 'atendimento', ...evento });
    }
  } catch (e) {
    logger.warn(`[atendimento] auditoria não registrada: ${e.message}`);
  }
}

/**
 * O robô pode atender esta caixa AGORA? Devolve o MOTIVO da recusa, ou `null` quando pode.
 *
 * ── ⚠️ POR QUE O FREIO GLOBAL **NÃO** ESTÁ AQUI (erro meu, corrigido em 03/09/2026) ─────────────
 * A primeira versão desta função também vetava quando `RAGNABOT_EXECUTOR_FLUXO` estava desligada.
 * Parecia razoável e estava ERRADO, por dois motivos que só apareceram quando a bateria rodou:
 *
 *   1. **Redefinia o que aquele freio significa.** `RAGNABOT_EXECUTOR_FLUXO` desliga o TRABALHADOR
 *      que anda com o fluxo — não a decisão de entrada. Pôr o veto aqui fazia a portaria deixar de
 *      criar execução, mudando um comportamento que ninguém pediu e que 6 verificações da portaria
 *      documentavam. Contrato de outro componente não se muda de passagem.
 *   2. **Misturava as duas perguntas.** «Quem atende esta caixa?» é do dono da empresa. «O motor
 *      está andando?» é do NOC. Uma função que responde as duas some com a fronteira.
 *
 * O freio global continua existindo e continua sendo mostrado na tela — mas viaja SEPARADO, em
 * `roboTeto` (rota de conexões), justamente para a tela poder dizer «ligado, mas parado» com uma
 * frase diferente. Aqui mora **um veto só**: o interruptor da CAIXA.
 *
 * Veto único: `robo_desligado_na_caixa` — o interruptor da caixa, do administrador da EMPRESA.
 *
 * ⚠️ CAIXA SEM CADASTRO não é veto. Uma caixa que ainda não foi sincronizada, ou uma entrada sem
 * `cwInboxId` (fluxo por palavra-chave), não pode ficar refém de um cadastro que talvez não tenha
 * rodado — guarda que trava por dúvida vira guarda contornada. O veto só existe quando a linha
 * EXISTE e diz `roboAtende=false`.
 *
 * ── ⚠️ E SE NÃO DER PARA LER O INTERRUPTOR? FALHA **ABERTA**, e a decisão é declarada ────────────
 * Minha primeira versão falhava FECHADA («na dúvida, não atende»). Soa prudente e é a escolha
 * errada aqui — a bateria mostrou por quê: o caso comum de «não consegui ler» **não** é o banco
 * fora, é o **cliente Prisma fora de passo com a base**, que é o estado NORMAL de um pod nos
 * minutos entre aplicar a migração e reiniciar o processo (está escrito na lei da casa: «o cliente
 * Prisma novo só vale no processo após restart»). Falhando fechada, esse intervalo de rotina vira
 * **apagão silencioso do robô em TODAS as caixas**, com o sintoma «parou de responder» e nenhuma
 * causa visível.
 *
 * O outro lado do risco é bem menor e mais curto: enquanto a leitura estiver quebrada, o robô pode
 * atender numa caixa que o dono desligou. Entre um apagão geral provável e um vazamento pontual
 * improvável, escolho o segundo — e GRITO no log, porque decisão silenciosa é que corrói confiança.
 *
 * É a mesma convenção que `problemaNaCaixaDoFluxo()` já segue neste repositório: falha de
 * infraestrutura na conferência não pode impedir o trabalho de acontecer.
 */
async function vetoDoRobo(cliente, { tenantId, idCaixa }) {
  if (idCaixa === null) return null;
  try {
    const caixa = await cliente.ragnabotInbox.findFirst({
      where: { tenantId, cwInboxId: idCaixa, removedAt: null },
      select: { roboAtende: true },
    });
    if (!caixa) return null;                       // sem cadastro ⇒ sem veto (ver acima)
    return caixa.roboAtende === true ? null : 'robo_desligado_na_caixa';
  } catch (e) {
    // Falha ABERTA, declarada acima. O caso comum é cliente Prisma fora de passo com a base — e
    // fechar aqui transformaria um rollout de rotina em apagão do robô em todas as caixas.
    logger.warn(`[atendimento] NÃO consegui ler o interruptor do robô da caixa ${idCaixa} `
      + `(${e.message}). Seguindo SEM veto: se esta caixa estiver desligada, ela vai atender até a `
      + 'leitura voltar. Confira se o processo está com o cliente Prisma da migração do interruptor.');
    return null;
  }
}

/**
 * O resolvedor de entrada, com banco: decide qual fluxo atende a mensagem que acabou de chegar.
 * Devolve a INTENÇÃO — quem chama `iniciarOuRecuperarExecucao()` é a portaria, dona daquele arquivo.
 */
export async function resolverEntrada({
  tenantId, cwAccountId, cwConversationId, cwInboxId = null, texto = '', agora = null,
}) {
  const cliente = db();
  const quando = agora ?? await agoraDoBanco();
  const { politica, janelas, excecoes } = await carregarPoliticaEfetiva({ tenantId, cwAccountId, cwInboxId });
  const expediente = avaliarExpediente({ agora: quando, fuso: politica.fuso ?? FUSO_PADRAO, janelas, excecoes });

  const publicados = { tenantId, estado: 'publicado', versaoPublicadaId: { not: null } };
  const idCaixa = inteiroEstrito(cwInboxId);

  // ── ⭐ O INTERRUPTOR DO ROBÔ, POR CAIXA (contrato S-INTERRUPTOR, 03/09/2026) ──────────────────
  // ORDEM DO DONO: «preciso eu mesmo ter o poder dessa decisão… a qualquer momento posso incluir
  // outra caixa ou remover se quiser». O interruptor mora em `RagnabotInbox.roboAtende` e é o
  // administrador da EMPRESA que o move, pela tela de Conexões — não uma variável do Kubernetes.
  //
  // ⚠️ ELE ESTÁ AQUI, E NÃO NO EXECUTOR, DE PROPÓSITO. A portaria continua uma execução VIVA no
  // passo 3, ANTES de chamar este resolvedor. Logo, desligar o interruptor **não abandona ninguém
  // no meio da conversa**: quem já estava falando com o robô termina o que começou, e nenhuma nova
  // entra. É o comportamento declarado, e é consequência de onde a guarda cabe — não de sorte.
  //
  // ⚠️ O FREIO GLOBAL (`RAGNABOT_EXECUTOR_FLUXO`) NÃO ENTRA AQUI — ver a explicação em
  // `vetoDoRobo()`. Ele desliga o TRABALHADOR que anda com o fluxo, não a decisão de entrada, e
  // misturá-lo neste ponto mudava o contrato da portaria por tabela. Ele continua aparecendo na
  // tela, por caminho próprio (`roboTeto`), com uma frase própria — porque «o robô não atende
  // nesta caixa» e «o motor está parado no sistema inteiro» mandam procurar em lugares diferentes.
  const veto = await vetoDoRobo(cliente, { tenantId, idCaixa });
  if (veto) {
    const anteriorV = await cliente.ragnabotFluxoExecucao.findFirst({
      where: { cwAccountId, cwConversationId }, orderBy: { iniciadaEm: 'desc' },
    });
    return {
      acao: ACOES_ENTRADA.FILA_HUMANA, fluxoId: null, versaoId: null, motivo: veto,
      expediente,
      primeiroContato: ehPrimeiroContato({
        execucaoAnterior: anteriorV, agora: quando,
        reiniciaFluxoAposHoras: politica.reiniciaFluxoAposHoras ?? 24,
      }),
      politica,
    };
  }

  const porPalavra = await cliente.ragnabotFluxo.findMany({ where: { ...publicados, entrada: 'palavra_chave' } });

  // ⚠️ ORDEM DETERMINÍSTICA, e não é enfeite: até 03/09/2026 este `findFirst` não tinha `orderBy`.
  // Com DOIS fluxos publicados na mesma caixa, quem ganhava era o que o Postgres devolvesse
  // primeiro — indefinido, e podendo mudar de uma consulta para a outra. O sintoma em produção não
  // é erro: é «o robô respondeu o fluxo errado», intermitente e sem rastro.
  //
  // A porta agora recusa a dupla (guarda no router + índice único parcial `rb_fluxo_uma_boca_por_caixa`),
  // mas guarda nova não conserta dado velho: se a dupla existir, DECLARO quem ganha — o publicado
  // mais RECENTE — e grito no log com os dois nomes, para alguém arrumar.
  let daCaixa = null;
  if (idCaixa !== null) {
    const candidatos = await cliente.ragnabotFluxo.findMany({
      where: { ...publicados, entrada: 'caixa', cwInboxId: idCaixa },
      orderBy: [{ atualizadoEm: 'desc' }, { id: 'asc' }],
      take: 5,
    });
    daCaixa = candidatos[0] ?? null;
    if (candidatos.length > 1) {
      logger.warn(`[atendimento] AMBIGUIDADE na caixa ${idCaixa} da empresa ${tenantId}: `
        + `${candidatos.length} fluxos publicados (${candidatos.map((f) => `"${f.nome}"`).join(', ')}). `
        + `Atendendo com "${daCaixa.nome}" (o alterado mais recentemente). Desligue os outros.`);
    }
  }

  const anterior = await cliente.ragnabotFluxoExecucao.findFirst({
    where: { cwAccountId, cwConversationId },
    orderBy: { iniciadaEm: 'desc' },
  });
  const primeiro = ehPrimeiroContato({
    execucaoAnterior: anterior, agora: quando, reiniciaFluxoAposHoras: politica.reiniciaFluxoAposHoras ?? 24,
  });

  const decisao = resolverFluxoDeEntrada({
    texto, politica, expediente, primeiroContato: primeiro,
    fluxosPorPalavraChave: porPalavra, fluxoDaCaixa: daCaixa,
  });

  // A versão vem junto: `iniciarOuRecuperarExecucao()` exige `versaoId`, e deixar quem chama
  // descobrir sozinho é o convite para dois lugares resolverem a mesma coisa de jeitos diferentes.
  let versaoId = null;
  if (decisao.fluxoId) {
    const f = await cliente.ragnabotFluxo.findFirst({ where: { id: decisao.fluxoId, tenantId } });
    if (!f) {
      logger.warn(`[atendimento] fluxo ${decisao.fluxoId} não pertence à empresa ${tenantId} — caindo para fila humana`);
      return { ...decisao, acao: ACOES_ENTRADA.FILA_HUMANA, fluxoId: null, versaoId: null, motivo: 'fluxo_fora_da_empresa', primeiroContato: primeiro };
    }
    versaoId = f.versaoPublicadaId ?? null;
    if (!versaoId) {
      // Fluxo apontado mas nunca publicado: mandar para gente é a única saída honesta.
      return { ...decisao, acao: ACOES_ENTRADA.FILA_HUMANA, fluxoId: null, versaoId: null, motivo: 'fluxo_sem_versao_publicada', primeiroContato: primeiro };
    }
  }
  return { ...decisao, versaoId, primeiroContato: primeiro, politica };
}

export default {
  configurar, portasDoAtendimento,
  partesNoFuso, instanteDeParede, hhmm, inteiroEstrito,
  avaliarExpediente, proximaAberturaApos, avancarMinutosDeExpediente, intervalosAbertos,
  escopoChaveDe, mesclarPoliticas,
  relogioDeveArmar, relogioDeveArmarPorLado, calcularVencimento, planejarRelogioDeInatividade,
  planejarRelogioDeTransbordo, planejarAcaoDoRelogio,
  casaPalavraChave, ehPrimeiroContato, resolverFluxoDeEntrada, montarContextoDeExpediente, aplicarModelo,
  planejarTransferencia, montarAvisoDeTransferencia,
  carregarPoliticaEfetiva, carregarPoliticaPelaBase, avaliarExpedienteAgora,
  registrarAtividade, registrarEntradaNaFila, registrarAssuncao, cancelarRelogios,
  rodadaDoRelogio, processarTrabalhoDoRelogio, registrarTransferencia, resolverEntrada,
};
