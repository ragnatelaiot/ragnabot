// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CAIXA DE ATENDIMENTO — quem vê o quê.  Contrato S2 (02/09/2026), doc 34 §F2.2/2.3/2.4/2.7/2.8
//
// ── AS QUATRO FRASES DO DONO QUE ESTE ARQUIVO IMPLEMENTA ────────────────────────────────────────
//   1. "conversas em aberto só o agente em atendimento vê"
//   2. "submenu resolvidos com ordem por mais recentes, admin vê todos e user só os dele"
//   3. "os históricos devem ficar a cada setor e não global"
//   4. "no atendimento tem que ter a tag da caixa de entrada, setor e nome do atendente associado"
//
// ── ⛔ A REGRA QUE DEFINE ESTE ARQUIVO ──────────────────────────────────────────────────────────
// ISOLAMENTO É DO SERVIDOR, NUNCA DA TELA. Esconder botão não é segurança. Tudo aqui é `where` de
// consulta: um agente pedindo a conversa de outro PELA API recebe recusa, não a conversa. E a
// recusa é 404 ("não encontrei"), não 403 — 403 confirmaria ao curioso que aquele id existe, que é
// metade do vazamento. Mesma regra já paga em `ragnabot-respostas-rapidas.routes.js`.
//
// ── A DECISÃO DIFÍCIL, ESCRITA E NÃO ESCONDIDA: a conversa SEM atendente ─────────────────────────
// Uma conversa na fila (ou com o robô) não é de ninguém. Quem a vê?
//   · O ADMINISTRADOR da empresa vê todas — é ele quem responde pela operação.
//   · O AGENTE vê a fila DO SETOR DE QUE ELE É MEMBRO (`RagnabotAgenteSetor`). Fila que ninguém
//     enxerga é fila que ninguém puxa — o produto deixaria de funcionar.
//   · Conversa sem atendente E SEM SETOR: só administrador. Não há a que amarrar a permissão, e a
//     ordem do contrato em caso de dúvida é mostrar MENOS.
//   · Agente sem NENHUM setor cadastrado: não vê fila nenhuma, só as conversas dele. FALHA FECHADA
//     — enquanto a sincronização de times não tiver rodado, o produto mostra de menos, nunca de
//     mais. É um incômodo operacional conhecido, e está no relatório; o contrário seria um
//     vazamento silencioso.
//
// ── A OUTRA DECISÃO: histórico é SEMPRE por setor ───────────────────────────────────────────────
// `historicoDoContato()` EXIGE `cwTeamId`. Não existe modo global — nem para administrador. É a
// tradução literal de "os históricos devem ficar a cada setor e não global": o mesmo cliente pode
// falar com o Financeiro e com o Suporte, e uma conversa não pode aparecer dentro da outra.
// O agente só consulta o histórico de setor de que é membro; o administrador, de qualquer setor
// da empresa dele.
//
// ── CONTADOR QUE MENTE É PIOR QUE CONTADOR AUSENTE ──────────────────────────────────────────────
// `contar()` e `listar()` usam O MESMO `montarOnde()`. Não há um `where` para a lista e outro para
// o número. Se um dia divergirem, divergem juntos — e o teste compara os dois lado a lado.
//
// ── FRONTEIRA DE DONO ───────────────────────────────────────────────────────────────────────────
// Este arquivo decide VISIBILIDADE e ESTADO. Ele não fala com a plataforma (isso é da
// `ragnabot-chatwoot.porta.js`, injetada como porta) e não traduz erro em HTTP (isso é da rota).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import { escopoDe } from './ragnabot-auditoria.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — injeção no estilo do resto da casa (portaria, motor). O teste troca a IMPLEMENTAÇÃO,
// nunca o caminho de código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  /** Leitura da plataforma, para as sincronizações. Nulo = as sincronizações recusam. */
  plataforma: null,
  log: logger,
};

export function configurarCaixa(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na caixa: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDaCaixa() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO — um lugar só. Duas listas iguais em dois arquivos divergem no primeiro valor novo,
// e quem descobre é o usuário.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Os estados NOSSOS. `chatbot` não existe na plataforma — é o que ela não sabe distinguir. */
export const ESTADOS = Object.freeze(['atendendo', 'aguardando', 'chatbot', 'resolvida', 'adiada']);

/** As abas da caixa, como no chat atual (imagem 13). */
export const ABAS = Object.freeze(['abertas', 'resolvidos', 'grupos']);

/** As sub-abas de "Abertas". A ordem é a da tela. */
export const SUBABAS = Object.freeze(['atendendo', 'aguardando', 'chatbot']);

/** Estados que contam como "aberta". Um lugar só — a aba, o contador e o histórico leem daqui. */
export const ESTADOS_ABERTOS = Object.freeze(['atendendo', 'aguardando', 'chatbot']);

const TETO_PAGINA = 100;
const PAGINA_PADRAO = 25; // a mesma da plataforma; muda-se aqui, não em cada chamador

/**
 * O estado NOSSO, a partir do que a plataforma diz.
 *
 * Função PURA de propósito: é a regra mais fácil de errar do arquivo e a mais barata de provar.
 * A plataforma tem `open | pending | resolved | snoozed` e NÃO sabe dizer se quem está do outro
 * lado é o robô ou ninguém — as duas situações chegam como "aberta sem responsável". A diferença
 * importa para o atendente: `aguardando` é trabalho para puxar; `chatbot` é conversa em andamento
 * que não precisa dele.
 *
 * @param {{statusPlataforma?:string, cwAssigneeId?:number|null, comRobo?:boolean}} d
 * @returns {'atendendo'|'aguardando'|'chatbot'|'resolvida'|'adiada'}
 */
export function classificarEstado({ statusPlataforma, cwAssigneeId, comRobo } = {}) {
  const s = String(statusPlataforma || '').toLowerCase();
  if (s === 'resolved') return 'resolvida';
  if (s === 'snoozed') return 'adiada';
  // Atendente ganha do robô: se há gente com a conversa na mão, ela está sendo ATENDIDA, mesmo que
  // uma execução de fluxo tenha sobrado viva. O contrário faria a conversa sumir da aba do próprio
  // agente que a está respondendo.
  if (cwAssigneeId !== null && cwAssigneeId !== undefined) return 'atendendo';
  if (comRobo === true) return 'chatbot';
  return 'aguardando';
}

/**
 * As três etiquetas do cartão (pedido nº 4 do dono): caixa de entrada · setor · atendente.
 *
 * Devolve SEMPRE as três, inclusive quando vazias — com o texto do vazio. Etiqueta que some quando
 * o valor falta faz o cartão mudar de forma na fila, e o olho perde a coluna. "Sem setor" é uma
 * informação, não uma ausência: é justamente a conversa que ninguém roteou.
 *
 * @param {object} c linha de RagnabotConversa
 */
export function etiquetasDaConversa(c = {}) {
  return [
    {
      tipo: 'caixa',
      rotulo: c.caixaNome || (c.cwInboxId ? `Caixa ${c.cwInboxId}` : 'Sem caixa'),
      valor: c.cwInboxId ?? null,
      canal: c.canal || null,
      vazia: !c.cwInboxId,
    },
    {
      tipo: 'setor',
      rotulo: c.setorNome || (c.cwTeamId ? `Setor ${c.cwTeamId}` : 'Sem setor'),
      valor: c.cwTeamId ?? null,
      vazia: c.cwTeamId === null || c.cwTeamId === undefined,
    },
    {
      tipo: 'atendente',
      rotulo: c.atendenteNome || (c.cwAssigneeId ? `Atendente ${c.cwAssigneeId}` : 'Sem atendente'),
      valor: c.cwAssigneeId ?? null,
      vazia: c.cwAssigneeId === null || c.cwAssigneeId === undefined,
    },
  ];
}

/** O que a tela recebe. Explícito de propósito: `select` largo é como campo novo vaza sem revisão. */
export function paraTela(c) {
  if (!c) return null;
  return {
    id: c.id,
    cwConversationId: c.cwConversationId,
    cwAccountId: c.cwAccountId,
    protocolo: c.protocolo || null,
    estado: c.estado,
    estadoPlataforma: c.estadoPlataforma || null,
    ehGrupo: c.ehGrupo === true,
    comRobo: c.comRobo === true,
    caixa: { id: c.cwInboxId ?? null, nome: c.caixaNome || null, canal: c.canal || null },
    setor: { id: c.cwTeamId ?? null, nome: c.setorNome || null },
    atendente: { id: c.cwAssigneeId ?? null, nome: c.atendenteNome || null },
    contato: { id: c.cwContactId ?? null, nome: c.contatoNome || null, chave: c.contatoChave || null },
    abertaEm: c.abertaEm || null,
    ultimaAtividadeEm: c.ultimaAtividadeEm || null,
    resolvidaEm: c.resolvidaEm || null,
    resolvidaPor: c.resolvidaPorCwUserId
      ? { id: c.resolvidaPorCwUserId, nome: c.resolvidaPorNome || null }
      : null,
    etiquetas: etiquetasDaConversa(c),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// IDENTIDADE E ESCOPO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** `null` = não vê nada. Falha FECHADA: vazio é o lado seguro do erro; a empresa errada não é. */
export function clausulaDeEmpresa(user, tenantIdDaTela = null) {
  const esc = escopoDe(user);
  if (esc.global) return tenantIdDaTela ? { tenantId: String(tenantIdDaTela) } : {};
  if (!esc.tenantId) return null;
  return { tenantId: esc.tenantId }; // trava dura: o que a tela mandou é ignorado
}

/** Administra a operação da empresa (vê tudo dela). Super ⊇ admin, política permanente da casa. */
export function podeAdministrar(user) {
  if (!user) return false;
  return user.isSuperuser === true || user.role === 'admin' || user.clientRole === 'client_admin';
}

/**
 * O número do atendente NA PLATAFORMA. É por ele que a conversa é atribuída lá, e por ele que
 * `cwAssigneeId` casa aqui.
 *
 * ⚠️ Não confundir com `user.id`, que é a string `cw:<n>` da sessão. Comparar `'cw:7'` com o
 * inteiro 7 é falso em silêncio — e um filtro que é falso em silêncio não recusa demais, ele
 * recusa TUDO, e alguém "conserta" removendo o filtro. Por isso a extração é uma função só.
 */
export function agenteDaSessao(user) {
  if (!user) return null;
  if (Number.isInteger(user.cwUserId)) return user.cwUserId;
  const n = Number(user.cwUserId);
  if (Number.isInteger(n)) return n;
  // A sessão sempre traz `cwUserId`; o caminho do token de serviço não traz. `cw:<n>` é o fallback.
  const m = /^cw:(\d+)$/u.exec(String(user.id || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Os setores de que este usuário é membro. Vem do BANCO, nunca da tela.
 *
 * @returns {Promise<number[]>} lista de `cwTeamId` — vazia quando não há vínculo nenhum
 */
export async function setoresDoAgente(user) {
  const cwUserId = agenteDaSessao(user);
  const esc = escopoDe(user);
  if (cwUserId === null) return [];
  if (!esc.global && !esc.tenantId) return [];
  const onde = { cwUserId };
  if (!esc.global) onde.tenantId = esc.tenantId;
  const linhas = await db().ragnabotAgenteSetor.findMany({
    where: onde, select: { cwTeamId: true },
  });
  return [...new Set(linhas.map((l) => l.cwTeamId))];
}

/**
 * ⭐ A CLÁUSULA DE VISIBILIDADE — o coração do contrato.
 *
 * Devolve o pedaço de `where` que limita as conversas que ESTE usuário pode enxergar, DENTRO da
 * empresa dele (a trava de empresa é a `clausulaDeEmpresa`, aplicada por fora).
 *
 * Função PURA: recebe os setores já resolvidos em vez de ir ao banco. É o que permite provar a
 * regra sem banco nenhum, e ler a regra inteira em dez linhas.
 *
 * @param {object} user
 * @param {number[]} setores  os `cwTeamId` de que ele é membro
 * @returns {object|null}  `{}` = vê tudo da empresa · `null` = não vê NADA
 */
export function clausulaDeVisibilidade(user, setores = []) {
  if (podeAdministrar(user)) return {}; // administrador vê a operação inteira da empresa dele
  const eu = agenteDaSessao(user);
  if (eu === null) return null; // sem identidade de atendente não há o que liberar

  const ou = [
    // 1. as conversas atribuídas a mim — é o "só o agente em atendimento vê"
    { cwAssigneeId: eu },
    // 2. as que EU resolvi — é o "user só os dele" do submenu Resolvidos. Fica separado de (1) de
    //    propósito: resolver e depois desatribuir é caminho normal, e sem esta linha o próprio
    //    atendente perderia o registro do que fez.
    { resolvidaPorCwUserId: eu },
  ];

  // 3. a FILA do meu setor: sem atendente, aberta, e num setor de que sou membro.
  //    `cwTeamId: { in: [] }` NÃO casa com nada no Prisma — mas escrever a cláusula mesmo assim
  //    seria confiar num detalhe de motor. O `if` deixa a intenção explícita.
  if (setores.length > 0) {
    ou.push({
      cwAssigneeId: null,
      estado: { in: [...ESTADOS_ABERTOS] },
      cwTeamId: { in: [...setores] },
    });
  }

  return { OR: ou };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AS CONSULTAS
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A tabela pode não ter migrado no banco onde este processo subiu. Guarda explícita. */
export function modeloPronto() {
  return Boolean(db()?.ragnabotConversa && typeof db().ragnabotConversa.findMany === 'function');
}

function inteiroOuNulo(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * O `where` completo de uma aba. ÚNICO — a lista e o contador chamam este mesmo construtor.
 *
 * @param {object} p
 * @param {object} p.empresa    cláusula de empresa (já resolvida)
 * @param {object|null} p.visao cláusula de visibilidade (já resolvida)
 * @param {string} p.aba        abertas | resolvidos | grupos
 * @param {string|null} p.sub   atendendo | aguardando | chatbot (só em `abertas`)
 * @param {object} p.filtros    estreitamentos opcionais (setor, caixa, busca)
 */
export function montarOnde({ empresa, visao, aba = 'abertas', sub = null, filtros = {} }) {
  const e = [];
  if (empresa && Object.keys(empresa).length) e.push(empresa);
  if (visao && Object.keys(visao).length) e.push(visao);

  // ── a aba ──────────────────────────────────────────────────────────────────────────────────
  if (aba === 'resolvidos') {
    e.push({ estado: 'resolvida' });
  } else if (aba === 'grupos') {
    // Grupos é um RECORTE das abertas, não um estado. Conversa de grupo resolvida sai daqui e vai
    // para Resolvidos, como qualquer outra — senão o mesmo item apareceria em duas abas.
    e.push({ ehGrupo: true, estado: { in: [...ESTADOS_ABERTOS] } });
  } else {
    // `abertas`: e o grupo NÃO aparece aqui, porque tem aba própria. Sem esta exclusão os
    // contadores de Abertas e Grupos somariam mais que o total, e o operador deixa de confiar.
    e.push({ ehGrupo: false });
    if (sub && SUBABAS.includes(sub)) e.push({ estado: sub });
    else e.push({ estado: { in: [...ESTADOS_ABERTOS] } });
  }

  // ── estreitamentos da tela (só ESTREITAM; nunca alargam) ───────────────────────────────────
  const setor = inteiroOuNulo(filtros.cwTeamId);
  if (setor !== null) e.push({ cwTeamId: setor });
  const caixa = inteiroOuNulo(filtros.cwInboxId);
  if (caixa !== null) e.push({ cwInboxId: caixa });
  const atendente = inteiroOuNulo(filtros.cwAssigneeId);
  if (atendente !== null) e.push({ cwAssigneeId: atendente });
  const busca = String(filtros.busca || '').trim();
  if (busca) {
    e.push({
      OR: [
        { contatoNome: { contains: busca, mode: 'insensitive' } },
        { contatoChave: { contains: busca } },
        { protocolo: { contains: busca.toUpperCase() } },
      ],
    });
  }

  return e.length === 1 ? e[0] : { AND: e };
}

/** A ordenação de cada aba. Resolvidos é por RESOLUÇÃO mais recente — pedido explícito do dono. */
export function ordenacaoDaAba(aba) {
  if (aba === 'resolvidos') {
    // `resolvidaEm` primeiro; `abertaEm` como desempate para a linha antiga que ainda não tem o
    // carimbo (índice preenchido por sincronização, e não pelo evento de encerramento).
    return [{ resolvidaEm: 'desc' }, { abertaEm: 'desc' }];
  }
  return [{ ultimaAtividadeEm: 'desc' }, { abertaEm: 'desc' }];
}

/**
 * A lista de uma aba.
 * @returns {Promise<{total:number, itens:object[], pagina:number, porPagina:number, escopo:object}>}
 */
export async function listar(user, filtros = {}) {
  const empresa = clausulaDeEmpresa(user, filtros.tenantId);
  if (!empresa) return vazio('usuário sem empresa vinculada');

  const setores = await setoresDoAgente(user);
  const visao = clausulaDeVisibilidade(user, setores);
  if (visao === null) return vazio('usuário sem identidade de atendente');

  const aba = ABAS.includes(filtros.aba) ? filtros.aba : 'abertas';
  const sub = SUBABAS.includes(filtros.sub) ? filtros.sub : null;
  const onde = montarOnde({ empresa, visao, aba, sub, filtros });

  const porPagina = Math.min(Math.max(Number(filtros.porPagina) || PAGINA_PADRAO, 1), TETO_PAGINA);
  const pagina = Math.max(Number(filtros.pagina) || 1, 1);

  const [total, linhas] = await Promise.all([
    db().ragnabotConversa.count({ where: onde }),
    db().ragnabotConversa.findMany({
      where: onde,
      orderBy: ordenacaoDaAba(aba),
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);

  return {
    total,
    pagina,
    porPagina,
    aba,
    sub,
    itens: linhas.map(paraTela),
    escopo: { setores, administra: podeAdministrar(user) },
  };
}

function vazio(aviso) {
  return { total: 0, pagina: 1, porPagina: PAGINA_PADRAO, itens: [], aviso, escopo: { setores: [], administra: false } };
}

/**
 * Os contadores das abas e sub-abas.
 *
 * ⚠️ Usa `montarOnde` — o MESMO construtor da lista. Se o número e a lista puderem divergir, eles
 * divergirão justamente no dia em que alguém confiar no número.
 */
export async function contar(user, filtros = {}) {
  const empresa = clausulaDeEmpresa(user, filtros.tenantId);
  if (!empresa) return { abertas: 0, resolvidos: 0, grupos: 0, atendendo: 0, aguardando: 0, chatbot: 0, aviso: 'usuário sem empresa vinculada' };

  const setores = await setoresDoAgente(user);
  const visao = clausulaDeVisibilidade(user, setores);
  if (visao === null) return { abertas: 0, resolvidos: 0, grupos: 0, atendendo: 0, aguardando: 0, chatbot: 0, aviso: 'usuário sem identidade de atendente' };

  const base = { empresa, visao, filtros };
  const alvos = [
    ['abertas', { ...base, aba: 'abertas', sub: null }],
    ['atendendo', { ...base, aba: 'abertas', sub: 'atendendo' }],
    ['aguardando', { ...base, aba: 'abertas', sub: 'aguardando' }],
    ['chatbot', { ...base, aba: 'abertas', sub: 'chatbot' }],
    ['resolvidos', { ...base, aba: 'resolvidos', sub: null }],
    ['grupos', { ...base, aba: 'grupos', sub: null }],
  ];
  const numeros = await Promise.all(
    alvos.map(([, p]) => db().ragnabotConversa.count({ where: montarOnde(p) })),
  );
  const saida = {};
  alvos.forEach(([nome], i) => { saida[nome] = numeros[i]; });
  return saida;
}

/**
 * UMA conversa, pelo id dela na plataforma.
 *
 * ⭐ É AQUI que o teste de aceite do contrato bate: o agente A pedindo a conversa do agente B
 * recebe `null` — e a rota traduz isso em 404. Não há caminho que devolva a linha sem passar pela
 * cláusula de visibilidade, porque a consulta é UMA só e ela já a carrega.
 */
export async function obter(user, cwConversationId) {
  const empresa = clausulaDeEmpresa(user);
  if (!empresa) return null;
  const id = inteiroOuNulo(cwConversationId);
  if (id === null) return null;

  const setores = await setoresDoAgente(user);
  const visao = clausulaDeVisibilidade(user, setores);
  if (visao === null) return null;

  const e = [{ cwConversationId: id }];
  if (Object.keys(empresa).length) e.push(empresa);
  if (Object.keys(visao).length) e.push(visao);

  const linha = await db().ragnabotConversa.findFirst({ where: { AND: e } });
  return linha ? paraTela(linha) : null;
}

/**
 * O HISTÓRICO DE UM CONTATO DENTRO DE UM SETOR — "os históricos devem ficar a cada setor e não
 * global".
 *
 * `cwTeamId` é OBRIGATÓRIO. Não existe modo global, nem para administrador: é a tradução literal
 * do pedido. O mesmo cliente pode ter conversas no Financeiro e no Suporte, e uma não pode
 * aparecer dentro da outra.
 *
 * Quem pode consultar: o administrador, em qualquer setor da empresa dele; o agente, apenas em
 * setor de que é membro.
 *
 * ⚠️ O que volta é a FICHA de cada atendimento (protocolo, datas, estado, quem atendeu) — nunca
 * conteúdo de mensagem, porque conteúdo não é guardado aqui (ver o aviso do schema).
 *
 * @returns {Promise<{permitido:boolean, motivo?:string, total:number, itens:object[]}>}
 */
export async function historicoDoContato(user, { cwTeamId, contatoChave, cwContactId, limite = 50 } = {}) {
  const empresa = clausulaDeEmpresa(user);
  if (!empresa) return { permitido: false, motivo: 'SEM_EMPRESA', total: 0, itens: [] };

  const setor = inteiroOuNulo(cwTeamId);
  if (setor === null) {
    return { permitido: false, motivo: 'SETOR_OBRIGATORIO', total: 0, itens: [] };
  }

  if (!podeAdministrar(user)) {
    const meus = await setoresDoAgente(user);
    if (!meus.includes(setor)) {
      return { permitido: false, motivo: 'FORA_DO_SEU_SETOR', total: 0, itens: [] };
    }
  }

  const chave = String(contatoChave || '').trim();
  const contato = inteiroOuNulo(cwContactId);
  if (!chave && contato === null) {
    return { permitido: false, motivo: 'CONTATO_OBRIGATORIO', total: 0, itens: [] };
  }

  const e = [{ cwTeamId: setor }];
  if (Object.keys(empresa).length) e.push(empresa);
  // Chave OU id: a chave (telefone) é o que sobrevive a recadastro de contato; o id é exato.
  if (chave && contato !== null) e.push({ OR: [{ contatoChave: chave }, { cwContactId: contato }] });
  else if (chave) e.push({ contatoChave: chave });
  else e.push({ cwContactId: contato });

  const onde = { AND: e };
  const take = Math.min(Math.max(Number(limite) || 50, 1), TETO_PAGINA);
  const [total, linhas] = await Promise.all([
    db().ragnabotConversa.count({ where: onde }),
    db().ragnabotConversa.findMany({ where: onde, orderBy: [{ abertaEm: 'desc' }], take }),
  ]);
  return { permitido: true, total, itens: linhas.map(paraTela), setor };
}

/** Os setores que este usuário pode ver na tela (filtro e histórico). Agente: só os dele. */
export async function listarSetores(user) {
  const empresa = clausulaDeEmpresa(user);
  if (!empresa) return { total: 0, itens: [] };
  const onde = { ...empresa };
  if (!podeAdministrar(user)) {
    const meus = await setoresDoAgente(user);
    if (meus.length === 0) return { total: 0, itens: [], aviso: 'você ainda não está em nenhum setor' };
    onde.cwTeamId = { in: meus };
  }
  const itens = await db().ragnabotSetor.findMany({ where: onde, orderBy: [{ nome: 'asc' }] });
  return {
    total: itens.length,
    itens: itens.map((s) => ({ cwTeamId: s.cwTeamId, nome: s.nome, ativo: s.ativo, descricao: s.descricao || null })),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROJEÇÃO — como o índice se enche
//
// Chamado pelo webhook (`ragnabot-webhook.routes.js`) e pela sincronização. NUNCA derruba quem
// chama: o índice é conveniência de leitura, e perder uma projeção atrasa uma linha da fila —
// derrubar o webhook perderia a mensagem do cliente, que é incomparavelmente pior.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Cria ou atualiza a linha da conversa. Idempotente pelo único `[cwAccountId, cwConversationId]`.
 *
 * ⚠️ SÓ ESCREVE O QUE VEIO. Um evento de mensagem não traz o setor; se `undefined` sobrescrevesse,
 * cada mensagem apagaria o roteamento da conversa — e a fila do setor esvaziaria sozinha.
 */
export async function projetarConversa(d = {}) {
  if (!modeloPronto()) return { ok: false, motivo: 'MODELO_AUSENTE' };
  const conta = inteiroOuNulo(d.cwAccountId);
  const conversa = inteiroOuNulo(d.cwConversationId);
  if (!d.tenantId || conta === null || conversa === null) {
    return { ok: false, motivo: 'ENDERECO_INCOMPLETO' };
  }

  const agora = d.agora instanceof Date ? d.agora : new Date();
  const mudanca = {};
  const so = (campo, valor) => { if (valor !== undefined) mudanca[campo] = valor; };

  so('cwInboxId', inteiroOuNulo(d.cwInboxId) ?? undefined);
  so('caixaNome', d.caixaNome);
  so('canal', d.canal);
  so('cwTeamId', d.cwTeamId === null ? null : inteiroOuNulo(d.cwTeamId) ?? undefined);
  so('setorNome', d.setorNome);
  so('cwAssigneeId', d.cwAssigneeId === null ? null : inteiroOuNulo(d.cwAssigneeId) ?? undefined);
  so('atendenteNome', d.atendenteNome);
  so('cwContactId', inteiroOuNulo(d.cwContactId) ?? undefined);
  so('contatoNome', d.contatoNome);
  so('contatoChave', d.contatoChave);
  so('protocolo', d.protocolo);
  so('ehGrupo', typeof d.ehGrupo === 'boolean' ? d.ehGrupo : undefined);
  so('comRobo', typeof d.comRobo === 'boolean' ? d.comRobo : undefined);
  so('estadoPlataforma', d.statusPlataforma);
  so('ultimaAtividadeEm', d.ultimaAtividadeEm instanceof Date ? d.ultimaAtividadeEm : undefined);

  // O estado é DERIVADO, nunca recebido pronto — quem chama informa os ingredientes.
  const existente = await db().ragnabotConversa.findUnique({
    where: { cwAccountId_cwConversationId: { cwAccountId: conta, cwConversationId: conversa } },
  });

  const assignee = 'cwAssigneeId' in mudanca ? mudanca.cwAssigneeId : (existente?.cwAssigneeId ?? null);
  const robo = 'comRobo' in mudanca ? mudanca.comRobo : (existente?.comRobo ?? false);
  const status = d.statusPlataforma ?? existente?.estadoPlataforma ?? 'open';
  const estado = classificarEstado({ statusPlataforma: status, cwAssigneeId: assignee, comRobo: robo });
  mudanca.estado = estado;

  // O carimbo de resolução é escrito UMA vez, na transição para resolvida. Reescrevê-lo a cada
  // sincronização faria a lista de Resolvidos reordenar sozinha — e o dono pediu "mais recentes".
  if (estado === 'resolvida') {
    if (!existente || existente.estado !== 'resolvida' || !existente.resolvidaEm) {
      mudanca.resolvidaEm = d.resolvidaEm instanceof Date ? d.resolvidaEm : agora;
      const quem = inteiroOuNulo(d.resolvidaPorCwUserId);
      // Quem resolveu, quando o evento não diz, é quem estava com a conversa na mão.
      mudanca.resolvidaPorCwUserId = quem ?? assignee ?? null;
      if (d.resolvidaPorNome !== undefined) mudanca.resolvidaPorNome = d.resolvidaPorNome;
      else if (quem === null && assignee !== null) mudanca.resolvidaPorNome = existente?.atendenteNome ?? d.atendenteNome ?? null;
    }
  } else if (existente?.estado === 'resolvida') {
    // Reabertura: o registro de quem resolveu PERMANECE (é histórico), mas o carimbo de ordenação
    // sai, senão a conversa reaberta continuaria disputando a primeira linha de Resolvidos.
    mudanca.resolvidaEm = null;
  }

  try {
    const linha = await db().ragnabotConversa.upsert({
      where: { cwAccountId_cwConversationId: { cwAccountId: conta, cwConversationId: conversa } },
      create: {
        tenantId: String(d.tenantId),
        cwAccountId: conta,
        cwConversationId: conversa,
        abertaEm: d.abertaEm instanceof Date ? d.abertaEm : agora,
        ultimaAtividadeEm: mudanca.ultimaAtividadeEm ?? agora,
        ...mudanca,
      },
      update: mudanca,
    });
    return { ok: true, novo: !existente, estado, id: linha.id };
  } catch (e) {
    log().warn(`[caixa] não projetei a conversa ${conta}/${conversa}: ${e.message.slice(0, 160)}`);
    return { ok: false, motivo: 'ERRO', erro: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO COM A PLATAFORMA — setores e quem é de qual setor
//
// A plataforma é a FONTE dos times e dos membros. Aqui é espelho, e espelho que some não apaga
// histórico: setor removido lá vira `ativo=false` aqui, e o vínculo do agente é apagado (ele
// realmente deixou o setor; manter seria conceder visibilidade que a empresa já retirou).
// ════════════════════════════════════════════════════════════════════════════════════════════════

function exigePlataforma() {
  if (!portas.plataforma) {
    const e = new Error('A leitura da plataforma não está configurada neste processo.');
    e.code = 'PLATAFORMA_AUSENTE';
    e.status = 503;
    throw e;
  }
  return portas.plataforma;
}

/** Traz os times da conta e espelha em `RagnabotSetor`. */
export async function sincronizarSetores({ tenantId, cwAccountId } = {}) {
  const p = exigePlataforma();
  const times = await p.listarTimes({ cwAccountId });
  const vistos = new Set();
  let tocados = 0;
  for (const t of times) {
    const cwTeamId = inteiroOuNulo(t.id);
    if (cwTeamId === null) continue;
    vistos.add(cwTeamId);
    const dados = {
      tenantId: String(tenantId),
      nome: String(t.nome ?? t.name ?? `Setor ${cwTeamId}`),
      descricao: t.descricao ?? t.description ?? null,
      ativo: true,
      sincronizadoEm: new Date(),
    };
    await db().ragnabotSetor.upsert({
      where: { cwAccountId_cwTeamId: { cwAccountId, cwTeamId } },
      create: { cwAccountId, cwTeamId, ...dados },
      update: dados,
    });
    tocados += 1;
  }
  // Time que sumiu da plataforma vira inativo — nunca apagado (conversa antiga aponta o nome dele).
  const desligados = await db().ragnabotSetor.updateMany({
    where: { cwAccountId, ativo: true, cwTeamId: { notIn: [...vistos] } },
    data: { ativo: false, sincronizadoEm: new Date() },
  });
  // "tocados" é o número honesto: o upsert não distingue criação de atualização sem uma leitura a
  // mais por time, e inventar a distinção seria número bonito e falso.
  return { tocados, desativados: desligados?.count ?? 0, times: vistos.size };
}

/** Traz os membros de cada time e espelha em `RagnabotAgenteSetor`. */
export async function sincronizarMembrosDosSetores({ tenantId, cwAccountId } = {}) {
  const p = exigePlataforma();
  const setores = await db().ragnabotSetor.findMany({ where: { cwAccountId, ativo: true } });
  let vinculos = 0; let removidos = 0;
  for (const s of setores) {
    const membros = await p.membrosDoTime({ cwAccountId, cwTeamId: s.cwTeamId });
    const ids = [];
    for (const m of membros) {
      const cwUserId = inteiroOuNulo(m.id);
      if (cwUserId === null) continue;
      ids.push(cwUserId);
      const dados = {
        tenantId: String(tenantId),
        agenteNome: m.nome ?? m.name ?? null,
        agenteEmail: m.email ?? null,
        sincronizadoEm: new Date(),
      };
      await db().ragnabotAgenteSetor.upsert({
        where: { cwAccountId_cwUserId_cwTeamId: { cwAccountId, cwUserId, cwTeamId: s.cwTeamId } },
        create: { cwAccountId, cwUserId, cwTeamId: s.cwTeamId, ...dados },
        update: dados,
      });
      vinculos += 1;
    }
    // Quem saiu do time PERDE o vínculo — e com ele a visão da fila daquele setor. Manter seria
    // conceder acesso que a empresa já retirou, que é o defeito mais comum deste tipo de espelho.
    const fora = await db().ragnabotAgenteSetor.deleteMany({
      where: { cwAccountId, cwTeamId: s.cwTeamId, cwUserId: { notIn: ids } },
    });
    removidos += fora?.count ?? 0;
  }
  return { vinculos, removidos, setores: setores.length };
}

export default {
  ESTADOS, ABAS, SUBABAS, ESTADOS_ABERTOS,
  classificarEstado, etiquetasDaConversa, paraTela,
  clausulaDeEmpresa, clausulaDeVisibilidade, podeAdministrar, agenteDaSessao, setoresDoAgente,
  montarOnde, ordenacaoDaAba, listar, contar, obter, historicoDoContato, listarSetores,
  projetarConversa, sincronizarSetores, sincronizarMembrosDosSetores,
  modeloPronto, configurarCaixa, portasDaCaixa,
};
