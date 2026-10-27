import path from 'node:path';

import { syncObsidian } from './lib/obsidian';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceDir = path.resolve(
  argument('--source') ?? process.env.OBSIDIAN_DIR ?? path.join(process.env.HOME ?? '.', 'Documents/write-space'),
);
const outDir = path.resolve(argument('--out') ?? path.join(process.cwd(), 'src/content/library'));
const dry = process.argv.includes('--dry');

const result = await syncObsidian({ sourceDir, outDir, dry });

console.log(`source: ${sourceDir}`);
console.log(`output: ${outDir}${dry ? ' (dry run)' : ''}`);
console.log(`sections: ${Object.values(result.config.sections).map((section) => `${section.title}(${section.order})`).join(', ')}`);
for (const doc of result.docs) {
  console.log(`  + ${doc.section} / ${doc.title}  [${doc.relPath}]`);
}
if (result.warnings.length > 0) {
  console.log('\nwarnings:');
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
}
console.log(`\n${result.docs.length} published document(s)`);
