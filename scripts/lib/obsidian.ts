import fs from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';
import YAML from 'yaml';

import {
  convertCallouts,
  describe,
  normalizeTags,
  slugify,
  stripLeadingTitle,
  stripObsidianComments,
} from './sync';

export interface SectionConfig {
  id: string;
  title: string;
  order: number;
}

export interface FolderRule {
  prefix: string;
  section: string;
  tag?: string;
}

export interface SiteConfig {
  sections: Record<string, SectionConfig>;
  folders: FolderRule[];
}

export interface SourceDoc {
  relPath: string;
  title: string;
  data: Record<string, unknown>;
  body: string;
  rule: FolderRule;
  section: SectionConfig;
  outputId: string;
  rewrittenBody?: string;
  explicitDescription: boolean;
}

export interface SyncResult {
  config: SiteConfig;
  docs: Array<{
    relPath: string;
    outputId: string;
    title: string;
    section: string;
    tags: string[];
  }>;
  warnings: string[];
  outDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanPrefix(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function safeSegment(input: string): string {
  return (
    input
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function dayValue(value: unknown, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return fallback.toISOString().slice(0, 10);
}

function firstHeading(body: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function isPublished(data: Record<string, unknown>): boolean {
  return data.publish === true || data.publish === 'true' || data.public === true;
}

export function parseSiteConfig(raw: string): SiteConfig {
  const parsed: unknown = YAML.parse(raw);
  if (!isRecord(parsed)) throw new Error('site.config.yml 必须是 YAML 对象');

  const sections: Record<string, SectionConfig> = {};
  if (isRecord(parsed.sections)) {
    for (const [id, value] of Object.entries(parsed.sections)) {
      const sectionId = stringValue(id);
      if (!sectionId) continue;
      const object = isRecord(value) ? value : {};
      sections[sectionId] = {
        id: sectionId,
        title: stringValue(object.title) ?? stringValue(value) ?? sectionId,
        order: Number(object.order) || 999,
      };
    }
  }

  const folders: FolderRule[] = [];
  if (isRecord(parsed.folders)) {
    for (const [rawPrefix, value] of Object.entries(parsed.folders)) {
      const prefix = cleanPrefix(rawPrefix);
      if (!prefix) continue;
      const object = isRecord(value) ? value : {};
      const section = stringValue(object.section) ?? stringValue(value);
      if (!section) throw new Error(`文件夹 ${rawPrefix} 缺少 section`);
      const tag = stringValue(object.tag);
      if (!sections[section]) {
        sections[section] = { id: section, title: section, order: 999 };
      }
      folders.push({ prefix, section, ...(tag ? { tag } : {}) });
    }
  }

  folders.sort((a, b) => b.prefix.length - a.prefix.length);
  return { sections, folders };
}

export function folderRuleFor(relPath: string, config: SiteConfig): FolderRule | undefined {
  const normalized = relPath.replace(/\\/g, '/');
  return config.folders.find(
    (rule) => normalized === rule.prefix || normalized.startsWith(`${rule.prefix}/`),
  );
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.obsidian' || entry.name === '.trash') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function localImagePlaceholder(target: string): string {
  const name = target.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? target;
  return `*[图片：${name}]*`;
}

function headingAnchor(heading: string): string {
  return heading
    .trim()
    .replace(/^#/, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function rewriteLibraryBody(
  body: string,
  options: {
    title: string;
    linkMap: Map<string, string>;
    warn: (message: string) => void;
  },
): string {
  let result = body.replace(/\r\n/g, '\n');
  result = stripLeadingTitle(result, options.title);
  result = stripObsidianComments(result);
  result = convertCallouts(result);

  // First pass: local image embeds. Remote images are kept for the day an image
  // host is configured; local attachments are intentionally dropped in v1.
  result = result.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => {
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(target.trim())) {
      options.warn(`本地图片未同步：${target.trim()}`);
      return localImagePlaceholder(alias || target.trim());
    }
    return alias ?? target.trim();
  });

  result = result.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/|data:)([^)]+)\)/g,
    (_match, alt: string, target: string) => {
      options.warn(`本地图片未同步：${target}`);
      return `*[图片：${alt || target}]*`;
    },
  );

  result = result.replace(
    /\[\[([^\]|#]*)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, heading?: string, alias?: string) => {
      const cleaned = target.trim();
      if (!cleaned) {
        const label = alias ?? heading?.slice(1) ?? '';
        return heading ? `[${label}](#${headingAnchor(heading)})` : label;
      }
      const key = cleaned.replace(/\.md$/i, '').split('/').at(-1)?.toLowerCase() ?? '';
      const outputId = options.linkMap.get(key);
      if (!outputId) {
        options.warn(`链接目标未发布：${cleaned}`);
        return alias ?? cleaned;
      }
      const anchor = heading ? `#${headingAnchor(heading)}` : '';
      return `[${alias ?? cleaned}](/library/${outputId}/${anchor})`;
    },
  );

  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result ? `${result}\n` : '';
}

export async function collectLibrary(
  sourceDir: string,
  config: SiteConfig,
  warn: (message: string) => void,
): Promise<SourceDoc[]> {
  const files: string[] = [];
  await walk(sourceDir, sourceDir, files);

  const used = new Set<string>();
  const docs: SourceDoc[] = [];

  for (const relPath of files.sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    const rule = folderRuleFor(relPath, config);
    if (!rule) continue;

    const fullPath = path.join(sourceDir, relPath);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = matter(raw);
    if (!isPublished(parsed.data)) continue;

    const section = config.sections[rule.section];
    if (!section) continue;

    const stat = await fs.stat(fullPath);
    const fallbackDate = stat.mtime;
    const title =
      stringValue(parsed.data.title) ??
      stringValue(parsed.data.name) ??
      firstHeading(parsed.content) ??
      path.basename(relPath, '.md');

    const baseSlug = slugify(path.basename(relPath, '.md'));
    const outputId = uniqueId(`${safeSegment(section.id)}/${baseSlug}`, used);
    const tags = normalizeTags(parsed.data.tags, rule.tag ? [rule.tag] : []);
    const explicitDescription = Boolean(stringValue(parsed.data.description));

    const data: Record<string, unknown> = {
      title,
      ...(explicitDescription
        ? { description: stringValue(parsed.data.description) }
        : { description: describe(parsed.content, 150) }),
      date: dayValue(parsed.data.created ?? parsed.data.date, fallbackDate),
      updated: dayValue(parsed.data.updated, fallbackDate),
      tags,
      section: section.id,
      sectionTitle: section.title,
      sectionOrder: section.order,
      ...(stringValue(parsed.data.type) ? { kind: stringValue(parsed.data.type) } : {}),
      ...(stringValue(parsed.data.source_url) ? { sourceUrl: stringValue(parsed.data.source_url) } : {}),
      sourcePath: relPath,
    };

    docs.push({
      relPath,
      title,
      data,
      body: parsed.content,
      rule,
      section,
      outputId,
      explicitDescription,
    });
  }

  const linkMap = new Map<string, string>();
  for (const doc of docs) {
    const key = doc.relPath.replace(/\.md$/i, '').split('/').at(-1)?.toLowerCase();
    if (key) linkMap.set(key, doc.outputId);
  }

  for (const doc of docs) {
    doc.rewrittenBody = rewriteLibraryBody(doc.body, {
      title: doc.title,
      linkMap,
      warn,
    });
    if (!doc.explicitDescription) {
      doc.data.description = describe(doc.rewrittenBody, 150);
    }
  }

  return docs;
}

export async function syncObsidian(options: {
  sourceDir: string;
  outDir: string;
  dry?: boolean;
}): Promise<SyncResult> {
  const configPath = path.join(options.sourceDir, 'site.config.yml');
  const config = parseSiteConfig(await fs.readFile(configPath, 'utf8'));
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const docs = await collectLibrary(options.sourceDir, config, warn);

  if (!options.dry) {
    await fs.rm(options.outDir, { recursive: true, force: true });
    await fs.mkdir(options.outDir, { recursive: true });
    await fs.writeFile(path.join(options.outDir, '.gitkeep'), '', 'utf8');

    for (const doc of docs) {
      const target = path.join(options.outDir, `${doc.outputId}.md`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const rewritten = doc.rewrittenBody ?? doc.body;
      await fs.writeFile(target, matter.stringify(rewritten, doc.data), 'utf8');
    }
  }

  return {
    config,
    docs: docs.map((doc) => ({
      relPath: doc.relPath,
      outputId: doc.outputId,
      title: doc.title,
      section: doc.section.title,
      tags: (doc.data.tags as string[] | undefined) ?? [],
    })),
    warnings: [...new Set(warnings)],
    outDir: options.outDir,
  };
}
