// ════════════════════════════════════════════════════════════════════════════════════════════════
// TESTE DO ADAPTADOR DE AUDITORIA — prova que os 5 pontos que chamam `logAction` com o vocabulário
// do NOC chegam em `RagnabotAuditoria` com o vocabulário certo.
//
// O que ele NÃO faz: não toca em banco. `registrar()` é trocado por um espião, então o teste roda
// em qualquer máquina, sem a base `ragnabot` existir — que é a situação da Etapa 1.
//
// Como roda (o mock de módulo do Node ainda é experimental e exige a bandeira):
//   node --experimental-test-module-mocks src/base/testes/auditoria.test.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.NODE_ENV = 'test';

const capturados = [];
mock.module(new URL('../../services/ragnabot-auditoria.service.js', import.meta.url).href, {
  namedExports: { registrar: async (evento) => { capturados.push(evento); return { id: 'espiao' }; } },
});

const { logAction, extractIp } = await import('../auditoria.js');

let ok = 0;
function checa(nome, fn) {
  try { fn(); ok++; console.log(`   ✅ ${nome}`); }
  catch (e) { console.error(`   ❌ ${nome}\n      ${e.message}`); process.exitCode = 1; }
}

console.log('\n══ ADAPTADOR DE AUDITORIA — vocabulário do NOC → RagnabotAuditoria ══\n');

// 1) Como a cobrança e o provisionamento chamam: user + category do NOC + payloads + req.
await logAction({
  user: { id: 'u1', name: 'Emmanuel', email: 'e@exemplo', ragnabotTenantId: 't-9' },
  action: 'ragnabot.assinatura.criar', category: 'settings',
  entityType: 'RagnabotAssinatura', entityId: 'a1',
  description: 'Assinatura criada', payloadBefore: null, payloadAfter: { v: 1 },
  rollbackable: false,
  req: { headers: { 'cf-connecting-ip': '200.1.2.3', 'user-agent': 'curl/8' } },
});
// 2) Como o SSO chama: userId/userName soltos, `details` no lugar de `description`, ipAddress.
await logAction({
  userId: 'u2', userName: 'Ana', action: 'ragnabot_sso_entrada',
  details: 'Entrou como ana@exemplo', ipAddress: '::ffff:10.0.0.5',
});
// 3) Como um trabalhador chama: sem ator, com protocolo.
await logAction({ action: 'ragnabot_relogio_encerrou', tenantId: 't-9', protocolo: 'RB-1' });
// 4) Super user do NOC.
await logAction({ user: { id: 'u3', name: 'Root', isSuperuser: true }, action: 'x.y', category: 'auth' });
// 5) Chamada sem `action` não pode gravar linha nenhuma.
const nulo = await logAction({ description: 'sem acao' });

checa('só grava quando há ação', () => {
  assert.equal(capturados.length, 4);
  assert.equal(nulo, null);
});
checa('categoria do NOC "settings" vira "configuracao"', () => {
  assert.equal(capturados[0].categoria, 'configuracao');
});
checa('IP real sai do CF-Connecting-IP, não do req.ip', () => {
  assert.equal(capturados[0].ip, '200.1.2.3');
  assert.equal(capturados[0].userAgent, 'curl/8');
});
checa('empresa sai do vínculo do usuário, não da tela', () => {
  assert.equal(capturados[0].tenantId, 't-9');
  assert.equal(capturados[0].atorTipo, 'usuario');
});
checa('payloadBefore/After viram antes/depois', () => {
  assert.equal(capturados[0].antes, null);
  assert.deepEqual(capturados[0].depois, { v: 1 });
  assert.equal(capturados[0].entidade, 'RagnabotAssinatura');
  assert.equal(capturados[0].entidadeId, 'a1');
});
checa('estilo do SSO: userId/userName/details/ipAddress', () => {
  assert.equal(capturados[1].atorId, 'u2');
  assert.equal(capturados[1].atorNome, 'Ana');
  assert.equal(capturados[1].descricao, 'Entrou como ana@exemplo');
  assert.equal(capturados[1].categoria, 'acesso');
  assert.equal(capturados[1].ip, '10.0.0.5', 'IPv4 mapeado em IPv6 tem de ser limpo');
});
checa('sem ator = sistema; ter protocolo = atendimento', () => {
  assert.equal(capturados[2].atorTipo, 'sistema');
  assert.equal(capturados[2].categoria, 'atendimento');
  assert.equal(capturados[2].protocolo, 'RB-1');
});
checa('super user do NOC é marcado como "super"', () => {
  assert.equal(capturados[3].atorTipo, 'super');
  assert.equal(capturados[3].categoria, 'acesso');
});
checa('X-Forwarded-For: pega o primeiro IP PÚBLICO, não o salto interno', () => {
  assert.equal(extractIp({ headers: { 'x-forwarded-for': '172.17.1.1, 189.9.9.9, 10.0.0.1' } }), '189.9.9.9');
});
checa('sem req, o IP fica nulo em vez de quebrar', () => {
  assert.equal(capturados[3].ip, null);
  assert.equal(capturados[3].userAgent, null);
});

console.log(`\n══ ${ok} verificações passaram ══\n`);
