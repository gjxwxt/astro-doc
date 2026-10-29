import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const argument = process.argv.slice(2).find((item) => !item.startsWith('-'))?.trim();
if (!argument) {
  console.error('用法：pnpm db:restore <backup.sqlite>');
  console.error('恢复前请先停止 josh-portal 服务。');
  process.exit(1);
}

const backup = path.resolve(argument);
const dataDir = process.env.PORTAL_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const target = path.join(dataDir, 'portal.sqlite');

if (backup === target) {
  console.error('备份文件和目标数据库是同一个文件，拒绝覆盖。');
  process.exit(1);
}

try {
  await access(backup);
} catch {
  console.error(`找不到备份文件：${backup}`);
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const safety = path.join(dataDir, `portal.before-restore-${stamp}.sqlite`);

try {
  await access(target);
  await copyFile(target, safety);
  console.log(`✓ 已保存恢复前快照：${path.relative(process.cwd(), safety)}`);
} catch {
  /* target does not exist yet */
}

await copyFile(backup, target);
// A copied database must not reuse the old WAL/SHM files.
await rm(`${target}-wal`, { force: true });
await rm(`${target}-shm`, { force: true });

console.log(`✓ 已恢复：${path.relative(process.cwd(), backup)} → ${path.relative(process.cwd(), target)}`);
console.log('  现在可以重新启动 josh-portal。');
