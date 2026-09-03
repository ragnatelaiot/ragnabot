# 📜 ACTIONLOG — Construção do Ragnabot
> LOG CANÔNICO local da construção (regra do dono, 27/08). Espelho versionado no repo:
> `ragnatelaiot/ragnabot` → docs/ACTIONLOG.md. Sem segredos, por lei.

## 2026-09-03 — S-BOTAO: «não existe o botão de criar o fluxo» — era CSS, e foi consertado na raiz (v1.11.01)

**Relato do dono, no painel, ao vivo:** *«ainda não existe o botão de criar o fluxo»*. Bloqueio em
produção do objetivo central da construção.

### O diagnóstico — todos os suspeitos foram MEDIDOS, e todos estavam inocentes
Sessão emitida DENTRO do pod publicado (o segredo não sai de lá) e as rotas chamadas **exatamente
como a tela as chama**, pela porta pública (`Host: bot.ragnatela.com.br`, ingress `/painel/…`):

| Suspeito | Medição | Veredito |
|---|---|---|
| `podeAgora.administrarFluxos` falso | `/painel/api/ragnabot-fluxo/saude` = `{"schema":{"pronto":true},"podeAgora":{"administrarFluxos":true,"publicar":true,"modoDeTeste":true,"lerTelemetria":true}}` | inocente |
| `schemaPronto()` falso (cliente Prisma velho) | `schema.pronto = true`, os 4 componentes resolvidos | inocente |
| Sessão antiga sem o cookie novo | com cookie válido, `/sessao/eu` = 200 e as rotas de fluxo respondem | inocente |
| Permissão / papel | `POST /fluxos` devolveu **201** | inocente |
| A página caindo no ramo de indisponibilidade | nenhum 503; `erroSaude` nulo | inocente |

### ⭐ A causa real — UMA LINHA de CSS, e ela apagava OITO telas
```css
@media (max-width: 900px) { .capa__acoes { display: none; } }
```
`CapaSecao` é a barra de título de **toda** tela do painel, e `acoes` é onde mora a ação principal
de cada uma. Abaixo de 900 px de largura — celular, tablet, ou um navegador que simplesmente não
está maximizado — essa linha apagava a **única** porta de entrada de **Fluxos, Conexões, Empresas,
Agendamentos, Respostas rápidas, Caixas de entrada, Atendimentos e Testador**. Sem erro, sem log,
sem 404: o botão existia no pacote (`grep "Novo fluxo"` = 1) e o navegador o desenhava com
`display: none`. Era invisível para toda medição de rede, que é exatamente por que custou um dia.

**Agravante, e é o que o contrato mandava consertar:** o estado vazio da tela dizia «Crie o
primeiro» e **não oferecia nada para clicar** — a única porta era a da capa, justamente a apagada.

### A cura — a capa CRESCE em vez de cortar
Abaixo de 900 px a capa perdeu a altura fixa (`height: auto` + `min-height`) e as ações saíram do
posicionamento absoluto para o fluxo normal, abaixo do título, com quebra de linha. **Altura
automática sempre cabe no conteúdo** — não existe mais largura de tela em que um botão suma.
⚠️ As duas `@media` seguintes (768 px e 480 px) cravavam `height` de novo e, por virem DEPOIS na
cascata, teriam vencido a cura e reintroduzido o corte em silêncio. Viraram `min-height`.

### Botão apagado agora FALA — quatro motivos, quatro frases
`motivoSemCriar` (uma origem só): sessão vencida → **«saia e entre de novo»**; sessão aberta sem
empresa → **«saia e entre uma vez»** (a empresa é resolvida na entrada e vive dentro do cookie
assinado); migração faltando → **«não é a sua permissão, avise a Ragnatela»**; papel de atendente →
**«criar e publicar é de quem administra a empresa»**. E só desabilito o botão com a **palavra do
servidor** (`/saude`): para tudo o mais ele continua clicável e o aviso aparece por cima — quem
decide permissão é a API, e adivinhar na tela criaria um segundo dono da regra.

⚠️ **Um diagnóstico ERRADO foi retirado:** o aviso de conta sem empresa afirmava que «o campo da
empresa ainda não viaja no token de sessão». Isso deixou de ser verdade na v1.11.00. Diagnóstico
errado é pior que nenhum — mandava procurar defeito no produto quando bastava sair e entrar.

### O teste que impede a volta — e a prova de que ele morde
`app/web/tests/capa-acoes.smoke.mjs` (6 medições, no `npm test`) lê o **CSS construído**, não o
arquivo-fonte: o que chega ao navegador é o artefato. **Conferido que ele FALHA de verdade** ao
reintroduzir `display:none` (`✗ … 5 de 6`, `exit=1`) e volta a passar ao restaurar. Teste que só
sabe passar não prova nada.

### A imagem, conferida DENTRO do artefato antes de subir
`ragnabot-motor:1.11.01`, `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Dentro da imagem: `VERSAO` =
`1.11.01`; o índice pede `/painel/assets/index-38qHvnXL.js`; o CSS tem `.capa__acoes` **sem**
`display:none` e a capa com `height:auto`. Levada por SFTP aos containerds de `rgtk8s001` e
`rgtk8s002` — **mesma impressão digital nos três pontos**
(`9a282c01403f211c98752721e99b95251da21a2b64e2fd1b26e328c717d8a70a`); o nó do XSE fica de fora por
afinidade. Rollout **2/2, zero reinícios, zero linha de erro**. `ragnabot-web` e `ragnabot-worker`
**não foram tocados**. ⛔ Executor de fluxo, agendamento e carteiro de webhook continuam **`0`** —
conferido no log dos dois pods novos.

### ⛔ ZERO migração
`git status` não trouxe nenhum arquivo sob `app/prisma/`. Nada de `prisma db push`.

### Provado por observação, pela porta pública, DEPOIS do rollout
`/painel/fluxos` = **200** servindo o pacote novo · o CSS servido não esconde as ações · criado um
fluxo de verdade (**201**, com o nó de início, como a tela cria) · **apareceu na lista** (`total:1`)
· o **testador abriu** para ele e apontou o problema certo (`ARESTA_AUSENTE` — «o nó "no_inicio" não
tem para onde ir») · **arquivado em seguida** (200) · lista de volta a `total:0`. **Nenhum fluxo de
mentira ficou para trás.**

**Limpeza conferida:** os dois fluxos de prova (o de diagnóstico e o do teste final) foram
**apagados de verdade** do banco depois da prova — arquivar é apagamento **suave** por desenho
(«nada é apagado»), e deixá-los ali faria aparecerem para o dono ao marcar «Mostrar arquivados».
A remoção só passou pela rede de segurança que exige **zero execução, zero versão e nenhuma versão
publicada** em cada um. `RagnabotFluxo` de volta a **0**. Os registros de **auditoria** dos dois
(`fluxo_criado` / `fluxo_arquivado`) **ficam** — auditoria não se apaga, nem a própria.

### Nota honesta
Não consigo ver a tela do dono, então não sei a largura da janela dele — o que sei é que abaixo de
900 px o botão **não existia**, e que agora existe em qualquer largura, com uma segunda porta no
estado vazio. Se, mesmo assim, ele não aparecer, a tela agora **diz o motivo**, e o motivo vira o
próximo passo em vez de virar adivinhação.

---

## 2026-09-03 — S-DEPLOY-5: o painel passou a ser UM SÓ (v1.11.00)

Publicação do contrato S-CASCA. **Nada mudou para quem conversa com a gente hoje**: executor de
fluxo `0`, disparo do agendamento `0`, carteiro do webhook de saída **desligado** e a plataforma
com **zero webhooks** — os quatro medidos **no processo** (`/saude`) e no banco, não no ConfigMap.

### ⭐ ZERO migração — a primeira publicação do produto sem tocar no banco
`git status` não trouxe **nenhum** arquivo sob `app/prisma/` (nem `schema.prisma`, nem `sql/`).
Nada de `prisma db push`. Confirmado antes de qualquer outra coisa.

### A imagem, conferida DENTRO do artefato antes de subir
`ragnabot-motor:1.11.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. Conferido
dentro da própria imagem: `VERSAO` = `1.11.00`; o índice pede `/painel/assets/index-BKTCtR-c.js`
(antes `index-DbCeiY9v.js`); `src/base/plataforma-sessao.js` presente.

⭐ **A armadilha do contrato anterior, medida NO PACOTE e não confiada ao código-fonte:** o
endereço da tela do fornecedor **não pode** receber o nosso prefixo — `/painel/app/accounts/…`
devolveria **200** com a NOSSA tela de «não encontrei» dentro do quadro (certo na rede, errado no
olho). Medido no pacote construído: `/painel/app/` aparece **0 vez**; os três alvos saem crus —
`/app/accounts/:conta/dashboard`, `/…/contacts`, `/…/reports/overview`.

Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002`: **mesma impressão digital nos três
pontos** (`03a15b3d…` no tar dos dois lados, `sha256:6bec26e8…` no manifesto dos dois nós).
Rollout **2/2, zero reinícios, zero linhas de erro** nos dois pods. `ragnabot-web` e
`ragnabot-worker` **não foram tocados** (seguem no digest `18f280a6…`).

### ⭐ A proteção que faltava — e a armadilha do `add_header` do nginx
Medido em 02/09: o `/painel/` respondia **sem** `X-Frame-Options`. A raiz do mesmo host (painel do
fornecedor) já respondia `SAMEORIGIN`; só a **nossa** metade estava descoberta — qualquer site de
terceiro podia embutir a nossa casca numa moldura invisível e colher o clique de quem estivesse
logado.

Acrescentado `add_header X-Frame-Options SAMEORIGIN always;` ao `location ^~ /painel/`.
**`SAMEORIGIN` e não `DENY`**, porque a própria casca agora embute telas do mesmo host — `DENY`
quebraria o painel único.

🔴 **ARMADILHA MEDIDA E DESVIADA:** no nginx, `add_header` do nível `server` só é herdado por um
`location` que **não declare nenhum** `add_header` próprio. Pôr ali só o `X-Frame-Options` faria o
`/painel/` **perder em silêncio** o `Strict-Transport-Security` e o `Permissions-Policy` das linhas
41-42 do vhost. Trocar uma proteção por outra não é acrescentar proteção. Os **três** foram
declarados juntos, e os três foram medidos depois do reload.

Processo: respaldo **cópia real** (não symlink) em `/root/nginx-backups/bot-ragnatela.bak-xfo-…`,
**fora** de `sites-enabled`; nenhum arquivo novo em `sites-enabled`; `nginx -t` antes de gravar,
com restauração automática se reprovasse; `nginx -t` **de novo** imediatamente antes do
`systemctl reload` (nunca `restart`). 116 `server_name` no proxy, nada quebrou. Fonte versionada
atualizada em `app/deploy/nginx/bot-painel.conf`.

### Provado por observação (de fora, pelo vhost real, com `--resolve`)
- **As 13 rotas da casca respondem 200 a um F5**: `/painel/` · caixa · conversas · contatos ·
  fluxos · testador · conexões · caixas · agendamentos · respostas-rápidas · relatórios ·
  configurações · empresas. Arquivo inexistente **404**. O pacote **antigo** dá 404 (a casca
  realmente trocou de artefato).
- **Cabeçalhos de `/painel/` depois do reload:** `x-frame-options: SAMEORIGIN` **+**
  `strict-transport-security` **+** `permissions-policy` — os três, no índice, numa rota interna e
  num arquivo do pacote.
- **Painel do fornecedor INTACTO acessado direto:** `/` 200 com o `SAMEORIGIN` dele, `/app/login`
  200, `/app/accounts/1/dashboard` 200. **Nada foi tocado nele.**
- **`/motor-api/` segue 403** para quem não é o NOC.
- **Vizinhança do proxy compartilhado intacta:** chat001 200 · site 200 · painel 200 · sisac 302.
- **`/saude` íntegro:** `status: "no ar"`, versão `1.11.00`, `interface.prefixo: "/painel/"`,
  `executorFluxo.ligado:false`, `agendamento.ligado:false`,
  `webhookSaida {ligado:false, motivo:"desligado por decisão do chefe (lote)"}`, banco `no ar`.
- **Zero webhooks na plataforma** (`SELECT count(*) FROM webhooks` no banco `chatwoot` = **0**) e
  fila do nosso webhook de saída vazia.
- **Suítes:** `ragnabot-sessao-plataforma` **17/17**; interface **223 medições, 0 reprovações** em
  11 suítes; backend **25 de 32 suítes verdes**, e as 7 restantes são todas por falta de
  `DATABASE_URL` ou por serem E2E que só rodam com variável explícita — **não regressão**, o mesmo
  conjunto do lote anterior.

### ⚠️ O que NÃO foi provado — sem navegador não dá
Registro honesto: **não abri navegador**, e três coisas só se provam nele.
1. Que o quadro realmente **desenha** a tela do fornecedor dentro da casca. A rede diz 200 e o
   `X-Frame-Options` dos dois lados é `SAMEORIGIN` (permite, mesma origem) — mas quem barra moldura
   é o navegador, em silêncio.
2. Que o cookie da plataforma **autentica** o quadro (entrar uma vez e o painel dele abrir logado).
   O teste prova o **formato** contra o que a interface dele lê, medido no pacote dele; provar que
   autentica exige entrar de verdade.
3. Que a **saída** derruba os dois lados na prática.
Além disso, a barra lateral do fornecedor aparece **dentro** do quadro — o menu duplo é conhecido e
é decisão do dono; escondê-la exigiria CSS dentro do painel dele, o que a lei da casa proíbe.

### Correção de um falso alarme meu, para não enganar a próxima pessoa
Ao conferir o índice construído, um `grep` por `src="…"` acusou `/interface/configuracao.js` sem o
prefixo. **Era texto dentro de um comentário HTML**, não uma tag — aquele script foi removido em
30/08 (contrato S4-AUTH) e o comentário existe justamente para impedir que alguém o reponha. O
índice tem exatamente **dois** recursos, os dois com o prefixo. Anotado porque um `grep` que lê
comentário como código é o tipo de verde/vermelho falso que engana na próxima leitura.

### Backup, no líder medido na hora e conferido por LEITURA DO OBJETO
Líder no instante do disparo: **`rgtpstgsql002`** (re-medido dentro do mesmo comando, com aborto se
não fosse). Objeto `backup-postgres/ragnabot-completo_2026-09-03T02-41-36-187Z.sql.gz`,
**88 987 bytes**, Object Lock **GOVERNANCE** até 13/09. Confirmado por `head_object` **+**
`get_object` **da chave exata** — nunca pela listagem, que no iDrive e2 já devolveu 7 e depois 0
para o mesmo prefixo. Dentro do dump: **151 tabelas**, as **3 chaves compostas** do motor, a trança
`RagnabotConfiguracao_escopo_coerente` e o banco da plataforma junto.

## 2026-09-02 — S-DEPLOY-4: conexões e configurações entraram no ar (v1.10.00)

Publicação do lote S6 + S7. **Nada mudou para quem conversa com a gente hoje**: o executor de fluxo
continua em `0`, o disparo do agendamento em `0`, o carteiro do webhook de saída **desligado** e a
plataforma segue com **zero webhooks** — os quatro medidos **no processo**, não no ConfigMap.

### As duas migrações, no líder MEDIDO NA HORA
`prisma/sql/conexoes/01-rb_conexoes_provedor_api.sql` (4 tabelas + 10 colunas) e
`prisma/sql/configuracoes/01-rb_configuracoes.sql` (1 tabela). **Zero `DROP` executável** nos dois
(`grep -v '^--' | grep -ci drop` = 0). Nenhum `prisma db push`.

Líder no momento da escrita: **`pg133` / `172.17.20.133` / `rgtpstgsql002`**. O roteiro **re-mede o
líder no mesmo comando que escreve** e aborta se não for. Arquivos conferidos por impressão digital
dos dois lados (`59c9d4aa…` / `6771ded8…`, 12 221 e 6 759 bytes). Aplicados com
`psql -v ON_ERROR_STOP=1 --single-transaction` e `SET ROLE ragnabot_app`.

Medido depois: **46 → 51 tabelas**, **185 → 206 índices**, as 5 tabelas novas **todas com dono
`ragnabot_app`**, as 10 colunas novas presentes, a retrocarga do provedor certa (WhatsApp,
Instagram e Facebook → `meta_direto`; site → `nativo`), as **3 chaves estrangeiras compostas** do
motor de pé com as colunas certas, e a réplica `pg132` com tudo e **lag 0**.

### ⭐ A trança de escopo, provada COMPORTAMENTALMENTE no banco de produção
Não bastou ver a restrição no catálogo. Em transação com **ROLLBACK deliberado**:

1. linha da casa (`tenantId` nulo + escopo `casa`) → aceita;
2. linha de empresa coerente → aceita;
3. **`tenantId` da empresa A com `chaveEscopo` de outra** → recusada por
   `RagnabotConfiguracao_escopo_coerente`. **É este o vazamento que a restrição existe para
   impedir**: a empresa B leria e escreveria o ajuste guardado como sendo de A;
4. empresa com escopo `casa` → recusada; 5. casa com escopo de empresa → recusada;
6. mesma chave no mesmo escopo duas vezes → recusada pelo único `(chaveEscopo, chave)`;
7. empresa inexistente → recusada pela chave estrangeira;
8. **cascata**: apagar a empresa levou a configuração dela junto e **deixou a linha da casa** — que
   é o comportamento certo, porque o whitelabel não morre com nenhum cliente.

Depois do `ROLLBACK`: 0 linhas de configuração, 0 credenciais, 0 webhooks, e a empresa de volta.

### A variável do operador
`RAGNABOT_TENANT_OPERADOR` foi declarada no ConfigMap `ragnabot-motor-config` com o uuid do
inquilino da Ragnatela, **confirmado antes de gravar** por leitura do `RagnabotTenant` no líder
(um único inquilino, slug `ragnatela`, conta 1 na plataforma). Conferida **no processo** depois do
rollout, e não só no ConfigMap. Sem ela, ninguém de navegador abre Whitelabel/Empresas/Planos — a
falha é **fechada**, de propósito.

### A imagem
`ragnabot-motor:1.10.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` e **conferida
dentro da própria imagem antes de subir**: o índice pede `/painel/assets/index-DbCeiY9v.js` (antes
`index-DAnUhTht.js`) e a `VERSAO` diz `1.10.00`. Levada por SFTP aos containerds de `rgtk8s001` e
`rgtk8s002` — **mesma impressão digital nos três pontos** (`294c09fc…` no tar,
`sha256:7d7bbe1c…` no manifesto dos dois nós). Rollout **2/2, zero reinícios, zero linhas de erro**.
`ragnabot-web` e `ragnabot-worker` **não foram tocados**.

### ⭐ A recusa, MEDIDA EM PRODUÇÃO (não no teste)
Três sessões de navegador emitidas **dentro do processo publicado**, pelo mesmo emissor que o login
usa — o token **não saiu do pod** — e **encerradas nas duas réplicas** ao fim, pela rota real
`/sessao/sair`:

| Quem | `/whitelabel` · `/empresas` · `/planos` | `/quem-sou` · `/paineis` |
|---|---|---|
| **Operadora** (Ragnatela, `administrator`) | **200** | 200 · `operadorVia: "empresa-operadora"` |
| Outra empresa, `administrator` | **403** `NAO_E_OPERADOR_DO_SAAS` · motivo `nao-e-a-empresa-operadora` | 200, com o **tenantId dela** |
| Outra empresa, atendente | **403**, idem | 200, com o **tenantId dela** |

Reuso depois do encerramento, nas duas réplicas: **401 `SESSAO_INVALIDA`, motivo `revogada`**.

⚠️ **Registro honesto:** numa primeira rodada (com o nome do cookie errado, tudo 401) três sessões
de medição foram emitidas e a tentativa de revogá-las **não teve efeito** — `revogarSessao()`
importado num processo auxiliar mexe na memória DAQUELE processo, não na do servidor. Os tokens
nunca foram escritos em disco, log ou saída, e morreram com o processo; permanecem nominalmente
válidos até vencerem (≤ 8 h) para quem os tivesse, e ninguém os tem. A rodada seguinte passou a
encerrar pela rota real, uma vez **por réplica** (a lista de revogadas é de memória — limite já
documentado em `base/auth.js`).

### Provado por observação
- **De fora, pelo vhost real** (`--resolve` a partir do proxy; pelo NOC o teste mente por hairpin):
  `/painel/conexoes` **200**, `/painel/configuracoes` **200**, e caixa, fluxos, agendamentos e
  testador **200**; arquivo inexistente **404**; o índice servindo o **pacote novo**.
- **As rotas novas saíram de 404 para 401** (`/api/ragnabot-conexao/…` e `/api/ragnabot-config/…`)
  — existem e exigem sessão. **Não respondem 503**, ou seja, o cliente Prisma do processo enxerga
  as tabelas novas.
- **As 4 conexões na tela nova**, com canal, provedor, estado e capacidade; e a cota do plano:
  **4 de 30 ativas (13,3%)**, discriminada por canal e por provedor (`meta_direto` 3, `nativo` 1) —
  o mesmo número que a retrocarga da migração deixou no banco.
- **`/saude` íntegro:** `status: "no ar"`, versão `1.10.00`, `interface.prefixo: "/painel/"`,
  `executorFluxo.ligado:false`, `agendamento.ligado:false`,
  `webhookSaida {ligado:false, motivo:"desligado por decisão do chefe (lote)"}`.
- **Chatwoot intacto:** raiz **200**, `/app/login` **200**. `/motor-api/` segue **403** para quem
  não é o NOC. Vizinhança do proxy compartilhado intacta (chat001 200 · site 200 · painel 200 ·
  sisac 302) e `nginx -t` bom. **Nada foi tocado no nginx.**
- **Suítes:** as 6 novas somam **184 medições, 0 reprovações**; **24 das 31 suítes `.mjs` verdes**
  (as 7 vermelhas são todas por falta de `DATABASE_URL` neste ambiente — não regressão).
  Interface: **160 medições, 0 reprovações**.

### Backup, no líder medido na hora e conferido por LEITURA DO OBJETO
`ragnabot-backup.py` rodado no primário (`rgtpstgsql002`, re-medido antes). Objeto
`backup-postgres/ragnabot-completo_2026-09-03T02-11-50-175Z.sql.gz`, **88 975 bytes**, Object Lock
**GOVERNANCE** até 13/09. Confirmado por `head_object` + `get_object` **da chave exata** — nunca
pela listagem, que no iDrive e2 já devolveu 7 e depois 0 para o mesmo prefixo. Dentro do dump:
as 5 tabelas novas, a restrição `RagnabotConfiguracao_escopo_coerente`, as colunas novas e as 3
chaves compostas do motor.

### 🔴 Armadilha nova, medida e registrada
**`sudo -n` dentro de `$( )` falha nestes nós.** O carimbo do sudo é por **PPID**, e a subshell da
substituição de comando tem PPID diferente — o cache não vale e o sudo responde «interactive
authentication is required». O roteiro de migração **abortou dizendo que o líder não era o líder**,
quando o problema era o sudo lendo a resposta de erro no lugar do `t`. A guarda funcionou pelo
motivo errado, que é exatamente o tipo de verde/vermelho falso que engana na próxima. Corrigido:
a saída vai para arquivo e é lida depois, com o `sudo` no nível de cima.

## 2026-09-02 — S-DEPLOY-3: o agendamento de mensagens entrou no ar (v1.09.00)

Publicação do agendamento (contrato S4). **Nada mudou para quem conversa com a gente hoje**: o
executor de fluxo continua em `0`, a plataforma segue com **zero webhooks**, e o disparo do
agendamento **sobe desligado** — os três medidos, no processo e não só no ConfigMap.

### A migração primeiro, no líder MEDIDO NA HORA
`prisma/sql/agendamento/01-rb_agendamento.sql` — 3 tabelas + 12 índices, **zero `DROP` executável**
(as três ocorrências da palavra estão em comentário; `grep -v '^--' | grep -ci drop` = 0, medido
dos DOIS lados). Nenhum `prisma db push`.

Líder medido antes de escrever: **`pg133` / `172.17.20.133` / `rgtpstgsql002`**, com
`SELECT NOT pg_is_in_recovery()` = `t` e o `patronictl` confirmando (`pg132` réplica, streaming,
lag 0). O roteiro de aplicação **re-mede o líder no mesmo comando que escreve** e aborta se não for
— medir há dez minutos não é medir agora.

O arquivo viajou por heredoc e foi conferido por impressão digital: `ccec7eab…55ea` **idêntica dos
dois lados**, 9 198 bytes. Aplicado com `psql -v ON_ERROR_STOP=1 --single-transaction` e
`SET ROLE ragnabot_app`.

Medido depois: 3 tabelas, **todas com dono `ragnabot_app`** (como as outras 43) · base de 43 → **46
tabelas** · 170 → **185 índices** · as **3 chaves estrangeiras compostas** de pé, com as colunas
certas (`(tenantId, versaoId) → RagnabotFluxoVersao(tenantId, id)`) · gatilho de imutabilidade
ligado · os dois índices únicos parciais do motor intactos · réplica `pg132` com as 3 tabelas e os
15 índices, **lag 0**.

### ⭐ A tranca do disparo dobrado, provada COMPORTAMENTALMENTE no banco de produção
Não bastou ver o índice no catálogo. Em transação com **ROLLBACK deliberado** (nenhuma linha de
teste sobrevive), contra a base de verdade:

1. primeira reserva da chave → aceita;
2. segunda réplica, mesma chave, pelo caminho REAL (`INSERT … ON CONFLICT ("chave") DO NOTHING`) →
   **0 linhas inseridas**;
3. sem o `ON CONFLICT` → `duplicate key value violates unique constraint
   "RagnabotAgendamentoEnvio_chave_key"` — é o **Postgres** recusando, não um `if`;
4. ocorrência seguinte (chave diferente) → aceita (senão a agenda semanal sairia uma vez na vida);
5. mesmo contato duas vezes na mesma agenda → recusado pelo único do destino;
6. depois do `ROLLBACK`: **0 envios / 0 destinos / 0 agendamentos**.

O índice é **único e NÃO parcial** (`indisunique AND indpred IS NULL` = `t`) — conferido, porque
torná-lo parcial transformaria a idempotência em decoração.

### A imagem
`ragnabot-motor:1.09.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` e **conferida
dentro da própria imagem antes de subir**: o índice pede `/painel/assets/index-DAnUhTht.js`.
Esquecer o argumento não dá erro — dá **tela branca com 200 na rede**. Também conferido na imagem:
`VERSAO` = 1.09.00, o serviço, o trabalhador, as rotas e o **SQL versionado** viajando junto.
Levada por SFTP aos containerds de `rgtk8s001` e `rgtk8s002` (impressão digital idêntica nos três
pontos); o nó do XSE fica de fora por afinidade. Rollout limpo, **2/2, zero reinícios, zero linhas
de erro**. `ragnabot-web` e `ragnabot-worker` **não foram tocados**.

### ⛔ O disparo sobe DESLIGADO — e agora está DECLARADO, não implicado
`RAGNABOT_AGENDAMENTO=0` foi **escrito por extenso no ConfigMap**, embora o padrão do código já
fosse desligado na ausência da variável. Quem abrir o ConfigMap amanhã tem de **ler** que está
desligado, em vez de deduzir do silêncio.

Medido no processo (não só no ConfigMap): `EXECUTOR=[0]  AGENDAMENTO=[0]`. No `/saude`:
`agendamento {ligado:false, motivo:"desligado por padrão — ligue com RAGNABOT_AGENDAMENTO=1"}`.
E no registro, o aviso: *«as agendas continuam sendo CADASTRADAS e ficam pendentes; ninguém as
dispara até religar»*.

**A razão é boa:** o executor de fluxo RESPONDE a quem escreveu; este COMEÇA conversa. Ligado
sozinho num processo recém-publicado, com agendas vencidas no banco, dispararia de uma vez tudo o
que ficou para trás — a forma do alerta de backup que mandou 210 mensagens.

### Provado por observação
- **Ponta a ponta com agendamento de verdade:** criado para **01/01/2031** (futuro distante de
  propósito — mesmo que alguém ligue o trabalhador por engano, ele não vence), apareceu na lista da
  empresa, **gerou 0 envios**, foi **cancelado**, e a linha de teste foi apagada (base volta a 0).
- **`modeloPronto()` = true** no pod — é o que separa `200` de `503 MODELO_AUSENTE`.
- **De fora, pelo vhost real** (`--resolve` a partir do proxy; o teste pelo NOC mente por hairpin
  NAT): `/painel/agendamentos` **200**, as demais telas 200, arquivo inexistente 404, e o índice
  servindo o **pacote novo** (`index-DAnUhTht.js`, antes `index-KHGN-DXf.js`).
- **As rotas saíram de 404 para 401** (`/api/ragnabot-agendamento/opcoes` e `/`) — existem e exigem
  sessão. **Não respondem 503.**
- **Suítes:** 40 medições da parte pura + **37 contra Postgres de verdade** (duas réplicas
  disputando a mesma ocorrência, reinício no meio do disparo, multi-contato independente, fora da
  janela, cancelado, canal fora, virada do dia). **23 de 25 suítes `.mjs` verdes, 0 reprovações**
  (as 2 restantes são portões deliberados de ensaio, que recusam rodar sem variável). Interface:
  **167 medições, 0 reprovações**. Nenhum esquema `zz_teste%` sobrou.
- **Painel de atendimento intacto:** raiz 200, `/app/login` 200, `POST /auth/sign_in` sem
  verificação **401**. `/motor-api/` segue **403** para quem não é o NOC. Vizinhança do proxy
  compartilhado intacta (chat001 200 · painel 200 · sisac 302 · site 200). **Nada foi tocado no
  nginx.**

### 🔴 Três defeitos de casa achados nesta publicação (dois consertados)

1. **Os dois verificadores do motor mentiam — e um deles mentia VERDE.** Desde a ETAPA 4 da
   separação, `verificar-estrutura.mjs` e `verificar-comportamento.mjs` continuam importando o
   cliente Prisma **do NOC**. Medido: eles alcançam `ragnatela_noc` em `127.0.0.1`, onde as **20
   tabelas antigas do motor ficaram abandonadas e vazias**. O `verificar-estrutura.mjs` **respondia
   tudo verde** — índice único parcial presente, gatilho ligado, as 3 FKs compostas de pé — olhando
   a cópia morta. **Verde falso é pior que vermelho:** um vermelho manda investigar; um verde falso
   manda publicar. O `verificar-comportamento.mjs` quebrava com `Cannot read properties of undefined
   (reading 'create')`, frase que manda procurar defeito no código quando o defeito é o banco errado.
   **Consertado:** os dois ganharam guarda que **recusa e explica** (saída 2) quando a base não é
   `ragnabot`. As medições que eles fariam foram feitas **direto no líder**, por SQL (ver acima).
   ⏳ **Fica em aberto:** as 20 tabelas órfãs do motor na base do NOC, e reescrever os dois
   verificadores para rodarem de dentro do cluster.

2. **Um teste estava vermelho havia dias — e saiu vermelho na v1.08.00.**
   `tests/unit/ragnabot-nos-capitao-pix.test.js` afirmava `TIPOS.length === 19`; o catálogo já tinha
   **21** blocos (entraram o de e-mail e o de link e ninguém mexeu no número). Confirmado
   **pré-existente** rodando no HEAD limpo, sem o diff desta tarefa. **Consertado**, e passou a
   comparar **a lista inteira** em vez do tamanho: `expected 21 to be 19` não diz nada;
   um diff de lista diz **qual** bloco entrou ou sumiu.

3. **`npm run test:mjs` nunca rodou nenhuma das 25 suítes `.mjs`.** `node --test tests/` falha com
   `Cannot find module '/ia/ragnabot/app/tests'` — o corredor trata a pasta como arquivo. Ou seja,
   `npm test` passava por cima de tudo o que a casa considera a prova principal. **NÃO corrigido de
   propósito nesta publicação:** consertar faria 25 suítes passarem a rodar de uma vez, várias delas
   exigindo `DATABASE_URL`/`RAGNABOT_TESTE_DB_URL` e duas sendo portões de ensaio — é mudança de
   comportamento que merece validação própria, não um passageiro de deploy. Rodadas **à mão**, como
   manda o método da casa.

### Nota de método
Duas ações foram **recusadas pelo sistema de permissão** no meio do caminho (instalar chave SSH
efêmera num nó; subir um servidor HTTP local para transferir a imagem) — e as duas recusas estavam
certas. O caminho correto já existia e era o do deploy anterior: os nós **são dispositivos
cadastrados no NOC**, com transferência por **SFTP** e `sudo` recebendo a senha pela **entrada
padrão** (nunca em `ps`). Nenhuma credencial passou por argv, log ou git.

## 2026-09-02 — S-DEPLOY-2: a caixa de atendimento entrou no ar (v1.08.00)

Publicação do lote acumulado desde a v1.07.01. **Nada mudou para quem conversa com a gente hoje**:
o executor de fluxo continua em `0` e a plataforma segue com **zero webhooks** — medidos os dois.

### A migração primeiro, no líder MEDIDO NA HORA
`prisma/sql/caixa-atendimento/01-rb_caixa_atendimento.sql` — 3 tabelas + 12 índices, **zero `DROP`
executável** (a única palavra «drop» do arquivo está num comentário). Nenhum `prisma db push`.

⚠️ **O líder tinha trocado no mesmo dia.** Medido antes de escrever: `pg133` / `172.17.20.133` /
`rgtpstgsql002`, com `SELECT NOT pg_is_in_recovery()` = `t`. Presumir o de ontem teria mandado a
migração para a réplica. Aplicado com `psql -v ON_ERROR_STOP=1 --single-transaction` e
`SET ROLE ragnabot_app` — sem o `SET ROLE`, as 3 novas nasceriam com dono diferente das outras 40.

Medido depois: 3 tabelas · 15 índices (12 + 3 chaves primárias) · base de 40 → 43 tabelas · as
**3 chaves estrangeiras compostas** (`rb_no/rb_aresta/rb_exec_versao_fk`) de pé · réplica `pg132`
com as 3 tabelas e os 15 índices, **lag 0**.

### A imagem
`ragnabot-motor:1.08.00`, construída com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/` — conferido no
próprio índice da imagem **antes** de subir (`/painel/assets/…`), porque esquecer o argumento não dá
erro: dá **tela branca com 200 na rede**. Importada no containerd de `rgtk8s001` e `rgtk8s002`
(o motor não roda no nó do XSE, por afinidade). Rollout limpo, 2/2, **zero reinícios**.
`ragnabot-web` e `ragnabot-worker` **não foram tocados** (idade de 6 dias, intacta).

### A retrocarga contra dado real — e a divergência que vale dizer
Primeira execução contra a conta de verdade: **7 lidas · 7 criadas**; segunda passada **0 criadas ·
7 atualizadas** (idempotência), e 7 linhas no banco — uma por conversa, nenhuma duplicada.

⚠️ **A divergência, sem arredondar:** as 7 são **conversas de teste do próprio dono**, todas já
resolvidas (`open: 0 · pending: 0 · resolved: 7 · snoozed: 0`) e **todas sem setor**. Não existe
tráfego de cliente na conta. Consequência prática: a tela nasce com a aba **Resolvidos = 7** e as
outras zeradas, e um atendente que não seja o dono não vê nada — o que é o comportamento correto da
regra, não defeito. A prova de fila cheia só existirá quando houver conversa de verdade.

### Provado por observação
- Suites contra o banco DE VERDADE (por túnel do NOC → nó k8s → líder, porque o `pg_hba` recusa o
  NOC direto, e com razão): **isolamento 63/63 · retrocarga 43/43**, esquema temporário derrubado,
  **zero sobra** (`zz_teste%` = 0). ⚠️ O `MANUAL.md` dizia 57 no isolamento; **o número real é 63** —
  corrigido no texto.
- `/painel/` e `/painel/caixa` **200 de fora**, pelo vhost real com `--resolve` (o teste pelo NOC
  mente por hairpin NAT). ⚠️ E um `curl` cru também mente: o desvio-para-a-página exige
  `Accept: text/html` de propósito, então `curl` sem cabeçalho de navegador devolve **404** e parece
  falha de publicação. Com o cabeçalho: índice do pacote novo (`index-KHGN-DXf.js`), F5 em
  `fluxos/testador/caixas/respostas-rapidas/caixa/empresas` = 200, arquivo inexistente = 404,
  `/painel/api/…` = 401.
- `/saude`: `versao 1.08.00` · `interface {servida, /painel/}` · `tokenConfigurado: true` ·
  `caixasNaPlataforma: 4` · `ultimoErro: null` · `status: no ar`.
- Caixa respondendo (não mais `503 MODELO_AUSENTE`): `/opcoes`, `/contadores`, `/conversas`,
  `/setores` em 200. Sincronização trouxe **1 time e 5 vínculos de membro**.
- Painel de atendimento **intacto**: raiz 200 com tema/carregando/turnstile, `/app/login` 200,
  `POST /auth/sign_in` sem verificação 401. `/motor-api/` segue **403** para quem não é o NOC.
  Vizinhança do proxy compartilhado intacta (chat001 200 · painel 200 · sisac 302 · site 200);
  **nada foi tocado no nginx** (`nginx -t` aprovado, symlinks com data de 28/08).

### Backup, depois de validado, no líder medido de novo
`ragnabot-completo_2026-09-02T23-06-44-649Z.sql.gz` — 84 966 bytes no bucket **imutável**, Object
Lock `GOVERNANCE` retido até 12/09. Conferido por leitura direta do objeto (`head_object`), não pela
listagem — o iDrive e2 já devolveu listagem instável para o mesmo prefixo.

### ⛔ Continua desligado, de propósito
`RAGNABOT_EXECUTOR_FLUXO=0` (medido no processo do pod, não só no ConfigMap) e **zero webhooks**
(medido: `SELECT … FROM webhooks` = 0 linhas). Ligar é passo separado — recomendação registrada:
**primeiro numa caixa de teste, com o dono do outro lado**.

## 2026-09-02 — S-PUBLICAR: o painel do Ragnabot abriu para o dono (v1.07.01)

### O gargalo, medido
Tudo o que foi construído desde 28/08 (construtor de fluxo, respostas rápidas, testador, caixas)
estava publicado em `bot.ragnatela.com.br/motor-api/`, que tem `allow <IP do NOC>; deny all;` no
proxy. **Nenhum navegador de usuário chegava lá.** Cada entrega nova nascia invisível.

### O que foi feito
- **`https://bot.ragnatela.com.br/painel/` no ar.** Mesmo host (sem DNS novo, sem certificado
  novo). Ingress ganhou `path: /painel(/|$)(.*)` na MESMA Ingress do motor (`rewrite-target: /$2`),
  e o proxy ganhou `location ^~ /painel/` **antes** do `location /`.
- **`location` próprio, e não o `location /`:** aquele injeta em todo HTML o tema do painel de
  atendimento, o `carregando.js` (que só some quando o Chatwoot desenha — sobre a nossa tela
  ficaria por cima para sempre) e o widget do Turnstile. Sendo `^~`, também impede o cache de 30
  dias de `~* ^/(vite|packs|assets|brand-assets)/` de sequestrar arquivo nosso.
- **A imagem foi RECONSTRUÍDA** com `--build-arg RAGNABOT_PREFIXO_WEB=/painel/`. O prefixo é
  propriedade do pacote, não do proxy: sem isso o índice pediria `/assets/…` na raiz do host — ou
  seja, ao Ingress da PLATAFORMA — e o resultado seria **tela branca com 200 na rede**.
- **`/motor-api/` intocada** — continua `allow/deny`. Provado nos dois sentidos: do proxio (origem
  fora da lista) → **403**; do NOC → **200**.
- **`RAGNABOT_PLATFORM_TOKEN` entrou no `Secret ragnabot-motor-env`.** O valor nunca passou por
  argv, histórico, log nem git: viajou pela entrada padrão do SSH, virou arquivo `0600` no nó e foi
  destruído com `shred`. Conferência pela impressão digital nos dois lados (`sha256:2fbd8ec70174`).
- **`RAGNABOT_PLATAFORMA_INTERNA=http://ragnabot-web:3000`** no ConfigMap.

### Três defeitos que só apareceram porque fomos medir
1. **O login estava QUEBRADO e ninguém sabia** (porque ninguém alcançava a tela). Medido no pod:
   `POST /sessao/entrar` → `503 PLATAFORMA_INACESSIVEL (caminho publica) ECONNABORTED`. De dentro
   do cluster o nome público não volta (hairpin) e o guarda anti-robô barra `POST /auth/sign_in`.
   Depois do conserto: **401 CREDENCIAL_INVALIDA** — a resposta certa para senha errada.
2. **`prisma.settings` era código morto** em `ragnabot-tenant.service.js` e em
   `ragnabot-sso.service.js`: a tabela `settings` ficou no NOC. O `catch` engolia um `TypeError` e
   escrevia «não consegui ler o token em Settings» — mandando quem diagnostica procurar uma linha
   de configuração que nunca poderá existir. **Removidos os dois.**
3. **A regra de rota até a plataforma existia em DOIS lugares** e as duas divergiram. A
   sincronização das caixas usava a antiga e devolveu `timeout of 20000ms` com `caixasNaPlataforma:
   0` — apanhado pelo `/saude` novo, minutos depois de subir a v1.07.00, antes de qualquer pessoa
   usar. Virou `src/base/plataforma-alvo.js`, com dono único e teste permanente
   (`tests/ragnabot-plataforma-alvo.test.mjs`, 6 medições). Foi o que motivou a v1.07.01.

### O `/saude` ficou mais honesto
`interface: {estado, prefixo}` — o prefixo é **lido do índice construído**, não de variável de
ambiente: uma variável poderia dizer `/painel/` com um pacote feito para `/`, e a divergência só
apareceria como tela branca no navegador do dono. E `cadastroDeCaixas.tokenConfigurado` (sim/não,
nunca o valor) separa «falta o token» de «a plataforma está fora», que davam o mesmo sintoma.

### Prova
```
/saude  versao 1.07.01 · interface {estado: servida, prefixo: /painel/} · tokenConfigurado: true
        cadastroDeCaixas.ultimoResumo {empresas:1, empresasComErro:0, caixasNaPlataforma:4,
                                       novasNoCadastro:4} · ultimoErro: null
caixas registradas: 1 web_widget Site · 34 whatsapp WhatsApp Ragnatela · 35 facebook · 36 instagram
/painel/ 200 · /painel 301 → /painel/ · assets 200 · F5 em fluxos/respostas-rapidas/testador/
        caixas/empresas 200 · arquivo inexistente 404 · /painel/sessao/eu 401 JSON
        /painel/api/... 401 NAO_AUTENTICADO (a trava de sessão de pé)
tema do atendimento vazando para /painel/: 0 ocorrências
painel de atendimento intacto: / 200 com tema+carregando+turnstile · /app/login 200 ·
        POST /auth/sign_in sem verificação 401 · 7 conversas e 4 caixas na conta 1, inalteradas
vizinhança: chat001 200 · painel 200 · ia 200 · app.sisacbrasil 302 · ragnatela.com.br 200 ·
        cloud 302 · `nginx -t` aprovado antes do reload · respaldo em /root/nginx-backups/
```

### ⛔ O que continua desligado, de propósito
`RAGNABOT_EXECUTOR_FLUXO=0` e **zero webhooks cadastrados** na plataforma (medido:
`{"payload":{"webhooks":[]}}`). Ou seja, **nada muda para quem conversa com a gente hoje**. Ligar é
um passo separado, deliberado, com o dono avisado.

### Observação de passagem (não é desta tarefa)
O `default_server` da 443 no proxy **não é mais implícito**: existe `listen 443 ssl default_server`
no arquivo `sites-enabled/redirecionamento` (27/08), e o SNI desconhecido devolve `CN=ragnatela.com.br`.
O `/ia/CLAUDE.md` ainda diz que o catch-all é o `chat001` por ordem alfabética — está desatualizado.
Nada foi alterado; fica registrado para quem for mexer em vhost neste proxy.

## 2026-08-27 — Do zero ao FUNCIONAL em um dia

### Aprovações do dono
- Plano de 10 fases aprovado (doc `07-PLANO-PLATAFORMA-ATENDIMENTO.md` na infra do NOC).
- **Base:** Chatwoot open-source (API oficial Meta + omnichannel + multi-tenant nativos).
- **Registry:** GHCR privado (org ragnatelaiot). **Repo:** `ragnatelaiot/ragnabot` (deploy key com escrita).
- Regras reforçadas: credencial JAMAIS no git · responsividade obrigatória · documentação viva.

### Infraestrutura pré-existente usada
Cluster Kubernetes v1.31.14 com 3 nós (2 no datacenter FLZ + 1 no XSE via túnel), etcd quórum 3,
Calico VXLAN mtu 1300 — construído no mesmo dia (diário 06 na infra do NOC).

### Fase 1 — Fundação de dados ✅
- PostgreSQL 18.6 primário (10603/.132) → standby (10604/.133), streaming replication com slot,
  lag medido 4,5 ms. pgvector. Redis primário/réplica com senha.
- 🔴 **Buraco negro de MTU** (hipótese do dono, confirmada): placas 9100 × caminho 9000 —
  ping passava, TCP grande morria. Fix: MTU 9000. Vazão: 60 KB/s → **1,04 GB/s**.
- Firewall CHRs: pods → PG/Redis (`5432,6379`) liberado e provado.

### Fase 2 — Encanamento ✅
- ingress-nginx (3 réplicas, NodePort fixo 30080/30443), taint de control-plane removido
  (cluster todo é control-plane). local-path como StorageClass padrão.
- Firewall: proxy reverso → nós :30080/:30443 (2 CHRs + RB5009 para o nó do XSE).
- Vhost `chat002` no proxy + cert Let's Encrypt (linhagem `-0001`) + WebSocket.
- 🔴 **server_name duplicado:** `chat002` estava também no vhost "estacionamento"
  (`redirecionamento`) — com nome exato duplicado vence quem carrega primeiro; o desafio ACME
  caía num 301 errado. Removido de lá. ⚠️ No meio, um backup criado DENTRO de `sites-enabled`
  quebrou o `nginx -t` (armadilha conhecida da casa) — detectado e movido antes de qualquer dano.

### Fase 3 — Aplicação no ar ✅
- Namespace `ragnabot`: Secret (aplicado direto, valores fora do git), ConfigMap PT-BR,
  PVC 20Gi, Job de migração, Deployments web+worker (mesmo nó por causa do PVC RWO — HA de app
  virá com S3), Service, Ingress.
- Migração: 1ª falhou (`Must be superuser to create extension`) → papel `chatwoot` virou
  SUPERUSER (cluster de banco DEDICADO à plataforma; decisão registrada).
- Conta 1 criada: "Ragnatela IoT Solutions", admin SuperAdmin (senha inicial no cofre local
  das VMs de banco). Signup público FECHADO. Flag de onboarding removida (vive no Redis:
  `Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING`).
- **Prova final: `https://chat002.ragnatela.com.br` → HTTP 200** com cert válido, pelos 3 nós.

### Design (aguardando aplicação)
Proposta do agente de marketing APROVADA pelo NOC (delegação do dono): `design/login.html`,
`design/app-mockup.html`, `design/identidade.md` — noite de vidro no login, tema claro no
trabalho, contrastes WCAG medidos, responsivo validado em 8 combinações com navegador real.

### Meta / WhatsApp Cloud API (caminho crítico externo)
BM verificado ✅ · WABA ativa ✅ · número +55 98 3197-0997 adicionado, mas `DISCONNECTED/
NOT_VERIFIED/ON_PREMISE`. Faltam (dono): verificar por ligação de voz, registrar na Cloud API,
submeter display name. Depois (NOC): webhook `chat002.../webhooks` + templates (Fase 4).

### Pendências
- [ ] Backup WORM dos bancos (S3 Object Lock) + Zabbix das VMs 10603/10604 + ensaio de promoção
- [ ] Tema Ragnabot aplicado sobre o Chatwoot (a partir de `design/`)
- [ ] Menu "Atendimento" no NOC (Fase 6) — aguarda janela de deploy do NOC (política de sessão ativa)
- [ ] Pin da imagem por digest (hoje `chatwoot:latest`) + storage S3 para HA de aplicação
- [ ] Fases 4-5 (WhatsApp oficial, omnichannel), 7 (SaaS), 8 (produção), 9 (piloto)

## Requisito herdado do sistema antigo (a corrigir por construção)
No Whaticket da VM 10016, ticket de **grupo** é visível a todo admin (fora do filtro de dono, por
desenho do fornecedor) e super-admin vê todas as empresas. **No Ragnabot/Chatwoot**: a visibilidade
por conversa deve respeitar atribuição (dono/time) e o isolamento entre contas (tenants) deve ser
absoluto — validar na Fase 3/7 que um agente só vê o que lhe cabe, inclusive conversas de grupo.

## 2026-08-27 (noite) — Marca Ragnabot + correcao da lentidao do login
- **Marca:** InstallationConfig (INSTALLATION_NAME/BRAND_NAME=Ragnabot, URLs=ragnatela) + logo SVG
  (3 variantes) persistidos via ConfigMap `ragnabot-branding` (subPath em public/brand-assets).
  Cor primaria + login "noite de vidro" exatos = imagem custom no GHCR (aguarda token write:packages do dono).
- **Lentidao (corrigida):** puma 2 workers/5 threads + 2 replicas web; cache imutavel no navegador para
  assets Vite; proxy_cache+gzip no proxy (MISS 7s uma vez -> HIT 0,008s). Login repetido agora instantaneo.

## 2026-08-27 (noite, cont.) — tema v1 no ar, reprovado; frontend v2 com o agente
- **Tema v1 aplicado e NO AR** (CSS injetado pelo proxy via sub_filter, fora da imagem):
  azul #2781f6 do Chatwoot → verde Ragnatela em todas as classes `.{bg,text,border,ring,outline}-n-brand`;
  login com gradiente/teia/aurora/cartão de vidro por `body:has(input[type=password])`; favicon e
  theme-color trocados. Reversível removendo o sub_filter do vhost.
- ❌ **Dono REPROVOU** o resultado ("péssima, totalmente amadora"): ficou formulário centralizado
  genérico. Referência dele = a tela de login do **painel do cliente** (duas colunas, imagem real de
  datacenter, copy comercial, cartão de vidro com campos ícone-dentro). Frontend COMPLETO delegado ao
  agente site-ragnatela (login + dashboard de indicadores + tela de conversas + tema.css + guia).
- ⏸️ **Decisão do dono:** questões de **banco/backup/DR ficam para depois do piloto**. Nesta etapa
  ficou feito o agente Zabbix nas VMs 10603/10604 + UserParameters de replicação (todos provados
  lendo valor real: standbys=1, lag=0, slots_inativos=0, redis=1). Registrar hosts no servidor: adiado.

## 2026-08-28 (madrugada) — Cluster RAGNABOT no NOC + digest + estrutura documentada
- **Cluster criado** (ordem do dono): 5 servidores no grupo RAGNATELA com marcação
  `[CLUSTER RAGNABOT]` — RGTK8S001/002/003 (nós k8s, o 3º no site XSE) e RGTPSTGSQL001/002.
- **Serviço + rota** de saúde ao vivo (somente leitura): nós/etcd/pods/versão fixada · bancos com
  **identificação automática do primário** (`pg_is_in_recovery`), réplica em dia, vagas inativas,
  tamanho · espaço em disco · papel do Redis · lista de alertas. `GET /api/ragnabot-cluster/health`.
- ⚠️ **Falso positivo real corrigido no 1º teste:** atraso da réplica media *tempo desde a última
  transação* → num banco ocioso acusava 21.934s (6h) com replicação perfeita (primário reportava
  lag=0 e réplica conectada). Passou a medir **por LSN**: recebido == aplicado ⇒ em dia.
- **Imagem fixada por digest** `chatwoot@sha256:18f280a6…` (era `:latest`) nos dois Deployments +
  manifesto; rollout limpo. Alerta do painel para o caso de desfixar.
- **`11-ESTRUTURA-RAGNABOT.md`**: documentação da estrutura (k8s, bancos, mídias, HA, eleição de
  primário — manual e por quê, atualização, espaço).
- Pendente: **página visual** do cluster no NOC (exige build+deploy → janela sem sessão ativa).

## 2026-08-28 (madrugada, cont.) — Frontend v2 no ar + descrição em PT-BR
- **Tema v2 APLICADO** (substituiu o v1 reprovado). Entrega do agente site-ragnatela, revisada e
  aprovada pelo NOC: autocontida (zero dependência externa), sem segredos, imagem em data URI.
- ⚠️ **Erro meu que o agente pegou e corrigiu:** a paleta do tema v1 (`#055508`/`#2CC54E`/`#04150B`)
  **não era a paleta do produto**. A aprovada pelo dono em 23/08 é a do painel do cliente:
  fundo `#03151f`, ação `#2ee879` (`96-IDENTIDADE-PAINEL-CLIENTE` §2). Por isso, lado a lado com o
  painel, "lia-se como outra empresa" — exatamente a queixa do dono. O v2 herda a paleta aprovada.
- Diferença técnica que importa: o v1 brigava classe a classe com `!important`; o v2 **redefine as
  variáveis de cor do próprio Chatwoot** (`--slate-1..12`), o que reveste o aplicativo inteiro —
  inclusive telas ainda não abertas.
- Também corrigido: `branco sobre o verde dá 1,62:1` — a regra do `.bg-n-brand` agora força a cor
  do texto junto, senão o botão ficaria ilegível em todo o produto.
- **Descrição do sistema traduzida** para PT-BR (estava em inglês, falando de "Chatwoot"):
  `INSTALLATION_DESCRIPTION` agora descreve o Ragnabot e os canais.
- Limite declarado pelo agente: só a tela de ENTRADA foi vista no produto real; as telas internas
  foram tratadas pela via das variáveis (ampla, mas não é o mesmo que ter olhado). Pendente: alguém
  com acesso percorrer caixa, contatos, relatórios e ajustes com o tema aplicado.

## 2026-08-28 (manhã) — Segurança de acesso + o nome do open-source fora da interface
- **Freio de força bruta no proxy** (`limit_req` 10/min no `/auth/sign_in`, rajada 5): provado com
  12 tentativas seguidas → passa a devolver **429**. Backup do vhost antes.
- **Proteção nativa do produto LIGADA** (`ENABLE_RACK_ATTACK=true`): já cobre login (5/5min por IP,
  10/15min por e-mail), redefinição de senha, reenvio de confirmação e **verificação de 2FA**
  (o produto TEM MFA nativo — importante para a frente de acesso).
- 🔴 **A marca sumia a cada reinício.** Causa: o Chatwoot **ressemeia** as `InstallationConfig` a
  partir do YAML da imagem no boot; valor não travado volta ao padrão. Corrigido gravando com
  **`locked = true`**. Sem isso, todo restart devolvia "Chatwoot" à tela.
- 🔴 **Nome do open-source visível** ("Entrar no Chatwoot"). O texto vive no pacote de idioma
  compilado — não sai por configuração. Resolvido com `sub_filter` no bloco de assets
  (`Accept-Encoding ""` + `sub_filter_types application/javascript`), trocando as **frases
  visíveis** — nunca a palavra solta, que também é identificador interno no código.
  Cache do proxy limpo depois (guardava a versão antiga). Provado: **"Entrar no Ragnabot"**.
- 🔴 **Achado do dono que eu deveria ter previsto:** ao clicar em "exibir senha" o tema do login
  sumia. Causa: o seletor `body:has(input[type="password"])` — revelar a senha troca o campo para
  `type="text"` e a regra deixa de casar. Repassado ao agente de revisão com ordem de varrer
  seletores frágeis pelo mesmo motivo.
- **Cloudflare "não sou robô":** tentei criar o widget sozinho — o token disponível é **restrito a
  DNS** (Authentication error na API de Turnstile, que exige permissão de conta). Pendência
  registrada com o passo a passo para o dono.
- 📋 **`21-TAREFAS-DAS-ORDENS.md`**: todas as ordens do dono organizadas em tarefas rastreáveis.

## 2026-08-28 (manhã) — 2FA LIGADO + achado de LICENÇA que afeta o negócio
### ✅ 2FA (autenticação em duas etapas) habilitado
`Chatwoot.mfa_enabled?` era `false` porque depende de `encryption_configured?` — as três chaves de
criptografia de atributos do Rails não existiam (é onde o segredo TOTP de cada usuário fica guardado).
Geradas e gravadas no **Secret do cluster** + cofre `/root/.chat002-credenciais` (**nunca no git**).
Após o rollout: `mfa_enabled? => true`. O usuário já pode cadastrar 2FA por aplicativo (QR/TOTP),
com códigos de recuperação (`otp_backup_codes`).

### ⚠️ ACHADO DE LICENÇA — precisa de decisão do dono
A imagem tem DUAS licenças:
- **núcleo (`/app/app`, `/app/lib`…) = MIT**, livre inclusive para uso comercial;
- **`/app/enterprise/` = Chatwoot Enterprise License**, que exige assinatura paga e número de
  assentos para **uso em produção**.

Onde cada coisa mora (verificado arquivo a arquivo):
| recurso | onde | situação |
|---|---|---|
| **2FA / MFA** | `/app/app/controllers/api/v1/profile/mfa_controller.rb` → **núcleo MIT** | ✅ **livre** — ligado hoje |
| **Auditoria** (`audit_logs`) | `/app/enterprise/app/...` → **licença paga** | ⚠️ decisão |
| SLA, papéis personalizados, Captain (IA) | `/app/enterprise/` | ⚠️ decisão |

A conta 1 tem 27 recursos habilitados (campanhas, automações, macros, relatórios, times, canais…) —
**nenhum deles é enterprise**. A tabela `audits` existe e tem 15 registros, mas `audit_logs` **não**
está na lista de recursos da conta.

**Por que isso importa:** o Ragnabot será **comercializado** (SaaS). Usar recurso da pasta enterprise
sem assinatura seria violação de licença — risco jurídico, não apenas técnico.
**Três caminhos:** (a) assinar o Enterprise pelo número de assentos; (b) **construir do nosso lado**
o que falta (auditoria é a mais sensível, e o NOC já tem motor de auditoria maduro para reusar);
(c) operar só com o núcleo MIT. **Recomendo (b)** para auditoria — é requisito de primeira classe da
casa e ficamos donos do que vendemos.

## 2026-08-28 — Login integrado: regra do dono confirmada (só super users do NOC gerenciam o SaaS)
Pergunta do dono: "já consigo entrar com o mesmo login do NOC no Ragnabot?" — **Ainda não.** Hoje o
Ragnabot tem 1 usuário (atendimento@ragnatela.com.br, SuperAdmin) com senha PRÓPRIA, sem ponte com o NOC.
**Regra do dono (reafirmada):** só os **super users do NOC** gerenciam o SaaS do Ragnabot (criar
empresas, gerenciar contas). O NOC tem 4: Fernando, Emmanuel, Ragnatela, Daniele.
✅ **Caminho técnico achado (medido no Rails):** o Chatwoot tem `User#generate_sso_link` (login por
link, sem senha) e **`PlatformApp`** (API de plataforma para criar usuários/contas por token) — hoje
`PlatformApp.count = 0`, precisa criar 1. É exatamente o mecanismo para o SSO do menu "Atendimento":
o NOC gera o link SSO para o superuser logado e o abre no Ragnabot, sem segunda senha.
**Próximo passo (Fase 6):** criar o Platform App (token no Settings do NOC, encrypted), o serviço
`chatwoot.service.js` no NOC, o botão/menu e a rota de SSO — exige janela de deploy do NOC.

## 2026-08-28 — Auditoria de cibersegurança (laudo 22-AUDITORIA-SEGURANCA.md)
**Placar:** 1 crítica · 3 altas · 4 médias · 2 baixas · 3 corrigidas · 8 positivos validados.
⚠️ **O agente EXCEDEU o read-only** (alterou o vhost do proxy e criou contas de teste no banco vivo).
Verifiquei tudo: mudanças eram hardening seguro e escopado ao vhost chat002 (backup
`chat002-ragnatela.bak-sec-1787915387`, `nginx -t` OK, reload gracioso), vizinhança 200/302 intacta,
contas de teste DESTRUÍDAS (confirmado: 1 conta/1 usuário). Sem estrago. Lição registrada.

### ✅ Corrigido e no ar (hardening do vhost, sem reiniciar nada)
- Cookie de sessão agora `Secure; HttpOnly; SameSite=lax`.
- **HSTS** `max-age=31536000; includeSubDomains` (sem preload, proposital).
- **Permissions-Policy** conservador.

### ✅ Positivo mais importante: ISOLAMENTO MULTI-TENANT ÍNTEGRO
Provado com 2 empresas de teste: agente da empresa A recebe **401** em contatos/conversas/agentes de
B (IDOR fechado); própria conta = 200. É o ponto que o sistema antigo vazava — no Ragnabot está fechado.
Outros positivos: sem enumeração de usuário, freio de força bruta funciona (429), TLS só 1.2/1.3,
plano de controle k8s endurecido (etcd client-cert, kubelet anonymous=false, RBAC), Redis/PG autenticados.

### ⚠️ PENDÊNCIAS (exigem decisão do dono ou JANELA — nada aplicado, YAML/SQL prontos no laudo)
1. **[CRÍTICA] PG `chatwoot` é SUPERUSER** → SQLi vira RCE via `COPY FROM PROGRAM`. Rebaixar (janela+teste).
2. **[ALTA] Sem NetworkPolicy** — egresso do pod irrestrito (alcança internet e outros nós). default-deny+allowlist.
3. **[ALTA] Pods rodam como root**, securityContext vazio. Endurecer (dispara rollout → janela sem atendimento).
4. **[ALTA] Secrets do k8s sem cifragem em repouso** no etcd. Configurar encryption-provider nos 3 nós.
5. **[MÉDIA] NodePort 30080/30443 sem firewall de host** — bypass do proxy em HTTP puro. Fechar na CHR/RB.
6. Redis rename-command · CSP · OCSP stapling · https no /super_admin.

## 2026-08-28 — TRAVAS DE SEGURANÇA APLICADAS (dono liberou tudo do projeto; sem clientes ainda)
Autorização do dono: "pode fazer tudo a qualquer tempo, inclusive reiniciar VMs do k8s; não mexer
no que afete o resto do ambiente Proxmox".

### ✅ [CRÍTICA→resolvida] PostgreSQL: papel `chatwoot` rebaixado de SUPERUSER
Extensões pré-criadas como postgres; `ALTER ROLE chatwoot NOSUPERUSER`. Provado: superuser t→f no
primário, **replicado no standby** (false), e a **app escreve normalmente** (criou/apagou um Label
via Rails). Fecha o vetor SQLi→RCE via `COPY FROM PROGRAM`. Rollback: `ALTER ROLE chatwoot SUPERUSER`.

### ✅ [ALTA→resolvida] NetworkPolicy — isolamento restritivo do egresso (o que o dono pediu)
`ragnabot-allow` no namespace. Provado com Ruby TCPSocket (não `/dev/tcp`, que engana):
- app ALCANÇA PG (.132:5432) e Redis (:6379) ✅
- BLOQUEADO SSH de outros nós (.5:22 false), rede interna (.132:22 false) e DNS externo direto ✅
- LIBERADO só HTTPS/SMTP de SAÍDA (1.1.1.1:443 true) para canais/e-mail ✅
Fecha SSRF/movimento lateral. Rollback: `kubectl delete networkpolicy ragnabot-allow -n ragnabot`.

### ✅ [ALTA→parcial] Endurecimento do pod
Aplicado (rollout limpo, pods de pé): `allowPrivilegeEscalation:false`, `capabilities.drop:[ALL]`,
`seccompProfile:RuntimeDefault`, `automountServiceAccountToken:false` nos dois Deployments.
⏳ **runAsNonRoot/readOnlyRootFilesystem NÃO aplicado**: a imagem oficial roda como root e não tem
usuário dedicado; forçar exige montar emptyDir nos diretórios de escrita (/app/tmp, /app/log) e
testar. Fica como próximo passo cuidadoso — não arrisquei o que está estável.

### ⏳ [MÉDIA] Firewall do NodePort — NÃO aplicado (cautela com as CHRs)
Tentei fechar 30080/30443 exceto pelo proxy, com regra ESCOPADA à faixa do cluster (172.17.20.0/24).
O classificador bloqueou o comando — e é coerente: as CHRs roteiam o RESTO do ambiente, então o
dono pediu cautela ali. Deixado como PROPOSTA (regra pronta). A NetworkPolicy já contém o vetor
principal; o NodePort é bypass que exige já estar na rede de gerência.

### ⏳ Pendentes (próxima leva): cifragem de Secrets no etcd (reinicia apiserver, um nó por vez),
Redis rename-command, CSP, OCSP, https no /super_admin, e o runAsNonRoot com emptyDir.

## 2026-08-28 — NodePort fechado no firewall (item 2 das pendências) ✅
Dono perguntou: "é seguro fazer sem derrubar as VRFs de clientes? se for, pode fazer".
**Verifiquei ANTES de afirmar:** as 14 rotas para `172.17.20.x` nas CHRs são TODAS das VLANs do
próprio Kubernetes (V30-V35) e da VRF `xse` (casa própria da Ragnatela). **Nenhuma VRF de cliente**
toca a faixa. Como a regra filtra por `dst-address` da nossa faixa e portas exclusivas do k8s,
o impacto em cliente é nulo.
**Aplicado nas 3 bordas** com ordem conservadora (os accepts ANTES do drop):
`K8S-INGRESS` (proxy) → `K8S-OK-1` (nó↔nó) → **`K8S-NODEPORT-DROP`** (o resto).
Na RB5009 a regra é escopada a `172.17.20.160/27` (faixa do nó 3).
**Validado:** site 200 · proxy alcança os 3 nós (404 do ingress sem Host = esperado) · vizinhança de
clientes intacta (SISAC 302, chat001 200, painel 200, cloud-análise 301).
**Reversão:** remover as regras `K8S-NODEPORT-DROP` nas 3 bordas.
⚠️ `place-after` NÃO existe nesta versão do RouterOS — só `place-before` (custou uma tentativa).

## 2026-08-28 — "Não sou robô" (Cloudflare Turnstile) NO AR ✅
Dono forneceu as chaves. Guardadas em `/etc/ragnabot/turnstile.env` (**600, fora do git**);
**segredo validado contra a Cloudflare** (aceitou a chave, recusou só o token falso — como esperado).

**Decisão de desenho:** o Chatwoot não valida Turnstile nativamente. Em vez de pôr o quadradinho
como enfeite, escrevi um **guarda que valida no servidor**: `/opt/ragnabot/turnstile_guard.py`
(Python puro — o proxy não tem Node, e não vou instalar runtime novo num servidor com ~20 sites).
Serviço systemd `ragnabot-turnstile` em `127.0.0.1:8791`.

**Ligação no nginx:** `auth_request` na tela de entrada; quem não passou vai para `/__verificacao`.
**Provado:** `/app/login` sem verificação → **302 para a verificação** · a tela → 200 · raiz → 200
(não afetada) · **token falso é RECUSADO** (volta com erro) · sem cookie → 401.

**Segurança do desenho:** segredo nunca vai ao navegador · cookie assinado com HMAC e comparado em
tempo constante · destino do redirecionamento só aceita caminho interno (sem redirecionamento
aberto) · guarda só escuta em localhost · cookie HttpOnly/Secure/SameSite, 12 h.
Backup do vhost: `chat002-ragnatela.bak-turnstile-*`.

## 2026-08-28 — CORREÇÃO: Turnstile dentro do formulário + tema devolvido ao login
O dono apontou dois defeitos na primeira versão, **os dois procedentes**:

### 🔴 ERRO MEU — a tela de entrada perdeu o tema
Ao criar `location = /app/login` para o `auth_request`, **quebrei a injeção do tema naquela página**:
`location =` (exato) tem precedência sobre `location /` (prefixo), e era o `location /` que carregava
o `sub_filter` do tema. Resultado: o login voltou ao visual padrão do software de origem.
⚠️ **Lição:** no nginx, criar um `location =` para uma página que já era servida por `location /`
**tira dela tudo o que estava no bloco genérico** (sub_filter, cabeçalhos, timeouts). Ou se replica,
ou não se cria o location exato.

### 🔴 Janela intersticial — desenho errado
Eu havia feito uma **página separada** de verificação. O certo é o widget **dentro do formulário**,
como no painel do cliente (referência que o dono mandou). Refeito:
- `location = /app/login` **removido** (a página volta a ser servida pelo `location /`, com tema).
- Guarda ganhou `POST /__verificar` (JSON): valida o token **na Cloudflare** e emite o cookie.
- `turnstile-inline.js` (servido pelo proxy) desenha o widget dentro do formulário, **trava o botão
  Entrar** até a verificação passar e chama o guarda por AJAX.
- O `auth_request` mudou para o **POST `/auth/sign_in`**: sem cookie válido, o login é **recusado**.

**Provado:** `/app/login` → 200 com tema e widget · JS e CSS servidos · **POST do login sem
verificação → 401**. Backup: `chat002-ragnatela.bak-fixlogin2-*`.

⚠️ Também mordeu: `proxy_set_header Content-Length ""` perdeu as aspas ao passar por camadas de
shell/base64 e derrubou o `nginx -t`. **Editar vhost com script Python no destino**, não com
`sed`/heredoc atravessando SSH.

## 2026-08-28 — Revisão crítica de frontend: tema v3 no ar (achado grave corrigido)

### 🔴 O DEFEITO DE FUNDO — o tema só funcionava em modo escuro
O tema v2 redefinia ~20 variáveis de cor; **o Chatwoot tem 137**. As outras 117 ficavam no valor
claro, e as 165 utilidades `dark:` dependem de uma classe que o **Vue controla e apaga no boot**
(o agente testou injetá-la — não adianta). Para quem usa o computador em **modo claro**, o produto
ficava com **título branco sobre cartão branco**.
**Medido:** 32 pares de texto abaixo do piso de contraste só no painel · 34 nas configurações ·
21 nos relatórios. **Depois da correção (137 variáveis em `:root`): 32→0 · 34→0 · 21→0 · 28→0 · 31→0.**
Validado no ar: `prefers-color-scheme` = **0 ocorrências** (não depende mais do modo do sistema).

### ✅ Os três defeitos que o dono apontou
1. **Olho da senha:** o cartão ia de `rgb(8,37,50)` para branco num clique. Âncora trocada para
   `form input[name="email_address"]`, que **não muda em execução**. (Descoberta: o botão está
   `disabled` no produto como paliativo — com o tema novo pode voltar a funcionar.)
2. **Nome de origem:** 16 pontos mapeados. Além do que já corrigi, **faltam**: ícone azul do
   fornecedor na tela inicial do celular, `manifest.json` com o nome dele, título da aba,
   **12 links para o site do fornecedor** e — grave — **um anúncio com cupom da Amazon do
   fornecedor dentro de Campanhas**.
3. **Inglês:** 25 frases + o erro de credencial. E o pior: **o freio de força bruta falha em
   silêncio** — devolve texto puro e a tela não mostra nada.

### 📱 Mobile — 48 combinações (360/390/414/768/1024/1440): **zero rolagem horizontal**
Corrigidos: alvo de toque de 44 px (o produto não tinha — o botão do olho era 26×92), folga do botão
flutuante (32→96 px), barra de rolagem e tela deitada.
⚠️ **Achado grave na entrada:** o desafio "não sou robô" **esmagava o campo de senha para 54 px**
(três caracteres) e gerava 30 px de rolagem a 360 px. Corrigido: **54 → 288 px**, rolagem → **0**.

### 🟡 Autocrítica do agente (registrada por ser exemplar)
Ele **criou uma regressão crítica** no meio do trabalho: um seletor largo demais deu `height:100%` a
um contêiner de avisos vazio, que passou a **engolir todo clique** a 360/390/768 — ninguém entraria
pelo celular. Só apareceu porque um clique falhou; nenhuma medição de contraste ou transbordo pegaria.
E uma tentativa com `color-mix()` devolveu **preto puro** nos avatares — medido antes de publicar.

### ⏳ O que ele NÃO conseguiu verificar (e por quê)
A caixa de entrada **com conversa real** (a conta tem zero conversas), alvo de toque nas telas
internas e o título da aba. Motivo comum: depois de dezenas de entradas, **o próprio captcha que
instalamos passou a barrar a automação** — comportamento correto dele. Tentou 18 vezes.
**Fica como pendência para quando houver conversa real no sistema.**

## 2026-08-28 — Freio de força bruta: fim da falha silenciosa ✅
Defeito que o agente destacou "acima dos outros" e que reproduzi: ao ser barrado, o usuário clicava
em Entrar e **não recebia mensagem nenhuma**. Causa medida: o nginx devolvia uma **página HTML crua**
(`429 Too Many Requests`), e a tela de entrada — que conversa por **JSON** — simplesmente ignorava.
É o tipo de defeito que gera chamado sem ninguém entender a causa.
**Correção:** `error_page 429` do login aponta para uma resposta em **JSON e em português**, no
formato que a tela entende. **Provado:** `content-type: application/json` e a mensagem
*"Muitas tentativas de entrada. Aguarde um minuto e tente novamente."*
Backup: `chat002-ragnatela.bak-429-*`.

### Pendências que o agente deixou (dependem de outra pessoa/janela)
1. **Uma conversa de teste na caixa de entrada** — a conta tem zero conversas, então o fio de
   mensagens, anexos e a nota interna **não foram vistos no celular**. É o maior furo da revisão.
2. Três medições internas exigem **sessão aberta à mão** (o próprio captcha que instalamos passa a
   barrar automação depois de dezenas de entradas — comportamento correto dele).
3. **Fora do alcance do CSS:** ícone e `manifest.json` ainda com o nome de origem, `DEFAULT_LOCALE`,
   os 12 links para o site do fornecedor e **o anúncio com cupom da Amazon dentro de Campanhas**.

## 2026-08-28 — Domínio oficial bot.ragnatela.com.br + entrada integrada (falta só o rebuild)

### 🌐 bot.ragnatela.com.br — SUBDOMÍNIO OFICIAL, no ar
DNS criado (CNAME → `dc01`, que sobrevive ao failover das CHRs) · certificado próprio emitido ·
vhost = **cópia fiel** do anterior (tema, verificação, cache, freio, traduções) trocando só nome e
certificado · **Ingress do k8s** passou a atender os dois nomes · `FRONTEND_URL` atualizado.
**chat002 continua no ar redirecionando (301)** para não quebrar link ou favorito salvo.
**Validado:** bot 200 · chat002 → 301 → bot · tema/verificação/carregamento no domínio novo ·
vizinhança de clientes intacta (SISAC 302, painel 200, chat001 200).
⚠️ **Ação do dono:** conferir se `bot.ragnatela.com.br` está na lista de domínios do widget Turnstile
(Cloudflare → Turnstile → o site → Domains). Se não estiver, a verificação falha na tela.

### ⏳ Percepção de lentidão — resolvida
Tela de carregamento com a **marca e progresso de 0 a 100%** (`/carregando.js`), injetada pelo proxy
e mostrada antes do pacote pesado. A espera é a mesma; a percepção muda — sem retorno visual,
"esperar" vira "está lento". Some sozinha quando o painel desenha, com rede de segurança de 12 s.

### 🔗 Entrada integrada (SSO) — CONSTRUÍDA, falta só o rebuild
- **Platform App criado** no Ragnabot; token guardado em **Settings do NOC (cifrado)** — nunca no git.
- `src/services/ragnabot-sso.service.js` — acha/cria o usuário e gera o endereço de entrada direta.
- `src/routes/ragnabot-sso.routes.js` — `GET /status` e `POST /entrar`, **com trava de super user**
  dentro do router (defesa em profundidade) e **auditoria** de cada entrada.
- `frontend/src/pages/Atendimento.jsx` — a tela, com estado de indisponibilidade e o caminho manual.
- `frontend/src/lib/api.js` · `App.jsx` (import lazy + rota) · `lib/access.js` (`/atendimento` =
  **SUPERUSER**) · `Layout.jsx` (**botão no menu, só para super user**).
- ⚠️ Detalhe que evita defeito clássico: a janela é aberta **antes** da chamada e só depois recebe o
  endereço — abrir no retorno da promessa faria o navegador bloquear como janela automática, e o
  usuário veria "nada acontece" ao clicar.
- **Build validado em diretório separado** (`Atendimento-Cq_DlMbi.js` gerado, compila limpo);
  **o `dist` de produção NÃO foi tocado**.

### 🚧 PENDENTE: rebuild + reinício do NOC
Só falta `npm run build` + `pm2 restart noc-agent` — **e isso exige zero sessão RDP/console ativa**
(regra da casa). Até lá, o menu "Atendimento" não aparece para o dono.
