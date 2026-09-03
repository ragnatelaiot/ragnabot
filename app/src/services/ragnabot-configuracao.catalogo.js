// ════════════════════════════════════════════════════════════════════════════════════════════════
// O CATÁLOGO DAS CONFIGURAÇÕES — contrato S7 (doc 34 §F8, painéis 8.1 a 8.13)
//
// ── POR QUE UM CATÁLOGO EM CÓDIGO, E NÃO UMA COLUNA POR AJUSTE ─────────────────────────────────
// São 29 itens de plano, e o dono já avisou que "virão mais telas". Uma coluna por ajuste seria
// uma migração por caixinha marcada — e migração é a coisa mais cara deste banco (LEI 2: nada de
// `db push`, SQL versionado à mão, cliente Prisma só vale depois de reiniciar o processo). Com
// catálogo, ajuste novo é UMA LINHA aqui: sem SQL, sem reinício, sem risco às 3 chaves compostas.
//
// O preço é conhecido e está pago de propósito: sem coluna, o banco não valida. Então quem valida
// é este arquivo, e ele valida ANTES de gravar — tipo, faixa, opções, tamanho. Valor que não passa
// aqui não chega ao `Json`.
//
// ── ⚠️ O CAMPO `efeito` — A HONESTIDADE DO PAINEL ──────────────────────────────────────────────
// Toda configuração diz se ALGUÉM A LÊ hoje:
//   'aplicado'  → existe código no produto que consulta esta chave e muda de comportamento
//   'declarado' → fica gravada e auditada, e NENHUM código a consulta ainda
// Isto não é enfeite: um painel cheio de interruptores que não fazem nada é pior que painel
// vazio — ensina o operador a desconfiar de todos, inclusive dos que funcionam. A tela mostra o
// aviso, a API devolve o campo, e `tests/ragnabot-configuracao.test.mjs` REPROVA se alguma chave
// marcada 'aplicado' não for encontrada em nenhum arquivo de `src/` fora deste catálogo.
//
// ── ⚠️ O CAMPO `jaExiste` — O QUE FOI MEDIDO ANTES DE CONSTRUIR ────────────────────────────────
// Metade do que parecia faltar já estava construído. Onde há motor pronto, a chave aponta para
// ele em vez de fingir que nasceu aqui. Serve de mapa para quem for ligar a tela.
//
// ── OS DOIS ESCOPOS ────────────────────────────────────────────────────────────────────────────
//   'empresa'  → uma linha POR EMPRESA. Empresa A não lê nem escreve a de B (é o teste de aceite).
//   'operador' → uma linha para a CASA (whitelabel, dias de teste). Só o operador do SaaS, e a
//                trava é `base/operador-saas.js`, no servidor — nunca o menu.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Os painéis, na ordem em que aparecem na tela (espelha o menu do chat atual). */
export const PAINEIS = Object.freeze([
  { id: 'atendimento', rotulo: 'Atendimento', escopo: 'empresa', doc: '8.1' },
  { id: 'horarios', rotulo: 'Horários', escopo: 'empresa', doc: '8.2' },
  { id: 'notificacoes', rotulo: 'Notificações', escopo: 'empresa', doc: '8.6' },
  { id: 'agenda', rotulo: 'Agenda', escopo: 'empresa', doc: '8.7' },
  { id: 'aparencia', rotulo: 'Aparência', escopo: 'empresa', doc: '8.8' },
  { id: 'mensagens', rotulo: 'Mensagens', escopo: 'empresa', doc: '8.9' },
  { id: 'integracoes', rotulo: 'Integrações', escopo: 'empresa', doc: '8.10' },
  { id: 'ia', rotulo: 'Inteligência artificial', escopo: 'empresa', doc: '8.11' },
  { id: 'sistema', rotulo: 'Sistema', escopo: 'empresa', doc: '8.12' },
  { id: 'whitelabel', rotulo: 'Whitelabel', escopo: 'operador', doc: '8.3' },
]);

export const IDS_DE_PAINEL = Object.freeze(PAINEIS.map((p) => p.id));

/** Provedores de IA do painel 8.11. Catálogo, e não um fornecedor cravado — 8.11.1. */
export const PROVEDORES_DE_IA = Object.freeze([
  { id: 'openai', rotulo: 'OpenAI', exigeUrlBase: false, modeloSugerido: 'gpt-4o-mini' },
  { id: 'anthropic', rotulo: 'Anthropic', exigeUrlBase: false, modeloSugerido: 'claude-haiku-4-5' },
  { id: 'google', rotulo: 'Google', exigeUrlBase: false, modeloSugerido: 'gemini-2.0-flash' },
  { id: 'azure_openai', rotulo: 'Azure OpenAI', exigeUrlBase: true, modeloSugerido: '' },
  // Serve qualquer servidor que fale o protocolo da OpenAI (inclusive um modelo nosso, na GB10).
  { id: 'compativel_openai', rotulo: 'Compatível com OpenAI (URL própria)', exigeUrlBase: true, modeloSugerido: '' },
]);

export const IDS_DE_PROVEDOR_DE_IA = Object.freeze(PROVEDORES_DE_IA.map((p) => p.id));

// ════════════════════════════════════════════════════════════════════════════════════════════════
// O QUE **NÃO** ENTROU, E POR QUÊ — o lugar está pronto, a decisão é do dono
//
// Nenhuma destas virou chave. Integração com terceiro que ninguém usa é dívida de manutenção de
// graça, e inventar credencial de fornecedor sem contrato é pior: cria um campo que parece
// funcionar. Quando o dono decidir, cada uma entra como um punhado de linhas no catálogo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const PENDENTES_DE_DECISAO = Object.freeze([
  {
    id: 'hubsoft',
    painel: 'integracoes',
    rotulo: 'HubSoft (sistema de gestão de provedor)',
    pergunta: 'A Ragnatela usa HubSoft? Sem isso, a integração é dívida de manutenção sem usuário.',
    doc: '8.10',
  },
  {
    id: 'connect_ai_meta',
    painel: 'integracoes',
    rotulo: 'Facebook e Instagram (ConnectAi / OficialAPI)',
    pergunta: 'Preso à Análise do App da Meta (doc 34 §F9/§S8) — não é decisão de código.',
    doc: '8.10',
  },
  {
    id: 'pagamento_alem_do_efi',
    painel: 'integracoes',
    rotulo: 'Outro provedor de pagamento além do Efí',
    pergunta: 'Decidido em 02/09: só Efí (doc 36). Restam a conta ser da Ragnatela ou de cada '
      + 'cliente, e só Pix ou também boleto/cartão.',
    doc: '8.10',
  },
  {
    id: 'whatsapp_api_provedores',
    painel: 'whitelabel',
    rotulo: 'Provedores de API de WhatsApp (aba WHATSAPP API, doc 34 §8.13)',
    pergunta: 'Depende da escolha do caminho A (Meta oficial) / B (Whatsmeow) / C (intermediário). '
      + 'É decisão de modelo de negócio, e ela precede o código.',
    doc: '8.13',
  },
  {
    id: 'ligar_capitao',
    painel: 'ia',
    rotulo: 'Ligar o agente de IA que ATENDE o cliente (Capitão)',
    pergunta: 'Camada pronta e DESLIGADA (doc 35 §S5). Este painel 8.11 é outra coisa: a IA que '
      + 'ajuda o ATENDENTE (resumir, sugerir), que erra para o lado da sugestão descartada.',
    doc: '8.11',
  },
]);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AS CHAVES
//
// campos:
//   chave      identificador estável, gravado no banco. NUNCA renomear (vira ajuste perdido).
//   painel     em qual aba aparece
//   rotulo     o texto da tela, em português
//   tipo       'bool' | 'texto' | 'inteiro' | 'opcao' | 'cor' | 'url' | 'segredo'
//   padrao     o valor quando ninguém configurou. É o que a leitura devolve.
//   opcoes     obrigatório quando tipo='opcao'
//   min/max    faixa de 'inteiro'; maxLen para 'texto'
//   efeito     'aplicado' | 'declarado'  (ver o cabeçalho — é a honestidade do painel)
//   jaExiste   onde já mora o motor deste ajuste, quando ele já existe
//   ajuda      a linha de explicação, em português claro
// ════════════════════════════════════════════════════════════════════════════════════════════════
const bruto = [
  // ── 8.1 ATENDIMENTO ───────────────────────────────────────────────────────────────────────────
  {
    chave: 'atendimento.saudacaoAutomatica', painel: 'atendimento', tipo: 'bool', padrao: true,
    rotulo: 'Enviar saudação automaticamente',
    efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.msgSaudacao guarda o TEXTO; este ajuste liga ou desliga o envio',
    ajuda: 'Manda a mensagem de boas-vindas assim que o cliente fala pela primeira vez.',
  },
  {
    chave: 'atendimento.mensagemAoTransferir', painel: 'atendimento', tipo: 'bool', padrao: true,
    rotulo: 'Enviar mensagem ao transferir',
    efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.msgTransferenciaTime / msgTransferenciaAgente',
    ajuda: 'Avisa o cliente quando o atendimento muda de setor ou de atendente.',
  },
  {
    chave: 'atendimento.historicoPor', painel: 'atendimento', tipo: 'opcao', padrao: 'global',
    opcoes: [
      { id: 'global', rotulo: 'Global — todo o histórico do contato' },
      { id: 'setor', rotulo: 'Por setor — só o histórico do setor em que a conversa está' },
    ],
    rotulo: 'Exibir histórico como',
    efeito: 'declarado',
    jaExiste: 'RagnabotConversa já tem setor (contrato S2); falta a caixa consultar este ajuste',
    ajuda: 'Quem abre a conversa vê tudo o que o cliente já falou, ou só o que passou por aquele setor.',
  },
  {
    chave: 'atendimento.ignorarMensagensDeGrupo', painel: 'atendimento', tipo: 'bool', padrao: false,
    rotulo: 'Ignorar mensagens de grupo', efeito: 'declarado',
    ajuda: 'Mensagem vinda de grupo de WhatsApp não abre atendimento.',
  },
  {
    chave: 'atendimento.aceitarLigacoes', painel: 'atendimento', tipo: 'bool', padrao: false,
    rotulo: 'Aceitar ligações pelo WhatsApp', efeito: 'declarado',
    ajuda: 'Quando desligado, a chamada é recusada e o cliente recebe a mensagem do painel Mensagens.',
  },
  {
    chave: 'atendimento.aceitarAudio', painel: 'atendimento', tipo: 'bool', padrao: true,
    rotulo: 'Aceitar mensagens de áudio', efeito: 'declarado',
    ajuda: 'Quando desligado, o áudio é recusado com a mensagem do painel Mensagens.',
  },
  {
    chave: 'atendimento.exigirSetorAoAceitar', painel: 'atendimento', tipo: 'bool', padrao: false,
    rotulo: 'Exigir escolha de setor ao aceitar o atendimento', efeito: 'declarado',
    ajuda: 'O atendente não consegue assumir a conversa sem dizer a que setor ela pertence.',
  },
  {
    chave: 'atendimento.assinaturaDoAtendente', painel: 'atendimento', tipo: 'bool', padrao: true,
    rotulo: 'Atendente pode enviar assinatura', efeito: 'declarado',
    ajuda: 'Acrescenta o nome de quem está atendendo ao fim da mensagem enviada.',
  },
  {
    chave: 'atendimento.mostrarBotaoPausar', painel: 'atendimento', tipo: 'bool', padrao: true,
    rotulo: 'Mostrar o botão de pausar atendimento', efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.distribuicaoPausada / pausadaAte / pausadaMotivo',
    ajuda: 'Esconde ou mostra o botão que suspende a distribuição de conversas novas.',
  },
  {
    chave: 'atendimento.carteiraDeClientes', painel: 'atendimento', tipo: 'opcao',
    padrao: 'por_atendimento',
    opcoes: [
      { id: 'por_contato', rotulo: 'Por contato — um responsável para o cliente inteiro' },
      { id: 'por_atendimento', rotulo: 'Por atendimento — cada conversa pode ter dono diferente' },
    ],
    rotulo: 'Carteira de clientes',
    efeito: 'declarado',
    ajuda: 'Decide a quem pertence o histórico: ao dono do CONTATO ou ao dono de cada CONVERSA. '
      + 'É decisão de modelo, não só de tela — mudar depois remexe em quem enxerga o quê.',
  },

  // ── 8.2 HORÁRIOS ──────────────────────────────────────────────────────────────────────────────
  // ⚠️ MEDIDO 02/09/2026: o expediente NÃO É configurado por este catálogo. Ele já tem modelo
  // próprio e muito mais rico — janela por linha (dois turnos no mesmo dia, almoço, plantão que
  // cruza a meia-noite), exceção de data (feriado fixo e recorrente) e CRUD completo em
  // `ragnabot-atendimento.routes.js` (`/politicas/:id/expedientes` e `/politicas/:id/excecoes`).
  // Duplicar aqui seria criar um segundo lugar que configura a mesma coisa — exatamente o que o
  // doc 34 §8.2 alerta. Este painel na tela CHAMA aquelas rotas. A única chave abaixo é o fuso,
  // que a tela precisa saber para desenhar as horas.
  {
    chave: 'horarios.avisarClienteForaDeHora', painel: 'horarios', tipo: 'bool', padrao: true,
    rotulo: 'Avisar o cliente quando estiver fora do expediente', efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.msgForaExpediente / msgIntervalo / msgFeriado guardam os textos',
    ajuda: 'O expediente em si (dias, janelas, almoço, feriados) é configurado no motor de '
      + 'atendimento, que já existe — esta aba abre aquelas telas, não guarda cópia.',
  },

  // ── 8.6 NOTIFICAÇÕES ──────────────────────────────────────────────────────────────────────────
  {
    chave: 'notificacoes.permitirAvaliacoes', painel: 'notificacoes', tipo: 'bool', padrao: false,
    rotulo: 'Permitir avaliações do atendimento', efeito: 'declarado',
    ajuda: 'Pergunta a nota ao cliente quando a conversa é encerrada. ⚠️ O motor da avaliação '
      + '(nota, comentário, o que fazer com nota baixa) ainda NÃO existe — este é o interruptor, '
      + 'e ele fica gravado esperando o motor.',
  },
  {
    chave: 'notificacoes.exibirAvaliacoesNaLista', painel: 'notificacoes', tipo: 'bool', padrao: false,
    rotulo: 'Exibir avaliações na lista de atendimentos', efeito: 'declarado',
    ajuda: 'Mostra a nota dada pelo cliente direto na fila, sem precisar abrir a conversa.',
  },
  {
    chave: 'notificacoes.perguntaDaAvaliacao', painel: 'notificacoes', tipo: 'texto', padrao: '',
    maxLen: 500, rotulo: 'Pergunta da avaliação', efeito: 'declarado',
    ajuda: 'O texto enviado ao cliente ao pedir a nota. Vazio = usa o texto padrão do sistema.',
  },
  {
    chave: 'notificacoes.notificarConversasEmGrupo', painel: 'notificacoes', tipo: 'bool', padrao: true,
    rotulo: 'Notificar conversas em grupo', efeito: 'declarado',
    ajuda: 'Mostra aviso na tela quando chega mensagem de uma conversa de grupo.',
  },
  {
    chave: 'notificacoes.somDeAlertaEmGrupo', painel: 'notificacoes', tipo: 'bool', padrao: false,
    rotulo: 'Alerta sonoro em conversas de grupo', efeito: 'declarado',
    ajuda: 'Toca o som de notificação também para grupo, não só para conversa individual.',
  },

  // ── 8.7 AGENDA — a chave que RESPONDE à pergunta da 8.2 ──────────────────────────────────────
  {
    chave: 'agenda.gerenciamentoDoExpediente', painel: 'agenda', tipo: 'opcao', padrao: 'empresa',
    opcoes: [
      { id: 'empresa', rotulo: 'Por empresa — um expediente para a operação inteira' },
      { id: 'setor', rotulo: 'Por setor — cada setor com o seu horário' },
      { id: 'conexao', rotulo: 'Por conexão — cada linha/número com o seu horário' },
    ],
    rotulo: 'Tipo de gerenciamento do expediente',
    efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.escopo já aceita empresa|caixa|time — este ajuste diz QUAL manda',
    ajuda: 'Quem manda no horário de funcionamento. Os outros níveis ficam inertes — é escolha do '
      + 'cliente, não precedência fixa, e é o que evita quatro telas configurando a mesma coisa.',
  },

  // ── 8.8 APARÊNCIA ─────────────────────────────────────────────────────────────────────────────
  {
    chave: 'aparencia.kanbanExibirFechados', painel: 'aparencia', tipo: 'bool', padrao: false,
    rotulo: 'Exibir atendimentos fechados no Kanban', efeito: 'declarado',
    ajuda: '⚠️ O Kanban ainda NÃO existe no Ragnabot (é conceito novo, doc 34 §8.8/§F3.7). '
      + 'O ajuste fica gravado para quando ele nascer.',
  },
  {
    chave: 'aparencia.modoDeExibicaoDasEtiquetas', painel: 'aparencia', tipo: 'opcao', padrao: 'texto',
    opcoes: [
      { id: 'texto', rotulo: 'Etiqueta com texto' },
      { id: 'bolinha', rotulo: 'Apenas bolinha colorida' },
    ],
    rotulo: 'Modo de exibição das etiquetas', efeito: 'declarado',
    ajuda: 'Como a etiqueta aparece no cartão da fila.',
  },
  {
    chave: 'aparencia.tema', painel: 'aparencia', tipo: 'opcao', padrao: 'sistema',
    opcoes: [
      { id: 'sistema', rotulo: 'Seguir o aparelho' },
      { id: 'claro', rotulo: 'Claro' },
      { id: 'escuro', rotulo: 'Escuro' },
    ],
    rotulo: 'Tema padrão da empresa', efeito: 'declarado',
    ajuda: 'O tema que a equipe encontra ao entrar. Cada pessoa pode trocar no aparelho dela.',
  },

  // ── 8.9 MENSAGENS ─────────────────────────────────────────────────────────────────────────────
  // ⚠️ PRECEDÊNCIA, escrita aqui para não virar duas telas escrevendo a mesma frase (doc 34 §8.9):
  // estas são as mensagens da EMPRESA. As da política (`RagnabotAtendPolitica.msg*`) são por
  // ESCOPO (empresa/caixa/time) e VENCEM esta, porque são mais específicas. As quatro abaixo não
  // têm par lá — foi por isso que entraram, e só por isso.
  {
    chave: 'mensagens.chamadaRecusada', painel: 'mensagens', tipo: 'texto', padrao: '', maxLen: 1000,
    rotulo: 'Mensagem ao recusar uma chamada', efeito: 'declarado',
    ajuda: 'Enviada quando o cliente liga e o ajuste "Aceitar ligações" está desligado.',
  },
  {
    chave: 'mensagens.audioNaoAceito', painel: 'mensagens', tipo: 'texto', padrao: '', maxLen: 1000,
    rotulo: 'Mensagem ao recusar um áudio', efeito: 'declarado',
    ajuda: 'Enviada quando chega áudio e o ajuste "Aceitar áudio" está desligado.',
  },
  {
    chave: 'mensagens.aoAceitarOAtendimento', painel: 'mensagens', tipo: 'texto', padrao: '', maxLen: 1000,
    rotulo: 'Mensagem ao aceitar o atendimento', efeito: 'declarado',
    ajuda: 'O cliente sabe que um humano assumiu. Aceita {{atendente}} e {{protocolo}}.',
  },
  {
    chave: 'mensagens.transferenciaDeSetor', painel: 'mensagens', tipo: 'texto', padrao: '', maxLen: 1000,
    rotulo: 'Mensagem ao transferir de setor (padrão da empresa)', efeito: 'declarado',
    jaExiste: 'RagnabotAtendPolitica.msgTransferenciaTime — que VENCE esta quando preenchida',
    ajuda: 'Usada quando a política do escopo não define uma mensagem própria.',
  },

  // ── 8.10 INTEGRAÇÕES ──────────────────────────────────────────────────────────────────────────
  // ⚠️ MEDIDO: `smtp.service.js` existe e lê SMTP_* do ambiente — é o servidor de e-mail DA CASA,
  // um só para todo mundo. As chaves abaixo são o e-mail DA EMPRESA CLIENTE (para o cliente
  // mandar e-mail com o domínio dele). Sem `smtpAtivo`, o produto continua usando o da casa —
  // que é o comportamento de hoje e não muda por esta entrega.
  {
    chave: 'integracoes.smtpAtivo', painel: 'integracoes', tipo: 'bool', padrao: false,
    rotulo: 'Usar servidor de e-mail próprio', efeito: 'declarado',
    jaExiste: 'smtp.service.js (o servidor da CASA, por variável de ambiente)',
    ajuda: 'Desligado, o e-mail sai pelo servidor da Ragnatela. Ligado, sai pelo seu.',
  },
  {
    chave: 'integracoes.smtpServidor', painel: 'integracoes', tipo: 'texto', padrao: '', maxLen: 200,
    rotulo: 'Servidor SMTP', efeito: 'declarado', ajuda: 'Ex.: smtp.suaempresa.com.br',
  },
  {
    chave: 'integracoes.smtpPorta', painel: 'integracoes', tipo: 'inteiro', padrao: 465,
    min: 1, max: 65535, rotulo: 'Porta', efeito: 'declarado',
    ajuda: '465 para conexão cifrada direta, 587 para STARTTLS.',
  },
  {
    chave: 'integracoes.smtpSeguro', painel: 'integracoes', tipo: 'bool', padrao: true,
    rotulo: 'Conexão cifrada (TLS)', efeito: 'declarado', ajuda: 'Deixe ligado na porta 465.',
  },
  {
    chave: 'integracoes.smtpUsuario', painel: 'integracoes', tipo: 'texto', padrao: '', maxLen: 200,
    rotulo: 'Usuário', efeito: 'declarado', ajuda: 'Geralmente o próprio endereço de e-mail.',
  },
  {
    // ⛔ SEGREDO. Cifrado com aes-256-gcm (`base/crypto.js`), nunca devolvido pela API, nunca em
    // log. A tela vê só a impressão digital — que serve para conferir "é a senha que eu pus?"
    // sem nunca poder reconstruí-la. Mesmo padrão de `RagnabotPagamentoCredencial` (contrato S6).
    chave: 'integracoes.smtpSenha', painel: 'integracoes', tipo: 'segredo', padrao: null,
    maxLen: 500, rotulo: 'Senha', efeito: 'declarado',
    ajuda: 'Guardada cifrada. Depois de salva, ninguém — nem a tela, nem o suporte — a lê de volta.',
  },
  {
    chave: 'integracoes.smtpRemetente', painel: 'integracoes', tipo: 'texto', padrao: '', maxLen: 200,
    rotulo: 'Endereço remetente', efeito: 'declarado', ajuda: 'O "de:" que o cliente vê.',
  },
  {
    chave: 'integracoes.smtpNomeRemetente', painel: 'integracoes', tipo: 'texto', padrao: '', maxLen: 120,
    rotulo: 'Nome do remetente', efeito: 'declarado', ajuda: 'O nome que aparece antes do endereço.',
  },
  {
    // ⚠️ AS CREDENCIAIS DO EFÍ **NÃO** MORAM AQUI. Elas já têm casa própria e melhor:
    // `RagnabotPagamentoCredencial` (contrato S-Efí, doc 36) — com Client_Id, Client_Secret, a
    // senha do certificado .p12 e o HMAC do webhook, cada um cifrado. Duplicar segredo em duas
    // tabelas é como um deles fica velho sem ninguém notar. Este ajuste é só o interruptor.
    chave: 'integracoes.pagamentoAtivo', painel: 'integracoes', tipo: 'bool', padrao: false,
    rotulo: 'Cobrança por Pix (Efí) ativa', efeito: 'declarado',
    jaExiste: 'RagnabotPagamentoCredencial + ragnabot-pagamento-efi.service.js (doc 36)',
    ajuda: 'As credenciais do Efí são cadastradas na tela de pagamento, não aqui — para não '
      + 'existirem em dois lugares. ⚠️ Em 02/09/2026 ainda não há credencial cadastrada.',
  },

  // ── 8.11 INTELIGÊNCIA ARTIFICIAL (a que ajuda o ATENDENTE) ───────────────────────────────────
  {
    chave: 'ia.ativa', painel: 'ia', tipo: 'bool', padrao: false,
    rotulo: 'Recursos de IA para o atendente', efeito: 'declarado',
    ajuda: 'Liga o resumo do atendimento e a sugestão de resposta. ⚠️ NÃO é o agente que atende '
      + 'o cliente sozinho — este só sugere ao humano, que aceita ou descarta.',
  },
  {
    chave: 'ia.provedor', painel: 'ia', tipo: 'opcao', padrao: 'openai',
    opcoes: PROVEDORES_DE_IA.map((p) => ({ id: p.id, rotulo: p.rotulo })),
    rotulo: 'Provedor', efeito: 'declarado',
    ajuda: 'Trocável por catálogo: mudar de fornecedor não exige migração nem código novo.',
  },
  {
    chave: 'ia.modelo', painel: 'ia', tipo: 'texto', padrao: '', maxLen: 120,
    rotulo: 'Modelo', efeito: 'declarado', ajuda: 'Ex.: gpt-4o-mini. Vazio = o sugerido do provedor.',
  },
  {
    chave: 'ia.urlBase', painel: 'ia', tipo: 'url', padrao: '', maxLen: 300,
    rotulo: 'URL do serviço', efeito: 'declarado',
    ajuda: 'Só para Azure OpenAI e para servidores compatíveis com a OpenAI (inclusive um nosso).',
  },
  {
    // ⛔ SEGREDO, mesma regra da senha de SMTP.
    chave: 'ia.chave', painel: 'ia', tipo: 'segredo', padrao: null, maxLen: 500,
    rotulo: 'Chave da API', efeito: 'declarado',
    ajuda: 'Guardada cifrada e nunca devolvida. ⛔ Chave de IA JAMAIS vai para o repositório.',
  },
  {
    chave: 'ia.resumirAtendimento', painel: 'ia', tipo: 'bool', padrao: false,
    rotulo: 'Resumir atendimento', efeito: 'declarado',
    ajuda: 'Botão no menu da conversa que gera um resumo do que já foi conversado.',
  },
  {
    chave: 'ia.sugerirResposta', painel: 'ia', tipo: 'bool', padrao: false,
    rotulo: 'Sugerir resposta ao atendente', efeito: 'declarado',
    ajuda: 'Propõe um texto; quem envia continua sendo a pessoa.',
  },
  {
    chave: 'ia.tetoCustoCentavosMes', painel: 'ia', tipo: 'inteiro', padrao: 0, min: 0, max: 100000000,
    rotulo: 'Teto de custo por mês (centavos)', efeito: 'declarado',
    jaExiste: 'RagnabotCapitaoConsumoMes já mede consumo — o mesmo medidor serve aqui',
    ajuda: '0 = sem teto próprio (vale o do plano). IA é cobrada por uso; teto é o freio que '
      + 'evita a conta surpresa.',
  },

  // ── 8.12 SISTEMA ──────────────────────────────────────────────────────────────────────────────
  {
    chave: 'sistema.corretorOrtografico', painel: 'sistema', tipo: 'bool', padrao: true,
    rotulo: 'Correção ortográfica no que o atendente digita', efeito: 'declarado',
    ajuda: 'Liga a correção do próprio navegador na caixa de resposta.',
  },
  {
    // ⚠️ MEDIDO 02/09/2026, e a medição muda o que este ajuste PODE fazer: quem confere e-mail e
    // senha é a PLATAFORMA (`src/rotas-sessao.js` chama o login de lá; a senha não passa nem por
    // memória nossa além da chamada). Então a exigência de senha forte é cumprida LÁ, não aqui.
    // Deixar o interruptor prometendo o que não fazemos seria mentir no painel.
    chave: 'sistema.exigirSenhaForte', painel: 'sistema', tipo: 'bool', padrao: true,
    rotulo: 'Exigir senha forte', efeito: 'declarado', informativo: true,
    ajuda: '⚠️ Quem confere a senha é a plataforma de atendimento, não o Ragnabot — este ajuste '
      + 'registra a política da empresa, mas quem a aplica no login é ela.',
  },
  {
    // ⚠️ MEDIDO: a revogação de sessão do Ragnabot é uma lista EM MEMÓRIA (`base/auth.js`), e o
    // motor sobe com 2 réplicas. Derrubar a sessão numa réplica não a derruba na outra. Fechar
    // isso de verdade exige tabela de sessões — mudança de esquema, decisão do chefe. Enquanto
    // não houver, o interruptor fica com a limitação ESCRITA, não escondida.
    chave: 'sistema.sessaoUnicaPorPessoa', painel: 'sistema', tipo: 'bool', padrao: false,
    rotulo: 'Permitir apenas uma sessão por pessoa', efeito: 'declarado', informativo: true,
    ajuda: '⚠️ Hoje a derrubada de sessão vale só na réplica que atendeu a saída. Aplicar isto '
      + 'em todas exige uma tabela de sessões — está no relatório, e não é fingido aqui.',
  },

  // ── 8.3 WHITELABEL — ESCOPO OPERADOR (a ordem do dono) ───────────────────────────────────────
  {
    chave: 'whitelabel.nomeDoSistema', painel: 'whitelabel', tipo: 'texto', padrao: 'Ragnabot',
    maxLen: 80, rotulo: 'Nome do sistema', efeito: 'declarado',
    ajuda: 'O nome que aparece na aba do navegador, no login e nos e-mails.',
  },
  {
    chave: 'whitelabel.numeroDeSuporte', painel: 'whitelabel', tipo: 'texto', padrao: '', maxLen: 40,
    rotulo: 'Número de suporte', efeito: 'declarado', ajuda: 'WhatsApp que aparece no rodapé.',
  },
  {
    chave: 'whitelabel.mostrarLinkDeCadastro', painel: 'whitelabel', tipo: 'bool', padrao: false,
    rotulo: 'Mostrar link de cadastro no login', efeito: 'declarado',
    ajuda: 'Ligado, qualquer visitante pode pedir uma conta. Desligado, só quem é convidado entra.',
  },
  { chave: 'whitelabel.corPrimariaClara', painel: 'whitelabel', tipo: 'cor', padrao: '#0f766e', rotulo: 'Cor primária (modo claro)', efeito: 'declarado', ajuda: 'Botões e destaques.' },
  { chave: 'whitelabel.corPrimariaEscura', painel: 'whitelabel', tipo: 'cor', padrao: '#2dd4bf', rotulo: 'Cor primária (modo escuro)', efeito: 'declarado', ajuda: 'Botões e destaques no tema escuro.' },
  { chave: 'whitelabel.corIconesClara', painel: 'whitelabel', tipo: 'cor', padrao: '#0f766e', rotulo: 'Cor dos ícones (modo claro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corIconesEscura', painel: 'whitelabel', tipo: 'cor', padrao: '#2dd4bf', rotulo: 'Cor dos ícones (modo escuro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corBarraSuperiorClara', painel: 'whitelabel', tipo: 'cor', padrao: '#ffffff', rotulo: 'Cor da barra superior (modo claro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corBarraSuperiorEscura', painel: 'whitelabel', tipo: 'cor', padrao: '#0b1220', rotulo: 'Cor da barra superior (modo escuro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corMenuLateralClara', painel: 'whitelabel', tipo: 'cor', padrao: '#f8fafc', rotulo: 'Cor do menu lateral (modo claro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corMenuLateralEscura', painel: 'whitelabel', tipo: 'cor', padrao: '#0b1220', rotulo: 'Cor do menu lateral (modo escuro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.fundoDaPaginaClaro', painel: 'whitelabel', tipo: 'cor', padrao: '#f1f5f9', rotulo: 'Fundo da página (modo claro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.fundoDaPaginaEscuro', painel: 'whitelabel', tipo: 'cor', padrao: '#020617', rotulo: 'Fundo da página (modo escuro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.fundoDoCartaoClaro', painel: 'whitelabel', tipo: 'cor', padrao: '#ffffff', rotulo: 'Fundo dos cartões (modo claro)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.fundoDoCartaoEscuro', painel: 'whitelabel', tipo: 'cor', padrao: '#0f172a', rotulo: 'Fundo dos cartões (modo escuro)', efeito: 'declarado', ajuda: '' },
  {
    chave: 'whitelabel.logotipoUrl', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500,
    rotulo: 'Logotipo (900×300)', efeito: 'declarado',
    ajuda: '⚠️ Guardamos o ENDEREÇO da imagem, não o arquivo. O envio com recorte é tela, e o '
      + 'destino do arquivo é o MinIO próprio — está no relatório como próximo passo.',
  },
  { chave: 'whitelabel.logoDoLoginUrl', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500, rotulo: 'Logo da tela de entrada (900×300)', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.bannerUrl', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500, rotulo: 'Banner (1280×720)', efeito: 'declarado', ajuda: '' },
  {
    chave: 'whitelabel.modeloDaTelaDeEntrada', painel: 'whitelabel', tipo: 'opcao', padrao: 'padrao',
    opcoes: [
      { id: 'padrao', rotulo: 'Padrão' },
      { id: 'lateral', rotulo: 'Imagem ao lado' },
      { id: 'centralizado', rotulo: 'Cartão centralizado' },
    ],
    rotulo: 'Modelo da tela de entrada', efeito: 'declarado', ajuda: '',
  },
  { chave: 'whitelabel.fundoDaEntradaUrl', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500, rotulo: 'Imagem de fundo da entrada', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.corDoFundoDaEntrada', painel: 'whitelabel', tipo: 'cor', padrao: '#0b1220', rotulo: 'Cor de fundo da entrada', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.urlDaPoliticaDePrivacidade', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500, rotulo: 'URL da Política de Privacidade', efeito: 'declarado', ajuda: '' },
  { chave: 'whitelabel.urlDosTermosDeUso', painel: 'whitelabel', tipo: 'url', padrao: '', maxLen: 500, rotulo: 'URL dos Termos de Uso', efeito: 'declarado', ajuda: '' },
  {
    chave: 'whitelabel.msgBoasVindasWhatsapp', painel: 'whitelabel', tipo: 'texto', padrao: '',
    maxLen: 2000, rotulo: 'Boas-vindas por WhatsApp', efeito: 'declarado',
    ajuda: 'Enviada à empresa nova quando a conta é criada.',
  },
  {
    chave: 'whitelabel.msgBoasVindasEmail', painel: 'whitelabel', tipo: 'texto', padrao: '',
    maxLen: 8000, rotulo: 'Boas-vindas por e-mail (HTML)', efeito: 'declarado',
    ajuda: 'Aceita HTML. A tela mostra a pré-visualização antes de salvar.',
  },
  {
    chave: 'whitelabel.msgRedefinicaoDeSenha', painel: 'whitelabel', tipo: 'texto', padrao: '',
    maxLen: 8000, rotulo: 'E-mail de redefinição de senha (HTML)', efeito: 'declarado',
    // A marca `{tokenSenha}` é validada: mensagem de redefinição sem o token é um e-mail que
    // chega e não serve para nada — e o cliente só descobre quando não consegue entrar.
    exigeMarcas: ['{tokenSenha}'],
    ajuda: 'Precisa conter {tokenSenha} — é onde entra o link de redefinição.',
  },
  {
    chave: 'whitelabel.msgCodigoDeVerificacao', painel: 'whitelabel', tipo: 'texto', padrao: '',
    maxLen: 2000, rotulo: 'Mensagem do código de verificação (OTP)', efeito: 'declarado',
    ajuda: 'Aceita {codigo}. Vazio = usa o texto padrão do sistema.',
  },
  {
    // 8.12.4 — mora no WHITELABEL/operador, e não no painel Sistema da empresa: período de
    // avaliação é regra comercial de quem VENDE, não ajuste de quem usa. Uma empresa cliente que
    // pudesse editar o próprio período de teste teria assinatura infinita de graça.
    chave: 'whitelabel.diasDeTeste', painel: 'whitelabel', tipo: 'inteiro', padrao: 7, min: 0, max: 365,
    rotulo: 'Dias de teste da empresa nova', efeito: 'declarado',
    jaExiste: 'RagnabotTenant.trialEndsAt + ragnabot-tenant.service.js',
    ajuda: 'Quantos dias a empresa nova fica em avaliação antes de a cobrança começar.',
  },
];

/** Índice por chave, congelado. É por aqui que serviço e rota consultam. */
export const CHAVES = Object.freeze(Object.fromEntries(
  bruto.map((c) => [c.chave, Object.freeze({
    ...c,
    escopo: PAINEIS.find((p) => p.id === c.painel)?.escopo || 'empresa',
    segredo: c.tipo === 'segredo',
  })]),
));

export const NOMES_DE_CHAVE = Object.freeze(Object.keys(CHAVES));

/** A definição, ou `null`. Chave desconhecida NÃO é gravada — senão o catálogo vira sugestão. */
export function definicao(chave) {
  return CHAVES[String(chave || '')] || null;
}

/** As chaves de um painel, na ordem em que foram declaradas. */
export function chavesDoPainel(painel) {
  return bruto.filter((c) => c.painel === painel).map((c) => CHAVES[c.chave]);
}

/** O escopo de um painel: 'empresa' ou 'operador'. Painel desconhecido → null. */
export function escopoDoPainel(painel) {
  return PAINEIS.find((p) => p.id === painel)?.escopo || null;
}

/** Os padrões de um painel, prontos para a leitura que ninguém configurou ainda. */
export function padroesDoPainel(painel) {
  const saida = {};
  for (const def of chavesDoPainel(painel)) saida[def.chave] = def.padrao;
  return saida;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO — o banco não valida `Json`, então quem valida é isto, ANTES de gravar
// ════════════════════════════════════════════════════════════════════════════════════════════════

const COR_HEX = /^#[0-9a-fA-F]{6}$/u;

export class ErroDeConfiguracao extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ErroDeConfiguracao';
    this.code = code;
    this.status = status;
  }
}

/**
 * Confere e NORMALIZA um valor para uma chave. Devolve o valor já no formato de gravação.
 * Lança `ErroDeConfiguracao` quando não passa — nunca grava "quase certo".
 */
export function validar(chave, valor) {
  const def = definicao(chave);
  if (!def) throw new ErroDeConfiguracao('CHAVE_DESCONHECIDA', `Ajuste desconhecido: "${chave}".`);

  // `null` é sempre "voltar ao padrão" — o jeito de LIMPAR sem inventar um verbo novo.
  if (valor === null || valor === undefined) return null;

  switch (def.tipo) {
    case 'bool': {
      if (typeof valor === 'boolean') return valor;
      // Tela manda 'true'/'false' em texto com frequência; aceitar é gentileza barata. Mas só
      // estes dois — um 'sim' viraria `false` em silêncio, que é o pior desfecho possível.
      if (valor === 'true') return true;
      if (valor === 'false') return false;
      throw new ErroDeConfiguracao('TIPO_INVALIDO', `"${def.rotulo}" aceita apenas ligado ou desligado.`);
    }
    case 'inteiro': {
      const n = Number(valor);
      if (!Number.isInteger(n)) throw new ErroDeConfiguracao('TIPO_INVALIDO', `"${def.rotulo}" aceita apenas número inteiro.`);
      if (def.min !== undefined && n < def.min) throw new ErroDeConfiguracao('FORA_DA_FAIXA', `"${def.rotulo}" não pode ser menor que ${def.min}.`);
      if (def.max !== undefined && n > def.max) throw new ErroDeConfiguracao('FORA_DA_FAIXA', `"${def.rotulo}" não pode ser maior que ${def.max}.`);
      return n;
    }
    case 'opcao': {
      const v = String(valor);
      const ok = (def.opcoes || []).some((o) => o.id === v);
      if (!ok) {
        const lista = (def.opcoes || []).map((o) => o.id).join(', ');
        throw new ErroDeConfiguracao('OPCAO_INVALIDA', `"${def.rotulo}" aceita: ${lista}.`);
      }
      return v;
    }
    case 'cor': {
      const v = String(valor).trim();
      if (!COR_HEX.test(v)) throw new ErroDeConfiguracao('COR_INVALIDA', `"${def.rotulo}" precisa ser uma cor no formato #RRGGBB.`);
      return v.toLowerCase();
    }
    case 'url': {
      const v = String(valor).trim();
      if (v === '') return '';
      if (v.length > (def.maxLen || 500)) throw new ErroDeConfiguracao('MUITO_LONGO', `"${def.rotulo}" passou de ${def.maxLen || 500} caracteres.`);
      let u;
      try { u = new URL(v); } catch { throw new ErroDeConfiguracao('URL_INVALIDA', `"${def.rotulo}" precisa ser um endereço completo (https://…).`); }
      // ⛔ Só http/https. Sem esta linha, um `javascript:` gravado no whitelabel viraria execução
      // de código na tela de entrada de TODOS os clientes — o whitelabel é servido a todo mundo.
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new ErroDeConfiguracao('URL_INVALIDA', `"${def.rotulo}" aceita apenas endereços http:// ou https://.`);
      }
      return v;
    }
    case 'texto': {
      const v = String(valor);
      const teto = def.maxLen || 1000;
      if (v.length > teto) throw new ErroDeConfiguracao('MUITO_LONGO', `"${def.rotulo}" passou de ${teto} caracteres.`);
      for (const marca of def.exigeMarcas || []) {
        if (v !== '' && !v.includes(marca)) {
          throw new ErroDeConfiguracao('MARCA_AUSENTE', `"${def.rotulo}" precisa conter ${marca}.`);
        }
      }
      return v;
    }
    case 'segredo': {
      const v = String(valor);
      if (v === '') return null; // vazio = apagar o segredo, e não gravar string vazia cifrada
      const teto = def.maxLen || 500;
      if (v.length > teto) throw new ErroDeConfiguracao('MUITO_LONGO', `"${def.rotulo}" passou de ${teto} caracteres.`);
      return v;
    }
    default:
      throw new ErroDeConfiguracao('TIPO_DESCONHECIDO', `Tipo não previsto: ${def.tipo}.`);
  }
}

export default {
  PAINEIS, IDS_DE_PAINEL, CHAVES, NOMES_DE_CHAVE, PROVEDORES_DE_IA, IDS_DE_PROVEDOR_DE_IA,
  PENDENTES_DE_DECISAO, definicao, chavesDoPainel, escopoDoPainel, padroesDoPainel,
  validar, ErroDeConfiguracao,
};
