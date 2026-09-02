#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// O CADASTRO DAS CAIXAS DE ENTRADA — contrato S-CAIXAS (02/09/2026)
//
// POR QUE ESTE ARQUIVO EXISTE — estado REAL medido em 02/09/2026, antes de ligar o webhook:
// a plataforma tinha QUATRO caixas na conta 1 (1 Site/WebWidget · 34 WhatsApp · 35 Facebook ·
// 36 Instagram) e 7 conversas reais, e `RagnabotInbox` estava VAZIA. A função de reconciliação
// existia desde 28/08, com rota e tudo, e nunca havia sido chamada por ninguém: não rodava no
// arranque e não havia tela que a acionasse.
//
// O QUE UM CADASTRO VAZIO CUSTA (medido no código, não suposto):
//   · `caixaDaConversa()` devolve `channelType: null` → o canal cai para «o mais pobre» e o fluxo
//     manda texto numerado onde caberia botão;
//   · `phoneNumberIdDaCaixa()` devolve `null` → a janela de 24 h do WhatsApp fica indeterminada;
//   · e não há de onde tirar a lista de caixas para amarrar um fluxo — sobra digitar o número na
//     mão, que é como nasceu o defeito do contrato anterior (id de CAIXA no campo da CONTA).
//
// AS CAIXAS DESTE ARQUIVO SÃO AS DE VERDADE: id, nome e tipo de canal colados da medição.
//
// COMO RODAR:  node tests/ragnabot-caixas.test.mjs
// (o vitest só varre `.test.js`; este é `.test.mjs` de propósito, como os irmãos)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  sincronizarCaixas,
  sincronizarCaixasDeTodasAsEmpresas,
  listarCaixasRegistradas,
  conferirCaixaRegistrada,
  exigirCaixaRegistrada,
  identificadorDaCaixa,
} from '../src/services/ragnabot-tenant.service.js';

// ── A EMPRESA E AS CAIXAS MEDIDAS ──────────────────────────────────────────────────────────────
const TENANT = {
  id: '8f045f04-0deb-4c5d-9716-4c5ef4298901',
  name: 'Ragnatela IoT Solutions',
  slug: 'ragnatela',
  status: 'trial',
  cwAccountId: 1,
  cwAdminUserId: 1,
};

/** O que `listarCaixas()` devolve para a conta 1 — formato e valores medidos em 02/09/2026. */
function caixasDaConta1() {
  return [
    { id: 35, nome: 'Facebook-Ragnatela', tipoCanal: 'facebook', canalRotulo: 'Facebook', numero: null, siteUrl: null, email: null, identificadorWidget: null, callbackWebhook: null, pageId: null, instagramId: null, phoneNumberId: null, wabaId: null, digitalDaCredencial: null },
    { id: 36, nome: 'Instagram-Ragnatela', tipoCanal: 'instagram', canalRotulo: 'Instagram', numero: null, siteUrl: null, email: null, identificadorWidget: null, callbackWebhook: null, pageId: null, instagramId: null, phoneNumberId: null, wabaId: null, digitalDaCredencial: null },
    // ⚠️ O `identificadorWidget` aqui é FICTÍCIO de propósito. O do site é público (vai no HTML de
    // ragnatela.com.br), mas token de qualquer natureza não entra em arquivo versionado — a Lei 1
    // da casa não tem exceção «este aqui é público».
    { id: 1, nome: 'Site - Ragnatela', tipoCanal: 'web_widget', canalRotulo: 'Site (widget)', numero: null, siteUrl: 'ragnatela.com.br', email: null, identificadorWidget: 'TOKEN-DE-WIDGET-FICTICIO', callbackWebhook: null, pageId: null, instagramId: null, phoneNumberId: null, wabaId: null, digitalDaCredencial: null },
    // A única com `provider_config` na plataforma. ⛔ `api_key` e `webhook_verify_token` NÃO chegam
    // até aqui de propósito: do provider_config só saem identificadores e a impressão digital.
    { id: 34, nome: 'WhatsApp Ragnatela', tipoCanal: 'whatsapp', canalRotulo: 'WhatsApp', numero: '+559831970997', siteUrl: null, email: null, identificadorWidget: null, callbackWebhook: 'https://bot.ragnatela.com.br/webhooks/whatsapp/+559831970997', pageId: null, instagramId: null, phoneNumberId: '801234567890123', wabaId: '901234567890123', digitalDaCredencial: 'sha256:abcdef123456' },
  ];
}

// ── BANCO DE MENTIRA, COMPORTAMENTO DE VERDADE ─────────────────────────────────────────────────
// Reproduz o que interessa do Prisma para esta rotina: `findMany` com filtro, `create` com o
// índice ÚNICO de `activeKey` (P2002 de verdade — é ele que impede duas empresas prenderem o mesmo
// número) e `update`. Sem o índice, o teste provaria uma idempotência que o banco não tem.
function bancoDeMentira({ tenants = [TENANT], inboxes = [] } = {}) {
  const linhas = inboxes.map((l) => ({ ...l }));
  const eventos = [];
  let seq = linhas.length;

  const casa = (linha, where = {}) => Object.entries(where).every(([k, v]) => {
    if (k === 'status' && v && typeof v === 'object' && Array.isArray(v.notIn)) return !v.notIn.includes(linha[k]);
    if (v && typeof v === 'object' && 'not' in v) return linha[k] !== v.not;
    return linha[k] === v;
  });

  const chaveOcupadaPorOutro = (chave, id) => chave != null
    && linhas.some((l) => l.activeKey === chave && l.id !== id);
  const p2002 = () => Object.assign(new Error('Unique constraint failed on the fields: (`activeKey`)'), { code: 'P2002' });

  return {
    _linhas: linhas,
    _eventos: eventos,
    ragnabotTenant: {
      findUnique: async ({ where }) => tenants.find((t) => t.id === where.id) || null,
      findMany: async ({ where = {} } = {}) => tenants.filter((t) => casa(t, where)),
    },
    ragnabotTenantEvent: {
      create: async ({ data }) => { eventos.push(data); return data; },
    },
    ragnabotInbox: {
      findMany: async ({ where = {} } = {}) => linhas.filter((l) => casa(l, where)).map((l) => ({ ...l })),
      create: async ({ data }) => {
        if (chaveOcupadaPorOutro(data.activeKey, null)) throw p2002();
        const nova = {
          id: `linha-${++seq}`, removedAt: null, credentialFingerprint: null, metadata: null,
          createdAt: new Date(), updatedAt: new Date(), ...data,
        };
        linhas.push(nova);
        return { ...nova };
      },
      update: async ({ where, data }) => {
        const alvo = linhas.find((l) => l.id === where.id);
        if (!alvo) throw new Error('linha não encontrada');
        if ('activeKey' in data && chaveOcupadaPorOutro(data.activeKey, alvo.id)) throw p2002();
        Object.assign(alvo, data, { updatedAt: new Date() });
        return { ...alvo };
      },
    },
  };
}

const opcoes = (db, caixas = caixasDaConta1) => ({ db, caixasDaPlataforma: async () => caixas() });

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════

teste('AS 4 CAIXAS MEDIDAS entram no cadastro vazio, com id, nome, canal e empresa', async () => {
  const db = bancoDeMentira();
  const r = await sincronizarCaixas(TENANT.id, opcoes(db));

  assert.equal(r.caixasNaPlataforma, 4);
  assert.equal(r.novasNoCadastro, 4);
  assert.deepEqual(r.naoRegistradas, [], 'nenhuma pode ficar de fora em silêncio');

  const registro = await listarCaixasRegistradas(TENANT.id, { db });
  assert.equal(registro.length, 4);
  const porId = new Map(registro.map((c) => [c.cwInboxId, c]));
  assert.equal(porId.get(1).tipoCanal, 'web_widget');
  assert.equal(porId.get(34).tipoCanal, 'whatsapp');
  assert.equal(porId.get(35).tipoCanal, 'facebook');
  assert.equal(porId.get(36).tipoCanal, 'instagram');
  assert.ok(registro.every((c) => c.ativa && c.tenantId === TENANT.id));

  // O que o motor precisa da caixa 34 e que hoje ele não tem: a janela de 24 h depende disto.
  assert.equal(porId.get(34).phoneNumberId, '801234567890123');
  assert.equal(porId.get(34).wabaId, '901234567890123');
  // ⛔ E o que NÃO pode estar aqui: a credencial. Só a impressão digital.
  const cru = JSON.stringify(db._linhas);
  assert.ok(!cru.includes('api_key'), 'nenhuma credencial de canal pode ir para o cadastro');
  assert.match(porId.get(34).credencial, /^sha256:/);

  return { registradas: registro.length, canais: registro.map((c) => `${c.cwInboxId}:${c.tipoCanal}`).join(' ') };
});

teste('IDEMPOTENTE: a segunda passada não cria, não altera e não duplica', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));
  const segunda = await sincronizarCaixas(TENANT.id, opcoes(db));

  assert.equal(segunda.novasNoCadastro, 0);
  assert.equal(segunda.atualizadas, 0);
  assert.equal(segunda.reativadas, 0);
  assert.equal(segunda.adotadas, 0);
  assert.equal(segunda.marcadasComoRemovidas, 0);
  assert.equal(db._linhas.length, 4, 'rodar duas vezes NÃO pode virar oito linhas');
  const { caixas, ...contadores } = segunda;
  return contadores;
});

teste('CAIXA QUE SUMIU vira INATIVA — a linha NUNCA é apagada (histórico e fluxos apontam para ela)', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));

  const semFacebook = () => caixasDaConta1().filter((c) => c.id !== 35);
  const r = await sincronizarCaixas(TENANT.id, opcoes(db, semFacebook));

  assert.equal(r.marcadasComoRemovidas, 1);
  assert.equal(db._linhas.length, 4, 'a linha continua no banco — marcada, não apagada');
  const fb = db._linhas.find((l) => l.cwInboxId === 35);
  assert.ok(fb.removedAt instanceof Date);
  assert.equal(fb.activeKey, null, 'a chave ativa é solta: o mesmo endereço pode ser reconectado');

  const ativas = await listarCaixasRegistradas(TENANT.id, { db, incluirRemovidas: false });
  assert.equal(ativas.length, 3);
  return { marcadas: r.marcadasComoRemovidas, linhasNoBanco: db._linhas.length };
});

teste('CAIXA NOVA na plataforma entra na passada seguinte', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));

  const comSegundoWhats = () => [...caixasDaConta1(), {
    id: 40, nome: 'WhatsApp Suporte', tipoCanal: 'whatsapp', canalRotulo: 'WhatsApp',
    numero: '+559830000000', siteUrl: null, email: null, identificadorWidget: null,
    callbackWebhook: null, pageId: null, instagramId: null, phoneNumberId: '80999', wabaId: null,
    digitalDaCredencial: null,
  }];
  const r = await sincronizarCaixas(TENANT.id, opcoes(db, comSegundoWhats));

  assert.equal(r.novasNoCadastro, 1);
  assert.equal(r.marcadasComoRemovidas, 0);
  const registro = await listarCaixasRegistradas(TENANT.id, { db });
  assert.equal(registro.length, 5);
  assert.equal(registro.find((c) => c.cwInboxId === 40).identificador, '+559830000000');
  return { novas: r.novasNoCadastro };
});

teste('CAIXA QUE VOLTOU reativa a MESMA linha — e não cria uma segunda para o mesmo id', async () => {
  // Este é o defeito que a versão anterior tinha: ela só olhava linhas com `removedAt: null`, então
  // a caixa que voltasse ganharia uma SEGUNDA linha para o mesmo `cwInboxId` — e a partir daí
  // `findFirst` devolveria ora uma, ora outra. Duplicata silenciosa é pior que ausência.
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));
  const semFacebook = () => caixasDaConta1().filter((c) => c.id !== 35);
  await sincronizarCaixas(TENANT.id, opcoes(db, semFacebook));

  const r = await sincronizarCaixas(TENANT.id, opcoes(db)); // o Facebook voltou
  assert.equal(r.reativadas, 1);
  assert.equal(r.novasNoCadastro, 0, 'reativar é o oposto de criar outra');
  assert.equal(db._linhas.filter((l) => l.cwInboxId === 35).length, 1, 'UMA linha para a caixa 35');
  const fb = db._linhas.find((l) => l.cwInboxId === 35);
  assert.equal(fb.removedAt, null);
  assert.equal(fb.activeKey, 'facebook:35');
  return { reativadas: r.reativadas, linhasDaCaixa35: 1 };
});

teste('CAIXA QUE MUDOU DE NOME é atualizada na linha existente', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));
  const renomeada = () => caixasDaConta1().map((c) => (c.id === 34 ? { ...c, nome: 'WhatsApp Comercial' } : c));
  const r = await sincronizarCaixas(TENANT.id, opcoes(db, renomeada));

  assert.equal(r.atualizadas, 1);
  assert.equal(r.novasNoCadastro, 0);
  assert.equal(db._linhas.length, 4);
  assert.equal(db._linhas.find((l) => l.cwInboxId === 34).name, 'WhatsApp Comercial');
  return { atualizadas: r.atualizadas };
});

teste('RESERVA ÓRFÃ (criação interrompida) é ADOTADA — a chave presa se solta sozinha', async () => {
  // `criarCaixa` grava a linha ANTES de criar na plataforma (é o que impede duas empresas
  // prenderem o mesmo número). Se o processo morre entre as duas coisas, sobra uma linha ativa,
  // com a chave presa e SEM id. Sem adoção, a sincronização tentaria criar outra com a mesma
  // chave e levaria P2002 para sempre — a caixa nunca entraria no cadastro.
  const db = bancoDeMentira({
    inboxes: [{
      id: 'orfa-1', tenantId: TENANT.id, cwInboxId: null, name: 'WhatsApp Ragnatela',
      channelType: 'whatsapp', identifier: '+559831970997', activeKey: 'whatsapp:+559831970997',
      removedAt: null, metadata: { phoneNumberId: '801234567890123' }, credentialFingerprint: null,
      createdAt: new Date(), updatedAt: new Date(),
    }],
  });
  const r = await sincronizarCaixas(TENANT.id, opcoes(db));

  assert.equal(r.adotadas, 1);
  assert.equal(r.novasNoCadastro, 3, 'as outras três entram normalmente');
  assert.deepEqual(r.naoRegistradas, [], 'nada pode ficar preso por uma reserva órfã da própria empresa');
  assert.equal(db._linhas.filter((l) => l.identifier === '+559831970997').length, 1);
  assert.equal(db._linhas.find((l) => l.id === 'orfa-1').cwInboxId, 34);
  return { adotadas: r.adotadas };
});

teste('CHAVE PRESA POR OUTRA EMPRESA não vira linha silenciosa — entra em `naoRegistradas` com o motivo', async () => {
  const db = bancoDeMentira({
    inboxes: [{
      id: 'da-outra', tenantId: 'outra-empresa', cwInboxId: 99, name: 'WhatsApp de outra empresa',
      channelType: 'whatsapp', identifier: '+559831970997', activeKey: 'whatsapp:+559831970997',
      removedAt: null, metadata: null, credentialFingerprint: null, createdAt: new Date(), updatedAt: new Date(),
    }],
  });
  const r = await sincronizarCaixas(TENANT.id, opcoes(db));

  assert.equal(r.novasNoCadastro, 3, 'as outras três entram — uma falha não derruba a passada');
  assert.equal(r.naoRegistradas.length, 1);
  assert.match(r.naoRegistradas[0], /caixa 34/);
  assert.match(r.naoRegistradas[0], /OUTRA empresa/, 'o motivo tem de dizer o que houve, não «erro»');
  return { naoRegistradas: r.naoRegistradas[0] };
});

teste('A GUARDA DO FLUXO: caixa que não existe no cadastro é RECUSADA, com a lista das que existem', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));

  // 34 é a caixa certa do WhatsApp; 35 é o Facebook; 99 não existe.
  const ok = await conferirCaixaRegistrada(TENANT.id, 34, { db });
  assert.equal(ok.situacao, 'confere');

  const ruim = await conferirCaixaRegistrada(TENANT.id, 99, { db });
  assert.equal(ruim.situacao, 'inexistente');
  assert.match(ruim.mensagem, /34 = WhatsApp Ragnatela/, 'a recusa ENSINA: mostra as caixas que existem');
  assert.match(ruim.mensagem, /o robô não responde/, 'e diz qual seria o sintoma se passasse');

  await assert.rejects(() => exigirCaixaRegistrada(TENANT.id, 99, { db }), /Não existe caixa de entrada 99/);
  await exigirCaixaRegistrada(TENANT.id, 34, { db }); // não lança
  return { recusa: ruim.mensagem.slice(0, 60) };
});

teste('A GUARDA recusa também caixa REMOVIDA — fluxo amarrado nela nunca dispararia', async () => {
  const db = bancoDeMentira();
  await sincronizarCaixas(TENANT.id, opcoes(db));
  await sincronizarCaixas(TENANT.id, opcoes(db, () => caixasDaConta1().filter((c) => c.id !== 35)));

  const r = await conferirCaixaRegistrada(TENANT.id, 35, { db });
  assert.equal(r.situacao, 'removida');
  assert.match(r.mensagem, /não existe mais na plataforma/);
  await assert.rejects(() => exigirCaixaRegistrada(TENANT.id, 35, { db }));
  return { situacao: r.situacao };
});

teste('CADASTRO VAZIO NÃO BLOQUEIA — guarda que trava por dúvida vira guarda contornada', async () => {
  // Cadastro vazio significa «a sincronização ainda não rodou» (é literalmente o estado de
  // 02/09/2026), e não «este número é falso». Recusar aqui trancaria o produto para fora enquanto
  // a plataforma estivesse fora do ar ou o token do Platform App faltasse — que é o caso HOJE.
  const db = bancoDeMentira();
  const r = await conferirCaixaRegistrada(TENANT.id, 34, { db });
  assert.equal(r.situacao, 'sem_registro');
  assert.match(r.mensagem, /Sincronizar agora/);
  await exigirCaixaRegistrada(TENANT.id, 34, { db }); // NÃO lança
  return { situacao: r.situacao };
});

teste('EMPRESA SEM CONTA na plataforma recusa com mensagem, em vez de sincronizar o nada', async () => {
  const db = bancoDeMentira({ tenants: [{ ...TENANT, cwAccountId: null }] });
  await assert.rejects(
    () => sincronizarCaixas(TENANT.id, opcoes(db)),
    /excluída definitivamente|não tem conta na plataforma/,
  );
  return 'recusado';
});

teste('A PASSADA GERAL soma as empresas e NÃO deixa uma falha derrubar as outras', async () => {
  const db = bancoDeMentira({
    tenants: [
      TENANT,
      { ...TENANT, id: 'empresa-b', name: 'Empresa B', cwAccountId: 2 },
      { ...TENANT, id: 'empresa-encerrada', name: 'Encerrada', status: 'closed', cwAccountId: 3 },
    ],
  });
  const r = await sincronizarCaixasDeTodasAsEmpresas({
    db,
    // A empresa B derruba a leitura na plataforma; a A tem de seguir normalmente.
    caixasDaPlataforma: async (tenantId) => {
      if (tenantId === 'empresa-b') throw new Error('A plataforma respondeu 502');
      return caixasDaConta1();
    },
  });

  assert.equal(r.empresas, 2, 'empresa encerrada nem entra na conta');
  assert.equal(r.empresasComErro, 1);
  assert.equal(r.novasNoCadastro, 4, 'a empresa boa foi sincronizada mesmo com a outra em erro');
  assert.match(r.erros[0].erro, /502/);
  return { empresas: r.empresas, comErro: r.empresasComErro, novas: r.novasNoCadastro };
});

teste('IDENTIFICADOR: cada canal usa o que o identifica, e o id da caixa é o último recurso', async () => {
  assert.equal(identificadorDaCaixa({ id: 34, numero: '+559831970997' }), '+559831970997');
  assert.equal(identificadorDaCaixa({ id: 1, siteUrl: 'ragnatela.com.br' }), 'ragnatela.com.br');
  assert.equal(identificadorDaCaixa({ id: 35, pageId: '1122334455' }), '1122334455');
  assert.equal(identificadorDaCaixa({ id: 36, instagramId: '99887766' }), '99887766');
  assert.equal(identificadorDaCaixa({ id: 42 }), '42', 'feio, mas `identifier` é obrigatório no schema');
  return 'ok';
});

teste('AMARRAÇÃO da guarda nas rotas de fluxo (prova FRACA, e declarada como tal)', async () => {
  // ⚠️ O QUE ESTE TESTE PROVA E O QUE NÃO PROVA. Ele prova que os dois caminhos que ESCREVEM
  // `cwInboxId` (criar e editar fluxo) chamam a guarda. NÃO prova o comportamento HTTP — para isso
  // seria preciso subir o router com um Prisma de mentira, e `ragnabot-fluxo.routes.js` importa o
  // cliente real estaticamente. O comportamento da DECISÃO está provado acima, na guarda; aqui só
  // se verifica que ninguém a desligou sem querer. Prova fraca declarada vale mais que prova forte
  // imaginada.
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../src/routes/ragnabot-fluxo.routes.js', import.meta.url), 'utf8');
  const chamadas = fonte.match(/problemaNaCaixaDoFluxo\(/gu) || [];
  assert.ok(chamadas.length >= 3, `esperava a definição + as duas chamadas (criar e editar); achei ${chamadas.length}`);
  assert.match(fonte, /exigirCaixaRegistrada/, 'a guarda tem de ser a MESMA do serviço, não uma cópia local');
  assert.match(fonte, /CAIXA_NAO_REGISTRADA/, 'a recusa tem código próprio, para a tela saber tratar');
  return { chamadas: chamadas.length };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA AO VIVO — opcional, e por isso separada
//
// Tudo acima roda com a plataforma de mentira, que é o certo para uma bateria que tem de rodar em
// qualquer lugar e sempre igual. Mas «a plataforma devolve isto» é uma AFIRMAÇÃO minha até alguém
// perguntar a ela. Este bloco pergunta — LENDO, nunca escrevendo — e confere que o formato de hoje
// ainda é o que a sincronização espera.
//
// Não roda sozinho, de propósito: exige a chave do Platform App no ambiente. Sem ela, PULA e diz
// que pulou; teste que finge ter medido é pior que teste ausente.
//
//   RAGNABOT_CAIXAS_AO_VIVO=1 node tests/ragnabot-caixas.test.mjs
//
// ⚠️ O banco continua sendo o de mentira: esta estação não é autorizada pelo `pg_hba` do cluster do
// Ragnabot. O que se mede aqui é a leitura da PLATAFORMA e o que a sincronização faz com ela.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
if (process.env.RAGNABOT_CAIXAS_AO_VIVO === '1') {
  teste('AO VIVO: a plataforma de verdade → o cadastro, e a segunda passada não mexe em nada', async () => {
    const { listarCaixas } = await import('../src/services/ragnabot-tenant.service.js');
    const db = bancoDeMentira();
    const daPlataforma = async (tenantId) => listarCaixas(tenantId, { db });

    const primeira = await sincronizarCaixas(TENANT.id, { db, caixasDaPlataforma: daPlataforma });
    assert.ok(primeira.caixasNaPlataforma > 0, 'a plataforma não devolveu caixa nenhuma');
    assert.equal(primeira.novasNoCadastro, primeira.caixasNaPlataforma, 'toda caixa viva tem de entrar');
    assert.deepEqual(primeira.naoRegistradas, []);

    const segunda = await sincronizarCaixas(TENANT.id, { db, caixasDaPlataforma: daPlataforma });
    assert.equal(segunda.novasNoCadastro, 0);
    assert.equal(segunda.atualizadas, 0);
    assert.equal(segunda.marcadasComoRemovidas, 0);

    const registro = await listarCaixasRegistradas(TENANT.id, { db });
    // ⛔ Nada de credencial no que ficou gravado — a caixa de WhatsApp da conta 1 tem `api_key` e
    // `webhook_verify_token` no `provider_config`, e nenhum dos dois pode chegar até aqui.
    const cru = JSON.stringify(db._linhas);
    for (const proibido of ['api_key', 'webhook_verify_token', 'access_token']) {
      assert.ok(!cru.includes(proibido), `credencial vazou para o cadastro: ${proibido}`);
    }
    return registro.map((c) => `${c.cwInboxId}=${c.nome} [${c.tipoCanal}] ${c.ativa ? 'ativa' : 'inativa'}`).join(' · ');
  });
} else {
  console.log('\n  ⏭  prova AO VIVO pulada (rode com RAGNABOT_CAIXAS_AO_VIVO=1 e a chave do Platform App no ambiente)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nCADASTRO DAS CAIXAS DE ENTRADA — sincronização, guarda e listagem\n');
let passou = 0; let falhou = 0;
for (const [nome, fn] of testes) {
  try {
    const detalhe = await fn();
    passou++;
    console.log(`  ✅ ${nome}`);
    if (detalhe !== undefined) console.log(`       ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)}`);
  } catch (e) {
    falhou++;
    console.log(`  ❌ ${nome}\n       ${e.message}`);
  }
}
console.log(`\n${passou} passou · ${falhou} falhou\n`);
process.exit(falhou ? 1 : 0);
