// Prova COMPORTAMENTAL das quatro garantias. Tudo numa transação que termina em ROLLBACK
// deliberado: é banco de PRODUÇÃO e nenhuma linha de teste pode sobreviver ao teste.
import prisma from '/ia/netagent/src/database/client.js';
const T_A = 'tenant-teste-A', T_B = 'tenant-teste-B';
const resultados = [];
// Cada prova roda dentro de um SAVEPOINT. Sem isso, o primeiro erro aborta a transação inteira
// (SQLSTATE 25P02) e as provas seguintes nem chegam a ser feitas — foi o que aconteceu na
// primeira tentativa desta medição.
let tx = null, sp = 0;
const provar = async (nome, fn) => {
  const p = `sp${++sp}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${p}`);
  try { await fn(); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${p}`); resultados.push(['FALHOU (NÃO recusou)', nome]); }
  catch (e) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${p}`);
    resultados.push([`RECUSOU: ${String(e.message).split('\n').map(x=>x.trim()).filter(Boolean).pop().slice(0,120)}`, nome]);
  }
};

try {
  await prisma.$transaction(async (_tx) => {
    tx = _tx;
    const base = { hashDocumento:'h1', hashEstrutura:'e1', noInicialId:'n1',
                   perfilLimite:'whatsapp_cloud@2026-08', documento:{nos:[],arestas:[]} };
    const fA = await tx.ragnabotFluxo.create({ data:{ tenantId:T_A, nome:'teste-A' } });
    const vA = await tx.ragnabotFluxoVersao.create({ data:{ ...base, fluxoId:fA.id, tenantId:T_A, numero:1 } });
    resultados.push(['OK', `versão criada (INSERT permitido): numero=${vA.numero}`]);

    await provar('UPDATE em RagnabotFluxoVersao (imutabilidade)', () =>
      tx.$executeRawUnsafe(`UPDATE "RagnabotFluxoVersao" SET "notaPublicacao"='adulterado' WHERE id=$1`, vA.id));

    // D5: duas arestas na MESMA saída do mesmo nó.
    await tx.ragnabotFluxoAresta.create({ data:{ versaoId:vA.id, tenantId:T_A, de:'n1', saida:'padrao', para:'n2' } });
    resultados.push(['OK', 'primeira aresta (n1/padrao → n2) aceita']);
    await provar('segunda aresta na MESMA saída — o fan-out acidental D5', () =>
      tx.ragnabotFluxoAresta.create({ data:{ versaoId:vA.id, tenantId:T_A, de:'n1', saida:'padrao', para:'n9' } }));

    // FK composta: aresta da empresa B apontando para versão da empresa A.
    await provar('aresta do tenant B amarrada a versão do tenant A (junção cruzada)', () =>
      tx.ragnabotFluxoAresta.create({ data:{ versaoId:vA.id, tenantId:T_B, de:'x', saida:'padrao', para:'y' } }));

    // Índice único parcial: duas execuções VIVAS na mesma conversa.
    const exec = { tenantId:T_A, cwAccountId:999001, cwConversationId:999001, fluxoId:fA.id,
                   versaoId:vA.id, versaoInicialId:vA.id, expiraEm:new Date(Date.now()+3600e3) };
    await tx.ragnabotFluxoExecucao.create({ data:{ ...exec, estado:'esperando' } });
    resultados.push(['OK', "primeira execução viva (estado='esperando') aceita"]);
    await provar("segunda execução VIVA na mesma conversa (estado='pausado_humano')", () =>
      tx.ragnabotFluxoExecucao.create({ data:{ ...exec, estado:'pausado_humano' } }));
    // ...mas retomada legítima PRECISA nascer: 'concluido' está FORA do índice.
    await tx.ragnabotFluxoExecucao.create({ data:{ ...exec, estado:'concluido' } });
    resultados.push(['OK', "execução 'concluido' na MESMA conversa aceita (retomada legítima nasce)"]);

    throw new Error('__ROLLBACK_DELIBERADO__');
  });
} catch (e) {
  if (!String(e.message).includes('__ROLLBACK_DELIBERADO__')) { console.error('ERRO INESPERADO:', e.message); process.exit(1); }
}

for (const [v, n] of resultados) console.log(`  [${v}]\n      ${n}`);

// Confirma que o rollback levou tudo embora.
const sobrou = await prisma.$queryRawUnsafe(
  `SELECT (SELECT count(*) FROM "RagnabotFluxo")::int a, (SELECT count(*) FROM "RagnabotFluxoVersao")::int b,
          (SELECT count(*) FROM "RagnabotFluxoAresta")::int c, (SELECT count(*) FROM "RagnabotFluxoExecucao")::int d`);
console.log('\nApós o ROLLBACK — fluxo/versao/aresta/execucao:', JSON.stringify(sobrou[0]));
await prisma.$disconnect();
