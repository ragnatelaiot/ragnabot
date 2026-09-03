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
// ── ⭐ CONFIGURAÇÕES ENTROU EM 02/09/2026 (contrato S7) ─────────────────────────────────────────
// Este bloco dizia, até hoje: «Configurações — a tela NÃO existe. Item de menu que abre tela vazia
// ensina o operador a desconfiar do menu inteiro; quando ela nascer (S7), entra aqui em uma linha.»
// A tela nasceu, e a linha entrou — nesta ordem, que é a regra deste arquivo.
// (Conexões saiu desta lista em 02/09/2026, contrato S6: a tela passou a existir — e entrou no
// menu só DEPOIS disso, que é a regra deste arquivo.)
// (Atendimentos saiu desta lista em 02/09/2026: a tela passou a existir — ver o item `caixa`.)
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
    // ⭐ 02/09/2026 (contrato S2). PRIMEIRO item do menu, e não por acaso: é a tela onde o atendente
    // vive, e o chat atual abre nela. `papeis: null` = todo mundo que estiver logado — inclusive o
    // atendente, que é justamente quem a usa.
    //
    // ⚠️ E vale repetir a regra do topo deste arquivo, porque esta é a tela em que ela mais tenta:
    // este item aparecer para todos NÃO afrouxa nada. O que cada um ENXERGA dentro dela é decidido
    // pelo servidor, no `where` da consulta (`ragnabot-caixa.service.js`) — não por este catálogo.
    id: 'caixa',
    rotulo: 'Atendimentos',
    caminho: '/caixa',
    papeis: null,
    icone: 'MessagesSquare',
    apoio: 'A sua fila: abertas, resolvidos e grupos',
  },
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
    // ⭐ 02/09/2026 (contrato S4). Fica logo abaixo das respostas rápidas porque é do mesmo tipo de
    // trabalho — preparar o que a equipe vai dizer —, e `papeis: null` porque quem agenda uma
    // mensagem é o atendente ou o supervisor, não só o administrador. E, como sempre neste arquivo:
    // isto NÃO é a trava. O servidor é que decide o que cada um vê (`escopoDe`, no serviço).
    id: 'agendamentos',
    rotulo: 'Agendamentos',
    caminho: '/agendamentos',
    papeis: null,
    icone: 'CalendarClock',
    apoio: 'Mensagens marcadas para sair na hora certa, uma vez ou repetindo',
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
    // ⭐ 02/09/2026 (contrato S6, doc 34 §F9.2.3). Fica logo ABAIXO de «Caixas de entrada» porque é
    // o mesmo assunto visto de outro ângulo: lá se CONFERE o cadastro contra a plataforma, aqui se
    // OPERA a conexão (provedor, estado, reinício, transferência, cota). `papeis: ['admin']` porque
    // é operação de conexão — e, como sempre neste arquivo, ISTO NÃO É A TRAVA: quem recusa é o
    // servidor (`ragnabot-conexao.routes.js`, `exigirAdmin` em tudo que muda o mundo).
    id: 'conexoes',
    rotulo: 'Conexões',
    caminho: '/conexoes',
    papeis: ['admin'],
    icone: 'Plug',
    apoio: 'Por onde o cliente fala: canal, quem opera, como está e quanto do plano já foi usado',
  },
  {
    // ⭐ 02/09/2026 (contrato S7, doc 34 §F8). Última do menu porque é o que se abre de vez em
    // quando, não o que se usa o dia inteiro. `papeis: null` porque o ATENDENTE também precisa
    // LER os ajustes que mudam a tela dele (tema, modo das etiquetas, assinatura) — quem não pode
    // ESCREVER recebe 403 EXIGE_ADMIN do servidor, com a tela em modo de leitura.
    id: 'configuracoes',
    rotulo: 'Configurações',
    caminho: '/configuracoes',
    papeis: null,
    icone: 'Settings',
    apoio: 'Como o atendimento se comporta: saudação, histórico, horários, avaliações e integrações',
  },
  {
    id: 'empresas',
    rotulo: 'Empresas',
    caminho: '/empresas',
    // Cadastro comercial de quem VENDE o SaaS. O doc 34 §F8 é explícito: whitelabel, empresas e
    // planos são abas do OPERADOR, não do cliente.
    //
    // ⭐ 02/09/2026 (contrato S7): a trava de servidor dessa regra PASSOU A EXISTIR — é
    // `src/base/operador-saas.js`, e `tests/ragnabot-configuracao-visibilidade.test.mjs` mede a
    // recusa pela API (403 NAO_E_OPERADOR_DO_SAAS), não o botão sumido. Por isso este item deixou
    // de ser `papeis: ['admin']`: um administrador de empresa CLIENTE é admin, e via aqui um item
    // que a API já lhe recusava — menu que promete o que o servidor nega é pior que menu sem item.
    // `somenteOperadorDoSaas` é lido por `itensVisiveis`, que agora recebe também esse fato.
    papeis: ['admin'],
    somenteOperadorDoSaas: true,
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
 *
 * ⭐ 02/09/2026 (contrato S7): ganhou o segundo argumento. `operadorDoSaas` NÃO é deduzido aqui —
 * ele vem de `GET /api/ragnabot-config/quem-sou`, ou seja, do SERVIDOR. Deduzir pelo nome ou pelo
 * slug da empresa seria pior que não checar: nome de empresa é dado de cadastro, editável pela
 * própria tela de Empresas, e uma empresa cliente que se renomeasse "Ragnatela" herdaria o menu.
 *
 * ⚠️ E vale a regra do topo deste arquivo, sempre: ISTO NÃO É A TRAVA. Quem recusa é
 * `src/base/operador-saas.js`, no servidor. Aqui só se evita o tropeço.
 *
 * @param {string} papel  'admin' | 'user'
 * @param {{operadorDoSaas?:boolean}} [contexto]
 */
export function itensVisiveis(papel, contexto = {}) {
  const p = normalizarPapel(papel);
  // Padrão FALSO, e não "não sei": enquanto o servidor não respondeu, o menu do operador não
  // aparece. Um item que pisca e some é pior que um item que aparece um segundo depois.
  const operador = contexto.operadorDoSaas === true;
  return MENU.filter((item) => {
    if (item.papeis && !item.papeis.includes(p)) return false;
    if (item.somenteOperadorDoSaas && !operador) return false;
    return true;
  });
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
