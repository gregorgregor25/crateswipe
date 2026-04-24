import Database, { type Database as DB } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

let instance: DB | null = null;

export const getDb = (): DB => {
  if (instance) return instance;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  instance = db;
  return db;
};

export const closeDb = (): void => {
  if (instance) {
    instance.close();
    instance = null;
  }
};

export const setDbInstance = (db: DB | null): void => {
  instance = db;
};

export const openDbAt = (path: string): DB => {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};
