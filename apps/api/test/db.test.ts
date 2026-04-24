import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDbAt } from '../src/db/client.js';
import { applyMigrations, migrationStatus } from '../src/db/migrate.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crateswipe-db-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('applies 0001_initial and creates expected tables', () => {
    const db = openDbAt(dbPath);
    const applied = applyMigrations(db);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]?.name).toBe('initial');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    for (const expected of [
      'users',
      'tokens',
      'tracks',
      'bpm_cache',
      'odesli_cache',
      'swipes',
      'crates',
      'affinities',
      'candidates',
      'downloads',
      'schema_migrations',
    ]) {
      expect(names).toContain(expected);
    }
    db.close();
  });

  it('is idempotent on re-run', () => {
    const db = openDbAt(dbPath);
    const first = applyMigrations(db);
    const second = applyMigrations(db);
    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
    db.close();
  });

  it('reports status correctly', () => {
    const db = openDbAt(dbPath);
    const before = migrationStatus(db);
    expect(before.every((m) => !m.applied)).toBe(true);
    applyMigrations(db);
    const after = migrationStatus(db);
    expect(after.every((m) => m.applied)).toBe(true);
    db.close();
  });

  it('enforces foreign keys (PRAGMA on)', () => {
    const db = openDbAt(dbPath);
    applyMigrations(db);
    const fkRows = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(fkRows[0]?.foreign_keys).toBe(1);
    db.close();
  });
});
