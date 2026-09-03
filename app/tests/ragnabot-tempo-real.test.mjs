#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O TEMPO REAL DA CAIXA (contrato S-TEMPO-REAL, 03/09/2026 — doc 35 §6.8)
//
// POR QUE ESTE ARQUIVO EXISTE
// O contrato tem três frases que decidem se a entrega vale, e nenhuma delas se prova lendo código:
//
//   1. «um evento publicado numa réplica chega a um cliente conectado na OUTRA» — é A armadilha
//      desta entrega. O motor roda com 2 pods. Sem canal comum, o defeito é intermitente e SOME
//      quando alguém testa com um pod só. Aqui a prova é com DOIS PROCESSOS DE VERDADE, PIDs
//      diferentes, no MESMO Postgres — não com dois objetos na mesma memória, que provariam nada;
//   2. «o isolamento do S2 vale no tempo real também» — empurrar para todo mundo e filtrar na tela
//      é vazamento, porque o aviso CHEGA ao navegador de quem não podia vê-lo;
//   3. «a tela avisa quando cai» — coberto pelo recuo exponencial, medido aqui na parte pura.
//
// ── O QUE ESTE TESTE NÃO FINGE ─────────────────────────────────────────────────────────────────
// A parte 3 (duas réplicas) precisa de um Postgres alcançável. Sem ele, ela NÃO EXECUTA e diz
// isso — nunca «passou». Um verde comprado com dublê no lugar do canal seria exatamente o tipo de
// prova que este contrato manda desconfiar.
//
// COMO RODAR
//     RAGNABOT_TESTE_DB_URL='postgresql://usuário:senha@servidor:5432/base' \
//       node tests/ragnabot-tempo-real.test.mjs
//   (na falta dela, usa `DATABASE_URL`. Nenhuma tabela é criada, lida ou alterada: `LISTEN`/
//    `NOTIFY` não tocam em dado nenhum.)
//
// CÓDIGOS DE SAÍDA: 0 provado · 1 REPROVOU · 2 não pôde executar · 3 erro inesperado
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESTE = fileURLToPath(import.meta.url);
const URL_BANCO = process.env.RAGNABOT_TESTE_DB_URL || process.env.DATABASE_URL || '';

let passou = 0; let reprovou = 0; let naoExecutou = 0;
const ok = (t, d = '') => { passou += 1; console.log(`  ✅ ${t}${d ? ` — ${d}` : ''}`); };
const falhou = (t, d = '') => { reprovou += 1; console.log(`  ❌ ${t}${d ? ` — ${d}` : ''}`); };
const pulou = (t, m) => { naoExecutou += 1; console.log(`  ⚠️  NÃO EXECUTOU: ${t} — ${m}`); };
const conferir = (t, cond, d = '') => (cond ? ok(t, d) : falhou(t, d));
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 82 - t.length))}`);
const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ── os personagens ─────────────────────────────────────────────────────────────────────────────
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CONTA_A = 7701;
const SUPORTE = 7710; const FINANCEIRO = 7720;

const superusuario = { id: 'cw:1', name: 'Dono', role: 'admin', isSuperuser: true, cwUserId: 1 };
const adminA = { id: 'cw:2', name: 'Admin A', role: 'admin', cwUserId: 2, ragnabotTenantId: EMPRESA_A };
const adminB = { id: 'cw:3', name: 'Admin B', role: 'admin', cwUserId: 3, ragnabotTenantId: EMPRESA_B };
const ana = { id: 'cw:11', name: 'Ana (Suporte)', role: 'user', cwUserId: 11, ragnabotTenantId: EMPRESA_A };
const bruno = { id: 'cw:12', name: 'Bruno (Financeiro)', role: 'user', cwUserId: 12, ragnabotTenantId: EMPRESA_A };
const semEmpresa = { id: 'cw:13', name: 'Sem vínculo', role: 'user', cwUserId: 13 };

const conversa = (extra = {}) => ({
  tenantId: EMPRESA_A, cwAccountId: CONTA_A, cwConversationId: 41,
  estado: 'aguardando', cwAssigneeId: null, cwTeamId: SUPORTE,
  resolvidaPorCwUserId: null, ehGrupo: false, ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MODO RÉPLICA — este mesmo arquivo, rodando como o OUTRO pod.
// Liga o canal comum, publica UM evento e sai. Nada mais.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--replica')) {
  const tr = await import('../src/services/ragnabot-tempo-real.service.js');
  const alvo = JSON.parse(process.env.REPLICA_ALVO || '{}');
  const motivo = process.env.REPLICA_MOTIVO || 'mensagem';
  const estado = await tr.ligarCanal({ url: URL_BANCO });
  if (!estado?.ligado) {
    console.error(`REPLICA: canal não ligou (${estado?.ultimoErro || 'sem motivo'})`);
    process.exit(3);
  }
  const r = await tr.publicar({ tipo: 'conversa', motivo, alvo });
  // A linha que o processo-pai lê para saber a identidade de QUEM publicou.
  console.log(`REPLICA_ORIGEM=${tr.ORIGEM}`);
  console.log(`REPLICA_PUBLICOU=${JSON.stringify({ id: r.id, noCanal: r.noCanal })}`);
  await tr.desligarCanal();
  await espera(150);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n═══ TEMPO REAL DA CAIXA — contrato S-TEMPO-REAL ═══');

const tr = await import('../src/services/ragnabot-tempo-real.service.js');

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('1. O AVALIADOR DE CLÁUSULA — a regra continua morando num lugar só');
// ───────────────────────────────────────────────────────────────────────────────────────────────
conferir('cláusula vazia `{}` = vê tudo', tr.casaClausula({}, conversa()) === true);
conferir('cláusula `null` = não vê NADA (falha fechada)', tr.casaClausula(null, conversa()) === false);
conferir('igualdade simples casa', tr.casaClausula({ cwTeamId: SUPORTE }, conversa()) === true);
conferir('igualdade simples recusa', tr.casaClausula({ cwTeamId: FINANCEIRO }, conversa()) === false);
conferir('`null` explícito casa com ausente', tr.casaClausula({ cwAssigneeId: null }, conversa()) === true);
conferir('`in` casa', tr.casaClausula({ cwTeamId: { in: [SUPORTE, FINANCEIRO] } }, conversa()) === true);
conferir('`in` vazio recusa', tr.casaClausula({ cwTeamId: { in: [] } }, conversa()) === false);
conferir('`OR` casa se um casar',
  tr.casaClausula({ OR: [{ cwAssigneeId: 99 }, { cwTeamId: SUPORTE }] }, conversa()) === true);
conferir('`OR` recusa se nenhum casar',
  tr.casaClausula({ OR: [{ cwAssigneeId: 99 }, { cwTeamId: FINANCEIRO }] }, conversa()) === false);
// ⚠️ A prova que importa mais: operador desconhecido tem de RECUSAR, nunca «passar porque não sei».
conferir('operador desconhecido RECUSA (falha fechada)',
  tr.casaClausula({ estado: { contains: 'aguard' } }, conversa()) === false,
  'um avaliador que erra por omissão erra ABRINDO');

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('2. O ISOLAMENTO NO TEMPO REAL — quem pode receber o aviso de quê');
// ───────────────────────────────────────────────────────────────────────────────────────────────
const daAna = { user: ana, setores: [SUPORTE] };
const doBruno = { user: bruno, setores: [FINANCEIRO] };

conferir('super usuário vê a conversa da empresa A', tr.podeVer({ user: superusuario, setores: [] }, conversa()) === true);
conferir('admin da empresa A vê a conversa dela', tr.podeVer({ user: adminA, setores: [] }, conversa()) === true);
conferir('⛔ admin da empresa B NÃO vê a conversa da empresa A',
  tr.podeVer({ user: adminB, setores: [] }, conversa()) === false, 'isolamento entre clientes');
conferir('⛔ usuário sem empresa vinculada não vê NADA',
  tr.podeVer({ user: semEmpresa, setores: [] }, conversa()) === false);

conferir('Ana vê a fila do setor dela (sem dono, aberta)', tr.podeVer(daAna, conversa()) === true);
conferir('⛔ Bruno NÃO vê a fila do setor da Ana', tr.podeVer(doBruno, conversa()) === false);
conferir('Ana vê a conversa atribuída a ela',
  tr.podeVer(daAna, conversa({ cwAssigneeId: 11, estado: 'atendendo' })) === true);
conferir('⛔ Ana NÃO vê a conversa atribuída ao Bruno, mesmo no setor dela',
  tr.podeVer(daAna, conversa({ cwAssigneeId: 12, estado: 'atendendo' })) === false,
  'a fila do setor só libera o que NÃO tem dono');
conferir('Ana vê a que ELA resolveu',
  tr.podeVer(daAna, conversa({ estado: 'resolvida', cwAssigneeId: null, resolvidaPorCwUserId: 11 })) === true);
conferir('⛔ Ana NÃO vê a resolvida por outro',
  tr.podeVer(daAna, conversa({ estado: 'resolvida', cwAssigneeId: null, resolvidaPorCwUserId: 12 })) === false);
conferir('⛔ conversa RESOLVIDA sem dono não volta pela fila do setor',
  tr.podeVer(daAna, conversa({ estado: 'resolvida', resolvidaPorCwUserId: 12 })) === false,
  'a fila exige estado aberto');
conferir('⛔ agente sem nenhum setor não vê fila nenhuma',
  tr.podeVer({ user: ana, setores: [] }, conversa()) === false);

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('3. A ENTREGA RESPEITA O FILTRO — e recusa ANTES de escrever no soquete');
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const caixaDe = (nome) => { const c = []; return { nome, recebidos: c, envio: (e) => c.push(e) }; };
  const cAna = caixaDe('ana'); const cBruno = caixaDe('bruno'); const cAdminB = caixaDe('adminB');
  const iAna = tr.assinar({ user: ana, setores: [SUPORTE], envio: cAna.envio });
  const iBruno = tr.assinar({ user: bruno, setores: [FINANCEIRO], envio: cBruno.envio });
  const iAdminB = tr.assinar({ user: adminB, setores: [], envio: cAdminB.envio });

  const r = tr.entregar({
    v: tr.VERSAO_EVENTO, id: 'x:1', origem: 'outro-pod', tipo: 'conversa', motivo: 'mensagem',
    em: new Date().toISOString(), alvo: tr.resumoDeConversa(conversa()), antes: null,
  });

  conferir('entregue a 1 de 3 assinantes', r.entregues === 1 && r.recusados === 2, JSON.stringify(r));
  conferir('Ana recebeu', cAna.recebidos.length === 1);
  conferir('⛔ Bruno NÃO recebeu (outro setor)', cBruno.recebidos.length === 0);
  conferir('⛔ admin de OUTRA EMPRESA não recebeu', cAdminB.recebidos.length === 0);
  conferir('o aviso NÃO carrega texto de cliente',
    cAna.recebidos[0] && !('contatoNome' in cAna.recebidos[0]) && !('texto' in cAna.recebidos[0])
      && !('conteudo' in cAna.recebidos[0]),
    `campos: ${Object.keys(cAna.recebidos[0] || {}).join(',')}`);
  conferir('o aviso carrega o número da conversa e o motivo',
    cAna.recebidos[0]?.cwConversationId === 41 && cAna.recebidos[0]?.motivo === 'mensagem');

  // ⭐ A conversa que SAI da vista: Ana tem de ser avisada para o cartão sumir da tela dela.
  const rTransf = tr.entregar({
    v: tr.VERSAO_EVENTO, id: 'x:2', origem: 'outro-pod', tipo: 'conversa', motivo: 'mudou',
    em: new Date().toISOString(),
    alvo: tr.resumoDeConversa(conversa({ cwTeamId: FINANCEIRO, cwAssigneeId: 12, estado: 'atendendo' })),
    antes: tr.resumoDeConversa(conversa()),
  });
  conferir('transferida PARA fora: Ana é avisada (pelo estado ANTERIOR) e Bruno também',
    rTransf.entregues === 2, JSON.stringify(rTransf));
  conferir('⛔ e o admin da empresa B continua sem receber', cAdminB.recebidos.length === 0);

  // Versão de evento desconhecida (rollout com dois motores no ar) é DESCARTADA, não interpretada.
  const rVelho = tr.entregar({ v: 999, id: 'x:3', tipo: 'conversa', alvo: tr.resumoDeConversa(conversa()) });
  conferir('evento de versão desconhecida é descartado', rVelho.entregues === 0);

  iAna.cancelar(); iBruno.cancelar(); iAdminB.cancelar();
  conferir('cancelar tira da lista', tr.conexoesAbertas() === 0);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('4. ⭐ DUAS RÉPLICAS — o evento publicado num processo chega ao cliente do OUTRO');
// ───────────────────────────────────────────────────────────────────────────────────────────────
if (!URL_BANCO) {
  pulou('canal comum entre réplicas', 'sem RAGNABOT_TESTE_DB_URL nem DATABASE_URL — '
    + 'esta parte NÃO pode ser provada com dublê, e um verde aqui seria mentira');
} else {
  const estado = await tr.ligarCanal({ url: URL_BANCO });
  if (!estado?.ligado) {
    pulou('canal comum entre réplicas', `não consegui ligar o canal: ${estado?.ultimoErro || '?'}`);
  } else {
    ok('réplica A: canal comum ligado', `${estado.tipo} · ${estado.canal}`);

    const recebidosAna = [];
    const recebidosBruno = [];
    const iAna = tr.assinar({ user: ana, setores: [SUPORTE], envio: (e) => recebidosAna.push(e) });
    const iBruno = tr.assinar({ user: bruno, setores: [FINANCEIRO], envio: (e) => recebidosBruno.push(e) });

    /** Sobe a réplica B, manda publicar UM evento, e devolve a origem dela. */
    const publicarNaReplicaB = (alvo, motivo = 'mensagem') => new Promise((resolve, reject) => {
      const filho = spawn(process.execPath, [ESTE, '--replica'], {
        cwd: AQUI,
        env: {
          ...process.env,
          RAGNABOT_TESTE_DB_URL: URL_BANCO,
          REPLICA_ALVO: JSON.stringify(alvo),
          REPLICA_MOTIVO: motivo,
        },
      });
      let saida = ''; let erro = '';
      filho.stdout.on('data', (d) => { saida += d; });
      filho.stderr.on('data', (d) => { erro += d; });
      filho.on('exit', (codigo) => {
        if (codigo !== 0) return reject(new Error(`réplica B saiu com ${codigo}: ${erro.slice(0, 300)}`));
        const m = /REPLICA_ORIGEM=(.+)/.exec(saida);
        return resolve({ origem: m ? m[1].trim() : null, saida });
      });
      filho.on('error', reject);
    });

    try {
      // ⭐ A PROVA. Alvo VISÍVEL para a Ana, invisível para o Bruno.
      const b = await publicarNaReplicaB(conversa());
      // O NOTIFY viaja pelo servidor de banco; um instante para o soquete de escuta acordar.
      for (let i = 0; i < 40 && recebidosAna.length === 0; i += 1) await espera(50);

      conferir('⭐ o evento publicado na RÉPLICA B chegou ao cliente da RÉPLICA A',
        recebidosAna.length === 1, `recebidos=${recebidosAna.length}`);
      conferir('e ele veio MESMO de outro processo (origem diferente)',
        Boolean(b.origem) && b.origem !== tr.ORIGEM
          && typeof recebidosAna[0]?.id === 'string'
          && recebidosAna[0].id.startsWith(b.origem),
        `A=${tr.ORIGEM} · B=${b.origem} · id do evento=${recebidosAna[0]?.id}`);
      conferir('⛔ e o isolamento valeu ATRAVÉS do canal: Bruno não recebeu',
        recebidosBruno.length === 0,
        'aviso vindo de outra réplica passa pelo mesmo filtro do local');

      // Um segundo evento, agora visível só para o Bruno: prova que o canal não está "sempre
      // entregando para o primeiro" nem "nunca entregando para o segundo".
      recebidosAna.length = 0;
      await publicarNaReplicaB(conversa({ cwTeamId: FINANCEIRO, cwConversationId: 42 }));
      for (let i = 0; i < 40 && recebidosBruno.length === 0; i += 1) await espera(50);
      conferir('o evento do setor do Bruno chegou a ELE, e não à Ana',
        recebidosBruno.length === 1 && recebidosAna.length === 0,
        `bruno=${recebidosBruno.length} ana=${recebidosAna.length}`);

      // ⚠️ O ECO DO PRÓPRIO AVISO. Publicando daqui, a entrega é local E o `NOTIFY` volta para a
      // nossa própria escuta. Sem descartar pelo carimbo de origem, a tela recarregaria em dobro.
      recebidosAna.length = 0;
      await tr.publicar({ tipo: 'conversa', motivo: 'mensagem', alvo: conversa() });
      await espera(600);
      conferir('o próprio eco NÃO duplica a entrega',
        recebidosAna.length === 1, `entregas=${recebidosAna.length} (esperado 1)`);

      const st = tr.estadoDoTempoReal();
      conferir('o /saude enxerga o canal como COMPARTILHADO',
        st.canal?.compartilhado === true && st.canal?.ligado === true, JSON.stringify(st.canal));
      conferir('o /saude conta as conexões abertas', st.conexoesAbertas === 2, `= ${st.conexoesAbertas}`);
      conferir('o /saude conta o que foi recusado por isolamento',
        st.descartadosPorIsolamento > 0, `= ${st.descartadosPorIsolamento}`);
    } catch (e) {
      falhou('duas réplicas', e.message);
    } finally {
      iAna.cancelar(); iBruno.cancelar();
      await tr.desligarCanal();
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('5. A CONEXÃO SSE — os cabeçalhos que fazem o cano atravessar os DOIS nginx');
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  // Porta injetada: o teste não fala com banco nenhum para saber os setores.
  tr.configurarTempoReal({
    caixa: {
      clausulaDeEmpresa: (await import('../src/services/ragnabot-caixa.service.js')).clausulaDeEmpresa,
      clausulaDeVisibilidade: (await import('../src/services/ragnabot-caixa.service.js')).clausulaDeVisibilidade,
      setoresDoAgente: async (u) => (u?.cwUserId === 11 ? [SUPORTE] : [FINANCEIRO]),
    },
  });
  // Canal LOCAL: esta parte mede a CONEXÃO, não o barramento (que a parte 4 já provou).
  await tr.ligarCanal({ modo: 'local' });

  const express = (await import('express')).default;
  const rota = (await import('../src/routes/ragnabot-tempo-real.routes.js')).default;
  const app = express();
  app.use((req, res, proximo) => { req.user = ana; proximo(); });
  app.use('/api/ragnabot-tempo-real', rota);
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  const porta = servidor.address().port;

  const pedaços = [];
  let cabecalhos = null;
  const pedido = http.get({ host: '127.0.0.1', port: porta, path: '/api/ragnabot-tempo-real/ao-vivo' }, (res) => {
    cabecalhos = res.headers;
    res.setEncoding('utf8');
    res.on('data', (d) => pedaços.push(d));
  });

  for (let i = 0; i < 40 && !pedaços.join('').includes('event: pronto'); i += 1) await espera(50);
  const inicio = pedaços.join('');

  conferir('responde `text/event-stream`', String(cabecalhos?.['content-type'] || '').includes('text/event-stream'),
    cabecalhos?.['content-type']);
  conferir('⭐ manda `X-Accel-Buffering: no`', cabecalhos?.['x-accel-buffering'] === 'no',
    'é o que desliga a buferização dos DOIS nginx sem tocar na configuração deles');
  conferir('manda `Cache-Control` sem transformação',
    String(cabecalhos?.['cache-control'] || '').includes('no-transform'), cabecalhos?.['cache-control']);
  conferir('os cabeçalhos saem ANTES do primeiro evento (flushHeaders)', Boolean(cabecalhos));
  conferir('o primeiro evento é `pronto` (é ele que dispara a recarga total)',
    inicio.includes('event: pronto'));
  conferir('e ele diz de quantos setores a pessoa é membro', /"setores":1/.test(inicio), inicio.slice(0, 200));

  // Agora um aviso de verdade, publicado enquanto o navegador está pendurado.
  await tr.publicar({ tipo: 'conversa', motivo: 'mensagem', alvo: conversa() });
  for (let i = 0; i < 40 && !pedaços.join('').includes('event: conversa'); i += 1) await espera(50);
  const tudo = pedaços.join('');
  conferir('⭐ o aviso chega no cano, sem recarregar a página', tudo.includes('event: conversa'));
  conferir('e vem no formato de SSE (id + event + data)',
    /id: .+\nevent: conversa\ndata: \{/.test(tudo), tudo.split('event: conversa')[0].slice(-80));
  conferir('⛔ e NÃO vaza texto de cliente no fio',
    !/contatoNome|"texto"|conteudo/.test(tudo));
  // ⚠️ ESTA LINHA NASCEU DE UM DEFEITO. Em modo degradado (canal local) o aviso era entregue duas
  // vezes — o canal repetia de volta e o descarte do próprio eco só existia no caminho do Postgres.
  // A tela recarregaria em dobro justamente quando o sistema já estava mancando.
  conferir('⛔ e chega UMA vez, não duas (modo degradado também)',
    (tudo.match(/event: conversa/g) || []).length === 1,
    `${(tudo.match(/event: conversa/g) || []).length} entrega(s)`);

  pedido.destroy();
  await new Promise((r) => servidor.close(r));
  await tr.desligarCanal();
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
secao('6. O RECUO DA RECONEXÃO — sem laço apertado');
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const { recuoDaTentativa } = await import('../web/src/lib/ao-vivo.js');
  const semSorteio = (n) => recuoDaTentativa(n, 0.5); // sorteio fixo = 1,0×
  conferir('cresce: 1s, 2s, 4s, 8s…',
    semSorteio(0) === 1000 && semSorteio(1) === 2000 && semSorteio(2) === 4000 && semSorteio(3) === 8000,
    [0, 1, 2, 3].map(semSorteio).join(' · '));
  conferir('tem teto de 30 s', semSorteio(9) === 30000 && semSorteio(50) === 30000);
  conferir('nunca é zero (não existe laço apertado)',
    [0, 1, 2, 3, 9].every((n) => recuoDaTentativa(n, 0) >= 500),
    `mínimo medido: ${Math.min(...[0, 1, 2, 3, 9].map((n) => recuoDaTentativa(n, 0)))} ms`);
  const amostras = new Set(Array.from({ length: 20 }, () => recuoDaTentativa(3)));
  conferir('e tem SORTEIO (dois navegadores que caíram juntos não voltam juntos)',
    amostras.size > 5, `${amostras.size} valores distintos em 20 sorteios`);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n═══ RESULTADO: ${passou} provado(s) · ${reprovou} REPROVOU · ${naoExecutou} não executou ═══\n`);
process.exit(reprovou > 0 ? 1 : (naoExecutou > 0 ? 2 : 0));
