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
await montar('/api/ragnabot-webhook', './routes/ragnabot-webhook.routes.js');

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRABALHADORES
// ════════════════════════════════════════════════════════════════════════════════════════════════
const trabalhadores = {
  atendimento: { ligado: false, intervaloMs: 60_000, erro: null },
  despertar:   { ligado: false, intervaloMs: 15_000, erro: null },
  portaria:    { ligado: false, erro: null },
};
const desligadores = [];

export async function ligarTrabalhadores() {
  try {
    const atend    = await import('./services/ragnabot-atendimento-worker.service.js');
    const despertar = await import('./services/ragnabot-atend-despertar.service.js');
    const portaria  = await import('./services/ragnabot-portaria.service.js');
    const chatwoot  = (await import('./services/ragnabot-chatwoot.porta.js')).default;
    const politicas = await import('./services/ragnabot-atendimento.service.js');

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
    despertar.configurarDespertar({ chatwoot });
    const pararDespertar = despertar.iniciarConsumidorDeDespertar({ intervaloMs: trabalhadores.despertar.intervaloMs });
    desligadores.push(pararDespertar);
    trabalhadores.despertar.ligado = true;

    // Portaria: o elo do primeiro "oi". Fica exposta para quem recebe o evento do canal chamar.
    portaria.configurarPortaria({ atendimento: politicas });
    app.locals.ragnabotPortaria = portaria;
    trabalhadores.portaria.ligado = true;

    logger.info('[ragnabot] trabalhadores no ar: atendimento(60s), despertar(15s), portaria');
  } catch (e) {
    trabalhadores.atendimento.erro = trabalhadores.atendimento.erro ?? e.message;
    trabalhadores.despertar.erro   = trabalhadores.despertar.erro   ?? e.message;
    trabalhadores.portaria.erro    = trabalhadores.portaria.erro    ?? e.message;
    logger.error(`[ragnabot] trabalhadores não subiram: ${e.message}`);
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
    autenticacao: authIndisponivel ? { ok: false, motivo: authIndisponivel } : { ok: true },
    rotasPendentes: pendencias,
    instante: new Date().toISOString(),
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    out.banco = 'no ar';
  } catch (e) {
    out.bancoErro = e.message;
  }
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

export async function iniciar({ porta = Number(process.env.PORT || 3100) } = {}) {
  await ligarTrabalhadores();
  servidorHttp = app.listen(porta, () => logger.info(`[ragnabot] ouvindo na porta ${porta}`));
  for (const s of ['SIGTERM', 'SIGINT']) {
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
