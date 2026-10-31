import { access, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = process.env.PORTAL_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const source = path.join(dataDir, 'portal.sqlite');
const mediaDir = path.join(dataDir, 'media');
const backupRoot = process.env.PORTAL_BACKUP_DIR?.trim() || path.join(dataDir, 'backups');
const keep = Math.min(
  90,
  Math.max(1, Number.parseInt(process.env.PORTAL_BACKUP_KEEP ?? '14', 10) || 14),
);

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').replace(/\.\d+Z$/, '');
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

try {
  await access(source);
} catch {
  fail(`找不到数据库：${source}`);
}

await mkdir(backupRoot, { recursive: true });
const name = stamp();
let targetDir = path.join(backupRoot, name);
let suffix = 1;
while (true) {
  try {
    await access(targetDir);
    targetDir = path.join(backupRoot, `${name}-${suffix}`);
    suffix += 1;
  } catch {
    break;
  }
}
await mkdir(targetDir, { recursive: true });

const databaseTarget = path.join(targetDir, 'portal.sqlite');
const db = new DatabaseSync(source);
try {
  // VACUUM INTO takes a consistent snapshot even while WAL mode is active.
  db.exec(`VACUUM INTO '${databaseTarget.replace(/'/g, "''")}'`);
} catch (error) {
  await rm(targetDir, { recursive: true, force: true });
  fail(`数据库快照失败：${error instanceof Error ? error.message : String(error)}`);
} finally {
  db.close();
}

let mediaBytes = 0;
let mediaIncluded = false;
try {
  const mediaStat = await stat(mediaDir);
  if (mediaStat.isDirectory()) {
    const archive = path.join(targetDir, 'media.tar.gz');
    const tar = spawnSync('tar', ['-czf', archive, '-C', dataDir, 'media'], {
      encoding: 'utf8',
    });
    if (tar.status !== 0) {
      throw new Error(tar.stderr?.trim() || `tar exited with ${tar.status}`);
    }
    mediaBytes = (await stat(archive)).size;
    mediaIncluded = true;
  }
} catch (error) {
  // A missing media directory is normal before the first upload.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    await rm(targetDir, { recursive: true, force: true });
    fail(`媒体备份失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const check = new DatabaseSync(databaseTarget);
  const result = check.prepare('PRAGMA integrity_check').get() as
    | { integrity_check?: string }
    | undefined;
  check.close();
  if (result?.integrity_check !== 'ok') {
    throw new Error(`integrity_check=${result?.integrity_check ?? 'unknown'}`);
  }
} catch (error) {
  await rm(targetDir, { recursive: true, force: true });
  fail(`备份完整性检查失败：${error instanceof Error ? error.message : String(error)}`);
}

const databaseBytes = (await stat(databaseTarget)).size;
await writeFile(
  path.join(targetDir, 'manifest.json'),
  `${JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      dataDir,
      database: 'portal.sqlite',
      databaseBytes,
      media: mediaIncluded ? 'media.tar.gz' : null,
      mediaBytes,
    },
    null,
    2,
  )}\n`,
);

const entries = (await readdir(backupRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}(?:-\d+)?$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .reverse();
const stale = entries.slice(keep);
const root = path.resolve(backupRoot);
for (const entry of stale) {
  const candidate = path.resolve(backupRoot, entry);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) continue;
  await rm(candidate, { recursive: true, force: true });
}

console.log(`✓ 备份完成：${path.relative(process.cwd(), targetDir)}`);
console.log(`  数据库：${(databaseBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  媒体：${mediaIncluded ? `${(mediaBytes / 1024 / 1024).toFixed(2)} MB` : '无媒体目录'}`);
console.log(`  保留 ${keep} 份，当前 ${entries.length} 份，清理 ${stale.length} 份。`);
