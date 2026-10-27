import { getCollection } from 'astro:content';

import { siteConfig } from '@/config/site';
import { isoDate } from '@/lib/format';
import { markdownToText } from '@/lib/markdown';
import type { SearchDoc } from '@/lib/search';
import { plugins } from '@/plugins/registry';

export const prerender = true;

export async function GET() {
  const notes = await getCollection('notes', ({ data }) => !data.draft);
  const docs = await getCollection('docs', ({ data }) => !data.draft);
  const libraryDocs = await getCollection('library');
  const bookmarkGroups = await getCollection('bookmarks');
  const entries: SearchDoc[] = [];
  const seen = new Set<string>();

  const add = (entry: SearchDoc) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    entries.push(entry);
  };

  for (const note of notes) {
    const body = markdownToText(note.body ?? '');
    add({
      id: `note:${note.id}`,
      type: 'note',
      url: `/notes/${note.id}/`,
      title: note.data.title,
      description: note.data.description,
      tags: note.data.tags,
      date: isoDate(note.data.date),
      body: body.slice(0, 6000),
    });
  }

  for (const doc of libraryDocs) {
    const body = markdownToText(doc.body ?? '');
    add({
      id: `library:${doc.id}`,
      type: 'library',
      url: `/library/${doc.id}/`,
      title: doc.data.title,
      description: doc.data.description,
      tags: doc.data.tags,
      date: doc.data.date ? isoDate(doc.data.date) : undefined,
      body: body.slice(0, 6000),
    });
  }

  for (const doc of docs) {
    const body = markdownToText(doc.body ?? '');
    add({
      id: `doc:${doc.id}`,
      type: 'doc',
      url: `/${doc.id}/`,
      title: doc.data.title,
      description: doc.data.description,
      tags: doc.data.tags,
      date: doc.data.date ? isoDate(doc.data.date) : undefined,
      body: body.slice(0, 6000),
    });
  }

  for (const plugin of plugins) {
    const body = [
      plugin.description,
      ...plugin.actions.map((action) => `${action.label}：${action.description}`),
      ...(plugin.notes ?? []),
      plugin.config?.hint ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    add({
      id: `tool:${plugin.id}`,
      type: 'tool',
      url: `/tools/${plugin.id}/`,
      title: plugin.name,
      description: plugin.tagline,
      tags: plugin.tags,
      body,
    });
  }

  const bookmarkBody = bookmarkGroups
    .sort((a, b) => a.data.order - b.data.order)
    .flatMap((group) => [
      group.data.title,
      ...group.data.items.map((item) => `${item.name}${item.description ? `：${item.description}` : ''}`),
    ])
    .join('\n');

  add({
    id: 'page:bookmarks',
    type: 'page',
    url: '/bookmarks/',
    title: '收藏夹',
    description: '常用网站、工具和资源，按分类整理。',
    tags: ['收藏', '导航'],
    body: bookmarkBody.slice(0, 6000),
  });

  add({
    id: 'page:tools',
    type: 'page',
    url: '/tools/',
    title: '工具',
    description: '可以直接使用的站内工具，每个工具都是一个插件。',
    tags: ['工具', '插件'],
    body: plugins.map((plugin) => `${plugin.name}：${plugin.description}`).join('\n'),
  });

  add({
    id: 'page:notes',
    type: 'page',
    url: '/notes/',
    title: '笔记',
    description: '更短、更随手的记录。',
    tags: ['笔记'],
    body: notes.map((note) => `${note.data.title}：${note.data.description ?? ''}`).join('\n'),
  });

  add({
    id: 'page:about',
    type: 'page',
    url: '/about/',
    title: '关于',
    description: `关于 ${siteConfig.name}，以及这个站为什么长这样。`,
    tags: ['关于'],
    body: '这个站最早是一个 Starlight 文档模板，后来改成了文档、笔记、工具和收藏四个部分。页面尽量预渲染，工具和 AI 助手走服务端。',
  });

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), entries }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
