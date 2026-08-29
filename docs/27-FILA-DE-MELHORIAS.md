# 📋 27 — FILA DE MELHORIAS DO RAGNABOT
### Pedidos do dono que não bloqueiam nenhuma fase — construir quando a frente principal permitir

> Formato: cada item traz **o que foi pedido** (palavras do dono quando houver), **por que importa**
> e **o que exige**. Item entregue sai daqui e vai para o log de ações.

---

## M1 — Recortar e ampliar a foto de perfil antes de salvar
**Pedido do dono (28/08/2026):** *"ao atualizar a foto do perfil tenha como editar ou dar zoom na
parte a ser exibida da foto escolhida"*

**Por que importa:** hoje o envio de foto de perfil aceita a imagem como ela vem. Foto de celular é
retangular e o avatar é redondo — sem recorte, o sistema corta pelo centro e decapita a pessoa ou
deixa o rosto de canto. Quem sobe uma foto e se vê torto conclui que o produto é tosco, e essa é a
primeira tela que todo usuário novo vê.

**O que exige:**
- Recortador na tela de perfil: área circular de seleção, **ampliar/reduzir** e arrastar para
  escolher a parte visível.
- Recorte aplicado **antes do envio** (o servidor recebe a imagem já quadrada) — evita guardar o
  original inteiro e evita recorte diferente em cada lugar que mostra o avatar.
- Vale para os **dois** lugares: foto do usuário e **foto do perfil comercial do WhatsApp**
  (esta última tem exigência própria da Meta: quadrada, e há limite de tamanho).
- Funcionar no **celular** (arrastar com o dedo, ampliar com dois dedos) — a maioria das fotos de
  perfil é escolhida do próprio telefone.

**Onde encosta:** tela de perfil do Ragnabot. Como é área do Chatwoot, avaliar se o recortador entra
como componente nosso na camada de tema (sem bifurcar o código dele) ou se vira tela própria.

**Situação:** ⏳ na fila, não bloqueia nenhuma fase.

---
## M2 — Ligar os canais Instagram Direct e Facebook Messenger
**Pergunta do dono (28/08/2026):** *"lá eu já consigo integrar o direct do Instagram, e Facebook também?"*

**Resposta medida na instalação (não de memória):** sim. `Channel.constants` devolve **12 canais**:
`Api, Email, FacebookPage, Instagram, Line, Sms, Telegram, Tiktok, TwilioSms, TwitterProfile,
WebWidget, Whatsapp`. Instagram e FacebookPage são **nativos**, sem plugin nem custo extra.

**O que exige:** a mesma burocracia da Meta do WhatsApp — aplicativo + permissões + análise.
**Aproveita o que já existe:** o app `WHATS-0997` serve para os três (é só acrescentar os
produtos), e a **verificação da empresa — a parte demorada — já está aprovada**.

**Ordem sugerida:** concluir o WhatsApp primeiro (está a um passo), porque o roteiro aprendido lá
encurta os outros dois.

**Situação:** ⏳ na fila, depois do WhatsApp.

---

## M3 — Transferência de conversa entre atendentes
**Pergunta do dono:** *"falta dentro do Ragnabot você conseguir transferir as conversas entre os agentes"*

**Resposta medida:** **já existe, nativo.** `Conversation` responde a `assignee=` (pessoa) e a
`team=` (time), e o modelo `Team` existe. Nada a construir.

**Recomendação de uso:** preferir **transferir para TIME** em vez de para pessoa. Conversa
atribuída a alguém que saiu para almoçar fica parada; atribuída ao time, quem estiver livre assume.
É a diferença entre fila e caixa de entrada pessoal.

**Situação:** ✅ disponível — falta só criar os times no cadastro de cada empresa.

---
