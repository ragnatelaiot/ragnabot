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
null`). A ação **notificar** agora tem consumidor próprio, com tique de 15 s: quando o trabalho chega a ele
o prazo já venceu. Ele cobre **dois tipos** de trabalho — o aviso do relógio e a mensagem avulsa da
portaria — e respeita a **janela de 24 h** do WhatsApp: fora dela a ação de estado acontece, a
mensagem não sai, e o motivo fica na nota interna. O texto sai **só** por esse caminho: o envio
direto do trabalhador foi removido em 29/08 porque fazia o cliente receber a mesma mensagem duas
vezes, por um atalho que não conferia a janela.

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
**Publicação (v1.01.00).** Publicar congela o rascunho numa **versão imutável** e reaponta o fluxo.
A assinatura de estrutura **ignora as coordenadas do editor** — arrastar um bloco não cria versão
nova e não órfã quem está no meio da conversa; mudar uma ligação/tipo, sim. Reverter **copia para a
frente** (versão nova com o conteúdo antigo), mantendo a numeração contínua. _Planejado:_ o
**resolvedor de entrada** (quem escolhe o fluxo do primeiro "oi") ainda não amarra o motor (§A1).

---

## 5-A. A portaria de entrada (o primeiro "oi")

**O que faz.** É quem decide o que acontece quando o cliente escreve: começar um fluxo, mandar para
a fila humana, ou responder só um aviso.

**Como o operador percebe.** O cliente manda "oi" e o chatbot responde. Fora do expediente, recebe o
aviso configurado em vez de ficar no vácuo.

**Como funciona por dentro.** Grava a entrada (reentrega da mesma mensagem é reconhecida e
descartada), e então: se a conversa **já tem um fluxo em andamento**, a mensagem vai direto ao motor
— sem passar pelo resolvedor. Essa exceção existe por um motivo concreto: sem ela, quem estivesse no
meio de um menu às 18h01 receberia "estamos fechados" e ficaria travado esperando uma resposta que a
portaria tinha engolido. Se não há fluxo vivo, o resolvedor decide, e o que não vira fluxo vira
trabalho na fila para o consumidor entregar.

---

## 5-B. Respostas rápidas

**O que faz.** Atalhos de texto do atendente.

**Como o operador usa.** Cadastra `/bomdia` com o texto, e ao usar o atalho o texto sai pronto — com
`{{firstName}}`, `{{ticket_id}}` e `{{protocolo}}` já preenchidos. A resposta pode ser **da empresa**
(todo mundo usa) ou **pessoal** (só de quem criou), e pode valer só numa caixa ou num time.

**Como funciona por dentro.** O atalho repetido é recusado **pelo banco**, não só pela tela — e o
truque para isso é uma chave calculada, porque no Postgres dois nulos não são iguais e um índice
sobre colunas anuláveis deixaria cadastrar `/bomdia` dez vezes. Uma empresa nunca enxerga a resposta
da outra: o filtro vem sempre do usuário logado, e o que está fora do escopo responde **404**, nunca
403 — 403 confirmaria que existe.

---

## 5-C. Turno por atendente

**O que faz.** Define o horário de cada atendente, quando ele difere do horário da empresa.

**Como o gestor usa.** Cadastra a janela de quem tem horário próprio. **Quem não cadastrar nada
continua herdando o horário da empresa** — é o caso da maioria, e é de propósito: se a ausência de
turno significasse "indisponível", ligar a função esvaziaria a fila no primeiro dia.

**Como funciona por dentro.** Quem tem turno é avaliado pela própria grade; as **exceções do
calendário da empresa** (feriado, meio expediente) continuam valendo e derrubam o turno — e o motivo
diz "empresa fechada", não "fora do turno", senão o gestor procuraria defeito na grade da pessoa. O
plantão 22:00–06:00 numa empresa 08–18 **funciona**: se o sistema exigisse as duas coisas ao mesmo
tempo, esse plantonista ficaria disponível nunca, sem erro nenhum aparecendo.

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
