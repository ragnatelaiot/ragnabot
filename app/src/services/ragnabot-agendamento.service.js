// ════════════════════════════════════════════════════════════════════════════════════════════════
// AGENDAMENTO DE MENSAGENS — o DOMÍNIO (contrato S4, doc 34 §F4, 02/09/2026)
//
// ── O QUE EU MEDI ANTES DE ESCREVER UMA LINHA ───────────────────────────────────────────────────
// O doc 34 diz «Agendamento de mensagem ❌ não existe». Conferi, e é verdade: `grep -i agend` no
// `schema.prisma` só devolvia COMENTÁRIOS de outras tabelas, não havia serviço, rota, tela nem
// teste. Mas «não existe» é diferente de «não há nada aproveitável» — e havia três peças prontas
// que este arquivo REUSA em vez de reescrever:
//
//   1. `RagnabotAtendRelogio` (o relógio por conversa) já resolveu o desenho de "fazer algo
//      depois": a LINHA é a verdade do prazo, o laço é só o despertador. O comentário do schema
//      dela diz por quê — «trabalho agendado que reinicia, é ceifado, ou é migrado de fila, some».
//      `RagnabotAgendamento.proximaEm` é o mesmo papel de `RagnabotAtendRelogio.venceEm`.
//   2. `RagnabotFluxoEfeito` (a caixa de saída de duas fases do motor) já resolveu «uma intenção,
//      uma mensagem»: reserva ANTES, confirma DEPOIS, chave determinística por envio.
//      `RagnabotAgendamentoEnvio.chave` é a mesma ideia, com a mesma função `chaveEfeito`.
//   3. A matemática de FUSO do trabalhador de atendimento (`partesNoFuso`, `instanteDe`) já foi
//      escrita, provada e paga: ela é iterativa de propósito, porque o deslocamento do fuso depende
//      do instante que se está procurando. Reescrevê-la aqui seria criar uma segunda verdade sobre
//      horário — e a primeira coisa que diverge, num par assim, é a virada do horário de verão.
//
// ── A DIVISÃO DE TRABALHO NESTE MÓDULO ──────────────────────────────────────────────────────────
// Este arquivo é o DOMÍNIO: vocabulário, recorrência, chaves e CRUD. Ele NÃO fala com a plataforma
// e NÃO tem laço. Quem dispara é `ragnabot-agendamento-worker.service.js`, e é lá que moram as
// portas injetáveis. A separação é a mesma de `ragnabot-atendimento.service.js` × `-worker`, e ela
// é o que permite provar a recorrência com função PURA, sem banco e sem relógio de processo.
//
// ── AS SEIS EXIGÊNCIAS DO CONTRATO, E ONDE CADA UMA MORA ────────────────────────────────────────
//   1. idempotência                → `chaveDeEnvio()` aqui; o `ON CONFLICT` no trabalhador
//   2. janela de 24 h              → `TEMPLATE` aqui; a decisão de mandar ou não, no trabalhador
//   3. recorrência com fuso        → `proximaOcorrencia()` aqui, função PURA
//   4. multi-contato independente  → `RagnabotAgendamentoDestino`; o laço por destino é do worker
//   5. cancelar/pausar             → `cancelar()`/`pausar()`/`retomar()` aqui
//   6. nada sai sem canal          → o trabalhador; o que este arquivo garante é `cwInboxId` NOT NULL
//
// ── ISOLAMENTO ──────────────────────────────────────────────────────────────────────────────────
// O `tenantId` NUNCA vem da tela para ampliar alcance: é derivado do usuário logado por
// `escopoDe()`, exatamente como em respostas rápidas e na caixa. Um `tenantId` no corpo só é aceito
// de quem é super — e aí ele ESTREITA, jamais ALARGA. Fora do escopo, `obter()` devolve `null` e a
// rota traduz em 404 (não 403: 403 confirmaria ao curioso que aquele id existe em alguma empresa).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import prismaPadrao from '../base/db.js';
import { escopoDe } from './ragnabot-auditoria.service.js';
// ⚠️ REUSO DELIBERADO, e não cópia: a matemática de fuso do trabalhador de atendimento é a única
// da casa e já está provada. Importar é o que impede duas verdades sobre horário. O import é
// seguro (não liga laço nenhum: quem liga é `iniciarTrabalhadorDeAtendimento`, e ninguém a chama
// daqui) e a seta é de mão única — o trabalhador de atendimento não conhece agendamento.
import { FUSO_PADRAO, partesNoFuso, instanteDe } from './ragnabot-atendimento-worker.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VOCABULÁRIO FECHADO
//
// String livre em coluna de decisão é como nasce o quinto valor que nenhum consumidor sabe tratar.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** As quatro recorrências que a tela do chat atual oferece («única / recorrente» com o período). */
export const RECORRENCIAS = Object.freeze(['unica', 'diaria', 'semanal', 'mensal']);

/** Estado do AGENDAMENTO (a agenda inteira). */
export const STATUS = Object.freeze({
  PENDENTE: 'pendente',
  PAUSADO: 'pausado',
  CONCLUIDO: 'concluido',
  CANCELADO: 'cancelado',
});

/**
 * Estado de UM ENVIO (um destinatário, uma ocorrência). O vocabulário é maior que
 * «enviado/falhou» de propósito: as três situações do meio são justamente as que o contrato manda
 * NÃO esconder.
 */
export const STATUS_ENVIO = Object.freeze({
  /** Nasceu; o envio ainda não voltou. É a primeira fase da caixa de saída. */
  RESERVADO: 'reservado',
  ENVIADO: 'enviado',
  /** Fora da janela de 24 h e sem modelo aprovado. NÃO saiu — e o motivo está escrito. */
  SEM_JANELA: 'sem_janela',
  /** Não havia por onde sair (canal fora, caixa inativa). RETENTÁVEL, com recuo. */
  ADIADO: 'adiado',
  /** O destino disse NÃO, ou o teto de tentativas estourou. */
  FALHOU: 'falhou',
  /**
   * O processo caiu entre a reserva e a confirmação, ou a rede caiu no meio do envio.
   * ⚠️ TERMINAL, e NÃO se repete sozinho: pode ter saído. Só um humano manda reenviar.
   */
  DUVIDOSO: 'duvidoso',
  /** O agendamento foi cancelado antes de este envio sair. */
  CANCELADO: 'cancelado',
});

/** Motivos declarados. Motivo em texto livre vira relatório que ninguém consegue agrupar. */
export const MOTIVOS = Object.freeze({
  FORA_DA_JANELA: 'fora_da_janela',
  CANAL_AUSENTE: 'canal_ausente',
  CAIXA_INATIVA: 'caixa_inativa',
  SEM_CONVERSA: 'sem_conversa',
  PROCESSO_CAIU: 'processo_caiu',
  DESTINO_RECUSOU: 'destino_recusou',
  TETO_DE_TENTATIVAS: 'teto_de_tentativas',
  AGENDAMENTO_CANCELADO: 'agendamento_cancelado',
});

/** Estados de envio que NÃO devem ser retentados por máquina nenhuma. */
export const ENVIO_TERMINAL = Object.freeze([
  STATUS_ENVIO.ENVIADO, STATUS_ENVIO.SEM_JANELA, STATUS_ENVIO.FALHOU,
  STATUS_ENVIO.DUVIDOSO, STATUS_ENVIO.CANCELADO,
]);

export const LIMITES = Object.freeze({
  titulo: 160,
  mensagem: 4000,
  destinos: 500, // teto por agendamento: acima disso é campanha, e campanha tem outro desenho
  intervalo: 365,
});

/** Quantas vezes um envio `adiado` é retentado antes de virar `falhou`. */
export const MAX_TENTATIVAS = 6;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS — mesmo desenho dos vizinhos; o teste troca implementação, nunca comportamento
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = { db: prismaPadrao };

export function configurarAgendamento(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no agendamento: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoAgendamento() { return { ...portas }; }
const db = () => portas.db;

/**
 * O modelo existe NESTE PROCESSO? A migração pode ter sido aplicada no banco e o processo ainda
 * carregar o cliente Prisma antigo — a tabela existir não basta. Sem esta guarda a rota estouraria
 * um TypeError cru («Cannot read properties of undefined») e o operador leria «erro 500» sem pista.
 */
export function modeloPronto() {
  return Boolean(db()?.ragnabotAgendamento?.findMany && db()?.ragnabotAgendamentoEnvio?.create);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A CHAVE DE IDEMPOTÊNCIA — a peça central do contrato
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A identidade de UM envio: um destinatário, numa ocorrência.
 *
 * ⚠️ O QUE ENTRA NA CHAVE, E POR QUÊ CADA COISA:
 *   · `agendamentoId` + `destinoId` — dois contatos do MESMO agendamento não podem colidir, senão
 *     o segundo seria descartado em silêncio e o cliente nunca receberia (é o D5/D6 do motor, do
 *     lado da saída);
 *   · `ocorrenciaEm` em ISO — é o que distingue a ocorrência de terça da de quarta num agendamento
 *     recorrente. Sem ele a chave seria constante e o recorrente disparava UMA vez na vida;
 *   · `tentativaManual` — o reenvio pedido por um humano é um envio NOVO, de propósito. A
 *     retentativa automática NÃO mexe aqui: ela reusa a MESMA linha, porque repetir automaticamente
 *     algo que talvez tenha saído é exatamente o que este arquivo existe para impedir.
 *
 * É sha256 e não a concatenação crua porque a chave viaja para fora (é o `rgt_efeito` que marca a
 * mensagem no destino) e não deve carregar identificadores internos legíveis.
 */
export function chaveDeEnvio({ agendamentoId, destinoId, ocorrenciaEm, tentativaManual = 0 }) {
  if (!agendamentoId || !destinoId) throw new Error('chaveDeEnvio: agendamentoId e destinoId são obrigatórios');
  const quando = ocorrenciaEm instanceof Date ? ocorrenciaEm : new Date(ocorrenciaEm);
  if (Number.isNaN(quando.getTime())) throw new Error('chaveDeEnvio: `ocorrenciaEm` inválida');
  const material = [agendamentoId, destinoId, quando.toISOString(), String(tentativaManual ?? 0)].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// RECORRÊNCIA — funções PURAS, e é de propósito
//
// Tudo o que decide «quando é a próxima» recebe a configuração e um instante, e devolve a resposta.
// Sem banco, sem rede, sem `Date.now()`. É o que torna possível PROVAR por teste o caso que
// ninguém reproduz à mão: a virada do dia às 23h59 e a virada do horário de verão.
//
// ⚠️ A REGRA QUE NÃO PODE SER MAL LIDA — A CONTA É DE CALENDÁRIO, NUNCA DE MILISSEGUNDOS.
// Somar 86.400.000 ms a «toda terça às 8h» funciona 363 dias por ano e erra UMA HORA nos dois dias
// de virada de horário de verão — que é o suficiente para a mensagem sair às 7h ou às 9h no relógio
// do cliente. Aqui se anda em DIA DE CALENDÁRIO e só no fim se converte para instante absoluto,
// pelo `instanteDe` do trabalhador de atendimento (que é iterativo justamente por isso).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dias da semana em CSV («0,3,5», domingo = 0) → array ordenado, único e válido.
 *
 * ⚠️ DEFEITO REAL, ACHADO PELO TESTE EM 02/09/2026, e a lição vale além daqui: `Number('')` é
 * ZERO, não `NaN`. A primeira versão desta função fazia `String(null ?? '').split(',')` → `['']` →
 * `Number('')` → `0` → e `0` é um dia da semana VÁLIDO. Resultado: uma recorrência semanal SEM dia
 * escolhido virava «todo domingo», em silêncio, sem erro nenhum — a agenda disparava no dia errado
 * e ninguém teria como suspeitar de onde veio o domingo. Por isso o filtro descarta o vazio ANTES
 * de converter.
 */
export function normalizarDiasSemana(valor) {
  const cru = Array.isArray(valor) ? valor : String(valor ?? '').split(',');
  const dias = [...new Set(cru
    .map((d) => String(d ?? '').trim())
    .filter((d) => /^\d+$/u.test(d)) // ← a trava: vazio e lixo saem ANTES do Number()
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return dias;
}

/** Soma dias a uma data de CALENDÁRIO (aritmética de calendário, sem tocar em fuso). */
function somarDiasLocal({ ano, mes, dia }, n) {
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), diaSemana: d.getUTCDay() };
}

/** Quantos dias tem o mês. Existe para o `mensal` grudar no fim do mês em vez de escorregar. */
function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Soma meses a uma data de calendário GRUDANDO no fim do mês.
 *
 * ⚠️ 31 de janeiro + 1 mês NÃO é 3 de março. O JavaScript faz isso sozinho (`new Date(2026,0,31)`
 * com `setMonth(1)` vira 3 de março) e o resultado seria «todo dia 31» virando dia 3 para sempre a
 * partir do primeiro fevereiro. Aqui a data é APARADA para o último dia do mês de destino — e o
 * `diaAncora` continua sendo 31, então março volta a ser 31. É a diferença entre uma agenda mensal
 * que se mantém e uma que escorrega um dia por ano.
 */
function somarMesesLocal({ ano, mes }, n, diaAncora) {
  const total = (ano * 12) + (mes - 1) + n;
  const anoNovo = Math.floor(total / 12);
  const mesNovo = (total % 12) + 1;
  const dia = Math.min(diaAncora, diasNoMes(anoNovo, mesNovo));
  return { ano: anoNovo, mes: mesNovo, dia };
}

/** Semanas inteiras entre duas datas de calendário (para o «a cada N semanas»). */
function semanasEntre(a, b) {
  const ma = Date.UTC(a.ano, a.mes - 1, a.dia);
  const mb = Date.UTC(b.ano, b.mes - 1, b.dia);
  return Math.floor((mb - ma) / (7 * 86_400_000));
}

/** O domingo da semana de uma data de calendário — a âncora do «a cada N semanas». */
function domingoDaSemana(d) {
  const dow = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
  return somarDiasLocal(d, -dow);
}

/**
 * A PRÓXIMA ocorrência depois de `depoisDe` — ou `null` quando a agenda acabou.
 *
 * @param {object} cfg
 * @param {string} cfg.recorrencia  unica | diaria | semanal | mensal
 * @param {number} cfg.intervalo    «a cada N» dias/semanas/meses
 * @param {string|number[]} cfg.diasSemana  só para `semanal`
 * @param {number} cfg.minutoLocal  minuto do dia (0..1439) NO FUSO — a âncora que sobrevive à virada
 * @param {string} cfg.fuso
 * @param {Date}   cfg.inicioEm     a primeira ocorrência (é dela que saem o dia-âncora e a semana-âncora)
 * @param {Date=}  cfg.ateEm
 * @param {number=} cfg.maxOcorrencias
 * @param {number=} cfg.ocorrenciasFeitas
 * @param {Date}   depoisDe         a ocorrência que ACABOU de sair
 * @returns {Date|null}
 *
 * ⚠️ O RESULTADO É SEMPRE ESTRITAMENTE MAIOR QUE `depoisDe`. É a trava contra a duplicação na
 * virada: se a conta de calendário caísse no MESMO instante (acontece quando um fuso volta o
 * relógio e o mesmo horário local existe duas vezes), o agendamento dispararia de novo no mesmo
 * segundo. O laço abaixo anda mais uma unidade em vez de devolver o instante repetido.
 */
export function proximaOcorrencia(cfg = {}, depoisDe) {
  const recorrencia = String(cfg.recorrencia || 'unica');
  if (recorrencia === 'unica') return null;
  if (!RECORRENCIAS.includes(recorrencia)) return null;

  const fuso = cfg.fuso || FUSO_PADRAO;
  const intervalo = Math.max(1, Math.min(LIMITES.intervalo, Number(cfg.intervalo) || 1));
  const minutoLocal = Math.max(0, Math.min(1439, Number(cfg.minutoLocal) || 0));
  const base = depoisDe instanceof Date ? depoisDe : new Date(depoisDe);
  if (Number.isNaN(base.getTime())) return null;

  // Teto de ocorrências e data-limite: a agenda ACABA, e acabar é um desfecho, não um defeito.
  const feitas = Number(cfg.ocorrenciasFeitas) || 0;
  if (Number.isFinite(Number(cfg.maxOcorrencias)) && cfg.maxOcorrencias != null && feitas >= Number(cfg.maxOcorrencias)) {
    return null;
  }

  const inicio = cfg.inicioEm instanceof Date ? cfg.inicioEm : (cfg.inicioEm ? new Date(cfg.inicioEm) : base);
  const pInicio = partesNoFuso(inicio, fuso);
  const pBase = partesNoFuso(base, fuso);

  let candidato = null;

  if (recorrencia === 'diaria') {
    let d = somarDiasLocal(pBase, intervalo);
    candidato = instanteDe({ ...d, minutoDoDia: minutoLocal }, fuso);
    // A trava da virada: nunca devolver instante <= o que acabou de sair.
    let voltas = 0;
    while (candidato.getTime() <= base.getTime() && voltas < 8) {
      d = somarDiasLocal(d, intervalo);
      candidato = instanteDe({ ...d, minutoDoDia: minutoLocal }, fuso);
      voltas += 1;
    }
  } else if (recorrencia === 'semanal') {
    const dias = normalizarDiasSemana(cfg.diasSemana);
    // Sem dia escolhido, o dia da semana da PRIMEIRA ocorrência é o padrão — em vez de recusar e
    // deixar a agenda muda, que é o pior desfecho para quem só quis «toda semana».
    const alvos = dias.length ? dias : [pInicio.diaSemana];
    const domingoAncora = domingoDaSemana(pInicio);
    // Anda dia a dia; o teto cobre «a cada 52 semanas» com folga e impede laço infinito.
    let d = pBase;
    for (let i = 0; i < 7 * intervalo * 2 + 14; i += 1) {
      d = somarDiasLocal(d, 1);
      if (!alvos.includes(d.diaSemana)) continue;
      // «a cada N semanas» conta a partir da SEMANA da primeira ocorrência, não da última — assim
      // um disparo atrasado não desloca a grade inteira para sempre.
      const semanas = semanasEntre(domingoAncora, domingoDaSemana(d));
      if (semanas < 0 || semanas % intervalo !== 0) continue;
      const tentativa = instanteDe({ ...d, minutoDoDia: minutoLocal }, fuso);
      if (tentativa.getTime() > base.getTime()) { candidato = tentativa; break; }
    }
  } else if (recorrencia === 'mensal') {
    const diaAncora = pInicio.dia;
    let n = intervalo;
    for (let i = 0; i < 12; i += 1) {
      const d = somarMesesLocal(pBase, n, diaAncora);
      const tentativa = instanteDe({ ...d, minutoDoDia: minutoLocal }, fuso);
      if (tentativa.getTime() > base.getTime()) { candidato = tentativa; break; }
      n += intervalo;
    }
  }

  if (!candidato) return null;
  if (cfg.ateEm) {
    const fim = cfg.ateEm instanceof Date ? cfg.ateEm : new Date(cfg.ateEm);
    if (!Number.isNaN(fim.getTime()) && candidato.getTime() > fim.getTime()) return null;
  }
  return candidato;
}

/**
 * O instante CANÔNICO da primeira ocorrência: o mesmo dia local, no minuto exato, com segundos
 * zerados.
 *
 * ⚠️ Existe porque o operador digita «02/09/2026 08:00» e o navegador manda um ISO com segundos e
 * milissegundos do momento do clique. Sem canonizar, `proximaEm` carregaria `08:00:37.412` para
 * sempre — e a chave de idempotência, que é derivada do instante, mudaria de agendamento para
 * agendamento sem que ninguém entendesse por quê.
 */
export function canonizarInicio(inicioEm, fuso = FUSO_PADRAO) {
  const d = inicioEm instanceof Date ? inicioEm : new Date(inicioEm);
  if (Number.isNaN(d.getTime())) throw new Error('inicioEm: data/hora inválida');
  const p = partesNoFuso(d, fuso);
  return { instante: instanteDe({ ano: p.ano, mes: p.mes, dia: p.dia, minutoDoDia: p.minutoDoDia }, fuso), minutoLocal: p.minutoDoDia };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ESCOPO — a mesma trava dos vizinhos
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** O `where` de LEITURA. `null` = este usuário não enxerga nada (falha fechada). */
export function filtroDeEmpresa(user, tenantIdDaTela = null) {
  const esc = escopoDe(user);
  if (esc.global) return tenantIdDaTela ? { tenantId: String(tenantIdDaTela) } : {};
  if (!esc.tenantId) return null;
  return { tenantId: esc.tenantId }; // trava dura: o que a tela mandou é ignorado
}

/** A empresa em que a ESCRITA acontece. Para quem não é super, é sempre a dele. */
export function empresaParaEscrita(user, tenantIdDoCorpo = null) {
  const esc = escopoDe(user);
  if (esc.global) {
    if (!tenantIdDoCorpo) throw new Error('Informe "tenantId": o super usuário administra várias empresas.');
    return String(tenantIdDoCorpo);
  }
  if (!esc.tenantId) {
    const e = new Error('A sua conta não está ligada a nenhuma empresa do Ragnabot.');
    e.status = 403;
    throw e;
  }
  return esc.tenantId;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DA ENTRADA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Telefone/identificador do contato. No WhatsApp o que casa é DÍGITO — «(98) 9 8335-1000» e
 *  «5598983351000» são a mesma pessoa, e guardar as duas formas faria o mesmo contato receber duas
 *  vezes apesar do índice único. Outros canais (e-mail, widget) não são numéricos: aí o valor é
 *  mantido como veio, só aparado. */
export function normalizarContatoChave(valor, canal = 'whatsapp') {
  const cru = String(valor ?? '').trim();
  if (!cru) throw new Error('destino: informe o telefone ou identificador do contato');
  const soDigitos = cru.replace(/\D+/gu, '');
  const numerico = ['whatsapp', 'telegram', 'sms'].includes(String(canal || '').toLowerCase());
  if (numerico) {
    if (soDigitos.length < 8) throw new Error(`destino "${cru}": número curto demais para ser um telefone`);
    return soDigitos;
  }
  return cru.slice(0, 200);
}

/**
 * Valida e normaliza o corpo de um agendamento. Devolve o objeto pronto para gravar.
 *
 * ⚠️ `cwInboxId` É OBRIGATÓRIO — é a exigência nº 6 («nada sai sem canal») começando no cadastro.
 * Aceitar agendamento sem conexão criaria a linha, ela venceria, e o trabalhador teria de descobrir
 * na hora do disparo que nunca houve por onde sair. Recusar no cadastro é dizer ao operador na hora
 * em que ele ainda pode corrigir.
 */
export function validarAgendamento(corpo = {}, { parcial = false } = {}) {
  const d = {};
  const exigir = (campo, valor, msg) => {
    if (valor === undefined || valor === null || valor === '') {
      if (parcial) return false;
      throw new Error(msg);
    }
    return true;
  };

  if (exigir('titulo', corpo.titulo, 'titulo: dê um nome ao agendamento (é como você vai achá-lo na lista)')) {
    d.titulo = String(corpo.titulo).trim().slice(0, LIMITES.titulo);
    if (!d.titulo) throw new Error('titulo: não pode ser só espaços');
  }
  if (corpo.descricao !== undefined) d.descricao = corpo.descricao ? String(corpo.descricao).slice(0, 1000) : null;

  if (exigir('mensagem', corpo.mensagem, 'mensagem: escreva o que será enviado')) {
    d.mensagem = String(corpo.mensagem);
    if (!d.mensagem.trim()) throw new Error('mensagem: não pode ser só espaços');
    if (d.mensagem.length > LIMITES.mensagem) throw new Error(`mensagem: acima de ${LIMITES.mensagem} caracteres`);
  }

  if (exigir('cwAccountId', corpo.cwAccountId, 'cwAccountId: informe a conta da plataforma')) {
    d.cwAccountId = Number(corpo.cwAccountId);
    if (!Number.isInteger(d.cwAccountId)) throw new Error('cwAccountId: precisa ser um número inteiro');
  }
  if (exigir('cwInboxId', corpo.cwInboxId, 'cwInboxId: escolha a conexão por onde a mensagem sai — sem canal ela não sairia')) {
    d.cwInboxId = Number(corpo.cwInboxId);
    if (!Number.isInteger(d.cwInboxId)) throw new Error('cwInboxId: precisa ser um número inteiro');
  }
  if (corpo.caixaNome !== undefined) d.caixaNome = corpo.caixaNome ? String(corpo.caixaNome).slice(0, 160) : null;
  if (corpo.canal !== undefined) d.canal = corpo.canal ? String(corpo.canal).toLowerCase().slice(0, 40) : null;
  if (corpo.cwTeamId !== undefined) d.cwTeamId = corpo.cwTeamId == null || corpo.cwTeamId === '' ? null : Number(corpo.cwTeamId);
  if (corpo.setorNome !== undefined) d.setorNome = corpo.setorNome ? String(corpo.setorNome).slice(0, 160) : null;

  // Anexo (F4.5). URL http(s) apenas: `file://` e caminho local transformariam o agendamento em
  // leitura do disco do pod, que é a mesma armadilha que fez o nó `http` do motor ficar recusado.
  if (corpo.anexoUrl !== undefined) {
    const u = corpo.anexoUrl ? String(corpo.anexoUrl).trim() : null;
    if (u && !/^https?:\/\//iu.test(u)) throw new Error('anexoUrl: use um endereço http(s) — só isso é buscável de fora');
    d.anexoUrl = u || null;
  }
  if (corpo.anexoNome !== undefined) d.anexoNome = corpo.anexoNome ? String(corpo.anexoNome).slice(0, 200) : null;
  if (corpo.anexoTipo !== undefined) d.anexoTipo = corpo.anexoTipo ? String(corpo.anexoTipo).slice(0, 40) : null;

  // Modelo aprovado (a saída legítima de fora da janela de 24 h).
  if (corpo.usarTemplate !== undefined) d.usarTemplate = corpo.usarTemplate === true || corpo.usarTemplate === 'true';
  if (corpo.templateNome !== undefined) d.templateNome = corpo.templateNome ? String(corpo.templateNome).slice(0, 200) : null;
  if (corpo.templateIdioma !== undefined) d.templateIdioma = corpo.templateIdioma ? String(corpo.templateIdioma).slice(0, 20) : 'pt_BR';
  if (corpo.templateParametros !== undefined) {
    d.templateParametros = Array.isArray(corpo.templateParametros)
      ? corpo.templateParametros.map((v) => String(v)).slice(0, 20)
      : null;
  }
  if (d.usarTemplate === true && !parcial && !d.templateNome) {
    throw new Error('templateNome: para enviar fora da janela de 24 h é preciso o nome do modelo aprovado pela Meta');
  }

  if (corpo.abrirTicket !== undefined) d.abrirTicket = corpo.abrirTicket !== false && corpo.abrirTicket !== 'false';

  // ── Tempo e recorrência ─────────────────────────────────────────────────────────────────────
  const fuso = corpo.fuso ? String(corpo.fuso) : (parcial ? undefined : FUSO_PADRAO);
  if (fuso !== undefined) {
    try { partesNoFuso(new Date(), fuso); } catch { throw new Error(`fuso: "${fuso}" não é um fuso conhecido`); }
    d.fuso = fuso;
  }

  if (corpo.recorrencia !== undefined) {
    const r = String(corpo.recorrencia);
    if (!RECORRENCIAS.includes(r)) throw new Error(`recorrencia: use ${RECORRENCIAS.join(' | ')}`);
    d.recorrencia = r;
  }
  if (corpo.intervalo !== undefined) {
    const n = Number(corpo.intervalo);
    if (!Number.isInteger(n) || n < 1 || n > LIMITES.intervalo) {
      throw new Error(`intervalo: um inteiro entre 1 e ${LIMITES.intervalo}`);
    }
    d.intervalo = n;
  }
  if (corpo.diasSemana !== undefined) {
    const dias = normalizarDiasSemana(corpo.diasSemana);
    d.diasSemana = dias.length ? dias.join(',') : null;
  }
  if ((d.recorrencia || corpo.recorrencia) === 'semanal' && !parcial && !d.diasSemana) {
    throw new Error('diasSemana: escolha ao menos um dia da semana');
  }

  if (exigir('inicioEm', corpo.inicioEm, 'inicioEm: informe a data e a hora do primeiro envio')) {
    const { instante, minutoLocal } = canonizarInicio(corpo.inicioEm, d.fuso || FUSO_PADRAO);
    d.inicioEm = instante;
    d.minutoLocal = minutoLocal;
    d.proximaEm = instante;
  }
  if (corpo.ateEm !== undefined) {
    if (!corpo.ateEm) d.ateEm = null;
    else {
      const f = new Date(corpo.ateEm);
      if (Number.isNaN(f.getTime())) throw new Error('ateEm: data/hora inválida');
      if (d.inicioEm && f.getTime() < d.inicioEm.getTime()) throw new Error('ateEm: o fim não pode ser antes do começo');
      d.ateEm = f;
    }
  }
  if (corpo.maxOcorrencias !== undefined) {
    if (corpo.maxOcorrencias == null || corpo.maxOcorrencias === '') d.maxOcorrencias = null;
    else {
      const n = Number(corpo.maxOcorrencias);
      if (!Number.isInteger(n) || n < 1) throw new Error('maxOcorrencias: um inteiro maior que zero, ou vazio');
      d.maxOcorrencias = n;
    }
  }

  return d;
}

/** Valida a lista de destinatários (F4.3). Recusa a lista VAZIA: agendamento sem destinatário é
 *  uma agenda que dispara para ninguém e diz que deu certo. */
export function validarDestinos(lista, canal = 'whatsapp') {
  const cru = Array.isArray(lista) ? lista : [];
  if (!cru.length) throw new Error('destinos: escolha ao menos um contato');
  if (cru.length > LIMITES.destinos) {
    throw new Error(`destinos: no máximo ${LIMITES.destinos} por agendamento (acima disso é campanha, que tem outro desenho)`);
  }
  const vistos = new Set();
  const saida = [];
  for (const d of cru) {
    const chave = normalizarContatoChave(typeof d === 'string' ? d : d?.contatoChave ?? d?.telefone, canal);
    // Repetido no MESMO pedido é silenciosamente unificado — o índice único do banco faria o mesmo,
    // mas com uma exceção feia no meio da gravação em vez de um cadastro limpo.
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({
      contatoChave: chave,
      contatoNome: typeof d === 'object' && d?.contatoNome ? String(d.contatoNome).slice(0, 200) : null,
      cwContactId: typeof d === 'object' && d?.cwContactId != null ? Number(d.cwContactId) : null,
      cwConversationId: typeof d === 'object' && d?.cwConversationId != null ? Number(d.cwConversationId) : null,
    });
  }
  return saida;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lista com os filtros da tela (F4.6): período, status e recorrência.
 *
 * A ordem é por `proximaEm` crescente com os SEM próxima ocorrência no fim: quem vai disparar
 * primeiro aparece primeiro, que é a pergunta que o operador faz ao abrir a tela.
 */
export async function listar(user, { tenantId, de, ate, status, recorrencia, cwInboxId, busca, pagina = 1, porPagina = 50 } = {}) {
  const filtro = filtroDeEmpresa(user, tenantId);
  if (!filtro) return { itens: [], total: 0, pagina: 1, porPagina };

  const where = { ...filtro };
  if (status) where.status = Array.isArray(status) ? { in: status } : String(status);
  if (recorrencia) where.recorrencia = Array.isArray(recorrencia) ? { in: recorrencia } : String(recorrencia);
  if (cwInboxId != null && cwInboxId !== '') where.cwInboxId = Number(cwInboxId);
  if (de || ate) {
    // O PERÍODO da tela filtra pela PRÓXIMA ocorrência — «o que sai nesta semana». Filtrar por
    // `criadoEm` responderia outra pergunta (quando foi cadastrado), que não é a que o operador faz.
    where.proximaEm = {};
    if (de) where.proximaEm.gte = new Date(de);
    if (ate) where.proximaEm.lte = new Date(ate);
  }
  if (busca) {
    const q = String(busca).trim().slice(0, 120);
    if (q) where.OR = [{ titulo: { contains: q, mode: 'insensitive' } }, { descricao: { contains: q, mode: 'insensitive' } }];
  }

  const salto = Math.max(0, (Number(pagina) - 1) * Number(porPagina));
  const [itens, total] = await Promise.all([
    db().ragnabotAgendamento.findMany({
      where,
      orderBy: [{ proximaEm: 'asc' }, { criadoEm: 'desc' }],
      skip: salto,
      take: Math.min(200, Number(porPagina) || 50),
    }),
    db().ragnabotAgendamento.count({ where }),
  ]);

  // Contagem de destinos e o resumo do último disparo, para a lista não mentir por omissão: um
  // agendamento com 40 contatos e 3 falhas tem de mostrar isso SEM abrir.
  const ids = itens.map((i) => i.id);
  const [destinos, envios] = ids.length ? await Promise.all([
    db().ragnabotAgendamentoDestino.groupBy({ by: ['agendamentoId'], where: { agendamentoId: { in: ids }, ativo: true }, _count: { _all: true } }),
    db().ragnabotAgendamentoEnvio.groupBy({ by: ['agendamentoId', 'status'], where: { agendamentoId: { in: ids } }, _count: { _all: true } }),
  ]) : [[], []];

  const porAgendamento = new Map();
  for (const d of destinos) porAgendamento.set(d.agendamentoId, { destinos: d._count._all, envios: {} });
  for (const e of envios) {
    const linha = porAgendamento.get(e.agendamentoId) || { destinos: 0, envios: {} };
    linha.envios[e.status] = (linha.envios[e.status] || 0) + e._count._all;
    porAgendamento.set(e.agendamentoId, linha);
  }

  return {
    itens: itens.map((i) => ({ ...i, resumo: porAgendamento.get(i.id) || { destinos: 0, envios: {} } })),
    total,
    pagina: Number(pagina) || 1,
    porPagina: Number(porPagina) || 50,
  };
}

/** Um agendamento com destinos. `null` fora do escopo — a rota traduz em 404, nunca 403. */
export async function obter(user, id, { tenantId } = {}) {
  const filtro = filtroDeEmpresa(user, tenantId);
  if (!filtro) return null;
  const linha = await db().ragnabotAgendamento.findFirst({ where: { id: String(id), ...filtro } });
  if (!linha) return null;
  const destinos = await db().ragnabotAgendamentoDestino.findMany({
    where: { agendamentoId: linha.id },
    orderBy: { criadoEm: 'asc' },
  });
  return { ...linha, destinos };
}

/** O histórico de UM agendamento — o «status por item» da F4.6. */
export async function historico(user, id, { tenantId, limite = 200, status } = {}) {
  const alvo = await obter(user, id, { tenantId });
  if (!alvo) return null;
  const where = { agendamentoId: alvo.id };
  if (status) where.status = Array.isArray(status) ? { in: status } : String(status);
  const envios = await db().ragnabotAgendamentoEnvio.findMany({
    where,
    orderBy: [{ ocorrenciaEm: 'desc' }, { reservadoEm: 'desc' }],
    take: Math.min(1000, Number(limite) || 200),
  });
  const porId = new Map(alvo.destinos.map((d) => [d.id, d]));
  return envios.map((e) => ({
    ...e,
    contatoChave: porId.get(e.destinoId)?.contatoChave ?? null,
    contatoNome: porId.get(e.destinoId)?.contatoNome ?? null,
  }));
}

/** Cria o agendamento e os destinatários, numa transação — meia criação seria uma agenda que
 *  dispara para ninguém, ou destinos órfãos que nenhuma tela mostra. */
export async function criar(user, corpo = {}) {
  const tenantId = empresaParaEscrita(user, corpo.tenantId);
  const dados = validarAgendamento(corpo);
  const destinos = validarDestinos(corpo.destinos, dados.canal || 'whatsapp');

  return db().$transaction(async (tx) => {
    const ag = await tx.ragnabotAgendamento.create({
      data: {
        ...dados,
        tenantId,
        status: STATUS.PENDENTE,
        criadoPorUserId: user?.id ? String(user.id) : null,
        criadoPorNome: user?.name || user?.username || null,
      },
    });
    await tx.ragnabotAgendamentoDestino.createMany({
      data: destinos.map((d) => ({ ...d, agendamentoId: ag.id, tenantId })),
    });
    const lista = await tx.ragnabotAgendamentoDestino.findMany({ where: { agendamentoId: ag.id } });
    return { ...ag, destinos: lista };
  });
}

/**
 * Edita. Só o que está `pendente` ou `pausado` aceita edição de conteúdo — mexer no texto de um
 * agendamento CONCLUÍDO reescreveria a história do que já saiu.
 */
export async function editar(user, id, corpo = {}) {
  const atual = await obter(user, id, { tenantId: corpo.tenantId });
  if (!atual) return null;
  if (atual.status === STATUS.CANCELADO || atual.status === STATUS.CONCLUIDO) {
    const e = new Error(`Este agendamento está ${atual.status}: o que já aconteceu não se edita. Duplique-o em vez disso.`);
    e.status = 409;
    throw e;
  }

  const dados = validarAgendamento({ fuso: atual.fuso, recorrencia: atual.recorrencia, ...corpo }, { parcial: true });
  // Só recalcula a próxima ocorrência quando o operador de fato mexeu no tempo. Recalcular sempre
  // faria uma correção de vírgula no texto reagendar o disparo — e a agenda mudaria de hora sozinha.
  const mexeuNoTempo = corpo.inicioEm !== undefined || corpo.fuso !== undefined
    || corpo.recorrencia !== undefined || corpo.intervalo !== undefined || corpo.diasSemana !== undefined;
  if (!mexeuNoTempo) { delete dados.proximaEm; delete dados.inicioEm; delete dados.minutoLocal; }

  return db().$transaction(async (tx) => {
    const ag = await tx.ragnabotAgendamento.update({ where: { id: atual.id }, data: dados });
    if (corpo.destinos !== undefined) {
      const novos = validarDestinos(corpo.destinos, dados.canal ?? atual.canal ?? 'whatsapp');
      const chaves = new Set(novos.map((d) => d.contatoChave));
      // Quem SAIU vira inativo, não some: os envios já feitos apontam para ele, e um histórico que
      // perde o destinatário vira histórico ilegível — a mesma regra de `RagnabotSetor.ativo`.
      await tx.ragnabotAgendamentoDestino.updateMany({
        where: { agendamentoId: atual.id, contatoChave: { notIn: [...chaves] } },
        data: { ativo: false },
      });
      for (const d of novos) {
        await tx.ragnabotAgendamentoDestino.upsert({
          where: { agendamentoId_contatoChave: { agendamentoId: atual.id, contatoChave: d.contatoChave } },
          create: { ...d, agendamentoId: atual.id, tenantId: atual.tenantId },
          update: { ativo: true, contatoNome: d.contatoNome, cwContactId: d.cwContactId },
        });
      }
    }
    const lista = await tx.ragnabotAgendamentoDestino.findMany({ where: { agendamentoId: atual.id } });
    return { ...ag, destinos: lista };
  });
}

/**
 * PAUSAR — congela sem perder. Volta com `retomar()`.
 *
 * ⚠️ O trabalhador só olha `status='pendente'`, então pausar é suficiente para não disparar. O que
 * ele NÃO faz é mexer no que já está a caminho: um envio `reservado` deste instante segue seu
 * desfecho, porque interrompê-lo no meio é como se cria a dúvida que este módulo evita.
 */
export async function pausar(user, id, { tenantId } = {}) {
  const atual = await obter(user, id, { tenantId });
  if (!atual) return null;
  if (atual.status !== STATUS.PENDENTE) {
    const e = new Error(`Só um agendamento pendente pode ser pausado (este está ${atual.status}).`);
    e.status = 409;
    throw e;
  }
  return db().ragnabotAgendamento.update({
    where: { id: atual.id },
    data: { status: STATUS.PAUSADO, donoWorker: null, travadoEm: null },
  });
}

/**
 * RETOMAR — volta a valer. Se a próxima ocorrência já passou enquanto estava pausado, ela é
 * empurrada para a PRÓXIMA da grade em vez de disparar retroativamente.
 *
 * ⚠️ Disparar o atrasado seria mandar «bom dia» às 4 da tarde, e num agendamento pausado por uma
 * semana seriam sete «bom dia» de uma vez. Um agendamento é um compromisso com um HORÁRIO; horário
 * perdido é perdido, e o registro disso fica na diferença entre `ocorrenciasFeitas` e a grade.
 */
export async function retomar(user, id, { tenantId, agora = new Date() } = {}) {
  const atual = await obter(user, id, { tenantId });
  if (!atual) return null;
  if (atual.status !== STATUS.PAUSADO) {
    const e = new Error(`Só um agendamento pausado pode ser retomado (este está ${atual.status}).`);
    e.status = 409;
    throw e;
  }

  let proxima = atual.proximaEm;
  if (proxima && proxima.getTime() <= agora.getTime()) {
    if (atual.recorrencia === 'unica') proxima = null;
    else {
      let candidata = proxima;
      let voltas = 0;
      while (candidata && candidata.getTime() <= agora.getTime() && voltas < 400) {
        candidata = proximaOcorrencia(atual, candidata);
        voltas += 1;
      }
      proxima = candidata;
    }
  }

  return db().ragnabotAgendamento.update({
    where: { id: atual.id },
    data: proxima
      ? { status: STATUS.PENDENTE, proximaEm: proxima }
      : { status: STATUS.CONCLUIDO, proximaEm: null },
  });
}

/**
 * CANCELAR — o desfecho definitivo. NÃO apaga: o que já disparou fica no histórico (exigência nº 5).
 *
 * Os envios que ainda estavam `reservado`/`adiado` viram `cancelado` com motivo escrito — assim a
 * tela mostra «não saiu porque o agendamento foi cancelado» em vez de deixar linhas presas no
 * meio, que é como um sistema acumula estado que ninguém sabe explicar.
 */
export async function cancelar(user, id, { tenantId } = {}) {
  const atual = await obter(user, id, { tenantId });
  if (!atual) return null;
  if (atual.status === STATUS.CANCELADO) return atual;

  return db().$transaction(async (tx) => {
    const ag = await tx.ragnabotAgendamento.update({
      where: { id: atual.id },
      data: { status: STATUS.CANCELADO, proximaEm: null, donoWorker: null, travadoEm: null },
    });
    await tx.ragnabotAgendamentoEnvio.updateMany({
      where: { agendamentoId: atual.id, status: { in: [STATUS_ENVIO.RESERVADO, STATUS_ENVIO.ADIADO] } },
      data: {
        status: STATUS_ENVIO.CANCELADO,
        motivo: MOTIVOS.AGENDAMENTO_CANCELADO,
        concluidoEm: new Date(),
        proximaTentativaEm: null,
      },
    });
    return ag;
  });
}

export default {
  RECORRENCIAS, STATUS, STATUS_ENVIO, MOTIVOS, ENVIO_TERMINAL, LIMITES, MAX_TENTATIVAS,
  configurarAgendamento, portasDoAgendamento, modeloPronto,
  chaveDeEnvio, proximaOcorrencia, canonizarInicio, normalizarDiasSemana, normalizarContatoChave,
  filtroDeEmpresa, empresaParaEscrita, validarAgendamento, validarDestinos,
  listar, obter, historico, criar, editar, pausar, retomar, cancelar,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ, de propósito
//
// • NÃO dispara nada e NÃO tem laço. Quem tem é `ragnabot-agendamento-worker.service.js`.
// • NÃO fala com a plataforma. `criar()` não confere se a caixa existe lá fora — quem confere é o
//   trabalhador, no instante do disparo, porque uma caixa pode ser desligada DEPOIS do cadastro e
//   validar só na criação daria uma falsa sensação de garantia.
// • NÃO apaga agendamento. Só cancela. Apagar levaria junto a resposta a «esta mensagem saiu?».
// • NÃO decide fuso pelo processo: o fuso é do AGENDAMENTO. O pod roda em UTC.
// ════════════════════════════════════════════════════════════════════════════════════════════════
