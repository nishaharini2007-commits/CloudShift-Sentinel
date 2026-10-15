import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

function poolOptions() {
  if (!databaseUrl) return null;
  const options = { connectionString: databaseUrl, max: Number(process.env.PG_POOL_MAX || 10), connectionTimeoutMillis: 5_000 };
  if (process.env.PG_SSL === 'true' || isProduction) {
    options.ssl = {
      rejectUnauthorized: true,
      ...(process.env.PG_CA_CERT_PATH ? { ca: fs.readFileSync(process.env.PG_CA_CERT_PATH, 'utf8') } : {})
    };
  }
  return options;
}

export const pool = poolOptions() ? new Pool(poolOptions()) : null;
export const databaseConfigured = Boolean(databaseUrl);

export async function query(text, values = []) {
  if (!pool) throw new Error('PostgreSQL is not configured. Set DATABASE_URL to enable database mode.');
  return pool.query(text, values);
}

export async function ensureLegacySchema() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query('CREATE INDEX IF NOT EXISTS users_created_at_id_idx ON users (created_at, id)');
}

export async function hasDisplayNameColumn() {
  const result = await query(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'display_name'
  ) AS present`);
  return result.rows[0].present;
}

export async function hasLegacyNameColumn() {
  const result = await query(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'name'
  ) AS present`);
  return result.rows[0].present;
}

export async function getDatabaseStatus() {
  const result = await query('SELECT COUNT(*)::bigint AS count FROM users');
  const expanded = await hasDisplayNameColumn();
  const legacy = await hasLegacyNameColumn();
  return { connected: true, userCount: Number(result.rows[0].count), phase: !expanded ? 'legacy' : legacy ? 'expanded' : 'contracted' };
}
