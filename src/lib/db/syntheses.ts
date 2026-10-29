import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SynthesisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SynthesisRun {
  id: string;
  ownerId: string;
  status: SynthesisStatus;
  prompt: string;
  model: string;
  fragmentIds: string[];
  outline: unknown;
  resultMarkdown: string | null;
  citations: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SynthesisEvent {
  seq: number;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type DraftStatus = 'draft' | 'exported' | 'archived';

export interface Draft {
  id: string;
  ownerId: string;
  synthesisRunId: string | null;
  title: string;
  slug: string;
  markdown: string;
  citations: unknown[];
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface DraftRow {
  id: string;
  owner_id: string;
  synthesis_run_id: string | null;
  title: string;
  slug: string;
  markdown: string;
  citations_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RunRow {
  id: string;
  owner_id: string;
  status: string;
  prompt: string;
  model: string;
  fragment_ids_json: string;
  outline_json: string | null;
  result_markdown: string | null;
  citations_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EventRow {
  seq: number;
  run_id: string;
  type: string;
  payload_json: string;
  created_at: string;
}

const STATUSES = new Set<SynthesisStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function rowToRun(row: RunRow): SynthesisRun {
  return {
    id: row.id,
    ownerId: row.owner_id,
    status: STATUSES.has(row.status as SynthesisStatus)
      ? (row.status as SynthesisStatus)
      : 'failed',
    prompt: row.prompt,
    model: row.model,
    fragmentIds: parseArray(row.fragment_ids_json),
    outline: parseJson(row.outline_json),
    resultMarkdown: row.result_markdown,
    citations: parseJson(row.citations_json),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function eventToValue(row: EventRow): SynthesisEvent {
  const parsed = parseJson(row.payload_json);
  return {
    seq: Number(row.seq),
    runId: row.run_id,
    type: row.type,
    payload:
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

export function createSynthesisRun(
  db: DatabaseSync,
  ownerId: string,
  input: { prompt?: string; fragmentIds: string[]; model?: string },
): SynthesisRun {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO synthesis_runs (
      id, owner_id, status, prompt, model, fragment_ids_json, created_at
    ) VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
  ).run(
    id,
    ownerId,
    (input.prompt ?? '').trim().slice(0, 4_000),
    (input.model ?? '').trim().slice(0, 120),
    JSON.stringify(input.fragmentIds),
    now,
  );
  return getSynthesisRun(db, ownerId, id)!;
}

export function getSynthesisRun(
  db: DatabaseSync,
  ownerId: string,
  id: string,
): SynthesisRun | null {
  const row = db
    .prepare('SELECT * FROM synthesis_runs WHERE id = ? AND owner_id = ?')
    .get(id, ownerId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function findActiveSynthesisRun(
  db: DatabaseSync,
  ownerId: string,
): SynthesisRun | null {
  const row = db
    .prepare(
      "SELECT * FROM synthesis_runs WHERE owner_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
    )
    .get(ownerId) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export type SynthesisPatch = Partial<{
  status: SynthesisStatus;
  model: string;
  outline: unknown;
  resultMarkdown: string | null;
  citations: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}>;

export function updateSynthesisRun(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  patch: SynthesisPatch,
): SynthesisRun | null {
  const current = getSynthesisRun(db, ownerId, id);
  if (!current) return null;

  const next = {
    status: patch.status ?? current.status,
    model: patch.model ?? current.model,
    outline: patch.outline === undefined ? current.outline : patch.outline,
    resultMarkdown:
      patch.resultMarkdown === undefined ? current.resultMarkdown : patch.resultMarkdown,
    citations: patch.citations === undefined ? current.citations : patch.citations,
    error: patch.error === undefined ? current.error : patch.error,
    startedAt: patch.startedAt === undefined ? current.startedAt : patch.startedAt,
    completedAt: patch.completedAt === undefined ? current.completedAt : patch.completedAt,
  };

  db.prepare(
    `UPDATE synthesis_runs
     SET status = ?, model = ?, outline_json = ?, result_markdown = ?, citations_json = ?,
         error = ?, started_at = ?, completed_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    next.status,
    next.model,
    next.outline === null ? null : JSON.stringify(next.outline),
    next.resultMarkdown,
    next.citations === null ? null : JSON.stringify(next.citations),
    next.error,
    next.startedAt,
    next.completedAt,
    id,
    ownerId,
  );

  return getSynthesisRun(db, ownerId, id);
}

export function appendSynthesisEvent(
  db: DatabaseSync,
  runId: string,
  type: string,
  payload: Record<string, unknown> = {},
): SynthesisEvent {
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM synthesis_events WHERE run_id = ?',
      )
      .get(runId) as { seq: number };
    const seq = Number(row.seq);
    db.prepare(
      `INSERT INTO synthesis_events (run_id, seq, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, seq, type, JSON.stringify(payload), now);
    db.exec('COMMIT');
    return { seq, runId, type, payload, createdAt: now };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already closed */
    }
    throw error;
  }
}

export function listSynthesisEvents(
  db: DatabaseSync,
  runId: string,
  afterSeq = 0,
): SynthesisEvent[] {
  const rows = db
    .prepare(
      'SELECT seq, run_id, type, payload_json, created_at FROM synthesis_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC',
    )
    .all(runId, afterSeq) as unknown as EventRow[];
  return rows.map(eventToValue);
}

function draftStatus(value: string): DraftStatus {
  return value === 'exported' || value === 'archived' ? value : 'draft';
}

function parseCitations(value: string | null): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function draftToValue(row: DraftRow): Draft {
  return {
    id: row.id,
    ownerId: row.owner_id,
    synthesisRunId: row.synthesis_run_id,
    title: row.title,
    slug: row.slug,
    markdown: row.markdown,
    citations: parseCitations(row.citations_json),
    status: draftStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function getDraft(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Draft | null {
  const row = db
    .prepare(
      `SELECT * FROM drafts WHERE id = ? AND owner_id = ?${options.includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    )
    .get(id, ownerId) as DraftRow | undefined;
  return row ? draftToValue(row) : null;
}

export function listDrafts(
  db: DatabaseSync,
  ownerId: string,
  options: { status?: DraftStatus; limit?: number; offset?: number } = {},
): { drafts: Draft[]; total: number } {
  const clauses = ['owner_id = ?', 'deleted_at IS NULL'];
  const params: Array<string | number> = [ownerId];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  const where = clauses.join(' AND ');
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const count = db.prepare(`SELECT COUNT(*) AS count FROM drafts WHERE ${where}`).get(...params) as {
    count: number;
  };
  const rows = db
    .prepare(`SELECT * FROM drafts WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as DraftRow[];
  return { drafts: rows.map(draftToValue), total: Number(count.count) };
}

export function createDraft(
  db: DatabaseSync,
  ownerId: string,
  input: {
    synthesisRunId: string;
    title: string;
    slug: string;
    markdown: string;
    citations: unknown;
  },
): Draft {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO drafts (
      id, owner_id, synthesis_run_id, title, slug, markdown, citations_json,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  ).run(
    id,
    ownerId,
    input.synthesisRunId,
    input.title.slice(0, 500),
    input.slug.slice(0, 160),
    input.markdown,
    JSON.stringify(input.citations ?? []),
    now,
    now,
  );
  return getDraft(db, ownerId, id)!;
}

export function updateDraft(
  db: DatabaseSync,
  ownerId: string,
  id: string,
  patch: { title?: string; markdown?: string; status?: DraftStatus },
): Draft | null {
  const current = getDraft(db, ownerId, id);
  if (!current) return null;
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 500);
  const markdown = patch.markdown === undefined ? current.markdown : patch.markdown;
  const status = patch.status === undefined ? current.status : draftStatus(patch.status);
  if (!title) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE drafts SET title = ?, markdown = ?, status = ?, updated_at = ?
     WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
  ).run(title, markdown, status, now, id, ownerId);
  return getDraft(db, ownerId, id);
}

export function softDeleteDraft(db: DatabaseSync, ownerId: string, id: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      'UPDATE drafts SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    )
    .run(now, now, id, ownerId);
  return Number(result.changes) > 0;
}

export function restoreDraft(db: DatabaseSync, ownerId: string, id: string): Draft | null {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE drafts SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?',
  ).run(now, id, ownerId);
  return getDraft(db, ownerId, id);
}
