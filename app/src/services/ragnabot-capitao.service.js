// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAPITÃO — a CAMADA DA CASA sobre o agente de IA nativo da plataforma base.
//
// Base: /ia/.claude/modulo-atendimento/34-PLANO-PARIDADE-CHAT-ATUAL.md §2.C (itens 2.C.1 a 2.C.7)
//       e 35-EXECUCAO-DETALHADA.md, sprint S5.
//
// DECISÃO DO DONO (02/09/2026): *"pode manter o capitão como agente no lugar do chat, não precisa
// construir do zero, só adequa de como ele é usado para o nosso atual"*. Portanto:
//   • NÃO existe modelo de IA nosso aqui, nem cliente de OpenAI, nem vetorização caseira;
//   • o que existe é a camada que decide QUANDO ele fala, COM QUAIS documentos, EM NOME DE QUEM,
//     e ATÉ QUANTO pode gastar.
//
// ⛔ O INTERRUPTOR MESTRE NASCE DESLIGADO (`CAPITAO_ATIVO` ausente = false). A chave da OpenAI da
//    plataforma está VAZIA hoje e a licença da edição paga é decisão comercial do dono. Este
//    arquivo existe para que ligar seja UMA VARIÁVEL DE AMBIENTE, não um novo deploy de código.
//
// ⚠️ O QUE AQUI NÃO FOI MEDIDO, e não vou fingir que foi: os caminhos da API do Captain na
//    plataforma (`CAMINHOS`) vêm da leitura da instalação e da documentação, NÃO de chamada real —
//    com a chave vazia o agente não responde nada e não há o que exercitar. Por isso toda ida à
//    plataforma passa por UMA PORTA injetável (`portas.plataforma`): o dia em que o caminho estiver
//    errado, o conserto é uma linha aqui, e os testes continuam valendo porque nunca dependeram
//    dela. `estadoDaEmpresa()` devolve `verificadoNaPlataforma:false` justamente para não deixar
//    ninguém confundir "configurado" com "provado".
//
// ─── A FRONTEIRA FLUXO × IA (2.C.2) — o item mais importante deste arquivo ──────────────────────
// A regra, escrita uma vez só, em `decidirQuemResponde()`:
//
//     1. o FLUXO atende primeiro — é previsível, é auditável e é de graça;
//     2. o CAPITÃO entra SÓ quando o fluxo não tem saída para o que o cliente disse (ou quando um
//        nó `agente_ia` o chama de propósito);
//     3. ele devolve ao HUMANO quando não sabe, quando estoura o teto ou quando está desligado.
//
// E a garantia dura: **o cliente nunca recebe duas respostas**. Ela é feita de duas travas, não de
// disciplina de quem escreve o código:
//   (a) a função de decisão devolve UM ÚNICO responsável — não existe caminho que devolva dois;
//   (b) antes de perguntar qualquer coisa ao agente, `reservarResposta()` grava uma linha com
//       `chave` ÚNICA por mensagem (`entrada:<id>`). Duas réplicas do motor tratando a mesma
//       reentrega: a segunda leva P2002 e cala a boca. Sem essa reserva, "responder uma vez" seria
//       promessa, e promessa não sobrevive a duas réplicas.
//
// ─── ISOLAMENTO MULTI-INQUILINO (2.C.4) ─────────────────────────────────────────────────────────
// `tenantId` é obrigatório em TODA função que lê ou escreve documento, e a resposta é conferida:
// se a plataforma devolver um documento que não é desta empresa, a resposta é DESCARTADA e a
// conversa vai para gente. É a mesma disciplina do `escopoDe()` da auditoria — a tela pode
// estreitar, nunca alargar.
//
// ─── LGPD ───────────────────────────────────────────────────────────────────────────────────────
// Nenhum texto de cliente é gravado: a pergunta vira sha256 e a resposta vira contagem de
// caracteres. Medir consumo não é motivo para guardar a conversa do cliente do nosso cliente.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import { limitesDoPlano, planoExiste } from '../config/ragnabot-plans.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VOCABULÁRIO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Quem responde esta mensagem. É uma escolha ÚNICA — nunca dois. */
export const QUEM_RESPONDE = Object.freeze({
  FLUXO: 'fluxo',
  CAPITAO: 'capitao',
  HUMANO: 'humano',
  /** Ninguém responde AGORA (evento de controle, eco nosso). Não é o mesmo que "humano". */
  NINGUEM: 'ninguem',
});

/** Desfecho de uma tentativa de resposta da IA. Vale para `RagnabotCapitaoInteracao.resultado`. */
export const RESULTADOS_IA = Object.freeze({
  RESERVADO: 'reservado',
  RESPONDEU: 'respondeu',
  NAO_SABE: 'nao_sabe',
  RECUSADO_TETO: 'recusado_teto',
  RECUSADO_DESLIGADO: 'recusado_desligado',
  RECUSADO_ISOLAMENTO: 'recusado_isolamento',
  DUPLICADA: 'duplicada',
  ERRO: 'erro',
});

/** Situações do documento da base de conhecimento. */
export const STATUS_DOCUMENTO = Object.freeze({
  PENDENTE: 'pendente',
  SINCRONIZADO: 'sincronizado',
  ERRO: 'erro',
  REMOVIDO: 'removido',
});

const TIPOS_DOCUMENTO = Object.freeze(['url', 'texto', 'arquivo']);
const TONS = Object.freeze(['cordial', 'direto', 'formal', 'descontraido']);

/**
 * Caminhos do agente na plataforma. ⚠️ NÃO MEDIDOS CONTRA INSTÂNCIA VIVA (ver cabeçalho). Ficam
 * juntos, num só lugar, para o conserto ser de uma linha quando alguém puder exercitar de verdade.
 */
export const CAMINHOS = Object.freeze({
  assistentes: (conta) => `/api/v1/accounts/${conta}/captain/assistants`,
  assistente: (conta, id) => `/api/v1/accounts/${conta}/captain/assistants/${id}`,
  documentos: (conta) => `/api/v1/accounts/${conta}/captain/documents`,
  documento: (conta, id) => `/api/v1/accounts/${conta}/captain/documents/${id}`,
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO — tudo por ambiente, nenhum segredo no código
// ────────────────────────────────────────────────────────────────────────────────────────────────
function env(nome, padrao = '') {
  const v = process.env[nome];
  return v === undefined || v === null || v === '' ? padrao : String(v);
}

function inteiroDoAmbiente(nome, padrao) {
  const n = Number(env(nome, ''));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : padrao;
}

export function configuracaoCapitao() {
  return {
    // ⛔ O INTERRUPTOR MESTRE. Ausente = DESLIGADO. Só `1`/`true`/`sim` ligam — qualquer outra
    // coisa (inclusive "0", "false" e lixo) mantém desligado, que é a falha fechada.
    ativo: /^(1|true|sim)$/i.test(env('CAPITAO_ATIVO', '')),
    // Custo estimado por resposta, em centavos. ⚠️ É ESTIMATIVA declarada: a plataforma não nos
    // devolve o custo real da chamada à OpenAI. Enquanto for estimativa, o número aparece como
    // `custoEstimado` em todo lugar — número inventado com cara de medição corrói a confiança.
    custoPorRespostaCentavos: inteiroDoAmbiente('CAPITAO_CUSTO_RESPOSTA_CENTAVOS', 0),
    custoPorMilTokensCentavos: inteiroDoAmbiente('CAPITAO_CUSTO_MIL_TOKENS_CENTAVOS', 0),
    // Teto GERAL da instalação (soma de todas as empresas) — a rede de proteção do dono contra
    // crédito de IA secando de madrugada. 0 = sem teto geral (o teto por empresa continua valendo).
    tetoGlobalRespostasMes: inteiroDoAmbiente('CAPITAO_TETO_GLOBAL_RESPOSTAS_MES', 0),
    tempoLimiteMs: inteiroDoAmbiente('CAPITAO_TEMPO_LIMITE_MS', 20000),
  };
}

/** Atalho honesto para quem só quer saber se pode ligar a boca do agente. */
export function interruptorLigado() {
  return configuracaoCapitao().ativo === true;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — injeção como no resto da casa. O teste troca a IMPLEMENTAÇÃO, nunca o caminho do código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  log: logger,

  /**
   * A plataforma (Captain). Ausente = a camada funciona para configurar, medir e decidir, mas
   * `responderPorIA()` devolve `humano` com motivo declarado — nunca inventa resposta.
   * @type {null | {
   *   perguntar: (p:{tenantId:string,pergunta:string,marca:object,documentos:Array,conversa:object}) =>
   *     Promise<{texto?:string, confianca?:number, documentosUsados?:Array, tokensEntrada?:number,
   *              tokensSaida?:number, modelo?:string, naoSei?:boolean}>,
   *   sincronizarDocumento?: Function, removerDocumento?: Function, lerAssistente?: Function
   * }}
   */
  plataforma: null,

  /** Auditoria da casa. Ausente = só log. */
  auditoria: null,

  /** Relógio. Só o teste troca; em produção a hora vem do banco quando houver transação. */
  relogio: null,
};

export function configurarCapitao(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no capitão: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoCapitao();
}

export function portasDoCapitao() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/**
 * O modelo existe NESTE PROCESSO? O cliente Prisma é carregado no boot, então a tabela existir no
 * banco não basta — o processo precisa ter sido reiniciado depois da migração. Sem esta conferência,
 * a chamada estoura um `TypeError` cru ("Cannot read properties of undefined") e quem lê o log não
 * tem a menor pista do que fazer.
 */
export function modeloPronto() {
  const c = portas.db;
  return !!(c?.ragnabotCapitaoConfig?.findUnique && c?.ragnabotCapitaoInteracao?.create
    && c?.ragnabotCapitaoDocumento?.findMany && c?.ragnabotCapitaoConsumoMes?.upsert);
}

function exigirModelo() {
  if (modeloPronto()) return;
  const e = new Error('As tabelas do agente de IA ainda não existem neste processo. '
    + 'Aplique prisma/sql/capitao/01-rb_capitao.sql e reinicie o serviço.');
  e.codigo = 'MODELO_AUSENTE';
  e.status = 503;
  throw e;
}
const agora = () => (portas.relogio?.agora ? new Date(portas.relogio.agora()) : new Date());

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2.C.2 — A FRONTEIRA. Uma função pura, sem banco e sem rede, para poder ser provada exaustivamente.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * QUEM RESPONDE ESTA MENSAGEM — a regra da fronteira, escrita uma vez só.
 *
 * É PURA de propósito: sem banco, sem rede, sem relógio. Só assim o teste consegue percorrer a
 * matriz inteira de estados e afirmar, por observação e não por leitura, que nunca há dois
 * responsáveis para a mesma mensagem.
 *
 * @param {object} e estado da conversa no instante da mensagem
 * @param {boolean} e.interruptorMestre   `CAPITAO_ATIVO`
 * @param {boolean} e.ativoNaEmpresa      `RagnabotCapitaoConfig.ativo`
 * @param {boolean} e.conversaComHumano   a conversa já tem atendente (`cwAssigneeId`)
 * @param {boolean} e.pedidoDoNo          o nó `agente_ia` do fluxo pediu a IA de propósito
 * @param {boolean} e.execucaoViva        há execução de fluxo viva nesta conversa
 * @param {boolean} e.fluxoTemSaida       o fluxo tem para onde ir com o que o cliente disse
 * @param {string|null} e.acaoDoResolvedor `iniciar_fluxo` | `so_mensagem` | `fila_humana` | null
 * @param {boolean} e.dentroDoTeto        ainda cabe no teto do mês
 * @param {boolean} e.temBaseDeConhecimento a empresa tem ao menos um documento sincronizado
 * @param {number}  e.respostasSeguidas   quantas vezes a IA falou seguidas nesta conversa
 * @param {number}  e.maxRespostasSeguidas teto de falas seguidas
 * @param {boolean} e.mensagemDeCliente   false para evento de controle/eco nosso
 * @returns {{quem:string, motivo:string, capitaoPodia:boolean}}
 */
export function decidirQuemResponde(e = {}) {
  const est = {
    interruptorMestre: false,
    ativoNaEmpresa: false,
    conversaComHumano: false,
    pedidoDoNo: false,
    execucaoViva: false,
    fluxoTemSaida: false,
    acaoDoResolvedor: null,
    dentroDoTeto: true,
    temBaseDeConhecimento: true,
    respostasSeguidas: 0,
    maxRespostasSeguidas: 3,
    mensagemDeCliente: true,
    ...e,
  };

  // Por que a IA NÃO poderia falar, se fosse chamada. Calculado uma vez e reaproveitado: assim o
  // motivo que aparece no log é o motivo REAL, e não "fila_humana" genérico.
  const impedimento = (() => {
    if (!est.interruptorMestre) return 'capitao_desligado_no_ambiente';
    if (!est.ativoNaEmpresa) return 'capitao_desligado_na_empresa';
    if (!est.dentroDoTeto) return 'teto_do_mes_estourado';
    if (!est.temBaseDeConhecimento) return 'sem_base_de_conhecimento';
    if (est.respostasSeguidas >= est.maxRespostasSeguidas) return 'muitas_respostas_seguidas';
    return null;
  })();
  const capitaoPodia = impedimento === null;

  const resposta = (quem, motivo) => ({ quem, motivo, capitaoPodia });

  // 0. Não é fala de cliente: ninguém responde. Tratar evento de controle como pergunta é como a
  //    saudação sai no gatilho errado.
  if (!est.mensagemDeCliente) return resposta(QUEM_RESPONDE.NINGUEM, 'nao_e_mensagem_de_cliente');

  // 1. TEM GENTE NA CONVERSA. Vence tudo, inclusive pedido explícito do fluxo. Robô falando por
  //    cima do atendente é o defeito que mais custa confiança — e o cliente lê duas respostas.
  if (est.conversaComHumano) return resposta(QUEM_RESPONDE.HUMANO, 'conversa_com_atendente');

  // 2. O FLUXO PEDIU A IA de propósito (nó `agente_ia`). Aqui a IA não está invadindo: ela foi
  //    convidada, e o autor do fluxo desenhou a saída para quando ela não puder atender.
  if (est.pedidoDoNo) {
    return capitaoPodia
      ? resposta(QUEM_RESPONDE.CAPITAO, 'no_agente_ia')
      : resposta(QUEM_RESPONDE.HUMANO, impedimento);
  }

  // 3. FLUXO VIVO E COM SAÍDA: é dele, e ponto. Este é o coração da regra "o fluxo atende primeiro".
  if (est.execucaoViva && est.fluxoTemSaida) return resposta(QUEM_RESPONDE.FLUXO, 'fluxo_tem_saida');

  // 4. FLUXO VIVO E SEM SAÍDA: é exatamente a brecha que a IA existe para cobrir. Sem ela, o
  //    cliente ouviria "não entendi" pela terceira vez e desistiria.
  if (est.execucaoViva && !est.fluxoTemSaida) {
    return capitaoPodia
      ? resposta(QUEM_RESPONDE.CAPITAO, 'fluxo_sem_saida')
      : resposta(QUEM_RESPONDE.HUMANO, impedimento);
  }

  // 5. SEM FLUXO VIVO — quem manda é o resolvedor de entrada (o mesmo de sempre).
  if (est.acaoDoResolvedor === 'iniciar_fluxo') return resposta(QUEM_RESPONDE.FLUXO, 'resolvedor_iniciar_fluxo');
  // `so_mensagem` (almoço, feriado, fora de hora) é resposta da AUTOMAÇÃO, não da IA. Deixar a IA
  // falar aqui produziria as duas mensagens — "voltamos às 13h" e um parágrafo de IA.
  if (est.acaoDoResolvedor === 'so_mensagem') return resposta(QUEM_RESPONDE.FLUXO, 'resolvedor_so_mensagem');

  if (est.acaoDoResolvedor === 'fila_humana') {
    return capitaoPodia
      ? resposta(QUEM_RESPONDE.CAPITAO, 'antes_da_fila_humana')
      : resposta(QUEM_RESPONDE.HUMANO, impedimento);
  }

  // 6. Não sei o que é: gente. Nunca fica sem dono.
  return resposta(QUEM_RESPONDE.HUMANO, 'sem_decisao_do_resolvedor');
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO POR EMPRESA (2.C.1, 2.C.7)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Config da empresa, com os padrões da casa quando a linha ainda não existe. */
export async function configDaEmpresa(tenantId) {
  exigirTenant(tenantId);
  // Modelo ausente NÃO derruba a leitura: devolve o padrão (desligado), que é a falha fechada.
  const linha = modeloPronto()
    ? await db().ragnabotCapitaoConfig.findUnique({ where: { tenantId } }).catch(() => null)
    : null;
  return linha ?? {
    tenantId,
    ativo: false,
    nomeAgente: 'Assistente',
    tom: 'cordial',
    saudacao: null,
    assinatura: null,
    idioma: 'pt_BR',
    assistenteExternoId: null,
    modelo: null,
    tetoRespostasMes: null,
    tetoCustoCentavosMes: null,
    confiancaMinima: 0.55,
    maxRespostasSeguidas: 3,
    _virtual: true, // não existe no banco ainda; quem lê sabe disso
  };
}

/**
 * Liga/desliga e ajusta a marca do agente daquela empresa (2.C.7 — nome e tom são da EMPRESA
 * CLIENTE, não da Ragnatela).
 *
 * ⚠️ Ligar aqui NÃO liga a boca do agente sozinho: o interruptor mestre do ambiente continua
 * mandando. É de propósito — o dono decide a licença uma vez, não empresa por empresa.
 */
export async function definirConfig(tenantId, dados = {}, { userId = null } = {}) {
  exigirTenant(tenantId);
  exigirModelo();
  const patch = {};
  if (typeof dados.ativo === 'boolean') patch.ativo = dados.ativo;
  if (dados.nomeAgente !== undefined) patch.nomeAgente = textoCurto(dados.nomeAgente, 60, 'Assistente');
  if (dados.tom !== undefined) {
    const t = String(dados.tom || '').trim();
    if (!TONS.includes(t)) throw erroDeUso(`Tom inválido: "${t}". Aceitos: ${TONS.join(', ')}.`);
    patch.tom = t;
  }
  if (dados.saudacao !== undefined) patch.saudacao = textoCurto(dados.saudacao, 400, null);
  if (dados.assinatura !== undefined) patch.assinatura = textoCurto(dados.assinatura, 200, null);
  if (dados.idioma !== undefined) patch.idioma = textoCurto(dados.idioma, 10, 'pt_BR');
  if (dados.modelo !== undefined) patch.modelo = textoCurto(dados.modelo, 80, null);
  if (dados.assistenteExternoId !== undefined) patch.assistenteExternoId = textoCurto(dados.assistenteExternoId, 80, null);
  if (dados.tetoRespostasMes !== undefined) patch.tetoRespostasMes = inteiroOuNulo(dados.tetoRespostasMes);
  if (dados.tetoCustoCentavosMes !== undefined) patch.tetoCustoCentavosMes = inteiroOuNulo(dados.tetoCustoCentavosMes);
  if (dados.confiancaMinima !== undefined) {
    const c = Number(dados.confiancaMinima);
    if (!Number.isFinite(c) || c < 0 || c > 1) throw erroDeUso('confiancaMinima tem de ficar entre 0 e 1.');
    patch.confiancaMinima = c;
  }
  if (dados.maxRespostasSeguidas !== undefined) {
    const n = inteiroOuNulo(dados.maxRespostasSeguidas);
    if (n === null || n < 1) throw erroDeUso('maxRespostasSeguidas tem de ser 1 ou mais.');
    patch.maxRespostasSeguidas = n;
  }
  patch.atualizadoPorUserId = userId;

  const linha = await db().ragnabotCapitaoConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...patch },
    update: patch,
  });

  await auditar({
    tenantId,
    acao: patch.ativo === true ? 'capitao_ligado' : (patch.ativo === false ? 'capitao_desligado' : 'capitao_configurado'),
    userId,
    depois: { ativo: linha.ativo, nomeAgente: linha.nomeAgente, tom: linha.tom, tetoRespostasMes: linha.tetoRespostasMes },
  });
  return linha;
}

/** 2.C.7 — como o agente se apresenta. Nunca como produto de terceiro. */
export async function marcaDaEmpresa(tenantId) {
  const c = await configDaEmpresa(tenantId);
  return {
    nome: c.nomeAgente || 'Assistente',
    tom: c.tom || 'cordial',
    idioma: c.idioma || 'pt_BR',
    saudacao: c.saudacao || null,
    assinatura: c.assinatura || null,
  };
}

/**
 * Retrato do que está ligado para uma empresa. `verificadoNaPlataforma` diz se ALGUÉM chegou a
 * conferir isso do outro lado — hoje, sem chave da OpenAI, é sempre `false`, e é honesto que seja.
 */
export async function estadoDaEmpresa(tenantId) {
  const cfg = configuracaoCapitao();
  const c = await configDaEmpresa(tenantId);
  const [docs, consumo, teto] = await Promise.all([
    contarDocumentos(tenantId),
    consumoDoMes(tenantId),
    tetoDaEmpresa(tenantId),
  ]);
  return {
    tenantId,
    interruptorMestre: cfg.ativo,
    ativoNaEmpresa: c.ativo === true,
    // Só responde de verdade quando os DOIS estão ligados. Mostrar isso junto evita a tarde
    // perdida com "liguei na empresa e ele não fala".
    respondendo: cfg.ativo === true && c.ativo === true && docs.sincronizados > 0,
    marca: { nome: c.nomeAgente, tom: c.tom, idioma: c.idioma },
    documentos: docs,
    consumoDoMes: consumo,
    teto,
    plataformaConectada: !!portas.plataforma,
    verificadoNaPlataforma: false,
    assistenteExternoId: c.assistenteExternoId || null,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2.C.3 / 2.C.4 — BASE DE CONHECIMENTO POR EMPRESA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** "url|https://exemplo.com/faq" — NOT NULL e comparável; é o que o único do banco tranca. */
export function chaveDoDocumento({ tipo, origem }) {
  const t = String(tipo || '').trim().toLowerCase();
  const o = String(origem || '').trim().toLowerCase().replace(/\s+/gu, ' ').replace(/\/+$/u, '');
  return `${t}|${o}`;
}

/**
 * Registra (ou atualiza) um documento da base DAQUELA empresa.
 * O conteúdo NÃO é guardado: só o sha256, que responde "mudou?" sem virar cópia do material.
 */
export async function registrarDocumento(tenantId, doc = {}, { userId = null } = {}) {
  exigirTenant(tenantId);
  exigirModelo();
  const tipo = String(doc.tipo || '').trim().toLowerCase();
  if (!TIPOS_DOCUMENTO.includes(tipo)) {
    throw erroDeUso(`Tipo de documento inválido: "${doc.tipo}". Aceitos: ${TIPOS_DOCUMENTO.join(', ')}.`);
  }
  const origem = String(doc.origem || '').trim();
  if (!origem) throw erroDeUso('Documento sem origem (URL, nome do arquivo ou rótulo do texto).');
  if (tipo === 'url' && !/^https:\/\//i.test(origem)) {
    // http simples numa base que o agente lê é caminho para envenenar resposta com conteúdo
    // trocado no meio do caminho.
    throw erroDeUso('Documento do tipo url precisa começar com https://.');
  }

  const chaveDocumento = chaveDoDocumento({ tipo, origem });
  const conteudoHash = doc.conteudo ? sha256(String(doc.conteudo)) : (doc.conteudoHash ?? null);
  const dados = {
    titulo: textoCurto(doc.titulo, 200, origem.slice(0, 200)),
    tipo,
    origem,
    chaveDocumento,
    conteudoHash,
    tamanhoBytes: doc.conteudo ? Buffer.byteLength(String(doc.conteudo)) : inteiroOuNulo(doc.tamanhoBytes),
    status: STATUS_DOCUMENTO.PENDENTE,
    erro: null,
  };

  const linha = await db().ragnabotCapitaoDocumento.upsert({
    where: { tenantId_chaveDocumento: { tenantId, chaveDocumento } },
    create: { tenantId, criadoPorUserId: userId, ...dados },
    update: dados,
  });
  await auditar({ tenantId, acao: 'capitao_documento_registrado', userId, entidadeId: linha.id, depois: { tipo, origem } });
  return linha;
}

/** Lista SEMPRE filtrando por empresa. Não existe assinatura sem `tenantId` — de propósito. */
export async function documentosDaEmpresa(tenantId, { status = null, limite = 200 } = {}) {
  exigirTenant(tenantId);
  if (!modeloPronto()) return [];
  const where = { tenantId };
  if (status) where.status = String(status);
  return db().ragnabotCapitaoDocumento.findMany({
    where,
    orderBy: { criadoEm: 'desc' },
    take: Math.min(Number(limite) || 200, 1000),
  });
}

async function contarDocumentos(tenantId) {
  const lista = await documentosDaEmpresa(tenantId, { limite: 1000 }).catch(() => []);
  return {
    total: lista.length,
    sincronizados: lista.filter((d) => d.status === STATUS_DOCUMENTO.SINCRONIZADO).length,
    pendentes: lista.filter((d) => d.status === STATUS_DOCUMENTO.PENDENTE).length,
    comErro: lista.filter((d) => d.status === STATUS_DOCUMENTO.ERRO).length,
  };
}

/**
 * Empurra para a plataforma os documentos pendentes DESTA empresa.
 *
 * Sem porta de plataforma não inventa sucesso: devolve `enviados:0` e o motivo. Marcar como
 * "sincronizado" o que ninguém enviou seria a mentira mais cara deste arquivo — o agente
 * responderia do nada e ninguém saberia por quê.
 */
export async function sincronizarDocumentos(tenantId, { limite = 50 } = {}) {
  exigirTenant(tenantId);
  const pendentes = await documentosDaEmpresa(tenantId, { status: STATUS_DOCUMENTO.PENDENTE, limite });
  if (!portas.plataforma?.sincronizarDocumento) {
    return { ok: false, motivo: 'plataforma_indisponivel', pendentes: pendentes.length, enviados: 0, falhas: 0 };
  }

  let enviados = 0; let falhas = 0;
  for (const doc of pendentes) {
    try {
      const r = await portas.plataforma.sincronizarDocumento({
        tenantId, tipo: doc.tipo, origem: doc.origem, titulo: doc.titulo, externoId: doc.externoId ?? null,
      });
      await db().ragnabotCapitaoDocumento.update({
        where: { id: doc.id },
        data: {
          externoId: r?.externoId ? String(r.externoId) : doc.externoId,
          status: STATUS_DOCUMENTO.SINCRONIZADO,
          erro: null,
          sincronizadoEm: agora(),
        },
      });
      enviados += 1;
    } catch (e) {
      falhas += 1;
      await db().ragnabotCapitaoDocumento.update({
        where: { id: doc.id },
        data: { status: STATUS_DOCUMENTO.ERRO, erro: String(e?.message ?? e).slice(0, 400) },
      }).catch(() => {});
      log().warn(`[capitao] documento ${doc.id} não sincronizou: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  return { ok: falhas === 0, pendentes: pendentes.length, enviados, falhas };
}

/** Remove o documento — e só o da própria empresa. `updateMany` com `tenantId` no WHERE é a trava. */
export async function removerDocumento(tenantId, documentoId, { userId = null } = {}) {
  exigirTenant(tenantId);
  const r = await db().ragnabotCapitaoDocumento.updateMany({
    where: { id: String(documentoId), tenantId },
    data: { status: STATUS_DOCUMENTO.REMOVIDO, erro: null },
  });
  if (r.count === 0) return { ok: false, motivo: 'nao_encontrado_nesta_empresa' };
  if (portas.plataforma?.removerDocumento) {
    await portas.plataforma.removerDocumento({ tenantId, documentoId }).catch((e) => {
      log().warn(`[capitao] documento ${documentoId} removido aqui e NÃO lá: ${e.message}`);
    });
  }
  await auditar({ tenantId, acao: 'capitao_documento_removido', userId, entidadeId: String(documentoId) });
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2.C.5 — TETO DE CONSUMO E MEDIÇÃO DE CUSTO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** "AAAA-MM" — a mesma competência da cobrança, para os dois números conversarem. */
export function competenciaDe(data = new Date()) {
  const d = new Date(data);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * O teto EFETIVO da empresa: o menor entre o do plano (regra de produto, em código) e o acordo
 * individual (`RagnabotCapitaoConfig`). Nulo dos dois lados = sem teto — e aí o teto global do
 * ambiente é a última rede.
 */
export async function tetoDaEmpresa(tenantId) {
  exigirTenant(tenantId);
  const [cfg, tenant] = await Promise.all([
    configDaEmpresa(tenantId),
    db().ragnabotTenant?.findUnique
      ? db().ragnabotTenant.findUnique({ where: { id: tenantId } }).catch(() => null)
      : Promise.resolve(null),
  ]);

  let doPlano = null;
  const nomePlano = tenant?.plan ?? null;
  if (nomePlano && planoExiste(nomePlano)) {
    const lim = limitesDoPlano(nomePlano, tenant?.limits ?? null);
    doPlano = Number.isFinite(lim.iaRespostasMes) ? lim.iaRespostasMes : null;
  }

  const individual = Number.isFinite(cfg.tetoRespostasMes) ? cfg.tetoRespostasMes : null;
  const respostasMes = menorDefinido(doPlano, individual);
  return {
    respostasMes,
    custoCentavosMes: Number.isFinite(cfg.tetoCustoCentavosMes) ? cfg.tetoCustoCentavosMes : null,
    origem: { plano: doPlano, individual, nomePlano },
    globalRespostasMes: configuracaoCapitao().tetoGlobalRespostasMes || null,
  };
}

/** O consumo já gasto no mês. Vem do BANCO — contador em memória zera no reinício do pod. */
export async function consumoDoMes(tenantId, { data = new Date() } = {}) {
  exigirTenant(tenantId);
  const competencia = competenciaDe(data);
  const linha = modeloPronto()
    ? await db().ragnabotCapitaoConsumoMes
      .findUnique({ where: { tenantId_competencia: { tenantId, competencia } } })
      .catch(() => null)
    : null;
  return {
    competencia,
    respostas: linha?.respostas ?? 0,
    naoSabe: linha?.naoSabe ?? 0,
    recusadas: linha?.recusadas ?? 0,
    tokensEntrada: linha?.tokensEntrada ?? 0,
    tokensSaida: linha?.tokensSaida ?? 0,
    // ⚠️ ESTIMADO, não medido: a plataforma não devolve o custo real da chamada.
    custoEstimadoCentavos: linha?.custoCentavos ?? 0,
  };
}

/** Ainda cabe? Devolve o motivo junto, para o log dizer a verdade em vez de "fila humana". */
export async function dentroDoTeto(tenantId, { data = new Date() } = {}) {
  const [teto, consumo] = await Promise.all([tetoDaEmpresa(tenantId), consumoDoMes(tenantId, { data })]);
  if (teto.respostasMes !== null && consumo.respostas >= teto.respostasMes) {
    return { ok: false, motivo: 'teto_de_respostas_da_empresa', teto, consumo };
  }
  if (teto.custoCentavosMes !== null && consumo.custoEstimadoCentavos >= teto.custoCentavosMes) {
    return { ok: false, motivo: 'teto_de_custo_da_empresa', teto, consumo };
  }
  if (teto.globalRespostasMes) {
    const total = await respostasNoMesDaInstalacao(competenciaDe(data));
    if (total >= teto.globalRespostasMes) return { ok: false, motivo: 'teto_global_da_instalacao', teto, consumo };
  }
  return { ok: true, motivo: null, teto, consumo };
}

async function respostasNoMesDaInstalacao(competencia) {
  const linhas = await db().ragnabotCapitaoConsumoMes.findMany({ where: { competencia } }).catch(() => []);
  return linhas.reduce((soma, l) => soma + (l.respostas ?? 0), 0);
}

/** Custo ESTIMADO de uma resposta. O nome do campo carrega o aviso — não é medição. */
export function estimarCustoCentavos({ tokensEntrada = 0, tokensSaida = 0 } = {}) {
  const cfg = configuracaoCapitao();
  const porTokens = Math.round(((tokensEntrada + tokensSaida) / 1000) * cfg.custoPorMilTokensCentavos);
  return cfg.custoPorRespostaCentavos + porTokens;
}

/** Soma no contador do mês. `upsert` + `increment`: duas réplicas somando ao mesmo tempo não perdem. */
export async function registrarConsumo(tenantId, { respostas = 0, naoSabe = 0, recusadas = 0, tokensEntrada = 0, tokensSaida = 0, custoCentavos = 0, data = new Date() } = {}) {
  exigirTenant(tenantId);
  exigirModelo();
  const competencia = competenciaDe(data);
  return db().ragnabotCapitaoConsumoMes.upsert({
    where: { tenantId_competencia: { tenantId, competencia } },
    create: { tenantId, competencia, respostas, naoSabe, recusadas, tokensEntrada, tokensSaida, custoCentavos },
    update: {
      respostas: { increment: respostas },
      naoSabe: { increment: naoSabe },
      recusadas: { increment: recusadas },
      tokensEntrada: { increment: tokensEntrada },
      tokensSaida: { increment: tokensSaida },
      custoCentavos: { increment: custoCentavos },
    },
  });
}

/** Custo por ATENDIMENTO (o número que o dono pediu antes de abrir para todos). */
export async function custoPorAtendimento(tenantId, { de = null, ate = null } = {}) {
  exigirTenant(tenantId);
  if (!modeloPronto()) {
    return {
      atendimentos: 0, respostas: 0, custoEstimadoCentavos: 0, custoEstimadoPorAtendimentoCentavos: 0,
      aviso: 'tabelas do agente de IA ausentes neste processo',
    };
  }
  const where = { tenantId };
  if (de || ate) {
    where.criadoEm = {};
    if (de) where.criadoEm.gte = new Date(de);
    if (ate) where.criadoEm.lte = new Date(ate);
  }
  const linhas = await db().ragnabotCapitaoInteracao.findMany({ where, take: 5000 }).catch(() => []);
  const conversas = new Set();
  let custo = 0; let respostas = 0;
  for (const l of linhas) {
    if (l.cwConversationId != null) conversas.add(`${l.cwAccountId}:${l.cwConversationId}`);
    custo += l.custoCentavos ?? 0;
    if (l.resultado === RESULTADOS_IA.RESPONDEU) respostas += 1;
  }
  const atendimentos = conversas.size;
  return {
    atendimentos,
    respostas,
    custoEstimadoCentavos: custo,
    custoEstimadoPorAtendimentoCentavos: atendimentos ? Math.round(custo / atendimentos) : 0,
    // Repetindo o aviso onde ele será lido: este é um número CALCULADO a partir de preço
    // configurado, não faturado pelo provedor.
    aviso: 'custo ESTIMADO (CAPITAO_CUSTO_*), não faturado pelo provedor',
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A RESERVA — a trava física contra duas respostas
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** `entrada:<id>` ou `no:<execucao>:<no>:<visita>`. NOT NULL sempre. */
export function chaveDaResposta({ entradaId = null, execucaoId = null, noId = null, visitaSeq = 0 } = {}) {
  if (entradaId) return `entrada:${entradaId}`;
  if (execucaoId && noId) return `no:${execucaoId}:${noId}:${visitaSeq ?? 0}`;
  throw erroDeUso('sem entradaId nem (execucaoId + noId): não há como reservar o direito de responder');
}

/**
 * Reserva o direito de responder ESTA mensagem. Devolve `{ok:false, motivo:'ja_reservada'}` quando
 * outra réplica chegou primeiro — e aí este processo CALA A BOCA. É esta linha, e não o bom senso
 * de quem escreve o código, que garante uma resposta só.
 */
export async function reservarResposta(alvo = {}) {
  exigirModelo();
  const chave = chaveDaResposta(alvo);
  try {
    const linha = await db().ragnabotCapitaoInteracao.create({
      data: {
        chave,
        tenantId: alvo.tenantId,
        cwAccountId: alvo.cwAccountId ?? null,
        cwConversationId: alvo.cwConversationId ?? null,
        entradaId: alvo.entradaId ?? null,
        execucaoId: alvo.execucaoId ?? null,
        noId: alvo.noId ?? null,
        resultado: RESULTADOS_IA.RESERVADO,
        perguntaHash: alvo.pergunta ? sha256(String(alvo.pergunta)) : null,
      },
    });
    return { ok: true, chave, interacaoId: linha.id };
  } catch (e) {
    if (e?.code === 'P2002') return { ok: false, motivo: 'ja_reservada', chave };
    throw e;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O CAMINHO PRINCIPAL — perguntar ao agente, com todas as travas no lugar
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A IA responde — ou diz honestamente que não vai responder.
 *
 * ⚠️ NUNCA devolve texto E manda para o humano ao mesmo tempo: o retorno tem `quem`, e `quem` é um
 * valor só. Quem chama envia o texto quando `quem === 'capitao'` e transfere quando é `'humano'`.
 *
 * @returns {Promise<{quem:string, motivo:string, texto:(string|null), interacaoId:(string|null),
 *                    confianca:(number|null), custoEstimadoCentavos:number}>}
 */
export async function responderPorIA(pedido = {}) {
  const {
    tenantId, cwAccountId = null, cwConversationId = null, entradaId = null,
    execucaoId = null, noId = null, visitaSeq = 0, pergunta = '',
    conversaComHumano = false, execucaoViva = false, fluxoTemSaida = false,
    pedidoDoNo = false, acaoDoResolvedor = null, respostasSeguidas = 0,
    mensagemDeCliente = true,
  } = pedido;
  exigirTenant(tenantId);

  const cfg = configuracaoCapitao();
  const conf = await configDaEmpresa(tenantId);
  const docs = await contarDocumentos(tenantId);
  const teto = await dentroDoTeto(tenantId);

  const decisao = decidirQuemResponde({
    interruptorMestre: cfg.ativo,
    ativoNaEmpresa: conf.ativo === true,
    conversaComHumano,
    pedidoDoNo,
    execucaoViva,
    fluxoTemSaida,
    acaoDoResolvedor,
    dentroDoTeto: teto.ok,
    temBaseDeConhecimento: docs.sincronizados > 0,
    respostasSeguidas,
    maxRespostasSeguidas: conf.maxRespostasSeguidas ?? 3,
    mensagemDeCliente,
  });

  if (decisao.quem !== QUEM_RESPONDE.CAPITAO) {
    // Recusa CONTADA: sem isto ninguém descobre que o teto está segurando metade das conversas.
    if (decisao.motivo === 'teto_do_mes_estourado') {
      await registrarConsumo(tenantId, { recusadas: 1 }).catch(() => {});
    }
    return { quem: decisao.quem, motivo: decisao.motivo, texto: null, interacaoId: null, confianca: null, custoEstimadoCentavos: 0 };
  }

  // A RESERVA vem ANTES de perguntar: se o agente demora 8 s e a mensagem é reentregue nesse meio,
  // a segunda tentativa morre aqui em vez de produzir uma segunda resposta.
  const reserva = await reservarResposta({ tenantId, cwAccountId, cwConversationId, entradaId, execucaoId, noId, visitaSeq, pergunta });
  if (!reserva.ok) {
    return { quem: QUEM_RESPONDE.NINGUEM, motivo: 'ja_respondida_por_outra_replica', texto: null, interacaoId: null, confianca: null, custoEstimadoCentavos: 0 };
  }

  if (!portas.plataforma?.perguntar) {
    await encerrarInteracao(reserva.interacaoId, { resultado: RESULTADOS_IA.ERRO, erro: 'porta da plataforma ausente' });
    return { quem: QUEM_RESPONDE.HUMANO, motivo: 'plataforma_indisponivel', texto: null, interacaoId: reserva.interacaoId, confianca: null, custoEstimadoCentavos: 0 };
  }

  const marca = await marcaDaEmpresa(tenantId);
  const documentos = await documentosDaEmpresa(tenantId, { status: STATUS_DOCUMENTO.SINCRONIZADO, limite: 200 });
  const idsDaEmpresa = new Set(documentos.map((d) => String(d.externoId ?? d.id)));
  const comecou = Date.now();

  let r = null;
  try {
    r = await portas.plataforma.perguntar({
      tenantId,
      pergunta: String(pergunta ?? ''),
      marca,
      documentos: documentos.map((d) => ({ id: d.id, externoId: d.externoId, titulo: d.titulo, tipo: d.tipo })),
      conversa: { cwAccountId, cwConversationId },
      tempoLimiteMs: cfg.tempoLimiteMs,
    });
  } catch (e) {
    await encerrarInteracao(reserva.interacaoId, { resultado: RESULTADOS_IA.ERRO, erro: String(e?.message ?? e).slice(0, 400), latenciaMs: Date.now() - comecou });
    return { quem: QUEM_RESPONDE.HUMANO, motivo: 'erro_no_agente', texto: null, interacaoId: reserva.interacaoId, confianca: null, custoEstimadoCentavos: 0 };
  }

  const latenciaMs = Date.now() - comecou;
  const custoEstimadoCentavos = estimarCustoCentavos({ tokensEntrada: r?.tokensEntrada ?? 0, tokensSaida: r?.tokensSaida ?? 0 });

  // ⚠️ ISOLAMENTO, SEGUNDA CAMADA. Se veio na resposta um documento que NÃO é desta empresa, a
  // resposta inteira é descartada. Vazar conteúdo de uma empresa na conversa de outra é o pior
  // defeito possível num produto multi-inquilino — e é melhor transferir a um humano do que
  // entregar uma resposta que pode carregar dado alheio.
  const usados = Array.isArray(r?.documentosUsados) ? r.documentosUsados : [];
  const intruso = usados.map((d) => String(d?.externoId ?? d?.id ?? d)).find((id) => id && !idsDaEmpresa.has(id));
  if (intruso) {
    log().error(`[capitao] resposta descartada: documento fora da empresa ${tenantId} (isolamento)`);
    await encerrarInteracao(reserva.interacaoId, {
      resultado: RESULTADOS_IA.RECUSADO_ISOLAMENTO, erro: 'documento de outra empresa na resposta', latenciaMs,
    });
    await auditar({ tenantId, acao: 'capitao_resposta_descartada_isolamento', entidadeId: reserva.interacaoId });
    return { quem: QUEM_RESPONDE.HUMANO, motivo: 'isolamento_violado', texto: null, interacaoId: reserva.interacaoId, confianca: null, custoEstimadoCentavos: 0 };
  }

  const confianca = Number.isFinite(r?.confianca) ? r.confianca : null;
  const texto = typeof r?.texto === 'string' ? r.texto.trim() : '';
  const naoSabe = r?.naoSei === true || !texto
    || (confianca !== null && confianca < (conf.confiancaMinima ?? 0.55));

  if (naoSabe) {
    await encerrarInteracao(reserva.interacaoId, {
      resultado: RESULTADOS_IA.NAO_SABE, confianca, latenciaMs, modelo: r?.modelo ?? null,
      tokensEntrada: r?.tokensEntrada ?? null, tokensSaida: r?.tokensSaida ?? null,
      custoCentavos: custoEstimadoCentavos, documentosUsados: usados.length,
    });
    await registrarConsumo(tenantId, { naoSabe: 1, tokensEntrada: r?.tokensEntrada ?? 0, tokensSaida: r?.tokensSaida ?? 0, custoCentavos: custoEstimadoCentavos });
    // "Não sei" NÃO é resposta ao cliente: é entrega ao humano. Mandar "não consegui entender"
    // e AINDA transferir é a duplicidade que este arquivo existe para impedir.
    return { quem: QUEM_RESPONDE.HUMANO, motivo: 'agente_nao_sabe', texto: null, interacaoId: reserva.interacaoId, confianca, custoEstimadoCentavos };
  }

  await encerrarInteracao(reserva.interacaoId, {
    resultado: RESULTADOS_IA.RESPONDEU, confianca, latenciaMs, modelo: r?.modelo ?? null,
    respostaChars: texto.length, tokensEntrada: r?.tokensEntrada ?? null, tokensSaida: r?.tokensSaida ?? null,
    custoCentavos: custoEstimadoCentavos, documentosUsados: usados.length,
  });
  await registrarConsumo(tenantId, { respostas: 1, tokensEntrada: r?.tokensEntrada ?? 0, tokensSaida: r?.tokensSaida ?? 0, custoCentavos: custoEstimadoCentavos });

  return { quem: QUEM_RESPONDE.CAPITAO, motivo: 'respondeu', texto: assinar(texto, marca), interacaoId: reserva.interacaoId, confianca, custoEstimadoCentavos };
}

/** A marca da EMPRESA CLIENTE fecha a mensagem (2.C.7). Nunca o nome do fornecedor. */
function assinar(texto, marca) {
  if (!marca?.assinatura) return texto;
  return `${texto}\n\n${marca.assinatura}`;
}

async function encerrarInteracao(id, dados) {
  if (!id) return null;
  return db().ragnabotCapitaoInteracao.update({ where: { id }, data: dados }).catch((e) => {
    log().warn(`[capitao] não consegui fechar a interação ${id}: ${e.message}`);
    return null;
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// MIUDEZAS
// ────────────────────────────────────────────────────────────────────────────────────────────────
function sha256(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }

function exigirTenant(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw erroDeUso('tenantId é obrigatório: sem ele não existe isolamento entre empresas');
  }
}

function erroDeUso(mensagem) {
  const e = new Error(mensagem);
  e.codigo = 'USO_INVALIDO';
  e.status = 400;
  return e;
}

function textoCurto(v, teto, padrao) {
  if (v === null || v === undefined || String(v).trim() === '') return padrao;
  return String(v).trim().slice(0, teto);
}

function inteiroOuNulo(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function menorDefinido(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}

async function auditar({ tenantId, acao, userId = null, entidadeId = null, depois = null }) {
  if (!portas.auditoria?.registrar) return;
  await portas.auditoria.registrar({
    tenantId, atorTipo: userId ? 'user' : 'sistema', atorId: userId,
    categoria: 'configuracao', acao, entidade: 'capitao', entidadeId, depois,
  }).catch(() => {});
}

export default {
  QUEM_RESPONDE, RESULTADOS_IA, STATUS_DOCUMENTO, CAMINHOS,
  configuracaoCapitao, interruptorLigado, configurarCapitao, portasDoCapitao, modeloPronto,
  decidirQuemResponde,
  configDaEmpresa, definirConfig, marcaDaEmpresa, estadoDaEmpresa,
  chaveDoDocumento, registrarDocumento, documentosDaEmpresa, sincronizarDocumentos, removerDocumento,
  competenciaDe, tetoDaEmpresa, consumoDoMes, dentroDoTeto, estimarCustoCentavos, registrarConsumo,
  custoPorAtendimento, chaveDaResposta, reservarResposta, responderPorIA,
};
