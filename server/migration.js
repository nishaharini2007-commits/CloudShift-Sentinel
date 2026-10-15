import { databaseConfigured, hasDisplayNameColumn, hasLegacyNameColumn, query } from './db.js';
import { addActivity, DEMO_USER_COUNT, demoUser, runtime } from './state.js';

const BATCH_SIZE = 1_000;
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

export async function getMigrationStatus() {
  if (!databaseConfigured) return { ...runtime.migration, total: DEMO_USER_COUNT + runtime.demoAddedUsers.length, phase: runtime.migration.phase };
  const expanded = await hasDisplayNameColumn();
  if (!expanded) return { ...runtime.migration, phase: 'legacy', status: 'idle', processed: 0, total: 0, message: 'Legacy schema detected. Expand is ready.' };
  const legacy = await hasLegacyNameColumn();
  const counts = await query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE display_name IS NULL)::int AS missing,
    COUNT(*) FILTER (WHERE ${legacy ? 'display_name IS DISTINCT FROM name' : 'FALSE'})::int AS mismatches
    FROM users`);
  const row = counts.rows[0];
  const completed = row.missing === 0 && row.mismatches === 0;
  return {
    ...runtime.migration,
    phase: legacy ? 'expanded' : 'contracted',
    status: !legacy ? 'contracted' : completed ? 'validated' : runtime.migration.status,
    processed: completed ? row.total : runtime.migration.processed,
    total: row.total,
    missing: row.missing,
    mismatches: row.mismatches,
    message: !legacy ? 'Contracted schema is active; only display_name remains.' : completed ? 'Backfill is complete and the columns match.' : runtime.migration.message
  };
}

async function expand() {
  if (databaseConfigured) {
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT');
  } else {
    runtime.migration = { ...runtime.migration, phase: 'expanded', status: 'expanded', message: 'Expanded schema is ready; old and new fields are dual-written.' };
  }
  addActivity('success', 'Expand: added nullable display_name without removing name.');
}

async function backfill() {
  const status = await getMigrationStatus();
  const total = status.total;
  runtime.migration = { ...runtime.migration, phase: 'backfill', status: 'running', total, processed: 0, startedAt: new Date().toISOString(), message: 'Backfilling in batches while API traffic continues.' };
  addActivity('info', `Backfill started in batches of ${BATCH_SIZE.toLocaleString()}.`);
  if (runtime.performanceSnapshots.before === null) runtime.performanceSnapshots.before = snapshotMetrics();
  if (!databaseConfigured) {
    for (let processed = 0; processed < total; processed += BATCH_SIZE) {
      await pause();
      runtime.migration = { ...runtime.migration, processed: Math.min(processed + BATCH_SIZE, total) };
      runtime.performanceSnapshots.during = snapshotMetrics();
    }
  } else {
    let processed = 0;
    while (true) {
      const result = await query(`WITH batch AS (
        SELECT id FROM users WHERE display_name IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) UPDATE users AS target SET display_name = target.name FROM batch WHERE target.id = batch.id RETURNING target.id`, [BATCH_SIZE]);
      if (result.rowCount === 0) break;
      processed += result.rowCount;
      runtime.migration = { ...runtime.migration, processed, total };
      runtime.performanceSnapshots.during = snapshotMetrics();
      await pause();
    }
  }
  runtime.migration = { ...runtime.migration, phase: 'validating', status: 'validating', message: 'Checking every row for missing or mismatched values.' };
  const validation = await validate();
  runtime.migration = { ...runtime.migration, ...validation, phase: 'expanded', status: validation.valid ? 'validated' : 'failed', finishedAt: new Date().toISOString(), message: validation.valid ? 'Backfill and consistency checks passed.' : 'Validation found data that needs attention.' };
  runtime.performanceSnapshots.after = snapshotMetrics();
  addActivity(validation.valid ? 'success' : 'error', validation.valid ? `Validation passed for ${total.toLocaleString()} records.` : `Validation found ${validation.missing} missing and ${validation.mismatches} mismatched records.`);
}

export async function validate() {
  if (!databaseConfigured) {
    let missing = 0;
    let mismatches = 0;
    const total = DEMO_USER_COUNT + runtime.demoAddedUsers.length;
    const valid = runtime.migration.phase !== 'legacy';
    return { total, processed: valid ? total : 0, missing, mismatches, valid };
  }
  if (!(await hasDisplayNameColumn())) return { total: 0, processed: 0, missing: 0, mismatches: 0, valid: false };
  const legacy = await hasLegacyNameColumn();
  const result = await query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE display_name IS NULL)::int AS missing,
    COUNT(*) FILTER (WHERE ${legacy ? 'display_name IS DISTINCT FROM name' : 'FALSE'})::int AS mismatches
    FROM users`);
  const { total, missing, mismatches } = result.rows[0];
  return { total, processed: total - missing, missing, mismatches, valid: missing === 0 && mismatches === 0 };
}

export async function startMigration() {
  if (runtime.migration.status === 'running' || runtime.migration.status === 'validating') return false;
  await expand();
  runtime.migration = { ...runtime.migration, phase: 'expanded', status: 'expanded', message: 'Expand complete. Starting batched backfill.' };
  void backfill().catch((error) => {
    runtime.migration = { ...runtime.migration, status: 'failed', message: error.message };
    addActivity('error', `Migration failed: ${error.message}`);
  });
  return true;
}

export async function contract({ confirmContract, legacyClientsRetired }) {
  if (confirmContract !== 'DROP_LEGACY_NAME') throw new Error('Contract requires confirmContract="DROP_LEGACY_NAME".');
  if (legacyClientsRetired !== true || process.env.LEGACY_CLIENTS_RETIRED !== 'true') throw new Error('Contract blocked: explicitly retire legacy clients in the request and set LEGACY_CLIENTS_RETIRED=true on the server.');
  const status = await getMigrationStatus();
  if (status.status !== 'validated' || status.missing || status.mismatches) throw new Error('Contract blocked until the expanded schema is fully backfilled and validated.');
  if (databaseConfigured) await query('ALTER TABLE users DROP COLUMN name');
  runtime.migration = { ...runtime.migration, phase: 'contracted', status: 'contracted', message: 'Legacy name column removed after explicit retirement and validation.' };
  addActivity('warning', 'Contract: removed legacy name column after safeguards passed.');
  return runtime.migration;
}

export function snapshotMetrics() {
  const durations = runtime.requestDurations.slice().sort((a, b) => a - b);
  const percentile = (p) => durations.length ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)] : 0;
  return {
    at: new Date().toISOString(),
    requests: runtime.counters.requests,
    errors: runtime.counters.errors,
    errorRate: runtime.counters.requests ? runtime.counters.errors / runtime.counters.requests : 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    source: databaseConfigured ? 'observed' : 'simulated'
  };
}

export function demoValidation() {
  const missing = runtime.migration.phase === 'legacy' ? DEMO_USER_COUNT : 0;
  return { total: DEMO_USER_COUNT + runtime.demoAddedUsers.length, missing, mismatches: 0, valid: missing === 0 };
}
