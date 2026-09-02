// ════════════════════════════════════════════════════════════════════════════════════════════════
// PORTA DO CANAL — quem LEVA ao cliente o que o motor de fluxo decidiu dizer.
//
// Contrato S-ADAPTADOR (02/09/2026). A lacuna que este arquivo fecha foi medida, não suposta:
//   · `configurarMotor({ canal })` não era chamado em lugar nenhum do repositório;
//   · não existia NENHUMA implementação de `PortaCanal`.
// Ou seja: os nós montavam a mensagem, o motor reservava o efeito, e do outro lado não havia
// ninguém. Fluxo, Capitão e cobrança Pix funcionavam em teste e não funcionavam com cliente.
//
// ─── O CONTRATO QUE EU MEDI ANTES DE ESCREVER ───────────────────────────────────────────────────
// Está em três lugares e os três concordam:
//   1. `ragnabot-fluxo-motor.service.js` §PORTAS INJETÁVEIS declara
//      `canal: {portaDa:(execucao)=>Promise<PortaCanal>}` e, em `despacharEConfirmar()`, usa
//      exatamente dois métodos: `porta.lerConversa(cwConversationId)` (só para efeito
//      `condicional`, e ANTES do envio) e
//      `porta.enviar({...intencao, chaveEfeito}, {execucao, noId, visitaSeq})`.
//      O retorno de `enviar` é lido assim, e nada além disto:
//          `idExterno` | `wamid`  → grava em RagnabotFluxoEfeito.idExterno
//          `httpStatus`           → grava em RagnabotFluxoEfeito.httpStatus
//          `resumo`               → grava em RagnabotFluxoEfeito.resposta (NUNCA corpo cru)
//          `aguardarResultado:true` + `resultado` → o motor enfileira `continuar_http`
//   2. `ragnabot-fluxo-nos.service.js` — o cabeçalho de cada nó diz o que a intenção carrega. As
//      catorze que existem hoje: `texto · midia · lista · botoes · template · nota · etiqueta ·
//      atribuir · resolver · carimbar · http · email · agente_ia · cobranca_pix`.
//      Dois nós escrevem o contrato do adaptador com todas as letras:
//        · `agente_ia`  → chamar `capitao.responderPorIA({… pedidoDoNo:true})` e devolver
//                         `{aguardarResultado:true, resultado:{quem,texto,motivo,confianca}}`;
//                         se `quem==='capitao'`, o adaptador TAMBÉM manda o texto ao cliente,
//                         e mais ninguém manda nada nesta visita.
//        · `cobranca_pix` → chamar `criarCobrancaPix({…, chaveEfeito})`, trocar o marcador
//                         `{{pix_copia_e_cola}}` da `mensagemModelo` pelo código, mandar, e
//                         devolver `{idExterno: txid}`.
//   3. `ragnabot-atend-despertar.service.js` usa a MESMA porta (`portas.canal.portaDa`) com uma
//      intenção `{tipo:'texto'}`. Ou seja, esta porta serve ao motor E aos relógios de atendimento
//      — e é por isso que ela recebe tanto uma linha de execução quanto um alvo avulso.
//
// ─── O QUE A PLATAFORMA OFERECE (medido no código do Chatwoot 4.x, NÃO em produção) ─────────────
// Tudo sai por `ragnabot-chatwoot.porta.js`, que é onde mora o conhecimento da API. Aqui só se
// decide QUAL caminho usar. Resumo do que existe do outro lado:
//   · texto e nota interna → `POST …/messages` (`private` separa um do outro);
//   · interativo → `content_type:'input_select'` + `content_attributes.items`. O provedor do
//     WhatsApp Cloud traduz isso em botões (até 3) ou lista (acima disso); o widget do site
//     renderiza a escolha. Facebook, Instagram e Telegram NÃO traduzem;
//   · anexo → só `multipart/form-data` com o ARQUIVO. Não existe campo de URL;
//   · etiqueta → `POST …/labels` SUBSTITUI o conjunto (por isso lemos o atual antes);
//   · carimbo → `POST …/custom_attributes`.
//
// ⚠️ NÃO EXERCITADO EM PRODUÇÃO. Em 02/09/2026 o Ragnabot tem ZERO caixas de WhatsApp e zero
// conversas. Este arquivo é correto pelo contrato lido e pelos testes com dublê — não por
// observação. O primeiro atendimento real é o ensaio, e é assim que está escrito no relatório.
//
// ─── AS TRÊS REGRAS QUE ESTE ARQUIVO IMPÕE ──────────────────────────────────────────────────────
// R-A. DEGRADAÇÃO É DECLARADA, NUNCA SILENCIOSA. Canal que não desenha botão recebe o MESMO
//      conteúdo em texto numerado — e o retorno diz `degradado:'texto_numerado'`, o log avisa, e a
//      lista de opções continua casável pela escada de `casarOpcao` (que já aceita "1", "2", …).
//      Sumir com as opções seria pior que não mandar: o cliente lê uma pergunta sem alternativas.
// R-B. UMA INTENÇÃO, UMA MENSAGEM. A `chaveEfeito` é a identidade do envio. Antes de despachar,
//      conferimos memória do processo E a linha de `RagnabotFluxoEfeito`: efeito já `confirmado`
//      devolve o `idExterno` de antes SEM reenviar. É a mesma disciplina do Pix, pelo mesmo motivo
//      — cliente que recebe a cobrança duas vezes paga duas vezes.
// R-C. ERRO É CLASSIFICÁVEL. O motor separa FALHA (o destino disse não) de DÚVIDA (não sabemos se
//      chegou) lendo `e.status` e `e.code`. A camada da plataforma perde essa informação quando a
//      rede cai, então aqui ela é reposta — sem isso, toda queda de rede viraria "falha", o motor
//      rerrotearia por `erro` e o cliente receberia a mensagem E o desvio de erro.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';
import logger from '../base/logger.js';
import chatwootPadrao from './ragnabot-chatwoot.porta.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CAPACIDADE POR CANAL — a tabela que decide botão × texto numerado
//
// ⚠️ O PADRÃO É O CANAL MAIS POBRE. Um tipo de canal que eu não conheça cai em `desconhecido`, que
// só sabe texto. É de propósito: mandar `input_select` para um canal que não o traduz entrega ao
// cliente uma pergunta sem alternativas, e ele não tem como responder. Errar para o lado do texto
// numerado custa estética; errar para o outro lado custa o atendimento.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const CAPACIDADES = Object.freeze({
  whatsapp: { interativo: true, botoesMax: 3, listaMax: 10, anexo: true, template: true },
  web_widget: { interativo: true, botoesMax: 10, listaMax: 20, anexo: true, template: false },
  api: { interativo: true, botoesMax: 10, listaMax: 20, anexo: true, template: false },
  telegram: { interativo: false, botoesMax: 0, listaMax: 0, anexo: true, template: false },
  facebook: { interativo: false, botoesMax: 0, listaMax: 0, anexo: true, template: false },
  instagram: { interativo: false, botoesMax: 0, listaMax: 0, anexo: true, template: false },
  email: { interativo: false, botoesMax: 0, listaMax: 0, anexo: true, template: false },
  desconhecido: { interativo: false, botoesMax: 0, listaMax: 0, anexo: false, template: false },
});

/** A capacidade de um tipo de canal. Tipo que não está na tabela é tratado como `desconhecido`. */
export function capacidadeDoCanal(tipo) {
  return CAPACIDADES[String(tipo || '').toLowerCase()] || CAPACIDADES.desconhecido;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS — o teste troca implementação, nunca comportamento
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prisma,
  /** Onde mora TODO o conhecimento da API da plataforma. */
  chatwoot: chatwootPadrao,
  /** `ragnabot-capitao.service.js`. Carregado sob demanda para não criar ciclo de importação. */
  capitao: null,
  /** `ragnabot-pagamento-efi.service.js`. Idem. */
  pagamento: null,
  /** `enviarEmailDaIntencao` de `ragnabot-fluxo-nos.service.js`. Idem. */
  email: null,
  /** Egresso da casa para o nó `http`. NÃO existe serviço para isto no repositório — enquanto não
   *  existir, o nó `http` falha com mensagem clara em vez de este arquivo abrir um `fetch` sem
   *  guarda de destino, que transformaria o editor de fluxo em varredor da rede interna. */
  egresso: null,
  log: null,
};

const log = () => portas.log || logger;

/** Amarra as dependências. Chamada pelo processo (`servidor.js`) e pelo teste. */
export function configurarCanal(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida na PortaCanal: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoCanal();
}

/** Cópia rasa, para diagnóstico e teste. */
export function portasDoCanal() { return { ...portas }; }

async function capitao() {
  if (portas.capitao) return portas.capitao;
  portas.capitao = await import('./ragnabot-capitao.service.js');
  return portas.capitao;
}
async function pagamento() {
  if (portas.pagamento) return portas.pagamento;
  portas.pagamento = await import('./ragnabot-pagamento-efi.service.js');
  return portas.pagamento;
}
async function portaDeEmail() {
  if (portas.email) return portas.email;
  const nos = await import('./ragnabot-fluxo-nos.service.js');
  portas.email = { enviarEmailDaIntencao: nos.enviarEmailDaIntencao };
  return portas.email;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// R-B — IDEMPOTÊNCIA DE ENVIO
//
// Duas camadas, e as duas precisam existir:
//   1. MEMÓRIA DO PROCESSO: pega a repetição imediata — dois trabalhos da mesma partição chegando
//      quase juntos, ou uma retentativa dentro do mesmo pod. É a única que preserva o retorno
//      inteiro (inclusive `aguardarResultado`), porque ela guarda o objeto.
//   2. A LINHA DO EFEITO: pega a repetição DEPOIS de um reinício. Se o efeito já está `confirmado`,
//      a mensagem saiu — reenviar seria a segunda mensagem ao cliente.
//
// ⚠️ Só a camada 1 não bastaria (pod novo esquece), e só a 2 não bastaria (entre a reserva e a
// confirmação o status é `reservado`, e duas chamadas simultâneas passariam as duas).
// ────────────────────────────────────────────────────────────────────────────────────────────────
const MEMORIA_MS = 10 * 60 * 1000;
const memoria = new Map(); // chaveEfeito -> { resultado, quando }

/** Esquece os envios memorizados. Existe para o teste e para o desligamento. */
export function esquecerEnvios() { memoria.clear(); }

function lembrar(chave, resultado) {
  if (!chave) return resultado;
  memoria.set(chave, { resultado, quando: Date.now() });
  // Poda barata: sem ela, um pod de 30 dias guarda toda chave que já passou.
  if (memoria.size > 5000) {
    const limite = Date.now() - MEMORIA_MS;
    for (const [k, v] of memoria) if (v.quando < limite) memoria.delete(k);
  }
  return resultado;
}

async function jaEnviado(chave) {
  if (!chave) return null;
  const guardado = memoria.get(chave);
  if (guardado && Date.now() - guardado.quando < MEMORIA_MS) {
    return { ...guardado.resultado, reaproveitado: true, resumo: 'ja enviado (memoria do processo)' };
  }
  try {
    const linha = await portas.db.ragnabotFluxoEfeito.findUnique({ where: { chave } });
    if (linha?.status === 'confirmado') {
      // ⚠️ NÃO devolve `aguardarResultado`. Efeito confirmado significa que a continuação já foi
      // enfileirada uma vez; repetir aqui criaria um segundo trabalho para a mesma visita.
      return {
        idExterno: linha.idExterno ?? null,
        httpStatus: linha.httpStatus ?? null,
        resumo: 'ja enviado (efeito confirmado)',
        reaproveitado: true,
      };
    }
  } catch (e) {
    // Banco indisponível não pode IMPEDIR o envio — mas tem de aparecer. Sem esta linha, a proteção
    // some em silêncio no dia em que mais faria falta.
    log().warn?.(`[canal] não consegui conferir idempotência de ${String(chave).slice(0, 12)}…: ${e.message}`);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// R-A — DEGRADAÇÃO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O MESMO conteúdo de uma lista/botões, em texto numerado.
 *
 * A numeração não é enfeite: `casarOpcao` (a escada de casamento do motor) aceita o número da
 * posição, então "2" continua caindo na segunda opção — exatamente como o toque no botão cairia.
 * Sem o número, a única saída do cliente seria escrever o rótulo inteiro, e "opção inválida" viraria
 * o caminho normal.
 */
export function textoNumerado({ cabecalho = null, corpo = '', rodape = null, itens = [], rotuloBotao = null } = {}) {
  const linhas = [];
  if (cabecalho) linhas.push(String(cabecalho));
  if (corpo) linhas.push(String(corpo));
  const opcoes = (Array.isArray(itens) ? itens : []).filter(Boolean);
  if (opcoes.length) {
    linhas.push('');
    opcoes.forEach((o, i) => {
      const rotulo = String(o.titulo ?? o.rotulo ?? '').trim();
      const descricao = o.descricao ? ` — ${String(o.descricao).trim()}` : '';
      // Botão de URL não vira número: ele leva para fora, e um número que não é escolha confunde.
      if (o.tipo === 'url' && o.url) linhas.push(`${rotulo}: ${o.url}`);
      else linhas.push(`${i + 1}. ${rotulo}${descricao}`);
    });
    const temEscolha = opcoes.some((o) => o.tipo !== 'url');
    if (temEscolha) {
      linhas.push('');
      linhas.push(rotuloBotao ? `${rotuloBotao} — responda com o número da opção.` : 'Responda com o número da opção.');
    }
  }
  if (rodape) { linhas.push(''); linhas.push(String(rodape)); }
  return linhas.join('\n').trim();
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// R-C — CLASSIFICAÇÃO DE ERRO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Sinais de que o destino recusou POR JANELA DE 24 H — a única recusa que tem saída própria
 *  (`sem_janela`) no motor e no despertar. 131047 é o código da Meta para "reengajamento". */
const SINAIS_DE_JANELA = [/131047/u, /re-?engagement/iu, /24[\s-]?hour/iu, /fora da janela/iu, /janela de 24/iu];

/**
 * Repõe no erro o que a camada da plataforma perdeu, para o motor conseguir classificar.
 *
 * ⚠️ "Falha de rede" vira DÚVIDA, e a escolha é deliberada: quando a conexão cai não se sabe se a
 * requisição chegou. Tratar como falha faria o motor rerotear pela saída `erro` — e, se a mensagem
 * tiver saído, o cliente recebe a mensagem E o desvio de erro. Dúvida congela e chama gente, que é
 * mais caro e é honesto.
 */
export function normalizarErroDeCanal(e, contexto = '') {
  if (!e || typeof e !== 'object') return e;
  const texto = `${e.message || ''} ${typeof e.corpo === 'string' ? e.corpo : JSON.stringify(e.corpo || {})}`;
  if (SINAIS_DE_JANELA.some((r) => r.test(texto))) {
    e.foraDaJanela = true;
    return e;
  }
  const semStatus = e.status === null || e.status === undefined;
  if (semStatus && /falha de rede|network|socket|econn|timeout|abort/iu.test(String(e.message || ''))) {
    e.code = e.code || 'ECONNRESET';
  }
  if (contexto && !String(e.message).includes(contexto)) e.message = `${contexto}: ${e.message}`;
  return e;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DESCOBERTA DO CANAL
//
// A linha de execução NÃO guarda o tipo de canal (conferido no schema: `RagnabotFluxoExecucao` tem
// conta, conversa e contato, e nada de caixa de entrada). Então o tipo vem da CONVERSA → caixa de
// entrada → `RagnabotInbox.channelType`. É uma chamada de rede por conversa, e por isso o cache
// curto: numa marcha de cinco nós seriam cinco leituras da mesma conversa.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const CACHE_CANAL_MS = 60_000;
const cacheCanal = new Map(); // "conta:conversa" -> { info, quando }

/** Esquece o canal descoberto. Para o teste, e para depois de trocar a conexão de uma empresa. */
export function esquecerCanais() { cacheCanal.clear(); }

async function descobrirCanal({ cwAccountId, cwConversationId, tenantId }) {
  const chave = `${cwAccountId}:${cwConversationId}`;
  const guardado = cacheCanal.get(chave);
  if (guardado && Date.now() - guardado.quando < CACHE_CANAL_MS) return guardado.info;

  let info = { tenantId: tenantId ?? null, channelType: 'desconhecido', cwInboxId: null, nome: null, phoneNumberId: null };
  try {
    const caixa = await portas.chatwoot?.caixaDaConversa?.({ cwAccountId, cwConversationId });
    if (caixa) {
      info = {
        tenantId: caixa.tenantId ?? tenantId ?? null,
        channelType: caixa.channelType || 'desconhecido',
        cwInboxId: caixa.cwInboxId ?? null,
        nome: caixa.nome ?? null,
        phoneNumberId: caixa.phoneNumberId ?? null,
      };
    }
  } catch (e) {
    // ⚠️ NÃO LANÇA. Não saber o tipo de canal não pode impedir o envio de TEXTO, que é o que
    // funciona em todo canal. O que muda é a capacidade: sem saber, degrada para texto numerado.
    log().warn?.(`[canal] não descobri o canal da conversa ${chave}: ${e.message} — tratando como o canal mais pobre`);
  }
  cacheCanal.set(chave, { info, quando: Date.now() });
  return info;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// OS DESPACHOS, UM POR TIPO DE INTENÇÃO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A nossa marca no destino. `RagnabotFluxoEfeito.chave` diz, no schema: "é TAMBÉM o `rgt_efeito`
 *  que viaja em content_attributes da mensagem". Conciliar é procurar a NOSSA chave. */
function marca(intencao) {
  return intencao?.chaveEfeito ? { rgt_efeito: String(intencao.chaveEfeito) } : {};
}

function exigirChatwoot(metodo) {
  const cw = portas.chatwoot;
  if (!cw || typeof cw[metodo] !== 'function') {
    const e = new Error(`a porta do Chatwoot não expõe ${metodo}() — o canal está indisponível`);
    e.code = 'ECONNREFUSED'; // dúvida: não falamos com o destino, então não sabemos nada dele
    throw e;
  }
  return cw;
}

async function despacharTexto(intencao, alvo) {
  const cw = exigirChatwoot('enviarMensagem');
  const r = await cw.enviarMensagem({
    cwAccountId: alvo.cwAccountId,
    cwConversationId: alvo.cwConversationId,
    tenantId: alvo.tenantId,
    texto: String(intencao.corpo ?? ''),
    atributosConteudo: marca(intencao),
  });
  return { idExterno: r?.id ?? null, resumo: 'texto enviado' };
}

async function despacharMidia(intencao, alvo, capacidade) {
  const legenda = intencao.legenda ?? null;
  if (!capacidade.anexo) {
    // Degradação declarada: o canal (ou o canal desconhecido) não carrega arquivo. Mandar o link é
    // pior que mandar o arquivo e MUITO melhor que engolir a mídia — o cliente ainda alcança o
    // conteúdo, e o retorno registra que houve degradação.
    const cw = exigirChatwoot('enviarMensagem');
    const texto = [legenda, intencao.url].filter(Boolean).join('\n');
    const r = await cw.enviarMensagem({
      cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
      texto, atributosConteudo: marca(intencao),
    });
    log().warn?.(`[canal] mídia degradada para link no canal "${capacidade === CAPACIDADES.desconhecido ? 'desconhecido' : 'sem anexo'}"`);
    return { idExterno: r?.id ?? null, resumo: 'midia degradada para link', degradado: 'link_no_texto' };
  }
  const cw = exigirChatwoot('enviarAnexo');
  const r = await cw.enviarAnexo({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    url: intencao.url, legenda,
  });
  return { idExterno: r?.id ?? null, resumo: `midia enviada (${r?.bytes ?? '?'} bytes)` };
}

/**
 * Lista e botões — o ponto onde a degradação por canal acontece de verdade.
 *
 * Três casos, e os três estão medidos no nó:
 *  · `modo:'url'` (botão que leva a um link) NÃO tem equivalente em `input_select`. Vai como texto
 *    com o endereço, em todo canal — inclusive no WhatsApp. Fingir botão aqui entregaria um item
 *    que a pessoa toca e não acontece nada.
 *  · canal sem interativo → texto numerado.
 *  · itens acima do teto do canal → o nó já recusa na publicação e em `executar()`; se ainda assim
 *    chegar aqui (fluxo publicado com o bloqueio contornado), degradamos em vez de deixar a
 *    plataforma recusar a mensagem inteira.
 */
async function despacharEscolha(intencao, alvo, capacidade) {
  const cw = exigirChatwoot('enviarMensagem');
  const itens = intencao.tipo === 'lista'
    ? (Array.isArray(intencao.itens) ? intencao.itens : [])
    : (Array.isArray(intencao.botoes) ? intencao.botoes : []);
  const temUrl = intencao.modo === 'url' || intencao.modo === 'misto' || itens.some((i) => i.tipo === 'url');
  const teto = intencao.tipo === 'lista' ? capacidade.listaMax : capacidade.botoesMax;
  const cabeNoCanal = capacidade.interativo && !temUrl && itens.length > 0 && itens.length <= teto;

  if (cabeNoCanal) {
    const cwI = exigirChatwoot('enviarInterativo');
    const r = await cwI.enviarInterativo({
      cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
      // Cabeçalho e rodapé não têm campo próprio no `input_select` do Chatwoot: entram no corpo, na
      // ordem em que aparecem no celular. Perder o cabeçalho seria perder a pergunta.
      corpo: [intencao.cabecalho, intencao.corpo, intencao.rodape].filter(Boolean).join('\n\n'),
      itens,
      atributosConteudo: marca(intencao),
    });
    return { idExterno: r?.id ?? null, resumo: `${intencao.tipo} interativa enviada (${itens.length} opções)` };
  }

  const motivo = temUrl ? 'botao_de_url' : (!capacidade.interativo ? 'canal_sem_interativo' : 'itens_acima_do_teto');
  const texto = textoNumerado({
    cabecalho: intencao.cabecalho, corpo: intencao.corpo, rodape: intencao.rodape,
    itens, rotuloBotao: intencao.rotuloBotao,
  });
  const r = await cw.enviarMensagem({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    texto, atributosConteudo: marca(intencao),
  });
  log().info?.(`[canal] ${intencao.tipo} degradada para texto numerado (${motivo})`);
  return { idExterno: r?.id ?? null, resumo: `${intencao.tipo} em texto numerado (${motivo})`, degradado: 'texto_numerado', motivoDegradacao: motivo };
}

/**
 * Template aprovado da Meta — o único caminho que existe FORA da janela de 24 h.
 *
 * ⚠️ DUAS FORMAS DIFERENTES na mesma intenção, e confundi-las é mandar aviso interno para o cliente:
 *  · SEM `destinatario` → é para o cliente DESTA conversa;
 *  · COM `destinatario` → é aviso ao pessoal da casa, para um número que NÃO está nesta conversa.
 *    Esse segundo caminho exige falar direto com a Cloud API, e não temos essa peça. Recusa
 *    declarada, com mensagem que diz o que falta — e o motor a trata como `erro_interno`, que não
 *    derruba o atendimento do cliente.
 */
async function despacharTemplate(intencao, alvo, capacidade) {
  if (intencao.destinatario) {
    const e = new Error(
      'aviso por template de WhatsApp para um destinatário fora da conversa ainda não tem caminho nesta '
      + 'instalação (exige envio direto pela Cloud API). Use o canal "interno" no nó de notificação.',
    );
    e.status = 501;
    throw e;
  }
  if (!capacidade.template) {
    const e = new Error(`o canal "${alvo.channelType}" não envia template aprovado da Meta`);
    e.status = 400;
    throw e;
  }
  const cw = exigirChatwoot('enviarMensagem');
  const r = await cw.enviarMensagem({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    // O corpo textual é o que fica no histórico da conversa; os parâmetros vão em
    // `template_params`, que é como o canal de WhatsApp do Chatwoot recebe modelo.
    texto: String(intencao.nome),
    atributosConteudo: {
      ...marca(intencao),
      template_params: {
        name: String(intencao.nome),
        language: String(intencao.idioma || 'pt_BR'),
        processed_params: Object.fromEntries((intencao.parametros || []).map((v, i) => [String(i + 1), String(v)])),
      },
    },
  });
  return { idExterno: r?.id ?? null, resumo: `template "${intencao.nome}" enviado` };
}

/** Aviso ao pessoal da casa. `interno` vira nota privada na conversa; `email` sai por SMTP. */
async function despacharNota(intencao, alvo) {
  const canal = intencao.canal || 'interno';
  const corpo = [intencao.assunto, intencao.corpo].filter(Boolean).join('\n');

  if (canal === 'interno' || intencao.privada === true) {
    const cw = exigirChatwoot('notaInterna');
    await cw.notaInterna({
      cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
      texto: corpo,
    });
    return { resumo: 'nota interna registrada' };
  }

  if (canal === 'email') {
    const cw = exigirChatwoot('enderecosDoDestinatario');
    const enderecos = await cw.enderecosDoDestinatario({ cwAccountId: alvo.cwAccountId, destinatario: intencao.destinatario });
    if (!enderecos.length) {
      // Recusa BARULHENTA: um aviso que não avisa ninguém e diz "enviado" é pior que um erro.
      const e = new Error(
        `o destinatário ${intencao.destinatario?.tipo}="${intencao.destinatario?.valor}" não resolveu para nenhum `
        + 'e-mail cadastrado na plataforma — ninguém seria avisado',
      );
      e.status = 422;
      throw e;
    }
    const porta = await portaDeEmail();
    const r = await porta.enviarEmailDaIntencao({
      tipo: 'email', para: enderecos.join(', '), paraLista: enderecos,
      assunto: intencao.assunto || 'Aviso do atendimento', corpoTexto: intencao.corpo || '',
      corpoHtml: `<p>${String(intencao.corpo || '').replace(/\n/gu, '<br>')}</p>`,
    });
    return { idExterno: r?.idExterno ?? null, resumo: `aviso por e-mail para ${enderecos.length} destinatário(s)` };
  }

  const e = new Error(`canal de notificação desconhecido: "${canal}"`);
  e.status = 400;
  throw e;
}

async function despacharEtiqueta(intencao, alvo) {
  const cw = exigirChatwoot('aplicarEtiquetas');
  const r = await cw.aplicarEtiquetas({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    aplicar: intencao.aplicar || [], remover: intencao.remover || [],
  });
  return { resumo: `etiquetas: ${(r?.etiquetas || []).join(', ') || 'nenhuma'}` };
}

/** Transferência para setor. Aceita id OU nome — quem desenha o fluxo escolhe o setor numa lista. */
async function despacharAtribuir(intencao, alvo) {
  const cw = exigirChatwoot('transferirTime');
  let timeId = intencao.timeId ?? null;
  if (!timeId && intencao.time && typeof portas.chatwoot?.timePorNome === 'function') {
    timeId = (await portas.chatwoot.timePorNome({ cwAccountId: alvo.cwAccountId, nome: intencao.time }))?.id ?? null;
  }
  if (!timeId) {
    const e = new Error(`não achei o setor "${intencao.time ?? intencao.timeId ?? ''}" nesta conta — a conversa ficaria sem dono`);
    e.status = 422;
    throw e;
  }
  await cw.transferirTime({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId, cwTeamId: timeId,
  });
  return { idExterno: String(timeId), resumo: 'conversa transferida para o setor' };
}

async function despacharResolver(intencao, alvo) {
  const cw = exigirChatwoot('resolver');
  await cw.resolver({ cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId });
  return { resumo: 'conversa resolvida' };
}

async function despacharCarimbo(intencao, alvo) {
  const cw = exigirChatwoot('carimbar');
  const r = await cw.carimbar({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    atributos: intencao.atributos || {},
  });
  return { resumo: `carimbo com ${r?.carimbados ?? 0} atributo(s)` };
}

async function despacharHttp(intencao) {
  if (!portas.egresso?.chamarExterno) {
    // ⛔ De propósito: NÃO abro `fetch` para uma URL escolhida no editor sem a guarda de destino
    // (`RagnabotFluxoDestinoPermitido` existe no schema e não tem serviço). Sem ela, o nó `http`
    // seria um varredor da rede interna do cluster com a nossa credencial de saída.
    const e = new Error(
      'o egresso da casa não está configurado nesta instalação — o nó "http" não tem por onde sair. '
      + 'Enquanto não houver guarda de destino, a chamada externa fica recusada.',
    );
    e.status = 501;
    throw e;
  }
  const r = await portas.egresso.chamarExterno(intencao);
  // O nó `http` espera a volta pela FILA (regra R3 do motor), não pelo retorno da função.
  return { aguardarResultado: true, resultado: r, httpStatus: r?.status ?? null, resumo: `http ${intencao.metodo} respondeu ${r?.status ?? '?'}` };
}

async function despacharEmail(intencao) {
  const porta = await portaDeEmail();
  const r = await porta.enviarEmailDaIntencao(intencao);
  return { idExterno: r?.idExterno ?? null, resumo: r?.resumo ?? 'e-mail enviado' };
}

/**
 * O CAPITÃO. O contrato está escrito no nó `agente_ia` e é reproduzido aqui palavra por palavra:
 * perguntar com `pedidoDoNo:true`, e — SÓ se `quem === 'capitao'` — mandar o texto ao cliente.
 *
 * ⚠️ QUEM MANDA A RESPOSTA É ESTE ADAPTADOR, e mais ninguém nesta visita. Se o nó também mandasse,
 * o cliente leria a mesma resposta duas vezes; se ninguém mandasse, a IA teria respondido para o
 * log. A trava de verdade contra a resposta dobrada é a reserva por chave DENTRO do serviço do
 * Capitão — esta função não a substitui, ela a respeita.
 */
async function despacharAgenteIA(intencao, alvo) {
  const svc = await capitao();
  const r = await svc.responderPorIA({
    tenantId: alvo.tenantId,
    cwAccountId: alvo.cwAccountId,
    cwConversationId: alvo.cwConversationId,
    execucaoId: intencao.execucaoId ?? alvo.execucaoId ?? null,
    noId: intencao.noId ?? null,
    visitaSeq: intencao.visitaSeq ?? 0,
    pergunta: intencao.pergunta ?? '',
    pedidoDoNo: true,
    execucaoViva: true,
  });

  let idExterno = null;
  if (r?.quem === 'capitao' && r?.texto) {
    const cw = exigirChatwoot('enviarMensagem');
    const m = await cw.enviarMensagem({
      cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
      texto: String(r.texto), atributosConteudo: { ...marca(intencao), rgt_origem: 'agente_ia' },
    });
    idExterno = m?.id ?? null;
  }

  return {
    idExterno,
    aguardarResultado: true,
    // O nó lê `quem`, `texto`, `motivo` e `confianca` em `continuar()`. Nada além disso viaja — e
    // `texto` já foi entregue ao cliente por aqui.
    resultado: { quem: r?.quem ?? 'humano', texto: r?.texto ?? null, motivo: r?.motivo ?? null, confianca: r?.confianca ?? null },
    // NUNCA o texto no resumo: `RagnabotFluxoEfeito.resposta` não guarda conteúdo de conversa.
    resumo: `agente de IA: ${r?.quem ?? 'humano'}${r?.motivo ? ` (${r.motivo})` : ''}`,
  };
}

/**
 * COBRANÇA PIX. Contrato escrito no nó `pagamento_pix`, em três passos:
 *   1. criar a cobrança com a `chaveEfeito` — é ela que torna a criação idempotente (mesmo txid);
 *   2. trocar `{{pix_copia_e_cola}}` na mensagem pelo código e MANDAR ao cliente;
 *   3. devolver `{ idExterno: txid }`.
 *
 * ⚠️ Se a cobrança nasceu e a mensagem falhar, NÃO refazemos a cobrança: o `txid` é determinístico e
 * a Efí devolve a mesma. É por isso que o passo 1 vem antes e a retentativa é segura.
 */
async function despacharCobrancaPix(intencao, alvo) {
  const svc = await pagamento();
  const cob = await svc.criarCobrancaPix({
    tenantId: alvo.tenantId,
    valorCentavos: intencao.valorCentavos,
    descricao: intencao.descricao ?? null,
    cwAccountId: alvo.cwAccountId,
    cwConversationId: alvo.cwConversationId,
    protocolo: intencao.protocolo ?? null,
    execucaoId: intencao.execucaoId ?? alvo.execucaoId ?? null,
    noId: intencao.noId ?? null,
    visitaSeq: intencao.visitaSeq ?? null,
    chaveEfeito: intencao.chaveEfeito ?? null,
    devedorNome: intencao.devedorNome ?? null,
    devedorDoc: intencao.devedorDoc ?? null,
    expiracaoSegundos: intencao.expiracaoSegundos ?? null,
  });

  const marcador = intencao.marcador || '{{pix_copia_e_cola}}';
  const modelo = String(intencao.mensagemModelo ?? '');
  const codigo = String(cob?.copiaECola ?? '');
  if (!codigo) {
    const e = new Error('a cobrança foi criada mas veio sem o código copia-e-cola — o cliente não teria como pagar');
    e.status = 502;
    throw e;
  }
  // Se o modelo não tem o marcador (fluxo antigo, ou operador que apagou), o código vai no fim em
  // vez de sumir. Mensagem de cobrança sem o código é o defeito mais caro possível deste nó.
  const texto = modelo.includes(marcador) ? modelo.split(marcador).join(codigo) : [modelo, codigo].filter(Boolean).join('\n\n');

  const cw = exigirChatwoot('enviarMensagem');
  const m = await cw.enviarMensagem({
    cwAccountId: alvo.cwAccountId, cwConversationId: alvo.cwConversationId, tenantId: alvo.tenantId,
    texto, atributosConteudo: { ...marca(intencao), rgt_pix_txid: cob.txid },
  });

  return {
    idExterno: cob.txid,
    // NUNCA o código no resumo: ele é credencial de pagamento e vai para uma coluna de diagnóstico.
    resumo: `cobrança Pix ${cob.reaproveitada ? 'reaproveitada' : 'criada'} (${cob.status}), mensagem ${m?.id ? 'enviada' : 'sem id'}`,
  };
}

const DESPACHOS = Object.freeze({
  texto: (i, a) => despacharTexto(i, a),
  midia: (i, a, c) => despacharMidia(i, a, c),
  lista: (i, a, c) => despacharEscolha(i, a, c),
  botoes: (i, a, c) => despacharEscolha(i, a, c),
  template: (i, a, c) => despacharTemplate(i, a, c),
  nota: (i, a) => despacharNota(i, a),
  etiqueta: (i, a) => despacharEtiqueta(i, a),
  atribuir: (i, a) => despacharAtribuir(i, a),
  resolver: (i, a) => despacharResolver(i, a),
  carimbar: (i, a) => despacharCarimbo(i, a),
  http: (i) => despacharHttp(i),
  email: (i) => despacharEmail(i),
  agente_ia: (i, a) => despacharAgenteIA(i, a),
  cobranca_pix: (i, a) => despacharCobrancaPix(i, a),
});

/** Os tipos que esta porta sabe despachar. Exportado para o diagnóstico poder dizer, por leitura,
 *  o que existe — em vez de alguém descobrir por uma conversa parada. */
export const TIPOS_DESPACHAVEIS = Object.freeze(Object.keys(DESPACHOS));

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A PORTA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Monta a porta de UMA conversa.
 *
 * @param {{tenantId?:string, cwAccountId:number, cwConversationId:number, id?:string}} alvoBruto
 *   O motor passa a linha de `RagnabotFluxoExecucao`; o despertar passa um alvo avulso. As duas
 *   formas têm os três campos que importam, e é por isso que a mesma porta serve aos dois.
 */
export async function portaCanalDa(alvoBruto = {}) {
  const cwAccountId = alvoBruto.cwAccountId;
  const cwConversationId = alvoBruto.cwConversationId;
  const canal = await descobrirCanal({ cwAccountId, cwConversationId, tenantId: alvoBruto.tenantId });
  const capacidade = capacidadeDoCanal(canal.channelType);
  const alvo = {
    tenantId: alvoBruto.tenantId ?? canal.tenantId ?? null,
    cwAccountId,
    cwConversationId,
    execucaoId: alvoBruto.id ?? null,
    channelType: canal.channelType,
    phoneNumberId: canal.phoneNumberId ?? null,
  };

  return {
    canal,
    capacidade,

    /**
     * Despacha UMA intenção. Este é o método que o motor chama depois do COMMIT — e o único lugar
     * de todo o caminho do fluxo onde a rede é permitida.
     */
    async enviar(intencao, contexto = {}) {
      const tipo = String(intencao?.tipo ?? '');
      const chave = intencao?.chaveEfeito ?? null;

      const repetido = await jaEnviado(chave);
      if (repetido) {
        log().info?.(`[canal] intenção "${tipo}" já despachada (${String(chave).slice(0, 12)}…) — não repito`);
        return repetido;
      }

      const despacho = DESPACHOS[tipo];
      if (!despacho) {
        // Tipo novo de intenção que ninguém ligou aqui. Recusa NOMEADA: o motor abre incidente com
        // esta frase, e quem ler sabe exatamente o que falta implementar.
        const e = new Error(`a porta do canal não sabe despachar a intenção "${tipo}". Conhecidas: ${TIPOS_DESPACHAVEIS.join(', ')}.`);
        e.status = 501;
        throw e;
      }

      try {
        // O contexto do motor (`{execucao, noId, visitaSeq}`) completa o que a intenção não trouxe.
        // Nem toda intenção carrega `execucaoId` — só as que precisam dele (`agente_ia`,
        // `cobranca_pix`) —, e o despertar não tem execução nenhuma.
        const alvoDoEnvio = {
          ...alvo,
          tenantId: alvo.tenantId ?? contexto?.execucao?.tenantId ?? null,
          execucaoId: intencao.execucaoId ?? contexto?.execucao?.id ?? alvo.execucaoId ?? null,
        };
        const r = await despacho(intencao, alvoDoEnvio, capacidade);
        return lembrar(chave, r);
      } catch (e) {
        throw normalizarErroDeCanal(e, `envio de "${tipo}" na conversa ${cwConversationId}`);
      }
    },

    /**
     * Estado ATUAL da conversa, lido imediatamente antes de despachar um efeito `condicional`
     * (`resolver`, `atribuir`). O motor grava isto em `RagnabotFluxoEfeito.estadoAnterior` — é o que
     * permite saber, depois, que a analista já tinha assumido a conversa quando o robô tentou
     * fechá-la.
     */
    async lerConversa(id = cwConversationId) {
      const cw = portas.chatwoot;
      if (!cw?.lerConversa) return null;
      const c = await cw.lerConversa({ cwAccountId, cwConversationId: id });
      if (!c) return null;
      return { status: c.status ?? null, assigneeId: c.cwAssigneeId ?? null, teamId: c.cwTeamId ?? null, inboxId: c.cwInboxId ?? null };
    },

    /** Carimbo direto. O motor não usa (ele manda a intenção `carimbar`), mas o contrato original da
     *  `PortaCanal` expõe o método e o despertar pode querer usá-lo. */
    async carimbar(atributos) {
      return despacharCarimbo({ atributos }, alvo);
    },
  };
}

/** A forma que `configurarMotor({ canal })` e `configurarDespertar({ canal })` esperam. */
export const portaCanal = Object.freeze({ portaDa: portaCanalDa });

export default {
  portaDa: portaCanalDa,
  portaCanalDa,
  portaCanal,
  configurarCanal,
  portasDoCanal,
  capacidadeDoCanal,
  textoNumerado,
  normalizarErroDeCanal,
  esquecerEnvios,
  esquecerCanais,
  CAPACIDADES,
  TIPOS_DESPACHAVEIS,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ — declarado para ninguém confundir ausência com defeito
//
// • NÃO fala com a Cloud API da Meta direto. Tudo passa pelo Chatwoot, que é quem tem a credencial
//   do canal. A consequência prática está no `template` com destinatário fora da conversa: recusa
//   declarada, não silêncio.
// • NÃO faz a chamada do nó `http`. O egresso da casa (com guarda de destino) não existe no
//   repositório; abrir `fetch` para URL de editor sem essa guarda seria pior que a falta.
// • NÃO conhece Whatsmeow nem intermediário (doc 34 §F9.2.2). Quando a camada de provedor existir,
//   ela entra em `descobrirCanal` — o resto deste arquivo não muda, porque só depende da CAPACIDADE
//   do canal, não de quem o opera.
// • NÃO foi exercitado com cliente. Zero caixas de WhatsApp em 02/09/2026. O que existe é teste com
//   dublê (`tests/ragnabot-canal-porta.test.mjs`) e leitura do contrato.
// ════════════════════════════════════════════════════════════════════════════════════════════════
