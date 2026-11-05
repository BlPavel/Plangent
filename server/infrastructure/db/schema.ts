import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

import { DATA_DIR } from '../paths';
export { DATA_DIR } from '../paths';
const DB_PATH = path.join(DATA_DIR, 'plangent.db');

let _db: Database.Database | null = null;

export function closeDb(): void {
  if (_db?.open) _db.close();
  _db = null;
}

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

export { migrate } from './migrations/001-schema';
import { migrate } from './migrations/001-schema';

/** Run synchronous work atomically; nested calls use SQLite savepoints. */
export function inTransaction<T>(work: () => T): T { return getDb().transaction(work)(); }
