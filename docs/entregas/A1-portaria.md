# A1 — A PORTARIA: o primeiro "oi" acorda o fluxo

**Arquivos:** `/ia/netagent/src/services/ragnabot-portaria.service.js` ·
`/ia/netagent/tests/ragnabot-portaria.test.mjs`
**Base documental:** doc 28 §1.1 (o papel `portaria`) e §1.2/(2) · doc 29 §5.2 (resolvedor de
entrada), §5.3 (quem manda no relógio), §5.4 (a fila e a serialização por conversa).
**Estado:** implementado e provado por teste (11 casos, todos passando). **Não amarrado ao processo**
— a rota/`server.js` é decisão do chefe.

---

## 1. O que faltava, em uma frase

O Ragnabot tinha as duas metades e elas não se falavam. `resolverEntrada()` já sabia **qual** fluxo
atende cada mensagem, e `iniciarOuRecuperarExecucao()` já sabia **fazer nascer** a conversa com o
robô — mas nenhum código do repositório chamava a segunda. O cliente mandava "oi" e o motor de
fluxo, inteiro, nunca era acionado. A portaria é esse aperto de mão.

## 2. Como o operador percebe isso

O cliente manda **"oi"** no WhatsApp. Em vez de a conversa ficar parada esperando alguém, o fluxo
publicado da caixa começa a rodar: sai a saudação, sai a pergunta, e o menu segue. Quando o cliente
responde, a resposta é gravada na variável certa do fluxo e a conversa anda sozinha até o fim ou até
o momento em que o fluxo passa a bola para uma pessoa.

Se **não houver fluxo publicado** para aquela empresa/caixa — que é o estado do ambiente hoje —
nada quebra: a conversa vai direto para a **fila humana**, com o motivo registrado (`sem_fluxo`).
Nunca fica sem dono.

Se for **almoço, fora de expediente ou feriado** sem fluxo próprio, a decisão vira uma mensagem
("voltamos às 13h") e **nenhum robô é acordado**.

E se o Chatwoot entregar a **mesma mensagem duas vezes** (ele reentrega, e é para reentregar mesmo),
o cliente não recebe a saudação em dobro nem vê o menu recomeçar: a segunda entrega é reconhecida e
descartada.

## 3. Como funciona por dentro

`atenderMensagemRecebida({ tenantId, cwAccountId, cwConversationId, cwInboxId, texto, mensagemId,
agora, ... })` executa, nesta ordem:

1. **Grava a entrada bruta** em `RagnabotFluxoEntrada`, com uma chave calculada
   (`cw:<conta>:<evento>:m:<id>`, ou o sha256 do corpo canonicalizado quando não há id estável). Essa
   linha é a **prova** de que a mensagem chegou e é a **primeira barreira de idempotência**.
2. **Reentrega?** A colisão da chave única não é erro — é o resultado correto. Devolve `duplicada`,
   não inicia nada, não enfileira nada.
3. **Não é resposta de cliente?** (criação de conversa, mudança de status, eco da nossa própria
   mensagem) Grava e para. Evento de controle nunca acorda fluxo.
4. **Já existe execução viva nesta conversa?** Então a mensagem é *dela*: vai direto ao motor como
   trabalho `entrada`, **sem passar pelo resolvedor**. É o que impede o cliente que está escolhendo a
   opção 2 às 18h01 de receber "estamos fechados" em vez de ter a escolha processada.
5. **Senão, o resolvedor decide** (`resolverEntrada`), com a precedência escrita uma vez só:
   palavra-chave → feriado → fora de hora → intervalo → primeiro contato → fluxo padrão/da caixa →
   fila humana.
6. **Iniciar fluxo:** chama `iniciarOuRecuperarExecucao()` com `fluxoId`/`versaoId` já resolvidos,
   cancela os relógios de atendimento ainda não disparados daquela conversa (§5.3) e enfileira
   `iniciar` (execução nova) ou `entrada` (execução recuperada).
7. **Só mensagem / fila humana:** nenhuma execução nasce. Se houver texto a dizer, ele vira **trabalho
   na fila** (`atend_mensagem`), nunca uma chamada direta ao canal.

**Tudo o que é enfileirado usa `chaveParticao = "conta:conversa"`** — a mesma unidade de serialização
do motor e do trabalhador do relógio. É isso que impede a portaria e o relógio de mexerem na mesma
conversa ao mesmo tempo.

### Idempotência, com nome e sobrenome
- **1ª barreira (reentrega):** `RagnabotFluxoEntrada.chave` é única. Segunda entrega = `duplicada`.
- **2ª barreira (consumo):** `RagnabotFluxoEntradaConsumida` — já existia no motor; a portaria não
  reinventou nada.
- **3ª barreira (nascimento):** uma execução viva por conversa, garantida pelo índice único parcial +
  trava de partição do motor. Mesmo que a portaria fosse chamada duas vezes, a segunda recupera a
  execução da primeira.

### As quatro armadilhas que o arquivo existe para evitar
1. a mensagem entregue duas vezes virando conversa nova;
2. o "estamos fechados" no meio do menu;
3. dois donos do mesmo silêncio (fluxo e relógio avisando juntos);
4. a corrida entre as duas réplicas de portaria no nascimento da execução.

## 4. O que ficou de fora, declarado

- **Amarração no processo.** A portaria não está ligada a nenhuma rota. `ragnabot-webhook.routes.js`
  continua só emitindo protocolo e auditoria — quem monta o webhook de mensagem, configura as portas
  e reinicia é o chefe.
- **A implementação da fila.** A porta `fila` (`enfileirar`) é injetada; **não existe implementação
  concreta de `RagnabotFluxoFila` no repositório ainda**. Sem ela, a execução nasce e quem recolhe é o
  varredor de órfãos do motor — funciona, mas com a latência do varredor.
- **O consumidor de `atend_mensagem`.** O tipo de trabalho é novo e declarado; quem o consome é a
  fatia A4 (a fila `atend_relogio`). Até lá a linha fica na fila como registro durável da intenção.
- **A janela de 24 h.** A portaria repassa a `janela` se quem chama a informar; ela **não** consulta
  `RagnabotFluxoJanela` por conta própria (isso depende de `phoneNumberId`, que só existe quando
  houver caixa de WhatsApp de verdade).
- **Vigia de entrada órfã.** Se o processo morrer entre gravar a entrada e enfileirar o trabalho, a
  entrada fica com `resultado` nulo e só é recolhida no próximo trabalho **daquela mesma conversa**.
  Um vigia que varre entradas órfãs sem job é trabalho não construído — decisão do chefe.
- **Prova em ambiente real.** Não há caixa de WhatsApp criada. Tudo acima foi provado contra um dublê
  de banco em memória, com o código real da portaria, do resolvedor e do motor. Nada foi medido com
  mensagem de cliente de verdade.
