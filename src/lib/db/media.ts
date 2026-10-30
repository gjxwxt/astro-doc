import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface MediaInput {
  hash: string;
  mime: string;
  ext: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  originalName?: string;
  storageDriver?: string;
  storageKey: string;
  publicUrl: string;
}

export interface MediaRecord {
  id: string;
  ownerId: string;
  hash: string;
  mime: string;
  ext: string;
  bytes: number;
  width: number | null;
  height: number | null;
  originalName: string;
  storageDriver: string;
  storageKey: string;
  publicUrl: string;
  createdAt: string;
}

interface MediaRow {
  id: string;
  owner_id: string;
  hash: string;
  mime: string;
  ext: string;
  bytes: number;
  width: number | null;
  height: number | null;
  original_name: string;
  storage_driver: string;
  storage_key: string;
  public_url: string;
  created_at: string;
}

function toMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    hash: row.hash,
    mime: row.mime,
    ext: row.ext,
    bytes: Number(row.bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    originalName: row.original_name,
    storageDriver: row.storage_driver,
    storageKey: row.storage_key,
    publicUrl: row.public_url,
    createdAt: row.created_at,
  };
}

const SELECT = `SELECT id, owner_id, hash, mime, ext, bytes, width, height, original_name,
  storage_driver, storage_key, public_url, created_at
  FROM media`;

export function getMedia(db: DatabaseSync, ownerId: string, id: string): MediaRecord | null {
  const row = db.prepare(`${SELECT} WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`).get(
    ownerId,
    id,
  ) as MediaRow | undefined;
  return row ? toMedia(row) : null;
}

export function getMediaByHash(db: DatabaseSync, ownerId: string, hash: string): MediaRecord | null {
  const row = db.prepare(`${SELECT} WHERE owner_id = ? AND hash = ? AND deleted_at IS NULL`).get(
    ownerId,
    hash,
  ) as MediaRow | undefined;
  return row ? toMedia(row) : null;
}

export function createMedia(
  db: DatabaseSync,
  ownerId: string,
  input: MediaInput,
): { media: MediaRecord; deduped: boolean } {
  const existing = getMediaByHash(db, ownerId, input.hash);
  if (existing) return { media: existing, deduped: true };

  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO media (
        id, owner_id, hash, mime, ext, bytes, width, height, original_name,
        storage_driver, storage_key, public_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      ownerId,
      input.hash,
      input.mime,
      input.ext,
      input.bytes,
      input.width ?? null,
      input.height ?? null,
      input.originalName ?? '',
      input.storageDriver ?? 'local',
      input.storageKey,
      input.publicUrl,
      now,
    );
  } catch (error) {
    // A concurrent upload with the same hash may have won the unique index.
    const raced = getMediaByHash(db, ownerId, input.hash);
    if (raced) return { media: raced, deduped: true };
    throw error;
  }

  return { media: getMedia(db, ownerId, id)!, deduped: false };
}
