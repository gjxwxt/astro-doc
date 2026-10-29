import type { Draft } from '@/lib/db/syntheses';
interface CitationLike {
  token: string;
  title: string;
  url: string;
  quote: string;
}

function citationsOf(value: unknown[]): CitationLike[] {
  const result: CitationLike[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const token = typeof row.token === 'string' ? row.token.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    const quote = typeof row.quote === 'string' ? row.quote.trim() : '';
    if (!token) continue;
    result.push({ token, title: title || '来源', url, quote });
  }
  return result;
}

function safeUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function buildDraftExport(draft: Draft, date = new Date()): string {
  const title = draft.title.trim() || '未命名草稿';
  const body = draft.markdown.trim().replace(/^\s*#\s+.+\n+/, '').trim();
  const citations = citationsOf(draft.citations);
  const sourceLines = citations.map((citation) => {
    const url = safeUrl(citation.url);
    const label = url ? `[${citation.title}](${url})` : citation.title;
    const quote = citation.quote.replace(/\s+/g, ' ').slice(0, 180);
    return `- [${citation.token}] ${label}${quote ? ` — ${quote}` : ''}`;
  });

  const hasSourceSection = /^##\s+来源\s*$/m.test(body);
  const sourceSection =
    sourceLines.length > 0 && !hasSourceSection
      ? `## 来源\n\n${sourceLines.join('\n')}`
      : '';

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date.toISOString().slice(0, 10)}`,
    'tags: []',
    `status: ${draft.status}`,
    '---',
  ].join('\n');

  return [frontmatter, body, sourceSection].filter(Boolean).join('\n\n') + '\n';
}

export function exportFilename(draft: Draft): string {
  const base = draft.slug
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${base || 'draft'}.md`;
}
