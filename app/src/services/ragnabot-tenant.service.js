// =============================================================================
// RAGNABOT — provisionamento de EMPRESA (tenant) a partir do NOC.
//
// ORDEM DO DONO: "isso será um serviço SaaS, essa conta inicial é da Ragnatela
// mas terão outras empresas com outras conexões nesse bot" e "permitir
// multiconexões na mesma conta de empresa".
//
// DESENHO EM UMA FRASE: o Chatwoot é o motor de atendimento; o NOC é o painel
// de controle comercial. Plano, limite, ciclo de vida e auditoria moram AQUI
// (nosso Prisma, nossa auditoria); o Chatwoot só recebe ordens pela Platform API.
//
// DUAS APIs DIFERENTES — não confundir (é a fonte de 90% dos erros 401 aqui):
//   · Platform API  `/platform/api/v1/...`  → token do PLATFORM APP (o nosso).
//     Cria conta, cria usuário, vincula usuário à conta, gera link SSO.
//   · Application API `/api/v1/accounts/:id/...` → token de um USUÁRIO da conta.
//     Cria/lista caixas de entrada, agentes, times. O token do Platform App
//     NÃO funciona aqui. Por isso `tokenDeAdminDoTenant()` busca o access_token
//     do admin do tenant pela Platform API e o usa de forma EFÊMERA (nunca
//     persistimos esse token no nosso banco).
//
// LEIS DA CASA APLICADAS:
//   · Credencial JAMAIS no git nem no log (o token é redigido em toda mensagem).
//   · Isolamento multi-tenant absoluto (1 empresa = 1 Account do Chatwoot).
//   · Auditoria é requisito de primeira classe (todo passo vira AuditLog + evento).
//   · Rollback: falhou no meio → não fica conta órfã na plataforma.
//   · Tudo em português do Brasil.
//
// NOC 2026-08-28.
// =============================================================================
import https from 'node:https';
import crypto from 'node:crypto';
import axios from 'axios';
import prisma from '../base/db.js';
import logger from '../base/logger.js';
import { logAction } from '../base/auditoria.js';
import { PLANOS, CANAIS, limitesDoPlano, planoExiste, cabeMaisUmaCaixa } from '../config/ragnabot-plans.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Configuração e rota de rede
// ─────────────────────────────────────────────────────────────────────────────

// URL pública da plataforma (o nome que está no certificado).
const URL_PUBLICA = process.env.RAGNABOT_BASE_URL || 'https://chat002.ragnatela.com.br';
// IP do proxy reverso interno (XSEPRXRVS001). A VM do NOC é CEGA para o IP
// público por hairpin NAT — memória da casa "hairpin NAT: teste interno é cego".
// Falar com o proxy pelo IP, forçando Host e SNI, é o equivalente ao
// `curl --resolve` que já usamos para validar sites. O TLS continua REAL:
// o certificado é conferido contra o `servername`, não contra o IP.
const IP_PROXY = process.env.RAGNABOT_PROXY_IP || '';
const TEMPO_LIMITE_MS = parseInt(process.env.RAGNABOT_HTTP_TIMEOUT_MS || '20000', 10);
// Modo de suspensão: 'remover_vinculos' (padrão, reversível) ou 'somente_marcar'.
const MODO_SUSPENSAO = process.env.RAGNABOT_SUSPENSAO_MODO || 'remover_vinculos';

function hostnameDaPlataforma() {
  return new URL(URL_PUBLICA).hostname;
}

/**
 * Token do Platform App. Ordem: .env → tabela Settings (encrypted).
 * NUNCA é devolvido para fora deste módulo nem escrito em log.
 */
let _cacheToken = { valor: null, em: 0 };
export async function tokenDaPlataforma() {
  if (_cacheToken.valor && Date.now() - _cacheToken.em < 60_000) return _cacheToken.valor;
  let token = (process.env.RAGNABOT_PLATFORM_TOKEN || '').trim();
  if (!token) {
    try {
      const linha = await prisma.settings.findUnique({ where: { key: 'ragnabot_platform_token' } });
      if (linha?.value) {
        const { decrypt } = await import('../base/crypto.js');
        token = linha.encrypted ? decrypt(linha.value) : linha.value;
      }
    } catch (e) {
      logger.warn(`[ragnabot-tenant] não consegui ler o token em Settings: ${e.message}`);
    }
  }
  if (!token) {
    throw new Error(
      'Token do Platform App do Ragnabot ausente. Defina RAGNABOT_PLATFORM_TOKEN no .env ' +
      'ou a chave "ragnabot_platform_token" (encrypted) em Configurações. ' +
      'O token é criado no console /super_admin da plataforma, menu "Platform Apps".',
    );
  }
  _cacheToken = { valor: token, em: Date.now() };
  return token;
}

/** Remove qualquer segredo conhecido de um texto antes de logar/propagar. */
function redigir(texto) {
  let s = String(texto ?? '');
  const segredos = [_cacheToken.valor, process.env.RAGNABOT_PLATFORM_TOKEN].filter(Boolean);
  for (const seg of segredos) if (seg.length > 6) s = s.split(seg).join('«token-redigido»');
  // Campos que carregam credencial de canal (api_key da Meta, bot_token do Telegram…)
  s = s.replace(/("(?:api_key|access_token|bot_token|password|secret|smtp_password|imap_password)"\s*:\s*)"[^"]*"/gi, '$1"«redigido»"');
  return s;
}

/** Impressão digital de um segredo, para auditar SEM guardar o segredo. */
export function digitalDoSegredo(valor) {
  if (!valor) return null;
  return 'sha256:' + crypto.createHash('sha256').update(String(valor)).digest('hex').slice(0, 12);
}

export class ErroPlataforma extends Error {
  constructor(mensagem, { status = null, corpo = null, caminho = null } = {}) {
    super(mensagem);
    this.name = 'ErroPlataforma';
    this.status = status;
    this.corpo = corpo;
    this.caminho = caminho;
  }
}

function montarCliente(cabecalhos, { multipart = false } = {}) {
  const hostname = hostnameDaPlataforma();
  const base = IP_PROXY ? `https://${IP_PROXY}` : URL_PUBLICA;
  // ⚠️ Em multipart o `Content-Type` NÃO pode ser fixado aqui: quem escreve o cabeçalho é o axios,
  // porque só ele conhece a fronteira (`boundary`) que separa as partes. Cravar
  // `multipart/form-data` sem a fronteira faz o Rails do Chatwoot devolver 422 com o corpo vazio —
  // um erro que parece de permissão e é de formato.
  const tipo = multipart ? {} : { 'Content-Type': 'application/json' };
  return axios.create({
    baseURL: base,
    timeout: TEMPO_LIMITE_MS,
    // `servername` faz o SNI E a validação do certificado usarem o nome real.
    httpsAgent: new https.Agent({ servername: hostname, keepAlive: false }),
    headers: { Host: hostname, ...tipo, Accept: 'application/json', ...cabecalhos },
    maxRedirects: 0,
    validateStatus: () => true, // tratamos o status na mão, para mensagem em PT-BR
  });
}

async function requisitar(cliente, metodo, caminho, corpo = null) {
  let resp;
  try {
    resp = await cliente.request({ method: metodo, url: caminho, data: corpo ?? undefined });
  } catch (e) {
    throw new ErroPlataforma(`Falha de rede ao falar com a plataforma (${metodo.toUpperCase()} ${caminho}): ${redigir(e.message)}`, { caminho });
  }
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  const detalhe = typeof resp.data === 'string' ? resp.data.slice(0, 500) : JSON.stringify(resp.data ?? {}).slice(0, 500);
  throw new ErroPlataforma(
    `A plataforma respondeu ${resp.status} em ${metodo.toUpperCase()} ${caminho}: ${redigir(detalhe)}`,
    { status: resp.status, corpo: resp.data, caminho },
  );
}

/** Chamada na Platform API (token do Platform App). */
export async function plataforma(metodo, caminho, corpo = null) {
  const cliente = montarCliente({ api_access_token: await tokenDaPlataforma() });
  return requisitar(cliente, metodo, caminho, corpo);
}

/** Chamada na Application API, no contexto de UM usuário da conta. */
async function aplicacao(tokenDoUsuario, metodo, caminho, corpo = null) {
  const cliente = montarCliente({ api_access_token: tokenDoUsuario });
  return requisitar(cliente, metodo, caminho, corpo);
}

/**
 * access_token do admin do tenant, obtido AO VIVO e usado de forma efêmera.
 * Não persistimos esse token: quem tem o token tem a conta inteira do cliente.
 */
async function tokenDeAdminDoTenant(cwUserId) {
  if (!cwUserId) {
    throw new Error('Esta empresa não tem administrador cadastrado na plataforma — sem ele o NOC não consegue operar a conta dela.');
  }
  const u = await plataforma('get', `/platform/api/v1/users/${cwUserId}`);
  const token = u?.access_token || u?.payload?.access_token;
  if (!token) {
    throw new ErroPlataforma(
      `A Platform API não devolveu o access_token do usuário ${cwUserId}. ` +
      'Sem ele o NOC não consegue criar caixas de entrada por conta do cliente. ' +
      'Confirme a versão da plataforma (o campo existe no Chatwoot 4.x) ou cadastre um token de agente manualmente.',
    );
  }
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Utilidades de validação
// ─────────────────────────────────────────────────────────────────────────────

const RE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function exigirTexto(valor, campo, { min = 1, max = 200 } = {}) {
  const s = String(valor ?? '').trim();
  if (s.length < min) throw new Error(`Campo obrigatório: ${campo}.`);
  if (s.length > max) throw new Error(`Campo ${campo} excede ${max} caracteres.`);
  return s;
}

/** Senha inicial forte e DESCARTÁVEL. Nunca é gravada no nosso banco. */
function senhaEfemera() {
  // Base aleatória + garantia de maiúscula, minúscula, dígito e símbolo,
  // porque a plataforma valida complexidade e um "422" aqui vira rollback à toa.
  return crypto.randomBytes(24).toString('base64url').slice(0, 24) + 'Aa1!';
}

const AVISO_SEM_MODELOS =
  'O SaaS do Ragnabot ainda não está instalado neste NOC: os modelos RagnabotTenant/RagnabotInbox/' +
  'RagnabotTenantEvent existem no schema mas o cliente do Prisma não foi gerado nem aplicado. ' +
  'Rode `npm run db:generate` e `npm run db:push` (nunca `migrate dev`).';

/**
 * Os modelos foram gerados no cliente do Prisma?
 * Sem esta guarda o erro que aparece é "Cannot read properties of undefined",
 * que não diz nada a quem estiver operando às três da manhã.
 */
function exigirModelos() {
  for (const nome of ['ragnabotTenant', 'ragnabotInbox', 'ragnabotTenantEvent']) {
    if (!prisma[nome]) throw new Error(AVISO_SEM_MODELOS);
  }
}

/** A tabela existe? Erro amigável enquanto o `db:push` não rodou. */
function traduzirErroDePrisma(e) {
  const msg = String(e?.message || '');
  if (/Cannot read propert.* of undefined|is not a function/i.test(msg)) return new Error(AVISO_SEM_MODELOS);
  if (e?.code === 'P2021' || /does not exist in the current database|relation .* does not exist/i.test(msg)) {
    return new Error(
      'As tabelas do SaaS do Ragnabot ainda não existem no banco do NOC. ' +
      'Rode `npm run db:push` (nunca `migrate dev`) após aplicar os modelos RagnabotTenant/RagnabotTenantEvent/RagnabotInbox no schema.',
    );
  }
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Eventos do tenant (trilha própria, além do AuditLog do NOC)
// ─────────────────────────────────────────────────────────────────────────────

export async function registrarEvento(tenantId, tipo, payload = null, atorUserId = null) {
  try {
    return await prisma.ragnabotTenantEvent.create({
      data: { tenantId, type: tipo, payload: payload ?? undefined, actorUserId: atorUserId },
    });
  } catch (e) {
    // Auditoria que some em silêncio é evasão de auditoria — grita no log.
    logger.error(`[ragnabot-tenant] FALHA AO REGISTRAR EVENTO "${tipo}" do tenant ${tenantId}: ${redigir(e.message)}`);
    return null;
  }
}

async function avisarNoWhatsapp(texto) {
  try {
    const { broadcastAlert } = await import('./evolution.service.js');
    // Paridade WhatsApp↔NOC: o que vai para o WhatsApp também aparece no NOC.
    // Severidade 'information' DE PROPÓSITO: provisionar/suspender uma empresa é
    // um EVENTO que aconteceu, não uma CONDIÇÃO que pode voltar ao normal. Sem
    // isso cada aviso abriria um incidente que nunca se recuperaria — foi
    // exatamente assim que 5 dos 17 alertas abertos do NOC nasceram em 22/08.
    await broadcastAlert(null, texto, 'information', { noc: true });
  } catch (e) {
    logger.warn(`[ragnabot-tenant] aviso de WhatsApp não saiu: ${redigir(e.message)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Saúde da integração (conferência barata antes de qualquer POST)
// ─────────────────────────────────────────────────────────────────────────────

export async function verificarIntegracao() {
  const saida = {
    urlPublica: URL_PUBLICA,
    rota: IP_PROXY ? `proxy interno ${IP_PROXY} (Host/SNI ${hostnameDaPlataforma()})` : 'direto pela URL pública',
    tokenConfigurado: false,
    plataformaResponde: false,
    modelosInstalados: true,
    // Lista, não campo único: faltar as duas coisas ao mesmo tempo é o caso
    // comum numa instalação nova, e a segunda mensagem não pode apagar a primeira.
    pendencias: [],
  };
  try { exigirModelos(); } catch (e) { saida.modelosInstalados = false; saida.pendencias.push(e.message); }
  try {
    await tokenDaPlataforma();
    saida.tokenConfigurado = true;
  } catch (e) {
    saida.pendencias.push(e.message);
    saida.pronto = false;
    return saida;
  }
  try {
    // GET inofensivo: lista de contas visíveis ao Platform App.
    // ⚠️ Um Platform App só enxerga o que ELE criou ("permissibles"): a Conta 1,
    // criada à mão, tende a NÃO aparecer aqui. Isso é esperado, não é falha.
    await plataforma('get', '/platform/api/v1/accounts/1').catch((e) => {
      // 404/403 = o app respondeu, mas ESTA conta não foi concedida a ele
      // ("permissibles"). Esperado para a Conta 1, que foi criada à mão.
      if (e.status === 404 || e.status === 403) return null;
      // 401 é OUTRA COISA: a plataforma RECUSOU o token. Tratar 401 como
      // "respondeu, está tudo certo" deixava o /saude VERDE com token inválido —
      // exatamente a falha que este endpoint existe para pegar antes do primeiro
      // provisionamento.
      if (e.status === 401) {
        // ⚠️ 401 tem DOIS significados aqui, e confundi-los custa caro (custou, em 30/08/2026: o
        // provisionamento FUNCIONAVA e este verificador dizia que o token era inválido, mandando
        // caçar um problema que não existia).
        //   · "Non permissible resource" → o token FOI ACEITO. A plataforma só chega a avaliar
        //     permissão DEPOIS de autenticar, e um Platform App só enxerga o que ELE criou — a
        //     conta 1 foi criada à mão, então esta resposta é a PROVA de que está tudo certo.
        //   · "Invalid access_token" → aí sim o token foi recusado.
        const corpo = JSON.stringify(e.corpo ?? '').toLowerCase();
        if (corpo.includes('permissible')) return null; // token aceito; conta só não é dele
        throw new Error(
          'A plataforma RECUSOU o token do Platform App (401 "Invalid access_token"). Confira ' +
          'RAGNABOT_PLATFORM_TOKEN no .env ou a chave "ragnabot_platform_token" em Configurações. ' +
          'Confira TAMBÉM se o caminho até a plataforma preserva cabeçalhos com SUBLINHADO: o ' +
          'cabeçalho de autenticação chama-se `api_access_token`, e nginx (o proxy reverso E o ' +
          'ingress do Kubernetes) descarta esses cabeçalhos por padrão, em silêncio — o sintoma é ' +
          'exatamente este 401, com o token certo do outro lado.',
        );
      }
      throw e;
    });
    saida.plataformaResponde = true;
  } catch (e) {
    saida.pendencias.push(e.message);
  }
  saida.pronto = saida.modelosInstalados && saida.tokenConfigurado && saida.plataformaResponde;
  return saida;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROVISIONAMENTO EM UMA AÇÃO (com rollback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma empresa nova ponta a ponta.
 *
 * Passos: (1) valida → (2) cria a Account → (3) cria o usuário admin →
 * (4) vincula como administrador → (5) grava o tenant no NOC → (6) audita/avisa.
 *
 * ROLLBACK: qualquer falha depois do passo 2 desfaz o que já foi criado na
 * plataforma (apaga o usuário, apaga a conta) e NADA é gravado no Prisma.
 * Se o próprio rollback falhar, a exceção diz exatamente o que ficou órfão —
 * silêncio aqui viraria conta fantasma cobrando recurso do cluster.
 *
 * E-MAIL DUPLICADO É FALHA DURA (ordem do dono): o mesmo e-mail em duas contas
 * significa uma pessoa com dois contextos e é o caminho mais curto para vazar
 * dado entre empresas. Recusamos antes de criar qualquer coisa e recusamos de
 * novo se a plataforma acusar 422 na criação do usuário.
 */
export async function provisionarEmpresa(dados = {}, { ator = null, req = null } = {}) {
  exigirModelos();
  const nome = exigirTexto(dados.nome, 'nome da empresa', { min: 2, max: 120 });
  const slug = exigirTexto(dados.slug, 'identificador (slug)', { min: 3, max: 40 }).toLowerCase();
  const contatoNome = exigirTexto(dados.contatoNome, 'nome do contato', { min: 2, max: 120 });
  const contatoEmail = exigirTexto(dados.contatoEmail, 'e-mail do contato', { min: 5, max: 160 }).toLowerCase();
  const plano = String(dados.plano || 'essencial').toLowerCase();
  const cnpj = dados.cnpj ? String(dados.cnpj).replace(/\D/g, '').slice(0, 14) : null;
  const contatoWhatsapp = dados.contatoWhatsapp ? String(dados.contatoWhatsapp).replace(/\D/g, '').slice(0, 15) : null;

  if (!RE_SLUG.test(slug)) {
    throw new Error('Identificador (slug) inválido: use de 3 a 40 caracteres, apenas letras minúsculas, números e hífen, começando e terminando com letra ou número.');
  }
  if (!RE_EMAIL.test(contatoEmail)) throw new Error('E-mail do contato inválido.');
  if (!planoExiste(plano)) throw new Error(`Plano inválido: "${plano}". Válidos: ${Object.keys(PLANOS).join(', ')}.`);

  const limites = limitesDoPlano(plano, dados.limitesOverride || null);
  const retencaoDias = Number.isFinite(dados.retencaoDias) ? dados.retencaoDias : limites.retencaoDias;

  // ── Pré-checagens no NOSSO banco (barato, antes de tocar na plataforma) ──
  let existente;
  try {
    existente = await prisma.ragnabotTenant.findFirst({
      where: { OR: [{ slug }, { contactEmail: contatoEmail }] },
      select: { id: true, slug: true, contactEmail: true, name: true },
    });
  } catch (e) { throw traduzirErroDePrisma(e); }
  if (existente?.slug === slug) throw new Error(`Já existe empresa com o identificador "${slug}" (${existente.name}).`);
  if (existente) throw new Error(`O e-mail "${contatoEmail}" já é o contato administrador da empresa "${existente.name}". E-mail duplicado não é permitido entre empresas.`);

  const trilha = [];
  let cwAccountId = null;
  let cwUserId = null;
  let gravado = false; // o registro-mestre já foi para o nosso banco?

  try {
    // ── Passo 2: conta da empresa na plataforma ──
    const conta = await plataforma('post', '/platform/api/v1/accounts', { name: nome, locale: 'pt_BR' });
    cwAccountId = conta?.id;
    if (!cwAccountId) throw new ErroPlataforma('A plataforma criou a conta mas não devolveu o id.');
    trilha.push({ passo: 'conta_criada', cwAccountId });

    // ── Passo 3: usuário administrador da empresa ──
    let usuario;
    try {
      usuario = await plataforma('post', '/platform/api/v1/users', {
        name: contatoNome,
        email: contatoEmail,
        password: senhaEfemera(), // gerada, usada e descartada — nunca gravada aqui
        custom_attributes: { origem: 'noc-ragnatela', tenant_slug: slug },
      });
    } catch (e) {
      if (e instanceof ErroPlataforma && (e.status === 422 || /taken|já existe|has already/i.test(String(e.corpo && JSON.stringify(e.corpo))))) {
        throw new Error(`O e-mail "${contatoEmail}" já existe na plataforma de atendimento. E-mail duplicado é falha dura: use outro endereço ou libere o existente antes de provisionar.`);
      }
      throw e;
    }
    cwUserId = usuario?.id;
    if (!cwUserId) throw new ErroPlataforma('A plataforma criou o usuário mas não devolveu o id.');
    trilha.push({ passo: 'usuario_criado', cwUserId });

    // ── Passo 4: vincular como ADMINISTRADOR da conta dele (e só dela) ──
    await plataforma('post', `/platform/api/v1/accounts/${cwAccountId}/account_users`, {
      user_id: cwUserId,
      role: 'administrator',
    });
    trilha.push({ passo: 'vinculo_criado' });

    // ── Passo 5: registro-mestre no NOC ──
    let tenant;
    try {
      tenant = await prisma.ragnabotTenant.create({
        data: {
          name: nome, slug, cnpj,
          contactName: contatoNome, contactEmail: contatoEmail, contactWhatsapp: contatoWhatsapp,
          cwAccountId, cwAdminUserId: cwUserId,
          plan: plano, status: 'trial',
          limits: limites,
          retentionDays: retencaoDias,
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          createdByUserId: ator?.id || null,
        },
      });
    } catch (e) { throw traduzirErroDePrisma(e); }
    trilha.push({ passo: 'tenant_gravado', tenantId: tenant.id });
    // A partir daqui o contrato EXISTE no nosso banco. Se algo estourar depois
    // deste ponto, apagar a conta na plataforma deixaria o NOC apontando para uma
    // conta que não existe mais — pior que o problema original. O rollback só
    // vale ANTES desta linha.
    gravado = true;

    // ── Passo 6: auditoria + aviso ──
    await registrarEvento(tenant.id, 'provisioned', { cwAccountId, cwUserId, plano, limites }, ator?.id || null);
    await logAction({
      user: ator, action: 'ragnabot.tenant.provision', category: 'system',
      entityType: 'RagnabotTenant', entityId: tenant.id,
      description: `Empresa "${nome}" (${slug}) provisionada no Ragnabot — conta ${cwAccountId}, admin ${contatoEmail}, plano ${plano}`,
      payloadAfter: { cwAccountId, cwAdminUserId: cwUserId, plano, limites },
      rollbackable: false, req,
    }).catch(() => {});
    await avisarNoWhatsapp(`🏷️ *RAGNABOT* — empresa provisionada\n\n*${nome}* (${slug})\nPlano: ${limites.rotulo}\nConta: ${cwAccountId}\nAdmin: ${contatoEmail}\nPor: ${ator?.name || ator?.username || 'NOC'}`);

    // Link de primeiro acesso: o admin do cliente entra e define a senha dele.
    // Gerado sob demanda para não guardar link vivo no banco.
    let primeiroAcesso = null;
    let falhaDoLink = null;
    try {
      primeiroAcesso = await linkDeAcesso(tenant.id, { ator, req, motivo: 'entrega do provisionamento' });
    } catch (e) {
      // Não pode sumir em silêncio: enquanto o servidor de e-mail do sistema não
      // estiver configurado, ESTE link é o único caminho de entrada do cliente.
      falhaDoLink = redigir(e.message);
      logger.warn(`[ragnabot-tenant] empresa "${slug}" criada, mas o link de primeiro acesso não saiu: ${falhaDoLink}`);
    }
    const avisos = avisosDoProvisionamento(limites);
    if (!primeiroAcesso) {
      avisos.unshift(
        `⚠️ O LINK DE PRIMEIRO ACESSO NÃO FOI GERADO (${falhaDoLink || 'motivo desconhecido'}). ` +
        'A empresa existe, mas o administrador dela ainda não tem como entrar: gere o link de novo pela ação ' +
        '"Link de acesso" ou peça a ele para usar "esqueci minha senha" (depende do servidor de e-mail do sistema).',
      );
    }

    return { tenant, primeiroAcesso, avisos };
  } catch (erro) {
    // ── ROLLBACK: desfaz na ordem inversa ──
    const desfeito = [];
    const falhasNoRollback = [];
    if (gravado) {
      // Nada é desfeito lá fora: o contrato já está gravado aqui e a empresa
      // existe. O que falhou foi acessório (link de entrega, aviso) — o erro
      // sobe para quem chamou, com a empresa intacta.
      logger.error(`[ragnabot-tenant] "${slug}" foi provisionada, mas um passo posterior falhou: ${redigir(erro.message)}`);
      throw new Error(`${erro.message}\n\n⚠️ A empresa JÁ FOI criada e o contrato está gravado — não desfiz nada. Confira o cadastro dela antes de tentar provisionar de novo.`);
    }
    if (cwUserId) {
      try { await plataforma('delete', `/platform/api/v1/users/${cwUserId}`); desfeito.push(`usuário ${cwUserId}`); }
      catch (e) { falhasNoRollback.push(`usuário ${cwUserId} (${redigir(e.message)})`); }
    }
    if (cwAccountId) {
      try { await plataforma('delete', `/platform/api/v1/accounts/${cwAccountId}`); desfeito.push(`conta ${cwAccountId}`); }
      catch (e) { falhasNoRollback.push(`conta ${cwAccountId} (${redigir(e.message)})`); }
    }
    logger.error(`[ragnabot-tenant] provisionamento de "${slug}" FALHOU: ${redigir(erro.message)} · trilha=${JSON.stringify(trilha)} · desfeito=[${desfeito.join('; ')}] · rollback-falhou=[${falhasNoRollback.join('; ')}]`);
    await logAction({
      user: ator, action: 'ragnabot.tenant.provision.failed', category: 'system',
      entityType: 'RagnabotTenant', entityId: slug,
      description: `Provisionamento de "${nome}" (${slug}) falhou: ${redigir(erro.message)}`,
      payloadAfter: { trilha, desfeito, falhasNoRollback }, rollbackable: false, req,
    }).catch(() => {});

    if (falhasNoRollback.length) {
      // Órfão na plataforma É incidente: quem lê o erro precisa saber o que limpar.
      throw new Error(
        `${erro.message}\n\n⚠️ O ROLLBACK NÃO FOI COMPLETO — ficou órfão na plataforma: ${falhasNoRollback.join('; ')}. ` +
        'Remova manualmente no console /super_admin antes de tentar de novo.',
      );
    }
    throw new Error(`${erro.message}${desfeito.length ? `\n\n↩️ Rollback completo: removido ${desfeito.join(' e ')}. Nada ficou órfão.` : ''}`);
  }
}

function avisosDoProvisionamento(limites) {
  const avisos = [
    'A senha inicial é gerada, usada e DESCARTADA: o administrador da empresa define a dele pelo link de primeiro acesso ou por "esqueci minha senha".',
    `Plano ${limites.rotulo}: até ${limites.agentes} atendente(s), ${limites.caixas} caixa(s) de entrada e ${limites.conversasMes} conversa(s)/mês.`,
  ];
  if (limites.canais.includes('whatsapp')) {
    avisos.push('WhatsApp: modelo "traga a sua própria WABA" — a empresa cadastra a conta comercial, o número e o token dela na caixa de entrada. O custo da Meta é cobrado na WABA do cliente, não passa por nós.');
    avisos.push('⚠️ A Cloud API da Meta NÃO tem grupos de WhatsApp. Quem vem do Whaticket perde essa capacidade — combine isso com o cliente antes de migrar.');
  }
  return avisos;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Consulta
// ─────────────────────────────────────────────────────────────────────────────

export async function listarEmpresas({ status = null } = {}) {
  exigirModelos();
  try {
    const onde = status ? { status } : {};
    const linhas = await prisma.ragnabotTenant.findMany({ where: onde, orderBy: { createdAt: 'desc' } });
    return linhas.map(resumirTenant);
  } catch (e) { throw traduzirErroDePrisma(e); }
}

export async function obterEmpresa(id) {
  exigirModelos();
  let t;
  try {
    t = await prisma.ragnabotTenant.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
        inboxes: { orderBy: { createdAt: 'asc' } },
      },
    });
  } catch (e) { throw traduzirErroDePrisma(e); }
  if (!t) throw new Error('Empresa não encontrada.');
  return { ...resumirTenant(t), eventos: t.events, caixas: t.inboxes };
}

function limitesVigentes(t) {
  if (t.limits && typeof t.limits === 'object') return t.limits;
  // Plano renomeado/removido do código não pode derrubar a listagem inteira:
  // devolve o mínimo e deixa o problema visível no campo, não numa exceção.
  try { return limitesDoPlano(t.plan); }
  catch { return { rotulo: `${t.plan} (plano fora do catálogo)`, agentes: 0, caixas: 0, canais: [], caixasPorCanal: {}, conversasMes: 0, retencaoDias: t.retentionDays || 365 }; }
}

function resumirTenant(t) {
  const limites = limitesVigentes(t);
  return {
    id: t.id, nome: t.name, slug: t.slug, cnpj: t.cnpj,
    contato: { nome: t.contactName, email: t.contactEmail, whatsapp: t.contactWhatsapp },
    cwAccountId: t.cwAccountId, cwAdminUserId: t.cwAdminUserId,
    plano: t.plan, planoRotulo: limites.rotulo || t.plan, status: t.status, limites,
    retencaoDias: t.retentionDays,
    wabaId: t.wabaId || null,
    marca: { logoUrl: t.brandLogoUrl || null, cor: t.brandColor || null },
    trialTerminaEm: t.trialEndsAt, suspensoEm: t.suspendedAt, encerradoEm: t.closedAt,
    criadoEm: t.createdAt, atualizadoEm: t.updatedAt,
  };
}

async function exigirTenant(id, { permitirEncerrado = false } = {}) {
  exigirModelos();
  let t;
  try { t = await prisma.ragnabotTenant.findUnique({ where: { id } }); }
  catch (e) { throw traduzirErroDePrisma(e); }
  if (!t) throw new Error('Empresa não encontrada.');
  if (!permitirEncerrado && t.status === 'closed') throw new Error(`A empresa "${t.name}" está encerrada. Reabra o contrato antes de operar nela.`);
  if (!permitirEncerrado && !t.cwAccountId) throw new Error(`A conta da empresa "${t.name}" já foi excluída definitivamente da plataforma. Resta apenas o registro comercial.`);
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Ciclo de vida: plano, suspensão, reativação, encerramento
// ─────────────────────────────────────────────────────────────────────────────

export async function alterarPlano(id, plano, { override = null, ator = null, req = null } = {}) {
  const t = await exigirTenant(id);
  if (!planoExiste(plano)) throw new Error(`Plano inválido: "${plano}".`);
  const antes = { plano: t.plan, limites: t.limits };
  const limites = limitesDoPlano(plano, override);
  const novo = await prisma.ragnabotTenant.update({
    where: { id }, data: { plan: plano, limits: limites, retentionDays: limites.retencaoDias },
  });
  await registrarEvento(id, 'plan_changed', { antes, depois: { plano, limites } }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.plan', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Plano da empresa "${t.name}" alterado de ${t.plan} para ${plano}`,
    payloadBefore: antes, payloadAfter: { plano, limites }, req,
  }).catch(() => {});
  return resumirTenant(novo);
}

/**
 * Suspende a empresa. NÃO apaga nada: guarda a lista de vínculos e remove os
 * vínculos de usuário↔conta, de modo que ninguém do cliente consiga entrar.
 * Conversas, contatos e caixas permanecem intactos.
 *
 * ⚠️ Efeito colateral conhecido: remover o vínculo pode zerar a ATRIBUIÇÃO das
 * conversas àquele agente na plataforma. Por isso guardamos a lista completa e
 * a reativação recria os mesmos papéis. Valide em empresa de teste antes de
 * usar em cliente real — está registrado como risco no 16-saas-tenants.md.
 */
export async function suspenderEmpresa(id, { motivo = null, ator = null, req = null } = {}) {
  const t = await exigirTenant(id);
  if (t.status === 'suspended') return { ...resumirTenant(t), jaEstava: true };

  let vinculos = [];
  if (MODO_SUSPENSAO === 'remover_vinculos') {
    const lista = await plataforma('get', `/platform/api/v1/accounts/${t.cwAccountId}/account_users`);
    vinculos = (Array.isArray(lista) ? lista : lista?.payload || []).map((v) => ({
      user_id: v.user_id ?? v.id, role: v.role || 'agent',
    })).filter((v) => v.user_id);

    const falhas = [];
    for (const v of vinculos) {
      try {
        await plataforma('delete', `/platform/api/v1/accounts/${t.cwAccountId}/account_users`, { user_id: v.user_id });
      } catch (e) { falhas.push(`${v.user_id}: ${redigir(e.message)}`); }
    }
    if (falhas.length) {
      // Suspensão pela metade é pior que nenhuma: tenta desfazer e conta a
      // VERDADE. Engolir a falha da restauração e dizer "desfeita" deixaria
      // parte da equipe do cliente sem acesso com o cadastro dizendo "ativa" —
      // ninguém iria procurar o problema onde ele está.
      const naoRestaurados = [];
      for (const v of vinculos) {
        try {
          await plataforma('post', `/platform/api/v1/accounts/${t.cwAccountId}/account_users`, { user_id: v.user_id, role: v.role });
        } catch (e) {
          // 422 costuma ser "já existe" — nesse caso o acesso está de pé.
          if (!(e instanceof ErroPlataforma && e.status === 422)) naoRestaurados.push(`${v.user_id}: ${redigir(e.message)}`);
        }
      }
      await registrarEvento(id, 'suspend_failed', { falhas, naoRestaurados }, ator?.id || null);
      if (naoRestaurados.length) {
        logger.error(`[ragnabot-tenant] suspensão de "${t.slug}" falhou E a restauração também: ${naoRestaurados.join('; ')}`);
        throw new Error(
          `Não consegui remover todos os acessos da empresa "${t.name}" (falhas: ${falhas.join('; ')}) ` +
          `E A RESTAURAÇÃO TAMBÉM FALHOU — a empresa ficou com acesso PARCIAL e o cadastro continua "${t.status}". ` +
          `Acessos que NÃO voltaram: ${naoRestaurados.join('; ')}. Reponha à mão no console /super_admin antes de qualquer outra coisa.`,
        );
      }
      throw new Error(`Não consegui remover todos os acessos da empresa "${t.name}" — suspensão desfeita, todos os acessos foram restaurados. Falhas: ${falhas.join('; ')}`);
    }
  }

  const novo = await prisma.ragnabotTenant.update({
    where: { id }, data: { status: 'suspended', suspendedAt: new Date() },
  });
  await registrarEvento(id, 'suspended', { motivo, modo: MODO_SUSPENSAO, vinculos }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.suspend', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Empresa "${t.name}" SUSPENSA (${vinculos.length} acesso(s) removido(s))${motivo ? ` · Motivo: ${motivo}` : ''}`,
    payloadAfter: { modo: MODO_SUSPENSAO, vinculos, motivo }, req,
  }).catch(() => {});
  await avisarNoWhatsapp(`⛔ *RAGNABOT* — empresa suspensa\n\n*${t.name}* (${t.slug})\n${vinculos.length} acesso(s) removido(s); dados intactos.${motivo ? `\nMotivo: ${motivo}` : ''}`);
  return resumirTenant(novo);
}

/** Reativa recriando exatamente os vínculos guardados na suspensão. */
export async function reativarEmpresa(id, { ator = null, req = null } = {}) {
  const t = await exigirTenant(id, { permitirEncerrado: true });
  if (t.status !== 'suspended') throw new Error(`A empresa "${t.name}" não está suspensa (status atual: ${t.status}).`);

  const evento = await prisma.ragnabotTenantEvent.findFirst({
    where: { tenantId: id, type: 'suspended' }, orderBy: { createdAt: 'desc' },
  }).catch(() => null);
  const vinculos = Array.isArray(evento?.payload?.vinculos) ? evento.payload.vinculos : [];

  const falhas = [];
  for (const v of vinculos) {
    try {
      await plataforma('post', `/platform/api/v1/accounts/${t.cwAccountId}/account_users`, { user_id: v.user_id, role: v.role || 'agent' });
    } catch (e) {
      // Já existir o vínculo não é falha: reativar tem que ser idempotente.
      if (!(e instanceof ErroPlataforma && e.status === 422)) falhas.push(`${v.user_id}: ${redigir(e.message)}`);
    }
  }
  if (!vinculos.length && t.cwAdminUserId) {
    await plataforma('post', `/platform/api/v1/accounts/${t.cwAccountId}/account_users`, { user_id: t.cwAdminUserId, role: 'administrator' }).catch((e) => falhas.push(`admin ${t.cwAdminUserId}: ${redigir(e.message)}`));
  }

  // Empresa suspensa DURANTE o período de teste volta para 'trial', não para
  // 'active': marcar como ativa encerraria o teste na marra e faria a cobrança
  // achar que já é cliente pagante.
  const aindaEmTeste = t.trialEndsAt && new Date(t.trialEndsAt).getTime() > Date.now();
  const novo = await prisma.ragnabotTenant.update({
    where: { id }, data: { status: aindaEmTeste ? 'trial' : 'active', suspendedAt: null },
  });
  await registrarEvento(id, 'reactivated', { vinculosRestaurados: vinculos.length, falhas, statusFinal: novo.status }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.reactivate', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Empresa "${t.name}" REATIVADA (${vinculos.length} acesso(s) restaurado(s))`,
    payloadAfter: { vinculos, falhas }, req,
  }).catch(() => {});
  await avisarNoWhatsapp(`✅ *RAGNABOT* — empresa reativada\n\n*${t.name}* (${t.slug})\n${vinculos.length} acesso(s) restaurado(s).`);
  if (falhas.length) return { ...resumirTenant(novo), avisos: [`Alguns acessos não voltaram: ${falhas.join('; ')}`] };
  return resumirTenant(novo);
}

/**
 * Encerra o contrato: suspende o acesso e marca `closed`. NÃO apaga dados —
 * a exclusão definitiva da conta na plataforma é um segundo ato, deliberado,
 * depois do prazo de retirada dos dados (LGPD). Ver `excluirDefinitivamente`.
 */
export async function encerrarEmpresa(id, { motivo = null, ator = null, req = null } = {}) {
  const t = await exigirTenant(id, { permitirEncerrado: true });
  // A suspensão é o que TIRA O ACESSO. Engolir a falha dela marcaria o contrato
  // como "encerrado" com a equipe do cliente ainda entrando no painel — um
  // encerramento que não encerra nada, e ninguém saberia.
  if (t.status !== 'suspended' && t.status !== 'closed') {
    try {
      await suspenderEmpresa(id, { motivo: motivo || 'encerramento de contrato', ator, req });
    } catch (e) {
      throw new Error(
        `Não encerrei a empresa "${t.name}": a retirada de acesso falhou e encerrar sem ela deixaria o cliente ` +
        `entrando num contrato encerrado. Resolva a suspensão primeiro. Detalhe: ${redigir(e.message)}`,
      );
    }
  }
  const novo = await prisma.ragnabotTenant.update({ where: { id }, data: { status: 'closed', closedAt: new Date() } });
  await registrarEvento(id, 'closed', { motivo }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.close', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Empresa "${t.name}" ENCERRADA${motivo ? ` · Motivo: ${motivo}` : ''}. Dados preservados — exclusão definitiva é ato separado.`,
    payloadAfter: { motivo }, req,
  }).catch(() => {});
  return resumirTenant(novo);
}

/**
 * Exclusão DEFINITIVA da conta na plataforma (fim da esteira de LGPD).
 * Exige que a empresa já esteja encerrada e que quem chama confirme o slug —
 * é irreversível e leva junto conversas e contatos dos clientes do cliente.
 */
export async function excluirDefinitivamente(id, { confirmacaoSlug, ator = null, req = null } = {}) {
  const t = await exigirTenant(id, { permitirEncerrado: true });
  if (t.status !== 'closed') throw new Error('Só é possível excluir definitivamente uma empresa já encerrada.');
  if (String(confirmacaoSlug || '') !== t.slug) throw new Error(`Confirmação inválida: digite o identificador exato da empresa ("${t.slug}") para excluir definitivamente.`);
  if (!t.cwAccountId) {
    // Sem esta guarda o caminho virava `/platform/api/v1/accounts/null` e o erro
    // que aparecia era um 404 cru da plataforma, que não diz o que aconteceu.
    throw new Error(`A conta da empresa "${t.name}" já foi excluída definitivamente${t.purgedAt ? ` em ${new Date(t.purgedAt).toLocaleString('pt-BR')}` : ''}. Resta apenas o registro comercial, que é mantido de propósito.`);
  }
  await plataforma('delete', `/platform/api/v1/accounts/${t.cwAccountId}`);
  const novo = await prisma.ragnabotTenant.update({ where: { id }, data: { cwAccountId: null, purgedAt: new Date() } }).catch(async (e) => {
    // Se a coluna purgedAt ainda não existir, ao menos registre o evento.
    logger.warn(`[ragnabot-tenant] não gravei purgedAt: ${redigir(e.message)}`);
    return t;
  });
  await registrarEvento(id, 'purge', { cwAccountId: t.cwAccountId }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.purge', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Conta ${t.cwAccountId} da empresa "${t.name}" EXCLUÍDA DEFINITIVAMENTE da plataforma (LGPD).`,
    payloadBefore: { cwAccountId: t.cwAccountId }, rollbackable: false, req,
  }).catch(() => {});
  await avisarNoWhatsapp(`🗑️ *RAGNABOT* — conta excluída definitivamente\n\n*${t.name}* (${t.slug})\nConta ${t.cwAccountId} removida da plataforma. Backup imutável expira sozinho pelo Object Lock.`);
  return resumirTenant(novo);
}

/**
 * Link de acesso (SSO) ao painel da empresa.
 *
 * ⚠️ ISSO É ACESSO A DADO DE TERCEIRO. Todo uso é auditado com nome de quem
 * pediu e o motivo, e dispara aviso no WhatsApp do dono. Não existe uso
 * "rotineiro" desse link: ou é entrega de provisionamento, ou é suporte pedido
 * pelo cliente.
 */
export async function linkDeAcesso(id, { ator = null, req = null, motivo = null } = {}) {
  const t = await exigirTenant(id);
  if (!t.cwAdminUserId) throw new Error('Esta empresa não tem administrador cadastrado na plataforma.');
  const r = await plataforma('get', `/platform/api/v1/users/${t.cwAdminUserId}/login`);
  const url = r?.url || r?.sso_link || null;
  if (!url) throw new ErroPlataforma('A plataforma não devolveu o link de acesso.');
  await registrarEvento(id, 'sso_link', { motivo, ator: ator?.username || null }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.tenant.sso', category: 'system',
    entityType: 'RagnabotTenant', entityId: id,
    description: `Link de acesso ao painel da empresa "${t.name}" gerado${motivo ? ` · Motivo: ${motivo}` : ''} — acesso a dados de terceiros`,
    payloadAfter: { motivo }, rollbackable: false, req,
  }).catch(() => {});
  return { url, expiraEm: 'link de uso único, curto — a plataforma invalida após o consumo' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. MULTICONEXÃO — várias caixas de entrada na MESMA empresa
//
// O que é NATIVO da plataforma (não precisamos escrever nada):
//   · N caixas de entrada por conta, de tipos diferentes ou do MESMO tipo;
//   · vários números de WhatsApp na mesma empresa (1 número = 1 caixa);
//   · um contato único costurando conversas de canais diferentes;
//   · agente com acesso restrito a um subconjunto de caixas.
//
// O que precisa de CÓDIGO NOSSO (é o que está aqui):
//   · criar a caixa a partir do NOC usando o token efêmero do admin do tenant;
//   · aplicar o limite do plano ANTES de criar (a plataforma community não
//     tem limite por conta confiável);
//   · guardar o cadastro da conexão no NOC para cobrança/auditoria, SEM
//     guardar a credencial do canal (só a impressão digital dela);
//   · impedir que dois tenants cadastrem o mesmo número de WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

/** Monta o objeto `channel` conforme o tipo. Cada canal tem campos próprios. */
function montarCanal(tipo, dados = {}) {
  switch (tipo) {
    case 'web_widget':
      return {
        type: 'web_widget',
        website_url: exigirTexto(dados.siteUrl, 'endereço do site', { min: 4, max: 200 }),
        welcome_title: dados.tituloBoasVindas || null,
        welcome_tagline: dados.textoBoasVindas || null,
        widget_color: dados.corDoWidget || null,
      };
    case 'whatsapp':
      return {
        type: 'whatsapp',
        // 1 número = 1 caixa. Vários números na mesma empresa = várias caixas.
        phone_number: exigirTexto(dados.numero, 'número de WhatsApp (formato +55DDDNÚMERO)', { min: 8, max: 20 }),
        provider: 'whatsapp_cloud', // Meta direto — nunca Twilio/360Dialog (diretiva da casa)
        provider_config: {
          api_key: exigirTexto(dados.tokenMeta, 'token permanente da Meta', { min: 20, max: 500 }),
          phone_number_id: exigirTexto(dados.phoneNumberId, 'Phone number ID', { min: 5, max: 40 }),
          business_account_id: exigirTexto(dados.wabaId, 'Business Account ID (WABA)', { min: 5, max: 40 }),
        },
      };
    case 'email':
      return { type: 'email', email: exigirTexto(dados.email, 'endereço de e-mail do canal', { min: 5, max: 160 }) };
    case 'telegram':
      return { type: 'telegram', bot_token: exigirTexto(dados.botToken, 'token do bot do Telegram', { min: 20, max: 200 }) };
    case 'api':
      return { type: 'api', webhook_url: dados.webhookUrl || null };
    case 'instagram':
    case 'facebook':
      throw new Error(
        `O canal "${CANAIS[tipo]}" é criado por login OAuth dentro do painel da empresa (o cliente autoriza a conta dele) — ` +
        'não há como criar pela API sem o consentimento interativo. Use o link de acesso e siga o assistente de caixa de entrada.',
      );
    default:
      throw new Error(`Canal desconhecido: "${tipo}".`);
  }
}

/**
 * Chamada na Application API no contexto do ADMIN de uma empresa, endereçada pelo id do NOC.
 *
 * Existe para que outros serviços (a porta do Chatwoot das automações de atendimento, por exemplo)
 * falem com a conta do cliente sem reimplementar o cliente HTTP nem, pior, guardar o token do
 * admin em lugar nenhum: ele é buscado ao vivo a cada chamada e morre com ela. Quem tem esse token
 * tem a conta inteira do cliente — por isso ele nunca é persistido.
 *
 * Devolve também `cwAccountId`, porque quem chama quase sempre precisa dele para montar o caminho.
 *
 * @param {string} tenantId  id da empresa NO NOC (não é o id da conta na plataforma)
 */
export async function comoAdminDaEmpresa(tenantId, metodo, caminhoOuFabrica, corpo = null) {
  const t = await exigirTenant(tenantId);
  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  const caminho = typeof caminhoOuFabrica === 'function' ? caminhoOuFabrica(t.cwAccountId) : caminhoOuFabrica;
  return aplicacao(token, metodo, caminho, corpo);
}

/**
 * A MESMA chamada de `comoAdminDaEmpresa`, mas com corpo `multipart/form-data`.
 *
 * Existe por UM motivo concreto: a API de mensagens do Chatwoot só aceita anexo como ARQUIVO
 * (`attachments[]`), nunca como URL. Sem este caminho, o nó `midia` do motor de fluxo só teria como
 * degradar para "mando o link no texto" — que funciona, mas não é enviar mídia.
 *
 * O token do admin continua sendo obtido AO VIVO e usado de forma efêmera, exatamente como em
 * `comoAdminDaEmpresa`: quem tem o token tem a conta inteira do cliente, e por isso ele não sai
 * daqui nem é devolvido a quem chama.
 *
 * @param {string} tenantId
 * @param {string|((conta:number)=>string)} caminhoOuFabrica
 * @param {FormData} formulario
 */
export async function comoAdminDaEmpresaMultipart(tenantId, caminhoOuFabrica, formulario) {
  const t = await exigirTenant(tenantId);
  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  const caminho = typeof caminhoOuFabrica === 'function' ? caminhoOuFabrica(t.cwAccountId) : caminhoOuFabrica;
  const cliente = montarCliente({ api_access_token: token }, { multipart: true });
  return requisitar(cliente, 'post', caminho, formulario);
}

/** Lista as caixas de entrada AO VIVO na plataforma (fonte da verdade). */
export async function listarCaixas(tenantId) {
  const t = await exigirTenant(tenantId);
  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  const r = await aplicacao(token, 'get', `/api/v1/accounts/${t.cwAccountId}/inboxes`);
  const lista = Array.isArray(r?.payload) ? r.payload : Array.isArray(r) ? r : [];
  return lista.map((i) => ({
    id: i.id,
    nome: i.name,
    tipoCanal: normalizarTipo(i.channel_type),
    canalRotulo: CANAIS[normalizarTipo(i.channel_type)] || i.channel_type,
    numero: i.phone_number || null,
    siteUrl: i.website_url || null,
    email: i.email || null,
    identificadorWidget: i.website_token || null,
    callbackWebhook: i.callback_webhook_url || null,
  }));
}

/** `Channel::Whatsapp` → `whatsapp`, `Channel::WebWidget` → `web_widget`, … */
function normalizarTipo(channelType) {
  const bruto = String(channelType || '').replace(/^Channel::/, '');
  const mapa = {
    WebWidget: 'web_widget', Whatsapp: 'whatsapp', Email: 'email',
    Telegram: 'telegram', Instagram: 'instagram', FacebookPage: 'facebook', Api: 'api',
  };
  return mapa[bruto] || bruto.toLowerCase();
}

/**
 * Cria uma conexão (caixa de entrada) para a empresa.
 * Aplica o limite do plano, evita número duplicado entre empresas e registra a
 * conexão no NOC — guardando a IMPRESSÃO DIGITAL da credencial, nunca ela.
 */
export async function criarCaixa(tenantId, { tipo, nome, ...dados } = {}, { ator = null, req = null } = {}) {
  const t = await exigirTenant(tenantId);
  if (t.status === 'suspended') throw new Error(`A empresa "${t.name}" está suspensa — reative antes de criar conexões.`);
  const rotulo = exigirTexto(nome, 'nome da caixa de entrada', { min: 2, max: 80 });
  const limites = limitesVigentes(t);

  const atuais = await listarCaixas(tenantId);
  const veredito = cabeMaisUmaCaixa(limites, tipo, atuais.map((c) => ({ channelType: c.tipoCanal })));
  if (!veredito.permitido) throw new Error(veredito.motivo);

  // Número de WhatsApp é único na plataforma inteira. Checar ANTES evita um 422
  // cru e, principalmente, evita que a empresa B tente sequestrar o número da A.
  if (tipo === 'whatsapp') {
    const numero = String(dados.numero || '').trim();
    const jaUsado = await prisma.ragnabotInbox.findFirst({
      where: { identifier: numero, channelType: 'whatsapp', removedAt: null },
      include: { tenant: { select: { name: true, slug: true } } },
    }).catch(() => null);
    if (jaUsado && jaUsado.tenantId !== tenantId) {
      throw new Error(`O número ${numero} já está conectado na empresa "${jaUsado.tenant?.name}". Um número pertence a uma empresa só.`);
    }
  }

  const canal = montarCanal(tipo, dados);
  const identificador = canal.phone_number || canal.email || canal.website_url || `${tipo}-${Date.now()}`;
  const digital = digitalDoSegredo(canal.provider_config?.api_key || canal.bot_token || null);

  // ── RESERVA PRIMEIRO, CRIA DEPOIS ──
  // A ordem importa. Se criássemos na plataforma antes de reservar aqui, duas
  // requisições simultâneas para o mesmo número passariam as duas pela checagem
  // acima e só a segunda gravação falharia — com a caixa já criada lá fora.
  // Reservando primeiro, o índice único de `activeKey` derruba a segunda ANTES
  // de qualquer efeito na plataforma.
  let registro;
  try {
    registro = await prisma.ragnabotInbox.create({
      data: {
        tenantId, cwInboxId: null, name: rotulo,
        channelType: tipo, identifier: identificador,
        activeKey: `${tipo}:${identificador}`,
        // ⚠️ NADA de credencial aqui: só a impressão digital, para conferir
        // rotação de token sem nunca poder reconstruir o segredo.
        credentialFingerprint: digital,
        metadata: {
          wabaId: canal.provider_config?.business_account_id || null,
          phoneNumberId: canal.provider_config?.phone_number_id || null,
        },
      },
    });
  } catch (e) {
    if (e?.code === 'P2002') throw new Error(`A conexão "${identificador}" já está reservada por outra empresa (ou por um pedido simultâneo). Um número/endereço pertence a uma empresa só.`);
    throw traduzirErroDePrisma(e);
  }

  let criada;
  try {
    const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
    criada = await aplicacao(token, 'post', `/api/v1/accounts/${t.cwAccountId}/inboxes`, { name: rotulo, channel: canal });
  } catch (e) {
    // Falhou lá fora → solta a reserva, senão o número fica preso a uma caixa que não existe.
    await prisma.ragnabotInbox.delete({ where: { id: registro.id } }).catch(() => {});
    throw e;
  }

  await prisma.ragnabotInbox.update({
    where: { id: registro.id },
    data: {
      cwInboxId: criada?.id ?? null,
      metadata: {
        wabaId: canal.provider_config?.business_account_id || null,
        phoneNumberId: canal.provider_config?.phone_number_id || null,
        websiteToken: criada?.website_token || null,
        callbackWebhook: criada?.callback_webhook_url || null,
      },
    },
  }).catch((e) => logger.error(`[ragnabot-tenant] caixa ${criada?.id} criada mas o cadastro do NOC ficou incompleto: ${redigir(e.message)}`));

  if (tipo === 'whatsapp' && canal.provider_config?.business_account_id && !t.wabaId) {
    await prisma.ragnabotTenant.update({ where: { id: tenantId }, data: { wabaId: canal.provider_config.business_account_id } }).catch(() => {});
  }

  await registrarEvento(tenantId, 'inbox_created', { tipo, identificador, cwInboxId: criada?.id ?? null, digital }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.inbox.create', category: 'system',
    entityType: 'RagnabotTenant', entityId: tenantId,
    description: `Conexão "${rotulo}" (${CANAIS[tipo]}) criada na empresa "${t.name}" — ${identificador}`,
    payloadAfter: { tipo, identificador, cwInboxId: criada?.id ?? null, credencial: digital }, req,
  }).catch(() => {});

  return {
    id: criada?.id ?? null,
    nome: rotulo,
    tipoCanal: tipo,
    identificador,
    registroNoNoc: registro?.id || null,
    // O que o cliente precisa levar para o painel da Meta/Telegram.
    proximoPasso: proximoPassoDoCanal(tipo, criada),
  };
}

function proximoPassoDoCanal(tipo, criada) {
  if (tipo === 'whatsapp') {
    return {
      resumo: 'Configure o webhook no aplicativo da Meta da própria empresa.',
      urlDeCallback: criada?.callback_webhook_url || `${URL_PUBLICA}/webhooks/whatsapp/${criada?.phone_number || '«numero»'}`,
      tokenDeVerificacao: 'exibido na tela da caixa de entrada (aba Configuração) — copie de lá, não fica gravado no NOC',
      camposParaAssinar: ['messages', 'message_template_status_update'],
    };
  }
  if (tipo === 'web_widget') {
    return { resumo: 'Instale o trecho de código do widget no site do cliente.', identificadorDoWidget: criada?.website_token || null };
  }
  if (tipo === 'telegram') return { resumo: 'Nada a fazer: a plataforma registra o webhook do bot sozinha.' };
  if (tipo === 'email') return { resumo: 'Aponte o encaminhamento (ou configure IMAP/SMTP dedicados) na tela da caixa de entrada.' };
  return { resumo: 'Caixa criada.' };
}

/** Remove uma conexão da empresa (a caixa e o histórico dela na plataforma). */
export async function removerCaixa(tenantId, cwInboxId, { ator = null, req = null } = {}) {
  const t = await exigirTenant(tenantId);
  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  await aplicacao(token, 'delete', `/api/v1/accounts/${t.cwAccountId}/inboxes/${cwInboxId}`);
  // Libera a chave ativa junto: o número volta a poder ser conectado (aqui ou noutra empresa).
  await prisma.ragnabotInbox.updateMany({ where: { tenantId, cwInboxId: Number(cwInboxId) }, data: { removedAt: new Date(), activeKey: null } }).catch(() => {});
  await registrarEvento(tenantId, 'inbox_removed', { cwInboxId }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.inbox.remove', category: 'system',
    entityType: 'RagnabotTenant', entityId: tenantId,
    description: `Conexão ${cwInboxId} removida da empresa "${t.name}" — as conversas dessa caixa vão junto`,
    payloadBefore: { cwInboxId }, rollbackable: false, req,
  }).catch(() => {});
  return { removida: true, cwInboxId: Number(cwInboxId) };
}

/** Reconcilia o cadastro do NOC com o que existe DE FATO na plataforma. */
export async function sincronizarCaixas(tenantId) {
  const t = await exigirTenant(tenantId);
  const vivas = await listarCaixas(tenantId);
  const idsVivos = new Set(vivas.map((c) => c.id));
  const registradas = await prisma.ragnabotInbox.findMany({ where: { tenantId, removedAt: null } });

  let criadas = 0; let marcadasRemovidas = 0;
  // Reconciliação que MENTE no número é pior que reconciliação nenhuma: o
  // contador só sobe quando a linha realmente entrou. O que não entrou vai para
  // `naoRegistradas`, com o motivo — tipicamente a chave ativa já estar presa
  // por uma reserva órfã ou por outra empresa.
  const naoRegistradas = [];
  for (const c of vivas) {
    const existe = registradas.find((r) => r.cwInboxId === c.id);
    if (existe) continue;
    const identificador = c.numero || c.email || c.siteUrl || String(c.id);
    try {
      await prisma.ragnabotInbox.create({
        data: {
          tenantId, cwInboxId: c.id, name: c.nome, channelType: c.tipoCanal,
          identifier: identificador,
          activeKey: `${c.tipoCanal}:${identificador}`,
          metadata: { websiteToken: c.identificadorWidget, callbackWebhook: c.callbackWebhook },
        },
      });
      criadas++;
    } catch (e) {
      const motivo = e?.code === 'P2002'
        ? `a chave "${c.tipoCanal}:${identificador}" já está reservada (reserva órfã de uma criação interrompida, ou outra empresa)`
        : redigir(e.message);
      naoRegistradas.push(`caixa ${c.id} (${c.nome}): ${motivo}`);
      logger.warn(`[ragnabot-tenant] sincronização do tenant ${tenantId} não registrou a caixa ${c.id}: ${motivo}`);
    }
  }
  for (const r of registradas) {
    if (r.cwInboxId != null && !idsVivos.has(r.cwInboxId)) {
      await prisma.ragnabotInbox.update({ where: { id: r.id }, data: { removedAt: new Date(), activeKey: null } }).catch(() => {});
      marcadasRemovidas++;
    }
  }
  return {
    empresa: t.name,
    caixasNaPlataforma: vivas.length,
    novasNoCadastro: criadas,
    marcadasComoRemovidas: marcadasRemovidas,
    naoRegistradas,
    caixas: vivas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Agentes da empresa (o limite de atendentes do plano vive aqui)
// ─────────────────────────────────────────────────────────────────────────────

export async function listarAgentes(tenantId) {
  const t = await exigirTenant(tenantId);
  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  const r = await aplicacao(token, 'get', `/api/v1/accounts/${t.cwAccountId}/agents`);
  const lista = Array.isArray(r?.payload) ? r.payload : Array.isArray(r) ? r : [];
  return lista.map((a) => ({ id: a.id, nome: a.name, email: a.email, papel: a.role, confirmado: a.confirmed }));
}

/** Convida um atendente para a empresa, respeitando o limite do plano. */
export async function convidarAgente(tenantId, { nome, email, papel = 'agent' } = {}, { ator = null, req = null } = {}) {
  const t = await exigirTenant(tenantId);
  const limites = limitesVigentes(t);
  const atuais = await listarAgentes(tenantId);
  if (atuais.length >= limites.agentes) {
    throw new Error(`Limite de ${limites.agentes} atendente(s) do plano ${limites.rotulo || t.plan} atingido. Faça o upgrade do plano para adicionar mais.`);
  }
  const enderecoEmail = exigirTexto(email, 'e-mail do atendente', { min: 5, max: 160 }).toLowerCase();
  if (!RE_EMAIL.test(enderecoEmail)) throw new Error('E-mail do atendente inválido.');

  const token = await tokenDeAdminDoTenant(t.cwAdminUserId);
  const criado = await aplicacao(token, 'post', `/api/v1/accounts/${t.cwAccountId}/agents`, {
    name: exigirTexto(nome, 'nome do atendente', { min: 2, max: 120 }),
    email: enderecoEmail,
    role: papel === 'administrator' ? 'administrator' : 'agent',
  });
  await registrarEvento(tenantId, 'agent_invited', { email: enderecoEmail, papel }, ator?.id || null);
  await logAction({
    user: ator, action: 'ragnabot.agent.invite', category: 'user',
    entityType: 'RagnabotTenant', entityId: tenantId,
    description: `Atendente ${enderecoEmail} convidado para a empresa "${t.name}" como ${papel}`,
    payloadAfter: { email: enderecoEmail, papel }, req,
  }).catch(() => {});
  return { id: criado?.id ?? null, nome: criado?.name || nome, email: enderecoEmail, papel };
}

export default {
  provisionarEmpresa, listarEmpresas, obterEmpresa,
  alterarPlano, suspenderEmpresa, reativarEmpresa, encerrarEmpresa, excluirDefinitivamente,
  linkDeAcesso, verificarIntegracao,
  listarCaixas, criarCaixa, removerCaixa, sincronizarCaixas,
  listarAgentes, convidarAgente,
};
