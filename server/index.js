import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { addDemoUser, addActivity, demoUser, recordRequest, runtime, DEMO_METRICS, DEMO_USER_COUNT } from './state.js';
import { databaseConfigured, ensureLegacySchema, getDatabaseStatus, hasDisplayNameColumn, hasLegacyNameColumn, pool, query } from './db.js';
import { contract, demoValidation, getMigrationStatus, snapshotMetrics, startMigration, validate } from './migration.js';

const app = express();
const port = Number(process.env.PORT || 4000);
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => recordRequest(Number(process.hrtime.bigint() - started) / 1e6, res.statusCode >= 500));
  next();
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeUser(row) {
  return { id: Number(row.id), name: row.name ?? row.display_name, email: row.email, displayName: row.display_name ?? null, createdAt: row.created_at };
}

async function listUsers({ page, pageSize, search }) {
  if (!databaseConfigured) {
    const total = DEMO_USER_COUNT + runtime.demoAddedUsers.length;
    const term = search.trim().toLowerCase();
    const matches = [];
    if (!term) {
      const start = (page - 1) * pageSize + 1;
      const end = Math.min(start + pageSize - 1, total);
      for (let id = start; id <= end; id += 1) matches.push(demoUser(id));
      return { users: matches, total };
    }
    let matchCount = 0;
    for (let id = 1; id <= Math.min(total, DEMO_USER_COUNT); id += 1) {
      const user = demoUser(id);
      if (user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)) {
        if (matchCount >= (page - 1) * pageSize && matches.length < pageSize) matches.push(user);
        matchCount += 1;
      }
    }
    for (const user of runtime.demoAddedUsers) {
      if (user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)) {
        if (matchCount >= (page - 1) * pageSize && matches.length < pageSize) matches.push(user);
        matchCount += 1;
      }
    }
    return { users: matches, total: matchCount };
  }
  const expanded = await hasDisplayNameColumn();
  const legacy = await hasLegacyNameColumn();
  const displayColumn = expanded ? 'display_name' : 'NULL::text AS display_name';
  const nameColumn = legacy ? 'name' : 'display_name';
  const filter = search ? `WHERE ${nameColumn} ILIKE $1 OR email ILIKE $1` : '';
  const values = search ? [`%${search}%`] : [];
  const count = await query(`SELECT COUNT(*)::int AS total FROM users ${filter}`, values);
  const pageOffset = values.length + 1;
  const rows = await query(`SELECT id, ${nameColumn} AS name, email, ${displayColumn}, created_at FROM users ${filter} ORDER BY id LIMIT $${pageOffset} OFFSET $${pageOffset + 1}`, [...values, pageSize, (page - 1) * pageSize]);
  return { users: rows.rows.map(normalizeUser), total: count.rows[0].total };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  let database;
  if (!databaseConfigured) database = { connected: true, mode: 'demo', userCount: DEMO_USER_COUNT + runtime.demoAddedUsers.length, phase: runtime.migration.phase };
  else {
    const status = await getDatabaseStatus();
    database = { ...status, mode: 'postgresql' };
  }
  res.json({ status: 'ok', mode: databaseConfigured ? 'postgresql' : 'demo', simulated: !databaseConfigured, database, uptimeSeconds: Math.floor(process.uptime()), checkedAt: new Date().toISOString() });
}));

app.get('/api/metrics', asyncRoute(async (_req, res) => {
  const migration = await getMigrationStatus();
  const history = databaseConfigured ? ['before', 'during', 'after'].flatMap((phase) => runtime.performanceSnapshots[phase] ? [{ phase, ...runtime.performanceSnapshots[phase] }] : []) : [];
  const observations = databaseConfigured ? { requests: runtime.counters.requests, errors: runtime.counters.errors, errorRate: runtime.counters.requests ? runtime.counters.errors / runtime.counters.requests : 0, latency: snapshotMetrics(), comparison: runtime.performanceSnapshots } : DEMO_METRICS;
  res.json({ simulated: !databaseConfigured, source: databaseConfigured ? 'observed' : 'simulated', ...observations, history, migration, activity: runtime.activity, databaseMode: databaseConfigured ? 'PostgreSQL (configured endpoint)' : 'In-memory sample data' });
}));

app.get('/api/users', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 10));
  const search = String(req.query.search || '').trim().slice(0, 120);
  const result = await listUsers({ page, pageSize, search });
  res.json({ ...result, page, pageSize, pages: Math.max(1, Math.ceil(result.total / pageSize)), simulated: !databaseConfigured });
}));

app.post('/api/users', asyncRoute(async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Name must be between 2 and 120 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  let user;
  if (!databaseConfigured) user = addDemoUser({ name, email });
  else if (await hasDisplayNameColumn() && await hasLegacyNameColumn()) {
    const result = await query('INSERT INTO users (name, display_name, email) VALUES ($1, $1, $2) RETURNING id, name, display_name, email, created_at', [name, email]);
    user = normalizeUser(result.rows[0]);
  } else if (await hasDisplayNameColumn()) {
    const result = await query('INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id, display_name, email, created_at', [name, email]);
    user = normalizeUser(result.rows[0]);
  } else {
    const result = await query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email, created_at', [name, email]);
    user = normalizeUser(result.rows[0]);
  }
  addActivity('info', `Created user ${user.email}.`);
  res.status(201).json({ user, simulated: !databaseConfigured });
}));

app.get('/api/migration/status', asyncRoute(async (_req, res) => res.json({ ...await getMigrationStatus(), simulated: !databaseConfigured })));
app.post('/api/migration/run', asyncRoute(async (_req, res) => {
  const started = await startMigration();
  res.status(started ? 202 : 409).json({ started, migration: await getMigrationStatus(), simulated: !databaseConfigured });
}));
app.post('/api/migration/validate', asyncRoute(async (_req, res) => {
  const result = databaseConfigured ? await validate() : demoValidation();
  runtime.migration = { ...runtime.migration, ...result, status: result.valid ? 'validated' : 'failed' };
  addActivity(result.valid ? 'success' : 'error', result.valid ? `Consistency validation passed for ${result.total.toLocaleString()} records.` : `Consistency validation failed: ${result.missing} missing, ${result.mismatches} mismatched.`);
  res.json({ ...result, simulated: !databaseConfigured });
}));
app.post('/api/migration/contract', asyncRoute(async (req, res) => {
  const result = await contract(req.body || {});
  res.json({ migration: result, simulated: !databaseConfigured });
}));
app.get('/api/report', asyncRoute(async (_req, res) => {
  const status = await getMigrationStatus();
  res.json({ generatedAt: new Date().toISOString(), simulated: !databaseConfigured, database: databaseConfigured ? 'PostgreSQL (configured endpoint)' : 'In-memory demo dataset', migration: status, validation: databaseConfigured ? await validate() : demoValidation(), performance: databaseConfigured ? runtime.performanceSnapshots : DEMO_METRICS.comparison, requests: databaseConfigured ? runtime.counters : { source: 'simulated sample', requests: DEMO_METRICS.requests, errors: DEMO_METRICS.errors }, activity: runtime.activity.slice(0, 20), caveat: 'This report contains measured local API observations only in PostgreSQL mode. Demo values are simulated and are not AWS or production measurements.' });
}));

app.use((error, _req, res, _next) => {
  const duplicate = error.code === '23505';
  const status = duplicate ? 409 : Number(error.statusCode || 500);
  if (status >= 500) console.error('API error:', error.message);
  res.status(status).json({ error: duplicate ? 'That email address is already in use.' : status >= 500 ? 'The request could not be completed. Check server configuration and logs.' : error.message });
});

async function start() {
  if (databaseConfigured) {
    await ensureLegacySchema();
    console.log('CloudShift API connected to configured PostgreSQL database.');
  } else {
    console.log('CloudShift API started in DEMO MODE. All user data and metrics are simulated.');
  }
  app.listen(port, () => console.log(`CloudShift API listening on port ${port}.`));
}

start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});

process.on('SIGTERM', async () => { if (pool) await pool.end(); process.exit(0); });
