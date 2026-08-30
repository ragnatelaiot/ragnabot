// =============================================================================
// A parte da prova de isolamento que roda na SUÍTE (vitest).
//
// A prova de verdade — duas empresas reais na plataforma, sondas cruzadas — vive
// em `tests/ragnabot-isolamento.test.mjs` e é executada à mão, sob supervisão,
// porque cria e apaga contas. O que este arquivo protege é o JUÍZO daquele
// teste: se alguém "afrouxar" a régua (por exemplo, passar a considerar um 200
// como aprovado, ou parar de olhar o corpo da resposta), a prova continuaria
// dizendo "verde" com a plataforma vazando. Um teste que aprova vazamento é pior
// que teste nenhum.
//
// Também tranca a régua dos limites de plano, que é o que separa "multiconexão"
// de "um cliente derrubando a plataforma inteira".
// =============================================================================
import { describe, it, expect } from 'vitest';
import { classificarSonda, sondaAprovada, classificarListagemPropria } from '../ragnabot-isolamento.test.mjs';
import { limitesDoPlano, cabeMaisUmaCaixa, TETO_TECNICO_CAIXAS, PLANOS } from '../../src/config/ragnabot-plans.js';

const MARCADORES = ['SEGREDO-A-abc123', 'Contato-A-abc123'];

describe('veredito das sondas de isolamento', () => {
  it('negativa explícita é a ÚNICA resposta aprovada', () => {
    for (const status of [401, 403, 404]) {
      const r = classificarSonda(status, '{"error":"nao autorizado"}', MARCADORES);
      expect(r.veredito).toBe('bloqueado');
      expect(sondaAprovada(r)).toBe(true);
    }
  });

  it('200 com dado da outra empresa é VAZAMENTO e reprova', () => {
    const corpo = JSON.stringify({ payload: [{ content: 'texto SEGREDO-A-abc123 aqui' }] });
    const r = classificarSonda(200, corpo, MARCADORES);
    expect(r.veredito).toBe('vazamento');
    expect(r.achados).toContain('SEGREDO-A-abc123');
    expect(sondaAprovada(r)).toBe(false);
  });

  // A armadilha clássica: "respondeu 200 mas veio vazio, então está tudo bem".
  // Não está. Quem não é da conta não deveria receber 200 nenhum.
  it('200 vazio em conta alheia NÃO é aprovado', () => {
    const r = classificarSonda(200, '{"payload":[]}', MARCADORES);
    expect(r.veredito).toBe('suspeito');
    expect(sondaAprovada(r)).toBe(false);
  });

  it('erro de servidor não conta como bloqueio — a sonda tem que ser refeita', () => {
    for (const status of [500, 502, 503, 429]) {
      const r = classificarSonda(status, 'erro', MARCADORES);
      expect(sondaAprovada(r)).toBe(false);
    }
  });

  it('vazamento vence: mesmo com 403, dado alheio no corpo reprova', () => {
    const r = classificarSonda(403, 'proibido, conversa de Contato-A-abc123', MARCADORES);
    expect(r.veredito).toBe('vazamento');
  });

  it('sem marcadores para procurar, um 200 nunca é declarado limpo', () => {
    expect(sondaAprovada(classificarSonda(200, 'qualquer coisa', []))).toBe(false);
  });
});

describe('listagem própria do atendente', () => {
  it('listagem própria limpa passa', () => {
    const r = classificarListagemPropria(200, '{"payload":[{"content":"assunto meu"}]}', MARCADORES);
    expect(sondaAprovada(r)).toBe(true);
  });

  it('dado do vizinho na própria listagem é vazamento', () => {
    const r = classificarListagemPropria(200, '{"payload":[{"content":"SEGREDO-A-abc123"}]}', MARCADORES);
    expect(r.veredito).toBe('vazamento');
  });

  it('não conseguir ler a própria listagem não é aprovação', () => {
    expect(sondaAprovada(classificarListagemPropria(500, '', MARCADORES))).toBe(false);
  });
});

describe('limites de plano — a régua da multiconexão', () => {
  const essencial = limitesDoPlano('essencial');
  const avancado = limitesDoPlano('avancado');

  it('plano inexistente falha alto em vez de virar "sem limite"', () => {
    expect(() => limitesDoPlano('plano-que-nao-existe')).toThrow();
  });

  it('a mesma empresa pode ter caixas de canais diferentes', () => {
    const atuais = [{ channelType: 'web_widget' }];
    expect(cabeMaisUmaCaixa(essencial, 'whatsapp', atuais).permitido).toBe(true);
  });

  it('a mesma empresa pode ter VÁRIOS números de WhatsApp quando o plano permite', () => {
    const atuais = [{ channelType: 'whatsapp' }];
    expect(cabeMaisUmaCaixa(essencial, 'whatsapp', atuais).permitido).toBe(false); // Essencial: 1 número
    expect(cabeMaisUmaCaixa(avancado, 'whatsapp', atuais).permitido).toBe(true); // Avançado: vários
  });

  it('canal fora do plano é recusado com motivo em português', () => {
    const r = cabeMaisUmaCaixa(essencial, 'telegram', []);
    expect(r.permitido).toBe(false);
    expect(r.motivo).toMatch(/plano não inclui/i);
  });

  it('canal desconhecido não passa por engano', () => {
    expect(cabeMaisUmaCaixa(avancado, 'pombo_correio', []).permitido).toBe(false);
  });

  it('o teto de caixas do plano é respeitado', () => {
    const cheio = Array.from({ length: essencial.caixas }, () => ({ channelType: 'web_widget' }));
    expect(cabeMaisUmaCaixa(essencial, 'whatsapp', cheio).permitido).toBe(false);
  });

  // Negociação comercial não pode furar o teto técnico: um tenant com 500 caixas
  // de WhatsApp seria 500 webhooks vivos derrubando a plataforma dos outros.
  it('override negociado NUNCA ultrapassa o teto técnico', () => {
    const negociado = limitesDoPlano('custom', { caixas: 5000, agentes: 900 });
    expect(negociado.caixas).toBe(TETO_TECNICO_CAIXAS);
    expect(negociado.agentes).toBe(900); // agente é só licença; caixa é carga de infraestrutura
  });

  it('limitesDoPlano devolve cópia — ninguém muta a matriz global sem querer', () => {
    const a = limitesDoPlano('essencial');
    a.canais.push('telegram');
    a.caixasPorCanal.whatsapp = 99;
    expect(limitesDoPlano('essencial').canais).not.toContain('telegram');
    expect(limitesDoPlano('essencial').caixasPorCanal.whatsapp).toBe(1);
    expect(PLANOS.essencial.caixasPorCanal.whatsapp).toBe(1);
  });
});
