export interface BookmarkItem {
  name: string;
  url: string;
  description?: string;
  featured?: boolean;
}

export interface BookmarkGroup {
  id: string;
  title: string;
  order: number;
  items: BookmarkItem[];
}

export interface BookmarkEdit {
  name?: string;
  description?: string;
}

export interface BookmarkOverlay {
  version: 1;
  hidden: string[];
  custom: Array<BookmarkItem & { group: string }>;
  edits: Record<string, BookmarkEdit>;
}

export function emptyOverlay(): BookmarkOverlay {
  return { version: 1, hidden: [], custom: [], edits: {} };
}

export function mergeGroups(defaults: BookmarkGroup[], overlay: BookmarkOverlay): BookmarkGroup[] {
  const groups = defaults.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const edit = overlay.edits[item.url];
      return edit ? { ...item, ...edit } : { ...item };
    }),
  }));

  for (const group of groups) {
    group.items = group.items.filter((item) => !overlay.hidden.includes(item.url));
  }

  const knownUrls = new Set(groups.flatMap((group) => group.items.map((item) => item.url)));
  for (const custom of overlay.custom) {
    const group = groups.find((candidate) => candidate.id === custom.group) ?? groups[0];
    if (!group) continue;
    if (knownUrls.has(custom.url)) continue;
    knownUrls.add(custom.url);
    group.items.push({
      name: custom.name,
      url: custom.url,
      description: custom.description,
    });
  }

  return groups;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeOverlay(input: unknown): BookmarkOverlay | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  if (source.version !== 1) return null;

  const hidden = Array.isArray(source.hidden)
    ? source.hidden.filter((item): item is string => isHttpUrl(item))
    : [];
  const custom = Array.isArray(source.custom)
    ? source.custom
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && isHttpUrl((item as Record<string, unknown>).url),
        )
        .map((item) => ({
          group: typeof item.group === 'string' ? item.group : 'services',
          name: typeof item.name === 'string' ? item.name.slice(0, 80) : '未命名',
          url: item.url as string,
          description: typeof item.description === 'string' ? item.description.slice(0, 160) : '',
        }))
    : [];

  const edits: Record<string, BookmarkEdit> = {};
  if (source.edits && typeof source.edits === 'object') {
    for (const [url, value] of Object.entries(source.edits as Record<string, unknown>)) {
      if (!isHttpUrl(url) || !value || typeof value !== 'object') continue;
      const edit = value as Record<string, unknown>;
      edits[url] = {
        name: typeof edit.name === 'string' ? edit.name.slice(0, 80) : undefined,
        description: typeof edit.description === 'string' ? edit.description.slice(0, 160) : undefined,
      };
    }
  }

  return { version: 1, hidden, custom, edits };
}
