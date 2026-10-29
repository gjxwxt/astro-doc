import type { Fragment } from '@/lib/db/fragments';

export interface SynthesisPlan {
  title: string;
  clusters: Cluster[];
  outline: OutlineSection[];
  mode: 'ai' | 'structure';
  warnings: string[];
}

export interface Cluster {
  id: string;
  title: string;
  summary: string;
  fragmentIds: string[];
}

export interface OutlineSection {
  heading: string;
  clusterId: string;
  intent: string;
}

export interface Citation {
  token: string;
  fragmentId: string;
  title: string;
  url: string;
  quote: string;
}

export interface RawPlan {
  title?: unknown;
  clusters?: unknown;
  outline?: unknown;
}

export function tokenFor(index: number): string {
  return `f${index + 1}`;
}

export function fragmentTokens(fragments: Fragment[]): Map<string, string> {
  const map = new Map<string, string>();
  fragments.forEach((fragment, index) => map.set(fragment.id, tokenFor(index)));
  return map;
}

export function reverseTokens(fragments: Fragment[]): Map<string, Fragment> {
  const map = new Map<string, Fragment>();
  fragments.forEach((fragment, index) => map.set(tokenFor(index), fragment));
  return map;
}

export function fragmentContent(fragment: Fragment): string {
  const preview = fragment.metadata?.preview;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    const description = (preview as { description?: unknown }).description;
    if (typeof description === 'string' && description.trim().length > 0) {
      return description.replace(/^\s*>\s?/gm, '').trim();
    }
  }
  return fragment.quote.replace(/^\s*>\s?/gm, '').trim();
}

export function normalizeForDedupe(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”"'‘’]/g, '')
    .trim();
}

export function dedupeFragments(fragments: Fragment[]): {
  unique: Fragment[];
  duplicateIds: string[];
} {
  const seen = new Map<string, string>();
  const unique: Fragment[] = [];
  const duplicateIds: string[] = [];

  for (const fragment of fragments) {
    const key = normalizeForDedupe(fragment.quote);
    const existing = seen.get(key);
    if (existing) {
      duplicateIds.push(fragment.id);
      continue;
    }
    seen.set(key, fragment.id);
    unique.push(fragment);
  }

  return { unique, duplicateIds };
}

function excerpt(value: string, max = 90): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function localPlan(fragments: Fragment[]): SynthesisPlan {
  const byTag = new Map<string, Fragment[]>();
  for (const fragment of fragments) {
    const tag = fragment.tags[0] || '';
    const key = tag || '__untagged';
    const list = byTag.get(key) ?? [];
    list.push(fragment);
    byTag.set(key, list);
  }

  let groups = [...byTag.entries()];
  if (groups.length === 1 && fragments.length > 3) {
    groups = chunk(fragments, Math.ceil(fragments.length / 2)).map((items, index) => [
      `__part-${index + 1}`,
      items,
    ]);
  }

  const clusters: Cluster[] = groups.slice(0, 5).map(([key, items], index) => {
    const title =
      key === '__untagged' || key.startsWith('__part-')
        ? `线索 ${index + 1}`
        : key.slice(0, 40);
    return {
      id: `c${index + 1}`,
      title,
      summary: excerpt(items.map((item) => fragmentContent(item)).join(' · '), 140),
      fragmentIds: items.map((item) => item.id),
    };
  });

  const assigned = new Set(clusters.flatMap((cluster) => cluster.fragmentIds));
  const leftovers = fragments.filter((fragment) => !assigned.has(fragment.id));
  if (leftovers.length > 0) {
    if (clusters.length === 0) {
      clusters.push({
        id: 'c1',
        title: '未分类',
        summary: excerpt(leftovers.map((item) => fragmentContent(item)).join(' · '), 140),
        fragmentIds: leftovers.map((item) => item.id),
      });
    } else {
      clusters[clusters.length - 1].fragmentIds.push(...leftovers.map((item) => item.id));
    }
  }

  const outline: OutlineSection[] = clusters.map((cluster) => ({
    heading: cluster.title,
    clusterId: cluster.id,
    intent: '把这一组碎片里的共同线索写清楚，并保留原始出处。',
  }));

  return {
    title: `碎片合成 · ${new Date().toLocaleDateString('zh-CN')}`,
    clusters,
    outline,
    mode: 'structure',
    warnings: ['没有使用 AI，这是按标签和原始顺序整理的结构草稿。'],
  };
}

function asString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function normalizePlan(
  raw: RawPlan,
  fragments: Fragment[],
  fallback: SynthesisPlan,
): SynthesisPlan {
  const tokenMap = reverseTokens(fragments);
  const validIds = new Set(fragments.map((fragment) => fragment.id));
  const rawClusters = Array.isArray(raw.clusters) ? raw.clusters : [];
  const clusters: Cluster[] = [];

  for (const [index, item] of rawClusters.slice(0, 6).entries()) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const fragmentIds: string[] = [];
    for (const token of toStringList(value.fragmentIds)) {
      const fragment = tokenMap.get(token.toLowerCase());
      const id = fragment?.id ?? token;
      if (validIds.has(id) && !fragmentIds.includes(id)) fragmentIds.push(id);
    }
    if (fragmentIds.length === 0) continue;
    const title = asString(value.title, 80) || `线索 ${index + 1}`;
    clusters.push({
      id: asString(value.id, 40) || `c${clusters.length + 1}`,
      title,
      summary: asString(value.summary, 240) || excerpt(fragmentIds.join(' '), 140),
      fragmentIds,
    });
  }

  const assigned = new Set(clusters.flatMap((cluster) => cluster.fragmentIds));
  const leftovers = fragments.filter((fragment) => !assigned.has(fragment.id));
  if (leftovers.length > 0) {
    if (clusters.length === 0) {
      clusters.push({
        id: 'c1',
        title: '共同线索',
        summary: excerpt(leftovers.map((item) => fragmentContent(item)).join(' · '), 140),
        fragmentIds: leftovers.map((item) => item.id),
      });
    } else {
      clusters[clusters.length - 1].fragmentIds.push(...leftovers.map((item) => item.id));
    }
  }

  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const outline: OutlineSection[] = [];
  const rawOutline = Array.isArray(raw.outline) ? raw.outline : [];
  for (const item of rawOutline.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const heading = asString(value.heading, 100);
    if (!heading) continue;
    const rawCluster = asString(value.clusterId, 40);
    const clusterId = clusterIds.has(rawCluster) ? rawCluster : clusters[0]?.id;
    if (!clusterId) continue;
    outline.push({
      heading,
      clusterId,
      intent: asString(value.intent, 300),
    });
  }

  if (outline.length === 0) {
    for (const cluster of clusters) {
      outline.push({
        heading: cluster.title,
        clusterId: cluster.id,
        intent: '把这一组碎片里的共同线索写清楚，并保留原始出处。',
      });
    }
  }

  return {
    title: asString(raw.title, 120) || fallback.title,
    clusters,
    outline,
    mode: 'ai',
    warnings: [],
  };
}

export function buildPlanPrompt(fragments: Fragment[]): string {
  const tokens = fragmentTokens(fragments);
  const list = fragments
    .map((fragment) => {
      const tag = fragment.tags.length > 0 ? `标签：${fragment.tags.join('、')}` : '无标签';
      const note = fragment.note ? `\n随想：${fragment.note}` : '';
      return `[${tokens.get(fragment.id)}] ${fragment.sourceTitle || fragment.sourceSite || '无标题'}（${tag}）\n${fragmentContent(fragment).slice(0, 1_200)}${note}`;
    })
    .join('\n\n');

  return [
    '把下面的碎片整理成一篇中文文章的编辑计划。',
    '只输出 JSON，不要 Markdown 代码围栏，不要解释。',
    'JSON 结构：',
    '{"title":"文章标题","clusters":[{"id":"c1","title":"聚类名","summary":"一句话","fragmentIds":["f1","f2"]}],"outline":[{"heading":"小节标题","clusterId":"c1","intent":"这一节要回答什么"}]}',
    '要求：',
    '- 聚类 2–4 组，每组至少 1 条碎片，不能丢碎片；',
    '- 大纲 2–5 节，按论证顺序排，不要写“引言/结论”这种空壳；',
    '- 标题具体一点，不要用“碎片合成”这种占位词；',
    '- 只能使用给定的 f 编号。',
    '',
    '碎片：',
    list,
  ].join('\n');
}

export function buildSectionPrompt(
  plan: SynthesisPlan,
  section: OutlineSection,
  fragments: Fragment[],
  previous: string,
): string {
  const tokens = fragmentTokens(fragments);
  const cluster = plan.clusters.find((item) => item.id === section.clusterId);
  const clusterIds = new Set(cluster?.fragmentIds ?? []);
  const related = fragments.filter((fragment) => clusterIds.has(fragment.id));
  const all = fragments
    .map((fragment) => `[${tokens.get(fragment.id)}] ${fragmentContent(fragment).slice(0, 1_000)}`)
    .join('\n\n');
  const relatedText = related
    .map(
      (fragment) =>
        `[${tokens.get(fragment.id)}] ${fragment.sourceTitle || fragment.sourceSite || '无标题'}\n${fragmentContent(fragment).slice(0, 1_000)}${fragment.note ? `\n随想：${fragment.note}` : ''}`,
    )
    .join('\n\n');

  return [
    `全文标题：${plan.title}`,
    `这一节标题：${section.heading}`,
    `写作意图：${section.intent || '把这一组碎片里的共同线索写清楚。'}`,
    '',
    '要求：',
    '- 写中文，直接给正文，不要重复小节标题，不要写“作为 AI”；',
    '- 每 1–2 个自然段至少出现一次来源标记，例如 [f1]；',
    '- 只能使用下面给出的 f 编号，不能编造新编号；',
    '- 观点要落在碎片上，不要写空泛的总结；',
    '- 篇幅 300–700 字。',
    '',
    '这一节相关碎片：',
    relatedText || all,
    '',
    '全文可用碎片（只用来理解上下文）：',
    all,
    previous ? `\n上一节正文（仅供衔接）：\n${previous.slice(-1_200)}` : '',
  ].join('\n');
}

export function buildHumanizePrompt(markdown: string, fragments: Fragment[]): string {
  const tokens = [...fragmentTokens(fragments).values()].join('、');
  return [
    '把下面的中文文章做一次自然化润色：去掉空话、模板句、重复和过度对仗，保留作者原来的判断。',
    '不要改事实，不要增加新事实，不要改标题层级，不要输出解释，只输出润色后的 Markdown。',
    `必须严格保留所有来源标记（${tokens}），一个都不能新增、丢失或改名。`,
    '',
    markdown,
  ].join('\n');
}

export function citationTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  for (const match of markdown.matchAll(/\[(f\d+)\]/gi)) tokens.add(match[1].toLowerCase());
  return [...tokens];
}

export function citationSet(markdown: string, allowed: Set<string>): Set<string> {
  const set = new Set<string>();
  for (const token of citationTokens(markdown)) {
    if (allowed.has(token)) set.add(token);
  }
  return set;
}

export function sameCitationSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const token of a) if (!b.has(token)) return false;
  return true;
}

export function replaceInvalidCitations(markdown: string, allowed: Set<string>): {
  markdown: string;
  invalid: string[];
} {
  const invalid: string[] = [];
  const next = markdown.replace(/\[(f\d+)\]/gi, (_whole, token: string) => {
    const normalized = token.toLowerCase();
    if (allowed.has(normalized)) return `[${normalized}]`;
    if (!invalid.includes(normalized)) invalid.push(normalized);
    return '[?]';
  });
  return { markdown: next, invalid };
}

export function ensureParagraphCitations(markdown: string): {
  markdown: string;
  missing: number;
} {
  let missing = 0;
  const blocks = markdown.split(/\n{2,}/);
  const next = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return block;
    if (/^#{1,6}\s/.test(trimmed)) return block;
    if (/^```/.test(trimmed)) return block;
    if (/\[(?:f\d+|\?)\]/i.test(trimmed)) return block;
    missing += 1;
    return `${block.trimEnd()} [?]`;
  });
  return { markdown: next.join('\n\n'), missing };
}

export function citationsFor(markdown: string, fragments: Fragment[]): Citation[] {
  const byToken = reverseTokens(fragments);
  const result: Citation[] = [];
  for (const token of citationTokens(markdown)) {
    const fragment = byToken.get(token);
    if (!fragment) continue;
    result.push({
      token,
      fragmentId: fragment.id,
      title: fragment.sourceTitle || fragment.sourceSite || '未命名来源',
      url: fragment.sourceUrl,
      quote: excerpt(fragmentContent(fragment), 160),
    });
  }
  return result;
}

export function structureMarkdown(plan: SynthesisPlan, fragments: Fragment[]): string {
  const tokens = fragmentTokens(fragments);
  const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
  const sections = plan.outline.map((section) => {
    const cluster = plan.clusters.find((item) => item.id === section.clusterId);
    const items = (cluster?.fragmentIds ?? [])
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
    const body = items
      .map((fragment) => {
        const source = fragment.sourceTitle || fragment.sourceSite || '来源';
        const note = fragment.note ? `\n\n随想：${fragment.note}` : '';
        return `> ${fragmentContent(fragment).replace(/\n+/g, '\n> ')}\n>\n> — ${source} [${tokens.get(fragment.id)}]${note}`;
      })
      .join('\n\n');
    return `## ${section.heading}\n\n${body}`;
  });
  return [`# ${plan.title}`, '', ...sections].join('\n\n');
}
