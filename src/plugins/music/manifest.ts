import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'music',
  name: '音乐下载',
  tagline: '搜索歌曲，下载 MP3 和歌词。',
  description: '输入歌名或歌手，选一个结果下载标准音质 MP3；有歌词时一起打包。',
  icon: 'music',
  status: 'beta',
  tags: ['音乐', '下载', '歌词'],
  order: 10,
  actions: [
    {
      id: 'search',
      label: '搜索歌曲',
      description: '搜索歌曲，返回可直接下载的结果。',
      kind: 'server',
      mcp: true,
      input: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            title: '关键词',
            description: '歌名、歌手，或「歌名 歌手」',
            required: true,
            minLength: 1,
            maxLength: 80,
            example: '晴天 周杰伦',
          },
          limit: {
            type: 'number',
            title: '数量',
            description: '返回多少条结果',
            default: 12,
            minimum: 1,
            maximum: 20,
          },
        },
        required: ['query'],
      },
    },
    {
      id: 'download',
      label: '下载歌曲',
      description: '下载 MP3，或包含 MP3 与歌词的压缩包。',
      kind: 'server',
      input: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            title: '结果凭证',
            description: '搜索结果里的 token',
            required: true,
            minLength: 1,
            maxLength: 512,
          },
          title: {
            type: 'string',
            title: '歌名',
            maxLength: 120,
          },
          artist: {
            type: 'string',
            title: '歌手',
            maxLength: 120,
          },
          includeLyrics: {
            type: 'boolean',
            title: '附带歌词',
            description: '有歌词时打包成压缩包；没有歌词时只返回 MP3。',
            default: true,
          },
        },
        required: ['token'],
      },
    },
  ],
};

export default manifest;
