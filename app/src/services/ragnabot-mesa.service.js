// ════════════════════════════════════════════════════════════════════════════════════════════════
// A MESA DE ATENDIMENTO — aceitar, espiar, escrever e transferir.  Contrato S-ATENDER (03/09/2026)
//
// ── A FRASE DO DONO QUE ESTE ARQUIVO IMPLEMENTA ─────────────────────────────────────────────────
//   «quando chega uma mensagem eu não consigo aceitar ela, para ficar associada a mim como agente.
//    Eu não deveria ter condição de escrever ou interagir com o chat senão aceitar como agente.
//    Pode haver apenas um botão com símbolo de olhos para ver o que tem dentro da conversa — mas
//    para escrever, apenas se tiver atribuída a mim como agente. E também ainda não tem o botão de
//    transferência para outro analista e/ou setor.»
//
// ── FRONTEIRA COM `ragnabot-caixa.service.js` ───────────────────────────────────────────────────
// Aquele arquivo decide QUEM VÊ O QUÊ (o `where` de toda consulta). Este decide QUEM PODE AGIR e
// executa a ação. A cláusula de visibilidade NÃO é reescrita aqui: toda ação começa por
// `obterLinha()`, que já a carrega. Um segundo lugar montando a mesma regra seria o defeito.
//
// ── ⭐ A CORRIDA — dois atendentes clicando "Aceitar" no mesmo instante ─────────────────────────
// Exatamente UM leva. E isso se resolve NO BANCO, nunca com um `if` na tela nem com um `findFirst`
// seguido de `update` (entre os dois cabe o clique do colega — é a corrida clássica, e ela acontece
// justamente no pico, quando duas pessoas olham a mesma fila).
//
// O que este arquivo faz é UMA sentença condicional:
//     UPDATE … SET "cwAssigneeId" = <eu> WHERE "id" = <x> AND "cwAssigneeId" IS NULL
// O Postgres serializa as duas escritas na mesma linha: a primeira grava e o `count` volta 1; a
// segunda reavalia o `WHERE` depois do commit da primeira, não casa mais, e o `count` volta 0.
// `count === 0` NÃO é erro genérico — é «alguém chegou antes», e a resposta diz o nome de quem foi.
//
// ── ⛔ ESCREVER SÓ SE FOR MINHA, E A RECUSA É DO SERVIDOR ───────────────────────────────────────
// Esconder o campo de texto não é regra, é decoração. `enviarMensagem()` compara `cwAssigneeId` da
// LINHA com o atendente da SESSÃO. Um agente mandando POST pela API numa conversa que não é dele
// recebe 403 — provado em `tests/ragnabot-mesa-atender.test.mjs`, prova 4.
//
// ── A DECISÃO SOBRE O ADMINISTRADOR, ESCRITA E NÃO ESCONDIDA ────────────────────────────────────
// O administrador **também precisa aceitar para escrever**. Mensagem sem dono é responsabilidade
// que se perde: seis meses depois, «quem respondeu isso?» não tem resposta, e o histórico do
// cliente fica com um texto órfão. O que o administrador tem a mais é o poder de **assumir** —
// tomar para si uma conversa que já tem dono, num clique. Isso não é atalho: é transferência, e é
// registrada como tal (`RagnabotAtendTransferencia`, origem `manual`), com o nome de quem tomou.
//
// ── A DECISÃO SOBRE O HISTÓRICO DA CONVERSA TRANSFERIDA ─────────────────────────────────────────
// O S2 separa histórico POR SETOR. Ao transferir de setor, a conversa **vai inteira** para o novo
// setor (`cwTeamId` muda) — quem recebe a enxerga, lê tudo o que já foi dito nela e responde. O que
// NÃO vai junto é o histórico das OUTRAS conversas daquele cliente no setor de origem: continuam
// invisíveis para quem recebeu. Se fossem juntas, uma transferência abriria o histórico inteiro de
// outro setor — exatamente o que o dono proibiu ao dizer «os históricos devem ficar a cada setor e
// não global». A ponte entre os dois lados é a NOTA INTERNA da transferência, que quem recebe lê
// dentro da própria conversa. Provado em `tests/ragnabot-mesa-atender.test.mjs`, prova 6.
//
// ── ORDEM DAS ESCRITAS: BANCO PRIMEIRO, PLATAFORMA DEPOIS ───────────────────────────────────────
// O árbitro da corrida é o NOSSO banco (a plataforma não tem atribuição condicional — lá é
// último-que-escreve-vence, e dois cliques simultâneos terminariam com os dois «ganhando»). Feita a
// arbitragem, a atribuição é aplicada na plataforma, para que a tela dela e a nossa não discordem.
// Se a plataforma recusar, a aceitação NÃO é desfeita: desfazê-la entregaria a conversa ao segundo
// clicador enquanto a plataforma já mostra o primeiro — divergência pior que a original. O que se
// faz é devolver o aviso, gravar a divergência em auditoria e seguir. Honesto e reparável.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import { registrar as auditar } from './ragnabot-auditoria.service.js';
import {
  ESTADOS_ABERTOS, agenteDaSessao, classificarEstado, clausulaDeEmpresa, obterLinha, paraTela,
  podeAdministrar, setoresDoAgente,
} from './ragnabot-caixa.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — mesma injeção da caixa e do motor. O teste troca a IMPLEMENTAÇÃO, nunca o caminho.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  /** `ragnabot-chatwoot.porta.js`. Nulo = as ações que precisam dela avisam, e não fingem. */
  plataforma: null,
  /** `registrar(evento)` da auditoria. Nulo = usa o módulo direto. */
  auditoria: null,
  log: logger,
};

export function configurarMesa(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na mesa: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDaMesa() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/** Erro com código E status. A rota traduz; o serviço não sabe o que é HTTP. */
export class ErroDaMesa extends Error {
  constructor(code, mensagem, status = 400, extras = {}) {
    super(mensagem);
    this.name = 'ErroDaMesa';
    this.code = code;
    this.status = status;
    Object.assign(this, extras);
  }
}

function inteiroOuNulo(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Registra sem nunca derrubar a ação. Auditoria perdida é ruim; atendimento derrubado é pior. */
async function registrarNaAuditoria(evento) {
  try {
    const fn = portas.auditoria?.registrar ?? auditar;
    await fn({ categoria: 'atendimento', ...evento });
  } catch (e) {
    log().warn?.(`[mesa] auditoria não registrada: ${e.message.slice(0, 160)}`);
  }
}

/** O ator, no formato que a auditoria espera. Vem SEMPRE da sessão, nunca do corpo do pedido. */
function ator(user) {
  return {
    atorTipo: 'usuario',
    atorId: user?.id ? String(user.id) : null,
    atorNome: user?.name ?? user?.nome ?? null,
    atorEmail: user?.email ?? null,
  };
}

/**
 * A CONVERSA que este usuário pode agir sobre — ou a recusa.
 *
 * Recusa é 404 e não 403: 403 confirmaria ao curioso que aquele número de conversa existe, que é
 * metade do vazamento. Mesma regra da caixa.
 */
async function exigirConversa(user, cwConversationId) {
  const linha = await obterLinha(user, cwConversationId);
  if (!linha) {
    throw new ErroDaMesa('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
  }
  return linha;
}

/**
 * ⭐ A CONVERSA QUE ACABOU DE SAIR DA MINHA FILA — e é só para isto que ela serve.
 *
 * ── O DEFEITO QUE ESTA FUNÇÃO CONSERTA (medido, não imaginado) ─────────────────────────────────
 * Na primeira execução do teste da corrida, o perdedor recebeu **404 «conversa não encontrada»**.
 * Está tecnicamente certo — no instante seguinte ao aceite do colega, a conversa deixou MESMO de
 * ser visível para ele (é o isolamento do S2 funcionando). Mas é uma mentira de operação: a
 * conversa estava na tela dele um segundo atrás, ele clicou, e o produto respondeu que ela nunca
 * existiu. O contrato pediu o contrário com todas as letras: «o segundo recebe recusa clara — já
 * foi aceita por Fulano —, não um erro genérico».
 *
 * ── E POR QUE ISTO NÃO É UM FURO NO ISOLAMENTO ─────────────────────────────────────────────────
 * A busca é estreita de propósito e só confirma o que a pessoa JÁ TINHA DIREITO DE VER:
 *   · mesma empresa (cláusula de empresa, igual a todas as consultas da caixa);
 *   · a conversa TEM dono agora (se não tivesse, `obterLinha` a teria devolvido);
 *   · e ela está num setor de que ESTE usuário é membro — ou seja, ela estava na fila DELE.
 * Fora dessa combinação a resposta continua sendo 404, e nada é revelado. É por isso que a função
 * existe separada, com nome próprio: para ninguém a reaproveitar como atalho de visibilidade.
 */
async function conversaTomadaNoMeioDoCaminho(user, cwConversationId) {
  const empresa = clausulaDeEmpresa(user);
  if (!empresa) return null;
  const id = inteiroOuNulo(cwConversationId);
  if (id === null) return null;

  const e = [{ cwConversationId: id }, { NOT: { cwAssigneeId: null } }];
  if (Object.keys(empresa).length) e.push(empresa);
  if (!podeAdministrar(user)) {
    const meus = await setoresDoAgente(user);
    if (meus.length === 0) return null; // sem setor não havia fila — logo, não havia o que perder
    e.push({ cwTeamId: { in: meus } });
  }
  return db().ragnabotConversa.findFirst({ where: { AND: e } });
}

function exigirPlataforma() {
  if (!portas.plataforma) {
    throw new ErroDaMesa(
      'PLATAFORMA_AUSENTE',
      'A ligação com a plataforma de atendimento não está configurada neste processo.',
      503,
    );
  }
  return portas.plataforma;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// QUEM PODE O QUÊ — funções PURAS, para a regra caber em dez linhas e ser provada sem banco
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ ESCREVER SÓ SE FOR MINHA. Inclusive para o administrador.
 *
 * @param {object} user
 * @param {{cwAssigneeId:(number|null)}} linha
 * @returns {{pode:boolean, motivo:(string|null)}}
 */
export function podeEscrever(user, linha) {
  const eu = agenteDaSessao(user);
  if (eu === null) return { pode: false, motivo: 'SEM_IDENTIDADE_DE_ATENDENTE' };
  if (linha?.cwAssigneeId === null || linha?.cwAssigneeId === undefined) {
    return { pode: false, motivo: 'CONVERSA_SEM_DONO' };
  }
  if (linha.cwAssigneeId !== eu) return { pode: false, motivo: 'CONVERSA_DE_OUTRO_ATENDENTE' };
  return { pode: true, motivo: null };
}

/** A frase da recusa, em português de gente. A tela mostra isto; ninguém traduz código. */
export const EXPLICACAO = Object.freeze({
  SEM_IDENTIDADE_DE_ATENDENTE:
    'A sua conta não está ligada a um atendente da plataforma — sem isso não dá para assinar uma resposta.',
  CONVERSA_SEM_DONO:
    'Esta conversa ainda não é de ninguém. Clique em "Aceitar" para assumi-la e poder responder.',
  CONVERSA_DE_OUTRO_ATENDENTE:
    'Esta conversa está com outro atendente. Para responder, ela precisa ser transferida para você.',
});

/** Pode transferir: o dono da conversa, quem administra, ou quem a vê livre na fila do setor. */
export function podeTransferir(user, linha) {
  if (podeAdministrar(user)) return { pode: true, motivo: null };
  const eu = agenteDaSessao(user);
  if (eu === null) return { pode: false, motivo: 'SEM_IDENTIDADE_DE_ATENDENTE' };
  if (linha?.cwAssigneeId === eu) return { pode: true, motivo: null };
  // Triagem: conversa livre que ele já enxerga (só chega aqui o que passou pela visibilidade) pode
  // ser encaminhada ao setor certo. É o trabalho de quem olha a fila — e não tira nada de ninguém.
  if (linha?.cwAssigneeId === null || linha?.cwAssigneeId === undefined) return { pode: true, motivo: null };
  return { pode: false, motivo: 'CONVERSA_DE_OUTRO_ATENDENTE' };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. ACEITAR — a corrida
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ ACEITAR: a conversa passa a ser minha. Exatamente um vencedor entre N cliques simultâneos.
 *
 * @param {object} user
 * @param {number} cwConversationId
 * @param {{cwTeamId?:number}} [opcoes] setor a carimbar junto (a conversa da fila costuma vir sem)
 * @returns {Promise<{ok:true, conversa:object, plataforma:object}>}
 * @throws {ErroDaMesa} `JA_ACEITA` (409) quando alguém chegou primeiro
 */
export async function aceitar(user, cwConversationId, { cwTeamId } = {}) {
  let linha = await obterLinha(user, cwConversationId);
  if (!linha) {
    // ⭐ Perdi a corrida? A conversa sumiu da minha vista porque o colega a aceitou meio segundo
    // antes. Dizer «não encontrada» aqui seria negar o que estava na tela — ver o cabeçalho de
    // `conversaTomadaNoMeioDoCaminho`.
    const tomada = await conversaTomadaNoMeioDoCaminho(user, cwConversationId);
    if (!tomada) throw new ErroDaMesa('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
    throw await recusarPorqueJaFoiAceita(user, tomada);
  }
  const eu = agenteDaSessao(user);
  if (eu === null) {
    throw new ErroDaMesa('SEM_IDENTIDADE_DE_ATENDENTE', EXPLICACAO.SEM_IDENTIDADE_DE_ATENDENTE, 409);
  }

  // Aceitar conversa encerrada não é aceitar, é reabrir — outra ação, com outras consequências.
  if (!ESTADOS_ABERTOS.includes(linha.estado)) {
    throw new ErroDaMesa('CONVERSA_ENCERRADA',
      'Esta conversa já foi encerrada. Para retomá-la, o cliente precisa escrever de novo.', 409);
  }

  // Já é minha: idempotente. Clicar duas vezes (ou dois separadores de aba) não pode virar erro.
  if (linha.cwAssigneeId === eu) {
    return { ok: true, jaEraMinha: true, conversa: paraTela(linha), plataforma: { aplicada: true } };
  }

  const setor = inteiroOuNulo(cwTeamId);
  const dados = {
    cwAssigneeId: eu,
    atendenteNome: user?.name ?? user?.nome ?? null,
    estado: classificarEstado({
      statusPlataforma: linha.estadoPlataforma || 'open', cwAssigneeId: eu, comRobo: linha.comRobo,
    }),
    ultimaAtividadeEm: new Date(),
  };
  // O setor só é carimbado quando a conversa não tem nenhum. Sobrescrever o setor de uma conversa
  // já roteada seria transferência disfarçada de aceite — e sem registro.
  if (setor !== null && (linha.cwTeamId === null || linha.cwTeamId === undefined)) dados.cwTeamId = setor;

  // ⭐ A SENTENÇA CONDICIONAL. `cwAssigneeId: null` no `where` é a corrida inteira.
  const r = await db().ragnabotConversa.updateMany({
    where: { id: linha.id, cwAssigneeId: null },
    data: dados,
  });

  if (r.count === 0) {
    // Perdi por milissegundos: entre a leitura e a escrita, o colega gravou. Releio para dizer o
    // NOME de quem levou — «erro ao aceitar» mandaria o atendente recarregar a tela para descobrir
    // sozinho o que o servidor já sabe.
    const agora = await db().ragnabotConversa.findUnique({ where: { id: linha.id } });
    throw await recusarPorqueJaFoiAceita(user, agora ?? linha);
  }

  const atualizada = await db().ragnabotConversa.findUnique({ where: { id: linha.id } });
  const plataforma = await aplicarAtribuicaoNaPlataforma({
    linha: atualizada, cwAssigneeId: eu, user, acao: 'aceite',
  });

  await registrarNaAuditoria({
    ...ator(user), tenantId: linha.tenantId, acao: 'atendimento_aceito',
    descricao: `assumiu a conversa ${linha.cwConversationId}`
      + (linha.contatoNome ? ` (${linha.contatoNome})` : ''),
    entidade: 'conversa', entidadeId: String(linha.cwConversationId), protocolo: linha.protocolo || null,
    antes: { cwAssigneeId: null, estado: linha.estado },
    depois: { cwAssigneeId: eu, estado: atualizada.estado, plataformaAplicada: plataforma.aplicada },
  });

  return { ok: true, conversa: paraTela(atualizada), plataforma };
}

/**
 * A RECUSA DA CORRIDA, com nome e sobrenome. Um lugar só: os dois caminhos que perdem (a linha
 * sumiu da vista, ou o `updateMany` não casou) precisam dizer exatamente a mesma frase — senão o
 * atendente aprende duas explicações para o mesmo fato.
 */
async function recusarPorqueJaFoiAceita(user, linha) {
  const nome = linha?.atendenteNome
    || (linha?.cwAssigneeId ? `atendente ${linha.cwAssigneeId}` : 'outra pessoa');
  await registrarNaAuditoria({
    ...ator(user), tenantId: linha?.tenantId ?? null, acao: 'atendimento_aceite_perdido',
    descricao: `tentou aceitar a conversa ${linha?.cwConversationId}, que já era de ${nome}`,
    entidade: 'conversa', entidadeId: String(linha?.cwConversationId ?? ''),
    protocolo: linha?.protocolo || null,
  });
  return new ErroDaMesa('JA_ACEITA', `Esta conversa já foi aceita por ${nome}.`, 409, {
    cwAssigneeId: linha?.cwAssigneeId ?? null, atendenteNome: linha?.atendenteNome ?? null,
  });
}

/**
 * A atribuição valendo TAMBÉM na plataforma — senão a tela dela e a nossa discordam.
 *
 * Nunca lança: a arbitragem já aconteceu no nosso banco, e derrubar a resposta por causa da
 * plataforma faria o atendente pensar que não conseguiu aceitar quando conseguiu.
 */
async function aplicarAtribuicaoNaPlataforma({ linha, cwAssigneeId, cwTeamId = undefined, user, acao }) {
  const p = portas.plataforma;
  if (!p?.atribuirAgente && !p?.transferirTime) {
    return { aplicada: false, motivo: 'PLATAFORMA_AUSENTE',
      aviso: 'A atribuição valeu aqui, mas não pôde ser espelhada na plataforma (ligação não configurada neste processo).' };
  }
  try {
    // Time primeiro: `transferirTime` da porta zera o atendente de propósito, então aplicá-lo
    // DEPOIS do agente apagaria a atribuição que acabamos de fazer. A ordem não é estética.
    if (cwTeamId !== undefined && cwTeamId !== null && p.transferirTime) {
      await p.transferirTime({ cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, cwTeamId });
    }
    if (p.atribuirAgente) {
      await p.atribuirAgente({
        cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, cwAssigneeId,
      });
    }
    return { aplicada: true };
  } catch (e) {
    const motivo = String(e?.message ?? e).slice(0, 300);
    log().warn?.(`[mesa] ${acao} da conversa ${linha.cwConversationId} não espelhado na plataforma: ${motivo}`);
    await registrarNaAuditoria({
      ...ator(user), tenantId: linha.tenantId, acao: 'atendimento_divergencia_plataforma',
      descricao: `${acao} valeu no painel mas a plataforma recusou: ${motivo}`,
      entidade: 'conversa', entidadeId: String(linha.cwConversationId),
    });
    return { aplicada: false, motivo: 'PLATAFORMA_RECUSOU', detalhe: motivo,
      aviso: 'Valeu aqui, mas a plataforma não confirmou. A tela dela pode demorar a mostrar o mesmo.' };
  }
}

/**
 * ASSUMIR — o administrador toma para si uma conversa que já tem dono.
 *
 * É TRANSFERÊNCIA, e é registrada como tal. O atalho existe porque a operação real precisa dele
 * (atendente saiu, adoeceu, largou a conversa aberta); o registro existe porque tomar o trabalho de
 * alguém sem deixar rastro é como o histórico de um atendimento vira discussão.
 */
export async function assumir(user, cwConversationId) {
  if (!podeAdministrar(user)) {
    throw new ErroDaMesa('SEM_PERMISSAO',
      'Só quem administra a empresa pode tomar para si uma conversa que já tem atendente.', 403);
  }
  const linha = await exigirConversa(user, cwConversationId);
  const eu = agenteDaSessao(user);
  if (eu === null) {
    throw new ErroDaMesa('SEM_IDENTIDADE_DE_ATENDENTE', EXPLICACAO.SEM_IDENTIDADE_DE_ATENDENTE, 409);
  }
  if (linha.cwAssigneeId === eu) {
    return { ok: true, jaEraMinha: true, conversa: paraTela(linha), plataforma: { aplicada: true } };
  }
  // Sem dono? Então é um aceite comum — e passa pela corrida, como todo mundo.
  if (linha.cwAssigneeId === null || linha.cwAssigneeId === undefined) {
    return aceitar(user, cwConversationId);
  }
  return transferir(user, cwConversationId, {
    paraCwUserId: eu,
    motivo: 'assumido pela administração',
    origem: 'manual',
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. ABRIR / ESPIAR — ver o que tem dentro, sem assumir
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ ABRE A CONVERSA: a ficha, as mensagens e a resposta a «posso escrever aqui?».
 *
 * ── ESCOPO DA ESPIADA, e a decisão está escrita ────────────────────────────────────────────────
 * Não há regra nova aqui: o alvo tem de passar pela cláusula de visibilidade do S2. Para o AGENTE
 * isso significa exatamente o que o contrato pediu — ele espia a fila dos setores de que é membro,
 * e NÃO espia conversa já atribuída a um colega (essa não passa na cláusula, e a resposta é 404).
 * Para o ADMINISTRADOR, que responde pela operação, a cláusula é vazia: ele abre qualquer conversa
 * da empresa dele. Isso não é exceção inventada agora — é o S2 desde o primeiro dia, e a espiada
 * dele fica registrada como a de qualquer um.
 *
 * ── POR QUE A AUDITORIA SÓ CARIMBA A ESPIADA ───────────────────────────────────────────────────
 * «Ver conversa de cliente é ato que se registra» — e é o que se faz: quem abre conversa que NÃO é
 * sua gera registro, sempre. Quem abre a PRÓPRIA conversa não gera: isso é o trabalho dele, já
 * registrado no aceite, e carimbar cada abertura encheria a auditoria de ruído até que ninguém mais
 * a lesse. Auditoria que ninguém lê não protege ninguém.
 *
 * @returns {Promise<{conversa:object, mensagens:object[], escrita:object, auditada:boolean}>}
 */
export async function abrirConversa(user, cwConversationId, { antesDe = null, comMensagens = true } = {}) {
  const linha = await exigirConversa(user, cwConversationId);
  const escrita = podeEscrever(user, linha);
  const espiada = !escrita.pode; // não é minha ⇒ estou espiando

  let mensagens = [];
  let avisoMensagens = null;
  if (comMensagens) {
    const p = portas.plataforma;
    if (!p?.lerMensagens) {
      avisoMensagens = 'A ligação com a plataforma não está configurada neste processo — a ficha aparece, '
        + 'o conteúdo da conversa não.';
    } else {
      try {
        const r = await p.lerMensagens({
          cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, antesDe,
        });
        mensagens = r?.itens ?? [];
      } catch (e) {
        // Falha de leitura NÃO derruba a abertura: a ficha (protocolo, setor, etiquetas) continua
        // útil, e o aviso diz o que faltou em vez de mostrar uma tela vazia sem explicação.
        avisoMensagens = `Não consegui ler as mensagens na plataforma: ${String(e?.message ?? e).slice(0, 200)}`;
        log().warn?.(`[mesa] mensagens da conversa ${linha.cwConversationId}: ${avisoMensagens}`);
      }
    }
  }

  if (espiada && antesDe === null) {
    // `antesDe === null` = abertura. Rolar para trás não gera registro novo — é a MESMA espiada.
    await registrarNaAuditoria({
      ...ator(user), tenantId: linha.tenantId, acao: 'atendimento_conversa_espiada',
      descricao: `abriu em leitura a conversa ${linha.cwConversationId}`
        + (linha.contatoNome ? ` (${linha.contatoNome})` : '')
        + (linha.atendenteNome ? `, de ${linha.atendenteNome}` : ', que está na fila'),
      entidade: 'conversa', entidadeId: String(linha.cwConversationId), protocolo: linha.protocolo || null,
      depois: { cwAssigneeId: linha.cwAssigneeId, setor: linha.cwTeamId, estado: linha.estado },
    });
  }

  return {
    conversa: paraTela(linha),
    mensagens,
    avisoMensagens,
    escrita: {
      pode: escrita.pode,
      motivo: escrita.motivo,
      explicacao: escrita.motivo ? EXPLICACAO[escrita.motivo] : null,
      // O que a tela oferece no lugar do campo de texto.
      podeAceitar: !escrita.pode && (linha.cwAssigneeId === null || linha.cwAssigneeId === undefined)
        && ESTADOS_ABERTOS.includes(linha.estado),
      podeAssumir: !escrita.pode && linha.cwAssigneeId !== null && linha.cwAssigneeId !== undefined
        && podeAdministrar(user),
      podeTransferir: podeTransferir(user, linha).pode,
    },
    espiada,
  };
}

/** O anexo, em bytes, para o painel entregar. Mesma trava de visibilidade da abertura. */
export async function anexoDaConversa(user, cwConversationId, { cwMessageId, indice = 0 } = {}) {
  const linha = await exigirConversa(user, cwConversationId);
  const p = exigirPlataforma();
  if (!p.baixarAnexo) {
    throw new ErroDaMesa('PLATAFORMA_AUSENTE', 'Este processo não sabe buscar mídia na plataforma.', 503);
  }
  const r = await p.baixarAnexo({
    cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, cwMessageId, indice,
  });
  if (!r) throw new ErroDaMesa('ANEXO_NAO_ENCONTRADO', 'Anexo não encontrado nesta conversa.', 404);
  return r;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. ESCREVER — só se for minha, e a recusa é do servidor
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⭐ ENVIA a mensagem ao cliente (ou a nota interna à equipe).
 *
 * A trava não é a ausência do campo na tela — é este `if`. Um agente com `curl` e a sessão dele
 * mandando POST numa conversa de outro recebe 403, e é o que a prova 4 do teste mede.
 *
 * @param {{texto:string, privada?:boolean}} p `privada: true` = NOTA INTERNA (não sai para o cliente)
 */
export async function enviarMensagem(user, cwConversationId, { texto, privada = false } = {}) {
  const linha = await exigirConversa(user, cwConversationId);
  const permissao = podeEscrever(user, linha);
  if (!permissao.pode) {
    // 403, e não 404: quem chegou aqui JÁ enxerga a conversa (passou pela visibilidade). Esconder o
    // motivo aqui só faria o atendente abrir chamado achando que é defeito.
    throw new ErroDaMesa(permissao.motivo, EXPLICACAO[permissao.motivo], 403, {
      podeAceitar: linha.cwAssigneeId === null || linha.cwAssigneeId === undefined,
    });
  }

  const corpo = String(texto ?? '').trim();
  if (!corpo) throw new ErroDaMesa('TEXTO_VAZIO', 'Escreva alguma coisa antes de enviar.', 400);
  if (corpo.length > 4096) {
    throw new ErroDaMesa('TEXTO_LONGO', 'A mensagem passa de 4096 caracteres — o canal não aceita.', 400);
  }

  const p = exigirPlataforma();
  const ehNota = privada === true;
  let enviada;
  try {
    enviada = ehNota
      ? await p.notaInterna({ cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, texto: corpo })
      : await p.enviarMensagem({ cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, texto: corpo });
  } catch (e) {
    // A janela de 24 h do WhatsApp mora aqui. A recusa é da plataforma e é LEGÍTIMA — repassá-la
    // com o motivo é melhor que um «erro interno» que manda o atendente tentar de novo em vão.
    throw new ErroDaMesa('PLATAFORMA_RECUSOU',
      `A plataforma não aceitou a mensagem: ${String(e?.message ?? e).slice(0, 300)}`, 502);
  }
  if (enviada === false) {
    throw new ErroDaMesa('PLATAFORMA_RECUSOU', 'A plataforma não aceitou a mensagem.', 502);
  }

  await db().ragnabotConversa.update({
    where: { id: linha.id }, data: { ultimaAtividadeEm: new Date() },
  }).catch(() => {});

  await registrarNaAuditoria({
    ...ator(user), tenantId: linha.tenantId,
    acao: ehNota ? 'atendimento_nota_interna' : 'atendimento_mensagem_enviada',
    // ⛔ O TEXTO DO CLIENTE NÃO ENTRA NA AUDITORIA. Registra-se o ATO e o tamanho, nunca o
    // conteúdo — auditoria não é cópia de conversa, e o conteúdo tem dono.
    descricao: `${ehNota ? 'nota interna' : 'mensagem'} de ${corpo.length} caracteres na conversa ${linha.cwConversationId}`,
    entidade: 'conversa', entidadeId: String(linha.cwConversationId), protocolo: linha.protocolo || null,
  });

  return {
    ok: true,
    privada: ehNota,
    id: typeof enviada === 'object' ? (enviada.id ?? null) : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. TRANSFERIR — para outro atendente e/ou outro setor
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Os destinos possíveis: os atendentes e os setores que ESTE usuário pode escolher.
 *
 * ⚠️ Os setores seguem a mesma regra da caixa: o agente só vê os dele. Já os ATENDENTES são todos
 * os da empresa — e isso é intencional: transferir só para dentro do próprio setor tornaria
 * impossível o encaminhamento que motivou o pedido («para outro analista e/ou setor»). Escolher a
 * quem passar não é ver a conversa de ninguém.
 */
export async function destinosDeTransferencia(user, { cwAccountId } = {}) {
  const eu = agenteDaSessao(user);
  const meus = await setoresDoAgente(user);
  const administra = podeAdministrar(user);

  const ondeSetor = {};
  if (!administra) ondeSetor.cwTeamId = { in: meus };
  const conta = inteiroOuNulo(cwAccountId) ?? inteiroOuNulo(user?.cwAccountId);
  if (conta !== null) ondeSetor.cwAccountId = conta;

  const setores = await db().ragnabotSetor.findMany({
    where: { ...ondeSetor, ativo: true }, orderBy: [{ nome: 'asc' }],
  });

  // Os atendentes saem do NOSSO espelho de membros de setor (`RagnabotAgenteSetor`), agrupados por
  // pessoa. É a lista que existe sem depender de a plataforma responder agora.
  const vinculos = await db().ragnabotAgenteSetor.findMany({
    where: conta !== null ? { cwAccountId: conta } : {},
    orderBy: [{ agenteNome: 'asc' }],
  });
  const porPessoa = new Map();
  for (const v of vinculos) {
    if (!porPessoa.has(v.cwUserId)) {
      porPessoa.set(v.cwUserId, { cwUserId: v.cwUserId, nome: v.agenteNome || `Atendente ${v.cwUserId}`, email: v.agenteEmail || null, setores: [] });
    }
    porPessoa.get(v.cwUserId).setores.push(v.cwTeamId);
  }

  return {
    setores: setores.map((s) => ({ cwTeamId: s.cwTeamId, nome: s.nome })),
    // Eu mesmo saio da lista: «transferir para mim» é o botão Aceitar, e oferecer as duas coisas
    // no mesmo lugar é como se cria a dúvida de qual delas registra o quê.
    atendentes: [...porPessoa.values()].filter((a) => a.cwUserId !== eu),
    aviso: (!administra && meus.length === 0)
      ? 'Você ainda não está em nenhum setor — peça a sincronização a quem administra a empresa.'
      : null,
  };
}

/**
 * ⭐ TRANSFERE a conversa. Para uma PESSOA, para um SETOR, ou para os dois.
 *
 * O que muda, e por quê:
 *   · só `paraCwTeamId`  → a conversa volta para a FILA daquele setor (`cwAssigneeId = null`).
 *     Transferir para um setor mantendo o atendente anterior não é transferência, é etiqueta.
 *   · `paraCwUserId`     → a conversa passa a ser daquela pessoa, e é ela quem a enxerga.
 *   · os dois juntos     → setor novo E dono novo, numa operação só.
 *
 * A troca de dono muda QUEM VÊ na mesma hora, porque a visibilidade do S2 é `where` de consulta:
 * mudou a linha, mudou a resposta da próxima consulta. Não há cache a invalidar — e é por isso que
 * a regra mora no banco.
 */
export async function transferir(user, cwConversationId, {
  paraCwUserId = null, paraCwTeamId = null, motivo = null, notaInterna = null,
  avisarCliente = false, mensagemAoCliente = null, origem = 'manual',
} = {}) {
  const linha = await exigirConversa(user, cwConversationId);
  const permissao = podeTransferir(user, linha);
  if (!permissao.pode) {
    throw new ErroDaMesa(permissao.motivo,
      'Esta conversa está com outro atendente — só ele ou quem administra a empresa pode transferi-la.', 403);
  }

  const paraAgente = inteiroOuNulo(paraCwUserId);
  const paraSetor = inteiroOuNulo(paraCwTeamId);
  if (paraAgente === null && paraSetor === null) {
    throw new ErroDaMesa('DESTINO_OBRIGATORIO', 'Escolha um atendente, um setor, ou os dois.', 400);
  }
  if (paraAgente !== null && paraAgente === linha.cwAssigneeId && (paraSetor === null || paraSetor === linha.cwTeamId)) {
    throw new ErroDaMesa('DESTINO_IGUAL', 'A conversa já está exatamente aí.', 409);
  }

  // ── o destino EXISTE? ───────────────────────────────────────────────────────────────────────
  // Recusar com o nome do destino é melhor que mandar a conversa para um número que não é ninguém
  // — e conversa mandada para o vazio some da fila de todo mundo, que é o pior defeito possível.
  let setorDestino = null;
  if (paraSetor !== null) {
    setorDestino = await db().ragnabotSetor.findFirst({
      where: { cwAccountId: linha.cwAccountId, cwTeamId: paraSetor },
    });
    if (!setorDestino) {
      throw new ErroDaMesa('SETOR_DESCONHECIDO',
        `Não encontrei o setor ${paraSetor} nesta empresa. Sincronize os setores e tente de novo.`, 422);
    }
  }
  let agenteDestino = null;
  if (paraAgente !== null && paraAgente === agenteDaSessao(user)) {
    // ⭐ Transferir para MIM MESMO (é o «assumir» do administrador) não pode depender do espelho de
    // membros de setor estar sincronizado: quem está pedindo é a própria sessão, e ela já provou
    // quem é ao entrar. Medido: sem esta linha, o administrador — que costuma não pertencer a setor
    // nenhum — levava 422 «não encontrei o atendente 1» ao tentar assumir uma conversa.
    agenteDestino = { cwUserId: paraAgente, nome: user?.name ?? user?.nome ?? null };
  } else if (paraAgente !== null) {
    const vinculo = await db().ragnabotAgenteSetor.findFirst({
      where: { cwAccountId: linha.cwAccountId, cwUserId: paraAgente },
    });
    if (vinculo) agenteDestino = { cwUserId: paraAgente, nome: vinculo.agenteNome || null };
    else if (portas.plataforma?.listarAgentes) {
      // Atendente que não está em setor nenhum não aparece no espelho — perguntar à plataforma
      // evita recusar uma transferência legítima por causa de um cadastro incompleto.
      const todos = await portas.plataforma.listarAgentes({ cwAccountId: linha.cwAccountId }).catch(() => []);
      const achado = todos.find((a) => Number(a.id) === paraAgente);
      if (achado) agenteDestino = { cwUserId: paraAgente, nome: achado.nome || null };
    }
    if (!agenteDestino) {
      throw new ErroDaMesa('ATENDENTE_DESCONHECIDO',
        `Não encontrei o atendente ${paraAgente} nesta empresa.`, 422);
    }
  }

  // ── a mudança ───────────────────────────────────────────────────────────────────────────────
  const novoAssignee = paraAgente !== null ? paraAgente : null; // só setor ⇒ volta para a fila
  const novoNome = paraAgente !== null ? (agenteDestino?.nome ?? null) : null;
  const dados = {
    cwAssigneeId: novoAssignee,
    atendenteNome: novoNome,
    estado: classificarEstado({
      statusPlataforma: linha.estadoPlataforma || 'open',
      cwAssigneeId: novoAssignee, comRobo: linha.comRobo,
    }),
    ultimaAtividadeEm: new Date(),
  };
  if (paraSetor !== null) {
    dados.cwTeamId = paraSetor;
    dados.setorNome = setorDestino?.nome ?? null;
  }

  const atualizada = await db().ragnabotConversa.update({ where: { id: linha.id }, data: dados });

  // ── a plataforma ────────────────────────────────────────────────────────────────────────────
  const plataforma = await aplicarAtribuicaoNaPlataforma({
    linha: atualizada, cwAssigneeId: novoAssignee,
    cwTeamId: paraSetor !== null ? paraSetor : undefined,
    user, acao: 'transferência',
  });

  // ── o REGISTRO — em `RagnabotAtendTransferencia`, a tabela que já existia para isto ─────────
  const registro = {
    tenantId: linha.tenantId,
    cwAccountId: linha.cwAccountId,
    cwConversationId: linha.cwConversationId,
    protocolo: linha.protocolo || null,
    deTipo: linha.cwAssigneeId !== null && linha.cwAssigneeId !== undefined
      ? 'agente' : (linha.comRobo ? 'bot' : (linha.cwTeamId ? 'time' : 'ninguem')),
    deId: linha.cwAssigneeId ?? linha.cwTeamId ?? null,
    deNome: linha.atendenteNome ?? linha.setorNome ?? null,
    paraTipo: paraAgente !== null ? 'agente' : 'time',
    paraId: paraAgente !== null ? paraAgente : paraSetor,
    paraNome: paraAgente !== null ? (agenteDestino?.nome ?? null) : (setorDestino?.nome ?? null),
    motivo: motivo ? String(motivo).slice(0, 200) : null,
    notaInterna: notaInterna ? String(notaInterna).slice(0, 2000) : null,
    origem: String(origem || 'manual'),
    atorUserId: user?.id ? String(user.id) : null,
  };
  let transferenciaId = null;
  try {
    const criada = await db().ragnabotAtendTransferencia.create({ data: registro });
    transferenciaId = criada?.id ?? null;
  } catch (e) {
    // A conversa JÁ mudou de dono. Perder o registro é ruim; desfazer a transferência por causa do
    // registro seria pior — a conversa voltaria para quem já não está com ela. Fica o aviso.
    log().warn?.(`[mesa] transferência aplicada mas não registrada: ${e.message.slice(0, 200)}`);
  }

  // ── a ponte para quem recebe: a nota interna ────────────────────────────────────────────────
  // É o que atravessa a fronteira de setor. O histórico das OUTRAS conversas não vai junto (ver o
  // cabeçalho); esta nota vai, porque está DENTRO da conversa transferida.
  const textoDaNota = montarNotaDeTransferencia({ user, registro });
  let notaAplicada = false;
  if (portas.plataforma?.notaInterna) {
    try {
      await portas.plataforma.notaInterna({
        cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, texto: textoDaNota,
      });
      notaAplicada = true;
    } catch (e) {
      log().warn?.(`[mesa] nota de transferência não registrada na conversa: ${e.message.slice(0, 160)}`);
    }
  }

  // ── o aviso ao cliente (opcional, e falhar aqui NÃO desfaz a transferência) ─────────────────
  let avisoAoCliente = null;
  if (avisarCliente === true) {
    const texto = String(mensagemAoCliente || '').trim()
      || `Você está sendo transferido para ${registro.paraNome || (paraAgente !== null ? 'outro atendente' : 'outro setor')}. Um momento, por favor.`;
    try {
      if (!portas.plataforma?.enviarMensagem) throw new Error('ligação com a plataforma não configurada');
      await portas.plataforma.enviarMensagem({
        cwAccountId: linha.cwAccountId, cwConversationId: linha.cwConversationId, texto,
      });
      avisoAoCliente = { enviado: true };
    } catch (e) {
      // Janela de 24 h fechada é o caso comum. O estado muda, a mensagem não — regra §5.6, já paga.
      avisoAoCliente = { enviado: false, motivo: String(e?.message ?? e).slice(0, 200) };
    }
  }

  await registrarNaAuditoria({
    ...ator(user), tenantId: linha.tenantId, acao: 'atendimento_transferido',
    descricao: `transferiu a conversa ${linha.cwConversationId} de `
      + `${registro.deNome || registro.deTipo} para ${registro.paraTipo} ${registro.paraNome || registro.paraId}`
      + (registro.motivo ? ` — ${registro.motivo}` : ''),
    entidade: 'conversa', entidadeId: String(linha.cwConversationId), protocolo: linha.protocolo || null,
    antes: { cwAssigneeId: linha.cwAssigneeId, cwTeamId: linha.cwTeamId },
    depois: { cwAssigneeId: novoAssignee, cwTeamId: atualizada.cwTeamId, transferenciaId },
  });

  return {
    ok: true,
    conversa: paraTela(atualizada),
    transferencia: { id: transferenciaId, ...registro },
    plataforma,
    nota: { aplicada: notaAplicada, texto: textoDaNota },
    avisoAoCliente,
    // A frase que a tela mostra. Diz o efeito REAL — inclusive que ela sai da lista de quem mandou.
    recado: paraAgente !== null
      ? `Conversa transferida para ${registro.paraNome || `atendente ${paraAgente}`}.`
        + ' A partir de agora ela aparece na caixa dele.'
      : `Conversa devolvida à fila do setor ${registro.paraNome || paraSetor}.`
        + ' Quem for membro daquele setor já a vê na aba Aguardando.',
  };
}

/** O texto da nota interna da transferência. Formato fixo: quem lê depois procura sempre o mesmo. */
export function montarNotaDeTransferencia({ user, registro }) {
  const quem = user?.name ?? user?.nome ?? 'a equipe';
  const destino = registro.paraTipo === 'agente'
    ? `o atendente ${registro.paraNome || registro.paraId}`
    : `o setor ${registro.paraNome || registro.paraId}`;
  const partes = [`🔀 Transferido por ${quem} para ${destino}.`];
  if (registro.motivo) partes.push(`Motivo: ${registro.motivo}`);
  if (registro.notaInterna) partes.push(`Observação: ${registro.notaInterna}`);
  return partes.join('\n');
}

/** A tabela pode não ter migrado no banco onde este processo subiu. Guarda explícita, como na caixa. */
export function modeloPronto() {
  return Boolean(db()?.ragnabotConversa && typeof db().ragnabotConversa.updateMany === 'function');
}

export default {
  configurarMesa, portasDaMesa, ErroDaMesa, EXPLICACAO,
  podeEscrever, podeTransferir,
  aceitar, assumir, abrirConversa, anexoDaConversa, enviarMensagem,
  transferir, destinosDeTransferencia, montarNotaDeTransferencia, modeloPronto,
};
