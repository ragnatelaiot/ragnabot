// ════════════════════════════════════════════════════════════════════════════════════════════════
// DUBLÊ DE PRISMA EM MEMÓRIA — o suficiente para o Capitão e o pagamento Pix.
//
// Irmão do `fake-prisma-motor.mjs` (que serve à máquina de estado do motor). Este é mais simples e
// mais genérico: recebe a lista de modelos e os índices ÚNICOS, e recusa o que o banco recusaria —
// que é a única razão de um dublê valer alguma coisa. Sem os únicos declarados, o teste de
// idempotência passaria sozinho e não provaria nada.
//
// Suporta: findUnique (inclusive chave composta), findFirst, findMany, count, create, update,
// updateMany, upsert, deleteMany, e `{increment}` em update.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

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
    if (k === 'OR') { if (!cond.some((s) => casa(reg, s))) return false; continue; }
    if (k === 'AND') { if (!cond.every((s) => casa(reg, s))) return false; continue; }
    // Chave composta: { tenantId_competencia: { tenantId, competencia } }
    if (k.includes('_') && cond && typeof cond === 'object' && !(cond instanceof Date)
        && !Object.keys(cond).some((o) => ['in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte'].includes(o))) {
      for (const [sk, sv] of Object.entries(cond)) if (!casaValor(reg[sk], sv)) return false;
      continue;
    }
    if (!casaValor(reg[k], cond)) return false;
  }
  return true;
}

function aplicar(reg, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'increment' in v) {
      reg[k] = (reg[k] ?? 0) + v.increment;
    } else reg[k] = v;
  }
  reg.atualizadoEm = new Date();
}

function p2002(campos) {
  const e = new Error(`Unique constraint failed on the fields: (${campos.join(', ')})`);
  e.code = 'P2002';
  e.meta = { target: campos };
  return e;
}

/**
 * @param {string[]} modelos nomes camelCase (`ragnabotCobrancaPix`)
 * @param {Record<string,string[][]>} unicos por modelo, as listas de campos que formam índice único
 */
export function criarFakeSimples(modelos = [], unicos = {}) {
  const tabelas = Object.fromEntries(modelos.map((m) => [m, []]));
  const cliente = { __tabelas: tabelas };

  const conferirUnicos = (nome, dados, ignorar = null) => {
    for (const campos of unicos[nome] ?? []) {
      // Único não vale quando qualquer campo é nulo — é assim no Postgres, e é a armadilha que a
      // casa já registrou duas vezes (`chaveAtalho`, `activeKey`).
      if (campos.some((c) => dados[c] === null || dados[c] === undefined)) continue;
      const colide = tabelas[nome].some((r) => r !== ignorar && campos.every((c) => r[c] === dados[c]));
      if (colide) throw p2002(campos);
    }
  };

  for (const nome of modelos) {
    cliente[nome] = {
      findUnique: async ({ where }) => tabelas[nome].find((r) => casa(r, where)) ?? null,
      findFirst: async ({ where } = {}) => tabelas[nome].find((r) => casa(r, where)) ?? null,
      findMany: async ({ where, orderBy, take } = {}) => {
        let lista = tabelas[nome].filter((r) => casa(r, where));
        if (orderBy) {
          const [campo, dir] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0];
          lista = [...lista].sort((a, b) => {
            const va = a[campo] ?? 0; const vb = b[campo] ?? 0;
            const cmp = new Date(va) - new Date(vb) || String(va).localeCompare(String(vb));
            return dir === 'desc' ? -cmp : cmp;
          });
        }
        return take ? lista.slice(0, take) : lista;
      },
      count: async ({ where } = {}) => tabelas[nome].filter((r) => casa(r, where)).length,
      create: async ({ data }) => {
        conferirUnicos(nome, data);
        const reg = { id: data.id ?? crypto.randomUUID(), criadoEm: new Date(), atualizadoEm: new Date(), ...data };
        tabelas[nome].push(reg);
        return { ...reg };
      },
      update: async ({ where, data }) => {
        const reg = tabelas[nome].find((r) => casa(r, where));
        if (!reg) { const e = new Error('não encontrado'); e.code = 'P2025'; throw e; }
        conferirUnicos(nome, { ...reg, ...data }, reg);
        aplicar(reg, data);
        return { ...reg };
      },
      updateMany: async ({ where, data }) => {
        const alvo = tabelas[nome].filter((r) => casa(r, where));
        alvo.forEach((r) => aplicar(r, data));
        return { count: alvo.length };
      },
      upsert: async ({ where, create, update }) => {
        const reg = tabelas[nome].find((r) => casa(r, where));
        if (reg) { aplicar(reg, update); return { ...reg }; }
        conferirUnicos(nome, create);
        const novo = { id: create.id ?? crypto.randomUUID(), criadoEm: new Date(), atualizadoEm: new Date(), ...create };
        tabelas[nome].push(novo);
        return { ...novo };
      },
      deleteMany: async ({ where } = {}) => {
        const antes = tabelas[nome].length;
        tabelas[nome] = tabelas[nome].filter((r) => !casa(r, where));
        return { count: antes - tabelas[nome].length };
      },
    };
  }

  cliente.$queryRaw = async () => [{ agora: new Date() }];
  cliente.$transaction = async (fn) => fn(cliente);
  return cliente;
}

export default { criarFakeSimples };
