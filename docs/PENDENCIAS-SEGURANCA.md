# 🔒 PENDÊNCIAS DE SEGURANÇA — RAGNABOT
> Aberto em 28/08/2026, após a auditoria (`22-AUDITORIA-SEGURANCA.md`) e a primeira leva de correções.
> **Contexto que permite agir:** o dono liberou tudo dentro do projeto Ragnabot (inclusive reiniciar
> as VMs do Kubernetes), pois **nenhum cliente usa a aplicação ainda**. A restrição é só uma:
> **não mexer no que afete o resto do ambiente Proxmox e as outras VMs.**

---

## ✅ JÁ RESOLVIDO (para não se perder)
| item | prova |
|---|---|
| Usuário do banco sem poder total | superuser `t`→`f`, replicado no standby, app escreve normal |
| Cerca de rede (isolamento restritivo) | app alcança PG/Redis; SSH de outros nós, rede interna e DNS externo **bloqueados** |
| Pod endurecido (parcial) | sem escalada de privilégio, capacidades removidas, seccomp, sem token de serviço |
| Cookie seguro, HSTS, Permissions-Policy | cabeçalhos medidos na resposta |
| Freio de força bruta | 429 a partir da 6ª tentativa |
| Isolamento entre empresas | agente da empresa A recebe **401** nos dados da B |

---

## ⬜ PENDENTE — 1. Rodar a aplicação sem ser administrador (não-root)
**Gravidade:** alta · **Bloqueio:** nenhum (só exige teste)
**Situação:** a imagem oficial roda como `root` e não traz usuário dedicado. Forçar `runAsNonRoot`
sem preparar os diretórios de escrita derruba a aplicação.
**O que fazer:**
1. Descobrir todos os caminhos que a aplicação grava (`/app/tmp`, `/app/log`, e o que mais aparecer).
2. Montar volume temporário (`emptyDir`) nesses caminhos.
3. Aplicar `runAsNonRoot: true`, `runAsUser: 1000` e, se passar, `readOnlyRootFilesystem: true`.
4. Validar: pods de pé, envio de mensagem, upload de anexo, e-mail.
**Reversão:** remover o `securityContext` do pod e refazer o rollout.
**Por que não fiz agora:** preferi não arriscar o que está estável sem o mapeamento dos diretórios.

## ⬜ PENDENTE — 2. Fechar a porta interna do cluster (NodePort) no firewall
**Gravidade:** média · **Bloqueio:** ⚠️ **cautela pedida pelo dono**
**Situação:** as portas 30080/30443 aceitam conexão de quem já está na rede de gerência, servindo a
aplicação **sem HTTPS** e **por fora do freio de login**.
**O que fazer:** nas CHRs e na RB5009, uma regra de descarte **escopada só à faixa do cluster**
(`172.17.20.0/24` e `172.17.20.160/27`), logo abaixo da regra que já libera o proxy (`172.20.11.2`).
**Por que não fiz:** as CHRs roteiam **o resto do ambiente**, e o dono pediu para não mexer no que
afeta os demais. O comando chegou a ser barrado pelo classificador de segurança, o que reforça a
cautela. **Requer autorização explícita do dono para mexer em regra de CHR.**
**Mitigação atual:** a cerca de rede já contém o vetor principal; este é um bypass que exige o
atacante já estar dentro da rede de gerência.

## ⬜ PENDENTE — 3. Cifrar os segredos do Kubernetes em repouso
**Gravidade:** alta · **Bloqueio:** nenhum (reinicia o servidor de API, um nó por vez)
**Situação:** senhas do banco, do Redis e as chaves de criptografia ficam **legíveis** no
armazenamento interno do cluster (etcd) e em qualquer cópia dele.
**O que fazer:** criar a configuração de cifragem nos 3 nós, apontar o servidor de API para ela,
reiniciar **um nó por vez** (esperando cada um voltar), e reescrever os segredos para cifrar os já
existentes. Manter o modo "sem cifra" como segunda opção de leitura, para poder voltar atrás.
**Reversão:** remover a configuração e reiniciar; os segredos seguem legíveis pelo modo antigo.

## ⬜ PENDENTE — 4. Desativar comandos perigosos do Redis
**Gravidade:** média · **Bloqueio:** nenhum
**O que fazer:** renomear `FLUSHALL`, `FLUSHDB`, `DEBUG` e `KEYS` no `redis.conf` das duas VMs.
Avaliar `CONFIG` com teste (algumas bibliotecas consultam). Cópia do arquivo antes.
**Mitigação atual:** Redis já exige senha e só escuta na rede do projeto.

## ⬜ PENDENTE — 5. Política de conteúdo do navegador (CSP)
**Gravidade:** média · **Bloqueio:** nenhum (mas exige observação)
**O que fazer:** publicar em modo "só relatar" primeiro, coletar o que seria bloqueado por alguns
dias, ajustar e só então passar a bloquear. Aplicado no vhost do Ragnabot.
**Por que com cuidado:** CSP mal calibrada quebra a interface em silêncio.

## ⬜ PENDENTE — 6. Itens menores
| item | o que é |
|---|---|
| Grampo de OCSP | acelera e melhora a verificação do certificado |
| `/super_admin` redireciona para HTTP | forçar HTTPS nesse caminho |
| Armazenamento de anexos num nó só | perder o nó = perder as mídias (risco de continuidade, não de invasão) |

---

## 📌 ORDEM SUGERIDA
1. **Cifrar os segredos** (item 3) — alto valor, risco controlado, reinício por nó.
2. **Não-root** (item 1) — alto valor; exige mapear diretórios primeiro.
3. **Redis** (item 4) e **OCSP/HTTPS do super_admin** (item 6) — rápidos.
4. **CSP** (item 5) — em modo relatar, com observação.
5. **NodePort** (item 2) — **só com o seu aval**, por envolver as CHRs.

> Todos os artefatos (comandos, YAML e SQL) estão prontos em `22-AUDITORIA-SEGURANCA.md` §C.
