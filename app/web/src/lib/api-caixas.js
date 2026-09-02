// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAMADA DE REDE DA TELA DE CAIXAS DE ENTRADA (contrato S-CAIXAS, 02/09/2026)
//
// POR QUE ESTA TELA EXISTE: em 02/09/2026 a plataforma tinha QUATRO caixas na conta 1 (1 Site ·
// 34 WhatsApp · 35 Facebook · 36 Instagram) e 7 conversas reais, e `RagnabotInbox` — o cadastro do
// NOSSO lado, que é o que o motor consulta em execução — estava VAZIA. Ninguém tinha como perceber:
// não havia tela, e a rotina de reconciliação nunca era chamada. Sem conferir o cadastro, um erro
// nele aparece só como «o robô não responde», dias depois e longe da causa.
//
// ── DUAS LEITURAS DIFERENTES, e a distinção é o coração da tela ─────────────────────────────────
//   · `/tenants/:id/inboxes`  → a PLATAFORMA, ao vivo. É a verdade LÁ FORA.
//   · `/inboxes`              → o NOSSO cadastro. É o que o motor usa AQUI DENTRO.
// A tela mostra o NOSSO, porque é o nosso que cala o robô quando está errado. O botão «Sincronizar
// agora» é o que aproxima um do outro — e ele chama a MESMA função que roda no arranque.
//
// ── POR QUE REUSA `chamarEmpresas` ──────────────────────────────────────────────────────────────
// Mesma base (`/api/ragnabot`), mesmo envelope (`{success, data}`), mesmas regras de 401/403 e o
// MESMO caminho único de sessão perdida. Escrever um segundo cliente HTTP aqui criaria duas
// políticas de 401 no mesmo produto — que é como uma sessão expirada passa a se comportar de dois
// jeitos conforme a tela em que a pessoa estava.
//
// ⛔ NENHUMA CREDENCIAL PASSA POR AQUI. O que a API devolve de mais sensível é
// `credentialFingerprint` (sha256 truncado, projetado justamente para auditar SEM guardar o
// segredo). O token da Meta, o do bot e as senhas de IMAP/SMTP vivem só na plataforma.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { chamarEmpresas } from './api-empresas.js';

/** O cadastro inteiro (todas as empresas), incluindo as caixas já desligadas.
 *  ⚠️ As removidas vêm de propósito: «esta caixa sumiu da plataforma» é exatamente a informação que
 *  explica um fluxo que parou de disparar. Escondê-las devolveria o mistério. */
export const lerCaixas = ({ incluirRemovidas = true } = {}) =>
  chamarEmpresas(`/inboxes${incluirRemovidas ? '' : '?incluirRemovidas=0'}`);

/** Rodou quando, e deu o quê. `ultimaEm: null` significa «nunca rodou» — e é dito assim na tela. */
export const lerEstadoDaSincronizacao = () => chamarEmpresas('/inboxes/sincronizacao');

/** Reconcilia TODAS as empresas, agora. Idempotente: rodar duas vezes devolve tudo zerado. */
export const sincronizarAgora = () => chamarEmpresas('/inboxes/sincronizar', { metodo: 'POST' });

// ────────────────────────────────────────────────────────────────────────────────────────────────
// VOCABULÁRIO DA TELA
// O nome do canal é o que o operador reconhece, não o valor do banco. `channelType` é `web_widget`;
// quem lê a tela conhece «Site (widget)».
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const CANAIS = Object.freeze({
  web_widget: 'Site (widget)',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  telegram: 'Telegram',
  instagram: 'Instagram',
  facebook: 'Facebook',
  api: 'API',
});

/** O rótulo do canal, com o valor cru como último recurso — canal novo na plataforma aparece com o
 *  nome técnico em vez de sumir da tela. */
export function rotuloDoCanal(caixa) {
  return caixa?.canalRotulo || CANAIS[caixa?.tipoCanal] || caixa?.tipoCanal || 'Desconhecido';
}

/** «há 3 min», «há 2 h», «há 4 d» — ou `null` quando nunca houve. Data crua em tela de conferência
 *  faz o operador calcular de cabeça, e é aí que ele conclui errado. */
export function desdeQuando(iso, agora = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const seg = Math.max(0, Math.round((agora - t) / 1000));
  if (seg < 60) return 'agora há pouco';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

/** O resumo de uma passada, em uma frase de português. Contador solto («4 · 0 · 1») não diz nada a
 *  quem clicou no botão — e é justamente quem clicou que precisa entender o que aconteceu. */
export function resumirPassada(r) {
  if (!r) return 'Nada a relatar.';
  const partes = [];
  if (r.novasNoCadastro) partes.push(`${r.novasNoCadastro} caixa(s) registrada(s)`);
  if (r.atualizadas) partes.push(`${r.atualizadas} atualizada(s)`);
  if (r.reativadas) partes.push(`${r.reativadas} reativada(s)`);
  if (r.adotadas) partes.push(`${r.adotadas} reserva(s) adotada(s)`);
  if (r.marcadasComoRemovidas) partes.push(`${r.marcadasComoRemovidas} marcada(s) como removida(s)`);
  const total = `${r.caixasNaPlataforma ?? 0} caixa(s) na plataforma, ${r.empresas ?? 1} empresa(s) conferida(s)`;
  if (!partes.length) return `${total}. Nada mudou — o cadastro já estava igual à plataforma.`;
  return `${total}. ${partes.join(', ')}.`;
}
