// ⇄ MUDOU DE CASA EM 30/08/2026 — doc 33 §Etapa 4 ("nada fica no NOC, absolutamente nada").
// Este arquivo era `frontend/src/pages/FluxosRagnabot.jsx`, do NOC. A CÓPIA É FIEL: mudança de
// comportamento junto com mudança de casa torna impossível saber o que quebrou. TRÊS coisas
// mudaram, e as três por necessidade — nenhuma delas por gosto:
//   1. a seção «1. CAMADA DE REDE» saiu daqui e virou `src/lib/api.js` — porque a credencial agora
//      vem do motor, e não do cookie de sessão do NOC;
//   2. `lerUsuarioDoNavegador()` deixou de ler `localStorage.noc_user` (chave do login do NOC, que
//      aqui não existe) e passou a ler o ator injetado pelo motor — sem isso o campo de empresa da
//      modal de criação sumiria em silêncio para o super usuário;
//   3. o caminho de `CapaSecao` acompanhou a pasta nova (`componentes/`, não `components/`).
// O texto abaixo é o original do autor da tela e fala do NOC em alguns pontos (o `@media print` de
// `styles/index.css`, os componentes de `components/fluxo/`). Ficou como estava de propósito: é o
// histórico da decisão, e reescrevê-lo agora apagaria o porquê sem acrescentar nada.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// EDITOR VISUAL DE FLUXO DE CONVERSA DO RAGNABOT
//
// Ordem do dono (28/08/2026): "faça toda a parte de fluxo". O motor já existe e está testado
// (src/services/ragnabot-fluxo-motor.service.js e ragnabot-fluxo-nos.service.js, 20 tabelas
// RagnabotFluxo* no banco, rotas em src/routes/ragnabot-fluxo.routes.js). O que faltava era a TELA:
// desenhar o fluxo, ligar os nós, conferir os limites da Meta antes de publicar e rodar o modo de
// teste sem mandar uma única mensagem de verdade.
//
// ── POR QUE ESTE ARQUIVO É AUTOCONTIDO (decisão, não preguiça) ───────────────────────────────────
// O plano previa dividir a tela em `lib/fluxo-api.js`, `components/fluxo/*.jsx` e
// `pages/RagnabotFluxoEditor.jsx`. Conferido no disco no início deste trabalho: NENHUM desses
// arquivos existe, e eles pertencem a outros agentes escrevendo ao mesmo tempo. Em Vite/Rollup um
// `import` — estático OU dinâmico — de módulo inexistente NÃO degrada: derruba o `npm run build`
// inteiro. Como a validação exigida é o build passar, esta página carrega tudo de que precisa
// dentro dela e importa apenas três coisas que já existem e são estáveis: `react`, `lucide-react`
// (chrome da interface) e `components/CapaSecao.jsx`. Quando os componentes de `components/fluxo/`
// subirem, trocar a implementação daqui por eles é substituição peça a peça, sem mudar o contrato
// de estado descrito abaixo.
//
// ── QUEM É DONO DE QUAL ESTADO (a regra que evitou as quatro versões perdidas) ───────────────────
//   • `useRascunhoDeFluxo` — ÚNICO dono de `documento`, `rev`, `sujo`, `salvando`, `conflito`.
//     Nenhum outro componente escreve no documento; todos pedem por callback.
//   • `Editor` — dono do que é só de tela: seleção, ligação em curso, escala, deslocamento,
//     interruptores de exceção/telemetria, aba lateral. Nada disso vai para o servidor.
//   • `PainelDeTeste` — dono do `estadoDaSessao` do teste, e NUNCA escreve no documento
//     (o teste confere o fluxo, não o edita).
//   • `Tela` e `BlocoDeNo` são controlados: recebem tudo por props e só emitem eventos. O único
//     estado que vive dentro deles é o transitório de arraste.
//
// ⚠️ TODAS as modais são renderizadas na RAIZ da página, FORA de qualquer `{aba === 'x' && …}`.
// Foi exatamente assim que, nas versões anteriores deste projeto, a modal deixava de montar quando
// o botão de outra aba mudava o estado: o bloco condicional desmontava a modal no mesmo ciclo em
// que ela deveria aparecer.
//
// ⚠️ Todo manipulador é `onClick={() => fn(arg)}`. `onClick={fn}` entrega o EVENTO como primeiro
// argumento — foi como um `onClick={apagarNo}` chegou a apagar o nó de id `[object PointerEvent]`.
//
// ── QUEM DÁ O VEREDITO, E QUEM SÓ ORIENTA (revisto em 29/08/2026) ───────────────────────────────
// O VEREDITO continua sendo do motor: `preparar()` é quem decide se um título cabe em 24, se a
// mensagem estoura o teto do canal e se a janela de 24 horas está aberta. Isso aparece na aba
// Prévia e no modo de teste, e nada aqui substitui aquilo.
// A tela, porém, passou a ORIENTAR ENQUANTO SE ESCREVE: contador de caracteres ao lado do rótulo
// do campo, teto de itens e de botões no próprio botão «Acrescentar». O motivo é medido: o
// operador escrevia um título de 40 caracteres, salvava, publicava, e só descobria o corte quando
// o cliente recebia a mensagem picada. Régua que só aparece depois do erro não é régua, é laudo.
// A orientação usa os MESMOS números de `LIMITES.valores` do motor (copiados em LIMITES_DO_CANAL,
// logo abaixo) e mostra o PIOR CASO das três contagens — o único número que nunca subestima.
// O que a tela confere sozinha são propriedades do DESENHO, que ela tem na mão: saída sem aresta,
// aresta para nó inexistente, duas arestas na mesma saída e nó inalcançável a partir do início.
//
// NOC · 2026-08-29.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus, Search, X, Save, Play, Trash2, RefreshCw, AlertTriangle, CheckCircle, Info,
  ZoomIn, ZoomOut, Maximize2, Eye, EyeOff, Copy, ArrowLeft, Clock, Send, Layers,
  History, Activity, Crosshair, Upload, ChevronRight, Map as IconeMapa,
} from 'lucide-react';
import CapaSecao from '../componentes/CapaSecao.jsx';
// A camada de rede saiu deste arquivo na mudança de casa (doc 33, Etapa 4): aqui a tela é servida
// pelo PRÓPRIO motor e fala com ele na mesma origem, pelo esquema de `src/base/auth.js`. O corpo do
// `chamarFluxo` é o mesmo; o que mudou foi de onde sai a credencial. Ver `src/lib/api.js`.
import { atorAtual, chamarFluxo, textoDeIndisponibilidade } from '../lib/api.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 0. TOKENS E ESTILOS
// O NOC é escuro; o único tema claro é o de impressão (@media print em styles/index.css), que
// sobrescreve os tokens sozinho. Por isso: zero cor literal aqui dentro.
// ⚠️ Contorno de campo usa --border-campo. A --border-primary mede 1,33:1 e some no celular.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const T = {
  ink: 'var(--text-primary)', sec: 'var(--text-secondary)', mut: 'var(--text-muted)',
  borda: 'var(--border-primary)', borda2: 'var(--border-secondary)', campo: 'var(--border-campo)',
  fundo: 'var(--bg-primary)', cartao: 'var(--bg-secondary)', sup: 'var(--bg-surface)',
  alto: 'var(--bg-elevated)', hover: 'var(--bg-hover)', entrada: 'var(--bg-input)',
  primaria: 'var(--primary)', sobrePrimaria: 'var(--on-primary)',
  ok: 'var(--success)', aviso: 'var(--warning)', perigo: 'var(--danger)', info: 'var(--info)',
  okDim: 'var(--success-dim)', avisoDim: 'var(--warning-dim)',
  perigoDim: 'var(--danger-dim)', infoDim: 'var(--info-dim)',
};

const cartao = {
  background: T.cartao, border: `1px solid ${T.borda}`, borderRadius: 12, padding: 16, color: T.ink,
};
const grade = (min) => ({
  display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12,
});
const campoEstilo = {
  width: '100%', padding: '9px 10px', borderRadius: 8, background: T.entrada,
  border: `1px solid ${T.campo}`, color: T.ink, fontSize: '0.86rem', minHeight: 40,
};
const rotuloEstilo = {
  display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '.04em',
  color: T.mut, marginBottom: 4, fontWeight: 700,
};

// Folha de estilo própria da tela. Existe por três motivos que `style` embutido não resolve:
// consultas de mídia de verdade (o NOC é usado no celular), `touch-action` no punho de arraste
// e o traçado animado das arestas. Fica escopada no prefixo `rgfx-` para não vazar para o resto.
const ESTILOS = `
.rgfx-viewport { position:relative; overflow:hidden; touch-action:none; background:
  radial-gradient(circle at 1px 1px, var(--border-primary) 1px, transparent 0) 0 0/24px 24px,
  var(--bg-primary); border:1px solid var(--border-primary); border-radius:12px; }
.rgfx-mundo { position:absolute; inset:0; transform-origin:0 0; will-change:transform; }
.rgfx-punho { cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; }
.rgfx-punho:active { cursor:grabbing; }
.rgfx-bloco { position:absolute; border-radius:10px; overflow:hidden;
  background:var(--bg-secondary); box-shadow:0 2px 10px rgba(0,0,0,.35); }
.rgfx-bloco:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
.rgfx-pino { display:flex; align-items:center; gap:6px; height:26px; padding:0 8px;
  font-size:.68rem; cursor:pointer; border:0; background:transparent; width:100%;
  color:var(--text-secondary); text-align:left; }
.rgfx-pino:hover, .rgfx-pino:focus-visible { background:var(--bg-hover); }
.rgfx-lateral { width:380px; flex:0 0 380px; }
.rgfx-paleta { width:186px; flex:0 0 186px; }
@media (max-width: 900px) {
  .rgfx-lateral { position:fixed; left:0; right:0; bottom:0; width:auto; flex:none; z-index:60;
    max-height:70vh; overflow:auto; border-radius:14px 14px 0 0;
    box-shadow:0 -8px 30px rgba(0,0,0,.55); }
  .rgfx-paleta { position:fixed; left:0; right:0; bottom:0; width:auto; flex:none; z-index:61;
    max-height:60vh; overflow:auto; border-radius:14px 14px 0 0; }
  .rgfx-esconde-no-celular { display:none !important; }
}
@media (min-width: 901px) { .rgfx-so-no-celular { display:none !important; } }
`;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. CATÁLOGO DOS 16 TIPOS DE NÓ
//
// ⚠️ A LISTA DE SAÍDAS É O CORAÇÃO DISTO, e ela pertence ao SERVIDOR: é `saidasDe(no)` do
// ragnabot-fluxo-nos.service.js quem decide quais conectores existem. Foi por o editor antigo não
// conhecer `saidasDeFalha: ['sem_janela']` que aquela saída ficou INDESENHÁVEL, o motor não achava
// destino, gravava incidente e a conversa do cliente morria calada.
//
// A rota `GET /catalogo` foi proposta no contrato mas ainda NÃO existe no router (conferido:
// ragnabot-fluxo.routes.js não a declara). Enquanto ela não subir, esta tela usa o ESPELHO abaixo
// - e diz isso em voz alta numa faixa amarela no editor, porque espelho que se declara espelho não
// corrói a confiança nos avisos que são regra. Assim que a rota existir, o espelho é descartado
// sozinho: `carregarCatalogo()` prefere sempre o servidor.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Geradas pelo motor em TODO nó que estaciona. O autor nunca as desenha à mão. */
const SAIDAS_DE_EXCECAO = ['sem_resposta', 'opcao_invalida', 'erro'];

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LIMITES DO CANAL — orientação enquanto se escreve, nunca veredito
//
// CÓPIA dos números que o motor carrega em `LIMITES.valores`
// (src/services/ragnabot-fluxo-nos.service.js). Ficam aqui para o contador aparecer no campo, no
// momento em que o texto é escrito — e não três telas adiante, na Prévia, quando o operador já
// esqueceu qual título era.
//
// ⚠️ Se estes números divergirem do motor, o motor ganha: ele é quem prepara a mensagem que sai.
// A régua da tela erra para o lado seguro (mostra o PIOR CASO das três contagens), então um campo
// que a tela aprova pode ainda assim ser cortado pelo motor — o contrário é que não pode acontecer.
// ────────────────────────────────────────────────────────────────────────────────────────────────
const LIMITES_DO_CANAL = Object.freeze({
  cabecalho: 60,
  rodape: 60,
  corpo: 1024,
  botaoRotulo: 20,
  botoesMax: 3,
  listaBotao: 20,
  listaTitulo: 24,
  listaDescricao: 72,
  listaItensMax: 10,
  listaSecoesMax: 10,
});

/**
 * Espelha `medirLocal()` do motor. NINGUÉM mediu em que unidade a Meta conta caractere, e a
 * diferença não é acadêmica: «Sim! Abra o chamado! ✅ » dá 23 grafemas, 24 pontos de código e 26
 * unidades UTF-16 contra um teto de 24 — três vereditos para a mesma linha. Devolvemos o pior caso
 * porque é o único que nunca diz «cabe» para algo que não cabe.
 */
function medirTexto(texto) {
  const t = String(texto ?? '');
  let grafemas = t.length;
  try {
    grafemas = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(t)].length;
  } catch {
    // Build de navegador sem Intl.Segmenter: pontos de código contam MENOS que grafemas, e o
    // máximo abaixo continua conservador.
    grafemas = [...t].length;
  }
  return Math.max(grafemas, [...t].length, t.length);
}

const CATALOGO_ESPELHO = {
  inicio:    { rotulo: 'Início',               sigla: 'IN', familia: 'limite',   estaciona: false, saidas: () => ['padrao'],                falha: [] },
  texto:     { rotulo: 'Mensagem',             sigla: 'MS', familia: 'conversa', estaciona: false, saidas: () => ['padrao', 'erro'],        falha: ['sem_janela'] },
  midia:     { rotulo: 'Mídia',                sigla: 'MD', familia: 'conversa', estaciona: false, saidas: () => ['padrao', 'erro'],        falha: ['sem_janela'] },
  pergunta:  { rotulo: 'Pergunta',             sigla: 'PG', familia: 'pergunta', estaciona: true,  saidas: () => ['padrao'],                falha: ['sem_janela'] },
  lista:     { rotulo: 'Lista',                sigla: 'LI', familia: 'pergunta', estaciona: true,  saidas: (c) => (c?.itens || []).map((i) => i.id).filter(Boolean), falha: ['sem_janela'] },
  botoes:    { rotulo: 'Botões',               sigla: 'BT', familia: 'pergunta', estaciona: true,  saidas: (c) => (c?.botoes || []).map((b) => b.id).filter(Boolean), falha: ['sem_janela'] },
  espera:    { rotulo: 'Espera',               sigla: 'ES', familia: 'controle', estaciona: false, saidas: () => ['padrao'],                falha: [] },
  condicao:  { rotulo: 'Condição',             sigla: 'CD', familia: 'controle', estaciona: false, saidas: () => ['verdadeiro', 'falso'],   falha: [] },
  http:      { rotulo: 'Chamada HTTP',         sigla: 'HT', familia: 'externo',  estaciona: false, saidas: () => ['sucesso', 'erro'],       falha: [] },
  variavel:  { rotulo: 'Definir variável',     sigla: 'VR', familia: 'controle', estaciona: false, saidas: () => ['padrao', 'erro'],        falha: [] },
  etiqueta:  { rotulo: 'Etiqueta',             sigla: 'ET', familia: 'controle', estaciona: false, saidas: () => ['padrao', 'erro_interno'], falha: [] },
  time:      { rotulo: 'Encaminhar para time', sigla: 'TM', familia: 'limite',   estaciona: false, saidas: () => [],                        falha: [] },
  notificar: { rotulo: 'Notificar',            sigla: 'NT', familia: 'externo',  estaciona: false, saidas: () => ['padrao', 'erro_interno'], falha: [] },
  email:     { rotulo: 'E-mail',               sigla: 'EM', familia: 'externo',  estaciona: false, saidas: () => ['padrao', 'erro_interno'], falha: [] },
  subfluxo:  { rotulo: 'Sub-fluxo',            sigla: 'SF', familia: 'controle', estaciona: false, saidas: (c) => (c?.modo === 'chamar' ? ['padrao'] : []), falha: [] },
  chamado:   { rotulo: 'Abrir chamado',        sigla: 'CH', familia: 'chamado',  estaciona: false, saidas: () => ['padrao', 'erro'],        falha: [] },
  encerrar:  { rotulo: 'Encerrar',             sigla: 'FI', familia: 'limite',   estaciona: false, saidas: () => [],                        falha: [] },
};

const ORDEM_DA_PALETA = [
  'inicio', 'texto', 'midia', 'pergunta', 'lista', 'botoes', 'espera', 'condicao',
  'http', 'variavel', 'etiqueta', 'time', 'notificar', 'email', 'subfluxo', 'chamado', 'encerrar',
];

// Cor da borda por FAMÍLIA de tipo, com os tokens do NOC. Cor sozinha nunca carrega informação
// nesta tela - o bloco também mostra a sigla e o rótulo por extenso.
const COR_DA_FAMILIA = {
  limite: T.ok, conversa: T.info, pergunta: T.info, controle: T.borda2,
  externo: T.aviso, chamado: T.primaria,
};

/** Espécie da saída - decide traço cheio/tracejado e a cor da aresta. */
function especieDaSaida(saida) {
  if (saida === 'sem_janela') return 'falha';
  if (SAIDAS_DE_EXCECAO.includes(saida) || saida === 'erro_interno') return 'excecao';
  return 'normal';
}

const ROTULO_DA_SAIDA = {
  padrao: 'segue', verdadeiro: 'verdadeiro', falso: 'falso', sucesso: 'sucesso', erro: 'erro',
  erro_interno: 'erro interno', sem_janela: 'fora da janela de 24 h',
  sem_resposta: 'sem resposta', opcao_invalida: 'opção inválida',
};
const rotularSaida = (s) => ROTULO_DA_SAIDA[s] || s;

/**
 * Junta o que o servidor mandou (quando mandou) com o espelho local.
 * `catalogo.tipos` é { tipo: { rotulo, estaciona, saidasFixas, saidasDeFalha, saidasDeExcecao } }.
 */
function saidasDoNo(no, catalogo) {
  const tipo = no?.tipo;
  const doServidor = catalogo?.tipos?.[tipo];
  const vistas = new Set();
  const saidas = [];
  const juntar = (lista) => {
    for (const s of lista || []) { if (s && !vistas.has(s)) { vistas.add(s); saidas.push(s); } }
  };
  if (doServidor) {
    // O servidor calcula `saidasFixas` com config vazia - as saídas que dependem da configuração
    // (um item de lista, um botão) têm de sair do documento, aqui, senão a lista viria vazia
    // justamente nos dois tipos em que ela é toda dinâmica.
    if (tipo === 'lista') juntar((no?.config?.itens || []).map((i) => i.id).filter(Boolean));
    else if (tipo === 'botoes') juntar((no?.config?.botoes || []).map((b) => b.id).filter(Boolean));
    else if (tipo === 'subfluxo') juntar(no?.config?.modo === 'chamar' ? ['padrao'] : []);
    else juntar(doServidor.saidasFixas);
    if (doServidor.estaciona) juntar(doServidor.saidasDeExcecao || SAIDAS_DE_EXCECAO);
    juntar(doServidor.saidasDeFalha);
    return saidas;
  }
  const espelho = CATALOGO_ESPELHO[tipo];
  if (!espelho) return [];
  juntar(espelho.saidas(no?.config || {}));
  if (espelho.estaciona) juntar(SAIDAS_DE_EXCECAO);
  juntar(espelho.falha);
  return saidas;
}

function metaDoTipo(tipo, catalogo) {
  const doServidor = catalogo?.tipos?.[tipo];
  const espelho = CATALOGO_ESPELHO[tipo];
  return {
    rotulo: espelho?.rotulo || tipo,
    sigla: espelho?.sigla || '??',
    familia: espelho?.familia || 'controle',
    estaciona: doServidor ? !!doServidor.estaciona : !!espelho?.estaciona,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. O DOCUMENTO - leitura, conferências de DESENHO e arrumação automática
// ════════════════════════════════════════════════════════════════════════════════════════════════

const DOC_VAZIO = { nos: [], arestas: [], variaveis: [] };

// Teto do documento. É o mesmo número do servidor (900 KB), e ele existe porque o nginx à frente
// corta o corpo em 1 MB SEM log e SEM chegar ao Express - a recusa precisa ser nossa e em português.
const TETO_DOCUMENTO = 921600;
function bytesDoDocumento(doc) {
  try { return new Blob([JSON.stringify(doc ?? {})]).size; } catch { return 0; }
}

/** Identificador de nó estável, legível e único no documento. */
function novoIdDeNo(tipo, doc) {
  const usados = new Set((doc?.nos || []).map((n) => n.id));
  let i = 1;
  let id = `no_${tipo}`;
  while (usados.has(id)) { i += 1; id = `no_${tipo}_${i}`; }
  return id;
}

/**
 * ⚠️ Os três tipos que ESTACIONAM nascem com o bloco `excecoes` preenchido e com `esperaResposta`
 * já definida. Não é comodidade: no fluxo real de abertura de chamado, 151 das 518 apresentações
 * caem em "sem resposta" ou "opção inválida". Formulário que deixa esquecer é formulário que
 * garante que metade dos fluxos esquece - e um terço das conversas cai no vazio.
 * A unidade do tempo é escrita SEMPRE: 4 minutos e 4 horas são fluxos diferentes, e o motor recusa
 * inferir (código ESPERA_SEM_UNIDADE).
 */
function excecoesPadrao() {
  return {
    semResposta: {
      tentativas: 2, reforco: 'Ainda está aí? Responda para eu continuar.',
      acaoFinal: 'transferir_time', time: 'Suporte',
    },
    opcaoInvalida: {
      tentativas: 2, reforco: 'Não entendi essa opção. Escolha uma das que apareceram.',
      acaoFinal: 'transferir_time', time: 'Suporte',
    },
  };
}

function configPadrao(tipo) {
  switch (tipo) {
    case 'inicio':    return { emitirProtocolo: false };
    case 'texto':     return { corpo: 'Escreva aqui a mensagem que o cliente vai receber.' };
    case 'midia':     return { url: 'https://', legenda: '' };
    case 'pergunta':  return { corpo: 'Qual é a sua pergunta?', para: 'resposta', higienizar: true, esperaResposta: { valor: 4, unidade: 'minutos' }, excecoes: excecoesPadrao() };
    case 'lista':     return { corpo: 'Escolha uma opção:', rotuloBotao: 'Escolher', itens: [{ id: 'opcao_1', titulo: 'Primeira opção' }], esperaResposta: { valor: 4, unidade: 'minutos' }, excecoes: excecoesPadrao() };
    case 'botoes':    return { corpo: 'Confirma?', botoes: [{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }], esperaResposta: { valor: 4, unidade: 'minutos' }, excecoes: excecoesPadrao() };
    case 'espera':    return { duracao: { valor: 30, unidade: 'segundos' } };
    case 'condicao':  return { combinador: 'e', regras: [{ variavel: '', operador: 'igual', valor: '' }] };
    case 'http':      return { metodo: 'GET', url: 'https://', sucessoQuando: { status: [200] }, extrair: [] };
    case 'variavel':  return { atribuicoes: [{ para: '', operacao: 'definir', de: '' }] };
    case 'etiqueta':  return { aplicar: [], remover: [] };
    case 'time':      return { time: 'Suporte' };
    case 'notificar': return { canal: 'whatsapp', destinatarios: [{ tipo: 'papel', valor: 'plantao' }] };
    // O e-mail nasce com os três obrigatórios VAZIOS de propósito: assunto de exemplo é assunto
    // que chega ao cliente. Vazio o formulário reclama na hora, e a reclamação é o próprio pedido.
    case 'email':     return { para: '', assunto: '', corpo: '' };
    case 'subfluxo':  return { modo: 'chamar', fluxoId: '' };
    case 'chamado':   return { para: 'protocolo', etiquetas: [] };
    case 'encerrar':  return { corpo: 'Obrigado pelo contato!', resolver: true };
    default:          return {};
  }
}

/** Índice (de, saida) -> aresta. A chave natural da aresta é esse par; ela não tem id. */
function indexarArestas(doc) {
  const mapa = new Map();
  const duplicadas = [];
  for (const a of doc?.arestas || []) {
    const chave = `${a.de} ${a.saida}`;
    if (mapa.has(chave)) duplicadas.push(a);
    else mapa.set(chave, a);
  }
  return { mapa, duplicadas };
}

/**
 * Conferências que a TELA pode fazer sozinha - e SÓ estas: são propriedades do desenho, que ela tem
 * na mão. Limite da Meta, tamanho de texto, unidade de contagem e janela de 24 horas, jamais.
 * As três primeiras já são cobradas pelo banco (@@unique) e pelo modo de teste; aqui elas só chegam
 * antes, com a mesma redação.
 */
function conferirDesenho(doc, catalogo) {
  const problemas = [];
  const nos = doc?.nos || [];
  const porId = new Map(nos.map((n) => [n.id, n]));
  const { mapa, duplicadas } = indexarArestas(doc);

  for (const a of duplicadas) {
    problemas.push({
      nivel: 'erro', codigo: 'SAIDA_COM_DUAS_ARESTAS', campo: `${a.de}.${a.saida}`,
      mensagem: `A saída "${rotularSaida(a.saida)}" do nó "${a.de}" tem mais de uma aresta.`,
      comoCorrigir: 'Apague a aresta sobrando: uma saída leva a um destino só. O banco recusa isso na publicação.',
    });
  }
  for (const a of doc?.arestas || []) {
    if (!porId.has(a.para)) {
      problemas.push({
        nivel: 'erro', codigo: 'NO_AUSENTE', campo: `${a.de}.${a.saida}`,
        mensagem: `A saída "${rotularSaida(a.saida)}" do nó "${a.de}" aponta para "${a.para}", que não existe no documento.`,
        comoCorrigir: 'Religue essa saída a um nó existente, ou apague a aresta.',
      });
    }
  }

  // ⚠️ ARESTA FANTASMA — a saída de onde ela parte deixou de existir (o identificador do item de
  // lista foi renomeado, o botão foi removido, o sub-fluxo virou salto). O canvas NÃO a desenha:
  // `visiveis.indexOf(a.saida)` dá -1 e a aresta é pulada em silêncio. Sem linha para tocar e sem
  // pino para clicar, `desligar()` ficava inalcançável — a aresta era gravada no rascunho e ia
  // junto na publicação, calada. Nenhuma das outras conferências a via, porque todas olham para
  // as saídas que EXISTEM, e não para as arestas que sobraram.
  for (const a of doc?.arestas || []) {
    const origem = porId.get(a.de);
    if (!origem) continue;                       // origem inexistente é outro caso, e nem é desenhada
    if (saidasDoNo(origem, catalogo).includes(a.saida)) continue;
    problemas.push({
      nivel: 'erro', codigo: 'SAIDA_INEXISTENTE', campo: `${a.de}.${a.saida}`,
      mensagem: `O nó "${a.de}" já não tem a saída "${rotularSaida(a.saida)}", mas ainda existe uma ligação dela para "${a.para}".`,
      comoCorrigir: 'Essa ligação não aparece no desenho e não dá para tocá-la. Apague-a pelo botão ao lado.',
      acao: { tipo: 'apagarAresta', rotulo: 'Apagar esta ligação', de: a.de, saida: a.saida },
    });
  }
  for (const n of nos) {
    for (const s of saidasDoNo(n, catalogo)) {
      if (!mapa.has(`${n.id} ${s}`)) {
        const especie = especieDaSaida(s);
        problemas.push({
          nivel: especie === 'normal' ? 'erro' : 'aviso',
          codigo: 'ARESTA_AUSENTE', campo: `${n.id}.${s}`,
          mensagem: `A saída "${rotularSaida(s)}" do nó "${n.id}" não leva a lugar nenhum.`,
          comoCorrigir: especie === 'falha'
            ? 'Sem destino aqui, quem escrever fora da janela de 24 horas recebe silêncio absoluto.'
            : 'Toque no conector e depois no nó de destino para ligar.',
        });
      }
    }
  }
  // Alcance a partir do início. Nó inalcançável é diagnóstico, não enfeite.
  const inicio = nos.find((n) => n.tipo === 'inicio')?.id || nos[0]?.id;
  if (inicio) {
    const vistos = new Set([inicio]);
    const fila = [inicio];
    while (fila.length) {
      const atual = fila.shift();
      for (const a of doc?.arestas || []) {
        if (a.de === atual && porId.has(a.para) && !vistos.has(a.para)) { vistos.add(a.para); fila.push(a.para); }
      }
    }
    for (const n of nos) {
      if (!vistos.has(n.id)) {
        problemas.push({
          nivel: 'aviso', codigo: 'NO_INALCANCAVEL', campo: n.id,
          mensagem: `O nó "${n.id}" não é alcançável a partir do início.`,
          comoCorrigir: 'Ligue alguma saída até ele, ou apague-o.',
        });
      }
    }
  }
  return problemas;
}

/**
 * Arrumação automática, determinística: varredura em largura a partir do `inicio`.
 * Coluna = profundidade, linha = ordem de chegada dentro da profundidade, EM SERPENTINA: a cada
 * COLUNAS_POR_FAIXA colunas a arrumação quebra para uma faixa nova, logo abaixo. Os inalcançáveis
 * ficam numa faixa própria no fim - o que já é um diagnóstico de graça.
 * O mesmo documento dá sempre o mesmo desenho, então dois operadores veem a mesma coisa.
 */
const PASSO_X = 320;
const PASSO_Y = 176;
// Quantas colunas cabem numa faixa antes de a arrumação quebrar a linha. Seis colunas de 320 px
// dão ~1.960 px de mundo: cabe inteiro num monitor comum e, no celular, num zoom ainda legível.
const COLUNAS_POR_FAIXA = 6;

function arrumar(doc, catalogo) {
  const nos = doc?.nos || [];
  if (!nos.length) return doc;
  const porId = new Map(nos.map((n) => [n.id, n]));
  const inicio = nos.find((n) => n.tipo === 'inicio')?.id || nos[0].id;

  const profundidade = new Map([[inicio, 0]]);
  const fila = [inicio];
  while (fila.length) {
    const atual = fila.shift();
    const p = profundidade.get(atual);
    // Percorre pelas saídas na ordem canônica do nó, e não pela ordem em que as arestas foram
    // desenhadas - é isso que torna o desenho reproduzível entre duas máquinas.
    for (const s of saidasDoNo(porId.get(atual), catalogo)) {
      const a = (doc.arestas || []).find((x) => x.de === atual && x.saida === s);
      if (a && porId.has(a.para) && !profundidade.has(a.para)) {
        profundidade.set(a.para, p + 1);
        fila.push(a.para);
      }
    }
  }
  const porColuna = new Map();
  const orfaos = [];
  for (const n of nos) {
    if (profundidade.has(n.id)) {
      const c = profundidade.get(n.id);
      if (!porColuna.has(c)) porColuna.set(c, []);
      porColuna.get(c).push(n.id);
    } else orfaos.push(n.id);
  }
  // ⚠️ SERPENTINA, e não uma coluna por profundidade. O fluxo real de abertura de chamado é quase
  // linear (nó 1 → 2 → … → 29): com x = 40 + coluna × 320 ele virava uma faixa de ~9.600 px de
  // largura. Nenhuma escala que coubesse nessa largura deixava o texto legível — o botão «Ajustar
  // à tela» só podia mentir. Quebrando a cada COLUNAS_POR_FAIXA, a mesma cadeia vira um bloco
  // largo e baixo, que cabe numa tela de verdade, inclusive de celular.
  const faixaDe = (c) => Math.floor(c / COLUNAS_POR_FAIXA);
  const linhasPorFaixa = new Map();
  for (const [c, ids] of porColuna) {
    const f = faixaDe(c);
    linhasPorFaixa.set(f, Math.max(linhasPorFaixa.get(f) || 1, ids.length));
  }
  const yDaFaixa = new Map();
  let alturaAcumulada = 0;
  for (const f of [...linhasPorFaixa.keys()].sort((a, b) => a - b)) {
    yDaFaixa.set(f, alturaAcumulada);
    alturaAcumulada += (linhasPorFaixa.get(f) + 1) * PASSO_Y;   // o +1 é o respiro entre faixas
  }
  const posicoes = new Map();
  for (const [c, ids] of porColuna) {
    const x = 40 + (c % COLUNAS_POR_FAIXA) * PASSO_X;
    const yBase = 40 + (yDaFaixa.get(faixaDe(c)) || 0);
    ids.forEach((id, i) => posicoes.set(id, { x, y: yBase + i * PASSO_Y }));
  }
  // Inalcançáveis numa faixa própria, abaixo de tudo: o afastamento já é o diagnóstico.
  orfaos.forEach((id, i) => posicoes.set(id, {
    x: 40 + (i % COLUNAS_POR_FAIXA) * PASSO_X,
    y: 40 + alturaAcumulada + Math.floor(i / COLUNAS_POR_FAIXA) * PASSO_Y,
  }));

  return { ...doc, nos: nos.map((n) => ({ ...n, ui: { ...(n.ui || {}), ...posicoes.get(n.id) } })) };
}

/** Todo nó precisa de `ui`. Documento vindo de fora (ou criado por script) chega sem. */
function garantirPosicoes(doc, catalogo) {
  const nos = doc?.nos || [];
  const faltaAlgum = nos.some((n) => !n.ui || typeof n.ui.x !== 'number' || typeof n.ui.y !== 'number');
  if (!faltaAlgum) return doc;
  return arrumar(doc, catalogo);
}

// Formatação de data/hora no fuso do dono (UTC-3). Fortaleza, e não São Paulo: as duas marcam
// UTC-3 hoje, mas só Fortaleza continua em UTC-3 se o horário de verão voltar.
function fmtHora(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}
function fmtRelativo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)}min`;
  if (s < 86400) return `há ${Math.round(s / 3600)}h`;
  return fmtHora(iso);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. PEÇAS VISUAIS PEQUENAS, COMPARTILHADAS
// ════════════════════════════════════════════════════════════════════════════════════════════════

function Etiqueta({ tom = 'neutro', children, titulo }) {
  const tons = {
    ok: { bg: T.okDim, fg: T.ok }, aviso: { bg: T.avisoDim, fg: T.aviso },
    erro: { bg: T.perigoDim, fg: T.perigo }, info: { bg: T.infoDim, fg: T.info },
    neutro: { bg: T.sup, fg: T.mut },
  };
  const t = tons[tom] || tons.neutro;
  return (
    <span title={titulo} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      background: t.bg, color: t.fg, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/**
 * Faixa de recado. `tom` decide a cor, mas o ÍCONE e a palavra dizem a mesma coisa - severidade
 * nunca viaja só na cor nesta casa (e num canvas colorido ela viaja ainda pior).
 */
function Faixa({ tom = 'info', titulo, children, acoes }) {
  const cores = {
    info: { borda: T.info, fundo: T.infoDim, Icone: Info },
    aviso: { borda: T.aviso, fundo: T.avisoDim, Icone: AlertTriangle },
    erro: { borda: T.perigo, fundo: T.perigoDim, Icone: AlertTriangle },
    ok: { borda: T.ok, fundo: T.okDim, Icone: CheckCircle },
  };
  const c = cores[tom] || cores.info;
  const { Icone } = c;
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10,
      border: `1px solid ${c.borda}`, background: c.fundo, color: T.ink, fontSize: '0.82rem',
    }}>
      <Icone size={16} style={{ flexShrink: 0, marginTop: 2, color: c.borda }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {titulo ? <div style={{ fontWeight: 800, marginBottom: 2 }}>{titulo}</div> : null}
        <div style={{ color: T.sec }}>{children}</div>
      </div>
      {acoes ? <div style={{ flexShrink: 0 }}>{acoes}</div> : null}
    </div>
  );
}

function Vazio({ children }) {
  return (
    <div style={{
      padding: 20, textAlign: 'center', color: T.mut, fontSize: '0.85rem',
      border: `1px dashed ${T.borda}`, borderRadius: 10,
    }}>{children}</div>
  );
}

function Rotulo({ children, dica }) {
  return (
    <label style={rotuloEstilo}>
      {children}
      {dica ? <span style={{ textTransform: 'none', fontWeight: 500, color: T.mut, marginLeft: 6 }}>{dica}</span> : null}
    </label>
  );
}

function Interruptor({ marcado, aoMudar, children }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, cursor: 'pointer',
      fontSize: '0.84rem', color: T.ink,
    }}>
      <input
        type="checkbox"
        checked={!!marcado}
        onChange={(ev) => aoMudar(ev.target.checked)}
        style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * AVISO DE LIMITE - lê o que o SERVIDOR mediu; nunca conta nada por conta própria.
 * O texto diz o modo de falha REAL: a Meta recusa a mensagem INTEIRA, não entrega o que cabe.
 * A `origem` do perfil aparece sempre: enquanto ela for 'documentacao', o número é palpite
 * assumido, e aviso que se declara palpite não corrói a confiança nos avisos que são regra.
 */
function AvisoDeLimite({ medido, teto, oQueE, origemDoPerfil, unidadeDeContagem }) {
  if (!Number.isFinite(medido) || !Number.isFinite(teto) || teto <= 0) return null;
  const razao = medido / teto;
  const cor = razao > 1 ? T.perigo : razao >= 0.8 ? T.aviso : T.borda2;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: T.mut, marginBottom: 3 }}>
        <span>{oQueE}</span>
        <span style={{ color: cor, fontWeight: 700 }}>{medido} / {teto}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: T.sup, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, razao * 100)}%`, height: '100%', background: cor }} />
      </div>
      {razao > 1 ? (
        <div style={{ fontSize: '0.72rem', color: T.perigo, marginTop: 4 }}>
          Passou do teto. A Meta recusa a mensagem INTEIRA — ela não entrega só o que cabe.
        </div>
      ) : null}
      <div style={{ fontSize: '0.68rem', color: T.mut, marginTop: 3 }}>
        Perfil medido pelo servidor
        {origemDoPerfil ? ` (origem: ${origemDoPerfil === 'documentacao' ? 'documentação da Meta, palpite assumido' : origemDoPerfil})` : ''}
        {unidadeDeContagem && unidadeDeContagem !== 'indefinida' ? ` · contagem em ${unidadeDeContagem}` : ' · contagem pelo pior caso das três unidades'}.
      </div>
    </div>
  );
}

/**
 * CAMPO DE ESPERA - número e unidade. A unidade NUNCA tem padrão silencioso: 4 minutos e 4 horas
 * são fluxos diferentes, e o motor recusa inferir (código ESPERA_SEM_UNIDADE).
 */
const UNIDADES = ['segundos', 'minutos', 'horas', 'dias'];

function CampoDeEspera({ valor, obrigatorio, aoMudar, rotulo = 'Quanto tempo esperar a resposta' }) {
  const v = valor || {};
  const semUnidade = !v.unidade;
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={obrigatorio ? '(obrigatório)' : null}>{rotulo}</Rotulo>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number" min={1} value={v.valor ?? ''}
          onChange={(ev) => aoMudar({ ...v, valor: ev.target.value === '' ? null : Number(ev.target.value) })}
          style={{ ...campoEstilo, width: 100 }}
        />
        <select
          value={v.unidade || ''}
          onChange={(ev) => aoMudar({ ...v, unidade: ev.target.value || undefined })}
          style={{ ...campoEstilo, flex: 1 }}
        >
          <option value="">— escolha a unidade —</option>
          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {semUnidade ? (
        <div style={{ fontSize: '0.72rem', color: T.aviso, marginTop: 4 }}>
          A unidade é obrigatória. O motor não infere: 4 minutos e 4 horas são fluxos diferentes.
        </div>
      ) : null}
    </div>
  );
}

/**
 * BLOCO DE EXCEÇÕES - o componente mais importante desta tela.
 * 151 das 518 apresentações do fluxo real de abertura de chamado caem aqui. Ausência do bloco é
 * ERRO no motor, de código LACO_DE_EXCECAO_SEM_TETO, e o teto de tentativas existe para tirar do
 * laço o poder de moer a conversa do cliente.
 */
const ACOES_FINAIS = [
  { valor: 'transferir_time', rotulo: 'Encaminhar para um time humano' },
  { valor: 'ir_para_no', rotulo: 'Ir para outro nó do fluxo' },
  { valor: 'encerrar', rotulo: 'Encerrar a conversa' },
  { valor: 'seguir_saida', rotulo: 'Seguir pela saída correspondente' },
];

function CartaoDeExcecao({ titulo, explicacao, dados, nosDisponiveis, aoMudar }) {
  const d = dados || {};
  const precisaTime = d.acaoFinal === 'transferir_time';
  const precisaNo = d.acaoFinal === 'ir_para_no';
  const semAcao = !d.acaoFinal;
  return (
    <div style={{ border: `1px solid ${semAcao ? T.aviso : T.borda}`, borderRadius: 10, padding: 12, background: T.sup }}>
      <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 2 }}>{titulo}</div>
      <div style={{ fontSize: '0.74rem', color: T.mut, marginBottom: 10 }}>{explicacao}</div>

      <Rotulo dica="0 a 10">Quantas vezes insistir antes de desistir</Rotulo>
      <input
        type="number" min={0} max={10} value={d.tentativas ?? 2}
        onChange={(ev) => aoMudar({ ...d, tentativas: Math.max(0, Math.min(10, Number(ev.target.value) || 0)) })}
        style={{ ...campoEstilo, marginBottom: 10 }}
      />

      <Rotulo>Texto de reforço (o que dizer a cada nova tentativa)</Rotulo>
      <textarea
        rows={2} value={d.reforco || ''}
        onChange={(ev) => aoMudar({ ...d, reforco: ev.target.value })}
        style={{ ...campoEstilo, marginBottom: 10, resize: 'vertical' }}
      />

      <Rotulo dica="(obrigatório)">O que fazer quando as tentativas acabarem</Rotulo>
      <select
        value={d.acaoFinal || ''}
        onChange={(ev) => aoMudar({ ...d, acaoFinal: ev.target.value || undefined })}
        style={{ ...campoEstilo, marginBottom: precisaTime || precisaNo ? 10 : 0 }}
      >
        <option value="">— escolha —</option>
        {ACOES_FINAIS.map((a) => <option key={a.valor} value={a.valor}>{a.rotulo}</option>)}
      </select>

      {precisaTime ? (
        <>
          <Rotulo dica="(exigido por esta ação)">Time que recebe a conversa</Rotulo>
          <input
            value={d.time || ''}
            onChange={(ev) => aoMudar({ ...d, time: ev.target.value })}
            style={campoEstilo}
          />
        </>
      ) : null}
      {precisaNo ? (
        <>
          <Rotulo dica="(exigido por esta ação)">Nó de destino</Rotulo>
          <select value={d.no || ''} onChange={(ev) => aoMudar({ ...d, no: ev.target.value })} style={campoEstilo}>
            <option value="">— escolha o nó —</option>
            {nosDisponiveis.map((n) => (
              <option key={n.id} value={n.id}>{n.titulo ? `${n.titulo} (${n.id})` : n.id}</option>
            ))}
          </select>
        </>
      ) : null}

      {semAcao ? (
        <div style={{ fontSize: '0.72rem', color: T.aviso, marginTop: 8 }}>
          Sem ação final, o motor recusa o nó na publicação (LACO_DE_EXCECAO_SEM_TETO).
        </div>
      ) : null}
    </div>
  );
}

function BlocoDeExcecoes({ excecoes, nosDisponiveis, aoMudar }) {
  const e = excecoes || {};
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Faixa tom="info" titulo="Por que este bloco existe">
        No fluxo real de abertura de chamado, 151 das 518 apresentações caem em uma destas duas
        saídas. Sem destino aqui, quase um terço das conversas termina no vazio.
      </Faixa>
      <CartaoDeExcecao
        titulo="Sem resposta"
        explicacao="O cliente viu a mensagem e não respondeu dentro do tempo de espera."
        dados={e.semResposta}
        nosDisponiveis={nosDisponiveis}
        aoMudar={(v) => aoMudar({ ...e, semResposta: v })}
      />
      <CartaoDeExcecao
        titulo="Opção inválida"
        explicacao="O cliente respondeu, mas com algo que não casa com nenhuma opção oferecida."
        dados={e.opcaoInvalida}
        nosDisponiveis={nosDisponiveis}
        aoMudar={(v) => aoMudar({ ...e, opcaoInvalida: v })}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. O RASCUNHO - dono ÚNICO de `documento`, `rev`, `sujo`, `salvando` e `conflito`
//
// ⚠️ O 409 NÃO DESCARTA O QUE ESTÁ NA TELA. Quando outra pessoa grava o rascunho depois que este
// operador o abriu, o salvamento automático PARA e a decisão vai para o operador: recarregar
// (perdendo o dele) ou continuar editando em memória. Perder trabalho em silêncio para "resolver"
// um conflito é o defeito, não a solução.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function useRascunhoDeFluxo(fluxoId, catalogo) {
  const [fluxo, setFluxo] = useState(null);
  const [versaoPublicada, setVersaoPublicada] = useState(null);
  const [totalVersoes, setTotalVersoes] = useState(0);
  const [documento, setDocumento] = useState(DOC_VAZIO);
  const [rev, setRev] = useState(null);
  // `semRascunho` NÃO é o mesmo que «documento vazio». O backend admite os dois estados: `GET
  // /fluxos/:id` devolve `rascunho: null`, e `GET /fluxos/:id/rascunho` responde 404 «Este fluxo
  // não tem rascunho.». Sem distingui-los, um fluxo com 35 nós publicados e sem linha em
  // RagnabotFluxoRascunho (restauração de dump, criação por outro caminho, migração) abria como
  // canvas em branco — estado vazio lido como verdade — e tudo o que o operador desenhasse em cima
  // era descartado ao sair, porque `salvarAgora` não tinha revisão para gravar.
  const [semRascunho, setSemRascunho] = useState(false);
  const [criandoRascunho, setCriandoRascunho] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [ultimoSalvamentoEm, setUltimoSalvamentoEm] = useState(null);
  const [conflito, setConflito] = useState(null);
  // Desligar o salvamento automático é estado PRÓPRIO, e não «conflito limpo». Enquanto os dois
  // eram a mesma coisa, "Continuar editando o meu" limpava `conflito`, o efeito de recuo voltava a
  // valer, o mesmo `rev` recusado era reenviado e o 409 voltava 800 ms depois — para sempre.
  const [autoSalvamentoPausado, setAutoSalvamentoPausado] = useState(false);
  const [erro, setErro] = useState(null);
  const [avisoDoServidor, setAvisoDoServidor] = useState(null);
  const [carregando, setCarregando] = useState(true);

  // Refs para o salvamento com recuo enxergar o valor ATUAL sem virar dependência do efeito.
  const refDoc = useRef(documento);
  const refRev = useRef(rev);
  const refConflito = useRef(conflito);
  const refVersaoPublicada = useRef(versaoPublicada);
  // O catálogo entra por ref, e NÃO como dependência de `recarregar`: quando ele chegasse do
  // servidor (segundos depois da abertura), `recarregar` mudaria de identidade, o efeito rodaria
  // de novo e o rascunho seria relido POR CIMA do que o operador já tivesse desenhado.
  const refCatalogo = useRef(catalogo);
  refDoc.current = documento; refRev.current = rev; refConflito.current = conflito;
  refVersaoPublicada.current = versaoPublicada;
  refCatalogo.current = catalogo;
  const temporizador = useRef(null);

  // ⚠️ A ÚLTIMA REVISÃO QUE O SERVIDOR CONFIRMOU PARA ESTA ABA. É ela — e não a que acabamos de
  // enviar — que distingue «outra pessoa gravou» de «eu mesmo disparei duas gravações». Sem esse
  // dado, um 409 causado pela própria aba era anunciado como trabalho de terceiro, e a saída
  // oferecida («Recarregar, perco o meu») descartava trabalho real por um conflito inexistente.
  const refUltimaRevConfirmada = useRef(null);

  // ⚠️ FILA DE UM. `salvando` é estado e só vale depois da renderização; ele NUNCA serviu de trava.
  // Com link lento, o PUT nº 1 (rev 7) ainda estava no ar quando o recuo disparava o PUT nº 2 —
  // também com rev 7, porque a resposta do primeiro não tinha chegado. O `updateMany where rev:7`
  // casava uma vez só e o segundo voltava 409. Agora a segunda gravação ESPERA a primeira e só
  // então lê `refRev`/`refDoc`, que já estarão atualizados.
  const promessaEmVoo = useRef(null);

  const recarregar = useCallback(async () => {
    if (!fluxoId) return;
    setCarregando(true);
    try {
      const r = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}`);
      setFluxo(r.fluxo || null);
      setVersaoPublicada(r.versaoPublicada || null);
      refVersaoPublicada.current = r.versaoPublicada || null;
      setTotalVersoes(Number(r.totalVersoes) || 0);
      const temRascunho = !!(r.rascunho && typeof r.rascunho === 'object');
      setSemRascunho(!temRascunho);
      const doc = temRascunho && r.rascunho.documento && typeof r.rascunho.documento === 'object'
        ? r.rascunho.documento
        : DOC_VAZIO;
      // A arrumação automática roda na ABERTURA de documento sem `ui`, mas NÃO marca o rascunho
      // como sujo: abrir para ler não pode sujar o rascunho de ninguém. As posições só vão para o
      // servidor quando o operador mudar alguma coisa de verdade.
      setDocumento(garantirPosicoes({ nos: [], arestas: [], variaveis: [], ...doc }, refCatalogo.current));
      const revLida = temRascunho && Number.isInteger(r.rascunho.rev) ? r.rascunho.rev : null;
      setRev(revLida);
      refRev.current = revLida;
      refUltimaRevConfirmada.current = revLida;
      setSujo(false);
      setConflito(null);
      refConflito.current = null;
      setAutoSalvamentoPausado(false);
      setErro(null);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [fluxoId]);

  useEffect(() => { recarregar(); }, [recarregar]);

  /**
   * A gravação em si. Fica separada de `salvarAgora` porque as guardas precisam ser reavaliadas
   * DEPOIS de a gravação anterior terminar (ela pode ter mudado `rev` ou aberto um conflito).
   */
  const gravar = useCallback(async ({ forcar }) => {
    if (refRev.current == null) {
      // ⚠️ Nunca sair calada. Antes, `if (!fluxoId || refRev.current == null || ...) return;` fazia o
      // botão "Salvar" virar um nada silencioso num fluxo sem rascunho: o operador desenhava horas,
      // nenhuma faixa aparecia, e o trabalho evaporava ao voltar para a lista.
      const motivo = 'Este fluxo não tem rascunho gravado no servidor, então não existe revisão para gravar por cima. Crie o rascunho antes de editar.';
      setErro(new Error(motivo));
      return { ok: false, motivo };
    }
    if (refConflito.current && !forcar) {
      const motivo = 'O servidor recusou a gravação anterior por revisão desatualizada. Resolva isso na faixa acima antes de gravar de novo.';
      setErro(new Error(motivo));
      return { ok: false, motivo };
    }
    // Guardamos a identidade do documento enviado: se o operador desenhar mais alguma coisa
    // ENQUANTO o PUT viaja, marcar `sujo = false` no retorno esconderia essa alteração nova.
    const docEnviado = refDoc.current;
    setSalvando(true);
    try {
      const r = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/rascunho`, {
        metodo: 'PUT', corpo: { documento: docEnviado, rev: refRev.current },
      });
      if (typeof r.rev === 'number') {
        setRev(r.rev);
        // Atribuição IMEDIATA, e não só na próxima renderização: a gravação encadeada logo atrás
        // desta roda no microtask seguinte, antes de o React renderizar, e leria o `rev` velho.
        refRev.current = r.rev;
        refUltimaRevConfirmada.current = r.rev;
      }
      setSujo(refDoc.current !== docEnviado);
      setUltimoSalvamentoEm(new Date().toISOString());
      setAvisoDoServidor(r.aviso || null);
      setConflito(null);
      refConflito.current = null;
      setAutoSalvamentoPausado(false);
      setErro(null);
      return { ok: true };
    } catch (e) {
      if (e.status === 409) {
        const revAtual = Number.isInteger(Number(e.dados?.revAtual)) ? Number(e.dados.revAtual) : null;
        const revEnviada = Number.isInteger(Number(e.dados?.revEnviada)) ? Number(e.dados.revEnviada) : refRev.current;
        // ⚠️ «Outra pessoa» só quando o servidor DIZ qual é a revisão vigente e ela não é a última
        // que ele mesmo nos confirmou. O caminho de `salvarRascunho()` do serviço de publicação
        // devolve só `{ error }` — sem esse dado, a faixa dizia «a revisão que enviei foi undefined».
        const outraPessoa = revAtual != null
          && refUltimaRevConfirmada.current != null
          && revAtual !== refUltimaRevConfirmada.current;
        const novo = { revEnviada, revAtual, outraPessoa, aceito: false, mensagemDoServidor: e.message };
        setConflito(novo);
        refConflito.current = novo;
        return { ok: false, conflito: true, motivo: e.message };
      }
      setErro(e);
      return { ok: false, motivo: e.message };
    } finally {
      setSalvando(false);
    }
  }, [fluxoId]);

  const salvarAgora = useCallback(async ({ forcar = false } = {}) => {
    if (!fluxoId) {
      const motivo = 'Nenhum fluxo aberto — não havia o que gravar.';
      setErro(new Error(motivo));
      return { ok: false, motivo };
    }
    const anterior = promessaEmVoo.current;
    const minha = (async () => {
      if (anterior) { try { await anterior; } catch { /* quem gravou já tratou o próprio erro */ } }
      return gravar({ forcar });
    })();
    promessaEmVoo.current = minha.finally(() => {
      if (promessaEmVoo.current === minha) promessaEmVoo.current = null;
    });
    return minha;
  }, [fluxoId, gravar]);

  // Recuo de 800 ms depois da última alteração. Em conflito — ou com o autosave pausado a pedido
  // do operador — ele NÃO reata sozinho: reatar seria escrever por cima do trabalho da outra
  // pessoa sem ninguém decidir.
  useEffect(() => {
    if (!sujo || conflito || autoSalvamentoPausado || rev == null) return undefined;
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { salvarAgora(); }, 800);
    return () => { if (temporizador.current) clearTimeout(temporizador.current); };
  }, [sujo, documento, conflito, autoSalvamentoPausado, rev, salvarAgora]);

  const mudar = useCallback((fn) => {
    setDocumento((atual) => {
      const proximo = fn(atual);
      return proximo === atual ? atual : proximo;
    });
    setSujo(true);
  }, []);

  const alterarNo = useCallback((noId, remendo) => {
    mudar((d) => ({
      ...d,
      nos: (d.nos || []).map((n) => (n.id === noId ? { ...n, ...remendo, config: remendo.config ? { ...n.config, ...remendo.config } : n.config } : n)),
    }));
  }, [mudar]);

  /**
   * Substituição INTEIRA da config (usada quando o formulário remove uma chave, como o item de
   * lista apagado): o `alterarNo` funde e nunca apagaria a chave que sumiu.
   *
   * ⚠️ AQUI TAMBÉM SE PODA A ARESTA FANTASMA. As saídas de `lista` e `botoes` SÃO os `id` dos
   * itens, e esses `id` são campos de texto livres. Renomear ou remover um item deixava para trás
   * uma aresta que o canvas não desenhava, a conferência não via e ninguém conseguia apagar — e
   * ela ia gravada e publicada.
   *
   * ⚠️ RENOMEAR NÃO É REMOVER, e a diferença é o que torna esta poda usável: trocar o
   * identificador acontece TECLA A TECLA (`botao_2` → `botao_` → … → `confirmar`). Podar a cada
   * tecla apagaria a ligação no primeiro caractere digitado. Quando some exatamente uma saída e
   * nasce exatamente uma, é renomeação e a aresta MIGRA junto; nos demais casos ela é removida, e
   * quem chamou recebe a lista para avisar o operador em vez de fazê-lo calado.
   */
  const trocarConfig = useCallback((noId, config) => {
    const doc = refDoc.current;
    const antigo = (doc.nos || []).find((n) => n.id === noId);
    if (!antigo) return { renomeadas: [], removidas: [] };
    const antes = saidasDoNo(antigo, refCatalogo.current);
    const depois = saidasDoNo({ ...antigo, config }, refCatalogo.current);
    const sumiram = antes.filter((s) => !depois.includes(s));
    const surgiram = depois.filter((s) => !antes.includes(s));
    const destinoJaOcupado = (doc.arestas || []).some((a) => a.de === noId && a.saida === surgiram[0]);
    const ehRenomeacao = sumiram.length === 1 && surgiram.length === 1
      && antes.length === depois.length && !destinoJaOcupado;

    const renomeadas = [];
    const removidas = [];
    for (const a of doc.arestas || []) {
      if (a.de !== noId || depois.includes(a.saida)) continue;
      if (ehRenomeacao && a.saida === sumiram[0]) renomeadas.push({ de: sumiram[0], para: surgiram[0], destino: a.para });
      else removidas.push(a);
    }
    const foraDeCombate = new Set(removidas.map((a) => `${a.de} ${a.saida}`));

    mudar((d) => {
      const nos = (d.nos || []).map((n) => (n.id === noId ? { ...n, config } : n));
      let arestas = d.arestas || [];
      if (renomeadas.length) {
        arestas = arestas.map((a) => (a.de === noId && a.saida === sumiram[0] ? { ...a, saida: surgiram[0] } : a));
      }
      if (foraDeCombate.size) {
        arestas = arestas.filter((a) => !foraDeCombate.has(`${a.de} ${a.saida}`));
      }
      return { ...d, nos, arestas };
    });
    return { renomeadas, removidas };
  }, [mudar]);

  const moverNo = useCallback((noId, pos) => {
    mudar((d) => ({
      ...d,
      nos: (d.nos || []).map((n) => (n.id === noId ? { ...n, ui: { ...(n.ui || {}), x: Math.round(pos.x), y: Math.round(pos.y) } } : n)),
    }));
  }, [mudar]);

  // ⚠️ O identificador é calculado ANTES de `mudar`, a partir do documento atual (refDoc), e NÃO
  // dentro do atualizador de estado. Atualizador do React é preguiçoso: ele roda na renderização,
  // não na chamada — um `idNovo` atribuído lá dentro ainda valia `null` no `return` daqui, e quem
  // chamava recebia null e selecionava coisa nenhuma. O mesmo vale para `duplicarNo`.
  const acrescentarNo = useCallback((tipo, pos) => {
    const idNovo = novoIdDeNo(tipo, refDoc.current);
    const meta = CATALOGO_ESPELHO[tipo];
    mudar((d) => ({
      ...d,
      nos: [...(d.nos || []), {
        id: idNovo, tipo, titulo: meta?.rotulo || tipo,
        config: configPadrao(tipo),
        ui: { x: Math.round(pos?.x ?? 60), y: Math.round(pos?.y ?? 60) },
      }],
    }));
    return idNovo;
  }, [mudar]);

  // ⚠️ Apagar o nó apaga TODAS as arestas que o citam, em `de` E em `para`. Sem isso o documento
  // nasce com aresta órfã, que passa no rascunho e só explode na publicação.
  const apagarNo = useCallback((noId) => {
    mudar((d) => ({
      ...d,
      nos: (d.nos || []).filter((n) => n.id !== noId),
      arestas: (d.arestas || []).filter((a) => a.de !== noId && a.para !== noId),
    }));
  }, [mudar]);

  const duplicarNo = useCallback((noId) => {
    const original = (refDoc.current.nos || []).find((n) => n.id === noId);
    if (!original) return null;
    const idNovo = novoIdDeNo(original.tipo, refDoc.current);
    const copia = {
      ...original, id: idNovo,
      titulo: original.titulo ? `${original.titulo} (cópia)` : idNovo,
      config: JSON.parse(JSON.stringify(original.config || {})),
      ui: { x: (original.ui?.x || 0) + 40, y: (original.ui?.y || 0) + 40 },
    };
    // A cópia nasce SEM as arestas de saída do original, de propósito: copiar as ligações criaria
    // dois nós disputando os mesmos destinos, e o operador não pediu isso.
    mudar((d) => ({ ...d, nos: [...(d.nos || []), copia] }));
    return idNovo;
  }, [mudar]);

  /**
   * ⚠️ Uma saída leva a UM destino só. O banco tem @@unique([versaoId, de, saida]) e recusa a
   * segunda aresta na PUBLICAÇÃO - depois de o operador achar que tinha terminado. A tela recusa
   * na hora do desenho, e devolve o motivo escrito.
   */
  const ligar = useCallback((de, saida, para) => {
    if (!de || !saida || !para) return { ok: false, motivo: 'Faltou origem, saída ou destino.' };
    if (de === para) return { ok: false, motivo: 'Um nó não pode ligar a si mesmo por esta saída.' };
    const jaExiste = (refDoc.current.arestas || []).some((a) => a.de === de && a.saida === saida);
    if (jaExiste) {
      return {
        ok: false,
        motivo: `A saída "${rotularSaida(saida)}" já tem destino. Apague a ligação atual antes de criar outra — o banco recusa duas arestas na mesma saída.`,
      };
    }
    mudar((d) => ({ ...d, arestas: [...(d.arestas || []), { de, saida, para }] }));
    return { ok: true };
  }, [mudar]);

  const desligar = useCallback((de, saida) => {
    mudar((d) => ({ ...d, arestas: (d.arestas || []).filter((a) => !(a.de === de && a.saida === saida)) }));
  }, [mudar]);

  const arrumarTudo = useCallback(() => {
    mudar((d) => arrumar(d, catalogo));
  }, [mudar, catalogo]);

  /**
   * Cria o rascunho ausente a partir da versão publicada (ou em branco, se não houver versão).
   * Enquanto `ragnabot-fluxo-publicacao.service.js` não subir, o servidor só tem a retaguarda com
   * `updateMany`, que grava por cima de um rascunho EXISTENTE e não cria nenhum — por isso o
   * fracasso aqui é anunciado com o motivo real, e não como falha do operador.
   */
  const criarRascunhoDaPublicada = useCallback(async () => {
    if (!fluxoId) return { ok: false, motivo: 'Nenhum fluxo aberto.' };
    setCriandoRascunho(true);
    setErro(null);
    try {
      const publicada = refVersaoPublicada.current;
      const base = publicada?.documento && typeof publicada.documento === 'object'
        ? publicada.documento
        : { nos: [], arestas: [], variaveis: [] };
      await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/rascunho`, {
        metodo: 'PUT', corpo: { documento: base, rev: 0 },
      });
      await recarregar();
      return { ok: true, deOnde: publicada ? `versão ${publicada.numero}` : 'documento em branco' };
    } catch (e) {
      const motivo = (e.status === 409 || e.status === 404)
        ? `${e.message} A rota PUT /fluxos/:id/rascunho só grava POR CIMA de um rascunho já existente; criar um do zero depende de salvarRascunho() do serviço de publicação, que ainda não está neste servidor. Enquanto isso este fluxo não pode ser editado por aqui.`
        : e.message;
      setErro(new Error(motivo));
      return { ok: false, motivo };
    } finally { setCriandoRascunho(false); }
  }, [fluxoId, recarregar]);

  const resolverConflito = useCallback(async (como) => {
    if (como === 'recarregar') {
      setConflito(null);
      refConflito.current = null;
      setAutoSalvamentoPausado(false);
      await recarregar();
      return { ok: true };
    }
    if (como === 'continuar') {
      // ⚠️ NÃO limpamos `conflito`. Limpá-lo reabilitava a condição do efeito de recuo, que
      // reenviava o MESMO `rev` já recusado: o 409 voltava em 800 ms, indefinidamente. O que
      // marcamos aqui é que o operador leu o recado; o autosave segue desligado por
      // `autoSalvamentoPausado`, e a gravação volta a ser decisão dele.
      setAutoSalvamentoPausado(true);
      setConflito((c) => (c ? { ...c, aceito: true } : c));
      setSujo(true);
      return { ok: true };
    }
    if (como === 'enviarMesmoAssim') {
      // Relê a revisão VIGENTE antes de gravar. Sem isso, «enviar mesmo assim» reenvia exatamente
      // a revisão que o servidor acabou de recusar, e o 409 se repete.
      try {
        const atual = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/rascunho`);
        if (!Number.isInteger(atual?.rev)) {
          throw new Error('O servidor não devolveu a revisão vigente do rascunho; não dá para gravar por cima às cegas.');
        }
        setRev(atual.rev);
        refRev.current = atual.rev;
        refUltimaRevConfirmada.current = atual.rev;
        const resultado = await salvarAgora({ forcar: true });
        if (resultado.ok) {
          setConflito(null);
          refConflito.current = null;
          setAutoSalvamentoPausado(false);
        }
        return resultado;
      } catch (e) {
        setErro(e);
        return { ok: false, motivo: e.message };
      }
    }
    return { ok: false, motivo: 'Ação de conflito desconhecida.' };
  }, [recarregar, fluxoId, salvarAgora]);

  return {
    fluxo, setFluxo, versaoPublicada, totalVersoes, documento, rev, sujo, salvando,
    ultimoSalvamentoEm, conflito, autoSalvamentoPausado, erro, avisoDoServidor, carregando,
    semRascunho, criandoRascunho, criarRascunhoDaPublicada,
    alterarNo, trocarConfig, moverNo, acrescentarNo, apagarNo, duplicarNo,
    ligar, desligar, arrumarTudo, salvarAgora, recarregar, resolverConflito,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. A TELA DO FLUXO (o canvas)
//
// DOM + SVG NO MESMO TRANSFORM, e não <canvas>. Os blocos precisam de texto real, foco por teclado,
// botões e leitura por leitor de tela - coisas que <canvas> não tem e que teriam de ser
// reinventadas. E como a camada de linhas e a de blocos compartilham o MESMO transform, não existe
// o defeito clássico da linha andar meio pixel diferente do bloco em zoom fracionário.
//
// ARRASTAR SEM BIBLIOTECA NOVA: eventos de ponteiro nativos com `setPointerCapture`. Um caminho de
// código serve mouse, dedo e caneta, e a captura garante que soltar fora do bloco não deixa o
// arraste preso. O delta é dividido pela escala, para o bloco acompanhar o dedo em qualquer zoom.
// Foi avaliada a `reactflow`: dependência de porte considerável, com tema próprio que teria de ser
// desmontado para caber nos tokens do NOC e textos em inglês para traduzir um a um - custo maior
// que o das poucas dezenas de linhas que ela substituiria.
//
// LIGAR É DE DOIS TOQUES, e arrastar é só um atalho para quem usa mouse. Nenhum caminho da tela
// depende de arrastar de um pino até o alvo: no celular, essa é a interação que mais falha.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const LARGURA_NO = 236;
// ⚠️ UM PISO SÓ DE ESCALA, e ele é baixo de propósito. O piso antigo era 0,35 em cinco lugares
// (roda, pinça, os dois botões de zoom e o «Ajustar à tela»). Com o fluxo real desenhado em faixa
// única, a conta do ajuste pedia 0,09 no computador e 0,04 no celular: as duas batiam no piso, e o
// único botão que promete mostrar o fluxo inteiro mostrava menos de 40% dele, sem nenhum sinal de
// que sobrara coisa fora. Em 0,08 o desenho ainda aparece (mancha legível como mapa); a legibilidade
// do texto é assunto do aviso que o «Ajustar à tela» escreve quando o zoom fica pequeno demais.
const ESCALA_MINIMA = 0.08;
const ESCALA_MAXIMA = 2;
// Abaixo disto o texto do pino fica com ~4 px e a faixa de saída com 9 px de altura: não é legível
// nem tocável. Serve para AVISAR, nunca para impedir.
const ESCALA_LEGIVEL = 0.45;
const ALT_CABECALHO = 36;
const ALT_CORPO = 46;
const ALT_PINO = 26;

function alturaDoNo(qtdSaidas) {
  return ALT_CABECALHO + ALT_CORPO + Math.max(1, qtdSaidas) * ALT_PINO + 8;
}
function ancoraDeSaida(pos, indice) {
  return { x: pos.x + LARGURA_NO, y: pos.y + ALT_CABECALHO + ALT_CORPO + indice * ALT_PINO + ALT_PINO / 2 };
}
function ancoraDeEntrada(pos) {
  return { x: pos.x, y: pos.y + ALT_CABECALHO / 2 };
}

/** Curva de Bézier horizontal. O braço cresce com a distância, com piso e teto para não virar laço. */
function caminhoDaAresta(de, para) {
  const braco = Math.max(40, Math.min(160, Math.abs(para.x - de.x) * 0.5));
  return `M ${de.x} ${de.y} C ${de.x + braco} ${de.y}, ${para.x - braco} ${para.y}, ${para.x} ${para.y}`;
}

function BlocoDeNo({
  no, pos, saidas, selecionado, temErro, temAviso, metrica, catalogo, somenteLeitura,
  ligacaoEmCurso, saidasLigadas, aoSelecionar, aoArrastarInicio, aoTocarPino, aoTocarEntrada,
}) {
  const meta = metaDoTipo(no.tipo, catalogo);
  const cor = COR_DA_FAMILIA[meta.familia] || T.borda2;
  const altura = alturaDoNo(saidas.length);
  const alvoDeLigacao = !!ligacaoEmCurso && ligacaoEmCurso.de !== no.id;

  return (
    <div
      className="rgfx-bloco"
      role="group"
      aria-label={`${meta.rotulo}: ${no.titulo || no.id}`}
      tabIndex={0}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aoSelecionar(no.id); } }}
      style={{
        left: pos.x, top: pos.y, width: LARGURA_NO, height: altura,
        border: `2px solid ${selecionado ? T.primaria : cor}`,
        boxShadow: alvoDeLigacao ? `0 0 0 3px ${T.infoDim}` : undefined,
        zIndex: selecionado ? 3 : 1,
      }}
    >
      {/* Cabeçalho: único ponto de arraste, e é ele que tem touch-action:none. */}
      <div
        className="rgfx-punho"
        onPointerDown={(ev) => { if (!somenteLeitura) aoArrastarInicio(ev, no.id); }}
        onClick={() => (alvoDeLigacao ? aoTocarEntrada(no.id) : aoSelecionar(no.id))}
        style={{
          height: ALT_CABECALHO, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
          background: selecionado ? T.alto : T.sup, borderBottom: `1px solid ${T.borda}`,
        }}
      >
        <span style={{
          fontSize: '0.6rem', fontWeight: 900, letterSpacing: '.04em', padding: '2px 5px',
          borderRadius: 4, background: cor, color: T.sobrePrimaria, flexShrink: 0,
        }}>{meta.sigla}</span>
        <span style={{
          fontSize: '0.78rem', fontWeight: 700, color: T.ink, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>{no.titulo || no.id}</span>
        {/* Selo de problema com ÍCONE e palavra - severidade nunca só por cor. */}
        {temErro ? <AlertTriangle size={14} style={{ color: T.perigo, flexShrink: 0 }} aria-label="tem erro" /> : null}
        {!temErro && temAviso ? <AlertTriangle size={14} style={{ color: T.aviso, flexShrink: 0 }} aria-label="tem aviso" /> : null}
      </div>

      {/* Corpo: resumo do conteúdo e, quando ligada, a camada de telemetria. */}
      <div
        onClick={() => (alvoDeLigacao ? aoTocarEntrada(no.id) : aoSelecionar(no.id))}
        style={{ height: ALT_CORPO, padding: '5px 8px', cursor: 'pointer', overflow: 'hidden' }}
      >
        <div style={{ fontSize: '0.67rem', color: T.mut, marginBottom: 2 }}>
          {meta.rotulo}{meta.estaciona ? ' · espera resposta' : ''}
        </div>
        {metrica ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.67rem', color: T.sec }}>
            <span>{metrica.apresentados ?? 0} vistos</span>
            <span style={{ color: T.mut }}>·</span>
            <span>{metrica.respondidos ?? 0} responderam</span>
            {metrica.apresentados ? (
              <span style={{ flex: 1, height: 4, borderRadius: 2, background: T.sup, overflow: 'hidden', minWidth: 24 }}>
                <span style={{
                  display: 'block', height: '100%',
                  width: `${Math.min(100, ((metrica.abandonados || 0) / metrica.apresentados) * 100)}%`,
                  background: T.perigo,
                }} />
              </span>
            ) : null}
          </div>
        ) : (
          <div style={{
            fontSize: '0.7rem', color: T.sec, display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{resumoDoNo(no)}</div>
        )}
      </div>

      {/* Rodapé: um pino por saída. O de exceção sai tracejado e em cor de aviso/perigo. */}
      <div style={{ padding: '2px 0 4px' }}>
        {saidas.map((s, i) => {
          const especie = especieDaSaida(s);
          const ligada = saidasLigadas.has(s);
          const corPino = especie === 'falha' ? T.perigo : especie === 'excecao' ? T.aviso : T.borda2;
          const armado = ligacaoEmCurso && ligacaoEmCurso.de === no.id && ligacaoEmCurso.saida === s;
          return (
            <button
              key={s}
              type="button"
              className="rgfx-pino"
              disabled={somenteLeitura}
              title={ligada ? `Saída "${rotularSaida(s)}" — já ligada` : `Saída "${rotularSaida(s)}" — sem destino`}
              onClick={() => aoTocarPino(no.id, s)}
              style={{ background: armado ? T.infoDim : undefined, height: ALT_PINO }}
            >
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: ligada ? T.sec : corPino, fontWeight: ligada ? 500 : 700,
              }}>
                {ligada ? rotularSaida(s) : `${rotularSaida(s)} — pendente`}
              </span>
              <span style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: ligada ? corPino : 'transparent',
                border: `2px ${especie === 'normal' ? 'solid' : 'dashed'} ${corPino}`,
              }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Resumo curto do conteúdo do nó, para o bloco não ser só um rótulo. */
function resumoDoNo(no) {
  const c = no.config || {};
  const texto = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v.texto || '') : '');
  switch (no.tipo) {
    case 'texto': case 'pergunta': case 'botoes': case 'encerrar': return texto(c.corpo) || '(sem texto)';
    case 'lista': {
      const secoes = new Set((c.itens || []).map((i) => String(i?.secao || '').trim()).filter(Boolean));
      return `${(c.itens || []).length} item(ns)${secoes.size ? ` em ${secoes.size} seção(ões)` : ''} · ${texto(c.corpo) || 'sem texto'}`;
    }
    case 'midia': return c.url || '(sem endereço)';
    case 'espera': return c.duracao ? `${c.duracao.valor ?? '?'} ${c.duracao.unidade || 'sem unidade'}` : '(sem duração)';
    case 'condicao': return `${(c.regras || []).length} regra(s) ligadas por "${c.combinador || 'e'}"`;
    case 'http': return `${c.metodo || 'GET'} ${c.url || ''}`;
    case 'variavel': return (c.atribuicoes || []).map((a) => a.para).filter(Boolean).join(', ') || '(sem atribuição)';
    case 'etiqueta': return `aplica ${(c.aplicar || []).length}, remove ${(c.remover || []).length}`;
    case 'time': return c.time || c.timeId || '(sem time)';
    case 'notificar': return `${c.canal || 'canal?'} · ${(c.destinatarios || []).length} destinatário(s)`;
    case 'email': return `${c.para || '(sem destinatário)'} · ${c.assunto || '(sem assunto)'}`;
    case 'subfluxo': return `${c.modo === 'saltar' ? 'saltar para' : 'chamar'} ${c.fluxoId || '(sem fluxo)'}`;
    case 'chamado': return `abre chamado (${c.para || 'protocolo'})`;
    case 'inicio': return c.emitirProtocolo ? 'emite protocolo' : 'sem protocolo';
    default: return '';
  }
}

/**
 * MINI-MAPA — duas variantes, e a diferença não é enfeite.
 *
 * ⚠️ 'canto' flutua sobre o quadro e SOME NO CELULAR (`rgfx-esconde-no-celular`). Com 168×112
 * cravados sobre um quadro de 360×420 ele tomava ~22% da área e, por estar em `zIndex` acima dos
 * blocos (que ficam em 1, ou 3 quando selecionados), engolia o SEGUNDO TOQUE da ligação: o
 * operador tocava o pino de «sem resposta», tocava o nó de destino no canto inferior direito, a
 * vista saltava, a ligação continuava armada e nada explicava por que não fechou.
 * 'folha' é a gaveta inferior aberta pelo botão «Mapa» — é assim que ele continua disponível no
 * celular sem roubar quadro.
 *
 * ⚠️ A ALTURA SAI DA PROPORÇÃO DO MUNDO, e não de 112 cravados. Com o fluxo real (~9.600×750) a
 * caixa fixa desenhava uma risca de 1 px no topo e 111 px de vazio — custo total, proveito zero.
 *
 * ⚠️ `inerte` desliga os eventos de ponteiro enquanto há ligação armada: nesse momento todo toque
 * no quadro pertence à ligação, e não ao mapa.
 */
function MiniMapa({
  documento, saidasPorNo, escala, deslocamento, tamanhoViewport, aoIrPara,
  variante = 'canto', largura = 168, inerte = false, classe,
}) {
  const nos = documento?.nos || [];
  if (!nos.length) return null;
  const caixas = nos.map((n) => ({
    id: n.id,
    x: n.ui?.x ?? 0, y: n.ui?.y ?? 0,
    w: LARGURA_NO, h: alturaDoNo((saidasPorNo.get(n.id) || []).length),
  }));
  const minX = Math.min(...caixas.map((c) => c.x)) - 40;
  const minY = Math.min(...caixas.map((c) => c.y)) - 40;
  const maxX = Math.max(...caixas.map((c) => c.x + c.w)) + 40;
  const maxY = Math.max(...caixas.map((c) => c.y + c.h)) + 40;
  const mundoL = Math.max(1, maxX - minX);
  const mundoA = Math.max(1, maxY - minY);
  const larg = Math.max(120, Math.round(largura));
  const alt = Math.round(Math.max(72, Math.min(240, larg * (mundoA / mundoL))));
  const k = Math.min(larg / mundoL, alt / mundoA);

  // Retângulo do que está visível agora - no celular, depois de dois zooms, é o único jeito
  // honesto de saber onde se está.
  const vx = (-deslocamento.x / escala - minX) * k;
  const vy = (-deslocamento.y / escala - minY) * k;
  const vw = (tamanhoViewport.w / escala) * k;
  const vh = (tamanhoViewport.h / escala) * k;

  const posicao = variante === 'canto'
    ? { position: 'absolute', right: 10, bottom: 10, zIndex: 6 }
    : { position: 'relative', display: 'block' };

  return (
    <svg
      className={classe}
      width={larg} height={alt}
      onClick={(ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        aoIrPara({ x: minX + (ev.clientX - r.left) / k, y: minY + (ev.clientY - r.top) / k });
      }}
      style={{
        ...posicao, background: T.cartao, cursor: 'pointer',
        border: `1px solid ${T.borda}`, borderRadius: 8,
        pointerEvents: inerte ? 'none' : undefined,
        opacity: inerte ? 0.4 : 1,
      }}
      aria-label="Mini-mapa do fluxo"
    >
      {caixas.map((c) => (
        <rect
          key={c.id} x={(c.x - minX) * k} y={(c.y - minY) * k}
          width={Math.max(2, c.w * k)} height={Math.max(2, c.h * k)}
          fill={T.borda2} rx={1}
        />
      ))}
      <rect x={vx} y={vy} width={Math.max(4, vw)} height={Math.max(4, vh)} fill="none" stroke={T.primaria} strokeWidth={1.5} />
    </svg>
  );
}

function Tela({
  documento, saidasPorNo, catalogo, selecionadoId, ligacaoEmCurso, escala, deslocamento,
  mostrarExcecoes, problemasPorNo, metricasPorNo, trilhaDestacada, somenteLeitura, arestaSelecionada,
  aoSelecionar, aoMoverNo, aoTocarPino, aoTocarEntrada, aoCancelarLigacao, aoSelecionarAresta,
  aoApagarAresta, aoMudarVista, aoMedirViewport,
}) {
  const refViewport = useRef(null);
  const [arrasto, setArrasto] = useState(null);      // arraste transitório de bloco
  const [pan, setPan] = useState(null);              // arraste transitório do fundo
  const ponteiros = useRef(new Map());               // pinça: dois ponteiros guardados
  const pincaAnterior = useRef(null);
  const [tamanho, setTamanho] = useState({ w: 800, h: 520 });
  // ⚠️ A medida do quadro SOBE. Ela já existia aqui dentro (o mini-mapa usa), mas quem precisa
  // dela para valer é o «Ajustar à tela», que fica na página e antes media uma tela imaginária de
  // 900×520. Vai por ref para o efeito de medição não depender da identidade do callback.
  const refAoMedir = useRef(aoMedirViewport);
  refAoMedir.current = aoMedirViewport;

  useEffect(() => {
    const el = refViewport.current;
    if (!el) return undefined;
    const medir = () => {
      const medida = { w: el.clientWidth, h: el.clientHeight };
      setTamanho(medida);
      if (refAoMedir.current) refAoMedir.current(medida);
    };
    medir();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    if (obs) obs.observe(el);
    window.addEventListener('resize', medir);
    return () => { if (obs) obs.disconnect(); window.removeEventListener('resize', medir); };
  }, []);

  // ⚠️ A roda é ouvida por listener NATIVO com { passive:false }. No React 18 o `onWheel` é
  // registrado no contêiner raiz de forma passiva, e `preventDefault()` ali não segura a rolagem
  // da página: dar zoom no fluxo rolava o NOC inteiro por baixo.
  useEffect(() => {
    const el = refViewport.current;
    if (!el) return undefined;
    const aoRodar = (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const r = el.getBoundingClientRect();
        const px = ev.clientX - r.left;
        const py = ev.clientY - r.top;
        const fator = Math.exp(-ev.deltaY * 0.0016);
        const nova = Math.max(ESCALA_MINIMA, Math.min(ESCALA_MAXIMA, escala * fator));
        // Zoom ancorado no ponto sob o cursor: o mundo sob o dedo não escorrega.
        aoMudarVista({
          escala: nova,
          deslocamento: { x: px - ((px - deslocamento.x) / escala) * nova, y: py - ((py - deslocamento.y) / escala) * nova },
        });
      } else {
        aoMudarVista({ escala, deslocamento: { x: deslocamento.x - ev.deltaX, y: deslocamento.y - ev.deltaY } });
      }
    };
    el.addEventListener('wheel', aoRodar, { passive: false });
    return () => el.removeEventListener('wheel', aoRodar);
  }, [escala, deslocamento, aoMudarVista]);

  // Esc cancela a ligação em curso. É a saída que todo mundo tenta primeiro.
  useEffect(() => {
    const aoTeclar = (ev) => { if (ev.key === 'Escape') aoCancelarLigacao(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoCancelarLigacao]);

  const paraMundo = useCallback((clientX, clientY) => {
    const r = refViewport.current.getBoundingClientRect();
    return {
      x: (clientX - r.left - deslocamento.x) / escala,
      y: (clientY - r.top - deslocamento.y) / escala,
    };
  }, [deslocamento, escala]);

  const iniciarArraste = useCallback((ev, noId) => {
    ev.stopPropagation();
    const no = (documento.nos || []).find((n) => n.id === noId);
    if (!no) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setArrasto({
      noId, ponteiro: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY,
      x: no.ui?.x ?? 0, y: no.ui?.y ?? 0, mexeu: false, alvo: ev.currentTarget,
    });
  }, [documento]);

  useEffect(() => {
    if (!arrasto) return undefined;
    const mover = (ev) => {
      if (ev.pointerId !== arrasto.ponteiro) return;
      const dx = (ev.clientX - arrasto.clientX) / escala;
      const dy = (ev.clientY - arrasto.clientY) / escala;
      if (!arrasto.mexeu && Math.abs(dx) + Math.abs(dy) < 3) return;
      setArrasto((a) => (a ? { ...a, mexeu: true, atualX: a.x + dx, atualY: a.y + dy } : a));
    };
    const soltar = (ev) => {
      if (ev.pointerId !== arrasto.ponteiro) return;
      // Só grava no documento no SOLTAR. Reescrever o documento a cada pixel dispararia o
      // salvamento com recuo dezenas de vezes por arraste, e cada gravação carrega o documento
      // inteiro pela rede.
      if (arrasto.mexeu) aoMoverNo(arrasto.noId, { x: arrasto.atualX, y: arrasto.atualY });
      setArrasto(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
    };
  }, [arrasto, escala, aoMoverNo]);

  const aoPonteiroBaixo = (ev) => {
    if (ev.target !== ev.currentTarget && !ev.target.dataset?.fundo) return;
    ponteiros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ponteiros.current.size === 1) {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      setPan({ ponteiro: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, dx: deslocamento.x, dy: deslocamento.y, mexeu: false });
    }
  };
  const aoPonteiroMover = (ev) => {
    if (ponteiros.current.has(ev.pointerId)) ponteiros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    // Pinça de dois dedos: razão entre as distâncias dos ponteiros guardados.
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pincaAnterior.current) {
        const fator = dist / pincaAnterior.current;
        const nova = Math.max(ESCALA_MINIMA, Math.min(ESCALA_MAXIMA, escala * fator));
        const r = refViewport.current.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - r.left;
        const cy = (a.y + b.y) / 2 - r.top;
        aoMudarVista({
          escala: nova,
          deslocamento: { x: cx - ((cx - deslocamento.x) / escala) * nova, y: cy - ((cy - deslocamento.y) / escala) * nova },
        });
      }
      pincaAnterior.current = dist;
      setPan(null);
      return;
    }
    if (pan && ev.pointerId === pan.ponteiro) {
      const dx = ev.clientX - pan.clientX;
      const dy = ev.clientY - pan.clientY;
      if (!pan.mexeu && Math.abs(dx) + Math.abs(dy) < 3) return;
      setPan((p) => (p ? { ...p, mexeu: true } : p));
      aoMudarVista({ escala, deslocamento: { x: pan.dx + dx, y: pan.dy + dy } });
    }
  };
  const aoPonteiroCima = (ev) => {
    ponteiros.current.delete(ev.pointerId);
    if (ponteiros.current.size < 2) pincaAnterior.current = null;
    if (pan && ev.pointerId === pan.ponteiro) {
      // Toque no vazio (sem arrastar) cancela a ligação e limpa a seleção.
      if (!pan.mexeu) { aoCancelarLigacao(); aoSelecionar(null); aoSelecionarAresta(null); }
      setPan(null);
    }
  };

  const posicaoDe = (n) => {
    if (arrasto && arrasto.noId === n.id && arrasto.mexeu) return { x: arrasto.atualX, y: arrasto.atualY };
    return { x: n.ui?.x ?? 0, y: n.ui?.y ?? 0 };
  };

  const nos = documento.nos || [];
  const porId = new Map(nos.map((n) => [n.id, n]));
  const trilha = new Set(trilhaDestacada || []);

  // Arestas desenháveis. Uma aresta cuja saída está escondida pelo interruptor de exceções
  // não é desenhada - é essa a medida que impede 37 arestas de virarem sopa de linhas.
  const arestas = [];
  for (const a of documento.arestas || []) {
    const origem = porId.get(a.de);
    const destino = porId.get(a.para);
    if (!origem || !destino) continue;
    const listaSaidas = saidasPorNo.get(a.de) || [];
    const visiveis = mostrarExcecoes ? listaSaidas : listaSaidas.filter((s) => especieDaSaida(s) === 'normal');
    const indice = visiveis.indexOf(a.saida);
    if (indice < 0) continue;
    const de = ancoraDeSaida(posicaoDe(origem), indice);
    const para = ancoraDeEntrada(posicaoDe(destino));
    const especie = especieDaSaida(a.saida);
    const tocaSelecionado = !selecionadoId || a.de === selecionadoId || a.para === selecionadoId;
    arestas.push({
      chave: `${a.de} ${a.saida}`, a, de, para, especie,
      esmaecida: !tocaSelecionado,
      destacada: trilha.has(a.de) && trilha.has(a.para),
    });
  }

  return (
    <div
      ref={refViewport}
      className="rgfx-viewport"
      data-fundo="1"
      onPointerDown={aoPonteiroBaixo}
      onPointerMove={aoPonteiroMover}
      onPointerUp={aoPonteiroCima}
      onPointerCancel={aoPonteiroCima}
      style={{ flex: 1, minHeight: 420, cursor: pan?.mexeu ? 'grabbing' : 'default' }}
    >
      {/* ⚠️ `data-fundo` também no mundo. O mundo é `inset:0` e cobre o viewport, então o clique no
          vazio chega NELE, e não no viewport — sem esta marca, arrastar o fundo não funcionava em
          nenhum ponto que estivesse dentro da área do mundo, que é quase toda a tela. */}
      <div
        className="rgfx-mundo"
        data-fundo="1"
        style={{ transform: `translate(${deslocamento.x}px, ${deslocamento.y}px) scale(${escala})` }}
      >
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 8000, height: 6000, overflow: 'visible', pointerEvents: 'none' }}>
          {arestas.map((e) => {
            const cor = e.especie === 'falha' ? T.perigo : e.especie === 'excecao' ? T.aviso : T.borda2;
            const selecionada = arestaSelecionada === e.chave;
            const meio = { x: (e.de.x + e.para.x) / 2, y: (e.de.y + e.para.y) / 2 };
            return (
              <g key={e.chave} opacity={e.esmaecida ? 0.25 : 1}>
                {/* Trilho invisível e grosso: alvo de toque decente para uma linha de 2 px. */}
                <path
                  d={caminhoDaAresta(e.de, e.para)} stroke="transparent" strokeWidth={18} fill="none"
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={() => aoSelecionarAresta(e.chave)}
                />
                <path
                  d={caminhoDaAresta(e.de, e.para)} fill="none"
                  stroke={selecionada ? T.primaria : e.destacada ? T.ok : cor}
                  strokeWidth={selecionada || e.destacada ? 3 : 2}
                  strokeDasharray={e.especie === 'normal' ? undefined : '6 5'}
                />
                <circle cx={e.para.x} cy={e.para.y} r={3.5} fill={selecionada ? T.primaria : cor} />
                {/* Rótulo só quando a saída não é 'padrao' - senão 37 rótulos viram sopa. */}
                {e.a.saida !== 'padrao' ? (
                  <text
                    x={meio.x} y={meio.y - 5} textAnchor="middle"
                    style={{ fontSize: 10, fill: cor, paintOrder: 'stroke', stroke: T.fundo, strokeWidth: 3 }}
                  >{rotularSaida(e.a.saida)}</text>
                ) : null}
                {/* O botão de apagar aparece com a aresta SELECIONADA, nunca ao passar o mouse:
                    nada nesta tela pode depender de hover. */}
                {selecionada && !somenteLeitura ? (
                  <g style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={() => aoApagarAresta(e.a.de, e.a.saida)}>
                    <circle cx={meio.x} cy={meio.y + 12} r={16} fill={T.perigoDim} stroke={T.perigo} />
                    <text x={meio.x} y={meio.y + 17} textAnchor="middle" style={{ fontSize: 14, fill: T.perigo, fontWeight: 700 }}>×</text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>

        {nos.map((n) => {
          const listaSaidas = saidasPorNo.get(n.id) || [];
          const visiveis = mostrarExcecoes ? listaSaidas : listaSaidas.filter((s) => especieDaSaida(s) === 'normal');
          const ligadas = new Set((documento.arestas || []).filter((a) => a.de === n.id).map((a) => a.saida));
          const probs = problemasPorNo.get(n.id) || [];
          return (
            <BlocoDeNo
              key={n.id}
              no={n}
              pos={posicaoDe(n)}
              saidas={visiveis}
              saidasLigadas={ligadas}
              catalogo={catalogo}
              selecionado={selecionadoId === n.id}
              temErro={probs.some((p) => p.nivel === 'erro')}
              temAviso={probs.some((p) => p.nivel === 'aviso')}
              metrica={metricasPorNo ? metricasPorNo.get(n.id) : null}
              somenteLeitura={somenteLeitura}
              ligacaoEmCurso={ligacaoEmCurso}
              aoSelecionar={aoSelecionar}
              aoArrastarInicio={iniciarArraste}
              aoTocarPino={aoTocarPino}
              aoTocarEntrada={aoTocarEntrada}
            />
          );
        })}
      </div>

      {ligacaoEmCurso ? (
        <div style={{
          position: 'absolute', left: 10, top: 10, zIndex: 7, padding: '8px 12px', borderRadius: 8,
          background: T.alto, border: `1px solid ${T.info}`, color: T.ink, fontSize: '0.8rem',
          display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'calc(100% - 20px)',
        }}>
          <span>
            Ligando a saída <strong>{rotularSaida(ligacaoEmCurso.saida)}</strong> de{' '}
            <strong>{ligacaoEmCurso.de}</strong>. Toque no nó de destino.
          </span>
          <button className="btn btn-secondary" style={{ minHeight: 32 }} onClick={() => aoCancelarLigacao()}>
            Cancelar
          </button>
        </div>
      ) : null}

      <MiniMapa
        classe="rgfx-esconde-no-celular"
        inerte={!!ligacaoEmCurso}
        documento={documento}
        saidasPorNo={saidasPorNo}
        escala={escala}
        deslocamento={deslocamento}
        tamanhoViewport={tamanho}
        aoIrPara={(ponto) => aoMudarVista({
          escala,
          deslocamento: { x: tamanho.w / 2 - ponto.x * escala, y: tamanho.h / 2 - ponto.y * escala },
        })}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 7. PALETA E FORMULÁRIOS POR TIPO
// Todo formulário emite `aoAlterarConfig(configInteira)` - nenhum deles escreve no documento.
// A config vai INTEIRA de propósito: fundir remendos nunca apagaria a chave que o operador
// acabou de remover (um item de lista, uma regra de condição).
// ════════════════════════════════════════════════════════════════════════════════════════════════

function PaletaDeNos({ catalogo, aoAcrescentar, compacta, aoFechar, desabilitada, motivo }) {
  return (
    <div className="rgfx-paleta" style={{ ...cartao, padding: 10, alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: '0.8rem' }}>Acrescentar nó</div>
        {aoFechar ? (
          <button className="btn btn-secondary rgfx-so-no-celular" style={{ minHeight: 32 }} onClick={() => aoFechar()}>
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {ORDEM_DA_PALETA.map((tipo) => {
          const meta = metaDoTipo(tipo, catalogo);
          const cor = COR_DA_FAMILIA[meta.familia] || T.borda2;
          return (
            <button
              key={tipo}
              type="button"
              disabled={!!desabilitada}
              title={desabilitada ? motivo : undefined}
              onClick={() => aoAcrescentar(tipo)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 40,
                padding: '6px 8px', borderRadius: 8, textAlign: 'left',
                cursor: desabilitada ? 'not-allowed' : 'pointer', opacity: desabilitada ? 0.5 : 1,
                background: T.sup, border: `1px solid ${T.borda}`, color: T.ink, fontSize: '0.78rem',
              }}
            >
              <span style={{
                fontSize: '0.58rem', fontWeight: 900, padding: '2px 4px', borderRadius: 4,
                background: cor, color: T.sobrePrimaria,
              }}>{meta.sigla}</span>
              <span style={{ flex: 1 }}>{meta.rotulo}</span>
              {meta.estaciona ? <Clock size={12} style={{ color: T.mut }} aria-label="espera resposta" /> : null}
            </button>
          );
        })}
      </div>
      {compacta ? null : (
        <div style={{ fontSize: '0.68rem', color: T.mut, marginTop: 10, lineHeight: 1.45 }}>
          O relógio marca os nós que ESTACIONAM — eles nascem com as saídas «sem resposta» e
          «opção inválida» já desenhadas e com o bloco de exceções preenchido.
        </div>
      )}
    </div>
  );
}

/** Lista editável genérica (itens de lista, botões, regras, atribuições, destinatários). */
function ListaEditavel({ titulo, itens, aoMudar, novoItem, teto, renderizar, avisoDeTeto }) {
  const lista = itens || [];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={rotuloEstilo}>{titulo}</span>
        <button
          type="button" className="btn btn-secondary" style={{ minHeight: 32, padding: '4px 10px' }}
          disabled={teto ? lista.length >= teto : false}
          onClick={() => aoMudar([...lista, novoItem(lista.length)])}
        >
          <Plus size={13} /> Acrescentar
        </button>
      </div>
      {lista.length === 0 ? <Vazio>Nada por aqui ainda.</Vazio> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {lista.map((item, i) => (
          <div key={i} style={{ border: `1px solid ${T.borda}`, borderRadius: 8, padding: 8, background: T.sup }}>
            {renderizar(item, (novo) => aoMudar(lista.map((x, j) => (j === i ? novo : x))), i)}
            <button
              type="button" className="btn btn-secondary"
              style={{ minHeight: 34, marginTop: 6, color: T.perigo }}
              onClick={() => aoMudar(lista.filter((_x, j) => j !== i))}
            >
              <Trash2 size={13} /> Remover
            </button>
          </div>
        ))}
      </div>
      {avisoDeTeto}
    </div>
  );
}

function CampoTexto({ rotulo, dica, valor, aoMudar, linhas, tipo = 'text', teto, ...resto }) {
  const Comp = linhas ? 'textarea' : 'input';
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={dica}>
        {rotulo}
        {teto ? <ContadorDeTexto texto={valor} teto={teto} /> : null}
      </Rotulo>
      <Comp
        {...(linhas ? { rows: linhas } : { type: tipo })}
        value={valor ?? ''}
        onChange={(ev) => aoMudar(ev.target.value)}
        style={{ ...campoEstilo, resize: linhas ? 'vertical' : undefined }}
        {...resto}
      />
    </div>
  );
}

function CampoSelecao({ rotulo, dica, valor, opcoes, aoMudar, vazio = '— escolha —' }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={dica}>{rotulo}</Rotulo>
      <select value={valor ?? ''} onChange={(ev) => aoMudar(ev.target.value)} style={campoEstilo}>
        <option value="">{vazio}</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </div>
  );
}

/**
 * Contador de caracteres do campo. Mora DENTRO do rótulo, colado ao nome do campo: aviso numa faixa
 * à parte, três linhas abaixo, é aviso que ninguém associa ao campo que o causou.
 *
 * O título explica de onde sai o número e quem manda de verdade — sem isso o operador teria dois
 * números concorrentes (este e o da Prévia) sem saber em qual acreditar.
 */
function ContadorDeTexto({ texto, teto }) {
  const medido = medirTexto(texto);
  const estourou = medido > teto;
  const perto = !estourou && medido > teto * 0.85;
  return (
    <span
      title="Pior caso entre grafemas, pontos de código e unidades UTF-16 — a mesma conta do motor. Quem decide o corte de verdade é a aba Prévia."
      style={{
        textTransform: 'none', fontWeight: 700, marginLeft: 6,
        color: estourou ? T.perigo : perto ? T.aviso : T.mut,
      }}
    >
      {medido}/{teto}{estourou ? ' — o canal corta' : ''}
    </span>
  );
}

/**
 * Variáveis que dá para escrever nos textos. Estavam só na cabeça de quem escreveu o fluxo antes:
 * o operador tinha de adivinhar o nome exato, e `{{primeiroNome}}` (que não existe) saía como
 * texto vazio na cara do cliente, sem ninguém perceber até alguém reclamar.
 *
 * A lista fixa é o mínimo garantido pelo motor; `doFluxo` acrescenta o que este fluxo declarou.
 */
const VARIAVEIS_SEMPRE = [
  { nome: 'firstName', oQueE: 'primeiro nome de quem escreveu' },
  { nome: 'ticket_id', oQueE: 'número do atendimento' },
  { nome: 'protocolo', oQueE: 'protocolo emitido no bloco de início' },
];

function AjudaDeVariaveis({ doFluxo }) {
  const chip = {
    padding: '2px 6px', borderRadius: 6, border: `1px solid ${T.borda}`,
    background: T.sup, color: T.sec, fontSize: '0.72rem', whiteSpace: 'nowrap',
  };
  const extras = (doFluxo || [])
    .map((v) => (typeof v === 'string' ? v : v?.nome))
    .filter(Boolean)
    .filter((n) => !VARIAVEIS_SEMPRE.some((s) => s.nome === n));
  return (
    <div style={{
      border: `1px solid ${T.borda}`, borderRadius: 8, padding: 8, marginBottom: 12, background: T.sup,
    }}>
      <div style={{ ...rotuloEstilo, marginBottom: 6 }}>Variáveis que valem nos textos deste bloco</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {VARIAVEIS_SEMPRE.map((v) => (
          <code key={v.nome} title={v.oQueE} style={chip}>{`{{${v.nome}}}`}</code>
        ))}
        {extras.map((n) => (
          <code key={n} title="Declarada neste fluxo" style={chip}>{`{{${n}}}`}</code>
        ))}
      </div>
      <div style={{ fontSize: '0.68rem', color: T.mut, marginTop: 6, lineHeight: 1.45 }}>
        Nome errado não dá erro: sai texto vazio na mensagem do cliente. A aba Prévia lista quais
        variáveis ficaram sem valor.
      </div>
    </div>
  );
}

/**
 * ⚠️ A REGRA QUE CUSTA A MENSAGEM INTEIRA: no WhatsApp, botão de RESPOSTA e botão de LINK não
 * convivem na mesma mensagem. Misturados, a Meta recusa o envio TODO — nem o texto chega. Não é
 * degradação: é silêncio.
 *
 * Por isso a escolha é do BLOCO, e não de cada botão: formulário que deixa montar a mistura e só
 * depois reclama já gastou o tempo do operador construindo o que nunca ia sair.
 *
 * O modo NÃO é campo novo no documento — ele é LIDO dos próprios botões (`botoes[].tipo`). Inventar
 * uma chave que o motor não lê seria gravar um formato que só a tela entende.
 */
function tipoDosBotoes(botoes) {
  const lista = botoes || [];
  if (!lista.length) return 'resposta';
  const comUrl = lista.filter((b) => b?.tipo === 'url').length;
  if (comUrl === lista.length) return 'url';
  if (comUrl === 0) return 'resposta';
  return 'misturado';                 // só chega aqui por edição do JSON cru — e é erro de canal
}

/**
 * Converte a lista inteira para um modo. NÃO descarta botão em silêncio: passar de 3 respostas para
 * link mantém os botões e o formulário reclama do excesso, em vez de o operador voltar amanhã e
 * achar que a tela comeu o trabalho dele.
 */
function converterBotoes(botoes, destino) {
  const lista = botoes || [];
  if (destino === 'url') {
    const base = lista.length ? lista : [{ id: 'abrir_link', rotulo: 'Abrir' }];
    return base.map((b) => ({ ...b, tipo: 'url', url: b.url || 'https://' }));
  }
  return lista.map((b) => {
    const { url: _descartada, ...resto } = b;
    return { ...resto, tipo: 'resposta' };
  });
}

/** Escolha do tipo no nível do bloco. Dois botões, estado visível, sem menu escondido. */
function EscolhaDoTipoDeBotao({ valor, aoMudar }) {
  const opcoes = [
    { id: 'resposta', rotulo: 'Botões de resposta', abaixo: `até ${LIMITES_DO_CANAL.botoesMax} · o cliente responde e o fluxo segue` },
    { id: 'url', rotulo: 'Botão de link', abaixo: '1 só · abre um endereço, não devolve resposta' },
  ];
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo>O que estes botões são</Rotulo>
      <div style={{ display: 'flex', gap: 8 }}>
        {opcoes.map((o) => {
          const ativo = valor === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoMudar(o.id)}
              style={{
                flex: 1, textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${ativo ? T.primaria : T.campo}`,
                background: ativo ? T.alto : T.entrada,
                color: ativo ? T.ink : T.sec,
              }}
            >
              <div style={{ fontWeight: ativo ? 800 : 600, fontSize: '0.8rem' }}>{o.rotulo}</div>
              <div style={{ fontSize: '0.68rem', color: T.mut, marginTop: 2 }}>{o.abaixo}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Como os itens vão aparecer agrupados. Existe porque `secao` é um campo por ITEM e o efeito dele é
 * na LISTA inteira: sem este resumo, o operador só descobre que digitou «Suporte » com espaço no
 * fim quando o cliente vê duas seções iguais na tela do WhatsApp.
 */
function ResumoDeSecoes({ itens }) {
  const grupos = agruparPorSecao(itens);
  if (grupos.length <= 1 && !grupos[0]?.nome) return null;
  return (
    <div style={{ border: `1px solid ${T.borda}`, borderRadius: 8, padding: 8, marginBottom: 12, background: T.sup }}>
      <div style={{ ...rotuloEstilo, marginBottom: 6 }}>Como o cliente vai ver a lista</div>
      {grupos.map((g) => (
        <div key={g.nome || '(sem seção)'} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: g.nome ? T.ink : T.mut }}>
            {g.nome || 'Sem seção — aparecem soltos no topo'}
          </div>
          <div style={{ fontSize: '0.72rem', color: T.sec, paddingLeft: 10 }}>
            {g.itens.map((i) => i.titulo || i.id || '(sem título)').join(' · ')}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Agrupa por `secao` PRESERVANDO a ordem de digitação, e com o grupo sem seção sempre à frente —
 * é assim que o canal desenha: item solto aparece no topo, antes de qualquer título de seção.
 */
function agruparPorSecao(itens) {
  const grupos = [];
  for (const item of itens || []) {
    const nome = String(item?.secao || '').trim();
    let g = grupos.find((x) => x.nome === nome);
    if (!g) { g = { nome, itens: [] }; grupos.push(g); }
    g.itens.push(item);
  }
  const semSecao = grupos.filter((g) => !g.nome);
  const comSecao = grupos.filter((g) => g.nome);
  return [...semSecao, ...comSecao];
}

const listaParaTexto = (v) => (Array.isArray(v) ? v.join(', ') : '');
const textoParaLista = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const lerCorpo = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v.texto || '') : '');

/**
 * FORMULÁRIO DE CONTEÚDO por tipo.
 *
 * ⚠️ Os contadores daqui ORIENTAM, não julgam: o veredito continua sendo de `preparar()` do motor,
 * na aba Prévia. Eles existem porque o limite descoberto depois da publicação já custou a mensagem
 * do cliente — ver o número enquanto se digita é o que evita o corte, não a faixa vermelha depois.
 *
 * ⚠️ E os limites que a tela ENSINA em vez de só validar são os que não têm conserto no envio: a
 * mistura de botão de resposta com botão de link faz a Meta recusar a mensagem INTEIRA. Por isso a
 * escolha é oferecida no bloco, antes de haver o que reclamar.
 */
function FormularioDeNo({ no, config, aoMudarConfig, fluxosDaEmpresa, variaveisDoFluxo }) {
  const c = config || {};
  const p = (chave, valor) => aoMudarConfig({ ...c, [chave]: valor });

  switch (no.tipo) {
    case 'inicio':
      return (
        <>
          <Interruptor marcado={c.emitirProtocolo} aoMudar={(v) => p('emitirProtocolo', v)}>
            Emitir protocolo novo ao entrar
          </Interruptor>
          <Interruptor marcado={c.exigirProtocolo} aoMudar={(v) => p('exigirProtocolo', v)}>
            Exigir que já exista um protocolo
          </Interruptor>
          {c.emitirProtocolo && c.exigirProtocolo ? (
            <Faixa tom="erro" titulo="As duas opções se contradizem">
              Não dá para exigir um protocolo que já existe e, ao mesmo tempo, emitir um novo.
              O motor recusa este nó.
            </Faixa>
          ) : null}
        </>
      );

    case 'texto':
      return (
        <CampoTexto
          rotulo="Mensagem para o cliente" linhas={5}
          valor={lerCorpo(c.corpo)} aoMudar={(v) => p('corpo', v)}
        />
      );

    case 'midia':
      return (
        <>
          <CampoTexto rotulo="Endereço do arquivo" dica="https obrigatório" valor={c.url} aoMudar={(v) => p('url', v)} />
          <CampoTexto rotulo="Legenda" linhas={2} valor={c.legenda} aoMudar={(v) => p('legenda', v)} />
          <CampoSelecao
            rotulo="Categoria" valor={c.categoria} aoMudar={(v) => p('categoria', v || undefined)}
            opcoes={[
              { valor: 'imagem', rotulo: 'Imagem' }, { valor: 'documento', rotulo: 'Documento' },
              { valor: 'audio', rotulo: 'Áudio' }, { valor: 'video', rotulo: 'Vídeo' },
            ]}
          />
        </>
      );

    case 'pergunta':
      return (
        <>
          <CampoTexto rotulo="Pergunta" linhas={4} valor={lerCorpo(c.corpo)} aoMudar={(v) => p('corpo', v)} />
          <CampoTexto
            rotulo="Guardar a resposta na variável" dica="letras, números e _"
            valor={c.para} aoMudar={(v) => p('para', v)}
          />
          <CampoSelecao
            rotulo="Validar a resposta como" valor={c.validacao?.tipo}
            aoMudar={(v) => p('validacao', v ? { ...(c.validacao || {}), tipo: v } : undefined)}
            vazio="— aceitar qualquer texto —"
            opcoes={[
              { valor: 'texto', rotulo: 'Texto' }, { valor: 'numero', rotulo: 'Número' },
              { valor: 'email', rotulo: 'E-mail' }, { valor: 'telefone', rotulo: 'Telefone' },
              { valor: 'cpf', rotulo: 'CPF' }, { valor: 'cnpj', rotulo: 'CNPJ' },
              { valor: 'data', rotulo: 'Data' }, { valor: 'regex', rotulo: 'Expressão regular' },
            ]}
          />
          {c.validacao?.tipo === 'regex' ? (
            <CampoTexto rotulo="Expressão regular" valor={c.validacao?.padrao} aoMudar={(v) => p('validacao', { ...(c.validacao || {}), padrao: v })} />
          ) : null}
          <Interruptor marcado={c.higienizar !== false} aoMudar={(v) => p('higienizar', v)}>
            Limpar espaços e caracteres invisíveis antes de guardar
          </Interruptor>
          <CampoDeEspera valor={c.esperaResposta} obrigatorio aoMudar={(v) => p('esperaResposta', v)} />
        </>
      );

    case 'lista': {
      // Documento antigo não tem `cabecalho` nem `secao`: os campos abrem VAZIOS, nunca com
      // `undefined` escapando para o `value` do input (React trocaria o campo por não-controlado
      // no meio da digitação). Quem garante isso é o `valor ?? ''` do CampoTexto.
      const itensDaLista = c.itens || [];
      const gruposDaLista = agruparPorSecao(itensDaLista);
      const secoesNomeadas = gruposDaLista.filter((g) => g.nome);
      return (
        <>
          <AjudaDeVariaveis doFluxo={variaveisDoFluxo} />
          <CampoTexto
            rotulo="Cabeçalho" dica="opcional — sai em negrito acima do texto"
            teto={LIMITES_DO_CANAL.cabecalho}
            valor={c.cabecalho} aoMudar={(v) => p('cabecalho', v || undefined)}
          />
          <CampoTexto rotulo="Texto acima da lista" linhas={3} teto={LIMITES_DO_CANAL.corpo} valor={lerCorpo(c.corpo)} aoMudar={(v) => p('corpo', v)} />
          <CampoTexto rotulo="Rodapé" dica="opcional" teto={LIMITES_DO_CANAL.rodape} valor={c.rodape} aoMudar={(v) => p('rodape', v || undefined)} />
          <CampoTexto rotulo="Rótulo do botão que abre a lista" teto={LIMITES_DO_CANAL.listaBotao} valor={c.rotuloBotao ?? 'Escolher'} aoMudar={(v) => p('rotuloBotao', v)} />
          <CampoTexto rotulo="Guardar a escolha na variável" dica="opcional" valor={c.para} aoMudar={(v) => p('para', v || undefined)} />

          {itensDaLista.length > LIMITES_DO_CANAL.listaItensMax ? (
            <Faixa tom="erro" titulo={`${itensDaLista.length} itens — o canal aceita ${LIMITES_DO_CANAL.listaItensMax}`}>
              A conta é do documento inteiro, somando TODAS as seções. Acima disso o motor descarta
              os itens que sobram e o cliente escolhe entre opções que o fluxo nem previu.
            </Faixa>
          ) : null}
          {secoesNomeadas.length > LIMITES_DO_CANAL.listaSecoesMax ? (
            <Faixa tom="erro" titulo={`${secoesNomeadas.length} seções — o canal aceita ${LIMITES_DO_CANAL.listaSecoesMax}`}>
              Junte seções ou tire o nome de algumas: item sem seção aparece solto no topo.
            </Faixa>
          ) : null}

          <ResumoDeSecoes itens={itensDaLista} />

          <ListaEditavel
            titulo={`Itens da lista (${itensDaLista.length}/${LIMITES_DO_CANAL.listaItensMax}${secoesNomeadas.length ? ` · ${secoesNomeadas.length} seção(ões)` : ''})`}
            itens={c.itens}
            teto={LIMITES_DO_CANAL.listaItensMax}
            aoMudar={(v) => p('itens', v)}
            novoItem={(i) => ({ id: `opcao_${i + 1}`, titulo: `Opção ${i + 1}` })}
            renderizar={(item, mudar) => (
              <>
                <CampoTexto rotulo="Identificador (vira a saída no desenho)" valor={item.id} aoMudar={(v) => mudar({ ...item, id: v })} />
                <CampoTexto rotulo="Título" teto={LIMITES_DO_CANAL.listaTitulo} valor={item.titulo} aoMudar={(v) => mudar({ ...item, titulo: v })} />
                <CampoTexto rotulo="Descrição" teto={LIMITES_DO_CANAL.listaDescricao} valor={item.descricao} aoMudar={(v) => mudar({ ...item, descricao: v || undefined })} />
                {/* `list` liga o campo ao datalist com as seções JÁ digitadas: seção é casada por
                    texto exato, e «Suporte» e «suporte » viram dois blocos idênticos na tela do
                    cliente. Sugerir o que já existe é mais barato do que explicar depois. */}
                <CampoTexto
                  rotulo="Seção" dica="opcional — itens com a mesma seção aparecem juntos"
                  list="rgfx-secoes-da-lista"
                  valor={item.secao} aoMudar={(v) => mudar({ ...item, secao: v || undefined })}
                />
                <CampoTexto
                  rotulo="Apelidos que também casam" dica="separados por vírgula"
                  valor={listaParaTexto(item.apelidos)}
                  aoMudar={(v) => mudar({ ...item, apelidos: textoParaLista(v) })}
                />
              </>
            )}
            avisoDeTeto={
              <div style={{ fontSize: '0.72rem', color: T.mut, marginTop: 6 }}>
                Mudar o identificador de um item REMOVE a saída antiga do desenho e cria outra —
                a aresta que saía dela fica órfã. Confira as ligações depois de renomear.
                Mudar a SEÇÃO não mexe em saída nenhuma: ela só agrupa na tela do cliente.
              </div>
            }
          />
          <datalist id="rgfx-secoes-da-lista">
            {secoesNomeadas.map((g) => <option key={g.nome} value={g.nome} />)}
          </datalist>
          <CampoDeEspera valor={c.esperaResposta} obrigatorio aoMudar={(v) => p('esperaResposta', v)} />
        </>
      );
    }

    case 'botoes': {
      const modoDosBotoes = tipoDosBotoes(c.botoes);
      const quantosBotoes = (c.botoes || []).length;
      const ehLink = modoDosBotoes === 'url';
      return (
        <>
          <AjudaDeVariaveis doFluxo={variaveisDoFluxo} />
          <CampoTexto
            rotulo="Cabeçalho" dica="opcional — sai em negrito acima do texto"
            teto={LIMITES_DO_CANAL.cabecalho}
            valor={c.cabecalho} aoMudar={(v) => p('cabecalho', v || undefined)}
          />
          <CampoTexto rotulo="Texto acima dos botões" dica="(obrigatório)" linhas={3} teto={LIMITES_DO_CANAL.corpo} valor={lerCorpo(c.corpo)} aoMudar={(v) => p('corpo', v)} />
          <CampoTexto rotulo="Rodapé" dica="opcional" teto={LIMITES_DO_CANAL.rodape} valor={c.rodape} aoMudar={(v) => p('rodape', v || undefined)} />
          <CampoTexto rotulo="Guardar a escolha na variável" dica="opcional" valor={c.para} aoMudar={(v) => p('para', v || undefined)} />

          {/* A regra vem ANTES da lista de botões, e não depois do erro: o operador escolhe o tipo
              e o formulário passa a só oferecer o que aquele tipo aceita. */}
          <Faixa tom="info" titulo="Botão de resposta e botão de link não convivem na mesma mensagem">
            O WhatsApp aceita até {LIMITES_DO_CANAL.botoesMax} botões de resposta OU 1 botão de
            link — nunca os dois juntos. Misturados, a Meta recusa a mensagem INTEIRA: o cliente
            não recebe nem o texto. Por isso a escolha é do bloco.
          </Faixa>
          <div style={{ height: 10 }} />
          <EscolhaDoTipoDeBotao
            valor={modoDosBotoes === 'misturado' ? '' : modoDosBotoes}
            aoMudar={(v) => p('botoes', converterBotoes(c.botoes, v))}
          />

          {modoDosBotoes === 'misturado' ? (
            <Faixa
              tom="erro" titulo="Esta mensagem tem os dois tipos ao mesmo tempo"
              acoes={
                <button
                  type="button" className="btn btn-secondary" style={{ minHeight: 36 }}
                  onClick={() => p('botoes', converterBotoes(c.botoes, 'resposta'))}
                >Converter tudo para resposta</button>
              }
            >
              Só dá para chegar aqui pelo editor de JSON cru. Do jeito que está, a Meta recusa o
              envio inteiro — escolha um dos dois tipos acima antes de publicar.
            </Faixa>
          ) : null}
          {!ehLink && quantosBotoes > LIMITES_DO_CANAL.botoesMax ? (
            <Faixa tom="erro" titulo={`${quantosBotoes} botões de resposta — o teto é ${LIMITES_DO_CANAL.botoesMax}`}>
              Remova {quantosBotoes - LIMITES_DO_CANAL.botoesMax}. Acima do teto a Meta recusa a
              mensagem inteira; para mais opções, use o bloco «Lista» (até {LIMITES_DO_CANAL.listaItensMax}).
            </Faixa>
          ) : null}
          {ehLink && quantosBotoes > 1 ? (
            <Faixa tom="erro" titulo={`${quantosBotoes} botões de link — o canal aceita 1`}>
              Deixe só um. Os demais não são enviados, e a mensagem pode ser recusada por inteiro.
            </Faixa>
          ) : null}

          <ListaEditavel
            titulo={ehLink ? 'Botão de link' : `Botões de resposta (${quantosBotoes}/${LIMITES_DO_CANAL.botoesMax})`}
            itens={c.botoes}
            teto={ehLink ? 1 : LIMITES_DO_CANAL.botoesMax}
            aoMudar={(v) => p('botoes', v)}
            novoItem={(i) => (ehLink
              ? { id: `link_${i + 1}`, rotulo: 'Abrir', tipo: 'url', url: 'https://' }
              : { id: `botao_${i + 1}`, rotulo: `Botão ${i + 1}`, tipo: 'resposta' })}
            renderizar={(item, mudar) => (
              <>
                <CampoTexto rotulo="Identificador (vira a saída no desenho)" valor={item.id} aoMudar={(v) => mudar({ ...item, id: v })} />
                <CampoTexto rotulo="Rótulo do botão" teto={LIMITES_DO_CANAL.botaoRotulo} valor={item.rotulo} aoMudar={(v) => mudar({ ...item, rotulo: v })} />
                {item.tipo === 'url' ? (
                  <>
                    <CampoTexto
                      rotulo="Endereço que o botão abre" dica="https — aceita variáveis"
                      valor={item.url} aoMudar={(v) => mudar({ ...item, url: v })}
                    />
                    {/* Dito aqui porque é a surpresa mais cara deste tipo de botão: o desenho
                        mostra uma saída que, na prática, nunca é percorrida. */}
                    <div style={{ fontSize: '0.7rem', color: T.mut, lineHeight: 1.45 }}>
                      Botão de link não devolve resposta: o cliente sai para o navegador e não
                      volta com nada. A saída dele no desenho não chega a ser percorrida — quem
                      recebe a conversa depois é a exceção «sem resposta».
                    </div>
                  </>
                ) : null}
              </>
            )}
          />
          <CampoDeEspera valor={c.esperaResposta} obrigatorio aoMudar={(v) => p('esperaResposta', v)} />
        </>
      );
    }

    case 'espera':
      return <CampoDeEspera rotulo="Quanto tempo esperar antes de seguir" valor={c.duracao} obrigatorio aoMudar={(v) => p('duracao', v)} />;

    case 'condicao':
      return (
        <>
          <CampoSelecao
            rotulo="Como juntar as regras" valor={c.combinador || 'e'} vazio="e (todas precisam valer)"
            aoMudar={(v) => p('combinador', v || 'e')}
            opcoes={[{ valor: 'e', rotulo: 'e — todas precisam valer' }, { valor: 'ou', rotulo: 'ou — basta uma valer' }]}
          />
          <ListaEditavel
            titulo="Regras"
            itens={c.regras}
            aoMudar={(v) => p('regras', v)}
            novoItem={() => ({ variavel: '', operador: 'igual', valor: '' })}
            renderizar={(r, mudar) => (
              <>
                <CampoTexto rotulo="Variável" valor={r.variavel} aoMudar={(v) => mudar({ ...r, variavel: v })} />
                <CampoSelecao
                  rotulo="Operador" valor={r.operador} vazio="igual"
                  aoMudar={(v) => mudar({ ...r, operador: v || 'igual' })}
                  opcoes={[
                    { valor: 'igual', rotulo: 'é igual a' }, { valor: 'diferente', rotulo: 'é diferente de' },
                    { valor: 'contem', rotulo: 'contém' }, { valor: 'existe', rotulo: 'existe' },
                    { valor: 'vazio', rotulo: 'está vazia' }, { valor: 'maior', rotulo: 'é maior que' },
                    { valor: 'menor', rotulo: 'é menor que' },
                  ]}
                />
                <CampoTexto rotulo="Valor de comparação" valor={r.valor} aoMudar={(v) => mudar({ ...r, valor: v })} />
              </>
            )}
          />
          <Faixa tom="info" titulo="Janela de horário">
            Para condicionar por horário, o fuso é obrigatório (por exemplo America/Fortaleza).
            Sem fuso o motor recusa o bloco.
          </Faixa>
          <div style={{ height: 8 }} />
          <CampoTexto rotulo="Fuso horário" dica="IANA, ex.: America/Fortaleza" valor={c.horario?.fuso} aoMudar={(v) => p('horario', v ? { ...(c.horario || {}), fuso: v } : undefined)} />
          {c.horario?.fuso ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <CampoTexto rotulo="Das" dica="HH:MM" valor={c.horario?.de} aoMudar={(v) => p('horario', { ...(c.horario || {}), de: v })} />
              </div>
              <div style={{ flex: 1 }}>
                <CampoTexto rotulo="Até" dica="HH:MM" valor={c.horario?.ate} aoMudar={(v) => p('horario', { ...(c.horario || {}), ate: v })} />
              </div>
            </div>
          ) : null}
        </>
      );

    case 'http':
      return (
        <>
          <CampoSelecao
            rotulo="Método" valor={c.metodo || 'GET'} vazio="GET"
            aoMudar={(v) => p('metodo', v || 'GET')}
            opcoes={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ valor: m, rotulo: m }))}
          />
          <CampoTexto rotulo="Endereço" dica="https, com o host fixo" valor={c.url} aoMudar={(v) => p('url', v)} />
          <CampoTexto
            rotulo="Considerar sucesso nestes códigos" dica="separados por vírgula"
            valor={listaParaTexto(c.sucessoQuando?.status)}
            aoMudar={(v) => p('sucessoQuando', { ...(c.sucessoQuando || {}), status: textoParaLista(v).map(Number).filter(Number.isFinite) })}
          />
          <ListaEditavel
            titulo="Extrair campos da resposta"
            itens={c.extrair}
            aoMudar={(v) => p('extrair', v)}
            novoItem={() => ({ caminho: '', para: '' })}
            renderizar={(x, mudar) => (
              <>
                <CampoTexto rotulo="Caminho no JSON" dica="ex.: dados.protocolo" valor={x.caminho} aoMudar={(v) => mudar({ ...x, caminho: v })} />
                <CampoTexto rotulo="Guardar na variável" valor={x.para} aoMudar={(v) => mudar({ ...x, para: v })} />
              </>
            )}
          />
          <CampoTexto rotulo="Tempo limite (ms)" tipo="number" valor={c.tempoLimiteMs} aoMudar={(v) => p('tempoLimiteMs', v === '' ? undefined : Number(v))} />
          <Faixa tom="aviso" titulo="Este nó não é exercido pelo modo de teste">
            O teste nunca faz chamada externa: ele para aqui e devolve o aviso. A saída
            «erro» precisa de destino mesmo assim — é por ela que a conversa segue quando o
            outro lado não responde.
          </Faixa>
        </>
      );

    case 'variavel':
      return (
        <ListaEditavel
          titulo="Atribuições"
          itens={c.atribuicoes}
          aoMudar={(v) => p('atribuicoes', v)}
          novoItem={() => ({ para: '', operacao: 'definir', de: '' })}
          renderizar={(a, mudar) => (
            <>
              <CampoTexto rotulo="Variável de destino" valor={a.para} aoMudar={(v) => mudar({ ...a, para: v })} />
              <CampoSelecao
                rotulo="Operação" valor={a.operacao} vazio="definir"
                aoMudar={(v) => mudar({ ...a, operacao: v || 'definir' })}
                opcoes={[
                  { valor: 'definir', rotulo: 'definir com o valor' },
                  { valor: 'copiar', rotulo: 'copiar de outra variável' },
                  { valor: 'cortar', rotulo: 'cortar em N caracteres' },
                  { valor: 'limpar', rotulo: 'limpar' },
                ]}
              />
              <CampoTexto rotulo="Origem / valor" valor={a.de} aoMudar={(v) => mudar({ ...a, de: v })} />
              {a.operacao === 'cortar' ? (
                <CampoTexto rotulo="Tamanho" dica="(exigido por 'cortar')" tipo="number" valor={a.tamanho} aoMudar={(v) => mudar({ ...a, tamanho: v === '' ? undefined : Number(v) })} />
              ) : null}
            </>
          )}
        />
      );

    case 'etiqueta':
      return (
        <>
          <CampoTexto rotulo="Etiquetas a aplicar" dica="separadas por vírgula" valor={listaParaTexto(c.aplicar)} aoMudar={(v) => p('aplicar', textoParaLista(v))} />
          <CampoTexto rotulo="Etiquetas a remover" dica="separadas por vírgula" valor={listaParaTexto(c.remover)} aoMudar={(v) => p('remover', textoParaLista(v))} />
          {(c.aplicar || []).some((x) => (c.remover || []).includes(x)) ? (
            <Faixa tom="erro" titulo="A mesma etiqueta está nas duas listas">
              Aplicar e remover a mesma etiqueta no mesmo nó é erro no motor.
            </Faixa>
          ) : null}
        </>
      );

    case 'time':
      return (
        <>
          <CampoTexto rotulo="Nome do time" valor={c.time} aoMudar={(v) => p('time', v)} />
          <CampoTexto rotulo="Identificador do time" dica="opcional, se houver" valor={c.timeId} aoMudar={(v) => p('timeId', v || undefined)} />
          <CampoTexto rotulo="Mensagem ao encaminhar" linhas={3} valor={c.mensagem} aoMudar={(v) => p('mensagem', v)} />
          <Faixa tom="info" titulo="Este nó é terminal">
            Depois dele a conversa sai do robô e vai para gente. Por isso ele não tem saídas.
          </Faixa>
        </>
      );

    case 'notificar':
      return (
        <>
          <CampoSelecao
            rotulo="Canal" valor={c.canal} vazio="— escolha —" aoMudar={(v) => p('canal', v)}
            opcoes={[
              { valor: 'whatsapp', rotulo: 'WhatsApp' }, { valor: 'email', rotulo: 'E-mail' },
              { valor: 'interno', rotulo: 'Aviso interno' },
            ]}
          />
          <ListaEditavel
            titulo="Destinatários"
            itens={c.destinatarios}
            aoMudar={(v) => p('destinatarios', v)}
            novoItem={() => ({ tipo: 'papel', valor: '' })}
            renderizar={(d, mudar) => (
              <>
                <CampoSelecao
                  rotulo="Tipo" valor={d.tipo} vazio="papel" aoMudar={(v) => mudar({ ...d, tipo: v || 'papel' })}
                  opcoes={[
                    { valor: 'papel', rotulo: 'Papel (plantão, gestor…)' },
                    { valor: 'time', rotulo: 'Time' },
                    { valor: 'usuario', rotulo: 'Usuário' },
                  ]}
                />
                <CampoTexto rotulo="Valor" valor={d.valor} aoMudar={(v) => mudar({ ...d, valor: v })} />
              </>
            )}
            avisoDeTeto={
              <Faixa tom="aviso" titulo="Número de telefone cravado é erro">
                Use um PAPEL (plantão, gestor de conta). Telefone escrito no fluxo continua tocando
                o celular de quem já saiu da empresa.
              </Faixa>
            }
          />
          <CampoTexto rotulo="Assunto" valor={c.assunto} aoMudar={(v) => p('assunto', v)} />
          <CampoTexto rotulo="Corpo" linhas={3} valor={c.corpo} aoMudar={(v) => p('corpo', v)} />
        </>
      );

    case 'email': {
      // Os três obrigatórios são conferidos AQUI e agora, campo a campo. Deixar para a publicação
      // recusar significa o operador descobrir o que faltou depois de sair da tela do bloco.
      const semPara = !String(c.para ?? '').trim();
      const semAssunto = !String(c.assunto ?? '').trim();
      const semCorpo = !String(c.corpo ?? '').trim();
      return (
        <>
          <AjudaDeVariaveis doFluxo={variaveisDoFluxo} />
          <CampoTexto
            rotulo="Para" dica="(obrigatório) — vários endereços separados por vírgula"
            valor={c.para} aoMudar={(v) => p('para', v)}
          />
          {semPara ? (
            <Faixa tom="erro" titulo="Sem destinatário este bloco não manda nada">
              O envio falha e a conversa sai pela saída «erro interno». Escreva o endereço, ou
              uma variável que o contenha.
            </Faixa>
          ) : null}
          <CampoTexto rotulo="Assunto" dica="(obrigatório)" valor={c.assunto} aoMudar={(v) => p('assunto', v)} />
          {semAssunto ? (
            <Faixa tom="erro" titulo="Sem assunto o e-mail vira spam antes de ser lido">
              Assunto é obrigatório — servidores de destino pontuam mensagem sem assunto como lixo.
            </Faixa>
          ) : null}
          <CampoTexto rotulo="Corpo" dica="(obrigatório)" linhas={6} valor={c.corpo} aoMudar={(v) => p('corpo', v)} />
          {semCorpo ? (
            <Faixa tom="erro" titulo="Sem corpo não há mensagem">
              Escreva o texto do e-mail. Ele aceita as mesmas variáveis dos blocos de conversa.
            </Faixa>
          ) : null}
          <CampoTexto
            rotulo="Responder para" dica="opcional — para onde vai a resposta de quem receber"
            valor={c.responderPara} aoMudar={(v) => p('responderPara', v || undefined)}
          />
          <CampoTexto
            rotulo="Cópia oculta" dica="opcional — os outros destinatários não veem"
            valor={c.copiaOculta} aoMudar={(v) => p('copiaOculta', v || undefined)}
          />
          <Faixa tom="aviso" titulo="Este bloco não fala com o cliente pelo canal">
            Ele manda um e-mail pelo SMTP da empresa. Se o SMTP não estiver configurado, o envio
            falha e a conversa segue pela saída «erro interno» — ligue essa saída a algum lugar.
          </Faixa>
        </>
      );
    }

    case 'subfluxo':
      return (
        <>
          <CampoSelecao
            rotulo="Modo" dica="(obrigatório, sem padrão)" valor={c.modo} aoMudar={(v) => p('modo', v || undefined)}
            opcoes={[
              { valor: 'chamar', rotulo: 'Chamar e voltar (tem saída «segue»)' },
              { valor: 'saltar', rotulo: 'Saltar sem voltar (não tem saída)' },
            ]}
          />
          <CampoSelecao
            rotulo="Fluxo de destino" dica="tem de ser da mesma empresa" valor={c.fluxoId}
            aoMudar={(v) => p('fluxoId', v)}
            opcoes={(fluxosDaEmpresa || []).map((f) => ({ valor: f.id, rotulo: f.nome }))}
          />
          <Faixa tom="aviso" titulo="O modo de teste não entra em sub-fluxo">
            Ele para aqui e avisa. Para conferir o sub-fluxo, abra o fluxo dele e teste lá dentro.
          </Faixa>
        </>
      );

    case 'chamado':
      return (
        <>
          <CampoTexto rotulo="Onde guardar o número do chamado" dica="padrão: protocolo" valor={c.para ?? 'protocolo'} aoMudar={(v) => p('para', v)} />
          <CampoTexto rotulo="Etiquetas do chamado" dica="separadas por vírgula" valor={listaParaTexto(c.etiquetas)} aoMudar={(v) => p('etiquetas', textoParaLista(v))} />
          <CampoTexto rotulo="Nota interna" linhas={3} valor={typeof c.notaInterna === 'string' ? c.notaInterna : ''} aoMudar={(v) => p('notaInterna', v || undefined)} />
          <CampoTexto rotulo="Campos obrigatórios" dica="separados por vírgula" valor={listaParaTexto(c.camposObrigatorios)} aoMudar={(v) => p('camposObrigatorios', textoParaLista(v))} />
        </>
      );

    case 'encerrar':
      return (
        <>
          <CampoTexto rotulo="Mensagem de despedida" linhas={3} valor={lerCorpo(c.corpo)} aoMudar={(v) => p('corpo', v)} />
          <Interruptor marcado={c.resolver !== false} aoMudar={(v) => p('resolver', v)}>
            Marcar a conversa como resolvida
          </Interruptor>
          <CampoTexto rotulo="Etiquetas ao encerrar" dica="separadas por vírgula" valor={listaParaTexto(c.etiquetas)} aoMudar={(v) => p('etiquetas', textoParaLista(v))} />
          <Interruptor marcado={c.avaliacao?.ativa} aoMudar={(v) => p('avaliacao', v ? { ...(c.avaliacao || {}), ativa: true } : undefined)}>
            Pedir avaliação do atendimento
          </Interruptor>
          {c.avaliacao?.ativa ? (
            <CampoTexto rotulo="Pergunta da avaliação" valor={c.avaliacao?.pergunta} aoMudar={(v) => p('avaliacao', { ...(c.avaliacao || {}), pergunta: v })} />
          ) : null}
        </>
      );

    default:
      return <Vazio>Tipo de nó desconhecido: {no.tipo}</Vazio>;
  }
}

/**
 * PAINEL DE INSPEÇÃO. Abas: Conteúdo · Exceções · Prévia · Avançado.
 * A aba «Exceções» só existe nos três tipos que estacionam - e neles ela é a mais importante.
 */
function PainelDeInspecao({
  no, catalogo, problemas, previa, carregandoPrevia, fluxosDaEmpresa, nosDisponiveis,
  variaveisDoFluxo,
  somenteLeitura, aoAlterarNo, aoTrocarConfig, aoApagar, aoDuplicar, aoFechar, aoPedirPrevia,
  aoApagarAresta,
}) {
  const [aba, setAba] = useState('conteudo');
  const meta = metaDoTipo(no.tipo, catalogo);
  // Bloco que a TELA sabe desenhar mas o MOTOR daquele servidor ainda não conhece (o e-mail é o
  // caso do momento). Dá para rascunhar, mas a publicação recusa com TIPO_DE_NO_DESCONHECIDO —
  // e descobrir isso na hora de publicar é descobrir tarde. Só acusamos quando o servidor mandou
  // catálogo de verdade: sem catálogo, quem responde é o espelho local e não há divergência a medir.
  const tipoDesconhecidoNoServidor = !!catalogo?.tipos && !catalogo.tipos[no.tipo];
  const abas = [
    { id: 'conteudo', rotulo: 'Conteúdo' },
    ...(meta.estaciona ? [{ id: 'excecoes', rotulo: 'Exceções' }] : []),
    { id: 'previa', rotulo: 'Prévia' },
    { id: 'avancado', rotulo: 'Avançado' },
  ];

  return (
    <div className="rgfx-lateral" style={{ ...cartao, padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: `1px solid ${T.borda}`,
      }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 900, padding: '2px 5px', borderRadius: 4,
          background: COR_DA_FAMILIA[meta.familia] || T.borda2, color: T.sobrePrimaria,
        }}>{meta.sigla}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {no.titulo || no.id}
          </div>
          <div style={{ fontSize: '0.7rem', color: T.mut }}>{meta.rotulo} · {no.id}</div>
        </div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar inspeção">
          <X size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${T.borda}` }}>
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            style={{
              flex: 1, minHeight: 40, border: 0, cursor: 'pointer', fontSize: '0.76rem',
              fontWeight: aba === a.id ? 800 : 500,
              background: aba === a.id ? T.alto : 'transparent',
              color: aba === a.id ? T.ink : T.mut,
              borderBottom: `2px solid ${aba === a.id ? T.primaria : 'transparent'}`,
            }}
          >{a.rotulo}</button>
        ))}
      </div>

      <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
        {problemas.length ? (
          <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            {problemas.map((pr, i) => (
              <Faixa
                key={i}
                tom={pr.nivel === 'erro' ? 'erro' : 'aviso'}
                titulo={pr.codigo}
                /* A aresta fantasma não tem linha no desenho nem pino para tocar: sem um botão
                   aqui, o único jeito de apagá-la seria editar o JSON cru. */
                acoes={pr.acao?.tipo === 'apagarAresta' && !somenteLeitura && aoApagarAresta ? (
                  <button
                    type="button" className="btn btn-secondary"
                    style={{ minHeight: 36, color: T.perigo, borderColor: T.perigo }}
                    onClick={() => aoApagarAresta(pr.acao.de, pr.acao.saida)}
                  >
                    <Trash2 size={13} /> {pr.acao.rotulo}
                  </button>
                ) : null}
              >
                {pr.mensagem}
                {pr.comoCorrigir ? <div style={{ marginTop: 4, color: T.mut }}>{pr.comoCorrigir}</div> : null}
              </Faixa>
            ))}
          </div>
        ) : null}

        {aba === 'conteudo' ? (
          <>
            {tipoDesconhecidoNoServidor ? (
              <Faixa tom="aviso" titulo={`O motor deste servidor ainda não conhece o bloco «${meta.rotulo}»`}>
                Dá para desenhar e salvar o rascunho, mas a publicação vai recusar com
                TIPO_DE_NO_DESCONHECIDO até o motor subir com este tipo.
              </Faixa>
            ) : null}
            <CampoTexto
              rotulo="Título do bloco" dica="só aparece no desenho"
              valor={no.titulo} aoMudar={(v) => aoAlterarNo(no.id, { titulo: v })}
            />
            <FormularioDeNo
              no={no} config={no.config}
              aoMudarConfig={(cfg) => aoTrocarConfig(no.id, cfg)}
              fluxosDaEmpresa={fluxosDaEmpresa}
              variaveisDoFluxo={variaveisDoFluxo}
            />
          </>
        ) : null}

        {aba === 'excecoes' ? (
          <BlocoDeExcecoes
            excecoes={no.config?.excecoes}
            nosDisponiveis={nosDisponiveis}
            aoMudar={(v) => aoTrocarConfig(no.id, { ...(no.config || {}), excecoes: v })}
          />
        ) : null}

        {aba === 'previa' ? (
          <PreviaDoNo previa={previa} carregando={carregandoPrevia} aoPedir={aoPedirPrevia} />
        ) : null}

        {aba === 'avancado' ? (
          <>
            <Faixa tom="aviso" titulo="Trocar o identificador quebra a correlação">
              O `id` aparece nas arestas, na telemetria e nos incidentes. Renomear cria órfãos na
              publicação e apaga o histórico de medição deste nó. Só faça isso antes da primeira
              publicação.
            </Faixa>
            <div style={{ height: 10 }} />
            <Rotulo>Configuração crua (JSON)</Rotulo>
            <EditorDeJson
              valor={no.config || {}}
              somenteLeitura={somenteLeitura}
              aoMudar={(v) => aoTrocarConfig(no.id, v)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => aoDuplicar(no.id)} disabled={somenteLeitura}>
                <Copy size={14} /> Duplicar
              </button>
              <button
                className="btn btn-secondary" style={{ flex: 1, color: T.perigo, borderColor: T.perigo }}
                onClick={() => aoApagar(no.id)} disabled={somenteLeitura}
              >
                <Trash2 size={14} /> Apagar nó
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Editor de JSON com recusa visível: texto inválido NUNCA vira config. */
function EditorDeJson({ valor, aoMudar, somenteLeitura }) {
  const [texto, setTexto] = useState(() => JSON.stringify(valor ?? {}, null, 2));
  const [erroDeSintaxe, setErroDeSintaxe] = useState(null);
  const refValor = useRef(valor);
  useEffect(() => {
    // Só reescreve o texto quando o valor mudou POR FORA (outro nó selecionado, recarregar).
    if (JSON.stringify(refValor.current) !== JSON.stringify(valor)) {
      refValor.current = valor;
      setTexto(JSON.stringify(valor ?? {}, null, 2));
      setErroDeSintaxe(null);
    }
  }, [valor]);
  return (
    <>
      <textarea
        rows={12} value={texto} readOnly={somenteLeitura}
        onChange={(ev) => {
          setTexto(ev.target.value);
          try {
            const obj = JSON.parse(ev.target.value);
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('precisa ser um objeto');
            setErroDeSintaxe(null);
            refValor.current = obj;
            aoMudar(obj);
          } catch (e) { setErroDeSintaxe(e.message); }
        }}
        style={{ ...campoEstilo, fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', resize: 'vertical' }}
      />
      {erroDeSintaxe ? (
        <div style={{ fontSize: '0.72rem', color: T.perigo, marginTop: 4 }}>
          JSON inválido ({erroDeSintaxe}) — nada foi gravado enquanto isso não se resolver.
        </div>
      ) : null}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 8. PRÉVIA E MODO DE TESTE
//
// ⚠️ A PRÉVIA VEM DO SERVIDOR, SEMPRE. Os títulos de lista e os rótulos de botão nas intenções JÁ
// CHEGAM CORTADOS por `cortarSeguro` do motor - o que a tela desenha é o texto REAL que o cliente
// vai receber. Essa é a diferença entre aviso e adivinhação, e é por isso que nenhuma linha desta
// tela conta caractere.
//
// Os campos que começam com "_" (`_achados`, `_excedeuBotoes`) são diagnóstico interno do motor:
// são LIDOS para avisar e NUNCA exibidos como se fossem conteúdo da mensagem.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Resumo dos `_achados` do motor.
 *
 * ⚠️ O que `interpolar()` devolve é `{valor, ausentes, cortadas, estourou}` (mais `campo`, `teto` e
 * `aoEstourar` quando o executor os anexa). NÃO existe `mensagem` nem `codigo` ali. O rodapé antigo
 * caía no `JSON.stringify(a)` e despejava o objeto inteiro — inclusive o `valor`, que JÁ É o corpo
 * do balão — em cor de aviso, em TODA intenção: como o corpo sempre entra em `_achados`,
 * `achados.length` nunca era zero e o aviso ficava permanentemente ligado. Aviso que aparece sempre
 * não é aviso, e o balão deixava de ser «o texto que o cliente recebe», que é a promessa da prévia.
 *
 * Aqui só falam as coisas que o operador precisa saber, e o rodapé some quando não há nada a dizer.
 * Nada é contado nesta tela: quem mediu, cortou e sinalizou foi o motor.
 */
function resumirAchados(achados) {
  const ausentes = [];
  const cortes = [];
  const avulsos = [];
  const vistos = new Set();
  for (const a of achados || []) {
    if (!a) continue;
    if (typeof a === 'string') { if (!avulsos.includes(a)) avulsos.push(a); continue; }
    if (typeof a !== 'object') continue;
    for (const v of Array.isArray(a.ausentes) ? a.ausentes : []) {
      if (v && !ausentes.includes(v)) ausentes.push(v);
    }
    for (const c of Array.isArray(a.cortadas) ? a.cortadas : []) {
      // `variavel` vale '(campo inteiro)' quando o corte pegou o texto todo; nesse caso quem
      // identifica o corte é o `campo` do achado (`config.itens[3].titulo`), e é ele que vai à tela.
      const nome = c?.variavel && c.variavel !== '(campo inteiro)' ? c.variavel : (a.campo || '(campo inteiro)');
      const reserva = Number.isFinite(Number(c?.reserva)) ? Number(c.reserva) : null;
      const chave = `${nome}|${reserva ?? ''}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      cortes.push({ nome, reserva });
    }
    // Achado de formato futuro que traga texto pronto: mostramos o texto, nunca o objeto cru.
    if (typeof a.mensagem === 'string' && a.mensagem && !avulsos.includes(a.mensagem)) avulsos.push(a.mensagem);
  }
  return { ausentes, cortes, avulsos };
}

/** Uma intenção de saída desenhada como a mensagem chegaria no WhatsApp. */
function Intencao({ intencao }) {
  const i = intencao || {};
  const balao = {
    background: T.sup, border: `1px solid ${T.borda}`, borderRadius: '12px 12px 12px 4px',
    padding: 10, fontSize: '0.82rem', color: T.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  };
  // Alguns executores mandam UM achado, outros um array. Tratar só o array descartava o primeiro.
  const achados = Array.isArray(i._achados) ? i._achados : (i._achados ? [i._achados] : []);
  const { ausentes, cortes, avulsos } = resumirAchados(achados);
  // Descarte silencioso de opção é a pior das falhas de prévia: o motor já sinaliza, e a tela lê.
  const itensDescartados = Array.isArray(i._itensDescartados) ? i._itensDescartados : [];
  const temAlgoADizer = ausentes.length || cortes.length || avulsos.length
    || i._excedeuBotoes || i._excedeuItens || itensDescartados.length;

  const rodapeDeAchados = temAlgoADizer ? (
    <div style={{ marginTop: 6, fontSize: '0.7rem', color: T.aviso }}>
      {ausentes.length ? <div>Variáveis sem valor: {ausentes.join(', ')}.</div> : null}
      {cortes.length ? (
        <div>
          Texto cortado no limite do canal:{' '}
          {cortes.map((c) => `${c.nome}${c.reserva != null ? ` (${c.reserva})` : ''}`).join(', ')}.
        </div>
      ) : null}
      {i._excedeuBotoes ? (
        <div>Botões acima do teto do canal — a Meta recusaria a mensagem inteira.</div>
      ) : null}
      {i._excedeuItens ? (
        <div>
          Itens acima do teto do canal
          {itensDescartados.length ? `; descartados: ${itensDescartados.join(', ')}` : ''}.
        </div>
      ) : null}
      {avulsos.map((m, k) => <div key={k}>{m}</div>)}
    </div>
  ) : null;

  if (i.tipo === 'texto') {
    return <div style={balao}>{i.corpo}{rodapeDeAchados}</div>;
  }
  if (i.tipo === 'midia') {
    return (
      <div style={balao}>
        <Etiqueta tom="info">mídia</Etiqueta>
        <div style={{ marginTop: 6, wordBreak: 'break-all', color: T.sec }}>{i.url || i.corpo || ''}</div>
        {i.legenda ? <div style={{ marginTop: 4 }}>{i.legenda}</div> : null}
        {rodapeDeAchados}
      </div>
    );
  }
  if (i.tipo === 'lista') {
    // O agrupamento é desenhado com a MESMA função do formulário: prévia que agrupa de um jeito e
    // formulário de outro seria duas verdades sobre a mesma lista.
    const grupos = agruparPorSecao(i.itens);
    return (
      <div style={balao}>
        {i.cabecalho ? <div style={{ fontWeight: 800, marginBottom: 4 }}>{i.cabecalho}</div> : null}
        <div>{i.corpo}</div>
        {i.rodape ? <div style={{ color: T.mut, fontSize: '0.74rem', marginTop: 4 }}>{i.rodape}</div> : null}
        <div style={{ marginTop: 8, border: `1px solid ${T.borda}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '6px 8px', background: T.alto, fontSize: '0.74rem', fontWeight: 700 }}>
            {i.rotuloBotao || 'Escolher'}
          </div>
          {grupos.map((g) => (
            <div key={g.nome || '(sem seção)'}>
              {g.nome ? (
                <div style={{
                  padding: '4px 8px', borderTop: `1px solid ${T.borda}`, background: T.sup,
                  fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase',
                  letterSpacing: '.04em', color: T.mut,
                }}>{g.nome}</div>
              ) : null}
              {g.itens.map((it) => (
                <div key={it.id} style={{ padding: '6px 8px', borderTop: `1px solid ${T.borda}` }}>
                  <div style={{ fontWeight: 600 }}>{it.titulo}</div>
                  {it.descricao ? <div style={{ fontSize: '0.72rem', color: T.mut }}>{it.descricao}</div> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
        {rodapeDeAchados}
      </div>
    );
  }
  if (i.tipo === 'botoes') {
    const modo = tipoDosBotoes(i.botoes);
    return (
      <div style={balao}>
        {i.cabecalho ? <div style={{ fontWeight: 800, marginBottom: 4 }}>{i.cabecalho}</div> : null}
        <div>{i.corpo}</div>
        {i.rodape ? <div style={{ color: T.mut, fontSize: '0.74rem', marginTop: 4 }}>{i.rodape}</div> : null}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {(i.botoes || []).map((b) => (
            <span
              key={b.id}
              title={b.tipo === 'url' ? `Abre ${b.url || 'um endereço'} — não devolve resposta` : 'Botão de resposta'}
              style={{
                padding: '6px 10px', borderRadius: 8,
                border: `1px solid ${b.tipo === 'url' ? T.aviso : T.info}`,
                color: b.tipo === 'url' ? T.aviso : T.info, fontSize: '0.76rem', fontWeight: 600,
                textDecoration: b.tipo === 'url' ? 'underline' : 'none',
              }}
            >{b.tipo === 'url' ? '🔗 ' : ''}{b.rotulo}</span>
          ))}
        </div>
        {/* A mistura é a única falha deste bloco que faz a Meta descartar a mensagem TODA — se ela
            chegou até a prévia, precisa gritar aqui também, e não só no formulário. */}
        {modo === 'misturado' ? (
          <div style={{ marginTop: 6, fontSize: '0.7rem', color: T.perigo, fontWeight: 700 }}>
            Botão de resposta e botão de link na mesma mensagem — a Meta recusa o envio inteiro.
          </div>
        ) : null}
        {rodapeDeAchados}
      </div>
    );
  }
  // As demais intenções não são mensagem para o cliente: são efeito no sistema. Ficam discretas,
  // mas aparecem - o operador precisa ver que o nó carimba, atribui, etiqueta ou resolve.
  const descricao = {
    carimbar: 'Carimba os atributos da conversa',
    atribuir: `Atribui ao time ${i.time || i.timeId || ''}`,
    etiqueta: `Etiquetas — aplica ${(i.aplicar || []).join(', ') || 'nenhuma'}; remove ${(i.remover || []).join(', ') || 'nenhuma'}`,
    nota: 'Nota interna (o cliente não vê)',
    resolver: 'Marca a conversa como resolvida',
  }[i.tipo] || `Efeito interno: ${i.tipo}`;
  return (
    <div style={{ ...balao, background: 'transparent', borderStyle: 'dashed', color: T.mut, fontSize: '0.76rem' }}>
      {descricao}
      {i.corpo ? <div style={{ marginTop: 4, color: T.sec }}>{i.corpo}</div> : null}
      {rodapeDeAchados}
    </div>
  );
}

function PreviaDoNo({ previa, carregando, aoPedir }) {
  if (carregando) {
    return <div style={{ color: T.mut, fontSize: '0.84rem' }}><div className="spinner" style={{ margin: '0 auto 10px' }} />Perguntando ao motor…</div>;
  }
  if (!previa) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Faixa tom="info" titulo="A prévia é feita pelo motor, não pela tela">
          Ela roda a mesma função `preparar()` que envia a mensagem de verdade — por isso o texto
          aqui é o texto que o cliente receberia, já cortado nos limites do canal.
        </Faixa>
        <button className="btn btn-secondary" onClick={() => aoPedir()}><Play size={14} /> Gerar a prévia</button>
      </div>
    );
  }
  if (previa.indisponivel) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Faixa tom="aviso" titulo="A prévia por nó ainda não está disponível">
          {previa.indisponivel}
        </Faixa>
        <Faixa tom="info" titulo="O caminho que funciona hoje">
          Use o modo de teste (o botão «Testar» na barra do editor). Ele percorre o fluxo com os
          mesmos executores e devolve as mensagens já preparadas.
        </Faixa>
        <button className="btn btn-secondary" onClick={() => aoPedir()}><RefreshCw size={14} /> Tentar de novo</button>
      </div>
    );
  }
  const problemas = previa.problemas || [];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <button className="btn btn-secondary" onClick={() => aoPedir()}><RefreshCw size={14} /> Atualizar a prévia</button>
      {problemas.length ? problemas.map((p, i) => (
        <Faixa key={i} tom={p.nivel === 'erro' ? 'erro' : 'aviso'} titulo={p.codigo}>
          {p.mensagem}
          {p.comoCorrigir ? <div style={{ marginTop: 4, color: T.mut }}>{p.comoCorrigir}</div> : null}
        </Faixa>
      )) : <Faixa tom="ok" titulo="O motor não encontrou problema neste nó">Nada a corrigir por aqui.</Faixa>}
      <div style={{ display: 'grid', gap: 8 }}>
        {(previa.intencoes || []).map((i, k) => <Intencao key={k} intencao={i} />)}
      </div>
      {/* As medições vêm do servidor prontas — a tela desenha a barra, nunca faz a conta.
          Enquanto a rota não devolver `medidas`, nada é desenhado aqui: barra sem medição do motor
          seria adivinhação com cara de aviso. */}
      {(previa.medidas || []).map((m, k) => (
        <AvisoDeLimite
          key={k}
          medido={m.medido} teto={m.teto} oQueE={m.oQueE || m.campo}
          origemDoPerfil={previa.limites?.origem} unidadeDeContagem={previa.limites?.unidade}
        />
      ))}
      {previa.saidas?.length ? (
        <div style={{ fontSize: '0.74rem', color: T.mut }}>
          Saídas deste nó, segundo o motor: {previa.saidas.map(rotularSaida).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

/**
 * PAINEL DE TESTE. É o único componente que fala com `POST /fluxos/:id/testar`, e ele NUNCA escreve
 * no documento - o teste confere o fluxo, não o edita. O `estado` devolvido pelo servidor volta
 * INTEIRO no passo seguinte: a tela não interpreta nem remenda esse objeto.
 */
function PainelDeTeste({ fluxoId, origem, versaoNumero, aoDestacarTrilha, aoSelecionarNo, aoFechar }) {
  const [sessao, setSessao] = useState(null);
  const [conversa, setConversa] = useState([]);     // histórico visível: saídas e respostas
  const [parado, setParado] = useState(null);
  const [problemas, setProblemas] = useState([]);
  const [fim, setFim] = useState(null);
  const [limites, setLimites] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [texto, setTexto] = useState('');

  const passo = useCallback(async (corpoExtra) => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/testar`, {
        metodo: 'POST',
        corpo: { origem, ...(versaoNumero ? { versaoNumero } : {}), ...corpoExtra },
        tempoLimiteMs: 60000,
      });
      setSessao(r.estado || null);
      setConversa((c) => [...c, ...(r.saidas || []).map((s) => ({ lado: 'robo', intencao: s }))]);
      setParado(r.parado || null);
      setProblemas(r.problemas || []);
      setFim(r.fim || null);
      setLimites(r.limites || null);
      if (Array.isArray(r.trilha)) aoDestacarTrilha(r.trilha.map((t) => (Array.isArray(t) ? t[0] : t)));
      if (r.estado?.noAtualId) aoSelecionarNo(r.estado.noAtualId);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [fluxoId, origem, versaoNumero, aoDestacarTrilha, aoSelecionarNo]);

  const comecar = useCallback(() => {
    setConversa([]); setParado(null); setProblemas([]); setFim(null); setSessao(null);
    passo({});
  }, [passo]);

  const responder = useCallback((resposta, rotulo) => {
    setConversa((c) => [...c, { lado: 'cliente', texto: rotulo || (typeof resposta === 'string' ? resposta : JSON.stringify(resposta)) }]);
    setTexto('');
    passo({ estado: sessao, resposta });
  }, [passo, sessao]);

  return (
    <div className="rgfx-lateral" style={{ ...cartao, padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${T.borda}` }}>
        <Play size={16} style={{ color: T.primaria }} />
        <div style={{ flex: 1, fontWeight: 800, fontSize: '0.86rem' }}>
          Modo de teste {origem === 'versao' ? `· versão ${versaoNumero || 'publicada'}` : '· rascunho'}
        </div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar teste">
          <X size={15} />
        </button>
      </div>

      <div style={{ padding: 12, overflow: 'auto', flex: 1, display: 'grid', gap: 10, alignContent: 'start' }}>
        {/* O aviso mais importante é o que ninguém adivinharia: a janela de 24 h é sempre tratada
            como ABERTA no teste, então o caminho «sem janela» nunca é exercido aqui. */}
        <Faixa tom="info" titulo="O que o teste NÃO faz">
          Não envia mensagem, não faz chamada HTTP, não decifra segredo (devolve
          «[segredo:apelido]»), não entra em sub-fluxo e nada é gravado. O protocolo é
          TESTE-0000000000. E a janela de 24 horas é sempre tratada como ABERTA — logo o caminho
          «fora da janela de 24 h» nunca é percorrido aqui.
        </Faixa>

        {limites ? (
          <div style={{ fontSize: '0.72rem', color: T.mut }}>
            Perfil de limites: {limites.perfil}
            {limites.origem === 'documentacao' ? ' (documentação da Meta — palpite assumido)' : ` (${limites.origem})`}
            {limites.unidade && limites.unidade !== 'indefinida' ? ` · contagem em ${limites.unidade}` : ' · contagem pelo pior caso das três unidades'}.
          </div>
        ) : null}

        {erro ? (
          <Faixa tom="erro" titulo="O teste não rodou">
            {erro.message}
            {erro.status === 503 && erro.dados?.detalhe ? <div style={{ marginTop: 4 }}>{erro.dados.detalhe}</div> : null}
            {erro.status === 404 ? (
              <div style={{ marginTop: 4 }}>
                404 aqui quer dizer «fora do escopo OU rota ainda não montada em server.js» — nunca
                «sem permissão».
              </div>
            ) : null}
          </Faixa>
        ) : null}

        {!sessao && !carregando ? (
          <button className="btn btn-primary" onClick={() => comecar()}><Play size={14} /> Começar a conversa de teste</button>
        ) : null}

        <div style={{ display: 'grid', gap: 8 }}>
          {conversa.map((m, i) => (m.lado === 'robo'
            ? <Intencao key={i} intencao={m.intencao} />
            : (
              <div key={i} style={{
                alignSelf: 'flex-end', justifySelf: 'end', maxWidth: '85%', padding: '8px 10px',
                borderRadius: '12px 12px 4px 12px', background: T.infoDim, color: T.ink, fontSize: '0.82rem',
              }}>{m.texto}</div>
            )))}
        </div>

        {carregando ? <div style={{ color: T.mut, fontSize: '0.8rem' }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Percorrendo o fluxo…</div> : null}

        {parado ? (
          <div style={{ border: `1px solid ${T.borda}`, borderRadius: 10, padding: 10, background: T.sup }}>
            <div style={{ fontSize: '0.74rem', color: T.mut, marginBottom: 8 }}>
              O fluxo parou esperando resposta ({parado.motivo || 'aguardando'}).
              {parado.saidaAoVencer ? ` Se o tempo vencer, segue por «${rotularSaida(parado.saidaAoVencer)}».` : ''}
            </div>
            {(parado.opcoes || []).length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {parado.opcoes.map((o) => (
                  <button
                    key={o.id} className="btn btn-secondary" style={{ minHeight: 40 }}
                    onClick={() => responder({ interativo: o.id }, o.rotulo)}
                  >{o.rotulo}</button>
                ))}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={texto}
                placeholder="Escreva como se fosse o cliente…"
                onChange={(ev) => setTexto(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && texto.trim()) responder(texto.trim()); }}
                style={{ ...campoEstilo, flex: 1 }}
              />
              <button
                className="btn btn-primary" style={{ minHeight: 40 }}
                disabled={!texto.trim()} onClick={() => responder(texto.trim())}
              ><Send size={14} /></button>
            </div>
          </div>
        ) : null}

        {fim ? (
          <Faixa tom={fim.motivo === 'concluido' ? 'ok' : 'aviso'} titulo={`Fim: ${fim.motivo}`}>
            {fim.detalhe || TEXTO_DO_FIM[fim.motivo] || 'O teste chegou ao fim.'}
            {fim.noId ? <div style={{ marginTop: 4 }}>No nó «{fim.noId}».</div> : null}
          </Faixa>
        ) : null}

        {problemas.length ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 800, fontSize: '0.8rem' }}>Problemas encontrados pelo motor</div>
            {problemas.map((p, i) => {
              const noDoProblema = String(p.campo || '').split('.')[0];
              return (
                <Faixa
                  key={i}
                  tom={p.nivel === 'erro' ? 'erro' : 'aviso'}
                  titulo={p.codigo}
                  acoes={noDoProblema ? (
                    <button className="btn btn-secondary" style={{ minHeight: 34 }} onClick={() => aoSelecionarNo(noDoProblema)}>
                      Ver o nó
                    </button>
                  ) : null}
                >
                  {p.mensagem}
                  {p.comoCorrigir ? <div style={{ marginTop: 4, color: T.mut }}>{p.comoCorrigir}</div> : null}
                </Faixa>
              );
            })}
          </div>
        ) : null}

        {sessao ? (
          <button className="btn btn-secondary" onClick={() => comecar()}><RefreshCw size={14} /> Recomeçar do início</button>
        ) : null}
      </div>
    </div>
  );
}

// Tradução dos códigos de `fim.motivo` do modo de teste. Código cru na tela faz o operador
// procurar no código-fonte o que ele mesmo acabou de causar.
const TEXTO_DO_FIM = {
  aresta_ausente: 'A saída escolhida pelo motor não tem destino no desenho. Em produção, isso é a conversa terminando calada.',
  no_ausente: 'A aresta aponta para um nó que não existe no documento.',
  limite_visitas: 'O mesmo nó foi visitado vezes demais — provável laço.',
  tipo_desconhecido: 'O documento tem um tipo de nó que o motor não conhece.',
  nao_executavel_em_teste: 'Este nó não roda no modo de teste (chamada HTTP, sub-fluxo).',
  resultado_invalido: 'O executor devolveu um resultado que o motor não aceita.',
  subfluxo_nao_seguido: 'O teste não entra em sub-fluxo. Abra o fluxo de destino e teste lá.',
  concluido: 'O fluxo chegou ao fim normalmente.',
  resultado_desconhecido: 'O executor devolveu um tipo de resultado desconhecido.',
  teto_de_passos: 'O teste parou no teto de passos sem chegar a um fim. Provável laço.',
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 9. TELEMETRIA, INCIDENTES E EXECUÇÕES
// ════════════════════════════════════════════════════════════════════════════════════════════════

function PainelDeTelemetria({ fluxoId, telemetria, erro, carregando, aoRecarregar, aoSelecionarNo, aoFechar }) {
  const itens = telemetria?.itens || [];
  return (
    <div className="rgfx-lateral" style={{ ...cartao, padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${T.borda}` }}>
        <Activity size={16} style={{ color: T.info }} />
        <div style={{ flex: 1, fontWeight: 800, fontSize: '0.86rem' }}>
          Telemetria {telemetria?.versao ? `· versão ${telemetria.versao.numero}` : ''}
        </div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoRecarregar()}><RefreshCw size={14} /></button>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar telemetria"><X size={15} /></button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', flex: 1, display: 'grid', gap: 10, alignContent: 'start' }}>
        {carregando ? <div style={{ color: T.mut }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Consultando…</div> : null}
        {erro ? (
          <Faixa tom={erro.status === 409 ? 'info' : 'erro'} titulo={erro.status === 409 ? 'Ainda não há o que medir' : 'Não consegui ler a telemetria'}>
            {erro.message}
          </Faixa>
        ) : null}
        {telemetria?.periodo ? (
          <div style={{ fontSize: '0.74rem', color: T.mut }}>
            Período: {fmtHora(telemetria.periodo.de)} até {fmtHora(telemetria.periodo.ate)}.
            {telemetria.latencia?.saturada ? ' A amostra de latência saturou — os percentis são um piso, não o número exato.' : ''}
          </div>
        ) : null}
        {!carregando && !erro && !itens.length ? <Vazio>Nenhuma medição no período.</Vazio> : null}
        {itens.map((it) => (
          <button
            key={it.noId}
            type="button"
            onClick={() => aoSelecionarNo(it.noId)}
            style={{
              textAlign: 'left', border: `1px solid ${T.borda}`, borderRadius: 10, padding: 10,
              background: T.sup, color: T.ink, cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', flex: 1 }}>{it.titulo || it.noId}</span>
              {it.estaciona ? <Etiqueta tom="info">espera</Etiqueta> : null}
            </div>
            <div style={{ fontSize: '0.74rem', color: T.sec, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>{it.apresentados ?? 0} vistos</span>
              <span>{it.respondidos ?? 0} responderam</span>
              {it.semResposta ? <span style={{ color: T.aviso }}>{it.semResposta} sem resposta</span> : null}
              {it.invalidos ? <span style={{ color: T.aviso }}>{it.invalidos} inválidos</span> : null}
              {it.abandonados ? <span style={{ color: T.perigo }}>{it.abandonados} abandonaram</span> : null}
              {it.erros ? <span style={{ color: T.perigo }}>{it.erros} erros</span> : null}
            </div>
            {it.textoCortado ? (
              <div style={{ fontSize: '0.72rem', color: T.aviso, marginTop: 4 }}>
                {it.textoCortado} mensagem(ns) tiveram texto cortado no limite do canal.
              </div>
            ) : null}
            {it.latenciaP95Ms != null ? (
              <div style={{ fontSize: '0.72rem', color: T.mut, marginTop: 4 }}>
                Latência: mediana {it.latenciaP50Ms} ms · p95 {it.latenciaP95Ms} ms
                {it.latenciaAmostra ? ` (amostra de ${it.latenciaAmostra})` : ''}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function PainelDeIncidentes({ incidentes, carregando, erro, aoReconhecer, aoRecarregar, aoSelecionarNo, aoFechar }) {
  return (
    <div className="rgfx-lateral" style={{ ...cartao, padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${T.borda}` }}>
        <AlertTriangle size={16} style={{ color: T.aviso }} />
        <div style={{ flex: 1, fontWeight: 800, fontSize: '0.86rem' }}>Incidentes</div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoRecarregar()}><RefreshCw size={14} /></button>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar incidentes"><X size={15} /></button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', flex: 1, display: 'grid', gap: 10, alignContent: 'start' }}>
        {carregando ? <div style={{ color: T.mut }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Consultando…</div> : null}
        {erro ? <Faixa tom="erro" titulo="Não consegui ler os incidentes">{erro.message}</Faixa> : null}
        {!carregando && !erro && !incidentes.length ? <Vazio>Nenhum incidente aberto.</Vazio> : null}
        {incidentes.map((inc) => (
          <div key={inc.id} style={{ border: `1px solid ${inc.nivel === 'erro' ? T.perigo : T.aviso}`, borderRadius: 10, padding: 10, background: T.sup }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <Etiqueta tom={inc.nivel === 'erro' ? 'erro' : 'aviso'}>{inc.codigo || inc.nivel}</Etiqueta>
              <span style={{ fontSize: '0.72rem', color: T.mut, marginLeft: 'auto' }}>{fmtRelativo(inc.criadoEm)}</span>
            </div>
            <div style={{ fontSize: '0.8rem' }}>{inc.mensagemOperador || inc.mensagem || '(sem descrição)'}</div>
            {inc.comoCorrigir ? <div style={{ fontSize: '0.74rem', color: T.mut, marginTop: 4 }}>{inc.comoCorrigir}</div> : null}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {inc.noId ? (
                <button className="btn btn-secondary" style={{ minHeight: 34 }} onClick={() => aoSelecionarNo(inc.noId)}>Ver o nó</button>
              ) : null}
              {!inc.reconhecidoEm ? (
                <button className="btn btn-secondary" style={{ minHeight: 34 }} onClick={() => aoReconhecer(inc.id)}>
                  Reconhecer
                </button>
              ) : <Etiqueta tom="neutro">reconhecido</Etiqueta>}
            </div>
            <div style={{ fontSize: '0.7rem', color: T.mut, marginTop: 6 }}>
              Reconhecer registra que alguém viu — não resolve o incidente.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PainelDeExecucoes({ execucoes, carregando, erro, aoRecarregar, aoSelecionarNo, aoFechar }) {
  return (
    <div className="rgfx-lateral" style={{ ...cartao, padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${T.borda}` }}>
        <Layers size={16} style={{ color: T.info }} />
        <div style={{ flex: 1, fontWeight: 800, fontSize: '0.86rem' }}>Conversas em andamento</div>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoRecarregar()}><RefreshCw size={14} /></button>
        <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar execuções"><X size={15} /></button>
      </div>
      <div style={{ padding: 12, overflow: 'auto', flex: 1, display: 'grid', gap: 8, alignContent: 'start' }}>
        {carregando ? <div style={{ color: T.mut }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Consultando…</div> : null}
        {erro ? <Faixa tom="erro" titulo="Não consegui ler as execuções">{erro.message}</Faixa> : null}
        <Faixa tom="info" titulo="Dado do cliente não aparece aqui">
          A lista nunca traz as variáveis da conversa. Ver os dados de uma execução é um pedido
          separado e fica registrado em auditoria.
        </Faixa>
        {!carregando && !erro && !execucoes.length ? <Vazio>Nenhuma conversa dentro deste fluxo.</Vazio> : null}
        {execucoes.map((ex) => (
          <div key={ex.id} style={{ border: `1px solid ${T.borda}`, borderRadius: 10, padding: 10, background: T.sup }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Etiqueta tom={ex.estado === 'rodando' ? 'ok' : ex.estado === 'esperando' ? 'info' : 'aviso'}>{ex.estado}</Etiqueta>
              <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{ex.protocolo || '(sem protocolo)'}</span>
              <span style={{ fontSize: '0.72rem', color: T.mut, marginLeft: 'auto' }}>{fmtRelativo(ex.atualizadaEm)}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: T.sec, marginTop: 4 }}>
              Nó atual: {ex.noAtualId || '—'} · {ex.passosTotal ?? 0} passo(s)
              {ex.acordarEm ? ` · acorda ${fmtHora(ex.acordarEm)}` : ''}
            </div>
            {ex.noAtualId ? (
              <button className="btn btn-secondary" style={{ minHeight: 34, marginTop: 6 }} onClick={() => aoSelecionarNo(ex.noAtualId)}>
                Ver o nó no desenho
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 10. MODAIS
//
// ⚠️ Todas elas são renderizadas na RAIZ da página, FORA de qualquer bloco condicional de aba.
// A modal se controla pelo próprio `aberta` — nunca por estar dentro de `{aba === 'x' && …}`.
// ════════════════════════════════════════════════════════════════════════════════════════════════

function Modal({ aberta, titulo, aoFechar, children, rodape, largura = 560 }) {
  useEffect(() => {
    if (!aberta) return undefined;
    const aoTeclar = (ev) => { if (ev.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberta, aoFechar]);
  if (!aberta) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(ev) => { if (ev.target === ev.currentTarget) aoFechar(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        ...cartao, width: '100%', maxWidth: largura, maxHeight: '86vh',
        display: 'flex', flexDirection: 'column', padding: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${T.borda}` }}>
          <div style={{ flex: 1, fontWeight: 800 }}>{titulo}</div>
          <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar"><X size={16} /></button>
        </div>
        <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>{children}</div>
        {rodape ? <div style={{ padding: 12, borderTop: `1px solid ${T.borda}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>{rodape}</div> : null}
      </div>
    </div>
  );
}

function ModalDeConfirmacao({ aberta, titulo, mensagem, rotuloConfirmar, perigoso, ocupada, aoConfirmar, aoFechar }) {
  return (
    <Modal
      aberta={aberta} titulo={titulo || 'Confirmar'} aoFechar={aoFechar} largura={460}
      rodape={
        <>
          <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
          <button
            className={perigoso ? 'btn btn-secondary' : 'btn btn-primary'}
            style={perigoso ? { color: T.perigo, borderColor: T.perigo } : undefined}
            disabled={ocupada}
            onClick={() => aoConfirmar()}
          >{ocupada ? 'Aguarde…' : (rotuloConfirmar || 'Confirmar')}</button>
        </>
      }
    >
      <div style={{ fontSize: '0.86rem', color: T.sec }}>{mensagem}</div>
    </Modal>
  );
}

function ModalDeCriacao({ aberta, ehSuperusuario, aoFechar, aoCriado }) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [entrada, setEntrada] = useState('subfluxo');
  const [cwInboxId, setCwInboxId] = useState('');
  const [palavrasChave, setPalavrasChave] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (aberta) {
      setNome(''); setDescricao(''); setEntrada('subfluxo'); setCwInboxId('');
      setPalavrasChave(''); setTenantId(''); setErro(null);
    }
  }, [aberta]);

  const criar = async () => {
    setSalvando(true); setErro(null);
    try {
      const corpo = {
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        entrada,
        ...(entrada === 'caixa' ? { cwInboxId: Number(cwInboxId) } : {}),
        ...(entrada === 'palavra_chave' ? { palavrasChave: textoParaLista(palavrasChave) } : {}),
        ...(ehSuperusuario && tenantId.trim() ? { tenantId: tenantId.trim() } : {}),
        // O fluxo nasce com o nó de início já desenhado: fluxo sem início é fluxo que o motor
        // não sabe por onde começar, e o operador só descobre isso no primeiro teste.
        documento: {
          nos: [{ id: 'no_inicio', tipo: 'inicio', titulo: 'Início', config: configPadrao('inicio'), ui: { x: 60, y: 60 } }],
          arestas: [], variaveis: [],
        },
      };
      const criado = await chamarFluxo('/fluxos', { metodo: 'POST', corpo });
      aoCriado(criado);
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  return (
    <Modal
      aberta={aberta} titulo="Novo fluxo de conversa" aoFechar={aoFechar}
      rodape={
        <>
          <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
          <button className="btn btn-primary" disabled={!nome.trim() || salvando} onClick={() => criar()}>
            {salvando ? 'Criando…' : 'Criar fluxo'}
          </button>
        </>
      }
    >
      {erro ? (
        <div style={{ marginBottom: 12 }}>
          <Faixa tom="erro" titulo={erro.status === 409 ? 'Já existe um fluxo com esse nome' : 'Não consegui criar'}>
            {erro.message}
            {erro.status === 400 && /tenantId|empresa/i.test(erro.message) ? (
              <div style={{ marginTop: 4 }}>
                Como super usuário do NOC você não tem uma empresa própria — informe a empresa do fluxo abaixo.
              </div>
            ) : null}
          </Faixa>
        </div>
      ) : null}

      <CampoTexto rotulo="Nome do fluxo" dica="até 120 caracteres" valor={nome} aoMudar={setNome} />
      <CampoTexto rotulo="Descrição" linhas={2} valor={descricao} aoMudar={setDescricao} />
      <CampoSelecao
        rotulo="Como este fluxo começa" valor={entrada} vazio="sub-fluxo (chamado por outro)"
        aoMudar={(v) => setEntrada(v || 'subfluxo')}
        opcoes={[
          { valor: 'subfluxo', rotulo: 'Sub-fluxo — só quando outro fluxo chamar' },
          { valor: 'caixa', rotulo: 'Caixa de entrada — toda conversa que chegar nela' },
          { valor: 'palavra_chave', rotulo: 'Palavra-chave — quando o cliente escrever algo' },
        ]}
      />
      {entrada === 'caixa' ? (
        <CampoTexto rotulo="Caixa de entrada (cwInboxId)" dica="(obrigatório para esta entrada)" tipo="number" valor={cwInboxId} aoMudar={setCwInboxId} />
      ) : null}
      {entrada === 'palavra_chave' ? (
        <CampoTexto rotulo="Palavras-chave" dica="separadas por vírgula" valor={palavrasChave} aoMudar={setPalavrasChave} />
      ) : null}
      {ehSuperusuario ? (
        <CampoTexto
          rotulo="Empresa (tenantId)"
          dica="obrigatório para o super usuário do NOC"
          valor={tenantId} aoMudar={setTenantId}
        />
      ) : null}
    </Modal>
  );
}

/**
 * MODAL DE 2FA. Em 403 INVALID_2FA o erro aparece DENTRO da modal e a sessão NÃO cai — regra da
 * casa: 2FA recusado nunca é 401, e nunca desloga.
 */
function ModalDe2FA({ aberta, canais, dicaDeEmail, ocupada, aoConfirmar, aoFechar }) {
  const [canal, setCanal] = useState(canais?.totp ? 'totp' : 'email');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [recado, setRecado] = useState(null);
  const [erro, setErro] = useState(null);

  // O canal é reescolhido a cada abertura: `useState` só avalia o inicial UMA vez, e nessa hora
  // `canais` ainda é indefinido (a modal existe montada com `aberta=false`). Sem isto, numa conta
  // que só tem aplicativo autenticador o seletor mostrava «app» e mandava 'email' ao servidor.
  useEffect(() => {
    if (!aberta) return;
    setCodigo(''); setRecado(null); setErro(null);
    setCanal(canais?.totp ? 'totp' : 'email');
  }, [aberta, canais]);

  const pedirCodigo = async () => {
    setEnviando(true); setErro(null);
    try {
      const r = await chamarFluxo('/request-otp', { metodo: 'POST', corpo: { channel: canal } });
      setRecado(r.sent
        ? 'Código enviado para o seu e-mail.'
        : 'Use o código que está no seu aplicativo autenticador.');
    } catch (e) { setErro(e); } finally { setEnviando(false); }
  };

  return (
    <Modal
      aberta={aberta} titulo="Confirmação em duas etapas" aoFechar={aoFechar} largura={440}
      rodape={
        <>
          <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
          <button
            className="btn btn-primary" disabled={!/^\d{6}$/.test(codigo) || ocupada}
            onClick={() => aoConfirmar({ otpChannel: canal, otpCode: codigo })}
          >{ocupada ? 'Publicando…' : 'Confirmar e publicar'}</button>
        </>
      }
    >
      <Faixa tom="aviso" titulo="Por que estão pedindo o código">
        Esta publicação deixa conversas ÓRFÃS — pessoas que estão no meio do atendimento agora e cujo
        nó atual não existe mais na versão nova. O código é a confirmação de que isso é intencional.
      </Faixa>
      <div style={{ height: 12 }} />
      <CampoSelecao
        rotulo="Onde receber o código" valor={canal} vazio="" aoMudar={(v) => setCanal(v || 'email')}
        opcoes={[
          ...(canais?.email ? [{ valor: 'email', rotulo: `E-mail${dicaDeEmail ? ` (${dicaDeEmail})` : ''}` }] : []),
          ...(canais?.totp ? [{ valor: 'totp', rotulo: 'Aplicativo autenticador' }] : []),
        ]}
      />
      <button className="btn btn-secondary" disabled={enviando} onClick={() => pedirCodigo()}>
        {enviando ? 'Pedindo…' : 'Pedir o código'}
      </button>
      {recado ? <div style={{ marginTop: 8, fontSize: '0.8rem', color: T.ok }}>{recado}</div> : null}
      {erro ? <div style={{ marginTop: 8 }}><Faixa tom="erro" titulo="Não consegui pedir o código">{erro.message}</Faixa></div> : null}
      <div style={{ height: 12 }} />
      <CampoTexto rotulo="Código de seis dígitos" valor={codigo} aoMudar={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
    </Modal>
  );
}

/**
 * MODAL DE PUBLICAÇÃO. Ao abrir consulta `GET /mudanca` e mostra a classe, quantas conversas estão
 * vivas, quantas ficariam órfãs e o modo sugerido. Em 503 (o serviço de publicação ainda não
 * existe) mostra `detalhe` e `procurado` — é diagnóstico do sistema, não erro do operador.
 */
function ModalDePublicacao({ aberta, fluxoId, aoFechar, aoPublicado }) {
  const [mudanca, setMudanca] = useState(null);
  const [erroMudanca, setErroMudanca] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [modo, setModo] = useState('');
  const [nota, setNota] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [erroPublicar, setErroPublicar] = useState(null);
  const [pedido2fa, setPedido2fa] = useState(null);

  useEffect(() => {
    if (!aberta || !fluxoId) return;
    let vivo = true;
    setCarregando(true); setErroMudanca(null); setErroPublicar(null); setPedido2fa(null); setNota('');
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/mudanca`)
      .then((r) => { if (!vivo) return; setMudanca(r); setModo(r.modoSugerido || 'fixar'); })
      .catch((e) => { if (vivo) { setErroMudanca(e); setModo('fixar'); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [aberta, fluxoId]);

  const publicar = async (extra2fa) => {
    setPublicando(true); setErroPublicar(null);
    try {
      const r = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/publicar`, {
        metodo: 'POST',
        corpo: { modoMigracao: modo, notaPublicacao: nota.trim() || undefined, ...(extra2fa || {}) },
        tempoLimiteMs: 120000,
      });
      setPedido2fa(null);
      aoPublicado(r);
    } catch (e) {
      if (e.status === 428 || e.code === 'NEEDS_2FA') {
        setPedido2fa({ canais: e.dados?.channels || {}, dicaDeEmail: e.dados?.emailHint || null });
      } else {
        setErroPublicar(e);
      }
    } finally { setPublicando(false); }
  };

  const indisp = textoDeIndisponibilidade(erroMudanca) || textoDeIndisponibilidade(erroPublicar);

  return (
    <>
      <Modal
        aberta={aberta && !pedido2fa} titulo="Publicar este fluxo" aoFechar={aoFechar}
        rodape={
          <>
            <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
            <button className="btn btn-primary" disabled={!modo || publicando} onClick={() => publicar(null)}>
              {publicando ? 'Publicando…' : 'Publicar'}
            </button>
          </>
        }
      >
        {carregando ? <div style={{ color: T.mut }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Comparando com a versão vigente…</div> : null}

        {indisp ? (
          <div style={{ marginBottom: 12 }}>
            <Faixa tom="aviso" titulo={indisp.titulo}>
              {indisp.detalhe ? <div>{indisp.detalhe}</div> : null}
              {indisp.procurado.length ? (
                <div style={{ marginTop: 6 }}>
                  Procurei nestes caminhos:
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {indisp.procurado.map((c) => <li key={c} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{c}</li>)}
                  </ul>
                </div>
              ) : null}
              {indisp.esperadas.length ? (
                <div style={{ marginTop: 6, fontSize: '0.74rem' }}>
                  Exportações esperadas: {indisp.esperadas.join(', ')}.
                </div>
              ) : null}
            </Faixa>
          </div>
        ) : null}

        {mudanca ? (
          <div style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Etiqueta tom="info">{mudanca.classe}</Etiqueta>
              <Etiqueta tom="neutro">{mudanca.vivas ?? 0} conversa(s) viva(s)</Etiqueta>
              <Etiqueta tom={(mudanca.orfas || 0) > 0 ? 'erro' : 'ok'}>{mudanca.orfas ?? 0} ficariam órfã(s)</Etiqueta>
            </div>
            {mudanca.contagemSaturada ? (
              <div style={{ fontSize: '0.74rem', color: T.mut }}>
                A contagem saturou na amostra (teto de 5000) — os números são um piso.
              </div>
            ) : null}
            {(mudanca.orfas || 0) > 0 ? (
              <Faixa tom="aviso" titulo="Há gente no meio da conversa que a versão nova não alcança">
                Essas pessoas estão parada num nó que deixou de existir. Publicar assim exige
                confirmação em duas etapas.
              </Faixa>
            ) : null}
          </div>
        ) : null}

        <CampoSelecao
          rotulo="Como tratar quem já está conversando" valor={modo} aoMudar={(v) => setModo(v)}
          opcoes={[
            { valor: 'fixar', rotulo: 'Fixar — quem já está dentro termina na versão antiga' },
            { valor: 'retrofit', rotulo: 'Retrofit — quem está dentro passa para a versão nova' },
            { valor: 'retrofit_forcado', rotulo: 'Retrofit forçado — inclusive quem ficaria órfão (pede 2FA)' },
          ]}
        />
        <CampoTexto rotulo="Nota da publicação" dica="até 1000 caracteres" linhas={3} valor={nota} aoMudar={setNota} />

        {erroPublicar && !indisp ? (
          <Faixa tom="erro" titulo="Não consegui publicar">{erroPublicar.message}</Faixa>
        ) : null}
      </Modal>

      <ModalDe2FA
        aberta={!!pedido2fa}
        canais={pedido2fa?.canais}
        dicaDeEmail={pedido2fa?.dicaDeEmail}
        ocupada={publicando}
        aoConfirmar={(dados) => publicar(dados)}
        aoFechar={() => setPedido2fa(null)}
      />
    </>
  );
}

function ModalDeVersoes({ aberta, fluxoId, versaoPublicadaId, aoFechar, aoRevertido }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [revertendo, setRevertendo] = useState(null);

  const carregar = useCallback(() => {
    if (!fluxoId) return;
    setCarregando(true); setErro(null);
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/versoes`)
      .then((r) => setItens(r.itens || []))
      .catch(setErro)
      .finally(() => setCarregando(false));
  }, [fluxoId]);

  useEffect(() => { if (aberta) carregar(); }, [aberta, carregar]);

  const reverter = async (numero) => {
    setRevertendo(numero); setErro(null);
    try {
      const r = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/reverter/${numero}`, { metodo: 'POST', tempoLimiteMs: 60000 });
      aoRevertido(r);
    } catch (e) { setErro(e); } finally { setRevertendo(null); }
  };

  const indisp = textoDeIndisponibilidade(erro);

  return (
    <Modal aberta={aberta} titulo="Versões publicadas" aoFechar={aoFechar} largura={640}>
      {carregando ? <div style={{ color: T.mut }}><div className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />Consultando…</div> : null}
      {indisp ? (
        <Faixa tom="aviso" titulo={indisp.titulo}>
          {indisp.detalhe}
          {indisp.procurado.length ? <div style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{indisp.procurado.join(' · ')}</div> : null}
        </Faixa>
      ) : erro ? <Faixa tom="erro" titulo="Não consegui ler as versões">{erro.message}</Faixa> : null}
      {!carregando && !itens.length && !erro ? <Vazio>Este fluxo ainda não foi publicado nenhuma vez.</Vazio> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {itens.map((v) => (
          <div key={v.id} style={{
            border: `1px solid ${v.id === versaoPublicadaId ? T.ok : T.borda}`,
            borderRadius: 10, padding: 10, background: T.sup,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800 }}>Versão {v.numero}</span>
              {v.id === versaoPublicadaId ? <Etiqueta tom="ok">no ar</Etiqueta> : null}
              <Etiqueta tom="neutro">{v.modoMigracao || '—'}</Etiqueta>
              <span style={{ marginLeft: 'auto', fontSize: '0.74rem', color: T.mut }}>{fmtHora(v.publicadoEm || v.criadoEm)}</span>
            </div>
            {v.notaPublicacao ? <div style={{ fontSize: '0.8rem', marginTop: 4 }}>{v.notaPublicacao}</div> : null}
            <div style={{ fontSize: '0.7rem', color: T.mut, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              estrutura {String(v.hashEstrutura || '').slice(0, 12)}… · documento {String(v.hashDocumento || '').slice(0, 12)}…
            </div>
            {v.id !== versaoPublicadaId ? (
              <button
                className="btn btn-secondary" style={{ minHeight: 36, marginTop: 8 }}
                disabled={revertendo === v.numero}
                onClick={() => reverter(v.numero)}
              >
                {revertendo === v.numero ? 'Revertendo…' : `Voltar para a versão ${v.numero}`}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.74rem', color: T.mut, marginTop: 12 }}>
        Reverter copia PARA A FRENTE: publica uma versão nova com o conteúdo da antiga. Nenhuma
        versão é alterada nem apagada — elas são imutáveis por gatilho no banco.
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 11. BARRA DO EDITOR
// ════════════════════════════════════════════════════════════════════════════════════════════════
function BarraDoEditor({
  fluxo, sujo, salvando, ultimoSalvamentoEm, saude, bytes, mudandoEstado, podeSalvar, motivoSemSalvar,
  aoVoltar, aoSalvar, aoPublicar, aoVerVersoes, aoAlternarEstado, aoTestar, aoArrumar, aoAbrirMapa,
}) {
  const podePublicar = saude?.podeAgora?.publicar !== false;
  const podeTestar = saude?.podeAgora?.modoDeTeste !== false;
  const proporcao = bytes / TETO_DOCUMENTO;
  return (
    <div style={{
      ...cartao, padding: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      marginBottom: 12,
    }}>
      <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => aoVoltar()}>
        <ArrowLeft size={15} /> Fluxos
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fluxo?.nome || 'Fluxo'}
        </div>
        <div style={{ fontSize: '0.72rem', color: T.mut }}>
          {salvando ? 'Salvando…' : sujo ? 'Alterações não salvas' : ultimoSalvamentoEm ? `Salvo ${fmtRelativo(ultimoSalvamentoEm)}` : 'Sem alterações'}
          {fluxo?.estado ? ` · ${fluxo.estado}` : ''}
        </div>
      </div>

      {/* O corte do nginx em 1 MB é MUDO — some com o pedido sem log. A nossa recusa não é, e o
          número aparece antes de chegar lá. */}
      {proporcao > 0.7 ? (
        <Etiqueta tom={proporcao > 0.95 ? 'erro' : 'aviso'} titulo="Teto do documento: 900 KB">
          {Math.round(bytes / 1024)} KB de 900 KB
        </Etiqueta>
      ) : null}

      <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => aoArrumar()} title="Arrumar os blocos automaticamente">
        <Crosshair size={15} /> <span className="rgfx-esconde-no-celular">Arrumar</span>
      </button>
      <button
        className="btn btn-secondary" style={{ minHeight: 40 }}
        disabled={salvando || podeSalvar === false}
        title={podeSalvar === false ? motivoSemSalvar : 'Grava o rascunho agora'}
        onClick={() => aoSalvar()}
      >
        <Save size={15} /> <span className="rgfx-esconde-no-celular">Salvar</span>
      </button>
      <button
        className="btn btn-secondary" style={{ minHeight: 40 }} disabled={!podeTestar}
        title={podeTestar ? 'Percorre o fluxo sem enviar nada' : 'Os executores do motor não estão disponíveis neste servidor'}
        onClick={() => aoTestar()}
      >
        <Play size={15} /> <span className="rgfx-esconde-no-celular">Testar</span>
      </button>
      <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => aoVerVersoes()}>
        <History size={15} /> <span className="rgfx-esconde-no-celular">Versões</span>
      </button>
      <button
        className="btn btn-secondary" style={{ minHeight: 40 }} disabled={mudandoEstado}
        onClick={() => aoAlternarEstado(fluxo?.estado === 'publicado' ? 'desligado' : 'publicado')}
        title={fluxo?.estado === 'publicado' ? 'Desligar não interrompe quem já está conversando' : 'Só liga se já houver versão publicada'}
      >
        {fluxo?.estado === 'publicado' ? <EyeOff size={15} /> : <Eye size={15} />}
        <span className="rgfx-esconde-no-celular">{fluxo?.estado === 'publicado' ? 'Desligar' : 'Ligar'}</span>
      </button>
      <button
        className="btn btn-primary" style={{ minHeight: 40 }} disabled={!podePublicar}
        title={podePublicar ? 'Cria uma versão nova' : 'O serviço de publicação ainda não está disponível neste servidor'}
        onClick={() => aoPublicar()}
      >
        <Upload size={15} /> Publicar
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 12. O EDITOR — junta canvas, paleta, inspeção, teste e telemetria
// ════════════════════════════════════════════════════════════════════════════════════════════════
function Editor({
  fluxoId, catalogo, catalogoVeioDoServidor, saude, fluxosDaEmpresa, chaveDeAtualizacao,
  aoVoltar, aoAbrirPublicacao, aoAbrirVersoes, pedirConfirmacao, aoMudarFluxo,
}) {
  const r = useRascunhoDeFluxo(fluxoId, catalogo);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [arestaSelecionada, setArestaSelecionada] = useState(null);
  const [ligacaoEmCurso, setLigacaoEmCurso] = useState(null);
  const [vista, setVista] = useState({ escala: 0.85, deslocamento: { x: 20, y: 20 } });
  const [mostrarExcecoes, setMostrarExcecoes] = useState(true);
  const [abaLateral, setAbaLateral] = useState(null);      // 'teste' | 'telemetria' | 'incidentes' | 'execucoes'
  const [paletaAberta, setPaletaAberta] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);
  // Medida REAL do quadro, repassada pela `Tela`. Existe para o «Ajustar à tela» parar de medir
  // uma tela imaginária de 900×520 que não existe em celular nenhum.
  const [tamanhoDaTela, setTamanhoDaTela] = useState({ w: 900, h: 520 });
  const [recado, setRecado] = useState(null);
  const [trilhaDestacada, setTrilhaDestacada] = useState(null);
  const [mudandoEstado, setMudandoEstado] = useState(false);

  const [previa, setPrevia] = useState(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);

  const [telemetria, setTelemetria] = useState(null);
  const [erroTelemetria, setErroTelemetria] = useState(null);
  const [carregandoTelemetria, setCarregandoTelemetria] = useState(false);
  const [mostrarNumeros, setMostrarNumeros] = useState(false);

  const [incidentes, setIncidentes] = useState([]);
  const [erroIncidentes, setErroIncidentes] = useState(null);
  const [carregandoIncidentes, setCarregandoIncidentes] = useState(false);

  const [execucoes, setExecucoes] = useState([]);
  const [erroExecucoes, setErroExecucoes] = useState(null);
  const [carregandoExecucoes, setCarregandoExecucoes] = useState(false);

  // Sem rascunho no servidor não há o que editar: qualquer traço aqui seria descartado ao sair,
  // porque não existe revisão para gravar por cima. Bloquear é mais honesto do que deixar desenhar.
  // As duas causas ficam separadas porque o botão «Criar rascunho» depende só da PERMISSÃO.
  const somenteLeituraPorPermissao = saude?.podeAgora?.administrarFluxos === false;
  const somenteLeitura = somenteLeituraPorPermissao || r.semRascunho;

  const aoMedirViewport = useCallback((medida) => {
    setTamanhoDaTela((atual) => (
      atual.w === medida.w && atual.h === medida.h ? atual : medida
    ));
  }, []);

  // Publicação/reversão pedem uma releitura: o `versaoPublicadaId` e o estado do fluxo mudaram.
  // `r` inteiro NÃO entra nas dependências — o objeto devolvido pelo gancho é novo a cada
  // renderização, e o efeito passaria a rodar em toda renderização.
  const primeiraChave = useRef(chaveDeAtualizacao);
  const refRecarregar = useRef(r.recarregar);
  refRecarregar.current = r.recarregar;
  const refSujo = useRef(r.sujo);
  refSujo.current = r.sujo;
  useEffect(() => {
    if (chaveDeAtualizacao !== primeiraChave.current) {
      primeiraChave.current = chaveDeAtualizacao;
      // ⚠️ NÃO releia por cima de alteração não gravada. `recarregar` faz `setDocumento(...)` e
      // `setSujo(false)`: rodá-lo com o rascunho sujo apaga o desenho do operador em silêncio — o
      // mesmo defeito que o 409 se recusa a cometer três funções acima. Se há trabalho na tela,
      // avisamos e deixamos como está.
      if (refSujo.current) {
        setRecado({
          tom: 'aviso',
          texto: 'A versão publicada mudou, mas eu NÃO reli o rascunho: há alterações não gravadas nesta tela e recarregar as descartaria. Grave-as (botão Salvar) e depois use Atualizar.',
        });
        return;
      }
      refRecarregar.current();
    }
  }, [chaveDeAtualizacao]);

  // Guarda de saída da aba/janela. Sem isso, fechar o navegador com o rascunho sujo leva embora o
  // que o recuo de 800 ms ainda não tinha gravado, sem uma linha de aviso.
  useEffect(() => {
    if (!r.sujo) return undefined;
    const aoSair = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
  }, [r.sujo]);

  useEffect(() => { if (r.fluxo) aoMudarFluxo(r.fluxo); }, [r.fluxo, aoMudarFluxo]);

  // Recado que some sozinho — é aviso de ação, não diagnóstico. Diagnóstico fica em faixa fixa.
  useEffect(() => {
    if (!recado) return undefined;
    const t = setTimeout(() => setRecado(null), 6000);
    return () => clearTimeout(t);
  }, [recado]);

  const documento = r.documento;
  const saidasPorNo = useMemo(() => {
    const m = new Map();
    for (const n of documento.nos || []) m.set(n.id, saidasDoNo(n, catalogo));
    return m;
  }, [documento, catalogo]);

  const problemasDoDesenho = useMemo(() => conferirDesenho(documento, catalogo), [documento, catalogo]);
  const problemasPorNo = useMemo(() => {
    const m = new Map();
    for (const p of problemasDoDesenho) {
      const noId = String(p.campo || '').split('.')[0];
      if (!noId) continue;
      if (!m.has(noId)) m.set(noId, []);
      m.get(noId).push(p);
    }
    return m;
  }, [problemasDoDesenho]);

  const metricasPorNo = useMemo(() => {
    if (!mostrarNumeros || !telemetria?.itens) return null;
    return new Map(telemetria.itens.map((i) => [i.noId, i]));
  }, [mostrarNumeros, telemetria]);

  const noSelecionado = (documento.nos || []).find((n) => n.id === selecionadoId) || null;
  const nosDisponiveis = useMemo(
    () => (documento.nos || []).map((n) => ({ id: n.id, titulo: n.titulo })),
    [documento],
  );

  // ── ações do canvas ───────────────────────────────────────────────────────────────────────────
  const tocarPino = useCallback((noId, saida) => {
    setArestaSelecionada(null);
    setLigacaoEmCurso((atual) => (atual && atual.de === noId && atual.saida === saida ? null : { de: noId, saida }));
    setSelecionadoId(noId);
  }, []);

  // ⚠️ A ligação é feita AQUI, e não dentro de um atualizador de `setLigacaoEmCurso`. O React pode
  // rodar o atualizador mais de uma vez (modo estrito), e a segunda passada acrescentaria a MESMA
  // aresta de novo — que é exatamente o defeito «duas arestas na mesma saída» que o banco recusa
  // só na publicação. Efeito colateral nunca mora dentro de atualizador de estado.
  const tocarEntrada = useCallback((noId) => {
    if (!ligacaoEmCurso) return;
    const resultado = r.ligar(ligacaoEmCurso.de, ligacaoEmCurso.saida, noId);
    if (!resultado.ok) setRecado({ tom: 'erro', texto: resultado.motivo });
    setLigacaoEmCurso(null);
  }, [ligacaoEmCurso, r]);

  // Identidade estável: a vista é dependência do ouvinte nativo de roda dentro da Tela, e uma
  // função nova a cada renderização faria o ouvinte ser removido e recriado o tempo todo.
  const mudarVista = useCallback((v) => setVista(v), []);

  const acrescentar = useCallback((tipo) => {
    // ⚠️ A paleta é o único caminho de edição que não passa por um pino nem por um bloco, e por
    // isso escapava do `somenteLeitura`. Sem esta guarda, um fluxo SEM rascunho deixava desenhar à
    // vontade e jogava tudo fora ao sair, porque não havia revisão para gravar.
    if (somenteLeitura) {
      setRecado({
        tom: 'erro',
        texto: r.semRascunho
          ? 'Não dá para acrescentar nós: este fluxo não tem rascunho no servidor, e nada desenhado aqui seria gravado.'
          : 'Sua conta não pode administrar fluxos neste servidor.',
      });
      return;
    }
    // Cai no centro do que está visível, e não em (0,0): nó que nasce fora da vista parece que
    // não nasceu, e o operador clica de novo.
    const pos = {
      x: (-vista.deslocamento.x + 240) / vista.escala,
      y: (-vista.deslocamento.y + 160) / vista.escala,
    };
    const id = r.acrescentarNo(tipo, pos);
    setSelecionadoId(id);
    setAbaLateral(null);
    setPaletaAberta(false);
  }, [r, vista, somenteLeitura]);

  /**
   * ⚠️ MEDIR, NÃO CHUTAR. Aqui havia `Math.min(900 / larguraDoMundo, 520 / alturaDoMundo)`: dois
   * números cravados de uma tela que não existe no celular. Num aparelho de 390 px o quadro tem
   * ~360×420, então a escala escolhida era 2,5× maior do que caberia — o operador apertava o único
   * botão que promete mostrar o fluxo todo e via menos de 40% dele, sem nenhum sinal de que sobrara
   * coisa fora. A medida do quadro já existia dentro da `Tela`; agora ela sobe e é usada.
   *
   * E o botão não mente mais em dois casos: quando nem no menor zoom o desenho cabe, e quando cabe
   * mas num zoom em que nada é legível. Nos dois, a tela DIZ, em vez de deixar o operador achar que
   * aquilo é o fluxo inteiro.
   */
  const ajustarATela = useCallback(() => {
    const nos = documento.nos || [];
    if (!nos.length) return;
    const caixas = nos.map((n) => ({
      x: n.ui?.x ?? 0, y: n.ui?.y ?? 0,
      w: LARGURA_NO, h: alturaDoNo((saidasPorNo.get(n.id) || []).length),
    }));
    const minX = Math.min(...caixas.map((c) => c.x)) - 40;
    const minY = Math.min(...caixas.map((c) => c.y)) - 40;
    const maxX = Math.max(...caixas.map((c) => c.x + c.w)) + 40;
    const maxY = Math.max(...caixas.map((c) => c.y + c.h)) + 40;
    const mundoL = Math.max(1, maxX - minX);
    const mundoA = Math.max(1, maxY - minY);
    const larguraReal = Math.max(160, (tamanhoDaTela.w || 0) - 20);
    const alturaReal = Math.max(160, (tamanhoDaTela.h || 0) - 20);
    const ideal = Math.min(larguraReal / mundoL, alturaReal / mundoA);
    const escala = Math.max(ESCALA_MINIMA, Math.min(1.2, ideal));
    setVista({ escala, deslocamento: { x: -minX * escala + 10, y: -minY * escala + 10 } });

    if (ideal < ESCALA_MINIMA) {
      const visivel = Math.max(1, Math.round((ideal / escala) * 100));
      setRecado({
        tom: 'aviso',
        texto: `O desenho NÃO cabe nesta tela: no menor zoom que ainda desenha alguma coisa, cerca de ${visivel}% da largura dele aparece. Use «Arrumar» (que quebra o fluxo em faixas) ou o mapa para chegar ao resto.`,
      });
    } else if (escala < ESCALA_LEGIVEL) {
      setRecado({
        tom: 'aviso',
        texto: `Coube inteiro, mas a ${Math.round(escala * 100)}%: neste zoom o texto dos conectores não é legível nem tocável. Use «Arrumar» para quebrar o fluxo em faixas, ou aproxime e navegue pelo mapa.`,
      });
    }
  }, [documento, saidasPorNo, tamanhoDaTela]);

  // «Arrumar» reposiciona e só então ajusta. O ajuste vai por ref porque o `ajustarATela` capturado
  // no `setTimeout` seria o da renderização ANTERIOR, isto é, o do documento ainda desarrumado.
  const refAjustar = useRef(ajustarATela);
  refAjustar.current = ajustarATela;

  const centralizarNoInicio = useCallback(() => {
    const inicio = (documento.nos || []).find((n) => n.tipo === 'inicio') || (documento.nos || [])[0];
    if (!inicio) return;
    setVista((v) => ({ escala: v.escala, deslocamento: { x: 80 - (inicio.ui?.x ?? 0) * v.escala, y: 80 - (inicio.ui?.y ?? 0) * v.escala } }));
  }, [documento]);

  const irParaNo = useCallback((noId) => {
    const no = (documento.nos || []).find((n) => n.id === noId);
    setSelecionadoId(noId);
    if (!no) return;
    setVista((v) => ({ escala: v.escala, deslocamento: { x: 260 - (no.ui?.x ?? 0) * v.escala, y: 180 - (no.ui?.y ?? 0) * v.escala } }));
  }, [documento]);

  // ── prévia por nó ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => { setPrevia(null); }, [selecionadoId]);
  const pedirPrevia = useCallback(async () => {
    if (!noSelecionado) return;
    setCarregandoPrevia(true);
    try {
      const resposta = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/previa-no`, {
        metodo: 'POST', corpo: { no: noSelecionado },
      });
      setPrevia(resposta);
    } catch (e) {
      // 404 aqui quase sempre é «a rota de prévia por nó ainda não foi escrita», e não «fora do
      // escopo»: o fluxo acabou de ser lido com sucesso pelo mesmo escopo.
      setPrevia({
        indisponivel: e.status === 404
          ? 'A rota POST /fluxos/:id/previa-no ainda não existe neste servidor. Ela é o único caminho para a tela avisar os limites da Meta com a MESMA função do motor, sem esperar o serviço de publicação.'
          : e.message,
      });
    } finally { setCarregandoPrevia(false); }
  }, [noSelecionado, fluxoId]);

  // ── painéis de leitura ────────────────────────────────────────────────────────────────────────
  const carregarTelemetria = useCallback(() => {
    setCarregandoTelemetria(true); setErroTelemetria(null);
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/telemetria`)
      .then(setTelemetria)
      .catch((e) => { setErroTelemetria(e); setTelemetria(null); })
      .finally(() => setCarregandoTelemetria(false));
  }, [fluxoId]);

  const carregarIncidentes = useCallback(() => {
    setCarregandoIncidentes(true); setErroIncidentes(null);
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/incidentes?abertos=1`)
      .then((d) => setIncidentes(Array.isArray(d) ? d : (d?.itens || [])))
      .catch(setErroIncidentes)
      .finally(() => setCarregandoIncidentes(false));
  }, [fluxoId]);

  const carregarExecucoes = useCallback(() => {
    setCarregandoExecucoes(true); setErroExecucoes(null);
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/execucoes?ativas=1`)
      .then((d) => setExecucoes(d?.itens || []))
      .catch(setErroExecucoes)
      .finally(() => setCarregandoExecucoes(false));
  }, [fluxoId]);

  useEffect(() => {
    if (abaLateral === 'telemetria' && !telemetria && !erroTelemetria) carregarTelemetria();
    if (abaLateral === 'incidentes' && !incidentes.length && !erroIncidentes) carregarIncidentes();
    if (abaLateral === 'execucoes' && !execucoes.length && !erroExecucoes) carregarExecucoes();
  }, [abaLateral, telemetria, erroTelemetria, incidentes.length, erroIncidentes, execucoes.length, erroExecucoes,
    carregarTelemetria, carregarIncidentes, carregarExecucoes]);

  /**
   * ⚠️ PUBLICAR DESCARREGA O RASCUNHO ANTES DE ABRIR A MODAL.
   *
   * Antes, este botão só fazia `setModalPublicar(true)`, e o backend publica o rascunho GRAVADO NO
   * BANCO. Bastava clicar dentro dos 800 ms do recuo (ou em conflito, quando o salvamento
   * automático está desligado de propósito, ou com `rev == null`) para publicar a versão SEM a
   * correção, ver a faixa verde «Versão N publicada» e, logo depois, ver a correção sumir da tela —
   * porque a publicação bumpa a chave de atualização e o rascunho era relido por cima.
   * Agora: em conflito ou sem revisão, a modal nem abre e o motivo vai escrito; com alterações
   * pendentes, elas são gravadas primeiro e a modal só abre se a gravação confirmar.
   */
  const publicar = useCallback(async () => {
    if (r.semRascunho) {
      setRecado({ tom: 'erro', texto: 'Este fluxo não tem rascunho no servidor; não há o que publicar a partir desta tela.' });
      return;
    }
    if (r.conflito) {
      setRecado({
        tom: 'erro',
        texto: 'Não abri a publicação: a última gravação deste rascunho foi recusada pelo servidor. Publicar agora colocaria no ar o que está no banco, e não o que está na sua tela. Resolva o conflito na faixa acima primeiro.',
      });
      return;
    }
    if (r.rev == null) {
      setRecado({ tom: 'erro', texto: 'Não há revisão de rascunho carregada; nada seria publicado a partir desta tela.' });
      return;
    }
    if (r.sujo) {
      const resultado = await r.salvarAgora();
      if (!resultado?.ok) {
        setRecado({
          tom: 'erro',
          texto: `Não publiquei porque o rascunho não foi gravado. ${resultado?.motivo || 'Motivo não informado pelo servidor.'} Publicar assim colocaria no ar a versão anterior à sua alteração.`,
        });
        return;
      }
    }
    aoAbrirPublicacao();
  }, [r, aoAbrirPublicacao]);

  const salvarPeloBotao = useCallback(async () => {
    const resultado = await r.salvarAgora();
    if (resultado?.ok) setRecado({ tom: 'ok', texto: 'Rascunho gravado.' });
    else if (resultado?.motivo) setRecado({ tom: 'erro', texto: resultado.motivo });
  }, [r]);

  // Sair com trabalho não gravado pergunta antes. O recuo de 800 ms deixa uma janela real em que o
  // desenho existe só na tela — e voltar para a lista desmonta o Editor sem salvar nada.
  const voltar = useCallback(() => {
    if (!r.sujo) { aoVoltar(); return; }
    pedirConfirmacao({
      titulo: 'Sair com alterações não gravadas',
      mensagem: 'Há alterações desenhadas nesta tela que ainda não foram gravadas no servidor. Sair agora as descarta, e não dá para desfazer.',
      rotuloConfirmar: 'Sair e descartar',
      perigoso: true,
      aoConfirmar: () => aoVoltar(),
    });
  }, [r.sujo, aoVoltar, pedirConfirmacao]);

  const alternarEstado = async (estado) => {
    setMudandoEstado(true);
    try {
      const resposta = await chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/estado`, { metodo: 'POST', corpo: { estado } });
      if (resposta.fluxo) aoMudarFluxo(resposta.fluxo);
      r.recarregar();
      setRecado({
        tom: 'ok',
        texto: estado === 'desligado'
          ? `Fluxo desligado.${resposta.conversasEmAndamento ? ` ${resposta.conversasEmAndamento} conversa(s) em andamento seguem até o fim — desligar não interrompe ninguém.` : ''}`
          : 'Fluxo ligado.',
      });
    } catch (e) {
      setRecado({ tom: 'erro', texto: e.message });
    } finally { setMudandoEstado(false); }
  };

  if (r.carregando && !r.fluxo) {
    return (
      <div style={{ ...cartao, textAlign: 'center', padding: 40, color: T.mut }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Abrindo o fluxo…
      </div>
    );
  }
  if (!r.fluxo) {
    const indisp = textoDeIndisponibilidade(r.erro);
    return (
      <div style={{ ...cartao, borderColor: T.perigo }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Não consegui abrir este fluxo</div>
        <div style={{ fontSize: '0.85rem', color: T.sec, marginBottom: 10 }}>{r.erro?.message || 'motivo desconhecido'}</div>
        {r.erro?.status === 404 ? (
          <div style={{ fontSize: '0.8rem', color: T.mut, marginBottom: 10 }}>
            404 nestas rotas quer dizer «fora do escopo da sua empresa OU rota ainda não montada em
            server.js» — nunca «sem permissão».
          </div>
        ) : null}
        {indisp?.procurado?.length ? (
          <div style={{ fontSize: '0.76rem', color: T.mut, fontFamily: 'ui-monospace, monospace', marginBottom: 10 }}>
            {indisp.detalhe}
            <div>{indisp.procurado.join(' · ')}</div>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => r.recarregar()}>Tentar de novo</button>
          <button className="btn btn-secondary" onClick={() => aoVoltar()}>Voltar para a lista</button>
        </div>
      </div>
    );
  }

  const bytes = bytesDoDocumento(documento);
  const erros = problemasDoDesenho.filter((p) => p.nivel === 'erro').length;
  const avisos = problemasDoDesenho.length - erros;

  return (
    <div>
      <BarraDoEditor
        fluxo={r.fluxo}
        sujo={r.sujo}
        salvando={r.salvando}
        ultimoSalvamentoEm={r.ultimoSalvamentoEm}
        saude={saude}
        bytes={bytes}
        mudandoEstado={mudandoEstado}
        podeSalvar={!r.semRascunho && r.rev != null}
        motivoSemSalvar="Este fluxo não tem rascunho no servidor: não existe revisão para gravar por cima."
        aoVoltar={() => voltar()}
        aoSalvar={() => salvarPeloBotao()}
        aoPublicar={() => publicar()}
        aoVerVersoes={() => aoAbrirVersoes()}
        aoAlternarEstado={(estado) => alternarEstado(estado)}
        aoTestar={() => setAbaLateral(abaLateral === 'teste' ? null : 'teste')}
        aoArrumar={() => {
          if (somenteLeitura) { refAjustar.current(); return; }   // sem gravar, só reenquadra
          r.arrumarTudo();
          setTimeout(() => refAjustar.current(), 60);
        }}
      />

      <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
        {/* ⚠️ O título depende do que o servidor REALMENTE disse. Quando ele não informa a revisão
            vigente (é o caso do caminho de `salvarRascunho()` do serviço de publicação, que devolve
            só `{ error }`), acusar «outra pessoa» é invenção — e a faixa antiga chegava a imprimir
            «a revisão que enviei foi undefined». */}
        {r.conflito ? (
          <Faixa
            tom="aviso"
            titulo={r.conflito.outraPessoa
              ? 'Outra pessoa gravou este rascunho depois que você o abriu'
              : 'O servidor recusou a gravação por revisão desatualizada'}
            acoes={
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => r.resolverConflito('recarregar')}>
                  Recarregar (perco o meu)
                </button>
                <button className="btn btn-secondary" style={{ minHeight: 36 }} disabled={r.salvando} onClick={() => r.resolverConflito('enviarMesmoAssim')}>
                  {r.salvando ? 'Enviando…' : 'Enviar mesmo assim'}
                </button>
                {r.conflito.aceito ? null : (
                  <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => r.resolverConflito('continuar')}>
                    Continuar editando o meu
                  </button>
                )}
              </div>
            }
          >
            {r.conflito.revAtual != null
              ? `A revisão que enviei foi ${r.conflito.revEnviada}; a que está no servidor agora é ${r.conflito.revAtual}.`
              : `O servidor não informou qual é a revisão vigente (respondeu apenas: ${r.conflito.mensagemDoServidor || 'sem detalhe'}).`}
            {' '}O salvamento automático parou — nada foi descartado da sua tela.
            {r.conflito.aceito
              ? ' Você escolheu continuar editando aqui: o salvamento automático segue desligado até você usar «Enviar mesmo assim».'
              : ''}
            {' '}«Enviar mesmo assim» relê a revisão vigente antes de gravar
            {r.conflito.outraPessoa ? ' — e isso grava por cima do que a outra pessoa salvou.' : '.'}
          </Faixa>
        ) : null}

        {/* Estado vazio JAMAIS pode ser lido como verdade: canvas em branco por falta de rascunho é
            indistinguível de fluxo realmente vazio, e foi assim que horas de desenho evaporaram —
            `salvarAgora` não tinha revisão, saía calada, e o botão «Salvar» não fazia nada. */}
        {r.semRascunho ? (
          <Faixa
            tom="erro"
            titulo="Este fluxo não tem rascunho no servidor"
            acoes={
              <button
                className="btn btn-primary" style={{ minHeight: 36 }}
                disabled={r.criandoRascunho || somenteLeituraPorPermissao}
                onClick={async () => {
                  const resultado = await r.criarRascunhoDaPublicada();
                  setRecado(resultado.ok
                    ? { tom: 'ok', texto: `Rascunho criado a partir da ${resultado.deOnde}. Já dá para editar.` }
                    : { tom: 'erro', texto: resultado.motivo });
                }}
              >
                {r.criandoRascunho ? 'Criando…' : 'Criar rascunho a partir da versão publicada'}
              </button>
            }
          >
            O que aparece no quadro abaixo NÃO é o conteúdo deste fluxo — é um documento vazio, e a
            edição está bloqueada de propósito: sem rascunho não há revisão para gravar por cima, e
            tudo o que fosse desenhado aqui seria descartado ao sair.
            {r.versaoPublicada ? ` Há versão publicada (nº ${r.versaoPublicada.numero}) para copiar.` : ' Não há versão publicada; o rascunho nasceria em branco.'}
          </Faixa>
        ) : null}

        {!catalogoVeioDoServidor ? (
          <Faixa tom="aviso" titulo="Os conectores estão sendo desenhados por um espelho local">
            A rota GET /catalogo ainda não existe neste servidor, então a lista de saídas de cada nó
            vem de uma cópia mantida nesta tela. Ela cobre os 16 tipos, mas quem manda é
            `saidasDe()` do motor — confira no modo de teste antes de publicar.
          </Faixa>
        ) : null}

        {r.avisoDoServidor ? <Faixa tom="aviso" titulo="Aviso do servidor ao gravar">{r.avisoDoServidor}</Faixa> : null}

        {r.erro && !r.conflito ? <Faixa tom="erro" titulo="Falha ao gravar">{r.erro.message}</Faixa> : null}

        {recado ? <Faixa tom={recado.tom}>{recado.texto}</Faixa> : null}
      </div>

      {/* Barra de vista: tudo aqui tem botão VISÍVEL, porque no celular não há roda nem Ctrl. */}
      <div style={{ ...cartao, padding: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn btn-secondary rgfx-so-no-celular" style={{ minHeight: 40 }} onClick={() => setPaletaAberta(true)}>
          <Plus size={15} /> Nó
        </button>
        <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => setVista((v) => ({ ...v, escala: Math.min(ESCALA_MAXIMA, v.escala * 1.2) }))} aria-label="Aproximar"><ZoomIn size={15} /></button>
        <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => setVista((v) => ({ ...v, escala: Math.max(ESCALA_MINIMA, v.escala / 1.2) }))} aria-label="Afastar"><ZoomOut size={15} /></button>
        <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => ajustarATela()}><Maximize2 size={15} /> <span className="rgfx-esconde-no-celular">Ajustar à tela</span></button>
        <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => centralizarNoInicio()}><Crosshair size={15} /> <span className="rgfx-esconde-no-celular">Início</span></button>
        {/* No computador o mini-mapa vive no canto do quadro. No celular ele SAI de lá (tomava 22%
            da área e engolia o segundo toque da ligação) e passa a morar nesta gaveta. */}
        <button className="btn btn-secondary rgfx-so-no-celular" style={{ minHeight: 40 }} onClick={() => setMapaAberto(true)} aria-label="Abrir o mapa do fluxo">
          <IconeMapa size={15} /> Mapa
        </button>

        <div style={{ width: 1, height: 24, background: T.borda }} />

        <Interruptor marcado={mostrarExcecoes} aoMudar={setMostrarExcecoes}>
          <span style={{ fontSize: '0.78rem' }}>Saídas de exceção</span>
        </Interruptor>
        <Interruptor
          marcado={mostrarNumeros}
          aoMudar={(v) => { setMostrarNumeros(v); if (v && !telemetria) carregarTelemetria(); }}
        >
          <span style={{ fontSize: '0.78rem' }}>Mostrar números</span>
        </Interruptor>

        <div style={{ flex: 1 }} />

        <Etiqueta tom={erros ? 'erro' : 'ok'} titulo="Conferências que a tela faz sozinha, só sobre o desenho">
          {erros ? `${erros} erro(s) de desenho` : 'desenho fechado'}
        </Etiqueta>
        {avisos ? <Etiqueta tom="aviso">{avisos} aviso(s)</Etiqueta> : null}

        <div style={{ width: 1, height: 24, background: T.borda }} />
        {[
          { id: 'telemetria', rotulo: 'Telemetria', Icone: Activity },
          { id: 'incidentes', rotulo: 'Incidentes', Icone: AlertTriangle },
          { id: 'execucoes', rotulo: 'Conversas', Icone: Layers },
        ].map(({ id, rotulo, Icone }) => (
          <button
            key={id} className="btn btn-secondary" style={{ minHeight: 40, borderColor: abaLateral === id ? T.primaria : undefined }}
            onClick={() => setAbaLateral(abaLateral === id ? null : id)}
          >
            <Icone size={15} /> <span className="rgfx-esconde-no-celular">{rotulo}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', minHeight: 520 }}>
        <div className="rgfx-esconde-no-celular">
          <PaletaDeNos
            catalogo={catalogo}
            aoAcrescentar={(t) => acrescentar(t)}
            desabilitada={somenteLeitura}
            motivo={r.semRascunho ? 'Este fluxo não tem rascunho no servidor: nada desenhado aqui seria gravado.' : 'Sua conta não pode administrar fluxos.'}
          />
        </div>

        <Tela
          documento={documento}
          saidasPorNo={saidasPorNo}
          catalogo={catalogo}
          selecionadoId={selecionadoId}
          ligacaoEmCurso={ligacaoEmCurso}
          escala={vista.escala}
          deslocamento={vista.deslocamento}
          mostrarExcecoes={mostrarExcecoes}
          problemasPorNo={problemasPorNo}
          metricasPorNo={metricasPorNo}
          trilhaDestacada={trilhaDestacada}
          somenteLeitura={somenteLeitura}
          arestaSelecionada={arestaSelecionada}
          aoSelecionar={(id) => { setSelecionadoId(id); if (id) setAbaLateral(null); }}
          aoSelecionarAresta={setArestaSelecionada}
          aoMoverNo={(id, pos) => r.moverNo(id, pos)}
          aoTocarPino={tocarPino}
          aoTocarEntrada={tocarEntrada}
          aoCancelarLigacao={() => setLigacaoEmCurso(null)}
          aoApagarAresta={(de, saida) => { r.desligar(de, saida); setArestaSelecionada(null); }}
          aoMudarVista={mudarVista}
          aoMedirViewport={aoMedirViewport}
        />

        {abaLateral === 'teste' ? (
          <PainelDeTeste
            fluxoId={fluxoId}
            origem="rascunho"
            aoDestacarTrilha={setTrilhaDestacada}
            aoSelecionarNo={(id) => irParaNo(id)}
            aoFechar={() => { setAbaLateral(null); setTrilhaDestacada(null); }}
          />
        ) : null}
        {abaLateral === 'telemetria' ? (
          <PainelDeTelemetria
            fluxoId={fluxoId}
            telemetria={telemetria}
            erro={erroTelemetria}
            carregando={carregandoTelemetria}
            aoRecarregar={carregarTelemetria}
            aoSelecionarNo={(id) => irParaNo(id)}
            aoFechar={() => setAbaLateral(null)}
          />
        ) : null}
        {abaLateral === 'incidentes' ? (
          <PainelDeIncidentes
            incidentes={incidentes}
            carregando={carregandoIncidentes}
            erro={erroIncidentes}
            aoRecarregar={carregarIncidentes}
            aoSelecionarNo={(id) => irParaNo(id)}
            aoReconhecer={async (id) => {
              try {
                await chamarFluxo(`/incidentes/${encodeURIComponent(id)}/reconhecer`, { metodo: 'POST' });
                carregarIncidentes();
              } catch (e) { setRecado({ tom: 'erro', texto: e.message }); }
            }}
            aoFechar={() => setAbaLateral(null)}
          />
        ) : null}
        {abaLateral === 'execucoes' ? (
          <PainelDeExecucoes
            execucoes={execucoes}
            carregando={carregandoExecucoes}
            erro={erroExecucoes}
            aoRecarregar={carregarExecucoes}
            aoSelecionarNo={(id) => irParaNo(id)}
            aoFechar={() => setAbaLateral(null)}
          />
        ) : null}
        {!abaLateral && noSelecionado ? (
          <PainelDeInspecao
            no={noSelecionado}
            catalogo={catalogo}
            problemas={problemasPorNo.get(noSelecionado.id) || []}
            previa={previa}
            carregandoPrevia={carregandoPrevia}
            fluxosDaEmpresa={fluxosDaEmpresa}
            nosDisponiveis={nosDisponiveis}
            variaveisDoFluxo={documento.variaveis}
            somenteLeitura={somenteLeitura}
            aoAlterarNo={(id, remendo) => r.alterarNo(id, remendo)}
            aoTrocarConfig={(id, cfg) => {
              // Remover um item de lista ou um botão APAGA a saída dele. A aresta que saía dali é
              // podada agora, e o operador fica sabendo — antes ela virava fantasma: some do
              // desenho, ninguém consegue tocá-la e ela ia gravada e publicada.
              const efeito = r.trocarConfig(id, cfg);
              if (efeito.removidas.length) {
                setRecado({
                  tom: 'aviso',
                  texto: `Removi ${efeito.removidas.length} ligação(ões) que saíam de saídas que deixaram de existir: ${efeito.removidas.map((a) => `${rotularSaida(a.saida)} → ${a.para}`).join('; ')}.`,
                });
              }
            }}
            aoApagarAresta={(de, saida) => { r.desligar(de, saida); setArestaSelecionada(null); }}
            aoDuplicar={(id) => { const novo = r.duplicarNo(id); if (novo) setSelecionadoId(novo); }}
            aoApagar={(id) => pedirConfirmacao({
              titulo: 'Apagar este nó',
              mensagem: `Apagar "${id}" remove também todas as ligações que entram nele e que saem dele. Não dá para desfazer.`,
              rotuloConfirmar: 'Apagar o nó',
              perigoso: true,
              aoConfirmar: () => { r.apagarNo(id); setSelecionadoId(null); },
            })}
            aoPedirPrevia={pedirPrevia}
            aoFechar={() => setSelecionadoId(null)}
          />
        ) : null}
      </div>

      {/* Gaveta do mapa. Fica ao lado da gaveta da paleta e pelo mesmo motivo: no celular nada
          pode morar flutuando por cima do quadro, que é pequeno e onde cada toque é disputado. */}
      {mapaAberto ? (
        <div
          className="rgfx-so-no-celular"
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 62, padding: 12,
            background: T.cartao, borderTop: `1px solid ${T.borda}`, borderRadius: '14px 14px 0 0',
            boxShadow: '0 -8px 30px rgba(0,0,0,.55)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 800, fontSize: '0.82rem' }}>Mapa do fluxo</span>
            <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => setMapaAberto(false)} aria-label="Fechar o mapa">
              <X size={14} />
            </button>
          </div>
          <MiniMapa
            variante="folha"
            largura={Math.max(200, Math.min(420, (tamanhoDaTela.w || 320) - 24))}
            documento={documento}
            saidasPorNo={saidasPorNo}
            escala={vista.escala}
            deslocamento={vista.deslocamento}
            tamanhoViewport={tamanhoDaTela}
            aoIrPara={(ponto) => {
              setVista((v) => ({
                escala: v.escala,
                deslocamento: {
                  x: tamanhoDaTela.w / 2 - ponto.x * v.escala,
                  y: tamanhoDaTela.h / 2 - ponto.y * v.escala,
                },
              }));
              setMapaAberto(false);
            }}
          />
          <div style={{ fontSize: '0.7rem', color: T.mut, marginTop: 6 }}>
            Toque num ponto do mapa para levar a vista até lá. O retângulo mostra o pedaço que está
            à mostra agora.
          </div>
        </div>
      ) : null}

      {/* No celular a paleta é gaveta; no computador ela vive fixa à esquerda. */}
      {paletaAberta ? (
        <div className="rgfx-so-no-celular">
          <PaletaDeNos
            catalogo={catalogo} compacta
            aoAcrescentar={(t) => acrescentar(t)}
            aoFechar={() => setPaletaAberta(false)}
            desabilitada={somenteLeitura}
            motivo={r.semRascunho ? 'Este fluxo não tem rascunho no servidor: nada desenhado aqui seria gravado.' : 'Sua conta não pode administrar fluxos.'}
          />
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: '0.74rem', color: T.mut, lineHeight: 1.5 }}>
        Ligar é de dois toques: toque no conector de saída e depois no nó de destino. Toque no vazio
        (ou Esc) para cancelar. Arrastar o fundo desloca; roda com Ctrl, ou dois dedos, dá zoom.
        Toque numa linha para selecioná-la — o botão de apagar aparece com ela selecionada.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 13. A PÁGINA — lista de fluxos e porta de entrada do editor
//
// Erro NÃO limpa a tela: a última leitura boa continua no lugar e a falha aparece como faixa.
// É o comportamento que o operador de NOC espera — painel que apaga tudo a cada soluço de rede é
// painel em que ninguém confia.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ⇄ MUDANÇA DE CASA (3ª e última) — doc 33, Etapa 4.
// No NOC isto lia `localStorage.noc_user`, que o login DO NOC gravava. Essa chave não existe aqui,
// e insistir nela faria a função devolver `null` para todo mundo: o campo de empresa da modal de
// criação sumiria em silêncio, e o super usuário perderia a única forma de criar fluxo para outra
// empresa — defeito calado, do tipo que só aparece semanas depois.
// A identidade agora vem de onde o motor a injeta (`window.__RAGNABOT__.ator`), pela mesma costura
// que a credencial usa.
//
// ⚠️ E ISTO SÓ DECIDE O QUE APARECE NA TELA. Quem decide escopo é o servidor — `escopoDe()` nos
// routers do motor —, e essa regra não muda de lado só porque a tela mudou de casa. Um operador que
// forje `papel: 'super'` aqui vê o campo e leva 403 do motor; não ganha nada com isso.
function lerUsuarioDoNavegador() {
  const ator = atorAtual();
  if (!ator || !ator.papel) return null;
  return {
    id: ator.id || null,
    name: ator.nome || null,
    role: ator.papel,
    isSuperuser: ator.papel === 'super',
  };
}

const ESTADO_DO_FLUXO = {
  publicado: { tom: 'ok', rotulo: 'no ar' },
  rascunho: { tom: 'neutro', rotulo: 'rascunho' },
  desligado: { tom: 'aviso', rotulo: 'desligado' },
};

function CartaoDeFluxo({ fluxo, aoAbrir, aoArquivar }) {
  const e = ESTADO_DO_FLUXO[fluxo.estado] || ESTADO_DO_FLUXO.rascunho;
  return (
    <div style={{ ...cartao, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: '0.95rem', flex: 1, minWidth: 0 }}>{fluxo.nome}</span>
        <Etiqueta tom={e.tom}>{e.rotulo}</Etiqueta>
        {fluxo.arquivadoEm ? <Etiqueta tom="neutro">arquivado</Etiqueta> : null}
      </div>
      {fluxo.descricao ? (
        <div style={{ fontSize: '0.82rem', color: T.sec, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {fluxo.descricao}
        </div>
      ) : null}
      <div style={{ fontSize: '0.74rem', color: T.mut, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>entrada: {fluxo.entrada || '—'}</span>
        {fluxo.cwInboxId ? <span>caixa {fluxo.cwInboxId}</span> : null}
        {(fluxo.palavrasChave || []).length ? <span>{fluxo.palavrasChave.length} palavra(s)-chave</span> : null}
        <span>atualizado {fmtRelativo(fluxo.atualizadoEm)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => aoAbrir(fluxo.id)}>
          Abrir editor <ChevronRight size={14} />
        </button>
        <button className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => aoArquivar(fluxo)}>
          Arquivar
        </button>
      </div>
    </div>
  );
}

export default function FluxosRagnabot() {
  const usuario = useMemo(() => lerUsuarioDoNavegador(), []);
  const ehSuperusuario = !!(usuario?.isSuperuser);

  const [saude, setSaude] = useState(null);
  const [erroSaude, setErroSaude] = useState(null);
  const [fluxos, setFluxos] = useState([]);
  const [avisoDaLista, setAvisoDaLista] = useState(null);
  const [erroLista, setErroLista] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [incluirArquivados, setIncluirArquivados] = useState(false);

  const [abertoId, setAbertoId] = useState(null);
  const [fluxoAberto, setFluxoAberto] = useState(null);
  const [chaveDeAtualizacao, setChaveDeAtualizacao] = useState(0);

  const [catalogo, setCatalogo] = useState(null);
  const [catalogoVeioDoServidor, setCatalogoVeioDoServidor] = useState(false);

  // ── modais: TODAS aqui na raiz, fora de qualquer bloco condicional de aba ou de tela ──────────
  const [modalCriar, setModalCriar] = useState(false);
  const [modalPublicar, setModalPublicar] = useState(false);
  const [modalVersoes, setModalVersoes] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null);
  const [confirmacaoOcupada, setConfirmacaoOcupada] = useState(false);
  const [recadoDaPagina, setRecadoDaPagina] = useState(null);

  // Endereço compartilhável sem tocar em App.jsx (que é de outro dono): o fluxo aberto fica no
  // fragmento da URL. Assim um link colado no grupo abre o mesmo fluxo.
  useEffect(() => {
    const casou = /#fluxo=([^&]+)/.exec(window.location.hash || '');
    if (casou) setAbertoId(decodeURIComponent(casou[1]));
  }, []);
  useEffect(() => {
    const desejado = abertoId ? `#fluxo=${encodeURIComponent(abertoId)}` : '';
    if ((window.location.hash || '') !== desejado) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search + desejado);
    }
  }, [abertoId]);

  // A saúde é a PRIMEIRA chamada: é `podeAgora` que decide quais botões nascem habilitados.
  useEffect(() => {
    let vivo = true;
    chamarFluxo('/saude')
      .then((s) => { if (vivo) { setSaude(s); setErroSaude(null); } })
      .catch((e) => { if (vivo) setErroSaude(e); });
    return () => { vivo = false; };
  }, []);

  // Catálogo dos tipos. Se a rota ainda não existe, seguimos com o espelho local e dizemos isso.
  useEffect(() => {
    let vivo = true;
    chamarFluxo('/catalogo')
      .then((c) => {
        if (!vivo) return;
        // Aceita tanto { tipos: {...} } quanto uma lista de descritores por tipo.
        const tipos = c?.tipos && !Array.isArray(c.tipos)
          ? c.tipos
          : Object.fromEntries((Array.isArray(c?.tipos) ? c.tipos : Array.isArray(c) ? c : []).map((t) => [t.tipo, t]));
        if (tipos && Object.keys(tipos).length) {
          setCatalogo({ tipos, limites: c?.limites || null });
          setCatalogoVeioDoServidor(true);
        }
      })
      .catch(() => { /* espelho local assume, e a faixa amarela no editor avisa */ });
    return () => { vivo = false; };
  }, []);

  const carregarLista = useCallback(() => {
    setCarregando(true);
    const parametros = new URLSearchParams();
    if (filtroEstado) parametros.set('estado', filtroEstado);
    if (incluirArquivados) parametros.set('incluirArquivados', '1');
    if (busca.trim()) parametros.set('busca', busca.trim());
    chamarFluxo(`/fluxos${parametros.toString() ? `?${parametros}` : ''}`)
      .then((r) => {
        setFluxos(r.itens || []);
        setAvisoDaLista(r.aviso || null);
        setErroLista(null);
      })
      // Falha NÃO limpa a lista: mantemos a última leitura boa e sinalizamos o problema.
      .catch((e) => setErroLista(e))
      .finally(() => setCarregando(false));
  }, [filtroEstado, incluirArquivados, busca]);

  useEffect(() => {
    const t = setTimeout(carregarLista, busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [carregarLista, busca]);

  useEffect(() => {
    if (!recadoDaPagina) return undefined;
    const t = setTimeout(() => setRecadoDaPagina(null), 7000);
    return () => clearTimeout(t);
  }, [recadoDaPagina]);

  const arquivar = (fluxo, mesmoAssim) => {
    setConfirmacaoOcupada(true);
    chamarFluxo(`/fluxos/${encodeURIComponent(fluxo.id)}${mesmoAssim ? '?mesmoAssim=1' : ''}`, { metodo: 'DELETE' })
      .then(() => {
        setConfirmacao(null);
        setRecadoDaPagina({ tom: 'ok', texto: `Fluxo "${fluxo.nome}" arquivado. Nada foi apagado — arquivar só o tira da lista.` });
        carregarLista();
      })
      .catch((e) => {
        if (e.status === 409) {
          // O 409 aqui não é erro: é o servidor dizendo quantas pessoas ainda estão dentro.
          setConfirmacao({
            titulo: 'Ainda há gente conversando neste fluxo',
            mensagem: `${e.dados?.conversasEmAndamento ?? '—'} conversa(s) ainda estão dentro dele. Arquivar não interrompe ninguém, mas o fluxo sai da lista e é desligado.`,
            rotuloConfirmar: 'Arquivar mesmo assim',
            perigoso: true,
            fecharAoConfirmar: false,
            aoConfirmar: () => arquivar(fluxo, true),
          });
        } else {
          setConfirmacao(null);
          setRecadoDaPagina({ tom: 'erro', texto: e.message });
        }
      })
      .finally(() => setConfirmacaoOcupada(false));
  };

  const pedirArquivamento = (fluxo) => setConfirmacao({
    titulo: 'Arquivar este fluxo',
    mensagem: `"${fluxo.nome}" sai da lista e é desligado. Nada é apagado — as versões publicadas e o histórico continuam no banco.`,
    rotuloConfirmar: 'Arquivar',
    fecharAoConfirmar: false,
    aoConfirmar: () => arquivar(fluxo, false),
  });

  const capa = (
    <CapaSecao
      secao="clientes"
      olho="Atendimento"
      titulo="Fluxos de conversa"
      apoio="Desenhe o atendimento do RAGNABOT nó a nó, confira no modo de teste sem enviar nada e publique com controle de quem está no meio da conversa."
      acoes={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => carregarLista()} disabled={carregando}>
            {carregando ? 'Consultando…' : 'Atualizar'}
          </button>
          <button className="btn btn-primary" onClick={() => setModalCriar(true)} disabled={saude?.podeAgora?.administrarFluxos === false}>
            <Plus size={15} /> Novo fluxo
          </button>
        </div>
      }
    />
  );

  const indispSaude = textoDeIndisponibilidade(erroSaude);

  return (
    <div>
      <style>{ESTILOS}</style>
      {abertoId ? null : capa}

      <div style={{ display: 'grid', gap: 12 }}>
        {recadoDaPagina ? <Faixa tom={recadoDaPagina.tom}>{recadoDaPagina.texto}</Faixa> : null}

        {erroSaude ? (
          <Faixa tom={erroSaude.status === 404 ? 'aviso' : 'erro'} titulo="Não consegui ler a saúde do motor de fluxo">
            {erroSaude.message}
            {erroSaude.status === 404 ? (
              <div style={{ marginTop: 4 }}>
                404 em <code>/api/ragnabot-fluxo/saude</code> quase certamente quer dizer que o
                router ainda não foi montado em <code>src/server.js</code>. A montagem esperada,
                declarada no cabeçalho do próprio router, é{' '}
                <code>app.use('/api/ragnabot-fluxo', authMiddleware, router)</code>, sem
                <code> adminOnly</code>.
              </div>
            ) : null}
            {indispSaude?.detalhe ? <div style={{ marginTop: 4 }}>{indispSaude.detalhe}</div> : null}
          </Faixa>
        ) : null}

        {saude && saude.schema?.pronto === false ? (
          <Faixa tom="erro" titulo="As tabelas do motor de fluxo não existem neste banco">
            Aplique a migração do motor antes de usar esta tela. Enquanto isso, todas as rotas
            respondem 503.
          </Faixa>
        ) : null}

        {saude && saude.schema?.pronto && saude.podeAgora?.publicar === false ? (
          <Faixa tom="aviso" titulo="Dá para desenhar e testar, mas ainda não dá para publicar">
            O serviço de publicação (`ragnabot-fluxo-publicacao.service.js`) não foi encontrado no
            servidor. Publicar, validar, reverter e «onde é usado» respondem 503 até ele subir; o
            editor e o modo de teste funcionam normalmente.
            {saude.componentes?.publicacao?.procurado?.length ? (
              <div style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>
                Procurado em: {saude.componentes.publicacao.procurado.join(' · ')}
              </div>
            ) : null}
          </Faixa>
        ) : null}

        {abertoId ? (
          <Editor
            key={abertoId}
            fluxoId={abertoId}
            catalogo={catalogo}
            catalogoVeioDoServidor={catalogoVeioDoServidor}
            saude={saude}
            fluxosDaEmpresa={fluxos}
            chaveDeAtualizacao={chaveDeAtualizacao}
            aoVoltar={() => { setAbertoId(null); setFluxoAberto(null); carregarLista(); }}
            aoAbrirPublicacao={() => setModalPublicar(true)}
            aoAbrirVersoes={() => setModalVersoes(true)}
            pedirConfirmacao={(c) => setConfirmacao(c)}
            aoMudarFluxo={setFluxoAberto}
          />
        ) : (
          <>
            <div style={{ ...cartao, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: T.mut }} />
                <input
                  value={busca}
                  onChange={(ev) => setBusca(ev.target.value)}
                  placeholder="Procurar pelo nome do fluxo…"
                  style={{ ...campoEstilo, paddingLeft: 32 }}
                />
              </div>
              <select value={filtroEstado} onChange={(ev) => setFiltroEstado(ev.target.value)} style={{ ...campoEstilo, width: 180 }}>
                <option value="">Todos os estados</option>
                <option value="publicado">No ar</option>
                <option value="rascunho">Rascunho</option>
                <option value="desligado">Desligado</option>
              </select>
              <Interruptor marcado={incluirArquivados} aoMudar={setIncluirArquivados}>
                <span style={{ fontSize: '0.8rem' }}>Mostrar arquivados</span>
              </Interruptor>
            </div>

            {erroLista ? (
              <Faixa tom="erro" titulo="Falhou ao atualizar a lista">
                {erroLista.message}
                {fluxos.length ? ' A lista abaixo é a última leitura boa.' : ''}
              </Faixa>
            ) : null}

            {avisoDaLista ? (
              <Faixa tom="aviso" titulo="Sua conta não está vinculada a nenhuma empresa do RAGNABOT">
                O servidor respondeu «{avisoDaLista}». Hoje só o super usuário do NOC recebe escopo
                nestas rotas — o campo da empresa ainda não viaja no token de sessão.
              </Faixa>
            ) : null}

            {carregando && !fluxos.length ? (
              <div style={{ ...cartao, textAlign: 'center', padding: 40, color: T.mut }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }} />
                Consultando os fluxos…
              </div>
            ) : null}

            {!carregando && !fluxos.length && !erroLista ? (
              <div style={cartao}>
                <Vazio>
                  Nenhum fluxo por aqui ainda. Crie o primeiro: ele já nasce com o nó de início
                  desenhado e um rascunho pronto para editar.
                </Vazio>
              </div>
            ) : null}

            <div style={grade(300)}>
              {fluxos.map((f) => (
                <CartaoDeFluxo
                  key={f.id}
                  fluxo={f}
                  aoAbrir={(id) => setAbertoId(id)}
                  aoArquivar={(fl) => pedirArquivamento(fl)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ⚠️ MODAIS NA RAIZ. Nenhuma delas mora dentro de `{abertoId ? … : …}` nem de bloco de aba —
          foi exatamente assim que, nas versões anteriores, o botão de uma aba mudava o estado e a
          modal deixava de montar. */}
      <ModalDeCriacao
        aberta={modalCriar}
        ehSuperusuario={ehSuperusuario}
        aoFechar={() => setModalCriar(false)}
        aoCriado={(criado) => {
          setModalCriar(false);
          setRecadoDaPagina({ tom: 'ok', texto: `Fluxo "${criado.nome}" criado.` });
          carregarLista();
          setAbertoId(criado.id);
        }}
      />

      <ModalDePublicacao
        aberta={modalPublicar}
        fluxoId={abertoId}
        aoFechar={() => setModalPublicar(false)}
        aoPublicado={(resultado) => {
          setModalPublicar(false);
          setChaveDeAtualizacao((k) => k + 1);
          carregarLista();
          setRecadoDaPagina({
            tom: 'ok',
            texto: `Versão ${resultado?.numero ?? ''} publicada.`
              + (resultado?.migradas != null ? ` ${resultado.migradas} conversa(s) migradas.` : '')
              + (resultado?.resgatadas != null ? ` ${resultado.resgatadas} resgatada(s).` : ''),
          });
        }}
      />

      <ModalDeVersoes
        aberta={modalVersoes}
        fluxoId={abertoId}
        versaoPublicadaId={fluxoAberto?.versaoPublicadaId}
        aoFechar={() => setModalVersoes(false)}
        aoRevertido={(resultado) => {
          setModalVersoes(false);
          setChaveDeAtualizacao((k) => k + 1);
          setRecadoDaPagina({ tom: 'ok', texto: `Revertido: versão ${resultado?.numero ?? 'nova'} publicada com o conteúdo da antiga.` });
        }}
      />

      <ModalDeConfirmacao
        aberta={!!confirmacao}
        titulo={confirmacao?.titulo}
        mensagem={confirmacao?.mensagem}
        rotuloConfirmar={confirmacao?.rotuloConfirmar}
        perigoso={confirmacao?.perigoso}
        ocupada={confirmacaoOcupada}
        aoConfirmar={() => {
          const atual = confirmacao;
          if (!atual?.aoConfirmar) return;
          atual.aoConfirmar();
          // ⚠️ Quem fecha a modal é declarado por quem a abriu, e não adivinhado aqui.
          // Ação local (apagar um nó) fecha na hora. Ação que fala com o servidor NÃO fecha:
          // ela pode voltar com 409 e virar outra pergunta ("ainda há gente conversando"), e uma
          // modal que some antes da resposta é o operador clicando de novo sem saber o que houve.
          if (atual.fecharAoConfirmar !== false) setConfirmacao(null);
        }}
        aoFechar={() => setConfirmacao(null)}
      />
    </div>
  );
}
