// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DOS DOIS NÓS NOVOS DO MOTOR — `agente_ia` (S5/2.C.6) e `pagamento_pix` (S-EFÍ/doc 36 §5.5).
//
// O QUE ESTE ARQUIVO PROVA:
//   1. os dois tipos entraram no catálogo e as saídas deles são as declaradas;
//   2. `agente_ia` EXIGE destino para `nao_sabe` e para `erro` — é o caso que o desenho promete
//      resolver devolvendo ao humano, e sem destino o cliente fica sem ninguém;
//   3. `agente_ia` aguarda (não responde dentro da transação) e mapeia o resultado numa saída SÓ;
//   4. `pagamento_pix` recusa cobrança sem valor, sem mensagem ou sem o marcador do copia-e-cola;
//   5. o valor por variável é convertido com regra explícita — e valor impossível vira `erro`,
//      nunca uma cobrança de zero (ou de "NaN") no WhatsApp de um cliente;
//   6. o modo `cobrar_e_aguardar` estaciona por TEMPORIZADOR (o que destrava é o pagamento, não o
//      cliente escrever de novo) e vence por `expirado`.
//
// Executores puros: sem banco, sem rede.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EXECUTORES, TIPOS, validarNo, prepararNo, saidasDe, noEstaciona, executorDe,
} from '../../src/services/ragnabot-fluxo-nos.service.js';

const errosDe = (ps) => ps.filter((p) => p.nivel === 'erro');
const codigos = (ps) => ps.map((p) => `${p.nivel}:${p.codigo}@${p.campo}`);

beforeEach(() => { delete process.env.CAPITAO_ATIVO; });

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CATÁLOGO
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('catálogo', () => {
  it('ganhou `agente_ia` e `pagamento_pix` sem perder nenhum dos anteriores', () => {
    expect(TIPOS).toContain('agente_ia');
    expect(TIPOS).toContain('pagamento_pix');
    for (const antigo of ['inicio', 'texto', 'pergunta', 'lista', 'botoes', 'http', 'chamado', 'email']) {
      expect(TIPOS).toContain(antigo);
    }
    // ⚠️ A LISTA INTEIRA, e não `TIPOS.length`.  Corrigido em 02/09/2026 (contrato S-DEPLOY-3).
    // Este teste estava VERMELHO desde que o catálogo passou de 19 para 21 nós (o bloco de
    // e-mail e o de link entraram e ninguém mexeu no número aqui) — e saiu vermelho na versão
    // 1.08.00, publicada assim.  Suíte com um vermelho crônico é pior que suíte sem teste:
    // ninguém mais distingue a falha nova da falha de sempre.
    // Comparar a LISTA em vez do TAMANHO também troca «expected 21 to be 19» — que não diz nada —
    // por um diff que mostra QUAL tipo entrou ou sumiu.
    expect([...TIPOS]).toEqual([
      'inicio', 'texto', 'midia', 'pergunta', 'lista', 'botoes', 'espera', 'condicao', 'http',
      'variavel', 'etiqueta', 'time', 'atendente', 'randomizador', 'notificar', 'subfluxo',
      'chamado', 'encerrar', 'email', 'agente_ia', 'pagamento_pix',
    ]);
  });

  it('nenhum dos dois estaciona esperando resposta (não geram sem_resposta/opcao_invalida)', () => {
    expect(noEstaciona({ tipo: 'agente_ia', config: {} })).toBe(false);
    expect(noEstaciona({ tipo: 'pagamento_pix', config: { modo: 'cobrar_e_aguardar' } })).toBe(false);
    expect(saidasDe({ tipo: 'pagamento_pix', config: { modo: 'cobrar_e_aguardar' } }))
      .toEqual(['pago', 'expirado', 'erro']);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// NÓ `agente_ia`
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('nó agente_ia', () => {
  const noOk = { id: 'ia1', tipo: 'agente_ia', config: { pergunta: '{{ultimaMensagem}}' } };
  const arestasCompletas = [{ saida: 'respondeu' }, { saida: 'nao_sabe' }, { saida: 'erro' }];

  it('as três saídas são as do contrato', () => {
    expect(saidasDe(noOk)).toEqual(['respondeu', 'nao_sabe', 'erro']);
  });

  it('saída `nao_sabe` órfã é ERRO de publicação — é o caso mais provável de todos', () => {
    const ps = validarNo(noOk, { arestasDoNo: [{ saida: 'respondeu' }, { saida: 'erro' }] });
    expect(codigos(errosDe(ps))).toContain('erro:SAIDA_DE_ERRO_ORFA@saidas.nao_sabe');
  });

  it('saída `erro` órfã também é erro', () => {
    const ps = validarNo(noOk, { arestasDoNo: [{ saida: 'respondeu' }, { saida: 'nao_sabe' }] });
    expect(codigos(errosDe(ps))).toContain('erro:SAIDA_DE_ERRO_ORFA@saidas.erro');
  });

  it('com as arestas ligadas, não sobra erro — mas AVISA que a IA está desligada', () => {
    const ps = validarNo(noOk, { arestasDoNo: arestasCompletas });
    expect(errosDe(ps).length).toBe(0);
    const aviso = ps.find((p) => p.nivel === 'aviso' && /DESLIGADO/.test(p.mensagem));
    expect(aviso).toBeTruthy();
  });

  it('com CAPITAO_ATIVO=1 o aviso de "desligado" some', () => {
    process.env.CAPITAO_ATIVO = '1';
    const ps = validarNo(noOk, { arestasDoNo: arestasCompletas });
    expect(ps.find((p) => /DESLIGADO/.test(p.mensagem))).toBeFalsy();
  });

  it('sem `pergunta` declarada, usa a última mensagem do cliente', () => {
    const [i] = prepararNo({ id: 'ia', tipo: 'agente_ia', config: {} }, { vars: { ultimaMensagem: 'quero cancelar' } });
    expect(i.tipo).toBe('agente_ia');
    expect(i.pergunta).toBe('quero cancelar');
  });

  it('NÃO responde dentro da transação: devolve `aguardar` e a volta é pela fila', async () => {
    const r = await EXECUTORES.agente_ia.executar({ no: noOk, vars: {}, execucao: { id: 'e1', visitaSeq: 2 } });
    expect(r.tipo).toBe('aguardar');
    expect(r.motivo).toBe('http');
    // Se o trabalho se perder, o desfecho é devolver ao humano — nunca ficar mudo.
    expect(r.saidaAoVencer).toBe('nao_sabe');
  });

  it('resultado `quem:capitao` sai por `respondeu`; qualquer outro, por `nao_sabe`', async () => {
    const ctx = { no: noOk, vars: {}, registrar() {}, incidente() {} };
    const ok = await EXECUTORES.agente_ia.continuar(ctx, { quem: 'capitao', texto: 'resposta da IA', confianca: 0.9 });
    expect(ok.saida).toBe('respondeu');

    for (const quem of ['humano', 'fluxo', 'ninguem', undefined]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await EXECUTORES.agente_ia.continuar(ctx, { quem, texto: 'texto que não deve ser usado', motivo: 'agente_nao_sabe' });
      expect(r.saida).toBe('nao_sabe');
    }
  });

  it('`quem:capitao` SEM texto também vai para `nao_sabe` — não se entrega mensagem vazia', async () => {
    const ctx = { no: noOk, vars: {}, registrar() {}, incidente() {} };
    const r = await EXECUTORES.agente_ia.continuar(ctx, { quem: 'capitao', texto: '' });
    expect(r.saida).toBe('nao_sabe');
  });

  it('erro na consulta sai por `erro` e registra incidente', async () => {
    const incidentes = [];
    const ctx = { no: noOk, vars: {}, registrar() {}, incidente: (c, d) => incidentes.push([c, d]) };
    const r = await EXECUTORES.agente_ia.continuar(ctx, { erro: 'agente fora do ar' });
    expect(r.saida).toBe('erro');
    expect(incidentes.length).toBe(1);
  });

  it('o registro do passo NÃO guarda o texto da resposta (LGPD) — só tamanho e confiança', async () => {
    const registros = [];
    const ctx = { no: noOk, vars: {}, registrar: (e) => registros.push(e), incidente() {} };
    await EXECUTORES.agente_ia.continuar(ctx, { quem: 'capitao', texto: 'o CPF do cliente é 000', confianca: 0.8 });
    expect(JSON.stringify(registros)).not.toContain('CPF');
    expect(registros[0].detalhe.caracteres).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// NÓ `pagamento_pix`
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('nó pagamento_pix', () => {
  const base = {
    id: 'pix1',
    tipo: 'pagamento_pix',
    config: {
      modo: 'cobrar_e_seguir',
      valorCentavos: 2490,
      mensagem: 'Segue o Pix de R$ 24,90:\n\n{{pix_copia_e_cola}}\n\nAssim que pagar eu confirmo.',
    },
  };
  const comArestas = { arestasDoNo: [{ saida: 'padrao' }, { saida: 'erro' }] };

  it('as saídas mudam com o modo', () => {
    expect(saidasDe(base)).toEqual(['padrao', 'erro']);
    expect(saidasDe({ ...base, config: { ...base.config, modo: 'cobrar_e_aguardar' } }))
      .toEqual(['pago', 'expirado', 'erro']);
  });

  it('configuração completa passa na validação', () => {
    expect(errosDe(validarNo(base, comArestas)).length).toBe(0);
  });

  it('sem valor nenhum é recusado — o cliente receberia um código que não cobra nada', () => {
    const ps = validarNo({ ...base, config: { ...base.config, valorCentavos: undefined } }, comArestas);
    expect(codigos(errosDe(ps))).toContain('erro:ARESTA_AUSENTE@config.valorCentavos');
  });

  it('valor fixo E por variável ao mesmo tempo é recusado', () => {
    const ps = validarNo({ ...base, config: { ...base.config, valorDeVariavel: 'total' } }, comArestas);
    expect(errosDe(ps).some((p) => /ao mesmo tempo/.test(p.mensagem))).toBe(true);
  });

  it('valor que não é inteiro de centavos é recusado', () => {
    for (const v of [0, -5, 24.9, 'abc']) {
      const ps = validarNo({ ...base, config: { ...base.config, valorCentavos: v } }, comArestas);
      expect(errosDe(ps).length).toBeGreaterThan(0);
    }
  });

  it('valor muito alto é AVISO (não erro): existe cobrança alta legítima, mas um zero a mais também', () => {
    const ps = validarNo({ ...base, config: { ...base.config, valorCentavos: 500_000_00 } }, comArestas);
    expect(errosDe(ps).length).toBe(0);
    expect(ps.some((p) => p.nivel === 'aviso' && /zero a mais/.test(p.mensagem))).toBe(true);
  });

  it('mensagem SEM o marcador do copia-e-cola é recusada — seria texto bonito sem código', () => {
    const ps = validarNo({ ...base, config: { ...base.config, mensagem: 'Pague por favor.' } }, comArestas);
    expect(errosDe(ps).some((p) => p.campo === 'config.mensagem')).toBe(true);
  });

  it('expiração fora de 60s..24h é recusada', () => {
    for (const seg of [10, 90_000]) {
      const ps = validarNo({ ...base, config: { ...base.config, expiracaoSegundos: seg } }, comArestas);
      expect(codigos(errosDe(ps))).toContain('erro:ARESTA_AUSENTE@config.expiracaoSegundos');
    }
    expect(errosDe(validarNo({ ...base, config: { ...base.config, expiracaoSegundos: 1800 } }, comArestas)).length).toBe(0);
  });

  it('saída `erro` órfã é recusada', () => {
    const ps = validarNo(base, { arestasDoNo: [{ saida: 'padrao' }] });
    expect(codigos(errosDe(ps))).toContain('erro:SAIDA_DE_ERRO_ORFA@saidas.erro');
  });

  it('a intenção leva o marcador INTACTO: quem troca é o adaptador, que conhece o código', () => {
    const [i] = prepararNo(base, { vars: {} });
    expect(i.tipo).toBe('cobranca_pix');
    expect(i.mensagemModelo).toContain('{{pix_copia_e_cola}}');
    expect(i.marcador).toBe('{{pix_copia_e_cola}}');
    expect(i.valorCentavos).toBe(2490);
  });

  it('valor por variável: "24,90", "24.90" e "50" são convertidos com regra declarada', () => {
    const comVar = (valor) => prepararNo(
      { ...base, config: { modo: 'cobrar_e_seguir', valorDeVariavel: 'total', mensagem: base.config.mensagem } },
      { vars: { total: valor } },
    )[0].valorCentavos;

    expect(comVar('24,90')).toBe(2490);
    expect(comVar('24.90')).toBe(2490);
    expect(comVar('R$ 1.234,56')).toBe(123456);
    expect(comVar('50')).toBe(5000); // sem separador = reais inteiros (escolha declarada)
    expect(comVar('')).toBeNull();
    expect(comVar('grátis')).toBeNull();
  });

  it('variável vazia NÃO vira cobrança de zero: o nó sai por `erro`', async () => {
    const no = { ...base, config: { modo: 'cobrar_e_seguir', valorDeVariavel: 'total', mensagem: base.config.mensagem } };
    const incidentes = [];
    const r = await EXECUTORES.pagamento_pix.executar({ no, vars: {}, registrar() {}, incidente: (c, d) => incidentes.push([c, d]) });
    expect(r.tipo).toBe('falhar');
    expect(r.saida).toBe('erro');
    // Um incidente, e ele diz o que fazer: qual variável conferir.
    expect(incidentes.length).toBe(1);
    expect(incidentes[0][1].mensagem).toMatch(/valor utilizável/);
    expect(incidentes[0][1].comoCorrigir).toMatch(/valorDeVariavel/);
  });

  it('modo `cobrar_e_seguir` segue por `padrao`', async () => {
    const r = await EXECUTORES.pagamento_pix.executar({ no: base, vars: {}, registrar() {}, incidente() {} });
    expect(r).toEqual({ tipo: 'seguir', saida: 'padrao' });
  });

  it('modo `cobrar_e_aguardar` estaciona por TEMPORIZADOR e vence por `expirado`', async () => {
    const agora = new Date('2026-09-02T12:00:00.000Z');
    const no = { ...base, config: { ...base.config, modo: 'cobrar_e_aguardar', expiracaoSegundos: 1800 } };
    const r = await EXECUTORES.pagamento_pix.executar({ no, vars: {}, agora, registrar() {}, incidente() {} });
    expect(r.tipo).toBe('aguardar');
    // `temporizador` e não `resposta`: o que destrava é o pagamento, não o cliente escrever "já paguei".
    expect(r.motivo).toBe('temporizador');
    expect(r.saidaAoVencer).toBe('expirado');
    expect(r.acordarEm.toISOString()).toBe('2026-09-02T12:30:00.000Z');
  });

  it('a política em dúvida é `conciliar` (dá para perguntar à Efí pelo txid), não `parar`', () => {
    expect(executorDe('pagamento_pix').politicaEmDuvida).toBe('conciliar');
    expect(executorDe('pagamento_pix').efeito).toBe('irrepetivel');
  });
});
