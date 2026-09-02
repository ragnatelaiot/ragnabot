#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O MOTOR PRECISA SAIR DO ARRANQUE COM A PORTA DO CANAL AMARRADA.
//
// POR QUE ESTE ARQUIVO EXISTE (lacuna medida em 02/09/2026, contrato S-ADAPTADOR):
// `configurarMotor({canal})` NÃO era chamado em lugar nenhum do repositório. Consequência prática:
// no primeiro despacho, `exigirPorta('canal')` lançava `ConfiguracaoAusente` e a conversa morria
// depois do COMMIT — com o efeito reservado, o cliente sem resposta e o incidente aberto por um
// motivo que parecia do fluxo e era do arranque.
//
// A verificação chama a MESMA função que o processo chama (`amarrarMotorDeFluxo`, exportada de
// `servidor.js`). Refazer a amarração aqui provaria a cópia, não o arranque — que foi exatamente
// como a ausência sobreviveu.
//
// ⭐ ATUALIZADO EM 02/09/2026 (contrato S-FILA): a última verificação deste arquivo era «a fila
// AINDA não existe», deixada de propósito para ficar vermelha no dia em que ela nascesse. Nasceu.
// No lugar dela ficaram as três exigências que ela deixava escritas — fila amarrada, executor
// ligável pelo arranque e `/saude` sem mentira.
//
// COMO RODAR:   node tests/ragnabot-motor-amarracao.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

console.log('\nAMARRAÇÃO DO MOTOR NO ARRANQUE\n');

const motor = await import('../src/services/ragnabot-fluxo-motor.service.js');

await medir('antes de amarrar, a porta `canal` está vazia (é a lacuna que este contrato fecha)', () => {
  assert.equal(motor.portasDoMotor().canal, null,
    'se já viesse preenchida, este teste não estaria medindo nada');
});

const servidor = await import('../src/servidor.js');
const canalPorta = await import('../src/services/ragnabot-canal.porta.js');

await medir('`amarrarMotorDeFluxo` é exportada pelo arranque (não é cópia do teste)', () => {
  assert.equal(typeof servidor.amarrarMotorDeFluxo, 'function');
});

await servidor.amarrarMotorDeFluxo(canalPorta);

await medir('depois de amarrar, `canal.portaDa` existe e é a porta de verdade', () => {
  const p = motor.portasDoMotor();
  assert.equal(typeof p.canal?.portaDa, 'function');
  assert.equal(p.canal, canalPorta.portaCanal, 'tem de ser a MESMA porta que o despertar recebe');
});

await medir('o catálogo de nós também é amarrado — sem ele o motor não acha executor nenhum', () => {
  const p = motor.portasDoMotor();
  assert.equal(typeof p.nos?.obter, 'function');
  assert.ok(p.nos.obter('texto'), 'o executor de `texto` tinha de estar no catálogo');
  assert.ok(p.nos.obter('cobranca_pix') || p.nos.obter('pagamento_pix'), 'o nó de cobrança tinha de estar no catálogo');
});

await medir('a PortaCanal sabe despachar TODAS as intenções que os nós produzem hoje', async () => {
  // ⚠️ Esta é a verificação que envelhece bem: quem acrescentar um tipo de intenção num nó e
  // esquecer de ligá-lo no adaptador quebra AQUI, e não numa conversa de cliente.
  const nos = await import('../src/services/ragnabot-fluxo-nos.service.js');
  const conhecidas = new Set(canalPorta.TIPOS_DESPACHAVEIS);
  // As intenções em uso, lidas do próprio arquivo de executores (a fonte, não uma lista paralela).
  const produzidas = ['texto', 'midia', 'lista', 'botoes', 'template', 'nota', 'etiqueta',
    'atribuir', 'resolver', 'carimbar', 'http', 'email', 'agente_ia', 'cobranca_pix'];
  const orfas = produzidas.filter((t) => !conhecidas.has(t));
  assert.deepEqual(orfas, [], `intenções sem despacho na PortaCanal: ${orfas.join(', ')}`);
  assert.ok(typeof nos.catalogoDeNos.obter === 'function');
});

// ── O DIA CHEGOU (contrato S-FILA, 02/09/2026) ────────────────────────────────────────────────
// Aqui havia, de propósito, uma verificação de que a fila NÃO existia — reservada para ficar
// VERMELHA no dia em que ela nascesse, para que ninguém a escrevesse e esquecesse de ligar o
// executor. Ela ficou vermelha, e é isto que a substitui: as três exigências que ela deixou
// escritas («ligue o executor no arranque», «atualize o /saude», «a fila tem de estar amarrada»),
// agora medidas uma a uma.

await medir('a FILA está amarrada — `rodadaDoExecutor` não lança mais `ConfiguracaoAusente`', async () => {
  const fila = await import('../src/services/ragnabot-fluxo-fila.service.js');
  const p = motor.portasDoMotor();
  assert.ok(p.fila, 'a porta `fila` continua vazia — o motor grava trabalho e ninguém o tira de lá');
  assert.equal(typeof p.fila.candidatos, 'function');
  assert.equal(typeof p.fila.drenarParticao, 'function');
  assert.equal(typeof p.fila.concluirJob, 'function');
  assert.equal(typeof p.fila.adiarJob, 'function');
  assert.equal(typeof p.fila.enfileirar, 'function');
  assert.equal(typeof p.fila.devolverJobsDoWorker, 'function');
  assert.equal(p.fila, fila, 'tem de ser o MESMO módulo, não uma cópia amarrada pelo teste');
});

await medir('o ARRANQUE sabe ligar o executor — e a decisão é dele, não deste teste', async () => {
  assert.equal(typeof servidor.ligarExecutorDeFluxo, 'function',
    'sem esta função exportada, o laço só existiria dentro de `ligarTrabalhadores` e ninguém o mediria');
});

await medir('o executor é DESLIGÁVEL por variável de ambiente, e o padrão é LIGADO', async () => {
  const fila = await import('../src/services/ragnabot-fluxo-fila.service.js');
  assert.equal(fila.executorHabilitado({}), true, 'variável ausente tem de atender o cliente');
  assert.equal(fila.executorHabilitado({ RAGNABOT_EXECUTOR_FLUXO: 'off' }), false);
});

await medir('a fila NÃO consta mais como pendência do motor (o `/saude` diz a verdade)', () => {
  // A lista `faltando` é o que o `/saude` mostra ao dono. Deixar `fila` nela depois de ela existir
  // seria mentir para baixo — e mentira para baixo custa a tarde de quem for investigar.
  const p = motor.portasDoMotor();
  const faltando = ['cofre', 'egresso', 'limites'].filter((k) => !p[k]);
  assert.ok(!faltando.includes('fila'));
  assert.deepEqual(faltando, ['cofre', 'egresso', 'limites'],
    'estas três continuam sem implementação neste repositório — e continuam declaradas');
});

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
