import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import matter from 'gray-matter';

import {
  convertCallouts,
  convertEmbeds,
  convertWikilinks,
  describe,
  frontmatterFor,
  normalizeTags,
  slugify,
  stripObsidianComments,
  stripLeadingTitle,
  toDay,
  type TransformOptions,
} from './lib/sync';

interface SyncConfig {
  vault: string;
  folders: string[];
  target: string;
  assets: string;
  exclude: string[];
  defaultTags: string[];
}

interface State {
  version: 1;
  files: Record<string, { source: string; hash: string; syncedAt: string }>;
}

interface SourceNote {
  file: string;
  sourceRel: string;
  content: string;
  data: Record<string, unknown>;
  slug: string;
  title: string;
  mtime: Date;
  birthtime: Date;
}

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry') || args.has('--dry-run');
const force = args.has('--force');
const verbose = args.has('--verbose') || args.has('-v');
const shouldWatch = args.has('--watch') || args.has('-w');
let watchersStarted = false;

const defaults: SyncConfig = {
  vault: '',
  folders: ['Notes'],
  target: 'src/content/notes',
  assets: 'public/notes-assets',
  exclude: ['**/Templates/**', '**/*.excalidraw.md', '**/.obsidian/**', '**/.trash/**'],
  defaultTags: [],
};

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

async function loadConfig(): Promise<SyncConfig> {
  const file = path.join(cwd, 'content-sync.config.json');
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<SyncConfig>;
    return {
      ...defaults,
      ...parsed,
      vault: expandHome(parsed.vault ?? defaults.vault),
      folders: parsed.folders ?? defaults.folders,
      exclude: parsed.exclude ?? defaults.exclude,
      defaultTags: parsed.defaultTags ?? defaults.defaultTags,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.log('没有找到 content-sync.config.json。');
    console.log('先复制一份配置：cp content-sync.config.example.json content-sync.config.json');
    console.log('然后把 vault 改成你的 Obsidian 目录。');
    process.exit(1);
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**/', '(?:.*/)?')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`);
}

function makeExcluder(patterns: string[]): (rel: string) => boolean {
  const regexes = patterns.map(globToRegExp);
  return (rel) => regexes.some((regex) => regex.test(rel.replaceAll(path.sep, '/')));
}

async function walk(dir: string, skip: (rel: string) => boolean, base = dir): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (skip(rel)) continue;
    if (entry.isDirectory()) output.push(...(await walk(full, skip, base)));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function firstHeading(body: string): string {
  const match = body.match(/^\s*#\s+(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function noteTitle(data: Record<string, unknown>, body: string, file: string): string {
  const value = data.title;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return firstHeading(body) || path.basename(file, path.extname(file));
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function loadState(): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(path.join(cwd, '.content-sync-state.json'), 'utf8')) as State;
    if (parsed?.version === 1 && parsed.files) return parsed;
  } catch {
    /* ignore */
  }
  return { version: 1, files: {} };
}

async function saveState(state: State): Promise<void> {
  if (dryRun) return;
  await writeFile(path.join(cwd, '.content-sync-state.json'), JSON.stringify(state, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const config = await loadConfig();
  if (!config.vault) {
    console.error('配置里没有 vault。');
    process.exit(1);
  }

  const excluder = makeExcluder(config.exclude);
  const sources: Array<{
    file: string;
    sourceRel: string;
    data: Record<string, unknown>;
    content: string;
    mtime: Date;
    birthtime: Date;
  }> = [];

  for (const folder of config.folders) {
    const dir = path.join(config.vault, folder);
    const files = await walk(dir, excluder, config.vault);
    for (const file of files) {
      if (!/\.md$/i.test(file) || /\.excalidraw\.md$/i.test(file)) continue;
      const raw = await readFile(file, 'utf8');
      const parsed = matter(raw);
      const info = await stat(file);
      sources.push({
        file,
        sourceRel: path.relative(config.vault, file).replaceAll(path.sep, '/'),
        data: parsed.data as Record<string, unknown>,
        content: parsed.content,
        mtime: info.mtime,
        birthtime: info.birthtime,
      });
    }
  }

  if (sources.length === 0) {
    console.log(`没有在 ${config.vault} 的 ${config.folders.join(', ')} 下找到 Markdown。`);
    return;
  }

  const usedSlugs = new Map<string, number>();
  const noteSlugByKey = new Map<string, string>();
  const notes: SourceNote[] = [];

  for (const source of sources) {
    const title = noteTitle(source.data, source.content, source.file);
    const wanted = slugify(
      typeof source.data.slug === 'string' && source.data.slug.trim()
        ? source.data.slug
        : path.basename(source.file, path.extname(source.file)) || title,
    );
    const count = usedSlugs.get(wanted) ?? 0;
    usedSlugs.set(wanted, count + 1);
    const slug = count === 0 ? wanted : `${wanted}-${count + 1}`;

    const key = path.basename(source.file, path.extname(source.file)).toLowerCase();
    noteSlugByKey.set(key, slug);
    noteSlugByKey.set(slug.toLowerCase(), slug);

    notes.push({ ...source, title, slug });
  }

  const needsAttachments = notes.some((note) => /!\[\[|!\[[^\]]*\]\(/.test(note.content));
  const attachmentIndex = new Map<string, string[]>();
  if (needsAttachments) {
    const assets = await walk(config.vault, (rel) => excluder(rel) || /\.md$/i.test(rel), config.vault);
    for (const file of assets) {
      const base = path.basename(file).toLowerCase();
      const list = attachmentIndex.get(base) ?? [];
      list.push(file);
      attachmentIndex.set(base, list);
    }
  }

  const state = await loadState();
  let written = 0;
  let unchanged = 0;
  let skipped = 0;
  let assetsCopied = 0;

  for (const note of notes) {
    const warnings: string[] = [];
    const resolveAsset = (target: string): string | null => {
      const cleaned = decodeURIComponent(target.split('|')[0].trim());
      const candidates = [
        path.resolve(path.dirname(note.file), cleaned),
        ...(attachmentIndex.get(path.basename(cleaned).toLowerCase()) ?? []),
      ];
      const found = candidates.find(
        (candidate) =>
          path.isAbsolute(candidate) &&
          existsSync(candidate) &&
          path.basename(candidate).toLowerCase() === path.basename(cleaned).toLowerCase(),
      );
      if (!found) return null;
      const filename = path.basename(found);
      if (!dryRun) {
        const destDir = path.join(cwd, config.assets, note.slug);
        const dest = path.join(destDir, filename);
        mkdirSync(destDir, { recursive: true });
        if (!existsSync(dest) || statSync(found).mtimeMs > statSync(dest).mtimeMs) {
          copyFileSync(found, dest);
        }
        assetsCopied += 1;
      }
      return `/notes-assets/${encodeURIComponent(note.slug)}/${encodeURIComponent(filename)}`;
    };

    const transformOptions: TransformOptions = {
      body: note.content,
      title: note.title,
      slug: note.slug,
      noteSlugByKey,
      resolveAsset,
      warn: (message) => warnings.push(message),
    };

    let body = note.content.replace(/\r\n/g, '\n');
    body = stripLeadingTitle(body, note.title);
    body = stripObsidianComments(body);
    body = convertCallouts(body);
    body = convertEmbeds(body, transformOptions);
    body = convertWikilinks(body, transformOptions);
    body = body.replace(/\n{3,}/g, '\n\n').trim();
    body = body ? `${body}\n` : '';

    const date = toDay(note.data.date ?? note.data.created, note.birthtime);
    const updated = toDay(note.data.updated, note.mtime);
    const tags = normalizeTags(note.data.tags, config.defaultTags);
    const frontmatter = frontmatterFor({
      title: note.title,
      description:
        typeof note.data.description === 'string' && note.data.description.trim()
          ? note.data.description.trim()
          : describe(body, 150),
      date,
      updated,
      tags,
      draft: isTruthy(note.data.draft),
      featured: isTruthy(note.data.featured),
      source: note.sourceRel,
    });

    const output = `${frontmatter}${body}`;
    const hash = sha256(output);
    const target = path.join(cwd, config.target, `${note.slug}.md`);
    const targetRel = path.relative(cwd, target);

    let existing = '';
    try {
      existing = await readFile(target, 'utf8');
    } catch {
      existing = '';
    }

    if (existing) {
      const existingHash = sha256(existing);
      if (existingHash === hash) {
        unchanged += 1;
        if (verbose) console.log(`· 无变化  ${targetRel}`);
        continue;
      }
      const tracked = state.files[targetRel];
      if (!force && (!tracked || tracked.hash !== existingHash)) {
        skipped += 1;
        console.warn(`! 跳过 ${note.sourceRel}：目标文件有本地修改（用 --force 覆盖）`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`→ 会写入 ${targetRel}`);
      written += 1;
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });

    // Copy local Markdown images and rewrite their URLs.
    const standardImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    const imageMatches = [...body.matchAll(standardImagePattern)];
    for (const match of imageMatches) {
      const imagePath = match[2];
      if (/^(https?:|data:|\/|#)/i.test(imagePath)) continue;
      let foundPath = path.resolve(path.dirname(note.file), decodeURIComponent(imagePath));
      if (!existsSync(foundPath)) {
        const candidates = attachmentIndex.get(path.basename(imagePath).toLowerCase()) ?? [];
        foundPath = candidates[0] ?? '';
      }
      if (!foundPath || !existsSync(foundPath)) {
        warnings.push(`找不到图片：${imagePath}`);
        continue;
      }
      const filename = path.basename(foundPath);
      const destDir = path.join(cwd, config.assets, note.slug);
      const dest = path.join(destDir, filename);
      await mkdir(destDir, { recursive: true });
      await copyFile(foundPath, dest);
      assetsCopied += 1;
      const url = `/notes-assets/${encodeURIComponent(note.slug)}/${encodeURIComponent(filename)}`;
      body = body.replaceAll(imagePath, url);
    }

    const finalOutput = `${frontmatter}${body}`;
    await writeFile(target, finalOutput, 'utf8');
    state.files[targetRel] = {
      source: note.sourceRel,
      hash: sha256(finalOutput),
      syncedAt: new Date().toISOString(),
    };
    written += 1;
    console.log(`✓ ${note.sourceRel} → ${targetRel}`);
    if (verbose) for (const warning of warnings) console.warn(`  ! ${warning}`);
  }

  await saveState(state);

  console.log('');
  console.log(
    `${dryRun ? '[dry run] ' : ''}写入 ${written}，无变化 ${unchanged}，跳过 ${skipped}，附件 ${assetsCopied}。`,
  );
  if (!dryRun && written > 0) console.log('运行 pnpm dev 或 pnpm build 重新生成内容类型。');

  if (shouldWatch && !watchersStarted) {
    watchersStarted = true;
    console.log('');
    console.log(`监听 ${config.folders.map((folder) => path.join(config.vault, folder)).join(', ')} …`);
    let timer: NodeJS.Timeout | undefined;
    for (const folder of config.folders) {
      try {
        watch(
          path.join(config.vault, folder),
          { recursive: true },
          () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              void main().catch((error) => console.error(error));
            }, 400);
          },
        );
      } catch (error) {
        console.warn(`无法监听 ${folder}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});
