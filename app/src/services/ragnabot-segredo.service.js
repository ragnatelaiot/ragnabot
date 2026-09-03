// ════════════════════════════════════════════════════════════════════════════════════════════════
// O COFRE DE SEGREDOS DA EMPRESA — `RagnabotFluxoSegredo`, finalmente com quem o leia.
//
// Contrato S-CREDENCIAL-IG (03/09/2026). A tabela existe no schema desde o motor de fluxo (doc 28
// §7) e, até hoje, NENHUM serviço a lia — medido: `grep -rn "ragnabotFluxoSegredo" src/` devolvia
// zero. O efeito prático disso era o `SEM_CREDENCIAL` do envio nativo: havia onde GUARDAR o token
// do canal e não havia como BUSCÁ-LO.
//
// ─── AS TRÊS REGRAS QUE MANDAM NESTE ARQUIVO ────────────────────────────────────────────────────
//
// 1. O VALOR NUNCA SAI PELO CAMINHO PÚBLICO. `listar()` devolve apelido, impressão digital e datas
//    — nunca `valorCifrado`, nunca o claro. Quem precisa do valor chama `ler()`, que é para uso do
//    SERVIDOR (adaptador de canal, nó de fluxo), jamais para virar corpo de resposta HTTP.
//
// 2. O VALOR NÃO É ENUMERÁVEL. `ler()` devolve um envelope em que `valor` é propriedade
//    NÃO-ENUMERÁVEL. Isso não é enfeite: `JSON.stringify(cred)` num log de diagnóstico e
//    `console.log(cred)` são exatamente como um segredo vaza para o diário do cluster — e os dois
//    ignoram propriedade não-enumerável. Continua sendo possível vazar escrevendo `${cred.valor}`,
//    e é por isso que existe o teste que varre o log; a não-enumerabilidade fecha o vazamento por
//    DESCUIDO, que é o que acontece de verdade.
//
// 3. A IMPRESSÃO DIGITAL É A ÚNICA COISA QUE APARECE. `sha256:` + 16 hex, o MESMO formato de
//    `RagnabotInbox.credentialFingerprint` (`digitalDoSegredo`, em `src/base/assinatura.js`) — para
//    a tela e o `/saude` lerem os dois do mesmo jeito. Ela mostra que o segredo MUDOU sem permitir
//    reconstruí-lo, que é o que se precisa numa conferência de deploy.
//
// ─── ISOLAMENTO ENTRE EMPRESAS ──────────────────────────────────────────────────────────────────
// Toda leitura e toda escrita usam a chave COMPOSTA `(tenantId, apelido)`, que é o `@@unique` da
// tabela. Um `findFirst({ where: { apelido } })` devolveria a linha de OUTRA empresa — e o cliente
// A mandaria requisição com o token do cliente B. Este arquivo não tem NENHUMA consulta por apelido
// sem tenant, de propósito.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prismaGlobal from '../base/db.js';
import loggerGlobal from '../base/logger.js';
import { encrypt, decrypt } from '../base/crypto.js';
import { digitalDoSegredo } from '../base/assinatura.js';

const portas = { db: prismaGlobal, log: loggerGlobal };

export function configurarSegredos(novas = {}) {
  for (const [k, v] of Object.entries(novas)) {
    if (!(k in portas)) throw new Error(`porta desconhecida no cofre: ${k}`);
    if (v !== undefined) portas[k] = v;
  }
  return { ...portas };
}
export function portasDoCofre() { return { ...portas }; }

const db = () => portas.db;
const log = () => portas.log ?? console;

/** A impressão digital, reexportada para quem confere um deploy não precisar saber onde ela mora. */
export const digital = digitalDoSegredo;

/**
 * O ENVELOPE. Público enumerável; valor escondido de `JSON.stringify` e de `console.log`.
 *
 * ⚠️ Não confunda com criptografia: quem escrever `${env.valor}` num log continua publicando o
 * segredo. O que isto impede é o vazamento por DESCUIDO — despejar o objeto inteiro num log de
 * diagnóstico, que é como quase todo segredo vaza na prática.
 */
export function envelopar(valor, publico = {}) {
  const env = { ...publico };
  Object.defineProperty(env, 'valor', { value: valor, enumerable: false, writable: false });
  // O mesmo cuidado para quem despeja com util.inspect (que é o que o console faz).
  Object.defineProperty(env, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => ({ ...publico, valor: '«oculto»' }), enumerable: false,
  });
  return env;
}

function apelidoValido(apelido) {
  const a = String(apelido ?? '').trim();
  // Letras sem acento, dígitos, `_`, `-` e `.`: o apelido viaja em documento de fluxo, em
  // `provedorConfig` e em nome de variável de ambiente. Aceitar espaço ou acento aqui é criar dois
  // apelidos que parecem o mesmo e não são.
  if (!a || !/^[a-z0-9][a-z0-9_.-]{0,63}$/iu.test(a)) return null;
  return a.toLowerCase();
}

/**
 * GUARDA (ou ROTACIONA) um segredo da empresa. Devolve o público — NUNCA o valor.
 *
 * Rotação é o mesmo caminho: `upsert` na chave composta. `rotacionadoEm` só é carimbado quando o
 * valor MUDOU de fato (a impressão digital difere) — reescrever o mesmo token não é rotação, e
 * marcar como se fosse faria uma auditoria mentir sobre a última troca de credencial.
 */
export async function guardar({ tenantId, apelido, valor, descricao = null, criadoPorUserId = null } = {}) {
  if (!tenantId) throw new Error('cofre: sem empresa não há onde guardar (o segredo é por empresa)');
  const a = apelidoValido(apelido);
  if (!a) throw new Error('cofre: apelido inválido — use letras, dígitos, ponto, hífen ou sublinhado');
  const v = String(valor ?? '');
  if (!v) throw new Error('cofre: segredo vazio não é segredo — para remover, use `remover()`');

  const fingerprint = digitalDoSegredo(v);
  const anterior = await db().ragnabotFluxoSegredo
    .findUnique({ where: { tenantId_apelido: { tenantId, apelido: a } }, select: { fingerprint: true } })
    .catch(() => null);
  const mudou = Boolean(anterior) && anterior.fingerprint !== fingerprint;

  const linha = await db().ragnabotFluxoSegredo.upsert({
    where: { tenantId_apelido: { tenantId, apelido: a } },
    create: { tenantId, apelido: a, valorCifrado: encrypt(v), fingerprint, descricao, criadoPorUserId },
    update: {
      valorCifrado: encrypt(v),
      fingerprint,
      ...(descricao === null ? {} : { descricao }),
      ...(mudou ? { rotacionadoEm: new Date() } : {}),
    },
    select: { id: true, apelido: true, fingerprint: true, descricao: true, criadoEm: true, rotacionadoEm: true },
  });

  // O log carrega a IMPRESSÃO DIGITAL, nunca o valor — é ela que permite conferir um deploy.
  log().info?.(`[cofre] segredo "${a}" ${anterior ? (mudou ? 'rotacionado' : 'reescrito igual') : 'criado'} `
    + `na empresa ${tenantId} (${fingerprint})`);
  return { ...linha, novo: !anterior, rotacionado: mudou };
}

/**
 * LÊ o segredo em claro. **Uso de servidor.** Devolve `null` quando não existe — ausência é
 * resposta legítima, e quem chama degrada declarando (é assim que o envio nativo cai no texto
 * numerado em vez de estourar).
 *
 * `usadoEm` é carimbado sem bloquear a leitura: saber que uma credencial NUNCA foi usada é metade
 * do diagnóstico de "o robô não manda botão".
 */
export async function ler({ tenantId, apelido, marcarUso = true } = {}) {
  if (!tenantId) return null;
  const a = apelidoValido(apelido);
  if (!a) return null;

  const linha = await db().ragnabotFluxoSegredo
    .findUnique({ where: { tenantId_apelido: { tenantId, apelido: a } } })
    .catch((e) => { log().warn?.(`[cofre] não consegui ler "${a}" da empresa ${tenantId}: ${e.message}`); return null; });
  if (!linha) return null;

  let claro;
  try {
    claro = decrypt(linha.valorCifrado);
  } catch (e) {
    // ⚠️ ISTO É QUASE SEMPRE `ENCRYPTION_KEY` DIFERENTE DA QUE CIFROU. A mensagem diz isso, porque
    // "Unsupported state or unable to authenticate data" no meio de um atendimento não diz nada a
    // ninguém. O valor NÃO entra no log nem na exceção.
    log().error?.(`[cofre] o segredo "${a}" da empresa ${tenantId} não abriu (${e.message}). `
      + 'Quase sempre é ENCRYPTION_KEY diferente da que o cifrou.');
    return null;
  }
  if (!claro) return null;

  if (marcarUso) {
    // Sem `await`: carimbar uso não pode atrasar o envio ao cliente nem derrubá-lo se o banco
    // engasgar. O `catch` é obrigatório — promessa rejeitada sem dono derruba o processo no Node.
    db().ragnabotFluxoSegredo.update({ where: { id: linha.id }, data: { usadoEm: new Date() } })
      .catch(() => { /* carimbo de uso é diagnóstico, não é o trabalho */ });
  }

  return envelopar(claro, {
    apelido: linha.apelido,
    fingerprint: linha.fingerprint,
    descricao: linha.descricao ?? null,
    rotacionadoEm: linha.rotacionadoEm ?? null,
  });
}

/** O catálogo da empresa. SEM valor e SEM `valorCifrado` — é o que uma tela pode ver. */
export async function listar({ tenantId } = {}) {
  if (!tenantId) return [];
  return db().ragnabotFluxoSegredo.findMany({
    where: { tenantId },
    select: {
      apelido: true, fingerprint: true, descricao: true,
      criadoEm: true, rotacionadoEm: true, usadoEm: true, criadoPorUserId: true,
    },
    orderBy: { apelido: 'asc' },
  }).catch(() => []);
}

/** Apaga. Devolve `false` quando não havia o que apagar — remover duas vezes não é erro. */
export async function remover({ tenantId, apelido } = {}) {
  const a = apelidoValido(apelido);
  if (!tenantId || !a) return false;
  try {
    await db().ragnabotFluxoSegredo.delete({ where: { tenantId_apelido: { tenantId, apelido: a } } });
    log().info?.(`[cofre] segredo "${a}" removido da empresa ${tenantId}`);
    return true;
  } catch { return false; }
}

/**
 * A FORMA QUE O MOTOR DE FLUXO ESPERA da porta `cofre`: `resolver(tenantId, apelido) => valor`.
 *
 * Ver `ragnabot-fluxo-motor.service.js:1088` — o nó de requisição HTTP troca `{cofre:'apelido'}`
 * pelo valor com o `tenantId` DA EXECUÇÃO, nunca o do documento do fluxo. Estoura quando não
 * encontra, de propósito: o motor trata isso como `SEGREDO_AUSENTE` e o nó falha FECHADO. Devolver
 * string vazia mandaria a requisição sem credencial — e um 401 do outro lado é muito mais difícil
 * de diagnosticar do que «o apelido não existe nesta empresa».
 *
 * ⚠️ NÃO ESTÁ AMARRADO ao motor em 03/09/2026, e é honesto dizer por quê: a porta `egresso` (quem
 * de fato faz a requisição de saída) continua sem implementação neste repositório, então amarrar só
 * o cofre não faria o nó HTTP funcionar — trocaria a recusa por outra recusa, um passo adiante.
 * A função existe, tem a assinatura certa e está testada; amarrar é uma linha no dia do `egresso`.
 */
export async function resolver(tenantId, apelido) {
  const s = await ler({ tenantId, apelido });
  if (!s?.valor) throw new Error(`o apelido de cofre "${apelido}" não existe nesta empresa`);
  return s.valor;
}

/** Os apelidos que EXISTEM na empresa — é o que a validação de fluxo usa para recusar referência a
 *  segredo inexistente ANTES de publicar. Só nomes; nenhum valor, nenhuma impressão digital. */
export async function apelidosDaEmpresa(tenantId) {
  return (await listar({ tenantId })).map((l) => l.apelido);
}

export default {
  configurarSegredos, portasDoCofre, guardar, ler, listar, remover, digital, envelopar,
  resolver, apelidosDaEmpresa,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE ESTE ARQUIVO **NÃO** FAZ
//
// • NÃO expõe rota HTTP. Guardar segredo pela API é decisão de produto (quem pode? com que segundo
//   fator? com que auditoria?) e não estava no contrato. Hoje se guarda pelo servidor — e o
//   caminho de produção do token do canal é o `Secret` do Kubernetes, não o cofre.
// • NÃO faz cache. Cache de segredo é do CHAMADOR (ver `ragnabot-credencial-canal.service.js`),
//   porque só ele sabe por quanto tempo o valor dele vale.
// • NÃO decide política de rotação. Ele registra `rotacionadoEm`; quem cobra é auditoria.
// ════════════════════════════════════════════════════════════════════════════════════════════════
