import type { PluginManifest } from './types';

const manifestModules = import.meta.glob('./*/manifest.ts', { eager: true }) as Record<
  string,
  { default: PluginManifest }
>;

const uiModules = import.meta.glob('./*/Tool.astro');

export const plugins: PluginManifest[] = Object.values(manifestModules)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));

export function getPlugin(id: string): PluginManifest | undefined {
  return plugins.find((plugin) => plugin.id === id);
}

export function getPluginActions(plugin: PluginManifest) {
  return plugin.actions.filter((action) => action.kind === 'server');
}

export function getMcpActions(plugin: PluginManifest) {
  return plugin.actions.filter((action) => action.kind === 'server' && action.mcp);
}

export function hasToolUi(id: string): boolean {
  return Boolean(uiModules[`./${id}/Tool.astro`]);
}

export async function loadToolUi(id: string): Promise<{ default: unknown } | null> {
  const loader = uiModules[`./${id}/Tool.astro`];
  if (!loader) return null;
  return (await loader()) as { default: unknown };
}
