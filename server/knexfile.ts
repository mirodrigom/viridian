import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL;

const config = databaseUrl
  ? {
      client: 'pg' as const,
      connection: databaseUrl,
      pool: { min: 2, max: 10 },
      migrations: {
        directory: resolve(__dirname, 'src/db/migrations'),
        extension: 'ts',
      },
    }
  : {
      client: 'better-sqlite3' as const,
      connection: { filename: resolve(__dirname, 'src/data/auth.db') },
      useNullAsDefault: true,
      migrations: {
        directory: resolve(__dirname, 'src/db/migrations'),
        extension: 'ts',
      },
    };

export default config;
