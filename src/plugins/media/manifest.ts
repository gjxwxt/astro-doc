import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'media',
  name: '视频链接解析',
  tagline: '先读预览，再交给可配置的解析服务。',
  description:
    '粘贴抖音、B 站、YouTube 等链接，读取标题、封面和描述。配置解析服务后，可以进一步拿到视频直链。',
  icon: 'video',
  status: 'beta',
  tags: ['视频', 'Open Graph', '解析'],
  order: 30,
  actions: [
    {
      id: 'probe',
      label: '读取链接预览',
      description: '抓取页面的 Open Graph 标题、封面和描述。',
      kind: 'server',
      mcp: true,
      input: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            title: '链接',
            required: true,
            format: 'url',
            maxLength: 2000,
          },
        },
        required: ['url'],
      },
    },
    {
      id: 'resolve',
      label: '解析视频地址',
      description: '把链接交给配置好的解析服务，返回视频直链。',
      kind: 'server',
      mcp: true,
      input: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            title: '链接',
            required: true,
            format: 'url',
            maxLength: 2000,
          },
        },
        required: ['url'],
      },
    },
  ],
  config: {
    env: ['MEDIA_RESOLVER_URL', 'MEDIA_RESOLVER_TOKEN'],
    hint: '在 .env 里配置 MEDIA_RESOLVER_URL 后启用视频直链解析；不配置时只做页面预览。',
  },
  notes: [
    '解析服务由你自己部署或选择，本站不内置任何站点的抓取逻辑。',
    '只下载你有权保存的内容，并遵守目标站点的条款。',
  ],
};

export default manifest;
