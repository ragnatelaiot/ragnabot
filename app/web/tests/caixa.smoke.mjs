// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DA CAIXA DE ATENDIMENTO (contrato S2, 02/09/2026)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE, E É O MAIS IMPORTANTE DE DIZER: o ISOLAMENTO. Ele é do
// SERVIDOR, e a prova dele é `app/tests/ragnabot-caixa-isolamento.test.mjs` — 57 medições contra
// PostgreSQL de verdade e o router de verdade, onde um agente pedindo a conversa de outro PELA API
// recebe 404. Aqui se mede a TELA: que as três etiquetas aparecem, que o contador fica no botão da
// aba e que a camada de rede fala com o caminho certo. Nada do que este arquivo mede protege dado
// nenhum, e não pode ser lido como se protegesse.
//
// ⛔ O que não dá para provar aqui, e não vou fingir que prova: `useEffect` não roda em SSR — a
// busca inicial, o clique nas abas e o painel de histórico só com navegador contra o motor no ar.
//
// Rodar (a partir de `app/web/`):   node tests/caixa.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'caixa');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}
async function medirAsync(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

// ── O DUBLÊ DA REDE ─────────────────────────────────────────────────────────────────────────────
const rede = { chamadas: [], proxima: null };
globalThis.fetch = async (url, opcoes = {}) => {
  rede.chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', opcoes });
  const r = rede.proxima || { status: 200, corpo: {} };
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => JSON.stringify(r.corpo) };
};
function zerar() { rede.chamadas = []; rede.proxima = null; }

const api = await import('../src/lib/api-caixa.js');

/** Uma conversa como o SERVIDOR a entrega (`paraTela`), com as três etiquetas já montadas. */
const CONVERSA = {
  id: 'x1', cwConversationId: 1001, cwAccountId: 1, protocolo: 'RGT-0000000001',
  estado: 'atendendo', ehGrupo: false, comRobo: false,
  caixa: { id: 34, nome: 'WhatsApp Ragnatela', canal: 'whatsapp' },
  setor: { id: 7, nome: 'Suporte' },
  atendente: { id: 11, nome: 'Ana' },
  contato: { id: 5, nome: 'Cliente Um', chave: '+5598911110000' },
  abertaEm: new Date(Date.now() - 3600000).toISOString(),
  ultimaAtividadeEm: new Date(Date.now() - 300000).toISOString(),
  resolvidaEm: null, resolvidaPor: null,
  etiquetas: [
    { tipo: 'caixa', rotulo: 'WhatsApp Ragnatela', valor: 34, canal: 'whatsapp', vazia: false },
    { tipo: 'setor', rotulo: 'Suporte', valor: 7, vazia: false },
    { tipo: 'atendente', rotulo: 'Ana', valor: 11, vazia: false },
  ],
};

const NA_FILA = {
  ...CONVERSA,
  id: 'x2', cwConversationId: 1003, protocolo: null, estado: 'aguardando',
  atendente: { id: null, nome: null },
  etiquetas: [
    { tipo: 'caixa', rotulo: 'WhatsApp Ragnatela', valor: 34, canal: 'whatsapp', vazia: false },
    { tipo: 'setor', rotulo: 'Suporte', valor: 7, vazia: false },
    { tipo: 'atendente', rotulo: 'Sem atendente', valor: null, vazia: true },
  ],
};

console.log('\nCAIXA DE ATENDIMENTO — o que eu consegui medir\n');
console.log('1) A CAMADA DE REDE (JavaScript puro, com o fetch trocado por dublê)');

await medirAsync('a lista vai ao caminho da caixa, com a aba e a sub-aba na consulta', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarConversas({ aba: 'abertas', sub: 'aguardando', pagina: 2 });
  assert.equal(rede.chamadas.length, 1);
  assert.match(rede.chamadas[0].url, /\/api\/ragnabot-caixa\/conversas\?/);
  assert.match(rede.chamadas[0].url, /aba=abertas/);
  assert.match(rede.chamadas[0].url, /sub=aguardando/);
  assert.equal(rede.chamadas[0].opcoes.credentials, 'same-origin', 'sem isto o cookie de sessão não vai junto');
});

await medirAsync('parâmetro vazio NÃO vira `?busca=` na URL', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { total: 0, itens: [] } };
  await api.listarConversas({ aba: 'abertas', busca: '', cwTeamId: undefined });
  assert.ok(!rede.chamadas[0].url.includes('busca='), rede.chamadas[0].url);
  assert.ok(!rede.chamadas[0].url.includes('cwTeamId='), rede.chamadas[0].url);
});

await medirAsync('o contador tem rota PRÓPRIA — a tela não conta o que está na página', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { abertas: 12, atendendo: 3 } };
  const n = await api.contadores({});
  assert.match(rede.chamadas[0].url, /\/contadores/);
  assert.equal(n.abertas, 12);
});

await medirAsync('o histórico SEMPRE leva o setor — é a regra do dono, e ela começa aqui', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { permitido: true, total: 0, itens: [] } };
  await api.historicoDoContato({ cwTeamId: 7, contatoChave: '+5598911110000' });
  assert.match(rede.chamadas[0].url, /\/historico\?/);
  assert.match(rede.chamadas[0].url, /cwTeamId=7/);
});

await medirAsync('403 do servidor vira mensagem legível, com o código preservado', async () => {
  zerar();
  rede.proxima = { status: 403, corpo: { error: 'Você não participa deste setor.', code: 'FORA_DO_SEU_SETOR' } };
  await assert.rejects(
    () => api.historicoDoContato({ cwTeamId: 9, contatoChave: 'x' }),
    (e) => e.status === 403 && e.code === 'FORA_DO_SEU_SETOR' && /não participa/.test(e.message),
  );
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A TELA (renderização do lado do servidor)');

const PACOTE = path.join(SAIDA_SSR, 'CaixaDeAtendimento.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/CaixaDeAtendimento.jsx', '--outDir', 'tests/.ssr/caixa', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const { CartaoDeConversa, Abas, SubAbas, EtiquetasDoCartao, desdeQuando } = tela;

const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');

medir('⭐ o cartão traz as TRÊS etiquetas: caixa · setor · atendente', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: CONVERSA, aba: 'abertas' })));
  assert.match(html, /data-conversa="1001"/);
  assert.ok(html.includes('WhatsApp Ragnatela'), 'faltou a caixa de entrada');
  assert.ok(html.includes('Suporte'), 'faltou o setor');
  assert.ok(html.includes('Ana'), 'faltou o atendente');
  assert.ok(html.includes('RGT-0000000001'), 'faltou o protocolo');
});

medir('⭐ etiqueta vazia NÃO some: a fila mostra «Sem atendente»', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: NA_FILA, aba: 'abertas' })));
  assert.ok(html.includes('Sem atendente'), 'a etiqueta sumiu, e o cartão mudou de forma na fila');
  // Sem protocolo ainda, mostra o número da conversa — nunca um espaço em branco.
  assert.ok(html.includes('#1003'));
});

medir('o estado aparece em PALAVRA, não só em cor', () => {
  const atendendo = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: CONVERSA, aba: 'abertas' })));
  const fila = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: NA_FILA, aba: 'abertas' })));
  assert.ok(atendendo.includes('Atendendo'));
  assert.ok(fila.includes('Aguardando'));
});

medir('na aba Resolvidos o cartão mostra QUANDO foi resolvida e POR QUEM', () => {
  const resolvida = {
    ...CONVERSA, estado: 'resolvida',
    resolvidaEm: new Date(Date.now() - 600000).toISOString(),
    resolvidaPor: { id: 11, nome: 'Ana' },
  };
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, { conversa: resolvida, aba: 'resolvidos' })));
  assert.ok(html.includes('resolvida há 10 min'), html.slice(0, 400));
  assert.ok(html.includes('por Ana'));
});

medir('⭐ as abas mostram o contador que veio do SERVIDOR', () => {
  const html = semMarcas(renderToString(React.createElement(Abas, {
    aba: 'abertas', contagem: { abertas: 12, resolvidos: 340, grupos: 2 },
  })));
  for (const [aba, n] of [['abertas', 12], ['resolvidos', 340], ['grupos', 2]]) {
    assert.match(html, new RegExp(`data-contador="${aba}"[^>]*>${n}<`), `contador de ${aba} errado`);
  }
});

medir('⭐ as sub-abas de Abertas são Todas · Atendendo · Aguardando · ChatBot, com contador', () => {
  const html = semMarcas(renderToString(React.createElement(SubAbas, {
    sub: null, contagem: { abertas: 12, atendendo: 5, aguardando: 4, chatbot: 3 },
  })));
  for (const s of ['todas', 'atendendo', 'aguardando', 'chatbot']) {
    assert.match(html, new RegExp(`data-subaba="${s}"`), `faltou a sub-aba ${s}`);
  }
  assert.match(html, /data-contador="atendendo"[^>]*>5</);
  assert.match(html, /data-contador="chatbot"[^>]*>3</);
});

medir('contador ausente vira 0 na tela, e não «undefined»', () => {
  const html = semMarcas(renderToString(React.createElement(Abas, { aba: 'abertas', contagem: {} })));
  assert.ok(!html.includes('undefined'), html.slice(0, 300));
  assert.match(html, /data-contador="grupos"[^>]*>0</);
});

medir('as etiquetas isoladas mantêm a ordem caixa → setor → atendente', () => {
  const html = semMarcas(renderToString(React.createElement(EtiquetasDoCartao, { etiquetas: CONVERSA.etiquetas })));
  const iCaixa = html.indexOf('WhatsApp Ragnatela');
  const iSetor = html.indexOf('Suporte');
  const iAgente = html.indexOf('Ana');
  assert.ok(iCaixa >= 0 && iCaixa < iSetor && iSetor < iAgente, `ordem: ${iCaixa}/${iSetor}/${iAgente}`);
});

medir('«há quanto tempo» é relativo — data crua obriga o olho a fazer conta', () => {
  assert.equal(desdeQuando(null), '—');
  assert.equal(desdeQuando('não é data'), '—');
  assert.equal(desdeQuando(new Date(Date.now() - 30000).toISOString()), 'agora');
  assert.equal(desdeQuando(new Date(Date.now() - 5 * 60000).toISOString()), 'há 5 min');
  assert.equal(desdeQuando(new Date(Date.now() - 3 * 3600000).toISOString()), 'há 3 h');
});

// ── RETROCARGA (contrato S3) — a camada de rede fala com o caminho certo ────────────────────────
await medirAsync('«Conferir conversas existentes» chama a rota de SIMULAÇÃO (não grava nada)', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, retrocarga: { lidas: 7, simulacao: true, porEstado: { atendendo: 1 } } } };
  const r = await api.retrocarregarConversas({ simular: true });
  assert.equal(rede.chamadas.length, 1);
  assert.equal(rede.chamadas[0].metodo, 'POST');
  assert.match(rede.chamadas[0].url, /\/ragnabot-caixa\/retrocarga\?simular=1$/, rede.chamadas[0].url);
  assert.equal(r.retrocarga.simulacao, true);
});

await medirAsync('«Trazer conversas existentes» chama a rota SEM simular', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, retrocarga: { lidas: 7, criadas: 7, atualizadas: 0 } } };
  await api.retrocarregarConversas();
  assert.match(rede.chamadas[0].url, /\/ragnabot-caixa\/retrocarga$/, rede.chamadas[0].url);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ 3) A MESA — aceitar · espiar · escrever · transferir (contrato S-ATENDER, 03/09/2026)
//
// ⚠️ O QUE ESTA SEÇÃO NÃO MEDE, E É O QUE MAIS IMPORTA: a RECUSA. Ela é do servidor, e a prova é
// `app/tests/ragnabot-mesa-atender.test.mjs` — 54 medições contra PostgreSQL de verdade, onde um
// agente mandando POST numa conversa que não é dele recebe recusa, e dois aceitando ao mesmo tempo
// terminam com UM vencedor. Aqui se mede a TELA: que ela OBEDECE ao que o servidor respondeu.
// Nada desta seção protege coisa alguma, e não pode ser lido como se protegesse.
// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) A MESA — as ações do cartão e o painel da conversa');

await medirAsync('«Aceitar» vai por POST à rota de aceite (é lá que a corrida é arbitrada)', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, conversa: CONVERSA, plataforma: { aplicada: true } } };
  await api.aceitarConversa(1003, { cwTeamId: 7 });
  assert.equal(rede.chamadas[0].metodo, 'POST');
  assert.match(rede.chamadas[0].url, /\/conversas\/1003\/aceitar$/, rede.chamadas[0].url);
});

await medirAsync('⭐ perder a corrida chega à tela com o NOME de quem levou, e o código preservado', async () => {
  zerar();
  rede.proxima = { status: 409, corpo: { error: 'Esta conversa já foi aceita por Ana (Suporte).', code: 'JA_ACEITA', atendenteNome: 'Ana (Suporte)' } };
  await assert.rejects(
    () => api.aceitarConversa(1003),
    (e) => e.status === 409 && e.code === 'JA_ACEITA' && /já foi aceita por Ana/.test(e.message),
  );
});

await medirAsync('abrir a conversa usa a MESMA rota para ler a minha e para espiar a da fila', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { conversa: CONVERSA, mensagens: [], escrita: { pode: true } } };
  await api.abrirConversa(1001);
  assert.match(rede.chamadas[0].url, /\/conversas\/1001\/abrir$/, rede.chamadas[0].url);
  assert.equal(rede.chamadas[0].metodo, 'GET');
});

await medirAsync('escrever vai por POST, e a nota interna viaja como `privada`', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true } };
  await api.enviarMensagem(1001, { texto: 'boa tarde', privada: true });
  assert.match(rede.chamadas[0].url, /\/conversas\/1001\/mensagens$/);
  assert.deepEqual(JSON.parse(rede.chamadas[0].opcoes.body), { texto: 'boa tarde', privada: true });
});

await medirAsync('⭐ a recusa de escrita do SERVIDOR chega à tela com a explicação em português', async () => {
  zerar();
  rede.proxima = { status: 403, corpo: { error: 'Esta conversa está com outro atendente. Para responder, ela precisa ser transferida para você.', code: 'CONVERSA_DE_OUTRO_ATENDENTE' } };
  await assert.rejects(
    () => api.enviarMensagem(1002, { texto: 'invadindo' }),
    (e) => e.status === 403 && e.code === 'CONVERSA_DE_OUTRO_ATENDENTE' && /outro atendente/.test(e.message),
  );
});

await medirAsync('transferir manda atendente, setor, motivo e nota num POST só', async () => {
  zerar();
  rede.proxima = { status: 200, corpo: { ok: true, recado: 'Conversa transferida para Clara.' } };
  await api.transferirConversa(1001, { paraCwUserId: 13, paraCwTeamId: 9, motivo: 'cobrança', notaInterna: 'já mandou o comprovante' });
  assert.match(rede.chamadas[0].url, /\/conversas\/1001\/transferir$/);
  const corpo = JSON.parse(rede.chamadas[0].opcoes.body);
  assert.equal(corpo.paraCwUserId, 13);
  assert.equal(corpo.paraCwTeamId, 9);
  assert.equal(corpo.motivo, 'cobrança');
});

medir('⛔ o endereço do anexo é o do NOSSO painel — o da plataforma não chega ao navegador', () => {
  const url = api.enderecoDoAnexo(1001, 555, 0);
  assert.match(url, /\/api\/ragnabot-caixa\/conversas\/1001\/anexos\/555\/0$/, url);
  assert.ok(!/chat00\d|bot\.ragnatela|rails\/active_storage|172\./.test(url), 'vazou endereço da plataforma');
});

// ── as peças da conversa aberta ────────────────────────────────────────────────────────────────
const PACOTE_CONVERSA = path.join(SAIDA_SSR, 'ConversaAberta.js');
if (!fs.existsSync(PACOTE_CONVERSA) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando o painel da conversa com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/ConversaAberta.jsx', '--outDir', 'tests/.ssr/caixa', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}
const painel = await import(PACOTE_CONVERSA);
const { Balao, LinhaDoTempo, BarraDeEscrita, PainelDeTransferencia, horaLocal } = painel;

medir('⭐ o horário é o de quem atende (UTC−3), não o do relógio do navegador', () => {
  // 03/09/2026 15:00 UTC ⇒ 12:00 em Fortaleza/São Luís. Se aparecer 15:00, o fuso foi ignorado.
  const t = horaLocal('2026-09-03T15:00:00.000Z');
  assert.ok(t.includes('12:00'), `esperava 12:00 (UTC−3), veio «${t}»`);
});

medir('⭐ quem falou vem ESCRITO no balão — cor sozinha não diz quem é cliente e quem é robô', () => {
  const html = semMarcas(renderToString(React.createElement(LinhaDoTempo, {
    cwConversationId: 1001,
    mensagens: [
      { id: 1, lado: 'cliente', texto: 'bom dia', quando: '2026-09-03T15:00:00.000Z', anexos: [] },
      { id: 2, lado: 'robo', texto: 'olá!', quando: '2026-09-03T15:01:00.000Z', anexos: [] },
      { id: 3, lado: 'atendente', texto: 'já verifico', autorNome: 'Ana', quando: '2026-09-03T15:02:00.000Z', anexos: [] },
    ],
  })));
  assert.ok(html.includes('bom dia') && html.includes('olá!') && html.includes('já verifico'), 'faltou mensagem');
  assert.ok(html.includes('Cliente'), 'não diz que foi o cliente');
  assert.ok(html.includes('Robô'), 'não diz que foi o robô');
  assert.ok(html.includes('Ana'), 'não diz o nome do atendente');
  assert.match(html, /data-lado="cliente"/);
});

medir('a nota interna avisa, no próprio balão, que o cliente não a recebe', () => {
  const html = semMarcas(renderToString(React.createElement(Balao, {
    cwConversationId: 1001,
    mensagem: { id: 9, lado: 'nota', texto: 'confirmar com o financeiro', quando: '2026-09-03T15:00:00.000Z', anexos: [] },
  })));
  assert.ok(html.includes('só a equipe vê'), html.slice(0, 300));
});

medir('o anexo aponta para o painel, e a imagem é servida por lá', () => {
  const html = semMarcas(renderToString(React.createElement(Balao, {
    cwConversationId: 1001,
    mensagem: { id: 77, lado: 'cliente', texto: null, quando: '2026-09-03T15:00:00.000Z', anexos: [{ indice: 0, tipo: 'image', nome: 'foto.jpg' }] },
  })));
  assert.match(html, /\/api\/ragnabot-caixa\/conversas\/1001\/anexos\/77\/0/, html.slice(0, 400));
});

medir('⭐ SEM atribuição o campo de escrita NÃO EXISTE — e a frase do servidor aparece no lugar', () => {
  const html = semMarcas(renderToString(React.createElement(BarraDeEscrita, {
    escrita: { pode: false, motivo: 'CONVERSA_SEM_DONO', explicacao: 'Esta conversa ainda não é de ninguém. Clique em "Aceitar" para assumi-la e poder responder.', podeAceitar: true },
    texto: '', nota: false,
  })));
  assert.ok(!html.includes('<textarea'), 'o campo de escrita apareceu sem atribuição');
  assert.ok(html.includes('ainda não é de ninguém'), 'a explicação do servidor não chegou à tela');
  assert.ok(html.includes('Aceitar'), 'faltou a saída: o botão que resolve');
  assert.match(html, /data-sem-escrita/);
});

medir('com a conversa atribuída a mim, o campo aparece', () => {
  const html = semMarcas(renderToString(React.createElement(BarraDeEscrita, {
    escrita: { pode: true }, texto: '', nota: false,
  })));
  assert.ok(html.includes('<textarea'), 'o dono da conversa ficou sem campo de escrita');
  assert.match(html, /data-barra-escrita/);
});

medir('o administrador que não assumiu vê «Assumir para mim», não o campo de texto', () => {
  const html = semMarcas(renderToString(React.createElement(BarraDeEscrita, {
    escrita: { pode: false, motivo: 'CONVERSA_DE_OUTRO_ATENDENTE', explicacao: 'Esta conversa está com outro atendente.', podeAssumir: true },
    texto: '', nota: false,
  })));
  assert.ok(!html.includes('<textarea'));
  assert.ok(html.includes('Assumir para mim'));
});

medir('⭐ o painel de transferência oferece atendente E setor, e explica o efeito', () => {
  const html = semMarcas(renderToString(React.createElement(PainelDeTransferencia, {
    destinos: { atendentes: [{ cwUserId: 13, nome: 'Clara' }], setores: [{ cwTeamId: 9, nome: 'Financeiro' }] },
    valor: { paraCwUserId: null, paraCwTeamId: null },
  })));
  assert.ok(html.includes('Clara'), 'faltou o atendente na lista');
  assert.ok(html.includes('Financeiro'), 'faltou o setor na lista');
  assert.ok(html.includes('volta para a fila do setor'), 'não explica o que acontece sem escolher atendente');
  assert.match(html, /data-transferencia/);
});

medir('⭐ o cartão da fila oferece Espiar + Aceitar + Transferir', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, {
    conversa: NA_FILA, aba: 'abertas', aoAbrir: () => {}, aoAceitar: () => {},
  })));
  assert.match(html, /data-abrir="1003"/, 'faltou o botão de abrir/espiar');
  assert.match(html, /data-aceitar="1003"/, 'faltou o botão de aceitar');
  assert.match(html, /data-transferir="1003"/, 'faltou o botão de transferir');
  assert.ok(html.includes('Espiar'), 'na fila o olho tem de dizer «Espiar»');
});

medir('⭐ e o cartão de conversa JÁ ATRIBUÍDA não oferece «Aceitar» (não há o que aceitar)', () => {
  const html = semMarcas(renderToString(React.createElement(CartaoDeConversa, {
    conversa: CONVERSA, aba: 'abertas', aoAbrir: () => {}, aoAceitar: () => {},
  })));
  assert.ok(!/data-aceitar=/.test(html), 'ofereceu aceitar numa conversa que já tem dono');
  assert.match(html, /data-abrir="1001"/);
  assert.ok(html.includes('Abrir'), 'fora da fila o botão tem de dizer «Abrir», não «Espiar»');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${medicoes - falhas}/${medicoes} medições passaram`);
if (falhas > 0) process.exit(1);
