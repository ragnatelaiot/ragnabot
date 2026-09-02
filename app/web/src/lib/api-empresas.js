// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA TELA DE EMPRESAS (contrato S4-EMPRESAS, 30/08/2026)
//
// O dono cobrou: «ainda não vi tela para criar empresas». Estava certo — a API de multiempresa
// existe desde 28/08 e funciona, mas nunca houve tela. Cadastrar empresa só por chamada de API
// significa, na prática, que só o Claude cadastra. Isto aqui é o lado da rede dessa tela.
//
// ── POR QUE UM ARQUIVO SEPARADO DE `lib/api.js` ─────────────────────────────────────────────────
// `lib/api.js` é do editor de fluxo: seu `chamarFluxo` tem `BASE_FLUXO` fixo e a API de fluxo NÃO
// usa envelope. A API de empresas mora em outro prefixo (`/api/ragnabot`) e responde SEMPRE
// `{ success, data }` / `{ success, error }`. Enfiar as duas convenções na mesma função daria uma
// função com dois modos — e função com dois modos erra no modo errado. O que reaproveito de lá é o
// que TEM de ser único: `sessaoExpirada`, para 401 derrubar a sessão por um caminho só.
//
// ⛔ NENHUMA CREDENCIAL AQUI. A sessão é cookie HttpOnly assinado, emitido por `src/rotas-sessao.js`
// e mandado pelo navegador sozinho — por isso `credentials: 'same-origin'` em todo pedido. Nada de
// `localStorage`, nada de cabeçalho de ator: `x-ragnabot-ator-papel` só vale junto do token de
// serviço (ponte NOC→Ragnabot), e mandá-lo daqui seria o defeito que o cookie fechou.
//
// ── A VALIDAÇÃO MORA AQUI, E NÃO NA TELA (decisão) ──────────────────────────────────────────────
// `criarEmpresa` RECUSA antes de tocar na rede quando o identificador está fora do formato. Não é
// enfeite de usabilidade: a recusa é uma propriedade do MÓDULO, e por isso dá para prová-la com um
// dublê de `fetch` contando chamadas (`tests/empresas.smoke.mjs`). Validação que só existe dentro
// de um `onSubmit` de componente é validação que ninguém consegue medir.
// As regras são CÓPIA das do servidor (`services/ragnabot-tenant.service.js`, RE_SLUG/RE_EMAIL e
// os limites de tamanho) — cópia declarada, não releitura. ⚠️ Se um dia mudarem lá, mudam aqui;
// quem dá o veredito continua sendo o servidor, isto aqui só evita a viagem perdida.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

/** Onde `servidor.js` monta `routes/ragnabot-tenant.routes.js`. Mesmo caminho do NOC, de propósito.
 *  ⭐ Passa pelo prefixo do deploy desde 02/09/2026 — ver `lib/prefixo.js`. */
export const BASE_EMPRESAS = caminhoDoApp('/api/ragnabot');

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. O PEDIDO
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Chama a API de empresas e DESEMBRULHA o envelope `{success, data}`.
 *
 * Regras iguais às do editor de fluxo, e pelos mesmos motivos:
 *   · lê como texto antes do `JSON.parse` — um 404 em HTML do proxy vira mensagem legível, e não
 *     "Unexpected token < in JSON";
 *   · 401 derruba a sessão por UM caminho só (`sessaoExpirada`);
 *   · 403 com `code: 'INVALID_2FA'` NUNCA desloga — é código errado, não sessão perdida.
 */
export async function chamarEmpresas(caminho, { metodo = 'GET', corpo, tempoLimiteMs = 30000 } = {}) {
  const opcoes = {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (corpo !== undefined) opcoes.body = JSON.stringify(corpo);

  let idTempo = null;
  if (tempoLimiteMs && typeof AbortController === 'function') {
    const ctrl = new AbortController();
    idTempo = setTimeout(() => ctrl.abort(), tempoLimiteMs);
    opcoes.signal = ctrl.signal;
  }

  let resposta;
  try {
    resposta = await fetch(`${BASE_EMPRESAS}${caminho}`, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw erro('O servidor demorou demais para responder.', { status: 0 });
    throw erro('Não consegui falar com o servidor.', { status: 0 });
  } finally {
    if (idTempo) clearTimeout(idTempo);
  }

  const texto = await resposta.text();
  let corpoLido = null;
  if (texto) { try { corpoLido = JSON.parse(texto); } catch { corpoLido = null; } }

  if (resposta.status === 401) {
    sessaoExpirada('expired');
    throw erro('Sessão encerrada — entre de novo.', { status: 401 });
  }

  // ⚠️ O envelope pode dizer `success:false` COM status 200? Hoje não — mas conferir os dois é o
  // que impede um `success:false` silencioso virar "deu certo" na tela.
  if (!resposta.ok || corpoLido?.success === false) {
    throw erro(
      corpoLido?.error || `Erro HTTP ${resposta.status}`,
      { status: resposta.status, code: corpoLido?.code, dados: corpoLido },
    );
  }
  // A resposta 503 de rota não montada (`ROTA_PENDENTE`) cai no ramo acima com `detalhe` em `dados`.
  return corpoLido?.data ?? corpoLido ?? {};
}

function erro(mensagem, extras = {}) {
  return Object.assign(new Error(mensagem), extras);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. LEITURA
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Catálogo de planos e canais. `{ planos: [{chave, rotulo, agentes, caixas, …}], canais: {} }` */
export const lerPlanos = () => chamarEmpresas('/planos');

/** A integração com a plataforma está de pé? Não cria nada. */
export const lerSaude = () => chamarEmpresas('/saude');

/** Lista de empresas. `status` opcional filtra no servidor. */
export const lerEmpresas = (status = null) =>
  chamarEmpresas(`/tenants${status ? `?status=${encodeURIComponent(status)}` : ''}`);

/** Uma empresa, com eventos e caixas. */
export const lerEmpresa = (id) => chamarEmpresas(`/tenants/${encodeURIComponent(id)}`);

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. VALIDAÇÃO — cópia declarada das regras do servidor
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** ⚠️ CÓPIA de `RE_SLUG` do serviço. Começa e termina em letra/número; 3 a 40 no total. */
export const RE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
/** ⚠️ CÓPIA de `RE_EMAIL` do serviço. Proposital: aceita o que o servidor aceita, nem mais nem menos. */
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A frase que o servidor devolve quando o identificador é recusado — a mesma, para o operador não
 *  ler duas explicações diferentes do mesmo "não". */
export const EXPLICACAO_DO_SLUG =
  'Identificador inválido: use de 3 a 40 caracteres, apenas letras minúsculas, números e hífen, '
  + 'começando e terminando com letra ou número.';

/** Sugere um identificador a partir do nome. É sugestão: o operador pode trocar. */
export function sugerirSlug(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento: "Ragnatela Soluções" → "solucoes"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');                                 // o corte em 40 pode ter deixado hífen no fim
}

/**
 * Confere o cadastro com as MESMAS regras do servidor.
 * @returns {{ok:boolean, erros:Object<string,string>}} — `erros` é por campo, para a tela pintar
 *          a mensagem ao lado do campo que a causou (aviso solto no topo ninguém associa a nada).
 */
export function validarCadastro(dados = {}) {
  const erros = {};
  const nome = String(dados.nome ?? '').trim();
  const slug = String(dados.slug ?? '').trim().toLowerCase();
  const contatoNome = String(dados.contatoNome ?? '').trim();
  const contatoEmail = String(dados.contatoEmail ?? '').trim().toLowerCase();
  const plano = String(dados.plano ?? '').trim();

  if (nome.length < 2) erros.nome = 'Campo obrigatório: nome da empresa (mínimo 2 caracteres).';
  else if (nome.length > 120) erros.nome = 'O nome da empresa excede 120 caracteres.';

  if (!slug) erros.slug = 'Campo obrigatório: identificador.';
  else if (slug.length < 3 || slug.length > 40 || !RE_SLUG.test(slug)) erros.slug = EXPLICACAO_DO_SLUG;

  if (contatoNome.length < 2) erros.contatoNome = 'Campo obrigatório: nome do contato (mínimo 2 caracteres).';
  else if (contatoNome.length > 120) erros.contatoNome = 'O nome do contato excede 120 caracteres.';

  if (!contatoEmail) erros.contatoEmail = 'Campo obrigatório: e-mail do contato.';
  else if (contatoEmail.length > 160) erros.contatoEmail = 'O e-mail do contato excede 160 caracteres.';
  else if (!RE_EMAIL.test(contatoEmail)) erros.contatoEmail = 'E-mail do contato inválido.';

  if (!plano) erros.plano = 'Escolha o plano da empresa.';

  // CNPJ e WhatsApp são opcionais no servidor (ele só tira o que não é dígito). Conferimos o
  // tamanho para não mandar um CNPJ pela metade achando que foi aceito inteiro.
  const cnpj = so_digitos(dados.cnpj);
  if (cnpj && cnpj.length !== 14) erros.cnpj = 'O CNPJ tem 14 dígitos. Deixe em branco se não tiver.';
  const zap = so_digitos(dados.contatoWhatsapp);
  if (zap && (zap.length < 10 || zap.length > 15)) erros.contatoWhatsapp = 'WhatsApp com DDD, de 10 a 15 dígitos. Deixe em branco se não tiver.';

  return { ok: Object.keys(erros).length === 0, erros };
}

function so_digitos(v) {
  return v == null ? '' : String(v).replace(/\D/g, '');
}

/** Monta o corpo do jeito que o servidor espera (minúsculas, só dígitos, opcionais fora quando vazios). */
export function corpoDoCadastro(dados = {}) {
  const cnpj = so_digitos(dados.cnpj).slice(0, 14);
  const zap = so_digitos(dados.contatoWhatsapp).slice(0, 15);
  return {
    nome: String(dados.nome ?? '').trim(),
    slug: String(dados.slug ?? '').trim().toLowerCase(),
    contatoNome: String(dados.contatoNome ?? '').trim(),
    contatoEmail: String(dados.contatoEmail ?? '').trim().toLowerCase(),
    plano: String(dados.plano ?? '').trim(),
    ...(cnpj ? { cnpj } : {}),
    ...(zap ? { contatoWhatsapp: zap } : {}),
  };
}

/** Erro de recusa LOCAL — nasce aqui, sem rede. `status: 0` e `local: true` para a tela saber que
 *  não adianta "tentar de novo": o servidor nem foi consultado. */
export class ErroDeValidacao extends Error {
  constructor(mensagem, erros = {}) {
    super(mensagem);
    this.name = 'ErroDeValidacao';
    this.status = 0;
    this.local = true;
    this.erros = erros;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 4. AÇÕES SENSÍVEIS — o aperto de mão de 2FA, exatamente como o servidor o desenhou
//
// `portao()` em `ragnabot-tenant.routes.js` responde em DUAS etapas:
//   1º pedido SEM `otpCode`  → HTTP 200 com `{ needs2fa:true, channels, emailHint }`  ← não é erro
//   2º pedido COM `otpCode` + `justificativa` → executa (ou 403 INVALID_2FA / 400 sem justificativa)
//
// ⚠️ O 200 do primeiro passo é a armadilha desta API: quem tratar "200 = deu certo" vai mostrar
// «empresa criada» sem ter criado nada. Por isso o retorno daqui é explícito — `precisaDe2fa` é um
// campo, não uma inferência.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{precisaDe2fa:boolean, canais?:object, dicaDeEmail?:string, dados?:object}>}
 */
export async function acaoSensivel(caminho, corpo = {}, { metodo = 'POST' } = {}) {
  const data = await chamarEmpresas(caminho, { metodo, corpo });
  if (data && data.needs2fa) {
    return {
      precisaDe2fa: true,
      canais: data.channels || {},
      dicaDeEmail: data.emailHint || null,
    };
  }
  return { precisaDe2fa: false, dados: data };
}

/** Pede o código do segundo fator. `canal` = 'email' | 'totp'. */
export const pedirCodigo = (canal = 'email') =>
  chamarEmpresas('/2fa/request-otp', { metodo: 'POST', corpo: { channel: canal === 'totp' ? 'totp' : 'email' } });

/** As credenciais do segundo passo, sempre juntas: código + canal + justificativa. */
function comCredencial(corpo, cred = {}) {
  const saida = { ...corpo };
  if (cred.otpCode) { saida.otpCode = cred.otpCode; saida.otpChannel = cred.otpChannel || 'email'; }
  if (cred.justificativa) saida.justificativa = cred.justificativa;
  return saida;
}

/**
 * Cria a empresa. RECUSA ANTES DA REDE quando o cadastro não passa nas regras do servidor —
 * é a recusa que o teste mede.
 */
export async function criarEmpresa(dados, cred = {}) {
  const v = validarCadastro(dados);
  if (!v.ok) {
    const primeiro = Object.values(v.erros)[0];
    throw new ErroDeValidacao(primeiro, v.erros);
  }
  return acaoSensivel('/tenants', comCredencial(corpoDoCadastro(dados), cred));
}

export const alterarPlano = (id, plano, cred = {}) =>
  acaoSensivel(`/tenants/${encodeURIComponent(id)}/plan`, comCredencial({ plano }, cred), { metodo: 'PATCH' });

export const suspenderEmpresa = (id, cred = {}) =>
  acaoSensivel(`/tenants/${encodeURIComponent(id)}/suspend`, comCredencial({}, cred));

export const reativarEmpresa = (id, cred = {}) =>
  acaoSensivel(`/tenants/${encodeURIComponent(id)}/reactivate`, comCredencial({}, cred));

/**
 * Encerra o contrato. O servidor NÃO exige o identificador digitado aqui (só no expurgo) — quem
 * exige é esta camada, por decisão do contrato S4-EMPRESAS: encerrar tira o acesso de toda a
 * equipe do cliente e um clique errado não tem desfazer barato.
 */
export async function encerrarEmpresa(id, { slugDaEmpresa, confirmacaoSlug } = {}, cred = {}) {
  exigirSlugDigitado(slugDaEmpresa, confirmacaoSlug);
  return acaoSensivel(`/tenants/${encodeURIComponent(id)}/close`, comCredencial({}, cred));
}

/**
 * Exclusão DEFINITIVA. Irreversível: apaga a conta da empresa e as conversas dos clientes dela.
 * A conferência do identificador é feita nos DOIS lados de propósito — aqui para não gastar um
 * código de 2FA numa digitação errada, e no servidor porque é lá que a garantia vale.
 */
export async function excluirDefinitivamente(id, { slugDaEmpresa, confirmacaoSlug } = {}, cred = {}) {
  exigirSlugDigitado(slugDaEmpresa, confirmacaoSlug);
  return acaoSensivel(
    `/tenants/${encodeURIComponent(id)}/purge`,
    comCredencial({ confirmacaoSlug: String(confirmacaoSlug).trim() }, cred),
  );
}

/** Link de uso único para o painel do cliente. É acesso a dado de terceiro: motivo obrigatório. */
export const linkDeAcesso = (id, cred = {}) =>
  acaoSensivel(`/tenants/${encodeURIComponent(id)}/sso`, comCredencial({}, cred));

/** `true` quando o texto digitado é exatamente o identificador. Comparação exata, sem `trim` de
 *  gentileza no meio: o servidor compara `String(confirmacaoSlug) !== t.slug`. */
export function confirmacaoConfere(slugDaEmpresa, digitado) {
  return !!slugDaEmpresa && String(digitado ?? '').trim() === String(slugDaEmpresa);
}

function exigirSlugDigitado(slugDaEmpresa, digitado) {
  if (!confirmacaoConfere(slugDaEmpresa, digitado)) {
    throw new ErroDeValidacao(
      `Confirmação inválida: digite o identificador exato da empresa ("${slugDaEmpresa}") para continuar.`,
      { confirmacaoSlug: 'O identificador digitado não confere.' },
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 5. DIAGNÓSTICO — três defeitos MEDIDOS do lado do servidor, em 30/08/2026
//
// Estas três mensagens não são hipótese: foram observadas montando o router num Express de teste e
// batendo nas rotas. Elas aparecem como AJUDA ao lado da mensagem do servidor — nunca no lugar
// dela. Trocar a mensagem do servidor pela nossa é como se esconde um erro novo dentro de um
// diagnóstico velho.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export function diagnosticar(e) {
  const m = String(e?.message || '');
  if (/device\.service\.js/.test(m)) {
    return 'A trava de grupo desta rota ainda importa `services/device.service.js`, que ficou no NOC '
      + '(doc 33 §8). Enquanto ele não virar peça da camada de base, só quem chega com papel de '
      + 'super (a ponte NOC→Ragnabot) passa deste ponto — quem entra pela tela recebe 500.';
  }
  if (/reading 'findUnique'/.test(m)) {
    return 'O passo de 2FA procura a tabela de usuários do NOC (`prisma.user`), que não existe na base '
      + 'do Ragnabot — o schema daqui tem só os 40 modelos do produto. Enquanto o segundo fator não '
      + 'mudar de casa, nenhuma ação que exige código consegue nem perguntar o código.';
  }
  if (/otp\.service\.js/.test(m)) {
    return 'O serviço que confere o código (`services/otp.service.js`) ficou no NOC. O doc 33 §8 já '
      + 'decidiu que identidade e 2FA mudam de casa; até lá, a ação com código é recusada.';
  }
  if (/ROTA_PENDENTE/.test(String(e?.code || '')) || /rota indisponível/i.test(m)) {
    return 'O motor subiu com esta rota NÃO montada — o `/saude` do motor lista a pendência com o '
      + 'motivo exato. Não é permissão, é peça faltando na instalação.';
  }
  return null;
}
