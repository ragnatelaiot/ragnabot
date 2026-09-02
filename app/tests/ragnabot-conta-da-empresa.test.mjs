#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A PONTE empresa↔plataforma: `RagnabotTenant.cwAccountId` aponta mesmo para uma CONTA?
//
// POR QUE ESTE ARQUIVO EXISTE — defeito REAL, medido em 02/09/2026, antes de ligar o webhook:
// a única empresa cadastrada tinha `cwAccountId = 35`. Só que 35 não é conta nenhuma: é o id da
// CAIXA DE ENTRADA do Facebook dentro da conta 1, que é a conta de verdade (com os 6 usuários e as
// 4 caixas). Medição na plataforma, Chatwoot 4.17.1, Platform API:
//     GET /platform/api/v1/accounts/1   → 401 {"error":"Non permissible resource"}   = EXISTE
//     GET /platform/api/v1/accounts/35  → 404 {"status":404,"error":"Not Found"}     = NÃO existe
// (401 "Non permissible" é a resposta esperada para conta criada à mão: um Platform App só
// enxerga o que ELE criou. Por isso só o 404 é prova de que o número está errado.)
//
// O ESTRAGO, se ninguém tivesse olhado: o webhook resolve a empresa por `cwAccountId`. Com o
// número errado, TODO evento cairia em "empresa não mapeada" — 2xx, descartado, com registro — e o
// sintoma para quem olha de fora seria só "o robô não responde", sem nada apontando para o
// cadastro. Defeito mudo e longe da causa: o tipo que custa mais caro.
//
// COMO RODAR:  node tests/ragnabot-conta-da-empresa.test.mjs
// (o vitest só varre `.test.js`; este é `.test.mjs` de propósito, como os irmãos)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { conferirIdDeConta, exigirIdDeContaValido } from '../src/services/ragnabot-tenant.service.js';

// ── Dublês das QUATRO respostas medidas da plataforma ──────────────────────────────────────────
// Não é opinião sobre o Chatwoot: é o corpo que ele devolveu de verdade, colado aqui.
class ErroPlat extends Error {
  constructor(mensagem, status, corpo) { super(mensagem); this.status = status; this.corpo = corpo; }
}
const CONTA_EXISTE_E_E_MINHA = async (id) => ({ id, name: 'Empresa' });
const CONTA_EXISTE_FORA_DO_APP = async () => {
  throw new ErroPlat('A plataforma respondeu 401', 401, { error: 'Non permissible resource' });
};
const CONTA_NAO_EXISTE = async () => {
  throw new ErroPlat('A plataforma respondeu 404', 404, { status: 404, error: 'Not Found' });
};
const PLATAFORMA_FORA = async () => { throw new ErroPlat('Falha de rede: ECONNREFUSED', null, null); };
const TOKEN_RECUSADO = async () => {
  throw new ErroPlat('A plataforma respondeu 401', 401, { error: 'Invalid access_token' });
};

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('conta que EXISTE e é do Platform App (200) → confere', async () => {
  const r = await conferirIdDeConta(1, { consultar: CONTA_EXISTE_E_E_MINHA });
  assert.equal(r.situacao, 'confere');
  assert.equal(r.existe, true);
  return r.situacao;
});

teste('conta que EXISTE mas é de fora do Platform App (401 "Non permissible") → confere', async () => {
  // Este é o caso da conta 1 REAL: criada à mão, então o Platform App não a enxerga. Tratar este
  // 401 como "conta inválida" recusaria justamente o número CERTO.
  const r = await conferirIdDeConta(1, { consultar: CONTA_EXISTE_FORA_DO_APP });
  assert.equal(r.situacao, 'confere');
  assert.equal(r.existe, true);
  await exigirIdDeContaValido(1, { consultar: CONTA_EXISTE_FORA_DO_APP }); // não lança
  return r.situacao;
});

teste('O CASO DO ID TROCADO: 35 (id de CAIXA) responde 404 → recusa com mensagem que ensina', async () => {
  const r = await conferirIdDeConta(35, { consultar: CONTA_NAO_EXISTE });
  assert.equal(r.situacao, 'inexistente');
  assert.equal(r.existe, false);
  assert.match(r.mensagem, /CAIXA DE ENTRADA/, 'a mensagem tem de apontar o engano real, não só "inválido"');
  assert.match(r.mensagem, /inbox/, 'e mostrar onde ler o número certo (a URL do painel)');

  await assert.rejects(
    () => exigirIdDeContaValido(35, { consultar: CONTA_NAO_EXISTE }),
    /Não existe conta 35/,
    'a recusa é DURA: o cadastro não passa com um id que a plataforma prova não existir',
  );
  return r.situacao;
});

teste('plataforma FORA → indeterminado, e NÃO bloqueia (guarda que trava por dúvida vira guarda contornada)', async () => {
  const r = await conferirIdDeConta(7, { consultar: PLATAFORMA_FORA });
  assert.equal(r.situacao, 'indeterminado');
  assert.equal(r.existe, null);
  await exigirIdDeContaValido(7, { consultar: PLATAFORMA_FORA }); // não lança
  return r.situacao;
});

teste('token RECUSADO (401 "Invalid access_token") → indeterminado, não "conta inexistente"', async () => {
  // Confundir os dois 401 já custou caro nesta casa (30/08/2026: o /saude gritava token inválido
  // com o provisionamento funcionando). Aqui o custo seria pior: recusar um cadastro certo.
  const r = await conferirIdDeConta(9, { consultar: TOKEN_RECUSADO });
  assert.equal(r.situacao, 'indeterminado');
  return r.situacao;
});

teste('número que nem é número → recusado sem sair para a rede', async () => {
  let saiu = false;
  const espiao = async () => { saiu = true; };
  for (const ruim of [0, -3, 1.5, 'abc', null, undefined]) {
    const r = await conferirIdDeConta(ruim, { consultar: espiao });
    assert.equal(r.situacao, 'inexistente', `deveria recusar ${JSON.stringify(ruim)}`);
  }
  assert.equal(saiu, false, 'lixo é barrado localmente — não gasta chamada na plataforma');
  return 'recusou 6 entradas ruins sem tocar na plataforma';
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nPONTE EMPRESA↔PLATAFORMA — o id da conta é mesmo de uma CONTA?\n');
let passou = 0; let falhou = 0;
for (const [nome, fn] of testes) {
  try { const r = await fn(); passou += 1; console.log(`  PASSOU  ${nome}${r ? `\n            -> ${JSON.stringify(r)}` : ''}`); }
  catch (e) { falhou += 1; console.log(`  FALHOU  ${nome}\n            ${e.message}`); }
}
console.log(`\n  ${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
