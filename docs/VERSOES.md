# 📌 Versões do Ragnabot

> **O que é este arquivo.** É o diário de bordo das funcionalidades do Ragnabot — a nossa
> plataforma de atendimento omnichannel. Cada versão registra, em português claro, **o que passou a
> existir** e **o que ainda depende de quê**. É a fonte para acompanhar as novidades e para explicar
> ao cliente o que mudou.
>
> **Como versionamos.** `MAIOR.MENOR.CORREÇÃO` (ex.: `1.04.02`).
> - **MAIOR** — mudança de patamar (um canal novo inteiro, um módulo grande).
> - **MENOR** — funcionalidade nova dentro do que já existe.
> - **CORREÇÃO** — conserto ou ajuste sem funcionalidade nova.
>
> A versão vigente fica no arquivo `VERSAO` na raiz do repositório. **Toda entrega nova acrescenta
> um bloco no topo desta lista** — nunca reescreve os antigos.
>
> **O que é o número da plataforma-base.** O Ragnabot roda sobre o Chatwoot; a versão dele é técnica
> e separada. Este arquivo versiona **o nosso produto** — a soma da infraestrutura, das automações e
> das integrações que construímos por cima.

---

## v1.03.00 — Lista com seções, botão de link e e-mail no fluxo (29/08/2026)

Os blocos do montador de fluxo passaram a ter o que o bot atual tem — desenhado a partir da leitura
dos **35 fluxos dele em produção**, não de suposição.

- **Menu lista com seções e cabeçalho.** Itens agrupados sob títulos, com cabeçalho em negrito.
- **Botão de link**, ao lado dos botões de resposta.
- **A mistura é impedida na origem:** no WhatsApp, botão de resposta e botão de link não convivem na
  mesma mensagem — a Meta recusa tudo. A tela oferece a escolha no nível do bloco em vez de deixar
  errar e reclamar depois; o motor recusa nos dois pontos (validação e execução).
- **O botão de link não espera resposta.** A Meta não avisa o clique; se o fluxo esperasse, a
  conversa travaria e a pessoa seria transferida para um humano por ter feito o que o botão pediu.
- **Bloco de e-mail** — destinatário, assunto, corpo, responder-para e cópia oculta, com variáveis.
  O cabeçalho remove quebras de linha (impede acrescentar destinatários ocultos por texto digitado)
  e o corpo escapa HTML. "Responder para" e "cópia oculta" agora chegam ao envio de verdade.

### Depende de
- Nenhuma caixa de WhatsApp existe: nada disso foi visto chegando num aparelho. Os limites de
  tamanho vêm da documentação da Meta, não de observação.
- O adaptador que entrega as mensagens ao canal ainda não existe no repositório — quando nascer,
  precisa conhecer os campos novos.

---

## v1.02.00 — O chatbot atende, o relógio fala, e quatro defeitos a menos (29/08/2026)

Quatro automações novas — e uma auditoria que encontrou quatro defeitos reais no que já rodava.

### O que passou a existir
- **A portaria do primeiro "oi".** O motor de conversa estava pronto e ninguém o acionava quando a
  mensagem chegava. Agora a conversa é encaminhada para o fluxo, para a fila humana ou recebe só um
  aviso — e quem já está no meio de um menu **não é interrompido** por uma mensagem de expediente.
- **O aviso "ainda está aí?" sai de verdade**, pelo caminho que respeita a **janela de 24 h** do
  WhatsApp. Fora dela, a conversa muda de estado do mesmo jeito e o motivo fica na nota interna.
- **Respostas rápidas** — atalho vira texto pronto, com nome do cliente e número do chamado
  preenchidos. Atalho repetido é recusado pelo banco; uma empresa nunca vê a resposta da outra.
- **Turno por atendente** — opcional. Quem não cadastrar herda o horário da empresa; o plantão
  noturno sobrevive ao horário comercial; feriado derruba todos, dizendo que foi o calendário.

### Quatro defeitos corrigidos (auditoria adversarial: 25 examinados, 4 confirmados)
Cada um foi verificado por três céticos independentes, cuja tarefa era **derrubar** o achado.

1. Um **carimbo** de "já avisei hoje que estamos fechados" podia ser reaberto por uma rotina de
   manutenção e virar **relógio de inatividade vencido**, devolvendo a conversa à fila (ou
   resolvendo-a) sem prazo nenhum ter corrido. Bastava o processo reiniciar na hora errada.
2. **Transbordo disparando na hora:** re-armado com o minuto da inatividade, que é nulo quando a
   inatividade está desligada — e zero minuto significa "agora".
3. **Conversa em espera sumia da varredura para sempre** — a leitura só trazia conversas "abertas",
   mas é para "aguardando" que o relógio devolve.
4. **Mensagem dupla ao cliente**, por dois caminhos, sendo que um não conferia a janela de 24 h.

### Depende de
- Ainda **não existe caixa de WhatsApp** criada: tudo acima é correto por construção e por teste,
  não por observação em atendimento real.
- A tela das respostas rápidas (sugerir ao digitar `/`) e a tela de cadastro de turno são frontend.
- O turno ainda não é consultado pela distribuição — o serviço responde, falta quem pergunte.

---

## v1.01.00 — Publicação de fluxo (29/08/2026)

O editor de fluxo volta a **publicar**. Antes, publicar/validar/reverter respondiam erro 503 porque
o serviço não existia; agora existe, testado contra o banco.

- **Publicar** congela o rascunho numa **versão imutável**, valida a estrutura do grafo (nó inicial,
  arestas ligadas, sem nó órfão) e reaponta o fluxo — tudo numa transação.
- **Arrastar um bloco na tela NÃO cria versão nova** e nunca deixa órfã quem está no meio da
  conversa — a assinatura de estrutura ignora as coordenadas do editor. Mudar uma ligação ou um tipo
  de nó, sim.
- **Reverter copia para a frente** (cria uma versão nova com o conteúdo antigo), mantendo a linha do
  tempo contínua para a medição de eficácia.

### Depende de
- O **resolvedor de entrada** (fluxo do primeiro "oi") ainda não amarra o motor — próximo item (A1).
- Sem caixa de WhatsApp real, o retrofit de conversa viva foi provado com execução semeada, não sob
  tráfego.

---

## v1.00.00 — A fundação (29/08/2026)

Primeira versão marcada. Reúne tudo que já está no ar e sustentado por teste, para servir de
**marco zero** — daqui para frente cada novidade entra como uma versão nova.

### Infraestrutura — a plataforma sobrevive à morte de uma máquina

- **Kubernetes de 3 nós, 1 por hipervisor.** Perder um hipervisor inteiro tira um nó só, e a
  plataforma continua de pé.
- **Banco com troca automática de líder (Patroni + etcd, 3 votos).** O primário morre e o outro
  assume sozinho, sem ninguém promover à mão. Provado matando a máquina primária.
- **Fila com troca automática de mestre (Redis Sentinel, quórum 2 de 3).**
- **Armazenamento de anexos próprio (MinIO, 6 discos em 3 hipervisores).** Um hipervisor pode cair
  e a plataforma continua **gravando** anexo.
- **Backup do banco em bucket imutável** (Object Lock), que descobre o líder sozinho a cada rodada —
  imune a troca de primário.

### Atendimento — as automações que o dono sentia falta

- **Relógio de inatividade** com escolha do lado que conta o silêncio (contato, atendente ou
  qualquer um) — a conversa parada volta sozinha para a fila.
- **Expediente com intervalo de almoço** (várias janelas por dia) e **feriado** (data avulsa e
  recorrente) — coisas que o chat anterior não fazia.
- **Fora de expediente o relógio congela** — ninguém recebe "ainda está aí?" de madrugada.
- **Transferência entre atendentes e times** que tira o atendente anterior junto.
- **Trabalhador rodando a cada 60s**, à prova de reinício (não duplica ação).

### Plataforma SaaS — multiempresa

- **Planos, assinaturas e cobrança.**
- **Protocolo de atendimento** por empresa (`RGT-0000000001`), à prova de corrida.
- **Auditoria por usuário** com isolamento entre empresas à prova de vazamento.
- **E-mail funcionando** (convites, canal de suporte).

### Motor de fluxo de conversa — nativo

- **20 tabelas, motor próprio** (sem depender de Typebot/n8n). Recusa editar versão publicada,
  recusa duas execuções na mesma conversa, retoma sozinho se o processo morre no meio.
- **Editor de fluxo** (tela de arrastar blocos).

### O que esta versão AINDA não entrega (declarado)

- **Zero caixas de WhatsApp criadas** — nada foi exercitado com conversa real.
- **Canais Facebook e Instagram** ainda não ligados (são nativos, falta ligar).
- **Publicação de fluxo** e o **elo de entrada do primeiro "oi"** faltam.
- **Ação "notificar" do relógio** só enfileira; falta quem consuma a fila.

> Referência completa da fundação: `deploy/LEIA-ME.md` (infraestrutura) e
> `docs/30-INFRAESTRUTURA-RAGNABOT.md`. Levantamento do que falta implementar do chat atual:
> `docs/31-FUNCIONALIDADES-A-IMPLEMENTAR.md` e o plano em `docs/32-PLANO-DE-EXECUCAO.md`.

<!-- MODELO PARA A PRÓXIMA VERSÃO (copie e preencha no topo, acima deste comentário):

## vX.YY.ZZ — <título curto> (DD/MM/AAAA)

<uma linha do que mudou e por quê>

- **<funcionalidade>** — <o que passou a existir, na visão de quem usa>.
- ...

### Depende de
- <o que falta / o que espera do dono>
-->
