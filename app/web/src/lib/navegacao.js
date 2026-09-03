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
// ── ⭐⭐ 02/09/2026 (contrato S-CASCA) — O PAINEL PASSOU A SER UM SÓ ─────────────────────────────
// Até hoje havia DUAS interfaces no mesmo endereço: a do fornecedor em `bot.ragnatela.com.br/` e a
// nossa em `/painel/`. Degrau, não destino (doc 34, Fase 10). Agora o catálogo aceita itens
// EMBUTIDOS: a tela é do fornecedor, mas abre DENTRO da nossa casca, com o mesmo menu à esquerda.
// Conforme trocarmos tela por tela, o item perde o `embutido` e passa a apontar para a nossa — e o
// menu não muda, nem a URL, nem o que a pessoa aprendeu.
//
// ⚠️ A MEDIÇÃO QUE AUTORIZA ISSO (02/09/2026, feita antes de escrever uma linha): o painel do
// fornecedor responde `X-Frame-Options: SAMEORIGIN` e NENHUM `Content-Security-Policy`. Ou seja:
// ele aceita ser embutido POR PÁGINA DA MESMA ORIGEM — e a nossa casca é da mesma origem, porque
// mora em `bot.ragnatela.com.br/painel/`. Nada foi desligado nele para isso caber.
// ⛔ CONSEQUÊNCIA QUE VALE UM AVISO: se um dia a casca mudar para um subdomínio próprio
// (`painel.ragnatela.com.br`), o `SAMEORIGIN` passa a BARRAR o quadro e todas as telas embutidas
// somem de uma vez. Isso é decisão de infraestrutura, não de código — e o código não tem como
// contornar sem afrouxar a proteção do fornecedor, o que o contrato proíbe.
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
 * ⭐ ORDEM REVISTA EM 02/09/2026 (contrato S-CASCA), por ordem do dono, para espelhar o sistema que
 * a empresa usa hoje: Atendimentos · Fluxos · Conexões · Agendamentos · Respostas rápidas ·
 * Configurações. As telas que não estavam nessa lista foram encaixadas ao lado da vizinha de mesmo
 * assunto (Conversas e Contatos junto de Atendimentos; Testador junto de Fluxos; Caixas de entrada
 * junto de Conexões; Relatórios antes de Configurações). ⚠️ Ao mexer nesta ordem, conferir os
 * comentários «fica ao lado de…» dos itens — comentário que descreve uma vizinhança que deixou de
 * existir é pior que comentário nenhum, porque manda a próxima pessoa procurar no lugar errado.
 *
 * campos:
 *   id       chave estável (usada no teste e na marcação `data-item` do menu)
 *   rotulo   o que aparece — em português, sempre
 *   caminho  a rota
 *   papeis   quem VÊ o item. `null` = todo mundo que estiver logado
 *   icone    nome do ícone do `lucide-react`, resolvido no componente (aqui não há JSX)
 *   apoio    a linha de explicação do menu recolhido/título acessível
 *   embutido ⭐ (S-CASCA) quando presente, a tela é DO FORNECEDOR e abre num quadro dentro da nossa
 *            casca. `{ alvo }` é o caminho DELE, na RAIZ do host — nunca sob o nosso prefixo.
 *            Ausente = a tela é nossa. É o único campo que distingue as duas coisas, e é o que
 *            some quando substituirmos a tela: um campo a menos, e o menu segue igual.
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
    // ⭐ 02/09/2026 (contrato S-CASCA). PRIMEIRA tela EMBUTIDA, e logo depois de «Atendimentos»
    // porque é a dupla natural: lá se OLHA a fila, aqui se RESPONDE o cliente. A nossa caixa é de
    // leitura; responder ainda é do painel do fornecedor, e fingir o contrário mandaria o atendente
    // procurar um botão que não existe.
    //
    // ⚠️ `:conta` é resolvido em `enderecoEmbutido()` com o número da conta DA SESSÃO — nunca com
    // um número escrito à mão. O painel do fornecedor tranca por conta do lado dele; o que se evita
    // aqui é a tela abrir num «você não tem acesso a esta conta» que ninguém liga ao menu.
    id: 'conversas',
    rotulo: 'Conversas',
    caminho: '/conversas',
    papeis: null,
    icone: 'MessageCircle',
    apoio: 'Responder o cliente — o painel de atendimento, dentro desta tela',
    embutido: { alvo: '/app/accounts/:conta/dashboard' },
  },
  {
    // ⭐ 02/09/2026 (contrato S-CASCA). Tela do fornecedor, embutida. Quando existir a nossa, esta
    // linha perde o `embutido` e ganha o caminho da nossa — o menu não muda de lugar nem de nome.
    id: 'contatos',
    rotulo: 'Contatos',
    caminho: '/contatos',
    papeis: null,
    icone: 'Users',
    apoio: 'A agenda de quem já falou com a empresa',
    embutido: { alvo: '/app/accounts/:conta/contacts' },
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
    id: 'testador',
    rotulo: 'Testador de fluxo',
    caminho: '/testador',
    papeis: null,
    icone: 'FlaskConical',
    apoio: 'Conversar com o fluxo antes de qualquer cliente conversar com ele',
  },
  {
    // ⭐ 02/09/2026 (contrato S6, doc 34 §F9.2.3). Fica COLADO em «Caixas de entrada» porque é o
    // mesmo assunto visto de outro ângulo: aqui se OPERA a conexão (provedor, estado, reinício,
    // transferência, cota), ali se CONFERE o cadastro contra a plataforma.
    // (A ordem das duas inverteu-se em 02/09/2026, contrato S-CASCA — ver a nota de ORDEM no topo
    // da lista. O que importa é que continuem vizinhas: quem procura uma vai achar a outra.)
    // `papeis: ['admin']` porque
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
    // ⭐ 02/09/2026 (contrato S4). Fica colado em «Respostas rápidas» porque é do mesmo tipo de
    // trabalho — preparar o que a equipe vai dizer. (Passou a vir ANTES dela em 02/09/2026, contrato
    // S-CASCA, para a ordem espelhar o sistema que a empresa usa hoje — ver a nota no topo da lista.)
    // `papeis: null` porque quem agenda uma
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
    id: 'respostas-rapidas',
    rotulo: 'Respostas rápidas',
    caminho: '/respostas-rapidas',
    papeis: null,
    icone: 'Zap',
    apoio: 'Os atalhos de texto que a equipe repete o dia inteiro',
  },
  {
    // ⭐ 02/09/2026 (contrato S-CASCA). Tela do fornecedor, embutida.
    //
    // `papeis: ['admin']` porque é a MESMA regra que o fornecedor já aplica no menu dele — relatório
    // é de quem administra a conta. E vale, como sempre neste arquivo, a regra do topo: ISTO NÃO É
    // A TRAVA. Quem recusa é o painel dele, do lado dele; um atendente que digitar a URL do
    // relatório na mão vai bater na recusa DELE, não na ausência deste item.
    id: 'relatorios',
    rotulo: 'Relatórios',
    caminho: '/relatorios',
    papeis: ['admin'],
    icone: 'BarChart3',
    apoio: 'Números do atendimento: volume, tempo de resposta e resolução',
    embutido: { alvo: '/app/accounts/:conta/reports/overview' },
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TELAS EMBUTIDAS — as que ainda são do fornecedor (contrato S-CASCA, 02/09/2026)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Este item abre uma tela do fornecedor dentro da casca? */
export function ehEmbutido(item) {
  return Boolean(item && item.embutido && typeof item.embutido.alvo === 'string');
}

/**
 * O endereço que vai no quadro (`<iframe src>`) — o caminho DO FORNECEDOR, resolvido com a conta
 * desta sessão.
 *
 * ⛔ REPARE NO QUE ESTA FUNÇÃO **NÃO** FAZ: ela NÃO chama `caminhoDoApp()`. É a armadilha número um
 * deste arquivo, e ela é silenciosa. A nossa interface está publicada sob `/painel/`, então todo
 * caminho nosso nasce com esse prefixo; o painel do fornecedor mora na RAIZ do mesmo host. Passar
 * o alvo por `caminhoDoApp()` produziria `/painel/app/accounts/1/dashboard` — endereço que existe
 * (o desvio-para-a-página devolve 200) e mostra a NOSSA tela de «não encontrei» dentro do quadro.
 * Ou seja: 200 na rede, tela errada no olho, e nada apontando para cá.
 *
 * @param {object} item      item do catálogo
 * @param {number|string|null} contaId  a conta na plataforma (`cwAccountId`), vinda da SESSÃO
 * @returns {string|null} o caminho absoluto, ou `null` quando não dá para montar
 */
export function enderecoEmbutido(item, contaId) {
  if (!ehEmbutido(item)) return null;
  const alvo = item.embutido.alvo;
  if (!alvo.includes(':conta')) return alvo;

  // Sem conta não se inventa uma. Chutar `1` abriria a conta de OUTRA empresa para quem por acaso
  // tivesse acesso a ela — e daria «acesso negado» para todo o resto, sem dizer por quê.
  const n = Number(contaId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return alvo.replace(':conta', String(n));
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
