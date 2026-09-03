// ════════════════════════════════════════════════════════════════════════════════════════════════
// API PÚBLICA POR EMPRESA — chave + segredo, com regeneração  ·  contrato S6, doc 34 §F9.4.1
//
// O padrão foi MEDIDO no portal que o chat atual usa (doc 34 §F9.4): a empresa recebe uma **API
// Key** e um **Secret**, com botão «Regenerar credenciais». E é o mesmo padrão que a Meta usa —
// razão pela qual a assinatura de saída (`ragnabot-webhook-saida.service.js`) reaproveita
// `src/base/assinatura.js` em vez de inventar um segundo dialeto.
//
// ── AS QUATRO REGRAS QUE ESTE ARQUIVO IMPÕE ─────────────────────────────────────────────────────
// R-1. O SEGREDO NUNCA ESTÁ EM TEXTO PURO NO BANCO. `segredoCifrado` é AES-256-GCM
//      (`src/base/crypto.js`, a MESMA implementação e a MESMA chave já em produção) e
//      `segredoDigital` é o sha256 truncado, para conferir rotação sem poder reconstruir.
// R-2. O SEGREDO APARECE UMA VEZ. Só a emissão e a regeneração devolvem o valor em claro. Nenhuma
//      listagem, nenhum detalhe, nenhuma resposta de erro. Quem perdeu, regenera — e a regeneração
//      é auditada, que é exatamente o comportamento que se quer.
// R-3. O SEGREDO NUNCA ENTRA EM LOG. Nem em `catch`, nem em mensagem de erro. Log de credencial
//      cita a CHAVE (pública, é para isso que ela existe) e a DIGITAL, nunca o segredo.
// R-4. REGENERAR INVALIDA A ANTERIOR, na mesma transação. Não existe janela em que as duas valem:
//      «regenerar» que deixa a antiga viva não é rotação, é uma segunda credencial — e é assim que
//      um segredo vazado continua funcionando depois de o cliente jurar que o trocou.
//
// ── ⚠️ ISOLAMENTO ──────────────────────────────────────────────────────────────────────────────
// Toda função recebe o `tenantId` do ESCOPO (derivado do usuário logado no router, nunca do corpo
// da requisição), e toda leitura por id casa `{ id, tenantId }`. Um id de outra empresa devolve
// «não encontrada» — 404 e não 403, para não confirmar ao curioso que aquele id existe. É a mesma
// regra da caixa de atendimento (contrato S2) e do editor de fluxo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import { encrypt, decrypt } from '../base/crypto.js';
import { digitalDoSegredo, iguaisComSeguranca, novoSegredo } from '../base/assinatura.js';

/** Escopos conhecidos. `ler` consulta; `escrever` manda mensagem e muda estado de atendimento. */
export const ESCOPOS = Object.freeze(['ler', 'escrever']);

/** Prefixo da chave pública. Existe para o segredo NUNCA ser confundido com ela num log ou num
 *  campo de formulário — e para um vazamento acidental ser reconhecível numa varredura. */
export const PREFIXO_CHAVE = 'rgtk_';

// ── PORTAS INJETÁVEIS — mesmo desenho dos vizinhos: o teste troca a implementação, não a regra ──
const portas = { db: prismaPadrao, log: loggerPadrao, auditoria: null, agora: () => new Date() };

export function configurarApiPublica(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na API pública: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDaApiPublica() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log || loggerPadrao;
const agora = () => portas.agora();

/** O modelo existe no cliente Prisma carregado? Guarda de migração não aplicada: melhor uma frase
 *  em português do que um `TypeError: Cannot read properties of undefined`. */
export function disponivel() {
  return typeof db()?.ragnabotApiCredencial?.findMany === 'function';
}
function exigirModelo() {
  if (!disponivel()) {
    const e = new Error('A tabela de credenciais de API ainda não existe nesta instalação. '
      + 'Aplique prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql e reinicie o processo '
      + '(o cliente Prisma só carrega no arranque).');
    e.code = 'MODELO_AUSENTE';
    e.status = 503;
    throw e;
  }
}

function exigirTenant(tenantId) {
  const t = String(tenantId || '').trim();
  if (!t) {
    const e = new Error('Empresa não informada — a credencial de API é sempre de UMA empresa.');
    e.status = 400;
    throw e;
  }
  return t;
}

function normalizarEscopos(lista) {
  const brutos = Array.isArray(lista) ? lista : [lista].filter(Boolean);
  const limpos = [...new Set(brutos.map((e) => String(e || '').trim().toLowerCase()))].filter(Boolean);
  const desconhecido = limpos.find((e) => !ESCOPOS.includes(e));
  if (desconhecido) {
    const e = new Error(`Escopo "${desconhecido}" não existe. Conhecidos: ${ESCOPOS.join(', ')}.`);
    e.status = 400;
    throw e;
  }
  return limpos.length ? limpos : ['ler'];
}

/** Uma chave pública nova. 16 bytes bastam para identificar; ela não protege nada sozinha. */
function novaChave() {
  return `${PREFIXO_CHAVE}${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * A forma PÚBLICA de uma credencial. É a única coisa que sai deste serviço em listagem.
 * ⛔ `segredoCifrado` não aparece nem como campo vazio: campo que existe na resposta é campo que
 * alguém um dia preenche por engano.
 */
export function comoPublica(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    tenantId: linha.tenantId,
    nome: linha.nome,
    chave: linha.chave,
    // A digital serve para o cliente conferir «é esta mesma que eu tenho aí?» sem ninguém dizer o
    // segredo em voz alta — que é como segredo vaza em conversa de suporte.
    digital: linha.segredoDigital,
    escopos: linha.escopos || [],
    ativa: linha.ativa === true,
    revogadaEm: linha.revogadaEm || null,
    motivoRevogacao: linha.motivoRevogacao || null,
    substituiuId: linha.substituiuId || null,
    ultimoUsoEm: linha.ultimoUsoEm || null,
    ultimoUsoIp: linha.ultimoUsoIp || null,
    usos: linha.usos ?? 0,
    criadaEm: linha.criadaEm,
  };
}

/**
 * Emite uma credencial nova.
 *
 * @returns {{credencial:object, segredo:string}} `segredo` em CLARO — a única vez que ele existe
 *   fora do banco. Quem chama tem de entregá-lo ao operador e esquecê-lo.
 */
export async function emitirCredencial(tenantId, { nome, escopos = ['ler'] } = {}, { ator = null, req = null } = {}) {
  exigirModelo();
  const t = exigirTenant(tenantId);
  const rotulo = String(nome || '').trim();
  if (rotulo.length < 2 || rotulo.length > 80) {
    const e = new Error('Dê um nome à credencial (2 a 80 caracteres) — quando uma integração quebrar, é por ele que se descobre de quem ela é.');
    e.status = 400;
    throw e;
  }
  const escopo = normalizarEscopos(escopos);
  const segredo = novoSegredo();

  const linha = await db().ragnabotApiCredencial.create({
    data: {
      tenantId: t,
      nome: rotulo,
      chave: novaChave(),
      segredoCifrado: encrypt(segredo),
      segredoDigital: digitalDoSegredo(segredo),
      escopos: escopo,
      // ⚠️ ESCRITOS À MÃO, e não deixados ao `@default` do schema. `ativa` é bandeira de SEGURANÇA:
      // depender do padrão do banco significa que uma migração aplicada pela metade (coluna sem
      // default) criaria credencial com `ativa` nulo — e `!null` é verdadeiro, o que a deixaria
      // recusando tudo. Explícito aqui, o valor não depende de o banco estar como esperamos.
      ativa: true,
      usos: 0,
      criadaPorUserId: ator?.id || null,
    },
  });

  // ⛔ A chave entra no log; o segredo, JAMAIS.
  log().info?.(`[ragnabot-api] credencial "${rotulo}" emitida para a empresa ${t} — chave ${linha.chave}, digital ${linha.segredoDigital}`);
  await auditar({
    tenantId: t, ator, req, acao: 'ragnabot.api.credencial.emitir',
    descricao: `Credencial de API "${rotulo}" emitida (chave ${linha.chave}, escopos: ${escopo.join(', ')})`,
    depois: { chave: linha.chave, digital: linha.segredoDigital, escopos: escopo },
  });

  return { credencial: comoPublica(linha), segredo };
}

/** Todas as credenciais da empresa. Nunca o segredo. */
export async function listarCredenciais(tenantId, { incluirRevogadas = true } = {}) {
  exigirModelo();
  const t = exigirTenant(tenantId);
  const where = { tenantId: t };
  if (!incluirRevogadas) where.ativa = true;
  const linhas = await db().ragnabotApiCredencial.findMany({ where, orderBy: [{ ativa: 'desc' }, { criadaEm: 'desc' }] });
  return linhas.map(comoPublica);
}

async function exigirCredencial(tenantId, id) {
  const t = exigirTenant(tenantId);
  const linha = await db().ragnabotApiCredencial.findFirst({ where: { id: String(id || ''), tenantId: t } });
  if (!linha) {
    // 404 e não 403: não confirmamos que este id existe noutra empresa.
    const e = new Error('Credencial de API não encontrada.');
    e.code = 'CREDENCIAL_NAO_ENCONTRADA';
    e.status = 404;
    throw e;
  }
  return linha;
}

/**
 * REGENERA: revoga a anterior e emite a substituta, **na mesma transação**.
 *
 * ⚠️ A ordem importa e a atomicidade também. Emitir primeiro e revogar depois abre uma janela em
 * que as DUAS valem — e se o processo morrer no meio, a antiga fica viva para sempre com o cliente
 * achando que a trocou. Por isso as duas escritas vão juntas, e um erro em qualquer uma desfaz a
 * outra. Onde a transação não existir (dublê de teste sem `$transaction`), o caminho é o mesmo em
 * sequência — e a revogação vem PRIMEIRO, para que a falha deixe o mundo mais fechado, não mais
 * aberto.
 */
export async function regenerarCredencial(tenantId, id, { motivo = null } = {}, { ator = null, req = null } = {}) {
  exigirModelo();
  const t = exigirTenant(tenantId);
  const antiga = await exigirCredencial(t, id);
  if (!antiga.ativa) {
    const e = new Error('Esta credencial já está revogada — emita uma nova em vez de regenerar uma morta.');
    e.status = 409;
    throw e;
  }

  const segredo = novoSegredo();
  const quando = agora();
  const dadosRevogacao = {
    ativa: false,
    revogadaEm: quando,
    revogadaPorUserId: ator?.id || null,
    motivoRevogacao: String(motivo || 'regenerada pelo operador').slice(0, 200),
  };
  const dadosNova = {
    tenantId: t,
    nome: antiga.nome,
    chave: novaChave(),
    segredoCifrado: encrypt(segredo),
    segredoDigital: digitalDoSegredo(segredo),
    escopos: antiga.escopos || ['ler'],
    substituiuId: antiga.id,
    ativa: true,
    usos: 0,
    criadaPorUserId: ator?.id || null,
  };

  let nova;
  const cliente = db();
  // Forma de CALLBACK (e não a de lista) de propósito: dentro dela a REVOGAÇÃO vem primeiro. Se
  // algo estourar no meio, a transação volta atrás inteira; e num cliente sem transação de verdade
  // (dublê), a ordem deixa o mundo mais FECHADO, nunca mais aberto.
  const passo = async (tx) => {
    await tx.ragnabotApiCredencial.update({ where: { id: antiga.id }, data: dadosRevogacao });
    return tx.ragnabotApiCredencial.create({ data: dadosNova });
  };
  nova = typeof cliente.$transaction === 'function' ? await cliente.$transaction(passo) : await passo(cliente);

  log().warn?.(`[ragnabot-api] credencial ${antiga.chave} REVOGADA e substituída por ${nova.chave} (empresa ${t})`);
  await auditar({
    tenantId: t, ator, req, acao: 'ragnabot.api.credencial.regenerar',
    descricao: `Credencial de API "${antiga.nome}" regenerada — ${antiga.chave} deixou de valer, ${nova.chave} passou a valer`,
    antes: { chave: antiga.chave, digital: antiga.segredoDigital, ativa: true },
    depois: { chave: nova.chave, digital: nova.segredoDigital, ativa: true, substituiu: antiga.chave },
  });

  return { credencial: comoPublica(nova), segredo, revogada: comoPublica({ ...antiga, ...dadosRevogacao }) };
}

/** Revoga sem substituir. A integração que a usava PARA — é o que se quer ao desligar um parceiro. */
export async function revogarCredencial(tenantId, id, { motivo = null } = {}, { ator = null, req = null } = {}) {
  exigirModelo();
  const t = exigirTenant(tenantId);
  const antiga = await exigirCredencial(t, id);
  if (!antiga.ativa) return comoPublica(antiga); // idempotente: revogar o revogado não é erro

  const linha = await db().ragnabotApiCredencial.update({
    where: { id: antiga.id },
    data: {
      ativa: false,
      revogadaEm: agora(),
      revogadaPorUserId: ator?.id || null,
      motivoRevogacao: String(motivo || 'revogada pelo operador').slice(0, 200),
    },
  });
  log().warn?.(`[ragnabot-api] credencial ${antiga.chave} revogada (empresa ${t})`);
  await auditar({
    tenantId: t, ator, req, acao: 'ragnabot.api.credencial.revogar',
    descricao: `Credencial de API "${antiga.nome}" (${antiga.chave}) revogada`,
    antes: { chave: antiga.chave, ativa: true }, depois: { chave: antiga.chave, ativa: false },
  });
  return comoPublica(linha);
}

/**
 * AUTENTICA uma chamada da API pública.
 *
 * @returns {{ok:true, tenantId:string, credencialId:string, escopos:string[]}}
 *        | {ok:false, motivo:string}
 *
 * ⚠️ A recusa é SEMPRE a mesma frase, independentemente de a chave não existir, estar revogada ou
 * o segredo estar errado. Diferenciar ensinaria um atacante a enumerar chaves válidas — e a
 * diferença não ajuda nenhum integrador honesto, que ou tem o par certo ou não tem.
 * O motivo VERDADEIRO vai para o log, que é onde o suporte olha.
 */
export async function autenticar({ chave, segredo, ip = null } = {}) {
  exigirModelo();
  const recusa = { ok: false, motivo: 'Chave ou segredo inválidos.' };
  const c = String(chave || '').trim();
  const s = String(segredo || '');
  if (!c || !s) return recusa;

  const linha = await db().ragnabotApiCredencial.findUnique({ where: { chave: c } }).catch(() => null);
  if (!linha) { log().warn?.(`[ragnabot-api] chave desconhecida (ip=${ip || '?'})`); return recusa; }
  if (!linha.ativa) { log().warn?.(`[ragnabot-api] chave ${c} REVOGADA tentou autenticar (ip=${ip || '?'})`); return recusa; }

  let emClaro = '';
  try { emClaro = decrypt(linha.segredoCifrado); } catch {
    // Segredo que não abre é chave de cifragem errada ou linha corrompida. NÃO é «segredo inválido»
    // do cliente, e confundir os dois faria o suporte procurar no lugar errado por horas.
    log().error?.(`[ragnabot-api] o segredo da credencial ${c} não decifra — confira ENCRYPTION_KEY desta instalação`);
    return recusa;
  }
  if (!iguaisComSeguranca(emClaro, s)) {
    log().warn?.(`[ragnabot-api] segredo errado para a chave ${c} (ip=${ip || '?'})`);
    return recusa;
  }

  // Marca de uso: é o que responde «esta credencial ainda é usada?» na hora de desligar um
  // parceiro. Falha aqui NÃO derruba a autenticação — contabilidade não pode barrar operação.
  db().ragnabotApiCredencial.update({
    where: { id: linha.id },
    data: { ultimoUsoEm: agora(), ultimoUsoIp: ip ? String(ip).slice(0, 64) : null, usos: { increment: 1 } },
  }).catch(() => {});

  return { ok: true, tenantId: linha.tenantId, credencialId: linha.id, chave: linha.chave, escopos: linha.escopos || [] };
}

/** O escopo cobre esta ação? */
export function temEscopo(escopos, exigido) {
  return Array.isArray(escopos) && escopos.includes(String(exigido || ''));
}

/** Auditoria — nunca lança, e nunca carrega segredo. */
async function auditar({ tenantId, ator, req, acao, descricao, antes = null, depois = null }) {
  try {
    const aud = portas.auditoria || (await import('./ragnabot-auditoria.service.js'));
    await aud.registrar({
      tenantId,
      atorTipo: ator ? 'usuario' : 'sistema',
      atorId: ator?.id || null, atorNome: ator?.name || ator?.nome || null, atorEmail: ator?.email || null,
      categoria: 'configuracao', acao, descricao,
      ip: req?.ip || null, userAgent: req?.headers?.['user-agent'] || null,
      entidade: 'RagnabotApiCredencial', entidadeId: depois?.chave || antes?.chave || null,
      antes, depois,
    });
  } catch (e) {
    log().warn?.(`[ragnabot-api] auditoria não registrada: ${e.message}`);
  }
}

export default {
  ESCOPOS, PREFIXO_CHAVE,
  emitirCredencial, listarCredenciais, regenerarCredencial, revogarCredencial,
  autenticar, temEscopo, comoPublica, disponivel,
  configurarApiPublica, portasDaApiPublica,
};
