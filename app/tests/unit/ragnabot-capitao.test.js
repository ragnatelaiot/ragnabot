// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DO CAPITÃO — a fronteira fluxo × IA, o isolamento entre empresas e o teto de consumo.
//
// O QUE ESTE ARQUIVO PROVA, e por que cada prova existe:
//
//   1. EXCLUSÃO MÚTUA (2.C.2). A matriz INTEIRA de estados (768 combinações) é percorrida e em
//      NENHUMA delas há dois responsáveis. É a exigência literal do contrato: "o cliente NUNCA
//      pode receber duas respostas".
//   2. O FLUXO ATENDE PRIMEIRO. Sempre que o fluxo tem saída, a IA não fala — nem com tudo ligado.
//   3. INTERRUPTOR MESTRE. Com `CAPITAO_ATIVO` desligado, `capitao` nunca aparece na decisão.
//   4. DEVOLVE AO HUMANO quando não sabe — e nesse caso NÃO manda texto (senão seriam duas falas).
//   5. ISOLAMENTO (2.C.4). Empresa A não lê documento da empresa B, e uma resposta que venha com
//      documento de outra empresa é DESCARTADA em vez de entregue.
//   6. TETO (2.C.5). Estourado o teto do plano, a IA não responde e a recusa é CONTADA.
//   7. RESERVA. A mesma mensagem reservada duas vezes só produz UMA resposta (duas réplicas).
//   8. MARCA (2.C.7). O agente assina com o nome da EMPRESA CLIENTE.
//
// Sem banco e sem rede: dublê de Prisma em memória e porta de plataforma injetada. Teste que
// precisa de Postgres de pé é teste que ninguém roda duas vezes.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { criarFakeSimples } from '../fixtures/fake-prisma-simples.mjs';
import * as capitao from '../../src/services/ragnabot-capitao.service.js';

const MODELOS = [
  'ragnabotCapitaoConfig', 'ragnabotCapitaoDocumento', 'ragnabotCapitaoInteracao',
  'ragnabotCapitaoConsumoMes', 'ragnabotTenant',
];
const UNICOS = {
  ragnabotCapitaoConfig: [['tenantId']],
  ragnabotCapitaoDocumento: [['tenantId', 'chaveDocumento']],
  ragnabotCapitaoInteracao: [['chave']],
  ragnabotCapitaoConsumoMes: [['tenantId', 'competencia']],
  ragnabotTenant: [['id']],
};

const EMPRESA_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const EMPRESA_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

let db;
function montar({ plataforma = null } = {}) {
  db = criarFakeSimples(MODELOS, UNICOS);
  capitao.configurarCapitao({ db, plataforma, log: { info() {}, warn() {}, error() {} }, auditoria: null });
  return db;
}

async function prepararEmpresa(tenantId, { ativo = true, plano = 'profissional', docs = 1 } = {}) {
  await db.ragnabotTenant.create({ data: { id: tenantId, plan: plano, limits: null } });
  await capitao.definirConfig(tenantId, { ativo, nomeAgente: `Agente ${tenantId.slice(0, 1).toUpperCase()}` });
  for (let i = 0; i < docs; i += 1) {
    const d = await capitao.registrarDocumento(tenantId, { tipo: 'texto', origem: `manual-${i}`, titulo: `Doc ${i}`, conteudo: `conteudo da empresa ${tenantId}` });
    await db.ragnabotCapitaoDocumento.update({
      where: { id: d.id },
      data: { status: 'sincronizado', externoId: `ext-${tenantId.slice(0, 1)}-${i}`, sincronizadoEm: new Date() },
    });
  }
}

beforeEach(() => {
  delete process.env.CAPITAO_ATIVO;
  delete process.env.CAPITAO_CUSTO_RESPOSTA_CENTAVOS;
  delete process.env.CAPITAO_TETO_GLOBAL_RESPOSTAS_MES;
  montar();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. A FRONTEIRA — exclusão mútua sobre a matriz inteira
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('fronteira fluxo × IA (2.C.2)', () => {
  const VALORES = {
    interruptorMestre: [true, false],
    ativoNaEmpresa: [true, false],
    conversaComHumano: [true, false],
    pedidoDoNo: [true, false],
    execucaoViva: [true, false],
    fluxoTemSaida: [true, false],
    acaoDoResolvedor: ['iniciar_fluxo', 'so_mensagem', 'fila_humana', null],
    dentroDoTeto: [true, false],
    temBaseDeConhecimento: [true, false],
  };

  function* matriz(chaves = Object.keys(VALORES), acc = {}) {
    if (!chaves.length) { yield { ...acc }; return; }
    const [c, ...resto] = chaves;
    for (const v of VALORES[c]) yield* matriz(resto, { ...acc, [c]: v });
  }

  it('percorre a matriz INTEIRA e nunca produz dois responsáveis', () => {
    const validos = new Set(Object.values(capitao.QUEM_RESPONDE));
    let casos = 0;
    let comCapitao = 0;
    for (const estado of matriz()) {
      const d = capitao.decidirQuemResponde(estado);
      casos += 1;
      // "Um responsável" é literal: `quem` é uma string do enum, não uma lista.
      expect(typeof d.quem).toBe('string');
      expect(validos.has(d.quem)).toBe(true);
      expect(d.motivo).toBeTruthy();
      if (d.quem === capitao.QUEM_RESPONDE.CAPITAO) comCapitao += 1;
    }
    expect(casos).toBe(2 * 2 * 2 * 2 * 2 * 2 * 4 * 2 * 2);
    expect(comCapitao).toBeGreaterThan(0); // a IA existe: se nunca entrasse, o teste seria vazio
  });

  it('o FLUXO atende primeiro: com saída no fluxo, a IA nunca fala', () => {
    for (const estado of matriz()) {
      if (!estado.execucaoViva || !estado.fluxoTemSaida) continue;
      if (estado.pedidoDoNo || estado.conversaComHumano) continue; // esses dois têm regra própria
      const d = capitao.decidirQuemResponde(estado);
      expect(d.quem).toBe(capitao.QUEM_RESPONDE.FLUXO);
    }
  });

  it('interruptor mestre desligado: `capitao` nunca aparece', () => {
    for (const estado of matriz()) {
      if (estado.interruptorMestre) continue;
      expect(capitao.decidirQuemResponde(estado).quem).not.toBe(capitao.QUEM_RESPONDE.CAPITAO);
    }
  });

  it('conversa com atendente vence tudo — inclusive o nó que pediu a IA', () => {
    const d = capitao.decidirQuemResponde({
      interruptorMestre: true, ativoNaEmpresa: true, conversaComHumano: true, pedidoDoNo: true,
    });
    expect(d.quem).toBe(capitao.QUEM_RESPONDE.HUMANO);
    expect(d.motivo).toBe('conversa_com_atendente');
  });

  it('fluxo sem saída é exatamente a brecha que a IA cobre', () => {
    const d = capitao.decidirQuemResponde({
      interruptorMestre: true, ativoNaEmpresa: true, execucaoViva: true, fluxoTemSaida: false,
    });
    expect(d.quem).toBe(capitao.QUEM_RESPONDE.CAPITAO);
    expect(d.motivo).toBe('fluxo_sem_saida');
  });

  it('"só mensagem" (almoço/feriado) é da automação, não da IA — senão saem duas respostas', () => {
    const d = capitao.decidirQuemResponde({
      interruptorMestre: true, ativoNaEmpresa: true, acaoDoResolvedor: 'so_mensagem',
    });
    expect(d.quem).toBe(capitao.QUEM_RESPONDE.FLUXO);
  });

  it('cada impedimento devolve o motivo REAL, não um "fila humana" genérico', () => {
    const base = { interruptorMestre: true, ativoNaEmpresa: true, acaoDoResolvedor: 'fila_humana' };
    expect(capitao.decidirQuemResponde({ ...base, interruptorMestre: false }).motivo).toBe('capitao_desligado_no_ambiente');
    expect(capitao.decidirQuemResponde({ ...base, ativoNaEmpresa: false }).motivo).toBe('capitao_desligado_na_empresa');
    expect(capitao.decidirQuemResponde({ ...base, dentroDoTeto: false }).motivo).toBe('teto_do_mes_estourado');
    expect(capitao.decidirQuemResponde({ ...base, temBaseDeConhecimento: false }).motivo).toBe('sem_base_de_conhecimento');
    expect(capitao.decidirQuemResponde({ ...base, respostasSeguidas: 3, maxRespostasSeguidas: 3 }).motivo).toBe('muitas_respostas_seguidas');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. RESPOSTA DE VERDADE — com reserva, teto, marca e devolução ao humano
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('responderPorIA', () => {
  it('com o interruptor DESLIGADO devolve humano e não pergunta nada ao agente', async () => {
    const perguntar = vi.fn();
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A);

    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e1', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(r.motivo).toBe('capitao_desligado_no_ambiente');
    expect(r.texto).toBeNull();
    expect(perguntar).not.toHaveBeenCalled();
  });

  it('ligado e com base: responde, assina com a marca DA EMPRESA e conta o consumo', async () => {
    process.env.CAPITAO_ATIVO = '1';
    process.env.CAPITAO_CUSTO_RESPOSTA_CENTAVOS = '3';
    const perguntar = vi.fn(async () => ({ texto: 'O prazo é de 3 dias úteis.', confianca: 0.9, documentosUsados: [{ externoId: 'ext-a-0' }], tokensEntrada: 100, tokensSaida: 50 }));
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A);
    await capitao.definirConfig(EMPRESA_A, { assinatura: '— Equipe Alfa' });

    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e1', pergunta: 'qual o prazo?', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('capitao');
    expect(r.texto).toContain('3 dias úteis');
    expect(r.texto).toContain('— Equipe Alfa'); // 2.C.7: a marca é da empresa cliente
    expect(r.custoEstimadoCentavos).toBe(3);

    const consumo = await capitao.consumoDoMes(EMPRESA_A);
    expect(consumo.respostas).toBe(1);
    expect(consumo.custoEstimadoCentavos).toBe(3);
  });

  it('quando o agente NÃO SABE, devolve ao humano E NÃO manda texto (nada de duas falas)', async () => {
    process.env.CAPITAO_ATIVO = '1';
    montar({ plataforma: { perguntar: async () => ({ texto: 'acho que...', confianca: 0.2 }) } });
    await prepararEmpresa(EMPRESA_A);

    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e2', pergunta: 'x', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(r.motivo).toBe('agente_nao_sabe');
    expect(r.texto).toBeNull();
    expect((await capitao.consumoDoMes(EMPRESA_A)).naoSabe).toBe(1);
  });

  it('a MESMA mensagem em duas réplicas produz UMA resposta só', async () => {
    process.env.CAPITAO_ATIVO = '1';
    const perguntar = vi.fn(async () => ({ texto: 'resposta', confianca: 0.9 }));
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A);

    const [r1, r2] = await Promise.all([
      capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'mesma-entrada', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' }),
      capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'mesma-entrada', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' }),
    ]);
    const quemFalou = [r1, r2].filter((r) => r.quem === 'capitao');
    expect(quemFalou.length).toBe(1);
    expect(perguntar).toHaveBeenCalledTimes(1);
    expect([r1, r2].some((r) => r.motivo === 'ja_respondida_por_outra_replica')).toBe(true);
  });

  it('sem porta de plataforma NÃO inventa resposta: devolve ao humano com o motivo', async () => {
    process.env.CAPITAO_ATIVO = '1';
    montar({ plataforma: null });
    await prepararEmpresa(EMPRESA_A);
    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e3', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(r.motivo).toBe('plataforma_indisponivel');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. ISOLAMENTO ENTRE EMPRESAS (2.C.4) — a prova obrigatória do contrato
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('isolamento multi-inquilino', () => {
  it('a empresa A não enxerga documento da empresa B', async () => {
    await prepararEmpresa(EMPRESA_A, { docs: 2 });
    await prepararEmpresa(EMPRESA_B, { docs: 3 });

    const a = await capitao.documentosDaEmpresa(EMPRESA_A);
    const b = await capitao.documentosDaEmpresa(EMPRESA_B);
    expect(a.length).toBe(2);
    expect(b.length).toBe(3);
    expect(a.every((d) => d.tenantId === EMPRESA_A)).toBe(true);
    expect(b.every((d) => d.tenantId === EMPRESA_B)).toBe(true);
  });

  it('remover documento de outra empresa NÃO funciona', async () => {
    await prepararEmpresa(EMPRESA_A);
    await prepararEmpresa(EMPRESA_B);
    const [docB] = await capitao.documentosDaEmpresa(EMPRESA_B);

    const r = await capitao.removerDocumento(EMPRESA_A, docB.id);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('nao_encontrado_nesta_empresa');
    const aindaLa = await db.ragnabotCapitaoDocumento.findUnique({ where: { id: docB.id } });
    expect(aindaLa.status).toBe('sincronizado');
  });

  it('resposta que veio com documento de OUTRA empresa é DESCARTADA, não entregue', async () => {
    process.env.CAPITAO_ATIVO = '1';
    montar({
      plataforma: {
        perguntar: async () => ({
          texto: 'segredo comercial da empresa B',
          confianca: 0.99,
          // o intruso: id que não pertence à empresa que perguntou
          documentosUsados: [{ externoId: 'ext-b-0' }],
        }),
      },
    });
    await prepararEmpresa(EMPRESA_A);
    await prepararEmpresa(EMPRESA_B);

    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e9', pergunta: 'x', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(r.motivo).toBe('isolamento_violado');
    expect(r.texto).toBeNull();
  });

  it('função de documento sem tenantId é recusada — não existe consulta "de todas"', async () => {
    await expect(capitao.documentosDaEmpresa(null)).rejects.toThrow(/tenantId/);
    await expect(capitao.registrarDocumento('', { tipo: 'texto', origem: 'x' })).rejects.toThrow(/tenantId/);
  });

  it('nada do texto do cliente é gravado: só o sha256 da pergunta', async () => {
    process.env.CAPITAO_ATIVO = '1';
    montar({ plataforma: { perguntar: async () => ({ texto: 'ok', confianca: 0.9 }) } });
    await prepararEmpresa(EMPRESA_A);
    const segredo = 'meu CPF é 000.000.000-00 e moro na rua tal';
    await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e10', pergunta: segredo, acaoDoResolvedor: 'fila_humana' });

    const linhas = db.__tabelas.ragnabotCapitaoInteracao;
    expect(linhas.length).toBe(1);
    expect(JSON.stringify(linhas[0])).not.toContain('000.000.000');
    expect(linhas[0].perguntaHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. TETO E CUSTO (2.C.5)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('teto de consumo e medição de custo', () => {
  it('o plano essencial NÃO inclui agente de IA: teto 0 e a IA não responde', async () => {
    process.env.CAPITAO_ATIVO = '1';
    const perguntar = vi.fn();
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A, { plano: 'essencial' });

    const teto = await capitao.tetoDaEmpresa(EMPRESA_A);
    expect(teto.respostasMes).toBe(0);
    const r = await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'e4', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(r.motivo).toBe('teto_do_mes_estourado');
    expect(perguntar).not.toHaveBeenCalled();
    // A recusa é CONTADA — senão ninguém descobre que o teto segurou metade das conversas.
    expect((await capitao.consumoDoMes(EMPRESA_A)).recusadas).toBe(1);
  });

  it('o acordo individual pode APERTAR o teto do plano, nunca afrouxar', async () => {
    await prepararEmpresa(EMPRESA_A, { plano: 'profissional' }); // 300 no plano
    await capitao.definirConfig(EMPRESA_A, { tetoRespostasMes: 10 });
    expect((await capitao.tetoDaEmpresa(EMPRESA_A)).respostasMes).toBe(10);

    await capitao.definirConfig(EMPRESA_A, { tetoRespostasMes: 99999 });
    expect((await capitao.tetoDaEmpresa(EMPRESA_A)).respostasMes).toBe(300);
  });

  it('estourado o teto no meio do mês, a próxima pergunta não vai ao agente', async () => {
    process.env.CAPITAO_ATIVO = '1';
    const perguntar = vi.fn(async () => ({ texto: 'resposta', confianca: 0.9 }));
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A);
    await capitao.definirConfig(EMPRESA_A, { tetoRespostasMes: 2 });

    for (const id of ['a', 'b', 'c']) {
      // eslint-disable-next-line no-await-in-loop
      await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: id, pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    }
    expect(perguntar).toHaveBeenCalledTimes(2);
    expect((await capitao.consumoDoMes(EMPRESA_A)).respostas).toBe(2);
  });

  it('o teto GLOBAL da instalação segura mesmo com a empresa dentro do teto dela', async () => {
    process.env.CAPITAO_ATIVO = '1';
    process.env.CAPITAO_TETO_GLOBAL_RESPOSTAS_MES = '1';
    const perguntar = vi.fn(async () => ({ texto: 'resposta', confianca: 0.9 }));
    montar({ plataforma: { perguntar } });
    await prepararEmpresa(EMPRESA_A);
    await prepararEmpresa(EMPRESA_B);

    await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'g1', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    const r = await capitao.responderPorIA({ tenantId: EMPRESA_B, entradaId: 'g2', pergunta: 'oi', acaoDoResolvedor: 'fila_humana' });
    expect(r.quem).toBe('humano');
    expect(perguntar).toHaveBeenCalledTimes(1);
  });

  it('custo por atendimento é calculado por CONVERSA, e vem marcado como estimativa', async () => {
    process.env.CAPITAO_ATIVO = '1';
    process.env.CAPITAO_CUSTO_RESPOSTA_CENTAVOS = '5';
    montar({ plataforma: { perguntar: async () => ({ texto: 'ok', confianca: 0.9 }) } });
    await prepararEmpresa(EMPRESA_A);

    await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'c1', cwAccountId: 1, cwConversationId: 10, pergunta: 'a', acaoDoResolvedor: 'fila_humana' });
    await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'c2', cwAccountId: 1, cwConversationId: 10, pergunta: 'b', acaoDoResolvedor: 'fila_humana' });
    await capitao.responderPorIA({ tenantId: EMPRESA_A, entradaId: 'c3', cwAccountId: 1, cwConversationId: 11, pergunta: 'c', acaoDoResolvedor: 'fila_humana' });

    const custo = await capitao.custoPorAtendimento(EMPRESA_A);
    expect(custo.atendimentos).toBe(2);
    expect(custo.respostas).toBe(3);
    expect(custo.custoEstimadoCentavos).toBe(15);
    expect(custo.custoEstimadoPorAtendimentoCentavos).toBe(8); // 15/2 arredondado
    expect(custo.aviso).toMatch(/ESTIMADO/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. CONFIGURAÇÃO E MARCA
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('configuração e marca', () => {
  it('nasce desligado, mesmo com a linha criada', async () => {
    const c = await capitao.configDaEmpresa(EMPRESA_A);
    expect(c.ativo).toBe(false);
    expect(c._virtual).toBe(true);
  });

  it('estadoDaEmpresa não mente: só diz "respondendo" com os DOIS interruptores ligados', async () => {
    await prepararEmpresa(EMPRESA_A);
    let e = await capitao.estadoDaEmpresa(EMPRESA_A);
    expect(e.ativoNaEmpresa).toBe(true);
    expect(e.interruptorMestre).toBe(false);
    expect(e.respondendo).toBe(false);
    expect(e.verificadoNaPlataforma).toBe(false);

    process.env.CAPITAO_ATIVO = '1';
    e = await capitao.estadoDaEmpresa(EMPRESA_A);
    expect(e.respondendo).toBe(true);
  });

  it('tom fora da lista é recusado', async () => {
    await expect(capitao.definirConfig(EMPRESA_A, { tom: 'sarcastico' })).rejects.toThrow(/Tom inválido/);
  });

  it('documento por url só entra em https', async () => {
    await expect(capitao.registrarDocumento(EMPRESA_A, { tipo: 'url', origem: 'http://exemplo.com' }))
      .rejects.toThrow(/https/);
  });

  it('sincronizar sem porta de plataforma NÃO marca nada como sincronizado', async () => {
    await db.ragnabotTenant.create({ data: { id: EMPRESA_A, plan: 'profissional', limits: null } });
    await capitao.registrarDocumento(EMPRESA_A, { tipo: 'texto', origem: 'a', conteudo: 'x' });
    const r = await capitao.sincronizarDocumentos(EMPRESA_A);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('plataforma_indisponivel');
    expect(r.enviados).toBe(0);
    const [doc] = await capitao.documentosDaEmpresa(EMPRESA_A);
    expect(doc.status).toBe('pendente');
  });
});
