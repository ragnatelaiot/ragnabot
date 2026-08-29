/*
 * Ragnabot — identidade no rodapé da barra lateral (empresa + versão)
 * ------------------------------------------------------------------
 * Ordem do dono (29/08/2026): a versão do Ragnabot sempre aparece abaixo do nome do
 * usuário logado, e o usuário logado mostra o nome da empresa (a empresa registrada
 * como SaaS).
 *
 * Por que um arquivo separado e não uma alteração no componente Vue: o painel é a
 * imagem oficial do Chatwoot fixada por digest — não compilamos o front. Este script
 * é montado por ConfigMap em /app/public/brand-assets/ (mesmo mecanismo das
 * logomarcas) e chamado pelo layout. Sem dependência externa: o painel não pode
 * depender de CDN, e script embutido é a primeira coisa que uma CSP derruba.
 *
 * Regra de ouro: se qualquer coisa aqui falhar, o painel NÃO pode quebrar. Todo
 * caminho está dentro de try/catch e a falha é silenciosa — no pior caso as duas
 * linhas simplesmente não aparecem.
 */
(function () {
  'use strict';

  // ── Única coisa que muda a cada entrega ──────────────────────────────────────
  // Manter em par com o arquivo VERSAO da raiz do repositório ragnatelaiot/ragnabot.
  // Não buscamos a versão de serviço nenhum de propósito: é dado de montagem, e uma
  // chamada de rede aqui viraria ponto de falha dentro do painel.
  var VERSAO = '1.01.00';
  var ROTULO_VERSAO = 'Ragnabot v' + VERSAO;

  // Marcas dos nós que nós criamos — é por elas que garantimos idempotência.
  var MARCA = 'data-rgt-identidade';

  // ── Leitura do estado do próprio painel ─────────────────────────────────────
  // O painel é um app Vue 3 com Vuex 4. O Vue grava a instância no elemento de
  // montagem (`#app.__vue_app__`) e o Vuex publica a store em
  // `config.globalProperties.$store` — medimos os dois no pacote em produção.
  // Ler dali é o caminho mais estável: é exatamente o que a tela desenha, sem rede,
  // sem token e sem risco de mexer na sessão do operador.
  function pegarStore() {
    try {
      var raiz = document.getElementById('app');
      var app = raiz && raiz.__vue_app__;
      var store = app && app.config && app.config.globalProperties
        ? app.config.globalProperties.$store
        : null;
      return store && store.getters ? store : null;
    } catch (e) {
      return null;
    }
  }

  // Nome da empresa. Fonte primária: o getter `getCurrentAccount` da store — a conta
  // do Chatwoot é criada pelo NOC com o nome da empresa do SaaS (RagnabotTenant.name),
  // então esse texto É o nome da empresa registrada. Fonte secundária: o próprio
  // seletor de conta do topo da barra lateral, que já mostra esse nome na tela.
  function lerEmpresa(store) {
    try {
      if (store) {
        var conta = store.getters.getCurrentAccount;
        if (conta && conta.name) return String(conta.name).trim();
      }
    } catch (e) { /* segue para o plano B */ }
    try {
      var seletor = document.getElementById('sidebar-account-switcher');
      if (seletor) {
        var texto = (seletor.textContent || '').trim();
        if (texto) return texto;
      }
    } catch (e) { /* sem empresa: a linha não aparece */ }
    return '';
  }

  // E-mail do usuário logado — é a nossa âncora no DOM. Usamos o e-mail e não o nome
  // porque o e-mail é único: não corre o risco de casar com outro texto da tela.
  function lerUsuario(store) {
    try {
      if (store) {
        var u = store.getters.getCurrentUser;
        if (u && u.email) {
          return {
            email: String(u.email).trim(),
            nome: String(u.available_name || u.name || '').trim(),
          };
        }
      }
    } catch (e) { /* sem e-mail não há âncora */ }
    return { email: '', nome: '' };
  }

  // ── Onde encaixar ───────────────────────────────────────────────────────────
  // O rodapé da barra lateral é um <button> com o avatar e um <div> contendo duas
  // linhas: nome e e-mail. Procuramos a folha cujo texto é exatamente o e-mail e
  // devolvemos o <div> que a contém — é dentro dele que penduramos as nossas linhas.
  // Nada de seletor por classe do Tailwind: classe utilitária muda de versão para
  // versão; o e-mail do usuário, não.
  function temFilhoComTexto(caixa, texto) {
    if (!texto) return false;
    for (var i = 0; i < caixa.children.length; i += 1) {
      var f = caixa.children[i];
      if (f.children.length === 0 && (f.textContent || '').trim() === texto) return true;
    }
    return false;
  }

  function acharCaixaDoUsuario(usuario) {
    if (!usuario.email) return null;
    try {
      var primeira = null;
      var cands = document.querySelectorAll('aside button div');
      for (var i = 0; i < cands.length; i += 1) {
        var el = cands[i];
        if (el.children.length !== 0) continue;
        if ((el.textContent || '').trim() !== usuario.email) continue;
        var caixa = el.parentElement;
        if (!caixa) continue;
        // Preferimos a caixa que também tem o NOME do usuário como irmão: é a
        // assinatura do rodapé da barra lateral. Sem essa preferência, um painel
        // lateral qualquer que mostrasse o mesmo e-mail poderia roubar a âncora.
        if (temFilhoComTexto(caixa, usuario.nome)) return caixa;
        if (!primeira) primeira = caixa;
      }
      return primeira;
    } catch (e) { /* nada encontrado */ }
    return null;
  }

  // Clonamos a aparência da linha do e-mail (mesma classe) para que as nossas linhas
  // acompanhem o tema claro/escuro e qualquer mudança de estilo da própria plataforma.
  function classeDaLinhaFina(caixa, email) {
    try {
      for (var i = 0; i < caixa.children.length; i += 1) {
        var f = caixa.children[i];
        if ((f.textContent || '').trim() === email) return f.className || '';
      }
    } catch (e) { /* sem classe: a linha ainda aparece, só sem o estilo fino */ }
    return '';
  }

  function montarLinha(papel, texto, classe) {
    var div = document.createElement('div');
    div.setAttribute(MARCA, papel);
    if (classe) div.className = classe;
    div.title = texto;      // a linha é truncada; o título mostra o texto inteiro
    div.textContent = texto;
    return div;
  }

  // ── O trabalho em si ────────────────────────────────────────────────────────
  // Idempotente: se as linhas já existem, só atualizamos o texto quando ele mudou.
  // Isso é o que impede o MutationObserver de se realimentar num laço infinito.
  function aplicar() {
    try {
      var store = pegarStore();
      var usuario = lerUsuario(store);
      var email = usuario.email;
      var caixa = acharCaixaDoUsuario(usuario);
      // Barra lateral recolhida não desenha o bloco de texto — nesse estado não há
      // onde escrever, e a resposta certa é não fazer nada.
      if (!caixa) return;

      var empresa = lerEmpresa(store);
      var classe = classeDaLinhaFina(caixa, email);

      var linhaEmpresa = caixa.querySelector('[' + MARCA + '="empresa"]');
      if (empresa) {
        if (!linhaEmpresa) {
          caixa.appendChild(montarLinha('empresa', empresa, classe));
        } else if ((linhaEmpresa.textContent || '') !== empresa) {
          linhaEmpresa.textContent = empresa;
          linhaEmpresa.title = empresa;
        }
      }

      var linhaVersao = caixa.querySelector('[' + MARCA + '="versao"]');
      if (!linhaVersao) {
        caixa.appendChild(montarLinha('versao', ROTULO_VERSAO, classe));
      } else if ((linhaVersao.textContent || '') !== ROTULO_VERSAO) {
        linhaVersao.textContent = ROTULO_VERSAO;
        linhaVersao.title = ROTULO_VERSAO;
      }
    } catch (e) {
      // Falha em silêncio, por decisão: identidade é enfeite, atendimento é o produto.
    }
  }

  // Um pedido de aplicação por quadro. O painel redesenha muito; sem essa contenção
  // gastaríamos trabalho à toa a cada mutação.
  var agendado = false;
  function agendar() {
    if (agendado) return;
    agendado = true;
    var executa = function () {
      agendado = false;
      aplicar();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(executa);
    } else {
      setTimeout(executa, 16);
    }
  }

  function iniciar() {
    try {
      agendar();

      // O painel é um SPA: troca de rota, recolher/expandir a barra e troca de conta
      // redesenham o rodapé. O observador devolve as linhas sempre que isso acontece.
      if (typeof window.MutationObserver === 'function') {
        var obs = new MutationObserver(function () {
          try { agendar(); } catch (e) { /* nunca deixar escapar do observador */ }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      }

      // Rede de segurança para a primeira pintura (a store só existe depois que o
      // pacote do painel monta). Desliga sozinha depois de 60 s.
      var tentativas = 0;
      var relogio = setInterval(function () {
        tentativas += 1;
        agendar();
        if (tentativas >= 60) clearInterval(relogio);
      }, 1000);
    } catch (e) {
      // idem: silêncio
    }
  }

  // Útil no suporte: dá para conferir a versão montada pelo console, sem caçar arquivo.
  try { window.ragnabotIdentidade = { versao: VERSAO, reaplicar: aplicar }; } catch (e) { /* noop */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
