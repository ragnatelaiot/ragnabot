# D15 — Turno por atendente

> Entrega da fatia 3.1 do documento 29 (`RagnabotAtendTurno`, §4.4).
> Código: `/ia/netagent/src/services/ragnabot-turno.service.js`
> Teste: `/ia/netagent/tests/ragnabot-turno.test.mjs` (24 verificações, todas verdes em 29/08/2026)
> Estado: **serviço pronto e provado. NÃO está ligado a nada ainda** — a amarração no trabalhador,
> na distribuição e na tela é decisão do chefe.

---

## 1. O que é turno por atendente

Turno é a **grade de horário de uma pessoa**: em que dias da semana, e de que hora a que hora, aquele
atendente está de serviço. É o `startWork`/`endWork` que existe no chat atual e que o Chatwoot **não
tem** — no Chatwoot só existe o status que a própria pessoa marca (online, ausente, ocupado), e o
distribuidor devolve todos os membros da caixa sem olhar presença nenhuma.

A tabela guarda **uma linha por faixa de horário**, não uma linha por pessoa:

| campo | o que é |
|---|---|
| `tenantId` | a empresa (isolamento — nenhuma consulta roda sem ele) |
| `cwUserId` | o atendente na plataforma |
| `diaSemana` | 0 = domingo … 6 = sábado |
| `abreMin` | minuto da meia-noite em que entra (08:00 = 480) |
| `fechaMin` | minuto em que sai (18:00 = 1080) |
| `ativo` | desligar a faixa sem apagá-la |

Como a linha é a **faixa** e não o **dia**, o mesmo atendente pode ter almoço (duas linhas na
segunda), sábado só de manhã, ou plantão que vira a madrugada — coisas que uma coluna
"início e fim do dia" não sabe representar.

---

## 2. Por que isto foi construído agora (e não antes)

O documento 29 deixou a tabela no schema **sem código**, de propósito, com a condição escrita: *"só
depois de medir"*. A hipótese que segurava a obra era **"todo mundo está com 00:00–00:00, o requisito
nunca foi usado, a tabela nasce morta"**.

**A medição de 29/08/2026 falsificou a hipótese.** Dos 7 usuários lidos no chat atual:

- **2** usam **08:00–18:00** de verdade;
- **1** usa **00:00–23:59**;
- **4** estão **vazios**.

É essa distribuição — medida, não suposta — que define a regra central da entrega.

---

## 3. A regra que governa tudo: sem turno = herda a empresa

> **Atendente que não cadastrou turno NÃO fica indisponível. Ele segue o expediente da empresa.**

A razão é o número acima: **a maioria (4 de 7) está vazia**. Se a ausência de turno fosse lida como
"fora de serviço", ligar esta função apagaria quatro dos sete atendentes da fila no primeiro dia — a
operação ficaria sem ninguém para receber conversa, e o sintoma chegaria ao dono como *"o Ragnabot
parou de distribuir"*, a três camadas de distância da causa.

É a **mesma escolha, pela mesma razão**, que o expediente da empresa já faz: expediente sem nenhuma
janela cadastrada é lido como **aberto**, nunca como fechado. Fechar exige que alguém tenha **dito**
quando fecha.

Turno, portanto, é **opcional**: quem não configurou nada continua funcionando exatamente como hoje.

---

## 4. Como o gestor usa

1. **Não fazer nada.** É o caminho da maioria: sem turno cadastrado, o atendente atende sempre que a
   empresa estiver aberta. Nenhuma configuração, nenhum efeito colateral.
2. **Cadastrar a grade de quem tem horário próprio.** Ex.: a pessoa do comercial das 08:00 às 18:00,
   segunda a sexta → cinco linhas.
3. **Almoço da pessoa** (diferente do intervalo da empresa): duas linhas no mesmo dia — 08:00–12:00
   e 13:00–18:00.
4. **Plantão noturno:** uma linha 22:00–06:00 por dia. A faixa que fecha antes de abrir é entendida
   como "vira a madrugada" — não vira duração negativa.
5. **Vinte e quatro horas:** cadastrar **00:00–24:00** (`abreMin` 0, `fechaMin` 1440).
   ⚠️ **00:00–23:59 não é 24 horas** — deixa 60 segundos de buraco por dia. Funciona, mas o atendente
   fica tecnicamente fora de turno entre 23:59:00 e 23:59:59. Está no teste, declarado, e é
   exatamente o cadastro que **1 dos 7** usuários medidos tem hoje.
6. **Tirar alguém de escala sem apagar a grade:** `ativo = false`. O serviço trata turno inativo como
   turno inexistente — ou seja, a pessoa volta a herdar o expediente da empresa.

### O que o sistema responde

Para cada atendente o serviço devolve **disponível ou não, e por quê**:

| motivo | leitura |
|---|---|
| `em_turno` | tem grade própria e está dentro dela |
| `fora_do_turno` | tem grade própria e está fora dela |
| `herda_empresa` | não tem grade; a empresa está aberta |
| `herda_empresa_fechada` | não tem grade; a empresa está fechada (fora de hora, intervalo ou feriado) |
| `empresa_fechada` | o calendário da empresa (feriado) derrubou o turno — ou a leitura de interseção está ligada |

Booleano sozinho não bastaria: "indisponível porque é feriado", "porque saiu às 18h" e "porque a
empresa está no almoço" são três conversas diferentes com o gestor.

Também sai **quando a pessoa volta** (`proximaJanelaDoAtendente`), já com a hora de parede pronta
para a mensagem *"volto às 08:00"*, e o aviso de se é **hoje** ou **amanhã**.

---

## 5. A decisão de desenho que o chefe precisa revisar

Quem **tem** turno cadastrado: **o turno substitui a grade semanal da empresa, mas as exceções do
calendário (feriado, véspera com meio expediente) continuam valendo.**

**Por que substituir e não intersectar.** Intersectar ("só está disponível se estiver no turno *e* a
empresa estiver aberta") mataria em silêncio o único cadastro que justifica turno por pessoa existir:
o plantão das 22:00 às 06:00 numa empresa que atende das 08:00 às 18:00 ficaria disponível **nunca**,
sem erro nenhum no caminho. Substituir é também a leitura coerente com a herança que este produto já
pratica na política de atendimento: vale o valor do **nível mais específico que existir**
(empresa → caixa → time → agora, pessoa).

**Por que o feriado é exceção à exceção.** Feriado não é rotina semanal, é fato do calendário da
empresa: no Natal ninguém está de turno, tenha cadastrado o que tiver. Por isso as exceções são
repassadas para a avaliação do turno, e o motivo devolvido diz `empresa_fechada` — e não
`fora_do_turno`, que mandaria o gestor caçar erro na grade da pessoa.

**Quem discordar não precisa editar código:** a opção `exigirExpedienteDaEmpresa: true` liga a
leitura de interseção. As duas leituras estão provadas no teste (verificações 5a e 5b).

---

## 6. O que ficou de fora, e por quê

- **Não está ligado em lugar nenhum.** O serviço responde à pergunta; ninguém a faz ainda. Amarrar na
  distribuição, no trabalhador de relógio e na transferência é decisão e trabalho do chefe.
- **Não há tela de cadastro.** Hoje o turno só entra por escrita direta na tabela. A tela é outra
  tarefa; o serviço só **lê**.
- **Não conhece o status que a pessoa marca no Chatwoot** (online/ausente/ocupado). Turno é a grade do
  gestor; status é a vontade da pessoa no momento. São dois sinais diferentes e ficam separados de
  propósito — quem quiser as duas coisas combina no chamador, em vez de enterrar uma política dentro
  da outra.
- **Não gera a mensagem "nenhum atendente disponível".** O serviço entrega a contagem
  (`contarDisponiveis`) e a hora de retorno; montar o texto de `msgAtendenteIndisponivel` é da camada
  de mensagem.
- **Não há turno por caixa nem por setor.** A grade é da pessoa. Se a operação precisar de escala por
  fila, é modelo novo — e, de novo, só depois de medir.
- **Não foi exercitado com dados reais.** A tabela `RagnabotAtendTurno` está **vazia em produção**
  (contagem lida: 0 linhas) e **ainda não existe nenhuma caixa de WhatsApp** no ambiente. Tudo o que
  está provado foi provado com as grades medidas na origem reproduzidas no teste — não com tráfego
  real de atendimento.

---

## 7. Limites declarados (para ninguém descobrir em produção)

1. **00:00–23:59 tem um buraco de 60 s por dia.** É aritmética, não defeito: quem quer 24 h cadastra
   `fechaMin = 1440`.
2. **Faixa inválida é recusada e relatada, nunca descartada calada.** `abreMin: 1440` — o "24:00" de
   quem não sabe que a meia-noite é a hora **zero do dia seguinte**, e nunca a hora 24 de hoje — vira
   um aviso no log e um item em `problemas`. Se sobrar nenhuma faixa válida, o atendente **herda a
   empresa** (falha aberta), com o problema devolvido para a tela poder avisar.
3. **Fuso padrão `America/Fortaleza`**, com a ordem: fuso explícito > fuso da política da empresa >
   padrão da casa.
4. **Abertura inclusiva, fechamento exclusivo:** com turno 08:00–18:00, às 18:00 em ponto a pessoa já
   está fora.
5. **A aritmética de horário é uma só.** O serviço **importa** `avaliarExpediente()`,
   `proximaAberturaApos()`, `normalizarJanelas()` e `partesNoFuso()` de
   `ragnabot-atendimento.service.js` — não há segunda cópia da regra. Duas implementações do mesmo
   cálculo de horário divergem em silêncio, e é assim que se erra o horário de um cliente sem ninguém
   perceber.

---

## 8. Prova

`node tests/ragnabot-turno.test.mjs` → **24 verificações, 24 verdes, 0 reprovadas, saída 0.**
Nenhuma linha escrita no banco (a última verificação confere a contagem real da tabela).

O teste foi submetido a **três mutações controladas** no serviço, para provar que ele morde:

| mutação | reprovações |
|---|---|
| "sem turno = indisponível" (a falha fechada que este documento proíbe) | 4 |
| esquecer de repassar as exceções da empresa ao turno (feriado deixaria de derrubar) | 2 |
| fuso padrão trocado para UTC | 1 |

Serviço restaurado e reconferido por soma de verificação após cada mutação.
