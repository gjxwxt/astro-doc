import { getCollection } from 'astro:content';

import { siteConfig } from '@/config/site';
import { excerpt } from '@/lib/markdown';

export const prerender = true;

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET({ site }: { site: URL | undefined }) {
  const base = site ?? new URL('https://example.com');
  const notes = (await getCollection('notes', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const items = notes
    .map((note) => {
      const url = new URL(`/notes/${note.id}/`, base).href;
      const description = note.data.description ?? excerpt(note.body ?? '', 160);
      return `    <item>
      <title>${escapeXml(note.data.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${note.data.date.toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${siteConfig.name} 的笔记</title>
    <link>${escapeXml(new URL('/notes/', base).href)}</link>
    <description>更短、更随手的记录。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(new URL('/notes/rss.xml', base).href)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}
