import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const config = {
  host: process.env.HOST || 'localhost',
  port: parseInt(process.env.PORT || '3010', 10),
  jwtSecret: process.env.JWT_SECRET || 'claude-code-web-dev-secret-change-in-production',
  dbPath: resolve(__dirname, '..', 'data', 'auth.db'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5174',
};
