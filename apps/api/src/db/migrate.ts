import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Database as DB } from 'better-sqlite3';
import { getDb, openDbAt } from './client.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

type Migration = { id: number; name: string; sql: string };

const loadMigrations = (): Migration[] => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  return files.map((f) => {
    const match = f.match(/^(\d+)_(.+)\.sql$/);
    if (!match || !match[1] || !match[2]) throw new Error(`Bad migration filename: ${f}`);
    return {
      id: Number(match[1]),
      name: match[2],
      sql: readFileSync(resolve(migrationsDir, f), 'utf8'),
    };
  });
};

const ensureTable = (db: DB): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
};

const appliedIds = (db: DB): Set<number> => {
  ensureTable(db);
  const rows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
  return new Set(rows.map((r) => r.id));
};

export const applyMigrations = (db: DB): Migration[] => {
  ensureTable(db);
  const applied = appliedIds(db);
  const migrations = loadMigrations();
  const newlyApplied: Migration[] = [];
  const insertRecord = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      insertRecord.run(m.id, m.name, Date.now());
    });
    tx();
    newlyApplied.push(m);
  }
  return newlyApplied;
};

export const migrationStatus = (
  db: DB,
): { id: number; name: string; applied: boolean }[] => {
  const applied = appliedIds(db);
  return loadMigrations().map((m) => ({ id: m.id, name: m.name, applied: applied.has(m.id) }));
};

const main = (): void => {
  const cmd = process.argv[2];
  const dbPathArg = process.argv.find((a) => a.startsWith('--db='));
  const db = dbPathArg ? openDbAt(dbPathArg.slice(5)) : getDb();

  if (cmd === 'up') {
    const applied = applyMigrations(db);
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      for (const m of applied) console.log(`Applied ${String(m.id).padStart(4, '0')}_${m.name}`);
    }
    return;
  }

  if (cmd === 'status') {
    for (const m of migrationStatus(db)) {
      console.log(
        `${m.applied ? '[x]' : '[ ]'} ${String(m.id).padStart(4, '0')}_${m.name}`,
      );
    }
    return;
  }

  console.error('Usage: migrate.ts <up|status> [--db=<path>]');
  process.exit(1);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
