// =============================================================================
// Entrada integrada no Ragnabot (chat002) a partir do NOC.
//
// A REGRA (ordem do dono): apenas **super users do NOC** entram e gerenciam o SaaS.
// Quem já se autenticou no NOC — inclusive com o 2FA de lá — clica em "Atendimento"
// e cai dentro do Ragnabot já logado, SEM segunda senha e SEM segundo código.
//
// Por que assim, e não copiando o segredo de 2FA: um segredo repetido em dois
// sistemas dobra a superfície de vazamento e desincroniza quando um dos lados troca.
// Aqui o Ragnabot passa a CONFIAR em quem o NOC já autenticou — o 2FA continua sendo
// um só, o do NOC.
//
// NOC 2026-08-28.
// =============================================================================
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';

const BASE = process.env.RAGNABOT_URL || 'https://chat002.ragnatela.com.br';

/** Token do Platform App — vive em Settings (cifrado), nunca no git nem no código. */
async function tokenPlataforma() {
  const cli = prisma.settings || prisma.setting;
  const s = await cli.findUnique({ where: { key: 'ragnabot_platform_token' } }).catch(() => null);
  if (!s?.value) {
    throw new Error(
      'Ponte com o Ragnabot não configurada: falta a chave "ragnabot_platform_token" nas ' +
      'configurações do NOC. Ela é criada com o Platform App da plataforma.'
    );
  }
  try { return decrypt(s.value); } catch { return s.value; }
}

async function chamar(caminho, opcoes = {}) {
  const r = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      api_access_token: await tokenPlataforma(),
      ...(opcoes.headers || {}),
    },
  });
  const texto = await r.text();
  let corpo; try { corpo = JSON.parse(texto); } catch { corpo = texto; }
  if (!r.ok) {
    const detalhe = typeof corpo === 'string' ? corpo.slice(0, 200) : JSON.stringify(corpo).slice(0, 200);
    throw new Error(`Ragnabot respondeu ${r.status}: ${detalhe}`);
  }
  return corpo;
}

/**
 * Encontra (ou cria) o usuário do Ragnabot correspondente ao super user do NOC
 * e devolve o endereço de entrada direta.
 *
 * ⚠️ Só deve ser chamado depois de o NOC ter confirmado que quem pede é super user.
 */
export async function entradaDireta(usuarioDoNoc) {
  if (!usuarioDoNoc?.isSuperuser) {
    throw new Error('Apenas super users do NOC acessam o Ragnabot por aqui.');
  }
  const email = (usuarioDoNoc.email || '').trim().toLowerCase();
  if (!email) throw new Error('O seu usuário do NOC não tem e-mail cadastrado — necessário para a entrada integrada.');

  // 1) já existe lá?
  let usuario = null;
  try {
    const lista = await chamar(`/platform/api/v1/users?email=${encodeURIComponent(email)}`);
    usuario = Array.isArray(lista) ? lista.find(u => (u.email || '').toLowerCase() === email) : null;
  } catch { /* a busca por e-mail pode não existir; segue para a criação */ }

  // 2) não existe: cria com senha aleatória (ninguém a usa — a entrada é pelo link)
  if (!usuario) {
    const senha = 'Rgt' + Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + '#9';
    usuario = await chamar('/platform/api/v1/users', {
      method: 'POST',
      body: JSON.stringify({
        name: usuarioDoNoc.name || email,
        email,
        password: senha,
        confirmed: true,
        custom_attributes: { origem: 'NOC', criado_em: new Date().toISOString() },
      }),
    });
  }

  // 3) o endereço de entrada direta, de uso único e curta duração
  const login = await chamar(`/platform/api/v1/users/${usuario.id}/login`);
  const url = login?.url || login;
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error('A plataforma não devolveu o endereço de entrada.');
  }
  return { url, usuarioId: usuario.id, email };
}

/** Diz se a ponte está de pé — usado para mostrar ou esconder o item de menu. */
export async function integracaoDisponivel() {
  try {
    await tokenPlataforma();
    const r = await fetch(`${BASE}/api`, { method: 'GET' });
    return { disponivel: r.ok, url: BASE };
  } catch (e) {
    return { disponivel: false, url: BASE, motivo: e.message };
  }
}
