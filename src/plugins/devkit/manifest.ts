import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'devkit',
  name: '开发者工具',
  tagline: 'JSON、时间戳、Base64 和哈希，一个页面够用。',
  description:
    '几个每天都会用到的小工具。除哈希外都在浏览器里完成，输入不会离开本机。',
  icon: 'code',
  status: 'stable',
  tags: ['JSON', '编码', '哈希'],
  order: 20,
  actions: [
    {
      id: 'hash',
      label: '计算哈希',
      description: '在服务端计算文本的 SHA-256 / SHA-512。',
      kind: 'server',
      mcp: true,
      input: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            title: '文本',
            required: true,
            maxLength: 100000,
          },
          algorithm: {
            type: 'string',
            title: '算法',
            default: 'sha256',
            enum: ['sha256', 'sha512'],
          },
        },
        required: ['text'],
      },
    },
    {
      id: 'json',
      label: 'JSON 格式化',
      description: '格式化、压缩和校验 JSON。',
      kind: 'client',
    },
    {
      id: 'timestamp',
      label: '时间戳转换',
      description: 'Unix 时间戳与本地时间互转。',
      kind: 'client',
    },
    {
      id: 'base64',
      label: 'Base64',
      description: 'UTF-8 安全的 Base64 编码与解码。',
      kind: 'client',
    },
  ],
  notes: ['哈希会发送到本站服务端计算；其余工具完全在浏览器内运行。'],
};

export default manifest;
