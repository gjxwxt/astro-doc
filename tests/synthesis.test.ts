import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '@/lib/db/client';
import type { Fragment } from '@/lib/db/fragments';
import {
  appendSynthesisEvent,
  createDraft,
  createSynthesisRun,
  findActiveSynthesisRun,
  getDraft,
  getSynthesisRun,
  listDrafts,
  listSynthesisEvents,
  restoreDraft,
  softDeleteDraft,
  updateDraft,
  updateSynthesisRun,
} from '@/lib/db/syntheses';
import { buildDraftExport, exportFilename } from '@/lib/drafts/export';
import {
  citationSet,
  citationTokens,
  dedupeFragments,
  ensureParagraphCitations,
  fragmentContent,
  localPlan,
  normalizePlan,
  replaceInvalidCitations,
  sameCitationSet,
  structureMarkdown,
} from '@/lib/synthesis/plan';

function fragment(
  id: string,
  quote: string,
  options: Partial<Fragment> = {},
): Fragment {
  return {
    id,
    ownerId: 'local',
    kind: 'quote',
    groupId: null,
    quote,
    note: '',
    sourceUrl: '',
    sourceTitle: '',
    sourceSite: '',
    contextBefore: '',
    contextAfter: '',
    capturedAt: '2026-10-01T00:00:00.000Z',
    status: 'inbox',
    contentHash: id,
    metadata: {},
    tags: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    ...options,
  };
}

describe('synthesis plan helpers', () => {
  it('uses link preview description instead of the URL', () => {
    const link = fragment('a', 'https://example.com/post', {
      kind: 'link',
      metadata: {
        preview: { title: '文章标题', description: '这是文章简介。', provider: 'generic' },
      },
    });
    const quoted = fragment('b', '> 引用原文');
    expect(fragmentContent(link)).toBe('这是文章简介。');
    expect(fragmentContent(quoted)).toBe('引用原文');
  });

  it('deduplicates normalized quotes but keeps the first fragment', () => {
    const first = fragment('a', 'A  sentence', { tags: ['ai'] });
    const duplicate = fragment('b', 'a sentence');
    const other = fragment('c', '另一条');
    const result = dedupeFragments([first, duplicate, other]);
    expect(result.unique.map((item) => item.id)).toEqual(['a', 'c']);
    expect(result.duplicateIds).toEqual(['b']);
  });

  it('builds a local plan that covers every fragment', () => {
    const fragments = [
      fragment('a', 'AI 写作', { tags: ['ai'] }),
      fragment('b', '算法学习', { tags: ['算法'] }),
      fragment('c', 'AI 工具', { tags: ['ai'] }),
    ];
    const plan = localPlan(fragments);
    expect(plan.mode).toBe('structure');
    expect(plan.clusters.length).toBe(2);
    expect(plan.clusters.flatMap((cluster) => cluster.fragmentIds).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(plan.outline.length).toBe(2);
    expect(structureMarkdown(plan, fragments)).toContain('AI 写作');
  });

  it('normalizes AI plan tokens and keeps unassigned fragments', () => {
    const fragments = [fragment('a', 'A'), fragment('b', 'B'), fragment('c', 'C')];
    const plan = normalizePlan(
      {
        title: '标题',
        clusters: [{ id: 'c1', title: '一组', summary: '', fragmentIds: ['f1'] }],
        outline: [{ heading: '第一节', clusterId: 'c1', intent: '' }],
      },
      fragments,
      localPlan(fragments),
    );
    expect(plan.mode).toBe('ai');
    expect(plan.clusters[0]?.fragmentIds).toEqual(['a', 'b', 'c']);
  });

  it('marks missing and invalid citations without touching headings', () => {
    const allowed = new Set(['f1', 'f2']);
    const invalid = replaceInvalidCitations('# 标题\n\n有引用 [f1]，也有 [f9]。', allowed);
    expect(invalid.markdown).toContain('[f1]');
    expect(invalid.markdown).toContain('[?]');
    expect(invalid.invalid).toEqual(['f9']);

    const ensured = ensureParagraphCitations(invalid.markdown);
    expect(ensured.missing).toBe(0);
    expect(citationTokens(ensured.markdown).sort()).toEqual(['f1']);
  });

  it('detects citation set drift', () => {
    const before = citationSet('正文 [f1] [f2]', new Set(['f1', 'f2']));
    const same = citationSet('润色 [f2] [f1]', new Set(['f1', 'f2']));
    const changed = citationSet('润色 [f1]', new Set(['f1', 'f2']));
    expect(sameCitationSet(before, same)).toBe(true);
    expect(sameCitationSet(before, changed)).toBe(false);
  });
});

describe('synthesis persistence', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a run, appends ordered events and completes it', () => {
    const run = createSynthesisRun(db, 'local', {
      fragmentIds: ['a', 'b'],
      prompt: '写得具体一点',
    });
    expect(run.status).toBe('queued');
    expect(findActiveSynthesisRun(db, 'local')?.id).toBe(run.id);

    expect(appendSynthesisEvent(db, run.id, 'run.started', { total: 2 }).seq).toBe(1);
    expect(appendSynthesisEvent(db, run.id, 'stage', { stage: 'collect' }).seq).toBe(2);
    expect(listSynthesisEvents(db, run.id).map((event) => event.type)).toEqual([
      'run.started',
      'stage',
    ]);
    expect(listSynthesisEvents(db, run.id, 1).map((event) => event.seq)).toEqual([2]);

    const completed = updateSynthesisRun(db, 'local', run.id, {
      status: 'completed',
      resultMarkdown: '# 标题\n\n正文 [f1]',
      citations: [{ token: 'f1', fragmentId: 'a' }],
      completedAt: new Date().toISOString(),
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.resultMarkdown).toContain('[f1]');
    expect(findActiveSynthesisRun(db, 'local')).toBeNull();
  });

  it('saves a draft without deleting the source run', () => {
    const run = createSynthesisRun(db, 'local', { fragmentIds: ['a'] });
    updateSynthesisRun(db, 'local', run.id, {
      status: 'completed',
      resultMarkdown: '# 标题\n\n正文 [f1]',
      citations: [],
    });
    const draft = createDraft(db, 'local', {
      synthesisRunId: run.id,
      title: '标题',
      slug: '标题-abc',
      markdown: '# 标题\n\n正文 [f1]',
      citations: [],
    });
    expect(draft.title).toBe('标题');
    expect(getSynthesisRun(db, 'local', run.id)?.status).toBe('completed');
  });

  it('lists, updates, soft deletes and restores drafts', () => {
    const run = createSynthesisRun(db, 'local', { fragmentIds: ['a'] });
    const first = createDraft(db, 'local', {
      synthesisRunId: run.id,
      title: '第一篇',
      slug: 'first',
      markdown: '# 第一篇\n\n正文 [f1]',
      citations: [{ token: 'f1', title: '来源', url: 'https://example.com', quote: '原文' }],
    });
    const second = createDraft(db, 'local', {
      synthesisRunId: run.id,
      title: '第二篇',
      slug: 'second',
      markdown: '# 第二篇',
      citations: [],
    });

    expect(listDrafts(db, 'local').total).toBe(2);
    expect(listDrafts(db, 'local', { status: 'draft' }).drafts).toHaveLength(2);
    expect(listDrafts(db, 'local').drafts.map((item) => item.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );

    const updated = updateDraft(db, 'local', first.id, {
      title: '改过的标题',
      markdown: '# 改过的标题\n\n新正文 [f1]',
      status: 'exported',
    });
    expect(updated?.title).toBe('改过的标题');
    expect(updated?.status).toBe('exported');

    expect(softDeleteDraft(db, 'local', first.id)).toBe(true);
    expect(getDraft(db, 'local', first.id)).toBeNull();
    expect(getDraft(db, 'local', first.id, { includeDeleted: true })?.deletedAt).toBeTruthy();
    expect(listDrafts(db, 'local').total).toBe(1);

    expect(restoreDraft(db, 'local', first.id)?.deletedAt).toBeNull();
    expect(listDrafts(db, 'local').total).toBe(2);
  });
});

describe('draft export', () => {
  it('adds frontmatter and a source appendix', () => {
    const draft = {
      id: 'd1',
      ownerId: 'local',
      synthesisRunId: 'r1',
      title: '一篇草稿',
      slug: 'draft-one',
      markdown: '# 一篇草稿\n\n正文 [f1]',
      citations: [
        {
          token: 'f1',
          fragmentId: 'a',
          title: '来源标题',
          url: 'https://example.com/post',
          quote: '来源原文',
        },
      ],
      status: 'draft' as const,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      deletedAt: null,
    };
    const output = buildDraftExport(draft, new Date('2026-10-28T00:00:00.000Z'));
    expect(output).toContain('title: "一篇草稿"');
    expect(output).toContain('date: 2026-10-28');
    expect(output).toContain('## 来源');
    expect(output).toContain('[f1] [来源标题](https://example.com/post)');
    expect(output).not.toContain('# 一篇草稿');
    expect(exportFilename(draft)).toBe('draft-one.md');
  });
});
