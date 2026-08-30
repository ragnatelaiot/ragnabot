// ════════════════════════════════════════════════════════════════════════════════════════════════
// RESPOSTAS RÁPIDAS — os atalhos de texto do atendente (C9).
//
// O QUE É: o atendente digita `/bomdia` na caixa de resposta e o texto inteiro aparece, já com o
// nome do cliente, o número do protocolo e o número do atendimento trocados. É a funcionalidade de
// menor custo e maior uso diário da lista — medido em 29/08/2026, o menu Gestão do chat atual tem
// "Respostas rápidas" (a instância de referência está com ZERO cadastradas hoje; o levantamento de
// 18-LEVANTAMENTO-CHAT-ATUAL.md contou 39 em 4 empresas).
//
// ── FRONTEIRA DESTE ARQUIVO ─────────────────────────────────────────────────────────────────────
// Aqui mora a DECISÃO: o que é um atalho válido, qual resposta ganha quando duas casam, quais são
// as variáveis e como o texto é expandido. As rotas (`ragnabot-respostas-rapidas.routes.js`) só
// validam a entrada, isolam por empresa, gravam e auditam. Duas verdades sobre "qual resposta o
// `/bomdia` aciona" seria a tela mostrando uma coisa e a caixa de resposta colando outra.
//
// ── POR QUE A INTERPOLAÇÃO É IMPORTADA, E NÃO ESCRITA AQUI ──────────────────────────────────────
// `interpolar()` de `ragnabot-fluxo-nos.service.js` já é a interpolação da casa: passada única (o
// valor substituído nunca é reinterpolado, então o cliente que digitar `{{protocolo}}` dentro do
// próprio nome não recebe o protocolo de volta), escape por destino e relatório de variáveis
// ausentes. Reescrever uma segunda seria assinar que um dia as duas divergem — e quem descobre é o
// cliente, lendo `{{contactFirstName}}` cru numa mensagem.
//
// ── ISOLAMENTO ──────────────────────────────────────────────────────────────────────────────────
// Toda função que toca o banco recebe o USUÁRIO e deriva a empresa por `escopoDe()`. Nenhuma delas
// aceita `tenantId` solto de quem chama — foi confiando na empresa que a TELA mandava que o sistema
// antigo vazou. Fora do escopo, `obter()` devolve `null`, e a rota traduz em 404 (não 403: 403
// confirmaria que aquele id existe em alguma empresa).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';
import { escopoDe } from './ragnabot-auditoria.service.js';
import { interpolar } from './ragnabot-fluxo-nos.service.js';

// ── VOCABULÁRIO FECHADO ─────────────────────────────────────────────────────────────────────────
// String livre em coluna de decisão é como nasce o quinto valor que nenhum consumidor sabe tratar.
export const VISIBILIDADES = Object.freeze(['empresa', 'pessoal']);

/** Limites conservadores. O texto grande é legítimo (um script de cobrança inteiro), o atalho não. */
export const LIMITES = Object.freeze({
  atalho: 40,
  titulo: 120,
  mensagem: 4000,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ATALHO — normalização
//
// ⚠️ O QUE ESTA FUNÇÃO EVITA (é o defeito nº 1 do recurso na origem, e está no manual como "erro
// comum"): o atendente cadastra `Bom Dia`, digita `/bomdia` e jura que a resposta sumiu. Acento,
// maiúscula, espaço e a barra da frente são ruído de digitação, não identidade. Guardamos a forma
// canônica — minúscula, sem acento, sem espaço, sem barra — e é ela que o índice único compara.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function normalizarAtalho(valor) {
  const cru = String(valor ?? '').trim();
  if (!cru) throw new Error('atalho: informe o atalho (ex.: /bomdia)');

  const semAcento = cru
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '') // tira o acento, mantém a letra
    .toLowerCase();

  // A barra é como o atendente ACIONA, não parte do nome. Só a da frente cai.
  const semBarra = semAcento.replace(/^\/+/u, '');
  // Espaço vira separador; qualquer outro caractere fora do conjunto seguro é descartado.
  const limpo = semBarra.replace(/\s+/gu, '_').replace(/[^a-z0-9_.-]/gu, '');

  if (!limpo) throw new Error('atalho: use letras ou números (ex.: /bomdia)');
  if (limpo.length > LIMITES.atalho) {
    throw new Error(`atalho: acima de ${LIMITES.atalho} caracteres`);
  }
  if (!/^[a-z0-9]/u.test(limpo)) {
    throw new Error('atalho: comece com letra ou número (ex.: /bomdia)');
  }
  return limpo;
}

/** Como o atalho é MOSTRADO e digitado. O banco guarda "bomdia"; a tela mostra "/bomdia". */
export function atalhoExibido(atalho) {
  return `/${atalho}`;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CHAVE DETERMINÍSTICA — a tranca de banco contra atalho repetido.
//
// ⚠️ O ÍNDICE ÚNICO NATURAL NÃO FUNCIONARIA. Seria (tenantId, atalho, cwInboxId, cwTeamId,
// visibilidade, userId) — e quatro dessas colunas são anuláveis. No PostgreSQL NULO ≠ NULO, então
// `/bomdia` da empresa poderia ser cadastrado dez vezes sem UMA violação, e o atendente veria dez
// sugestões idênticas sem entender por quê. É a MESMA lição de `RagnabotAtendPolitica.escopoChave`
// e de `RagnabotFluxoEntrada.chave`: chave calculada NOT NULL, comparável, gravada na linha.
//
// A chave nunca é aceita de quem chama — é sempre derivada. Aceitá-la permitiria gravar uma
// resposta de escopo "empresa" com chave "caixa:42" e furar a unicidade por fora.
//
//   "bomdia|geral|empresa"          → resposta da empresa, vale em qualquer caixa
//   "bomdia|caixa:42|empresa"       → só na caixa 42
//   "bomdia|time:7|u:<uuid>"        → pessoal de um atendente, dentro do time 7
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function chaveDeAtalho({ atalho, cwInboxId = null, cwTeamId = null, visibilidade = 'empresa', userId = null }) {
  const a = normalizarAtalho(atalho);
  let escopo = 'geral';
  if (cwInboxId) escopo = `caixa:${Number(cwInboxId)}`;
  else if (cwTeamId) escopo = `time:${Number(cwTeamId)}`;
  const dono = visibilidade === 'pessoal' ? `u:${String(userId)}` : 'empresa';
  return `${a}|${escopo}|${dono}`;
}

/**
 * Confere o trio escopo/visibilidade/dono e devolve os campos já normalizados.
 * Regras que valem em qualquer porta de entrada (rota, importação, semente):
 *   • caixa e time são mutuamente exclusivos — uma resposta que valesse "na caixa 42 E no time 7"
 *     obrigaria a inventar qual dos dois ganha, e a resposta certa é: não deixe nascer;
 *   • pessoal EXIGE dono. Pessoal sem dono é resposta que ninguém enxerga e ninguém consegue apagar.
 */
export function montarEscopo({ atalho, cwInboxId, cwTeamId, visibilidade = 'empresa', userId = null }) {
  if (!VISIBILIDADES.includes(visibilidade)) {
    throw new Error(`visibilidade: use um de ${VISIBILIDADES.join(' | ')}`);
  }
  const caixa = cwInboxId === undefined || cwInboxId === null || cwInboxId === '' ? null : Number(cwInboxId);
  const time = cwTeamId === undefined || cwTeamId === null || cwTeamId === '' ? null : Number(cwTeamId);
  if (caixa !== null && (!Number.isInteger(caixa) || caixa < 1)) throw new Error('cwInboxId: informe um inteiro positivo');
  if (time !== null && (!Number.isInteger(time) || time < 1)) throw new Error('cwTeamId: informe um inteiro positivo');
  if (caixa !== null && time !== null) {
    throw new Error('Escolha um escopo só: caixa de entrada OU time — nunca os dois.');
  }
  if (visibilidade === 'pessoal' && !userId) {
    throw new Error('visibilidade "pessoal" exige o usuário dono da resposta.');
  }

  const a = normalizarAtalho(atalho);
  const dono = visibilidade === 'pessoal' ? String(userId) : null;
  return {
    atalho: a,
    cwInboxId: caixa,
    cwTeamId: time,
    visibilidade,
    userId: dono,
    chaveAtalho: chaveDeAtalho({ atalho: a, cwInboxId: caixa, cwTeamId: time, visibilidade, userId: dono }),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VARIÁVEIS
//
// A LISTA VEIO DA MEDIÇÃO, não de gosto: `18-LEVANTAMENTO-CHAT-ATUAL.md` §4.1 registrou as
// variáveis do chat atual — {{contactFirstName}}, {{contactName}}, {{user}}, {{greeting}},
// {{protocolNumber}}, {{date}}, {{hour}}, {{ticket_id}}, {{queue}}, {{connection}} — e
// `31-FUNCIONALIDADES-A-IMPLEMENTAR.md` §8 registrou {{firstName}} e {{ticket_id}} nas mensagens
// automáticas por conexão.
//
// ⚠️ POR QUE OS APELIDOS EXISTEM: são DOIS vocabulários medidos para as mesmas cinco ideias
// (`firstName` e `contactFirstName`; `protocolo` e `protocolNumber`). Escolher um e recusar o outro
// significaria que todo texto migrado da origem chega quebrado, e que o atendente que aprendeu o
// nome antigo escreve uma variável que não existe — e variável inexistente vira string vazia, que
// é o defeito silencioso: a mensagem sai sem o nome do cliente e ninguém percebe.
// Aceitamos os dois nomes; o contexto é montado com todos eles preenchidos.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const VARIAVEIS = Object.freeze([
  { nome: 'contactFirstName', apelidos: ['firstName', 'primeiroNome'], rotulo: 'Primeiro nome do contato', exemplo: 'Maria' },
  { nome: 'contactName', apelidos: ['name', 'nome'], rotulo: 'Nome completo do contato', exemplo: 'Maria Magnólia' },
  { nome: 'user', apelidos: ['atendente', 'agentName'], rotulo: 'Nome do atendente', exemplo: 'João' },
  { nome: 'greeting', apelidos: ['saudacao'], rotulo: 'Bom dia / Boa tarde / Boa noite (pelo horário)', exemplo: 'Boa tarde' },
  { nome: 'protocolo', apelidos: ['protocolNumber'], rotulo: 'Número do protocolo', exemplo: '2026082900001' },
  { nome: 'ticket_id', apelidos: ['ticketId', 'atendimento'], rotulo: 'Número do atendimento', exemplo: '4821' },
  { nome: 'queue', apelidos: ['fila', 'setor', 'time'], rotulo: 'Setor / time', exemplo: 'Suporte' },
  { nome: 'connection', apelidos: ['conexao', 'canal', 'caixa'], rotulo: 'Conexão / caixa de entrada', exemplo: 'WhatsApp Comercial' },
  { nome: 'date', apelidos: ['data'], rotulo: 'Data de hoje', exemplo: '29/08/2026' },
  { nome: 'hour', apelidos: ['hora'], rotulo: 'Hora agora', exemplo: '14:32' },
  { nome: 'empresa', apelidos: ['company'], rotulo: 'Nome da sua empresa', exemplo: 'Ragnatela IoT' },
]);

/** Todo nome aceito (canônico + apelidos), para a tela avisar antes de gravar. */
export const NOMES_DE_VARIAVEL = Object.freeze(
  VARIAVEIS.flatMap((v) => [v.nome, ...v.apelidos]),
);

/**
 * Saudação pelo relógio. `America/Fortaleza` é o padrão da casa DE PROPÓSITO — medido em 29/08, a
 * caixa 1 do Ragnabot está em UTC, e herdar dali erraria em 3 horas: às 21h o cliente receberia
 * "Bom dia". Erro que aparece como "o robô está confuso", e ninguém liga ao fuso.
 */
export function saudacaoDe(agora = new Date(), fuso = 'America/Fortaleza') {
  let hora;
  try {
    hora = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', hour12: false }).format(agora));
  } catch {
    hora = agora.getHours();
  }
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Monta o dicionário de variáveis a partir do que o chamador tem em mãos.
 *
 * ⚠️ CADA IDEIA É GRAVADA EM TODOS OS SEUS NOMES (canônico + apelidos). É o que faz `{{firstName}}`
 * (vocabulário das mensagens automáticas) e `{{contactFirstName}}` (vocabulário da tela) devolverem
 * a mesma coisa sem ninguém ter de converter texto antes de expandir.
 *
 * O primeiro nome é derivado do nome completo quando não vier pronto — e derivar aqui, num lugar
 * só, evita a versão de cada chamador (uma com `split(' ')[0]`, outra com o nome inteiro).
 */
export function contextoDeVariaveis(dados = {}) {
  const agora = dados.agora instanceof Date ? dados.agora : new Date();
  const fuso = dados.fuso || 'America/Fortaleza';

  const nomeContato = dados.contactName ?? dados.contato?.name ?? dados.contato?.nome ?? '';
  const primeiro = dados.contactFirstName
    ?? dados.firstName
    ?? (String(nomeContato).trim().split(/\s+/u)[0] || '');

  const fmt = (opcoes) => {
    try {
      return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, ...opcoes }).format(agora);
    } catch {
      return new Intl.DateTimeFormat('pt-BR', opcoes).format(agora);
    }
  };

  const base = {
    contactFirstName: primeiro,
    contactName: nomeContato,
    user: dados.user ?? dados.atendente ?? '',
    greeting: dados.greeting ?? saudacaoDe(agora, fuso),
    protocolo: dados.protocolo ?? dados.protocolNumber ?? '',
    ticket_id: dados.ticket_id ?? dados.ticketId ?? dados.cwConversationId ?? '',
    queue: dados.queue ?? dados.fila ?? dados.time ?? '',
    connection: dados.connection ?? dados.conexao ?? dados.caixa ?? '',
    date: dados.date ?? fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }),
    hour: dados.hour ?? fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
    empresa: dados.empresa ?? dados.company ?? '',
  };

  const vars = {};
  for (const v of VARIAVEIS) {
    const valor = base[v.nome];
    vars[v.nome] = valor === null || valor === undefined ? '' : String(valor);
    for (const apelido of v.apelidos) vars[apelido] = vars[v.nome];
  }
  // Extras livres do chamador (ex.: {{pedido}} de uma integração) — sem sobrescrever os canônicos.
  if (dados.extras && typeof dados.extras === 'object') {
    for (const [k, val] of Object.entries(dados.extras)) {
      if (!(k in vars)) vars[k] = val === null || val === undefined ? '' : String(val);
    }
  }
  return vars;
}

/**
 * Troca as variáveis do texto. Devolve o texto expandido E a lista do que faltou.
 *
 * ⚠️ `ausentes` NÃO É DECORAÇÃO. Variável sem valor vira string vazia (derrubar a inserção porque
 * a conversa ainda não tem protocolo castigaria o atendente por um detalhe do momento), e sem esta
 * lista a falha seria SILENCIOSA: a mensagem sai com um buraco no meio e ninguém percebe. Com ela,
 * a tela consegue avisar "esta resposta usa {{protocolo}}, que esta conversa ainda não tem".
 *
 * @param {string} texto      o corpo da resposta rápida, com `{{variavel}}`
 * @param {object} contexto   o que se sabe da conversa (ver `contextoDeVariaveis`)
 * @returns {{texto:string, ausentes:string[], usadas:string[]}}
 */
export function expandir(texto, contexto = {}) {
  const corpo = String(texto ?? '');
  const vars = contexto && contexto.__jaEhContexto ? contexto : contextoDeVariaveis(contexto);
  const usadas = variaveisUsadas(corpo);
  // `destino: 'whatsapp'` porque é para onde o texto vai. O escape do destino é identidade — o
  // WhatsApp renderiza o texto como veio —, mas declarar o destino mantém esta chamada dentro da
  // mesma regra do §4.8 do motor, em vez de virar uma exceção que ninguém sabe explicar depois.
  const r = interpolar(corpo, vars, { destino: 'whatsapp' });
  return { texto: String(r.valor ?? ''), ausentes: r.ausentes ?? [], usadas };
}

/** Quais variáveis o texto cita — para a tela conferir ANTES de gravar. Mesma forma do motor. */
export function variaveisUsadas(texto) {
  const achadas = [];
  const re = /\{\{\{?\s*([\p{L}\p{N}_.]+)\s*\}?\}\}/gu;
  let m = re.exec(String(texto ?? ''));
  while (m) {
    if (!achadas.includes(m[1])) achadas.push(m[1]);
    m = re.exec(String(texto ?? ''));
  }
  return achadas;
}

/** Variáveis citadas que NÃO existem no catálogo — erro de digitação vira aviso, não buraco. */
export function variaveisDesconhecidas(texto) {
  return variaveisUsadas(texto).filter((v) => !NOMES_DE_VARIAVEL.includes(v));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ESCOPO — a cláusula de isolamento, derivada SEMPRE do usuário logado
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** `null` = não pode ver nada. Falha FECHADA: vazio é o lado seguro do erro; ver a empresa errada não. */
export function clausulaDeEmpresa(user, tenantIdDaTela = null) {
  const esc = escopoDe(user);
  if (esc.global) return tenantIdDaTela ? { tenantId: String(tenantIdDaTela) } : {};
  if (!esc.tenantId) return null;
  return { tenantId: esc.tenantId }; // trava dura: o que a tela mandou é ignorado
}

/** Empresa em que a ESCRITA acontece. Para quem não é super, é sempre a dele. */
export function empresaParaEscrita(user, tenantIdDoCorpo = null) {
  const esc = escopoDe(user);
  if (esc.global) {
    if (!tenantIdDoCorpo) throw new Error('Informe "tenantId": o super usuário administra várias empresas.');
    return String(tenantIdDoCorpo);
  }
  if (!esc.tenantId) throw new Error('Seu usuário não está vinculado a uma empresa do Ragnabot.');
  return esc.tenantId;
}

/**
 * Cláusula de VISIBILIDADE: o que este usuário enxerga dentro da empresa dele.
 *
 * A resposta pessoal é o rascunho de UMA pessoa, não configuração da empresa — por isso nem o
 * administrador da empresa a lista por padrão. O super usuário enxerga tudo (política permanente da
 * casa: super ⊇ admin em tudo), e é o caminho para limpar o que sobrou de um atendente desligado.
 */
export function clausulaDeVisibilidade(user) {
  if (user?.isSuperuser === true) return {};
  const meu = user?.id ? String(user.id) : null;
  const ou = [{ visibilidade: 'empresa' }];
  if (meu) ou.push({ visibilidade: 'pessoal', userId: meu });
  return { OR: ou };
}

/** Quem pode mexer em resposta da EMPRESA. A pessoal é de quem a criou — regra em `podeMexerNesta`. */
export function podeEscreverDaEmpresa(user) {
  if (!user) return false;
  return user.isSuperuser === true || user.role === 'admin' || user.clientRole === 'client_admin';
}

/**
 * Quem pode alterar/apagar ESTA linha.
 *
 * Espelha o `editQuickMessages` medido na origem (18-LEVANTAMENTO §5), mas sem inventar uma
 * permissão nova: resposta da empresa é configuração (administrador); resposta pessoal é do dono.
 */
export function podeMexerNesta(user, linha) {
  if (!user || !linha) return false;
  if (user.isSuperuser === true) return true;
  if (linha.visibilidade === 'pessoal') return String(linha.userId) === String(user.id);
  return podeEscreverDaEmpresa(user);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CRUD
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A tabela pode ainda não ter migrado no banco de quem sobe o processo. Guarda explícita. */
export function modeloPronto() {
  return Boolean(prisma.ragnabotRespostaRapida && typeof prisma.ragnabotRespostaRapida.findMany === 'function');
}

/**
 * Lista com busca por atalho OU título. `contains` sem `mode:'insensitive'` seria armadilha: o
 * atendente digita "Boleto" e não acha "boleto". O atalho já é normalizado; o título, não.
 */
export async function listar(user, filtros = {}) {
  const onde = clausulaDeEmpresa(user, filtros.tenantId);
  if (!onde) return { total: 0, itens: [], aviso: 'usuário sem empresa vinculada' };

  const where = { ...onde, ...clausulaDeVisibilidade(user) };
  if (filtros.incluirInativas !== true) where.ativa = true;
  if (filtros.visibilidade) {
    if (!VISIBILIDADES.includes(filtros.visibilidade)) throw new Error('visibilidade inválida');
    where.visibilidade = filtros.visibilidade;
  }
  if (filtros.cwInboxId) where.cwInboxId = Number(filtros.cwInboxId);
  if (filtros.cwTeamId) where.cwTeamId = Number(filtros.cwTeamId);

  const busca = String(filtros.busca ?? '').trim();
  if (busca) {
    // Duas condições combinadas por AND com o OR da visibilidade — por isso o OR da busca vai
    // dentro de um AND próprio. Dois `OR` no mesmo objeto, um sobrescreveria o outro em silêncio e
    // a busca passaria a enxergar as pessoais dos colegas. Erro fácil de cometer, caro de descobrir.
    where.AND = [{
      OR: [
        { atalho: { contains: busca.replace(/^\/+/u, '').toLowerCase() } },
        { titulo: { contains: busca, mode: 'insensitive' } },
      ],
    }];
  }

  const itens = await prisma.ragnabotRespostaRapida.findMany({
    where,
    orderBy: [{ atalho: 'asc' }],
    take: Math.min(Number(filtros.limite) || 300, 1000),
  });
  return { total: itens.length, itens: itens.map(comExibicao) };
}

/** Acrescenta o que a tela precisa e o banco não guarda (a barra e as variáveis citadas). */
function comExibicao(linha) {
  return {
    ...linha,
    atalhoExibido: atalhoExibido(linha.atalho),
    variaveis: variaveisUsadas(linha.mensagem),
  };
}

/** Uma linha, DENTRO do escopo. Fora do escopo devolve `null` — a rota traduz em 404, nunca 403. */
export async function obter(user, id) {
  const onde = clausulaDeEmpresa(user, null);
  if (!onde) return null;
  const linha = await prisma.ragnabotRespostaRapida.findFirst({
    where: { id: String(id), ...onde, ...clausulaDeVisibilidade(user) },
  });
  return linha ? comExibicao(linha) : null;
}

function validarCorpo({ titulo, mensagem }) {
  const t = String(titulo ?? '').trim();
  const m = String(mensagem ?? '');
  if (!t) throw new Error('titulo: informe um nome curto para a resposta');
  if (t.length > LIMITES.titulo) throw new Error(`titulo: acima de ${LIMITES.titulo} caracteres`);
  if (!m.trim()) throw new Error('mensagem: informe o texto da resposta');
  if (m.length > LIMITES.mensagem) throw new Error(`mensagem: acima de ${LIMITES.mensagem} caracteres`);
  return { titulo: t, mensagem: m };
}

/**
 * Cria. A unicidade é do BANCO (`@@unique([tenantId, chaveAtalho])`) e o P2002 é traduzido para
 * uma frase que o atendente entende. Conferir antes com um `findFirst` e gravar depois deixaria a
 * janela de corrida exatamente entre as duas — dois cliques rápidos e nascem dois `/bomdia`.
 */
export async function criar(user, dados = {}) {
  const tenantId = empresaParaEscrita(user, dados.tenantId);
  const esc = montarEscopo({
    atalho: dados.atalho,
    cwInboxId: dados.cwInboxId,
    cwTeamId: dados.cwTeamId,
    visibilidade: dados.visibilidade || 'empresa',
    // O dono de uma resposta PESSOAL é sempre quem está logado, jamais o que a tela mandou:
    // aceitar `userId` do corpo deixaria alguém plantar resposta na gaveta de um colega.
    userId: (dados.visibilidade === 'pessoal') ? (user?.id ?? null) : null,
  });
  if (esc.visibilidade === 'empresa' && !podeEscreverDaEmpresa(user)) {
    throw Object.assign(new Error('Só um administrador cria resposta rápida da empresa. A sua fica como "pessoal".'), { status: 403 });
  }
  const corpo = validarCorpo(dados);

  try {
    const criada = await prisma.ragnabotRespostaRapida.create({
      data: {
        tenantId,
        ...esc,
        ...corpo,
        ativa: dados.ativa === undefined ? true : Boolean(dados.ativa),
        criadoPorUserId: user?.id ?? null,
      },
    });
    return comExibicao(criada);
  } catch (e) {
    throw traduzirDuplicata(e, esc.atalho);
  }
}

/**
 * Altera. Só os campos enviados. O atalho e o escopo recalculam a chave — senão a linha mudaria de
 * atalho e continuaria trancando o antigo, e o novo poderia duplicar sem violação nenhuma.
 */
export async function editar(user, id, dados = {}) {
  const atual = await obter(user, id);
  if (!atual) return null; // fora do escopo (ou inexistente): a rota devolve 404
  if (!podeMexerNesta(user, atual)) {
    throw Object.assign(new Error('Sem permissão para alterar esta resposta rápida.'), { status: 403 });
  }

  const alvo = {
    atalho: dados.atalho ?? atual.atalho,
    cwInboxId: dados.cwInboxId === undefined ? atual.cwInboxId : dados.cwInboxId,
    cwTeamId: dados.cwTeamId === undefined ? atual.cwTeamId : dados.cwTeamId,
    // Visibilidade continua sendo a que era, a menos que peçam para trocar. Ao virar pessoal, o
    // dono é quem está mexendo — pelo mesmo motivo do `criar`.
    visibilidade: dados.visibilidade ?? atual.visibilidade,
  };
  alvo.userId = alvo.visibilidade === 'pessoal'
    ? (atual.visibilidade === 'pessoal' ? atual.userId : (user?.id ?? null))
    : null;

  const esc = montarEscopo(alvo);
  if (esc.visibilidade === 'empresa' && !podeEscreverDaEmpresa(user)) {
    throw Object.assign(new Error('Só um administrador publica resposta rápida para a empresa inteira.'), { status: 403 });
  }

  const patch = { ...esc };
  if (dados.titulo !== undefined || dados.mensagem !== undefined) {
    Object.assign(patch, validarCorpo({
      titulo: dados.titulo ?? atual.titulo,
      mensagem: dados.mensagem ?? atual.mensagem,
    }));
  }
  if (dados.ativa !== undefined) patch.ativa = Boolean(dados.ativa);

  try {
    const nova = await prisma.ragnabotRespostaRapida.update({ where: { id: atual.id }, data: patch });
    return comExibicao(nova);
  } catch (e) {
    throw traduzirDuplicata(e, esc.atalho);
  }
}

/** Remove de verdade. Resposta rápida não tem histórico a preservar — o registro fica na auditoria. */
export async function remover(user, id) {
  const atual = await obter(user, id);
  if (!atual) return null;
  if (!podeMexerNesta(user, atual)) {
    throw Object.assign(new Error('Sem permissão para remover esta resposta rápida.'), { status: 403 });
  }
  await prisma.ragnabotRespostaRapida.delete({ where: { id: atual.id } });
  return atual;
}

/**
 * ⚠️ O Prisma NÃO chama esta violação de "unique" na mensagem — o código é `P2002`. Conferir por
 * texto ("duplicate key") funcionaria em SQL cru e falharia aqui em silêncio, devolvendo 500 onde
 * cabia uma frase clara. Esta armadilha já mordeu em `tests/ragnabot-atendimento.test.mjs`.
 */
function traduzirDuplicata(e, atalho) {
  if (e && e.code === 'P2002') {
    return Object.assign(
      new Error(`Já existe uma resposta rápida com o atalho "${atalhoExibido(atalho)}" neste mesmo escopo.`),
      { status: 409, code: 'ATALHO_DUPLICADO' },
    );
  }
  return e;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// USO NA CAIXA DE RESPOSTA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Resolve o que o atendente digitou e devolve o texto pronto.
 *
 * ⚠️ A ORDEM DE DESEMPATE É REGRA, NÃO ACASO — duas respostas podem casar com `/bomdia` (a da
 * empresa e a pessoal do atendente, ou a geral e a da caixa). Sem ordem declarada, "qual texto
 * aparece" viraria o que o banco devolvesse primeiro, e o atendente veria um texto diferente a cada
 * dia sem ninguém ter mexido em nada. A ordem é do mais específico para o mais geral:
 *   1. pessoal + escopo da caixa/time atual
 *   2. pessoal geral
 *   3. empresa + escopo da caixa/time atual
 *   4. empresa geral
 */
export async function resolverAtalho(user, atalhoDigitado, contexto = {}) {
  const onde = clausulaDeEmpresa(user, null);
  if (!onde) return null;
  const atalho = normalizarAtalho(atalhoDigitado);

  const candidatas = await prisma.ragnabotRespostaRapida.findMany({
    where: { ...onde, ...clausulaDeVisibilidade(user), atalho, ativa: true },
  });
  if (!candidatas.length) return null;

  const caixa = contexto.cwInboxId ? Number(contexto.cwInboxId) : null;
  const time = contexto.cwTeamId ? Number(contexto.cwTeamId) : null;
  const meu = user?.id ? String(user.id) : null;

  const pontuar = (r) => {
    // Escopo que não é o desta conversa não serve — e é descartado, não despriorizado.
    if (r.cwInboxId && r.cwInboxId !== caixa) return -1;
    if (r.cwTeamId && r.cwTeamId !== time) return -1;
    if (r.visibilidade === 'pessoal' && String(r.userId) !== meu) return -1;
    let p = 0;
    if (r.visibilidade === 'pessoal') p += 10;
    if (r.cwInboxId || r.cwTeamId) p += 5;
    return p;
  };

  const escolhida = candidatas
    .map((r) => ({ r, p: pontuar(r) }))
    .filter((x) => x.p >= 0)
    .sort((a, b) => b.p - a.p)[0]?.r;
  if (!escolhida) return null;

  const exp = expandir(escolhida.mensagem, contexto);
  return {
    resposta: comExibicao(escolhida),
    texto: exp.texto,
    ausentes: exp.ausentes,
    // Quantas casaram além da escolhida — é o que explica "por que veio este e não aquele".
    alternativas: candidatas.length - 1,
  };
}

export default {
  VISIBILIDADES, LIMITES, VARIAVEIS, NOMES_DE_VARIAVEL,
  normalizarAtalho, atalhoExibido, chaveDeAtalho, montarEscopo,
  saudacaoDe, contextoDeVariaveis, expandir, variaveisUsadas, variaveisDesconhecidas,
  clausulaDeEmpresa, empresaParaEscrita, clausulaDeVisibilidade,
  podeEscreverDaEmpresa, podeMexerNesta, modeloPronto,
  listar, obter, criar, editar, remover, resolverAtalho,
};
