// ════════════════════════════════════════════════════════════════════════════════════════════════
// BACKUP DO BANCO DO RAGNABOT → bucket IMUTÁVEL (iDrive e2, Object Lock GOVERNANCE).
//
// POR QUÊ EXISTE: até 28/08/2026 o PostgreSQL do Ragnabot (`chatwoot`, em 172.17.20.132) **não
// tinha backup nenhum** — nenhuma das 8 rotinas do NOC o cobria. A réplica em `.133` protege
// contra a queda de UMA máquina, mas **não** contra apagar uma tabela por engano, corrupção
// lógica ou ransomware: tudo isso replica para o standby em segundos.
//
// POR QUE O BUCKET IMUTÁVEL É VIRTUDE AQUI (e defeito nos anexos): backup é cópia fria. Object
// Lock impede que um invasor — ou um erro nosso — apague o que resta depois de um desastre. Já o
// ANEXO de conversa é o ORIGINAL e precisa poder ser apagado (LGPD). São buckets diferentes de
// propósito; ver `ragnabot-anexos` (sem lock).
//
// COMO CHEGA NO BANCO: o NOC não tem rota direta para o PostgreSQL do Ragnabot; entra por SSH no
// nó (user `ragnatela`, sudo) e roda `pg_dump` lá dentro, transmitindo por stdout. Nada é gravado
// no disco do banco — o dump viaja em memória até aqui e sobe direto.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Client } from 'ssh2';
import zlib from 'node:zlib';
import prisma from '../base/db.js';
import { decrypt } from '../base/crypto.js';
import logger from '../base/logger.js';

const ENDPOINT = process.env.RAGNABOT_S3_ENDPOINT;
const REGION   = process.env.RAGNABOT_S3_REGION || 'us-southeast-1';
const BUCKET   = process.env.RAGNABOT_S3_BUCKET;
const AK       = process.env.RAGNABOT_S3_ACCESS_KEY;
const SK       = process.env.RAGNABOT_S3_SECRET_KEY;
const RAIZ     = 'backup-postgres';

// Os DOIS nós do cluster Patroni `ragnabot-pg`. Qual deles é o líder MUDA — o Patroni promove o
// outro sozinho quando o primário cai, e foi exatamente o que aconteceu em 29/08/2026 (pg133 virou
// líder na linha do tempo 6). Enquanto este arquivo apontava para um nó fixo, o backup diário
// passou a recusar-se a rodar: "RGTPSTGSQL001 não é o primário agora". A guarda estava certa — o
// que estava errado era supor que o líder é sempre o mesmo. Por isso a lista, e a descoberta viva
// logo abaixo. NÃO volte a fixar um nó: alta disponibilidade automática e primário fixo no código
// são premissas que se contradizem.
const DEVICES_DO_CLUSTER = ['RGTPSTGSQL001', 'RGTPSTGSQL002'];

function cliente() {
  if (!ENDPOINT || !BUCKET || !AK || !SK) throw new Error('RAGNABOT_S3_* não configurado no .env');
  return new S3Client({
    endpoint: ENDPOINT, region: REGION, forcePathStyle: true,
    credentials: { accessKeyId: AK, secretAccessKey: SK },
  });
}

async function credenciaisDoNo(nomeDoDevice) {
  const d = await prisma.device.findFirst({ where: { name: { contains: nomeDoDevice, mode: 'insensitive' } } });
  if (!d) throw new Error(`device ${nomeDoDevice} não encontrado no NOC`);
  // ⚠️ o campo do endereço é `hostname`, NÃO `host` — usar `host` devolve undefined e o ssh2
  // conecta silenciosamente em localhost (erro já cometido em 28/08).
  return { host: d.hostname, port: d.port || 22, username: d.username || 'ragnatela', password: decrypt(d.password) };
}

/**
 * Roda um comando no nó por SSH com sudo, devolvendo stdout como Buffer.
 * A senha do sudo vai pela stdin (`sudo -S`) — nunca na linha de comando, que fica visível
 * no `ps` de qualquer usuário da máquina.
 */
function rodarNoNo(cred, comando, { binario = false } = {}) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    const limite = setTimeout(() => { c.end(); reject(new Error('tempo esgotado no SSH')); }, 15 * 60 * 1000);
    c.on('ready', () => {
      const b64 = Buffer.from(comando).toString('base64');
      c.exec(`sudo -S -p '' bash -c "$(echo ${b64} | base64 -d)"`, (e, s) => {
        if (e) { clearTimeout(limite); c.end(); return reject(e); }
        const partes = []; let erro = '';
        s.on('data', (d) => partes.push(d));
        s.stderr.on('data', (d) => { erro += d.toString(); });
        s.on('close', (code) => {
          clearTimeout(limite); c.end();
          const saida = Buffer.concat(partes);
          if (code !== 0) return reject(new Error(`saída ${code}: ${erro.slice(0, 300)}`));
          resolve(binario ? saida : saida.toString());
        });
        s.stdin.write(cred.password + '\n'); s.stdin.end();
      });
    }).on('error', (e) => { clearTimeout(limite); reject(e); })
      .connect({ ...cred, readyTimeout: 20000 });
  });
}

/**
 * Executa o backup completo do banco `chatwoot` e envia ao bucket imutável.
 * @returns {Promise<{chave:string, bytes:number, duracaoMs:number}>}
 */
/**
 * Descobre qual nó do cluster é o LÍDER agora, perguntando ao próprio Postgres de cada um.
 *
 * A pergunta é `pg_is_in_recovery()`, e não `patronictl list`, de propósito: quem manda no dump é o
 * estado do BANCO, não o que a ferramenta de orquestração acha dele. Se os dois discordassem — o
 * Patroni dizendo uma coisa e o Postgres outra —, seguir o Postgres é o que evita gerar backup a
 * partir de um nó em recuperação.
 *
 * Um nó inalcançável não é erro fatal aqui: durante um failover é NORMAL o antigo líder estar fora.
 * Só é erro se, ao fim da varredura, NENHUM nó se declarar líder.
 *
 * @returns {Promise<{nome:string, cred:object}>}
 */
async function acharOLider() {
  const recusas = [];
  for (const nome of DEVICES_DO_CLUSTER) {
    let cred;
    try {
      cred = await credenciaisDoNo(nome);
      const resposta = (await rodarNoNo(cred,
        `sudo -u postgres psql -tAc "SELECT NOT pg_is_in_recovery()"`)).trim();
      if (resposta === 't') {
        logger.info(`[ragnabot-backup] líder do cluster agora: ${nome} (${cred.host})`);
        return { nome, cred };
      }
      recusas.push(`${nome}: réplica`);
    } catch (e) {
      // inalcançável ou sem resposta — anota e tenta o próximo
      recusas.push(`${nome}: ${e.message.slice(0, 80)}`);
    }
  }
  throw new Error(`nenhum nó do cluster se declarou líder — backup recusado. ${recusas.join(' | ')}`);
}

export async function backupDoRagnabot() {
  const t0 = Date.now();

  // Descobre o líder a cada rodada. O dump sai SEMPRE do líder: a réplica está em recuperação e
  // `pg_dump` nela pode ser cancelado por conflito de replicação no meio — falha intermitente que
  // só aparece sob carga, o pior tipo de defeito num backup.
  const { nome: noDoLider, cred } = await acharOLider();

  logger.info(`[ragnabot-backup] gerando pg_dump do banco chatwoot em ${noDoLider}...`);
  // `-Fc` = formato custom: comprimido, restaura seletivo com pg_restore, e é o que o
  // RESTORE-INSTRUCTIONS espera. Sai por stdout; nada toca o disco do servidor de banco.
  const dump = await rodarNoNo(cred,
    `sudo -u postgres pg_dump -Fc --no-owner --no-privileges chatwoot`, { binario: true });

  if (!dump || dump.length < 1024) throw new Error(`dump veio vazio ou pequeno demais (${dump?.length || 0} bytes)`);

  const corpo = zlib.gzipSync(dump);
  const agora = new Date().toISOString().replace(/[:.]/g, '-');
  const chave = `${RAIZ}/chatwoot_${agora}.dump.gz`;

  logger.info(`[ragnabot-backup] enviando ${(corpo.length / 1048576).toFixed(1)} MB para ${BUCKET}/${chave}`);
  await cliente().send(new PutObjectCommand({
    Bucket: BUCKET, Key: chave, Body: corpo, ContentType: 'application/gzip',
    Metadata: { origem: 'noc-ragnatela', banco: 'chatwoot', gerado: agora },
  }));

  const duracaoMs = Date.now() - t0;
  logger.info(`[ragnabot-backup] ✓ ${chave} (${corpo.length} bytes) em ${Math.round(duracaoMs / 1000)}s`);
  return { chave, bytes: corpo.length, duracaoMs, no: noDoLider };
}

/** Lista os backups existentes — é o que prova que a rotina está de fato rodando. */
export async function listarBackups({ limite = 20 } = {}) {
  const r = await cliente().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${RAIZ}/`, MaxKeys: limite }));
  return (r.Contents || [])
    .map((o) => ({ chave: o.Key, bytes: o.Size, quando: o.LastModified }))
    .sort((a, b) => new Date(b.quando) - new Date(a.quando));
}

/**
 * Worker: um backup por dia. Intervalo generoso de propósito — o banco é pequeno (20 MB) e a
 * réplica já cobre a queda de máquina; o que este backup protege é erro lógico e ransomware,
 * cujo horizonte é de dias, não de minutos.
 */
let temporizador = null;
export function iniciarWorkerBackupRagnabot({ horas = 24 } = {}) {
  if (temporizador) return;
  if (!BUCKET) { logger.warn('[ragnabot-backup] RAGNABOT_S3_* ausente — worker NÃO iniciado'); return; }
  const ms = horas * 3600 * 1000;
  // primeiro em 5 min (dá tempo do servidor subir), depois a cada `horas`
  setTimeout(() => { backupDoRagnabot().catch((e) => logger.error(`[ragnabot-backup] ${e.message}`)); }, 5 * 60 * 1000);
  temporizador = setInterval(() => {
    backupDoRagnabot().catch((e) => logger.error(`[ragnabot-backup] ${e.message}`));
  }, ms);
  logger.info(`[ragnabot-backup] worker ativo (a cada ${horas}h) → ${BUCKET}/${RAIZ}`);
}
