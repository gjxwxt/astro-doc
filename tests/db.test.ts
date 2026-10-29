import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '@/lib/db/client';
import {
  DuplicateFragmentError,
  FragmentError,
  createFragment,
  getFragment,
  listFragments,
  listTags,
  softDeleteFragment,
  updateFragment,
} from '@/lib/db/fragments';
import { migrate } from '@/lib/db/migrate';

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('migrations', () => {
  it('is idempotent', () => {
    expect(() => migrate(db)).not.toThrow();
    const row = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number;
    };
    expect(row.count).toBe(3);
  });
});

describe('fragments', () => {
  it('creates a fragment and normalizes tags', () => {
    const { fragment, duplicate } = createFragment(db, 'local', {
      quote: '  一条测试碎片  ',
      note: '随想',
      sourceUrl: 'https://example.com/article?utm_source=x',
      sourceTitle: '示例文章',
      tags: ['AI', '#ai', ' 写作 '],
    });

    expect(duplicate).toBe(false);
    expect(fragment.quote).toBe('一条测试碎片');
    expect(fragment.sourceSite).toBe('example.com');
    expect(fragment.tags).toEqual(['ai', '写作']);
    expect(fragment.status).toBe('inbox');
    expect(getFragment(db, 'local', fragment.id)?.note).toBe('随想');
  });

  it('preserves a group id for multi-fragment clips', () => {
    const { fragment } = createFragment(db, 'local', {
      quote: '同页摘录 A',
      sourceUrl: 'https://example.com/article',
      groupId: 'page-2026-10-29',
    });
    expect(fragment.groupId).toBe('page-2026-10-29');
    expect(getFragment(db, 'local', fragment.id)?.groupId).toBe('page-2026-10-29');
  });

  it('stores a remote image fragment without downloading it', () => {
    const { fragment } = createFragment(db, 'local', {
      kind: 'image',
      quote: 'Astro logo',
      sourceUrl: 'https://example.com/gallery',
      metadata: {
        image: {
          src: 'https://cdn.example.com/astro.png',
          alt: 'Astro logo',
        },
      },
    });
    expect(fragment.kind).toBe('image');
    expect(fragment.metadata).toEqual({
      image: { src: 'https://cdn.example.com/astro.png', alt: 'Astro logo' },
    });
  });

  it('rejects duplicate quote + source, but allows it after soft delete', () => {
    const input = {
      quote: '同一条碎片',
      sourceUrl: 'https://example.com/a',
    };
    const first = createFragment(db, 'local', input).fragment;

    expect(() => createFragment(db, 'local', input)).toThrow(DuplicateFragmentError);

    expect(softDeleteFragment(db, 'local', first.id)).toBe(true);
    expect(getFragment(db, 'local', first.id)).toBeNull();

    const again = createFragment(db, 'local', input);
    expect(again.duplicate).toBe(false);
    expect(again.fragment.id).not.toBe(first.id);
  });

  it('deduplicates normalized whitespace', () => {
    const first = createFragment(db, 'local', {
      quote: 'A   sentence\nwith spaces',
      sourceUrl: 'https://example.com/a',
    });
    expect(() =>
      createFragment(db, 'local', {
        quote: 'A sentence with spaces',
        sourceUrl: 'https://example.com/a',
      }),
    ).toThrow(DuplicateFragmentError);
    expect(first.fragment.contentHash).toHaveLength(64);
  });

  it('lists, searches and filters by tag', () => {
    createFragment(db, 'local', {
      quote: 'SQLite 的 WAL 模式',
      tags: ['sqlite'],
      capturedAt: '2026-10-01T00:00:00.000Z',
    });
    createFragment(db, 'local', {
      quote: 'Gemini 的低思考强度',
      tags: ['ai'],
      capturedAt: '2026-10-02T00:00:00.000Z',
    });

    const all = listFragments(db, 'local');
    expect(all.total).toBe(2);
    expect(all.fragments[0]?.quote).toContain('Gemini');

    expect(listFragments(db, 'local', { query: 'SQLite' }).total).toBe(1);
    expect(listFragments(db, 'local', { tag: 'ai' }).fragments[0]?.quote).toContain('Gemini');
    expect(listTags(db, 'local')).toEqual([
      { tag: 'ai', count: 1 },
      { tag: 'sqlite', count: 1 },
    ]);
  });

  it('updates note, tags and status', () => {
    const fragment = createFragment(db, 'local', { quote: '可编辑', tags: ['old'] }).fragment;
    const updated = updateFragment(db, 'local', fragment.id, {
      note: '新随想',
      tags: ['new', '#later'],
      status: 'archived',
    });

    expect(updated?.note).toBe('新随想');
    expect(updated?.tags).toEqual(['later', 'new']);
    expect(updated?.status).toBe('archived');
    expect(() => updateFragment(db, 'local', fragment.id, { status: 'deleted' })).toThrow(
      FragmentError,
    );
  });

  it('rejects invalid input', () => {
    expect(() => createFragment(db, 'local', { quote: ' ' })).toThrow(FragmentError);
    expect(() =>
      createFragment(db, 'local', { quote: 'x', sourceUrl: 'javascript:alert(1)' }),
    ).toThrow(FragmentError);
    expect(() => createFragment(db, 'local', { quote: 'x', tags: ['a'.repeat(41)] })).toThrow(
      FragmentError,
    );
  });
});
