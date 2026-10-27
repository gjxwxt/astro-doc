import { describe, expect, it } from 'vitest';

import type { ObjectSchema } from '@/plugins/types';
import { assertPublicUrl, toJsonSchema, validateInput } from '@/plugins/validate';

const schema: ObjectSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', required: true, maxLength: 10 },
    limit: { type: 'number', default: 5, minimum: 1, maximum: 20 },
    url: { type: 'string', format: 'url' },
    tags: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 5 } },
  },
  required: ['query'],
};

describe('validateInput', () => {
  it('requires required fields', () => {
    const result = validateInput(schema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe('query');
  });

  it('applies defaults and strips unknown keys', () => {
    const result = validateInput(schema, { query: 'hi', nope: true });
    expect(result).toEqual({ ok: true, value: { query: 'hi', limit: 5 } });
  });

  it('enforces string length, number bounds and array items', () => {
    expect(validateInput(schema, { query: '12345678901' }).ok).toBe(false);
    expect(validateInput(schema, { query: 'ok', limit: 0 }).ok).toBe(false);
    expect(validateInput(schema, { query: 'ok', tags: ['a', 'b', 'c', 'd'] }).ok).toBe(false);
    expect(validateInput(schema, { query: 'ok', tags: ['a', 'b'] }).ok).toBe(true);
  });

  it('rejects private URLs', () => {
    expect(validateInput(schema, { query: 'ok', url: 'http://127.0.0.1/a' }).ok).toBe(false);
    expect(validateInput(schema, { query: 'ok', url: 'https://example.com/a' }).ok).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('allows public http(s) URLs', () => {
    expect(assertPublicUrl('https://example.com/path').hostname).toBe('example.com');
  });

  it('rejects localhost, private IPv4 and non-http protocols', () => {
    expect(() => assertPublicUrl('http://localhost:3000')).toThrow();
    expect(() => assertPublicUrl('http://192.168.1.2')).toThrow();
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow();
  });
});

describe('toJsonSchema', () => {
  it('keeps required fields and property metadata', () => {
    const json = toJsonSchema(schema) as {
      required: string[];
      properties: Record<string, Record<string, unknown>>;
      additionalProperties: boolean;
    };
    expect(json.required).toEqual(['query']);
    expect(json.properties.query?.maxLength).toBe(10);
    expect(json.properties.limit?.default).toBe(5);
    expect(json.additionalProperties).toBe(false);
  });
});
