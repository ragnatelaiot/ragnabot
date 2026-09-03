// ════════════════════════════════════════════════════════════════════════════════════════════════
// PROVA DA TELA DE AGENDAMENTOS (contrato S4, 02/09/2026 · doc 34 §F4.6)
//
// ⚠️ O QUE ESTE TESTE **NÃO** MEDE, e é bom deixar claro antes: o DISPARO. Ele tem teste próprio,
// contra Postgres de verdade, em `app/tests/ragnabot-agendamento-worker.test.mjs` — inclusive a
// prova de que a mesma mensagem não sai duas vezes. Aqui se mede a TELA e a camada de rede dela.
//
// Como cada coisa é medida:
// · `lib/api-agendamento.js` é JavaScript puro: o Node importa direto e o `fetch` é trocado por um
//   DUBLÊ que CONTA as chamadas — é assim que «o filtro vira parâmetro na URL» vira medição.
// · Os componentes são JSX: empacotados com o Vite em modo SSR e renderizados com `renderToString`,
//   mesmo caminho de `respostas-rapidas.smoke.mjs`.
//
// ⛔ O QUE NÃO DÁ PARA PROVAR AQUI, e não vou fingir que prova: `useEffect` não roda em SSR, então
// a busca da lista, os cliques e a abertura das janelas ficam de fora — isso só com navegador
// contra o motor no ar. E, sobretudo: **o isolamento entre empresas não é medido aqui**. Quem
// tranca é o servidor; o que a tela mostra é cortesia.
//
// Rodar (a partir de `app/web/`):   node tests/agendamentos.smoke.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const SAIDA_SSR = path.join(AQUI, '.ssr', 'agendamentos');

let falhas = 0;
let medicoes = 0;
function medir(titulo, conferir) {
  medicoes += 1;
  try { conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}
async function medirAsync(titulo, conferir) {
  medicoes += 1;
  try { await conferir(); console.log(`  ✓ ${titulo}`); }
  catch (e) { falhas += 1; console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); }
}
function verdade(v, msg) { if (!v) throw new Error(msg || 'esperava verdadeiro'); }
function igual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'esperava'}: «${b}», veio «${a}»`); }

// ── O DUBLÊ DA REDE ─────────────────────────────────────────────────────────────────────────────
const rede = { chamadas: [], proxima: null };
globalThis.fetch = async (url, opcoes = {}) => {
  rede.chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
  const r = rede.proxima || { status: 200, corpo: {} };
  rede.proxima = null;
  return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.corpo) };
};

console.log('\nA TELA DE AGENDAMENTOS');

const api = await import('../src/lib/api-agendamento.js');

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n1) A LEITURA DE CONTATOS — o multi-contato começa no campo de texto');
// ────────────────────────────────────────────────────────────────────────────────────────────────

medir('uma lista colada vira contatos únicos, em dígitos', () => {
  const r = api.lerListaDeContatos('5598983351000\n(98) 9 8335-1000, 5511999998888');
  igual(r.bons.join('|'), '5598983351000|98983351000|5511999998888', 'contatos lidos');
});

medir('o mesmo número em duas formas NÃO entra duas vezes', () => {
  const r = api.lerListaDeContatos('5598983351000\n+55 98 98335-1000');
  igual(r.bons.length, 1, 'contatos distintos');
});

medir('o número inválido é DITO, com a entrada original — não some em silêncio', () => {
  const r = api.lerListaDeContatos('5598983351000, 123');
  igual(r.bons.length, 1, 'válidos');
  igual(r.ruins.length, 1, 'inválidos');
  igual(r.ruins[0].entrada, '123', 'entrada recusada');
  verdade(r.ruins[0].erro.includes('curto'), 'a razão da recusa não foi dita');
});

medir('a previsão do contato NUNCA lança (senão cada tecla viraria exceção)', () => {
  for (const v of [null, undefined, '', '   ', 'abc', '(98)']) api.preverContato(v);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) A CAMADA DE REDE — cada filtro vira parâmetro, e nada vaza');
// ────────────────────────────────────────────────────────────────────────────────────────────────

await medirAsync('os filtros do contrato (período, situação, repetição) viajam na URL', async () => {
  rede.chamadas.length = 0;
  rede.proxima = { status: 200, corpo: { itens: [], total: 0 } };
  await api.listarAgendamentos({ status: 'pendente', recorrencia: 'semanal', de: '2026-09-01T00:00:00.000Z', busca: 'consulta' });
  const u = rede.chamadas[0].url;
  for (const t of ['status=pendente', 'recorrencia=semanal', 'de=2026-09-01', 'busca=consulta']) {
    verdade(u.includes(encodeURI(t).replace(/:/g, '%3A')) || u.includes(t.split('=')[0]), `faltou ${t} na URL: ${u}`);
  }
});

await medirAsync('filtro vazio NÃO vira parâmetro vazio na URL', async () => {
  rede.chamadas.length = 0;
  rede.proxima = { status: 200, corpo: { itens: [] } };
  await api.listarAgendamentos({ status: '', recorrencia: undefined, busca: null });
  verdade(!rede.chamadas[0].url.includes('?'), `a URL ganhou parâmetros vazios: ${rede.chamadas[0].url}`);
});

await medirAsync('cancelar usa POST em /cancelar — NÃO existe DELETE, porque a linha não some', async () => {
  rede.chamadas.length = 0;
  rede.proxima = { status: 200, corpo: { cancelado: true } };
  await api.cancelarAgendamento('ag-1');
  igual(rede.chamadas[0].metodo, 'POST', 'método');
  verdade(rede.chamadas[0].url.endsWith('/ag-1/cancelar'), rede.chamadas[0].url);
});

await medirAsync('o erro do servidor chega com a mensagem DELE, não com «Erro HTTP 400»', async () => {
  rede.proxima = { status: 400, corpo: { error: 'cwInboxId: escolha a conexão', code: 'X' } };
  try { await api.criarAgendamento({}); throw new Error('não recusou'); } catch (e) {
    igual(e.message, 'cwInboxId: escolha a conexão', 'mensagem repassada');
    igual(e.status, 400, 'status');
  }
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3) O RELÓGIO É O DO CLIENTE — não o do navegador');
// ────────────────────────────────────────────────────────────────────────────────────────────────

medir('a data é mostrada no FUSO DO AGENDAMENTO', () => {
  // 2026-09-04T02:50Z é 03/09 às 23h50 em Fortaleza. Mostrar em UTC diria «04/09 02:50» e o
  // operador concluiria que a agenda está no dia errado.
  igual(api.noFuso('2026-09-04T02:50:00.000Z', 'America/Fortaleza'), '03/09/2026, 23:50');
});

medir('sem data, mostra travessão em vez de «Invalid Date»', () => {
  igual(api.noFuso(null, 'America/Fortaleza'), '—');
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n4) A TELA (renderização do lado do servidor)');
// ────────────────────────────────────────────────────────────────────────────────────────────────

const PACOTE = path.join(SAIDA_SSR, 'Agendamentos.js');
if (!fs.existsSync(PACOTE) || process.env.RECONSTRUIR === '1') {
  process.stdout.write('  … empacotando a tela com o Vite (modo SSR)\n');
  execFileSync(
    process.execPath,
    [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--ssr', 'src/paginas/Agendamentos.jsx', '--outDir', 'tests/.ssr/agendamentos', '--logLevel', 'warn'],
    { cwd: RAIZ, stdio: 'inherit' },
  );
}

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const tela = await import(PACOTE);
const {
  ListaDeAgendamentos, LinhaDeAgendamento, HistoricoDeEnvios, FormularioDeAgendamento,
  descreverGrade, SeloDeEnvio,
} = tela;

/** O React marca a fronteira entre nós de texto com `<!-- -->`; sem tirar isso, procurar uma frase
 *  inteira no HTML falha por um comentário no meio dela. */
const semMarcas = (html) => html.replace(/<!--\s*-->/g, '');
const nada = () => {};

const ITEM = {
  id: 'ag-1', titulo: 'Lembrete de consulta', status: 'pendente',
  recorrencia: 'semanal', intervalo: 1, diasSemana: '2,4',
  fuso: 'America/Fortaleza', proximaEm: '2026-09-08T11:00:00.000Z',
  cwInboxId: 34, caixaNome: 'WhatsApp Ragnatela', abrirTicket: true, usarTemplate: false,
  ocorrenciasFeitas: 3,
  resumo: { destinos: 4, envios: { enviado: 10, sem_janela: 1, duvidoso: 1 } },
};

medir('a grade é dita em PORTUGUÊS, não em campos do banco', () => {
  igual(descreverGrade(ITEM), 'toda semana · Ter, Qui');
  igual(descreverGrade({ ...ITEM, recorrencia: 'diaria', intervalo: 3 }), 'a cada 3 dias');
  igual(descreverGrade({ ...ITEM, recorrencia: 'mensal', intervalo: 1 }), 'todo mês');
  igual(descreverGrade({ ...ITEM, recorrencia: 'unica' }), 'Uma vez só');
});

const linha = semMarcas(renderToString(React.createElement(LinhaDeAgendamento, {
  item: ITEM, aoAbrir: nada, aoPausar: nada, aoRetomar: nada, aoCancelar: nada, ocupado: false,
})));

medir('a linha diz a próxima ocorrência NO FUSO do agendamento, e nomeia o fuso', () => {
  verdade(linha.includes('08/09/2026, 08:00'), 'a data no fuso do cliente não apareceu');
  verdade(linha.includes('America/Fortaleza'), 'o fuso não foi nomeado');
});

medir('a linha NÃO esconde os desfechos incômodos — «fora da janela» e «em dúvida» aparecem', () => {
  verdade(linha.includes('Fora da janela de 24 h'), 'o «fora da janela» sumiu da lista');
  verdade(linha.includes('Em dúvida'), 'o «em dúvida» sumiu da lista');
  verdade(linha.includes('10 Enviada'), 'a contagem de enviadas sumiu');
});

medir('a linha diz por qual CONEXÃO a mensagem sai — «nada sai sem canal» também na tela', () => {
  verdade(linha.includes('WhatsApp Ragnatela'), 'a conexão não aparece');
});

medir('pendente mostra Pausar e Cancelar; pausado mostra Retomar', () => {
  verdade(linha.includes('Pausar') && linha.includes('Cancelar'), 'faltou Pausar/Cancelar no pendente');
  const pausado = semMarcas(renderToString(React.createElement(LinhaDeAgendamento, {
    item: { ...ITEM, status: 'pausado' }, aoAbrir: nada, aoPausar: nada, aoRetomar: nada, aoCancelar: nada,
  })));
  verdade(pausado.includes('Retomar'), 'faltou Retomar no pausado');
  verdade(!pausado.includes('Pausar'), 'um agendamento pausado ainda oferece Pausar');
});

medir('concluído e cancelado NÃO oferecem cancelar (o que acabou, acabou)', () => {
  for (const st of ['concluido', 'cancelado']) {
    const h = semMarcas(renderToString(React.createElement(LinhaDeAgendamento, {
      item: { ...ITEM, status: st }, aoAbrir: nada, aoPausar: nada, aoRetomar: nada, aoCancelar: nada,
    })));
    verdade(!h.includes('Cancelar'), `${st} ainda oferece Cancelar`);
  }
});

medir('sem agendamentos, a tela ENSINA o caminho em vez de ficar em branco', () => {
  const h = semMarcas(renderToString(React.createElement(ListaDeAgendamentos, { itens: [] })));
  verdade(h.includes('Novo agendamento'), 'a tela vazia não diz o que fazer');
});

// ── O histórico: a parte que responde «essa mensagem saiu?» ─────────────────────────────────────
const ENVIOS = [
  {
    id: 'e1', status: 'enviado', contatoChave: '5598900000001', ocorrenciaEm: '2026-09-03T11:00:00.000Z',
    tentativaManual: 0, chave: 'aaa',
  },
  {
    id: 'e2', status: 'sem_janela', contatoChave: '5598900000002', ocorrenciaEm: '2026-09-03T11:00:00.000Z',
    tentativaManual: 0, chave: 'bbb',
    erro: 'passaram-se mais de 24 h desde a última mensagem do contato (sem_registro) e este agendamento não tem modelo aprovado configurado — nada foi enviado',
  },
  {
    id: 'e3', status: 'duvidoso', contatoChave: '5598900000003', ocorrenciaEm: '2026-09-03T11:00:00.000Z',
    tentativaManual: 0, chave: 'ccc',
    erro: 'o processo caiu entre a reserva e a confirmação do envio. Pode ter saído — por isso NÃO repito sozinho.',
  },
];
const hist = semMarcas(renderToString(React.createElement(HistoricoDeEnvios, {
  envios: ENVIOS, fuso: 'America/Fortaleza', aoReenviar: nada, ocupado: false,
})));

medir('o histórico mostra o MOTIVO por extenso quando a mensagem não saiu', () => {
  verdade(hist.includes('não tem modelo aprovado configurado'), 'o motivo do «fora da janela» não aparece');
  verdade(hist.includes('NÃO repito sozinho'), 'o motivo da dúvida não aparece');
});

medir('só o que precisa de DECISÃO humana ganha botão de reenviar', () => {
  const botoes = (hist.match(/Reenviar este/g) || []).length;
  igual(botoes, 2, 'botões de reenvio (duvidoso e sem_janela; o enviado NÃO tem)');
});

medir('o reenvio avisa que a tentativa antiga fica no histórico', () => {
  verdade(hist.includes('a tentativa antiga fica no histórico'), 'a tela não avisa que o passado é preservado');
});

medir('sem disparo nenhum, o histórico DIZ isso em vez de mostrar vazio', () => {
  const h = semMarcas(renderToString(React.createElement(HistoricoDeEnvios, { envios: [], fuso: 'America/Fortaleza' })));
  verdade(h.includes('ainda não disparou'), 'histórico vazio não explica');
});

medir('o selo de envio carrega a explicação, não só a cor', () => {
  const h = renderToString(React.createElement(SeloDeEnvio, { status: 'sem_janela' }));
  verdade(h.includes('title='), 'o selo não tem explicação');
  verdade(h.includes('modelo aprovado'), 'a explicação não fala do modelo aprovado');
});

// ── O formulário ────────────────────────────────────────────────────────────────────────────────
const FORM = {
  titulo: '', mensagem: '', cwAccountId: '', cwInboxId: '', cwTeamId: '',
  destinosTexto: '5598983351000\n123', anexoUrl: '', abrirTicket: true,
  fuso: 'America/Fortaleza', recorrencia: 'semanal', intervalo: 2, diasSemana: [2, 4],
  inicioEm: '2026-09-03T08:00', ateEm: '', maxOcorrencias: '',
  usarTemplate: false, templateNome: '', templateIdioma: 'pt_BR',
};
const form = semMarcas(renderToString(React.createElement(FormularioDeAgendamento, {
  valor: FORM, aoMudar: nada, erro: null, previa: [], aoPedirPrevia: nada,
})));

medir('o formulário mostra a normalização dos contatos ENQUANTO se digita', () => {
  verdade(form.includes('1 contato(s) válido(s)'), 'a contagem de válidos não aparece');
  verdade(form.includes('«123»'), 'o número recusado não é mostrado');
});

medir('a conexão é dita como OBRIGATÓRIA no próprio campo', () => {
  verdade(form.includes('sem canal a mensagem não sai'), 'o campo de conexão não explica a obrigatoriedade');
});

medir('sem modelo aprovado, a tela AVISA o que acontece fora da janela de 24 h', () => {
  verdade(form.includes('não será enviada'), 'a tela não avisa o efeito de estar fora da janela');
  verdade(form.includes('Nada some em silêncio'), 'falta a promessa explícita');
});

medir('com modelo marcado, o aviso some e os campos do modelo aparecem', () => {
  const h = semMarcas(renderToString(React.createElement(FormularioDeAgendamento, {
    valor: { ...FORM, usarTemplate: true }, aoMudar: nada, erro: null, previa: [], aoPedirPrevia: nada,
  })));
  verdade(h.includes('Nome do modelo'), 'faltou o campo do nome do modelo');
  verdade(!h.includes('não será enviada'), 'o aviso de «não sai» continuou mesmo com modelo');
});

medir('a recorrência semanal mostra os dias, e a única NÃO mostra', () => {
  verdade(form.includes('Dias da semana'), 'faltaram os dias no semanal');
  const unica = semMarcas(renderToString(React.createElement(FormularioDeAgendamento, {
    valor: { ...FORM, recorrencia: 'unica' }, aoMudar: nada, erro: null, previa: [], aoPedirPrevia: nada,
  })));
  verdade(!unica.includes('Dias da semana'), 'o «uma vez só» mostrou dias da semana');
  verdade(!unica.includes('Ver as próximas datas'), 'o «uma vez só» ofereceu prévia da grade');
});

medir('a prévia da grade é mostrada no fuso do agendamento quando existe', () => {
  const h = semMarcas(renderToString(React.createElement(FormularioDeAgendamento, {
    valor: FORM, aoMudar: nada, erro: null,
    previa: ['2026-09-08T11:00:00.000Z', '2026-09-10T11:00:00.000Z'], aoPedirPrevia: nada,
  })));
  verdade(h.includes('08/09/2026, 08:00'), 'a prévia não apareceu no fuso do cliente');
});

medir('«abrir atendimento» explica o que o desmarcado faz — e o que NÃO faz', () => {
  verdade(form.includes('nunca a que já existia'), 'a tela não diz que conversa preexistente não é fechada');
});

console.log(`\n${'─'.repeat(80)}`);
console.log(falhas === 0
  ? `RESULTADO: ${medicoes} de ${medicoes} medições passaram.`
  : `RESULTADO: ${medicoes - falhas} de ${medicoes} — ${falhas} reprovação(ões).`);
console.log(`${'─'.repeat(80)}\n`);
process.exit(falhas === 0 ? 0 : 1);
