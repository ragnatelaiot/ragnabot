// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CONEXÃO AO VIVO DA CAIXA (contrato S-TEMPO-REAL, 03/09/2026 — doc 35 §6.8)
//
// ── POR QUE «EVENTOS ENVIADOS PELO SERVIDOR» (SSE) E NÃO WEBSOCKET ──────────────────────────────
// ⚠️ CORRIGIDO DEPOIS DE MEDIR NO PROXY DE VERDADE (03/09/2026). A primeira versão deste
// comentário dizia que o WebSocket «não sobe» porque o bloco `location ^~ /painel/` não teria os
// cabeçalhos de `Upgrade`. Isso está ESCRITO no arquivo versionado
// `app/deploy/nginx/bot-painel.conf` — e o arquivo versionado está DESATUALIZADO. No vhost que
// está NO AR (`/etc/nginx/sites-enabled/bot-ragnatela`, lido em 03/09) as duas linhas existem:
//     proxy_set_header Upgrade    $http_upgrade;
//     proxy_set_header Connection $ragnabot_conn_upgrade;   # map: default upgrade; '' close
// Ou seja: **WebSocket atravessaria**. A cópia do repositório mente, e isso está no relatório da
// entrega como achado para quem cuida do proxy — cópia de segurança que mente é pior que ausente.
//
// A escolha por SSE fica de pé, mas pelos motivos CERTOS, e são estes:
//
//   1. o tráfego é de MÃO ÚNICA (servidor → tela). A tela já fala de volta pelas rotas HTTP que
//      existem. WebSocket compraria um canal de volta que ninguém vai usar;
//   2. ⭐ AUTENTICAÇÃO — o argumento que decide. SSE é um `GET` comum: entra no router, passa pelo
//      MESMO `autenticar` de todas as outras rotas, com o MESMO cookie, e um 401 é um 401. O
//      `upgrade` do WebSocket acontece ANTES do Express: exigiria um segundo caminho de
//      autenticação, escrito à mão, no ponto mais sensível do sistema. Duas portas de identidade
//      é como uma delas fica para trás;
//   3. dependência nova zero (o `EventSource` é do navegador; do nosso lado é `res.write`);
//   4. reconexão é nativa do navegador, com semântica definida — não precisa ser inventada.
//
// O que SSE custa, e está declarado: depende do cabeçalho `X-Accel-Buffering` para não ser
// buferizado (ver logo abaixo) e não serve para tráfego binário. Se um dia o produto precisar de
// canal de volta (digitação ao vivo, presença), WebSocket é o caminho — e o proxy já o aceita.
//
// ── AS DUAS ARMADILHAS DE SSE ATRÁS DE NGINX, e como cada uma é desarmada AQUI ───────────────────
// (a) BUFERIZAÇÃO. MEDIDO no vhost real: o bloco `/painel/` NÃO declara `proxy_buffering`, então
//     vale o padrão do nginx, que é LIGADO. Sem tratamento, o evento fica preso no buffer e chega
//     em rajada — o sintoma é «às vezes atualiza, às vezes não», que ninguém liga a buffer nenhum.
//     Desarmado pelo cabeçalho `X-Accel-Buffering: no`, que os dois nginx OBEDECEM na resposta.
//     É o único jeito de desligar buferização sem escrever no arquivo de configuração do proxy.
// (b) TEMPO LIMITE DE LEITURA. MEDIDO: o proxy corta em 120 s sem dado (`proxy_read_timeout 120s`
//     no próprio bloco `/painel/`) e o Ingress corta em 60 s (padrão do nginx-ingress). Uma caixa parada de madrugada seria derrubada e voltaria em laço. Desarmado
//     pelo BATIMENTO: um comentário `:` a cada 20 s, que não é evento para a tela e mantém o cano
//     quente. 20 s e não 50 para caber com folga no menor dos dois cortes.
//
// ── A CONEXÃO TEM VALIDADE, DE PROPÓSITO ────────────────────────────────────────────────────────
// Ela se fecha sozinha a cada 15 min e o navegador reconecta. Não é enfeite: uma conexão de horas
// carregaria PARA SEMPRE o retrato de permissões do instante em que foi aberta — quem saiu de um
// setor continuaria recebendo os avisos daquele setor até fechar o navegador. Reconectar é
// reautenticar (o cookie é conferido de novo) e reler os setores no banco. Sessão vencida no meio
// do caminho vira 401 na reconexão, e a tela manda a pessoa entrar de novo.
//
// ⛔ NADA DE CONTEÚDO DE CLIENTE VIAJA AQUI. O evento diz «a conversa N mudou, motivo X». A tela
// busca o resto pelas rotas normais, que já impõem a visibilidade. Ver a lei no cabeçalho de
// `ragnabot-tempo-real.service.js`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import * as aoVivo from '../services/ragnabot-tempo-real.service.js';
import { modeloPronto } from '../services/ragnabot-caixa.service.js';
import loggerGlobal from '../base/logger.js';

const router = Router();

const BATIMENTO_MS = Math.max(5_000, Number(process.env.RAGNABOT_AOVIVO_BATIMENTO_MS || 20_000));
const VIDA_MS = Math.max(60_000, Number(process.env.RAGNABOT_AOVIVO_VIDA_MS || 15 * 60 * 1000));
/** Teto de conexões por processo. Não é medo de carga: é a rede que impede um laço de reconexão
 *  (tela com defeito, extensão de navegador maluca) de consumir todos os descritores de arquivo do
 *  pod e derrubar o atendimento junto. Quem passar do teto recebe 503 e o recuo do cliente segura. */
const TETO_CONEXOES = Math.max(10, Number(process.env.RAGNABOT_AOVIVO_TETO || 200));

/**
 * ⭐ A CONEXÃO. Fica aberta; o servidor escreve quando há novidade.
 *
 * Formato de cada aviso (texto puro, uma linha `data:`):
 *     event: conversa
 *     data: {"v":1,"tipo":"conversa","motivo":"mensagem","cwConversationId":41,…}
 */
router.get('/ao-vivo', async (req, res) => {
  if (!modeloPronto()) {
    return res.status(503).json({ error: 'o índice da caixa não existe neste banco', code: 'MODELO_AUSENTE' });
  }
  if (aoVivo.conexoesAbertas() >= TETO_CONEXOES) {
    loggerGlobal.warn(`[ao-vivo] teto de ${TETO_CONEXOES} conexões atingido — recusando`);
    return res.status(503).json({ error: 'muitas conexões ao vivo neste servidor', code: 'TETO_CONEXOES' });
  }

  // Os setores são lidos DO BANCO, aqui, a cada abertura. Nunca do corpo, nunca do cabeçalho —
  // é este número que decide qual fila a pessoa enxerga.
  let setores = [];
  try {
    setores = await aoVivo.setoresDe(req.user);
  } catch (e) {
    loggerGlobal.warn(`[ao-vivo] não consegui ler os setores de ${req.user?.id}: ${e.message}`);
    return res.status(503).json({ error: 'não consegui resolver a sua visibilidade agora', code: 'SETORES_INDISPONIVEIS' });
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // `no-transform` também: sem ele, um intermediário pode comprimir a resposta e reintroduzir
    // a buferização que o cabeçalho de baixo acabou de desligar.
    'Cache-Control': 'no-cache, no-store, no-transform',
    Connection: 'keep-alive',
    // ⭐ A LINHA QUE FAZ SSE FUNCIONAR ATRÁS DOS DOIS NGINX. Ver a armadilha (a) no cabeçalho.
    'X-Accel-Buffering': 'no',
  });
  // Sem `flushHeaders` o Express só envia os cabeçalhos junto com o primeiro corpo — e o navegador
  // fica com a conexão em «pendente», sem disparar `onopen`, até o primeiro evento existir.
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  // Um soquete de SSE é ocioso por natureza; o tempo limite padrão do Node o mataria.
  req.socket?.setTimeout?.(0);
  req.socket?.setNoDelay?.(true);
  req.socket?.setKeepAlive?.(true);

  let vivo = true;
  const escrever = (texto) => {
    if (!vivo) return;
    try { res.write(texto); } catch { vivo = false; }
  };

  // `retry` diz ao navegador quanto esperar antes de reconectar. O recuo exponencial de verdade é
  // do nosso cliente (`web/src/lib/ao-vivo.js`) — este é só o piso, para o caso de o navegador
  // reconectar sozinho.
  escrever('retry: 3000\n\n');

  const envio = (evento) => {
    if (evento === null) { // desligamento do processo
      escrever('event: adeus\ndata: {"motivo":"servidor encerrando"}\n\n');
      return;
    }
    escrever(`id: ${evento.id}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);
  };

  const inscricao = aoVivo.assinar({ user: req.user, setores, envio });

  // ⭐ O PRIMEIRO EVENTO É «PRONTO», e ele é o que fecha o item 5 do contrato: a tela recarrega
  // TUDO ao receber isto. Como ele chega em toda abertura — a primeira e cada reconexão — o que
  // se perdeu enquanto o cano estava quebrado é recuperado pela leitura normal, que é a fonte de
  // verdade. Guardar um histórico de eventos por pod para «reenviar o que faltou» seria pior:
  // o navegador pode reconectar no OUTRO pod, que não tem esse histórico, e aí a recuperação
  // falharia justamente no caso em que ela importa.
  escrever(`event: pronto\ndata: ${JSON.stringify({
    v: aoVivo.VERSAO_EVENTO,
    em: new Date().toISOString(),
    setores: setores.length,
    batimentoMs: BATIMENTO_MS,
    vidaMs: VIDA_MS,
  })}\n\n`);

  const batimento = setInterval(() => {
    // Comentário de SSE (linha iniciada por `:`): o navegador o ignora, o nginx conta como dado.
    escrever(`: batimento ${new Date().toISOString()}\n\n`);
  }, BATIMENTO_MS);
  if (typeof batimento.unref === 'function') batimento.unref();

  const validade = setTimeout(() => {
    escrever('event: recomecar\ndata: {"motivo":"validade da conexão"}\n\n');
    encerrar();
  }, VIDA_MS);
  if (typeof validade.unref === 'function') validade.unref();

  function encerrar() {
    if (!vivo) return;
    vivo = false;
    clearInterval(batimento);
    clearTimeout(validade);
    inscricao.cancelar();
    try { res.end(); } catch { /* já fechou */ }
  }

  req.on('close', encerrar);
  req.on('error', encerrar);
  res.on('error', encerrar);
  return undefined;
});

/**
 * Diagnóstico: quantas conexões, que canal, quantos avisos. Sem segredo nenhum.
 * ⚠️ NÃO devolve quem está conectado — só quantos e há quanto tempo. Saber que «o atendente
 * fulano está com a tela aberta» não é dado que uma tela de diagnóstico precise vazar.
 */
router.get('/estado', (req, res) => res.json(aoVivo.estadoDoTempoReal()));

export default router;
