#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BATERIA DO MOTOR DE FLUXO DO RAGNABOT — roda contra o BANCO REAL e limpa o que criou.
//
// POR QUE ESTE ARQUIVO EXISTE
// A especificação (/ia/.claude/modulo-atendimento/28-MOTOR-DE-FLUXO-ESPECIFICACAO.md) apoia o
// motor inteiro em SEIS garantias que NÃO moram no código da aplicação — moram no PostgreSQL:
//
//   1. índice único PARCIAL   → uma execução viva por conversa (dois robôs na mesma pessoa)
//   2. gatilho + REVOKE       → versão publicada é imutável (o D10 sobreviveu 14 meses por isso)
//   3. FKs COMPOSTAS          → execução da empresa A nunca amarra em versão da empresa B
//   4. único (versão,de,saída)→ o fan-out acidental (D5 medido) morre no banco
//   5. único de idempotência  → reentrega de webhook não duplica efeito
//   6. comparar-e-trocar      → posse por arrendamento com cerca, sem trava consultiva de sessão
//
// Garantia que só existe no papel é garantia que um `prisma db push` apaga em silêncio. Esta
// bateria abre conexões DE VERDADE, em PARALELO, e pergunta ao banco se ele recusa o que tem de
// recusar. Nada aqui é dublê: o que passa, passou no Postgres da casa.
//
// COMO RODAR
//     RAGNABOT_FLUXO_E2E=1 node tests/ragnabot-fluxo.test.mjs
//
//   RAGNABOT_FLUXO_E2E=1            obrigatória — sem ela o arquivo não roda (sai 2)
//   RAGNABOT_FLUXO_ENSAIO=1         força o MODO ENSAIO mesmo com as tabelas reais presentes
//   RAGNABOT_FLUXO_EXIGIR_MODULOS=1 verificação que dependa de módulo ausente vira FALHA
//   RAGNABOT_FLUXO_MANTER=1         não limpa no fim (para periciar o que ficou)
//
// DOIS MODOS, MESMA BATERIA
//   • MODO REAL   — as tabelas `RagnabotFluxo*` existem no schema `public`. A bateria roda contra
//                   elas e vira teste de conformidade da migração de verdade.
//   • MODO ENSAIO — as tabelas ainda NÃO existem (a migração está sendo escrita neste momento por
//                   outro par de mãos). A bateria cria um schema descartável `rb_ensaio_<carimbo>`
//                   com o DDL DERIVADO DO CONTRATO, roda a MESMA bateria e derruba o schema no
//                   fim. ⚠️ DECLARADO SEM RODEIO: no modo ensaio as afirmações ESTRUTURAIS (existe
//                   o índice? existe o gatilho?) provam o CONTRATO, não a migração — o DDL é meu.
//                   As afirmações de COMPORTAMENTO (o Postgres recusa a segunda execução viva? o
//                   REVOKE vale contra o próprio dono da tabela? o SKIP LOCKED separa mesmo os dois
//                   trabalhadores?) provam o POSTGRES, e valem igual nos dois modos — é para elas
//                   que este arquivo existe antes da migração.
//
// CÓDIGOS DE SAÍDA — o silêncio aqui seria pior que a falha:
//   0 = tudo verde   1 = alguma verificação reprovou   2 = não pôde executar   3 = erro inesperado
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO, e a razão está escrita em vitest.config.js: o corredor só
// varre `tests/**/*.test.js`, porque script com `process.exit` derruba o arquivo inteiro sob o
// vitest. Este arquivo É um script — abre conexões paralelas, cria e derruba schema, e precisa de
// código de saída. É o mesmo padrão já em uso em `tests/ragnabot-isolamento.test.mjs`. A lógica
// PURA daqui é exportada (ver §LÓGICA PURA) para que um `tests/unit/*.test.js` a cubra na suíte —
// esse arquivo pertence a outro dono e não foi criado aqui.
//
// NOC 2026-08-28.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';
import pg from 'pg';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const { Pool } = pg;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §LÓGICA PURA — exportada para poder ser coberta por um teste de suíte sem tocar no banco.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Mede um texto nas TRÊS unidades que dão vereditos diferentes contra o mesmo teto.
 *
 * ⚠️ NINGUÉM MEDIU em que unidade a Meta conta caracteres, e a diferença não é acadêmica: o título
 * real do fluxo medido — «Sim! Abra o chamado! ✅ » — dá 23 em qualquer unidade contra um teto
 * documentado de 24. Trocar o ✅ por uma bandeira (dois indicadores regionais) dá 23 grafemas, 24
 * pontos de código e 26 unidades UTF-16: TRÊS vereditos para a MESMA linha. Enquanto o perfil de
 * limites estiver com origem='documentacao', o validador tem de aplicar `piorCaso` e dizer na tela
 * que é pior caso — aviso que se declara palpite não corrói a confiança nos avisos que são regra.
 */
export function medirTexto(texto) {
  const s = String(texto ?? '');
  const seg = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
  const grafemas = [...seg.segment(s)].length;
  const pontos = [...s].length;
  const utf16 = s.length;
  return { grafemas, pontos, utf16, bytesUtf8: Buffer.byteLength(s, 'utf8'), piorCaso: Math.max(grafemas, pontos, utf16) };
}

/**
 * Escada determinística de casamento de opção (§I do contrato). SEM casamento aproximado e SEM
 * modelo de linguagem: confundir «Sim! Abra o chamado!» com «Não! Recomece!» abre um chamado que a
 * pessoa não pediu. Errar para o lado de `opcao_invalida` custa uma repergunta — que tem teto.
 */
export function casarOpcaoRef(entrada, itens) {
  const normalizar = (t) => String(t ?? '')
    // Escapes explícitos de propósito: acento combinante e seletor de variação escritos como
    // caractere literal são invisíveis no editor, e alguém "arruma" o arquivo e apaga a classe.
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  // 1. resposta interativa — canônica, exata
  const id = entrada?.interativo?.id;
  if (id && itens.some((i) => i.id === id)) return { id, via: 'interativo' };

  const texto = normalizar(entrada?.texto);
  if (!texto) return null;

  // 2. índice numérico
  if (/^\d{1,2}$/.test(texto)) {
    const pos = Number(texto) - 1;
    if (pos >= 0 && pos < itens.length) return { id: itens[pos].id, via: 'indice' };
  }
  // 3. título exato normalizado
  const exato = itens.filter((i) => normalizar(i.titulo) === texto);
  if (exato.length === 1) return { id: exato[0].id, via: 'titulo' };

  // 4. prefixo único, mínimo 4 caracteres, SÓ se não for ambíguo
  if (texto.length >= 4) {
    const prefixo = itens.filter((i) => normalizar(i.titulo).startsWith(texto));
    if (prefixo.length === 1) return { id: prefixo[0].id, via: 'prefixo' };
  }
  // 5. apelidos declarados no editor
  const apelido = itens.filter((i) => (i.apelidos || []).some((a) => normalizar(a) === texto));
  if (apelido.length === 1) return { id: apelido[0].id, via: 'apelido' };

  return null; // 6. → opcao_invalida
}

/**
 * Chave determinística do efeito. Inclui VISITA e TENTATIVA de propósito: uma chave derivada só de
 * «protocolo:nó» é constante entre visitas — não distingue a primeira da segunda tentativa (que é
 * onde ela serviria) e faz um SEGUNDO chamado legítimo na mesma conversa colidir com o primeiro,
 * sendo descartado em silêncio enquanto o cliente lê «registrado com sucesso». Seria o D3 renascido.
 */
export function chaveEfeitoRef({ execucaoId, noId, visitaSeq, tentativa = 1, sufixo = '' }) {
  return crypto.createHash('sha256')
    .update(`${execucaoId}|${noId}|${visitaSeq}|${tentativa}|${sufixo}`)
    .digest('hex');
}

/** Campos que o emissor REESCREVE e que, se entrarem na chave, ANULAM a idempotência. */
export const CAMPOS_VOLATEIS = Object.freeze([
  'updated_at', 'last_activity_at', 'last_non_activity_message', 'unread_count',
  'messages_count', 'timestamp', 'agent_last_seen_at', 'contact_last_seen_at',
]);

/**
 * Canonicaliza o corpo do webhook REMOVENDO os campos voláteis, em qualquer profundidade, e
 * ordenando as chaves. Incluir um campo que o emissor reescreve faz a REENTREGA gerar chave nova e
 * passar direto, como se fosse mensagem nova do cliente — a idempotência vira carimbo decorativo.
 */
export function canonicalizarCorpo(valor) {
  if (Array.isArray(valor)) return valor.map(canonicalizarCorpo);
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const chave of Object.keys(valor).sort()) {
      if (CAMPOS_VOLATEIS.includes(chave)) continue;
      saida[chave] = canonicalizarCorpo(valor[chave]);
    }
    return saida;
  }
  return valor;
}

/** Chave NOT NULL de entrada. Nunca um par com coluna anulável: dois NULOS não são iguais no
 *  Postgres, e um único campo nulo transformaria o índice único num carimbo decorativo. */
export function chaveDeEntradaRef(corpo, { cwAccountId, evento }) {
  const idEstavel = corpo?.id ?? corpo?.message?.id ?? corpo?.conversation?.id ?? null;
  const tipoObjeto = corpo?.message ? 'message' : corpo?.conversation ? 'conversation' : 'evento';
  if (idEstavel != null) return `cw:${cwAccountId}:${evento}:${tipoObjeto}:${idEstavel}`;
  const h = crypto.createHash('sha256').update(JSON.stringify(canonicalizarCorpo(corpo))).digest('hex');
  return `cw:${cwAccountId}:${evento}:h:${h}`;
}

/**
 * Esqueleto de um documento: (nó.id, nó.tipo, saídas ordenadas) + (aresta.de, saída, para).
 * IGNORA texto, tempo, limiar e coordenada de tela. É o que decide, de forma auditável, se uma
 * publicação pode alcançar quem JÁ ESTÁ DENTRO da conversa: esqueleto igual ⇒ retrofit é seguro.
 *
 * ⚠️ AQUI ESTA FUNÇÃO SERVE PARA CONSTRUIR O FIXTURE, garantindo que o par v1/v2 do teste de fato
 * tem esqueleto igual (ou diferente). A AFIRMAÇÃO, quando o módulo de publicação existir, é feita
 * contra o `hashEstrutura` DELE — não contra esta.
 */
export function esqueletoRef(documento) {
  const nos = [...(documento?.nos ?? [])]
    .map((n) => [n.id, n.tipo, [...(n.saidas ?? [])].sort()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const arestas = [...(documento?.arestas ?? [])]
    .map((a) => [a.de, a.saida, a.para])
    .sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`));
  return crypto.createHash('sha256').update(JSON.stringify({ nos, arestas })).digest('hex');
}

/** Estados que o índice único parcial TEM de cobrir. Divergir daqui reabre a porta para dois
 *  robôs falando com a mesma pessoa, e o sintoma só aparece sob concorrência. */
export const ESTADOS_ATIVOS_CONTRATO = Object.freeze(['rodando', 'esperando', 'pausado_humano', 'pausado_duvida']);
export const ESTADOS_TERMINAIS_CONTRATO = Object.freeze(['concluido', 'abandonado', 'erro']);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §ARREIO — conexões, modo, registro de veredito
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const CARIMBO = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const MANTER = process.env.RAGNABOT_FLUXO_MANTER === '1';
const EXIGIR_MODULOS = process.env.RAGNABOT_FLUXO_EXIGIR_MODULOS === '1';

// Conta do Chatwoot inventada, bem longe de qualquer conta real, para que nenhuma linha de teste
// possa ser confundida com tráfego de cliente numa consulta de operação.
const CONTA_TESTE = 900_000_000 + Math.floor(Math.random() * 90_000);
const TENANT_A = `zz-fluxo-a-${CARIMBO}`;
const TENANT_B = `zz-fluxo-b-${CARIMBO}`;
const PERFIL_TESTE = `zz-ensaio-${CARIMBO}`;

let pool = null;
let SCHEMA = 'public';
let MODO = 'real'; // real | ensaio

/** Nome de tabela SEMPRE qualificado pelo schema alvo. Nunca `search_path`: cliente de pool é
 *  reaproveitado, e um `SET search_path` esquecido faria o teste escrever na tabela errada. */
function T(nome) { return `"${SCHEMA}"."${nome}"`; }

async function q(sql, params = [], cliente = null) {
  const c = cliente ?? pool;
  return c.query(sql, params);
}

const registro = [];
let houveFalha = false;

/** Executa uma verificação e guarda o veredito. Erro inesperado é REPROVAÇÃO, nunca engolido. */
async function checar(nome, fn) {
  try {
    const detalhe = await fn();
    registro.push({ nome, veredito: 'ok', detalhe: detalhe ?? '' });
    console.log(`[  ok  ] ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  } catch (e) {
    if (e && e.__pulado) {
      const nivel = EXIGIR_MODULOS ? 'falha' : 'pulado';
      if (EXIGIR_MODULOS) houveFalha = true;
      registro.push({ nome, veredito: nivel, detalhe: e.message });
      console.log(`[${EXIGIR_MODULOS ? ' FALHA' : ' pula '}] ${nome} — ${e.message}`);
      return;
    }
    houveFalha = true;
    registro.push({ nome, veredito: 'falha', detalhe: e.message });
    console.log(`[ FALHA] ${nome} — ${e.message}`);
  }
}

function afirmar(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}
function afirmarIgual(obtido, esperado, mensagem) {
  const a = JSON.stringify(obtido); const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensagem} — obtido ${a}, esperado ${b}`);
}
/** Marca a verificação como NÃO EXECUTADA, com o motivo. Silêncio seria pior que a falha. */
function pular(motivo) { const e = new Error(motivo); e.__pulado = true; throw e; }

/** Importa um módulo do motor que pode ainda não existir (outro par de mãos está escrevendo). */
const cacheModulos = new Map();
async function moduloOpcional(caminho) {
  if (cacheModulos.has(caminho)) return cacheModulos.get(caminho);
  let m = null;
  try { m = await import(caminho); } catch { m = null; }
  cacheModulos.set(caminho, m);
  return m;
}
/**
 * Procura um símbolo do motor nos caminhos possíveis, em ordem de preferência, e devolve também DE
 * ONDE veio. O contrato desenhou `src/motor/*.js`; a implementação que chegou consolidou tudo em
 * `src/services/ragnabot-fluxo-*.service.js`. Aceitar os dois evita que esta bateria fique testando
 * a própria referência enquanto o código real, com outro nome de arquivo, passa sem exame.
 */
const CAMINHOS_DO_MOTOR = Object.freeze({
  casarOpcao: ['../src/motor/casar-opcao.js', '../src/services/ragnabot-fluxo-nos.service.js'],
  medir: ['../src/motor/medir.js', '../src/services/ragnabot-fluxo-nos.service.js'],
  chaveEfeito: ['../src/services/ragnabot-fluxo-efeito.service.js', '../src/services/ragnabot-fluxo-nos.service.js'],
  chaveDeEntrada: ['../src/services/ragnabot-fluxo-portaria.service.js', '../src/services/ragnabot-fluxo-motor.service.js'],
  hashEstrutura: ['../src/services/ragnabot-fluxo-publicacao.service.js', '../src/services/ragnabot-fluxo-motor.service.js'],
  ESTADOS_ATIVOS: ['../src/motor/tipos.js', '../src/services/ragnabot-fluxo-motor.service.js'],
  validarNo: ['../src/services/ragnabot-fluxo-nos.service.js'],
  saidasDe: ['../src/services/ragnabot-fluxo-nos.service.js'],
  PERFIL_LIMITES_PADRAO: ['../src/services/ragnabot-fluxo-nos.service.js'],
  SAIDAS_DE_EXCECAO: ['../src/services/ragnabot-fluxo-nos.service.js'],
});

async function doMotor(nome) {
  for (const caminho of CAMINHOS_DO_MOTOR[nome] ?? []) {
    const m = await moduloOpcional(caminho);
    if (m && m[nome] !== undefined) return { valor: m[nome], fonte: caminho.replace('../', '') };
  }
  return { valor: null, fonte: null };
}

async function exigirModulo(caminho, nomes = []) {
  const m = await moduloOpcional(caminho);
  if (!m) pular(`módulo ${caminho} ainda não existe — verificação não executada`);
  for (const n of nomes) if (typeof m[n] !== 'function') pular(`${caminho} não exporta ${n}() — verificação não executada`);
  return m;
}

/** Espera-se que a operação seja RECUSADA pelo banco com um código específico. Sucesso é falha. */
async function esperarErroPg(codigos, fn, mensagem) {
  const lista = Array.isArray(codigos) ? codigos : [codigos];
  try {
    await fn();
  } catch (e) {
    if (lista.includes(e.code)) return e;
    throw new Error(`${mensagem} — o banco recusou, mas com o código ${e.code} (${String(e.message).slice(0, 160)}); esperava ${lista.join(' ou ')}`);
  }
  throw new Error(`${mensagem} — o banco ACEITOU. Esta é exatamente a porta que a especificação manda fechar.`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §DDL DO MODO ENSAIO — derivado do contrato. Só é usado quando as tabelas reais não existem.
//
// Os tipos espelham o que o Prisma 5 gera para PostgreSQL: String→text, Int→integer,
// BigInt→bigint, DateTime→timestamp(3), Json→jsonb, String[]→text[], Boolean→boolean.
// `@updatedAt` NÃO vira default no banco (o Prisma escreve o valor), então as inserções desta
// bateria informam a coluna explicitamente — do mesmo jeito no modo real.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ddlEnsaio(s) {
  const t = (n) => `"${s}"."${n}"`;
  return `
CREATE TABLE ${t('RagnabotFluxo')} (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL, "nome" text NOT NULL, "descricao" text,
  "estado" text NOT NULL DEFAULT 'rascunho', "versaoPublicadaId" text,
  "entrada" text NOT NULL DEFAULT 'subfluxo', "cwInboxId" integer,
  "palavrasChave" jsonb NOT NULL DEFAULT '[]',
  "passosPorEvento" integer NOT NULL DEFAULT 50, "passosTotalMax" integer NOT NULL DEFAULT 500,
  "visitasPorNoMax" integer NOT NULL DEFAULT 10, "ttlExecucaoSegundos" integer NOT NULL DEFAULT 82800,
  "retomada" text NOT NULL DEFAULT 'reiniciar',
  "politicaContinuacao" jsonb NOT NULL DEFAULT '{"janelaSegundos":20,"ambiguidadeMs":2000}',
  "arquivadoEm" timestamp(3), "criadoPorUserId" text,
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX "RagnabotFluxo_versaoPublicadaId_key" ON ${t('RagnabotFluxo')}("versaoPublicadaId");
CREATE UNIQUE INDEX "RagnabotFluxo_tenantId_nome_key" ON ${t('RagnabotFluxo')}("tenantId","nome");

CREATE TABLE ${t('RagnabotFluxoVersao')} (
  "id" text PRIMARY KEY, "fluxoId" text NOT NULL, "tenantId" text NOT NULL, "numero" integer NOT NULL,
  "documento" jsonb NOT NULL, "hashDocumento" text NOT NULL, "hashEstrutura" text NOT NULL,
  "variaveis" jsonb NOT NULL DEFAULT '[]', "noInicialId" text NOT NULL, "noResgateId" text,
  "perfilLimite" text NOT NULL, "validacao" jsonb NOT NULL DEFAULT '{}',
  "modoMigracao" text NOT NULL DEFAULT 'fixar', "origemVersaoId" text, "notaPublicacao" text,
  "publicadoPorUserId" text, "publicadoEm" timestamp(3),
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RagnabotFluxoVersao_fluxoId_numero_key" ON ${t('RagnabotFluxoVersao')}("fluxoId","numero");
CREATE UNIQUE INDEX "RagnabotFluxoVersao_tenantId_id_key" ON ${t('RagnabotFluxoVersao')}("tenantId","id");

CREATE TABLE ${t('RagnabotFluxoNo')} (
  "id" text PRIMARY KEY, "versaoId" text NOT NULL, "tenantId" text NOT NULL, "noId" text NOT NULL,
  "tipo" text NOT NULL, "titulo" text, "ordem" integer NOT NULL,
  "estaciona" boolean NOT NULL DEFAULT false, "efeito" text NOT NULL DEFAULT 'nenhum',
  "segredosRef" text[] NOT NULL DEFAULT '{}', "destinosRef" text[] NOT NULL DEFAULT '{}', "resumo" text
);
CREATE UNIQUE INDEX "RagnabotFluxoNo_versaoId_noId_key" ON ${t('RagnabotFluxoNo')}("versaoId","noId");

CREATE TABLE ${t('RagnabotFluxoAresta')} (
  "id" text PRIMARY KEY, "versaoId" text NOT NULL, "tenantId" text NOT NULL,
  "de" text NOT NULL, "saida" text NOT NULL, "para" text NOT NULL
);
CREATE UNIQUE INDEX "RagnabotFluxoAresta_versaoId_de_saida_key" ON ${t('RagnabotFluxoAresta')}("versaoId","de","saida");

CREATE TABLE ${t('RagnabotFluxoExecucao')} (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL, "cwAccountId" integer NOT NULL,
  "cwConversationId" integer NOT NULL, "cwContactId" integer, "contatoChave" text, "protocolo" text,
  "fluxoId" text NOT NULL, "versaoId" text NOT NULL, "versaoInicialId" text NOT NULL,
  "noAtualId" text, "noCongelado" jsonb, "visitaSeq" integer NOT NULL DEFAULT 0,
  "aguardando" text NOT NULL DEFAULT 'nada', "aguardaDesde" timestamp(3), "acordarEm" timestamp(3),
  "saidaAoVencer" text, "tentativasNo" jsonb NOT NULL DEFAULT '{}',
  "visitasPorNo" jsonb NOT NULL DEFAULT '{}', "passosTotal" integer NOT NULL DEFAULT 0,
  "vars" jsonb NOT NULL DEFAULT '{}', "caixaPendente" jsonb NOT NULL DEFAULT '[]',
  "pilha" jsonb NOT NULL DEFAULT '[]', "ultimaVariavel" text,
  "trilha" jsonb NOT NULL DEFAULT '[]', "trilhaTruncada" boolean NOT NULL DEFAULT false,
  "estado" text NOT NULL DEFAULT 'rodando', "motivoFim" text, "ultimoErro" text,
  "donoWorker" text, "leaseToken" text, "leaseExpiraEm" timestamp(3),
  "prazoEm" timestamp(3), "escalonamentos" integer NOT NULL DEFAULT 0,
  "expiraEm" timestamp(3) NOT NULL, "origemExecucaoId" text,
  "iniciadaEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadaEm" timestamp(3) NOT NULL, "encerradaEm" timestamp(3)
);

CREATE TABLE ${t('RagnabotFluxoEntrada')} (
  "id" text PRIMARY KEY, "chave" text NOT NULL, "tenantId" text, "inboxSegredoId" text,
  "cwAccountId" integer, "cwInboxId" integer, "cwConversationId" integer, "cwMessageId" integer,
  "wamid" text, "evento" text NOT NULL, "classe" text NOT NULL, "corpo" jsonb NOT NULL,
  "origemEm" timestamp(3), "atrasoMs" integer, "resultado" text, "erro" text,
  "recebidaEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processadaEm" timestamp(3)
);
CREATE UNIQUE INDEX "RagnabotFluxoEntrada_chave_key" ON ${t('RagnabotFluxoEntrada')}("chave");

CREATE TABLE ${t('RagnabotFluxoEntradaConsumida')} (
  "execucaoId" text NOT NULL, "cwMessageId" integer NOT NULL, "noId" text NOT NULL,
  "consumidaEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("execucaoId","cwMessageId")
);

CREATE TABLE ${t('RagnabotFluxoFila')} (
  "id" bigserial PRIMARY KEY, "tipo" text NOT NULL, "chaveParticao" text NOT NULL,
  "tenantId" text, "execucaoId" text, "entradaId" text, "tokenVisita" integer,
  "payload" jsonb NOT NULL DEFAULT '{}', "prioridade" integer NOT NULL DEFAULT 100,
  "disponivelEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" text NOT NULL DEFAULT 'pendente', "tentativas" integer NOT NULL DEFAULT 0,
  "maxTentativas" integer NOT NULL DEFAULT 8, "ultimoErro" text,
  "donoWorker" text, "travadoEm" timestamp(3),
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "atualizadoEm" timestamp(3) NOT NULL
);
CREATE INDEX "RagnabotFluxoFila_status_travadoEm_idx" ON ${t('RagnabotFluxoFila')}("status","travadoEm");
CREATE INDEX "RagnabotFluxoFila_chaveParticao_status_id_idx" ON ${t('RagnabotFluxoFila')}("chaveParticao","status","id");

CREATE TABLE ${t('RagnabotFluxoEfeito')} (
  "id" text PRIMARY KEY, "execucaoId" text NOT NULL, "tenantId" text NOT NULL, "noId" text NOT NULL,
  "visitaSeq" integer NOT NULL, "tentativa" integer NOT NULL DEFAULT 1, "sufixo" text NOT NULL DEFAULT '',
  "chave" text NOT NULL, "tipo" text NOT NULL,
  "politicaEmDuvida" text NOT NULL DEFAULT 'conciliar', "estadoAnterior" jsonb,
  "status" text NOT NULL DEFAULT 'reservado', "motivoDescarte" text, "idExterno" text,
  "httpStatus" integer, "resposta" jsonb, "erro" text, "custoEstimadoCentavos" integer,
  "reservadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "confirmadoEm" timestamp(3)
);
CREATE UNIQUE INDEX "RagnabotFluxoEfeito_chave_key" ON ${t('RagnabotFluxoEfeito')}("chave");

CREATE TABLE ${t('RagnabotFluxoEvento')} (
  "id" bigserial PRIMARY KEY, "tenantId" text NOT NULL, "versaoId" text NOT NULL,
  "execucaoId" text NOT NULL, "noId" text, "tipo" text NOT NULL, "saida" text,
  "viaCasamento" text, "latenciaMs" integer, "cwMessageId" integer, "detalhe" jsonb,
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ${t('RagnabotFluxoIncidente')} (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL, "versaoId" text NOT NULL, "noId" text NOT NULL,
  "codigo" text NOT NULL, "nivel" text NOT NULL DEFAULT 'erro', "mensagem" text NOT NULL,
  "comoCorrigir" text, "amostras" jsonb NOT NULL DEFAULT '[]',
  "ocorrencias" integer NOT NULL DEFAULT 1,
  "primeiraEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ultimaEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconhecidoPor" text, "reconhecidoEm" timestamp(3), "resolvidoEm" timestamp(3)
);
CREATE UNIQUE INDEX "RagnabotFluxoIncidente_versaoId_noId_codigo_key" ON ${t('RagnabotFluxoIncidente')}("versaoId","noId","codigo");

CREATE TABLE ${t('RagnabotFluxoCanalSaude')} (
  "cwAccountId" integer PRIMARY KEY, "ultimaEntradaEm" timestamp(3), "ultimoEnvioOkEm" timestamp(3),
  "atrasoP95Ms" integer, "degradadoDesde" timestamp(3), "degradadoAte" timestamp(3),
  "janelas" jsonb NOT NULL DEFAULT '[]', "atualizadoEm" timestamp(3) NOT NULL
);

CREATE TABLE ${t('RagnabotFluxoJanela')} (
  "id" text PRIMARY KEY, "phoneNumberId" text NOT NULL, "destinatarioWaId" text NOT NULL,
  "cwAccountId" integer NOT NULL, "ultimaEntradaEm" timestamp(3) NOT NULL,
  "expiraEm" timestamp(3) NOT NULL, "margemSegurancaSegundos" integer NOT NULL DEFAULT 300,
  "fechadaPeloDestinoEm" timestamp(3), "atualizadaEm" timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX "RagnabotFluxoJanela_phoneNumberId_destinatarioWaId_key" ON ${t('RagnabotFluxoJanela')}("phoneNumberId","destinatarioWaId");

CREATE TABLE ${t('RagnabotFluxoLimiteCanal')} (
  "id" text PRIMARY KEY, "perfil" text NOT NULL, "chave" text NOT NULL, "valor" integer NOT NULL,
  "unidade" text NOT NULL DEFAULT 'indefinida', "origem" text NOT NULL DEFAULT 'documentacao',
  "fonte" text, "conferidoEm" timestamp(3) NOT NULL
);
CREATE UNIQUE INDEX "RagnabotFluxoLimiteCanal_perfil_chave_key" ON ${t('RagnabotFluxoLimiteCanal')}("perfil","chave");

CREATE TABLE ${t('RagnabotFluxoSegredo')} (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL, "apelido" text NOT NULL,
  "valorCifrado" text NOT NULL, "fingerprint" text NOT NULL, "descricao" text,
  "criadoPorUserId" text, "rotacionadoEm" timestamp(3), "usadoEm" timestamp(3),
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RagnabotFluxoSegredo_tenantId_apelido_key" ON ${t('RagnabotFluxoSegredo')}("tenantId","apelido");

CREATE TABLE ${t('RagnabotFluxoDestinoPermitido')} (
  "id" text PRIMARY KEY, "tenantId" text NOT NULL, "host" text NOT NULL,
  "esquema" text NOT NULL DEFAULT 'https', "portas" integer[] NOT NULL DEFAULT '{443}',
  "aprovadoPorUserId" text, "observacao" text,
  "criadoEm" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RagnabotFluxoDestinoPermitido_tenantId_host_key" ON ${t('RagnabotFluxoDestinoPermitido')}("tenantId","host");
`;
}

/** As TRÊS coisas que o Prisma não expressa — migrações 2, 3 e 4 do contrato. */
function ddlMigracoesManuais(s, papel) {
  const t = (n) => `"${s}"."${n}"`;
  return `
-- migração 2: UMA execução viva por conversa. Os quatro estados ATIVOS ficam dentro; 'concluido' e
-- 'abandonado' ficam fora, porque retomada legítima (o cliente escreve de novo dias depois) precisa
-- poder nascer.
CREATE UNIQUE INDEX rb_exec_uma_viva_por_conversa
  ON ${t('RagnabotFluxoExecucao')} ("cwAccountId","cwConversationId")
  WHERE estado IN ('rodando','esperando','pausado_humano','pausado_duvida');

-- migração 3: versão publicada é IMUTÁVEL. Duas camadas: gatilho e REVOKE.
CREATE OR REPLACE FUNCTION "${s}".rb_recusa_update() RETURNS trigger AS $rb$
BEGIN
  RAISE EXCEPTION 'RagnabotFluxoVersao é imutável (só INSERT). Publique uma versão nova.';
END; $rb$ LANGUAGE plpgsql;
CREATE TRIGGER rb_versao_imutavel BEFORE UPDATE ON ${t('RagnabotFluxoVersao')}
  FOR EACH ROW EXECUTE FUNCTION "${s}".rb_recusa_update();

-- ⚠️ O REVOKE UPDATE ON "RagnabotFluxoVersao" FROM <papel da aplicacao> que a migracao 3 do
-- contrato pede NÃO ESTÁ AQUI, e a ausência é MEDIDA, não esquecimento. Ele é INCOMPATÍVEL com a
-- migração 4: a conferência de integridade referencial de uma FK trava a linha do PAI com
-- SELECT ... FOR KEY SHARE, e esse travamento exige privilegio de UPDATE na tabela referenciada.
-- Com o UPDATE revogado do DONO da tabela, todo INSERT em RagnabotFluxoNo, RagnabotFluxoAresta e
-- RagnabotFluxoExecucao passa a falhar com 42501 — ou seja, o motor não consegue nem projetar um
-- grafo nem abrir uma conversa. A prova isolada disso é a verificação
-- «REVOKE de UPDATE no dono quebra a FK composta», mais abaixo, que roda em schema descartável.
-- A imutabilidade fica com o GATILHO, que basta e não tem esse efeito colateral.

-- migração 4: as FKs COMPOSTAS que impedem junção cruzada entre empresas mesmo se o código errar.
ALTER TABLE ${t('RagnabotFluxoNo')} ADD CONSTRAINT rb_no_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES ${t('RagnabotFluxoVersao')}("tenantId","id") ON DELETE CASCADE;
ALTER TABLE ${t('RagnabotFluxoAresta')} ADD CONSTRAINT rb_aresta_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES ${t('RagnabotFluxoVersao')}("tenantId","id") ON DELETE CASCADE;
ALTER TABLE ${t('RagnabotFluxoExecucao')} ADD CONSTRAINT rb_exec_versao_fk
  FOREIGN KEY ("tenantId","versaoId") REFERENCES ${t('RagnabotFluxoVersao')}("tenantId","id") ON DELETE RESTRICT;
`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §SEMEADURA — tudo que esta bateria cria carrega o CARIMBO no id, para a limpeza ser cirúrgica.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

let seq = 0;
function novoId(prefixo) { return `zzf-${CARIMBO}-${prefixo}-${++seq}`; }
const agoraMais = (segundos) => new Date(Date.now() + segundos * 1000);

async function inserirFluxo({ id = novoId('fluxo'), tenantId = TENANT_A, nome = novoId('nome'), ...resto } = {}) {
  await q(
    `INSERT INTO ${T('RagnabotFluxo')}
       ("id","tenantId","nome","estado","entrada","visitasPorNoMax","atualizadoEm")
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [id, tenantId, nome, resto.estado ?? 'publicado', resto.entrada ?? 'caixa', resto.visitasPorNoMax ?? 10],
  );
  return id;
}

async function inserirVersao({ id = novoId('versao'), fluxoId, tenantId = TENANT_A, numero = 1,
  documento, noInicialId = 'n_inicio', noResgateId = null, modoMigracao = 'fixar' } = {}) {
  const doc = documento ?? documentoBase();
  await q(
    `INSERT INTO ${T('RagnabotFluxoVersao')}
       ("id","fluxoId","tenantId","numero","documento","hashDocumento","hashEstrutura",
        "noInicialId","noResgateId","perfilLimite","modoMigracao","publicadoEm")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11, now())`,
    [id, fluxoId, tenantId, numero, JSON.stringify(doc),
      crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex'),
      esqueletoRef(doc), noInicialId, noResgateId, 'whatsapp_cloud@2026-08', modoMigracao],
  );
  return id;
}

async function inserirExecucao({ id = novoId('exec'), tenantId = TENANT_A, cwConversationId,
  cwAccountId = CONTA_TESTE, fluxoId, versaoId, versaoInicialId = null, estado = 'rodando',
  noAtualId = 'n_inicio', noCongelado = null, leaseToken = null, leaseExpiraEm = null,
  donoWorker = null, visitaSeq = 0, aguardando = 'nada', aguardaDesde = null,
  expiraEm = agoraMais(3600) } = {}) {
  await q(
    `INSERT INTO ${T('RagnabotFluxoExecucao')}
       ("id","tenantId","cwAccountId","cwConversationId","fluxoId","versaoId","versaoInicialId",
        "estado","noAtualId","noCongelado","leaseToken","leaseExpiraEm","donoWorker","visitaSeq",
        "aguardando","aguardaDesde","expiraEm","atualizadaEm")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17, now())`,
    [id, tenantId, cwAccountId, cwConversationId, fluxoId, versaoId, versaoInicialId ?? versaoId,
      estado, noAtualId, noCongelado ? JSON.stringify(noCongelado) : null, leaseToken, leaseExpiraEm,
      donoWorker, visitaSeq, aguardando, aguardaDesde, expiraEm],
  );
  return id;
}

async function inserirAresta({ versaoId, tenantId = TENANT_A, de, saida, para }, cliente = null) {
  await q(
    `INSERT INTO ${T('RagnabotFluxoAresta')} ("id","versaoId","tenantId","de","saida","para")
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [novoId('aresta'), versaoId, tenantId, de, saida, para], cliente,
  );
}

async function inserirNo({ versaoId, tenantId = TENANT_A, noId, tipo = 'texto', ordem = 0,
  estaciona = false, segredosRef = [], destinosRef = [] }, cliente = null) {
  await q(
    `INSERT INTO ${T('RagnabotFluxoNo')}
       ("id","versaoId","tenantId","noId","tipo","ordem","estaciona","segredosRef","destinosRef")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [novoId('no'), versaoId, tenantId, noId, tipo, ordem, estaciona, segredosRef, destinosRef], cliente,
  );
}

async function inserirJob({ tipo = 'entrada', chaveParticao, tenantId = TENANT_A, execucaoId = null,
  status = 'pendente', donoWorker = null, travadoEm = null, disponivelEm = new Date() } = {}) {
  const r = await q(
    `INSERT INTO ${T('RagnabotFluxoFila')}
       ("tipo","chaveParticao","tenantId","execucaoId","status","donoWorker","travadoEm","disponivelEm","atualizadoEm")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING "id"`,
    [tipo, chaveParticao, tenantId, execucaoId, status, donoWorker, travadoEm, disponivelEm],
  );
  return r.rows[0].id;
}

/** Documento mínimo mas fiel ao fluxo real medido: início → pergunta que ESTACIONA → encerrar,
 *  com as três saídas de exceção declaradas no nó que estaciona. */
function documentoBase({ tituloConfirma = 'Sim! Abra o chamado! ✅ ', extra = null } = {}) {
  const nos = [
    { id: 'n_inicio', tipo: 'inicio', saidas: ['padrao'] },
    { id: 'n_saudacao', tipo: 'texto', texto: 'Olá! Sou o robô da Ragnatela.', saidas: ['padrao'] },
    {
      id: 'n_confirma', tipo: 'lista', saidas: ['op_sim', 'op_nao', 'sem_resposta', 'opcao_invalida', 'erro'],
      itens: [{ id: 'op_sim', titulo: tituloConfirma }, { id: 'op_nao', titulo: 'Não! Recomece!' }],
    },
    { id: 'n_fim', tipo: 'encerrar', saidas: [] },
  ];
  const arestas = [
    { de: 'n_inicio', saida: 'padrao', para: 'n_saudacao' },
    { de: 'n_saudacao', saida: 'padrao', para: 'n_confirma' },
    { de: 'n_confirma', saida: 'op_sim', para: 'n_fim' },
    { de: 'n_confirma', saida: 'op_nao', para: 'n_saudacao' },
    { de: 'n_confirma', saida: 'sem_resposta', para: 'n_confirma' },
    { de: 'n_confirma', saida: 'opcao_invalida', para: 'n_confirma' },
    { de: 'n_confirma', saida: 'erro', para: 'n_fim' },
  ];
  if (extra) { nos.push(extra.no); arestas.push(...(extra.arestas ?? [])); }
  return { nos, arestas, variaveis: [{ nome: 'detalhes', tipo: 'texto', obrigatoria: true }] };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 1 — ESTRUTURA: o que o Prisma não expressa e um `db push` apaga em silêncio
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoEstrutura() {
  await checar('índice único PARCIAL de execução viva existe', async () => {
    const r = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='RagnabotFluxoExecucao'
         AND indexdef ILIKE '%WHERE%estado%'`, [SCHEMA]);
    afirmar(r.rows.length > 0,
      'não existe índice PARCIAL em RagnabotFluxoExecucao. Sem ele, duas execuções vivas cabem na MESMA conversa — dois robôs falando com a mesma pessoa, e o sintoma só aparece sob concorrência.');
    return r.rows[0].indexdef.replace(/\s+/g, ' ').slice(0, 150);
  });

  await checar('o WHERE do índice parcial cobre EXATAMENTE os estados ativos do contrato', async () => {
    const r = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='RagnabotFluxoExecucao'
         AND indexdef ILIKE '%WHERE%estado%'`, [SCHEMA]);
    afirmar(r.rows.length > 0, 'índice parcial ausente (ver verificação anterior)');
    const def = r.rows[0].indexdef;
    const noIndice = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    // A constante do CÓDIGO é a outra metade da comparação. Se o módulo já existir, ele manda;
    // senão vale a lista do contrato — e isso fica escrito no veredito.
    const achado = await doMotor('ESTADOS_ATIVOS');
    const doCodigo = [...(achado.valor ?? ESTADOS_ATIVOS_CONTRATO)].sort();
    const fonte = achado.fonte ?? 'contrato (nenhum módulo do motor exporta ESTADOS_ATIVOS)';
    afirmarIgual(noIndice, doCodigo,
      `o índice e a constante DIVERGEM. Acrescentar estado ativo sem incluí-lo no WHERE reabre a porta para duas execuções na mesma conversa. Fonte da constante: ${fonte}`);
    return `${noIndice.join(', ')} · fonte da constante: ${fonte}`;
  });

  await checar('gatilho de imutabilidade da versão existe', async () => {
    const r = await q(
      `SELECT tg.tgname FROM pg_trigger tg
         JOIN pg_class c ON c.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname=$1 AND c.relname='RagnabotFluxoVersao' AND NOT tg.tgisinternal`, [SCHEMA]);
    afirmar(r.rows.length > 0,
      'RagnabotFluxoVersao NÃO tem gatilho. Sem ele um UPDATE reescreve a versão publicada e o D10 renasce — foi assim que a telemetria dentro do documento sobreviveu catorze meses sem ninguém perceber.');
    return r.rows.map((x) => x.tgname).join(', ');
  });

  await checar('as três FKs COMPOSTAS (tenantId, versaoId) existem', async () => {
    const r = await q(
      `SELECT c.relname AS tabela, con.conname
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname=$1 AND con.contype='f' AND array_length(con.conkey,1)=2
          AND c.relname IN ('RagnabotFluxoNo','RagnabotFluxoAresta','RagnabotFluxoExecucao')`, [SCHEMA]);
    const tabelas = r.rows.map((x) => x.tabela).sort();
    afirmarIgual(tabelas, ['RagnabotFluxoAresta', 'RagnabotFluxoExecucao', 'RagnabotFluxoNo'],
      'falta FK composta. É ELA que impede uma execução da empresa A amarrar numa versão da empresa B mesmo quando o código erra o filtro — que é exatamente como o sistema antigo vazou dados entre empresas.');
    return r.rows.map((x) => `${x.tabela}:${x.conname}`).join(' · ');
  });

  await checar('único por saída em RagnabotFluxoAresta (o fan-out acidental D5 morre no banco)', async () => {
    const r = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='RagnabotFluxoAresta'
         AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%saida%'`, [SCHEMA]);
    afirmar(r.rows.length > 0,
      'sem único (versaoId, de, saida) o D5 medido volta: duas arestas na MESMA saída, com o encerramento pendurado em apenas um dos ramos.');
    return r.rows[0].indexdef.replace(/\s+/g, ' ').slice(0, 130);
  });

  await checar('único de idempotência da entrada é NOT NULL (chave calculada, nunca par anulável)', async () => {
    const col = await q(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema=$1 AND table_name='RagnabotFluxoEntrada' AND column_name='chave'`, [SCHEMA]);
    afirmar(col.rows.length === 1, 'coluna RagnabotFluxoEntrada.chave não existe');
    afirmarIgual(col.rows[0].is_nullable, 'NO',
      'chave anulável ANULA a idempotência: dois NULOS não são iguais no Postgres, então o índice único vira carimbo decorativo e toda reentrega passa como mensagem nova.');
    const idx = await q(
      `SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND tablename='RagnabotFluxoEntrada'
         AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%chave%'`, [SCHEMA]);
    afirmar(idx.rows.length > 0, 'falta o índice único sobre RagnabotFluxoEntrada.chave');
    return 'chave NOT NULL + índice único presentes';
  });

  await checar('MEDIÇÃO: o REVOKE da migração 3 QUEBRA as FKs da migração 4', async () => {
    // ⚠️ CONTRADIÇÃO INTERNA DO CONTRATO, medida aqui e não deduzida.
    // A migração 3 manda `REVOKE UPDATE ON "RagnabotFluxoVersao" FROM <papel da aplicação>` como
    // segunda camada da imutabilidade. Acontece que a conferência de integridade referencial de uma
    // FK trava a linha do PAI com SELECT ... FOR KEY SHARE, e esse travamento exige privilégio de
    // UPDATE na tabela referenciada. Como o papel da aplicação É o DONO das tabelas nesta
    // instalação, revogar o UPDATE dele derruba TODO INSERT nas três filhas da migração 4 — nó,
    // aresta e execução. Na prática: o motor não projeta grafo nem abre conversa.
    //
    // Esta verificação existe para que ninguém "conserte" a ausência do REVOKE mais tarde achando
    // que foi esquecimento. Ela roda num schema descartável, para não tocar em nada de produção.
    const ensaio = `rb_revoke_${CARIMBO}`;
    const papel = (await q('SELECT current_user AS u')).rows[0].u;
    try {
      await q(`DROP SCHEMA IF EXISTS "${ensaio}" CASCADE`);
      await q(`CREATE SCHEMA "${ensaio}"`);
      await q(`CREATE TABLE "${ensaio}".pai ("tenantId" text NOT NULL, "id" text PRIMARY KEY)`);
      await q(`CREATE UNIQUE INDEX ON "${ensaio}".pai ("tenantId","id")`);
      await q(`CREATE TABLE "${ensaio}".filha ("id" text PRIMARY KEY, "tenantId" text NOT NULL, "paiId" text NOT NULL,
               CONSTRAINT fk FOREIGN KEY ("tenantId","paiId") REFERENCES "${ensaio}".pai("tenantId","id"))`);
      await q(`INSERT INTO "${ensaio}".pai VALUES ('t1','p1')`);
      await q(`INSERT INTO "${ensaio}".filha VALUES ('f0','t1','p1')`);

      await q(`REVOKE UPDATE ON "${ensaio}".pai FROM "${papel}"`);

      // (a) o REVOKE vale mesmo contra o DONO da tabela — muita gente supõe que o dono passa por
      //     cima, e não passa.
      const e1 = await esperarErroPg('42501', () => q(`UPDATE "${ensaio}".pai SET "id"="id"`),
        'o REVOKE não valeu contra o dono da tabela');
      // (b) e o mesmo REVOKE derruba o INSERT na filha, que não tem nada a ver com imutabilidade.
      const e2 = await esperarErroPg('42501', () => q(`INSERT INTO "${ensaio}".filha VALUES ('f1','t1','p1')`),
        'o REVOKE NÃO quebrou o INSERT na filha — se um dia deixar de quebrar (mudança de versão do Postgres), o REVOKE pode voltar à migração 3 e a imutabilidade ganha a segunda camada de volta');
      // (c) devolvendo o privilégio, a filha volta a aceitar INSERT — prova de que a causa é o
      //     privilégio, e não outro detalhe do fixture.
      await q(`GRANT UPDATE ON "${ensaio}".pai TO "${papel}"`);
      await q(`INSERT INTO "${ensaio}".filha VALUES ('f2','t1','p1')`);
      return `UPDATE do dono recusado (${e1.code}) e INSERT na filha recusado (${e2.code}) pelo MESMO revoke; com o GRANT de volta, o INSERT passa`;
    } finally {
      await q(`DROP SCHEMA IF EXISTS "${ensaio}" CASCADE`).catch(() => {});
    }
  });

  await checar('em `public`, o privilégio de UPDATE na versão está PRESERVADO (por causa do achado acima)', async () => {
    if (MODO !== 'real') pular('só faz sentido no modo real — no ensaio o schema é deste arquivo');
    const r = await q(
      `SELECT c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='RagnabotFluxoVersao'`);
    const acl = r.rows[0]?.acl ?? '';
    const papel = (await q('SELECT current_user AS u')).rows[0].u;
    // ACL nula = privilégios padrão do dono, ou seja, UPDATE presente.
    const temUpdate = !acl || new RegExp(`${papel}=[a-zA-Z]*w`).test(acl);
    afirmar(temUpdate,
      `o UPDATE foi revogado de ${papel} em RagnabotFluxoVersao (ACL ${acl}). Isso NÃO fortalece a imutabilidade — o gatilho já a garante — e QUEBRA todo INSERT em RagnabotFluxoNo, RagnabotFluxoAresta e RagnabotFluxoExecucao por causa da conferência de FK. Devolva com: GRANT UPDATE ON "RagnabotFluxoVersao" TO ${papel};`);
    return `ACL ${acl || '(padrão do dono)'} — imutabilidade fica por conta do gatilho`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 2 — COMPORTAMENTO DO ÍNDICE PARCIAL: uma execução viva por conversa
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoUmaExecucaoViva(base) {
  await checar('segunda execução ATIVA na mesma conversa é RECUSADA pelo banco', async () => {
    const conversa = 700100;
    await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'rodando' });
    const e = await esperarErroPg('23505', () => inserirExecucao({
      cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'esperando',
    }), 'duas execuções vivas na mesma conversa = dois robôs falando com a mesma pessoa');
    return `recusado com ${e.code}`;
  });

  await checar('estado PAUSADO conta como vivo (o cliente não pode receber a saudação de novo)', async () => {
    for (const pausado of ['pausado_humano', 'pausado_duvida']) {
      const conversa = 700110 + (pausado === 'pausado_duvida' ? 1 : 0);
      await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: pausado });
      await esperarErroPg('23505', () => inserirExecucao({
        cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'rodando',
      }), `execução em ${pausado} tem de bloquear uma segunda: se não bloquear, a mensagem nova do cliente abre execução nova e ele recebe a saudação de novo NO MEIO de um problema`);
    }
    return 'pausado_humano e pausado_duvida bloqueiam a segunda execução';
  });

  await checar('retomada legítima é PERMITIDA depois de concluído/abandonado', async () => {
    for (const terminal of ESTADOS_TERMINAIS_CONTRATO) {
      const conversa = 700200 + ESTADOS_TERMINAIS_CONTRATO.indexOf(terminal);
      await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: terminal });
      // Se isto falhar, o cliente que escreve de novo dias depois NUNCA mais é atendido pelo robô.
      await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'rodando' });
    }
    return `nasceu execução nova depois de ${ESTADOS_TERMINAIS_CONTRATO.join(', ')}`;
  });

  await checar('duas execuções TERMINAIS na mesma conversa convivem (histórico não colide)', async () => {
    const conversa = 700300;
    await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'concluido' });
    await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'abandonado' });
    const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoExecucao')}
                        WHERE "cwAccountId"=$1 AND "cwConversationId"=$2`, [CONTA_TESTE, conversa]);
    afirmarIgual(r.rows[0].n, 2, 'o índice parcial não pode barrar histórico');
    return '2 execuções encerradas convivem';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 3 — IMUTABILIDADE DA VERSÃO (a correção direta do D10)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoImutabilidade(base) {
  await checar('UPDATE em RagnabotFluxoVersao é RECUSADO (gatilho e/ou REVOKE)', async () => {
    // 42501 = permissão negada (REVOKE) · P0001 = exceção levantada pelo gatilho.
    const e = await esperarErroPg(['42501', 'P0001'], () => q(
      `UPDATE ${T('RagnabotFluxoVersao')} SET "notaPublicacao"='adulterado' WHERE "id"=$1`, [base.v1]),
      'versão publicada tem de ser imutável: se um UPDATE passa, a definição do fluxo pode ser reescrita por baixo de conversas em andamento — e ninguém percebe, porque nada muda de nome');
    return `recusado com ${e.code}: ${String(e.message).split('\n')[0].slice(0, 90)}`;
  });

  await checar('UPDATE de QUALQUER coluna é recusado, não só das “importantes”', async () => {
    for (const col of ['documento', 'numero', 'hashEstrutura', 'publicadoEm']) {
      await esperarErroPg(['42501', 'P0001'], () => q(
        `UPDATE ${T('RagnabotFluxoVersao')} SET "${col}" = "${col}" WHERE "id"=$1`, [base.v1]),
        `UPDATE na coluna ${col} passou — a defesa é por OPERAÇÃO, não por coluna`);
    }
    return '4 colunas testadas, todas recusadas';
  });

  await checar('INSERT de versão nova continua funcionando (imutável ≠ congelado)', async () => {
    const id = await inserirVersao({ fluxoId: base.fluxoId, numero: 90, documento: documentoBase({ tituloConfirma: 'Sim' }) });
    afirmar(!!id, 'não consegui publicar versão nova');
    return `versão nº 90 publicada (${id})`;
  });

  await checar('número de versão repetido no mesmo fluxo é recusado', async () => {
    const e = await esperarErroPg('23505', () => inserirVersao({ fluxoId: base.fluxoId, numero: 1 }),
      'número de versão repetido quebra a comparação entre versões — e é justamente ela que transforma “reduzir a pausa e medir o efeito sobre os 29 % de abandono” de opinião em medição');
    return `recusado com ${e.code}`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 4 — CERCA ENTRE EMPRESAS: o banco recusa mesmo quando o código erra o filtro
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoCercaEntreEmpresas(base) {
  await checar('execução da empresa A não pode apontar para versão da empresa B', async () => {
    const e = await esperarErroPg('23503', () => inserirExecucao({
      tenantId: TENANT_A, cwConversationId: 700400, fluxoId: base.fluxoId, versaoId: base.versaoDeB,
    }), 'sub-fluxo apontando para versão de outra empresa é o caso concreto que a FK composta existe para barrar');
    return `recusado com ${e.code}`;
  });

  await checar('nó da empresa A não pode ser projetado numa versão da empresa B', async () => {
    const e = await esperarErroPg('23503', () => inserirNo({ versaoId: base.versaoDeB, tenantId: TENANT_A, noId: 'n_intruso' }),
      'projeção cruzada entre empresas');
    return `recusado com ${e.code}`;
  });

  await checar('aresta da empresa A não pode ser projetada numa versão da empresa B', async () => {
    // ⚠️ Esta é a verificação que só existe porque a coluna `tenantId` foi ACRESCENTADA à aresta.
    // O §2.2 da especificação publica o modelo SEM ela, mas o §2.8 manda criar a FK composta "de
    // nó, ARESTA e execução". Sem a coluna, a aresta seria o único elemento do grafo sem cerca.
    const e = await esperarErroPg('23503', () => inserirAresta({
      versaoId: base.versaoDeB, tenantId: TENANT_A, de: 'n_a', saida: 'padrao', para: 'n_b',
    }), 'aresta cruzada entre empresas');
    return `recusado com ${e.code}`;
  });

  await checar('versão COM execução viva não pode ser apagada (RESTRICT é a segunda tranca)', async () => {
    const fluxoId = await inserirFluxo({});
    const v = await inserirVersao({ fluxoId, numero: 1 });
    await inserirExecucao({ cwConversationId: 700500, fluxoId, versaoId: v });
    const e = await esperarErroPg('23503', () => q(`DELETE FROM ${T('RagnabotFluxoVersao')} WHERE "id"=$1`, [v]),
      'apagar versão órfã telemetria e auditoria de uma vez só — e deixa a execução apontando para o nada');
    return `recusado com ${e.code}`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 5 — FAN-OUT ACIDENTAL (D5): uma aresta por saída, imposto pelo banco
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoFanOut(base) {
  await checar('duas arestas na MESMA saída são recusadas', async () => {
    await inserirAresta({ versaoId: base.v1, de: 'n_confirma', saida: 'op_sim', para: 'n_fim' });
    const e = await esperarErroPg('23505', () => inserirAresta({
      versaoId: base.v1, de: 'n_confirma', saida: 'op_sim', para: 'n_saudacao',
    }), 'foi assim que o D5 medido nasceu: duas arestas na mesma saída do envio, com o encerramento pendurado em apenas UM dos ramos — validador tem caminho que o contorna, restrição de banco não tem');
    return `recusado com ${e.code}`;
  });

  await checar('as TRÊS saídas de exceção convivem no mesmo nó', async () => {
    for (const saida of ['sem_resposta', 'opcao_invalida', 'erro']) {
      await inserirAresta({ versaoId: base.v1, de: 'n_confirma', saida, para: 'n_confirma' });
    }
    // `erro_interno` é saída SEPARADA de `erro` de propósito: falha de encanamento interno (o aviso
    // ao plantonista que não saiu) JAMAIS pode transferir o cliente para um humano.
    await inserirAresta({ versaoId: base.v1, de: 'n_confirma', saida: 'erro_interno', para: 'n_confirma' });
    const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoAresta')}
                        WHERE "versaoId"=$1 AND "de"='n_confirma'`, [base.v1]);
    afirmar(r.rows[0].n >= 5, `esperava ao menos 5 saídas distintas em n_confirma, achei ${r.rows[0].n}`);
    return `${r.rows[0].n} saídas distintas, incluindo erro e erro_interno separados`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 6 — IDEMPOTÊNCIA: reprocessar não pode duplicar efeito
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoIdempotencia(base) {
  await checar('reentrega do MESMO webhook grava UMA linha (ON CONFLICT DO NOTHING)', async () => {
    const chave = `zzf-${CARIMBO}-entrada-repetida`;
    const inserir = () => q(
      `INSERT INTO ${T('RagnabotFluxoEntrada')} ("id","chave","tenantId","cwAccountId","evento","classe","corpo")
       VALUES ($1,$2,$3,$4,'message_created','resposta_cliente','{}'::jsonb)
       ON CONFLICT ("chave") DO NOTHING`,
      [novoId('entrada'), chave, TENANT_A, CONTA_TESTE]);
    await inserir(); await inserir(); await inserir();
    const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoEntrada')} WHERE "chave"=$1`, [chave]);
    afirmarIgual(r.rows[0].n, 1, 'a reentrega duplicou a entrada');
    return '3 entregas → 1 linha';
  });

  await checar('reentrega SIMULTÂNEA por 8 conexões grava UMA linha só', async () => {
    // Reentrega concorrente é o caso real: o Chatwoot reenvia quando não vê o 200 a tempo, e nada
    // garante que a segunda entrega espere a primeira terminar.
    const chave = `zzf-${CARIMBO}-entrada-corrida`;
    const clientes = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    try {
      const resultados = await Promise.all(clientes.map((c, i) => c.query(
        `INSERT INTO ${T('RagnabotFluxoEntrada')} ("id","chave","tenantId","cwAccountId","evento","classe","corpo")
         VALUES ($1,$2,$3,$4,'message_created','resposta_cliente','{}'::jsonb)
         ON CONFLICT ("chave") DO NOTHING`,
        [novoId(`entrada-c${i}`), chave, TENANT_A, CONTA_TESTE]).then((r) => r.rowCount)));
      const venceram = resultados.filter((n) => n === 1).length;
      afirmarIgual(venceram, 1, `${venceram} conexões acharam que inseriram — só uma podia`);
      const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoEntrada')} WHERE "chave"=$1`, [chave]);
      afirmarIgual(r.rows[0].n, 1, 'sobrou mais de uma linha para a mesma chave');
      return '8 conexões simultâneas → 1 linha, 1 vencedora';
    } finally { clientes.forEach((c) => c.release()); }
  });

  await checar('campo VOLÁTIL reescrito pelo emissor não muda a chave de entrada', async () => {
    // Se `updated_at` entrasse na chave, a reentrega geraria chave nova e passaria direto — a
    // idempotência viraria enfeite exatamente no caso em que ela precisa existir.
    const primeira = { conversation: { id: 991, status: 'open', updated_at: 1000, unread_count: 1 } };
    const segunda = { conversation: { id: 991, status: 'open', updated_at: 2000, unread_count: 7 } };
    const achado = await doMotor('chaveDeEntrada');
    const fn = typeof achado.valor === 'function' ? achado.valor : chaveDeEntradaRef;
    const fonte = achado.fonte ?? 'referência deste arquivo (nenhum módulo do motor exporta chaveDeEntrada)';
    const a = fn(primeira, { cwAccountId: CONTA_TESTE, evento: 'conversation_updated' });
    const b = fn(segunda, { cwAccountId: CONTA_TESTE, evento: 'conversation_updated' });
    afirmarIgual(a, b, `a chave mudou só porque o emissor reescreveu um contador — implementação usada: ${fonte}`);
    // E o oposto: mudança REAL tem de gerar chave diferente, senão a chave apaga eventos legítimos.
    const c = fn({ conversation: { id: 992, status: 'open', updated_at: 1000 } }, { cwAccountId: CONTA_TESTE, evento: 'conversation_updated' });
    afirmar(a !== c, 'conversas diferentes geraram a MESMA chave — isso engoliria evento legítimo');
    return `chave estável sob campo volátil · implementação: ${fonte}`;
  });

  await checar('a mesma mensagem não é consumida duas vezes pela mesma execução', async () => {
    // Segunda barreira: a primeira protege contra REENTREGA, esta contra trabalho ceifado e
    // reprocessado, dreno duplicado e migração de fila.
    const execucaoId = await inserirExecucao({ cwConversationId: 700600, fluxoId: base.fluxoId, versaoId: base.v1 });
    const consumir = () => q(
      `INSERT INTO ${T('RagnabotFluxoEntradaConsumida')} ("execucaoId","cwMessageId","noId") VALUES ($1,$2,$3)`,
      [execucaoId, 55501, 'n_confirma']);
    await consumir();
    const e = await esperarErroPg('23505', consumir,
      'gravar a mesma mensagem duas vezes escreve a resposta do cliente na variável errada e o chamado nasce com os campos trocados');
    return `recusado com ${e.code}`;
  });

  await checar('chave do efeito distingue VISITA, TENTATIVA e DESTINATÁRIO', async () => {
    const achado = await doMotor('chaveEfeito');
    const fn = typeof achado.valor === 'function' ? achado.valor : chaveEfeitoRef;
    const fonte = achado.fonte ?? 'referência deste arquivo (nenhum módulo do motor exporta chaveEfeito)';
    const base0 = { execucaoId: 'e1', noId: 'n_confirma', visitaSeq: 1, tentativa: 1, sufixo: '' };
    const k = fn(base0);
    afirmarIgual(fn({ ...base0 }), k, 'a chave não é determinística');
    // Uma chave derivada só de «protocolo:nó» seria CONSTANTE entre visitas — e faria um segundo
    // chamado legítimo na mesma conversa ser descartado em silêncio enquanto o cliente lê
    // «registrado com sucesso». Seria o D3 renascido por outro caminho.
    const variacoes = {
      'visita diferente': fn({ ...base0, visitaSeq: 2 }),
      'tentativa diferente': fn({ ...base0, tentativa: 2 }),
      'destinatário diferente': fn({ ...base0, sufixo: '5598999990000' }),
      'nó diferente': fn({ ...base0, noId: 'n_fim' }),
      'execução diferente': fn({ ...base0, execucaoId: 'e2' }),
    };
    for (const [nome, valor] of Object.entries(variacoes)) {
      afirmar(valor !== k, `${nome} produziu a MESMA chave — colisão silenciosa de efeito`);
    }
    const todas = new Set([k, ...Object.values(variacoes)]);
    afirmarIgual(todas.size, 6, 'houve colisão entre as variações');
    return `6 chaves distintas · implementação: ${fonte}`;
  });

  await checar('efeito com a mesma chave não é reservado duas vezes', async () => {
    const execucaoId = await inserirExecucao({ cwConversationId: 700610, fluxoId: base.fluxoId, versaoId: base.v1 });
    const chave = chaveEfeitoRef({ execucaoId, noId: 'n_confirma', visitaSeq: 1 });
    const reservar = () => q(
      `INSERT INTO ${T('RagnabotFluxoEfeito')}
         ("id","execucaoId","tenantId","noId","visitaSeq","tentativa","sufixo","chave","tipo")
       VALUES ($1,$2,$3,'n_confirma',1,1,'',$4,'msg_lista')`,
      [novoId('efeito'), execucaoId, TENANT_A, chave]);
    await reservar();
    const e = await esperarErroPg('23505', reservar,
      'reservar duas vezes o mesmo efeito é a lista chegando duas vezes no celular do cliente');
    return `recusado com ${e.code}`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 7 — CONCORRÊNCIA: dois processos disputando a MESMA conversa
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoConcorrencia(base) {
  await checar('8 trabalhadores disputando a posse: exatamente 1 vence', async () => {
    const execucaoId = await inserirExecucao({ cwConversationId: 700700, fluxoId: base.fluxoId, versaoId: base.v1 });
    const clientes = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    try {
      const resultados = await Promise.all(clientes.map((c, i) => c.query(
        `UPDATE ${T('RagnabotFluxoExecucao')}
            SET "donoWorker"=$1, "leaseToken"=$2, "leaseExpiraEm"= now() + interval '30 seconds',
                "atualizadaEm"= now()
          WHERE "id"=$3 AND ("leaseExpiraEm" IS NULL OR "leaseExpiraEm" < now())`,
        [`worker-${i}`, `token-${i}`, execucaoId]).then((r) => r.rowCount)));
      const venceram = resultados.filter((n) => n === 1).length;
      // NINGUÉM ESPERA a posse: quem perde ignora o candidato nesta rodada, sem marcar em
      // processamento, sem incrementar tentativas e sem adiar — senão as 8 tentativas de um
      // trabalho SADIO são queimadas só porque outro processo estava com a conversa.
      afirmarIgual(venceram, 1, `${venceram} trabalhadores acharam que tomaram a posse — sob concorrência isso é dois robôs avançando a mesma conversa`);
      return '8 disputaram, 1 venceu, 7 recuaram sem efeito colateral';
    } finally { clientes.forEach((c) => c.release()); }
  });

  await checar('CERCA: trabalhador com token velho não avança e NÃO deixa efeito', async () => {
    const execucaoId = await inserirExecucao({ cwConversationId: 700710, fluxoId: base.fluxoId, versaoId: base.v1 });
    // A toma a posse.
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "donoWorker"='A',"leaseToken"='tA',
             "leaseExpiraEm"= now() + interval '30 seconds', "atualizadaEm"= now() WHERE "id"=$1`, [execucaoId]);
    // A congela (pausa longa de coletor de lixo). O arrendamento vence. B assume.
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "leaseExpiraEm"= now() - interval '1 second' WHERE "id"=$1`, [execucaoId]);
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "donoWorker"='B',"leaseToken"='tB',
             "leaseExpiraEm"= now() + interval '30 seconds', "atualizadaEm"= now()
             WHERE "id"=$1 AND ("leaseExpiraEm" IS NULL OR "leaseExpiraEm" < now())`, [execucaoId]);

    // A descongela e tenta o passo INTEIRO, na ordem do contrato: reserva do efeito e só depois a
    // cerca. Zero linhas na cerca ⇒ a transação volta atrás COM a reserva dentro.
    const c = await pool.connect();
    let houvePossePerdida = false;
    const chave = chaveEfeitoRef({ execucaoId, noId: 'n_confirma', visitaSeq: 9 });
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO ${T('RagnabotFluxoEfeito')}
           ("id","execucaoId","tenantId","noId","visitaSeq","tentativa","sufixo","chave","tipo")
         VALUES ($1,$2,$3,'n_confirma',9,1,'',$4,'msg_lista')`,
        [novoId('efeito'), execucaoId, TENANT_A, chave]);
      const r = await c.query(
        `UPDATE ${T('RagnabotFluxoExecucao')} SET "passosTotal"="passosTotal"+1, "atualizadaEm"= now()
          WHERE "id"=$1 AND "leaseToken"=$2 AND "leaseExpiraEm" > now()`, [execucaoId, 'tA']);
      if (r.rowCount === 0) { houvePossePerdida = true; await c.query('ROLLBACK'); }
      else await c.query('COMMIT');
    } finally { c.release(); }

    afirmar(houvePossePerdida, 'o trabalhador com token velho conseguiu avançar — a cerca não existe');
    const sobrou = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoEfeito')} WHERE "chave"=$1`, [chave]);
    afirmarIgual(sobrou.rows[0].n, 0, 'a reserva do efeito SOBREVIVEU à posse perdida — nenhum efeito pode escapar de uma transação revertida');
    const passos = await q(`SELECT "passosTotal" FROM ${T('RagnabotFluxoExecucao')} WHERE "id"=$1`, [execucaoId]);
    afirmarIgual(passos.rows[0].passosTotal, 0, 'a execução avançou apesar da posse perdida');
    return 'posse perdida → transação inteira revertida, zero efeito, zero passo';
  });

  await checar('primeira mensagem: trava de PARTIÇÃO deixa entrar um só', async () => {
    // Na primeira mensagem ainda não existe execução para arrendar, então a serialização é da
    // partição "conta:conversa".
    const particao = `${CONTA_TESTE}:700720`;
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await c1.query('BEGIN'); await c2.query('BEGIN');
      const r1 = await c1.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok', [particao]);
      const r2 = await c2.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok', [particao]);
      afirmar(r1.rows[0].ok === true, 'o primeiro não conseguiu a trava da partição');
      afirmar(r2.rows[0].ok === false, 'os DOIS conseguiram a trava da mesma partição — a serialização não existe');
      await c1.query('COMMIT');
      // Solta no commit: agora o segundo consegue.
      const r3 = await c2.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok', [particao]);
      afirmar(r3.rows[0].ok === true, 'a trava não foi liberada no commit — trava de transação tem de soltar sozinha');
      await c2.query('COMMIT');
      return 'trava de partição exclusiva e liberada no commit';
    } finally { c1.release(); c2.release(); }
  });

  await checar('SEGUNDA barreira: sem a trava, o índice parcial recusa a corrida', async () => {
    // O índice único parcial é a segunda barreira, não a primeira: sob corrida a colisão vira
    // 23505 (P2002 no Prisma), tratado recuperando a execução existente — mesmo padrão que
    // ragnabot-protocolo.service.js já usa e já provou em produção.
    const conversa = 700730;
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await c1.query('BEGIN');
      await c1.query(
        `INSERT INTO ${T('RagnabotFluxoExecucao')}
           ("id","tenantId","cwAccountId","cwConversationId","fluxoId","versaoId","versaoInicialId",
            "estado","expiraEm","atualizadaEm")
         VALUES ($1,$2,$3,$4,$5,$6,$6,'rodando', now() + interval '1 hour', now())`,
        [novoId('exec-c1'), TENANT_A, CONTA_TESTE, conversa, base.fluxoId, base.v1]);

      // O segundo tenta ao mesmo tempo: fica BLOQUEADO no índice até o primeiro decidir.
      const promessaSegundo = c2.query(
        `INSERT INTO ${T('RagnabotFluxoExecucao')}
           ("id","tenantId","cwAccountId","cwConversationId","fluxoId","versaoId","versaoInicialId",
            "estado","expiraEm","atualizadaEm")
         VALUES ($1,$2,$3,$4,$5,$6,$6,'rodando', now() + interval '1 hour', now())`,
        [novoId('exec-c2'), TENANT_A, CONTA_TESTE, conversa, base.fluxoId, base.v1]).then(
        () => ({ ok: true }), (e) => ({ ok: false, code: e.code }));

      await new Promise((r) => setTimeout(r, 150)); // tempo de o segundo realmente bloquear
      await c1.query('COMMIT');
      const res = await promessaSegundo;
      afirmar(res.ok === false, 'os DOIS inseriram execução viva na mesma conversa');
      afirmarIgual(res.code, '23505', `o segundo falhou com ${res.code} em vez da violação de único`);
      return 'o perdedor recebe 23505 e recupera a execução do vencedor';
    } finally { c1.release(); c2.release(); }
  });

  await checar('dreno de partição: dois trabalhadores nunca pegam o mesmo trabalho', async () => {
    const particao = `${CONTA_TESTE}:700740`;
    for (let i = 0; i < 6; i++) await inserirJob({ chaveParticao: particao });
    const [c1, c2] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      await c1.query('BEGIN'); await c2.query('BEGIN');
      const sql = `SELECT "id" FROM ${T('RagnabotFluxoFila')}
                    WHERE "chaveParticao"=$1 AND "status"='pendente' AND "disponivelEm" <= now()
                    ORDER BY "id" FOR UPDATE SKIP LOCKED`;
      const r1 = await c1.query(sql, [particao]);
      const r2 = await c2.query(sql, [particao]);
      const a = r1.rows.map((x) => String(x.id));
      const b = r2.rows.map((x) => String(x.id));
      const intersecao = a.filter((x) => b.includes(x));
      afirmarIgual(intersecao, [], 'os dois trabalhadores pegaram o MESMO trabalho — a rajada seria processada em dobro');
      // A rajada INTEIRA vai para um só. Dividir a rajada entre dois trabalhadores é como a segunda
      // mensagem do cliente acaba respondendo a próxima pergunta.
      afirmarIgual(a.length, 6, `o primeiro pegou ${a.length} de 6 — a rajada tem de ir inteira para um trabalhador só`);
      afirmarIgual(b.length, 0, `o segundo pegou ${b.length} trabalhos que não são dele`);
      await c1.query('ROLLBACK'); await c2.query('ROLLBACK');
      return 'rajada de 6 inteira para o primeiro, 0 para o segundo, interseção vazia';
    } finally { c1.release(); c2.release(); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 8 — RETOMADA APÓS REINÍCIO: o robô não pode ficar mudo no meio da frase
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoRetomada(base) {
  await checar('ceifador devolve trabalho de trabalhador MORTO e poupa o de trabalhador VIVO', async () => {
    const particao = `${CONTA_TESTE}:700800`;
    const morto = await inserirExecucao({ cwConversationId: 700800, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'esperando' });
    const vivo = await inserirExecucao({ cwConversationId: 700801, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'rodando' });
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "leaseToken"='vivo',
             "leaseExpiraEm"= now() + interval '30 seconds' WHERE "id"=$1`, [vivo]);

    const preso = new Date(Date.now() - 120_000); // 120 s > 90 s
    const jobMorto = await inserirJob({ chaveParticao: particao, execucaoId: morto, status: 'processando', donoWorker: 'pod-que-morreu', travadoEm: preso });
    const jobVivo = await inserirJob({ chaveParticao: `${CONTA_TESTE}:700801`, execucaoId: vivo, status: 'processando', donoWorker: 'pod-vivo', travadoEm: preso });

    // ⚠️ 90 s = 3× o arrendamento, para NUNCA ceifar trabalho de processo vivo que está renovando.
    const r = await q(
      `UPDATE ${T('RagnabotFluxoFila')} f
          SET "status"='pendente', "donoWorker"=NULL, "travadoEm"=NULL, "atualizadoEm"= now()
        WHERE f."status"='processando' AND f."travadoEm" < now() - interval '90 seconds'
          AND NOT EXISTS (SELECT 1 FROM ${T('RagnabotFluxoExecucao')} e
                           WHERE e."id"=f."execucaoId" AND e."leaseExpiraEm" > now())
          AND f."id" IN ($1,$2)
        RETURNING f."id"`, [jobMorto, jobVivo]);
    const devolvidos = r.rows.map((x) => String(x.id));
    afirmarIgual(devolvidos, [String(jobMorto)],
      'o ceifador devolveu o trabalho errado: ceifar trabalho de processo VIVO faz dois trabalhadores avançarem a mesma conversa; não ceifar o do processo morto congela a conversa e o cliente vê o robô emudecer');
    return 'trabalho do pod morto voltou a pendente; o do pod vivo ficou intacto';
  });

  await checar('varredor de órfãos cobre RODANDO **e** ESPERANDO (a armadilha do contrato)', async () => {
    const vencido = new Date(Date.now() - 60_000);
    const ids = [];
    for (const [estado, conversa] of [['rodando', 700810], ['esperando', 700811], ['concluido', 700812]]) {
      const id = await inserirExecucao({ cwConversationId: conversa, fluxoId: base.fluxoId, versaoId: base.v1, estado });
      await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "leaseToken"='velho', "leaseExpiraEm"=$2 WHERE "id"=$1`, [id, vencido]);
      ids.push(id);
    }
    const certa = await q(
      `SELECT "id" FROM ${T('RagnabotFluxoExecucao')}
        WHERE "estado" IN ('rodando','esperando') AND "leaseExpiraEm" < now() AND "id" = ANY($1)`, [ids]);
    afirmarIgual(certa.rows.length, 2,
      'o varredor tem de reenfileirar os DOIS estados; deixar `esperando` de fora é conversa parada para sempre depois de um reinício');
    const ingenua = await q(
      `SELECT "id" FROM ${T('RagnabotFluxoExecucao')}
        WHERE "estado" = 'rodando' AND "leaseExpiraEm" < now() AND "id" = ANY($1)`, [ids]);
    afirmarIgual(ingenua.rows.length, 1, 'a consulta ingênua deveria achar só 1 — se achou outro número, o fixture mudou');
    return 'consulta correta acha 2 (rodando+esperando); a ingênua acharia 1 e perderia a outra conversa';
  });

  await checar('SIGTERM devolve só o trabalho DESTE trabalhador', async () => {
    const particao = `${CONTA_TESTE}:700820`;
    const meus = [await inserirJob({ chaveParticao: particao, status: 'processando', donoWorker: 'pod-a', travadoEm: new Date() }),
      await inserirJob({ chaveParticao: particao, status: 'processando', donoWorker: 'pod-a', travadoEm: new Date() })];
    const alheio = await inserirJob({ chaveParticao: particao, status: 'processando', donoWorker: 'pod-b', travadoEm: new Date() });

    // Sem isto, cada implantação deixa N conversas travadas por até 30 s — e num RollingUpdate isso
    // acontece TODA VEZ.
    const r = await q(
      `UPDATE ${T('RagnabotFluxoFila')} SET "status"='pendente', "donoWorker"=NULL, "travadoEm"=NULL, "atualizadoEm"= now()
        WHERE "donoWorker"=$1 AND "status"='processando' RETURNING "id"`, ['pod-a']);
    afirmarIgual(r.rows.map((x) => String(x.id)).sort(), meus.map(String).sort(), 'devolveu trabalho que não é deste trabalhador');
    const outro = await q(`SELECT "status" FROM ${T('RagnabotFluxoFila')} WHERE "id"=$1`, [alheio]);
    afirmarIgual(outro.rows[0].status, 'processando', 'roubou o trabalho de outro trabalhador vivo');
    return '2 devolvidos, 0 roubados';
  });

  await checar('despertar obsoleto é DESCARTADO pelo token de visita', async () => {
    // Se o cliente respondeu antes do prazo, `visitaSeq` avançou e o despertar não vale mais. Sem
    // isso, resposta e expiração mandam a conversa por dois caminhos ao mesmo tempo — e ela chega
    // em dois nós diferentes.
    const execucaoId = await inserirExecucao({ cwConversationId: 700830, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'esperando', visitaSeq: 3 });
    const job = await inserirJob({ chaveParticao: `${CONTA_TESTE}:700830`, execucaoId, tipo: 'despertar' });
    await q(`UPDATE ${T('RagnabotFluxoFila')} SET "tokenVisita"=3 WHERE "id"=$1`, [job]);
    // O cliente respondeu: a visita avança.
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "visitaSeq"=4, "atualizadaEm"= now() WHERE "id"=$1`, [execucaoId]);
    const r = await q(
      `SELECT f."id" FROM ${T('RagnabotFluxoFila')} f
         JOIN ${T('RagnabotFluxoExecucao')} e ON e."id"=f."execucaoId"
        WHERE f."id"=$1 AND f."tokenVisita" = e."visitaSeq"`, [job]);
    afirmarIgual(r.rows.length, 0, 'o despertar obsoleto continuaria válido e a conversa seguiria por dois caminhos');
    return 'token de visita 3 ≠ visita atual 4 → despertar descartado';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 9 — PUBLICAR VERSÃO NOVA COM CONVERSA EM ANDAMENTO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoPublicacao(base) {
  // v2-compatível: MESMO esqueleto, só o texto do item mudou.
  const docV1 = documentoBase({ tituloConfirma: 'Sim! Abra o chamado! ✅ ' });
  const docV2Compat = documentoBase({ tituloConfirma: 'Sim, pode abrir o chamado' });
  // v2-estrutural: nó novo com aresta nova → esqueleto diferente.
  const docV2Estrutural = documentoBase({
    tituloConfirma: 'Sim! Abra o chamado! ✅ ',
    extra: { no: { id: 'n_email', tipo: 'pergunta', saidas: ['padrao'] }, arestas: [{ de: 'n_confirma', saida: 'op_sim', para: 'n_email' }] },
  });

  await checar('mudança só de TEXTO é classificada como compatível (retrofit seguro)', async () => {
    const achado = await doMotor('hashEstrutura');
    const hash = typeof achado.valor === 'function' ? achado.valor : esqueletoRef;
    const fonte = achado.fonte ?? 'referência deste arquivo (nenhum módulo do motor exporta hashEstrutura)';
    afirmarIgual(hash(docV1), hash(docV2Compat),
      `trocar o texto de um item mudou o hash de ESTRUTURA — se isso acontecer, toda correção de português vira migração estrutural e ninguém mais consegue corrigir um texto sem prender as conversas em andamento (${fonte})`);
    afirmar(hash(docV1) !== hash(docV2Estrutural),
      `acrescentar nó e aresta NÃO mudou o hash de estrutura — retrofit cego moveria conversas para um grafo diferente (${fonte})`);
    return `esqueleto igual para texto, diferente para nó novo · implementação: ${fonte}`;
  });

  await checar('retrofit move a execução para a v2 e a MIGRAÇÃO fica visível', async () => {
    const fluxoId = await inserirFluxo({});
    const v1 = await inserirVersao({ fluxoId, numero: 1, documento: docV1 });
    const congelado = { noId: 'n_confirma', itens: docV1.nos.find((n) => n.id === 'n_confirma').itens };
    const execucaoId = await inserirExecucao({
      cwConversationId: 700900, fluxoId, versaoId: v1, versaoInicialId: v1,
      estado: 'esperando', noAtualId: 'n_confirma', noCongelado: congelado, aguardando: 'resposta',
    });
    const v2 = await inserirVersao({ fluxoId, numero: 2, documento: docV2Compat, modoMigracao: 'retrofit' });

    const r = await q(
      `UPDATE ${T('RagnabotFluxoExecucao')} SET "versaoId"=$2, "atualizadaEm"= now()
        WHERE "id"=$1 AND "estado" IN ('rodando','esperando') RETURNING "versaoId","versaoInicialId"`,
      [execucaoId, v2]);
    afirmarIgual(r.rows[0].versaoId, v2, 'a execução não migrou');
    afirmarIgual(r.rows[0].versaoInicialId, v1,
      'a versão INICIAL foi sobrescrita — é ela que torna a migração visível na análise; sem ela não dá para comparar quem começou em qual versão');

    // O nó em que a pessoa está PARADA continua congelado: ela está olhando no celular uma mensagem
    // que JÁ SAIU e responde ÀQUILO. Trocar o título de um item enquanto a lista está aberta
    // corromperia a resposta em silêncio.
    const c = await q(`SELECT "noCongelado" FROM ${T('RagnabotFluxoExecucao')} WHERE "id"=$1`, [execucaoId]);
    const titulos = c.rows[0].noCongelado.itens.map((i) => i.titulo);
    afirmar(titulos.includes('Sim! Abra o chamado! ✅ '),
      'o nó congelado foi contaminado pela v2 — o retrofit tem de valer do PRÓXIMO nó em diante');
    return 'versaoId→v2, versaoInicialId=v1, nó congelado intacto';
  });

  await checar('modo FIXAR: a versão antiga não pode sumir enquanto houver conversa nela', async () => {
    const fluxoId = await inserirFluxo({});
    const v1 = await inserirVersao({ fluxoId, numero: 1, documento: docV1 });
    await inserirVersao({ fluxoId, numero: 2, documento: docV2Estrutural, modoMigracao: 'fixar' });
    await inserirExecucao({ cwConversationId: 700910, fluxoId, versaoId: v1, estado: 'esperando' });
    const e = await esperarErroPg('23503', () => q(`DELETE FROM ${T('RagnabotFluxoVersao')} WHERE "id"=$1`, [v1]),
      'com a v1 apagada, a conversa fixada nela ficaria apontando para o nada');
    // E a execução continua na v1, como manda o modo fixar.
    const r = await q(`SELECT "versaoId" FROM ${T('RagnabotFluxoExecucao')} WHERE "fluxoId"=$1`, [fluxoId]);
    afirmarIgual(r.rows[0].versaoId, v1, 'a execução saiu da versão em que foi fixada');
    return `DELETE recusado com ${e.code}; execução continua na v1`;
  });

  await checar('retrofit forçado: nó ausente na v2 manda a execução para o RESGATE', async () => {
    const fluxoId = await inserirFluxo({});
    const v1 = await inserirVersao({ fluxoId, numero: 1, documento: docV1 });
    // v2 sem o nó `n_confirma`, mas COM nó de resgate declarado.
    const docSemConfirma = { nos: docV1.nos.filter((n) => n.id !== 'n_confirma'), arestas: [], variaveis: [] };
    const v2 = await inserirVersao({ fluxoId, numero: 2, documento: docSemConfirma, noResgateId: 'n_fim', modoMigracao: 'retrofit_forcado' });
    const execucaoId = await inserirExecucao({
      cwConversationId: 700920, fluxoId, versaoId: v1, versaoInicialId: v1, estado: 'esperando', noAtualId: 'n_confirma',
    });

    // ⚠️ RECUSA EXPLÍCITA de reencaixe por semelhança: mandar a conversa para o nó "mais parecido"
    // erra em silêncio, e errar em silêncio no meio de uma conversa de cliente é pior que parar.
    const existeNaV2 = docSemConfirma.nos.some((n) => n.id === 'n_confirma');
    afirmar(!existeNaV2, 'fixture inválido: o nó deveria ter sumido da v2');
    await q(`UPDATE ${T('RagnabotFluxoExecucao')} SET "versaoId"=$2, "noAtualId"='n_fim', "atualizadaEm"= now() WHERE "id"=$1`, [execucaoId, v2]);
    await q(`INSERT INTO ${T('RagnabotFluxoEvento')} ("tenantId","versaoId","execucaoId","noId","tipo")
             VALUES ($1,$2,$3,'n_confirma','resgatado')`, [TENANT_A, v2, execucaoId]);

    const r = await q(`SELECT e."noAtualId", e."versaoInicialId",
                              (SELECT count(*)::int FROM ${T('RagnabotFluxoEvento')} ev
                                WHERE ev."execucaoId"=e."id" AND ev."tipo"='resgatado') AS resgates
                         FROM ${T('RagnabotFluxoExecucao')} e WHERE e."id"=$1`, [execucaoId]);
    afirmarIgual(r.rows[0].noAtualId, 'n_fim', 'a execução órfã não foi para o nó de resgate');
    afirmarIgual(r.rows[0].versaoInicialId, v1, 'a versão inicial se perdeu no resgate');
    afirmarIgual(r.rows[0].resgates, 1, 'o resgate não deixou rastro na telemetria — migração forçada sem prova é migração invisível');
    return 'execução órfã → nó de resgate, com evento "resgatado" registrado';
  });

  await checar('reverter COPIA para a frente: número de versão nunca é revisitado', async () => {
    const fluxoId = await inserirFluxo({});
    await inserirVersao({ fluxoId, numero: 1, documento: docV1 });
    await inserirVersao({ fluxoId, numero: 2, documento: docV2Estrutural });
    // Reverter = publicar de novo o documento da v1, com número 3. Se o ponteiro voltasse, o número
    // deixaria de mapear um período contínuo e TODA comparação entre versões ficaria envenenada.
    const v3 = await inserirVersao({ fluxoId, numero: 3, documento: docV1 });
    const r = await q(`SELECT "numero","hashDocumento" FROM ${T('RagnabotFluxoVersao')}
                        WHERE "fluxoId"=$1 ORDER BY "numero"`, [fluxoId]);
    afirmarIgual(r.rows.map((x) => x.numero), [1, 2, 3], 'a numeração deixou de ser monotônica');
    afirmarIgual(r.rows[0].hashDocumento, r.rows[2].hashDocumento,
      'a reversão não reproduziu o documento original');
    afirmar(!!v3, 'reversão não gerou versão nova');
    // Documento repetido é LEGÍTIMO: por isso hashDocumento não é único.
    return 'v3 repete o documento da v1 e o banco aceita (reversão é publicação, não retorno de ponteiro)';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 10 — SAÍDAS DE EXCEÇÃO: 151 de 518 apresentações medidas vivem exatamente aqui
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoExcecoes(base) {
  await checar('151 ocorrências de “opção inválida” viram UMA linha acionável', async () => {
    // Uma linha por evento é ruído que se aprende a ignorar — e ignorar foi o que aconteceu nos
    // catorze meses medidos. O agrupamento é imposto pelo banco, não pela disciplina de quem grava.
    const versaoId = base.v1; const noId = 'n_confirma'; const codigo = 'OPCAO_INVALIDA_ESGOTADA';
    for (let i = 0; i < 151; i++) {
      await q(
        `INSERT INTO ${T('RagnabotFluxoIncidente')}
           ("id","tenantId","versaoId","noId","codigo","nivel","mensagem","comoCorrigir","amostras","ultimaEm")
         VALUES ($1,$2,$3,$4,$5,'erro',
                 'O cliente escreveu algo que não casa com nenhum item da lista.',
                 'Leia as amostras: as pessoas estão dizendo o que querem. Acrescente apelidos aos itens ou reescreva os títulos.',
                 $6::jsonb, now())
         ON CONFLICT ("versaoId","noId","codigo") DO UPDATE
            SET "ocorrencias" = ${T('RagnabotFluxoIncidente')}."ocorrencias" + 1, "ultimaEm" = now()`,
        [novoId('inc'), TENANT_A, versaoId, noId, codigo, JSON.stringify(i < 5 ? [{ texto: `amostra ${i}` }] : [])]);
    }
    const r = await q(`SELECT "ocorrencias" FROM ${T('RagnabotFluxoIncidente')}
                        WHERE "versaoId"=$1 AND "noId"=$2 AND "codigo"=$3`, [versaoId, noId, codigo]);
    afirmarIgual(r.rows.length, 1, 'o incidente não agrupou — o banco deixou nascer linha repetida');
    afirmarIgual(r.rows[0].ocorrencias, 151, `contou ${r.rows[0].ocorrencias} em vez de 151`);
    return '151 eventos → 1 linha com ocorrencias=151';
  });

  await checar('“sem resposta” e “opção inválida” contam SEPARADO por nó', async () => {
    const execucaoId = await inserirExecucao({ cwConversationId: 701000, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'esperando' });
    await q(`UPDATE ${T('RagnabotFluxoExecucao')}
                SET "tentativasNo" = jsonb_set(
                      jsonb_set("tentativasNo", '{n_confirma}', '{}'::jsonb, true),
                      '{n_confirma,semResposta}', '2'::jsonb, true),
                    "atualizadaEm" = now()
              WHERE "id"=$1`, [execucaoId]);
    await q(`UPDATE ${T('RagnabotFluxoExecucao')}
                SET "tentativasNo" = jsonb_set("tentativasNo", '{n_confirma,opcaoInvalida}', '3'::jsonb, true),
                    "atualizadaEm" = now()
              WHERE "id"=$1`, [execucaoId]);
    const r = await q(`SELECT "tentativasNo" FROM ${T('RagnabotFluxoExecucao')} WHERE "id"=$1`, [execucaoId]);
    afirmarIgual(r.rows[0].tentativasNo, { n_confirma: { semResposta: 2, opcaoInvalida: 3 } },
      'os dois contadores se misturaram — o teto de repergunta pararia de valer para um deles');
    return 'semResposta=2 e opcaoInvalida=3 no mesmo nó, sem se atropelarem';
  });

  await checar('teto de visitas por nó pega o laço de exceção do fluxo real', async () => {
    // O fluxo medido tem DOIS laços; o segundo (nó 34 → nó 16 “Não entendi”) é acionado por 151 das
    // 518 apresentações. Sem teto, o laço de exceção é um moedor de conversa de cliente.
    const execucaoId = await inserirExecucao({ cwConversationId: 701010, fluxoId: base.fluxoId, versaoId: base.v1, estado: 'esperando' });
    for (let i = 1; i <= 11; i++) {
      await q(`UPDATE ${T('RagnabotFluxoExecucao')}
                  SET "visitasPorNo" = jsonb_set("visitasPorNo", '{n_confirma}', to_jsonb($2::int), true),
                      "atualizadaEm" = now()
                WHERE "id"=$1`, [execucaoId, i]);
    }
    const r = await q(
      `SELECT (e."visitasPorNo"->>'n_confirma')::int AS visitas, f."visitasPorNoMax" AS teto
         FROM ${T('RagnabotFluxoExecucao')} e JOIN ${T('RagnabotFluxo')} f ON f."id"=e."fluxoId"
        WHERE e."id"=$1`, [execucaoId]);
    afirmar(r.rows[0].visitas > r.rows[0].teto,
      `o fixture não estourou o teto (${r.rows[0].visitas} vs ${r.rows[0].teto})`);
    await q(`INSERT INTO ${T('RagnabotFluxoIncidente')}
               ("id","tenantId","versaoId","noId","codigo","nivel","mensagem","ultimaEm")
             VALUES ($1,$2,$3,'n_confirma','LIMITE_EXCEDIDO','erro',
                     'O nó foi apresentado mais vezes que o teto do fluxo. A conversa estava presa no laço de exceção.', now())`,
      [novoId('inc'), TENANT_A, base.v1]);
    const inc = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoIncidente')}
                          WHERE "versaoId"=$1 AND "codigo"='LIMITE_EXCEDIDO'`, [base.v1]);
    afirmarIgual(inc.rows[0].n, 1, 'estourar o teto não abriu incidente');
    return `${r.rows[0].visitas} visitas contra teto ${r.rows[0].teto} → incidente LIMITE_EXCEDIDO`;
  });

  await checar('casamento de opção: a escada determinística não confunde SIM com NÃO', async () => {
    const achado = await doMotor('casarOpcao');
    const fn = typeof achado.valor === 'function' ? achado.valor : casarOpcaoRef;
    const fonte = achado.fonte ?? 'referência deste arquivo (nenhum módulo do motor exporta casarOpcao)';
    const itens = [
      { id: 'op_sim', titulo: 'Sim! Abra o chamado! ✅ ', apelidos: ['sim', 'confirmo', 'ok', 'pode abrir'] },
      { id: 'op_nao', titulo: 'Não! Recomece!', apelidos: ['nao', 'recomeçar'] },
    ];
    const casos = [
      [{ interativo: { id: 'op_sim' } }, 'op_sim', 'interativo'],
      [{ texto: '2' }, 'op_nao', 'indice'],
      [{ texto: 'sim! abra o chamado!' }, 'op_sim', 'titulo'],
      [{ texto: 'pode abrir' }, 'op_sim', 'apelido'],
      [{ texto: 'NAO' }, 'op_nao', 'apelido'],
    ];
    for (const [entrada, idEsperado, viaEsperada] of casos) {
      const r = fn(entrada, itens);
      afirmar(r && r.id === idEsperado, `«${entrada.texto ?? entrada.interativo?.id}» casou ${JSON.stringify(r)} em vez de ${idEsperado}`);
      afirmarIgual(r.via, viaEsperada, `«${entrada.texto ?? ''}» casou pela via errada`);
    }
    // O que NÃO pode casar. Errar aqui abre um chamado que a pessoa não pediu.
    for (const texto of ['talvez', 'quero falar com uma pessoa', '9', '', 'ss']) {
      afirmarIgual(fn({ texto }, itens), null, `«${texto}» casou com algum item — tem de cair em opcao_invalida`);
    }
    return `5 vias corretas, 5 recusas corretas · implementação: ${fonte}`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 11 — LIMITES DA API OFICIAL DA META
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const LIMITES_META = Object.freeze({
  botoes_max: 3, lista_itens_max: 10, lista_titulo_max: 24, janela_servico_horas: 24,
});

async function grupoLimitesMeta() {
  await checar('os limites vivem em TABELA DATADA, com unidade e origem declaradas', async () => {
    // Constante escondida no código é como três serviços passam a ter três verdades. E `unidade`
    // existe porque NINGUÉM MEDIU em que unidade a Meta conta caracteres.
    for (const [chave, valor] of Object.entries(LIMITES_META)) {
      await q(
        `INSERT INTO ${T('RagnabotFluxoLimiteCanal')} ("id","perfil","chave","valor","unidade","origem","fonte","conferidoEm")
         VALUES ($1,$2,$3,$4,$5,'documentacao','developers.facebook.com/docs/whatsapp', now())`,
        [novoId('lim'), PERFIL_TESTE, chave, valor, chave === 'lista_titulo_max' ? 'indefinida' : 'contagem']);
    }
    const e = await esperarErroPg('23505', () => q(
      `INSERT INTO ${T('RagnabotFluxoLimiteCanal')} ("id","perfil","chave","valor","conferidoEm")
       VALUES ($1,$2,'botoes_max',4, now())`, [novoId('lim'), PERFIL_TESTE]),
      'dois valores para o mesmo limite no mesmo perfil = duas verdades');
    const r = await q(`SELECT "chave","valor","origem" FROM ${T('RagnabotFluxoLimiteCanal')}
                        WHERE "perfil"=$1 ORDER BY "chave"`, [PERFIL_TESTE]);
    afirmarIgual(r.rows.length, 4, 'algum limite não foi gravado');
    afirmar(r.rows.every((x) => x.origem === 'documentacao'),
      'origem tem de dizer se é regra MEDIDA ou palpite de documentação — aviso que se declara palpite não corrói a confiança nos avisos que são regra');
    return `4 limites gravados; duplicata recusada com ${e.code}`;
  });

  await checar('perfil REAL de limites está semeado no banco', async () => {
    const r = await q(`SELECT "chave" FROM ${T('RagnabotFluxoLimiteCanal')} WHERE "perfil"='whatsapp_cloud@2026-08'`);
    const chaves = r.rows.map((x) => x.chave);
    const faltando = Object.keys(LIMITES_META).filter((k) => !chaves.includes(k));
    afirmar(faltando.length === 0,
      `o perfil whatsapp_cloud@2026-08 está sem ${faltando.join(', ')} (a tabela tem ${chaves.length} linhas desse perfil). `
      + 'Enquanto ele não existir, a tabela DATADA não manda em nada: o motor cai na cópia embutida em PERFIL_LIMITES_PADRAO, '
      + 'e o dia em que a Meta mudar um teto ninguém vai conseguir corrigir sem soltar versão de código. '
      + 'Conserto (falta uma migração de semeadura): INSERT em "RagnabotFluxoLimiteCanal" com perfil=\'whatsapp_cloud@2026-08\', '
      + 'as chaves botoes_max=3, lista_itens_max=10, lista_titulo_max=24, janela_servico_horas=24, origem=\'documentacao\' e conferidoEm=hoje.');
    return `${chaves.length} limites no perfil real`;
  });

  await checar('MEDIÇÃO: o mesmo título dá três vereditos diferentes contra o teto de 24', async () => {
    const comCheck = 'Sim! Abra o chamado! ✅ ';
    const comBandeira = 'Sim! Abra o chamado! 🇧🇷 ';
    const a = medirTexto(comCheck); const b = medirTexto(comBandeira);
    // Números MEDIDOS nesta máquina, não copiados da especificação.
    afirmarIgual([a.grafemas, a.pontos, a.utf16], [23, 23, 23], 'a medição do título com ✅ mudou');
    afirmarIgual([b.grafemas, b.pontos, b.utf16], [23, 24, 26], 'a medição do título com bandeira mudou');
    afirmar(b.pontos > LIMITES_META.lista_titulo_max - 1 && b.utf16 > LIMITES_META.lista_titulo_max,
      'a bandeira deveria estourar o teto em pelo menos uma unidade');
    afirmarIgual(b.piorCaso, 26, 'o pior caso da bandeira deveria ser 26');
    // Enquanto a origem for 'documentacao', o validador aplica o PIOR CASO.
    afirmar(b.piorCaso > LIMITES_META.lista_titulo_max,
      'pelo pior caso a bandeira tem de ser barrada — e a tela precisa dizer que é pior caso');
    return `✅ = 23/23/23 · 🇧🇷 = 23/24/26 (grafema/ponto/utf16) contra teto ${LIMITES_META.lista_titulo_max}`;
  });

  await checar('validador do editor AVISA ao montar o nó: 4 botões, 11 itens e título de 25', async () => {
    // O editor precisa AVISAR ao montar, não falhar depois: fora da janela a mensagem recusada não
    // tem plano B, e a Meta recusa a mensagem INTEIRA — nunca "os 3 primeiros botões passam". Aviso
    // que promete degradação parcial é PIOR que aviso nenhum.
    const { valor: validarNo, fonte } = await doMotor('validarNo');
    if (typeof validarNo !== 'function') {
      pular('nenhum módulo do motor exporta validarNo() — o AVISO AO MONTAR O NÓ não pôde ser verificado');
    }
    const { valor: perfil } = await doMotor('PERFIL_LIMITES_PADRAO');
    const ctx = perfil ? { limites: perfil } : {};

    // ⚠️ O nó tem de estar COMPLETO fora do ponto em exame. Um fixture faltando `esperaResposta` ou
    // `excecoes` também é barrado — por outro motivo, igualmente correto — e o teste passaria pelo
    // motivo errado, dando a impressão de que o teto está protegido quando não está.
    const completo = (extra) => ({
      corpo: 'Confirma a abertura do chamado?',
      esperaResposta: { valor: 4, unidade: 'minutos' },
      excecoes: {
        semResposta: { tentativas: 2, reforco: 'Ainda está aí?', acaoFinal: 'transferir_time', time: 'Suporte' },
        opcaoInvalida: { tentativas: 2, reforco: 'Escolha uma das opções da lista.', acaoFinal: 'transferir_time', time: 'Suporte' },
      },
      ...extra,
    });

    const casos = [
      ['4 botões', { id: 'n1', tipo: 'botoes', config: completo({ botoes: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, rotulo: `Opção ${i}` })) }) }],
      ['11 itens de lista', { id: 'n2', tipo: 'lista', config: completo({ rotuloBotao: 'Ver', itens: Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, titulo: `Item ${i}` })) }) }],
      ['título de lista com 25', { id: 'n3', tipo: 'lista', config: completo({ rotuloBotao: 'Ver', itens: [{ id: 'i1', titulo: 'x'.repeat(25) }, { id: 'i2', titulo: 'Curto' }] }) }],
    ];
    const barrados = [];
    for (const [nome, no] of casos) {
      const problemas = validarNo(no, ctx) ?? [];
      const doLimite = problemas.find((pb) => pb?.nivel === 'erro' && pb?.codigo === 'LIMITE_EXCEDIDO');
      afirmar(!!doLimite,
        `${nome} não foi barrado POR LIMITE (problemas: ${JSON.stringify(problemas.map((pb) => [pb.nivel, pb.codigo]))}). O operador só descobriria na recusa da Meta, com a mensagem inteira perdida.`);
      barrados.push(`${nome} → ${doLimite.campo}`);
    }
    // E o caso LEGÍTIMO tem de passar: validador que barra tudo é validador que ninguém respeita —
    // e operador que aprende a ignorar aviso ignora também o que importa.
    const bom = validarNo({ id: 'n4', tipo: 'botoes', config: completo({ botoes: [{ id: 'b1', rotulo: 'Sim' }, { id: 'b2', rotulo: 'Não' }] }) }, ctx) ?? [];
    afirmar(!bom.some((pb) => pb?.nivel === 'erro'), `2 botões legítimos foram barrados: ${JSON.stringify(bom)}`);
    return `${barrados.join(' · ')} · implementação: ${fonte}`;
  });

  await checar('as saídas de exceção são GERADAS pelo motor, não desenhadas pelo autor', async () => {
    // Deixá-las como conector opcional garante que metade dos fluxos esquece — e a medição diz que
    // 151 das 518 apresentações do nó de confirmação vivem exatamente ali.
    const { valor: saidasDe, fonte } = await doMotor('saidasDe');
    if (typeof saidasDe !== 'function') pular('nenhum módulo do motor exporta saidasDe()');
    const noQueEstaciona = { id: 'n2', tipo: 'lista', config: { corpo: 'Escolha:', rotuloBotao: 'Ver', esperaResposta: { valor: 4, unidade: 'minutos' }, itens: [{ id: 'op_sim', titulo: 'Sim' }, { id: 'op_nao', titulo: 'Não' }] } };
    const saidas = saidasDe(noQueEstaciona);
    for (const exigida of ['sem_resposta', 'opcao_invalida', 'erro']) {
      afirmar(saidas.includes(exigida), `o nó que estaciona não declarou a saída ${exigida} — ela tem de vir do motor mesmo sem o autor desenhar`);
    }
    const noQueNaoEstaciona = { id: 'n1', tipo: 'texto', config: { texto: 'Olá' } };
    const semExcecao = saidasDe(noQueNaoEstaciona);
    afirmar(!semExcecao.includes('sem_resposta'),
      'nó que não estaciona ganhou saída `sem_resposta` — conector que não pode disparar polui o desenho e faz o operador desconfiar dos que importam');
    return `${saidas.join(', ')} · implementação: ${fonte}`;
  });

  await checar('janela de serviço é por (número da EMPRESA, destinatário), não por conta', async () => {
    // A Ragnatela tem DUAS conexões de WhatsApp medidas na MESMA empresa. Uma janela aberta por um
    // número não vale pelo outro, e com duas caixas na mesma conta isso não é derivável depois.
    const destinatario = '5598983351000';
    for (const numeroDaEmpresa of [`zzf-${CARIMBO}-num-42`, `zzf-${CARIMBO}-num-45`]) {
      await q(
        `INSERT INTO ${T('RagnabotFluxoJanela')}
           ("id","phoneNumberId","destinatarioWaId","cwAccountId","ultimaEntradaEm","expiraEm","atualizadaEm")
         VALUES ($1,$2,$3,$4, now(), now() + interval '24 hours', now())`,
        [novoId('janela'), numeroDaEmpresa, destinatario, CONTA_TESTE]);
    }
    const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoJanela')}
                        WHERE "destinatarioWaId"=$1 AND "cwAccountId"=$2`, [destinatario, CONTA_TESTE]);
    afirmarIgual(r.rows[0].n, 2,
      'as duas caixas colapsaram numa janela só — o motor mandaria mensagem livre pelo número errado e a Meta recusaria');
    const e = await esperarErroPg('23505', () => q(
      `INSERT INTO ${T('RagnabotFluxoJanela')}
         ("id","phoneNumberId","destinatarioWaId","cwAccountId","ultimaEntradaEm","expiraEm","atualizadaEm")
       VALUES ($1,$2,$3,$4, now(), now() + interval '24 hours', now())`,
      [novoId('janela'), `zzf-${CARIMBO}-num-42`, destinatario, CONTA_TESTE]),
      'duas linhas para o MESMO par (número, destinatário) = duas contabilidades da mesma janela');
    return `2 janelas independentes para o mesmo destinatário; duplicata do par recusada com ${e.code}`;
  });

  await checar('a Meta recusando por fora-de-janela CORRIGE a nossa contabilidade', async () => {
    // Sem isto, `sem_janela` só dispararia pela nossa contabilidade otimista e nunca no caso em que
    // a fonte autoritativa afirmou o fechamento — o template configurado exatamente para esse caso
    // não seria usado exatamente no caso em que ele existe.
    const numero = `zzf-${CARIMBO}-num-99`;
    await q(`INSERT INTO ${T('RagnabotFluxoJanela')}
               ("id","phoneNumberId","destinatarioWaId","cwAccountId","ultimaEntradaEm","expiraEm","atualizadaEm")
             VALUES ($1,$2,'5598999998888',$3, now(), now() + interval '20 hours', now())`,
      [novoId('janela'), numero, CONTA_TESTE]);
    await q(`UPDATE ${T('RagnabotFluxoJanela')} SET "fechadaPeloDestinoEm"= now(), "atualizadaEm"= now()
              WHERE "phoneNumberId"=$1 AND "destinatarioWaId"='5598999998888'`, [numero]);
    const r = await q(`SELECT "expiraEm" > now() AS nossa_conta_diz_aberta, "fechadaPeloDestinoEm" IS NOT NULL AS meta_disse_fechada
                         FROM ${T('RagnabotFluxoJanela')} WHERE "phoneNumberId"=$1`, [numero]);
    afirmar(r.rows[0].nossa_conta_diz_aberta === true && r.rows[0].meta_disse_fechada === true,
      'o fixture não reproduziu a divergência entre a nossa contabilidade e a fonte autoritativa');
    return 'nossa conta dizia aberta; a recusa da Meta ficou gravada e passa a mandar';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 12 — O D10: tráfego de cliente NUNCA escreve na definição do fluxo
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function grupoD10(base) {
  await checar('50 turnos de conversa não movem RagnabotFluxo.atualizadoEm', async () => {
    // No sistema medido a telemetria morava DENTRO do documento do fluxo: cada interação de cliente
    // reescrevia a linha inteira e `updatedAt` deixou de significar "alguém editou" para significar
    // "alguém conversou". Catorze meses assim, sem ninguém perceber.
    const antes = await q(`SELECT "atualizadoEm" FROM ${T('RagnabotFluxo')} WHERE "id"=$1`, [base.fluxoId]);
    const versaoAntes = await q(`SELECT "documento" FROM ${T('RagnabotFluxoVersao')} WHERE "id"=$1`, [base.v1]);
    const execucaoId = await inserirExecucao({ cwConversationId: 701100, fluxoId: base.fluxoId, versaoId: base.v1 });

    for (let turno = 1; turno <= 50; turno++) {
      await q(`UPDATE ${T('RagnabotFluxoExecucao')}
                  SET "passosTotal"="passosTotal"+1, "visitaSeq"="visitaSeq"+1, "atualizadaEm"= now()
                WHERE "id"=$1`, [execucaoId]);
      await q(`INSERT INTO ${T('RagnabotFluxoEvento')} ("tenantId","versaoId","execucaoId","noId","tipo","saida")
               VALUES ($1,$2,$3,'n_confirma', $4, 'padrao')`,
        [TENANT_A, base.v1, execucaoId, turno % 2 ? 'no_entrou' : 'resposta_recebida']);
    }

    const depois = await q(`SELECT "atualizadoEm" FROM ${T('RagnabotFluxo')} WHERE "id"=$1`, [base.fluxoId]);
    afirmarIgual(depois.rows[0].atualizadoEm.toISOString(), antes.rows[0].atualizadoEm.toISOString(),
      'a conversa mexeu no carimbo de EDIÇÃO do fluxo — o D10 renasceu');
    const versaoDepois = await q(`SELECT "documento" FROM ${T('RagnabotFluxoVersao')} WHERE "id"=$1`, [base.v1]);
    afirmarIgual(versaoDepois.rows[0].documento, versaoAntes.rows[0].documento, 'a conversa alterou o documento da versão');
    const eventos = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoEvento')} WHERE "execucaoId"=$1`, [execucaoId]);
    afirmarIgual(eventos.rows[0].n, 50, 'a telemetria dos 50 turnos não foi toda gravada');
    return '50 turnos · 50 eventos gravados · carimbo de edição e documento intocados';
  });

  await checar('telemetria não guarda texto do cliente, salvo na exceção declarada', async () => {
    const execucaoId = await inserirExecucao({ cwConversationId: 701110, fluxoId: base.fluxoId, versaoId: base.v1 });
    // UMA exceção: em `opcao_invalida` o texto É o achado — as pessoas estão dizendo o que querem.
    await q(`INSERT INTO ${T('RagnabotFluxoEvento')} ("tenantId","versaoId","execucaoId","noId","tipo","detalhe")
             VALUES ($1,$2,$3,'n_confirma','opcao_invalida',$4::jsonb)`,
      [TENANT_A, base.v1, execucaoId, JSON.stringify({ textoParcial: 'quero falar com uma pessoa'.slice(0, 120) })]);
    await q(`INSERT INTO ${T('RagnabotFluxoEvento')} ("tenantId","versaoId","execucaoId","noId","tipo","detalhe","viaCasamento")
             VALUES ($1,$2,$3,'n_confirma','resposta_recebida', NULL, 'indice')`,
      [TENANT_A, base.v1, execucaoId]);
    const r = await q(`SELECT "tipo","detalhe" FROM ${T('RagnabotFluxoEvento')}
                        WHERE "execucaoId"=$1 ORDER BY "tipo"`, [execucaoId]);
    const invalida = r.rows.find((x) => x.tipo === 'opcao_invalida');
    const recebida = r.rows.find((x) => x.tipo === 'resposta_recebida');
    afirmar(invalida.detalhe?.textoParcial?.length <= 120, 'a amostra de opção inválida passou de 120 caracteres');
    afirmarIgual(recebida.detalhe, null, 'evento comum carregou texto do cliente — isso é dado pessoal em telemetria');
    return 'amostra só em opcao_invalida (≤120 caracteres); demais eventos sem texto';
  });

  await checar('saúde do canal registra janela de degradação para descontar do prazo', async () => {
    // Um prazo de 4 minutos e um atraso mediano de 6 minutos são matematicamente incompatíveis:
    // nessa condição `sem_resposta` não pode significar "o cliente não respondeu".
    const inicio = new Date(Date.now() - 600_000); const fim = new Date(Date.now() - 120_000);
    await q(
      `INSERT INTO ${T('RagnabotFluxoCanalSaude')}
         ("cwAccountId","ultimaEntradaEm","ultimoEnvioOkEm","atrasoP95Ms","degradadoDesde","janelas","atualizadoEm")
       VALUES ($1, now(), now(), 360000, $2, $3::jsonb, now())
       ON CONFLICT ("cwAccountId") DO UPDATE SET "janelas"=EXCLUDED."janelas", "atualizadoEm"= now()`,
      [CONTA_TESTE, inicio, JSON.stringify([[inicio.toISOString(), fim.toISOString()]])]);
    const r = await q(`SELECT "atrasoP95Ms", jsonb_array_length("janelas") AS janelas FROM ${T('RagnabotFluxoCanalSaude')} WHERE "cwAccountId"=$1`, [CONTA_TESTE]);
    afirmarIgual(r.rows[0].janelas, 1, 'a janela de degradação não foi gravada');
    afirmar(r.rows[0].atrasoP95Ms > 240_000,
      'o fixture deveria ter atraso maior que um prazo típico de 4 minutos — é essa comparação que impede o motor de afirmar “o cliente não respondeu”');
    return `atraso p95 ${Math.round(r.rows[0].atrasoP95Ms / 1000)} s contra prazo típico de 240 s → sem_resposta não pode ser tomada`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §GRUPO 13 — O NÓ "ABRIR CHAMADO" CONSOME O SERVIÇO DE PROTOCOLO QUE JÁ EXISTE
//
// Este grupo roda SEMPRE contra o schema `public`, mesmo no modo ensaio: o serviço é real, está em
// produção e a ordem é explícita — o nó de abrir chamado DEVE usá-lo, não reinventar numeração.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const protocoloCriado = { tenantId: null, prefixo: null, conversas: [] };

async function grupoProtocolo() {
  const svc = await moduloOpcional('../src/services/ragnabot-protocolo.service.js');
  const prismaMod = await moduloOpcional('../src/base/db.js');
  if (!svc?.emitirProtocolo || !prismaMod?.default) {
    await checar('serviço de protocolo disponível', async () => pular('ragnabot-protocolo.service.js ou o cliente Prisma não puderam ser importados'));
    return null;
  }
  const prisma = prismaMod.default;

  // Prefixo descartável de 3 letras, começando em Z para não disputar com empresa real.
  let prefixo = null;
  for (let tentativa = 0; tentativa < 12 && !prefixo; tentativa++) {
    const candidato = 'Z' + String.fromCharCode(65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26));
    const colide = await prisma.ragnabotContadorProtocolo.findUnique({ where: { prefixo: candidato } });
    if (!colide) prefixo = candidato;
  }
  if (!prefixo) {
    await checar('prefixo de teste disponível', async () => pular('não achei prefixo Z?? livre — rode de novo'));
    return prisma;
  }
  protocoloCriado.tenantId = TENANT_A; protocoloCriado.prefixo = prefixo;
  await svc.definirPrefixo(TENANT_A, prefixo);

  await checar('formato do protocolo: prefixo + 10 dígitos', async () => {
    const conversa = 701200; protocoloCriado.conversas.push(conversa);
    const r = await svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId: conversa });
    afirmar(new RegExp(`^${prefixo}-\\d{10}$`).test(r.protocolo), `protocolo fora do formato: ${r.protocolo}`);
    afirmar(r.novo === true, 'o primeiro protocolo da conversa deveria ser novo');
    return r.protocolo;
  });

  await checar('reprocessar a mesma conversa NÃO gera protocolo novo', async () => {
    const conversa = 701201; protocoloCriado.conversas.push(conversa);
    const a = await svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId: conversa });
    const b = await svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId: conversa });
    const c = await svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId: conversa });
    afirmarIgual([b.protocolo, c.protocolo], [a.protocolo, a.protocolo], 'a reentrega do webhook gerou protocolo diferente');
    afirmar(b.novo === false && c.novo === false, 'a segunda emissão se declarou nova');
    return `${a.protocolo} estável em 3 emissões`;
  });

  await checar('12 emissões SIMULTÂNEAS: nenhum número repetido', async () => {
    // Dois atendimentos nascendo no mesmo instante NÃO podem receber o mesmo número.
    const conversas = Array.from({ length: 12 }, (_, i) => 701300 + i);
    protocoloCriado.conversas.push(...conversas);
    const resultados = await Promise.all(conversas.map((cwConversationId) =>
      svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId })));
    const numeros = resultados.map((r) => r.numero);
    afirmarIgual(new Set(numeros).size, 12, `saíram números repetidos: ${numeros.join(', ')}`);
    afirmarIgual(new Set(resultados.map((r) => r.protocolo)).size, 12, 'saíram protocolos repetidos');
    return `12 números distintos (${Math.min(...numeros)}…${Math.max(...numeros)})`;
  });

  await checar('12 emissões SIMULTÂNEAS da MESMA conversa devolvem UM protocolo só', async () => {
    // É este o caso que o motor vive: rajada de webhooks da mesma conversa chegando junto.
    const conversa = 701400; protocoloCriado.conversas.push(conversa);
    const resultados = await Promise.all(Array.from({ length: 12 }, () =>
      svc.emitirProtocolo({ tenantId: TENANT_A, cwAccountId: CONTA_TESTE, cwConversationId: conversa })
        .then((r) => r, (e) => ({ erro: e.message }))));
    const erros = resultados.filter((r) => r.erro);
    afirmarIgual(erros.length, 0, `emissões concorrentes falharam: ${erros.map((e) => e.erro).slice(0, 2).join(' · ')}`);
    afirmarIgual(new Set(resultados.map((r) => r.protocolo)).size, 1,
      'a mesma conversa recebeu mais de um protocolo — o cliente veria dois números para o mesmo chamado');
    const novos = resultados.filter((r) => r.novo).length;
    afirmarIgual(novos, 1, `${novos} emissões se declararam novas — só uma podia`);
    return `${resultados[0].protocolo} único em 12 chamadas simultâneas`;
  });

  await checar('a busca por protocolo respeita o escopo da empresa', async () => {
    const alvo = await prisma.ragnabotProtocolo.findFirst({ where: { tenantId: TENANT_A }, orderBy: { criadoEm: 'desc' } });
    afirmar(!!alvo, 'nenhum protocolo de teste para consultar');
    const proprio = await svc.buscarPorProtocolo(alvo.protocolo, { tenantIdEscopo: TENANT_A });
    afirmar(!!proprio, 'a empresa dona não achou o próprio protocolo');
    const alheio = await svc.buscarPorProtocolo(alvo.protocolo, { tenantIdEscopo: TENANT_B });
    afirmarIgual(alheio, null, 'uma empresa achou o protocolo de outra — é exatamente o vazamento que derrubou o sistema antigo');
    return `${alvo.protocolo} visível só para a empresa dona`;
  });

  return prisma;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §LIMPEZA — nada do que esta bateria criou pode sobreviver a ela
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function limpar(prisma) {
  if (MANTER) {
    console.log(`\n⚠️  RAGNABOT_FLUXO_MANTER=1 — nada foi apagado. Carimbo: ${CARIMBO} · schema: ${SCHEMA} · empresas ${TENANT_A}/${TENANT_B}`);
    return;
  }
  const problemas = [];

  // O protocolo vive no schema real, sempre.
  if (prisma && protocoloCriado.tenantId) {
    try {
      await prisma.ragnabotProtocolo.deleteMany({ where: { tenantId: protocoloCriado.tenantId } });
      await prisma.ragnabotContadorProtocolo.deleteMany({ where: { tenantId: protocoloCriado.tenantId } });
    } catch (e) { problemas.push(`protocolo: ${e.message}`); }
  }

  if (MODO === 'ensaio') {
    // Um schema descartável some inteiro — inclusive o REVOKE e o gatilho.
    try { await q(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); }
    catch (e) { problemas.push(`DROP SCHEMA ${SCHEMA}: ${e.message}`); }
  } else {
    // Ordem obrigatória: a FK de execução para versão é RESTRICT de propósito.
    const passos = [
      [`DELETE FROM ${T('RagnabotFluxoEntradaConsumida')} WHERE "execucaoId" LIKE $1`, [`zzf-${CARIMBO}-%`]],
      [`DELETE FROM ${T('RagnabotFluxoEfeito')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoEvento')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoIncidente')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoFila')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoEntrada')} WHERE "chave" LIKE $1 OR "tenantId" = ANY($2)`, [`zzf-${CARIMBO}-%`, [TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoExecucao')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoAresta')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoNo')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoVersao')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxo')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoJanela')} WHERE "cwAccountId" = $1`, [CONTA_TESTE]],
      [`DELETE FROM ${T('RagnabotFluxoCanalSaude')} WHERE "cwAccountId" = $1`, [CONTA_TESTE]],
      [`DELETE FROM ${T('RagnabotFluxoLimiteCanal')} WHERE "perfil" = $1`, [PERFIL_TESTE]],
      [`DELETE FROM ${T('RagnabotFluxoSegredo')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
      [`DELETE FROM ${T('RagnabotFluxoDestinoPermitido')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]],
    ];
    for (const [sql, params] of passos) {
      try { await q(sql, params); } catch (e) { problemas.push(`${sql.slice(12, 60)}: ${e.message}`); }
    }
    // Prova de que a limpeza limpou. Sujeira de teste em banco de produção vira "dado estranho" que
    // alguém investiga meses depois como se fosse defeito.
    try {
      const r = await q(`SELECT count(*)::int AS n FROM ${T('RagnabotFluxoExecucao')} WHERE "tenantId" = ANY($1)`, [[TENANT_A, TENANT_B]]);
      if (r.rows[0].n !== 0) problemas.push(`sobraram ${r.rows[0].n} execuções de teste`);
    } catch { /* tabela pode não existir; já reportado antes */ }
  }

  if (problemas.length) {
    console.log(`\n⚠️  A LIMPEZA NÃO FOI COMPLETA (carimbo ${CARIMBO}):`);
    for (const p of problemas) console.log(`   · ${p}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §ROTEIRO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const TABELAS_DO_MOTOR = [
  'RagnabotFluxo', 'RagnabotFluxoVersao', 'RagnabotFluxoNo', 'RagnabotFluxoAresta',
  'RagnabotFluxoExecucao', 'RagnabotFluxoEntrada', 'RagnabotFluxoEntradaConsumida',
  'RagnabotFluxoFila', 'RagnabotFluxoEfeito', 'RagnabotFluxoEvento', 'RagnabotFluxoIncidente',
  'RagnabotFluxoCanalSaude', 'RagnabotFluxoJanela', 'RagnabotFluxoLimiteCanal',
  'RagnabotFluxoSegredo', 'RagnabotFluxoDestinoPermitido',
];

async function escolherModo() {
  const r = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1)`, [TABELAS_DO_MOTOR]);
  const presentes = r.rows.map((x) => x.table_name);
  const faltando = TABELAS_DO_MOTOR.filter((t) => !presentes.includes(t));

  if (faltando.length === 0 && process.env.RAGNABOT_FLUXO_ENSAIO !== '1') {
    MODO = 'real'; SCHEMA = 'public';
    console.log('MODO REAL — as 16 tabelas do motor existem em `public`. A bateria é teste de conformidade da migração.\n');
    return;
  }

  MODO = 'ensaio';
  SCHEMA = `rb_ensaio_${CARIMBO}`;
  if (faltando.length) {
    console.log('MODO ENSAIO — a migração do motor AINDA NÃO ESTÁ NO BANCO.');
    console.log(`Faltam ${faltando.length} de ${TABELAS_DO_MOTOR.length} tabelas em \`public\`: ${faltando.join(', ')}`);
  } else {
    console.log('MODO ENSAIO forçado por RAGNABOT_FLUXO_ENSAIO=1.');
  }
  console.log(`Criando o schema descartável "${SCHEMA}" com o DDL derivado do contrato; ele é derrubado no fim.`);
  console.log('⚠️ No modo ensaio as afirmações ESTRUTURAIS provam o CONTRATO (o DDL é deste arquivo).');
  console.log('   As de COMPORTAMENTO provam o POSTGRES e valem igual no modo real.\n');

  const papel = (await q('SELECT current_user AS u')).rows[0].u;
  await q(`CREATE SCHEMA "${SCHEMA}"`);
  await q(ddlEnsaio(SCHEMA));
  await q(ddlMigracoesManuais(SCHEMA, papel));
}

async function principal() {
  if (process.env.RAGNABOT_FLUXO_E2E !== '1') {
    console.error(
      'Esta bateria escreve no BANCO REAL do NOC (linhas de teste, apagadas no fim) e abre conexões\n' +
      'em paralelo. Ela não roda por acidente. Para executar:\n\n' +
      '  RAGNABOT_FLUXO_E2E=1 node tests/ragnabot-fluxo.test.mjs\n');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não definida — sem banco não há o que provar. (O .env do NOC a define.)');
    process.exit(2);
  }

  pool = new Pool({ connectionString: url, max: 14, application_name: 'ragnabot-fluxo-teste' });
  let prisma = null;
  try {
    console.log(`\n═══ BATERIA DO MOTOR DE FLUXO DO RAGNABOT — carimbo ${CARIMBO} ═══\n`);
    await escolherModo();

    // Semeadura comum: uma empresa A com fluxo e duas versões, e uma versão da empresa B para as
    // provas de cerca entre empresas.
    const fluxoId = await inserirFluxo({ nome: `ZZ-ABERTURA-DE-CHAMADO-${CARIMBO}` });
    const v1 = await inserirVersao({ fluxoId, numero: 1 });
    await q(`UPDATE ${T('RagnabotFluxo')} SET "versaoPublicadaId"=$2, "atualizadoEm"= now() WHERE "id"=$1`, [fluxoId, v1]);
    const fluxoB = await inserirFluxo({ tenantId: TENANT_B, nome: `ZZ-OUTRA-EMPRESA-${CARIMBO}` });
    const versaoDeB = await inserirVersao({ fluxoId: fluxoB, tenantId: TENANT_B, numero: 1 });
    // O carimbo de edição do fluxo é lido depois da última edição legítima — é ele que o grupo do
    // D10 afirma não ter se movido.
    const base = { fluxoId, v1, fluxoB, versaoDeB };

    await grupoEstrutura();
    await grupoUmaExecucaoViva(base);
    await grupoImutabilidade(base);
    await grupoCercaEntreEmpresas(base);
    await grupoFanOut(base);
    await grupoIdempotencia(base);
    await grupoConcorrencia(base);
    await grupoRetomada(base);
    await grupoPublicacao(base);
    await grupoExcecoes(base);
    await grupoLimitesMeta();
    await grupoD10(base);
    prisma = await grupoProtocolo();
  } catch (e) {
    houveFalha = true;
    console.log(`\n💥 A bateria parou: ${e.message}`);
    console.log(e.stack?.split('\n').slice(1, 4).join('\n') ?? '');
  } finally {
    await limpar(prisma).catch((e) => console.log(`⚠️  falha na limpeza: ${e.message}`));
    if (prisma) await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }

  const ok = registro.filter((r) => r.veredito === 'ok').length;
  const falhas = registro.filter((r) => r.veredito === 'falha');
  const pulados = registro.filter((r) => r.veredito === 'pulado');
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`Modo: ${MODO.toUpperCase()} · schema: ${SCHEMA}`);
  console.log(`Verificações: ${registro.length} · verdes: ${ok} · reprovadas: ${falhas.length} · não executadas: ${pulados.length}`);

  if (pulados.length) {
    console.log('\n⚠️  NÃO EXECUTADAS (dependem de código que ainda não existe — não são aprovações):');
    for (const p of pulados) console.log(`   · ${p.nome} — ${p.detalhe}`);
    console.log('   Rode de novo com RAGNABOT_FLUXO_EXIGIR_MODULOS=1 quando o motor estiver no lugar:');
    console.log('   assim estas linhas viram FALHA em vez de aviso.');
  }
  if (falhas.length) {
    console.log('\n❌ REPROVADAS:');
    for (const f of falhas) console.log(`   · ${f.nome} — ${f.detalhe}`);
    process.exit(1);
  }
  console.log('\n✅ Nenhuma verificação reprovou.');
  process.exit(0);
}

const chamadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (chamadoDireto) {
  principal().catch(async (e) => {
    console.error(`\n💥 Erro inesperado: ${e.message}\n${e.stack ?? ''}`);
    try { await limpar(null); } catch { /* nada a fazer */ }
    try { await pool?.end(); } catch { /* nada a fazer */ }
    process.exit(3);
  });
}
