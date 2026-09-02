// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE E VOCABULÁRIO DO TESTADOR DE FLUXO (contrato S3.1, 02/09/2026 · doc 34 §F3.1)
//
// ⚠️ O QUE ESTE ARQUIVO **NÃO** FAZ, e é o ponto mais importante dele: ele NÃO simula fluxo nenhum.
// Quem percorre o fluxo é o motor de produção, na rota `POST /fluxos/:id/testar` — os MESMOS
// `preparar()`/`executar()` que o envio real usa. Aqui só se traduz a resposta para o vocabulário
// da tela.
//
// A razão está escrita na própria rota, e vale repetir porque é o que separa um testador útil de um
// testador que mente: *"um simulador escrito à parte diverge do motor em três semanas, e a
// divergência aparece justamente quando alguém confia nele para publicar"*. Se um dia alguém for
// tentado a "melhorar" o testador reimplementando a marcha aqui no navegador, é este parágrafo que
// tem de ser lido antes.
//
// ── POR QUE É JAVASCRIPT PURO, E NÃO parte do .jsx ──────────────────────────────────────────────
// Porque é a parte que dá para MEDIR sem navegador: `tests/testador.smoke.mjs` importa este módulo
// direto, troca o `fetch` por um dublê e confere rota, método e corpo. Vocabulário dentro do
// componente vira opinião; aqui vira medição.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { chamarFluxo } from './api.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. A REDE
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Os fluxos que este usuário enxerga. O servidor já isola por empresa; a tela não escolhe escopo. */
export async function listarFluxos({ busca = '', limite = 100 } = {}) {
  const q = new URLSearchParams();
  if (busca) q.set('busca', busca);
  q.set('limite', String(limite));
  const r = await chamarFluxo(`/fluxos?${q.toString()}`);
  return { total: r.total ?? 0, itens: Array.isArray(r.itens) ? r.itens : [] };
}

/**
 * UM passo do teste.
 *
 * Sem `estado` → começa do nó inicial. Com `estado` + `resposta` → entrega a resposta ao nó que
 * estava parado e segue dali.
 *
 * ⚠️ O `estado` é DEVOLVIDO pelo servidor e reenviado sem alteração. A sessão de teste não mora no
 * servidor de propósito (nada é gravado), e o servidor trata este estado como não confiável — ele
 * reconfere o fluxo e o escopo a cada passo. Ou seja: mexer no estado aqui não abre porta nenhuma,
 * só quebra o próprio teste de quem mexeu.
 */
export async function passoDoTeste(fluxoId, { origem = 'rascunho', versaoNumero = null, estado = null, resposta = null, vars = null } = {}) {
  const corpo = {};
  if (origem === 'versao' || versaoNumero != null) corpo.origem = 'versao';
  if (versaoNumero != null) corpo.versaoNumero = Number(versaoNumero);
  if (estado) corpo.estado = estado;
  if (resposta != null) corpo.resposta = resposta;
  if (vars && Object.keys(vars).length) corpo.vars = vars;
  return chamarFluxo(`/fluxos/${encodeURIComponent(fluxoId)}/testar`, { metodo: 'POST', corpo });
}

/**
 * A resposta do "cliente" no formato que a rota entende.
 *
 * Duas formas, e a diferença é a mesma da conversa real:
 *  · TOCAR numa opção → a plataforma devolve o ID que nós mandamos (`{interativo:{id}}`);
 *  · DIGITAR → texto livre, que passa pela escada de casamento (número, título, prefixo, apelido).
 * Simular o toque como se fosse texto esconderia o degrau que mais quebra na vida real.
 */
export function respostaDeOpcao(idDaOpcao) {
  return { interativo: { id: String(idDaOpcao) }, texto: '' };
}
export function respostaDigitada(texto) {
  return String(texto ?? '');
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. O VOCABULÁRIO — traduzir intenção crua para o que a pessoa vê
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * O que o CLIENTE veria × o que acontece nos bastidores.
 *
 * A separação não é estética: numa lista única, `etiqueta`, `carimbar` e `resolver` apareceriam
 * como se fossem mensagens, e o operador contaria cinco balões numa conversa que tem dois. Foi
 * exatamente essa confusão que fez alguém "corrigir" um envio repetido que não existia.
 */
export const INTENCOES_PARA_O_CLIENTE = Object.freeze(['texto', 'midia', 'lista', 'botoes', 'template', 'cobranca_pix']);

export function ehParaOCliente(intencao) {
  return INTENCOES_PARA_O_CLIENTE.includes(String(intencao?.tipo));
}

const ROTULOS = Object.freeze({
  texto: 'Mensagem',
  midia: 'Mídia',
  lista: 'Menu em lista',
  botoes: 'Botões',
  template: 'Modelo aprovado (fora da janela de 24 h)',
  cobranca_pix: 'Cobrança Pix',
  nota: 'Nota interna (só a equipe vê)',
  etiqueta: 'Etiqueta na conversa',
  atribuir: 'Transferência para setor',
  resolver: 'Encerrar a conversa',
  carimbar: 'Carimbo na conversa',
  http: 'Chamada a sistema externo',
  email: 'E-mail',
  agente_ia: 'Pergunta ao agente de IA',
});

/**
 * Traduz UMA intenção para o que a tela mostra.
 * @returns {{tipo, rotulo, texto, opcoes:Array, detalhes:Array<[string,string]>, paraOCliente:boolean}}
 */
export function resumirIntencao(intencao = {}) {
  const tipo = String(intencao.tipo || 'desconhecido');
  const base = {
    tipo,
    rotulo: ROTULOS[tipo] || `Ação "${tipo}"`,
    texto: '',
    opcoes: [],
    detalhes: [],
    paraOCliente: ehParaOCliente(intencao),
  };

  if (tipo === 'texto') return { ...base, texto: String(intencao.corpo ?? '') };

  if (tipo === 'midia') {
    return {
      ...base,
      texto: String(intencao.legenda ?? ''),
      detalhes: [['Arquivo', String(intencao.url ?? '')], ...(intencao.mime ? [['Tipo', String(intencao.mime)]] : [])],
    };
  }

  if (tipo === 'lista' || tipo === 'botoes') {
    const itens = tipo === 'lista' ? intencao.itens : intencao.botoes;
    return {
      ...base,
      texto: [intencao.cabecalho, intencao.corpo, intencao.rodape].filter(Boolean).join('\n\n'),
      opcoes: (Array.isArray(itens) ? itens : []).map((o, i) => ({
        id: String(o.id ?? `opcao_${i + 1}`),
        rotulo: String(o.titulo ?? o.rotulo ?? ''),
        descricao: o.descricao ? String(o.descricao) : null,
        url: o.tipo === 'url' ? String(o.url ?? '') : null,
      })),
    };
  }

  if (tipo === 'template') {
    return {
      ...base,
      texto: `Modelo "${intencao.nome}" (${intencao.idioma || 'pt_BR'})`,
      detalhes: (Array.isArray(intencao.parametros) ? intencao.parametros : []).map((p, i) => [`Parâmetro ${i + 1}`, String(p)]),
    };
  }

  if (tipo === 'cobranca_pix') {
    return {
      ...base,
      // ⚠️ O marcador `{{pix_copia_e_cola}}` fica À VISTA de propósito: no teste NÃO existe cobrança
      // (nenhuma é criada), então mostrar um código inventado ensinaria o operador a confiar num
      // valor que não existe. O que ele precisa conferir aqui é se o marcador está no lugar certo.
      texto: String(intencao.mensagemModelo ?? ''),
      detalhes: [
        ['Valor', formatarCentavos(intencao.valorCentavos)],
        ...(intencao.descricao ? [['Descrição', String(intencao.descricao)]] : []),
      ],
    };
  }

  if (tipo === 'nota') {
    return { ...base, texto: [intencao.assunto, intencao.corpo].filter(Boolean).join('\n'), detalhes: destinatarioComoDetalhe(intencao) };
  }

  if (tipo === 'etiqueta') {
    const d = [];
    if (intencao.aplicar?.length) d.push(['Aplica', intencao.aplicar.join(', ')]);
    if (intencao.remover?.length) d.push(['Remove', intencao.remover.join(', ')]);
    return { ...base, detalhes: d };
  }

  if (tipo === 'atribuir') {
    return { ...base, detalhes: [['Setor', String(intencao.time ?? intencao.nomeTime ?? intencao.timeId ?? '—')]] };
  }

  if (tipo === 'carimbar') {
    return { ...base, detalhes: Object.entries(intencao.atributos || {}).map(([k, v]) => [k, String(v ?? '—')]) };
  }

  if (tipo === 'http') {
    return { ...base, detalhes: [['Método', String(intencao.metodo ?? 'POST')], ['Endereço', String(intencao.url ?? '')]] };
  }

  if (tipo === 'email') {
    return { ...base, texto: String(intencao.corpoTexto ?? ''), detalhes: [['Para', String(intencao.para ?? '')], ['Assunto', String(intencao.assunto ?? '')]] };
  }

  if (tipo === 'agente_ia') {
    return { ...base, texto: String(intencao.pergunta ?? ''), detalhes: [['Pergunta enviada ao agente', String(intencao.pergunta ?? '')]] };
  }

  return base;
}

function destinatarioComoDetalhe(intencao) {
  const d = intencao?.destinatario;
  if (!d) return [];
  return [['Destinatário', `${d.tipo}: ${d.valor}`]];
}

/** Centavos → "R$ 24,90". Valor ausente vira "—" e não "R$ NaN". */
export function formatarCentavos(centavos) {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return '—';
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 3. COMO A CONVERSA TERMINOU — em português, com a causa
// ────────────────────────────────────────────────────────────────────────────────────────────────

const FINS = Object.freeze({
  concluido: { tom: 'ok', frase: 'A conversa chegou ao fim.' },
  aresta_ausente: { tom: 'erro', frase: 'O fluxo parou porque essa saída não leva a lugar nenhum. Na conversa real, a pessoa ficaria sem resposta.' },
  no_ausente: { tom: 'erro', frase: 'Uma ligação aponta para um bloco que não existe mais no desenho.' },
  limite_visitas: { tom: 'erro', frase: 'O mesmo bloco foi visitado vezes demais — há um laço no desenho.' },
  teto_de_passos: { tom: 'erro', frase: 'O teste parou por excesso de passos sem chegar ao fim. Provável laço.' },
  tipo_desconhecido: { tom: 'erro', frase: 'Há um bloco de um tipo que o motor não conhece.' },
  resultado_invalido: { tom: 'erro', frase: 'Um bloco devolveu um resultado fora do contrato do motor.' },
  resultado_desconhecido: { tom: 'erro', frase: 'Um bloco devolveu um resultado que o motor não reconhece.' },
  subfluxo_nao_seguido: { tom: 'aviso', frase: 'O teste não entra em sub-fluxo. Teste o sub-fluxo separadamente.' },
  nao_executavel_em_teste: { tom: 'aviso', frase: 'Este bloco só executa de verdade na conversa real (é uma chamada externa).' },
});

export function rotuloDoFim(fim) {
  if (!fim) return null;
  const conhecido = FINS[fim.motivo];
  const estado = fim.estado === 'transferido' ? ' A conversa foi entregue a um atendente humano.' : '';
  if (conhecido) return { tom: conhecido.tom, frase: `${conhecido.frase}${estado}`, detalhe: fim.detalhe || null };
  return { tom: 'aviso', frase: `O teste terminou por "${fim.motivo}".`, detalhe: fim.detalhe || null };
}

/** O que o operador pode responder agora. Vazio = campo de texto livre. */
export function opcoesDoParado(parado) {
  if (!parado) return [];
  return (Array.isArray(parado.opcoes) ? parado.opcoes : [])
    .filter((o) => o && o.id)
    .map((o) => ({ id: String(o.id), rotulo: String(o.rotulo ?? o.id) }));
}

/** As variáveis da conversa, em ordem estável — sem ordem, a lista dança a cada passo. */
export function variaveisEmLista(vars) {
  return Object.entries(vars || {})
    .map(([nome, valor]) => [nome, valor == null ? '' : String(valor)])
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
}

/** Só os problemas de ERRO travam a publicação; aviso é aviso. Separar aqui evita a tela gritar. */
export function separarProblemas(problemas) {
  const lista = Array.isArray(problemas) ? problemas : [];
  return {
    erros: lista.filter((p) => p.nivel !== 'aviso'),
    avisos: lista.filter((p) => p.nivel === 'aviso'),
  };
}

/** A frase que a tela repete o tempo todo. Fica aqui para ser a MESMA em todo lugar. */
export const AVISO_DE_SIMULACAO = 'Simulação: nenhuma mensagem é enviada, nenhuma chamada externa '
  + 'é feita, nenhum segredo é decifrado e nada é gravado.';
