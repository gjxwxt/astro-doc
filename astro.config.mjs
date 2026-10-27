import { fileURLToPath } from 'node:url';

import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site,
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  compressHTML: true,
  prefetch: { prefetchAll: true },
  redirects: {
    '/learn/react-learn': { status: 301, destination: '/docs/learn/react-learn/' },
    '/learn/react-ui': { status: 301, destination: '/docs/learn/react-ui/' },
    '/guides/astro-starlight': { status: 301, destination: '/docs/guides/astro-starlight/' },
    '/guides/qiankun': { status: 301, destination: '/docs/guides/qiankun/' },
    '/tools/website': { status: 301, destination: '/bookmarks/' },
    '/website': { status: 301, destination: '/bookmarks/' },
  },
  integrations: [
    starlight({
      title: 'Josh 的文档',
      description: '前端、工程实践与长期维护的技术笔记。',
      defaultLocale: 'zh-CN',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      logo: {
        src: './src/assets/mark.svg',
        alt: 'Josh',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/gjxwxt' }],
      lastUpdated: true,
      pagination: true,
      pagefind: true,
      credits: false,
      disable404Route: true,
      customCss: ['./src/styles/starlight.css'],
      components: {
        SocialIcons: './src/components/docs/DocsNav.astro',
      },
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0F1F14' } },
        {
          tag: 'link',
          attrs: { rel: 'alternate', type: 'application/rss+xml', title: '笔记 RSS', href: '/notes/rss.xml' },
        },
      ],
      sidebar: [
        { label: '← 回到门户', link: '/' },
        { label: '文档首页', link: '/docs/' },
        {
          label: 'React 学习',
          items: [{ autogenerate: { directory: 'docs/learn' } }],
        },
        {
          label: '工程实践',
          items: [{ autogenerate: { directory: 'docs/guides' } }],
        },
        {
          label: '归档',
          collapsed: true,
          items: [{ autogenerate: { directory: 'docs/archive' } }],
        },
      ],
    }),
    sitemap({
      filter: (page) =>
        !page.includes('/api/') &&
        !page.includes('/search-index') &&
        !page.includes('/notes/rss.xml') &&
        !page.endsWith('/404/'),
    }),
  ],
  vite: {
    ssr: {
      // The standalone Node bundle should not need node_modules on the server.
      noExternal: ['fflate'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3005,
  },
});
