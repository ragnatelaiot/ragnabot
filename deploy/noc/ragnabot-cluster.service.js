// =============================================================================
// Saúde ao vivo do cluster RAGNABOT (plataforma de atendimento chat002).
// Espelha a ESTRUTURA do cluster SISAC (blueprint db-cluster-noc-blueprint.md),
// mas o conteúdo é o desta pilha: Kubernetes de 3 nós + PostgreSQL 18 com
// streaming replication + Redis. NÃO é SQL Server/AG — por isso serviço próprio.
//
// Tudo LEITURA. Nada aqui muta o cluster.
// NOC 2026-08-28.
// =============================================================================
import prisma from '../database/client.js';
import { execPooled } from './ssh-pool.service.js';
import { decrypt } from '../utils/crypto.js';

export const RAGNABOT_MARCA = '[CLUSTER RAGNABOT]';

// Mapa fixo do cluster: qual VM roda o quê e em qual hipervisor.
// (o vmid e o host são estáveis; o IP vem do cadastro do device)
const TOPOLOGIA = [
  { vmid: 10601, host: 'RGTSRVHST001', papel: 'k8s',   rotulo: 'Nó Kubernetes 1', ip: '172.17.20.4' },
  { vmid: 10602, host: 'RGTSRVHST002', papel: 'k8s',   rotulo: 'Nó Kubernetes 2', ip: '172.17.20.5' },
  { vmid: 10605, host: 'XSESRVHST001', papel: 'k8s',   rotulo: 'Nó Kubernetes 3 (XSE)', ip: '172.17.20.162' },
  { vmid: 10603, host: 'RGTSRVHST001', papel: 'banco', rotulo: 'PostgreSQL + Redis', ip: '172.17.20.132' },
  { vmid: 10604, host: 'RGTSRVHST002', papel: 'banco', rotulo: 'PostgreSQL + Redis', ip: '172.17.20.133' },
];

async function credenciaisDoHost(nomeHost) {
  const d = await prisma.device.findFirst({ where: { name: { contains: nomeHost } } });
  if (!d) throw new Error(`hipervisor ${nomeHost} não cadastrado`);
  return { hostname: d.hostname, port: d.port || 22, username: d.username || 'root',
           password: d.password ? decrypt(d.password) : null, sshKey: null };
}

// executa dentro da VM, pelo agente do Proxmox (não exige SSH direto na VM)
async function noGuest(nomeHost, vmid, comando, segundos = 25) {
  const b64 = Buffer.from(comando).toString('base64');
  const creds = await credenciaisDoHost(nomeHost);
  const { output } = await execPooled(creds,
    `qm guest exec ${vmid} --timeout ${segundos} -- /bin/bash -c "echo ${b64} | base64 -d | bash" 2>&1`,
    { timeout: (segundos + 20) * 1000 });
  try { const j = JSON.parse(output.trim()); return ((j['out-data'] || '') + (j['err-data'] || '')).trim(); }
  catch { return output.trim(); }
}

/** Estado dos nós do Kubernetes + a aplicação. */
async function lerKubernetes() {
  const script = `
export KUBECONFIG=/etc/kubernetes/admin.conf
echo "NOS:$(kubectl get nodes --no-headers 2>/dev/null | awk '{print $1"="$2}' | paste -sd, -)"
echo "VERSAO:$(kubectl version -o json 2>/dev/null | grep -o '"gitVersion":"[^"]*"' | head -1 | cut -d'"' -f4)"
echo "PODS:$(kubectl -n ragnabot get pods --no-headers 2>/dev/null | awk '{print $1"="$3}' | paste -sd, -)"
echo "IMAGEM:$(kubectl -n ragnabot get deploy ragnabot-web -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)"
echo "ETCD:$(kubectl -n kube-system exec etcd-rgtk8s001 -- etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key member list 2>/dev/null | wc -l)"
`;
  const saida = await noGuest('RGTSRVHST001', 10601, script, 30);
  const campo = (k) => (saida.split('\n').find(l => l.startsWith(k + ':')) || '').slice(k.length + 1).trim();
  const nos = campo('NOS').split(',').filter(Boolean).map(p => {
    const [nome, estado] = p.split('=');
    return { nome, pronto: estado === 'Ready', estado };
  });
  const pods = campo('PODS').split(',').filter(Boolean).map(p => {
    const [nome, estado] = p.split('=');
    return { nome, estado, ok: estado === 'Running' };
  });
  return {
    versao: campo('VERSAO') || null,
    nos,
    nosProntos: nos.filter(n => n.pronto).length,
    nosTotal: nos.length,
    pods,
    podsOk: pods.filter(p => p.ok).length,
    // imagem da aplicação: se terminar em :latest, NÃO está fixada por digest
    imagem: campo('IMAGEM') || null,
    imagemFixada: /@sha256:/.test(campo('IMAGEM') || ''),
    membrosEtcd: parseInt(campo('ETCD') || '0', 10) || 0,
  };
}

/** Estado do PostgreSQL/Redis em UMA das VMs de banco. */
async function lerBanco(alvo) {
  const script = `
echo "RECOVERY:$(sudo -u postgres psql -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 1 ELSE 0 END" 2>/dev/null)"
echo "STANDBYS:$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_stat_replication" 2>/dev/null)"
echo "LAGPRIM:$(sudo -u postgres psql -tAc "SELECT COALESCE(EXTRACT(EPOCH FROM max(replay_lag)),0)::numeric(10,3) FROM pg_stat_replication" 2>/dev/null)"
# ⚠️ Atraso do standby por LSN, NUNCA por "tempo desde a última transação":
# num banco ocioso, now()-pg_last_xact_replay_timestamp() cresce sem parar e
# acusaria horas de atraso com a replicação perfeita (falso positivo medido em 28/08).
# Se recebido == aplicado, o standby está EM DIA, ponto.
echo "EMDIA:$(sudo -u postgres psql -tAc "SELECT CASE WHEN NOT pg_is_in_recovery() THEN 1 WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 1 ELSE 0 END" 2>/dev/null)"
echo "BYTESATRAS:$(sudo -u postgres psql -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN COALESCE(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()),0)::bigint ELSE 0 END" 2>/dev/null)"
echo "LAGSTBY:$(sudo -u postgres psql -tAc "SELECT CASE WHEN pg_is_in_recovery() AND pg_last_wal_receive_lsn() <> pg_last_wal_replay_lsn() THEN COALESCE(EXTRACT(EPOCH FROM now()-pg_last_xact_replay_timestamp()),0)::numeric(10,1) ELSE 0 END" 2>/dev/null)"
echo "SLOTSINATIVOS:$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_replication_slots WHERE NOT active" 2>/dev/null)"
echo "DBMB:$(sudo -u postgres psql -tAc "SELECT (pg_database_size('chatwoot')/1024/1024)::int" 2>/dev/null)"
echo "PGVER:$(sudo -u postgres psql -tAc "SHOW server_version" 2>/dev/null)"
echo "DISCO:$(df -h / | awk 'NR==2{print $2"|"$4"|"$5}')"
echo "DISCOPG:$(df -h /var/lib/postgresql 2>/dev/null | awk 'NR==2{print $2"|"$4"|"$5}')"
echo "REDIS:$(redis-cli -a "$(grep -m1 '^requirepass' /etc/redis/redis.conf | awk '{print $2}')" --no-auth-warning info replication 2>/dev/null | grep -m1 '^role' | cut -d: -f2 | tr -d '\\r')"
echo "UPTIME:$(uptime -p 2>/dev/null)"
`;
  const saida = await noGuest(alvo.host, alvo.vmid, script, 30);
  const campo = (k) => (saida.split('\n').find(l => l.startsWith(k + ':')) || '').slice(k.length + 1).trim();
  const disco = (campo('DISCOPG') || campo('DISCO') || '').split('|');
  const emRecuperacao = campo('RECOVERY') === '1';
  return {
    vmid: alvo.vmid, ip: alvo.ip, hipervisor: alvo.host,
    // QUEM É O PRIMÁRIO: quem NÃO está em recuperação
    papel: emRecuperacao ? 'standby' : 'primário',
    ehPrimario: !emRecuperacao,
    versaoPg: campo('PGVER') || null,
    standbysConectados: parseInt(campo('STANDBYS') || '0', 10),
    atrasoSegundos: parseFloat(emRecuperacao ? campo('LAGSTBY') : campo('LAGPRIM')) || 0,
    // em dia = o que a réplica recebeu já foi aplicado (medida honesta em banco ocioso)
    emDia: campo('EMDIA') === '1',
    bytesAtrasados: parseInt(campo('BYTESATRAS') || '0', 10),
    slotsInativos: parseInt(campo('SLOTSINATIVOS') || '0', 10),
    tamanhoBancoMb: parseInt(campo('DBMB') || '0', 10),
    disco: { total: disco[0] || null, livre: disco[1] || null, usadoPct: disco[2] || null },
    redis: campo('REDIS') || null,
    tempoLigado: campo('UPTIME') || null,
  };
}

/** Saúde completa do cluster RAGNABOT. */
export async function getRagnabotClusterHealth() {
  const emAlerta = [];
  const [k8s, ...bancos] = await Promise.all([
    lerKubernetes().catch(e => ({ erro: e.message })),
    ...TOPOLOGIA.filter(t => t.papel === 'banco').map(t => lerBanco(t).catch(e => ({ vmid: t.vmid, ip: t.ip, erro: e.message }))),
  ]);

  // ---- avaliação (o que vira alerta no cartão) ----
  if (k8s?.erro) emAlerta.push('Não consegui ler o Kubernetes: ' + k8s.erro);
  else {
    if (k8s.nosProntos < k8s.nosTotal) emAlerta.push(`Kubernetes com ${k8s.nosTotal - k8s.nosProntos} nó(s) fora`);
    if (k8s.membrosEtcd && k8s.membrosEtcd < 3) emAlerta.push(`etcd com ${k8s.membrosEtcd} membro(s) — quórum exige 3`);
    if (!k8s.imagemFixada) emAlerta.push('Imagem da aplicação NÃO está fixada por digest (upgrade silencioso é possível)');
    const podsRuins = (k8s.pods || []).filter(p => !p.ok && !/Completed/i.test(p.estado));
    if (podsRuins.length) emAlerta.push(`${podsRuins.length} pod(s) fora do ar: ${podsRuins.map(p => p.nome).join(', ')}`);
  }
  const primarios = bancos.filter(b => b.ehPrimario);
  if (primarios.length === 0) emAlerta.push('NENHUM banco primário — a plataforma não escreve');
  if (primarios.length > 1) emAlerta.push('MAIS DE UM primário (cérebro dividido)');
  for (const b of bancos) {
    if (b.erro) { emAlerta.push(`Banco ${b.ip} inacessível: ${b.erro}`); continue; }
    if (b.ehPrimario && b.standbysConectados === 0) emAlerta.push('Réplica desconectada do primário');
    // só é atraso de verdade se a réplica ainda não aplicou o que recebeu
    if (!b.ehPrimario && b.emDia === false && b.atrasoSegundos > 60) {
      emAlerta.push(`Réplica atrasada em ${b.atrasoSegundos}s (${b.bytesAtrasados} bytes) em ${b.ip}`);
    }
    if (b.slotsInativos > 0) emAlerta.push(`${b.slotsInativos} slot(s) de replicação inativo(s) em ${b.ip} — seguram WAL e enchem o disco`);
    const pct = parseInt((b.disco?.usadoPct || '0').replace('%', ''), 10);
    if (pct >= 85) emAlerta.push(`Disco em ${pct}% em ${b.ip}`);
  }

  return {
    cluster: 'RAGNABOT',
    grupo: 'RAGNATELA',
    aplicacao: { nome: 'Ragnabot', url: 'https://chat002.ragnatela.com.br', base: 'Chatwoot' },
    kubernetes: k8s,
    bancos,
    primario: primarios[0]?.ip || null,
    saudavel: emAlerta.length === 0,
    alertas: emAlerta,
    lidoEm: new Date().toISOString(),
  };
}

/** Servidores do cluster conforme cadastrados no NOC. */
export async function getRagnabotServidores() {
  const devices = await prisma.device.findMany({
    where: { group: 'RAGNATELA', notes: { contains: RAGNABOT_MARCA } },
    select: { id: true, name: true, hostname: true, type: true, proxmoxVmid: true, notes: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  return devices.map(d => {
    const t = TOPOLOGIA.find(x => x.vmid === d.proxmoxVmid);
    return { ...d, papel: t?.papel || null, rotulo: t?.rotulo || null, hipervisor: t?.host || null };
  });
}
