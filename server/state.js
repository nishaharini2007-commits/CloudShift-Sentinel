export const DEMO_USER_COUNT = 100_000;
export const DEMO_METRICS = {
  requests: 18_420,
  errors: 12,
  errorRate: 12 / 18_420,
  latency: { p50Ms: 42, p95Ms: 88, source: 'simulated' },
  comparison: {
    before: { requests: 17_800, errors: 12, errorRate: 12 / 17_800, p50Ms: 40, p95Ms: 82, source: 'simulated' },
    during: { requests: 18_120, errors: 12, errorRate: 12 / 18_120, p50Ms: 44, p95Ms: 96, source: 'simulated' },
    after: { requests: 18_420, errors: 12, errorRate: 12 / 18_420, p50Ms: 41, p95Ms: 84, source: 'simulated' }
  }
};

const startedAt = Date.now();
const demoAddedUsers = [];
const requestDurations = [];
const activity = [];
const performanceSnapshots = { before: null, during: null, after: null };
const counters = { requests: 0, errors: 0 };
let migration = {
  phase: 'legacy',
  status: 'idle',
  processed: 0,
  total: DEMO_USER_COUNT,
  mismatches: 0,
  missing: 0,
  startedAt: null,
  finishedAt: null,
  message: 'Ready to expand the schema.'
};

export const runtime = {
  startedAt,
  demoAddedUsers,
  requestDurations,
  activity,
  performanceSnapshots,
  counters,
  get migration() { return migration; },
  set migration(value) { migration = value; }
};

export function addActivity(level, message) {
  activity.unshift({ id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), level, message });
  activity.splice(100);
}

export function recordRequest(durationMs, failed) {
  counters.requests += 1;
  if (failed) counters.errors += 1;
  requestDurations.push(durationMs);
  if (requestDurations.length > 2_000) requestDurations.shift();
}

export function demoUser(id) {
  const index = Number(id);
  if (!Number.isInteger(index) || index < 1 || index > DEMO_USER_COUNT + demoAddedUsers.length) return null;
  if (index > DEMO_USER_COUNT) return demoAddedUsers[index - DEMO_USER_COUNT - 1] ?? null;
  const n = index - 1;
  return {
    id: index,
    name: `User ${String(index).padStart(6, '0')}`,
    email: `user${String(index).padStart(6, '0')}@example.test`,
    displayName: migration.phase === 'legacy' ? null : `User ${String(index).padStart(6, '0')}`,
    createdAt: new Date(Date.UTC(2022 + Math.floor(n / 100_000), n % 12, (n % 27) + 1)).toISOString()
  };
}

export function addDemoUser({ name, email }) {
  const id = DEMO_USER_COUNT + demoAddedUsers.length + 1;
  const user = { id, name, email, displayName: migration.phase === 'legacy' ? null : name, createdAt: new Date().toISOString() };
  demoAddedUsers.push(user);
  return user;
}
