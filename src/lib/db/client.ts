import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrate } from './migrate';

const globalForDb = globalThis as unknown as { __portalDb?: DatabaseSync };

export function databasePath(env: Record<string, string | undefined> = process.env): string {
  const dir = env.PORTAL_DATA_DIR?.trim() || resolve(process.cwd(), 'data');
  return join(dir, 'portal.sqlite');
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

export function getDatabase(env: Record<string, string | undefined> = process.env): DatabaseSync {
  if (!globalForDb.__portalDb) {
    globalForDb.__portalDb = openDatabase(databasePath(env));
  }
  return globalForDb.__portalDb;
}

export function closeDatabase(): void {
  if (!globalForDb.__portalDb) return;
  globalForDb.__portalDb.close();
  globalForDb.__portalDb = undefined;
}
