// ════════════════════════════════════════════════════════════════════════════════════════════════
// A LIGAÇÃO AO VIVO DA TELA (contrato S-TEMPO-REAL, 03/09/2026 — doc 35 §6.8)
//
// Ordem do dono: *"não deve ser necessário clicar em sincronizar; a atualização deve ser em tempo
// real, e inclusive sem atualizar a página."*
//
// ── O QUE ESTE ARQUIVO É ────────────────────────────────────────────────────────────────────────
// Um cano aberto com o servidor (`EventSource`, os «eventos enviados pelo servidor»). Quando algo
// muda numa conversa que ESTA pessoa pode ver, o servidor escreve uma linha e a tela recarrega o
// que precisa. O servidor decide o que ela pode ver — aqui não há filtro nenhum, e se um dia
// alguém precisar de um `if (conversa.setor === …)` NESTE arquivo, o defeito está do outro lado.
//
// ── O AVISO NÃO TRAZ CONTEÚDO, E ISSO É DE PROPÓSITO ────────────────────────────────────────────
// Ele diz «a conversa 41 mudou, motivo: mensagem». Quem busca o conteúdo é a tela, pelas rotas
// normais. Duas fontes de verdade para a mesma conversa é como uma delas fica desatualizada — e a
// desatualizada é sempre a que alguém está lendo.
//
// ── RECONEXÃO: RECUO EXPONENCIAL COM SORTEIO ────────────────────────────────────────────────────
// O cano cai — troca de líder do banco, implantação, wi-fi do atendente, os 15 min de validade que
// o servidor impõe de propósito. Reconectar num laço apertado com 30 atendentes derruba o motor
// junto (foi assim que o alerta de backup mandou 210 mensagens). Aqui: 1 s, 2 s, 4 s… até 30 s,
// cada espera multiplicada por um sorteio entre 0,5× e 1,5× — sem o sorteio, todos os navegadores
// que caíram juntos voltam juntos, para sempre.
//
// ── E RECUPERA O QUE PERDEU ─────────────────────────────────────────────────────────────────────
// A cada conexão bem-sucedida o servidor manda `pronto`, e nós chamamos `aoSincronizar()` — que na
// tela é a mesma recarga do botão «Atualizar». Não tentamos «reenviar os eventos que faltaram»:
// com duas réplicas, a reconexão pode cair no OUTRO pod, que não teria esse histórico — a
// recuperação falharia justamente no caso em que ela importa. Reler o estado é sempre certo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sessaoExpirada } from './api.js';
import { caminhoDoApp } from './prefixo.js';

export const BASE_AO_VIVO = caminhoDoApp('/api/ragnabot-tempo-real');

const RECUO_MIN_MS = 1000;
const RECUO_MAX_MS = 30_000;

/**
 * Quanto esperar antes da tentativa `n` (0 = a primeira falha).
 * Exportada porque é a parte fácil de errar e a barata de provar.
 */
export function recuoDaTentativa(n, sorteio = Math.random()) {
  const base = Math.min(RECUO_MAX_MS, RECUO_MIN_MS * 2 ** Math.max(0, Math.min(n, 5)));
  return Math.round(base * (0.5 + sorteio));
}

/**
 * Liga o cano.
 *
 * @param {object} p
 * @param {(motivo:string)=>void} p.aoSincronizar   recarregar TUDO (conectou ou reconectou)
 * @param {(evento:object)=>void} p.aoEvento        chegou um aviso de conversa
 * @param {(estado:{ligado:boolean, tentativas:number, motivo?:string})=>void} [p.aoEstado]
 * @returns {{desligar:()=>void, estado:()=>object}}
 */
export function ligarAoVivo({ aoSincronizar, aoEvento, aoEstado } = {}) {
  if (typeof EventSource === 'undefined') {
    // Navegador sem suporte (ou ambiente de teste): a tela não quebra, ela só não se atualiza
    // sozinha — e diz isso, em vez de fingir que está ao vivo.
    aoEstado?.({ ligado: false, tentativas: 0, motivo: 'sem-suporte' });
    return { desligar() {}, estado: () => ({ ligado: false, suportado: false }) };
  }

  let fonte = null;
  let agendado = null;
  let desligado = false;
  let tentativas = 0;
  let ligado = false;
  let recebidos = 0;

  const avisar = (motivo) => aoEstado?.({ ligado, tentativas, motivo });

  function fechar() {
    if (fonte) { try { fonte.close(); } catch { /* já fechou */ } fonte = null; }
    ligado = false;
  }

  function agendar(motivo) {
    if (desligado || agendado) return;
    const espera = recuoDaTentativa(tentativas);
    tentativas += 1;
    avisar(motivo);
    agendado = setTimeout(() => { agendado = null; abrir(); }, espera);
  }

  /**
   * `EventSource` não conta POR QUE falhou — um 401 de sessão vencida e o servidor fora produzem
   * exatamente o mesmo `onerror`. Sem esta pergunta, quem ficou com a sessão vencida veria a tela
   * tentando reconectar para sempre, calada. Uma leitura barata resolve.
   */
  async function pergunteSeASessaoCaiu() {
    try {
      const r = await fetch(`${BASE_AO_VIVO}/estado`, {
        credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (r.status === 401) { desligado = true; fechar(); sessaoExpirada('expired'); return true; }
    } catch { /* rede fora: o recuo cuida */ }
    return false;
  }

  function abrir() {
    if (desligado) return;
    fechar();
    try {
      fonte = new EventSource(`${BASE_AO_VIVO}/ao-vivo`, { withCredentials: true });
    } catch {
      agendar('nao-abriu');
      return;
    }

    fonte.addEventListener('pronto', () => {
      ligado = true;
      tentativas = 0;
      avisar('conectado');
      // ⭐ É AQUI que «recupera o que perdeu» acontece — na primeira vez e em toda reconexão.
      aoSincronizar?.('conectado');
    });

    fonte.addEventListener('conversa', (e) => {
      recebidos += 1;
      let dados = null;
      try { dados = JSON.parse(e.data); } catch { return; }
      aoEvento?.(dados);
    });

    // O servidor fecha sozinho a cada 15 min para reautenticar e reler os setores. Isso é
    // planejado, não é falha: reabre na hora, sem recuo — senão a tela ficaria 1 s cega a cada
    // ciclo, sem motivo.
    fonte.addEventListener('recomecar', () => {
      fechar();
      tentativas = 0;
      if (!desligado) setTimeout(abrir, 50);
    });

    fonte.addEventListener('adeus', () => {
      // O pod está encerrando (implantação). Cair no recuo é o certo: o outro pod atende.
      fechar();
      agendar('servidor-encerrando');
    });

    fonte.onerror = () => {
      const estavaLigado = ligado;
      fechar();
      // Só vale a pena perguntar quando já falhou algumas vezes seguidas: perguntar a cada
      // piscada de rede seria trocar um pedido barato por muitos.
      if (!estavaLigado && tentativas >= 2) pergunteSeASessaoCaiu();
      agendar('caiu');
    };
  }

  /**
   * Voltar para a aba: o navegador congela temporizadores de aba oculta, então uma tela deixada
   * de lado por horas pode voltar com o cano morto e o recuo dormindo. Ao reaparecer, tenta já.
   */
  function aoVoltarParaAAba() {
    if (desligado) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (ligado) return;
    if (agendado) { clearTimeout(agendado); agendado = null; }
    tentativas = 0;
    abrir();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', aoVoltarParaAAba);

  abrir();

  return {
    desligar() {
      desligado = true;
      if (agendado) { clearTimeout(agendado); agendado = null; }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoVoltarParaAAba);
      fechar();
    },
    estado: () => ({ ligado, tentativas, recebidos, suportado: true }),
  };
}

export default { ligarAoVivo, recuoDaTentativa, BASE_AO_VIVO };
