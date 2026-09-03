// ════════════════════════════════════════════════════════════════════════════════════════════════
// QUEM É O OPERADOR DO SaaS — a autoridade única da ordem do dono (contrato S7, 02/09/2026)
//
//   > "colunas whitelabel, empresas e planos só aparecem na conta que vende o SaaS — no caso, na
//   >  Ragnatela. Na conta de cliente elas não aparecem."
//
// ── ⛔ ISTO É ISOLAMENTO DE SERVIDOR, NÃO INTERFACE ─────────────────────────────────────────────
// Esconder a aba no menu não vale. O cliente descobre a URL, chama a API e lê a base comercial de
// TODAS as outras empresas — plano, valor, vencimento, e-mail de contato. É o mesmo defeito do
// contrato S2, em lugar diferente. Por isso a decisão mora AQUI, num módulo só, e o menu apenas
// PERGUNTA a este módulo (por `GET /api/ragnabot-config/quem-sou`) o que pode desenhar.
//
// ── COMO A RESPOSTA É DECIDIDA (e por que nesta ordem) ─────────────────────────────────────────
//   1. SUPER USUÁRIO → concede. Por desenho de `base/auth.js`, super só chega pelo TOKEN DE
//      SERVIÇO (o console de operação, o NOC). Nenhum cookie de navegador vira super, nunca.
//   2. SESSÃO DE NAVEGADOR cuja empresa/conta é a EMPRESA OPERADORA declarada no ambiente
//      (`RAGNABOT_TENANT_OPERADOR` = uuid do RagnabotTenant, e/ou `RAGNABOT_CONTA_OPERADORA` =
//      cwAccountId na plataforma) → concede. É como a pessoa da Ragnatela opera pelo navegador
//      sem precisar do token de serviço na mão.
//   3. QUALQUER OUTRO CASO → NEGA.
//
// ⚠️ E O PASSO 2 SÓ EXISTE SE ALGUÉM DECLAROU A EMPRESA OPERADORA. Sem a variável, o módulo NÃO
// adivinha: nega para todo cookie e só o super passa. Falha FECHADA, de propósito e pela mesma
// razão escrita em `services/device.service.js`: permissão que erra para o lado aberto é,
// literalmente, como se vaza empresa — o erro aparece no vazamento, não no monitor. No pior caso
// alguém legítimo recebe 403 e o chefe declara a variável, com nome e critério.
//
// ⚠️ POR QUE NÃO DEDUZIR "É A RAGNATELA" PELO `slug` OU PELO NOME: porque nome de empresa é dado
// de cadastro, editável pela própria tela de Empresas. Uma empresa cliente que se renomeasse
// "Ragnatela" herdaria o SaaS inteiro. O que manda tem de ser algo que o cliente não escreve — e
// variável de ambiente do pod é exatamente isso.
//
// ── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────────────────────────
// Não olha banco. É função pura sobre `req.user` mais a configuração do processo, para poder ser
// medida sem Postgres e para não transformar cada leitura de menu numa consulta.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Lê a configuração do ambiente a cada chamada — o teste troca `process.env` e mede sem reimportar. */
export function empresaOperadoraDeclarada() {
  const tenantId = String(process.env.RAGNABOT_TENANT_OPERADOR || '').trim() || null;
  const cru = String(process.env.RAGNABOT_CONTA_OPERADORA || '').trim();
  const contaId = cru === '' ? null : Number(cru);
  return {
    tenantId,
    // Conta inválida (texto que não é número) é tratada como AUSENTE, nunca como 0 — um `NaN`
    // comparado com `===` seria sempre falso, mas um `0` casaria com uma conta 0 hipotética.
    contaId: Number.isInteger(contaId) ? contaId : null,
    declarada: Boolean(tenantId) || Number.isInteger(contaId),
  };
}

/**
 * O ator é o operador do SaaS?
 *
 * @param {object|null} user  `req.user` já montado por `base/auth.js`
 * @returns {{ok:boolean, via:string, motivo:string|null}}
 *   `via`: 'super' | 'empresa-operadora' | 'nenhum'
 */
export function avaliarOperadorDoSaas(user) {
  if (!user) return { ok: false, via: 'nenhum', motivo: 'sem-ator' };

  // 1. Super usuário — só existe pelo token de serviço (ver `base/auth.js`).
  if (user.isSuperuser === true) return { ok: true, via: 'super', motivo: null };

  const decl = empresaOperadoraDeclarada();
  if (!decl.declarada) {
    return {
      ok: false,
      via: 'nenhum',
      // Motivo ESCRITO, e não um 403 mudo: quem for legitimamente da Ragnatela precisa saber que
      // falta declarar a variável, senão o diagnóstico vira "o sistema não deixa" sem próximo passo.
      motivo: 'empresa-operadora-nao-declarada',
    };
  }

  // 2. Sessão de navegador da EMPRESA OPERADORA.
  const meuTenant = user.ragnabotTenantId || user.clientCompanyId || null;
  const minhaConta = user.cwAccountId ?? null;

  const casaTenant = decl.tenantId && meuTenant && String(meuTenant) === decl.tenantId;
  const casaConta = decl.contaId !== null && minhaConta !== null
    && Number(minhaConta) === decl.contaId;

  if (casaTenant || casaConta) return { ok: true, via: 'empresa-operadora', motivo: null };

  return { ok: false, via: 'nenhum', motivo: 'nao-e-a-empresa-operadora' };
}

/** Açúcar booleano, para quem só quer decidir o que DESENHAR. */
export function ehOperadorDoSaas(user) {
  return avaliarOperadorDoSaas(user).ok;
}

/**
 * Trava de rota. Usar em TODA rota de whitelabel, empresas, planos e provedores de API.
 *
 * ⚠️ 403, e não 404: aqui não há nada a esconder sobre a EXISTÊNCIA do painel (ele é público no
 * material do produto). O que não pode vazar é o CONTEÚDO. E um 403 com código estável é o que a
 * tela usa para não desenhar o item de novo.
 */
export function exigirOperadorDoSaas(req, res, next) {
  const r = avaliarOperadorDoSaas(req.user);
  if (r.ok) return next();
  return res.status(403).json({
    error: 'SEM_PERMISSAO',
    code: 'NAO_E_OPERADOR_DO_SAAS',
    message: 'Este painel é da conta que opera o SaaS. A sua conta não tem acesso a ele.',
    motivo: r.motivo,
  });
}

export default {
  empresaOperadoraDeclarada, avaliarOperadorDoSaas, ehOperadorDoSaas, exigirOperadorDoSaas,
};
