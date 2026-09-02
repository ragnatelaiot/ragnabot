// =============================================================================
// Matriz de planos do RAGNABOT (SaaS de atendimento omnichannel).
//
// POR QUE ISSO VIVE EM CÓDIGO E NÃO NO BANCO: o limite é regra de produto, e
// regra de produto precisa de revisão em "pull request", não de UPDATE solto.
// O que É por tenant (override negociado, data de vencimento, preço fechado)
// vive no `RagnabotTenant.limits` — snapshot gravado no provisionamento.
//
// ⚠️ PREÇO NÃO ENTRA AQUI. Preço é decisão comercial do dono e, quando existir,
// fica em `Settings` (encrypted) do NOC — nunca no git. Este arquivo só define
// CAPACIDADE (quantos agentes, quantas caixas, quais canais).
//
// NOC 2026-08-28 — frente SaaS/multiconexão.
// =============================================================================

// Tipos de canal que o Chatwoot 4.x cria por caixa de entrada (inbox).
// O valor é EXATAMENTE o `channel.type` aceito pela API da aplicação.
export const CANAIS = {
  web_widget: 'Webchat (widget no site)',
  whatsapp: 'WhatsApp (Cloud API da Meta)',
  email: 'E-mail (IMAP/SMTP ou encaminhamento)',
  telegram: 'Telegram (bot do BotFather)',
  instagram: 'Instagram Direct',
  facebook: 'Messenger (página do Facebook)',
  api: 'Canal API (integração própria)',
};

// Teto TÉCNICO de caixas por conta. "Ilimitado" comercial nunca é ilimitado de
// verdade: cada caixa de WhatsApp é um webhook vivo e um job de sincronização de
// modelos. O teto protege a plataforma inteira de um único tenant.
export const TETO_TECNICO_CAIXAS = 30;

export const PLANOS = {
  essencial: {
    rotulo: 'Essencial',
    agentes: 3,
    caixas: 2,
    // Multiconexão: quantas caixas do MESMO tipo o plano permite.
    // 1 = um número de WhatsApp; 3 = três números na mesma empresa.
    caixasPorCanal: { whatsapp: 1, web_widget: 1, email: 1, telegram: 1, instagram: 1, facebook: 1, api: 1 },
    canais: ['web_widget', 'whatsapp'],
    conversasMes: 500,
    // Teto de respostas do agente de IA (Capitão) por mês. É REGRA DE PRODUTO, por isso
    // mora aqui e não no banco. 0 = o plano NÃO inclui agente de IA.
    iaRespostasMes: 0,
    retencaoDias: 365,
    whiteLabelWidget: false,
  },
  profissional: {
    rotulo: 'Profissional',
    agentes: 10,
    caixas: 5,
    caixasPorCanal: { whatsapp: 2, web_widget: 2, email: 2, telegram: 1, instagram: 1, facebook: 1, api: 1 },
    canais: ['web_widget', 'whatsapp', 'email', 'instagram', 'facebook'],
    conversasMes: 3000,
    // Teto de respostas do agente de IA (Capitão) por mês. É REGRA DE PRODUTO, por isso
    // mora aqui e não no banco. 0 = o plano NÃO inclui agente de IA.
    iaRespostasMes: 300,
    retencaoDias: 730,
    whiteLabelWidget: true,
  },
  avancado: {
    rotulo: 'Avançado',
    agentes: 25,
    caixas: TETO_TECNICO_CAIXAS,
    caixasPorCanal: { whatsapp: 10, web_widget: 5, email: 5, telegram: 5, instagram: 3, facebook: 3, api: 5 },
    canais: Object.keys(CANAIS),
    conversasMes: 10000,
    // Teto de respostas do agente de IA (Capitão) por mês. É REGRA DE PRODUTO, por isso
    // mora aqui e não no banco. 0 = o plano NÃO inclui agente de IA.
    iaRespostasMes: 1500,
    retencaoDias: 730,
    whiteLabelWidget: true,
  },
  // Contrato negociado: nasce igual ao Avançado e é ajustado no `limits` do tenant.
  custom: {
    rotulo: 'Sob contrato',
    agentes: 25,
    caixas: TETO_TECNICO_CAIXAS,
    caixasPorCanal: { whatsapp: 10, web_widget: 5, email: 5, telegram: 5, instagram: 3, facebook: 3, api: 5 },
    canais: Object.keys(CANAIS),
    conversasMes: 10000,
    // Teto de respostas do agente de IA (Capitão) por mês. É REGRA DE PRODUTO, por isso
    // mora aqui e não no banco. 0 = o plano NÃO inclui agente de IA.
    iaRespostasMes: 1500,
    retencaoDias: 730,
    whiteLabelWidget: true,
  },
};

export function planoExiste(nome) {
  return Object.prototype.hasOwnProperty.call(PLANOS, String(nome || ''));
}

/**
 * Limites efetivos de um plano, opcionalmente com override negociado por tenant.
 * Devolve SEMPRE uma cópia — nada aqui pode ser mutado por quem chama.
 */
export function limitesDoPlano(nome, override = null) {
  if (!planoExiste(nome)) throw new Error(`Plano desconhecido: "${nome}"`);
  const base = PLANOS[nome];
  const limites = {
    ...base,
    canais: [...base.canais],
    caixasPorCanal: { ...base.caixasPorCanal },
  };
  if (override && typeof override === 'object') {
    for (const chave of ['agentes', 'caixas', 'conversasMes', 'retencaoDias', 'iaRespostasMes']) {
      if (Number.isFinite(override[chave])) limites[chave] = override[chave];
    }
    if (Array.isArray(override.canais)) limites.canais = override.canais.filter((c) => c in CANAIS);
    if (override.caixasPorCanal && typeof override.caixasPorCanal === 'object') {
      limites.caixasPorCanal = { ...limites.caixasPorCanal, ...override.caixasPorCanal };
    }
    if (typeof override.whiteLabelWidget === 'boolean') limites.whiteLabelWidget = override.whiteLabelWidget;
  }
  // O teto técnico vence QUALQUER negociação comercial.
  limites.caixas = Math.min(limites.caixas, TETO_TECNICO_CAIXAS);
  return limites;
}

/**
 * A caixa nova cabe no plano?
 * @param {object} limites   saída de limitesDoPlano()
 * @param {string} tipoCanal channel.type pretendido
 * @param {Array<{channelType:string}>} caixasAtuais caixas já existentes na conta
 * @returns {{permitido:boolean, motivo?:string}}
 */
export function cabeMaisUmaCaixa(limites, tipoCanal, caixasAtuais = []) {
  if (!(tipoCanal in CANAIS)) {
    return { permitido: false, motivo: `Canal "${tipoCanal}" não é suportado pela plataforma.` };
  }
  if (!limites.canais.includes(tipoCanal)) {
    return { permitido: false, motivo: `O plano não inclui o canal "${CANAIS[tipoCanal]}".` };
  }
  if (caixasAtuais.length >= limites.caixas) {
    return { permitido: false, motivo: `Limite de ${limites.caixas} caixa(s) de entrada atingido neste plano.` };
  }
  const doTipo = caixasAtuais.filter((c) => c.channelType === tipoCanal).length;
  const tetoDoTipo = limites.caixasPorCanal?.[tipoCanal];
  if (Number.isFinite(tetoDoTipo) && doTipo >= tetoDoTipo) {
    return { permitido: false, motivo: `Limite de ${tetoDoTipo} caixa(s) do canal "${CANAIS[tipoCanal]}" atingido neste plano.` };
  }
  return { permitido: true };
}

export default PLANOS;
