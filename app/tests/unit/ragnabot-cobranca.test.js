// Testes da cobrança recorrente do RAGNABOT — só a lógica PURA (sem banco, sem rede).
// O que está coberto aqui é exatamente o que erra em silêncio no fim do mês:
// CRC do Pix, virada de vencimento em mês curto, competência e a recusa honesta
// do adaptador da Efí quando falta credencial.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  montarPixCopiaECola, avancarVencimento, primeiroVencimentoApos, competenciaDe, formatarBRL,
  obterAdaptador, situacaoDosAdaptadores, STATUS_PAGAMENTO,
} from '../../src/services/ragnabot-cobranca.service.js';

// CRC-16/CCITT-FALSE — implementação de referência independente da do serviço.
function crcReferencia(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

describe('Pix copia e cola (BR Code EMV estático)', () => {
  it('fecha com CRC válido, conferido por implementação independente', () => {
    const payload = montarPixCopiaECola({
      chave: 'chave-teste@ragnatela.com.br', nome: 'Ragnatela IoT Solutions',
      cidade: 'Sao Luis', valorCentavos: 24990, identificador: 'RGNB0001',
    });
    expect(payload.startsWith('000201')).toBe(true); // campo 00 = versão do payload
    expect(payload.slice(6, 8)).toBe('26');          // campo 26 = conta Pix do recebedor
    expect(payload).toContain('BR.GOV.BCB.PIX');
    expect(payload).toContain('5303986');       // moeda BRL
    expect(payload).toContain('5406249.90');    // valor em reais, campo 54
    expect(payload).toContain('5802BR');        // país
    const semCrc = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crcReferencia(semCrc));
  });

  it('remove acento e caractere proibido do nome e da cidade', () => {
    const payload = montarPixCopiaECola({
      chave: 'x@y.com', nome: 'Ação & Cia Ltda.', cidade: 'São Luís', valorCentavos: 100, identificador: 'A-1',
    });
    expect(payload).toContain('ACAO  CIA LTDA.');
    expect(payload).toContain('SAO LUIS');
    expect(payload).not.toMatch(/[^\x20-\x7E]/); // só ASCII imprimível
  });

  it('recusa gerar sem chave Pix em vez de devolver algo inválido', () => {
    expect(() => montarPixCopiaECola({ chave: '', valorCentavos: 100 })).toThrow(/RAGNABOT_PIX_CHAVE/);
  });
});

describe('calendário de vencimento', () => {
  it('não estoura o mês curto: dia 31 + 1 mês cai no último dia de fevereiro', () => {
    const d = avancarVencimento(new Date(Date.UTC(2026, 0, 31)), 1, 31);
    expect(d.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('respeita o dia de vencimento escolhido', () => {
    const d = avancarVencimento(new Date(Date.UTC(2026, 5, 10)), 1, 5);
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-05');
  });

  it('ciclo anual anda 12 meses', () => {
    const d = avancarVencimento(new Date(Date.UTC(2026, 7, 28)), 12, 28);
    expect(d.toISOString().slice(0, 10)).toBe('2027-08-28');
  });

  it('competência é o AAAA-MM do vencimento', () => {
    expect(competenciaDe(new Date(Date.UTC(2026, 8, 10)))).toBe('2026-09');
  });

  // Regressão: o fim do teste grátis não pode gerar um vencimento no PASSADO — a
  // assinatura nasceria vencida e o cliente viraria inadimplente antes da 1ª cobrança.
  it('fim de teste depois do dia de vencimento cai no mês seguinte, nunca no passado', () => {
    const fimDoTeste = new Date(Date.UTC(2026, 8, 20)); // 20/09
    const v = primeiroVencimentoApos(fimDoTeste, 10);   // dia de vencimento 10
    expect(v.toISOString().slice(0, 10)).toBe('2026-10-10');
    expect(v.getTime()).toBeGreaterThan(fimDoTeste.getTime());
  });

  it('fim de teste antes do dia de vencimento fica no mesmo mês', () => {
    const fimDoTeste = new Date(Date.UTC(2026, 8, 3)); // 03/09
    expect(primeiroVencimentoApos(fimDoTeste, 10).toISOString().slice(0, 10)).toBe('2026-09-10');
  });
});

describe('dinheiro em centavos', () => {
  it('formata em real com vírgula', () => {
    expect(formatarBRL(24990)).toBe('R$ 249,90');
    expect(formatarBRL(0)).toBe('R$ 0,00');
    expect(formatarBRL(null)).toBe('—');
  });
});

describe('adaptadores', () => {
  beforeAll(() => { process.env.RAGNABOT_PIX_CHAVE = 'chave-teste@ragnatela.com.br'; });

  it('o manual funciona sem nenhuma credencial e devolve o Pix do ciclo', async () => {
    const adaptador = obterAdaptador('manual');
    expect(adaptador.estaConfigurado().ok).toBe(true);
    const r = await adaptador.criarCobranca(
      { id: 'assinatura-1', rotuloConta: 'Cliente Teste' },
      { id: 'pagamento-abcdef123456', valorCentavos: 19900 },
    );
    expect(r.meio).toBe('pix');
    expect(r.pixCopiaECola).toContain('BR.GOV.BCB.PIX');
    expect(r.idExterno).toBe('manual:pagamento-abcdef123456');
  });

  it('o da Efí recusa operar sem credencial e DIZ o que falta', async () => {
    const anterior = { id: process.env.EFI_CLIENT_ID, secret: process.env.EFI_CLIENT_SECRET };
    delete process.env.EFI_CLIENT_ID; delete process.env.EFI_CLIENT_SECRET;
    const adaptador = obterAdaptador('efibank');
    expect(adaptador.estaConfigurado().ok).toBe(false);
    await expect(adaptador.criarCobranca({ idExterno: 'x' }, { vencimentoEm: new Date() }))
      .rejects.toThrow(/EFI_CLIENT_ID/);
    if (anterior.id) process.env.EFI_CLIENT_ID = anterior.id;
    if (anterior.secret) process.env.EFI_CLIENT_SECRET = anterior.secret;
  });

  it('traduz os status da Efí para o vocabulário da casa', () => {
    const efi = obterAdaptador('efibank');
    expect(efi._traduzirStatus('paid')).toBe(STATUS_PAGAMENTO.PAGO);
    expect(efi._traduzirStatus('unpaid')).toBe(STATUS_PAGAMENTO.VENCIDO);
    expect(efi._traduzirStatus('expired')).toBe(STATUS_PAGAMENTO.VENCIDO);
    expect(efi._traduzirStatus('canceled')).toBe(STATUS_PAGAMENTO.CANCELADO);
    expect(efi._traduzirStatus('refunded')).toBe(STATUS_PAGAMENTO.ESTORNADO);
    expect(efi._traduzirStatus('waiting')).toBe(STATUS_PAGAMENTO.PENDENTE);
  });

  it('a situação diz o que ainda falta configurar, sem expor segredo', () => {
    const s = situacaoDosAdaptadores();
    expect(s).toHaveProperty('padrao');
    expect(s).toHaveProperty('aplicarNaConta');
    expect(s.efibank).toHaveProperty('faltando');
    expect(JSON.stringify(s)).not.toContain('chave-teste@ragnatela.com.br');
  });
});
