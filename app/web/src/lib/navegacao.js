// ════════════════════════════════════════════════════════════════════════════════════════════════
// O CATÁLOGO DE TELAS — quem existe, onde mora e quem pode ver
//
// Contrato S1 (02/09/2026), doc 34 §F10.1-10.4 e doc 35 §S1. Até hoje a interface do motor era
// UMA página só: `main.jsx` montava `FluxosRagnabot` e pronto. A consequência medida no doc 34 é
// que o construtor de fluxo existe, funciona, e o dono nunca chegou nele — porque não havia
// caminho até lá. Este arquivo é o começo do caminho.
//
// ── POR QUE ISTO É JAVASCRIPT PURO, E NÃO UM .jsx ───────────────────────────────────────────────
// Porque é a única parte da navegação que dá para MEDIR sem navegador. O Node importa este módulo
// direto e `tests/navegacao.smoke.mjs` confere as regras de visibilidade uma a uma. Se o catálogo
// morasse dentro do componente do menu, "o atendente não vê Empresas" seria opinião, não medição.
//
// ── ⚠️ A REGRA QUE NÃO PODE SER MAL LIDA ────────────────────────────────────────────────────────
// `papeis` aqui é o que se DESENHA, e nada mais. Esconder item de menu NÃO é isolamento — é a
// mesma lição já paga em `ragnabot-respostas-rapidas.routes.js` e no doc 34 §F8: quem tranca é o
// servidor, e o teste de aceite de isolamento é a API recusando, não o botão sumindo. Este arquivo
// existe para a pessoa não tropeçar em tela que não é dela, não para impedir quem quer entrar.
//
// ── ⛔ O QUE EU DELIBERADAMENTE NÃO PUS AQUI ────────────────────────────────────────────────────
// Atendimentos, Conexões e Configurações — os outros itens do menu do chat atual. As telas NÃO
// existem. Item de menu que abre tela vazia ensina o operador a desconfiar do menu inteiro; quando
// cada uma nascer (S6, S7), ela entra aqui em uma linha.
//
// ⭐ 02/09/2026 (contrato S3.1): entrou `testador`. Ele é a prova de que a promessa acima vale nos
// dois sentidos — o MOTOR do testador já existia desde 28/08 (`POST /fluxos/:id/testar`), e o item
// só nasceu no menu quando a tela passou a existir. Item de menu vem DEPOIS da tela, nunca antes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Para onde vai quem entra sem pedir nada. É o construtor — que é o que o dono quer usar. */
export const CAMINHO_PADRAO = '/fluxos';

/** Papéis que a sessão pode trazer. Vêm de `rotas-sessao.js`, que os traduz da plataforma:
 *  `administrator` → 'admin', `agent` → 'user'. Não há terceiro valor, e inventar um aqui só
 *  criaria um papel que o servidor não conhece. */
export const PAPEIS = Object.freeze(['admin', 'user']);

/**
 * O catálogo. A ORDEM é a ordem do menu, e ela espelha o chat atual: primeiro o que o atendente
 * usa todo dia, depois o que o administrador configura de vez em quando.
 *
 * campos:
 *   id       chave estável (usada no teste e na marcação `data-item` do menu)
 *   rotulo   o que aparece — em português, sempre
 *   caminho  a rota
 *   papeis   quem VÊ o item. `null` = todo mundo que estiver logado
 *   icone    nome do ícone do `lucide-react`, resolvido no componente (aqui não há JSX)
 *   apoio    a linha de explicação do menu recolhido/título acessível
 */
export const MENU = Object.freeze([
  {
    id: 'fluxos',
    rotulo: 'Fluxos',
    caminho: '/fluxos',
    papeis: null,
    icone: 'Workflow',
    apoio: 'Desenhar e publicar o atendimento automático',
  },
  {
    id: 'respostas-rapidas',
    rotulo: 'Respostas rápidas',
    caminho: '/respostas-rapidas',
    papeis: null,
    icone: 'Zap',
    apoio: 'Os atalhos de texto que a equipe repete o dia inteiro',
  },
  {
    id: 'testador',
    rotulo: 'Testador de fluxo',
    caminho: '/testador',
    papeis: null,
    icone: 'FlaskConical',
    apoio: 'Conversar com o fluxo antes de qualquer cliente conversar com ele',
  },
  {
    id: 'caixas',
    rotulo: 'Caixas de entrada',
    caminho: '/caixas',
    // ⭐ 02/09/2026 (contrato S-CAIXAS). Do ADMINISTRADOR, e não de todo mundo: é cadastro de
    // conexão, o mesmo assunto de Empresas. E entrou aqui só DEPOIS de a tela existir — a regra
    // deste arquivo, repetida: item de menu vem depois da tela, nunca antes.
    papeis: ['admin'],
    icone: 'Inbox',
    apoio: 'Conferir as conexões que o robô conhece, e acertá-las com a plataforma',
  },
  {
    id: 'empresas',
    rotulo: 'Empresas',
    caminho: '/empresas',
    // Cadastro comercial de quem VENDE o SaaS. O doc 34 §F8 é explícito: whitelabel, empresas e
    // planos são abas do operador, não do cliente. Aqui é só o desenho; a trava de servidor dessa
    // regra é o S7 e ainda não existe — está dito no relatório, e não fingido aqui.
    papeis: ['admin'],
    icone: 'Building2',
    apoio: 'Cadastro das empresas atendidas pelo Ragnabot',
  },
]);

/** Normaliza o papel que vier da sessão. Papel desconhecido cai para o MENOS poderoso, nunca para
 *  o mais: um `papel: undefined` (sessão ainda carregando) não pode abrir o menu do administrador. */
export function normalizarPapel(papel) {
  return PAPEIS.includes(papel) ? papel : 'user';
}

/**
 * Os itens que este papel enxerga.
 * @param {string} papel  'admin' | 'user'
 */
export function itensVisiveis(papel) {
  const p = normalizarPapel(papel);
  return MENU.filter((item) => !item.papeis || item.papeis.includes(p));
}

/** O item cujo caminho é este — ou `null`. Usado para o título da aba e para a marcação de ativo. */
export function itemPorCaminho(caminho) {
  const limpo = normalizarCaminho(caminho);
  return MENU.find((item) => item.caminho === limpo) || null;
}

/**
 * Tira barra final e cadeia de barras. `/fluxos/` e `/fluxos` são a MESMA tela — sem isto, colar a
 * URL com a barra no fim cairia no "não encontrei", que é a pior primeira impressão possível.
 */
export function normalizarCaminho(caminho) {
  const cru = String(caminho || '/').split('?')[0].split('#')[0];
  const semRepetida = cru.replace(/\/{2,}/gu, '/');
  if (semRepetida.length > 1 && semRepetida.endsWith('/')) return semRepetida.slice(0, -1);
  return semRepetida || '/';
}

/**
 * Se este caminho deve marcar o item como ativo. Não é igualdade crua de propósito: `/fluxos` tem
 * de continuar aceso quando a tela abrir um fluxo em `/fluxos/<id>` — senão, ao entrar no
 * construtor, o menu apaga e a pessoa perde a referência de onde está.
 */
export function ehItemAtivo(item, caminho) {
  const c = normalizarCaminho(caminho);
  return c === item.caminho || c.startsWith(`${item.caminho}/`);
}

/**
 * O destino de uma URL antiga. Existe por causa de uma promessa que o servidor já faz e que o
 * roteador não pode quebrar: `web/tests/servir.smoke.mjs` mede que `/ragnabot-fluxos/<id>` devolve
 * a página em vez de 404 (era a URL do tempo em que a tela morava no NOC). Se o roteador não
 * soubesse dela, o F5 passaria a cair num "não encontrei" — 200 na rede e erro na tela, que é o
 * pior dos dois mundos para quem diagnostica.
 * @returns {string|null} para onde redirecionar, ou `null` quando não é caminho antigo
 */
export function destinoDeCaminhoAntigo(caminho) {
  const c = normalizarCaminho(caminho);
  if (c === '/' || c === '/index.html') return CAMINHO_PADRAO;
  if (c === '/ragnabot-fluxos' || c.startsWith('/ragnabot-fluxos/')) return '/fluxos';
  return null;
}
