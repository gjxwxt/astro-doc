import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { slugify } from './lib/sync';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.log('用法：pnpm new:note "标题"');
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const slug = slugify(title);
const file = path.join(process.cwd(), 'src/content/notes', `${slug}.md`);

try {
  await access(file);
  console.error(`已经存在：${file}`);
  process.exit(1);
} catch {
  /* expected */
}

await mkdir(path.dirname(file), { recursive: true });
await writeFile(
  file,
  `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\ntags: []\n---\n\n## 开始\n\n`,
  'utf8',
);

console.log(`✓ 新建 ${path.relative(process.cwd(), file)}`);
