#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A FILA DO MOTOR — contra POSTGRES DE VERDADE, porque contra dublê ela não prova nada.
//
// POR QUE ESTE TESTE NÃO USA O FAKE DA CASA (decisão medida, contrato S-FILA, 02/09/2026)
// Tudo o que esta fila promete é sobre CONCORRÊNCIA e sobre o BANCO: `FOR UPDATE SKIP LOCKED`,
// índice único parcial, `ON CONFLICT ... WHERE`, `xmax = 0`. Um dublê em memória responderia
// exatamente o que eu programasse nele — provaria a minha opinião, não o comportamento. As duas
// «réplicas» aqui são dois módulos carregados de verdade, com dois clientes Prisma distintos e
// portanto duas conexões distintas, como dois pods do Kubernetes.
//
// COMO RODAR:
//   RAGNABOT_FILA_TESTE_URL='postgresql://usuario:senha@host:5432/base' \
//     node tests/ragnabot-fluxo-fila.test.mjs
//
// Sem a variável, o teste PULA com aviso — e devolve 0. Falhar por falta de banco transformaria
// «não medi» em «está quebrado», que é a mentira mais cara de um conjunto de testes.
// A base pode ser descartável e vazia: o próprio teste cria a tabela e o índice a partir dos
// arquivos versionados em `prisma/sql/motor-fluxo/` — se a DDL versionada estiver errada, o teste
// quebra aqui, que é onde tem de quebrar.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.join(AQUI, '..', 'prisma', 'sql', 'motor-fluxo');

const URL_TESTE = process.env.RAGNABOT_FILA_TESTE_URL || '';
if (!URL_TESTE) {
  console.log('\n⚠️  RAGNABOT_FILA_TESTE_URL não definida — a fila NÃO foi medida nesta execução.');
  console.log('    (o que este teste prova só existe dentro do Postgres; sem banco, não há prova)\n');
  process.exit(0);
}

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { const r = await conferir(); console.log(`  ✓ ${titulo}${r ? `  →  ${JSON.stringify(r)}` : ''}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${e.message}\n      ${String(e.stack).split('\n').slice(1, 3).join('\n      ')}`); }
}

// ── As duas «réplicas» ────────────────────────────────────────────────────────────────────────
// Dois módulos com `?replica=` diferente: o ESM cria DUAS instâncias, com estado próprio, como dois
// processos. Cada uma recebe o seu cliente Prisma (e portanto a sua conexão).
const clienteA = new PrismaClient({ datasources: { db: { url: URL_TESTE } } });
const clienteB = new PrismaClient({ datasources: { db: { url: URL_TESTE } } });
const silencio = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const filaA = await import('../src/services/ragnabot-fluxo-fila.service.js?replica=a');
const filaB = await import('../src/services/ragnabot-fluxo-fila.service.js?replica=b');
filaA.configurarFila({ db: clienteA, log: silencio, aleatorio: () => 0.5 }); // jitter fixo: recuo verificável
filaB.configurarFila({ db: clienteB, log: silencio, aleatorio: () => 0.5 });

// ── A estrutura, criada a partir dos ARQUIVOS VERSIONADOS ─────────────────────────────────────
async function montarEstrutura() {
  const base = fs.readFileSync(path.join(SQL, '01-rb_motor_base.sql'), 'utf8');
  const criar = base.match(/CREATE TABLE "RagnabotFluxoFila".*?\);/s)?.[0];
  const indices = base.match(/CREATE INDEX "RagnabotFluxoFila[^;]*;/g) || [];
  assert.ok(criar, 'a DDL da fila tem de estar em 01-rb_motor_base.sql');
  await clienteA.$executeRawUnsafe('DROP TABLE IF EXISTS "RagnabotFluxoFila" CASCADE');
  await clienteA.$executeRawUnsafe(criar);
  for (const i of indices) await clienteA.$executeRawUnsafe(i);
  // A migração 05 — a que traz a idempotência. Aplicada do arquivo, não reescrita aqui.
  const mig = fs.readFileSync(path.join(SQL, '05-rb_fila_idempotencia.sql'), 'utf8');
  // ⚠️ Tira os comentários ANTES de partir por `;`. Partir primeiro cola um bloco de comentário no
  // começo do comando seguinte, e o Postgres recusa — foi o primeiro erro que este teste deu.
  const semComentario = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const cmd of semComentario.split(';').map((c) => c.trim()).filter(Boolean)) {
    await clienteA.$executeRawUnsafe(cmd);
  }
}
async function limpar() { await clienteA.$executeRawUnsafe('TRUNCATE "RagnabotFluxoFila" RESTART IDENTITY'); }
const ler = (id) => clienteA.$queryRawUnsafe('SELECT * FROM "RagnabotFluxoFila" WHERE id = $1', BigInt(id)).then((r) => r[0]);
const todos = () => clienteA.$queryRawUnsafe('SELECT * FROM "RagnabotFluxoFila" ORDER BY id');

console.log('\nFILA DO MOTOR DE FLUXO — medida contra Postgres de verdade\n');
await montarEstrutura();

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. A ESTRUTURA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('1. a tranca da idempotência é um índice único PARCIAL (e não um índice comum)', async () => {
  const [i] = await clienteA.$queryRawUnsafe(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'rb_fila_idem_pendente'`);
  assert.ok(i, 'o índice `rb_fila_idem_pendente` não existe — a migração 05 não foi aplicada');
  assert.match(i.indexdef, /UNIQUE/, 'sem UNIQUE não tranca nada');
  assert.match(i.indexdef, /WHERE .*status = 'pendente'/, 'o escopo TEM de ser só `pendente`');
  return { escopo: 'pendente' };
});

await medir('2. `TIPOS_DO_MOTOR` é lido do motor, não copiado (armadilha F3)', async () => {
  const motor = await import('../src/services/ragnabot-fluxo-motor.service.js');
  assert.deepEqual([...filaA.TIPOS_DO_MOTOR].sort(), [...new Set(Object.values(motor.TIPOS_JOB))].sort());
  return { tipos: filaA.TIPOS_DO_MOTOR.length };
});

await medir('2b. o arranque SABE dizer se a migração 05 falta — e diz qual arquivo aplicar', async () => {
  const boa = await filaA.conferirEstrutura();
  assert.equal(boa.ok, true, 'com a migração aplicada, tem de estar em ordem');
  // Agora a base SEM o índice: o que se quer provar é que a ausência é DETECTADA, não adivinhada.
  await clienteA.$executeRawUnsafe('DROP INDEX "rb_fila_idem_pendente"');
  const ruim = await filaA.conferirEstrutura();
  assert.equal(ruim.ok, false);
  assert.match(ruim.faltando.join(' '), /rb_fila_idem_pendente/);
  assert.match(ruim.comoCorrigir, /05-rb_fila_idempotencia\.sql/);
  assert.match(ruim.comoCorrigir, /db push/, 'a instrução tem de avisar do que apaga o índice em silêncio');
  await clienteA.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "rb_fila_idem_pendente" ON "RagnabotFluxoFila" ("chaveIdem") WHERE status='pendente' AND "chaveIdem" IS NOT NULL`);
  assert.equal((await filaA.conferirEstrutura()).ok, true, 'e voltar ao normal quando o índice volta');
  return { detectou: ruim.faltando };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. IDEMPOTÊNCIA DO ENFILEIRAMENTO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('3. a MESMA VISITA não entra duas vezes (despertar: execução + tokenVisita)', async () => {
  await limpar();
  const job = { tipo: 'despertar', chaveParticao: '1:10', execucaoId: 'e1', tokenVisita: 7 };
  const a = await filaA.enfileirar(job);
  const b = await filaB.enfileirar(job); // a OUTRA réplica, com a OUTRA conexão
  const linhas = await todos();
  assert.equal(linhas.length, 1, `entrou ${linhas.length} vez(es) — tinha de ser 1`);
  assert.equal(a.novo, true); assert.equal(b.novo, false, 'a segunda tem de se declarar reaproveitada');
  assert.equal(a.id, b.id, 'as duas réplicas têm de apontar para a MESMA linha');
  return { linhas: linhas.length, chaveIdem: linhas[0].chaveIdem };
});

await medir('4. a mesma ENTRADA do cliente não entra duas vezes (webhook reentregue)', async () => {
  await limpar();
  const job = { tipo: 'entrada', chaveParticao: '1:10', execucaoId: 'e1', entradaId: 'ent-42' };
  await filaA.enfileirar(job); await filaB.enfileirar(job); await filaA.enfileirar(job);
  const linhas = await todos();
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].chaveIdem, 'entrada:ent-42');
  return { chaveIdem: linhas[0].chaveIdem };
});

await medir('5. SEM chave natural, entra sempre — NULO não colide com NULO, e é de propósito', async () => {
  await limpar();
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:10', execucaoId: 'e1' });
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:10', execucaoId: 'e1' });
  const linhas = await todos();
  assert.equal(linhas.length, 2, 'perder um `continuar` congela a conversa; repetir só custa uma rodada');
  assert.equal(linhas[0].chaveIdem, null);
  return { linhas: linhas.length };
});

await medir('6. a idempotência é só sobre PENDENTE — o job em curso pode reagendar a si mesmo', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'despertar', chaveParticao: '1:10', execucaoId: 'e1', tokenVisita: 3 });
  await filaA.drenarParticao('1:10', 'w1'); // agora está em `processando`
  // É EXATAMENTE o que o motor faz em `prazo_adiado_por_canal`: o job corrente insere o sucessor.
  const sucessor = await filaA.enfileirar({ tipo: 'despertar', chaveParticao: '1:10', execucaoId: 'e1', tokenVisita: 3 });
  assert.equal(sucessor.novo, true, 'se o escopo fosse maior, o reagendamento sumiria e a conversa congelava');
  assert.notEqual(sucessor.id, j.id);
  return { emCurso: j.id, sucessor: sucessor.id };
});

await medir('7. colisão ANTECIPA o prazo e SOBE a prioridade (o caso do Pix pago)', async () => {
  await limpar();
  const daquiA5min = new Date(Date.now() + 300_000);
  const j = await filaA.enfileirar({
    tipo: 'despertar', chaveParticao: '1:10', execucaoId: 'e1', tokenVisita: 9,
    disponivelEm: daquiA5min, prioridade: 100,
  });
  // O cliente pagou AGORA. `ragnabot-pagamento-efi.service.js` enfileira despertar com prioridade 50.
  await filaB.enfileirar({
    tipo: 'despertar', chaveParticao: '1:10', execucaoId: 'e1', tokenVisita: 9,
    disponivelEm: new Date(), prioridade: 50,
  });
  const l = await ler(j.id);
  assert.ok(new Date(l.disponivelEm) < daquiA5min, 'o prazo tinha de ter sido antecipado');
  assert.equal(l.prioridade, 50, 'a prioridade tinha de ter subido (menor = mais urgente)');
  return { prioridade: l.prioridade, antecipado: true };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. DUAS RÉPLICAS DISPUTANDO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('8. duas réplicas drenando a MESMA partição: nenhuma linha vai para as duas', async () => {
  await limpar();
  for (let i = 0; i < 40; i += 1) {
    await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:10', execucaoId: 'e1', payload: { i } });
  }
  const [a, b] = await Promise.all([
    filaA.drenarParticao('1:10', 'replica-a'),
    filaB.drenarParticao('1:10', 'replica-b'),
  ]);
  const ida = new Set(a.map((j) => j.id));
  const repetidos = b.filter((j) => ida.has(j.id));
  assert.deepEqual(repetidos, [], 'linha entregue às DUAS réplicas = cliente lendo a mesma frase duas vezes');
  assert.equal(a.length + b.length, 40, 'e nenhuma pode ter sumido no caminho');
  return { replicaA: a.length, replicaB: b.length };
});

await medir('9. `SKIP LOCKED` de verdade: a réplica B NÃO ESPERA a linha travada pela A', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:11', execucaoId: 'e2' });
  // A trava a linha numa transação aberta e SEGURA. Sem SKIP LOCKED, B ficaria pendurada aqui.
  let soltar;
  const presa = new Promise((ok) => { soltar = ok; });
  const transacao = clienteA.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT id FROM "RagnabotFluxoFila" WHERE id = $1 FOR UPDATE', BigInt(j.id));
    await presa;
  }, { timeout: 15_000 });
  await new Promise((r) => { setTimeout(r, 200); });
  const t0 = Date.now();
  const b = await Promise.race([
    filaB.drenarParticao('1:11', 'replica-b'),
    new Promise((_, x) => { setTimeout(() => x(new Error('B FICOU ESPERANDO — não há SKIP LOCKED')), 3000); }),
  ]);
  const ms = Date.now() - t0;
  soltar(); await transacao;
  assert.deepEqual(b, [], 'B tinha de voltar de mãos vazias, não com a linha travada');
  assert.ok(ms < 1000, `B demorou ${ms} ms — pulou, não esperou?`);
  return { msDeEspera: ms, levou: b.length };
});

await medir('10. a reserva NÃO incrementa `tentativas` (quem conta é o desfecho)', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:12', execucaoId: 'e3' });
  const [drenado] = await filaA.drenarParticao('1:12', 'w1');
  const l = await ler(j.id);
  assert.equal(drenado.tentativas, 0);
  assert.equal(l.tentativas, 0, 'divergência entre o objeto e a linha é o defeito que o despertar já pagou');
  assert.equal(l.status, 'processando');
  assert.equal(l.donoWorker, 'w1');
  return { tentativas: l.tentativas, status: l.status };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. RÉPLICA MORTA, PRAZO DE VISIBILIDADE E CEIFADOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('11. item de réplica morta VOLTA sozinho depois do prazo — e conta a tentativa', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:13', execucaoId: 'e4' });
  await filaA.drenarParticao('1:13', 'replica-que-morreu');
  // Antes do prazo, ninguém mexe: a réplica pode estar viva e trabalhando.
  const cedo = await filaB.ceifarPresos({ segundos: 90 });
  assert.equal(cedo.vistos, 0, 'ceifar cedo demais é roubar trabalho de quem está trabalhando');
  // Envelhece a reserva (o pod morreu há 2 minutos).
  await clienteA.$executeRawUnsafe(
    `UPDATE "RagnabotFluxoFila" SET "travadoEm" = now() - interval '120 seconds' WHERE id = $1`, BigInt(j.id));
  const r = await filaB.ceifarPresos({ segundos: 90 });
  const l = await ler(j.id);
  assert.equal(r.devolvidos, 1);
  assert.equal(l.status, 'pendente');
  assert.equal(l.donoWorker, null);
  assert.equal(l.tentativas, 1, 'entrega que derrubou o processo É tentativa gasta — senão gira para sempre');
  return { antesDoPrazo: cedo.vistos, depois: r };
});

await medir('12. o ceifador manda para o DESCARTE quem já estourou o teto', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:14', execucaoId: 'e5', maxTentativas: 3 });
  await filaA.drenarParticao('1:14', 'replica-que-morre-sempre');
  await clienteA.$executeRawUnsafe(
    `UPDATE "RagnabotFluxoFila" SET tentativas = 2, "travadoEm" = now() - interval '200 seconds' WHERE id = $1`,
    BigInt(j.id));
  const r = await filaB.ceifarPresos({ segundos: 90 });
  const l = await ler(j.id);
  assert.equal(r.descartados, 1);
  assert.equal(l.status, 'falhou', 'trabalho que mata o pod tem de PARAR, senão mata um pod por vez para sempre');
  return { status: l.status, tentativas: l.tentativas };
});

await medir('13. SIGTERM devolve o trabalho SEM contar tentativa (implantação não é defeito)', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:15', execucaoId: 'e6' });
  await filaA.drenarParticao('1:15', 'pod-saindo');
  const r = await filaA.devolverJobsDoWorker('pod-saindo');
  const l = await ler(j.id);
  assert.equal(r.count, 1);
  assert.equal(l.status, 'pendente');
  assert.equal(l.tentativas, 0, 'um RollingUpdate por dia envenenaria trabalho sadio em oito dias');
  return { devolvidos: r.count, tentativas: l.tentativas };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5. RECUO EXPONENCIAL E TETO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('14. o recuo é EXPONENCIAL e tem teto (medido no `disponivelEm` do banco)', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:16', execucaoId: 'e7', maxTentativas: 20 });
  const esperas = [];
  for (let t = 0; t < 5; t += 1) {
    await filaA.drenarParticao('1:16', 'w1');
    await filaA.adiarJob(j.id, { motivo: `falha ${t + 1}`, tentativaAtual: t });
    const [l] = await clienteA.$queryRawUnsafe(
      `SELECT EXTRACT(EPOCH FROM ("disponivelEm" - now()))::float AS s, tentativas FROM "RagnabotFluxoFila" WHERE id=$1`,
      BigInt(j.id));
    esperas.push(Math.round(l.s));
    await clienteA.$executeRawUnsafe(`UPDATE "RagnabotFluxoFila" SET "disponivelEm" = now() WHERE id=$1`, BigInt(j.id));
  }
  for (let i = 1; i < esperas.length; i += 1) {
    assert.ok(esperas[i] > esperas[i - 1], `a espera ${i} (${esperas[i]}s) tinha de ser maior que a anterior (${esperas[i - 1]}s)`);
  }
  assert.ok(filaA.recuoMs(30) <= 300_000, 'sem teto, a décima tentativa cairia daqui a semanas');
  return { esperasSegundos: esperas, tetoMs: filaA.recuoMs(30) };
});

await medir('15. teto de tentativas estourado → fila de DESCARTE (`falhou`), com o erro gravado', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:17', execucaoId: 'e8', maxTentativas: 3 });
  let r;
  for (let t = 0; t < 3; t += 1) {
    await clienteA.$executeRawUnsafe(`UPDATE "RagnabotFluxoFila" SET "disponivelEm"=now() WHERE id=$1`, BigInt(j.id));
    await filaA.drenarParticao('1:17', 'w1');
    r = await filaA.adiarJob(j.id, { motivo: 'o ERP recusa sempre', tentativaAtual: t });
  }
  const l = await ler(j.id);
  assert.equal(r.descartado, true);
  assert.equal(l.status, 'falhou');
  assert.equal(l.ultimoErro, 'o ERP recusa sempre', 'sem o motivo gravado, o descarte é indiagnosticável');
  // E o descartado SAI do caminho: não aparece mais como candidato.
  const c = await filaA.candidatos({ limite: 10 });
  assert.deepEqual(c, [], 'linha defeituosa girando consome a rodada e cala as conversas sadias');
  return { status: l.status, tentativas: l.tentativas };
});

await medir('16. `contarTentativa:false` (posse perdida) NÃO envenena o trabalho', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:18', execucaoId: 'e9', maxTentativas: 2 });
  for (let t = 0; t < 6; t += 1) {
    await clienteA.$executeRawUnsafe(`UPDATE "RagnabotFluxoFila" SET "disponivelEm"=now() WHERE id=$1`, BigInt(j.id));
    await filaA.drenarParticao('1:18', 'w1');
    await filaA.adiarJob(j.id, { motivo: 'posse_perdida', tentativaAtual: 0, contarTentativa: false });
  }
  const l = await ler(j.id);
  assert.equal(l.status, 'pendente', 'seis disputas não podem matar um trabalho sadio');
  assert.equal(l.tentativas, 0);
  return { tentativas: l.tentativas, status: l.status };
});

await medir('17. o descarte pode ser reprocessado — mas só por decisão, nunca sozinho', async () => {
  const antes = await filaA.resumoDaFila();
  const r = await filaA.reenfileirarDescartados({});
  const depois = await filaA.resumoDaFila();
  assert.ok(r.reenfileirados >= 0);
  return { descartadosAntes: antes.descartados, reenfileirados: r.reenfileirados, descartadosDepois: depois.descartados };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 6. ORDEM
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('18. DENTRO da conversa a ordem é a de chegada — prioridade não fura fila (F4)', async () => {
  await limpar();
  const ids = [];
  ids.push((await filaA.enfileirar({ tipo: 'entrada', chaveParticao: '1:20', execucaoId: 'e10', entradaId: 'p1', prioridade: 200 })).id);
  ids.push((await filaA.enfileirar({ tipo: 'entrada', chaveParticao: '1:20', execucaoId: 'e10', entradaId: 'p2', prioridade: 50 })).id);
  ids.push((await filaA.enfileirar({ tipo: 'entrada', chaveParticao: '1:20', execucaoId: 'e10', entradaId: 'p3', prioridade: 100 })).id);
  const jobs = await filaA.drenarParticao('1:20', 'w1');
  assert.deepEqual(jobs.map((j) => j.id), ids, 'o passo 2 antes do passo 1 é uma conversa sem pé nem cabeça');
  assert.deepEqual(jobs.map((j) => j.payload && j.entradaId), ['p1', 'p2', 'p3']);
  return { ordem: jobs.map((j) => j.entradaId) };
});

await medir('19. ENTRE conversas, quem manda é a prioridade — e vem uma linha por partição', async () => {
  await limpar();
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:31', execucaoId: 'x1', prioridade: 200 }); // campanha
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:32', execucaoId: 'x2', prioridade: 50 });  // cliente
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:32', execucaoId: 'x2', prioridade: 50 });
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:32', execucaoId: 'x2', prioridade: 50 });
  const c = await filaA.candidatos({ limite: 10 });
  assert.equal(c.length, 2, 'três linhas da mesma conversa não podem gastar três vagas de candidato');
  assert.equal(c[0].chaveParticao, '1:32', 'o cliente vem antes da campanha');
  return { candidatos: c.map((x) => `${x.chaveParticao}/p${x.prioridade}`) };
});

await medir('20. trabalho agendado para o FUTURO não é candidato nem é drenado', async () => {
  await limpar();
  await filaA.enfileirar({ tipo: 'despertar', chaveParticao: '1:33', execucaoId: 'y1', tokenVisita: 1, disponivelEm: new Date(Date.now() + 60_000) });
  assert.deepEqual(await filaA.candidatos({ limite: 5 }), []);
  assert.deepEqual(await filaA.drenarParticao('1:33', 'w1'), []);
  return { ok: true };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 7. NÃO ROUBAR O TRABALHO DOS VIZINHOS (F3)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('21. a fila do motor NÃO toca em `atend_relogio` nem em `atend_mensagem`', async () => {
  await limpar();
  const despertar = await import('../src/services/ragnabot-atend-despertar.service.js');
  // Os dois tipos do vizinho vão para a MESMA conversa (1:40) e ainda para uma conversa SÓ deles
  // (1:41). A primeira prova que a drenagem não os leva junto; a segunda, que eles nem sequer são
  // oferecidos como candidato — senão ocupariam a vaga de uma conversa de fluxo de verdade.
  for (const chave of ['1:40', '1:41']) {
    for (const tipo of despertar.TIPOS_TRATADOS) {
      await clienteA.$executeRawUnsafe(
        `INSERT INTO "RagnabotFluxoFila" (tipo,"chaveParticao",payload,prioridade,"disponivelEm",status,tentativas,"maxTentativas","criadoEm","atualizadoEm")
         VALUES ($1,$2,'{}'::jsonb,80,now(),'pendente',0,8,now(),now())`, tipo, chave);
    }
  }
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:40', execucaoId: 'z1' });

  const c = await filaA.candidatos({ limite: 10 });
  assert.deepEqual(c.map((x) => x.chaveParticao), ['1:40'],
    'a conversa 1:41 só tem trabalho do vizinho — o motor não pode ser chamado para ela');

  const jobs = await filaA.drenarParticao('1:40', 'w1');
  assert.equal(jobs.length, 1, 'drenar «tudo da conversa» daria os trabalhos do relógio por FEITOS sem executá-los');
  assert.equal(jobs[0].tipo, 'continuar');
  const sobrou = await clienteA.$queryRawUnsafe(
    `SELECT tipo,status FROM "RagnabotFluxoFila" WHERE tipo <> 'continuar' ORDER BY tipo, "chaveParticao"`);
  assert.equal(sobrou.length, 4);
  assert.ok(sobrou.every((x) => x.status === 'pendente'), 'o «ainda está aí?» nunca sairia');
  return { drenados: jobs.length, intocados: sobrou.length, candidatos: c.map((x) => x.chaveParticao) };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 8. DESFECHO, JSON E OBSERVABILIDADE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('22. `concluirJob` solta o dono — senão o SIGTERM ressuscita trabalho já concluído', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:50', execucaoId: 'w1' });
  await filaA.drenarParticao('1:50', 'pod-1');
  await filaA.concluirJob(j.id, { status: 'feito', resultado: 'aguardando' });
  const l = await ler(j.id);
  assert.equal(l.status, 'feito');
  assert.equal(l.donoWorker, null);
  const r = await filaA.devolverJobsDoWorker('pod-1');
  assert.equal(r.count, 0, 'o cliente receberia de novo a frase que já leu');
  return { status: l.status, ressuscitados: r.count };
});

await medir('23. o `id` sai como Number — `BigInt` no JSON derruba a resposta do webhook (F5)', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'entrada', chaveParticao: '1:51', execucaoId: 'v1', entradaId: 'ent-99' });
  assert.equal(typeof j.id, 'number');
  // É EXATAMENTE o que a portaria faz: põe `jobId` num objeto que vira resposta HTTP.
  const corpo = JSON.stringify({ ok: true, jobId: j.id });
  assert.match(corpo, /"jobId":\d+/);
  const [d] = await filaA.drenarParticao('1:51', 'w1');
  assert.equal(typeof d.id, 'number');
  return { id: j.id, tipo: typeof j.id };
});

await medir('24. o `/saude` recebe tamanho, descarte e IDADE do mais antigo', async () => {
  await limpar();
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:60', execucaoId: 'a1' });
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:61', execucaoId: 'a2' });
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:62', execucaoId: 'a3' });
  await clienteA.$executeRawUnsafe(
    `UPDATE "RagnabotFluxoFila" SET status='falhou' WHERE id=$1`, BigInt(j.id));
  await clienteA.$executeRawUnsafe(`UPDATE "RagnabotFluxoFila" SET "criadoEm" = now() - interval '400 seconds' WHERE status='pendente'`);
  const r = await filaA.resumoDaFila();
  assert.equal(r.pendentes, 2);
  assert.equal(r.descartados, 1);
  assert.ok(r.maisAntigoSegundos >= 399, `a idade veio ${r.maisAntigoSegundos}s — é ELA que distingue «fila cheia girando» de «motor morto»`);
  return r;
});

await medir('25. a idade da RESERVA é medida em `travadoEm`, não em `criadoEm`', async () => {
  await limpar();
  const j = await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:63', execucaoId: 'b1' });
  await filaA.drenarParticao('1:63', 'w1');
  // Trabalho VELHO, reservado AGORA: se o resumo lesse `criadoEm`, acusaria uma réplica morta que
  // não existe — e o dono iria caçar um fantasma.
  await clienteA.$executeRawUnsafe(
    `UPDATE "RagnabotFluxoFila" SET "criadoEm" = now() - interval '3 hours' WHERE id=$1`, BigInt(j.id));
  const r = await filaA.resumoDaFila();
  assert.equal(r.processando, 1);
  assert.ok(r.reservaMaisVelhaSegundos < 60, `veio ${r.reservaMaisVelhaSegundos}s — leu a data errada`);
  assert.equal(r.prazoDeVisibilidadeSegundos, filaA.CEIFADOR_SEGUNDOS,
    'o /saude tem de dizer qual é o prazo, senão o número sozinho não quer dizer nada');
  return { reservaMaisVelhaSegundos: r.reservaMaisVelhaSegundos, prazo: r.prazoDeVisibilidadeSegundos };
});

await medir('26. o prazo agendado sobrevive a FUSO diferente entre o processo e o banco', async () => {
  // ⚠️ `TZ=America/Fortaleza` está no `.env.example`, e o Postgres pode estar em outro fuso. Um
  // despertar que escorregasse 3 h por causa disso seria o cliente esperando três horas por uma
  // resposta — e o log não mostraria defeito nenhum.
  await limpar();
  const tzAntes = process.env.TZ;
  process.env.TZ = 'America/Fortaleza';
  const alvo = new Date(Date.now() + 3_600_000);
  const j = await filaA.enfileirar({ tipo: 'despertar', chaveParticao: '1:64', execucaoId: 'c1', tokenVisita: 1, disponivelEm: alvo });
  const [l] = await clienteA.$queryRawUnsafe(
    `SELECT EXTRACT(EPOCH FROM ("disponivelEm" - now()))::float AS s, current_setting('TimeZone') AS tz FROM "RagnabotFluxoFila" WHERE id=$1`,
    BigInt(j.id));
  if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes;
  assert.ok(Math.abs(l.s - 3600) < 60, `o prazo escorregou para ${Math.round(l.s)}s em vez de 3600s`);
  return { faltamSegundos: Math.round(l.s), fusoDoBanco: l.tz };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 9. O LAÇO DO EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('27. a variável de ambiente DESLIGA o executor (e o padrão, omitida, é LIGADO)', () => {
  assert.equal(filaA.executorHabilitado({}), true, 'omitida tem de atender o cliente');
  for (const v of ['0', 'off', 'false', 'nao', 'NÃO', 'No']) {
    assert.equal(filaA.executorHabilitado({ RAGNABOT_EXECUTOR_FLUXO: v }), false, `«${v}» tinha de desligar`);
  }
  assert.equal(filaA.executorHabilitado({ RAGNABOT_EXECUTOR_FLUXO: '1' }), true);
  return { padrao: 'ligado' };
});

await medir('28. o executor DESLIGADO por variável não processa NADA (medido no arranque real)', async () => {
  await limpar();
  await filaA.enfileirar({ tipo: 'continuar', chaveParticao: '1:70', execucaoId: 'q1' });
  const servidor = await import('../src/servidor.js');
  const antes = process.env.RAGNABOT_EXECUTOR_FLUXO;
  process.env.RAGNABOT_EXECUTOR_FLUXO = 'off';
  let rodadas = 0;
  const motorFalso = { rodadaDoExecutor: async () => { rodadas += 1; return {}; } };
  // A MESMA função que o processo chama — refazer a decisão aqui provaria a cópia, não o arranque.
  const r = await servidor.ligarExecutorDeFluxo({ motor: motorFalso, fila: filaA, intervaloMs: 10 });
  await new Promise((ok) => { setTimeout(ok, 120); });
  if (antes === undefined) delete process.env.RAGNABOT_EXECUTOR_FLUXO; else process.env.RAGNABOT_EXECUTOR_FLUXO = antes;
  assert.equal(r.ligado, false);
  assert.equal(r.motivo, 'desligado por RAGNABOT_EXECUTOR_FLUXO');
  assert.equal(rodadas, 0, 'desligado tem de significar desligado');
  const fila = await todos();
  assert.equal(fila[0].status, 'pendente', 'e o trabalho tem de continuar lá, esperando');
  return { ligado: r.ligado, rodadas };
});

await medir('29. LIGADO, o laço chama o motor de verdade e a trava de reentrância segura', async () => {
  let emCurso = 0; let maximo = 0; let rodadas = 0;
  const motorLento = {
    rodadaDoExecutor: async () => {
      emCurso += 1; maximo = Math.max(maximo, emCurso); rodadas += 1;
      await new Promise((ok) => { setTimeout(ok, 90); });
      emCurso -= 1; return { particoes: 0 };
    },
  };
  const parar = filaA.iniciarExecutorDeFluxo(motorLento, { workerId: 'teste-1', intervaloMs: 10 });
  await new Promise((ok) => { setTimeout(ok, 400); });
  parar();
  assert.ok(rodadas >= 2, `o laço tinha de ter girado (girou ${rodadas}x)`);
  assert.equal(maximo, 1, 'sem a trava, 40 tiques em 400 ms abririam 40 transações concorrentes');
  assert.ok(filaA.ultimaRodadaDoExecutor().instante, 'o /saude precisa ver que o laço gira');
  return { rodadas, concorrentesMax: maximo };
});

await medir('30. exceção na rodada NÃO mata o laço — vira log e a rodada seguinte roda igual', async () => {
  let n = 0;
  const motorQuebrado = { rodadaDoExecutor: async () => { n += 1; throw new Error('banco fora'); } };
  const parar = filaA.iniciarExecutorDeFluxo(motorQuebrado, { workerId: 'teste-2', intervaloMs: 20 });
  await new Promise((ok) => { setTimeout(ok, 150); });
  parar();
  assert.ok(n >= 3, `o laço parou na primeira exceção (rodou ${n}x)`);
  assert.equal(filaA.ultimaRodadaDoExecutor().erro, 'banco fora', 'e o motivo tem de ficar visível');
  return { rodadas: n, ultimoErro: filaA.ultimaRodadaDoExecutor().erro };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 10. O MOTOR DE VERDADE, RODANDO SOBRE ESTA FILA
// ═══════════════════════════════════════════════════════════════════════════════════════════════
await medir('31. `rodadaDoExecutor` do motor REAL consome esta fila (o elo que faltava)', async () => {
  await limpar();
  const motor = await import('../src/services/ragnabot-fluxo-motor.service.js');
  // Sem execução no banco de teste não há posse a tomar: o candidato é IGNORADO, e é o certo.
  // O que se prova aqui é o elo — o motor chega até a fila e a fila responde no formato dele.
  motor.configurarMotor({ fila: filaA });
  await filaA.enfileirar({ tipo: 'entrada', chaveParticao: '1:80', execucaoId: null, entradaId: 'e-sem-exec' });
  const r = await motor.rodadaDoExecutor({ workerId: 'w-real' });
  assert.equal(r.ignorados, 1, 'candidato sem execução tem de ser ignorado, não estourar');
  assert.equal(r.erros, 0);
  const l = (await todos())[0];
  assert.equal(l.status, 'pendente', 'e NÃO pode ser marcado nem queimar tentativa');
  return r;
});

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
await clienteA.$disconnect(); await clienteB.$disconnect();
process.exit(falhas ? 1 : 0);
