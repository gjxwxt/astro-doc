import { describe, expect, it } from 'vitest';

import { excerpt, markdownToText, stripLeadingTitle } from '@/lib/markdown';
import {
  convertCallouts,
  convertEmbeds,
  convertWikilinks,
  describe as describeBody,
  frontmatterFor,
  normalizeTags,
  slugify,
  toDay,
  type TransformOptions,
} from '../scripts/lib/sync';

function options(overrides: Partial<TransformOptions> = {}): TransformOptions {
  return {
    body: '',
    title: '标题',
    slug: '标题',
    noteSlugByKey: new Map([['第二篇', '第二篇']]),
    resolveAsset: () => '/notes-assets/标题/pic.png',
    warn: () => undefined,
    ...overrides,
  };
}

describe('slugify', () => {
  it('keeps Chinese and replaces separators', () => {
    expect(slugify('把站点重做了一遍')).toBe('把站点重做了一遍');
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  ')).toBe('note');
  });
});

describe('normalizeTags', () => {
  it('accepts arrays and comma/space separated strings', () => {
    expect(normalizeTags(['#astro', '重构'], ['默认'])).toEqual(['默认', 'astro', '重构']);
    expect(normalizeTags('astro, 重构 记录')).toEqual(['astro', '重构', '记录']);
  });
});

describe('toDay', () => {
  it('formats dates and falls back to the provided date', () => {
    expect(toDay('2026-10-27', new Date('2020-01-01'))).toBe('2026-10-27');
    expect(toDay(undefined, new Date('2020-01-01T00:00:00Z'))).toBe('2020-01-01');
  });
});

describe('markdown transforms', () => {
  it('converts Obsidian callouts', () => {
    expect(convertCallouts('> [!note] 小提示\n> 正文')).toContain('> **小提示**');
    expect(convertCallouts('> [!warning]\n> 正文')).toContain('> **Warning**');
  });

  it('converts image embeds through resolveAsset', () => {
    expect(convertEmbeds('![[pic.png]]', options())).toBe('![pic](/notes-assets/标题/pic.png)');
    const warns: string[] = [];
    const result = convertEmbeds(
      '![[missing.png]]',
      options({ resolveAsset: () => null, warn: (message) => warns.push(message) }),
    );
    expect(result).toBe('![[missing.png]]');
    expect(warns[0]).toContain('missing.png');
  });

  it('converts wikilinks and leaves unknown targets as text', () => {
    const transform = options();
    expect(convertWikilinks('[[第二篇]]', transform)).toBe('[第二篇](/notes/第二篇/)');
    expect(convertWikilinks('[[第二篇|别名]]', transform)).toBe('[别名](/notes/第二篇/)');
    expect(convertWikilinks('[[第二篇#小标题]]', transform)).toBe(
      '[第二篇](/notes/第二篇/#小标题)',
    );
    expect(convertWikilinks('[[不存在]]', transform)).toBe('不存在');
  });

  it('builds a description from the first real paragraph', () => {
    const body = '# 标题\n\n> [!note] 提示\n> 不要用这个\n\n这是正文的第一段，应该被选为描述。\n\n- 列表\n\n![图](x.png)';
    expect(describeBody(body)).toBe('这是正文的第一段，应该被选为描述。');
  });

  it('serializes quoted frontmatter', () => {
    const frontmatter = frontmatterFor({
      title: '标题: "引号"',
      description: '描述',
      date: '2026-10-27',
      updated: '2026-10-28',
      tags: ['a', 'b'],
      draft: false,
      featured: true,
      source: 'Notes/标题.md',
    });
    expect(frontmatter).toContain('title: "标题: \\"引号\\""');
    expect(frontmatter).toContain('tags: ["a","b"]');
    expect(frontmatter).toContain('featured: true');
  });
});

describe('markdownToText', () => {
  it('strips code, links, headings and frontmatter', () => {
    const text = markdownToText('---\ntitle: x\n---\n# 标题\n\n[链接](https://a.com) 和 `code`\n\n```js\nconst x = 1;\n```');
    expect(text).toContain('标题');
    expect(text).toContain('链接');
    expect(text).not.toContain('https://a.com');
    expect(text).not.toContain('const x');
    expect(text).not.toContain('title: x');
  });

  it('truncates excerpts', () => {
    expect(excerpt('a'.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('removes a leading duplicate title', () => {
    expect(stripLeadingTitle('# 标题\n\n正文', '标题')).toBe('正文');
    expect(stripLeadingTitle('# 其他\n\n正文', '标题')).toBe('# 其他\n\n正文');
  });
});
