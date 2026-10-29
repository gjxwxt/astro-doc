import type { SynthesisEvent } from '@/lib/db/syntheses';

type Listener = (event: SynthesisEvent) => void;

interface BusState {
  listeners: Map<string, Set<Listener>>;
}

const globalForBus = globalThis as unknown as { __synthesisBus?: BusState };

function state(): BusState {
  if (!globalForBus.__synthesisBus) {
    globalForBus.__synthesisBus = { listeners: new Map() };
  }
  return globalForBus.__synthesisBus;
}

export function publishSynthesisEvent(event: SynthesisEvent): void {
  const listeners = state().listeners.get(event.runId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      /* a closed stream must not break the run */
    }
  }
}

export function subscribeSynthesis(runId: string, listener: Listener): () => void {
  const listeners = state().listeners.get(runId) ?? new Set<Listener>();
  listeners.add(listener);
  state().listeners.set(runId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) state().listeners.delete(runId);
  };
}
