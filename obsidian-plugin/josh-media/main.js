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
  legacyBaseUrls: [],
  backupBeforeRewrite: true,
  token: '',
  pasteImages: true,
  pastePaths: true,
};

const MEDIA_PATH_RE = /^(?:\/[^/]+)*\/media\/[a-f0-9]{64}\.(?:png|jpe?g|webp|gif|avif)$/i;
const MEDIA_URL_RE = /https?:\/\/[^\s)\]"'<>]+/gi;

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

function parseBaseList(value) {
  const lines = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return [...new Set(lines.map(trimBase).filter(Boolean))];
}

function isJoshMediaPath(pathname) {
  return MEDIA_PATH_RE.test(pathname);
}

let uploadPlaceholderCounter = 0;

function makeUploadPlaceholder() {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${++uploadPlaceholderCounter}`;
  return `⏳ 正在上传图片…<!--josh-upload:${id}-->`;
}

function replaceUploadPlaceholder(editor, placeholder, replacement) {
  const source = editor.getValue();
  const start = source.indexOf(placeholder);
  if (start < 0) return false;
  editor.replaceRange(
    replacement,
    editor.offsetToPos(start),
    editor.offsetToPos(start + placeholder.length),
  );
  return true;
}

function rewriteMediaUrl(rawUrl, oldBases, newBase) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isJoshMediaPath(url.pathname)) return null;

  for (const rawBase of oldBases) {
    let oldBase;
    try {
      oldBase = new URL(trimBase(rawBase));
    } catch {
      continue;
    }
    if (oldBase.origin !== url.origin) continue;
    const prefix = oldBase.pathname.replace(/\/+$/, '');
    if (prefix && !url.pathname.startsWith(`${prefix}/media/`)) continue;
    if (!prefix && !url.pathname.startsWith('/media/')) continue;
    const suffix = `${url.pathname.slice(prefix.length)}${url.search}${url.hash}`;
    const next = `${trimBase(newBase)}${suffix}`;
    return next === rawUrl ? null : next;
  }
  return null;
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
      .setName('旧图片地址')
      .setDesc('每行一个旧前缀，例如 http://127.0.0.1:4400 或 https://旧的服务器地址。只重写 /media/<hash> 图片地址。')
      .addTextArea((area) => {
        area.inputEl.rows = 4;
        area
          .setPlaceholder('http://127.0.0.1:4400\nhttps://old.example.com')
          .setValue((this.plugin.settings.legacyBaseUrls || []).join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.legacyBaseUrls = parseBaseList(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('重写前备份')
      .setDesc('把修改前的 Markdown 备份到 vault 的 .josh-media-backup/<时间>/。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.backupBeforeRewrite).onChange(async (value) => {
          this.plugin.settings.backupBeforeRewrite = value;
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
        const placeholder = makeUploadPlaceholder();
        editor.replaceSelection(placeholder);
        try {
          const markdown = await this.uploadPathOrUrl(value.trim());
          if (!replaceUploadPlaceholder(editor, placeholder, markdown)) {
            editor.replaceSelection(markdown);
          }
        } catch (error) {
          if (!replaceUploadPlaceholder(editor, placeholder, '')) {
            editor.replaceSelection(value.trim());
          }
          new Notice(`上传失败：${error instanceof Error ? error.message : String(error)}`);
        }
      },
    });

    this.addCommand({
      id: 'check-josh-media-base',
      name: '检查 Josh 媒体地址',
      callback: () => void this.rewriteMediaBase(true),
    });

    this.addCommand({
      id: 'rewrite-josh-media-base',
      name: '重写 Josh 媒体地址',
      callback: () => void this.rewriteMediaBase(false),
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
    const placeholder = makeUploadPlaceholder();
    editor.replaceSelection(placeholder);
    try {
      const markdown = await this.uploadPathOrUrl(text);
      if (!replaceUploadPlaceholder(editor, placeholder, markdown)) {
        editor.replaceSelection(markdown);
      }
    } catch (error) {
      if (!replaceUploadPlaceholder(editor, placeholder, text)) {
        editor.replaceSelection(text);
      }
      new Notice(`Josh 上传失败，已保留原文本：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async uploadFiles(files, editor) {
    const pending = files.map((file) => ({ file, placeholder: makeUploadPlaceholder() }));
    editor.replaceSelection(pending.map((item) => item.placeholder).join('\n'));

    for (const item of pending) {
      try {
        if (item.file.size > MAX_BYTES) throw new Error('图片超过 20MB');
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const url = await this.uploadBytes(
          bytes,
          item.file.name || 'image.png',
          item.file.type || mimeOf(item.file.name),
        );
        const markdown = `![${altFromName(item.file.name)}](${url})`;
        if (!replaceUploadPlaceholder(editor, item.placeholder, markdown)) {
          editor.replaceSelection(markdown);
        }
      } catch (error) {
        replaceUploadPlaceholder(editor, item.placeholder, '');
        new Notice(`Josh 上传失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
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

    const response = await requestUrl({
      url: `${base}/api/media/upload`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.token}`,
        'content-type': mime || mimeOf(filename),
        'x-file-name': encodeURIComponent(filename),
      },
      body: bytes.buffer,
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

  async collectMediaRewritePlan() {
    const oldBases = parseBaseList(this.settings.legacyBaseUrls);
    const newBase = trimBase(this.settings.publicBaseUrl || this.settings.portalUrl);
    if (oldBases.length === 0) throw new Error('请先在设置里填写「旧图片地址」');
    if (!newBase) throw new Error('请先填写「图片公开地址」或「门户地址」');

    const plan = [];
    let total = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.read(file);
      let count = 0;
      const next = content.replace(MEDIA_URL_RE, (match) => {
        const rewritten = rewriteMediaUrl(match, oldBases, newBase);
        if (!rewritten) return match;
        count += 1;
        return rewritten;
      });
      if (count > 0) {
        plan.push({ file, content, next, count });
        total += count;
      }
    }
    return { plan, total, oldBases, newBase };
  }

  async ensureFolder(folderPath) {
    const parts = normalizePath(folderPath).split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const current = parts.slice(0, i).join('/');
      try {
        await this.app.vault.adapter.mkdir(current);
      } catch {
        // mkdir is not idempotent in every adapter; ignore existing folders.
      }
    }
  }

  async backupMediaFile(file, content, backupRoot) {
    const target = normalizePath(`${backupRoot}/${file.path}`);
    await this.ensureFolder(target.split('/').slice(0, -1).join('/'));
    await this.app.vault.adapter.write(target, content);
  }

  async rewriteMediaBase(dryRun) {
    let result;
    try {
      result = await this.collectMediaRewritePlan();
    } catch (error) {
      new Notice(`Josh：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const { plan, total, oldBases, newBase } = result;
    if (plan.length === 0) {
      new Notice(`Josh：没有找到可重写的媒体地址（当前前缀 ${newBase}）`);
      return;
    }

    const fileCount = plan.length;
    if (dryRun) {
      new Notice(`Josh：将修改 ${fileCount} 篇笔记、${total} 个图片地址 → ${newBase}\n旧地址：${oldBases.join(', ')}`, 8000);
      return;
    }

    const confirmed = window.confirm(
      `将修改 ${fileCount} 篇笔记、${total} 个 Josh 图片地址。\n\n` +
        `旧地址：\n${oldBases.join('\n')}\n\n新地址：\n${newBase}\n\n继续？`,
    );
    if (!confirmed) return;

    const backupRoot = `.josh-media-backup/${new Date().toISOString().replace(/[:.]/g, '-')}`;
    let changedFiles = 0;
    let changedLinks = 0;
    const failures = [];

    for (const item of plan) {
      try {
        if (this.settings.backupBeforeRewrite) {
          await this.backupMediaFile(item.file, item.content, backupRoot);
        }
        await this.app.vault.modify(item.file, item.next);
        changedFiles += 1;
        changedLinks += item.count;
      } catch (error) {
        failures.push(`${item.file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const backupNote = this.settings.backupBeforeRewrite ? `；备份：${backupRoot}` : '';
    if (failures.length === 0) {
      new Notice(`Josh：已重写 ${changedFiles} 篇、${changedLinks} 个图片地址${backupNote}`, 8000);
    } else {
      new Notice(
        `Josh：重写 ${changedFiles} 篇、${changedLinks} 个地址；${failures.length} 篇失败${backupNote}\n${failures.slice(0, 3).join('\n')}`,
        12000,
      );
    }
  }
};

module.exports._test = { parseBaseList, rewriteMediaUrl, isJoshMediaPath };
