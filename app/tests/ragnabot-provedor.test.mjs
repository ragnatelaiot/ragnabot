#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A CAMADA DE PROVEDOR DE CANAL — contrato S6 (02/09/2026), doc 34 §F9.2.2
//
// A EXIGÊNCIA DO CONTRATO, palavra por palavra: *"A camada de provedor não pode vazar para o
// motor: trocar o provedor de um canal não pode exigir mudança no motor de fluxo nem no
// adaptador."* Este arquivo tenta REPROVAR isso por dois caminhos independentes:
//
//   ESTÁTICO   — varre o motor, os nós, a fila e o adaptador atrás dos nomes dos provedores.
//                Um `if (provedor === 'whatsmeow')` escondido em qualquer um deles reprova aqui.
//   DINÂMICO   — muda o provedor de uma conexão NO BANCO (dublê) e mede o comportamento do
//                despacho mudando SOZINHO, com zero linha de código tocada entre uma medição e a
//                seguinte. É a prova de que a troca é dado, não código.
//
// COMO RODAR:  node tests/ragnabot-provedor.test.mjs
// CÓDIGOS:     0 = verde · 1 = alguma verificação reprovou
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const prov = await import('../src/services/ragnabot-provedor.service.js');
const canal = await import('../src/services/ragnabot-canal.porta.js');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) O CATÁLOGO — quem opera o quê');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('os três provedores do documento existem, e o quarto (`nativo`) está declarado', () => {
  for (const id of ['meta_direto', 'whatsmeow', 'terceiro']) {
    assert.ok(prov.provedorExiste(id), `faltou o provedor "${id}" do doc 34 §F9.2.2`);
  }
  assert.ok(prov.provedorExiste('nativo'), 'faltou `nativo` — o canal sem terceiro no caminho');
});

await medir('cada canal ganha um provedor padrão, e ele NUNCA é nulo', () => {
  for (const c of ['whatsapp', 'instagram', 'facebook', 'web_widget', 'email', 'telegram', 'api', 'canal_que_nao_existe']) {
    const p = prov.provedorPadraoDoCanal(c);
    assert.ok(p, `canal "${c}" ficou sem padrão`);
    assert.ok(prov.provedorExiste(p), `padrão de "${c}" é um provedor inexistente: ${p}`);
  }
});

await medir('WhatsApp/Instagram/Facebook nascem em `meta_direto`; site/e-mail/Telegram em `nativo`', () => {
  assert.equal(prov.provedorPadraoDoCanal('whatsapp'), 'meta_direto');
  assert.equal(prov.provedorPadraoDoCanal('instagram'), 'meta_direto');
  assert.equal(prov.provedorPadraoDoCanal('facebook'), 'meta_direto');
  assert.equal(prov.provedorPadraoDoCanal('web_widget'), 'nativo');
  assert.equal(prov.provedorPadraoDoCanal('email'), 'nativo');
  assert.equal(prov.provedorPadraoDoCanal('telegram'), 'nativo');
});

await medir('combinação impossível é RECUSADA com o motivo escrito, não com "inválido"', () => {
  const r = prov.combina('web_widget', 'whatsmeow');
  assert.equal(r.permitido, false);
  assert.match(r.motivo, /não opera o canal/u);
  assert.match(r.motivo, /whatsapp/u, 'a recusa tem de dizer o que o provedor OPERA');
});

await medir('provedor desconhecido lista os conhecidos na recusa', () => {
  const r = prov.combina('whatsapp', 'provedor_inventado');
  assert.equal(r.permitido, false);
  assert.match(r.motivo, /Conhecidos:/u);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) A COMPOSIÇÃO DA CAPACIDADE — restritiva, nunca expansiva');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('a FORMA do resultado é idêntica à de `CAPACIDADES[canal]` — é o que cega o motor', () => {
  const base = canal.capacidadeDoCanal('whatsapp');
  const efetiva = prov.capacidadeEfetiva('whatsapp', 'meta_direto');
  assert.deepEqual(Object.keys(efetiva).sort(), Object.keys(base).sort());
});

await medir('`meta_direto` NÃO tira nada do WhatsApp: 3 botões, lista, anexo e template', () => {
  const c = prov.capacidadeEfetiva('whatsapp', 'meta_direto');
  assert.equal(c.interativo, true);
  assert.equal(c.botoesMax, 3);
  assert.equal(c.template, true);
});

await medir('`whatsmeow` TIRA o modelo aprovado e o interativo (pior caso declarado)', () => {
  const c = prov.capacidadeEfetiva('whatsapp', 'whatsmeow');
  assert.equal(c.template, false, 'HSM não existe fora da Cloud API');
  assert.equal(c.interativo, false);
  assert.equal(c.botoesMax, 0, 'sem interativo, botão tem de ser 0 — estado incoerente confunde o diagnóstico');
  assert.equal(c.listaMax, 0);
  assert.equal(c.anexo, true, 'anexo continua: a sessão manda mídia');
});

await medir('provedor NÃO PODE AMPLIAR capacidade — nem por engano de cadastro', () => {
  // O Telegram não desenha botão pela nossa tabela de canal. Nenhum provedor pode inventar isso.
  for (const id of prov.IDS_DE_PROVEDOR) {
    if (!prov.provedor(id).canais.includes('telegram')) continue;
    const c = prov.capacidadeEfetiva('telegram', id);
    assert.equal(c.interativo, false, `o provedor "${id}" ampliou a capacidade do Telegram`);
    assert.equal(c.template, false);
  }
});

await medir('provedor incoerente com o canal NÃO lança: degrada para o padrão e AVISA', () => {
  const avisos = [];
  const c = prov.capacidadeEfetiva('email', 'whatsmeow', { avisar: (m) => avisos.push(m) });
  assert.equal(avisos.length, 1, 'a degradação tem de gritar no log');
  assert.match(avisos[0], /não opera o canal/u);
  // e o resultado é o do padrão do canal (`nativo`), não uma exceção no meio de um atendimento
  assert.deepEqual(c, prov.capacidadeEfetiva('email', 'nativo'));
});

await medir('`resumirCapacidade` fala português, e diz o que muda', () => {
  const oficial = prov.resumirCapacidade('whatsapp', 'meta_direto');
  const sessao = prov.resumirCapacidade('whatsapp', 'whatsmeow');
  assert.match(oficial, /botão/u);
  assert.match(sessao, /texto numerado/u);
  assert.notEqual(oficial, sessao);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) ⭐ O PROVEDOR NÃO VAZA — varredura ESTÁTICA do motor, dos nós, da fila e do adaptador');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ⚠️ Esta é a prova que o contrato pediu, e ela é a mais fácil de quebrar sem perceber: basta
// alguém "resolver rápido" um caso de Whatsmeow com um `if` no despacho. A partir daí a camada
// deixa de valer e ninguém fica sabendo.
const ARQUIVOS_QUE_NAO_PODEM_SABER = [
  'src/services/ragnabot-fluxo-motor.service.js',
  'src/services/ragnabot-fluxo-nos.service.js',
  'src/services/ragnabot-fluxo-fila.service.js',
  'src/services/ragnabot-fluxo-publicacao.service.js',
  'src/services/ragnabot-portaria.service.js',
  'src/services/ragnabot-atend-despertar.service.js',
];
const NOMES_DE_PROVEDOR = ['whatsmeow', 'meta_direto', "'terceiro'", 'oficialapi', 'connectai'];

await medir('nenhum arquivo do MOTOR menciona um provedor pelo nome', () => {
  const sujos = [];
  for (const rel of ARQUIVOS_QUE_NAO_PODEM_SABER) {
    const caminho = path.join(RAIZ, rel);
    if (!fs.existsSync(caminho)) continue;
    const texto = fs.readFileSync(caminho, 'utf8').toLowerCase();
    for (const nome of NOMES_DE_PROVEDOR) {
      if (texto.includes(nome.toLowerCase())) sujos.push(`${rel} → "${nome}"`);
    }
  }
  assert.deepEqual(sujos, [], `o provedor VAZOU para o motor:\n      ${sujos.join('\n      ')}`);
});

await medir('o ADAPTADOR não ramifica por provedor — só compõe a capacidade', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'src/services/ragnabot-canal.porta.js'), 'utf8');
  // As duas únicas menções permitidas: a importação da camada e a chamada de composição.
  const linhasComCodigo = texto.split('\n').filter((l) => {
    const t = l.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
    return /provedor/iu.test(t);
  });
  for (const l of linhasComCodigo) {
    assert.ok(
      !/\bif\s*\(/u.test(l) && !/===\s*['"](meta_direto|whatsmeow|terceiro|nativo)['"]/u.test(l)
      && !/switch/u.test(l),
      `o adaptador ramificou por provedor: ${l.trim()}`,
    );
  }
  assert.ok(linhasComCodigo.length > 0, 'o adaptador deveria ao menos compor a capacidade');
});

await medir('o nome "provedor" NÃO aparece em nenhum dos catorze despachos do adaptador', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'src/services/ragnabot-canal.porta.js'), 'utf8');
  const inicio = texto.indexOf('OS DESPACHOS, UM POR TIPO DE INTENÇÃO');
  const fim = texto.indexOf('TIPOS_DESPACHAVEIS');
  assert.ok(inicio > 0 && fim > inicio, 'não achei o bloco dos despachos — o teste precisa ser reajustado');
  const bloco = texto.slice(inicio, fim);
  const linhas = bloco.split('\n').filter((l) => {
    const t = l.trim();
    if (!t || t.startsWith('//') || t.startsWith('*')) return false;
    return /provedor/iu.test(t);
  });
  assert.deepEqual(linhas, [], `despacho consultando provedor:\n      ${linhas.join('\n      ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ⭐ TROCA DE PROVEDOR SEM TOCAR EM CÓDIGO — a prova dinâmica');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Um dublê que devolve a caixa do "banco". Trocar o provedor aqui é o equivalente exato a um
// `UPDATE "RagnabotInbox" SET provedor = …` — nada mais muda entre as duas medições abaixo.
function montarDuble(provedorDaCaixa) {
  const registro = { mensagens: [], interativos: [] };
  return {
    registro,
    chatwoot: {
      caixaDaConversa: async () => ({
        tenantId: 'empresa-1', cwInboxId: 34, channelType: 'whatsapp',
        nome: 'WhatsApp da empresa', identificador: '+5598000000000',
        phoneNumberId: '000', provedor: provedorDaCaixa,
      }),
      enviarMensagem: async (d) => { registro.mensagens.push(d); return { id: 1 }; },
      enviarInterativo: async (d) => { registro.interativos.push(d); return { id: 2 }; },
      lerConversa: async () => ({ status: 'open' }),
    },
  };
}

// O tipo e os campos são os do contrato do adaptador (`DESPACHOS.botoes` → `despacharEscolha`),
// lidos no código, não inventados: `botoes` é a lista, não `itens`.
const INTENCAO_MENU = Object.freeze({
  tipo: 'botoes',
  corpo: 'Como posso ajudar?',
  botoes: [{ id: 'a', titulo: 'Suporte' }, { id: 'b', titulo: 'Financeiro' }],
});

async function despacharCom(provedorDaCaixa, sufixo) {
  const d = montarDuble(provedorDaCaixa);
  const originais = canal.portasDoCanal();
  canal.configurarCanal({ chatwoot: d.chatwoot, log: { info() {}, warn() {}, error() {}, debug() {} } });
  canal.esquecerCanais();
  canal.esquecerEnvios();
  try {
    const porta = await canal.portaCanalDa({ tenantId: 'empresa-1', cwAccountId: 1, cwConversationId: 900 });
    await porta.enviar({ ...INTENCAO_MENU, chaveEfeito: `chave-${sufixo}` }, {});
    return { porta, registro: d.registro };
  } finally {
    canal.configurarCanal(originais);
    canal.esquecerCanais();
    canal.esquecerEnvios();
  }
}

const comMeta = await despacharCom('meta_direto', 'meta');
const comSessao = await despacharCom('whatsmeow', 'sessao');

await medir('com `meta_direto` o menu sai como INTERATIVO (botões de verdade)', () => {
  assert.equal(comMeta.registro.interativos.length, 1, 'deveria ter usado o caminho interativo');
  assert.equal(comMeta.registro.mensagens.length, 0);
  assert.equal(comMeta.porta.capacidade.interativo, true);
});

await medir('⭐ trocando SÓ o dado, o MESMO menu vira texto numerado — zero linha de código mudou', () => {
  assert.equal(comSessao.registro.interativos.length, 0, 'não podia mandar interativo por sessão');
  assert.equal(comSessao.registro.mensagens.length, 1, 'deveria ter degradado para texto');
  const texto = comSessao.registro.mensagens[0].texto || comSessao.registro.mensagens[0].content || '';
  assert.match(texto, /1/u);
  assert.match(texto, /Suporte/u);
  assert.match(texto, /Financeiro/u);
});

await medir('a degradação é DECLARADA na porta, não adivinhada pelo motor', () => {
  assert.equal(comSessao.porta.capacidade.interativo, false);
  assert.equal(comSessao.porta.canal.provedor, 'whatsmeow', 'a porta tem de saber quem opera — para o log');
});

await medir('caixa SEM provedor no cadastro cai no padrão do canal (linha legada não quebra)', async () => {
  const r = await despacharCom(null, 'sem-provedor');
  assert.equal(r.porta.canal.provedor, 'meta_direto');
  assert.equal(r.registro.interativos.length, 1);
});

await medir('caixa com provedor ESTRAGADO no cadastro degrada, não derruba o atendimento', async () => {
  const r = await despacharCom('provedor_que_nao_existe', 'estragado');
  assert.equal(r.porta.canal.provedor, 'meta_direto', 'tinha de cair no padrão do canal');
  assert.equal(r.registro.interativos.length + r.registro.mensagens.length, 1, 'a mensagem tinha de sair de qualquer jeito');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) O CATÁLOGO PARA A TELA');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('o WhatsApp oferece os três caminhos do doc 34 §F9, e só um é o padrão', () => {
  const opcoes = prov.opcoesParaCanal('whatsapp');
  const ids = opcoes.map((o) => o.id).sort();
  assert.deepEqual(ids, ['meta_direto', 'terceiro', 'whatsmeow']);
  assert.equal(opcoes.filter((o) => o.padrao).length, 1);
  assert.equal(opcoes.find((o) => o.padrao).id, 'meta_direto');
});

await medir('o intermediário vem MARCADO como contrário à decisão registrada do dono', () => {
  const t = prov.opcoesParaCanal('whatsapp').find((o) => o.id === 'terceiro');
  assert.equal(t.contraDecisaoRegistrada, true);
  assert.equal(t.oficial, false);
});

await medir('capacidade que veio de LEITURA e não de medição está declarada como tal', () => {
  assert.equal(prov.provedor('whatsmeow').origem, 'documentacao');
  assert.equal(prov.provedor('terceiro').origem, 'documentacao');
  assert.equal(prov.provedor('meta_direto').origem, 'medido');
});

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
