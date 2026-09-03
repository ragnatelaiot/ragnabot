// ════════════════════════════════════════════════════════════════════════════════════════════════
// O TRABALHADOR DO AGENDAMENTO — quem dispara no horário e registra o resultado (F4.7)
//
// Contrato S4 (02/09/2026), doc 34 §F4. O domínio (recorrência, chaves, CRUD) mora em
// `ragnabot-agendamento.service.js`; aqui mora o LAÇO, as portas e as decisões de disparo.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// A EXIGÊNCIA Nº 1 — "NÃO PODE DISPARAR DUAS VEZES SE O POD REINICIAR NO MEIO"
//
// É a lição do alerta de backup que mandou 210 mensagens, e ela não se resolve com um `if` em
// memória: em Kubernetes há mais de uma réplica, e um `if` só vale dentro de um processo. A defesa
// aqui tem TRÊS camadas, e cada uma cobre uma falha diferente:
//
//   C1. POSSE DA OCORRÊNCIA (entre réplicas).
//       `UPDATE RagnabotAgendamento SET travadoEm=now(), donoWorker=? WHERE id=? AND status='pendente'
//        AND proximaEm=<o valor exato que eu li> AND (travadoEm IS NULL OR travadoEm < agora-90s)`
//       Duas réplicas lendo a mesma agenda no mesmo tique: o Postgres deixa UMA atualizar; a outra
//       recebe `count=0` e vai cuidar de outra agenda. O `proximaEm=<valor lido>` é o que torna a
//       posse condicional ao estado — quem chegou depois de a ocorrência JÁ ter avançado desiste,
//       porque está falando de uma ocorrência que não existe mais.
//
//   C2. A MARCA POR ENVIO (entre reinícios).  ← esta é a que responde à pergunta do contrato
//       Antes de qualquer rede, `INSERT INTO RagnabotAgendamentoEnvio … ON CONFLICT ("chave")
//       DO NOTHING RETURNING id`. A chave é sha256(agendamento|destino|ocorrência|tentativaManual)
//       e o índice único é do BANCO. Quem inseriu manda; quem colidiu NÃO manda, nem que o pod
//       tenha reiniciado, nem que a fila reentregue, nem que o operador clique duas vezes.
//       ⚠️ É a mesma disciplina da caixa de saída de duas fases do motor
//       (`RagnabotFluxoEfeito`), pelo mesmo motivo: a marca durável nasce ANTES do efeito.
//
//   C3. DÚVIDA NÃO SE REPETE SOZINHA.
//       Uma linha que ficou `reservado` depois do prazo de visibilidade significa «o processo caiu
//       entre a reserva e a confirmação». Pode ter saído. O ceifador NÃO a reenvia: marca
//       `duvidoso`, com o motivo escrito, e ela aparece na tela para um humano decidir.
//       O preço assumido é o mesmo já assumido pelo motor: uma queda pode deixar mensagem NÃO
//       enviada. Silêncio seguido de repetição comandada por gente é falha melhor que a mesma
//       mensagem chegando duas vezes ao cliente — que é o defeito que ninguém consegue desfazer.
//
// ⚠️ A DIFERENÇA ENTRE `adiado` E `duvidoso` É O CORAÇÃO DESTE ARQUIVO, e ela é sobre CONHECIMENTO,
// não sobre gravidade:
//   `adiado`   = eu sei que NADA saiu, porque nem cheguei a tentar (não havia caixa ativa, não havia
//                porta de canal, não consegui abrir a conversa). Retentar é seguro. Vai com recuo.
//   `duvidoso` = eu NÃO SEI se saiu (a rede caiu no meio, o processo morreu). Retentar é apostar.
//                Não retenta.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// AS OUTRAS CINCO EXIGÊNCIAS
//
// 2. JANELA DE 24 H. Antes de mandar texto livre num canal de WhatsApp, a janela é avaliada
//    (`avaliarJanela`, mesma doutrina do despertar: quando não dá para saber, NÃO se chuta —
//    tenta-se, e quem dá o veredito é a Meta). Fechada:
//      · com modelo aprovado configurado → sai POR MODELO;
//      · sem modelo → `sem_janela`, com `motivo='fora_da_janela'` e a frase escrita no registro.
//    NUNCA falha muda, e nunca `falhou` — porque não é defeito: é regra da Meta.
//
// 3. RECORRÊNCIA COM FUSO. A conta é de CALENDÁRIO (`proximaOcorrencia`, função pura no domínio) e
//    o avanço é condicionado ao `proximaEm` não ter mudado, então a ocorrência avança UMA vez.
//
// 4. MULTI-CONTATO = N ENVIOS INDEPENDENTES. O laço por destino tem `try` por destino: o que falha
//    falha sozinho. Nenhum `throw` de um destinatário alcança o seguinte.
//
// 5. CANCELAR/PAUSAR. O trabalhador só olha `status='pendente'`; o que já disparou fica no
//    histórico porque os envios nunca são apagados.
//
// 6. NADA SAI SEM CANAL. A caixa é conferida ANTES da primeira reserva. Sem caixa ativa, o item é
//    `adiado` com motivo — não perdido, não falho.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ, de propósito
//
//   • não amarra nada no processo: quem chama `iniciarTrabalhadorDeAgendamento()` e injeta as
//     portas é o arranque (`servidor.js`), e é decisão do chefe — igual ao executor de fluxo;
//   • não fala com a plataforma direto: tudo por `portas.canal` e `portas.chatwoot`;
//   • não decide recorrência: isso é do domínio, e é função pura para poder ser provada;
//   • não apaga nada, nunca.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import prismaPadrao from '../base/db.js';
import loggerPadrao from '../base/logger.js';
import {
  STATUS, STATUS_ENVIO, MOTIVOS, MAX_TENTATIVAS,
  chaveDeEnvio, proximaOcorrencia,
} from './ragnabot-agendamento.service.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTANTES DECLARADAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Prazo de visibilidade da posse. Passado isso sem desfecho, o ceifador devolve a agenda e resolve
 * as reservas penduradas.
 *
 * 90 s é o MESMO número de `CEIFADOR_SEGUNDOS` da fila do motor, e a igualdade é de propósito: dois
 * ceifadores com prazos diferentes na mesma casa acabam com um devolvendo o que o outro ainda
 * considera vivo.
 */
export const POSSE_SEGUNDOS = 90;

/** Recuo do envio `adiado`: 1 min, 2, 4, 8… com teto de 1 h. Diferente do recuo da fila (segundos)
 *  porque o que se espera aqui é OUTRA coisa: uma caixa de entrada voltar a ficar ativa leva
 *  minutos, não milissegundos, e retentar de 2 em 2 segundos só enche o log. */
const RECUO_BASE_MS = 60_000;
const RECUO_TETO_MS = 3_600_000;

const ERRO_MAX = 500;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS INJETÁVEIS — o teste troca implementação, nunca comportamento
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaPadrao,
  log: loggerPadrao,
  /** `{ portaDa(alvo) }` — a MESMA `PortaCanal` do motor e do despertar (`ragnabot-canal.porta.js`). */
  canal: null,
  /** `ragnabot-chatwoot.porta.js`. Usada para `garantirConversa`, `lerConversa`, `resolver`,
   *  `transferirTime` — tudo o que é estado da conversa, e não conteúdo. */
  chatwoot: null,
  /** Avaliador de janela de 24 h. Opcional: sem ele vale a leitura local de `RagnabotFluxoJanela`. */
  janela: null,
  /** Relógio. Existe para o TESTE poder fixar o instante — regra de tempo com `Date.now()` cravado
   *  não é verificável, e a virada do dia é justamente o que precisa ser provado. */
  agora: () => new Date(),
};

export function configurarAgendamentoWorker(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no trabalhador de agendamento: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoTrabalhadorDeAgendamento() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;
const agora = () => portas.agora();

// ────────────────────────────────────────────────────────────────────────────────────────────────
// FERRAMENTA MIÚDA
// ────────────────────────────────────────────────────────────────────────────────────────────────

function recuoMs(tentativa) {
  const n = Math.max(1, Number(tentativa) || 1);
  return Math.min(RECUO_BASE_MS * (2 ** (n - 1)), RECUO_TETO_MS);
}

const somarMs = (instante, ms) => new Date(new Date(instante).getTime() + ms);
const cortar = (t) => (t == null ? null : String(t).slice(0, ERRO_MAX));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// JANELA DE 24 HORAS — a mesma doutrina do motor e do despertar
//
// ⚠️ QUANDO NÃO DÁ PARA DECIDIR, NÃO SE CHUTA. Sem `phoneNumberId` e sem o identificador do
// contato, a resposta é `aberta: null` (indeterminada) e o envio é TENTADO — quem dá o veredito é a
// Meta, pela recusa autoritativa que a `PortaCanal` traduz em `e.foraDaJanela`. Um padrão pessimista
// calaria toda caixa cujo número ainda não foi cadastrado; um otimista mandaria a agenda inteira
// bater numa parede. Tentar e ouvir o "não" é o único caminho honesto.
//
// ⚠️ DUPLICAÇÃO DECLARADA de `avaliarJanelaDoDespertar`. Não é `import` porque aquela função lê
// pelo cliente Prisma DAQUELE módulo (`portas.db` do despertar), e injetar o despertar inteiro só
// para ler uma linha acoplaria dois trabalhadores independentes. A REGRA é a mesma, palavra por
// palavra — se ela mudar lá, muda aqui.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O `phoneNumberId` vive em `RagnabotInbox.metadata` porque é atributo da CONEXÃO, não da agenda.
 *  A chave da janela é (número DA EMPRESA, destinatário): com duas conexões de WhatsApp na mesma
 *  empresa, janela aberta por um número não vale pelo outro. */
async function phoneNumberIdDaCaixa({ tenantId, cwInboxId }) {
  if (!tenantId || cwInboxId == null) return null;
  const caixa = await db().ragnabotInbox.findFirst({ where: { tenantId, cwInboxId } }).catch(() => null);
  const meta = caixa?.metadata;
  const valor = meta && typeof meta === 'object' ? meta.phoneNumberId : null;
  return valor ? String(valor) : null;
}

export async function avaliarJanela({ tenantId, cwAccountId, cwInboxId, contatoChave, instante }) {
  if (portas.janela?.avaliar) {
    const r = await portas.janela.avaliar({ tenantId, cwAccountId, cwInboxId, contatoChave });
    return { aberta: r?.aberta ?? null, motivo: r?.motivo ?? 'porta_janela' };
  }
  const phoneNumberId = await phoneNumberIdDaCaixa({ tenantId, cwInboxId });
  if (!phoneNumberId || !contatoChave) return { aberta: null, motivo: 'indeterminada' };

  const linha = await db().ragnabotFluxoJanela.findUnique({
    where: { phoneNumberId_destinatarioWaId: { phoneNumberId, destinatarioWaId: String(contatoChave) } },
  }).catch(() => null);
  if (!linha) return { aberta: false, motivo: 'sem_registro' };
  if (linha.fechadaPeloDestinoEm) return { aberta: false, motivo: 'fechada_pelo_destino' };

  const margem = linha.margemSegurancaSegundos ?? 300;
  const limite = somarMs(linha.expiraEm, -margem * 1000);
  const aberta = new Date(instante) < limite;
  return { aberta, motivo: aberta ? 'aberta' : 'vencida' };
}

/** A única classificação de erro que muda o desfecho: o canal recusou por janela fechada?
 *  Espelha `ehJanelaFechada` do despertar — `e.foraDaJanela` é carimbado por
 *  `normalizarErroDeCanal` na `PortaCanal`. */
function ehJanelaFechada(e) {
  return e?.foraDaJanela === true || e?.code === 'JANELA_FECHADA';
}

/**
 * O erro é DÚVIDA (não sei se chegou) ou RECUSA (o destino disse não)?
 *
 * ⚠️ FALHA DE REDE É DÚVIDA, e a escolha é deliberada — é a mesma de `normalizarErroDeCanal` no
 * adaptador. Quando a conexão cai não se sabe se a requisição chegou; tratar como recusa faria a
 * retentativa mandar de novo algo que talvez já tenha saído. Do outro lado, 4xx do destino é
 * veredito: ele leu e disse não.
 */
function ehDuvida(e) {
  if (!e) return false;
  const status = Number(e.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return false; // recusa declarada
  if (Number.isFinite(status) && status >= 500) return true; // erro do outro lado: pode ter processado
  const cod = String(e.code || '');
  if (/ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ABORT/iu.test(cod)) return true;
  return /rede|network|socket|timeout|abort/iu.test(String(e.message || ''));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C1 — POSSE DA OCORRÊNCIA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Toma a posse desta ocorrência. `true` = é minha; `false` = outra réplica levou, ou a ocorrência
 * já avançou enquanto eu lia.
 *
 * ⚠️ A CONDIÇÃO `proximaEm: <o valor exato lido>` NÃO É ENFEITE. Sem ela, uma réplica lenta que
 * lesse a agenda, dormisse, e voltasse depois de a ocorrência já ter sido disparada e avançada,
 * tomaria posse de uma ocorrência antiga e dispararia a MESMA mensagem de novo. Com ela, essa
 * réplica simplesmente não casa e desiste — é o mesmo raciocínio do `tokenVisita` do motor.
 */
export async function tomarPosse(agendamento, workerId, instante) {
  const limitePosse = somarMs(instante, -POSSE_SEGUNDOS * 1000);
  const r = await db().ragnabotAgendamento.updateMany({
    where: {
      id: agendamento.id,
      status: STATUS.PENDENTE,
      proximaEm: agendamento.proximaEm,
      OR: [{ travadoEm: null }, { travadoEm: { lt: limitePosse } }],
    },
    data: { donoWorker: workerId, travadoEm: instante },
  });
  return (r?.count ?? 0) === 1;
}

/**
 * Avança para a próxima ocorrência — ou conclui a agenda.
 *
 * ⚠️ TAMBÉM CONDICIONADO a `proximaEm` não ter mudado. É o que garante que a ocorrência avance UMA
 * vez por disparo, mesmo que duas réplicas tenham passado por aqui. Sem a condição, a segunda
 * avançaria de novo e a agenda pularia uma ocorrência inteira — o defeito silencioso da recorrência:
 * a mensagem de terça simplesmente nunca sai, e ninguém tem como perceber.
 */
export async function avancarOcorrencia(agendamento, instante) {
  const proxima = proximaOcorrencia(
    { ...agendamento, ocorrenciasFeitas: (agendamento.ocorrenciasFeitas ?? 0) + 1 },
    agendamento.proximaEm,
  );
  const r = await db().ragnabotAgendamento.updateMany({
    where: { id: agendamento.id, proximaEm: agendamento.proximaEm },
    data: proxima
      ? {
        proximaEm: proxima,
        ultimaOcorrenciaEm: agendamento.proximaEm,
        ocorrenciasFeitas: { increment: 1 },
        donoWorker: null,
        travadoEm: null,
      }
      : {
        proximaEm: null,
        ultimaOcorrenciaEm: agendamento.proximaEm,
        ocorrenciasFeitas: { increment: 1 },
        status: STATUS.CONCLUIDO,
        donoWorker: null,
        travadoEm: null,
      },
  });
  return { avancou: (r?.count ?? 0) === 1, proxima };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C2 — A MARCA POR ENVIO.  Esta função É a resposta a "não dispara duas vezes".
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Reserva o envio de UM destinatário nesta ocorrência.
 *
 * @returns {Promise<{reservado:boolean, chave:string, envio:object|null, jaExistente:object|null}>}
 *   `reservado:false` significa «alguém (outra réplica, ou eu mesmo antes de reiniciar) já cuidou
 *   deste par». Quem recebe `false` NÃO MANDA NADA. Ponto.
 *
 * ⚠️ É `INSERT … ON CONFLICT DO NOTHING`, e não `SELECT` seguido de `INSERT`. A segunda forma é
 * correta num processo e errada em dois: as duas réplicas leem "não existe" e as duas inserem — uma
 * ganha e a outra estoura, mas as duas já teriam decidido mandar. Aqui é o Postgres, numa declaração
 * só, que diz quem levou.
 *
 * ⚠️ A RESERVA VEM ANTES DA REDE. Se o processo morrer entre a reserva e o envio, fica uma linha
 * `reservado` — que o ceifador transforma em `duvidoso` (e ninguém repete). A ordem inversa (mandar
 * e depois gravar) deixaria uma queda replicar a mensagem SEM nenhum registro durável de que ela
 * saiu uma vez: impossível de conciliar, impossível de auditar. É a mesma escolha, e o mesmo preço,
 * já assumidos pela caixa de saída do motor.
 */
export async function reservarEnvio({
  agendamento, destino, ocorrenciaEm, workerId, tentativaManual = 0, instante,
}) {
  const chave = chaveDeEnvio({
    agendamentoId: agendamento.id, destinoId: destino.id, ocorrenciaEm, tentativaManual,
  });
  const id = crypto.randomUUID();
  const quando = instante ?? agora();

  const linhas = await db().$queryRaw`
    INSERT INTO "RagnabotAgendamentoEnvio"
      ("id","tenantId","agendamentoId","destinoId","ocorrenciaEm","tentativaManual","chave",
       "status","cwConversationId","conversaCriada","ticketAberto","tentativas","donoWorker","reservadoEm")
    VALUES
      (${id}, ${agendamento.tenantId}, ${agendamento.id}, ${destino.id},
       ${new Date(ocorrenciaEm)}, ${Number(tentativaManual) || 0}, ${chave},
       ${STATUS_ENVIO.RESERVADO}, ${destino.cwConversationId ?? null}, false, false, 0,
       ${workerId ?? null}, ${quando})
    ON CONFLICT ("chave") DO NOTHING
    RETURNING id, chave, status`;

  const linha = Array.isArray(linhas) ? linhas[0] : null;
  if (linha) return { reservado: true, chave, envio: linha, jaExistente: null };

  // Colidiu: já existe. Devolvemos a linha existente para o chamador poder REGISTRAR o motivo de
  // não ter mandado — «já cuidado» some do relatório se ninguém o escrever.
  const existente = await db().ragnabotAgendamentoEnvio.findUnique({ where: { chave } }).catch(() => null);
  return { reservado: false, chave, envio: null, jaExistente: existente };
}

/** Fecha o envio com um desfecho. Nunca lança: registro perdido é ruim, disparo derrubado por causa
 *  de registro é pior — a mesma escolha do trabalhador de atendimento e da auditoria. */
async function fecharEnvio(chave, dados) {
  try {
    await db().ragnabotAgendamentoEnvio.updateMany({
      where: { chave },
      data: { ...dados, donoWorker: null, concluidoEm: dados.concluidoEm ?? agora() },
    });
    return true;
  } catch (e) {
    log().warn?.(`[agendamento] não gravei o desfecho de ${String(chave).slice(0, 12)}…: ${e.message}`);
    return false;
  }
}

/** Devolve o envio para retentativa, com recuo. Só para o que se SABE que não saiu (`adiado`). */
async function adiarEnvio(chave, { motivo, erro = null, tentativaAtual = 0, instante }) {
  const tentativas = (Number(tentativaAtual) || 0) + 1;
  if (tentativas >= MAX_TENTATIVAS) {
    // O teto existe para que algo PARE. Um envio que falha para sempre e volta para sempre consome
    // a rodada inteira e cala as agendas sadias.
    return db().ragnabotAgendamentoEnvio.updateMany({
      where: { chave },
      data: {
        status: STATUS_ENVIO.FALHOU,
        motivo: MOTIVOS.TETO_DE_TENTATIVAS,
        erro: cortar(erro ?? `desisti depois de ${tentativas} tentativas (último motivo: ${motivo})`),
        tentativas,
        proximaTentativaEm: null,
        donoWorker: null,
        concluidoEm: instante ?? agora(),
      },
    });
  }
  return db().ragnabotAgendamentoEnvio.updateMany({
    where: { chave },
    data: {
      status: STATUS_ENVIO.ADIADO,
      motivo,
      erro: cortar(erro),
      tentativas,
      proximaTentativaEm: somarMs(instante ?? agora(), recuoMs(tentativas)),
      donoWorker: null,
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O DISPARO DE UM DESTINATÁRIO — do canal ao registro
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A INTENÇÃO que vai para a `PortaCanal`. Três formas, na ordem de precedência:
 *   1. `template` — quando a janela de 24 h está fechada E há modelo aprovado. É o ÚNICO caminho
 *      legítimo fora da janela, e a Meta é quem manda nisso;
 *   2. `midia`    — quando há anexo. A mensagem vira a LEGENDA, para o cliente não receber a foto
 *      e o texto como duas mensagens fora de ordem;
 *   3. `texto`    — o caso normal.
 */
export function montarIntencao(agendamento, { chaveEfeito, porTemplate = false }) {
  if (porTemplate) {
    return {
      tipo: 'template',
      nome: agendamento.templateNome,
      idioma: agendamento.templateIdioma || 'pt_BR',
      parametros: Array.isArray(agendamento.templateParametros) ? agendamento.templateParametros : [],
      chaveEfeito,
    };
  }
  if (agendamento.anexoUrl) {
    return { tipo: 'midia', url: agendamento.anexoUrl, legenda: agendamento.mensagem || null, chaveEfeito };
  }
  return { tipo: 'texto', corpo: agendamento.mensagem ?? '', chaveEfeito };
}

/**
 * Depois de enviar: a conversa vira ATENDIMENTO ou volta a ficar quieta (F4.4).
 *
 * ⚠️ `abrirTicket:false` SÓ RESOLVE A CONVERSA QUE NÓS ABRIMOS. Fechar uma conversa que já existia
 * é escrita cega sobre estado compartilhado com gente: se uma analista assumiu aquele atendimento
 * dois minutos atrás, resolvê-lo agora fecha a conversa embaixo dela. É a mesma razão de
 * `RagnabotFluxoEfeito.estadoAnterior` existir no motor — e por isso, aqui, `conversaCriada` é
 * gravado na linha do envio: é ele que autoriza (ou proíbe) o fechamento.
 */
async function acertarTicket({ agendamento, cwConversationId, conversaCriada }) {
  const cw = portas.chatwoot;
  if (!cw || !cwConversationId) return { ticketAberto: Boolean(agendamento.abrirTicket) };

  try {
    if (agendamento.abrirTicket) {
      if (agendamento.cwTeamId != null && cw.transferirTime) {
        await cw.transferirTime({
          cwAccountId: agendamento.cwAccountId,
          cwConversationId,
          cwTeamId: agendamento.cwTeamId,
        });
      }
      return { ticketAberto: true };
    }
    if (conversaCriada && cw.resolver) {
      await cw.resolver({ cwAccountId: agendamento.cwAccountId, cwConversationId });
      return { ticketAberto: false };
    }
    // Conversa preexistente com `abrirTicket:false`: deixamos como está, de propósito, e dizemos
    // por quê no log — «não fiz nada» sem explicação é o que vira dúvida de suporte depois.
    log().info?.(`[agendamento] conversa ${cwConversationId} já existia: não a fecho, para não fechar embaixo de um atendente`);
    return { ticketAberto: false };
  } catch (e) {
    // O ticket é acabamento; a MENSAGEM já saiu. Derrubar o envio por causa disto transformaria um
    // sucesso em falha e faria a retentativa mandar de novo.
    log().warn?.(`[agendamento] mensagem enviada, mas não acertei o ticket da conversa ${cwConversationId}: ${e.message}`);
    return { ticketAberto: Boolean(agendamento.abrirTicket), avisoTicket: cortar(e.message) };
  }
}

/**
 * UM destinatário, do começo ao fim. Devolve o desfecho — e NUNCA lança.
 *
 * ⚠️ NUNCA LANÇAR É A EXIGÊNCIA Nº 4 EM UMA LINHA. Um `throw` daqui subiria para o laço do
 * agendamento e derrubaria os outros 39 destinatários por causa de um número errado. Cada
 * destinatário tem o desfecho dele, e o resultado é por destinatário.
 */
export async function dispararDestino({ agendamento, destino, ocorrenciaEm, workerId, chaveExistente = null, tentativaAtual = 0, instante }) {
  const quando = instante ?? agora();
  let chave = chaveExistente;
  let cwConversationId = destino.cwConversationId ?? null;
  let conversaCriada = false;

  try {
    if (!chave) {
      const r = await reservarEnvio({ agendamento, destino, ocorrenciaEm, workerId, instante: quando });
      if (!r.reservado) {
        // ⭐ ESTE RAMO É A PROVA VIVA DA C2. Chegamos aqui quando outra réplica — ou este mesmo
        // processo antes de reiniciar — já cuidou deste par. NÃO mandamos nada.
        return { desfecho: 'ja_cuidado', chave: r.chave, statusAnterior: r.jaExistente?.status ?? null };
      }
      chave = r.chave;
    }

    // ── 1. A CONVERSA (exigência nº 6 começa aqui) ────────────────────────────────────────────
    if (!cwConversationId) {
      const cw = portas.chatwoot;
      if (!cw?.garantirConversa) {
        await adiarEnvio(chave, { motivo: MOTIVOS.SEM_CONVERSA, erro: 'a porta da plataforma não sabe abrir conversa nesta instalação', tentativaAtual, instante: quando });
        return { desfecho: 'adiado', chave, motivo: MOTIVOS.SEM_CONVERSA };
      }
      const c = await cw.garantirConversa({
        cwAccountId: agendamento.cwAccountId,
        cwInboxId: agendamento.cwInboxId,
        contatoChave: destino.contatoChave,
        contatoNome: destino.contatoNome,
        cwContactId: destino.cwContactId,
        cwTeamId: agendamento.abrirTicket ? agendamento.cwTeamId : null,
      });
      if (!c?.cwConversationId) {
        await adiarEnvio(chave, { motivo: MOTIVOS.SEM_CONVERSA, erro: 'a plataforma não devolveu conversa para este contato', tentativaAtual, instante: quando });
        return { desfecho: 'adiado', chave, motivo: MOTIVOS.SEM_CONVERSA };
      }
      cwConversationId = c.cwConversationId;
      conversaCriada = c.criada === true;
      // Grava no destino para a PRÓXIMA ocorrência reaproveitar: sem isto, um agendamento semanal
      // abriria uma conversa nova por semana e a fila do setor viraria lixo em três meses.
      await db().ragnabotAgendamentoDestino.update({
        where: { id: destino.id },
        data: { cwConversationId, cwContactId: c.cwContactId ?? destino.cwContactId ?? null },
      }).catch(() => {});
    }

    // ── 2. A JANELA DE 24 H (exigência nº 2) ──────────────────────────────────────────────────
    const j = await avaliarJanela({
      tenantId: agendamento.tenantId,
      cwAccountId: agendamento.cwAccountId,
      cwInboxId: agendamento.cwInboxId,
      contatoChave: destino.contatoChave,
      instante: quando,
    });
    const temModelo = agendamento.usarTemplate === true && Boolean(agendamento.templateNome);
    if (j.aberta === false && !temModelo) {
      // NÃO É FALHA, e não vira `falhou`: é regra da Meta. E não é silêncio: o motivo fica escrito
      // no registro e aparece na tela, que é exatamente o que o contrato exige.
      await fecharEnvio(chave, {
        status: STATUS_ENVIO.SEM_JANELA,
        motivo: MOTIVOS.FORA_DA_JANELA,
        erro: `passaram-se mais de 24 h desde a última mensagem do contato (${j.motivo}) e este agendamento não tem modelo aprovado configurado — nada foi enviado`,
        cwConversationId,
        conversaCriada,
      });
      return { desfecho: 'sem_janela', chave, motivo: j.motivo };
    }
    const porTemplate = j.aberta === false && temModelo;

    // ── 3. O ENVIO ────────────────────────────────────────────────────────────────────────────
    if (!portas.canal?.portaDa) {
      // Exigência nº 6: sem canal, ADIA — não perde, não falha.
      await adiarEnvio(chave, { motivo: MOTIVOS.CANAL_AUSENTE, erro: 'a porta do canal não está amarrada neste processo', tentativaAtual, instante: quando });
      return { desfecho: 'adiado', chave, motivo: MOTIVOS.CANAL_AUSENTE };
    }
    const porta = await portas.canal.portaDa({
      tenantId: agendamento.tenantId,
      cwAccountId: agendamento.cwAccountId,
      cwConversationId,
    });
    const intencao = montarIntencao(agendamento, { chaveEfeito: chave, porTemplate });

    let r;
    try {
      r = await porta.enviar(intencao, {});
    } catch (e) {
      if (ehJanelaFechada(e)) {
        // A Meta é a fonte autoritativa: a nossa contabilidade dizia «não sei» e ela disse «não».
        if (temModelo && !porTemplate) {
          // Uma segunda passada, POR MODELO — o único caminho legítimo. Não é retentativa cega: é
          // o mesmo envio por outro meio, e continua sob a MESMA chave, então não duplica.
          try {
            const rT = await porta.enviar(montarIntencao(agendamento, { chaveEfeito: chave, porTemplate: true }), {});
            const t = await acertarTicket({ agendamento, cwConversationId, conversaCriada });
            await fecharEnvio(chave, {
              status: STATUS_ENVIO.ENVIADO,
              motivo: 'por_modelo_fora_da_janela',
              idExterno: rT?.idExterno ?? rT?.wamid ?? null,
              degradado: rT?.degradado ?? null,
              cwConversationId, conversaCriada, ticketAberto: t.ticketAberto,
            });
            return { desfecho: 'enviado', chave, porTemplate: true };
          } catch (e2) {
            await fecharEnvio(chave, {
              status: STATUS_ENVIO.FALHOU, motivo: MOTIVOS.DESTINO_RECUSOU,
              erro: cortar(`o modelo aprovado também foi recusado: ${e2.message}`),
              cwConversationId, conversaCriada,
            });
            return { desfecho: 'falhou', chave };
          }
        }
        await fecharEnvio(chave, {
          status: STATUS_ENVIO.SEM_JANELA,
          motivo: MOTIVOS.FORA_DA_JANELA,
          erro: cortar(`o canal recusou por janela de 24 h fechada: ${e.message}`),
          cwConversationId, conversaCriada,
        });
        return { desfecho: 'sem_janela', chave, motivo: 'recusado_pelo_destino' };
      }

      if (ehDuvida(e)) {
        // ⚠️ C3. NÃO SEI SE SAIU. Terminal, e não retentável por máquina nenhuma.
        await fecharEnvio(chave, {
          status: STATUS_ENVIO.DUVIDOSO,
          motivo: MOTIVOS.PROCESSO_CAIU,
          erro: cortar(`a rede falhou no meio do envio e não sei se a mensagem chegou: ${e.message}. Não repito sozinho — confira no destino antes de reenviar.`),
          cwConversationId, conversaCriada,
        });
        return { desfecho: 'duvidoso', chave };
      }

      await fecharEnvio(chave, {
        status: STATUS_ENVIO.FALHOU,
        motivo: MOTIVOS.DESTINO_RECUSOU,
        erro: cortar(e.message),
        cwConversationId, conversaCriada,
      });
      return { desfecho: 'falhou', chave };
    }

    // ── 4. O TICKET E O REGISTRO ──────────────────────────────────────────────────────────────
    const t = await acertarTicket({ agendamento, cwConversationId, conversaCriada });
    await fecharEnvio(chave, {
      status: STATUS_ENVIO.ENVIADO,
      motivo: porTemplate ? 'por_modelo_fora_da_janela' : null,
      idExterno: r?.idExterno ?? r?.wamid ?? null,
      degradado: r?.degradado ?? null,
      erro: t.avisoTicket ?? null,
      cwConversationId, conversaCriada, ticketAberto: t.ticketAberto,
    });
    return { desfecho: 'enviado', chave, porTemplate };
  } catch (e) {
    // Rede de segurança: qualquer coisa que escapou vira DÚVIDA, nunca sucesso e nunca repetição.
    log().error?.(`[agendamento] destino ${destino?.id} do agendamento ${agendamento?.id}: ${e.message}`);
    if (chave) {
      await fecharEnvio(chave, {
        status: STATUS_ENVIO.DUVIDOSO, motivo: MOTIVOS.PROCESSO_CAIU, erro: cortar(e.message), cwConversationId,
      });
    }
    return { desfecho: 'duvidoso', chave, erro: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A RODADA
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * As agendas VENCIDAS, disparadas uma a uma.
 *
 * ⚠️ A ORDEM DE `finally` IMPORTA: a ocorrência avança DEPOIS de todos os destinatários terem
 * desfecho, e avança MESMO que alguns tenham ficado `adiado`. Não avançar por causa de um
 * destinatário adiado congelaria a agenda inteira — a mensagem de terça nunca sairia porque a de
 * segunda não achou um número. As retentativas são POR ENVIO (`retentarAdiados`), não por agenda.
 */
export async function dispararVencidos({ limite = 20, workerId = 'agendamento-worker' } = {}) {
  const resumo = { vistas: 0, disparadas: 0, disputadas: 0, envios: 0, enviados: 0, semJanela: 0, adiados: 0, falhas: 0, duvidosos: 0, jaCuidados: 0, semDestino: 0 };
  const instante = agora();

  const vencidas = await db().ragnabotAgendamento.findMany({
    where: { status: STATUS.PENDENTE, proximaEm: { not: null, lte: instante } },
    orderBy: { proximaEm: 'asc' },
    take: limite,
  });
  resumo.vistas = vencidas.length;

  for (const ag of vencidas) {
    const ocorrenciaEm = ag.proximaEm;
    if (!(await tomarPosse(ag, workerId, instante))) { resumo.disputadas += 1; continue; }

    try {
      const destinos = await db().ragnabotAgendamentoDestino.findMany({
        where: { agendamentoId: ag.id, ativo: true },
        orderBy: { criadoEm: 'asc' },
      });
      if (!destinos.length) {
        // Sem destinatário ativo não há o que mandar. A ocorrência ainda avança: uma agenda sem
        // contato não pode ficar batendo na porta todo tique.
        resumo.semDestino += 1;
        log().warn?.(`[agendamento] "${ag.titulo}" venceu sem nenhum destinatário ativo`);
        continue;
      }

      // Exigência nº 6, na porta de entrada: a caixa ainda existe e está ligada?
      const caixa = await db().ragnabotInbox.findFirst({
        where: { tenantId: ag.tenantId, cwInboxId: ag.cwInboxId },
      }).catch(() => null);
      const caixaFora = !caixa || caixa.removedAt != null;

      for (const destino of destinos) {
        resumo.envios += 1;
        if (caixaFora) {
          const r = await reservarEnvio({ agendamento: ag, destino, ocorrenciaEm, workerId, instante });
          if (!r.reservado) { resumo.jaCuidados += 1; continue; }
          await adiarEnvio(r.chave, {
            motivo: MOTIVOS.CAIXA_INATIVA,
            erro: `a conexão ${ag.cwInboxId} não está ativa nesta empresa — a mensagem NÃO foi perdida, será tentada de novo`,
            tentativaAtual: 0,
            instante,
          });
          resumo.adiados += 1;
          continue;
        }
        const r = await dispararDestino({ agendamento: ag, destino, ocorrenciaEm, workerId, instante });
        if (r.desfecho === 'enviado') resumo.enviados += 1;
        else if (r.desfecho === 'sem_janela') resumo.semJanela += 1;
        else if (r.desfecho === 'adiado') resumo.adiados += 1;
        else if (r.desfecho === 'falhou') resumo.falhas += 1;
        else if (r.desfecho === 'duvidoso') resumo.duvidosos += 1;
        else if (r.desfecho === 'ja_cuidado') resumo.jaCuidados += 1;
      }
      resumo.disparadas += 1;
    } finally {
      await avancarOcorrencia(ag, instante);
    }
  }

  return resumo;
}

/**
 * A segunda varredura: os envios `adiado` cujo recuo venceu.
 *
 * ⚠️ SÓ `adiado` ENTRA AQUI. `duvidoso` NUNCA, e é o ponto inteiro do arquivo: adiado é o que eu
 * SEI que não saiu; duvidoso é o que eu não sei. Ampliar este `where` para incluir `duvidoso`
 * transformaria a proteção contra mensagem dobrada em decoração.
 */
export async function retentarAdiados({ limite = 50, workerId = 'agendamento-worker' } = {}) {
  const resumo = { vistos: 0, enviados: 0, semJanela: 0, adiados: 0, falhas: 0, duvidosos: 0 };
  const instante = agora();

  const pendentes = await db().ragnabotAgendamentoEnvio.findMany({
    where: { status: STATUS_ENVIO.ADIADO, proximaTentativaEm: { not: null, lte: instante } },
    orderBy: { proximaTentativaEm: 'asc' },
    take: limite,
  });
  resumo.vistos = pendentes.length;

  for (const envio of pendentes) {
    const [ag, destino] = await Promise.all([
      db().ragnabotAgendamento.findUnique({ where: { id: envio.agendamentoId } }),
      db().ragnabotAgendamentoDestino.findUnique({ where: { id: envio.destinoId } }),
    ]);
    // Agenda cancelada ou destinatário removido no meio do caminho: o envio fecha com o motivo,
    // em vez de girar até o teto de tentativas dizendo «não achei».
    if (!ag || ag.status === STATUS.CANCELADO) {
      await fecharEnvio(envio.chave, { status: STATUS_ENVIO.CANCELADO, motivo: MOTIVOS.AGENDAMENTO_CANCELADO });
      continue;
    }
    if (!destino || destino.ativo === false) {
      await fecharEnvio(envio.chave, { status: STATUS_ENVIO.CANCELADO, motivo: 'destinatario_removido' });
      continue;
    }
    // Reabre a linha para o disparo (a mesma chave, a mesma linha — nunca uma nova).
    //
    // ⚠️ `reservadoEm` É RENOVADO, e não é detalhe. É dele que o ceifador mede o prazo de
    // visibilidade. Sem renovar, uma linha adiada há vinte minutos voltaria a `reservado` já
    // VENCIDA — e o ceifador da OUTRA réplica a marcaria como `duvidoso` no mesmo instante em que
    // esta aqui está legitimamente mandando a mensagem. O resultado seria um registro dizendo
    // «pode ter saído» para um envio que saiu, com toda a certeza, dez segundos depois.
    await db().ragnabotAgendamentoEnvio.updateMany({
      where: { chave: envio.chave, status: STATUS_ENVIO.ADIADO },
      data: {
        status: STATUS_ENVIO.RESERVADO,
        donoWorker: workerId,
        proximaTentativaEm: null,
        reservadoEm: instante,
      },
    });
    const r = await dispararDestino({
      agendamento: ag, destino, ocorrenciaEm: envio.ocorrenciaEm, workerId,
      chaveExistente: envio.chave, tentativaAtual: envio.tentativas ?? 0, instante,
    });
    if (r.desfecho === 'enviado') resumo.enviados += 1;
    else if (r.desfecho === 'sem_janela') resumo.semJanela += 1;
    else if (r.desfecho === 'adiado') resumo.adiados += 1;
    else if (r.desfecho === 'falhou') resumo.falhas += 1;
    else if (r.desfecho === 'duvidoso') resumo.duvidosos += 1;
  }

  return resumo;
}

/**
 * O CEIFADOR — C3 em código.
 *
 * Duas coisas ficam presas quando um pod morre no meio:
 *   · a AGENDA, com `travadoEm` antigo. Solta-se: nada saiu por causa dela, e sem soltar a agenda
 *     nunca mais dispara.
 *   · o ENVIO, em `reservado` além do prazo. ⚠️ Este NÃO se solta: vira `duvidoso`. A reserva nasceu
 *     ANTES da rede, então pode ter saído. Soltar seria reenviar às cegas — exatamente a repetição
 *     que este módulo existe para impedir.
 */
export async function ceifarPresos({ segundos = POSSE_SEGUNDOS } = {}) {
  const instante = agora();
  const limite = somarMs(instante, -segundos * 1000);

  const agendas = await db().ragnabotAgendamento.updateMany({
    where: { status: STATUS.PENDENTE, travadoEm: { not: null, lt: limite } },
    data: { donoWorker: null, travadoEm: null },
  });

  const envios = await db().ragnabotAgendamentoEnvio.updateMany({
    where: { status: STATUS_ENVIO.RESERVADO, reservadoEm: { lt: limite } },
    data: {
      status: STATUS_ENVIO.DUVIDOSO,
      motivo: MOTIVOS.PROCESSO_CAIU,
      erro: 'o processo caiu entre a reserva e a confirmação do envio. Pode ter saído — por isso NÃO repito sozinho. Confira no destino e use "reenviar" se precisar.',
      donoWorker: null,
      concluidoEm: instante,
    },
  });

  if (agendas.count || envios.count) {
    log().warn?.(`[agendamento] ceifador: ${agendas.count} agenda(s) solta(s), ${envios.count} envio(s) marcados como duvidosos (não repito o que não sei se saiu)`);
  }
  return { agendasSoltas: agendas.count ?? 0, enviosDuvidosos: envios.count ?? 0 };
}

/** Uma rodada completa: ceifa, dispara o que venceu, retenta o que foi adiado. Nesta ordem — o
 *  ceifador primeiro, porque agenda presa por réplica morta não pode esperar o próximo tique. */
export async function rodada({ limite = 20, workerId = 'agendamento-worker' } = {}) {
  const ceifado = await ceifarPresos();
  const disparo = await dispararVencidos({ limite, workerId });
  const retentativa = await retentarAdiados({ limite: limite * 3, workerId });
  return { ceifado, disparo, retentativa };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REENVIO MANUAL — a única forma de repetir algo duvidoso, e ela tem dono
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * O operador olhou o destino, viu que a mensagem NÃO chegou, e manda de novo.
 *
 * ⚠️ CRIA UMA CHAVE NOVA (`tentativaManual + 1`), de propósito. Reusar a chave antiga faria o
 * `ON CONFLICT` recusar o reenvio — e o operador ficaria clicando num botão que não faz nada.
 * A tentativa antiga fica no histórico, com o desfecho dela: ninguém apaga o passado para justificar
 * o presente.
 */
export async function reenviarManual({ chave, workerId = 'agendamento-reenvio' }) {
  const antigo = await db().ragnabotAgendamentoEnvio.findUnique({ where: { chave } });
  if (!antigo) return null;
  const [ag, destino] = await Promise.all([
    db().ragnabotAgendamento.findUnique({ where: { id: antigo.agendamentoId } }),
    db().ragnabotAgendamentoDestino.findUnique({ where: { id: antigo.destinoId } }),
  ]);
  if (!ag || !destino) return null;

  const r = await reservarEnvio({
    agendamento: ag, destino, ocorrenciaEm: antigo.ocorrenciaEm, workerId,
    tentativaManual: (antigo.tentativaManual ?? 0) + 1, instante: agora(),
  });
  if (!r.reservado) return { desfecho: 'ja_cuidado', chave: r.chave };
  return dispararDestino({
    agendamento: ag, destino, ocorrenciaEm: antigo.ocorrenciaEm, workerId, chaveExistente: r.chave,
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O LAÇO — quem o liga é o ARRANQUE, e é decisão do chefe
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @param {object} opcoes
 * @param {number} opcoes.intervaloMs  30 s por padrão: a granularidade útil de um agendamento é o
 *   MINUTO (ninguém marca «às 8h00m30s»), e meio minuto garante que a agenda das 8h saia às 8h e
 *   não às 8h01 — sem transformar o banco em alvo de pesquisa a cada segundo.
 * @returns {() => void} o desligador (para o SIGTERM)
 */
export function iniciarTrabalhadorDeAgendamento({ intervaloMs = 30_000, limite = 20, workerId = 'agendamento-worker' } = {}) {
  let rodando = false;
  const tique = async () => {
    // Nunca duas rodadas ao mesmo tempo NESTE processo. A trava entre RÉPLICAS é a posse no banco;
    // esta é só para o tique não empilhar quando uma rodada demora mais que o intervalo.
    if (rodando) return;
    rodando = true;
    try {
      await rodada({ limite, workerId });
    } catch (e) {
      log().error?.(`[agendamento] rodada falhou: ${e.message}`);
    } finally {
      rodando = false;
    }
  };
  const alarme = setInterval(tique, intervaloMs);
  if (typeof alarme.unref === 'function') alarme.unref();
  setTimeout(tique, 2_000).unref?.(); // uma primeira passada logo, sem bloquear a subida
  return () => clearInterval(alarme);
}

export default {
  POSSE_SEGUNDOS,
  configurarAgendamentoWorker, portasDoTrabalhadorDeAgendamento,
  avaliarJanela, tomarPosse, avancarOcorrencia, reservarEnvio, montarIntencao,
  dispararDestino, dispararVencidos, retentarAdiados, ceifarPresos, rodada,
  reenviarManual, iniciarTrabalhadorDeAgendamento,
};
