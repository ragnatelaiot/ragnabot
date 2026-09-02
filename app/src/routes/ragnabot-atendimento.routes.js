// ════════════════════════════════════════════════════════════════════════════════════════════════
// ROTAS — AUTOMAÇÕES DO ATENDIMENTO (configuração por EMPRESA e por CAIXA DE ENTRADA).
//
// É a "aba de Automações" que a conexão do Chatwoot 4.17.1 não tem. Medido em 29/08 e registrado em
// `/ia/.claude/modulo-atendimento/29-AUTOMACOES-DO-ATENDIMENTO.md` §4.1: as abas existentes de uma
// caixa são Ajustes, Colaboradores, Horário comercial, CSAT, Configuração, Configuração do bot e
// Saúde da conta — nenhuma comporta relógio de inatividade com escolha de lado, intervalo de almoço
// ou fluxo do primeiro "oi". Por isso a configuração mora em tabelas NOSSAS (`RagnabotAtend*`), e
// não em colunas de uma base cuja procedência ainda não confirmamos (§8.3 do mesmo documento).
//
// ── MONTAGEM (escrever esta linha em src/server.js, perto das outras rotas do Ragnabot) ──────────
//   app.use('/api/ragnabot-atendimento', authMiddleware,
//     (await import('./routes/ragnabot-atendimento.routes.js')).default);
//
// ⚠️ O mount leva SÓ `authMiddleware`, de propósito — NÃO ponha `adminOnly` nele. Mesmo raciocínio
// já aplicado em `ragnabot-auditoria.routes.js`: o administrador de uma EMPRESA CLIENTE
// (`clientRole='client_admin'`, cuja `role` do NOC é 'user') precisa configurar as automações da
// caixa dele. Quem pode ESCREVER é decidido aqui dentro, por `exigeEscrita`; o que cada um ENXERGA
// é decidido por `escopoDe`. Pôr `adminOnly` no mount trancaria justamente o dono da configuração.
//
// ── A REGRA INEGOCIÁVEL DESTE ARQUIVO ───────────────────────────────────────────────────────────
// O `tenantId` NUNCA vem da tela para ampliar alcance. Ele é derivado do usuário logado por
// `escopoDe()` (espelhado de `ragnabot-auditoria.service.js`, que continua sendo a única fonte da
// verdade sobre escopo). Um `tenantId` no corpo ou na consulta só é aceito quando o usuário é super
// e, portanto, já podia ver tudo — nesse caso ele ESTREITA, jamais ALARGA. Foi confiando na empresa
// que a TELA mandava que o sistema antigo vazou.
//
// ⚠️ LIMITE DECLARADO, e falha FECHADA: `escopoDe` deriva a empresa de `user.ragnabotTenantId ||
// user.clientCompanyId`. O JWT emitido hoje (`generateToken`) carrega `clientCompanyId`, que é id de
// `ClientCompany` — entidade diferente de `RagnabotTenant`. Enquanto o vínculo entre as duas não for
// materializado, um admin de empresa cai em "nenhuma política casa" e vê VAZIO. Vazio é o lado
// seguro do erro; o oposto (ver a empresa errada) seria vazamento. Corrigir isto é mudar `escopoDe`
// — um arquivo só —, e não espalhar mais uma regra de escopo por aqui.
//
// ── FRONTEIRA DE DONO ───────────────────────────────────────────────────────────────────────────
// Este arquivo é CONFIGURAÇÃO. O relógio vivo (`RagnabotAtendRelogio`), o registro de transferência
// (`RagnabotAtendTransferencia`) e o resolvedor de entrada do §5.2 são de outros arquivos e não são
// tocados aqui. E para não nascerem DUAS verdades sobre expediente, as decisões do domínio ("está
// aberto agora?", "qual é a chave do escopo?", "qual valor prevalece na herança?") são IMPORTADAS
// de `ragnabot-atendimento.service.js` — nenhuma delas é reescrita neste arquivo. A rota valida a
// entrada, isola por empresa, grava e audita; o serviço decide.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import prisma from '../base/db.js';
import { escopoDe, registrar } from '../services/ragnabot-auditoria.service.js';
import { logAction } from '../base/auditoria.js';
import { exigirIdDeContaValido } from '../services/ragnabot-tenant.service.js';
// ⚠️ AS DECISÕES DO DOMÍNIO VÊM DAQUI, NÃO DAQUI DE DENTRO. "Está aberto agora?", "qual é a chave do
// escopo?" e "qual valor prevalece na herança?" são perguntas com UMA resposta no projeto — a do
// serviço. Reescrevê-las nas rotas produziria a tela dizendo "intervalo" enquanto o trabalhador
// entende "fora de hora", e o operador ficaria sem saber em qual das duas acreditar. Às rotas cabe
// o que é delas: validar a entrada, isolar por empresa, gravar e auditar.
import {
  avaliarExpediente, escopoChaveDe, mesclarPoliticas, hhmm,
  MOTIVOS_EXPEDIENTE, MODOS_INATIVIDADE, ACOES_INATIVIDADE, ESCOPOS,
} from '../services/ragnabot-atendimento.service.js';

const router = Router();

const erro = (res, e, status = 400) =>
  res.status(status).json({ error: (e && e.message) || String(e) });

// ── VOCABULÁRIO FECHADO ─────────────────────────────────────────────────────────────────────────
// Listas curtas e conferidas contra §4.1 da especificação. String livre em coluna de decisão é como
// nasce o quinto valor que nenhum trabalhador sabe tratar — e que só aparece em produção.
// `ESCOPOS`, `MODOS_INATIVIDADE` e `ACOES_INATIVIDADE` chegam do serviço: lista de valores válidos
// escrita em dois lugares diverge no primeiro valor novo, e quem descobre é o cliente.
const CONTAS = Object.values(MODOS_INATIVIDADE); // de QUEM é o silêncio que conta
const ACOES = Object.values(ACOES_INATIVIDADE);
const TIPOS_EXCECAO = ['fechado', 'janela_especial'];

const MIN_DIA = 1440; // minutos em um dia — o expediente é medido em minutos desde a meia-noite
const MIN_SEMANA = MIN_DIA * 7;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GUARDA DE MIGRAÇÃO
//
// Os modelos `RagnabotAtend*` são de outro arquivo (prisma/schema.prisma) e podem ainda não ter
// migrado quando este router subir. Sem esta guarda, a rota estouraria um TypeError cru
// ("Cannot read properties of undefined") e o operador leria "erro 500" sem a menor pista. 503 com
// texto claro diz o que fazer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const MODELOS = ['ragnabotAtendPolitica', 'ragnabotAtendExpediente', 'ragnabotAtendExcecaoData'];
function modelosProntos() {
  return MODELOS.every((m) => prisma[m] && typeof prisma[m].findMany === 'function');
}
function exigeModelos(_req, res, next) {
  if (modelosProntos()) return next();
  return res.status(503).json({
    error: 'As tabelas de automação do atendimento ainda não foram migradas neste banco. '
      + 'Aplique a migração dos modelos RagnabotAtend* antes de usar esta tela.',
    code: 'MODELO_AUSENTE',
  });
}

// ── PERMISSÃO DE ESCRITA ────────────────────────────────────────────────────────────────────────
// Ler é do escopo; escrever é de quem administra. `isSuperuser` entra sempre — política permanente
// da casa (super ⊇ admin em tudo).
function podeEscrever(user) {
  if (!user) return false;
  return user.isSuperuser === true || user.role === 'admin' || user.clientRole === 'client_admin';
}
function exigeEscrita(req, res, next) {
  if (podeEscrever(req.user)) return next();
  return res.status(403).json({ error: 'Sem permissão para alterar as automações do atendimento.' });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AUXILIARES DE VALIDAÇÃO
// ════════════════════════════════════════════════════════════════════════════════════════════════
function inteiro(valor, { min = -Infinity, max = Infinity, campo }) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new Error(`${campo}: informe um número inteiro`);
  if (n < min || n > max) throw new Error(`${campo}: fora da faixa permitida (${min}..${max})`);
  return n;
}

function texto(valor, { max = 4000, campo }) {
  const s = String(valor);
  if (s.length > max) throw new Error(`${campo}: texto acima de ${max} caracteres`);
  return s;
}

// Fuso conferido pelo próprio ICU do Node, não por lista nossa: lista de fusos escrita à mão
// envelhece e passa a recusar fuso legítimo. `America/Fortaleza` é o padrão porque a caixa 1 do
// Ragnabot está em UTC (medido 29/08) e herdar dali erraria todo horário em 3 h — erro que aparece
// como "o robô respondeu fora de hora", que ninguém liga ao fuso.
function fusoValido(f) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: String(f) }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** "08:30" ou 510 → 510. Aceita os dois formatos porque a tela manda hora e o banco guarda minuto. */
export function minutosDeHora(v, campo = 'horário') {
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    return inteiro(v, { min: 0, max: MIN_DIA, campo });
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) throw new Error(`${campo}: use HH:MM (ex.: 08:30) ou minutos desde a meia-noite`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || h * 60 + min > MIN_DIA) throw new Error(`${campo}: horário inexistente`);
  return h * 60 + min;
}

/**
 * Monta o trio de escopo e a CHAVE CALCULADA.
 *
 * A chave existe porque `@@unique([tenantId, escopoChave])` sobre colunas anuláveis seria carimbo
 * decorativo: no Postgres NULO não é igual a NULO, então duas políticas de empresa (ambas com
 * cwInboxId e cwTeamId nulos) escapariam do índice e a empresa acordaria com duas configurações
 * contraditórias sem ninguém ter feito nada errado. Mesmo remédio de `RagnabotFluxoEntrada.chave`.
 *
 * A chave NUNCA é aceita do cliente — é derivada. Aceitá-la permitiria escrever escopo 'empresa'
 * com chave 'caixa:42' e quebrar a unicidade por fora.
 */
export function montarEscopoChave({ escopo, cwInboxId, cwTeamId }) {
  if (!ESCOPOS.includes(escopo)) throw new Error(`escopo: use um de ${ESCOPOS.join(' | ')}`);
  if (escopo === 'empresa') {
    return { escopo, cwInboxId: null, cwTeamId: null, escopoChave: escopoChaveDe({ escopo }) };
  }
  if (escopo === 'caixa') {
    const id = inteiro(cwInboxId, { min: 1, campo: 'cwInboxId' });
    return { escopo, cwInboxId: id, cwTeamId: null, escopoChave: escopoChaveDe({ escopo, cwInboxId: id }) };
  }
  const id = inteiro(cwTeamId, { min: 1, campo: 'cwTeamId' });
  return { escopo, cwInboxId: null, cwTeamId: id, escopoChave: escopoChaveDe({ escopo, cwTeamId: id }) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMPOS DA POLÍTICA — tabela única, para a validação e a herança lerem a MESMA lista.
//
// `heranca: true` marca o campo que participa da herança empresa → caixa → time. Quase todo campo
// é ANULÁVEL de propósito: nulo significa "herda", não "desligado". Booleano não-anulável obrigaria
// cada setor a repetir a configuração inteira da empresa — a dispersão que o documento combate.
//
// ⚠️ Os campos da PAUSA (`distribuicaoPausada`, `pausadaAte`, `pausadaMotivo`, `pausadaPorUserId`)
// NÃO estão nesta lista de propósito: têm rotas próprias, porque `pausadaPorUserId` tem de vir do
// usuário logado e jamais do corpo da requisição — quem pausou a distribuição da empresa é dado de
// auditoria, não campo de formulário.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const CAMPOS = {
  ativa: { tipo: 'bool' },
  fuso: { tipo: 'fuso', heranca: true },

  inatividadeAtiva: { tipo: 'bool', heranca: true },
  inatividadeMinutos: { tipo: 'int', min: 1, max: 10080, nulo: true, heranca: true },
  inatividadeConta: { tipo: 'enum', valores: CONTAS, nulo: true, heranca: true },
  inatividadeAcao: { tipo: 'enum', valores: ACOES, nulo: true, heranca: true },
  inatividadeTimeDestino: { tipo: 'int', min: 1, nulo: true, heranca: true },
  inatividadeMensagem: { tipo: 'texto', nulo: true, heranca: true },
  inatividadeAvisoMinutos: { tipo: 'int', min: 1, max: 10080, nulo: true, heranca: true },
  inatividadeAvisoMensagem: { tipo: 'texto', nulo: true, heranca: true },
  inatividadeContaForaExpediente: { tipo: 'bool', heranca: true },

  transbordoAtivo: { tipo: 'bool', heranca: true },
  transbordoMinutos: { tipo: 'int', min: 1, max: 10080, nulo: true, heranca: true },
  transbordoTimeId: { tipo: 'int', min: 1, nulo: true, heranca: true },
  transbordoMensagem: { tipo: 'texto', nulo: true, heranca: true },

  fluxoPrimeiroContatoId: { tipo: 'fluxo', nulo: true, heranca: true },
  fluxoPadraoId: { tipo: 'fluxo', nulo: true, heranca: true },
  fluxoForaExpedienteId: { tipo: 'fluxo', nulo: true, heranca: true },
  reiniciaFluxoAposHoras: { tipo: 'int', min: 1, max: 8760, heranca: true },

  msgSaudacao: { tipo: 'texto', nulo: true, heranca: true },
  msgForaExpediente: { tipo: 'texto', nulo: true, heranca: true },
  msgIntervalo: { tipo: 'texto', nulo: true, heranca: true },
  msgFeriado: { tipo: 'texto', nulo: true, heranca: true },
  msgTransferenciaTime: { tipo: 'texto', nulo: true, heranca: true },
  msgTransferenciaAgente: { tipo: 'texto', nulo: true, heranca: true },
  msgAtendenteIndisponivel: { tipo: 'texto', nulo: true, heranca: true },
  msgDespedidaEspera: { tipo: 'texto', nulo: true, heranca: true },

  encerrarAposForaExpediente: { tipo: 'bool', heranca: true },
};

/** Converte e valida UM campo. Devolve o valor pronto para o banco. */
function valorDoCampo(nome, bruto) {
  const def = CAMPOS[nome];
  if (bruto === null || bruto === '') {
    // Vazio da tela é "herda"/"sem valor" — mas só onde o campo aceita nulo. Em campo obrigatório,
    // aceitar vazio gravaria nulo em coluna NOT NULL e o erro apareceria como 500 sem explicação.
    if (def.nulo) return null;
    throw new Error(`${nome}: campo obrigatório, não pode ficar vazio`);
  }
  switch (def.tipo) {
    case 'bool':
      if (typeof bruto === 'boolean') return bruto;
      if (bruto === 'true' || bruto === 'false') return bruto === 'true';
      throw new Error(`${nome}: informe verdadeiro ou falso`);
    case 'int':
      return inteiro(bruto, { min: def.min, max: def.max, campo: nome });
    case 'texto':
      return texto(bruto, { campo: nome });
    case 'enum':
      if (!def.valores.includes(String(bruto))) {
        throw new Error(`${nome}: use um de ${def.valores.join(' | ')}`);
      }
      return String(bruto);
    case 'fuso':
      if (!fusoValido(bruto)) throw new Error(`${nome}: fuso desconhecido (ex.: America/Fortaleza)`);
      return String(bruto);
    case 'fluxo':
      return String(bruto); // existência e dono conferidos depois, no banco (conferirFluxos)
    default:
      throw new Error(`${nome}: tipo não previsto`);
  }
}

/** Aplica só os campos PRESENTES no corpo — PATCH parcial de verdade, sem apagar o que não veio. */
function camposDoCorpo(corpo) {
  const dados = {};
  for (const nome of Object.keys(CAMPOS)) {
    if (Object.prototype.hasOwnProperty.call(corpo, nome)) {
      dados[nome] = valorDoCampo(nome, corpo[nome]);
    }
  }
  return dados;
}

/**
 * Coerências que só existem quando os campos são olhados JUNTOS. Recebe o estado FINAL (o que já
 * está gravado + o que está entrando), porque num PATCH parcial a regra pode ser quebrada pela
 * combinação de um campo novo com um antigo.
 */
function conferirCoerencia(f) {
  if (f.inatividadeAtiva && !f.inatividadeMinutos) {
    throw new Error('Relógio de inatividade ligado exige "inatividadeMinutos".');
  }
  if (f.inatividadeAtiva && !f.inatividadeConta) {
    throw new Error(`Relógio de inatividade ligado exige "inatividadeConta" (${CONTAS.join(' | ')}).`);
  }
  if (f.inatividadeAtiva && !f.inatividadeAcao) {
    throw new Error(`Relógio de inatividade ligado exige "inatividadeAcao" (${ACOES.join(' | ')}).`);
  }
  if (f.inatividadeAcao === 'transferir_time' && !f.inatividadeTimeDestino) {
    throw new Error('Ação "transferir_time" exige o setor de destino ("inatividadeTimeDestino").');
  }
  // ⚠️ O aviso ("ainda está aí?") precisa vir ANTES de agir. Com aviso >= prazo, o cliente é
  // devolvido para a fila e SÓ DEPOIS pergunta-se se ele continua aí — ou o aviso nunca sai.
  if (f.inatividadeAvisoMinutos && f.inatividadeMinutos
      && f.inatividadeAvisoMinutos >= f.inatividadeMinutos) {
    throw new Error('O aviso prévio precisa ser MENOR que o prazo de inatividade '
      + `(aviso ${f.inatividadeAvisoMinutos} min, prazo ${f.inatividadeMinutos} min).`);
  }
  if (f.transbordoAtivo && !f.transbordoMinutos) {
    throw new Error('Transbordo ligado exige "transbordoMinutos".');
  }
  if (f.transbordoAtivo && !f.transbordoTimeId) {
    throw new Error('Transbordo ligado exige o setor de destino ("transbordoTimeId").');
  }
}

/**
 * Fluxo apontado tem de EXISTIR e ser DA MESMA EMPRESA. Sem esta conferência, a empresa A poderia
 * apontar para um fluxo da empresa B e o motor executaria conteúdo de outro cliente — vazamento
 * pela porta dos fundos da configuração.
 */
async function conferirFluxos(dados, tenantId) {
  const ids = ['fluxoPrimeiroContatoId', 'fluxoPadraoId', 'fluxoForaExpedienteId']
    .map((c) => dados[c]).filter(Boolean);
  if (!ids.length) return;
  const achados = await prisma.ragnabotFluxo.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, tenantId: true, nome: true },
  });
  for (const id of new Set(ids)) {
    const f = achados.find((x) => x.id === id);
    if (!f) throw new Error(`Fluxo ${id} não existe.`);
    if (f.tenantId !== tenantId) throw new Error(`Fluxo ${id} pertence a outra empresa.`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SOBREPOSIÇÃO DE JANELAS — a única conta de expediente que mora AQUI, e por um motivo.
//
// Avaliar "está aberto agora?" é do serviço. Recusar um cadastro contraditório é da rota: o serviço
// recebe janelas já gravadas e não tem como saber que duas delas dizem coisas diferentes sobre o
// mesmo minuto — ele só escolhe uma. Barrar na entrada é o que impede a pergunta "por que a
// mensagem de almoço saiu às 10h?", que ninguém consegue responder olhando o resultado.
//
// A expansão em intervalos absolutos sobre a semana (0..10079 minutos) resolve de graça a janela
// que cruza a meia-noite: plantão de sábado 22h → domingo 6h não vira caso especial espalhado.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Duração de uma janela, com a MESMA leitura do serviço (`janelaCruzaMeiaNoite`): fecha antes de
 *  abrir — ou igual — significa que a janela atravessa a meia-noite; igual é o plantão de 24 h. */
function duracaoDaJanela(j) {
  return j.fechaMin > j.abreMin ? j.fechaMin - j.abreMin : (MIN_DIA - j.abreMin) + j.fechaMin;
}

export function intervalosDaSemana(janelas) {
  return (janelas || []).filter((j) => j.ativo !== false).map((j) => {
    const inicio = j.diaSemana * MIN_DIA + j.abreMin;
    return { inicio, fim: inicio + duracaoDaJanela(j), janela: j };
  });
}

/** Duas janelas que se sobrepõem são duas verdades sobre o mesmo minuto. */
export function conflitoDeJanelas(janelas) {
  const ivs = intervalosDaSemana(janelas);
  for (let a = 0; a < ivs.length; a += 1) {
    for (let b = a + 1; b < ivs.length; b += 1) {
      // Deslocamento de uma semana: cobre a sobreposição que só existe depois da volta do domingo
      // para a segunda — o plantão que atravessa o fim da semana.
      for (const desloc of [-MIN_SEMANA, 0, MIN_SEMANA]) {
        const i2 = { inicio: ivs[b].inicio + desloc, fim: ivs[b].fim + desloc };
        if (ivs[a].inicio < i2.fim && i2.inicio < ivs[a].fim) {
          return { a: ivs[a].janela, b: ivs[b].janela };
        }
      }
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ESCOPO — leitura e escrita
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Cláusula de isolamento para qualquer consulta. `null` = não pode ver nada (falha FECHADA). */
function clausulaDeEmpresa(user, tenantIdDaTela) {
  const esc = escopoDe(user);
  if (esc.global) {
    // Super pode ESTREITAR por empresa, porque já podia ver todas.
    return tenantIdDaTela ? { tenantId: String(tenantIdDaTela) } : {};
  }
  if (!esc.tenantId) return null;
  return { tenantId: esc.tenantId }; // trava dura: o que a tela mandou é ignorado
}

/** Empresa em que a ESCRITA vai acontecer. Para quem não é super, é sempre a dele. */
function empresaParaEscrita(user, tenantIdDoCorpo) {
  const esc = escopoDe(user);
  if (esc.global) {
    if (!tenantIdDoCorpo) throw new Error('Informe "tenantId": o super usuário administra várias empresas.');
    return String(tenantIdDoCorpo);
  }
  if (!esc.tenantId) throw new Error('Seu usuário não está vinculado a uma empresa do Ragnabot.');
  return esc.tenantId;
}

/**
 * Carrega a política conferindo o escopo. Fora do escopo devolve 404, NÃO 403: confirmar que o id
 * existe já entrega ao curioso a informação de que aquela empresa tem aquela configuração.
 */
async function carregarPolitica(req, id) {
  const onde = clausulaDeEmpresa(req.user, null);
  if (!onde) return null;
  const p = await prisma.ragnabotAtendPolitica.findFirst({ where: { id: String(id), ...onde } });
  return p || null;
}

/** Registra em DOIS lugares: a auditoria do Ragnabot (por empresa, §4.7) e o log do NOC. Nenhuma
 *  das duas pode derrubar a gravação — auditoria que quebra a operação é pior que ausente. */
async function auditar({ req, acao, tenantId, entidade, entidadeId, descricao, antes, depois }) {
  await registrar({
    tenantId, atorTipo: 'usuario', atorId: req.user?.id || null,
    atorNome: req.user?.name || req.user?.username || null,
    categoria: 'configuracao', acao, descricao,
    ip: req.ip, userAgent: req.headers?.['user-agent'],
    entidade, entidadeId, antes, depois,
  });
  await logAction({
    user: req.user, req, action: acao, category: 'settings',
    entityType: entidade, entityId: entidadeId, description: descricao,
    payloadBefore: antes || undefined, payloadAfter: depois || undefined, rollbackable: false,
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OPÇÕES — o vocabulário para a tela montar os menus sem repetir as listas em JavaScript do lado de
// lá. Duas listas iguais em dois lugares divergem no primeiro valor novo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
router.get('/opcoes', (_req, res) => {
  res.json({
    escopos: ESCOPOS,
    inatividadeConta: [
      { valor: 'contato', rotulo: 'O contato parou de responder' },
      { valor: 'atendente', rotulo: 'O atendente parou de responder' },
      { valor: 'qualquer', rotulo: 'Ninguém falou, de lado nenhum' },
    ],
    inatividadeAcao: [
      { valor: 'devolver_fila', rotulo: 'Devolver para a fila de aguardando' },
      { valor: 'transferir_time', rotulo: 'Transferir para outro setor' },
      { valor: 'resolver', rotulo: 'Encerrar o atendimento' },
      { valor: 'notificar', rotulo: 'Só avisar a equipe' },
    ],
    tiposExcecao: [
      { valor: 'fechado', rotulo: 'Fechado o dia todo' },
      { valor: 'janela_especial', rotulo: 'Horário diferente neste dia' },
    ],
    diasSemana: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
    fusoPadrao: 'America/Fortaleza',
  });
});

// A guarda de migração vale a partir daqui — e só a partir daqui. `/opcoes` fica de fora de
// propósito: é vocabulário, não toca tabela nenhuma, e a tela precisa conseguir se desenhar mesmo
// num banco onde a migração ainda não passou. Tela em branco esconde o motivo; tela desenhada com
// um aviso claro mostra.
router.use(exigeModelos);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POLÍTICAS
// ════════════════════════════════════════════════════════════════════════════════════════════════

router.get('/politicas', async (req, res) => {
  try {
    const onde = clausulaDeEmpresa(req.user, req.query.tenantId);
    if (!onde) return res.json({ total: 0, itens: [], aviso: 'usuário sem empresa vinculada' });
    const filtro = { ...onde };
    if (req.query.escopo) {
      if (!ESCOPOS.includes(String(req.query.escopo))) return erro(res, new Error('escopo inválido'));
      filtro.escopo = String(req.query.escopo);
    }
    if (req.query.cwInboxId) filtro.cwInboxId = inteiro(req.query.cwInboxId, { min: 1, campo: 'cwInboxId' });
    if (req.query.cwTeamId) filtro.cwTeamId = inteiro(req.query.cwTeamId, { min: 1, campo: 'cwTeamId' });
    if (req.query.incluirInativas !== 'true') filtro.ativa = true;

    const itens = await prisma.ragnabotAtendPolitica.findMany({
      where: filtro, orderBy: [{ escopo: 'asc' }, { escopoChave: 'asc' }], take: 500,
    });
    res.json({ total: itens.length, itens });
  } catch (e) { erro(res, e); }
});

router.get('/politicas/:id', async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const [janelas, excecoes] = await Promise.all([
      prisma.ragnabotAtendExpediente.findMany({
        where: { politicaId: p.id }, orderBy: [{ diaSemana: 'asc' }, { abreMin: 'asc' }],
      }),
      prisma.ragnabotAtendExcecaoData.findMany({
        where: { politicaId: p.id }, orderBy: { chaveData: 'asc' },
      }),
    ]);
    res.json({
      politica: p,
      expedientes: janelas.map((j) => ({ ...j, abre: hhmm(j.abreMin), fecha: hhmm(j.fechaMin) })),
      excecoes,
      // Prévia do estado agora — é a conferência que evita publicar um expediente errado e só
      // descobrir no dia seguinte, pelo cliente.
      expedienteAgora: avaliarExpediente({ agora: new Date(), fuso: p.fuso, janelas, excecoes }),
    });
  } catch (e) { erro(res, e, 500); }
});

/**
 * Criação IDEMPOTENTE pela chave natural (tenantId, escopoChave). Repetir o POST — clique duplo,
 * retentativa do navegador, aba aberta duas vezes — devolve a política existente com
 * `criada:false` em vez de estourar violação de unicidade ou, pior, sobrescrever em silêncio o que
 * já estava configurado. Alterar é PATCH, e só PATCH.
 */
router.post('/politicas', exigeEscrita, async (req, res) => {
  try {
    const corpo = req.body || {};
    const tenantId = empresaParaEscrita(req.user, corpo.tenantId);
    const esc = montarEscopoChave(corpo);

    const empresa = await prisma.ragnabotTenant.findUnique({
      where: { id: tenantId }, select: { id: true, name: true, cwAccountId: true },
    });
    if (!empresa) return erro(res, new Error('Empresa não encontrada.'), 404);

    // cwAccountId é DERIVADO da empresa, não aceito da tela: aceitar da tela permitiria configurar
    // a caixa de uma conta em nome de outra. Só cai para o corpo quando a empresa ainda não foi
    // provisionada na plataforma (cwAccountId nulo), e aí a tela precisa dizer qual é.
    let cwAccountId = empresa.cwAccountId;
    if (cwAccountId == null) {
      // ⚠️ ESTE é o único ponto do produto por onde um id de conta entra DIGITADO por gente — e é
      // exatamente o engano que aconteceu de verdade em 02/09/2026: o campo da conta guardando o id
      // de uma CAIXA DE ENTRADA (35 = caixa do Facebook da conta 1). O estrago é mudo: o webhook
      // descarta tudo como "empresa não mapeada" e o sintoma é só "o robô não responde".
      // A conferência pergunta à plataforma e recusa apenas o que ela PROVA não existir (404);
      // plataforma fora ou token recusado NÃO bloqueia o cadastro (guarda que trava por dúvida
      // vira guarda contornada).
      cwAccountId = inteiro(corpo.cwAccountId, { min: 1, campo: 'cwAccountId' });
      await exigirIdDeContaValido(cwAccountId);
    }

    const jaExiste = await prisma.ragnabotAtendPolitica.findFirst({
      where: { tenantId, escopoChave: esc.escopoChave },
    });
    if (jaExiste) return res.status(200).json({ criada: false, politica: jaExiste });

    const dados = camposDoCorpo(corpo);
    await conferirFluxos(dados, tenantId);
    // Coerência sobre o estado FINAL: os padrões do schema valem para o que não veio no corpo.
    conferirCoerencia({
      inatividadeAtiva: false, transbordoAtivo: false, ...dados,
    });

    const criada = await prisma.ragnabotAtendPolitica.create({
      data: {
        tenantId, cwAccountId, ...esc, ...dados,
        criadoPorUserId: req.user?.id || null,
        atualizadoPorUserId: req.user?.id || null,
      },
    });

    await auditar({
      req, acao: 'ragnabot_atend_politica_criada', tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: criada.id,
      descricao: `Automações criadas no escopo ${esc.escopoChave} da empresa ${empresa.name}`,
      depois: criada,
    });
    res.status(201).json({ criada: true, politica: criada });
  } catch (e) { erro(res, e); }
});

/**
 * Alteração parcial com CONCORRÊNCIA OTIMISTA. `rev` é obrigatório: dois administradores na mesma
 * tela é evento real, não hipótese, e sobrescrever o colega em silêncio é o pior desfecho. O UPDATE
 * casa por (id, rev) numa operação só — conferir antes e gravar depois deixaria a janela de corrida
 * exatamente entre as duas.
 */
router.patch('/politicas/:id', exigeEscrita, async (req, res) => {
  try {
    const antes = await carregarPolitica(req, req.params.id);
    if (!antes) return res.status(404).json({ error: 'política não encontrada' });

    const corpo = req.body || {};
    if (corpo.rev === undefined || corpo.rev === null) {
      return erro(res, new Error('Informe "rev" (a versão que você está editando).'));
    }
    const rev = inteiro(corpo.rev, { min: 0, campo: 'rev' });

    const dados = camposDoCorpo(corpo);
    if (!Object.keys(dados).length) return erro(res, new Error('Nada para alterar.'));
    await conferirFluxos(dados, antes.tenantId);
    conferirCoerencia({ ...antes, ...dados });

    const r = await prisma.ragnabotAtendPolitica.updateMany({
      where: { id: antes.id, rev },
      data: { ...dados, rev: { increment: 1 }, atualizadoPorUserId: req.user?.id || null },
    });
    if (r.count === 0) {
      const atual = await prisma.ragnabotAtendPolitica.findUnique({ where: { id: antes.id } });
      return res.status(409).json({
        error: 'Outra pessoa alterou esta configuração enquanto você editava. Recarregue e refaça a alteração.',
        code: 'REV_CONFLITO', revAtual: atual?.rev ?? null, politica: atual,
      });
    }

    const depois = await prisma.ragnabotAtendPolitica.findUnique({ where: { id: antes.id } });
    await auditar({
      req, acao: 'ragnabot_atend_politica_alterada', tenantId: antes.tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: antes.id,
      descricao: `Automações do escopo ${antes.escopoChave} alteradas: ${Object.keys(dados).join(', ')}`,
      antes, depois,
    });
    res.json({ politica: depois });
  } catch (e) { erro(res, e); }
});

/** Liga/desliga a política inteira. Sem `rev` de propósito: é um interruptor, não uma edição de
 *  formulário — exigir versão aqui só empurraria o operador a recarregar a tela para apagar fogo. */
router.patch('/politicas/:id/ativacao', exigeEscrita, async (req, res) => {
  try {
    const antes = await carregarPolitica(req, req.params.id);
    if (!antes) return res.status(404).json({ error: 'política não encontrada' });
    const ativa = valorDoCampo('ativa', req.body?.ativa);
    const depois = await prisma.ragnabotAtendPolitica.update({
      where: { id: antes.id },
      data: { ativa, rev: { increment: 1 }, atualizadoPorUserId: req.user?.id || null },
    });
    await auditar({
      req, acao: ativa ? 'ragnabot_atend_politica_ativada' : 'ragnabot_atend_politica_desativada',
      tenantId: antes.tenantId, entidade: 'RagnabotAtendPolitica', entidadeId: antes.id,
      descricao: `Automações do escopo ${antes.escopoChave} ${ativa ? 'ativadas' : 'desativadas'}`,
      antes: { ativa: antes.ativa }, depois: { ativa },
    });
    res.json({ politica: depois });
  } catch (e) { erro(res, e); }
});

/**
 * PAUSA DE EMERGÊNCIA da distribuição — o `pauseAttendance` da origem, com o que falta lá: PRAZO e
 * MOTIVO. Pausa sem hora de volta é pausa que alguém esquece ligada, e ninguém descobre até o
 * cliente reclamar. `pausadaPorUserId` vem do usuário logado; aceitá-lo do corpo transformaria o
 * campo de auditoria em campo de formulário, que é o mesmo que não ter o campo.
 */
router.post('/politicas/:id/pausar', exigeEscrita, async (req, res) => {
  try {
    const antes = await carregarPolitica(req, req.params.id);
    if (!antes) return res.status(404).json({ error: 'política não encontrada' });
    const motivo = texto(req.body?.motivo ?? '', { max: 500, campo: 'motivo' }).trim();
    if (!motivo) return erro(res, new Error('Informe o motivo da pausa.'));

    let ate = null;
    if (req.body?.ate) {
      ate = new Date(req.body.ate);
      if (Number.isNaN(ate.getTime())) return erro(res, new Error('Data de retomada inválida.'));
      if (ate.getTime() <= Date.now()) return erro(res, new Error('A retomada precisa ser no futuro.'));
    } else if (req.body?.minutos) {
      ate = new Date(Date.now() + inteiro(req.body.minutos, { min: 1, max: 10080, campo: 'minutos' }) * 60000);
    }

    const depois = await prisma.ragnabotAtendPolitica.update({
      where: { id: antes.id },
      data: {
        distribuicaoPausada: true, pausadaAte: ate, pausadaMotivo: motivo,
        pausadaPorUserId: req.user?.id || null,
        rev: { increment: 1 }, atualizadoPorUserId: req.user?.id || null,
      },
    });
    await auditar({
      req, acao: 'ragnabot_atend_distribuicao_pausada', tenantId: antes.tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: antes.id,
      descricao: `Distribuição PAUSADA no escopo ${antes.escopoChave} — ${motivo}`
        + (ate ? ` (até ${ate.toISOString()})` : ' (sem prazo definido)'),
      antes: { distribuicaoPausada: antes.distribuicaoPausada },
      depois: { distribuicaoPausada: true, pausadaAte: ate, pausadaMotivo: motivo },
    });
    res.json({ politica: depois });
  } catch (e) { erro(res, e); }
});

router.post('/politicas/:id/retomar', exigeEscrita, async (req, res) => {
  try {
    const antes = await carregarPolitica(req, req.params.id);
    if (!antes) return res.status(404).json({ error: 'política não encontrada' });
    const depois = await prisma.ragnabotAtendPolitica.update({
      where: { id: antes.id },
      data: {
        distribuicaoPausada: false, pausadaAte: null, pausadaMotivo: null, pausadaPorUserId: null,
        rev: { increment: 1 }, atualizadoPorUserId: req.user?.id || null,
      },
    });
    await auditar({
      req, acao: 'ragnabot_atend_distribuicao_retomada', tenantId: antes.tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: antes.id,
      descricao: `Distribuição retomada no escopo ${antes.escopoChave}`,
      antes: { distribuicaoPausada: antes.distribuicaoPausada, pausadaMotivo: antes.pausadaMotivo },
      depois: { distribuicaoPausada: false },
    });
    res.json({ politica: depois });
  } catch (e) { erro(res, e); }
});

/**
 * Remoção. Exige `?confirmar=<escopoChave>` — apagar a configuração de uma caixa por engano é o
 * tipo de erro que só aparece no primeiro cliente que fica sem resposta.
 *
 * As janelas e exceções vão junto, na MESMA transação: como o vínculo é chave lógica (o schema
 * proíbe @relation daqui para os modelos existentes), não há cascata do banco para nos salvar —
 * sem isso ficariam órfãs, e um `politicaId` órfão é lixo que ninguém sabe interpretar depois.
 */
router.delete('/politicas/:id', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    if (req.query.confirmar !== p.escopoChave) {
      return erro(res, new Error(`Para remover, confirme com ?confirmar=${p.escopoChave}`));
    }
    const [excecoes, janelas] = await prisma.$transaction([
      prisma.ragnabotAtendExcecaoData.deleteMany({ where: { politicaId: p.id } }),
      prisma.ragnabotAtendExpediente.deleteMany({ where: { politicaId: p.id } }),
      prisma.ragnabotAtendPolitica.delete({ where: { id: p.id } }),
    ]);
    await auditar({
      req, acao: 'ragnabot_atend_politica_removida', tenantId: p.tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: p.id,
      descricao: `Automações do escopo ${p.escopoChave} REMOVIDAS `
        + `(${janelas.count} janela(s) de expediente e ${excecoes.count} exceção(ões) junto)`,
      antes: p,
    });
    res.json({ ok: true, janelasRemovidas: janelas.count, excecoesRemovidas: excecoes.count });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXPEDIENTE — uma linha por JANELA, e é isso que torna o intervalo de almoço possível.
//
// O Chatwoot guarda UMA linha por dia da semana com um único par abre/fecha, e o próprio modelo
// valida que o fechamento não pode vir antes da abertura — medido em 29/08: a caixa 1 tem
// exatamente 7 linhas. Representar 08–12 e 13–18 é impossível naquele formato. Aqui a linha é a
// JANELA: segunda com almoço são duas linhas, plantão que vira a madrugada são duas, sábado só de
// manhã é uma. O dia deixa de ser um limite.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Normaliza uma janela vinda da tela. Aceita "08:30" ou minutos — a tela manda o que for mais
 *  natural para ela, e a conversão acontece num lugar só. */
function janelaDoCorpo(bruto) {
  const diaSemana = inteiro(bruto?.diaSemana, { min: 0, max: 6, campo: 'diaSemana' });
  const abreMin = minutosDeHora(bruto?.abre ?? bruto?.abreMin, 'abre');
  const fechaMin = minutosDeHora(bruto?.fecha ?? bruto?.fechaMin, 'fecha');
  // ⚠️ Abertura IGUAL ao fechamento é PLANTÃO DE 24 HORAS, e não erro de digitação. Quem decide
  // isso é `janelaCruzaMeiaNoite()` no serviço ("fecha antes de abrir — ou igual — atravessa a
  // meia-noite"); recusar aqui deixaria a rota proibindo justamente o cadastro que o trabalhador
  // sabe executar, e o operador ficaria sem entender por que 00:00–00:00 não entra.
  if (abreMin >= MIN_DIA) throw new Error('abre: a abertura precisa ser antes de 24:00.');
  return {
    diaSemana, abreMin, fechaMin,
    rotulo: bruto?.rotulo ? texto(bruto.rotulo, { max: 80, campo: 'rotulo' }) : null,
    ativo: bruto?.ativo === undefined ? true : valorDoCampo('ativa', bruto.ativo),
  };
}

router.get('/politicas/:id/expedientes', async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const janelas = await prisma.ragnabotAtendExpediente.findMany({
      where: { politicaId: p.id }, orderBy: [{ diaSemana: 'asc' }, { abreMin: 'asc' }],
    });
    res.json({
      total: janelas.length,
      itens: janelas.map((j) => ({ ...j, abre: hhmm(j.abreMin), fecha: hhmm(j.fechaMin) })),
    });
  } catch (e) { erro(res, e, 500); }
});

/**
 * Substitui a SEMANA INTEIRA. É a forma natural de editar expediente (a tela mostra os sete dias de
 * uma vez) e é idempotente por construção: mandar o mesmo corpo duas vezes deixa o mesmo resultado,
 * sem linha duplicada. A troca acontece numa transação — semana meio apagada é pior que semana
 * errada, porque o robô passa a responder "estamos fechados" no meio do expediente.
 */
router.put('/politicas/:id/expedientes', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const lista = req.body?.janelas;
    if (!Array.isArray(lista)) return erro(res, new Error('Informe "janelas": [].'));
    if (lista.length > 100) return erro(res, new Error('Máximo de 100 janelas por política.'));

    const janelas = lista.map(janelaDoCorpo);
    const conflito = conflitoDeJanelas(janelas);
    if (conflito) {
      return erro(res, new Error('Duas janelas se sobrepõem: '
        + `dia ${conflito.a.diaSemana} ${hhmm(conflito.a.abreMin)}-${hhmm(conflito.a.fechaMin)} `
        + `e dia ${conflito.b.diaSemana} ${hhmm(conflito.b.abreMin)}-${hhmm(conflito.b.fechaMin)}.`));
    }

    const antes = await prisma.ragnabotAtendExpediente.findMany({ where: { politicaId: p.id } });
    await prisma.$transaction([
      prisma.ragnabotAtendExpediente.deleteMany({ where: { politicaId: p.id } }),
      prisma.ragnabotAtendExpediente.createMany({
        data: janelas.map((j) => ({ ...j, tenantId: p.tenantId, politicaId: p.id })),
      }),
    ]);
    const depois = await prisma.ragnabotAtendExpediente.findMany({
      where: { politicaId: p.id }, orderBy: [{ diaSemana: 'asc' }, { abreMin: 'asc' }],
    });

    await auditar({
      req, acao: 'ragnabot_atend_expediente_substituido', tenantId: p.tenantId,
      entidade: 'RagnabotAtendPolitica', entidadeId: p.id,
      descricao: `Expediente do escopo ${p.escopoChave} redefinido: ${antes.length} → ${depois.length} janela(s)`,
      antes, depois,
    });
    const excecoes = await prisma.ragnabotAtendExcecaoData.findMany({ where: { politicaId: p.id } });
    res.json({
      total: depois.length,
      itens: depois.map((j) => ({ ...j, abre: hhmm(j.abreMin), fecha: hhmm(j.fechaMin) })),
      expedienteAgora: avaliarExpediente({ agora: new Date(), fuso: p.fuso, janelas: depois, excecoes }),
    });
  } catch (e) { erro(res, e); }
});

router.post('/politicas/:id/expedientes', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const nova = janelaDoCorpo(req.body || {});
    const existentes = await prisma.ragnabotAtendExpediente.findMany({ where: { politicaId: p.id } });
    const conflito = conflitoDeJanelas([...existentes, nova]);
    if (conflito) return erro(res, new Error('A janela informada se sobrepõe a outra já cadastrada.'));

    const criada = await prisma.ragnabotAtendExpediente.create({
      data: { ...nova, tenantId: p.tenantId, politicaId: p.id },
    });
    await auditar({
      req, acao: 'ragnabot_atend_expediente_janela_criada', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExpediente', entidadeId: criada.id,
      descricao: `Janela dia ${nova.diaSemana} ${hhmm(nova.abreMin)}-${hhmm(nova.fechaMin)} `
        + `criada no escopo ${p.escopoChave}`,
      depois: criada,
    });
    res.status(201).json(criada);
  } catch (e) { erro(res, e); }
});

router.patch('/politicas/:id/expedientes/:janelaId', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const atual = await prisma.ragnabotAtendExpediente.findFirst({
      where: { id: String(req.params.janelaId), politicaId: p.id },
    });
    if (!atual) return res.status(404).json({ error: 'janela não encontrada nesta política' });

    // Mesclado com o que já existe: PATCH parcial que só mande "fecha" não pode perder o "abre".
    const nova = janelaDoCorpo({
      diaSemana: req.body?.diaSemana ?? atual.diaSemana,
      abre: req.body?.abre ?? req.body?.abreMin ?? atual.abreMin,
      fecha: req.body?.fecha ?? req.body?.fechaMin ?? atual.fechaMin,
      rotulo: req.body?.rotulo ?? atual.rotulo,
      ativo: req.body?.ativo ?? atual.ativo,
    });
    const outras = await prisma.ragnabotAtendExpediente.findMany({
      where: { politicaId: p.id, id: { not: atual.id } },
    });
    const conflito = conflitoDeJanelas([...outras, nova]);
    if (conflito) return erro(res, new Error('A janela alterada passaria a se sobrepor a outra.'));

    const depois = await prisma.ragnabotAtendExpediente.update({ where: { id: atual.id }, data: nova });
    await auditar({
      req, acao: 'ragnabot_atend_expediente_janela_alterada', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExpediente', entidadeId: atual.id,
      descricao: `Janela do escopo ${p.escopoChave} alterada para dia ${nova.diaSemana} `
        + `${hhmm(nova.abreMin)}-${hhmm(nova.fechaMin)}`,
      antes: atual, depois,
    });
    res.json(depois);
  } catch (e) { erro(res, e); }
});

router.delete('/politicas/:id/expedientes/:janelaId', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const atual = await prisma.ragnabotAtendExpediente.findFirst({
      where: { id: String(req.params.janelaId), politicaId: p.id },
    });
    if (!atual) return res.status(404).json({ error: 'janela não encontrada nesta política' });
    await prisma.ragnabotAtendExpediente.delete({ where: { id: atual.id } });
    await auditar({
      req, acao: 'ragnabot_atend_expediente_janela_removida', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExpediente', entidadeId: atual.id,
      descricao: `Janela dia ${atual.diaSemana} ${hhmm(atual.abreMin)}-${hhmm(atual.fechaMin)} `
        + `removida do escopo ${p.escopoChave}`,
      antes: atual,
    });
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXCEÇÕES DE DATA — feriado e data especial.
//
// Medido em 29/08: "holiday" não aparece nos modelos, serviços nem no pacote enterprise do Chatwoot
// 4.17.1; na origem o único lugar era o módulo Agenda, com ZERO registros em 14 meses. É requisito
// novo — e "atender no Natal por engano" é erro que o cliente enxerga.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Chave de data NOT NULL, pelo mesmo motivo de `escopoChave`: feriado recorrente não tem ano, e um
 * `ano Int?` nulo escaparia do índice único — daria para cadastrar o mesmo Natal dez vezes.
 *   data fixa:  "2026-12-25"      recorrente: "*-12-25"
 */
function chaveDeData(bruto) {
  const s = String(bruto || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    // Confere que a data EXISTE: "2026-02-30" passa no formato e não existe no calendário.
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) {
      throw new Error('data: dia inexistente no calendário');
    }
    return s;
  }
  m = /^\*-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [mes, dia] = [Number(m[1]), Number(m[2])];
    // 29 de fevereiro é aceito no recorrente de propósito: existe a cada quatro anos, e recusá-lo
    // impediria cadastrar um feriado legítimo que cai nesse dia.
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) throw new Error('data: mês ou dia inválido');
    return s;
  }
  throw new Error('data: use AAAA-MM-DD (data fixa) ou *-MM-DD (todo ano)');
}

function excecaoDoCorpo(bruto) {
  const chave = chaveDeData(bruto?.chaveData ?? bruto?.data);
  const tipo = String(bruto?.tipo || '');
  if (!TIPOS_EXCECAO.includes(tipo)) throw new Error(`tipo: use ${TIPOS_EXCECAO.join(' | ')}`);
  const rotulo = texto(bruto?.rotulo ?? '', { max: 120, campo: 'rotulo' }).trim();
  if (!rotulo) throw new Error('rotulo: dê um nome ao dia (ex.: Natal, Ponto facultativo)');

  let abreMin = null;
  let fechaMin = null;
  if (tipo === 'janela_especial') {
    abreMin = minutosDeHora(bruto?.abre ?? bruto?.abreMin, 'abre');
    fechaMin = minutosDeHora(bruto?.fecha ?? bruto?.fechaMin, 'fecha');
    if (abreMin === fechaMin) throw new Error('Abertura e fechamento iguais na data especial.');
  }
  // Em 'fechado' os horários são forçados a nulo: guardar horário num dia fechado deixa duas
  // leituras possíveis da mesma linha, e alguém vai escolher a errada.
  return {
    chaveData: chave, tipo, abreMin, fechaMin, rotulo,
    mensagem: bruto?.mensagem ? texto(bruto.mensagem, { campo: 'mensagem' }) : null,
  };
}

router.get('/politicas/:id/excecoes', async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const itens = await prisma.ragnabotAtendExcecaoData.findMany({
      where: { politicaId: p.id }, orderBy: { chaveData: 'asc' },
    });
    res.json({ total: itens.length, itens });
  } catch (e) { erro(res, e, 500); }
});

/** Idempotente pela chave natural (politicaId, chaveData): repetir o cadastro do mesmo Natal
 *  devolve o que já existe, com `criada:false`, em vez de erro de unicidade cru. */
router.post('/politicas/:id/excecoes', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const dados = excecaoDoCorpo(req.body || {});
    const ja = await prisma.ragnabotAtendExcecaoData.findFirst({
      where: { politicaId: p.id, chaveData: dados.chaveData },
    });
    if (ja) return res.status(200).json({ criada: false, excecao: ja });

    const criada = await prisma.ragnabotAtendExcecaoData.create({
      data: { ...dados, tenantId: p.tenantId, politicaId: p.id },
    });
    await auditar({
      req, acao: 'ragnabot_atend_excecao_criada', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExcecaoData', entidadeId: criada.id,
      descricao: `Data "${dados.rotulo}" (${dados.chaveData}, ${dados.tipo}) cadastrada no escopo ${p.escopoChave}`,
      depois: criada,
    });
    res.status(201).json({ criada: true, excecao: criada });
  } catch (e) { erro(res, e); }
});

router.patch('/politicas/:id/excecoes/:excecaoId', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const atual = await prisma.ragnabotAtendExcecaoData.findFirst({
      where: { id: String(req.params.excecaoId), politicaId: p.id },
    });
    if (!atual) return res.status(404).json({ error: 'data não encontrada nesta política' });

    const dados = excecaoDoCorpo({
      chaveData: req.body?.chaveData ?? req.body?.data ?? atual.chaveData,
      tipo: req.body?.tipo ?? atual.tipo,
      abre: req.body?.abre ?? req.body?.abreMin ?? atual.abreMin,
      fecha: req.body?.fecha ?? req.body?.fechaMin ?? atual.fechaMin,
      rotulo: req.body?.rotulo ?? atual.rotulo,
      mensagem: req.body?.mensagem ?? atual.mensagem,
    });
    if (dados.chaveData !== atual.chaveData) {
      const colide = await prisma.ragnabotAtendExcecaoData.findFirst({
        where: { politicaId: p.id, chaveData: dados.chaveData, id: { not: atual.id } },
      });
      if (colide) return erro(res, new Error(`Já existe uma data cadastrada em ${dados.chaveData}.`), 409);
    }
    const depois = await prisma.ragnabotAtendExcecaoData.update({ where: { id: atual.id }, data: dados });
    await auditar({
      req, acao: 'ragnabot_atend_excecao_alterada', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExcecaoData', entidadeId: atual.id,
      descricao: `Data "${dados.rotulo}" (${dados.chaveData}) alterada no escopo ${p.escopoChave}`,
      antes: atual, depois,
    });
    res.json(depois);
  } catch (e) { erro(res, e); }
});

router.delete('/politicas/:id/excecoes/:excecaoId', exigeEscrita, async (req, res) => {
  try {
    const p = await carregarPolitica(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'política não encontrada' });
    const atual = await prisma.ragnabotAtendExcecaoData.findFirst({
      where: { id: String(req.params.excecaoId), politicaId: p.id },
    });
    if (!atual) return res.status(404).json({ error: 'data não encontrada nesta política' });
    await prisma.ragnabotAtendExcecaoData.delete({ where: { id: atual.id } });
    await auditar({
      req, acao: 'ragnabot_atend_excecao_removida', tenantId: p.tenantId,
      entidade: 'RagnabotAtendExcecaoData', entidadeId: atual.id,
      descricao: `Data "${atual.rotulo}" (${atual.chaveData}) removida do escopo ${p.escopoChave}`,
      antes: atual,
    });
    res.json({ ok: true });
  } catch (e) { erro(res, e); }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO EFETIVA — o que vale, de fato, para uma caixa (e opcionalmente um setor).
//
// É esta rota que a tela da conexão consome. Ela existe porque a herança empresa → caixa → time só
// é compreensível quando a resposta diz, campo a campo, DE ONDE o valor veio: sem isso o operador
// olha a tela do setor, lê "30 minutos" e não faz ideia de que aquilo é da empresa e vai mudar
// sozinho quando alguém mexer lá em cima.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Carrega a cadeia de políticas (empresa, caixa, time) já dentro do escopo do usuário. */
async function cadeiaDePoliticas(req) {
  const onde = clausulaDeEmpresa(req.user, req.query.tenantId);
  if (!onde) return { erro: 'usuário sem empresa vinculada' };

  const chaves = ['empresa'];
  if (req.query.cwInboxId) chaves.push(`caixa:${inteiro(req.query.cwInboxId, { min: 1, campo: 'cwInboxId' })}`);
  if (req.query.cwTeamId) chaves.push(`time:${inteiro(req.query.cwTeamId, { min: 1, campo: 'cwTeamId' })}`);

  const politicas = await prisma.ragnabotAtendPolitica.findMany({
    where: { ...onde, ativa: true, escopoChave: { in: chaves } },
  });
  // Sem `tenantId` na consulta, um super usuário que não estreitou poderia juntar a política
  // 'empresa' de DUAS empresas na mesma cadeia. Recusar é melhor que responder misturado.
  const empresas = new Set(politicas.map((p) => p.tenantId));
  if (empresas.size > 1) {
    return { erro: 'informe ?tenantId= — há políticas de mais de uma empresa nesta consulta' };
  }
  return { politicas };
}

/**
 * Expediente NÃO é mesclado entre níveis: vale o conjunto de janelas da política mais específica
 * que TIVER alguma. Somar as janelas da empresa com as do setor produziria um horário que ninguém
 * escreveu — e o operador nunca acharia onde desligar a janela que sobrou.
 */
async function expedienteEfetivo(politicas) {
  const ordem = { empresa: 0, caixa: 1, time: 2 };
  const cadeia = politicas.slice().sort((a, b) => ordem[b.escopo] - ordem[a.escopo]); // mais específica primeiro
  for (const p of cadeia) {
    const janelas = await prisma.ragnabotAtendExpediente.findMany({
      where: { politicaId: p.id, ativo: true }, orderBy: [{ diaSemana: 'asc' }, { abreMin: 'asc' }],
    });
    if (janelas.length) {
      const excecoes = await prisma.ragnabotAtendExcecaoData.findMany({ where: { politicaId: p.id } });
      return { politica: p, janelas, excecoes };
    }
  }
  return { politica: cadeia[0] || null, janelas: [], excecoes: [] };
}

router.get('/efetiva', async (req, res) => {
  try {
    const r = await cadeiaDePoliticas(req);
    if (r.erro) return res.status(400).json({ error: r.erro });
    if (!r.politicas.length) {
      // Ausência de configuração NÃO é erro: a caixa simplesmente ainda não tem automações, e a
      // tela precisa dessa resposta para oferecer "criar". Devolver 404 aqui faria a tela mostrar
      // falha onde há apenas um cadastro por fazer.
      return res.json({ configurada: false, efetiva: {}, origem: {}, niveis: [], expediente: null });
    }
    // `mesclarPoliticas` é do serviço: a herança empresa → caixa → time tem de dar o MESMO
    // resultado na tela e no trabalhador, senão o operador vê 30 min e o relógio usa 10.
    const { valor: efetiva, origem, niveis } = mesclarPoliticas(r.politicas);
    const exp = await expedienteEfetivo(r.politicas);
    res.json({
      configurada: true,
      efetiva, origem, niveis,
      expediente: {
        origem: exp.politica ? { politicaId: exp.politica.id, escopo: exp.politica.escopo } : null,
        janelas: exp.janelas.map((j) => ({ ...j, abre: hhmm(j.abreMin), fecha: hhmm(j.fechaMin) })),
        excecoes: exp.excecoes,
        agora: avaliarExpediente({
          agora: new Date(), fuso: efetiva.fuso || 'America/Fortaleza',
          janelas: exp.janelas, excecoes: exp.excecoes,
        }),
      },
    });
  } catch (e) { erro(res, e); }
});

/**
 * "Está aberto agora?" — e, com `?em=<data ISO>`, "estará aberto naquele momento?".
 *
 * A simulação existe para conferir o cadastro ANTES do feriado chegar: descobrir no dia 25 que o
 * Natal ficou de fora é descobrir pelo cliente. Devolve as mesmas variáveis do §5.5
 * (`expediente.aberto`, `expediente.motivo`, `expediente.proximaAbertura`) que o motor injeta no
 * contexto do nó `condicao` — mesma função, uma verdade só.
 */
router.get('/expediente/agora', async (req, res) => {
  try {
    const r = await cadeiaDePoliticas(req);
    if (r.erro) return res.status(400).json({ error: r.erro });
    if (!r.politicas.length) return res.json({ configurada: false, expediente: null });

    let agora = new Date();
    if (req.query.em) {
      agora = new Date(String(req.query.em));
      if (Number.isNaN(agora.getTime())) return erro(res, new Error('em: data inválida (use ISO 8601)'));
    }
    const { valor: efetiva } = mesclarPoliticas(r.politicas);
    const exp = await expedienteEfetivo(r.politicas);
    const fuso = efetiva.fuso || 'America/Fortaleza';
    const av = avaliarExpediente({ agora, fuso, janelas: exp.janelas, excecoes: exp.excecoes });

    // A mensagem que o cliente receberia neste momento — conferir a REDAÇÃO é metade do trabalho de
    // configurar, e vê-la aqui evita publicar "estamos fechados" na hora do almoço.
    // `sem_configuracao` cai junto com `aberto` de propósito: quando ninguém disse quando fecha, o
    // serviço mantém o atendimento ABERTO — e a mensagem que sai é a de saudação, não a de fechado.
    const mensagem = av.motivo === MOTIVOS_EXPEDIENTE.FERIADO
      ? (av.excecao?.mensagem || efetiva.msgFeriado || efetiva.msgForaExpediente || null)
      : av.motivo === MOTIVOS_EXPEDIENTE.INTERVALO
        ? (efetiva.msgIntervalo || efetiva.msgForaExpediente || null)
        : av.motivo === MOTIVOS_EXPEDIENTE.FORA_HORA
          ? (efetiva.msgForaExpediente || null)
          : (efetiva.msgSaudacao || null);

    res.json({ configurada: true, expediente: av, mensagemQueSairia: mensagem });
  } catch (e) { erro(res, e); }
});

export default router;
