// ════════════════════════════════════════════════════════════════════════════════════════════════
// SETORES QUE SE CONFEREM SOZINHOS (contrato S-TEMPO-REAL item 1, 03/09/2026 — doc 35 §6.8.1)
//
// ── O DEFEITO QUE ISTO CORRIGE, medido em 03/09 ─────────────────────────────────────────────────
// A conta tinha tráfego real e TODAS as conversas apareciam «sem setor». Não havia bug nenhum na
// consulta: é que `sincronizarSetores()` só rodava quando alguém clicava em «Sincronizar setores»,
// e ninguém nunca tinha clicado. O espelho de setores e de membros era o ÚNICO dado da caixa que
// dependia de gesto humano — e dado que depende de gesto humano é dado que está errado na hora em
// que importa.
//
// Pior: é justamente esse espelho que decide QUEM VÊ A FILA DE QUEM (`RagnabotAgenteSetor`
// alimenta `setoresDoAgente`, que alimenta a cláusula de visibilidade). Ou seja, um atendente
// recém-incluído num setor lá na plataforma ficava sem ver a fila dele — e um atendente RETIRADO
// de um setor continuava vendo. Este segundo caso é o grave.
//
// ── COMO FICA ───────────────────────────────────────────────────────────────────────────────────
// Uma passada no arranque (com atraso, para não competir com a subida) e um tique de 15 min — o
// MESMO desenho e o mesmo intervalo da sincronização das caixas de entrada, que já provou ser o
// certo para este tipo de espelho. O botão continua existindo como REFORÇO: quem acabou de criar
// um setor na plataforma não quer esperar 15 min para vê-lo.
//
// ⚠️ POR QUE 15 MINUTOS E NÃO 1: cada passada é, POR EMPRESA, uma leitura de times + uma leitura
// de membros POR TIME. Apertar isso para um minuto multiplicaria por 15 a conversa com a
// plataforma para proteger contra uma coisa que muda em escala de dias (a lotação de um setor).
// O que muda em escala de SEGUNDOS — conversa nova, mensagem, transferência — não vem por aqui:
// vem pelo aviso ao vivo (`ragnabot-tempo-real.service.js`), que é empurrado, não varrido.
//
// ⛔ NÃO DERRUBA NADA. Falha aqui degrada a visibilidade (a fila do setor demora a aparecer) e
// fica registrada no `/saude`. Uma exceção escapando mataria o tique e o espelho morreria calado,
// que é o modo de falha que este arquivo existe para evitar.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import prisma from '../base/db.js';
import logger from '../base/logger.js';
import { sincronizarSetores, sincronizarMembrosDosSetores } from './ragnabot-caixa.service.js';

/** 15 min — igual ao das caixas de entrada, e pelo mesmo motivo. */
export const INTERVALO_PADRAO_MS = 15 * 60 * 1000;
/** O arranque espera: o motor tem coisa mais urgente a fazer nos primeiros segundos (portaria,
 *  executor). E uma varredura de plataforma competindo com a subida atrasa a sonda de prontidão. */
export const ATRASO_INICIAL_MS = 20_000;

const estado = {
  ligado: false,
  intervaloMs: null,
  ultimaEm: null,
  ultimoResumo: null,
  ultimoErro: null,
  empresasComErro: [],
};

export function estadoDaSincronizacaoDeSetores() { return { ...estado }; }

/** Só quem tem conta na plataforma e não está encerrada. Mesma regra das caixas. */
async function empresasSincronizaveis(db = prisma) {
  return db.ragnabotTenant.findMany({
    where: { cwAccountId: { not: null }, status: { notIn: ['closed'] } },
    select: { id: true, name: true, cwAccountId: true },
  });
}

/**
 * Uma passada em TODAS as empresas. Falha de uma não derruba as outras.
 *
 * ⚠️ MEMBROS DEPOIS DE SETORES, e na mesma passada: `sincronizarMembrosDosSetores` varre os
 * setores ATIVOS do banco. Rodar os membros antes dos setores, numa empresa que acabou de criar um
 * time, deixaria o time novo sem membro nenhum até a passada seguinte — 15 min de fila invisível.
 */
export async function sincronizarSetoresDeTodasAsEmpresas({ motivo = 'rotina', db = prisma } = {}) {
  const empresas = await empresasSincronizaveis(db);
  const erros = [];
  let times = 0; let desativados = 0; let vinculos = 0; let removidos = 0;

  for (const e of empresas) {
    try {
      const s = await sincronizarSetores({ tenantId: e.id, cwAccountId: e.cwAccountId });
      times += s.times || 0;
      desativados += s.desativados || 0;
      const m = await sincronizarMembrosDosSetores({ tenantId: e.id, cwAccountId: e.cwAccountId });
      vinculos += m.vinculos || 0;
      removidos += m.removidos || 0;
    } catch (err) {
      erros.push({ tenantId: e.id, empresa: e.name, erro: String(err.message || err).slice(0, 200) });
    }
  }

  const resumo = { motivo, empresas: empresas.length, empresasComErro: erros.length, times, desativados, vinculos, removidos };
  estado.ultimaEm = new Date().toISOString();
  estado.ultimoResumo = resumo;
  estado.empresasComErro = erros;
  estado.ultimoErro = erros.length ? erros[0].erro : null;
  return { ...resumo, erros };
}

/**
 * Liga a rotina. Devolve o desligador — mesmo contrato dos outros trabalhadores da casa.
 *
 * ⚠️ O PRIMEIRO ERRO É REGISTRADO, OS REPETIDOS NÃO (mesma disciplina da sincronização de caixas):
 * sem a porta da plataforma configurada, cada tique escreveria a mesma linha de erro e afogaria o
 * erro seguinte, que seria o interessante. Muda o erro, volta a registrar.
 */
export function iniciarSincronizacaoDeSetores({ intervaloMs = INTERVALO_PADRAO_MS, atrasoInicialMs = ATRASO_INICIAL_MS } = {}) {
  let ultimoErroLogado = null;
  let rodando = false;

  const passada = async (motivo) => {
    if (rodando) return; // plataforma lenta acontece — não empilhar passadas
    rodando = true;
    try {
      const r = await sincronizarSetoresDeTodasAsEmpresas({ motivo });
      if (r.empresasComErro) {
        const msg = r.erros[0]?.erro || 'erro sem mensagem';
        if (msg !== ultimoErroLogado) {
          logger.warn(`[ragnabot-setores] sincronização com ${r.empresasComErro} empresa(s) em erro: ${msg}`);
          ultimoErroLogado = msg;
        }
      } else {
        ultimoErroLogado = null;
        if (r.times || r.vinculos || r.desativados || r.removidos) {
          logger.info(`[ragnabot-setores] ${r.empresas} empresa(s): ${r.times} setor(es), `
            + `${r.vinculos} vínculo(s), ${r.desativados} desativado(s), ${r.removidos} removido(s)`);
        }
      }
    } catch (e) {
      estado.ultimoErro = String(e.message || e).slice(0, 200);
      if (estado.ultimoErro !== ultimoErroLogado) {
        logger.error(`[ragnabot-setores] sincronização falhou: ${estado.ultimoErro}`);
        ultimoErroLogado = estado.ultimoErro;
      }
    } finally {
      rodando = false;
    }
  };

  const primeira = setTimeout(() => { passada('arranque'); }, atrasoInicialMs);
  if (typeof primeira.unref === 'function') primeira.unref();
  const tique = setInterval(() => { passada('rotina'); }, intervaloMs);
  if (typeof tique.unref === 'function') tique.unref();

  estado.ligado = true;
  estado.intervaloMs = intervaloMs;
  return () => {
    clearTimeout(primeira);
    clearInterval(tique);
    estado.ligado = false;
  };
}

export default {
  iniciarSincronizacaoDeSetores, sincronizarSetoresDeTodasAsEmpresas,
  estadoDaSincronizacaoDeSetores, INTERVALO_PADRAO_MS, ATRASO_INICIAL_MS,
};
