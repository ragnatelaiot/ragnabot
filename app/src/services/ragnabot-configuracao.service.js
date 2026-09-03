// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES DO ATENDIMENTO — o serviço.  Contrato S7 (doc 34 §F8), 02/09/2026
//
// Guarda, lê e AUDITA os ajustes dos 10 painéis do catálogo. Três regras mandam aqui, e as três
// foram pagas com incidente em outros pontos deste mesmo produto:
//
// ── 1. ISOLAMENTO É DO SERVIDOR ────────────────────────────────────────────────────────────────
// O `tenantId` NUNCA vem da tela para ampliar alcance: sai de `escopoDe(user)`, que lê o vínculo
// do usuário resolvido no login. Um `tenantId` no corpo só é aceito de quem é super, e aí ele
// ESTREITA, jamais ALARGA. Empresa A pedindo o painel de B recebe o painel DELA — não o de B, e
// não um erro que confirme a existência de B.
//
// ── 2. AUDITORIA COM ANTES→DEPOIS, SEMPRE ──────────────────────────────────────────────────────
// Ação sem `payloadBefore` não prova transição: "ficou ligado" não diz se estava desligado ou se
// já estava ligado e alguém só salvou de novo. Toda gravação registra as DUAS pontas, e só das
// chaves QUE MUDARAM — salvar um painel inteiro sem mexer em nada não polui a auditoria.
//
// ── 3. SEGREDO CIFRADO, COM IMPRESSÃO DIGITAL, NUNCA EM LOG ────────────────────────────────────
// Senha de SMTP e chave de IA vão cifradas (aes-256-gcm, `base/crypto.js`) e NÃO VOLTAM pela API.
// O que volta é `{definido:true, impressaoDigital:'a1b2c3d4e5f6'}` — sha256 dos primeiros 12
// caracteres hex do valor em claro. Serve para o operador conferir "é a chave que eu pus?" e para
// a auditoria provar que MUDOU, sem que ninguém — nem o suporte, nem o log — possa reconstruí-la.
// Mesmo padrão de `RagnabotInbox.credentialFingerprint` e de `RagnabotPagamentoCredencial`.
//
// ── ⚠️ POR QUE UMA TABELA CHAVE/VALOR, E NÃO UMA COLUNA POR AJUSTE ─────────────────────────────
// Está no cabeçalho do catálogo: 29 itens no plano e "virão mais telas". Coluna por caixinha seria
// uma migração por ajuste, num banco em que migração é o item mais caro (LEI 2). O preço — o banco
// não valida `Json` — está pago pelo `validar()` do catálogo, que roda antes de qualquer gravação.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import { encrypt, decrypt } from '../base/crypto.js';
import { escopoDe } from './ragnabot-auditoria.service.js';
import {
  PAINEIS, definicao, chavesDoPainel, escopoDoPainel, validar, ErroDeConfiguracao,
} from './ragnabot-configuracao.catalogo.js';

export { ErroDeConfiguracao };

// ── PORTAS — mesmo desenho dos vizinhos: injeção, para o teste medir a decisão sem banco ────────
const portas = { db: prismaGlobal, log: logger };

export function configurar(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new ErroDeConfiguracao('PORTA_DESCONHECIDA', `porta desconhecida: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}

/** A tabela já migrou NESTE processo? O cliente Prisma é carregado no arranque — a coluna existir
 *  no banco não basta, o processo precisa ter sido reiniciado (decisão do chefe, e só sem sessão). */
export function modeloPronto() {
  return Boolean(portas.db?.ragnabotConfiguracao?.findMany);
}

function tabela() {
  if (!modeloPronto()) {
    throw new ErroDeConfiguracao(
      'MODELO_AUSENTE',
      'A tabela de configurações ainda não está disponível neste processo. Aplique '
      + 'prisma/sql/configuracoes/01-rb_configuracoes.sql e reinicie o serviço.',
      503,
    );
  }
  return portas.db.ragnabotConfiguracao;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ESCOPO — a chave materializada
//
// ⚠️ `tenantId` É ANULÁVEL (a linha do OPERADOR não pertence a empresa nenhuma), então o índice
// único NÃO pode ser sobre ele: no Postgres dois NULOS não colidem, e o whitelabel da casa poderia
// ser cadastrado dez vezes. `chaveEscopo` materializa — "casa" ou "tenant:<uuid>", NOT NULL — e é
// essa que o banco tranca. Mesma lição já paga em `RagnabotPagamentoCredencial.chaveEscopo` e em
// `RagnabotAtendPolitica.escopoChave`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const ESCOPO_DA_CASA = 'casa';

export function chaveDeEscopo(tenantId) {
  return tenantId ? `tenant:${tenantId}` : ESCOPO_DA_CASA;
}

/**
 * Qual escopo este usuário lê/escreve NESTE painel.
 *
 * Painel de empresa → a empresa DELE (super sem empresa lê a da casa? não: recusa, para o super
 * não editar "a configuração de ninguém" sem perceber — ele estreita passando `tenantIdAlvo`).
 * Painel do operador → sempre a casa, e a trava de quem pode é `base/operador-saas.js`, na rota.
 */
export function resolverEscopo(user, painel, { tenantIdAlvo = null } = {}) {
  const esc = escopoDoPainel(painel);
  if (!esc) throw new ErroDeConfiguracao('PAINEL_DESCONHECIDO', `Painel desconhecido: "${painel}".`, 404);

  if (esc === 'operador') {
    return { escopo: 'operador', tenantId: null, chaveEscopo: ESCOPO_DA_CASA };
  }

  const e = escopoDe(user);
  if (e.global) {
    // Super usuário PODE estreitar por empresa, porque ele já pode ver todas. Sem alvo, recusa —
    // gravar "a configuração de ninguém" é o tipo de engano que só aparece meses depois.
    if (!tenantIdAlvo) {
      throw new ErroDeConfiguracao(
        'EMPRESA_NAO_INFORMADA',
        'Super usuário precisa dizer de qual empresa é a configuração (parâmetro empresa).', 400,
      );
    }
    return { escopo: 'empresa', tenantId: String(tenantIdAlvo), chaveEscopo: chaveDeEscopo(tenantIdAlvo) };
  }

  // ⛔ AQUI ESTÁ A TRAVA DO ISOLAMENTO. `tenantIdAlvo` de quem não é super é IGNORADO — inteiro.
  // Foi confiando na empresa que a TELA mandava que o sistema antigo vazou.
  if (!e.tenantId) {
    throw new ErroDeConfiguracao(
      'SEM_EMPRESA', 'A sua conta não está vinculada a nenhuma empresa.', 403,
    );
  }
  return { escopo: 'empresa', tenantId: e.tenantId, chaveEscopo: chaveDeEscopo(e.tenantId) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SEGREDOS
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Impressão digital do valor em claro. 12 hex = 48 bits: suficiente para conferir, curto demais
 *  para servir de atalho a quem quisesse adivinhar o valor por força bruta a partir dela. */
export function impressaoDigitalDe(valorEmClaro) {
  return crypto.createHash('sha256').update(String(valorEmClaro), 'utf8').digest('hex').slice(0, 12);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LEITURA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A forma que a API devolve para uma chave — segredo NUNCA em claro. */
function paraFora(def, linha) {
  const base = {
    chave: def.chave,
    rotulo: def.rotulo,
    tipo: def.tipo,
    painel: def.painel,
    ajuda: def.ajuda || '',
    padrao: def.segredo ? null : def.padrao,
    efeito: def.efeito,
    // `configurado` é diferente de "tem valor": diz se ALGUÉM já mexeu nesta chave, ou se o que se
    // vê é o padrão de fábrica. É a pergunta que o suporte faz primeiro.
    configurado: Boolean(linha),
    atualizadoEm: linha?.atualizadoEm || null,
    atualizadoPor: linha?.atualizadoPorNome || null,
  };
  if (def.opcoes) base.opcoes = def.opcoes;
  if (def.min !== undefined) base.min = def.min;
  if (def.max !== undefined) base.max = def.max;
  if (def.maxLen !== undefined) base.maxLen = def.maxLen;
  if (def.jaExiste) base.jaExiste = def.jaExiste;
  if (def.informativo) base.informativo = true;
  if (def.exigeMarcas) base.exigeMarcas = def.exigeMarcas;

  if (def.segredo) {
    // ⛔ O valor cifrado NÃO SAI daqui. Nem para "a tela mostrar mascarado" — o que sai mascarado
    // pela tela chegou inteiro pela rede, e rede tem registro.
    base.definido = Boolean(linha?.impressaoDigital);
    base.impressaoDigital = linha?.impressaoDigital || null;
    base.valor = null;
    return base;
  }
  base.valor = linha ? linha.valor?.v : def.padrao;
  // Chave gravada antes de o catálogo mudar de tipo devolve o padrão em vez de um valor que a tela
  // não sabe desenhar. Falha visível é melhor que tela quebrada.
  if (linha && base.valor === undefined) base.valor = def.padrao;
  return base;
}

/**
 * Lê um painel inteiro, já com padrões preenchidos.
 * @returns {Promise<{painel:string, escopo:string, tenantId:string|null, itens:Array}>}
 */
export async function lerPainel(user, painel, { tenantIdAlvo = null } = {}) {
  const alvo = resolverEscopo(user, painel, { tenantIdAlvo });
  const defs = chavesDoPainel(painel);
  if (defs.length === 0) {
    throw new ErroDeConfiguracao('PAINEL_DESCONHECIDO', `Painel desconhecido: "${painel}".`, 404);
  }

  const linhas = await tabela().findMany({
    where: { chaveEscopo: alvo.chaveEscopo, painel },
  });
  const porChave = new Map(linhas.map((l) => [l.chave, l]));

  return {
    painel,
    rotulo: PAINEIS.find((p) => p.id === painel)?.rotulo || painel,
    escopo: alvo.escopo,
    tenantId: alvo.tenantId,
    itens: defs.map((def) => paraFora(def, porChave.get(def.chave) || null)),
  };
}

/**
 * Leitura INTERNA, para o resto do produto consumir um ajuste. Devolve o valor cru (já com o
 * padrão do catálogo quando ninguém configurou). ⚠️ Para chave de segredo devolve `null` — quem
 * precisa do segredo chama `lerSegredo()`, que é explícito de propósito.
 */
export async function valorDe(tenantId, chave) {
  const def = definicao(chave);
  if (!def) throw new ErroDeConfiguracao('CHAVE_DESCONHECIDA', `Ajuste desconhecido: "${chave}".`);
  if (def.segredo) return null;
  if (!modeloPronto()) return def.padrao; // sem tabela, o produto roda no padrão em vez de quebrar
  const linha = await tabela().findFirst({
    where: { chaveEscopo: chaveDeEscopo(def.escopo === 'operador' ? null : tenantId), chave },
  });
  const v = linha?.valor?.v;
  return v === undefined ? def.padrao : v;
}

/**
 * O segredo em claro. Ponto ÚNICO de decifragem — e por isso o único lugar a auditar quando
 * alguém perguntar "quem leu a chave de IA da empresa X?".
 * ⛔ NUNCA registre o retorno desta função em log.
 */
export async function lerSegredo(tenantId, chave) {
  const def = definicao(chave);
  if (!def?.segredo) throw new ErroDeConfiguracao('CHAVE_NAO_E_SEGREDO', `"${chave}" não é um segredo.`);
  if (!modeloPronto()) return null;
  const linha = await tabela().findFirst({
    where: { chaveEscopo: chaveDeEscopo(def.escopo === 'operador' ? null : tenantId), chave },
  });
  const cifrado = linha?.valor?.c;
  if (!cifrado) return null;
  try {
    return decrypt(cifrado);
  } catch (e) {
    // Chave de cifragem trocada, ou valor corrompido. NÃO devolvemos o texto cifrado como se fosse
    // o segredo (é o que `decryptSafe` faria) — mandar um blob hex como senha de SMTP daria um
    // erro de autenticação três camadas adiante, sem ninguém ligar as pontas.
    portas.log.error(`[config] segredo "${chave}" não abriu (empresa ${tenantId || 'casa'}): ${e.message}`);
    throw new ErroDeConfiguracao('SEGREDO_NAO_ABRE',
      'O segredo guardado não pôde ser lido com a chave de cifragem atual. Cadastre-o de novo.', 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GRAVAÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O que vai para a coluna `valor` (Json). Segredo vira `{c: cifrado}`; o resto, `{v: valor}`. */
function paraBanco(def, valorValidado) {
  if (def.segredo) return { c: encrypt(valorValidado) };
  return { v: valorValidado };
}

/** A forma auditável de um valor. ⛔ Segredo vira impressão digital, NUNCA o valor. */
function paraAuditoria(def, linha) {
  if (!linha) return null;
  if (def.segredo) return { impressaoDigital: linha.impressaoDigital || null };
  return linha.valor?.v ?? null;
}

/**
 * Salva um punhado de ajustes de um painel.
 *
 * @param {object} user            quem está salvando (decide o escopo)
 * @param {string} painel
 * @param {object} valores         { 'chave.completa': valor, … } — chave de OUTRO painel é recusada
 * @param {object} opcoes
 * @param {string} [opcoes.tenantIdAlvo]  só honrado para super
 * @returns {Promise<{painel:string, tenantId:string|null, mudancas:Array, semMudanca:Array}>}
 */
export async function salvarPainel(user, painel, valores, { tenantIdAlvo = null } = {}) {
  const alvo = resolverEscopo(user, painel, { tenantIdAlvo });
  if (!valores || typeof valores !== 'object' || Array.isArray(valores)) {
    throw new ErroDeConfiguracao('CORPO_INVALIDO', 'Informe os ajustes a salvar.');
  }
  const entradas = Object.entries(valores);
  if (entradas.length === 0) throw new ErroDeConfiguracao('CORPO_INVALIDO', 'Nenhum ajuste informado.');
  if (entradas.length > 200) throw new ErroDeConfiguracao('CORPO_INVALIDO', 'Ajustes demais numa só gravação.');

  // 1. VALIDA TUDO ANTES DE GRAVAR QUALQUER COISA. Meia gravação num painel deixa a empresa numa
  //    combinação que ninguém escolheu — e o operador não tem como saber quais das 10 caixinhas
  //    pegaram. Ou vai tudo, ou não vai nada.
  const preparados = [];
  for (const [chave, valorCru] of entradas) {
    const def = definicao(chave);
    if (!def) throw new ErroDeConfiguracao('CHAVE_DESCONHECIDA', `Ajuste desconhecido: "${chave}".`);
    if (def.painel !== painel) {
      // Recusa explícita: sem isto, um pedido ao painel "aparencia" gravaria a chave de IA — e a
      // trava do operador do SaaS seria contornável salvando whitelabel por um painel de empresa.
      throw new ErroDeConfiguracao('CHAVE_DE_OUTRO_PAINEL',
        `"${chave}" é do painel "${def.painel}", não de "${painel}".`);
    }
    preparados.push({ def, valor: validar(chave, valorCru) });
  }

  // 2. Lê o ANTES — de todas as chaves tocadas, de uma vez.
  const chaves = preparados.map((p) => p.def.chave);
  const antesLinhas = await tabela().findMany({
    where: { chaveEscopo: alvo.chaveEscopo, chave: { in: chaves } },
  });
  const antesPorChave = new Map(antesLinhas.map((l) => [l.chave, l]));

  const mudancas = [];
  const semMudanca = [];
  const agora = new Date();

  for (const { def, valor } of preparados) {
    const linhaAntes = antesPorChave.get(def.chave) || null;
    const antes = paraAuditoria(def, linhaAntes);

    // `null` = voltar ao padrão → apaga a linha. É o único jeito de "desconfigurar" sem inventar
    // um valor sentinela que um dia alguém confundiria com valor de verdade.
    if (valor === null) {
      if (!linhaAntes) { semMudanca.push(def.chave); continue; }
      // `deleteMany` e não `delete`: o `delete` singular lança quando não acha, e aqui a
      // ausência já foi tratada acima. Um caminho de erro a menos para o mesmo efeito.
      await tabela().deleteMany({ where: { id: linhaAntes.id } });
      mudancas.push({ chave: def.chave, rotulo: def.rotulo, antes, depois: null, segredo: def.segredo });
      continue;
    }

    const impressao = def.segredo ? impressaoDigitalDe(valor) : null;

    // Nada mudou? Não grava e não audita. Auditoria cheia de "salvou o mesmo valor" é auditoria
    // que ninguém lê — e a que ninguém lê é a que não pega o dia em que mudou de verdade.
    if (linhaAntes) {
      const igual = def.segredo
        ? linhaAntes.impressaoDigital === impressao
        : JSON.stringify(linhaAntes.valor?.v ?? null) === JSON.stringify(valor);
      if (igual) { semMudanca.push(def.chave); continue; }
    }

    const dados = {
      tenantId: alvo.tenantId,
      chaveEscopo: alvo.chaveEscopo,
      painel,
      chave: def.chave,
      valor: paraBanco(def, valor),
      segredo: def.segredo,
      impressaoDigital: impressao,
      atualizadoPorId: user?.id ? String(user.id) : null,
      atualizadoPorNome: user?.name || user?.username || null,
      atualizadoEm: agora,
    };

    if (linhaAntes) await tabela().update({ where: { id: linhaAntes.id }, data: dados });
    else await tabela().create({ data: { ...dados, criadoEm: agora } });

    mudancas.push({
      chave: def.chave,
      rotulo: def.rotulo,
      antes,
      depois: def.segredo ? { impressaoDigital: impressao } : valor,
      segredo: def.segredo,
    });
  }

  return { painel, escopo: alvo.escopo, tenantId: alvo.tenantId, mudancas, semMudanca };
}

/**
 * O mapa completo de uma empresa, para quem precisa de tudo de uma vez (a tela, ao abrir).
 * Só os painéis de EMPRESA — whitelabel sai por rota própria, atrás da trava do operador.
 */
export async function lerTodosOsPaineisDaEmpresa(user, { tenantIdAlvo = null } = {}) {
  const saida = [];
  for (const p of PAINEIS) {
    if (p.escopo !== 'empresa') continue;
    saida.push(await lerPainel(user, p.id, { tenantIdAlvo }));
  }
  return saida;
}

export default {
  configurar, modeloPronto, chaveDeEscopo, resolverEscopo, impressaoDigitalDe,
  lerPainel, lerTodosOsPaineisDaEmpresa, valorDe, lerSegredo, salvarPainel,
  ESCOPO_DA_CASA, ErroDeConfiguracao,
};
