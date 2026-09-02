#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O TESTADOR DE FLUXO — quatro conversas simuladas de ponta a ponta.
//
// Contrato S3.1 (02/09/2026), doc 34 §F3.1: *"dentro do fluxo faça um testador de fluxo"*.
//
// ── O QUE ESTÁ SOB JULGAMENTO ───────────────────────────────────────────────────────────────────
// A ROTA REAL `POST /api/ragnabot-fluxo/fluxos/:id/testar`, montada num express de verdade e
// chamada por HTTP de verdade. O que é dublê aqui é só o BANCO (as tabelas de fluxo) e a sessão —
// nunca o motor: os executores, o casador de opções e o perfil de limites são os de produção.
//
// ⚠️ POR QUE ISSO IMPORTA MAIS QUE PARECER: um testador escrito à parte diverge do motor em três
// semanas, e a divergência aparece justamente quando alguém confia nele para publicar. Este teste
// existe para provar que a simulação passa pelos MESMOS `preparar()`/`executar()` do envio real —
// e que, ainda assim, NADA sai para ninguém.
//
// As quatro conversas cobertas (as pedidas no contrato):
//   1. fluxo com BOTÕES (para e espera a escolha, e a escolha decide o caminho)
//   2. fluxo com CONDIÇÃO (bifurca por variável, sem falar com ninguém)
//   3. fluxo que TRANSFERE para um setor (termina fora do robô)
//   4. fluxo que CHEGA AO FIM (encerra e resolve a conversa)
//
// COMO RODAR:   node tests/ragnabot-testador-fluxo.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import express from 'express';

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

// ── OS QUATRO DOCUMENTOS ───────────────────────────────────────────────────────────────────────
const FLUXO_BOTOES = {
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'menu', tipo: 'botoes', titulo: 'Menu', config: { corpo: 'Como posso ajudar, {{nome}}?', botoes: [{ id: 'sup', rotulo: 'Suporte' }, { id: 'fin', rotulo: 'Financeiro' }] } },
    { id: 'diz_sup', tipo: 'texto', config: { corpo: 'Certo, suporte.' } },
    { id: 'diz_fin', tipo: 'texto', config: { corpo: 'Certo, financeiro.' } },
    { id: 'fim', tipo: 'encerrar', config: { corpo: 'Até logo!', resolver: true } },
    { id: 'sem_resp', tipo: 'encerrar', config: { corpo: 'Volto quando puder falar.', resolver: true } },
  ],
  arestas: [
    { de: 'ini', saida: 'padrao', para: 'menu' },
    { de: 'menu', saida: 'sup', para: 'diz_sup' },
    { de: 'menu', saida: 'fin', para: 'diz_fin' },
    { de: 'menu', saida: 'sem_resposta', para: 'sem_resp' },
    { de: 'menu', saida: 'opcao_invalida', para: 'menu' },
    { de: 'menu', saida: 'erro', para: 'sem_resp' },
    { de: 'diz_sup', saida: 'padrao', para: 'fim' },
    { de: 'diz_fin', saida: 'padrao', para: 'fim' },
  ],
};

const FLUXO_CONDICAO = {
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'ehvip', tipo: 'condicao', config: { regras: [{ variavel: 'plano', operador: 'igual', valor: 'vip' }] } },
    { id: 'vip', tipo: 'texto', config: { corpo: 'Atendimento prioritário.' } },
    { id: 'comum', tipo: 'texto', config: { corpo: 'Já vamos te atender.' } },
    { id: 'fim', tipo: 'encerrar', config: { resolver: true } },
  ],
  arestas: [
    { de: 'ini', saida: 'padrao', para: 'ehvip' },
    { de: 'ehvip', saida: 'verdadeiro', para: 'vip' },
    { de: 'ehvip', saida: 'falso', para: 'comum' },
    { de: 'vip', saida: 'padrao', para: 'fim' },
    { de: 'comum', saida: 'padrao', para: 'fim' },
  ],
};

const FLUXO_TRANSFERE = {
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'avisa', tipo: 'texto', config: { corpo: 'Vou te passar para um atendente.' } },
    { id: 'passa', tipo: 'time', config: { time: 'Suporte', timeId: 42, mensagem: 'Transferindo…' } },
  ],
  arestas: [
    { de: 'ini', saida: 'padrao', para: 'avisa' },
    { de: 'avisa', saida: 'padrao', para: 'passa' },
  ],
};

const FLUXO_FIM = {
  nos: [
    { id: 'ini', tipo: 'inicio', config: {} },
    { id: 'tchau', tipo: 'encerrar', config: { corpo: 'Obrigado por falar com a gente!', resolver: true, etiquetas: ['atendido'] } },
  ],
  arestas: [{ de: 'ini', saida: 'padrao', para: 'tchau' }],
};

const FLUXOS = {
  f_botoes: FLUXO_BOTOES,
  f_condicao: FLUXO_CONDICAO,
  f_transfere: FLUXO_TRANSFERE,
  f_fim: FLUXO_FIM,
};

// ── O BANCO-DUBLÊ ──────────────────────────────────────────────────────────────────────────────
// Só as tabelas que a rota toca. Trocamos os métodos NA INSTÂNCIA do Prisma para a rota continuar
// sendo a de produção — reescrever a rota para aceitar um banco injetado mudaria o que está sob
// julgamento.
const prisma = (await import('../src/base/db.js')).default;

const escrituras = [];
function contarEscrita(onde) { escrituras.push(onde); }

prisma.ragnabotFluxo = {
  async findFirst({ where }) {
    const id = String(where.id);
    if (!FLUXOS[id]) return null;
    return { id, tenantId: 't1', nome: id, visitasPorNoMax: 10, passosPorEvento: 50, versaoPublicadaId: null };
  },
  async create() { contarEscrita('ragnabotFluxo.create'); },
  async update() { contarEscrita('ragnabotFluxo.update'); },
};
prisma.ragnabotFluxoVersao = {
  async findUnique() { return null; },
  async create() { contarEscrita('ragnabotFluxoVersao.create'); },
};
prisma.ragnabotFluxoRascunho = {
  async findUnique({ where }) {
    const doc = FLUXOS[String(where.fluxoId)];
    return doc ? { fluxoId: where.fluxoId, documento: doc, rev: 1 } : null;
  },
  async update() { contarEscrita('ragnabotFluxoRascunho.update'); },
};
prisma.ragnabotProtocolo = {
  async create() { contarEscrita('ragnabotProtocolo.create'); },
  async findFirst() { return null; },
};
prisma.ragnabotFluxoExecucao = {
  async create() { contarEscrita('ragnabotFluxoExecucao.create'); },
  async findFirst() { return null; },
};
prisma.ragnabotFluxoEvento = {
  async createMany() { contarEscrita('ragnabotFluxoEvento.createMany'); },
  async create() { contarEscrita('ragnabotFluxoEvento.create'); },
  async findMany() { return []; },
};
// `now()` do banco: a rota o usa de propósito (relógio de processo fora de sincronia decide janela
// de 24 h errada). Aqui devolvemos uma hora fixa, e a rota diz na resposta de onde veio.
prisma.$queryRaw = async () => [{ agora: new Date('2026-09-02T12:00:00Z') }];

// ── O SERVIDOR ─────────────────────────────────────────────────────────────────────────────────
const { default: rotaFluxo } = await import('../src/routes/ragnabot-fluxo.routes.js');
const app = express();
app.use(express.json({ limit: '10mb' }));
// Sessão de mentira: super usuário, para o escopo não ser o assunto deste arquivo (o isolamento
// tem teste próprio em `ragnabot-isolamento.test.mjs`).
app.use((req, _res, prox) => { req.user = { id: 'u1', name: 'Operador', isSuperuser: true, role: 'admin' }; prox(); });
app.use('/api/ragnabot-fluxo', rotaFluxo);

const servidor = app.listen(0);
await new Promise((ok) => servidor.once('listening', ok));
const base = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-fluxo`;

async function testar(fluxoId, corpo = {}) {
  const r = await fetch(`${base}/fluxos/${fluxoId}/testar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { dados = { naoEhJson: texto.slice(0, 200) }; }
  return { status: r.status, dados };
}

console.log('\nTESTADOR DE FLUXO — quatro conversas simuladas\n');
console.log('1) FLUXO COM BOTÕES');

let estadoBotoes = null;
await medir('o primeiro passo apresenta o menu e PARA esperando a escolha', async () => {
  const { status, dados } = await testar('f_botoes', { vars: { nome: 'Ana' } });
  assert.equal(status, 200, JSON.stringify(dados).slice(0, 300));
  const menu = dados.saidas.find((s) => s.tipo === 'botoes');
  assert.ok(menu, `nenhuma intenção de botões nas saídas: ${dados.saidas.map((s) => s.tipo).join(', ')}`);
  assert.match(menu.corpo, /Como posso ajudar, Ana\?/, 'a variável tinha de ser interpolada como em produção');
  assert.equal(menu.botoes.length, 2);
  assert.ok(dados.parado, 'o fluxo tinha de estar parado esperando resposta');
  assert.equal(dados.parado.motivo, 'resposta');
  assert.deepEqual(dados.parado.opcoes.map((o) => o.id), ['sup', 'fin'],
    'as opções mostradas ao operador saem do que `preparar()` montou, não de palpite');
  estadoBotoes = dados.estado;
});

await medir('escolher "Financeiro" (toque no botão) leva ao ramo certo e chega ao fim', async () => {
  // Toque no botão = a plataforma devolve o ID que NÓS mandamos. É o caso canônico da escada de
  // casamento; o texto livre e o número são os degraus seguintes, medidos logo abaixo.
  const { status, dados } = await testar('f_botoes', { estado: estadoBotoes, resposta: { interativo: { id: 'fin' } } });
  assert.equal(status, 200);
  const textos = dados.saidas.filter((s) => s.tipo === 'texto').map((s) => s.corpo);
  assert.ok(textos.some((t) => /Certo, financeiro/.test(t)), `saiu: ${textos.join(' | ')}`);
  assert.ok(textos.some((t) => /Até logo/.test(t)));
  assert.equal(dados.fim?.motivo, 'concluido');
  assert.ok(dados.trilha.some(([no, saida]) => no === 'menu' && saida === 'fin'),
    'a trilha tem de mostrar por qual saída o fluxo foi');
});

await medir('responder "2" (o número da opção) casa igual ao toque no botão', async () => {
  // É o mesmo casamento da produção: o cliente de um canal sem botão responde o número, e é isso
  // que faz a degradação para texto numerado da PortaCanal funcionar de verdade.
  const { dados } = await testar('f_botoes', { estado: estadoBotoes, resposta: '2' });
  assert.ok(dados.saidas.some((s) => s.tipo === 'texto' && /financeiro/i.test(s.corpo || '')),
    `o "2" não caiu na segunda opção: ${JSON.stringify(dados.trilha)}`);
});

await medir('resposta que não casa com nada volta pelo caminho de opção inválida', async () => {
  const { dados } = await testar('f_botoes', { estado: estadoBotoes, resposta: 'quero falar com o gerente' });
  assert.ok(dados.trilha.some(([no, saida]) => no === 'menu' && saida === 'opcao_invalida'),
    `trilha: ${JSON.stringify(dados.trilha)}`);
});

console.log('\n2) FLUXO COM CONDIÇÃO');

await medir('variável `plano=vip` bifurca pelo ramo verdadeiro', async () => {
  const { dados } = await testar('f_condicao', { vars: { plano: 'vip' } });
  assert.ok(dados.saidas.some((s) => /prioritário/i.test(s.corpo || '')), JSON.stringify(dados.saidas));
  assert.ok(dados.trilha.some(([no, s]) => no === 'ehvip' && s === 'verdadeiro'));
});

await medir('variável diferente bifurca pelo ramo falso — a MESMA condição, sem segunda regra', async () => {
  const { dados } = await testar('f_condicao', { vars: { plano: 'basico' } });
  assert.ok(dados.saidas.some((s) => /Já vamos te atender/i.test(s.corpo || '')), JSON.stringify(dados.saidas));
  assert.ok(dados.trilha.some(([no, s]) => no === 'ehvip' && s === 'falso'));
});

console.log('\n3) FLUXO QUE TRANSFERE');

await medir('a transferência termina a conversa no robô e diz para qual setor foi', async () => {
  const { dados } = await testar('f_transfere', {});
  assert.equal(dados.fim?.motivo, 'concluido');
  assert.equal(dados.fim?.estado, 'transferido', `fim: ${JSON.stringify(dados.fim)}`);
  const atribuir = dados.saidas.find((s) => s.tipo === 'atribuir');
  assert.ok(atribuir, `nenhuma intenção de atribuição: ${dados.saidas.map((s) => s.tipo).join(', ')}`);
  assert.equal(atribuir.timeId, 42);
});

console.log('\n4) FLUXO QUE CHEGA AO FIM');

await medir('o encerramento monta despedida, etiqueta, carimbo e a resolução da conversa', async () => {
  const { dados } = await testar('f_fim', {});
  const tipos = dados.saidas.map((s) => s.tipo);
  assert.ok(tipos.includes('texto'), tipos.join(', '));
  assert.ok(tipos.includes('etiqueta'), tipos.join(', '));
  assert.ok(tipos.includes('resolver'), tipos.join(', '));
  assert.equal(dados.fim?.motivo, 'concluido');
  assert.equal(dados.fim?.estado, 'concluido');
});

console.log('\n5) A PROMESSA QUE O TESTADOR FAZ NA TELA');

await medir('NADA foi gravado no banco durante as quatro conversas', async () => {
  assert.deepEqual(escrituras, [],
    `o testador escreveu no banco: ${escrituras.join(', ')} — a frase "nada foi gravado" seria mentira`);
});

await medir('a resposta declara, em português, que é simulação', async () => {
  const { dados } = await testar('f_fim', {});
  assert.match(dados.aviso, /nenhuma mensagem foi enviada/i);
  assert.match(dados.aviso, /nada foi gravado/i);
});

await medir('o relógio vem do BANCO, como em produção — e a resposta diz de onde veio', async () => {
  const { dados } = await testar('f_fim', {});
  assert.equal(dados.relogio.origem, 'banco');
});

await medir('fluxo que não existe (ou de outra empresa) devolve 404, nunca o documento', async () => {
  const { status, dados } = await testar('f_de_outra_empresa', {});
  assert.equal(status, 404);
  assert.equal(dados.error, 'Fluxo não encontrado.');
});

servidor.close();
console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
