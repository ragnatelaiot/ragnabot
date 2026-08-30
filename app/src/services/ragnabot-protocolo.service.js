// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROTOCOLO DE ATENDIMENTO — RGT-0000000001, um por empresa, sequência própria.
//
// Ordem do dono: "cada atendimento deverá ter um protocolo... RGT-SEQUÊNCIA DE 10 NÚMEROS";
// "cada empresa terá 3 letras de prefixo, análogo ao RGT". Busca pelo protocolo é requisito.
//
// O PONTO CRÍTICO é a concorrência: dois atendimentos nascendo no mesmo instante NÃO podem receber
// o mesmo número. A geração é feita num UPDATE atômico do contador dentro de uma transação, e a
// idempotência por conversa garante que reprocessar o mesmo webhook não gere segundo protocolo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';

const LARGURA = 10; // 10 dígitos com zeros à esquerda

export function formatar(prefixo, numero) {
  return `${prefixo}-${String(numero).padStart(LARGURA, '0')}`;
}

export function validarPrefixo(p) {
  const v = String(p ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) throw new Error('prefixo deve ter exatamente 3 letras (A-Z)');
  return v;
}

/**
 * Define/garante o prefixo de uma empresa. Idempotente: chamar de novo com o mesmo prefixo não faz
 * nada; com prefixo diferente, ERRA — trocar prefixo com protocolos já emitidos bagunçaria a
 * numeração humana, então é bloqueado de propósito.
 */
export async function definirPrefixo(tenantId, prefixoBruto) {
  const prefixo = validarPrefixo(prefixoBruto);
  const existente = await prisma.ragnabotContadorProtocolo.findUnique({ where: { tenantId } });
  if (existente) {
    if (existente.prefixo !== prefixo) {
      throw new Error(`empresa já usa o prefixo ${existente.prefixo}; trocar quebraria os protocolos já emitidos`);
    }
    return existente;
  }
  // Prefixo é único no sistema todo (uma empresa não pode "roubar" o RGT de outra).
  const colidiu = await prisma.ragnabotContadorProtocolo.findUnique({ where: { prefixo } });
  if (colidiu) throw new Error(`o prefixo ${prefixo} já pertence a outra empresa`);

  return prisma.ragnabotContadorProtocolo.create({ data: { tenantId, prefixo } });
}

/**
 * Emite (ou recupera) o protocolo de uma conversa.
 *
 * Idempotência: se a conversa já tem protocolo, devolve o mesmo — reprocessar o webhook de criação
 * não gera número novo. Isso é o `@@unique([cwAccountId, cwConversationId])` fazendo o trabalho.
 *
 * Atomicidade: o próximo número sai de um UPDATE que incrementa o contador e devolve o novo valor,
 * tudo na mesma transação da inserção do protocolo. Sob corrida, o banco serializa os UPDATEs da
 * MESMA linha de contador — cada um enxerga o incremento do anterior. Nunca há número repetido.
 *
 * @returns {Promise<{protocolo:string, numero:number, novo:boolean}>}
 */
export async function emitirProtocolo({ tenantId, cwAccountId, cwConversationId }) {
  if (!tenantId) throw new Error('tenantId obrigatório');
  if (cwAccountId == null || cwConversationId == null) throw new Error('conversa obrigatória');

  // caminho rápido: já existe?
  const jaExiste = await prisma.ragnabotProtocolo.findUnique({
    where: { cwAccountId_cwConversationId: { cwAccountId, cwConversationId } },
  });
  if (jaExiste) return { protocolo: jaExiste.protocolo, numero: jaExiste.numero, novo: false };

  // A empresa precisa ter prefixo. Se não tiver, é erro de cadastro — não inventamos prefixo.
  const contador = await prisma.ragnabotContadorProtocolo.findUnique({ where: { tenantId } });
  if (!contador) throw new Error(`empresa ${tenantId} não tem prefixo de protocolo definido`);

  try {
    return await prisma.$transaction(async (tx) => {
      // UPDATE atômico: incrementa e lê o novo valor. Duas transações concorrentes sobre a MESMA
      // linha são serializadas pelo banco — a segunda espera o commit da primeira e vê ultimo+1.
      const atualizado = await tx.ragnabotContadorProtocolo.update({
        where: { tenantId },
        data: { ultimo: { increment: 1 } },
      });
      const numero = atualizado.ultimo;
      const protocolo = formatar(contador.prefixo, numero);

      const criado = await tx.ragnabotProtocolo.create({
        data: { tenantId, prefixo: contador.prefixo, numero, protocolo, cwAccountId, cwConversationId },
      });
      return { protocolo: criado.protocolo, numero: criado.numero, novo: true };
    });
  } catch (e) {
    // Corrida perdida na inserção (dois webhooks da MESMA conversa ao mesmo tempo): a violação do
    // unique de conversa significa que o outro venceu. Devolvemos o protocolo dele — não é erro.
    if (e.code === 'P2002') {
      const agora = await prisma.ragnabotProtocolo.findUnique({
        where: { cwAccountId_cwConversationId: { cwAccountId, cwConversationId } },
      });
      if (agora) return { protocolo: agora.protocolo, numero: agora.numero, novo: false };
    }
    throw e;
  }
}

/**
 * Busca por protocolo. SEMPRE recebe o escopo de empresa do chamador (ou null = super user global).
 * NUNCA confia em empresa vinda da tela — o filtro é do contexto de quem está logado.
 */
export async function buscarPorProtocolo(protocolo, { tenantIdEscopo = null } = {}) {
  const p = String(protocolo ?? '').trim().toUpperCase();
  const reg = await prisma.ragnabotProtocolo.findUnique({ where: { protocolo: p } });
  if (!reg) return null;
  // Isolamento: admin de empresa só enxerga o que é da empresa dele.
  if (tenantIdEscopo && reg.tenantId !== tenantIdEscopo) return null;
  return reg;
}

export async function listarProtocolos({ tenantIdEscopo = null, limite = 100 } = {}) {
  return prisma.ragnabotProtocolo.findMany({
    where: tenantIdEscopo ? { tenantId: tenantIdEscopo } : {},
    orderBy: { criadoEm: 'desc' },
    take: Math.min(Number(limite) || 100, 1000),
  });
}
