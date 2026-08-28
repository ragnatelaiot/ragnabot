#!/usr/bin/env python3
"""
Guarda "nao sou robo" (Cloudflare Turnstile) do Ragnabot.

Fica ANTES da tela de entrada: quem nao passou recebe a pagina de verificacao;
quem passou ganha um cookie ASSINADO e segue para a aplicacao.

Por que um servico proprio: o Chatwoot nao valida Turnstile nativamente. Pôr so o
quadradinho na tela seria enfeite -- a validacao precisa ocorrer no SERVIDOR, e e
isto que este processo faz (fala com a API da Cloudflare).

Escuta so em 127.0.0.1; quem chama e o nginx do proprio servidor.
Sem dependencias externas (biblioteca padrao). NOC, 28/08/2026.
"""
import hashlib, hmac, http.server, json, os, re, socketserver, time, urllib.parse, urllib.request

ENV = {}
for linha in open('/etc/ragnabot/turnstile.env', encoding='utf-8'):
    if '=' in linha and not linha.startswith('#'):
        k, v = linha.split('=', 1)
        ENV[k.strip()] = v.strip()

SITE_KEY = ENV['TURNSTILE_SITE_KEY']
SECRET   = ENV['TURNSTILE_SECRET']
# segredo do cookie: derivado, nunca igual ao da Cloudflare
COOKIE_SECRET = hashlib.sha256((SECRET + '|cookie|ragnabot').encode()).digest()
COOKIE = 'rgb_verificado'
VALIDADE_S = 12 * 3600          # 12 h sem reverificar
CAMINHO_OK = re.compile(r'^/[A-Za-z0-9/_\-.?=&%]*$')

def assinar(exp: str) -> str:
    return hmac.new(COOKIE_SECRET, exp.encode(), hashlib.sha256).hexdigest()[:32]

def cookie_valido(cabecalho: str) -> bool:
    m = re.search(r'(?:^|;\s*)' + COOKIE + r'=([^;]+)', cabecalho or '')
    if not m:
        return False
    try:
        exp, sig = urllib.parse.unquote(m.group(1)).split('.', 1)
        if int(exp) < int(time.time() * 1000):
            return False
        return hmac.compare_digest(sig, assinar(exp))   # tempo constante
    except Exception:
        return False

def pagina(erro: bool = False) -> bytes:
    aviso = '<div class="erro">Não foi possível confirmar. Tente novamente.</div>' if erro else ''
    return f"""<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificação de segurança — Ragnabot</title>
<style>
 :root{{--bg:#03151f;--card:#082532;--linha:rgba(255,255,255,.14);--tit:#f5fbff;--txt:#bad0d9;--verde:#2ee879;--erro:#ff8a8a}}
 *{{box-sizing:border-box}} html,body{{height:100%}}
 body{{margin:0;background:radial-gradient(50rem 34rem at 12% -8%,rgba(46,232,121,.10),transparent 60%),
   linear-gradient(160deg,#03151f 0%,#061e29 60%,#03151f 100%);color:var(--txt);
   font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:24px}}
 .cartao{{width:min(440px,100%);background:var(--card);border:1px solid var(--linha);border-radius:18px;
   padding:32px 28px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.45)}}
 .marca{{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:22px}}
 .marca b{{color:var(--tit);font-size:19px;letter-spacing:-.01em}} .marca b i{{color:var(--verde);font-style:normal}}
 h1{{color:var(--tit);font-size:21px;margin:0 0 8px;letter-spacing:-.02em}}
 p{{margin:0 0 22px;font-size:14.5px;color:#8faab4}}
 .widget{{display:flex;justify-content:center;min-height:70px}}
 .erro,noscript{{color:var(--erro);font-size:14px;margin-top:14px;display:block}}
 @media(max-width:420px){{.cartao{{padding:26px 18px}}}}
</style></head><body>
<main class="cartao">
 <div class="marca">
  <svg width="34" height="38" viewBox="0 0 48 48" aria-hidden="true">
   <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ee879"/><stop offset="1" stop-color="#0e7a3c"/></linearGradient></defs>
   <path d="M24 2 L44 13 L44 35 L24 46 L4 35 L4 13 Z" fill="url(#g)"/>
   <path d="M13 31 h16 a3.5 3.5 0 0 0 3.5-3.5 v-8 a3.5 3.5 0 0 0-3.5-3.5 H17 a3.5 3.5 0 0 0-3.5 3.5 v14 z" fill="#03151f" opacity=".92"/>
   <circle cx="18.5" cy="23.5" r="2" fill="#2ee879"/><circle cx="24" cy="23.5" r="2" fill="#eafff2"/><circle cx="29.5" cy="23.5" r="2" fill="#2ee879"/>
  </svg><b>Ragna<i>bot</i></b>
 </div>
 <h1>Verificação de segurança</h1>
 <p>Confirme que você não é um robô para continuar.</p>
 <form id="f" method="POST" action="/__verificacao">
  <div class="widget"><div class="cf-turnstile" data-sitekey="{SITE_KEY}" data-callback="ok" data-language="pt-BR" data-theme="dark"></div></div>
  <input type="hidden" name="token" id="token"><input type="hidden" name="destino" id="destino">
 </form>{aviso}
 <noscript>É necessário ativar o JavaScript para concluir a verificação.</noscript>
</main>
<script>
 document.getElementById('destino').value = new URLSearchParams(location.search).get('destino') || '/app/login';
 function ok(t){{ document.getElementById('token').value=t; document.getElementById('f').submit(); }}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</body></html>""".encode('utf-8')

class Guarda(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a):            # nao poluir o journal
        pass

    def _fim(self, codigo, corpo=b'', extra=None):
        self.send_response(codigo)
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        if corpo:
            self.send_header('Content-Type', 'text/html; charset=utf-8')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if corpo:
            self.wfile.write(corpo)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/__verificado':                       # o nginx pergunta
            return self._fim(204 if cookie_valido(self.headers.get('Cookie', '')) else 401)
        if u.path == '/__verificacao':
            erro = 'erro' in urllib.parse.parse_qs(u.query)
            return self._fim(200, pagina(erro))
        return self._fim(404)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != '/__verificacao':
            return self._fim(404)
        n = min(int(self.headers.get('Content-Length', 0) or 0), 8192)
        p = urllib.parse.parse_qs(self.rfile.read(n).decode('utf-8', 'replace'))
        token = (p.get('token') or [''])[0]
        destino = (p.get('destino') or ['/app/login'])[0]
        if not CAMINHO_OK.match(destino):                   # so caminho interno
            destino = '/app/login'
        dados = {'secret': SECRET, 'response': token}
        ip = (self.headers.get('X-Real-IP') or '').split(',')[0].strip()
        if ip:
            dados['remoteip'] = ip
        try:
            req = urllib.request.Request(
                'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                data=urllib.parse.urlencode(dados).encode())
            with urllib.request.urlopen(req, timeout=8) as r:
                ok = json.load(r).get('success') is True
        except Exception:
            ok = False
        if not ok:
            return self._fim(302, b'', {'Location': '/__verificacao?erro=1'})
        exp = str(int((time.time() + VALIDADE_S) * 1000))
        valor = urllib.parse.quote(f'{exp}.{assinar(exp)}')
        return self._fim(302, b'', {
            'Location': destino,
            'Set-Cookie': f'{COOKIE}={valor}; Path=/; Max-Age={VALIDADE_S}; HttpOnly; Secure; SameSite=Lax',
        })

class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    Servidor(('127.0.0.1', 8791), Guarda).serve_forever()
