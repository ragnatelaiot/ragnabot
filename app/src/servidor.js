// ════════════════════════════════════════════════════════════════════════════════════════════════
// SERVIDOR DO RAGNABOT — o processo `ragnabot-motor`.
//
// Etapa 1 da separação (doc 33): MUDANÇA DE CASA, não reescrita. Este arquivo é o único código
// novo da etapa; os 18 serviços e as 10 rotas são cópia fiel do que roda hoje dentro do NOC, com
// os imports da camada de base redirecionados para `src/base/`.
//
// O QUE ELE FAZ
//   • monta as 10 rotas nos MESMOS caminhos que o NOC usa hoje (`/api/ragnabot-*`), na MESMA ordem
//     e com travas equivalentes;
//   • liga os trabalhadores: atendimento (60s), despertar (15s) e a portaria de entrada;
//   • expõe `GET /saude` para as sondas do Kubernetes;
//   • desliga com elegância no SIGTERM.
//
// ⚠️ O QUE ELE NÃO FAZ, DE PROPÓSITO
//   1. NÃO define quem autentica. Hoje quem autentica é o `authMiddleware` do NOC, que NÃO é do
//      Ragnabot e não foi copiado. Aqui a autenticação é IMPORTADA de `./base/auth.js` (arquivo do
//      outro agente). Enquanto ela não existir/decidir, o processo sobe com as rotas privadas
//      RECUSANDO (503) em vez de abrir — falha fechada, nunca aberta.
//      >>> DECISÃO PENDENTE DO CHEFE: quem autentica na aplicação nova. <<<
//   2. NÃO liga o worker de backup (`ragnabot-backup.service.js`). O §4 do doc 33 mantém o backup
//      no NOC de propósito: "backup é vigilância externa; feito por quem é vigiado vale menos".
//      O serviço foi copiado (é do Ragnabot), mas quem o agenda continua sendo o NOC.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import prisma from './base/db.js';
import logger from './base/logger.js';
import VERSAO from './base/versao.js';

// ⚠️ A autenticação vem da camada de base (outro agente). Se o arquivo ainda não existe, o processo
// NÃO cai: ele sobe com um guarda que RECUSA tudo que é privado. O webhook, que é público por
// natureza, continua funcionando — é ele que sustenta o atendimento.
let autenticar;
let adminOnly;
let superuserOnly;
let authIndisponivel = null;
try {
  const auth = await import('./base/auth.js');
  autenticar     = auth.authMiddleware ?? auth.autenticar ?? auth.default;
  adminOnly      = auth.adminOnly      ?? ((req, res, next) => next());
  superuserOnly  = auth.superuserOnly  ?? ((req, res, next) => next());
  if (typeof autenticar !== 'function') throw new Error('base/auth.js não exporta authMiddleware');
} catch (e) {
  authIndisponivel = e.message;
  logger.error(`[ragnabot] AUTENTICAÇÃO INDISPONÍVEL (${e.message}) — rotas privadas vão recusar com 503`);
  const recusa = (req, res) => res.status(503).json({
    error: 'autenticação da aplicação Ragnabot ainda não definida',
    code: 'AUTH_NAO_CONFIGURADA',
  });
  autenticar = recusa; adminOnly = recusa; superuserOnly = recusa;
}

export const app = express();

// `trust proxy` importa: o webhook registra `req.ip` no log de token inválido, e atrás do Ingress
// do Kubernetes o IP verdadeiro só aparece se confiarmos no cabeçalho.
app.set('trust proxy', process.env.RAGNABOT_TRUST_PROXY ?? 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '10mb' }));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MONTAGEM DAS ROTAS
//
// Montagem TOLERANTE: uma rota que não carrega (por exemplo, porque ainda importa uma peça do NOC
// que não veio junto — ver §"pendências" no relatório da S1) não pode derrubar o processo inteiro
// e levar o atendimento junto. Ela fica registrada em `pendencias` e APARECE no `/saude`, em vez
// de sumir em silêncio. `/saude` devolve 503 enquanto houver pendência.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const pendencias = [];

async function montar(caminho, arquivo, ...travas) {
  try {
    const mod = await import(arquivo);
    app.use(caminho, ...travas, mod.default);
    logger.info(`[ragnabot] rota montada: ${caminho}`);
    return true;
  } catch (e) {
    pendencias.push({ caminho, arquivo, erro: e.message });
    logger.error(`[ragnabot] ROTA NÃO MONTADA ${caminho} (${arquivo}): ${e.message}`);
    app.use(caminho, (req, res) => res.status(503).json({
      error: 'rota indisponível nesta instalação', code: 'ROTA_PENDENTE', detalhe: e.message,
    }));
    return false;
  }
}

// ── Webhook: PÚBLICO, e ANTES de qualquer trava ────────────────────────────────────────────────
// Mesma razão do NOC (server.js:527-535): no NOC ele TEM de vir antes do `app.use('/api', auth)`,
// que captura todo /api/*. Aqui não existe esse captura-tudo, mas a ordem fica igual de propósito
// — é o contrato com a plataforma, e ordem que muda "porque agora dá" é armadilha para o próximo.
// A proteção dele é o segredo próprio (RAGNABOT_WEBHOOK_SEGREDO, comparação resistente a timing),
// e ele responde 200 SÓ DEPOIS DE GRAVAR (erro → 500 → o Chatwoot reenvia).
// ── ENTRADA DE SESSÃO ───────────────────────────────────────────────────────────────────────────
// Público de propósito: é o lugar onde ainda NÃO há sessão. Pô-lo atrás da autenticação o deixaria
// inalcançável e ninguém entraria nunca. A proteção dele é a própria plataforma (que confere a
// senha), o freio de tentativas e o segredo de sessão — sem o segredo, RECUSA com 503.
// Vem ANTES do desvio-para-a-página: senão um `GET /sessao/eu` do navegador (que pede text/html)
// receberia a PÁGINA, e a tela leria `<` onde esperava dados.
await montar('/sessao', './rotas-sessao.js');

await montar('/api/ragnabot-webhook', './routes/ragnabot-webhook.routes.js');

// Webhook do Pix (Efí) — PÚBLICO pelo mesmo motivo do de cima: é o provedor avisando que o cliente
// pagou, e um 401 aqui perderia a confirmação em silêncio. A metade PRIVADA deste router (criar
// cobrança, credencial) aplica a autenticação lá dentro, depois das rotas de webhook.
// ⚠️ A validação de mTLS de ENTRADA que o BACEN exige é do nginx (doc 36 §3.1), não deste processo.
await montar('/api/ragnabot-pagamento', './routes/ragnabot-pagamento.routes.js');

// ── Rotas privadas, na MESMA ordem e com as MESMAS travas do NOC ────────────────────────────────
// cluster: adminOnly no mount (leitura do cluster).
await montar('/api/ragnabot-cluster', './routes/ragnabot-cluster.routes.js', autenticar, adminOnly);
// sso: só super user — a trava mais estrita fica DENTRO do router, como no NOC.
await montar('/api/ragnabot-sso', './routes/ragnabot-sso.routes.js', autenticar);
// SaaS multiempresa e cobrança. Caminhos DISTINTOS de propósito: os dois routers definem `/planos`
// e colidiriam no mesmo prefixo. Cobrança é `superuserOnly` dentro do router porque mexe em dinheiro.
await montar('/api/ragnabot', './routes/ragnabot-tenant.routes.js', autenticar, adminOnly);
await montar('/api/ragnabot-cobranca', './routes/ragnabot-cobranca.routes.js', autenticar, adminOnly);
// origens autorizadas (de quem aceitamos chamado).
await montar('/api/ragnabot-origem', './routes/ragnabot-origem.routes.js', autenticar, adminOnly);
// auditoria: SEM adminOnly no mount — o admin de EMPRESA consulta a auditoria DELE; o isolamento
// é feito por `escopoDe`, não pelo middleware.
await montar('/api/ragnabot-auditoria', './routes/ragnabot-auditoria.routes.js', autenticar);
// editor de fluxo: SEM adminOnly — o router devolve 404 para o que está fora do escopo da empresa
// (404 e não 403, para não revelar a existência de fluxo de outra empresa).
await montar('/api/ragnabot-fluxo', './routes/ragnabot-fluxo.routes.js', autenticar);
// automações de atendimento: mesma regra do editor de fluxo.
await montar('/api/ragnabot-atendimento', './routes/ragnabot-atendimento.routes.js', autenticar);
// respostas rápidas: mesma regra dos vizinhos.
await montar('/api/ragnabot-respostas-rapidas', './routes/ragnabot-respostas-rapidas.routes.js', autenticar);
// agente de IA (Capitão): mesma regra dos vizinhos — sem `adminOnly` no mount, o isolamento é por
// `escopoDe()` e o papel é conferido dentro do router.
await montar('/api/ragnabot-capitao', './routes/ragnabot-capitao.routes.js', autenticar);
// caixa de atendimento (contrato S2): SEM `adminOnly` no mount — quem vive nesta tela é o
// ATENDENTE. O isolamento por agente e por setor é imposto no `where` da consulta, dentro do
// serviço, nunca por esconder item de menu.
await montar('/api/ragnabot-caixa', './routes/ragnabot-caixa.routes.js', autenticar);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRABALHADORES
// ════════════════════════════════════════════════════════════════════════════════════════════════
const trabalhadores = {
  atendimento: { ligado: false, intervaloMs: 60_000, erro: null },
  despertar:   { ligado: false, intervaloMs: 15_000, erro: null },
  portaria:    { ligado: false, erro: null },
  // ⭐ Contrato S-ADAPTADOR (02/09/2026). `motor` aqui NÃO é "o executor está rodando" — é "as
  // portas do motor estão amarradas". A distinção é o ponto: até hoje `configurarMotor()` não era
  // chamado em lugar nenhum, então o motor montava a mensagem e não havia ninguém do outro lado.
  motor: { portasAmarradas: false, executorLigado: false, erro: null, faltando: [] },
  // ⭐ Contrato S-FILA (02/09/2026). ESTE é «o executor está rodando»: o laço que tira trabalho de
  // `RagnabotFluxoFila` e chama `motor.rodadaDoExecutor()`. Enquanto ele não existiu, o motor
  // estava amarrado e mudo — a conversa entrava na fila e ninguém a tirava de lá.
  executorFluxo: {
    ligado: false, intervaloMs: null, workerId: null, erro: null,
    motivo: null, // por que NÃO está ligado, quando não está
  },
  // ⭐ Contrato S-CAIXAS (02/09/2026). Rotina LENTA (tique de 15 min), e não fila: ela reconcilia
  // `RagnabotInbox` com as caixas que existem de fato na plataforma. Entrou porque em 02/09 a
  // plataforma tinha 4 caixas e o nosso cadastro estava VAZIO — a função de reconciliação existia
  // desde 28/08 e nunca havia sido chamada por ninguém.
  caixas: { ligado: false, intervaloMs: null, erro: null },
};
const desligadores = [];

// Tique da reconciliação das caixas. LARGO de propósito: o que ela protege («a caixa mudou de nome
// ou sumiu lá fora e ninguém aqui soube») muda em escala de dias, e cada passada é uma leitura na
// plataforma POR EMPRESA. Ajustável por ambiente para quem precisar apertar num diagnóstico.
const INTERVALO_CAIXAS_MS = Math.max(60_000, Number(process.env.RAGNABOT_CAIXAS_INTERVALO_MS || 15 * 60 * 1000));

/** Identidade desta réplica. No Kubernetes `hostname` é o nome do pod, e é ele que aparece em
 *  `donoWorker` — sem isso, «quem estava com esta conversa quando o pod morreu?» não tem resposta.
 *  O pid entra porque em desenvolvimento duas instâncias dividem o mesmo hostname. */
const WORKER_ID = `${os.hostname()}#${process.pid}`;

export async function ligarTrabalhadores() {
  try {
    const atend    = await import('./services/ragnabot-atendimento-worker.service.js');
    const despertar = await import('./services/ragnabot-atend-despertar.service.js');
    const portaria  = await import('./services/ragnabot-portaria.service.js');
    const chatwoot  = (await import('./services/ragnabot-chatwoot.porta.js')).default;
    const politicas = await import('./services/ragnabot-atendimento.service.js');
    const canalPorta = await import('./services/ragnabot-canal.porta.js');

    // As portas são INJETADAS aqui, não importadas lá dentro — foi o que permitiu testar todas as
    // regras de tempo contra um dublê, sem plataforma no ar. Mesmo desenho do NOC (server.js:738).
    //
    // A regra de expediente existe implementada duas vezes (no trabalhador e no serviço de
    // políticas); injetar a do serviço faz dele a única verdade. Duas implementações da mesma
    // regra que podem divergir em silêncio é como se erra o horário de um cliente.
    atend.configurarTrabalhador({ chatwoot, politicas });
    const pararAtend = atend.iniciarTrabalhadorDeAtendimento({ intervaloMs: trabalhadores.atendimento.intervaloMs });
    desligadores.push(pararAtend);
    trabalhadores.atendimento.ligado = true;

    // Tique de 15s (o trabalhador é de 60): quando o trabalho chega aqui o prazo JÁ venceu.
    // Consome `atend_relogio` (o "ainda está aí?") e `atend_mensagem` (mensagem avulsa da portaria).
    // ⭐ A PORTA DO CANAL, injetada nos DOIS consumidores. Sem ela o despertar degradava com aviso
    // («porta de canal ausente») e o texto para o cliente nunca saía — o estado mudava, a mensagem
    // não. Agora ele fala.
    despertar.configurarDespertar({ chatwoot, canal: canalPorta.portaCanal });
    const pararDespertar = despertar.iniciarConsumidorDeDespertar({ intervaloMs: trabalhadores.despertar.intervaloMs });
    desligadores.push(pararDespertar);
    trabalhadores.despertar.ligado = true;

    // Portaria: o elo do primeiro "oi". Fica exposta para quem recebe o evento do canal chamar.
    portaria.configurarPortaria({ atendimento: politicas });
    app.locals.ragnabotPortaria = portaria;
    trabalhadores.portaria.ligado = true;

    // ⭐ SINCRONIZAÇÃO DAS CAIXAS (contrato S-CAIXAS). Não bloqueia a subida: a primeira passada é
    // agendada para daqui a alguns segundos e o tique é de 15 minutos. Falha dela NÃO derruba o
    // processo nem os outros trabalhadores — cadastro desatualizado degrada o canal (fica sem
    // botão, sem janela de 24 h conhecida); cadastro que impedisse o motor de subir seria pior.
    try {
      const tenantsSvc = await import('./services/ragnabot-tenant.service.js');
      const pararCaixas = tenantsSvc.iniciarSincronizacaoDeCaixas({ intervaloMs: INTERVALO_CAIXAS_MS });
      desligadores.push(pararCaixas);
      trabalhadores.caixas.ligado = true;
      trabalhadores.caixas.intervaloMs = INTERVALO_CAIXAS_MS;
    } catch (e) {
      trabalhadores.caixas.erro = e.message;
      logger.warn(`[ragnabot] sincronização de caixas não subiu: ${e.message}`);
    }

    const amarrado = await amarrarMotorDeFluxo(canalPorta);

    // ⭐ O ELO QUE FALTAVA (contrato S-FILA). Sem este laço, tudo o que vem antes é encanamento
    // sem água: a portaria grava o trabalho, o motor sabe executá-lo, o adaptador sabe falar com o
    // cliente — e ninguém tira o trabalho da fila. É a última porta do caminho do primeiro «oi».
    if (amarrado) await ligarExecutorDeFluxo(amarrado);

    // Caixa de atendimento (contrato S2): a porta da plataforma serve às sincronizações de setor e
    // de membros. As CONSULTAS da caixa não passam por ela — leem o índice do NOSSO banco, que é
    // onde a regra de visibilidade por agente e por setor pode ser imposta num `where`.
    //
    // ⚠️ EM `try` PRÓPRIO, e por último: a caixa é conveniência de LEITURA. Se a amarração dela
    // falhasse dentro do bloco geral, levaria junto a portaria e o executor — ou seja, o cliente
    // ficaria sem resposta por causa de uma tela. A ordem do estrago tem de ser a inversa.
    try {
      const caixa = await import('./services/ragnabot-caixa.service.js');
      caixa.configurarCaixa({ plataforma: chatwoot });
      // Retrocarga (contrato S3): é ela que traz para o índice as conversas que já existiam ANTES
      // do webhook ser cadastrado. Sem esta amarração a rota responde 503 com o motivo — nunca
      // grava uma caixa vazia dizendo que deu certo.
      const retro = await import('./services/ragnabot-caixa-retrocarga.service.js');
      retro.configurarRetrocarga({ plataforma: chatwoot, caixa });
    } catch (e) {
      logger.warn(`[ragnabot] caixa de atendimento sem porta de plataforma: ${e.message} `
        + '(as consultas seguem funcionando; só a sincronização de setores e a retrocarga ficam indisponíveis)');
    }

    logger.info('[ragnabot] trabalhadores no ar: atendimento(60s), despertar(15s), portaria'
      + (trabalhadores.caixas.ligado ? `, caixas(${Math.round(INTERVALO_CAIXAS_MS / 1000)}s)` : '')
      + (trabalhadores.executorFluxo.ligado ? `, executor de fluxo(${trabalhadores.executorFluxo.intervaloMs}ms)` : ''));
  } catch (e) {
    trabalhadores.atendimento.erro = trabalhadores.atendimento.erro ?? e.message;
    trabalhadores.despertar.erro   = trabalhadores.despertar.erro   ?? e.message;
    trabalhadores.portaria.erro    = trabalhadores.portaria.erro    ?? e.message;
    trabalhadores.executorFluxo.erro = trabalhadores.executorFluxo.erro ?? e.message;
    logger.error(`[ragnabot] trabalhadores não subiram: ${e.message}`);
  }
}

/**
 * AMARRA AS PORTAS DO MOTOR DE FLUXO (contrato S-ADAPTADOR, 02/09/2026).
 *
 * EXPORTADA de propósito: `tests/ragnabot-motor-amarracao.test.mjs` chama ESTA função — a mesma
 * que o processo chama — para provar que a porta `canal` fica de fato amarrada. Um teste que
 * refizesse a amarração provaria a cópia, não o arranque.
 *
 * ⚠️ O QUE ISTO LIGA, E O QUE NÃO LIGA — a diferença importa e está no `/saude`:
 *   · LIGA o DESPACHO: `canal` (a PortaCanal recém-escrita) e `nos` (o catálogo de executores).
 *     A partir daqui, qualquer caminho que chegue a `motor.passo()` consegue de fato falar com o
 *     cliente. Antes, `exigirPorta('canal')` lançava `ConfiguracaoAusente` no primeiro despacho.
 *   · LIGA a FILA (contrato S-FILA, 02/09/2026). Era a última porta ausente do caminho do
 *     cliente: `RagnabotFluxoFila` existia no schema, a portaria e o motor já GRAVAVAM trabalho
 *     nela, e ninguém nunca tirava nada de lá. Com `ragnabot-fluxo-fila.service.js` amarrado aqui,
 *     `rodadaDoExecutor()` deixa de lançar `ConfiguracaoAusente` — e quem LIGA o laço é
 *     `ligarExecutorDeFluxo()`, logo abaixo, que é uma decisão separada de propósito (dá para ter
 *     o motor de pé com o consumo da fila parado).
 *   · CONTINUA sem `cofre`, `egresso` e `limites`, que não têm implementação neste repositório.
 *     Injetar um objeto vazio faria o motor achar que tem porta e falhar mais tarde, mais fundo.
 *     Fica declarado em `/saude` como pendência nomeada, que é honesto e acionável.
 *
 * Amarrar as portas é barato e não tem efeito colateral: `configurarMotor` só guarda referências.
 */
export async function amarrarMotorDeFluxo(canalPorta) {
  try {
    const motor = await import('./services/ragnabot-fluxo-motor.service.js');
    const nos = await import('./services/ragnabot-fluxo-nos.service.js');
    const fila = await import('./services/ragnabot-fluxo-fila.service.js');

    motor.configurarMotor({
      canal: canalPorta.portaCanal,
      nos: nos.catalogoDeNos,
      fila,
      // `protocolo` já vem com o serviço real por padrão; `cofre`, `egresso`, `limites` e
      // `telemetria` continuam sem implementação neste repositório e por isso NÃO são injetados.
    });

    trabalhadores.motor.portasAmarradas = true;
    trabalhadores.motor.faltando = ['cofre', 'egresso', 'limites'];
    logger.info('[ragnabot] motor de fluxo: portas `canal`, `nos` e `fila` amarradas');
    return { motor, fila };
  } catch (e) {
    trabalhadores.motor.erro = e.message;
    logger.error(`[ragnabot] não consegui amarrar as portas do motor de fluxo: ${e.message}`);
    return null;
  }
}

/**
 * LIGA O LAÇO DO EXECUTOR — quem tira trabalho da fila e faz o motor marchar (contrato S-FILA).
 *
 * EXPORTADA de propósito, pelo mesmo motivo de `amarrarMotorDeFluxo`: o teste chama ESTA função,
 * a mesma que o processo chama. Um teste que refizesse a decisão provaria a cópia, não o arranque.
 *
 * ⚠️ SEPARADA DA AMARRAÇÃO, e a separação é o desenho. Amarrar é guardar referência; ligar é passar
 * a consumir a fila e a falar com cliente. Poder ter o primeiro sem o segundo é o que permite subir
 * o motor num aperto — com as rotas, o editor e a portaria gravando entrada — sem que ele responda
 * a ninguém, enquanto se investiga.
 *
 * ⚠️ A CHAVE DE DESLIGAR É `RAGNABOT_EXECUTOR_FLUXO`, e o padrão (variável ausente) é LIGADO: o
 * valor omitido tem de ser o que atende o cliente. Quem decide é `fila.executorHabilitado()`, uma
 * função pura, para o desligamento ser verificável em teste e não depender do processo estar de pé.
 */
export async function ligarExecutorDeFluxo({ motor, fila, intervaloMs } = {}) {
  try {
    const m = motor ?? await import('./services/ragnabot-fluxo-motor.service.js');
    const f = fila ?? await import('./services/ragnabot-fluxo-fila.service.js');

    if (!f.executorHabilitado()) {
      const motivo = 'desligado por RAGNABOT_EXECUTOR_FLUXO';
      trabalhadores.executorFluxo = { ...trabalhadores.executorFluxo, ligado: false, motivo };
      // Mesmo desligado, a devolução no encerramento fica registrada: custa um UPDATE que não
      // encontra nada, e fecha a janela em que alguém religa a variável em tempo de execução (ou
      // reaproveita o mesmo `workerId`) e o trabalho reservado fica órfão até o ceifador.
      desligadores.push(async () => { await f.devolverJobsDoWorker(WORKER_ID).catch(() => {}); });
      logger.warn(`[ragnabot] executor de fluxo NÃO ligado — ${motivo}. `
        + 'A fila continua RECEBENDO trabalho; ninguém o consome até religar.');
      return { ligado: false, motivo };
    }

    // ⚠️ CONFERE A ESTRUTURA ANTES DE LIGAR. Sem a migração 05, `enfileirar()` estoura em TODA
    // mensagem — e o dono veria «o robô não responde», sem nada apontando para o banco. Isto não
    // IMPEDE o executor de subir (o consumo do que já está na fila continua valendo); ele sobe
    // gritando, com o nome do arquivo a aplicar, e o estado fica no `/saude`.
    const estrutura = await f.conferirEstrutura();
    if (!estrutura.ok) {
      logger.error(`[ragnabot] ⚠️ FILA SEM A MIGRAÇÃO 05 — falta ${estrutura.faltando.join(', ')}. `
        + `${estrutura.comoCorrigir}. Enquanto isso, enfileirar vai falhar e o robô não responde.`);
    }

    const ms = Number(intervaloMs ?? process.env.RAGNABOT_EXECUTOR_INTERVALO_MS ?? 500);
    const parar = f.iniciarExecutorDeFluxo(m, { workerId: WORKER_ID, intervaloMs: ms });
    desligadores.push(parar);

    // ⚠️ O ENCERRAMENTO GRACIOSO ENTRA JUNTO, e não é opcional. Ele espera os passos em voo,
    // devolve o trabalho deste worker para `pendente` e solta as posses. Sem ele, cada implantação
    // deixa N conversas paradas até o ceifador (90 s) — e num RollingUpdate isso é toda vez.
    // A "sessão a proteger" aqui é a CONVERSA de um cliente, que não aparece em
    // /api/health/active-sessions: a proteção tem de estar no PROCESSO, não no procedimento.
    desligadores.push(async () => {
      const r = await m.encerrarGraciosamente(WORKER_ID).catch((e) => ({ erro: e.message }));
      logger.info(`[ragnabot] encerramento do executor: ${JSON.stringify(r)}`);
    });

    trabalhadores.executorFluxo = {
      ligado: true, intervaloMs: ms, workerId: WORKER_ID, erro: null, motivo: null, estrutura,
    };
    // ⚠️ O campo antigo `motor.executorLigado` (do contrato S-ADAPTADOR) tinha de deixar de mentir:
    // ele nasceu `false` como declaração honesta de «a fila não existe» e, agora que existe,
    // continuar em `false` seria mentira para baixo — a que faz alguém perder a tarde investigando.
    trabalhadores.motor.executorLigado = true;
    logger.info(`[ragnabot] executor de fluxo LIGADO (tique de ${ms} ms, worker ${WORKER_ID})`);
    return { ligado: true, intervaloMs: ms, workerId: WORKER_ID, parar };
  } catch (e) {
    trabalhadores.executorFluxo = { ...trabalhadores.executorFluxo, ligado: false, erro: e.message };
    logger.error(`[ragnabot] executor de fluxo não subiu: ${e.message}`);
    return { ligado: false, erro: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SAÚDE — para as sondas do Kubernetes
//
// 503 quando o banco não responde, quando um trabalhador não subiu ou quando sobrou pendência de
// rota. Sonda que responde 200 com o motor parado é pior que sonda nenhuma: ela ESCONDE a parada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
app.get('/saude', async (req, res) => {
  const out = {
    servico: 'ragnabot-motor',
    // Lê do módulo `base/versao.js`, que busca o arquivo VERSAO (a fonte única do número que o
    // dono acompanha). Antes lia uma variável de ambiente que NINGUÉM definia, e o /saude devolvia
    // `versao: null` — um dos dois agentes escreveu o leitor e o outro não o usou.
    versao: VERSAO || process.env.RAGNABOT_VERSAO || null,
    banco: 'fora',
    trabalhadores,
    // Diz QUAIS caminhos de identidade estão configurados (cookie, token de serviço, os dois), sem
    // revelar segredo. Sem isto, "ninguém consegue entrar" e "o motor subiu sem a chave de sessão"
    // são indistinguíveis de fora — e alguém passa uma tarde nisso.
    autenticacao: authIndisponivel
      ? { ok: false, motivo: authIndisponivel }
      : { ok: true, ...(await import('./base/auth.js')).autenticacaoPronta() },
    rotasPendentes: pendencias,
    instante: new Date().toISOString(),
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    out.banco = 'no ar';
  } catch (e) {
    out.bancoErro = e.message;
  }

  // ── A FILA DO MOTOR (contrato S-FILA) ─────────────────────────────────────────────────────────
  // ⚠️ FILA QUE CRESCE EM SILÊNCIO é como se descobre tarde que o motor parou. E o número que
  // importa NÃO é o tamanho: fila com 500 trabalhos girando em 2 s está sadia; fila com 3 parados
  // há 40 min é o motor MORTO — e «tamanho» não distingue uma coisa da outra. Por isso vai também
  // a IDADE do mais antigo e o ATRASO do mais atrasado.
  //
  // ⚠️ ISTO **NÃO** DERRUBA A SONDA. Fila grande não é motivo para o Kubernetes tirar o pod de
  // serviço — tirar o pod é justamente o que faz a fila crescer mais. O número informa; quem
  // decide o 503 continua sendo banco/trabalhador/rota.
  if (trabalhadores.executorFluxo.ligado || trabalhadores.motor.portasAmarradas) {
    try {
      const fila = await import('./services/ragnabot-fluxo-fila.service.js');
      out.filaDoMotor = {
        ...(await fila.resumoDaFila()),
        executor: {
          ligado: trabalhadores.executorFluxo.ligado,
          intervaloMs: trabalhadores.executorFluxo.intervaloMs,
          workerId: trabalhadores.executorFluxo.workerId,
          motivo: trabalhadores.executorFluxo.motivo,
          // Prova de que o laço GIRA, e não só de que foi ligado: um `setInterval` vivo com todas
          // as rodadas estourando parece ligado e não trabalha.
          ultimaRodada: fila.ultimaRodadaDoExecutor(),
        },
      };
    } catch (e) {
      out.filaDoMotor = { erro: e.message };
    }
  }

  // ── A PORTA DE ENTRADA (contrato S-PORTARIA) ──────────────────────────────────────────────────
  // ⚠️ «O robô não responde» não tem onde ser olhado sem isto. O evento chega, é descartado por uma
  // regra (certa ou errada) e some. O número que responde a pergunta NÃO é `recebidos`: é
  // `descartados` POR MOTIVO — é ele que distingue «ninguém escreveu» de «estamos descartando toda
  // mensagem de cliente porque o `message_type` veio num formato que o classificador não lê».
  //
  // ⚠️ ISTO **NÃO** DERRUBA A SONDA, pela mesma razão da fila: tirar o pod de serviço é o que faz
  // a mensagem parar de chegar. O número informa; quem decide o 503 continua sendo
  // banco/trabalhador/rota.
  try {
    const wh = await import('./routes/ragnabot-webhook.routes.js');
    out.webhookDeEntrada = wh.estatisticasDoWebhook();
  } catch (e) {
    out.webhookDeEntrada = { erro: e.message };
  }

  // ── O CADASTRO DAS CAIXAS (contrato S-CAIXAS) ─────────────────────────────────────────────────
  // «Rodou quando, e deu o quê» — sem isto, um cadastro vazio ou defasado só apareceria como
  // «o robô não responde direito» semanas depois. ⚠️ NÃO derruba a sonda, pelo mesmo motivo dos
  // dois blocos acima: tirar o pod de serviço não conserta cadastro nenhum.
  try {
    const tenantsSvc = await import('./services/ragnabot-tenant.service.js');
    out.cadastroDeCaixas = tenantsSvc.estadoDaSincronizacaoDeCaixas();
  } catch (e) {
    out.cadastroDeCaixas = { erro: e.message };
  }

  // ── A TELA (contrato S-PUBLICAR, 02/09/2026) ──────────────────────────────────────────────────
  // Duas perguntas que, sem isto, são indistinguíveis de fora e custam uma tarde cada:
  //   1. «a imagem subiu COM a tela?»  → `servida` | `ausente`
  //   2. «a tela foi construída para QUAL caminho?» → `prefixo`, lido do índice de verdade.
  // A (2) é a armadilha desta entrega: o prefixo é gravado NO PACOTE em tempo de construção
  // (`RAGNABOT_PREFIXO_WEB`), não é configurável no pod. Uma imagem construída para `/` publicada
  // em `/painel/` responde 200 e mostra tela BRANCA — o pior sintoma possível. Aqui o número
  // aparece antes de alguém abrir o navegador.
  out.interface = { estado: TEM_INTERFACE ? 'servida' : 'ausente', prefixo: PREFIXO_DA_INTERFACE };

  const saudavel = out.banco === 'no ar'
    && trabalhadores.atendimento.ligado
    && trabalhadores.despertar.ligado
    && trabalhadores.portaria.ligado
    && pendencias.length === 0;
  out.status = saudavel ? 'no ar' : 'degradado';
  res.status(saudavel ? 200 : 503).json(out);
});

// Sonda de vivacidade (liveness): responde enquanto o processo existe. Separada da de prontidão de
// propósito — degradado não é motivo para o Kubernetes MATAR o pod e perder os relógios em voo.
app.get('/vivo', (req, res) => res.json({ vivo: true }));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DESLIGAMENTO ELEGANTE
// Os trabalhadores devolvem a própria função de desligar; chamá-las é o que impede um relógio de
// disparar no meio do encerramento.
// ════════════════════════════════════════════════════════════════════════════════════════════════
let servidorHttp = null;
let desligando = false;

export async function desligar(sinal = 'SIGTERM') {
  if (desligando) return;
  desligando = true;
  logger.info(`[ragnabot] ${sinal} recebido — desligando`);
  for (const parar of desligadores) {
    try { await parar(); } catch (e) { logger.warn(`[ragnabot] desligador falhou: ${e.message}`); }
  }
  if (servidorHttp) await new Promise((ok) => servidorHttp.close(ok));
  try { await prisma.$disconnect(); } catch { /* já caiu, não importa */ }
  logger.info('[ragnabot] desligado');
}

// 3000 e não 3100: é o que o `EXPOSE` do Dockerfile declara e o que o manifesto do Kubernetes
// usa. Padrão diferente do declarado é armadilha — funciona no cluster (que passa PORT) e falha
// no teste local, que é justamente onde o problema sai barato.
// A INTERFACE (doc 33, Etapa 4) — a tela do editor de fluxo, servida pelo próprio motor.
//
// ⚠️ ESTE BLOCO VEM DEPOIS DE TODAS AS ROTAS. O desvio-para-a-página é um curinga: montado antes
// da API, ele responde HTML a `GET /api/…` e a tela quebra sem mensagem de erro.
//
// A pasta é opcional de propósito: se a imagem for construída sem a interface (ou em
// desenvolvimento, quando quem serve é o `vite`), o motor sobe igual e só não tem tela. Atendimento
// não pode depender de front-end existir.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const PASTA_INTERFACE = process.env.RAGNABOT_INTERFACE_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
const TEM_INTERFACE = fs.existsSync(path.join(PASTA_INTERFACE, 'index.html'));

/**
 * Para QUAL caminho esta tela foi construída — lido do índice, não suposto.
 *
 * ⚠️ Por que ler o arquivo em vez de confiar numa variável de ambiente: o prefixo é decidido na
 * CONSTRUÇÃO (`RAGNABOT_PREFIXO_WEB` no `Dockerfile`) e fica gravado dentro do índice, em cada
 * `src=`/`href=`. Uma variável no pod poderia dizer `/painel/` com um pacote construído para `/` —
 * e a divergência só apareceria como tela branca no navegador do dono. O índice é a fonte da
 * verdade porque é ele que o navegador obedece.
 *
 * Devolve `null` quando não há tela, ou quando o índice não tem nenhum arquivo com caminho
 * absoluto (não inventamos resposta: `null` diz «não sei», que é diferente de «é a raiz»).
 */
const PREFIXO_DA_INTERFACE = (() => {
  if (!TEM_INTERFACE) return null;
  try {
    const html = fs.readFileSync(path.join(PASTA_INTERFACE, 'index.html'), 'utf8');
    const m = html.match(/(?:src|href)="(\/[^"]*\/assets\/[^"]+|\/assets\/[^"]+)"/u);
    if (!m) return null;
    return m[1].slice(0, m[1].indexOf('assets/'));
  } catch { return null; }
})();

if (TEM_INTERFACE) {
  // ⛔ AQUI HAVIA `app.get('/interface/configuracao.js', …)`. REMOVIDO em 30/08/2026 pelo
  // contrato S4-AUTH — era exatamente a pendência do §3 deste arquivo, e o chefe escolheu o
  // caminho (C). NÃO reponha: aquele endpoint injetava o RAGNABOT_SERVICE_TOKEN no navegador.
  // Quem autentica a tela agora é `src/rotas-sessao.js` (cookie de sessão). O que montar, e em que
  // ordem, está em `app/src/COMO-MONTAR-SESSAO.md`.

  // ── 2. Os arquivos ────────────────────────────────────────────────────────────────────────────
  // `index: false` porque quem responde a raiz é o desvio abaixo — assim há UM caminho só para o
  // HTML, e o cabeçalho de cache é o mesmo em `/` e em `/qualquer-coisa`.
  app.use(express.static(PASTA_INTERFACE, { index: false, maxAge: '7d', etag: true }));

  // ── 3. O desvio-para-a-página ─────────────────────────────────────────────────────────────────
  // A tela guarda o fluxo aberto no `#hash`, não no caminho — mas o operador ainda pode colar uma
  // URL antiga (`/ragnabot-fluxos/<id>`), e um F5 numa dessas tem de devolver a página, não 404.
  //
  // ⚠️ AS EXCLUSÕES NÃO SÃO ENFEITE. Sem elas, um `GET /api/ragnabot-fluxo/saude` digitado errado
  // devolveria HTML com status 200, e quem estivesse diagnosticando leria "o motor respondeu".
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    if (req.path === '/saude' || req.path === '/vivo') return next();
    // A entrada de sessão responde JSON, sempre. Sem esta linha, um `GET /sessao/eu` com
    // `Accept: text/html` receberia a PÁGINA, e a tela leria "<" onde esperava JSON.
    if (req.path.startsWith('/sessao')) return next();
    // ⚠️ Só NAVEGAÇÃO. Um `.js`/`.css`/`.woff2` que não existe TEM de dar 404: devolver HTML no
    // lugar de um módulo faz o navegador falhar com "Unexpected token '<'", que não diz nada a
    // ninguém, e ainda por cima com status 200 — o pior dos dois mundos para quem diagnostica.
    //
    // ⛔ NÃO use `req.accepts('html')` aqui. Foi o que escrevi primeiro e o teste reprovou: um
    // pedido com `Accept: */*` (que é o que `fetch` manda por padrão, e o que várias sondas mandam)
    // CASA com 'html', e o arquivo inexistente voltava 200 com a página dentro.
    // Os dois filtros abaixo são o discriminador certo:
    //   · navegador navegando manda `Accept: text/html,…` explícito; buscar módulo/imagem, não;
    //   · caminho com extensão é pedido de ARQUIVO, e arquivo que não existe é 404, ponto.
    if (!(req.get('Accept') || '').includes('text/html')) return next();
    if (path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store');   // o index aponta para arquivos com hash; cachear o
    return res.sendFile(path.join(PASTA_INTERFACE, 'index.html'));   // index serve a versão velha
  });

  logger.info(`[ragnabot] interface servida de ${PASTA_INTERFACE}`
    + ` (construída para o caminho ${PREFIXO_DA_INTERFACE || '«não declarado»'})`);
} else {
  logger.warn('[ragnabot] interface NÃO encontrada — o motor sobe sem tela (só API)');
}

export async function iniciar({ porta = Number(process.env.PORT || 3000) } = {}) {
  await ligarTrabalhadores();
// ════════════════════════════════════════════════════════════════════════════════════════════════

  servidorHttp = app.listen(porta, () => logger.info(`[ragnabot] ouvindo na porta ${porta}`));

  // ⚠️ TOMAMOS O SINAL PARA NÓS — e isto foi MEDIDO, não suposto (contrato S-FILA, 02/09/2026).
  //
  // `src/base/db.js` registra, no `import`, um `process.once('SIGTERM')` que desconecta o Prisma e
  // chama `process.exit(143)`. Como ele é registrado ANTES (o import está no topo deste arquivo),
  // o Node o executa PRIMEIRO — e o `process.exit` dele matava o processo no meio do nosso
  // `desligar()`. Sintoma observado ao subir o motor de verdade: o log mostrava «executor de fluxo
  // desligado» e NUNCA chegava em «encerramento do executor». Ou seja, o encerramento gracioso do
  // motor — o que espera o passo em voo, devolve o trabalho deste worker para `pendente` e solta as
  // posses — simplesmente não acontecia. Em produção isso é, a cada implantação, um punhado de
  // conversas paradas até o ceifador (90 s), com o cliente olhando para um robô mudo.
  //
  // Tirar os ouvintes anteriores é seguro porque `desligar()` faz o que o de `db.js` fazia (o
  // `prisma.$disconnect()` está lá dentro) e mais: os desligadores dos trabalhadores. Quem assume o
  // encerramento assume inteiro — dois donos do mesmo sinal é como o gracioso vira abrupto.
  for (const s of ['SIGTERM', 'SIGINT']) {
    for (const anterior of process.listeners(s)) process.removeListener(s, anterior);
    process.on(s, () => { desligar(s).then(() => process.exit(0)); });
  }
  return servidorHttp;
}

// Só sobe sozinho quando é o módulo de entrada — importar este arquivo num teste não pode abrir
// porta nem ligar relógio.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await iniciar();
}

export default app;
