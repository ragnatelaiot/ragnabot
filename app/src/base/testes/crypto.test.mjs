// ════════════════════════════════════════════════════════════════════════════════════════════════
// TESTE DA CIFRAGEM — o ponto mais delicado da separação (doc 33 §2).
//
// O que ele prova, por observação e não por leitura:
//   1. ida e volta na implementação nova (cifra → decifra → mesmo texto);
//   2. formato do texto cifrado idêntico ao do NOC (ivHex:tagHex:cifradoHex, tamanhos batendo);
//   3. ⭐ COMPATIBILIDADE CRUZADA: o que o NOC cifrou, o Ragnabot decifra; e o que o Ragnabot
//      cifra, o NOC decifra. Se isto falhar, TODO segredo já gravado no banco vira lixo na
//      migração — e falha silenciosa, no meio de um atendimento.
//   4. tolerância a texto vazio, a valor sem ':' (legado em texto puro) e ao decryptSafe;
//   5. recusa de chave curta e de texto adulterado (a etiqueta GCM tem de barrar).
//
// Como roda:
//   ENCRYPTION_KEY=<64 hex> node src/base/testes/crypto.test.mjs
// A chave usada no teste é gerada na hora e NÃO é a de produção — este teste não precisa dela.
//
// A implementação do NOC é importada por caminho absoluto SÓ AQUI, para a comparação. Nenhum
// arquivo de produção do Ragnabot importa nada do NOC.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Chave de teste: 32 bytes → 64 hex. Definida ANTES de importar os módulos, porque os dois leem
// ENCRYPTION_KEY do ambiente no momento do import.
const CHAVE = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = CHAVE;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const rb = await import('../crypto.js');

// Caminho da implementação do NOC. Se o NOC não estiver nesta máquina, o teste 3 é PULADO e diz
// isso em voz alta — nunca finge que passou.
const CAMINHO_NOC = '/ia/netagent/src/utils/crypto.js';
let noc = null;
if (existsSync(CAMINHO_NOC)) {
  try {
    noc = await import(CAMINHO_NOC);
  } catch (e) {
    console.warn(`   ⚠️  não consegui importar a implementação do NOC: ${e.message}`);
  }
}

let ok = 0;
let pulados = 0;
function teste(nome, fn) {
  try {
    fn();
    ok++;
    console.log(`   ✅ ${nome}`);
  } catch (e) {
    console.error(`   ❌ ${nome}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n══ CIFRAGEM DO RAGNABOT — compatibilidade com o NOC ══\n');

const SEGREDOS = [
  'senha-simples',
  'token-com-dois-pontos:no:meio',
  'acentuação e emoji 🔐 — utf8 de verdade',
  'x'.repeat(4096),
  '{"json":"aninhado","n":1}',
];

teste('1. ida e volta na implementação do Ragnabot', () => {
  for (const s of SEGREDOS) {
    assert.equal(rb.decrypt(rb.encrypt(s)), s, `falhou para: ${s.slice(0, 30)}`);
  }
});

teste('2. formato do texto cifrado é ivHex:tagHex:cifradoHex', () => {
  const c = rb.encrypt('formato');
  const partes = c.split(':');
  assert.equal(partes.length, 3, 'deveria ter 3 partes separadas por ":"');
  assert.equal(partes[0].length, 32, 'IV tem de ser 16 bytes = 32 hex');
  assert.equal(partes[1].length, 32, 'etiqueta GCM tem de ser 16 bytes = 32 hex');
  assert.match(c, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/, 'tudo tem de ser hex minúsculo');
});

if (noc) {
  teste('3a. ⭐ o que o NOC cifrou, o Ragnabot DECIFRA', () => {
    for (const s of SEGREDOS) {
      const doNoc = noc.encrypt(s);
      assert.equal(rb.decrypt(doNoc), s, `o Ragnabot não abriu o segredo do NOC: ${s.slice(0, 30)}`);
    }
  });
  teste('3b. ⭐ o que o Ragnabot cifrou, o NOC DECIFRA (volta atrás é possível)', () => {
    for (const s of SEGREDOS) {
      const doRb = rb.encrypt(s);
      assert.equal(noc.decrypt(doRb), s, `o NOC não abriu o segredo do Ragnabot: ${s.slice(0, 30)}`);
    }
  });
  teste('3c. as duas implementações produzem o MESMO formato', () => {
    const a = noc.encrypt('igual').split(':').map((p) => p.length);
    const b = rb.encrypt('igual').split(':').map((p) => p.length);
    assert.deepEqual(a, b, 'tamanhos de iv/tag/cifrado divergem entre NOC e Ragnabot');
  });
} else {
  pulados += 3;
  console.log('   ⏭️  3a/3b/3c PULADOS — a implementação do NOC não está nesta máquina.');
  console.log('       (rodar de novo numa máquina com /ia/netagent antes de migrar dado cifrado)');
}

teste('4. vazio, nulo e legado em texto puro', () => {
  assert.equal(rb.encrypt(''), '', 'vazio cifra para vazio');
  assert.equal(rb.encrypt(null), '', 'nulo cifra para vazio');
  assert.equal(rb.decrypt('texto-puro-sem-dois-pontos'), 'texto-puro-sem-dois-pontos',
    'valor sem ":" é devolvido como está (campo legado)');
  assert.equal(rb.decryptSafe('texto-puro'), 'texto-puro');
  assert.equal(rb.decryptSafe('a:b:c'), 'a:b:c', 'decryptSafe devolve o original quando não abre');
});

teste('5. adulteração é RECUSADA pela etiqueta GCM', () => {
  const c = rb.encrypt('nao-me-mude');
  const [iv, tag, dados] = c.split(':');
  const trocado = dados.slice(0, -2) + (dados.slice(-2) === 'ff' ? '00' : 'ff');
  assert.throws(() => rb.decrypt(`${iv}:${tag}:${trocado}`), /authenticate|auth|state/i,
    'texto adulterado deveria falhar a verificação de integridade');
});

// Teste 6 roda em PROCESSO SEPARADO: o módulo lê ENCRYPTION_KEY no import e o cache do ESM não
// deixa reimportar com outra chave. Processo novo é a única prova honesta.
const filho = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const m = await import(${JSON.stringify(new URL('../crypto.js', import.meta.url).href)});
  try { m.encrypt('x'); console.log('NAO-LANCOU'); }
  catch (e) { console.log('LANCOU:' + e.message); }
`], {
  env: { ...process.env, ENCRYPTION_KEY: 'curta-demais', NODE_ENV: 'test' },
  encoding: 'utf8',
});

teste('6. chave curta é recusada com mensagem clara (processo separado)', () => {
  const saida = (filho.stdout || '') + (filho.stderr || '');
  assert.match(saida, /LANCOU:.*at least 64 hex/i,
    `esperava erro de chave curta; saiu: ${saida.trim().slice(0, 200)}`);
});

console.log(`\n══ ${ok} verificações passaram, ${pulados} puladas ══\n`);
if (process.exitCode) console.error('❌ HÁ FALHA — não migre dado cifrado antes de resolver.\n');
