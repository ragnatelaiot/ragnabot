// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONSUMIDOR DOS TRABALHOS DE ATENDIMENTO NA FILA DO MOTOR (A4)
//   • `atend_relogio` — a ação `notificar` do relógio de inatividade (o «ainda está aí?»)
//   • `atend_mensagem` — a mensagem avulsa da portaria de entrada (fora de expediente, intervalo,
//                        feriado, despedida de quem estava na fila)
//
// Base: /ia/.claude/modulo-atendimento/29-AUTOMACOES-DO-ATENDIMENTO.md §5.3, §5.4 e §5.6, e o
// contrato da fila em 28-MOTOR-DE-FLUXO-ESPECIFICACAO.md §2.4.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O BURACO QUE ESTE ARQUIVO FECHA — medido, não suposto
//
// `RagnabotFluxoFila` é a fila do motor, e quem a roda é `rodadaDoExecutor()`. Ela IGNORA candidato
// sem `execucaoId` (`if (!candidato.execucaoId) { resumo.ignorados += 1; continue; }`), e
// `processarTrabalho()`, se for chamada mesmo assim, lança `JOB_SEM_EXECUCAO`. Dois produtores
// gravam ali trabalhos que, por natureza, NÃO pertencem a nenhuma execução de fluxo:
//
//   • o trabalhador de atendimento, no ramo `acao === 'notificar'` de `aplicarAcao()`
//     (ragnabot-atendimento-worker.service.js) — as outras três ações do relógio acontecem dentro
//     dele mesmo; só `notificar` sai pela fila;
//   • a portaria de entrada, quando o resolvedor decide responder SEM iniciar fluxo
//     (ragnabot-portaria.service.js, `TIPO_JOB_MENSAGEM`).
//
// Nos dois casos a linha nasce, entra na fila e ninguém nunca a tira de lá. Este arquivo é o
// consumidor que faltava. Ele NÃO reimplementa o motor: reusa `chaveEfeito`, `reservarEfeito`,
// `confirmarEfeito`, `falharEfeito` e `descartarEfeito` do `ragnabot-fluxo-motor.service.js` — que é
// onde a caixa de saída de duas fases já está escrita e provada.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// POR QUE UM CONSUMIDOR SÓ, E NÃO DOIS
//
// Os dois tipos exigem exatamente as MESMAS quatro garantias: idempotência por efeito reservado,
// janela de 24 h com a ação de estado acontecendo mesmo quando a mensagem não sai, partição
// respeitada e degradação declarada sem porta. Dois consumidores seriam duas implementações dessas
// quatro regras, dois laços disputando a mesma tabela e dois lugares para alguém corrigir no dia em
// que uma delas mudar. O que de fato difere entre eles — de onde vem o texto, o que conta como
// «ciclo», e se há ação de estado depois da entrega — cabe em duas funções curtas de entrada.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE CADA UM FAZ, EM UMA FRASE
//
// `notificar`: o silêncio da conversa venceu e a política mandou NÃO mexer no estado — a conversa
// continua com quem está, sai o «ainda está aí?» para o cliente e a nota interna para a supervisão.
// É o que `ragnabot-atendimento.service.js` já declara no ramo `ACOES_INATIVIDADE.NOTIFICAR`:
// «Sem mudança de estado: só avisa quem tem de saber.»
//
// `atend_mensagem`: o cliente escreveu, o resolvedor de entrada decidiu que ali não nasce fluxo, e o
// que ele merece é uma frase — «voltamos às 13h», «estamos em horário de almoço», a despedida de
// quem desistiu da fila. Quando a política mandar, a conversa é encerrada depois da frase.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO ARMADILHAS QUE ESTE CÓDIGO EXISTE PARA EVITAR
//
// A1. DUAS MENSAGENS AO MESMO CLIENTE. Um trabalho de fila é entregue mais de uma vez por desenho
//     (retentativa, ceifador, reinício entre a reivindicação e o desfecho). Se cada entrega mandasse
//     texto, o cliente leria a mesma frase duas vezes e concluiria que o robô quebrou. O portão é a
//     CHAVE DE EFEITO: determinística por CICLO, conferida ANTES de qualquer envio e antes até da
//     nota interna. Ver `chaveDoCiclo`.
//
// A2. PROMESSA FALSA FORA DA JANELA DE 24 H. Passadas 24 h da última mensagem do cliente, o WhatsApp
//     recusa texto livre. §5.6: «fora da janela, a ação de estado acontece e a mensagem não; o
//     motivo fica na nota interna». Então aqui a ação de estado SAI, o efeito é `descartado` com
//     `motivoDescarte='fora_da_janela'`, e o trabalho é dado por FEITO — nunca por falho. Marcar
//     falho faria a fila reentregar oito vezes um trabalho que jamais poderá dar certo.
//
// A3. MEXER NA CONVERSA NO MEIO DE UM PASSO DO FLUXO (§5.3). Enquanto a execução está viva, o dono
//     do silêncio é o nó `espera`, em segundos; o relógio, em minutos, só vale quando a conversa
//     está com humano. Sem isso o cliente recebe, no mesmo minuto, o «não entendi, escolha uma
//     opção» do fluxo e o «ainda está aí?» do relógio. Ver `fluxoVivoNaParticao`.
//
// A4. TRABALHO OBSOLETO RESSUSCITANDO. Se o cliente respondeu antes do prazo, o relógio foi
//     RE-ARMADO — e re-armar repõe `disparadoEm=null, resultado=null` na MESMA linha (o `chave` do
//     relógio é único por «conta:conversa:tipo»). Um despertar que chega depois disso está falando
//     de um ciclo que não existe mais: `descartado_obsoleto`, igual ao `tokenVisita` do motor. A
//     mensagem de entrada tem a versão dela do mesmo risco, e a defesa é o prazo de validade — ver
//     `VALIDADE_MENSAGEM_MINUTOS`.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE ARQUIVO **NÃO** FAZ, de propósito
//
//   • não cria relógio, não reconcilia prazo e não decide ação — isso é do trabalhador;
//   • não resolve qual fluxo atende o primeiro «oi» — isso é da portaria;
//   • não fala com o Chatwoot nem com a Meta direto: tudo por porta injetada;
//   • não amarra nada no processo. Quem liga `iniciarConsumidorDeDespertar()` e injeta as portas é
//     o processo executor (decisão do chefe), exatamente como o trabalhador e o motor.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import {
  chaveEfeito, reservarEfeito, confirmarEfeito, falharEfeito, descartarEfeito,
  chaveParticaoDe, ehErroDoMotor, ESTADOS_ATIVOS,
} from './ragnabot-fluxo-motor.service.js';
import { TIPO_JOB_RELOGIO, ACOES_INATIVIDADE, aplicarModelo } from './ragnabot-atendimento.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES DECLARADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O SEGUNDO TIPO ÓRFÃO — a mensagem avulsa da portaria de entrada.
 *
 * A portaria (`ragnabot-portaria.service.js`) enfileira `atend_mensagem` quando a decisão do
 * resolvedor de entrada NÃO é iniciar fluxo: o aviso de fora de expediente («voltamos às 13h»), o
 * texto de intervalo, o de feriado, a despedida de quem estava na fila. Mesma partição
 * «conta:conversa», mesma fila, mesmo problema: sem consumidor, a linha nasce e nunca sai de lá.
 *
 * ⚠️ DUPLICAÇÃO DECLARADA de `TIPO_JOB_MENSAGEM` (`ragnabot-portaria.service.js`, linha 112). Um
 * `import` estático entre dois serviços que estão sendo construídos na mesma leva é dependência de
 * ARRANQUE: se o arquivo do outro autor for renomeado ou sair do ar por um instante, o processo
 * inteiro deixa de subir. É a mesma escolha, pelo mesmo motivo, que o motor faz com
 * `ESTADOS_ATIVOS`. A defesa contra as duas fontes divergirem NÃO é disciplina: é o teste
 * «a constante de tipo é a MESMA que a portaria enfileira», que importa a portaria e compara.
 */
export const TIPO_JOB_MENSAGEM = 'atend_mensagem';

/** Os dois tipos que este consumidor tira da fila. Nenhum outro — trabalho de fluxo é do motor. */
export const TIPOS_TRATADOS = Object.freeze([TIPO_JOB_RELOGIO, TIPO_JOB_MENSAGEM]);

/** Nós sintéticos a que os efeitos deste consumidor se penduram.
 *  Não existe nó de fluxo aqui — nem o despertar do relógio nem a mensagem avulsa vêm de um
 *  documento —, mas `chaveEfeito()` exige `noId`, e um identificador FIXO e reconhecível é melhor
 *  que um inventado na hora: quem for periciar `RagnabotFluxoEfeito` amanhã descobre a origem por
 *  um `grep`. */
export const NO_SINTETICO = 'atend_relogio:notificar';
export const NO_SINTETICO_MENSAGEM = 'atend_mensagem:entrada';

/** Prefixo do `execucaoId` sintético dos nossos efeitos.
 *
 *  ⚠️ POR QUE **NÃO** USAR O `execucaoId` REAL DA CONVERSA, mesmo quando existe uma execução:
 *  `efeitoPendenteBloqueante()` do motor congela a marcha enquanto houver efeito sem desfecho da
 *  execução. Um efeito NOSSO reservado e não confirmado (o processo caiu entre reservar e enviar)
 *  passaria a segurar o FLUXO de um cliente por causa de encanamento do relógio. Com um
 *  `execucaoId` que não é de nenhuma execução, o efeito é invisível para o motor — que é exatamente
 *  o que ele deve ser. `RagnabotFluxoEfeito.execucaoId` é `String` e não tem chave estrangeira
 *  (conferido em prisma/sql/motor-fluxo/01-rb_motor_base.sql: o arquivo não declara FOREIGN KEY
 *  nenhuma), então isto não viola integridade referencial. */
const PREFIXO_EXECUCAO_SINTETICA = 'relogio:';

/** Resultados devolvidos por `processarDespertar`. Cada um existe porque a ausência dele produziria
 *  um estado que ninguém consegue explicar depois. */
export const RESULTADOS_DESPERTAR = Object.freeze({
  NOTIFICADO: 'notificado',
  JA_NOTIFICADO: 'ja_notificado',          // idempotência: este ciclo já foi notificado
  SEM_JANELA: 'sem_janela',                // §5.6: o estado aconteceu, a mensagem não
  ADIADO_PARTICAO: 'adiado_particao',      // §5.3: há passo de fluxo vivo nesta conversa
  DESCARTADO_OBSOLETO: 'descartado_obsoleto',
  SEM_PORTA: 'sem_porta',                  // degradação declarada: canal/Chatwoot ausentes
  IGNORADO: 'ignorado',                    // não é trabalho nosso
  ERRO: 'erro',
});

/** Estados de execução em que a conversa é do RELÓGIO, e não do fluxo (§5.3).
 *  Escrito a partir de `ESTADOS_ATIVOS` do motor, e não como lista nova, para não haver duas fontes
 *  da mesma verdade. `pausado_humano` é ativo mas a conversa está com gente — o relógio manda.
 *  `pausado_duvida` NÃO entra: ali existe efeito do motor sem desfecho, e mexer por cima é como
 *  nasce a promessa falsa. */
const PAUSA_QUE_LIBERA_O_RELOGIO = 'pausado_humano';

/** Depois de quanto tempo um trabalho preso em `processando` volta a ser candidato. Generoso de
 *  propósito: reabrir cedo demais é competir com um consumidor que ainda está vivo e apenas lento
 *  (é a mesma escolha do ceifador do trabalhador de atendimento). */
const CEIFADOR_MINUTOS = 10;

/** Prazo de validade da MENSAGEM AVULSA de entrada. «Voltamos às 13h» entregue meia hora depois
 *  ainda ajuda; três horas depois contradiz o que o cliente vê na tela e faz o robô parecer quebrado.
 *  Trinta minutos é o ponto em que a frase deixa de ser verdade com folga. O despertar do relógio
 *  NÃO tem prazo de validade: o «ainda está aí?» continua verdadeiro depois. */
const VALIDADE_MENSAGEM_MINUTOS = 30;

/** Texto de reserva quando a política não configurou mensagem. NÃO é enfeite: uma política com
 *  ação `notificar` e mensagem vazia é uma configuração legítima («age em silêncio», como o próprio
 *  schema diz em `inatividadeMensagem`). Nesse caso não sai texto para o cliente e só sai a nota
 *  interna — e o resultado continua sendo `notificado`, porque foi exatamente o que foi pedido. */
const SEM_TEXTO = null;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS — mesmo desenho do motor e do trabalhador
//
// ⚠️ NÃO é ponto de bifurcação de comportamento. Não existe «modo de teste» que siga caminho
// diferente: o teste injeta OUTRAS implementações das MESMAS portas.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaPadrao,
  log: loggerPadrao,

  /** A porta do canal do MOTOR — a mesma injetada em `configurarMotor({canal})`.
   *  É por ela que o texto sai respeitando a janela de 24 h, e é por isso que este consumidor não
   *  abre um atalho novo para o WhatsApp.
   *  @type {null | { portaDa: (contexto:object) => Promise<{enviar:Function, lerConversa?:Function}> }} */
  canal: null,

  /** Porta do Chatwoot, só para a NOTA INTERNA. Nota interna não é mensagem de WhatsApp: não
   *  consome janela de 24 h e não chega ao cliente — é o que o atendente lê ao abrir a conversa.
   *  @type {null | { notaInterna?: Function }} */
  chatwoot: null,

  /** Avaliador de janela de 24 h. Opcional: sem ele vale a leitura local de `RagnabotFluxoJanela`,
   *  que é a MESMA regra do motor (`avaliarJanela`), com a mesma resposta honesta quando não dá
   *  para decidir: `aberta: null`.
   *  @type {null | { avaliar: (f:object) => Promise<{aberta:boolean|null, motivo:string}> }} */
  janela: null,

  /** Relógio. Só o teste troca. Em produção a hora vem do BANCO — pod fora de sincronia decide
   *  janela de 24 h errada, e o sintoma é «a mensagem saiu quando não podia».
   *  @type {null | { agora: () => Promise<Date>|Date }} */
  relogio: null,
};

/** Amarra as dependências. Chamada uma vez pelo processo executor, e pelo teste. */
export function configurarDespertar(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no consumidor de despertar: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDoDespertar() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/** A hora vem do BANCO. Mesma regra do motor e do trabalhador. */
async function agora() {
  if (portas.relogio) return new Date(await portas.relogio.agora());
  const cliente = db();
  if (typeof cliente?.$queryRaw !== 'function') return new Date();
  try {
    const linhas = await cliente.$queryRaw`SELECT now() AS agora`;
    const v = Array.isArray(linhas) && linhas[0] ? linhas[0].agora : null;
    return v ? new Date(v) : new Date();
  } catch {
    return new Date();
  }
}

const somarMs = (d, ms) => new Date(new Date(d).getTime() + ms);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CHAVE — o portão da idempotência
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Chave determinística do trabalho, POR CICLO. É o portão da idempotência, e é UMA função só —
 * duas contas do mesmo valor em lugares diferentes é como nasce a mensagem em dobro no dia em que
 * alguém mexe numa delas.
 *
 * As quatro peças, e por que cada uma:
 *   • `alvo` — o `execucaoId` sintético: «relogio:<id>» para o despertar (a linha do relógio é única
 *     por «conta:conversa:tipo») ou «entrada:<id>» para a mensagem avulsa da portaria. Nenhum dos
 *     dois é execução de fluxo, e é assim que tem de ser (ver `PREFIXO_EXECUCAO_SINTETICA`);
 *   • `noId` fixo — não há nó de fluxo aqui, mas a chave exige um, e fixo é rastreável num `grep`;
 *   • `sufixo` com o CICLO — no relógio é o carimbo de `disparadoEm`: re-armar zera esse campo e o
 *     disparo seguinte grava outro, então a próxima inatividade PODE avisar de novo e a reentrega da
 *     mesma não pode. Na mensagem de entrada o ciclo já está no `alvo` (a entrada), e o sufixo só
 *     carrega o motivo, para o caso de a mesma entrada gerar textos de naturezas diferentes;
 *   • `tentativa` FIXA em 1, de propósito e ao contrário do que o motor faz nos nós. Lá a tentativa
 *     entra na chave para que um reenvio legítimo não colida com o anterior; aqui reentrega é
 *     justamente o que NÃO pode virar segunda mensagem.
 *
 * `visitaSeq` fica em 0: a coluna é `Int` no schema e um carimbo de tempo em segundos encostaria no
 * teto de `Int4` em 2038. O ciclo vive no `alvo` e no `sufixo`, que são texto.
 */
export function chaveDoCiclo({ alvo, noId, sufixoCiclo }) {
  return chaveEfeito({ execucaoId: alvo, noId, visitaSeq: 0, tentativa: 1, sufixo: sufixoCiclo });
}

/** O `execucaoId` sintético que acompanha a chave — precisa ser o MESMO usado em `chaveDoDespertar`,
 *  porque `reservarEfeito` recalcula a chave a partir dos campos. */
function execucaoSintetica({ relogioId, cwAccountId, cwConversationId }) {
  return relogioId
    ? `${PREFIXO_EXECUCAO_SINTETICA}${relogioId}`
    : `${PREFIXO_EXECUCAO_SINTETICA}conv:${cwAccountId}:${cwConversationId}`;
}

/**
 * O alvo sintético da MENSAGEM AVULSA da portaria.
 *
 * Aqui o «ciclo» é a ENTRADA — a mensagem que o cliente mandou e que fez a portaria decidir
 * responder. `RagnabotFluxoEntrada.id` é o identificador estável dessa decisão, e a portaria já
 * deduplica entrega repetida do Chatwoot pelo campo `chave` antes de chegar aqui. Logo: mesma
 * entrada = mesma chave de efeito = uma mensagem só, por mais vezes que a fila reentregue o
 * trabalho. Sem `entradaId` (não deveria acontecer), o identificador do próprio trabalho serve —
 * é pior, porque um reenfileiramento criaria chave nova, e por isso o caso é registrado no log.
 */
function alvoDaMensagem({ entradaId, jobId }) {
  return entradaId
    ? `entrada:${entradaId}`
    : `entrada:job:${jobId}`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §5.3 — A PARTIÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Há passo de fluxo VIVO nesta conversa?
 *
 * Duas medições, porque uma só deixa buraco:
 *   1. o ESTADO da execução — se existe execução em estado ativo que não seja `pausado_humano`, a
 *      conversa é do fluxo e o relógio não encosta nela (é a mesma regra de `podeArmarRelogio()` do
 *      trabalhador, escrita aqui a partir de `ESTADOS_ATIVOS` do motor para não haver duas listas);
 *   2. um TRABALHO da fila em `processando` na mesma partição — alguém está literalmente no meio de
 *      um passo agora. O estado no banco ainda não mudou, e só o estado não veria isso.
 *
 * Trabalho `pendente` NÃO conta: um despertar agendado para daqui a quatro minutos não é passo
 * vivo, e tratá-lo como tal deixaria o relógio adiado para sempre em toda conversa que tem fluxo.
 *
 * @returns {Promise<null|{motivo:string, detalhe:string}>} nulo quando o caminho está livre
 */
export async function fluxoVivoNaParticao({ cwAccountId, cwConversationId }) {
  const cliente = db();
  const chaveParticao = chaveParticaoDe({ cwAccountId, cwConversationId });

  const exec = await cliente.ragnabotFluxoExecucao.findFirst({
    where: { cwAccountId, cwConversationId, estado: { in: [...ESTADOS_ATIVOS] } },
    orderBy: { iniciadaEm: 'desc' },
  });
  if (exec && exec.estado !== PAUSA_QUE_LIBERA_O_RELOGIO) {
    return { motivo: 'execucao_viva', detalhe: `execução ${exec.id} em "${exec.estado}"` };
  }

  const emCurso = await cliente.ragnabotFluxoFila.findFirst({
    where: { chaveParticao, status: 'processando', tipo: { notIn: [...TIPOS_TRATADOS] } },
  });
  if (emCurso) {
    return { motivo: 'passo_em_curso', detalhe: `trabalho ${emCurso.id} tipo "${emCurso.tipo}" em processamento` };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// JANELA DE 24 HORAS — a mesma doutrina do motor
//
// ⚠️ QUANDO NÃO DÁ PARA DECIDIR, NÃO SE CHUTA. Sem `phoneNumberId` e sem o telefone do contato, a
// resposta é `aberta: null` — indeterminada — e quem decide é a PortaCanal, que fala com a Meta e
// recebe a recusa autoritativa. Um padrão otimista transformaria a política em esperança; um padrão
// pessimista calaria toda caixa cujo número ainda não foi cadastrado.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function avaliarJanelaDoDespertar({ tenantId, cwAccountId, cwConversationId, phoneNumberId, contatoChave }) {
  if (portas.janela?.avaliar) {
    const r = await portas.janela.avaliar({ tenantId, cwAccountId, cwConversationId, phoneNumberId, contatoChave });
    return { aberta: r?.aberta ?? null, motivo: r?.motivo ?? 'porta_janela' };
  }
  if (!phoneNumberId || !contatoChave) return { aberta: null, motivo: 'indeterminada' };

  const linha = await db().ragnabotFluxoJanela.findUnique({
    where: { phoneNumberId_destinatarioWaId: { phoneNumberId, destinatarioWaId: contatoChave } },
  }).catch(() => null);
  if (!linha) return { aberta: false, motivo: 'sem_registro' };
  if (linha.fechadaPeloDestinoEm) return { aberta: false, motivo: 'fechada_pelo_destino' };

  const instante = await agora();
  const margem = linha.margemSegurancaSegundos ?? 300;
  const limite = somarMs(linha.expiraEm, -margem * 1000);
  const aberta = instante < limite;
  return { aberta, motivo: aberta ? 'aberta' : 'vencida' };
}

/**
 * O `phoneNumberId` NÃO mora na política nem no relógio — ele vive em `RagnabotInbox.metadata`
 * (`{wabaId, phoneNumberId, ...}`), porque é atributo da CONEXÃO, não da regra de atendimento. E a
 * chave da janela de 24 h é (número DA EMPRESA, destinatário): com duas conexões de WhatsApp na
 * mesma empresa, uma janela aberta por um número não vale pelo outro.
 *
 * Devolve `null` quando não dá para saber — e `null` aqui significa «indeterminada», que faz
 * `avaliarJanelaDoDespertar` deixar a decisão para a PortaCanal, e não «fechada».
 */
async function phoneNumberIdDaCaixa({ tenantId, cwInboxId }) {
  if (!tenantId || cwInboxId == null) return null;
  const caixa = await db().ragnabotInbox.findFirst({ where: { tenantId, cwInboxId } }).catch(() => null);
  const meta = caixa?.metadata;
  const valor = meta && typeof meta === 'object' ? meta.phoneNumberId : null;
  return valor ? String(valor) : null;
}

/** A única classificação de erro que interessa aqui: o canal recusou por janela fechada?
 *  Espelha o ramo `fora_da_janela` de `classificarErroDeDespacho()` do motor (que não é exportada),
 *  e usa `ehErroDoMotor` — nunca `instanceof`, pela razão já registrada nos dois arquivos vizinhos:
 *  duas classes com o mesmo nome em módulos diferentes fazem `instanceof` mentir. */
function ehJanelaFechada(e) {
  return e?.foraDaJanela === true || ehErroDoMotor(e, 'JANELA_FECHADA');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O TRABALHO — um despertar, do início ao fim
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Nota interna. Nunca lança: registro perdido é ruim, atendimento derrubado por causa de registro
 *  é pior — a mesma escolha já feita no trabalhador e na auditoria. */
async function anotar({ tenantId, cwAccountId, cwConversationId, texto }) {
  const cw = portas.chatwoot;
  if (!cw?.notaInterna || !texto) return false;
  try {
    await cw.notaInterna({ cwAccountId, cwConversationId, texto, tenantId });
    return true;
  } catch (e) {
    log().warn?.(`[atend-despertar] nota interna falhou: ${e.message}`);
    return false;
  }
}

/**
 * Processa UM trabalho deste consumidor. São dois tipos, e o caminho de entrega é o MESMO — o que
 * muda é de onde vem o texto e o que conta como «ciclo» para a idempotência:
 *
 *   • `atend_relogio` + `acao='notificar'` — o «ainda está aí?» do relógio de inatividade. O ciclo
 *     é o disparo do relógio (`disparadoEm`).
 *   • `atend_mensagem` — a mensagem avulsa da portaria de entrada (fora de expediente, intervalo,
 *     feriado, despedida de fila). O ciclo é a ENTRADA que a originou (`entradaId`).
 *
 * Unificar os dois foi decisão consciente, e não economia de arquivo: as garantias exigidas são
 * literalmente as mesmas quatro (idempotência por efeito reservado, janela de 24 h com a ação de
 * estado acontecendo mesmo quando a mensagem não sai, partição respeitada, degradação declarada sem
 * porta). Dois consumidores significariam duas implementações dessas quatro regras, dois laços
 * disputando a mesma tabela e dois lugares para alguém corrigir quando uma delas mudar.
 *
 * NUNCA lança por falha de ação: devolve `{resultado, detalhe}` e deixa a linha legível. Consumidor
 * que morre por causa de uma conversa deixa as outras trezentas sem aviso.
 *
 * @param {object} job    linha de `RagnabotFluxoFila` (ou objeto equivalente)
 * @param {{workerId?:string}} opcoes
 * @returns {Promise<{resultado:string, detalhe:string, chave?:string}>}
 */
export async function processarDespertar(job, { workerId = 'atend-despertar' } = {}) {
  if (!job || !TIPOS_TRATADOS.includes(job.tipo)) {
    return { resultado: RESULTADOS_DESPERTAR.IGNORADO, detalhe: `tipo "${job?.tipo ?? 'nulo'}" não é tratado por este consumidor` };
  }
  if (job.tipo === TIPO_JOB_MENSAGEM) return processarMensagemDeEntrada(job, workerId);
  return processarDespertarDoRelogio(job, workerId);
}

/** «conta:conversa» → os dois inteiros. A partição é a única fonte que TODO trabalho tem: o
 *  `atend_mensagem` da portaria, por exemplo, não carrega `cwAccountId` no payload. */
function pedacosDaParticao(chaveParticao) {
  const [conta, conversa] = String(chaveParticao ?? '').split(':');
  const c = Number(conta); const v = Number(conversa);
  return { cwAccountId: Number.isFinite(c) ? c : null, cwConversationId: Number.isFinite(v) ? v : null };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// TIPO 1 — `atend_relogio`, ação `notificar`
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function processarDespertarDoRelogio(job, workerId) {
  const payload = job.payload ?? {};
  if (payload.acao !== ACOES_INATIVIDADE.NOTIFICAR) {
    // As outras ações do relógio acontecem dentro do trabalhador, e não passam por aqui. Devolver
    // `ignorado` (e não `erro`) é o que impede um trabalho legítimo de outro dono de queimar as oito
    // tentativas da fila.
    return { resultado: RESULTADOS_DESPERTAR.IGNORADO, detalhe: `ação "${payload.acao ?? 'nula'}" não é tratada por este consumidor` };
  }

  const cliente = db();

  // ── 1. O RELÓGIO: existe ainda, e é do ciclo que este trabalho conhece? ────────────────────────
  const relogio = payload.relogioId
    ? await cliente.ragnabotAtendRelogio.findUnique({ where: { id: payload.relogioId } }).catch(() => null)
    : null;

  if (payload.relogioId && !relogio) {
    return { resultado: RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO, detalhe: 'o relógio que originou este despertar não existe mais' };
  }
  // Re-armar repõe `disparadoEm=null` na MESMA linha (o `chave` do relógio é único por
  // conta:conversa:tipo). Um despertar que chega depois disso fala de um ciclo que já não existe.
  if (relogio && !relogio.disparadoEm) {
    return { resultado: RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO, detalhe: 'o relógio foi re-armado (o cliente ou o atendente falou antes do prazo)' };
  }
  if (relogio && relogio.resultado === 'descartado_obsoleto') {
    return { resultado: RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO, detalhe: 'o ciclo foi marcado obsoleto pelo trabalhador' };
  }

  const daParticao = pedacosDaParticao(job.chaveParticao);
  const cwAccountId = relogio?.cwAccountId ?? payload.cwAccountId ?? daParticao.cwAccountId;
  const cwConversationId = relogio?.cwConversationId ?? payload.cwConversationId ?? daParticao.cwConversationId;
  if (cwAccountId == null || cwConversationId == null) {
    return { resultado: RESULTADOS_DESPERTAR.ERRO, detalhe: 'trabalho sem conta/conversa — nem no relógio, nem no payload, nem na partição' };
  }

  const politicaId = payload.politicaId ?? relogio?.politicaId ?? null;
  const politica = politicaId
    ? await cliente.ragnabotAtendPolitica.findUnique({ where: { id: politicaId } }).catch(() => null)
    : null;
  const tenantId = relogio?.tenantId ?? politica?.tenantId ?? job.tenantId ?? null;

  // ── 2. §5.3 — a partição manda. Sem isso, duas mensagens no mesmo minuto ───────────────────────
  const vivo = await fluxoVivoNaParticao({ cwAccountId, cwConversationId });
  if (vivo) return { resultado: RESULTADOS_DESPERTAR.ADIADO_PARTICAO, detalhe: `${vivo.motivo}: ${vivo.detalhe}` };

  // ── 3. O TEXTO ────────────────────────────────────────────────────────────────────────────────
  const contexto = { protocolo: payload.protocolo ?? null, conversa: { id: cwConversationId }, ...(payload.contexto ?? {}) };
  const { texto, faltantes } = aplicarModelo(payload.texto ?? politica?.inatividadeMensagem ?? SEM_TEXTO, contexto);
  if (faltantes.length) {
    log().warn?.(`[atend-despertar] placeholders sem valor na mensagem de inatividade: ${faltantes.join(', ')}`);
  }

  const cicloEm = relogio?.disparadoEm ?? payload.cicloEm ?? job.criadoEm ?? null;
  const relogioId = relogio?.id ?? payload.relogioId ?? null;

  return entregar({
    workerId,
    alvo: execucaoSintetica({ relogioId, cwAccountId, cwConversationId }),
    noId: NO_SINTETICO,
    sufixoCiclo: `ciclo:${cicloEm ? new Date(cicloEm).toISOString() : 'sem-ciclo'}`,
    tenantId, cwAccountId, cwConversationId,
    cwInboxId: payload.cwInboxId ?? politica?.cwInboxId ?? null,
    contatoChave: payload.contatoChave ?? null,
    phoneNumberId: payload.phoneNumberId ?? null,
    texto,
    // A nota interna é a AÇÃO DE ESTADO desta ação: `notificar` não mexe em status nem em
    // responsável — ela existe para «avisar quem tem de saber». Por isso sai sempre.
    notaSempre: true,
    motivoInterno: 'Inatividade sinalizada à supervisão.',
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// TIPO 2 — `atend_mensagem`, a mensagem avulsa da portaria de entrada
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function processarMensagemDeEntrada(job, workerId) {
  const payload = job.payload ?? {};
  const daParticao = pedacosDaParticao(job.chaveParticao);
  const cwAccountId = payload.cwAccountId ?? daParticao.cwAccountId;
  const cwConversationId = payload.cwConversationId ?? daParticao.cwConversationId;
  if (cwAccountId == null || cwConversationId == null) {
    return { resultado: RESULTADOS_DESPERTAR.ERRO, detalhe: 'trabalho sem conta/conversa — nem no payload nem na partição' };
  }
  const tenantId = job.tenantId ?? null;

  // ⚠️ MENSAGEM DE ENTRADA TEM PRAZO DE VALIDADE, e este é o único ponto em que os dois tipos
  // divergem de verdade. «Voltamos às 13h» entregue às 16h é pior que não entregue: contradiz o que
  // o cliente está vendo na tela e faz o robô parecer quebrado. O despertar do relógio não tem esse
  // problema (o «ainda está aí?» continua verdadeiro depois), e por isso não expira.
  const nascimento = job.criadoEm ?? null;
  if (nascimento) {
    const idadeMin = (Date.now() - new Date(nascimento).getTime()) / 60_000;
    if (idadeMin > VALIDADE_MENSAGEM_MINUTOS) {
      return {
        resultado: RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO,
        detalhe: `mensagem de entrada vencida (${Math.round(idadeMin)} min na fila, teto de ${VALIDADE_MENSAGEM_MINUTOS})`,
      };
    }
  }

  // §5.3 vale aqui também: a portaria só enfileira mensagem avulsa quando NENHUMA execução nasce,
  // mas entre a decisão dela e o consumo daqui um fluxo pode ter começado por outro caminho — e o
  // cliente não pode receber «voltamos às 13h» no meio de um menu.
  const vivo = await fluxoVivoNaParticao({ cwAccountId, cwConversationId });
  if (vivo) return { resultado: RESULTADOS_DESPERTAR.ADIADO_PARTICAO, detalhe: `${vivo.motivo}: ${vivo.detalhe}` };

  const entradaId = job.entradaId ?? payload.entradaId ?? null;
  if (!entradaId) {
    log().warn?.(`[atend-despertar] mensagem de entrada sem entradaId (trabalho ${job.id}) — a idempotência cai para o id do trabalho`);
  }

  const { texto } = aplicarModelo(payload.texto ?? null, {
    conversa: { id: cwConversationId }, ...(payload.contexto ?? {}),
  });

  // A AÇÃO DE ESTADO deste tipo: encerrar a conversa depois da despedida, quando a política mandou
  // («encerra ou deixa aberta», doc 29 §1.4). Ela acontece MESMO se a mensagem não sair — é a regra
  // do §5.6 aplicada ao pé da letra.
  const aposEntrega = payload.encerrarApos === true
    ? async () => {
      const cw = portas.chatwoot;
      if (!cw?.resolver) return { ok: false, nota: 'A conversa NÃO foi encerrada — porta de resolução ausente.' };
      await cw.resolver({ cwAccountId, cwConversationId, tenantId });
      return { ok: true, nota: 'Conversa encerrada automaticamente após a mensagem.' };
    }
    : null;

  return entregar({
    workerId,
    alvo: alvoDaMensagem({ entradaId, jobId: job.id }),
    noId: NO_SINTETICO_MENSAGEM,
    sufixoCiclo: `motivo:${payload.motivo ?? 'sem_motivo'}`,
    tenantId, cwAccountId, cwConversationId,
    cwInboxId: payload.cwInboxId ?? null,
    contatoChave: payload.contatoChave ?? null,
    phoneNumberId: payload.phoneNumberId ?? null,
    texto,
    // Aqui a nota interna NÃO sai sempre, e é de propósito: uma nota a cada saudação de fora de
    // expediente encheria a conversa de ruído para o atendente que a abrir amanhã. Ela sai quando
    // há algo que só a nota conta — a mensagem que não saiu, ou o encerramento automático.
    notaSempre: false,
    motivoInterno: `Mensagem automática de entrada (${payload.motivo ?? 'sem motivo declarado'}).`,
    aposEntrega,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O NÚCLEO COMUM — daqui para baixo os dois tipos percorrem exatamente o mesmo caminho
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function entregar(plano) {
  const {
    alvo, noId, sufixoCiclo, tenantId, cwAccountId, cwConversationId, cwInboxId,
    texto, notaSempre, motivoInterno, aposEntrega = null, workerId = 'atend-despertar',
  } = plano;
  const cliente = db();
  const chave = chaveDoCiclo({ alvo, noId, sufixoCiclo });

  // ── O PORTÃO DA IDEMPOTÊNCIA — antes da nota interna e antes de qualquer envio ─────────────────
  // Reservado, confirmado, duvidoso, falhou ou descartado: em TODOS, alguém já tratou este ciclo.
  // Repetir «para garantir» é exatamente como o cliente recebe a mesma frase duas vezes.
  const jaExiste = await cliente.ragnabotFluxoEfeito.findUnique({ where: { chave } }).catch(() => null);
  if (jaExiste) {
    return {
      resultado: RESULTADOS_DESPERTAR.JA_NOTIFICADO,
      detalhe: `este ciclo já foi tratado (efeito "${jaExiste.status}"${jaExiste.motivoDescarte ? `: ${jaExiste.motivoDescarte}` : ''})`,
      chave,
    };
  }

  // ── A JANELA DE 24 H ──────────────────────────────────────────────────────────────────────────
  const execucaoConhecida = await cliente.ragnabotFluxoExecucao.findFirst({
    where: { cwAccountId, cwConversationId }, orderBy: { iniciadaEm: 'desc' },
  }).catch(() => null);
  const contatoChave = plano.contatoChave ?? execucaoConhecida?.contatoChave ?? null;
  const phoneNumberId = plano.phoneNumberId ?? await phoneNumberIdDaCaixa({ tenantId, cwInboxId });
  const janela = texto
    ? await avaliarJanelaDoDespertar({ tenantId, cwAccountId, cwConversationId, phoneNumberId, contatoChave })
    : { aberta: null, motivo: 'sem_texto' };

  await reservarEfeito({
    execucaoId: alvo, tenantId: tenantId ?? 'desconhecido', noId, visitaSeq: 0, tentativa: 1,
    sufixo: sufixoCiclo, tipo: 'msg_texto',
    // ⚠️ 'seguir' de propósito: efeito com esta política é EXCLUÍDO de
    // `efeitoPendenteBloqueante()`. Encanamento do relógio e da portaria nunca pode congelar o
    // atendimento de quem está do outro lado — a mesma separação que faz `erro_interno` seguir o
    // fluxo no motor.
    politicaEmDuvida: 'seguir',
  }, null);

  let enviado = false;
  let motivoNaoEnviado = null;
  let desfecho = null;

  if (!texto) {
    // Configuração legítima: «age em silêncio». O efeito não representa envio nenhum.
    await descartarEfeito(chave, { motivoDescarte: 'sem_texto_configurado' });
  } else if (!portas.canal?.portaDa) {
    await descartarEfeito(chave, { motivoDescarte: 'porta_ausente' });
    motivoNaoEnviado = 'porta de canal ausente';
    desfecho = { resultado: RESULTADOS_DESPERTAR.SEM_PORTA, detalhe: 'porta de canal ausente; ação de estado feita e motivo registrado' };
    log().warn?.('[atend-despertar] porta de canal ausente — o texto para o cliente não pôde sair (a nota interna saiu)');
  } else if (janela.aberta === false) {
    // §5.6 ao pé da letra: a ação de estado acontece, a mensagem não, e o motivo fica escrito.
    await descartarEfeito(chave, { motivoDescarte: 'fora_da_janela' });
    motivoNaoEnviado = `a janela de 24 h do WhatsApp está fechada (${janela.motivo})`;
    desfecho = { resultado: RESULTADOS_DESPERTAR.SEM_JANELA, detalhe: `janela de 24 h fechada (${janela.motivo}) — ação de estado feita, mensagem não enviada` };
  } else {
    try {
      const porta = await portas.canal.portaDa({ id: alvo, tenantId, cwAccountId, cwConversationId, contatoChave, phoneNumberId });
      if (!porta?.enviar) throw new Error('a porta do canal não expõe enviar()');
      const r = await porta.enviar(
        { tipo: 'texto', corpo: texto, sufixo: '', chaveEfeito: chave, origem: noId },
        { execucao: { id: alvo, tenantId, cwAccountId, cwConversationId }, noId, visitaSeq: 0 },
      );
      await confirmarEfeito(chave, {
        idExterno: r?.idExterno ?? r?.wamid ?? null, httpStatus: r?.httpStatus ?? null, resposta: r?.resumo ?? null,
      });
      enviado = true;
    } catch (e) {
      if (ehJanelaFechada(e)) {
        // A recusa autoritativa veio do canal — é o caso `aberta: null` (indeterminada) resolvido
        // pela única autoridade que existe. Mesmo desfecho do ramo acima: não é falha.
        await descartarEfeito(chave, { motivoDescarte: 'fora_da_janela' });
        motivoNaoEnviado = 'a janela de 24 h do WhatsApp está fechada (recusa do canal)';
        desfecho = { resultado: RESULTADOS_DESPERTAR.SEM_JANELA, detalhe: 'janela de 24 h fechada (recusa do canal) — ação de estado feita, mensagem não enviada' };
      } else {
        await falharEfeito(chave, { erro: e.message, httpStatus: e.status ?? e.httpStatus ?? null });
        motivoNaoEnviado = e.message;
        desfecho = { resultado: RESULTADOS_DESPERTAR.ERRO, detalhe: `mensagem não enviada: ${e.message}` };
        log().warn?.(`[atend-despertar] envio falhou (worker ${workerId}): ${e.message}`);
      }
    }
  }

  // ── A AÇÃO DE ESTADO POSTERIOR — acontece mesmo quando a mensagem não saiu ─────────────────────
  let estado = null;
  if (aposEntrega) {
    estado = await aposEntrega().catch((e) => {
      log().warn?.(`[atend-despertar] ação de estado falhou: ${e.message}`);
      return { ok: false, nota: `A ação de estado NÃO foi aplicada — motivo: ${e.message}.` };
    });
  }

  // ── A NOTA INTERNA ────────────────────────────────────────────────────────────────────────────
  if (notaSempre || motivoNaoEnviado || estado) {
    const partes = [`Automação: ${motivoInterno}`];
    if (motivoNaoEnviado) partes.push(`O texto para o cliente NÃO saiu — motivo: ${motivoNaoEnviado}.`);
    else if (enviado) partes.push('A mensagem foi enviada ao cliente.');
    else partes.push('Nenhum texto configurado para o cliente.');
    if (estado?.nota) partes.push(estado.nota);
    await anotar({ tenantId, cwAccountId, cwConversationId, texto: partes.join(' ') });
  }

  if (desfecho) return { ...desfecho, chave };
  return {
    resultado: RESULTADOS_DESPERTAR.NOTIFICADO,
    detalhe: enviado ? 'mensagem enviada ao cliente' : 'nada a enviar (configuração age em silêncio)',
    chave,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A RODADA — quem tira o trabalho da fila
//
// ⚠️ POR QUE **NÃO** USAR `fila.drenarParticao()` DO MOTOR: ela drena TODOS os trabalhos pendentes
// da partição, de qualquer tipo. Um consumidor de relógio que a chamasse roubaria os trabalhos de
// fluxo da mesma conversa e os daria por processados sem os executar — a conversa ficaria muda. Por
// isso a reivindicação aqui é linha a linha, condicional, e só sobre `tipo='atend_relogio'`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Reivindicação CONDICIONAL: `status='pendente'` no WHERE é o que faz dois consumidores nunca
 *  pegarem o mesmo trabalho. Zero linhas afetadas não é erro — é «outro pegou primeiro». */
async function reivindicar(job, workerId, instante) {
  const r = await db().ragnabotFluxoFila.updateMany({
    where: { id: job.id, status: 'pendente' },
    data: { status: 'processando', donoWorker: workerId, travadoEm: instante, tentativas: { increment: 1 } },
  });
  return r.count === 1;
}

async function fecharTrabalho(job, status, { erro = null, resultado = null } = {}) {
  await db().ragnabotFluxoFila.updateMany({
    where: { id: job.id },
    data: { status, ultimoErro: erro ? String(erro).slice(0, 500) : null, donoWorker: null, travadoEm: null },
  }).catch((e) => log().warn?.(`[atend-despertar] não consegui fechar o trabalho ${job.id}: ${e.message}`));
  return resultado;
}

/**
 * Reabre trabalho preso em `processando` por consumidor que morreu.
 *
 * Sem isto, um reinício no meio de um despertar deixa a linha em `processando` para sempre — e o
 * sintoma para o dono é «essa conversa nunca recebeu o aviso», sem nenhum registro dizendo por quê.
 * É a mesma função que o trabalhador de atendimento chama de ceifador, e existe pela mesma razão.
 */
export async function ceifarDespertaresPresos({ minutos = CEIFADOR_MINUTOS } = {}) {
  const instante = await agora();
  const corte = somarMs(instante, -minutos * 60_000);
  const presos = await db().ragnabotFluxoFila.findMany({
    where: { tipo: { in: [...TIPOS_TRATADOS] }, status: 'processando', travadoEm: { lt: corte } },
    take: 100,
  });
  let reabertos = 0;
  for (const j of presos) {
    const r = await db().ragnabotFluxoFila.updateMany({
      where: { id: j.id, status: 'processando' },
      data: { status: 'pendente', donoWorker: null, travadoEm: null, ultimoErro: `reaberto pelo ceifador (preso desde ${new Date(j.travadoEm).toISOString()})` },
    });
    reabertos += r.count;
  }
  return { vistos: presos.length, reabertos };
}

/**
 * Uma rodada: ceifa o que ficou preso, pega os despertares disponíveis e processa cada um.
 * Nunca lança — exceção aqui derrubaria o `setInterval` e o consumidor pararia em silêncio, que é a
 * pior falha possível num relógio.
 */
export async function rodadaDeDespertar({ workerId = 'atend-despertar', limite = 25 } = {}) {
  const resumo = {
    vistos: 0, notificados: 0, jaNotificados: 0, semJanela: 0,
    adiados: 0, obsoletos: 0, semPorta: 0, ignorados: 0, erros: 0, disputados: 0, envenenados: 0,
  };
  try {
    resumo.ceifador = await ceifarDespertaresPresos().catch((e) => {
      log().warn?.(`[atend-despertar] ceifador: ${e.message}`); return null;
    });

    const instante = await agora();
    const candidatos = await db().ragnabotFluxoFila.findMany({
      where: { tipo: { in: [...TIPOS_TRATADOS] }, status: 'pendente', disponivelEm: { lte: instante } },
      orderBy: [{ prioridade: 'asc' }, { disponivelEm: 'asc' }],
      take: limite,
    });
    resumo.vistos = candidatos.length;

    for (const job of candidatos) {
      // ⚠️ LIDO ANTES DE REIVINDICAR. A reivindicação incrementa `tentativas`, e o cliente do banco
      // pode devolver a MESMA instância de objeto depois do UPDATE — ler o valor depois daria o
      // número já incrementado e o ramo «adiado» reporia o contador errado. Foi um defeito real,
      // pego pelo teste 14.
      const tentativasAntes = job.tentativas ?? 0;
      if (!(await reivindicar(job, workerId, instante))) { resumo.disputados += 1; continue; }

      // Trabalho envenenado: estourou o teto de tentativas. Marcar `falhou` (e não reenfileirar
      // para sempre) é o que impede uma linha defeituosa de consumir a rodada inteira todo minuto.
      const tentativas = tentativasAntes + 1;
      const teto = job.maxTentativas ?? 8;
      let r;
      try {
        r = await processarDespertar(job, { workerId });
      } catch (e) {
        // `processarDespertar` promete não lançar; se lançar, é defeito nosso e tem de aparecer.
        log().error?.(`[atend-despertar] exceção inesperada no trabalho ${job.id}: ${e.message}`);
        r = { resultado: RESULTADOS_DESPERTAR.ERRO, detalhe: e.message };
      }

      switch (r.resultado) {
        case RESULTADOS_DESPERTAR.NOTIFICADO: resumo.notificados += 1; break;
        case RESULTADOS_DESPERTAR.JA_NOTIFICADO: resumo.jaNotificados += 1; break;
        case RESULTADOS_DESPERTAR.SEM_JANELA: resumo.semJanela += 1; break;
        case RESULTADOS_DESPERTAR.ADIADO_PARTICAO: resumo.adiados += 1; break;
        case RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO: resumo.obsoletos += 1; break;
        case RESULTADOS_DESPERTAR.SEM_PORTA: resumo.semPorta += 1; break;
        case RESULTADOS_DESPERTAR.IGNORADO: resumo.ignorados += 1; break;
        default: resumo.erros += 1; break;
      }

      if (r.resultado === RESULTADOS_DESPERTAR.ADIADO_PARTICAO) {
        // Volta para a fila, disponível daqui a pouco: o passo de fluxo vai terminar.
        await db().ragnabotFluxoFila.updateMany({
          where: { id: job.id },
          // Devolve SEM contar tentativa — não houve defeito no trabalho, e é a mesma regra que o
          // motor aplica a `PossePerdida`. Sem isto, uma conversa com fluxo demorado envenenaria um
          // trabalho perfeitamente sadio em oito adiamentos.
          data: { status: 'pendente', donoWorker: null, travadoEm: null, ultimoErro: r.detalhe, tentativas: tentativasAntes, disponivelEm: somarMs(instante, 30_000) },
        });
        continue;
      }
      if (r.resultado === RESULTADOS_DESPERTAR.DESCARTADO_OBSOLETO || r.resultado === RESULTADOS_DESPERTAR.IGNORADO) {
        await fecharTrabalho(job, 'descartado', { erro: r.detalhe });
        continue;
      }
      if (r.resultado === RESULTADOS_DESPERTAR.ERRO) {
        if (tentativas >= teto) { resumo.envenenados += 1; await fecharTrabalho(job, 'falhou', { erro: r.detalhe }); continue; }
        await db().ragnabotFluxoFila.updateMany({
          where: { id: job.id },
          data: { status: 'pendente', donoWorker: null, travadoEm: null, ultimoErro: r.detalhe, disponivelEm: somarMs(instante, 60_000) },
        });
        continue;
      }
      // notificado | ja_notificado | sem_janela | sem_porta — todos são DESFECHO. Fora da janela em
      // especial: reentregar oito vezes um trabalho que nunca poderá dar certo é só barulho.
      await fecharTrabalho(job, 'feito', { erro: null });
    }

    if (resumo.notificados || resumo.semJanela || resumo.erros) {
      log().info?.(
        `[atend-despertar] rodada · vistos ${resumo.vistos} · notificados ${resumo.notificados} · `
        + `sem janela ${resumo.semJanela} · já notificados ${resumo.jaNotificados} · adiados ${resumo.adiados} · `
        + `obsoletos ${resumo.obsoletos} · erros ${resumo.erros}`,
      );
    }
  } catch (e) {
    log().error?.(`[atend-despertar] erro não previsto na rodada: ${e.message}`);
    resumo.erro = e.message;
  }
  return resumo;
}

/** Trava de reentrância: um tique que demore mais que o intervalo NÃO pode se sobrepor ao seguinte.
 *  A reivindicação condicional já protegeria o banco, mas o log ficaria ilegível e o trabalho,
 *  dobrado. Mesma escolha do trabalhador de atendimento. */
let rodadaEmCurso = false;

async function tique(opcoes) {
  if (rodadaEmCurso) {
    log().warn?.('[atend-despertar] rodada anterior ainda em curso — este tique foi pulado');
    return { pulado: true };
  }
  rodadaEmCurso = true;
  try { return await rodadaDeDespertar(opcoes); } finally { rodadaEmCurso = false; }
}

/**
 * Liga o consumidor. Devolve a função que o desliga — e ela PRECISA ser chamada no encerramento do
 * processo: um `setInterval` órfão continua tocando o banco depois do desligamento gracioso.
 *
 * 15 segundos, e não 60 como o trabalhador: aqui o trabalho já venceu: quem esperou os minutos foi o
 * relógio, e a partir da hora em que ele decidiu agir todo segundo a mais é o cliente esperando.
 */
export function iniciarConsumidorDeDespertar({ intervaloMs = 15_000, ...opcoes } = {}) {
  const alca = setInterval(() => { tique(opcoes).catch(() => {}); }, intervaloMs);
  if (typeof alca.unref === 'function') alca.unref(); // não segura o processo no encerramento
  log().info?.(`[atend-despertar] consumidor do despertar ligado (tique de ${Math.round(intervaloMs / 1000)}s)`);
  return () => { clearInterval(alca); log().info?.('[atend-despertar] consumidor do despertar desligado'); };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// COMO AMARRAR NO PROCESSO (decisão do chefe — este arquivo não amarra nada sozinho)
//
//   import * as despertar from './services/ragnabot-atend-despertar.service.js';
//   import * as cw        from './services/ragnabot-chatwoot.porta.js';
//
//   despertar.configurarDespertar({ chatwoot: cw, canal: { portaDa: async (ctx) => portaCanalDe(ctx) } });
//   const desligar = despertar.iniciarConsumidorDeDespertar();
//   process.on('SIGTERM', desligar);
//
// ⚠️ SEM a porta `canal`, o consumidor continua rodando: registra a nota interna, avisa no log e
// devolve `sem_porta`. Degradar é melhor que travar — mas «degradado» não pode ser silencioso, e
// por isso o resultado tem nome próprio no resumo da rodada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
