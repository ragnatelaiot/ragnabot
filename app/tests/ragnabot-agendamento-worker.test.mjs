#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O TRABALHADOR DO AGENDAMENTO — contra POSTGRES DE VERDADE, porque contra dublê não prova nada.
//
// POR QUE ESTE TESTE NÃO USA BANCO FALSO (a mesma decisão do teste da fila do motor)
// Tudo o que este trabalhador promete é sobre o BANCO e sobre CONCORRÊNCIA: `INSERT … ON CONFLICT
// ("chave") DO NOTHING`, índice único, `updateMany` condicionado ao estado. Um dublê em memória
// responderia exatamente o que eu programasse nele — provaria a minha opinião, não o comportamento.
// As duas «réplicas» aqui são dois módulos carregados de verdade, com dois clientes Prisma
// distintos e portanto duas conexões distintas, como dois pods do Kubernetes.
//
// COMO RODAR:
//   RAGNABOT_TESTE_DB_URL='postgresql://usuario:senha@host:5432/base' \
//     node tests/ragnabot-agendamento-worker.test.mjs
//
// Sem a variável, o teste PULA com aviso e devolve 0. Falhar por falta de banco transformaria
// «não medi» em «está quebrado», que é a mentira mais cara de um conjunto de testes.
// O teste cria um ESQUEMA temporário (`zz_teste_agendamento_<pid>_<aleatório>`), aplica ali o SQL
// VERSIONADO de `prisma/sql/agendamento/01-rb_agendamento.sql` — se a DDL versionada estiver
// errada, o teste quebra aqui, que é onde tem de quebrar — e apaga o esquema no fim.
//
// ⚠️ O QUE É ANDAIME E O QUE É O ASSUNTO. `RagnabotInbox` e `RagnabotFluxoJanela` são criadas aqui
// só para o trabalhador ter onde ler a conexão e a janela de 24 h. A DDL delas também sai dos
// arquivos VERSIONADOS (`saas/01` e `motor-fluxo/01`), recortada — nada é reescrito à mão.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.join(AQUI, '..', 'prisma', 'sql');

const URL_BASE = (process.env.RAGNABOT_TESTE_DB_URL || '').trim();
if (!URL_BASE) {
  console.log('\n⚠️  RAGNABOT_TESTE_DB_URL não definida — o trabalhador de agendamento NÃO foi medido.');
  console.log('    (o que este teste prova só existe dentro do Postgres; sem banco, não há prova)\n');
  process.exit(0);
}

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try {
    const r = await conferir();
    console.log(`  ✓ ${titulo}${r !== undefined && r !== null ? `  →  ${r}` : ''}`);
  } catch (e) {
    falhas += 1;
    console.log(`  ✗ ${titulo}\n      ${e.message}\n      ${String(e.stack).split('\n').slice(1, 3).join('\n      ')}`);
  }
}
function igual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'esperava'}: «${b}», veio «${a}»`); }
function verdade(v, msg) { if (!v) throw new Error(msg || 'esperava verdadeiro'); }
const secao = (t) => console.log(`\n${t}`);

// ── O esquema temporário ────────────────────────────────────────────────────────────────────────
const esquema = `zz_teste_agendamento_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const urlComEsquema = (() => { const u = new URL(URL_BASE); u.searchParams.set('schema', esquema); return u.toString(); })();
process.env.DATABASE_URL = urlComEsquema;

const { Client } = await import('pg');
const admin = new Client({ connectionString: URL_BASE });
await admin.connect();

/** Recorta do arquivo versionado a DDL de UMA tabela (create + índices), sem `ALTER … FOREIGN KEY`
 *  — as chaves estrangeiras apontariam para tabelas que este teste não precisa. */
function ddlDe(arquivo, tabela) {
  const texto = fs.readFileSync(path.join(SQL, arquivo), 'utf8');
  const criar = texto.match(new RegExp(`CREATE TABLE "${tabela}" \\(.*?\\n\\);`, 's'))?.[0];
  if (!criar) throw new Error(`não achei a DDL de ${tabela} em ${arquivo}`);
  const indices = texto.match(new RegExp(`CREATE (?:UNIQUE )?INDEX "${tabela}_[^;]*;`, 'g')) || [];
  return [criar, ...indices];
}

async function montarEstrutura() {
  await admin.query(`CREATE SCHEMA "${esquema}"`);
  await admin.query(`SET search_path TO "${esquema}"`);
  // O ASSUNTO: as três tabelas nascem do arquivo VERSIONADO, inteiro.
  const versionado = fs.readFileSync(path.join(SQL, 'agendamento', '01-rb_agendamento.sql'), 'utf8');
  await admin.query(versionado);
  // O ANDAIME: conexão e janela de 24 h, recortadas dos arquivos versionados delas.
  for (const cmd of [...ddlDe('saas/01-rb_saas_multiempresa.sql', 'RagnabotInbox'),
    ...ddlDe('motor-fluxo/01-rb_motor_base.sql', 'RagnabotFluxoJanela')]) {
    await admin.query(cmd);
  }
}

async function limparDados() {
  await admin.query(`SET search_path TO "${esquema}"`);
  await admin.query('TRUNCATE "RagnabotAgendamentoEnvio", "RagnabotAgendamentoDestino", "RagnabotAgendamento", "RagnabotFluxoJanela"');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AS DUAS «RÉPLICAS» — dois módulos, dois clientes Prisma, duas conexões (como dois pods)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const { PrismaClient } = await import('@prisma/client');
const clienteA = new PrismaClient({ datasources: { db: { url: urlComEsquema } } });
const clienteB = new PrismaClient({ datasources: { db: { url: urlComEsquema } } });
const silencio = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const workerA = await import('../src/services/ragnabot-agendamento-worker.service.js?replica=a');
const workerB = await import('../src/services/ragnabot-agendamento-worker.service.js?replica=b');
const dominio = await import('../src/services/ragnabot-agendamento.service.js');
dominio.configurarAgendamento({ db: clienteA });

// ── O DUBLÊ DO CANAL — conta cada envio por chave, e sabe recusar sob encomenda ────────────────
function fazerCanal() {
  const enviados = []; // { chave, tipo, conversa }
  const regras = new Map(); // chaveEfeito|conversa -> erro a lançar
  return {
    enviados,
    /** Programa uma recusa. `alvo` é a conversa (número) ou a chave do efeito. */
    recusar(alvo, erro) { regras.set(String(alvo), erro); },
    limpar() { enviados.length = 0; regras.clear(); },
    porta: {
      async portaDa({ cwConversationId, tenantId, cwAccountId }) {
        return {
          async enviar(intencao) {
            const porConversa = regras.get(String(cwConversationId));
            const porChave = regras.get(String(intencao.chaveEfeito));
            const erro = porChave || porConversa;
            if (erro) throw erro;
            enviados.push({
              chave: intencao.chaveEfeito, tipo: intencao.tipo, conversa: cwConversationId,
              corpo: intencao.corpo ?? intencao.legenda ?? intencao.nome ?? null, tenantId, cwAccountId,
            });
            return { idExterno: `msg-${enviados.length}` };
          },
        };
      },
    },
  };
}

// ── O DUBLÊ DA PLATAFORMA — abre conversa e registra os acertos de ticket ──────────────────────
function fazerChatwoot() {
  const acoes = [];
  let proximaConversa = 9000;
  const mapa = new Map(); // contatoChave -> conversa
  return {
    acoes,
    mapa,
    limpar() { acoes.length = 0; mapa.clear(); proximaConversa = 9000; },
    porta: {
      async garantirConversa({ contatoChave, cwInboxId }) {
        const ja = mapa.get(`${cwInboxId}:${contatoChave}`);
        if (ja) return { cwConversationId: ja, cwContactId: 1, criada: false, status: 'open' };
        proximaConversa += 1;
        mapa.set(`${cwInboxId}:${contatoChave}`, proximaConversa);
        acoes.push({ acao: 'conversa_criada', contatoChave, conversa: proximaConversa });
        return { cwConversationId: proximaConversa, cwContactId: 1, criada: true, status: 'open' };
      },
      async transferirTime({ cwConversationId, cwTeamId }) { acoes.push({ acao: 'transferir', cwConversationId, cwTeamId }); return true; },
      async resolver({ cwConversationId }) { acoes.push({ acao: 'resolver', cwConversationId }); return true; },
    },
  };
}

const canal = fazerCanal();
const chatwoot = fazerChatwoot();
let RELOGIO = new Date('2026-09-03T12:00:00.000Z');
const relogio = () => new Date(RELOGIO);

workerA.configurarAgendamentoWorker({ db: clienteA, log: silencio, canal: canal.porta, chatwoot: chatwoot.porta, agora: relogio });
workerB.configurarAgendamentoWorker({ db: clienteB, log: silencio, canal: canal.porta, chatwoot: chatwoot.porta, agora: relogio });

// ── Semeadura ─────────────────────────────────────────────────────────────────────────────────
const TENANT = 'empresa-a';
const CONTA = 7;
const CAIXA = 34;
const FORTALEZA = 'America/Fortaleza';

async function semearCaixa({ removida = false, phoneNumberId = null } = {}) {
  await clienteA.ragnabotInbox.deleteMany({});
  await clienteA.ragnabotInbox.create({
    data: {
      id: crypto.randomUUID(), tenantId: TENANT, cwInboxId: CAIXA, name: 'WhatsApp Ragnatela',
      channelType: 'whatsapp', identifier: '5598983351000',
      metadata: phoneNumberId ? { phoneNumberId } : {},
      removedAt: removida ? new Date('2026-09-01T00:00:00Z') : null,
      updatedAt: new Date(),
    },
  });
}

/** Cria um agendamento com N destinatários. `proximaEm` no passado = já venceu. */
async function semearAgendamento(extra = {}, telefones = ['5598900000001', '5598900000002', '5598900000003']) {
  const id = crypto.randomUUID();
  await clienteA.ragnabotAgendamento.create({
    data: {
      id,
      tenantId: TENANT,
      titulo: extra.titulo || 'Lembrete de consulta',
      mensagem: extra.mensagem || 'Sua consulta é amanhã às 14h.',
      cwAccountId: CONTA,
      cwInboxId: CAIXA,
      canal: 'whatsapp',
      cwTeamId: extra.cwTeamId ?? 3,
      abrirTicket: extra.abrirTicket ?? true,
      fuso: extra.fuso || FORTALEZA,
      recorrencia: extra.recorrencia || 'unica',
      intervalo: extra.intervalo ?? 1,
      diasSemana: extra.diasSemana ?? null,
      minutoLocal: extra.minutoLocal ?? 8 * 60,
      inicioEm: extra.inicioEm || new Date('2026-09-03T11:00:00.000Z'),
      proximaEm: extra.proximaEm !== undefined ? extra.proximaEm : new Date('2026-09-03T11:00:00.000Z'),
      status: extra.status || 'pendente',
      usarTemplate: extra.usarTemplate ?? false,
      templateNome: extra.templateNome ?? null,
      anexoUrl: extra.anexoUrl ?? null,
      updatedAt: undefined,
      atualizadoEm: new Date(),
    },
  });
  for (const t of telefones) {
    await clienteA.ragnabotAgendamentoDestino.create({
      data: { id: crypto.randomUUID(), agendamentoId: id, tenantId: TENANT, contatoChave: t, atualizadoEm: new Date() },
    });
  }
  return id;
}

const envios = (agendamentoId) => clienteA.ragnabotAgendamentoEnvio.findMany({
  where: { agendamentoId }, orderBy: { reservadoEm: 'asc' },
});
const agenda = (id) => clienteA.ragnabotAgendamento.findUnique({ where: { id } });
const porStatus = (lista) => lista.reduce((a, e) => { a[e.status] = (a[e.status] || 0) + 1; return a; }, {});

async function zerar() {
  await limparDados();
  canal.limpar();
  chatwoot.limpar();
  RELOGIO = new Date('2026-09-03T12:00:00.000Z');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nTRABALHADOR DO AGENDAMENTO — medido contra Postgres de verdade');
console.log(`  esquema temporário: ${esquema}`);

try {
  await montarEstrutura();
  await semearCaixa();

  await medir('as 3 tabelas nascem do ARQUIVO VERSIONADO (se a DDL estiver errada, quebra aqui)', async () => {
    const r = await admin.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'RagnabotAgendamento%' ORDER BY 1`, [esquema],
    );
    igual(r.rows.map((x) => x.table_name).join(','),
      'RagnabotAgendamento,RagnabotAgendamentoDestino,RagnabotAgendamentoEnvio');
  });

  await medir('o índice ÚNICO da chave existe — é ele, e não um `if`, que impede o disparo dobrado', async () => {
    const r = await admin.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='RagnabotAgendamentoEnvio_chave_key'`, [esquema],
    );
    verdade(r.rows.length === 1, 'o índice único da chave NÃO existe — a idempotência seria decoração');
    verdade(/UNIQUE/i.test(r.rows[0].indexdef), 'o índice existe mas não é único');
    return r.rows[0].indexdef.replace(/^CREATE /, '').slice(0, 90);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('1. DISPARA NA HORA CERTA — e o resultado fica registrado por destinatário');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  const ag1 = await semearAgendamento();

  await medir('agendamento vencido dispara para os 3 destinatários', async () => {
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 3, 'mensagens que saíram');
    igual(r.enviados, 3, 'contados no resumo');
    return JSON.stringify({ vistas: r.vistas, enviados: r.enviados });
  });

  await medir('cada envio tem linha própria, com status e conversa (F4.6/F4.7)', async () => {
    const lista = await envios(ag1);
    igual(lista.length, 3, 'linhas de envio');
    igual(JSON.stringify(porStatus(lista)), '{"enviado":3}');
    verdade(lista.every((e) => e.cwConversationId), 'faltou a conversa em algum envio');
    verdade(lista.every((e) => e.idExterno), 'faltou o id da mensagem no destino');
    return lista.map((e) => `${e.cwConversationId}:${e.status}`).join(' · ');
  });

  await medir('«abrir ticket» levou a conversa ao setor (F4.4)', async () => {
    const transferencias = chatwoot.acoes.filter((a) => a.acao === 'transferir');
    igual(transferencias.length, 3, 'transferências para o setor');
    igual(transferencias[0].cwTeamId, 3, 'setor de destino');
  });

  await medir('a ocorrência ÚNICA concluiu a agenda (não fica batendo na porta todo tique)', async () => {
    const a = await agenda(ag1);
    igual(a.status, 'concluido');
    igual(a.proximaEm, null, 'próxima ocorrência');
    igual(a.ocorrenciasFeitas, 1, 'ocorrências feitas');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('2. ⭐ NÃO DISPARA DUAS VEZES — a exigência nº 1 do contrato, medida de quatro formas');
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  await medir('2.a — rodar o trabalhador DE NOVO não manda nada (a agenda já concluiu)', async () => {
    const antes = canal.enviados.length;
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, antes, 'mensagens depois da 2ª rodada');
    return `continuou em ${antes}`;
  });

  await zerar();
  const ag2 = await semearAgendamento({ titulo: 'Corrida entre réplicas' });

  // ⚠️ POR QUE A CORRIDA É MEDIDA EM TRÊS PARTES, E NÃO SÓ PELO RESULTADO FINAL
  // A primeira versão deste teste só rodava as duas rodadas em `Promise.all` e exigia que uma
  // registrasse disputa. Ele reprovou — não porque o código errou (saíram 3 mensagens, como tinha
  // de ser), mas porque a réplica B, mais lenta para abrir a conexão, chegou DEPOIS de a agenda já
  // ter concluído e nem viu a linha. Ou seja: o teste dependia de sorte de escalonamento, e teste
  // que depende de sorte não prova nada nos dois sentidos. As duas medições seguintes chamam as
  // travas DIRETAMENTE, com o mesmo estado lido antes, e aí a corrida é de verdade.
  await medir('2.b — DUAS RÉPLICAS rodando ao mesmo tempo: 3 mensagens, não 6', async () => {
    const [rA, rB] = await Promise.all([
      workerA.dispararVencidos({ workerId: 'pod-A' }),
      workerB.dispararVencidos({ workerId: 'pod-B' }),
    ]);
    igual(canal.enviados.length, 3, 'mensagens que saíram com as duas réplicas disputando');
    const lista = await envios(ag2);
    igual(lista.length, 3, 'linhas de envio (uma por destinatário, nunca duas)');
    igual(JSON.stringify(porStatus(lista)), '{"enviado":3}');
    return `A={enviados:${rA.enviados},vistas:${rA.vistas},disputadas:${rA.disputadas}} `
      + `B={enviados:${rB.enviados},vistas:${rB.vistas},disputadas:${rB.disputadas}}`;
  });

  await medir('2.b1 — POSSE: as duas réplicas disputam a MESMA ocorrência; exatamente UMA leva', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Disputa de posse' }, ['5598900000002']);
    const linha = await agenda(ag); // as DUAS partem do mesmo estado lido
    const instante = new Date(RELOGIO);
    const [a, b] = await Promise.all([
      workerA.tomarPosse(linha, 'pod-A', instante),
      workerB.tomarPosse(linha, 'pod-B', instante),
    ]);
    igual([a, b].filter(Boolean).length, 1, 'réplicas que levaram a posse');
    return `pod-A=${a} · pod-B=${b} (dono: ${(await agenda(ag)).donoWorker})`;
  });

  await medir('2.b2 — RESERVA: as duas reservam o MESMO destinatário; exatamente UMA pode mandar', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Disputa de reserva' }, ['5598900000003']);
    const linha = await agenda(ag);
    const destino = (await clienteA.ragnabotAgendamentoDestino.findMany({ where: { agendamentoId: ag } }))[0];
    const args = { agendamento: linha, destino, ocorrenciaEm: linha.proximaEm, instante: new Date(RELOGIO) };
    const [a, b] = await Promise.all([
      workerA.reservarEnvio({ ...args, workerId: 'pod-A' }),
      workerB.reservarEnvio({ ...args, workerId: 'pod-B' }),
    ]);
    igual([a.reservado, b.reservado].filter(Boolean).length, 1, 'réplicas autorizadas a mandar');
    igual(a.chave, b.chave, 'as duas calcularam a MESMA chave');
    const linhas = await clienteA.ragnabotAgendamentoEnvio.count({ where: { agendamentoId: ag } });
    igual(linhas, 1, 'linhas de envio criadas (tem de ser 1)');
    return `pod-A reservou=${a.reservado} · pod-B reservou=${b.reservado} · chave ${a.chave.slice(0, 12)}…`;
  });

  // Repõe o estado que a medição 2.c espera (ela continua o caso do `ag2`).
  await zerar();
  const ag2b = await semearAgendamento({ titulo: 'Reinício no meio' });
  await workerA.dispararVencidos({ workerId: 'pod-A' });

  await medir('2.c — REINÍCIO NO MEIO: a ocorrência volta ao estado de antes e NADA é reenviado', async () => {
    // Simula o pior caso real: o pod mandou as 3 mensagens, gravou as 3 linhas, e MORREU antes de
    // gravar o avanço da ocorrência. Ao subir de novo, ele vê a MESMA ocorrência vencida.
    await clienteA.ragnabotAgendamento.update({
      where: { id: ag2b },
      data: {
        status: 'pendente',
        proximaEm: new Date('2026-09-03T11:00:00.000Z'),
        ocorrenciasFeitas: 0,
        ultimaOcorrenciaEm: null,
        donoWorker: null,
        travadoEm: null,
      },
    });
    const antes = canal.enviados.length;
    const r = await workerA.dispararVencidos({ workerId: 'pod-A-reiniciado' });
    igual(canal.enviados.length, antes, 'mensagens depois do reinício');
    igual(r.jaCuidados, 3, 'os 3 destinatários foram reconhecidos como «já cuidados»');
    const lista = await envios(ag2b);
    igual(lista.length, 3, 'continua UMA linha por destinatário');
    return `enviadas antes: ${antes} · depois do reinício: ${canal.enviados.length} · jaCuidados: ${r.jaCuidados}`;
  });

  await medir('2.d — a marca é do BANCO: inserir a mesma chave à mão é RECUSADO pelo Postgres', async () => {
    const uma = (await envios(ag2b))[0];
    try {
      await admin.query(`SET search_path TO "${esquema}"`);
      await admin.query(
        `INSERT INTO "RagnabotAgendamentoEnvio"("id","tenantId","agendamentoId","destinoId","ocorrenciaEm","chave","status","reservadoEm")
         VALUES ($1,$2,$3,$4,$5,$6,'reservado',now())`,
        [crypto.randomUUID(), TENANT, uma.agendamentoId, uma.destinoId, uma.ocorrenciaEm, uma.chave],
      );
    } catch (e) {
      verdade(/duplicate key|unique/i.test(e.message), `recusou por outro motivo: ${e.message}`);
      return `Postgres recusou: ${e.message.split('\n')[0].slice(0, 80)}`;
    }
    throw new Error('o banco ACEITOU a chave repetida — a idempotência é decoração');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('3. QUEDA ENTRE A RESERVA E O ENVIO — dúvida não se repete sozinha');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  const ag3 = await semearAgendamento({ titulo: 'Queda no meio' }, ['5598900000009']);

  await medir('uma reserva presa além do prazo vira DUVIDOSA, e não volta para a fila', async () => {
    const destino = (await clienteA.ragnabotAgendamentoDestino.findMany({ where: { agendamentoId: ag3 } }))[0];
    const ag = await agenda(ag3);
    // A reserva nasce (é o que o trabalhador faz ANTES da rede)… e o processo morre aqui.
    const r = await workerA.reservarEnvio({
      agendamento: ag, destino, ocorrenciaEm: ag.proximaEm, workerId: 'pod-que-morreu', instante: new Date(RELOGIO),
    });
    verdade(r.reservado, 'a reserva não nasceu');
    // Passam-se 5 minutos.
    RELOGIO = new Date(RELOGIO.getTime() + 5 * 60_000);
    const c = await workerA.ceifarPresos();
    igual(c.enviosDuvidosos, 1, 'envios marcados como duvidosos');
    const linha = await clienteA.ragnabotAgendamentoEnvio.findUnique({ where: { chave: r.chave } });
    igual(linha.status, 'duvidoso');
    igual(linha.motivo, 'processo_caiu');
    verdade(/NÃO repito sozinho/u.test(linha.erro), 'o motivo não explica por que não repetimos');
    return linha.erro.slice(0, 90) + '…';
  });

  await medir('a retentativa automática IGNORA o duvidoso (só `adiado` entra na varredura)', async () => {
    const antes = canal.enviados.length;
    const r = await workerA.retentarAdiados({});
    igual(r.vistos, 0, 'itens vistos pela retentativa');
    igual(canal.enviados.length, antes, 'mensagens depois da retentativa');
  });

  await medir('mas o REENVIO MANUAL funciona — com chave NOVA, e o passado fica no histórico', async () => {
    const duvidoso = (await envios(ag3))[0];
    const r = await workerA.reenviarManual({ chave: duvidoso.chave, workerId: 'manual:teste' });
    igual(r.desfecho, 'enviado', 'desfecho do reenvio');
    const lista = await envios(ag3);
    igual(lista.length, 2, 'linhas (a duvidosa antiga + a nova)');
    igual(JSON.stringify(porStatus(lista)), '{"duvidoso":1,"enviado":1}');
    return lista.map((e) => `${e.status}(manual:${e.tentativaManual})`).join(' · ');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('4. MULTI-CONTATO — um que falha NÃO derruba os outros (exigência nº 4)');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  const ag4 = await semearAgendamento({ titulo: 'Três contatos, um ruim' });

  await medir('o 2º destinatário é recusado pelo destino; o 1º e o 3º recebem', async () => {
    // O dublê da plataforma dá as conversas 9001, 9002 e 9003, na ordem dos destinatários.
    const recusa = Object.assign(new Error('numero invalido para este canal'), { status: 400 });
    canal.recusar(9002, recusa);
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(r.enviados, 2, 'enviados');
    igual(r.falhas, 1, 'falhas');
    igual(canal.enviados.length, 2, 'mensagens que de fato saíram');
    const lista = await envios(ag4);
    igual(JSON.stringify(porStatus(lista)), '{"enviado":2,"falhou":1}');
    const ruim = lista.find((e) => e.status === 'falhou');
    igual(ruim.motivo, 'destino_recusou');
    verdade(ruim.erro.includes('numero invalido'), 'o erro do destino não foi guardado');
    return `2 enviados · 1 falhou («${ruim.erro.slice(0, 40)}»)`;
  });

  await medir('a agenda seguiu o seu curso apesar da falha de um destinatário', async () => {
    const a = await agenda(ag4);
    igual(a.ocorrenciasFeitas, 1, 'a ocorrência avançou uma vez');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('5. JANELA DE 24 H — nunca falha muda (exigência nº 2)');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  await semearCaixa({ phoneNumberId: '111222333' }); // agora a janela é avaliável

  const ag5 = await semearAgendamento({ titulo: 'Fora da janela' }, ['5598900000010']);

  await medir('sem registro de janela e sem modelo: NADA sai, e o motivo fica escrito', async () => {
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 0, 'mensagens que saíram');
    igual(r.semJanela, 1, 'itens fora da janela');
    const linha = (await envios(ag5))[0];
    igual(linha.status, 'sem_janela');
    igual(linha.motivo, 'fora_da_janela');
    verdade(/modelo aprovado/u.test(linha.erro), 'o motivo não explica que falta modelo aprovado');
    return linha.erro.slice(0, 95) + '…';
  });

  await medir('fora da janela NÃO é `falhou` — é regra da Meta, não defeito nosso', async () => {
    const linha = (await envios(ag5))[0];
    verdade(linha.status !== 'falhou', 'foi marcado como falha');
  });

  await zerar();
  const ag5b = await semearAgendamento(
    { titulo: 'Fora da janela, COM modelo', usarTemplate: true, templateNome: 'lembrete_consulta' },
    ['5598900000011'],
  );

  await medir('com modelo aprovado configurado, a mensagem SAI por modelo', async () => {
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 1, 'mensagens que saíram');
    igual(canal.enviados[0].tipo, 'template', 'tipo da intenção despachada');
    igual(canal.enviados[0].corpo, 'lembrete_consulta', 'nome do modelo');
    const linha = (await envios(ag5b))[0];
    igual(linha.status, 'enviado');
    igual(linha.motivo, 'por_modelo_fora_da_janela');
  });

  await zerar();
  await clienteA.ragnabotFluxoJanela.create({
    data: {
      id: crypto.randomUUID(), phoneNumberId: '111222333', destinatarioWaId: '5598900000012',
      cwAccountId: CONTA, ultimaEntradaEm: new Date('2026-09-03T10:00:00Z'),
      expiraEm: new Date('2026-09-04T10:00:00Z'), atualizadaEm: new Date(),
    },
  });
  const ag5c = await semearAgendamento({ titulo: 'Dentro da janela' }, ['5598900000012']);

  await medir('com a janela ABERTA, o texto livre sai normalmente', async () => {
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 1, 'mensagens');
    igual(canal.enviados[0].tipo, 'texto', 'tipo da intenção');
    igual((await envios(ag5c))[0].status, 'enviado');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('6. NADA SAI SEM CANAL — adia com motivo, não perde (exigência nº 6)');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  await semearCaixa({ removida: true });
  const ag6 = await semearAgendamento({ titulo: 'Conexão desligada' }, ['5598900000020', '5598900000021']);

  await medir('conexão desligada: os 2 itens ficam ADIADOS, com motivo e horário de nova tentativa', async () => {
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 0, 'mensagens que saíram');
    igual(r.adiados, 2, 'itens adiados');
    const lista = await envios(ag6);
    igual(JSON.stringify(porStatus(lista)), '{"adiado":2}');
    igual(lista[0].motivo, 'caixa_inativa');
    verdade(lista[0].proximaTentativaEm, 'não marcou quando tentar de novo');
    verdade(/NÃO foi perdida/u.test(lista[0].erro), 'a mensagem não diz que nada foi perdido');
    return `adiados até ${lista[0].proximaTentativaEm.toISOString()} (tentativa ${lista[0].tentativas})`;
  });

  await medir('religada a conexão e vencido o recuo, a retentativa ENTREGA o que estava adiado', async () => {
    await semearCaixa(); // conexão de volta
    RELOGIO = new Date(RELOGIO.getTime() + 5 * 60_000); // passa o recuo de 1 min
    const r = await workerA.retentarAdiados({});
    igual(r.vistos, 2, 'itens vistos');
    igual(r.enviados, 2, 'entregues na retentativa');
    igual(canal.enviados.length, 2, 'mensagens que saíram');
    igual(JSON.stringify(porStatus(await envios(ag6))), '{"enviado":2}');
  });

  // ⚠️ DEFEITO REAL, achado relendo o código depois de o teste acima já estar verde: `reservadoEm`
  // é de onde o CEIFADOR mede o prazo de visibilidade. Ao reabrir um envio `adiado`, a primeira
  // versão não o renovava — então uma linha adiada há vinte minutos voltava a `reservado` JÁ
  // VENCIDA, e o ceifador da OUTRA réplica a marcaria como «duvidosa» no mesmo instante em que
  // esta aqui estava legitimamente mandando a mensagem. O registro diria «pode ter saído» sobre um
  // envio que saiu com toda a certeza. Corrigido renovando `reservadoEm` na reabertura.
  await medir('a retentativa RENOVOU o prazo da reserva (senão o ceifador da outra réplica mataria)', async () => {
    const lista = await envios(ag6);
    const maisVelha = lista.reduce((a, b) => (a.reservadoEm < b.reservadoEm ? a : b));
    verdade(maisVelha.reservadoEm.getTime() >= RELOGIO.getTime() - 1000,
      `o prazo ficou velho: reserva em ${maisVelha.reservadoEm.toISOString()} contra o relógio ${RELOGIO.toISOString()}`);
    return `reserva renovada para ${maisVelha.reservadoEm.toISOString()} (relógio ${RELOGIO.toISOString()})`;
  });

  await zerar();
  const ag6b = await semearAgendamento({ titulo: 'Sem porta de canal' }, ['5598900000030']);

  await medir('sem a porta do canal amarrada no processo: ADIA (não falha, não perde)', async () => {
    workerA.configurarAgendamentoWorker({ canal: null });
    try {
      const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
      igual(r.adiados, 1, 'adiados');
      const linha = (await envios(ag6b))[0];
      igual(linha.status, 'adiado');
      igual(linha.motivo, 'canal_ausente');
      return linha.erro;
    } finally {
      workerA.configurarAgendamentoWorker({ canal: canal.porta });
    }
  });

  await medir('falha de REDE vira DÚVIDA (não sei se chegou), não falha nem retentativa cega', async () => {
    await zerar();
    const agRede = await semearAgendamento({ titulo: 'Rede caiu' }, ['5598900000031']);
    canal.recusar(9001, Object.assign(new Error('falha de rede ao falar com a plataforma'), { code: 'ECONNRESET' }));
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(r.duvidosos, 1, 'duvidosos');
    const linha = (await envios(agRede))[0];
    igual(linha.status, 'duvidoso');
    verdade(/não sei se a mensagem chegou/u.test(linha.erro), 'o motivo não diz que é dúvida');
    return linha.erro.slice(0, 90) + '…';
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('7. CANCELAR E PAUSAR (exigência nº 5)');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  const superUsuario = { id: 'u1', name: 'Dona da conta', isSuperuser: true };
  const ag7 = await semearAgendamento({ titulo: 'Vai ser cancelado' }, ['5598900000040']);

  await medir('cancelado NÃO dispara', async () => {
    await dominio.cancelar(superUsuario, ag7, { tenantId: TENANT });
    const r = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(r.vistas, 0, 'agendas vistas pelo trabalhador');
    igual(canal.enviados.length, 0, 'mensagens');
    igual((await agenda(ag7)).status, 'cancelado');
  });

  await medir('cancelar fecha os envios que estavam a caminho, com motivo — nada fica pendurado', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Cancelado com item adiado' }, ['5598900000041']);
    workerA.configurarAgendamentoWorker({ canal: null });
    await workerA.dispararVencidos({ workerId: 'pod-A' }); // gera um `adiado`
    workerA.configurarAgendamentoWorker({ canal: canal.porta });
    await dominio.cancelar(superUsuario, ag, { tenantId: TENANT });
    const lista = await envios(ag);
    igual(lista[0].status, 'cancelado');
    igual(lista[0].motivo, 'agendamento_cancelado');
  });

  await medir('pausado NÃO dispara; retomado volta à grade sem disparar o atrasado', async () => {
    await zerar();
    const ag = await semearAgendamento({
      titulo: 'Pausa e volta', recorrencia: 'diaria', intervalo: 1,
      inicioEm: new Date('2026-09-03T11:00:00.000Z'), proximaEm: new Date('2026-09-03T11:00:00.000Z'),
    }, ['5598900000042']);
    await dominio.pausar(superUsuario, ag, { tenantId: TENANT });
    const r1 = await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(r1.vistas, 0, 'agendas vistas com a agenda pausada');
    igual(canal.enviados.length, 0, 'mensagens durante a pausa');
    // Três dias depois, o operador retoma.
    const depois = new Date('2026-09-06T13:00:00.000Z');
    const voltou = await dominio.retomar(superUsuario, ag, { tenantId: TENANT, agora: depois });
    igual(voltou.status, 'pendente');
    verdade(voltou.proximaEm.getTime() > depois.getTime(),
      `a próxima ocorrência ficou no passado (${voltou.proximaEm.toISOString()}) e dispararia o atrasado`);
    return `retomado: próxima em ${voltou.proximaEm.toISOString()} (nada de três «bom dia» de uma vez)`;
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('8. RECORRÊNCIA NO BANCO — avança UMA vez, e a virada do dia mantém a hora local');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  // 23h50 de 02/09 em Fortaleza = 03/09 02:50 UTC. O relógio do teste está em 03/09 12:00 UTC.
  const ag8 = await semearAgendamento({
    titulo: 'Diário às 23h50', recorrencia: 'diaria', intervalo: 1, minutoLocal: 23 * 60 + 50,
    inicioEm: new Date('2026-09-03T02:50:00.000Z'), proximaEm: new Date('2026-09-03T02:50:00.000Z'),
  }, ['5598900000050']);

  const naFortaleza = (d) => new Intl.DateTimeFormat('pt-BR', {
    timeZone: FORTALEZA, hourCycle: 'h23', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);

  await medir('depois do disparo, a próxima ocorrência é 23h50 do dia seguinte NO RELÓGIO DO CLIENTE', async () => {
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    const a = await agenda(ag8);
    igual(a.ocorrenciasFeitas, 1, 'ocorrências feitas');
    igual(naFortaleza(a.proximaEm), '03/09, 23:50', 'próxima ocorrência no fuso do cliente');
    igual(a.status, 'pendente', 'a agenda continua viva');
    return `próxima: ${naFortaleza(a.proximaEm)} (${a.proximaEm.toISOString()})`;
  });

  await medir('duas réplicas na MESMA ocorrência recorrente: a ocorrência avança UMA vez só', async () => {
    RELOGIO = new Date('2026-09-04T03:00:00.000Z'); // já passou das 23h50 de 03/09
    const antes = await agenda(ag8);
    await Promise.all([
      workerA.dispararVencidos({ workerId: 'pod-A' }),
      workerB.dispararVencidos({ workerId: 'pod-B' }),
    ]);
    const a = await agenda(ag8);
    igual(a.ocorrenciasFeitas, 2, 'ocorrências feitas (não 3)');
    igual(naFortaleza(a.proximaEm), '04/09, 23:50', 'a grade avançou exatamente um dia');
    igual(canal.enviados.length, 2, 'mensagens no total (uma por ocorrência)');
    return `${naFortaleza(antes.proximaEm)} → ${naFortaleza(a.proximaEm)}`;
  });

  await medir('`maxOcorrencias` conclui a agenda em vez de repetir para sempre', async () => {
    await zerar();
    const ag = await semearAgendamento({
      titulo: 'Duas vezes e acabou', recorrencia: 'diaria', intervalo: 1,
      inicioEm: new Date('2026-09-03T11:00:00.000Z'), proximaEm: new Date('2026-09-03T11:00:00.000Z'),
    }, ['5598900000051']);
    await clienteA.ragnabotAgendamento.update({ where: { id: ag }, data: { maxOcorrencias: 2 } });
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    RELOGIO = new Date('2026-09-04T12:00:00.000Z');
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    const a = await agenda(ag);
    igual(a.ocorrenciasFeitas, 2, 'ocorrências');
    igual(a.status, 'concluido', 'estado final');
    igual(canal.enviados.length, 2, 'mensagens');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('9. ANEXO E TICKET FECHADO');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await zerar();
  const ag9 = await semearAgendamento({
    titulo: 'Com anexo, sem abrir ticket',
    anexoUrl: 'https://arquivos.ragnatela.com.br/aviso.pdf',
    abrirTicket: false,
  }, ['5598900000060']);

  await medir('com anexo, a intenção é `midia` e a mensagem vira LEGENDA (F4.5)', async () => {
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 1, 'mensagens');
    igual(canal.enviados[0].tipo, 'midia', 'tipo da intenção');
    igual(canal.enviados[0].corpo, 'Sua consulta é amanhã às 14h.', 'legenda');
  });

  await medir('«não abrir ticket» resolve a conversa QUE NÓS abrimos (F4.4)', async () => {
    const resolvidas = chatwoot.acoes.filter((a) => a.acao === 'resolver');
    igual(resolvidas.length, 1, 'conversas resolvidas');
    igual((await envios(ag9))[0].ticketAberto, false, 'ticket aberto?');
    igual((await envios(ag9))[0].conversaCriada, true, 'a conversa foi criada por nós?');
  });

  await medir('conversa PREEXISTENTE com «não abrir ticket» NÃO é fechada embaixo do atendente', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Conversa que já existia', abrirTicket: false }, ['5598900000061']);
    // O destino já aponta para uma conversa: o trabalhador não precisa criá-la.
    await clienteA.ragnabotAgendamentoDestino.updateMany({
      where: { agendamentoId: ag }, data: { cwConversationId: 5555 },
    });
    await workerA.dispararVencidos({ workerId: 'pod-A' });
    igual(canal.enviados.length, 1, 'mensagens');
    igual(chatwoot.acoes.filter((a) => a.acao === 'resolver').length, 0, 'conversas resolvidas (tem de ser 0)');
    igual((await envios(ag))[0].conversaCriada, false, 'a conversa foi criada por nós?');
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  secao('10. O CEIFADOR SOLTA A AGENDA PRESA POR RÉPLICA MORTA');
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  await medir('agenda travada além do prazo volta a poder disparar', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Presa por pod morto' }, ['5598900000070']);
    await clienteA.ragnabotAgendamento.update({
      where: { id: ag }, data: { donoWorker: 'pod-que-morreu', travadoEm: new Date(RELOGIO.getTime() - 10 * 60_000) },
    });
    const r1 = await workerA.dispararVencidos({ workerId: 'pod-novo' });
    // Mesmo sem o ceifador, a posse com prazo vencido já é tomável — é o que impede a agenda de
    // congelar para sempre quando um pod morre segurando-a.
    igual(r1.enviados, 1, 'entregas depois de a posse vencer');
    const c = await workerA.ceifarPresos();
    verdade(c.agendasSoltas >= 0, 'o ceifador estourou');
    return `posse vencida foi retomada · ceifador soltou ${c.agendasSoltas} agenda(s)`;
  });

  await medir('agenda travada DENTRO do prazo NÃO é roubada por outra réplica', async () => {
    await zerar();
    const ag = await semearAgendamento({ titulo: 'Em posse de outra réplica' }, ['5598900000071']);
    await clienteA.ragnabotAgendamento.update({
      where: { id: ag }, data: { donoWorker: 'pod-A', travadoEm: new Date(RELOGIO.getTime() - 5_000) },
    });
    const r = await workerB.dispararVencidos({ workerId: 'pod-B' });
    igual(r.disputadas, 1, 'disputas');
    igual(canal.enviados.length, 0, 'mensagens (tem de ser 0)');
  });
} finally {
  // ── Limpeza: o esquema temporário some, aconteça o que acontecer ─────────────────────────────
  try { await clienteA.$disconnect(); } catch { /* saída */ }
  try { await clienteB.$disconnect(); } catch { /* saída */ }
  try { await admin.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`); } catch (e) {
    console.log(`  ⚠️  não consegui apagar o esquema ${esquema}: ${e.message}`);
  }
  try { await admin.end(); } catch { /* saída */ }
}

console.log(`\n${'─'.repeat(84)}`);
console.log(falhas === 0
  ? `✅ ${medicoes} medições, 0 reprovações — contra Postgres de verdade, com duas réplicas.`
  : `❌ ${medicoes} medições, ${falhas} reprovação(ões).`);
console.log(`${'─'.repeat(84)}\n`);
process.exit(falhas === 0 ? 0 : 1);
