// ════════════════════════════════════════════════════════════════════════════════════════════════
// EXECUTORES DE NÓ DO MOTOR DE FLUXO DO RAGNABOT
//
// Base: /ia/.claude/modulo-atendimento/28-MOTOR-DE-FLUXO-ESPECIFICACAO.md §4 (catálogo de nós) e
//       /ia/.claude/modulo-atendimento/25-FLUXO-ABERTURA-DE-CHAMADO.md §11 (os oito acréscimos)
//       e §12.6 (as nove correções que o fluxo real exige).
//
// Ordem do dono (28/08/2026): "se você criar algo NATIVO no Ragnabot sem a necessidade do Typebot,
// melhor ainda". Portanto aqui não há cliente de Typebot, nem de nuvem de terceiro: o nó `http` é
// genérico e sai pelo egresso da casa, e o chamado nasce DENTRO do Ragnabot.
//
// ─── O QUE ESTE ARQUIVO É ───────────────────────────────────────────────────────────────────────
// Um executor por tipo de nó, todos com a MESMA forma (§4.1):
//     { tipo, efeito, politicaEmDuvida, estaciona, aceitaModeloFora,
//       saidas(config), saidasDeFalha, validar(no, ctx), preparar(no, ctx), executar(ctx),
//       receber(ctx, entrada), continuar(ctx, resultado) }
//
// `preparar()` monta o que SAIRIA sem enviar, e é a MESMA função que alimenta a prévia do editor,
// o modo de teste e o envio real. É esse compartilhamento — e não disciplina de quem edita — que
// torna mecanicamente impossível o aviso do editor divergir da execução três semanas depois.
//
// ─── AS TRÊS REGRAS DO MOTOR, E COMO CADA UMA APARECE AQUI ──────────────────────────────────────
// O motor (`ragnabot-fluxo-motor.service.js`) impõe três regras que o contrato original não diz, e
// as impõe DETECTANDO a violação, não confiando. Nenhum executor deste arquivo as contraria:
//
//   R1 — NADA DE REDE dentro de `preparar`, `executar`, `receber` e `continuar`. Elas rodam na
//        transação curta, onde `ctx.canal` e `ctx.egresso` são sentinelas que lançam ao primeiro
//        acesso. Quem precisa da rede devolve uma INTENÇÃO em `preparar()`; o motor despacha depois
//        do commit. A conferência que sobra para o executor é a que não precisa de rede: a janela de
//        24 h (estado gravado) e os tetos da Meta (contagem local).
//   R2 — `executar()` devolve a transição PRETENDIDA. Falha de despacho é rerroteada pela T2 do
//        motor por `erro`, `erro_interno` ou `sem_janela`. Executor que tentasse adivinhar sucesso
//        de envio duplicaria responsabilidade e mentiria quando o envio falhasse depois do commit.
//   R3 — nó que depende do RESULTADO de chamada externa (`http`) devolve
//        `{tipo:'aguardar', motivo:'http'}` e implementa `continuar(ctx, resultado)`. A volta pela
//        FILA é o que faz a chamada sobreviver a um reinício no meio: sem ela, uma implantação
//        durante os 15 s de tempo limite deixaria a conversa parada para sempre, com o chamado
//        talvez aberto do outro lado e ninguém sabendo.
//
// ─── DIVERGÊNCIAS DECLARADAS EM RELAÇÃO AO CONTRATO ─────────────────────────────────────────────
// 1. UM ARQUIVO, NÃO QUINZE. A especificação §4.1 pede `src/motor/nos/<tipo>.js`. A divisão desta
//    entrega me deu a posse de UM arquivo, e escrever fora dele sobrescreveria trabalho de outro
//    agente rodando ao mesmo tempo. A forma do objeto exportado é idêntica à do contrato, então
//    quebrar isto em quinze arquivos depois é recorte, não reescrita: `EXECUTORES` já é o registro
//    que `src/motor/nos/index.js` precisa expor.
//
// 2. DEZESSETE TIPOS, NÃO QUINZE. Acrescentei `chamado` e `email`. A especificação §4.2 dobra a emissão do
//    protocolo dentro de `inicio`, mas o fluxo real medido abre o chamado no nó 33 — depois de o
//    cliente confirmar —, e uma conversa que só passa pelo menu e vai embora não deveria consumir
//    um número da sequência da empresa. Os dois tipos chamam O MESMO helper `garantirProtocolo()`,
//    que delega a `ragnabot-protocolo.service.emitirProtocolo()`; como ele é idempotente por
//    conversa, usar os dois no mesmo fluxo devolve o mesmo número. Não há segunda numeração, não há
//    segunda fonte de verdade, e nada aqui reimplementa a sequência.
//
//    `email` (acréscimo B-MOTOR, 29/08/2026) vem do `emailNode` medido na paleta do bot atual, e não
//    se confunde com `notificar`: aquele avisa GENTE DA CASA por papel/time/usuário e recusa
//    endereço cravado no fluxo; este escreve para o endereço que a CONVERSA produziu (o comprovante
//    com o protocolo, o resumo do pedido). Fundir os dois obrigaria um deles a mentir sobre para
//    quem escreve. O envio sai por porta injetável (`ctx.email` → `smtp.service.js`) e acontece
//    DEPOIS do commit, em `enviarEmailDaIntencao()` — nunca dentro da T1.
//
// 3. `executar()` PODE DEVOLVER `varsPatch`. O contrato declara `ResultadoNo` como união fechada
//    sem lugar para variáveis, mas declara `variavel` como um tipo de nó — que existe justamente
//    para escrever variável. É contradição interna do contrato. Resolvi pelo lado aditivo: o membro
//    da união continua válido e ganha uma propriedade opcional `varsPatch`. Quem consumir sem
//    conhecer a propriedade continua funcionando; quem conhecer, aplica o patch na MESMA transação
//    em que grava o avanço do nó. A constante `RESULTADO_ACEITA_VARS_PATCH` existe para o motor
//    poder afirmar isso por leitura, em vez de por suposição.
//
// 4. `inicio` e `chamado` têm efeito `repetivel`, não `nenhum`. A tabela §4.2 marca `inicio` como
//    efeito `nenhum`, mas ele carimba a conversa no Chatwoot — que é chamada de rede. Classificar
//    como `nenhum` faria o motor NÃO CHAMAR `preparar()` (ele só o chama quando o efeito é diferente
//    de `nenhum`) e o carimbo nunca sairia. O carimbo é melhor esforço (§H do contrato: "em
//    divergência, o nosso banco é a verdade"), por isso a falha dele nunca derruba o nó.
//
// 5. EXISTE UMA INTENÇÃO `tipo:'carimbar'`. A união de `IntencaoSaida` do contrato não a tem, e a
//    `PortaCanal` expõe `carimbar()` como MÉTODO — mas o motor só despacha INTENÇÕES, e método não
//    atravessa a fronteira da T1. Sem um tipo para ela, o carimbo de fluxo/versão/protocolo na
//    conversa (o D12, hoje nulo em 100 % dos casos medidos) não teria como sair. Adaptador que não
//    conheça o tipo apenas não carimba; nada mais quebra.
//
// 6. EXISTE `saidasDeFalha` NO EXECUTOR. O contrato §4.1 não tem o campo, e o acréscimo nasceu de um
//    defeito medido neste arquivo: `pergunta`, `lista` e `botoes` devolviam `falhar('sem_janela', …)`
//    sem declarar essa saída em lugar nenhum. Como o editor e o validador de grafo montam os
//    conectores a partir de `saidasDe()`, a aresta era INDESENHÁVEL — o motor resolvia a saída, não
//    achava destino e encerrava a execução em silêncio, sem uma palavra ao cliente e sem chamar
//    ninguém. Declarar a saída de falha SEPARADA das saídas de desenho preserva a regra do §4.3/A1
//    (exceção é gerada pelo motor, não desenhada pelo autor) e ainda assim faz o conector existir na
//    tela e ser cobrado na publicação, como o §5.4 exige para o nó `lista`. Executor que não declare
//    o campo continua válido: `saidasDe()` lê `?? []`.
//
// ─── LIGAÇÃO COM OS UTILITÁRIOS DE `src/motor/` ─────────────────────────────────────────────────
// `medir`, `cortarSeguro`, `casarOpcao` e `interpolar` pertencem a `src/motor/*.js` pelo contrato,
// e esses arquivos ainda não existem no repositório (conferido: `ls src/motor` → inexistente). Em
// vez de esperar por eles ou de fixar uma cópia paralela para sempre, este arquivo TENTA importar
// os canônicos ao carregar e só usa a implementação local quando o canônico não estiver lá. Assim
// não existem duas verdades no momento em que o outro arquivo aparecer: ele passa a valer sozinho,
// sem ninguém precisar lembrar de vir aqui apagar nada. `ORIGEM_DOS_UTILITARIOS` diz, em tempo de
// execução, de onde cada um veio — para o diagnóstico ser leitura e não arqueologia.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** O motor pode conferir por leitura que `executar()` devolve patch de variáveis (divergência 3). */
export const RESULTADO_ACEITA_VARS_PATCH = true;

/**
 * As três saídas de exceção são GERADAS PELO MOTOR em todo nó que estaciona, nunca desenhadas pelo
 * autor do fluxo (§4.3/A1). Deixá-las como conector opcional garante que metade dos fluxos esquece,
 * e a medição do fluxo real diz que 151 das 518 apresentações do nó CONFIRMACAO vivem exatamente
 * aqui — quase três em cada dez conversas.
 */
export const SAIDAS_DE_EXCECAO = Object.freeze(['sem_resposta', 'opcao_invalida', 'erro']);

/** Saída de falha de encanamento INTERNO. Nunca se mistura com `erro` (§4.4). */
export const SAIDA_ERRO_INTERNO = 'erro_interno';

/**
 * Perfil de limites usado quando o chamador não passa um. É cópia do que a documentação pública da
 * Meta afirma, com `origem:'documentacao'` — ou seja, PALPITE ASSUMIDO, não medição. Enquanto for
 * palpite, o validador conta pelo PIOR CASO das três unidades e escreve isso na tela. Aviso que se
 * declara palpite não corrói a confiança nos avisos que são regra.
 *
 * A fonte de verdade é `RagnabotFluxoLimiteCanal` (tabela datada). Isto aqui é rede de segurança
 * para a prévia do editor rodar sem ida ao banco — nunca para substituir a tabela.
 */
export const PERFIL_LIMITES_PADRAO = Object.freeze({
  perfil: 'whatsapp_cloud@2026-08',
  origem: 'documentacao',
  unidade: 'indefinida',
  conferidoEm: null,
  valores: Object.freeze({
    botoes_max: 3,
    botao_rotulo_max: 20,
    lista_itens_max: 10,
    lista_secoes_max: 10,
    lista_titulo_max: 24,
    lista_descricao_max: 72,
    lista_botao_max: 20,
    // Título de SEÇÃO da lista. A Meta conta este teto separado do título do item, e hoje os dois
    // valem 24 pela documentação. Fica com nome próprio para o dia em que a calibração medir os dois
    // e eles divergirem: mudar um número não pode arrastar o outro sem alguém decidir.
    lista_secao_titulo_max: 24,
    // Endereço do botão de URL (`cta_url`). Teto DOCUMENTADO da Meta, nunca medido nesta casa.
    botao_url_max: 2000,
    corpo_max: 1024,
    rodape_max: 60,
    cabecalho_max: 60,
    texto_max: 4096,
    midia_bytes_max: 16 * 1024 * 1024,
    janela_servico_horas: 24,
  }),
});

/** Unidades de tempo aceitas em `esperaResposta` (A2: unidade é OBRIGATÓRIA, nunca inferida). */
const MS_POR_UNIDADE = Object.freeze({
  segundos: 1000,
  minutos: 60 * 1000,
  horas: 60 * 60 * 1000,
  dias: 24 * 60 * 60 * 1000,
});

/** Sufixo do corte. O texto INTEGRAL segue para o chamado e para a nota interna (§4.6). */
const SUFIXO_CORTE = '… (texto completo registrado no chamado)';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS — implementação local, usada só enquanto `src/motor/*.js` não existir
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * §4.6. NINGUÉM MEDIU em que unidade a Meta conta caracteres, e a diferença não é acadêmica: o
 * título real «Sim! Abra o chamado! ✅ » tem 23 em qualquer unidade contra um teto de 24 — sobra um,
 * e ele termina em espaço, que conta. Trocar o ✅ por uma bandeira (dois indicadores regionais) dá
 * 23 grafemas, 24 pontos de código e 26 unidades UTF-16: três vereditos para a mesma linha. Por isso
 * devolvemos as três contagens e o pior caso, em vez de escolher uma e torcer.
 */
function medirLocal(texto) {
  const t = String(texto ?? '');
  let grafemas = t.length;
  try {
    grafemas = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(t)].length;
  } catch {
    // Intl.Segmenter ausente (build de Node sem ICU completo): cair para pontos de código é uma
    // contagem MENOR que a real de grafemas, então o piorCaso abaixo continua conservador.
    grafemas = [...t].length;
  }
  const utf16 = t.length;
  const pontos = [...t].length;
  return { grafemas, pontos, utf16, piorCaso: Math.max(grafemas, pontos, utf16) };
}

/** Fatia por GRAFEMA — nunca parte sequência ZWJ nem par substituto (emoji virando lixo na tela). */
function fatiarPorGrafema(texto, quantidade) {
  const t = String(texto ?? '');
  let pedacos;
  try {
    pedacos = [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(t)].map((s) => s.segment);
  } catch {
    pedacos = [...t];
  }
  return pedacos.slice(0, Math.max(0, quantidade)).join('');
}

/**
 * Remove a ÚLTIMA ocorrência de cada marcador do WhatsApp que tenha ficado sem par.
 *
 * Removo em vez de fechar de propósito: fechar acrescenta caractere e pode reestourar o teto que o
 * corte acabou de respeitar. E deixar `*` órfão não é cosmético — o WhatsApp mostra o asterisco cru
 * e o resumo que o cliente lê vira lixo visual bem no nó de confirmação.
 */
function equilibrarMarcacao(texto) {
  let t = String(texto ?? '');
  for (const marcador of ['*', '_', '~']) {
    const ocorrencias = t.split(marcador).length - 1;
    if (ocorrencias % 2 === 1) {
      const ultima = t.lastIndexOf(marcador);
      t = t.slice(0, ultima) + t.slice(ultima + 1);
    }
  }
  return t;
}

/**
 * §4.6. REGRA GERAL DO MOTOR: limite que um corte resolve NUNCA derruba o nó. Recusar só quando
 * truncar mudaria o sentido, e aí o nó declara `aoEstourar:'recusar'` explicitamente.
 *
 * O sufixo «… (texto completo registrado no chamado)» só entra quando há espaço folgado para ele;
 * pendurá-lo num título de lista de 24 caracteres consumiria o título inteiro e diria ao cliente
 * uma frase sobre chamado onde deveria haver uma opção de menu.
 */
function cortarSeguroLocal(texto, teto, { unidade = 'piorCaso', sufixo = SUFIXO_CORTE } = {}) {
  const t = String(texto ?? '');
  const limite = Number(teto);
  if (!Number.isFinite(limite) || limite <= 0) return t;
  const conta = (s) => {
    const m = medirLocal(s);
    return unidade === 'piorCaso' ? m.piorCaso : (m[unidade] ?? m.piorCaso);
  };
  if (conta(t) <= limite) return t;

  const cabeSufixo = limite >= conta(sufixo) + 20;
  const orcamento = cabeSufixo ? limite - conta(sufixo) : limite - 1;

  // Busca binária sobre a quantidade de GRAFEMAS: a relação grafema→unidade não é linear (um emoji
  // pode valer 1 grafema e 4 unidades UTF-16), então descontar por caractere erraria.
  let baixo = 0;
  let alto = medirLocal(t).grafemas;
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    if (conta(fatiarPorGrafema(t, meio)) <= orcamento) baixo = meio;
    else alto = meio - 1;
  }
  const cortado = equilibrarMarcacao(fatiarPorGrafema(t, baixo).replace(/\s+$/u, ''));
  return cabeSufixo ? cortado + sufixo : cortado + '…';
}

/** Normalização para o casamento de opção: minúsculas, sem acento, sem emoji/símbolo, aparado. */
function normalizarParaCasar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')          // tira os acentos separados pelo NFD
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // pontuação vira espaço: «Sim! Abra o chamado!» → «sim abra o chamado»
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * §4.4 — ESCADA DETERMINÍSTICA de casamento de resposta. A ordem é o contrato.
 *
 * SEM casamento aproximado e SEM modelo de linguagem nesta versão, e a razão é assimetria de custo:
 * confundir «Sim! Abra o chamado!» com «Não! Recomece!» abre um chamado que a pessoa não pediu, ou
 * joga fora cinco perguntas já respondidas. Errar para o lado de `opcao_invalida` custa uma
 * repergunta — que agora tem teto e destino.
 *
 * @returns {{id:string, via:'interativo'|'carga'|'indice'|'titulo'|'prefixo'|'apelido'}|null}
 */
function casarOpcaoLocal(entrada, itens) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return null;

  // 1. o caso canônico: a Meta devolve o id que NÓS mandamos.
  const idInterativo = entrada?.interativo?.id;
  if (idInterativo) {
    const achado = lista.find((i) => String(i.id) === String(idInterativo));
    if (achado) return { id: String(achado.id), via: 'interativo' };
  }

  const bruto = String(entrada?.texto ?? '').trim();
  if (!bruto) return null;

  // 1-B. A CARGA VOLTOU COMO TEXTO.
  //
  // ⭐ Contrato S-BOTOES-NATIVOS (03/09/2026), e este passo nasceu de MEDIÇÃO, não de zelo. Nem
  // todo destino devolve a escolha no campo interativo: há destino em que o toque no botão chega
  // como uma MENSAGEM COMUM cujo conteúdo é a carga que nós mesmos mandamos — o id do item. Sem
  // este passo, o cliente tocava no botão certo e recebia «não entendi, escolha uma opção»: o
  // passo 3 compara o id contra os TÍTULOS, e id nenhum é igual a um título.
  //
  // A comparação é EXATA e case-insensitive, nunca aproximada: id de item é sorteado ou escrito
  // pelo editor, e a chance de um cliente digitar exatamente um id à mão é desprezível perto do
  // custo de casar por engano. Vem DEPOIS do campo interativo (que é mais forte) e ANTES do índice
  // numérico — se um id for «2», ele é id antes de ser posição, porque quem o mandou fomos nós.
  //
  // ⛔ Este arquivo é do MOTOR e continua sem citar canal nenhum: a regra é «a carga pode voltar
  // como texto», e vale para qualquer destino que se comporte assim.
  const porCarga = lista.filter((i) => String(i.id ?? '').trim().toLowerCase() === bruto.toLowerCase());
  if (porCarga.length === 1) return { id: String(porCarga[0].id), via: 'carga' };

  // 2. índice numérico — é como a maior parte das pessoas responde quando o interativo não renderiza.
  if (/^\d{1,2}$/.test(bruto)) {
    const posicao = Number(bruto);
    if (posicao >= 1 && posicao <= lista.length) {
      return { id: String(lista[posicao - 1].id), via: 'indice' };
    }
  }

  const alvo = normalizarParaCasar(bruto);
  if (!alvo) return null;

  // 3. título exato normalizado.
  const porTitulo = lista.filter((i) => normalizarParaCasar(i.titulo ?? i.rotulo) === alvo);
  if (porTitulo.length === 1) return { id: String(porTitulo[0].id), via: 'titulo' };

  // 4. prefixo único, mínimo 4 caracteres. Ambíguo NÃO casa: dois títulos que começam igual não
  //    podem ser desempatados por ordem de declaração sem inventar intenção do cliente.
  if (alvo.length >= 4) {
    const porPrefixo = lista.filter((i) => normalizarParaCasar(i.titulo ?? i.rotulo).startsWith(alvo));
    if (porPrefixo.length === 1) return { id: String(porPrefixo[0].id), via: 'prefixo' };
  }

  // 5. apelidos declarados por item no editor — é aqui que «quero falar com alguem» vira conserto.
  for (const item of lista) {
    const apelidos = Array.isArray(item.apelidos) ? item.apelidos : [];
    if (apelidos.some((a) => normalizarParaCasar(a) === alvo)) {
      return { id: String(item.id), via: 'apelido' };
    }
  }

  // 6. nada disso → `opcao_invalida`, com o texto guardado na amostra do incidente.
  return null;
}

/** Escapes por DESTINO — porque quem define o perigo é o destino, não a variável (§4.8). */
const ESCAPES = Object.freeze({
  // O corpo JSON é montado como OBJETO e serializado pelo `JSON.stringify` do cliente HTTP; por isso
  // a folha entra crua e quem escapa é o serializador. Concatenar texto e interpretar depois é
  // exatamente o defeito que o validador recusa em `http`.
  json: (v) => String(v),
  caminho_url: (v) => encodeURIComponent(String(v)),
  consulta: (v) => encodeURIComponent(String(v)),
  whatsapp: (v) => String(v),
  // Exigência da Meta para parâmetro de template: sem quebra de linha e sem sequência de espaços.
  parametro_template: (v) => String(v).replace(/[\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim(),
  // Nota interna é para o analista ler, não para o WhatsApp renderizar.
  nota: (v) => String(v).replace(/[*_~`]/gu, ''),
  // CABEÇALHO DE E-MAIL (assunto, destinatário, responder-para). Quebra de linha aqui é INJEÇÃO DE
  // CABEÇALHO: um `\r\nBcc: alguem@fora.com` dentro do assunto vira um cabeçalho SMTP novo, e quem
  // digita o valor que cai em `{{assunto}}` é o cliente do outro lado do WhatsApp. Tirar CR/LF/TAB
  // não é higiene, é a diferença entre um e-mail e uma cópia oculta que ninguém pediu.
  cabecalho_email: (v) => String(v).replace(/[\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim(),
  // CORPO DE E-MAIL: aqui a quebra de linha É o texto, então fica. Sai o NUL (que trunca string em
  // biblioteca C) e o CR solto. O escape de HTML NÃO acontece aqui — ver `paraHtml()`, que escapa o
  // texto inteiro UMA vez, depois de montado.
  email: (v) => String(v).replace(/\u0000/gu, '').replace(/\r\n?/gu, '\n'),
});

/**
 * §4.8 — INTERPOLAÇÃO ESTRUTURAL, PASSADA ÚNICA, ESCAPE POR DESTINO.
 *
 * Percorre o objeto de configuração JÁ INTERPRETADO e substitui apenas FOLHAS de texto. Nunca monta
 * texto e interpreta depois: o corpo medido do fluxo real é `{"message":"{{{detalhes}}}"}`, que
 * naturalmente convida a concatenar e dar `JSON.parse` no fim — e aí o cliente que digitar uma aspa
 * no campo de detalhes quebra (ou reescreve) o corpo da requisição.
 *
 * PASSADA ÚNICA: o valor substituído JAMAIS é reinterpolado. Sem essa regra, o cliente digita
 * `{{chamado}}` dentro de `detalhes` e o resumo devolve a ele o número que o motor obteve do
 * terceiro. `String.replace` com função de retorno já não reexamina o que a função devolveu — a
 * garantia é do próprio método, não de disciplina de quem escreve.
 *
 * @param {'json'|'caminho_url'|'consulta'|'whatsapp'|'parametro_template'|'nota'} destino
 */
function interpolarLocal(config, vars, opcoes = {}) {
  const {
    destino = 'whatsapp',
    reservas = {},
    aoEstourar = 'cortar',
    teto = null,
    unidade = 'piorCaso',
  } = opcoes;
  const ausentes = [];
  const cortadas = [];
  const escapar = ESCAPES[destino] ?? ESCAPES.whatsapp;

  const substituirFolha = (texto) => String(texto).replace(
    /\{\{\{?\s*([\p{L}\p{N}_.]+)\s*\}?\}\}/gu,
    (_todo, nome) => {
      const valor = lerCaminho(vars, nome);
      if (valor === undefined || valor === null || valor === '') {
        // Não abortamos: variável ausente vira string vazia MAIS um achado. Derrubar o nó porque
        // uma variável opcional não veio castiga o cliente por um defeito do fluxo.
        if (!ausentes.includes(nome)) ausentes.push(nome);
        return '';
      }
      let s = escapar(valor);
      const reserva = reservas[nome];
      if (Number.isFinite(reserva) && reserva > 0) {
        const antes = s;
        s = cortarSeguroLocal(s, reserva, { unidade, sufixo: '…' });
        if (s !== antes) cortadas.push({ variavel: nome, reserva });
      }
      return s;
    },
  );

  const andar = (valor) => {
    if (typeof valor === 'string') return substituirFolha(valor);
    if (Array.isArray(valor)) return valor.map(andar);
    if (valor && typeof valor === 'object') {
      const saida = {};
      for (const [chave, v] of Object.entries(valor)) saida[chave] = andar(v);
      return saida;
    }
    return valor; // número, booleano e nulo passam intactos — interpolar número é ruído
  };

  let resultado = andar(config);
  let estourou = false;

  if (typeof resultado === 'string' && Number.isFinite(teto) && teto > 0) {
    const m = medirLocal(resultado);
    const contagem = unidade === 'piorCaso' ? m.piorCaso : (m[unidade] ?? m.piorCaso);
    if (contagem > teto) {
      estourou = true;
      if (aoEstourar === 'cortar') {
        resultado = cortarSeguroLocal(resultado, teto, { unidade });
        cortadas.push({ variavel: '(campo inteiro)', reserva: teto });
      }
      // aoEstourar === 'recusar': devolvemos o texto integral e `estourou:true`. Quem chamou decide
      // recusar — o corte aqui mudaria o sentido, que é justamente o caso que motiva 'recusar'.
    }
  }

  return { valor: resultado, ausentes, cortadas, estourou };
}

/** Leitura por caminho pontilhado (`data.chamadoId`), sem `eval` e sem lançar em caminho ausente. */
function lerCaminho(objeto, caminho) {
  if (objeto == null) return undefined;
  const partes = String(caminho).split('.');
  let atual = objeto;
  for (const parte of partes) {
    if (atual == null || typeof atual !== 'object') return undefined;
    atual = atual[parte];
  }
  return atual;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LIGAÇÃO COM `src/motor/*.js` — o canônico vence, o local é rede de segurança
//
// Por que import dinâmico com `try` em vez de import estático: no momento em que este arquivo foi
// escrito, `src/motor/` não existia (conferido no repositório) e outros agentes estavam criando os
// arquivos vizinhos EM PARALELO. Um import estático de arquivo ausente derruba o processo inteiro
// no boot — o motor não sobe, o webhook não responde, e a conversa do cliente evapora. Com a
// tentativa protegida, este arquivo funciona hoje sozinho e passa a usar o canônico no instante em
// que ele existir, sem ninguém precisar lembrar de vir aqui apagar a cópia.
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function tentarImportar(caminho) {
  try {
    return await import(caminho);
  } catch {
    return null;
  }
}

const _medirMod = await tentarImportar('../motor/medir.js');
const _casarMod = await tentarImportar('../motor/casar-opcao.js');
const _interpolarMod = await tentarImportar('../motor/interpolar.js');

export const medir = typeof _medirMod?.medir === 'function' ? _medirMod.medir : medirLocal;
export const cortarSeguro = typeof _medirMod?.cortarSeguro === 'function' ? _medirMod.cortarSeguro : cortarSeguroLocal;
export const casarOpcao = typeof _casarMod?.casarOpcao === 'function' ? _casarMod.casarOpcao : casarOpcaoLocal;
const _interpolarCanonico = typeof _interpolarMod?.interpolar === 'function' ? _interpolarMod.interpolar : null;

/**
 * Fachada de interpolação. Quando `src/motor/interpolar.js` existir, ele é quem interpola; a forma
 * de retorno dele não é conhecida aqui, então normalizamos para `{valor, ausentes, cortadas,
 * estourou}` — os executores abaixo dependem desses quatro campos e não podem quebrar por causa de
 * uma diferença de embalagem.
 */
export function interpolar(config, vars, opcoes = {}) {
  if (!_interpolarCanonico) return interpolarLocal(config, vars, opcoes);
  const bruto = _interpolarCanonico(config, vars, opcoes);
  if (bruto && typeof bruto === 'object' && 'valor' in bruto) {
    return {
      valor: bruto.valor,
      ausentes: bruto.ausentes ?? [],
      cortadas: bruto.cortadas ?? [],
      estourou: bruto.estourou ?? false,
    };
  }
  return { valor: bruto, ausentes: [], cortadas: [], estourou: false };
}

/** Diagnóstico: de onde veio cada utilitário. Leitura, não arqueologia. */
export const ORIGEM_DOS_UTILITARIOS = Object.freeze({
  medir: _medirMod?.medir ? 'src/motor/medir.js' : 'local',
  cortarSeguro: _medirMod?.cortarSeguro ? 'src/motor/medir.js' : 'local',
  casarOpcao: _casarMod?.casarOpcao ? 'src/motor/casar-opcao.js' : 'local',
  interpolar: _interpolarCanonico ? 'src/motor/interpolar.js' : 'local',
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// FERRAMENTAS DE VALIDAÇÃO — compartilhadas pelos dezessete executores
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Monta um `Problema` do contrato. `acaoRapida` é um clique no editor, nunca um parágrafo. */
function problema(nivel, codigo, campo, mensagem, comoCorrigir, acaoRapida) {
  const p = { nivel, codigo, campo, mensagem };
  if (comoCorrigir) p.comoCorrigir = comoCorrigir;
  if (acaoRapida) p.acaoRapida = acaoRapida;
  return p;
}
const erro = (codigo, campo, mensagem, comoCorrigir, acaoRapida) =>
  problema('erro', codigo, campo, mensagem, comoCorrigir, acaoRapida);
const aviso = (codigo, campo, mensagem, comoCorrigir, acaoRapida) =>
  problema('aviso', codigo, campo, mensagem, comoCorrigir, acaoRapida);

/** Lê o perfil de limites do contexto, caindo no padrão declarado como palpite. */
function limitesDe(ctx) {
  const perfil = ctx?.limites ?? PERFIL_LIMITES_PADRAO;
  return {
    perfil: perfil.perfil ?? PERFIL_LIMITES_PADRAO.perfil,
    origem: perfil.origem ?? 'documentacao',
    unidade: perfil.unidade ?? 'indefinida',
    conferidoEm: perfil.conferidoEm ?? null,
    valores: { ...PERFIL_LIMITES_PADRAO.valores, ...(perfil.valores ?? {}) },
  };
}

/**
 * Qual contagem usar. Enquanto o perfil for `documentacao`, contamos pelo PIOR CASO das três
 * unidades — porque não sabemos qual a Meta aplica, e supor a mais generosa é entregar ao cliente
 * uma mensagem que a Meta recusa INTEIRA.
 */
function unidadeDeContagem(lim) {
  if (lim.origem === 'medido' && MS_UNIDADES_MEDIDAS.has(lim.unidade)) return lim.unidade;
  return 'piorCaso';
}
const MS_UNIDADES_MEDIDAS = new Set(['grafemas', 'pontos', 'utf16']);

function contar(texto, lim) {
  const m = medir(String(texto ?? ''));
  const u = unidadeDeContagem(lim);
  return u === 'piorCaso' ? m.piorCaso : (m[u] ?? m.piorCaso);
}

/**
 * Confere um campo de texto contra um teto e devolve o Problema adequado.
 *
 * A frase precisa descrever o modo de falha REAL. A Meta RECUSA A MENSAGEM INTEIRA acima do teto —
 * ela não entrega o que cabe e descarta o resto. Um aviso que promete degradação parcial é pior que
 * aviso nenhum, porque compra a confiança do operador antes de traí-la.
 */
function conferirTeto(texto, teto, campo, lim, { bloqueante = true, oQueE = 'o texto' } = {}) {
  const problemas = [];
  if (texto == null) return problemas;
  const medido = contar(texto, lim);
  const sufixoOrigem = lim.origem === 'documentacao'
    ? ` (regra não medida — estamos contando pelo pior caso das três unidades; rode a calibração do perfil ${lim.perfil} para saber o número real)`
    : ` (perfil ${lim.perfil}, contagem em ${unidadeDeContagem(lim)})`;

  if (medido > teto) {
    problemas.push((bloqueante ? erro : aviso)(
      'LIMITE_EXCEDIDO', campo,
      `${oQueE} tem ${medido} caracteres e o teto é ${teto}. A Meta recusa a mensagem INTEIRA acima do teto — nada é entregue${sufixoOrigem}.`,
      'Reduza o texto ou declare uma reserva para as variáveis interpoladas neste campo.',
      { rotulo: 'Aplicar corte', acao: 'aplicar_corte', dados: { campo, teto } },
    ));
  } else if (medido > teto - 3) {
    // Classe B: julgamento. Três caracteres de folga é o que separa «Sim! Abra o chamado! ✅ » de
    // ser recusado quando alguém trocar o emoji por uma bandeira.
    problemas.push(aviso(
      'LIMITE_EXCEDIDO', campo,
      `${oQueE} tem ${medido} caracteres para um teto de ${teto} — sobra${medido === teto ? 'm 0' : ` ${teto - medido}`}. Uma troca de emoji pode estourar sozinha${sufixoOrigem}.`,
      'Deixe pelo menos três caracteres de folga.',
    ));
  }
  return problemas;
}

/** Heurísticas de segredo LITERAL (§5.5, classe A). Segredo em claro não é julgamento. */
const PADROES_DE_SEGREDO = [
  /Bearer\s+\S{20,}/i,
  /\b(sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // forma de JWT
  /\b[A-Fa-f0-9]{32,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

function procurarSegredoLiteral(valor, campo, problemas) {
  if (typeof valor === 'string') {
    if (PADROES_DE_SEGREDO.some((p) => p.test(valor))) {
      problemas.push(erro(
        'SEGREDO_LITERAL', campo,
        'Há o que parece ser um segredo escrito em claro no fluxo. O documento do fluxo é lido por quem edita e viaja em exportação e backup.',
        'Guarde o valor no cofre da empresa e referencie por apelido: {"cofre":"nome_do_apelido"}.',
        { rotulo: 'Mover para o cofre', acao: 'mover_para_cofre', dados: { campo } },
      ));
    }
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((v, i) => procurarSegredoLiteral(v, `${campo}[${i}]`, problemas));
    return;
  }
  if (valor && typeof valor === 'object') {
    // `{"cofre":"apelido"}` é a forma CORRETA — não é segredo literal, é referência.
    if (typeof valor.cofre === 'string') return;
    for (const [chave, v] of Object.entries(valor)) {
      procurarSegredoLiteral(v, `${campo}.${chave}`, problemas);
    }
  }
}

/** Coleta os apelidos de cofre referenciados numa subárvore — alimenta `ondeUsado(apelido)`. */
function coletarSegredosRef(valor, saida = []) {
  if (Array.isArray(valor)) {
    valor.forEach((v) => coletarSegredosRef(v, saida));
  } else if (valor && typeof valor === 'object') {
    if (typeof valor.cofre === 'string') {
      if (!saida.includes(valor.cofre)) saida.push(valor.cofre);
      return saida;
    }
    for (const v of Object.values(valor)) coletarSegredosRef(v, saida);
  }
  return saida;
}

/** Nomes de variável interpolados num valor qualquer (para VARIAVEL_AUSENTE e para as reservas). */
function coletarVariaveis(valor, saida = []) {
  if (typeof valor === 'string') {
    for (const m of valor.matchAll(/\{\{\{?\s*([\p{L}\p{N}_.]+)\s*\}?\}\}/gu)) {
      if (!saida.includes(m[1])) saida.push(m[1]);
    }
  } else if (Array.isArray(valor)) {
    valor.forEach((v) => coletarVariaveis(v, saida));
  } else if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor)) coletarVariaveis(v, saida);
  }
  return saida;
}

/**
 * §4.6 — o orçamento de caracteres. Bloqueia campo com teto que interpola variável SEM reserva.
 *
 * Não é preciosismo: o nó anterior do fluxo real pede literalmente «para encerrar, escreva em
 * detalhes sua solicitacao», e o teto do que o cliente pode escrever é a mensagem de WhatsApp
 * inteira. Nenhuma validação de publicação resolve isso olhando o texto do modelo — o comprimento
 * depende de um texto que ainda não existe. Corpo que depende de texto ilimitado do cliente não tem
 * publicação segura, logo é erro, não aviso.
 */
function conferirReservas(texto, teto, campo, reservas, lim, problemas) {
  const usadas = coletarVariaveis(texto);
  if (!usadas.length) return;
  const semReserva = usadas.filter((v) => !Number.isFinite(reservas?.[v]));
  if (semReserva.length) {
    problemas.push(erro(
      'RESERVA_AUSENTE', campo,
      `O campo tem teto de ${teto} caracteres e interpola ${semReserva.map((v) => `{{${v}}}`).join(', ')} sem reserva declarada. O tamanho final depende de texto que o cliente ainda vai escrever, então não há publicação segura.`,
      'Declare "reserva" por variável neste campo, por exemplo {"detalhes":400,"assunto":80}.',
      { rotulo: 'Aplicar corte', acao: 'declarar_reserva', dados: { campo, variaveis: semReserva } },
    ));
    return;
  }
  const esqueleto = String(texto).replace(/\{\{\{?\s*[\p{L}\p{N}_.]+\s*\}?\}\}/gu, '');
  const somaReservas = usadas.reduce((s, v) => s + Number(reservas[v] || 0), 0);
  const total = contar(esqueleto, lim) + somaReservas;
  if (total > teto) {
    problemas.push(erro(
      'LIMITE_EXCEDIDO', campo,
      `O texto fixo (${contar(esqueleto, lim)}) somado às reservas (${somaReservas}) dá ${total}, acima do teto de ${teto}. Na pior das respostas do cliente a Meta recusa a mensagem inteira.`,
      'Reduza as reservas ou encurte o texto fixo até a soma caber no teto.',
    ));
  }
}

/**
 * §4.4 — `esperaResposta` com valor E UNIDADE. A unidade é obrigatória e nunca inferida.
 *
 * O legado traz `responseTimeout: 4` sem unidade. Ler isso como 4 minutos ou 4 horas muda a taxa de
 * abandono E o comportamento da janela de 24 h ao mesmo tempo — é decisão de operação, não de
 * migração, e quem escolhe é gente.
 */
function conferirEspera(espera, campo, problemas, { obrigatorio = true } = {}) {
  if (espera == null) {
    if (obrigatorio) {
      problemas.push(erro(
        'ESPERA_SEM_UNIDADE', campo,
        'Nó que espera resposta precisa de tempo limite com valor e unidade. Sem ele, a saída "sem resposta" nunca dispara e a conversa fica parada até o TTL.',
        'Declare "esperaResposta": { "valor": 4, "unidade": "minutos" }.',
      ));
    }
    return null;
  }
  const valor = Number(espera.valor);
  const unidade = espera.unidade;
  if (!Number.isFinite(valor) || valor <= 0) {
    problemas.push(erro('ESPERA_SEM_UNIDADE', `${campo}.valor`, 'O tempo limite precisa de um número positivo.', 'Exemplo: 4.'));
    return null;
  }
  if (!unidade || !MS_POR_UNIDADE[unidade]) {
    problemas.push(erro(
      'ESPERA_SEM_UNIDADE', `${campo}.unidade`,
      `Unidade ausente ou desconhecida. Aceitas: ${Object.keys(MS_POR_UNIDADE).join(', ')}. O motor NÃO adivinha unidade.`,
      'Escolha a unidade explicitamente — 4 minutos e 4 horas são fluxos diferentes.',
    ));
    return null;
  }
  return valor * MS_POR_UNIDADE[unidade];
}

/**
 * §4.4 — LACO_DE_EXCECAO_SEM_TETO. O fluxo real faz 32 → 34 → 16 para sempre, e é a explicação
 * estrutural do abandono medido. Teto finito é obrigatório.
 */
const ACOES_FINAIS = new Set(['transferir_time', 'encerrar', 'ir_para_no', 'seguir_saida']);

function conferirExcecoes(config, problemas) {
  const ex = config?.excecoes ?? {};
  for (const [chave, campo] of [['semResposta', 'config.excecoes.semResposta'], ['opcaoInvalida', 'config.excecoes.opcaoInvalida']]) {
    const bloco = ex[chave];
    if (!bloco) {
      problemas.push(erro(
        'LACO_DE_EXCECAO_SEM_TETO', campo,
        `A exceção "${chave}" não está configurada. Sem teto de tentativas e sem ação final, a repergunta vira laço — que é o defeito medido no fluxo real.`,
        'Declare { "tentativas": 2, "reforco": "...", "acaoFinal": "transferir_time", "time": "Suporte" }.',
      ));
      continue;
    }
    const t = Number(bloco.tentativas);
    if (!Number.isFinite(t) || t < 0 || t > 10) {
      problemas.push(erro(
        'LACO_DE_EXCECAO_SEM_TETO', `${campo}.tentativas`,
        'Número de tentativas ausente, negativo ou acima de 10. Teto infinito é um moedor de conversa de cliente.',
        'Use um inteiro entre 0 e 10 — 2 é o valor de referência.',
      ));
    }
    if (!bloco.acaoFinal || !ACOES_FINAIS.has(bloco.acaoFinal)) {
      problemas.push(erro(
        'LACO_DE_EXCECAO_SEM_TETO', `${campo}.acaoFinal`,
        `Ação final ausente ou desconhecida. Aceitas: ${[...ACOES_FINAIS].join(', ')}.`,
        'Sem ação final o cliente fica preso na repergunta.',
      ));
    }
    if (bloco.acaoFinal === 'transferir_time' && !bloco.time) {
      problemas.push(erro('LACO_DE_EXCECAO_SEM_TETO', `${campo}.time`, 'Ação final "transferir_time" sem time de destino.', 'Informe o nome do time que recebe a conversa.'));
    }
    if (bloco.acaoFinal === 'ir_para_no' && !bloco.no) {
      problemas.push(erro('LACO_DE_EXCECAO_SEM_TETO', `${campo}.no`, 'Ação final "ir_para_no" sem nó de destino.', 'Informe o id do nó de destino.'));
    }
  }
}

/**
 * Agrupa os itens de lista por `itens[].secao`, PRESERVANDO A ORDEM DE APARIÇÃO.
 *
 * A lista da Cloud API é `sections[] → rows[]`, mas o editor guarda a seção DENTRO do item — que é
 * como o operador pensa: ele escreve as opções e diz a que grupo cada uma pertence, não cria caixas
 * vazias para depois arrastar linhas para dentro. Esta função é a tradução entre as duas formas, e
 * fica sozinha aqui porque `validar()` e `preparar()` precisam da MESMA leitura: se cada um agrupasse
 * do seu jeito, o aviso da publicação descreveria uma lista diferente da que sai no celular.
 *
 * `naoContiguas` existe porque agrupar por nome REORDENA: itens A, B, A viram [A, A], [B], e o
 * cliente lê numa ordem que não é a da tela do editor. Não é erro (a mensagem sai e funciona), mas
 * também não pode ser silêncio — quem escreveu o menu precisa saber que a ordem mudou.
 */
function agruparItensPorSecao(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const grupos = [];
  const porTitulo = new Map();
  const naoContiguas = [];
  let corrente = null;
  lista.forEach((item, indice) => {
    const titulo = String(item?.secao ?? '').trim();
    const nome = titulo || '(sem seção)';
    let g = porTitulo.get(titulo);
    if (!g) {
      g = { titulo, primeiroIndice: indice, indices: [] };
      porTitulo.set(titulo, g);
      grupos.push(g);
    } else if (corrente !== titulo && !naoContiguas.includes(nome)) {
      naoContiguas.push(nome);
    }
    g.indices.push(indice);
    corrente = titulo;
  });
  return {
    grupos,
    naoContiguas,
    temSecao: lista.some((i) => String(i?.secao ?? '').trim() !== ''),
  };
}

/**
 * ⚠️ A REGRA MAIS IMPORTANTE DO NÓ `botoes`, E A QUE MAIS CUSTA CARO QUANDO SE DESCOBRE TARDE.
 *
 * No WhatsApp Cloud API, botão de RESPOSTA e botão de URL são TIPOS DE MENSAGEM INTERATIVA
 * DIFERENTES: `interactive.type:"button"` (até 3 `reply`) e `interactive.type:"cta_url"` (UM link).
 * Eles não convivem no mesmo objeto. Um nó com dois botões de resposta e um de URL não sai
 * "com dois botões e um link" — a Meta RECUSA A MENSAGEM INTEIRA, e o cliente não recebe NADA:
 * nem os botões, nem o texto do corpo, nem o link.
 *
 * É por isso que a mistura é bloqueada na publicação e recusada de novo em `executar()`: a primeira
 * guarda protege quem está desenhando o fluxo, a segunda protege quem já publicou por outro caminho.
 *
 * Devolve 'misto' em vez de escolher um lado. Escolher seria decidir por conta própria qual metade
 * das opções o cliente não vai ver — o mesmo defeito que o corte de 4 botões para 3 já provocou.
 */
function modoDosBotoes(config) {
  const botoes = Array.isArray(config?.botoes) ? config.botoes : [];
  if (!botoes.length) return 'resposta';
  const temUrl = botoes.some((b) => String(b?.tipo ?? 'resposta') === 'url');
  const temResposta = botoes.some((b) => String(b?.tipo ?? 'resposta') !== 'url');
  if (temUrl && temResposta) return 'misto';
  return temUrl ? 'url' : 'resposta';
}

/**
 * Endereço de botão de URL. As três recusas aqui são de classe A (fato, não julgamento):
 *
 *  • esquema que não é http/https simplesmente NÃO ABRE no celular — `javascript:` e `data:` não
 *    existem para o WhatsApp, e o botão vira um clique morto que ninguém consegue explicar;
 *  • variável na posição do HOST entrega o destino do clique a quem respondeu a pergunta anterior:
 *    é a mesma regra que o nó `http` já aplica, e pela mesma razão (§4.8);
 *  • acima do teto de caracteres a Meta recusa a mensagem inteira, como em qualquer outro campo.
 *
 * `http://` sem `s` fica em AVISO, não em erro: sai e funciona, mas o cliente abre um link sem
 * cifra a partir de uma mensagem que leva o nome da empresa.
 */
function conferirUrlDeBotao(url, campo, lim, problemas) {
  const u = String(url ?? '').trim();
  if (!u) {
    problemas.push(erro(
      'BOTAO_URL_INVALIDA', campo,
      'Botão do tipo "url" sem endereço. No celular ele aparece, o cliente toca, e não acontece nada.',
      'Informe o endereço completo, começando por https://.',
    ));
    return;
  }
  if (!/^https?:\/\//iu.test(u)) {
    problemas.push(erro(
      'BOTAO_URL_INVALIDA', campo,
      `O endereço "${u}" não começa por http:// nem https://. O botão de URL do WhatsApp só abre esses dois esquemas — qualquer outro é um botão que não faz nada.`,
      'Escreva o endereço completo, por exemplo https://ragnatela.com.br/segunda-via.',
    ));
    return;
  }
  const host = u.replace(/^https?:\/\//iu, '').split(/[/?#]/u)[0];
  if (/\{\{/u.test(host)) {
    problemas.push(erro(
      'BOTAO_URL_INVALIDA', campo,
      'A URL tem variável na posição do host. Isso deixa o destino do clique nas mãos de quem respondeu a pergunta anterior — o cliente toca num botão com o nome da empresa e vai parar onde outra pessoa escolheu.',
      'Deixe o host fixo e use variáveis só no caminho ou na consulta.',
    ));
  }
  if (!/^https:\/\//iu.test(u)) {
    problemas.push(aviso(
      'BOTAO_URL_INVALIDA', campo,
      'O endereço está em http simples. O cliente abre um link sem cifra a partir de uma mensagem que leva o nome da empresa.',
      'Use https.',
    ));
  }
  problemas.push(...conferirTeto(u, lim.valores.botao_url_max, campo, lim, { oQueE: 'O endereço do botão' }));
}

/**
 * §5.4 — confere o template declarado no nó. Três desfechos, e a diferença entre eles é o que separa
 * aviso honesto de aviso que o operador aprende a ignorar:
 *
 *   'entrega'    — o tipo É entregue por template fora da janela (`texto`). Conferimos nome e situação
 *                  contra o espelho da WABA, exatamente como o nó `notificar` já fazia. Antes disto,
 *                  um nome digitado errado passava na publicação e só quebrava FORA da janela — que é
 *                  precisamente o momento em que não existe alternativa nenhuma.
 *   'proibido'   — o §5.4 diz que o tipo NÃO tem entrega por template (`pergunta`: resposta livre não
 *                  tem como ser pedida por template). Declarar um aqui promete o que nunca acontece,
 *                  então é erro de publicação, não aviso.
 *   'nao_medido' — a Meta tem o recurso, mas o mapeamento não foi medido nesta casa (`midia` e
 *                  `botoes`, que por isso declaram `aceitaModeloFora: false`). O template seria
 *                  IGNORADO em silêncio; vira aviso, porque a publicação continua correta e o que
 *                  muda é o operador saber que precisa desenhar a saída `sem_janela`.
 */
function conferirTemplateDoNo(no, ctx, problemas, { entrega }) {
  const bruto = no?.config?.template;
  if (bruto == null || bruto === '' || bruto === false) return;

  if (entrega === 'proibido') {
    problemas.push(erro(
      'TEMPLATE_REPROVADO', 'config.template',
      `O tipo "${no?.tipo}" não tem como ser entregue por template fora da janela de 24 h — resposta livre não pode ser pedida por template. O template declarado aqui não seria usado, e a promessa de que seria é o que faz ninguém desenhar a saída sem_janela.`,
      'Remova o template e dê destino à saída sem_janela: template de reengajamento com resposta rápida (que reabre a janela) ou entrega a um humano.',
    ));
    return;
  }

  if (entrega === 'nao_medido') {
    problemas.push(aviso(
      'TEMPLATE_REPROVADO', 'config.template',
      `A Meta tem template para "${no?.tipo}", mas o mapeamento não foi medido nesta casa — por isso este nó declara aceitaModeloFora: false e IGNORA o template fora da janela. Como está, ele toma a saída sem_janela.`,
      'Dê destino à saída sem_janela, ou peça a medição do mapeamento antes de contar com este template.',
    ));
    return;
  }

  const modelo = templateDoNo(no?.config);
  if (!modelo) {
    problemas.push(erro(
      'TEMPLATE_REPROVADO', 'config.template',
      'O template declarado não tem nome de modelo. Sem nome não há o que enviar, e fora da janela o nó cai na saída sem_janela em vez de usar o template que o fluxo promete.',
      'Informe o nome do template aprovado na WABA, como "template": "retorno_atendimento" ou { "modelo": "...", "idioma": "pt_BR" }.',
    ));
    return;
  }

  // Mesma conferência do nó `notificar`, e de propósito a mesma: duas regras diferentes para o mesmo
  // fato é como uma delas envelhece sem ninguém perceber.
  if (ctx?.templates && Array.isArray(ctx.templates)) {
    const t = ctx.templates.find((x) => x.nome === modelo.modelo && (!modelo.idioma || x.idioma === modelo.idioma));
    if (!t) {
      problemas.push(erro(
        'TEMPLATE_REPROVADO', 'config.template',
        `O template "${modelo.modelo}" não existe no espelho da WABA desta empresa. Ele só seria usado fora da janela de 24 h, então a falha apareceria justamente quando não há outro caminho.`,
        'Cadastre o template e aguarde a aprovação da Meta.',
      ));
    } else if (t.status !== 'aprovado') {
      problemas.push(erro(
        'TEMPLATE_REPROVADO', 'config.template',
        `O template "${modelo.modelo}" está "${t.status}". Template em análise é fluxo quebrado no ar, e ele quebra exatamente fora da janela de 24 h — que é quando não existe alternativa.`,
        'Publique só depois da aprovação.',
      ));
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// FERRAMENTAS DE EXECUÇÃO — compartilhadas pelos dezessete executores
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Callbacks do contexto são opcionais na prévia do editor e no modo de teste. Nunca lançar por isso. */
function ganchos(ctx) {
  return {
    registrar: typeof ctx?.registrar === 'function' ? ctx.registrar : () => {},
    incidente: typeof ctx?.incidente === 'function' ? ctx.incidente : () => {},
  };
}

/** `agora` vem do BANCO (now()), nunca do relógio do processo — pod fora de sincronia decide prazo e
 *  janela de 24 h errados, e a fonte autoritativa do segundo é a Meta, não nós. O fallback existe só
 *  para a prévia do editor, que não abre transação. */
function agoraDe(ctx) {
  return ctx?.agora instanceof Date ? ctx.agora : new Date();
}

/**
 * Falha padronizada. `erro` é falha de conversa COM O CLIENTE; `erro_interno` é falha de encanamento
 * nosso. Misturar os dois transfere o cliente para um humano porque o aviso ao plantonista não saiu.
 */
function falhar(saida, codigo, mensagemOperador, mensagemCliente, { reparavel = true } = {}) {
  return {
    tipo: 'falhar',
    saida,
    incidente: { codigo, mensagemOperador, mensagemCliente, reparavel },
  };
}

/** Mensagem ao cliente ≠ mensagem ao operador. Nunca detalhe técnico, nunca silêncio. */
const MENSAGEM_FALHA_PADRAO = 'Não consegui concluir por aqui agora. Já chamei um analista para falar com você.';

function mensagemDeFalha(no, ctx) {
  return no?.config?.mensagemFalha
    ?? ctx?.execucao?.mensagemFalhaPadrao
    ?? MENSAGEM_FALHA_PADRAO;
}

/**
 * §5.4 — a janela de 24 h é ESTADO, não esperança. Fora dela só sai template aprovado e pago.
 *
 * O contexto pode não trazer a janela (prévia do editor). Nesse caso assumimos ABERTA: recusar na
 * prévia mostraria ao operador um erro que não é dele.
 */
function janelaAberta(ctx) {
  const j = ctx?.janela;
  if (!j) return true;
  if (j.aberta === false) return false;
  if (j.expiraEm) {
    const margem = Number(j.margemSegurancaSegundos ?? 300) * 1000;
    return agoraDe(ctx).getTime() < new Date(j.expiraEm).getTime() - margem;
  }
  return j.aberta !== false;
}

/**
 * Conta quantas vezes esta exceção já foi tomada NESTE nó. O motor mantém o mapa em
 * `RagnabotFluxoExecucao.tentativasNo`; aqui só lemos.
 */
function tentativasDe(ctx, especie) {
  const noId = ctx?.no?.id;
  const mapa = ctx?.execucao?.tentativasNo ?? {};
  return Number(mapa?.[noId]?.[especie] ?? 0);
}

/**
 * §4.4 — resolve uma exceção (`semResposta` ou `opcaoInvalida`) de um nó que estaciona.
 *
 * Duas coisas que só se aprendem apanhando, e que estão aqui de propósito:
 *
 *  (a) AO ACORDAR POR PRAZO, A JANELA É RECONFERIDA ANTES DO REFORÇO. O reforço é mensagem livre,
 *      logo inexistente fora das 24 h. Fechada, pulamos direto para a ação final em vez de gastar
 *      uma tentativa numa mensagem que a Meta vai recusar — e a nota interna diz QUAL dos dois
 *      motivos ocorreu, porque «o robô parou porque a janela fechou» é informação diferente de «o
 *      cliente sumiu», e é essa a diferença que o analista precisa às três da manhã.
 *
 *  (b) O TETO É FINITO E TEM DESTINO. Sem isto, 32 → 34 → 16 roda para sempre.
 */
function resolverExcecao(ctx, especie, { esperaMs } = {}) {
  const { registrar, incidente } = ganchos(ctx);
  const config = ctx?.no?.config ?? {};
  const bloco = config.excecoes?.[especie] ?? {};
  const jaTentou = tentativasDe(ctx, especie);
  const teto = Number.isFinite(Number(bloco.tentativas)) ? Number(bloco.tentativas) : 0;
  const codigo = especie === 'semResposta' ? 'SEM_RESPOSTA_ESGOTADA' : 'OPCAO_INVALIDA_ESGOTADA';

  const podeFalarLivre = janelaAberta(ctx);

  if (jaTentou < teto && bloco.reforco && podeFalarLivre) {
    // Repergunta: volta ao MESMO nó, com uma visita nova. O motor incrementa `tentativasNo`.
    registrar({ tipo: especie === 'semResposta' ? 'sem_resposta' : 'opcao_invalida', noId: ctx?.no?.id });
    return {
      tipo: 'seguir',
      saida: especie === 'semResposta' ? 'sem_resposta' : 'opcao_invalida',
      reapresentar: true,
      reforco: String(bloco.reforco),
      esperaMs: esperaMs ?? null,
    };
  }

  if (jaTentou < teto && bloco.reforco && !podeFalarLivre) {
    incidente('JANELA_FECHADA', {
      noId: ctx?.no?.id,
      especie,
      observacao: 'A janela de 24 h fechou antes do reforço. Pulamos para a ação final sem gastar tentativa numa mensagem que a Meta recusaria.',
    });
  }

  // Teto esgotado (ou janela fechada): a ação final. Aqui o incidente carrega AS FRASES do cliente
  // quando a espécie é `opcaoInvalida` — são elas que transformam 151 eventos iguais num conserto.
  incidente(codigo, {
    noId: ctx?.no?.id,
    tentativas: jaTentou,
    teto,
    janelaAberta: podeFalarLivre,
    amostra: especie === 'opcaoInvalida' ? String(ctx?.entrada?.texto ?? '').slice(0, 120) : undefined,
  });

  const acao = bloco.acaoFinal;
  if (acao === 'transferir_time') {
    return { tipo: 'terminar', estado: 'transferido', time: bloco.time, motivo: codigo };
  }
  if (acao === 'encerrar') {
    return { tipo: 'terminar', estado: 'concluido', motivo: codigo };
  }
  if (acao === 'ir_para_no') {
    return { tipo: 'seguir', saida: especie === 'semResposta' ? 'sem_resposta' : 'opcao_invalida', irParaNo: bloco.no, motivo: codigo };
  }
  // 'seguir_saida' (ou ausência de ação final, já bloqueada na publicação): segue pela saída de
  // exceção e deixa o grafo decidir. Nunca ficamos parados sem destino.
  return { tipo: 'seguir', saida: especie === 'semResposta' ? 'sem_resposta' : 'opcao_invalida', motivo: codigo };
}

/**
 * O ÚNICO caminho de emissão de protocolo deste arquivo. Delega a `ragnabot-protocolo.service.js`,
 * que já é atômico no contador (UPDATE incremental dentro da transação) e idempotente por conversa
 * (`@@unique([cwAccountId, cwConversationId])`), e já provou isso em produção. Nada de numeração é
 * reimplementado aqui.
 *
 * A ORDEM IMPORTA, e cada degrau existe por um motivo:
 *
 *  1. `ctx.execucao.protocolo` — o CAMINHO NORMAL. O motor emite o número ao iniciar a execução, e
 *     ele já vem no contexto. Nenhum toque no banco acontece aqui.
 *  2. `ctx.protocolo` injetado — testes e modo de teste. Sem essa porta, exercitar o nó exigiria um
 *     Postgres de pé, e teste que depende de infraestrutura é teste que ninguém roda.
 *  3. Import dinâmico do serviço real — o REPARO. Só chega aqui quando a emissão no início da
 *     execução falhou (o motor registra aviso e segue, para não punir o cliente por um cadastro
 *     incompleto). É a única escrita em banco deste arquivo.
 *
 * ⚠️ O degrau 3 roda DENTRO da transação curta do motor. É uma transação aninhada, em outra conexão,
 * enquanto a linha da execução está travada — e uma emissão que pendurasse ali seguraria a trava
 * pelo tempo do banco. Por isso há teto de tempo: preferimos falhar com incidente legível a manter
 * a conversa travada esperando. O import é dinâmico também para que `validar()` e `preparar()`
 * continuem funcionando num processo sem `DATABASE_URL` (a prévia do editor é um deles).
 */
const TETO_EMISSAO_PROTOCOLO_MS = 5000;

async function garantirProtocolo(ctx) {
  if (ctx?.execucao?.protocolo) return { protocolo: ctx.execucao.protocolo, novo: false };

  const { tenantId, cwAccountId, cwConversationId } = ctx?.execucao ?? {};
  const servico = ctx?.protocolo ?? await import('./ragnabot-protocolo.service.js');
  const emissao = servico.emitirProtocolo({ tenantId, cwAccountId, cwConversationId });

  const r = ctx?.protocolo
    ? await emissao
    : await Promise.race([
      emissao,
      new Promise((_, rejeitar) => setTimeout(
        () => rejeitar(new Error(`a emissão do protocolo passou de ${TETO_EMISSAO_PROTOCOLO_MS} ms`)),
        TETO_EMISSAO_PROTOCOLO_MS,
      ).unref?.()),
    ]);
  return { protocolo: r.protocolo, numero: r.numero, novo: r.novo };
}

/**
 * Carimbo na conversa do Chatwoot (D12: hoje `Tickets.flowId` é nulo em 100 % dos casos medidos).
 *
 * É uma INTENÇÃO, não uma chamada: escrever no Chatwoot é rede, e rede não entra na T1 (regra R1).
 *
 * MELHOR ESFORÇO POR DEFINIÇÃO. Em divergência, o nosso banco é a verdade e o Chatwoot é cópia
 * desnormalizada — ela existe para o atendente enxergar por onde a pessoa passou MESMO COM O NOSSO
 * BACKEND FORA DO AR. Por isso o carimbo vai como efeito `repetivel`: se falhar, o motor rerroteia
 * pela saída interna e a conversa segue. Deixar o carimbo derrubar o nó inverteria a prioridade —
 * o cliente perderia o atendimento por causa de um campo de conveniência.
 *
 * ⚠️ `tipo:'carimbar'` é acréscimo declarado à união de `IntencaoSaida`: a `PortaCanal` do contrato
 * expõe `carimbar()` como método, mas o motor só despacha INTENÇÕES, e sem um tipo para ela o
 * carimbo não teria como sair de dentro da T1. Adaptador que não conhecer o tipo apenas não carimba;
 * nada mais quebra.
 */
function intencaoDeCarimbo(atributos) {
  return { tipo: 'carimbar', atributos, sufixo: 'carimbo' };
}

/**
 * §5.4 — fora da janela de 24 h só sai TEMPLATE APROVADO E PAGO. `config.template` aceita as duas
 * formas que aparecem no material do fluxo: o nome cru (`'retorno_atendimento'`) e o bloco completo
 * (`{ modelo, idioma, parametros }`).
 *
 * Devolve `null` quando NÃO há template utilizável — inclusive quando existe um bloco sem nome de
 * modelo. É de propósito: sem nome não há o que enviar, e devolver algo aqui faria `executar()`
 * liberar o nó fora da janela com base numa promessa vazia, que era exatamente o defeito. O
 * `validar()` cobra o nome na hora da publicação, que é onde dá para consertar sem cliente esperando.
 */
function templateDoNo(config) {
  const t = config?.template;
  if (t == null || t === '' || t === false) return null;
  if (typeof t === 'string') {
    const modelo = t.trim();
    return modelo ? { modelo, idioma: 'pt_BR', parametros: [] } : null;
  }
  if (typeof t !== 'object' || Array.isArray(t)) return null;
  const modelo = String(t.modelo ?? t.nome ?? '').trim();
  if (!modelo) return null;
  return {
    modelo,
    idioma: t.idioma ?? 'pt_BR',
    parametros: Array.isArray(t.parametros) ? t.parametros : [],
  };
}

/**
 * Intenção de template para a conversa em curso. É a MESMA forma que o nó `notificar` já monta, menos
 * o `destinatario`: aqui quem recebe é o cliente da própria execução, e a PortaCanal já sabe quem é —
 * do mesmo jeito que sabe para a intenção `texto`.
 *
 * Existe porque `config.template` liberava o nó fora da janela e ninguém montava a intenção: saía
 * mensagem LIVRE, a Meta recusava com 131047, e o template aprovado e pago — comprado justamente para
 * esse caso — nunca era usado. O cliente ficava sem nada e ainda se gastava uma tentativa e um
 * incidente.
 *
 * O escape é `parametro_template` porque a Meta recusa parâmetro com quebra de linha ou sequência de
 * espaços; é o mesmo escape que o `notificar` aplica, e não uma segunda regra paralela.
 */
function intencaoDeTemplate(modelo, ctx) {
  const parametros = modelo.parametros.map(
    (valor) => interpolar(String(valor), ctx?.vars ?? {}, { destino: 'parametro_template' }),
  );
  return {
    tipo: 'template',
    nome: modelo.modelo,
    idioma: modelo.idioma,
    parametros: parametros.map((r) => r.valor),
    sufixo: '',
    _achados: parametros,
  };
}

/** Interpola um campo de texto para o WhatsApp, respeitando reserva, teto e `aoEstourar`. */
function textoDoCampo(valorBruto, ctx, { teto, campo, aoEstourarPadrao = 'cortar' } = {}) {
  const lim = limitesDe(ctx);
  const bloco = valorBruto && typeof valorBruto === 'object' && !Array.isArray(valorBruto) ? valorBruto : null;
  const texto = bloco ? (bloco.texto ?? '') : (valorBruto ?? '');
  const reservas = bloco?.reserva ?? {};
  const aoEstourar = bloco?.aoEstourar ?? aoEstourarPadrao;

  const r = interpolar(String(texto), ctx?.vars ?? {}, {
    destino: 'whatsapp',
    reservas,
    aoEstourar,
    teto,
    unidade: unidadeDeContagem(lim),
  });
  return { ...r, campo, aoEstourar, teto };
}

/**
 * Achata o campo `_achados` de um conjunto de intenções. Algumas carregam UM resultado de
 * interpolação, outras uma lista — e `anotarAchados` espera a lista achatada. Sem isto, passar um
 * array onde se espera um objeto lê `undefined` em `.ausentes` e engole em silêncio as variáveis não
 * resolvidas, justamente no caminho do template, onde parâmetro vazio vira mensagem sem sentido no
 * celular do cliente.
 */
function achadosDas(intencoes) {
  return intencoes
    .flatMap((i) => (Array.isArray(i?._achados) ? i._achados : [i?._achados]))
    .filter(Boolean);
}

/**
 * Lê o `_achados` de um conjunto de intenções e transforma em incidente o que ele já sabia e não
 * dizia a ninguém. Uma vez por conjunto — ruído repetido é ruído ignorado.
 *
 * ⚠️ POR QUE MUDOU DE NOME (era `anotarAusentes`). `interpolar()` devolve TRÊS fatos por campo:
 * `ausentes`, `cortadas` e `estourou`. Esta função lia só o primeiro. O resultado é que todo corte
 * de texto — corpo, título de item, rótulo de botão — era registrado com fidelidade dentro de
 * `_achados` e ali morria: nenhum executor o consultava, nenhum incidente nascia dele. O operador
 * escrevia um título de 40 caracteres, o cliente recebia «Segunda via de bole…» e não havia, em
 * lugar nenhum do sistema, uma linha explicando que a frase tinha sido encurtada. Pior que o
 * validador de publicação já cobrir o caso: o valor que estoura o teto costuma vir de VARIÁVEL
 * interpolada em tempo de execução, que nenhuma validação estática consegue medir.
 *
 * Nível `aviso`, não `erro`: pela §4.6 deste arquivo, limite que um corte resolve não derruba o nó.
 * O que ele não pode é acontecer em silêncio.
 */
function anotarAchados(ctx, resultados) {
  const { incidente } = ganchos(ctx);
  const todas = [];
  const cortes = [];
  for (const r of resultados) {
    for (const v of r?.ausentes ?? []) if (!todas.includes(v)) todas.push(v);
    if (r?.estourou || (r?.cortadas ?? []).length) {
      const campo = r?.campo ?? '(campo sem nome)';
      if (!cortes.includes(campo)) cortes.push(campo);
    }
  }
  if (todas.length) {
    incidente('VARIAVEL_AUSENTE', { noId: ctx?.no?.id, variaveis: todas });
  }
  if (cortes.length) {
    incidente('LIMITE_EXCEDIDO', {
      noId: ctx?.no?.id, nivel: 'aviso', campos: cortes,
      mensagem: `Texto encurtado para caber no teto da Meta em: ${cortes.join(', ')}. `
        + 'O cliente recebeu a frase cortada, com reticências.',
      comoCorrigir: 'Encurte o texto no editor, ou declare uma reserva para as variáveis '
        + 'interpoladas neste campo, para que o corte caia na variável e não na sua frase.',
    });
  }
  return todas;
}

/**
 * Corte de campo LITERAL (o que não passa por `interpolar`) que NÃO fica mudo.
 *
 * Corpo, título de item e rótulo de botão atravessam `interpolar()`, e é de lá que vem o registro do
 * corte. Rodapé e rótulo do botão que abre a lista não atravessam: eram cortados direto por
 * `cortarSeguro` e o corte não deixava rastro nenhum, nem em `_achados`, nem em incidente, nem na
 * prévia. Este helper devolve o mesmo corte MAIS o achado, no formato que `anotarAchados` já lê.
 */
function cortarComAchado(texto, teto, { unidade, campo, sufixo = '…', achados } = {}) {
  const bruto = String(texto ?? '');
  const valor = cortarSeguro(bruto, teto, { unidade, sufixo });
  if (achados && valor !== bruto) {
    achados.push({ valor, campo, ausentes: [], cortadas: [{ variavel: '(campo inteiro)', reserva: teto }], estourou: true });
  }
  return valor;
}

/**
 * ⚠️ REGRA R1 DO MOTOR — NENHUM EXECUTOR DESTE ARQUIVO TOCA A REDE.
 *
 * `preparar()`, `executar()`, `receber()` e `continuar()` rodam DENTRO da transação curta (T1) do
 * motor. Lá `ctx.canal` e `ctx.egresso` são SENTINELAS que lançam ao primeiro acesso — e isso é
 * proteção, não formalidade: uma transação aberta atravessando chamada de rede segura bloqueios de
 * linha pelo tempo do terceiro e esgota o pool de conexões. Com o Typebot medido respondendo de
 * forma pouco confiável, seria o caminho curto para o banco inteiro parar às três da manhã.
 *
 * A divisão de trabalho, então, é:
 *   • `preparar()` MONTA a intenção (texto, lista, etiqueta, requisição HTTP) e não envia nada;
 *   • `executar()` devolve a transição PRETENDIDA, independente de o despacho dar certo (regra R2);
 *   • o motor reserva o efeito na T1, despacha DEPOIS do commit e, se falhar, rerroteia pela saída
 *     `erro`, `erro_interno` ou `sem_janela` na T2.
 *
 * Consequência prática: executor que tentasse adivinhar o sucesso do envio duplicaria
 * responsabilidade e mentiria quando o envio falhasse depois do commit.
 *
 * O que continua sendo do executor é a conferência que NÃO precisa de rede: a janela de 24 h
 * (estado gravado, lido de `ctx.janela`) e os tetos da Meta (contagem local). Recusar aqui é melhor
 * que deixar a Meta recusar — o operador recebe o incidente com o número exato em vez de um código
 * de provedor.
 */

/**
 * Códigos da Meta que significam "a janela de serviço fechou". Exportados porque quem despacha
 * precisa mapeá-los para a saída `sem_janela` do nó, e NÃO para `erro`: é a fonte autoritativa
 * corrigindo a nossa contabilidade otimista, e é exatamente o caso para o qual o operador
 * configurou um template. Tratar como `erro` faria o template configurado para esse caso não ser
 * usado justamente no caso em que ele existe.
 */
export const CODIGOS_META_FORA_DA_JANELA = Object.freeze([131047, 131026, 470, 131051]);
const CONJUNTO_FORA_DA_JANELA = new Set(CODIGOS_META_FORA_DA_JANELA);

export function ehJanelaFechada(e) {
  if (!e) return false;
  if (e.name === 'JanelaFechada' || e.codigo === 'JANELA_FECHADA' || e.code === 'JANELA_FECHADA') return true;
  const codigo = Number(e.codigoMeta ?? e.metaCode ?? e?.dados?.code);
  return CONJUNTO_FORA_DA_JANELA.has(codigo);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// OS DEZESSETE EXECUTORES
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. inicio ───────────────────────────────────────────────────────────────────────────────────
const noInicio = {
  tipo: 'inicio',
  efeito: 'repetivel',        // ver divergência 4 no cabeçalho
  politicaEmDuvida: 'seguir', // emitir protocolo e carimbar são idempotentes: repetir não machuca
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['padrao'],

  validar(no) {
    const problemas = [];
    if (no?.config?.emitirProtocolo === false && no?.config?.exigirProtocolo === true) {
      problemas.push(erro('ARESTA_AUSENTE', 'config', 'O nó pede protocolo obrigatório e desliga a emissão ao mesmo tempo.', 'Escolha um dos dois.'));
    }
    return problemas;
  },

  /** A única saída deste nó é o carimbo na conversa — e ele é cópia, nunca a verdade. */
  preparar(no, ctx) {
    return [intencaoDeCarimbo({
      rgt_protocolo: ctx?.vars?.protocolo ?? ctx?.execucao?.protocolo ?? null,
      rgt_fluxo: ctx?.execucao?.fluxoId ?? null,
      rgt_fluxo_versao: ctx?.execucao?.versaoId ?? null,
      rgt_no_atual: no?.id ?? ctx?.no?.id ?? null,
    })];
  },

  async executar(ctx) {
    const { registrar } = ganchos(ctx);
    const config = ctx?.no?.config ?? {};
    const varsPatch = {};

    // Por padrão o `inicio` NÃO consome número da sequência: a maioria das conversas passa pelo menu
    // e vai embora, e numerar cada "oi" gasta a numeração humana da empresa. Quem quiser o
    // comportamento da especificação §4.2 liga `emitirProtocolo: true` — os dois caminhos usam o
    // mesmo helper idempotente, então nunca há dois números para a mesma conversa.
    if (config.emitirProtocolo === true) {
      try {
        const p = await garantirProtocolo(ctx);
        varsPatch.protocolo = p.protocolo;
        registrar({ tipo: 'no_entrou', noId: ctx?.no?.id, detalhe: { protocoloNovo: !!p.novo } });
      } catch (e) {
        return falhar(
          'erro_interno', 'SEGREDO_AUSENTE',
          `Não foi possível emitir o protocolo: ${e?.message ?? e}. Provável causa: a empresa não tem prefixo de protocolo definido.`,
          mensagemDeFalha(ctx?.no, ctx),
        );
      }
    }

    // O carimbo sai como intenção (ver `intencaoDeCarimbo`): o motor aplica `varsPatch` ao contexto
    // ANTES de chamar `preparar()`, então o protocolo recém-emitido já aparece no carimbo.
    return { tipo: 'seguir', saida: 'padrao', varsPatch };
  },
};

// ── 2. texto ────────────────────────────────────────────────────────────────────────────────────
const noTexto = {
  tipo: 'texto',
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  aceitaModeloFora: true,

  // `saidas()` é o que o AUTOR desenha; `saidasDeFalha` é o que o MOTOR pode tomar sozinho. As duas
  // entram em `saidasDe()` — ver lá o porquê de a separação existir. `sem_janela` mudou de lista sem
  // mudar de resultado: continua aparecendo para o editor, agora pela mesma porta dos outros nós.
  saidas: () => ['padrao', 'erro'],
  saidasDeFalha: ['sem_janela'],

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    // Antes do retorno antecipado de propósito: o template é o caminho FORA da janela, e ele precisa
    // ser conferido mesmo num nó que ainda esteja com o corpo por escrever.
    conferirTemplateDoNo(no, ctx, problemas, { entrega: 'entrega' });
    const corpo = no?.config?.corpo;
    const texto = corpo && typeof corpo === 'object' ? corpo.texto : corpo;
    if (!texto || !String(texto).trim()) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.corpo', 'Nó de texto sem corpo não envia nada e ainda ocupa um passo do fluxo.', 'Escreva a mensagem ou remova o nó.'));
      return problemas;
    }
    const teto = lim.valores.texto_max;
    problemas.push(...conferirTeto(texto, teto, 'config.corpo', lim, { oQueE: 'O corpo da mensagem' }));
    conferirReservas(texto, teto, 'config.corpo', corpo?.reserva, lim, problemas);
    procurarSegredoLiteral(no?.config, 'config', problemas);
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);

    // ⚠️ Fora da janela de 24 h, mensagem LIVRE é recusada pela Meta (131047). Antes desta linha,
    // `config.template` liberava o nó em `executar()` e mesmo assim `preparar()` montava texto livre:
    // o envio era recusado, o cliente ficava sem nada e o template aprovado e PAGO — comprado
    // exatamente para este caso — nunca era usado. Montar a intenção AQUI, e não no despacho, é o que
    // faz a prévia do editor mostrar ao operador o que o cliente realmente receberia.
    //
    // Dentro da janela seguimos com texto livre mesmo havendo template: template custa dinheiro e
    // renderiza um conteúdo aprovado meses atrás, enquanto o corpo do nó é o texto que o autor
    // escreveu para agora.
    const modelo = templateDoNo(no?.config);
    if (modelo && !janelaAberta(ctx)) return [intencaoDeTemplate(modelo, ctx)];

    const r = textoDoCampo(no?.config?.corpo, ctx, { teto: lim.valores.texto_max, campo: 'config.corpo' });
    return [{ tipo: 'texto', corpo: r.valor, sufixo: '', _achados: r }];
  },

  async executar(ctx) {
    // `templateDoNo` e não `config.template`: um bloco de template SEM nome de modelo é verdadeiro em
    // JavaScript, e era ele que liberava o nó fora da janela sem existir nada para enviar. Só o
    // template utilizável livra da saída `sem_janela` — e a conferência é a mesma que `preparar()`
    // usa para decidir a intenção, para as duas nunca discordarem.
    const modelo = templateDoNo(ctx?.no?.config);
    if (!janelaAberta(ctx) && !modelo) {
      return falhar(
        'sem_janela', 'JANELA_FECHADA',
        'A janela de 24 horas está fechada e o nó não tem template utilizável declarado, então nenhuma mensagem livre sai daqui.',
        mensagemDeFalha(ctx?.no, ctx),
      );
    }

    const intencoes = noTexto.preparar(ctx.no, ctx);
    // `achadosDas` porque a intenção de template carrega uma LISTA de achados (um por parâmetro) e a
    // de texto carrega um só: passar o array cru engoliria em silêncio as variáveis não resolvidas.
    anotarAchados(ctx, achadosDas(intencoes));

    // Regra R2: devolvemos a transição PRETENDIDA. Se o despacho falhar depois do commit, quem
    // rerroteia pela saída `erro` (ou `sem_janela`) é a T2 do motor — adivinhar aqui seria mentir.
    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id });
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

// ── 3. midia ────────────────────────────────────────────────────────────────────────────────────
const TIPOS_MIDIA = new Set(['image', 'video', 'audio', 'document', 'sticker']);

// ── A CATEGORIA DA MÍDIA FALA DUAS LÍNGUAS, e a culpa é nossa ────────────────────────────────────
// Medido em 03/09/2026, no fluxo do dono: o seletor da tela oferecia `imagem` e `documento` (em
// português) e este validador só aceitava `image` e `document` (em inglês, que é o vocabulário da
// Meta). Resultado: DUAS das quatro opções do seletor produziam um fluxo que NUNCA publicava, com
// a mensagem «Categoria desconhecida» apontando para uma lista que a tela nem oferece.
//
// A tela foi corrigida para gravar o valor canônico. Este mapa existe para os rascunhos que já
// foram salvos com o valor em português: recusá-los agora puniria o operador por um defeito nosso,
// e a categoria nem sequer é usada no envio (`preparar()` só carrega `url`, `mime` e `legenda`).
const SINONIMOS_CATEGORIA_MIDIA = new Map([
  ['imagem', 'image'], ['foto', 'image'],
  ['documento', 'document'], ['arquivo', 'document'],
  ['audio', 'audio'], ['áudio', 'audio'],
  ['video', 'video'], ['vídeo', 'video'],
  ['figurinha', 'sticker'], ['adesivo', 'sticker'],
]);

/**
 * Devolve a categoria de mídia no vocabulário canônico (o da Meta), ou `null` quando o valor não é
 * reconhecível nem como canônico nem como sinônimo em português.
 */
export function categoriaMidiaCanonica(bruto) {
  const v = String(bruto ?? '').trim().toLowerCase();
  if (!v) return null;
  if (TIPOS_MIDIA.has(v)) return v;
  return SINONIMOS_CATEGORIA_MIDIA.get(v) ?? null;
}

const noMidia = {
  tipo: 'midia',
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  // Template com cabeçalho de mídia existe na Meta, mas o mapeamento não foi medido nesta casa.
  // Declarar `true` sem medir prometeria uma entrega fora da janela que pode não acontecer.
  aceitaModeloFora: false,

  saidas: () => ['padrao', 'erro'],
  saidasDeFalha: ['sem_janela'],

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    if (!c.url || !/^https:\/\//i.test(String(c.url))) {
      problemas.push(erro('DESTINO_NAO_PERMITIDO', 'config.url', 'A mídia precisa de uma URL https. A Meta busca o arquivo pela internet e recusa http simples.', 'Publique o arquivo num endereço https acessível.'));
    }
    if (c.mime && !/^[\w.+-]+\/[\w.+-]+$/.test(String(c.mime))) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.mime', 'Tipo de mídia em formato inválido.', 'Use algo como image/jpeg ou application/pdf.'));
    }
    if (c.categoria && !categoriaMidiaCanonica(c.categoria)) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.categoria', `Categoria "${c.categoria}" desconhecida. Aceitas: ${[...TIPOS_MIDIA].join(', ')} (ou os nomes em português: imagem, vídeo, áudio, documento, figurinha).`, 'Escolha uma das categorias da lista, no painel do nó.'));
    }
    if (Number.isFinite(Number(c.bytes)) && Number(c.bytes) > lim.valores.midia_bytes_max) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.bytes', `O arquivo tem ${Number(c.bytes)} bytes e o teto do perfil é ${lim.valores.midia_bytes_max}. A Meta recusa o envio inteiro.`, 'Comprima o arquivo ou envie um link no corpo de um nó de texto.'));
    }
    if (c.legenda) {
      problemas.push(...conferirTeto(c.legenda?.texto ?? c.legenda, lim.valores.corpo_max, 'config.legenda', lim, { oQueE: 'A legenda' }));
    }
    // Este nó declara `aceitaModeloFora: false` (mapeamento não medido nesta casa). Template
    // declarado aqui é IGNORADO — e ignorar em silêncio é o que faz o operador acreditar que tem
    // caminho fora da janela quando não tem.
    conferirTemplateDoNo(no, ctx, problemas, { entrega: 'nao_medido' });
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const legenda = c.legenda
      ? textoDoCampo(c.legenda, ctx, { teto: lim.valores.corpo_max, campo: 'config.legenda' })
      : null;
    // `caminho_url` e não `consulta`: a variável é escapada por segmento e não pode introduzir
    // `/ ? # @`. O validador já recusa variável na posição do host, então o que sobra aqui é o
    // caminho — e é ele que precisa do escape.
    const url = interpolar(String(c.url ?? ''), ctx?.vars ?? {}, { destino: 'caminho_url' });
    return [{
      tipo: 'midia',
      url: url.valor,
      mime: c.mime ?? null,
      legenda: legenda?.valor ?? undefined,
      sufixo: '',
      _achados: [url, legenda].filter(Boolean),
    }];
  },

  async executar(ctx) {
    if (!janelaAberta(ctx)) {
      return falhar('sem_janela', 'JANELA_FECHADA', 'Janela de 24 horas fechada — mídia livre não sai.', mensagemDeFalha(ctx?.no, ctx));
    }
    const intencoes = noMidia.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.flatMap((i) => i._achados ?? []));
    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id });
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

// ── 4. pergunta ─────────────────────────────────────────────────────────────────────────────────
// Correção D2 do documento 25 §12.6: «o fluxo promete resposta por e-mail e não confere o e-mail».
// Aqui a validação é de primeira classe e a repergunta tem teto.

/** Validadores de formato. Cada um devolve `{ok, motivo}` — motivo vira reforço para o cliente. */
const VALIDADORES = {
  email: (v) => ({
    ok: /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v).trim()),
    motivo: 'não parece um endereço de e-mail',
  }),
  telefone: (v) => {
    const d = String(v).replace(/\D/gu, '');
    return { ok: d.length >= 10 && d.length <= 13, motivo: 'não parece um telefone com DDD' };
  },
  cpf: (v) => ({ ok: validarCpf(String(v)), motivo: 'não é um CPF válido' }),
  regex: (v, cfg) => {
    try {
      return { ok: new RegExp(cfg.padrao, cfg.modificadores ?? '').test(String(v)), motivo: cfg.motivo ?? 'não está no formato esperado' };
    } catch {
      // Padrão inválido na configuração: NÃO reprovamos a resposta do cliente por defeito nosso.
      return { ok: true, motivo: '' };
    }
  },
  tamanhoMin: (v, cfg) => ({
    ok: medir(String(v).trim()).grafemas >= Number(cfg.minimo ?? 1),
    motivo: `precisa de pelo menos ${Number(cfg.minimo ?? 1)} caracteres`,
  }),
  tamanhoMax: (v, cfg) => ({
    ok: medir(String(v).trim()).grafemas <= Number(cfg.maximo ?? 4096),
    motivo: `passou de ${Number(cfg.maximo ?? 4096)} caracteres`,
  }),
  numero: (v) => ({ ok: /^-?\d+([.,]\d+)?$/.test(String(v).trim()), motivo: 'não é um número' }),
};

/** Dígitos verificadores do CPF. Rejeita as sequências repetidas, que passam na conta mas não existem. */
function validarCpf(bruto) {
  const d = String(bruto).replace(/\D/gu, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const [inicio, posicao] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < inicio; i += 1) soma += Number(d[i]) * (posicao - i);
    const resto = (soma * 10) % 11 % 10;
    if (resto !== Number(d[inicio])) return false;
  }
  return true;
}

const noPergunta = {
  tipo: 'pergunta',
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: true,
  // §5.4 é explícito: `pergunta` NÃO aceita template fora da janela, porque resposta livre não tem
  // como ser solicitada por template. Estava `true` aqui enquanto o próprio `executar()` recusava —
  // duas afirmações contrárias sobre o mesmo nó, e a errada era a que o validador de caminho lia.
  aceitaModeloFora: false,

  saidas: () => ['padrao', ...SAIDAS_DE_EXCECAO],
  // O `executar()` deste nó devolve `falhar('sem_janela')` quando a janela fecha. Sem declarar a
  // saída aqui, o autor não tinha como desenhar a aresta e a conversa morria calada no motor.
  saidasDeFalha: ['sem_janela'],

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const corpo = c.corpo;
    const texto = corpo && typeof corpo === 'object' ? corpo.texto : corpo;

    if (!texto || !String(texto).trim()) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.corpo', 'Pergunta sem texto deixa o cliente esperando sem saber o que responder.', 'Escreva a pergunta.'));
    } else {
      problemas.push(...conferirTeto(texto, lim.valores.corpo_max, 'config.corpo', lim, { oQueE: 'A pergunta' }));
      conferirReservas(texto, lim.valores.corpo_max, 'config.corpo', corpo?.reserva, lim, problemas);
    }

    if (!c.para || !/^[\p{L}\p{N}_]+$/u.test(String(c.para))) {
      problemas.push(erro('VARIAVEL_AUSENTE', 'config.para', 'A pergunta não diz em qual variável guardar a resposta — é assim que a resposta do cliente se perde.', 'Informe "para": "email", por exemplo.'));
    }

    if (c.validacao) {
      const tipo = c.validacao.tipo;
      if (!VALIDADORES[tipo]) {
        problemas.push(erro('LIMITE_EXCEDIDO', 'config.validacao.tipo', `Tipo de validação desconhecido. Aceitos: ${Object.keys(VALIDADORES).join(', ')}.`, 'Escolha um tipo válido ou remova a validação.'));
      }
      if (tipo === 'regex') {
        try {
          new RegExp(c.validacao.padrao ?? '', c.validacao.modificadores ?? '');
        } catch (e) {
          problemas.push(erro('LIMITE_EXCEDIDO', 'config.validacao.padrao', `Expressão regular inválida: ${e.message}. Como está, ela aceitaria qualquer resposta em silêncio.`, 'Corrija a expressão.'));
        }
      }
    }

    conferirEspera(c.esperaResposta, 'config.esperaResposta', problemas);
    conferirExcecoes(c, problemas);
    conferirTemplateDoNo(no, ctx, problemas, { entrega: 'proibido' });
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);
    const r = textoDoCampo(no?.config?.corpo, ctx, { teto: lim.valores.corpo_max, campo: 'config.corpo' });
    return [{ tipo: 'texto', corpo: r.valor, sufixo: '', _achados: r }];
  },

  async executar(ctx) {
    // ⚠️ Não há mais escape por `config.template` aqui, e o motivo é grave: com template declarado e a
    // janela fechada, este nó devolvia `aguardar` — a execução estacionava esperando a resposta de uma
    // pergunta que NUNCA foi entregue, até o prazo vencer. E não havia como entregá-la: o §5.4 é
    // explícito em que `pergunta` não tem template («resposta livre fora da janela não tem como ser
    // solicitada»). Fora da janela, portanto, a saída é sempre `sem_janela`, e quem decide o que fazer
    // é o desenho do fluxo — reengajamento em dois passos ou entrega a um humano.
    if (!janelaAberta(ctx)) {
      return falhar('sem_janela', 'JANELA_FECHADA', 'Janela de 24 horas fechada — a pergunta livre não sai, e esperar resposta a uma pergunta que não chegou seria mentir para o operador.', mensagemDeFalha(ctx?.no, ctx));
    }
    const intencoes = noPergunta.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.map((i) => i._achados).filter(Boolean));

    const esperaMs = tempoDeEsperaDoNo(ctx.no) ?? 4 * MS_POR_UNIDADE.minutos;
    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id });
    return {
      tipo: 'aguardar',
      motivo: 'resposta',
      acordarEm: new Date(agoraDe(ctx).getTime() + esperaMs),
      saidaAoVencer: 'sem_resposta',
    };
  },

  async receber(ctx, entrada) {
    const c = ctx?.no?.config ?? {};
    const bruto = String(entrada?.texto ?? entrada?.interativo?.titulo ?? '').trim();

    if (!bruto) {
      // Anexo sem texto numa pergunta de texto: é resposta, mas não é a resposta pedida.
      return { saida: 'opcao_invalida', varsPatch: {}, viaCasamento: 'titulo' };
    }

    if (c.validacao?.tipo && VALIDADORES[c.validacao.tipo]) {
      const veredito = VALIDADORES[c.validacao.tipo](bruto, c.validacao);
      if (!veredito.ok) {
        ganchos(ctx).registrar({
          tipo: 'opcao_invalida', noId: ctx?.no?.id,
          // Exceção única da regra de LGPD da telemetria: aqui o texto É o achado.
          detalhe: { motivo: veredito.motivo, amostra: bruto.slice(0, 120) },
        });
        return { saida: 'opcao_invalida', varsPatch: {}, viaCasamento: 'titulo' };
      }
    }

    const valor = c.higienizar === false ? bruto : bruto.replace(/\s+/gu, ' ').trim();
    return {
      saida: 'padrao',
      varsPatch: c.para ? { [c.para]: valor } : {},
      viaCasamento: 'titulo',
    };
  },
};

/** Tempo de espera do nó em milissegundos, ou `null` quando não declarado (o validador já bloqueia). */
function tempoDeEsperaDoNo(no) {
  const e = no?.config?.esperaResposta;
  if (!e) return null;
  const valor = Number(e.valor);
  const fator = MS_POR_UNIDADE[e.unidade];
  if (!Number.isFinite(valor) || !fator) return null;
  return valor * fator;
}

// ── 5. lista ────────────────────────────────────────────────────────────────────────────────────
// É onde 29 % das conversas vivem no fluxo real, e onde os limites da Meta mordem primeiro.

const noLista = {
  tipo: 'lista',
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: true,
  // NÃO existe template que renderize o seletor de lista. Declarar `true` entregaria ao cliente,
  // fora da janela, um texto sem nada para tocar — e o motor ficaria esperando uma escolha
  // impossível até o prazo vencer.
  aceitaModeloFora: false,

  saidas: (config) => [
    ...(Array.isArray(config?.itens) ? config.itens.map((i) => String(i.id)) : []),
    ...SAIDAS_DE_EXCECAO,
  ],
  // §5.4, literalmente: «Nó `lista` fora da janela toma a saída OBRIGATÓRIA `sem_janela`». Sem esta
  // linha o conector nem existia no editor, e o nó que só sabe falhar por aqui deixava o cliente sem
  // resposta nenhuma — que é o defeito que o próprio §5.4 descreve como inaceitável.
  saidasDeFalha: ['sem_janela'],

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const itens = Array.isArray(c.itens) ? c.itens : [];

    if (!itens.length) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.itens', 'Lista sem itens não dá ao cliente nada para escolher.', 'Acrescente de 1 a 10 itens.'));
    }
    if (itens.length > lim.valores.lista_itens_max) {
      problemas.push(erro(
        'LIMITE_EXCEDIDO', 'config.itens',
        `A lista tem ${itens.length} itens e o teto é ${lim.valores.lista_itens_max} somando TODAS as seções. A Meta recusa a mensagem inteira — nenhum item é entregue.`,
        'Divida em dois passos ou agrupe opções.',
      ));
    }

    const vistos = new Set();
    itens.forEach((item, i) => {
      const campo = `config.itens[${i}]`;
      if (!item?.id) {
        problemas.push(erro('ARESTA_AUSENTE', `${campo}.id`, 'Item sem id não tem como virar saída no grafo.', 'Dê um id curto e estável ao item.'));
      } else if (vistos.has(String(item.id))) {
        problemas.push(erro('ARESTA_AUSENTE', `${campo}.id`, `O id "${item.id}" está repetido. Duas saídas com o mesmo nome é o fan-out acidental nascendo de novo.`, 'Use ids distintos.'));
      } else {
        vistos.add(String(item.id));
      }
      if (!item?.titulo) {
        problemas.push(erro('LIMITE_EXCEDIDO', `${campo}.titulo`, 'Item de lista sem título aparece em branco no celular do cliente.', 'Escreva o título.'));
      } else {
        problemas.push(...conferirTeto(item.titulo, lim.valores.lista_titulo_max, `${campo}.titulo`, lim, { oQueE: `O título "${item.titulo}"` }));
      }
      if (item?.descricao) {
        problemas.push(...conferirTeto(item.descricao, lim.valores.lista_descricao_max, `${campo}.descricao`, lim, { oQueE: 'A descrição' }));
      }
    });

    // ── SEÇÕES (acréscimo B-MOTOR) ──────────────────────────────────────────────────────────────
    // O bot medido em produção já usa `sectionTitle` nos itens do `menuListaNode`; sem isto, migrar
    // aqueles 35 fluxos exigiria jogar fora o agrupamento e entregar um menu corrido de dez linhas.
    const agrupado = agruparItensPorSecao(itens);
    if (agrupado.temSecao) {
      if (agrupado.grupos.length > lim.valores.lista_secoes_max) {
        problemas.push(erro(
          'LIMITE_EXCEDIDO', 'config.itens',
          `A lista ficou com ${agrupado.grupos.length} seções e o teto é ${lim.valores.lista_secoes_max}. A Meta recusa a mensagem inteira — nenhuma seção é entregue.`,
          'Junte seções ou divida o menu em dois passos.',
        ));
      }
      // A Meta exige TÍTULO em cada seção quando há mais de uma. Item sem seção, ao lado de itens
      // com seção, produz exatamente esse caso — e a mensagem inteira é recusada. É erro, não aviso:
      // não há como adivinhar o nome do grupo dos itens soltos sem inventar texto de menu.
      if (agrupado.grupos.length > 1) {
        const soltos = agrupado.grupos.filter((g) => !g.titulo);
        for (const g of soltos) {
          problemas.push(erro(
            'LIMITE_EXCEDIDO', `config.itens[${g.primeiroIndice}].secao`,
            `Este item ficou sem seção enquanto outros têm. Com mais de uma seção a Meta exige título em TODAS, e recusa a mensagem inteira quando falta um — o cliente não recebe nada.`,
            'Dê uma seção a todos os itens, ou tire a seção de todos.',
          ));
        }
      }
      for (const g of agrupado.grupos) {
        if (g.titulo) {
          problemas.push(...conferirTeto(
            g.titulo, lim.valores.lista_secao_titulo_max, `config.itens[${g.primeiroIndice}].secao`, lim,
            { oQueE: `O título da seção "${g.titulo}"` },
          ));
        }
      }
      if (agrupado.naoContiguas.length) {
        problemas.push(aviso(
          'LIMITE_EXCEDIDO', 'config.itens',
          `As seções ${agrupado.naoContiguas.map((n) => `"${n}"`).join(', ')} aparecem em pedaços separados na lista de itens. No celular do cliente elas serão JUNTADAS, então a ordem que ele vê não é a ordem desta tela.`,
          'Deixe os itens da mesma seção juntos, na ordem em que o cliente deve lê-los.',
        ));
      }
    }

    // Cabeçalho: o `header` em negrito acima do corpo. Aceita a mesma forma de bloco do corpo
    // (`{ texto, reserva }`), porque também interpola variável e também tem teto.
    const cabecalho = c.cabecalho;
    const textoCabecalho = cabecalho && typeof cabecalho === 'object' ? cabecalho.texto : cabecalho;
    if (textoCabecalho) {
      problemas.push(...conferirTeto(textoCabecalho, lim.valores.cabecalho_max, 'config.cabecalho', lim, { oQueE: 'O cabeçalho' }));
      conferirReservas(textoCabecalho, lim.valores.cabecalho_max, 'config.cabecalho', cabecalho?.reserva, lim, problemas);
    }

    const corpo = c.corpo;
    const texto = corpo && typeof corpo === 'object' ? corpo.texto : corpo;
    if (texto) {
      problemas.push(...conferirTeto(texto, lim.valores.corpo_max, 'config.corpo', lim, { oQueE: 'O corpo da lista' }));
      conferirReservas(texto, lim.valores.corpo_max, 'config.corpo', corpo?.reserva, lim, problemas);
    }
    if (c.rotuloBotao) {
      problemas.push(...conferirTeto(c.rotuloBotao, lim.valores.lista_botao_max, 'config.rotuloBotao', lim, { oQueE: 'O rótulo do botão que abre a lista' }));
    }
    if (c.rodape) {
      problemas.push(...conferirTeto(c.rodape, lim.valores.rodape_max, 'config.rodape', lim, { oQueE: 'O rodapé' }));
    }

    conferirEspera(c.esperaResposta, 'config.esperaResposta', problemas);
    conferirExcecoes(c, problemas);
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const u = unidadeDeContagem(lim);
    const corpo = textoDoCampo(c.corpo, ctx, { teto: lim.valores.corpo_max, campo: 'config.corpo' });
    const achados = [corpo];

    const todosItens = Array.isArray(c.itens) ? c.itens : [];
    const tetoItens = lim.valores.lista_itens_max;
    const excedeuItens = todosItens.length > tetoItens;

    // ⚠️ POR QUE O `.slice()` CONTINUA AQUI, DIFERENTE DO QUE `botoes` FAZ COM 4 BOTÕES.
    //
    // O conserto do descarte silencioso NÃO é este corte — é a recusa em `executar()`, logo abaixo,
    // que o nó `botoes` já tinha e este não. O corte permanece por uma razão medida no motor:
    // `ragnabot-fluxo-motor.service.js` chama `executar()`, e SÓ DEPOIS chama `preparar()` e reserva
    // o efeito, sem olhar antes se o resultado foi `falhar`. Ou seja: a intenção montada aqui é
    // despachada de qualquer jeito, mesmo com o nó falhando. Devolver 11 itens neste ponto trocaria
    // «10 opções entregues e a 11ª ausente» por «a Meta recusa a mensagem inteira e o cliente não
    // recebe nada» — uma regressão vestida de correção.
    //
    // Quando o motor passar a descartar as intenções de um nó que falhou, este `.slice()` deve sair
    // e a lista deve seguir a regra dos botões ao pé da letra: não escolher por conta própria qual
    // opção o cliente não vai ver. Até lá, o item excedente é cortado, mas nunca em silêncio —
    // `_excedeuItens` e `_itensDescartados` viajam na intenção e `executar()` recusa por causa deles.
    const itens = todosItens.slice(0, tetoItens).map((item, i) => {
      const t = interpolar(String(item.titulo ?? ''), ctx?.vars ?? {}, { destino: 'whatsapp', teto: lim.valores.lista_titulo_max, unidade: u });
      const d = item.descricao
        ? interpolar(String(item.descricao), ctx?.vars ?? {}, { destino: 'whatsapp', teto: lim.valores.lista_descricao_max, unidade: u })
        : null;
      // O nome do campo viaja junto: sem ele o incidente de corte diria «algum texto foi encurtado»,
      // e o operador teria de caçar qual dos dez itens encolheu.
      achados.push({ ...t, campo: `config.itens[${i}].titulo` });
      if (d) achados.push({ ...d, campo: `config.itens[${i}].descricao` });
      return {
        id: String(item.id ?? `item_${i + 1}`),
        // Corte aplicado aqui e não no envio: é o mesmo caminho que a prévia do editor percorre,
        // então o operador vê na tela exatamente o título que o cliente vai receber.
        titulo: cortarSeguro(t.valor, lim.valores.lista_titulo_max, { unidade: u, sufixo: '…' }),
        descricao: d ? cortarSeguro(d.valor, lim.valores.lista_descricao_max, { unidade: u, sufixo: '…' }) : undefined,
      };
    });

    // ── SEÇÕES ──────────────────────────────────────────────────────────────────────────────────
    // ⚠️ `itens` CONTINUA PLANO no topo da intenção, e a duplicação é deliberada: é do array plano
    // que o motor monta `congelarNo()` (`i.itens || i.botoes`), congelando o que o cliente está
    // vendo, e é ele que a escada de casamento percorre quando a pessoa responde «2» em vez de tocar
    // a linha. Trocar o plano pelas seções quebraria a resposta de toda lista agrupada — em silêncio,
    // que é o pior modo.
    //
    // `secoes` só existe quando ALGUM item declara seção. Fluxo publicado antes deste acréscimo gera
    // exatamente a intenção de antes, byte por byte: quem não usa o recurso não paga por ele.
    const agrupado = agruparItensPorSecao(todosItens.slice(0, tetoItens));
    const secoes = agrupado.temSecao
      ? agrupado.grupos.map((g) => {
        const t = interpolar(String(g.titulo ?? ''), ctx?.vars ?? {}, {
          destino: 'whatsapp', teto: lim.valores.lista_secao_titulo_max, unidade: u,
        });
        achados.push({ ...t, campo: `config.itens[${g.primeiroIndice}].secao` });
        return {
          titulo: cortarSeguro(t.valor, lim.valores.lista_secao_titulo_max, { unidade: u, sufixo: '…' }),
          itens: g.indices.map((idx) => itens[idx]).filter(Boolean),
        };
      })
      : undefined;

    const cabecalho = c.cabecalho
      ? textoDoCampo(c.cabecalho, ctx, { teto: lim.valores.cabecalho_max, campo: 'config.cabecalho' })
      : null;
    if (cabecalho) achados.push(cabecalho);

    return [{
      tipo: 'lista',
      // Cabeçalho vem ANTES do corpo na mensagem; aqui a ordem das chaves não importa, mas manter o
      // mesmo desenho do celular ajuda quem lê a intenção crua num incidente.
      cabecalho: cabecalho
        ? cortarSeguro(cabecalho.valor, lim.valores.cabecalho_max, { unidade: u, sufixo: '…' })
        : undefined,
      corpo: corpo.valor,
      // Rodapé e rótulo do botão não passam por `interpolar`, então o corte deles não nascia em
      // `_achados` e não chegava a incidente nenhum. `cortarComAchado` corta igual e registra.
      rodape: c.rodape
        ? cortarComAchado(c.rodape, lim.valores.rodape_max, { unidade: u, campo: 'config.rodape', achados })
        : undefined,
      rotuloBotao: cortarComAchado(c.rotuloBotao ?? 'Escolher', lim.valores.lista_botao_max, { unidade: u, campo: 'config.rotuloBotao', achados }),
      itens,
      secoes,
      sufixo: '',
      _achados: achados,
      // Espelha `_excedeuBotoes` do nó `botoes`. É o que permite a `executar()` recusar hoje, sem
      // depender de nenhuma rota nova: o modo de teste do editor empurra todo `falhar` para
      // `problemas`, então o operador passa a ver o aviso na própria tela de teste.
      _excedeuItens: excedeuItens,
      _itensDescartados: excedeuItens
        ? todosItens.slice(tetoItens).map((item, i) => String(item?.id ?? `item_${tetoItens + i + 1}`))
        : [],
    }];
  },

  async executar(ctx) {
    const lim = limitesDe(ctx);
    // A ordem passou a ser a mesma do nó `botoes` — preparar, conferir o teto, conferir a janela —
    // e isso é de propósito: excesso de itens é defeito de CONFIGURAÇÃO, que existe com a janela
    // aberta ou fechada. Deixá-lo atrás do `sem_janela` esconderia o defeito de todo fluxo cujo
    // teste caísse fora da janela.
    const intencoes = noLista.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.flatMap((i) => i._achados ?? []));

    if (intencoes[0]?._excedeuItens) {
      // ⚠️ O DEFEITO QUE ESTA GUARDA FECHA, e por que ele era pior que o dos 4 botões: era MUDO.
      //
      // `saidasDe()` devolve UMA SAÍDA POR ITEM da lista — inclusive a do 11º. O editor monta os
      // conectores a partir dela, então desenhava o pino do item excedente, deixava ligá-lo a um nó
      // e dava o desenho por completo, verde. Enquanto isso `preparar()` descartava esse item com um
      // `.slice()` sem uma palavra, e `executar()` seguia para `aguardar` como se estivesse tudo
      // certo. O ramo inteiro pendurado no 11º item nunca disparava em produção, e a primeira
      // notícia do problema era o cliente reclamando de uma opção que nunca lhe foi oferecida.
      //
      // Recusar aqui é o mesmo remédio que o nó `botoes` já usava, pela mesma razão: acima do teto a
      // Meta recusa a mensagem INTEIRA — ela não entrega dez e descarta o décimo primeiro.
      const descartados = intencoes[0]._itensDescartados ?? [];
      const total = (Array.isArray(ctx?.no?.config?.itens) ? ctx.no.config.itens : []).length;
      return falhar(
        'erro', 'LIMITE_EXCEDIDO',
        `A lista tem ${total} itens e o teto do perfil ${lim.perfil} é ${lim.valores.lista_itens_max}. `
        + 'A Meta recusaria a mensagem inteira'
        + (descartados.length
          ? `, e as saídas ${descartados.map((d) => `"${d}"`).join(', ')} nunca seriam alcançadas — o que estiver ligado nelas está morto.`
          : '.'),
        mensagemDeFalha(ctx?.no, ctx),
      );
    }

    if (!janelaAberta(ctx)) {
      // Não há template que renderize lista: fora da janela este nó não tem plano B honesto.
      return falhar('sem_janela', 'JANELA_FECHADA', 'Janela de 24 horas fechada. Não existe template que renderize lista, então este nó não tem como ser entregue agora.', mensagemDeFalha(ctx?.no, ctx));
    }

    const esperaMs = tempoDeEsperaDoNo(ctx.no) ?? 4 * MS_POR_UNIDADE.minutos;
    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id });
    return {
      tipo: 'aguardar',
      motivo: 'resposta',
      acordarEm: new Date(agoraDe(ctx).getTime() + esperaMs),
      saidaAoVencer: 'sem_resposta',
    };
  },

  async receber(ctx, entrada) {
    const itens = Array.isArray(ctx?.no?.config?.itens) ? ctx.no.config.itens : [];
    const achado = casarOpcao(entrada, itens);
    if (!achado) {
      ganchos(ctx).registrar({
        tipo: 'opcao_invalida', noId: ctx?.no?.id,
        detalhe: { amostra: String(entrada?.texto ?? '').slice(0, 120) },
      });
      return { saida: 'opcao_invalida', varsPatch: {}, viaCasamento: null };
    }
    const item = itens.find((i) => String(i.id) === achado.id);
    const varsPatch = {};
    // Guardar a escolha numa variável é o que permite o resumo de confirmação citar o que a pessoa
    // escolheu, em vez de repetir a pergunta.
    if (ctx?.no?.config?.para) varsPatch[ctx.no.config.para] = item?.titulo ?? achado.id;
    ganchos(ctx).registrar({ tipo: 'resposta_recebida', noId: ctx?.no?.id, saida: achado.id, viaCasamento: achado.via });
    return { saida: achado.id, varsPatch, viaCasamento: achado.via };
  },
};

// ── 6. botoes ───────────────────────────────────────────────────────────────────────────────────
const noBotoes = {
  tipo: 'botoes',
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: true,
  // Template com botões de resposta rápida existe, mas o mapeamento não foi medido nesta casa.
  aceitaModeloFora: false,

  // ⚠️ EM MODO URL A SAÍDA É UMA SÓ: `padrao`. Botão de URL NÃO é bifurcação — a Meta não avisa que
  // o cliente tocou nele (não existe webhook de clique em `cta_url`). Declarar uma saída por botão
  // faria o editor desenhar um pino que nunca dispara, e alguém penduraria um ramo inteiro nele,
  // como já aconteceu com o 11º item da lista.
  saidas: (config) => (modoDosBotoes(config) === 'url'
    ? ['padrao']
    : [
      ...(Array.isArray(config?.botoes) ? config.botoes.map((b) => String(b.id)) : []),
      ...SAIDAS_DE_EXCECAO,
    ]),
  saidasDeFalha: ['sem_janela'],

  /**
   * ⚠️ A DECISÃO SOBRE O BOTÃO DE URL ESTACIONAR — está aqui, e é o ponto mais delicado do acréscimo.
   *
   * `estaciona` é declarado como booleano fixo no contrato §4.1, mas ESTE nó estaciona ou não
   * conforme a configuração: com botões de resposta ele espera a escolha; com botão de URL não há
   * resposta nenhuma a esperar — o cliente toca, o navegador abre, e o WhatsApp não nos conta nada.
   *
   * Se o modo URL continuasse estacionando, a conversa ficaria parada esperando uma resposta que a
   * Meta nunca vai mandar, até o prazo vencer. Aí o motor tomaria `sem_resposta`, gastaria uma
   * tentativa da escada de exceção e, no fim, transferiria a pessoa para um humano — TUDO ISSO
   * porque ela fez exatamente o que o botão pediu. Seria o «laço de exceção» do §4.4 nascendo de
   * novo, agora por um caminho que ninguém desenhou.
   *
   * Por isso, em modo URL: `executar()` devolve `seguir/padrao` (o fluxo continua no mesmo passo),
   * `saidas()` não declara as saídas de exceção de espera, e `estacionaCom()` diz `false` — para que
   * `saidasDe()` também não as acrescente e o editor não ofereça conector que nunca dispara.
   *
   * `estaciona: true` permanece no objeto como o valor do caso comum (é o que o §4.1 exige, e o que
   * quem só sabe ler o campo estático vai encontrar). Quem quiser a verdade por configuração usa
   * `noEstaciona(no)`, exportado no fim do arquivo.
   */
  estacionaCom: (config) => modoDosBotoes(config) !== 'url',

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const botoes = Array.isArray(c.botoes) ? c.botoes : [];
    const modo = modoDosBotoes(c);

    if (!botoes.length) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.botoes', 'Nó de botões sem botão não dá ao cliente nada para tocar.', 'Acrescente de 1 a 3 botões.'));
    }

    // ⚠️ A RECUSA DA MISTURA. Não é preferência de desenho: no WhatsApp Cloud API, botão de resposta
    // (`interactive.type:"button"`) e botão de URL (`interactive.type:"cta_url"`) são MENSAGENS
    // DIFERENTES. Não existe payload que carregue os dois. Um nó com dois botões de resposta e um de
    // URL não sai «com dois botões e um link»: a Meta recusa a mensagem INTEIRA, e o cliente não
    // recebe nada — nem o corpo, nem os botões, nem o link.
    if (modo === 'misto') {
      const respostas = botoes.filter((b) => String(b?.tipo ?? 'resposta') !== 'url').map((b) => String(b?.rotulo ?? b?.id ?? '?'));
      const urls = botoes.filter((b) => String(b?.tipo ?? 'resposta') === 'url').map((b) => String(b?.rotulo ?? b?.id ?? '?'));
      problemas.push(erro(
        'BOTOES_MISTURADOS', 'config.botoes',
        `Este nó mistura botão de resposta (${respostas.map((r) => `"${r}"`).join(', ')}) com botão de URL (${urls.map((r) => `"${r}"`).join(', ')}). `
        + 'No WhatsApp são dois tipos de mensagem interativa diferentes e não existe mensagem que carregue os dois: a Meta recusa a mensagem INTEIRA. '
        + 'O cliente não receberia nem o texto, nem os botões, nem o link.',
        'Separe em dois nós: um com até 3 botões de resposta e, depois dele, outro com o botão de URL sozinho. '
        + 'Se o link for opcional, ofereça-o como resposta rápida («Ver 2ª via») que leva a um nó de texto com o endereço.',
        { rotulo: 'Separar em dois nós', acao: 'separar_botoes_por_tipo', dados: { noId: no?.id } },
      ));
    }

    // `cta_url` carrega UM botão. Dois links na mesma mensagem é a mesma recusa da mistura.
    if (modo === 'url' && botoes.length > 1) {
      problemas.push(erro(
        'LIMITE_EXCEDIDO', 'config.botoes',
        `A mensagem com botão de URL leva EXATAMENTE UM botão, e este nó tem ${botoes.length}. A Meta recusa a mensagem inteira.`,
        'Deixe um botão de URL só, ou use uma lista com os endereços em nós de texto.',
      ));
    }

    if (modo !== 'url' && botoes.length > lim.valores.botoes_max) {
      // A frase É o conserto. A Meta recusa a mensagem INTEIRA acima do teto; ela não entrega três e
      // descarta o quarto. Prometer degradação parcial compra a confiança do operador antes de traí-la.
      problemas.push(erro(
        'LIMITE_EXCEDIDO', 'config.botoes',
        `A Meta recusa a mensagem inteira acima de ${lim.valores.botoes_max} botões — nenhum deles é entregue. Este nó tem ${botoes.length}.`,
        `Transforme em lista (até ${lim.valores.lista_itens_max} itens).`,
        { rotulo: 'Converter em lista', acao: 'converter_em_lista', dados: { noId: no?.id } },
      ));
    }

    const vistos = new Set();
    botoes.forEach((b, i) => {
      const campo = `config.botoes[${i}]`;
      if (!b?.id) problemas.push(erro('ARESTA_AUSENTE', `${campo}.id`, 'Botão sem id não vira saída no grafo.', 'Dê um id curto e estável.'));
      else if (vistos.has(String(b.id))) problemas.push(erro('ARESTA_AUSENTE', `${campo}.id`, `O id "${b.id}" está repetido.`, 'Use ids distintos.'));
      else vistos.add(String(b.id));
      if (!b?.rotulo) problemas.push(erro('LIMITE_EXCEDIDO', `${campo}.rotulo`, 'Botão sem rótulo aparece em branco.', 'Escreva o rótulo.'));
      else problemas.push(...conferirTeto(b.rotulo, lim.valores.botao_rotulo_max, `${campo}.rotulo`, lim, { oQueE: `O rótulo "${b.rotulo}"` }));

      const tipoBotao = String(b?.tipo ?? 'resposta');
      if (tipoBotao !== 'resposta' && tipoBotao !== 'url') {
        problemas.push(erro(
          'BOTAO_URL_INVALIDA', `${campo}.tipo`,
          `Tipo de botão "${tipoBotao}" desconhecido. Aceitos: "resposta" (o padrão, quando o campo não existe) e "url".`,
          'Escolha o tipo no editor.',
        ));
      }
      if (tipoBotao === 'url') {
        conferirUrlDeBotao(b?.url, `${campo}.url`, lim, problemas);
      } else if (b?.url) {
        // Aviso, não erro: a mensagem sai. O que não sai é o cliente do lugar — ele toca e nada
        // acontece, e ninguém liga o defeito ao campo esquecido.
        problemas.push(aviso(
          'BOTAO_URL_INVALIDA', `${campo}.url`,
          'Este botão tem endereço, mas o tipo é "resposta": o endereço é ignorado e o toque não leva o cliente a lugar nenhum.',
          'Mude o tipo para "url" (e separe este botão num nó só dele), ou apague o endereço.',
        ));
      }
    });

    const corpo = c.corpo;
    const texto = corpo && typeof corpo === 'object' ? corpo.texto : corpo;
    if (!texto) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.corpo', 'Botões sem corpo deixam o cliente sem saber o que está sendo perguntado.', 'Escreva a pergunta no corpo.'));
    } else {
      problemas.push(...conferirTeto(texto, lim.valores.corpo_max, 'config.corpo', lim, { oQueE: 'O corpo' }));
      conferirReservas(texto, lim.valores.corpo_max, 'config.corpo', corpo?.reserva, lim, problemas);
    }

    // Cabeçalho e rodapé (acréscimo B-MOTOR). O rodapé já era CORTADO em `preparar()` desde antes,
    // mas nunca tinha sido conferido na publicação: o operador só descobria o corte pelo incidente,
    // depois de o cliente já ter lido a frase pela metade.
    const cabecalho = c.cabecalho;
    const textoCabecalho = cabecalho && typeof cabecalho === 'object' ? cabecalho.texto : cabecalho;
    if (textoCabecalho) {
      problemas.push(...conferirTeto(textoCabecalho, lim.valores.cabecalho_max, 'config.cabecalho', lim, { oQueE: 'O cabeçalho' }));
      conferirReservas(textoCabecalho, lim.valores.cabecalho_max, 'config.cabecalho', cabecalho?.reserva, lim, problemas);
    }
    if (c.rodape) {
      problemas.push(...conferirTeto(c.rodape, lim.valores.rodape_max, 'config.rodape', lim, { oQueE: 'O rodapé' }));
    }

    // Em modo URL não há resposta a esperar, então cobrar tempo limite e escada de exceção seria
    // cobrar destino para eventos que não podem acontecer — e fluxo cheio de campo obrigatório sem
    // sentido é fluxo cujo operador aprende a preencher qualquer coisa.
    if (modo === 'url') {
      if (c.esperaResposta || c.excecoes) {
        problemas.push(aviso(
          'ESPERA_SEM_UNIDADE', 'config.esperaResposta',
          'Este nó só tem botão de URL: ele não espera resposta, então o tempo limite e a escada de exceção declarados aqui nunca serão usados.',
          'Pode apagá-los. Se a intenção é esperar o cliente voltar, use um nó de espera ou uma pergunta depois deste.',
        ));
      }
    } else {
      conferirEspera(c.esperaResposta, 'config.esperaResposta', problemas);
      conferirExcecoes(c, problemas);
    }
    conferirTemplateDoNo(no, ctx, problemas, { entrega: 'nao_medido' });
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const u = unidadeDeContagem(lim);
    const corpo = textoDoCampo(c.corpo, ctx, { teto: lim.valores.corpo_max, campo: 'config.corpo' });
    const achados = [corpo];

    // O corte NÃO é aplicado à quantidade de botões: cortar de 4 para 3 escolheria por conta própria
    // qual opção o cliente não vai ver. Aqui truncar mudaria o sentido, então o validador bloqueia
    // na publicação e o `preparar` mostra a verdade — inclusive na prévia do editor.
    const botoes = (Array.isArray(c.botoes) ? c.botoes : []).map((b, i) => {
      const r = interpolar(String(b.rotulo ?? ''), ctx?.vars ?? {}, { destino: 'whatsapp', teto: lim.valores.botao_rotulo_max, unidade: u });
      // Com o nome do campo, o incidente de corte diz QUAL rótulo encolheu. Sem ele, o operador
      // recebia «algum texto foi encurtado» e tinha de conferir os três botões na mão.
      achados.push({ ...r, campo: `config.botoes[${i}].rotulo` });
      const tipoBotao = String(b.tipo ?? 'resposta') === 'url' ? 'url' : 'resposta';
      // A URL usa o MESMO escape do nó `http` (`caminho_url`), e não é detalhe: sem ele, uma
      // variável com `?` ou `#` dentro corta a URL ao meio e o botão leva o cliente para outro
      // lugar do site — ou para fora dele.
      const endereco = tipoBotao === 'url'
        ? interpolar(String(b.url ?? ''), ctx?.vars ?? {}, { destino: 'caminho_url' })
        : null;
      if (endereco) achados.push({ ...endereco, campo: `config.botoes[${i}].url` });
      return {
        id: String(b.id ?? `botao_${i + 1}`),
        rotulo: cortarSeguro(r.valor, lim.valores.botao_rotulo_max, { unidade: u, sufixo: '…' }),
        // `tipo` viaja SEMPRE, inclusive nos botões de resposta: a porta do canal escolhe o payload
        // por ele, e um campo ausente que significa «resposta» é o tipo de suposição que envelhece
        // mal. Fluxo antigo, sem o campo, cai em 'resposta' aqui — que é o comportamento de antes.
        tipo: tipoBotao,
        url: endereco ? endereco.valor : undefined,
      };
    });

    const modo = modoDosBotoes(c);
    const cabecalho = c.cabecalho
      ? textoDoCampo(c.cabecalho, ctx, { teto: lim.valores.cabecalho_max, campo: 'config.cabecalho' })
      : null;
    if (cabecalho) achados.push(cabecalho);

    return [{
      tipo: 'botoes',
      // `modo` é o que diz à porta do canal QUAL mensagem interativa montar: `button` (respostas) ou
      // `cta_url` (o link). Sem ele, quem despacha teria de reinferir a partir dos botões — e duas
      // inferências da mesma coisa é como uma delas envelhece sozinha.
      modo: modo === 'misto' ? 'misto' : modo,
      cabecalho: cabecalho
        ? cortarSeguro(cabecalho.valor, lim.valores.cabecalho_max, { unidade: u, sufixo: '…' })
        : undefined,
      corpo: corpo.valor,
      // Mesmo motivo da lista: o rodapé não passa por `interpolar`, então o corte dele não deixava
      // rastro em lugar nenhum.
      rodape: c.rodape
        ? cortarComAchado(c.rodape, lim.valores.rodape_max, { unidade: u, campo: 'config.rodape', achados })
        : undefined,
      botoes,
      sufixo: '',
      _achados: achados,
      // O teto de 3 é do modo RESPOSTA. No modo URL o teto é 1, e quem cobra é a guarda de mistura
      // e a de quantidade em `executar()` — misturar os dois numa flag só faria a mensagem de erro
      // citar o número errado.
      _excedeuBotoes: modo !== 'url' && botoes.length > lim.valores.botoes_max,
      _excedeuUrl: modo === 'url' && botoes.length > 1,
      _misto: modo === 'misto',
    }];
  },

  async executar(ctx) {
    const lim = limitesDe(ctx);
    const intencoes = noBotoes.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.flatMap((i) => i._achados ?? []));

    if (intencoes[0]?._excedeuBotoes) {
      // Chega aqui só se alguém publicou com o bloqueio contornado. Falhar antes de enviar é melhor
      // que deixar a Meta recusar: o operador recebe o incidente com o número exato.
      return falhar(
        'erro', 'LIMITE_EXCEDIDO',
        `O nó tem ${intencoes[0].botoes.length} botões e o teto do perfil ${lim.perfil} é ${lim.valores.botoes_max}. A Meta recusaria a mensagem inteira.`,
        mensagemDeFalha(ctx?.no, ctx),
      );
    }
    // A MISTURA RECUSADA DE NOVO, agora em execução. A publicação já bloqueia, mas fluxo publicado
    // por outro caminho (importação, restauração de backup, contorno do bloqueio) chegaria aqui — e
    // o desfecho seria a Meta recusando a mensagem inteira, com o cliente em silêncio absoluto e um
    // código de provedor no lugar de uma explicação.
    if (intencoes[0]?._misto) {
      return falhar(
        'erro', 'BOTOES_MISTURADOS',
        'O nó mistura botão de resposta com botão de URL. São dois tipos de mensagem interativa diferentes no WhatsApp; não existe payload que carregue os dois, e a Meta recusaria a mensagem inteira. '
        + 'Separe em dois nós: os botões de resposta num, o link no outro.',
        mensagemDeFalha(ctx?.no, ctx),
      );
    }
    if (intencoes[0]?._excedeuUrl) {
      return falhar(
        'erro', 'LIMITE_EXCEDIDO',
        `O nó está em modo URL com ${intencoes[0].botoes.length} botões, e a mensagem de botão de URL leva exatamente um. A Meta recusaria a mensagem inteira.`,
        mensagemDeFalha(ctx?.no, ctx),
      );
    }
    if (!janelaAberta(ctx)) {
      return falhar('sem_janela', 'JANELA_FECHADA', 'Janela de 24 horas fechada — botões livres não saem.', mensagemDeFalha(ctx?.no, ctx));
    }

    // ⚠️ MODO URL NÃO ESTACIONA. Ver a justificativa em `estacionaCom`, logo acima: não há webhook
    // de clique em `cta_url`, então esperar resposta aqui prenderia a conversa até o prazo vencer e
    // depois puniria o cliente com a escada de `sem_resposta` — por ele ter feito o que o botão
    // pediu. O fluxo segue por `padrao` no mesmo passo; quem quiser dar tempo ao cliente põe um nó
    // de espera depois deste, que é uma decisão do autor do fluxo, não um efeito colateral.
    if (intencoes[0]?.modo === 'url') {
      ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id, detalhe: { modo: 'url' } });
      return { tipo: 'seguir', saida: 'padrao' };
    }

    const esperaMs = tempoDeEsperaDoNo(ctx.no) ?? 4 * MS_POR_UNIDADE.minutos;
    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id });
    return {
      tipo: 'aguardar',
      motivo: 'resposta',
      acordarEm: new Date(agoraDe(ctx).getTime() + esperaMs),
      saidaAoVencer: 'sem_resposta',
    };
  },

  async receber(ctx, entrada) {
    // O casamento usa `rotulo` como título — a escada é a mesma de lista, e é de propósito: o
    // cliente que digita «1» ou «sim» em vez de tocar o botão precisa ser entendido do mesmo jeito.
    const botoes = (Array.isArray(ctx?.no?.config?.botoes) ? ctx.no.config.botoes : [])
      .map((b) => ({ ...b, titulo: b.titulo ?? b.rotulo }));
    const achado = casarOpcao(entrada, botoes);
    if (!achado) {
      ganchos(ctx).registrar({ tipo: 'opcao_invalida', noId: ctx?.no?.id, detalhe: { amostra: String(entrada?.texto ?? '').slice(0, 120) } });
      return { saida: 'opcao_invalida', varsPatch: {}, viaCasamento: null };
    }
    const botao = botoes.find((b) => String(b.id) === achado.id);
    const varsPatch = {};
    if (ctx?.no?.config?.para) varsPatch[ctx.no.config.para] = botao?.rotulo ?? achado.id;
    ganchos(ctx).registrar({ tipo: 'resposta_recebida', noId: ctx?.no?.id, saida: achado.id, viaCasamento: achado.via });
    return { saida: achado.id, varsPatch, viaCasamento: achado.via };
  },
};

// ── 7. espera ───────────────────────────────────────────────────────────────────────────────────
// Correção 9 do documento 25 §12.6: «reduzir os 22 segundos de pausa e medir o efeito sobre os 29 %
// de abandono». O nó existe para que essa pausa seja um número editável e medível, não uma constante
// enterrada em código.
const noEspera = {
  tipo: 'espera',
  efeito: 'nenhum',
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['padrao'],

  validar(no, ctx) {
    const problemas = [];
    const ms = conferirEspera(no?.config?.duracao, 'config.duracao', problemas);
    if (ms != null) {
      const janelaMs = limitesDe(ctx).valores.janela_servico_horas * 3600 * 1000;
      if (ms >= janelaMs) {
        problemas.push(erro(
          'JANELA_FECHADA', 'config.duracao',
          `A pausa de ${Math.round(ms / 60000)} minutos é maior que a janela de serviço de ${limitesDe(ctx).valores.janela_servico_horas} h. Ao acordar, nenhuma mensagem livre poderá mais sair.`,
          'Reduza a pausa ou declare o caminho por template no nó seguinte.',
        ));
      } else if (ms > 60_000) {
        problemas.push(aviso(
          'JANELA_FECHADA', 'config.duracao',
          `Pausa de ${Math.round(ms / 1000)} segundos. Os 22 segundos de pausa medidos no fluxo real convivem com 29 % de abandono — vale medir o efeito antes de aumentar.`,
          'Considere reduzir e comparar a taxa de conclusão entre versões.',
        ));
      }
    }
    return problemas;
  },

  preparar() {
    return [];
  },

  async executar(ctx) {
    const ms = tempoDeEsperaDoNo({ config: { esperaResposta: ctx?.no?.config?.duracao } }) ?? 0;
    if (ms <= 0) return { tipo: 'seguir', saida: 'padrao' };
    return {
      tipo: 'aguardar',
      motivo: 'temporizador',
      // Vai para `RagnabotFluxoFila`, nunca para um `setTimeout` em memória: reinício de processo
      // não pode perder conversa, e implantação é evento rotineiro nesta casa.
      acordarEm: new Date(agoraDe(ctx).getTime() + ms),
      saidaAoVencer: 'padrao',
    };
  },
};

// ── 8. condicao ─────────────────────────────────────────────────────────────────────────────────
const OPERADORES = Object.freeze({
  igual: (a, b) => String(a ?? '') === String(b ?? ''),
  diferente: (a, b) => String(a ?? '') !== String(b ?? ''),
  contem: (a, b) => normalizarParaCasar(a).includes(normalizarParaCasar(b)),
  nao_contem: (a, b) => !normalizarParaCasar(a).includes(normalizarParaCasar(b)),
  comeca_com: (a, b) => normalizarParaCasar(a).startsWith(normalizarParaCasar(b)),
  vazio: (a) => a === undefined || a === null || String(a).trim() === '',
  nao_vazio: (a) => !(a === undefined || a === null || String(a).trim() === ''),
  maior: (a, b) => Number(a) > Number(b),
  menor: (a, b) => Number(a) < Number(b),
  regex: (a, b, cfg) => {
    try { return new RegExp(b, cfg?.modificadores ?? '').test(String(a ?? '')); } catch { return false; }
  },
});

/**
 * Hora e dia da semana no FUSO DA EMPRESA, nunca no fuso do processo.
 *
 * O contêiner roda em UTC e a operação é em UTC-3. Avaliar "está no horário comercial" com o relógio
 * do processo põe a virada às 21h em vez de meia-noite, e o cliente que escreve às 22h cai no ramo
 * do dia seguinte. A conversão é feita pelo `Intl`, que conhece horário de verão — cálculo manual de
 * deslocamento erra em toda mudança de regra.
 */
function relogioNoFuso(data, fuso) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const partes = Object.fromEntries(fmt.formatToParts(data).map((p) => [p.type, p.value]));
  const dias = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = Number(partes.hour === '24' ? '0' : partes.hour);
  return { diaSemana: dias[partes.weekday] ?? 0, minutos: hora * 60 + Number(partes.minute) };
}

function minutosDeHhMm(texto) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(texto ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const noCondicao = {
  tipo: 'condicao',
  efeito: 'nenhum',
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['verdadeiro', 'falso'],

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    const regras = Array.isArray(c.regras) ? c.regras : [];
    if (!regras.length && !c.horario) {
      problemas.push(erro('ARESTA_AUSENTE', 'config', 'Condição sem regra e sem faixa de horário sempre cai no mesmo lado — é um nó que finge decidir.', 'Declare ao menos uma regra ou uma faixa de horário.'));
    }
    regras.forEach((r, i) => {
      if (!r?.variavel) problemas.push(erro('VARIAVEL_AUSENTE', `config.regras[${i}].variavel`, 'Regra sem variável.', 'Informe a variável a comparar.'));
      if (!OPERADORES[r?.operador]) {
        problemas.push(erro('ARESTA_AUSENTE', `config.regras[${i}].operador`, `Operador desconhecido. Aceitos: ${Object.keys(OPERADORES).join(', ')}.`, 'Escolha um operador válido.'));
      }
    });
    if (c.horario) {
      if (!c.horario.fuso) {
        problemas.push(erro('ARESTA_AUSENTE', 'config.horario.fuso', 'Faixa de horário sem fuso é avaliada no relógio do servidor, que roda em UTC — a virada do dia sairia três horas adiantada.', 'Informe o fuso, por exemplo America/Fortaleza.'));
      } else {
        try { new Intl.DateTimeFormat('en-CA', { timeZone: c.horario.fuso }); }
        catch { problemas.push(erro('ARESTA_AUSENTE', 'config.horario.fuso', `Fuso "${c.horario.fuso}" desconhecido.`, 'Use um identificador IANA, por exemplo America/Fortaleza.')); }
      }
      for (const campo of ['de', 'ate']) {
        if (c.horario[campo] && minutosDeHhMm(c.horario[campo]) == null) {
          problemas.push(erro('ARESTA_AUSENTE', `config.horario.${campo}`, `Horário "${c.horario[campo]}" fora do formato HH:MM.`, 'Use 08:00, por exemplo.'));
        }
      }
    }
    return problemas;
  },

  preparar() {
    return [];
  },

  async executar(ctx) {
    const c = ctx?.no?.config ?? {};
    const combinador = c.combinador === 'ou' ? 'ou' : 'e';
    const vereditos = [];

    for (const regra of Array.isArray(c.regras) ? c.regras : []) {
      const fn = OPERADORES[regra.operador];
      if (!fn) { vereditos.push(false); continue; }
      const valor = lerCaminho(ctx?.vars ?? {}, regra.variavel);
      vereditos.push(!!fn(valor, regra.valor, regra));
    }

    if (c.horario) {
      const fuso = c.horario.fuso || 'America/Fortaleza';
      const { diaSemana, minutos } = relogioNoFuso(agoraDe(ctx), fuso);
      const dias = Array.isArray(c.horario.diasSemana) && c.horario.diasSemana.length
        ? c.horario.diasSemana.map(Number)
        : null;
      const de = minutosDeHhMm(c.horario.de) ?? 0;
      const ate = minutosDeHhMm(c.horario.ate) ?? 24 * 60;
      // Faixa que atravessa a meia-noite (22:00 → 06:00) é caso normal em plantão, e a comparação
      // ingênua `de <= x && x < ate` devolveria falso a noite inteira.
      const dentroDaHora = de <= ate ? (minutos >= de && minutos < ate) : (minutos >= de || minutos < ate);
      const dentroDoDia = dias ? dias.includes(diaSemana) : true;
      vereditos.push(dentroDaHora && dentroDoDia);
    }

    const resultado = combinador === 'ou' ? vereditos.some(Boolean) : vereditos.every(Boolean);
    ganchos(ctx).registrar({ tipo: 'no_saiu', noId: ctx?.no?.id, saida: resultado ? 'verdadeiro' : 'falso' });
    return { tipo: 'seguir', saida: resultado ? 'verdadeiro' : 'falso' };
  },
};

// ── 9. http ─────────────────────────────────────────────────────────────────────────────────────
// É o nó que MATA O D3 — «chamado registrado com sucesso» sem prova de sucesso. Três peças fazem
// isso: `sucessoQuando` (200 com corpo sem o campo é FALHA), `extrair` (a resposta vira variável) e
// a saída `erro` obrigatória no grafo.
//
// O import de `node:crypto` fica aqui, junto de quem usa, porque a chave de idempotência é o único
// lugar deste arquivo que precisa de resumo criptográfico. Imports de ESM são içados, então a
// posição é organização de leitura, não ordem de execução.
import { createHash } from 'node:crypto';

const METODOS_HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/**
 * §G — sha256(execucaoId|noId|visitaSeq|tentativa|sufixo).
 *
 * A chave inclui VISITA e TENTATIVA de propósito. Uma chave derivada só de «protocolo:nó» é
 * constante entre visitas: não distingue a primeira da segunda tentativa — que é onde ela serviria —
 * e faz um segundo chamado legítimo na mesma conversa colidir com o primeiro num destino que respeite
 * idempotência, sendo descartado em silêncio enquanto o cliente lê «registrado com sucesso».
 */
export function chaveEfeito({ execucaoId, noId, visitaSeq, tentativa = 1, sufixo = '' }) {
  return createHash('sha256')
    .update(`${execucaoId}|${noId}|${visitaSeq}|${tentativa}|${sufixo}`)
    .digest('hex');
}

/**
 * `sucessoQuando` avaliado sobre a resposta. Devolve quais caminhos faltaram, porque «faltou
 * data.chamadoId» é acionável e «falhou» não é.
 */
function avaliarSucessoLocal(resposta, sucessoQuando) {
  if (!sucessoQuando) {
    const ok = Number(resposta?.status) >= 200 && Number(resposta?.status) < 300;
    return { ok, faltaram: ok ? [] : ['status 2xx'] };
  }
  const faltaram = [];
  const status = Number(resposta?.status);
  const esperados = Array.isArray(sucessoQuando.status) ? sucessoQuando.status.map(Number) : null;
  if (esperados && !esperados.includes(status)) faltaram.push(`status ${status} (esperado ${esperados.join(' ou ')})`);
  for (const cond of Array.isArray(sucessoQuando.e) ? sucessoQuando.e : []) {
    const valor = lerCaminho(resposta?.corpo ?? resposta?.data, cond.caminho);
    if (cond.existe === true && (valor === undefined || valor === null || valor === '')) {
      faltaram.push(cond.caminho);
    } else if (cond.igual !== undefined && String(valor) !== String(cond.igual)) {
      faltaram.push(`${cond.caminho}=${cond.igual}`);
    }
  }
  return { ok: faltaram.length === 0, faltaram };
}

const noHttp = {
  tipo: 'http',
  efeito: 'irrepetivel',
  // `parar` e não `conciliar`: não existe forma genérica de perguntar a um sistema de terceiro «você
  // recebeu a minha chamada?». Efeito irreversível sem veredito chama gente — é o EFEITO_DUVIDOSO do
  // catálogo, e a alternativa (reenviar às cegas) abre o chamado duas vezes.
  politicaEmDuvida: 'parar',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['sucesso', 'erro'],

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};

    const metodo = String(c.metodo ?? '').toUpperCase();
    if (!METODOS_HTTP.has(metodo)) {
      problemas.push(erro('DESTINO_NAO_PERMITIDO', 'config.metodo', `Método "${c.metodo ?? ''}" inválido. Aceitos: ${[...METODOS_HTTP].join(', ')}.`, 'Escolha o método.'));
    }

    // URL: esqueleto fixo, variável nunca em posição de esquema ou de host. Deixar `{{host}}` no
    // lugar do host transforma um campo de texto do editor em «escolha para onde mandar o segredo».
    const url = String(c.url ?? '');
    if (!url) {
      problemas.push(erro('DESTINO_NAO_PERMITIDO', 'config.url', 'Nó HTTP sem URL.', 'Informe o endereço completo.'));
    } else if (!/^https:\/\//i.test(url)) {
      problemas.push(erro('DESTINO_NAO_PERMITIDO', 'config.url', 'A URL precisa começar com https://. Em http simples o segredo do cofre viaja em claro.', 'Use https.'));
    } else {
      const depoisDoEsquema = url.slice('https://'.length);
      const host = depoisDoEsquema.split(/[/?#]/u)[0];
      if (/\{\{/u.test(host)) {
        problemas.push(erro(
          'DESTINO_NAO_PERMITIDO', 'config.url',
          'A URL tem variável na posição do host. Isso deixa o destino da requisição — e do segredo — nas mãos de quem responder a pergunta anterior.',
          'Deixe o host fixo e use variáveis só no caminho ou na consulta.',
        ));
      }
      const permitidos = ctx?.destinosPermitidos;
      if (Array.isArray(permitidos) && host && !permitidos.includes(host)) {
        problemas.push(erro(
          'DESTINO_NAO_PERMITIDO', 'config.url',
          `O host "${host}" não está na lista de destinos aprovados desta empresa.`,
          'Peça a liberação do destino antes de publicar.',
          { rotulo: 'Pedir liberação do destino', acao: 'pedir_liberacao_destino', dados: { host } },
        ));
      }
    }

    // §4.8 regra 1: corpo é OBJETO, nunca texto livre. Texto livre com marcador dentro convida a
    // concatenar e dar JSON.parse depois — e aí uma aspa digitada pelo cliente reescreve o corpo.
    if (c.corpo !== undefined && (typeof c.corpo === 'string' || Array.isArray(c.corpo))) {
      problemas.push(erro(
        'CORPO_HTTP_TEXTO_LIVRE', 'config.corpo',
        'O corpo está como texto livre. O motor interpola FOLHAS de um objeto e deixa o serializador escapar; com texto livre, uma aspa na resposta do cliente quebra ou reescreve a requisição.',
        'Escreva o corpo como objeto: { "protocolo": "{{protocolo}}", "descricao": "{{detalhes}}" }.',
      ));
    }

    procurarSegredoLiteral(c.cabecalhos, 'config.cabecalhos', problemas);
    procurarSegredoLiteral(c.corpo, 'config.corpo', problemas);

    // Apelidos do cofre precisam existir NAQUELA empresa. `ctx.apelidosDoCofre` vem do serviço de
    // cofre com o tenantId da execução — nunca do documento do fluxo.
    const apelidos = coletarSegredosRef({ cabecalhos: c.cabecalhos, corpo: c.corpo, url: c.url });
    if (Array.isArray(ctx?.apelidosDoCofre)) {
      for (const a of apelidos) {
        if (!ctx.apelidosDoCofre.includes(a)) {
          problemas.push(erro('SEGREDO_AUSENTE', 'config.cabecalhos', `O apelido de cofre "${a}" não existe nesta empresa.`, 'Cadastre o segredo no cofre da empresa ou corrija o apelido.'));
        }
      }
    }

    if (!c.sucessoQuando) {
      problemas.push(erro(
        'HTTP_FALHOU', 'config.sucessoQuando',
        'Sem "sucessoQuando", qualquer 200 conta como sucesso — inclusive um 200 com corpo vazio. É assim que o fluxo promete «chamado registrado» sem prova de que foi registrado.',
        'Declare { "status": [200,201], "e": [{ "caminho": "data.chamadoId", "existe": true }] }.',
      ));
    }

    for (const [i, ex] of (Array.isArray(c.extrair) ? c.extrair : []).entries()) {
      if (!ex?.caminho) problemas.push(erro('HTTP_SEM_CAMPO', `config.extrair[${i}].caminho`, 'Extração sem caminho.', 'Informe o caminho, por exemplo data.chamadoId.'));
      if (!ex?.para) problemas.push(erro('HTTP_SEM_CAMPO', `config.extrair[${i}].para`, 'Extração sem variável de destino — o valor seria descartado.', 'Informe o nome da variável.'));
    }

    const tentativas = Number(c.tentativas?.max ?? 1);
    if (tentativas > 1) {
      problemas.push(erro(
        'EFEITO_DUVIDOSO', 'config.tentativas.max',
        'Retentativa cega num nó irrepetível abre o chamado mais de uma vez quando o destino está apenas LENTO, não fora. Tempo limite esgotado é DÚVIDA, e quem resolve dúvida é o conciliador.',
        'Deixe "tentativas": { "max": 1 }.',
      ));
    }

    if (c.registrarResposta && !['resumo', 'nenhum'].includes(c.registrarResposta)) {
      problemas.push(erro('HTTP_FALHOU', 'config.registrarResposta', 'Só "resumo" ou "nenhum". Corpo cru de terceiro na nossa base é dado de origem desconhecida guardado sem necessidade.', 'Use "resumo".'));
    }

    // A saída `erro` órfã é a recomendação 3 do documento 25 virando estrutura.
    const arestas = ctx?.arestasDoNo;
    if (Array.isArray(arestas) && !arestas.some((a) => a.saida === 'erro')) {
      problemas.push(erro(
        'SAIDA_DE_ERRO_ORFA', 'saidas.erro',
        'A saída "erro" deste nó HTTP não está ligada a nada. Quando a chamada falhar, o cliente fica sem resposta e o fluxo morre em silêncio.',
        'Ligue "erro" a uma mensagem honesta («não consegui registrar agora, vou passar para um analista») e a um encaminhamento para o time de Suporte.',
      ));
    }

    return problemas;
  },

  /**
   * Monta a requisição SEM enviar (regra R1: quem despacha é o motor, depois do commit).
   *
   * O cofre NÃO é resolvido nesta função. Ela é síncrona — o motor a chama sem `await` — e é a MESMA
   * que a prévia do editor usa: resolver o segredo aqui colocaria o valor em claro na tela de quem
   * edita. Quem troca referência por valor é `executar()`, que roda ANTES e deixa o resultado em
   * `ctx._cabecalhosResolvidos`. Na prévia, sem execução, as referências `{cofre:'apelido'}`
   * permanecem — que é exatamente o que o operador deve ver.
   */
  preparar(no, ctx) {
    const c = no?.config ?? {};
    const vars = ctx?.vars ?? {};

    const url = interpolar(String(c.url ?? ''), vars, { destino: 'caminho_url' });
    const cabecalhos = interpolar(c.cabecalhos ?? {}, vars, { destino: 'json' });
    const corpo = (c.corpo && typeof c.corpo === 'object' && !Array.isArray(c.corpo))
      ? interpolar(c.corpo, vars, { destino: 'json' })
      : { valor: c.corpo, ausentes: [], cortadas: [], estourou: false };

    return [{
      tipo: 'http',
      metodo: String(c.metodo ?? 'POST').toUpperCase(),
      url: url.valor,
      cabecalhos: ctx?._cabecalhosResolvidos ?? cabecalhos.valor,
      corpo: corpo.valor,
      tempoLimiteMs: Number(c.tempoLimiteMs ?? 15000),
      tetoCorpoBytes: Number(c.tetoCorpoBytes ?? 256 * 1024),
      sufixo: '',
      _achados: [url, cabecalhos, corpo],
      _segredosRef: coletarSegredosRef({ cabecalhos: c.cabecalhos, corpo: c.corpo }),
    }];
  },

  /**
   * NÃO CHAMA NINGUÉM. Resolve o cofre (leitura local do nosso banco, permitida na T1), guarda os
   * cabeçalhos prontos em `ctx._cabecalhosResolvidos` para `preparar()` usar, e devolve
   * `{tipo:'aguardar', motivo:'http'}` — regra R3 do motor.
   *
   * O motor despacha a intenção depois do commit e devolve o resultado por JOB, não por retorno de
   * função. É essa volta pela fila que faz a chamada externa sobreviver a um reinício no meio: sem
   * ela, uma implantação durante os 15 segundos de tempo limite deixaria a conversa parada para
   * sempre, com o chamado talvez aberto do outro lado e ninguém sabendo.
   */
  async executar(ctx) {
    const { incidente } = ganchos(ctx);
    const c = ctx?.no?.config ?? {};

    // Troca das referências de cofre pelos valores. O tenantId vem da EXECUÇÃO, jamais do nó: um
    // `findFirst` por apelido devolveria a linha de OUTRA empresa, e o cliente A mandaria requisição
    // com o token do cliente B.
    try {
      const cabecalhos = interpolar(c.cabecalhos ?? {}, ctx?.vars ?? {}, { destino: 'json' }).valor;
      ctx._cabecalhosResolvidos = await resolverCofreNaArvore(cabecalhos, ctx);
    } catch (e) {
      incidente('SEGREDO_AUSENTE', { noId: ctx?.no?.id, apelido: e?.apelido ?? null });
      return falhar('erro', 'SEGREDO_AUSENTE', `Segredo do cofre não resolveu: ${e?.message ?? e}`, mensagemDeFalha(ctx?.no, ctx));
    }

    // A chave de idempotência viaja no cabeçalho declarado. Ela inclui visita e tentativa: uma chave
    // derivada só de «protocolo:nó» é constante entre visitas e faria um segundo chamado legítimo na
    // mesma conversa colidir com o primeiro num destino que respeite idempotência, sendo descartado
    // em silêncio enquanto o cliente lê «registrado com sucesso».
    if (c.idempotencia?.cabecalho) {
      ctx._cabecalhosResolvidos[c.idempotencia.cabecalho] = ctx?.chaveEfeito ?? chaveEfeito({
        execucaoId: ctx?.execucao?.id, noId: ctx?.no?.id,
        visitaSeq: ctx?.execucao?.visitaSeq ?? 0, tentativa: 1, sufixo: '',
      });
    }

    anotarAchados(ctx, noHttp.preparar(ctx.no, ctx).flatMap((i) => i._achados ?? []));
    return { tipo: 'aguardar', motivo: 'http', saidaAoVencer: 'erro' };
  },

  /**
   * AQUI MORRE O D3. Um 200 com corpo sem `data.chamadoId` é FALHA, não sucesso — e por isso o
   * cliente NÃO lê «chamado registrado com sucesso» logo depois de uma chamada que talvez não tenha
   * registrado nada.
   *
   * @param {{status?:number, corpo?:object, data?:object, ok?:boolean, erro?:string, latenciaMs?:number}} resultado
   * @returns {Promise<{saida:string, varsPatch:object}>}
   */
  async continuar(ctx, resultado) {
    const { registrar, incidente } = ganchos(ctx);
    const c = ctx?.no?.config ?? {};

    if (resultado?.erro || resultado?.ok === false) {
      incidente('HTTP_FALHOU', { noId: ctx?.no?.id, status: resultado?.status ?? null, erro: String(resultado?.erro ?? 'falha na chamada') });
      return { saida: 'erro', varsPatch: {} };
    }

    // `ctx.egressoAvaliador` e não `ctx.egresso.avaliarSucesso`: dentro da T1 `ctx.egresso` é a
    // sentinela de rede e LANÇA ao primeiro acesso, mesmo para ler uma função pura. A porta separada
    // deixa o serviço de egresso substituir o avaliador sem quebrar a regra R1.
    const avaliar = typeof ctx?.egressoAvaliador === 'function' ? ctx.egressoAvaliador : avaliarSucessoLocal;
    const veredito = avaliar(resultado, c.sucessoQuando);
    if (!veredito.ok) {
      incidente('HTTP_FALHOU', {
        noId: ctx?.no?.id, status: resultado?.status,
        faltaram: veredito.faltaram,
        mensagem: `a resposta não satisfez "sucessoQuando" (status ${resultado?.status}); faltaram: ${veredito.faltaram.join(', ')}`,
        comoCorrigir: 'confira o caminho declarado em sucessoQuando contra o corpo que o destino devolve',
      });
      return { saida: 'erro', varsPatch: {} };
    }

    const varsPatch = {};
    for (const ex of Array.isArray(c.extrair) ? c.extrair : []) {
      const valor = lerCaminho(resultado?.corpo ?? resultado?.data, ex.caminho);
      if (valor === undefined || valor === null || valor === '') {
        if (ex.obrigatorio) {
          incidente('HTTP_SEM_CAMPO', {
            noId: ctx?.no?.id, caminho: ex.caminho,
            // Caminho esperado × chaves recebidas: é a dupla que transforma «falhou» em conserto.
            chavesRecebidas: Object.keys(resultado?.corpo ?? resultado?.data ?? {}).slice(0, 20),
            mensagem: `a extração obrigatória "${ex.caminho}" não achou valor na resposta`,
            comoCorrigir: 'corrija o caminho ou marque a extração como opcional',
          });
          return { saida: 'erro', varsPatch: {} };
        }
        continue;
      }
      varsPatch[ex.para] = typeof valor === 'object' ? JSON.stringify(valor) : valor;
    }

    registrar({
      tipo: 'no_saiu', noId: ctx?.no?.id, saida: 'sucesso',
      latenciaMs: resultado?.latenciaMs ?? null,
      // NUNCA corpo cru de terceiro: só resumo redigido, conforme `registrarResposta`.
      detalhe: c.registrarResposta === 'resumo' ? { status: resultado?.status, campos: Object.keys(varsPatch) } : undefined,
    });
    return { saida: 'sucesso', varsPatch };
  },
};

/** Substitui `{cofre:'apelido'}` pelo valor, com o tenantId vindo da EXECUÇÃO. */
async function resolverCofreNaArvore(valor, ctx) {
  if (Array.isArray(valor)) return Promise.all(valor.map((v) => resolverCofreNaArvore(v, ctx)));
  if (valor && typeof valor === 'object') {
    if (typeof valor.cofre === 'string') {
      if (typeof ctx?.cofre?.resolver !== 'function') {
        const e = new Error(`cofre indisponível para resolver o apelido "${valor.cofre}"`);
        e.apelido = valor.cofre;
        throw e;
      }
      return ctx.cofre.resolver(valor.cofre);
    }
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = await resolverCofreNaArvore(v, ctx);
    return saida;
  }
  return valor;
}

// ── 10. variavel ────────────────────────────────────────────────────────────────────────────────
// A5 do §11: «definir variável / montar texto». É o nó que dá destino ao `empresa` perguntado e
// nunca usado (D1) e que monta o resumo de confirmação com corte declarado.

const OPERACOES_VARIAVEL = Object.freeze({
  atribuir: (entrada) => entrada,
  maiusculas: (entrada) => String(entrada ?? '').toUpperCase(),
  minusculas: (entrada) => String(entrada ?? '').toLowerCase(),
  higienizar: (entrada) => String(entrada ?? '').replace(/[\r\n\t]+/gu, ' ').replace(/ {2,}/gu, ' ').trim(),
  somenteDigitos: (entrada) => String(entrada ?? '').replace(/\D/gu, ''),
  cortar: (entrada, cfg) => cortarSeguro(String(entrada ?? ''), Number(cfg.tamanho ?? 1024), { sufixo: cfg.sufixo ?? SUFIXO_CORTE }),
  concatenar: (entrada) => entrada, // o valor já vem montado pela interpolação do `de`
  formatarData: (entrada, cfg) => {
    const d = entrada ? new Date(entrada) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    // Fuso explícito sempre: o contêiner roda em UTC e a operação é em UTC-3. Formatar sem fuso
    // mostra ao cliente uma data três horas atrás da que ele viveu.
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: cfg.fuso || 'America/Fortaleza',
      dateStyle: cfg.estiloData ?? 'short',
      timeStyle: cfg.estiloHora ?? 'short',
    }).format(d);
  },
});

const noVariavel = {
  tipo: 'variavel',
  efeito: 'nenhum',
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['padrao', 'erro'],

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    const atribuicoes = Array.isArray(c.atribuicoes) ? c.atribuicoes : (c.para ? [c] : []);
    if (!atribuicoes.length) {
      problemas.push(erro('VARIAVEL_AUSENTE', 'config.atribuicoes', 'Nó de variável sem atribuição não faz nada.', 'Declare ao menos uma atribuição.'));
    }
    atribuicoes.forEach((a, i) => {
      const campo = `config.atribuicoes[${i}]`;
      if (!a?.para || !/^[\p{L}\p{N}_]+$/u.test(String(a.para))) {
        problemas.push(erro('VARIAVEL_AUSENTE', `${campo}.para`, 'Atribuição sem nome de variável de destino.', 'Informe "para".'));
      }
      const op = a?.operacao ?? 'atribuir';
      if (!OPERACOES_VARIAVEL[op]) {
        problemas.push(erro('VARIAVEL_AUSENTE', `${campo}.operacao`, `Operação desconhecida. Aceitas: ${Object.keys(OPERACOES_VARIAVEL).join(', ')}.`, 'Escolha uma operação válida.'));
      }
      if (op === 'cortar' && !Number.isFinite(Number(a?.tamanho))) {
        problemas.push(erro('RESERVA_AUSENTE', `${campo}.tamanho`, 'A operação "cortar" precisa de tamanho — é ela que garante o resumo caber no teto de 1024.', 'Informe o tamanho, por exemplo 400.'));
      }
      if (a?.de === undefined) {
        problemas.push(erro('VARIAVEL_AUSENTE', `${campo}.de`, 'Atribuição sem origem: não há o que calcular.', 'Informe "de" com texto e marcadores, por exemplo "{{nomes}} — {{assunto}}".'));
      }
    });
    return problemas;
  },

  /**
   * NADA sai daqui para o cliente — e devolver uma intenção de nota "só para a prévia" faria o motor
   * reservar e despachar uma mensagem de verdade. A prévia do valor calculado sai de `executar()`,
   * que agora é puro (sem rede) e pode ser chamado pelo editor com um contexto de mentira.
   */
  preparar() {
    return [];
  },

  async executar(ctx) {
    const c = ctx?.no?.config ?? {};
    const atribuicoes = Array.isArray(c.atribuicoes) ? c.atribuicoes : (c.para ? [c] : []);
    const varsPatch = {};
    const achados = [];
    try {
      for (const a of atribuicoes) {
        const r = interpolar(String(a.de ?? ''), ctx?.vars ?? {}, { destino: 'whatsapp' });
        achados.push(r);
        const fn = OPERACOES_VARIAVEL[a.operacao ?? 'atribuir'] ?? OPERACOES_VARIAVEL.atribuir;
        varsPatch[a.para] = fn(r.valor, a);
      }
    } catch (e) {
      return falhar('erro', 'VARIAVEL_AUSENTE', `Falha ao calcular variável: ${e?.message ?? e}`, mensagemDeFalha(ctx?.no, ctx));
    }
    anotarAchados(ctx, achados);
    return { tipo: 'seguir', saida: 'padrao', varsPatch };
  },
};

// ── 11. etiqueta ────────────────────────────────────────────────────────────────────────────────
// Correção D8 do documento 25: «aplicar a etiqueta chamado-aberto-pelo-bot antes de encerrar — sem
// isso não há relatório».
const noEtiqueta = {
  tipo: 'etiqueta',
  // Aplicar é repetível (idempotente); remover depende do estado atual. Como a propriedade é uma só,
  // fica no valor mais conservador dos dois: quem decide em dúvida compara o estado antes de agir.
  efeito: 'condicional',
  politicaEmDuvida: 'condicional',
  estaciona: false,
  aceitaModeloFora: false,

  // `erro_interno` e não `erro`: etiqueta é encanamento nosso. O cliente não pode ser transferido a
  // um humano porque um rótulo de relatório não colou.
  saidas: () => ['padrao', SAIDA_ERRO_INTERNO],

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    const aplicar = Array.isArray(c.aplicar) ? c.aplicar : [];
    const remover = Array.isArray(c.remover) ? c.remover : [];
    if (!aplicar.length && !remover.length) {
      problemas.push(erro('ARESTA_AUSENTE', 'config', 'Nó de etiqueta sem etiqueta para aplicar nem para remover.', 'Declare "aplicar" ou "remover".'));
    }
    for (const [lista, nome] of [[aplicar, 'aplicar'], [remover, 'remover']]) {
      lista.forEach((e, i) => {
        if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(String(e))) {
          problemas.push(erro('ARESTA_AUSENTE', `config.${nome}[${i}]`, `A etiqueta "${e}" tem caracteres que o Chatwoot recusa.`, 'Use letras, números, hífen e sublinhado.'));
        }
      });
    }
    const conflito = aplicar.filter((e) => remover.includes(e));
    if (conflito.length) {
      problemas.push(erro('ARESTA_AUSENTE', 'config', `A etiqueta ${conflito.join(', ')} está em aplicar E em remover. O resultado dependeria da ordem de execução.`, 'Escolha um dos dois.'));
    }
    return problemas;
  },

  preparar(no) {
    const c = no?.config ?? {};
    return [{
      tipo: 'etiqueta',
      aplicar: Array.isArray(c.aplicar) ? c.aplicar.map(String) : [],
      remover: Array.isArray(c.remover) ? c.remover.map(String) : [],
      sufixo: '',
    }];
  },

  async executar(ctx) {
    // A intenção vem de `preparar()`; falha de despacho vira `erro_interno` na T2 do motor, e não
    // `erro`: rótulo de relatório que não colou não pode transferir o cliente para um humano.
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

// ── 12. time ────────────────────────────────────────────────────────────────────────────────────
const noTime = {
  tipo: 'time',
  efeito: 'condicional',
  // `atribuir` é escrita de «último a escrever vence» sobre um estado editável por humano.
  // Reaplicar 45 segundos depois rouba a conversa da analista que acabou de assumir.
  politicaEmDuvida: 'condicional',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => [], // terminal: a conversa sai do bot

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    if (!c.time && !c.timeId) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.time', 'Nó de encaminhamento sem time de destino deixa a conversa sem dono.', 'Informe o time.'));
    }
    return problemas;
  },

  preparar(no, ctx) {
    const c = no?.config ?? {};
    const intencoes = [];
    // A mensagem de aviso ao cliente é livre, logo inexistente fora da janela; a ATRIBUIÇÃO não
    // depende da janela — é operação no Chatwoot. Com a janela fechada transferimos assim mesmo:
    // a pessoa precisa de um humano, e adiar a transferência porque não dá para avisar é o pior dos
    // dois mundos. A nota de desistência explica ao analista qual dos dois motivos ocorreu.
    if (c.mensagem && janelaAberta(ctx)) {
      const lim = limitesDe(ctx);
      const r = textoDoCampo(c.mensagem, ctx, { teto: lim.valores.corpo_max, campo: 'config.mensagem' });
      intencoes.push({ tipo: 'texto', corpo: r.valor, sufixo: '', _achados: r });
    }
    intencoes.push({ tipo: 'atribuir', timeId: c.timeId ?? null, time: c.time ?? null, sufixo: '' });
    return intencoes;
  },

  async executar(ctx) {
    anotarAchados(ctx, noTime.preparar(ctx.no, ctx).map((i) => i._achados).filter(Boolean));
    ganchos(ctx).registrar({ tipo: 'entregue_humano', noId: ctx?.no?.id });
    return { tipo: 'terminar', estado: 'transferido', time: ctx?.no?.config?.time ?? null };
  },
};

// ── 12b. atendente ──────────────────────────────────────────────────────────────────────────────
// TRANSFERIR PARA UMA PESSOA. Contrato S3 (02/09/2026), doc 34 §F3.3.
//
// ── POR QUE NÃO BASTAVA O NÓ `time` ─────────────────────────────────────────────────────────────
// Até aqui o motor só sabia entregar a conversa a um SETOR. O chat atual tem os dois nós, e a
// diferença não é de conveniência: entregar ao setor é «alguém dali pega»; entregar à pessoa é
// «é com você». Fluxo de carteira de clientes, retorno de chamado e escalonamento nominal precisam
// do segundo — e sem ele o desenhista escrevia o nome da pessoa no texto e torcia.
//
// ── ⚠️ A AMARRA COM O CONTRATO S2 (isolamento) ─────────────────────────────────────────────────
// `RagnabotConversa.cwAssigneeId` é a trava de visibilidade da caixa: transferir para uma pessoa
// MUDA QUEM ENXERGA a conversa. Um nó de fluxo que atribui é, portanto, um nó que concede acesso —
// e é por isso que o destinatário é NOMEADO e resolvido em tempo de execução contra o cadastro de
// atendentes da plataforma, nunca um número solto dentro do documento. Pessoa que saiu da empresa
// deixa de resolver, e a conversa cai no destino alternativo em vez de ficar com um fantasma.
//
// ── A DECISÃO DIFÍCIL: o que fazer quando a pessoa não está lá ──────────────────────────────────
// Três caminhos possíveis, e escolhi o do meio, declarado:
//   (a) atribuir mesmo assim  → a conversa fica com quem está de férias, e ninguém vê;
//   (b) recusar sempre        → a conversa morre com incidente por um detalhe de cadastro;
//   (c) DESTINO ALTERNATIVO   → `timeAlternativo` recebe a conversa, e o resumo do efeito diz qual
//                               dos dois caminhos foi tomado. É o que este nó faz.
// Sem `timeAlternativo` declarado, a falha é BARULHENTA (o adaptador recusa com 422 e o motor abre
// incidente). Falha barulhenta alguém conserta; conversa sem dono ninguém percebe.
const noAtendente = {
  tipo: 'atendente',
  efeito: 'condicional',
  // `atribuir` é escrita de «último a escrever vence» sobre um estado que um humano também edita.
  // Reaplicar 45 segundos depois rouba a conversa de quem acabou de assumir — mesma razão do `time`.
  politicaEmDuvida: 'condicional',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => [], // terminal: a conversa sai do robô e passa a ser de uma pessoa

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};
    const ref = String(c.atendente ?? '').trim();
    if (!ref && !c.atendenteId) {
      problemas.push(erro(
        'ARESTA_AUSENTE', 'config.atendente',
        'Nó de atendente sem destinatário deixa a conversa sem dono.',
        'Escolha o atendente (nome, e-mail ou id na plataforma).',
      ));
    }
    // Número de telefone no lugar do atendente: o defeito D4 tentando entrar por outra porta.
    if (/^\+?\d[\d\s()-]{7,}$/u.test(ref)) {
      problemas.push(erro(
        'ARESTA_AUSENTE', 'config.atendente',
        'Isto parece um número de telefone. O destinatário aqui é um ATENDENTE cadastrado na '
        + 'plataforma — identificado por nome, e-mail ou id.',
        'Escolha a pessoa na lista de atendentes.',
      ));
    }
    if (c.exigirDisponivel === true && !c.timeAlternativo && !c.timeAlternativoId) {
      problemas.push(aviso(
        'ARESTA_AUSENTE', 'config.timeAlternativo',
        'Você exigiu que o atendente esteja disponível, mas não declarou para onde vai a conversa '
        + 'quando ele não estiver. Nesse caso a transferência falha e a conversa fica parada.',
        'Declare um setor alternativo.',
      ));
    }
    if (c.mensagem) {
      const lim = limitesDe(ctx);
      problemas.push(...conferirTeto(c.mensagem, lim.valores.corpo_max, 'config.mensagem', lim, { oQueE: 'O aviso ao cliente' }));
    }
    conferirTemplateDoNo(no, ctx, problemas, { entrega: 'proibido' });
    return problemas;
  },

  preparar(no, ctx) {
    const c = no?.config ?? {};
    const intencoes = [];
    // Mesma regra do `time`: o aviso ao cliente é texto livre e não sai fora da janela de 24 h; a
    // ATRIBUIÇÃO não depende da janela — é operação na plataforma. Adiar a transferência porque não
    // dá para avisar seria o pior dos dois mundos.
    if (c.mensagem && janelaAberta(ctx)) {
      const lim = limitesDe(ctx);
      const r = textoDoCampo(c.mensagem, ctx, { teto: lim.valores.corpo_max, campo: 'config.mensagem' });
      intencoes.push({ tipo: 'texto', corpo: r.valor, sufixo: '', _achados: r });
    }
    intencoes.push({
      tipo: 'atribuir_agente',
      agenteId: c.atendenteId ?? null,
      agente: c.atendente ?? null,
      exigirDisponivel: c.exigirDisponivel === true,
      timeAlternativoId: c.timeAlternativoId ?? null,
      timeAlternativo: c.timeAlternativo ?? null,
      sufixo: '',
    });
    return intencoes;
  },

  async executar(ctx) {
    anotarAchados(ctx, noAtendente.preparar(ctx.no, ctx).map((i) => i._achados).filter(Boolean));
    ganchos(ctx).registrar({ tipo: 'entregue_humano', noId: ctx?.no?.id });
    return { tipo: 'terminar', estado: 'transferido', atendente: ctx?.no?.config?.atendente ?? null };
  },
};

// ── 12c. randomizador ───────────────────────────────────────────────────────────────────────────
// SAÍDAS POR PORCENTAGEM — teste A/B dentro do fluxo. Contrato S3, doc 34 §F3.5.
//
// ── ⚠️ POR QUE O SORTEIO É DETERMINÍSTICO, E NÃO `Math.random()` ────────────────────────────────
// O motor REPETE passos. Um despacho que falha e é retentado volta a executar o nó; um pod que cai
// entre a decisão e o commit reprocessa o evento. Com dado de verdade, a mesma conversa cairia num
// ramo na primeira tentativa e no outro ramo na segunda — e o cliente receberia as duas variantes
// do teste, uma atrás da outra. O sorteio aqui é uma FUNÇÃO da identidade da visita: mesma visita,
// mesma saída, quantas vezes rodar. Sorteio reprodutível não é sorteio pior; é o único que
// sobrevive a retentativa.
//
// ── AS TRÊS ESTABILIDADES, e por que a escolha importa para o resultado do teste ────────────────
//   · `visita`   (padrão) sorteia a cada passagem pelo nó — bom para distribuir carga;
//   · `conversa` fixa o resultado para toda a execução — a pessoa não muda de variante no meio;
//   · `contato`  fixa por PESSOA, entre conversas diferentes — é o único que faz um teste A/B
//                honesto, porque o mesmo cliente vê sempre a mesma variante e a comparação mede a
//                variante, não a alternância.
//
// ── O CASO DE ARREDONDAMENTO, COBERTO E NÃO TORCIDO ────────────────────────────────────────────
// Os pesos viram INTEIROS em centésimos de ponto percentual (33,33 % → 3333). O sorteio é um
// inteiro em [0, 9999]. A ÚLTIMA faixa absorve qualquer resíduo: com 33,33 + 33,33 + 33,34 o total
// fecha 10000 exatamente, mas mesmo que um dia não fechasse, nenhum sorteio cairia no vazio — o
// laço termina sempre na última saída declarada. Um randomizador que às vezes não escolhe nada é
// um fluxo que às vezes morre calado, que é o defeito mais caro deste arquivo inteiro.
const CENTESIMOS = 10000;
const ESTABILIDADES = new Set(['visita', 'conversa', 'contato']);

/** Peso em centésimos de ponto percentual. `33,33` e `33.33` são a mesma coisa para quem digita. */
function pesoEmCentesimos(v) {
  const n = Number(String(v ?? '').toString().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Inteiro em [0, teto) derivado de uma semente estável. Exportado para o teste poder provar a
 * distribuição sem depender do executor inteiro.
 *
 * ⚠️ O `% teto` introduz um viés de módulo da ordem de 1 em 400 mil (2³² não é múltiplo de 10000).
 * Declarado de propósito: para decidir variante de mensagem isso é irrelevante, e trocá-lo por
 * rejeição amostral tornaria o sorteio NÃO determinístico no número de tentativas — que é
 * exatamente a propriedade que este nó precisa preservar.
 */
export function sorteioEstavel(semente, teto = CENTESIMOS) {
  const h = createHash('sha256').update(String(semente), 'utf8').digest();
  const n = h.readUInt32BE(0);
  return n % teto;
}

/** A semente de UMA passagem. PURA — é a regra que decide o ramo, e ela precisa ser lida inteira. */
export function sementeDoRandomizador(ctx, config = {}) {
  const noId = ctx?.no?.id ?? '?';
  const ex = ctx?.execucao ?? {};
  const estabilidade = ESTABILIDADES.has(config.estabilidade) ? config.estabilidade : 'visita';
  // `salto` deixa o operador refazer o sorteio de um teste sem mudar a topologia: trocar o valor
  // redistribui todo mundo. Sem ele, corrigir um teste enviesado exigiria renomear o nó — e
  // renomear nó órfã as conversas em curso.
  const salto = String(config.salto ?? '');
  if (estabilidade === 'contato') {
    // Sem chave de contato não há como fixar por pessoa. Cair em «conversa» é a degradação certa:
    // o teste fica menos rigoroso, mas ninguém recebe duas variantes na mesma conversa.
    const chave = ex.contatoChave ?? ex.cwContactId ?? null;
    if (chave) return `${salto}|contato|${chave}|${noId}`;
    return `${salto}|conversa|${ex.id ?? '?'}|${noId}`;
  }
  if (estabilidade === 'conversa') return `${salto}|conversa|${ex.id ?? '?'}|${noId}`;
  return `${salto}|visita|${ex.id ?? '?'}|${noId}|${ex.visitaSeq ?? 0}`;
}

/**
 * Escolhe a saída a partir das faixas. PURA, e separada do executor de propósito: é o único pedaço
 * do nó em que um erro sai caro, e ela cabe inteira na cabeça.
 */
export function escolherFaixa(saidas, sorteio) {
  let acumulado = 0;
  for (let i = 0; i < saidas.length; i += 1) {
    acumulado += saidas[i].centesimos;
    // A última faixa absorve o resíduo: nenhum sorteio cai no vazio (ver o cabeçalho).
    if (sorteio < acumulado || i === saidas.length - 1) return saidas[i];
  }
  return saidas[saidas.length - 1] ?? null;
}

/** Normaliza a configuração em faixas utilizáveis. Devolve `[]` quando a configuração é inválida. */
function faixasDe(config = {}) {
  const lista = Array.isArray(config.saidas) ? config.saidas : [];
  const faixas = [];
  for (const s of lista) {
    const id = String(s?.id ?? '').trim();
    const c = pesoEmCentesimos(s?.peso);
    if (!id || c === null) return [];
    faixas.push({ id, rotulo: s?.rotulo ?? id, centesimos: c });
  }
  return faixas;
}

const noRandomizador = {
  tipo: 'randomizador',
  // Não toca em nada fora: nem manda mensagem, nem escreve na plataforma. Repetir é inofensivo —
  // e, por ser determinístico, repetir dá o MESMO ramo.
  efeito: 'nenhum',
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: (config) => faixasDe(config).map((f) => f.id),
  // ⚠️ DECLARADA porque `executar()` pode devolvê-la (documento antigo, sem faixas válidas). Foi
  // exatamente por NÃO declarar a saída que emitia que `sem_janela` virou conector indesenhável em
  // `pergunta`/`lista`/`botoes` — e a conversa do cliente morria calada. O teste
  // `tests/ragnabot-nos-novos.test.mjs` pegou esta mesma omissão aqui, antes de publicar.
  saidasDeFalha: [SAIDA_ERRO_INTERNO],

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    const lista = Array.isArray(c.saidas) ? c.saidas : [];

    if (lista.length < 2) {
      problemas.push(erro(
        'ARESTA_AUSENTE', 'config.saidas',
        'Um randomizador com menos de duas saídas não divide nada — é um nó de passagem disfarçado.',
        'Declare pelo menos duas saídas com as respectivas porcentagens.',
      ));
      return problemas;
    }

    const vistos = new Set();
    let soma = 0;
    let todosValidos = true;
    lista.forEach((s, i) => {
      const id = String(s?.id ?? '').trim();
      if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(id)) {
        todosValidos = false;
        problemas.push(erro('ARESTA_AUSENTE', `config.saidas[${i}].id`, `O identificador de saída "${id}" é inválido.`, 'Use letras, números, hífen e sublinhado.'));
      } else if (vistos.has(id)) {
        todosValidos = false;
        problemas.push(erro('ARESTA_AUSENTE', `config.saidas[${i}].id`, `A saída "${id}" está declarada mais de uma vez. Duas faixas com o mesmo nome dariam UMA aresta só, e metade do tráfego sumiria.`, 'Dê um identificador único a cada saída.'));
      }
      vistos.add(id);

      const cent = pesoEmCentesimos(s?.peso);
      if (cent === null) {
        todosValidos = false;
        problemas.push(erro('LIMITE_EXCEDIDO', `config.saidas[${i}].peso`, `A porcentagem de "${id}" não é um número maior ou igual a zero.`, 'Informe a porcentagem, por exemplo 50.'));
      } else {
        soma += cent;
        if (cent > CENTESIMOS) {
          todosValidos = false;
          problemas.push(erro('LIMITE_EXCEDIDO', `config.saidas[${i}].peso`, `A porcentagem de "${id}" passa de 100 %.`, 'Reduza para no máximo 100.'));
        }
      }
    });

    // A soma é COBRADA, não normalizada. Normalizar em silêncio faria «50 + 40» virar «56 + 44» sem
    // ninguém pedir, e o operador leria no editor um número diferente do que o motor aplica.
    if (todosValidos && soma !== CENTESIMOS) {
      problemas.push(erro(
        'LIMITE_EXCEDIDO', 'config.saidas',
        `As porcentagens somam ${(soma / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %, e precisam somar exatamente 100 %.`,
        'Ajuste as porcentagens. Para três saídas iguais use 33,33 · 33,33 · 33,34.',
      ));
    }

    if (c.estabilidade !== undefined && !ESTABILIDADES.has(c.estabilidade)) {
      problemas.push(erro(
        'LIMITE_EXCEDIDO', 'config.estabilidade',
        `Estabilidade desconhecida. Aceitas: ${[...ESTABILIDADES].join(', ')}.`,
        'Use "contato" para um teste A/B de verdade: a mesma pessoa vê sempre a mesma variante.',
      ));
    }
    return problemas;
  },

  preparar() {
    return []; // não fala com ninguém: só decide por onde a conversa segue
  },

  async executar(ctx) {
    const c = ctx?.no?.config ?? {};
    const faixas = faixasDe(c);
    if (faixas.length < 2) {
      // O validador já barra isto na publicação; aqui é a rede para um documento antigo. Falhar por
      // `erro_interno` e não por `erro`: o cliente não pode ser transferido a um humano porque um
      // sorteio de teste A/B está mal configurado.
      return falhar(
        SAIDA_ERRO_INTERNO, 'ERRO_NO',
        'randomizador sem saídas válidas — o documento publicado está fora do contrato',
        mensagemDeFalha(ctx?.no, ctx),
      );
    }
    const semente = sementeDoRandomizador(ctx, c);
    const sorteio = sorteioEstavel(semente);
    const escolhida = escolherFaixa(faixas, sorteio);
    ganchos(ctx).registrar({
      tipo: 'no_saiu', noId: ctx?.no?.id, saida: escolhida.id,
      // O sorteio no detalhe é o que permite auditar a distribuição depois, e reproduzir uma
      // decisão específica. NÃO carrega dado do cliente — só o número.
      detalhe: { sorteio, estabilidade: c.estabilidade ?? 'visita' },
    });
    return { tipo: 'seguir', saida: escolhida.id };
  },
};

// ── 13. notificar ───────────────────────────────────────────────────────────────────────────────
// O fluxo real cravava DOIS celulares dentro do nó, um deles com espaço no fim ("559883351000 ").
// Na API oficial isso não sobrevive: é texto livre para números que não iniciaram conversa, e o caso
// normal é estar fora da janela. Aqui o destinatário é NOMEADO e resolvido em tempo de execução —
// trocar de plantonista deixa de exigir editar o fluxo (D4).

const CANAIS_NOTIFICACAO = new Set(['interno', 'email', 'whatsapp_template']);
const TIPOS_DESTINATARIO = new Set(['papel', 'time', 'usuario']);

const noNotificar = {
  tipo: 'notificar',
  efeito: 'condicional',
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['padrao', SAIDA_ERRO_INTERNO],

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};

    if (!CANAIS_NOTIFICACAO.has(c.canal)) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.canal', `Canal inválido. Aceitos: ${[...CANAIS_NOTIFICACAO].join(', ')}.`, 'Escolha o canal.'));
    }

    const destinatarios = Array.isArray(c.destinatarios) ? c.destinatarios : [];
    if (!destinatarios.length) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.destinatarios', 'Notificação sem destinatário não avisa ninguém e ainda dá a impressão de que avisou.', 'Declare ao menos um destinatário por papel, time ou usuário.'));
    }
    destinatarios.forEach((d, i) => {
      const campo = `config.destinatarios[${i}]`;
      if (!TIPOS_DESTINATARIO.has(d?.tipo)) {
        problemas.push(erro(
          'ARESTA_AUSENTE', `${campo}.tipo`,
          `Tipo de destinatário inválido. Aceitos: ${[...TIPOS_DESTINATARIO].join(', ')}. Número de telefone cravado no fluxo NÃO é aceito.`,
          'Use um papel (por exemplo plantonista_suporte) — assim trocar de plantonista não exige editar o fluxo.',
        ));
      }
      if (!d?.valor || !String(d.valor).trim()) {
        problemas.push(erro('ARESTA_AUSENTE', `${campo}.valor`, 'Destinatário sem valor.', 'Informe o papel, o time ou o usuário.'));
      }
      // Número literal disfarçado de papel: o defeito D4 tentando voltar pela porta dos fundos.
      if (/^\+?\d[\d\s()-]{7,}$/.test(String(d?.valor ?? ''))) {
        problemas.push(erro(
          'ARESTA_AUSENTE', `${campo}.valor`,
          'Isto parece um número de telefone cravado no fluxo. Fora da janela de 24 h a Meta recusa, e quando a pessoa sair da empresa ninguém vai lembrar de editar o fluxo.',
          'Cadastre um papel e aponte o destinatário para ele.',
        ));
      }
    });

    // O canal de alerta do NOC não é destino selecionável por fluxo de cliente, e nem aparece no
    // enum. Qualquer pessoa pode escrever para o número público de atendimento de uma empresa,
    // digitar um texto com cara de alerta de infraestrutura no campo `detalhes`, e esse texto seria
    // despejado no mesmo canal onde o plantonista lê os alertas do Zabbix.
    const alvo = `${c.canal ?? ''} ${JSON.stringify(c.destinatarios ?? [])}`.toLowerCase();
    if (/\bnoc\b|zabbix|alerta[-_ ]?infra/.test(alvo)) {
      problemas.push(erro(
        'DESTINO_NAO_PERMITIDO', 'config.destinatarios',
        'O canal de alertas do NOC não é destino de fluxo de cliente. Texto escrito por quem quer que seja não entra no canal onde o plantonista lê os alertas de infraestrutura.',
        'Use um papel da empresa. Aviso que precise chegar ao NOC vai por canal separado, com prefixo fixo e sem o texto do cliente.',
      ));
    }

    if (c.canal === 'whatsapp_template') {
      if (!c.modelo) {
        problemas.push(erro('TEMPLATE_REPROVADO', 'config.modelo', 'Canal por template sem nome de modelo.', 'Informe o nome do template aprovado na WABA.'));
      } else if (ctx?.templates && Array.isArray(ctx.templates)) {
        const t = ctx.templates.find((x) => x.nome === c.modelo && (!c.idioma || x.idioma === c.idioma));
        if (!t) {
          problemas.push(erro('TEMPLATE_REPROVADO', 'config.modelo', `O template "${c.modelo}" não existe no espelho da WABA desta empresa.`, 'Cadastre e aguarde a aprovação da Meta.'));
        } else if (t.status !== 'aprovado') {
          problemas.push(erro('TEMPLATE_REPROVADO', 'config.modelo', `O template "${c.modelo}" está "${t.status}". Template em análise é fluxo quebrado no ar, e ele quebra exatamente fora da janela de 24 h — que é quando não existe alternativa.`, 'Publique só depois da aprovação.'));
        }
      }
    }

    procurarSegredoLiteral(c, 'config', problemas);
    return problemas;
  },

  /** UM efeito POR destinatário, cada um com `sufixo` próprio: a falha de um não reenvia para o outro. */
  preparar(no, ctx) {
    const c = no?.config ?? {};
    const lim = limitesDe(ctx);
    const destinatarios = Array.isArray(c.destinatarios) ? c.destinatarios : [];
    const destinoEscape = c.canal === 'whatsapp_template' ? 'parametro_template' : 'nota';

    return destinatarios.map((d) => {
      const assunto = interpolar(String(c.assunto ?? ''), ctx?.vars ?? {}, { destino: destinoEscape, teto: lim.valores.cabecalho_max });
      const corpo = interpolar(String(c.corpo ?? c.assunto ?? ''), ctx?.vars ?? {}, { destino: destinoEscape, teto: lim.valores.corpo_max, aoEstourar: 'cortar' });
      const sufixo = `${d.tipo}:${d.valor}`;
      if (c.canal === 'whatsapp_template') {
        return {
          tipo: 'template',
          nome: c.modelo,
          idioma: c.idioma ?? 'pt_BR',
          parametros: (Array.isArray(c.parametros) ? c.parametros : []).map(
            (p) => interpolar(String(p), ctx?.vars ?? {}, { destino: 'parametro_template' }).valor,
          ),
          destinatario: d,
          sufixo,
          _achados: [assunto, corpo],
        };
      }
      return {
        tipo: 'nota',
        privada: c.canal === 'interno',
        canal: c.canal,
        destinatario: d,
        assunto: assunto.valor,
        corpo: corpo.valor,
        sufixo,
        _achados: [assunto, corpo],
      };
    });
  },

  async executar(ctx) {
    const intencoes = noNotificar.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.flatMap((i) => i._achados ?? []));

    // Falha de aviso interno NÃO derruba a conversa do cliente: as intenções são marcadas como
    // internas (tipo `nota`/`template` com destinatário) e a T2 do motor rerroteia por
    // `erro_interno`. É a separação escrita no §4.4 — o cliente não pode ser transferido a um humano
    // porque o plantonista não recebeu uma mensagem.
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

// ── 14. subfluxo ────────────────────────────────────────────────────────────────────────────────
// A6: `chamar` empilha e volta; `saltar` substitui o quadro do topo e NÃO volta. O fluxo real usa
// `saltar` nas duas chamadas — `fluxoNode` entrega o controle e não retorna. Sem o modo explícito,
// metade das migrações escolheria o comportamento errado em silêncio.
const noSubfluxo = {
  tipo: 'subfluxo',
  efeito: 'nenhum',
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: (config) => (config?.modo === 'chamar' ? ['padrao'] : []),

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};
    if (c.modo !== 'chamar' && c.modo !== 'saltar') {
      problemas.push(erro(
        'ARESTA_AUSENTE', 'config.modo',
        'O modo do sub-fluxo é obrigatório e não tem padrão seguro: "chamar" volta ao fim, "saltar" entrega o controle e não volta. Escolher errado troca o fim da conversa.',
        'Declare "modo": "chamar" ou "modo": "saltar".',
      ));
    }
    if (!c.fluxoId) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.fluxoId', 'Sub-fluxo sem destino.', 'Escolha o fluxo de destino.'));
    }
    // A travessia é sempre resolvida COM A EMPRESA JUNTO — na publicação, na execução e ao retomar
    // uma execução que já tem pilha gravada, porque a versão pode ter sido arquivada desde então.
    if (ctx?.fluxosDaEmpresa && Array.isArray(ctx.fluxosDaEmpresa) && c.fluxoId
        && !ctx.fluxosDaEmpresa.includes(String(c.fluxoId))) {
      problemas.push(erro(
        'DESTINO_NAO_PERMITIDO', 'config.fluxoId',
        'O sub-fluxo aponta para um fluxo que não é desta empresa. É por junção cruzada assim que dados de um cliente aparecem na conversa de outro.',
        'Escolha um fluxo da própria empresa.',
      ));
    }
    return problemas;
  },

  preparar() {
    return [];
  },

  async executar(ctx) {
    const c = ctx?.no?.config ?? {};
    ganchos(ctx).registrar({ tipo: 'no_saiu', noId: ctx?.no?.id, saida: c.modo === 'chamar' ? 'padrao' : 'saltou' });
    return { tipo: 'saltar', fluxoId: String(c.fluxoId), modo: c.modo === 'chamar' ? 'chamar' : 'saltar' };
  },
};

// ── 15. chamado ─────────────────────────────────────────────────────────────────────────────────
// ABRIR CHAMADO — o chamado passa a nascer DENTRO do Ragnabot.
//
// A numeração NÃO é reimplementada aqui: quem emite é `ragnabot-protocolo.service.emitirProtocolo`,
// que já é atômico no contador (UPDATE incremental dentro da transação) e idempotente por conversa
// (`@@unique([cwAccountId, cwConversationId])`), e já provou isso em produção. Este nó grava o número
// nas variáveis, carimba a conversa e aplica a etiqueta de relatório (D8).
//
// O registro do chamado num sistema externo, quando existir, é papel do nó `http` — com
// `sucessoQuando` — e não deste. A separação é intencional: o protocolo é NOSSO e sai sempre; o
// registro de terceiro pode falhar, e é justamente por confundir os dois que o fluxo antigo dizia
// «chamado registrado com sucesso» sem prova de sucesso.
const noChamado = {
  tipo: 'chamado',
  efeito: 'repetivel',        // emitir é idempotente por conversa; repetir devolve o mesmo número
  politicaEmDuvida: 'seguir',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['padrao', 'erro'],

  validar(no) {
    const problemas = [];
    const c = no?.config ?? {};
    const para = c.para ?? 'protocolo';
    if (!/^[\p{L}\p{N}_]+$/u.test(String(para))) {
      problemas.push(erro('VARIAVEL_AUSENTE', 'config.para', 'Nome de variável inválido para guardar o protocolo.', 'Use letras, números e sublinhado — "protocolo" é o nome de referência.'));
    }
    for (const [i, e] of (Array.isArray(c.etiquetas) ? c.etiquetas : []).entries()) {
      if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(String(e))) {
        problemas.push(erro('ARESTA_AUSENTE', `config.etiquetas[${i}]`, `A etiqueta "${e}" tem caracteres que o Chatwoot recusa.`, 'Use letras, números, hífen e sublinhado.'));
      }
    }
    if (Array.isArray(c.camposObrigatorios)) {
      for (const [i, v] of c.camposObrigatorios.entries()) {
        if (!/^[\p{L}\p{N}_.]+$/u.test(String(v))) {
          problemas.push(erro('VARIAVEL_AUSENTE', `config.camposObrigatorios[${i}]`, 'Nome de variável inválido.', 'Use o nome da variável, sem chaves.'));
        }
      }
    }
    return problemas;
  },

  preparar(no, ctx) {
    const c = no?.config ?? {};
    // A prévia mostra a etiqueta que vai colar; o número ainda não existe e dizer um número na prévia
    // seria inventar um protocolo que ninguém emitiu.
    const intencoes = [];
    if (Array.isArray(c.etiquetas) && c.etiquetas.length) {
      intencoes.push({ tipo: 'etiqueta', aplicar: c.etiquetas.map(String), remover: [], sufixo: '' });
    }
    if (c.notaInterna !== false) {
      const nota = interpolar(String(c.notaInterna ?? 'Chamado aberto pelo robô.'), ctx?.vars ?? {}, { destino: 'nota' });
      intencoes.push({ tipo: 'nota', privada: true, corpo: nota.valor, sufixo: 'chamado' });
    }
    // O carimbo entra por último e só quando já há número: o motor aplica o `varsPatch` de
    // `executar()` ao contexto ANTES de chamar esta função, então na execução real o protocolo já
    // está em `ctx.vars`. Na prévia do editor não está, e carimbar um número inexistente seria
    // inventar um protocolo que ninguém emitiu.
    const protocolo = ctx?.vars?.[c.para ?? 'protocolo'] ?? ctx?.execucao?.protocolo ?? null;
    if (protocolo) {
      intencoes.push(intencaoDeCarimbo({
        rgt_protocolo: protocolo,
        rgt_fluxo: ctx?.execucao?.fluxoId ?? null,
        rgt_fluxo_versao: ctx?.execucao?.versaoId ?? null,
        rgt_no_atual: no?.id ?? ctx?.no?.id ?? null,
        rgt_resultado: 'chamado_aberto',
      }));
    }
    return intencoes;
  },

  async executar(ctx) {
    const { registrar, incidente } = ganchos(ctx);
    const c = ctx?.no?.config ?? {};
    const para = c.para ?? 'protocolo';

    // Recusa honesta ANTES de emitir número: abrir chamado sem o que o operador declarou obrigatório
    // produz um chamado que nasce vazio e volta para o cliente como pergunta repetida.
    const faltando = (Array.isArray(c.camposObrigatorios) ? c.camposObrigatorios : [])
      .filter((v) => {
        const valor = lerCaminho(ctx?.vars ?? {}, v);
        return valor === undefined || valor === null || String(valor).trim() === '';
      });
    if (faltando.length) {
      incidente('VARIAVEL_AUSENTE', { noId: ctx?.no?.id, variaveis: faltando, observacao: 'Chamado não aberto: campos obrigatórios vazios.' });
      return falhar(
        'erro', 'VARIAVEL_AUSENTE',
        `O chamado não foi aberto porque estes campos estão vazios: ${faltando.join(', ')}.`,
        mensagemDeFalha(ctx?.no, ctx),
      );
    }

    let emitido;
    try {
      emitido = await garantirProtocolo(ctx);
    } catch (e) {
      incidente('SEGREDO_AUSENTE', { noId: ctx?.no?.id, observacao: `Emissão de protocolo falhou: ${e?.message ?? e}` });
      return falhar(
        'erro', 'SEGREDO_AUSENTE',
        `Não foi possível emitir o protocolo: ${e?.message ?? e}. Provável causa: a empresa não tem prefixo de protocolo definido (RGT, por exemplo).`,
        mensagemDeFalha(ctx?.no, ctx),
      );
    }

    const varsPatch = { [para]: emitido.protocolo };

    // Carimbo, etiqueta e nota saem como INTENÇÕES de `preparar()`, despachadas pelo motor depois do
    // commit. São melhor esforço por natureza: um chamado com número já emitido não pode ser
    // desfeito porque um rótulo de relatório não colou.
    registrar({ tipo: 'no_saiu', noId: ctx?.no?.id, saida: 'padrao', detalhe: { protocoloNovo: !!emitido.novo } });
    return { tipo: 'seguir', saida: 'padrao', varsPatch };
  },
};

// ── 16. encerrar ────────────────────────────────────────────────────────────────────────────────
const noEncerrar = {
  tipo: 'encerrar',
  efeito: 'condicional',
  // `resolver` é escrita de «último a escrever vence» sobre estado que um humano edita. Reaplicar
  // depois fecha a conversa embaixo da analista que acabou de assumir.
  politicaEmDuvida: 'condicional',
  estaciona: false,
  aceitaModeloFora: true,

  saidas: () => [], // terminal

  validar(no, ctx) {
    const problemas = [];
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const corpo = c.corpo;
    const texto = corpo && typeof corpo === 'object' ? corpo.texto : corpo;
    if (texto) {
      problemas.push(...conferirTeto(texto, lim.valores.corpo_max, 'config.corpo', lim, { oQueE: 'A despedida' }));
      conferirReservas(texto, lim.valores.corpo_max, 'config.corpo', corpo?.reserva, lim, problemas);
    }
    if (c.avaliacao && c.avaliacao.ativa && !c.avaliacao.pergunta) {
      problemas.push(erro('LIMITE_EXCEDIDO', 'config.avaliacao.pergunta', 'Avaliação ligada sem pergunta.', 'Escreva a pergunta ou desligue a avaliação.'));
    }
    if (Array.isArray(c.etiquetas)) {
      c.etiquetas.forEach((e, i) => {
        if (!/^[\p{L}\p{N}_-]{1,64}$/u.test(String(e))) {
          problemas.push(erro('ARESTA_AUSENTE', `config.etiquetas[${i}]`, `A etiqueta "${e}" tem caracteres que o Chatwoot recusa.`, 'Use letras, números, hífen e sublinhado.'));
        }
      });
    }
    return problemas;
  },

  preparar(no, ctx) {
    const lim = limitesDe(ctx);
    const c = no?.config ?? {};
    const intencoes = [];
    // Fora da janela a despedida não sai, mas resolver a conversa e etiquetar continuam valendo:
    // são operações no Chatwoot, não mensagens à Meta. Deixar a conversa aberta porque não deu para
    // se despedir empilharia conversa morta na fila do atendimento humano.
    const corpo = c.corpo && janelaAberta(ctx)
      ? textoDoCampo(c.corpo, ctx, { teto: lim.valores.corpo_max, campo: 'config.corpo' })
      : null;
    if (corpo) intencoes.push({ tipo: 'texto', corpo: corpo.valor, sufixo: '', _achados: corpo });
    if (Array.isArray(c.etiquetas) && c.etiquetas.length) {
      intencoes.push({ tipo: 'etiqueta', aplicar: c.etiquetas.map(String), remover: [], sufixo: '' });
    }
    intencoes.push(intencaoDeCarimbo({
      rgt_no_atual: no?.id ?? ctx?.no?.id ?? null,
      rgt_resultado: c.resultado ?? 'concluido',
      rgt_protocolo: ctx?.vars?.protocolo ?? ctx?.execucao?.protocolo ?? null,
    }));
    // `resolver` por último e SEMPRE depois do carimbo: o motor lê o estado da conversa
    // imediatamente antes de despachar cada efeito condicional, e fechar antes de carimbar deixaria
    // o atendente com uma conversa resolvida sem o rastro de por onde a pessoa passou.
    if (c.resolver !== false) intencoes.push({ tipo: 'resolver', sufixo: '' });
    return intencoes;
  },

  async executar(ctx) {
    anotarAchados(ctx, noEncerrar.preparar(ctx.no, ctx).map((i) => i._achados).filter(Boolean));
    ganchos(ctx).registrar({ tipo: 'no_saiu', noId: ctx?.no?.id, saida: 'concluido' });
    return { tipo: 'terminar', estado: 'concluido' };
  },
};

// ── 17. email ───────────────────────────────────────────────────────────────────────────────────
// O bot medido em produção tem `emailNode` na paleta, e ele NÃO é o nó `notificar`: `notificar`
// avisa GENTE DA CASA por papel/time/usuário («o plantonista precisa saber»), e por isso recusa
// endereço cravado no fluxo. Este aqui manda e-mail PARA O ENDEREÇO QUE A CONVERSA PRODUZIU — a
// confirmação de abertura com o número do protocolo, o resumo do que a pessoa pediu, o comprovante.
// São duas necessidades diferentes, com dois modelos de destinatário diferentes; fundi-las obrigaria
// uma das duas a mentir sobre para quem escreve.
//
// ─── POR QUE ESTE NÓ NÃO CONFERE A JANELA DE 24 H ──────────────────────────────────────────────
// Porque e-mail não passa pela Meta. Copiar a guarda de `texto`/`lista` faria o nó recusar-se a
// escrever exatamente quando o WhatsApp está fechado — que é justamente quando o e-mail é a única
// voz que restou para falar com o cliente.
//
// ─── A PORTA ────────────────────────────────────────────────────────────────────────────────────
// O envio é `sendEmail()` de `src/services/smtp.service.js`, alcançado pela porta `ctx.email` com
// import dinâmico como último degrau — o MESMO desenho de `garantirProtocolo()`. Sem a porta, todo
// teste deste nó mandaria e-mail de verdade, e teste que manda e-mail de verdade é teste que ninguém
// roda duas vezes.
//
// ⚠️ E O ENVIO NÃO ACONTECE DENTRO DE `executar()` — REGRA R1. SMTP é rede; rede dentro da T1
// seguraria a trava da linha da execução pelo tempo do servidor de e-mail. `preparar()` monta a
// intenção `{tipo:'email'}`, o motor reserva o efeito, e o despacho (depois do COMMIT) chama
// `enviarEmailDaIntencao()`, exportada no fim deste arquivo para a porta do canal usar em uma linha.

/**
 * Tetos deste bloco. NÃO entram em `PERFIL_LIMITES_PADRAO` de propósito: aquele perfil é a régua da
 * META, medida (ou palpitada) contra o WhatsApp, e e-mail não tem nada com a Meta. Misturar os dois
 * faria uma calibração do WhatsApp mexer no assunto de um e-mail, sem ninguém entender por quê.
 *
 * O assunto em 200 é escolha nossa: o RFC 5322 recomenda linha de cabeçalho até 78 caracteres e
 * exige dobra acima de 998, e cliente de e-mail corta o assunto na tela bem antes disso.
 */
const LIMITES_EMAIL = Object.freeze({
  assunto_max: 200,
  corpo_max: 50000,
  // `para` e `copiaOculta` são TEXTO com endereços separados por vírgula (é o formato que o editor
  // grava). Os tetos são nossos: acima disso o bloco deixou de ser "avisar o cliente" e virou
  // disparo em massa, que é outro produto e tem outras regras (descadastro, reputação de remetente).
  destinatarios_max: 10,
  copias_max: 10,
});

/**
 * Endereço "bom o bastante". Não é o RFC 5322 inteiro — validar e-mail pelo RFC é um exercício que
 * termina aceitando coisas que nenhum servidor entrega. O que precisamos garantir é o que quebra na
 * prática: tem arroba, tem domínio com ponto, e não tem espaço nem os caracteres que viram sintaxe
 * de cabeçalho (`<`, `>`, `"`, `,`, `;`).
 */
const RE_ENDERECO = /^[^\s@<>",;]+@[^\s@<>",;.]+(\.[^\s@<>",;.]+)+$/u;

/** Aceita array ou texto com vírgula/ponto-e-vírgula — que é como o operador digita. */
function separarEnderecos(valor) {
  if (valor == null || valor === '') return [];
  const bruto = Array.isArray(valor) ? valor : String(valor).split(/[;,]/u);
  return bruto.map((v) => String(v ?? '').trim()).filter(Boolean);
}

/**
 * Confere UM endereço, respeitando o pedido do contrato: «`para` sem `@` DEPOIS DE INTERPOLAR é erro
 * de validação, não de execução».
 *
 * Os três casos, e por que cada um se comporta assim:
 *  • sem variável        → dá para julgar agora, e julgamos. `fulano.exemplo.com` é recusado na
 *                          publicação, que é onde o conserto custa um clique.
 *  • com variável E com `ctx.vars` (modo de teste, prévia com valores) → interpolamos e julgamos o
 *                          RESULTADO. É literalmente «depois de interpolar».
 *  • com variável e SEM valores (publicação) → não há o que julgar sem inventar. Fica para a guarda
 *                          de `executar()`, que recusa antes de qualquer envio.
 */
function conferirEnderecos(bruto, campo, problemas, { ctx, obrigatorio = false, oQueE = 'O destinatário', maximo = null } = {}) {
  const cru = String(bruto ?? '').trim();
  if (!cru) {
    if (obrigatorio) {
      problemas.push(erro(
        'EMAIL_DESTINO_INVALIDO', campo,
        `${oQueE} do e-mail está vazio. Sem endereço não há para quem mandar, e o nó falharia em execução — depois de o cliente já ter sido avisado de que receberia um e-mail.`,
        'Informe o endereço, ou a variável que o carrega (por exemplo {{email_do_contato}}).',
      ));
    }
    return [];
  }

  // INTERPOLA PRIMEIRO, SEPARA DEPOIS — e a ordem importa. Uma variável sozinha pode trazer dois
  // endereços dentro («{{copias}}» → "a@x.com, b@y.com"); separar antes deixaria isso passar como um
  // "endereço" só, que nenhum servidor entrega.
  const temVariavel = /\{\{/u.test(cru);
  const resolvido = temVariavel && ctx?.vars
    ? String(interpolar(cru, ctx.vars, { destino: 'cabecalho_email' }).valor ?? '').trim()
    : cru;
  const lista = separarEnderecos(resolvido);

  if (temVariavel && !lista.length) return []; // variável não resolvida na prévia — a execução cobre

  if (Number.isFinite(maximo) && lista.length > maximo) {
    problemas.push(erro(
      'EMAIL_DESTINO_INVALIDO', campo,
      `São ${lista.length} endereços e o teto deste campo é ${maximo}. Acima disso um fluxo vira lista de distribuição sem ninguém ter decidido isso.`,
      'Crie uma lista de distribuição no servidor de e-mail e ponha o endereço dela aqui.',
    ));
  }

  lista.forEach((e, i) => {
    if (/\{\{/u.test(e)) return;            // esqueleto puro: só o motor conhece o valor final
    if (!RE_ENDERECO.test(e)) {
      problemas.push(erro(
        'EMAIL_DESTINO_INVALIDO', lista.length > 1 ? `${campo}[${i}]` : campo,
        `${oQueE} resolveu para "${e}", que não é um endereço de e-mail — falta o "@" ou o domínio.`,
        'Escreva o endereço completo (nome@dominio.com.br) ou aponte para a variável que o carrega. Vários endereços vão separados por vírgula.',
      ));
    }
  });
  return lista;
}

/**
 * Texto puro → HTML seguro.
 *
 * Escapa o texto INTEIRO uma única vez e só então troca a quebra de linha por `<br>`. Escapar a
 * variável na interpolação e o resto não deixaria a metade do operador crua; escapar as duas pontas
 * em passadas diferentes daria escape duplo (`&amp;amp;`). Uma passada, no fim, resolve as duas.
 *
 * E ISTO NÃO É PRECIOSISMO: o corpo interpola `{{detalhes}}`, que é texto digitado por quem escreveu
 * para o número da empresa. Sem escape, `<img src=x onerror=...>` digitado no WhatsApp chega como
 * HTML vivo na caixa de quem receber o e-mail.
 */
function paraHtml(texto) {
  const escapado = String(texto ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">'
    + escapado.replace(/\n/gu, '<br>')
    + '</div>';
}

const noEmail = {
  tipo: 'email',
  // IRREPETÍVEL: e-mail enviado não volta. Reenviar por dúvida de despacho duplica a caixa de quem
  // recebe — e num comprovante de chamado, dois e-mails com o mesmo protocolo é o cliente ligando
  // para perguntar se abriram dois chamados.
  efeito: 'irrepetivel',
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  // Não se aplica: o campo fala de template da Meta, e este nó não passa pela Meta.
  aceitaModeloFora: false,

  saidas: () => ['padrao', 'erro'],

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};

    // ⚠️ `para` É TEXTO, e pode carregar VÁRIOS endereços separados por vírgula — é assim que a tela
    // do editor grava, e aceitar array só faria as duas metades divergirem na primeira migração.
    conferirEnderecos(c.para, 'config.para', problemas, {
      ctx, obrigatorio: true, maximo: LIMITES_EMAIL.destinatarios_max,
    });

    if (!String(c.assunto ?? '').trim()) {
      problemas.push(erro(
        'EMAIL_SEM_ASSUNTO', 'config.assunto',
        'E-mail sem assunto. Cliente de e-mail mostra "(sem assunto)" e filtro de spam trata pior — o comprovante que o cliente esperava pode nem chegar à caixa de entrada.',
        'Escreva o assunto, por exemplo "Chamado {{protocolo}} registrado".',
      ));
    } else if (medir(String(c.assunto)).piorCaso > LIMITES_EMAIL.assunto_max) {
      // AVISO, não erro, e com a frase certa: aqui NÃO é a Meta que recusa — `conferirTeto()` fala em
      // nome dela e diria «a Meta recusa a mensagem inteira», o que seria simplesmente falso num
      // e-mail. O que acontece de verdade é o cliente de e-mail cortar o assunto na tela, e o nosso
      // `preparar()` cortar antes disso, com reticências.
      problemas.push(aviso(
        'LIMITE_EXCEDIDO', 'config.assunto',
        `O assunto tem ${medir(String(c.assunto)).piorCaso} caracteres para o teto de ${LIMITES_EMAIL.assunto_max} deste bloco. Ele será cortado com reticências; nenhum cliente de e-mail mostra um assunto desse tamanho inteiro.`,
        'Encurte o assunto, e deixe o detalhe para o corpo.',
      ));
    }

    if (!String(c.corpo ?? '').trim()) {
      problemas.push(erro(
        'EMAIL_SEM_CORPO', 'config.corpo',
        'E-mail sem corpo. O cliente recebe uma mensagem em branco com o nome da empresa no remetente.',
        'Escreva o texto do e-mail. Ele aceita variáveis, como {{protocolo}} e {{detalhes}}.',
      ));
    } else if (medir(String(c.corpo)).piorCaso > LIMITES_EMAIL.corpo_max) {
      problemas.push(aviso(
        'LIMITE_EXCEDIDO', 'config.corpo',
        `O corpo tem ${medir(String(c.corpo)).piorCaso} caracteres para o teto de ${LIMITES_EMAIL.corpo_max} deste bloco. O texto será cortado com reticências.`,
        'Encurte o texto fixo, ou mande o detalhe por anexo/link em vez de despejá-lo no corpo.',
      ));
    }
    // ⚠️ E POR QUE NÃO HÁ `conferirReservas` NO CORPO, diferente de `texto`/`lista`/`botoes`:
    // lá a reserva existe porque a Meta RECUSA A MENSAGEM INTEIRA acima do teto — a mensagem não sai,
    // o cliente não recebe nada, e por isso publicar sem reserva é publicar no escuro. Aqui o teto é
    // NOSSO, o excedente é CORTADO por `interpolar()` (`aoEstourar` padrão) e o e-mail sai do mesmo
    // jeito, com o fim do texto encurtado e um incidente de corte registrado. Exigir reserva por
    // variável num corpo de 50 000 caracteres seria burocracia sem defeito correspondente — e regra
    // sem defeito por trás é a que o operador aprende a contornar.

    if (c.responderPara) {
      // Um só: "responder para" com dois endereços é ambiguidade que cliente de e-mail resolve
      // sozinho, cada um do seu jeito.
      conferirEnderecos(c.responderPara, 'config.responderPara', problemas, {
        ctx, oQueE: 'O endereço de resposta', maximo: 1,
      });
    }

    conferirEnderecos(c.copiaOculta, 'config.copiaOculta', problemas, {
      ctx, oQueE: 'O endereço em cópia oculta', maximo: LIMITES_EMAIL.copias_max,
    });

    // O mesmo motivo do nó `notificar`: documento de fluxo viaja em exportação e backup, e é lido
    // por quem edita.
    procurarSegredoLiteral(c, 'config', problemas);

    // AVISO DE ABUSO (julgamento, classe B). Com destinatário E corpo vindos inteiros de variável, o
    // nó vira um relé: qualquer pessoa que escreva para o número público da empresa dita para quem a
    // nossa infraestrutura manda e-mail e o que vai escrito nele. Não bloqueia — há uso legítimo
    // (confirmar para o endereço que a própria pessoa acabou de informar) —, mas não pode ser mudo.
    const paraSoVariavel = /^\s*\{\{\{?\s*[\p{L}\p{N}_.]+\s*\}?\}\}\s*$/u.test(String(c.para ?? ''));
    if (paraSoVariavel && coletarVariaveis(String(c.corpo ?? '')).length) {
      problemas.push(aviso(
        'EMAIL_RELE_ABERTO', 'config.para',
        'O destinatário e o texto deste e-mail vêm inteiros de variáveis preenchidas na conversa. Quem escrever para o número da empresa escolhe para quem o nosso servidor manda e-mail e o que vai escrito nele.',
        'Peça o endereço num nó "pergunta" com validação "email", e mantenha no corpo um esqueleto fixo com as variáveis reservadas — assim o texto livre do cliente entra num campo, não na mensagem inteira.',
      ));
    }

    return problemas;
  },

  /**
   * Monta o e-mail SEM enviar (R1). É a MESMA função da prévia do editor: o operador vê na tela o
   * assunto e o corpo exatamente como sairão, inclusive já interpolados.
   */
  preparar(no, ctx) {
    const c = no?.config ?? {};
    const vars = ctx?.vars ?? {};
    const achados = [];

    const para = interpolar(String(c.para ?? ''), vars, { destino: 'cabecalho_email' });
    achados.push({ ...para, campo: 'config.para' });

    // ⚠️ O TETO NÃO VAI PARA `interpolar()` AQUI, DE PROPÓSITO, e o motivo é uma frase.
    // Quando `interpolar` corta por teto, ele pendura o sufixo padrão da casa —
    // «… (texto completo registrado no chamado)». Num assunto de e-mail isso é uma mentira em duas
    // camadas: promete um chamado que este nó não abriu, e ainda consome os últimos caracteres do
    // assunto para dizê-lo. Cortamos depois, com reticências simples, e `cortarComAchado` registra o
    // corte no mesmo formato que `anotarAchados()` já lê — o incidente não se perde.
    const assunto = interpolar(String(c.assunto ?? ''), vars, { destino: 'cabecalho_email' });
    achados.push({ ...assunto, campo: 'config.assunto' });

    const corpo = interpolar(String(c.corpo ?? ''), vars, { destino: 'email' });
    achados.push({ ...corpo, campo: 'config.corpo' });

    const responderPara = c.responderPara
      ? String(interpolar(String(c.responderPara), vars, { destino: 'cabecalho_email' }).valor ?? '').trim()
      : undefined;

    // Mesma ordem do validador: interpola o texto INTEIRO e só então separa por vírgula.
    const copiaOculta = separarEnderecos(
      String(interpolar(String(c.copiaOculta ?? ''), vars, { destino: 'cabecalho_email' }).valor ?? ''),
    );

    const listaPara = separarEnderecos(String(para.valor ?? ''));
    const destino = listaPara.join(', ');
    const textoCorpo = cortarComAchado(String(corpo.valor ?? ''), LIMITES_EMAIL.corpo_max, {
      unidade: 'piorCaso', campo: 'config.corpo', sufixo: '…', achados,
    });

    return [{
      tipo: 'email',
      // `para` sai como TEXTO (é o que o `to` do nodemailer aceita direto) e `paraLista` como array,
      // para quem despacha não precisar separar de novo — e não errar a separação de um jeito
      // diferente do nosso.
      para: destino,
      paraLista: listaPara,
      assunto: cortarComAchado(String(assunto.valor ?? ''), LIMITES_EMAIL.assunto_max, {
        unidade: 'piorCaso', campo: 'config.assunto', sufixo: '…', achados,
      }),
      // As duas formas viajam juntas: `sendEmail()` manda as duas partes na mesma mensagem e o
      // cliente de e-mail escolhe. Gerar só HTML deixaria quem lê em texto puro com um amontoado de
      // etiquetas; gerar só texto perderia a quebra de linha em metade dos leitores.
      corpoTexto: textoCorpo,
      corpoHtml: paraHtml(textoCorpo),
      responderPara,
      copiaOculta: copiaOculta.length ? copiaOculta : undefined,
      // O sufixo entra na chave do efeito. Com o destino dentro dele, dois nós de e-mail na mesma
      // visita (um para o cliente, outro para o setor) não colidem numa chave só.
      sufixo: `email:${destino}`,
      _achados: achados,
    }];
  },

  async executar(ctx) {
    const intencoes = noEmail.preparar(ctx.no, ctx);
    anotarAchados(ctx, achadosDas(intencoes));
    const i = intencoes[0];

    // A guarda do endereço que só existe em tempo de execução: `{{email_do_contato}}` passou na
    // publicação porque ninguém podia julgá-lo, e agora ele resolveu para algo que nenhum servidor
    // entrega. Recusar AQUI, antes do despacho, dá ao operador o valor exato no incidente — em vez
    // de um "550 relaying denied" do servidor de e-mail, três horas depois, sem contexto nenhum.
    const destinos = Array.isArray(i?.paraLista) ? i.paraLista : separarEnderecos(i?.para);
    const invalidos = destinos.filter((e) => !RE_ENDERECO.test(e));
    if (!destinos.length || invalidos.length) {
      return falhar(
        'erro', 'EMAIL_DESTINO_INVALIDO',
        `O destinatário do e-mail resolveu para "${String(i?.para ?? '')}", e ${!destinos.length ? 'não sobrou endereço nenhum' : `${invalidos.map((e) => `"${e}"`).join(', ')} não é endereço válido`}. Nada foi enviado.`
        + ' A variável usada em "para" veio vazia ou com um valor que não é e-mail.',
        mensagemDeFalha(ctx?.no, ctx),
      );
    }

    ganchos(ctx).registrar({ tipo: 'mensagem_enviada', noId: ctx?.no?.id, detalhe: { canal: 'email' } });
    // R2: a transição PRETENDIDA. Se o SMTP recusar depois do commit, a T2 do motor rerroteia por
    // `erro` — e é por isso que `saidas()` declara essa saída.
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

/**
 * A PORTA DE E-MAIL, nos mesmos três degraus de `garantirProtocolo()`:
 *   1. `ctx.email` com `sendEmail` — o que o teste e o modo de teste injetam;
 *   2. `ctx.email` como FUNÇÃO — açúcar para quem só quer passar um dublê de uma linha;
 *   3. import dinâmico de `smtp.service.js` — o caminho de produção.
 *
 * Dinâmico, e não estático, pela mesma razão dos utilitários lá de cima: `validar()` e `preparar()`
 * precisam rodar num processo sem SMTP configurado (a prévia do editor é um deles), e um import
 * estático arrastaria o transportador para dentro de todo processo que apenas carrega o catálogo.
 */
async function portaDeEmail(ctx) {
  if (typeof ctx?.email?.sendEmail === 'function') return ctx.email;
  if (typeof ctx?.email === 'function') return { sendEmail: ctx.email };
  return await import('./smtp.service.js');
}

/**
 * DESPACHO da intenção `email`. É chamada DEPOIS DO COMMIT, pela porta do canal — nunca de dentro de
 * `executar()`, que roda na transação curta (R1).
 *
 * Devolve o formato que `despacharEConfirmar()` já sabe confirmar (`idExterno`, `resumo`), para o
 * adaptador do canal ser uma linha:
 *     if (intencao.tipo === 'email') return enviarEmailDaIntencao(intencao, ctx);
 *
 * ⚠️ LIMITE REAL, MEDIDO HOJE: o `sendEmail()` do NOC aceita `{to, subject, html, text,
 * attachments}` e NADA MAIS — ele não repassa `replyTo` nem `bcc` ao nodemailer. Os dois campos são
 * enviados aqui assim mesmo, porque o dia em que o `smtp.service.js` ganhar as duas linhas eles
 * passam a valer sem ninguém precisar voltar neste arquivo. Até lá, `responderPara` e `copiaOculta`
 * são CONFIGURÁVEIS E IGNORADOS pelo transporte — e isso está dito no documento de entrega, não
 * escondido num campo que parece funcionar.
 */
export async function enviarEmailDaIntencao(intencao, ctx = {}) {
  if (intencao?.tipo !== 'email') {
    throw new Error(`enviarEmailDaIntencao recebeu uma intenção "${intencao?.tipo}" — ela só despacha "email".`);
  }
  const destinos = Array.isArray(intencao.paraLista) ? intencao.paraLista : separarEnderecos(intencao.para);
  if (!destinos.length || destinos.some((d) => !RE_ENDERECO.test(d))) {
    // Cinto e suspensório: `executar()` já recusou, mas quem despacha pode receber uma intenção
    // reconstruída de uma linha antiga de `RagnabotFluxoEfeito`.
    const e = new Error(`destinatário inválido: "${intencao.para}"`);
    e.codigo = 'EMAIL_DESTINO_INVALIDO';
    throw e;
  }
  const porta = await portaDeEmail(ctx);
  const r = await porta.sendEmail({
    // Texto com vírgula: é o formato que o nodemailer aceita direto em `to`.
    to: destinos.join(', '),
    subject: intencao.assunto,
    html: intencao.corpoHtml,
    text: intencao.corpoTexto,
    ...(intencao.responderPara ? { replyTo: intencao.responderPara } : {}),
    ...(intencao.copiaOculta?.length ? { bcc: intencao.copiaOculta.join(', ') } : {}),
  });
  return {
    idExterno: r?.messageId ?? null,
    // NUNCA o corpo: o resumo vai para `RagnabotFluxoEfeito.resposta`, e ali não entra texto do
    // cliente (LGPD, a mesma regra do evento `opcao_invalida`).
    resumo: r?.response ? String(r.response).slice(0, 200) : null,
  };
}

// ── 18. agente_ia (o "Capitão") ─────────────────────────────────────────────────────────────────
// S5 / doc 34 §2.C.6 — o nó "passar ao agente de IA".
//
// A FRONTEIRA, em uma frase: o fluxo atende primeiro; ESTE nó é o convite formal para a IA entrar,
// e ele existe justamente para que a IA nunca entre sem convite. Quem decide se ela pode falar é
// `ragnabot-capitao.service.decidirQuemResponde()` — uma regra escrita uma vez só.
//
// ⚠️ POR QUE ELE AGUARDA (motivo `http`), e não responde na hora: perguntar ao agente é chamada de
// rede, e a regra R1 do motor proíbe rede dentro da transação curta. O nó devolve a INTENÇÃO
// `agente_ia`; o motor despacha depois do commit e a resposta volta pela FILA (`continuar_http`).
// É essa volta pela fila que faz a conversa sobreviver a um reinício no meio da pergunta.
//
// ⛔ CONTRATO COM O ADAPTADOR (`PortaCanal.enviar`), escrito aqui porque é aqui que se lê:
//    ao receber `{tipo:'agente_ia', ...}` ele deve chamar
//    `ragnabot-capitao.service.responderPorIA({... pedidoDoNo:true ...})` e devolver
//    `{ aguardarResultado:true, resultado:{ quem, texto, motivo, confianca } }`.
//    Se `quem === 'capitao'`, o adaptador TAMBÉM envia o texto ao cliente — e ninguém mais envia
//    nada nesta visita. Duas respostas para a mesma mensagem é o defeito que o S5 existe para
//    impedir, e a trava de verdade é a reserva por `chave` no serviço do Capitão.
const noAgenteIA = {
  tipo: 'agente_ia',
  // Custa dinheiro por chamada: repetir às cegas é gastar duas vezes e responder duas vezes.
  efeito: 'irrepetivel',
  // `conciliar` e não `parar`: diferente do `http` genérico, aqui DÁ para perguntar se aconteceu —
  // a reserva do Capitão (`RagnabotCapitaoInteracao.chave`) responde "esta mensagem já foi
  // respondida?" sem depender de sistema de terceiro.
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: () => ['respondeu', 'nao_sabe', 'erro'],

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};

    if (c.pergunta !== undefined && typeof c.pergunta !== 'string') {
      problemas.push(erro('ARESTA_AUSENTE', 'config.pergunta', 'A pergunta enviada ao agente precisa ser texto (normalmente `{{ultimaMensagem}}`).', 'Deixe em branco para usar a última mensagem do cliente.'));
    }

    // A saída `nao_sabe` órfã é o mesmo defeito da saída `erro` órfã do nó HTTP — e aqui é pior:
    // "o agente não soube" é EXATAMENTE o caso que o desenho promete resolver devolvendo a gente.
    // Sem destino, o cliente que a IA não entendeu fica sem ninguém.
    const arestas = ctx?.arestasDoNo;
    if (Array.isArray(arestas)) {
      if (!arestas.some((a) => a.saida === 'nao_sabe')) {
        problemas.push(erro(
          'SAIDA_DE_ERRO_ORFA', 'saidas.nao_sabe',
          'A saída "nao_sabe" não está ligada a nada. Quando o agente de IA não souber responder, o cliente fica sem ninguém — e é justamente para esse caso que ele devolve ao humano.',
          'Ligue "nao_sabe" a um encaminhamento para um time de atendimento.',
        ));
      }
      if (!arestas.some((a) => a.saida === 'erro')) {
        problemas.push(erro(
          'SAIDA_DE_ERRO_ORFA', 'saidas.erro',
          'A saída "erro" não está ligada a nada. Agente fora do ar (ou teto do mês estourado) deixaria a conversa morrendo em silêncio.',
          'Ligue "erro" ao mesmo destino humano de "nao_sabe".',
        ));
      }
    }

    // Aviso honesto e datado: com o interruptor mestre desligado este nó SEMPRE sai por `nao_sabe`.
    // Melhor o operador ler isto no editor do que descobrir pelo relato de um cliente.
    if (!/^(1|true|sim)$/i.test(String(process.env.CAPITAO_ATIVO ?? ''))) {
      problemas.push(aviso(
        'LIMITE_EXCEDIDO', 'config',
        'O agente de IA está DESLIGADO nesta instalação (CAPITAO_ATIVO). Enquanto estiver assim, este nó sai sempre por "nao_sabe".',
        'Desenhe a saída "nao_sabe" como se fosse o caminho normal — porque hoje ela é.',
      ));
    }

    procurarSegredoLiteral(c, 'config', problemas);
    return problemas;
  },

  preparar(no, ctx) {
    const c = no?.config ?? {};
    const vars = ctx?.vars ?? {};
    // Sem `pergunta` declarada, a pergunta é a última coisa que o cliente escreveu — que é o caso
    // normal ("o fluxo não entendeu; veja você").
    const bruta = c.pergunta ?? '{{ultimaMensagem}}';
    const pergunta = interpolar(String(bruta), vars, { destino: 'nota' });
    return [{
      tipo: 'agente_ia',
      pergunta: pergunta.valor,
      // O adaptador precisa do endereço da conversa e da visita para reservar a resposta.
      execucaoId: ctx?.execucao?.id ?? null,
      noId: no?.id ?? null,
      visitaSeq: ctx?.execucao?.visitaSeq ?? null,
      contexto: {
        protocolo: ctx?.execucao?.protocolo ?? null,
        // ⛔ NUNCA a conversa inteira: só o que o agente precisa para responder ESTA pergunta.
        assunto: typeof c.assunto === 'string' ? interpolar(c.assunto, vars, { destino: 'nota' }).valor : null,
      },
      sufixo: '',
      _achados: [pergunta],
    }];
  },

  async executar(ctx) {
    anotarAchados(ctx, noAgenteIA.preparar(ctx.no, ctx).flatMap((i) => i._achados ?? []));
    // Mesma mecânica do nó `http` (regra R3): a resposta volta por trabalho da fila.
    return { tipo: 'aguardar', motivo: 'http', saidaAoVencer: 'nao_sabe' };
  },

  /**
   * @param {{quem?:string, texto?:string, motivo?:string, confianca?:number, erro?:string}} resultado
   */
  async continuar(ctx, resultado) {
    const { registrar, incidente } = ganchos(ctx);

    if (resultado?.erro || resultado?.ok === false) {
      incidente('HTTP_FALHOU', { noId: ctx?.no?.id, erro: String(resultado?.erro ?? 'falha ao consultar o agente') });
      return { saida: 'erro', varsPatch: {} };
    }

    // `quem` é UM valor só — é o contrato da fronteira. Qualquer coisa diferente de `capitao`
    // significa que a IA NÃO falou com o cliente, e a conversa segue pelo caminho humano.
    if (resultado?.quem !== 'capitao' || !resultado?.texto) {
      registrar({ tipo: 'no_saiu', noId: ctx?.no?.id, saida: 'nao_sabe', detalhe: { motivo: resultado?.motivo ?? 'sem_resposta' } });
      return { saida: 'nao_sabe', varsPatch: { ia_motivo: String(resultado?.motivo ?? 'sem_resposta') } };
    }

    registrar({
      tipo: 'no_saiu', noId: ctx?.no?.id, saida: 'respondeu',
      // Tamanho e confiança, NUNCA o texto: a mesma regra de LGPD do resto do arquivo.
      detalhe: { caracteres: String(resultado.texto).length, confianca: resultado?.confianca ?? null },
    });
    return {
      saida: 'respondeu',
      varsPatch: {
        ia_respondeu: 'sim',
        ia_confianca: resultado?.confianca != null ? String(resultado.confianca) : '',
      },
    };
  },
};

// ── 19. pagamento_pix ("Cobrar via Pix") ────────────────────────────────────────────────────────
// S-EFÍ / doc 36 §5.5 — o fluxo cobra sem humano.
//
// ⚠️ O NÓ NÃO CHAMA A EFÍ. Ele devolve a intenção `cobranca_pix`; quem cria a cobrança é o
// adaptador, DEPOIS do commit (regra R1). É o mesmo desenho do `http`, e pela mesma razão: criar
// cobrança dentro da transação curta faria uma queda de rede segurar a conversa inteira.
//
// ⛔ CONTRATO COM O ADAPTADOR (`PortaCanal.enviar`), ao receber `{tipo:'cobranca_pix', ...}`:
//    1. chamar `ragnabot-pagamento-efi.service.criarCobrancaPix({..., chaveEfeito})` — a
//       `chaveEfeito` que o motor passa É o que torna a criação idempotente (mesmo nó, mesma
//       visita, MESMO txid, e a Efí devolve a mesma cobrança em vez de criar a segunda);
//    2. trocar `{{pix_copia_e_cola}}` na `mensagemModelo` pelo código devolvido e MANDAR ao cliente;
//    3. devolver `{ idExterno: txid }`.
//
// MODOS:
//   `cobrar_e_seguir`   — manda o código e segue por `padrao`. O acompanhamento fica com gente.
//   `cobrar_e_aguardar` — estaciona por temporizador até a expiração, saindo por `expirado`.
//                         Quando o Pix é pago antes, `acordarFluxoDaCobranca()` troca a saída para
//                         `pago` e acorda a conversa na hora.
const MODOS_PIX = Object.freeze(['cobrar_e_seguir', 'cobrar_e_aguardar']);
const MARCADOR_COPIA_E_COLA = '{{pix_copia_e_cola}}';

const noPagamentoPix = {
  tipo: 'pagamento_pix',
  // Cobrança é irreversível para quem paga. Repetir às cegas cobra duas vezes o mesmo cliente.
  efeito: 'irrepetivel',
  // `conciliar`, e não `parar` como o `http`: aqui EXISTE como perguntar «você recebeu?» —
  // `GET /v2/cob/:txid` responde com o txid que nós mesmos geramos. Essa é a diferença entre um
  // efeito duvidoso que precisa de gente e um que o conciliador resolve sozinho.
  politicaEmDuvida: 'conciliar',
  estaciona: false,
  aceitaModeloFora: false,

  saidas: (config) => (config?.modo === 'cobrar_e_aguardar'
    ? ['pago', 'expirado', 'erro']
    : ['padrao', 'erro']),

  validar(no, ctx) {
    const problemas = [];
    const c = no?.config ?? {};

    const modo = c.modo ?? 'cobrar_e_seguir';
    if (!MODOS_PIX.includes(modo)) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.modo', `Modo inválido: "${modo}". Aceitos: ${MODOS_PIX.join(', ')}.`, 'Escolha o modo.'));
    }

    // O VALOR: fixo em centavos OU vindo de variável — nunca os dois, nunca nenhum.
    const temFixo = c.valorCentavos !== undefined && c.valorCentavos !== null && c.valorCentavos !== '';
    const temVar = typeof c.valorDeVariavel === 'string' && c.valorDeVariavel.trim() !== '';
    if (!temFixo && !temVar) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.valorCentavos', 'Cobrança sem valor. O cliente receberia um código que não cobra nada.', 'Informe o valor em centavos ou o nome da variável que traz o valor.'));
    }
    if (temFixo && temVar) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.valorCentavos', 'Valor fixo E valor por variável ao mesmo tempo: o resultado dependeria da ordem de leitura.', 'Escolha um dos dois.'));
    }
    if (temFixo) {
      const n = Number(c.valorCentavos);
      if (!Number.isInteger(n) || n <= 0) {
        problemas.push(erro('ARESTA_AUSENTE', 'config.valorCentavos', 'O valor tem de ser um número INTEIRO de centavos maior que zero (R$ 24,90 = 2490).', 'Corrija o valor.'));
      } else if (n > 100_000_00) {
        // Aviso, não erro: existe cobrança legítima alta. Mas um zero a mais digitado no editor
        // vira uma cobrança de cem mil reais no WhatsApp de um cliente.
        problemas.push(aviso('LIMITE_EXCEDIDO', 'config.valorCentavos', `A cobrança é de ${(n / 100).toFixed(2)} reais. Confira se não há um zero a mais.`, 'Confirme o valor com quem definiu a regra.'));
      }
    }

    // A mensagem PRECISA carregar o marcador — senão o cliente recebe um texto bonito e nenhum
    // código para pagar, e ninguém descobre até alguém reclamar que "o Pix não chegou".
    const mensagem = String(c.mensagem ?? '');
    if (!mensagem.trim()) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.mensagem', 'Sem mensagem, o código Pix não chega ao cliente.', `Escreva a mensagem incluindo ${MARCADOR_COPIA_E_COLA}.`));
    } else if (!mensagem.includes(MARCADOR_COPIA_E_COLA)) {
      problemas.push(erro('ARESTA_AUSENTE', 'config.mensagem', `A mensagem não tem ${MARCADOR_COPIA_E_COLA}: o cliente receberia o texto sem o código para pagar.`, `Inclua ${MARCADOR_COPIA_E_COLA} no lugar onde o código deve aparecer.`));
    }

    const exp = c.expiracaoSegundos;
    if (exp !== undefined && exp !== null && exp !== '') {
      const n = Number(exp);
      if (!Number.isInteger(n) || n < 60 || n > 86_400) {
        problemas.push(erro('ARESTA_AUSENTE', 'config.expiracaoSegundos', 'A expiração tem de ficar entre 60 segundos e 24 horas.', 'Ajuste a expiração.'));
      }
    }

    // Saída `erro` órfã: mesma regra do nó HTTP. Cobrança que falha e não tem para onde ir deixa o
    // cliente esperando um código que nunca vem.
    const arestas = ctx?.arestasDoNo;
    if (Array.isArray(arestas) && !arestas.some((a) => a.saida === 'erro')) {
      problemas.push(erro(
        'SAIDA_DE_ERRO_ORFA', 'saidas.erro',
        'A saída "erro" deste nó de cobrança não está ligada a nada. Quando a cobrança não puder ser criada, o cliente fica esperando um código que nunca chega.',
        'Ligue "erro" a uma mensagem honesta e a um encaminhamento para o time responsável.',
      ));
    }

    procurarSegredoLiteral(c, 'config', problemas);
    return problemas;
  },

  preparar(no, ctx) {
    const c = no?.config ?? {};
    const vars = ctx?.vars ?? {};
    const lim = limitesDe(ctx);

    // O valor por variável é convertido AQUI, com regra explícita: "24,90", "24.90" e "2490c" são
    // coisas diferentes, e adivinhar formato é como se cobra dez vezes a mais.
    let valorCentavos = null;
    if (c.valorCentavos !== undefined && c.valorCentavos !== null && c.valorCentavos !== '') {
      valorCentavos = Math.trunc(Number(c.valorCentavos));
    } else if (c.valorDeVariavel) {
      valorCentavos = centavosDeTexto(vars?.[c.valorDeVariavel]);
    }

    // ⚠️ O MARCADOR É PASSADO COMO VARIÁVEL DE SI MESMO — e isto não é truque, é conserto de um
    // defeito que o teste pegou: `interpolar()` troca TODA variável desconhecida por vazio, então
    // `{{pix_copia_e_cola}}` era APAGADO aqui e o adaptador recebia um texto sem lugar onde pôr o
    // código. O cliente leria a mensagem bonita e nenhum Pix. Interpolando o marcador para ele
    // mesmo, ele atravessa intacto (a interpolação é de passada única) e ainda deixa de aparecer
    // como "variável ausente" no diagnóstico do nó.
    const mensagem = interpolar(String(c.mensagem ?? ''), { ...vars, pix_copia_e_cola: MARCADOR_COPIA_E_COLA }, {
      destino: 'texto', teto: lim.valores.corpo_max, aoEstourar: 'cortar',
    });
    const descricao = c.descricao
      ? interpolar(String(c.descricao), vars, { destino: 'texto', teto: 140, aoEstourar: 'cortar' })
      : null;

    return [{
      tipo: 'cobranca_pix',
      valorCentavos,
      descricao: descricao?.valor ?? null,
      // O marcador continua NO TEXTO: quem troca é o adaptador, que é quem conhece o código.
      mensagemModelo: mensagem.valor,
      marcador: MARCADOR_COPIA_E_COLA,
      expiracaoSegundos: c.expiracaoSegundos ? Number(c.expiracaoSegundos) : null,
      devedorNome: c.devedorDeVariavel ? String(vars?.[c.devedorDeVariavel] ?? '') || null : (c.devedorNome ?? null),
      devedorDoc: c.documentoDeVariavel ? String(vars?.[c.documentoDeVariavel] ?? '') || null : (c.devedorDoc ?? null),
      execucaoId: ctx?.execucao?.id ?? null,
      noId: no?.id ?? null,
      visitaSeq: ctx?.execucao?.visitaSeq ?? null,
      protocolo: ctx?.execucao?.protocolo ?? null,
      // O custo da cobrança é do PAGADOR, não nosso — mas a coluna existe na reserva do efeito e
      // deixá-la nula é honesto: não gastamos centavo por cobrança criada.
      sufixo: '',
      _achados: [mensagem, ...(descricao ? [descricao] : [])],
    }];
  },

  async executar(ctx) {
    const c = ctx?.no?.config ?? {};
    const intencoes = noPagamentoPix.preparar(ctx.no, ctx);
    anotarAchados(ctx, intencoes.flatMap((i) => i._achados ?? []));

    const valor = intencoes[0]?.valorCentavos;
    if (!Number.isInteger(valor) || valor <= 0) {
      // Falha ANTES de reservar o efeito no despacho: cobrar zero (ou "NaN") é pior que não cobrar.
      ganchos(ctx).incidente('HTTP_FALHOU', {
        noId: ctx?.no?.id,
        mensagem: 'a cobrança não tem valor utilizável',
        comoCorrigir: 'confira a variável declarada em config.valorDeVariavel — ela chegou vazia ou em formato que não é dinheiro',
      });
      return falhar('erro', 'VALOR_INVALIDO', 'cobrança sem valor utilizável', mensagemDeFalha(ctx?.no, ctx));
    }

    if (c.modo === 'cobrar_e_aguardar') {
      const seg = Number(c.expiracaoSegundos) > 0 ? Number(c.expiracaoSegundos) : 3600;
      return {
        tipo: 'aguardar',
        // `temporizador` e não `resposta`: o que destrava é o PAGAMENTO (ou o prazo), não o cliente
        // escrever de novo. Com `resposta`, um "já paguei" digitado antes da confirmação sairia
        // pelo caminho errado.
        motivo: 'temporizador',
        acordarEm: new Date(agoraDe(ctx).getTime() + seg * 1000),
        saidaAoVencer: 'expirado',
      };
    }
    return { tipo: 'seguir', saida: 'padrao' };
  },
};

/**
 * "24,90" / "24.90" / "R$ 24,90" → 2490. Devolve `null` quando não é dinheiro reconhecível —
 * e `null` faz o nó sair por `erro`, que é melhor que cobrar um número inventado.
 *
 * ⚠️ NÚMERO SEM SEPARADOR É TRATADO COMO REAIS INTEIROS ("50" = R$ 50,00). É escolha declarada: a
 * variável vem de resposta de cliente ou de sistema de terceiro, e nesses dois lugares "50" quer
 * dizer cinquenta reais em praticamente todos os casos. Quem tiver centavos crus usa `valorCentavos`.
 */
function centavosDeTexto(bruto) {
  if (bruto === null || bruto === undefined) return null;
  const texto = String(bruto).trim().replace(/^R\$\s*/iu, '').replace(/\s/gu, '');
  if (!texto) return null;
  // 1.234,56 (pt-BR) → 1234.56 ; 1,234.56 (en) → 1234.56
  let normal = texto;
  if (/,\d{1,2}$/u.test(texto)) normal = texto.replace(/\./gu, '').replace(',', '.');
  else if (/\.\d{1,2}$/u.test(texto)) normal = texto.replace(/,/gu, '');
  else normal = texto.replace(/[.,]/gu, '');
  if (!/^\d+(\.\d{1,2})?$/u.test(normal)) return null;
  const n = Math.round(Number(normal) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRO E FACHADA PÚBLICA
//
// `EXECUTORES` é o único ponto de acoplamento: quem acrescentar um tipo implementa o mesmo objeto e
// registra aqui. Se um dia isto virar `src/motor/nos/<tipo>.js`, este mapa é exatamente o que o
// `index.js` de lá precisa exportar — o recorte não muda uma linha de lógica.
//
// O motor pede o executor a um CATÁLOGO com `.obter(tipo)`. `catalogoDeNos` abaixo é esse adaptador,
// para ninguém precisar escrever a ponte duas vezes:
//     import { catalogoDeNos } from './ragnabot-fluxo-nos.service.js';
//     configurarMotor({ nos: catalogoDeNos });
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const EXECUTORES = Object.freeze({
  inicio: noInicio,
  texto: noTexto,
  midia: noMidia,
  pergunta: noPergunta,
  lista: noLista,
  botoes: noBotoes,
  espera: noEspera,
  condicao: noCondicao,
  http: noHttp,
  variavel: noVariavel,
  etiqueta: noEtiqueta,
  time: noTime,
  // Contrato S3 (02/09/2026): transferir para uma PESSOA (§F3.3) e dividir o tráfego por
  // porcentagem (§F3.5). O primeiro casa com o isolamento do S2 — atribuir muda quem enxerga.
  atendente: noAtendente,
  randomizador: noRandomizador,
  notificar: noNotificar,
  subfluxo: noSubfluxo,
  chamado: noChamado,
  encerrar: noEncerrar,
  email: noEmail,
  // S5 / S-EFÍ (02/09/2026): o convite formal à IA e a cobrança dentro da conversa.
  agente_ia: noAgenteIA,
  pagamento_pix: noPagamentoPix,
});

export const TIPOS = Object.freeze(Object.keys(EXECUTORES));

/**
 * Catálogo no formato que o motor injeta (`configurarMotor({ nos: catalogoDeNos })`).
 *
 * `obter` devolve `undefined` em tipo desconhecido — e não lança — porque o motor já tem a mensagem
 * de erro dele (`TIPO_DE_NO_DESCONHECIDO`) e duas mensagens diferentes para o mesmo defeito é o tipo
 * de coisa que faz o operador procurar dois problemas onde há um. Quem quiser a exceção com o nome
 * do tipo dentro usa `executorDe()`.
 */
export const catalogoDeNos = Object.freeze({
  obter: (tipo) => EXECUTORES[tipo],
  tipos: () => TIPOS,
});

/** Tipos que estacionam — é a lista que o motor usa para saber onde gerar as saídas de exceção. */
export const TIPOS_QUE_ESTACIONAM = Object.freeze(TIPOS.filter((t) => EXECUTORES[t].estaciona));

/**
 * Devolve o executor. Lança em tipo desconhecido de propósito: um documento com tipo que ninguém
 * implementa é corrupção, e seguir adiante ignorando o nó faria a conversa pular um passo em
 * silêncio — que é pior que parar com o nome do tipo na mensagem.
 */
export function executorDe(tipo) {
  const e = EXECUTORES[tipo];
  if (!e) {
    const err = new Error(`tipo de nó desconhecido: "${tipo}". Tipos implementados: ${TIPOS.join(', ')}.`);
    err.codigo = 'TIPO_DE_NO_DESCONHECIDO';
    throw err;
  }
  return e;
}

/**
 * Saídas de um nó, JÁ COM as de exceção quando ele estaciona E as de falha que o executor emite.
 *
 * É esta função — e não o autor do fluxo — que garante `sem_resposta`, `opcao_invalida` e `erro`.
 * Deixá-las como conector opcional garante que metade dos fluxos esquece, e a medição diz que 151
 * das 518 apresentações do nó CONFIRMACAO caem exatamente nelas.
 *
 * ⚠️ `saidasDeFalha` existe por causa de um defeito REAL deste arquivo, que só aparecia em produção:
 * `pergunta`, `lista` e `botoes` devolvem `falhar('sem_janela', …)` quando a janela de 24 h está
 * fechada, mas NENHUM dos três declarava essa saída. Como é daqui que o editor monta os conectores e
 * que o validador de grafo cobra a aresta, `sem_janela` era INDESENHÁVEL: o motor resolvia a saída,
 * não achava destino, gravava incidente ARESTA_AUSENTE e encerrava a execução — sem mensagem ao
 * cliente e sem transferir a ninguém. Bastava a linha de `RagnabotFluxoJanela` não existir (janela
 * avaliada como `sem_registro`) para o cliente que acabou de escrever «oi» receber silêncio absoluto.
 * Pior: o incidente mandava o operador «dar destino à saída sem_janela», conselho impossível de
 * seguir, porque o conector não era oferecido. Declarar aqui é o que torna a aresta desenhável e
 * cobrável, como manda o §5.4 da especificação.
 *
 * A separação entre as duas listas é deliberada: `saidas()` é o desenho INTENCIONAL do autor (uma
 * saída por item da lista, `padrao`, `verdadeiro`/`falso`), e `saidasDeFalha` é o que o motor pode
 * tomar sem ninguém pedir. Quem quiser distinguir as duas na tela tem como.
 */
export function saidasDe(no) {
  const executor = executorDe(no?.tipo);
  const declaradas = executor.saidas(no?.config ?? {}) ?? [];
  const vistas = new Set(declaradas);
  const saidas = [...declaradas];
  const acrescentar = (lista) => {
    for (const s of lista ?? []) {
      if (!vistas.has(s)) { vistas.add(s); saidas.push(s); }
    }
  };
  if (noEstaciona(no)) acrescentar(SAIDAS_DE_EXCECAO);
  acrescentar(executor.saidasDeFalha);
  return saidas;
}

/**
 * ESTE nó estaciona? — a pergunta com a CONFIGURAÇÃO na mão.
 *
 * `EXECUTORES[tipo].estaciona` responde pelo TIPO, e para quinze dos dezessete isso basta. Para
 * `botoes` não basta: com botões de resposta ele espera a escolha, com botão de URL não há resposta
 * que esperar (a Meta não avisa cliques em `cta_url`). Um nó desses marcado como "estaciona" faria o
 * editor oferecer conectores `sem_resposta`/`opcao_invalida` que nunca disparam.
 *
 * ⚠️ PENDÊNCIA DECLARADA: `ragnabot-fluxo-publicacao.service.js` grava a coluna
 * `RagnabotFluxoNo.estaciona` da projeção lendo `executorDe(n.tipo).estaciona` — o campo estático.
 * Trocar aquelas duas leituras por `noEstaciona(n)` deixa a projeção exata; aquele arquivo é de
 * outro dono nesta entrega, então fica anotado aqui em vez de mexido por fora. Enquanto não trocar,
 * o único efeito é um nó de botão de URL aparecer como "estaciona" no relatório de onde as conversas
 * estão paradas — nenhuma conversa fica parada de verdade, porque quem decide isso é o
 * `ResultadoNo` de `executar()`, e ele devolve `seguir`.
 */
export function noEstaciona(no) {
  const executor = executorDe(no?.tipo);
  if (typeof executor.estacionaCom === 'function') return !!executor.estacionaCom(no?.config ?? {});
  return !!executor.estaciona;
}

/**
 * Validação de UM nó. O validador de documento (outro arquivo) junta isto com as verificações de
 * grafo — aresta órfã, nó inalcançável, aresta duplicada — que dependem do documento inteiro.
 *
 * Nunca lança: validador que quebra deixa o editor sem diagnóstico, e o operador publica no escuro.
 */
export function validarNo(no, ctx = {}) {
  try {
    const executor = executorDe(no?.tipo);
    const problemas = executor.validar(no, ctx) ?? [];

    // Conferência que vale para TODOS os tipos: o perfil de limites envelhecido é julgamento
    // (classe B), mas precisa aparecer, porque um teto medido há mais de meio ano pode ter mudado.
    const lim = limitesDe(ctx);
    if (lim.conferidoEm) {
      const dias = (Date.now() - new Date(lim.conferidoEm).getTime()) / 86_400_000;
      if (dias > 180) {
        problemas.push(aviso(
          'LIMITE_EXCEDIDO', 'perfil',
          `O perfil de limites ${lim.perfil} foi conferido há ${Math.round(dias)} dias. Os tetos da Meta mudam sem aviso.`,
          'Rode a calibração do perfil.',
        ));
      }
    }
    return problemas;
  } catch (e) {
    return [erro('TIPO_DE_NO_DESCONHECIDO', 'tipo', e.message, 'Corrija o tipo do nó ou implemente o executor.')];
  }
}

/**
 * Monta o que SAIRIA, sem enviar. É a função que a prévia do editor, o modo de teste e o envio real
 * compartilham — e é por compartilhá-la que o aviso do editor não pode divergir da execução.
 *
 * ⚠️ ORDEM QUE O MOTOR USA E QUE A PRÉVIA PRECISA IMITAR: primeiro `executar()`, depois o `varsPatch`
 * dele é aplicado ao contexto, e só então `preparar()`. É o que faz o `chamado` carimbar o protocolo
 * que ele acabou de emitir. Chamar `preparar()` isolado é legítimo (é a prévia), mas nesse caso os
 * valores que só nascem em `executar()` ainda não existem — e mostrá-los inventados seria pior.
 *
 * O campo `_achados` das intenções carrega variáveis ausentes e cortes aplicados; o editor usa isso
 * para mostrar «o texto foi cortado em 400 caracteres» na própria prévia, em vez de o operador
 * descobrir depois pelo relato de um cliente. `limparIntencao()` tira esses campos antes do despacho.
 */
export function prepararNo(no, ctx = {}) {
  const executor = executorDe(no?.tipo);
  const intencoes = executor.preparar(no, { ...ctx, no }) ?? [];
  return Array.isArray(intencoes) ? intencoes : [intencoes];
}

/** Remove os campos internos de diagnóstico — o que vai para a PortaCanal é só a intenção. */
export function limparIntencao(intencao) {
  const copia = { ...intencao };
  for (const chave of Object.keys(copia)) if (chave.startsWith('_')) delete copia[chave];
  return copia;
}

/**
 * Política de exceção de um nó que estaciona (§4.4). O motor chama isto quando a saída resolvida é
 * `sem_resposta` ou `opcao_invalida`: aqui moram o teto de tentativas, o reforço, a reconferência da
 * janela antes de gastar tentativa, e a ação final.
 *
 * Fica fora de `receber()` de propósito. `receber()` responde «o que o cliente disse»; esta responde
 * «o que fazemos com isso» — e a segunda pergunta também vale para `sem_resposta`, que não passa
 * por `receber()` nenhum, porque nada chegou.
 */
export function resolverExcecaoDoNo(ctx, especie, opcoes = {}) {
  if (especie !== 'semResposta' && especie !== 'opcaoInvalida') {
    throw new Error(`espécie de exceção desconhecida: "${especie}" (use semResposta ou opcaoInvalida)`);
  }
  return resolverExcecao(ctx, especie, opcoes);
}

/** Tudo o que um nó referencia de cofre e de host — alimenta a projeção do grafo e `ondeUsado()`. */
export function referenciasDoNo(no) {
  const c = no?.config ?? {};
  const segredosRef = coletarSegredosRef(c);
  const destinosRef = [];
  const url = String(c.url ?? '');
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (m && !/\{\{/u.test(m[1])) destinosRef.push(m[1].toLowerCase());
  return { segredosRef, destinosRef };
}

export default EXECUTORES;
