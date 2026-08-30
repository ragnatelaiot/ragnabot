// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DA BASE — só o que a camada de base precisa (chave de cifragem, ambiente, log).
//
// Por que existe: no NOC, `utils/crypto.js` e `utils/logger.js` liam de `config/index.js`, que
// carrega dezenas de chaves do NOC (Zabbix, Proxmox, Guacamole...). Nada disso é do Ragnabot.
// Aqui fica APENAS o mínimo, para a superfície de segredo do motor ser pequena e auditável.
//
// ⚠️ ENCRYPTION_KEY tem de ser A MESMA do NOC enquanto houver dado cifrado migrado — os segredos
// já gravados (tokens de plataforma, senhas de origem) só abrem com a chave que os cifrou.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import 'dotenv/config';

const config = {
  ambiente: process.env.NODE_ENV || 'development',
  porta: parseInt(process.env.PORT || '3000', 10),

  // Chave de cifragem AES-256-GCM: 64 caracteres hex (32 bytes). Nunca fica no git.
  chaveDeCifragem: process.env.ENCRYPTION_KEY || '',

  // Nível do log: em produção `info`, fora dela `debug`. Igual ao NOC, para o formato bater.
  nivelDeLog: process.env.LOG_LEVEL || '',
};

// Falha CEDO e ALTO em produção: motor sem chave de cifragem sobe e só quebra quando alguém
// tentar ler um segredo — no meio de um atendimento. Melhor não subir.
if (config.ambiente === 'production' && config.chaveDeCifragem.length < 64) {
  // eslint-disable-next-line no-console
  console.error('[FATAL] ENCRYPTION_KEY ausente ou com menos de 64 caracteres hex. ' +
    'O motor não sobe sem ela: os segredos já gravados não abririam.');
  process.exit(1);
}

export default config;
