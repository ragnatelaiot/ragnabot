# Ragnabot — identidade visual da plataforma
> Proposta do agente site-ragnatela · 27/08/2026 · para aprovação do NOC (delegação do dono).
> Arquivos-irmãos: `login.html` (autenticação) e `app-mockup.html` (telas de uso).
> Base da marca-mãe: `/ia/.claude/site-ragnatela/marca/MARCA.md` — paleta medida na própria logo.

## 1. Conceito
O Ragnabot é **produto**, não canal institucional: herda o DNA da Ragnatela (hexágono, teia,
verde em três pesos) e ganha uma cara própria — **noite de vidro** na autenticação (imponente,
com transparências e luz verde) e **dia de trabalho** dentro da ferramenta (claro, sereno,
com o verde como estrutura, não como enfeite). A metáfora que amarra: *a teia percebe o toque
em qualquer ponto* → toda conversa, de qualquer canal, cai na mesma teia.

## 2. Paleta — hex exatos e contrastes MEDIDOS (WCAG)

### 2.1 Núcleo (herdado da marca — não recolorir)
| Papel | Hex | Uso no produto |
|---|---|---|
| Verde profundo | `#055508` | botões primários, seleção ativa, balão de saída, links fortes |
| Verde médio | `#449344` | hover, foco de campo, ícones grandes (nunca texto pequeno em fundo claro — 3,8:1) |
| Verde vivo (acento, regra dos 2%) | `#2CC54E` | botão Entrar/Enviar, contador de não lidas, filete da seleção. **Nunca texto sobre branco (2,3:1)** |

### 2.2 Tema escuro (autenticação e barra lateral)
| Papel | Hex |
|---|---|
| Fundo noite | `#04150B` |
| Fundo noite 2 (gradiente) | `#0A2415` |
| Texto claro | `#E9F6EE` |
| Texto claro secundário | `#A9C4B2` |
| Vidro (cartão) | `rgba(255,255,255,.055)` + borda `rgba(255,255,255,.14)` + blur 18px |
| Erro (tema escuro) | `#FFB4A8` |

### 2.3 Tema claro (área de trabalho)
| Papel | Hex |
|---|---|
| Tinta (texto) | `#12211C` |
| Texto secundário | `#5D7169` |
| Linha/borda | `#D7E5DE` |
| Fundo suave | `#F2F8F5` |
| Superfície | `#FFFFFF` |
| Nota interna | fundo `#FFF6DC` · borda `#E8D9A0` (tracejada) · tinta `#4A3B12` · rótulo `#8A6D1C` |

### 2.4 Selos de canal (badge circular, glifo branco)
| Canal | Hex | Contraste do glifo branco |
|---|---|---|
| WhatsApp | `#1E9E52` | 3,5:1 ✓ |
| Instagram | `#C13584` | 5,1:1 ✓ |
| Messenger | `#0078E7` | 3,9:1 ✓ |
| E-mail | `#5A6B78` | 5,5:1 ✓ |
| Telegram | `#1E96D1` | 3,3:1 ✓ |
| Chat do site | `#055508` | 9,1:1 ✓ |

Glifos: **desenho próprio simplificado** (símbolos inline no `app-mockup.html`), nunca o logotipo
oficial do terceiro esticado/recolorido — evita marca deformada (lei da casa) e questão de uso de marca.
Na barra lateral escura, os mesmos glifos aparecem em versões CLARAS das cores (`#37C973`,
`#E273B4`, `#63AEF5`, `#9FB4C2`, `#5FB9E8`, `#7BD08F`) para manter ≥3:1 sobre `#04150B`.

### 2.5 Estados de conversa
| Estado | Fundo | Texto |
|---|---|---|
| Aberta | `#E3F4E8` | `#055508` |
| Pendente | `#FFF3CD` | `#7A5A00` |
| Resolvida | `#E8F0EB` | `#305A3E` |

### 2.6 Contrastes medidos (pares que decidem a legibilidade)
| Par | Razão | Veredito |
|---|---|---|
| `#E9F6EE` sobre `#04150B` | ≈16:1 | ✓ |
| `#A9C4B2` sobre `#04150B` | ≈9:1 | ✓ |
| `#2CC54E` sobre `#04150B` | 7,9:1 | ✓ (texto e ícone) |
| `#FFFFFF` sobre `#055508` | 9,1:1 | ✓ (botões, balão de saída) |
| `#04150B` sobre `#2CC54E` | 8,3:1 | ✓ (botão Entrar/Enviar: tinta escura, nunca branca) |
| `#12211C` sobre `#FFFFFF` | ≈16:1 | ✓ |
| `#5D7169` sobre `#FFFFFF` | 5,2:1 | ✓ |
| `#5D7169` sobre `#F2F8F5` | 4,8:1 | ✓ |
| `#4A3B12` sobre `#FFF6DC` | ≈9:1 | ✓ (nota interna) |
| ⛔ `#2CC54E` sobre `#FFFFFF` | 2,3:1 | **reprovado — proibido como texto** |
| ⛔ `#449344` sobre `#FFFFFF` | 3,8:1 | só ícone/texto grande, nunca corpo |

## 3. Tipografia
- **Pilha de sistema** (autocontido, zero CDN — lei da casa):
  `-apple-system, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif`.
- Quando o repositório permitir fonte própria, **auto-hospedar** (`@font-face`) uma geométrica
  humanista (ex.: Inter/Manrope baixada para o repo) — nunca Google Fonts por link.
- Escala: título de página 19–30px/800 (espaçamento -0,3 a -0,5px) · nome/rotulagem 14,5px/700 ·
  corpo 14,5px/400, linha 1,5 · apoio 12–13px · sobretítulos 10–11px caixa-alta com
  `letter-spacing .12em`. Corpo nunca abaixo de 14px no celular.

## 4. Forma
- **Raios**: campo/botão 10–12px · cartão 14–18px · balão 16px (com o canto "raiz" em 6px do
  lado de quem fala) · pílulas 999px.
- **Sombras**: superfície `0 1px 2px rgba(18,33,28,.06), 0 4px 14px rgba(18,33,28,.05)` ·
  cartão de vidro `0 30px 80px rgba(0,0,0,.55)` + filete interno `0 2px 0 rgba(255,255,255,.06)` ·
  botão acento `0 10px 26px rgba(44,197,78,.28)`.
- **Transparências/imagens** (pedido do dono): vidro fosco só no TEMA ESCURO
  (`backdrop-filter: blur(18px)` sobre `rgba(255,255,255,.055)`); auroras = radiais verdes
  desfocadas (blur 90px, opacidade ≤ .5) animadas em 22–32s; teia de hexágonos a 13% de opacidade
  como textura. **Regra dura:** transparência nunca sob texto pequeno sem medir o pior bloco —
  onde há texto, a camada composta final tem de passar 4,5:1 (foi medida, tabela 2.6).
  `prefers-reduced-motion` desliga as animações.

## 5. Logo — variação "Ragnabot by Ragnatela"
- Composição proposta: **hexágono da marca contendo um balão de conversa com três nós** (a teia
  abraça a conversa) + wordmark "Ragna**bot**" (o "bot" em `#2CC54E`) + descritor
  "BY RAGNATELA" em caixa-alta espaçada.
- O desenho nos HTML é **marcador de posição**: a variação final deve ser gerada a partir de
  `marca/web/logo-vetor.svg` / do `.ai`, salva em `marca/web/` e registrada na tabela do
  `MARCA.md` (regra da marca-mãe). Sobre fundo escuro, símbolo com traço `#2CC54E` + branco;
  sobre claro, `#055508`.
- Respiro mínimo, sem distorção, sem sombra no logotipo — as regras do MARCA.md valem intactas.

## 6. Estados de interação
| Estado | Especificação |
|---|---|
| Hover | fundo `rgba(255,255,255,.06)` no escuro · `#F2F8F5` no claro · botões: brilho +5% |
| Foco (teclado) | `outline 2px #2CC54E, offset 2–3px`; campos: borda `#2CC54E`/`#449344` + halo `0 0 0 3px rgba(44,197,78,.22)` |
| Ativo/selecionado | filete esquerdo 3px `#2CC54E` (escuro) ou `#055508` (claro) + fundo tingido |
| Erro | borda `#FFB4A8` (escuro) + halo suave + mensagem de 12,5px sob o campo + `role="alert"` |
| Desabilitado | opacidade .45, cursor padrão |
| Alvo de toque | mínimo 44×44px (já aplicado em botões, itens e no "mostrar senha") |

## 7. Responsividade (testada nos três pontos)
- **≥1101px**: 3 colunas — lateral 264px · lista 360px · conversa fluida.
- **≤1100px**: lateral vira gaveta (hambúrguer + véu), 2 colunas.
- **≤720px (celular)**: uma tela por vez — lista → toque abre a conversa → "‹" volta;
  balões a 86%; botões opcionais do cabeçalho somem. Zero rolagem horizontal.
- Login: cartão 430px máx., encosta nas margens com 16px no celular.

## 8. Mapeamento → Chatwoot (onde aplicar)
> Caminhos conferidos contra a estrutura usual do Chatwoot; **confirmar na versão exata em uso**
> antes de aplicar — o projeto move arquivos entre versões.

| O quê | Onde no Chatwoot |
|---|---|
| Cor primária global | tema Tailwind (`theme.colors.woot.*` no `tailwind.config.js`) + variáveis SCSS de `app/javascript/dashboard/assets/scss/` → primária `#055508`, hover `#0A6B10`, acento `#2CC54E` |
| Marca (nome, logo, favicon) | Super Admin → Installation Config: `INSTALLATION_NAME=Ragnabot`, `LOGO`, `LOGO_THUMBNAIL`, `BRAND_NAME=Ragnabot by Ragnatela`, `WIDGET_BRAND_URL` — e favicons em `public/` (gerar do símbolo, fundo `#04150B`) |
| Tela de login | view de sessão (`app/javascript/v3/views/login` ou equivalente): aplicar o `login.html` como referência — fundo noite + auroras + cartão de vidro; manter o formulário funcional do Chatwoot por baixo |
| Balões/notas | classes de mensagem do dashboard: saída `#055508`/texto `#F2FBF4`; nota privada `#FFF6DC` tracejada (o Chatwoot já tem o conceito de *private note* — só recolorir) |
| Selos de canal | ícones de inbox: usar os hex da tabela 2.4 |
| Widget do webchat (site do cliente) | cor do widget = `#055508`; botão do balão pode usar `#2CC54E` com glifo escuro |
| E-mails transacionais | cabeçalho `#04150B` com logo branca, botão `#2CC54E` com texto `#04150B` |

## 9. O que NÃO fazer
- Verde vivo como fundo de seção ou texto sobre branco (regra dos 2% + contraste reprovado).
- Logo de terceiro (WhatsApp/Meta/Telegram) recolorida ou esticada — só os glifos próprios.
- Texto sobre transparência sem medir o pior bloco.
- Cinza puro: todo neutro puxa para o verde (tabela 2.3).
- Nenhuma credencial, token ou endpoint real nestes arquivos — irão a repositório.
