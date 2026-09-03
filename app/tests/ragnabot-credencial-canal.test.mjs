#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A CREDENCIAL DO CANAL — o cofre, o resolvedor e o que eles LIGAM.
//
// Contrato S-CREDENCIAL-IG (03/09/2026).
//
// ⚠️ O QUE ESTE ARQUIVO **NÃO** PROVA, dito antes da primeira linha passar:
//   · que a Meta ACEITA o token da Página no endereço que montamos. Em 03/09/2026 não há conversa
//     de Instagram entrando; a Graph API aqui é um dublê. O que se prova é a CADEIA de resolução, o
//     endereço montado, o cache, a degradação e o não-vazamento.
//   · que o toque no botão do Telegram chega. Não há caixa de Telegram ligada. O que se prova é que
//     o evento com cara de toque dispara `answerCallbackQuery`, e que a falha dele não custa a
//     mensagem do cliente.
//   · o formato do `callback_query.id` real. O corte de 13 dígitos vem da natureza dos dois números
//     (contador por conversa × identificador global), lida no código da plataforma v4.17.1 —
//     não de um toque observado.
//
// COMO RODAR:   node tests/ragnabot-credencial-canal.test.mjs
// CÓDIGOS:      0 = verde · 1 = alguma verificação reprovou
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import util from 'node:util';

// A chave de cifragem tem de existir ANTES do primeiro import que carregue `src/base/config.js`.
// 64 hex de mentira: este teste não abre nada gravado em produção, ele cifra e decifra o próprio.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

let falhas = 0;
let medicoes = 0;
async function medir(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}

const cofre = await import('../src/services/ragnabot-segredo.service.js');
const resolvedor = await import('../src/services/ragnabot-credencial-canal.service.js');
const nativo = await import('../src/services/ragnabot-canal-nativo.porta.js');
const canal = await import('../src/services/ragnabot-canal.porta.js');
const webhook = await import('../src/routes/ragnabot-webhook.routes.js');

const semLog = { info() {}, warn() {}, error() {}, debug() {} };

// ── BANCO DE MENTIRA PARA O COFRE ─────────────────────────────────────────────────────────────
// Uma tabela em memória com a MESMA chave composta do schema `(tenantId, apelido)`. É o ponto do
// isolamento entre empresas — um dublê que ignorasse o tenantId deixaria passar exatamente o
// defeito que a chave composta existe para impedir.
function bancoDeCofre() {
  const linhas = new Map(); // `${tenantId}|${apelido}` → linha
  const k = (w) => `${w.tenantId}|${w.apelido}`;
  return {
    linhas,
    ragnabotFluxoSegredo: {
      async findUnique({ where }) { return linhas.get(k(where.tenantId_apelido)) ?? null; },
      async upsert({ where, create, update }) {
        const chave = k(where.tenantId_apelido);
        const atual = linhas.get(chave);
        const nova = atual
          ? { ...atual, ...update }
          : { id: `s-${linhas.size + 1}`, rotacionadoEm: null, usadoEm: null, criadoEm: new Date(), ...create };
        linhas.set(chave, nova);
        return nova;
      },
      async update({ where, data }) {
        for (const [chave, l] of linhas) if (l.id === where.id) { linhas.set(chave, { ...l, ...data }); return l; }
        return null;
      },
      // ⚠️ O DUBLÊ HONRA O `select`. Sem isso, a medição «listar não devolve o cifrado» passaria
      // por acidente ou reprovaria por acidente — em ambos os casos mediria o dublê, não o código.
      async findMany({ where, select }) {
        const achadas = [...linhas.values()].filter((l) => l.tenantId === where.tenantId);
        if (!select) return achadas;
        return achadas.map((l) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, l[k] ?? null])));
      },
      async delete({ where }) {
        const chave = k(where.tenantId_apelido);
        if (!linhas.has(chave)) throw new Error('não existe');
        linhas.delete(chave); return true;
      },
    },
  };
}

console.log('\nA CREDENCIAL DO CANAL — cofre, resolvedor, envio nativo e o toque do Telegram\n');
console.log('1) O COFRE — guarda cifrado, devolve em claro, e NUNCA publica o valor');

const banco = bancoDeCofre();
cofre.configurarSegredos({ db: banco, log: semLog });

await medir('guardar cifra de verdade: o valor NÃO aparece no que foi para o banco', async () => {
  const r = await cofre.guardar({ tenantId: 't1', apelido: 'canal_instagram_token', valor: 'IG-TOKEN-SECRETO' });
  assert.equal(r.novo, true);
  assert.match(r.fingerprint, /^sha256:[0-9a-f]{16}$/u);
  assert.equal(r.valor, undefined, 'guardar devolveu o valor — nunca pode');
  const gravada = banco.linhas.get('t1|canal_instagram_token');
  assert.doesNotMatch(gravada.valorCifrado, /IG-TOKEN-SECRETO/u, 'foi gravado em claro');
  assert.match(gravada.valorCifrado, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/u, 'não é o formato iv:tag:cifrado da casa');
});

await medir('ler devolve o valor em claro — e só para quem chama pelo servidor', async () => {
  const s = await cofre.ler({ tenantId: 't1', apelido: 'canal_instagram_token' });
  assert.equal(s.valor, 'IG-TOKEN-SECRETO');
  assert.match(s.fingerprint, /^sha256:/u);
});

await medir('⭐ o valor é NÃO-ENUMERÁVEL: JSON.stringify e console.log não o publicam', async () => {
  const s = await cofre.ler({ tenantId: 't1', apelido: 'canal_instagram_token' });
  assert.doesNotMatch(JSON.stringify(s), /IG-TOKEN-SECRETO/u, 'vazou num JSON.stringify');
  assert.doesNotMatch(util.inspect(s), /IG-TOKEN-SECRETO/u, 'vazou num console.log');
  assert.doesNotMatch(JSON.stringify({ credencial: s }), /IG-TOKEN-SECRETO/u, 'vazou aninhado num corpo de resposta');
  // ...e continua ACESSÍVEL por quem sabe o que quer. Esconder de verdade seria inútil.
  assert.equal(s.valor, 'IG-TOKEN-SECRETO');
});

await medir('listar é o que uma TELA pode ver: apelido e digital, zero valor cifrado', async () => {
  const l = await cofre.listar({ tenantId: 't1' });
  assert.equal(l.length, 1);
  assert.equal(l[0].apelido, 'canal_instagram_token');
  assert.equal(l[0].valorCifrado, undefined, 'o cifrado saiu na listagem — é material para ataque offline');
  assert.doesNotMatch(JSON.stringify(l), /IG-TOKEN-SECRETO/u);
});

await medir('isolamento: o mesmo apelido em OUTRA empresa é outro segredo', async () => {
  await cofre.guardar({ tenantId: 't2', apelido: 'canal_instagram_token', valor: 'TOKEN-DA-EMPRESA-2' });
  assert.equal((await cofre.ler({ tenantId: 't1', apelido: 'canal_instagram_token' })).valor, 'IG-TOKEN-SECRETO');
  assert.equal((await cofre.ler({ tenantId: 't2', apelido: 'canal_instagram_token' })).valor, 'TOKEN-DA-EMPRESA-2');
  assert.equal(await cofre.ler({ tenantId: 't3', apelido: 'canal_instagram_token' }), null,
    'empresa sem o segredo recebeu o de outra — é o defeito que a chave composta existe para impedir');
});

await medir('rotação só carimba quando o valor MUDA — reescrever igual não é rotação', async () => {
  const igual = await cofre.guardar({ tenantId: 't1', apelido: 'canal_instagram_token', valor: 'IG-TOKEN-SECRETO' });
  assert.equal(igual.rotacionado, false);
  const nova = await cofre.guardar({ tenantId: 't1', apelido: 'canal_instagram_token', valor: 'IG-TOKEN-NOVO' });
  assert.equal(nova.rotacionado, true);
  assert.ok(nova.rotacionadoEm instanceof Date);
  assert.notEqual(igual.fingerprint, nova.fingerprint, 'a digital tem de MOSTRAR que trocou');
  await cofre.guardar({ tenantId: 't1', apelido: 'canal_instagram_token', valor: 'IG-TOKEN-SECRETO' });
});

await medir('apelido inválido e valor vazio são recusados na entrada', async () => {
  await assert.rejects(() => cofre.guardar({ tenantId: 't1', apelido: 'com espaço', valor: 'x' }), /apelido/u);
  await assert.rejects(() => cofre.guardar({ tenantId: 't1', apelido: 'ok', valor: '' }), /vazio/u);
  await assert.rejects(() => cofre.guardar({ apelido: 'ok', valor: 'x' }), /empresa/u);
});

await medir('segredo que não ABRE devolve null com o diagnóstico certo — e não derruba nada', async () => {
  const escrito = [];
  cofre.configurarSegredos({ log: { ...semLog, error: (m) => escrito.push(String(m)) } });
  banco.linhas.set('t1|quebrado', {
    id: 'sx', tenantId: 't1', apelido: 'quebrado', valorCifrado: 'aa:bb:cc', fingerprint: 'sha256:0', descricao: null,
  });
  assert.equal(await cofre.ler({ tenantId: 't1', apelido: 'quebrado' }), null);
  assert.ok(escrito.some((l) => /ENCRYPTION_KEY/u.test(l)),
    '«Unsupported state or unable to authenticate data» não diz nada a ninguém no meio de um atendimento');
  cofre.configurarSegredos({ log: semLog });
});

await medir('resolver(tenantId, apelido) — a forma que o motor de fluxo espera — falha FECHADO', async () => {
  assert.equal(await cofre.resolver('t1', 'canal_instagram_token'), 'IG-TOKEN-SECRETO');
  await assert.rejects(() => cofre.resolver('t1', 'nao_existe'), /não existe nesta empresa/u,
    'devolver string vazia mandaria a requisição SEM credencial e o 401 do outro lado seria ilegível');
  assert.deepEqual((await cofre.apelidosDaEmpresa('t2')), ['canal_instagram_token']);
});

console.log('\n2) O RESOLVEDOR — a ordem da busca, degrau por degrau');

/** Um banco de conexões (`RagnabotInbox`) de mentira, somado ao cofre. */
function bancoCompleto(conexoes = []) {
  return {
    ...banco,
    ragnabotInbox: {
      async findFirst({ where }) {
        return conexoes.find((c) => c.tenantId === where.tenantId && c.cwInboxId === where.cwInboxId) ?? null;
      },
    },
  };
}

function armar({ conexoes = [], ambiente = {}, buscar = null, log = semLog } = {}) {
  resolvedor.esquecerCredenciais();
  resolvedor.configurarCredenciais({ db: bancoCompleto(conexoes), cofre, ambiente, buscar, log });
}

await medir('degrau 1 vence: o apelido da CONEXÃO ganha do convencional da empresa', async () => {
  await cofre.guardar({ tenantId: 't1', apelido: 'perfil_secundario', valor: 'TOKEN-DO-PERFIL-2' });
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 36, provedorConfig: { segredoApelido: 'perfil_secundario' }, metadata: null }] });
  const c = await resolvedor.doCanal({ tenantId: 't1', cwInboxId: 36, canal: 'instagram' });
  assert.equal(c.token, 'TOKEN-DO-PERFIL-2');
  assert.equal(c.origem, 'cofre:conexao:perfil_secundario');
});

await medir('degrau 2: sem apelido na conexão, vale `canal_<canal>_token` da empresa', async () => {
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 36, provedorConfig: null, metadata: null }] });
  const c = await resolvedor.doCanal({ tenantId: 't1', cwInboxId: 36, canal: 'instagram' });
  assert.equal(c.token, 'IG-TOKEN-SECRETO');
  assert.equal(c.origem, 'cofre:canal_instagram_token');
});

await medir('⭐ degrau 3 — o PONTO DE TROCA: um token só de mensagens no ambiente e pronto', async () => {
  // É esta a promessa feita ao dono: trocar o token de sistema (que também publica) por um token
  // restrito a mensagens é UMA variável no Secret. Nenhuma linha de código muda.
  armar({
    conexoes: [{ tenantId: 't9', cwInboxId: 36, provedorConfig: null, metadata: null }],
    ambiente: { RAGNABOT_CANAL_INSTAGRAM_TOKEN: 'TOKEN-SO-DE-MENSAGENS' },
  });
  const c = await resolvedor.doCanal({ tenantId: 't9', cwInboxId: 36, canal: 'instagram' });
  assert.equal(c.token, 'TOKEN-SO-DE-MENSAGENS');
  assert.equal(c.origem, 'ambiente:RAGNABOT_CANAL_INSTAGRAM_TOKEN');
});

await medir('degrau 3 vence o 4: com token direto, a Graph API NEM É CONSULTADA', async () => {
  let idas = 0;
  armar({
    conexoes: [],
    ambiente: {
      RAGNABOT_CANAL_INSTAGRAM_TOKEN: 'TOKEN-DIRETO',
      RAGNABOT_META_TOKEN_SISTEMA: 'TOKEN-DE-SISTEMA', RAGNABOT_META_PAGINA_ID: '101726462586673',
    },
    buscar: async () => { idas += 1; return { ok: true, status: 200, async json() { return { access_token: 'X' }; } }; },
  });
  const c = await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' });
  assert.equal(c.token, 'TOKEN-DIRETO');
  assert.equal(idas, 0, 'gastou uma ida à Meta tendo o token na mão');
});

await medir('⭐ degrau 4: o token de SISTEMA vira token da PÁGINA, com o endereço do sabor certo', async () => {
  const idas = [];
  armar({
    conexoes: [],
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'TOKEN-DE-SISTEMA', RAGNABOT_META_PAGINA_ID: '101726462586673' },
    buscar: async (url) => {
      idas.push(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: '101726462586673', access_token: 'TOKEN-DA-PAGINA', instagram_business_account: { id: '17841453478471563' } };
        },
      };
    },
  });
  const c = await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' });
  assert.equal(c.token, 'TOKEN-DA-PAGINA');
  assert.equal(c.origem, 'derivada:token_de_sistema');
  // ⭐ O ENDEREÇO. Token de Página fala com graph.facebook.com e com a conta no caminho — mandá-lo
  // para graph.instagram.com devolve erro que PARECE «token inválido».
  assert.equal(c.base, 'https://graph.facebook.com');
  assert.equal(c.contaId, '17841453478471563');
  assert.equal(idas.length, 1);
  assert.match(idas[0], /\/101726462586673\?fields=access_token%2Cinstagram_business_account|\/101726462586673\?fields=access_token,instagram_business_account/u);
});

await medir('página SEM Instagram vinculado devolve a própria página como conta', async () => {
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999' },
    buscar: async () => ({ ok: true, status: 200, async json() { return { access_token: 'P' }; } }),
  });
  const c = await resolvedor.doCanal({ tenantId: 't9', canal: 'facebook' });
  assert.equal(c.contaId, '999');
});

await medir('Telegram NÃO deriva nada: sem token no cofre nem no ambiente, é null', async () => {
  armar({ ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999' } });
  assert.equal(await resolvedor.doCanal({ tenantId: 't9', canal: 'telegram' }), null,
    'o token de bot do Telegram não sai da Meta — inventar derivação aqui seria ficção');
});

await medir('a Meta recusando a derivação devolve null (e o envio degrada) — nunca estoura', async () => {
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999' },
    buscar: async () => ({ ok: false, status: 400, async json() { return { error: { message: 'Invalid OAuth token', code: 190 } }; } }),
  });
  assert.equal(await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' }), null);
});

await medir('rede caída na derivação também devolve null — o cliente não fica sem resposta', async () => {
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999' },
    buscar: async () => { throw new Error('socket hang up'); },
  });
  assert.equal(await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' }), null);
});

console.log('\n3) O CACHE — barato de acertar, caro de errar');

await medir('a segunda mensagem NÃO volta à Graph API: a credencial fica em cache', async () => {
  let idas = 0;
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999' },
    buscar: async () => { idas += 1; return { ok: true, status: 200, async json() { return { access_token: 'P' }; } }; },
  });
  await resolvedor.doCanal({ tenantId: 't9', cwInboxId: 36, canal: 'instagram' });
  await resolvedor.doCanal({ tenantId: 't9', cwInboxId: 36, canal: 'instagram' });
  await resolvedor.doCanal({ tenantId: 't9', cwInboxId: 36, canal: 'instagram' });
  assert.equal(idas, 1, 'cada mensagem com botão custaria uma ida à Meta antes de o cliente ver qualquer coisa');
});

await medir('⭐ o cache EXPIRA: revogar o token do outro lado vira erro em minutos, não nunca', async () => {
  let idas = 0;
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'S', RAGNABOT_META_PAGINA_ID: '999', RAGNABOT_CREDENCIAL_CACHE_MS: '25' },
    buscar: async () => { idas += 1; return { ok: true, status: 200, async json() { return { access_token: `P${idas}` }; } }; },
  });
  const a = await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' });
  await new Promise((r) => setTimeout(r, 45));
  const b = await resolvedor.doCanal({ tenantId: 't9', canal: 'instagram' });
  assert.equal(a.token, 'P1');
  assert.equal(b.token, 'P2', 'o cache não expirou — um token revogado ficaria servido para sempre');
  assert.equal(idas, 2);
});

await medir('⛔ FALHA NÃO ENTRA NO CACHE: o segredo cadastrado agora vale na próxima mensagem', async () => {
  armar({ conexoes: [{ tenantId: 't5', cwInboxId: 36, provedorConfig: null, metadata: null }] });
  assert.equal(await resolvedor.doCanal({ tenantId: 't5', cwInboxId: 36, canal: 'instagram' }), null);
  await cofre.guardar({ tenantId: 't5', apelido: 'canal_instagram_token', valor: 'CHEGOU-AGORA' });
  const c = await resolvedor.doCanal({ tenantId: 't5', cwInboxId: 36, canal: 'instagram' });
  assert.equal(c?.token, 'CHEGOU-AGORA',
    'guardar o «não achei» faria o dono cadastrar o token e ver o robô mandando texto por meia hora');
});

await medir('o cache é por EMPRESA e por CONEXÃO — nunca serve o token de um a outro', async () => {
  armar({
    conexoes: [
      { tenantId: 't1', cwInboxId: 36, provedorConfig: null, metadata: null },
      { tenantId: 't2', cwInboxId: 36, provedorConfig: null, metadata: null },
    ],
  });
  const a = await resolvedor.doCanal({ tenantId: 't1', cwInboxId: 36, canal: 'instagram' });
  const b = await resolvedor.doCanal({ tenantId: 't2', cwInboxId: 36, canal: 'instagram' });
  assert.equal(a.token, 'IG-TOKEN-SECRETO');
  assert.equal(b.token, 'TOKEN-DA-EMPRESA-2');
});

await medir('nem o retorno, nem o diagnóstico do cache carregam o token', async () => {
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 36, provedorConfig: null, metadata: null }] });
  const c = await resolvedor.doCanal({ tenantId: 't1', cwInboxId: 36, canal: 'instagram' });
  assert.doesNotMatch(JSON.stringify(c), /IG-TOKEN-SECRETO/u, 'o token vazou num JSON.stringify da credencial');
  assert.doesNotMatch(util.inspect(c), /IG-TOKEN-SECRETO/u, 'o token vazou num console.log da credencial');
  assert.doesNotMatch(JSON.stringify(resolvedor.estadoDoCache()), /IG-TOKEN-SECRETO/u, 'o token vazou pelo /saude');
  assert.match(c.fingerprint, /^sha256:[0-9a-f]{16}$/u, 'a digital é o que se confere num deploy');
});

console.log('\n4) O QUE ISSO LIGA — a escolha no Instagram deixa de degradar');

const ALVO = { id: 'exec-1', tenantId: 't1', cwAccountId: 5, cwConversationId: 900 };
const bancoVazio = { ragnabotFluxoEfeito: { async findUnique() { return null; } } };
const itens = (n) => Array.from({ length: n }, (_, i) => ({ id: `op${i + 1}`, titulo: `Opção ${i + 1}` }));

function dubleDoChatwoot() {
  const registro = { mensagens: [], interativos: [] };
  return {
    registro,
    async caixaDaConversa() { return { tenantId: 't1', cwInboxId: 36, channelType: 'instagram', nome: 'Instagram-Ragnatela' }; },
    async origemDoContato() { return { sourceId: 'IGSID-777', cwInboxId: 36, cwContactId: 12 }; },
    async enviarMensagem(d) { registro.mensagens.push(d); return { ok: true, id: 100 + registro.mensagens.length }; },
    async enviarInterativo(d) { registro.interativos.push(d); return { ok: true, id: 200 }; },
    async lerConversa() { return { id: 900, cwInboxId: 36, status: 'open' }; },
  };
}

await medir('SEM o resolvedor amarrado, a escolha degrada declarando (a rede continua de pé)', async () => {
  canal.esquecerEnvios(); canal.esquecerCanais();
  nativo.configurarCanalNativo({ credenciais: null, buscar: null, log: semLog });
  const cw = dubleDoChatwoot();
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: semLog, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  const r = await porta.enviar({ tipo: 'lista', corpo: 'Escolha:', itens: itens(2), chaveEfeito: 'sem-cred' }, {});
  assert.equal(r.motivoDegradacao, 'nativo_indisponivel:SEM_CREDENCIAL');
  assert.equal(cw.registro.mensagens.length, 1, 'a mensagem não pode se perder');
});

await medir('⭐ COM o resolvedor amarrado, a MESMA escolha sai NATIVA — e no endereço do sabor certo', async () => {
  const chamadas = [];
  // Sem o segredo da empresa no cofre, a resolução chega ao degrau 4 (token de sistema → token da
  // Página) — que é justamente o caso de hoje em produção e o que decide o ENDEREÇO da chamada.
  await cofre.remover({ tenantId: 't1', apelido: 'canal_instagram_token' });
  armar({
    ambiente: { RAGNABOT_META_TOKEN_SISTEMA: 'TOKEN-DE-SISTEMA', RAGNABOT_META_PAGINA_ID: '101726462586673' },
    buscar: async () => ({
      ok: true,
      status: 200,
      async json() { return { access_token: 'TOKEN-DA-PAGINA', instagram_business_account: { id: '17841453478471563' } }; },
    }),
  });
  canal.esquecerEnvios(); canal.esquecerCanais();
  nativo.configurarCanalNativo({
    log: semLog,
    credenciais: resolvedor, // ← é ISTO que `servidor.js` amarra
    async buscar(url, opcoes) {
      chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
      return { ok: true, status: 200, async json() { return { message_id: 'mid-real' }; } };
    },
  });
  assert.equal(nativo.nativoDisponivel('instagram'), true, 'a porta continua se declarando indisponível');

  const cw = dubleDoChatwoot();
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: semLog, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  const r = await porta.enviar({ tipo: 'lista', corpo: 'Escolha:', itens: itens(2), chaveEfeito: 'com-cred' }, {});

  assert.equal(r.degradado, undefined, 'ainda está caindo no texto numerado');
  assert.equal(r.nativo, 'instagram');
  assert.equal(r.idExterno, 'mid-real');
  assert.equal(r.registrado, true, 'o atendente precisa VER o que o robô falou com o cliente');
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url,
    /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/17841453478471563\/messages\?access_token=/u,
    'token de Página mandado para graph.instagram.com devolve erro que PARECE «token inválido»');
  assert.equal(chamadas[0].corpo.message.quick_replies.length, 2);
  assert.equal(cw.registro.mensagens[0].sourceId, 'mid-real', 'sem o source_id a plataforma manda de novo');
});

await medir('a degradação CONTINUA existindo se a credencial sumir depois', async () => {
  // Nada no cofre, nada no ambiente: é o cenário «revogaram o token» e o «ainda não cadastraram».
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 36, provedorConfig: null, metadata: null }] });
  await cofre.remover({ tenantId: 't1', apelido: 'canal_instagram_token' });
  resolvedor.esquecerCredenciais();
  canal.esquecerEnvios(); canal.esquecerCanais();
  nativo.configurarCanalNativo({ log: semLog, credenciais: resolvedor, buscar: async () => { throw new Error('não devia chegar aqui'); } });
  const cw = dubleDoChatwoot();
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: semLog, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  const r = await porta.enviar({ tipo: 'lista', corpo: 'Escolha:', itens: itens(2), chaveEfeito: 'sumiu' }, {});
  assert.equal(r.motivoDegradacao, 'nativo_indisponivel:SEM_CREDENCIAL');
  assert.equal(cw.registro.mensagens.length, 1);
  await cofre.guardar({ tenantId: 't1', apelido: 'canal_instagram_token', valor: 'IG-TOKEN-SECRETO' });
});

await medir('o token NUNCA aparece no log, nem quando o canal recusa', async () => {
  const escrito = [];
  const espiao = { info: (m) => escrito.push(String(m)), warn: (m) => escrito.push(String(m)), error: (m) => escrito.push(String(m)), debug() {} };
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 36, provedorConfig: null, metadata: null }], log: espiao });
  canal.esquecerEnvios(); canal.esquecerCanais();
  nativo.configurarCanalNativo({
    log: espiao, credenciais: resolvedor,
    async buscar() { return { ok: false, status: 401, async json() { return { error: { message: 'bad token', code: 190 } }; } }; },
  });
  const cw = dubleDoChatwoot();
  canal.configurarCanal({ chatwoot: cw, db: bancoVazio, log: espiao, nativo });
  const porta = await canal.portaCanalDa(ALVO);
  const r = await porta.enviar({ tipo: 'lista', corpo: 'x', itens: itens(2), chaveEfeito: 'log' }, {});
  assert.doesNotMatch(escrito.join('\n'), /IG-TOKEN-SECRETO/u, 'o token vazou no diário do cluster');
  assert.doesNotMatch(JSON.stringify(r), /IG-TOKEN-SECRETO/u);
  assert.equal(r.motivoDegradacao, 'nativo_indisponivel:CANAL_RECUSOU');
});

console.log('\n5) O TOQUE NO BOTÃO DO TELEGRAM — answerCallbackQuery ligado ao webhook');

const eventoDeToque = (extra = {}) => ({
  event: 'message_created',
  account: { id: 5 },
  conversation: { id: 900, inbox_id: 7 },
  inbox: { id: 7, channel_type: 'Channel::Telegram' },
  id: 4242,
  message_type: 'incoming',
  content: 'op-financeiro',
  source_id: '4382188923457812345',
  sender: { id: 12, type: 'contact' },
  ...extra,
});

await medir('a regra que reconhece o toque: canal, tipo, e o TAMANHO do identificador', () => {
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque()).ehToque, true);
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque()).callbackQueryId, '4382188923457812345');
  // mensagem digitada: `message_id` é um contador por conversa, curto
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque({ source_id: '1204' })).motivo, 'source_id_curto_demais');
  // outro canal não tem callback_query nenhum
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque({ inbox: { id: 7, channel_type: 'Channel::Whatsapp' } })).motivo,
    'canal_nao_telegram');
  // saída nossa e nota interna nunca são toque
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque({ message_type: 'outgoing' })).motivo, 'mensagem_nao_e_entrada');
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque({ private: true })).motivo, 'nota_interna');
  // o `source_id` do WhatsApp é `wamid.HBg…`, não numérico
  assert.equal(webhook.pareceToqueDeBotao(eventoDeToque({ source_id: 'wamid.HBgNNTU5OD' })).motivo, 'source_id_nao_numerico');
});

await medir('⭐ o clique DISPARA answerCallbackQuery com o token do bot vindo do cofre', async () => {
  await cofre.guardar({ tenantId: 't1', apelido: 'canal_telegram_token', valor: '123456:BOT-TOKEN-FALSO' });
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 7, provedorConfig: null, metadata: null }] });
  const chamadas = [];
  nativo.configurarCanalNativo({
    log: semLog, credenciais: resolvedor,
    async buscar(url, opcoes) { chamadas.push({ url, corpo: JSON.parse(opcoes.body) }); return { ok: true, status: 200, async json() { return { ok: true, result: true }; } }; },
  });
  webhook.configurarWebhook({ canalNativo: nativo, log: semLog });

  const r = await webhook.responderToqueDoTelegram(eventoDeToque(), { cwInboxId: 7 }, { id: 't1' });
  assert.equal(r.respondido, true, 'sem isto a barrinha fica girando no aparelho do cliente');
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/answerCallbackQuery$/u);
  assert.equal(chamadas[0].corpo.callback_query_id, '4382188923457812345');
  // ⛔ o token do bot viaja no CAMINHO da URL do Telegram — nunca pode ir para o log
  assert.doesNotMatch(JSON.stringify(r), /BOT-TOKEN-FALSO/u);
});

await medir('mensagem digitada NÃO gasta chamada — a regra tem de saber dizer não', async () => {
  const chamadas = [];
  nativo.configurarCanalNativo({ log: semLog, credenciais: resolvedor, async buscar(u) { chamadas.push(u); return { ok: true, status: 200, async json() { return { ok: true }; } }; } });
  const r = await webhook.responderToqueDoTelegram(eventoDeToque({ source_id: '87' }), { cwInboxId: 7 }, { id: 't1' });
  assert.equal(r.respondido, false);
  assert.equal(r.motivo, 'source_id_curto_demais');
  assert.equal(chamadas.length, 0);
});

await medir('sem token de bot, o toque não é respondido — e NADA disso derruba o webhook', async () => {
  await cofre.remover({ tenantId: 't1', apelido: 'canal_telegram_token' });
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 7, provedorConfig: null, metadata: null }] });
  nativo.configurarCanalNativo({ log: semLog, credenciais: resolvedor, buscar: null });
  const r = await webhook.responderToqueDoTelegram(eventoDeToque(), { cwInboxId: 7 }, { id: 't1' });
  assert.equal(r.respondido, false);
  assert.equal(r.motivo, 'SEM_CREDENCIAL', 'a recusa tem de vir com CÓDIGO, para o contador separar as causas');
});

await medir('o Telegram recusando o id (heurística errada) é INOFENSIVO — conta e segue', async () => {
  await cofre.guardar({ tenantId: 't1', apelido: 'canal_telegram_token', valor: '123456:BOT' });
  armar({ conexoes: [{ tenantId: 't1', cwInboxId: 7, provedorConfig: null, metadata: null }] });
  nativo.configurarCanalNativo({
    log: semLog, credenciais: resolvedor,
    async buscar() { return { ok: false, status: 400, async json() { return { ok: false, error_code: 400, description: 'query ID is invalid' }; } }; },
  });
  const antes = webhook.estatisticasDoWebhook().toquesNaoRespondidos;
  const r = await webhook.responderToqueDoTelegram(eventoDeToque(), { cwInboxId: 7 }, { id: 't1' });
  assert.equal(r.respondido, false);
  assert.equal(r.motivo, 'CANAL_RECUSOU');
  assert.equal(webhook.estatisticasDoWebhook().toquesNaoRespondidos, antes + 1,
    'o /saude tem de conseguir mostrar quantos toques ficaram sem resposta');
});

await medir('a função NUNCA rejeita — é chamada sem `await` no caminho da mensagem do cliente', async () => {
  nativo.configurarCanalNativo({ log: semLog, credenciais: { doCanal() { throw new Error('explodi'); } }, buscar: null });
  const r = await webhook.responderToqueDoTelegram(eventoDeToque(), { cwInboxId: 7 }, { id: 't1' });
  assert.equal(r.respondido, false, 'uma exceção aqui viraria promessa rejeitada sem dono — o Node derruba o processo');
});

console.log('\n6) A AMARRAÇÃO NO PROCESSO — prova FRACA, e ela diz que é');

await medir('⚠️ servidor.js amarra a porta `credenciais` ao resolvedor (leitura do arquivo, não execução)', async () => {
  // Por que FRACA: `ligarTrabalhadores()` conecta no banco, e não há banco nesta bancada. O que dá
  // para provar aqui é que a amarração ESTÁ ESCRITA e no arquivo certo; que ela RODA, quem prova é
  // o `/saude` do pod (`trabalhadores.credencialDeCanal.amarrada`). Dizer que isto é prova forte
  // seria o tipo de teste que passa enquanto a produção está muda.
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(new URL('../src/servidor.js', import.meta.url), 'utf8');
  assert.match(fonte, /ragnabot-credencial-canal\.service\.js/u, 'o resolvedor não é importado por servidor.js');
  assert.match(fonte, /configurarCanalNativo\(\s*\{\s*credenciais\s*\}\s*\)/u,
    'a porta `credenciais` não é amarrada — o Instagram continuaria mandando texto numerado');
  assert.match(fonte, /credencialDeCanal\.amarrada = true/u, 'o /saude não teria como dizer se a porta subiu');
});

await medir('o webhook chama o respondedor do toque no caminho da mensagem, SEM `await`', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(new URL('../src/routes/ragnabot-webhook.routes.js', import.meta.url), 'utf8');
  assert.match(fonte, /responderToqueDoTelegram\(evt, c, tenant\)\.catch\(/u,
    'ou não é chamado, ou é chamado com await — e aí a mensagem do cliente espera pela API do Telegram');
});

// Deixa as portas como estavam, para não contaminar suíte vizinha rodada no mesmo processo.
nativo.configurarCanalNativo({ credenciais: null, buscar: null, log: null });
resolvedor.esquecerCredenciais();

console.log(`\n${falhas ? '❌' : '✅'} ${medicoes - falhas}/${medicoes} verificações passaram\n`);
process.exit(falhas ? 1 : 0);
