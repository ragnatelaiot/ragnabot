// ════════════════════════════════════════════════════════════════════════════════════════════════
// WEBHOOK DO RAGNABOT (Chatwoot) — a PORTA DE ENTRADA do atendimento.
//
// COMO O RAGNABOT É AVISADO: no Chatwoot, cada Account (= uma empresa nossa) tem um webhook
// apontando para cá. Ele dispara em `conversation_created`, `message_created`,
// `conversation_status_changed`, etc.
//
// O QUE ESTA ROTA FAZ:
//   • emite o PROTOCOLO quando a conversa nasce (RGT-0000000001, sequência da empresa);
//   • registra a AUDITORIA de início/fim de atendimento;
//   • ⭐ ENTREGA A MENSAGEM DO CLIENTE À PORTARIA (contrato S-PORTARIA, 02/09/2026) — é o elo que
//     faltava. `atenderMensagemRecebida()` existia, estava testada, e NINGUÉM a chamava: o cliente
//     mandava "oi" e o motor de fluxo inteiro nunca era acionado. A corrente agora é
//     `Chatwoot → webhook → portaria → fila → motor → canal → cliente`.
//
// A PONTE empresa↔plataforma é `RagnabotTenant.cwAccountId` (1 empresa = 1 Account). Evento de
// account que não é nossa é DESCARTADO com registro — nunca cria protocolo nem aciona fluxo para
// empresa desconhecida.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO ARMADILHAS QUE A LIGAÇÃO COM A PORTARIA EXISTE PARA EVITAR
//
// 1. O ROBÔ CONVERSANDO SOZINHO. Toda mensagem que o motor envia volta como webhook
//    (`message_created`, `outgoing`). Se ela realimentar o fluxo, o robô responde à própria
//    resposta, para sempre, gastando a janela de 24 h e a paciência do cliente. Por isso a
//    classificação é POSITIVA (`classificarEvento`): só `incoming` + não-privada + remetente que
//    não é agente vira `resposta_cliente`. Todo o resto é gravado com outra classe e não acorda nó
//    nenhum. **Identidade nunca é inferida por ausência** (doc 28 §5.1).
//
// 2. A NOTA INTERNA VIRANDO RESPOSTA DO CLIENTE. `private:true` é o atendente falando com o time.
//    Sem a guarda, uma nota "cliente é chato" seria consumida como escolha de menu.
//
// 3. A REENTREGA VIRANDO SEGUNDA CONVERSA. O Chatwoot reentrega quando não recebe 2xx — e
//    reentregar é o comportamento DESEJADO. A idempotência mora em duas camadas já prontas:
//    `RagnabotFluxoEntrada.chave` (única, calculada a partir do `id` da mensagem) e
//    `RagnabotFluxoFila.chaveIdem`. Aqui só passamos o `mensagemId`, que é o que torna a chave
//    estável; a portaria devolve `duplicada` e nada é enfileirado de novo.
//
// 4. O 500 QUE ENTOPE A FILA DO CHATWOOT. Erro NOSSO (política ausente, motor sem porta) não pode
//    virar 500: o Chatwoot reentregaria para sempre um evento que vai falhar sempre. A regra desta
//    rota é: **a mensagem foi GRAVADA → 2xx, sempre**, mesmo que o resto tenha degradado; a
//    mensagem NÃO foi gravada → 503, porque aí reentregar é a única forma de não perdê-la.
//    (Isto NÃO afrouxa o §1.2/(2) do doc 28: continua valendo "2xx só depois de gravar".)
//
// SEGURANÇA: valida um segredo compartilhado (comparação resistente a timing).
// ⚠️ PENDÊNCIA CONHECIDA, NÃO FECHADA AQUI (doc 28 §5.2): o desenho pede segredo POR CAIXA/EMPRESA
// (`RagnabotFluxoWebhookSegredo`, tabela já no schema) e SÓ por cabeçalho — hoje é um segredo
// global aceito também por query string. `RagnabotFluxoWebhookSegredo` não tem NENHUMA escrita no
// repositório (medido: zero usos em `src/` e `web/`), então implementar só a verificação criaria
// código morto e derrubaria a única credencial que funciona. Fica declarado, não maquiado.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import crypto from 'node:crypto';
import prismaGlobal from '../base/db.js';
import * as protocolo from '../services/ragnabot-protocolo.service.js';
import * as auditoria from '../services/ragnabot-auditoria.service.js';
import * as portariaModulo from '../services/ragnabot-portaria.service.js';
import loggerGlobal from '../base/logger.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS — mesma injeção do resto da casa. Não é ponto de bifurcação de comportamento: o teste
// injeta OUTRA implementação das MESMAS portas, nunca outro caminho de código.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  portaria: portariaModulo,
  protocolo,
  auditoria,
  log: loggerGlobal,
};

export function configurarWebhook(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no webhook: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoWebhook() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONTADORES — o que o `/saude` mostra.
//
// ⚠️ Sem isto, "o robô não responde" não tem onde ser olhado: o evento entra, é descartado por uma
// regra correta (ou por uma errada) e some. `descartados` por motivo é o que distingue "ninguém
// escreveu" de "estamos descartando tudo o que chega".
// ────────────────────────────────────────────────────────────────────────────────────────────────
const contadores = {
  recebidos: 0,
  aceitos: 0,          // viraram entrada gravada pela portaria
  descartados: 0,      // regra nossa disse "não é para o fluxo"
  contaDesconhecida: 0,
  degradados: 0,       // gravou, mas o resto falhou (a mensagem NÃO se perdeu)
  naoGravados: 0,      // nem gravou → devolvemos 503 e o Chatwoot reentrega
  porMotivo: Object.create(null),
  ultimoEm: null,
  ultimoErro: null,
};
function contar(campo, motivo = null) {
  contadores[campo] += 1;
  if (motivo) contadores.porMotivo[motivo] = (contadores.porMotivo[motivo] ?? 0) + 1;
}
export function estatisticasDoWebhook() {
  return { ...contadores, porMotivo: { ...contadores.porMotivo } };
}
export function zerarEstatisticasDoWebhook() {
  contadores.recebidos = 0; contadores.aceitos = 0; contadores.descartados = 0;
  contadores.contaDesconhecida = 0; contadores.degradados = 0; contadores.naoGravados = 0;
  contadores.porMotivo = Object.create(null);
  contadores.ultimoEm = null; contadores.ultimoErro = null;
}

// Comparação de segredo resistente a timing — mesmo padrão do webhook do Zabbix e da cobrança.
function segredoConfere(recebido) {
  const esperado = process.env.RAGNABOT_WEBHOOK_SEGREDO || '';
  if (!esperado) return null; // null = não configurado (recusa com log claro)
  const a = Buffer.from(String(recebido || ''));
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function tenantDaAccount(cwAccountId) {
  if (cwAccountId == null) return null;
  const n = Number(cwAccountId);
  if (!Number.isInteger(n)) return null;
  return db().ragnabotTenant.findUnique({ where: { cwAccountId: n } });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DO EVENTO — função PURA, exportada, e é a regra inteira num lugar só.
//
// Doc 28 §5.1, tabela "evento → classe". Traduzida para o corpo REAL do Chatwoot 4.x, com as
// tolerâncias que o corpo real exige:
//
//   · `message_type` chega como texto ('incoming') na maioria das versões e como INTEIRO (0/1/2/3)
//     quando o serializador usa `*_before_type_cast`. Aceitar só o texto faria toda mensagem de
//     cliente virar "controle" — o robô ficaria mudo e o log diria que estava tudo certo.
//   · `conversation.id` do webhook é o `display_id` (Chatwoot serializa assim), que é EXATAMENTE o
//     identificador que a API v1 usa em `/conversations/:id`. Por isso ele é o `cwConversationId`
//     da casa inteira, e é o mesmo que o protocolo já grava. Não confundir com `conversation_id`
//     interno, que não serve para chamar a API.
//   · o remetente agente vem com `sender.type = 'user'` (e `'agent_bot'` para bot). Contato não
//     traz `type` em algumas versões — por isso a checagem é NEGATIVA sobre o agente e a decisão
//     principal continua sendo `incoming`, que no Chatwoot só existe vindo do contato.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Os valores de `message_type` do Chatwoot, nas duas formas em que ele os serializa. */
const TIPOS_MENSAGEM = Object.freeze({
  0: 'incoming', 1: 'outgoing', 2: 'activity', 3: 'template',
  incoming: 'incoming', outgoing: 'outgoing', activity: 'activity', template: 'template',
});

function tipoDeMensagem(valor) {
  if (valor === null || valor === undefined) return null;
  return TIPOS_MENSAGEM[valor] ?? TIPOS_MENSAGEM[String(valor)] ?? null;
}

/** Aceita ISO, epoch em segundos e epoch em milissegundos. O Chatwoot manda os três, conforme a
 *  versão e o serializador — e um carimbo lido errado desloca a ordenação da rajada em 55 anos. */
export function carimboDeOrigem(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number' || /^\d+$/.test(String(valor))) {
    const n = Number(valor);
    // Menos de 10^11 é segundo (até o ano 5138); acima é milissegundo.
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

const inteiroOuNulo = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * O QUE ESTE EVENTO É, e o que fazer com ele.
 *
 * @returns {{acao:'portaria'|'protocolo'|'encerramento'|'nada', classe:string|null,
 *            motivo:string, cwAccountId:number|null, cwConversationId:number|null, ...}}
 */
export function classificarEvento(evt = {}) {
  const tipo = String(evt.event || '');
  const conv = evt.conversation || {};
  const cwAccountId = inteiroOuNulo(evt.account?.id ?? conv.account_id ?? evt.inbox?.account_id ?? evt.account_id);
  // `conv.id` primeiro: no `message_created` ele já é o display_id. `evt.id` no topo é o id da
  // MENSAGEM, nunca da conversa — usá-lo aqui misturaria duas numerações e o protocolo casaria com
  // a conversa errada.
  const cwConversationId = inteiroOuNulo(conv.id ?? conv.display_id ?? evt.display_id ?? (tipo.startsWith('conversation') ? evt.id : null));
  const cwInboxId = inteiroOuNulo(evt.inbox?.id ?? conv.inbox_id ?? evt.inbox_id);

  const base = { tipo, cwAccountId, cwConversationId, cwInboxId };

  if (tipo === 'conversation_created') {
    return { ...base, acao: 'protocolo', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'conversa_nasceu' };
  }
  if (tipo === 'conversation_status_changed' || tipo === 'conversation_resolved') {
    return { ...base, acao: 'encerramento', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `status:${conv.status ?? '?'}`, status: conv.status ?? null };
  }

  if (tipo !== 'message_created') {
    // `message_updated`, `conversation_updated`, `webwidget_triggered`, `contact_updated`… Nada
    // disso responde nó, e inventar comportamento para evento não medido é como se cria laço.
    return { ...base, acao: 'nada', classe: null, motivo: `evento_sem_acao:${tipo || 'vazio'}` };
  }

  // ── daqui para baixo: message_created ────────────────────────────────────────────────────────
  const mt = tipoDeMensagem(evt.message_type);
  const privada = evt.private === true || evt.private === 'true';
  const remetente = String(evt.sender?.type ?? evt.sender_type ?? '').toLowerCase();
  const marcaNossa = evt.content_attributes?.rgt_efeito ?? null;

  const campos = {
    ...base,
    mensagemId: inteiroOuNulo(evt.id),
    wamid: evt.source_id ? String(evt.source_id) : null,
    texto: typeof evt.content === 'string' ? evt.content : (evt.content == null ? '' : String(evt.content)),
    origemEm: carimboDeOrigem(evt.created_at),
    cwContactId: inteiroOuNulo(evt.sender?.id ?? conv.meta?.sender?.id),
    contatoChave: evt.sender?.phone_number ?? evt.sender?.identifier
      ?? conv.meta?.sender?.phone_number ?? null,
    anexos: Array.isArray(evt.attachments) ? evt.attachments.map((a) => ({
      tipo: a?.file_type ?? null, url: a?.data_url ?? a?.file_url ?? null,
    })) : [],
    interativo: evt.content_attributes?.submitted_values ?? null,
    marcaNossa: marcaNossa ? String(marcaNossa) : null,
  };

  // ARMADILHA 2 — nota interna NUNCA é resposta de cliente, venha de onde vier.
  if (privada) {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'nota_interna' };
  }
  // ARMADILHA 1 — o eco da NOSSA própria mensagem. Identidade por MARCA, não por ausência.
  if (mt === 'outgoing' && campos.marcaNossa) {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.ECO_PROPRIO, motivo: 'eco_do_motor' };
  }
  // Saída SEM a nossa marca = gente digitou. Registra (é o sinal de takeover do doc 28 §5.1), não
  // aciona nó. ⚠️ A TRANSIÇÃO para `pausado_humano` ainda NÃO está implementada — fica registrada.
  if (mt === 'outgoing') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: 'saida_humana' };
  }
  // `activity` (mudou de status, atribuiu) e `template` não são fala de cliente.
  if (mt === 'activity' || mt === 'template') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `mensagem_${mt}` };
  }
  // Tipo que não sabemos ler: trata como controle. Adivinhar aqui é o que faz o robô responder ao
  // que não é pergunta.
  if (mt !== 'incoming') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `message_type_desconhecido:${evt.message_type}` };
  }
  // Entrada, mas assinada por agente/bot: não é o cliente. Cinto e suspensório sobre o `incoming`.
  if (remetente === 'user' || remetente === 'agent_bot') {
    return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.CONTROLE, motivo: `remetente:${remetente}` };
  }

  return { ...campos, acao: 'portaria', classe: portariaModulo.CLASSES_ENTRADA.RESPOSTA_CLIENTE, motivo: 'mensagem_do_cliente' };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A ROTA
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const token = req.get('x-ragnabot-token') || req.query.token;
  const ok = segredoConfere(token);
  if (ok === null) {
    log().error('[ragnabot-webhook] RAGNABOT_WEBHOOK_SEGREDO vazio — recusado');
    return res.status(503).json({ error: 'webhook não configurado' });
  }
  if (!ok) {
    log().warn(`[ragnabot-webhook] token inválido (ip=${req.ip})`);
    return res.status(401).json({ error: 'não autorizado' });
  }

  contadores.recebidos += 1;
  contadores.ultimoEm = new Date().toISOString();

  const evt = req.body || {};
  let c;
  try {
    c = classificarEvento(evt);
  } catch (e) {
    // Classificar é função pura sobre JSON de terceiro. Se ela estourar, o corpo é malformado —
    // reentregar não conserta corpo malformado. Descarta com registro e devolve 2xx.
    contar('descartados', 'corpo_ilegivel');
    contadores.ultimoErro = `classificacao:${e.message}`;
    log().warn(`[ragnabot-webhook] corpo ilegível: ${e.message}`);
    return res.json({ ok: true, descartado: 'corpo ilegível' });
  }

  // ── MULTI-INQUILINO: a empresa sai do evento, e conta desconhecida NUNCA é processada ────────
  let tenant = null;
  try {
    tenant = await tenantDaAccount(c.cwAccountId);
  } catch (e) {
    // O banco fora é o único caso em que vale reentregar: não gravamos nada.
    contar('naoGravados', 'banco_fora');
    contadores.ultimoErro = `tenant:${e.message}`;
    log().error(`[ragnabot-webhook] não consegui resolver a empresa da account ${c.cwAccountId}: ${e.message}`);
    return res.status(503).json({ error: 'indisponível; reenvie', code: 'BANCO_FORA' });
  }
  if (!tenant) {
    contar('contaDesconhecida', 'empresa_nao_mapeada');
    log().warn(`[ragnabot-webhook] evento ${c.tipo} de account ${c.cwAccountId} sem empresa mapeada — descartado`);
    // 2xx: não é erro nosso e reentregar não mudaria nada. Não deve virar fila de repetição.
    return res.json({ ok: true, descartado: 'empresa não mapeada', account: c.cwAccountId });
  }

  // ── MENSAGEM: o caminho novo, o do cliente ───────────────────────────────────────────────────
  if (c.acao === 'portaria') {
    if (c.cwConversationId === null) {
      contar('descartados', 'sem_conversa');
      log().warn(`[ragnabot-webhook] ${c.tipo} sem conversa identificável (empresa ${tenant.slug}) — descartado`);
      return res.json({ ok: true, descartado: 'sem conversa' });
    }

    let r;
    try {
      r = await portas.portaria.atenderMensagemRecebida({
        tenantId: tenant.id,
        cwAccountId: c.cwAccountId,
        cwConversationId: c.cwConversationId,
        cwInboxId: c.cwInboxId,
        texto: c.texto,
        mensagemId: c.mensagemId,
        evento: c.tipo,
        classe: c.classe,
        wamid: c.wamid,
        origemEm: c.origemEm,
        interativo: c.interativo,
        anexos: c.anexos,
        cwContactId: c.cwContactId,
        contatoChave: c.contatoChave,
      });
    } catch (e) {
      // ⚠️ ÚNICO caminho de não-2xx do fluxo de mensagem. A portaria só propaga quando NÃO
      // CONSEGUIU GRAVAR a entrada (P2002 ela mesma trata). Aí reentregar é a única forma de a
      // mensagem do cliente não sumir em silêncio — que é o defeito que o §1.2/(2) fecha.
      contar('naoGravados', 'portaria_nao_gravou');
      contadores.ultimoErro = `portaria:${e.message}`;
      log().error(`[ragnabot-webhook] a portaria não gravou a entrada (conversa ${c.cwConversationId}): ${e.message}`);
      return res.status(503).json({ error: 'não gravei; reenvie', code: 'NAO_GRAVADO' });
    }

    // Gravou. A partir daqui é SEMPRE 2xx — inclusive quando o resto degradou. O problema fica
    // visível no contador (e por ele no `/saude`) e no log, não na fila do Chatwoot.
    if (r?.ok === false && r?.resultado === portariaModulo.RESULTADOS_PORTARIA.DEGRADADA) {
      contar('degradados', `degradada:${String(r.motivo || '?').split(':')[0]}`);
      contadores.ultimoErro = `degradada:${r.motivo}`;
      log().warn(`[ragnabot-webhook] entrada gravada mas degradada (conversa ${c.cwConversationId}): ${r.motivo}`);
    } else if (r?.resultado === portariaModulo.RESULTADOS_PORTARIA.RECUSADA) {
      contar('descartados', 'endereco_incompleto');
    } else if (c.classe === portariaModulo.CLASSES_ENTRADA.RESPOSTA_CLIENTE) {
      contar('aceitos', `${c.motivo}→${r?.resultado}`);
    } else {
      contar('descartados', c.motivo);
    }

    return res.json({
      ok: true,
      classe: c.classe,
      motivo: c.motivo,
      resultado: r?.resultado ?? null,
      entradaId: r?.entradaId ?? null,
      execucaoId: r?.execucaoId ?? null,
      jobId: r?.jobId ?? null,
    });
  }

  // ── CONVERSA NASCEU: protocolo + auditoria (comportamento anterior, preservado) ──────────────
  //
  // ⚠️ 2xx SOMENTE DEPOIS DE GRAVAR. (Corrigido em 28/08/2026 — a versão anterior respondia 200
  // ANTES de processar, justificando com "o processamento é idempotente". O raciocínio estava
  // errado: idempotência protege contra DUPLICAR, não contra PERDER. Se o processo morresse entre
  // o 200 e a emissão do protocolo, o Chatwoot já teria recebido sucesso e NUNCA reenviaria —
  // aquele atendimento ficaria sem protocolo para sempre, em silêncio.)
  try {
    if (c.acao === 'protocolo') {
      if (c.cwConversationId === null) {
        contar('descartados', 'conversa_sem_id');
        return res.json({ ok: true, descartado: 'conversa sem id' });
      }
      const r = await portas.protocolo.emitirProtocolo({
        tenantId: tenant.id, cwAccountId: c.cwAccountId, cwConversationId: c.cwConversationId,
      });
      const proto = r.protocolo;
      if (r.novo) log().info(`[ragnabot-webhook] protocolo ${proto} emitido (empresa ${tenant.slug})`);

      // Auditoria de início — SOMENTE quando o protocolo é NOVO.
      // ⚠️ Sem este `if`, o reenvio do mesmo evento gravava um SEGUNDO "atendimento_iniciado" para
      // a mesma conversa. `r.novo` é a única fonte confiável de "isto aconteceu pela primeira vez":
      // vem do unique da conversa no banco.
      if (r.novo) {
        await portas.auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'sistema', categoria: 'atendimento', acao: 'atendimento_iniciado',
          protocolo: proto, entidade: 'conversation', entidadeId: String(c.cwConversationId),
          descricao: `Conversa ${c.cwConversationId} aberta`,
        });
      }
      contar('aceitos', 'protocolo');
      return res.json({ ok: true, protocolo: proto });
    }

    if (c.acao === 'encerramento') {
      if (c.status === 'resolved' || c.tipo === 'conversation_resolved') {
        const reg = await db().ragnabotProtocolo.findUnique({
          where: { cwAccountId_cwConversationId: { cwAccountId: Number(c.cwAccountId), cwConversationId: Number(c.cwConversationId) } },
        }).catch(() => null);
        await portas.auditoria.registrar({
          tenantId: tenant.id, atorTipo: 'agent',
          atorId: evt.assignee?.id ? String(evt.assignee.id) : null,
          atorNome: evt.assignee?.name || null,
          categoria: 'atendimento', acao: 'atendimento_encerrado',
          protocolo: reg?.protocolo || null, entidade: 'conversation', entidadeId: String(c.cwConversationId),
          descricao: `Conversa ${c.cwConversationId} encerrada`,
        });
        contar('aceitos', 'encerramento');
        return res.json({ ok: true });
      }
      contar('descartados', c.motivo);
      return res.json({ ok: true });
    }

    // Outros eventos (config, agentes) podem ser mapeados aqui conforme o Chatwoot os expuser.
    contar('descartados', c.motivo);
    log().debug(`[ragnabot-webhook] evento ${c.tipo} recebido (empresa ${tenant.slug}) — sem ação`);
    return res.json({ ok: true, semAcao: c.tipo });
  } catch (e) {
    // 503 = "não gravei, mande de novo". É o que transforma uma falha passageira (banco
    // reiniciando, rede piscando) em reenvio, em vez de evento perdido em silêncio. Vale só para o
    // caminho de protocolo/auditoria, que não tem gravação prévia da mensagem para se apoiar.
    contar('naoGravados', 'protocolo_ou_auditoria');
    contadores.ultimoErro = `${c.acao}:${e.message}`;
    log().error(`[ragnabot-webhook] erro ao processar ${c.tipo}: ${e.message}`);
    return res.status(503).json({ error: 'falha ao processar; reenvie' });
  }
});

export default router;
