import type { DatabaseSync } from 'node:sqlite';

import { getDatabase } from '@/lib/db/client';
import { getFragment, type Fragment } from '@/lib/db/fragments';
import {
  appendSynthesisEvent,
  getSynthesisRun,
  updateSynthesisRun,
  type SynthesisEvent,
  type SynthesisRun,
} from '@/lib/db/syntheses';
import {
  AiError,
  aiRuntime,
  chatJson,
  chatText,
  chatTextStream,
  type AiRuntime,
} from './ai';
import { publishSynthesisEvent } from './events';
import {
  buildHumanizePrompt,
  buildPlanPrompt,
  buildSectionPrompt,
  citationTokens,
  citationsFor,
  dedupeFragments,
  ensureParagraphCitations,
  localPlan,
  normalizePlan,
  replaceInvalidCitations,
  sameCitationSet,
  structureMarkdown,
  type RawPlan,
  type SynthesisPlan,
} from './plan';

export type SynthesisStage = 'collect' | 'cluster' | 'outline' | 'write' | 'humanize' | 'check';

interface ActiveRun {
  controller: AbortController;
  cancelled: boolean;
}

const globalForRuns = globalThis as unknown as {
  __synthesisActive?: Map<string, ActiveRun>;
  __synthesisStarted?: Set<string>;
};

function active(): Map<string, ActiveRun> {
  if (!globalForRuns.__synthesisActive) globalForRuns.__synthesisActive = new Map();
  return globalForRuns.__synthesisActive;
}

function started(): Set<string> {
  if (!globalForRuns.__synthesisStarted) globalForRuns.__synthesisStarted = new Set();
  return globalForRuns.__synthesisStarted;
}

function isCancelled(runId: string): boolean {
  return active().get(runId)?.cancelled ?? false;
}

function throwIfCancelled(runId: string): void {
  if (!isCancelled(runId)) return;
  throw new DOMException('Cancelled', 'AbortError');
}

function emit(
  db: DatabaseSync,
  runId: string,
  type: string,
  payload: Record<string, unknown> = {},
): SynthesisEvent {
  const event = appendSynthesisEvent(db, runId, type, payload);
  publishSynthesisEvent(event);
  return event;
}

function stageUpdate(
  db: DatabaseSync,
  runId: string,
  stage: SynthesisStage,
  status: 'start' | 'done' | 'skipped',
  detail = '',
): void {
  emit(db, runId, 'stage', { stage, status, detail });
}

function loadFragments(db: DatabaseSync, ownerId: string, ids: string[]): Fragment[] {
  const fragments: Fragment[] = [];
  for (const id of ids) {
    const fragment = getFragment(db, ownerId, id);
    if (fragment) fragments.push(fragment);
  }
  return fragments;
}

async function makePlan(
  db: DatabaseSync,
  run: SynthesisRun,
  runtime: AiRuntime | null,
  fragments: Fragment[],
  controller: AbortController,
  warnings: string[],
): Promise<SynthesisPlan> {
  stageUpdate(db, run.id, 'cluster', 'start', '正在聚类');
  if (!runtime) {
    const plan = localPlan(fragments);
    stageUpdate(db, run.id, 'cluster', 'done', `${plan.clusters.length} 组`);
    stageUpdate(db, run.id, 'outline', 'start', '正在整理大纲');
    emit(db, run.id, 'plan', {
      title: plan.title,
      clusters: plan.clusters,
      outline: plan.outline,
      mode: plan.mode,
      warnings: plan.warnings,
    });
    for (const warning of plan.warnings) emit(db, run.id, 'warning', { message: warning });
    stageUpdate(db, run.id, 'outline', 'done', `${plan.outline.length} 节`);
    return plan;
  }

  try {
    const extra = run.prompt ? `\n\n作者额外要求：${run.prompt}` : '';
    const raw = await chatJson<RawPlan>(runtime, {
      system:
        '你是一个严谨的中文编辑。你只输出 JSON，不写解释，不编造碎片里没有的事实。',
      user: `${buildPlanPrompt(fragments)}${extra}`,
      maxTokens: 1_500,
      temperature: 0.25,
      signal: controller.signal,
    });
    throwIfCancelled(run.id);
    const plan = normalizePlan(raw, fragments, localPlan(fragments));
    if (plan.clusters.length === 0 || plan.outline.length === 0) {
      throw new AiError('AI 没有给出可用的聚类或大纲。');
    }
    stageUpdate(db, run.id, 'cluster', 'done', `${plan.clusters.length} 组`);
    stageUpdate(db, run.id, 'outline', 'start', '正在整理大纲');
    emit(db, run.id, 'plan', {
      title: plan.title,
      clusters: plan.clusters,
      outline: plan.outline,
      mode: plan.mode,
      warnings: plan.warnings,
    });
    stageUpdate(db, run.id, 'outline', 'done', `${plan.outline.length} 节`);
    return plan;
  } catch (error) {
    if (controller.signal.aborted || error instanceof DOMException) throw error;
    const message = error instanceof Error ? error.message : 'AI 聚类失败';
    warnings.push(`AI 聚类/大纲失败，已降级为结构草稿：${message.slice(0, 180)}`);
    const plan = localPlan(fragments);
    plan.mode = 'structure';
    stageUpdate(db, run.id, 'cluster', 'skipped', 'AI 不可用，按标签分组');
    stageUpdate(db, run.id, 'outline', 'start', '正在整理结构大纲');
    emit(db, run.id, 'plan', {
      title: plan.title,
      clusters: plan.clusters,
      outline: plan.outline,
      mode: plan.mode,
      warnings: plan.warnings,
    });
    emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
    stageUpdate(db, run.id, 'outline', 'done', `${plan.outline.length} 节`);
    return plan;
  }
}

function cleanSectionText(text: string, heading: string): string {
  const trimmed = text.trim();
  const withoutHeading = trimmed.replace(new RegExp(`^#{1,6}\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'i'), '');
  return withoutHeading.trim();
}

async function writeWithAi(
  db: DatabaseSync,
  run: SynthesisRun,
  runtime: AiRuntime,
  plan: SynthesisPlan,
  fragments: Fragment[],
  controller: AbortController,
): Promise<string> {
  const sections: string[] = [];
  let previous = '';

  for (const [index, section] of plan.outline.entries()) {
    throwIfCancelled(run.id);
    emit(db, run.id, 'section.start', {
      index,
      heading: section.heading,
      clusterId: section.clusterId,
    });
    const extra = run.prompt ? `\n\n作者额外要求：${run.prompt}` : '';
    let text = '';
    for await (const delta of chatTextStream(runtime, {
      system:
        '你是一个中文写作者。你只根据给定碎片写作，不编造事实；保留来源标记 [fN]。',
      user: `${buildSectionPrompt(plan, section, fragments, previous)}${extra}`,
      maxTokens: 900,
      temperature: 0.5,
      signal: controller.signal,
    })) {
      throwIfCancelled(run.id);
      text += delta;
      emit(db, run.id, 'section.delta', { index, text: delta });
    }
    text = cleanSectionText(text, section.heading);
    if (!text) throw new AiError(`第 ${index + 1} 节没有返回内容。`);
    sections.push(`## ${section.heading}\n\n${text}`);
    previous = text;
    emit(db, run.id, 'section.done', { index, heading: section.heading, text });
  }

  return [`# ${plan.title}`, '', ...sections].join('\n\n');
}

async function humanize(
  db: DatabaseSync,
  run: SynthesisRun,
  runtime: AiRuntime,
  fragments: Fragment[],
  markdown: string,
  controller: AbortController,
  warnings: string[],
): Promise<string> {
  stageUpdate(db, run.id, 'humanize', 'start', '正在做自然化润色');
  const before = new Set(citationTokens(markdown));
  try {
    const polished = (await chatText(runtime, {
      system:
        '你是一个中文编辑。只做自然化润色，不改变事实和来源标记；只输出 Markdown。',
      user: buildHumanizePrompt(markdown, fragments),
      maxTokens: 2_400,
      temperature: 0.35,
      signal: controller.signal,
    })).trim();
    throwIfCancelled(run.id);
    const after = new Set(citationTokens(polished));
    if (!polished || !sameCitationSet(before, after)) {
      warnings.push('润色前后的来源标记不一致，已保留润色前正文。');
      stageUpdate(db, run.id, 'humanize', 'skipped', '引用不一致，保留原文');
      emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
      return markdown;
    }
    stageUpdate(db, run.id, 'humanize', 'done', '已完成');
    return polished;
  } catch (error) {
    if (controller.signal.aborted || error instanceof DOMException) throw error;
    const message = error instanceof Error ? error.message : '润色失败';
    warnings.push(`润色失败，已保留润色前正文：${message.slice(0, 180)}`);
    stageUpdate(db, run.id, 'humanize', 'skipped', '保留润色前正文');
    emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
    return markdown;
  }
}

async function runPipeline(runId: string): Promise<void> {
  const db = getDatabase();
  const run = getSynthesisRun(db, 'local', runId);
  if (!run) return;

  const activeRun = active().get(runId);
  if (!activeRun) return;
  const warnings: string[] = [];

  try {
    if (activeRun.cancelled) throw new DOMException('Cancelled', 'AbortError');
    stageUpdate(db, run.id, 'collect', 'start', '正在读取碎片');
    const fragments = loadFragments(db, run.ownerId, run.fragmentIds);
    if (fragments.length === 0) throw new Error('没有可用的碎片。');
    const deduped = dedupeFragments(fragments);
    emit(db, run.id, 'dedupe', {
      count: deduped.unique.length,
      removed: deduped.duplicateIds,
    });
    stageUpdate(db, run.id, 'collect', 'done', `${deduped.unique.length} 条碎片`);

    const runtime = aiRuntime();
    const plan = await makePlan(db, run, runtime, deduped.unique, activeRun.controller, warnings);
    updateSynthesisRun(db, run.ownerId, run.id, {
      model: runtime?.model || 'local-structure',
      outline: plan,
    });

    let markdown = '';
    if (plan.mode === 'ai' && runtime) {
      stageUpdate(db, run.id, 'write', 'start', '正在分节成文');
      try {
        markdown = await writeWithAi(
          db,
          run,
          runtime,
          plan,
          deduped.unique,
          activeRun.controller,
        );
      } catch (error) {
        if (activeRun.controller.signal.aborted || error instanceof DOMException) throw error;
        const message = error instanceof Error ? error.message : 'AI 成文失败';
        warnings.push(`AI 成文失败，已降级为结构草稿：${message.slice(0, 180)}`);
        plan.mode = 'structure';
        markdown = structureMarkdown(plan, deduped.unique);
        emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
      }
      stageUpdate(db, run.id, 'write', 'done', plan.mode === 'ai' ? '已生成' : '已降级');
    } else {
      stageUpdate(db, run.id, 'write', 'start', '正在整理结构草稿');
      markdown = structureMarkdown(plan, deduped.unique);
      stageUpdate(db, run.id, 'write', 'done', '结构草稿');
    }

    throwIfCancelled(run.id);

    if (plan.mode === 'ai' && runtime) {
      markdown = await humanize(
        db,
        run,
        runtime,
        deduped.unique,
        markdown,
        activeRun.controller,
        warnings,
      );
    } else {
      stageUpdate(db, run.id, 'humanize', 'skipped', '结构草稿不需要润色');
    }

    throwIfCancelled(run.id);
    stageUpdate(db, run.id, 'check', 'start', '正在核对来源');
    const allowed = new Set(deduped.unique.map((_, index) => `f${index + 1}`));
    const invalid = replaceInvalidCitations(markdown, allowed);
    const ensured = ensureParagraphCitations(invalid.markdown);
    const citations = citationsFor(ensured.markdown, deduped.unique);
    if (ensured.missing > 0) {
      warnings.push(`${ensured.missing} 个段落没有来源标记，已用 [?] 标出。`);
      emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
    }
    if (invalid.invalid.length > 0) {
      warnings.push(`发现无效引用 ${invalid.invalid.join('、')}，已标为 [?]。`);
      emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
    }
    if (citations.length === 0) {
      warnings.push('正文没有解析到有效来源，已保留全文但标记为不可追溯。');
      emit(db, run.id, 'warning', { message: warnings[warnings.length - 1] });
    }
    emit(db, run.id, 'citation.check', {
      missing: ensured.missing,
      invalid: invalid.invalid,
      citations,
    });
    stageUpdate(db, run.id, 'check', 'done', `${citations.length} 个来源`);

    const completedAt = new Date().toISOString();
    updateSynthesisRun(db, run.ownerId, run.id, {
      status: 'completed',
      resultMarkdown: ensured.markdown,
      citations,
      outline: plan,
      completedAt,
    });
    emit(db, run.id, 'run.completed', {
      title: plan.title,
      markdown: ensured.markdown,
      citations,
      mode: plan.mode,
      model: runtime?.model || 'local-structure',
      warnings,
    });
  } catch (error) {
    if (activeRun.controller.signal.aborted || error instanceof DOMException) {
      updateSynthesisRun(db, run.ownerId, run.id, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      emit(db, run.id, 'run.cancelled', { message: '已取消，不会保存半成品。' });
    } else {
      const message = error instanceof Error ? error.message : '合成失败。';
      updateSynthesisRun(db, run.ownerId, run.id, {
        status: 'failed',
        error: message.slice(0, 500),
        completedAt: new Date().toISOString(),
      });
      emit(db, run.id, 'run.failed', { message: message.slice(0, 500) });
    }
  } finally {
    active().delete(runId);
    started().delete(runId);
  }
}

export function startSynthesis(runId: string): void {
  const db = getDatabase();
  const run = getSynthesisRun(db, 'local', runId);
  if (!run) return;
  if (started().has(runId)) return;
  started().add(runId);

  const controller = new AbortController();
  active().set(runId, { controller, cancelled: false });
  updateSynthesisRun(db, run.ownerId, run.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    error: null,
  });
  emit(db, run.id, 'run.started', {
    model: run.model || 'local',
    total: run.fragmentIds.length,
  });

  void runPipeline(runId);
}

export function cancelSynthesis(runId: string): void {
  const entry = active().get(runId);
  if (entry) {
    entry.cancelled = true;
    entry.controller.abort();
    return;
  }
  const db = getDatabase();
  const run = getSynthesisRun(db, 'local', runId);
  if (!run) return;
  if (run.status === 'queued') {
    updateSynthesisRun(db, run.ownerId, run.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });
    emit(db, run.id, 'run.cancelled', { message: '已取消，不会保存半成品。' });
  }
}

export function isSynthesisActive(runId: string): boolean {
  return active().has(runId);
}
