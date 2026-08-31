// =============================================================================
// RAGNABOT — cobrança recorrente e liberação/suspensão automática da conta.
//
// Ordem do dono (28/08/2026): "já criar planos de cobrança recorrentes e integração
// preparada para Efibank para receber automaticamente os pagamentos e fazer as liberações."
//
// O QUE ESTE ARQUIVO FAZ
//   1. Mantém o catálogo de planos e as assinaturas de cada conta do RAGNABOT.
//   2. Gera a cobrança de cada ciclo (idempotente por competência "AAAA-MM").
//   3. Recebe o retorno do provedor de pagamento e dá baixa (também idempotente).
//   4. LIBERA ou SUSPENDE a conta no Chatwoot conforme o pagamento.
//
// O PROVEDOR FICA ATRÁS DE UM ADAPTADOR
//   `AdaptadorManual`  — funciona HOJE, sem nenhuma credencial. Gera o Pix "copia e cola"
//                        (BR Code EMV estático) a partir da chave Pix do dono e espera a
//                        baixa manual de quem conferiu o extrato.
//   `AdaptadorEfi`     — fala com a API de Cobranças da Efí (ex-Gerencianet). Escrito e
//                        pronto; só entra em operação quando as credenciais existirem.
//                        Sem credencial ele FALHA DIZENDO O QUE FALTA — nunca finge.
//
// TRAVA DE SEGURANÇA (proposital)
//   Mexer no estado da conta de um cliente é ação destrutiva. Por isso a escrita no banco
//   do Chatwoot só acontece com RAGNABOT_COBRANCA_APLICAR=1 no .env. Sem essa variável o
//   serviço REGISTRA A INTENÇÃO (banco + auditoria + log) e não toca em nada. Assim o
//   worker pode ser ligado em observação antes de ter poder de suspender alguém.
//
// COMO A SUSPENSÃO FUNCIONA DE VERDADE (verificado no código do Chatwoot 4.17.1)
//   `accounts.status` é um enum: 0 = active, 1 = suspended
//   (app/models/account.rb → `enum :status, { active: 0, suspended: 1 }`).
//   Toda requisição da conta passa por EnsureCurrentAccountHelper#ensure_current_account,
//   que responde 401 "Account is suspended" quando a conta não está ativa. Ou seja: mudar
//   essa coluna suspende o acesso de verdade, sem apagar nem um dado do cliente.
//
// DIVISÃO DE TRABALHO COM A FRENTE SaaS (ragnabot-tenant.service.js)
//   Aquela frente cuida da EMPRESA na plataforma: provisiona a conta, cria as caixas,
//   convida agentes e sabe suspender/reativar. Esta aqui cuida do DINHEIRO: plano com
//   preço, ciclo, cobrança e baixa. Quando a assinatura tem `tenantId`, a liberação e a
//   suspensão são DELEGADAS àquele serviço — um mecanismo só. Sem `tenantId` (conta antiga,
//   criada à mão), cai no caminho direto: `accounts.status` no banco do Chatwoot.
//   A CAPACIDADE do plano (agentes, caixas, canais) vive em src/config/ragnabot-plans.js;
//   aqui só existe o que é comercial: preço e ciclo.
//
// NOC 2026-08-28.
// =============================================================================
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import axios from 'axios';
import pg from 'pg';
import prisma from '../base/db.js';
import logger from '../base/logger.js';
import { logAction } from '../base/auditoria.js';
import { planoExiste } from '../config/ragnabot-plans.js';

const { Client: ClientePg } = pg;

// ── Vocabulário do domínio (uma fonte só, para não haver string solta) ────────
export const STATUS_ASSINATURA = {
  TESTE: 'teste',
  ATIVA: 'ativa',
  INADIMPLENTE: 'inadimplente',
  SUSPENSA: 'suspensa',
  CANCELADA: 'cancelada',
};

export const STATUS_PAGAMENTO = {
  PENDENTE: 'pendente',
  PAGO: 'pago',
  VENCIDO: 'vencido',
  CANCELADO: 'cancelado',
  ESTORNADO: 'estornado',
};

export const MEIOS_PAGAMENTO = ['pix', 'boleto', 'cartao', 'manual'];

// Estados em que a conta do cliente DEVE estar liberada.
const STATUS_QUE_LIBERAM = new Set([
  STATUS_ASSINATURA.TESTE,
  STATUS_ASSINATURA.ATIVA,
  STATUS_ASSINATURA.INADIMPLENTE, // inadimplente ainda usa: só suspende depois da carência
]);

// ── Configuração (tudo por variável de ambiente; nenhum segredo no código) ────
function env(nome, padrao = '') {
  const v = process.env[nome];
  return v === undefined || v === null || v === '' ? padrao : String(v);
}

export function configuracao() {
  const ambiente = env('EFI_AMBIENTE', 'homologacao'); // producao | homologacao
  return {
    adaptadorPadrao: env('RAGNABOT_COBRANCA_ADAPTADOR', 'manual'),
    // Trava mestra: sem isto o serviço NÃO escreve no banco do Chatwoot.
    aplicarNaConta: env('RAGNABOT_COBRANCA_APLICAR') === '1',
    // Banco do RAGNABOT (Chatwoot). Ex.: postgres://usuario:SENHA@172.17.20.132:5432/chatwoot
    urlBancoRagnabot: env('RAGNABOT_DB_URL'),
    // ⚠️ CORRIGIDO em 30/08/2026 (separação, doc 33). Este campo apontava para o NOC
    // (`https://ia.ragnatela.com.br`) e era o endereço que o PROVEDOR DE PAGAMENTO guardava para
    // avisar que uma cobrança foi paga. Era uma dependência escondida e das piores: com o NOC fora,
    // o motor continuaria atendendo normalmente, e a confirmação de pagamento bateria numa porta
    // fechada — falha silenciosa, em dinheiro, descoberta só na conciliação.
    // Agora é o endereço PÚBLICO DO PRÓPRIO RAGNABOT. Quem cobra e quem recebe o aviso são o mesmo
    // sistema, como tem de ser.
    urlPublicaRagnabot: env('RAGNABOT_PUBLIC_URL', 'https://bot.ragnatela.com.br').replace(/\/$/, ''),
    // Segredo do webhook: vai como segmento da URL registrada no provedor.
    segredoWebhook: env('RAGNABOT_COBRANCA_WEBHOOK_SEGREDO'),
    // Pix estático do ManualAdapter (funciona com qualquer banco, sem API).
    pix: {
      chave: env('RAGNABOT_PIX_CHAVE'),
      nome: env('RAGNABOT_PIX_NOME', 'RAGNATELA IOT SOLUTIONS'),
      cidade: env('RAGNABOT_PIX_CIDADE', 'SAO LUIS'),
    },
    efi: {
      ambiente,
      baseCobrancas: ambiente === 'producao'
        ? 'https://cobrancas.api.efipay.com.br'
        : 'https://cobrancas-h.api.efipay.com.br',
      basePix: ambiente === 'producao'
        ? 'https://pix.api.efipay.com.br'
        : 'https://pix-h.api.efipay.com.br',
      clientId: env('EFI_CLIENT_ID'),
      clientSecret: env('EFI_CLIENT_SECRET'),
      // Certificado mTLS — obrigatório SÓ na API Pix da Efí (a de Cobranças não usa).
      certificadoPath: env('EFI_PIX_CERT_PATH'),
      certificadoSenha: env('EFI_PIX_CERT_SENHA'),
      chavePix: env('EFI_PIX_CHAVE'),
    },
  };
}

// ── Utilidades de dinheiro e de calendário ───────────────────────────────────
export function centavosParaReais(centavos) {
  if (centavos === null || centavos === undefined) return null;
  return (centavos / 100).toFixed(2);
}

export function formatarBRL(centavos) {
  if (centavos === null || centavos === undefined) return '—';
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
}

/** Competência ("AAAA-MM") de uma data. É a chave que impede cobrar o mesmo ciclo duas vezes. */
export function competenciaDe(data) {
  const d = new Date(data);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Avança N meses respeitando o dia de vencimento — e sem estourar o mês curto:
 * dia 31 em fevereiro vira o último dia de fevereiro, não 3 de março.
 */
export function avancarVencimento(dataBase, meses, diaVencimento) {
  const base = new Date(dataBase);
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + meses;
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(diaVencimento || base.getUTCDate(), ultimoDiaDoMes);
  return new Date(Date.UTC(ano, mes, dia, 12, 0, 0)); // meio-dia UTC: imune a fuso e a horário de verão
}

/**
 * Primeiro `diaVencimento` que cai DEPOIS da data informada. É o que fecha o fim do
 * teste grátis: `avancarVencimento(fimDoTeste, 0, dia)` pode devolver uma data ANTERIOR
 * ao fim do teste (teste acabando dia 20, vencimento no dia 10 → dia 10 do mesmo mês),
 * e a assinatura já nasceria vencida — inadimplente antes da primeira cobrança existir.
 */
export function primeiroVencimentoApos(data, diaVencimento) {
  const base = new Date(data);
  const alvo = avancarVencimento(base, 0, diaVencimento);
  return alvo.getTime() > base.getTime() ? alvo : avancarVencimento(base, 1, diaVencimento);
}

function diasEntre(a, b) {
  return Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

// ── Pix "copia e cola" (BR Code EMV estático) ────────────────────────────────
// Gerado LOCALMENTE, sem banco e sem API: é o padrão do Banco Central (EMV®QRCPS-MPM).
// Serve ao ManualAdapter — o cliente paga, e a baixa é conferida por gente no extrato.
// Não confundir com Pix cobrança (API): esse sim concilia sozinho, e exige a Efí.
function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function campoEmv(id, valor) {
  const v = String(valor);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

// Remove acento e caractere fora do ASCII imprimível: o BR Code não os aceita.
function apenasAscii(texto, limite) {
  const limpo = String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .trim().toUpperCase();
  return limite ? limpo.slice(0, limite) : limpo;
}

export function montarPixCopiaECola({ chave, nome, cidade, valorCentavos, identificador }) {
  if (!chave) throw new Error('Chave Pix não configurada (RAGNABOT_PIX_CHAVE).');
  const txid = apenasAscii(identificador || '***', 25).replace(/[ .-]/g, '') || '***';
  const merchant = campoEmv('00', 'BR.GOV.BCB.PIX') + campoEmv('01', chave);
  let payload = '';
  payload += campoEmv('00', '01');            // formato do payload
  payload += campoEmv('26', merchant);        // conta do recebedor (Pix)
  payload += campoEmv('52', '0000');          // categoria do comerciante: não informada
  payload += campoEmv('53', '986');           // moeda: BRL
  if (valorCentavos) payload += campoEmv('54', (valorCentavos / 100).toFixed(2));
  payload += campoEmv('58', 'BR');            // país
  payload += campoEmv('59', apenasAscii(nome, 25) || 'RECEBEDOR');
  payload += campoEmv('60', apenasAscii(cidade, 15) || 'BRASIL');
  payload += campoEmv('62', campoEmv('05', txid)); // referência do pagamento
  payload += '6304';                          // campo do CRC, que entra no próprio cálculo
  return payload + crc16(payload);
}

// ═════════════════════════════════════════════════════════════════════════════
// ADAPTADORES DE PAGAMENTO
// Contrato comum — quem chama nunca sabe qual provedor está atrás:
//   nome                              → identificador salvo em RagnabotAssinatura.adaptador
//   estaConfigurado()                 → { ok, faltando[] }
//   garantirPlano(plano)              → { idExterno } (no manual, nulo)
//   criarAssinaturaExterna(assinatura)→ { idExterno }
//   criarCobranca(assinatura, pagamento) → { idExterno, meio, link, linhaDigitavel, pixCopiaECola, payload }
//   cancelarAssinaturaExterna(assinatura)
//   normalizarWebhook(origem, corpo)  → [ { chaveIdempotencia, statusExterno, ... } ]
// ═════════════════════════════════════════════════════════════════════════════

class AdaptadorManual {
  constructor(cfg) { this.cfg = cfg; this.nome = 'manual'; }

  estaConfigurado() {
    const faltando = [];
    if (!this.cfg.pix.chave) faltando.push('RAGNABOT_PIX_CHAVE');
    // Sem chave Pix ele ainda funciona: a cobrança sai sem "copia e cola" e o dono combina
    // o meio com o cliente. Por isso `ok` é sempre verdadeiro aqui.
    return { ok: true, faltando };
  }

  async garantirPlano() { return { idExterno: null }; }
  async criarAssinaturaExterna(assinatura) { return { idExterno: `manual:${assinatura.id}` }; }
  async cancelarAssinaturaExterna() { return { ok: true }; }

  async criarCobranca(assinatura, pagamento) {
    let pixCopiaECola = null;
    if (this.cfg.pix.chave) {
      try {
        pixCopiaECola = montarPixCopiaECola({
          chave: this.cfg.pix.chave,
          nome: this.cfg.pix.nome,
          cidade: this.cfg.pix.cidade,
          valorCentavos: pagamento.valorCentavos,
          identificador: pagamento.id.slice(-20),
        });
      } catch (e) {
        logger.warn(`[ragnabot-cobranca] Pix copia e cola não gerado: ${e.message}`);
      }
    }
    return {
      idExterno: `manual:${pagamento.id}`,
      meio: pixCopiaECola ? 'pix' : 'manual',
      link: null,
      linhaDigitavel: null,
      pixCopiaECola,
      payload: { adaptador: 'manual', geradoEm: new Date().toISOString() },
    };
  }

  // No modo manual não existe webhook: a baixa entra por registrarPagamentoManual().
  async normalizarWebhook() { return []; }
}

class AdaptadorEfi {
  constructor(cfg) { this.cfg = cfg; this.nome = 'efibank'; this._token = null; this._expiraEm = 0; }

  estaConfigurado() {
    const faltando = [];
    if (!this.cfg.efi.clientId) faltando.push('EFI_CLIENT_ID');
    if (!this.cfg.efi.clientSecret) faltando.push('EFI_CLIENT_SECRET');
    return { ok: faltando.length === 0, faltando };
  }

  _exigirConfiguracao() {
    const c = this.estaConfigurado();
    if (!c.ok) {
      throw new Error(`Integração Efí não configurada. Falta no .env: ${c.faltando.join(', ')}. ` +
        'Enquanto isso, use o adaptador "manual".');
    }
  }

  // OAuth2 client_credentials com Basic Auth — POST /v1/authorize (API de Cobranças).
  // O token vale 600 s; guardamos com 60 s de folga para não expirar no meio de uma chamada.
  async _token_() {
    this._exigirConfiguracao();
    if (this._token && Date.now() < this._expiraEm) return this._token;
    const basic = Buffer.from(`${this.cfg.efi.clientId}:${this.cfg.efi.clientSecret}`).toString('base64');
    const { data } = await axios.post(
      `${this.cfg.efi.baseCobrancas}/v1/authorize`,
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, timeout: 20000 },
    );
    this._token = data.access_token;
    this._expiraEm = Date.now() + Math.max(60, (data.expires_in || 600) - 60) * 1000;
    return this._token;
  }

  async _chamar(metodo, caminho, corpo) {
    const token = await this._token_();
    const { data } = await axios({
      method: metodo,
      url: `${this.cfg.efi.baseCobrancas}${caminho}`,
      data: corpo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return data;
  }

  _urlNotificacao() {
    const segredo = this.cfg.segredoWebhook;
    if (!segredo) throw new Error('RAGNABOT_COBRANCA_WEBHOOK_SEGREDO não definido — sem ele o webhook fica aberto.');
    return `${this.cfg.urlPublicaRagnabot}/api/webhooks/ragnabot-cobranca/${segredo}`;
  }

  // POST /v1/plan — cria o plano no provedor (nome, intervalo em meses, repetições).
  async garantirPlano(plano) {
    if (plano.idExterno) return { idExterno: plano.idExterno };
    const r = await this._chamar('post', '/v1/plan', {
      name: plano.nome,
      interval: plano.cicloMeses || 1,
      repeats: null, // null = recorrência sem fim; a assinatura é encerrada por cancelamento
    });
    return { idExterno: String(r?.data?.plan_id ?? r?.data?.id ?? '') || null };
  }

  // POST /v1/plan/:id/subscription — assinatura em duas etapas (esta é a etapa 1).
  async criarAssinaturaExterna(assinatura, plano) {
    const { idExterno: idPlano } = await this.garantirPlano(plano);
    if (!idPlano) throw new Error('Não foi possível obter o plan_id na Efí.');
    const r = await this._chamar('post', `/v1/plan/${idPlano}/subscription`, {
      items: [{
        name: `${plano.nome} — RAGNABOT`,
        value: assinatura.valorCentavos ?? plano.precoCentavos,
        amount: 1,
      }],
      metadata: {
        custom_id: `assinatura:${assinatura.id}`,
        notification_url: this._urlNotificacao(),
      },
    });
    return {
      idExterno: String(r?.data?.subscription_id ?? ''),
      idExternoPlano: String(idPlano),
      payload: r?.data ?? null,
    };
  }

  // POST /v1/subscription/:id/pay — define a forma de pagamento do ciclo (boleto).
  // Cartão exige payment_token gerado no navegador do cliente (SDK JS da Efí); por isso
  // o cartão não é emitido daqui — a rota de link de pagamento cobre esse caso.
  async criarCobranca(assinatura, pagamento) {
    this._exigirConfiguracao();
    if (!assinatura.idExterno) throw new Error('Assinatura sem idExterno na Efí — crie a assinatura externa antes.');
    const vencimento = new Date(pagamento.vencimentoEm).toISOString().slice(0, 10);
    const r = await this._chamar('post', `/v1/subscription/${assinatura.idExterno}/pay`, {
      payment: {
        banking_billet: {
          expire_at: vencimento,
          customer: {
            name: assinatura.contatoNome || assinatura.rotuloConta,
            email: assinatura.emailCobranca || undefined,
            phone_number: (assinatura.contatoTelefone || '').replace(/\D/g, '') || undefined,
            // A Efí exige cpf OU cnpj (só dígitos). O documento é obrigatório para boleto.
            ...(String(assinatura.documentoCobranca || '').replace(/\D/g, '').length > 11
              ? { juridical_person: { corporate_name: assinatura.rotuloConta, cnpj: assinatura.documentoCobranca.replace(/\D/g, '') } }
              : { cpf: String(assinatura.documentoCobranca || '').replace(/\D/g, '') || undefined }),
          },
        },
      },
    });
    const d = r?.data || {};
    return {
      idExterno: d.charge_id ? String(d.charge_id) : null,
      meio: 'boleto',
      link: d.link || d.pdf?.charge || null,
      linhaDigitavel: d.barcode || null,
      pixCopiaECola: d.pix?.qrcode || null,
      payload: d,
    };
  }

  // PUT /v1/subscription/:id/cancel
  async cancelarAssinaturaExterna(assinatura) {
    if (!assinatura.idExterno || assinatura.idExterno.startsWith('manual:')) return { ok: true, ignorado: true };
    await this._chamar('put', `/v1/subscription/${assinatura.idExterno}/cancel`);
    return { ok: true };
  }

  // GET /v1/notification/:token — a Efí NÃO manda o status no POST; manda um token opaco.
  // A informação só existe quando NÓS perguntamos, autenticados. É isso que torna a
  // notificação inútil na mão de terceiros: sem nossas credenciais, o token não abre nada.
  async consultarNotificacao(token) {
    const r = await this._chamar('get', `/v1/notification/${encodeURIComponent(token)}`);
    return Array.isArray(r?.data) ? r.data : [];
  }

  /**
   * Traduz o retorno do provedor para o vocabulário da casa.
   * origem 'efibank-cobrancas' → corpo { notification: "<token>" }
   * origem 'efibank-pix'       → corpo { pix: [ { endToEndId, txid, valor, horario } ] }
   */
  async normalizarWebhook(origem, corpo) {
    if (origem === 'efibank-pix') {
      const lista = Array.isArray(corpo?.pix) ? corpo.pix : [];
      return lista.map((p) => ({
        chaveIdempotencia: `efi-pix:${p.endToEndId || p.txid}`,
        statusExterno: 'pago',
        status: STATUS_PAGAMENTO.PAGO,
        idExterno: p.txid || null,
        endToEndId: p.endToEndId || null,
        valorCentavos: p.valor ? Math.round(parseFloat(p.valor) * 100) : null,
        pagoEm: p.horario ? new Date(p.horario) : new Date(),
        payload: p,
      }));
    }

    const token = corpo?.notification;
    if (!token) return [];
    const historico = await this.consultarNotificacao(token);
    if (!historico.length) return [];
    // O histórico vem em ordem cronológica: o estado atual é o último item.
    const ultimo = historico[historico.length - 1];
    const statusAtual = ultimo?.status?.current || ultimo?.status || null;
    return [{
      chaveIdempotencia: `efi-notif:${token}:${statusAtual || 'sem-status'}`,
      statusExterno: statusAtual,
      status: this._traduzirStatus(statusAtual),
      idExterno: ultimo?.identifiers?.charge_id ? String(ultimo.identifiers.charge_id) : null,
      idExternoAssinatura: ultimo?.identifiers?.subscription_id ? String(ultimo.identifiers.subscription_id) : null,
      customId: ultimo?.custom_id || null,
      valorCentavos: typeof ultimo?.value === 'number' ? ultimo.value : null,
      pagoEm: statusAtual === 'paid' ? new Date(ultimo?.created_at || Date.now()) : null,
      payload: historico,
    }];
  }

  _traduzirStatus(statusEfi) {
    switch (String(statusEfi || '').toLowerCase()) {
      case 'paid':
      case 'settled':
        return STATUS_PAGAMENTO.PAGO;
      case 'unpaid':
      case 'expired':
        return STATUS_PAGAMENTO.VENCIDO;
      case 'canceled':
      case 'cancelled':
        return STATUS_PAGAMENTO.CANCELADO;
      case 'refunded':
      case 'contested':
        return STATUS_PAGAMENTO.ESTORNADO;
      default:
        return STATUS_PAGAMENTO.PENDENTE; // new, waiting, identified, approved, link…
    }
  }

  /** Agente HTTPS com o certificado mTLS — exigido em TODA chamada da API Pix da Efí. */
  agentePix() {
    if (!this.cfg.efi.certificadoPath) {
      throw new Error('EFI_PIX_CERT_PATH não definido — a API Pix da Efí exige certificado mTLS (.p12 ou .pem).');
    }
    const arquivo = fs.readFileSync(this.cfg.efi.certificadoPath);
    const ehP12 = /\.p12$/i.test(this.cfg.efi.certificadoPath);
    return new https.Agent(ehP12
      ? { pfx: arquivo, passphrase: this.cfg.efi.certificadoSenha || '' }
      : { cert: arquivo, key: arquivo });
  }
}

const _adaptadores = new Map();

export function obterAdaptador(nome) {
  const cfg = configuracao();
  const alvo = nome || cfg.adaptadorPadrao || 'manual';
  const chave = `${alvo}`;
  if (!_adaptadores.has(chave)) {
    _adaptadores.set(chave, alvo === 'efibank' ? new AdaptadorEfi(cfg) : new AdaptadorManual(cfg));
  }
  // A configuração é relida a cada chamada para que uma troca de .env + restart valha na hora.
  const inst = _adaptadores.get(chave);
  inst.cfg = cfg;
  return inst;
}

export function situacaoDosAdaptadores() {
  const cfg = configuracao();
  const manual = new AdaptadorManual(cfg).estaConfigurado();
  const efi = new AdaptadorEfi(cfg).estaConfigurado();
  return {
    padrao: cfg.adaptadorPadrao,
    aplicarNaConta: cfg.aplicarNaConta,
    bancoRagnabotConfigurado: !!cfg.urlBancoRagnabot,
    webhookConfigurado: !!cfg.segredoWebhook,
    manual: { ...manual, chavePixDefinida: !!cfg.pix.chave },
    efibank: { ...efi, ambiente: cfg.efi.ambiente, certificadoPix: !!cfg.efi.certificadoPath },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PLANOS
// ═════════════════════════════════════════════════════════════════════════════
export async function listarPlanos({ incluirInativos = false } = {}) {
  return prisma.ragnabotPlano.findMany({
    where: incluirInativos ? {} : { ativo: true },
    orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }],
  });
}

export async function criarPlano(dados) {
  const codigo = String(dados.codigo || dados.nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!codigo) throw new Error('Informe o código ou o nome do plano.');
  if (!dados.nome) throw new Error('Informe o nome do plano.');
  // A capacidade é da frente SaaS. Se veio um código, ele TEM que existir lá — plano
  // comercial apontando para capacidade inexistente é venda de coisa que não existe.
  const codigoCapacidade = dados.codigoCapacidade ?? (planoExiste(codigo) ? codigo : null);
  if (codigoCapacidade && !planoExiste(codigoCapacidade)) {
    throw new Error(`Plano de capacidade "${codigoCapacidade}" não existe em src/config/ragnabot-plans.js.`);
  }
  return prisma.ragnabotPlano.create({
    data: {
      codigo,
      nome: String(dados.nome).trim(),
      descricao: dados.descricao ?? null,
      codigoCapacidade,
      precoCentavos: dados.precoCentavos ?? null, // null = preço ainda não definido pelo dono
      cicloMeses: dados.cicloMeses ?? 1,
      limiteAgentes: dados.limiteAgentes ?? null,
      limiteCaixas: dados.limiteCaixas ?? null,
      limiteMensagensMes: dados.limiteMensagensMes ?? null,
      recursos: dados.recursos ?? [],
      ativo: dados.ativo ?? true,
      publico: dados.publico ?? false,
      ordem: dados.ordem ?? 0,
    },
  });
}

export async function atualizarPlano(id, dados) {
  const campos = ['nome', 'descricao', 'codigoCapacidade', 'precoCentavos', 'cicloMeses',
    'limiteAgentes', 'limiteCaixas', 'limiteMensagensMes', 'recursos', 'ativo', 'publico', 'ordem'];
  const data = {};
  for (const c of campos) if (dados[c] !== undefined) data[c] = dados[c];
  if (data.codigoCapacidade && !planoExiste(data.codigoCapacidade)) {
    throw new Error(`Plano de capacidade "${data.codigoCapacidade}" não existe em src/config/ragnabot-plans.js.`);
  }
  return prisma.ragnabotPlano.update({ where: { id }, data });
}

// ═════════════════════════════════════════════════════════════════════════════
// ASSINATURAS
// ═════════════════════════════════════════════════════════════════════════════
export async function listarAssinaturas({ status, clientCompanyId, busca } = {}) {
  const where = {};
  if (status) where.status = status;
  if (clientCompanyId) where.clientCompanyId = clientCompanyId;
  if (busca) where.rotuloConta = { contains: String(busca), mode: 'insensitive' };
  return prisma.ragnabotAssinatura.findMany({
    where,
    include: {
      plano: true,
      pagamentos: { orderBy: { vencimentoEm: 'desc' }, take: 3 },
    },
    orderBy: [{ status: 'asc' }, { proximoVencimento: 'asc' }],
  });
}

export async function obterAssinatura(id) {
  return prisma.ragnabotAssinatura.findUnique({
    where: { id },
    include: { plano: true, pagamentos: { orderBy: { vencimentoEm: 'desc' } } },
  });
}

/**
 * Cria a assinatura. Se o adaptador for externo (Efí), já registra plano e assinatura lá.
 * Falha na criação externa NÃO perde a assinatura local: fica com `ultimoErro` preenchido,
 * e a rota de sincronização tenta de novo. Perder o cadastro por erro de rede seria pior.
 */
export async function criarAssinatura(dados, { usuario, req } = {}) {
  const plano = await prisma.ragnabotPlano.findUnique({ where: { id: dados.planoId } });
  if (!plano) throw new Error('Plano não encontrado.');

  // Vínculo com a empresa provisionada pela frente SaaS: dela vêm, de graça, o id da conta
  // na plataforma e o nome legível — dois campos a menos para alguém digitar errado.
  let tenant = null;
  if (dados.tenantId) {
    tenant = await prisma.ragnabotTenant.findUnique({ where: { id: dados.tenantId } });
    if (!tenant) throw new Error('Empresa (tenant) não encontrada.');
  }
  if (!dados.rotuloConta && !tenant) throw new Error('Informe o rótulo da conta (nome legível) ou a empresa (tenantId).');

  const cfg = configuracao();
  const nomeAdaptador = dados.adaptador || cfg.adaptadorPadrao || 'manual';
  const cicloMeses = dados.cicloMeses ?? plano.cicloMeses ?? 1;
  const diaVencimento = dados.diaVencimento ?? 10;
  const inicio = dados.inicioEm ? new Date(dados.inicioEm) : new Date();
  const emTeste = !!dados.diasDeTeste && dados.diasDeTeste > 0;
  const fimTeste = emTeste ? new Date(inicio.getTime() + dados.diasDeTeste * 86400000) : null;

  const assinatura = await prisma.ragnabotAssinatura.create({
    data: {
      clientCompanyId: dados.clientCompanyId ?? null,
      tenantId: tenant?.id ?? null,
      contaChatwootId: dados.contaChatwootId ?? tenant?.cwAccountId ?? null,
      rotuloConta: String(dados.rotuloConta || tenant?.name).trim(),
      planoId: plano.id,
      status: emTeste ? STATUS_ASSINATURA.TESTE : STATUS_ASSINATURA.ATIVA,
      cicloMeses,
      valorCentavos: dados.valorCentavos ?? plano.precoCentavos ?? null,
      diaVencimento,
      inicioEm: inicio,
      fimTesteEm: fimTeste,
      // Com teste grátis, o primeiro vencimento é o próximo dia de vencimento DEPOIS do
      // fim do teste. Sem teste, anda um ciclo a partir do início.
      proximoVencimento: emTeste
        ? primeiroVencimentoApos(fimTeste, diaVencimento)
        : avancarVencimento(inicio, cicloMeses, diaVencimento),
      diasCarencia: dados.diasCarencia ?? 5,
      diasParaSuspender: dados.diasParaSuspender ?? 10,
      meioPreferido: MEIOS_PAGAMENTO.includes(dados.meioPreferido) ? dados.meioPreferido : 'pix',
      adaptador: nomeAdaptador,
      emailCobranca: dados.emailCobranca ?? null,
      documentoCobranca: dados.documentoCobranca ? String(dados.documentoCobranca).replace(/\D/g, '') : null,
      contatoNome: dados.contatoNome ?? null,
      contatoTelefone: dados.contatoTelefone ?? null,
      contaLiberada: true,
      metadados: dados.metadados ?? null,
    },
    include: { plano: true },
  });

  if (nomeAdaptador !== 'manual') {
    try {
      const adaptador = obterAdaptador(nomeAdaptador);
      const ext = await adaptador.criarAssinaturaExterna(assinatura, plano);
      await prisma.ragnabotAssinatura.update({
        where: { id: assinatura.id },
        data: { idExterno: ext.idExterno || null, idExternoPlano: ext.idExternoPlano || null, ultimoErro: null },
      });
      if (ext.idExternoPlano && !plano.idExterno) {
        await prisma.ragnabotPlano.update({ where: { id: plano.id }, data: { idExterno: ext.idExternoPlano } });
      }
    } catch (e) {
      await prisma.ragnabotAssinatura.update({ where: { id: assinatura.id }, data: { ultimoErro: e.message } });
      logger.warn(`[ragnabot-cobranca] assinatura ${assinatura.id} criada localmente, mas o provedor falhou: ${e.message}`);
    }
  }

  await logAction({
    user: usuario, req, category: 'settings', action: 'ragnabot.assinatura.criar',
    entityType: 'RagnabotAssinatura', entityId: assinatura.id,
    description: `Assinatura criada para "${assinatura.rotuloConta}" no plano ${plano.nome} (${nomeAdaptador})`,
    payloadAfter: { planoId: plano.id, valorCentavos: assinatura.valorCentavos, adaptador: nomeAdaptador },
    rollbackable: false,
  });

  return obterAssinatura(assinatura.id);
}

export async function atualizarAssinatura(id, dados, { usuario, req } = {}) {
  const antes = await prisma.ragnabotAssinatura.findUnique({ where: { id } });
  if (!antes) throw new Error('Assinatura não encontrada.');
  const campos = ['rotuloConta', 'clientCompanyId', 'tenantId', 'contaChatwootId', 'diaVencimento', 'valorCentavos',
    'diasCarencia', 'diasParaSuspender', 'meioPreferido', 'emailCobranca', 'documentoCobranca',
    'contatoNome', 'contatoTelefone', 'proximoVencimento', 'metadados'];
  const data = {};
  for (const c of campos) if (dados[c] !== undefined) data[c] = dados[c];
  if (data.documentoCobranca) data.documentoCobranca = String(data.documentoCobranca).replace(/\D/g, '');
  if (data.proximoVencimento) data.proximoVencimento = new Date(data.proximoVencimento);
  const depois = await prisma.ragnabotAssinatura.update({ where: { id }, data });
  await logAction({
    user: usuario, req, category: 'settings', action: 'ragnabot.assinatura.atualizar',
    entityType: 'RagnabotAssinatura', entityId: id,
    description: `Assinatura de "${depois.rotuloConta}" atualizada`,
    payloadBefore: antes, payloadAfter: depois,
  });
  return obterAssinatura(id);
}

export async function cancelarAssinatura(id, { motivo, suspenderAgora = false, usuario, req } = {}) {
  const assinatura = await prisma.ragnabotAssinatura.findUnique({ where: { id }, include: { plano: true } });
  if (!assinatura) throw new Error('Assinatura não encontrada.');

  let erroProvedor = null;
  if (assinatura.adaptador !== 'manual') {
    try { await obterAdaptador(assinatura.adaptador).cancelarAssinaturaExterna(assinatura); }
    catch (e) { erroProvedor = e.message; }
  }

  await prisma.ragnabotAssinatura.update({
    where: { id },
    data: {
      status: STATUS_ASSINATURA.CANCELADA,
      canceladaEm: new Date(),
      motivoCancelamento: motivo || null,
      ultimoErro: erroProvedor,
    },
  });
  // Cobranças ainda em aberto deixam de fazer sentido depois do cancelamento.
  await prisma.ragnabotPagamento.updateMany({
    where: { assinaturaId: id, status: { in: [STATUS_PAGAMENTO.PENDENTE, STATUS_PAGAMENTO.VENCIDO] } },
    data: { status: STATUS_PAGAMENTO.CANCELADO, canceladoEm: new Date() },
  });

  await logAction({
    user: usuario, req, category: 'settings', action: 'ragnabot.assinatura.cancelar',
    entityType: 'RagnabotAssinatura', entityId: id,
    description: `Assinatura de "${assinatura.rotuloConta}" cancelada${motivo ? `: ${motivo}` : ''}`,
    rollbackable: false,
  });

  if (suspenderAgora) await suspenderConta(id, { motivo: motivo || 'assinatura cancelada', usuario, req });
  return { ok: true, erroProvedor };
}

// ═════════════════════════════════════════════════════════════════════════════
// COBRANÇA DO CICLO
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Gera (ou devolve) a cobrança de uma competência. IDEMPOTENTE: a chave única
 * (assinaturaId, competencia) garante que rodar o worker duas vezes não cobra duas vezes.
 */
export async function gerarCobrancaDoCiclo(assinaturaId, { competencia, vencimentoEm, usuario, req } = {}) {
  const assinatura = await prisma.ragnabotAssinatura.findUnique({
    where: { id: assinaturaId }, include: { plano: true },
  });
  if (!assinatura) throw new Error('Assinatura não encontrada.');
  if ([STATUS_ASSINATURA.CANCELADA].includes(assinatura.status)) {
    throw new Error('Assinatura cancelada não gera cobrança.');
  }

  const valor = assinatura.valorCentavos ?? assinatura.plano.precoCentavos;
  if (!valor || valor <= 0) {
    throw new Error(`Plano "${assinatura.plano.nome}" está sem preço definido. ` +
      'O valor é decisão do dono — defina o preço do plano antes de cobrar.');
  }

  const vencimento = vencimentoEm
    ? new Date(vencimentoEm)
    : (assinatura.proximoVencimento || avancarVencimento(new Date(), assinatura.cicloMeses, assinatura.diaVencimento));
  const comp = competencia || competenciaDe(vencimento);

  const existente = await prisma.ragnabotPagamento.findUnique({
    where: { assinaturaId_competencia: { assinaturaId, competencia: comp } },
  });
  if (existente && existente.status !== STATUS_PAGAMENTO.CANCELADO) {
    return { pagamento: existente, jaExistia: true };
  }

  let pagamento = existente
    ? await prisma.ragnabotPagamento.update({
        where: { id: existente.id },
        data: { status: STATUS_PAGAMENTO.PENDENTE, canceladoEm: null, valorCentavos: valor, vencimentoEm: vencimento },
      })
    : await prisma.ragnabotPagamento.create({
        data: {
          assinaturaId, competencia: comp, valorCentavos: valor,
          status: STATUS_PAGAMENTO.PENDENTE, meio: assinatura.meioPreferido,
          vencimentoEm: vencimento,
        },
      });

  try {
    const adaptador = obterAdaptador(assinatura.adaptador);
    const cobranca = await adaptador.criarCobranca(assinatura, pagamento);
    pagamento = await prisma.ragnabotPagamento.update({
      where: { id: pagamento.id },
      data: {
        idExterno: cobranca.idExterno || null,
        idExternoAssinatura: assinatura.idExterno || null,
        meio: cobranca.meio || pagamento.meio,
        linkPagamento: cobranca.link || null,
        linhaDigitavel: cobranca.linhaDigitavel || null,
        pixCopiaECola: cobranca.pixCopiaECola || null,
        payload: cobranca.payload ?? null,
      },
    });
    await prisma.ragnabotAssinatura.update({ where: { id: assinaturaId }, data: { ultimoErro: null } });
  } catch (e) {
    await prisma.ragnabotAssinatura.update({ where: { id: assinaturaId }, data: { ultimoErro: e.message } });
    logger.error(`[ragnabot-cobranca] falha ao emitir cobrança da assinatura ${assinaturaId}: ${e.message}`);
    throw e;
  }

  await logAction({
    user: usuario, req, category: 'settings', action: 'ragnabot.cobranca.gerar',
    entityType: 'RagnabotPagamento', entityId: pagamento.id,
    description: `Cobrança ${comp} de "${assinatura.rotuloConta}" — ${formatarBRL(valor)} (venc. ${vencimento.toISOString().slice(0, 10)})`,
    rollbackable: false,
  });
  return { pagamento, jaExistia: false };
}

/** Baixa manual: alguém conferiu o extrato e confirma o recebimento. */
export async function registrarPagamentoManual(pagamentoId, { valorCentavos, pagoEm, observacao, usuario, req } = {}) {
  const pagamento = await prisma.ragnabotPagamento.findUnique({ where: { id: pagamentoId } });
  if (!pagamento) throw new Error('Pagamento não encontrado.');
  if (pagamento.status === STATUS_PAGAMENTO.PAGO) return { pagamento, jaEstavaPago: true };

  const atualizado = await prisma.ragnabotPagamento.update({
    where: { id: pagamentoId },
    data: {
      status: STATUS_PAGAMENTO.PAGO,
      pagoEm: pagoEm ? new Date(pagoEm) : new Date(),
      valorPagoCentavos: valorCentavos ?? pagamento.valorCentavos,
      observacao: observacao || pagamento.observacao,
      baixadoPorUserId: usuario?.id || null,
    },
  });

  await logAction({
    user: usuario, req, category: 'settings', action: 'ragnabot.pagamento.baixa-manual',
    entityType: 'RagnabotPagamento', entityId: pagamentoId,
    description: `Baixa manual de ${formatarBRL(atualizado.valorPagoCentavos)} (competência ${atualizado.competencia})`,
    payloadBefore: pagamento, payloadAfter: atualizado, rollbackable: false,
  });

  const reconciliado = await reconciliarAssinatura(pagamento.assinaturaId, { motivo: 'baixa manual', usuario, req });
  return { pagamento: atualizado, assinatura: reconciliado };
}

// ═════════════════════════════════════════════════════════════════════════════
// RETORNO DO PROVEDOR (webhook)
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Processa o retorno do provedor. Sempre idempotente: o mesmo evento chegando dez vezes
 * dá baixa uma vez só (chave única em RagnabotEventoCobranca.chaveIdempotencia).
 * A Efí repete a entrega até 9 vezes se não receber 2XX — repetição não é exceção, é regra.
 */
export async function tratarRetornoPagamento({ origem, corpo, ip, adaptador } = {}) {
  const nomeAdaptador = adaptador || (origem === 'manual' ? 'manual' : 'efibank');
  const impl = obterAdaptador(nomeAdaptador);
  const eventos = await impl.normalizarWebhook(origem, corpo);
  const resultados = [];

  for (const ev of eventos) {
    // 1) Registro bruto + trava de idempotência. Se já existe, não reprocessa.
    let registro;
    try {
      registro = await prisma.ragnabotEventoCobranca.create({
        data: {
          origem, chaveIdempotencia: ev.chaveIdempotencia, tipo: ev.statusExterno || null,
          statusExterno: ev.statusExterno || null, payload: ev.payload ?? corpo ?? null, ip: ip || null,
        },
      });
    } catch (e) {
      if (e?.code === 'P2002') { resultados.push({ chave: ev.chaveIdempotencia, resultado: 'repetido' }); continue; }
      throw e;
    }

    try {
      const pagamento = await localizarPagamentoDoEvento(ev);
      if (!pagamento) {
        await prisma.ragnabotEventoCobranca.update({
          where: { id: registro.id },
          data: { resultado: 'ignorado', erro: 'pagamento não localizado', processadoEm: new Date() },
        });
        logger.warn(`[ragnabot-cobranca] evento ${ev.chaveIdempotencia} sem pagamento correspondente`);
        resultados.push({ chave: ev.chaveIdempotencia, resultado: 'ignorado' });
        continue;
      }

      // Uma cobrança JÁ PAGA não volta a "pendente" nem a "vencido" por causa de uma
      // notificação atrasada, fora de ordem, ou de um status que não sabemos traduzir
      // (o tradutor devolve "pendente" para tudo que não reconhece). Só estorno e
      // cancelamento desfazem um pagamento. Sem esta trava, um retorno tardio apagaria
      // a baixa e o reconciliador suspenderia um cliente que pagou.
      const desfazemPagamento = [STATUS_PAGAMENTO.ESTORNADO, STATUS_PAGAMENTO.CANCELADO];
      if (pagamento.status === STATUS_PAGAMENTO.PAGO
          && ev.status !== STATUS_PAGAMENTO.PAGO
          && !desfazemPagamento.includes(ev.status)) {
        await prisma.ragnabotEventoCobranca.update({
          where: { id: registro.id },
          data: {
            resultado: 'ignorado', processadoEm: new Date(),
            erro: `cobrança já paga — status "${ev.statusExterno || ev.status}" não rebaixa pagamento`,
            assinaturaId: pagamento.assinaturaId, pagamentoId: pagamento.id,
          },
        });
        logger.warn(`[ragnabot-cobranca] evento ${ev.chaveIdempotencia} ignorado: pagamento ${pagamento.id} já está pago`);
        resultados.push({ chave: ev.chaveIdempotencia, resultado: 'ignorado' });
        continue;
      }

      const dados = { status: ev.status, payload: ev.payload ?? null };
      if (ev.status === STATUS_PAGAMENTO.PAGO) {
        dados.pagoEm = ev.pagoEm || new Date();
        const valorInformado = ev.valorCentavos ?? null;
        dados.valorPagoCentavos = valorInformado ?? pagamento.valorCentavos;
        // Recebido MENOR que o cobrado é diferença de caixa — e diferença de caixa que
        // ninguém enxerga vira prejuízo no fechamento do mês. A baixa acontece (não se
        // suspende quem pagou), mas a divergência fica escrita na cobrança e no log,
        // para alguém conferir com o extrato.
        if (valorInformado !== null && valorInformado < pagamento.valorCentavos) {
          const aviso = `PAGAMENTO PARCIAL: recebido ${formatarBRL(valorInformado)} de ` +
            `${formatarBRL(pagamento.valorCentavos)} — conferir com o extrato.`;
          dados.observacao = pagamento.observacao ? `${pagamento.observacao} | ${aviso}` : aviso;
          logger.warn(`[ragnabot-cobranca] ${aviso} (pagamento ${pagamento.id}, evento ${ev.chaveIdempotencia})`);
        }
      }
      if (ev.status === STATUS_PAGAMENTO.CANCELADO) dados.canceladoEm = new Date();
      if (ev.idExterno && !pagamento.idExterno) dados.idExterno = ev.idExterno;
      await prisma.ragnabotPagamento.update({ where: { id: pagamento.id }, data: dados });

      const assinatura = await reconciliarAssinatura(pagamento.assinaturaId, {
        motivo: `retorno ${origem} (${ev.statusExterno || ev.status})`,
      });

      await prisma.ragnabotEventoCobranca.update({
        where: { id: registro.id },
        data: {
          resultado: 'aplicado', processadoEm: new Date(),
          assinaturaId: pagamento.assinaturaId, pagamentoId: pagamento.id,
        },
      });
      resultados.push({
        chave: ev.chaveIdempotencia, resultado: 'aplicado',
        pagamentoId: pagamento.id, statusAssinatura: assinatura?.status || null,
      });
    } catch (e) {
      // Falha NOSSA (banco fora, provedor instável) não pode queimar a chave de
      // idempotência. A chave do Pix é o mesmo `endToEndId` em toda reentrega: se ela
      // ficasse ocupada por um registro com erro, a reentrega seria descartada como
      // "repetida" e o pagamento sumiria sem ninguém notar. O registro permanece para
      // perícia com a chave marcada, e a chave original volta a ficar livre.
      await prisma.ragnabotEventoCobranca.update({
        where: { id: registro.id },
        data: {
          chaveIdempotencia: `${ev.chaveIdempotencia}#erro:${registro.id}`,
          resultado: 'erro', erro: e.message, processadoEm: new Date(),
        },
      }).catch((e2) => logger.error(`[ragnabot-cobranca] não consegui liberar a chave ${ev.chaveIdempotencia}: ${e2.message}`));
      logger.error(`[ragnabot-cobranca] erro ao aplicar evento ${ev.chaveIdempotencia}: ${e.message}`);
      resultados.push({ chave: ev.chaveIdempotencia, resultado: 'erro', erro: e.message });
    }
  }

  return { recebidos: eventos.length, resultados };
}

/** Encontra a cobrança do evento: pela âncora forte primeiro, e só então pelo palpite. */
async function localizarPagamentoDoEvento(ev) {
  if (ev.idExterno) {
    const p = await prisma.ragnabotPagamento.findUnique({ where: { idExterno: ev.idExterno } });
    if (p) return p;
  }
  if (ev.customId) {
    const m = /^(assinatura|pagamento):(.+)$/.exec(String(ev.customId));
    if (m && m[1] === 'pagamento') {
      const p = await prisma.ragnabotPagamento.findUnique({ where: { id: m[2] } });
      if (p) return p;
    }
    if (m && m[1] === 'assinatura') {
      return prisma.ragnabotPagamento.findFirst({
        where: { assinaturaId: m[2], status: { in: [STATUS_PAGAMENTO.PENDENTE, STATUS_PAGAMENTO.VENCIDO] } },
        orderBy: { vencimentoEm: 'asc' },
      });
    }
  }
  if (ev.idExternoAssinatura) {
    const assinatura = await prisma.ragnabotAssinatura.findFirst({ where: { idExterno: ev.idExternoAssinatura } });
    if (assinatura) {
      return prisma.ragnabotPagamento.findFirst({
        where: { assinaturaId: assinatura.id, status: { in: [STATUS_PAGAMENTO.PENDENTE, STATUS_PAGAMENTO.VENCIDO] } },
        orderBy: { vencimentoEm: 'asc' },
      });
    }
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// RECONCILIAÇÃO — o pagamento manda no estado da assinatura e da conta
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Reavalia UMA assinatura a partir das suas cobranças e aplica a consequência:
 *   pagou            → ativa    + conta liberada + próximo vencimento avançado
 *   vencido ≤ carência → inadimplente + conta AINDA liberada (a régua é gentil por escolha)
 *   vencido > diasParaSuspender → suspensa + conta suspensa
 * A decisão nasce dos fatos gravados, não de quem chamou a função — assim o mesmo
 * resultado sai do webhook, do worker ou de um clique manual.
 */
export async function reconciliarAssinatura(assinaturaId, { motivo, usuario, req } = {}) {
  const assinatura = await prisma.ragnabotAssinatura.findUnique({
    where: { id: assinaturaId },
    include: { plano: true, pagamentos: { orderBy: { vencimentoEm: 'asc' } } },
  });
  if (!assinatura) throw new Error('Assinatura não encontrada.');
  if (assinatura.status === STATUS_ASSINATURA.CANCELADA) return assinatura;

  const agora = new Date();
  const emAberto = assinatura.pagamentos.filter(
    (p) => p.status === STATUS_PAGAMENTO.PENDENTE || p.status === STATUS_PAGAMENTO.VENCIDO,
  );
  const vencidos = emAberto.filter((p) => new Date(p.vencimentoEm) < agora);
  const maisAntigoVencido = vencidos[0] || null;
  const diasDeAtraso = maisAntigoVencido ? diasEntre(agora, maisAntigoVencido.vencimentoEm) : 0;

  const pagos = assinatura.pagamentos.filter((p) => p.status === STATUS_PAGAMENTO.PAGO);
  const ultimoPago = pagos.length ? pagos[pagos.length - 1] : null;

  let novoStatus = assinatura.status;
  if (assinatura.status === STATUS_ASSINATURA.TESTE && assinatura.fimTesteEm && agora > new Date(assinatura.fimTesteEm)) {
    novoStatus = vencidos.length ? STATUS_ASSINATURA.INADIMPLENTE : STATUS_ASSINATURA.ATIVA;
  }
  if (!vencidos.length && assinatura.status !== STATUS_ASSINATURA.TESTE) {
    novoStatus = STATUS_ASSINATURA.ATIVA;
  } else if (vencidos.length) {
    novoStatus = diasDeAtraso > assinatura.diasParaSuspender
      ? STATUS_ASSINATURA.SUSPENSA
      : (diasDeAtraso >= assinatura.diasCarencia ? STATUS_ASSINATURA.INADIMPLENTE : novoStatus);
    // Marca vencido o que passou da data e ainda constava como pendente.
    for (const p of vencidos.filter((x) => x.status === STATUS_PAGAMENTO.PENDENTE)) {
      await prisma.ragnabotPagamento.update({ where: { id: p.id }, data: { status: STATUS_PAGAMENTO.VENCIDO } });
    }
  }

  const dados = { status: novoStatus };
  if (ultimoPago) {
    dados.ultimoPagamentoEm = ultimoPago.pagoEm;
    // Sem nada vencido, o relógio anda: próximo vencimento = último pago + ciclo.
    if (!vencidos.length) {
      dados.proximoVencimento = avancarVencimento(ultimoPago.vencimentoEm, assinatura.cicloMeses, assinatura.diaVencimento);
    }
  }
  dados.inadimplenteDesde = novoStatus === STATUS_ASSINATURA.INADIMPLENTE
    ? (assinatura.inadimplenteDesde || (maisAntigoVencido ? new Date(maisAntigoVencido.vencimentoEm) : agora))
    : null;
  if (novoStatus === STATUS_ASSINATURA.SUSPENSA && !assinatura.suspensaEm) dados.suspensaEm = agora;
  if (novoStatus !== STATUS_ASSINATURA.SUSPENSA) dados.suspensaEm = null;

  await prisma.ragnabotAssinatura.update({ where: { id: assinaturaId }, data: dados });

  // O estado da CONTA segue o estado da assinatura — e só se mexe quando divergem.
  const deveLiberar = STATUS_QUE_LIBERAM.has(novoStatus);
  if (deveLiberar !== assinatura.contaLiberada) {
    if (deveLiberar) await liberarConta(assinaturaId, { motivo: motivo || `reconciliação: ${novoStatus}`, usuario, req });
    else await suspenderConta(assinaturaId, { motivo: motivo || `inadimplência há ${diasDeAtraso} dia(s)`, usuario, req });
  }

  return obterAssinatura(assinaturaId);
}

// ═════════════════════════════════════════════════════════════════════════════
// LIBERAÇÃO / SUSPENSÃO DA CONTA NO CHATWOOT
// ═════════════════════════════════════════════════════════════════════════════
/** Executa uma única instrução SQL no banco do RAGNABOT (Chatwoot). Conexão curta, sem pool. */
async function executarNoBancoRagnabot(sql, parametros) {
  const cfg = configuracao();
  if (!cfg.urlBancoRagnabot) {
    throw new Error('RAGNABOT_DB_URL não configurada — sem ela o NOC não consegue liberar nem suspender a conta.');
  }
  const cliente = new ClientePg({ connectionString: cfg.urlBancoRagnabot, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  await cliente.connect();
  try { return await cliente.query(sql, parametros); }
  finally { await cliente.end().catch(() => {}); }
}

/**
 * Aplica o estado na conta do Chatwoot.
 *   liberar=true  → accounts.status = 0 (active)
 *   liberar=false → accounts.status = 1 (suspended)  → toda requisição da conta vira 401
 * Com RAGNABOT_COBRANCA_APLICAR diferente de 1, apenas REGISTRA a intenção. Isso é
 * proposital: dá para rodar em observação antes de dar ao robô o poder de suspender cliente.
 */
async function aplicarEstadoNaConta(assinatura, liberar, motivo) {
  const cfg = configuracao();
  if (!assinatura.tenantId && !assinatura.contaChatwootId) {
    return { aplicado: false, motivo: 'assinatura sem tenantId e sem contaChatwootId (conta não vinculada)' };
  }
  if (!cfg.aplicarNaConta) {
    return { aplicado: false, motivo: 'trava RAGNABOT_COBRANCA_APLICAR desligada — intenção registrada, conta intacta' };
  }

  // CAMINHO PREFERIDO: a empresa foi provisionada pela frente SaaS, então quem suspende e
  // reativa é ela. Um mecanismo só. Dois caminhos mexendo na mesma conta é como se perde o
  // controle de quem desligou o cliente.
  if (assinatura.tenantId) {
    const tenantSvc = await import('./ragnabot-tenant.service.js');
    // Empresa ENCERRADA (closed) não volta a funcionar porque um boleto foi pago: o
    // encerramento é ato de contrato, e `reativarEmpresa` recusa com a MESMA frase
    // ("não está suspensa") que usa para uma empresa já ativa. Sem separar os dois
    // casos, um pagamento atrasado reabriria em silêncio um contrato encerrado.
    if (liberar) {
      const t = await prisma.ragnabotTenant.findUnique({
        where: { id: assinatura.tenantId }, select: { status: true },
      });
      if (t?.status === 'closed') {
        return { aplicado: false, via: 'tenant', motivo: 'empresa encerrada (closed) — reabrir contrato é ato deliberado no cadastro da empresa' };
      }
    }
    try {
      if (liberar) await tenantSvc.reativarEmpresa(assinatura.tenantId, { req: null });
      else await tenantSvc.suspenderEmpresa(assinatura.tenantId, { motivo: motivo || 'inadimplência' });
      return { aplicado: true, via: 'tenant' };
    } catch (e) {
      // "não está suspensa" na reativação é estado desejado alcançado, não falha.
      if (liberar && /não está suspensa/i.test(e.message)) return { aplicado: true, via: 'tenant', jaEstava: true };
      return { aplicado: false, via: 'tenant', motivo: e.message };
    }
  }

  // CAMINHO DIRETO (conta antiga, sem tenant): mexe no accounts.status do Chatwoot.
  const r = await executarNoBancoRagnabot(
    'UPDATE accounts SET status = $1, updated_at = NOW() WHERE id = $2',
    [liberar ? 0 : 1, assinatura.contaChatwootId],
  );
  if (!r.rowCount) return { aplicado: false, motivo: `conta ${assinatura.contaChatwootId} não existe no banco do RAGNABOT` };
  return { aplicado: true, via: 'banco' };
}

/**
 * Aplica o estado na conta e escreve a trilha. Um caminho só para liberar e suspender,
 * porque o cuidado que os dois exigem é o mesmo.
 *
 * ⚠️ REGRA QUE NÃO PODE SER "SIMPLIFICADA": `contaLiberada` é o ESPELHO do que está
 * aplicado na conta do cliente, NUNCA da nossa intenção. Se a aplicação não aconteceu
 * (trava `RAGNABOT_COBRANCA_APLICAR` desligada, banco do RAGNABOT fora, assinatura sem
 * vínculo com conta), a coluna FICA COMO ESTAVA — assim o reconciliador continua vendo
 * divergência e tenta de novo no ciclo seguinte. Gravar a intenção como se fosse fato
 * fazia a suspensão desaparecer para sempre no dia em que a trava fosse ligada, que é
 * exatamente o dia em que ela precisava valer. `pendente` no retorno diz isso em voz alta.
 */
async function aplicarEDocumentar(assinaturaId, liberar, { motivo, usuario, req } = {}) {
  const assinatura = await prisma.ragnabotAssinatura.findUnique({ where: { id: assinaturaId } });
  if (!assinatura) throw new Error('Assinatura não encontrada.');
  const r = await aplicarEstadoNaConta(assinatura, liberar, motivo);
  const motivoNaoAplicado = r.aplicado ? null : (r.motivo || 'não aplicado');

  await prisma.ragnabotAssinatura.update({
    where: { id: assinaturaId },
    data: {
      contaLiberada: r.aplicado ? liberar : assinatura.contaLiberada,
      aplicadoEm: r.aplicado ? new Date() : assinatura.aplicadoEm,
      ultimoErro: motivoNaoAplicado,
    },
  });

  // A auditoria registra o que ACONTECEU. Uma tentativa que falha pelo mesmo motivo de
  // hora em hora não é fato novo — vira ruído que esconde o fato que importa. Por isso
  // grava-se quando a ação foi aplicada, quando alguém a pediu à mão (tem `usuario`) ou
  // quando o motivo da falha MUDOU.
  const fatoNovo = r.aplicado || !!usuario || assinatura.ultimoErro !== motivoNaoAplicado;
  if (fatoNovo) {
    await logAction({
      user: usuario, req, category: 'settings',
      action: liberar ? 'ragnabot.conta.liberar' : 'ragnabot.conta.suspender',
      entityType: 'RagnabotAssinatura', entityId: assinaturaId,
      description: `Conta "${assinatura.rotuloConta}" ${liberar ? 'LIBERADA' : 'SUSPENSA'}${motivo ? ` — ${motivo}` : ''}` +
        (r.aplicado ? '' : ` (NÃO APLICADO, segue pendente: ${motivoNaoAplicado})`),
      payloadAfter: { aplicado: r.aplicado, via: r.via || null, motivoNaoAplicado },
      rollbackable: false,
    });
    const linha = `[ragnabot-cobranca] ${liberar ? 'liberar' : 'suspender'} conta ${assinatura.rotuloConta}: ` +
      (r.aplicado ? `aplicado (${r.via})` : `PENDENTE — ${motivoNaoAplicado}`);
    if (r.aplicado) logger.info(linha); else logger.warn(linha);
  }

  return { ...r, pendente: !r.aplicado, estadoDesejado: liberar ? 'liberada' : 'suspensa' };
}

export async function liberarConta(assinaturaId, opcoes = {}) {
  return aplicarEDocumentar(assinaturaId, true, opcoes);
}

export async function suspenderConta(assinaturaId, opcoes = {}) {
  return aplicarEDocumentar(assinaturaId, false, opcoes);
}

/** Lê o estado REAL da conta no Chatwoot — para conferir se o banco e o NOC contam a mesma história. */
export async function conferirEstadoDaConta(assinaturaId) {
  const assinatura = await prisma.ragnabotAssinatura.findUnique({ where: { id: assinaturaId } });
  if (!assinatura) throw new Error('Assinatura não encontrada.');
  // Se a empresa é da frente SaaS, o estado dela é o veredito — é ela quem aplica.
  if (assinatura.tenantId) {
    const t = await prisma.ragnabotTenant.findUnique({ where: { id: assinatura.tenantId } });
    if (t) {
      const liberadaNoTenant = t.status !== 'suspended' && t.status !== 'closed';
      return {
        conhecido: true, via: 'tenant', tenantId: t.id, nomeNoChatwoot: t.name,
        statusDoTenant: t.status, contaChatwootId: t.cwAccountId,
        liberadaNoChatwoot: liberadaNoTenant, liberadaNoNoc: assinatura.contaLiberada,
        divergente: liberadaNoTenant !== assinatura.contaLiberada,
      };
    }
  }
  if (!assinatura.contaChatwootId) return { conhecido: false, motivo: 'assinatura sem contaChatwootId' };
  const r = await executarNoBancoRagnabot('SELECT id, name, status FROM accounts WHERE id = $1', [assinatura.contaChatwootId]);
  if (!r.rowCount) return { conhecido: false, motivo: 'conta inexistente no banco do RAGNABOT' };
  const linha = r.rows[0];
  const liberadaNoChatwoot = Number(linha.status) === 0;
  return {
    conhecido: true,
    via: 'banco',
    contaChatwootId: linha.id,
    nomeNoChatwoot: linha.name,
    liberadaNoChatwoot,
    liberadaNoNoc: assinatura.contaLiberada,
    divergente: liberadaNoChatwoot !== assinatura.contaLiberada,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// WORKER — o ciclo que roda sozinho
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Uma passada completa:
 *   1. emite a cobrança das assinaturas cujo vencimento cai nos próximos N dias;
 *   2. reconcilia todas as assinaturas vivas (marca vencido, muda status, aplica na conta).
 * Seguro para rodar quantas vezes quiser: cada passo é idempotente.
 */
export async function executarCicloDeCobranca({ diasDeAntecedencia = 5 } = {}) {
  const agora = new Date();
  const limite = new Date(agora.getTime() + diasDeAntecedencia * 86400000);
  const resumo = { emitidas: 0, jaExistiam: 0, reconciliadas: 0, erros: [] };

  const aCobrar = await prisma.ragnabotAssinatura.findMany({
    where: {
      status: { in: [STATUS_ASSINATURA.ATIVA, STATUS_ASSINATURA.INADIMPLENTE, STATUS_ASSINATURA.SUSPENSA] },
      proximoVencimento: { not: null, lte: limite },
    },
    select: { id: true, rotuloConta: true, proximoVencimento: true },
  });
  for (const a of aCobrar) {
    try {
      const r = await gerarCobrancaDoCiclo(a.id, { vencimentoEm: a.proximoVencimento });
      if (r.jaExistia) resumo.jaExistiam++; else resumo.emitidas++;
    } catch (e) {
      resumo.erros.push({ assinaturaId: a.id, conta: a.rotuloConta, erro: e.message });
    }
  }

  const vivas = await prisma.ragnabotAssinatura.findMany({
    where: { status: { not: STATUS_ASSINATURA.CANCELADA } },
    select: { id: true, rotuloConta: true },
  });
  for (const a of vivas) {
    try { await reconciliarAssinatura(a.id, { motivo: 'ciclo automático' }); resumo.reconciliadas++; }
    catch (e) { resumo.erros.push({ assinaturaId: a.id, conta: a.rotuloConta, erro: e.message }); }
  }

  logger.info(`[ragnabot-cobranca] ciclo: ${resumo.emitidas} emitida(s), ${resumo.jaExistiam} já existente(s), ` +
    `${resumo.reconciliadas} reconciliada(s), ${resumo.erros.length} erro(s)`);
  return resumo;
}

let _timerCiclo = null;

/**
 * Liga o worker (padrão: de hora em hora). NÃO é iniciado sozinho: quem decide é o server.js,
 * e só depois que o dono aprovar. Ligar worker de cobrança por conta própria seria cobrar
 * cliente sem ordem de ninguém.
 */
export function iniciarWorkerCobranca({ intervaloMinutos = 60 } = {}) {
  if (_timerCiclo) return { jaEstavaLigado: true };
  const intervalo = Math.max(5, intervaloMinutos) * 60000;
  _timerCiclo = setInterval(() => {
    executarCicloDeCobranca().catch((e) => logger.error(`[ragnabot-cobranca] ciclo falhou: ${e.message}`));
  }, intervalo);
  if (_timerCiclo.unref) _timerCiclo.unref();
  logger.info(`[ragnabot-cobranca] worker ligado (a cada ${intervaloMinutos} min)`);
  return { jaEstavaLigado: false, intervaloMinutos };
}

export function pararWorkerCobranca() {
  if (_timerCiclo) { clearInterval(_timerCiclo); _timerCiclo = null; return { parado: true }; }
  return { parado: false };
}

// ═════════════════════════════════════════════════════════════════════════════
// VISÃO GERAL (para a tela)
// ═════════════════════════════════════════════════════════════════════════════
export async function panoramaFinanceiro() {
  const [assinaturas, pagamentos] = await Promise.all([
    prisma.ragnabotAssinatura.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ragnabotPagamento.groupBy({ by: ['status'], _count: { _all: true }, _sum: { valorCentavos: true } }),
  ]);
  const ativas = await prisma.ragnabotAssinatura.findMany({
    where: { status: { in: [STATUS_ASSINATURA.ATIVA, STATUS_ASSINATURA.INADIMPLENTE] } },
    select: { valorCentavos: true, cicloMeses: true, plano: { select: { precoCentavos: true } } },
  });
  // Receita recorrente mensal: cada assinatura normalizada para um mês.
  const receitaMensalCentavos = ativas.reduce((soma, a) => {
    const v = a.valorCentavos ?? a.plano?.precoCentavos ?? 0;
    return soma + Math.round(v / Math.max(1, a.cicloMeses));
  }, 0);
  // Intenções que ainda NÃO viraram fato na conta do cliente (trava desligada, banco do
  // RAGNABOT fora, assinatura sem vínculo). Sem este número, uma suspensão que nunca foi
  // aplicada some da vista — e o cliente inadimplente continua usando sem ninguém saber.
  const pendentesDeAplicacao = await prisma.ragnabotAssinatura.count({
    where: {
      OR: [
        { status: { in: [...STATUS_QUE_LIBERAM] }, contaLiberada: false },
        { status: STATUS_ASSINATURA.SUSPENSA, contaLiberada: true },
      ],
    },
  });

  return {
    assinaturasPorStatus: Object.fromEntries(assinaturas.map((s) => [s.status, s._count._all])),
    contasPendentesDeAplicacao: pendentesDeAplicacao,
    pagamentosPorStatus: Object.fromEntries(pagamentos.map((p) => [p.status, {
      quantidade: p._count._all, totalCentavos: p._sum.valorCentavos || 0,
    }])),
    receitaMensalCentavos,
    receitaMensalFormatada: formatarBRL(receitaMensalCentavos),
    adaptadores: situacaoDosAdaptadores(),
  };
}
