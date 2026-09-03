// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONEXÕES — o cartão por canal, a cota, o reinício, a transferência e o registro por canal.
// Contrato S6 (02/09/2026), doc 34 §F9.2.3 · §F9.2.4 · §F9.2.5 · §F9.2.6 · §F9.2.7.
//
// ── ⚠️ MEDIDO ANTES DE ESCREVER (a regra que mais economizou trabalho neste plano) ─────────────
// Quase tudo que esta frente pedia JÁ EXISTIA, e o que faltava era leitura, não motor:
//   · `RagnabotInbox`                      cadastro das conexões, com reconciliação automática a
//                                          cada 15 min (`sincronizarCaixasDeTodasAsEmpresas`)
//   · `config/ragnabot-plans.js`           `cabeMaisUmaCaixa()` — a REGRA da cota, já aplicada em
//                                          `criarCaixa`. Faltava a LEITURA (limite × ativos × uso)
//   · `RagnabotFluxoEfeito`                httpStatus, erro e resumo de CADA envio ao canal —
//                                          é o «log de requisição» do §F9.2.6, sem tabela nova
//   · `RagnabotConversa`                   a projeção da fila, com `cwInboxId` — é por ela que a
//                                          transferência entre conexões acha o que mover
//   · `esquecerCanais()` (canal.porta)     o cache de 60 s que o «reiniciar conexão» precisa soltar
// Este arquivo NÃO recria nada disso. Ele lê, compõe e escreve o que faltava.
//
// ── ⛔ A HONESTIDADE QUE ESTA FRENTE EXIGE, escrita aqui e no relatório ─────────────────────────
// 1. **Transferir atendimento entre conexões (§F9.2.4).** A plataforma de atendimento NÃO expõe
//    rota para trocar a caixa de entrada de uma conversa existente (`PATCH …/conversations/:id`
//    aceita status, prioridade e times — não `inbox_id`). Isto é leitura do contrato da API, NÃO
//    medição em produção. Então o que esta função move de verdade é: o NOSSO roteamento (a projeção
//    da fila, que é o que a tela do agente lê e o que o motor consulta), a ORIGEM registrada em
//    cada conversa, e um AVISO INTERNO na conversa lá fora. O histórico é preservado porque nada é
//    apagado — `origemCwInboxId` guarda de onde veio. `moveuNaPlataforma` fica `false`, e é assim
//    que o relatório e a tela dizem a verdade em vez de fingirem sucesso.
// 2. **Reiniciar conexão (§F9.2.5).** Para `meta_direto` e `nativo` não há sessão a religar: a
//    credencial é estática, e «reiniciar» significa soltar o nosso cache, remedir o estado e
//    reconciliar o cadastro — que é operação real e útil, e é o que fazemos. Para `whatsmeow` e
//    `terceiro` existe reinício de verdade do outro lado, e nós ainda NÃO temos transporte para
//    esses provedores: a função devolve `naoDisponivel` com a frase do porquê. Nunca um sucesso
//    silencioso — o pior resultado possível numa tela de suporte é o botão que pisca «pronto» sem
//    ter feito nada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import { CANAIS, cabeMaisUmaCaixa } from '../config/ragnabot-plans.js';
import * as provedores from './ragnabot-provedor.service.js';

/** Estados possíveis de uma conexão. `desconhecido` é o padrão e é honesto. */
export const ESTADOS = Object.freeze(['conectado', 'desconectado', 'degradado', 'desconhecido']);

/** Os estados de conversa que a transferência aceita mover. `resolvida` fica de fora por padrão:
 *  mover atendimento encerrado só embaralha o histórico sem ajudar ninguém. */
export const ESTADOS_TRANSFERIVEIS = Object.freeze(['atendendo', 'aguardando', 'chatbot', 'adiada']);

// ── PORTAS INJETÁVEIS ──────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaPadrao,
  log: loggerPadrao,
  agora: () => new Date(),
  /** `ragnabot-tenant.service.js` — carregado sob demanda para não criar ciclo. */
  tenants: null,
  /** `ragnabot-chatwoot.porta.js` — para o aviso interno na conversa. */
  chatwoot: null,
  /** `esquecerCanais` de `ragnabot-canal.porta.js` — o cache que o reinício solta. */
  esquecerCanais: null,
  /** `ragnabot-webhook-saida.service.js#enfileirar` — avisar o sistema do cliente. Opcional. */
  emitirEvento: null,
  /** `ragnabot-auditoria.service.js`. Injetável para o teste não escrever no banco de verdade. */
  auditoria: null,
};

export function configurarConexoes(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida em conexões: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDasConexoes() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log || loggerPadrao;
const agora = () => portas.agora();

async function tenants() {
  if (portas.tenants) return portas.tenants;
  return import('./ragnabot-tenant.service.js');
}
async function chatwoot() {
  if (portas.chatwoot) return portas.chatwoot;
  return (await import('./ragnabot-chatwoot.porta.js')).default;
}

function erro(mensagem, status = 400, code = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function exigirEmpresa(tenantId) {
  const t = String(tenantId || '').trim();
  if (!t) throw erro('Empresa não informada.', 400);
  const linha = await db().ragnabotTenant.findUnique({ where: { id: t } });
  if (!linha) throw erro('Empresa não encontrada.', 404, 'EMPRESA_NAO_ENCONTRADA');
  return linha;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. O CARTÃO DA CONEXÃO (F9.2.3)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A forma que a tela de Conexões consome.
 *
 * ⛔ `credentialFingerprint` sai (é sha256 truncado, existe justamente para auditar sem guardar o
 * segredo); `provedorConfig` NÃO sai cru — só a url base, porque ela é endereço, não segredo.
 */
export function comoCartao(linha, { agoraMs = Date.now() } = {}) {
  if (!linha) return null;
  const meta = (linha.metadata && typeof linha.metadata === 'object' && !Array.isArray(linha.metadata)) ? linha.metadata : {};
  const cfg = (linha.provedorConfig && typeof linha.provedorConfig === 'object' && !Array.isArray(linha.provedorConfig)) ? linha.provedorConfig : {};
  const canal = linha.channelType;
  const idProvedor = provedores.normalizarProvedor(linha.provedor, canal);
  const ficha = provedores.provedor(idProvedor);
  const ativa = linha.removedAt == null;

  return {
    id: linha.id,
    tenantId: linha.tenantId,
    // ⚠️ É ESTE número que se digita ao amarrar um fluxo, e foi o campo errado (id da CAIXA no
    // lugar do da CONTA) que originou o contrato das caixas. Ele vem primeiro no cartão.
    cwInboxId: linha.cwInboxId,
    nome: linha.name,
    tipoCanal: canal,
    canalRotulo: CANAIS[canal] || canal,
    // «número» é o que o operador procura no cartão: o telefone, o e-mail ou o endereço do site.
    identificador: linha.identifier,

    provedor: idProvedor,
    provedorRotulo: ficha?.rotulo || idProvedor,
    provedorOficial: ficha?.oficial === true,
    provedorRef: linha.provedorRef || null,
    provedorUrl: cfg.urlBase || null,
    // Uma frase em português sobre o que este par canal+provedor consegue: sem ela,
    // «interativo: false» não diz a ninguém que o menu vai virar lista numerada.
    capacidadeResumo: provedores.resumirCapacidade(canal, idProvedor),
    capacidade: provedores.capacidadeEfetiva(canal, idProvedor),

    // ── O SINAL ──────────────────────────────────────────────────────────────────────────────
    ativa,
    estado: ativa ? (linha.estado || 'desconhecido') : 'desconectado',
    estadoDetalhe: ativa ? (linha.estadoDetalhe || null) : 'Conexão removida da plataforma.',
    estadoEm: linha.estadoEm || null,
    // ⚠️ A IDADE DA MEDIÇÃO, e não só o estado. «conectado» medido há três dias é uma afirmação
    // sobre o passado; numa tela de operação isso é pior que «desconhecido», porque parece atual.
    estadoIdadeMin: linha.estadoEm ? Math.max(0, Math.round((agoraMs - new Date(linha.estadoEm).getTime()) / 60000)) : null,

    // ── ÚLTIMA ATUALIZAÇÃO (coluna da tela 40) ───────────────────────────────────────────────
    atualizadaEm: linha.updatedAt,
    sincronizadaEm: meta.sincronizadoEm ?? null,
    reiniciadaEm: linha.reiniciadaEm || null,
    removidaEm: linha.removedAt || null,

    phoneNumberId: meta.phoneNumberId ?? null,
    wabaId: meta.wabaId ?? null,
    credencial: linha.credentialFingerprint || null,
    criadaEm: linha.createdAt,
  };
}

/** As conexões da empresa, prontas para a tela. */
export async function listarConexoes(tenantId, { incluirRemovidas = true } = {}) {
  const t = String(tenantId || '').trim();
  if (!t) throw erro('Empresa não informada.', 400);
  const where = { tenantId: t };
  if (!incluirRemovidas) where.removedAt = null;
  const linhas = await db().ragnabotInbox.findMany({
    where, orderBy: [{ removedAt: 'asc' }, { cwInboxId: 'asc' }],
  });
  const ms = agora().getTime();
  return linhas.map((l) => comoCartao(l, { agoraMs: ms }));
}

async function exigirConexao(tenantId, cwInboxId) {
  const id = Number(cwInboxId);
  if (!Number.isInteger(id) || id < 1) throw erro('O id da conexão tem de ser um número inteiro positivo.', 400);
  const linha = await db().ragnabotInbox.findFirst({ where: { tenantId: String(tenantId || ''), cwInboxId: id } });
  // 404 e não 403: não confirmamos que esta conexão existe noutra empresa.
  if (!linha) throw erro(`Não existe conexão ${id} nesta empresa.`, 404, 'CONEXAO_NAO_ENCONTRADA');
  return linha;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. PROVEDOR DA CONEXÃO (F9.2.2 — a escrita)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Troca QUEM OPERA uma conexão. É um `UPDATE` de coluna, e é esse o ponto inteiro da camada: o
 * motor de fluxo e o adaptador de canal não mudam uma linha.
 *
 * ⛔ NÃO recebe credencial. Segredo de provedor vive cifrado (`RagnabotFluxoSegredo`) ou na
 * plataforma — nunca num campo de cadastro de conexão, e nunca no corpo desta chamada.
 */
export async function definirProvedor(tenantId, cwInboxId, { provedor: idProvedor, provedorRef = null, urlBase = null } = {}, { ator = null, req = null } = {}) {
  const linha = await exigirConexao(tenantId, cwInboxId);
  const veredito = provedores.combina(linha.channelType, idProvedor);
  if (!veredito.permitido) throw erro(veredito.motivo, 400, 'PROVEDOR_INCOMPATIVEL');

  const anterior = provedores.normalizarProvedor(linha.provedor, linha.channelType);
  const cfgAntiga = (linha.provedorConfig && typeof linha.provedorConfig === 'object') ? linha.provedorConfig : {};
  const cfg = { ...cfgAntiga };
  if (urlBase !== null && urlBase !== undefined) cfg.urlBase = String(urlBase).trim() || null;

  const atualizada = await db().ragnabotInbox.update({
    where: { id: linha.id },
    data: {
      provedor: idProvedor,
      provedorRef: provedorRef === null ? linha.provedorRef : (String(provedorRef).trim() || null),
      provedorConfig: Object.keys(cfg).length ? cfg : null,
      // Trocar de provedor invalida o que sabíamos do estado: o novo operador ainda não foi medido.
      estado: 'desconhecido',
      estadoDetalhe: `Provedor trocado de "${anterior}" para "${idProvedor}" — o estado será remedido.`,
      estadoEm: agora(),
    },
  });

  // O cache de canal guarda a capacidade por conversa por 60 s. Sem soltá-lo, a conversa em curso
  // continuaria despachando pela capacidade do provedor ANTIGO por até um minuto.
  await soltarCache();

  log().warn?.(`[conexao] provedor da conexão ${linha.cwInboxId} (empresa ${linha.tenantId}) trocado: ${anterior} → ${idProvedor}`);
  await auditar({
    tenantId: linha.tenantId, ator, req, acao: 'ragnabot.conexao.provedor',
    entidadeId: String(linha.cwInboxId),
    descricao: `Provedor da conexão ${linha.cwInboxId} ("${linha.name}") trocado de "${anterior}" para "${idProvedor}"`,
    antes: { provedor: anterior }, depois: { provedor: idProvedor },
  });
  return comoCartao(atualizada, { agoraMs: agora().getTime() });
}

/** As opções de provedor para o canal desta conexão — o que a tela oferece no seletor. */
export async function opcoesDeProvedor(tenantId, cwInboxId) {
  const linha = await exigirConexao(tenantId, cwInboxId);
  return {
    cwInboxId: linha.cwInboxId,
    tipoCanal: linha.channelType,
    atual: provedores.normalizarProvedor(linha.provedor, linha.channelType),
    opcoes: provedores.opcoesParaCanal(linha.channelType),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. COTA DE CANAIS POR EMPRESA (F9.2.7)
// ════════════════════════════════════════════════════════════════════════════════════════════════

function porcentagem(usados, limite) {
  if (!Number.isFinite(limite) || limite <= 0) return null; // sem limite conhecido, não invente %
  return Math.round((usados / limite) * 1000) / 10; // uma casa decimal
}

/**
 * Limite × Ativos × Uso %, no total e por canal — a leitura da tela 39 do doc 34.
 *
 * ⚠️ Conta o NOSSO cadastro (`removedAt: null`), não a plataforma. É de propósito: é o cadastro que
 * o motor consulta em execução, e é ele que a cota tem de refletir. Onde os dois divergirem, quem
 * conserta é a sincronização — e a tela de Caixas de entrada existe exatamente para isso.
 */
export async function cotaDeCanais(tenantId) {
  const t = await exigirEmpresa(tenantId);
  const { limitesVigentes } = await tenants();
  const limites = limitesVigentes(t);
  const ativas = await db().ragnabotInbox.findMany({
    where: { tenantId: t.id, removedAt: null },
    select: { channelType: true, provedor: true },
  });

  const porCanal = Object.keys(CANAIS).map((canal) => {
    const usados = ativas.filter((c) => c.channelType === canal).length;
    const incluido = (limites.canais || []).includes(canal);
    const limite = incluido ? (limites.caixasPorCanal?.[canal] ?? null) : 0;
    return {
      canal,
      canalRotulo: CANAIS[canal],
      incluidoNoPlano: incluido,
      limite,
      ativos: usados,
      usoPct: porcentagem(usados, limite),
      // O que a tela mostra em vermelho: já não cabe mais um.
      esgotado: incluido && Number.isFinite(limite) && usados >= limite,
    };
  });

  const porProvedor = provedores.IDS_DE_PROVEDOR.map((id) => ({
    provedor: id,
    rotulo: provedores.provedor(id).rotulo,
    ativos: ativas.filter((c) => provedores.normalizarProvedor(c.provedor, c.channelType) === id).length,
  })).filter((p) => p.ativos > 0);

  return {
    tenantId: t.id,
    empresa: t.name,
    plano: t.plan,
    planoRotulo: limites.rotulo || t.plan,
    limite: limites.caixas ?? null,
    ativos: ativas.length,
    usoPct: porcentagem(ativas.length, limites.caixas),
    esgotado: Number.isFinite(limites.caixas) && ativas.length >= limites.caixas,
    porCanal,
    porProvedor,
    medidoEm: agora().toISOString(),
  };
}

/**
 * RECUSA ligar canal além do limite — a trava, não a leitura.
 *
 * ⚠️ É uma SEGUNDA guarda, e de propósito. `criarCaixa` já recusa contando a lista viva da
 * plataforma; esta conta o NOSSO cadastro. As duas medem a mesma regra por caminhos diferentes, e
 * é isso que faz a cota continuar valendo quando a plataforma está fora do ar — que é justamente
 * quando uma guarda que depende dela deixaria passar.
 *
 * @throws {Error} com mensagem em português dizendo o limite, o uso e o que fazer.
 */
export async function exigirCotaParaLigar(tenantId, tipoCanal, { db: cliente = null } = {}) {
  const t = await exigirEmpresa(tenantId);
  const { limitesVigentes } = await tenants();
  const limites = limitesVigentes(t);
  const base = cliente || db();
  const ativas = await base.ragnabotInbox.findMany({
    where: { tenantId: t.id, removedAt: null },
    select: { channelType: true },
  });
  const veredito = cabeMaisUmaCaixa(limites, tipoCanal, ativas);
  if (veredito.permitido) return { permitido: true, ativos: ativas.length, limite: limites.caixas };

  const doTipo = ativas.filter((c) => c.channelType === tipoCanal).length;
  const e = erro(
    `${veredito.motivo} `
    + `Hoje a empresa "${t.name}" tem ${ativas.length} conexão(ões) ativa(s) de ${limites.caixas} `
    + `(${doTipo} de ${CANAIS[tipoCanal] || tipoCanal}). `
    + 'Desligue uma conexão que não é mais usada ou mude o plano da empresa.',
    409, 'COTA_DE_CANAIS_ESGOTADA',
  );
  e.detalhes = { limite: limites.caixas, ativos: ativas.length, canal: tipoCanal, ativosDoCanal: doTipo, plano: t.plan };
  throw e;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. ESTADO E REINÍCIO (F9.2.3 / F9.2.5)
// ════════════════════════════════════════════════════════════════════════════════════════════════

async function soltarCache() {
  try {
    const soltar = portas.esquecerCanais || (await import('./ragnabot-canal.porta.js')).esquecerCanais;
    soltar?.();
    return true;
  } catch (e) {
    log().warn?.(`[conexao] não consegui soltar o cache de canal: ${e.message}`);
    return false;
  }
}

/** Grava o estado MEDIDO de uma conexão. Sempre com carimbo: estado sem hora não diz se é atual. */
export async function registrarEstado(tenantId, cwInboxId, { estado, detalhe = null } = {}) {
  if (!ESTADOS.includes(estado)) throw erro(`Estado "${estado}" não existe. Conhecidos: ${ESTADOS.join(', ')}.`, 400);
  const linha = await exigirConexao(tenantId, cwInboxId);
  const mudou = linha.estado !== estado;
  const atualizada = await db().ragnabotInbox.update({
    where: { id: linha.id },
    data: { estado, estadoDetalhe: detalhe ? String(detalhe).slice(0, 300) : null, estadoEm: agora() },
  });
  if (mudou) {
    log().info?.(`[conexao] conexão ${linha.cwInboxId} (empresa ${linha.tenantId}): ${linha.estado} → ${estado}`);
    // Avisar o sistema do cliente é OPCIONAL e nunca derruba a gravação do estado.
    await emitir(linha.tenantId, 'conexao.estado', {
      idDoEvento: `${linha.id}:${estado}:${atualizada.estadoEm?.toISOString?.() || ''}`,
      cwInboxId: linha.cwInboxId,
      dados: { conexao: linha.cwInboxId, nome: linha.name, canal: linha.channelType, de: linha.estado, para: estado, detalhe },
    });
  }
  return comoCartao(atualizada, { agoraMs: agora().getTime() });
}

/**
 * REINICIAR uma conexão (F9.2.5).
 *
 * O que ele faz de verdade, e por provedor:
 *   · `nativo` e `meta_direto` — não há sessão a religar (a credencial é estática). Reiniciar aqui
 *     é: soltar o cache de canal (60 s de capacidade guardada por conversa), reconciliar o cadastro
 *     com a plataforma e remedir o estado. É operação REAL: até hoje só se conseguia isso
 *     reiniciando o pod pelo `kubectl`, que derruba o atendimento inteiro junto.
 *   · `whatsmeow` e `terceiro` — há reinício de verdade do outro lado, e nós ainda não temos
 *     transporte para eles. Devolve `naoDisponivel` com o motivo escrito. ⛔ Nunca «pronto» sem
 *     ter feito nada: botão que mente é pior que botão que falta.
 */
export async function reiniciarConexao(tenantId, cwInboxId, { motivo = null } = {}, { ator = null, req = null } = {}) {
  const linha = await exigirConexao(tenantId, cwInboxId);
  if (linha.removedAt) throw erro(`A conexão ${linha.cwInboxId} está desligada — não há o que reiniciar. Recrie-a na tela de Empresas.`, 409, 'CONEXAO_DESLIGADA');

  const idProvedor = provedores.normalizarProvedor(linha.provedor, linha.channelType);
  const ficha = provedores.provedor(idProvedor);
  const passos = [];

  if (ficha?.podeReiniciar) {
    // Provedor com sessão própria. O transporte não existe — dizemos isso, e não fingimos.
    log().warn?.(`[conexao] reinício pedido para a conexão ${linha.cwInboxId}, provedor "${idProvedor}": sem transporte nesta instalação`);
    return {
      cwInboxId: linha.cwInboxId,
      provedor: idProvedor,
      resultado: 'naoDisponivel',
      passos,
      mensagem: `O provedor "${ficha.rotulo}" tem reinício de sessão do lado dele, e o Ragnabot ainda não fala com ele `
        + 'nesta instalação — não há a quem pedir o reinício. Enquanto o transporte não existir, este botão não faz nada, '
        + 'e dizer isso é melhor do que piscar «pronto».',
    };
  }

  // ── O reinício que EXISTE ────────────────────────────────────────────────────────────────────
  const soltou = await soltarCache();
  passos.push(soltou ? 'cache de canal solto (a próxima mensagem remede a capacidade da conexão)' : 'cache de canal NÃO foi solto');

  let sincronizacao = null;
  try {
    const svc = await tenants();
    sincronizacao = await svc.sincronizarCaixas(linha.tenantId, { ator });
    passos.push(`cadastro reconciliado com a plataforma: ${sincronizacao.caixasNaPlataforma} caixa(s) lá fora`);
  } catch (e) {
    passos.push(`reconciliação com a plataforma FALHOU: ${e.message}`);
  }

  // Remede o estado a partir do que a reconciliação achou: a conexão continua existindo lá fora?
  const depois = await db().ragnabotInbox.findUnique({ where: { id: linha.id } });
  const viva = depois && depois.removedAt == null;
  const quando = agora();
  const atualizada = await db().ragnabotInbox.update({
    where: { id: linha.id },
    data: {
      reiniciadaEm: quando,
      reiniciadaPorUserId: ator?.id || null,
      estado: sincronizacao ? (viva ? 'conectado' : 'desconectado') : 'desconhecido',
      estadoDetalhe: sincronizacao
        ? (viva ? 'Reiniciada e conferida contra a plataforma.' : 'A conexão não existe mais na plataforma.')
        : 'Reiniciada, mas não consegui conferir com a plataforma.',
      estadoEm: quando,
    },
  });

  await auditar({
    tenantId: linha.tenantId, ator, req, acao: 'ragnabot.conexao.reiniciar',
    entidadeId: String(linha.cwInboxId),
    descricao: `Conexão ${linha.cwInboxId} ("${linha.name}") reiniciada${motivo ? ` — ${motivo}` : ''}`,
    depois: { passos, estado: atualizada.estado },
  });

  return {
    cwInboxId: linha.cwInboxId,
    provedor: idProvedor,
    resultado: 'reiniciada',
    passos,
    estado: atualizada.estado,
    mensagem: `Conexão ${linha.cwInboxId} reiniciada. ${passos.join('; ')}.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. TRANSFERIR ATENDIMENTOS ENTRE CONEXÕES (F9.2.4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O que seria movido, sem mover nada. A tela mostra isto ANTES de pedir confirmação — transferência
 *  em massa sem prévia é o tipo de botão que se aperta uma vez e se lamenta o resto do dia. */
export async function previaDaTransferencia(tenantId, { deCwInboxId, paraCwInboxId, estados = null } = {}) {
  const origem = await exigirConexao(tenantId, deCwInboxId);
  const destino = await exigirConexao(tenantId, paraCwInboxId);
  const filtro = normalizarEstados(estados);
  const conversas = await db().ragnabotConversa.findMany({
    where: { tenantId: origem.tenantId, cwInboxId: origem.cwInboxId, estado: { in: filtro } },
    select: { id: true, cwConversationId: true, estado: true, contatoNome: true, contatoChave: true, ultimaAtividadeEm: true },
    orderBy: { ultimaAtividadeEm: 'desc' },
    take: 200,
  });
  const total = await db().ragnabotConversa.count({
    where: { tenantId: origem.tenantId, cwInboxId: origem.cwInboxId, estado: { in: filtro } },
  });
  return {
    origem: { cwInboxId: origem.cwInboxId, nome: origem.name, canal: origem.channelType },
    destino: { cwInboxId: destino.cwInboxId, nome: destino.name, canal: destino.channelType },
    filtroEstados: filtro,
    total,
    amostra: conversas,
    avisoDeCanal: origem.channelType === destino.channelType ? null
      : `A origem é ${CANAIS[origem.channelType] || origem.channelType} e o destino é ${CANAIS[destino.channelType] || destino.channelType}. `
        + 'O contato do cliente é do canal de ORIGEM — responder por uma conexão de outro canal não chega nele. '
        + 'Só faça isso se souber exatamente por quê.',
  };
}

function normalizarEstados(estados) {
  const brutos = Array.isArray(estados) && estados.length ? estados : ESTADOS_TRANSFERIVEIS;
  const limpos = [...new Set(brutos.map((e) => String(e || '').trim().toLowerCase()))].filter(Boolean);
  const desconhecido = limpos.find((e) => !ESTADOS_TRANSFERIVEIS.includes(e));
  if (desconhecido) {
    throw erro(`Estado "${desconhecido}" não pode ser transferido. Transferíveis: ${ESTADOS_TRANSFERIVEIS.join(', ')}.`, 400);
  }
  return limpos;
}

/**
 * Transfere atendimentos de uma conexão para outra.
 *
 * ⚠️ LEIA O AVISO NO CABEÇALHO DESTE ARQUIVO antes de mudar isto. O que se move é o NOSSO
 * roteamento e a origem registrada; a plataforma não expõe rota para trocar a caixa de entrada de
 * uma conversa, e o resultado diz isso (`moveuNaPlataforma: false`) em vez de fingir.
 *
 * O HISTÓRICO É PRESERVADO porque nada é apagado:
 *   · `origemCwInboxId` guarda de onde a conversa VEIO — e só na PRIMEIRA transferência, para que
 *     uma conversa movida três vezes continue sabendo onde nasceu;
 *   · a linha de `RagnabotConexaoTransferencia` guarda a operação inteira, com motivo e autor;
 *   · o aviso interno fica na conversa lá fora, para o atendente entender por que a linha mudou.
 */
export async function transferirConversas(tenantId, {
  deCwInboxId, paraCwInboxId, estados = null, motivo = null, forcarCanalDiferente = false, avisarNaConversa = true,
} = {}, { ator = null, req = null } = {}) {
  const origem = await exigirConexao(tenantId, deCwInboxId);
  const destino = await exigirConexao(tenantId, paraCwInboxId);
  if (origem.cwInboxId === destino.cwInboxId) throw erro('A origem e o destino são a mesma conexão.', 400);
  if (destino.removedAt) throw erro(`A conexão de destino ${destino.cwInboxId} está desligada — mover atendimento para ela seria escondê-lo.`, 409, 'DESTINO_DESLIGADO');
  const razao = String(motivo || '').trim();
  if (razao.length < 5) throw erro('Escreva o motivo da transferência (pelo menos 5 caracteres) — é o que explica, meses depois, por que estes atendimentos mudaram de linha.', 400);

  if (origem.channelType !== destino.channelType && !forcarCanalDiferente) {
    throw erro(
      `A origem é ${CANAIS[origem.channelType] || origem.channelType} e o destino é ${CANAIS[destino.channelType] || destino.channelType}. `
      + 'O contato do cliente é do canal de origem: responder por uma conexão de outro canal não chega nele. '
      + 'Se é isso mesmo que você quer, repita com "forcarCanalDiferente".',
      409, 'CANAIS_DIFERENTES',
    );
  }

  const filtro = normalizarEstados(estados);
  const conversas = await db().ragnabotConversa.findMany({
    where: { tenantId: origem.tenantId, cwInboxId: origem.cwInboxId, estado: { in: filtro } },
  });

  const quando = agora();
  const detalhes = [];
  let movidas = 0; let falhas = 0; let avisou = false;
  const cw = avisarNaConversa ? await chatwoot().catch(() => null) : null;

  for (const c of conversas) {
    try {
      await db().ragnabotConversa.update({
        where: { id: c.id },
        data: {
          cwInboxId: destino.cwInboxId,
          caixaNome: destino.name,
          canal: destino.channelType,
          // ⚠️ SÓ na primeira: é a ORIGEM verdadeira, não o passo anterior.
          origemCwInboxId: c.origemCwInboxId ?? c.cwInboxId ?? origem.cwInboxId,
          transferidaEm: quando,
        },
      });
      movidas++;
    } catch (e) {
      falhas++;
      detalhes.push({ cwConversationId: c.cwConversationId, erro: e.message });
      continue;
    }

    // O aviso é BEST-EFFORT e vem DEPOIS da gravação. Se ele falhar, o roteamento já mudou — e é
    // essa a ordem certa: a verdade do nosso lado não pode depender de a plataforma estar de pé.
    if (cw?.notaInterna) {
      try {
        await cw.notaInterna({
          cwAccountId: c.cwAccountId,
          cwConversationId: c.cwConversationId,
          texto: `🔀 Atendimento transferido da conexão "${origem.name}" (${origem.cwInboxId}) para "${destino.name}" (${destino.cwInboxId})`
            + `${ator?.name ? ` por ${ator.name}` : ''}. Motivo: ${razao}`,
        });
        avisou = true;
      } catch (e) {
        detalhes.push({ cwConversationId: c.cwConversationId, aviso: `nota interna não gravada: ${e.message}` });
      }
    }
  }

  const resultado = falhas === 0 ? 'concluida' : (movidas > 0 ? 'parcial' : 'falhou');
  let registro = null;
  try {
    registro = await db().ragnabotConexaoTransferencia.create({
      data: {
        tenantId: origem.tenantId,
        origemCwInboxId: origem.cwInboxId, destinoCwInboxId: destino.cwInboxId,
        origemNome: origem.name, destinoNome: destino.name,
        filtroEstados: filtro,
        encontradas: conversas.length, movidas, falhas,
        resultado, detalhes: detalhes.length ? detalhes : null,
        avisoNaConversa: avisou,
        // ⛔ Honestidade em coluna: a plataforma não move a caixa de entrada de uma conversa.
        moveuNaPlataforma: false,
        motivo: razao,
        solicitadaPorUserId: ator?.id || null, solicitadaPorNome: ator?.name || ator?.nome || null,
        concluidaEm: agora(),
      },
    });
  } catch (e) {
    log().error?.(`[conexao] transferência executada mas NÃO registrada: ${e.message}`);
  }

  await soltarCache();
  log().warn?.(`[conexao] ${movidas} atendimento(s) movidos da conexão ${origem.cwInboxId} para a ${destino.cwInboxId} (empresa ${origem.tenantId})`);
  await auditar({
    tenantId: origem.tenantId, ator, req, acao: 'ragnabot.conexao.transferir',
    entidadeId: registro?.id || String(origem.cwInboxId),
    descricao: `${movidas} atendimento(s) transferidos da conexão ${origem.cwInboxId} ("${origem.name}") para a ${destino.cwInboxId} ("${destino.name}") — ${razao}`,
    antes: { conexao: origem.cwInboxId }, depois: { conexao: destino.cwInboxId, movidas, falhas },
  });
  await emitir(origem.tenantId, 'conexao.transferencia', {
    idDoEvento: registro?.id || `${origem.cwInboxId}->${destino.cwInboxId}@${quando.toISOString()}`,
    cwInboxId: destino.cwInboxId,
    dados: { de: origem.cwInboxId, para: destino.cwInboxId, movidas, falhas, motivo: razao },
  });

  return {
    id: registro?.id || null,
    origem: { cwInboxId: origem.cwInboxId, nome: origem.name },
    destino: { cwInboxId: destino.cwInboxId, nome: destino.name },
    filtroEstados: filtro,
    encontradas: conversas.length, movidas, falhas, resultado,
    avisoNaConversa: avisou,
    moveuNaPlataforma: false,
    detalhes,
    // ⚠️ A frase que a tela mostra. Ela DIZ o limite, em vez de escondê-lo num campo booleano.
    mensagem: `${movidas} de ${conversas.length} atendimento(s) passaram a ser roteados pela conexão "${destino.name}". `
      + 'O roteamento e o histórico do Ragnabot foram atualizados; a plataforma de atendimento não permite trocar a caixa de '
      + 'entrada de uma conversa já aberta, então lá a conversa continua na caixa original — por isso deixamos um aviso '
      + 'interno em cada uma.',
  };
}

/** O histórico das transferências — o que a tela lista e a auditoria confere. */
export async function listarTransferencias(tenantId, { limite = 50 } = {}) {
  const linhas = await db().ragnabotConexaoTransferencia.findMany({
    where: { tenantId: String(tenantId || '') },
    orderBy: { criadaEm: 'desc' },
    take: Math.min(200, Math.max(1, Number(limite) || 50)),
  });
  return linhas;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. REGISTRO DE REQUISIÇÕES POR CANAL (F9.2.6)
//
// ⚠️ SEM TABELA NOVA, de propósito. O motor JÁ grava cada envio em `RagnabotFluxoEfeito`
// (`httpStatus`, `erro`, `resposta` resumida, `tipo`, `reservadoEm`). Criar uma segunda tabela de
// log seria escrever a mesma coisa duas vezes e ter duas verdades divergindo na primeira falha de
// gravação. O que faltava era a LEITURA — que é literalmente o que o doc 34 §F9.2.6 diz: «o motor
// já registra; falta a tela».
//
// O caminho da junção (o modelo não tem FK entre eles, e por isso ela é explícita aqui):
//   RagnabotConversa (cwInboxId)  →  cwConversationId
//     →  RagnabotFluxoExecucao (cwAccountId + cwConversationId)  →  id
//       →  RagnabotFluxoEfeito (execucaoId)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * As requisições de saída de UMA conexão, mais recentes primeiro.
 * @param {{cwInboxId:number, desde?:Date, ate?:Date, limite?:number, somenteFalhas?:boolean}} filtro
 */
export async function registroPorConexao(tenantId, { cwInboxId, desde = null, ate = null, limite = 100, somenteFalhas = false } = {}) {
  const conexao = await exigirConexao(tenantId, cwInboxId);
  const teto = Math.min(500, Math.max(1, Number(limite) || 100));

  const conversas = await db().ragnabotConversa.findMany({
    where: { tenantId: conexao.tenantId, cwInboxId: conexao.cwInboxId },
    select: { cwAccountId: true, cwConversationId: true, contatoNome: true, protocolo: true },
    // Teto largo: o que limita a resposta é o `take` dos efeitos, não este. Mas sem teto nenhum,
    // uma empresa com 50 mil conversas montaria um `IN` que o Postgres recusa.
    take: 5000,
  });
  if (!conversas.length) {
    return { conexao: comoCartao(conexao, { agoraMs: agora().getTime() }), total: 0, requisicoes: [], observacao: 'Nenhuma conversa desta conexão foi projetada ainda.' };
  }
  const porConversa = new Map(conversas.map((c) => [c.cwConversationId, c]));

  const execucoes = await db().ragnabotFluxoExecucao.findMany({
    where: {
      tenantId: conexao.tenantId,
      cwConversationId: { in: conversas.map((c) => c.cwConversationId) },
    },
    select: { id: true, cwConversationId: true, protocolo: true },
    take: 5000,
  });
  if (!execucoes.length) {
    return { conexao: comoCartao(conexao, { agoraMs: agora().getTime() }), total: 0, requisicoes: [], observacao: 'Nenhuma execução de fluxo nesta conexão — não há requisição registrada.' };
  }
  const porExecucao = new Map(execucoes.map((e) => [e.id, e]));

  const where = { execucaoId: { in: execucoes.map((e) => e.id) } };
  if (desde || ate) {
    where.reservadoEm = {};
    if (desde) where.reservadoEm.gte = new Date(desde);
    if (ate) where.reservadoEm.lte = new Date(ate);
  }
  if (somenteFalhas) where.status = { in: ['falhou', 'duvidoso'] };

  const efeitos = await db().ragnabotFluxoEfeito.findMany({
    where, orderBy: { reservadoEm: 'desc' }, take: teto,
  });

  return {
    conexao: comoCartao(conexao, { agoraMs: agora().getTime() }),
    total: efeitos.length,
    requisicoes: efeitos.map((f) => {
      const exec = porExecucao.get(f.execucaoId);
      const conv = exec ? porConversa.get(exec.cwConversationId) : null;
      return {
        id: f.id,
        quando: f.reservadoEm,
        confirmadoEm: f.confirmadoEm,
        tipo: f.tipo,
        status: f.status, // reservado|confirmado|falhou|descartado|duvidoso
        httpStatus: f.httpStatus,
        idExterno: f.idExterno,
        erro: f.erro,
        motivoDescarte: f.motivoDescarte,
        tentativa: f.tentativa,
        // ⛔ `resposta` é resumo redigido pelo motor (nunca corpo cru) — sai como está.
        resumo: f.resposta ?? null,
        conversa: exec?.cwConversationId ?? null,
        protocolo: exec?.protocolo || conv?.protocolo || null,
        contato: conv?.contatoNome || null,
      };
    }),
  };
}

/**
 * O RELATÓRIO da conexão: quantas requisições, quantas confirmaram, quantas falharam, e por tipo.
 * É o número que a tela 37 do doc 34 mostra — e ele já existia, sem ninguém poder olhar.
 */
export async function relatorioPorConexao(tenantId, { cwInboxId, desde = null, ate = null } = {}) {
  const bruto = await registroPorConexao(tenantId, { cwInboxId, desde, ate, limite: 500 });
  const conta = { total: 0, confirmadas: 0, falhas: 0, duvidosas: 0, descartadas: 0, reservadas: 0 };
  const porTipo = new Map();
  const porStatusHttp = new Map();
  for (const r of bruto.requisicoes) {
    conta.total++;
    if (r.status === 'confirmado') conta.confirmadas++;
    else if (r.status === 'falhou') conta.falhas++;
    else if (r.status === 'duvidoso') conta.duvidosas++;
    else if (r.status === 'descartado') conta.descartadas++;
    else conta.reservadas++;
    porTipo.set(r.tipo, (porTipo.get(r.tipo) || 0) + 1);
    if (r.httpStatus != null) porStatusHttp.set(r.httpStatus, (porStatusHttp.get(r.httpStatus) || 0) + 1);
  }
  return {
    conexao: bruto.conexao,
    periodo: { desde: desde || null, ate: ate || null },
    ...conta,
    // ⚠️ «amostra» e não «total do período»: a leitura tem teto de 500 linhas. Chamar de total o
    // que é amostra é como um relatório passa a mentir sem ninguém perceber.
    amostraDe: bruto.requisicoes.length,
    taxaDeFalhaPct: conta.total ? Math.round(((conta.falhas + conta.duvidosas) / conta.total) * 1000) / 10 : null,
    porTipo: [...porTipo.entries()].map(([tipo, n]) => ({ tipo, n })).sort((a, b) => b.n - a.n),
    porStatusHttp: [...porStatusHttp.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    observacao: bruto.observacao || null,
  };
}

// ── auxiliares ─────────────────────────────────────────────────────────────────────────────────

/** Emite um evento para os webhooks de saída. Nunca derruba a operação que o gerou. */
async function emitir(tenantId, evento, carga) {
  try {
    const emitirEvento = portas.emitirEvento
      || (await import('./ragnabot-webhook-saida.service.js')).enfileirar;
    await emitirEvento(tenantId, evento, carga);
  } catch (e) {
    // Silencioso no nível de aviso: em 02/09/2026 não há webhook cadastrado, e a tabela pode nem
    // existir. Um erro aqui não é problema de quem trocou o estado de uma conexão.
    log().debug?.(`[conexao] evento "${evento}" não enfileirado: ${e.message}`);
  }
}

async function auditar({ tenantId, ator, req, acao, descricao, entidadeId = null, antes = null, depois = null }) {
  try {
    const aud = portas.auditoria || (await import('./ragnabot-auditoria.service.js'));
    await aud.registrar({
      tenantId,
      atorTipo: ator ? 'usuario' : 'sistema',
      atorId: ator?.id || null, atorNome: ator?.name || ator?.nome || null, atorEmail: ator?.email || null,
      categoria: 'configuracao', acao, descricao,
      ip: req?.ip || null, userAgent: req?.headers?.['user-agent'] || null,
      entidade: 'RagnabotInbox', entidadeId, antes, depois,
    });
  } catch (e) { log().warn?.(`[conexao] auditoria não registrada: ${e.message}`); }
}

export default {
  ESTADOS, ESTADOS_TRANSFERIVEIS,
  listarConexoes, comoCartao,
  definirProvedor, opcoesDeProvedor,
  cotaDeCanais, exigirCotaParaLigar,
  registrarEstado, reiniciarConexao,
  previaDaTransferencia, transferirConversas, listarTransferencias,
  registroPorConexao, relatorioPorConexao,
  configurarConexoes, portasDasConexoes,
};
