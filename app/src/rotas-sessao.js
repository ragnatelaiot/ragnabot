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
// ── ⭐ 03/09/2026 (contrato S-CLAREZA): A SEGUNDA PORTA, `POST /adotar` ──────────────────────────
// Quem JÁ está autenticado na plataforma não vê formulário nenhum. O motor lê a credencial que o
// navegador já carrega, PERGUNTA À PLATAFORMA de quem ela é (`GET /api/v1/profile`) e só então
// emite a nossa sessão — pelo MESMO caminho do passo 3/4 acima (`concluirSessao`).
// ⛔ A presença do cookie nunca é prova de nada: ele não é `HttpOnly` (é assim por desenho do
// fornecedor) e qualquer um o escreve. Quem prova é a resposta da plataforma. Ver `perfilNaPlataforma`.
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
import { alvoDaPlataforma as alvoDoModulo } from './base/plataforma-alvo.js';
import {
  sessaoConfigurada, emitirSessao, verificarSessao, revogarSessao,
  lerCookie, cookieDeSessao, cookieDeSaida, usuarioDaSessao, DURACAO_SESSAO_MS,
} from './base/auth.js';
// ⭐ 02/09/2026 (contrato S-CASCA): a sessão única. Módulo separado de propósito — é regra de
// formato de credencial de TERCEIRO, medida no pacote dele, e merece um lugar com nome próprio
// em vez de virar mais um punhado de linhas no meio deste arquivo.
import {
  cookieDaPlataforma, cookieDeSaidaDaPlataforma, credencialDoPedido,
} from './base/plataforma-sessao.js';

const router = Router();

const URL_PUBLICA = process.env.RAGNABOT_BASE_URL || 'https://bot.ragnatela.com.br';
const TEMPO_LIMITE_MS = parseInt(process.env.RAGNABOT_HTTP_TIMEOUT_MS || '20000', 10);
// Nome próprio, e SEM "Mozilla": ver a nota do cabeçalho sobre o 409 de limite de sessões.
const NOSSO_AGENTE = `ragnabot-motor/${VERSAO} (sessao)`;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Como alcançamos a plataforma
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⭐ A REGRA SAIU DAQUI em 02/09/2026 (contrato S-PUBLICAR) e virou `base/plataforma-alvo.js`.
// Motivo: `ragnabot-tenant.service.js` tinha a PRÓPRIA versão, mais antiga e sem o caminho interno,
// e foi ela que rodou na sincronização das caixas — `timeout of 20000ms`, cadastro vazio. A regra
// estava certa aqui e errada lá porque eram duas. Agora é uma. O comportamento deste arquivo não
// mudou nem um degrau; só deixou de ser o único lugar onde a regra existia.
function alvoDaPlataforma() {
  return alvoDoModulo(URL_PUBLICA);
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
  // ⭐ 02/09/2026 (contrato S-CASCA): os CABEÇALHOS passaram a sair daqui junto com o corpo. É
  // deles que sai a credencial da plataforma (`access-token`, `client`, `uid`, …) que o navegador
  // precisa para o painel do fornecedor abrir DENTRO da nossa casca já logado. Ver
  // `base/plataforma-sessao.js` — inclusive a medição que prova que é assim que ele guarda sessão.
  return { status: r.status, dados: r.data, cabecalhos: r.headers || {} };
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
  // ⭐ 02/09/2026 (contrato S-CASCA). Devolve o par, e não só o usuário: `r` aqui é a ÚLTIMA
  // resposta da plataforma — a do segundo fator, quando houve —, que é justamente a que carrega a
  // credencial boa. Devolver a primeira daria um `access-token` que a etapa de MFA já invalidou.
  return { usuario: u, cabecalhos: r.cabecalhos || {} };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⭐ 03/09/2026 (contrato S-CLAREZA) — O SENTIDO INVERSO DA SESSÃO ÚNICA
//
// A v1.11.00 resolveu UM sentido: quem entra pela nossa tela recebe também a credencial da
// plataforma, e as telas embutidas abrem já logadas. Faltava o inverso, e era o que o dono vivia:
// quem JÁ está autenticado na plataforma, ao abrir `/painel/`, levava a NOSSA tela de login. Mesma
// senha, dois formulários — a definição de "tá muito confuso".
//
// ── ⛔ O QUE ESTA FUNÇÃO NÃO FAZ, e é o ponto de segurança inteiro ──────────────────────────────
// Ela NÃO acredita no cookie. Cookie é coisa que o cliente escreve: `cw_d_session_info` não é
// `HttpOnly` (por desenho do fornecedor, ver `base/plataforma-sessao.js`), então qualquer script,
// extensão ou pessoa com o inspetor aberto consegue inventar um. Aceitar a PRESENÇA dele como
// prova de sessão seria criar uma porta: bastaria escrever
// `cw_d_session_info={"access-token":"x","client":"y","uid":"chefe@empresa"}` para entrar como
// quem quisesse.
//
// O que fazemos é PERGUNTAR À PLATAFORMA quem é o dono daquela credencial, com ela, do lado do
// servidor. Se ela responder 401, não há sessão — e o formulário aparece, como antes.
//
// ── O QUE FOI MEDIDO NA PLATAFORMA (03/09/2026), lido no código da versão em uso ────────────────
//   · `GET /api/v1/profile` (rota `resource :profile`, `Api::V1::ProfilesController#show`) renderiza
//     **a mesma parcial** `api/v1/models/_user` que o `/auth/sign_in` — id, uid, name, email,
//     `account_id` (a conta mais recentemente ativa) e `accounts[]` com `role`, `status` e
//     `permissions`. Por isso `escolherConta()` serve aos dois caminhos sem uma linha diferente.
//   · `Api::BaseController` só usa o caminho do token de plataforma quando o cabeçalho
//     `api_access_token` está presente; sem ele, corre `authenticate_user!`, que é o
//     `devise_token_auth` conferindo `access-token` + `client` + `uid`. Por isso esta chamada
//     NUNCA manda `api_access_token`: mandá-lo faria a plataforma responder "sim" para o token do
//     Platform App, e não para a pessoa — validação que valida a nós mesmos.
//   · `config.change_headers_on_each_request = false` no `devise_token_auth.rb`. É o que torna esta
//     conferência SEGURA de repetir: a chamada do servidor **não gira** o token do navegador. Se
//     fosse `true`, cada conferência nossa invalidaria a credencial que o painel embutido usa, e o
//     sintoma seria a tela do fornecedor deslogando sozinha a cada F5.
//
// ⚠️ A RESPOSTA NÃO PODE SER LOGADA. Ela traz `access_token` — o token pessoal de API do usuário.
// Nada dela sai daqui além de id, nome, e-mail e a lista de contas.
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function perfilNaPlataforma(credencial, ip) {
  const alvo = alvoDaPlataforma();
  const cliente = axios.create({
    baseURL: alvo.baseURL,
    timeout: TEMPO_LIMITE_MS,
    httpsAgent: alvo.hostname ? new https.Agent({ servername: alvo.hostname, keepAlive: false }) : undefined,
    headers: {
      ...(alvo.hostname ? { Host: alvo.hostname } : {}),
      Accept: 'application/json',
      'User-Agent': NOSSO_AGENTE,
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...credencial, // access-token, client, uid, expiry, token-type — os nomes são dele
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });

  let r;
  try {
    r = await cliente.get('/api/v1/profile');
  } catch (e) {
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      `Não consegui falar com a plataforma de atendimento (caminho ${alvo.caminho}).`, 503,
      { detalhe: e.code || e.message });
  }

  if (r.status === 401 || r.status === 403) {
    // A credencial do navegador não vale (venceu, foi revogada, ou foi inventada). Não é erro:
    // é a resposta "esta pessoa não está logada", e quem chama mostra o formulário.
    throw new ErroDeEntrada('CREDENCIAL_DA_PLATAFORMA_INVALIDA',
      'A sessão da plataforma de atendimento não vale mais.', 401);
  }
  const ehJson = r.data && typeof r.data === 'object';
  if (!ehJson) {
    // Mesma armadilha da entrada: HTML aqui é o guarda do "não sou robô" ou o proxy respondendo
    // pela plataforma. Chamar isso de "sessão inválida" mandaria procurar defeito na senha.
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      'A plataforma de atendimento não respondeu ao perfil.', 503,
      { status: r.status, caminho: alvo.caminho });
  }
  if (r.status < 200 || r.status >= 300) {
    throw new ErroDeEntrada('PLATAFORMA_RECUSOU',
      'A plataforma de atendimento recusou a consulta do perfil.', 502, { status: r.status });
  }
  // O perfil vem CRU (sem o envelope `data` do sign_in) — medido na parcial `_user`.
  const u = r.data;
  if (!u || !u.id) {
    throw new ErroDeEntrada('PLATAFORMA_INACESSIVEL',
      'A plataforma respondeu ao perfil sem dizer quem é.', 502);
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

/**
 * Pede à plataforma que invalide o token do navegador (`DELETE /auth/sign_out`).
 *
 * ⭐ 02/09/2026 (contrato S-CASCA). NÃO é esperada por quem chama: a saída já aconteceu quando esta
 * função começa. Falhar aqui não pode devolver erro para quem só quis sair — por isso o `catch`
 * engole tudo e registra. Vai pelo caminho INTERNO do cluster, o mesmo da entrada, porque o
 * público passa pelo guarda do "não sou robô", que um servidor não resolve.
 */
function encerrarNaPlataforma(credencial) {
  const alvo = alvoDaPlataforma();
  const cliente = axios.create({
    baseURL: alvo.baseURL,
    timeout: TEMPO_LIMITE_MS,
    httpsAgent: alvo.hostname ? new https.Agent({ servername: alvo.hostname, keepAlive: false }) : undefined,
    headers: {
      ...(alvo.hostname ? { Host: alvo.hostname } : {}),
      Accept: 'application/json',
      'User-Agent': NOSSO_AGENTE,
      ...credencial, // access-token, client, uid, expiry, token-type — os nomes são dele
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  cliente.delete('/auth/sign_out')
    .then((r) => {
      // 404/401 aqui é normal e NÃO é defeito: quer dizer que o token já não valia. Registrar como
      // erro faria o log gritar em toda saída de quem ficou o dia inteiro com a aba aberta.
      if (r.status >= 200 && r.status < 300) return;
      logger.info(`[sessao] a plataforma respondeu ${r.status} à saída — o token provavelmente já não valia.`);
    })
    .catch((e) => logger.warn(`[sessao] não consegui encerrar a sessão na plataforma: ${e.message}`));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. O FIM DA ENTRADA — um só, para os dois caminhos
//
// ⭐ EXTRAÍDO EM 03/09/2026 (contrato S-CLAREZA). Antes este trecho vivia dentro do `POST /entrar`.
// Com a adoção de sessão (`POST /adotar`) passaram a existir DUAS portas para o mesmo prédio, e a
// pior coisa que se pode fazer com duas portas é dar a cada uma o seu próprio porteiro: no dia em
// que uma regra mudar — a empresa suspensa, o papel desconhecido, o prazo do cookie — a que
// esquecerem de mudar vira a porta larga. Aqui a regra é uma, e as duas rotas passam por ela.
//
// O que ele decide, na ordem: a CONTA e o PAPEL (medidos na plataforma) · a EMPRESA no nosso
// cadastro · se a empresa não está suspensa · e só então emite o cookie assinado.
//
// `cabecalhosDaPlataforma` é opcional de propósito: na adoção o navegador JÁ tem a credencial da
// plataforma (foi ela que provou quem é a pessoa), então não há o que regravar. Na entrada por
// senha ela nasce agora, e é aí que o segundo cookie sai junto.
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function concluirSessao(req, res, { usuario: u, contaId, via, cabecalhosDaPlataforma = null }) {
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

  // ⭐ 02/09/2026 (contrato S-CASCA) — A SESSÃO ÚNICA, em duas linhas.
  //
  // DOIS cookies podem sair daqui, com papéis diferentes e nenhum enfraquecendo o outro:
  //   · `rb_sessao`          — NOSSO. Assinado, `HttpOnly`, `SameSite=Strict`, ≤ 8 h. Continua
  //                            exatamente como estava; nada nele mudou, nem na adoção.
  //   · `cw_d_session_info`  — DA PLATAFORMA, no formato que a interface DELA lê. É o que faz o
  //                            painel do fornecedor abrir já logado dentro da nossa casca, em vez
  //                            de pedir a senha uma segunda vez para o mesmo produto.
  //
  // ⚠️ O segundo pode FALTAR sem que isso seja erro de entrada: a nossa parte do produto funciona
  // sem ele (só as telas embutidas é que pedirão login). Por isso ele é adicionado quando existe,
  // e a ausência vira aviso no registro — nunca uma recusa de entrada. Ver `base/plataforma-sessao.js`.
  const biscoitos = [cookieDeSessao(token)];
  if (cabecalhosDaPlataforma) {
    const cookiePlataforma = cookieDaPlataforma(cabecalhosDaPlataforma, { prazoPadraoMs: DURACAO_SESSAO_MS });
    if (cookiePlataforma) biscoitos.push(cookiePlataforma);
    else logger.warn('[sessao] a plataforma não devolveu credencial de navegador — as telas embutidas vão pedir entrada.');
  }
  res.set('Set-Cookie', biscoitos);
  // `no-store` para a resposta da entrada: ela descreve quem entrou; cache de proxy aqui é
  // como a identidade de um operador aparece na tela de outro.
  res.set('Cache-Control', 'no-store');

  const porSenha = via === 'senha';
  await registrar(req, {
    action: porSenha ? 'ragnabot_sessao_entrada' : 'ragnabot_sessao_adotada',
    userId: `cw:${u.id}`,
    userName: u.name || null,
    tenantId: empresa?.id || null,
    description: porSenha
      ? `entrada pela plataforma · conta ${conta.id} · papel ${papel}`
      : `sessão adotada da plataforma (sem segundo formulário) · conta ${conta.id} · papel ${papel}`,
    entityType: 'sessao',
    entityId: jid,
  });
  logger.info(`[sessao] ${porSenha ? 'entrada' : 'adoção'} ok · cw:${u.id} · conta=${conta.id} · papel=${papel}`);

  return res.json({
    autenticado: true,
    // Para a tela saber que ninguém digitou nada — e poder dizer isso à pessoa em vez de
    // simplesmente aparecer logada, o que assusta mais do que ajuda.
    adotada: !porSenha,
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
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. As rotas
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
    const { usuario: u, cabecalhos: cabecalhosDaPlataforma } = await entrarNaPlataforma(email, senha, codigo, ip);
    esquecerFalhas(chave);
    return await concluirSessao(req, res, {
      usuario: u, contaId, via: 'senha', cabecalhosDaPlataforma,
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
 * POST /sessao/adotar — UMA ENTRADA SÓ (contrato S-CLAREZA, 03/09/2026).
 *
 * Quem já está autenticado na PLATAFORMA e abre o nosso painel não vê formulário nenhum: o motor
 * pega a credencial que o navegador já carrega, PERGUNTA À PLATAFORMA de quem ela é, e emite a
 * nossa sessão. Sem senha digitada duas vezes, sem segundo segundo-fator.
 *
 * ── POR QUE UMA ROTA PRÓPRIA, E NÃO ISTO DENTRO DO `GET /eu` ────────────────────────────────────
 * Porque `GET` tem de ficar sem efeito colateral. `/sessao/eu` é chamado a cada abertura de tela e
 * é o tipo de endereço que proxy, pré-busca de navegador e sonda repetem à vontade; emitir
 * credencial ali seria emitir credencial por engano. Rota própria também dá à adoção o seu nome na
 * auditoria (`ragnabot_sessao_adotada`) e o seu próprio freio.
 *
 * ── A ORDEM IMPORTA, e cada degrau economiza o seguinte ─────────────────────────────────────────
 *   1. já temos sessão nossa válida? devolve ela e NÃO fala com a plataforma (o caso comum do F5);
 *   2. o navegador trouxe credencial da plataforma? sem ela, 401 na hora — sem rede, sem espera;
 *   3. só então perguntamos à plataforma quem é.
 *
 * ⚠️ NENHUMA TRAVA FOI AFROUXADA: a sessão emitida aqui tem a mesma validade (≤ 8 h), o mesmo
 * escopo de empresa, o mesmo papel medido na plataforma e a mesma revogação do «Sair». A única
 * coisa que muda é quem PROVOU a identidade — antes a senha digitada agora, aqui a credencial que
 * a própria plataforma emitiu para esta pessoa e que ela acabou de confirmar.
 */
router.post('/adotar', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!sessaoConfigurada()) {
    return res.status(503).json({
      autenticado: false, error: 'SESSAO_NAO_CONFIGURADA',
      mensagem: 'RAGNABOT_SESSAO_SEGREDO não está definido — a entrada está desligada.',
    });
  }

  // 1. Já está dentro? Nada a fazer — e nada de bater na plataforma por causa de um F5.
  const cru = lerCookie(req);
  const jaTem = cru ? verificarSessao(cru) : { ok: false };
  if (jaTem.ok) {
    const u = usuarioDaSessao(jaTem.sessao);
    return res.json({
      autenticado: true,
      adotada: false,
      ator: { id: u.id, nome: u.name, email: u.email, papel: u.role, papelNaPlataforma: u.papelNaPlataforma },
      empresa: u.ragnabotTenantId ? { id: u.ragnabotTenantId } : null,
      conta: { id: u.cwAccountId },
      expiraEm: u.sessaoExpiraEm,
      versao: VERSAO || null,
    });
  }

  // 2. O navegador trouxe a credencial da plataforma?
  const credencial = credencialDoPedido(req);
  if (!credencial) {
    return res.status(401).json({
      autenticado: false, error: 'SEM_CREDENCIAL_DA_PLATAFORMA',
      mensagem: 'Você ainda não está autenticado na plataforma de atendimento neste navegador.',
    });
  }

  // Freio por IP. Não é o freio que conta (a plataforma tem o dela), mas um cookie forjado atrás
  // do outro custa uma chamada nossa por tentativa, e isso não pode sair de graça.
  const ip = await ipDoCliente(req);
  const chave = chaveDeFreio(ip, '#adocao');
  const espera = freado(chave);
  if (espera) {
    return res.status(429).json({
      autenticado: false, error: 'MUITAS_TENTATIVAS',
      mensagem: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} minuto(s).`,
      segundos: espera,
    });
  }

  try {
    // 3. Quem é o dono desta credencial? Quem responde é a plataforma, não o cookie.
    const u = await perfilNaPlataforma(credencial, ip);
    esquecerFalhas(chave);
    return await concluirSessao(req, res, { usuario: u, contaId: req.body?.contaId ?? null, via: 'adocao' });
  } catch (e) {
    if (e instanceof ErroDeEntrada) {
      if (e.codigo === 'CREDENCIAL_DA_PLATAFORMA_INVALIDA') {
        contarFalha(chave);
        // Sem registro de auditoria aqui: cookie vencido é o caso NORMAL de quem passou da hora, e
        // um registro por aba aberta afogaria a trilha justamente quando ela precisar ser lida.
      } else {
        await registrar(req, {
          action: 'ragnabot_sessao_adocao_recusada',
          description: `adoção de sessão recusada (${e.codigo})`,
          entityType: 'sessao',
        });
      }
      return res.status(e.status).json({ autenticado: false, error: e.codigo, mensagem: e.message, ...e.extra });
    }
    logger.error(`[sessao] falha inesperada na adoção: ${e.message}`);
    return res.status(500).json({ autenticado: false, error: 'FALHA_INTERNA', mensagem: 'Não consegui concluir a entrada.' });
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
  // ⭐ 02/09/2026 (contrato S-CASCA). Sair passou a sair dos DOIS lados.
  //
  // Sem isto, «Sair» apagaria o nosso cookie e deixaria a sessão da plataforma viva no navegador
  // até vencer sozinha — a pessoa seguinte na mesma máquina abriria uma tela embutida e cairia
  // dentro da conta de quem saiu. Sessão única tem de ser única também na saída.
  //
  // ⚠️ MELHOR ESFORÇO, e nesta ordem de propósito: primeiro APAGAMOS o cookie (o que sempre
  // funciona e é o que protege a próxima pessoa), e só depois pedimos à plataforma que invalide o
  // token. Se ela estiver fora do ar, a saída acontece do mesmo jeito. Uma saída que pode falhar
  // porque um terceiro caiu é uma saída que a pessoa vai desistir de tentar.
  const credencial = credencialDoPedido(req);
  res.set('Set-Cookie', [cookieDeSaida(), cookieDeSaidaDaPlataforma()]);
  res.set('Cache-Control', 'no-store');
  if (credencial) encerrarNaPlataforma(credencial);
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
