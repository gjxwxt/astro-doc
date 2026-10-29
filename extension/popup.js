const DEFAULTS = {
  baseUrl: 'http://localhost:4400',
  token: '',
};

const elements = {
  modeTitle: document.querySelector('[data-mode-title]'),
  settings: document.querySelector('[data-settings]'),
  toggleSettings: document.querySelector('[data-toggle-settings]'),
  baseUrl: document.querySelector('[data-base-url]'),
  token: document.querySelector('[data-token]'),
  saveSettings: document.querySelector('[data-save-settings]'),
  error: document.querySelector('[data-error]'),
  selection: document.querySelector('[data-selection]'),
  quote: document.querySelector('[data-quote]'),
  source: document.querySelector('[data-source]'),
  linkMode: document.querySelector('[data-link-mode]'),
  linkSource: document.querySelector('[data-link-source]'),
  note: document.querySelector('[data-note]'),
  tags: document.querySelector('[data-tags]'),
  save: document.querySelector('[data-save]'),
  status: document.querySelector('[data-status]'),
};

let config = { ...DEFAULTS };
let context = { mode: 'link', url: '', title: '', site: '', quote: '', before: '', after: '' };

function setStatus(message, isError = false) {
  if (!elements.status || !elements.error) return;
  elements.status.textContent = isError ? '' : message;
  elements.error.textContent = isError ? message : '';
}

function tagsFrom(value) {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token']);
  config = {
    baseUrl: String(stored.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    token: String(stored.token || DEFAULTS.token),
  };
  if (elements.baseUrl) elements.baseUrl.value = config.baseUrl;
  if (elements.token) elements.token.value = config.token;
}

async function readContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到当前标签页。');

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const selection = window.getSelection();
      const quote = selection?.toString().trim().slice(0, 20_000) ?? '';
      const anchor = selection?.anchorNode?.parentElement;
      const full = anchor?.innerText ?? '';
      const index = quote ? full.indexOf(quote) : -1;
      const before = index > 0 ? full.slice(Math.max(0, index - 500), index) : '';
      const after =
        index >= 0 ? full.slice(index + quote.length, index + quote.length + 500) : '';

      return {
        quote,
        url: location.href,
        title: document.title,
        site: location.hostname.replace(/^www\./, ''),
        before,
        after,
      };
    },
  });

  const value = result?.result;
  if (!value || typeof value !== 'object') throw new Error('读取当前页面失败。');
  const data = value;
  const quote = String(data.quote || '');
  return {
    mode: quote ? 'quote' : 'link',
    url: String(data.url || ''),
    title: String(data.title || ''),
    site: String(data.site || ''),
    quote,
    before: String(data.before || ''),
    after: String(data.after || ''),
  };
}

function render() {
  if (!elements.modeTitle) return;
  elements.modeTitle.textContent = context.mode === 'quote' ? '保存这段话' : '保存这个链接';
  if (elements.selection) elements.selection.hidden = context.mode !== 'quote';
  if (elements.linkMode) elements.linkMode.hidden = context.mode !== 'link';

  if (elements.quote) elements.quote.textContent = context.quote;
  if (elements.source) {
    elements.source.textContent = [context.site, context.title].filter(Boolean).join(' · ');
  }
  if (elements.linkSource) {
    elements.linkSource.textContent = [context.title, context.url].filter(Boolean).join('\n');
  }
  if (elements.save) elements.save.disabled = !config.token;
  if (!config.token) setStatus('先在设置里填入私有 Token。');
}

async function save() {
  if (!elements.save) return;
  if (!config.token) {
    setStatus('先在设置里填入私有 Token。', true);
    return;
  }

  elements.save.disabled = true;
  setStatus('保存中…');

  try {
    const tags = tagsFrom(elements.tags?.value || '');
    const note = elements.note?.value.trim() || '';
    const endpoint =
      context.mode === 'quote' ? `${config.baseUrl}/api/fragments` : `${config.baseUrl}/api/fragments/link`;
    const payload =
      context.mode === 'quote'
        ? {
            quote: context.quote,
            note,
            tags,
            sourceUrl: context.url,
            sourceTitle: context.title,
            sourceSite: context.site,
            contextBefore: context.before,
            contextAfter: context.after,
          }
        : { url: context.url, note, tags };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 409) {
      setStatus('这条内容已经在 Inbox 里了。');
      return;
    }
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || `保存失败（${response.status}）`);
    }

    setStatus('已进入 Inbox。');
    try {
      await chrome.runtime.sendMessage({ type: 'refresh-menus' });
    } catch {
      /* background may be asleep during a reload */
    }
    if (elements.note) elements.note.value = '';
    if (elements.tags) elements.tags.value = '';
    setTimeout(() => window.close(), 700);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '保存失败。', true);
  } finally {
    elements.save.disabled = !config.token;
  }
}

elements.toggleSettings?.addEventListener('click', () => {
  if (elements.settings) elements.settings.hidden = !elements.settings.hidden;
});

elements.saveSettings?.addEventListener('click', async () => {
  config = {
    baseUrl: String(elements.baseUrl?.value || DEFAULTS.baseUrl).trim().replace(/\/+$/, ''),
    token: String(elements.token?.value || '').trim(),
  };
  await chrome.storage.local.set(config);
  try {
    await chrome.runtime.sendMessage({ type: 'refresh-menus' });
  } catch {
    /* background may be asleep during a reload */
  }
  if (elements.settings) elements.settings.hidden = true;
  if (elements.save) elements.save.disabled = !config.token;
  setStatus(config.token ? '设置已保存。' : '还没有 Token。');
  render();
});

elements.save?.addEventListener('click', () => void save());

(async () => {
  try {
    await loadConfig();
    context = await readContext();
    render();
  } catch (error) {
    if (elements.modeTitle) elements.modeTitle.textContent = '无法采集';
    setStatus(error instanceof Error ? error.message : '读取页面失败。', true);
  }
})();
