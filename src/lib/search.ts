export type SearchDocType = 'note' | 'doc' | 'library' | 'tool' | 'page';

export interface SearchDoc {
  id: string;
  type: SearchDocType;
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  date?: string;
  body?: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  snippet: string;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_RE = /[a-z0-9][a-z0-9'’._+-]*/gi;
const QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  '的',
  '了',
  '和',
  '与',
  '是',
  '在',
  '有',
  '我',
  '你',
]);

/**
 * Latin words + CJK bigrams. Chinese has no spaces, so bigrams are a cheap
 * and surprisingly effective substitute for a segmenter.
 */
export function tokenize(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];

  for (const match of text.matchAll(LATIN_RE)) {
    const token = match[0];
    if (token.length > 1) tokens.push(token);
  }

  for (const match of text.matchAll(CJK_RE)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }

  return tokens;
}

export function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of tokenize(query)) {
    if (QUERY_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function countTokens(text: string, tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (!text) return counts;
  const haystack = text.normalize('NFKC').toLowerCase();
  for (const token of tokens) {
    let index = 0;
    let count = 0;
    while ((index = haystack.indexOf(token, index)) !== -1) {
      count += 1;
      index += token.length;
    }
    if (count > 0) counts.set(token, count);
  }
  return counts;
}

function makeSnippet(doc: SearchDoc, tokens: string[], limit = 150): string {
  const source = doc.body || doc.description || '';
  if (!source) return '';
  const normalized = source.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    at = lower.indexOf(token);
    if (at !== -1) break;
  }
  if (at === -1) return normalized.slice(0, limit);
  const start = Math.max(0, at - 55);
  const end = Math.min(normalized.length, start + limit);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end).trim()}${
    end < normalized.length ? '…' : ''
  }`;
}

export function searchDocs(docs: SearchDoc[], query: string, limit = 12): SearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const documentCount = Math.max(docs.length, 1);
  const df = new Map<string, number>();
  const prepared = docs.map((doc) => {
    const title = countTokens(doc.title, tokens);
    const tags = countTokens((doc.tags ?? []).join(' '), tokens);
    const description = countTokens(doc.description ?? '', tokens);
    const body = countTokens(doc.body ?? '', tokens);
    for (const token of new Set([...title.keys(), ...tags.keys(), ...description.keys(), ...body.keys()])) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
    return { doc, title, tags, description, body };
  });

  const idf = new Map<string, number>();
  for (const token of tokens) {
    idf.set(token, Math.log(1 + documentCount / Math.max(1, df.get(token) ?? 1)));
  }

  const phrase = query.normalize('NFKC').toLowerCase().trim();
  const hits: SearchHit[] = [];

  for (const item of prepared) {
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const weight = idf.get(token) ?? 0;
      const fieldScore =
        (item.title.get(token) ?? 0) * 12 +
        (item.tags.get(token) ?? 0) * 8 +
        (item.description.get(token) ?? 0) * 4 +
        (item.body.get(token) ?? 0) * 1;
      if (fieldScore > 0) matched += 1;
      score += fieldScore * weight;
    }
    if (matched === 0) continue;

    if (phrase.length > 1) {
      const title = item.doc.title.toLowerCase();
      if (title.includes(phrase)) score += 40;
      if ((item.doc.description ?? '').toLowerCase().includes(phrase)) score += 12;
    }

    // Prefer pages whose title covers all query tokens.
    if (matched === tokens.length) score *= 1.35;

    hits.push({ doc: item.doc, score, snippet: makeSnippet(item.doc, tokens) });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = [...new Set(queryTokens(query))].sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return [{ text, match: false }];

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let index = 0;
    while ((index = lower.indexOf(token, index)) !== -1) {
      ranges.push([index, index + token.length]);
      index += token.length;
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
