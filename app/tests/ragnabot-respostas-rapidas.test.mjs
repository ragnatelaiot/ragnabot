#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RESPOSTAS RÁPIDAS — PROVA EXECUTÁVEL (C9)
//
// POR QUE ESTE ARQUIVO EXISTE
// "Respostas rápidas" é a funcionalidade mais barata da fila e a de maior uso diário — o que
// significa que um defeito aqui aparece cem vezes por dia, em todas as empresas ao mesmo tempo.
// Três coisas precisam ser VERDADE, e nenhuma delas se prova lendo o código:
//   1. o banco recusa atalho repetido (não um `if` que alguém esquece de escrever na próxima rota);
//   2. a empresa A NÃO enxerga a resposta da empresa B — em nenhuma das seis operações;
//   3. as variáveis do texto viram valor de verdade, inclusive pelos nomes antigos da origem.
//
// COMO ESTE TESTE É DIFERENTE DE UM TESTE DE MENTIRA
// Ele fala com o PostgreSQL de produção usando o MESMO cliente Prisma do serviço. Dublê em memória
// nunca provaria o item 1: o índice único sobre coluna anulável PARECE certo e não funciona (NULO
// ≠ NULO no Postgres) — e é exatamente por isso que existe a coluna calculada `chaveAtalho`.
//
// LIMPEZA — o que este teste cria, ele apaga
//   Tudo é prefixado por `zzteste-rr-<pid>-<aleatório>` e removido no `finally`, aconteça o que
//   acontecer. A última verificação PROVA a limpeza contando o que sobrou com o prefixo. Teste que
//   suja o banco de produção é um defeito, não um teste.
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO — o corredor varre `tests/**/*.test.js`; este é um script
// com `process.exit`, no mesmo padrão de `ragnabot-atendimento.test.mjs`.
//
// COMO RODAR
//     node tests/ragnabot-respostas-rapidas.test.mjs
//     VERBOSE=1 node tests/ragnabot-respostas-rapidas.test.mjs     (mostra a pilha do erro)
//
// CÓDIGOS DE SAÍDA — o silêncio aqui seria pior que a falha
//   0 = tudo o que podia ser provado foi provado
//   1 = alguma verificação REPROVOU
//   2 = alguma verificação NÃO PÔDE EXECUTAR (banco fora, ou migração ainda não aplicada)
//   3 = erro inesperado
//
// NOC — 29/08/2026.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';
import crypto from 'node:crypto';

const VERBOSE = process.env.VERBOSE === '1';
const MARCA = `zzteste-rr-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

let passou = 0;
let reprovou = 0;
let naoExecutou = 0;

function ok(titulo, detalhe = '') {
  passou += 1;
  console.log(`  ✅ ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
}
function falhou(titulo, detalhe = '') {
  reprovou += 1;
  console.log(`  ❌ ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
}
function pulou(titulo, motivo) {
  naoExecutou += 1;
  console.log(`  ⚠️  NÃO EXECUTOU: ${titulo} — ${motivo}`);
}
function conferir(titulo, condicao, detalhe = '') {
  if (condicao) ok(titulo, detalhe); else falhou(titulo, detalhe);
}
function secao(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 84 - t.length))}`); }

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Carga do serviço. Ausente = NÃO EXECUTOU (código 2), nunca "passou".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
let S; let prisma;
try {
  S = await import('../src/services/ragnabot-respostas-rapidas.service.js');
  prisma = (await import('../src/base/db.js')).default;
} catch (e) {
  console.log(`⚠️  Não consegui carregar o serviço: ${e.message}`);
  process.exit(2);
}

// Usuários de mentira, no formato que `escopoDe()` lê (ele deriva a empresa de
// `user.ragnabotTenantId || user.clientCompanyId`). Nada de token, nada de Express: o que está sob
// teste é a REGRA, e ela mora no serviço.
const u = (tenantId, extra = {}) => ({
  id: extra.id ?? crypto.randomUUID(),
  name: extra.name ?? 'Atendente',
  role: extra.role ?? 'user',
  ragnabotTenantId: tenantId,
  ...extra,
});

async function criarEmpresa(sufixo) {
  return prisma.ragnabotTenant.create({
    data: {
      name: `${MARCA}-${sufixo}`,
      slug: `${MARCA}-${sufixo}`,
      contactName: 'Teste',
      contactEmail: `${MARCA}-${sufixo}@exemplo.invalido`,
      limits: {},
      status: 'trial',
    },
  });
}

let empresaA = null;
let empresaB = null;

try {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('0. AMBIENTE');
  if (!S.modeloPronto()) {
    console.log('  ⚠️  O cliente Prisma deste processo não conhece `RagnabotRespostaRapida`.');
    console.log('      Aplique prisma/sql/respostas-rapidas/01-rb_respostas_rapidas.sql e rode `npx prisma generate`.');
    process.exit(2);
  }
  await prisma.$queryRaw`SELECT 1`;
  ok('banco alcançável e modelo presente no cliente Prisma');

  empresaA = await criarEmpresa('a');
  empresaB = await criarEmpresa('b');
  ok('duas empresas de teste criadas', `${empresaA.id.slice(0, 8)}… e ${empresaB.id.slice(0, 8)}…`);

  const adminA = u(empresaA.id, { role: 'admin', name: 'Admin A' });
  const agente1A = u(empresaA.id, { name: 'Agente 1' });
  const agente2A = u(empresaA.id, { name: 'Agente 2' });
  const adminB = u(empresaB.id, { role: 'admin', name: 'Admin B' });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('1. ATALHO — normalização (o "erro comum" nº 1 do manual)');
  const casos = [
    ['/bomdia', 'bomdia'],
    ['BomDia', 'bomdia'],
    ['  /Bom Dia  ', 'bom_dia'],
    ['horário', 'horario'],
    ['///boleto', 'boleto'],
    ['2via', '2via'],
  ];
  for (const [entrada, esperado] of casos) {
    const obtido = S.normalizarAtalho(entrada);
    conferir(`normalizarAtalho(${JSON.stringify(entrada)})`, obtido === esperado, `→ "${obtido}" (esperado "${esperado}")`);
  }
  for (const ruim of ['', '   ', '///', '_só']) {
    let lancou = false;
    try { S.normalizarAtalho(ruim); } catch { lancou = true; }
    conferir(`atalho inválido recusado: ${JSON.stringify(ruim)}`, lancou);
  }
  conferir(
    'chaveDeAtalho materializa escopo + dono',
    S.chaveDeAtalho({ atalho: '/BomDia' }) === 'bomdia|geral|empresa'
      && S.chaveDeAtalho({ atalho: 'bomdia', cwInboxId: 42 }) === 'bomdia|caixa:42|empresa'
      && S.chaveDeAtalho({ atalho: 'bomdia', visibilidade: 'pessoal', userId: 'u1' }) === 'bomdia|geral|u:u1',
    `${S.chaveDeAtalho({ atalho: '/BomDia' })} · ${S.chaveDeAtalho({ atalho: 'bomdia', cwInboxId: 42 })}`,
  );

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('2. CRIAR / LISTAR');
  const r1 = await S.criar(adminA, {
    atalho: '/BomDia',
    titulo: 'Saudação da manhã',
    mensagem: '{{greeting}}, {{contactFirstName}}! Aqui é {{user}}. Seu protocolo é {{protocolo}} (atendimento {{ticket_id}}).',
  });
  conferir('criou a resposta da empresa', r1.atalho === 'bomdia' && r1.visibilidade === 'empresa', `id ${r1.id.slice(0, 8)}… · ${r1.atalhoExibido}`);
  conferir('a chave calculada foi gravada', r1.chaveAtalho === 'bomdia|geral|empresa', r1.chaveAtalho);
  conferir('as variáveis do texto foram detectadas', r1.variaveis.length === 5, r1.variaveis.join(', '));

  const r2 = await S.criar(adminA, { atalho: 'boleto', titulo: 'Segunda via do boleto', mensagem: 'Envio já a segunda via, {{contactName}}.' });
  ok('segunda resposta criada', r2.atalhoExibido);

  const lista = await S.listar(adminA, {});
  conferir('listar devolve as duas', lista.total === 2, `total=${lista.total}`);

  const busca = await S.listar(adminA, { busca: 'Boleto' });
  conferir('busca por título é insensível a maiúscula', busca.total === 1 && busca.itens[0].atalho === 'boleto', `total=${busca.total}`);
  const busca2 = await S.listar(adminA, { busca: '/bom' });
  conferir('busca por atalho aceita a barra digitada', busca2.total === 1 && busca2.itens[0].atalho === 'bomdia', `total=${busca2.total}`);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('3. ATALHO DUPLICADO — quem recusa é o BANCO');
  let erroServico = null;
  try {
    await S.criar(adminA, { atalho: 'bomdia', titulo: 'Outra saudação', mensagem: 'texto' });
  } catch (e) { erroServico = e; }
  conferir(
    'o serviço recusa o atalho repetido, com frase legível e 409',
    erroServico && erroServico.code === 'ATALHO_DUPLICADO' && erroServico.status === 409,
    erroServico ? `"${erroServico.message}"` : 'NÃO recusou',
  );

  // A prova de que a recusa é do BANCO, não de um `if` do serviço: gravação DIRETA pelo Prisma,
  // pulando o serviço inteiro. Se isto passar, o índice único não está lá — e um dia, numa rota
  // nova que esqueça a conferência, nascem dois /bomdia.
  let codigoPrisma = null;
  try {
    await prisma.ragnabotRespostaRapida.create({
      data: {
        tenantId: empresaA.id, atalho: 'bomdia', titulo: 'furo', mensagem: 'x',
        chaveAtalho: 'bomdia|geral|empresa', visibilidade: 'empresa',
      },
    });
  } catch (e) { codigoPrisma = e.code || e.message; }
  conferir(
    'gravação DIRETA no banco com a mesma chave é recusada (índice único vivo)',
    codigoPrisma === 'P2002',
    `código do Prisma: ${codigoPrisma}`,
  );

  // ⚠️ E o mesmo atalho em OUTRA empresa TEM de passar — a unicidade é por empresa, não global.
  const rB = await S.criar(adminB, { atalho: '/bomdia', titulo: 'Saudação da B', mensagem: 'Olá da empresa B, {{contactFirstName}}.' });
  conferir('o MESMO atalho é aceito em outra empresa', rB.tenantId === empresaB.id && rB.atalho === 'bomdia', `id ${rB.id.slice(0, 8)}…`);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('4. ISOLAMENTO ENTRE EMPRESAS — a verificação obrigatória');
  const listaB = await S.listar(adminB, {});
  conferir(
    'a empresa B lista SÓ a resposta dela',
    listaB.total === 1 && listaB.itens[0].id === rB.id,
    `total=${listaB.total}`,
  );
  conferir(
    'nenhum id da empresa A aparece na lista da B',
    !listaB.itens.some((i) => i.id === r1.id || i.id === r2.id),
  );
  conferir('B não consegue LER a resposta de A (obter → null ⇒ 404)', (await S.obter(adminB, r1.id)) === null);
  conferir('B não consegue EDITAR a resposta de A (→ null ⇒ 404)', (await S.editar(adminB, r1.id, { titulo: 'invadido' })) === null);
  conferir('B não consegue REMOVER a resposta de A (→ null ⇒ 404)', (await S.remover(adminB, r1.id)) === null);

  const aindaLa = await prisma.ragnabotRespostaRapida.findUnique({ where: { id: r1.id } });
  conferir('e a resposta de A continua intacta no banco', aindaLa && aindaLa.titulo === 'Saudação da manhã', aindaLa?.titulo);

  // A tentativa clássica: mandar o tenantId da outra empresa no filtro. Tem de ser IGNORADO.
  const tentativa = await S.listar(adminB, { tenantId: empresaA.id });
  conferir(
    'tenantId vindo da tela NÃO alarga o alcance (continua vendo só a B)',
    tentativa.total === 1 && tentativa.itens[0].tenantId === empresaB.id,
    `total=${tentativa.total}`,
  );

  // Usuário sem empresa vinculada: falha FECHADA (vê nada), nunca ABERTA (vê tudo).
  const orfao = { id: 'sem-empresa', name: 'Órfão', role: 'user' };
  const listaOrfao = await S.listar(orfao, {});
  conferir('usuário sem empresa vinculada não vê NADA (falha fechada)', listaOrfao.total === 0, listaOrfao.aviso || '');

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('5. VISIBILIDADE PESSOAL');
  const pessoal1 = await S.criar(agente1A, {
    atalho: 'bomdia', visibilidade: 'pessoal',
    titulo: 'Minha saudação', mensagem: 'Oi {{contactFirstName}}, aqui é o {{user}} :)',
  });
  conferir('o atendente cria a PESSOAL dele com o mesmo atalho da empresa', pessoal1.visibilidade === 'pessoal' && pessoal1.userId === agente1A.id, pessoal1.chaveAtalho);

  const vistoPor2 = await S.listar(agente2A, {});
  conferir(
    'o colega NÃO enxerga a resposta pessoal do outro',
    !vistoPor2.itens.some((i) => i.id === pessoal1.id),
    `o agente 2 vê ${vistoPor2.total} (as da empresa)`,
  );
  conferir('e o dono enxerga a dele', (await S.listar(agente1A, {})).itens.some((i) => i.id === pessoal1.id));

  let recusa403 = null;
  try { await S.editar(agente2A, pessoal1.id, { titulo: 'x' }); } catch (e) { recusa403 = e; }
  const viuOuNao = await S.obter(agente2A, pessoal1.id);
  conferir(
    'o colega nem chega a poder editar (nem vê a linha ⇒ 404)',
    viuOuNao === null && recusa403 === null,
    'obter devolveu null; editar devolveu null',
  );

  let recusaEmpresa = null;
  try {
    await S.criar(agente1A, { atalho: 'naopode', visibilidade: 'empresa', titulo: 'x', mensagem: 'y' });
  } catch (e) { recusaEmpresa = e; }
  conferir(
    'atendente comum NÃO publica resposta para a empresa inteira (403)',
    recusaEmpresa && recusaEmpresa.status === 403,
    recusaEmpresa ? `"${recusaEmpresa.message}"` : 'não recusou',
  );

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('6. EXPANDIR — as variáveis viram valor');
  const exp = S.expandir(r1.mensagem, {
    contactName: 'Maria Magnólia', user: 'João', protocolo: '2026082900001',
    ticket_id: 4821, greeting: 'Boa tarde',
  });
  conferir(
    'texto expandido com nome, atendente, protocolo e atendimento',
    exp.texto === 'Boa tarde, Maria! Aqui é João. Seu protocolo é 2026082900001 (atendimento 4821).',
    `→ "${exp.texto}"`,
  );
  conferir('primeiro nome derivado do nome completo', exp.texto.includes('Maria!') && !exp.texto.includes('Magnólia'));

  const alias = S.expandir('Olá {{firstName}} / {{contactFirstName}} — protocolo {{protocolNumber}} = {{protocolo}}', {
    contactName: 'Ana Paula', protocolo: 'P-9',
  });
  conferir(
    'os nomes ANTIGOS da origem funcionam iguais aos canônicos',
    alias.texto === 'Olá Ana / Ana — protocolo P-9 = P-9',
    `→ "${alias.texto}"`,
  );

  const faltando = S.expandir('Seu protocolo é {{protocolo}}.', { contactName: 'Zé' });
  conferir(
    'variável sem valor vira vazio E é DENUNCIADA em `ausentes`',
    faltando.texto === 'Seu protocolo é .' && faltando.ausentes.includes('protocolo'),
    `texto="${faltando.texto}" ausentes=[${faltando.ausentes.join(',')}]`,
  );

  // ⚠️ Passada única: o que veio do cliente NUNCA é reinterpolado. Sem isso, o contato que se
  // chamasse "{{protocolo}}" receberia o protocolo de volta no lugar do próprio nome.
  const injecao = S.expandir('Olá {{contactName}}.', { contactName: '{{protocolo}}', protocolo: 'SEGREDO-123' });
  conferir(
    'passada única: valor substituído não é reinterpolado (sem injeção)',
    injecao.texto === 'Olá {{protocolo}}.' && !injecao.texto.includes('SEGREDO-123'),
    `→ "${injecao.texto}"`,
  );

  const saud = S.saudacaoDe(new Date('2026-08-29T12:00:00Z')); // 09:00 em America/Fortaleza
  conferir('a saudação usa o fuso do Brasil, não UTC', saud === 'Bom dia', `12:00Z → "${saud}"`);
  conferir(
    'variável inventada é apontada como desconhecida',
    S.variaveisDesconhecidas('Oi {{contatoNomee}} e {{contactName}}').join(',') === 'contatoNomee',
  );

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('7. RESOLVER — qual resposta o /bomdia aciona');
  const semEscopo = await S.resolverAtalho(adminA, '/bomdia', { contactName: 'Carlos Silva', user: 'Admin A', greeting: 'Olá' });
  conferir(
    'o admin (sem pessoal) recebe a da EMPRESA',
    semEscopo && semEscopo.resposta.id === r1.id,
    semEscopo ? `titulo="${semEscopo.resposta.titulo}"` : 'nada',
  );

  const comPessoal = await S.resolverAtalho(agente1A, 'bomdia', { contactName: 'Carlos Silva', user: 'Agente 1' });
  conferir(
    'o dono de uma PESSOAL com o mesmo atalho recebe a dele (mais específica ganha)',
    comPessoal && comPessoal.resposta.id === pessoal1.id,
    comPessoal ? `titulo="${comPessoal.resposta.titulo}" · texto="${comPessoal.texto}"` : 'nada',
  );

  const daCaixa = await S.criar(adminA, {
    atalho: 'boleto', cwInboxId: 42, titulo: 'Boleto da caixa 42', mensagem: 'Boleto da caixa 42 para {{contactFirstName}}.',
  });
  const naCaixa = await S.resolverAtalho(adminA, 'boleto', { cwInboxId: 42, contactName: 'Ana' });
  const foraDaCaixa = await S.resolverAtalho(adminA, 'boleto', { cwInboxId: 7, contactName: 'Ana' });
  conferir('dentro da caixa 42 ganha a resposta da caixa', naCaixa && naCaixa.resposta.id === daCaixa.id, naCaixa?.texto);
  conferir('em outra caixa volta a valer a geral', foraDaCaixa && foraDaCaixa.resposta.id === r2.id, foraDaCaixa?.texto);

  const inexistente = await S.resolverAtalho(adminA, '/naoexiste', {});
  conferir('atalho inexistente devolve null (a rota traduz em 404)', inexistente === null);

  const daOutraEmpresa = await S.resolverAtalho(adminB, '/bomdia', { contactName: 'X' });
  conferir(
    'a empresa B resolvendo /bomdia recebe o texto DELA, não o de A',
    daOutraEmpresa && daOutraEmpresa.resposta.id === rB.id && daOutraEmpresa.texto.includes('empresa B'),
    daOutraEmpresa?.texto,
  );

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('8. EDITAR / REMOVER');
  const editada = await S.editar(adminA, r2.id, { titulo: '2ª via do boleto', mensagem: 'Segue a 2ª via, {{contactName}}.' });
  conferir('editou título e texto', editada.titulo === '2ª via do boleto' && editada.mensagem.includes('2ª via'), editada.titulo);

  const trocouAtalho = await S.editar(adminA, r2.id, { atalho: '/2via' });
  conferir(
    'trocar o atalho recalcula a chave (senão o antigo ficaria trancado para sempre)',
    trocouAtalho.atalho === '2via' && trocouAtalho.chaveAtalho === '2via|geral|empresa',
    trocouAtalho.chaveAtalho,
  );
  const liberou = await S.criar(adminA, { atalho: 'boleto', titulo: 'Boleto novo', mensagem: 'texto' });
  conferir('o atalho antigo ficou livre para reuso', liberou.atalho === 'boleto', `id ${liberou.id.slice(0, 8)}…`);

  const desativada = await S.editar(adminA, liberou.id, { ativa: false });
  const listaAtivas = await S.listar(adminA, {});
  conferir(
    'desativar tira da lista padrão (mas continua no banco)',
    desativada.ativa === false && !listaAtivas.itens.some((i) => i.id === liberou.id),
    `lista padrão tem ${listaAtivas.total}`,
  );
  const listaTudo = await S.listar(adminA, { incluirInativas: true });
  conferir('e reaparece com incluirInativas', listaTudo.itens.some((i) => i.id === liberou.id), `total=${listaTudo.total}`);

  const removida = await S.remover(adminA, liberou.id);
  const sumiu = await prisma.ragnabotRespostaRapida.findUnique({ where: { id: liberou.id } });
  conferir('removeu de verdade', removida && sumiu === null);
  conferir('o dono remove a PESSOAL dele', (await S.remover(agente1A, pessoal1.id)) !== null);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('9. AS ROTAS — o código HTTP que a tela vai ler');
  // As seções acima provam a REGRA (serviço). Esta prova o ENCANAMENTO: que a rota devolve 409 e
  // não 500 no atalho repetido, e — o que mais importa — que o id de outra empresa responde
  // **404 e não 403**. 403 confirmaria ao curioso que aquele id existe, que é metade do vazamento.
  // O router sobe num Express de mentira, com `req.user` injetado à mão: quem está sob teste é
  // ESTE arquivo, não o middleware de autenticação do NOC (que é de outro dono).
  try {
    const express = (await import('express')).default;
    const router = (await import('../src/routes/ragnabot-respostas-rapidas.routes.js')).default;

    const app = express();
    app.use(express.json());
    let comoQuem = null;
    app.use((req, _res, prox) => { req.user = comoQuem; prox(); });
    app.use('/api/rr', router);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${srv.address().port}/api/rr`;
    const chamar = async (metodo, url, corpo) => {
      const resp = await fetch(base + url, {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      return { status: resp.status, corpo: await resp.json().catch(() => null) };
    };

    try {
      comoQuem = adminA;
      let h = await chamar('GET', '/opcoes');
      conferir('GET /opcoes devolve o vocabulário sem tocar no banco', h.status === 200 && h.corpo.variaveis.length > 0,
        `${h.status} · ${h.corpo?.variaveis?.length} variáveis`);

      h = await chamar('POST', '/', { atalho: '/rota', titulo: 'Pela rota', mensagem: 'Oi {{contactFirstName}}!' });
      const idRota = h.corpo?.resposta?.id;
      conferir('POST / cria e devolve 201', h.status === 201 && idRota, `${h.status} · ${h.corpo?.resposta?.atalhoExibido}`);

      h = await chamar('POST', '/', { atalho: 'rota', titulo: 'Repetida', mensagem: 'x' });
      conferir('POST / com atalho repetido devolve 409 (não 500)', h.status === 409 && h.corpo?.code === 'ATALHO_DUPLICADO',
        `${h.status} · "${h.corpo?.error}"`);

      h = await chamar('GET', '/resolver?atalho=/rota&contactName=Maria%20Silva');
      conferir('GET /resolver expande o texto', h.status === 200 && h.corpo?.texto === 'Oi Maria!', `${h.status} · "${h.corpo?.texto}"`);

      h = await chamar('GET', '/resolver?atalho=/naoexiste');
      conferir('GET /resolver de atalho inexistente devolve 404', h.status === 404 && h.corpo?.code === 'ATALHO_NAO_ENCONTRADO', `${h.status}`);

      h = await chamar('POST', '/previa', { mensagem: 'Olá {{contactName}} e {{inventada}}' });
      conferir('POST /previa aponta a variável inventada', h.status === 200 && h.corpo?.desconhecidas?.join() === 'inventada',
        `${h.status} · "${h.corpo?.texto}"`);

      // ⚠️ O CORAÇÃO DESTA SEÇÃO.
      comoQuem = adminB;
      const fora = [
        ['GET', `/${idRota}`],
        ['PATCH', `/${idRota}`],
        ['DELETE', `/${idRota}`],
      ];
      for (const [metodo, url] of fora) {
        // eslint-disable-next-line no-await-in-loop
        const resp = await chamar(metodo, url, metodo === 'PATCH' ? { titulo: 'invadido' } : undefined);
        conferir(`${metodo} ${url} de OUTRA empresa → 404 (nunca 403)`, resp.status === 404, `${resp.status} · "${resp.corpo?.error}"`);
      }
      // ⚠️ AQUI O TESTE REPROVOU POR CULPA PRÓPRIA (1ª execução, 29/08) e a lição fica registrada:
      // a primeira versão exigia `total === 0`, copiada de uma bancada onde a empresa B não tinha
      // nada. Mas a B TEM a resposta dela (criada na seção 3) — e ela deve mesmo aparecer. O que se
      // prova aqui não é "a lista está vazia"; é que **tudo o que a B vê pertence à B**. Exigir
      // vazio teria feito o produto ser acusado por um defeito do instrumento.
      h = await chamar('GET', '/');
      const soDaB = Array.isArray(h.corpo?.itens) && h.corpo.itens.every((i) => i.tenantId === empresaB.id);
      conferir('GET / da outra empresa lista SÓ o que é dela', h.status === 200 && soDaB && h.corpo.total >= 1,
        `total=${h.corpo?.total}, todas da empresa B: ${soDaB}`);

      comoQuem = adminA;
      h = await chamar('DELETE', `/${idRota}`);
      conferir('DELETE /:id pela dona devolve 200', h.status === 200 && h.corpo?.removida === true, `${h.status}`);
    } finally {
      srv.close();
    }
  } catch (e) {
    pulou('rotas HTTP', e.message);
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  secao('10. AS 3 CHAVES ESTRANGEIRAS COMPOSTAS CONTINUAM VIVAS');
  // A migração desta funcionalidade passou pelo `migrate diff`, cujo resultado bruto vinha com os
  // 3 `DROP CONSTRAINT rb_*_versao_fk` no topo. Se alguém, um dia, aplicar o diff SEM recortar, é
  // aqui que se descobre — e não seis meses depois, com nó de um fluxo apontando para versão de
  // outra empresa.
  const fks = await prisma.$queryRawUnsafe(
    "SELECT conname FROM pg_constraint WHERE conname IN ('rb_no_versao_fk','rb_aresta_versao_fk','rb_exec_versao_fk') ORDER BY 1",
  );
  conferir('rb_no_versao_fk / rb_aresta_versao_fk / rb_exec_versao_fk presentes', fks.length === 3, fks.map((f) => f.conname).join(', '));
} catch (e) {
  console.log(`\n💥 ERRO INESPERADO: ${e.message}`);
  if (VERBOSE) console.log(e.stack);
  reprovou += 1;
  process.exitCode = 3;
} finally {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  secao('11. LIMPEZA — e a PROVA de que não sobrou rastro');
  try {
    const ids = [empresaA?.id, empresaB?.id].filter(Boolean);
    if (ids.length) {
      const apagadas = await prisma.ragnabotRespostaRapida.deleteMany({ where: { tenantId: { in: ids } } });
      await prisma.ragnabotAuditoria.deleteMany({ where: { tenantId: { in: ids } } }).catch(() => {});
      await prisma.ragnabotTenant.deleteMany({ where: { id: { in: ids } } });
      console.log(`  🧹 ${apagadas.count} resposta(s) e ${ids.length} empresa(s) de teste removidas`);
    }
    const sobrouEmpresa = await prisma.ragnabotTenant.count({ where: { slug: { startsWith: MARCA } } });
    const sobrouResposta = ids.length
      ? await prisma.ragnabotRespostaRapida.count({ where: { tenantId: { in: ids } } })
      : 0;
    conferir('nenhum rastro do teste ficou no banco', sobrouEmpresa === 0 && sobrouResposta === 0,
      `empresas=${sobrouEmpresa} respostas=${sobrouResposta}`);
  } catch (e) {
    pulou('limpeza', e.message);
  }
  await prisma.$disconnect().catch(() => {});
}

console.log(`\n${'═'.repeat(90)}`);
console.log(`RESULTADO: ${passou} provadas · ${reprovou} reprovadas · ${naoExecutou} não executaram`);
console.log('═'.repeat(90));
if (reprovou > 0) process.exit(process.exitCode === 3 ? 3 : 1);
if (naoExecutou > 0) process.exit(2);
process.exit(0);
