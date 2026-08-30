// ════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRADOR — mesmo FORMATO do logger do NOC, de propósito.
//
// O NOC continua lendo este log (é ele quem monitora e alerta). Se o formato mudar, o que o NOC
// já sabe ler quebra. Então: winston, JSON com timestamp `YYYY-MM-DD HH:mm:ss`, `errors({stack})`,
// console colorido no mesmo `printf`, e os dois arquivos com o mesmo tamanho/rotação.
//
// O que muda, e só isto: `defaultMeta.service` passa a ser `ragnabot-motor` (era `noc-agent-35`) —
// é como se distingue, no mesmo formato, quem escreveu a linha.
//
// Em contêiner, o que vale é o console (RAILS/Node → stdout → kubectl logs). Os arquivos em
// `logs/` continuam existindo para quem rodar local; no pod eles vivem no volume efêmero e somem
// com o pod, o que é aceitável porque a fonte de verdade é o stdout.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import winston from 'winston';
import config from './config.js';

const logger = winston.createLogger({
  level: config.nivelDeLog || (config.ambiente === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ragnabot-motor' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

export default logger;
