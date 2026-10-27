const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC',
});

export function formatDate(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date).replaceAll('/', '.');
}

export function isoDate(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(url))}&sz=64`;
}

export function faviconFallbackUrl(url: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname(url))}.ico`;
}

export function readingTime(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const words = text.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g)?.length ?? 0;
  return Math.max(1, Math.round(cjk / 350 + words / 220));
}

export function truncate(text: string, length: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1)}…`;
}
