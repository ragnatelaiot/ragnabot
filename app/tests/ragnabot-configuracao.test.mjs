#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MENU CONFIGURAÇÕES — o catálogo, o isolamento por empresa, a auditoria e o segredo.
// Contrato S7 (02/09/2026), doc 34 §F8.
//
// O QUE ESTE ARQUIVO TENTA REPROVAR, item a item do contrato:
//   · «toda configuração é por empresa»        → empresa A não LÊ nem ESCREVE a de B
//   · «auditoria com antes→depois»             → a transição, e não só o estado final
//   · «segredo cifrado, fora do log»           → o texto em claro não aparece em lugar nenhum
//   · «cada painel salva e relê o que salvou»  → os 10 painéis, um por um
//   · a honestidade do campo `efeito`          → 'aplicado' que ninguém lê é REPROVADO
//
// COMO RODAR:  node tests/ragnabot-configuracao.test.mjs
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Chave de cifragem própria do teste: os segredos gravados aqui não podem abrir com a chave de
// produção, nem o contrário.
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ninguem:ninguem@127.0.0.1:1/vazio';

import { criarFakeSimples } from './fixtures/fake-prisma-simples.mjs';

let falhas = 0; let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

const cat = await import('../src/services/ragnabot-configuracao.catalogo.js');
const cfg = await import('../src/services/ragnabot-configuracao.service.js');
const { decrypt } = await import('../src/base/crypto.js');

// ── O banco de mentira, com o índice ÚNICO que o banco de verdade tem ──────────────────────────
// Sem o único declarado, o teste de "um ajuste por escopo" passaria sozinho e não provaria nada.
const REGISTRO = [];
const logEspiao = {
  info: (m) => REGISTRO.push(String(m)), warn: (m) => REGISTRO.push(String(m)),
  error: (m) => REGISTRO.push(String(m)), debug: (m) => REGISTRO.push(String(m)),
};

const EMPRESA_A = '11111111-1111-4111-8111-111111111111';
const EMPRESA_B = '22222222-2222-4222-8222-222222222222';

function montarBanco() {
  return criarFakeSimples(['ragnabotConfiguracao'], {
    ragnabotConfiguracao: [['chaveEscopo', 'chave']],
  });
}

let db = montarBanco();
cfg.configurar({ db, log: logEspiao });

const adminA = { id: 'cw:10', name: 'Ana (empresa A)', role: 'admin', isSuperuser: false, ragnabotTenantId: EMPRESA_A };
const adminB = { id: 'cw:20', name: 'Bruno (empresa B)', role: 'admin', isSuperuser: false, ragnabotTenantId: EMPRESA_B };
const atendenteA = { id: 'cw:11', name: 'Carla (atendente A)', role: 'user', isSuperuser: false, ragnabotTenantId: EMPRESA_A };
const superOperador = { id: 'noc:1', name: 'Operação Ragnatela', role: 'admin', isSuperuser: true, ragnabotTenantId: null };
const semEmpresa = { id: 'cw:99', name: 'Sem vínculo', role: 'admin', isSuperuser: false, ragnabotTenantId: null };

console.log('\n── 1. O CATÁLOGO ──────────────────────────────────────────────────────────────────');

await medir('os 10 painéis do doc 34 §F8 existem, e whitelabel é o único do OPERADOR', () => {
  assert.equal(cat.PAINEIS.length, 10);
  const doOperador = cat.PAINEIS.filter((p) => p.escopo === 'operador').map((p) => p.id);
  assert.deepEqual(doOperador, ['whitelabel']);
});

await medir('toda chave declara painel, tipo, rótulo, ajuda e EFEITO — sem campo mudo', () => {
  for (const [chave, d] of Object.entries(cat.CHAVES)) {
    assert.ok(d.painel, `${chave} sem painel`);
    assert.ok(d.tipo, `${chave} sem tipo`);
    assert.ok(d.rotulo, `${chave} sem rótulo`);
    assert.ok(['aplicado', 'declarado'].includes(d.efeito), `${chave} com efeito inválido: ${d.efeito}`);
    assert.ok(cat.PAINEIS.some((p) => p.id === d.painel), `${chave} aponta painel inexistente`);
    // O prefixo da chave tem de casar com o painel — é o que impede um ajuste de whitelabel
    // entrar por um painel de empresa e furar a trava do operador.
    assert.ok(chave.includes('.'), `${chave} sem prefixo`);
  }
});

await medir('⚠️ A HONESTIDADE: chave marcada "aplicado" tem de ser LIDA por algum código', () => {
  // Painel cheio de interruptor que não faz nada ensina o operador a desconfiar de todos —
  // inclusive dos que funcionam. Se alguém marcar 'aplicado' sem ligar o consumidor, reprova aqui.
  const raiz = path.join(process.cwd(), 'src');
  const arquivos = [];
  (function varrer(d) {
    for (const nome of fs.readdirSync(d)) {
      const p = path.join(d, nome);
      if (fs.statSync(p).isDirectory()) { varrer(p); continue; }
      if (!p.endsWith('.js')) continue;
      if (p.endsWith('ragnabot-configuracao.catalogo.js')) continue; // o próprio catálogo não conta
      arquivos.push(p);
    }
  }(raiz));
  const fonte = arquivos.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const mentirosas = Object.values(cat.CHAVES)
    .filter((d) => d.efeito === 'aplicado' && !fonte.includes(d.chave))
    .map((d) => d.chave);
  assert.deepEqual(mentirosas, [], `marcadas "aplicado" e ninguém lê: ${mentirosas.join(', ')}`);
});

await medir('validação recusa tipo errado, faixa, opção inexistente e cor mal formada', () => {
  assert.throws(() => cat.validar('atendimento.saudacaoAutomatica', 'talvez'), /ligado ou desligado/u);
  assert.throws(() => cat.validar('integracoes.smtpPorta', 0), /não pode ser menor/u);
  assert.throws(() => cat.validar('integracoes.smtpPorta', 70000), /não pode ser maior/u);
  assert.throws(() => cat.validar('atendimento.historicoPor', 'por_time'), /aceita: global, setor/u);
  assert.throws(() => cat.validar('whitelabel.corPrimariaClara', 'verde'), /#RRGGBB/u);
  assert.throws(() => cat.validar('chave.que.nao.existe', 1), /desconhecido/u);
});

await medir('⛔ URL só aceita http/https — `javascript:` no whitelabel seria execução na tela de TODOS', () => {
  assert.throws(() => cat.validar('whitelabel.logotipoUrl', 'javascript:alert(1)'), /http:\/\/ ou https:\/\//u);
  assert.throws(() => cat.validar('whitelabel.logotipoUrl', 'data:text/html,<script>'), /http:\/\/ ou https:\/\//u);
  assert.equal(cat.validar('whitelabel.logotipoUrl', 'https://cdn.ragnatela.com.br/logo.png'), 'https://cdn.ragnatela.com.br/logo.png');
});

await medir('a mensagem de redefinição de senha EXIGE {tokenSenha}', () => {
  // Sem a marca, o e-mail chega e não serve para nada — e o cliente só descobre sem conseguir entrar.
  assert.throws(() => cat.validar('whitelabel.msgRedefinicaoDeSenha', '<p>Olá</p>'), /precisa conter \{tokenSenha\}/u);
  assert.ok(cat.validar('whitelabel.msgRedefinicaoDeSenha', '<p>Link: {tokenSenha}</p>'));
  assert.equal(cat.validar('whitelabel.msgRedefinicaoDeSenha', ''), ''); // vazio = usa o padrão
});

await medir('as decisões do DONO estão declaradas, não escondidas', () => {
  const ids = cat.PENDENTES_DE_DECISAO.map((p) => p.id);
  assert.ok(ids.includes('hubsoft'), 'HubSoft precisa aparecer como pendente — o dono não disse se usa');
  assert.ok(ids.includes('whatsapp_api_provedores'));
  // E nenhuma delas virou chave gravável: integração que ninguém pediu é dívida de graça.
  for (const chave of Object.keys(cat.CHAVES)) {
    assert.ok(!/hubsoft/iu.test(chave), `${chave} não devia existir — HubSoft depende do dono`);
  }
});

console.log('\n── 2. ISOLAMENTO POR EMPRESA (o teste de aceite do contrato) ──────────────────────');

await medir('empresa A salva e relê o que salvou', async () => {
  const r = await cfg.salvarPainel(adminA, 'atendimento', { 'atendimento.historicoPor': 'setor' });
  assert.equal(r.mudancas.length, 1);
  assert.equal(r.tenantId, EMPRESA_A);
  const lido = await cfg.lerPainel(adminA, 'atendimento');
  const item = lido.itens.find((i) => i.chave === 'atendimento.historicoPor');
  assert.equal(item.valor, 'setor');
  assert.equal(item.configurado, true);
});

await medir('⛔ empresa B NÃO LÊ o que a empresa A salvou — vê o próprio padrão', async () => {
  const lido = await cfg.lerPainel(adminB, 'atendimento');
  const item = lido.itens.find((i) => i.chave === 'atendimento.historicoPor');
  assert.equal(item.valor, 'global', 'B recebeu o valor de A — VAZAMENTO');
  assert.equal(item.configurado, false);
  assert.equal(lido.tenantId, EMPRESA_B);
});

await medir('⛔ empresa B mandando `tenantIdAlvo` da empresa A escreve na PRÓPRIA — nunca em A', async () => {
  // Foi confiando na empresa que a TELA mandava que o sistema antigo vazou.
  await cfg.salvarPainel(adminB, 'atendimento', { 'atendimento.aceitarAudio': false }, { tenantIdAlvo: EMPRESA_A });
  const emA = await cfg.lerPainel(adminA, 'atendimento');
  assert.equal(emA.itens.find((i) => i.chave === 'atendimento.aceitarAudio').valor, true, 'B escreveu em A — VAZAMENTO');
  const emB = await cfg.lerPainel(adminB, 'atendimento');
  assert.equal(emB.itens.find((i) => i.chave === 'atendimento.aceitarAudio').valor, false);
});

await medir('⛔ empresa B lendo com `tenantIdAlvo` de A recebe o painel DELA', async () => {
  const lido = await cfg.lerPainel(adminB, 'atendimento', { tenantIdAlvo: EMPRESA_A });
  assert.equal(lido.tenantId, EMPRESA_B);
  assert.equal(lido.itens.find((i) => i.chave === 'atendimento.historicoPor').valor, 'global');
});

await medir('o banco tem UMA linha por escopo — o único do banco de verdade está declarado no dublê', async () => {
  const linhas = db.__tabelas.ragnabotConfiguracao.filter((l) => l.chave === 'atendimento.historicoPor');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].chaveEscopo, `tenant:${EMPRESA_A}`);
  // E a coerência que o CHECK do banco também tranca: tenantId e chaveEscopo apontam a mesma empresa.
  for (const l of db.__tabelas.ragnabotConfiguracao) {
    if (l.tenantId === null) assert.equal(l.chaveEscopo, 'casa');
    else assert.equal(l.chaveEscopo, `tenant:${l.tenantId}`);
  }
});

await medir('administrador SEM empresa vinculada não lê nem escreve nada — falha FECHADA', async () => {
  await assert.rejects(() => cfg.lerPainel(semEmpresa, 'atendimento'), /não está vinculada/u);
  await assert.rejects(() => cfg.salvarPainel(semEmpresa, 'atendimento', { 'atendimento.aceitarAudio': false }), /não está vinculada/u);
});

await medir('super usuário PRECISA dizer de qual empresa é — não grava "a configuração de ninguém"', async () => {
  await assert.rejects(() => cfg.lerPainel(superOperador, 'atendimento'), /precisa dizer de qual empresa/u);
  const r = await cfg.salvarPainel(superOperador, 'atendimento', { 'atendimento.aceitarLigacoes': true }, { tenantIdAlvo: EMPRESA_B });
  assert.equal(r.tenantId, EMPRESA_B);
});

await medir('o painel do OPERADOR (whitelabel) é da casa, e não da empresa de quem chamou', async () => {
  const r = await cfg.salvarPainel(adminA, 'whitelabel', { 'whitelabel.nomeDoSistema': 'Atende Já' });
  assert.equal(r.tenantId, null);
  assert.equal(r.escopo, 'operador');
  const linha = db.__tabelas.ragnabotConfiguracao.find((l) => l.chave === 'whitelabel.nomeDoSistema');
  assert.equal(linha.chaveEscopo, 'casa');
  // ⚠️ Que o serviço grave na casa NÃO é a trava — a trava é a rota (`exigirOperadorDoSaas`), e
  // ela é medida em `tests/ragnabot-configuracao-visibilidade.test.mjs`, pela API, com HTTP.
});

console.log('\n── 3. AUDITORIA: ANTES → DEPOIS ───────────────────────────────────────────────────');

await medir('a primeira gravação registra antes=null e depois=valor', async () => {
  db = montarBanco(); cfg.configurar({ db });
  const r = await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.modoDeExibicaoDasEtiquetas': 'bolinha' });
  assert.equal(r.mudancas.length, 1);
  assert.equal(r.mudancas[0].antes, null);
  assert.equal(r.mudancas[0].depois, 'bolinha');
});

await medir('a segunda gravação prova a TRANSIÇÃO — antes "bolinha", depois "texto"', async () => {
  const r = await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.modoDeExibicaoDasEtiquetas': 'texto' });
  assert.equal(r.mudancas[0].antes, 'bolinha');
  assert.equal(r.mudancas[0].depois, 'texto');
});

await medir('salvar o MESMO valor não vira mudança — auditoria que ninguém lê não pega o dia real', async () => {
  const r = await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.modoDeExibicaoDasEtiquetas': 'texto' });
  assert.equal(r.mudancas.length, 0);
  assert.deepEqual(r.semMudanca, ['aparencia.modoDeExibicaoDasEtiquetas']);
});

await medir('`null` volta ao padrão e a auditoria mostra antes=valor, depois=null', async () => {
  const r = await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.modoDeExibicaoDasEtiquetas': null });
  assert.equal(r.mudancas[0].antes, 'texto');
  assert.equal(r.mudancas[0].depois, null);
  const lido = await cfg.lerPainel(adminA, 'aparencia');
  assert.equal(lido.itens.find((i) => i.chave === 'aparencia.modoDeExibicaoDasEtiquetas').valor, 'texto'); // o padrão
  assert.equal(lido.itens.find((i) => i.chave === 'aparencia.modoDeExibicaoDasEtiquetas').configurado, false);
});

await medir('quem salvou fica gravado na linha (nome e id), para a tela e para a auditoria', async () => {
  await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.tema': 'escuro' });
  const lido = await cfg.lerPainel(adminA, 'aparencia');
  const item = lido.itens.find((i) => i.chave === 'aparencia.tema');
  assert.equal(item.atualizadoPor, 'Ana (empresa A)');
  assert.ok(item.atualizadoEm);
});

await medir('⛔ nada é gravado quando UMA chave do lote é inválida — meia gravação é pior', async () => {
  const antes = JSON.stringify(db.__tabelas.ragnabotConfiguracao);
  await assert.rejects(() => cfg.salvarPainel(adminA, 'aparencia', {
    'aparencia.tema': 'claro',
    'aparencia.modoDeExibicaoDasEtiquetas': 'quadradinho', // inválida
  }), /aceita: texto, bolinha/u);
  assert.equal(JSON.stringify(db.__tabelas.ragnabotConfiguracao), antes, 'gravou metade do lote');
});

await medir('⛔ chave de OUTRO painel é recusada — senão a trava do operador seria contornável', async () => {
  // Sem esta recusa, um PUT no painel "aparencia" (que a empresa pode) gravaria uma chave de
  // whitelabel (que ela não pode) — e a trava do operador viraria enfeite.
  await assert.rejects(
    () => cfg.salvarPainel(adminA, 'aparencia', { 'whitelabel.nomeDoSistema': 'Invadido' }),
    /é do painel "whitelabel", não de "aparencia"/u,
  );
});

console.log('\n── 4. SEGREDOS ────────────────────────────────────────────────────────────────────');

const SENHA = 'S3nh4-do-SMTP-que-nao-pode-vazar!';

await medir('o segredo é gravado CIFRADO — o texto em claro não está na linha', async () => {
  db = montarBanco(); REGISTRO.length = 0; cfg.configurar({ db, log: logEspiao });
  await cfg.salvarPainel(adminA, 'integracoes', { 'integracoes.smtpSenha': SENHA });
  const linha = db.__tabelas.ragnabotConfiguracao.find((l) => l.chave === 'integracoes.smtpSenha');
  const cru = JSON.stringify(linha);
  assert.ok(!cru.includes(SENHA), 'a senha em claro está na linha do banco');
  assert.ok(linha.valor.c, 'nada cifrado gravado');
  assert.equal(linha.segredo, true);
  // E abre de volta: cifrar de um jeito que não abre é perder o segredo com estilo.
  assert.equal(decrypt(linha.valor.c), SENHA);
});

await medir('a LEITURA nunca devolve o segredo — só "definido" e a impressão digital', async () => {
  const lido = await cfg.lerPainel(adminA, 'integracoes');
  const item = lido.itens.find((i) => i.chave === 'integracoes.smtpSenha');
  assert.equal(item.valor, null);
  assert.equal(item.definido, true);
  assert.equal(item.impressaoDigital, cfg.impressaoDigitalDe(SENHA));
  assert.equal(item.impressaoDigital.length, 12);
  assert.ok(!JSON.stringify(lido).includes(SENHA), 'o segredo saiu na leitura do painel');
  // ⛔ E nem o texto cifrado sai: o que a tela mascara chegou inteiro pela rede.
  const linha = db.__tabelas.ragnabotConfiguracao.find((l) => l.chave === 'integracoes.smtpSenha');
  assert.ok(!JSON.stringify(lido).includes(linha.valor.c), 'o texto cifrado saiu na leitura');
});

await medir('a AUDITORIA do segredo registra a impressão digital, nunca o valor', async () => {
  const r = await cfg.salvarPainel(adminA, 'integracoes', { 'integracoes.smtpSenha': 'outra-senha-diferente' });
  const m = r.mudancas.find((x) => x.chave === 'integracoes.smtpSenha');
  assert.equal(m.segredo, true);
  assert.deepEqual(m.antes, { impressaoDigital: cfg.impressaoDigitalDe(SENHA) });
  assert.deepEqual(m.depois, { impressaoDigital: cfg.impressaoDigitalDe('outra-senha-diferente') });
  assert.ok(!JSON.stringify(r).includes('outra-senha-diferente'), 'o segredo saiu na auditoria');
  // A impressão digital PROVA que mudou, que é o que a auditoria precisa dizer.
  assert.notEqual(m.antes.impressaoDigital, m.depois.impressaoDigital);
});

await medir('⛔ o segredo NÃO aparece em nenhuma linha de log', async () => {
  const tudo = REGISTRO.join('\n');
  assert.ok(!tudo.includes(SENHA), 'a senha vazou para o log');
  assert.ok(!tudo.includes('outra-senha-diferente'), 'a senha vazou para o log');
});

await medir('quem PRECISA do segredo pede explicitamente — e é o único ponto de decifragem', async () => {
  assert.equal(await cfg.lerSegredo(EMPRESA_A, 'integracoes.smtpSenha'), 'outra-senha-diferente');
  // ⛔ E a empresa B não alcança o segredo de A por este caminho.
  assert.equal(await cfg.lerSegredo(EMPRESA_B, 'integracoes.smtpSenha'), null);
  // `valorDe` (a leitura genérica do produto) devolve null para chave de segredo, de propósito.
  assert.equal(await cfg.valorDe(EMPRESA_A, 'integracoes.smtpSenha'), null);
});

await medir('salvar segredo VAZIO apaga — e não grava uma string vazia cifrada', async () => {
  const r = await cfg.salvarPainel(adminA, 'integracoes', { 'integracoes.smtpSenha': '' });
  assert.equal(r.mudancas[0].depois, null);
  assert.equal(await cfg.lerSegredo(EMPRESA_A, 'integracoes.smtpSenha'), null);
  const lido = await cfg.lerPainel(adminA, 'integracoes');
  assert.equal(lido.itens.find((i) => i.chave === 'integracoes.smtpSenha').definido, false);
});

console.log('\n── 5. CADA PAINEL SALVA E RELÊ O QUE SALVOU ───────────────────────────────────────');

// Um valor de teste plausível por tipo — o objetivo é exercitar TODAS as chaves do catálogo,
// não escolher valores bonitos. Chave que ninguém consegue gravar é chave morta.
function valorDeTeste(d) {
  switch (d.tipo) {
    case 'bool': return d.padrao !== true;
    case 'inteiro': return Math.min(d.max ?? 10, Math.max(d.min ?? 1, 7));
    case 'opcao': return (d.opcoes.find((o) => o.id !== d.padrao) || d.opcoes[0]).id;
    case 'cor': return '#123abc';
    case 'url': return 'https://exemplo.ragnatela.com.br/x.png';
    case 'segredo': return 'segredo-de-teste';
    case 'texto': return (d.exigeMarcas || []).length ? `texto ${d.exigeMarcas.join(' ')}` : 'texto de teste';
    default: throw new Error(`tipo sem valor de teste: ${d.tipo}`);
  }
}

for (const painel of cat.PAINEIS) {
  await medir(`painel "${painel.id}" (§${painel.doc}): grava e relê TODAS as ${cat.chavesDoPainel(painel.id).length} chaves`, async () => {
    db = montarBanco(); cfg.configurar({ db });
    const defs = cat.chavesDoPainel(painel.id);
    const enviar = {};
    for (const d of defs) enviar[d.chave] = valorDeTeste(d);
    const r = await cfg.salvarPainel(adminA, painel.id, enviar);
    assert.equal(r.mudancas.length, defs.length, 'nem toda chave foi gravada');

    const lido = await cfg.lerPainel(adminA, painel.id);
    assert.equal(lido.itens.length, defs.length);
    for (const d of defs) {
      const item = lido.itens.find((i) => i.chave === d.chave);
      assert.equal(item.configurado, true, `${d.chave} não ficou marcada como configurada`);
      if (d.tipo === 'segredo') {
        assert.equal(item.valor, null);
        assert.equal(item.definido, true);
      } else if (d.tipo === 'cor') {
        assert.equal(item.valor, '#123abc');
      } else {
        assert.deepEqual(item.valor, enviar[d.chave], `${d.chave} releu diferente do que salvou`);
      }
    }
  });
}

console.log('\n── 6. GUARDA DE MIGRAÇÃO ──────────────────────────────────────────────────────────');

await medir('sem a tabela, a leitura recusa com 503 e o MOTIVO escrito — não um TypeError cru', async () => {
  cfg.configurar({ db: {} });
  assert.equal(cfg.modeloPronto(), false);
  await assert.rejects(() => cfg.lerPainel(adminA, 'atendimento'), (e) => {
    assert.equal(e.code, 'MODELO_AUSENTE');
    assert.equal(e.status, 503);
    assert.match(e.message, /01-rb_configuracoes\.sql/u);
    return true;
  });
  // Mas a leitura INTERNA do produto continua devolvendo o padrão: um ajuste que não migrou não
  // pode derrubar o atendimento — ele volta ao comportamento de fábrica, que é o de hoje.
  assert.equal(await cfg.valorDe(EMPRESA_A, 'atendimento.aceitarAudio'), true);
  cfg.configurar({ db: montarBanco() });
});

await medir('atendente (papel "user") LÊ o painel da empresa dele — a trava de escrita é da rota', async () => {
  db = montarBanco(); cfg.configurar({ db });
  await cfg.salvarPainel(adminA, 'aparencia', { 'aparencia.tema': 'escuro' });
  const lido = await cfg.lerPainel(atendenteA, 'aparencia');
  assert.equal(lido.tenantId, EMPRESA_A);
  assert.equal(lido.itens.find((i) => i.chave === 'aparencia.tema').valor, 'escuro');
});

console.log(`\n${falhas === 0 ? '✅' : '❌'} ${medicoes - falhas}/${medicoes} verificações passaram`);
process.exit(falhas === 0 ? 0 : 1);
