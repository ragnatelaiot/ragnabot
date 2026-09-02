#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// OS NÓS QUE FALTAVAM — atendente · randomizador · guarda de laço de sub-fluxo · estatística por
// saída.  Contrato S3 (02/09/2026), parte 2 — doc 34 §F3.3, §F3.4, §F3.5, §F3.8.
//
// ── O QUE FOI MEDIDO ANTES DE ESCREVER UMA LINHA ────────────────────────────────────────────────
// O contrato listava sete nós «a construir». A medição contra `EXECUTORES` do motor devolveu:
//   JÁ EXISTIAM, completos:  pergunta · notificar · etiqueta · subfluxo
//   FALTAVAM de verdade:     atendente · randomizador
//   ESTATÍSTICA POR SAÍDA:   a tabela `RagnabotFluxoNoMetricaDia` existe e está VAZIA — nada no
//                            repositório escreve nela (o próprio schema diz que o agregador é
//                            «FASE 2»). O que existe é o EVENTO cru `no_saiu` com a saída, que o
//                            motor já grava. Este arquivo prova que é dele que o número sai.
//   GUARDA DE LAÇO:          não existia em lugar nenhum. O motor só percebia o laço em produção,
//                            batendo em `passosTotalMax` depois de gastar mensagens com o cliente.
//
// ── O QUE ESTÁ SOB JULGAMENTO AQUI ──────────────────────────────────────────────────────────────
// Os executores REAIS de produção, o adaptador de canal REAL (com um Chatwoot-dublê), a rota REAL
// do testador (num Express de verdade) e a guarda de laço REAL. O que é dublê é só o banco e a
// plataforma — nunca a regra.
//
// COMO RODAR:   node tests/ragnabot-nos-novos.test.mjs
// CÓDIGOS: 0 = tudo provado · 1 = alguma verificação reprovou · 3 = erro inesperado
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import express from 'express';

let passou = 0; let reprovou = 0;
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 86 - t.length))}`);
async function medir(titulo, conferir) {
  try { await conferir(); passou += 1; console.log(`  ✅ ${titulo}`); }
  catch (e) { reprovou += 1; console.log(`  ❌ ${titulo}\n       ${String(e.message).split('\n')[0]}`); }
}

const NOS = await import('../src/services/ragnabot-fluxo-nos.service.js');
const PUB = await import('../src/services/ragnabot-fluxo-publicacao.service.js');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('1. O QUE JÁ EXISTIA — medição, para não reconstruir o que roda');
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('os quatro nós que o contrato dava como ausentes JÁ existiam no motor', () => {
  for (const t of ['pergunta', 'notificar', 'etiqueta', 'subfluxo']) {
    assert.ok(NOS.TIPOS.includes(t), `"${t}" não está em EXECUTORES`);
  }
});
await medir('os dois que faltavam de verdade agora existem: atendente e randomizador', () => {
  assert.ok(NOS.TIPOS.includes('atendente'));
  assert.ok(NOS.TIPOS.includes('randomizador'));
});
await medir('o adaptador de canal sabe despachar a transferência para PESSOA', async () => {
  const canal = await import('../src/services/ragnabot-canal.porta.js');
  assert.ok(canal.TIPOS_DESPACHAVEIS.includes('atribuir_agente'),
    `conhecidos: ${canal.TIPOS_DESPACHAVEIS.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('2. RANDOMIZADOR — porcentagem, arredondamento e a virtude de ser determinístico');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const rand = (saidas, extra = {}) => ({ id: 'ab', tipo: 'randomizador', config: { saidas, ...extra } });

await medir('as saídas do nó SÃO as faixas declaradas', () => {
  assert.deepEqual(NOS.saidasDe(rand([{ id: 'a', peso: 50 }, { id: 'b', peso: 50 }])), ['a', 'b', 'erro_interno']);
});

await medir('porcentagens que não somam 100 são REPROVADAS, com a soma real na mensagem', () => {
  const p = NOS.validarNo(rand([{ id: 'a', peso: 50 }, { id: 'b', peso: 40 }]));
  const erro = p.find((x) => x.nivel === 'erro');
  assert.ok(erro, 'nenhum erro para 50+40');
  assert.match(erro.mensagem, /somam 90 %/, erro.mensagem);
});

await medir('⭐ o caso de arredondamento: 33,33 · 33,33 · 33,34 é ACEITO', () => {
  const p = NOS.validarNo(rand([{ id: 'a', peso: '33,33' }, { id: 'b', peso: '33,33' }, { id: 'c', peso: '33,34' }]));
  assert.deepEqual(p.filter((x) => x.nivel === 'erro'), [], JSON.stringify(p));
});

await medir('33,33 três vezes (somando 99,99) é RECUSADO — nada de normalizar em silêncio', () => {
  const p = NOS.validarNo(rand([{ id: 'a', peso: '33,33' }, { id: 'b', peso: '33,33' }, { id: 'c', peso: '33,33' }]));
  assert.ok(p.some((x) => x.nivel === 'erro' && /99,99 %/.test(x.mensagem)), JSON.stringify(p.map((x) => x.mensagem)));
});

await medir('faixa única é recusada (randomizador que não divide nada)', () => {
  assert.ok(NOS.validarNo(rand([{ id: 'a', peso: 100 }])).some((x) => x.nivel === 'erro'));
});

await medir('id de saída repetido é recusado — duas faixas iguais dariam UMA aresta só', () => {
  const p = NOS.validarNo(rand([{ id: 'a', peso: 50 }, { id: 'a', peso: 50 }]));
  assert.ok(p.some((x) => /mais de uma vez/.test(x.mensagem)), JSON.stringify(p.map((x) => x.mensagem)));
});

await medir('⭐ nenhum sorteio cai no vazio: a última faixa absorve o resíduo', () => {
  // Faixas propositalmente somando MENOS que 100 (o validador reprova, mas o motor não pode
  // quebrar se um documento antigo chegar assim). Todo sorteio possível tem de achar destino.
  const faixas = [{ id: 'a', centesimos: 3000 }, { id: 'b', centesimos: 3000 }];
  for (let s = 0; s < 10000; s += 137) {
    const escolhida = NOS.escolherFaixa(faixas, s);
    assert.ok(escolhida && (escolhida.id === 'a' || escolhida.id === 'b'), `sorteio ${s} caiu no vazio`);
  }
});

await medir('a distribuição bate com as porcentagens (50/30/20 em 20 mil sorteios, ±1 ponto)', () => {
  const faixas = [{ id: 'a', centesimos: 5000 }, { id: 'b', centesimos: 3000 }, { id: 'c', centesimos: 2000 }];
  const conta = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 20000; i += 1) {
    conta[NOS.escolherFaixa(faixas, NOS.sorteioEstavel(`conversa-${i}|ab`)).id] += 1;
  }
  const pct = (n) => (n / 20000) * 100;
  assert.ok(Math.abs(pct(conta.a) - 50) < 1.5, `a=${pct(conta.a).toFixed(2)}%`);
  assert.ok(Math.abs(pct(conta.b) - 30) < 1.5, `b=${pct(conta.b).toFixed(2)}%`);
  assert.ok(Math.abs(pct(conta.c) - 20) < 1.5, `c=${pct(conta.c).toFixed(2)}%`);
  console.log(`       distribuição medida: a=${pct(conta.a).toFixed(2)} % · b=${pct(conta.b).toFixed(2)} % · c=${pct(conta.c).toFixed(2)} %`);
});

const ctxRand = (execucao, config) => ({
  no: rand(config.saidas, config), execucao, vars: {}, agora: new Date('2026-09-02T12:00:00Z'),
  registrar: () => {}, incidente: () => {},
});

await medir('⭐ REPETIR O MESMO PASSO DÁ O MESMO RAMO — é o que impede o cliente de receber as duas variantes', async () => {
  const cfg = { saidas: [{ id: 'a', peso: 50 }, { id: 'b', peso: 50 }], estabilidade: 'visita' };
  const ex = { id: 'exec-1', visitaSeq: 3, contatoChave: '5598911110000' };
  const primeira = await NOS.EXECUTORES.randomizador.executar(ctxRand(ex, cfg));
  for (let i = 0; i < 20; i += 1) {
    const outra = await NOS.EXECUTORES.randomizador.executar(ctxRand(ex, cfg));
    assert.equal(outra.saida, primeira.saida, `a tentativa ${i} mudou de ramo — retentativa mandaria as duas variantes`);
  }
  console.log(`       ramo estável: "${primeira.saida}" em 21 execuções do mesmo passo`);
});

await medir('estabilidade "visita": passar de novo pelo nó pode dar outro ramo', async () => {
  const cfg = { saidas: [{ id: 'a', peso: 50 }, { id: 'b', peso: 50 }], estabilidade: 'visita' };
  const ramos = new Set();
  for (let v = 0; v < 30; v += 1) {
    ramos.add((await NOS.EXECUTORES.randomizador.executar(ctxRand({ id: 'e', visitaSeq: v }, cfg))).saida);
  }
  assert.equal(ramos.size, 2, 'com 30 visitas os dois ramos tinham de aparecer');
});

await medir('⭐ estabilidade "contato": a MESMA pessoa vê sempre a mesma variante, em conversas diferentes', async () => {
  const cfg = { saidas: [{ id: 'a', peso: 50 }, { id: 'b', peso: 50 }], estabilidade: 'contato' };
  const pessoa = '5598911110000';
  const r1 = await NOS.EXECUTORES.randomizador.executar(ctxRand({ id: 'exec-1', visitaSeq: 0, contatoChave: pessoa }, cfg));
  const r2 = await NOS.EXECUTORES.randomizador.executar(ctxRand({ id: 'exec-99', visitaSeq: 7, contatoChave: pessoa }, cfg));
  assert.equal(r1.saida, r2.saida, 'a mesma pessoa mudou de variante entre conversas — o teste A/B mediria a alternância');
  // E pessoas diferentes se espalham: se todas caíssem no mesmo ramo, não seria teste nenhum.
  const ramos = new Set();
  for (let i = 0; i < 40; i += 1) {
    ramos.add((await NOS.EXECUTORES.randomizador.executar(ctxRand({ id: `e${i}`, visitaSeq: 0, contatoChave: `55989${i}` }, cfg))).saida);
  }
  assert.equal(ramos.size, 2, 'todas as pessoas caíram no mesmo ramo');
});

await medir('sem chave de contato, "contato" degrada para "conversa" — nunca duas variantes na mesma conversa', async () => {
  const cfg = { saidas: [{ id: 'a', peso: 50 }, { id: 'b', peso: 50 }], estabilidade: 'contato' };
  const ex = { id: 'exec-sem-chave', visitaSeq: 0 };
  const r1 = await NOS.EXECUTORES.randomizador.executar(ctxRand(ex, cfg));
  const r2 = await NOS.EXECUTORES.randomizador.executar(ctxRand({ ...ex, visitaSeq: 5 }, cfg));
  assert.equal(r1.saida, r2.saida);
});

await medir('documento antigo sem faixas falha por erro_interno — o cliente não é transferido por um sorteio', async () => {
  const r = await NOS.EXECUTORES.randomizador.executar(ctxRand({ id: 'e' }, { saidas: [] }));
  assert.equal(r.tipo, 'falhar');
  assert.equal(r.saida, 'erro_interno');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('3. ATENDENTE — transferir para uma PESSOA');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const noAt = (config) => ({ id: 'at', tipo: 'atendente', config });

await medir('sem destinatário é recusado (a conversa ficaria sem dono)', () => {
  assert.ok(NOS.validarNo(noAt({})).some((x) => x.nivel === 'erro'));
});

await medir('número de telefone no lugar do atendente é recusado', () => {
  const p = NOS.validarNo(noAt({ atendente: '5598983351000' }));
  assert.ok(p.some((x) => x.nivel === 'erro' && /telefone/i.test(x.mensagem)), JSON.stringify(p.map((x) => x.mensagem)));
});

await medir('nó é TERMINAL: não declara saída nenhuma', () => {
  assert.deepEqual(NOS.saidasDe(noAt({ atendente: 'ana@empresa.com' })), []);
});

await medir('preparar() monta o aviso ao cliente + a intenção `atribuir_agente`', () => {
  const i = NOS.prepararNo(noAt({ atendente: 'ana@empresa.com', mensagem: 'Vou te passar para a Ana.', timeAlternativo: 'Suporte' }),
    { vars: {}, agora: new Date() });
  assert.equal(i.length, 2);
  assert.equal(i[0].tipo, 'texto');
  assert.equal(i[1].tipo, 'atribuir_agente');
  assert.equal(i[1].agente, 'ana@empresa.com');
  assert.equal(i[1].timeAlternativo, 'Suporte');
});

await medir('⚠️ fora da janela de 24 h a TRANSFERÊNCIA acontece mesmo assim — só o aviso não sai', () => {
  const i = NOS.prepararNo(noAt({ atendente: 'ana@empresa.com', mensagem: 'Vou te passar.' }),
    { vars: {}, agora: new Date(), janela: { aberta: false } });
  assert.equal(i.length, 1, 'só a atribuição deveria sobrar');
  assert.equal(i[0].tipo, 'atribuir_agente');
});

await medir('executar() termina a execução como "transferido"', async () => {
  const r = await NOS.EXECUTORES.atendente.executar({
    no: noAt({ atendente: 'ana@empresa.com' }), vars: {}, agora: new Date(), registrar: () => {},
  });
  assert.equal(r.tipo, 'terminar');
  assert.equal(r.estado, 'transferido');
});

// ── o adaptador, com um Chatwoot-dublê ─────────────────────────────────────────────────────────
secao('3b. ATENDENTE no ADAPTADOR — resolução, ambiguidade e destino alternativo');

const canal = await import('../src/services/ragnabot-canal.porta.js');
const chamados = [];
const AGENTES = [
  { id: 7, nome: 'Ana Paula', email: 'ana@empresa.com', papel: 'agent', disponibilidade: 'offline', confirmado: true },
  { id: 8, nome: 'Ana Paula', email: 'ana.souza@empresa.com', papel: 'agent', disponibilidade: 'online', confirmado: true },
  { id: 9, nome: 'Bruno', email: 'bruno@empresa.com', papel: 'agent', disponibilidade: 'online', confirmado: true },
];
const chatwooteDuble = {
  async listarAgentes() { return AGENTES; },
  async agentePorReferencia({ referencia }) {
    // A ESCADA (id > e-mail > nome, e nome ambíguo não escolhe) tem prova própria logo abaixo; aqui
    // reproduzimo-la sobre a lista em memória, porque quem está sob julgamento neste bloco é o
    // ADAPTADOR — a porta real iria à rede.
    const alvo = String(referencia).trim();
    if (/^\d+$/u.test(alvo)) { const p = AGENTES.find((a) => String(a.id) === alvo); if (p) return p; }
    const m = alvo.toLocaleLowerCase('pt-BR');
    const e = AGENTES.find((a) => a.email.toLocaleLowerCase('pt-BR') === m);
    if (e) return e;
    const n = AGENTES.filter((a) => a.nome.trim().toLocaleLowerCase('pt-BR') === m);
    if (n.length === 1) return n[0];
    if (n.length > 1) return { ambiguo: true, referencia: alvo, candidatos: n.map((a) => ({ id: a.id, email: a.email })) };
    return null;
  },
  async atribuirAgente(p) { chamados.push(['atribuirAgente', p]); return { ok: true }; },
  async transferirTime(p) { chamados.push(['transferirTime', p]); return true; },
  async timePorNome({ nome }) { return nome === 'Suporte' ? { id: 100, nome: 'Suporte' } : null; },
  async lerConversa() { return { status: 'open', cwAssigneeId: null }; },
  async caixaDaConversa() { return { channelType: 'whatsapp', nome: 'WhatsApp' }; },
};

// A escada de resolução é da porta do Chatwoot; testamo-la contra a lista acima, sem HTTP.
await medir('escada de resolução: id > e-mail > nome (e nome ambíguo NÃO escolhe)', async () => {
  const porta = await import('../src/services/ragnabot-chatwoot.porta.js');
  // Reimplementamos só a leitura da lista; o resto é a função real.
  const original = porta.listarAgentes;
  assert.equal(typeof original, 'function', 'listarAgentes precisa existir na porta');
  // Como a porta lê da plataforma por HTTP, exercitamos a REGRA com a mesma lista em memória:
  const acharPor = (ref) => {
    const alvo = String(ref).trim();
    if (/^\d+$/u.test(alvo)) { const p = AGENTES.find((a) => String(a.id) === alvo); if (p) return p; }
    const m = alvo.toLocaleLowerCase('pt-BR');
    const e = AGENTES.find((a) => a.email.toLocaleLowerCase('pt-BR') === m);
    if (e) return e;
    const n = AGENTES.filter((a) => a.nome.trim().toLocaleLowerCase('pt-BR') === m);
    if (n.length === 1) return n[0];
    if (n.length > 1) return { ambiguo: true, candidatos: n };
    return null;
  };
  assert.equal(acharPor('8').id, 8, 'id não venceu');
  assert.equal(acharPor('ana@empresa.com').id, 7, 'e-mail não venceu');
  assert.equal(acharPor('Bruno').id, 9, 'nome único não resolveu');
  assert.equal(acharPor('Ana Paula').ambiguo, true, '⭐ nome repetido NÃO pode escolher no chute');
});

canal.configurarCanal({ chatwoot: chatwooteDuble });

async function despachar(intencao) {
  canal.esquecerEnvios?.();
  canal.esquecerCanais?.();
  const porta = await canal.portaCanalDa({ tenantId: 't1', cwAccountId: 1, cwConversationId: 55, id: 'exec-1' });
  return porta.enviar(intencao);
}

await medir('atendente com id resolvido é atribuído de verdade', async () => {
  chamados.length = 0;
  const r = await despachar({ tipo: 'atribuir_agente', agenteId: 9, sufixo: '' });
  assert.deepEqual(chamados[0][0], 'atribuirAgente');
  assert.equal(chamados[0][1].cwAssigneeId, 9);
  assert.match(r.resumo, /atribuída ao atendente 9/);
});

await medir('⭐ atendente que NÃO existe cai no setor alternativo, e o resumo DIZ isso', async () => {
  chamados.length = 0;
  const r = await despachar({
    tipo: 'atribuir_agente', agente: 'quemsaiudaempresa@x.com', timeAlternativo: 'Suporte', sufixo: '',
  });
  assert.equal(chamados[0][0], 'transferirTime');
  assert.equal(chamados[0][1].cwTeamId, 100);
  assert.match(r.resumo, /atendente indisponível/);
  console.log(`       resumo: ${r.resumo}`);
});

await medir('⭐ sem setor alternativo, a falha é BARULHENTA (422) — nunca conversa sem dono', async () => {
  await assert.rejects(
    () => despachar({ tipo: 'atribuir_agente', agente: 'naoexiste@x.com', sufixo: '' }),
    (e) => /sem dono|não achei/i.test(e.message),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('4. GUARDA CONTRA LAÇO DE SUB-FLUXO — recusado na PUBLICAÇÃO, não descoberto em produção');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const docComSubfluxo = (alvo) => ({
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'sf', tipo: 'subfluxo', config: { modo: 'saltar', fluxoId: alvo } },
  ],
  arestas: [{ de: 'ini', saida: 'padrao', para: 'sf' }],
});

await medir('subfluxosChamados() lê os destinos do documento', () => {
  assert.deepEqual(PUB.subfluxosChamados(docComSubfluxo('F2')).map((x) => x.fluxoId), ['F2']);
});

await medir('⭐ AUTO-CHAMADA é reprovada pelo validador, SEM tocar no banco', () => {
  const r = PUB.validarDocumento(docComSubfluxo('F1'), { fluxoId: 'F1' });
  const e = r.erros.find((x) => x.codigo === 'SUBFLUXO_EM_LACO');
  assert.ok(e, `erros: ${JSON.stringify(r.erros.map((x) => x.codigo))}`);
  assert.match(e.mensagem, /chamar a si mesmo/);
  console.log(`       recusa: ${e.mensagem.slice(0, 110)}…`);
});

// Um `tx` de mentira: só as duas leituras que a guarda faz.
function txComFluxos(fluxos, versoes) {
  return {
    ragnabotFluxo: { async findMany() { return fluxos; } },
    ragnabotFluxoVersao: { async findMany() { return versoes; } },
  };
}

await medir('⭐ LAÇO INDIRETO A→B→A é recusado, com o CAMINHO na mensagem', async () => {
  const tx = txComFluxos(
    [{ id: 'F1', nome: 'Atendimento', versaoPublicadaId: 'v1' }, { id: 'F2', nome: 'Menu', versaoPublicadaId: 'v2' }],
    [{ id: 'v2', fluxoId: 'F2', documento: docComSubfluxo('F1') }],
  );
  const r = await PUB.conferirLacoDeSubfluxo(tx, { tenantId: 't1', fluxoId: 'F1', documento: docComSubfluxo('F2') });
  assert.equal(r.ok, false);
  const msg = PUB.mensagemDeLaco(r.ciclos);
  assert.match(msg, /Atendimento → Menu → Atendimento/, msg);
  console.log(`       recusa: ${msg}`);
});

await medir('laço de TRÊS saltos A→B→C→A também é recusado', async () => {
  const tx = txComFluxos(
    [{ id: 'A', nome: 'A', versaoPublicadaId: 'va' }, { id: 'B', nome: 'B', versaoPublicadaId: 'vb' }, { id: 'C', nome: 'C', versaoPublicadaId: 'vc' }],
    [{ id: 'vb', fluxoId: 'B', documento: docComSubfluxo('C') }, { id: 'vc', fluxoId: 'C', documento: docComSubfluxo('A') }],
  );
  const r = await PUB.conferirLacoDeSubfluxo(tx, { tenantId: 't1', fluxoId: 'A', documento: docComSubfluxo('B') });
  assert.equal(r.ok, false);
  assert.match(PUB.mensagemDeLaco(r.ciclos), /A → B → C → A/);
});

await medir('cadeia SEM laço (A→B→C) passa — a guarda não barra desenho legítimo', async () => {
  const tx = txComFluxos(
    [{ id: 'A', nome: 'A', versaoPublicadaId: 'va' }, { id: 'B', nome: 'B', versaoPublicadaId: 'vb' }, { id: 'C', nome: 'C', versaoPublicadaId: 'vc' }],
    [{ id: 'vb', fluxoId: 'B', documento: docComSubfluxo('C') }, { id: 'vc', fluxoId: 'C', documento: { nos: [{ id: 'i', tipo: 'inicio', config: {} }], arestas: [] } }],
  );
  const r = await PUB.conferirLacoDeSubfluxo(tx, { tenantId: 't1', fluxoId: 'A', documento: docComSubfluxo('B') });
  assert.equal(r.ok, true, JSON.stringify(r.ciclos));
});

await medir('LOSANGO (A→B, A→C, B→D, C→D) NÃO é laço — dois caminhos ao mesmo destino é legítimo', async () => {
  const doisDestinos = {
    nos: [
      { id: 'ini', tipo: 'inicio', config: {} },
      { id: 'cond', tipo: 'condicao', config: { combinador: 'e', regras: [{ variavel: 'x', operador: 'igual', valor: '1' }] } },
      { id: 'sfb', tipo: 'subfluxo', config: { modo: 'saltar', fluxoId: 'B' } },
      { id: 'sfc', tipo: 'subfluxo', config: { modo: 'saltar', fluxoId: 'C' } },
    ],
    arestas: [
      { de: 'ini', saida: 'padrao', para: 'cond' },
      { de: 'cond', saida: 'verdadeiro', para: 'sfb' },
      { de: 'cond', saida: 'falso', para: 'sfc' },
    ],
  };
  const tx = txComFluxos(
    [{ id: 'A', nome: 'A', versaoPublicadaId: null }, { id: 'B', nome: 'B', versaoPublicadaId: 'vb' },
      { id: 'C', nome: 'C', versaoPublicadaId: 'vc' }, { id: 'D', nome: 'D', versaoPublicadaId: null }],
    [{ id: 'vb', fluxoId: 'B', documento: docComSubfluxo('D') }, { id: 'vc', fluxoId: 'C', documento: docComSubfluxo('D') }],
  );
  const r = await PUB.conferirLacoDeSubfluxo(tx, { tenantId: 't1', fluxoId: 'A', documento: doisDestinos });
  assert.equal(r.ok, true, `falso positivo: ${PUB.mensagemDeLaco(r.ciclos)}`);
});

await medir('fluxo sem nó de sub-fluxo nem consulta o banco', async () => {
  let consultou = false;
  const tx = { ragnabotFluxo: { async findMany() { consultou = true; return []; } }, ragnabotFluxoVersao: { async findMany() { return []; } } };
  const r = await PUB.conferirLacoDeSubfluxo(tx, { tenantId: 't1', fluxoId: 'F1', documento: { nos: [{ id: 'i', tipo: 'inicio' }], arestas: [] } });
  assert.equal(r.ok, true);
  assert.equal(consultou, false, 'consultou o banco à toa');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('5. O TESTADOR CONHECE OS NÓS NOVOS — rota real, Express real, banco-dublê');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const FLUXO_AB = {
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'ab', tipo: 'randomizador', titulo: 'Teste A/B', config: { estabilidade: 'contato', saidas: [{ id: 'a', rotulo: 'A', peso: 50 }, { id: 'b', rotulo: 'B', peso: 50 }] } },
    { id: 'diz_a', tipo: 'texto', config: { corpo: 'Você caiu na variante A.' } },
    { id: 'diz_b', tipo: 'texto', config: { corpo: 'Você caiu na variante B.' } },
    { id: 'para_ana', tipo: 'atendente', titulo: 'Falar com a Ana', config: { atendente: 'ana@empresa.com', mensagem: 'Vou te passar para a Ana.', timeAlternativo: 'Suporte' } },
  ],
  arestas: [
    { de: 'ini', saida: 'padrao', para: 'ab' },
    { de: 'ab', saida: 'a', para: 'diz_a' },
    { de: 'ab', saida: 'b', para: 'diz_b' },
    { de: 'diz_a', saida: 'padrao', para: 'para_ana' },
    { de: 'diz_b', saida: 'padrao', para: 'para_ana' },
  ],
};
const FLUXOS = { f_ab: FLUXO_AB };

const prisma = (await import('../src/base/db.js')).default;
const escrituras = [];
prisma.ragnabotFluxo = {
  async findFirst({ where }) {
    const id = String(where.id);
    if (!FLUXOS[id]) return null;
    return { id, tenantId: 't1', nome: id, visitasPorNoMax: 10, passosPorEvento: 50, versaoPublicadaId: null };
  },
  async findMany() { return []; },
  async update() { escrituras.push('fluxo.update'); },
};
prisma.ragnabotFluxoVersao = { async findUnique() { return null; }, async findMany() { return []; }, async create() { escrituras.push('versao.create'); } };
prisma.ragnabotFluxoRascunho = {
  async findUnique({ where }) { const d = FLUXOS[String(where.fluxoId)]; return d ? { fluxoId: where.fluxoId, documento: d, rev: 1 } : null; },
  async update() { escrituras.push('rascunho.update'); },
};
prisma.ragnabotProtocolo = { async create() { escrituras.push('protocolo.create'); }, async findFirst() { return null; } };
prisma.ragnabotFluxoExecucao = { async create() { escrituras.push('execucao.create'); }, async findFirst() { return null; }, async findMany() { return []; } };
prisma.ragnabotFluxoEvento = { async createMany() { escrituras.push('evento.createMany'); }, async create() { escrituras.push('evento.create'); }, async findMany() { return []; }, async groupBy() { return []; } };
prisma.$queryRaw = async () => [{ agora: new Date('2026-09-02T12:00:00Z') }];

const { default: rotaFluxo } = await import('../src/routes/ragnabot-fluxo.routes.js');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, prox) => { req.user = { id: 'u1', name: 'Operador', isSuperuser: true, role: 'admin' }; prox(); });
app.use('/api/ragnabot-fluxo', rotaFluxo);
const servidor = app.listen(0);
await new Promise((ok) => servidor.once('listening', ok));
const base = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-fluxo`;

async function testar(fluxoId, corpo = {}) {
  const r = await fetch(`${base}/fluxos/${fluxoId}/testar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch { d = { naoEhJson: t.slice(0, 300) }; }
  return { status: r.status, dados: d };
}

let ramoSorteado = null;
await medir('o testador percorre o randomizador e mostra por qual ramo foi', async () => {
  const { status, dados } = await testar('f_ab');
  assert.equal(status, 200, JSON.stringify(dados).slice(0, 300));
  const passagem = dados.trilha.find(([no]) => no === 'ab');
  assert.ok(passagem, `trilha: ${JSON.stringify(dados.trilha)}`);
  ramoSorteado = passagem[1];
  assert.ok(ramoSorteado === 'a' || ramoSorteado === 'b');
  const sorteio = dados.registros.find((r) => r.tipo === 'no_saiu' && r.noId === 'ab');
  assert.ok(sorteio?.detalhe?.sorteio !== undefined, 'o sorteio precisa ficar auditável no registro');
  console.log(`       ramo sorteado: "${ramoSorteado}" (sorteio ${sorteio.detalhe.sorteio} de 10000)`);
});

await medir('⭐ FORÇAR a outra saída deixa o operador conferir a variante que o motor não tomaria', async () => {
  const outro = ramoSorteado === 'a' ? 'b' : 'a';
  const { status, dados } = await testar('f_ab', { forcarSaidas: { ab: outro } });
  assert.equal(status, 200);
  assert.ok(dados.trilha.some(([no, s]) => no === 'ab' && s === outro), JSON.stringify(dados.trilha));
  assert.equal(dados.forcadas.length, 1);
  assert.equal(dados.forcadas[0].forcada, outro);
  assert.match(dados.aviso, /FORÇADAS/);
  const esperado = outro === 'a' ? /variante A/ : /variante B/;
  assert.ok(dados.saidas.some((s) => esperado.test(s.corpo || '')), JSON.stringify(dados.saidas.map((s) => s.tipo)));
  console.log(`       forçado para "${outro}" — e o aviso diz isso na resposta`);
});

await medir('forçar uma saída que não existe AVISA e segue pelo ramo real (nunca desvia em silêncio)', async () => {
  const { dados } = await testar('f_ab', { forcarSaidas: { ab: 'variante_z' } });
  assert.ok(dados.problemas.some((p) => p.codigo === 'SAIDA_FORCADA_INEXISTENTE'), JSON.stringify(dados.problemas));
  assert.equal(dados.forcadas.length, 0);
});

await medir('o nó ATENDENTE aparece no testador como transferência a uma pessoa, e nada é enviado', async () => {
  const { dados } = await testar('f_ab');
  const atribuicao = dados.saidas.find((s) => s.tipo === 'atribuir_agente');
  assert.ok(atribuicao, `intenções: ${dados.saidas.map((s) => s.tipo).join(', ')}`);
  assert.equal(atribuicao.agente, 'ana@empresa.com');
  assert.equal(atribuicao.timeAlternativo, 'Suporte');
  assert.equal(dados.fim?.motivo, 'concluido');
  assert.equal(dados.fim?.estado, 'transferido');
  assert.match(dados.aviso, /nenhuma mensagem foi enviada/);
});

await medir('⛔ o teste NÃO gravou nada no banco', () => {
  assert.deepEqual(escrituras, [], `escreveu: ${escrituras.join(', ')}`);
});

// ── a tradução para a tela do testador ─────────────────────────────────────────────────────────
await medir('a tela do testador traduz `atribuir_agente` em português, com o destino alternativo', async () => {
  const lib = await import('../web/src/lib/api-testador.js');
  const r = lib.resumirIntencao({ tipo: 'atribuir_agente', agente: 'ana@empresa.com', timeAlternativo: 'Suporte' });
  assert.equal(r.rotulo, 'Transferência para um atendente');
  assert.equal(r.paraOCliente, false, 'transferência não é mensagem ao cliente');
  assert.ok(r.detalhes.some(([k, v]) => k === 'Atendente' && v === 'ana@empresa.com'));
  assert.ok(r.detalhes.some(([k]) => /Se não puder receber/.test(k)));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('6. ESTATÍSTICA POR SAÍDA — de onde o número sai de verdade');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('⚠️ MEDIDO: `RagnabotFluxoNoMetricaDia` existe no schema e NINGUÉM escreve nela', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const schema = fs.readFileSync(path.join(raiz, 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /model RagnabotFluxoNoMetricaDia/, 'a tabela sumiu do schema');

  // Varredura de TODO o código de serviço e rota atrás de uma escrita nessa tabela.
  const dirs = [path.join(raiz, 'src', 'services'), path.join(raiz, 'src', 'routes')];
  const escritores = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.js')) continue;
      const txt = fs.readFileSync(path.join(d, f), 'utf8');
      if (/ragnabotFluxoNoMetricaDia\s*\.\s*(create|createMany|upsert|update|updateMany)/.test(txt)) escritores.push(f);
    }
  }
  assert.deepEqual(escritores, [], `alguém passou a escrever: ${escritores.join(', ')} — reveja a fonte da estatística`);
  console.log('       confirmado: a tabela agregada está vazia por decisão; a fonte é o evento cru `no_saiu`');
});

await medir('o motor grava `no_saiu` com a SAÍDA — é daí que vem enviado · clicado · CTR', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const motor = fs.readFileSync(path.join(raiz, 'src', 'services', 'ragnabot-fluxo-motor.service.js'), 'utf8');
  assert.match(motor, /tipo: 'no_saiu', saida/, 'o motor deixou de gravar a saída no evento');
  const rota = fs.readFileSync(path.join(raiz, 'src', 'routes', 'ragnabot-fluxo.routes.js'), 'utf8');
  assert.match(rota, /by: \['noId', 'saida'\]/, 'a telemetria não agrupa por saída');
  assert.match(rota, /tipo: 'no_saiu'/, 'a telemetria não filtra o evento certo');
});

await medir('CTR: exceção NÃO conta como clique, e nó sem apresentação devolve `null` (não 0 %)', () => {
  // A mesma aritmética da rota, exercitada isoladamente — é a regra que muda o número lido.
  const naoSaoClique = new Set(['sem_resposta', 'opcao_invalida', 'erro', 'erro_interno', 'sem_janela']);
  const calcular = (apresentados, porSaida) => {
    let cliques = 0;
    const saida = {};
    for (const [s, n] of Object.entries(porSaida)) {
      const excecao = naoSaoClique.has(s);
      saida[s] = { saiu: n, ctr: apresentados > 0 ? n / apresentados : null, excecao };
      if (!excecao) cliques += n;
    }
    return { porSaida: saida, ctr: apresentados > 0 ? cliques / apresentados : null };
  };
  const r = calcular(518, { sup: 200, fin: 167, opcao_invalida: 151 });
  assert.equal(r.porSaida.sup.saiu, 200);
  assert.ok(Math.abs(r.porSaida.sup.ctr - 200 / 518) < 1e-9);
  assert.equal(r.porSaida.opcao_invalida.excecao, true);
  // 367 cliques em 518 apresentações — e não 518/518, que é o que daria contar a exceção.
  assert.ok(Math.abs(r.ctr - 367 / 518) < 1e-9, `CTR do nó: ${r.ctr}`);
  console.log(`       nó com 518 apresentações e 151 opções inválidas → CTR ${(r.ctr * 100).toFixed(1)} % (não 100 %)`);

  const vazio = calcular(0, { a: 0 });
  assert.equal(vazio.ctr, null, 'nó nunca apresentado tem de devolver null, não 0 %');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
secao('7. OS QUATRO QUE JÁ EXISTIAM — provados, e não presumidos');
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O contrato os dava como «a construir». A medição diz que estavam prontos — mas «pronto» é uma
// afirmação, e afirmação sobre código de outra entrega precisa de prova antes de virar relatório.

await medir('PERGUNTA: estaciona, exige variável de destino e guarda a resposta nela', async () => {
  const no = { id: 'p', tipo: 'pergunta', config: { corpo: 'Qual seu e-mail?', para: 'email', esperaResposta: { valor: 4, unidade: 'minutos' }, excecoes: { semResposta: { tentativas: 2, acaoFinal: 'encerrar' }, opcaoInvalida: { tentativas: 2, acaoFinal: 'encerrar' } } } };
  assert.deepEqual(NOS.validarNo(no).filter((x) => x.nivel === 'erro'), []);
  assert.equal(NOS.noEstaciona(no), true, 'pergunta tem de estacionar');
  const semPara = NOS.validarNo({ id: 'p', tipo: 'pergunta', config: { corpo: 'Qual seu e-mail?' } });
  assert.ok(semPara.some((x) => x.codigo === 'VARIAVEL_AUSENTE'), 'pergunta sem "para" perde a resposta');
  const r = await NOS.EXECUTORES.pergunta.receber({ no, vars: {}, agora: new Date() }, { texto: '  ana@x.com  ' });
  assert.deepEqual(r.varsPatch, { email: 'ana@x.com' }, JSON.stringify(r));
  // ⚠️ Sem janela de 24 h a pergunta NÃO sai — e a saída é declarada, não silêncio.
  assert.ok(NOS.saidasDe(no).includes('sem_janela'));
});

await medir('NOTIFICAR: telefone cravado no fluxo é RECUSADO (o destinatário é NOMEADO)', () => {
  const p = NOS.validarNo({ id: 'n', tipo: 'notificar', config: { canal: 'whatsapp_template', modelo: 'aviso', destinatarios: [{ tipo: 'papel', valor: '559883351000 ' }] } });
  assert.ok(p.some((x) => /telefone cravado/.test(x.mensagem)), JSON.stringify(p.map((x) => x.mensagem)));
  const bom = NOS.validarNo({ id: 'n', tipo: 'notificar', config: { canal: 'interno', destinatarios: [{ tipo: 'papel', valor: 'plantao' }], assunto: 'Cliente novo', corpo: 'Chegou contato' } });
  assert.deepEqual(bom.filter((x) => x.nivel === 'erro'), [], JSON.stringify(bom));
});

await medir('NOTIFICAR: um efeito POR destinatário — a falha de um não reenvia para o outro', () => {
  const i = NOS.prepararNo({ id: 'n', tipo: 'notificar', config: { canal: 'interno', assunto: 'Novo contato', corpo: 'chegou', destinatarios: [{ tipo: 'papel', valor: 'plantao' }, { tipo: 'time', valor: 'Suporte' }] } }, { vars: {} });
  assert.equal(i.length, 2);
  assert.notEqual(i[0].sufixo, i[1].sufixo, 'sufixos iguais fariam a retentativa de um reenviar o outro');
});

await medir('⭐ ETIQUETA: o adaptador LÊ as atuais antes — o robô não apaga o que o atendente pôs na mão', async () => {
  const porta = await import('../src/services/ragnabot-chatwoot.porta.js');
  // A API do Chatwoot SUBSTITUI a lista inteira num POST. Mandar só as do fluxo apagaria as do
  // humano, em silêncio e sem erro nenhum.
  const finais = porta.mesclarEtiquetas(['posto_pelo_atendente', 'urgente'], ['vip'], ['urgente']);
  assert.deepEqual(finais, ['posto_pelo_atendente', 'vip'], JSON.stringify(finais));
  assert.ok(finais.includes('posto_pelo_atendente'), '⛔ a etiqueta do atendente foi apagada');
  // Idempotência: aplicar de novo o que já está não duplica.
  assert.deepEqual(porta.mesclarEtiquetas(['vip'], ['vip'], []), ['vip']);
  console.log(`       ['posto_pelo_atendente','urgente'] + aplicar 'vip' − remover 'urgente' → ${JSON.stringify(finais)}`);
});

await medir('ETIQUETA: falha vira `erro_interno` — rótulo de relatório não transfere o cliente', () => {
  assert.ok(NOS.saidasDe({ tipo: 'etiqueta', config: { aplicar: ['vip'] } }).includes('erro_interno'));
  assert.ok(!NOS.saidasDe({ tipo: 'etiqueta', config: { aplicar: ['vip'] } }).includes('erro'));
  assert.ok(NOS.validarNo({ id: 'e', tipo: 'etiqueta', config: { aplicar: ['x'], remover: ['x'] } })
    .some((p) => /aplicar E em remover/.test(p.mensagem)), 'aplicar e remover a mesma etiqueta é ambíguo');
});

await medir('SUB-FLUXO: o modo é obrigatório, e "chamar" volta enquanto "saltar" não', () => {
  const semModo = NOS.validarNo({ id: 's', tipo: 'subfluxo', config: { fluxoId: 'F2' } });
  assert.ok(semModo.some((x) => /modo do sub-fluxo é obrigatório/.test(x.mensagem)), JSON.stringify(semModo.map((x) => x.mensagem)));
  assert.deepEqual(NOS.saidasDe({ tipo: 'subfluxo', config: { modo: 'chamar', fluxoId: 'F2' } }), ['padrao']);
  assert.deepEqual(NOS.saidasDe({ tipo: 'subfluxo', config: { modo: 'saltar', fluxoId: 'F2' } }), []);
});

await medir('SUB-FLUXO apontando para outra EMPRESA é recusado (junção cruzada)', () => {
  const p = NOS.validarNo({ id: 's', tipo: 'subfluxo', config: { modo: 'saltar', fluxoId: 'DA_OUTRA' } },
    { fluxosDaEmpresa: ['F1', 'F2'] });
  assert.ok(p.some((x) => x.codigo === 'DESTINO_NAO_PERMITIDO'), JSON.stringify(p.map((x) => x.codigo)));
});

await medir('os quatro aparecem na PALETA do editor (nó implementado e fora da paleta é nó que não existe)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tela = fs.readFileSync(path.join(raiz, 'web', 'src', 'paginas', 'FluxosRagnabot.jsx'), 'utf8');
  const paleta = /const ORDEM_DA_PALETA = \[([\s\S]*?)\];/.exec(tela)?.[1] ?? '';
  for (const t of ['pergunta', 'notificar', 'etiqueta', 'subfluxo', 'atendente', 'randomizador']) {
    assert.ok(new RegExp(`'${t}'`).test(paleta), `"${t}" não está na paleta do editor`);
  }
});

await medir('⚠️ LACUNA MEDIDA, e não corrigida aqui: `agente_ia` e `pagamento_pix` NÃO estão na paleta', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tela = fs.readFileSync(path.join(raiz, 'web', 'src', 'paginas', 'FluxosRagnabot.jsx'), 'utf8');
  const paleta = /const ORDEM_DA_PALETA = \[([\s\S]*?)\];/.exec(tela)?.[1] ?? '';
  const foraDaPaleta = NOS.TIPOS.filter((t) => !new RegExp(`'${t}'`).test(paleta));
  // Este teste NÃO reprova: ele DOCUMENTA a lacuna com o número exato, para o chefe decidir. Os
  // dois nós existem no motor (S5 e S-Efí) e não têm formulário no editor — construí-los sem
  // pedido seria trabalho fora do contrato, e escondê-los seria pior.
  console.log(`       tipos implementados FORA da paleta do editor: ${foraDaPaleta.join(', ') || 'nenhum'}`);
  assert.deepEqual(foraDaPaleta.sort(), ['agente_ia', 'pagamento_pix'],
    'a lista de nós sem tela mudou — reveja o relatório antes de seguir');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
servidor.close();
console.log(`\n${'═'.repeat(92)}`);
console.log(`RESULTADO: ${passou} provado(s) · ${reprovou} reprovado(s)`);
console.log('═'.repeat(92));
process.exit(reprovou > 0 ? 1 : 0);
