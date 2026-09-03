#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CAIXA DE ATENDIMENTO — A PROVA DO ISOLAMENTO POR AGENTE E POR SETOR (contrato S2, 02/09/2026)
//
// POR QUE ESTE ARQUIVO EXISTE
// O contrato do dono tem uma frase que decide se a entrega vale ou não vale:
//     «um agente pedindo a conversa de outro PELA API tem de receber recusa, não a conversa».
// Ler o código não prova isso. Esconder o botão não prova isso. O que prova é um pedido HTTP de
// verdade, com a sessão de um agente, contra o router de verdade, sobre um banco de verdade —
// e a resposta sendo 404.
//
// ── COMO ESTE TESTE É DIFERENTE DE UM TESTE DE MENTIRA ─────────────────────────────────────────
// 1. Banco de VERDADE (PostgreSQL), com o MESMO cliente Prisma do serviço. Dublê em memória
//    provaria a minha imitação do `where`, não o `where` — e é exatamente no `where` que o
//    isolamento vive.
// 2. Router de VERDADE, num Express que sobe numa porta efêmera. O que é medido é o código HTTP
//    que a tela vai ler.
// 3. A migração de VERDADE: o arquivo `prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql`
//    é aplicado por este teste. Se ele estiver errado, o teste não roda — que é o jeito certo de
//    descobrir.
//
// ── ONDE ELE ESCREVE (e por que isso é seguro) ─────────────────────────────────────────────────
// O banco `ragnabot` vive DENTRO do cluster Kubernetes e não é alcançável da máquina de trabalho
// (o `.env` do NOC diz isso com todas as letras: «o NOC NÃO alcança esta base, de propósito»).
// Então este teste cria um SCHEMA temporário `zz_teste_caixa_<pid>_<aleatório>` no banco que a
// variável `RAGNABOT_TESTE_DB_URL` apontar, cria ali as 3 tabelas, faz tudo dentro dele e o
// derruba com `DROP SCHEMA … CASCADE` no `finally`. Nenhuma tabela existente é tocada: as 3 são
// novas e não têm chave estrangeira para nada.
//
// COMO RODAR
//     RAGNABOT_TESTE_DB_URL='postgresql://usuário:senha@servidor:5432/base' \
//       node tests/ragnabot-caixa-isolamento.test.mjs
//     VERBOSE=1 …    (mostra a pilha do erro)
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO — o corredor varre `tests/**/*.test.js`; este é `.mjs`,
// no mesmo padrão dos irmãos, porque é um script com `process.exit`.
//
// CÓDIGOS DE SAÍDA — o silêncio aqui seria pior que a falha
//   0 = tudo o que podia ser provado foi provado
//   1 = alguma verificação REPROVOU  ← qualquer vazamento cai aqui
//   2 = não pôde executar (sem banco de teste)
//   3 = erro inesperado
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERBOSE = process.env.VERBOSE === '1';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_SQL = path.join(AQUI, '..', 'prisma', 'sql', 'caixa-atendimento', '01-rb_caixa_atendimento.sql');
// ⚠️ O contrato S6 acrescentou DUAS colunas a `RagnabotConversa` (`origemCwInboxId`/`transferidaEm`)
// em OUTRO arquivo de migração. O cliente do Prisma conhece o schema INTEIRO e as pede em todo
// `findUnique` — então, sem elas, este teste quebrava com «a coluna não existe» e a rede de
// segurança do S2 ficava caída em silêncio. Medido em 03/09/2026 (contrato S-ATENDER).
const ARQUIVO_SQL_S6 = path.join(AQUI, '..', 'prisma', 'sql', 'conexoes', '01-rb_conexoes_provedor_api.sql');

let passou = 0; let reprovou = 0; let naoExecutou = 0;
const ok = (t, d = '') => { passou += 1; console.log(`  ✅ ${t}${d ? ` — ${d}` : ''}`); };
const falhou = (t, d = '') => { reprovou += 1; console.log(`  ❌ ${t}${d ? ` — ${d}` : ''}`); };
const pulou = (t, m) => { naoExecutou += 1; console.log(`  ⚠️  NÃO EXECUTOU: ${t} — ${m}`); };
const conferir = (t, cond, d = '') => (cond ? ok(t, d) : falhou(t, d));
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 84 - t.length))}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE 1 — AS REGRAS PURAS (não precisam de banco nenhum)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function parteUm() {
  secao('1. AS REGRAS PURAS — estado, etiquetas e a cláusula de visibilidade');
  const S = await import('../src/services/ragnabot-caixa.service.js');

  // 1.1 — o estado. A plataforma não distingue "robô atendendo" de "ninguém atendendo".
  const casos = [
    [{ statusPlataforma: 'open', cwAssigneeId: 7, comRobo: false }, 'atendendo'],
    [{ statusPlataforma: 'open', cwAssigneeId: null, comRobo: false }, 'aguardando'],
    [{ statusPlataforma: 'pending', cwAssigneeId: null, comRobo: false }, 'aguardando'],
    [{ statusPlataforma: 'open', cwAssigneeId: null, comRobo: true }, 'chatbot'],
    // Atendente ganha do robô: senão a conversa sumiria da aba do próprio agente que a responde.
    [{ statusPlataforma: 'open', cwAssigneeId: 7, comRobo: true }, 'atendendo'],
    [{ statusPlataforma: 'resolved', cwAssigneeId: 7, comRobo: false }, 'resolvida'],
    [{ statusPlataforma: 'snoozed', cwAssigneeId: 7, comRobo: false }, 'adiada'],
  ];
  let todos = true;
  for (const [entrada, esperado] of casos) {
    const r = S.classificarEstado(entrada);
    if (r !== esperado) { todos = false; falhou(`classificarEstado ${JSON.stringify(entrada)}`, `esperava ${esperado}, veio ${r}`); }
  }
  if (todos) ok('classificarEstado acerta os 7 casos', 'inclusive "atendente ganha do robô"');

  // 1.2 — as três etiquetas do cartão, SEMPRE as três.
  const et = S.etiquetasDaConversa({ cwInboxId: 34, caixaNome: 'WhatsApp', cwTeamId: null, cwAssigneeId: 11, atendenteNome: 'Ana' });
  conferir('etiquetasDaConversa devolve caixa · setor · atendente, nesta ordem',
    et.map((x) => x.tipo).join(',') === 'caixa,setor,atendente', et.map((x) => x.rotulo).join(' | '));
  conferir('etiqueta vazia continua aparecendo, com o texto do vazio',
    et[1].vazia === true && et[1].rotulo === 'Sem setor');

  // 1.3 — a cláusula. É a regra inteira em três ramos.
  const admin = { role: 'admin', cwUserId: 1, ragnabotTenantId: 'T' };
  const agente = { role: 'user', cwUserId: 11, ragnabotTenantId: 'T', id: 'cw:11' };
  conferir('administrador: cláusula vazia (vê a operação da empresa dele)',
    JSON.stringify(S.clausulaDeVisibilidade(admin, [])) === '{}');

  const cl = S.clausulaDeVisibilidade(agente, [100]);
  const ramos = cl.OR;
  conferir('agente: 3 ramos — minhas · as que eu resolvi · a fila do meu setor', ramos.length === 3,
    JSON.stringify(cl));
  conferir('ramo 1 é "atribuída a mim" (número, não "cw:11")', ramos[0].cwAssigneeId === 11);
  conferir('ramo 2 é "resolvida por mim"', ramos[1].resolvidaPorCwUserId === 11);
  conferir('ramo 3 exige as TRÊS condições: sem atendente, aberta e no meu setor',
    ramos[2].cwAssigneeId === null
    && Array.isArray(ramos[2].estado.in) && ramos[2].estado.in.length === 3
    && ramos[2].cwTeamId.in.join() === '100');

  const semSetor = S.clausulaDeVisibilidade(agente, []);
  conferir('⭐ agente SEM setor não ganha o ramo da fila (falha fechada)', semSetor.OR.length === 2,
    JSON.stringify(semSetor));

  conferir('usuário sem identidade de atendente não vê NADA (null, não {})',
    S.clausulaDeVisibilidade({ role: 'user' }, [100]) === null);

  // 1.4 — `cw:<n>`: o id da sessão é string; `cwAssigneeId` é inteiro.
  conferir('agenteDaSessao lê o número do `cwUserId`', S.agenteDaSessao({ cwUserId: 11 }) === 11);
  conferir('agenteDaSessao lê o número de `cw:11` quando não há cwUserId',
    S.agenteDaSessao({ id: 'cw:11' }) === 11);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PARTE 2 — BANCO DE VERDADE + ROUTER DE VERDADE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Os usuários da prova. `id` é a forma que `usuarioDaSessao()` monta: `cw:<sub>`. */
const TA = '11111111-1111-4111-8111-111111111111';
const TB = '22222222-2222-4222-8222-222222222222';
const CONTA_A = 9001; const CONTA_B = 9002;
const SUPORTE = 9100; const FINANCEIRO = 9200; const SETOR_B = 9300;

const adminA = { id: 'cw:1', name: 'Admin A', role: 'admin', isSuperuser: false, cwUserId: 1, cwAccountId: CONTA_A, ragnabotTenantId: TA };
const agenteA1 = { id: 'cw:11', name: 'Ana (Suporte)', role: 'user', isSuperuser: false, cwUserId: 11, cwAccountId: CONTA_A, ragnabotTenantId: TA };
const agenteA2 = { id: 'cw:12', name: 'Bruno (Financeiro)', role: 'user', isSuperuser: false, cwUserId: 12, cwAccountId: CONTA_A, ragnabotTenantId: TA };
const agenteA3 = { id: 'cw:13', name: 'Caio (sem setor)', role: 'user', isSuperuser: false, cwUserId: 13, cwAccountId: CONTA_A, ragnabotTenantId: TA };
const adminB = { id: 'cw:2', name: 'Admin B', role: 'admin', isSuperuser: false, cwUserId: 2, cwAccountId: CONTA_B, ragnabotTenantId: TB };

const CONTATO = '+5598911110000';
const OUTRO = '+5598922220000';

/** As conversas semeadas. Cada uma existe para provar UMA coisa. */
function conversas(agora) {
  const t = (min) => new Date(agora.getTime() - min * 60000);
  const base = { tenantId: TA, cwAccountId: CONTA_A, caixaNome: 'WhatsApp', canal: 'whatsapp', cwInboxId: 34 };
  return [
    // 1 — aberta, do A1. É a que o A2 vai tentar roubar pela API.
    { ...base, cwConversationId: 1001, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: 11, atendenteNome: 'Ana', estado: 'atendendo', estadoPlataforma: 'open', abertaEm: t(50), ultimaAtividadeEm: t(5), contatoChave: CONTATO, contatoNome: 'Cliente Um', protocolo: 'ZZT-0000000001' },
    // 2 — aberta, do A2. É a que o A1 vai tentar roubar pela API.
    { ...base, cwConversationId: 1002, cwTeamId: FINANCEIRO, setorNome: 'Financeiro', cwAssigneeId: 12, atendenteNome: 'Bruno', estado: 'atendendo', estadoPlataforma: 'open', abertaEm: t(40), ultimaAtividadeEm: t(4), contatoChave: CONTATO, contatoNome: 'Cliente Um', protocolo: 'ZZT-0000000002' },
    // 3 — FILA do Suporte: sem atendente. A1 vê (é do setor dele); A2 não.
    { ...base, cwConversationId: 1003, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'aguardando', estadoPlataforma: 'pending', abertaEm: t(30), ultimaAtividadeEm: t(3), contatoChave: OUTRO, contatoNome: 'Cliente Dois' },
    // 4 — FILA SEM SETOR: o caso de borda do contrato. Ninguém além do administrador.
    { ...base, cwConversationId: 1004, cwTeamId: null, cwAssigneeId: null, estado: 'aguardando', estadoPlataforma: 'pending', abertaEm: t(28), ultimaAtividadeEm: t(2), contatoChave: OUTRO, contatoNome: 'Cliente Dois' },
    // 5 — com o ROBÔ, no Financeiro. A2 vê; A1 não.
    { ...base, cwConversationId: 1005, cwTeamId: FINANCEIRO, setorNome: 'Financeiro', cwAssigneeId: null, comRobo: true, estado: 'chatbot', estadoPlataforma: 'open', abertaEm: t(20), ultimaAtividadeEm: t(1), contatoChave: OUTRO, contatoNome: 'Cliente Dois' },
    // 6 — RESOLVIDA pelo A1, e SEM atendente atual: prova o ramo "as que eu resolvi", isolado.
    { ...base, cwConversationId: 1006, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'resolvida', estadoPlataforma: 'resolved', abertaEm: t(300), resolvidaEm: t(10), resolvidaPorCwUserId: 11, resolvidaPorNome: 'Ana', contatoChave: CONTATO, contatoNome: 'Cliente Um', protocolo: 'ZZT-0000000006' },
    // 7 — RESOLVIDA pelo A2 (mais recente que a 6: prova a ORDEM).
    { ...base, cwConversationId: 1007, cwTeamId: FINANCEIRO, setorNome: 'Financeiro', cwAssigneeId: null, estado: 'resolvida', estadoPlataforma: 'resolved', abertaEm: t(280), resolvidaEm: t(6), resolvidaPorCwUserId: 12, resolvidaPorNome: 'Bruno', contatoChave: CONTATO, contatoNome: 'Cliente Um', protocolo: 'ZZT-0000000007' },
    // 8 — RESOLVIDA pelo robô (ninguém). Só o administrador.
    { ...base, cwConversationId: 1008, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'resolvida', estadoPlataforma: 'resolved', abertaEm: t(260), resolvidaEm: t(200), resolvidaPorCwUserId: null, contatoChave: OUTRO, contatoNome: 'Cliente Dois' },
    // 9 — GRUPO, aberta, na fila do Suporte. Aba própria.
    { ...base, cwConversationId: 1009, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, ehGrupo: true, estado: 'aguardando', estadoPlataforma: 'open', abertaEm: t(15), ultimaAtividadeEm: t(7), contatoChave: '1203630000@g.us', contatoNome: 'Grupo Obra' },
    // 10 — OUTRA EMPRESA. Nem o administrador da A pode vê-la.
    { tenantId: TB, cwAccountId: CONTA_B, cwConversationId: 2001, cwInboxId: 77, caixaNome: 'WhatsApp B', canal: 'whatsapp', cwTeamId: SETOR_B, setorNome: 'Setor B', cwAssigneeId: 21, atendenteNome: 'Beto', estado: 'atendendo', estadoPlataforma: 'open', abertaEm: t(60), ultimaAtividadeEm: t(8), contatoChave: CONTATO, contatoNome: 'Cliente Um', protocolo: 'ZZB-0000000001' },
  ];
}

async function parteDois() {
  const urlBase = (process.env.RAGNABOT_TESTE_DB_URL || '').trim();
  if (!urlBase) {
    pulou('a prova de isolamento contra banco e API de verdade',
      'defina RAGNABOT_TESTE_DB_URL (o banco `ragnabot` vive dentro do cluster e não é alcançável daqui)');
    return;
  }

  const esquema = `zz_teste_caixa_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const { Client } = await import('pg');
  const cliente = new Client({ connectionString: urlBase });
  await cliente.connect();

  let prisma = null; let servidor = null;
  try {
    // ── a migração de VERDADE, no esquema temporário ──────────────────────────────────────────
    secao('2. A MIGRAÇÃO — o SQL versionado é aplicado, e é ele que o teste usa');
    const sql = fs.readFileSync(ARQUIVO_SQL, 'utf8');
    await cliente.query(`CREATE SCHEMA "${esquema}"`);
    await cliente.query(`SET search_path TO "${esquema}"`);
    await cliente.query(sql);
    await cliente.query(fs.readFileSync(ARQUIVO_SQL_S6, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('ALTER TABLE "RagnabotConversa" ADD COLUMN'))
      .join('\n'));
    const r = await cliente.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY 1', [esquema],
    );
    const tabelas = r.rows.map((x) => x.table_name);
    conferir('as 3 tabelas nascem do arquivo versionado',
      tabelas.join(',') === 'RagnabotAgenteSetor,RagnabotConversa,RagnabotSetor', tabelas.join(', '));

    const u = new URL(urlBase);
    u.searchParams.set('schema', esquema);
    process.env.DATABASE_URL = u.toString();

    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    // ── semeadura ─────────────────────────────────────────────────────────────────────────────
    const agora = new Date();
    await prisma.ragnabotSetor.createMany({
      data: [
        { tenantId: TA, cwAccountId: CONTA_A, cwTeamId: SUPORTE, nome: 'Suporte' },
        { tenantId: TA, cwAccountId: CONTA_A, cwTeamId: FINANCEIRO, nome: 'Financeiro' },
        { tenantId: TB, cwAccountId: CONTA_B, cwTeamId: SETOR_B, nome: 'Setor B' },
      ],
    });
    await prisma.ragnabotAgenteSetor.createMany({
      data: [
        { tenantId: TA, cwAccountId: CONTA_A, cwUserId: 11, cwTeamId: SUPORTE, agenteNome: 'Ana' },
        { tenantId: TA, cwAccountId: CONTA_A, cwUserId: 12, cwTeamId: FINANCEIRO, agenteNome: 'Bruno' },
        // Caio (13) fica DE FORA de propósito: é o caso "agente sem setor nenhum".
        { tenantId: TB, cwAccountId: CONTA_B, cwUserId: 21, cwTeamId: SETOR_B, agenteNome: 'Beto' },
      ],
    });
    await prisma.ragnabotConversa.createMany({ data: conversas(agora) });

    // O serviço usa o cliente do módulo `base/db.js`; injetamos o NOSSO, do esquema de teste.
    const S = await import('../src/services/ragnabot-caixa.service.js');
    S.configurarCaixa({ db: prisma });

    // ── o router de VERDADE, numa porta efêmera ───────────────────────────────────────────────
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
        method: metodo,
        headers: { 'content-type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const texto = await resp.text();
      let dados = null;
      try { dados = JSON.parse(texto); } catch { dados = null; }
      return { status: resp.status, corpo: dados, cru: texto };
    };
    const ids = (c) => (c?.itens || []).map((i) => i.cwConversationId).sort((a, b) => a - b).join(',');

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('3. ⭐ A RECUSA PELA API — o teste de aceite que o contrato exige');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    let h = await chamar('GET', '/conversas/1002');
    conferir('⭐ agente A1 pedindo a conversa ABERTA do agente A2 → RECUSA',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA',
      `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    comoQuem = agenteA2;
    h = await chamar('GET', '/conversas/1001');
    conferir('⭐ e o contrário também: A2 pedindo a do A1 → RECUSA',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA',
      `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    comoQuem = agenteA1;
    h = await chamar('GET', '/conversas/1001');
    conferir('a dele, ele vê', h.status === 200 && h.corpo?.conversa?.cwConversationId === 1001,
      `HTTP ${h.status} · atendente=${h.corpo?.conversa?.atendente?.nome}`);

    comoQuem = adminA;
    const a1 = await chamar('GET', '/conversas/1001');
    const a2 = await chamar('GET', '/conversas/1002');
    conferir('o administrador da empresa vê as duas', a1.status === 200 && a2.status === 200,
      `${a1.status} e ${a2.status}`);

    h = await chamar('GET', '/conversas/2001');
    conferir('⭐ nem o administrador atravessa a fronteira da EMPRESA (conversa da empresa B)',
      h.status === 404, `HTTP ${h.status}`);

    comoQuem = agenteA1;
    h = await chamar('GET', '/conversas/1004');
    conferir('fila SEM SETOR: o agente não vê (decisão registrada: mostrar menos)', h.status === 404);
    comoQuem = adminA;
    h = await chamar('GET', '/conversas/1004');
    conferir('fila SEM SETOR: o administrador vê', h.status === 200);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('4. A LISTA — cada um vê o seu, e a fila do setor dele');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    let l = (await chamar('GET', '/conversas?aba=abertas')).corpo;
    conferir('A1 (Suporte) vê a dele (1001) e a fila do Suporte (1003) — e mais nada',
      ids(l) === '1001,1003', `veio: ${ids(l)}`);

    comoQuem = agenteA2;
    l = (await chamar('GET', '/conversas?aba=abertas')).corpo;
    conferir('A2 (Financeiro) vê a dele (1002) e o robô do Financeiro (1005)',
      ids(l) === '1002,1005', `veio: ${ids(l)}`);

    comoQuem = agenteA3;
    l = (await chamar('GET', '/conversas?aba=abertas')).corpo;
    conferir('⭐ agente SEM setor vê ZERO — falha fechada, e não a fila inteira',
      l.total === 0, `total=${l.total} · setores=${JSON.stringify(l.escopo?.setores)}`);

    comoQuem = adminA;
    l = (await chamar('GET', '/conversas?aba=abertas')).corpo;
    conferir('o administrador vê as 5 abertas da empresa dele (o grupo tem aba própria)',
      ids(l) === '1001,1002,1003,1004,1005', `veio: ${ids(l)}`);
    conferir('e a conversa da empresa B não está na lista dele', !ids(l).includes('2001'));

    comoQuem = agenteA1;
    l = (await chamar('GET', '/conversas?aba=abertas&sub=aguardando')).corpo;
    conferir('sub-aba Aguardando do A1 traz só a fila do Suporte', ids(l) === '1003', `veio: ${ids(l)}`);
    l = (await chamar('GET', '/conversas?aba=abertas&sub=chatbot')).corpo;
    conferir('sub-aba ChatBot do A1 é vazia (o robô está no Financeiro)', l.total === 0);
    l = (await chamar('GET', '/conversas?aba=grupos')).corpo;
    conferir('aba Grupos traz o grupo da fila do Suporte', ids(l) === '1009', `veio: ${ids(l)}`);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('5. RESOLVIDOS — ordem por resolução mais recente; admin vê todos, agente só os dele');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    l = (await chamar('GET', '/conversas?aba=resolvidos')).corpo;
    conferir('⭐ A1 vê SÓ o que ELE resolveu (1006)', ids(l) === '1006', `veio: ${ids(l)}`);
    comoQuem = agenteA2;
    l = (await chamar('GET', '/conversas?aba=resolvidos')).corpo;
    conferir('⭐ A2 vê SÓ o que ELE resolveu (1007)', ids(l) === '1007', `veio: ${ids(l)}`);

    comoQuem = adminA;
    l = (await chamar('GET', '/conversas?aba=resolvidos')).corpo;
    const ordem = (l.itens || []).map((i) => i.cwConversationId).join(',');
    conferir('⭐ o administrador vê os três, ORDENADOS por resolução mais recente',
      ordem === '1007,1006,1008', `ordem: ${ordem}`);
    conferir('inclusive a que o robô resolveu, e que agente nenhum enxerga (1008)',
      ordem.includes('1008'));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('6. O CONTADOR BATE COM A CONSULTA — aba por aba, para os três usuários');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    for (const [quem, nome] of [[agenteA1, 'A1'], [agenteA2, 'A2'], [adminA, 'admin'], [agenteA3, 'A3 sem setor']]) {
      comoQuem = quem;
      const n = (await chamar('GET', '/contadores')).corpo;
      const pares = [
        ['abertas', '/conversas?aba=abertas&porPagina=100'],
        ['atendendo', '/conversas?aba=abertas&sub=atendendo&porPagina=100'],
        ['aguardando', '/conversas?aba=abertas&sub=aguardando&porPagina=100'],
        ['chatbot', '/conversas?aba=abertas&sub=chatbot&porPagina=100'],
        ['resolvidos', '/conversas?aba=resolvidos&porPagina=100'],
        ['grupos', '/conversas?aba=grupos&porPagina=100'],
      ];
      const divergentes = [];
      for (const [campo, url] of pares) {
        const lista = (await chamar('GET', url)).corpo;
        if ((lista.itens || []).length !== n[campo]) divergentes.push(`${campo}: contador=${n[campo]} lista=${(lista.itens || []).length}`);
      }
      conferir(`contadores de ${nome} batem com a lista nas 6 abas`, divergentes.length === 0,
        divergentes.length ? divergentes.join(' · ') : JSON.stringify(n));
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('7. HISTÓRICO POR SETOR — o mesmo cliente, dois setores, e eles não se misturam');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    h = await chamar('GET', `/historico?cwTeamId=${SUPORTE}&contatoChave=${encodeURIComponent(CONTATO)}`);
    const hSup = (h.corpo?.itens || []).map((i) => i.cwConversationId).sort().join(',');
    conferir('⭐ A1 pede o histórico do contato no SUPORTE e recebe só o do Suporte',
      h.status === 200 && hSup === '1001,1006', `HTTP ${h.status} · ${hSup}`);
    conferir('e nenhuma conversa do Financeiro do MESMO contato entrou junto',
      !hSup.includes('1002') && !hSup.includes('1007'));

    h = await chamar('GET', `/historico?cwTeamId=${FINANCEIRO}&contatoChave=${encodeURIComponent(CONTATO)}`);
    conferir('⭐ A1 pedindo o histórico de um setor de que NÃO é membro → recusa explicada (403)',
      h.status === 403 && h.corpo?.code === 'FORA_DO_SEU_SETOR', `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    h = await chamar('GET', `/historico?contatoChave=${encodeURIComponent(CONTATO)}`);
    conferir('⭐ histórico SEM setor é recusado — não existe modo global, nem para quem for',
      h.status === 400 && h.corpo?.code === 'SETOR_OBRIGATORIO', `HTTP ${h.status}`);

    comoQuem = adminA;
    h = await chamar('GET', `/historico?cwTeamId=${FINANCEIRO}&contatoChave=${encodeURIComponent(CONTATO)}`);
    const hFin = (h.corpo?.itens || []).map((i) => i.cwConversationId).sort().join(',');
    conferir('o administrador consulta qualquer setor — e continua sendo só daquele setor',
      h.status === 200 && hFin === '1002,1007', `HTTP ${h.status} · ${hFin}`);
    h = await chamar('GET', `/historico?contatoChave=${encodeURIComponent(CONTATO)}`);
    conferir('e nem para o administrador existe histórico global', h.status === 400);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('8. O PARÂMETRO DA TELA NÃO ALARGA — só estreita');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    l = (await chamar('GET', '/conversas?aba=abertas&cwAssigneeId=12')).corpo;
    conferir('⭐ A1 pedindo `?cwAssigneeId=12` (o colega) recebe VAZIO, não a lista do colega',
      l.total === 0, `total=${l.total} · ${ids(l)}`);
    l = (await chamar('GET', `/conversas?aba=abertas&cwTeamId=${FINANCEIRO}`)).corpo;
    conferir('A1 filtrando pelo setor alheio também recebe vazio', l.total === 0, `total=${l.total}`);
    l = (await chamar('GET', `/conversas?aba=abertas&tenantId=${TB}`)).corpo;
    conferir('⭐ e `?tenantId=` da outra empresa é IGNORADO (segue vendo o dele)',
      ids(l) === '1001,1003', `veio: ${ids(l)}`);

    const s = (await chamar('GET', '/setores')).corpo;
    conferir('A1 só enxerga o setor dele na lista de setores',
      s.total === 1 && s.itens[0].cwTeamId === SUPORTE, JSON.stringify(s.itens));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('9. AS ETIQUETAS NO CARTÃO — caixa · setor · atendente');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    comoQuem = agenteA1;
    const um = (await chamar('GET', '/conversas/1001')).corpo?.conversa;
    const rot = (um?.etiquetas || []).map((e) => `${e.tipo}=${e.rotulo}`).join(' · ');
    conferir('o item da fila já traz as três etiquetas prontas',
      rot === 'caixa=WhatsApp · setor=Suporte · atendente=Ana', rot);
    const semSetorItem = (await chamar('GET', '/conversas?aba=abertas&sub=aguardando')).corpo?.itens?.[0];
    conferir('e a conversa da fila mostra "Sem atendente" em vez de esconder a etiqueta',
      semSetorItem?.etiquetas?.[2]?.rotulo === 'Sem atendente',
      (semSetorItem?.etiquetas || []).map((e) => e.rotulo).join(' · '));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('10. A PROJEÇÃO — o índice se enche pelo evento, e é idempotente');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const nova = { tenantId: TA, cwAccountId: CONTA_A, cwConversationId: 1500, cwInboxId: 34, caixaNome: 'WhatsApp', cwTeamId: SUPORTE, setorNome: 'Suporte', statusPlataforma: 'pending', contatoChave: OUTRO };
    const p1 = await S.projetarConversa(nova);
    const p2 = await S.projetarConversa(nova); // o MESMO evento, reentregue
    const quantas = await prisma.ragnabotConversa.count({ where: { cwConversationId: 1500 } });
    conferir('reentrega do mesmo evento não duplica a conversa',
      p1.ok && p2.ok && p1.novo === true && p2.novo === false && quantas === 1,
      `novo1=${p1.novo} novo2=${p2.novo} linhas=${quantas}`);

    // Uma mensagem NÃO traz o setor. Se `undefined` sobrescrevesse, a fila do setor esvaziaria.
    await S.projetarConversa({ tenantId: TA, cwAccountId: CONTA_A, cwConversationId: 1500, ultimaAtividadeEm: new Date() });
    const depois = await prisma.ragnabotConversa.findUnique({ where: { cwAccountId_cwConversationId: { cwAccountId: CONTA_A, cwConversationId: 1500 } } });
    conferir('⭐ evento de mensagem (sem setor no corpo) NÃO apaga o setor da conversa',
      depois.cwTeamId === SUPORTE, `cwTeamId=${depois.cwTeamId}`);

    // Encerramento: carimbo + autor, escritos uma vez só.
    await S.projetarConversa({ tenantId: TA, cwAccountId: CONTA_A, cwConversationId: 1500, statusPlataforma: 'resolved', resolvidaPorCwUserId: 11, resolvidaPorNome: 'Ana' });
    const r1 = await prisma.ragnabotConversa.findUnique({ where: { cwAccountId_cwConversationId: { cwAccountId: CONTA_A, cwConversationId: 1500 } } });
    await new Promise((f) => setTimeout(f, 15));
    await S.projetarConversa({ tenantId: TA, cwAccountId: CONTA_A, cwConversationId: 1500, statusPlataforma: 'resolved' });
    const r2 = await prisma.ragnabotConversa.findUnique({ where: { cwAccountId_cwConversationId: { cwAccountId: CONTA_A, cwConversationId: 1500 } } });
    conferir('o carimbo de resolução é escrito UMA vez (a lista de resolvidos não dança sozinha)',
      r1.estado === 'resolvida' && r1.resolvidaEm.getTime() === r2.resolvidaEm.getTime(),
      `${r1.resolvidaEm?.toISOString()} == ${r2.resolvidaEm?.toISOString()}`);
    conferir('e o agente que resolveu passa a ver a conversa na aba Resolvidos dele',
      (await S.listar(agenteA1, { aba: 'resolvidos' })).itens.some((i) => i.cwConversationId === 1500));

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('11. A LEITURA DO EVENTO DA PLATAFORMA (função pura do webhook)');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const { roteamentoDoEvento } = await import('../src/routes/ragnabot-webhook.routes.js');
    const rot1 = roteamentoDoEvento({
      inbox: { id: 34, name: 'WhatsApp', channel_type: 'Channel::Whatsapp' },
      conversation: { id: 77, status: 'open', meta: { assignee: { id: 11, name: 'Ana' }, team: { id: SUPORTE, name: 'Suporte' }, sender: { id: 5, name: 'Cliente', phone_number: CONTATO } } },
    });
    conferir('o evento entrega caixa, setor, atendente e contato',
      rot1.cwInboxId === 34 && rot1.canal === 'whatsapp' && rot1.cwTeamId === SUPORTE
      && rot1.cwAssigneeId === 11 && rot1.contatoChave === CONTATO && rot1.ehGrupo === false,
      JSON.stringify(rot1));
    const rot2 = roteamentoDoEvento({ conversation: { assignee_id: null, team_id: null, status: 'pending' } });
    conferir('⭐ "devolveram para a fila" (assignee_id nulo EXPLÍCITO) é preservado como nulo',
      rot2.cwAssigneeId === null && rot2.cwTeamId === null, JSON.stringify(rot2));
    const rot3 = roteamentoDoEvento({ event: 'message_created', conversation: {} });
    conferir('evento sem roteamento devolve `undefined` (não apaga o que já existe)',
      rot3.cwAssigneeId === undefined && rot3.cwTeamId === undefined);
    const rot4 = roteamentoDoEvento({ conversation: { meta: { sender: { id: 9, identifier: '1203630000@g.us' } } } });
    conferir('grupo de WhatsApp é reconhecido pelo sufixo @g.us', rot4.ehGrupo === true);
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    secao('12. A SINCRONIZAÇÃO DE SETORES — ela CONCEDE e ela RETIRA');
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // A plataforma é a fonte dos times e dos membros. Este é o caminho mais perigoso do contrato:
    // um espelho que só ACRESCENTA deixa para sempre a visão da fila de quem já saiu da equipe.
    S.configurarCaixa({
      plataforma: {
        // O Financeiro SUMIU da plataforma; entrou o Comercial.
        listarTimes: async () => ([
          { id: SUPORTE, nome: 'Suporte (renomeado)' },
          { id: 9400, nome: 'Comercial' },
        ]),
        // E Ana SAIU do Suporte; quem entrou foi Caio (13).
        membrosDoTime: async ({ cwTeamId }) => (cwTeamId === SUPORTE
          ? [{ id: 13, name: 'Caio', email: 'caio@exemplo' }]
          : []),
      },
    });

    // Antes: Ana enxerga a fila do Suporte (1003).
    const antesAna = await S.listar(agenteA1, { aba: 'abertas' });
    const rSet = await S.sincronizarSetores({ tenantId: TA, cwAccountId: CONTA_A });
    const rMem = await S.sincronizarMembrosDosSetores({ tenantId: TA, cwAccountId: CONTA_A });
    const depoisAna = await S.listar(agenteA1, { aba: 'abertas' });
    const depoisCaio = await S.listar(agenteA3, { aba: 'abertas' });

    conferir('setor que sumiu da plataforma vira INATIVO (nunca apagado: o histórico aponta o nome dele)',
      (await prisma.ragnabotSetor.findUnique({ where: { cwAccountId_cwTeamId: { cwAccountId: CONTA_A, cwTeamId: FINANCEIRO } } })).ativo === false,
      `tocados=${rSet.tocados} desativados=${rSet.desativados}`);
    conferir('o nome novo do setor chega ao espelho',
      (await prisma.ragnabotSetor.findUnique({ where: { cwAccountId_cwTeamId: { cwAccountId: CONTA_A, cwTeamId: SUPORTE } } })).nome === 'Suporte (renomeado)');
    conferir('⭐ quem SAIU do time PERDE a fila daquele setor — não fica com acesso vitalício',
      antesAna.itens.some((i) => i.cwConversationId === 1003)
      && !depoisAna.itens.some((i) => i.cwConversationId === 1003),
      `antes=${antesAna.itens.length} depois=${depoisAna.itens.length} removidos=${rMem.removidos}`);
    conferir('e continua vendo a conversa que é DELE (1001) — sair do time não é perder o próprio atendimento',
      depoisAna.itens.some((i) => i.cwConversationId === 1001));
    conferir('quem ENTROU no time passa a ver a fila dele',
      depoisCaio.itens.some((i) => i.cwConversationId === 1003), `Caio vê ${depoisCaio.itens.length}`);
    conferir('sem porta de plataforma configurada a sincronização RECUSA (503), não inventa dado',
      await (async () => {
        S.configurarCaixa({ plataforma: null });
        try { await S.sincronizarSetores({ tenantId: TA, cwAccountId: CONTA_A }); return false; }
        catch (e) { return e.code === 'PLATAFORMA_AUSENTE' && e.status === 503; }
      })());

  } finally {
    if (servidor) await new Promise((f) => servidor.close(f));
    if (prisma) await prisma.$disconnect().catch(() => {});
    // A limpeza acontece ACONTEÇA O QUE ACONTECER. Teste que suja o banco é um defeito, não um teste.
    try {
      await cliente.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      const sobrou = await cliente.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [esquema]);
      conferir('o esquema temporário foi removido do banco', sobrou.rowCount === 0, esquema);
    } catch (e) {
      falhou('não consegui remover o esquema temporário', `${esquema}: ${e.message}`);
    }
    await cliente.end().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('═'.repeat(90));
  console.log('CAIXA DE ATENDIMENTO — isolamento por agente e por setor (contrato S2)');
  console.log('═'.repeat(90));
  await parteUm();
  await parteDois();

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`passaram: ${passou}   reprovaram: ${reprovou}   não executaram: ${naoExecutou}`);
  console.log('═'.repeat(90));
  if (reprovou > 0) process.exit(1);
  if (naoExecutou > 0) process.exit(2);
  process.exit(0);
})().catch((e) => {
  console.error('\n💥 erro inesperado:', e.message);
  if (VERBOSE) console.error(e.stack);
  process.exit(3);
});
