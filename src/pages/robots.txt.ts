export const prerender = true;

export function GET({ site }: { site: URL | undefined }) {
  const base = site ?? new URL('https://example.com');
  const body = `User-agent: *
Allow: /

Sitemap: ${new URL('/sitemap-index.xml', base).href}
`;

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
