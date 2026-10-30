import type { Fragment } from './db/fragments';
import { AiError, aiRuntime, chatJson } from './synthesis/ai';

export interface DuplicateSuggestion {
  id: string;
  quote: string;
  sourceUrl: string;
  score: number;
  reason: string;
}

export interface OrganizeSuggestion {
  mode: 'ai' | 'rules';
  summary: string;
  tags: string[];
  duplicates: DuplicateSuggestion[];
  notice?: string;
}

export interface OrganizeOptions {
  fragment: Fragment;
  candidates: Fragment[];
  knownTags: Array<{ tag: string; count: number }>;
  env?: Record<string, string | undefined>;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'have',
  'your',
  'about',
  'http',
  'https',
  'www',
  'com',
  'image',
  'photo',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  '这个',
  '那个',
  '我们',
  '你们',
  '他们',
  '自己',
  '一个',
  '一些',
  '可以',
  '就是',
  '没有',
  '因为',
  '所以',
  '但是',
  '如果',
  '然后',
  '什么',
  '已经',
  '还是',
  '只是',
  '这样',
  '那样',
  '比较',
  '非常',
  '东西',
]);

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(value: string, length: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

export function summarizeRules(fragment: Fragment): string {
  const metadata = fragment.metadata;
  const image = recordOf(metadata.image);
  const preview = recordOf(metadata.preview);
  const title = textOf(preview.title) || fragment.sourceTitle;
  const description = textOf(preview.description);
  const quote = fragment.quote || textOf(image.alt);

  if (fragment.kind === 'link') {
    return clip([title, description].filter(Boolean).join('：') || quote || fragment.note, 140);
  }
  if (fragment.kind === 'image') {
    return clip([textOf(image.alt), quote, fragment.note].filter(Boolean).join(' · '), 140);
  }
  return clip(quote || fragment.note || title, 140);
}

function addTag(tags: string[], value: string): void {
  const tag = value
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .slice(0, 24);
  if (tag.length < 2 || STOPWORDS.has(tag.toLowerCase())) return;
  if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
}

export function suggestTagsRules(
  fragment: Fragment,
  knownTags: Array<{ tag: string; count: number }> = [],
): string[] {
  const metadata = fragment.metadata;
  const image = recordOf(metadata.image);
  const preview = recordOf(metadata.preview);
  const text = [
    fragment.quote,
    fragment.note,
    fragment.sourceTitle,
    fragment.sourceSite,
    fragment.contextBefore,
    fragment.contextAfter,
    textOf(image.alt),
    textOf(preview.title),
    textOf(preview.description),
  ]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeText(text);
  const tags: string[] = [];

  for (const item of knownTags) {
    const tag = item.tag.trim();
    if (tag.length >= 2 && normalized.includes(normalizeText(tag))) addTag(tags, tag);
    if (tags.length >= 3) return tags;
  }

  for (const match of text.matchAll(/#([\p{Letter}\p{Number}_-]{2,24})/gu)) {
    addTag(tags, match[1] ?? '');
    if (tags.length >= 3) return tags;
  }

  const frequency = new Map<string, number>();
  const addKeyword = (value: string): void => {
    const key = value.toLowerCase();
    if (key.length < 2 || key.length > 24 || STOPWORDS.has(key)) return;
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  };
  for (const match of normalized.matchAll(/[a-z][a-z0-9-]{2,23}/g)) addKeyword(match[0]);
  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,8}/g)) {
    const run = match[0];
    for (let index = 0; index < run.length - 1 && index < 4; index += 1) {
      addKeyword(run.slice(index, index + 2));
    }
    if (run.length >= 3) addKeyword(run.slice(0, 3));
  }

  for (const [keyword] of [...frequency.entries()].sort((a, b) => b[1] - a[1])) {
    addTag(tags, keyword);
    if (tags.length >= 3) break;
  }
  return tags;
}

function compareText(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 6 || b.length < 6) return a.includes(b) || b.includes(a) ? 0.85 : 0;
  const bigrams = (value: string): Set<string> => {
    const result = new Set<string>();
    const source = value.replace(/\s+/g, '');
    for (let index = 0; index < source.length - 1; index += 1) {
      result.add(source.slice(index, index + 2));
    }
    return result;
  };
  const first = bigrams(a.slice(0, 900));
  const second = bigrams(b.slice(0, 900));
  let intersection = 0;
  for (const item of first) if (second.has(item)) intersection += 1;
  const union = first.size + second.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function imageSrcOf(fragment: Fragment): string {
  return textOf(recordOf(recordOf(fragment.metadata).image).src);
}

export function findDuplicatesRules(
  fragment: Fragment,
  candidates: Fragment[],
): DuplicateSuggestion[] {
  const source = imageSrcOf(fragment);
  const sourceUrl = fragment.sourceUrl.trim();
  const results: DuplicateSuggestion[] = [];

  for (const candidate of candidates) {
    if (candidate.id === fragment.id) continue;
    const candidateImage = imageSrcOf(candidate);
    const textScore = compareText(
      [fragment.quote, textOf(recordOf(fragment.metadata.image).alt)].join(' '),
      [candidate.quote, textOf(recordOf(candidate.metadata.image).alt)].join(' '),
    );
    let score = textScore;
    let reason = '文字内容相似';
    if (source && candidateImage && source === candidateImage) {
      score = 1;
      reason = '同一张图片地址';
    } else if (sourceUrl && candidate.sourceUrl.trim() === sourceUrl && textScore >= 0.35) {
      score = Math.max(score, 0.78);
      reason = '同一来源页面';
    }
    if (score < 0.58) continue;
    results.push({
      id: candidate.id,
      quote: clip(candidate.quote || candidate.sourceTitle || '无标题碎片', 100),
      sourceUrl: candidate.sourceUrl,
      score: Math.round(score * 100) / 100,
      reason: score >= 0.9 ? '内容几乎相同' : reason,
    });
  }

  return results.sort((left, right) => right.score - left.score).slice(0, 3);
}

export function organizeRules(options: {
  fragment: Fragment;
  candidates: Fragment[];
  knownTags?: Array<{ tag: string; count: number }>;
}): OrganizeSuggestion {
  const { fragment, candidates, knownTags = [] } = options;
  return {
    mode: 'rules',
    summary: summarizeRules(fragment),
    tags: suggestTagsRules(fragment, knownTags),
    duplicates: findDuplicatesRules(fragment, candidates),
  };
}

interface AiOrganizeResult {
  summary?: unknown;
  tags?: unknown;
  duplicateIds?: unknown;
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    addTag(tags, item);
    if (tags.length >= 3) break;
  }
  return tags;
}

function renderFragmentForAi(fragment: Fragment): string {
  const image = recordOf(fragment.metadata.image);
  const preview = recordOf(fragment.metadata.preview);
  return JSON.stringify({
    id: fragment.id,
    kind: fragment.kind,
    quote: clip(fragment.quote, 600),
    note: clip(fragment.note, 300),
    sourceUrl: fragment.sourceUrl,
    sourceTitle: fragment.sourceTitle,
    sourceSite: fragment.sourceSite,
    imageAlt: textOf(image.alt),
    previewTitle: textOf(preview.title),
    previewDescription: clip(textOf(preview.description), 300),
    tags: fragment.tags,
  });
}

export async function organizeFragment(options: OrganizeOptions): Promise<OrganizeSuggestion> {
  const rules = organizeRules(options);
  const env = options.env ?? process.env;
  const runtime = aiRuntime(env);
  if (env.AI_ENABLED === '0') {
    return { ...rules, notice: 'AI 当前未启用，当前为规则建议。' };
  }
  if (!runtime) {
    return { ...rules, notice: '未配置 AI key，当前为规则建议。' };
  }

  const candidates = options.candidates
    .filter((candidate) => candidate.id !== options.fragment.id)
    .slice(0, 30);
  const knownTags = options.knownTags.slice(0, 40).map((item) => item.tag);

  try {
    const result = await chatJson<AiOrganizeResult>(runtime, {
      system: [
        '你是 Josh 私人知识库的整理助手。',
        '只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。',
        '字段：summary（中文字符串，最多 80 字）、tags（最多 3 个短标签）、duplicateIds（候选里真正重复的碎片 id，最多 3 个）。',
        '摘要必须来自原文，不要编造。标签优先复用现有标签，其次从原文提取；不要输出过于宽泛的词。',
        '只有确认候选与当前碎片表达同一件事时才放入 duplicateIds。',
      ].join('\n'),
      user: [
        `现有标签：${knownTags.join('、') || '无'}`,
        `当前碎片：${renderFragmentForAi(options.fragment)}`,
        '候选碎片：',
        ...candidates.map(
          (candidate, index) =>
            `${index + 1}. ${renderFragmentForAi(candidate)}`,
        ),
      ].join('\n'),
      maxTokens: 900,
      temperature: 0.2,
    });

    const summary = textOf(result.summary).replace(/\s+/g, ' ').slice(0, 160);
    const tags = sanitizeTags(result.tags);
    const duplicateIds = Array.isArray(result.duplicateIds)
      ? result.duplicateIds.filter((value): value is string => typeof value === 'string')
      : [];
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const aiDuplicates: DuplicateSuggestion[] = [];
    for (const id of duplicateIds.slice(0, 3)) {
      const candidate = byId.get(id);
      if (!candidate) continue;
      aiDuplicates.push({
        id,
        quote: clip(candidate.quote || candidate.sourceTitle || '无标题碎片', 100),
        sourceUrl: candidate.sourceUrl,
        score: 1,
        reason: 'AI 判断为重复',
      });
    }

    return {
      mode: 'ai',
      summary: summary || rules.summary,
      tags: tags.length > 0 ? tags : rules.tags,
      duplicates: aiDuplicates.length > 0 ? aiDuplicates : rules.duplicates,
    };
  } catch (error) {
    const notice =
      error instanceof AiError
        ? `AI 暂时不可用（${error.message}），已用规则建议。`
        : 'AI 暂时不可用，已用规则建议。';
    return { ...rules, notice };
  }
}
