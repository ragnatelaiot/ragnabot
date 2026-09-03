#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONEXÕES — cartão, cota, reinício, transferência e registro por canal.
// Contrato S6 (02/09/2026), doc 34 §F9.2.3 a §F9.2.7.
//
// O QUE ESTE ARQUIVO TENTA REPROVAR, item a item do contrato:
//   · «cota estourada recusa com mensagem»             → a recusa, e o texto dela
//   · «transferir tickets preserva histórico»          → a ORIGEM sobrevive a três transferências
//   · reiniciar conexão                                → o que faz, e o que ADMITE não fazer
//   · logs de requisição por canal                     → lidos do que o motor JÁ grava
//
// ⚠️ O QUE ELE **NÃO** PROVA, e está dito também no código e no relatório:
//   · que a plataforma de atendimento move a caixa de entrada de uma conversa — ela NÃO expõe rota
//     para isso, e a nossa transferência declara `moveuNaPlataforma: false`. O que se prova é que
//     o NOSSO roteamento muda e que o histórico sobrevive.
//   · nada em produção: em 02/09/2026 há ZERO caixas de WhatsApp e ZERO conversas de cliente.
//
// COMO RODAR:  node tests/ragnabot-conexao.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';

import { criarFakeSimples } from './fixtures/fake-prisma-simples.mjs';

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const conexoes = await import('../src/services/ragnabot-conexao.service.js');
const { limitesDoPlano } = await import('../src/config/ragnabot-plans.js');

const LOG = [];
const logEspiao = { info: (m) => LOG.push(String(m)), warn: (m) => LOG.push(String(m)), error: (m) => LOG.push(String(m)), debug: (m) => LOG.push(String(m)) };

const TENANT = 'empresa-1';
const AGORA = new Date('2026-09-02T15:00:00.000Z');

// ── O BANCO DE MENTIRA, COM AS CAIXAS MEDIDAS EM 02/09/2026 ────────────────────────────────────
// Os ids e nomes são os de verdade da conta 1 (1 Site · 34 WhatsApp · 35 Facebook · 36 Instagram).
function montarBanco({ plano = 'profissional' } = {}) {
  const db = criarFakeSimples([
    'ragnabotTenant', 'ragnabotInbox', 'ragnabotConversa',
    'ragnabotConexaoTransferencia', 'ragnabotFluxoExecucao', 'ragnabotFluxoEfeito',
  ], { ragnabotInbox: [['activeKey']] });

  db.__tabelas.ragnabotTenant.push({
    id: TENANT, name: 'Ragnatela IoT Solutions', slug: 'ragnatela', plan: plano,
    status: 'trial', cwAccountId: 1, cwAdminUserId: 1, limits: limitesDoPlano(plano),
  });
  const caixa = (cwInboxId, name, channelType, identifier, provedor) => ({
    id: `inbox-${cwInboxId}`, tenantId: TENANT, cwInboxId, name, channelType, identifier,
    activeKey: `${channelType}:${identifier}`, provedor, estado: 'desconhecido',
    metadata: {}, removedAt: null, createdAt: AGORA, updatedAt: AGORA,
  });
  db.__tabelas.ragnabotInbox.push(
    caixa(1, 'Site - Ragnatela', 'web_widget', 'ragnatela.com.br', 'nativo'),
    caixa(34, 'WhatsApp Ragnatela', 'whatsapp', '+559831970997', 'meta_direto'),
    caixa(35, 'Facebook-Ragnatela', 'facebook', 'pagina-1', 'meta_direto'),
    caixa(36, 'Instagram-Ragnatela', 'instagram', 'insta-1', 'meta_direto'),
  );
  return db;
}

function ligar(db, extras = {}) {
  return conexoes.configurarConexoes({
    db, log: logEspiao, agora: () => AGORA,
    chatwoot: null, esquecerCanais: () => {}, emitirEvento: async () => ({}),
    auditoria: { registrar: async () => null }, tenants: null, ...extras,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) O CARTÃO DA CONEXÃO (F9.2.3)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

let db = montarBanco();
ligar(db);

const cartoes = await conexoes.listarConexoes(TENANT);

await medir('as quatro conexões medidas aparecem, com id, nome, canal e identificador', () => {
  assert.equal(cartoes.length, 4);
  const wa = cartoes.find((c) => c.cwInboxId === 34);
  assert.equal(wa.nome, 'WhatsApp Ragnatela');
  assert.equal(wa.canalRotulo, 'WhatsApp (Cloud API da Meta)');
  assert.equal(wa.identificador, '+559831970997');
  assert.ok(wa.atualizadaEm, 'a coluna «última atualização» da tela 40 precisa de valor');
});

await medir('o cartão traz QUEM OPERA e o que isso permite, em português', () => {
  const wa = cartoes.find((c) => c.cwInboxId === 34);
  assert.equal(wa.provedor, 'meta_direto');
  assert.equal(wa.provedorRotulo, 'Meta (direto)');
  assert.match(wa.capacidadeResumo, /botão/u);
});

await medir('o estado nasce «desconhecido» — dizer «conectado» sem medir é o pior erro possível', () => {
  assert.ok(cartoes.every((c) => c.estado === 'desconhecido'));
  assert.ok(cartoes.every((c) => c.estadoIdadeMin === null));
});

await medir('⛔ nenhum segredo no cartão: só a impressão digital da credencial', () => {
  const texto = JSON.stringify(cartoes);
  assert.ok(!texto.includes('provedorConfig'));
  assert.ok(!texto.includes('api_key'));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) TROCAR O PROVEDOR (F9.2.2 — a escrita)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('trocar para um provedor que não opera o canal é RECUSADO com o motivo', async () => {
  await assert.rejects(
    () => conexoes.definirProvedor(TENANT, 1, { provedor: 'whatsmeow' }),
    /não opera o canal/u,
  );
});

await medir('trocar o provedor do WhatsApp é UM UPDATE — e o estado volta a «desconhecido»', async () => {
  const r = await conexoes.definirProvedor(TENANT, 34, { provedor: 'whatsmeow', provedorRef: 'sessao-7' }, { ator: { id: 'u1', name: 'Operador' } });
  assert.equal(r.provedor, 'whatsmeow');
  assert.equal(r.provedorRef, 'sessao-7');
  assert.equal(r.estado, 'desconhecido', 'provedor novo ainda não foi medido');
  assert.match(r.capacidadeResumo, /texto numerado/u, 'a capacidade acompanhou a troca');
});

await medir('o seletor da tela oferece só os provedores do canal, com o padrão marcado', async () => {
  const r = await conexoes.opcoesDeProvedor(TENANT, 34);
  assert.equal(r.atual, 'whatsmeow');
  assert.deepEqual(r.opcoes.map((o) => o.id).sort(), ['meta_direto', 'terceiro', 'whatsmeow']);
  assert.equal(r.opcoes.find((o) => o.padrao).id, 'meta_direto');
});

await medir('conexão de OUTRA empresa responde 404, não 403', async () => {
  try { await conexoes.definirProvedor('empresa-2', 34, { provedor: 'meta_direto' }); assert.fail('devia recusar'); }
  catch (e) { assert.equal(e.status, 404); assert.equal(e.code, 'CONEXAO_NAO_ENCONTRADA'); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) ⭐ COTA DE CANAIS (F9.2.7) — Limite × Ativos × Uso %');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const cota = await conexoes.cotaDeCanais(TENANT);

await medir('a leitura traz limite, ativos e uso por cento — o número da tela 39', () => {
  assert.equal(cota.limite, 5, 'o plano profissional tem 5 caixas');
  assert.equal(cota.ativos, 4);
  assert.equal(cota.usoPct, 80);
  assert.equal(cota.esgotado, false);
});

await medir('a leitura é POR CANAL, e marca o que já esgotou', () => {
  const wa = cota.porCanal.find((c) => c.canal === 'whatsapp');
  assert.equal(wa.limite, 2);
  assert.equal(wa.ativos, 1);
  assert.equal(wa.usoPct, 50);
  const tg = cota.porCanal.find((c) => c.canal === 'telegram');
  assert.equal(tg.incluidoNoPlano, false, 'o profissional não inclui Telegram');
  assert.equal(tg.limite, 0);
});

await medir('a leitura conta também POR PROVEDOR (é como se enxerga quem está fora do padrão)', () => {
  const meta = cota.porProvedor.find((p) => p.provedor === 'meta_direto');
  const sessao = cota.porProvedor.find((p) => p.provedor === 'whatsmeow');
  assert.equal(meta.ativos, 2, 'Facebook e Instagram continuam em meta_direto');
  assert.equal(sessao.ativos, 1, 'o WhatsApp foi trocado na medição anterior');
});

await medir('⭐ ligar canal DENTRO do limite é permitido', async () => {
  const r = await conexoes.exigirCotaParaLigar(TENANT, 'whatsapp');
  assert.equal(r.permitido, true);
});

await medir('⭐ COTA ESTOURADA recusa — e a mensagem diz o limite, o uso e o que fazer', async () => {
  // Enche o plano: mais uma conexão fecha as 5 do profissional.
  db.__tabelas.ragnabotInbox.push({
    id: 'inbox-45', tenantId: TENANT, cwInboxId: 45, name: 'Suporte Ragnatela',
    channelType: 'whatsapp', identifier: '+559831970998', activeKey: 'whatsapp:+559831970998',
    provedor: 'meta_direto', estado: 'desconhecido', metadata: {}, removedAt: null,
    createdAt: AGORA, updatedAt: AGORA,
  });
  try {
    await conexoes.exigirCotaParaLigar(TENANT, 'whatsapp');
    assert.fail('a cota deixou passar a sexta conexão');
  } catch (e) {
    assert.equal(e.code, 'COTA_DE_CANAIS_ESGOTADA');
    assert.equal(e.status, 409);
    assert.match(e.message, /Limite de 5 caixa/u);
    assert.match(e.message, /5 conexão\(ões\) ativa\(s\) de 5/u);
    assert.match(e.message, /Desligue uma conexão|mude o plano/u);
    assert.equal(e.detalhes.limite, 5);
    assert.equal(e.detalhes.ativos, 5);
  }
});

await medir('canal FORA do plano é recusado mesmo com vaga sobrando', async () => {
  const pequeno = montarBanco({ plano: 'essencial' });
  ligar(pequeno);
  // O essencial só inclui web_widget e whatsapp; a base tem 4 caixas, então já estoura o total —
  // usamos uma base só com o site para isolar a razão «canal fora do plano».
  pequeno.__tabelas.ragnabotInbox.length = 0;
  pequeno.__tabelas.ragnabotInbox.push({
    id: 'inbox-1', tenantId: TENANT, cwInboxId: 1, name: 'Site', channelType: 'web_widget',
    identifier: 'ragnatela.com.br', activeKey: 'web_widget:ragnatela.com.br', provedor: 'nativo',
    metadata: {}, removedAt: null, createdAt: AGORA, updatedAt: AGORA,
  });
  await assert.rejects(() => conexoes.exigirCotaParaLigar(TENANT, 'telegram'), /plano não inclui o canal/u);
  ligar(db); // devolve o banco principal
});

await medir('conexão DESLIGADA não conta na cota (o número volta a ficar livre)', async () => {
  const linha = db.__tabelas.ragnabotInbox.find((l) => l.cwInboxId === 45);
  linha.removedAt = AGORA;
  linha.activeKey = null;
  const r = await conexoes.exigirCotaParaLigar(TENANT, 'whatsapp');
  assert.equal(r.permitido, true);
  const nova = await conexoes.cotaDeCanais(TENANT);
  assert.equal(nova.ativos, 4);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ESTADO E REINÍCIO (F9.2.3 / F9.2.5)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('gravar o estado exige um valor conhecido, e carimba a hora da MEDIÇÃO', async () => {
  await assert.rejects(() => conexoes.registrarEstado(TENANT, 34, { estado: 'meio-conectado' }), /não existe/u);
  const r = await conexoes.registrarEstado(TENANT, 34, { estado: 'desconectado', detalhe: 'sessão caiu' });
  assert.equal(r.estado, 'desconectado');
  assert.equal(r.estadoDetalhe, 'sessão caiu');
  assert.ok(r.estadoEm);
  assert.equal(r.estadoIdadeMin, 0);
});

await medir('⭐ reiniciar um provedor SEM transporte devolve `naoDisponivel` COM o motivo — nunca «pronto»', async () => {
  // A conexão 34 está em `whatsmeow` desde a medição 2.
  const r = await conexoes.reiniciarConexao(TENANT, 34, { motivo: 'sessão caiu' }, { ator: { id: 'u1' } });
  assert.equal(r.resultado, 'naoDisponivel');
  assert.match(r.mensagem, /não fala com ele/u);
  assert.match(r.mensagem, /este botão não faz nada/u);
});

await medir('reiniciar uma conexão nativa FAZ o que promete: solta o cache e reconcilia', async () => {
  let soltou = 0; let reconciliou = 0;
  ligar(db, {
    esquecerCanais: () => { soltou++; },
    tenants: {
      limitesVigentes: (t) => t.limits,
      sincronizarCaixas: async () => { reconciliou++; return { caixasNaPlataforma: 4 }; },
    },
  });
  const r = await conexoes.reiniciarConexao(TENANT, 1, { motivo: 'conferência' }, { ator: { id: 'u1' } });
  assert.equal(r.resultado, 'reiniciada');
  assert.equal(soltou, 1, 'o cache de canal TEM de ser solto — senão a capacidade antiga vale por 60 s');
  assert.equal(reconciliou, 1);
  assert.equal(r.estado, 'conectado');
  assert.match(r.mensagem, /cache de canal solto/u);
});

await medir('reiniciar uma conexão já desligada é recusado, não fingido', async () => {
  const linha = db.__tabelas.ragnabotInbox.find((l) => l.cwInboxId === 45);
  linha.removedAt = AGORA;
  await assert.rejects(() => conexoes.reiniciarConexao(TENANT, 45, {}, {}), /está desligada/u);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ⭐ TRANSFERIR ATENDIMENTOS ENTRE CONEXÕES (F9.2.4) — o histórico sobrevive');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

db = montarBanco();
// Uma segunda linha de WhatsApp: é o caso real («trocar de número sem perder histórico»).
db.__tabelas.ragnabotInbox.push({
  id: 'inbox-45', tenantId: TENANT, cwInboxId: 45, name: 'Suporte Ragnatela',
  channelType: 'whatsapp', identifier: '+559831970998', activeKey: 'whatsapp:+559831970998',
  provedor: 'meta_direto', estado: 'conectado', metadata: {}, removedAt: null,
  createdAt: AGORA, updatedAt: AGORA,
});
const conversa = (id, estado) => ({
  id: `conv-${id}`, tenantId: TENANT, cwAccountId: 1, cwConversationId: id,
  cwInboxId: 34, caixaNome: 'WhatsApp Ragnatela', canal: 'whatsapp',
  estado, contatoNome: `Cliente ${id}`, contatoChave: `5598${id}`,
  abertaEm: AGORA, ultimaAtividadeEm: AGORA, protocolo: `RGT-000000000${id}`,
  origemCwInboxId: null, transferidaEm: null,
});
db.__tabelas.ragnabotConversa.push(conversa(1, 'atendendo'), conversa(2, 'aguardando'), conversa(3, 'chatbot'), conversa(4, 'resolvida'));

const notas = [];
ligar(db, { chatwoot: { notaInterna: async (d) => { notas.push(d); return true; } } });

await medir('a PRÉVIA mostra o que seria movido, sem mover nada', async () => {
  const p = await conexoes.previaDaTransferencia(TENANT, { deCwInboxId: 34, paraCwInboxId: 45 });
  assert.equal(p.total, 3, 'resolvida NÃO entra por padrão');
  assert.equal(p.avisoDeCanal, null, 'mesmo canal, sem aviso');
  assert.ok(db.__tabelas.ragnabotConversa.every((c) => c.cwInboxId === 34), 'a prévia MOVEU alguma coisa');
});

await medir('transferir sem motivo é recusado — é o que explica a mudança meses depois', async () => {
  await assert.rejects(
    () => conexoes.transferirConversas(TENANT, { deCwInboxId: 34, paraCwInboxId: 45, motivo: 'oi' }),
    /motivo da transferência/u,
  );
});

const transferencia = await conexoes.transferirConversas(TENANT, {
  deCwInboxId: 34, paraCwInboxId: 45, motivo: 'troca do número de atendimento',
}, { ator: { id: 'u1', name: 'Operador' } });

await medir('⭐ os atendimentos abertos passaram a ser roteados pela conexão nova', () => {
  assert.equal(transferencia.movidas, 3);
  assert.equal(transferencia.falhas, 0);
  assert.equal(transferencia.resultado, 'concluida');
  const movidas = db.__tabelas.ragnabotConversa.filter((c) => c.cwInboxId === 45);
  assert.equal(movidas.length, 3);
  assert.ok(movidas.every((c) => c.caixaNome === 'Suporte Ragnatela'));
});

await medir('a conversa RESOLVIDA ficou onde estava — mover encerrado só embaralha histórico', () => {
  const resolvida = db.__tabelas.ragnabotConversa.find((c) => c.cwConversationId === 4);
  assert.equal(resolvida.cwInboxId, 34);
  assert.equal(resolvida.transferidaEm, null);
});

await medir('⭐ O HISTÓRICO SOBREVIVE: cada conversa guarda de ONDE veio', () => {
  const movidas = db.__tabelas.ragnabotConversa.filter((c) => c.cwInboxId === 45);
  assert.ok(movidas.every((c) => c.origemCwInboxId === 34), 'a origem se perdeu');
  assert.ok(movidas.every((c) => c.transferidaEm), 'sem carimbo, não dá para saber quando mudou');
  assert.ok(movidas.every((c) => c.protocolo), 'o protocolo tem de sobreviver à transferência');
});

await medir('o AVISO INTERNO ficou na conversa lá fora, dizendo de onde para onde e por quê', () => {
  assert.equal(notas.length, 3);
  assert.match(notas[0].texto, /WhatsApp Ragnatela/u);
  assert.match(notas[0].texto, /Suporte Ragnatela/u);
  assert.match(notas[0].texto, /troca do número de atendimento/u);
  assert.match(notas[0].texto, /Operador/u);
  assert.equal(transferencia.avisoNaConversa, true);
});

await medir('⚠️ o resultado ADMITE que a plataforma não moveu a caixa de entrada — não finge', () => {
  assert.equal(transferencia.moveuNaPlataforma, false);
  assert.match(transferencia.mensagem, /não permite trocar a caixa de/u);
});

await medir('⭐ transferindo DE NOVO, a ORIGEM continua sendo a primeira (não o passo anterior)', async () => {
  const r = await conexoes.transferirConversas(TENANT, {
    deCwInboxId: 45, paraCwInboxId: 34, motivo: 'voltando para a linha antiga',
  }, { ator: { id: 'u1', name: 'Operador' } });
  assert.equal(r.movidas, 3);
  const voltaram = db.__tabelas.ragnabotConversa.filter((c) => c.cwConversationId !== 4);
  assert.ok(voltaram.every((c) => c.cwInboxId === 34));
  assert.ok(voltaram.every((c) => c.origemCwInboxId === 34), 'a origem foi sobrescrita pelo passo anterior');
});

await medir('a operação inteira fica registrada, com motivo, autor e contadores', async () => {
  const lista = await conexoes.listarTransferencias(TENANT);
  assert.equal(lista.length, 2);
  const primeira = lista.find((l) => l.origemCwInboxId === 34);
  assert.equal(primeira.movidas, 3);
  assert.equal(primeira.solicitadaPorNome, 'Operador');
  assert.match(primeira.motivo, /troca do número/u);
  assert.equal(primeira.moveuNaPlataforma, false);
});

await medir('transferir entre CANAIS diferentes é barrado — e explica que o contato não chega lá', async () => {
  try {
    await conexoes.transferirConversas(TENANT, { deCwInboxId: 34, paraCwInboxId: 1, motivo: 'quero mesmo' });
    assert.fail('deixou passar');
  } catch (e) {
    assert.equal(e.code, 'CANAIS_DIFERENTES');
    assert.match(e.message, /não chega nele/u);
    assert.match(e.message, /forcarCanalDiferente/u, 'a recusa tem de dizer como insistir conscientemente');
  }
});

await medir('com `forcarCanalDiferente` ele obedece — a trava é para o engano, não para o dono', async () => {
  const r = await conexoes.transferirConversas(TENANT, {
    deCwInboxId: 34, paraCwInboxId: 1, motivo: 'migração para o widget do site', forcarCanalDiferente: true,
  }, { ator: { id: 'u1', name: 'Operador' } });
  assert.equal(r.movidas, 3);
});

await medir('destino DESLIGADO é recusado — mover atendimento para lá seria escondê-lo', async () => {
  db.__tabelas.ragnabotInbox.find((l) => l.cwInboxId === 45).removedAt = AGORA;
  await assert.rejects(
    () => conexoes.transferirConversas(TENANT, { deCwInboxId: 1, paraCwInboxId: 45, motivo: 'qualquer coisa aqui' }),
    /está desligada|DESTINO_DESLIGADO/u,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n6) REGISTRO DE REQUISIÇÕES POR CANAL (F9.2.6) — lido do que o motor JÁ grava');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

db = montarBanco();
ligar(db);
db.__tabelas.ragnabotConversa.push({ ...conversa(10, 'atendendo'), cwInboxId: 34 });
db.__tabelas.ragnabotFluxoExecucao.push({
  id: 'exec-1', tenantId: TENANT, cwAccountId: 1, cwConversationId: 10, protocolo: 'RGT-0000000010',
});
db.__tabelas.ragnabotFluxoEfeito.push(
  { id: 'ef-1', execucaoId: 'exec-1', tenantId: TENANT, tipo: 'msg_texto', status: 'confirmado', httpStatus: 200, idExterno: '111', reservadoEm: new Date('2026-09-02T14:00:00Z'), tentativa: 1, resposta: { resumo: 'texto enviado' } },
  { id: 'ef-2', execucaoId: 'exec-1', tenantId: TENANT, tipo: 'msg_botoes', status: 'falhou', httpStatus: 422, erro: 'canal recusou', reservadoEm: new Date('2026-09-02T14:05:00Z'), tentativa: 1 },
  { id: 'ef-3', execucaoId: 'exec-1', tenantId: TENANT, tipo: 'msg_texto', status: 'duvidoso', httpStatus: null, erro: 'sem resposta', reservadoEm: new Date('2026-09-02T14:10:00Z'), tentativa: 2 },
);

await medir('o registro por canal traz as requisições do motor, com status e protocolo', async () => {
  const r = await conexoes.registroPorConexao(TENANT, { cwInboxId: 34 });
  assert.equal(r.total, 3);
  const falhou = r.requisicoes.find((x) => x.status === 'falhou');
  assert.equal(falhou.httpStatus, 422);
  assert.equal(falhou.erro, 'canal recusou');
  assert.equal(falhou.protocolo, 'RGT-0000000010');
  assert.equal(falhou.conversa, 10);
});

await medir('dá para filtrar SÓ as falhas — é o que o suporte abre primeiro', async () => {
  const r = await conexoes.registroPorConexao(TENANT, { cwInboxId: 34, somenteFalhas: true });
  assert.equal(r.total, 2, 'falhou + duvidoso');
});

await medir('o RELATÓRIO conta por status e por tipo, e calcula a taxa de falha', async () => {
  const r = await conexoes.relatorioPorConexao(TENANT, { cwInboxId: 34 });
  assert.equal(r.total, 3);
  assert.equal(r.confirmadas, 1);
  assert.equal(r.falhas, 1);
  assert.equal(r.duvidosas, 1);
  assert.equal(r.taxaDeFalhaPct, 66.7);
  assert.equal(r.porTipo.find((t) => t.tipo === 'msg_texto').n, 2);
  assert.equal(r.porStatusHttp.find((s) => s.status === 422).n, 1);
});

await medir('⚠️ o relatório chama de AMOSTRA o que é amostra — relatório que mente é pior que nenhum', async () => {
  const r = await conexoes.relatorioPorConexao(TENANT, { cwInboxId: 34 });
  assert.equal(r.amostraDe, 3);
  assert.ok('amostraDe' in r, 'sem este campo, 500 linhas passariam por «o total do período»');
});

await medir('conexão sem conversa nenhuma responde com a OBSERVAÇÃO, não com zero mudo', async () => {
  const r = await conexoes.registroPorConexao(TENANT, { cwInboxId: 35 });
  assert.equal(r.total, 0);
  assert.match(r.observacao, /Nenhuma conversa/u);
});

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
