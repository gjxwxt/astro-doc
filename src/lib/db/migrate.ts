import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE IF NOT EXISTS fragments (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'quote',
        quote TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_title TEXT NOT NULL DEFAULT '',
        source_site TEXT NOT NULL DEFAULT '',
        context_before TEXT NOT NULL DEFAULT '',
        context_after TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'inbox',
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_fragments_hash
        ON fragments(owner_id, content_hash)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_fragments_captured
        ON fragments(owner_id, captured_at DESC);

      CREATE INDEX IF NOT EXISTS idx_fragments_status
        ON fragments(owner_id, status, captured_at DESC);

      CREATE TABLE IF NOT EXISTS fragment_tags (
        fragment_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (fragment_id, tag),
        FOREIGN KEY (fragment_id) REFERENCES fragments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_fragment_tags_tag
        ON fragment_tags(tag);

      CREATE TABLE IF NOT EXISTS synthesis_runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        fragment_ids_json TEXT NOT NULL DEFAULT '[]',
        outline_json TEXT,
        result_markdown TEXT,
        citations_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_synthesis_runs_owner
        ON synthesis_runs(owner_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS synthesis_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (run_id, seq),
        FOREIGN KEY (run_id) REFERENCES synthesis_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        synthesis_run_id TEXT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        markdown TEXT NOT NULL DEFAULT '',
        citations_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (synthesis_run_id) REFERENCES synthesis_runs(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_slug
        ON drafts(owner_id, slug);

      CREATE INDEX IF NOT EXISTS idx_drafts_updated
        ON drafts(owner_id, updated_at DESC);
    `,
  },
  {
    version: 2,
    name: 'draft-soft-delete',
    sql: `
      ALTER TABLE drafts ADD COLUMN deleted_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_drafts_active
        ON drafts(owner_id, updated_at DESC)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    version: 3,
    name: 'fragment-groups',
    sql: `
      ALTER TABLE fragments ADD COLUMN group_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_fragments_group
        ON fragments(owner_id, group_id, captured_at DESC)
        WHERE deleted_at IS NULL AND group_id IS NOT NULL;
    `,
  },
  {
    version: 4,
    name: 'media-library',
    sql: `
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        mime TEXT NOT NULL,
        ext TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        original_name TEXT NOT NULL DEFAULT '',
        storage_driver TEXT NOT NULL DEFAULT 'local',
        storage_key TEXT NOT NULL,
        public_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_owner_hash
        ON media(owner_id, hash)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_media_created
        ON media(owner_id, created_at DESC)
        WHERE deleted_at IS NULL;
    `,
  },
];

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (row) => Number(row.version),
    ),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export { migrations };
