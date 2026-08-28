# "Não sou robô" (Cloudflare Turnstile) — Ragnabot

## Por que existe um serviço próprio
O Chatwoot **não valida o Turnstile nativamente**. Colocar apenas o quadradinho na tela seria
**enfeite** — sem validação no servidor, qualquer robô ignoraria. Este guarda faz a validação de
verdade: recebe o token, **pergunta à Cloudflare** se é legítimo e só então emite um cookie assinado.

## Como funciona
```
visitante → /app/login
              │ nginx pergunta ao guarda: "já passou?"  (auth_request)
              ├── sim  → segue para a aplicação
              └── não  → 302 para /__verificacao (a tela do "não sou robô")
                            │ o visitante resolve o desafio
                            │ o guarda valida o token NA CLOUDFLARE
                            └── válido → cookie assinado (12 h) → volta ao destino
```

## Peças
| onde | o quê |
|---|---|
| `/opt/ragnabot/turnstile_guard.py` | o guarda (Python puro, sem dependências) |
| `/etc/systemd/system/ragnabot-turnstile.service` | serviço, sobe no boot |
| `/etc/ragnabot/turnstile.env` | **as chaves** (arquivo `600`) — ⛔ nunca versionar |
| vhost `chat002-ragnatela` | `auth_request` na tela de entrada + rotas do guarda |

## Segurança do desenho
- O **segredo** nunca chega ao navegador; só a chave do site, que é pública por natureza.
- O cookie é **assinado** (HMAC) e comparado em **tempo constante** — não dá para forjar por tentativa.
- O destino do redirecionamento aceita **apenas caminho interno** — sem redirecionamento aberto.
- O guarda escuta só em `127.0.0.1`; quem chama é o nginx local.
- Cookie: `HttpOnly; Secure; SameSite=Lax`, validade de 12 h.

## Operação
```bash
systemctl status ragnabot-turnstile      # estado
systemctl restart ragnabot-turnstile     # reiniciar
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8791/__verificado   # 401 = sem cookie (certo)
```
**Trocar as chaves:** editar `/etc/ragnabot/turnstile.env` e reiniciar o serviço.
**Desligar:** remover o `auth_request` do vhost e recarregar o nginx (o serviço pode ficar de pé).
