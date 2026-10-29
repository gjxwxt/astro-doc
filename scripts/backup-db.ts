import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = process.env.PORTAL_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const source = path.join(dataDir, 'portal.sqlite');
const backupDir =
  process.env.PORTAL_BACKUP_DIR?.trim() || path.join(dataDir, 'backups');

try {
  await access(source);
} catch {
  console.error(`找不到数据库：${source}`);
  process.exit(1);
}

await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
let target = path.join(backupDir, `portal-${stamp}.sqlite`);
let suffix = 1;
while (true) {
  try {
    await access(target);
    target = path.join(backupDir, `portal-${stamp}-${suffix}.sqlite`);
    suffix += 1;
  } catch {
    break;
  }
}

const db = new DatabaseSync(source);
try {
  // VACUUM INTO takes a consistent snapshot even when WAL mode is active.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const files = (await readdir(backupDir))
  .filter((file) => file.endsWith('.sqlite'))
  .sort();
console.log(`✓ 备份完成：${path.relative(process.cwd(), target)}`);
console.log(`  当前共 ${files.length} 个备份，目录：${path.relative(process.cwd(), backupDir)}`);
