// ════════════════════════════════════════════════════════════════════════════════════════════════
// ENTRADA DE SESSÃO DO RAGNABOT — a pessoa entra com a conta DELA, da plataforma.
//
// Contrato S4-AUTH, caminho (C) do `web/COMO-SERVIR.md` §3. Fecha um defeito concreto: para servir
// a tela, o motor teria de injetar o `RAGNABOT_SERVICE_TOKEN` no navegador (segredo de serviço
// virando segredo de quem alcança a página) e o papel viajaria em cabeçalho que o cliente controla
// (`x-ragnabot-ator-papel: super` passava por `superuserOnly`). Aqui nada disso existe.
//
// ── O DESENHO, EM QUATRO LINHAS ─────────────────────────────────────────────────────────────────
//   1. `POST /sessao/entrar` recebe e-mail e senha e os manda para o Chatwoot (`POST /auth/sign_in`).
//      Quem confere a senha é a plataforma. Nós NUNCA guardamos a senha — nem em log, nem em cache.
//   2. Da resposta dela sai QUEM É (id, nome, e-mail) e o PAPEL REAL na conta escolhida
//      (`administrator` | `agent`). O papel vem da plataforma; do navegador não vem nada.
//   3. Resolvemos a EMPRESA (RagnabotTenant) pela conta da plataforma — no servidor, uma vez, na
//      entrada. É o que dá escopo à sessão sem consultar o banco a cada pedido.
//   4. Emitimos um cookie ASSINADO (HttpOnly, SameSite=Strict, Secure, ≤ 8 h) com o papel DENTRO
//      do conteúdo assinado. `base/auth.js` o lê e ignora, nesse caminho, qualquer cabeçalho de
//      ator — é a trava que impede a escalada voltar pela porta dos fundos.
//
// ── O QUE FOI MEDIDO NA PLATAFORMA (30/08/2026) — não é suposição ───────────────────────────────
// Lido no código da versão em uso (chatwoot v4.17.1, `DeviseOverrides::SessionsController` e
// `app/views/api/v1/models/_user.json.jbuilder`) e conferido contra o serviço no ar:
//   · sucesso → 200 `{ data: { id, uid, name, email, account_id, role, accounts:[{id, name,
//     status, role, permissions, …}] } }`. O `role` do topo é o da conta MAIS RECENTEMENTE ATIVA;
//     quem manda para nós é `accounts[].role` DA CONTA ESCOLHIDA. Confundir os dois dá o papel da
//     conta errada para quem participa de mais de uma.
//   · segundo fator ligado → **206** `{ mfa_required: true, mfa_token }` (o token vale 5 min).
//   · credencial errada → 401 com JSON de erro (a mesma frase para e-mail inexistente e para senha
//     errada — a plataforma não deixa enumerar usuário, e nós não estragamos isso).
//   · limite de sessões → 409 `{ sessions_limit_reached }` **somente para navegador**: o Chatwoot
//     decide isso por `request.user_agent.include?('Mozilla')`. Por isso esta chamada NÃO repassa o
//     User-Agent do navegador: com o nosso, a plataforma descarta a sessão mais velha e segue, em
//     vez de devolver uma tela de escolha que a nossa interface não sabe desenhar.
//
// ⚠️ ARMADILHA MEDIDA HOJE: pelo endereço PÚBLICO, `POST /auth/sign_in` responde **401 em HTML do
// nginx** — é o guarda do "não sou robô" (`auth_request`, `deploy/turnstile/`), que barra antes de
// chegar ao Chatwoot. Servidor não resolve desafio de robô. Por isso a entrada procura primeiro o
// endereço INTERNO do cluster (`RAGNABOT_PLATAFORMA_INTERNA`, tipicamente
// `http://ragnabot-web:3000`), que não passa pelo guarda. E, se cair no caminho público e levar
// HTML na cara, respondemos PLATAFORMA_INACESSIVEL — nunca "e-mail ou senha inválidos", que
// mandaria todo mundo procurar o defeito na senha.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import https from 'node:https';
import { Router } from 'express';
import axios from 'axios';
import logger from './base/logger.js';
import VERSAO from './base/versao.js';
import {
  sessaoConfigurada, emitirSessao, verificarSessao, revogarSessao,
  lerCookie, cookieDeSessao, cookieDeSaida, usuarioDaSessao, DURACAO_SESSAO_MS,
} from './base/auth.js';

const router = Router();

const URL_PUBLICA = process.env.RAGNABOT_BASE_URL || 'https://bot.ragnatela.com.br';
const TEMPO_LIMITE_MS = parseInt(process.env.RAGNABOT_HTTP_TIMEOUT_MS || '20000', 10);
// Nome próprio, e SEM "Mozilla": ver a nota do cabeçalho sobre o 409 de limite de sessões.
const NOSSO_AGENTE = `ragnabot-motor/${VERSAO} (sessao)`;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Como alcançamos a plataforma
// ────────────────────────────────────────────────────────────────────────────────────────────────
function alvoDaPlataforma() {
  const hostname = new URL(URL_PUBLICA).hostname;
  const interna = (process.env.RAGNABOT_PLATAFORMA_INTERNA || '').trim();
  // Preferido: o Service do Kubernetes. Não passa pelo proxy reverso, não depende de DNS público,
  // não sofre hairpin NAT e — o que importa aqui — não passa pelo guarda do "não sou robô".
  if (interna) return { baseURL: interna.replace(/\/+$/, ''), hostname: null, caminho: 'interna' };
  const ip = (process.env.RAGNABOT_PROXY_IP || '').trim();
  // Fallback: o proxy pelo IP, forçando Host e SNI (o equivalente ao `curl --resolve` da casa).
  if (ip) return { baseURL: `https://${ip}`, hostname, caminho: 'proxy' };
  return { baseURL: URL_PUBLICA, hostname, caminho: 'publica' };
}

class ErroDeEntrada extends Error {
  constructor(codigo, mensagem, status = 401, extra = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.extra = extra;
  }
}

/** IP real de quem está entrando — para a plataforma contar a tentativa contra o cliente certo. */
async function ipDoCliente(req) {
  try {
    const { extractIp } = await import('./base/auditoria.js');
    return extractIp(req);
  } catch { return req.ip || null; }
}

/**
 * Uma chamada a `POST /auth/sign_in`. O corpo NUNCA é logado (leva senha ou `mfa_token`).
 */
async function chamarEntrada(corpo, ip) {
  const alvo = alvoDaPlataforma();
  const cliente = axios.create({
    baseURL: alvo.baseURL,
    timeout: TEMPO_LIMITE_MS,
    httpsAgent: alvo.hostname ? new https.Agent({ servername: alvo.hostname, keepAlive: false }) : undefined,
    headers: {
      ...(alvo.hostname ? { Host: alvo.hostname } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': NOSSO_AGENTE,
      // A plataforma confia na rede dos pods (TRUSTED_PROXIES inclui 10.244.0.0/16), então o
      // freio de força-bruta dela conta contra o IP de quem está mesmo tentando, e não contra nós.
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });

  let r;
  try {
    r = await cliente.post('/auth/sign_in', corpo);
  } catch (e) {
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      `Não consegui falar com a plataforma de atendimento (caminho ${alvo.caminho}).`, 503,
      { detalhe: e.code || e.message });
  }

  const ehJson = r.data && typeof r.data === 'object';
  // Resposta que não é JSON = alguém no meio do caminho respondeu por ela (guarda do "não sou
  // robô", página de erro do proxy, redirecionamento). Chamar isso de "senha inválida" mandaria
  // toda a equipe procurar o defeito no lugar errado.
  if (!ehJson) {
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      'A plataforma de atendimento não respondeu à entrada. '
      + (alvo.caminho === 'interna'
        ? 'Confira o endereço interno configurado.'
        : 'O caminho público passa pelo guarda do "não sou robô", que um servidor não resolve — '
          + 'configure RAGNABOT_PLATAFORMA_INTERNA.'),
      503, { status: r.status, caminho: alvo.caminho });
  }
  return { status: r.status, dados: r.data };
}

/**
 * Entra na plataforma e devolve o usuário verificado. `codigo` é o segundo fator, quando houver.
 *
 * ⚠️ O `mfa_token` NÃO viaja até o navegador: quando a plataforma pede segundo fator e nós não
 * temos o código, recusamos com MFA_NECESSARIO e a tela pede o código; na tentativa seguinte a
 * senha é conferida de novo e o `mfa_token` é usado aqui dentro, no mesmo pedido. Guardá-lo no
 * cliente seria criar uma segunda credencial de 5 minutos sem necessidade nenhuma.
 */
async function entrarNaPlataforma(email, senha, codigo, ip) {
  let r = await chamarEntrada({ email, password: senha }, ip);

  if (r.status === 206 || r.dados?.mfa_required) {
    const mfaToken = r.dados?.mfa_token;
    if (!codigo) {
      throw new ErroDeEntrada('MFA_NECESSARIO',
        'Esta conta usa verificação em duas etapas. Informe o código do aplicativo autenticador.', 401);
    }
    if (!mfaToken) {
      throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
        'A plataforma pediu o segundo fator mas não devolveu o token da etapa.', 503);
    }
    const limpo = String(codigo).replace(/\s+/g, '');
    // 6 dígitos = aplicativo autenticador; qualquer outro formato = código de recuperação.
    const corpo = /^\d{6}$/.test(limpo)
      ? { mfa_token: mfaToken, otp_code: limpo }
      : { mfa_token: mfaToken, backup_code: limpo };
    r = await chamarEntrada(corpo, ip);
    if (r.status === 400 || r.status === 401) {
      throw new ErroDeEntrada('MFA_INVALIDO', 'Código de verificação inválido ou expirado.', 401);
    }
  }

  if (r.status === 429) {
    throw new ErroDeEntrada('MUITAS_TENTATIVAS',
      'A plataforma freou as tentativas de entrada. Espere um minuto e tente de novo.', 429);
  }
  if (r.status === 409 && r.dados?.sessions_limit_reached) {
    throw new ErroDeEntrada('LIMITE_DE_SESSOES',
      'Esta conta atingiu o limite de sessões na plataforma. Encerre uma sessão e tente de novo.', 409);
  }
  if (r.status === 401) {
    // A mesma frase para e-mail inexistente e senha errada — não viramos oráculo de usuário.
    throw new ErroDeEntrada('CREDENCIAL_INVALIDA', 'E-mail ou senha inválidos.', 401);
  }
  if (r.status < 200 || r.status >= 300) {
    throw new ErroDeEntrada('PLATAFORMA_RECUSOU',
      'A plataforma de atendimento recusou a entrada.', 502, { status: r.status });
  }

  const u = r.dados?.data;
  if (!u || !u.id) {
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      'A plataforma respondeu à entrada sem dizer quem entrou.', 502);
  }
  return u;
}

/**
 * Escolhe a conta e LÊ o papel dali. Nunca do topo da resposta (que é o da conta mais ativa) e
 * nunca do que a tela pediu sem conferir.
 */
function escolherConta(u, contaPedida) {
  const contas = Array.isArray(u.accounts) ? u.accounts : [];
  if (contas.length === 0) {
    throw new ErroDeEntrada('SEM_CONTA',
      'Esta conta de usuário não está vinculada a nenhuma empresa na plataforma.', 403);
  }
  let escolhida = null;
  if (contaPedida != null && contaPedida !== '') {
    escolhida = contas.find((c) => String(c.id) === String(contaPedida)) || null;
    // Pediu uma conta de que não participa: 403, e não "escolho outra por você".
    if (!escolhida) throw new ErroDeEntrada('CONTA_NAO_PERMITIDA', 'Você não participa desta empresa.', 403);
  } else if (u.account_id != null) {
    escolhida = contas.find((c) => String(c.id) === String(u.account_id)) || null;
  }
  if (!escolhida && contas.length === 1) [escolhida] = contas;
  if (!escolhida) {
    throw new ErroDeEntrada('ESCOLHA_CONTA', 'Escolha a empresa com que deseja entrar.', 409, {
      contas: contas.map((c) => ({ id: c.id, nome: c.name })),
    });
  }
  if (escolhida.status && escolhida.status !== 'active') {
    throw new ErroDeEntrada('CONTA_INATIVA', 'Esta empresa está inativa na plataforma de atendimento.', 403);
  }
  const papel = escolhida.role;
  // Sem papel não inventamos um: papel padrão generoso é como se dá acesso sem querer.
  if (papel !== 'administrator' && papel !== 'agent') {
    throw new ErroDeEntrada('PAPEL_DESCONHECIDO',
      'A plataforma não informou um papel reconhecido para você nesta empresa.', 403,
      { recebido: papel ?? null });
  }
  return { conta: escolhida, papel };
}

/** Empresa (RagnabotTenant) da conta. Import preguiçoso: o Prisma não pode ser exigido só para
 *  carregar este arquivo — inclusive nos testes, que não têm banco. */
async function empresaDaConta(cwAccountId) {
  try {
    const prisma = (await import('./base/db.js')).default;
    return await prisma.ragnabotTenant.findUnique({
      where: { cwAccountId: Number(cwAccountId) },
      select: { id: true, name: true, status: true },
    });
  } catch (e) {
    throw new ErroDeEntrada('BASE_INDISPONIVEL',
      'Não consegui consultar o cadastro da empresa.', 503, { detalhe: e.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. Freio de tentativas — nosso, além do que a plataforma já tem
//
// A plataforma tem `limit_req` no nginx e rack-attack; ainda assim freamos aqui, porque este
// endpoint é NOSSO e uma tentativa que nem chega lá também custa. Chave = IP + e-mail: freia o
// ataque a UMA conta sem trancar o escritório inteiro que sai pelo mesmo IP.
//
// ⚠️ De memória, e portanto POR RÉPLICA (são 2). Não é o freio definitivo — é o barato que
// funciona hoje sem tabela nova. O freio que conta de verdade continua sendo o da plataforma.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const JANELA_MS = 10 * 60_000;
const MAX_FALHAS = 5;
const CASTIGO_MS = 15 * 60_000;
const tentativas = new Map(); // chave -> { falhas, desde, bloqueadoAte }

function chaveDeFreio(ip, email) {
  return `${ip || '?'}|${String(email || '').toLowerCase()}`;
}

function freado(chave) {
  const t = tentativas.get(chave);
  if (!t) return 0;
  const agora = Date.now();
  if (t.bloqueadoAte && t.bloqueadoAte > agora) return Math.ceil((t.bloqueadoAte - agora) / 1000);
  if (agora - t.desde > JANELA_MS) { tentativas.delete(chave); return 0; }
  return 0;
}

function contarFalha(chave) {
  const agora = Date.now();
  const t = tentativas.get(chave) || { falhas: 0, desde: agora, bloqueadoAte: 0 };
  if (agora - t.desde > JANELA_MS) { t.falhas = 0; t.desde = agora; }
  t.falhas += 1;
  if (t.falhas >= MAX_FALHAS) { t.bloqueadoAte = agora + CASTIGO_MS; t.falhas = 0; t.desde = agora; }
  tentativas.set(chave, t);
  // Higiene: sem isto o mapa cresce para sempre num ataque distribuído.
  if (tentativas.size > 5000) {
    for (const [k, v] of tentativas) {
      if ((!v.bloqueadoAte || v.bloqueadoAte < agora) && agora - v.desde > JANELA_MS) tentativas.delete(k);
    }
  }
}

function esquecerFalhas(chave) { tentativas.delete(chave); }

/** Registro de auditoria — nunca derruba a entrada se falhar. */
async function registrar(req, dados) {
  try {
    const { logAction } = await import('./base/auditoria.js');
    await logAction({ req, category: 'auth', ...dados });
  } catch (e) {
    logger.warn(`[sessao] auditoria não registrou: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. As três rotas
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * POST /sessao/entrar  { email, senha, codigo?, contaId? }
 * Sucesso: 200 + cookie de sessão. Nada de token no corpo — o cookie é HttpOnly de propósito,
 * para que um script na página não consiga lê-lo.
 */
router.post('/entrar', async (req, res) => {
  // Falha FECHADA, como o resto da casa: sem a chave de assinatura não existe sessão para emitir.
  if (!sessaoConfigurada()) {
    return res.status(503).json({
      error: 'SESSAO_NAO_CONFIGURADA',
      mensagem: 'RAGNABOT_SESSAO_SEGREDO não está definido — a entrada está desligada.',
    });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = req.body?.senha ?? req.body?.password ?? '';
  const codigo = req.body?.codigo ?? req.body?.otp ?? null;
  const contaId = req.body?.contaId ?? null;

  if (!email || !senha) {
    return res.status(400).json({ error: 'DADOS_FALTANDO', mensagem: 'Informe o e-mail e a senha.' });
  }

  const ip = await ipDoCliente(req);
  const chave = chaveDeFreio(ip, email);
  const espera = freado(chave);
  if (espera) {
    return res.status(429).json({
      error: 'MUITAS_TENTATIVAS',
      mensagem: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} minuto(s).`,
      segundos: espera,
    });
  }

  try {
    const u = await entrarNaPlataforma(email, senha, codigo, ip);
    const { conta, papel } = escolherConta(u, contaId);

    const empresa = await empresaDaConta(conta.id);
    if (empresa && ['suspended', 'closed'].includes(empresa.status)) {
      throw new ErroDeEntrada('EMPRESA_SUSPENSA',
        'A empresa está suspensa. Fale com o atendimento da Ragnatela.', 403);
    }

    const { token, expiraEm, jid } = emitirSessao({
      sub: u.id,
      nome: u.name || u.available_name || null,
      email: u.email || null,
      papel,                      // ⭐ o papel MEDIDO na plataforma, assinado dentro do cookie
      conta: conta.id,
      tenantId: empresa?.id || null,
    });

    esquecerFalhas(chave);
    res.set('Set-Cookie', cookieDeSessao(token));
    // `no-store` para a resposta da entrada: ela descreve quem entrou; cache de proxy aqui é
    // como a identidade de um operador aparece na tela de outro.
    res.set('Cache-Control', 'no-store');

    await registrar(req, {
      action: 'ragnabot_sessao_entrada',
      userId: `cw:${u.id}`,
      userName: u.name || null,
      tenantId: empresa?.id || null,
      description: `entrada pela plataforma · conta ${conta.id} · papel ${papel}`,
      entityType: 'sessao',
      entityId: jid,
    });
    logger.info(`[sessao] entrada ok · cw:${u.id} · conta=${conta.id} · papel=${papel}`);

    return res.json({
      autenticado: true,
      ator: {
        id: `cw:${u.id}`,
        nome: u.name || null,
        email: u.email || null,
        papel: papel === 'administrator' ? 'admin' : 'user',
        papelNaPlataforma: papel,
      },
      empresa: empresa ? { id: empresa.id, nome: empresa.name } : null,
      conta: { id: conta.id, nome: conta.name || null },
      // Dito em voz alta em vez de virar tela vazia sem explicação.
      aviso: empresa ? null : 'Esta conta da plataforma ainda não está cadastrada no Ragnabot — '
        + 'você entrou, mas não verá fluxos até o cadastro da empresa.',
      expiraEm: expiraEm.toISOString(),
      versao: VERSAO || null,
    });
  } catch (e) {
    if (e instanceof ErroDeEntrada) {
      // Só conta como tentativa falha o que É falha de credencial. Plataforma fora do ar não pode
      // trancar a conta de quem digitou certo.
      if (['CREDENCIAL_INVALIDA', 'MFA_INVALIDO'].includes(e.codigo)) contarFalha(chave);
      if (e.codigo !== 'MFA_NECESSARIO') {
        await registrar(req, {
          action: 'ragnabot_sessao_recusada',
          description: `entrada recusada (${e.codigo})`,
          entityType: 'sessao',
        });
      }
      return res.status(e.status).json({ error: e.codigo, mensagem: e.message, ...e.extra });
    }
    logger.error(`[sessao] falha inesperada na entrada: ${e.message}`);
    return res.status(500).json({ error: 'FALHA_INTERNA', mensagem: 'Não consegui concluir a entrada.' });
  }
});

/**
 * POST /sessao/sair — apaga o cookie no navegador E revoga o identificador nesta réplica.
 * Responde 200 mesmo sem sessão: sair de onde não se está não é erro, e não há o que revelar.
 */
router.post('/sair', async (req, res) => {
  const cru = lerCookie(req);
  const r = cru ? verificarSessao(cru) : { ok: false };
  if (r.ok) {
    revogarSessao(r.sessao.jid, r.sessao.exp);
    await registrar(req, {
      action: 'ragnabot_sessao_saida',
      userId: `cw:${r.sessao.sub}`,
      userName: r.sessao.nome || null,
      tenantId: r.sessao.tenantId || null,
      description: 'saída pedida pela pessoa',
      entityType: 'sessao',
      entityId: r.sessao.jid,
    });
  }
  res.set('Set-Cookie', cookieDeSaida());
  res.set('Cache-Control', 'no-store');
  return res.json({ autenticado: false });
});

/**
 * GET /sessao/eu — quem está logado. NENHUM segredo sai daqui: nem o cookie, nem token de serviço.
 * A tela usa esta resposta para decidir se mostra o editor ou a tela de entrada.
 */
router.get('/eu', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sessaoConfigurada()) {
    return res.status(503).json({
      autenticado: false, error: 'SESSAO_NAO_CONFIGURADA',
      mensagem: 'A entrada está desligada nesta instalação.',
    });
  }
  const cru = lerCookie(req);
  const r = cru ? verificarSessao(cru) : { ok: false, motivo: 'ausente' };
  if (!r.ok) {
    return res.status(401).json({ autenticado: false, error: 'NAO_AUTENTICADO', motivo: r.motivo });
  }
  const u = usuarioDaSessao(r.sessao);
  return res.json({
    autenticado: true,
    ator: {
      id: u.id, nome: u.name, email: u.email,
      papel: u.role, papelNaPlataforma: u.papelNaPlataforma,
    },
    empresa: u.ragnabotTenantId ? { id: u.ragnabotTenantId } : null,
    conta: { id: u.cwAccountId },
    expiraEm: u.sessaoExpiraEm,
    duracaoMs: DURACAO_SESSAO_MS,
    versao: VERSAO || null,
  });
});

export default router;
