# 📒 AUDITORIA POR USUÁRIO + PROTOCOLO DE ATENDIMENTO — desenho
> Ordem do dono, 28/08/2026. Duas funções que **o sistema atual não tem** e que ele destacou
> como importantes. Este documento é o desenho aprovado; a construção segue por ele.

---

## PARTE 1 — PROTOCOLO DE ATENDIMENTO

### A regra (palavras do dono)
> *"cada atendimento deverá ter um protocolo e ser possível a busca do atendimento pelo protocolo
> único gerado automaticamente; o protocolo tem uma sequência de RGT-SEQUÊNCIA DE 10 NÚMEROS"*
> *"cada empresa terá 3 letras de prefixo, análogo ao RGT que a Ragnatela tem"*

### Formato
```
RGT-0000000001      ← Ragnatela (a conta proprietária)
ABC-0000000001      ← outra empresa cliente (prefixo próprio)
```
- **Prefixo:** 3 letras, **uma por empresa**, definido no cadastro da empresa.
- **Sequência:** 10 dígitos com zeros à esquerda, **contada por empresa** (cada uma começa do 1).
- **Único dentro da empresa**; o par `prefixo + número` é único no sistema todo.

### Como é gerado (sem alterar o software de origem)
Quando uma conversa nasce, o Ragnabot avisa o nosso serviço; ele calcula o próximo número da
empresa e grava o protocolo **no próprio atendimento**, como atributo. Assim o número aparece na
conversa, entra na busca e vai nas mensagens/modelos.
- ⚠️ A contagem é feita com **trava por empresa** (transação no banco), para dois atendimentos
  simultâneos nunca receberem o mesmo número.
- Se o serviço estiver fora do ar quando a conversa nasce, ela entra numa fila e recebe o protocolo
  ao voltar — **nenhum atendimento fica sem número**.

### Busca
- Pelo campo de busca do atendimento (o protocolo é atributo indexado).
- Pela tela de auditoria (parte 2), que também lista por protocolo.

---

## PARTE 2 — AUDITORIA GERAL POR USUÁRIO

### A regra (palavras do dono)
> *"auditoria geral por usuário em tudo: quando mexer em configurações, logar, deslogar, IP de
> acesso, quando iniciou e encerrou um atendimento"*
> *"além de estar disponível para todas as contas de empresas cadastradas, os admins do Ragnabot
> das contas deles terão acesso full das auditorias **apenas das empresas deles**, inclusive gerar
> PDFs elegantes sobre os filtros escolhidos (data, usuário, ação, IP, etc.)"*

### O que é registrado
| Categoria | Eventos |
|---|---|
| **Acesso** | entrada, saída, tentativa recusada, **endereço IP**, navegador, 2FA usado |
| **Atendimento** | início, encerramento, transferência, reabertura, quem assumiu, **protocolo** |
| **Configuração** | qualquer alteração: conexões, filas, times, agentes, etiquetas, automações, respostas rápidas |
| **Pessoas** | criação, edição e remoção de usuário; mudança de papel |
| **Dados** | exportação, exclusão, acesso a contato |

Cada registro guarda: **quando · quem · o quê · onde (IP) · em qual empresa · detalhe da mudança**
(o valor antes e depois, quando aplicável).

### Quem vê o quê — isolamento (regra do dono)
| Perfil | Alcance |
|---|---|
| **Super user do NOC** (gestor da Ragnatela) | **tudo**, de todas as empresas |
| **Administrador da empresa cliente** | **tudo da empresa dele** — e **nada** das outras |
| Atendente | não vê auditoria |

> ⚠️ O isolamento é a parte mais sensível: **toda consulta filtra pela empresa do usuário logado**,
> nunca por parâmetro vindo da tela. O sistema antigo vazava justamente por confiar no que a tela
> mandava. Haverá teste automatizado provando que a empresa A não alcança registro da B.

### Filtros e relatório
Filtrar por **período · usuário · tipo de ação · endereço IP · protocolo**.
**Exportar em PDF elegante**, com a identidade do Ragnabot: capa com o período e os filtros
aplicados, tabela paginada com cabeçalho repetido, rodapé com numeração e data de emissão.
*(Reuso do motor de PDF que o NOC já tem para os relatórios do portal.)*

### Onde vive
Decisão: **do nosso lado**, não dentro do software de origem.
- **Por quê:** a auditoria nativa está na parte **paga** da licença; e, sendo nossa, sobrevive às
  atualizações do software, fica sob nosso controle e podemos vender como diferencial.
- **Como o usuário chega:** uma área do próprio domínio (`chat002.ragnatela.com.br/auditoria`),
  com a mesma identidade visual, aberta pelo menu — o administrador da empresa não percebe que é
  outra aplicação.
- **Espelho no NOC:** os super users veem tudo pelo NOC também, como o dono pediu.

### Como os eventos chegam
1. **Eventos de atendimento e configuração:** o Ragnabot avisa o nosso serviço a cada acontecimento.
2. **Entrada e saída:** capturadas no caminho da autenticação (o proxy já vê todo o tráfego de
   entrada, inclusive o IP real).
3. **O que o software já registra internamente** é lido e incorporado, para não perder histórico.

---

## O QUE ISSO EXIGE DO DONO
| # | Item | Situação |
|---|---|---|
| 1 | Definir o **prefixo de 3 letras** de cada empresa nova | no cadastro da empresa |
| 2 | Confirmar a **retenção** dos registros (sugestão: 12 meses on-line, depois arquivado) | ⏳ |
| 3 | Nada mais — o resto é construção nossa |

## ORDEM DE CONSTRUÇÃO
1. Modelo de dados (empresa: prefixo e contador · registro de auditoria).
2. Serviço que recebe os eventos e grava (com o isolamento por empresa embutido).
3. Geração do protocolo com trava por empresa + fila de recuperação.
4. Tela de auditoria com filtros (identidade do Ragnabot) + **PDF**.
5. Espelho no NOC para os super users.
6. **Teste automatizado** provando o isolamento entre empresas.
