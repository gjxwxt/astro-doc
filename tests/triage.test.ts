import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '@/lib/db/client';
import {
  createFragment,
  getFragment,
  mergeFragments,
  updateFragmentsStatus,
} from '@/lib/db/fragments';
import { getDraft, softDeleteDraft } from '@/lib/db/syntheses';
import { createDraftFromFragment } from '@/lib/triage';

let db: ReturnType<typeof openDatabase> | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('triage actions', () => {
  it('turns a fragment into one reusable draft and archives it', () => {
    db = openDatabase(':memory:');
    const fragment = createFragment(db, 'local', {
      kind: 'quote',
      quote: '把值得留下的碎片变成草稿。',
      note: '先写一句备注。',
      sourceUrl: 'https://example.com/triage',
      sourceTitle: 'Triage 测试',
      tags: ['整理'],
    }).fragment;

    const first = createDraftFromFragment(db, 'local', fragment.id);
    expect(first?.created).toBe(true);
    expect(first?.draft.title).toBe('Triage 测试');
    expect(first?.draft.markdown).toContain('把值得留下的碎片变成草稿。');
    expect(first?.draft.markdown).toContain('先写一句备注。');
    expect(first?.fragment?.status).toBe('archived');

    const second = createDraftFromFragment(db, 'local', fragment.id);
    expect(second?.created).toBe(false);
    expect(second?.draft.id).toBe(first?.draft.id);
    expect(getDraft(db, 'local', first!.draft.id)?.citations).toHaveLength(1);
    expect((first!.draft.citations[0] as { token: string }).token).toMatch(/^fragment-/);

    // Deleting a draft must not make the same fragment impossible to convert again.
    softDeleteDraft(db, 'local', first!.draft.id);
    const third = createDraftFromFragment(db, 'local', fragment.id);
    expect(third).not.toBeNull();
    expect(third?.draft.id).toBe(first?.draft.id);
    expect(third?.draft.deletedAt).toBeNull();
  });

  it('merges duplicate notes and tags and soft deletes the duplicate', () => {
    db = openDatabase(':memory:');
    const target = createFragment(db, 'local', {
      kind: 'quote',
      quote: '目标碎片',
      note: '目标备注',
      tags: ['a'],
    }).fragment;
    const duplicate = createFragment(db, 'local', {
      kind: 'quote',
      quote: '重复碎片',
      note: '重复备注',
      tags: ['b'],
    }).fragment;

    const merged = mergeFragments(db, 'local', target.id, duplicate.id);
    expect(merged?.id).toBe(target.id);
    expect(merged?.note).toContain('目标备注');
    expect(merged?.note).toContain('重复备注');
    expect(merged?.tags).toEqual(['a', 'b']);
    expect(getFragment(db, 'local', duplicate.id)).toBeNull();
  });

  it('updates many fragments at once', () => {
    db = openDatabase(':memory:');
    const first = createFragment(db, 'local', { kind: 'quote', quote: '一' }).fragment;
    const second = createFragment(db, 'local', { kind: 'quote', quote: '二' }).fragment;
    expect(updateFragmentsStatus(db, 'local', [first.id, second.id], 'archived')).toBe(2);
    expect(getFragment(db, 'local', first.id)?.status).toBe('archived');
    expect(updateFragmentsStatus(db, 'local', [first.id], 'inbox')).toBe(1);
    expect(getFragment(db, 'local', first.id)?.status).toBe('inbox');
  });
});
