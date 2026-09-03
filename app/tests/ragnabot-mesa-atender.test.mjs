#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A MESA DE ATENDIMENTO — ACEITAR · ESPIAR · ESCREVER · TRANSFERIR (contrato S-ATENDER, 03/09/2026)
//
// POR QUE ESTE ARQUIVO EXISTE
// O contrato tem quatro frases que decidem se a entrega vale:
//   1. «dois atendentes clicando ao mesmo tempo — exatamente UM leva»
//   2. «um agente tentando enviar mensagem PELA API numa conversa que não é dele recebe recusa»
//   3. «espiar não atribui, e fica em auditoria»
//   4. «transferir muda quem vê, na hora»
// Ler o código não prova nenhuma delas. O que prova é banco de verdade, router de verdade e
// pedido HTTP de verdade — que é o que este arquivo faz.
//
// ── A CORRIDA É MEDIDA DE VERDADE, NÃO SIMULADA ────────────────────────────────────────────────
// A prova 2 dispara os dois `POST /aceitar` com `Promise.all`, em DUAS conexões HTTP distintas,
// contra o MESMO Postgres. Não há `await` entre elas, não há mutex de aplicação, não há dublê. Se
// a sentença condicional (`WHERE cwAssigneeId IS NULL`) fosse trocada por um `findFirst` seguido de
// `update`, os dois passariam — e o teste reprovaria, que é o ponto.
//
// ── ONDE ELE ESCREVE (e por que é seguro) ──────────────────────────────────────────────────────
// Esquema temporário `zz_teste_mesa_<pid>_<aleatório>` no banco de `RAGNABOT_TESTE_DB_URL`,
// derrubado com `DROP SCHEMA … CASCADE` no `finally`. Nenhuma tabela existente é tocada.
//
// ⚠️ As tabelas nascem dos ARQUIVOS SQL VERSIONADOS, nunca de um `CREATE TABLE` escrito aqui — se
// a migração estiver errada, o teste não roda, que é o jeito certo de descobrir. São quatro fontes,
// porque a mesa cruza quatro assuntos:
//   caixa-atendimento/01 → RagnabotConversa · RagnabotSetor · RagnabotAgenteSetor
//   conexoes/01          → as 2 colunas que o S6 acrescentou a RagnabotConversa
//   atendimento/01       → RagnabotAtendTransferencia (o registro da transferência)
//   auditoria/01         → RagnabotAuditoria (a prova da espiada)
//
// COMO RODAR
//     RAGNABOT_TESTE_DB_URL='postgresql://usuário:senha@servidor:5432/base' \
//       node tests/ragnabot-mesa-atender.test.mjs
//
// CÓDIGOS DE SAÍDA: 0 provado · 1 REPROVOU · 2 não pôde executar · 3 erro inesperado
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERBOSE = process.env.VERBOSE === '1';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL = (...p) => path.join(AQUI, '..', 'prisma', 'sql', ...p);

let passou = 0; let reprovou = 0; let naoExecutou = 0;
const ok = (t, d = '') => { passou += 1; console.log(`  ✅ ${t}${d ? ` — ${d}` : ''}`); };
const falhou = (t, d = '') => { reprovou += 1; console.log(`  ❌ ${t}${d ? ` — ${d}` : ''}`); };
const pulou = (t, m) => { naoExecutou += 1; console.log(`  ⚠️  NÃO EXECUTOU: ${t} — ${m}`); };
const conferir = (t, cond, d = '') => (cond ? ok(t, d) : falhou(t, d));
const secao = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 82 - t.length))}`);

// ── os usuários da prova ───────────────────────────────────────────────────────────────────────
const TA = '11111111-1111-4111-8111-111111111111';
const CONTA = 9401;
const SUPORTE = 9410; const FINANCEIRO = 9420;

const admin   = { id: 'cw:1',  name: 'Admin',              role: 'admin', cwUserId: 1,  cwAccountId: CONTA, ragnabotTenantId: TA };
const ana     = { id: 'cw:11', name: 'Ana (Suporte)',      role: 'user',  cwUserId: 11, cwAccountId: CONTA, ragnabotTenantId: TA };
const bento   = { id: 'cw:12', name: 'Bento (Suporte)',    role: 'user',  cwUserId: 12, cwAccountId: CONTA, ragnabotTenantId: TA };
const clara   = { id: 'cw:13', name: 'Clara (Financeiro)', role: 'user',  cwUserId: 13, cwAccountId: CONTA, ragnabotTenantId: TA };

const CLIENTE = '+5598911112222';

/**
 * Recorta UM bloco `CREATE TABLE "<nome>" ( … );` de um arquivo de migração versionado.
 * Existe para não copiar DDL para dentro do teste: a fonte continua sendo o arquivo do repositório.
 */
function recortarTabela(arquivo, nome) {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const inicio = texto.indexOf(`CREATE TABLE "${nome}"`);
  if (inicio < 0) throw new Error(`não achei CREATE TABLE "${nome}" em ${arquivo}`);
  const fim = texto.indexOf('\n);', inicio);
  if (fim < 0) throw new Error(`bloco de "${nome}" sem fechamento em ${arquivo}`);
  return `${texto.slice(inicio, fim)}\n);`;
}

/** As linhas `ALTER TABLE "<nome>" ADD COLUMN …` de um arquivo versionado. */
function recortarAlteracoes(arquivo, nome) {
  return fs.readFileSync(arquivo, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(`ALTER TABLE "${nome}" ADD COLUMN`))
    .join('\n');
}

async function principal() {
  const urlBase = (process.env.RAGNABOT_TESTE_DB_URL || '').trim();
  if (!urlBase) {
    pulou('a prova da mesa contra banco e API de verdade', 'defina RAGNABOT_TESTE_DB_URL');
    return;
  }
  const esquema = `zz_teste_mesa_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const { Client } = await import('pg');
  const cliente = new Client({ connectionString: urlBase });
  await cliente.connect();

  let prisma = null; let servidor = null;
  try {
    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('1. A MIGRAÇÃO — as tabelas nascem dos arquivos VERSIONADOS, nunca de DDL escrita aqui');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    await cliente.query(`CREATE SCHEMA "${esquema}"`);
    await cliente.query(`SET search_path TO "${esquema}"`);
    await cliente.query(fs.readFileSync(SQL('caixa-atendimento', '01-rb_caixa_atendimento.sql'), 'utf8'));
    // ⚠️ O S6 acrescentou 2 colunas a RagnabotConversa em OUTRO arquivo. Sem elas o cliente do
    // Prisma (que conhece o schema inteiro) estoura com «a coluna não existe» — e foi exatamente
    // assim que o teste irmão de isolamento passou a quebrar.
    await cliente.query(recortarAlteracoes(SQL('conexoes', '01-rb_conexoes_provedor_api.sql'), 'RagnabotConversa'));
    await cliente.query(recortarTabela(SQL('atendimento', '01-rb_atendimento_base.sql'), 'RagnabotAtendTransferencia'));
    await cliente.query(fs.readFileSync(SQL('auditoria', '01-rb_auditoria.sql'), 'utf8'));

    const r = await cliente.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY 1', [esquema],
    );
    const tabelas = r.rows.map((x) => x.table_name);
    conferir('as 5 tabelas da mesa nascem dos arquivos versionados',
      ['RagnabotAgenteSetor', 'RagnabotAtendTransferencia', 'RagnabotAuditoria', 'RagnabotConversa', 'RagnabotSetor']
        .every((t) => tabelas.includes(t)), tabelas.join(', '));

    const u = new URL(urlBase);
    u.searchParams.set('schema', esquema);
    process.env.DATABASE_URL = u.toString();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    // ── semeadura ────────────────────────────────────────────────────────────────────────────
    const agora = new Date();
    const t = (min) => new Date(agora.getTime() - min * 60000);
    await prisma.ragnabotSetor.createMany({ data: [
      { tenantId: TA, cwAccountId: CONTA, cwTeamId: SUPORTE, nome: 'Suporte' },
      { tenantId: TA, cwAccountId: CONTA, cwTeamId: FINANCEIRO, nome: 'Financeiro' },
    ] });
    await prisma.ragnabotAgenteSetor.createMany({ data: [
      { tenantId: TA, cwAccountId: CONTA, cwUserId: 11, cwTeamId: SUPORTE, agenteNome: 'Ana' },
      { tenantId: TA, cwAccountId: CONTA, cwUserId: 12, cwTeamId: SUPORTE, agenteNome: 'Bento' },
      { tenantId: TA, cwAccountId: CONTA, cwUserId: 13, cwTeamId: FINANCEIRO, agenteNome: 'Clara' },
    ] });
    const base = { tenantId: TA, cwAccountId: CONTA, cwInboxId: 34, caixaNome: 'WhatsApp', canal: 'whatsapp' };
    await prisma.ragnabotConversa.createMany({ data: [
      // 3001 — NA FILA do Suporte. É a da corrida: Ana e Bento clicam juntos.
      { ...base, cwConversationId: 3001, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'aguardando', estadoPlataforma: 'pending', abertaEm: t(30), ultimaAtividadeEm: t(3), contatoChave: CLIENTE, contatoNome: 'Cliente Um', protocolo: 'ZZM-0000000001' },
      // 3002 — NA FILA do Suporte. É a que Ana aceita e depois transfere.
      { ...base, cwConversationId: 3002, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'aguardando', estadoPlataforma: 'pending', abertaEm: t(25), ultimaAtividadeEm: t(2), contatoChave: CLIENTE, contatoNome: 'Cliente Um', protocolo: 'ZZM-0000000002' },
      // 3003 — JÁ É DA CLARA (Financeiro). É a que Ana não pode espiar nem escrever.
      { ...base, cwConversationId: 3003, cwTeamId: FINANCEIRO, setorNome: 'Financeiro', cwAssigneeId: 13, atendenteNome: 'Clara', estado: 'atendendo', estadoPlataforma: 'open', abertaEm: t(40), ultimaAtividadeEm: t(1), contatoChave: '+5598933334444', contatoNome: 'Cliente Dois', protocolo: 'ZZM-0000000003' },
      // 3004 — histórico ANTIGO do mesmo cliente NO SUPORTE, já resolvido. Serve à prova 6.
      { ...base, cwConversationId: 3004, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'resolvida', estadoPlataforma: 'resolved', abertaEm: t(9000), resolvidaEm: t(8000), resolvidaPorCwUserId: 12, resolvidaPorNome: 'Bento', contatoChave: CLIENTE, contatoNome: 'Cliente Um', protocolo: 'ZZM-0000000004' },
      // 3006 — NA FILA do Suporte, ABERTA e sem dono. É a que Ana espia sem assumir.
      //   ⚠️ Aqui houve um erro MEU na primeira rodada: eu espiava a 3004, que é RESOLVIDA — e
      //   conversa resolvida não está na fila de ninguém (a cláusula do S2 exige estado aberto).
      //   O 404 estava certo; a semente é que estava errada.
      { ...base, cwConversationId: 3006, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'aguardando', estadoPlataforma: 'pending', abertaEm: t(20), ultimaAtividadeEm: t(4), contatoChave: '+5598955556666', contatoNome: 'Cliente Três', protocolo: 'ZZM-0000000006' },
      // 3005 — RESOLVIDA e na fila: prova que aceitar conversa encerrada é recusado.
      { ...base, cwConversationId: 3005, cwTeamId: SUPORTE, setorNome: 'Suporte', cwAssigneeId: null, estado: 'resolvida', estadoPlataforma: 'resolved', abertaEm: t(500), resolvidaEm: t(400), resolvidaPorCwUserId: 11, resolvidaPorNome: 'Ana', contatoChave: CLIENTE, contatoNome: 'Cliente Um' },
    ] });

    // ── os serviços, com o NOSSO cliente e uma plataforma DUBLÊ ───────────────────────────────
    const Caixa = await import('../src/services/ragnabot-caixa.service.js');
    const Mesa = await import('../src/services/ragnabot-mesa.service.js');
    Caixa.configurarCaixa({ db: prisma });

    // O dublê ANOTA o que foi pedido. É o que permite conferir que a atribuição valeu TAMBÉM na
    // plataforma — sem isso, provaríamos metade da regra e chamaríamos de inteira.
    const plataforma = {
      chamadas: [],
      recusar: false,
      async atribuirAgente(p) { if (this.recusar) throw new Error('plataforma fora do ar'); this.chamadas.push(['atribuirAgente', p]); return { ok: true }; },
      async transferirTime(p) { if (this.recusar) throw new Error('plataforma fora do ar'); this.chamadas.push(['transferirTime', p]); return true; },
      async enviarMensagem(p) { this.chamadas.push(['enviarMensagem', p]); return { ok: true, id: 777 }; },
      async notaInterna(p) { this.chamadas.push(['notaInterna', p]); return true; },
      async lerMensagens(p) {
        this.chamadas.push(['lerMensagens', p]);
        return { itens: [
          { id: 1, lado: 'cliente', texto: 'bom dia, preciso de ajuda', quando: t(30), anexos: [] },
          { id: 2, lado: 'robo', texto: 'olá! já chamo um atendente', quando: t(29), anexos: [] },
        ], total: 2 };
      },
      async listarAgentes() { return [{ id: 1, nome: 'Admin' }, { id: 11, nome: 'Ana (Suporte)' }, { id: 12, nome: 'Bento (Suporte)' }, { id: 13, nome: 'Clara' }]; },
    };
    Mesa.configurarMesa({ db: prisma, plataforma });

    // ── o router de VERDADE ───────────────────────────────────────────────────────────────────
    const express = (await import('express')).default;
    const router = (await import('../src/routes/ragnabot-caixa.routes.js')).default;
    const app = express();
    app.use(express.json());
    // ⚠️ A sessão viaja num CABEÇALHO, e não numa variável do teste — porque a corrida da prova 2
    // dispara os dois pedidos ao mesmo tempo, e com uma variável compartilhada os dois chegariam
    // como a MESMA pessoa. O teste "passaria" provando nada.
    const porQuem = new Map([admin, ana, bento, clara].map((u) => [String(u.cwUserId), u]));
    app.use((req, _res, prox) => { req.user = porQuem.get(String(req.headers['x-quem'] || '')) || null; prox(); });
    app.use('/api/ragnabot-caixa', router);
    await new Promise((pronto) => { servidor = app.listen(0, '127.0.0.1', pronto); });
    const raiz = `http://127.0.0.1:${servidor.address().port}/api/ragnabot-caixa`;

    const chamar = async (metodo, url, corpo, quem) => {
      const resp = await fetch(raiz + url, {
        method: metodo,
        headers: { 'content-type': 'application/json', 'x-quem': String(quem?.cwUserId ?? '') },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const texto = await resp.text();
      let dados = null; try { dados = JSON.parse(texto); } catch { dados = null; }
      return { status: resp.status, corpo: dados, cru: texto };
    };
    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('2. ⭐ A CORRIDA — Ana e Bento clicam "Aceitar" no MESMO instante');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Sem `await` entre os dois: `Promise.all` dispara as duas requisições HTTP juntas, em conexões
    // distintas, contra o mesmo Postgres. Quem arbitra é a sentença condicional, não o Node.
    const [rAna, rBento] = await Promise.all([
      chamar('POST', '/conversas/3001/aceitar', {}, ana),
      chamar('POST', '/conversas/3001/aceitar', {}, bento),
    ]);
    const vitorias = [rAna, rBento].filter((x) => x.status === 200).length;
    const derrotas = [rAna, rBento].filter((x) => x.status === 409 && x.corpo?.code === 'JA_ACEITA').length;
    conferir('⭐ EXATAMENTE UM leva — o outro recebe 409 JA_ACEITA',
      vitorias === 1 && derrotas === 1,
      `Ana=${rAna.status}(${rAna.corpo?.code || 'ok'}) · Bento=${rBento.status}(${rBento.corpo?.code || 'ok'})`);

    const perdedor = rAna.status === 409 ? rAna : rBento;
    conferir('⭐ e o perdedor recebe o NOME de quem levou, não um erro genérico',
      /já foi aceita por /iu.test(perdedor.corpo?.error || ''),
      `«${perdedor.corpo?.error}»`);

    const dona = await prisma.ragnabotConversa.findFirst({ where: { cwConversationId: 3001 } });
    conferir('no banco há UM dono só, e a conversa virou "atendendo"',
      dona.cwAssigneeId !== null && dona.estado === 'atendendo',
      `cwAssigneeId=${dona.cwAssigneeId} (${dona.atendenteNome}) estado=${dona.estado}`);
    conferir('⭐ a atribuição valeu TAMBÉM na plataforma (senão a tela dela e a nossa discordam)',
      plataforma.chamadas.some(([n, p]) => n === 'atribuirAgente' && p.cwConversationId === 3001 && p.cwAssigneeId === dona.cwAssigneeId),
      JSON.stringify(plataforma.chamadas.filter(([n]) => n === 'atribuirAgente').map(([, p]) => p)));

    // Reforço: 20 cliques simultâneos, e ainda assim um só vencedor.
    await prisma.ragnabotConversa.update({ where: { id: dona.id }, data: { cwAssigneeId: null, atendenteNome: null, estado: 'aguardando' } });
    const enxurrada = await Promise.all(Array.from({ length: 20 }, (_, i) => chamar('POST', '/conversas/3001/aceitar', {}, i % 2 ? ana : bento)));
    const ganhos = enxurrada.filter((x) => x.status === 200 && !x.corpo?.jaEraMinha).length;
    conferir('⭐ 20 cliques simultâneos: continua UM vencedor',
      ganhos === 1, `200 novos=${ganhos} · 409=${enxurrada.filter((x) => x.status === 409).length} · repetidos=${enxurrada.filter((x) => x.corpo?.jaEraMinha).length}`);

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('3. ACEITAR — o que ele libera, e o que ele recusa');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    let h = await chamar('POST', '/conversas/3002/aceitar', {}, ana);
    conferir('Ana aceita a 3002 (fila do setor dela)',
      h.status === 200 && h.corpo?.conversa?.atendente?.id === 11, `HTTP ${h.status}`);
    h = await chamar('POST', '/conversas/3002/aceitar', {}, ana);
    conferir('clicar de novo é idempotente, não erro', h.status === 200 && h.corpo?.jaEraMinha === true);

    h = await chamar('POST', '/conversas/3003/aceitar', {}, ana);
    conferir('⭐ Ana aceitando a conversa da Clara → 404 (nem confirmo que existe)',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA', `HTTP ${h.status}`);

    h = await chamar('POST', '/conversas/3005/aceitar', {}, ana);
    conferir('aceitar conversa ENCERRADA é recusado com o motivo',
      h.status === 409 && h.corpo?.code === 'CONVERSA_ENCERRADA', `HTTP ${h.status} · ${h.corpo?.error}`);

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('4. ⭐ ESCREVER PELA API — a recusa é do SERVIDOR, não da tela');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Este é O teste de aceite do contrato. Não há tela envolvida: é um POST cru.
    h = await chamar('POST', '/conversas/3003/mensagens', { texto: 'invadindo a conversa da Clara' }, ana);
    conferir('⭐ Ana escrevendo na conversa da CLARA → RECUSA (404: nem enxerga)',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA',
      `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    // O caso mais perigoso: conversa que ela VÊ (fila do setor dela) mas que NÃO é dela.
    const naFila = await prisma.ragnabotConversa.findFirst({ where: { cwConversationId: 3001 } });
    const quemTem = naFila.cwAssigneeId;
    const outro = quemTem === 11 ? bento : ana;
    h = await chamar('POST', '/conversas/3001/mensagens', { texto: 'escrevendo na conversa do colega' }, outro);
    // ⚠️ AQUI EU ESPERAVA 403 E VEIO 404 — e o 404 é que está CERTO. No instante em que o colega
    // aceitou, a conversa saiu da vista deste agente (isolamento do S2: agente não enxerga conversa
    // de agente). A recusa acontece uma camada ANTES da regra de escrita, e é a mais forte das
    // duas: não nega o direito de escrever, nega a existência. Corrigi a expectativa, não o código.
    conferir('⭐ e na conversa do COLEGA do mesmo setor → RECUSA (404: depois do aceite ele nem a enxerga)',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA',
      `HTTP ${h.status} · ${JSON.stringify(h.corpo)}`);

    // Conversa na fila, sem dono nenhum: também recusa — «mensagem sem dono» é o que o dono proibiu.
    h = await chamar('POST', '/conversas/3006/mensagens', { texto: 'sem aceitar' }, bento);
    conferir('⭐ conversa SEM DONO também recusa escrita, e a resposta oferece o Aceitar',
      h.status === 403 && h.corpo?.code === 'CONVERSA_SEM_DONO' && h.corpo?.podeAceitar === true,
      `HTTP ${h.status} · ${h.corpo?.error}`);

    // ⭐ O ADMINISTRADOR TAMBÉM PRECISA ACEITAR — decisão do contrato, e ela é medida.
    h = await chamar('POST', '/conversas/3003/mensagens', { texto: 'sou admin, escrevo onde quiser' }, admin);
    conferir('⭐ o ADMINISTRADOR vê a conversa da Clara, mas NÃO escreve nela sem assumir',
      h.status === 403 && h.corpo?.code === 'CONVERSA_DE_OUTRO_ATENDENTE',
      `HTTP ${h.status} · ${h.corpo?.error}`);

    // E o dono legítimo escreve.
    const dono = quemTem === 11 ? ana : bento;
    const antesDoEnvio = plataforma.chamadas.length;
    h = await chamar('POST', '/conversas/3001/mensagens', { texto: 'boa tarde! já vou verificar' }, dono);
    conferir('o DONO da conversa escreve, e a mensagem chega à plataforma',
      h.status === 200 && plataforma.chamadas.slice(antesDoEnvio).some(([n, p]) => n === 'enviarMensagem' && p.cwConversationId === 3001),
      `HTTP ${h.status}`);
    h = await chamar('POST', '/conversas/3001/mensagens', { texto: '  ' }, dono);
    conferir('texto vazio é recusado antes de chegar à plataforma', h.status === 400 && h.corpo?.code === 'TEXTO_VAZIO');

    h = await chamar('POST', '/conversas/3001/mensagens', { texto: 'checar com o financeiro antes', privada: true }, dono);
    conferir('NOTA INTERNA sai por nota, não por mensagem ao cliente',
      h.status === 200 && h.corpo?.privada === true
      && plataforma.chamadas.some(([n, p]) => n === 'notaInterna' && p.cwConversationId === 3001));

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('5. ⭐ ESPIAR — abre em leitura, NÃO atribui, e fica em auditoria');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    await prisma.ragnabotAuditoria.deleteMany({});
    h = await chamar('GET', '/conversas/3006/abrir', null, ana); // da fila do setor dela, sem dono
    conferir('Ana ESPIA a conversa da fila: abre, com o histórico',
      h.status === 200 && (h.corpo?.mensagens || []).length === 2, `HTTP ${h.status} · ${(h.corpo?.mensagens || []).length} mensagens`);
    conferir('⭐ e a espiada NÃO atribui — a conversa continua sem dono',
      (await prisma.ragnabotConversa.findFirst({ where: { cwConversationId: 3006 } })).cwAssigneeId === null);
    conferir('⭐ a tela recebe do SERVIDOR que ali não se escreve',
      h.corpo?.escrita?.pode === false && h.corpo?.escrita?.motivo === 'CONVERSA_SEM_DONO'
      && typeof h.corpo?.escrita?.explicacao === 'string' && h.corpo.escrita.explicacao.length > 10,
      `«${h.corpo?.escrita?.explicacao}»`);

    let reg = await prisma.ragnabotAuditoria.findMany({ where: { acao: 'atendimento_conversa_espiada' } });
    conferir('⭐ a espiada FICA EM AUDITORIA: quem, qual conversa e quando',
      reg.length === 1 && reg[0].entidadeId === '3006' && reg[0].atorNome === 'Ana (Suporte)' && reg[0].criadoEm instanceof Date,
      reg.length ? `${reg[0].atorNome} → conversa ${reg[0].entidadeId} em ${reg[0].criadoEm.toISOString()}` : 'nenhum registro');

    h = await chamar('GET', '/conversas/3003/abrir', null, ana);
    conferir('⭐ Ana espiando a conversa JÁ ATRIBUÍDA à Clara → RECUSA',
      h.status === 404 && h.corpo?.code === 'CONVERSA_NAO_ENCONTRADA', `HTTP ${h.status}`);
    conferir('e a recusa não gera registro de espiada (não houve espiada)',
      (await prisma.ragnabotAuditoria.count({ where: { acao: 'atendimento_conversa_espiada', entidadeId: '3003' } })) === 0);

    // Abrir a PRÓPRIA conversa não é espiada — e por isso não polui a auditoria.
    await prisma.ragnabotAuditoria.deleteMany({});
    h = await chamar('GET', '/conversas/3002/abrir', null, ana); // a 3002 é da Ana desde a prova 3
    conferir('abrindo a PRÓPRIA conversa, o campo de escrita é liberado',
      h.status === 200 && h.corpo?.escrita?.pode === true && h.corpo?.espiada === false);
    conferir('e abrir a própria conversa NÃO vira registro de espiada (auditoria que ninguém lê não protege ninguém)',
      (await prisma.ragnabotAuditoria.count({ where: { acao: 'atendimento_conversa_espiada' } })) === 0);

    // O administrador espia — e o registro sai igual ao de qualquer um.
    h = await chamar('GET', '/conversas/3003/abrir', null, admin);
    conferir('o ADMINISTRADOR abre qualquer conversa da empresa dele (regra do S2, não exceção nova)',
      h.status === 200 && h.corpo?.escrita?.pode === false && h.corpo?.escrita?.podeAssumir === true, `HTTP ${h.status}`);
    conferir('⭐ e a espiada DELE também fica registrada',
      (await prisma.ragnabotAuditoria.count({ where: { acao: 'atendimento_conversa_espiada', entidadeId: '3003', atorNome: 'Admin' } })) === 1);

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('6. ⭐ TRANSFERIR — muda quem vê, NA HORA; e o histórico do setor não vai junto');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Antes: a 3002 é da Ana (Suporte). Clara (Financeiro) não a enxerga.
    let vistaClara = await chamar('GET', '/conversas/3002/abrir', null, clara);
    conferir('antes da transferência, Clara NÃO enxerga a 3002', vistaClara.status === 404);

    h = await chamar('POST', '/conversas/3002/transferir', {
      paraCwUserId: 13, paraCwTeamId: FINANCEIRO,
      motivo: 'assunto de cobrança', notaInterna: 'cliente já enviou o comprovante',
    }, ana);
    conferir('Ana transfere a 3002 para Clara, no Financeiro',
      h.status === 200 && h.corpo?.conversa?.atendente?.id === 13 && h.corpo?.conversa?.setor?.id === FINANCEIRO,
      `HTTP ${h.status} · ${h.corpo?.recado}`);

    vistaClara = await chamar('GET', '/conversas/3002/abrir', null, clara);
    conferir('⭐ NA HORA: Clara passa a enxergar E a poder escrever',
      vistaClara.status === 200 && vistaClara.corpo?.escrita?.pode === true, `HTTP ${vistaClara.status}`);
    const vistaAna = await chamar('GET', '/conversas/3002/abrir', null, ana);
    conferir('⭐ e Ana deixa de enxergar na mesma hora (a visibilidade é `where`, não cache)',
      vistaAna.status === 404, `HTTP ${vistaAna.status}`);

    conferir('a transferência valeu também na plataforma (time e atendente)',
      plataforma.chamadas.some(([n, p]) => n === 'transferirTime' && p.cwConversationId === 3002 && p.cwTeamId === FINANCEIRO)
      && plataforma.chamadas.some(([n, p]) => n === 'atribuirAgente' && p.cwConversationId === 3002 && p.cwAssigneeId === 13));

    const tr = await prisma.ragnabotAtendTransferencia.findFirst({ where: { cwConversationId: 3002 } });
    conferir('⭐ REGISTRADA em RagnabotAtendTransferencia: de quem, para quem, motivo e quem mandou',
      !!tr && tr.deTipo === 'agente' && tr.deId === 11 && tr.paraTipo === 'agente' && tr.paraId === 13
      && tr.motivo === 'assunto de cobrança' && tr.atorUserId === 'cw:11' && tr.origem === 'manual',
      tr ? `${tr.deNome} → ${tr.paraNome} · «${tr.motivo}» · por ${tr.atorUserId} em ${tr.criadoEm.toISOString()}` : 'nenhum registro');
    conferir('e a NOTA INTERNA foi para dentro da conversa — é a ponte para quem recebe',
      plataforma.chamadas.some(([n, p]) => n === 'notaInterna' && p.cwConversationId === 3002 && /Transferido por Ana/u.test(p.texto)));

    // ⭐ O HISTÓRICO. A conversa foi junto; o histórico do OUTRO setor não.
    const histClara = await chamar('GET', `/historico?cwTeamId=${FINANCEIRO}&contatoChave=${encodeURIComponent(CLIENTE)}`, null, clara);
    const idsClara = (histClara.corpo?.itens || []).map((i) => i.cwConversationId).sort().join(',');
    conferir('⭐ quem RECEBEU vê a conversa transferida no histórico do setor DELE',
      histClara.status === 200 && idsClara === '3002', `veio: ${idsClara}`);
    conferir('⭐ mas NÃO herda o histórico do setor de origem (3001/3004 do Suporte ficam de fora)',
      !idsClara.includes('3001') && !idsClara.includes('3004'),
      'a ponte entre os setores é a nota interna, não o histórico alheio');
    const histSuporte = await chamar('GET', `/historico?cwTeamId=${SUPORTE}&contatoChave=${encodeURIComponent(CLIENTE)}`, null, clara);
    conferir('e Clara continua sem poder consultar o histórico do Suporte',
      histSuporte.status === 403 && histSuporte.corpo?.code === 'FORA_DO_SEU_SETOR', `HTTP ${histSuporte.status}`);

    // ── transferir para SETOR sem atendente devolve à fila ────────────────────────────────────
    h = await chamar('POST', '/conversas/3002/transferir', { paraCwTeamId: SUPORTE, motivo: 'não era cobrança' }, clara);
    conferir('⭐ transferir para SETOR (sem atendente) devolve a conversa à FILA daquele setor',
      h.status === 200 && h.corpo?.conversa?.atendente?.id === null && h.corpo?.conversa?.estado === 'aguardando'
      && h.corpo?.conversa?.setor?.id === SUPORTE,
      `atendente=${h.corpo?.conversa?.atendente?.rotulo ?? h.corpo?.conversa?.atendente?.id} estado=${h.corpo?.conversa?.estado}`);
    const naFilaDeNovo = await chamar('GET', '/conversas?aba=abertas&sub=aguardando', null, bento);
    conferir('e quem é do Suporte já a vê na aba Aguardando',
      (naFilaDeNovo.corpo?.itens || []).some((i) => i.cwConversationId === 3002),
      (naFilaDeNovo.corpo?.itens || []).map((i) => i.cwConversationId).join(','));
    const tr2 = await prisma.ragnabotAtendTransferencia.findFirst({ where: { cwConversationId: 3002, paraTipo: 'time' } });
    conferir('a devolução ao setor também é registrada (para "time", não para "agente")',
      !!tr2 && tr2.paraId === SUPORTE && tr2.deId === 13, tr2 ? `${tr2.deNome} → time ${tr2.paraNome}` : 'nenhum');

    // ── recusas da transferência ─────────────────────────────────────────────────────────────
    h = await chamar('POST', '/conversas/3003/transferir', { paraCwTeamId: SUPORTE }, ana);
    conferir('Ana transferindo conversa que não enxerga → 404', h.status === 404);
    h = await chamar('POST', '/conversas/3002/transferir', { paraCwTeamId: 99999 }, bento);
    conferir('setor inexistente é recusado com o número, não engolido',
      h.status === 422 && h.corpo?.code === 'SETOR_DESCONHECIDO', `HTTP ${h.status} · ${h.corpo?.error}`);
    h = await chamar('POST', '/conversas/3002/transferir', {}, bento);
    conferir('transferência sem destino é recusada', h.status === 400 && h.corpo?.code === 'DESTINO_OBRIGATORIO');

    // ── o administrador ASSUME conversa que já tem dono, e isso é transferência ───────────────
    h = await chamar('POST', '/conversas/3003/assumir', null, admin);
    conferir('⭐ o administrador ASSUME a conversa da Clara num clique',
      h.status === 200 && h.corpo?.conversa?.atendente?.id === 1, `HTTP ${h.status}`);
    const trAdmin = await prisma.ragnabotAtendTransferencia.findFirst({ where: { cwConversationId: 3003 } });
    conferir('⭐ e o "assumir" fica REGISTRADO como transferência — tomar trabalho de alguém deixa rastro',
      !!trAdmin && trAdmin.deId === 13 && trAdmin.paraId === 1 && /assumido pela administração/u.test(trAdmin.motivo || ''),
      trAdmin ? `${trAdmin.deNome} → ${trAdmin.paraNome} · «${trAdmin.motivo}»` : 'nenhum');
    h = await chamar('POST', '/conversas/3003/assumir', null, bento);
    conferir('e um agente comum NÃO consegue assumir conversa de outro',
      h.status === 403 && h.corpo?.code === 'SEM_PERMISSAO', `HTTP ${h.status}`);
    h = await chamar('POST', '/conversas/3003/mensagens', { texto: 'agora sim, assumi' }, admin);
    conferir('depois de assumir, o administrador escreve', h.status === 200, `HTTP ${h.status}`);

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('7. OS DESTINOS — a lista que a tela oferece já vem filtrada pelo servidor');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    const dAna = (await chamar('GET', '/destinos', null, ana)).corpo;
    conferir('Ana só escolhe SETORES de que é membro',
      (dAna.setores || []).map((s) => s.cwTeamId).join(',') === String(SUPORTE), JSON.stringify(dAna.setores));
    conferir('e ela não aparece na própria lista de atendentes (transferir para si é o Aceitar)',
      !(dAna.atendentes || []).some((a) => a.cwUserId === 11),
      (dAna.atendentes || []).map((a) => a.nome).join(' · '));
    const dAdmin = (await chamar('GET', '/destinos', null, admin)).corpo;
    conferir('o administrador escolhe qualquer setor da empresa',
      (dAdmin.setores || []).length === 2, JSON.stringify((dAdmin.setores || []).map((s) => s.nome)));

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('8. A PLATAFORMA FORA DO AR — a aceitação NÃO é desfeita, e o aviso é honesto');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    await prisma.ragnabotConversa.update({ where: { id: (await prisma.ragnabotConversa.findFirst({ where: { cwConversationId: 3004 } })).id },
      data: { estado: 'aguardando', estadoPlataforma: 'pending', cwAssigneeId: null } });
    plataforma.recusar = true;
    h = await chamar('POST', '/conversas/3004/aceitar', {}, ana);
    plataforma.recusar = false;
    conferir('⭐ com a plataforma recusando, o aceite VALE aqui e a resposta diz que ela não confirmou',
      h.status === 200 && h.corpo?.plataforma?.aplicada === false && typeof h.corpo?.plataforma?.aviso === 'string',
      `HTTP ${h.status} · ${h.corpo?.plataforma?.motivo} · «${h.corpo?.plataforma?.aviso}»`);
    conferir('a divergência fica registrada para alguém reparar',
      (await prisma.ragnabotAuditoria.count({ where: { acao: 'atendimento_divergencia_plataforma' } })) >= 1);
    conferir('e o atendente que aceitou já pode escrever (a arbitragem é nossa, não da plataforma)',
      (await chamar('POST', '/conversas/3004/mensagens', { texto: 'oi' }, ana)).status === 200);

    // ═════════════════════════════════════════════════════════════════════════════════════════
    secao('9. QUEM FALOU — a leitura da mensagem crua da plataforma (função pura)');
    // ═════════════════════════════════════════════════════════════════════════════════════════
    // O dono pediu para ver «quem falou» em cada linha. Quem decide isso é UMA função, e ela é a
    // mais fácil de errar do arquivo: a plataforma manda números (`message_type`) e um autor que
    // pode ser atendente, contato — ou não existir, que é o caso do robô.
    const { mensagemParaTela } = await import('../src/services/ragnabot-chatwoot.porta.js');
    const casos = [
      [{ id: 1, message_type: 0, content: 'oi', sender: { id: 9, name: 'Cliente', type: 'contact' } }, 'cliente'],
      [{ id: 2, message_type: 1, content: 'olá', sender: { id: 11, name: 'Ana', type: 'user' } }, 'atendente'],
      // ⭐ saída SEM autor = robô. É o que o motor manda pela API do admin.
      [{ id: 3, message_type: 1, content: 'menu' }, 'robo'],
      [{ id: 4, message_type: 1, content: 'nota', private: true, sender: { id: 11, name: 'Ana', type: 'user' } }, 'nota'],
      [{ id: 5, message_type: 2, content: 'conversa resolvida' }, 'sistema'],
      // ⚠️ o caso que a precedência errada tinha matado: saída registrada em nome do CONTATO.
      [{ id: 6, message_type: 1, content: 'eu mesmo mandei', sender: { id: 9, name: 'Cliente', type: 'contact' } }, 'cliente'],
    ];
    const erradas = casos.filter(([cru, esperado]) => mensagemParaTela(cru).lado !== esperado)
      .map(([cru, esperado]) => `#${cru.id}: esperava ${esperado}, veio ${mensagemParaTela(cru).lado}`);
    conferir('⭐ cliente · atendente · robô · nota · sistema — os 6 casos', erradas.length === 0,
      erradas.length ? erradas.join(' · ') : casos.map(([c, e]) => `#${c.id}=${e}`).join(' '));

    // O carimbo vem em epoch de SEGUNDOS. Errar isso joga a conversa inteira para 1970 — e já foi
    // defeito real neste arquivo, por isso a medição fica aqui e não na cabeça de ninguém.
    const comData = mensagemParaTela({ id: 7, message_type: 0, content: 'x', created_at: 1788000000 });
    conferir('a hora é lida como epoch em SEGUNDOS, não milissegundos (senão a conversa vai para 1970)',
      comData.quando instanceof Date && comData.quando.getUTCFullYear() > 2020,
      comData.quando?.toISOString());

    const comAnexo = mensagemParaTela({
      id: 8, message_type: 0, content: null,
      attachments: [{ file_type: 'image', data_url: 'https://plataforma.interna/rails/active_storage/blobs/abc/foto.jpg', file_size: 12345 }],
    });
    conferir('⛔ o anexo que sai para a tela NÃO carrega o endereço da plataforma',
      !JSON.stringify(comAnexo).includes('active_storage')
      && !JSON.stringify(comAnexo).includes('plataforma.interna')
      && comAnexo.anexos[0].nome === 'foto.jpg' && comAnexo.anexos[0].tipo === 'image',
      JSON.stringify(comAnexo.anexos));

  } finally {
    if (servidor) await new Promise((f) => servidor.close(f));
    if (prisma) await prisma.$disconnect().catch(() => {});
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

(async () => {
  console.log('═'.repeat(90));
  console.log('MESA DE ATENDIMENTO — aceitar · espiar · escrever · transferir (contrato S-ATENDER)');
  console.log('═'.repeat(90));
  await principal();
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
