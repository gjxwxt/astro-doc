'use strict';

const DEFAULT_SETTINGS = {
  portalUrl: 'http://127.0.0.1:4400',
  publicBaseUrl: '',
  token: '',
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];
const MAX_BYTES = 20 * 1024 * 1024;

const els = {
  capturePanel: document.getElementById('capturePanel'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsButton: document.getElementById('settingsButton'),
  content: document.getElementById('content'),
  note: document.getElementById('note'),
  tags: document.getElementById('tags'),
  sourceUrl: document.getElementById('sourceUrl'),
  imageList: document.getElementById('imageList'),
  fileInput: document.getElementById('fileInput'),
  saveButton: document.getElementById('saveButton'),
  readClipboard: document.getElementById('readClipboard'),
  readClipboardImage: document.getElementById('readClipboardImage'),
  pickImage: document.getElementById('pickImage'),
  status: document.getElementById('status'),
  portalUrl: document.getElementById('portalUrl'),
  publicBaseUrl: document.getElementById('publicBaseUrl'),
  token: document.getElementById('token'),
  testButton: document.getElementById('testButton'),
  saveSettingsButton: document.getElementById('saveSettingsButton'),
  settingsStatus: document.getElementById('settingsStatus'),
};

let settings = { ...DEFAULT_SETTINGS };
let mode = 'auto';
let images = [];
let busy = false;

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function loadSettings() {
  let saved = null;
  try {
    saved = window.utools?.dbStorage?.getItem('josh:settings');
    if (typeof saved === 'string') saved = JSON.parse(saved);
  } catch {
    saved = null;
  }
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem('josh:settings') || 'null');
    } catch {
      saved = null;
    }
  }
  settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  fillSettings();
}

function saveSettings() {
  settings = {
    portalUrl: trimBase(els.portalUrl.value) || DEFAULT_SETTINGS.portalUrl,
    publicBaseUrl: trimBase(els.publicBaseUrl.value),
    token: els.token.value.trim(),
  };
  const serialized = JSON.stringify(settings);
  try {
    window.utools?.dbStorage?.setItem('josh:settings', serialized);
  } catch {
    // Fall through to localStorage for browser preview.
  }
  try {
    localStorage.setItem('josh:settings', serialized);
  } catch {
    // Ignore storage failures.
  }
  setStatus(els.settingsStatus, '设置已保存。', 'ok');
}

function fillSettings() {
  els.portalUrl.value = settings.portalUrl;
  els.publicBaseUrl.value = settings.publicBaseUrl;
  els.token.value = settings.token;
}

function setStatus(element, text, kind = '') {
  element.textContent = text;
  element.classList.toggle('is-error', kind === 'error');
  element.classList.toggle('is-ok', kind === 'ok');
}

function setBusy(next) {
  busy = next;
  els.saveButton.disabled = next;
  els.saveButton.textContent = next ? '保存中…' : '存入 Inbox';
}

function normalizeTags(value) {
  return [...new Set(String(value || '').split(/[,\s，、#]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageUrl(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

function looksLikeImagePath(value) {
  const text = String(value || '').trim();
  if (!text || text.includes('\n') || text.includes('\r')) return false;
  if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) return false;
  const clean = text.split(/[?#]/, 1)[0].toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => clean.endsWith(ext));
}

function altFromName(name) {
  const base = String(name || 'image').split('/').pop() || 'image';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(0, index) : base;
}

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/avif') return 'avif';
  return 'png';
}

function joinUrl(base, maybeRelative) {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return `${trimBase(base)}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`;
}

async function api(path, options = {}) {
  const base = trimBase(settings.portalUrl);
  if (!base) throw new Error('未配置门户地址');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `请求失败（${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

async function uploadFile(file) {
  if (file.size > MAX_BYTES) throw new Error('图片超过 20MB');
  const base = trimBase(settings.portalUrl);
  if (!base) throw new Error('未配置门户地址');
  if (!settings.token) throw new Error('未配置私有 API Token');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const response = await fetch(`${base}/api/media/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings.token}`,
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name || `image.${extFromMime(file.type)}`),
    },
    body: bytes,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `上传失败（${response.status}）`;
    throw new Error(message);
  }
  return joinUrl(settings.publicBaseUrl || settings.portalUrl, payload.data.url);
}

async function saveLink(url) {
  return api('/api/fragments/link', {
    method: 'POST',
    body: JSON.stringify({
      url,
      note: els.note.value.trim(),
      tags: normalizeTags(els.tags.value),
    }),
  });
}

async function saveQuote(text, sourceUrl) {
  return api('/api/fragments', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'quote',
      quote: text,
      note: els.note.value.trim(),
      tags: normalizeTags(els.tags.value),
      ...(sourceUrl ? { sourceUrl } : {}),
    }),
  });
}

async function saveImageUrl(url) {
  const source = isHttpUrl(els.sourceUrl.value.trim()) ? els.sourceUrl.value.trim() : url;
  const alt = altFromName(new URL(url).pathname);
  return api('/api/fragments', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'image',
      quote: alt,
      note: els.note.value.trim(),
      tags: normalizeTags(els.tags.value),
      sourceUrl: source,
      metadata: { image: { src: url, pageUrl: source, alt } },
    }),
  });
}

async function saveImageFile(file) {
  const url = await uploadFile(file);
  const source = isHttpUrl(els.sourceUrl.value.trim()) ? els.sourceUrl.value.trim() : url;
  const alt = altFromName(file.name);
  return api('/api/fragments', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'image',
      quote: alt,
      note: els.note.value.trim(),
      tags: normalizeTags(els.tags.value),
      sourceUrl: source,
      metadata: { image: { src: url, pageUrl: source, alt } },
    }),
  });
}

function renderImages() {
  els.imageList.hidden = images.length === 0;
  els.imageList.replaceChildren();
  images.forEach((item, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = item.preview;
    img.alt = item.file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = '移除';
    remove.addEventListener('click', () => {
      URL.revokeObjectURL(item.preview);
      images.splice(index, 1);
      renderImages();
    });
    thumb.append(img, remove);
    els.imageList.append(thumb);
  });
}

function addFiles(files) {
  let added = 0;
  for (const file of Array.from(files || [])) {
    if (!file || !String(file.type || '').startsWith('image/')) continue;
    if (file.size > MAX_BYTES) {
      setStatus(els.status, `${file.name} 超过 20MB，已跳过。`, 'error');
      continue;
    }
    images.push({ file, preview: URL.createObjectURL(file) });
    added += 1;
  }
  if (added > 0) {
    mode = 'image';
    syncMode();
    renderImages();
    els.content.value = '';
  }
  return added;
}

function addBase64Image(name, mime, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], name, { type: mime });
  return addFiles([file]) > 0;
}

async function addLocalPath(value, quiet = false) {
  if (!looksLikeImagePath(value)) return false;
  if (!window.joshLocal?.readImage) {
    if (!quiet) setStatus(els.status, '当前环境不能读取本地路径，请拖入图片。', 'error');
    return false;
  }
  try {
    const info = window.joshLocal.readImage(value);
    const ok = addBase64Image(info.name, info.mime, info.base64);
    if (ok && !quiet) setStatus(els.status, `已加入 ${info.name}。`, 'ok');
    return ok;
  } catch (error) {
    if (!quiet) setStatus(els.status, error instanceof Error ? error.message : String(error), 'error');
    return false;
  }
}

function syncMode() {
  document.querySelectorAll('.mode').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
}

function clearCapture() {
  for (const item of images) URL.revokeObjectURL(item.preview);
  images = [];
  renderImages();
  els.content.value = '';
  els.note.value = '';
  els.tags.value = '';
  els.sourceUrl.value = '';
  mode = 'auto';
  syncMode();
  setStatus(els.status, '');
}

async function readClipboardText() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      await readClipboardImage();
      return;
    }
    els.content.value = text.trim();
    if (looksLikeImagePath(text.trim())) await addLocalPath(text.trim());
    else setStatus(els.status, '已读取剪贴板。', 'ok');
  } catch (error) {
    setStatus(els.status, `读取剪贴板失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

async function readClipboardImage() {
  if (!navigator.clipboard?.read) {
    setStatus(els.status, '当前环境不支持读图片，请按 ⌘/Ctrl+V 粘贴。', 'error');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    let found = 0;
    for (const item of items) {
      const type = item.types.find((value) => value.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      found += addFiles([new File([blob], `clipboard.${extFromMime(type)}`, { type })]);
    }
    setStatus(els.status, found > 0 ? '已读取剪贴板图片。' : '剪贴板没有图片。', found > 0 ? 'ok' : 'error');
  } catch (error) {
    setStatus(els.status, `读取图片失败：${error instanceof Error ? error.message : String(error)}；可直接按 ⌘/Ctrl+V。`, 'error');
  }
}

async function save() {
  if (busy) return;
  setBusy(true);
  setStatus(els.status, '正在保存…');

  try {
    if (images.length > 0) {
      for (const item of images) await saveImageFile(item.file);
      const count = images.length;
      clearCapture();
      setStatus(els.status, `已存入 ${count} 张图片到 Inbox。`, 'ok');
      notify('Josh：图片已存入 Inbox');
      return;
    }

    let text = els.content.value.trim();
    if (!text) throw new Error('还没有内容。');
    if (looksLikeImagePath(text)) {
      const ok = await addLocalPath(text, true);
      if (ok) {
        const count = images.length;
        for (const item of images) await saveImageFile(item.file);
        clearCapture();
        setStatus(els.status, `已存入 ${count} 张图片到 Inbox。`, 'ok');
        notify('Josh：图片已存入 Inbox');
        return;
      }
    }

    const source = isHttpUrl(els.sourceUrl.value.trim()) ? els.sourceUrl.value.trim() : '';
    if (mode === 'link' || (mode === 'auto' && isHttpUrl(text) && !isImageUrl(text))) {
      await saveLink(text);
      setStatus(els.status, '链接已存入 Inbox。', 'ok');
    } else if (mode === 'image' || (mode === 'auto' && isImageUrl(text))) {
      await saveImageUrl(text);
      setStatus(els.status, '图片地址已存入 Inbox。', 'ok');
    } else {
      await saveQuote(text, source);
      setStatus(els.status, '引用已存入 Inbox。', 'ok');
    }
    const savedMessage = els.status.textContent;
    clearCapture();
    setStatus(els.status, savedMessage, 'ok');
    notify('Josh：已存入 Inbox');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && error.status === 409) setStatus(els.status, '这条已经在 Inbox 里了。', 'ok');
    else setStatus(els.status, `保存失败：${message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function notify(text) {
  try {
    window.utools?.showNotification?.(text);
  } catch {
    // Notification is optional.
  }
}

function showSettings(next) {
  els.capturePanel.hidden = next;
  els.settingsPanel.hidden = !next;
  els.settingsButton.textContent = next ? '返回' : '设置';
  if (next) fillSettings();
}

async function testConnection() {
  setStatus(els.settingsStatus, '正在测试…');
  try {
    const base = trimBase(els.portalUrl.value);
    const response = await fetch(`${base}/api/fragments?limit=1`, {
      headers: { authorization: `Bearer ${els.token.value.trim()}` },
    });
    if (response.ok) setStatus(els.settingsStatus, '连接正常。', 'ok');
    else setStatus(els.settingsStatus, `连接失败（${response.status}）。`, 'error');
  } catch (error) {
    setStatus(els.settingsStatus, `连接失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function bind() {
  document.querySelectorAll('.mode').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode || 'auto';
      syncMode();
    });
  });
  els.saveButton.addEventListener('click', () => void save());
  els.readClipboard.addEventListener('click', () => void readClipboardText());
  els.readClipboardImage.addEventListener('click', () => void readClipboardImage());
  els.pickImage.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });
  els.settingsButton.addEventListener('click', () => showSettings(els.settingsPanel.hidden));
  els.saveSettingsButton.addEventListener('click', () => {
    saveSettings();
    setStatus(els.status, '连接设置已更新。', 'ok');
  });
  els.testButton.addEventListener('click', () => void testConnection());

  document.addEventListener('paste', (event) => {
    const files = event.clipboardData?.files;
    if (files && files.length > 0 && addFiles(files) > 0) event.preventDefault();
  });

  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
    if (event.key === 'Escape' && !els.settingsPanel.hidden) showSettings(false);
  });

  // Paste a local path as text and press save; also offer immediate import.
  els.content.addEventListener('paste', () => {
    window.setTimeout(() => {
      const value = els.content.value.trim();
      if (looksLikeImagePath(value)) void addLocalPath(value);
    }, 0);
  });
}

async function quickSaveSelection(value) {
  const text = String(value || '').trim();
  if (!text) return;
  try {
    if (isImageUrl(text)) {
      const alt = altFromName(new URL(text).pathname);
      await api('/api/fragments', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'image',
          quote: alt,
          sourceUrl: text,
          metadata: { image: { src: text, pageUrl: text, alt } },
        }),
      });
    } else if (isHttpUrl(text)) {
      await api('/api/fragments/link', {
        method: 'POST',
        body: JSON.stringify({ url: text }),
      });
    } else {
      await api('/api/fragments', {
        method: 'POST',
        body: JSON.stringify({ kind: 'quote', quote: text }),
      });
    }
    notify('Josh：已存入 Inbox');
    window.setTimeout(() => window.utools?.outPlugin?.(), 220);
  } catch (error) {
    if (error && error.status === 409) {
      notify('Josh：这条已经在 Inbox 里了');
      window.setTimeout(() => window.utools?.outPlugin?.(), 220);
      return;
    }
    els.content.value = text;
    setStatus(els.status, `秒存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function handleEnter(enter) {
  const code = enter?.code;
  const type = enter?.type;
  const payload = enter?.payload;
  clearCapture();
  showSettings(false);
  loadSettings();

  const payloadText = typeof payload === 'string' ? payload.trim() : '';
  if (code === 'quick-selection' && payloadText) {
    els.content.value = payloadText;
    void quickSaveSelection(payloadText);
    return;
  }

  if (payloadText) {
    if (type === 'img' && payloadText.startsWith('data:image/')) {
      const match = payloadText.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (match) addBase64Image(`clipboard.${extFromMime(match[1])}`, match[1], match[2]);
    } else {
      els.content.value = payloadText;
      if (looksLikeImagePath(payloadText)) void addLocalPath(payloadText);
    }
  } else if (Array.isArray(payload) && payload.length > 0) {
    for (const item of payload) {
      if (typeof item === 'string') void addLocalPath(item);
    }
  }

  window.setTimeout(() => els.content.focus(), 30);
}

function init() {
  loadSettings();
  bind();
  syncMode();

  if (window.utools) {
    window.utools.onPluginEnter(handleEnter);
    window.utools.onPluginOut(() => {
      // Keep the draft across quick re-entry; only reset the transient error.
      setStatus(els.status, '');
    });
  }
}

init();
