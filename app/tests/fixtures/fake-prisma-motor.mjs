// Dublê de Prisma em memória — só o suficiente para rodar a máquina de estado de verdade.
// Suporta: findUnique/findFirst/findMany/create/update/updateMany/count, chaves compostas,
// operadores in/lt/gt/gte/lte/not, OR, {increment}, e $transaction com ROLLBACK real (snapshot).
import crypto from 'node:crypto';

const MODELOS = [
  'ragnabotFluxo', 'ragnabotFluxoVersao', 'ragnabotFluxoExecucao', 'ragnabotFluxoEntrada',
  'ragnabotFluxoEntradaConsumida', 'ragnabotFluxoEfeito', 'ragnabotFluxoEvento',
  'ragnabotFluxoIncidente', 'ragnabotFluxoJanela', 'ragnabotFluxoCanalSaude',
];

function casaValor(v, cond) {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v && new Date(v).getTime() === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const [op, alvo] of Object.entries(cond)) {
      if (op === 'in' && !alvo.includes(v)) return false;
      if (op === 'notIn' && alvo.includes(v)) return false;
      if (op === 'not' && v === alvo) return false;
      if (op === 'lt' && !(v != null && new Date(v) < new Date(alvo))) return false;
      if (op === 'lte' && !(v != null && new Date(v) <= new Date(alvo))) return false;
      if (op === 'gt' && !(v != null && new Date(v) > new Date(alvo))) return false;
      if (op === 'gte' && !(v != null && new Date(v) >= new Date(alvo))) return false;
    }
    return true;
  }
  return v === cond;
}

function casa(reg, where) {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') { if (!cond.some((sub) => casa(reg, sub))) return false; continue; }
    if (k === 'AND') { if (!cond.every((sub) => casa(reg, sub))) return false; continue; }
    if (k.includes('_') && cond && typeof cond === 'object' && !(cond instanceof Date)
        && !('in' in cond) && !('lt' in cond) && !('gt' in cond) && !('gte' in cond) && !('lte' in cond) && !('not' in cond)) {
      // chave composta: { execucaoId_cwMessageId: { execucaoId, cwMessageId } }
      for (const [sk, sv] of Object.entries(cond)) if (!casaValor(reg[sk], sv)) return false;
      continue;
    }
    if (!casaValor(reg[k], cond)) return false;
  }
  return true;
}

function aplicarDados(reg, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'increment' in v) {
      reg[k] = (reg[k] ?? 0) + v.increment;
    } else reg[k] = v;
  }
  reg.atualizadaEm = new Date();
  reg.atualizadoEm = new Date();
}

// Índices únicos declarados (nome → campos). É o que faz o dublê recusar o que o banco recusaria.
const UNICOS = {
  ragnabotFluxoEfeito: [['chave']],
  ragnabotFluxoEntradaConsumida: [['execucaoId', 'cwMessageId']],
  ragnabotFluxoIncidente: [['versaoId', 'noId', 'codigo']],
  ragnabotFluxoExecucao: [], // o índice único PARCIAL é conferido à parte, em `criarExecucao`
};

export function criarFake() {
  const tabelas = Object.fromEntries(MODELOS.map((m) => [m, []]));
  const cliente = {};

  function modelo(nome) {
    return {
      findUnique: async ({ where }) => tabelas[nome].find((r) => casa(r, where)) ?? null,
      findFirst: async ({ where, orderBy } = {}) => {
        let lista = tabelas[nome].filter((r) => casa(r, where));
        if (orderBy) lista = ordenar(lista, orderBy);
        return lista[0] ?? null;
      },
      findMany: async ({ where, orderBy, take } = {}) => {
        let lista = tabelas[nome].filter((r) => casa(r, where));
        if (orderBy) lista = ordenar(lista, orderBy);
        return take ? lista.slice(0, take) : lista;
      },
      count: async ({ where } = {}) => tabelas[nome].filter((r) => casa(r, where)).length,
      create: async ({ data }) => {
        for (const campos of (UNICOS[nome] || [])) {
          const colide = tabelas[nome].some((r) => campos.every((c) => r[c] === data[c]));
          if (colide) { const e = new Error('Unique constraint failed'); e.code = 'P2002'; throw e; }
        }
        const reg = { id: data.id ?? crypto.randomUUID(), criadoEm: new Date(), ...data };
        if (nome === 'ragnabotFluxoExecucao') {
          const ATIVOS = ['rodando', 'esperando', 'pausado_humano', 'pausado_duvida'];
          const viva = tabelas[nome].some((r) => r.cwAccountId === reg.cwAccountId
            && r.cwConversationId === reg.cwConversationId && ATIVOS.includes(r.estado));
          if (viva) { const e = new Error('rb_exec_uma_viva_por_conversa'); e.code = 'P2002'; throw e; }
        }
        tabelas[nome].push(reg);
        return reg;
      },
      update: async ({ where, data }) => {
        const reg = tabelas[nome].find((r) => casa(r, where));
        if (!reg) { const e = new Error('nao encontrado'); e.code = 'P2025'; throw e; }
        aplicarDados(reg, data);
        return reg;
      },
      updateMany: async ({ where, data }) => {
        const alvo = tabelas[nome].filter((r) => casa(r, where));
        alvo.forEach((r) => aplicarDados(r, data));
        return { count: alvo.length };
      },
      deleteMany: async ({ where } = {}) => {
        const antes = tabelas[nome].length;
        tabelas[nome] = tabelas[nome].filter((r) => !casa(r, where));
        return { count: antes - tabelas[nome].length };
      },
    };
  }

  function ordenar(lista, orderBy) {
    const [campo, dir] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0];
    return [...lista].sort((a, b) => {
      const va = a[campo] ?? 0; const vb = b[campo] ?? 0;
      const cmp = new Date(va) - new Date(vb) || String(va).localeCompare(String(vb));
      return dir === 'desc' ? -cmp : cmp;
    });
  }

  for (const m of MODELOS) cliente[m] = modelo(m);

  cliente.$queryRaw = async (strings, ...vals) => {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (sql.includes('now() AS agora')) return [{ agora: new Date() }];
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ obtida: true }];
    if (sql.includes('FOR UPDATE')) return [];
    return [];
  };
  cliente.$executeRaw = async () => 0;

  cliente.$transaction = async (fn) => {
    const snapshot = JSON.stringify(tabelas, (k, v) => v);
    try {
      return await fn(cliente);
    } catch (e) {
      // ROLLBACK de verdade: é o que torna o teste da cerca (PossePerdida) significativo — sem isso
      // a reserva do efeito ficaria gravada e o teste passaria por engano.
      const restaurado = JSON.parse(snapshot);
      for (const m of MODELOS) {
        tabelas[m].length = 0;
        for (const r of restaurado[m]) tabelas[m].push(reviverDatas(r));
      }
      throw e;
    }
  };

  cliente.__tabelas = tabelas;
  return cliente;
}

const CAMPOS_DATA = /Em$|Desde$|^criadoEm$|^iniciadaEm$/;
function reviverDatas(reg) {
  const out = { ...reg };
  for (const k of Object.keys(out)) {
    if (CAMPOS_DATA.test(k) && typeof out[k] === 'string') out[k] = new Date(out[k]);
  }
  return out;
}
