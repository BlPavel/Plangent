import Database from 'better-sqlite3';
import { migrate } from '../../infrastructure/db/migrations/001-schema';

/** An independent migrated database; never touches the application's singleton. */
export function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
