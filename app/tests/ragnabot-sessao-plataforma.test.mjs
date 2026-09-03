#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SESSÃO ÚNICA — a credencial da plataforma entregue ao navegador (contrato S-CASCA, 02/09/2026)
//
// POR QUE ESTE ARQUIVO EXISTE. A partir do contrato S-CASCA, as telas que ainda são do fornecedor
// abrem DENTRO da nossa casca, num quadro. A nossa entrada fala com a plataforma pelo endereço
// INTERNO do cluster, do lado do servidor — o navegador nunca via a credencial dela. Sem o módulo
// que este teste mede, a pessoa entraria uma vez na nossa casca e o quadro abriria... a tela de
// login do fornecedor. Duas senhas para o mesmo produto.
//
// ── O QUE ESTE TESTE MEDE DE VERDADE ───────────────────────────────────────────────────────────
// O FORMATO da credencial, contra o que a interface do fornecedor realmente lê. Isso foi MEDIDO em
// 02/09/2026 baixando os pacotes JavaScript que ele mesmo serve:
//
//     ua.defaults = { sameSite: "Lax" };
//     ua.set("cw_d_session_info", JSON.stringify(e.headers), { expires: … })
//     zD = () => { const a = JSON.parse(ua.get("cw_d_session_info"));
//                  return { "access-token": …, client: …, uid: …, expiry: …, "token-type": … } }
//
// A medição mais importante daqui é a da IDA E VOLTA: escrevemos o cookie e o lemos de volta COM A
// MESMA REGRA QUE A BIBLIOTECA DELE USA (`value.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent)`).
// Se um dia alguém "simplificar" a codificação, esta medição fica vermelha aqui em vez de virar
// «o painel abre em branco» na tela de um atendente.
//
// ── O QUE ELE NÃO MEDE, e não vou fingir que mede ──────────────────────────────────────────────
// Não sobe servidor, não fala com a plataforma e não abre navegador. Que o cookie realmente
// autentica o quadro só se prova com navegador contra o ambiente no ar — e essa prova é do chefe,
// depois do deploy. Aqui se prova o FORMATO e as REGRAS, que é o que dá para provar sem rede.
//
// COMO RODAR:  node tests/ragnabot-sessao-plataforma.test.mjs
// (o vitest só varre `.test.js`; este é `.test.mjs` de propósito, como os irmãos)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  CHAVES_DA_PLATAFORMA, NOME_COOKIE_PLATAFORMA,
  cookieDaPlataforma, cookieDeSaidaDaPlataforma, credencialDaPlataforma,
  credencialDoPedido, expiracaoDaCredencial,
} from '../src/base/plataforma-sessao.js';

let verdes = 0; let vermelhos = 0;

function medir(titulo, fn) {
  const antes = process.env.NODE_ENV;
  // Produção é o padrão das medições: é onde o cookie tem de sair `Secure`. A válvula de
  // desenvolvimento tem medição PRÓPRIA, embaixo — se ela vazasse para as outras, um cookie
  // inseguro passaria despercebido.
  process.env.NODE_ENV = 'production';
  try { fn(); console.log(`  ✓ ${titulo}`); verdes++; }
  catch (e) { console.log(`  ✗ ${titulo}\n      ${String(e.message).split('\n')[0]}`); vermelhos++; }
  finally { if (antes === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes; }
}

/** Uma resposta de `/auth/sign_in` como a plataforma a devolve (nomes em minúsculas, como o axios). */
function cabecalhosDeSucesso(extra = {}) {
  return {
    'access-token': 'tok-de-mentira-para-o-teste',
    'token-type': 'Bearer',
    client: 'cliente-de-mentira',
    expiry: String(Math.floor(Date.now() / 1000) + 3600),
    uid: 'pessoa@empresa.com.br',
    // Ruído que a resposta real traz e que NÃO pode acabar dentro do cookie:
    'set-cookie': ['_chatwoot_session=nao-deve-vazar; path=/; httponly'],
    'x-request-id': 'abc-123',
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  };
}

/** A MESMA leitura que a biblioteca do fornecedor faz (`js-cookie`), copiada do pacote dele. */
function lerComoOFornecedor(valorCru) {
  return valorCru.replace(/(%[\dA-F]{2})+/giu, decodeURIComponent);
}

/** Extrai o valor de um `Set-Cookie` nosso, sem decodificar nada. */
function valorDoCookie(setCookie) {
  const primeiro = setCookie.split(';')[0];
  return primeiro.slice(primeiro.indexOf('=') + 1);
}

console.log('\nSESSÃO ÚNICA — A CREDENCIAL DA PLATAFORMA NO NAVEGADOR\n');
console.log('1) EXTRAIR a credencial da resposta da plataforma');

medir('as cinco chaves que a interface dele lê saem da resposta', () => {
  const c = credencialDaPlataforma(cabecalhosDeSucesso());
  assert.ok(c, 'não extraiu credencial de uma resposta boa');
  for (const chave of CHAVES_DA_PLATAFORMA) {
    assert.ok(c[chave], `faltou a chave ${chave} — a interface dele lê exatamente estas`);
  }
});

medir('⛔ o RUÍDO da resposta NÃO entra no cookie (é legível por JavaScript)', () => {
  // A biblioteca dele grava `JSON.stringify(headers)` INTEIRO. Nós não: `set-cookie` e
  // `x-request-id` num cookie legível por script é superfície que ninguém pediu.
  const c = credencialDaPlataforma(cabecalhosDeSucesso());
  assert.deepEqual(Object.keys(c).sort(), [...CHAVES_DA_PLATAFORMA].sort());
  const texto = JSON.stringify(c);
  assert.doesNotMatch(texto, /_chatwoot_session/, 'o cookie de sessão do Rails vazou para dentro');
  assert.doesNotMatch(texto, /x-request-id/);
});

medir('cabeçalho em MAIÚSCULA também é lido (não se perde credencial por causa de caixa)', () => {
  const c = credencialDaPlataforma({
    'Access-Token': 't', 'Token-Type': 'Bearer', Client: 'c', Expiry: '1', Uid: 'a@b.c',
  });
  assert.ok(c && c['access-token'] === 't' && c.client === 'c');
});

medir('cabeçalho repetido (lista) fica com o primeiro valor', () => {
  const c = credencialDaPlataforma({ 'access-token': ['um', 'dois'], client: 'c' });
  assert.equal(c['access-token'], 'um');
});

medir('resposta SEM autenticação devolve null — nunca um objeto pela metade', () => {
  // ⚠️ A regra que importa: meia credencial faria a interface dele achar que está logada e levar
  // 401 em CADA tela — sintoma «o painel abre em branco», que não aponta para cá.
  assert.equal(credencialDaPlataforma({}), null);
  assert.equal(credencialDaPlataforma(null), null);
  assert.equal(credencialDaPlataforma('nada disso'), null);
  assert.equal(credencialDaPlataforma({ 'access-token': 't' }), null, 'passou sem `client`');
  assert.equal(credencialDaPlataforma({ client: 'c' }), null, 'passou sem `access-token`');
  assert.equal(credencialDaPlataforma({ 'access-token': '  ', client: 'c' }), null, 'passou com token vazio');
});

console.log('\n2) O COOKIE — formato, atributos e a ida e volta');

medir('o cookie tem o nome que a interface DELE procura', () => {
  const sc = cookieDaPlataforma(cabecalhosDeSucesso());
  assert.ok(sc.startsWith(`${NOME_COOKIE_PLATAFORMA}=`), sc.slice(0, 40));
  assert.equal(NOME_COOKIE_PLATAFORMA, 'cw_d_session_info', 'o nome é DELE — mudá-lo não renomeia nada');
});

medir('IDA E VOLTA: ele lê de volta o JSON inteiro, com a regra dele', () => {
  const sc = cookieDaPlataforma(cabecalhosDeSucesso());
  const devolta = JSON.parse(lerComoOFornecedor(valorDoCookie(sc)));
  assert.equal(devolta['access-token'], 'tok-de-mentira-para-o-teste');
  assert.equal(devolta.client, 'cliente-de-mentira');
  assert.equal(devolta.uid, 'pessoa@empresa.com.br');
  assert.equal(devolta['token-type'], 'Bearer');
});

medir('o valor gravado não tem `;` nem `,` nem aspas cruas (terreno de bug entre servidores)', () => {
  const v = valorDoCookie(cookieDaPlataforma(cabecalhosDeSucesso()));
  for (const proibido of [';', ',', '"', ' ']) {
    assert.ok(!v.includes(proibido), `o valor cru contém ${JSON.stringify(proibido)}`);
  }
});

medir('⚠️ SEM HttpOnly — e isso é decisão, não esquecimento', () => {
  // A interface dele LÊ este cookie por JavaScript (`ua.get("cw_d_session_info")`, medido).
  // `HttpOnly` faria o quadro abrir deslogado — o defeito que o módulo existe para consertar.
  const sc = cookieDaPlataforma(cabecalhosDeSucesso());
  assert.doesNotMatch(sc, /HttpOnly/i, 'com HttpOnly a interface do fornecedor não enxerga a sessão');
});

medir('Secure e SameSite=Lax e Path=/ (os atributos que ele mesmo usa)', () => {
  const sc = cookieDaPlataforma(cabecalhosDeSucesso());
  assert.match(sc, /;\s*Secure/, 'cookie de sessão sem Secure em produção');
  assert.match(sc, /SameSite=Lax/, 'o fornecedor usa Lax; divergir cria dois cookies em vez de um');
  assert.match(sc, /Path=\//, 'sem Path=/ o painel dele em /app/… não recebe o cookie');
});

medir('a validade vem do `expiry` da plataforma, não de um palpite nosso', () => {
  const daquiUmaHora = Math.floor(Date.now() / 1000) + 3600;
  const sc = cookieDaPlataforma(cabecalhosDeSucesso({ expiry: String(daquiUmaHora) }));
  const m = sc.match(/Expires=([^;]+)/);
  assert.ok(m, 'sem Expires o cookie morre ao fechar o navegador');
  const diff = Math.abs(new Date(m[1]).getTime() - daquiUmaHora * 1000);
  assert.ok(diff < 2000, `Expires não bateu com o expiry da plataforma (${diff} ms de diferença)`);
});

medir('`expiry` ausente ou vencido cai no prazo declarado por quem chama', () => {
  assert.equal(expiracaoDaCredencial({ expiry: undefined }), null);
  assert.equal(expiracaoDaCredencial({ expiry: 'ontem' }), null);
  assert.equal(expiracaoDaCredencial({ expiry: '1' }), null, 'data de 1970 devia ser recusada');
  const sc = cookieDaPlataforma(cabecalhosDeSucesso({ expiry: '1' }), { prazoPadraoMs: 60_000 });
  const m = sc.match(/Expires=([^;]+)/);
  assert.ok(new Date(m[1]).getTime() > Date.now(), 'o cookie nasceu morto');
});

medir('resposta sem credencial devolve null — e a entrada NÃO pode quebrar por isso', () => {
  assert.equal(cookieDaPlataforma({}), null);
  assert.equal(cookieDaPlataforma(null), null);
});

console.log('\n3) A SAÍDA — sair tem de sair dos DOIS lados');

medir('o cookie de saída apaga o de entrada (mesmos atributos)', () => {
  const entrada = cookieDaPlataforma(cabecalhosDeSucesso());
  const saida = cookieDeSaidaDaPlataforma();
  assert.match(saida, /Max-Age=0/);
  // ⚠️ Atributo diferente do de emissão faz o navegador guardar DOIS cookies em vez de apagar o
  // que existia — e a pessoa "sai" continuando logada no quadro. Mesma lição do `cookieDeSaida()`.
  for (const atributo of ['Path=/', 'SameSite=Lax', 'Secure']) {
    assert.ok(entrada.includes(atributo), `a emissão perdeu ${atributo}`);
    assert.ok(saida.includes(atributo), `a saída não repete ${atributo} — não vai apagar nada`);
  }
});

medir('a credencial é lida de volta do pedido, para encerrar na plataforma', () => {
  const sc = cookieDaPlataforma(cabecalhosDeSucesso());
  const req = { headers: { cookie: `rb_sessao=abc; ${sc.split(';')[0]}; outro=1` } };
  const c = credencialDoPedido(req);
  assert.ok(c, 'não leu a credencial de volta — a saída deixaria o token vivo na plataforma');
  assert.equal(c['access-token'], 'tok-de-mentira-para-o-teste');
});

medir('cookie adulterado NÃO vira credencial pela metade', () => {
  for (const cru of ['lixo', encodeURIComponent('{"access-token":"só isso"}'), '%%%', '{}']) {
    const req = { headers: { cookie: `${NOME_COOKIE_PLATAFORMA}=${cru}` } };
    assert.equal(credencialDoPedido(req), null, `passou com ${cru}`);
  }
  assert.equal(credencialDoPedido({ headers: {} }), null);
  assert.equal(credencialDoPedido(null), null);
});

console.log('\n4) A VÁLVULA DE DESENVOLVIMENTO');

medir('fora de produção, e SÓ com pedido explícito, o cookie sai sem Secure', () => {
  // Existe pela mesma razão de `base/auth.js`: navegador não guarda cookie `Secure` em
  // `http://localhost`, e sem esta válvula o desenvolvimento vira «a sessão não cola», sem mensagem.
  const antesEnv = process.env.NODE_ENV;
  const antesValvula = process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO;
  try {
    process.env.NODE_ENV = 'development';
    process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO = '1';
    assert.doesNotMatch(cookieDaPlataforma(cabecalhosDeSucesso()), /Secure/);
    // ⚠️ E a válvula NÃO abre sozinha: sem o pedido explícito, mesmo fora de produção sai `Secure`.
    delete process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO;
    assert.match(cookieDaPlataforma(cabecalhosDeSucesso()), /Secure/);
    // ⚠️ E não abre em produção NEM com o pedido: variável de ambiente é fácil demais de mexer.
    process.env.NODE_ENV = 'production';
    process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO = '1';
    assert.match(cookieDaPlataforma(cabecalhosDeSucesso()), /Secure/,
      'a válvula de desenvolvimento abriu em PRODUÇÃO');
  } finally {
    if (antesEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antesEnv;
    if (antesValvula === undefined) delete process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO;
    else process.env.RAGNABOT_SESSAO_COOKIE_INSEGURO = antesValvula;
  }
});

console.log(vermelhos === 0
  ? `\nRESULTADO: ${verdes} de ${verdes} medições passaram.\n`
  : `\nRESULTADO: ${vermelhos} FALHA(S) em ${verdes + vermelhos} medições.\n`);
process.exit(vermelhos === 0 ? 0 : 1);
