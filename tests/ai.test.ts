import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChatResponse } from '@/lib/ai';
import type { SearchHit } from '@/lib/search';

const hit: SearchHit = {
  doc: {
    id: 'tool:devkit',
    type: 'tool',
    url: '/tools/devkit/',
    title: '开发者工具',
    description: 'JSON、Base64 和哈希',
    body: '浏览器里运行的小工具。',
  },
  score: 1,
  snippet: 'JSON、Base64 和哈希',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createChatResponse', () => {
  it('falls back to retrieval when the upstream returns 402 and passes reasoning_effort', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.reasoning_effort).toBe('low');
      expect(body.model).toBe('gemini-3.8-flash');
      return new Response(JSON.stringify({ error: { message: 'quota' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: '工具' }] }),
    });
    const response = await createChatResponse({
      request,
      env: {
        GEMINI_API_KEY: 'dummy',
        AI_BASE_URL: 'https://example.test/v1',
        AI_MODEL: 'gemini-3.8-flash',
        AI_REASONING_EFFORT: 'low',
      },
      messages: [{ role: 'user', content: '工具' }],
      hits: [hit],
    });

    const text = await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).toContain('event: sources');
    expect(text).toContain('"mode":"search"');
    expect(text).toContain('AI 接口返回 402');
    expect(text).toContain('quota');
    expect(text).toContain('/tools/devkit/');
  });
});
