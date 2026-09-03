#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BOTÕES NATIVOS EM INSTAGRAM, FACEBOOK E TELEGRAM — o que eu consegui MEDIR.
//
// Contrato S-BOTOES-NATIVOS (03/09/2026).
//
// ⚠️ O QUE ESTE ARQUIVO **NÃO** PROVA, e é honesto dizer antes de a primeira linha passar:
//   · que o cliente final VÊ o botão. Em 03/09/2026 não há caixa de Instagram, Facebook nem
//     Telegram ligada — não existe onde exercitar. O que se prova aqui é que o formato certo sai
//     pelo caminho certo, e que a degradação e o registro acontecem quando devem.
//   · o que a Meta e o Telegram fazem com um corpo malformado. Os tetos vieram da documentação
//     oficial lida em 03/09/2026 (fontes em `LIMITES_NATIVOS`), não de um envio recusado.
//   · que a plataforma traduz `input_select` em botão. Isso está medido no CÓDIGO dela (v4.17.1),
//     citado arquivo por arquivo em `CAPACIDADES` — leitura, não observação de produção.
//
// COMO RODAR:   node tests/ragnabot-botoes-nativos.test.mjs
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
const nativo = await import('../src/services/ragnabot-canal-nativo.porta.js');
const nos = await import('../src/services/ragnabot-fluxo-nos.service.js');
const webhook = await import('../src/routes/ragnabot-webhook.routes.js');
const portaria = await import('../src/services/ragnabot-portaria.service.js');

const semLog = { info() {}, warn() {}, error() {}, debug() {} };
const ALVO = { id: 'exec-1', tenantId: 't1', cwAccountId: 5, cwConversationId: 900 };

// ── DUBLÊ DA PLATAFORMA ───────────────────────────────────────────────────────────────────────
function dubleDoChatwoot(cfg = {}) {
  const registro = { mensagens: [], interativos: [] };
  return {
    registro,
    async caixaDaConversa() {
      return { tenantId: 't1', cwInboxId: 7, channelType: cfg.channelType ?? 'whatsapp', nome: 'Conexão', phoneNumberId: null };
    },
    async origemDoContato() {
      return cfg.semOrigem ? null : { sourceId: 'IGSID-777', cwInboxId: 7, cwContactId: 12 };
    },
    async enviarMensagem(d) {
      if (cfg.falharRegistro && d.sourceId) throw new Error('a plataforma recusou o registro');
      registro.mensagens.push(d);
      return { ok: true, id: 100 + registro.mensagens.length };
    },
    async enviarInterativo(d) { registro.interativos.push(d); return { ok: true, id: 200 + registro.interativos.length }; },
    async lerConversa() { return { id: 900, cwInboxId: 7, status: 'open' }; },
  };
}

const bancoVazio = { ragnabotFluxoEfeito: { async findUnique() { return null; } } };

async function montar(cfg = {}, portasNativas = null) {
  canal.esquecerEnvios();
  canal.esquecerCanais();
  const cw = dubleDoChatwoot(cfg);
  nativo.configurarCanalNativo({ credenciais: null, buscar: null, log: semLog });
  if (portasNativas) nativo.configurarCanalNativo(portasNativas);
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: semLog, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  return { cw, porta };
}

const itens = (n, prefixo = 'op') => Array.from({ length: n }, (_, i) => ({ id: `${prefixo}${i + 1}`, titulo: `Opção ${i + 1}` }));

console.log('\nBOTÕES NATIVOS — Instagram, Facebook e Telegram\n');
console.log('1) A TABELA DE CAPACIDADE — o que a plataforma REALMENTE traduz (medido no código dela)');

await medir('Telegram e Facebook passaram a ser INTERATIVOS: a tabela antiga dizia o contrário e estava errada', () => {
  assert.equal(canal.capacidadeDoCanal('telegram').interativo, true,
    'a plataforma traduz input_select em inline_keyboard (channel/telegram.rb#reply_markup)');
  assert.equal(canal.capacidadeDoCanal('facebook').interativo, true,
    'a plataforma traduz input_select em quick_replies (send_on_facebook_service.rb)');
  assert.equal(canal.capacidadeDoCanal('instagram').interativo, false,
    'o Instagram é o único dos três que recebe só texto (instagram/base_send_service.rb)');
});

await medir('os tetos são os DOCUMENTADOS, e o Instagram é o único com caminho nativo', () => {
  const fb = canal.capacidadeDoCanal('facebook');
  assert.equal(fb.botoesMax, 13, '«A maximum of 13 quick replies are supported»');
  assert.equal(fb.rotuloMax, 20, '«20 character limit» no título da resposta rápida');
  assert.equal(fb.voltaDoClique, 'rotulo', 'o parser da plataforma descarta quick_reply.payload');

  const tg = canal.capacidadeDoCanal('telegram');
  assert.equal(tg.cargaMax, 64, '«callback_data … 1-64 bytes»');
  assert.equal(tg.voltaDoClique, 'carga', 'o conteúdo da mensagem vira callback_query.data');
  assert.equal(tg.rotuloMax, null, 'a Bot API não documenta teto de rótulo — inventar um seria folclore');

  assert.equal(canal.capacidadeDoCanal('instagram').nativo, 'instagram');
  assert.equal(canal.capacidadeDoCanal('telegram').nativo, null, 'o Telegram não precisa de rota nativa: a plataforma já desenha');
  assert.equal(canal.capacidadeDoCanal('facebook').nativo, null);
});

console.log('\n2) A ROTA DE CADA ESCOLHA (função pura)');

await medir('Telegram com 4 botões vai pela PLATAFORMA (era texto numerado antes deste contrato)', () => {
  const r = canal.rotaDaEscolha({ tipo: 'botoes', botoes: itens(4) }, canal.capacidadeDoCanal('telegram'));
  assert.equal(r.rota, 'plataforma');
});

await medir('Facebook com 13 respostas rápidas cabe; com 14 degrada em vez de a Meta recusar tudo', () => {
  const cap = canal.capacidadeDoCanal('facebook');
  assert.equal(canal.rotaDaEscolha({ tipo: 'lista', itens: itens(13) }, cap).rota, 'plataforma');
  const r = canal.rotaDaEscolha({ tipo: 'lista', itens: itens(14) }, cap);
  assert.equal(r.rota, 'texto_numerado');
  assert.equal(r.motivo, 'itens_acima_do_teto');
});

await medir('Facebook: rótulo de 24 caracteres NÃO é cortado — degrada, porque o clique volta pelo rótulo', () => {
  // O nó já permite 24 no item de LISTA (limite do WhatsApp). O Messenger exige 20. Cortar aqui
  // criaria uma opção que não casa mais na volta — é o defeito que este passo fecha.
  const longos = [{ id: 'a', titulo: 'Segunda via de boleto do mês' }, { id: 'b', titulo: 'Falar' }];
  const r = canal.rotaDaEscolha({ tipo: 'lista', itens: longos }, canal.capacidadeDoCanal('facebook'));
  assert.equal(r.rota, 'texto_numerado');
  assert.equal(r.motivo, 'rotulo_acima_do_teto');
});

await medir('Telegram: id de item acima de 64 BYTES degrada — o teclado inteiro seria recusado', () => {
  const cap = canal.capacidadeDoCanal('telegram');
  assert.equal(canal.rotaDaEscolha({ tipo: 'botoes', botoes: [{ id: 'x'.repeat(64), titulo: 'ok' }] }, cap).rota, 'plataforma');
  const r = canal.rotaDaEscolha({ tipo: 'botoes', botoes: [{ id: 'x'.repeat(65), titulo: 'ok' }] }, cap);
  assert.equal(r.motivo, 'carga_acima_do_teto');
  // e a conta é em BYTES, não em caracteres: 33 acentuados = 66 bytes
  const acentuado = { tipo: 'botoes', botoes: [{ id: 'á'.repeat(33), titulo: 'ok' }] };
  assert.equal(canal.rotaDaEscolha(acentuado, cap).motivo, 'carga_acima_do_teto',
    'medir em caractere deixaria passar o que a API recusa');
});

await medir('botão de URL continua fora do interativo em TODO canal — inclusive nos três novos', () => {
  for (const c of ['telegram', 'facebook', 'instagram', 'whatsapp']) {
    const r = canal.rotaDaEscolha(
      { tipo: 'botoes', modo: 'url', botoes: [{ id: 'b', titulo: 'Abrir', tipo: 'url', url: 'https://x/y' }] },
      canal.capacidadeDoCanal(c),
    );
    assert.equal(r.motivo, 'botao_de_url', `${c} tentou desenhar botão de URL`);
  }
});

await medir('item SEM rótulo degrada em vez de sumir do menu — a plataforma o descartaria calada', () => {
  // `enviarInterativo` filtra `.filter((i) => i.title && i.value)`: sem esta guarda o cliente
  // receberia um menu com menos opções do que o fluxo tem, e o log não diria nada.
  const r = canal.rotaDaEscolha(
    { tipo: 'botoes', botoes: [{ id: 'a', titulo: 'Suporte' }, { id: 'b', titulo: '  ' }] },
    canal.capacidadeDoCanal('telegram'),
  );
  assert.equal(r.rota, 'texto_numerado');
  assert.equal(r.motivo, 'item_sem_rotulo');
});

console.log('\n3) O ENVIO PELA PLATAFORMA (Telegram e Facebook) — nada sai por fora');

await medir('Telegram: a escolha sai como input_select com o ID do item no valor de volta', async () => {
  const { cw, porta } = await montar({ channelType: 'telegram' });
  const r = await porta.enviar({ tipo: 'botoes', corpo: 'Escolha:', botoes: itens(3), chaveEfeito: 'k-tg' }, {});
  assert.equal(cw.registro.interativos.length, 1, 'era para ter ido interativo');
  assert.equal(cw.registro.mensagens.length, 0, 'não pode mandar texto numerado junto');
  assert.equal(cw.registro.interativos[0].itens[0].id, 'op1',
    'a plataforma põe este id em callback_data — é ele que volta no clique');
  assert.equal(r.degradado, undefined);
});

await medir('Facebook: idem, e a marca `rgt_efeito` viaja para o eco ser reconhecido depois', async () => {
  const { cw, porta } = await montar({ channelType: 'facebook' });
  await porta.enviar({ tipo: 'lista', corpo: 'Menu', itens: itens(5), chaveEfeito: 'k-fb' }, {});
  assert.equal(cw.registro.interativos.length, 1);
  assert.equal(cw.registro.interativos[0].atributosConteudo.rgt_efeito, 'k-fb');
});

console.log('\n4) O ENVIO NATIVO (Instagram) — o formato, o histórico e o eco');

await medir('o corpo nativo é RESPOSTA RÁPIDA no formato da Meta, com rótulo e carga por item', () => {
  const c = nativo.montarRespostasRapidasMeta({
    canal: 'instagram', destinatarioId: 'IGSID-777', corpo: 'Escolha o setor:',
    itens: [{ id: 'sup', titulo: 'Suporte' }, { id: 'fin', titulo: 'Financeiro' }],
  });
  assert.equal(c.recipient.id, 'IGSID-777');
  assert.equal(c.message.text, 'Escolha o setor:');
  assert.deepEqual(c.message.quick_replies, [
    { content_type: 'text', title: 'Suporte', payload: 'sup' },
    { content_type: 'text', title: 'Financeiro', payload: 'fin' },
  ]);
});

await medir('o nativo NUNCA usa botão de modelo: o postback do clique é descartado pela plataforma', () => {
  const c = nativo.montarRespostasRapidasMeta({
    canal: 'instagram', destinatarioId: 'x', corpo: 'oi', itens: [{ id: 'a', titulo: 'A' }],
  });
  assert.ok(!c.message.attachment, 'botão de modelo desenha e o toque não chega em ninguém');
  assert.ok(Array.isArray(c.message.quick_replies));
});

await medir('nativo: 14 opções, rótulo de 21 e carga gigante são RECUSADOS com código próprio', () => {
  const alvo = { canal: 'instagram', destinatarioId: 'x', corpo: 'oi' };
  assert.throws(() => nativo.montarRespostasRapidasMeta({ ...alvo, itens: itens(14) }), (e) => e.codigo === 'ACIMA_DO_TETO');
  assert.throws(() => nativo.montarRespostasRapidasMeta({ ...alvo, itens: [{ id: 'a', titulo: 'x'.repeat(21) }] }),
    (e) => e.codigo === 'ROTULO_LONGO');
  assert.throws(() => nativo.montarRespostasRapidasMeta({ ...alvo, itens: [{ id: 'x'.repeat(1001), titulo: 'A' }] }),
    (e) => e.codigo === 'CARGA_LONGA');
});

await medir('sem credencial o nativo recusa e a escolha CAI no texto numerado, declarando', async () => {
  const { cw, porta } = await montar({ channelType: 'instagram' });
  const r = await porta.enviar({ tipo: 'lista', corpo: 'Escolha:', itens: itens(2), chaveEfeito: 'k-ig1' }, {});
  assert.equal(cw.registro.mensagens.length, 1);
  assert.match(cw.registro.mensagens[0].texto, /1\. Opção 1/);
  assert.equal(r.degradado, 'texto_numerado');
  assert.equal(r.motivoDegradacao, 'nativo_indisponivel:SEM_CREDENCIAL');
});

await medir('COM credencial: sai pela API do canal E é REGISTRADA na conversa, sem sair duas vezes', async () => {
  const chamadas = [];
  const { cw, porta } = await montar({ channelType: 'instagram' }, {
    credenciais: { async doCanal() { return { token: 'TOKEN-DE-MENTIRA', contaId: 'me' }; } },
    async buscar(url, opcoes) {
      chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
      return { ok: true, status: 200, async json() { return { recipient_id: 'IGSID-777', message_id: 'mid-abc' }; } };
    },
  });
  const r = await porta.enviar({ tipo: 'lista', corpo: 'Escolha:', itens: itens(2), chaveEfeito: 'k-ig2' }, {});

  assert.equal(chamadas.length, 1, 'era para ter falado com a API do canal exatamente uma vez');
  assert.match(chamadas[0].url, /^https:\/\/graph\.instagram\.com\/v\d+\.\d+\/me\/messages\?access_token=/);
  assert.equal(chamadas[0].corpo.message.quick_replies.length, 2);
  assert.equal(r.idExterno, 'mid-abc');
  assert.equal(r.nativo, 'instagram');
  assert.equal(r.registrado, true);

  // ⭐ O CORAÇÃO DO CONTRATO. A mensagem TEM de aparecer no histórico...
  assert.equal(cw.registro.mensagens.length, 1, 'o atendente não veria o que o robô falou com o cliente');
  const registro = cw.registro.mensagens[0];
  assert.match(registro.texto, /Opção 1/, 'o registro tem de trazer as opções, não só a pergunta');
  // ...sem a plataforma reentregar (é o `source_id` que faz `invalid_message?` devolver true)...
  assert.equal(registro.sourceId, 'mid-abc', 'sem o source_id a plataforma manda a mesma mensagem de novo');
  // ...e marcada como NOSSA, para o eco não realimentar o motor.
  assert.equal(registro.atributosConteudo.rgt_efeito, 'k-ig2');
  assert.equal(registro.atributosConteudo.rgt_nativo, 'instagram');
});

await medir('se o REGISTRO falhar depois do envio, ninguém manda nada de novo ao cliente', async () => {
  const { cw, porta } = await montar({ channelType: 'instagram', falharRegistro: true }, {
    credenciais: { async doCanal() { return { token: 'T' }; } },
    async buscar() { return { ok: true, status: 200, async json() { return { message_id: 'mid-2' }; } }; },
  });
  const r = await porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'k-ig3' }, {});
  assert.equal(r.idExterno, 'mid-2');
  assert.equal(r.registrado, false, 'a falha de registro tem de ficar VISÍVEL no retorno');
  assert.match(r.resumo, /SEM registro/);
  assert.equal(cw.registro.mensagens.length, 0, 'mandar o menu de novo para consertar o painel é o pior conserto possível');
});

console.log('\n5) CANAL FORA DO AR — adiar, nunca perder e nunca duplicar');

await medir('rede caída no envio nativo SOBE como dúvida — não vira texto numerado', async () => {
  const { cw, porta } = await montar({ channelType: 'instagram' }, {
    credenciais: { async doCanal() { return { token: 'T' }; } },
    async buscar() { throw new Error('socket hang up'); },
  });
  await assert.rejects(
    () => porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'k-ig4' }, {}),
    (e) => e.code === 'ECONNRESET',
  );
  assert.equal(cw.registro.mensagens.length, 0,
    'degradar depois de uma DÚVIDA mandaria o mesmo menu duas vezes: uma em botão, outra em número');
});

await medir('o canal dizendo NÃO (4xx) é certeza de que nada saiu — aí sim degrada', async () => {
  const { cw, porta } = await montar({ channelType: 'instagram' }, {
    credenciais: { async doCanal() { return { token: 'T' }; } },
    async buscar() {
      return { ok: false, status: 400, async json() { return { error: { message: 'Invalid recipient', code: 100 } }; } };
    },
  });
  const r = await porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'k-ig5' }, {});
  assert.equal(r.degradado, 'texto_numerado');
  assert.equal(r.motivoDegradacao, 'nativo_indisponivel:CANAL_RECUSOU');
  assert.equal(cw.registro.mensagens.length, 1, 'a mensagem não pode se perder');
});

await medir('o canal aceitando SEM devolver message_id é dúvida: sem id não há registro sem reenvio', async () => {
  const { porta } = await montar({ channelType: 'instagram' }, {
    credenciais: { async doCanal() { return { token: 'T' }; } },
    async buscar() { return { ok: true, status: 200, async json() { return { recipient_id: 'x' }; } }; },
  });
  await assert.rejects(
    () => porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'k-ig6' }, {}),
    (e) => e.codigo === 'SEM_ID_DE_MENSAGEM',
  );
});

await medir('o token NUNCA aparece no retorno NEM no log — a URL o leva na consulta', async () => {
  // Lei 1 da casa: zero credencial em commit, doc ou LOG. O token viaja na querystring, então
  // qualquer log que imprima a URL o publica em texto puro no diário do cluster.
  const escrito = [];
  const espiao = { info: (m) => escrito.push(String(m)), warn: (m) => escrito.push(String(m)), error: (m) => escrito.push(String(m)), debug() {} };
  canal.esquecerEnvios(); canal.esquecerCanais();
  const cw = dubleDoChatwoot({ channelType: 'instagram' });
  nativo.configurarCanalNativo({
    log: espiao,
    credenciais: { async doCanal() { return { token: 'SEGREDO-QUE-NAO-PODE-VAZAR' }; } },
    async buscar() { return { ok: false, status: 401, async json() { return { error: { message: 'bad token', code: 190 } }; } }; },
  });
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: espiao, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  const r = await porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'k-ig7' }, {});
  assert.doesNotMatch(JSON.stringify(r), /SEGREDO-QUE-NAO-PODE-VAZAR/, 'o token vazou no retorno');
  assert.doesNotMatch(escrito.join('\n'), /SEGREDO-QUE-NAO-PODE-VAZAR/, 'o token vazou no log');
  assert.ok(escrito.some((l) => /CANAL_RECUSOU/.test(l)), 'a recusa tem de aparecer no log — só sem o segredo');
});

console.log('\n6) A VOLTA DO CLIQUE — casar a opção pelos DOIS caminhos');

await medir('Telegram: a carga volta como TEXTO (callback_query.data) e ainda casa com a opção certa', () => {
  const lista = [{ id: 'op-suporte', titulo: 'Suporte técnico' }, { id: 'op-financeiro', titulo: 'Financeiro' }];
  // É assim que a escolha chega: mensagem comum cujo conteúdo é o id que NÓS mandamos.
  const r = nos.casarOpcao({ texto: 'op-financeiro' }, lista);
  assert.equal(r?.id, 'op-financeiro');
  assert.equal(r?.via, 'carga', 'sem este caminho o cliente tocava no botão e ouvia «não entendi»');
});

await medir('Facebook/Instagram: a carga se perde e o RÓTULO volta — casa pelo título', () => {
  const lista = [{ id: 'op-suporte', titulo: 'Suporte técnico' }, { id: 'op-financeiro', titulo: 'Financeiro' }];
  const r = nos.casarOpcao({ texto: 'Suporte técnico' }, lista);
  assert.equal(r?.id, 'op-suporte');
  assert.equal(r?.via, 'titulo');
});

await medir('a carga vence o índice quando o id É um número — quem mandou aquele valor fomos nós', () => {
  const lista = [{ id: 'a', titulo: 'Primeira' }, { id: '1', titulo: 'Segunda' }];
  const r = nos.casarOpcao({ texto: '1' }, lista);
  assert.equal(r?.id, '1');
  assert.equal(r?.via, 'carga');
});

await medir('texto numerado continua casando pelo índice — a rede de degradação segue de pé', () => {
  const lista = [{ id: 'op-suporte', titulo: 'Suporte' }, { id: 'op-financeiro', titulo: 'Financeiro' }];
  const r = nos.casarOpcao({ texto: '2' }, lista);
  assert.equal(r?.id, 'op-financeiro');
  assert.equal(r?.via, 'indice');
});

console.log('\n7) O ECO NÃO REALIMENTA O MOTOR');

await medir('a mensagem registrada volta como ECO NOSSO, e a portaria para nela', () => {
  // O corpo que a plataforma devolve para a linha criada por `despacharEscolhaNativa`.
  const evento = webhook.classificarEvento({
    event: 'message_created',
    account: { id: 5 },
    conversation: { id: 900, inbox_id: 7 },
    inbox: { id: 7, channel_type: 'Channel::Instagram' },
    id: 4242,
    message_type: 'outgoing',
    content: 'Escolha:\n\n1. Opção 1\n2. Opção 2',
    content_attributes: { rgt_efeito: 'k-ig2', rgt_nativo: 'instagram' },
    source_id: 'mid-abc',
  });
  assert.equal(evento.classe, portaria.CLASSES_ENTRADA.ECO_PROPRIO,
    'sem isso o robô responderia à própria mensagem, em laço');
  assert.equal(evento.motivo, 'eco_do_motor');
});

await medir('sem a marca, a MESMA saída seria lida como gente digitando — a marca é o que separa', () => {
  const evento = webhook.classificarEvento({
    event: 'message_created', account: { id: 5 }, conversation: { id: 900 },
    id: 4243, message_type: 'outgoing', content: 'oi', content_attributes: {},
  });
  assert.equal(evento.classe, portaria.CLASSES_ENTRADA.CONTROLE);
  assert.equal(evento.motivo, 'saida_humana');
});

await medir('o clique do cliente É resposta de cliente — e não pode ser confundido com eco', () => {
  const evento = webhook.classificarEvento({
    event: 'message_created', account: { id: 5 }, conversation: { id: 900, inbox_id: 7 },
    id: 4244, message_type: 'incoming', content: 'op-financeiro',
    sender: { id: 12, type: 'contact' },
  });
  assert.equal(evento.classe, portaria.CLASSES_ENTRADA.RESPOSTA_CLIENTE);
  assert.equal(evento.texto, 'op-financeiro', 'é este texto que o casador recebe como CARGA');
});

console.log('\n8) O TOQUE QUE FICA GIRANDO NO TELEGRAM');

await medir('answerCallbackQuery está implementado e recusa em voz alta sem o token do bot', async () => {
  nativo.configurarCanalNativo({ credenciais: null, buscar: null, log: semLog });
  await assert.rejects(
    () => nativo.responderCliqueTelegram({ tenantId: 't1', cwInboxId: 7, callbackQueryId: 'cbq-1' }),
    (e) => e.codigo === 'SEM_CREDENCIAL',
  );
});

await medir('com o token, ele chama answerCallbackQuery e corta o texto no teto de 200', async () => {
  const chamadas = [];
  nativo.configurarCanalNativo({
    log: semLog,
    credenciais: { async doCanal() { return { token: 'BOT-TOKEN' }; } },
    async buscar(url, opcoes) { chamadas.push({ url, corpo: JSON.parse(opcoes.body) }); return { ok: true, status: 200, async json() { return { ok: true, result: true }; } }; },
  });
  await nativo.responderCliqueTelegram({ callbackQueryId: 'cbq-9', texto: 'x'.repeat(300) });
  assert.match(chamadas[0].url, /\/answerCallbackQuery$/);
  assert.equal(chamadas[0].corpo.callback_query_id, 'cbq-9');
  assert.equal(chamadas[0].corpo.text.length, 200, '«text … 0-200 characters»');
  nativo.configurarCanalNativo({ credenciais: null, buscar: null });
});

console.log('\n9) A LEI S6 — nenhum arquivo do MOTOR cita canal pelo nome');

await medir('motor, nós e fila continuam sem citar instagram/facebook/telegram', async () => {
  const { readFileSync } = await import('node:fs');
  const proibidos = [/\binstagram\b/iu, /\btelegram\b/iu, /\bmessenger\b/iu];
  const arquivos = [
    'src/services/ragnabot-fluxo-motor.service.js',
    'src/services/ragnabot-fluxo-nos.service.js',
    'src/services/ragnabot-fluxo-fila.service.js',
  ];
  for (const a of arquivos) {
    const texto = readFileSync(new URL(`../${a}`, import.meta.url), 'utf8');
    for (const r of proibidos) {
      assert.ok(!r.test(texto), `${a} passou a citar ${r} — a camada de canal vazou para o motor`);
    }
  }
});

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
