import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const includeMedia = args.includes('--include-media');
const argument = args.find((item) => !item.startsWith('-'))?.trim();
if (!argument) {
  console.error('用法：pnpm db:restore <backup-dir|backup.sqlite> [--include-media]');
  console.error('恢复前请先停止 josh-portal 服务。');
  process.exit(1);
}

const backup = path.resolve(argument);
const dataDir = process.env.PORTAL_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const target = path.join(dataDir, 'portal.sqlite');
const mediaDir = path.join(dataDir, 'media');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

const backupIsDir = await isDirectory(backup);
const databaseBackup = backupIsDir ? path.join(backup, 'portal.sqlite') : backup;
const mediaBackup = path.join(backup, 'media.tar.gz');

try {
  await access(databaseBackup);
} catch {
  console.error(`找不到数据库备份：${databaseBackup}`);
  process.exit(1);
}

if (databaseBackup === target) {
  console.error('备份文件和目标数据库是同一个文件，拒绝覆盖。');
  process.exit(1);
}
if (backupIsDir) {
  try {
    await access(mediaBackup);
  } catch {
    if (includeMedia) {
      console.error(`备份目录里没有媒体包：${mediaBackup}`);
      process.exit(1);
    }
  }
}

await mkdir(dataDir, { recursive: true });
const safety = path.join(dataDir, `portal.before-restore-${stamp}.sqlite`);
try {
  await access(target);
  await copyFile(target, safety);
  console.log(`✓ 已保存恢复前数据库快照：${path.relative(process.cwd(), safety)}`);
} catch {
  /* target does not exist yet */
}

await copyFile(databaseBackup, target);
// A copied database must not reuse old WAL/SHM files.
await rm(`${target}-wal`, { force: true });
await rm(`${target}-shm`, { force: true });
console.log(`✓ 已恢复数据库：${path.relative(process.cwd(), databaseBackup)} → ${path.relative(process.cwd(), target)}`);

if (includeMedia) {
  let archiveExists = true;
  try {
    await access(mediaBackup);
  } catch {
    archiveExists = false;
  }
  if (!archiveExists) {
    console.error(`✗ 找不到媒体包：${mediaBackup}`);
    process.exit(1);
  }

  const safetyMedia = path.join(dataDir, `media.before-restore-${stamp}`);
  let moved = false;
  try {
    await access(mediaDir);
    await rename(mediaDir, safetyMedia);
    moved = true;
  } catch {
    /* no existing media directory */
  }
  const extracted = spawnSync('tar', ['-xzf', mediaBackup, '-C', dataDir], {
    encoding: 'utf8',
  });
  if (extracted.status !== 0) {
    if (moved) await rename(safetyMedia, mediaDir);
    console.error(`✗ 媒体恢复失败：${extracted.stderr?.trim() || `tar exited with ${extracted.status}`}`);
    process.exit(1);
  }
  console.log(`✓ 已恢复媒体：${path.relative(process.cwd(), mediaBackup)} → ${path.relative(process.cwd(), mediaDir)}`);
  if (moved) {
    await rm(safetyMedia, { recursive: true, force: true });
    console.log('  已清理恢复前的媒体目录。');
  }
}

console.log('现在可以重新启动 josh-portal。');
