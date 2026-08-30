// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLIENTE PRISMA DO RAGNABOT — aponta para a base `ragnabot`, não para a do NOC.
//
// Mesmo padrão de `src/database/client.js` do NOC (instância única exportada como default), para
// os 21 pontos que importavam `prisma` continuarem funcionando trocando só o caminho do import.
//
// ⚠️ O LÍDER DO BANCO MUDA. `DATABASE_URL` tem de apontar para o serviço `banco-lider` (o HAProxy
// que segue o primário do Patroni), NUNCA para o IP de um nó. Supor qual nó é o primário foi o que
// quebrou o backup em 29/08.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Encerramento limpo: o Kubernetes manda SIGTERM e espera 30s. Fechar o pool aqui evita conexões
// penduradas no Postgres a cada troca de pod (2 réplicas × cada rollout = lixo acumulado).
async function encerrar(sinal) {
  try { await prisma.$disconnect(); } catch { /* nada a fazer no caminho de saída */ }
  process.exit(sinal === 'SIGINT' ? 130 : 143);
}
process.once('SIGTERM', () => encerrar('SIGTERM'));
process.once('SIGINT', () => encerrar('SIGINT'));

export default prisma;
