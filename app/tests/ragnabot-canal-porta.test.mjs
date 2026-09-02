#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A PORTA DO CANAL — o que eu consegui MEDIR com dublê.
//
// Contrato S-ADAPTADOR (02/09/2026). O que está sob julgamento aqui é o adaptador que leva ao
// cliente o que o motor decidiu dizer: texto, mídia, botões/lista, a degradação por canal, o canal
// fora do ar e a não-duplicação de envio.
//
// ⚠️ O QUE ESTE ARQUIVO **NÃO** PROVA, e é honesto dizer antes:
//   · que o Chatwoot 4.17.1 entrega mensagem interativa de WhatsApp ao cliente final. Isso é
//     medição de produção, e em 02/09/2026 o Ragnabot tem ZERO caixas de WhatsApp. O dublê prova
//     que ESTE arquivo chama o caminho certo com o conteúdo certo — não o que a Meta faz depois.
//   · o multipart do anexo contra a API real. O dublê recebe a chamada; o formato do corpo é
//     contrato lido, não medido.
//
// COMO RODAR:   node tests/ragnabot-canal-porta.test.mjs
// CÓDIGOS:      0 = verde · 1 = alguma verificação reprovou
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

const canal = await import('../src/services/ragnabot-canal.porta.js');

// ── O DUBLÊ DA PLATAFORMA ─────────────────────────────────────────────────────────────────────
// Ele NÃO tem cliente HTTP, não tem token e não conhece o Chatwoot: só anota o que lhe pediram.
// É o que permite afirmar "degradou para texto numerado" por leitura, e não por esperança.
function dubleDoChatwoot(configuracao = {}) {
  const registro = { chamadas: [], mensagens: [], interativos: [], anexos: [], notas: [], etiquetas: [], carimbos: [] };
  const anotar = (metodo, dados) => registro.chamadas.push({ metodo, dados });
  const falhaDe = (metodo) => configuracao.falhar?.[metodo] ?? null;
  const talvezFalhar = (metodo) => { const f = falhaDe(metodo); if (f) throw f; };

  return {
    registro,
    async caixaDaConversa() {
      if (configuracao.canalIndisponivel) throw Object.assign(new Error('Falha de rede ao falar com a plataforma'), { status: null });
      return {
        tenantId: 't1', cwInboxId: 7, channelType: configuracao.channelType ?? 'whatsapp',
        nome: 'Conexão de teste', phoneNumberId: '55999',
      };
    },
    async lerConversa() { return { id: 1, cwInboxId: 7, cwTeamId: 3, cwAssigneeId: null, status: 'open' }; },
    async enviarMensagem(d) { talvezFalhar('enviarMensagem'); anotar('enviarMensagem', d); registro.mensagens.push(d); return { ok: true, id: 100 + registro.mensagens.length }; },
    async enviarInterativo(d) { talvezFalhar('enviarInterativo'); anotar('enviarInterativo', d); registro.interativos.push(d); return { ok: true, id: 200 + registro.interativos.length }; },
    async enviarAnexo(d) { talvezFalhar('enviarAnexo'); anotar('enviarAnexo', d); registro.anexos.push(d); return { ok: true, id: 300, bytes: 1234, mime: 'image/png' }; },
    async notaInterna(d) { anotar('notaInterna', d); registro.notas.push(d); return true; },
    async aplicarEtiquetas(d) { anotar('aplicarEtiquetas', d); registro.etiquetas.push(d); return { ok: true, etiquetas: [...(d.aplicar || [])] }; },
    async transferirTime(d) { anotar('transferirTime', d); return true; },
    async timePorNome({ nome }) { return nome === 'Suporte' ? { id: 42, nome } : null; },
    async resolver(d) { anotar('resolver', d); return true; },
    async carimbar(d) { anotar('carimbar', d); registro.carimbos.push(d); return { ok: true, carimbados: Object.keys(d.atributos || {}).length }; },
    async enderecosDoDestinatario() { return configuracao.enderecos ?? ['plantao@empresa.com.br']; },
  };
}

/** Banco de mentira: só a tabela de efeito, que é o que a idempotência consulta. */
function dubleDoBanco(linhaPorChave = {}) {
  return {
    ragnabotFluxoEfeito: {
      async findUnique({ where }) { return linhaPorChave[where.chave] ?? null; },
    },
  };
}

const semLog = { info() {}, warn() {}, error() {}, debug() {} };
const ALVO = { id: 'exec-1', tenantId: 't1', cwAccountId: 5, cwConversationId: 900 };

async function montar(configuracao = {}, { banco = dubleDoBanco(), ...portas } = {}) {
  canal.esquecerEnvios();
  canal.esquecerCanais();
  const cw = dubleDoChatwoot(configuracao);
  canal.configurarCanal({ chatwoot: cw, db: banco, log: semLog, capitao: null, pagamento: null, email: null, egresso: null, ...portas });
  const porta = await canal.portaCanalDa(ALVO);
  return { cw, porta };
}

console.log('\nPORTA DO CANAL — o que eu consegui medir\n');
console.log('1) O BÁSICO: texto e mídia');

await medir('texto sai como mensagem, com a nossa marca `rgt_efeito` para conciliar depois', async () => {
  const { cw, porta } = await montar();
  const r = await porta.enviar({ tipo: 'texto', corpo: 'Bom dia!', chaveEfeito: 'ch-texto' }, {});
  assert.equal(cw.registro.mensagens.length, 1);
  assert.equal(cw.registro.mensagens[0].texto, 'Bom dia!');
  assert.equal(cw.registro.mensagens[0].atributosConteudo.rgt_efeito, 'ch-texto',
    'sem a marca no destino, conciliar vira arqueologia');
  assert.equal(r.idExterno, 101);
});

await medir('mídia vai como ANEXO quando o canal carrega arquivo', async () => {
  const { cw, porta } = await montar({ channelType: 'whatsapp' });
  await porta.enviar({ tipo: 'midia', url: 'https://cdn.exemplo/a.png', legenda: 'a planta', chaveEfeito: 'ch-midia' }, {});
  assert.equal(cw.registro.anexos.length, 1);
  assert.equal(cw.registro.anexos[0].url, 'https://cdn.exemplo/a.png');
  assert.equal(cw.registro.anexos[0].legenda, 'a planta');
  assert.equal(cw.registro.mensagens.length, 0, 'não pode mandar a legenda em mensagem separada');
});

await medir('canal que não carrega arquivo recebe o LINK, e o retorno diz que degradou', async () => {
  const { cw, porta } = await montar({ channelType: 'canal_que_nao_existe' });
  const r = await porta.enviar({ tipo: 'midia', url: 'https://cdn.exemplo/a.png', legenda: 'a planta', chaveEfeito: 'ch-m2' }, {});
  assert.equal(cw.registro.anexos.length, 0);
  assert.equal(cw.registro.mensagens.length, 1);
  assert.match(cw.registro.mensagens[0].texto, /https:\/\/cdn\.exemplo\/a\.png/);
  assert.match(cw.registro.mensagens[0].texto, /a planta/);
  assert.equal(r.degradado, 'link_no_texto', 'degradar em silêncio é o defeito que este campo fecha');
});

console.log('\n2) BOTÕES E LISTA — o interativo e a degradação');

await medir('WhatsApp com 3 botões vai INTERATIVO, com o id do item como valor de volta', async () => {
  const { cw, porta } = await montar({ channelType: 'whatsapp' });
  await porta.enviar({
    tipo: 'botoes', modo: 'resposta', corpo: 'Escolha:', cabecalho: 'Atendimento',
    botoes: [{ id: 'a', rotulo: 'Suporte', tipo: 'resposta' }, { id: 'b', rotulo: 'Financeiro', tipo: 'resposta' }],
    chaveEfeito: 'ch-bt',
  }, {});
  assert.equal(cw.registro.interativos.length, 1, 'era para ter ido interativo');
  const i = cw.registro.interativos[0];
  assert.match(i.corpo, /Atendimento/);
  assert.match(i.corpo, /Escolha:/);
  assert.equal(i.itens.length, 2);
  assert.equal(i.itens[0].id, 'a', 'o que volta tem de ser o ID do item, não o rótulo');
});

await medir('lista de 6 itens cabe no WhatsApp (teto 10) e vai interativa', async () => {
  const { cw, porta } = await montar({ channelType: 'whatsapp' });
  const itens = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, titulo: `Opção ${i + 1}` }));
  await porta.enviar({ tipo: 'lista', corpo: 'Menu', itens, rotuloBotao: 'Escolher', chaveEfeito: 'ch-l1' }, {});
  assert.equal(cw.registro.interativos.length, 1);
  assert.equal(cw.registro.interativos[0].itens.length, 6);
});

await medir('Instagram (sem interativo) recebe o MESMO menu em texto NUMERADO', async () => {
  const { cw, porta } = await montar({ channelType: 'instagram' });
  const r = await porta.enviar({
    tipo: 'lista', corpo: 'Escolha o setor:', rodape: 'Ragnatela',
    itens: [{ id: 'sup', titulo: 'Suporte' }, { id: 'fin', titulo: 'Financeiro', descricao: 'boletos' }],
    rotuloBotao: 'Escolher', chaveEfeito: 'ch-l2',
  }, {});
  assert.equal(cw.registro.interativos.length, 0, 'input_select em canal que não traduz entrega pergunta sem opções');
  assert.equal(cw.registro.mensagens.length, 1);
  const t = cw.registro.mensagens[0].texto;
  assert.match(t, /1\. Suporte/);
  assert.match(t, /2\. Financeiro — boletos/);
  assert.match(t, /responda com o número/i, 'sem a instrução, o cliente não sabe o que fazer');
  assert.match(t, /Ragnatela/);
  assert.equal(r.degradado, 'texto_numerado');
  assert.equal(r.motivoDegradacao, 'canal_sem_interativo');
});

await medir('botão de URL NUNCA vira input_select — nem no WhatsApp', async () => {
  const { cw, porta } = await montar({ channelType: 'whatsapp' });
  const r = await porta.enviar({
    tipo: 'botoes', modo: 'url', corpo: 'Acompanhe aqui:',
    botoes: [{ id: 'b1', rotulo: 'Abrir portal', tipo: 'url', url: 'https://portal.exemplo/x' }],
    chaveEfeito: 'ch-url',
  }, {});
  assert.equal(cw.registro.interativos.length, 0, 'botão de URL em input_select é botão que não faz nada');
  assert.match(cw.registro.mensagens[0].texto, /Abrir portal: https:\/\/portal\.exemplo\/x/);
  assert.equal(r.motivoDegradacao, 'botao_de_url');
});

await medir('itens acima do teto do canal degradam em vez de a plataforma recusar a mensagem inteira', async () => {
  const { cw, porta } = await montar({ channelType: 'whatsapp' });
  const botoes = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, rotulo: `B${i}`, tipo: 'resposta' }));
  const r = await porta.enviar({ tipo: 'botoes', modo: 'resposta', corpo: 'x', botoes, chaveEfeito: 'ch-teto' }, {});
  assert.equal(cw.registro.interativos.length, 0);
  assert.equal(r.motivoDegradacao, 'itens_acima_do_teto');
  assert.match(cw.registro.mensagens[0].texto, /5\. B4/);
});

console.log('\n3) NÃO-DUPLICAÇÃO (a mesma disciplina do Pix)');

await medir('a MESMA chave de efeito não vira duas mensagens ao cliente', async () => {
  const { cw, porta } = await montar();
  const a = await porta.enviar({ tipo: 'texto', corpo: 'Olá', chaveEfeito: 'ch-unica' }, {});
  const b = await porta.enviar({ tipo: 'texto', corpo: 'Olá', chaveEfeito: 'ch-unica' }, {});
  assert.equal(cw.registro.mensagens.length, 1, `saíram ${cw.registro.mensagens.length} mensagens para a mesma intenção`);
  assert.equal(b.reaproveitado, true);
  assert.equal(b.idExterno, a.idExterno, 'o segundo retorno tem de trazer o id do PRIMEIRO envio');
});

await medir('efeito já CONFIRMADO no banco não é reenviado depois de um reinício', async () => {
  // Simula o pod novo: a memória do processo está vazia, mas a linha do efeito diz que saiu.
  const banco = dubleDoBanco({ 'ch-velha': { chave: 'ch-velha', status: 'confirmado', idExterno: '55', httpStatus: 200 } });
  const { cw, porta } = await montar({}, { banco });
  const r = await porta.enviar({ tipo: 'texto', corpo: 'Olá de novo', chaveEfeito: 'ch-velha' }, {});
  assert.equal(cw.registro.mensagens.length, 0, 'reenviou uma mensagem que já tinha saído');
  assert.equal(r.idExterno, '55');
  assert.equal(r.reaproveitado, true);
});

await medir('efeito ainda RESERVADO (não confirmado) PODE ser enviado — senão nada sairia', async () => {
  const banco = dubleDoBanco({ 'ch-res': { chave: 'ch-res', status: 'reservado', idExterno: null } });
  const { cw, porta } = await montar({}, { banco });
  await porta.enviar({ tipo: 'texto', corpo: 'primeira vez', chaveEfeito: 'ch-res' }, {});
  assert.equal(cw.registro.mensagens.length, 1);
});

await medir('intenção SEM chave não é memorizada (não há identidade para comparar)', async () => {
  const { cw, porta } = await montar();
  await porta.enviar({ tipo: 'texto', corpo: 'a' }, {});
  await porta.enviar({ tipo: 'texto', corpo: 'a' }, {});
  assert.equal(cw.registro.mensagens.length, 2);
});

console.log('\n4) CANAL FORA DO AR E ERRO CLASSIFICÁVEL');

await medir('canal desconhecido não impede TEXTO — degrada a capacidade, não o atendimento', async () => {
  const { cw, porta } = await montar({ canalIndisponivel: true });
  assert.equal(porta.canal.channelType, 'desconhecido');
  await porta.enviar({ tipo: 'texto', corpo: 'ainda falo com você', chaveEfeito: 'ch-x' }, {});
  assert.equal(cw.registro.mensagens.length, 1);
});

await medir('queda de rede vira DÚVIDA (code de rede), nunca falha silenciosa', async () => {
  const erro = Object.assign(new Error('Falha de rede ao falar com a plataforma (POST /messages)'), { status: null });
  const { porta } = await montar({ falhar: { enviarMensagem: erro } });
  await assert.rejects(
    () => porta.enviar({ tipo: 'texto', corpo: 'x', chaveEfeito: 'ch-rede' }, {}),
    (e) => {
      assert.equal(e.code, 'ECONNRESET', 'sem code de rede o motor classifica como falha e rerroteia por erro');
      assert.match(e.message, /envio de "texto" na conversa 900/, 'o erro tem de dizer onde aconteceu');
      return true;
    },
  );
});

await medir('recusa por janela de 24 h é MARCADA (`foraDaJanela`) — é a saída `sem_janela` do motor', async () => {
  const erro = Object.assign(new Error('A plataforma respondeu 400: {"error":"(#131047) Re-engagement message"}'), { status: 400 });
  const { porta } = await montar({ falhar: { enviarMensagem: erro } });
  await assert.rejects(
    () => porta.enviar({ tipo: 'texto', corpo: 'x', chaveEfeito: 'ch-janela' }, {}),
    (e) => e.foraDaJanela === true,
  );
});

await medir('porta do Chatwoot ausente = canal indisponível, com code de dúvida', async () => {
  canal.esquecerEnvios(); canal.esquecerCanais();
  canal.configurarCanal({ chatwoot: { async caixaDaConversa() { return null; } }, db: dubleDoBanco(), log: semLog });
  const porta = await canal.portaCanalDa(ALVO);
  await assert.rejects(
    () => porta.enviar({ tipo: 'texto', corpo: 'x', chaveEfeito: 'ch-sem-porta' }, {}),
    (e) => e.code === 'ECONNREFUSED' && /canal está indisponível/.test(e.message),
  );
});

await medir('intenção de tipo desconhecido é recusada COM NOME, não engolida', async () => {
  const { porta } = await montar();
  await assert.rejects(
    () => porta.enviar({ tipo: 'telepatia', chaveEfeito: 'ch-?' }, {}),
    (e) => e.status === 501 && /não sabe despachar a intenção "telepatia"/.test(e.message),
  );
});

console.log('\n5) AS OUTRAS INTENÇÕES DO CONTRATO');

await medir('etiqueta, atribuir (por NOME de setor), resolver e carimbo chegam no lugar certo', async () => {
  const { cw, porta } = await montar();
  await porta.enviar({ tipo: 'etiqueta', aplicar: ['vip'], remover: ['novo'], chaveEfeito: 'c1' }, {});
  await porta.enviar({ tipo: 'atribuir', time: 'Suporte', timeId: null, chaveEfeito: 'c2' }, {});
  await porta.enviar({ tipo: 'resolver', chaveEfeito: 'c3' }, {});
  await porta.enviar({ tipo: 'carimbar', atributos: { rgt_protocolo: 'RGT-1' }, chaveEfeito: 'c4' }, {});
  const metodos = cw.registro.chamadas.map((c) => c.metodo);
  assert.ok(metodos.includes('aplicarEtiquetas'));
  assert.ok(metodos.includes('transferirTime'));
  assert.ok(metodos.includes('resolver'));
  assert.ok(metodos.includes('carimbar'));
  const transferencia = cw.registro.chamadas.find((c) => c.metodo === 'transferirTime');
  assert.equal(transferencia.dados.cwTeamId, 42, 'o nome do setor tinha de virar id');
});

await medir('setor que não existe é recusado — a conversa não pode ficar sem dono em silêncio', async () => {
  const { porta } = await montar();
  await assert.rejects(
    () => porta.enviar({ tipo: 'atribuir', time: 'Setor Fantasma', chaveEfeito: 'c5' }, {}),
    (e) => e.status === 422 && /não achei o setor/.test(e.message),
  );
});

await medir('notificação `interno` vira NOTA PRIVADA, nunca mensagem ao cliente', async () => {
  const { cw, porta } = await montar();
  await porta.enviar({ tipo: 'nota', canal: 'interno', privada: true, assunto: 'Plantão', corpo: 'olhar a fila', chaveEfeito: 'c6' }, {});
  assert.equal(cw.registro.notas.length, 1);
  assert.equal(cw.registro.mensagens.length, 0, 'aviso interno que vaza para o cliente é o pior tipo de defeito');
});

await medir('notificação por e-mail sem destinatário resolvido é recusada, não fingida', async () => {
  const { porta } = await montar({ enderecos: [] });
  await assert.rejects(
    () => porta.enviar({ tipo: 'nota', canal: 'email', destinatario: { tipo: 'papel', valor: 'admin' }, assunto: 'a', corpo: 'b', chaveEfeito: 'c7' }, {}),
    (e) => e.status === 422 && /ninguém seria avisado/.test(e.message),
  );
});

await medir('nó `http` sem egresso configurado recusa em vez de abrir fetch sem guarda de destino', async () => {
  const { porta } = await montar();
  await assert.rejects(
    () => porta.enviar({ tipo: 'http', metodo: 'POST', url: 'https://erp.cliente/x', chaveEfeito: 'c8' }, {}),
    (e) => e.status === 501 && /egresso da casa não está configurado/.test(e.message),
  );
});

console.log('\n6) CAPITÃO E COBRANÇA PIX — o contrato escrito nos próprios nós');

await medir('agente de IA: quando responde, o ADAPTADOR manda o texto e devolve o resultado pela fila', async () => {
  const capitaoDuble = {
    chamadas: [],
    async responderPorIA(p) {
      capitaoDuble.chamadas.push(p);
      return { quem: 'capitao', texto: 'O horário é das 8h às 18h.', motivo: 'respondeu', confianca: 0.9 };
    },
  };
  const { cw, porta } = await montar({}, { capitao: capitaoDuble });
  const r = await porta.enviar({ tipo: 'agente_ia', pergunta: 'que horas abre?', noId: 'n9', visitaSeq: 2, chaveEfeito: 'c9' },
    { execucao: { id: 'exec-1', tenantId: 't1' }, noId: 'n9', visitaSeq: 2 });

  assert.equal(capitaoDuble.chamadas[0].pedidoDoNo, true, 'sem `pedidoDoNo` a IA entra sem convite');
  assert.equal(capitaoDuble.chamadas[0].tenantId, 't1');
  assert.equal(cw.registro.mensagens.length, 1, 'quem === capitao e o texto não saiu: a IA respondeu para o log');
  assert.equal(cw.registro.mensagens[0].texto, 'O horário é das 8h às 18h.');
  assert.equal(r.aguardarResultado, true, 'o nó espera a volta pela fila (regra R3)');
  assert.equal(r.resultado.quem, 'capitao');
  assert.doesNotMatch(String(r.resumo), /horário/, 'o resumo vai para o banco de diagnóstico: nunca texto de conversa');
});

await medir('agente de IA: quando NÃO sabe, ninguém manda nada ao cliente', async () => {
  const capitaoDuble = { async responderPorIA() { return { quem: 'humano', texto: null, motivo: 'sem_base_de_conhecimento' }; } };
  const { cw, porta } = await montar({}, { capitao: capitaoDuble });
  const r = await porta.enviar({ tipo: 'agente_ia', pergunta: 'x', chaveEfeito: 'c10' }, {});
  assert.equal(cw.registro.mensagens.length, 0);
  assert.equal(r.resultado.quem, 'humano');
  assert.equal(r.resultado.motivo, 'sem_base_de_conhecimento');
});

await medir('Pix: cria com a chaveEfeito, TROCA o marcador pelo código e devolve o txid', async () => {
  const pagamentoDuble = {
    pedidos: [],
    async criarCobrancaPix(p) {
      pagamentoDuble.pedidos.push(p);
      return { txid: 'TX123', status: 'aguardando', copiaECola: '00020126BR.GOV.BCB.PIX', reaproveitada: false };
    },
  };
  const { cw, porta } = await montar({}, { pagamento: pagamentoDuble });
  const r = await porta.enviar({
    tipo: 'cobranca_pix', valorCentavos: 2490, descricao: 'Mensalidade',
    mensagemModelo: 'Segue o Pix:\n{{pix_copia_e_cola}}\nObrigado!', marcador: '{{pix_copia_e_cola}}',
    noId: 'n1', visitaSeq: 0, chaveEfeito: 'ch-pix',
  }, { execucao: { id: 'exec-1', tenantId: 't1' } });

  assert.equal(pagamentoDuble.pedidos[0].chaveEfeito, 'ch-pix', 'sem a chave, a Efí cria uma segunda cobrança');
  assert.equal(pagamentoDuble.pedidos[0].valorCentavos, 2490);
  assert.match(cw.registro.mensagens[0].texto, /00020126BR\.GOV\.BCB\.PIX/);
  assert.doesNotMatch(cw.registro.mensagens[0].texto, /\{\{pix_copia_e_cola\}\}/, 'o marcador não pode chegar ao cliente');
  assert.equal(r.idExterno, 'TX123');
  assert.doesNotMatch(String(r.resumo), /00020126/, 'o copia-e-cola é credencial de pagamento: fora do diagnóstico');
});

await medir('Pix: mensagem SEM o marcador ainda leva o código (nunca cobra sem dizer como pagar)', async () => {
  const pagamentoDuble = { async criarCobrancaPix() { return { txid: 'TX9', status: 'aguardando', copiaECola: 'CODIGO', reaproveitada: true }; } };
  const { cw, porta } = await montar({}, { pagamento: pagamentoDuble });
  await porta.enviar({ tipo: 'cobranca_pix', valorCentavos: 100, mensagemModelo: 'Segue a cobrança.', chaveEfeito: 'ch-pix2' }, {});
  assert.match(cw.registro.mensagens[0].texto, /CODIGO/);
});

await medir('Pix: cobrança sem copia-e-cola é ERRO, não mensagem vazia', async () => {
  const pagamentoDuble = { async criarCobrancaPix() { return { txid: 'TX0', status: 'aguardando', copiaECola: null }; } };
  const { cw, porta } = await montar({}, { pagamento: pagamentoDuble });
  await assert.rejects(
    () => porta.enviar({ tipo: 'cobranca_pix', valorCentavos: 100, mensagemModelo: 'x', chaveEfeito: 'ch-pix3' }, {}),
    (e) => e.status === 502,
  );
  assert.equal(cw.registro.mensagens.length, 0);
});

console.log('\n7) A LEITURA DA CONVERSA (efeito condicional)');

await medir('lerConversa devolve o estado que o motor grava em `estadoAnterior`', async () => {
  const { porta } = await montar();
  const c = await porta.lerConversa(900);
  assert.deepEqual(c, { status: 'open', assigneeId: null, teamId: 3, inboxId: 7 });
});

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
