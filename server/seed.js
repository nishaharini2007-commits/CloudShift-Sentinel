import 'dotenv/config';
import { ensureLegacySchema, pool, query } from './db.js';

const targetCount = Math.max(0, Number.parseInt(process.env.SEED_COUNT || '100000', 10));
const batchSize = Math.min(5_000, Math.max(100, Number.parseInt(process.env.SEED_BATCH_SIZE || '2000', 10)));

if (!pool) {
  console.error('Seed requires DATABASE_URL. Demo mode is virtual and does not need seeding.');
  process.exit(1);
}

try {
  await ensureLegacySchema();
  const existing = await query('SELECT COUNT(*)::int AS count FROM users');
  const currentCount = existing.rows[0].count;
  let inserted = 0;
  for (let start = currentCount + 1; inserted < targetCount; start += batchSize) {
    const size = Math.min(batchSize, targetCount - inserted);
    const result = await query(`INSERT INTO users (name, email) SELECT
      'User ' || lpad(n::text, 6, '0'),
      'user' || lpad(n::text, 6, '0') || '@example.test'
      FROM generate_series($1::bigint, $2::bigint) AS n
      ON CONFLICT (email) DO NOTHING`, [start, start + size - 1]);
    inserted += size;
    console.log(`Seeded batch: ${Math.min(inserted, targetCount).toLocaleString()} of ${targetCount.toLocaleString()} attempted rows (${result.rowCount.toLocaleString()} inserted).`);
  }
  const final = await query('SELECT COUNT(*)::int AS count FROM users');
  console.log(`Seed complete. Database now contains ${final.rows[0].count.toLocaleString()} users.`);
} catch (error) {
  console.error('Seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
