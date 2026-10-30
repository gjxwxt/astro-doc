import type { DatabaseSync } from 'node:sqlite';

export interface ReviewCount {
  label: string;
  count: number;
}

export interface ReviewStats {
  total: number;
  inbox: number;
  archived: number;
  weekTotal: number;
  media: number;
  drafts: number;
  byDay: Array<{ date: string; count: number }>;
  topTags: ReviewCount[];
  kinds: ReviewCount[];
  sources: ReviewCount[];
  weekStart: string;
}

export interface ReviewResult {
  mode: 'ai' | 'rules';
  text: string;
  notice?: string;
}

function countMap(rows: Array<{ label: string; count: number | bigint }>): ReviewCount[] {
  return rows.map((row) => ({ label: row.label, count: Number(row.count) }));
}

export function getReviewStats(
  db: DatabaseSync,
  ownerId: string,
  now = new Date(),
): ReviewStats {
  const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  start.setUTCHours(0, 0, 0, 0);
  const weekStart = start.toISOString();
  const base = 'owner_id = ? AND deleted_at IS NULL';

  const totals = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'inbox' THEN 1 ELSE 0 END) AS inbox,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
       FROM fragments WHERE ${base}`,
    )
    .get(ownerId) as { total: number; inbox: number | null; archived: number | null };

  const weekTotal = db
    .prepare(`SELECT COUNT(*) AS count FROM fragments WHERE ${base} AND captured_at >= ?`)
    .get(ownerId, weekStart) as { count: number };

  const media = db
    .prepare('SELECT COUNT(*) AS count FROM media WHERE owner_id = ? AND deleted_at IS NULL')
    .get(ownerId) as { count: number };

  const drafts = db
    .prepare('SELECT COUNT(*) AS count FROM drafts WHERE owner_id = ? AND deleted_at IS NULL')
    .get(ownerId) as { count: number };

  const topTags = db
    .prepare(
      `SELECT ft.tag AS label, COUNT(*) AS count
       FROM fragment_tags ft
       JOIN fragments f ON f.id = ft.fragment_id
       WHERE f.owner_id = ? AND f.deleted_at IS NULL AND f.captured_at >= ?
       GROUP BY ft.tag
       ORDER BY count DESC, ft.tag ASC
       LIMIT 8`,
    )
    .all(ownerId, weekStart) as Array<{ label: string; count: number | bigint }>;

  const kinds = db
    .prepare(
      `SELECT kind AS label, COUNT(*) AS count
       FROM fragments WHERE ${base} AND captured_at >= ?
       GROUP BY kind ORDER BY count DESC LIMIT 8`,
    )
    .all(ownerId, weekStart) as Array<{ label: string; count: number | bigint }>;

  const sources = db
    .prepare(
      `SELECT source_site AS label, COUNT(*) AS count
       FROM fragments WHERE ${base} AND captured_at >= ? AND source_site <> ''
       GROUP BY source_site ORDER BY count DESC LIMIT 6`,
    )
    .all(ownerId, weekStart) as Array<{ label: string; count: number | bigint }>;

  const days = db
    .prepare(
      `SELECT substr(captured_at, 1, 10) AS date, COUNT(*) AS count
       FROM fragments WHERE ${base} AND captured_at >= ?
       GROUP BY date ORDER BY date ASC`,
    )
    .all(ownerId, weekStart) as Array<{ date: string; count: number | bigint }>;
  const dayMap = new Map(days.map((row) => [row.date, Number(row.count)]));
  const byDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return { date, count: dayMap.get(date) ?? 0 };
  });

  return {
    total: Number(totals.total),
    inbox: Number(totals.inbox ?? 0),
    archived: Number(totals.archived ?? 0),
    weekTotal: Number(weekTotal.count),
    media: Number(media.count),
    drafts: Number(drafts.count),
    byDay,
    topTags: countMap(topTags),
    kinds: countMap(kinds),
    sources: countMap(sources),
    weekStart,
  };
}

export function reviewRules(stats: ReviewStats): string {
  const tagText =
    stats.topTags.length > 0
      ? stats.topTags
          .slice(0, 4)
          .map((tag) => `#${tag.label}（${tag.count}）`)
          .join('、')
      : '暂时还没有标签';
  const sourceText =
    stats.sources.length > 0
      ? stats.sources
          .slice(0, 3)
          .map((source) => `${source.label}（${source.count}）`)
          .join('、')
      : '还没有明确来源';

  const lines = [
    `本周新增 ${stats.weekTotal} 条碎片，Inbox 里还有 ${stats.inbox} 条待整理。`,
    `最活跃的标签是 ${tagText}；来源集中在 ${sourceText}。`,
  ];
  if (stats.weekTotal === 0) {
    lines.push('这一周还没有新内容，可以先从一条最近收藏开始整理。');
  } else if (stats.inbox > 0) {
    lines.push('建议先处理最近 3 条，把能合并的合并，把暂时不用的归档。');
  } else {
    lines.push('收件箱已经空了，可以挑一条旧碎片补上标签或写一句备注。');
  }
  return lines.join('\n');
}

export async function generateReview(
  stats: ReviewStats,
  env: Record<string, string | undefined> = process.env,
): Promise<ReviewResult> {
  const fallback = reviewRules(stats);
  const { aiRuntime, chatText, AiError } = await import('./synthesis/ai');
  if (env.AI_ENABLED === '0') {
    return { mode: 'rules', text: fallback, notice: 'AI 当前未启用，当前为规则回顾。' };
  }
  const runtime = aiRuntime(env);
  if (!runtime) return { mode: 'rules', text: fallback, notice: '未配置 AI key，当前为规则模式。' };

  try {
    const text = await chatText(runtime, {
      system: [
        '你是 Josh 私人知识库的周报助手。',
        '只根据给定的统计数据写一段中文回顾，120-220 字。',
        '先总结本周新增、主要标签和来源，再给一个具体、温和的整理建议。',
        '不要编造数字，不要写 Markdown 标题，不要称呼用户为“您”。',
      ].join('\n'),
      user: JSON.stringify(stats),
      maxTokens: 500,
      temperature: 0.4,
    });
    if (!text.trim()) return { mode: 'rules', text: fallback, notice: 'AI 没有返回内容，已用规则回顾。' };
    return { mode: 'ai', text: text.trim() };
  } catch (error) {
    const notice =
      error instanceof AiError
        ? `AI 暂时不可用（${error.message}），已用规则回顾。`
        : 'AI 暂时不可用，已用规则回顾。';
    return { mode: 'rules', text: fallback, notice };
  }
}
