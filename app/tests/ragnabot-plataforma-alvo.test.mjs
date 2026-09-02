#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POR ONDE O MOTOR FALA COM A PLATAFORMA — os três degraus, medidos
//
// POR QUE ESTE ARQUIVO EXISTE — defeito REAL, medido em 02/09/2026, minutos depois de publicar a
// v1.07.00. A regra de escolha de rota existia em DOIS lugares: `rotas-sessao.js` (nova, com o
// caminho interno do cluster) e `ragnabot-tenant.service.js` (antiga, só proxy ou URL pública). A
// sincronização das caixas usava a antiga, e de dentro do Kubernetes ela não alcança nada:
//
//     "Falha de rede ao falar com a plataforma (GET /platform/api/v1/users/1): timeout of 20000ms"
//     cadastroDeCaixas.caixasNaPlataforma: 0
//
// Duas cópias da mesma regra divergiram, e ganhou a errada justo no caminho que importava. A regra
// virou `src/base/plataforma-alvo.js`, com um dono só, e este teste é a trava que impede a terceira
// cópia de nascer: se alguém reescrever a ordem dos degraus, aqui fica vermelho.
//
// COMO RODAR:  node tests/ragnabot-plataforma-alvo.test.mjs
// (o vitest só varre `.test.js`; este é `.test.mjs` de propósito, como os irmãos)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { alvoDaPlataforma } from '../src/base/plataforma-alvo.js';

const PUBLICA = 'https://bot.ragnatela.com.br';
let verdes = 0; let vermelhos = 0;

function medir(titulo, fn) {
  // Cada medição roda com o ambiente LIMPO e o devolve como estava. Sem isto, um teste que define
  // a variável interna faria o seguinte passar por acidente — e um teste que passa por acidente é
  // pior que teste nenhum, porque dá confiança falsa.
  const antes = {
    interna: process.env.RAGNABOT_PLATAFORMA_INTERNA,
    proxy: process.env.RAGNABOT_PROXY_IP,
  };
  delete process.env.RAGNABOT_PLATAFORMA_INTERNA;
  delete process.env.RAGNABOT_PROXY_IP;
  try {
    fn();
    console.log(`  ✓ ${titulo}`);
    verdes++;
  } catch (e) {
    console.log(`  ✗ ${titulo}\n      ${e.message}`);
    vermelhos++;
  } finally {
    if (antes.interna === undefined) delete process.env.RAGNABOT_PLATAFORMA_INTERNA;
    else process.env.RAGNABOT_PLATAFORMA_INTERNA = antes.interna;
    if (antes.proxy === undefined) delete process.env.RAGNABOT_PROXY_IP;
    else process.env.RAGNABOT_PROXY_IP = antes.proxy;
  }
}

console.log('\nA ROTA ATÉ A PLATAFORMA — os três degraus\n');

medir('1º degrau: o serviço do cluster ganha de tudo (é o único que funciona de dentro)', () => {
  process.env.RAGNABOT_PLATAFORMA_INTERNA = 'http://ragnabot-web:3000';
  process.env.RAGNABOT_PROXY_IP = '172.20.11.2';
  const a = alvoDaPlataforma(PUBLICA);
  assert.equal(a.caminho, 'interna');
  assert.equal(a.baseURL, 'http://ragnabot-web:3000');
  // `hostname: null` NÃO é descuido: é o sinal de «aqui não se força Host nem SNI». Quem monta o
  // cliente lê esse null para decidir. Trocá-lo por uma string faria o motor mandar o nome público
  // num pedido em HTTP simples — confusão gratuita no log do Rails.
  assert.equal(a.hostname, null);
});

medir('a barra final do endereço interno não vira barra dobrada no caminho', () => {
  process.env.RAGNABOT_PLATAFORMA_INTERNA = 'http://ragnabot-web:3000///';
  assert.equal(alvoDaPlataforma(PUBLICA).baseURL, 'http://ragnabot-web:3000');
});

medir('2º degrau: sem serviço interno, vai pelo proxy PELO IP, forçando Host e SNI', () => {
  process.env.RAGNABOT_PROXY_IP = '172.20.11.2';
  const a = alvoDaPlataforma(PUBLICA);
  assert.equal(a.caminho, 'proxy');
  assert.equal(a.baseURL, 'https://172.20.11.2');
  // O nome REAL tem de viajar: é contra ele que o certificado é conferido. Sem isto o TLS falharia
  // — ou, pior, alguém desligaria a verificação para «resolver».
  assert.equal(a.hostname, 'bot.ragnatela.com.br');
});

medir('3º degrau: sem nada configurado, a URL pública — e ela é o ÚLTIMO recurso, não o primeiro', () => {
  const a = alvoDaPlataforma(PUBLICA);
  assert.equal(a.caminho, 'publica');
  assert.equal(a.baseURL, PUBLICA);
  assert.equal(a.hostname, 'bot.ragnatela.com.br');
});

medir('variável vazia ou só com espaços conta como NÃO configurada', () => {
  process.env.RAGNABOT_PLATAFORMA_INTERNA = '   ';
  process.env.RAGNABOT_PROXY_IP = '';
  assert.equal(alvoDaPlataforma(PUBLICA).caminho, 'publica');
});

medir('o degrau escolhido é DITO (`caminho`) — é o que a mensagem de erro precisa para não mentir', () => {
  process.env.RAGNABOT_PLATAFORMA_INTERNA = 'http://ragnabot-web:3000';
  assert.ok(['interna', 'proxy', 'publica'].includes(alvoDaPlataforma(PUBLICA).caminho));
});

console.log(`\nRESULTADO: ${verdes} verde(s), ${vermelhos} vermelho(s)\n`);
process.exit(vermelhos ? 1 : 0);
