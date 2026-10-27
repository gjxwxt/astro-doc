/** Convert a Markdown document into plain text for search and excerpts. */
export function markdownToText(markdown: string): string {
  let text = markdown;

  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  text = text.replace(/%%[\s\S]*?%%/g, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/~~~[\s\S]*?~~~/g, ' ');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  text = text.replace(/^\s*\|.*\|\s*$/gm, (line) => line.replace(/\|/g, ' '));
  text = text.replace(/[`*_~]/g, '');
  text = text.replace(/\\([\\`*_[\]{}()#+\-.!])/g, '$1');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function excerpt(markdown: string, length = 160): string {
  const text = markdownToText(markdown).replace(/\s+/g, ' ');
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

export function stripLeadingTitle(markdown: string, title: string): string {
  const match = markdown.match(/^\s*#\s+(.+)\n+/);
  if (!match) return markdown;
  const heading = match[1].trim();
  if (heading !== title.trim()) return markdown;
  return markdown.slice(match[0].length);
}
