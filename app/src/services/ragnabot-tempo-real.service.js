// ════════════════════════════════════════════════════════════════════════════════════════════════
// TEMPO REAL DA CAIXA DE ATENDIMENTO (contrato S-TEMPO-REAL, 03/09/2026 — doc 35 §6.8)
//
// Ordem do dono: *"essa parte não deve ser necessário clicar em sincronizar; a atualização deve ser
// em tempo real, e inclusive sem atualizar a página."*
//
// ── O QUE ESTE ARQUIVO É ────────────────────────────────────────────────────────────────────────
// O quadro de avisos. Quem publica é quem sabe que algo mudou (o webhook). Quem assina é cada
// navegador pendurado numa conexão de eventos. No meio, DUAS coisas, e as duas são o motivo de o
// arquivo existir:
//
//   1. o CANAL COMUM (`ragnabot-tempo-real.canal.js`), para o aviso nascido no pod A chegar ao
//      atendente pendurado no pod B;
//   2. o FILTRO DE ISOLAMENTO, para o aviso só chegar a quem teria direito de VER aquela conversa.
//
// ── ⛔ A LEI QUE MANDA NO FILTRO ────────────────────────────────────────────────────────────────
// Empurrar o evento para todo mundo e filtrar na tela É VAZAMENTO: o navegador do atendente
// receberia, de verdade, o número e o roteamento de conversas de outro setor — bastaria abrir o
// inspetor de rede. A recusa é do SERVIDOR, aqui, antes de escrever no soquete.
//
// ── E A REGRA NÃO É ESCRITA DUAS VEZES ──────────────────────────────────────────────────────────
// A tentação óbvia seria reescrever, em `if`, a regra que `clausulaDeVisibilidade()` já expressa
// para a consulta. Duas implementações da mesma regra divergem em silêncio — e quando divergem, a
// que vaza é justamente a que ninguém está olhando. Por isso aqui NÃO há regra nenhuma: há um
// AVALIADOR (`casaClausula`) que aplica, sobre um objeto em memória, exatamente a cláusula que a
// consulta aplicaria no banco. A regra continua morando num lugar só: `ragnabot-caixa.service.js`.
//
// ── A CONVERSA QUE SAI DA SUA VISTA ─────────────────────────────────────────────────────────────
// Transferir uma conversa PARA outro atendente muda quem a vê. Se o aviso só carregasse o estado
// NOVO, o atendente que a perdeu não seria avisado e o cartão ficaria na tela dele, morto, até um
// F5 — que é o defeito que este contrato veio matar. Por isso o evento carrega `alvo` (como está)
// e `antes` (como estava), e a entrega acontece se QUALQUER um dos dois for visível para a pessoa.
// Ela recebe o aviso «mudou», recarrega pelas rotas normais, e o cartão some sozinho.
//
// ⚠️ Isso NÃO afrouxa o isolamento: `antes` é o estado em que a conversa JÁ era visível para ela.
// Ninguém passa a ver o que não via — alguém deixa de ver o que já não vê mais.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import os from 'node:os';
import crypto from 'node:crypto';
import {
  clausulaDeEmpresa, clausulaDeVisibilidade, setoresDoAgente,
} from './ragnabot-caixa.service.js';
import { criarCanalLocal, criarCanalPostgres } from './ragnabot-tempo-real.canal.js';
import loggerGlobal from '../base/logger.js';

/** Identidade DESTA réplica. É ela que faz o processo descartar o eco do próprio aviso — sem isso,
 *  quem publica entrega duas vezes (uma local, outra pelo canal) e a tela recarrega em dobro. */
export const ORIGEM = `${os.hostname()}#${process.pid}#${crypto.randomBytes(3).toString('hex')}`;

/** Versão do formato do evento. Vai no fio de propósito: durante um rollout as duas versões do
 *  motor convivem, e um pod novo publicando um formato que o pod velho não entende tem de ser
 *  DESCARTADO com registro, não interpretado pela metade. */
export const VERSAO_EVENTO = 1;

const portas = { log: loggerGlobal, caixa: { clausulaDeEmpresa, clausulaDeVisibilidade, setoresDoAgente } };
const log = () => portas.log ?? console;

/**
 * O que fazer com o que CHEGA do canal — a MESMA função para o canal compartilhado e para o local.
 *
 * ⚠️ ISTO FOI UM DEFEITO DE VERDADE, achado ao provar que o teste sabia reprovar (03/09/2026): o
 * canal local repetia o aviso de volta e, como o descarte do próprio eco só existia no caminho do
 * Postgres, o modo degradado ENTREGAVA DUAS VEZES — a tela recarregaria em dobro a cada mensagem,
 * exatamente quando o sistema já estava mancando. Duas regras para a mesma coisa divergem, e a que
 * diverge é sempre a do caminho menos olhado. Agora é uma só.
 */
function receberDoCanal(evt) {
  if (evt?.origem === ORIGEM) { contadores.ecosProprios += 1; return; }
  entregar(evt);
}

let canal = criarCanalLocal({ aoReceber: receberDoCanal });
let sequencia = 0;

/** Os navegadores pendurados NESTE processo. */
const assinantes = new Set();

const contadores = {
  publicados: 0,
  recebidos: 0,
  entregues: 0,
  descartadosPorIsolamento: 0,
  descartadosPorVersao: 0,
  ecosProprios: 0,
  conexoesAbertas: 0,
  conexoesTotais: 0,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O AVALIADOR DE CLÁUSULA
//
// Entende EXATAMENTE o que `clausulaDeVisibilidade`/`clausulaDeEmpresa` produzem — nada mais.
// Deliberadamente pequeno: um avaliador genérico de `where` do Prisma seria um segundo motor de
// consulta dentro da aplicação, e um motor de consulta que erra por omissão erra ABRINDO.
// Por isso a regra é a inversa: operador que ele não conhece faz a avaliação FALHAR FECHADA
// (`false` + registro), nunca "passar porque não sei".
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Compara respeitando o `null` explícito («devolvida para a fila») e sem coerção de tipo. */
function igual(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return a === b || String(a) === String(b);
}

/**
 * @param {object|null} clausula  `{}` = tudo · `null` = nada · `{OR:[…]}` · `{campo: valor}` ·
 *                                `{campo: {in: […]}}`
 * @param {object} alvo           o objeto em memória (o resumo da conversa)
 * @returns {boolean}
 */
export function casaClausula(clausula, alvo) {
  if (clausula === null || clausula === undefined) return false; // «não vê nada»
  if (typeof clausula !== 'object') return false;
  const chaves = Object.keys(clausula);
  if (chaves.length === 0) return true; // `{}` = «vê tudo do escopo de fora»

  for (const chave of chaves) {
    const valor = clausula[chave];
    if (chave === 'OR') {
      if (!Array.isArray(valor) || !valor.some((c) => casaClausula(c, alvo))) return false;
      continue;
    }
    if (chave === 'AND') {
      if (!Array.isArray(valor) || !valor.every((c) => casaClausula(c, alvo))) return false;
      continue;
    }
    if (chave === 'NOT') {
      if (casaClausula(valor, alvo)) return false;
      continue;
    }
    if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
      const ops = Object.keys(valor);
      // Só `in` e `notIn` — é o que as cláusulas da caixa usam. Qualquer outro operador é
      // desconhecido, e desconhecido recusa.
      if (ops.length === 1 && ops[0] === 'in') {
        const lista = Array.isArray(valor.in) ? valor.in : [];
        if (!lista.some((v) => igual(alvo?.[chave], v))) return false;
        continue;
      }
      if (ops.length === 1 && ops[0] === 'notIn') {
        const lista = Array.isArray(valor.notIn) ? valor.notIn : [];
        if (lista.some((v) => igual(alvo?.[chave], v))) return false;
        continue;
      }
      log().warn?.(`[ao-vivo] operador não suportado no filtro (${chave}: ${ops.join(',')}) — recusando`);
      return false;
    }
    if (!igual(alvo?.[chave], valor)) return false;
  }
  return true;
}

/**
 * ⭐ ESTE usuário pode ver ESTA conversa?
 *
 * Usa as MESMAS duas cláusulas da consulta: a de empresa (isolamento entre clientes) e a de
 * visibilidade (isolamento entre atendentes dentro da empresa). As duas têm de passar.
 */
export function podeVer({ user, setores = [] }, alvo) {
  if (!alvo) return false;
  const empresa = portas.caixa.clausulaDeEmpresa(user);
  if (empresa === null) return false;              // sem empresa vinculada = não vê nada
  if (!casaClausula(empresa, alvo)) return false;
  const visao = portas.caixa.clausulaDeVisibilidade(user, setores);
  return casaClausula(visao, alvo);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ASSINATURA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Pendura um navegador.
 *
 * @param {object} p
 * @param {object} p.user      quem é (vem do cookie de sessão, já verificado pelo middleware)
 * @param {number[]} p.setores os `cwTeamId` de que ele é membro, LIDOS DO BANCO no momento de abrir
 * @param {(evento:object)=>void} p.envio  escreve no soquete
 * @returns {{cancelar:()=>void, id:string}}
 */
export function assinar({ user, setores = [], envio }) {
  if (typeof envio !== 'function') throw new Error('assinar: falta a função de envio');
  const inscricao = {
    id: crypto.randomUUID(),
    user,
    setores,
    envio,
    abertaEm: new Date(),
    entregues: 0,
  };
  assinantes.add(inscricao);
  contadores.conexoesAbertas = assinantes.size;
  contadores.conexoesTotais += 1;
  return {
    id: inscricao.id,
    cancelar() {
      assinantes.delete(inscricao);
      contadores.conexoesAbertas = assinantes.size;
    },
  };
}

/** Entrega um evento a quem, NESTE processo, tem direito de vê-lo. */
export function entregar(evento) {
  if (!evento || typeof evento !== 'object') return { entregues: 0 };
  if (evento.v !== VERSAO_EVENTO) {
    contadores.descartadosPorVersao += 1;
    return { entregues: 0, motivo: 'VERSAO' };
  }
  contadores.recebidos += 1;

  let entregues = 0;
  let recusados = 0;
  for (const i of assinantes) {
    // A conversa é visível se está visível AGORA — ou se ESTAVA antes desta mudança. Ver o
    // cabeçalho do arquivo: é o que faz o cartão transferido sumir da tela de quem o perdeu.
    const visivel = podeVer(i, evento.alvo) || (evento.antes ? podeVer(i, evento.antes) : false);
    if (!visivel) { recusados += 1; continue; }
    try {
      i.envio(paraOFio(evento));
      i.entregues += 1;
      entregues += 1;
    } catch (e) {
      // Soquete morto: sai da lista. Quem fecha de verdade é a rota, no evento `close`.
      log().warn?.(`[ao-vivo] assinante removido (${e.message})`);
      assinantes.delete(i);
      contadores.conexoesAbertas = assinantes.size;
    }
  }
  contadores.entregues += entregues;
  contadores.descartadosPorIsolamento += recusados;
  return { entregues, recusados };
}

/** O que sai no fio: sem a marca de origem (é detalhe nosso) e sem `antes` (é roteamento de um
 *  estado que já passou — a tela não precisa dele, e o que não precisa não viaja). */
function paraOFio(evento) {
  return {
    v: evento.v,
    id: evento.id,
    tipo: evento.tipo,
    motivo: evento.motivo,
    em: evento.em,
    cwConversationId: evento.alvo?.cwConversationId ?? null,
    cwAccountId: evento.alvo?.cwAccountId ?? null,
    estado: evento.alvo?.estado ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PUBLICAÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ Publica um aviso. NUNCA lança — quem chama está no meio de gravar a mensagem de um cliente.
 *
 * Entrega em DOIS caminhos, e é de propósito:
 *   · LOCAL, na hora, para quem está pendurado neste pod (funciona mesmo com o banco piscando);
 *   · pelo CANAL COMUM, para os outros pods.
 * O eco do canal volta para cá e é descartado pela marca de origem — senão a tela de quem está
 * neste pod recarregaria duas vezes por evento.
 */
export async function publicar({ tipo = 'conversa', motivo = 'mudou', alvo, antes = null } = {}) {
  if (!alvo || alvo.cwConversationId === undefined || alvo.cwConversationId === null) {
    return { ok: false, motivo: 'ALVO_INCOMPLETO' };
  }
  sequencia += 1;
  const evento = {
    v: VERSAO_EVENTO,
    id: `${ORIGEM}:${sequencia}`,
    origem: ORIGEM,
    tipo,
    motivo,
    em: new Date().toISOString(),
    alvo: resumoDeConversa(alvo),
    antes: antes ? resumoDeConversa(antes) : null,
  };
  contadores.publicados += 1;

  const local = entregar(evento);
  let noCanal = { entregue: false, motivo: 'CANAL_AUSENTE' };
  try {
    noCanal = await canal.publicar(evento);
  } catch (e) {
    noCanal = { entregue: false, motivo: 'ERRO', erro: e.message };
  }
  return { ok: true, id: evento.id, local, noCanal };
}

/**
 * O RESUMO que viaja. Lista FECHADA de campos, e essa é a proteção da lei «nada de texto de
 * cliente»: acrescentar `contatoNome` ou `ultimaMensagem` aqui exigiria alterar esta função, que é
 * exatamente o lugar onde alguém lê o porquê de não fazer isso.
 */
export function resumoDeConversa(c = {}) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  return {
    tenantId: c.tenantId ? String(c.tenantId) : null,
    cwAccountId: num(c.cwAccountId),
    cwConversationId: num(c.cwConversationId),
    estado: c.estado ?? null,
    cwAssigneeId: num(c.cwAssigneeId),
    cwTeamId: num(c.cwTeamId),
    resolvidaPorCwUserId: num(c.resolvidaPorCwUserId),
    ehGrupo: c.ehGrupo === true,
  };
}

/**
 * Lê a linha do índice e publica o aviso. É o atalho que quem avisa usa — a fonte do roteamento é
 * o BANCO, nunca o corpo do evento de terceiro (que pode vir sem o setor e nos faria publicar um
 * alvo pela metade, e alvo pela metade num filtro de isolamento é recusa em massa).
 *
 * @param {object} p.db          cliente Prisma
 * @param {number} p.cwAccountId
 * @param {number} p.cwConversationId
 * @param {string} p.motivo      nova | mensagem | mudou | resolvida
 * @param {object|null} p.antes  o resumo de ANTES, se quem chama o tiver lido
 */
export async function anunciarConversa({ db, cwAccountId, cwConversationId, motivo = 'mudou', antes = null } = {}) {
  try {
    if (!db?.ragnabotConversa?.findUnique) return { ok: false, motivo: 'MODELO_AUSENTE' };
    const linha = await db.ragnabotConversa.findUnique({
      where: { cwAccountId_cwConversationId: { cwAccountId: Number(cwAccountId), cwConversationId: Number(cwConversationId) } },
      select: {
        tenantId: true, cwAccountId: true, cwConversationId: true, estado: true,
        cwAssigneeId: true, cwTeamId: true, resolvidaPorCwUserId: true, ehGrupo: true,
      },
    });
    if (!linha) return { ok: false, motivo: 'CONVERSA_AUSENTE' };
    return await publicar({ tipo: 'conversa', motivo, alvo: linha, antes });
  } catch (e) {
    // ⛔ Engole de propósito. Um aviso perdido atrasa uma tela; uma exceção aqui derrubaria o
    // webhook que estava gravando a mensagem do cliente. A ordem do estrago é inegociável.
    log().warn?.(`[ao-vivo] não anunciei a conversa ${cwAccountId}/${cwConversationId}: ${e.message}`);
    return { ok: false, motivo: 'ERRO', erro: e.message };
  }
}

/** O resumo de ANTES, lido antes de a mudança ser gravada. Devolve `null` quando a conversa ainda
 *  não existia (conversa nova não tinha «antes»). */
export async function lerResumo({ db, cwAccountId, cwConversationId } = {}) {
  try {
    if (!db?.ragnabotConversa?.findUnique) return null;
    return await db.ragnabotConversa.findUnique({
      where: { cwAccountId_cwConversationId: { cwAccountId: Number(cwAccountId), cwConversationId: Number(cwConversationId) } },
      select: {
        tenantId: true, cwAccountId: true, cwConversationId: true, estado: true,
        cwAssigneeId: true, cwTeamId: true, resolvidaPorCwUserId: true, ehGrupo: true,
      },
    });
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LIGAR / DESLIGAR
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Liga o canal comum. Sem `url`, ou com `RAGNABOT_AOVIVO_CANAL=local`, fica no modo LOCAL — que
 * funciona, atualiza a tela de quem está neste pod, e DIZ no `/saude` que não é compartilhado.
 * Modo degradado declarado é melhor que modo degradado disfarçado de saudável.
 */
export async function ligarCanal({ url = process.env.DATABASE_URL, modo = process.env.RAGNABOT_AOVIVO_CANAL } = {}) {
  await canal.parar().catch(() => {});
  const querLocal = String(modo || '').toLowerCase() === 'local';
  if (querLocal || !url) {
    canal = criarCanalLocal({ aoReceber: receberDoCanal });
    await canal.ligar();
    log().warn?.('[ao-vivo] canal em modo LOCAL — o aviso não atravessa réplicas '
      + (querLocal ? '(pedido por RAGNABOT_AOVIVO_CANAL=local)' : '(sem DATABASE_URL)'));
    return canal.estado();
  }
  canal = criarCanalPostgres({
    url,
    log: log(),
    // O eco do que ESTE processo publicou já foi entregue localmente. Entregar de novo faria a
    // tela recarregar em dobro a cada mensagem — ver `receberDoCanal`.
    aoReceber: receberDoCanal,
  });
  await canal.ligar();
  return canal.estado();
}

export async function desligarCanal() {
  try { await canal.parar(); } catch { /* já caiu */ }
  for (const i of [...assinantes]) {
    try { i.envio(null); } catch { /* soquete já morreu */ }
  }
  assinantes.clear();
  contadores.conexoesAbertas = 0;
}

/** Troca as portas (usado pelos testes e pela amarração do servidor). */
export function configurarTempoReal(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}

/** Troca o canal por outro (é assim que o teste liga DUAS instâncias ao mesmo Postgres). */
export function usarCanal(novo) {
  canal = novo;
  return canal;
}

export function estadoDoTempoReal() {
  return {
    transporte: 'sse',
    origem: ORIGEM,
    versaoEvento: VERSAO_EVENTO,
    canal: canal.estado(),
    ...contadores,
    assinantes: [...assinantes].map((i) => ({
      abertaEm: i.abertaEm.toISOString(),
      entregues: i.entregues,
      setores: i.setores.length,
    })),
  };
}

/** Só para os testes: zera os contadores sem mexer nas conexões. */
export function zerarContadores() {
  for (const k of Object.keys(contadores)) contadores[k] = 0;
  contadores.conexoesAbertas = assinantes.size;
}

/** Quantos navegadores estão pendurados NESTE processo. */
export function conexoesAbertas() { return assinantes.size; }

/**
 * Os setores deste usuário, PELA PORTA.
 *
 * A rota poderia importar `setoresDoAgente` direto — e foi assim que nasceu. Passou a vir por aqui
 * para que a MESMA porta que o filtro usa seja a que a abertura da conexão usa: se um teste (ou um
 * dia um cache) trocar a origem dos setores, as duas metades da decisão trocam juntas. Duas
 * origens para o mesmo dado de permissão é como uma delas fica para trás.
 */
export async function setoresDe(user) {
  return portas.caixa.setoresDoAgente(user);
}

export default {
  ORIGEM, VERSAO_EVENTO, casaClausula, podeVer, assinar, entregar, publicar, anunciarConversa,
  lerResumo, resumoDeConversa, ligarCanal, desligarCanal, configurarTempoReal, usarCanal,
  estadoDoTempoReal, conexoesAbertas, setoresDe, zerarContadores,
};
