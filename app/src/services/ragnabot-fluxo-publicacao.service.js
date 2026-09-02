// ════════════════════════════════════════════════════════════════════════════════════════════════
// SERVIÇO DE PUBLICAÇÃO DE FLUXO DO RAGNABOT — Etapa A2 do plano (doc 32)
//
// O QUE ESTE ARQUIVO FAZ, em uma frase: pega o RASCUNHO em edição, valida a estrutura do grafo, e —
// quando vale a pena — CONGELA aquele documento numa VERSÃO imutável, materializa a projeção do
// grafo (nós e arestas) e reaponta o fluxo para a nova versão, tudo numa transação única.
//
// É o componente que o router `ragnabot-fluxo.routes.js` procura em `CAMINHOS_PUBLICACAO` e que hoje
// falta — por isso publicar/validar/reverter/onde-usado respondem 503. Os NOMES e as ASSINATURAS
// exportados aqui espelham EXATAMENTE o que aquele router chama (conferido linha a linha):
//
//   publicar(fluxoId, { userId, modoMigracao, notaPublicacao, confirmou2FA })
//   salvarRascunho(fluxoId, documento, { rev, userId })
//   validarDocumento(documento, { tenantId, perfilLimite })
//   classificarMudanca(docVigente, docNovo)        → 'compativel' | 'estrutural'
//   reverterPara(fluxoId, numero, { userId })
//   ondeUsado(tenantId, apelido)
//
// ── A LEI 5 — O CORAÇÃO DESTE ARQUIVO ───────────────────────────────────────────────────────────
// `hashEstrutura` IGNORA as coordenadas do editor (`no.ui`). Só a TOPOLOGIA conta: para cada nó,
// (id, tipo, saídas ordenadas); para cada aresta, (de, saída, para). É a definição do §2.1 da
// especificação 28 ("Ignora texto, tempo, limiar e coordenada de tela").
//
// Por que isso importa a ponto de virar lei: se arrastar um bloco na tela mudasse a assinatura de
// estrutura, cada reorganização visual publicaria uma versão nova e — pior — poderia deixar ÓRFÃ
// quem está no meio da conversa. `hashEstrutura` é o juiz AUDITÁVEL de "esta publicação pode
// alcançar quem já está dentro?" (igual ⇒ retrofit é seguro), e por isso não pode depender de pixel.
//
// ── DECISÃO DECLARADA — quando publicar NÃO cria versão ─────────────────────────────────────────
// A especificação §2.1 diz que "documento idêntico à versão vigente é no-op (clique duplo)"; a
// diretiva desta tarefa (LEI 5) reforça que arrastar bloco (só `ui`) não pode gerar versão nova. Eu
// juntei as duas na regra de no-op mais estreita que atende ambas SEM quebrar o resto da spec:
//
//   publicar() NÃO cria versão nova quando o documento do rascunho é idêntico ao da versão vigente
//   A MENOS das coordenadas `ui` — ou seja, quando `hashDocumento` difere mas o documento com o
//   `ui` removido é byte a byte igual (`hashConteudo`).
//
// Escolhi ESSA fronteira (ignorar só `ui`) em vez da mais larga "ignorar tudo o que `hashEstrutura`
// ignora" (texto, tempo, limiar) DE PROPÓSITO: o §3.4 da spec apoia toda a medição de eficácia em
// comparar versão N contra N−1 ("reduzi a pausa de 22 s e o abandono caiu"). Se uma troca de texto
// ou de limiar NÃO gerasse versão, essa comparação — que é o motivo de as versões existirem — ficaria
// cega justamente à mudança que o dono quer medir. Então: mexeu só na posição na tela ⇒ nada de
// versão; mexeu no texto/tempo/limiar ⇒ versão nova, classificada 'compativel' (retrofit seguro);
// mexeu em nó/aresta ⇒ versão nova, 'estrutural'. `classificarMudanca` continua reportando
// 'compativel' sempre que `hashEstrutura` é igual — é ele, e não a regra de no-op, que decide se o
// retrofit alcança as conversas vivas. ⚠️ Fronteira aberta à revisão do chefe (ver relatório).
//
// ── IMUTABILIDADE ───────────────────────────────────────────────────────────────────────────────
// `RagnabotFluxoVersao` é só-inserção (gatilho + REVOKE UPDATE no banco). Este serviço NUNCA dá
// UPDATE numa versão: publicar e reverter só INSEREM versões novas; reverter "copia para a frente"
// (§3.4) — o ponteiro nunca retrocede, para o número de versão continuar mapeando um período
// contínuo e a comparação entre versões não ficar envenenada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import prisma from '../base/db.js';
import {
  executorDe,
  saidasDe,
  validarNo,
  referenciasDoNo,
  SAIDAS_DE_EXCECAO,
  PERFIL_LIMITES_PADRAO, noEstaciona } from './ragnabot-fluxo-nos.service.js';

// Saídas que o AUTOR não é obrigado a conectar: são de exceção/falha, e o nó tem política própria
// (acaoFinal) ou o motor as resolve sem uma aresta desenhada. Exigir aresta para todas elas tornaria
// insuportável desenhar qualquer fluxo — mas as saídas do CAMINHO FELIZ (padrao, itens de lista,
// verdadeiro/falso) continuam obrigatórias. `saidasDe()` já junta as de exceção às declaradas; aqui
// a gente separa o que é cobrança de topologia do que é opcional.
const SAIDAS_OPCIONAIS = new Set([...SAIDAS_DE_EXCECAO, 'erro', 'erro_interno', 'sem_janela']);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HASHES E JSON CANÔNICO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * JSON com chaves ORDENADAS em todos os níveis. `JSON.stringify` preserva a ordem de inserção das
 * chaves, então dois documentos iguais em conteúdo mas montados em ordem diferente pelo editor
 * gerariam hashes diferentes — e aí "documento idêntico" viraria mentira. Ordenar as chaves torna a
 * serialização determinística e o hash, uma função só do conteúdo.
 */
function jsonCanonico(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const chaves = Object.keys(v).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(v[k])}`).join(',')}}`;
}

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

/** As saídas de um nó, ordenadas e à prova de tipo desconhecido (que a validação já reprova). */
function saidasOrdenadas(no) {
  try {
    return [...saidasDe(no)].sort();
  } catch {
    // Tipo de nó que ninguém implementa: o validador cobra isso como erro; aqui só não deixamos o
    // cálculo do hash explodir. Um esqueleto sem saídas é suficiente — o documento não publica assim.
    return [];
  }
}

/**
 * ESQUELETO do documento — a matéria-prima de `hashEstrutura`. Só topologia: nós por (id, tipo,
 * saídas) e arestas por (de, saída, para), ambos ORDENADOS para não depender da ordem do editor.
 * Nada de texto, tempo, limiar ou `ui`.
 */
function esqueleto(documento) {
  const nos = (documento?.nos ?? [])
    .map((n) => ({ id: n?.id, tipo: n?.tipo, saidas: saidasOrdenadas(n) }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const arestas = (documento?.arestas ?? [])
    .map((a) => ({ de: a?.de, saida: a?.saida, para: a?.para }))
    .sort((a, b) => jsonCanonico(a).localeCompare(jsonCanonico(b)));
  return { nos, arestas };
}

/** sha256 do documento INTEIRO, `ui` incluído (cobre até a posição na tela). */
export function hashDocumento(documento) {
  return sha256(jsonCanonico(documento ?? null));
}

/** sha256 SÓ do esqueleto (§2.1). É o hash que decide se o retrofit alcança quem está dentro. */
export function hashEstrutura(documento) {
  return sha256(jsonCanonico(esqueleto(documento)));
}

/**
 * sha256 do documento SEM as coordenadas `ui` de cada nó. Não é armazenado — serve só para separar
 * "mudou só a posição na tela" (no-op de publicação) de "mudou o conteúdo". Ver a decisão declarada
 * no cabeçalho.
 */
export function hashConteudo(documento) {
  const semUi = {
    ...(documento ?? {}),
    nos: (documento?.nos ?? []).map((n) => {
      const { ui, ...resto } = n ?? {};
      return resto;
    }),
  };
  return sha256(jsonCanonico(semUi));
}

/**
 * Compara a topologia de dois documentos. É o que a rota de PRÉVIA (`GET /mudanca`) usa para dizer,
 * antes do clique, se a publicação é compatível com quem já está conversando.
 * @returns {'compativel'|'estrutural'}
 */
export function classificarMudanca(docVigente, docNovo) {
  return hashEstrutura(docVigente) === hashEstrutura(docNovo) ? 'compativel' : 'estrutural';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO ESTRUTURAL
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Valida um documento SEM publicar. Reusa `validarNo` (a validação de CADA nó, que é do arquivo dos
 * executores — não a reimplemento) e junta a ela o que só o grafo inteiro sabe: nó inicial, arestas
 * penduradas, saídas obrigatórias sem destino e nó órfão inalcançável.
 *
 * NUNCA lança: um validador que quebra deixa o editor sem diagnóstico e o operador publica no escuro.
 * Os problemas de nível 'erro' (classe A) impedem publicar; os de nível 'aviso' (classe B) não.
 *
 * @returns {{ ok:boolean, erros:Array, avisos:Array, noInicialId:(string|null),
 *             noResgateId:(string|null), temEstaciona:boolean, perfilLimite:string }}
 */
export function validarDocumento(documento, { tenantId = null, perfilLimite = PERFIL_LIMITES_PADRAO.perfil, fluxoId = null } = {}) {
  const erros = [];
  const avisos = [];
  const push = (p) => (p?.nivel === 'aviso' ? avisos : erros).push(p);
  const problema = (codigo, campo, mensagem, comoCorrigir) => ({ nivel: 'erro', codigo, campo, mensagem, comoCorrigir });

  const nos = Array.isArray(documento?.nos) ? documento.nos : [];
  const arestas = Array.isArray(documento?.arestas) ? documento.arestas : [];

  // Forma mínima (o router já confere, mas este serviço também é chamado direto — falha fechada).
  if (!nos.length) {
    erros.push(problema('DOCUMENTO_VAZIO', 'nos', 'O fluxo não tem nenhum nó.', 'Adicione ao menos o nó de início.'));
  }
  const idsVistos = new Set();
  for (const n of nos) {
    if (!n || typeof n.id !== 'string' || !n.id) {
      erros.push(problema('NO_SEM_ID', 'nos', 'Há nó sem "id" em texto.', 'Todo nó precisa de um id.'));
      continue;
    }
    if (idsVistos.has(n.id)) {
      erros.push(problema('NO_ID_REPETIDO', `nos.${n.id}`, `Há mais de um nó com id "${n.id}".`, 'Ids de nó são únicos.'));
    }
    idsVistos.add(n.id);
  }

  // Nó inicial: exatamente um nó do tipo 'inicio' é a porta de entrada da versão (§2.1 noInicialId).
  const iniciais = nos.filter((n) => n?.tipo === 'inicio');
  let noInicialId = null;
  if (iniciais.length === 0) {
    erros.push(problema('SEM_NO_INICIAL', 'nos', 'O fluxo não tem nó de início.', 'Adicione um nó do tipo "inicio".'));
  } else if (iniciais.length > 1) {
    erros.push(problema('NO_INICIAL_AMBIGUO', 'nos', `O fluxo tem ${iniciais.length} nós de início.`, 'Deixe apenas um.'));
  } else {
    noInicialId = iniciais[0].id;
  }

  // Validação POR NÓ — delegada ao arquivo dos executores. Perfil de limites: uso o padrão declarado
  // (a tabela datada de limites reais ainda não está ligada); registro o perfil na versão para
  // rastro. `ctx` vazio ⇒ `validarNo` cai no PERFIL_LIMITES_PADRAO.
  const ctx = {};
  const nosPorId = new Map(nos.map((n) => [n.id, n]));
  let temEstaciona = false;
  for (const n of nos) {
    if (!n?.id) continue;
    try {
      for (const p of validarNo(n, ctx)) push({ ...p, campo: `nos.${n.id}.${p.campo ?? ''}`.replace(/\.$/, ''), noId: n.id });
    } catch (e) {
      erros.push(problema('NO_INVALIDO', `nos.${n.id}`, `Não foi possível validar o nó "${n.id}": ${e.message}`, 'Confira o tipo do nó.'));
    }
    try {
      // `noEstaciona(n)` e não `executor.estaciona`: desde 29/08 o botão de LINK não estaciona
      // (a Meta não avisa clique em botão de URL), então "estaciona" depende da CONFIGURAÇÃO do
      // nó, não só do tipo.
      if (noEstaciona(n)) temEstaciona = true;
    } catch { /* tipo desconhecido já reportado acima */ }
  }

  // Arestas: cada uma tem de ligar nós EXISTENTES por uma saída que o nó de origem realmente possui.
  const temAresta = new Set(); // "de saida" — quais saídas já têm destino
  for (const a of arestas) {
    const de = a?.de; const saida = a?.saida; const para = a?.para;
    if (!nosPorId.has(de)) {
      erros.push(problema('ARESTA_ORIGEM_INEXISTENTE', 'arestas', `Aresta parte de um nó inexistente ("${de}").`, 'Corrija a origem ou remova a aresta.'));
      continue;
    }
    if (!nosPorId.has(para)) {
      erros.push(problema('ARESTA_DESTINO_INEXISTENTE', 'arestas', `Aresta aponta para um nó inexistente ("${para}").`, 'Corrija o destino ou remova a aresta.'));
      continue;
    }
    const validas = new Set(saidasOrdenadas(nosPorId.get(de)));
    if (!validas.has(saida)) {
      erros.push(problema('ARESTA_SAIDA_INEXISTENTE', `arestas.${de}`, `O nó "${de}" não tem a saída "${saida}".`, 'Use uma das saídas do nó.'));
      continue;
    }
    temAresta.add(`${de} ${saida}`);
  }

  // Saída obrigatória sem destino: só o caminho FELIZ é cobrado (exceção/falha é opcional).
  for (const n of nos) {
    if (!n?.id) continue;
    for (const saida of saidasOrdenadas(n)) {
      if (SAIDAS_OPCIONAIS.has(saida)) continue;
      if (!temAresta.has(`${n.id} ${saida}`)) {
        erros.push(problema('SAIDA_SEM_DESTINO', `nos.${n.id}`, `A saída "${saida}" do nó "${n.id}" não leva a lugar nenhum.`, 'Ligue essa saída a um nó.'));
      }
    }
  }

  // Nó órfão: alcançabilidade a partir do nó inicial, seguindo qualquer saída. Um nó que ninguém
  // alcança é trabalho morto no grafo — e, pior, esconde intenção do autor que nunca roda.
  if (noInicialId) {
    const adj = new Map();
    for (const a of arestas) {
      if (!nosPorId.has(a?.de) || !nosPorId.has(a?.para)) continue;
      if (!adj.has(a.de)) adj.set(a.de, []);
      adj.get(a.de).push(a.para);
    }
    const alcancados = new Set([noInicialId]);
    const fila = [noInicialId];
    while (fila.length) {
      const atual = fila.shift();
      for (const prox of adj.get(atual) ?? []) if (!alcancados.has(prox)) { alcancados.add(prox); fila.push(prox); }
    }
    for (const n of nos) {
      if (n?.id && !alcancados.has(n.id)) {
        erros.push(problema('NO_ORFAO', `nos.${n.id}`, `O nó "${n.id}" não é alcançável a partir do início.`, 'Ligue-o ao fluxo ou remova-o.'));
      }
    }
  }

  // Sub-fluxo apontando para o PRÓPRIO fluxo. É o laço mais comum e o mais barato de pegar: não
  // precisa de banco, e a mensagem nomeia o nó. O laço INDIRETO (A→B→A) precisa das versões
  // publicadas dos outros fluxos e é conferido em `conferirLacoDeSubfluxo`, dentro da publicação.
  if (fluxoId) {
    for (const n of nos) {
      if (n?.tipo !== 'subfluxo') continue;
      if (String(n?.config?.fluxoId ?? '') !== String(fluxoId)) continue;
      erros.push(problema(
        'SUBFLUXO_EM_LACO', `nos.${n.id}.config.fluxoId`,
        `O nó "${n.id}" faz este fluxo chamar a si mesmo. Na conversa real isso anda em círculo até `
        + 'bater no teto de passos e morrer, depois de gastar mensagens com o cliente.',
        'Aponte o sub-fluxo para outro fluxo, ou troque o nó por uma ligação dentro deste mesmo desenho.',
      ));
    }
  }

  // Nó de resgate: OBRIGATÓRIO quando a versão tem nó que estaciona (I7 / §2.1). É para onde vai a
  // execução órfã num retrofit forçado; sem ele, a migração forçada não teria destino seguro.
  const resgate = nos.find((n) => n?.config?.resgate === true) || (documento?.noResgateId ? nosPorId.get(documento.noResgateId) : null);
  const noResgateId = resgate?.id ?? (nosPorId.has(documento?.noResgateId) ? documento.noResgateId : null);
  if (temEstaciona && !noResgateId) {
    erros.push(problema('SEM_NO_RESGATE', 'documento', 'O fluxo tem nó que espera resposta, mas não define nó de resgate.', 'Marque um nó com config.resgate=true (destino da migração forçada).'));
  }

  return { ok: erros.length === 0, erros, avisos, noInicialId, noResgateId, temEstaciona, perfilLimite };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GUARDA CONTRA LAÇO DE SUB-FLUXO — contrato S3 (02/09/2026), doc 34 §F3.4
//
// ── O DEFEITO QUE ISTO IMPEDE ───────────────────────────────────────────────────────────────────
// O nó `subfluxo` entrega o controle a OUTRO fluxo. Nada, até aqui, impedia o fluxo A de chamar o
// B e o B de chamar o A de volta. Em produção isso não aparece como erro: aparece como conversa
// que anda em círculo até bater no teto de passos (`passosTotalMax`) e morrer com
// `teto_de_passos` — depois de gastar mensagens de verdade com um cliente de verdade e de encher a
// caixa de incidentes com um sintoma que não nomeia a causa.
//
// ── POR QUE NA PUBLICAÇÃO, E NÃO NO RASCUNHO ───────────────────────────────────────────────────
// Desenhar um laço enquanto se pensa é normal e não faz mal a ninguém; o rascunho é privado. O que
// não pode é PUBLICAR: publicar é o instante em que o desenho passa a atender cliente. Por isso a
// guarda mora aqui, dentro da mesma transação que cria a versão — e recusa em vez de avisar.
//
// ── O QUE CONTA COMO «O FLUXO B», e por que a leitura é da VERSÃO PUBLICADA ─────────────────────
// A travessia real do motor segue a versão PUBLICADA do fluxo de destino (`montarSalto`), não o
// rascunho dele. Então é a versão publicada que este grafo lê. Consequência declarada e correta:
// um laço que só existe no rascunho do outro fluxo NÃO barra esta publicação — ele barrará a
// publicação DAQUELE fluxo, que é onde a decisão pertence.
//
// ── ALCANCE DA RECUSA ───────────────────────────────────────────────────────────────────────────
// Recusa qualquer ciclo ALCANÇÁVEL a partir do fluxo publicado, e não apenas o que passa por ele.
// A razão é simples: uma conversa que entra aqui e cai num ciclo lá adiante morre do mesmo jeito.
// O caminho inteiro vai na mensagem, com os nomes dos fluxos — «Atendimento → Menu → Atendimento»
// é acionável; «laço detectado» não é.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Os fluxos que ESTE documento chama por nó `subfluxo`. Função PURA — a base do grafo. */
export function subfluxosChamados(documento) {
  const alvos = [];
  for (const n of documento?.nos ?? []) {
    if (n?.tipo !== 'subfluxo') continue;
    const alvo = n?.config?.fluxoId;
    if (alvo) alvos.push({ fluxoId: String(alvo), noId: n.id, modo: n?.config?.modo ?? null });
  }
  return alvos;
}

/**
 * Monta o grafo de chamadas da empresa e procura ciclo alcançável a partir de `fluxoId`.
 *
 * @param {object} tx cliente Prisma (ou transação) — recebido para rodar DENTRO da transação de publicação
 * @param {{tenantId:string, fluxoId:string, documento:object}} p
 * @returns {Promise<{ok:boolean, ciclos:Array<{fluxos:string[], nomes:string[], noId:string}>}>}
 */
export async function conferirLacoDeSubfluxo(tx, { tenantId, fluxoId, documento } = {}) {
  const proprios = subfluxosChamados(documento);

  // Atalho barato e o caso mais comum: o fluxo chamando a si mesmo. Não precisa de banco nenhum, e
  // a mensagem é a mais clara de todas.
  const autoChamada = proprios.find((s) => s.fluxoId === String(fluxoId));
  if (autoChamada) {
    return { ok: false, ciclos: [{ fluxos: [String(fluxoId), String(fluxoId)], nomes: [], noId: autoChamada.noId }] };
  }
  if (!proprios.length) return { ok: true, ciclos: [] };

  // Todos os fluxos da empresa, com a versão publicada. Uma leitura só: a alternativa (caminhar o
  // grafo consultando de um em um) faria N idas ao banco DENTRO da transação de publicação.
  const fluxos = await tx.ragnabotFluxo.findMany({
    where: { tenantId },
    select: { id: true, nome: true, versaoPublicadaId: true },
  });
  const nomePorId = new Map(fluxos.map((f) => [f.id, f.nome]));
  const versaoIds = fluxos.map((f) => f.versaoPublicadaId).filter(Boolean);
  const versoes = versaoIds.length
    ? await tx.ragnabotFluxoVersao.findMany({
      where: { id: { in: versaoIds }, tenantId },
      select: { id: true, fluxoId: true, documento: true },
    })
    : [];

  /** fluxoId → [{fluxoId alvo, noId}] */
  const chamadas = new Map();
  for (const v of versoes) chamadas.set(v.fluxoId, subfluxosChamados(v.documento));
  // O fluxo em publicação usa o documento NOVO, não a versão vigente — é justamente a mudança que
  // está sob julgamento.
  chamadas.set(String(fluxoId), proprios);

  // Busca em profundidade com pilha explícita de caminho. Marcamos três estados (branco/cinza/
  // preto) porque só o CINZA — nó ainda na pilha — caracteriza ciclo; um nó já fechado que aparece
  // de novo é apenas rombo no grafo, e recusar por isso barraria desenhos legítimos.
  const cor = new Map();
  const ciclos = [];
  const caminho = [];

  const caminhar = (atual) => {
    cor.set(atual, 'cinza');
    caminho.push(atual);
    for (const chamada of chamadas.get(atual) ?? []) {
      const alvo = chamada.fluxoId;
      if (cor.get(alvo) === 'cinza') {
        const desde = caminho.indexOf(alvo);
        const ciclo = [...caminho.slice(desde), alvo];
        ciclos.push({
          fluxos: ciclo,
          nomes: ciclo.map((id) => nomePorId.get(id) || id),
          noId: chamada.noId,
        });
        continue;
      }
      if (cor.get(alvo) === 'preto') continue;
      // Alvo que não é da empresa (ou não publicado) não tem chamadas conhecidas: não segue laço
      // por aqui. `validarNo` do `subfluxo` já reprova destino de outra empresa; destino sem versão
      // publicada é recusado em tempo de execução por `montarSalto` (`subfluxo_indisponivel`).
      caminhar(alvo);
    }
    caminho.pop();
    cor.set(atual, 'preto');
  };

  caminhar(String(fluxoId));
  return { ok: ciclos.length === 0, ciclos };
}

/** A frase que o operador lê. Uma linha por ciclo, com os NOMES — id de fluxo ninguém decora. */
export function mensagemDeLaco(ciclos = []) {
  return ciclos.map((c) => {
    const trilha = (c.nomes.length ? c.nomes : c.fluxos).join(' → ');
    return c.fluxos.length === 2 && c.fluxos[0] === c.fluxos[1]
      ? `o nó "${c.noId}" faz o fluxo chamar a si mesmo`
      : `o nó "${c.noId}" fecha um laço: ${trilha}`;
  }).join('; ');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MATERIALIZAÇÃO DA PROJEÇÃO DO GRAFO
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Deriva as linhas de `RagnabotFluxoNo` e `RagnabotFluxoAresta` de um documento. É a projeção do
 * §2.2: existe para responder em SQL as perguntas de conjunto ("quais nós usam este segredo?", "o nó
 * onde a execução parou existe na versão nova?") que o JSONB responde mal. `reprojetar` sempre pode
 * reconstruí-la do documento — nunca há duas verdades.
 */
function projetar(versaoId, tenantId, documento) {
  const nos = (documento?.nos ?? []).map((n, ordem) => {
    let estaciona = false; let efeito = 'nenhum';
    try { const e = executorDe(n.tipo); estaciona = noEstaciona(n); efeito = e.efeito ?? 'nenhum'; } catch { /* validado antes */ }
    const refs = (() => { try { return referenciasDoNo(n); } catch { return { segredosRef: [], destinosRef: [] }; } })();
    const titulo = n?.titulo ?? n?.config?.titulo ?? null;
    return {
      versaoId, tenantId, noId: n.id, tipo: n.tipo, titulo, ordem,
      estaciona, efeito,
      segredosRef: refs.segredosRef ?? [], destinosRef: refs.destinosRef ?? [],
      resumo: titulo ? String(titulo).slice(0, 120) : null,
    };
  });
  const arestas = (documento?.arestas ?? []).map((a) => ({
    versaoId, tenantId, de: a.de, saida: a.saida, para: a.para,
  }));
  return { nos, arestas };
}

/** Próximo número de versão do fluxo. Monotônico no tempo, nunca reaproveitado (§2.1). */
async function proximoNumero(tx, fluxoId) {
  const ultima = await tx.ragnabotFluxoVersao.findFirst({
    where: { fluxoId }, orderBy: { numero: 'desc' }, select: { numero: true },
  });
  return (ultima?.numero ?? 0) + 1;
}

/**
 * Cria uma VERSÃO nova (INSERT puro) + a projeção do grafo, e reaponta o fluxo para ela. Núcleo
 * compartilhado por `publicar` e `reverterPara`. Roda SEMPRE dentro de uma transação recebida.
 */
async function criarVersao(tx, { fluxo, documento, validacao, modoMigracao, notaPublicacao, origemVersaoId, userId }) {
  const numero = await proximoNumero(tx, fluxo.id);
  const versao = await tx.ragnabotFluxoVersao.create({
    data: {
      fluxoId: fluxo.id,
      tenantId: fluxo.tenantId,
      numero,
      documento,
      hashDocumento: hashDocumento(documento),
      hashEstrutura: hashEstrutura(documento),
      variaveis: Array.isArray(documento?.variaveis) ? documento.variaveis : [],
      noInicialId: validacao.noInicialId,
      noResgateId: validacao.noResgateId,
      perfilLimite: validacao.perfilLimite,
      validacao: { ok: validacao.ok, erros: validacao.erros, avisos: validacao.avisos },
      modoMigracao,
      origemVersaoId: origemVersaoId ?? null,
      notaPublicacao: notaPublicacao ?? null,
      publicadoPorUserId: userId ?? null,
      publicadoEm: new Date(),
    },
  });
  const proj = projetar(versao.id, fluxo.tenantId, documento);
  if (proj.nos.length) await tx.ragnabotFluxoNo.createMany({ data: proj.nos });
  if (proj.arestas.length) await tx.ragnabotFluxoAresta.createMany({ data: proj.arestas });
  await tx.ragnabotFluxo.update({ where: { id: fluxo.id }, data: { versaoPublicadaId: versao.id } });
  return versao;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO DE CONVERSAS VIVAS
// ════════════════════════════════════════════════════════════════════════════════════════════════

const ESTADOS_ATIVOS = ['rodando', 'esperando', 'pausado_humano', 'pausado_duvida'];

/**
 * Move (ou não) quem está no meio da conversa para a versão nova, conforme `modoMigracao` (§3.4):
 *   fixar            → ninguém se move; as vivas terminam na versão em que entraram.
 *   retrofit         → todas passam à nova; quem parou num nó que ainda existe continua ali.
 *   retrofit_forcado → todas passam à nova; quem parou num nó que SUMIU vai ao nó de resgate.
 *
 * "Nada de reencaixe por semelhança": órfã só vai para o RESGATE, nunca para o nó "mais parecido"
 * — errar em silêncio no meio de uma conversa de cliente é pior que parar.
 */
async function migrarVivas(tx, { fluxoId, versaoAnteriorId, versaoNova, modoMigracao }) {
  if (!versaoAnteriorId || modoMigracao === 'fixar') return { migradas: 0, resgatadas: 0 };

  const vivas = await tx.ragnabotFluxoExecucao.findMany({
    where: { fluxoId, versaoId: versaoAnteriorId, estado: { in: ESTADOS_ATIVOS } },
    select: { id: true, noAtualId: true },
  });
  if (!vivas.length) return { migradas: 0, resgatadas: 0 };

  const idsNaVersaoNova = new Set((versaoNova.documento?.nos ?? []).map((n) => n.id));
  let migradas = 0; let resgatadas = 0;

  for (const v of vivas) {
    const noSumiu = v.noAtualId && !idsNaVersaoNova.has(v.noAtualId);
    if (noSumiu && modoMigracao !== 'retrofit_forcado') {
      // retrofit (não forçado) só é oferecido quando a mudança é 'compativel'; se mesmo assim um nó
      // sumiu, NÃO arrastamos a conversa para um grafo onde ela não cabe — deixamos na versão antiga.
      continue;
    }
    const data = { versaoId: versaoNova.id };
    if (noSumiu) {
      if (!versaoNova.noResgateId) {
        throw Object.assign(new Error('Migração forçada exige nó de resgate, e a versão nova não tem um.'), { codigo: 'SEM_NO_RESGATE' });
      }
      data.noAtualId = versaoNova.noResgateId;
      data.noCongelado = null;
      resgatadas += 1;
    }
    await tx.ragnabotFluxoExecucao.update({ where: { id: v.id }, data });
    migradas += 1;
  }
  return { migradas, resgatadas };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OPERAÇÕES PÚBLICAS (as que o router chama)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * PUBLICAR — congela o rascunho numa versão nova, quando há o que congelar.
 *
 * @param {string} fluxoId
 * @param {{userId?:string, modoMigracao?:string, notaPublicacao?:string, confirmou2FA?:boolean}} opcoes
 * @returns {Promise<object>} `{ criouVersao, versaoId, numero, migradas, resgatadas, ... }`.
 *   Os campos `numero`, `versaoId`, `migradas`, `resgatadas` são os que o router grava na auditoria.
 */
export async function publicar(fluxoId, { userId = null, modoMigracao = 'fixar', notaPublicacao = null, confirmou2FA = false } = {}) {
  if (!['fixar', 'retrofit', 'retrofit_forcado'].includes(modoMigracao)) {
    throw Object.assign(new Error(`modoMigracao inválido: "${modoMigracao}".`), { codigo: 'MODO_INVALIDO' });
  }
  if (modoMigracao === 'retrofit_forcado' && !confirmou2FA) {
    // Defesa em profundidade: o router já exige 2FA para forçado, mas o serviço não confia nisso.
    throw Object.assign(new Error('Retrofit forçado exige confirmação em duas etapas.'), { codigo: 'PRECISA_2FA' });
  }

  return prisma.$transaction(async (tx) => {
    const fluxo = await tx.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
    if (!fluxo) throw Object.assign(new Error('Fluxo não encontrado.'), { codigo: 'NAO_ACHOU' });

    const rascunho = await tx.ragnabotFluxoRascunho.findUnique({ where: { fluxoId } });
    if (!rascunho) throw Object.assign(new Error('Este fluxo não tem rascunho para publicar.'), { codigo: 'SEM_RASCUNHO' });
    const documento = rascunho.documento;

    const validacao = validarDocumento(documento, { tenantId: fluxo.tenantId, fluxoId: fluxo.id });
    if (!validacao.ok) {
      throw Object.assign(new Error(`O fluxo tem ${validacao.erros.length} erro(s) e não pode ser publicado.`), {
        codigo: 'VALIDACAO', validacao,
      });
    }

    // ⛔ LAÇO DE SUB-FLUXO — recusado AQUI, e não descoberto em produção (contrato S3, §F3.4).
    // Roda depois da validação de forma (um documento quebrado não merece consulta ao banco) e
    // antes de qualquer escrita: nenhuma versão nasce com laço.
    const laco = await conferirLacoDeSubfluxo(tx, { tenantId: fluxo.tenantId, fluxoId: fluxo.id, documento });
    if (!laco.ok) {
      throw Object.assign(new Error(`Este fluxo não pode ser publicado: ${mensagemDeLaco(laco.ciclos)}.`), {
        codigo: 'SUBFLUXO_EM_LACO', ciclos: laco.ciclos,
      });
    }

    // Regra de no-op (ver decisão declarada no cabeçalho): sem mudança de conteúdo, ou mudança só de
    // `ui`, não nasce versão. Comparo contra a VERSÃO VIGENTE, não contra qualquer versão antiga.
    const vigente = fluxo.versaoPublicadaId
      ? await tx.ragnabotFluxoVersao.findUnique({ where: { id: fluxo.versaoPublicadaId } })
      : null;
    if (vigente) {
      const docNovoHash = hashDocumento(documento);
      if (docNovoHash === vigente.hashDocumento) {
        return { criouVersao: false, motivo: 'documento idêntico à versão vigente', versaoId: vigente.id, numero: vigente.numero, migradas: 0, resgatadas: 0 };
      }
      if (hashConteudo(documento) === hashConteudo(vigente.documento)) {
        // Só as coordenadas `ui` mudaram: o rascunho fica guardado (a tela lembra a posição), mas a
        // topologia e o conteúdo são idênticos — publicar seria criar uma versão gêmea que só
        // confunde a análise e não muda uma vírgula do que o cliente vê. LEI 5.
        return { criouVersao: false, motivo: 'apenas coordenadas de tela (ui) mudaram', versaoId: vigente.id, numero: vigente.numero, migradas: 0, resgatadas: 0 };
      }
    }

    const versao = await criarVersao(tx, {
      fluxo, documento, validacao, modoMigracao, notaPublicacao, origemVersaoId: null, userId,
    });
    const { migradas, resgatadas } = await migrarVivas(tx, {
      fluxoId: fluxo.id, versaoAnteriorId: fluxo.versaoPublicadaId, versaoNova: versao, modoMigracao,
    });

    return {
      criouVersao: true,
      versaoId: versao.id,
      numero: versao.numero,
      hashDocumento: versao.hashDocumento,
      hashEstrutura: versao.hashEstrutura,
      modoMigracao,
      migradas,
      resgatadas,
    };
  });
}

/**
 * REVERTER — republica o conteúdo de uma versão antiga COMO VERSÃO NOVA ("copia para a frente",
 * §3.4). O ponteiro nunca retrocede: se retrocedesse, o número da versão deixaria de mapear um
 * período contínuo e toda comparação N vs N−1 ficaria envenenada. O resultado é que o fluxo passa a
 * SERVIR de novo o conteúdo da versão `numero` — idêntico byte a byte (mesmo `hashDocumento`), com
 * `origemVersaoId` apontando de onde veio.
 *
 * @param {string} fluxoId
 * @param {number} numero  a versão CUJO CONTEÚDO se quer de volta
 * @returns {Promise<object>} `{ criouVersao:true, versaoId, numero, revertidoDe, origemVersaoId, ... }`
 */
export async function reverterPara(fluxoId, numero, { userId = null } = {}) {
  if (!Number.isInteger(numero) || numero < 1) {
    throw Object.assign(new Error('Número de versão inválido.'), { codigo: 'NUMERO_INVALIDO' });
  }
  return prisma.$transaction(async (tx) => {
    const fluxo = await tx.ragnabotFluxo.findUnique({ where: { id: fluxoId } });
    if (!fluxo) throw Object.assign(new Error('Fluxo não encontrado.'), { codigo: 'NAO_ACHOU' });

    const alvo = await tx.ragnabotFluxoVersao.findUnique({ where: { fluxoId_numero: { fluxoId, numero } } });
    if (!alvo) throw Object.assign(new Error(`Versão ${numero} não existe neste fluxo.`), { codigo: 'VERSAO_NAO_ACHADA' });

    // Revalido o conteúdo antigo contra as regras de HOJE: um nó que era válido pode ter deixado de
    // ser (executor removido). Se não valida mais, a reversão é recusada com o motivo — melhor que
    // republicar um grafo que o motor atual não sabe rodar.
    const validacao = validarDocumento(alvo.documento, { tenantId: fluxo.tenantId, perfilLimite: alvo.perfilLimite, fluxoId: fluxo.id });
    if (!validacao.ok) {
      throw Object.assign(new Error(`A versão ${numero} não é mais válida pelas regras atuais e não pode ser revertida.`), {
        codigo: 'VALIDACAO', validacao,
      });
    }

    // A mesma guarda da publicação. Reverter é publicar conteúdo antigo: o outro fluxo pode ter
    // MUDADO desde então e fechado o laço pelo outro lado. Sem esta linha, a reversão seria a porta
    // dos fundos por onde o laço volta ao ar.
    const laco = await conferirLacoDeSubfluxo(tx, { tenantId: fluxo.tenantId, fluxoId: fluxo.id, documento: alvo.documento });
    if (!laco.ok) {
      throw Object.assign(new Error(`A versão ${numero} não pode voltar ao ar: ${mensagemDeLaco(laco.ciclos)}.`), {
        codigo: 'SUBFLUXO_EM_LACO', ciclos: laco.ciclos,
      });
    }

    const versao = await criarVersao(tx, {
      fluxo,
      documento: alvo.documento,
      validacao,
      modoMigracao: 'fixar', // reverter não arrasta conversa viva: o conteúdo volta, quem está dentro segue onde está
      notaPublicacao: `Revertido para o conteúdo da versão ${numero}`,
      origemVersaoId: alvo.id,
      userId,
    });

    return {
      criouVersao: true,
      versaoId: versao.id,
      numero: versao.numero,
      revertidoDe: numero,
      origemVersaoId: alvo.id,
      hashDocumento: versao.hashDocumento,
      migradas: 0,
      resgatadas: 0,
    };
  });
}

/**
 * SALVAR RASCUNHO — grava o documento em edição com concorrência otimista (comparar-e-trocar por
 * `rev`) e anexa o resultado da validação. O router prefere esta função à sua própria retaguarda
 * exatamente para que o rascunho nunca fique sem validação anexada.
 *
 * Em conflito de revisão LANÇA com "revisão" na mensagem — o router reconhece e devolve 409.
 */
export async function salvarRascunho(fluxoId, documento, { rev, userId = null } = {}) {
  const fluxo = await prisma.ragnabotFluxo.findUnique({ where: { id: fluxoId }, select: { tenantId: true } });
  if (!fluxo) throw Object.assign(new Error('Fluxo não encontrado.'), { codigo: 'NAO_ACHOU' });

  const validacao = validarDocumento(documento, { tenantId: fluxo.tenantId });
  const r = await prisma.ragnabotFluxoRascunho.updateMany({
    where: { fluxoId, rev: Number(rev) },
    data: {
      documento,
      rev: { increment: 1 },
      validacao: { ok: validacao.ok, erros: validacao.erros, avisos: validacao.avisos },
      atualizadoPorUserId: userId ?? null,
    },
  });
  if (r.count === 0) {
    const atual = await prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId }, select: { rev: true } });
    throw Object.assign(new Error('Conflito de revisão: outra pessoa gravou este rascunho depois que você o abriu.'), {
      codigo: 'CONFLITO_REV', revEnviada: Number(rev), revAtual: atual?.rev ?? null,
    });
  }
  return prisma.ragnabotFluxoRascunho.findUnique({ where: { fluxoId } });
}

/**
 * ONDE-USADO — responde "quais fluxos e nós usam este apelido de cofre?", lendo a projeção do grafo
 * (`RagnabotFluxoNo.segredosRef`). Devolve SÓ onde, nunca o valor do segredo — por isso pode ser
 * lida por quem administra o fluxo sem virar leitura do cofre. É o que torna possível rotacionar um
 * token SEM adivinhar quem depende dele.
 */
export async function ondeUsado(tenantId, apelido) {
  const nos = await prisma.ragnabotFluxoNo.findMany({
    where: { tenantId, segredosRef: { has: apelido } },
    select: { versaoId: true, noId: true, tipo: true, titulo: true },
  });
  const versaoIds = [...new Set(nos.map((n) => n.versaoId))];
  const versoes = versaoIds.length
    ? await prisma.ragnabotFluxoVersao.findMany({
      where: { id: { in: versaoIds } },
      select: { id: true, fluxoId: true, numero: true },
    })
    : [];
  const porVersao = new Map(versoes.map((v) => [v.id, v]));

  const usos = nos.map((n) => {
    const v = porVersao.get(n.versaoId) || {};
    return { fluxoId: v.fluxoId ?? null, versaoId: n.versaoId, versaoNumero: v.numero ?? null, noId: n.noId, tipo: n.tipo, titulo: n.titulo };
  });
  return { apelido, tenantId, total: usos.length, usos };
}

export default {
  publicar,
  reverterPara,
  salvarRascunho,
  validarDocumento,
  classificarMudanca,
  ondeUsado,
  hashDocumento,
  hashEstrutura,
  hashConteudo,
  // Contrato S3 (02/09/2026): a guarda contra laço de sub-fluxo.
  conferirLacoDeSubfluxo,
  subfluxosChamados,
  mensagemDeLaco,
};
