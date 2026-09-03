#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// API PÚBLICA POR EMPRESA + ASSINATURA HMAC — contrato S6 (02/09/2026), doc 34 §F9.4
//
// O QUE ESTE ARQUIVO TENTA REPROVAR, e cada item é uma exigência escrita do contrato:
//   · «segredo por empresa nunca em texto puro no banco, com impressão digital para conferência»
//   · «e NUNCA em log»
//   · «regenerar credencial invalida a anterior»
//   · «a assinatura HMAC do webhook de saída confere»
//
// ⚠️ O QUE ELE NÃO PROVA: que um cliente REAL consegue conferir a assinatura do outro lado. Isso é
// medição de integração, e em 02/09/2026 não há nenhum webhook cadastrado. O que se prova aqui é
// que o hex que emitimos é o HMAC-SHA256 do corpo — conferido contra o `crypto` do Node calculado
// por FORA do nosso código, que é o único jeito de o teste não provar a si mesmo.
//
// COMO RODAR:  node tests/ragnabot-api-publica.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// A chave de cifragem: 64 hex. Valor de TESTE, gerado aqui e jogado fora ao fim do processo —
// nenhum segredo de verdade entra em arquivo versionado (Lei 1 da casa).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';

import { criarFakeSimples } from './fixtures/fake-prisma-simples.mjs';

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const assinatura = await import('../src/base/assinatura.js');
const api = await import('../src/services/ragnabot-api-publica.service.js');
const cripto = await import('../src/base/crypto.js');

// ── O LOG É CAPTURADO, e é ele que prova a regra «segredo nunca em log» ────────────────────────
const LINHAS_DE_LOG = [];
const logEspiao = {
  info: (m) => LINHAS_DE_LOG.push(String(m)),
  warn: (m) => LINHAS_DE_LOG.push(String(m)),
  error: (m) => LINHAS_DE_LOG.push(String(m)),
  debug: (m) => LINHAS_DE_LOG.push(String(m)),
};

const TENANT = 'empresa-1';
const db = criarFakeSimples(['ragnabotApiCredencial'], { ragnabotApiCredencial: [['chave']] });
api.configurarApiPublica({ db, log: logEspiao, auditoria: { registrar: async () => null } });

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n1) A ASSINATURA — a MESMA peça para receber e para enviar');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('o hex emitido É o HMAC-SHA256 do corpo (conferido por fora, com o crypto do Node)', () => {
  const segredo = 'segredo-de-teste';
  const corpo = JSON.stringify({ evento: 'conversa.criada', id: 'abc' });
  const esperado = crypto.createHmac('sha256', segredo).update(Buffer.from(corpo, 'utf8')).digest('hex');
  const r = assinatura.assinar(segredo, corpo);
  assert.equal(r.hex, esperado);
  assert.equal(r.assinatura, `sha256=${esperado}`);
});

await medir('o formato é o da Meta: cabeçalho `x-hub-signature-256`, valor `sha256=<hex>`', () => {
  assert.equal(assinatura.CABECALHO_ASSINATURA, 'x-hub-signature-256');
  const { assinatura: v } = assinatura.assinar('s', 'x');
  assert.match(v, /^sha256=[0-9a-f]{64}$/u);
});

await medir('conferir aceita COM e SEM o prefixo, e ignora a caixa das letras', () => {
  const s = 'abc'; const corpo = '{"a":1}';
  const { hex } = assinatura.assinar(s, corpo);
  assert.equal(assinatura.conferir(s, corpo, hex), true);
  assert.equal(assinatura.conferir(s, corpo, `sha256=${hex}`), true);
  assert.equal(assinatura.conferir(s, corpo, `SHA256=${hex.toUpperCase()}`), true);
});

await medir('UM BYTE diferente no corpo reprova a assinatura', () => {
  const s = 'abc';
  const { hex } = assinatura.assinar(s, '{"a":1}');
  assert.equal(assinatura.conferir(s, '{"a":2}', hex), false);
});

await medir('segredo diferente reprova', () => {
  const { hex } = assinatura.assinar('segredo-a', 'corpo');
  assert.equal(assinatura.conferir('segredo-b', 'corpo', hex), false);
});

await medir('cabeçalho ausente, vazio ou malformado devolve FALSO — nunca lança', () => {
  for (const ruim of [undefined, null, '', 'sha256=', 'lixo', 'sha256=zz', 'a'.repeat(64)]) {
    assert.equal(assinatura.conferir('s', 'c', ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

await medir('segredo vazio NUNCA assina (assinatura que qualquer um reproduz é pior que nenhuma)', () => {
  assert.throws(() => assinatura.assinar('', 'corpo'), /segredo vazio/u);
  assert.equal(assinatura.conferir('', 'corpo', 'a'.repeat(64)), false);
});

await medir('⚠️ os BYTES assinados são os que devem ser enviados — reserializar quebraria tudo', () => {
  // Objeto com chaves fora de ordem e acento: `JSON.stringify(JSON.parse(x))` não devolve `x`.
  const objeto = { b: 'ção', a: 1 };
  const r = assinatura.assinar('s', objeto);
  assert.ok(Buffer.isBuffer(r.corpo));
  // A assinatura confere contra os BYTES devolvidos...
  assert.equal(assinatura.conferir('s', r.corpo, r.hex), true);
  // ...e o corpo devolvido é exatamente o que foi assinado.
  assert.equal(r.corpo.toString('utf8'), JSON.stringify(objeto));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2) A CREDENCIAL — cifrada, com digital, e nunca em log');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const emissao = await api.emitirCredencial(TENANT, { nome: 'ERP do cliente', escopos: ['ler', 'escrever'] }, { ator: { id: 'u1', name: 'Operador' } });

await medir('a emissão devolve o segredo em claro — a ÚNICA vez que ele existe fora do banco', () => {
  assert.ok(emissao.segredo);
  assert.match(emissao.segredo, /^[0-9a-f]{64}$/u);
  assert.match(emissao.credencial.chave, /^rgtk_[0-9a-f]{32}$/u);
});

await medir('⛔ o banco NÃO guarda o segredo em texto puro', () => {
  const linha = db.__tabelas.ragnabotApiCredencial[0];
  assert.ok(linha.segredoCifrado);
  assert.notEqual(linha.segredoCifrado, emissao.segredo, 'o campo guardou o segredo CRU');
  assert.ok(!JSON.stringify(linha).includes(emissao.segredo), 'o segredo apareceu em ALGUM campo da linha');
  // formato do AES-256-GCM da casa: ivHex:tagHex:cifradoHex
  assert.match(linha.segredoCifrado, /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/u);
});

await medir('o cifrado ABRE de volta com a chave da casa (não é hash de mão única por engano)', () => {
  const linha = db.__tabelas.ragnabotApiCredencial[0];
  assert.equal(cripto.decrypt(linha.segredoCifrado), emissao.segredo);
});

await medir('a IMPRESSÃO DIGITAL identifica o segredo sem permitir reconstruí-lo', () => {
  const linha = db.__tabelas.ragnabotApiCredencial[0];
  assert.match(linha.segredoDigital, /^sha256:[0-9a-f]{16}$/u);
  assert.equal(linha.segredoDigital, assinatura.digitalDoSegredo(emissao.segredo));
  assert.ok(!linha.segredoDigital.includes(emissao.segredo.slice(0, 16)));
});

await medir('⛔ o segredo NUNCA aparece no log — nem inteiro, nem em pedaço de 16 caracteres', () => {
  const tudo = LINHAS_DE_LOG.join('\n');
  assert.ok(tudo.length > 0, 'o teste precisa ter capturado algum log para valer');
  assert.ok(!tudo.includes(emissao.segredo), 'o SEGREDO vazou para o log');
  assert.ok(!tudo.includes(emissao.segredo.slice(0, 16)), 'um pedaço do segredo vazou para o log');
  assert.ok(tudo.includes(emissao.credencial.chave), 'a CHAVE (pública) deveria estar no log, para o suporte achar a credencial');
});

await medir('⛔ a LISTAGEM não devolve o segredo, nem o cifrado', async () => {
  const lista = await api.listarCredenciais(TENANT);
  const texto = JSON.stringify(lista);
  assert.ok(!texto.includes(emissao.segredo));
  assert.ok(!texto.includes('segredoCifrado'));
  assert.ok(!texto.includes(db.__tabelas.ragnabotApiCredencial[0].segredoCifrado));
  assert.ok(texto.includes(emissao.credencial.digital), 'a digital DEVE sair — é como se confere sem revelar');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3) AUTENTICAR');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('o par certo autentica e devolve a empresa e os escopos', async () => {
  const r = await api.autenticar({ chave: emissao.credencial.chave, segredo: emissao.segredo, ip: '203.0.113.7' });
  assert.equal(r.ok, true);
  assert.equal(r.tenantId, TENANT);
  assert.deepEqual(r.escopos, ['ler', 'escrever']);
});

await medir('o uso é contabilizado (é como se sabe que uma credencial ainda é usada)', () => {
  const linha = db.__tabelas.ragnabotApiCredencial[0];
  assert.equal(linha.usos, 1);
  assert.ok(linha.ultimoUsoEm);
  assert.equal(linha.ultimoUsoIp, '203.0.113.7');
});

await medir('segredo errado recusa — e a frase é IGUAL à de chave inexistente', async () => {
  const a = await api.autenticar({ chave: emissao.credencial.chave, segredo: 'errado' });
  const b = await api.autenticar({ chave: 'rgtk_00000000000000000000000000000000', segredo: 'qualquer' });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.motivo, b.motivo, 'recusas diferentes ensinariam a enumerar chaves válidas');
});

await medir('escopo é conferível', () => {
  assert.equal(api.temEscopo(['ler'], 'escrever'), false);
  assert.equal(api.temEscopo(['ler', 'escrever'], 'escrever'), true);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4) ⭐ REGENERAR INVALIDA A ANTERIOR');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const regeneracao = await api.regenerarCredencial(TENANT, emissao.credencial.id, { motivo: 'suspeita de vazamento' }, { ator: { id: 'u2', name: 'Chefe' } });

await medir('a nova credencial autentica', async () => {
  const r = await api.autenticar({ chave: regeneracao.credencial.chave, segredo: regeneracao.segredo });
  assert.equal(r.ok, true);
  assert.equal(r.tenantId, TENANT);
});

await medir('⭐ a ANTIGA parou de valer NA HORA — mesmo com o par exato de antes', async () => {
  const r = await api.autenticar({ chave: emissao.credencial.chave, segredo: emissao.segredo });
  assert.equal(r.ok, false, 'a credencial antiga continuou autenticando: isto NÃO é rotação');
});

await medir('a chave e o segredo mudaram os dois (não é só um carimbo novo)', () => {
  assert.notEqual(regeneracao.credencial.chave, emissao.credencial.chave);
  assert.notEqual(regeneracao.segredo, emissao.segredo);
  assert.notEqual(regeneracao.credencial.digital, emissao.credencial.digital);
});

await medir('a antiga fica REVOGADA com motivo, autor e o vínculo com a substituta', () => {
  const antiga = db.__tabelas.ragnabotApiCredencial.find((l) => l.chave === emissao.credencial.chave);
  assert.equal(antiga.ativa, false);
  assert.ok(antiga.revogadaEm);
  assert.equal(antiga.revogadaPorUserId, 'u2');
  assert.match(antiga.motivoRevogacao, /vazamento/u);
  assert.equal(regeneracao.credencial.substituiuId, emissao.credencial.id, 'sem o vínculo, a trilha de quem usava a anterior morre');
});

await medir('regenerar uma já revogada é RECUSADO com explicação, não silenciosamente repetido', async () => {
  await assert.rejects(
    () => api.regenerarCredencial(TENANT, emissao.credencial.id, {}, { ator: { id: 'u2' } }),
    /já está revogada/u,
  );
});

await medir('nenhum segredo (velho ou novo) chegou ao log em nenhum momento', () => {
  const tudo = LINHAS_DE_LOG.join('\n');
  assert.ok(!tudo.includes(emissao.segredo));
  assert.ok(!tudo.includes(regeneracao.segredo));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5) ISOLAMENTO ENTRE EMPRESAS');
// ═══════════════════════════════════════════════════════════════════════════════════════════════

await medir('credencial de OUTRA empresa responde "não encontrada" — 404, não 403', async () => {
  try {
    await api.regenerarCredencial('empresa-2', regeneracao.credencial.id, {}, { ator: { id: 'u1' } });
    assert.fail('devia ter recusado');
  } catch (e) {
    assert.equal(e.status, 404, '403 confirmaria ao curioso que este id existe');
    assert.equal(e.code, 'CREDENCIAL_NAO_ENCONTRADA');
  }
});

await medir('a listagem da empresa 2 é vazia — nada da empresa 1 escapa', async () => {
  assert.deepEqual(await api.listarCredenciais('empresa-2'), []);
});

await medir('nome fora de 2..80 caracteres é recusado com o porquê', async () => {
  await assert.rejects(() => api.emitirCredencial(TENANT, { nome: 'x' }), /nome à credencial/u);
});

await medir('escopo inventado é recusado, listando os conhecidos', async () => {
  await assert.rejects(() => api.emitirCredencial(TENANT, { nome: 'Teste', escopos: ['apagar'] }), /Conhecidos: ler, escrever/u);
});

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
