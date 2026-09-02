#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RETROCARGA DA CAIXA — as conversas que já existiam entram na fila.  Contrato S3, parte 1.
//
// ── A PERGUNTA QUE ESTE ARQUIVO RESPONDE ────────────────────────────────────────────────────────
// «A caixa nasce vazia?» O índice só se enche pelo webhook, e o webhook ainda não está cadastrado
// (decisão do chefe). Sem retrocarga, as conversas que JÁ EXISTEM na plataforma seriam invisíveis
// e o operador concluiria — com razão aparente — que o produto não funciona.
//
// ── O QUE ESTÁ SOB JULGAMENTO ───────────────────────────────────────────────────────────────────
//  · o serviço REAL de retrocarga, escrevendo pelo serviço REAL da caixa;
//  · num PostgreSQL de VERDADE, com as tabelas criadas pelo SQL VERSIONADO;
//  · a rota REAL, num Express de verdade, com a recusa de permissão medida por HTTP.
// O que é dublê é só a PLATAFORMA (não há Chatwoot alcançável daqui, e há ZERO caixas de WhatsApp
// criadas em 02/09/2026 — este é o limite honesto desta prova).
//
// ── AS TRÊS COISAS QUE PRECISAM SER PROVADAS, E POR QUÊ ─────────────────────────────────────────
//  1. ENRIQUECIMENTO: `conversasEmAtendimento` NÃO devolve nome de contato, nome de caixa nem
//     protocolo — foi o aviso do relatório anterior. Índice pela metade é cartão que o atendente
//     não consegue usar. Aqui cada um dos três vem do dono certo.
//  2. IDEMPOTÊNCIA: rodar duas vezes não duplica nem muda o resultado.
//  3. NÃO PIORAR: a retrocarga NÃO sobrescreve o que o webhook gravou melhor. A plataforma não
//     sabe quem resolveu a conversa; o evento sabia. Quem chegou primeiro pelo evento manda.
//
// COMO RODAR
//     RAGNABOT_TESTE_DB_URL='postgresql://usuário:senha@servidor:5432/base' \
//       node tests/ragnabot-caixa-retrocarga.test.mjs
//
// ⚠️ Cria um SCHEMA temporário `zz_teste_retro_<pid>_<aleatório>` e o derruba no fim. Nenhuma
// tabela existente é tocada.
//
// CÓDIGOS: 0 = tudo provado · 1 = reprovou · 2 = não pôde executar (sem banco) · 3 = erro
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL_CAIXA = path.join(AQUI, '..', 'prisma', 'sql', 'caixa-atendimento', '01-rb_caixa_atendimento.sql');

let passou = 0; let reprovou = 0; let naoExecutou = 0;
const ok = (t, d = '') => { passou += 1; console.log(`  ✅ ${t}${d ? ` — ${d}` : ''}`); };
const falhou = (t, d = '') => { reprovou += 1; console.log(`  ❌ ${t}${d ? ` — ${d}` : ''}`); };
const pulou = (t, m) => { naoExecutou += 1; console.log(`  ⚠️  NÃO EXECUTOU: ${t} — ${m}`); };
const conferir = (t, cond, d = '') => (cond ? ok(t, d) : falhou(t, d));
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 84 - t.length))}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE 1 — A MONTAGEM DA LINHA, sem banco e sem rede.
// É a regra que decide o que é gravado; ela precisa caber inteira num teste puro.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function parteUm() {
  secao('1. A MONTAGEM — o que é lido, o que é deduzido e o que NUNCA é apagado');
  const R = await import('../src/services/ragnabot-caixa-retrocarga.service.js');
  const porta = await import('../src/services/ragnabot-chatwoot.porta.js');

  // O payload CRU da plataforma, como a API o devolve (epoch em SEGUNDOS, remetente em meta.sender,
  // canal com prefixo `Channel::`). É a tradução que mais custa quando erra.
  const cru = {
    id: 501,
    inbox_id: 34,
    status: 'open',
    channel: 'Channel::Whatsapp',
    // Epoch em SEGUNDOS, como a API devolve. Escrito por conta a partir da data, para o teste não
    // depender de um número mágico que ninguém confere.
    created_at: Math.floor(new Date('2026-09-01T10:00:00Z').getTime() / 1000),
    last_activity_at: Math.floor(new Date('2026-09-01T11:00:00Z').getTime() / 1000),
    labels: ['vip'],
    meta: {
      sender: { id: 900, name: 'Maria Souza', phone_number: '+5598911110000' },
      assignee: { id: 11, name: 'Ana' },
      team: { id: 9100, name: 'Suporte' },
    },
  };
  const rica = porta.conversaRica(cru, 7);
  conferir('⭐ a leitura RICA traz o CONTATO (que `conversasEmAtendimento` descarta)',
    rica.contatoNome === 'Maria Souza' && rica.contatoChave === '+5598911110000',
    `${rica.contatoNome} · ${rica.contatoChave}`);
  conferir('o canal perde o prefixo `Channel::`, igual ao webhook (uma grafia só)',
    rica.canal === 'whatsapp', rica.canal);
  conferir('epoch em SEGUNDOS vira data de 2026, não de 1970',
    rica.abertaEm instanceof Date && rica.abertaEm.getUTCFullYear() === 2026,
    String(rica.abertaEm));
  conferir('o setor e o atendente vêm com NOME', rica.setorNome === 'Suporte' && rica.atendenteNome === 'Ana');

  const apoio = {
    tenantId: 'T1',
    caixas: new Map([[34, { nome: 'WhatsApp Comercial', canal: 'whatsapp' }]]),
    setores: new Map([[9100, 'Suporte']]),
    protocolos: new Map([[501, 'RGT-0000000012']]),
    comRobo: new Set(),
  };
  const { dados, aproximacoes } = R.montarProjecao(rica, apoio);
  conferir('⭐ o NOME DA CAIXA vem do NOSSO cadastro (a plataforma só manda o id)',
    dados.caixaNome === 'WhatsApp Comercial', dados.caixaNome);
  conferir('⭐ o PROTOCOLO vem do nosso `RagnabotProtocolo`',
    dados.protocolo === 'RGT-0000000012', dados.protocolo);
  conferir('nenhuma aproximação numa conversa aberta e completa',
    aproximacoes.length === 0, JSON.stringify(aproximacoes));

  // ── o que NÃO se sabe viaja `undefined`, e `projetarConversa` não escreve `undefined` ────────
  const magra = porta.conversaRica({ id: 502, inbox_id: 34, status: 'pending', meta: {} }, 7);
  const r2 = R.montarProjecao(magra, apoio);
  conferir('⛔ campo que a plataforma não trouxe é `undefined` (não `null`) — retrocarga NÃO apaga',
    r2.dados.cwAssigneeId === undefined && r2.dados.cwTeamId === undefined
    && r2.dados.contatoNome === undefined,
    JSON.stringify({ assignee: r2.dados.cwAssigneeId, team: r2.dados.cwTeamId }));
  conferir('conversa sem contato é DECLARADA como aproximação, não escondida',
    r2.aproximacoes.includes(R.APROXIMACOES.SEM_CONTATO));

  // ── grupo ────────────────────────────────────────────────────────────────────────────────────
  const grupo = porta.conversaRica({ id: 503, inbox_id: 34, status: 'open', meta: { sender: { id: 1, name: 'Obra', identifier: '1203630000@g.us' } } }, 7);
  conferir('grupo de WhatsApp é reconhecido pelo mesmo sinal do webhook (`@g.us`)',
    R.montarProjecao(grupo, apoio).dados.ehGrupo === true);

  // ── resolvida: as duas aproximações declaradas ───────────────────────────────────────────────
  const resolvida = porta.conversaRica({
    id: 504, inbox_id: 34, status: 'resolved',
    created_at: Math.floor(new Date('2026-08-30T10:00:00Z').getTime() / 1000),
    status_changed_at: Math.floor(new Date('2026-08-30T11:00:00Z').getTime() / 1000), meta: { sender: { id: 2, name: 'João', phone_number: '+5598922220000' }, assignee: { id: 12, name: 'Bruno' } },
  }, 7);
  const r4 = R.montarProjecao(resolvida, apoio);
  conferir('⚠️ conversa resolvida: o instante e o autor da resolução são DEDUZIDOS, e isso é dito',
    r4.aproximacoes.includes(R.APROXIMACOES.RESOLVIDA_EM_APROXIMADA)
    && r4.aproximacoes.includes(R.APROXIMACOES.RESOLVIDA_POR_DEDUZIDA),
    JSON.stringify(r4.aproximacoes));
  conferir('e o autor deduzido é quem estava com a conversa na mão',
    r4.dados.resolvidaPorCwUserId === 12 && r4.dados.resolvidaPorNome === 'Bruno');

  // ── caixa que não está no cadastro ───────────────────────────────────────────────────────────
  const foraDoCadastro = porta.conversaRica({ id: 505, inbox_id: 99, status: 'open', channel: 'Channel::WebWidget', meta: {} }, 7);
  const r5 = R.montarProjecao(foraDoCadastro, apoio);
  conferir('caixa fora do cadastro é declarada, e o canal ainda assim vem do payload',
    r5.aproximacoes.includes(R.APROXIMACOES.SEM_CAIXA_CADASTRADA) && r5.dados.canal === 'webwidget',
    r5.dados.canal);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE 2 — BANCO DE VERDADE + ROTA DE VERDADE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const T1 = '11111111-1111-4111-8111-111111111111';
const CONTA = 7;
const SUPORTE = 9100;

/** As conversas que a plataforma «já tem» — as ~7 do ambiente, reproduzidas em forma e variedade. */
function payloadDaPlataforma() {
  const seg = (iso) => Math.floor(new Date(iso).getTime() / 1000);
  return {
    open: [
      { id: 501, inbox_id: 34, status: 'open', channel: 'Channel::Whatsapp', created_at: seg('2026-09-01T10:00:00Z'), last_activity_at: seg('2026-09-02T09:00:00Z'),
        meta: { sender: { id: 900, name: 'Maria Souza', phone_number: '+5598911110000' }, assignee: { id: 11, name: 'Ana' }, team: { id: SUPORTE, name: 'Suporte' } } },
      { id: 502, inbox_id: 34, status: 'open', channel: 'Channel::Whatsapp', created_at: seg('2026-09-01T11:00:00Z'), last_activity_at: seg('2026-09-02T09:30:00Z'),
        meta: { sender: { id: 901, name: 'João Lima', phone_number: '+5598922220000' }, team: { id: SUPORTE, name: 'Suporte' } } },
      // Com o ROBÔ: chega da plataforma igualzinha à de cima («aberta sem responsável»). Só o
      // nosso banco sabe distinguir — é o que separa a sub-aba ChatBot da fila.
      { id: 503, inbox_id: 34, status: 'open', channel: 'Channel::Whatsapp', created_at: seg('2026-09-02T08:00:00Z'), last_activity_at: seg('2026-09-02T08:10:00Z'),
        meta: { sender: { id: 902, name: 'Carla Dias', phone_number: '+5598933330000' } } },
      // Grupo.
      { id: 504, inbox_id: 34, status: 'open', channel: 'Channel::Whatsapp', created_at: seg('2026-09-02T07:00:00Z'), last_activity_at: seg('2026-09-02T07:30:00Z'),
        meta: { sender: { id: 903, name: 'Obra Centro', identifier: '1203630000@g.us' }, team: { id: SUPORTE, name: 'Suporte' } } },
    ],
    pending: [
      { id: 505, inbox_id: 35, status: 'pending', channel: 'Channel::WebWidget', created_at: seg('2026-09-02T06:00:00Z'), last_activity_at: seg('2026-09-02T06:05:00Z'),
        meta: { sender: { id: 904, name: 'Visitante do site', identifier: 'web-abc123' } } },
    ],
    resolved: [
      { id: 506, inbox_id: 34, status: 'resolved', channel: 'Channel::Whatsapp', created_at: seg('2026-08-30T10:00:00Z'), status_changed_at: seg('2026-08-30T11:00:00Z'), last_activity_at: seg('2026-08-30T11:00:00Z'),
        meta: { sender: { id: 900, name: 'Maria Souza', phone_number: '+5598911110000' }, assignee: { id: 11, name: 'Ana' }, team: { id: SUPORTE, name: 'Suporte' } } },
      // ⭐ ESTA é a que o webhook «já tinha gravado melhor»: resolvida por outra pessoa.
      { id: 507, inbox_id: 34, status: 'resolved', channel: 'Channel::Whatsapp', created_at: seg('2026-08-29T10:00:00Z'), status_changed_at: seg('2026-08-29T12:00:00Z'), last_activity_at: seg('2026-08-29T12:00:00Z'),
        meta: { sender: { id: 901, name: 'João Lima', phone_number: '+5598922220000' }, assignee: { id: 11, name: 'Ana' }, team: { id: SUPORTE, name: 'Suporte' } } },
    ],
    snoozed: [],
  };
}

async function parteDois() {
  const urlBase = (process.env.RAGNABOT_TESTE_DB_URL || '').trim();
  if (!urlBase) {
    pulou('a retrocarga contra banco e rota de verdade',
      'defina RAGNABOT_TESTE_DB_URL (o banco `ragnabot` vive dentro do cluster e não é alcançável daqui)');
    return;
  }

  const esquema = `zz_teste_retro_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const { Client } = await import('pg');
  const cliente = new Client({ connectionString: urlBase });
  await cliente.connect();

  let prisma = null; let servidor = null;
  try {
    secao('2. O BANCO — as 3 tabelas nascem do SQL VERSIONADO da caixa');
    await cliente.query(`CREATE SCHEMA "${esquema}"`);
    await cliente.query(`SET search_path TO "${esquema}"`);
    await cliente.query(fs.readFileSync(SQL_CAIXA, 'utf8'));

    // ── ANDAIME DE TESTE (não é migração) ───────────────────────────────────────────────────────
    // As três tabelas de onde a retrocarga BUSCA o que a plataforma não dá. Recorte mínimo, só as
    // colunas que o serviço lê — o `select` explícito de cada consulta é o contrato. As tabelas de
    // produção destas três já existem no schema há muito tempo; recriá-las inteiras aqui não
    // provaria nada a mais e envelheceria a cada campo novo.
    await cliente.query(`
      CREATE TABLE "RagnabotInbox" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "cwInboxId" INTEGER,
        "name" TEXT NOT NULL, "channelType" TEXT NOT NULL, "identifier" TEXT NOT NULL,
        "removedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE "RagnabotProtocolo" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "prefixo" TEXT NOT NULL,
        "numero" INTEGER NOT NULL, "protocolo" TEXT NOT NULL,
        "cwConversationId" INTEGER NOT NULL, "cwAccountId" INTEGER NOT NULL,
        "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE "RagnabotFluxoExecucao" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
        "cwAccountId" INTEGER NOT NULL, "cwConversationId" INTEGER NOT NULL,
        "estado" TEXT NOT NULL DEFAULT 'rodando'
      );
    `);
    ok('andaime de teste criado (RagnabotInbox · RagnabotProtocolo · RagnabotFluxoExecucao)');

    const u = new URL(urlBase);
    u.searchParams.set('schema', esquema);
    process.env.DATABASE_URL = u.toString();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    // ── o que o NOSSO lado já sabe ──────────────────────────────────────────────────────────────
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RagnabotInbox" ("id","tenantId","cwInboxId","name","channelType","identifier")
       VALUES ('i1',$1,34,'WhatsApp Comercial','whatsapp','5598900000000'),
              ('i2',$1,35,'Site da Ragnatela','web_widget','site')`, T1,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RagnabotProtocolo" ("id","tenantId","prefixo","numero","protocolo","cwConversationId","cwAccountId")
       VALUES ('p1',$1,'RGT',12,'RGT-0000000012',501,7),
              ('p2',$1,'RGT',13,'RGT-0000000013',506,7)`, T1,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RagnabotFluxoExecucao" ("id","tenantId","cwAccountId","cwConversationId","estado")
       VALUES ('e1',$1,7,503,'esperando'),
              ('e2',$1,7,501,'concluido')`, T1,
    );
    await prisma.ragnabotSetor.create({ data: { tenantId: T1, cwAccountId: CONTA, cwTeamId: SUPORTE, nome: 'Suporte' } });

    // ── a PLATAFORMA-DUBLÊ ──────────────────────────────────────────────────────────────────────
    // Só a leitura HTTP é dublê. `conversaRica` — a tradução, que é onde se erra — é a REAL.
    const portaReal = await import('../src/services/ragnabot-chatwoot.porta.js');
    const dados = payloadDaPlataforma();
    let chamadasDeLeitura = 0;
    const plataforma = {
      async listarConversasRicas({ estados = ['open', 'pending', 'resolved', 'snoozed'] } = {}) {
        chamadasDeLeitura += 1;
        const itens = []; const lidasPorEstado = {};
        for (const e of estados) {
          const lote = dados[e] || [];
          lidasPorEstado[e] = lote.length;
          for (const c of lote) itens.push(portaReal.conversaRica(c, CONTA));
        }
        return { itens, lidasPorEstado, truncou: false, falhas: [] };
      },
      async listarTimes() { return [{ id: SUPORTE, nome: 'Suporte' }]; },
      async membrosDoTime() { return [{ id: 11, nome: 'Ana', email: 'ana@x.com' }]; },
    };

    const caixa = await import('../src/services/ragnabot-caixa.service.js');
    caixa.configurarCaixa({ db: prisma, plataforma });
    const retro = await import('../src/services/ragnabot-caixa-retrocarga.service.js');
    retro.configurarRetrocarga({ db: prisma, plataforma, caixa });

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('3. A SIMULAÇÃO — mede e relata SEM gravar nada');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const simulado = await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA, simular: true });
    const gravadasDepoisDaSimulacao = await prisma.ragnabotConversa.count();
    conferir('a simulação leu as 7 conversas', simulado.lidas === 7, `lidas: ${simulado.lidas}`);
    conferir('⛔ e NÃO gravou nenhuma linha', gravadasDepoisDaSimulacao === 0, `no banco: ${gravadasDepoisDaSimulacao}`);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('4. ⭐ A RETROCARGA — a caixa deixa de nascer vazia');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const r1 = await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA });
    conferir('7 conversas lidas, 7 CRIADAS', r1.lidas === 7 && r1.criadas === 7 && r1.atualizadas === 0,
      `criadas ${r1.criadas} · atualizadas ${r1.atualizadas} · não gravadas ${r1.naoGravadas}`);

    console.log('\n     O QUE ENTROU NO ÍNDICE (saída real do serviço):');
    console.log('     ┌────────┬──────────────┬────────────────────┬──────────┬─────────────────┬──────────────────┐');
    console.log('     │ conv.  │ estado       │ caixa              │ setor    │ contato         │ protocolo        │');
    console.log('     ├────────┼──────────────┼────────────────────┼──────────┼─────────────────┼──────────────────┤');
    for (const i of r1.itens) {
      const col = (v, n) => String(v ?? '—').slice(0, n).padEnd(n);
      console.log(`     │ ${col(i.cwConversationId, 6)} │ ${col(i.estado, 12)} │ ${col(i.caixa, 18)} │ ${col(i.setor, 8)} │ ${col(i.contato, 15)} │ ${col(i.protocolo, 16)} │`);
    }
    console.log('     └────────┴──────────────┴────────────────────┴──────────┴─────────────────┴──────────────────┘');
    console.log(`     por estado: ${JSON.stringify(r1.porEstado)}`);
    console.log(`     aproximações declaradas: ${JSON.stringify(r1.aproximacoes)}`);

    const noBanco = await prisma.ragnabotConversa.findMany({ orderBy: { cwConversationId: 'asc' } });
    const porId = new Map(noBanco.map((c) => [c.cwConversationId, c]));

    conferir('⭐ o NOME DO CONTATO está no índice (o que `conversasEmAtendimento` não dá)',
      porId.get(501).contatoNome === 'Maria Souza', porId.get(501).contatoNome);
    conferir('⭐ o NOME DA CAIXA veio do nosso cadastro de conexões',
      porId.get(501).caixaNome === 'WhatsApp Comercial' && porId.get(505).caixaNome === 'Site da Ragnatela',
      `${porId.get(501).caixaNome} · ${porId.get(505).caixaNome}`);
    conferir('⭐ o PROTOCOLO veio do nosso `RagnabotProtocolo`',
      porId.get(501).protocolo === 'RGT-0000000012' && porId.get(506).protocolo === 'RGT-0000000013');
    conferir('conversa sem protocolo fica sem protocolo (nada é inventado)',
      porId.get(502).protocolo === null);

    conferir('estado ATENDENDO para a que tem responsável', porId.get(501).estado === 'atendendo');
    conferir('estado AGUARDANDO para a que está na fila', porId.get(502).estado === 'aguardando');
    conferir('⭐ estado CHATBOT para a que tem execução de fluxo VIVA — a plataforma não sabe distinguir',
      porId.get(503).estado === 'chatbot', porId.get(503).estado);
    conferir('execução CONCLUÍDA não conta como robô (a 501 tem uma, e segue "atendendo")',
      porId.get(501).comRobo === false);
    conferir('grupo é marcado pelo mesmo sinal do webhook', porId.get(504).ehGrupo === true);
    conferir('conversa do site entra com o canal certo', porId.get(505).canal === 'web_widget', porId.get(505).canal);
    conferir('resolvida entra como RESOLVIDA, com o carimbo de ordenação preenchido',
      porId.get(506).estado === 'resolvida' && porId.get(506).resolvidaEm instanceof Date);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('5. ⭐ IDEMPOTÊNCIA — rodar de novo não duplica e não muda nada');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const antes = await prisma.ragnabotConversa.findMany({ orderBy: { cwConversationId: 'asc' } });
    const r2 = await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA });
    const depois = await prisma.ragnabotConversa.findMany({ orderBy: { cwConversationId: 'asc' } });

    conferir('continuam 7 linhas (nada duplicou)', depois.length === 7, `linhas: ${depois.length}`);
    conferir('a segunda passada relata 0 criadas e 7 atualizadas',
      r2.criadas === 0 && r2.atualizadas === 7, `criadas ${r2.criadas} · atualizadas ${r2.atualizadas}`);

    const comparavel = (l) => JSON.stringify({
      ...l, id: null, criadoEm: null, atualizadoEm: null,
    });
    const iguais = antes.every((a, i) => comparavel(a) === comparavel(depois[i]));
    conferir('⭐ e o CONTEÚDO de cada linha é idêntico ao da primeira passada', iguais,
      iguais ? '' : `divergiu: ${antes.filter((a, i) => comparavel(a) !== comparavel(depois[i])).map((a) => a.cwConversationId).join(', ')}`);
    conferir('o carimbo de resolução NÃO se moveu (a lista de Resolvidos não dança sozinha)',
      String(antes.find((x) => x.cwConversationId === 506).resolvidaEm)
      === String(depois.find((x) => x.cwConversationId === 506).resolvidaEm));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('6. ⭐ NÃO PIORAR — a retrocarga não sobrescreve o que o webhook sabia melhor');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // O webhook gravou a 507 no instante do encerramento: sabe QUEM resolveu (Bruno, 12) e QUANDO.
    // A plataforma, lida depois, só sabe quem é o responsável ATUAL (Ana, 11) e o status_changed_at.
    const carimboDoEvento = new Date('2026-08-29T12:34:56.000Z');
    await prisma.ragnabotConversa.update({
      where: { cwAccountId_cwConversationId: { cwAccountId: CONTA, cwConversationId: 507 } },
      data: { resolvidaEm: carimboDoEvento, resolvidaPorCwUserId: 12, resolvidaPorNome: 'Bruno' },
    });

    await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA });
    const c507 = await prisma.ragnabotConversa.findUnique({
      where: { cwAccountId_cwConversationId: { cwAccountId: CONTA, cwConversationId: 507 } },
    });
    conferir('⭐ QUEM resolveu continua sendo o do evento (Bruno), não o responsável atual (Ana)',
      c507.resolvidaPorCwUserId === 12 && c507.resolvidaPorNome === 'Bruno',
      `ficou: ${c507.resolvidaPorCwUserId} · ${c507.resolvidaPorNome}`);
    conferir('⭐ e o INSTANTE continua sendo o do evento, não a aproximação da plataforma',
      c507.resolvidaEm.getTime() === carimboDoEvento.getTime(),
      `ficou: ${c507.resolvidaEm.toISOString()}`);

    // O outro lado da mesma regra: o que a plataforma SABE melhor é atualizado.
    await prisma.ragnabotConversa.update({
      where: { cwAccountId_cwConversationId: { cwAccountId: CONTA, cwConversationId: 502 } },
      data: { contatoNome: 'nome velho' },
    });
    await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA });
    const c502 = await prisma.ragnabotConversa.findUnique({
      where: { cwAccountId_cwConversationId: { cwAccountId: CONTA, cwConversationId: 502 } },
    });
    conferir('o que a plataforma SABE (nome do contato) é sim atualizado',
      c502.contatoNome === 'João Lima', c502.contatoNome);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('7. A CAIXA DEPOIS DA RETROCARGA — o agente enxerga a fila dele');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    await prisma.ragnabotAgenteSetor.create({
      data: { tenantId: T1, cwAccountId: CONTA, cwUserId: 11, cwTeamId: SUPORTE, agenteNome: 'Ana' },
    });
    const ana = { id: 'cw:11', name: 'Ana', role: 'user', isSuperuser: false, cwUserId: 11, cwAccountId: CONTA, ragnabotTenantId: T1 };
    const admin = { id: 'cw:1', name: 'Admin', role: 'admin', isSuperuser: false, cwUserId: 1, cwAccountId: CONTA, ragnabotTenantId: T1 };

    const contAdmin = await caixa.contar(admin, {});
    conferir('o administrador vê a operação inteira: 3 abertas + 1 grupo + 2 resolvidas + 1 site',
      contAdmin.abertas === 4 && contAdmin.grupos === 1 && contAdmin.resolvidos === 2,
      JSON.stringify(contAdmin));

    const listaAna = await caixa.listar(ana, { aba: 'abertas' });
    const idsAna = listaAna.itens.map((i) => i.cwConversationId).sort((a, b) => a - b);
    conferir('⭐ Ana vê a conversa dela + a fila do setor dela — e nada mais',
      // 501 é dela; 502 e 504 estão na fila do Suporte (504 é grupo, sai da aba Abertas);
      // 503 e 505 não têm setor, então só o administrador as vê.
      idsAna.join(',') === '501,502', idsAna.join(','));

    const cartao = listaAna.itens.find((i) => i.cwConversationId === 501);
    conferir('⭐ o cartão da fila tem as TRÊS etiquetas preenchidas depois da retrocarga',
      cartao.etiquetas.map((e) => e.rotulo).join(' | ') === 'WhatsApp Comercial | Suporte | Ana',
      cartao.etiquetas.map((e) => `${e.tipo}: ${e.rotulo}`).join(' · '));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('8. A ROTA — permissão e resposta medidas por HTTP');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // O `RagnabotTenant` não existe neste esquema (é a tabela do SaaS, fora do recorte). A rota o
    // consulta pelo cliente global do módulo `base/db.js`; substituímos SÓ essa leitura.
    const prismaGlobal = (await import('../src/base/db.js')).default;
    prismaGlobal.ragnabotTenant = { async findUnique() { return { cwAccountId: CONTA }; } };

    const express = (await import('express')).default;
    const router = (await import('../src/routes/ragnabot-caixa.routes.js')).default;
    const app = express();
    app.use(express.json());
    let comoQuem = null;
    app.use((req, _res, prox) => { req.user = comoQuem; prox(); });
    app.use('/api/ragnabot-caixa', router);
    await new Promise((pronto) => { servidor = app.listen(0, '127.0.0.1', pronto); });
    const base = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-caixa`;
    const chamar = async (metodo, url, corpo) => {
      const resp = await fetch(base + url, {
        method: metodo, headers: { 'content-type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const t = await resp.text();
      let d = null; try { d = JSON.parse(t); } catch { d = null; }
      return { status: resp.status, corpo: d, cru: t };
    };

    comoQuem = ana;
    let h = await chamar('POST', '/retrocarga', {});
    conferir('⭐ ATENDENTE pedindo retrocarga pela API → RECUSA (403)',
      h.status === 403 && h.corpo?.code === 'SEM_PERMISSAO', `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    comoQuem = admin;
    h = await chamar('POST', '/retrocarga?simular=1', {});
    conferir('administrador consegue simular, e o relatório volta completo',
      h.status === 200 && h.corpo?.retrocarga?.lidas === 7 && h.corpo.retrocarga.simulacao === true,
      `HTTP ${h.status} · lidas ${h.corpo?.retrocarga?.lidas}`);

    h = await chamar('POST', '/retrocarga', {});
    conferir('administrador executa de verdade e o índice segue com 7 (idempotente pela rota)',
      h.status === 200 && (await prisma.ragnabotConversa.count()) === 7,
      `HTTP ${h.status} · criadas ${h.corpo?.retrocarga?.criadas} · atualizadas ${h.corpo?.retrocarga?.atualizadas}`);
    conferir('a rota também sincroniza os setores antes (é o que faz a fila aparecer ao agente)',
      h.corpo?.setores?.times === 1, JSON.stringify(h.corpo?.setores));

    console.log(`\n     (leituras da plataforma nesta bateria: ${chamadasDeLeitura})`);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('9. SEM PLATAFORMA CONFIGURADA — recusa com o motivo, nunca «deu certo» sobre nada');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    retro.configurarRetrocarga({ plataforma: null });
    try {
      await retro.retrocarregar({ tenantId: T1, cwAccountId: CONTA });
      falhou('sem plataforma a retrocarga tinha de recusar');
    } catch (e) {
      conferir('recusa com 503 e a frase que explica o risco',
        e.status === 503 && /caixa vazia/.test(e.message), `${e.code}: ${e.message.slice(0, 90)}…`);
    }
  } finally {
    if (servidor) await new Promise((p) => servidor.close(p));
    if (prisma) await prisma.$disconnect();
    await cliente.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await cliente.end();
    console.log(`\n  (esquema temporário ${esquema} derrubado)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
try {
  console.log('\nRETROCARGA DA CAIXA DE ATENDIMENTO — contrato S3, parte 1\n');
  await parteUm();
  await parteDois();
} catch (e) {
  console.error(`\n💥 ERRO INESPERADO: ${e?.stack || e?.message || e}`);
  process.exit(3);
}

console.log(`\n${'═'.repeat(92)}`);
console.log(`RESULTADO: ${passou} provado(s) · ${reprovou} reprovado(s) · ${naoExecutou} não executado(s)`);
console.log('═'.repeat(92));
if (reprovou > 0) process.exit(1);
if (naoExecutou > 0 && passou === 0) process.exit(2);
process.exit(0);
