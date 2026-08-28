/* Coloca a verificação "não sou robô" DENTRO do formulário de entrada do Ragnabot,
   como no painel do cliente — sem janela intermediária.
   O token é validado NO SERVIDOR (o guarda fala com a Cloudflare) antes de virar cookie;
   sem cookie válido, o envio do login é recusado pelo proxy. NOC 28/08/2026. */
(function () {
  var SITE_KEY = '0x4AAAAAAEfOAzs8_N4o16-7';
  var verificado = false;

  function achaFormulario() {
    var senha = document.querySelector('input[type="password"], input[name="password"]');
    return senha ? senha.closest('form') : null;
  }

  function monta() {
    var form = achaFormulario();
    if (!form || form.querySelector('.rgb-turnstile')) return;

    var caixa = document.createElement('div');
    caixa.className = 'rgb-turnstile';
    var alvo = document.createElement('div');
    caixa.appendChild(alvo);

    // insere logo acima do botão de entrar
    var botao = form.querySelector('button[type="submit"], button');
    if (botao && botao.parentNode) botao.parentNode.insertBefore(caixa, botao);
    else form.appendChild(caixa);

    // trava o envio até a verificação passar
    if (botao) { botao.disabled = true; botao.setAttribute('data-rgb-travado', '1'); }

    function libera() {
      verificado = true;
      if (botao) { botao.disabled = false; botao.removeAttribute('data-rgb-travado'); }
    }

    window.turnstile.render(alvo, {
      sitekey: SITE_KEY,
      language: 'pt-BR',
      theme: 'dark',
      callback: function (token) {
        // valida NO SERVIDOR; só então o cookie é emitido
        fetch('/__verificar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token }),
          credentials: 'same-origin'
        }).then(function (r) { if (r.status === 204) libera(); });
      },
      'expired-callback': function () {
        verificado = false;
        if (botao) botao.disabled = true;
      }
    });
  }

  function esperar() {
    if (window.turnstile && achaFormulario()) { monta(); return; }
    setTimeout(esperar, 250);
  }

  // o formulário é desenhado pelo navegador depois; observa a tela até ele existir
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esperar);
  else esperar();
  new MutationObserver(function () { if (achaFormulario()) monta(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
