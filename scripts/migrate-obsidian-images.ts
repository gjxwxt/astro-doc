import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const REMOTE_IMAGE = /^https?:\/\//i;
const WIKI_IMAGE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

interface Options {
  vault: string;
  baseUrl: string;
  publicBase: string;
  token: string;
  write: boolean;
  backup: string;
  report: string;
  verbose: boolean;
}

interface ImageRef {
  raw: string;
  target: string;
  alt: string;
  alias: string;
  kind: 'wiki' | 'markdown';
  index: number;
}

interface ResolvedRef {
  absolutePath: string | null;
  reason?: string;
}

interface Stats {
  files: number;
  localRefs: number;
  remoteRefs: number;
  missing: number;
  unsupported: number;
  uploaded: number;
  deduped: number;
  changedFiles: number;
  failed: number;
}

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

function parseArgs(argv: string[]): Options {
  let vault = '';
  let baseUrl = process.env.PORTAL_URL?.trim() || 'http://127.0.0.1:4400';
  let publicBase = process.env.MEDIA_PUBLIC_BASE_URL?.trim() || '';
  let token = process.env.PRIVATE_API_TOKEN?.trim() || '';
  let write = false;
  let backup = '';
  let report = '';
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--vault') vault = argv[++i] ?? '';
    else if (arg === '--base-url') baseUrl = argv[++i] ?? '';
    else if (arg === '--public-base') publicBase = argv[++i] ?? '';
    else if (arg === '--backup') backup = argv[++i] ?? '';
    else if (arg === '--report') report = argv[++i] ?? '';
    else if (arg === '--write') write = true;
    else if (arg === '--verbose' || arg === '-v') verbose = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--dry-run' || arg === '--dry') {
      write = false;
    } else {
      console.error(`未知参数：${arg}`);
      printHelp();
      process.exit(2);
    }
  }

  if (!vault) {
    console.error('缺少 --vault <Obsidian vault 路径>。');
    printHelp();
    process.exit(2);
  }

  return {
    vault: path.resolve(expandHome(vault)),
    baseUrl: baseUrl.replace(/\/+$/, ''),
    publicBase: (publicBase || baseUrl).replace(/\/+$/, ''),
    token,
    write,
    backup,
    report,
    verbose,
  };
}

function printHelp(): void {
  console.log(`迁移 Obsidian 本地图片到 Josh 媒体库

用法：
  pnpm media:migrate --vault ~/Documents/Obsidian

默认只做只读盘点，不上传、不改文件。

参数：
  --vault <path>        Obsidian vault 根目录（必填）
  --base-url <url>      门户地址，默认 PORTAL_URL 或 http://127.0.0.1:4400
  --public-base <url>   写进 Markdown 的图片基础地址，默认同 base-url
  --write               上传并改写 Markdown；会先备份改动的文件
  --backup <path>       备份目录，默认 <vault>/.josh-media-backup/<时间>
  --report <path>       把 JSON 报告写到指定文件
  --verbose, -v         列出每个待处理/跳过的引用

环境变量：
  PRIVATE_API_TOKEN     私有上传 Token；--write 时必需
  PORTAL_URL            门户地址
  MEDIA_PUBLIC_BASE_URL 图片绝对地址前缀（可选）
`);
}

function isHiddenDir(name: string): boolean {
  return (
    name === '.obsidian' ||
    name === '.trash' ||
    name === '.git' ||
    name.startsWith('.josh-media-backup')
  );
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isHiddenDir(entry.name)) continue;
      await walk(full, root, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function imageExtension(target: string): string {
  return path.extname(target).toLowerCase();
}

function cleanTarget(target: string): string {
  let value = target.trim().replace(/^<|>$/g, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw string when it contains an invalid percent escape.
  }
  return value.split(/[?#]/, 1)[0]?.trim() ?? '';
}

function isRemote(target: string): boolean {
  return REMOTE_IMAGE.test(target) || /^data:image\//i.test(target);
}

function extractImageRefs(content: string): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const match of content.matchAll(WIKI_IMAGE)) {
    if (match.index === undefined) continue;
    const target = match[1]?.trim() ?? '';
    const alias = match[2]?.trim() ?? '';
    if (!IMAGE_EXTENSIONS.has(imageExtension(cleanTarget(target)))) continue;
    refs.push({
      raw: match[0],
      target,
      alias,
      alt: alias && !/^\d+$/.test(alias) ? alias : path.basename(cleanTarget(target)),
      kind: 'wiki',
      index: match.index,
    });
  }

  for (const match of content.matchAll(MARKDOWN_IMAGE)) {
    if (match.index === undefined) continue;
    const target = match[2]?.trim() ?? '';
    const cleaned = cleanTarget(target);
    if (!IMAGE_EXTENSIONS.has(imageExtension(cleaned))) continue;
    refs.push({
      raw: match[0],
      target,
      alias: '',
      alt: match[1]?.trim() ?? '',
      kind: 'markdown',
      index: match.index,
    });
  }

  return refs.sort((a, b) => a.index - b.index);
}

function buildFileIndex(files: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    const list = index.get(name) ?? [];
    list.push(file);
    index.set(name, list);
  }
  return index;
}

function resolveRef(
  ref: ImageRef,
  note: string,
  vault: string,
  fileIndex: Map<string, string[]>,
): ResolvedRef {
  const target = cleanTarget(ref.target);
  if (!target) return { absolutePath: null, reason: '空路径' };
  if (isRemote(target)) return { absolutePath: null, reason: 'remote' };
  if (target.startsWith('file:') || path.isAbsolute(target)) {
    return { absolutePath: null, reason: '不支持 vault 外绝对路径' };
  }

  const candidates = [
    path.resolve(path.dirname(note), target),
    path.resolve(vault, target.replace(/^\/+/, '')),
    ...(fileIndex.get(path.basename(target).toLowerCase()) ?? []),
  ].filter((candidate) => isInside(vault, candidate));

  const found = candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!found) return { absolutePath: null, reason: '找不到文件' };
  return { absolutePath: found };
}

async function statFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function escapeAlt(value: string): string {
  return value.replace(/\]/g, '\\]').replace(/\n/g, ' ');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function makeReplacement(ref: ImageRef, url: string): string {
  const alt = ref.alt || path.basename(cleanTarget(ref.target));
  if (ref.kind === 'wiki' && /^\d+$/.test(ref.alias)) {
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" width="${ref.alias}">`;
  }
  return `![${escapeAlt(alt)}](${url})`;
}

async function uploadImage(
  file: string,
  opts: Options,
): Promise<{ url: string; deduped: boolean }> {
  const bytes = await readFile(file);
  const form = new FormData();
  form.append('file', new Blob([bytes]), path.basename(file));
  const response = await fetch(`${opts.baseUrl}/api/media/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: { url?: string; deduped?: boolean }; error?: { message?: string } }
    | null;
  if (!response.ok || !payload?.ok || !payload.data?.url) {
    throw new Error(payload?.error?.message || `上传失败（${response.status}）`);
  }
  const rawUrl = payload.data.url;
  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : `${opts.baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  return { url, deduped: Boolean(payload.data.deduped) };
}

async function writeReport(file: string, report: unknown): Promise<void> {
  if (!file) return;
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(path.resolve(file), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const vaultStat = await stat(opts.vault).catch(() => null);
  if (!vaultStat?.isDirectory()) {
    console.error(`vault 不存在或不是目录：${opts.vault}`);
    process.exit(2);
  }
  if (opts.write && !opts.token) {
    console.error('--write 需要 PRIVATE_API_TOKEN。');
    process.exit(2);
  }

  const markdownFiles: string[] = [];
  await walk(opts.vault, opts.vault, markdownFiles);
  const allFiles: string[] = [];
  const walkAll = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isHiddenDir(entry.name)) continue;
        await walkAll(full);
      } else if (entry.isFile()) {
        allFiles.push(full);
      }
    }
  };
  await walkAll(opts.vault);
  const fileIndex = buildFileIndex(allFiles);

  const stats: Stats = {
    files: markdownFiles.length,
    localRefs: 0,
    remoteRefs: 0,
    missing: 0,
    unsupported: 0,
    uploaded: 0,
    deduped: 0,
    changedFiles: 0,
    failed: 0,
  };
  const uploadCache = new Map<string, string>();
  const changed: Array<{ file: string; before: string; after: string }> = [];
  const details: Array<Record<string, string | number>> = [];

  for (const file of markdownFiles) {
    const content = await readFile(file, 'utf8');
    const refs = extractImageRefs(content);
    if (refs.length === 0) continue;
    const replacements: Array<{ ref: ImageRef; replacement: string }> = [];

    for (const ref of refs) {
      const resolved = resolveRef(ref, file, opts.vault, fileIndex);
      if (resolved.reason === 'remote') {
        stats.remoteRefs += 1;
        continue;
      }
      if (!resolved.absolutePath) {
        stats.missing += 1;
        if (opts.verbose) {
          console.log(`[缺失] ${path.relative(opts.vault, file)}: ${ref.target}（${resolved.reason}）`);
        }
        details.push({ file: path.relative(opts.vault, file), target: ref.target, reason: resolved.reason ?? 'missing' });
        continue;
      }
      if (!(await statFile(resolved.absolutePath))) {
        stats.missing += 1;
        continue;
      }
      const ext = imageExtension(resolved.absolutePath);
      if (!IMAGE_EXTENSIONS.has(ext)) {
        stats.unsupported += 1;
        continue;
      }

      stats.localRefs += 1;
      if (!opts.write) {
        if (opts.verbose) {
          console.log(`[本地] ${path.relative(opts.vault, file)}: ${ref.target}`);
        }
        continue;
      }

      let url = uploadCache.get(resolved.absolutePath);
      if (!url) {
        try {
          const uploaded = await uploadImage(resolved.absolutePath, opts);
          url = uploaded.url;
          uploadCache.set(resolved.absolutePath, url);
          if (uploaded.deduped) stats.deduped += 1;
          else stats.uploaded += 1;
          if (opts.verbose) {
            console.log(`[上传] ${path.relative(opts.vault, resolved.absolutePath)} -> ${url}`);
          }
        } catch (error) {
          stats.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[失败] ${path.relative(opts.vault, resolved.absolutePath)}: ${message}`);
          details.push({ file: path.relative(opts.vault, file), target: ref.target, reason: message });
          continue;
        }
      }
      replacements.push({ ref, replacement: makeReplacement(ref, url) });
    }

    if (opts.write && replacements.length > 0) {
      let next = content;
      for (const item of replacements.sort((a, b) => b.ref.index - a.ref.index)) {
        next = next.slice(0, item.ref.index) + item.replacement + next.slice(item.ref.index + item.ref.raw.length);
      }
      if (next !== content) {
        changed.push({ file, before: content, after: next });
      }
    }
  }

  if (opts.write && changed.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = path.resolve(
      opts.backup || path.join(opts.vault, '.josh-media-backup', stamp),
    );
    for (const item of changed) {
      const relative = path.relative(opts.vault, item.file);
      const backupFile = path.join(backupRoot, relative);
      await mkdir(path.dirname(backupFile), { recursive: true });
      await copyFile(item.file, backupFile);
      const temp = `${item.file}.josh-media-${process.pid}.tmp`;
      await writeFile(temp, item.after, 'utf8');
      await rename(temp, item.file);
      stats.changedFiles += 1;
    }
    console.log(`备份：${backupRoot}`);
  }

  console.log('\nObsidian 图片盘点');
  console.log(`- Markdown 文件：${stats.files}`);
  console.log(`- 本地图片引用：${stats.localRefs}`);
  console.log(`- 远程图片引用：${stats.remoteRefs}`);
  console.log(`- 找不到/不支持的路径：${stats.missing + stats.unsupported}`);
  if (opts.write) {
    console.log(`- 新上传：${stats.uploaded}`);
    console.log(`- 服务端已存在（去重）：${stats.deduped}`);
    console.log(`- 改写文件：${stats.changedFiles}`);
    console.log(`- 失败：${stats.failed}`);
  } else {
    console.log('- 当前是只读盘点；加 --write 才会上传并改写文件。');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    vault: opts.vault,
    write: opts.write,
    stats,
    details,
    changed: changed.map((item) => path.relative(opts.vault, item.file)),
  };
  await writeReport(opts.report, report);

  if (stats.failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
