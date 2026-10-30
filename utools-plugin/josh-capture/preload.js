'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function expandHome(input) {
  if (input === '~') return require('node:os').homedir();
  if (input.startsWith('~/')) return path.join(require('node:os').homedir(), input.slice(2));
  return input;
}


let localConfig = null;
try {
  const baseDir = typeof __dirname === 'string' ? __dirname : process.cwd();
  const candidates = [
    path.join(baseDir, 'config.local.json'),
    path.join(process.cwd(), 'config.local.json'),
    path.join(process.cwd(), 'utools-plugin', 'josh-capture', 'config.local.json'),
  ];
  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      localConfig = parsed;
      break;
    }
  }
} catch {
  localConfig = null;
}
window.joshLocalConfig = localConfig;

window.joshLocal = {
  readImage(filePath) {
    const resolved = path.resolve(expandHome(String(filePath || '').trim()));
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) throw new Error('只支持 PNG/JPEG/WebP/GIF/AVIF');
    return {
      name: path.basename(resolved),
      mime,
      base64: fs.readFileSync(resolved).toString('base64'),
    };
  },
};
