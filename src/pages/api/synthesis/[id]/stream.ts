import type { APIRoute } from 'astro';

import { getDatabase } from '@/lib/db/client';
import {
  getSynthesisRun,
  listSynthesisEvents,
  type SynthesisEvent,
} from '@/lib/db/syntheses';
import { authenticate } from '@/lib/private-auth';
import { jsonError, preflight } from '@/lib/private-http';
import { subscribeSynthesis } from '@/lib/synthesis/events';

export const prerender = false;

const encoder = new TextEncoder();
const TERMINAL = new Set(['run.completed', 'run.failed', 'run.cancelled']);

function frame(event: SynthesisEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({
      ...event.payload,
      seq: event.seq,
      type: event.type,
      runId: event.runId,
    })}\n\n`,
  );
}

function ownerOrError(request: Request): { ownerId: string } | { response: Response } {
  const auth = authenticate(request, process.env);
  if (!auth) return { response: jsonError(401, 'UNAUTHORIZED', '请先登录，或使用私有 API Token。') };
  return { ownerId: auth.ownerId };
}

export const GET: APIRoute = ({ request, params }) => {
  const auth = ownerOrError(request);
  if ('response' in auth) return auth.response;

  const id = params.id?.trim() ?? '';
  if (!id) return jsonError(400, 'INVALID_ID', '缺少任务 ID。');

  const db = getDatabase();
  const run = getSynthesisRun(db, auth.ownerId, id);
  if (!run) return jsonError(404, 'NOT_FOUND', '找不到这个合成任务。');

  const url = new URL(request.url);
  const initialAfter = Number(
    url.searchParams.get('after') ?? request.headers.get('last-event-id') ?? 0,
  );
  const after = Number.isFinite(initialAfter) ? Math.max(0, initialAfter) : 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSeq = after;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe = (): void => {};

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: SynthesisEvent): void => {
        if (closed || event.seq <= lastSeq) return;
        lastSeq = event.seq;
        try {
          controller.enqueue(frame(event));
        } catch {
          close();
          return;
        }
        if (TERMINAL.has(event.type)) close();
      };

      // Subscribe before replaying so an event emitted during the replay is not lost.
      unsubscribe = subscribeSynthesis(run.id, send);
      for (const event of listSynthesisEvents(db, run.id, after)) send(event);

      if (closed) return;
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        // A terminal status can be visible a few milliseconds before its event
        // is persisted. Send a synthetic terminal frame instead of hanging the
        // browser's EventSource connection.
        const type =
          run.status === 'completed'
            ? 'run.completed'
            : run.status === 'failed'
              ? 'run.failed'
              : 'run.cancelled';
        send({
          seq: lastSeq + 1,
          runId: run.id,
          type,
          payload: { status: run.status, message: run.error || '' },
          createdAt: new Date().toISOString(),
        });
        close();
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          close();
        }
      }, 15_000);

      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      // The request abort handler owns cleanup; keeping this empty avoids
      // accidentally cancelling the synthesis run when the browser closes.
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};

export const OPTIONS: APIRoute = () => preflight();
