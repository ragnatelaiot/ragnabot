// ════════════════════════════════════════════════════════════════════════════════════════════════
// PAGAMENTO PIX (EFÍ BANK) — cobrar DENTRO da conversa.
//
// Base: /ia/.claude/modulo-atendimento/36-EFI-BANK-PAGAMENTOS.md (apurado na documentação oficial
// `dev.efipay.com.br` em 02/09/2026 — os fatos vêm de lá, não de memória).
//
// DECISÃO DO DONO (02/09/2026): provedor ÚNICO, Efí Bank. Começa pelo **Pix**; boleto e cartão
// ficam para depois — e ficam fáceis, porque a parte difícil (certificado e mTLS) é justamente a
// que boleto não tem.
//
// NÃO SE CONFUNDE COM `ragnabot-cobranca.service.js`: aquele é a MENSALIDADE DO SaaS (o cliente
// pagando a nós, pela API de Cobranças, sem certificado). Este é a empresa cliente cobrando o
// cliente DELA no meio do atendimento, pela API Pix — que exige certificado.
//
// ─── AS QUATRO COISAS QUE ESTE ARQUIVO GARANTE ──────────────────────────────────────────────────
// 1. OAuth2 Basic (Client_Id:Client_Secret) SOBRE mTLS com o `.p12` — a API Pix recusa sem o
//    certificado. O token fica em cache até expirar, com folga de 60 s.
// 2. O `txid` É NOSSO. `PUT /v2/cob/:txid` com id que nós geramos torna a CRIAÇÃO idempotente:
//    repetir a chamada devolve a MESMA cobrança, e não uma segunda cobrança para o mesmo cliente.
// 3. O WEBHOOK REPETE POR DESENHO (a Efí reentrega até receber 2xx). `chaveIdempotencia` única na
//    trilha + baixa CONDICIONAL (`updateMany where status:'aguardando'`) fazem a segunda entrega
//    ser REGISTRADA e não aplicada. É a lição do alerta de backup do CRCMA, agora em dinheiro.
// 4. NENHUM SEGREDO NO GIT, NEM NO LOG. `clientId`/`clientSecret`/senha do certificado/HMAC ficam
//    cifrados (aes-256-gcm) ou só no ambiente; o certificado é lido de arquivo montado por Secret;
//    e o `txid` aparece no log SEMPRE truncado (`redigirTxid`).
//
// ─── ⚠️ O QUE **NÃO** É DESTE ARQUIVO: o mTLS DE ENTRADA ────────────────────────────────────────
// O Banco Central exige que o endereço que recebe a confirmação de Pix EXIJA certificado de
// cliente — quem apresenta o certificado é a EFÍ, e quem valida somos nós. Isso é configuração de
// `server{}` no nginx (`ssl_client_certificate` + `ssl_verify_client on`), num vhost ISOLADO
// (ex.: `pix.ragnatela.com.br`), e é trabalho de INFRA, não deste código. Ver doc 36 §3.1.
//
// O que É nosso, e está aqui, são as camadas que rodam depois do nginx:
//    · conferência do IP de origem (`34.193.116.226`, o publicado pela Efí);
//    · HMAC na própria URL, comparado com `timingSafeEqual`;
//    · validação do CORPO (formato `{ pix: [...] }`, valores, txid conhecido).
// ⛔ Sem o vhost com mTLS, o webhook NÃO está completo — a validação de origem daqui é a segunda
//    cerca, não a primeira. Enquanto o vhost não existir, trabalhe em HOMOLOGAÇÃO (o padrão).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import prismaGlobal from '../base/db.js';
import logger from '../base/logger.js';
import { encrypt, decrypt } from '../base/crypto.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VOCABULÁRIO
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const STATUS_COBRANCA = Object.freeze({
  AGUARDANDO: 'aguardando',
  PAGO: 'pago',
  EXPIRADO: 'expirado',
  CANCELADO: 'cancelado',
  ERRO: 'erro',
});

export const RESULTADOS_EVENTO = Object.freeze({
  APLICADO: 'aplicado',
  IGNORADO_DUPLICADO: 'ignorado_duplicado',
  IGNORADO_DESCONHECIDO: 'ignorado_desconhecido',
  IGNORADO_JA_PAGO: 'ignorado_ja_pago',
  ERRO: 'erro',
});

/** IP publicado pela Efí para os webhooks (doc 36 §3). Camada extra, nunca a única. */
export const IP_EFI = '34.193.116.226';

/** Caracteres e tamanho do `txid` — exigência do BACEN: 26 a 35, `[a-zA-Z0-9]`. */
const TXID_MIN = 26;
const TXID_MAX = 35;

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO — homologação é o PADRÃO (B8). Ninguém testa cobrança em produção por engano.
// ────────────────────────────────────────────────────────────────────────────────────────────────
function env(nome, padrao = '') {
  const v = process.env[nome];
  return v === undefined || v === null || v === '' ? padrao : String(v);
}

export function urlBaseDoAmbiente(ambiente) {
  // As duas URLs vêm do doc 36 §2 (documentação oficial da Efí).
  return ambiente === 'producao' ? 'https://pix.api.efipay.com.br' : 'https://pix-h.api.efipay.com.br';
}

export function configuracaoPix() {
  // ⚠️ Só a palavra exata `producao` liga produção. Qualquer outra coisa — inclusive vazio, lixo
  // ou "prod" — cai em homologação. Falha fechada em dinheiro.
  const ambiente = env('EFI_PIX_AMBIENTE', env('EFI_AMBIENTE', 'homologacao')) === 'producao'
    ? 'producao' : 'homologacao';
  return {
    ambiente,
    urlBase: urlBaseDoAmbiente(ambiente),
    // Credenciais da CASA (a conta da Ragnatela). A credencial POR EMPRESA vem do banco (B7).
    clientId: env('EFI_PIX_CLIENT_ID', env('EFI_CLIENT_ID')),
    clientSecret: env('EFI_PIX_CLIENT_SECRET', env('EFI_CLIENT_SECRET')),
    certificadoCaminho: env('EFI_PIX_CERT_PATH'),
    certificadoSenha: env('EFI_PIX_CERT_SENHA'),
    chavePix: env('EFI_PIX_CHAVE'),
    // HMAC que viaja na URL do webhook. Sem ele, o endpoint recusa (503) em vez de aceitar aberto.
    webhookHmac: env('EFI_PIX_WEBHOOK_HMAC'),
    // Lista de IPs aceitos. Vazia = só o IP publicado pela Efí. Existe porque um dia a Efí muda o
    // IP e ninguém quer subir código para isso.
    ipsAceitos: env('EFI_PIX_WEBHOOK_IPS', IP_EFI).split(',').map((s) => s.trim()).filter(Boolean),
    // Endereço público que a Efí vai chamar. Registrado com `?ignorar=` para ela não acrescentar
    // `/pix` ao fim (doc 36 §3).
    urlWebhook: env('EFI_PIX_WEBHOOK_URL', ''),
    expiracaoPadraoSegundos: Number(env('EFI_PIX_EXPIRACAO_SEGUNDOS', '3600')) || 3600,
    tempoLimiteMs: Number(env('EFI_PIX_TIMEOUT_MS', '20000')) || 20000,
  };
}

/** O que falta para funcionar — em texto que o dono consegue agir sem perguntar nada a ninguém. */
export function situacaoDaIntegracao() {
  const c = configuracaoPix();
  const faltando = [];
  if (!c.clientId) faltando.push('EFI_PIX_CLIENT_ID');
  if (!c.clientSecret) faltando.push('EFI_PIX_CLIENT_SECRET');
  if (!c.certificadoCaminho) faltando.push('EFI_PIX_CERT_PATH');
  if (!c.chavePix) faltando.push('EFI_PIX_CHAVE');
  if (!c.webhookHmac) faltando.push('EFI_PIX_WEBHOOK_HMAC');
  return {
    ambiente: c.ambiente,
    urlBase: c.urlBase,
    ok: faltando.length === 0,
    faltando,
    certificadoNoDisco: c.certificadoCaminho ? existeArquivo(c.certificadoCaminho) : false,
    // Lembrete permanente: sem o vhost com mTLS, a confirmação automática não fecha o ciclo.
    mtlsDeEntradaNoNginx: 'exigido pelo BACEN e NÃO configurável por este código — ver doc 36 §3.1',
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTAS
// ────────────────────────────────────────────────────────────────────────────────────────────────
const portas = {
  db: prismaGlobal,
  log: logger,
  /**
   * Cliente HTTP. Injetável para o teste NUNCA sair para a rede.
   * @type {null | ((p:{metodo:string,url:string,cabecalhos:object,corpo:any,agente:any,tempoLimiteMs:number}) =>
   *   Promise<{status:number, dados:any}>)}
   */
  http: null,
  /** Auditoria da casa (rastro de dinheiro é auditoria de primeira classe — B6). */
  auditoria: null,
  /** Fila do motor: usada para acordar o fluxo quando o Pix é pago (modo `cobrar_e_aguardar`). */
  fila: null,
  relogio: null,
};

export function configurarPagamentoEfi(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no pagamento Efí: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return portasDoPagamento();
}
export function portasDoPagamento() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/**
 * As tabelas do Pix existem NESTE PROCESSO? O cliente Prisma é carregado no boot: a tabela existir
 * no banco não basta — o processo precisa ter sido reiniciado depois da migração.
 *
 * Importa mais aqui do que em qualquer outro lugar: sem esta conferência, o webhook da Efí toparia
 * um `TypeError` cru, devolveria 500, e a Efí REENTREGARIA em laço uma notificação que este
 * processo nunca vai conseguir gravar.
 */
export function modeloPronto() {
  const c = portas.db;
  return !!(c?.ragnabotCobrancaPix?.create && c?.ragnabotCobrancaPixEvento?.create
    && c?.ragnabotPagamentoCredencial?.findUnique);
}

function exigirModelo() {
  if (modeloPronto()) return;
  const e = new Error('As tabelas de pagamento Pix ainda não existem neste processo. '
    + 'Aplique prisma/sql/pagamento-pix/01-rb_pagamento_pix.sql e reinicie o serviço.');
  e.codigo = 'MODELO_AUSENTE';
  e.status = 503;
  throw e;
}
const agora = () => (portas.relogio?.agora ? new Date(portas.relogio.agora()) : new Date());

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B7 — CREDENCIAL POR EMPRESA (campo preparado; nulo = conta da Ragnatela)
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** "casa" ou "tenant:<uuid>". NOT NULL sempre — `tenantId` é anulável e não serve de único. */
export function chaveEscopoDe(tenantId = null) {
  return tenantId ? `tenant:${tenantId}` : 'casa';
}

/**
 * Guarda a credencial de uma empresa (ou a da casa, com `tenantId` nulo).
 * Os segredos entram CIFRADOS; o certificado entra como CAMINHO, nunca como conteúdo.
 */
export async function salvarCredencial({ tenantId = null, ambiente = 'homologacao', clientId = null, clientSecret = null, certificadoCaminho = null, certificadoSenha = null, chavePix = null, webhookHmac = null, ativo = true, userId = null } = {}) {
  exigirModelo();
  const chaveEscopo = chaveEscopoDe(tenantId);
  const dados = {
    tenantId: tenantId ?? null,
    ambiente: ambiente === 'producao' ? 'producao' : 'homologacao',
    ...(clientId !== null ? { clientIdCifrado: encrypt(String(clientId)) } : {}),
    ...(clientSecret !== null ? { clientSecretCifrado: encrypt(String(clientSecret)) } : {}),
    ...(certificadoSenha !== null ? { certificadoSenhaCifrada: encrypt(String(certificadoSenha)) } : {}),
    ...(webhookHmac !== null ? { webhookHmacCifrado: encrypt(String(webhookHmac)) } : {}),
    ...(certificadoCaminho !== null ? { certificadoCaminho: String(certificadoCaminho) } : {}),
    ...(chavePix !== null ? { chavePix: String(chavePix) } : {}),
    ativo: ativo !== false,
    ultimoErro: null,
  };
  const linha = await db().ragnabotPagamentoCredencial.upsert({
    where: { chaveEscopo },
    create: { chaveEscopo, criadoPorUserId: userId, ...dados },
    update: dados,
  });
  // ⛔ NADA de valor no log nem na auditoria: só QUAIS campos foram trocados.
  await auditar({
    tenantId, acao: 'pix_credencial_salva', userId, entidadeId: linha.id,
    depois: { escopo: chaveEscopo, ambiente: dados.ambiente, campos: Object.keys(dados).filter((k) => /Cifrad|Caminho|chavePix/.test(k)) },
  });
  // Uma credencial nova invalida o token guardado daquele escopo.
  cacheDeToken.delete(chaveEscopo);
  return { id: linha.id, chaveEscopo, ambiente: linha.ambiente, ativo: linha.ativo };
}

/**
 * A credencial EFETIVA de uma empresa: a dela se existir e estiver ativa, senão a da casa, senão o
 * ambiente. É esta cascata que faz o campo por empresa existir hoje sem migração amanhã.
 */
export async function credencialEfetiva(tenantId = null) {
  const cfg = configuracaoPix();
  // Sem a tabela, cai direto no AMBIENTE — a credencial da casa continua funcionando, e quem
  // depende da credencial por empresa recebe o erro claro na hora de usar.
  const buscar = async (escopo) => (modeloPronto()
    ? db().ragnabotPagamentoCredencial.findUnique({ where: { chaveEscopo: escopo } }).catch(() => null)
    : null);

  const daEmpresa = tenantId ? await buscar(chaveEscopoDe(tenantId)) : null;
  const daCasa = await buscar('casa');
  const linha = (daEmpresa && daEmpresa.ativo !== false) ? daEmpresa : (daCasa && daCasa.ativo !== false ? daCasa : null);

  const decifrar = (v) => {
    if (!v) return '';
    try { return decrypt(v); } catch { return ''; }
  };

  return {
    escopo: linha ? linha.chaveEscopo : 'ambiente',
    // Origem declarada: quem lê o diagnóstico sabe de ONDE veio a credencial, e não só que "deu erro".
    origem: linha ? (linha.tenantId ? 'empresa' : 'casa') : 'ambiente',
    ambiente: linha?.ambiente ?? cfg.ambiente,
    urlBase: urlBaseDoAmbiente(linha?.ambiente ?? cfg.ambiente),
    clientId: decifrar(linha?.clientIdCifrado) || cfg.clientId,
    clientSecret: decifrar(linha?.clientSecretCifrado) || cfg.clientSecret,
    certificadoCaminho: linha?.certificadoCaminho || cfg.certificadoCaminho,
    certificadoSenha: decifrar(linha?.certificadoSenhaCifrada) || cfg.certificadoSenha,
    chavePix: linha?.chavePix || cfg.chavePix,
    webhookHmac: decifrar(linha?.webhookHmacCifrado) || cfg.webhookHmac,
  };
}

function exigirCredencial(cred) {
  const faltando = [];
  if (!cred.clientId) faltando.push('Client_Id');
  if (!cred.clientSecret) faltando.push('Client_Secret');
  if (!cred.certificadoCaminho) faltando.push('certificado .p12 (EFI_PIX_CERT_PATH)');
  if (!cred.chavePix) faltando.push('chave Pix recebedora');
  if (faltando.length) {
    const e = new Error(`Integração Pix da Efí incompleta (escopo ${cred.escopo}). Falta: ${faltando.join(', ')}.`);
    e.codigo = 'EFI_NAO_CONFIGURADA';
    e.status = 503;
    throw e;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B1 — OAuth2 sobre mTLS, com cache do token
// ────────────────────────────────────────────────────────────────────────────────────────────────
const cacheDeToken = new Map(); // escopo -> { token, expiraEm }
const cacheDeAgente = new Map(); // caminho|senhaHash -> https.Agent

/** Só para teste e para troca de credencial: derruba o token guardado. */
export function esquecerTokens() { cacheDeToken.clear(); cacheDeAgente.clear(); }

function existeArquivo(caminho) {
  try { return fs.existsSync(caminho); } catch { return false; }
}

/**
 * Agente HTTPS com o `.p12` — a API Pix da Efí recusa TODA chamada sem ele.
 * O arquivo é lido do caminho montado por Secret; nunca do repositório, nunca do banco.
 */
export function agenteMtls(cred) {
  const caminho = cred.certificadoCaminho;
  if (!caminho) {
    const e = new Error('certificado .p12 não configurado — a API Pix da Efí exige mTLS');
    e.codigo = 'EFI_SEM_CERTIFICADO';
    throw e;
  }
  const chaveCache = `${caminho}|${crypto.createHash('sha256').update(String(cred.certificadoSenha ?? '')).digest('hex').slice(0, 16)}`;
  if (cacheDeAgente.has(chaveCache)) return cacheDeAgente.get(chaveCache);

  const arquivo = fs.readFileSync(caminho);
  const ehP12 = /\.(p12|pfx)$/i.test(caminho);
  const agente = new https.Agent(ehP12
    ? { pfx: arquivo, passphrase: cred.certificadoSenha || '', keepAlive: true }
    : { cert: arquivo, key: arquivo, keepAlive: true });
  cacheDeAgente.set(chaveCache, agente);
  return agente;
}

/** Faz a chamada. Usa a porta injetada quando existe (teste); senão, axios com o agente mTLS. */
async function chamar({ cred, metodo, caminho, corpo = null, cabecalhosExtra = {} }) {
  const cfg = configuracaoPix();
  const url = `${cred.urlBase}${caminho}`;
  const cabecalhos = { 'Content-Type': 'application/json', ...cabecalhosExtra };

  if (portas.http) {
    return portas.http({ metodo, url, cabecalhos, corpo, agente: null, tempoLimiteMs: cfg.tempoLimiteMs });
  }
  // Import tardio: quem só usa as funções puras (e o teste) não carrega o cliente HTTP.
  const { default: axios } = await import('axios');
  const r = await axios({
    method: metodo,
    url,
    data: corpo,
    headers: cabecalhos,
    httpsAgent: agenteMtls(cred),
    timeout: cfg.tempoLimiteMs,
    validateStatus: () => true,
  });
  return { status: r.status, dados: r.data };
}

/**
 * Token OAuth2. Basic com `Client_Id:Client_Secret`, `grant_type=client_credentials`, POST
 * `/oauth/token` — e SEMPRE sobre o certificado (doc 36 §2).
 *
 * O token é guardado até expirar, com 60 s de folga: sem a folga, uma chamada que sai no último
 * segundo chega expirada do outro lado e falha por 401 sem ninguém entender o porquê.
 */
export async function obterToken(tenantId = null, { forcar = false } = {}) {
  const cred = await credencialEfetiva(tenantId);
  exigirCredencial(cred);
  const chave = cred.escopo;

  const guardado = cacheDeToken.get(chave);
  if (!forcar && guardado && Date.now() < guardado.expiraEm) {
    return { token: guardado.token, doCache: true, escopo: chave };
  }

  const basic = Buffer.from(`${cred.clientId}:${cred.clientSecret}`).toString('base64');
  const r = await chamar({
    cred, metodo: 'post', caminho: '/oauth/token',
    corpo: { grant_type: 'client_credentials' },
    cabecalhosExtra: { Authorization: `Basic ${basic}` },
  });
  if (r.status < 200 || r.status >= 300 || !r.dados?.access_token) {
    // ⛔ A mensagem NUNCA carrega o corpo cru: uma resposta de erro de OAuth pode devolver de volta
    // parte do que foi enviado.
    const e = new Error(`a Efí recusou a autenticação (HTTP ${r.status})`);
    e.codigo = 'EFI_AUTH_RECUSADA';
    e.status = 502;
    throw e;
  }
  const validadeSeg = Number(r.dados.expires_in) || 600;
  cacheDeToken.set(chave, {
    token: r.dados.access_token,
    expiraEm: Date.now() + Math.max(30, validadeSeg - 60) * 1000,
  });
  return { token: r.dados.access_token, doCache: false, escopo: chave };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B2 — COBRANÇA PIX IMEDIATA (`cob`) + copia-e-cola
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `txid` de 32 caracteres `[a-zA-Z0-9]`, DETERMINÍSTICO quando há semente (a `chaveEfeito` do nó de
 * fluxo). É o coração da idempotência de criação: o mesmo nó, na mesma visita, produz o MESMO
 * `txid` — e `PUT /v2/cob/:txid` devolve a MESMA cobrança em vez de criar a segunda.
 */
export function gerarTxid(semente = null) {
  const bruto = semente
    ? crypto.createHash('sha256').update(String(semente)).digest('hex')
    : crypto.randomBytes(24).toString('hex');
  const txid = bruto.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 32);
  if (txid.length < TXID_MIN || txid.length > TXID_MAX) {
    throw new Error(`txid fora do tamanho exigido pelo BACEN (${TXID_MIN}..${TXID_MAX})`);
  }
  return txid;
}

/** Só os primeiros 8 caracteres no log — `txid` inteiro é rastro de dinheiro (doc 36, fim). */
export function redigirTxid(txid) {
  const t = String(txid ?? '');
  return t ? `${t.slice(0, 8)}…(${t.length})` : '(sem txid)';
}

/** Centavos → "10.00", que é o formato que a Efí exige em `valor.original`. */
export function valorEfi(centavos) {
  const n = Number(centavos);
  if (!Number.isInteger(n) || n <= 0) {
    const e = new Error('valor da cobrança tem de ser um número inteiro de centavos maior que zero');
    e.codigo = 'VALOR_INVALIDO';
    e.status = 400;
    throw e;
  }
  return (n / 100).toFixed(2);
}

/**
 * Cria (ou recupera) a cobrança Pix imediata e devolve o copia-e-cola.
 *
 * IDEMPOTÊNCIA EM TRÊS CAMADAS, e as três importam:
 *   1. `chaveEfeito` única no banco — o mesmo nó na mesma visita não gera duas linhas;
 *   2. `txid` determinístico — mesmo que a linha se perca, a Efí recebe o MESMO id;
 *   3. `PUT /v2/cob/:txid` — a própria API devolve a cobrança existente em vez de duplicar.
 */
export async function criarCobrancaPix(pedido = {}) {
  const {
    tenantId, valorCentavos, descricao = null,
    cwAccountId = null, cwConversationId = null, cwContactId = null, protocolo = null,
    execucaoId = null, noId = null, visitaSeq = null, chaveEfeito = null,
    devedorNome = null, devedorDoc = null,
    expiracaoSegundos = null, userId = null,
  } = pedido;
  if (!tenantId) throw erroDeUso('tenantId é obrigatório na cobrança');
  exigirModelo();
  const valor = valorEfi(valorCentavos);

  // 1ª camada: já existe cobrança para esta chave de efeito? Então é a MESMA — devolve e sai.
  if (chaveEfeito) {
    const jaExiste = await db().ragnabotCobrancaPix.findUnique({ where: { chaveEfeito } }).catch(() => null);
    if (jaExiste) return { ...paraFora(jaExiste), reaproveitada: true };
  }

  const cred = await credencialEfetiva(tenantId);
  exigirCredencial(cred);
  const cfg = configuracaoPix();
  const expSeg = Number(expiracaoSegundos) > 0 ? Math.trunc(expiracaoSegundos) : cfg.expiracaoPadraoSegundos;
  const txid = gerarTxid(chaveEfeito ?? `${tenantId}:${cwConversationId ?? ''}:${Date.now()}:${crypto.randomUUID()}`);

  // A linha nasce ANTES da chamada — caixa de saída de duas fases, a mesma disciplina do motor.
  // Se o processo morrer no meio, sobra o registro de que a cobrança foi TENTADA, com o txid, e a
  // conciliação tem por onde perguntar. A ordem inversa perderia o txid e ninguém saberia procurar.
  let linha;
  try {
    linha = await db().ragnabotCobrancaPix.create({
      data: {
        txid, tenantId, cwAccountId, cwConversationId, cwContactId, protocolo,
        execucaoId, noId, visitaSeq, chaveEfeito,
        valorCentavos: Number(valorCentavos), descricao, devedorNome, devedorDoc,
        status: STATUS_COBRANCA.AGUARDANDO, ambiente: cred.ambiente,
        chavePixRecebedora: cred.chavePix, expiracaoSegundos: expSeg,
        expiraEm: new Date(agora().getTime() + expSeg * 1000),
        criadoPorUserId: userId,
      },
    });
  } catch (e) {
    // Corrida entre duas réplicas com a mesma `chaveEfeito`/`txid`: quem perdeu lê a linha do outro.
    if (e?.code === 'P2002') {
      const existente = chaveEfeito
        ? await db().ragnabotCobrancaPix.findUnique({ where: { chaveEfeito } })
        : await db().ragnabotCobrancaPix.findUnique({ where: { txid } });
      if (existente) return { ...paraFora(existente), reaproveitada: true };
    }
    throw e;
  }

  const corpo = {
    calendario: { expiracao: expSeg },
    valor: { original: valor },
    chave: cred.chavePix,
    ...(descricao ? { solicitacaoPagador: String(descricao).slice(0, 140) } : {}),
    ...(devedorDoc
      ? { devedor: montarDevedor({ nome: devedorNome, documento: devedorDoc }) }
      : {}),
  };

  try {
    const { token } = await obterToken(tenantId);
    const r = await chamar({
      cred, metodo: 'put', caminho: `/v2/cob/${txid}`, corpo,
      cabecalhosExtra: { Authorization: `Bearer ${token}` },
    });
    if (r.status < 200 || r.status >= 300) {
      throw Object.assign(new Error(`a Efí recusou a cobrança (HTTP ${r.status})`), { codigo: 'EFI_COB_RECUSADA' });
    }

    const d = r.dados ?? {};
    // A Efí devolve o copia-e-cola em `pixCopiaECola`; quando não vier, ele se busca em
    // `GET /v2/loc/:id/qrcode`. Tratar os dois casos evita a cobrança "criada" que o cliente não
    // consegue pagar porque ninguém tem o código.
    let copiaECola = d.pixCopiaECola ?? d.pix_copia_e_cola ?? null;
    const locId = d.loc?.id ?? d.location?.id ?? null;
    if (!copiaECola && locId) {
      const q = await chamar({
        cred, metodo: 'get', caminho: `/v2/loc/${locId}/qrcode`,
        cabecalhosExtra: { Authorization: `Bearer ${token}` },
      });
      if (q.status >= 200 && q.status < 300) copiaECola = q.dados?.qrcode ?? null;
    }

    linha = await db().ragnabotCobrancaPix.update({
      where: { id: linha.id },
      data: { locId: locId ? Number(locId) : null, copiaECola, ultimoErro: null },
    });

    await registrarEvento({
      chaveIdempotencia: `efi-pix:criacao:${txid}`,
      cobrancaId: linha.id, txid, tipo: 'criacao',
      statusExterno: d.status ?? null, resultado: RESULTADOS_EVENTO.APLICADO,
      valorCentavos: Number(valorCentavos), payload: redigirPayload(d),
    });
    await auditar({
      tenantId, acao: 'pix_cobranca_criada', userId, entidadeId: linha.id, protocolo,
      depois: { txid: redigirTxid(txid), valorCentavos, ambiente: cred.ambiente, conversa: cwConversationId },
    });

    log().info(`[pix] cobrança criada ${redigirTxid(txid)} (${cred.ambiente}, empresa ${tenantId})`);
    return { ...paraFora(linha), reaproveitada: false };
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 400);
    await db().ragnabotCobrancaPix.update({
      where: { id: linha.id }, data: { status: STATUS_COBRANCA.ERRO, ultimoErro: msg },
    }).catch(() => {});
    log().error(`[pix] falha ao criar ${redigirTxid(txid)}: ${msg}`);
    throw e;
  }
}

/** A Efí exige `cpf` OU `cnpj`, só dígitos. Escolher pelo tamanho é o que o serviço de cobrança já faz. */
function montarDevedor({ nome, documento }) {
  const digitos = String(documento ?? '').replace(/\D/gu, '');
  if (!digitos) return undefined;
  return digitos.length > 11
    ? { cnpj: digitos, nome: String(nome ?? '').slice(0, 200) || 'Cliente' }
    : { cpf: digitos, nome: String(nome ?? '').slice(0, 200) || 'Cliente' };
}

/** B6 — o estado da cobrança como a conversa precisa ver. */
export function paraFora(linha) {
  if (!linha) return null;
  return {
    id: linha.id,
    txid: linha.txid,
    status: linha.status,
    valorCentavos: linha.valorCentavos,
    copiaECola: linha.copiaECola ?? null,
    expiraEm: linha.expiraEm ?? null,
    pagoEm: linha.pagoEm ?? null,
    valorPagoCentavos: linha.valorPagoCentavos ?? null,
    ambiente: linha.ambiente,
    cwConversationId: linha.cwConversationId ?? null,
    protocolo: linha.protocolo ?? null,
  };
}

/** Consulta na Efí (a fonte da verdade quando o webhook não chegou). */
export async function consultarCobranca({ tenantId, txid }) {
  const cred = await credencialEfetiva(tenantId);
  exigirCredencial(cred);
  const { token } = await obterToken(tenantId);
  const r = await chamar({ cred, metodo: 'get', caminho: `/v2/cob/${txid}`, cabecalhosExtra: { Authorization: `Bearer ${token}` } });
  if (r.status < 200 || r.status >= 300) {
    throw Object.assign(new Error(`a Efí recusou a consulta (HTTP ${r.status})`), { codigo: 'EFI_COB_CONSULTA' });
  }
  return r.dados;
}

/** O que a conversa mostra: aguardando / pago / expirado (B6). Lê do NOSSO banco. */
export async function estadoNaConversa({ cwAccountId, cwConversationId }) {
  const lista = await db().ragnabotCobrancaPix.findMany({
    where: { cwAccountId: Number(cwAccountId), cwConversationId: Number(cwConversationId) },
    orderBy: { criadoEm: 'desc' }, take: 20,
  }).catch(() => []);
  const nowMs = agora().getTime();
  return lista.map((l) => {
    // Expirado é DERIVADO, não gravado: a cobrança pode ter vencido sem ninguém rodar nada, e
    // mostrar "aguardando" para algo vencido faz o atendente cobrar um código morto.
    const vencida = l.status === STATUS_COBRANCA.AGUARDANDO && l.expiraEm && new Date(l.expiraEm).getTime() < nowMs;
    return { ...paraFora(l), status: vencida ? STATUS_COBRANCA.EXPIRADO : l.status, expiradaPorTempo: !!vencida };
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B3 — REGISTRO DO WEBHOOK NA EFÍ
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `PUT /v2/webhook/:chave` — a chave é a CHAVE PIX (doc 36 §3).
 *
 * ⚠️ `?ignorar=` no fim da URL registrada: sem isso a Efí ACRESCENTA `/pix` ao caminho, e a
 * confirmação bate num endereço que ninguém montou — falha silenciosa, em dinheiro.
 */
export async function registrarWebhookNaEfi({ tenantId = null, url = null } = {}) {
  const cfg = configuracaoPix();
  const cred = await credencialEfetiva(tenantId);
  exigirCredencial(cred);
  const alvo = url || cfg.urlWebhook;
  if (!alvo) throw erroDeUso('sem EFI_PIX_WEBHOOK_URL: não há endereço para registrar na Efí');
  if (!/^https:\/\//i.test(alvo)) throw erroDeUso('a URL do webhook precisa ser https (porta 443, TLS 1.2+)');

  const comIgnorar = alvo.includes('?') ? alvo : `${alvo}?ignorar=`;
  const { token } = await obterToken(tenantId);
  const r = await chamar({
    cred, metodo: 'put', caminho: `/v2/webhook/${encodeURIComponent(cred.chavePix)}`,
    corpo: { webhookUrl: comIgnorar },
    cabecalhosExtra: { Authorization: `Bearer ${token}` },
  });
  if (r.status < 200 || r.status >= 300) {
    throw Object.assign(new Error(`a Efí recusou o registro do webhook (HTTP ${r.status})`), { codigo: 'EFI_WEBHOOK_RECUSADO' });
  }
  await auditar({ tenantId, acao: 'pix_webhook_registrado', depois: { url: comIgnorar, ambiente: cred.ambiente } });
  return { ok: true, url: comIgnorar, ambiente: cred.ambiente };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B3 (segunda cerca) — VALIDAÇÃO DA ORIGEM DA NOTIFICAÇÃO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Comparação resistente a timing — o mesmo padrão do webhook da plataforma e do da cobrança. */
export function hmacConfere(recebido, esperado) {
  if (!esperado) return null; // null = não configurado (o endpoint recusa com 503, não com 401)
  const a = Buffer.from(String(recebido ?? ''));
  const b = Buffer.from(String(esperado));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Normaliza IPv4 mapeado em IPv6 (`::ffff:1.2.3.4`) — atrás do Ingress é assim que o IP chega. */
export function normalizarIp(ip) {
  const s = String(ip ?? '').trim();
  return s.startsWith('::ffff:') ? s.slice(7) : s;
}

/**
 * As camadas que SÃO nossas. A primeira — o mTLS — é do nginx, e a ausência dela aparece aqui como
 * aviso, não como aprovação.
 */
export async function validarOrigem({ ip = null, hmac = null, tenantId = null } = {}) {
  const cfg = configuracaoPix();
  const cred = await credencialEfetiva(tenantId).catch(() => ({ webhookHmac: cfg.webhookHmac }));
  const esperado = cred.webhookHmac || cfg.webhookHmac;

  const confere = hmacConfere(hmac, esperado);
  if (confere === null) return { ok: false, status: 503, motivo: 'hmac_do_webhook_nao_configurado' };
  if (confere === false) return { ok: false, status: 401, motivo: 'hmac_invalido' };

  const ipLimpo = normalizarIp(ip);
  const aceitos = cfg.ipsAceitos;
  if (aceitos.length && ipLimpo && !aceitos.includes(ipLimpo)) {
    return { ok: false, status: 403, motivo: 'ip_de_origem_nao_autorizado', ip: ipLimpo };
  }
  return { ok: true, status: 200, motivo: null, ip: ipLimpo };
}

/** O corpo tem a forma que a Efí manda? (`{ pix: [ { endToEndId, txid, valor, horario } ] }`) */
export function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== 'object') return { ok: false, motivo: 'corpo_vazio', itens: [] };
  const lista = Array.isArray(corpo.pix) ? corpo.pix : null;
  if (!lista) return { ok: false, motivo: 'corpo_sem_lista_pix', itens: [] };
  const itens = [];
  for (const p of lista) {
    if (!p || typeof p !== 'object') continue;
    const txid = typeof p.txid === 'string' ? p.txid.trim() : '';
    const e2e = typeof p.endToEndId === 'string' ? p.endToEndId.trim() : '';
    if (!txid && !e2e) continue; // sem âncora não há como conciliar — descartado, e contado
    const centavos = valorEmCentavos(p.valor);
    itens.push({
      txid: txid || null,
      endToEndId: e2e || null,
      valorCentavos: centavos,
      horario: p.horario ? new Date(p.horario) : null,
    });
  }
  return { ok: itens.length > 0, motivo: itens.length ? null : 'nenhum_item_utilizavel', itens };
}

/** "10.00" → 1000. Aritmética de centavos por texto, para não herdar erro de ponto flutuante. */
export function valorEmCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/u.test(texto)) return null;
  const [inteiro, decimal = ''] = texto.split('.');
  return Number(inteiro) * 100 + Number((decimal + '00').slice(0, 2));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// B4 — A NOTIFICAÇÃO, COM IDEMPOTÊNCIA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Trata a notificação de Pix pago.
 *
 * ⚠️ O WEBHOOK REPETE POR DESENHO. Duas travas, e as duas precisam existir:
 *   (a) `chaveIdempotencia` única na trilha — a segunda entrega é REGISTRADA como duplicada e
 *       nenhuma escrita de estado acontece;
 *   (b) a baixa é CONDICIONAL (`updateMany` com `status:'aguardando'` no WHERE). Mesmo que a trava
 *       (a) falhe um dia — chave calculada diferente, migração, o que for —, `count === 0` diz que
 *       alguém já deu a baixa, e ninguém credita duas vezes.
 *
 * @returns {Promise<{ok:boolean, aplicados:number, duplicados:number, desconhecidos:number, itens:Array}>}
 */
export async function tratarNotificacaoPix({ corpo, ip = null, tenantId = null } = {}) {
  exigirModelo();
  const forma = validarCorpo(corpo);
  if (!forma.ok) {
    await registrarEvento({
      chaveIdempotencia: `efi-pix:corpo-invalido:${sha256(JSON.stringify(corpo ?? {}))}`,
      tipo: 'notificacao', resultado: RESULTADOS_EVENTO.ERRO, erro: forma.motivo, ip: normalizarIp(ip),
      payload: redigirPayload(corpo),
    });
    return { ok: false, motivo: forma.motivo, aplicados: 0, duplicados: 0, desconhecidos: 0, itens: [] };
  }

  const saida = [];
  let aplicados = 0; let duplicados = 0; let desconhecidos = 0;

  for (const item of forma.itens) {
    // A âncora preferida é o `endToEndId` (identifica a LIQUIDAÇÃO, não a cobrança): duas
    // liquidações da mesma cobrança — que existem, em Pix com múltiplos pagamentos — não colidem.
    const chaveIdempotencia = item.endToEndId
      ? `efi-pix:${item.endToEndId}`
      : `efi-pix:txid:${item.txid}:${item.horario ? item.horario.toISOString() : 'sem-horario'}`;

    const evento = await registrarEvento({
      chaveIdempotencia, txid: item.txid, tipo: 'notificacao', ip: normalizarIp(ip),
      valorCentavos: item.valorCentavos, payload: redigirPayload(item), statusExterno: 'pago',
    });
    if (evento.duplicado) {
      duplicados += 1;
      saida.push({ txid: redigirTxid(item.txid), resultado: RESULTADOS_EVENTO.IGNORADO_DUPLICADO });
      continue;
    }

    const cobranca = item.txid
      ? await db().ragnabotCobrancaPix.findUnique({ where: { txid: item.txid } }).catch(() => null)
      : null;
    if (!cobranca) {
      desconhecidos += 1;
      await fecharEvento(evento.id, { resultado: RESULTADOS_EVENTO.IGNORADO_DESCONHECIDO });
      log().warn(`[pix] notificação de cobrança desconhecida ${redigirTxid(item.txid)} — ignorada`);
      saida.push({ txid: redigirTxid(item.txid), resultado: RESULTADOS_EVENTO.IGNORADO_DESCONHECIDO });
      continue;
    }
    if (tenantId && cobranca.tenantId !== tenantId) {
      // Isolamento: uma notificação endereçada à empresa A não dá baixa em cobrança da empresa B.
      desconhecidos += 1;
      await fecharEvento(evento.id, { cobrancaId: cobranca.id, resultado: RESULTADOS_EVENTO.IGNORADO_DESCONHECIDO, erro: 'empresa divergente' });
      saida.push({ txid: redigirTxid(item.txid), resultado: RESULTADOS_EVENTO.IGNORADO_DESCONHECIDO });
      continue;
    }

    // A BAIXA CONDICIONAL. `count === 0` = já estava paga: registra e não credita de novo.
    const quando = item.horario ?? agora();
    const r = await db().ragnabotCobrancaPix.updateMany({
      where: { id: cobranca.id, status: STATUS_COBRANCA.AGUARDANDO },
      data: {
        status: STATUS_COBRANCA.PAGO,
        pagoEm: quando,
        valorPagoCentavos: item.valorCentavos ?? cobranca.valorCentavos,
        e2eId: item.endToEndId ?? null,
        ultimoErro: null,
      },
    });
    if (r.count === 0) {
      duplicados += 1;
      await fecharEvento(evento.id, { cobrancaId: cobranca.id, resultado: RESULTADOS_EVENTO.IGNORADO_JA_PAGO });
      saida.push({ txid: redigirTxid(item.txid), resultado: RESULTADOS_EVENTO.IGNORADO_JA_PAGO });
      continue;
    }

    aplicados += 1;
    await fecharEvento(evento.id, { cobrancaId: cobranca.id, resultado: RESULTADOS_EVENTO.APLICADO });
    await auditar({
      tenantId: cobranca.tenantId, acao: 'pix_pago', entidadeId: cobranca.id, protocolo: cobranca.protocolo,
      depois: {
        txid: redigirTxid(cobranca.txid), valorCentavos: item.valorCentavos ?? cobranca.valorCentavos,
        conversa: cobranca.cwConversationId, pagoEm: quando,
      },
    });
    await acordarFluxoDaCobranca(cobranca).catch((e) => {
      log().warn(`[pix] cobrança ${redigirTxid(cobranca.txid)} paga, mas o fluxo não acordou: ${e.message}`);
    });
    log().info(`[pix] pagamento confirmado ${redigirTxid(cobranca.txid)} (empresa ${cobranca.tenantId})`);
    saida.push({ txid: redigirTxid(item.txid), resultado: RESULTADOS_EVENTO.APLICADO });
  }

  return { ok: true, aplicados, duplicados, desconhecidos, itens: saida };
}

/**
 * Acorda a conversa que estava esperando o pagamento (modo `cobrar_e_aguardar` do nó de fluxo).
 *
 * COMO FUNCIONA, e por que é assim: o nó estaciona com `aguardando='temporizador'` e
 * `saidaAoVencer='expirado'`. Quando o Pix é pago ANTES do prazo, trocamos a saída para `pago` e
 * enfileiramos um DESPERTAR imediato com `tokenVisita = visitaSeq`.
 *
 * ⚠️ DUAS RESSALVAS DECLARADAS, porque escondê-las seria pior:
 *   1. esta escrita acontece FORA do arrendamento do motor. A cerca aqui é o WHERE
 *      (`id` + `visitaSeq` + `aguardando='temporizador'`): se a visita avançou — o cliente
 *      escreveu, o prazo venceu, alguém assumiu — `count` volta 0 e nada é tocado;
 *   2. isto NÃO FOI EXERCITADO contra o motor de verdade: não existe conversa viva no ambiente
 *      (zero caixas de WhatsApp criadas). O que está provado é a sequência de chamadas, contra
 *      dublê. O ensaio real é o primeiro atendimento.
 */
export async function acordarFluxoDaCobranca(cobranca) {
  if (!cobranca?.execucaoId) return { ok: false, motivo: 'cobranca_sem_execucao' };
  const modelo = db().ragnabotFluxoExecucao;
  if (!modelo?.updateMany) return { ok: false, motivo: 'sem_modelo_de_execucao' };

  const r = await modelo.updateMany({
    where: {
      id: cobranca.execucaoId,
      ...(cobranca.visitaSeq !== null && cobranca.visitaSeq !== undefined ? { visitaSeq: cobranca.visitaSeq } : {}),
      aguardando: 'temporizador',
    },
    data: { saidaAoVencer: 'pago', acordarEm: agora() },
  });
  if (r.count !== 1) return { ok: false, motivo: 'execucao_nao_estava_esperando' };

  if (!portas.fila?.enfileirar) return { ok: true, acordado: false, motivo: 'fila_ausente' };
  await portas.fila.enfileirar({
    tipo: 'despertar',
    chaveParticao: `${cobranca.cwAccountId}:${cobranca.cwConversationId}`,
    tenantId: cobranca.tenantId,
    execucaoId: cobranca.execucaoId,
    tokenVisita: cobranca.visitaSeq ?? null,
    prioridade: 50,
    payload: { origem: 'pix_pago', txid: redigirTxid(cobranca.txid) },
  });
  return { ok: true, acordado: true };
}

/** Cancela a cobrança (a Efí chama de `REMOVIDA_PELO_USUARIO_RECEBEDOR`). */
export async function cancelarCobranca({ tenantId, txid, userId = null }) {
  const cobranca = await db().ragnabotCobrancaPix.findUnique({ where: { txid } });
  if (!cobranca) return { ok: false, motivo: 'nao_encontrada' };
  if (cobranca.tenantId !== tenantId) return { ok: false, motivo: 'de_outra_empresa' };
  if (cobranca.status === STATUS_COBRANCA.PAGO) return { ok: false, motivo: 'ja_paga' };

  const cred = await credencialEfetiva(tenantId);
  exigirCredencial(cred);
  const { token } = await obterToken(tenantId);
  const r = await chamar({
    cred, metodo: 'patch', caminho: `/v2/cob/${txid}`,
    corpo: { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' },
    cabecalhosExtra: { Authorization: `Bearer ${token}` },
  });
  if (r.status < 200 || r.status >= 300) {
    throw Object.assign(new Error(`a Efí recusou o cancelamento (HTTP ${r.status})`), { codigo: 'EFI_COB_CANCELAMENTO' });
  }
  const atualizada = await db().ragnabotCobrancaPix.update({
    where: { id: cobranca.id }, data: { status: STATUS_COBRANCA.CANCELADO, canceladoEm: agora() },
  });
  await auditar({ tenantId, acao: 'pix_cobranca_cancelada', userId, entidadeId: cobranca.id, depois: { txid: redigirTxid(txid) } });
  return { ok: true, cobranca: paraFora(atualizada) };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// TRILHA
// ────────────────────────────────────────────────────────────────────────────────────────────────
async function registrarEvento(dados) {
  try {
    const linha = await db().ragnabotCobrancaPixEvento.create({ data: { ...dados } });
    return { id: linha.id, duplicado: false };
  } catch (e) {
    if (e?.code === 'P2002') return { id: null, duplicado: true };
    throw e;
  }
}

async function fecharEvento(id, dados) {
  if (!id) return;
  await db().ragnabotCobrancaPixEvento.update({
    where: { id }, data: { ...dados, processadoEm: agora() },
  }).catch(() => {});
}

/**
 * O payload guardado é REDIGIDO: nada de cabeçalho, token ou documento completo do pagador. Corpo
 * cru de terceiro guardado por inteiro vira dado pessoal na nossa base sem ninguém ter decidido.
 */
export function redigirPayload(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const permitidos = ['txid', 'endToEndId', 'valor', 'valorCentavos', 'horario', 'status', 'chave', 'devolucoes', 'loc', 'calendario'];
  const saida = {};
  for (const k of permitidos) {
    if (bruto[k] === undefined) continue;
    if (k === 'chave') { saida.chave = '(chave pix omitida)'; continue; }
    saida[k] = bruto[k] instanceof Date ? bruto[k].toISOString() : bruto[k];
  }
  return Object.keys(saida).length ? saida : null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// MIUDEZAS
// ────────────────────────────────────────────────────────────────────────────────────────────────
function sha256(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }

function erroDeUso(mensagem) {
  const e = new Error(mensagem);
  e.codigo = 'USO_INVALIDO';
  e.status = 400;
  return e;
}

async function auditar({ tenantId = null, acao, userId = null, entidadeId = null, protocolo = null, depois = null }) {
  if (!portas.auditoria?.registrar) return;
  await portas.auditoria.registrar({
    tenantId, atorTipo: userId ? 'user' : 'sistema', atorId: userId,
    categoria: 'dados', acao, entidade: 'pagamento_pix', entidadeId, protocolo, depois,
  }).catch(() => {});
}

export default {
  STATUS_COBRANCA, RESULTADOS_EVENTO, IP_EFI,
  configuracaoPix, situacaoDaIntegracao, urlBaseDoAmbiente, modeloPronto,
  configurarPagamentoEfi, portasDoPagamento,
  chaveEscopoDe, salvarCredencial, credencialEfetiva,
  obterToken, esquecerTokens, agenteMtls,
  gerarTxid, redigirTxid, valorEfi, valorEmCentavos,
  criarCobrancaPix, consultarCobranca, estadoNaConversa, cancelarCobranca,
  registrarWebhookNaEfi, validarOrigem, validarCorpo, hmacConfere, normalizarIp,
  tratarNotificacaoPix, acordarFluxoDaCobranca, redigirPayload, paraFora,
};
