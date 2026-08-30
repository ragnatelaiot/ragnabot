// ════════════════════════════════════════════════════════════════════════════════════════════════
// ORIGEM AUTORIZADA — quem pode abrir chamado, e a que empresa o contato pertence.
//
// POR QUÊ: ordem do dono (28/08/2026). Ele quer cadastrar "apenas o domínio todo e/ou por conta de
// e-mail e associar a empresa", e quer que contato de origem NÃO cadastrada seja RECUSADO — decisão
// tomada depois de eu levantar o risco de barrar prospecto novo. A decisão se sustenta porque
// `suporte@` é canal de CLIENTE EXISTENTE; quem chega novo entra pelo comercial.
//
// E ele acrescentou a peça que evita o buraco negro: a recusa RESPONDE, dizendo que aquele endereço
// não está habilitado e apontando o WhatsApp. Recusar em silêncio faria a mensagem sumir sem que
// nem o cliente nem nós ficássemos sabendo.
//
// SERVE AOS DOIS CANAIS de propósito: a alocação acontece na CONVERSA, não no canal. É isso que
// permite "cada novo cliente que entrou em contato por whats e mail alocar ao grupo (empresa)".
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';

// Link comercial oficial (decidido em 13/08/2026, ver PENDENCIAS-MARKETING).
// ⚠️ É o número COMERCIAL (3197-0997), NÃO o 8300-8197 que envia alerta do NOC.
export const LINK_WHATSAPP = 'https://wa.me/559831970997';

// ── normalização: o cadastro e a consulta precisam concordar, sempre ────────────────────────────
// Sem isto, "Empresa.COM.BR " cadastrado nunca casa com "empresa.com.br" recebido — e a falha
// aparece como "cliente cadastrado sendo recusado", que é o pior tipo de bug para diagnosticar.
export function normalizar(tipo, valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (tipo === 'whatsapp') return v.replace(/\D/g, '');
  if (tipo === 'dominio') return v.replace(/^@/, '').replace(/^www\./, '');
  return v; // email
}

export function dominioDoEmail(email) {
  const m = String(email ?? '').trim().toLowerCase().match(/@([^@\s>]+)$/);
  return m ? m[1] : null;
}

/**
 * Resolve a que empresa pertence um contato.
 * Precedência: e-mail exato > domínio. A conta avulsa vence o domínio de propósito —
 * é o que permite alocar um endereço específico a outra empresa sem abrir exceção no domínio todo.
 * @returns {Promise<{autorizado:boolean, tenant?:object, origem?:object, motivo?:string}>}
 */
export async function resolverEmpresa(canal, valorBruto) {
  if (canal === 'whatsapp') {
    const numero = normalizar('whatsapp', valorBruto);
    if (!numero) return { autorizado: false, motivo: 'número vazio' };
    const o = await buscar('whatsapp', numero);
    return o ? { autorizado: true, tenant: o.tenant, origem: o } : { autorizado: false, motivo: 'número não cadastrado' };
  }

  const email = normalizar('email', valorBruto);
  if (!email || !email.includes('@')) return { autorizado: false, motivo: 'endereço inválido' };

  const exato = await buscar('email', email);
  if (exato) return { autorizado: true, tenant: exato.tenant, origem: exato };

  const dom = dominioDoEmail(email);
  if (dom) {
    const porDominio = await buscar('dominio', dom);
    if (porDominio) return { autorizado: true, tenant: porDominio.tenant, origem: porDominio };
  }
  return { autorizado: false, motivo: 'domínio não cadastrado' };
}

async function buscar(tipo, valor) {
  const o = await prisma.ragnabotOrigemAutorizada.findUnique({
    where: { tipo_valor: { tipo, valor } },
    include: { tenant: true },
  });
  // `ativo` guarda o MOTIVO da desativação; null = ativo. Origem desativada não autoriza,
  // e a empresa encerrada também não — senão um cliente que saiu continuaria abrindo chamado.
  if (!o || o.ativo) return null;
  if (o.tenant?.status === 'closed') return null;
  return o;
}

// ── texto da recusa (palavras do dono, 28/08/2026) ─────────────────────────────────────────────
export function textoDaRecusa() {
  return {
    assunto: 'Não foi possível abrir seu chamado',
    corpo:
      'Olá,\n\n' +
      'Recebemos a sua mensagem, mas este endereço de e-mail não está habilitado para abrir ' +
      'chamado de suporte.\n\n' +
      'Por favor, entre em contato pelo nosso canal de atendimento no WhatsApp:\n' +
      `${LINK_WHATSAPP}\n\n` +
      'Se você é cliente e acredita que este endereço deveria estar liberado, fale com o nosso ' +
      'atendimento pelo mesmo link e nós cadastramos.\n\n' +
      'Atenciosamente,\n' +
      'Ragnatela IoT Solutions',
    html:
      '<p>Olá,</p>' +
      '<p>Recebemos a sua mensagem, mas <strong>este endereço de e-mail não está habilitado ' +
      'para abrir chamado de suporte</strong>.</p>' +
      '<p>Por favor, entre em contato pelo nosso canal de atendimento no WhatsApp:<br>' +
      `<a href="${LINK_WHATSAPP}">${LINK_WHATSAPP}</a></p>` +
      '<p>Se você é cliente e acredita que este endereço deveria estar liberado, fale com o nosso ' +
      'atendimento pelo mesmo link e nós cadastramos.</p>' +
      '<p>Atenciosamente,<br>Ragnatela IoT Solutions</p>',
  };
}

/**
 * Registra a recusa e responde ao remetente.
 *
 * ⚠️ ANTI-LOOP: só responde a endereço que não seja automático. Responder a `no-reply@`,
 * `mailer-daemon@` ou a uma lista pode gerar troca infinita de mensagens entre dois robôs —
 * falha clássica de resposta automática, e cara, porque só se descobre pelo volume.
 *
 * ⚠️ ANTI-REPETIÇÃO: um mesmo remetente insistindo não recebe a mesma resposta várias vezes ao dia.
 */
export async function recusar({ canal, origem, assunto, resumo, motivo }) {
  const registro = await prisma.ragnabotContatoRecusado.create({
    data: {
      canal,
      origem: String(origem ?? '').slice(0, 320),
      assunto: assunto ? String(assunto).slice(0, 500) : null,
      resumo: resumo ? String(resumo).slice(0, 2000) : null,
    },
  });

  if (canal !== 'email') return { registro, respondido: false, porque: 'canal sem resposta automática' };
  if (ehRemetenteAutomatico(origem)) return { registro, respondido: false, porque: 'remetente automático' };

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const jaAvisado = await prisma.ragnabotContatoRecusado.count({
    where: { canal: 'email', origem: String(origem), criadoEm: { gte: desde }, id: { not: registro.id } },
  });
  if (jaAvisado > 0) return { registro, respondido: false, porque: 'já avisado nas últimas 24h' };

  try {
    const { sendEmail } = await import('./smtp.service.js');
    const t = textoDaRecusa();
    await sendEmail({ to: origem, subject: t.assunto, text: t.corpo, html: t.html });
    return { registro, respondido: true, motivo };
  } catch (e) {
    // Falha de envio NÃO invalida o registro: a recusa continua consultável na tela,
    // e alguém pode responder à mão. Perder o registro seria perder o contato de vez.
    return { registro, respondido: false, porque: `falha ao enviar: ${e.message}` };
  }
}

function ehRemetenteAutomatico(email) {
  const e = String(email ?? '').toLowerCase();
  return /(^|[.<])(no-?reply|noreply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifica[cç][aã]o|automat)/.test(e)
    || /^(.*-)?(bounces?|owner|request)@/.test(e);
}

// ── CRUD do cadastro ───────────────────────────────────────────────────────────────────────────
export async function listarOrigens({ tenantId } = {}) {
  return prisma.ragnabotOrigemAutorizada.findMany({
    where: tenantId ? { tenantId } : {},
    include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: [{ tipo: 'asc' }, { valor: 'asc' }],
  });
}

export async function cadastrarOrigem({ tenantId, tipo, valor, observacao, usuarioId }) {
  if (!['dominio', 'email', 'whatsapp'].includes(tipo)) {
    throw new Error('tipo deve ser dominio, email ou whatsapp');
  }
  const v = normalizar(tipo, valor);
  if (!v) throw new Error('valor vazio');
  if (tipo === 'email' && !v.includes('@')) throw new Error('e-mail precisa conter @');
  if (tipo === 'dominio' && (v.includes('@') || !v.includes('.'))) {
    throw new Error('domínio deve ser como empresa.com.br, sem @');
  }
  if (tipo === 'whatsapp' && v.length < 10) throw new Error('número curto demais');

  const tenant = await prisma.ragnabotTenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('empresa não encontrada');

  // Conflito é FALHA DURA e com mensagem útil: dizer só "já existe" obriga quem cadastra a
  // caçar onde está — e o dono já decidiu que e-mail repetido entre empresas é falha dura.
  const existente = await prisma.ragnabotOrigemAutorizada.findUnique({
    where: { tipo_valor: { tipo, valor: v } },
    include: { tenant: { select: { name: true } } },
  });
  if (existente) throw new Error(`"${v}" já está cadastrado na empresa ${existente.tenant?.name ?? '(desconhecida)'}`);

  const criada = await prisma.ragnabotOrigemAutorizada.create({
    data: { tenantId, tipo, valor: v, observacao: observacao || null, createdByUserId: usuarioId || null },
  });

  // Cadastrar a origem resolve as recusas pendentes daquele remetente/domínio — assim a tela de
  // recusados não vira lista eterna de coisa já tratada.
  await resolverRecusasDe(tipo, v).catch(() => {});
  return criada;
}

async function resolverRecusasDe(tipo, valor) {
  if (tipo === 'whatsapp') {
    return prisma.ragnabotContatoRecusado.updateMany({
      where: { canal: 'whatsapp', origem: valor, resolvido: false }, data: { resolvido: true },
    });
  }
  if (tipo === 'email') {
    return prisma.ragnabotContatoRecusado.updateMany({
      where: { canal: 'email', origem: valor, resolvido: false }, data: { resolvido: true },
    });
  }
  return prisma.ragnabotContatoRecusado.updateMany({
    where: { canal: 'email', origem: { endsWith: `@${valor}` }, resolvido: false }, data: { resolvido: true },
  });
}

export async function desativarOrigem({ id, motivo }) {
  if (!motivo || !String(motivo).trim()) throw new Error('motivo é obrigatório para desativar');
  return prisma.ragnabotOrigemAutorizada.update({ where: { id }, data: { ativo: String(motivo).trim() } });
}

export async function reativarOrigem({ id }) {
  return prisma.ragnabotOrigemAutorizada.update({ where: { id }, data: { ativo: null } });
}

export async function removerOrigem({ id }) {
  return prisma.ragnabotOrigemAutorizada.delete({ where: { id } });
}

export async function listarRecusados({ apenasPendentes = true, limite = 200 } = {}) {
  return prisma.ragnabotContatoRecusado.findMany({
    where: apenasPendentes ? { resolvido: false } : {},
    orderBy: { criadoEm: 'desc' },
    take: Math.min(Number(limite) || 200, 1000),
  });
}
