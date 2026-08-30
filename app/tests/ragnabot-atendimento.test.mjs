#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AUTOMAÇÕES DO ATENDIMENTO — PROVA EXECUTÁVEL DA ESPECIFICAÇÃO 29
//
// POR QUE ESTE ARQUIVO EXISTE
// O dono reclamou, em 28/08/2026, de coisas que "faltam": transferir chamado, o atendimento voltar
// para a fila quando ninguém fala, escolher se o silêncio que conta é o do ATENDENTE ou o do
// CONTATO, o fluxo do primeiro "oi", o horário de fora de expediente e o horário de INTERVALO.
// A especificação `/ia/.claude/modulo-atendimento/29-AUTOMACOES-DO-ATENDIMENTO.md` respondeu cada
// um deles com medição. Este arquivo transforma essas respostas em afirmações que o computador
// verifica — porque especificação que ninguém executa envelhece em silêncio.
//
// O QUE ESTE ARQUIVO PROVA, EM DUAS CAMADAS
//   Camada 1 — MODELO (roda hoje, contra PostgreSQL de verdade)
//       As tabelas do §4 são criadas num esquema temporário e exercitadas com SQL real. É aqui que
//       se prova o que o Chatwoot 4.17.1 NÃO consegue: duas janelas no mesmo dia da semana (o
//       almoço), feriado sem duplicata, um único relógio por conversa e o alcance de uma empresa
//       parando na fronteira da outra. Postgres é o juiz — não um dublê em memória.
//   Camada 2 — SERVIÇO (roda quando a implementação existir)
//       As MESMAS tabelas de casos são passadas para o serviço real. Enquanto ele não existe, cada
//       verificação se declara NÃO EXECUTOU e o arquivo sai com código 2. Nunca com 0.
//       ⚠️ Silêncio verde sobre implementação ausente seria o pior resultado possível: daria a
//       sensação de cobertura sem a cobertura.
//
// A REGRA QUE GOVERNA AS DUAS CAMADAS: a tabela de casos (§ CASOS) é a especificação escrita em
// JavaScript. O oráculo de referência e o serviço real respondem à MESMA tabela. Se os dois
// discordarem, é o serviço que está errado — a tabela veio do documento.
//
// COMO RODAR
//     node tests/ragnabot-atendimento.test.mjs               (~1,5 s)
//     VERBOSE=1 node tests/ragnabot-atendimento.test.mjs      (mostra a pilha do erro)
//
// LIMPEZA — o que este teste cria, ele apaga
//   Tudo vive num esquema `rgn_atend_teste_<pid>_<aleatório>`, derrubado com DROP SCHEMA CASCADE no
//   `finally`, aconteça o que acontecer. Nenhuma linha é escrita em `public`, e a última
//   verificação PROVA isso conferindo que não sobrou rastro nem no esquema temporário nem na fila
//   de produção. Um teste que suja o banco de produção é um defeito, não um teste.
//
// AUTO-CORREÇÃO PARA A REALIDADE
//   Quando a migração do §4 chegar ao `public`, este arquivo passa a espelhar a estrutura REAL
//   (`CREATE TABLE … LIKE public."X" INCLUDING ALL`) em vez do modelo do documento — sem ninguém
//   editar nada. A partir daí ele deixa de validar o desenho e passa a validar o que foi
//   construído: se o índice único de `escopoChave` não tiver sido criado, a verificação 8 reprova.
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO — o corredor varre `tests/**/*.test.js` e este é um
// script com `process.exit`, no mesmo padrão de `ragnabot-fluxo-motor.test.mjs`,
// `ragnabot-fluxo-teste-nao-grava.test.mjs` e `ragnabot-isolamento.test.mjs`.
//
// O QUE ESTE ARQUIVO JÁ ENCONTROU (para o próximo leitor saber que ele não é decorativo)
//   • 29/08, 4ª execução — `processarTrabalhoDoRelogio()` NÃO era idempotente: o mesmo trabalho
//     entregue duas vezes pela fila (retentativa, ceifador) reaplicava a ação e reenviava a
//     mensagem ao cliente. O carimbo de frescor não pegava, porque nenhum dos quatro campos que
//     ele compara muda quando o próprio despacho age. Corrigido no serviço com uma cerca atômica.
//   • O teste também reprovou por culpa PRÓPRIA três vezes, e cada uma virou comentário no ponto
//     exato: o `@updatedAt` que o Prisma preenche e o SQL cru não; o erro de unicidade que o Prisma
//     não chama de "unique"; e o dublê que devolvia falso calado para operador desconhecido.
//     Fica registrado porque instrumento que erra calado manda caçar defeito que não existe.
//
// CÓDIGOS DE SAÍDA — o silêncio aqui seria pior que a falha
//   0 = tudo o que podia ser provado foi provado
//   1 = alguma verificação REPROVOU
//   2 = alguma verificação NÃO PÔDE EXECUTAR (banco fora, ou serviço ainda não construído)
//   3 = erro inesperado
//
// NOC — 29/08/2026.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';
import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § CONTRATO — como o serviço real é encontrado
//
// Este teste foi escrito ao mesmo tempo que a implementação, por autores diferentes. O nome exato
// do módulo e das funções não pôde ser medido — foi DEDUZIDO do documento 29 e da convenção do
// repositório. Por isso a busca é por lista de candidatos, e não por um caminho cravado: um nome
// diferente custa UMA LINHA aqui, não a reescrita do arquivo.
//
// ⚠️ Se a implementação existir com outro nome e não estiver nesta lista, o teste diz
// "não encontrei" — jamais "passou". Ausência de prova nunca vira prova de ausência de defeito.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const MODULOS_CANDIDATOS = [
  '../src/services/ragnabot-atendimento.service.js',
  '../src/services/ragnabot-atend.service.js',
  '../src/services/ragnabot-automacoes.service.js',
  '../src/services/ragnabot-atendimento-relogio.service.js',
  '../src/services/ragnabot-expediente.service.js',
];

// Nome do documento → nomes que a implementação pode ter usado.
const APELIDOS = {
  // §5.5: o resolvedor injeta {{expediente.aberto}} / {{expediente.motivo}} / {{expediente.proximaAbertura}}
  avaliarExpediente: ['avaliarExpediente', 'expedienteAgora', 'estadoExpediente', 'calcularExpediente', 'resolverExpediente'],
  // §4.5: de onde sai `venceEm` e `ultimaAtividadeLado`.
  // ⚠️ A ORDEM IMPORTA, e custou uma rodada vermelha (4ª execução, 29/08): o serviço real exporta
  // TAMBÉM uma `calcularVencimento({inicio, minutos, …})`, que é um degrau interno de outra forma.
  // Com o nome genérico à frente, o teste chamava a função errada e reprovava oito casos com
  // "minutos deve ser um número não negativo" — sintoma que parece defeito do produto e é do teste.
  // Nome específico SEMPRE antes do genérico.
  calcularRelogio: ['planejarRelogioDeInatividade', 'planejarRelogio', 'calcularRelogio', 'armarRelogio', 'avaliarInatividade'],
};

// O oráculo e o serviço nomeiam o motivo da recusa com palavras diferentes — e está certo que seja
// assim: o que este teste prende é a DECISÃO (armou ou não) e o PRAZO (quando vence), não o
// vocabulário interno da implementação. Mas "não armou" pelo motivo ERRADO é defeito, então a
// equivalência é declarada aqui, e só ela é aceita.
const MOTIVOS_EQUIVALENTES = {
  silencio_e_do_atendente: ['lado_nao_conta'],
  silencio_e_do_contato: ['lado_nao_conta'],
  fluxo_no_comando: ['fluxo_no_comando'],
  politica_desligada: ['desligada'],
};

/** Procura o módulo do serviço e mapeia os apelidos. Devolve null quando ele ainda não existe. */
async function carregarServico() {
  for (const caminho of MODULOS_CANDIDATOS) {
    let mod;
    try {
      mod = await import(caminho);
    } catch (e) {
      // ERR_MODULE_NOT_FOUND é o caso esperado enquanto a implementação não chegou. Qualquer outro
      // erro é defeito REAL do módulo (sintaxe, import quebrado) e precisa aparecer, não sumir.
      if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(caminho.split('/').pop())) continue;
      return { caminho, erro: e };
    }
    const funcoes = {};
    for (const [papel, nomes] of Object.entries(APELIDOS)) {
      const achado = nomes.find((n) => typeof mod[n] === 'function');
      if (achado) funcoes[papel] = { nome: achado, fn: mod[achado] };
    }
    return { caminho, mod, funcoes };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § ORÁCULO DE REFERÊNCIA
//
// Estas funções são a leitura literal do §4.2, §4.3 e §4.1 do documento 29. Elas NÃO são a
// implementação do produto — são a régua contra a qual as linhas gravadas no Postgres e o serviço
// real são medidos. Ficam aqui, dentro do teste, de propósito: uma régua que mora no mesmo arquivo
// que a afirmação não pode ser silenciosamente afrouxada por uma refatoração do serviço.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const DIAS_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Converte um instante absoluto para "que dia e que minuto é agora NO FUSO DA POLÍTICA".
 *
 * ⚠️ ARMADILHA QUE ISTO EVITA, e que foi MEDIDA no destino em 29/08: a caixa de entrada 1 do
 * Ragnabot está em UTC. Ler o horário do servidor em vez do fuso da política erra o expediente em
 * três horas, e o erro chega ao dono como "o robô respondeu fora de hora" — sintoma que ninguém
 * liga a fuso. É por isso que `RagnabotAtendPolitica.fuso` existe e não é opcional.
 */
// Cache dos formatadores. ⚠️ MEDIDO NA 5ª RODADA (29/08): sem ele o arquivo inteiro levava 66 s.
// Construir um `Intl.DateTimeFormat` é caro e as varreduras minuto a minuto abaixo chamam isto
// dezenas de milhares de vezes. O serviço real já carrega o mesmo cache com o mesmo aviso — e o
// teste tinha repetido exatamente o erro que o código que ele julga já havia documentado.
const formatadoresDoTeste = new Map();
function formatadorDoTeste(fuso) {
  let f = formatadoresDoTeste.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    formatadoresDoTeste.set(fuso, f);
  }
  return f;
}

function noFuso(instante, fuso) {
  const p = Object.fromEntries(formatadorDoTeste(fuso).formatToParts(instante).map((x) => [x.type, x.value]));
  const hora = p.hour === '24' ? 0 : Number(p.hour); // Intl devolve 24 para meia-noite em hour12:false
  return {
    diaSemana: DIAS_EN[p.weekday],
    minutos: hora * 60 + Number(p.minute),
    data: `${p.year}-${p.month}-${p.day}`,
    mesDia: `${p.month}-${p.day}`,
  };
}

/** Uma janela contém o minuto? Trata a janela que cruza a meia-noite (plantão), onde fecha <= abre. */
function dentroDaJanela(minutos, janela) {
  if (janela.fechaMin > janela.abreMin) return minutos >= janela.abreMin && minutos < janela.fechaMin;
  return minutos >= janela.abreMin || minutos < janela.fechaMin; // vira o dia
}

/** A exceção de data casa com este dia? Aceita data fixa "2026-12-25" e recorrente "*-12-25". */
function excecaoCasa(excecao, local) {
  if (excecao.chaveData === local.data) return true;
  return excecao.chaveData === `*-${local.mesDia}`;
}

/**
 * O §5.5 do documento 29 em forma executável.
 *
 * A ORDEM IMPORTA e é a do §5.2: feriado vence expediente, e expediente vence intervalo. Intervalo
 * é um estado PRÓPRIO — dizer "estamos fechados" ao meio-dia é mentira, e é a diferença entre
 * `msgIntervalo` e `msgForaExpediente` na política.
 *
 * @returns {{aberto:boolean, motivo:'aberto'|'fora_hora'|'intervalo'|'feriado', proximaAbertura:Date|null}}
 */
function avaliarExpedienteRef({ agora, fuso, janelas, excecoes = [] }) {
  const motivo = motivoDoExpediente({ agora, fuso, janelas, excecoes });
  if (motivo === 'aberto') return { aberto: true, motivo: 'aberto', proximaAbertura: null };
  return { aberto: false, motivo, proximaAbertura: proximaAberturaRef({ agora, fuso, janelas, excecoes }) };
}

/**
 * O veredito SEM a projeção da próxima abertura.
 *
 * ⚠️ POR QUE ESTÁ SEPARADO, e não é purismo: `somarMinutosUteis` percorre minuto a minuto e
 * perguntava "está aberto?" pela função completa — que, a cada minuto FECHADO, varria mais oito
 * dias para descobrir a próxima abertura que ninguém tinha pedido. O custo era quadrático e o
 * arquivo levava 66 s. Quem só quer saber se está aberto não paga pela projeção.
 */
function motivoDoExpediente({ agora, fuso, janelas, excecoes = [] }) {
  const local = noFuso(agora, fuso);

  const excecao = excecoes.find((e) => excecaoCasa(e, local));
  if (excecao && excecao.tipo === 'fechado') return 'feriado';

  // Janela especial (véspera, meio expediente) SUBSTITUI as janelas do dia — não soma com elas.
  const doDia = excecao && excecao.tipo === 'janela_especial'
    ? [{ abreMin: excecao.abreMin, fechaMin: excecao.fechaMin, ativo: true }]
    : janelas.filter((j) => j.ativo !== false && j.diaSemana === local.diaSemana);

  // Plantão iniciado ONTEM ainda está valendo agora? Sem esta linha, o turno da madrugada aparece
  // como "fora de hora" às 2h e a conversa da noite acorda devolvida para a fila.
  const deOntem = janelas.filter((j) => j.ativo !== false
    && j.diaSemana === (local.diaSemana + 6) % 7 && j.fechaMin <= j.abreMin);

  if (doDia.some((j) => dentroDaJanela(local.minutos, j))) return 'aberto';
  if (deOntem.some((j) => local.minutos < j.fechaMin)) return 'aberto';

  // INTERVALO = está entre o fim de uma janela do dia e o começo da próxima janela do MESMO dia.
  // É exatamente o buraco que o modelo do Chatwoot não sabe representar, porque lá só cabe uma
  // janela por dia — e é o pedido nº 5 do dono.
  const ordenadas = [...doDia].sort((a, b) => a.abreMin - b.abreMin);
  const jaFechou = ordenadas.filter((j) => local.minutos >= j.fechaMin && j.fechaMin > j.abreMin);
  const aindaAbre = ordenadas.filter((j) => local.minutos < j.abreMin);
  if (jaFechou.length && aindaAbre.length) return 'intervalo';
  return 'fora_hora';
}

/**
 * Próxima abertura, varrendo até 8 dias. É o que permite dizer "voltamos às 13h" em vez de
 * "estamos fechados" — a diferença entre um cliente que espera e um cliente que desiste.
 * Precisão de minuto: varre minuto a minuto só o necessário (no máximo 8 dias × 1440 = 11.520
 * avaliações baratas), em troca de não ter que fazer aritmética de fuso à mão, que é onde o
 * horário de verão de outros fusos morde.
 */
function proximaAberturaRef({ agora, fuso, janelas, excecoes = [] }) {
  const passo = 60 * 1000;
  let t = new Date(Math.ceil(agora.getTime() / passo) * passo + passo);
  const limite = agora.getTime() + 8 * 24 * 60 * 60 * 1000;
  while (t.getTime() <= limite) {
    const local = noFuso(t, fuso);
    const ex = excecoes.find((e) => excecaoCasa(e, local));
    if (!(ex && ex.tipo === 'fechado')) {
      const doDia = ex && ex.tipo === 'janela_especial'
        ? [{ abreMin: ex.abreMin, fechaMin: ex.fechaMin }]
        : janelas.filter((j) => j.ativo !== false && j.diaSemana === local.diaSemana);
      if (doDia.some((j) => dentroDaJanela(local.minutos, j))) return t;
    }
    t = new Date(t.getTime() + passo);
  }
  return null;
}

/**
 * Soma minutos ÚTEIS — só conta o tempo em que o expediente está aberto.
 *
 * ⚠️ ARMADILHA QUE ISTO EVITA, declarada no §4.1 do documento 29: se o relógio correr de
 * madrugada, TODA conversa da noite amanhece devolvida para a fila às 3h, e o cliente recebe
 * "ainda está aí?" às 3h. É por isso que `inatividadeContaForaExpediente` é FALSO por padrão.
 */
function somarMinutosUteis(base, minutos, ctx) {
  let t = new Date(base.getTime());
  let restam = minutos;
  const teto = base.getTime() + 30 * 24 * 60 * 60 * 1000; // 30 dias: fechado o mês inteiro é defeito de cadastro
  while (restam > 0 && t.getTime() <= teto) {
    const passo = new Date(t.getTime() + 60 * 1000);
    if (motivoDoExpediente({ ...ctx, agora: t }) === 'aberto') restam -= 1;
    t = passo;
  }
  return restam > 0 ? null : t;
}

/**
 * O relógio de inatividade do §4.1 — o pedido nº 2 e nº 3 do dono, o coração desta fase.
 *
 * A ESCOLHA QUE O DONO CITOU NOMINALMENTE é `inatividadeConta`:
 *   'contato'   → o CLIENTE sumiu. Só arma quando o atendente JÁ respondeu (waiting_since nulo).
 *                 Enquanto o cliente está esperando resposta, o silêncio é do atendente, não dele.
 *   'atendente' → o ATENDENTE sumiu. Só arma quando o cliente está esperando (waiting_since cheio).
 *   'qualquer'  → ninguém falou, de lado nenhum. Conta de last_activity_at.
 *
 * A REGRA DO §5.3, que evita duas mensagens no mesmo minuto: enquanto a execução do fluxo está
 * viva, o prazo é do nó `espera`. O relógio de atendimento só arma com a conversa em mão humana.
 * Sem isso o cliente recebe "não entendi, escolha uma opção" e "ainda está aí?" ao mesmo tempo, e
 * conclui que o robô está quebrado.
 */
function calcularRelogioRef({ politica, conversa, agora, expediente }) {
  if (!politica.inatividadeAtiva) return { arma: false, motivo: 'politica_desligada' };

  const ESTADOS_VIVOS = ['rodando', 'esperando', 'pausado_duvida'];
  if (ESTADOS_VIVOS.includes(conversa.execucaoEstado)) {
    return { arma: false, motivo: 'fluxo_no_comando' };
  }

  let base = null;
  let lado = null;
  if (politica.inatividadeConta === 'contato') {
    if (conversa.waitingSince) return { arma: false, motivo: 'silencio_e_do_atendente' };
    base = conversa.lastActivityAt; lado = 'atendente';
  } else if (politica.inatividadeConta === 'atendente') {
    if (!conversa.waitingSince) return { arma: false, motivo: 'silencio_e_do_contato' };
    base = conversa.waitingSince; lado = 'contato';
  } else {
    base = conversa.lastActivityAt; lado = conversa.waitingSince ? 'contato' : 'atendente';
  }

  const venceEm = politica.inatividadeContaForaExpediente
    ? new Date(base.getTime() + politica.inatividadeMinutos * 60 * 1000)
    : somarMinutosUteis(base, politica.inatividadeMinutos, expediente);

  if (!venceEm) return { arma: false, motivo: 'sem_expediente_no_horizonte' };
  return {
    arma: true,
    lado,                       // quem falou por último — vai para RagnabotAtendRelogio.ultimaAtividadeLado
    venceEm,
    vencido: venceEm <= agora,
    acao: politica.inatividadeAcao,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § CASOS — a especificação escrita como dados
//
// Cada linha aqui saiu de uma frase do documento 29. As duas camadas do teste respondem a esta
// mesma tabela. Acrescentar um comportamento ao produto é acrescentar uma linha aqui primeiro.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const FUSO = 'America/Fortaleza'; // UTC-3 o ano inteiro — sem horário de verão desde 2019

// Segunda a sexta, 08:00–12:00 e 13:00–18:00. Sábado só de manhã. É o expediente com ALMOÇO, que o
// Chatwoot 4.17.1 não consegue guardar: lá cabe uma linha por dia da semana, e só.
const JANELAS = [
  ...[1, 2, 3, 4, 5].flatMap((d) => [
    { diaSemana: d, abreMin: 8 * 60, fechaMin: 12 * 60, rotulo: 'manhã' },
    { diaSemana: d, abreMin: 13 * 60, fechaMin: 18 * 60, rotulo: 'tarde' },
  ]),
  { diaSemana: 6, abreMin: 8 * 60, fechaMin: 12 * 60, rotulo: 'sábado manhã' },
];

const EXCECOES = [
  { chaveData: '*-12-25', tipo: 'fechado', rotulo: 'Natal' },
  { chaveData: '2026-09-07', tipo: 'fechado', rotulo: 'Independência' },
  { chaveData: '2026-12-24', tipo: 'janela_especial', abreMin: 8 * 60, fechaMin: 12 * 60, rotulo: 'Véspera de Natal' },
];

// 01/09/2026 é uma TERÇA-FEIRA. Os instantes vêm em UTC de propósito: é assim que o servidor os vê,
// e a conversão para o fuso da política é justamente o que está sob julgamento.
const CASOS_EXPEDIENTE = [
  { nome: '07:00 de terça — antes de abrir', utc: '2026-09-01T10:00:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'lido em UTC daria 10:00 e pareceria ABERTO. É o erro de 3 h que o fuso da política evita' },
  { nome: '07:59 de terça — um minuto antes', utc: '2026-09-01T10:59:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'a virada tem que ser exata; um minuto antes ainda é fora' },
  { nome: '08:00 de terça — a virada', utc: '2026-09-01T11:00:00Z', motivo: 'aberto', aberto: true,
    porque: 'abre no minuto cheio, sem arredondar' },
  { nome: '11:59 de terça — fim da manhã', utc: '2026-09-01T14:59:00Z', motivo: 'aberto', aberto: true, porque: 'ainda dentro da janela da manhã' },
  { nome: '12:00 de terça — começa o ALMOÇO', utc: '2026-09-01T15:00:00Z', motivo: 'intervalo', aberto: false,
    porque: 'é INTERVALO, não "fora de expediente" — dizer "estamos fechados" ao meio-dia é mentira' },
  { nome: '12:30 de terça — meio do almoço', utc: '2026-09-01T15:30:00Z', motivo: 'intervalo', aberto: false, porque: 'idem' },
  { nome: '13:00 de terça — volta do almoço', utc: '2026-09-01T16:00:00Z', motivo: 'aberto', aberto: true, porque: 'a segunda janela do dia abre' },
  { nome: '17:59 de terça — último minuto', utc: '2026-09-01T20:59:00Z', motivo: 'aberto', aberto: true, porque: 'fecha às 18:00, não às 17:59' },
  { nome: '18:00 de terça — fecha', utc: '2026-09-01T21:00:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'depois da última janela do dia NÃO é intervalo — é fora de expediente' },
  { nome: '03:00 de quarta — a madrugada', utc: '2026-09-02T06:00:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'é neste instante que o relógio solto mandaria "ainda está aí?" para o cliente dormindo' },
  { nome: '10:00 de domingo', utc: '2026-09-06T13:00:00Z', motivo: 'fora_hora', aberto: false, porque: 'domingo não tem janela nenhuma' },
  { nome: '10:00 de sábado', utc: '2026-09-05T13:00:00Z', motivo: 'aberto', aberto: true, porque: 'sábado tem só a janela da manhã' },
  { nome: '15:00 de sábado', utc: '2026-09-05T18:00:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'sábado à tarde não é intervalo: não existe janela depois, então é fora de expediente' },
  { nome: '10:00 de 07/09/2026 — FERIADO', utc: '2026-09-07T13:00:00Z', motivo: 'feriado', aberto: false,
    porque: 'a data fixa vence o expediente da segunda-feira' },
  { nome: '10:00 de 25/12/2026 — Natal RECORRENTE', utc: '2026-12-25T13:00:00Z', motivo: 'feriado', aberto: false,
    porque: 'a chave "*-12-25" casa em qualquer ano — feriado sem ano não precisa ser recadastrado' },
  { nome: '10:00 de 24/12/2026 — véspera, meio expediente', utc: '2026-12-24T13:00:00Z', motivo: 'aberto', aberto: true,
    porque: 'janela especial SUBSTITUI as janelas do dia' },
  { nome: '15:00 de 24/12/2026 — véspera, depois do meio expediente', utc: '2026-12-24T18:00:00Z', motivo: 'fora_hora', aberto: false,
    porque: 'a janela especial fecha ao meio-dia e não há outra depois' },
];

// Conversa parada às 10:00 de terça (13:00Z). A pergunta é sempre a mesma: de QUEM é o silêncio?
const T10 = new Date('2026-09-01T13:00:00Z'); // 10:00 em Fortaleza
const CASOS_INATIVIDADE = [
  {
    nome: 'conta o CONTATO e o contato sumiu → arma',
    conta: 'contato',
    conversa: { waitingSince: null, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    arma: true, lado: 'atendente', venceUtc: '2026-09-01T13:30:00Z',
    porque: 'waiting_since nulo = o atendente já respondeu e o cliente é quem parou de falar',
  },
  {
    nome: 'conta o CONTATO mas quem está calado é o ATENDENTE → NÃO arma',
    conta: 'contato',
    conversa: { waitingSince: T10, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    arma: false, motivo: 'silencio_e_do_atendente',
    porque: 'devolver para a fila o cliente que está ESPERANDO resposta é punir a vítima do atraso',
  },
  {
    nome: 'conta o ATENDENTE e o atendente sumiu → arma',
    conta: 'atendente',
    conversa: { waitingSince: T10, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    arma: true, lado: 'contato', venceUtc: '2026-09-01T13:30:00Z',
    porque: 'waiting_since cheio = o cliente falou e ninguém respondeu. É o SLA de verdade',
  },
  {
    nome: 'conta o ATENDENTE mas quem está calado é o CONTATO → NÃO arma',
    conta: 'atendente',
    conversa: { waitingSince: null, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    arma: false, motivo: 'silencio_e_do_contato',
    porque: 'o atendente já fez a parte dele; cobrar dele o silêncio do cliente é ruído',
  },
  {
    nome: 'conta QUALQUER lado → arma sempre',
    conta: 'qualquer',
    conversa: { waitingSince: null, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    arma: true, lado: 'atendente', venceUtc: '2026-09-01T13:30:00Z',
    porque: 'é o único modo que o auto_resolve_after nativo sabe fazer, e nem configurável ele é',
  },
  {
    nome: 'fluxo ainda no comando → NÃO arma (regra do §5.3)',
    conta: 'qualquer',
    conversa: { waitingSince: null, lastActivityAt: T10, execucaoEstado: 'esperando' },
    arma: false, motivo: 'fluxo_no_comando',
    porque: 'dois donos do mesmo silêncio mandam duas mensagens no mesmo minuto e o cliente conclui que o robô quebrou',
  },
  {
    // A 2ª rodada deste teste reprovou aqui, e quem estava errado era ESTA LINHA, não o cálculo:
    // 17:50 + 30 min ÚTEIS = 10 min até fechar (17:50→18:00) + 20 min no dia seguinte = 08:20.
    // Fica registrado porque é o tipo de conta que se erra de cabeça e ninguém confere depois.
    nome: 'parada às 17:50 → NÃO vence às 18:20; o relógio CONGELA e vence às 08:20 do dia seguinte',
    conta: 'qualquer',
    conversa: {
      waitingSince: null,
      lastActivityAt: new Date('2026-09-01T20:50:00Z'), // 17:50 em Fortaleza
      execucaoEstado: 'pausado_humano',
    },
    arma: true, lado: 'atendente', venceUtc: '2026-09-02T11:20:00Z', // 08:20 de quarta em Fortaleza
    porque: 'sem congelar, toda conversa da noite amanhece devolvida para a fila às 3 h da manhã',
  },
  {
    nome: 'parada às 11:50 → o ALMOÇO não conta; vence às 13:20',
    conta: 'qualquer',
    conversa: {
      waitingSince: null,
      lastActivityAt: new Date('2026-09-01T14:50:00Z'), // 11:50 em Fortaleza
      execucaoEstado: 'pausado_humano',
    },
    arma: true, lado: 'atendente', venceUtc: '2026-09-01T16:20:00Z', // 13:20 em Fortaleza
    porque: 'os 10 min antes do almoço + 20 min depois da volta = os 30 min de tolerância',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § PLACAR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
let reprovadas = 0; let naoExecutadas = 0; let aprovadas = 0;
const linhas = [];

function titulo(t) { console.log(`\n${t}`); }
function ok(t, detalhe) { aprovadas += 1; console.log(`  ✅ ${t}${detalhe ? `\n       ${detalhe}` : ''}`); }
function reprovou(t, por) { reprovadas += 1; console.log(`  ❌ ${t}\n       ${por}`); }
function pulou(t, por) { naoExecutadas += 1; console.log(`  ⏭️  ${t}\n       ${por}`); }
function afirmar(cond, t, por, detalhe) { cond ? ok(t, detalhe) : reprovou(t, por); return !!cond; }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § BANCO TEMPORÁRIO — real, isolado e descartável
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// O NOME CARREGA A HORA DE NASCIMENTO, e não é enfeite: o Postgres não guarda quando um esquema
// foi criado, e sem a idade no nome não há como distinguir o lixo de uma execução morta de uma
// execução VIVA rodando em paralelo. Com o carimbo, a varredura de órfãos é segura.
const NASCIMENTO = Date.now();
const SUFIXO = `${NASCIMENTO}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const ESQUEMA = `rgn_atend_teste_${SUFIXO}`;
const PADRAO_ESQUEMA = /^rgn_atend_teste_(\d+)_\d+_[0-9a-f]{6}$/;
const IDADE_ORFAO_MS = 2 * 60 * 60 * 1000; // 2 h: folga generosa sobre a rodada, que leva ~1,5 s
const PREFIXO_TESTE = `teste-atend-${SUFIXO}`;   // todo tenantId criado começa com isto
const TENANT_A = `${PREFIXO_TESTE}-a`;
const TENANT_B = `${PREFIXO_TESTE}-b`;

/** DDL espelhada do §4 do documento 29 — usada só enquanto a migração real não existe. */
const DDL_ESPELHO = {
  RagnabotAtendPolitica: `
    id text PRIMARY KEY,
    "tenantId" text NOT NULL,
    "cwAccountId" integer NOT NULL,
    escopo text NOT NULL,
    "cwInboxId" integer,
    "cwTeamId" integer,
    "escopoChave" text NOT NULL,
    ativa boolean NOT NULL DEFAULT true,
    fuso text NOT NULL DEFAULT 'America/Fortaleza',
    "inatividadeAtiva" boolean NOT NULL DEFAULT false,
    "inatividadeMinutos" integer,
    "inatividadeConta" text,
    "inatividadeAcao" text,
    "inatividadeAvisoMinutos" integer,
    "inatividadeContaForaExpediente" boolean NOT NULL DEFAULT false,
    "msgIntervalo" text,
    "msgForaExpediente" text,
    "msgFeriado" text,
    rev integer NOT NULL DEFAULT 0,
    "criadoEm" timestamp(3) NOT NULL DEFAULT now(),
    -- @updatedAt do Prisma é preenchido pelo CLIENTE, não pelo banco: a coluna nasce NOT NULL e SEM
    -- default. Todo INSERT em SQL cru precisa passá-la, e foi assim que a primeira rodada deste
    -- teste reprovou com 23502 — o espelho tem que carregar a mesma exigência, senão o modo
    -- "espelho" passaria onde o modo "real" reprova.
    "atualizadoEm" timestamp(3) NOT NULL,
    CONSTRAINT pol_tenant_escopochave UNIQUE ("tenantId", "escopoChave")`,
  RagnabotAtendExpediente: `
    id text PRIMARY KEY,
    "tenantId" text NOT NULL,
    "politicaId" text NOT NULL,
    "diaSemana" integer NOT NULL,
    "abreMin" integer NOT NULL,
    "fechaMin" integer NOT NULL,
    rotulo text,
    ativo boolean NOT NULL DEFAULT true,
    "criadoEm" timestamp(3) NOT NULL DEFAULT now(),
    "atualizadoEm" timestamp(3) NOT NULL`,
  RagnabotAtendExcecaoData: `
    id text PRIMARY KEY,
    "tenantId" text NOT NULL,
    "politicaId" text NOT NULL,
    "chaveData" text NOT NULL,
    tipo text NOT NULL,
    "abreMin" integer,
    "fechaMin" integer,
    rotulo text NOT NULL,
    mensagem text,
    CONSTRAINT exc_politica_chavedata UNIQUE ("politicaId", "chaveData")`,
  RagnabotAtendRelogio: `
    id text PRIMARY KEY,
    "tenantId" text NOT NULL,
    "cwAccountId" integer NOT NULL,
    "cwConversationId" integer NOT NULL,
    "politicaId" text NOT NULL,
    tipo text NOT NULL,
    chave text NOT NULL UNIQUE,
    "ultimaAtividadeEm" timestamp(3) NOT NULL,
    "ultimaAtividadeLado" text NOT NULL,
    "venceEm" timestamp(3) NOT NULL,
    "pausadoMotivo" text,
    "disparadoEm" timestamp(3),
    resultado text,
    erro text,
    "criadoEm" timestamp(3) NOT NULL DEFAULT now(),
    "atualizadoEm" timestamp(3) NOT NULL`,
};

// A fila NÃO ganha DDL própria: ela já existe em produção e o §5.4 afirma que acrescentar o tipo
// 'atend_relogio' NÃO é mudança de schema. A prova só vale se a estrutura for a REAL — por isso é
// copiada com LIKE … INCLUDING ALL, e não redigitada aqui.
const TABELA_FILA = 'RagnabotFluxoFila';

let prisma = null;
const modoDaTabela = {};

async function existeNoPublic(tabela) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."${tabela}"') IS NOT NULL AS existe`,
  );
  return r[0]?.existe === true;
}

async function abrirBanco() {
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
  await prisma.$queryRawUnsafe('SELECT 1');
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${ESQUEMA}"`);

  await varrerOrfaos();

  for (const [tabela, ddl] of Object.entries(DDL_ESPELHO)) {
    if (await existeNoPublic(tabela)) {
      // A migração do §4 chegou: a partir daqui o teste valida o que foi CONSTRUÍDO, não o desenho.
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${ESQUEMA}"."${tabela}" (LIKE public."${tabela}" INCLUDING ALL)`,
      );
      modoDaTabela[tabela] = 'real';
    } else {
      await prisma.$executeRawUnsafe(`CREATE TABLE "${ESQUEMA}"."${tabela}" (${ddl})`);
      modoDaTabela[tabela] = 'espelho';
    }
  }

  if (await existeNoPublic(TABELA_FILA)) {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA}"."${TABELA_FILA}" (LIKE public."${TABELA_FILA}" INCLUDING ALL)`,
    );
    // O DEFAULT copiado aponta para a SEQUÊNCIA DE PRODUÇÃO. Deixá-lo faria o teste consumir
    // números da fila real — efeito colateral pequeno, mas real, e teste não tem efeito colateral.
    await prisma.$executeRawUnsafe(`ALTER TABLE "${ESQUEMA}"."${TABELA_FILA}" ALTER COLUMN id DROP DEFAULT`);
    modoDaTabela[TABELA_FILA] = 'real';
  } else {
    modoDaTabela[TABELA_FILA] = 'ausente';
  }
}

/**
 * Derruba esquemas de execuções mortas.
 *
 * ⚠️ POR QUE ISTO É NECESSÁRIO, e foi MEDIDO: o `finally` limpa o encerramento normal e até a
 * explosão, mas NÃO roda quando o processo é morto por sinal — `timeout`, Ctrl-C, cancelamento de
 * pipeline. Uma execução assim (SIGTERM aos 2 min, em 29/08) deixou um esquema para trás, e teste
 * que só limpa quando termina bem acaba enchendo o banco de lixo que ninguém associa a ele.
 * Só é apagado o que passou de `IDADE_ORFAO_MS` — execução paralela viva não é tocada.
 */
async function varrerOrfaos() {
  const achados = await prisma.$queryRawUnsafe(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'rgn_atend_teste_%'",
  );
  let derrubados = 0;
  for (const { nspname } of achados) {
    const m = PADRAO_ESQUEMA.exec(nspname);
    if (!m) continue;                                   // nome fora do padrão: não é meu, não mexo
    if (nspname === ESQUEMA) continue;
    if (NASCIMENTO - Number(m[1]) < IDADE_ORFAO_MS) continue; // pode estar rodando agora
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    derrubados += 1;
  }
  if (derrubados) console.log(`  🧹 ${derrubados} esquema(s) órfão(s) de execução morta foram derrubados`);
}

async function fecharBanco() {
  if (!prisma) return;
  try {
    // Cinto de segurança: um DROP SCHEMA com o nome errado apaga o trabalho de outra pessoa.
    // A checagem parece paranoia até o dia em que uma variável chega vazia.
    if (PADRAO_ESQUEMA.test(ESQUEMA)) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA}" CASCADE`);
    } else {
      console.log(`  ⚠️  esquema com nome inesperado (${ESQUEMA}) — NÃO derrubado de propósito`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

const T = (tabela) => `"${ESQUEMA}"."${tabela}"`;
const uuid = () => crypto.randomUUID();

/** Grava a política + janelas + exceções de um tenant. Devolve o id da política. */
async function semearPolitica(tenantId, { escopoChave = 'empresa', cwAccountId = 1, ...campos } = {}) {
  const id = uuid();
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${T('RagnabotAtendPolitica')}
       (id,"tenantId","cwAccountId",escopo,"escopoChave",fuso,
        "inatividadeAtiva","inatividadeMinutos","inatividadeConta","inatividadeAcao",
        "inatividadeContaForaExpediente","atualizadoEm")
     VALUES ($1,$2,$3,'empresa',$4,$5,$6,$7,$8,$9,$10,now())`,
    id, tenantId, cwAccountId, escopoChave, campos.fuso ?? FUSO,
    campos.inatividadeAtiva ?? false, campos.inatividadeMinutos ?? null,
    campos.inatividadeConta ?? null, campos.inatividadeAcao ?? null,
    campos.inatividadeContaForaExpediente ?? false,
  );
  return id;
}

async function semearJanelas(tenantId, politicaId, janelas) {
  for (const j of janelas) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${T('RagnabotAtendExpediente')}
         (id,"tenantId","politicaId","diaSemana","abreMin","fechaMin",rotulo,ativo,"atualizadoEm")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,now())`,
      uuid(), tenantId, politicaId, j.diaSemana, j.abreMin, j.fechaMin, j.rotulo ?? null,
    );
  }
}

async function semearExcecoes(tenantId, politicaId, excecoes) {
  for (const e of excecoes) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${T('RagnabotAtendExcecaoData')}
         (id,"tenantId","politicaId","chaveData",tipo,"abreMin","fechaMin",rotulo,mensagem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      uuid(), tenantId, politicaId, e.chaveData, e.tipo, e.abreMin ?? null, e.fechaMin ?? null,
      e.rotulo, e.mensagem ?? null,
    );
  }
}

/**
 * Lê do BANCO as janelas e exceções de um tenant — sempre filtrando pelo tenant, nunca pelo id que
 * viria da tela. É a regra 3 do §4: escopo de empresa vem do usuário logado.
 */
async function lerExpedienteDoBanco(tenantId, politicaId) {
  const janelas = await prisma.$queryRawUnsafe(
    `SELECT "diaSemana","abreMin","fechaMin",rotulo,ativo FROM ${T('RagnabotAtendExpediente')}
      WHERE "tenantId" = $1 AND "politicaId" = $2 ORDER BY "diaSemana","abreMin"`,
    tenantId, politicaId,
  );
  const excecoes = await prisma.$queryRawUnsafe(
    `SELECT "chaveData",tipo,"abreMin","fechaMin",rotulo FROM ${T('RagnabotAtendExcecaoData')}
      WHERE "tenantId" = $1 AND "politicaId" = $2 ORDER BY "chaveData"`,
    tenantId, politicaId,
  );
  return { janelas, excecoes };
}


/**
 * O banco recusou por violação de UNICIDADE?
 *
 * ⚠️ ARMADILHA MEDIDA NA 2ª RODADA DESTE TESTE (29/08): procurar "duplicate key" ou "unique" no
 * texto do erro NÃO funciona com consulta crua do Prisma. Ele embrulha o erro do Postgres e a
 * mensagem que chega é `Raw query failed. Code: 23505. Message: Key (chave)=(…) already exists.` —
 * sem a palavra "unique" e sem "duplicate key". Pior: `e.message` começa com quebra de linha, então
 * `e.message.split('\n')[0]` devolve string VAZIA e o relatório sai mudo sobre o motivo.
 * O que é estável é o SQLSTATE 23505, que o Prisma entrega em `e.meta.code`.
 */
function ehViolacaoDeUnicidade(e) {
  if (e?.meta?.code === '23505') return true;
  const t = String(e?.message ?? '');
  return t.includes('23505') || /duplicate key|already exists|unique constraint/i.test(t);
}

/** Primeira linha NÃO VAZIA do erro — ver a armadilha acima. */
function motivoDoErro(e) {
  return String(e?.message ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '(sem mensagem)';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § VERIFICAÇÕES
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** 1 e 2 — virada de expediente, intervalo e feriado, decididos sobre linhas REAIS do Postgres. */
async function verificarExpediente(politicaA) {
  titulo('1) VIRADA DE EXPEDIENTE, INTERVALO E FERIADO — sobre as linhas gravadas no Postgres');

  const { janelas, excecoes } = await lerExpedienteDoBanco(TENANT_A, politicaA);

  const okQtd = afirmar(
    janelas.length === JANELAS.length,
    `as ${JANELAS.length} janelas voltaram do banco`,
    `voltaram ${janelas.length}`,
    `modo da tabela: ${modoDaTabela.RagnabotAtendExpediente}`,
  );
  if (!okQtd) return;

  // A AFIRMAÇÃO CENTRAL DO §4.2: duas janelas no MESMO dia da semana. O Chatwoot 4.17.1 guarda uma
  // linha por dia e valida que o fechamento não vem antes da abertura — lá isto é impossível, e é
  // por isso que o intervalo de almoço que o dono pediu não é ajuste, é modelo novo.
  const terca = janelas.filter((j) => j.diaSemana === 2);
  afirmar(
    terca.length === 2 && terca[0].fechaMin === 720 && terca[1].abreMin === 780,
    'INTERVALO representável: a terça guarda DUAS janelas (08:00–12:00 e 13:00–18:00)',
    `a terça voltou com ${terca.length} janela(s): ${JSON.stringify(terca)}`,
    'é exatamente o que o modelo do Chatwoot não consegue guardar',
  );

  let errados = 0;
  for (const caso of CASOS_EXPEDIENTE) {
    const r = avaliarExpedienteRef({ agora: new Date(caso.utc), fuso: FUSO, janelas, excecoes });
    if (r.motivo !== caso.motivo || r.aberto !== caso.aberto) {
      errados += 1;
      reprovou(`${caso.nome}`, `esperado ${caso.motivo}/aberto=${caso.aberto}, veio ${r.motivo}/aberto=${r.aberto} — ${caso.porque}`);
    }
  }
  if (!errados) {
    ok(`os ${CASOS_EXPEDIENTE.length} instantes da tabela de casos batem`,
      'inclui a virada exata 07:59→08:00, o almoço como INTERVALO (não "fechado"), o sábado sem tarde, o feriado fixo, o recorrente "*-12-25" e a véspera de meio expediente');
  }

  // O erro de 3 h medido no destino em 29/08 (a caixa 1 está em UTC), preso por um caso próprio.
  const dezUtc = new Date('2026-09-01T10:00:00Z');
  const emFortaleza = avaliarExpedienteRef({ agora: dezUtc, fuso: FUSO, janelas, excecoes });
  const emUtc = avaliarExpedienteRef({ agora: dezUtc, fuso: 'UTC', janelas, excecoes });
  afirmar(
    emFortaleza.aberto === false && emUtc.aberto === true,
    'o fuso da política muda o veredito — ler em UTC abriria o expediente 3 h cedo',
    `Fortaleza=${emFortaleza.motivo}, UTC=${emUtc.motivo} — o esperado era fechado em Fortaleza e aberto em UTC`,
    'é o defeito medido no Ragnabot: inboxes.timezone = UTC',
  );

  // "Voltamos às 13h" em vez de "estamos fechados" — §5.5, {{expediente.proximaAbertura}}.
  const almoco = avaliarExpedienteRef({ agora: new Date('2026-09-01T15:30:00Z'), fuso: FUSO, janelas, excecoes });
  const prox = almoco.proximaAbertura ? noFuso(almoco.proximaAbertura, FUSO) : null;
  afirmar(
    prox && prox.minutos === 13 * 60,
    'no almoço, a próxima abertura é 13:00 — dá para dizer "voltamos às 13h"',
    `próxima abertura veio ${prox ? `${Math.floor(prox.minutos / 60)}:${String(prox.minutos % 60).padStart(2, '0')}` : 'nula'}`,
  );

  const naVespera = avaliarExpedienteRef({ agora: new Date('2026-12-24T18:00:00Z'), fuso: FUSO, janelas, excecoes });
  const proxVespera = naVespera.proximaAbertura ? noFuso(naVespera.proximaAbertura, FUSO) : null;
  afirmar(
    proxVespera && proxVespera.data === '2026-12-26' && proxVespera.minutos === 8 * 60,
    'depois da véspera, a próxima abertura PULA o Natal e cai no sábado 26 às 08:00',
    `veio ${proxVespera ? `${proxVespera.data} ${proxVespera.minutos}min` : 'nula'}`,
    'o feriado recorrente "*-12-25" é respeitado também na projeção, não só no "agora"',
  );
}

/** 3 — feriado no banco: unicidade e a diferença entre data fixa e recorrente. */
async function verificarFeriado(politicaA) {
  titulo('3) FERIADO — a unicidade que impede cadastrar o mesmo Natal dez vezes');

  let duplicou = false;
  try {
    await semearExcecoes(TENANT_A, politicaA, [{ chaveData: '*-12-25', tipo: 'fechado', rotulo: 'Natal (de novo)' }]);
    duplicou = true;
  } catch (e) {
    duplicou = false;
    if (!ehViolacaoDeUnicidade(e)) {
      reprovou('o Natal duplicado foi recusado pelo motivo certo', `o banco recusou, mas por outro motivo: ${motivoDoErro(e)}`);
      return;
    }
  }
  afirmar(
    !duplicou,
    'o Postgres recusa a segunda linha de "*-12-25" na mesma política',
    'a duplicata FOI aceita — o índice único de (politicaId, chaveData) não está valendo',
    'a chave calculada NOT NULL existe porque feriado recorrente não tem ano, e um `ano Int?` nulo escaparia do índice',
  );

  const mesmaData = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T('RagnabotAtendExcecaoData')}
      WHERE "tenantId" = $1 AND "chaveData" IN ('*-12-25','2026-09-07','2026-12-24')`,
    TENANT_A,
  );
  afirmar(mesmaData[0].n === 3, 'as três exceções (recorrente, fixa e janela especial) convivem',
    `vieram ${mesmaData[0].n}`);
}

/** 4 e 5 — o relógio de inatividade, com a escolha do lado que o dono citou nominalmente. */
async function verificarInatividade(politicaA) {
  titulo('4) RELÓGIO DE INATIVIDADE — de quem é o silêncio que conta');

  const { janelas, excecoes } = await lerExpedienteDoBanco(TENANT_A, politicaA);
  const expediente = { fuso: FUSO, janelas, excecoes };

  for (const caso of CASOS_INATIVIDADE) {
    const politica = {
      inatividadeAtiva: true,
      inatividadeMinutos: 30,
      inatividadeConta: caso.conta,
      inatividadeAcao: 'devolver_fila',
      inatividadeContaForaExpediente: false,
    };
    const r = calcularRelogioRef({ politica, conversa: caso.conversa, agora: T10, expediente });

    if (r.arma !== caso.arma) {
      reprovou(caso.nome, `esperado arma=${caso.arma}, veio arma=${r.arma} (motivo ${r.motivo ?? '—'}) — ${caso.porque}`);
      continue;
    }
    if (!caso.arma) {
      if (r.motivo !== caso.motivo) {
        reprovou(caso.nome, `o motivo devia ser "${caso.motivo}" e veio "${r.motivo}"`);
      } else {
        ok(caso.nome, caso.porque);
      }
      continue;
    }
    const venceOk = r.venceEm.toISOString() === new Date(caso.venceUtc).toISOString();
    const ladoOk = r.lado === caso.lado;
    if (venceOk && ladoOk) {
      ok(caso.nome, `${caso.porque} · vence ${r.venceEm.toISOString()} · lado=${r.lado}`);
    } else {
      reprovou(caso.nome,
        `vence esperado ${new Date(caso.venceUtc).toISOString()} / lado ${caso.lado}; veio ${r.venceEm.toISOString()} / lado ${r.lado}`);
    }
  }

  // A gravação do relógio no banco, com a `chave` materializada do §4.5.
  const rel = calcularRelogioRef({
    politica: { inatividadeAtiva: true, inatividadeMinutos: 30, inatividadeConta: 'atendente', inatividadeAcao: 'devolver_fila', inatividadeContaForaExpediente: false },
    conversa: { waitingSince: T10, lastActivityAt: T10, execucaoEstado: 'pausado_humano' },
    agora: T10, expediente,
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${T('RagnabotAtendRelogio')}
       (id,"tenantId","cwAccountId","cwConversationId","politicaId",tipo,chave,
        "ultimaAtividadeEm","ultimaAtividadeLado","venceEm","atualizadoEm")
     VALUES ($1,$2,1,9001,$3,'inatividade','1:9001:inatividade',$4,$5,$6,now())`,
    uuid(), TENANT_A, politicaA, T10, rel.lado, rel.venceEm,
  );
  const gravado = await prisma.$queryRawUnsafe(
    `SELECT chave,"ultimaAtividadeLado","venceEm" FROM ${T('RagnabotAtendRelogio')} WHERE "tenantId" = $1`,
    TENANT_A,
  );
  afirmar(
    gravado.length === 1 && gravado[0].ultimaAtividadeLado === 'contato',
    'o relógio grava QUEM falou por último, e não só quando',
    `veio ${JSON.stringify(gravado)}`,
    'é deste par (lado + instante) que sai a resposta a "de quem é o silêncio", sem reler o histórico inteiro',
  );
}

/** 6 — idempotência do trabalhador, provada com concorrência REAL no Postgres. */
async function verificarIdempotencia(politicaA) {
  titulo('6) IDEMPOTÊNCIA DO TRABALHADOR — dois processos, um único efeito');

  // (a) A chave única impede DOIS relógios do mesmo tipo na mesma conversa. Sem ela, o cliente
  //     recebe "ainda está aí?" duas vezes — e a segunda destrói a confiança na primeira.
  let segundoEntrou = false;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${T('RagnabotAtendRelogio')}
         (id,"tenantId","cwAccountId","cwConversationId","politicaId",tipo,chave,
          "ultimaAtividadeEm","ultimaAtividadeLado","venceEm","atualizadoEm")
       VALUES ($1,$2,1,9001,$3,'inatividade','1:9001:inatividade',now(),'contato',now(),now())`,
      uuid(), TENANT_A, politicaA,
    );
    segundoEntrou = true;
  } catch (e) {
    if (!ehViolacaoDeUnicidade(e)) throw e;
  }
  afirmar(!segundoEntrou,
    'a chave "conta:conversa:tipo" recusa o segundo relógio da mesma conversa',
    'o segundo relógio ENTROU — o índice único de `chave` não está valendo',
    'mata de uma vez o "ainda está aí?" em dobro e a corrida entre o trabalhador e a mensagem nova');

  // (b) DOIS TRABALHADORES DISPARANDO O MESMO RELÓGIO AO MESMO TEMPO. Não é hipótese: é o que
  //     acontece quando o processo é reiniciado com o ceifador rodando, ou quando há duas réplicas.
  //     A cerca é `WHERE "disparadoEm" IS NULL` — o Postgres serializa na linha e o segundo
  //     UPDATE, ao reavaliar o WHERE, não casa mais. Exatamente um vence.
  // ⚠️ 3ª rodada deste teste: a primeira versão passava um `$1` que a consulta não usava e o
  //    Postgres recusou com 42P18 ("could not determine data type of parameter $1"). Todo
  //    marcador declarado tem que ser CONSUMIDO — não existe parâmetro decorativo.
  //    Quem venceu não é gravado numa coluna (o modelo do §4.5 não tem "dono do disparo", e criar
  //    uma só para o teste seria o teste ditando o schema): o veredito vem da CONTAGEM do RETURNING.
  //    `atualizadoEm` vai explícito porque é NOT NULL e o @updatedAt do Prisma não existe em SQL cru.
  const disparar = () => prisma.$queryRawUnsafe(
    `UPDATE ${T('RagnabotAtendRelogio')}
        SET "disparadoEm" = now(), resultado = 'aplicado', "atualizadoEm" = now()
      WHERE chave = $1 AND "disparadoEm" IS NULL
      RETURNING id`,
    '1:9001:inatividade',
  );
  const [w1, w2] = await Promise.all([disparar(), disparar()]);
  const vencedores = [w1.length, w2.length].filter((n) => n === 1).length;
  afirmar(
    w1.length + w2.length === 1 && vencedores === 1,
    'dois trabalhadores concorrentes: EXATAMENTE UM dispara o relógio',
    `w1 pegou ${w1.length} linha(s) e w2 pegou ${w2.length} — o esperado é 1 e 0, em qualquer ordem`,
    'a cerca é `WHERE "disparadoEm" IS NULL`; o perdedor não erra, apenas não faz nada',
  );

  const depois = await prisma.$queryRawUnsafe(
    `SELECT resultado, "disparadoEm" IS NOT NULL AS disparado FROM ${T('RagnabotAtendRelogio')} WHERE chave = '1:9001:inatividade'`,
  );
  afirmar(depois[0]?.disparado === true && depois[0]?.resultado === 'aplicado',
    'o relógio ficou marcado como disparado, e uma terceira rodada não acha mais nada',
    `estado final: ${JSON.stringify(depois)}`);

  const terceira = await disparar();
  afirmar(terceira.length === 0,
    'o trabalhador que chega atrasado descarta o despertar obsoleto em vez de repetir o efeito',
    `a terceira rodada ainda pegou ${terceira.length} linha(s)`,
    'mesmo raciocínio do tokenVisita do motor: resposta e expiração não podem mandar a conversa por dois caminhos');

  // (c) A FILA: o §5.4 afirma que `atend_relogio` é só mais um tipo, sem mudança de schema, e que a
  //     serialização por partição é o que impede o relógio de mexer na conversa no meio de um passo.
  if (modoDaTabela[TABELA_FILA] !== 'real') {
    pulou('a fila aceita o tipo "atend_relogio" sem mudança de schema',
      `a tabela public."${TABELA_FILA}" não existe neste banco — sem ela a afirmação do §5.4 não pode ser conferida`);
    return;
  }
  const particao = `1:9001`;
  for (const n of [1, 2]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${T(TABELA_FILA)} (id,tipo,"chaveParticao","tenantId",payload,prioridade,"disponivelEm",status,"atualizadoEm")
       VALUES ($1,'atend_relogio',$2,$3,'{}'::jsonb,50,now(),'pendente',now())`,
      BigInt(n), particao, TENANT_A,
    );
  }
  const naFila = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T(TABELA_FILA)} WHERE tipo = 'atend_relogio'`,
  );
  afirmar(naFila[0].n === 2,
    'a fila REAL aceita tipo "atend_relogio" — acrescentar o tipo não é mudança de schema (§5.4)',
    `entraram ${naFila[0].n} de 2`,
    `estrutura copiada de public."${TABELA_FILA}" com LIKE … INCLUDING ALL`);

  // A trava de partição do motor: pg_try_advisory_xact_lock(hashtextextended(chave,0)).
  // Duas transações vivas ao mesmo tempo; só uma consegue a posse da conversa.
  let liberar;
  const barreira = new Promise((r) => { liberar = r; });
  const tentar = (tx) => tx.$queryRawUnsafe(
    `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS obtida`, particao,
  );
  const primeira = prisma.$transaction(async (tx) => {
    const r = await tentar(tx);
    await barreira;                 // segura a transação aberta enquanto o rival tenta
    return r[0].obtida;
  }, { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 300));
  const segunda = await prisma.$transaction(async (tx) => (await tentar(tx))[0].obtida, { timeout: 10_000 });
  liberar();
  const primeiraObteve = await primeira;
  afirmar(
    primeiraObteve === true && segunda === false,
    'dois trabalhadores na mesma conversa: só um toma a posse da partição',
    `primeira=${primeiraObteve}, segunda=${segunda} — o esperado é true e false`,
    'é a mesma trava do motor (pg_try_advisory_xact_lock) — sem ela o relógio devolve a conversa para a fila entre a reserva e a confirmação de um efeito',
  );
}

/** 7 — isolamento entre empresas. */
async function verificarIsolamento(politicaA) {
  titulo('7) ISOLAMENTO ENTRE EMPRESAS — o alcance de uma para na fronteira da outra');

  // A empresa B tem a MESMA chave de escopo ("empresa") — é o caso normal, não a exceção.
  const politicaB = await semearPolitica(TENANT_B, { escopoChave: 'empresa', cwAccountId: 2, fuso: 'America/Sao_Paulo' });
  await semearJanelas(TENANT_B, politicaB, [{ diaSemana: 2, abreMin: 0, fechaMin: 1439, rotulo: 'B atende 24 h' }]);
  await semearExcecoes(TENANT_B, politicaB, [{ chaveData: '2026-09-01', tipo: 'fechado', rotulo: 'feriado só da B' }]);

  ok('as duas empresas guardam a chave de escopo "empresa" sem colidir',
    'o índice é (tenantId, escopoChave) — a unicidade é POR EMPRESA, senão a segunda empresa não conseguiria se cadastrar');

  // Duas políticas de empresa na MESMA empresa: é o que a chave calculada NOT NULL existe para
  // impedir. Com um par (cwInboxId, cwTeamId) anulável, os dois NULOS escapariam do índice — no
  // Postgres NULO não é igual a NULO — e a empresa acordaria com duas configurações contraditórias
  // sem ninguém ter feito nada errado.
  let duplicouNaMesma = false;
  try {
    await semearPolitica(TENANT_A, { escopoChave: 'empresa', cwAccountId: 1 });
    duplicouNaMesma = true;
  } catch (e) {
    if (!ehViolacaoDeUnicidade(e)) throw e;
  }
  afirmar(!duplicouNaMesma,
    'a MESMA empresa não consegue ter duas políticas de escopo "empresa"',
    'a segunda política de empresa entrou — a chave calculada NOT NULL não está protegendo nada',
    'é o remédio contra a armadilha dos dois NULOS, a mesma já registrada em RagnabotFluxoEntrada.chave');

  // A consulta que o produto faz: filtrada pelo tenant do usuário logado. Nunca pelo id da tela.
  const janelasVistasPorA = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T('RagnabotAtendExpediente')} WHERE "tenantId" = $1`, TENANT_A,
  );
  const janelasVistasPorB = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T('RagnabotAtendExpediente')} WHERE "tenantId" = $1`, TENANT_B,
  );
  afirmar(
    janelasVistasPorA[0].n === JANELAS.length && janelasVistasPorB[0].n === 1,
    'cada empresa enxerga apenas as próprias janelas',
    `A viu ${janelasVistasPorA[0].n} (esperado ${JANELAS.length}) e B viu ${janelasVistasPorB[0].n} (esperado 1)`,
  );

  // O ATAQUE: a empresa A conhece o id da política da B (ele vaza em log, em URL, em captura de
  // tela) e o manda na requisição. Se a consulta confiar no id da tela, vaza. Ela não confia.
  const ataque = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T('RagnabotAtendExpediente')}
      WHERE "tenantId" = $1 AND "politicaId" = $2`,
    TENANT_A, politicaB,
  );
  afirmar(ataque[0].n === 0,
    'A pedindo a política da B pelo id: zero linhas — o escopo vem do usuário logado, não da tela',
    `voltaram ${ataque[0].n} linha(s), o que é VAZAMENTO`,
    'foi exatamente assim que o sistema antigo vazou ticket entre empresas');

  const feriadoDaB = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${T('RagnabotAtendExcecaoData')}
      WHERE "tenantId" = $1 AND "chaveData" = '2026-09-01'`, TENANT_A,
  );
  afirmar(feriadoDaB[0].n === 0,
    'o feriado da empresa B não fecha o expediente da empresa A',
    `A enxergou ${feriadoDaB[0].n} exceção(ões) da B`,
    'feriado alheio fechando a operação é um dia inteiro de atendimento perdido');

  // E o veredito de expediente com os dados de cada uma, no MESMO instante.
  const inst = new Date('2026-09-01T13:00:00Z'); // 10:00 em Fortaleza / 10:00 em São Paulo
  const dadosA = await lerExpedienteDoBanco(TENANT_A, politicaA);
  const dadosB = await lerExpedienteDoBanco(TENANT_B, politicaB);
  const vA = avaliarExpedienteRef({ agora: inst, fuso: FUSO, ...dadosA });
  const vB = avaliarExpedienteRef({ agora: inst, fuso: 'America/Sao_Paulo', ...dadosB });
  afirmar(
    vA.aberto === true && vB.motivo === 'feriado',
    'no mesmo instante, A está ABERTA e B está em FERIADO — cada uma com o seu calendário',
    `A=${vA.motivo}, B=${vB.motivo}`,
  );
}

/** 8 — a limpeza, provada. */
async function verificarLimpeza() {
  titulo('8) LIMPEZA — o que este teste criou, ele apaga');

  if (await existeNoPublic(TABELA_FILA)) {
    const sujeira = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM public."${TABELA_FILA}" WHERE "tenantId" LIKE $1 OR tipo = 'atend_relogio'`,
      `${PREFIXO_TESTE}%`,
    );
    afirmar(sujeira[0].n === 0,
      'nenhuma linha de teste foi parar na fila de PRODUÇÃO',
      `há ${sujeira[0].n} linha(s) de teste em public."${TABELA_FILA}" — isto precisa ser limpo à mão`,
      'tudo foi escrito no esquema temporário; produção não foi tocada');
  }

  for (const tabela of Object.keys(DDL_ESPELHO)) {
    if (!(await existeNoPublic(tabela))) continue;
    const sujeira = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM public."${tabela}" WHERE "tenantId" LIKE $1`, `${PREFIXO_TESTE}%`,
    );
    afirmar(sujeira[0].n === 0,
      `nada de teste sobrou em public."${tabela}"`,
      `há ${sujeira[0].n} linha(s) com tenantId "${PREFIXO_TESTE}…"`);
  }
}

/** 9 — a camada do serviço real, quando ele existir. */
async function verificarServico(politicaA) {
  titulo('9) SERVIÇO REAL — as mesmas tabelas de casos, agora contra a implementação');

  const achado = await carregarServico();
  if (!achado) {
    pulou('o serviço de automações do atendimento responde à tabela de casos',
      `nenhum dos módulos candidatos existe ainda: ${MODULOS_CANDIDATOS.map((m) => m.replace('../', '')).join(', ')}`);
    pulou('o serviço calcula o relógio com a escolha de lado (contato/atendente/qualquer)',
      'mesma razão: a implementação da fatia 1 do §6 ainda não foi construída');
    return;
  }
  if (achado.erro) {
    reprovou(`o módulo ${achado.caminho} carrega`, `import falhou: ${motivoDoErro(achado.erro)}`);
    return;
  }
  console.log(`     módulo encontrado: ${achado.caminho}`);

  const { janelas, excecoes } = await lerExpedienteDoBanco(TENANT_A, politicaA);

  const exp = achado.funcoes.avaliarExpediente;
  if (!exp) {
    pulou('o serviço responde à tabela de expediente',
      `o módulo existe mas não exporta nenhuma de: ${APELIDOS.avaliarExpediente.join(', ')}`);
  } else {
    let erros = 0;
    for (const caso of CASOS_EXPEDIENTE) {
      let r;
      try {
        r = await exp.fn({ agora: new Date(caso.utc), fuso: FUSO, janelas, excecoes, politica: { fuso: FUSO } });
      } catch (e) {
        erros += 1;
        reprovou(`serviço · ${caso.nome}`, `a chamada jogou: ${motivoDoErro(e)}`);
        continue;
      }
      if (r?.motivo !== caso.motivo || !!r?.aberto !== caso.aberto) {
        erros += 1;
        reprovou(`serviço · ${caso.nome}`,
          `esperado ${caso.motivo}/aberto=${caso.aberto}; ${exp.nome}() devolveu ${JSON.stringify(r)} — ${caso.porque}`);
      }
    }
    if (!erros) ok(`${exp.nome}() bate nos ${CASOS_EXPEDIENTE.length} instantes da tabela`, 'a implementação concorda com o documento 29');
  }

  const rel = achado.funcoes.calcularRelogio;
  if (!rel) {
    pulou('o serviço calcula o relógio com a escolha de lado (contato/atendente/qualquer)',
      `o módulo existe mas não exporta nenhuma de: ${APELIDOS.calcularRelogio.join(', ')}`);
  } else {
    let erros = 0;
    for (const caso of CASOS_INATIVIDADE) {
      const politica = {
        inatividadeAtiva: true, inatividadeMinutos: 30, inatividadeConta: caso.conta,
        inatividadeAcao: 'devolver_fila', inatividadeContaForaExpediente: false, fuso: FUSO,
      };
      // TRADUÇÃO DELIBERADA: a tabela de casos descreve a conversa em termos do CHATWOOT
      // (`waiting_since` e `last_activity_at`, as colunas medidas em 29/08), porque é assim que o
      // dado chega da plataforma. O serviço é puro e recebe o lado JÁ DECIDIDO. A leitura de
      // `waiting_since` — cheio = o contato falou e ninguém respondeu; nulo = o atendente já
      // respondeu — é a regra do §4.1, e é aqui que ela é exercida.
      const lado = caso.conversa.waitingSince ? 'contato' : 'atendente';
      const ultimaAtividadeEm = caso.conversa.waitingSince ?? caso.conversa.lastActivityAt;
      let r;
      try {
        r = await rel.fn({
          politica,
          agora: T10,
          ultimaAtividadeEm,
          ultimaAtividadeLado: lado,
          execucao: caso.conversa.execucaoEstado ? { estado: caso.conversa.execucaoEstado } : null,
          janelas,
          excecoes,
        });
      } catch (e) {
        erros += 1;
        reprovou(`serviço · ${caso.nome}`, `a chamada jogou: ${motivoDoErro(e)}`);
        continue;
      }
      if (!!r?.arma !== caso.arma) {
        erros += 1;
        reprovou(`serviço · ${caso.nome}`, `esperado arma=${caso.arma}; ${rel.nome}() devolveu ${JSON.stringify(r)} — ${caso.porque}`);
        continue;
      }
      if (!caso.arma) {
        const aceitos = MOTIVOS_EQUIVALENTES[caso.motivo] ?? [caso.motivo];
        if (!aceitos.includes(r.motivo)) {
          erros += 1;
          reprovou(`serviço · ${caso.nome}`,
            `não armou, mas pelo motivo "${r.motivo}" — o esperado era um de: ${aceitos.join(', ')}`);
        }
        continue;
      }
      if (new Date(r.venceEm).toISOString() !== new Date(caso.venceUtc).toISOString()) {
        erros += 1;
        reprovou(`serviço · ${caso.nome}`, `vencimento esperado ${caso.venceUtc}, veio ${new Date(r.venceEm).toISOString()}`);
      }
    }
    if (!erros) ok(`${rel.nome}() bate nos ${CASOS_INATIVIDADE.length} casos de inatividade`, 'inclui o congelamento fora do expediente e o almoço que não conta');
  }
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § DUBLÊ DE BANCO — para rodar o TRABALHADOR REAL sem escrever em produção
//
// POR QUE UM DUBLÊ AQUI, se o resto do arquivo usa Postgres de verdade: `rodadaDoRelogio()` varre
// TODOS os relógios vencidos, sem filtro de empresa (é o desenho certo — um trabalhador não tem
// dono), e enfileira em `RagnabotFluxoFila`. Rodá-lo contra o banco de produção plantaria trabalho
// de teste numa fila que tem trabalhador vivo do outro lado. O serviço foi construído com PORTAS
// justamente para isto, e o comentário dele diz: "as dependências entram por injeção para que o
// teste rode a decisão DE VERDADE, sem banco e sem rede".
//
// O dublê é mínimo de propósito: cobre só os modelos e operadores que o trabalhador usa. Dublê que
// tenta imitar o Prisma inteiro vira um segundo banco de dados para manter, com bugs próprios.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function criarDubleDeBanco() {
  const tabelas = {
    ragnabotAtendPolitica: [], ragnabotAtendExpediente: [], ragnabotAtendExcecaoData: [],
    ragnabotAtendRelogio: [], ragnabotAtendTransferencia: [], ragnabotFluxoFila: [],
  };

  // ⚠️ O DUBLÊ RECUSA O QUE NÃO ENTENDE, e isto custou uma rodada vermelha (6ª execução, 29/08).
  // A versão anterior devolvia FALSO em silêncio para qualquer operador desconhecido. Quando o
  // serviço ganhou uma cerca com `OR` e `atualizadoEm: {lt: …}`, o dublê passou a não casar NADA e
  // o teste acusou três defeitos que não existiam — apontando para o produto quando o cego era o
  // instrumento. Dublê que erra calado é pior que dublê que não existe: manda caçar fantasma.
  const casaCampo = (v, cond) => {
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v != null && new Date(v).getTime() === cond.getTime();
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const SUPORTADOS = ['in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'not'];
      const desconhecidos = Object.keys(cond).filter((k) => !SUPORTADOS.includes(k));
      if (desconhecidos.length) {
        throw new Error(`o dublê de banco deste teste não suporta o operador ${desconhecidos.join(', ')} `
          + '— acrescente-o em criarDubleDeBanco() antes de acreditar no vermelho');
      }
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('notIn' in cond && cond.notIn.includes(v)) return false;
      if ('not' in cond && v === cond.not) return false;
      if ('lte' in cond && !(v != null && new Date(v) <= new Date(cond.lte))) return false;
      if ('lt' in cond && !(v != null && new Date(v) < new Date(cond.lt))) return false;
      if ('gte' in cond && !(v != null && new Date(v) >= new Date(cond.gte))) return false;
      if ('gt' in cond && !(v != null && new Date(v) > new Date(cond.gt))) return false;
      return true;
    }
    return v === cond;
  };
  const casa = (reg, where = {}) => Object.entries(where).every(([k, c]) => {
    if (k === 'OR') return c.some((sub) => casa(reg, sub));
    if (k === 'AND') return c.every((sub) => casa(reg, sub));
    return casaCampo(reg[k], c);
  });

  // `@updatedAt` é responsabilidade do CLIENTE do Prisma, não do banco. A cerca do serviço compara
  // `atualizadoEm` para reabrir linha travada por worker morto — sem carimbar aqui, essa terceira
  // porta nunca seria exercida e o teste passaria sem provar nada.
  const carimbar = (reg) => { reg.atualizadoEm = new Date(); return reg; };

  const modelo = (nome) => ({
    findMany: async ({ where, orderBy, take } = {}) => {
      let l = tabelas[nome].filter((r) => casa(r, where));
      if (orderBy) {
        const [campo, dir] = Object.entries(orderBy)[0];
        l = [...l].sort((a, b) => (new Date(a[campo]) - new Date(b[campo])) * (dir === 'desc' ? -1 : 1));
      }
      return take ? l.slice(0, take) : l.map((r) => ({ ...r }));
    },
    findUnique: async ({ where }) => {
      const r = tabelas[nome].find((x) => casa(x, where));
      return r ? { ...r } : null;
    },
    create: async ({ data }) => {
      const reg = { id: data.id ?? uuid(), criadoEm: new Date(), ...data };
      // O dublê PRECISA recusar o que o banco recusaria; senão a prova de idempotência é decorativa.
      if (nome === 'ragnabotAtendRelogio' && tabelas[nome].some((x) => x.chave === reg.chave)) {
        const e = new Error('Unique constraint failed on the fields: (`chave`)'); e.code = 'P2002'; throw e;
      }
      tabelas[nome].push(carimbar(reg));
      return { ...reg };
    },
    update: async ({ where, data }) => {
      const r = tabelas[nome].find((x) => casa(x, where));
      if (!r) { const e = new Error('não encontrado'); e.code = 'P2025'; throw e; }
      carimbar(Object.assign(r, data));
      return { ...r };
    },
    updateMany: async ({ where, data }) => {
      const alvo = tabelas[nome].filter((r) => casa(r, where));
      alvo.forEach((r) => carimbar(Object.assign(r, data)));
      return { count: alvo.length };
    },
    upsert: async ({ where, create, update }) => {
      const r = tabelas[nome].find((x) => casa(x, where));
      if (r) { carimbar(Object.assign(r, update)); return { ...r }; }
      const reg = { id: uuid(), criadoEm: new Date(), ...create };
      tabelas[nome].push(carimbar(reg));
      return { ...reg };
    },
    deleteMany: async ({ where } = {}) => {
      const antes = tabelas[nome].length;
      tabelas[nome] = tabelas[nome].filter((r) => !casa(r, where));
      return { count: antes - tabelas[nome].length };
    },
  });

  const cliente = {};
  for (const m of Object.keys(tabelas)) cliente[m] = modelo(m);
  cliente.$queryRaw = async () => [{ agora: new Date() }];
  cliente.$transaction = async (fn) => fn(cliente);
  cliente.__tabelas = tabelas;
  return cliente;
}

/** 10 — o trabalhador REAL do serviço, com as portas injetadas. */
async function verificarTrabalhadorReal() {
  titulo('10) TRABALHADOR REAL — rodadaDoRelogio() e processarTrabalhoDoRelogio() do serviço');

  const achado = await carregarServico();
  if (!achado || achado.erro || !achado.mod?.rodadaDoRelogio || !achado.mod?.processarTrabalhoDoRelogio) {
    pulou('o trabalhador do relógio entrega o mesmo despertar uma única vez',
      'o serviço não expõe rodadaDoRelogio()/processarTrabalhoDoRelogio() — nada a exercitar ainda');
    return;
  }
  const svc = achado.mod;
  const banco = criarDubleDeBanco();

  // 10:30 de uma TERÇA em Fortaleza: dentro do expediente, para que a ação não seja recusada por
  // estar fechado. O relógio do serviço vem da porta, nunca do relógio do pod — é o próprio serviço
  // que diz por quê: "relógio de pod fora de sincronia decide expediente e vencimento errados".
  const AGORA = new Date('2026-09-01T13:30:00Z');
  const chatwoot = { chamadas: [] };
  chatwoot.mudarStatus = async (a) => { chatwoot.chamadas.push(['mudarStatus', a.status]); };
  chatwoot.removerAgente = async () => { chatwoot.chamadas.push(['removerAgente']); };
  chatwoot.atribuirTime = async (a) => { chatwoot.chamadas.push(['atribuirTime', a.cwTeamId]); };
  chatwoot.notaInterna = async () => { chatwoot.chamadas.push(['notaInterna']); };
  const canal = { enviadas: [], janelaAberta: async () => true, enviarTexto: async (a) => { canal.enviadas.push(a.texto); } };

  const portasAntes = svc.portasDoAtendimento();
  svc.configurar({ db: banco, relogio: { agora: async () => AGORA }, chatwoot, canal, auditoria: { registrar: async () => {} } });

  try {
    const polA = {
      id: 'pol-a', tenantId: TENANT_A, cwAccountId: 1, escopo: 'empresa', escopoChave: 'empresa',
      cwInboxId: null, cwTeamId: null, ativa: true, fuso: FUSO,
      inatividadeAtiva: true, inatividadeMinutos: 30, inatividadeConta: 'atendente',
      inatividadeAcao: 'devolver_fila', inatividadeMensagem: 'Vamos devolver seu atendimento à fila.',
      inatividadeContaForaExpediente: false,
    };
    // A empresa B com a MESMA conta e a MESMA chave de escopo — é assim que um vazamento aparece.
    const polB = { ...polA, id: 'pol-b', tenantId: TENANT_B, inatividadeMinutos: 999, inatividadeAcao: 'resolver' };
    banco.__tabelas.ragnabotAtendPolitica.push(polA, polB);
    for (const j of JANELAS) {
      banco.__tabelas.ragnabotAtendExpediente.push({ id: uuid(), tenantId: TENANT_A, politicaId: 'pol-a', ativo: true, ...j });
      banco.__tabelas.ragnabotAtendExpediente.push({ id: uuid(), tenantId: TENANT_B, politicaId: 'pol-b', ativo: true, ...j });
    }
    for (const e of EXCECOES) {
      banco.__tabelas.ragnabotAtendExcecaoData.push({ id: uuid(), tenantId: TENANT_A, politicaId: 'pol-a', ...e });
    }

    // ── ISOLAMENTO, contra o código de verdade ────────────────────────────────────────────────
    const efetivaA = await svc.carregarPoliticaEfetiva({ tenantId: TENANT_A, cwAccountId: 1 });
    afirmar(
      efetivaA.politica.inatividadeMinutos === 30 && efetivaA.politicaBase?.id === 'pol-a',
      'carregarPoliticaEfetiva() da empresa A devolve a política de A',
      `veio ${JSON.stringify({ min: efetivaA.politica.inatividadeMinutos, base: efetivaA.politicaBase?.id })}`,
      'as duas empresas têm a MESMA conta e a MESMA chave de escopo — o que separa é só o tenantId');

    const pelaBaseAlheia = await svc.carregarPoliticaPelaBase({ tenantId: TENANT_A, politicaId: 'pol-b' });
    afirmar(pelaBaseAlheia === null,
      'A pedindo a política de B pelo id, dentro do serviço: devolve nulo',
      `devolveu ${JSON.stringify(pelaBaseAlheia?.politicaBase?.id ?? pelaBaseAlheia)} — é VAZAMENTO`,
      'a guarda é `base.tenantId !== tenantId`; sem ela, o id que vaza num log vira chave de acesso');

    // ── IDEMPOTÊNCIA DO TRABALHADOR ───────────────────────────────────────────────────────────
    const relogio = {
      id: 'rel-1', tenantId: TENANT_A, cwAccountId: 1, cwConversationId: 555, politicaId: 'pol-a',
      tipo: 'inatividade', chave: '1:555:inatividade',
      ultimaAtividadeEm: new Date('2026-09-01T13:00:00Z'), ultimaAtividadeLado: 'contato',
      venceEm: new Date('2026-09-01T13:29:00Z'), // já venceu em relação a AGORA
      pausadoMotivo: null, disparadoEm: null, resultado: null, erro: null,
    };
    banco.__tabelas.ragnabotAtendRelogio.push(relogio);

    const r1 = await svc.rodadaDoRelogio({ limite: 10 });
    afirmar(r1.vistos === 1 && r1.enfileirados === 1,
      'a primeira rodada acha o relógio vencido e enfileira UM despertar',
      `veio ${JSON.stringify(r1)}`);

    const r2 = await svc.rodadaDoRelogio({ limite: 10 });
    afirmar(r2.enfileirados === 0 && banco.__tabelas.ragnabotFluxoFila.length === 1,
      'a SEGUNDA rodada não enfileira de novo — a guarda contra dupla entrega segura',
      `veio ${JSON.stringify(r2)} com ${banco.__tabelas.ragnabotFluxoFila.length} trabalho(s) na fila`,
      'é o `updateMany where disparadoEm: null`; zero linhas afetadas não é erro, é a corrida resolvida');

    const job = banco.__tabelas.ragnabotFluxoFila[0];
    afirmar(job.tipo === 'atend_relogio' && job.chaveParticao === '1:555',
      'o despertar entra na fila do motor com tipo "atend_relogio" e partição "conta:conversa"',
      `veio tipo=${job.tipo} partição=${job.chaveParticao}`,
      'a partição é o que impede o relógio de mexer na conversa no meio de um passo do fluxo');

    const p1 = await svc.processarTrabalhoDoRelogio(job);
    afirmar(p1.resultado === 'aplicado',
      'o despacho aplica a ação: devolve a conversa para a fila',
      `resultado veio "${p1.resultado}" (${p1.motivo ?? '—'})`);
    afirmar(
      chatwoot.chamadas.some(([m, v]) => m === 'mudarStatus' && v === 'pending')
      && chatwoot.chamadas.some(([m]) => m === 'removerAgente'),
      'o Chatwoot recebeu "pending" e a remoção do agente',
      `chamadas: ${JSON.stringify(chatwoot.chamadas)}`,
      'a AÇÃO pending_conversation já existe no produto — o que faltava era o GATILHO DE TEMPO');

    // O MESMO TRABALHO ENTREGUE DUAS VEZES. Não é hipótese: a fila do motor é de entrega AO MENOS
    // UMA VEZ — tem `tentativas`/`maxTentativas` e um ceifador que devolve para 'pendente' o
    // trabalho preso em 'processando' por worker morto. A janela é estreita e certa: efeitos
    // aplicados → processo morre antes de marcar o trabalho como feito → o ceifador o devolve → o
    // despacho roda de novo.
    //
    // O carimbo de frescor NÃO fecha esta porta: ele compara venceEm | ultimaAtividadeEm |
    // ultimaAtividadeLado | tipo, e nenhum dos quatro muda quando o próprio despacho age. O que
    // muda é `resultado`, e ele não é consultado.
    const antesDoRepeteco = { cw: chatwoot.chamadas.length, msgs: canal.enviadas.length };
    const p2 = await svc.processarTrabalhoDoRelogio(job);
    const repetiuEfeito = chatwoot.chamadas.length > antesDoRepeteco.cw || canal.enviadas.length > antesDoRepeteco.msgs;
    afirmar(!repetiuEfeito,
      'o MESMO trabalho entregue duas vezes não repete o efeito nem a mensagem ao cliente',
      `o segundo despacho devolveu "${p2.resultado}" e AGIU DE NOVO: `
      + `${chatwoot.chamadas.length - antesDoRepeteco.cw} chamada(s) ao Chatwoot e `
      + `${canal.enviadas.length - antesDoRepeteco.msgs} mensagem(ns) a mais. `
      + 'O cliente lê a mesma mensagem duas vezes e conclui que o robô está quebrado. '
      + 'REMÉDIO (em ragnabot-atendimento.service.js, no início de processarTrabalhoDoRelogio, logo '
      + 'após carregar o relógio): se `r.resultado` já for "aplicado", devolver '
      + '{resultado:"descartado_obsoleto", motivo:"ja_aplicado"} sem executar o plano',
      `segundo despacho: ${p2.resultado}`);

    // ── VIRADA DE EXPEDIENTE NO DESPACHO ──────────────────────────────────────────────────────
    // Entre agendar e disparar, o mundo muda. Um relógio que vence às 3 h da manhã não pode agir:
    // é a armadilha do "ainda está aí?" de madrugada, e o serviço tem que reagendar, não executar.
    const madrugada = new Date('2026-09-02T06:00:00Z'); // 03:00 em Fortaleza
    svc.configurar({ relogio: { agora: async () => madrugada } });
    const rel2 = {
      id: 'rel-2', tenantId: TENANT_A, cwAccountId: 1, cwConversationId: 777, politicaId: 'pol-a',
      tipo: 'inatividade', chave: '1:777:inatividade',
      ultimaAtividadeEm: madrugada, ultimaAtividadeLado: 'contato', venceEm: madrugada,
      pausadoMotivo: null, disparadoEm: null, resultado: null, erro: null,
    };
    banco.__tabelas.ragnabotAtendRelogio.push(rel2);
    const antesMadrugada = chatwoot.chamadas.length;
    const p3 = await svc.processarTrabalhoDoRelogio({ payload: { relogioId: 'rel-2' } });
    const reagendado = banco.__tabelas.ragnabotAtendRelogio.find((x) => x.id === 'rel-2');
    const proxLocal = reagendado?.venceEm ? noFuso(new Date(reagendado.venceEm), FUSO) : null;
    afirmar(
      p3.resultado === 'recusado_fora_expediente' && chatwoot.chamadas.length === antesMadrugada
      && proxLocal?.minutos === 8 * 60,
      'às 03:00 o despacho RECUSA agir e reagenda para as 08:00 — ninguém recebe "ainda está aí?" de madrugada',
      `resultado=${p3.resultado}, agiu=${chatwoot.chamadas.length !== antesMadrugada}, `
      + `reagendado para ${proxLocal ? hhmmDe(proxLocal.minutos) : 'nulo'}`,
      `pausadoMotivo="${reagendado?.pausadoMotivo}"`);

    // ── FERIADO NO DESPACHO ───────────────────────────────────────────────────────────────────
    const natal = new Date('2026-12-25T13:00:00Z'); // 10:00 do Natal — dia útil se não fosse feriado
    svc.configurar({ relogio: { agora: async () => natal } });
    const rel3 = { ...rel2, id: 'rel-3', cwConversationId: 888, chave: '1:888:inatividade', venceEm: natal, ultimaAtividadeEm: natal, disparadoEm: null, resultado: null };
    banco.__tabelas.ragnabotAtendRelogio.push(rel3);
    const antesNatal = chatwoot.chamadas.length;
    const p4 = await svc.processarTrabalhoDoRelogio({ payload: { relogioId: 'rel-3' } });
    afirmar(
      p4.resultado === 'recusado_fora_expediente' && p4.motivo === 'feriado'
      && chatwoot.chamadas.length === antesNatal,
      'no Natal o despacho recusa agir e diz o motivo: feriado',
      `resultado=${p4.resultado}, motivo=${p4.motivo}, agiu=${chatwoot.chamadas.length !== antesNatal}`,
      'a exceção recorrente "*-12-25" vale também na segunda conferência, na hora de disparar');
  } finally {
    // Devolver as portas é obrigatório: elas são MÓDULO, não instância. Deixar o dublê ligado
    // contaminaria qualquer coisa que importasse o serviço depois neste mesmo processo.
    svc.configurar(portasAntes);
  }
}

const hhmmDe = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// § CORREDOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function principal() {
  console.log('═'.repeat(96));
  console.log('AUTOMAÇÕES DO ATENDIMENTO — prova executável do documento 29');
  console.log(`esquema temporário: ${ESQUEMA}   ·   empresas de teste: ${TENANT_A} / ${TENANT_B}`);
  console.log('═'.repeat(96));

  try {
    await abrirBanco();
  } catch (e) {
    console.log(`\n  ⏭️  NADA PÔDE SER EXECUTADO — o PostgreSQL não respondeu: ${motivoDoErro(e)}`);
    console.log('      Este arquivo julga o MODELO com o banco de verdade; sem ele não há veredito.');
    return 2;
  }

  console.log(`\nmodo de cada tabela: ${JSON.stringify(modoDaTabela)}`);
  console.log('  "espelho" = a migração do §4 ainda não existe e a estrutura veio do documento;');
  console.log('  "real"    = a migração chegou e o teste está validando a estrutura CONSTRUÍDA.');

  const politicaA = await semearPolitica(TENANT_A, {
    escopoChave: 'empresa', cwAccountId: 1, fuso: FUSO,
    inatividadeAtiva: true, inatividadeMinutos: 30, inatividadeConta: 'atendente',
    inatividadeAcao: 'devolver_fila', inatividadeContaForaExpediente: false,
  });
  await semearJanelas(TENANT_A, politicaA, JANELAS);
  await semearExcecoes(TENANT_A, politicaA, EXCECOES);

  await verificarExpediente(politicaA);
  await verificarFeriado(politicaA);
  await verificarInatividade(politicaA);
  await verificarIdempotencia(politicaA);
  await verificarIsolamento(politicaA);
  await verificarLimpeza();
  await verificarServico(politicaA);
  await verificarTrabalhadorReal();

  console.log(`\n${'─'.repeat(96)}`);
  console.log(`  ${aprovadas} passaram · ${reprovadas} reprovaram · ${naoExecutadas} não executaram`);
  if (naoExecutadas) {
    console.log('  ⚠️  "não executou" NÃO é aprovação. O código de saída 2 existe para que o corredor não confunda os dois.');
  }
  console.log('─'.repeat(96));

  if (reprovadas) return 1;
  if (naoExecutadas) return 2;
  return 0;
}

// Morte por sinal não passa pelo `finally`. Estes dois ganchos fecham a última porta: Ctrl-C e
// `timeout` deixam de largar esquema para trás. Chamar `process.exit` aqui é proposital — o objetivo
// é sair AGORA, com o banco limpo, e não retomar o teste.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.once(sinal, async () => {
    console.log(`\n  ⚠️  ${sinal} recebido — derrubando o esquema temporário antes de sair`);
    try { await fecharBanco(); } catch { /* nada a fazer: já estamos saindo */ }
    process.exit(130);
  });
}

let codigo = 3;
try {
  codigo = await principal();
} catch (e) {
  console.log(`\n  💥 erro inesperado: ${motivoDoErro(e)}`);
  if (process.env.VERBOSE) console.log(e.stack);
  codigo = 3;
} finally {
  // A limpeza roda mesmo depois de explosão. Teste que suja o banco quando falha é pior que teste
  // nenhum: o próximo a rodar herda a sujeira e passa a caçar um defeito que não existe.
  try { await fecharBanco(); } catch (e) { console.log(`  ⚠️  falha ao derrubar o esquema: ${e.message}`); }
}
process.exit(codigo);
