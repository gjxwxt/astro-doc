export const siteConfig = {
  name: '半亩',
  latin: 'Bothy',
  author: 'Josh',
  handle: 'gjxwxt',
  title: '半亩 · 文档、笔记与工具',
  description: '留一点自己的东西。文档、笔记、工具和收藏。',
  intro: '留一点自己的东西。',
  github: 'https://github.com/gjxwxt',
  nav: [
    { label: '文档', href: '/docs/' },
    { label: '资料库', href: '/library/' },
    { label: '笔记', href: '/notes/' },
    { label: '工具', href: '/tools/' },
    { label: '收藏', href: '/bookmarks/' },
    { label: '关于', href: '/about/' },
  ],
  now: '在维护这个站，顺便把常用的小工具一个个接进来。',
  /**
   * 公开评论：使用 GitHub Discussions + Giscus。
   * 填好 repo / repoId / categoryId 后自动出现在笔记和文档页面底部。
   * https://giscus.app/zh-CN
   */
  giscus: {
    repo: '',
    repoId: '',
    category: 'Announcements',
    categoryId: '',
    mapping: 'pathname',
    strict: false,
    reactionsEnabled: true,
    inputPosition: 'top',
    lang: 'zh-CN',
  },
} as const;

export type SiteConfig = typeof siteConfig;
