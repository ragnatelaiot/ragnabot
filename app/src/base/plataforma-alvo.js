// ════════════════════════════════════════════════════════════════════════════════════════════════
// POR ONDE O MOTOR ALCANÇA A PLATAFORMA DE ATENDIMENTO — uma regra só, num lugar só.
//
// ── POR QUE ESTE ARQUIVO NASCEU (02/09/2026, contrato S-PUBLICAR) ───────────────────────────────
// A regra existia, estava CERTA, e estava escrita dentro de `rotas-sessao.js`. `ragnabot-tenant.
// service.js` tinha a própria, mais antiga e sem o caminho interno — e a consequência foi medida no
// minuto seguinte à publicação da v1.07.00: a sincronização das caixas subiu, rodou e devolveu
//
//     "Falha de rede ao falar com a plataforma (GET /platform/api/v1/users/1): timeout of 20000ms"
//
// com `caixasNaPlataforma: 0`. Dois módulos, duas regras, e a mais velha ganhou justo no caminho
// que importava. É exatamente o vício que este arquivo fecha: a regra passa a ter UM dono.
//
// ── A ORDEM, E O PORQUÊ DE CADA DEGRAU ──────────────────────────────────────────────────────────
//   1. `RAGNABOT_PLATAFORMA_INTERNA` — o Service do Kubernetes (`http://ragnabot-web:3000`).
//      PREFERIDO sempre que existir: não passa pelo proxy reverso, não depende de DNS público, não
//      sofre com hairpin NAT (de dentro, o nome público não volta — memória da casa) e não esbarra
//      no guarda do "não sou robô", que barra `POST /auth/sign_in` antes de chegar ao Chatwoot.
//      Servidor não resolve desafio de robô.
//   2. `RAGNABOT_PROXY_IP` — o proxy pelo IP, forçando `Host` e SNI. É o equivalente exato do
//      `curl --resolve` que a casa já usa para validar site atrás de hairpin. O TLS continua REAL:
//      o certificado é conferido contra o `servername`, não contra o IP.
//   3. a URL pública — último recurso, e o único que depende de o mundo inteiro estar de pé.
//
// O campo `caminho` viaja para dentro das mensagens de erro de propósito: «não consegui falar com a
// plataforma» sem dizer POR ONDE tentou manda quem diagnostica adivinhar entre três rotas.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} urlPublica  a URL pública da plataforma (o nome que está no certificado)
 * @returns {{baseURL: string, hostname: string|null, caminho: 'interna'|'proxy'|'publica'}}
 *   `hostname` é `null` no caminho interno — é o sinal de que NÃO se força `Host` nem SNI ali.
 */
export function alvoDaPlataforma(urlPublica) {
  const hostname = new URL(urlPublica).hostname;

  const interna = (process.env.RAGNABOT_PLATAFORMA_INTERNA || '').trim();
  if (interna) return { baseURL: interna.replace(/\/+$/u, ''), hostname: null, caminho: 'interna' };

  const ip = (process.env.RAGNABOT_PROXY_IP || '').trim();
  if (ip) return { baseURL: `https://${ip}`, hostname, caminho: 'proxy' };

  return { baseURL: urlPublica, hostname, caminho: 'publica' };
}

export default alvoDaPlataforma;
