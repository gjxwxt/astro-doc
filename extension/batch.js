(() => {
  if (window.__joshBatchInjected) {
    window.__joshBatchOpen?.();
    return;
  }
  window.__joshBatchInjected = true;

  const HOST_ID = 'josh-batch-host';
  const MAX_ITEMS = 50;
  const MAX_QUOTE = 20_000;
  const MAX_CONTEXT = 500;

  let host = null;
  let shadow = null;
  let panel = null;
  let tagRow = null;
  let list = null;
  let countNode = null;
  let saveButton = null;
  let statusNode = null;
  let floatButton = null;

  let open = false;
  let annotations = [];
  let tags = [];
  let activeTag = '';
  let pending = null;
  let closeTimer = 0;

  function makeNode(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function ensureUi() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'all:initial;position:fixed;right:14px;bottom:14px;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .panel {
        width: min(320px, calc(100vw - 28px));
        max-height: min(72vh, 580px);
        display: none;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(31, 58, 42, 0.24);
        border-radius: 15px;
        background: #f7f5ea;
        box-shadow: 0 18px 48px rgba(8, 20, 12, 0.24);
        color: #1d2b21;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        pointer-events: auto;
      }
      .panel.is-open { display: flex; }
      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 14px 15px 10px;
        border-bottom: 1px solid rgba(31, 58, 42, 0.12);
      }
      .head b { display: block; font-size: 14px; letter-spacing: -0.01em; }
      .head small { display: block; margin-top: 2px; color: #66766b; font-size: 11px; }
      .close {
        width: 24px;
        height: 24px;
        border: 1px solid rgba(31, 58, 42, 0.18);
        border-radius: 50%;
        background: transparent;
        color: #526258;
        font: 16px/1 -apple-system, BlinkMacSystemFont, sans-serif;
        cursor: pointer;
      }
      .close:hover { background: rgba(31, 58, 42, 0.06); color: #1d2b21; }
      .hint {
        margin: 0;
        padding: 10px 15px 0;
        color: #66766b;
        font-size: 11.5px;
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        padding: 9px 15px 2px;
      }
      .tag {
        padding: 2px 8px;
        border: 1px solid rgba(31, 58, 42, 0.16);
        border-radius: 999px;
        background: transparent;
        color: #526258;
        font: inherit;
        font-size: 10.5px;
        cursor: pointer;
      }
      .tag:hover { border-color: rgba(31, 58, 42, 0.4); color: #1d2b21; }
      .tag.is-active {
        border-color: #2b4a33;
        background: #2b4a33;
        color: #f7f5ea;
      }
      .summary {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 15px 0;
        color: #66766b;
        font-size: 11px;
      }
      .summary b { color: #2b4a33; font-size: 15px; }
      .list {
        display: grid;
        gap: 6px;
        max-height: 190px;
        margin: 0;
        padding: 9px 15px 3px;
        overflow: auto;
        list-style: none;
      }
      .list:empty { display: none; }
      .item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 8px;
        border: 1px solid rgba(31, 58, 42, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.45);
      }
      .item span {
        display: -webkit-box;
        overflow: hidden;
        color: #33443a;
        font-size: 11px;
        line-height: 1.45;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .remove {
        flex: 0 0 auto;
        padding: 0;
        border: 0;
        background: transparent;
        color: #8b6a62;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 15px 13px;
        border-top: 1px solid rgba(31, 58, 42, 0.12);
      }
      .save {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #2b4a33;
        border-radius: 999px;
        background: #2b4a33;
        color: #f7f5ea;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .save:hover { background: #1f3a2a; }
      .save:disabled { opacity: 0.45; cursor: default; }
      .exit {
        padding: 8px 4px;
        border: 0;
        background: transparent;
        color: #66766b;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .status {
        min-height: 16px;
        margin: 0;
        padding: 0 15px 10px;
        color: #526258;
        font-size: 10.5px;
      }
      .status[data-tone="error"] { color: #a24332; }
      .status[data-tone="pending"] { color: #82672e; }
      .float {
        position: fixed;
        display: none;
        z-index: 2147483647;
        padding: 6px 11px;
        border: 1px solid rgba(31, 58, 42, 0.2);
        border-radius: 999px;
        background: #2b4a33;
        box-shadow: 0 8px 22px rgba(8, 20, 12, 0.22);
        color: #f7f5ea;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
        cursor: pointer;
        pointer-events: auto;
      }
      .float:hover { background: #1f3a2a; }
    `;
    shadow.append(style);

    panel = makeNode('section', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '批量标注到半亩 Inbox');

    const head = makeNode('header', 'head');
    const title = makeNode('div', '');
    const titleText = makeNode('b', '', '批量标注');
    const subtitle = makeNode('small', '', '同页多段，保存后归为一组');
    title.append(titleText, subtitle);
    const close = makeNode('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '收起批量标注');
    close.addEventListener('click', () => setOpen(false));
    head.append(title, close);

    const hint = makeNode('p', 'hint', '选中文字 → 点“加入组”；可连续加入多段。');
    tagRow = makeNode('div', 'tags');
    tagRow.setAttribute('aria-label', '批量标签');

    const summary = makeNode('div', 'summary');
    const summaryText = makeNode('span', '', '已加入');
    const summaryValue = makeNode('span', '');
    countNode = makeNode('b', '', '0');
    summaryValue.append(countNode, document.createTextNode(' 段'));
    summary.append(summaryText, summaryValue);

    list = makeNode('ul', 'list');
    list.setAttribute('aria-label', '已加入的选段');

    const foot = makeNode('footer', 'foot');
    saveButton = makeNode('button', 'save', '保存为组');
    saveButton.type = 'button';
    saveButton.disabled = true;
    saveButton.addEventListener('click', save);
    const exit = makeNode('button', 'exit', '退出');
    exit.type = 'button';
    exit.addEventListener('click', () => {
      reset();
      destroy();
    });
    foot.append(saveButton, exit);

    statusNode = makeNode('p', 'status');
    statusNode.setAttribute('aria-live', 'polite');

    panel.append(head, hint, tagRow, summary, list, foot, statusNode);
    shadow.append(panel);

    floatButton = makeNode('button', 'float', '+ 加入组');
    floatButton.type = 'button';
    floatButton.addEventListener('mousedown', (event) => event.preventDefault());
    floatButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      addPending();
    });
    shadow.append(floatButton);

    document.documentElement.append(host);
  }

  function setStatus(text, tone = '') {
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.dataset.tone = tone;
  }

  function setOpen(value) {
    ensureUi();
    if (value) {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    }
    open = value;
    panel.classList.toggle('is-open', value);
    if (!value) hideFloat();
    if (value) {
      renderTags();
      renderList();
      if (tags.length === 0) requestTags();
      setTimeout(handleSelection, 60);
    }
  }

  function renderTags() {
    if (!tagRow) return;
    tagRow.replaceChildren();
    const values = [''].concat(tags);
    for (const value of values) {
      const button = makeNode('button', 'tag', value || '不分类');
      button.type = 'button';
      button.classList.toggle('is-active', value === activeTag);
      button.setAttribute('aria-pressed', String(value === activeTag));
      button.addEventListener('click', () => {
        activeTag = value;
        renderTags();
      });
      tagRow.append(button);
    }
  }

  function renderList() {
    if (!list || !countNode || !saveButton) return;
    list.replaceChildren();
    countNode.textContent = String(annotations.length);
    saveButton.disabled = annotations.length === 0;
    saveButton.textContent = '保存为组';

    annotations.forEach((item, index) => {
      const row = makeNode('li', 'item');
      const quote = makeNode('span', '', item.quote);
      const remove = makeNode('button', 'remove', '移除');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除第 ${index + 1} 段`);
      remove.addEventListener('click', () => {
        annotations.splice(index, 1);
        renderList();
        setStatus('');
      });
      row.append(quote, remove);
      list.append(row);
    });
  }

  function selectionSnapshot() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const raw = selection.toString().trim();
    if (!raw) return null;
    const quote = raw.slice(0, MAX_QUOTE);
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const anchor = selection.anchorNode?.parentElement;
    const full = anchor?.innerText ?? '';
    const index = quote ? full.indexOf(quote) : -1;
    return {
      quote,
      sourceUrl: location.href,
      sourceTitle: document.title.slice(0, 500),
      sourceSite: location.hostname.replace(/^www\./, '').slice(0, 200),
      contextBefore:
        index > 0 ? full.slice(Math.max(0, index - MAX_CONTEXT), index) : '',
      contextAfter:
        index >= 0
          ? full.slice(index + quote.length, index + quote.length + MAX_CONTEXT)
          : '',
      rect: {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  function hideFloat() {
    if (floatButton) floatButton.style.display = 'none';
    pending = null;
  }

  function positionFloat(rect) {
    if (!floatButton) return;
    const width = 104;
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const top =
      rect.top > 48 ? rect.top - 38 : Math.min(window.innerHeight - 40, rect.bottom + 8);
    floatButton.style.left = `${left}px`;
    floatButton.style.top = `${Math.max(margin, top)}px`;
    floatButton.style.display = 'block';
  }

  function handleSelection() {
    if (!open) return;
    const snapshot = selectionSnapshot();
    if (!snapshot) {
      hideFloat();
      return;
    }
    pending = snapshot;
    positionFloat(snapshot.rect);
  }

  function addPending() {
    if (!pending) return;
    const duplicate = annotations.some(
      (item) => item.quote === pending.quote && item.sourceUrl === pending.sourceUrl,
    );
    if (duplicate) {
      setStatus('这一段已经加过了。', 'pending');
      hideFloat();
      return;
    }
    if (annotations.length >= MAX_ITEMS) {
      setStatus(`一次最多 ${MAX_ITEMS} 段。`, 'error');
      hideFloat();
      return;
    }
    annotations.push({
      quote: pending.quote,
      sourceUrl: pending.sourceUrl,
      sourceTitle: pending.sourceTitle,
      sourceSite: pending.sourceSite,
      contextBefore: pending.contextBefore,
      contextAfter: pending.contextAfter,
    });
    window.getSelection()?.removeAllRanges();
    hideFloat();
    renderList();
    setStatus('已加入，继续选下一段。');
  }

  function save() {
    if (!saveButton || annotations.length === 0) return;
    saveButton.disabled = true;
    saveButton.textContent = '保存中…';
    setStatus('正在写入 Inbox…', 'pending');

    try {
      chrome.runtime.sendMessage(
        {
          type: 'josh-batch-save',
          payload: {
            annotations,
            tags: activeTag ? [activeTag] : [],
          },
        },
        (response) => {
          if (!saveButton) return;
          if (chrome.runtime.lastError) {
            saveButton.disabled = false;
            saveButton.textContent = '保存为组';
            setStatus('扩展后台没有响应，重载扩展后再试。', 'error');
            return;
          }
          if (!response || !response.ok) {
            saveButton.disabled = false;
            saveButton.textContent = '保存为组';
            setStatus(response?.error || '保存失败，稍后再试。', 'error');
            return;
          }

          const parts = [];
          if (response.saved) parts.push(`已保存 ${response.saved} 段`);
          if (response.duplicates) parts.push(`${response.duplicates} 段重复`);
          if (response.failed) parts.push(`${response.failed} 段失败`);
          setStatus(parts.join('，') + '。', response.failed ? 'error' : '');
          if (response.saved) {
            annotations = [];
            renderList();
            saveButton.textContent = '已保存';
            closeTimer = window.setTimeout(() => setOpen(false), 1_200);
          } else {
            saveButton.disabled = false;
            saveButton.textContent = '保存为组';
          }
        },
      );
    } catch {
      saveButton.disabled = false;
      saveButton.textContent = '保存为组';
      setStatus('无法连接扩展后台。', 'error');
    }
  }

  function reset() {
    annotations = [];
    tags = [];
    activeTag = '';
    setStatus('');
  }

  function destroy() {
    open = false;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    hideFloat();
    host?.remove();
    host = null;
    shadow = null;
    panel = null;
    tagRow = null;
    list = null;
    countNode = null;
    saveButton = null;
    statusNode = null;
    floatButton = null;
  }

  function requestTags() {
    try {
      chrome.runtime.sendMessage({ type: 'josh-batch-tags' }, (response) => {
        if (chrome.runtime.lastError || !response?.ok || !Array.isArray(response.tags)) {
          return;
        }
        tags = response.tags;
        if (open) renderTags();
      });
    } catch {
      /* the background may be waking up */
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'josh-batch-open') {
      if (Array.isArray(message.tags)) tags = message.tags;
      else requestTags();
      setOpen(true);
      sendResponse({ ok: true });
    }
    return false;
  });

  document.addEventListener(
    'mouseup',
    (event) => {
      if (!open) return;
      if (event.composedPath().includes(host)) return;
      setTimeout(handleSelection, 0);
    },
    true,
  );

  document.addEventListener('keyup', (event) => {
    if (!open || event.key === 'Escape') return;
    if (event.composedPath().includes(host)) return;
    setTimeout(handleSelection, 0);
  });

  document.addEventListener('selectionchange', () => {
    if (!open) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) hideFloat();
  });

  window.addEventListener('scroll', hideFloat, true);
  window.addEventListener('resize', hideFloat);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  });

  window.__joshBatchOpen = () => setOpen(true);
  window.__joshBatchClose = () => setOpen(false);
})();
