import pino from 'pino';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import roll from 'pino-roll';

const isDev = process.env.NODE_ENV !== 'production';
const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = resolve(__dirname, '..', 'logs');

mkdirSync(logsDir, { recursive: true });

const logFile = resolve(logsDir, 'server.log');
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

// Rolling file transport — rotates daily, keeps 7 days of logs
const fileStream = await roll({
  file: logFile,
  frequency: 'daily',
  limit: { count: 7 },
});

const streams: pino.StreamEntry[] = [
  { level: level as pino.Level, stream: fileStream },
];

if (isDev) {
  const pinoPretty = (await import('pino-pretty')).default;
  streams.push({
    level: level as pino.Level,
    stream: pinoPretty({ colorize: true, translateTime: 'HH:MM:ss' }),
  });
} else {
  streams.push({ level: level as pino.Level, stream: process.stdout });
}

export const logger = pino({ level }, pino.multistream(streams));

/** Create a child logger with a module tag */
export function createLogger(module: string) {
  return logger.child({ module });
}
