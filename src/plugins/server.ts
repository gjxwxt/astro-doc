import type { ActionHandler } from './types';

interface ServerModule {
  actions?: Record<string, ActionHandler>;
}

const serverModules = import.meta.glob('./*/server.ts', { eager: true }) as Record<string, ServerModule>;

export function getActionHandler(pluginId: string, actionId: string): ActionHandler | undefined {
  return serverModules[`./${pluginId}/server.ts`]?.actions?.[actionId];
}
