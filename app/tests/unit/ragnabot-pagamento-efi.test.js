// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DO PAGAMENTO PIX (EFÍ) — idempotência, origem do webhook, ambiente e credencial por empresa.
//
// O QUE ESTE ARQUIVO PROVA, e por que cada prova existe:
//
//   1. ⚠️ IDEMPOTÊNCIA DO WEBHOOK (B4) — a mesma notificação chegando duas vezes NÃO cobra nem
//      credita duas vezes. O webhook do Pix repete por desenho (a Efí reentrega até receber 2xx);
//      é a lição do alerta de backup do CRCMA, agora em dinheiro.
//   2. IDEMPOTÊNCIA DA CRIAÇÃO — o mesmo nó, na mesma visita, não gera duas cobranças. `txid`
//      determinístico + `chaveEfeito` única + `PUT /v2/cob/:txid`.
//   3. BAIXA CONDICIONAL — mesmo que a trava (1) falhasse um dia, `updateMany` com
//      `status:'aguardando'` no WHERE impede a segunda baixa.
//   4. ORIGEM DO WEBHOOK — HMAC ausente é 503 (não configurado), errado é 401, IP estranho é 403.
//   5. AMBIENTE (B8) — o padrão é HOMOLOGAÇÃO. Só a palavra exata `producao` liga produção.
//   6. CREDENCIAL POR EMPRESA (B7) — a da empresa vence a da casa, que vence o ambiente.
//   7. TOKEN EM CACHE (B1) — duas chamadas seguidas autenticam UMA vez.
//   8. NADA DE SEGREDO NEM DE `txid` INTEIRO EM LOG/AUDITORIA.
//
// Sem rede: a porta HTTP é injetada. Sem banco: dublê de Prisma em memória com os únicos
// declarados — é a recusa do banco que faz a prova de idempotência valer alguma coisa.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ⚠️ `vi.hoisted` e não uma linha solta: `src/base/config.js` lê `ENCRYPTION_KEY` NA HORA DO
// IMPORT, e os imports do ES são içados para cima de tudo. Sem isto, a chave chegaria tarde e
// metade das provas falharia com "ENCRYPTION_KEY must be at least 64 hex characters".
// Chave de teste, obviamente falsa (64 zeros). ⛔ Nenhum valor real de credencial entra em teste.
vi.hoisted(() => { process.env.ENCRYPTION_KEY = '0'.repeat(64); });

import { criarFakeSimples } from '../fixtures/fake-prisma-simples.mjs';
import * as pix from '../../src/services/ragnabot-pagamento-efi.service.js';

const MODELOS = [
  'ragnabotPagamentoCredencial', 'ragnabotCobrancaPix', 'ragnabotCobrancaPixEvento',
  'ragnabotFluxoExecucao',
];
const UNICOS = {
  ragnabotPagamentoCredencial: [['chaveEscopo']],
  ragnabotCobrancaPix: [['txid'], ['chaveEfeito']],
  ragnabotCobrancaPixEvento: [['chaveIdempotencia']],
  ragnabotFluxoExecucao: [['id']],
};

const EMPRESA = '11111111-2222-3333-4444-555555555555';
const HMAC = 'hmac-de-teste-nao-e-segredo-real';

let db;
let chamadas;
let auditados;
let enfileirados;

function montar({ respostas = {} } = {}) {
  db = criarFakeSimples(MODELOS, UNICOS);
  chamadas = [];
  auditados = [];
  enfileirados = [];
  pix.esquecerTokens();
  pix.configurarPagamentoEfi({
    db,
    log: { info() {}, warn() {}, error() {} },
    auditoria: { registrar: async (e) => { auditados.push(e); } },
    fila: { enfileirar: async (j) => { enfileirados.push(j); return { id: enfileirados.length }; } },
    http: async ({ metodo, url, corpo, cabecalhos }) => {
      chamadas.push({ metodo, url, corpo, cabecalhos });
      if (url.endsWith('/oauth/token')) {
        return respostas.token ?? { status: 200, dados: { access_token: 'token-falso-de-teste', expires_in: 600 } };
      }
      if (/\/v2\/cob\//.test(url)) {
        return respostas.cob ?? { status: 201, dados: { txid: url.split('/').pop(), status: 'ATIVA', loc: { id: 77 }, pixCopiaECola: '00020101021226BR.GOV.BCB.PIX...6304ABCD' } };
      }
      if (/\/v2\/loc\//.test(url)) return respostas.loc ?? { status: 200, dados: { qrcode: 'copia-e-cola-do-loc' } };
      if (/\/v2\/webhook\//.test(url)) return respostas.webhook ?? { status: 200, dados: {} };
      return { status: 404, dados: {} };
    },
  });
  return db;
}

async function credencialDaCasa({ ambiente = 'homologacao' } = {}) {
  await pix.salvarCredencial({
    tenantId: null, ambiente,
    clientId: 'client-id-de-teste', clientSecret: 'client-secret-de-teste',
    certificadoCaminho: '/tmp/nao-existe-de-proposito.p12', certificadoSenha: 'senha-de-teste',
    chavePix: 'pix-teste@ragnatela.com.br', webhookHmac: HMAC,
  });
}

beforeEach(() => {
  delete process.env.EFI_PIX_AMBIENTE;
  delete process.env.EFI_AMBIENTE;
  delete process.env.EFI_PIX_WEBHOOK_HMAC;
  delete process.env.EFI_PIX_WEBHOOK_IPS;
  montar();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. AMBIENTE (B8)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('ambiente', () => {
  it('o padrão é HOMOLOGAÇÃO — ninguém cobra em produção por engano', () => {
    expect(pix.configuracaoPix().ambiente).toBe('homologacao');
    expect(pix.configuracaoPix().urlBase).toBe('https://pix-h.api.efipay.com.br');
  });

  it('só a palavra exata "producao" liga produção', () => {
    for (const valor of ['prod', 'PRODUCAO', 'production', '1', 'true', 'lixo']) {
      process.env.EFI_PIX_AMBIENTE = valor;
      expect(pix.configuracaoPix().ambiente).toBe('homologacao');
    }
    process.env.EFI_PIX_AMBIENTE = 'producao';
    expect(pix.configuracaoPix().ambiente).toBe('producao');
    expect(pix.configuracaoPix().urlBase).toBe('https://pix.api.efipay.com.br');
  });

  it('as duas URLs são as do doc 36', () => {
    expect(pix.urlBaseDoAmbiente('producao')).toBe('https://pix.api.efipay.com.br');
    expect(pix.urlBaseDoAmbiente('homologacao')).toBe('https://pix-h.api.efipay.com.br');
  });

  it('a situação da integração lista o que falta, sem revelar valor', () => {
    const s = pix.situacaoDaIntegracao();
    expect(s.ok).toBe(false);
    expect(s.faltando).toContain('EFI_PIX_CLIENT_ID');
    expect(s.mtlsDeEntradaNoNginx).toMatch(/nginx|BACEN|doc 36/i);
    expect(JSON.stringify(s)).not.toContain('secret');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. TXID E VALOR
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('txid e valor', () => {
  it('txid é determinístico a partir da semente e respeita o BACEN (26..35, alfanumérico)', () => {
    const a = pix.gerarTxid('efeito:abc:1');
    const b = pix.gerarTxid('efeito:abc:1');
    const c = pix.gerarTxid('efeito:abc:2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-zA-Z0-9]{26,35}$/);
  });

  it('sem semente, dois txid seguidos são diferentes', () => {
    expect(pix.gerarTxid()).not.toBe(pix.gerarTxid());
  });

  it('o log leva o txid TRUNCADO — rastro de dinheiro não vai inteiro para arquivo de log', () => {
    const t = pix.gerarTxid('x');
    const red = pix.redigirTxid(t);
    expect(red).not.toContain(t);
    expect(red.startsWith(t.slice(0, 8))).toBe(true);
  });

  it('valor sai em reais com duas casas, e valor inválido é recusado', () => {
    expect(pix.valorEfi(2490)).toBe('24.90');
    expect(pix.valorEfi(5)).toBe('0.05');
    expect(() => pix.valorEfi(0)).toThrow(/centavos/);
    expect(() => pix.valorEfi(-1)).toThrow();
    expect(() => pix.valorEfi(10.5)).toThrow();
  });

  it('"10.00" volta a 1000 centavos por texto (sem ponto flutuante no meio)', () => {
    expect(pix.valorEmCentavos('10.00')).toBe(1000);
    expect(pix.valorEmCentavos('0.01')).toBe(1);
    expect(pix.valorEmCentavos('1234.56')).toBe(123456);
    expect(pix.valorEmCentavos('abc')).toBeNull();
    expect(pix.valorEmCentavos(null)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. AUTENTICAÇÃO E CREDENCIAL POR EMPRESA (B1, B7)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('autenticação e credencial', () => {
  it('o token é guardado: duas chamadas seguidas autenticam UMA vez', async () => {
    await credencialDaCasa();
    const a = await pix.obterToken(EMPRESA);
    const b = await pix.obterToken(EMPRESA);
    expect(a.doCache).toBe(false);
    expect(b.doCache).toBe(true);
    expect(chamadas.filter((c) => c.url.endsWith('/oauth/token')).length).toBe(1);
    expect(b.token).toBe('token-falso-de-teste');
  });

  it('usa Basic com Client_Id:Client_Secret, e o segredo NÃO aparece em claro na URL', async () => {
    await credencialDaCasa();
    await pix.obterToken(EMPRESA);
    const auth = chamadas[0].cabecalhos.Authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(auth.slice(6), 'base64').toString()).toBe('client-id-de-teste:client-secret-de-teste');
    expect(chamadas[0].url).not.toContain('client-secret');
  });

  it('a credencial DA EMPRESA vence a da casa (B7)', async () => {
    await credencialDaCasa();
    await pix.salvarCredencial({
      tenantId: EMPRESA, ambiente: 'producao',
      clientId: 'id-da-empresa', clientSecret: 'segredo-da-empresa',
      certificadoCaminho: '/tmp/empresa.p12', chavePix: 'chave-da-empresa',
    });
    const cred = await pix.credencialEfetiva(EMPRESA);
    expect(cred.origem).toBe('empresa');
    expect(cred.clientId).toBe('id-da-empresa');
    expect(cred.ambiente).toBe('producao');
    expect(cred.urlBase).toBe('https://pix.api.efipay.com.br');

    // ...e outra empresa continua na conta da casa.
    const outra = await pix.credencialEfetiva('outra-empresa');
    expect(outra.origem).toBe('casa');
    expect(outra.clientId).toBe('client-id-de-teste');
  });

  it('os segredos ficam CIFRADOS no banco — nunca em claro', async () => {
    await credencialDaCasa();
    const linha = db.__tabelas.ragnabotPagamentoCredencial[0];
    expect(linha.clientSecretCifrado).not.toContain('client-secret-de-teste');
    expect(linha.clientSecretCifrado).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(JSON.stringify(linha)).not.toContain('senha-de-teste');
  });

  it('a auditoria da credencial NÃO carrega valor nenhum', async () => {
    await credencialDaCasa();
    const evento = auditados.find((a) => a.acao === 'pix_credencial_salva');
    expect(evento).toBeTruthy();
    const texto = JSON.stringify(evento);
    expect(texto).not.toContain('client-secret-de-teste');
    expect(texto).not.toContain('senha-de-teste');
  });

  it('sem credencial completa, recusa com a lista do que falta — em vez de falhar na Efí', async () => {
    await expect(pix.obterToken(EMPRESA)).rejects.toThrow(/incompleta|Falta/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. CRIAÇÃO DA COBRANÇA (B2) — e a idempotência dela
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('criar cobrança', () => {
  beforeEach(async () => { await credencialDaCasa(); });

  it('cria a cobrança e devolve o copia-e-cola', async () => {
    const r = await pix.criarCobrancaPix({
      tenantId: EMPRESA, valorCentavos: 2490, descricao: 'Mensalidade',
      cwAccountId: 1, cwConversationId: 10,
    });
    expect(r.status).toBe('aguardando');
    expect(r.copiaECola).toContain('BR.GOV.BCB.PIX');
    expect(r.valorCentavos).toBe(2490);

    const put = chamadas.find((c) => c.metodo === 'put');
    expect(put.url).toMatch(/\/v2\/cob\/[a-zA-Z0-9]{26,35}$/);
    expect(put.corpo.valor.original).toBe('24.90');
    expect(put.corpo.chave).toBe('pix-teste@ragnatela.com.br');
    expect(put.corpo.calendario.expiracao).toBe(3600);
  });

  it('quando a Efí não manda o copia-e-cola, busca em /v2/loc/:id/qrcode', async () => {
    montar({ respostas: { cob: { status: 201, dados: { status: 'ATIVA', loc: { id: 99 } } } } });
    await credencialDaCasa();
    const r = await pix.criarCobrancaPix({ tenantId: EMPRESA, valorCentavos: 100 });
    expect(r.copiaECola).toBe('copia-e-cola-do-loc');
    expect(chamadas.some((c) => c.url.includes('/v2/loc/99/qrcode'))).toBe(true);
  });

  it('⚠️ o MESMO nó na MESMA visita não cria duas cobranças', async () => {
    const pedido = {
      tenantId: EMPRESA, valorCentavos: 5000, chaveEfeito: 'exec-1:no-7:v3:',
      cwAccountId: 1, cwConversationId: 10, execucaoId: 'exec-1', noId: 'no-7', visitaSeq: 3,
    };
    const a = await pix.criarCobrancaPix(pedido);
    const b = await pix.criarCobrancaPix(pedido);

    expect(a.txid).toBe(b.txid);
    expect(b.reaproveitada).toBe(true);
    expect(db.__tabelas.ragnabotCobrancaPix.length).toBe(1);
    // Uma criação só na Efí: a segunda chamada nem sai.
    expect(chamadas.filter((c) => c.metodo === 'put' && c.url.includes('/v2/cob/')).length).toBe(1);
  });

  it('recusa da Efí deixa a cobrança marcada como erro, com o txid guardado para conciliar', async () => {
    montar({ respostas: { cob: { status: 422, dados: { nome: 'requisicao_invalida' } } } });
    await credencialDaCasa();
    await expect(pix.criarCobrancaPix({ tenantId: EMPRESA, valorCentavos: 100 })).rejects.toThrow(/recusou/);
    const linha = db.__tabelas.ragnabotCobrancaPix[0];
    expect(linha.status).toBe('erro');
    expect(linha.txid).toMatch(/^[a-zA-Z0-9]{26,35}$/);
  });

  it('valor inválido é recusado antes de qualquer chamada', async () => {
    await expect(pix.criarCobrancaPix({ tenantId: EMPRESA, valorCentavos: 0 })).rejects.toThrow(/centavos/);
    expect(chamadas.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. ORIGEM DO WEBHOOK (B3) — as camadas que SÃO nossas
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('validação de origem do webhook', () => {
  it('sem HMAC configurado: 503 (não configurado), nunca "autorizado"', async () => {
    const r = await pix.validarOrigem({ ip: pix.IP_EFI, hmac: 'qualquer' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(r.motivo).toBe('hmac_do_webhook_nao_configurado');
  });

  it('HMAC certo + IP da Efí = aceito', async () => {
    await credencialDaCasa();
    const r = await pix.validarOrigem({ ip: pix.IP_EFI, hmac: HMAC });
    expect(r.ok).toBe(true);
  });

  it('HMAC errado = 401, inclusive quando tem o mesmo tamanho', async () => {
    await credencialDaCasa();
    const mesmoTamanho = 'x'.repeat(HMAC.length);
    expect((await pix.validarOrigem({ ip: pix.IP_EFI, hmac: mesmoTamanho })).status).toBe(401);
    expect((await pix.validarOrigem({ ip: pix.IP_EFI, hmac: 'curto' })).status).toBe(401);
    expect((await pix.validarOrigem({ ip: pix.IP_EFI, hmac: '' })).status).toBe(401);
  });

  it('IP fora da lista = 403 (a Efí publica 34.193.116.226)', async () => {
    await credencialDaCasa();
    const r = await pix.validarOrigem({ ip: '203.0.113.9', hmac: HMAC });
    expect(r.status).toBe(403);
    expect(r.motivo).toBe('ip_de_origem_nao_autorizado');
  });

  it('IPv4 mapeado em IPv6 (::ffff:…) é reconhecido — é assim que chega atrás do Ingress', async () => {
    await credencialDaCasa();
    expect((await pix.validarOrigem({ ip: `::ffff:${pix.IP_EFI}`, hmac: HMAC })).ok).toBe(true);
  });

  it('o corpo é validado: formato errado não vira baixa', () => {
    expect(pix.validarCorpo(null).ok).toBe(false);
    expect(pix.validarCorpo({}).motivo).toBe('corpo_sem_lista_pix');
    expect(pix.validarCorpo({ pix: [] }).motivo).toBe('nenhum_item_utilizavel');
    expect(pix.validarCorpo({ pix: [{ valor: '10.00' }] }).motivo).toBe('nenhum_item_utilizavel');
    const bom = pix.validarCorpo({ pix: [{ endToEndId: 'E123', txid: 'abc', valor: '10.00', horario: '2026-09-02T12:00:00Z' }] });
    expect(bom.ok).toBe(true);
    expect(bom.itens[0].valorCentavos).toBe(1000);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. ⚠️ IDEMPOTÊNCIA DA NOTIFICAÇÃO (B4) — a prova mais importante deste arquivo
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('notificação de pagamento — idempotência', () => {
  let cobranca;
  const E2E = 'E12345678202609021200abcdef0001';

  beforeEach(async () => {
    await credencialDaCasa();
    cobranca = await pix.criarCobrancaPix({
      tenantId: EMPRESA, valorCentavos: 2490, cwAccountId: 1, cwConversationId: 10,
    });
  });

  const notificacao = (extra = {}) => ({
    pix: [{ endToEndId: E2E, txid: cobranca.txid, valor: '24.90', horario: '2026-09-02T12:00:00.000Z', ...extra }],
  });

  it('a MESMA notificação duas vezes: aplica UMA e registra a segunda como duplicada', async () => {
    const a = await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI });
    const b = await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI });

    expect(a.aplicados).toBe(1);
    expect(b.aplicados).toBe(0);
    expect(b.duplicados).toBe(1);

    const linha = db.__tabelas.ragnabotCobrancaPix[0];
    expect(linha.status).toBe('pago');
    expect(linha.valorPagoCentavos).toBe(2490); // não dobrou
    expect(linha.e2eId).toBe(E2E);

    // A trilha guarda as DUAS entregas — a prova de que a segunda chegou e foi recusada.
    const eventos = db.__tabelas.ragnabotCobrancaPixEvento.filter((e) => e.tipo === 'notificacao');
    expect(eventos.length).toBe(1); // a segunda nem chega a criar linha: o único do banco recusa
    expect(db.__tabelas.ragnabotCobrancaPix.length).toBe(1);
  });

  it('dez entregas da mesma notificação continuam dando UMA baixa', async () => {
    const rs = [];
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      rs.push(await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI }));
    }
    expect(rs.filter((r) => r.aplicados === 1).length).toBe(1);
    expect(rs.filter((r) => r.duplicados === 1).length).toBe(9);
  });

  it('a BAIXA É CONDICIONAL: outra liquidação sobre cobrança já paga não credita de novo', async () => {
    await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI });
    // endToEndId DIFERENTE (passa pela primeira trava) sobre a MESMA cobrança, já paga.
    const r = await pix.tratarNotificacaoPix({
      corpo: { pix: [{ endToEndId: 'E99999999202609021300ffffffff0002', txid: cobranca.txid, valor: '24.90', horario: '2026-09-02T13:00:00.000Z' }] },
      ip: pix.IP_EFI,
    });
    expect(r.aplicados).toBe(0);
    expect(r.duplicados).toBe(1);
    expect(r.itens[0].resultado).toBe('ignorado_ja_pago');
    const linha = db.__tabelas.ragnabotCobrancaPix[0];
    expect(linha.e2eId).toBe(E2E); // continua a primeira liquidação
  });

  it('notificação de cobrança desconhecida é registrada e ignorada, sem estourar', async () => {
    const r = await pix.tratarNotificacaoPix({
      corpo: { pix: [{ endToEndId: 'E00000000000000000000000000001', txid: 'txidQueNaoExisteAquiNunca000', valor: '1.00' }] },
      ip: pix.IP_EFI,
    });
    expect(r.ok).toBe(true);
    expect(r.desconhecidos).toBe(1);
    expect(r.aplicados).toBe(0);
  });

  it('notificação endereçada a OUTRA empresa não dá baixa nesta cobrança', async () => {
    const r = await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI, tenantId: 'empresa-diferente' });
    expect(r.aplicados).toBe(0);
    expect(r.desconhecidos).toBe(1);
    expect(db.__tabelas.ragnabotCobrancaPix[0].status).toBe('aguardando');
  });

  it('o pagamento vira AUDITORIA, com o txid truncado (rastro de dinheiro é auditoria)', async () => {
    await pix.tratarNotificacaoPix({ corpo: notificacao(), ip: pix.IP_EFI });
    const evento = auditados.find((a) => a.acao === 'pix_pago');
    expect(evento).toBeTruthy();
    expect(evento.depois.valorCentavos).toBe(2490);
    expect(evento.depois.txid).not.toBe(cobranca.txid);
    expect(evento.depois.txid).toContain('…');
  });

  it('a trilha guarda o payload REDIGIDO (sem a chave Pix)', async () => {
    await pix.tratarNotificacaoPix({ corpo: notificacao({ chave: 'pix-teste@ragnatela.com.br' }), ip: pix.IP_EFI });
    const evento = db.__tabelas.ragnabotCobrancaPixEvento.find((e) => e.tipo === 'notificacao');
    expect(JSON.stringify(evento.payload)).not.toContain('pix-teste@ragnatela.com.br');
  });

  it('corpo inválido é registrado como erro e NÃO aplica nada', async () => {
    const r = await pix.tratarNotificacaoPix({ corpo: { qualquer: 'coisa' }, ip: pix.IP_EFI });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('corpo_sem_lista_pix');
    expect(db.__tabelas.ragnabotCobrancaPix[0].status).toBe('aguardando');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. ESTADO NA CONVERSA (B6) E O DESPERTAR DO FLUXO
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('estado na conversa e volta ao fluxo', () => {
  beforeEach(async () => { await credencialDaCasa(); });

  it('cobrança vencida aparece como EXPIRADA, mesmo sem ninguém ter rodado nada', async () => {
    const c = await pix.criarCobrancaPix({ tenantId: EMPRESA, valorCentavos: 100, cwAccountId: 1, cwConversationId: 10, expiracaoSegundos: 60 });
    // Empurra a expiração para o passado, como o tempo faria.
    await db.ragnabotCobrancaPix.update({ where: { txid: c.txid }, data: { expiraEm: new Date(Date.now() - 1000) } });
    const [estado] = await pix.estadoNaConversa({ cwAccountId: 1, cwConversationId: 10 });
    expect(estado.status).toBe('expirado');
    expect(estado.expiradaPorTempo).toBe(true);
  });

  it('pagamento acorda a conversa que esperava: troca a saída para "pago" e enfileira o despertar', async () => {
    await db.ragnabotFluxoExecucao.create({
      data: { id: 'exec-9', visitaSeq: 4, aguardando: 'temporizador', saidaAoVencer: 'expirado' },
    });
    const c = await pix.criarCobrancaPix({
      tenantId: EMPRESA, valorCentavos: 100, cwAccountId: 1, cwConversationId: 10,
      execucaoId: 'exec-9', noId: 'no-pix', visitaSeq: 4, chaveEfeito: 'exec-9:no-pix:v4:',
    });
    await pix.tratarNotificacaoPix({
      corpo: { pix: [{ endToEndId: 'E777', txid: c.txid, valor: '1.00' }] }, ip: pix.IP_EFI,
    });

    const exec = await db.ragnabotFluxoExecucao.findUnique({ where: { id: 'exec-9' } });
    expect(exec.saidaAoVencer).toBe('pago');
    expect(enfileirados.length).toBe(1);
    expect(enfileirados[0].tipo).toBe('despertar');
    expect(enfileirados[0].tokenVisita).toBe(4);
    // O trabalho não carrega o txid inteiro.
    expect(enfileirados[0].payload.txid).toContain('…');
  });

  it('se a visita já avançou, o pagamento NÃO mexe na conversa (a cerca do WHERE)', async () => {
    await db.ragnabotFluxoExecucao.create({
      data: { id: 'exec-8', visitaSeq: 9, aguardando: 'temporizador', saidaAoVencer: 'expirado' },
    });
    const c = await pix.criarCobrancaPix({
      tenantId: EMPRESA, valorCentavos: 100, cwAccountId: 1, cwConversationId: 11,
      execucaoId: 'exec-8', noId: 'no-pix', visitaSeq: 4, chaveEfeito: 'exec-8:no-pix:v4:',
    });
    await pix.tratarNotificacaoPix({ corpo: { pix: [{ endToEndId: 'E888', txid: c.txid, valor: '1.00' }] }, ip: pix.IP_EFI });

    const exec = await db.ragnabotFluxoExecucao.findUnique({ where: { id: 'exec-8' } });
    expect(exec.saidaAoVencer).toBe('expirado');
    expect(enfileirados.length).toBe(0);
    // ...mas a baixa da cobrança aconteceu: o dinheiro entrou de qualquer forma.
    expect(db.__tabelas.ragnabotCobrancaPix[0].status).toBe('pago');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 8. REGISTRO DO WEBHOOK NA EFÍ
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('registro do webhook', () => {
  it('acrescenta ?ignorar= para a Efí não colar "/pix" no fim da URL', async () => {
    await credencialDaCasa();
    const r = await pix.registrarWebhookNaEfi({ tenantId: EMPRESA, url: 'https://pix.ragnatela.com.br/api/ragnabot-pagamento/pix/abc' });
    expect(r.url.endsWith('?ignorar=')).toBe(true);
    const put = chamadas.find((c) => c.url.includes('/v2/webhook/'));
    expect(put.corpo.webhookUrl.endsWith('?ignorar=')).toBe(true);
  });

  it('recusa endereço que não seja https', async () => {
    await credencialDaCasa();
    await expect(pix.registrarWebhookNaEfi({ url: 'http://inseguro.example' })).rejects.toThrow(/https/);
  });
});
