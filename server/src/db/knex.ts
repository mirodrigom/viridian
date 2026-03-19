import Knex from 'knex';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { createLogger } from '../logger.js';

const log = createLogger('database');
const __dirname = dirname(fileURLToPath(import.meta.url));

function buildKnexConfig(): Knex.Knex.Config {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    log.info('Using PostgreSQL (DATABASE_URL detected)');
    return {
      client: 'pg',
      connection: databaseUrl,
      pool: { min: 2, max: 10 },
      migrations: {
        directory: resolve(__dirname, 'migrations'),
        extension: 'ts',
      },
    };
  }

  // Default: SQLite for local development
  const dbPath = resolve(__dirname, '..', 'data', 'auth.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  log.info({ path: dbPath }, 'Using SQLite (local mode)');

  return {
    client: 'better-sqlite3',
    connection: { filename: dbPath },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn: any, cb: (err: Error | null) => void) {
        conn.pragma('journal_mode = WAL');
        cb(null);
      },
    },
    migrations: {
      directory: resolve(__dirname, 'migrations'),
      extension: 'ts',
    },
  };
}

const knexConfig = buildKnexConfig();
const db = Knex.default(knexConfig);

/** Returns true if the current database is PostgreSQL */
export function isPostgres(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Run all pending migrations. Call once at startup. */
export async function runMigrations(): Promise<void> {
  const [batch, migrations] = await db.migrate.latest();
  if (migrations.length > 0) {
    log.info({ batch, migrations: migrations.length }, 'Migrations applied');
  } else {
    log.info('Database schema is up to date');
  }
}

export default db;
