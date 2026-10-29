import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const OWNER_ID = 'local';
export const MAX_QUOTE_LENGTH = 20_000;
export const MAX_NOTE_LENGTH = 5_000;
export const MAX_CONTEXT_LENGTH = 1_000;
export const MAX_TAGS = 20;

export interface FragmentInput {
  kind?: string;
  groupId?: string;
  quote: string;
  note?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceSite?: string;
  contextBefore?: string;
  contextAfter?: string;
  capturedAt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface Fragment {
  id: string;
  ownerId: string;
  kind: string;
  groupId: string | null;
  quote: string;
  note: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceSite: string;
  contextBefore: string;
  contextAfter: string;
  capturedAt: string;
  status: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListFragmentsOptions {
  query?: string;
  tag?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ListFragmentsResult {
  fragments: Fragment[];
  total: number;
}

export interface FragmentPatch {
  note?: string;
  tags?: string[];
  status?: string;
}

interface FragmentRow {
  id: string;
  owner_id: string;
  kind: string;
  group_id: string | null;
  quote: string;
  note: string;
  source_url: string;
  source_title: string;
  source_site: string;
  context_before: string;
  context_after: string;
  captured_at: string;
  status: string;
  content_hash: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class FragmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'FragmentError';
  }
}

export class DuplicateFragmentError extends FragmentError {
  constructor(public readonly fragmentId: string) {
    super('DUPLICATE', '这条碎片已经存在。', 409);
    this.name = 'DuplicateFragmentError';
  }
}

function cleanText(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new FragmentError('INVALID_INPUT', '文本字段格式不对。');
  const text = value.replace(/\r\n/g, '\n').trim();
  if (text.length > max) {
    throw new FragmentError('INVALID_INPUT', `文本超过 ${max} 个字符。`);
  }
  return text;
}

function normalizeQuote(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function cleanUrl(value: unknown): { url: string; site: string } {
  const raw = cleanText(value, 2_000);
  if (!raw) return { url: '', site: '' };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return { url: parsed.toString(), site: parsed.hostname.replace(/^www\./, '') };
  } catch {
    throw new FragmentError('INVALID_INPUT', '来源链接必须是 http(s)。');
  }
}

export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new FragmentError('INVALID_INPUT', '标签必须是数组。');

  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new FragmentError('INVALID_INPUT', '标签必须是字符串。');
    const tag = item
      .normalize('NFKC')
      .trim()
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (!tag) continue;
    if (tag.length > 40) throw new FragmentError('INVALID_INPUT', '单个标签最多 40 个字符。');
    if (!tags.includes(tag)) tags.push(tag);
  }

  if (tags.length > MAX_TAGS) throw new FragmentError('INVALID_INPUT', `最多 ${MAX_TAGS} 个标签。`);
  return tags;
}

function normalizeCapturedAt(value: unknown): string {
  if (value === undefined || value === null || value === '') return new Date().toISOString();
  if (typeof value !== 'string') throw new FragmentError('INVALID_INPUT', 'capturedAt 必须是时间字符串。');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new FragmentError('INVALID_INPUT', 'capturedAt 不是合法时间。');
  return date.toISOString();
}

function contentHash(quote: string, sourceUrl: string): string {
  return createHash('sha256').update(`${normalizeQuote(quote)}\n${sourceUrl}`).digest('hex');
}

function rowToFragment(row: FragmentRow, tags: string[]): Fragment {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    /* keep empty metadata */
  }

  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    groupId: row.group_id,
    quote: row.quote,
    note: row.note,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceSite: row.source_site,
    contextBefore: row.context_before,
    contextAfter: row.context_after,
    capturedAt: row.captured_at,
    status: row.status,
    contentHash: row.content_hash,
    metadata,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function tagsFor(db: DatabaseSync, ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT fragment_id, tag FROM fragment_tags WHERE fragment_id IN (${placeholders}) ORDER BY tag`)
    .all(...ids) as Array<{ fragment_id: string; tag: string }>;

  for (const row of rows) {
    const list = map.get(row.fragment_id) ?? [];
    list.push(row.tag);
    map.set(row.fragment_id, list);
  }
  return map;
}

export function getFragment(db: DatabaseSync, ownerId: string, id: string): Fragment | null {
  const row = db
    .prepare('SELECT * FROM fragments WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
    .get(id, ownerId) as FragmentRow | undefined;
  if (!row) return null;
  return rowToFragment(row, tagsFor(db, [id]).get(id) ?? []);
}

export function createFragment(
  db: DatabaseSync,
  ownerId: string,
  input: FragmentInput,
): { fragment: Fragment; duplicate: boolean } {
  const quote = cleanText(input.quote, MAX_QUOTE_LENGTH);
  if (!quote) throw new FragmentError('INVALID_INPUT', '选中的文字不能为空。');

  const note = cleanText(input.note, MAX_NOTE_LENGTH);
  const source = cleanUrl(input.sourceUrl);
  const sourceTitle = cleanText(input.sourceTitle, 1_000);
  const sourceSite = cleanText(input.sourceSite, 255) || source.site;
  const contextBefore = cleanText(input.contextBefore, MAX_CONTEXT_LENGTH);
  const contextAfter = cleanText(input.contextAfter, MAX_CONTEXT_LENGTH);
  const capturedAt = normalizeCapturedAt(input.capturedAt);
  const tags = normalizeTags(input.tags);
  const kind = cleanText(input.kind, 40) || 'quote';
  const groupId = cleanText(input.groupId, 80) || null;
  const hash = contentHash(quote, source.url);
  const now = new Date().toISOString();
  const id = randomUUID();
  if (
    input.metadata !== undefined &&
    (typeof input.metadata !== 'object' || input.metadata === null || Array.isArray(input.metadata))
  ) {
    throw new FragmentError('INVALID_INPUT', 'metadata 必须是对象。');
  }
  const metadata = JSON.stringify(input.metadata ?? {});
  if (metadata.length > 20_000) throw new FragmentError('INVALID_INPUT', 'metadata 太大。');

  try {
    db.exec('BEGIN IMMEDIATE');
    const existing = db
      .prepare(
        'SELECT id FROM fragments WHERE owner_id = ? AND content_hash = ? AND deleted_at IS NULL',
      )
      .get(ownerId, hash) as { id: string } | undefined;

    if (existing) {
      db.exec('ROLLBACK');
      throw new DuplicateFragmentError(existing.id);
    }

    db.prepare(`
      INSERT INTO fragments (
        id, owner_id, kind, group_id, quote, note, source_url, source_title, source_site,
        context_before, context_after, captured_at, status, content_hash,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?)
    `).run(
      id,
      ownerId,
      kind,
      groupId,
      quote,
      note,
      source.url,
      sourceTitle,
      sourceSite,
      contextBefore,
      contextAfter,
      capturedAt,
      hash,
      metadata,
      now,
      now,
    );

    const insertTag = db.prepare('INSERT INTO fragment_tags (fragment_id, tag) VALUES (?, ?)');
    for (const tag of tags) insertTag.run(id, tag);

    db.exec('COMMIT');
    return { fragment: getFragment(db, ownerId, id)!, duplicate: false };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* transaction may already be closed */
    }
    if (error instanceof DuplicateFragmentError) throw error;
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      const existing = db
        .prepare(
          'SELECT id FROM fragments WHERE owner_id = ? AND content_hash = ? AND deleted_at IS NULL',
        )
        .get(ownerId, hash) as { id: string } | undefined;
      throw new DuplicateFragmentError(existing?.id ?? '');
    }
    throw error;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function listFragments(
  db: DatabaseSync,
  ownerId: string,
  options: ListFragmentsOptions = {},
): ListFragmentsResult {
  const clauses = ['owner_id = ?', 'deleted_at IS NULL'];
  const params: Array<string | number> = [ownerId];

  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }

  if (options.query?.trim()) {
    const like = `%${escapeLike(options.query.trim())}%`;
    clauses.push(
      "(quote LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR source_title LIKE ? ESCAPE '\\' OR source_url LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like);
  }

  if (options.tag?.trim()) {
    clauses.push(
      'EXISTS (SELECT 1 FROM fragment_tags ft WHERE ft.fragment_id = fragments.id AND ft.tag = ?)',
    );
    params.push(options.tag.trim().toLowerCase());
  }

  if (options.from) {
    clauses.push('captured_at >= ?');
    params.push(options.from);
  }

  if (options.to) {
    clauses.push('captured_at <= ?');
    params.push(options.to);
  }

  const where = clauses.join(' AND ');
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM fragments WHERE ${where}`).get(...params) as {
    count: number;
  };
  const rows = db
    .prepare(
      `SELECT * FROM fragments WHERE ${where} ORDER BY captured_at DESC, created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as FragmentRow[];

  const tags = tagsFor(
    db,
    rows.map((row) => row.id),
  );
  return {
    fragments: rows.map((row) => rowToFragment(row, tags.get(row.id) ?? [])),
    total: Number(countRow.count),
  };
}

export function listTags(db: DatabaseSync, ownerId: string): Array<{ tag: string; count: number }> {
  return db
    .prepare(`
      SELECT ft.tag, COUNT(*) AS count
      FROM fragment_tags ft
      JOIN fragments f ON f.id = ft.fragment_id
      WHERE f.owner_id = ? AND f.deleted_at IS NULL
      GROUP BY ft.tag
      ORDER BY count DESC, ft.tag ASC
    `)
    .all(ownerId) as Array<{ tag: string; count: number }>;
}

export function updateLinkPreview(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  input: { sourceTitle: string; sourceSite: string; metadata: Record<string, unknown> },
): Fragment | null {
  const existing = getFragment(db, ownerId, id);
  if (!existing || existing.kind !== 'link') return null;

  const sourceTitle = cleanText(input.sourceTitle, 1_000);
  const sourceSite = cleanText(input.sourceSite, 255) || existing.sourceSite;
  const metadata = JSON.stringify(input.metadata);
  if (metadata.length > 20_000) throw new FragmentError('INVALID_INPUT', 'metadata 太大。');

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE fragments
     SET source_title = ?, source_site = ?, metadata_json = ?, updated_at = ?
     WHERE id = ? AND owner_id = ? AND kind = 'link' AND deleted_at IS NULL`,
  ).run(sourceTitle, sourceSite, metadata, now, id, ownerId);

  return getFragment(db, ownerId, id);
}

export function updateFragment(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  patch: FragmentPatch,
): Fragment | null {
  const existing = getFragment(db, ownerId, id);
  if (!existing) return null;

  const note = patch.note === undefined ? existing.note : cleanText(patch.note, MAX_NOTE_LENGTH);
  const status = patch.status === undefined ? existing.status : cleanText(patch.status, 40);
  if (!['inbox', 'archived'].includes(status)) {
    throw new FragmentError('INVALID_INPUT', 'status 只能是 inbox 或 archived。');
  }
  const tags = patch.tags === undefined ? existing.tags : normalizeTags(patch.tags);
  const now = new Date().toISOString();

  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      'UPDATE fragments SET note = ?, status = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    ).run(note, status, now, id, ownerId);

    if (patch.tags !== undefined) {
      db.prepare('DELETE FROM fragment_tags WHERE fragment_id = ?').run(id);
      const insertTag = db.prepare('INSERT INTO fragment_tags (fragment_id, tag) VALUES (?, ?)');
      for (const tag of tags) insertTag.run(id, tag);
    }

    db.exec('COMMIT');
    return getFragment(db, ownerId, id);
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already closed */
    }
    throw error;
  }
}

export function softDeleteFragment(db: DatabaseSync, ownerId: string, id: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      'UPDATE fragments SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    )
    .run(now, now, id, ownerId);
  return Number(result.changes) > 0;
}
