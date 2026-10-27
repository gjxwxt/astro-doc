export const siteConfig = {
  name: 'Josh',
  handle: 'gjxwxt',
  title: 'Josh · 文档、笔记与工具',
  description: '文档、笔记、工具和收藏。把学过的东西，做成能用的东西。',
  intro: '个人门户：文档、笔记、工具和收藏。',
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
