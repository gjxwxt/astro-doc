import { markdownToText, stripLeadingTitle } from '../../src/lib/markdown';

export { stripLeadingTitle };

export interface TransformOptions {
  body: string;
  title: string;
  slug: string;
  noteSlugByKey: Map<string, string>;
  resolveAsset: (target: string) => string | null;
  warn: (message: string) => void;
}

export function slugify(input: string): string {
  const value = input
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return value || 'note';
}

export function normalizeTags(value: unknown, defaults: string[] = []): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/) : [];
  const tags = [...defaults, ...raw]
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
  return [...new Set(tags)];
}

export function toDay(value: unknown, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return fallback.toISOString().slice(0, 10);
}

export function stripObsidianComments(body: string): string {
  return body.replace(/%%[\s\S]*?%%/g, '');
}

export function convertCallouts(body: string): string {
  return body.replace(/^>[ \t]*\[!([^\]]+)\][+-]?[ \t]*(.*)$/gm, (_, type: string, title: string) => {
    const label = title.trim() || type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    return `> **${label}**`;
  });
}

function isImage(target: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(target);
}

export function convertEmbeds(body: string, options: TransformOptions): string {
  return body.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => {
    const cleaned = target.trim();
    if (isImage(cleaned)) {
      const url = options.resolveAsset(cleaned);
      if (!url) {
        options.warn(`找不到图片附件：${cleaned}`);
        return _match;
      }
      const altSource = alias && !/^\d+$/.test(alias) ? alias : (cleaned.split('/').at(-1) ?? cleaned);
      const alt = altSource.replace(/\.[^.]+$/, '');
      return `![${alt}](${url})`;
    }

    const key = cleaned.replace(/\.md$/i, '').split('/').at(-1)?.toLowerCase() ?? '';
    const slug = options.noteSlugByKey.get(key);
    if (!slug) {
      options.warn(`嵌入的笔记不在同步范围：${cleaned}`);
      return `[[${cleaned}${alias ? `|${alias}` : ''}]]`;
    }
    return `[${alias ?? cleaned}](/notes/${slug}/)`;
  });
}

export function convertWikilinks(body: string, options: TransformOptions): string {
  return body.replace(
    /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, heading?: string, alias?: string) => {
      const cleaned = target.trim();
      const key = cleaned.replace(/\.md$/i, '').split('/').at(-1)?.toLowerCase() ?? '';
      const slug = options.noteSlugByKey.get(key);
      if (!slug) {
        options.warn(`链接目标不在同步范围：${cleaned}`);
        return alias ?? cleaned;
      }
      const anchor = heading ? `#${heading.slice(1).trim().replace(/\s+/g, '-')}` : '';
      return `[${alias ?? cleaned}](/notes/${slug}/${anchor})`;
    },
  );
}

export function transformBody(options: TransformOptions): string {
  let body = options.body.replace(/\r\n/g, '\n');
  body = stripLeadingTitle(body, options.title);
  body = stripObsidianComments(body);
  body = convertCallouts(body);
  body = convertEmbeds(body, options);
  body = convertWikilinks(body, options);
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body ? `${body}\n` : '';
}

export function describe(body: string, length = 150): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .filter((paragraph) => !/^\s*(?:[>#*|!-]|\d+\.)/.test(paragraph))
    .map((paragraph) => markdownToText(paragraph).replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
  const text = paragraphs.find((paragraph) => paragraph.length >= 6) ?? paragraphs[0] ?? '';
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

export function frontmatterFor(options: {
  title: string;
  description: string;
  date: string;
  updated: string;
  tags: string[];
  draft: boolean;
  featured: boolean;
  source: string;
}): string {
  const lines = ['---', `title: ${JSON.stringify(options.title)}`];
  if (options.description) lines.push(`description: ${JSON.stringify(options.description)}`);
  lines.push(`date: ${options.date}`);
  if (options.updated && options.updated !== options.date) lines.push(`updated: ${options.updated}`);
  if (options.tags.length > 0) lines.push(`tags: ${JSON.stringify(options.tags)}`);
  if (options.draft) lines.push('draft: true');
  if (options.featured) lines.push('featured: true');
  lines.push(`source: ${JSON.stringify(options.source)}`);
  lines.push('---', '');
  return lines.join('\n');
}
