export type PluginStatus = 'stable' | 'beta' | 'experimental' | 'needs-config';

export type FieldType = 'string' | 'number' | 'boolean' | 'array';

export interface FieldSchema {
  type: FieldType;
  title?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean | string[];
  enum?: string[];
  format?: 'url';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  items?: { type: 'string'; maxLength?: number };
  example?: string;
}

export interface ObjectSchema {
  type: 'object';
  properties: Record<string, FieldSchema>;
  required?: string[];
}

export interface PluginAction {
  id: string;
  label: string;
  description: string;
  /** Server actions are exposed through /api/tools and can be exposed to MCP. */
  kind: 'server' | 'client';
  mcp?: boolean;
  input?: ObjectSchema;
}

export interface PluginManifest {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  status: PluginStatus;
  tags: string[];
  order: number;
  actions: PluginAction[];
  config?: {
    env: string[];
    hint: string;
  };
  notes?: string[];
}

export interface ActionContext {
  request: Request;
  env: Record<string, string | undefined>;
  clientAddress: string;
}

export type ActionResult = unknown | Response;
export type ActionHandler = (
  input: Record<string, unknown>,
  context: ActionContext,
) => Promise<ActionResult>;

export class ActionError extends Error {
  code: string;
  status: number;
  hint?: string;

  constructor(code: string, status: number, message: string, hint?: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}
