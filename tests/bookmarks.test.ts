import { describe, expect, it } from 'vitest';

import {
  emptyOverlay,
  mergeGroups,
  normalizeOverlay,
  type BookmarkGroup,
} from '@/lib/bookmarks';

const groups: BookmarkGroup[] = [
  {
    id: 'frontend',
    title: '前端',
    order: 1,
    items: [
      { name: 'MDN', url: 'https://developer.mozilla.org/', description: '文档' },
      { name: 'GitHub', url: 'https://github.com/', description: '代码' },
    ],
  },
  {
    id: 'tools',
    title: '工具',
    order: 2,
    items: [{ name: 'Excalidraw', url: 'https://excalidraw.com/', description: '白板' }],
  },
];

describe('mergeGroups', () => {
  it('does not mutate the defaults', () => {
    mergeGroups(groups, {
      version: 1,
      hidden: ['https://github.com/'],
      custom: [],
      edits: { 'https://developer.mozilla.org/': { name: 'MDN Web Docs' } },
    });
    expect(groups[0]?.items[1]?.name).toBe('GitHub');
    expect(groups[0]?.items[0]?.name).toBe('MDN');
  });

  it('applies edits, hides deleted links and adds custom links', () => {
    const merged = mergeGroups(groups, {
      version: 1,
      hidden: ['https://github.com/'],
      custom: [{ group: 'tools', name: 'Squoosh', url: 'https://squoosh.app/' }],
      edits: { 'https://developer.mozilla.org/': { name: 'MDN Web Docs', description: '权威文档' } },
    });
    expect(merged[0]?.items.map((item) => item.name)).toEqual(['MDN Web Docs']);
    expect(merged[1]?.items.map((item) => item.name)).toEqual(['Excalidraw', 'Squoosh']);
  });

  it('does not duplicate a custom link that already exists', () => {
    const merged = mergeGroups(groups, {
      version: 1,
      hidden: [],
      custom: [{ group: 'tools', name: 'GitHub', url: 'https://github.com/' }],
      edits: {},
    });
    expect(merged.flatMap((group) => group.items).filter((item) => item.url === 'https://github.com/'))
      .toHaveLength(1);
  });

  it('treats an empty overlay as identity', () => {
    expect(mergeGroups(groups, emptyOverlay())).toEqual(groups);
  });
});

describe('normalizeOverlay', () => {
  it('rejects unknown versions', () => {
    expect(normalizeOverlay({ version: 2 })).toBeNull();
    expect(normalizeOverlay('nope')).toBeNull();
  });

  it('filters invalid URLs and normalizes fields', () => {
    const overlay = normalizeOverlay({
      version: 1,
      hidden: ['https://a.com/', 'javascript:alert(1)'],
      custom: [
        { group: 'tools', name: 'A', url: 'https://a.com/' },
        { group: 'tools', name: 'B', url: 'not-a-url' },
      ],
      edits: { 'https://a.com/': { name: 'A2' }, bad: { name: 'x' } },
    });
    expect(overlay?.hidden).toEqual(['https://a.com/']);
    expect(overlay?.custom).toHaveLength(1);
    expect(overlay?.edits['https://a.com/']?.name).toBe('A2');
    expect(overlay?.edits.bad).toBeUndefined();
  });
});
