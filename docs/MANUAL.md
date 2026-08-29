# 📖 Manual do Ragnabot — como cada função funciona

> **Manual vivo.** Cresce a cada versão. Para cada função, três perguntas: **o que faz**, **como o
> operador usa**, **como funciona por dentro** (o suficiente para operar e diagnosticar, sem virar
> código). Quando uma versão nova entra em `VERSOES.md`, a função correspondente entra ou muda aqui —
> os dois arquivos andam juntos.
>
> Estado coberto: **v1.00.00**. O que ainda não existe está marcado _(planejado)_ e aponta o item
> do `docs/32-PLANO-DE-EXECUCAO.md`.

---

## Sumário
1. [Conexões e automações](#1-conexões-e-automações)
2. [Relógios de atendimento](#2-relógios-de-atendimento)
3. [Expediente, intervalo e feriado](#3-expediente-intervalo-e-feriado)
4. [Transferência](#4-transferência)
5. [Fluxo de conversa (chatbot)](#5-fluxo-de-conversa-chatbot)
6. [Multiempresa, planos e cobrança](#6-multiempresa-planos-e-cobrança)
7. [Protocolo e auditoria](#7-protocolo-e-auditoria)
8. [Infraestrutura (o que sustenta tudo)](#8-infraestrutura)
9. [Backup e recuperação](#9-backup-e-recuperação)

---

## 1. Conexões e automações

**O que faz.** Cada número de WhatsApp (e, _planejado_, cada página de Facebook/Instagram) é uma
**conexão**. As automações moram **nas propriedades da conexão** — inatividade, relógios de
"aguardando", expira-ticket e qual fluxo dispara no primeiro contato.

**Como o operador usa.** Abre a conexão e configura: quantos minutos de silêncio até agir, qual lado
conta esse silêncio (contato, atendente ou qualquer um), e o que acontece no vencimento.

**Como funciona por dentro.** A configuração vive em `RagnabotAtendPolitica`, com **escopo** por
empresa, por caixa ou por time. O campo que decide o silêncio é `inatividadeConta`
(`contato`/`atendente`/`qualquer`) — o mesmo conceito que na origem se chamava
`inatividadeLastMessageType`. O trabalhador de atendimento (a cada 60s) lê a política e age.

---

## 2. Relógios de atendimento

**O que faz.** Devolve para a fila, encerra ou avisa uma conversa parada — sozinho.

**Como o operador usa.** Liga o relógio de inatividade na conexão e define minutos + ação. Fora do
expediente, o relógio **congela** (não dispara de madrugada).

**Como funciona por dentro.** Cada conversa ganha uma linha em `RagnabotAtendRelogio` com quando
vence e o que fazer. O trabalhador reconcilia a cada tique: arma o relógio quando a conversa fica
elegível, re-arma quando há nova interação, e no vencimento despacha a ação — **devolver para a
fila**, **transferir de time**, **resolver** ou **notificar**. A entrega é idempotente: o mesmo
vencimento entregue duas vezes não repete o efeito nem a mensagem (`updateMany where disparadoEm:
null`). A ação **notificar** hoje só enfileira — falta o consumidor _(planejado, §A4)_.

---

## 3. Expediente, intervalo e feriado

**O que faz.** Define quando a empresa atende, inclusive **intervalo de almoço** e **feriado**.

**Como o operador usa.** Cadastra as janelas do dia (ex.: 08:00–12:00 e 13:00–18:00) e as datas
especiais (avulsas ou que se repetem todo ano, como `*-12-25`).

**Como funciona por dentro.** `RagnabotAtendExpediente` guarda **uma linha por janela** — é isso que
torna o intervalo possível (o chat anterior guardava uma janela por dia e não conseguia).
`RagnabotAtendExcecaoData` guarda os feriados. O cálculo de "próxima abertura" e de "minutos de
expediente" respeita fuso (padrão `America/Fortaleza`) e o dia é conferido **duas vezes**: quando o
prazo é calculado e de novo na hora de disparar.

---

## 4. Transferência

**O que faz.** Passa a conversa para outro atendente ou para um time — e **tira o atendente
anterior junto**.

**Como o operador usa.** Escolhe o destino; a conversa sai da sua mão e aparece livre para quem
recebe.

**Como funciona por dentro.** `devolverParaFila` põe a conversa em `pending` **e** remove o
`assignee`; `transferirTime` atribui o `team` **e** zera o `assignee`. Manter o atendente antigo
colado não é transferência, é etiqueta — por isso os dois passos, nessa ordem. O histórico vai para
`RagnabotAtendTransferencia` _(o registro amarrado ao caminho de entrada é §A5)_.

---

## 5. Fluxo de conversa (chatbot)

**O que faz.** O roteiro que responde ao cliente automaticamente — menus, perguntas, condições.

**Como o operador usa.** Monta o fluxo arrastando blocos no editor; publica quando pronto.

**Como funciona por dentro.** Motor nativo, 20 tabelas. Uma **versão publicada é imutável** (o motor
recusa editá-la); uma conversa tem **uma execução por vez** (recusa duas). Se o processo morre no
meio, a execução **retoma sozinha**. A fila do motor (`RagnabotFluxoFila`) particiona por
`conta:conversa`, o que impede o relógio de mexer na conversa no meio de um passo do fluxo.
_Planejado:_ o **resolvedor de entrada** (quem escolhe o fluxo do primeiro "oi") e a **publicação**
— cuja assinatura de estrutura precisa **ignorar as coordenadas do editor** (`no.ui`), senão
arrastar um bloco vira mudança estrutural e órfã as conversas em curso (§A1, §A2).

---

## 6. Multiempresa, planos e cobrança

**O que faz.** Cada empresa cliente é isolada, com seu plano e sua cobrança.

**Como funciona por dentro.** Provisionamento cria a conta na plataforma; planos e assinaturas
controlam limites (usuários, conexões, filas) e módulos ligados. Cobrança integrada. O isolamento
entre empresas é feito **sempre a partir do usuário logado**, nunca do que a tela manda — admin de
uma empresa não enxerga outra (provado contra o ataque real).

---

## 7. Protocolo e auditoria

**O que faz.** Todo atendimento tem um número humano; toda ação sensível fica registrada.

**Como funciona por dentro.** O protocolo (`RGT-0000000001`, três letras por empresa) é gerado quando
a conversa nasce, à prova de corrida (25 emissões simultâneas → 25 números únicos). A auditoria
registra acesso, atendimento, configuração e dados — com quem, quando, onde e o antes/depois.

---

## 8. Infraestrutura

**O que faz.** Mantém a plataforma de pé mesmo perdendo uma máquina.

**Como funciona por dentro.** Kubernetes de 3 nós (1 por hipervisor); banco com **troca automática
de líder** (Patroni + etcd, 3 votos, `failsafe_mode`); fila com Redis Sentinel (quórum 2 de 3);
anexos em MinIO próprio (6 discos, paridade 3 — um hipervisor pode cair e continua gravando). Regra
de ouro: **cada peça redundante entre hipervisores diferentes**. Detalhe completo em
`deploy/LEIA-ME.md` e `docs/30-INFRAESTRUTURA-RAGNABOT.md`.

> ⚠️ **O líder do banco muda.** Nenhum código pode supor qual é — descobre a cada vez com
> `SELECT NOT pg_is_in_recovery()`. E **nunca** `prisma db push`/`migrate dev` no repositório do NOC
> (apaga em silêncio as chaves compostas que isolam empresas).

---

## 9. Backup e recuperação

**O que faz.** Guarda uma cópia fria do banco, imune a apagar por engano ou ransomware.

**Como funciona por dentro.** Uma vez por dia, o NOC descobre o líder do cluster, roda `pg_dump` nele
e envia para bucket com **Object Lock** (nem o administrador apaga). A recriação do zero está em 8
passos no `deploy/LEIA-ME.md`.

---

<!-- MODELO DE NOVA SEÇÃO (uma por função nova; entra junto com a versão em VERSOES.md):

## N. <Nome da função>
**O que faz.** ...
**Como o operador usa.** ...
**Como funciona por dentro.** ...
-->
