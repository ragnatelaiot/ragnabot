// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS REST DO MOTOR DE FLUXO DE CONVERSA DO RAGNABOT
//
// Ordem do dono (28/08/2026): o chamado passa a nascer DENTRO do Ragnabot. Nada de Typebot, nada
// de nuvem de terceiro. Estas rotas são a superfície de administração desse motor: listar, criar,
// editar, validar, publicar e reverter fluxo; ler telemetria e incidentes; e o MODO DE TESTE, que
// percorre o fluxo sem mandar uma única mensagem de verdade.
//
// LINHA DE MONTAGEM ESPERADA (o orquestrador monta; este arquivo NÃO toca em server.js):
//
//   app.use('/api/ragnabot-fluxo', authMiddleware,
//           (await import('./routes/ragnabot-fluxo.routes.js')).default);
//
// ⚠️ SEM `adminOnly` NO PONTO DE MONTAGEM, e isso é decisão declarada, não esquecimento: o admin
// de EMPRESA (que não é admin do NOC) precisa administrar os fluxos DELE. O isolamento é feito por
// `escopoDe(req.user)` — exatamente como já é feito em ragnabot-auditoria.routes.js — e a trava de
// ESCRITA mora dentro deste arquivo (`exigirEscrita`). Quem não tem escopo não vê nada e não
// escreve nada: falha FECHADA, nunca aberta.
//
// ── O ESCOPO VEM DO USUÁRIO LOGADO, NUNCA DA TELA ───────────────────────────────────────────────
// Nenhum manipulador aqui aceita `tenantId` do corpo ou da query para ALARGAR alcance. O super
// usuário do NOC pode ESTREITAR por empresa (ele já vê todas); qualquer outro fica preso à empresa
// que o token dele carrega. Foi confiando na empresa que a TELA mandava que o sistema antigo vazou
// dados entre clientes; a regra existe para que esse caminho não exista.
//
// ⚠️ RECURSO FORA DO ESCOPO RESPONDE 404, NÃO 403. Um 403 confirma que o identificador existe —
// vira oráculo de enumeração para descobrir quais fluxos as outras empresas têm. 404 não conta
// nada a ninguém.
//
// ── MEDIÇÃO HONESTA SOBRE QUEM TEM ESCOPO HOJE ──────────────────────────────────────────────────
// Conferido em `generateToken` (src/middleware/auth.middleware.js): o JWT carrega hoje
// `isSuperuser`, `clientCompanyId` e `clientRole` — e NÃO carrega `ragnabotTenantId`. Como
// `escopoDe` lê `user.ragnabotTenantId || user.clientCompanyId`, na prática, HOJE, só o super
// usuário do NOC recebe escopo utilizável nestas rotas. Não estou consertando isso aqui (o token é
// de outro arquivo, e não é meu); estou registrando o fato para que ninguém conclua que a rota
// está quebrada quando um admin de empresa receber lista vazia. No dia em que o campo entrar no
// token, estas rotas passam a funcionar para ele sem uma linha de alteração.
//
// ── POR QUE TODO IMPORT DO MOTOR É PREGUIÇOSO (dinâmico, dentro do manipulador) ─────────────────
// Este router está sendo escrito em paralelo com os serviços que ele consome
// (ragnabot-fluxo-publicacao.service.js, src/motor/*). Um `import` estático no topo derruba o
// PROCESSO INTEIRO do NOC se um desses arquivos ainda não existir ou tiver erro de sintaxe — o
// servidor não sobe, e junto com ele caem alertas, portal de clientes e tudo o mais. Com import
// preguiçoso e memoizado, a ausência de uma peça vira 503 NESTA rota, com o nome do módulo que
// falta, e o resto do NOC segue de pé. O custo é uma resolução de módulo na primeira chamada.
//
// ── ESTADO DA INTEGRAÇÃO, MEDIDO EM 28/08/2026 (não é previsão) ─────────────────────────────────
// Conferido no repositório e no banco, não deduzido:
//   • as 20 tabelas `RagnabotFluxo*` EXISTEM no Postgres e no cliente Prisma gerado;
//   • os executores de nó estão em `src/services/ragnabot-fluxo-nos.service.js` (exporta
//     `executorDe`, `EXECUTORES`, `casarOpcao`, `PERFIL_LIMITES_PADRAO`), e NÃO em
//     `src/motor/nos/index.js` como o contrato previa — `src/motor/` nem existe;
//   • `ragnabot-fluxo-publicacao.service.js` ainda NÃO existe: publicar, validar, reverter e
//     onde-usado respondem 503 dizendo o que falta, e voltam a funcionar sozinhos quando o
//     arquivo subir.
// Por isso cada componente é procurado numa LISTA de caminhos (ver `resolverModulo`), e
// `GET /saude` diz, a qualquer momento, o que já está de pé e por qual caminho.
//
// ── LIMITE DE CORPO QUE NÃO É NOSSO ─────────────────────────────────────────────────────────────
// O `express.json` global aceita 10 MB, mas o nginx à frente corta o corpo em 1 MB e o pedido
// morre com 413 SEM chegar ao Express e SEM log nosso (armadilha já medida nesta casa). Um
// documento de fluxo grande cai exatamente aí. Por isso o documento tem teto declarado ABAIXO do
// corte do nginx: assim a recusa é NOSSA, tem mensagem em português e diz o que fazer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import prisma from '../base/db.js';
import logger from '../base/logger.js';
import * as auditoria from '../services/ragnabot-auditoria.service.js';

const router = Router();

// Teto do documento de fluxo. 900 KB fica confortavelmente abaixo do corte de 1 MB do nginx —
// a margem existe para o cabeçalho e o restante do envelope JSON não empurrarem o pedido por cima
// da linha depois que já aceitamos.
const TETO_DOCUMENTO_BYTES = 900 * 1024;

// Teto de passos do modo de teste. Independe do freio do fluxo porque o modo de teste roda DENTRO
// do pedido HTTP: aqui o limite protege o tempo de resposta, não a conversa do cliente.
const TETO_PASSOS_TESTE = 60;

// Os quatro estados ATIVOS de uma execução. Espelham o `WHERE` do índice único parcial
// `rb_exec_uma_viva_por_conversa`. Estão repetidos aqui porque `src/motor/tipos.js` é escrito em
// paralelo e um import estático dele derrubaria o processo caso ainda não exista; quando existir,
// a constante de lá é a fonte, e o teste `estados-ativos-vs-indice.test.mjs` compara as duas.
const ESTADOS_ATIVOS = ['rodando', 'esperando', 'pausado_humano', 'pausado_duvida'];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// FERRAMENTAS DE APOIO
// ════════════════════════════════════════════════════════════════════════════════════════════════

const erro = (res, e, s = 400) => {
  if (s >= 500) logger.error(`[ragnabot-fluxo] ${e?.stack || e?.message || e}`);
  return res.status(s).json({ error: e?.message || String(e) });
};

/**
 * Torna um valor seguro para `res.json`.
 *
 * ⚠️ ARMADILHA REAL, NÃO HIPOTÉTICA: `RagnabotFluxoEvento.id`, `RagnabotFluxoNoMetricaDia.id` e
 * `RagnabotFluxoFila.id` são BigInt no schema. `JSON.stringify` LANÇA em BigInt
 * ("Do not know how to serialize a BigInt") — o manipulador entrega a linha ao Express, o Express
 * quebra ao serializar, e o cliente recebe 500 sem nenhuma pista do motivo, porque o erro acontece
 * DEPOIS do nosso try/catch. Converter na saída é mais barato que descobrir isso em produção.
 * Datas ficam como estão: o serializador do Express já as escreve em ISO.
 */
function semBigInt(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(semBigInt);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const saida = {};
    for (const [k, x] of Object.entries(v)) saida[k] = semBigInt(x);
    return saida;
  }
  return v;
}

/** Cache de módulos carregados sob demanda. `null` = tentamos e o módulo não está disponível. */
const modulos = new Map();

/**
 * Import preguiçoso e memoizado. Devolve o módulo, ou `null` quando ele ainda não existe.
 * A falha é registrada UMA vez (a memoização também memoiza a ausência) para não encher o log a
 * cada requisição enquanto a peça não chega.
 */
async function carregar(caminho) {
  if (modulos.has(caminho)) return modulos.get(caminho);
  try {
    const m = await import(caminho);
    modulos.set(caminho, m);
    return m;
  } catch (e) {
    modulos.set(caminho, null);
    logger.warn(`[ragnabot-fluxo] módulo indisponível: ${caminho} — ${e.message}`);
    return null;
  }
}

/**
 * Resolve um componente do motor entre VÁRIOS caminhos possíveis, aceitando só o módulo que
 * realmente exporta o que precisamos.
 *
 * ⚠️ POR QUE UMA LISTA E NÃO UM CAMINHO FIXO — isto é medição, não precaução genérica. O contrato
 * previa os executores em `src/motor/nos/index.js`; ao conferir o repositório em 28/08/2026 eles
 * estavam em `src/services/ragnabot-fluxo-nos.service.js` (exportando `executorDe`, `EXECUTORES`,
 * `casarOpcao`), e `src/motor/` sequer existe. Um caminho fixo deixaria o modo de teste devolvendo
 * 503 para sempre, com o código pronto do outro lado.
 *
 * Exigir o SÍMBOLO, e não apenas que o arquivo carregue, é o que impede o oposto do problema:
 * aceitar um módulo homônimo que não implementa a função e falhar depois com "undefined is not a
 * function", que é bem mais difícil de diagnosticar que um 503 que diz o nome do que falta.
 *
 * @returns {Promise<{mod:object, caminho:string}|null>}
 */
async function resolverModulo(candidatos, simbolos = []) {
  for (const caminho of candidatos) {
    const m = await carregar(caminho);
    if (!m) continue;
    if (!simbolos.length) return { mod: m, caminho };
    if (simbolos.some((s) => m[s] != null || m.default?.[s] != null)) return { mod: m, caminho };
  }
  return null;
}

/**
 * Exige um componente do motor. Quando falta, responde 503 listando os caminhos procurados — e 503
 * é o código certo: não é erro do pedido (400), é indisponibilidade temporária de um componente do
 * servidor, e a mesma chamada volta a funcionar quando a peça subir.
 * @returns {Promise<object|null>} o módulo, ou null (já tendo respondido ao cliente).
 */
async function exigirModulo(res, candidatos, paraQue, simbolos = []) {
  const lista = [].concat(candidatos);
  const achado = await resolverModulo(lista, simbolos);
  if (!achado) {
    res.status(503).json({
      error: 'Componente do motor ainda não disponível.',
      detalhe: `Necessário para ${paraQue}. Nenhuma alteração foi feita.`,
      procurado: lista,
      exportacoesEsperadas: simbolos,
    });
    return null;
  }
  return achado.mod;
}

/**
 * Confere se os modelos do motor já foram migrados no banco.
 *
 * Enquanto a migração `rb_motor_base` não rodar, `prisma.ragnabotFluxo` é `undefined` e qualquer
 * consulta estoura com "Cannot read properties of undefined" — um 500 opaco que parece defeito de
 * código. Aqui vira 503 com o nome da migração que falta.
 */
function schemaPronto() {
  return !!prisma.ragnabotFluxo && !!prisma.ragnabotFluxoVersao;
}
function exigirSchema(res) {
  if (schemaPronto()) return true;
  res.status(503).json({
    error: 'Os modelos do motor de fluxo ainda não existem neste banco.',
    detalhe: 'Aplique a migração rb_motor_base (e as migrações escritas à mão que vêm depois dela).',
  });
  return false;
}

/**
 * ESCOPO DE LEITURA. Reusa `escopoDe` do serviço de auditoria de propósito: uma única definição de
 * "o que este usuário pode ver" para todo o Ragnabot. Duas definições divergem com o tempo, e a
 * que diverge para o lado errado vaza.
 */
function escopo(req) {
  return auditoria.escopoDe(req.user);
}

/**
 * Cláusula de isolamento pronta para o `where` do Prisma.
 * @returns {object|null} null quando o usuário não tem escopo nenhum (o chamador devolve vazio).
 */
function clausulaEscopo(req, tenantIdFiltro) {
  const e = escopo(req);
  if (e.global) {
    // Super usuário PODE estreitar por empresa — ele já enxerga todas, então isto não alarga nada.
    return tenantIdFiltro ? { tenantId: String(tenantIdFiltro) } : {};
  }
  if (!e.tenantId) return null; // sem empresa vinculada: não vê nada
  return { tenantId: e.tenantId }; // trava dura; `tenantIdFiltro` é ignorado de propósito
}

/**
 * TRAVA DE ESCRITA. Ler o fluxo é uma coisa; publicar um fluxo que fala com clientes é outra.
 *
 * Decisão declarada: escreve quem é super usuário do NOC, ou quem tem empresa vinculada E papel de
 * administrador (do NOC ou do portal). Um usuário comum com escopo de leitura enxerga os fluxos da
 * empresa dele e não muda nenhum. Na dúvida, fecha.
 */
function exigirEscrita(req, res) {
  const e = escopo(req);
  if (e.global) return e;
  if (!e.tenantId) {
    res.status(403).json({ error: 'Seu usuário não está vinculado a nenhuma empresa — nada a administrar.' });
    return null;
  }
  const ehAdmin = req.user?.role === 'admin' || req.user?.clientRole === 'admin';
  if (!ehAdmin) {
    res.status(403).json({ error: 'Ação restrita a administradores da empresa.' });
    return null;
  }
  return e;
}

/**
 * Carrega um fluxo JÁ FILTRADO pelo escopo. Fora do escopo devolve `null`, e o chamador responde
 * 404. Este é o único caminho de leitura de fluxo neste arquivo: não existe consulta por `id` sem
 * a cláusula de empresa, porque a que existisse seria a que um dia esqueceriam de filtrar.
 */
async function fluxoNoEscopo(req, fluxoId) {
  const cl = clausulaEscopo(req);
  if (!cl) return null;
  return prisma.ragnabotFluxo.findFirst({ where: { id: String(fluxoId), ...cl } });
}

/** 404 padrão — mesma frase para "não existe" e para "não é seu". Ver a nota do cabeçalho. */
const NAO_ACHOU = { error: 'Fluxo não encontrado.' };

/**
 * Confere o tamanho do documento ANTES de gravar.
 * O corte do nginx é mudo; a nossa recusa não é.
 */
function documentoCabe(documento) {
  const bytes = Buffer.byteLength(JSON.stringify(documento ?? null), 'utf8');
  return { ok: bytes <= TETO_DOCUMENTO_BYTES, bytes };
}

/** Estrutura mínima do documento. Validação de CONTEÚDO é do validador; aqui é só a forma. */
function documentoTemForma(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'o documento precisa ser um objeto';
  if (!Array.isArray(d.nos)) return 'o documento precisa ter a lista "nos"';
  if (!Array.isArray(d.arestas)) return 'o documento precisa ter a lista "arestas"';
  if (d.variaveis != null && !Array.isArray(d.variaveis)) return '"variaveis" precisa ser uma lista';
  const semId = d.nos.find((n) => !n || typeof n.id !== 'string' || !n.id);
  if (semId) return 'todo nó precisa de um "id" em texto';
  const ids = new Set(d.nos.map((n) => n.id));
  if (ids.size !== d.nos.length) return 'há nós com "id" repetido';
  return null;
}

/**
 * 2FA do usuário logado — mesmo mecanismo do resto da casa (e-mail ou aplicativo autenticador).
 *
 * ⚠️ 2FA RECUSADO DEVOLVE 403 COM `code: 'INVALID_2FA'`, NUNCA 401. No frontend desta casa, 401
 * fora da tela de login significa "sua sessão morreu" e dispara logout global: um código digitado
 * errado derrubaria a sessão inteira do operador. Regra permanente da casa.
 *
 * ── S5-INDEPENDENCIA (30/08/2026): QUEM É A PESSOA SAI DA SESSÃO, NÃO DA TABELA DO NOC ──────────
 * Este trecho lia `prisma.user` — a tabela de usuários DO NOC. Ela não existe na base do Ragnabot
 * (o `schema.prisma` daqui tem só os 40 modelos do produto), então `prisma.user` é `undefined` e a
 * chamada estourava. Agora o e-mail vem de `req.user`, que `base/auth.js` montou a partir do que a
 * PLATAFORMA respondeu na entrada — é o mesmo dado, medido na fonte certa.
 *
 * ⛔ E QUANDO A SESSÃO NÃO TEM E-MAIL, A OPERAÇÃO É RECUSADA — nunca "passa batido". Isso acontece
 * na ponte de serviço (NOC → Ragnabot): ela afirma um operador em cabeçalho, sem endereço de
 * pessoa. Publicar fluxo é mandar um robô falar com o cliente de alguém; fazer isso sem confirmar
 * quem apertou o botão transformaria a ponte no contorno do segundo fator.
 */
async function conferir2FA(req, res) {
  const { otpChannel, otpCode } = req.body || {};
  const otp = await import('../services/otp.service.js');
  const canais = otp.canaisDe(req.user);

  if (!canais.email) {
    res.status(403).json({
      error: 'Esta ação exige confirmação em duas etapas, e esta sessão não tem e-mail de pessoa '
        + 'para receber o código. Entre pela plataforma com a sua conta.',
      code: 'SEM_CANAL_2FA',
    });
    return false;
  }

  if (!otpCode) {
    res.status(428).json({
      error: 'Confirmação em duas etapas necessária.',
      code: 'NEEDS_2FA',
      needs2fa: true,
      channels: canais,
      emailHint: otp.dicaDeEmail(req.user.email),
    });
    return false;
  }
  const vr = otpChannel === 'totp'
    ? await otp.verifyTotp(req.user.id, otpCode)
    : await otp.verifyEmailOtp(req.user.id, otpCode, 'access_2fa');
  if (!vr?.ok) {
    // A razão do serviço volta quando existe (ex.: código queimado por excesso de tentativas,
    // envio de e-mail não configurado). Mensagem genérica manda todo mundo tentar de novo o que
    // já não vai funcionar.
    res.status(403).json({
      error: vr?.error || 'Código de verificação inválido ou expirado.',
      code: 'INVALID_2FA',
      motivo: vr?.code || undefined,
    });
    return false;
  }
  return true;
}

/**
 * POST /request-otp — envia o código de verificação por e-mail (ou confirma que o app está pronto).
 * Existe para o retrofit forçado da publicação, que é a única operação daqui que exige 2FA.
 */
router.post('/request-otp', async (req, res) => {
  try {
    const canal = req.body?.channel === 'totp' ? 'totp' : 'email';
    const otp = await import('../services/otp.service.js');
    const canais = otp.canaisDe(req.user);   // ← S5: da SESSÃO, não de `prisma.user` (tabela do NOC)
    if (canal === 'email') {
      if (!canais.email) {
        return res.status(400).json({
          error: 'Esta sessão não tem e-mail de pessoa para receber o código. '
            + 'Entre pela plataforma com a sua conta.',
          code: 'SEM_CANAL_2FA',
        });
      }
      // ⚠️ O terceiro argumento é o ator: é dele que sai o endereço de destino. Sem tabela de
      // usuários, não há de onde adivinhar — e adivinhar destino de código de segurança seria
      // exatamente o erro a evitar.
      const r = await otp.createAndSendEmailOtp(req.user.id, 'access_2fa', req.user);
      if (!r?.ok) {
        // NÃO respondemos `sent:true` quando nada saiu. A tela pediria o código e a pessoa ficaria
        // esperando um e-mail que nunca chega, procurando o defeito na caixa de spam dela.
        const status = r?.code === 'SMTP_NAO_CONFIGURADO' ? 503
          : r?.code === 'MUITOS_ENVIOS' ? 429 : 400;
        return res.status(status).json({
          error: r?.error || 'Não consegui enviar o código.',
          code: r?.code || 'FALHA_NO_ENVIO',
        });
      }
      return res.json({
        channel: 'email', sent: true,
        emailHint: otp.dicaDeEmail(req.user.email), ttlMinutes: r.ttlMinutes,
      });
    }
    // Aplicativo autenticador não existe neste serviço, e isso é DITO — o segredo do autenticador
    // ficou na tabela do NOC e o da plataforma só ela confere. Ver `otp.service.js`, decisão 5.
    return res.status(400).json({
      error: 'O aplicativo autenticador não é conferido pelo Ragnabot. Use o código por e-mail.',
      code: 'TOTP_INDISPONIVEL',
      channels: canais,
    });
  } catch (e) { erro(res, e, 500); }
});

/**
 * GET /saude — o que já está de pé e o que ainda falta.
 *
 * Existe porque este motor sobe em partes, escritas em paralelo. Sem esta rota, "o modo de teste
 * não funciona" é um relato sem diagnóstico, e alguém vai procurar o defeito no lugar errado. Aqui
 * a resposta diz exatamente qual peça resolveu, por qual caminho, e qual não resolveu.
 *
 * Não devolve NADA de nenhuma empresa: só nomes de módulo e presença de tabela. Por isso pode ser
 * lida por qualquer usuário autenticado, inclusive quem não tem escopo.
 */
router.get('/saude', async (_req, res) => {
  try {
    const [pub, exe, cas, lim] = await Promise.all([
      resolverModulo(CAMINHOS_PUBLICACAO, ['publicar']),
      resolverModulo(CAMINHOS_EXECUTORES, ['executorDe', 'EXECUTORES', 'executores', 'obter']),
      resolverModulo(CAMINHOS_CASADOR, ['casarOpcao']),
      resolverModulo(CAMINHOS_LIMITES, ['perfilDe', 'PERFIL_LIMITES_PADRAO']),
    ]);
    res.json({
      schema: { pronto: schemaPronto() },
      componentes: {
        publicacao: pub ? { pronto: true, caminho: pub.caminho } : { pronto: false, procurado: CAMINHOS_PUBLICACAO },
        executores: exe ? { pronto: true, caminho: exe.caminho } : { pronto: false, procurado: CAMINHOS_EXECUTORES },
        casarOpcao: cas ? { pronto: true, caminho: cas.caminho } : { pronto: false, procurado: CAMINHOS_CASADOR },
        limites: lim ? { pronto: true, caminho: lim.caminho } : { pronto: false, procurado: CAMINHOS_LIMITES },
      },
      // O que o operador consegue fazer AGORA, dito em português, sem ele precisar deduzir da
      // lista de módulos acima.
      podeAgora: {
        administrarFluxos: schemaPronto(),
        publicar: !!(schemaPronto() && pub),
        modoDeTeste: !!(schemaPronto() && exe),
        lerTelemetria: schemaPronto(),
      },
    });
  } catch (e) { erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. FLUXOS — identidade e metadados
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Campos de metadados que a tela pode editar. Lista fechada de propósito: um `...req.body` deixaria
// a tela escrever `tenantId` e mover um fluxo para outra empresa com uma linha de JSON.
const CAMPOS_EDITAVEIS = new Set([
  'nome', 'descricao', 'entrada', 'cwInboxId', 'palavrasChave',
  'passosPorEvento', 'passosTotalMax', 'visitasPorNoMax', 'ttlExecucaoSegundos',
  'retomada', 'politicaContinuacao',
]);

const ENTRADAS = new Set(['caixa', 'subfluxo', 'palavra_chave']);
const RETOMADAS = new Set(['reiniciar', 'herdar_vars']);
const TETO_FREIO = { passosPorEvento: 500, passosTotalMax: 5000, visitasPorNoMax: 100, ttlExecucaoSegundos: 86400 };

/** Saneia e converte os metadados. Devolve `{ dados }` ou `{ problema }`. */
function sanearMetadados(corpo, { criando }) {
  const dados = {};
  for (const [k, v] of Object.entries(corpo || {})) {
    if (!CAMPOS_EDITAVEIS.has(k)) continue;
    if (k === 'nome') {
      const nome = String(v ?? '').trim();
      if (!nome) return { problema: 'o nome do fluxo não pode ficar vazio' };
      if (nome.length > 120) return { problema: 'o nome do fluxo passa de 120 caracteres' };
      dados.nome = nome;
    } else if (k === 'descricao') {
      dados.descricao = v == null ? null : String(v).slice(0, 2000);
    } else if (k === 'entrada') {
      if (!ENTRADAS.has(String(v))) return { problema: `entrada inválida: use ${[...ENTRADAS].join(', ')}` };
      dados.entrada = String(v);
    } else if (k === 'cwInboxId') {
      dados.cwInboxId = v == null || v === '' ? null : Number(v);
      if (dados.cwInboxId != null && !Number.isInteger(dados.cwInboxId)) {
        return { problema: 'cwInboxId precisa ser inteiro' };
      }
    } else if (k === 'palavrasChave') {
      if (!Array.isArray(v)) return { problema: 'palavrasChave precisa ser uma lista' };
      dados.palavrasChave = v.slice(0, 200);
    } else if (k === 'retomada') {
      if (!RETOMADAS.has(String(v))) return { problema: `retomada inválida: use ${[...RETOMADAS].join(' ou ')}` };
      dados.retomada = String(v);
    } else if (k === 'politicaContinuacao') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { problema: 'politicaContinuacao precisa ser um objeto' };
      dados.politicaContinuacao = v;
    } else {
      // Os quatro freios de execução. Teto declarado em cada um: um `visitasPorNoMax` gigante
      // devolve ao laço de exceção exatamente o poder de moer a conversa do cliente que o freio
      // existe para tirar — e o fluxo real medido tem DOIS laços.
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { problema: `${k} precisa ser um inteiro positivo` };
      if (n > TETO_FREIO[k]) return { problema: `${k} não pode passar de ${TETO_FREIO[k]}` };
      dados[k] = n;
    }
  }
  if (criando && !dados.nome) return { problema: 'o nome do fluxo é obrigatório' };
  // `entrada='caixa'` sem caixa é fluxo que nunca dispara — recusa na porta, não na publicação.
  if (criando && dados.entrada === 'caixa' && dados.cwInboxId == null) {
    return { problema: 'entrada por caixa exige informar cwInboxId' };
  }
  return { dados };
}

/**
 * A CAIXA INFORMADA EXISTE MESMO? (contrato S-CAIXAS, 02/09/2026)
 *
 * POR QUE ESTA GUARDA EXISTE: `resolverEntrada()` escolhe o fluxo comparando o `cwInboxId` GRAVADO
 * aqui com o id da caixa que veio no evento — e não consulta `RagnabotInbox` em momento nenhum.
 * Ou seja, hoje este campo é um inteiro livre: digitar 35 onde era 34 grava, publica, e o fluxo
 * simplesmente nunca dispara. Nada reclama, e o sintoma é «o robô não responde» — a mesma família
 * de defeito mudo do contrato anterior (id de caixa no campo da conta).
 *
 * ⚠️ A guarda só recusa o que o cadastro PROVA não existir. Cadastro vazio (a sincronização ainda
 * não rodou, ou o token do Platform App falta) devolve `sem_registro` e deixa passar com aviso no
 * log: guarda que trava por dúvida vira guarda contornada.
 *
 * @returns {Promise<string|null>} a mensagem de recusa, ou `null` quando pode seguir
 */
async function problemaNaCaixaDoFluxo(tenantId, cwInboxId) {
  if (cwInboxId == null) return null;
  try {
    const { exigirCaixaRegistrada } = await import('../services/ragnabot-tenant.service.js');
    await exigirCaixaRegistrada(tenantId, cwInboxId);
    return null;
  } catch (e) {
    // Só a recusa do cadastro vira 400. Uma falha de infraestrutura na conferência (banco fora,
    // módulo ausente) NÃO pode impedir alguém de salvar um fluxo — o dado bom continua entrando.
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.name === 'PrismaClientInitializationError') {
      logger.warn(`[ragnabot-fluxo] não consegui conferir a caixa ${cwInboxId}: ${e.message}`);
      return null;
    }
    return e.message;
  }
}

/** GET /fluxos — lista os fluxos do escopo. */
router.get('/fluxos', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const cl = clausulaEscopo(req, req.query.tenantId);
    if (!cl) return res.json({ total: 0, itens: [], aviso: 'usuário sem empresa vinculada' });

    const where = { ...cl };
    if (req.query.estado) where.estado = String(req.query.estado);
    if (req.query.incluirArquivados !== '1') where.arquivadoEm = null;
    if (req.query.busca) where.nome = { contains: String(req.query.busca), mode: 'insensitive' };

    const take = Math.min(Number(req.query.limite) || 100, 500);
    const [total, itens] = await Promise.all([
      prisma.ragnabotFluxo.count({ where }),
      prisma.ragnabotFluxo.findMany({ where, orderBy: { atualizadoEm: 'desc' }, take }),
    ]);
    res.json(semBigInt({ total, itens }));
  } catch (e) { erro(res, e, 500); }
});

/** POST /fluxos — cria o fluxo e o rascunho vazio, na MESMA transação. */
router.post('/fluxos', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const e = exigirEscrita(req, res);
    if (!e) return;

    // A empresa do fluxo NOVO: a do usuário; o super usuário precisa dizer qual, porque ele não
    // tem uma. Não inventamos empresa "padrão" — fluxo em empresa errada fala com o cliente errado.
    const tenantId = e.global ? String(req.body?.tenantId || '') : e.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Informe a empresa (tenantId) do fluxo.' });
    const empresa = await prisma.ragnabotTenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!empresa) return res.status(400).json({ error: 'Empresa não encontrada.' });

    const s = sanearMetadados(req.body, { criando: true });
    if (s.problema) return res.status(400).json({ error: s.problema });
    const problemaCaixa = await problemaNaCaixaDoFluxo(tenantId, s.dados.cwInboxId);
    if (problemaCaixa) return res.status(400).json({ error: problemaCaixa, code: 'CAIXA_NAO_REGISTRADA' });

    const documento = req.body?.documento ?? { nos: [], arestas: [], variaveis: [] };
    const forma = documentoTemForma(documento);
    if (forma) return res.status(400).json({ error: forma });
    const tam = documentoCabe(documento);
    if (!tam.ok) {
      return res.status(413).json({ error: `Documento com ${tam.bytes} bytes; o teto é ${TETO_DOCUMENTO_BYTES}.` });
    }

    // Fluxo e rascunho nascem juntos: um fluxo sem rascunho é um fluxo que a tela de edição não
    // consegue abrir, e o operador descobre isso no primeiro clique.
    const criado = await prisma.$transaction(async (tx) => {
      const f = await tx.ragnabotFluxo.create({
        data: { ...s.dados, tenantId, criadoPorUserId: req.user?.id || null },
      });
      await tx.ragnabotFluxoRascunho.create({ data: { fluxoId: f.id, tenantId, documento } });
      return f;
    });

    await auditoria.registrar({
      tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: 'fluxo_criado', entidade: 'fluxo', entidadeId: criado.id,
      descricao: `Fluxo "${criado.nome}" criado`, ip: req.ip, userAgent: req.get('user-agent'),
      depois: { nome: criado.nome, entrada: criado.entrada },
    });
    res.status(201).json(semBigInt(criado));
  } catch (e) {
    // Nome repetido na mesma empresa é o fluxo gêmeo nascendo de novo — o banco recusa, e a
    // mensagem precisa dizer POR QUE, senão o operador cria "Abertura de chamado 2".
    if (e.code === 'P2002') return res.status(409).json({ error: 'Já existe um fluxo com esse nome nesta empresa.' });
    erro(res, e, 500);
  }
});

/** GET /fluxos/:id — fluxo + rascunho + versão publicada. */
router.get('/fluxos/:id', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const [rascunho, publicada, totalVersoes] = await Promise.all([
      prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } }),
      f.versaoPublicadaId
        ? prisma.ragnabotFluxoVersao.findUnique({ where: { id: f.versaoPublicadaId } })
        : Promise.resolve(null),
      prisma.ragnabotFluxoVersao.count({ where: { fluxoId: f.id } }),
    ]);
    res.json(semBigInt({ fluxo: f, rascunho, versaoPublicada: publicada, totalVersoes }));
  } catch (e) { erro(res, e, 500); }
});

/** PATCH /fluxos/:id — metadados. NÃO mexe no documento (isso é o rascunho). */
router.patch('/fluxos/:id', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const s = sanearMetadados(req.body, { criando: false });
    if (s.problema) return res.status(400).json({ error: s.problema });
    if (!Object.keys(s.dados).length) return res.status(400).json({ error: 'Nada a alterar.' });
    // Só quando o campo está sendo ESCRITO: reconferir um valor antigo que já está gravado
    // trancaria a edição do nome de um fluxo por causa de uma caixa removida meses atrás.
    if ('cwInboxId' in s.dados) {
      const problemaCaixa = await problemaNaCaixaDoFluxo(f.tenantId, s.dados.cwInboxId);
      if (problemaCaixa) return res.status(400).json({ error: problemaCaixa, code: 'CAIXA_NAO_REGISTRADA' });
    }

    const novo = await prisma.ragnabotFluxo.update({ where: { id: f.id }, data: s.dados });
    await auditoria.registrar({
      tenantId: f.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: 'fluxo_editado', entidade: 'fluxo', entidadeId: f.id,
      descricao: `Metadados do fluxo "${novo.nome}" alterados`, ip: req.ip, userAgent: req.get('user-agent'),
      antes: Object.fromEntries(Object.keys(s.dados).map((k) => [k, f[k]])), depois: s.dados,
    });
    res.json(semBigInt(novo));
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Já existe um fluxo com esse nome nesta empresa.' });
    erro(res, e, 500);
  }
});

/**
 * POST /fluxos/:id/estado — liga ou desliga o fluxo.
 *
 * Desligar NÃO apaga e NÃO mata quem já está conversando: as execuções vivas seguem até o fim pela
 * versão em que entraram. Só deixa de aceitar tráfego NOVO. Cortar a conversa de quem está no meio
 * dela para "desligar rápido" é o robô emudecendo com a pessoa esperando.
 */
router.post('/fluxos/:id/estado', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const alvo = String(req.body?.estado || '');
    if (!['publicado', 'desligado'].includes(alvo)) {
      return res.status(400).json({ error: 'estado precisa ser "publicado" ou "desligado".' });
    }
    if (alvo === 'publicado' && !f.versaoPublicadaId) {
      return res.status(409).json({ error: 'Este fluxo ainda não tem versão publicada — publique antes de ligar.' });
    }
    const novo = await prisma.ragnabotFluxo.update({ where: { id: f.id }, data: { estado: alvo } });
    const vivas = await prisma.ragnabotFluxoExecucao
      .count({ where: { fluxoId: f.id, estado: { in: ESTADOS_ATIVOS } } })
      .catch(() => null);

    await auditoria.registrar({
      tenantId: f.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: alvo === 'publicado' ? 'fluxo_ligado' : 'fluxo_desligado',
      entidade: 'fluxo', entidadeId: f.id, ip: req.ip, userAgent: req.get('user-agent'),
      descricao: `Fluxo "${f.nome}" passou a ${alvo}`
        + (vivas ? ` (${vivas} conversa(s) em andamento seguem até o fim)` : ''),
      antes: { estado: f.estado }, depois: { estado: alvo },
    });
    res.json(semBigInt({ fluxo: novo, conversasEmAndamento: vivas }));
  } catch (e) { erro(res, e, 500); }
});

/**
 * DELETE /fluxos/:id — ARQUIVA. Nunca apaga.
 * Apagar o fluxo orfanaria versão, telemetria e auditoria de uma vez só — e é justamente a
 * telemetria que responde "por que as pessoas desistem neste nó".
 */
router.delete('/fluxos/:id', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const vivas = await prisma.ragnabotFluxoExecucao.count({
      where: { fluxoId: f.id, estado: { in: ESTADOS_ATIVOS } },
    });
    if (vivas > 0 && req.query.mesmoAssim !== '1') {
      return res.status(409).json({
        error: `${vivas} conversa(s) ainda estão dentro deste fluxo.`,
        detalhe: 'Arquivar não as interrompe, mas confirme com ?mesmoAssim=1.',
        conversasEmAndamento: vivas,
      });
    }
    const novo = await prisma.ragnabotFluxo.update({
      where: { id: f.id }, data: { arquivadoEm: new Date(), estado: 'desligado' },
    });
    await auditoria.registrar({
      tenantId: f.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: 'fluxo_arquivado', entidade: 'fluxo', entidadeId: f.id,
      descricao: `Fluxo "${f.nome}" arquivado`, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json(semBigInt(novo));
  } catch (e) { erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. RASCUNHO, VALIDAÇÃO E PUBLICAÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Onde procurar o serviço de publicação, em ordem de preferência. O primeiro é o nome do
// contrato; o segundo cobre o caso de as funções terem sido acomodadas no serviço do motor. Só é
// aceito o módulo que exporta a função pedida (ver `resolverModulo`).
const CAMINHOS_PUBLICACAO = [
  '../services/ragnabot-fluxo-publicacao.service.js',
  '../services/ragnabot-fluxo-motor.service.js',
];

// Onde procurar o registro de executores de nó e o casador de opção. Conferido em 28/08/2026:
// hoje vivem em `ragnabot-fluxo-nos.service.js`; o caminho do contrato fica na lista para o dia
// em que alguém mover o código para `src/motor/`.
const CAMINHOS_EXECUTORES = [
  '../services/ragnabot-fluxo-nos.service.js',
  '../motor/nos/index.js',
];
const CAMINHOS_CASADOR = [
  '../services/ragnabot-fluxo-nos.service.js',
  '../motor/casar-opcao.js',
];
const CAMINHOS_LIMITES = [
  '../services/ragnabot-fluxo-limites.service.js',
  '../services/ragnabot-fluxo-nos.service.js',
];

router.get('/fluxos/:id/rascunho', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    const r = await prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } });
    if (!r) return res.status(404).json({ error: 'Este fluxo não tem rascunho.' });
    res.json(semBigInt(r));
  } catch (e) { erro(res, e, 500); }
});

/**
 * PUT /fluxos/:id/rascunho — grava o documento em edição.
 *
 * `rev` é concorrência otimista e é OBRIGATÓRIO. Dois administradores no mesmo fluxo é evento real,
 * não hipótese: sem o `rev`, a segunda gravação sobrescreve o trabalho do colega em silêncio, e
 * ninguém descobre até um nó sumir. Com ele, a segunda recebe 409 e vê o conflito.
 */
router.put('/fluxos/:id/rascunho', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const { documento, rev } = req.body || {};
    const forma = documentoTemForma(documento);
    if (forma) return res.status(400).json({ error: forma });
    const tam = documentoCabe(documento);
    if (!tam.ok) {
      return res.status(413).json({ error: `Documento com ${tam.bytes} bytes; o teto é ${TETO_DOCUMENTO_BYTES}.` });
    }
    if (!Number.isInteger(Number(rev))) {
      return res.status(400).json({
        error: 'Informe "rev" (a revisão que você carregou) para não sobrescrever o trabalho de outra pessoa.',
      });
    }

    const achadoPub = await resolverModulo(CAMINHOS_PUBLICACAO, ['salvarRascunho']);
    const pub = achadoPub?.mod;
    if (pub?.salvarRascunho) {
      // Caminho preferido: o serviço é o dono da regra de revisão e da validação anexada.
      try {
        const r = await pub.salvarRascunho(f.id, documento, { rev: Number(rev), userId: req.user?.id || null });
        return res.json(semBigInt(r));
      } catch (e) {
        if (/revis|conflit|409/i.test(e?.message || '')) return res.status(409).json({ error: e.message });
        throw e;
      }
    }

    // Retaguarda enquanto o serviço não sobe: a MESMA regra de revisão, imposta pelo banco.
    // O `updateMany` com `rev` no `where` é comparar-e-trocar: zero linhas significa que outra
    // pessoa gravou depois de você carregar — não é "não encontrado", é conflito, e a diferença
    // importa para quem está do outro lado da tela.
    const r = await prisma.ragnabotFluxoRascunho.updateMany({
      where: { fluxoId: f.id, rev: Number(rev) },
      data: { documento, rev: { increment: 1 }, atualizadoPorUserId: req.user?.id || null },
    });
    if (r.count === 0) {
      const atual = await prisma.ragnabotFluxoRascunho.findUnique({
        where: { fluxoId: f.id }, select: { rev: true },
      });
      return res.status(409).json({
        error: 'Outra pessoa gravou este rascunho depois que você o abriu.',
        revEnviada: Number(rev), revAtual: atual?.rev ?? null,
      });
    }
    const atualizado = await prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } });
    res.json(semBigInt({
      rev: atualizado.rev,
      validacao: atualizado.validacao,
      aviso: 'Serviço de validação indisponível: o documento foi gravado SEM validar.',
    }));
  } catch (e) { erro(res, e, 500); }
});

/**
 * POST /fluxos/:id/validar — valida sem publicar.
 * Valida o corpo enviado, se vier; senão, o rascunho gravado. É a mesma função que o editor chama
 * a cada mudança e que a publicação chama de novo — uma verdade só.
 */
router.post('/fluxos/:id/validar', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    const pub = await exigirModulo(res, CAMINHOS_PUBLICACAO, 'validar o fluxo', ['validarDocumento']);
    if (!pub) return;

    let documento = req.body?.documento;
    if (!documento) {
      const r = await prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } });
      documento = r?.documento;
    }
    const forma = documentoTemForma(documento);
    if (forma) return res.status(400).json({ error: forma });

    const perfilLimite = String(req.query.perfilLimite || req.body?.perfilLimite || 'whatsapp_cloud@2026-08');
    // `fluxoId` viaja para o validador reprovar sub-fluxo apontando para o PRÓPRIO fluxo — o
    // editor precisa ver esse erro enquanto desenha, e não só quando tenta publicar.
    const r = await pub.validarDocumento(documento, { tenantId: f.tenantId, perfilLimite, fluxoId: f.id });
    res.json(semBigInt(r));
  } catch (e) { erro(res, e, 500); }
});

/**
 * GET /fluxos/:id/mudanca — PRÉVIA da publicação, antes de publicar.
 *
 * Responde duas coisas que o operador precisa saber ANTES de clicar: a mudança é compatível com
 * quem já está no meio da conversa, e QUANTAS pessoas estão nessa situação. "47 conversas seriam
 * movidas, 3 ficariam órfãs" é uma decisão informada; "publicar?" não é.
 */
router.get('/fluxos/:id/mudanca', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    const pub = await exigirModulo(res, CAMINHOS_PUBLICACAO, 'classificar a mudança', ['classificarMudanca']);
    if (!pub) return;

    const [rascunho, vigente] = await Promise.all([
      prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } }),
      f.versaoPublicadaId
        ? prisma.ragnabotFluxoVersao.findUnique({ where: { id: f.versaoPublicadaId } })
        : Promise.resolve(null),
    ]);
    if (!rascunho) return res.status(404).json({ error: 'Este fluxo não tem rascunho.' });

    // Sem versão vigente, a primeira publicação não alcança ninguém: não há conversa dentro.
    if (!vigente) {
      return res.json({ classe: 'primeira_publicacao', vivas: 0, orfas: 0, modoSugerido: 'fixar', exige2FA: false });
    }
    const classe = pub.classificarMudanca(vigente.documento, rascunho.documento);

    // Quantas conversas estão vivas NA VERSÃO VIGENTE, e quantas delas ficariam órfãs — paradas
    // num nó que o documento novo não tem mais. Órfã é o caso que exige nó de resgate; contar
    // antes é o que transforma "publicar mesmo assim" de aposta em decisão.
    const TETO_AMOSTRA_VIVAS = 5000;
    const vivas = await prisma.ragnabotFluxoExecucao.findMany({
      where: { versaoId: vigente.id, estado: { in: ESTADOS_ATIVOS } },
      select: { id: true, noAtualId: true },
      take: TETO_AMOSTRA_VIVAS,
    });
    const idsNovos = new Set((rascunho.documento?.nos || []).map((n) => n.id));
    const orfas = vivas.filter((x) => x.noAtualId && !idsNovos.has(x.noAtualId)).length;

    res.json(semBigInt({
      classe,
      vivas: vivas.length,
      orfas,
      modoSugerido: classe === 'compativel' ? 'retrofit' : 'fixar',
      exige2FA: orfas > 0,
      // Honestidade sobre a contagem: acima do teto a amostra satura, e apresentar "5000" como se
      // fosse o total seria um número bonito e errado bem na hora de decidir.
      contagemSaturada: vivas.length >= TETO_AMOSTRA_VIVAS,
    }));
  } catch (e) { erro(res, e, 500); }
});

/**
 * POST /fluxos/:id/publicar — publica uma versão nova (só INSERT).
 *
 * `retrofit_forcado` EXIGE 2FA: é a única operação daqui que move conversa de gente viva para um
 * grafo cuja estrutura mudou, com risco de deixar alguém órfã. Publicação normal não pede 2FA —
 * pedir código a cada salvamento é o caminho mais curto para o operador parar de ler o que assina.
 */
router.post('/fluxos/:id/publicar', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    // ⚠️ A ORDEM IMPORTA: pedido malformado é recusado ANTES de procurar o componente. Do
    // contrário, um `modoMigracao` inventado devolveria 503 ("componente indisponível") em vez de
    // 400 — mandando quem chama investigar a infraestrutura por causa de um erro no próprio JSON.
    const modoMigracao = String(req.body?.modoMigracao || 'fixar');
    if (!['fixar', 'retrofit', 'retrofit_forcado'].includes(modoMigracao)) {
      return res.status(400).json({ error: 'modoMigracao precisa ser fixar, retrofit ou retrofit_forcado.' });
    }
    const pub = await exigirModulo(res, CAMINHOS_PUBLICACAO, 'publicar o fluxo', ['publicar']);
    if (!pub) return;
    // `conferir2FA` já respondeu ao cliente quando devolve false (428 pedindo o código, ou 403
    // recusando-o). Retornar aqui sem escrever nada é o que garante que uma publicação forçada
    // nunca acontece por engano.
    if (modoMigracao === 'retrofit_forcado' && !(await conferir2FA(req, res))) return;

    const notaPublicacao = req.body?.notaPublicacao ? String(req.body.notaPublicacao).slice(0, 1000) : null;
    const r = await pub.publicar(f.id, {
      userId: req.user?.id || null,
      modoMigracao,
      notaPublicacao,
      confirmou2FA: modoMigracao === 'retrofit_forcado',
    });

    // A auditoria de publicação é obrigatória e vai pelo serviço que JÁ existe — nunca por tabela
    // nova. `registrar` não lança: auditoria que derruba a operação é pior que auditoria ausente.
    await auditoria.registrar({
      tenantId: f.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: 'fluxo_publicado', entidade: 'fluxo', entidadeId: f.id,
      ip: req.ip, userAgent: req.get('user-agent'),
      descricao: `Versão ${r?.numero} publicada (${modoMigracao}); `
        + `${r?.migradas ?? 0} migrada(s), ${r?.resgatadas ?? 0} resgatada(s)`,
      antes: { versaoPublicadaId: f.versaoPublicadaId },
      depois: { versaoId: r?.versaoId, numero: r?.numero, modoMigracao, nota: notaPublicacao },
    });
    res.json(semBigInt(r));
  } catch (e) {
    // Recusa de LAÇO de sub-fluxo é 409 (conflito no desenho), nunca 500. Devolver 500 mandaria o
    // operador investigar o servidor por causa de um desenho que ele mesmo consegue corrigir — e a
    // frase com o caminho do laço (`ciclos`) é justamente o que ele precisa ver na tela.
    if (e?.codigo === 'SUBFLUXO_EM_LACO') {
      return res.status(409).json({ error: e.message, code: 'SUBFLUXO_EM_LACO', ciclos: e.ciclos || [] });
    }
    if (e?.codigo === 'VALIDACAO') {
      return res.status(400).json({ error: e.message, code: 'VALIDACAO', validacao: semBigInt(e.validacao) });
    }
    return erro(res, e, 500);
  }
});

router.get('/fluxos/:id/versoes', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    // O documento inteiro NÃO vai na lista: seriam N documentos completos numa resposta só, e a
    // lista serve para escolher, não para ler o grafo. `select` explícito, sem `documento`.
    const itens = await prisma.ragnabotFluxoVersao.findMany({
      where: { fluxoId: f.id },
      orderBy: { numero: 'desc' },
      take: Math.min(Number(req.query.limite) || 50, 200),
      select: {
        id: true, numero: true, hashDocumento: true, hashEstrutura: true, noInicialId: true,
        noResgateId: true, perfilLimite: true, modoMigracao: true, origemVersaoId: true,
        notaPublicacao: true, publicadoPorUserId: true, publicadoEm: true, criadoEm: true,
      },
    });
    res.json(semBigInt({ versaoPublicadaId: f.versaoPublicadaId, itens }));
  } catch (e) { erro(res, e, 500); }
});

router.get('/fluxos/:id/versoes/:numero', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    const numero = Number(req.params.numero);
    if (!Number.isInteger(numero)) return res.status(400).json({ error: 'Número de versão inválido.' });
    const v = await prisma.ragnabotFluxoVersao.findUnique({
      where: { fluxoId_numero: { fluxoId: f.id, numero } },
    });
    if (!v) return res.status(404).json({ error: 'Versão não encontrada.' });
    res.json(semBigInt(v));
  } catch (e) { erro(res, e, 500); }
});

/**
 * POST /fluxos/:id/reverter/:numero — reverter COPIA PARA A FRENTE.
 * O ponteiro nunca volta: se voltasse, o número da versão deixaria de mapear um período contínuo e
 * toda comparação entre versões ficaria envenenada — e é essa comparação que transforma "reduzi a
 * pausa e o abandono caiu" de opinião em medição.
 */
router.post('/fluxos/:id/reverter/:numero', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);
    const pub = await exigirModulo(res, CAMINHOS_PUBLICACAO, 'reverter para uma versão anterior', ['reverterPara']);
    if (!pub) return;

    const numero = Number(req.params.numero);
    if (!Number.isInteger(numero) || numero < 1) return res.status(400).json({ error: 'Número de versão inválido.' });
    const r = await pub.reverterPara(f.id, numero, { userId: req.user?.id || null });

    await auditoria.registrar({
      tenantId: f.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
      categoria: 'configuracao', acao: 'fluxo_revertido', entidade: 'fluxo', entidadeId: f.id,
      ip: req.ip, userAgent: req.get('user-agent'),
      descricao: `Revertido ao conteúdo da versão ${numero} (republicado como versão nova)`,
      depois: semBigInt(r),
    });
    res.json(semBigInt(r));
  } catch (e) {
    // Mesma tradução da publicação: o outro fluxo pode ter mudado desde então e fechado o laço pelo
    // outro lado. Recusar com o caminho na mensagem é o que permite consertar sem adivinhar.
    if (e?.codigo === 'SUBFLUXO_EM_LACO') {
      return res.status(409).json({ error: e.message, code: 'SUBFLUXO_EM_LACO', ciclos: e.ciclos || [] });
    }
    return erro(res, e, 500);
  }
});

/**
 * GET /cofre/:apelido/onde-usado — "quais fluxos e nós usam este token?"
 *
 * Pergunta que hoje NÃO tem resposta, com o mesmo token replicado em vários nós. Responder ANTES
 * de rotacionar é o ponto inteiro: rotacionar sem saber quem usa é escolher entre deixar o segredo
 * velho vivo e quebrar um fluxo em produção sem saber qual.
 *
 * ⚠️ Devolve ONDE o apelido é usado. Nunca o valor: o valor não passa por esta rota em hipótese
 * nenhuma, e por isso ela pode ser lida por quem administra o fluxo sem virar leitura do cofre.
 */
router.get('/cofre/:apelido/onde-usado', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const e = escopo(req);
    // Super usuário precisa dizer de qual empresa é o apelido: o mesmo apelido existe em várias, e
    // devolver a união mostraria a uma empresa onde a outra usa o segredo dela.
    const tenantId = e.global ? String(req.query.tenantId || '') : e.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: e.global ? 'Informe a empresa (tenantId).' : 'Seu usuário não está vinculado a nenhuma empresa.',
      });
    }
    const pub = await exigirModulo(res, CAMINHOS_PUBLICACAO, 'localizar o uso do segredo', ['ondeUsado']);
    if (!pub) return;
    res.json(semBigInt(await pub.ondeUsado(tenantId, String(req.params.apelido))));
  } catch (e) { erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. TELEMETRIA — como a conversa correu de verdade
//
// Lê SOMENTE de RagnabotFluxoEvento, RagnabotFluxoNo, RagnabotFluxoIncidente e
// RagnabotFluxoExecucao. Nenhuma rota daqui escreve em RagnabotFluxo nem em RagnabotFluxoVersao:
// é a correção do defeito em que a telemetria morava dentro do documento e cada interação de
// cliente reescrevia a definição do fluxo, fazendo `atualizadoEm` significar "alguém conversou" em
// vez de "alguém editou".
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Percentil por posição sobre uma amostra JÁ ordenada. Sem interpolação: é latência, não nota. */
function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const i = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return ordenados[i];
}

// De que evento sai cada contador do funil.
const CONTADOR_POR_EVENTO = {
  no_entrou: 'apresentados',
  resposta_recebida: 'respondidos',
  sem_resposta: 'semResposta',
  opcao_invalida: 'invalidos',
  erro_no: 'erros',
  abandonado: 'abandonados',
  texto_cortado: 'textoCortado',
  entregue_humano: 'entreguesHumano',
};

/**
 * GET /fluxos/:id/telemetria — o funil por nó.
 *
 * Responde a pergunta que ninguém consegue responder hoje: em QUAL nó as pessoas param, e COMO
 * elas conseguiram escolher (tocando no botão, digitando o número, digitando o título). Se a
 * maioria vem por índice ou por apelido, o menu está mal escrito — e isso aparece sozinho, sem
 * ninguém precisar suspeitar primeiro.
 */
router.get('/fluxos/:id/telemetria', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    // Qual versão medir: a pedida, ou a publicada. Misturar versões num funil só produz um número
    // que não é de nenhuma delas — é a média entre dois fluxos diferentes.
    let versaoId = req.query.versaoId ? String(req.query.versaoId) : f.versaoPublicadaId;
    if (req.query.versaoNumero) {
      const numero = Number(req.query.versaoNumero);
      if (!Number.isInteger(numero)) return res.status(400).json({ error: 'versaoNumero inválido.' });
      const v = await prisma.ragnabotFluxoVersao.findUnique({
        where: { fluxoId_numero: { fluxoId: f.id, numero } }, select: { id: true },
      });
      versaoId = v?.id || null;
    }
    if (!versaoId) {
      return res.status(409).json({ error: 'Este fluxo ainda não tem versão publicada — não há o que medir.' });
    }

    // ⚠️ A versão é conferida contra a EMPRESA do fluxo, não apenas contra o fluxo. É a mesma cerca
    // que as chaves estrangeiras compostas impõem no banco, aplicada aqui na leitura.
    const versao = await prisma.ragnabotFluxoVersao.findFirst({
      where: { id: versaoId, fluxoId: f.id, tenantId: f.tenantId },
      select: { id: true, numero: true, publicadoEm: true },
    });
    if (!versao) return res.status(404).json({ error: 'Versão não encontrada neste fluxo.' });

    const de = req.query.de ? new Date(String(req.query.de)) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const ate = req.query.ate ? new Date(String(req.query.ate)) : new Date();
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
      return res.status(400).json({ error: 'Datas "de"/"ate" inválidas.' });
    }
    const janela = { gte: de, lte: ate };

    const [porNo, porCasamento, porSaidaBruto, nos] = await Promise.all([
      prisma.ragnabotFluxoEvento.groupBy({
        by: ['noId', 'tipo'], where: { versaoId: versao.id, criadoEm: janela }, _count: { _all: true },
      }),
      prisma.ragnabotFluxoEvento.groupBy({
        by: ['noId', 'viaCasamento'],
        where: { versaoId: versao.id, criadoEm: janela, viaCasamento: { not: null } },
        _count: { _all: true },
      }),
      // ⭐ ESTATÍSTICA POR SAÍDA (contrato S3, doc 34 §F3.8) — «enviado · clicado · CTR» em cada
      // conector do canvas.
      //
      // ⚠️ MEDIDO ANTES DE CONSTRUIR, e o achado contraria o que o plano supunha:
      // `RagnabotFluxoNoMetricaDia` TEM as colunas `apresentados/respondidos/porSaida`, mas NADA
      // no repositório escreve nela — é a tabela adiada de propósito (o comentário do schema diz
      // isso com todas as letras: «o WORKER que a preenche é FASE 2»). Ou seja: o número não
      // «existia e ninguém via»; ele não existia. O que existe, e é suficiente, é o evento CRU:
      // o motor grava `no_saiu` com a `saida` em cada passagem. Deriva-se daí, pela MESMA fonte
      // que já alimenta o funil por nó — uma verdade só, sem agregador novo para manter.
      prisma.ragnabotFluxoEvento.groupBy({
        by: ['noId', 'saida'],
        where: { versaoId: versao.id, criadoEm: janela, tipo: 'no_saiu', saida: { not: null } },
        _count: { _all: true },
      }),
      prisma.ragnabotFluxoNo.findMany({
        where: { versaoId: versao.id },
        select: { noId: true, tipo: true, titulo: true, ordem: true, estaciona: true },
        orderBy: { ordem: 'asc' },
      }),
    ]);

    // Amostra de latência. É AMOSTRA e está dito na resposta: percentil sobre as 20 mil linhas mais
    // recentes não é o percentil da população, e apresentar como se fosse é número bonito e errado.
    const TETO_AMOSTRA = 20000;
    const amostra = await prisma.ragnabotFluxoEvento.findMany({
      where: { versaoId: versao.id, criadoEm: janela, latenciaMs: { not: null } },
      select: { noId: true, latenciaMs: true }, orderBy: { criadoEm: 'desc' }, take: TETO_AMOSTRA,
    });

    const mapa = new Map();
    const pegar = (noId) => {
      if (!mapa.has(noId)) {
        mapa.set(noId, {
          noId, titulo: null, tipo: null, estaciona: false,
          apresentados: 0, respondidos: 0, semResposta: 0, invalidos: 0, erros: 0,
          abandonados: 0, textoCortado: 0, entreguesHumano: 0,
          porCasamento: {}, latenciaP50Ms: null, latenciaP95Ms: null, latenciaAmostra: 0,
          porSaida: {}, saiuTotal: 0, ctr: null,
        });
      }
      return mapa.get(noId);
    };
    for (const n of nos) {
      const r = pegar(n.noId);
      r.titulo = n.titulo; r.tipo = n.tipo; r.estaciona = n.estaciona;
    }
    for (const linha of porNo) {
      if (!linha.noId) continue;
      const campo = CONTADOR_POR_EVENTO[linha.tipo];
      if (campo) pegar(linha.noId)[campo] += linha._count._all;
    }
    for (const linha of porCasamento) {
      if (!linha.noId) continue;
      pegar(linha.noId).porCasamento[linha.viaCasamento] = linha._count._all;
    }
    for (const linha of porSaidaBruto) {
      if (!linha.noId || !linha.saida) continue;
      const r = pegar(linha.noId);
      r.porSaida[linha.saida] = { saiu: linha._count._all, ctr: null };
    }
    // O CTR de cada saída, e o do nó. Denominador = APRESENTAÇÕES do nó, que é o que a tela do chat
    // atual chama de «Menus Enviados».
    //
    // ⚠️ DUAS DECISÕES DECLARADAS, porque as duas mudam o número que o operador lê:
    //  (a) `null` quando não houve apresentação nenhuma — e não zero. «0 %» diria «ninguém clicou»
    //      sobre um menu que nunca foi mostrado, que é uma afirmação falsa sobre o desenho.
    //  (b) o CTR do NÓ soma só as saídas do CAMINHO DESENHADO. `sem_resposta`, `opcao_invalida`,
    //      `erro`, `erro_interno` e `sem_janela` são o oposto de um clique: contá-las inflaria o
    //      CTR justamente nos menus que estão dando errado — que são os que precisam aparecer mal.
    const SAIDAS_QUE_NAO_SAO_CLIQUE = new Set(['sem_resposta', 'opcao_invalida', 'erro', 'erro_interno', 'sem_janela']);
    for (const r of mapa.values()) {
      const base = r.apresentados;
      let cliques = 0;
      for (const [saida, dados] of Object.entries(r.porSaida)) {
        dados.ctr = base > 0 ? dados.saiu / base : null;
        dados.excecao = SAIDAS_QUE_NAO_SAO_CLIQUE.has(saida);
        r.saiuTotal += dados.saiu;
        if (!dados.excecao) cliques += dados.saiu;
      }
      r.cliques = cliques;
      r.ctr = base > 0 ? cliques / base : null;
    }
    const latenciasPorNo = new Map();
    for (const a of amostra) {
      if (!a.noId) continue;
      if (!latenciasPorNo.has(a.noId)) latenciasPorNo.set(a.noId, []);
      latenciasPorNo.get(a.noId).push(a.latenciaMs);
    }
    for (const [noId, valores] of latenciasPorNo) {
      valores.sort((x, y) => x - y);
      const r = pegar(noId);
      r.latenciaP50Ms = percentil(valores, 50);
      r.latenciaP95Ms = percentil(valores, 95);
      r.latenciaAmostra = valores.length;
    }

    const itens = [...mapa.values()].sort((a, b) => b.apresentados - a.apresentados);
    res.json(semBigInt({
      versao: { id: versao.id, numero: versao.numero, publicadoEm: versao.publicadoEm },
      periodo: { de, ate },
      latencia: {
        origem: 'amostra',
        tamanhoAmostra: amostra.length,
        saturada: amostra.length >= TETO_AMOSTRA,
        aviso: amostra.length >= TETO_AMOSTRA
          ? `Amostra saturada em ${TETO_AMOSTRA} eventos recentes: os percentis descrevem a amostra, não o período inteiro.`
          : null,
      },
      itens,
      // Como ler os números por saída, escrito na própria resposta: quem consome a API não tem
      // como adivinhar que exceção não conta como clique, e um consumidor que somasse tudo
      // publicaria um CTR maior que o real.
      porSaida: {
        origem: 'RagnabotFluxoEvento.no_saiu',
        denominador: 'apresentados (eventos no_entrou do mesmo nó, no mesmo período)',
        ctrNulo: 'nó que não foi apresentado nenhuma vez no período — não é 0 %, é ausência de medida',
        excecoesForaDoCtr: [...SAIDAS_QUE_NAO_SAO_CLIQUE],
      },
    }));
  } catch (e) { erro(res, e, 500); }
});

/**
 * GET /fluxos/:id/incidentes — a caixa de entrada de defeitos do operador.
 * Vem agrupado do banco (chave única por versão+nó+código): "opção inválida, 151 vezes, última há
 * 3 minutos" é acionável; 151 linhas iguais são ruído que se aprende a ignorar — e ignorar foi
 * exatamente o que aconteceu nos catorze meses medidos.
 */
router.get('/fluxos/:id/incidentes', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const versoes = await prisma.ragnabotFluxoVersao.findMany({
      where: { fluxoId: f.id }, select: { id: true, numero: true },
    });
    if (!versoes.length) return res.json([]);
    const numeroDaVersao = new Map(versoes.map((v) => [v.id, v.numero]));

    // O `tenantId` E a lista de versões deste fluxo: duas cercas, não uma. A do tenant impede ver
    // outra empresa; a das versões impede ver outro fluxo da mesma empresa.
    const where = { tenantId: f.tenantId, versaoId: { in: versoes.map((v) => v.id) } };
    if (req.query.abertos === '1') where.resolvidoEm = null;
    if (req.query.nivel) where.nivel = String(req.query.nivel);

    const itens = await prisma.ragnabotFluxoIncidente.findMany({
      where, orderBy: { ultimaEm: 'desc' }, take: Math.min(Number(req.query.limite) || 200, 1000),
    });
    res.json(semBigInt(itens.map((i) => ({ ...i, versaoNumero: numeroDaVersao.get(i.versaoId) ?? null }))));
  } catch (e) { erro(res, e, 500); }
});

/**
 * POST /incidentes/:id/reconhecer — "eu vi". NÃO resolve.
 * Reconhecer e resolver são fatos diferentes: um diz que alguém leu, o outro que alguém consertou.
 * Fundir os dois faz o painel mostrar zero defeito enquanto o defeito segue lá.
 */
router.post('/incidentes/:id/reconhecer', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    if (!exigirEscrita(req, res)) return;
    const cl = clausulaEscopo(req);
    if (!cl) return res.status(403).json({ error: 'Sem escopo de empresa.' });
    // O `updateMany` com a cláusula de empresa no `where` é o isolamento: um `update` por id
    // atualizaria o incidente de outra empresa se o identificador vazasse. Zero linhas devolve 404.
    const r = await prisma.ragnabotFluxoIncidente.updateMany({
      where: { id: String(req.params.id), ...cl },
      data: { reconhecidoPor: req.user?.id || null, reconhecidoEm: new Date() },
    });
    if (!r.count) return res.status(404).json({ error: 'Incidente não encontrado.' });
    res.json({ ok: true });
  } catch (e) { erro(res, e, 500); }
});

/** GET /fluxos/:id/execucoes — conversas dentro do fluxo. Sem `vars`: é dado pessoal do cliente. */
router.get('/fluxos/:id/execucoes', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const where = { fluxoId: f.id, tenantId: f.tenantId };
    if (req.query.estado) where.estado = String(req.query.estado);
    if (req.query.protocolo) where.protocolo = String(req.query.protocolo).toUpperCase();
    if (req.query.ativas === '1') where.estado = { in: ESTADOS_ATIVOS };

    const take = Math.min(Number(req.query.limite) || 100, 500);
    const [total, itens] = await Promise.all([
      prisma.ragnabotFluxoExecucao.count({ where }),
      prisma.ragnabotFluxoExecucao.findMany({
        where, orderBy: { iniciadaEm: 'desc' }, take,
        // ⚠️ `vars` FICA DE FORA da lista, e não é economia de bytes: são os dados que o cliente
        // digitou (nome, e-mail, descrição do problema). Uma lista de conversas não precisa deles,
        // e o que não trafega não vaza. Quem precisa abre a conversa, e lá a decisão é explícita.
        select: {
          id: true, protocolo: true, estado: true, motivoFim: true, noAtualId: true,
          aguardando: true, aguardaDesde: true, acordarEm: true, passosTotal: true,
          versaoId: true, versaoInicialId: true, cwConversationId: true, cwAccountId: true,
          iniciadaEm: true, atualizadaEm: true, encerradaEm: true, expiraEm: true,
        },
      }),
    ]);
    res.json(semBigInt({ total, itens }));
  } catch (e) { erro(res, e, 500); }
});

/**
 * GET /execucoes/:id — a trilha de UMA conversa: por onde a pessoa passou.
 * É a pergunta que o atendente faz de madrugada, e a trilha responde com uma leitura só, sem junção.
 *
 * `vars` só sai com `?incluirDados=1` — e sair fica registrado na auditoria, na categoria `dados`.
 * Dado pessoal de cliente não escorrega para dentro de uma tela de diagnóstico sem alguém ter
 * pedido e sem ficar escrito quem pediu.
 */
router.get('/execucoes/:id', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const cl = clausulaEscopo(req);
    if (!cl) return res.status(404).json({ error: 'Execução não encontrada.' });

    const ex = await prisma.ragnabotFluxoExecucao.findFirst({ where: { id: String(req.params.id), ...cl } });
    if (!ex) return res.status(404).json({ error: 'Execução não encontrada.' });

    const [eventos, versao] = await Promise.all([
      prisma.ragnabotFluxoEvento.findMany({ where: { execucaoId: ex.id }, orderBy: { criadoEm: 'asc' }, take: 500 }),
      prisma.ragnabotFluxoVersao.findUnique({ where: { id: ex.versaoId }, select: { numero: true } }),
    ]);

    const incluirDados = req.query.incluirDados === '1';
    if (incluirDados) {
      await auditoria.registrar({
        tenantId: ex.tenantId, atorTipo: 'user', atorId: req.user?.id || null, atorNome: req.user?.name || null,
        categoria: 'dados', acao: 'fluxo_execucao_dados_lidos', protocolo: ex.protocolo,
        entidade: 'fluxo_execucao', entidadeId: ex.id, ip: req.ip, userAgent: req.get('user-agent'),
        descricao: 'Variáveis (dados do cliente) da conversa foram exibidas',
      });
    }
    const saida = { ...ex, versaoNumero: versao?.numero ?? null };
    if (!incluirDados) {
      delete saida.vars;
      delete saida.noCongelado;
      delete saida.caixaPendente;
    }
    res.json(semBigInt({ execucao: saida, eventos }));
  } catch (e) { erro(res, e, 500); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. MODO DE TESTE — percorre o fluxo SEM mandar mensagem de verdade
//
// ── O QUE TORNA ISTO CONFIÁVEL ──────────────────────────────────────────────────────────────────
// Usa `preparar()` e `executar()` DOS MESMOS EXECUTORES que a produção usa. Não existe um
// "simulador" paralelo, e é essa ausência que importa: um simulador escrito à parte diverge do
// motor em três semanas, e a divergência aparece justamente quando alguém confia nele para
// publicar. Aqui, se o teste mostrou uma lista de 4 itens, é porque `preparar` montou 4.
//
// ── TRÊS COISAS QUE ESTE MODO NÃO PODE FAZER, E COMO SÃO IMPEDIDAS ──────────────────────────────
// 1. MANDAR MENSAGEM. O canal entregue ao contexto só ACUMULA intenções numa lista. Ele não tem
//    cliente HTTP, não tem token, não conhece o Chatwoot. Não é "configurado para não enviar":
//    não tem como.
// 2. CHAMAR TERCEIRO. O egresso LANÇA sempre. Um nó `http` apontando para o sistema do cliente não
//    dispara requisição real durante um teste — teste que dispara efeito no mundo é ensaio com
//    munição de verdade.
// 3. REVELAR SEGREDO. O cofre devolve uma MÁSCARA, nunca o valor decifrado. Este é o ponto de
//    segurança de verdade deste bloco: o modo de teste é uma tela de EDITOR, e a resposta dele
//    volta para o navegador. Se o cofre resolvesse de verdade, bastaria um nó `http` com o token
//    no corpo e uma prévia para transformar o editor de fluxo em leitor do cofre da empresa. A
//    máscara mantém a forma (o fluxo anda, o nó monta) sem entregar o valor.
//
// ── SEM ESTADO NO SERVIDOR, DE PROPÓSITO ────────────────────────────────────────────────────────
// A sessão de teste viaja no corpo (`estado`) e volta a cada passo. Nada é gravado: nenhuma linha
// de execução, nenhum evento, nenhum protocolo emitido. Um teste que grava execução contamina a
// própria telemetria que o operador vai ler depois para decidir se o fluxo melhorou.
//
// ⚠️ O `estado` vem do NAVEGADOR e é tratado como não confiável: qualquer `fluxoId`/`versaoId`
// dentro dele é IGNORADO. O fluxo é o do caminho da URL, conferido contra o escopo a CADA passo.
// Confiar no estado devolvido pelo cliente seria deixá-lo testar o fluxo de outra empresa mudando
// um campo do JSON.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Resolve o executor de um tipo de nó no registro do motor.
 *
 * O registro (`src/motor/nos/index.js`) é escrito por outra pessoa e o nome do que ele exporta não
 * está fixado no contrato — só está fixado que existe um registro. Em vez de apostar num nome e
 * quebrar em produção com "undefined is not a function", aceito as formas plausíveis e, quando
 * nenhuma casa, respondo dizendo isso em português em vez de estourar.
 */
function acharExecutor(registro, tipo) {
  if (!registro || !tipo) return null;
  for (const fn of [registro.obter, registro.executorDe, registro.default?.obter]) {
    if (typeof fn !== 'function') continue;
    try {
      // ⚠️ O `try` NÃO é decoração. Medido em 28/08/2026 contra o registro real
      // (`ragnabot-fluxo-nos.service.js`): `executorDe('tipo_inexistente')` LANÇA
      // `tipo de nó desconhecido: "..."` em vez de devolver nulo. Sem o `try`, um nó com tipo
      // errado no rascunho — que é exatamente o que o modo de teste existe para pegar — derrubava
      // a requisição inteira em 500, com a mensagem interna do serviço vazando para a tela, no
      // lugar do problema em português que o operador consegue agir. Uma busca não deve estourar
      // por não achar; como o registro é de outro arquivo, quem se adapta é quem consulta.
      const r = fn(tipo);
      if (r) return r;
    } catch { /* este registro não conhece o tipo; tenta a próxima forma */ }
  }
  for (const mapa of [registro.executores, registro.EXECUTORES, registro.porTipo, registro.NOS, registro.default]) {
    if (mapa && typeof mapa === 'object' && mapa[tipo]) return mapa[tipo];
  }
  if (registro[tipo] && typeof registro[tipo] === 'object') return registro[tipo];
  return null;
}

/**
 * Monta o contexto de teste: canal mudo, egresso que recusa, cofre mascarado, protocolo de mentira.
 *
 * EXPORTADA DE PROPÓSITO (é a única coisa além do router que sai daqui): a verificação permanente
 * `tests/ragnabot-fluxo-teste-nao-grava.test.mjs` precisa montar EXATAMENTE este contexto para
 * provar que o modo de teste não escreve no banco. Copiar o contexto no teste provaria a cópia, não
 * o que a rota usa — e foi a ausência de uma porta aqui que abriu o vazamento de protocolo entre
 * empresas. Quem apagar esta palavra `export` cega essa verificação.
 */
export function contextoDeTeste({ no, vars, entrada, execucaoFalsa, agora, limites, intencoes, registros }) {
  return {
    no,
    vars,
    entrada,
    execucao: execucaoFalsa,
    canal: {
      // Não envia: acumula. E devolve um identificador falso e RECONHECÍVEL — um `idExterno` com
      // cara de real levaria alguém a procurá-lo no Chatwoot e a desconfiar do Chatwoot.
      async enviar(intencao) {
        intencoes.push(intencao);
        return { idExterno: `teste:${intencoes.length}` };
      },
      async lerConversa() { return { status: 'open', assigneeId: null, labels: [] }; },
      async carimbar() { /* em teste não há conversa para carimbar */ },
    },
    egresso: {
      async chamarExterno() {
        throw new Error('O modo de teste não faz chamada externa. Este nó só executa de verdade na conversa real.');
      },
    },
    cofre: {
      async resolver(apelido) { return `[segredo:${apelido}]`; },
    },
    // ⚠️ PORTA OBRIGATÓRIA — não é conveniência, é contenção de vazamento entre empresas.
    // O nó `chamado` (e o `inicio` com `config.emitirProtocolo === true`) emite protocolo por
    // `garantirProtocolo(ctx)`, em ragnabot-fluxo-nos.service.js. Aquele helper tem três degraus:
    // (1) protocolo já na execução, (2) ESTA porta, (3) import do serviço real, que ESCREVE no
    // banco. Sem a porta, o teste do editor caía no degrau 3 e GRAVAVA em produção:
    //   • queimava um número da sequência humana da empresa (o cliente vê o buraco: RGT-…27 e
    //     depois RGT-…29), e nascia um chamado fantasma apontando para a conversa 0, visível em
    //     `listarProtocolos` e em `buscarPorProtocolo`;
    //   • pior, o par de conversa era o MESMO (0,0) para TODA empresa, e o caminho rápido de
    //     `emitirProtocolo` casa só por (cwAccountId, cwConversationId) — sem comparar empresa.
    //     A primeira empresa que testasse fincava a linha (0,0); da segunda em diante, todo teste
    //     de toda empresa recebia de volta o protocolo da PRIMEIRA. O editor da empresa B exibia
    //     "Chamado RGT-0000000028 aberto" e aprendia o prefixo e o volume de atendimento da A.
    // E a resposta ainda afirmava, na mesma requisição, que "nada foi gravado" — mentira que
    // ninguém tinha como desconfiar.
    // O número devolvido aqui é de propósito RECONHECÍVEL e fixo: quem o vir na tela sabe que está
    // olhando um ensaio, e não sai procurando `TESTE-0000000000` na lista de chamados.
    protocolo: {
      async emitirProtocolo() {
        return { protocolo: 'TESTE-0000000000', numero: 0, novo: false };
      },
    },
    limites,
    // Janela sempre aberta no teste: fechá-la faria todo teste cair no caminho de exceção, e o
    // operador nunca veria o caminho normal — que é justamente o que ele está tentando conferir.
    janela: {
      aberta: true,
      expiraEm: new Date(agora.getTime() + 23 * 3600 * 1000),
      margemSegurancaSegundos: 300,
    },
    agora,
    registrar(evento) { registros.push(evento); },
    incidente(codigo, dados) { registros.push({ tipo: 'incidente', codigo, dados }); },
  };
}

/**
 * POST /fluxos/:id/testar
 *
 * Corpo: { origem?: 'rascunho'|'versao', versaoNumero?, estado?, resposta?, vars? }
 *   - sem `estado`            → começa no nó inicial
 *   - com `estado` + `resposta` → entrega a resposta ao nó parado e segue dali
 * Resposta: { origem, saidas, parado, fim, problemas, trilha, registros, estado, aviso, limites }
 */
router.post('/fluxos/:id/testar', async (req, res) => {
  try {
    if (!exigirSchema(res)) return;
    const f = await fluxoNoEscopo(req, req.params.id);
    if (!f) return res.status(404).json(NAO_ACHOU);

    const registro = await exigirModulo(res, CAMINHOS_EXECUTORES, 'executar o modo de teste',
      ['executorDe', 'EXECUTORES', 'executores', 'obter']);
    if (!registro) return;
    const casador = (await resolverModulo(CAMINHOS_CASADOR, ['casarOpcao']))?.mod || null;

    // ── de onde vem o documento ─────────────────────────────────────────────────────────────────
    // Padrão: o RASCUNHO. É ele que o operador acabou de editar e quer conferir antes de publicar.
    let documento = null;
    let deOnde = 'rascunho';
    if (req.body?.origem === 'versao' || req.body?.versaoNumero) {
      const numero = Number(req.body?.versaoNumero);
      const v = Number.isInteger(numero)
        ? await prisma.ragnabotFluxoVersao.findUnique({ where: { fluxoId_numero: { fluxoId: f.id, numero } } })
        : (f.versaoPublicadaId
          ? await prisma.ragnabotFluxoVersao.findUnique({ where: { id: f.versaoPublicadaId } })
          : null);
      if (!v) return res.status(404).json({ error: 'Versão não encontrada.' });
      documento = v.documento;
      deOnde = `versao:${v.numero}`;
    } else {
      const r = await prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId: f.id } });
      if (!r) return res.status(404).json({ error: 'Este fluxo não tem rascunho para testar.' });
      documento = r.documento;
    }
    const forma = documentoTemForma(documento);
    if (forma) return res.status(400).json({ error: `Documento inválido: ${forma}` });

    const nosPorId = new Map((documento.nos || []).map((n) => [n.id, n]));

    // Índice de arestas por (origem, saída). O documento pode conter DUAS arestas na MESMA saída —
    // é o defeito que o banco recusa na publicação, mas que o RASCUNHO ainda carrega. Em vez de
    // escolher uma em silêncio (que é como esse defeito sobreviveu catorze meses), o teste anota a
    // ambiguidade e devolve: o operador precisa ver isso aqui, e não descobrir em produção por
    // qual ramo o motor foi.
    const arestas = new Map();
    const ambiguas = [];
    for (const a of documento.arestas || []) {
      // Separador `\0` ESCRITO COMO ESCAPE, nunca como byte cru no arquivo. O caractere continua
      // sendo o mesmo (é o separador que nenhum identificador de nó pode conter, então "a|b"+"c" e
      // "a"+"b|c" não colidem), mas um NUL literal no fonte faz o `grep` classificar o arquivo
      // inteiro como binário e devolver "binary file matches" em vez das linhas — medido aqui: a
      // busca por `execucaoFalsa` voltava VAZIA neste arquivo enquanto o código existia. Ferramenta
      // que emudece esconde defeito.
      const chave = `${a.de}\0${a.saida}`;
      if (arestas.has(chave)) ambiguas.push({ de: a.de, saida: a.saida });
      else arestas.set(chave, a.para);
    }

    // ── perfil de limites: da empresa, com retaguarda declarada ─────────────────────────────────
    let limites = null;
    const modLimites = (await resolverModulo(CAMINHOS_LIMITES, ['perfilDe', 'PERFIL_LIMITES_PADRAO']))?.mod;
    if (typeof modLimites?.perfilDe === 'function') {
      limites = await modLimites.perfilDe(f.tenantId).catch(() => null);
    } else if (modLimites?.PERFIL_LIMITES_PADRAO) {
      // O serviço de nós publica o perfil padrão como constante. Usar a constante DELE em vez de
      // uma cópia minha é o que impede editor e motor validarem contra tetos diferentes.
      limites = { perfil: 'whatsapp_cloud@2026-08', origem: 'documentacao', unidade: 'indefinida',
        valores: modLimites.PERFIL_LIMITES_PADRAO };
    }
    if (!limites) {
      // Os limites publicados da API oficial da Meta. Marcados com `origem: 'documentacao'` de
      // propósito: aviso que se declara palpite não corrói a confiança nos avisos que são regra.
      limites = {
        perfil: 'whatsapp_cloud@2026-08', origem: 'documentacao', unidade: 'indefinida',
        valores: { botoes_max: 3, lista_itens_max: 10, lista_titulo_max: 24, janela_servico_horas: 24 },
      };
    }

    // ⚠️ O "agora" vem do BANCO, não de `Date.now()` deste processo. É a mesma disciplina da
    // produção — relógio de máquina fora de sincronia decide prazo e janela de 24 h errados — e
    // manter a disciplina aqui é o que impede o teste de "funcionar" por um caminho que a produção
    // não percorre. Sem o banco, seguimos com o relógio local e dizemos isso na resposta.
    let agora = new Date();
    let origemDoRelogio = 'banco';
    try {
      const r = await prisma.$queryRaw`SELECT now() AS agora`;
      if (r?.[0]?.agora) agora = new Date(r[0].agora);
      else origemDoRelogio = 'processo';
    } catch {
      origemDoRelogio = 'processo';
    }

    // ── estado da sessão de teste (vem do navegador; nada dele além do que é meu é confiável) ───
    const estadoEntrada = req.body?.estado && typeof req.body.estado === 'object' && !Array.isArray(req.body.estado)
      ? req.body.estado
      : null;
    const vars = {
      ...(estadoEntrada?.vars && typeof estadoEntrada.vars === 'object' ? estadoEntrada.vars : {}),
      ...(req.body?.vars && typeof req.body.vars === 'object' ? req.body.vars : {}),
    };
    // ── SAÍDAS FORÇADAS — como o testador conhece um nó que SORTEIA (contrato S3, §F3.5) ────────
    // O randomizador é determinístico de propósito (mesma visita ⇒ mesmo ramo), e isso é o que o
    // torna seguro em produção. Mas num TESTE essa mesma virtude vira cegueira: o operador só
    // conseguiria percorrer uma das variantes, e aprovaria o fluxo sem nunca ter visto a outra —
    // que é a definição de falsa aprovação. `forcarSaidas` diz «neste nó, siga por ali».
    //
    // Vale para QUALQUER nó que devolva `seguir` (condição, randomizador, HTTP): é genérico de
    // propósito, porque o problema é genérico — conferir o ramo que os dados de hoje não tomam.
    // ⚠️ Só aceita saída que o nó REALMENTE declara, e registra que forçou. Um teste que desvia o
    // fluxo em silêncio é pior que teste nenhum.
    const forcarSaidas = (req.body?.forcarSaidas && typeof req.body.forcarSaidas === 'object' && !Array.isArray(req.body.forcarSaidas))
      ? req.body.forcarSaidas : {};
    const forcadas = [];

    const visitas = { ...(estadoEntrada?.visitasPorNo && typeof estadoEntrada.visitasPorNo === 'object' ? estadoEntrada.visitasPorNo : {}) };
    const trilha = Array.isArray(estadoEntrada?.trilha) ? estadoEntrada.trilha.slice(-200) : [];

    const noInicial = (documento.nos || []).find((n) => n.tipo === 'inicio')?.id || documento.nos?.[0]?.id;
    let noAtualId = (typeof estadoEntrada?.noAtualId === 'string' && estadoEntrada.noAtualId) || noInicial;
    if (!noAtualId) return res.status(400).json({ error: 'O documento não tem nenhum nó.' });

    const intencoes = [];
    const registros = [];
    const problemas = [];
    // ⚠️ A conversa do teste é NULA, não zero. Zero é um par válido: `emitirProtocolo` aceitaria,
    // gravaria, e — por ser o MESMO par (0,0) em todas as empresas — devolveria a todas o protocolo
    // da primeira que tivesse testado. Nulo é recusado logo na entrada do serviço ("conversa
    // obrigatória"). É a rede de segurança da porta `protocolo` de `contextoDeTeste`: no dia em que
    // alguém acrescentar um nó que emite e a porta não cobrir, a falha nasce BARULHENTA e LOCAL (o
    // nó devolve `falhar` com incidente legível dentro do próprio teste) em vez de silenciosa,
    // gravada em produção e compartilhada entre clientes.
    const execucaoFalsa = {
      id: 'teste', tenantId: f.tenantId, cwAccountId: null, cwConversationId: null,
      protocolo: null, visitaSeq: Number(estadoEntrada?.visitaSeq) || 0, tentativasNo: {},
    };

    let parado = null;
    let fim = null;
    let passos = 0;
    const tetoPassos = Math.min(TETO_PASSOS_TESTE, Number(f.passosPorEvento) || TETO_PASSOS_TESTE);
    let saidaPendente = null; // saída já decidida do nó atual, ainda não percorrida

    // ── 1) consumir a resposta do nó em que a sessão estava parada ──────────────────────────────
    if (estadoEntrada?.parado && req.body?.resposta != null) {
      const no = nosPorId.get(noAtualId);
      if (!no) {
        return res.status(409).json({ error: `O nó "${noAtualId}" não existe mais neste documento. Recomece o teste.` });
      }
      const exec = acharExecutor(registro, no.tipo);
      if (!exec) return res.status(501).json({ error: `Não há executor para o tipo de nó "${no.tipo}".` });

      const bruto = req.body.resposta;
      const entrada = {
        texto: typeof bruto === 'string' ? bruto : String(bruto?.texto ?? ''),
        interativo: (bruto && typeof bruto === 'object' && bruto.interativo) || null,
        anexos: [], origemEm: agora, cwMessageId: 0, wamid: null,
      };
      const ctx = contextoDeTeste({ no, vars, entrada, execucaoFalsa, agora, limites, intencoes, registros });

      if (typeof exec.receber === 'function') {
        const r = await exec.receber(ctx, entrada);
        saidaPendente = r?.saida ?? 'opcao_invalida';
        Object.assign(vars, r?.varsPatch || {});
        registros.push({ tipo: 'resposta_recebida', noId: no.id, saida: saidaPendente, viaCasamento: r?.viaCasamento || null });
      } else if (casador?.casarOpcao) {
        // Executor sem `receber` (nó que estaciona mas delega o casamento): usa a MESMA escada
        // determinística da produção. Sem casamento aproximado e sem modelo de linguagem —
        // confundir uma opção de confirmar com uma de recomeçar abre um chamado que a pessoa não
        // pediu; errar para o lado de `opcao_invalida` custa apenas uma repergunta.
        const itens = no.config?.itens || no.config?.botoes || [];
        const casou = casador.casarOpcao(entrada, itens);
        saidaPendente = casou ? casou.id : 'opcao_invalida';
        registros.push({ tipo: 'resposta_recebida', noId: no.id, saida: saidaPendente, viaCasamento: casou?.via || null });
      } else {
        return res.status(503).json({
          error: 'Componente do motor ainda não disponível: casarOpcao.',
          detalhe: `O executor de "${no.tipo}" não implementa receber(), então o casamento da resposta depende desse módulo.`,
          procurado: CAMINHOS_CASADOR,
        });
      }
      execucaoFalsa.visitaSeq += 1;
    }

    // ── 2) caminhar ─────────────────────────────────────────────────────────────────────────────
    while (passos < tetoPassos) {
      passos += 1;

      if (saidaPendente != null) {
        // Já sabemos a saída do nó atual: resolver a aresta e mover.
        const prox = arestas.get(`${noAtualId}\0${saidaPendente}`);
        trilha.push([noAtualId, saidaPendente]);
        if (!prox) {
          // Saída sem aresta é a conversa morrendo em silêncio no meio — o defeito medido em
          // produção. O teste precisa dizer isso, não seguir como se nada fosse.
          problemas.push({
            nivel: 'erro', codigo: 'ARESTA_AUSENTE', campo: `${noAtualId}.${saidaPendente}`,
            mensagem: `O nó "${noAtualId}" não tem para onde ir pela saída "${saidaPendente}". `
              + 'Na conversa real, a pessoa ficaria sem resposta.',
            comoCorrigir: 'Ligue essa saída a um nó, nem que seja a uma mensagem de encerramento.',
          });
          fim = { motivo: 'aresta_ausente', noId: noAtualId, saida: saidaPendente };
          break;
        }
        noAtualId = prox;
        saidaPendente = null;
      }

      const no = nosPorId.get(noAtualId);
      if (!no) {
        problemas.push({
          nivel: 'erro', codigo: 'NO_AUSENTE', campo: noAtualId,
          mensagem: `Uma aresta aponta para o nó "${noAtualId}", que não existe no documento.`,
        });
        fim = { motivo: 'no_ausente', noId: noAtualId };
        break;
      }

      visitas[no.id] = (visitas[no.id] || 0) + 1;
      if (visitas[no.id] > (f.visitasPorNoMax || 10)) {
        // O freio do fluxo, aplicado no teste com o MESMO valor da produção. O fluxo real medido
        // tem dois laços, e o de exceção foi acionado por 151 das 518 apresentações: laço sem teto
        // é moedor de conversa, e o teste tem que mostrar o teto batendo.
        problemas.push({
          nivel: 'erro', codigo: 'LIMITE_VISITAS', campo: no.id,
          mensagem: `O nó "${no.id}" foi visitado ${visitas[no.id]} vezes, acima do limite de `
            + `${f.visitasPorNoMax} deste fluxo. Há um laço aqui.`,
        });
        fim = { motivo: 'limite_visitas', noId: no.id };
        break;
      }

      const exec = acharExecutor(registro, no.tipo);
      if (!exec) {
        problemas.push({
          nivel: 'erro', codigo: 'TIPO_DESCONHECIDO', campo: no.id,
          mensagem: `Não há executor registrado para o tipo de nó "${no.tipo}".`,
        });
        fim = { motivo: 'tipo_desconhecido', noId: no.id, tipo: no.tipo };
        break;
      }

      const ctx = contextoDeTeste({ no, vars, entrada: null, execucaoFalsa, agora, limites, intencoes, registros });

      // `preparar` monta o que SAIRIA. É a mesma função da prévia do editor e do envio real — e é
      // isso que torna mecanicamente impossível o teste divergir da produção.
      //
      // ⚠️ DUAS FONTES PARA A MESMA MENSAGEM, E SÓ UMA PODE CONTAR. Medido em 28/08/2026 contra os
      // executores reais: eles chamam `ctx.canal.enviar(...)` DENTRO de `executar`, além de
      // `preparar` devolver a mesma intenção. Somar as duas mostrava cada mensagem DUAS VEZES na
      // prévia — e uma prévia que duplica mensagem é pior que nenhuma: leva o operador a "corrigir"
      // um envio repetido que não existe. A regra aqui: o que o nó despachou pelo canal é o que
      // SAIRIA; a saída de `preparar` só entra quando o nó não despachou nada por conta própria
      // (executor que deixa o despacho para o motor).
      const marcaDoCanal = intencoes.length;
      let previaDoNo = [];
      if (typeof exec.preparar === 'function') {
        try {
          previaDoNo = [].concat((await exec.preparar(no, ctx)) ?? []).filter(Boolean);
        } catch (e) {
          problemas.push({
            nivel: 'erro', codigo: 'ERRO_AO_PREPARAR', campo: no.id,
            mensagem: `Ao montar a mensagem do nó "${no.id}": ${e.message}`,
          });
        }
      }

      let resultado;
      try {
        resultado = await exec.executar(ctx);
      } catch (e) {
        // Cai aqui, de propósito, a recusa do egresso: um nó `http` no teste chega neste ponto, e
        // a mensagem diz que a chamada externa não acontece em teste — não é defeito do fluxo.
        problemas.push({
          nivel: 'aviso', codigo: 'NO_NAO_EXECUTAVEL_EM_TESTE', campo: no.id,
          mensagem: `Nó "${no.id}": ${e.message}`,
        });
        // Mesmo tendo falhado ao executar, o que o nó JÁ tinha montado precisa aparecer: é o que
        // permite ver que a mensagem estava certa e o problema era outro.
        if (intencoes.length === marcaDoCanal) intencoes.push(...previaDoNo);
        fim = { motivo: 'nao_executavel_em_teste', noId: no.id, detalhe: e.message };
        break;
      }

      // Consolida: se o nó não despachou nada pelo canal, a prévia é o que sairia.
      if (intencoes.length === marcaDoCanal) intencoes.push(...previaDoNo);

      if (!resultado || typeof resultado.tipo !== 'string') {
        // A união de resultados é FECHADA. Um executor que devolve outra coisa é defeito de
        // programação, e tratar isso como um "padrão" silencioso é como o fluxo toma um ramo que
        // ninguém desenhou.
        problemas.push({
          nivel: 'erro', codigo: 'RESULTADO_INVALIDO', campo: no.id,
          mensagem: `O executor de "${no.tipo}" devolveu um resultado fora do contrato.`,
        });
        fim = { motivo: 'resultado_invalido', noId: no.id };
        break;
      }

      if (resultado.tipo === 'seguir') {
        saidaPendente = resultado.saida;
        const pedida = forcarSaidas[no.id];
        if (pedida !== undefined && pedida !== null && String(pedida) !== String(saidaPendente)) {
          // A saída pedida tem de existir NESTE nó. O documento é a única fonte: aceitar qualquer
          // texto deixaria o teste seguir por uma aresta que a publicação nunca aceitaria.
          const existe = [...arestas.keys()].some((k) => k === `${no.id}\0${String(pedida)}`);
          if (existe) {
            forcadas.push({ noId: no.id, sorteada: saidaPendente, forcada: String(pedida) });
            registros.push({ tipo: 'saida_forcada', noId: no.id, saida: String(pedida), detalhe: { emVezDe: saidaPendente } });
            saidaPendente = String(pedida);
          } else {
            problemas.push({
              nivel: 'aviso', codigo: 'SAIDA_FORCADA_INEXISTENTE', campo: `${no.id}.${pedida}`,
              mensagem: `Você pediu para forçar a saída "${pedida}" no nó "${no.id}", mas ela não `
                + 'está ligada a nenhum destino neste documento. O teste seguiu pela saída que o nó decidiu.',
              comoCorrigir: 'Ligue essa saída a um nó antes de testá-la.',
            });
          }
        }
        continue;
      }

      if (resultado.tipo === 'aguardar') {
        parado = {
          motivo: resultado.motivo,
          acordarEm: resultado.acordarEm ?? null,
          saidaAoVencer: resultado.saidaAoVencer ?? null,
          // O que o operador precisa responder para continuar o teste, tirado do que `preparar`
          // acabou de montar — não de um palpite sobre o formato do nó.
          opcoes: (intencoes[intencoes.length - 1]?.itens || intencoes[intencoes.length - 1]?.botoes || [])
            .map((o) => ({ id: o.id, rotulo: o.titulo || o.rotulo })),
        };
        trilha.push([no.id, `aguardando:${resultado.motivo}`]);
        break;
      }

      if (resultado.tipo === 'saltar') {
        // Sub-fluxo é outro documento, de outra árvore, possivelmente de outra versão. Segui-lo
        // aqui exigiria carregar e conferir o escopo do outro fluxo — trabalho legítimo, que eu
        // NÃO fiz. Dizer "não sigo" é honesto; seguir por engano no fluxo errado, não.
        trilha.push([no.id, 'saltar']);
        fim = {
          motivo: 'subfluxo_nao_seguido', noId: no.id, fluxoId: resultado.fluxoId, modo: resultado.modo,
          detalhe: 'O modo de teste não entra em sub-fluxo. Teste o sub-fluxo separadamente.',
        };
        break;
      }

      if (resultado.tipo === 'terminar') {
        trilha.push([no.id, 'fim']);
        fim = { motivo: 'concluido', estado: resultado.estado, noId: no.id };
        break;
      }

      if (resultado.tipo === 'falhar') {
        problemas.push({
          nivel: 'erro', codigo: resultado.incidente?.codigo || 'ERRO_NO', campo: no.id,
          mensagem: resultado.incidente?.mensagemOperador || `O nó "${no.id}" falhou.`,
          comoCorrigir: resultado.incidente?.comoCorrigir || null,
        });
        saidaPendente = resultado.saida;
        continue;
      }

      problemas.push({
        nivel: 'erro', codigo: 'RESULTADO_DESCONHECIDO', campo: no.id,
        mensagem: `Resultado "${resultado.tipo}" não é reconhecido pelo motor.`,
      });
      fim = { motivo: 'resultado_desconhecido', noId: no.id };
      break;
    }

    if (!parado && !fim && passos >= tetoPassos) {
      fim = {
        motivo: 'teto_de_passos',
        detalhe: `O teste parou após ${tetoPassos} passos sem chegar a um fim. Provável laço.`,
      };
      problemas.push({ nivel: 'erro', codigo: 'TETO_DE_PASSOS', campo: noAtualId, mensagem: fim.detalhe });
    }
    for (const a of ambiguas) {
      problemas.push({
        nivel: 'erro', codigo: 'SAIDA_COM_DUAS_ARESTAS', campo: `${a.de}.${a.saida}`,
        mensagem: `A saída "${a.saida}" do nó "${a.de}" tem mais de uma aresta. O banco recusa isso `
          + 'na publicação; aqui o teste seguiu pela primeira.',
        comoCorrigir: 'Apague a aresta sobrando: uma saída leva a um destino só.',
      });
    }

    res.json(semBigInt({
      origem: deOnde,
      // Tudo o que SAIRIA para o cliente, na ordem, sem que nada tenha saído.
      saidas: intencoes,
      // O que o teste DESVIOU de propósito. Sai declarado para ninguém ler a trilha achando que
      // foi o motor que escolheu aquele ramo.
      forcadas,
      parado,
      fim,
      problemas,
      trilha,
      registros,
      estado: {
        noAtualId, vars, visitasPorNo: visitas, trilha,
        visitaSeq: execucaoFalsa.visitaSeq, parado: !!parado,
      },
      relogio: { agora, origem: origemDoRelogio },
      limites: { perfil: limites.perfil, origem: limites.origem, unidade: limites.unidade },
      aviso: 'Modo de teste: nenhuma mensagem foi enviada, nenhuma chamada externa foi feita, '
        + 'nenhum segredo foi decifrado e nada foi gravado.'
        + (forcadas.length ? ` ${forcadas.length} saída(s) foram FORÇADAS por você — a trilha abaixo não é a que o motor teria tomado sozinho.` : ''),
    }));
  } catch (e) { erro(res, e, 500); }
});

export default router;
