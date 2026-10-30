import Defuddle from 'defuddle';
import DOMPurify from 'dompurify';

const HOST_ID = 'josh-explosion-host';
const BLOCK_SELECTOR = 'p, h2, h3, h4, blockquote, pre, li';
const PAGE_SAVE = 'josh-page-save';

function slugify(value) {
  return (
    String(value || 'page')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'page'
  );
}

function splitTags(value) {
  return [...new Set(String(value || '').split(/[,\s，、#]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function yamlString(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function blockText(block) {
  return (block.innerText || block.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function blockMarkdown(block) {
  const text = blockText(block);
  if (!text) return '';
  if (block.tagName === 'H2') return `## ${text}`;
  if (block.tagName === 'H3') return `### ${text}`;
  if (block.tagName === 'H4') return `#### ${text}`;
  if (block.tagName === 'BLOCKQUOTE') {
    return text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  }
  if (block.tagName === 'PRE') {
    return `\`\`\`\n${text}\n\`\`\``;
  }
  if (block.tagName === 'LI') return `- ${text}`;
  return text;
}

function selectedMarkdown(blocks) {
  return blocks
    .filter((block) => block.classList.contains('is-selected'))
    .map(blockMarkdown)
    .filter(Boolean)
    .join('\n\n');
}

function frontmatter(page, tags) {
  const lines = [
    '---',
    `title: ${yamlString(page.title)}`,
    `source: ${yamlString(page.url)}`,
    `site: ${yamlString(page.site)}`,
    `author: ${yamlString(page.author)}`,
    `published: ${yamlString(page.published)}`,
    `captured: ${yamlString(new Date().toISOString())}`,
  ];
  if (tags.length > 0) lines.push(`tags: [${tags.map((tag) => yamlString(tag)).join(', ')}]`);
  lines.push('---');
  return `${lines.join('\n')}\n\n`;
}

function closeHost() {
  const host = document.getElementById(HOST_ID);
  if (host) host.remove();
  document.documentElement.style.overflow = '';
}

function openShell(page) {
  closeHost();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .overlay {
        position: fixed; inset: 0; display: grid; place-items: center;
        padding: 22px; background: rgba(11, 19, 14, 0.56);
        backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
        font-family: "Avenir Next", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: #17231b;
      }
      .shell {
        display: flex; flex-direction: column; width: min(1080px, 100%);
        height: min(90vh, 900px); overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.42); border-radius: 24px;
        background: #f7f3e8; box-shadow: 0 30px 100px rgba(5, 13, 8, 0.32);
      }
      .topbar {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 18px; padding: 22px 26px 16px; border-bottom: 1px solid rgba(23,35,27,.12);
        background: rgba(255,253,246,.72);
      }
      .brand { display: flex; gap: 10px; align-items: center; color: #6f776d; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
      .mark { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 9px; background: #274f35; color: #c7f19c; font: 700 15px/1 Georgia, serif; }
      .top-actions { display: flex; gap: 6px; }
      .close { width: 34px; height: 34px; border: 1px solid rgba(23,35,27,.15); border-radius: 10px; background: transparent; color: #6f776d; font-size: 18px; cursor: pointer; }
      .close:hover { border-color: #274f35; color: #274f35; }
      .source { padding: 20px 26px 12px; }
      .source h1 { margin: 0; max-width: 780px; font: 600 clamp(24px, 3vw, 38px)/1.18 Georgia, "Songti SC", serif; letter-spacing: -.02em; }
      .meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; color: #6f776d; font-size: 12px; line-height: 1.5; }
      .meta a { color: #2e5a3a; text-decoration: none; overflow-wrap: anywhere; }
      .meta a:hover { text-decoration: underline; }
      .hint { margin: 12px 0 0; color: #6f776d; font-size: 12px; line-height: 1.55; }
      .body { flex: 1; overflow: auto; padding: 0 26px 24px; }
      .article { max-width: 760px; margin: 0 auto; padding: 8px 0 30px; font-family: Georgia, "Songti SC", "Noto Serif SC", serif; font-size: 18px; line-height: 1.85; }
      .article img { display: block; max-width: 100%; height: auto; margin: 18px auto; border-radius: 10px; }
      .article a { color: #2e5a3a; text-underline-offset: 3px; }
      .article :where(h2, h3, h4) { margin: 1.5em 0 .5em; line-height: 1.3; }
      .article :where(ul, ol) { padding-left: 1.4em; }
      .article :where(pre) { overflow: auto; padding: 14px; border-radius: 10px; background: rgba(23,35,27,.06); font-size: 13px; line-height: 1.6; }
      .article :where(code) { font-family: "SFMono-Regular", Consolas, monospace; font-size: .88em; }
      .article :where(blockquote) { margin: 1.1em 0; padding-left: 16px; border-left: 3px solid #c7f19c; color: #4c5b50; }
      .josh-x-block {
        position: relative; margin: 6px -12px; padding: 7px 12px 7px 34px;
        border: 1px solid transparent; border-radius: 10px; cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
      }
      .josh-x-block::before {
        content: ''; position: absolute; left: 13px; top: .9em; width: 8px; height: 8px;
        border: 1.5px solid rgba(39,79,53,.35); border-radius: 50%; background: transparent;
        transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
      }
      .josh-x-block:hover { background: rgba(39,79,53,.055); }
      .josh-x-block.is-selected { background: rgba(199,241,156,.3); border-color: rgba(39,79,53,.25); box-shadow: inset 0 0 0 1px rgba(39,79,53,.04); }
      .josh-x-block.is-selected::before { background: #274f35; border-color: #274f35; transform: scale(.9); }
      .josh-x-block:focus-visible { outline: 2px solid #274f35; outline-offset: 2px; }
      .josh-x-block h2, .josh-x-block h3, .josh-x-block h4 { margin: 0; }
      .footer {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        padding: 12px 20px; border-top: 1px solid rgba(23,35,27,.12);
        background: rgba(255,253,246,.82); backdrop-filter: blur(14px);
      }
      .footer-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .count { color: #6f776d; font-size: 12px; white-space: nowrap; }
      .tags { width: 170px; height: 32px; padding: 0 10px; border: 1px solid rgba(23,35,27,.15); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; outline: none; }
      .tags:focus { border-color: #274f35; }
      .footer-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      button { font: inherit; cursor: pointer; }
      .ghost { height: 34px; padding: 0 11px; border: 1px solid rgba(23,35,27,.15); border-radius: 9px; background: transparent; color: #526057; font-size: 12px; }
      .ghost:hover { border-color: #274f35; color: #274f35; }
      .primary { height: 36px; padding: 0 16px; border: 1px solid #274f35; border-radius: 9px; background: #274f35; color: #c7f19c; font-size: 12px; font-weight: 700; }
      .primary:disabled { opacity: .45; cursor: not-allowed; }
      .status { min-height: 16px; margin: 10px 0 0; color: #6f776d; font-size: 12px; }
      .status.is-error { color: #a33a2c; }
      .status.is-ok { color: #2e5a3a; }
      .loading { display: grid; place-items: center; min-height: 280px; color: #6f776d; font-size: 13px; }
      @media (max-width: 720px) {
        .overlay { padding: 0; }
        .shell { height: 100dvh; border-radius: 0; border: 0; }
        .topbar { padding: 16px 16px 12px; }
        .source { padding: 14px 16px 8px; }
        .source h1 { font-size: 25px; }
        .body { padding: 0 14px 18px; }
        .article { font-size: 17px; line-height: 1.8; }
        .footer { align-items: stretch; flex-direction: column; gap: 8px; padding: 10px 14px 14px; }
        .footer-left { justify-content: space-between; }
        .tags { flex: 1; width: auto; }
        .footer-actions { justify-content: stretch; }
        .footer-actions button { flex: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .josh-x-block, .josh-x-block::before { transition: none; }
      }
    </style>
    <div class="overlay" role="dialog" aria-modal="true" aria-label="页面大爆炸预览">
      <div class="shell">
        <div class="topbar">
          <div class="brand"><span class="mark">J</span><span>Josh · 页面大爆炸</span></div>
          <div class="top-actions"><button class="close" type="button" title="关闭">×</button></div>
        </div>
        <div class="source">
          <h1></h1>
          <div class="meta"></div>
          <p class="hint">点击段落选中；不会保存整页噪声。选好后存入 Inbox 或下载 Markdown。</p>
        </div>
        <div class="body"><div class="article"><div class="loading">正在抽取正文…</div></div></div>
        <div class="footer">
          <div class="footer-left">
            <span class="count">已选 0 段</span>
            <input class="tags" type="text" placeholder="标签，可选" aria-label="标签" />
          </div>
          <div class="footer-actions">
            <button class="ghost select-all" type="button">全选</button>
            <button class="ghost download" type="button">下载 Markdown</button>
            <button class="primary save" type="button" disabled>保存选中</button>
          </div>
        </div>
        <p class="status" role="status" aria-live="polite"></p>
      </div>
    </div>`;
  document.documentElement.append(host);
  document.documentElement.style.overflow = 'hidden';

  shadow.querySelector('.close').addEventListener('click', closeHost);
  shadow.querySelector('.overlay').addEventListener('click', (event) => {
    if (event.target === shadow.querySelector('.overlay')) closeHost();
  });

  const title = shadow.querySelector('.source h1');
  const meta = shadow.querySelector('.meta');
  title.textContent = page.title || '未命名页面';
  const site = document.createElement('span');
  site.textContent = page.site || '';
  const author = document.createElement('span');
  author.textContent = page.author ? `作者：${page.author}` : '';
  const date = document.createElement('span');
  date.textContent = page.published ? `发布：${page.published}` : '';
  const link = document.createElement('a');
  link.href = page.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = page.url;
  meta.append(site, author, date, link);

  return { host, shadow };
}

async function openExplosion() {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const page = {
    url: location.href,
    title: document.title,
    site: location.hostname.replace(/^www\./, ''),
    author: '',
    published: '',
  };
  const { shadow } = openShell(page);
  const article = shadow.querySelector('.article');
  const count = shadow.querySelector('.count');
  const save = shadow.querySelector('.save');
  const selectAll = shadow.querySelector('.select-all');
  const download = shadow.querySelector('.download');
  const tagsInput = shadow.querySelector('.tags');
  const status = shadow.querySelector('.status');
  const blocks = [];

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-ok', kind === 'ok');
  }

  function updateCount() {
    const selected = blocks.filter((block) => block.classList.contains('is-selected')).length;
    count.textContent = `已选 ${selected} 段`;
    save.disabled = selected === 0;
  }

  function toggleBlock(block) {
    const active = !block.classList.contains('is-selected');
    block.classList.toggle('is-selected', active);
    block.setAttribute('aria-checked', String(active));
    updateCount();
  }

  let result;
  try {
    const clone = document.cloneNode(true);
    const defuddle = new Defuddle(clone, {
      url: location.href,
      separateMarkdown: true,
      useAsync: false,
      markdown: false,
    });
    result = defuddle.parse();
  } catch (error) {
    article.replaceChildren();
    const message = document.createElement('p');
    message.className = 'hint';
    message.textContent = `正文抽取失败：${error instanceof Error ? error.message : String(error)}`;
    article.append(message);
    setStatus('抽取失败，换一个普通文章页试试。', 'error');
    return;
  }

  const cleaned = DOMPurify.sanitize(result.content || '', {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  article.innerHTML = cleaned;

  const pageTitle = document.querySelector('h1')?.textContent.trim() || '';
  const articleTitle = article.querySelector('h1')?.textContent.trim() || '';
  page.title = pageTitle || articleTitle || result.title || document.title;
  page.author = result.author || '';
  page.published = result.published || '';
  page.site = result.site || page.site;
  article.querySelector('h1')?.remove();
  shadow.querySelector('.source h1').textContent = page.title || '未命名页面';
  const meta = shadow.querySelector('.meta');
  meta.replaceChildren();
  const site = document.createElement('span');
  site.textContent = page.site || '';
  const author = document.createElement('span');
  author.textContent = page.author ? `作者：${page.author}` : '';
  const date = document.createElement('span');
  date.textContent = page.published ? `发布：${page.published}` : '';
  const link = document.createElement('a');
  link.href = page.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = page.url;
  meta.append(site, author, date, link);

  const candidates = [...article.querySelectorAll(BLOCK_SELECTOR)];
  for (const element of candidates) {
    if (element.tagName === 'LI' && element.querySelector('p')) continue;
    const text = blockText(element);
    if (!text || text.length < 2) continue;
    const block = element;
    block.classList.add('josh-x-block');
    block.tabIndex = 0;
    block.setAttribute('role', 'checkbox');
    block.setAttribute('aria-checked', 'false');
    block.addEventListener('click', () => toggleBlock(block));
    block.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleBlock(block);
      }
    });
    blocks.push(block);
  }
  updateCount();

  selectAll.addEventListener('click', () => {
    const shouldSelect = blocks.some((block) => !block.classList.contains('is-selected'));
    for (const block of blocks) {
      block.classList.toggle('is-selected', shouldSelect);
      block.setAttribute('aria-checked', String(shouldSelect));
    }
    selectAll.textContent = shouldSelect ? '取消全选' : '全选';
    updateCount();
  });

  download.addEventListener('click', () => {
    const selected = selectedMarkdown(blocks);
    const body = selected || result.contentMarkdown || article.innerText || '';
    const tags = splitTags(tagsInput.value);
    const markdown = `${frontmatter(page, tags)}${body}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(page.title)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Markdown 已下载。', 'ok');
  });

  save.addEventListener('click', async () => {
    const selected = blocks
      .filter((block) => block.classList.contains('is-selected'))
      .map((block) => ({ quote: blockText(block), sourceUrl: page.url, sourceTitle: page.title, sourceSite: page.site }))
      .filter((item) => item.quote);
    if (selected.length === 0) return;
    save.disabled = true;
    setStatus('正在保存…');
    try {
      const response = await chrome.runtime.sendMessage({
        type: PAGE_SAVE,
        payload: {
          annotations: selected,
          page,
          tags: splitTags(tagsInput.value),
        },
      });
      if (!response?.ok) throw new Error(response?.error || '保存失败');
      setStatus(`已存入 ${response.saved} 段${response.duplicates ? `，${response.duplicates} 段已存在` : ''}。`, 'ok');
      setTimeout(closeHost, 900);
    } catch (error) {
      save.disabled = false;
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  });

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHost();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save.click();
    }
  };
  document.addEventListener('keydown', onKey, { capture: true });
  const observer = new MutationObserver(() => {
    if (!document.getElementById(HOST_ID)) {
      document.removeEventListener('keydown', onKey, { capture: true });
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true });
}

if (!window.__joshExplosionLoaded) {
  window.__joshExplosionLoaded = true;
  window.__joshExplosion = openExplosion;
  void openExplosion();
} else if (typeof window.__joshExplosion === 'function') {
  void window.__joshExplosion();
}
