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
