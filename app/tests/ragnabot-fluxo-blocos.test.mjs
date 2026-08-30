#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA EXECUTÁVEL DOS BLOCOS ENRIQUECIDOS DO MOTOR — contrato B-MOTOR
//
// O QUE ESTE ARQUIVO PROVA, e por que cada prova existe:
//
//   1. LISTA com CABEÇALHO e SEÇÕES — é a forma que o bot medido em produção já usa
//      (`menuListaNode` com `header` e `sectionTitle`). Sem ela, migrar os 35 fluxos exigiria jogar
//      fora o agrupamento e entregar um menu corrido de dez linhas.
//   2. LISTA com seções INCOMPLETAS é recusada — com mais de uma seção, a Meta exige título em
//      TODAS e recusa a mensagem inteira quando falta um.
//   3. BOTÃO DE URL sozinho é aceito, e NÃO ESTACIONA — não existe webhook de clique em `cta_url`.
//   4. MISTURA de botão de resposta com botão de URL é RECUSADA NA VALIDAÇÃO — no WhatsApp são dois
//      tipos de mensagem interativa diferentes; a Meta recusa a mensagem INTEIRA e o cliente não
//      recebe nada. É a prova mais importante deste arquivo.
//   5. E-MAIL é enviado PELA PORTA (dublê), com as variáveis já interpoladas, e nada do texto do
//      cliente vira HTML vivo na caixa de quem recebe.
//   6. E-MAIL com destinatário inválido é recusado NA VALIDAÇÃO (antes e depois de interpolar).
//   7. FLUXO ANTIGO, sem nenhum campo novo, continua válido e produz a intenção de antes.
//
// NÃO TOCA BANCO NEM REDE de propósito: são executores puros, e a porta de e-mail é injetada. Um
// teste que precisasse de Postgres de pé (ou que mandasse e-mail de verdade) é um teste que ninguém
// roda duas vezes.
//
// COMO RODAR
//     node tests/ragnabot-fluxo-blocos.test.mjs
//     VERBOSE=1 node tests/ragnabot-fluxo-blocos.test.mjs   (mostra a pilha do erro)
//
// CÓDIGOS DE SAÍDA:  0 = tudo verde   1 = alguma verificação reprovou   3 = erro inesperado
//
// ⚠️ FORA DO GLOB DO VITEST DE PROPÓSITO: o corredor varre só `tests/**/*.test.js`. NOC 2026-08-29.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  EXECUTORES,
  validarNo,
  prepararNo,
  saidasDe,
  noEstaciona,
  enviarEmailDaIntencao,
} from '../src/services/ragnabot-fluxo-nos.service.js';

const VERBOSE = !!process.env.VERBOSE;
let passou = 0; let falhou = 0;

async function verificar(titulo, fn) {
  try {
    const detalhe = await fn();
    passou += 1;
    console.log(`  ✓ ${titulo}`);
    if (detalhe !== undefined) console.log(`      → ${JSON.stringify(detalhe)}`);
  } catch (e) {
    falhou += 1;
    console.log(`  ✗ ${titulo}`);
    console.log(`      ${e.message}`);
    if (VERBOSE) console.log(e.stack);
  }
}

/** Só os problemas BLOQUEANTES. Aviso não impede publicação e não pode reprovar uma prova de aceite. */
const errosDe = (problemas) => problemas.filter((p) => p.nivel === 'erro');
const codigos = (problemas) => problemas.map((p) => `${p.nivel}:${p.codigo}@${p.campo}`);

// A escada de exceção que todo nó que estaciona precisa declarar (§4.4).
const EXCECOES_OK = {
  semResposta: { tentativas: 2, reforco: 'Ainda está aí?', acaoFinal: 'transferir_time', time: 'Suporte' },
  opcaoInvalida: { tentativas: 2, reforco: 'Não entendi, pode escolher uma das opções?', acaoFinal: 'transferir_time', time: 'Suporte' },
};

console.log('\nBLOCOS DO MOTOR — lista com cabeçalho/seções, botões com URL, bloco de e-mail\n');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. LISTA — cabeçalho e seções
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const listaComSecoes = {
  id: 'menu',
  tipo: 'lista',
  config: {
    cabecalho: '*RAGNATELA IOT SOLUTIONS*',
    // Forma de BLOCO com reserva: §4.6 exige reserva para toda variável interpolada em campo com
    // teto — sem ela o tamanho final depende de texto que o cliente ainda vai escrever.
    corpo: { texto: 'Olá, {{nome}}! Escolha uma opção do menu.', reserva: { nome: 40 } },
    rodape: 'Atendimento 24h',
    rotuloBotao: 'ESCOLHA UMA OPÇÃO',
    esperaResposta: { valor: 4, unidade: 'minutos' },
    excecoes: EXCECOES_OK,
    itens: [
      { id: 'suporte', titulo: 'Suporte', descricao: 'Abra um chamado técnico', secao: 'Técnico' },
      { id: 'rede', titulo: 'Rede lenta', descricao: 'Problemas de velocidade', secao: 'Técnico' },
      { id: 'boleto', titulo: 'Segunda via', descricao: 'Boleto do mês', secao: 'Financeiro' },
    ],
  },
};

await verificar('1. lista com cabeçalho e seções é VÁLIDA', () => {
  const p = validarNo(listaComSecoes, { vars: {} });
  assert.deepEqual(errosDe(p), [], `problemas: ${JSON.stringify(codigos(p))}`);
  return { erros: 0, avisos: p.length };
});

await verificar('2. preparar() monta cabeçalho, seções agrupadas E mantém `itens` plano', () => {
  const [i] = prepararNo(listaComSecoes, { vars: { nome: 'Emmanuel' } });
  assert.equal(i.cabecalho, '*RAGNATELA IOT SOLUTIONS*');
  assert.equal(i.corpo, 'Olá, Emmanuel! Escolha uma opção do menu.');
  assert.equal(i.secoes.length, 2, 'deveria haver duas seções');
  assert.deepEqual(i.secoes.map((s) => s.titulo), ['Técnico', 'Financeiro']);
  assert.deepEqual(i.secoes[0].itens.map((x) => x.id), ['suporte', 'rede']);
  assert.deepEqual(i.secoes[1].itens.map((x) => x.id), ['boleto']);
  // O array plano é o que o motor congela (`congelarNo` lê `i.itens || i.botoes`) e o que a escada
  // de casamento percorre quando a pessoa responde «2» em vez de tocar a linha.
  assert.deepEqual(i.itens.map((x) => x.id), ['suporte', 'rede', 'boleto']);
  return {
    cabecalho: i.cabecalho,
    secoes: i.secoes.map((s) => ({ titulo: s.titulo, itens: s.itens.map((x) => x.id) })),
    itensPlanos: i.itens.map((x) => x.id),
  };
});

await verificar('3. seção sem título ao lado de seções com título é ERRO (a Meta exige título em todas)', () => {
  const no = JSON.parse(JSON.stringify(listaComSecoes));
  delete no.config.itens[2].secao; // o item "boleto" fica solto
  const p = errosDe(validarNo(no, {}));
  assert.ok(p.some((x) => x.campo === 'config.itens[2].secao'), `esperava erro no item solto: ${JSON.stringify(codigos(p))}`);
  return { erros: codigos(p) };
});

await verificar('4. cabeçalho acima de 60 caracteres é ERRO (a Meta recusa a mensagem inteira)', () => {
  const no = JSON.parse(JSON.stringify(listaComSecoes));
  no.config.cabecalho = 'R'.repeat(75);
  const p = errosDe(validarNo(no, {}));
  assert.ok(p.some((x) => x.campo === 'config.cabecalho' && x.codigo === 'LIMITE_EXCEDIDO'), JSON.stringify(codigos(p)));
  return { erro: p.find((x) => x.campo === 'config.cabecalho').mensagem.slice(0, 90) };
});

await verificar('5. seções em pedaços separados geram AVISO de reordenação (não erro)', () => {
  const no = JSON.parse(JSON.stringify(listaComSecoes));
  no.config.itens[1].secao = 'Financeiro'; // Técnico, Financeiro, Financeiro→ ainda contíguo
  no.config.itens[2].secao = 'Técnico';    // ... agora Técnico volta depois: não é contíguo
  const p = validarNo(no, {});
  assert.deepEqual(errosDe(p), [], 'não pode ser erro — a mensagem sai e funciona');
  assert.ok(p.some((x) => x.nivel === 'aviso' && x.campo === 'config.itens'), JSON.stringify(codigos(p)));
  return { aviso: p.find((x) => x.nivel === 'aviso' && x.campo === 'config.itens').mensagem.slice(0, 110) };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. BOTÕES — URL sozinho, e a recusa da mistura
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const botoesUrl = {
  id: 'link',
  tipo: 'botoes',
  config: {
    cabecalho: 'Segunda via',
    corpo: { texto: 'Seu boleto do protocolo {{protocolo}} está pronto.', reserva: { protocolo: 30 } },
    rodape: 'Ragnatela IoT',
    botoes: [
      { id: 'abrir', rotulo: 'Abrir boleto', tipo: 'url', url: 'https://ragnatela.com.br/2via/{{protocolo}}' },
    ],
  },
};

await verificar('6. botão de URL SOZINHO é válido — sem exigir tempo limite nem escada de exceção', () => {
  const p = validarNo(botoesUrl, {});
  assert.deepEqual(errosDe(p), [], `problemas: ${JSON.stringify(codigos(p))}`);
  return { erros: 0, avisos: codigos(p) };
});

await verificar('7. botão de URL NÃO ESTACIONA: saída única `padrao`, sem sem_resposta/opcao_invalida', () => {
  const saidas = saidasDe(botoesUrl);
  assert.equal(noEstaciona(botoesUrl), false, 'nó de URL não pode estacionar');
  assert.ok(!saidas.includes('sem_resposta'), `saídas: ${JSON.stringify(saidas)}`);
  assert.ok(!saidas.includes('opcao_invalida'), `saídas: ${JSON.stringify(saidas)}`);
  assert.ok(saidas.includes('padrao'));
  return { saidas, estaciona: noEstaciona(botoesUrl) };
});

await verificar('8. executar() em modo URL devolve seguir/padrao (não `aguardar`)', async () => {
  const ctx = { no: botoesUrl, vars: { protocolo: 'RGT-2026-000123' } };
  const r = await EXECUTORES.botoes.executar(ctx);
  assert.equal(r.tipo, 'seguir');
  assert.equal(r.saida, 'padrao');
  const [i] = prepararNo(botoesUrl, ctx);
  assert.equal(i.modo, 'url');
  assert.equal(i.botoes[0].tipo, 'url');
  assert.equal(i.botoes[0].url, 'https://ragnatela.com.br/2via/RGT-2026-000123');
  return { resultado: r, modo: i.modo, url: i.botoes[0].url, cabecalho: i.cabecalho };
});

const botoesMisturados = {
  id: 'misto',
  tipo: 'botoes',
  config: {
    corpo: 'Confirma a abertura do chamado?',
    esperaResposta: { valor: 4, unidade: 'minutos' },
    excecoes: EXCECOES_OK,
    botoes: [
      { id: 'sim', rotulo: 'Sim, claro! 💚' },
      { id: 'nao', rotulo: 'Agora não' },
      { id: 'site', rotulo: 'Ver no site', tipo: 'url', url: 'https://ragnatela.com.br/chamados' },
    ],
  },
};

await verificar('9. ⚠️ MISTURA de botão de resposta com botão de URL é RECUSADA na validação', () => {
  const p = errosDe(validarNo(botoesMisturados, {}));
  const misto = p.find((x) => x.codigo === 'BOTOES_MISTURADOS');
  assert.ok(misto, `esperava BOTOES_MISTURADOS; veio ${JSON.stringify(codigos(p))}`);
  assert.match(misto.mensagem, /recusa a mensagem INTEIRA/);
  return { codigo: misto.codigo, campo: misto.campo, mensagem: misto.mensagem.slice(0, 150), comoCorrigir: misto.comoCorrigir.slice(0, 80) };
});

await verificar('10. a mistura também é recusada em EXECUÇÃO (fluxo publicado por outro caminho)', async () => {
  const r = await EXECUTORES.botoes.executar({ no: botoesMisturados, vars: {} });
  assert.equal(r.tipo, 'falhar');
  assert.equal(r.saida, 'erro');
  assert.equal(r.incidente.codigo, 'BOTOES_MISTURADOS');
  return { saida: r.saida, codigo: r.incidente.codigo, aoCliente: r.incidente.mensagemCliente };
});

await verificar('11. dois botões de URL na mesma mensagem são recusados (cta_url leva UM)', () => {
  const no = JSON.parse(JSON.stringify(botoesUrl));
  no.config.botoes.push({ id: 'outro', rotulo: 'Ver contrato', tipo: 'url', url: 'https://ragnatela.com.br/contrato' });
  const p = errosDe(validarNo(no, {}));
  assert.ok(p.some((x) => x.codigo === 'LIMITE_EXCEDIDO' && x.campo === 'config.botoes'), JSON.stringify(codigos(p)));
  return { erros: codigos(p) };
});

await verificar('12. URL com variável na posição do HOST é recusada', () => {
  const no = JSON.parse(JSON.stringify(botoesUrl));
  no.config.botoes[0].url = 'https://{{dominio}}/2via';
  const p = errosDe(validarNo(no, {}));
  assert.ok(p.some((x) => x.codigo === 'BOTAO_URL_INVALIDA'), JSON.stringify(codigos(p)));
  return { erro: p.find((x) => x.codigo === 'BOTAO_URL_INVALIDA').mensagem.slice(0, 110) };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. E-MAIL — a porta injetada, as variáveis, e o destinatário inválido
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const noEmailValido = {
  id: 'comprovante',
  tipo: 'email',
  config: {
    para: '{{email_do_contato}}',
    assunto: 'Chamado {{protocolo}} registrado',
    corpo: 'Olá, {{nome}}!\n\nSeu chamado {{protocolo}} foi registrado.\n\nResumo: {{detalhes}}',
    responderPara: 'atendimento@ragnatela.com.br',
  },
};

await verificar('13. bloco de e-mail é VÁLIDO e não estaciona', () => {
  const p = validarNo(noEmailValido, {});
  assert.deepEqual(errosDe(p), [], JSON.stringify(codigos(p)));
  assert.equal(noEstaciona(noEmailValido), false);
  assert.deepEqual(saidasDe(noEmailValido), ['padrao', 'erro']);
  return { saidas: saidasDe(noEmailValido), estaciona: false, avisos: codigos(p) };
});

await verificar('14. e-mail é ENVIADO PELA PORTA (dublê) com as variáveis interpoladas', async () => {
  const enviados = [];
  const dubleSmtp = {
    sendEmail: async (msg) => { enviados.push(msg); return { messageId: '<dublê-1@ragnatela>', response: '250 OK' }; },
  };
  const ctx = {
    no: noEmailValido,
    vars: {
      email_do_contato: 'cliente@empresa.com.br',
      protocolo: 'RGT-2026-000123',
      nome: 'Emmanuel',
      detalhes: 'A internet cai toda tarde <script>alert(1)</script>',
    },
  };

  const r = await EXECUTORES.email.executar(ctx);
  assert.equal(r.tipo, 'seguir');
  assert.equal(r.saida, 'padrao');

  const [intencao] = prepararNo(noEmailValido, ctx);
  const envio = await enviarEmailDaIntencao(intencao, { email: dubleSmtp });

  assert.equal(enviados.length, 1, 'a porta deveria ter recebido exatamente um envio');
  const msg = enviados[0];
  assert.equal(msg.to, 'cliente@empresa.com.br');
  assert.equal(msg.subject, 'Chamado RGT-2026-000123 registrado');
  assert.match(msg.text, /Olá, Emmanuel!/);
  assert.match(msg.text, /Seu chamado RGT-2026-000123 foi registrado\./);
  // O que o cliente digitou NÃO pode chegar como HTML vivo na caixa de quem recebe.
  assert.ok(!msg.html.includes('<script>'), 'o HTML não pode conter a etiqueta crua do cliente');
  assert.match(msg.html, /&lt;script&gt;/);
  assert.equal(msg.replyTo, 'atendimento@ragnatela.com.br');
  assert.equal(envio.idExterno, '<dublê-1@ragnatela>');

  return {
    to: msg.to,
    subject: msg.subject,
    textoPrimeiraLinha: msg.text.split('\n')[0],
    htmlEscapou: msg.html.includes('&lt;script&gt;'),
    replyTo: msg.replyTo,
    idExterno: envio.idExterno,
  };
});

await verificar('15. destinatário SEM @ é recusado NA VALIDAÇÃO (literal)', () => {
  const no = { id: 'e2', tipo: 'email', config: { para: 'fulano.exemplo.com', assunto: 'Oi', corpo: 'Texto' } };
  const p = errosDe(validarNo(no, {}));
  const d = p.find((x) => x.codigo === 'EMAIL_DESTINO_INVALIDO');
  assert.ok(d, JSON.stringify(codigos(p)));
  return { codigo: d.codigo, campo: d.campo, mensagem: d.mensagem };
});

await verificar('16. destinatário inválido DEPOIS DE INTERPOLAR também é recusado na validação', () => {
  const no = { id: 'e3', tipo: 'email', config: { para: '{{email}}', assunto: 'Oi', corpo: 'Texto' } };
  const semValores = errosDe(validarNo(no, {}));
  assert.deepEqual(semValores, [], 'sem valores não há o que julgar — não pode reprovar na publicação');
  const comValores = errosDe(validarNo(no, { vars: { email: 'nao-e-email' } }));
  const d = comValores.find((x) => x.codigo === 'EMAIL_DESTINO_INVALIDO');
  assert.ok(d, JSON.stringify(codigos(comValores)));
  return { semValores: 0, comValores: d.mensagem };
});

await verificar('17. em EXECUÇÃO, variável vazia no destinatário falha por `erro` SEM enviar nada', async () => {
  const enviados = [];
  const no = { id: 'e4', tipo: 'email', config: { para: '{{email}}', assunto: 'Oi', corpo: 'Texto' } };
  const r = await EXECUTORES.email.executar({ no, vars: {} });
  assert.equal(r.tipo, 'falhar');
  assert.equal(r.saida, 'erro');
  assert.equal(r.incidente.codigo, 'EMAIL_DESTINO_INVALIDO');
  assert.equal(enviados.length, 0);
  return { saida: r.saida, codigo: r.incidente.codigo, aoOperador: r.incidente.mensagemOperador.slice(0, 110) };
});

await verificar('18. injeção de cabeçalho pelo assunto é neutralizada (CRLF some)', () => {
  const no = {
    id: 'e5',
    tipo: 'email',
    config: { para: 'cliente@empresa.com.br', assunto: 'Chamado {{assunto}}', corpo: 'Texto' },
  };
  const [i] = prepararNo(no, { vars: { assunto: 'urgente\r\nBcc: espiao@fora.com' } });
  assert.ok(!/[\r\n]/.test(i.assunto), `o assunto não pode ter quebra de linha: ${JSON.stringify(i.assunto)}`);
  assert.ok(!i.assunto.includes('\r'), 'CR não pode sobreviver');
  return { assunto: i.assunto };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. COMPATIBILIDADE — fluxo antigo, sem nenhum campo novo
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const listaAntiga = {
  id: 'menu_antigo',
  tipo: 'lista',
  config: {
    corpo: 'Escolha uma opção',
    rotuloBotao: 'Escolher',
    esperaResposta: { valor: 4, unidade: 'minutos' },
    excecoes: EXCECOES_OK,
    itens: [
      { id: 'a', titulo: 'Opção A' },
      { id: 'b', titulo: 'Opção B' },
    ],
  },
};

const botoesAntigos = {
  id: 'confirma_antigo',
  tipo: 'botoes',
  config: {
    corpo: 'Confirma?',
    esperaResposta: { valor: 4, unidade: 'minutos' },
    excecoes: EXCECOES_OK,
    botoes: [{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }],
  },
};

await verificar('19. fluxo ANTIGO (sem cabeçalho, sem seção, sem tipo de botão) continua válido', () => {
  const pl = validarNo(listaAntiga, {});
  const pb = validarNo(botoesAntigos, {});
  assert.deepEqual(errosDe(pl), [], JSON.stringify(codigos(pl)));
  assert.deepEqual(errosDe(pb), [], JSON.stringify(codigos(pb)));
  return { listaErros: 0, botoesErros: 0 };
});

await verificar('20. fluxo ANTIGO produz a MESMA intenção de antes (sem cabecalho, sem secoes)', () => {
  const [il] = prepararNo(listaAntiga, { vars: {} });
  const [ib] = prepararNo(botoesAntigos, { vars: {} });
  assert.equal(il.cabecalho, undefined, 'lista antiga não pode ganhar cabeçalho do nada');
  assert.equal(il.secoes, undefined, 'lista antiga não pode ganhar seções do nada');
  assert.equal(ib.cabecalho, undefined);
  assert.equal(ib.modo, 'resposta', 'botão sem tipo é botão de resposta');
  assert.deepEqual(ib.botoes.map((b) => b.tipo), ['resposta', 'resposta']);
  assert.deepEqual(ib.botoes.map((b) => b.url), [undefined, undefined]);
  // Serialização: os campos novos não aparecem no JSON do que sai para a porta do canal.
  const jsonLista = JSON.stringify(il);
  assert.ok(!jsonLista.includes('"secoes"'), jsonLista.slice(0, 200));
  assert.ok(!jsonLista.includes('"cabecalho"'), jsonLista.slice(0, 200));
  return { listaChaves: Object.keys(JSON.parse(jsonLista)), botoesModo: ib.modo, estacionaBotoes: noEstaciona(botoesAntigos) };
});

await verificar('21. botões de RESPOSTA seguem estacionando e com uma saída por botão', () => {
  const saidas = saidasDe(botoesAntigos);
  assert.equal(noEstaciona(botoesAntigos), true);
  assert.ok(saidas.includes('sim') && saidas.includes('nao'));
  assert.ok(saidas.includes('sem_resposta') && saidas.includes('opcao_invalida'));
  return { saidas, estaciona: true };
});

await verificar('22. o catálogo ganhou `email` e continua entregando os tipos antigos', () => {
  assert.ok(EXECUTORES.email, 'EXECUTORES.email precisa existir');
  const tipos = Object.keys(EXECUTORES);
  assert.equal(tipos.length, 17);
  for (const t of ['inicio', 'texto', 'lista', 'botoes', 'http', 'chamado', 'encerrar']) {
    assert.ok(tipos.includes(t), `tipo ${t} sumiu`);
  }
  return { tipos: tipos.length, novo: 'email' };
});

await verificar('23. assunto de e-mail acima do teto é AVISO (não erro) e sai cortado', () => {
  const no = {
    id: 'e6',
    tipo: 'email',
    // Texto com ESPAÇOS de propósito: uma sequência de 260 letras coladas dispara o detector de
    // segredo literal (`/[A-Za-z0-9+/]{40,}/`) — que é o comportamento certo dele, e não o que esta
    // verificação quer medir.
    config: { para: 'cliente@empresa.com.br', assunto: 'Chamado registrado com sucesso pela Ragnatela '.repeat(6), corpo: 'Texto' },
  };
  const p = validarNo(no, {});
  assert.deepEqual(errosDe(p), [], 'não pode ser erro — o e-mail sai, só o assunto encurta');
  const a = p.find((x) => x.nivel === 'aviso' && x.campo === 'config.assunto');
  assert.ok(a, JSON.stringify(codigos(p)));
  const [i] = prepararNo(no, { vars: {} });
  assert.ok(i.assunto.length <= 200, `assunto ficou com ${i.assunto.length}`);
  assert.ok(i.assunto.endsWith('…'), i.assunto.slice(-10));
  return { avisoNivel: a.nivel, tamanhoOriginal: no.config.assunto.length, tamanhoFinal: i.assunto.length, terminaEm: i.assunto.slice(-3) };
});

await verificar('24. `para` e `copiaOculta` são TEXTO com vírgula (formato que o editor grava)', async () => {
  const enviados = [];
  const no = {
    id: 'e7',
    tipo: 'email',
    config: {
      para: 'cliente@empresa.com.br, financeiro@empresa.com.br',
      copiaOculta: 'auditoria@ragnatela.com.br, arquivo@ragnatela.com.br',
      assunto: 'Comprovante {{protocolo}}',
      corpo: 'Segue o comprovante do chamado {{protocolo}}.',
    },
  };
  assert.deepEqual(errosDe(validarNo(no, {})), [], JSON.stringify(codigos(validarNo(no, {}))));

  const ctx = { no, vars: { protocolo: 'RGT-2026-000777' } };
  const [i] = prepararNo(no, ctx);
  assert.deepEqual(i.paraLista, ['cliente@empresa.com.br', 'financeiro@empresa.com.br']);
  assert.deepEqual(i.copiaOculta, ['auditoria@ragnatela.com.br', 'arquivo@ragnatela.com.br']);

  await enviarEmailDaIntencao(i, { email: { sendEmail: async (m) => { enviados.push(m); return { messageId: '<x@y>' }; } } });
  assert.equal(enviados[0].to, 'cliente@empresa.com.br, financeiro@empresa.com.br');
  assert.equal(enviados[0].bcc, 'auditoria@ragnatela.com.br, arquivo@ragnatela.com.br');
  return { to: enviados[0].to, bcc: enviados[0].bcc, subject: enviados[0].subject };
});

await verificar('25. UM endereço ruim no meio da lista já reprova na validação', () => {
  const no = {
    id: 'e8',
    tipo: 'email',
    config: { para: 'bom@empresa.com.br, ruim-sem-arroba, outro@empresa.com.br', assunto: 'Oi', corpo: 'Texto' },
  };
  const p = errosDe(validarNo(no, {}));
  const d = p.find((x) => x.codigo === 'EMAIL_DESTINO_INVALIDO');
  assert.ok(d, JSON.stringify(codigos(p)));
  assert.equal(d.campo, 'config.para[1]', `esperava o índice do endereço ruim; veio ${d.campo}`);
  return { campo: d.campo, mensagem: d.mensagem };
});

await verificar('26. variável que traz DOIS endereços dentro é separada e validada um a um', () => {
  const no = { id: 'e9', tipo: 'email', config: { para: '{{copias}}', assunto: 'Oi', corpo: 'Texto' } };
  const bons = errosDe(validarNo(no, { vars: { copias: 'a@x.com.br, b@y.com.br' } }));
  assert.deepEqual(bons, [], JSON.stringify(codigos(bons)));
  const ruins = errosDe(validarNo(no, { vars: { copias: 'a@x.com.br, sem-arroba' } }));
  assert.ok(ruins.some((x) => x.codigo === 'EMAIL_DESTINO_INVALIDO'), JSON.stringify(codigos(ruins)));
  const [i] = prepararNo(no, { vars: { copias: 'a@x.com.br, b@y.com.br' } });
  assert.deepEqual(i.paraLista, ['a@x.com.br', 'b@y.com.br']);
  return { validos: 0, invalidos: ruins.length, paraLista: i.paraLista };
});

console.log(`\nRESULTADO: ${passou} verde(s), ${falhou} vermelho(s)\n`);
process.exit(falhou ? 1 : 0);
