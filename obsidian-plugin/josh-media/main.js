'use strict';

const {
  FileSystemAdapter,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
  requestUrl,
} = require('obsidian');

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};
const MAX_BYTES = 20 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  portalUrl: 'http://127.0.0.1:4400',
  publicBaseUrl: '',
  token: '',
  pasteImages: true,
  pastePaths: true,
};

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function extOf(name) {
  return path.extname(String(name || '').split(/[?#]/, 1)[0] || '').toLowerCase();
}

function mimeOf(name) {
  return MIME_BY_EXTENSION[extOf(name)] || 'application/octet-stream';
}

function isImageName(name) {
  return IMAGE_EXTENSIONS.has(extOf(name));
}

function isRemoteImage(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return isImageName(url.pathname);
  } catch {
    return false;
  }
}

function isLocalImagePath(text) {
  if (!text || text.includes('\n') || text.includes('\r')) return false;
  if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) return false;
  return isImageName(text);
}

function altFromName(name) {
  return path.basename(String(name || ''), extOf(name)) || 'image';
}

function joinUrl(base, maybeRelative) {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  const root = trimBase(base);
  return `${root}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

function buildMultipart(bytes, filename, mime) {
  const boundary = `----JoshMedia${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename.replace(/["\r\n]/g, '_')}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.byteLength);
  return { boundary, body: body.buffer };
}

async function responseError(response) {
  try {
    const payload = JSON.parse(response.text);
    return payload?.error?.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

class JoshMediaSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Josh Media' });
    containerEl.createEl('p', {
      text: '粘贴图片、图片地址或本地图片路径时，自动上传到 Josh 私有媒体库，并插入 Markdown 链接。',
    });

    new Setting(containerEl)
      .setName('门户地址')
      .setDesc('例如 http://127.0.0.1:4400 或 https://portal.example.com')
      .addText((text) =>
        text
          .setPlaceholder('http://127.0.0.1:4400')
          .setValue(this.plugin.settings.portalUrl)
          .onChange(async (value) => {
            this.plugin.settings.portalUrl = trimBase(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('图片公开地址')
      .setDesc('写进 Markdown 的绝对前缀；留空则使用门户地址。手机访问时必须填服务器可访问地址。')
      .addText((text) =>
        text
          .setPlaceholder('https://portal.example.com')
          .setValue(this.plugin.settings.publicBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.publicBaseUrl = trimBase(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('私有 API Token')
      .setDesc('对应服务端 PRIVATE_API_TOKEN；只保存在本机 Obsidian 配置里。')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('Bearer Token')
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('粘贴图片自动上传')
      .setDesc('拦截剪贴板中的图片文件。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pasteImages).onChange(async (value) => {
          this.plugin.settings.pasteImages = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('粘贴图片地址/路径自动上传')
      .setDesc('只处理单行、以图片扩展名结尾的 http(s) 地址或本地路径。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pastePaths).onChange(async (value) => {
          this.plugin.settings.pastePaths = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('用当前地址和 Token 请求一次私有接口。')
      .addButton((button) =>
        button.setButtonText('测试').onClick(async () => {
          try {
            const result = await requestUrl({
              url: `${trimBase(this.plugin.settings.portalUrl)}/api/fragments?limit=1`,
              method: 'GET',
              headers: { authorization: `Bearer ${this.plugin.settings.token}` },
              throw: false,
            });
            if (result.status >= 200 && result.status < 300) new Notice('Josh 连接正常。');
            else new Notice(`Josh 返回 ${result.status}：${await responseError(result)}`);
          } catch (error) {
            new Notice(`Josh 连接失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }),
      );
  }
}

module.exports = class JoshMediaPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addSettingTab(new JoshMediaSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on('editor-paste', (event, editor) => {
        void this.handlePaste(event, editor);
      }),
    );

    this.addCommand({
      id: 'upload-image-from-url',
      name: '从图片地址上传',
      editorCallback: async (editor) => {
        const value = window.prompt('图片地址或本地路径');
        if (!value) return;
        try {
          const markdown = await this.uploadPathOrUrl(value.trim());
          editor.replaceSelection(markdown);
        } catch (error) {
          new Notice(`上传失败：${error instanceof Error ? error.message : String(error)}`);
        }
      },
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async handlePaste(event, editor) {
    const data = event.clipboardData;
    if (!data) return;

    if (this.settings.pasteImages && data.files && data.files.length > 0) {
      const images = Array.from(data.files).filter((file) => file.type.startsWith('image/') || isImageName(file.name));
      if (images.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        await this.uploadFiles(images, editor);
        return;
      }
    }

    if (!this.settings.pastePaths) return;
    const text = data.getData('text/plain').trim();
    if (!text || (!isRemoteImage(text) && !isLocalImagePath(text))) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      const markdown = await this.uploadPathOrUrl(text);
      editor.replaceSelection(markdown);
    } catch (error) {
      editor.replaceSelection(text);
      new Notice(`Josh 上传失败，已保留原文本：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async uploadFiles(files, editor) {
    const markdown = [];
    for (const file of files) {
      try {
        if (file.size > MAX_BYTES) throw new Error('图片超过 20MB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const url = await this.uploadBytes(bytes, file.name || 'image.png', file.type || mimeOf(file.name));
        markdown.push(`![${altFromName(file.name)}](${url})`);
      } catch (error) {
        new Notice(`Josh 上传失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (markdown.length > 0) editor.replaceSelection(markdown.join('\n'));
  }

  async uploadPathOrUrl(value) {
    if (isRemoteImage(value)) {
      const result = await requestUrl({ url: value, method: 'GET', throw: false });
      if (result.status < 200 || result.status >= 300) throw new Error(`下载图片失败（${result.status}）`);
      const bytes = new Uint8Array(result.arrayBuffer);
      if (bytes.byteLength > MAX_BYTES) throw new Error('图片超过 20MB');
      const name = path.basename(new URL(value).pathname) || 'image.png';
      const url = await this.uploadBytes(bytes, name, mimeOf(name));
      return `![${altFromName(name)}](${url})`;
    }

    const fullPath = this.resolveLocalPath(value);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > MAX_BYTES) throw new Error('图片超过 20MB');
    const bytes = await fs.promises.readFile(fullPath);
    const name = path.basename(fullPath);
    const url = await this.uploadBytes(new Uint8Array(bytes), name, mimeOf(name));
    return `![${altFromName(name)}](${url})`;
  }

  resolveLocalPath(value) {
    const normalized = normalizePath(value.trim());
    const adapter = this.app.vault.adapter;
    if (path.isAbsolute(normalized)) return normalized;
    if (adapter instanceof FileSystemAdapter) return adapter.getFullPath(normalized);
    throw new Error('移动端不能读取本地文件路径，请直接粘贴图片。');
  }

  async uploadBytes(bytes, filename, mime) {
    const settings = this.settings;
    const base = trimBase(settings.portalUrl);
    if (!base) throw new Error('未配置门户地址');
    if (!settings.token) throw new Error('未配置私有 API Token');

    const { boundary, body } = buildMultipart(bytes, filename, mime);
    const response = await requestUrl({
      url: `${base}/api/media/upload`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(await responseError(response));
    }
    const payload = JSON.parse(response.text);
    if (!payload?.ok || !payload?.data?.url) throw new Error('服务端没有返回图片地址');
    const publicBase = trimBase(settings.publicBaseUrl || settings.portalUrl);
    return joinUrl(publicBase, payload.data.url);
  }
};
