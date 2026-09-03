// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE PROVEDOR DE CANAL — quem OPERA a conexão, separado do que a conexão SABE FAZER.
//
// Contrato S6 (02/09/2026), doc 34 §F9.2.2. É o item marcado como prioridade no contrato pela
// razão certa: ele **independe da decisão comercial do dono** (caminho A/B/C do doc 34 §F9) e é o
// que permite decidir DEPOIS sem reescrever.
//
// ── A DISTINÇÃO QUE ESTE ARQUIVO EXISTE PARA MANTER ─────────────────────────────────────────────
//   CANAL     = o meio pelo qual o cliente fala.        whatsapp · instagram · web_widget · …
//   PROVEDOR  = quem opera esse meio para nós.          meta_direto · whatsmeow · terceiro · nativo
// São eixos INDEPENDENTES. O mesmo WhatsApp pode chegar pela Cloud API oficial (meta_direto), por
// uma sessão não-oficial (whatsmeow) ou por um intermediário (terceiro) — e o que muda para o
// motor de fluxo NÃO é «quem opera», é «o que dá para mandar»: botão, lista, modelo aprovado,
// anexo. Foi assim que o `ragnabot-canal.porta.js` já estava escrito, e o cabeçalho dele previu
// este arquivo com todas as letras: *"Quando a camada de provedor existir, ela entra em
// `descobrirCanal` — o resto deste arquivo não muda, porque só depende da CAPACIDADE do canal,
// não de quem o opera."*
//
// ── ⛔ A LEI DESTE ARQUIVO: O PROVEDOR NÃO VAZA PARA O MOTOR ────────────────────────────────────
// Nenhum nó, nenhuma máquina de estado e nenhum despacho pode conter `if (provedor === …)`.
// O único ponto de contato é `capacidadeEfetiva()`, cujo RESULTADO tem exatamente a mesma forma
// de `CAPACIDADES[canal]` — o motor continua lendo `capacidade.interativo`, `capacidade.botoesMax`,
// e não sabe que existe provedor. Trocar o provedor de uma conexão é UPDATE de uma coluna.
// Isto é medido: `tests/ragnabot-provedor.test.mjs` varre o motor, os nós e a fila atrás dos nomes
// dos provedores e exige ZERO ocorrências.
//
// ── ⚠️ POR QUE EXISTE UM QUARTO VALOR (`nativo`), FORA DOS TRÊS DO DOCUMENTO ────────────────────
// O doc 34 §F9.2.2 escreve `meta_direto | whatsmeow | terceiro`, e os três dizem respeito a
// WhatsApp/redes da Meta. Mas metade das conexões da casa não é disso: o widget do site, o e-mail
// e o bot do Telegram são operados pela PRÓPRIA plataforma, sem provedor externo nenhum. Marcar um
// widget como «meta_direto» seria gravar uma mentira no banco para caber num enum — e mentira em
// coluna de cadastro reaparece como decisão errada meses depois. `nativo` diz a verdade: não há
// terceiro no caminho.
//
// ── ⚠️ O QUE NÃO ESTÁ MEDIDO, e está declarado ─────────────────────────────────────────────────
// Em 02/09/2026 a casa tem ZERO conexões de WhatsApp e ZERO instâncias de Whatsmeow. As
// capacidades de `whatsmeow` e `terceiro` abaixo vêm de LEITURA (o que a biblioteca e os portais
// medidos no doc 34 §F9.0 expõem), não de observação. Por isso cada uma carrega `origem:` — igual
// ao que `RagnabotFluxoLimiteCanal` faz com os limites da Meta, e pelo mesmo motivo: palpite que se
// declara palpite não corrói a confiança no que é regra.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { CAPACIDADES, capacidadeDoCanal } from './ragnabot-canal.porta.js';

/** Os provedores que o cadastro aceita. Valor gravado em `RagnabotInbox.provedor`. */
export const PROVEDORES = Object.freeze({
  // A plataforma fala com a Graph API da Meta usando a credencial da WABA da própria empresa.
  // É o caminho A do doc 34 §F9 — o que sustenta contrato com hospital e provedor.
  meta_direto: Object.freeze({
    id: 'meta_direto',
    rotulo: 'Meta (direto)',
    descricao: 'A conexão fala com a Meta usando a conta comercial da própria empresa. Oficial, sem intermediário.',
    canais: Object.freeze(['whatsapp', 'instagram', 'facebook']),
    oficial: true,
    // Reinício = religar o canal no operador. Aqui não há sessão a religar: a credencial é estática.
    podeReiniciar: false,
    // Alguém precisa apontar o webhook da Meta para nós.
    entrada: 'webhook',
    exigeSegredo: true,
    // Sem restrição: as CAPACIDADES do canal já são as da Cloud API oficial.
    restricoes: null,
    origem: 'medido', // é o que a casa usa hoje nas 4 conexões da conta 1
  }),

  // Sessão não-oficial (biblioteca whatsmeow, o «api whats» da tela 33 do doc 34 §F8.13).
  // Caminho B: o cliente entra em minutos lendo um QR. O risco de banimento é NOSSO.
  whatsmeow: Object.freeze({
    id: 'whatsmeow',
    rotulo: 'WhatsApp por sessão (não-oficial)',
    descricao: 'Sessão de aparelho lida por QR. Entra em minutos e não passa pela Meta — e por isso o número pode ser banido por ela.',
    canais: Object.freeze(['whatsapp']),
    oficial: false,
    podeReiniciar: true, // é o caso de uso REAL do «reiniciar conexão» (F9.2.5): a sessão cai
    entrada: 'sessao',
    exigeSegredo: true,
    restricoes: Object.freeze({
      // Modelo aprovado pela Meta (HSM) não existe fora da Cloud API — quem manda por sessão manda
      // texto. Deixar `template: true` faria o motor tentar um envio que o provedor não sabe fazer,
      // e a recusa chegaria como erro cru no meio de um atendimento.
      template: false,
      // A sessão manda mensagem interativa, mas os limites são os do aplicativo, não os da Cloud
      // API. Enquanto ninguém MEDIU, vale o pior caso: texto numerado.
      interativo: false,
      botoesMax: 0,
      listaMax: 0,
    }),
    origem: 'documentacao',
  }),

  // Intermediário externo (ConnectAi / OficialAPI, medidos no doc 34 §F9.0). Caminho C.
  // ⚠️ Decisão registrada do dono: NÃO adotar. Existe aqui como VALOR do cadastro para que a
  // camada seja completa e a decisão possa mudar sem migração — não como recomendação.
  terceiro: Object.freeze({
    id: 'terceiro',
    rotulo: 'Intermediário externo',
    descricao: 'Portal de terceiro no caminho da mensagem. A conversa do cliente transita pela infraestrutura de outra empresa.',
    canais: Object.freeze(['whatsapp', 'instagram', 'facebook', 'telegram']),
    oficial: false,
    podeReiniciar: true,
    entrada: 'webhook',
    exigeSegredo: true,
    restricoes: Object.freeze({
      // Cada intermediário traduz o interativo do jeito dele, e nenhum documenta o limite.
      interativo: false, botoesMax: 0, listaMax: 0, template: false,
    }),
    origem: 'documentacao',
    // Sinalizado para a tela poder avisar, e para o relatório poder contar quantas conexões estão
    // fora da decisão do dono.
    contraDecisaoRegistrada: true,
  }),

  // A própria plataforma opera o canal. Site, e-mail e Telegram — não há terceiro no caminho.
  nativo: Object.freeze({
    id: 'nativo',
    rotulo: 'Plataforma (nativo)',
    descricao: 'Canal operado pela própria plataforma de atendimento. Sem provedor externo.',
    canais: Object.freeze(['web_widget', 'email', 'telegram', 'api']),
    oficial: true,
    podeReiniciar: false,
    entrada: 'webhook',
    exigeSegredo: false,
    restricoes: null,
    origem: 'medido',
  }),
});

export const IDS_DE_PROVEDOR = Object.freeze(Object.keys(PROVEDORES));

/** O provedor que um canal ganha quando ninguém escolheu. Nunca `null`: coluna de cadastro sem
 *  valor obriga todo leitor a decidir o padrão por conta própria, e é assim que dois lugares
 *  passam a discordar. */
export function provedorPadraoDoCanal(channelType) {
  const c = String(channelType || '').toLowerCase();
  if (c === 'whatsapp' || c === 'instagram' || c === 'facebook') return 'meta_direto';
  if (c in CAPACIDADES) return 'nativo';
  // Canal que não conhecemos: `nativo` é o mais conservador — não promete nada de terceiro.
  return 'nativo';
}

export function provedorExiste(id) {
  return Object.prototype.hasOwnProperty.call(PROVEDORES, String(id || ''));
}

/** Ficha do provedor, sem poder ser mutada por quem chama. `null` para id desconhecido. */
export function provedor(id) {
  return provedorExiste(id) ? PROVEDORES[id] : null;
}

/**
 * O provedor combina com este canal?
 *
 * @returns {{permitido:boolean, motivo?:string}}
 *   Recusa NOMEADA, sempre — «provedor inválido» não diz a ninguém o que fazer a seguir.
 */
export function combina(channelType, idProvedor) {
  const canal = String(channelType || '').toLowerCase();
  if (!provedorExiste(idProvedor)) {
    return { permitido: false, motivo: `Provedor "${idProvedor}" não existe. Conhecidos: ${IDS_DE_PROVEDOR.join(', ')}.` };
  }
  const p = PROVEDORES[idProvedor];
  if (!p.canais.includes(canal)) {
    return {
      permitido: false,
      motivo: `O provedor "${p.rotulo}" não opera o canal "${canal}". Ele opera: ${p.canais.join(', ')}.`,
    };
  }
  return { permitido: true };
}

/**
 * Normaliza o que veio da tela ou do banco.
 *
 * Regra: valor ausente → o padrão do canal. Valor INVÁLIDO para o canal → também o padrão, **com
 * aviso**, nunca uma exceção. Motivo: esta função é chamada no caminho de LEITURA, dentro do
 * despacho de mensagem. Uma linha de cadastro estragada (provedor de WhatsApp numa conexão que
 * virou e-mail) não pode derrubar o atendimento — ela degrada para o padrão e grita no log.
 * Quem PRECISA recusar é a escrita, e ela usa `combina()` diretamente.
 */
export function normalizarProvedor(valor, channelType, { avisar = null } = {}) {
  const padrao = provedorPadraoDoCanal(channelType);
  if (!valor) return padrao;
  const v = String(valor).toLowerCase();
  const veredito = combina(channelType, v);
  if (veredito.permitido) return v;
  avisar?.(`[provedor] ${veredito.motivo} — tratando a conexão como "${padrao}".`);
  return padrao;
}

/**
 * A CAPACIDADE EFETIVA — o único ponto de contato com o resto do sistema.
 *
 * Parte da capacidade do CANAL e aplica as restrições do PROVEDOR. O resultado tem exatamente a
 * mesma forma de `CAPACIDADES[canal]`, e é isso que mantém o motor sem saber que provedor existe.
 *
 * ⚠️ A composição é sempre RESTRITIVA, nunca expansiva: um provedor pode tirar capacidade, nunca
 * acrescentar. Se um provedor novo fizer algo que o canal não faz, o lugar de mudar é a tabela
 * `CAPACIDADES` do canal — porque aí a novidade é do CANAL, e vale para todo mundo que o usa.
 * Deixar provedor ampliar capacidade seria a porta pela qual «botão no Telegram» entraria sem
 * ninguém revisar o despacho que desenha o botão.
 */
export function capacidadeEfetiva(channelType, idProvedor, { avisar = null } = {}) {
  const base = capacidadeDoCanal(channelType);
  const id = normalizarProvedor(idProvedor, channelType, { avisar });
  const p = PROVEDORES[id];
  if (!p?.restricoes) return base;

  const efetiva = { ...base };
  for (const [chave, limite] of Object.entries(p.restricoes)) {
    const atual = efetiva[chave];
    if (typeof limite === 'boolean') {
      // `false` desliga; `true` NÃO liga o que o canal não tem (regra restritiva acima).
      efetiva[chave] = limite === false ? false : atual;
    } else if (typeof limite === 'number' && typeof atual === 'number') {
      efetiva[chave] = Math.min(atual, limite);
    }
  }
  // Coerência: sem interativo, não há botão nem item de lista. Deixar `botoesMax: 3` com
  // `interativo: false` é um estado que só confunde quem lê o diagnóstico.
  if (!efetiva.interativo) { efetiva.botoesMax = 0; efetiva.listaMax = 0; }
  return Object.freeze(efetiva);
}

/**
 * O catálogo para a TELA: o que se pode escolher para um canal, e o que muda ao escolher.
 * Serve à tela de Conexões (F9.2.3) e à de Caixas de entrada.
 */
export function opcoesParaCanal(channelType) {
  const canal = String(channelType || '').toLowerCase();
  return IDS_DE_PROVEDOR
    .filter((id) => PROVEDORES[id].canais.includes(canal))
    .map((id) => {
      const p = PROVEDORES[id];
      return {
        id,
        rotulo: p.rotulo,
        descricao: p.descricao,
        oficial: p.oficial,
        padrao: id === provedorPadraoDoCanal(canal),
        podeReiniciar: p.podeReiniciar,
        origemDaCapacidade: p.origem,
        contraDecisaoRegistrada: p.contraDecisaoRegistrada === true,
        capacidade: capacidadeEfetiva(canal, id),
      };
    });
}

/** Uma frase em português sobre o que este par canal+provedor consegue fazer. A tela mostra isto
 *  no cartão; sem ela, «interativo: false» não diz a ninguém que o menu vai virar lista numerada. */
export function resumirCapacidade(channelType, idProvedor) {
  const c = capacidadeEfetiva(channelType, idProvedor);
  const partes = [];
  partes.push(c.interativo ? `menu com até ${c.botoesMax} botão(ões) e ${c.listaMax} item(ns) de lista` : 'menu em texto numerado (o canal não desenha botão)');
  partes.push(c.anexo ? 'anexo de mídia' : 'sem anexo');
  partes.push(c.template ? 'modelo aprovado pela Meta (fora da janela de 24 h)' : 'sem modelo aprovado — fora da janela de 24 h não há como iniciar conversa');
  return partes.join(' · ');
}

export default {
  PROVEDORES, IDS_DE_PROVEDOR,
  provedor, provedorExiste, provedorPadraoDoCanal, combina, normalizarProvedor,
  capacidadeEfetiva, opcoesParaCanal, resumirCapacidade,
};
