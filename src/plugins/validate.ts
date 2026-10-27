import type { FieldSchema, ObjectSchema } from './types';

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '[::1]' ||
    host.includes(':') ||
    isPrivateIPv4(host)
  ) {
    throw new Error('Private or local addresses are not allowed.');
  }
  return url;
}

function validateField(field: string, schema: FieldSchema, raw: unknown): { value?: unknown; error?: string } {
  if (raw === undefined || raw === null || raw === '') {
    if (schema.default !== undefined) return { value: schema.default };
    if (schema.required) return { error: 'This field is required.' };
    return {};
  }

  switch (schema.type) {
    case 'string': {
      if (typeof raw !== 'string') return { error: 'Expected a string.' };
      const value = raw.trim();
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return { error: `Must be at least ${schema.minLength} characters.` };
      }
      const max = schema.maxLength ?? 2000;
      if (value.length > max) return { error: `Must be at most ${max} characters.` };
      if (schema.enum && !schema.enum.includes(value)) {
        return { error: `Must be one of: ${schema.enum.join(', ')}.` };
      }
      if (schema.format === 'url') {
        try {
          assertPublicUrl(value);
        } catch {
          return { error: 'Must be a public http(s) URL.' };
        }
      }
      return { value };
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) return { error: 'Expected a number.' };
      if (schema.minimum !== undefined && value < schema.minimum) {
        return { error: `Must be at least ${schema.minimum}.` };
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return { error: `Must be at most ${schema.maximum}.` };
      }
      return { value };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 1) return { value: true };
      if (raw === 'false' || raw === 0) return { value: false };
      return { error: 'Expected a boolean.' };
    }
    case 'array': {
      if (!Array.isArray(raw)) return { error: 'Expected an array.' };
      const max = schema.maxItems ?? 50;
      if (raw.length > max) return { error: `At most ${max} items are allowed.` };
      if (schema.items?.type === 'string') {
        const values: string[] = [];
        for (const item of raw) {
          if (typeof item !== 'string') return { error: 'Expected an array of strings.' };
          const maxLength = schema.items.maxLength ?? 500;
          if (item.length > maxLength) return { error: `Each item must be at most ${maxLength} characters.` };
          values.push(item);
        }
        return { value: values };
      }
      return { value: raw };
    }
    default:
      return { error: `Unknown field type for ${field}.` };
  }
}

export function validateInput(schema: ObjectSchema, input: unknown): ValidationResult {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const value: Record<string, unknown> = {};
  const errors: ValidationError[] = [];

  for (const [field, fieldSchema] of Object.entries(schema.properties)) {
    const required = fieldSchema.required || schema.required?.includes(field);
    const result = validateField(field, { ...fieldSchema, required }, source[field]);
    if (result.error) errors.push({ field, message: result.error });
    else if (result.value !== undefined) value[field] = result.value;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

function toJsonSchemaField(field: FieldSchema): Record<string, unknown> {
  const output: Record<string, unknown> = { type: field.type };
  if (field.title) output.title = field.title;
  if (field.description) output.description = field.description;
  if (field.default !== undefined) output.default = field.default;
  if (field.enum) output.enum = field.enum;
  if (field.minLength !== undefined) output.minLength = field.minLength;
  if (field.maxLength !== undefined) output.maxLength = field.maxLength;
  if (field.minimum !== undefined) output.minimum = field.minimum;
  if (field.maximum !== undefined) output.maximum = field.maximum;
  if (field.maxItems !== undefined) output.maxItems = field.maxItems;
  if (field.items) output.items = field.items;
  if (field.format) output.format = field.format;
  return output;
}

export function toJsonSchema(schema: ObjectSchema): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => [key, toJsonSchemaField(field)]),
    ),
    required: schema.required ?? Object.entries(schema.properties)
      .filter(([, field]) => field.required)
      .map(([key]) => key),
    additionalProperties: false,
  };
}
