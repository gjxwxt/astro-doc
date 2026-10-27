import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  folderRuleFor,
  parseSiteConfig,
  rewriteLibraryBody,
  syncObsidian,
} from '../scripts/lib/obsidian';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'josh-obsidian-'));
  tempDirs.push(dir);
  await fs.writeFile(
    path.join(dir, 'site.config.yml'),
    `version: 1
sections:
  knowledge:
    title: 知识库
    order: 10
folders:
  "wiki/concepts":
    section: knowledge
    tag: concept
  "raw/articles":
    section: knowledge
    tag: article
`,
  );
  await fs.mkdir(path.join(dir, 'wiki/concepts'), { recursive: true });
  await fs.mkdir(path.join(dir, 'raw/articles'), { recursive: true });
  return dir;
}

describe('Obsidian library sync', () => {
  it('parses section order and longest folder prefix', () => {
    const config = parseSiteConfig(`
sections:
  knowledge:
    title: 知识库
    order: 10
folders:
  "wiki":
    section: knowledge
  "wiki/concepts":
    section: knowledge
    tag: concept
`);
    expect(config.sections.knowledge).toEqual({ id: 'knowledge', title: '知识库', order: 10 });
    expect(folderRuleFor('wiki/concepts/a.md', config)?.tag).toBe('concept');
    expect(folderRuleFor('wiki/sources/a.md', config)?.tag).toBeUndefined();
  });

  it('rewrites only published wikilinks and drops local images', () => {
    const warnings: string[] = [];
    const body = rewriteLibraryBody(
      `# Title

See [[published|the page]] and [[missing]].
![[assets/local.png|截图]]
![remote](https://example.com/a.png)
![local](assets/a.png)`,
      {
        title: 'Title',
        linkMap: new Map([['published', 'knowledge/published']]),
        warn: (message) => warnings.push(message),
      },
    );

    expect(body).toContain('[the page](/library/knowledge/published/)');
    expect(body).toContain('missing');
    expect(body).not.toContain('assets/local.png');
    expect(body).toContain('![remote](https://example.com/a.png)');
    expect(body).not.toContain('](assets/a.png)');
    expect(warnings).toHaveLength(3);
  });

  it('syncs only publish:true files and writes a rewritten body', async () => {
    const source = await makeVault();
    await fs.writeFile(
      path.join(source, 'wiki/concepts/published.md'),
      `---
title: Published
created: 2026-01-02
publish: true
---

# Published

Back to [[draft]].
`,
    );
    await fs.writeFile(
      path.join(source, 'wiki/concepts/draft.md'),
      `---
title: Draft
created: 2026-01-03
---
`,
    );
    await fs.writeFile(
      path.join(source, 'raw/articles/article.md'),
      `---
title: Article
created: 2026-01-04
publish: true
tags: [network]
---
`,
    );

    const outDir = path.join(source, 'out');
    const result = await syncObsidian({ sourceDir: source, outDir });
    expect(result.docs).toHaveLength(2);
    expect(result.docs.map((doc) => doc.outputId).sort()).toEqual([
      'knowledge/article',
      'knowledge/published',
    ]);

    const published = await fs.readFile(path.join(outDir, 'knowledge/published.md'), 'utf8');
    expect(published).toContain('Back to draft.');
    expect(published).toContain('sectionTitle: 知识库');
    expect(published).toContain('- concept');
    expect(published).not.toContain('publish: true');
  });
});
