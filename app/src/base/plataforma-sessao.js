// ════════════════════════════════════════════════════════════════════════════════════════════════
// SESSÃO ÚNICA — a credencial da PLATAFORMA entregue ao navegador (contrato S-CASCA, 02/09/2026)
//
// O PROBLEMA QUE ESTE MÓDULO RESOLVE. A partir de hoje as telas que ainda são do fornecedor abrem
// DENTRO da nossa casca, num quadro (`<iframe>`). Só que a nossa entrada (`rotas-sessao.js`) fala
// com a plataforma pelo endereço INTERNO do cluster, do lado do servidor: o navegador nunca chega
// a receber a credencial dela. Resultado, sem este módulo: a pessoa entra uma vez na nossa casca e
// o quadro abre... a tela de login do fornecedor. Duas senhas para o mesmo produto.
//
// ── ⭐ O QUE FOI MEDIDO, e não suposto (02/09/2026) ─────────────────────────────────────────────
// Baixei os pacotes JavaScript que a própria plataforma serve e li como ela guarda a sessão:
//
//     ua.defaults = { sameSite: "Lax" };
//     ua.set("cw_d_session_info", JSON.stringify(e.headers), { expires: … })
//     hasAuthCookie() { return !!ua.get("cw_d_session_info") }
//     zD = () => { const a = JSON.parse(ua.get("cw_d_session_info"));
//                  return { "access-token": …, client: …, uid: …, expiry: …, "token-type": … } }
//
// Três fatos saem daí, e os três mandam no desenho deste arquivo:
//   1. quem grava o cookie é o JAVASCRIPT da plataforma, não o servidor dela — logo NÃO adianta
//      repassar o `Set-Cookie` da resposta de `/auth/sign_in`: ele simplesmente não existe;
//   2. o conteúdo é o JSON dos CABEÇALHOS de autenticação da resposta (o padrão `devise_token_auth`);
//   3. o cookie NÃO é `HttpOnly` — por desenho do fornecedor, a interface dele PRECISA lê-lo.
//
// ── ⛔ ISTO NÃO É INJETAR SCRIPT NO PAINEL DO FORNECEDOR ────────────────────────────────────────
// A lei do contrato (e o incidente de 31/08, em que o remendo por JavaScript quebrou o painel duas
// vezes) proíbe MEXER no que o fornecedor entrega. Aqui não se mexe em nada dele: escrevemos, com
// o nome e o formato que ELE define e lê, o mesmo cookie que ELE gravaria se a pessoa tivesse
// digitado a senha na tela dele. Mesma origem, mesmo valor, mesmos atributos, mesma validade.
// Nenhum arquivo dele é reescrito, nenhuma função dele é substituída.
//
// ── E ISTO NÃO AFROUXA NADA ────────────────────────────────────────────────────────────────────
// O valor só existe DEPOIS de a plataforma ter conferido a senha (e o segundo fator, quando há) —
// é a resposta dela que o produz. Não emitimos credencial: repassamos a que ela acabou de emitir,
// para a mesma pessoa, no mesmo navegador. Quem não passa na entrada não recebe cookie nenhum.
//
// ⚠️ GUARDAMOS SÓ AS CINCO CHAVES QUE A INTERFACE DELE LÊ, e não `JSON.stringify(headers)` inteiro
// como ele faz. É de propósito: a resposta traz também `set-cookie`, `x-request-id` e afins, e um
// cookie legível por JavaScript é o pior lugar do mundo para carregar cabeçalho que ninguém pediu.
// Menos superfície, mesmo comportamento.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O nome é DELE. Mudar isto aqui não renomeia nada: a interface do fornecedor procura por este. */
export const NOME_COOKIE_PLATAFORMA = 'cw_d_session_info';

/**
 * As chaves que a interface do fornecedor lê (medidas no pacote `DashboardIcon-*.js`, função `zD`).
 * A ORDEM não importa para ele; a lista, sim — faltando `access-token` ou `client`, toda chamada
 * à API dele volta 401 e o sintoma é «o painel abre em branco», que não aponta para cá.
 */
export const CHAVES_DA_PLATAFORMA = Object.freeze([
  'access-token', 'token-type', 'client', 'expiry', 'uid',
]);

// Mesmo raciocínio de `base/auth.js`: `Secure` é o padrão e só cai fora de produção, com pedido
// explícito — senão o desenvolvimento em `http://localhost` vira "a sessão não cola", sem mensagem.
function cookieSeguro() {
  return !(process.env.NODE_ENV !== 'production'
    && String(process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO || '') === '1');
}

/**
 * Extrai a credencial da resposta de `POST /auth/sign_in`.
 *
 * @param {object} cabecalhos  cabeçalhos da resposta (o axios já os entrega em minúsculas)
 * @returns {object|null} as cinco chaves, ou `null` quando a resposta não trouxe autenticação
 */
export function credencialDaPlataforma(cabecalhos) {
  if (!cabecalhos || typeof cabecalhos !== 'object') return null;

  // Leitura insensível a maiúsculas: `axios` normaliza, mas este módulo também é chamado do teste
  // com um objeto escrito à mão, e um `Access-Token` que não casasse voltaria `null` em silêncio.
  const mapa = new Map();
  for (const [k, v] of Object.entries(cabecalhos)) {
    if (typeof k === 'string') mapa.set(k.toLowerCase(), v);
  }

  const cred = {};
  for (const chave of CHAVES_DA_PLATAFORMA) {
    const bruto = mapa.get(chave);
    // Cabeçalho repetido chega como lista; ficamos com o primeiro, que é o que o navegador usaria.
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    if (valor === undefined || valor === null || String(valor).trim() === '') continue;
    cred[chave] = String(valor);
  }

  // Sem estes dois não há autenticação nenhuma — devolver um objeto pela metade faria a interface
  // do fornecedor acreditar que está logada e levar 401 em cada tela.
  if (!cred['access-token'] || !cred.client) return null;
  return cred;
}

/**
 * Quando a credencial expira, em milissegundos desde a época.
 * O cabeçalho `expiry` do `devise_token_auth` vem em SEGUNDOS. `null` quando não deu para ler —
 * e aí quem chama decide o prazo, em vez de este módulo inventar um.
 */
export function expiracaoDaCredencial(cred) {
  const bruto = Number(cred?.expiry);
  if (!Number.isFinite(bruto) || bruto <= 0) return null;
  const ms = bruto * 1000;
  // Data no passado = credencial já vencida; não vale a pena gravar cookie que nasce morto.
  if (ms <= Date.now()) return null;
  return ms;
}

/**
 * O cabeçalho `Set-Cookie` que dá ao navegador a sessão da plataforma.
 *
 * ⚠️ SEM `HttpOnly`, e isso é uma DECISÃO CONSCIENTE, não um esquecimento: o cookie é lido pelo
 * JavaScript da própria plataforma (`ua.get("cw_d_session_info")`, medido). Marcá-lo `HttpOnly`
 * faria o quadro abrir deslogado — exatamente o defeito que este módulo existe para consertar.
 * O nosso cookie de sessão (`rb_sessao`) continua `HttpOnly` e `SameSite=Strict`; são dois cookies
 * com dois papéis, e o nosso não fica mais fraco por causa deste.
 *
 * ⚠️ `SameSite=Lax` porque é o que o fornecedor usa (`ua.defaults = { sameSite: "Lax" }`). Não é
 * afrouxamento: o quadro é da MESMA ORIGEM (`bot.ragnatela.com.br`), então `Lax` já basta e
 * `Strict` também funcionaria — usamos o valor dele para o cookie ser idêntico ao que ele grava, e
 * a nossa gravação não brigar com a dele na renovação de token.
 *
 * @param {object} cabecalhos  cabeçalhos da resposta da plataforma
 * @param {{prazoPadraoMs?:number}} [opcoes]  prazo a usar quando `expiry` não vier
 * @returns {string|null} o valor de `Set-Cookie`, ou `null` quando não há credencial
 */
export function cookieDaPlataforma(cabecalhos, opcoes = {}) {
  const cred = credencialDaPlataforma(cabecalhos);
  if (!cred) return null;

  // `encodeURIComponent` no JSON inteiro: o valor tem `{`, `"` e `,`, e cookie com aspas ou vírgula
  // crua é terreno de bug entre servidores. A biblioteca do fornecedor decodifica na leitura
  // (`value.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent)`, medido), então ele recebe o JSON
  // inteiro de volta — foi por isso que dei a volta por aqui em vez de gravar cru.
  const valor = encodeURIComponent(JSON.stringify(cred));

  const venceEm = expiracaoDaCredencial(cred)
    ?? (Date.now() + Number(opcoes.prazoPadraoMs || 8 * 3600 * 1000));

  const p = [
    `${NOME_COOKIE_PLATAFORMA}=${valor}`,
    'Path=/',                                   // `/` porque o painel dele vive em `/app/…`
    'SameSite=Lax',
    `Expires=${new Date(venceEm).toUTCString()}`,
  ];
  if (cookieSeguro()) p.push('Secure');
  return p.join('; ');
}

/**
 * Apaga a sessão da plataforma no navegador.
 * ⚠️ Os atributos têm de bater com os da emissão (`Path`, `SameSite`, `Secure`) — atributo
 * diferente faz o navegador guardar DOIS cookies em vez de apagar o que existia, e a pessoa
 * "sai" continuando logada no quadro.
 */
export function cookieDeSaidaDaPlataforma() {
  const p = [
    `${NOME_COOKIE_PLATAFORMA}=`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (cookieSeguro()) p.push('Secure');
  return p.join('; ');
}

/**
 * Lê a credencial de volta, a partir do cabeçalho `Cookie` do pedido.
 * Usada na SAÍDA, para encerrar a sessão dos DOIS lados: sem isto, "Sair" apagaria o cookie e
 * deixaria o `access-token` vivo na plataforma até vencer sozinho.
 */
export function credencialDoPedido(req) {
  const cru = req?.headers?.cookie;
  if (!cru) return null;
  for (const parte of String(cru).split(';')) {
    const eq = parte.indexOf('=');
    if (eq < 0) continue;
    if (parte.slice(0, eq).trim() !== NOME_COOKIE_PLATAFORMA) continue;
    try {
      const json = JSON.parse(decodeURIComponent(parte.slice(eq + 1).trim()));
      // Passa pela MESMA porta da emissão: um cookie adulterado não vira credencial pela metade.
      return credencialDaPlataforma(json);
    } catch { return null; }
  }
  return null;
}

export default {
  NOME_COOKIE_PLATAFORMA, CHAVES_DA_PLATAFORMA,
  credencialDaPlataforma, expiracaoDaCredencial,
  cookieDaPlataforma, cookieDeSaidaDaPlataforma, credencialDoPedido,
};
