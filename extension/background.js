const DEFAULT_BASE_URL = 'http://localhost:4400';
const PARENT_ID = 'josh-inbox';
const TAG_PREFIX = 'josh-inbox-tag:';
const NO_TAG_ID = 'josh-inbox-no-tag';
const SAVE_LINK_ID = 'josh-inbox-save-link';
const SAVE_IMAGE_ID = 'josh-inbox-save-image';
const BATCH_START_ID = 'josh-inbox-batch-start';
const PAGE_EXPLODE_ID = 'josh-inbox-page-explode';
const BATCH_SCRIPT = 'batch.js';
const BATCH_MAX_ITEMS = 50;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function config() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token']);
  return {
    baseUrl: String(stored.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    token: String(stored.token || '').trim(),
  };
}

async function fetchTags(baseUrl, token) {
  if (!token) return [];
  try {
    const response = await fetch(`${baseUrl}/api/fragments?limit=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const tags = data?.data?.tags;
    if (!Array.isArray(tags)) return [];
    return tags
      .map((item) => (item && typeof item.tag === 'string' ? item.tag : ''))
      .filter(Boolean)
      .slice(0, 16);
  } catch {
    return [];
  }
}

function createMenu(details) {
  chrome.contextMenus.create(details, () => {
    // A duplicate ID or a closed service worker should not break the other items.
    void chrome.runtime.lastError;
  });
}

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const { baseUrl, token } = await config();
  const ready = Boolean(token);

  createMenu({
    id: SAVE_LINK_ID,
    title: ready ? '保存链接到半亩 Inbox' : '保存链接（先配置 Token）',
    contexts: ['link'],
    enabled: ready,
  });

  createMenu({
    id: SAVE_IMAGE_ID,
    title: ready ? '保存图片到半亩 Inbox' : '保存图片（先配置 Token）',
    contexts: ['image'],
    enabled: ready,
  });

  createMenu({
    id: BATCH_START_ID,
    title: ready ? '批量标注此页（多段一组）' : '批量标注（先配置 Token）',
    contexts: ['page', 'selection'],
    enabled: ready,
  });

  createMenu({
    id: PAGE_EXPLODE_ID,
    title: ready ? '页面大爆炸（预览后保存）' : '页面大爆炸（先配置 Token）',
    contexts: ['page', 'selection'],
    enabled: ready,
  });

  createMenu({
    id: PARENT_ID,
    title: '存到半亩 Inbox',
    contexts: ['selection'],
  });

  if (!ready) {
    createMenu({
      id: 'josh-inbox-needs-config',
      parentId: PARENT_ID,
      title: '先配置 Token',
      contexts: ['selection'],
      enabled: false,
    });
    return;
  }

  const tags = await fetchTags(baseUrl, token);
  for (const tag of tags) {
    createMenu({
      id: `${TAG_PREFIX}${encodeURIComponent(tag)}`,
      parentId: PARENT_ID,
      title: `#${tag}`,
      contexts: ['selection'],
    });
  }

  if (tags.length > 0) {
    createMenu({
      id: 'josh-inbox-separator',
      parentId: PARENT_ID,
      type: 'separator',
      contexts: ['selection'],
    });
  }

  createMenu({
    id: NO_TAG_ID,
    parentId: PARENT_ID,
    title: '不分类',
    contexts: ['selection'],
  });
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
  }, 1800);
}

async function showToast(tabId, message, tone = 'success') {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text, kind) => {
        const previous = document.getElementById('josh-inbox-toast-host');
        previous?.remove();

        const host = document.createElement('div');
        host.id = 'josh-inbox-toast-host';
        host.style.cssText =
          'all:initial;position:fixed;top:16px;left:50%;z-index:2147483647;transform:translateX(-50%);pointer-events:none;';
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
          .toast {
            max-width: min(78vw, 360px);
            padding: 10px 16px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 999px;
            background: rgba(14, 29, 18, 0.94);
            color: #f2f3ea;
            box-shadow: 0 8px 28px rgba(8, 20, 12, 0.24);
            font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
            letter-spacing: 0.01em;
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
            transition: opacity 160ms ease, transform 180ms ease;
            backdrop-filter: blur(8px);
          }
          .toast.show { opacity: 1; transform: translateY(0) scale(1); }
          .toast[data-tone="error"] { background: rgba(122, 38, 28, 0.96); }
          .toast[data-tone="pending"] { background: rgba(61, 58, 38, 0.95); }
        `;
        const bubble = document.createElement('div');
        bubble.className = 'toast';
        bubble.dataset.tone = String(kind || 'success');
        bubble.textContent = String(text);
        shadow.append(style, bubble);
        document.documentElement.append(host);
        requestAnimationFrame(() => bubble.classList.add('show'));
        window.setTimeout(() => {
          bubble.classList.remove('show');
          window.setTimeout(() => host.remove(), 220);
        }, 1800);
      },
      args: [message, tone],
    });
    return true;
  } catch {
    return false;
  }
}

async function notify(tabId, message, tone = 'success') {
  const shown = await showToast(tabId, message, tone);
  if (!shown) await flashBadge(tone === 'error' ? '!' : '✓', tone === 'error' ? '#b84f3e' : '#2b4a33');
}

async function pageContext(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selection = window.getSelection();
      const quote = selection?.toString().trim().slice(0, 20_000) ?? '';
      const anchor = selection?.anchorNode?.parentElement;
      const full = anchor?.innerText ?? '';
      const index = quote ? full.indexOf(quote) : -1;
      return {
        quote,
        url: location.href,
        title: document.title,
        site: location.hostname.replace(/^www\./, ''),
        before: index > 0 ? full.slice(Math.max(0, index - 500), index) : '',
        after:
          index >= 0 ? full.slice(index + quote.length, index + quote.length + 500) : '',
      };
    },
  });
  const value = result?.result;
  if (!value || typeof value !== 'object') throw new Error('读取页面失败。');
  return value;
}

async function imageContext(tabId, src) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (imageSrc) => {
      const images = [...document.images];
      const image = images.find((item) => item.currentSrc === imageSrc || item.src === imageSrc);
      return {
        alt: image?.alt?.trim() ?? '',
        width: image?.naturalWidth ?? 0,
        height: image?.naturalHeight ?? 0,
        pageUrl: location.href,
        title: document.title,
        site: location.hostname.replace(/^www\./, ''),
      };
    },
    args: [src],
  });
  const value = result?.result;
  if (!value || typeof value !== 'object') throw new Error('读取图片失败。');
  return value;
}

async function saveSelection(info, tab) {
  const { baseUrl, token } = await config();
  if (!token) {
    await notify(tab?.id, '先在扩展设置里填入 Token。', 'error');
    return;
  }
  if (!tab?.id) {
    await flashBadge('!', '#b84f3e');
    return;
  }

  const menuId = String(info.menuItemId);
  const tag =
    menuId === NO_TAG_ID
      ? ''
      : menuId.startsWith(TAG_PREFIX)
        ? decodeURIComponent(menuId.slice(TAG_PREFIX.length))
        : '';

  try {
    const page = await pageContext(tab.id);
    const quote = page.quote || info.selectionText?.trim() || '';
    if (!quote) throw new Error('没有选中文字。');

    const response = await fetch(`${baseUrl}/api/fragments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        quote,
        sourceUrl: page.url,
        sourceTitle: page.title,
        sourceSite: page.site,
        contextBefore: page.before,
        contextAfter: page.after,
        tags: tag ? [tag] : [],
      }),
    });

    if (response.status === 409) {
      await notify(tab.id, '这段话已经在 Inbox 里了。');
      return;
    }
    if (!response.ok) throw new Error(`保存失败（${response.status}）`);
    await notify(tab.id, tag ? `已存入 Inbox · #${tag}` : '已存入 Inbox。');
    await rebuildMenus();
  } catch {
    await notify(tab.id, '保存选段失败，稍后再试。', 'error');
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function filenameFromUrl(value) {
  try {
    const path = new URL(value).pathname;
    return decodeURIComponent(path.split('/').filter(Boolean).pop() || '').slice(0, 120);
  } catch {
    return '';
  }
}

async function saveLink(info, tab) {
  const { baseUrl, token } = await config();
  if (!token) {
    await notify(tab?.id, '先在扩展设置里填入 Token。', 'error');
    return;
  }
  const url = String(info.linkUrl || '');
  if (!isHttpUrl(url)) {
    await notify(tab?.id, '这个链接不能保存。', 'error');
    return;
  }

  await notify(tab?.id, '正在保存链接…', 'pending');
  try {
    const response = await fetch(`${baseUrl}/api/fragments/link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      await notify(tab?.id, '这个链接已经在 Inbox 里了。');
      return;
    }
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || `保存失败（${response.status}）`);
    }
    await notify(tab?.id, '已保存链接到 Inbox。');
    await rebuildMenus();
  } catch {
    await notify(tab?.id, '保存链接失败，稍后再试。', 'error');
  }
}

function absoluteMediaUrl(baseUrl, value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

async function downloadImage(src) {
  const response = await fetch(src, {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`下载图片失败（${response.status}）`);

  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new Error('图片超过 20MB');
  }
  const contentType = String(response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
    throw new Error('远程内容不是图片');
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB');
  if (bytes.byteLength === 0) throw new Error('图片是空的');
  return { bytes, contentType };
}

async function uploadImageToMedia(baseUrl, token, src, image) {
  const response = await fetch(`${baseUrl}/api/media/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': image.contentType || 'application/octet-stream',
      'x-file-name': encodeURIComponent(filenameFromUrl(src) || 'image'),
    },
    body: image.bytes,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data?.data?.url) {
    throw new Error(data?.error?.message || `图片转存失败（${response.status}）`);
  }
  return absoluteMediaUrl(baseUrl, data.data.url);
}

async function saveImage(info, tab) {
  const { baseUrl, token } = await config();
  if (!token) {
    await notify(tab?.id, '先在扩展设置里填入 Token。', 'error');
    return;
  }
  if (!tab?.id) {
    await flashBadge('!', '#b84f3e');
    return;
  }

  const src = String(info.srcUrl || '');
  if (!isHttpUrl(src)) {
    await notify(tab.id, '这张图片不能直接保存。', 'error');
    return;
  }

  await notify(tab.id, '正在转存图片…', 'pending');
  try {
    const page = await imageContext(tab.id, src);
    const quote = page.alt || filenameFromUrl(src) || '图片';
    let storedSrc = src;
    let transferred = false;
    try {
      const image = await downloadImage(src);
      storedSrc = await uploadImageToMedia(baseUrl, token, src, image);
      transferred = true;
    } catch (error) {
      // Keep the original URL if the host blocks downloads or the file is unsupported.
      console.warn('[josh:image-transfer]', error);
    }

    const response = await fetch(`${baseUrl}/api/fragments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kind: 'image',
        quote,
        sourceUrl: page.pageUrl,
        sourceTitle: page.title,
        sourceSite: page.site,
        metadata: {
          image: {
            src: storedSrc,
            remoteSrc: transferred ? src : undefined,
            pageUrl: page.pageUrl,
            alt: page.alt,
            width: page.width,
            height: page.height,
            transferred,
          },
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      await notify(tab.id, '这张图片已经在 Inbox 里了。');
      return;
    }
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || `保存失败（${response.status}）`);
    }
    await notify(
      tab.id,
      transferred ? '图片已转存到半亩媒体库。' : '图片地址已保存（未能转存文件）。',
      transferred ? 'success' : 'pending',
    );
  } catch {
    await notify(tab.id, '保存图片失败，稍后再试。', 'error');
  }
}

function batchGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `batch-${crypto.randomUUID()}`;
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function startBatch(tab) {
  const { baseUrl, token } = await config();
  if (!token) {
    await notify(tab?.id, '先在扩展设置里填入 Token。', 'error');
    return;
  }
  if (!tab?.id) {
    await flashBadge('!', '#b84f3e');
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [BATCH_SCRIPT],
    });
    const tags = await fetchTags(baseUrl, token);
    await chrome.tabs.sendMessage(tab.id, {
      type: 'josh-batch-open',
      tags,
    });
  } catch {
    await notify(tab.id, '这个页面不能批量标注，换一个普通网页试试。', 'error');
  }
}

async function saveBatch(payload) {
  const { baseUrl, token } = await config();
  if (!token) return { ok: false, error: '先在扩展设置里填入 Token。' };
  if (!baseUrl) return { ok: false, error: '没有配置门户地址。' };

  const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
  if (annotations.length === 0) return { ok: false, error: '还没有加入任何选段。' };
  if (annotations.length > BATCH_MAX_ITEMS) {
    return { ok: false, error: `一次最多保存 ${BATCH_MAX_ITEMS} 段。` };
  }

  const tags = Array.isArray(payload?.tags)
    ? payload.tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const groupId = batchGroupId();
  let saved = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of annotations) {
    const quote = String(item?.quote || '').trim().slice(0, 20_000);
    const sourceUrl = String(item?.sourceUrl || '').trim();
    if (!quote || !isHttpUrl(sourceUrl)) {
      failed += 1;
      continue;
    }

    try {
      const response = await fetch(`${baseUrl}/api/fragments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quote,
          groupId,
          sourceUrl,
          sourceTitle: String(item?.sourceTitle || '').slice(0, 500),
          sourceSite: String(item?.sourceSite || '').slice(0, 200),
          contextBefore: String(item?.contextBefore || '').slice(0, 1_000),
          contextAfter: String(item?.contextAfter || '').slice(0, 1_000),
          tags,
        }),
      });

      if (response.status === 401) {
        return { ok: false, error: 'Token 无效或已过期，去扩展设置里更新。' };
      }
      if (response.status === 409) {
        duplicates += 1;
        continue;
      }
      if (!response.ok) {
        failed += 1;
        continue;
      }
      saved += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: saved > 0 || duplicates > 0,
    saved,
    duplicates,
    failed,
    groupId: saved > 0 ? groupId : '',
  };
}

async function startPageExplosion(tab) {
  const { token } = await config();
  if (!token) {
    await notify(tab?.id, '先在扩展设置里填入 Token。', 'error');
    return;
  }
  if (!tab?.id) {
    await flashBadge('!', '#b84f3e');
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['explosion.bundle.js'],
    });
  } catch {
    await notify(tab.id, '这个页面不能打开页面大爆炸，换一个普通网页试试。', 'error');
  }
}

async function savePageAnnotations(payload) {
  const { baseUrl, token } = await config();
  if (!token) return { ok: false, error: '先在扩展设置里填入 Token。' };
  if (!baseUrl) return { ok: false, error: '没有配置门户地址。' };

  const page = payload?.page && typeof payload.page === 'object' ? payload.page : {};
  const annotations = Array.isArray(payload?.annotations) ? payload.annotations.slice(0, 100) : [];
  if (annotations.length === 0) return { ok: false, error: '还没有选中段落。' };

  const tags = Array.isArray(payload?.tags)
    ? payload.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const groupId = batchGroupId();
  let saved = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of annotations) {
    const quote = String(item?.quote || '').trim().slice(0, 20_000);
    const sourceUrl = String(item?.sourceUrl || page.url || '').trim();
    if (!quote || !isHttpUrl(sourceUrl)) {
      failed += 1;
      continue;
    }

    try {
      const response = await fetch(`${baseUrl}/api/fragments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quote,
          groupId,
          sourceUrl,
          sourceTitle: String(item?.sourceTitle || page.title || '').slice(0, 500),
          sourceSite: String(item?.sourceSite || page.site || '').slice(0, 200),
          tags,
        }),
      });

      if (response.status === 401) {
        return { ok: false, error: 'Token 无效或已过期，去扩展设置里更新。' };
      }
      if (response.status === 409) {
        duplicates += 1;
        continue;
      }
      if (!response.ok) {
        failed += 1;
        continue;
      }
      saved += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: saved > 0 || duplicates > 0,
    saved,
    duplicates,
    failed,
    groupId: saved > 0 ? groupId : '',
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void rebuildMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);
  if (menuId === SAVE_LINK_ID) {
    void saveLink(info, tab);
    return;
  }
  if (menuId === SAVE_IMAGE_ID) {
    void saveImage(info, tab);
    return;
  }
  if (menuId === BATCH_START_ID) {
    void startBatch(tab);
    return;
  }
  if (menuId === PAGE_EXPLODE_ID) {
    void startPageExplosion(tab);
    return;
  }
  if (menuId === PARENT_ID || menuId === 'josh-inbox-needs-config') return;
  if (menuId === NO_TAG_ID || menuId.startsWith(TAG_PREFIX)) {
    void saveSelection(info, tab);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'refresh-menus') {
    rebuildMenus()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === 'josh-page-save') {
    savePageAnnotations(message.payload)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: '保存失败，稍后再试。' }));
    return true;
  }
  if (message?.type === 'josh-batch-tags') {
    config()
      .then(({ baseUrl, token }) => fetchTags(baseUrl, token))
      .then((tags) => sendResponse({ ok: true, tags }))
      .catch(() => sendResponse({ ok: false, tags: [] }));
    return true;
  }
  if (message?.type === 'josh-batch-save') {
    saveBatch(message.payload)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: '保存失败，稍后再试。' }));
    return true;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.baseUrl || changes.token) void rebuildMenus();
});
