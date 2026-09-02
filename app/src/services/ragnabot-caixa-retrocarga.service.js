// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETROCARGA DA CAIXA DE ATENDIMENTO — as conversas que já existiam entram na fila.
// Contrato S3 (02/09/2026), parte 1.
//
// ── O PROBLEMA QUE ESTE ARQUIVO RESOLVE, EM UMA FRASE ───────────────────────────────────────────
// O índice `RagnabotConversa` (contrato S2) só se enche pelo WEBHOOK — e o webhook ainda não está
// cadastrado na plataforma, por decisão do chefe. Sem retrocarga, a caixa nasceria VAZIA no dia em
// que a tela subisse, com as conversas que já existem invisíveis e sem explicação: o operador
// abriria a fila, veria zero, e concluiria que o produto não funciona.
//
// ── ⚠️ A REGRA QUE DEFINE ESTE ARQUIVO: NÃO PIORAR O QUE JÁ EXISTE ─────────────────────────────
// O webhook grava com informação de EVENTO — ele sabe quem resolveu a conversa e quando, porque
// estava lá no instante em que aconteceu. A plataforma, lida depois, NÃO sabe: a listagem de
// conversas não tem "resolvida por" nem "resolvida em". Então esta retrocarga:
//
//   · nunca sobrescreve `resolvidaEm`/`resolvidaPorCwUserId` de uma linha que já está resolvida
//     (quem cuida disso é `projetarConversa`, e este serviço não passa por fora dela);
//   · nunca apaga campo por ausência — o que a plataforma não trouxe viaja `undefined`, e
//     `projetarConversa()` só escreve o que veio;
//   · marca a aproximação que fez, em vez de escondê-la (ver `APROXIMACOES` no resultado).
//
// Rodar duas vezes não duplica (o upsert é pela chave única `[cwAccountId, cwConversationId]`) e
// não degrada (o segundo passe grava os mesmos valores, ou nada).
//
// ── ⚠️ O AVISO DO RELATÓRIO ANTERIOR, MEDIDO E RESPONDIDO ──────────────────────────────────────
// «`conversasEmAtendimento` não devolve nome de contato, nome de caixa nem protocolo».
// Está certo, e por isso NENHUM dos três vem de lá:
//   · CONTATO  → `listarConversasRicas()` (leitura nova na porta, que preserva `meta.sender`);
//   · CAIXA    → `RagnabotInbox`, o NOSSO cadastro de conexões (a listagem da plataforma traz o
//                id da caixa, nunca o nome dela);
//   · PROTOCOLO→ `RagnabotProtocolo`, que é nosso desde sempre.
// Gravar índice pela metade seria pior que não gravar: cartão sem nome de contato é cartão que o
// atendente não consegue usar, e ele não teria como saber que o dado existe em outro lugar.
//
// ── FRONTEIRA DE DONO ───────────────────────────────────────────────────────────────────────────
// Este arquivo LÊ da plataforma e do nosso banco, e ESCREVE só através de
// `ragnabot-caixa.service.projetarConversa()`. Ele não tem `where` de visibilidade (isso é da
// caixa), não fala HTTP com a plataforma (isso é da porta) e não traduz erro em HTTP (isso é da
// rota).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import * as caixaModulo from './ragnabot-caixa.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — mesmo estilo do resto da casa. O teste troca a IMPLEMENTAÇÃO, nunca o caminho de código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  /** Leitura da plataforma. Nulo = a retrocarga recusa com 503, em vez de gravar índice vazio. */
  plataforma: null,
  /** O serviço da caixa — é ele, e só ele, que escreve em `RagnabotConversa`. */
  caixa: caixaModulo,
  log: logger,
};

export function configurarRetrocarga(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na retrocarga: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDaRetrocarga() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/** Teto de conversas por execução. Rota síncrona: varredura sem teto vira tempo limite do nginx. */
const TETO_PADRAO = 2000;

function exigePlataforma() {
  if (!portas.plataforma?.listarConversasRicas) {
    const e = new Error(
      'A leitura da plataforma não está configurada neste processo — sem ela a retrocarga gravaria '
      + 'uma caixa vazia e diria que deu certo.',
    );
    e.code = 'PLATAFORMA_AUSENTE';
    e.status = 503;
    throw e;
  }
  return portas.plataforma;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OS TRÊS DADOS QUE A PLATAFORMA NÃO DÁ — cada um do seu dono
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Nome e canal de cada caixa de entrada, do NOSSO cadastro.
 *
 * ⚠️ Inclui as conexões REMOVIDAS (`removedAt` preenchido). Uma conversa antiga aponta para a caixa
 * pela qual ela chegou, e essa caixa pode ter sido desligada desde então — deixá-la de fora faria o
 * cartão dizer «Caixa 34» em vez de «WhatsApp Comercial» justamente no histórico, que é onde a
 * pessoa está tentando entender o que aconteceu.
 *
 * @returns {Promise<Map<number, {nome:string, canal:string}>>} indexado por `cwInboxId`
 */
export async function mapaDeCaixas(tenantId) {
  const linhas = await db().ragnabotInbox.findMany({
    where: { tenantId, cwInboxId: { not: null } },
    select: { cwInboxId: true, name: true, channelType: true, removedAt: true },
    orderBy: [{ removedAt: 'asc' }], // a ATIVA por último: ela sobrescreve a removida do mesmo id
  });
  const mapa = new Map();
  for (const l of linhas) mapa.set(l.cwInboxId, { nome: l.name, canal: l.channelType });
  return mapa;
}

/**
 * Nome de cada setor, do espelho `RagnabotSetor`.
 *
 * A listagem da plataforma JÁ traz `meta.team.name` — mas nem sempre: em conversa sem time, e em
 * algumas versões do payload, o bloco `team` não vem. O espelho é a retaguarda, e é ele que faz o
 * nome do setor aparecer igual no cartão e no filtro.
 */
export async function mapaDeSetores(cwAccountId) {
  const linhas = await db().ragnabotSetor.findMany({
    where: { cwAccountId }, select: { cwTeamId: true, nome: true },
  });
  return new Map(linhas.map((l) => [l.cwTeamId, l.nome]));
}

/** Protocolo por conversa — nosso desde sempre, e o que a fila mostra sem precisar de junção. */
export async function mapaDeProtocolos(cwAccountId, ids) {
  if (!ids.length) return new Map();
  const linhas = await db().ragnabotProtocolo.findMany({
    where: { cwAccountId, cwConversationId: { in: ids } },
    select: { cwConversationId: true, protocolo: true },
  });
  return new Map(linhas.map((l) => [l.cwConversationId, l.protocolo]));
}

/**
 * Quais conversas estão COM O ROBÔ — execução de fluxo viva.
 *
 * É o que separa `chatbot` de `aguardando` na sub-aba: as duas chegam da plataforma como «aberta
 * sem responsável», e a plataforma não sabe distinguir. Sem esta consulta, toda conversa que o robô
 * está atendendo apareceria na fila como trabalho para um humano puxar.
 *
 * Estados ATIVOS do motor: `rodando`, `esperando`, `pausado_humano`, `pausado_duvida`.
 * Os terminais (`concluido`, `abandonado`, `erro`) NÃO contam — execução encerrada não é robô vivo.
 */
const ESTADOS_DE_EXECUCAO_VIVA = ['rodando', 'esperando', 'pausado_humano', 'pausado_duvida'];

export async function conversasComRobo(cwAccountId, ids) {
  if (!ids.length) return new Set();
  if (!db()?.ragnabotFluxoExecucao?.findMany) return new Set();
  const linhas = await db().ragnabotFluxoExecucao.findMany({
    where: { cwAccountId, cwConversationId: { in: ids }, estado: { in: ESTADOS_DE_EXECUCAO_VIVA } },
    select: { cwConversationId: true },
  });
  return new Set(linhas.map((l) => l.cwConversationId));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A MONTAGEM DE UMA LINHA — função PURA, para a regra ser provável sem banco e sem rede
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Marcadores do que foi DEDUZIDO, e não lido. Viajam no resultado para o relatório não mentir. */
export const APROXIMACOES = Object.freeze({
  RESOLVIDA_EM_APROXIMADA: 'resolvidaEm veio de status_changed_at (a plataforma não guarda o instante da resolução)',
  RESOLVIDA_POR_DEDUZIDA: 'resolvidaPor deduzido do responsável atual (a plataforma não guarda quem resolveu)',
  SEM_CAIXA_CADASTRADA: 'a caixa de entrada desta conversa não está no cadastro de conexões',
  SEM_CONTATO: 'a plataforma não devolveu o contato desta conversa',
});

/**
 * Monta o que será entregue a `projetarConversa()` a partir de uma conversa RICA + os três mapas.
 *
 * @param {object} c conversa rica (`ragnabot-chatwoot.porta.conversaRica`)
 * @param {{tenantId:string, caixas:Map, setores:Map, protocolos:Map, comRobo:Set}} apoio
 * @returns {{dados:object, aproximacoes:string[]}}
 */
export function montarProjecao(c, { tenantId, caixas, setores, protocolos, comRobo } = {}) {
  const aproximacoes = [];
  const caixa = caixas?.get?.(c.cwInboxId) ?? null;
  if (c.cwInboxId && !caixa) aproximacoes.push(APROXIMACOES.SEM_CAIXA_CADASTRADA);
  if (!c.cwContactId && !c.contatoChave) aproximacoes.push(APROXIMACOES.SEM_CONTATO);

  // `undefined` = «não sei», e `projetarConversa` NÃO escreve. `null` seria «apague», que é
  // exatamente o que uma retrocarga não pode fazer com o trabalho do webhook.
  const ouNada = (v) => (v === null || v === undefined ? undefined : v);

  const dados = {
    tenantId,
    cwAccountId: c.cwAccountId,
    cwConversationId: c.id,

    cwInboxId: ouNada(c.cwInboxId),
    // O nome da caixa vem do NOSSO cadastro; o canal, do cadastro e, na falta dele, do payload
    // (`meta.channel`). Duas fontes com a mesma grafia — o recorte de `Channel::` já foi feito na
    // porta, e é por isso que ele não se repete aqui.
    caixaNome: caixa?.nome ?? undefined,
    canal: caixa?.canal ?? ouNada(c.canal),

    cwTeamId: ouNada(c.cwTeamId),
    setorNome: c.setorNome ?? (c.cwTeamId ? setores?.get?.(c.cwTeamId) : undefined) ?? undefined,

    cwAssigneeId: ouNada(c.cwAssigneeId),
    atendenteNome: ouNada(c.atendenteNome),

    cwContactId: ouNada(c.cwContactId),
    contatoNome: ouNada(c.contatoNome),
    contatoChave: ouNada(c.contatoChave),

    protocolo: protocolos?.get?.(c.id) ?? undefined,

    // Grupo de WhatsApp: o identificador termina em `@g.us`. Mesmo sinal que o webhook usa —
    // dois critérios diferentes fariam a mesma conversa cair em abas diferentes conforme a origem.
    ehGrupo: c.contatoChave ? String(c.contatoChave).endsWith('@g.us') : undefined,
    comRobo: comRobo ? comRobo.has(c.id) : undefined,

    statusPlataforma: ouNada(c.status),
    abertaEm: c.abertaEm instanceof Date ? c.abertaEm : undefined,
    ultimaAtividadeEm: c.ultimaAtividadeEm instanceof Date ? c.ultimaAtividadeEm : undefined,
  };

  if (c.status === 'resolved') {
    // A plataforma NÃO diz quando resolveu nem quem resolveu. `status_changed_at` é a melhor
    // aproximação que ela oferece — e ela é DECLARADA, não escondida, porque é ela que ordena a aba
    // «Resolvidos» ("mais recentes primeiro", pedido do dono). Se a linha já existir resolvida,
    // `projetarConversa()` NÃO reescreve o carimbo: quem chegou primeiro pelo evento manda.
    if (c.statusMudouEm instanceof Date) {
      dados.resolvidaEm = c.statusMudouEm;
      aproximacoes.push(APROXIMACOES.RESOLVIDA_EM_APROXIMADA);
    }
    if (c.cwAssigneeId) {
      dados.resolvidaPorCwUserId = c.cwAssigneeId;
      dados.resolvidaPorNome = c.atendenteNome ?? undefined;
      aproximacoes.push(APROXIMACOES.RESOLVIDA_POR_DEDUZIDA);
    }
  }

  return { dados, aproximacoes };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A OPERAÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Retrocarrega o índice da caixa de UMA empresa.
 *
 * @param {object} p
 * @param {string} p.tenantId        empresa no NOC (uuid)
 * @param {number} p.cwAccountId     conta na plataforma
 * @param {string[]} [p.estados]     estados a varrer (padrão: os quatro)
 * @param {number} [p.limite]        teto de conversas nesta execução
 * @param {boolean} [p.simular]      `true` = mede e relata SEM gravar nada
 * @returns {Promise<object>} resumo honesto do que foi feito
 */
export async function retrocarregar({
  tenantId, cwAccountId, estados, limite = TETO_PADRAO, simular = false,
} = {}) {
  const p = exigePlataforma();
  if (!tenantId || !Number.isInteger(Number(cwAccountId))) {
    const e = new Error('Retrocarga precisa de "tenantId" e "cwAccountId".');
    e.code = 'ENDERECO_INCOMPLETO';
    e.status = 400;
    throw e;
  }
  const conta = Number(cwAccountId);
  const comecou = Date.now();

  const leitura = await p.listarConversasRicas({ cwAccountId: conta, estados, limite });
  const conversas = leitura.itens || [];
  const ids = conversas.map((c) => c.id).filter((n) => Number.isInteger(n));

  // Os três dados que a plataforma não dá, mais o «quem está com o robô», em quatro consultas —
  // não uma por conversa. Sete conversas não justificariam a diferença; setecentas, sim, e o
  // formato certo custa o mesmo agora.
  const [caixas, setores, protocolos, comRobo] = await Promise.all([
    mapaDeCaixas(tenantId),
    mapaDeSetores(conta),
    mapaDeProtocolos(conta, ids),
    conversasComRobo(conta, ids),
  ]);

  const resumo = {
    tenantId,
    cwAccountId: conta,
    simulacao: simular === true,
    lidas: conversas.length,
    lidasPorEstado: leitura.lidasPorEstado || {},
    truncou: leitura.truncou === true,
    falhasDeLeitura: leitura.falhas || [],
    criadas: 0,
    atualizadas: 0,
    naoGravadas: 0,
    porEstado: {},
    aproximacoes: {},
    semCaixaCadastrada: 0,
    semContato: 0,
    semSetor: 0,
    comProtocolo: 0,
    comRobo: 0,
    erros: [],
    itens: [],
  };

  for (const c of conversas) {
    const { dados, aproximacoes } = montarProjecao(c, { tenantId, caixas, setores, protocolos, comRobo });

    for (const a of aproximacoes) resumo.aproximacoes[a] = (resumo.aproximacoes[a] || 0) + 1;
    if (aproximacoes.includes(APROXIMACOES.SEM_CAIXA_CADASTRADA)) resumo.semCaixaCadastrada += 1;
    if (aproximacoes.includes(APROXIMACOES.SEM_CONTATO)) resumo.semContato += 1;
    if (dados.cwTeamId === undefined) resumo.semSetor += 1;
    if (dados.protocolo) resumo.comProtocolo += 1;
    if (dados.comRobo === true) resumo.comRobo += 1;

    // O estado NOSSO, calculado pela MESMA função que a projeção usa. Calcular aqui por fora seria
    // criar uma segunda verdade sobre o que é «chatbot» — e a divergência apareceria no contador.
    const estadoPrevisto = portas.caixa.classificarEstado({
      statusPlataforma: dados.statusPlataforma,
      cwAssigneeId: dados.cwAssigneeId ?? null,
      comRobo: dados.comRobo === true,
    });
    resumo.porEstado[estadoPrevisto] = (resumo.porEstado[estadoPrevisto] || 0) + 1;

    const item = {
      cwConversationId: c.id,
      estado: estadoPrevisto,
      caixa: dados.caixaNome ?? null,
      setor: dados.setorNome ?? null,
      atendente: dados.atendenteNome ?? null,
      contato: dados.contatoNome ?? null,
      contatoChave: dados.contatoChave ?? null,
      protocolo: dados.protocolo ?? null,
      grupo: dados.ehGrupo === true,
    };

    if (simular) {
      item.gravado = 'simulacao';
      resumo.itens.push(item);
      continue;
    }

    const r = await portas.caixa.projetarConversa(dados);
    if (r?.ok) {
      if (r.novo) resumo.criadas += 1; else resumo.atualizadas += 1;
      item.gravado = r.novo ? 'criada' : 'atualizada';
    } else {
      resumo.naoGravadas += 1;
      item.gravado = 'nao_gravada';
      item.motivo = r?.motivo || 'DESCONHECIDO';
      resumo.erros.push({ cwConversationId: c.id, motivo: r?.motivo || 'DESCONHECIDO', erro: r?.erro || null });
    }
    resumo.itens.push(item);
  }

  resumo.duracaoMs = Date.now() - comecou;
  log().info?.(
    `[retrocarga] empresa ${tenantId} conta ${conta}: ${resumo.lidas} lida(s), `
    + `${resumo.criadas} criada(s), ${resumo.atualizadas} atualizada(s), ${resumo.naoGravadas} não gravada(s)`,
  );
  return resumo;
}

export default {
  retrocarregar,
  montarProjecao,
  mapaDeCaixas,
  mapaDeSetores,
  mapaDeProtocolos,
  conversasComRobo,
  configurarRetrocarga,
  portasDaRetrocarga,
  APROXIMACOES,
};
