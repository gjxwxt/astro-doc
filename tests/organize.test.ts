import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase } from '@/lib/db/client';
import { createFragment } from '@/lib/db/fragments';
import {
  findDuplicatesRules,
  normalizeText,
  organizeRules,
  suggestTagsRules,
  summarizeRules,
} from '@/lib/organize';
import { getReviewStats, reviewRules } from '@/lib/review';

let db: ReturnType<typeof openDatabase> | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe('organize rules', () => {
  it('summarizes, extracts known tags and detects near duplicates', () => {
    db = openDatabase(':memory:');
    const first = createFragment(db, 'local', {
      kind: 'quote',
      quote: '用 AI 整理知识库：先摘要，再建议标签，最后检查重复。',
      sourceUrl: 'https://example.com/a',
      tags: ['AI'],
    }).fragment;
    const second = createFragment(db, 'local', {
      kind: 'quote',
      quote: '用 AI 整理知识库，先摘要再建议标签，最后检查重复。',
      sourceUrl: 'https://example.com/b',
    }).fragment;

    expect(normalizeText(' AI，知识库！ ')).toBe('ai 知识库');
    expect(summarizeRules(first)).toContain('AI');
    expect(suggestTagsRules(first, [{ tag: 'AI', count: 3 }])).toContain('AI');
    const duplicates = findDuplicatesRules(first, [second]);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0]?.id).toBe(second.id);
    expect(organizeRules({ fragment: first, candidates: [second], knownTags: [] })).toMatchObject({
      mode: 'rules',
      tags: expect.any(Array),
      duplicates: expect.any(Array),
    });
  });

  it('builds a weekly review from actual fragments', () => {
    db = openDatabase(':memory:');
    createFragment(db, 'local', {
      kind: 'quote',
      quote: '本周的媒体库整理记录',
      capturedAt: new Date().toISOString(),
      tags: ['媒体'],
    });
    createFragment(db, 'local', {
      kind: 'quote',
      quote: '上个月的旧记录',
      capturedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const stats = getReviewStats(db, 'local');
    expect(stats.weekTotal).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.inbox).toBe(2);
    expect(stats.topTags[0]?.label).toBe('媒体');
    expect(reviewRules(stats)).toContain('本周新增 1 条');
  });
});

describe('organize AI guard', () => {
  it('stays offline when AI_ENABLED=0', async () => {
    const { organizeFragment } = await import('@/lib/organize');
    db = openDatabase(':memory:');
    const fragment = createFragment(db, 'local', {
      kind: 'quote',
      quote: '不联网也应该能整理',
    }).fragment;
    const result = await organizeFragment({
      fragment,
      candidates: [],
      knownTags: [],
      env: { GEMINI_API_KEY: 'dummy', AI_ENABLED: '0' },
    });
    expect(result.mode).toBe('rules');
    expect(result.notice).toContain('未启用');
  });
});


describe('organize AI path', () => {
  it('parses an AI JSON suggestion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'AI 生成的摘要',
                    tags: ['ai', '整理'],
                    duplicateIds: [],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      const { organizeFragment } = await import('@/lib/organize');
      db = openDatabase(':memory:');
      const fragment = createFragment(db, 'local', {
        kind: 'quote',
        quote: 'AI 路径测试',
      }).fragment;
      const result = await organizeFragment({
        fragment,
        candidates: [],
        knownTags: [],
        env: {
          GEMINI_API_KEY: 'dummy',
          AI_ENABLED: '1',
          AI_BASE_URL: 'https://example.test/v1',
          AI_MODEL: 'test-model',
        },
      });
      expect(result.mode).toBe('ai');
      expect(result.summary).toBe('AI 生成的摘要');
      expect(result.tags).toContain('ai');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
