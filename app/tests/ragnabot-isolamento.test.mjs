#!/usr/bin/env node
// =============================================================================
// PROVA DE ISOLAMENTO MULTI-EMPRESA DO RAGNABOT
//
// POR QUE ESTE ARQUIVO EXISTE: o sistema antigo (Whaticket) VAZAVA ticket entre
// empresas. Antes de qualquer cliente real entrar no Ragnabot, alguém precisa
// PROVAR, com requisição de verdade, que um atendente da empresa A não enxerga
// conversa, contato, caixa de entrada nem relatório da empresa B. Enquanto esta
// prova não estiver verde, nenhuma empresa real é provisionada.
//
// COMO RODAR (na VM do NOC, com o token do Platform App no ambiente):
//     RAGNABOT_ISOLAMENTO_E2E=1 node tests/ragnabot-isolamento.test.mjs
//
// Variáveis:
//   RAGNABOT_ISOLAMENTO_E2E=1     obrigatória — sem ela o teste NÃO roda (sai 2)
//   RAGNABOT_PLATFORM_TOKEN=…     token do Platform App
//   RAGNABOT_BASE_URL=…           padrão https://chat002.ragnatela.com.br
//   RAGNABOT_PROXY_IP=…           IP do proxy interno (contorna o hairpin NAT)
//   RAGNABOT_ISOLAMENTO_MANTER=1  não apaga as empresas de teste no fim
//
// CÓDIGOS DE SAÍDA — o silêncio aqui seria pior que a falha:
//   0 = isolamento PROVADO      1 = VAZAMENTO ou falha de asserção
//   2 = não pôde executar (falta configuração)   3 = erro inesperado
//
// ⚠️ ESTE ARQUIVO NÃO ENTRA NA SUÍTE DO VITEST DE PROPÓSITO. O `include` do
// vitest.config.js é só `tests/**/*.test.js`, justamente porque script com
// `process.exit` derruba o corredor. A lógica pura de veredito é EXPORTADA
// daqui e coberta por `tests/unit/ragnabot-isolamento.test.js`, que roda na
// suíte. Esta parte E2E cria contas de verdade e é executada à mão, sob
// supervisão, como prova de aceite.
//
// NOC 2026-08-28.
// =============================================================================
import https from 'node:https';
import { pathToFileURL } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1 — lógica pura de veredito (exportada, testada na suíte)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifica a resposta de uma sonda que tentou acessar a empresa ALHEIA.
 *
 * REGRA: a única resposta aceitável é uma NEGATIVA (401/403/404). Um 200 já é
 * defeito de isolamento, mesmo que o corpo venha vazio — significa que a
 * plataforma reconheceu o pedido de um estranho como legítimo, e a próxima
 * versão pode passar a devolver conteúdo. Se além do 200 o corpo trouxer um
 * marcador da outra empresa, é VAZAMENTO consumado.
 *
 * @param {number} status        HTTP devolvido
 * @param {string} corpo         corpo bruto da resposta
 * @param {string[]} marcadores  textos que SÓ existem na empresa alheia
 * @returns {{veredito:'bloqueado'|'suspeito'|'vazamento', achados:string[], motivo:string}}
 */
export function classificarSonda(status, corpo, marcadores = []) {
  const texto = String(corpo ?? '');
  const achados = marcadores.filter((m) => m && texto.includes(String(m)));

  if (achados.length) {
    return {
      veredito: 'vazamento',
      achados,
      motivo: `A resposta (${status}) contém dado da outra empresa: ${achados.join(', ')}`,
    };
  }
  if (status >= 200 && status < 300) {
    return {
      veredito: 'suspeito',
      achados: [],
      motivo: `A plataforma respondeu ${status} para um pedido feito por quem não pertence à conta. O esperado é 401, 403 ou 404.`,
    };
  }
  if ([401, 403, 404].includes(status)) {
    return { veredito: 'bloqueado', achados: [], motivo: `Negado com ${status}, como deve ser.` };
  }
  // 5xx, 429 e afins: não provam nada. Não podemos chamar de aprovado.
  return {
    veredito: 'suspeito',
    achados: [],
    motivo: `Resposta ${status} não prova bloqueio nem vazamento — a sonda precisa ser repetida com a plataforma saudável.`,
  };
}

/** Uma sonda passa apenas quando o veredito é "bloqueado". */
export function sondaAprovada(resultado) {
  return resultado?.veredito === 'bloqueado';
}

/**
 * Confere que a listagem PRÓPRIA de um atendente não traz nada da outra empresa.
 * Aqui o esperado é 200 — o que não pode aparecer é marcador alheio.
 */
export function classificarListagemPropria(status, corpo, marcadoresAlheios = []) {
  const texto = String(corpo ?? '');
  const achados = marcadoresAlheios.filter((m) => m && texto.includes(String(m)));
  if (achados.length) {
    return { veredito: 'vazamento', achados, motivo: `A própria listagem trouxe dado da outra empresa: ${achados.join(', ')}` };
  }
  if (status >= 200 && status < 300) return { veredito: 'bloqueado', achados: [], motivo: 'Listagem própria limpa.' };
  return { veredito: 'suspeito', achados: [], motivo: `Não consegui ler a listagem própria (${status}) — sem isso não há prova.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 2 — arreio de execução (E2E)
// ─────────────────────────────────────────────────────────────────────────────

const URL_PUBLICA = process.env.RAGNABOT_BASE_URL || 'https://chat002.ragnatela.com.br';
const IP_PROXY = process.env.RAGNABOT_PROXY_IP || '';
const HOSTNAME = new URL(URL_PUBLICA).hostname;
const TOKEN_PLATAFORMA = (process.env.RAGNABOT_PLATFORM_TOKEN || '').trim();
const MANTER = process.env.RAGNABOT_ISOLAMENTO_MANTER === '1';

// ⚠️ NÃO usar o `fetch` global aqui. O undici ignora a opção `agent`, e sem
// `servername` a conexão ao IP do proxy iria com o SNI errado — ou o TLS falha,
// ou (pior) alguém "conserta" desligando a verificação do certificado. Com
// `https.request` o SNI e a validação do certificado usam o nome real do site,
// exatamente como o `curl --resolve` que a casa já usa para validar domínio.
function pedir(caminho, { metodo = 'GET', token = TOKEN_PLATAFORMA, corpo = null } = {}) {
  const dados = corpo ? JSON.stringify(corpo) : null;
  const opcoes = {
    host: IP_PROXY || HOSTNAME,
    port: 443,
    path: caminho,
    method: metodo,
    servername: HOSTNAME, // SNI e validação do certificado pelo nome público
    headers: {
      Host: HOSTNAME,
      api_access_token: token,
      Accept: 'application/json',
      ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
    },
    timeout: 25_000,
  };
  return new Promise((resolver, rejeitar) => {
    const req = https.request(opcoes, (resp) => {
      let texto = '';
      resp.setEncoding('utf8');
      resp.on('data', (p) => { texto += p; });
      resp.on('end', () => {
        let json = null;
        try { json = JSON.parse(texto); } catch { /* corpo não-JSON é normal em erro */ }
        resolver({ status: resp.statusCode, texto, json });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('tempo esgotado')); });
    req.on('error', (e) => rejeitar(new Error(`Falha de rede em ${metodo} ${caminho}: ${e.message}`)));
    if (dados) req.write(dados);
    req.end();
  });
}

async function exigir2xx(caminho, opcoes = {}) {
  const r = await pedir(caminho, opcoes);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Preparação falhou: ${opcoes.metodo || 'GET'} ${caminho} devolveu ${r.status} — ${r.texto.slice(0, 300)}`);
  }
  return r.json ?? {};
}

const registro = [];
let houveFalha = false;

function anotar(nome, resultado) {
  const ok = sondaAprovada(resultado);
  if (!ok) houveFalha = true;
  registro.push({ nome, ...resultado, ok });
  const marca = ok ? '  ok  ' : resultado.veredito === 'vazamento' ? ' VAZOU' : ' FALHA';
  console.log(`[${marca}] ${nome} — ${resultado.motivo}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 3 — preparação: duas empresas descartáveis
// ─────────────────────────────────────────────────────────────────────────────

const carimbo = Date.now().toString(36);
const criados = { contas: [], usuarios: [] };

async function criarEmpresaDeTeste(letra) {
  const nome = `ZZ-TESTE-ISOLAMENTO-${letra}-${carimbo}`;
  const email = `isolamento.${letra.toLowerCase()}.${carimbo}@teste.invalid`;

  const conta = await exigir2xx('/platform/api/v1/accounts', {
    metodo: 'POST', corpo: { name: nome, locale: 'pt_BR' },
  });
  criados.contas.push(conta.id);

  const usuario = await exigir2xx('/platform/api/v1/users', {
    metodo: 'POST',
    corpo: {
      name: `Atendente ${letra} ${carimbo}`,
      email,
      // Senha descartável, só existe durante o teste. A conta é apagada no fim.
      password: `Teste-${carimbo}-${letra}!aA9`,
    },
  });
  criados.usuarios.push(usuario.id);

  await exigir2xx(`/platform/api/v1/accounts/${conta.id}/account_users`, {
    metodo: 'POST', corpo: { user_id: usuario.id, role: 'administrator' },
  });

  // O token do usuário é buscado ao vivo: é ele que representa "o atendente".
  const detalhe = await exigir2xx(`/platform/api/v1/users/${usuario.id}`);
  const token = detalhe.access_token;
  if (!token) throw new Error(`A plataforma não devolveu o access_token do usuário ${usuario.id} — sem ele não há como simular o atendente.`);

  // Caixa de entrada de webchat: não depende da Meta, não custa nada.
  const caixa = await exigir2xx(`/api/v1/accounts/${conta.id}/inboxes`, {
    metodo: 'POST', token,
    corpo: {
      name: `Webchat ${letra} ${carimbo}`,
      channel: { type: 'web_widget', website_url: `https://exemplo-${letra.toLowerCase()}-${carimbo}.invalid` },
    },
  });

  return { letra, nome, email, contaId: conta.id, usuarioId: usuario.id, token, caixaId: caixa.id };
}

/** Cria contato + conversa + mensagem, e tenta transformar em conversa de grupo. */
async function semearConversa(empresa) {
  const nomeContato = `Contato-${empresa.letra}-${carimbo}`;
  const identificador = `contato-${empresa.letra.toLowerCase()}-${carimbo}`;

  const contato = await exigir2xx(`/api/v1/accounts/${empresa.contaId}/contacts`, {
    metodo: 'POST', token: empresa.token,
    corpo: { name: nomeContato, identifier: identificador, email: `${identificador}@teste.invalid` },
  });
  const contatoId = contato?.payload?.contact?.id ?? contato?.payload?.id ?? contato?.id;
  if (!contatoId) throw new Error(`Não consegui criar contato na empresa ${empresa.letra}.`);

  const conversa = await exigir2xx(`/api/v1/accounts/${empresa.contaId}/conversations`, {
    metodo: 'POST', token: empresa.token,
    corpo: { source_id: identificador, inbox_id: empresa.caixaId, contact_id: contatoId },
  });
  const conversaId = conversa?.id ?? conversa?.payload?.id;
  if (!conversaId) throw new Error(`Não consegui criar conversa na empresa ${empresa.letra}.`);

  const segredo = `SEGREDO-${empresa.letra}-${carimbo}`;
  await exigir2xx(`/api/v1/accounts/${empresa.contaId}/conversations/${conversaId}/messages`, {
    metodo: 'POST', token: empresa.token,
    corpo: { content: `Mensagem confidencial da empresa ${empresa.letra}: ${segredo}`, message_type: 'outgoing' },
  });

  // "Conversa de grupo": no Chatwoot o equivalente é a conversa com vários
  // PARTICIPANTES. Se a versão instalada não expuser o endpoint, seguimos sem
  // ele — mas registramos, porque o pedido do dono cita conversa de grupo.
  let grupo = false;
  const r = await pedir(`/api/v1/accounts/${empresa.contaId}/conversations/${conversaId}/participants`, {
    metodo: 'POST', token: empresa.token, corpo: { user_ids: [empresa.usuarioId] },
  });
  if (r.status >= 200 && r.status < 300) grupo = true;

  return { contatoId, conversaId, nomeContato, identificador, segredo, grupo };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 4 — as sondas
// ─────────────────────────────────────────────────────────────────────────────

/** Tudo que só pode existir dentro da empresa alvo. */
function marcadoresDe(empresa, dados) {
  return [dados.segredo, dados.nomeContato, dados.identificador, empresa.nome, empresa.email];
}

async function sondarCruzado(intruso, alvo, dadosDoAlvo) {
  const marcadores = marcadoresDe(alvo, dadosDoAlvo);
  const conta = alvo.contaId;
  const sondas = [
    ['detalhe da conta alheia', `/api/v1/accounts/${conta}`],
    ['lista de conversas alheias', `/api/v1/accounts/${conta}/conversations`],
    ['conversa alheia pelo id', `/api/v1/accounts/${conta}/conversations/${dadosDoAlvo.conversaId}`],
    ['mensagens da conversa alheia', `/api/v1/accounts/${conta}/conversations/${dadosDoAlvo.conversaId}/messages`],
    ['participantes da conversa alheia (grupo)', `/api/v1/accounts/${conta}/conversations/${dadosDoAlvo.conversaId}/participants`],
    ['contadores de conversa alheios', `/api/v1/accounts/${conta}/conversations/meta`],
    ['lista de contatos alheios', `/api/v1/accounts/${conta}/contacts`],
    ['contato alheio pelo id', `/api/v1/accounts/${conta}/contacts/${dadosDoAlvo.contatoId}`],
    ['busca de contato alheio', `/api/v1/accounts/${conta}/contacts/search?q=${encodeURIComponent(dadosDoAlvo.nomeContato)}`],
    ['caixas de entrada alheias', `/api/v1/accounts/${conta}/inboxes`],
    ['atendentes alheios', `/api/v1/accounts/${conta}/agents`],
    ['relatório alheio (resumo)', `/api/v1/accounts/${conta}/reports/summary?type=account&since=0&until=9999999999`],
    ['relatório alheio (conversas)', `/api/v1/accounts/${conta}/reports/conversations?type=account`],
    ['times alheios', `/api/v1/accounts/${conta}/teams`],
    ['rótulos alheios', `/api/v1/accounts/${conta}/labels`],
    ['automações alheias', `/api/v1/accounts/${conta}/automation_rules`],
    ['webhooks alheios (roubo de fluxo)', `/api/v1/accounts/${conta}/webhooks`],
  ];

  for (const [nome, caminho] of sondas) {
    const r = await pedir(caminho, { token: intruso.token });
    anotar(`${intruso.letra} lendo ${nome}`, classificarSonda(r.status, r.texto, marcadores));
  }

  // ESCRITA é o pior caso: se passar, o intruso fala com o cliente do outro.
  const escrita = await pedir(`/api/v1/accounts/${conta}/conversations/${dadosDoAlvo.conversaId}/messages`, {
    metodo: 'POST', token: intruso.token,
    corpo: { content: `INVASÃO DE ${intruso.letra} — se esta mensagem aparecer na conversa, o isolamento está quebrado`, message_type: 'outgoing' },
  });
  anotar(`${intruso.letra} ESCREVENDO na conversa alheia`, classificarSonda(escrita.status, escrita.texto, marcadores));

  // Alteração de contato alheio.
  const alteracao = await pedir(`/api/v1/accounts/${conta}/contacts/${dadosDoAlvo.contatoId}`, {
    metodo: 'PATCH', token: intruso.token, corpo: { name: `sequestrado-por-${intruso.letra}` },
  });
  anotar(`${intruso.letra} ALTERANDO contato alheio`, classificarSonda(alteracao.status, alteracao.texto, marcadores));

  // A listagem PRÓPRIA do intruso não pode conter nada do alvo.
  const proprias = await pedir(`/api/v1/accounts/${intruso.contaId}/conversations`, { token: intruso.token });
  anotar(`lista própria de ${intruso.letra} não contém dado de ${alvo.letra}`,
    classificarListagemPropria(proprias.status, proprias.texto, marcadores));

  const contatosProprios = await pedir(`/api/v1/accounts/${intruso.contaId}/contacts`, { token: intruso.token });
  anotar(`contatos próprios de ${intruso.letra} não contêm contato de ${alvo.letra}`,
    classificarListagemPropria(contatosProprios.status, contatosProprios.texto, marcadores));

  // A busca dentro da própria conta não pode pescar do vizinho.
  const buscaPropria = await pedir(`/api/v1/accounts/${intruso.contaId}/contacts/search?q=${encodeURIComponent(dadosDoAlvo.nomeContato)}`, { token: intruso.token });
  anotar(`busca dentro da conta de ${intruso.letra} não acha contato de ${alvo.letra}`,
    classificarListagemPropria(buscaPropria.status, buscaPropria.texto, marcadores));
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 5 — limpeza
// ─────────────────────────────────────────────────────────────────────────────

async function limpar() {
  if (MANTER) {
    console.log(`\n⚠️  RAGNABOT_ISOLAMENTO_MANTER=1 — as contas de teste ${criados.contas.join(', ')} FICARAM na plataforma. Apague à mão depois.`);
    return;
  }
  for (const id of criados.usuarios) {
    const r = await pedir(`/platform/api/v1/users/${id}`, { metodo: 'DELETE' }).catch((e) => ({ status: 0, texto: e.message }));
    if (r.status < 200 || r.status >= 300) console.log(`⚠️  não apaguei o usuário de teste ${id} (${r.status}) — remova à mão.`);
  }
  for (const id of criados.contas) {
    const r = await pedir(`/platform/api/v1/accounts/${id}`, { metodo: 'DELETE' }).catch((e) => ({ status: 0, texto: e.message }));
    if (r.status < 200 || r.status >= 300) console.log(`⚠️  não apaguei a conta de teste ${id} (${r.status}) — remova à mão.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 6 — roteiro
// ─────────────────────────────────────────────────────────────────────────────

async function principal() {
  if (process.env.RAGNABOT_ISOLAMENTO_E2E !== '1') {
    console.error(
      'Este teste cria DUAS empresas de verdade na plataforma de atendimento e apaga no fim.\n' +
      'Ele não roda por acidente. Para executar:\n\n' +
      '  RAGNABOT_ISOLAMENTO_E2E=1 RAGNABOT_PLATFORM_TOKEN=… node tests/ragnabot-isolamento.test.mjs\n',
    );
    process.exit(2);
  }
  if (!TOKEN_PLATAFORMA) {
    console.error('RAGNABOT_PLATFORM_TOKEN não definido — sem o token do Platform App não há como criar as empresas de teste.');
    process.exit(2);
  }

  console.log(`\n═══ PROVA DE ISOLAMENTO MULTI-EMPRESA — ${URL_PUBLICA} ═══`);
  console.log(`Rota: ${IP_PROXY ? `proxy interno ${IP_PROXY} (Host/SNI ${HOSTNAME})` : 'direto pela URL pública'}`);
  console.log('Criando duas empresas descartáveis…\n');

  const A = await criarEmpresaDeTeste('A');
  const B = await criarEmpresaDeTeste('B');
  console.log(`Empresa A = conta ${A.contaId} · Empresa B = conta ${B.contaId}`);

  const dadosA = await semearConversa(A);
  const dadosB = await semearConversa(B);
  console.log(`Conversas semeadas (A#${dadosA.conversaId}, B#${dadosB.conversaId}) · participantes: ${dadosA.grupo ? 'sim' : 'endpoint indisponível nesta versão'}\n`);

  if (!dadosA.grupo) {
    console.log('⚠️  O endpoint de participantes não respondeu. A parte "conversa de grupo" ficou coberta apenas\n' +
      '    pela sonda de leitura dos participantes — registre isso no diário.\n');
  }

  console.log('── Empresa B tentando ver a empresa A ──');
  await sondarCruzado(B, A, dadosA);
  console.log('\n── Empresa A tentando ver a empresa B ──');
  await sondarCruzado(A, B, dadosB);

  // Prova extra: o token da PLATAFORMA não pode servir como token de atendente.
  const abuso = await pedir(`/api/v1/accounts/${A.contaId}/conversations`, { token: TOKEN_PLATAFORMA });
  anotar('token do Platform App usado como se fosse de atendente',
    classificarSonda(abuso.status, abuso.texto, marcadoresDe(A, dadosA)));

  await limpar();

  const falhas = registro.filter((r) => !r.ok);
  const vazamentos = falhas.filter((r) => r.veredito === 'vazamento');
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Sondas: ${registro.length} · aprovadas: ${registro.length - falhas.length} · reprovadas: ${falhas.length} · vazamentos: ${vazamentos.length}`);
  if (!falhas.length) {
    console.log('✅ ISOLAMENTO PROVADO: nenhuma empresa enxergou dado da outra.');
    process.exit(0);
  }
  console.log('\n❌ ISOLAMENTO NÃO PROVADO. Reprovadas:');
  for (const f of falhas) console.log(`   · [${f.veredito}] ${f.nome} — ${f.motivo}`);
  if (vazamentos.length) {
    console.log('\n🚨 HÁ VAZAMENTO DE DADO ENTRE EMPRESAS. NENHUM CLIENTE REAL PODE ENTRAR NA PLATAFORMA.');
  }
  process.exit(1);
}

// Só executa quando chamado direto — importar este arquivo (para testar a
// lógica pura na suíte) não pode disparar nada contra a produção.
const chamadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (chamadoDireto) {
  principal().catch(async (e) => {
    console.error(`\n💥 Erro inesperado: ${e.message}`);
    await limpar().catch(() => {});
    process.exit(3);
  });
}
