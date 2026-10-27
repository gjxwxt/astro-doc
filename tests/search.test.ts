import { describe, expect, it } from 'vitest';

import { highlightParts, queryTokens, searchDocs, tokenize, type SearchDoc } from '@/lib/search';

const docs: SearchDoc[] = [
  {
    id: 'note:astro',
    type: 'note',
    url: '/notes/astro/',
    title: '把站点换成 Astro',
    description: '一次重构记录',
    tags: ['astro', '重构'],
    body: 'Astro 的 islands 架构减少了 JavaScript。',
  },
  {
    id: 'note:music',
    type: 'note',
    url: '/notes/music/',
    title: '音乐播放器',
    description: '用 Web Audio 做一个简单的播放器',
    tags: ['音频'],
    body: 'Astro 只是页面外壳，播放器是原生的。',
  },
  {
    id: 'tool:devkit',
    type: 'tool',
    url: '/tools/devkit/',
    title: '开发者工具',
    description: 'JSON、Base64 和哈希',
    body: '浏览器里运行的小工具。',
  },
];

describe('tokenize', () => {
  it('splits Chinese into bigrams and keeps Latin words', () => {
    const tokens = tokenize('前端 Astro 工具');
    expect(tokens).toContain('前端');
    expect(tokens).toContain('工具');
    expect(tokens).toContain('astro');
  });

  it('filters stopwords from queries', () => {
    expect(queryTokens('这个站有哪些工具')).not.toContain('的');
    expect(queryTokens('the astro site')).toEqual(['astro', 'site']);
  });
});

describe('searchDocs', () => {
  it('returns an empty list for an empty query', () => {
    expect(searchDocs(docs, '')).toEqual([]);
  });

  it('ranks title matches above body-only matches', () => {
    const hits = searchDocs(docs, '音乐');
    expect(hits[0]?.doc.id).toBe('note:music');
    expect(hits[0]?.snippet.length).toBeGreaterThan(0);
  });

  it('matches tags and descriptions', () => {
    const hits = searchDocs(docs, '重构');
    expect(hits[0]?.doc.id).toBe('note:astro');
  });

  it('returns nothing for unrelated terms', () => {
    expect(searchDocs(docs, '完全不相关的内容')).toEqual([]);
  });
});

describe('highlightParts', () => {
  it('marks matched tokens and merges overlaps', () => {
    const parts = highlightParts('Astro 和 Astro islands', 'astro');
    expect(parts.filter((part) => part.match).length).toBe(2);
    expect(parts.map((part) => part.text).join('')).toBe('Astro 和 Astro islands');
  });

  it('returns the full string when there is no query', () => {
    expect(highlightParts('hello', '')).toEqual([{ text: 'hello', match: false }]);
  });
});
