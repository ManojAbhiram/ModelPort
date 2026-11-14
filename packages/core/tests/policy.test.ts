import { describe, expect, it } from 'vitest';
import { assertRequestPolicy, inputMediaTypes, isBlockedModel } from '../src/policy.js';

describe('shared provider request policy', () => {
  it.each(['openrouter/auto', 'openrouter/auto-beta', 'openrouter/auto-code', 'openrouter/auto:free', 'vendor/model:online'])('blocks automatic or built-in-tool profile %s', (id) => {
    expect(isBlockedModel('openrouter', id)).toBe(true);
    expect(() => assertRequestPolicy('openrouter', { modelId: id, operation: 'text' })).toThrow(/Automatic model routing/);
  });

  it('does not reject ordinary model IDs or another provider using the same string', () => {
    expect(isBlockedModel('openrouter', 'vendor/automatic-model')).toBe(false);
    expect(isBlockedModel('custom-local', 'openrouter/auto')).toBe(false);
    expect(() => assertRequestPolicy('openrouter', { modelId: 'vendor/model', operation: 'text' })).not.toThrow();
  });

  it('keeps the existing Groq compound exclusion', () => {
    expect(isBlockedModel('groq', 'groq/compound')).toBe(true);
    expect(isBlockedModel('groq', 'groq/compound-mini')).toBe(true);
    expect(isBlockedModel('groq', 'ordinary-chat')).toBe(false);
  });

  it('uses provider-specific image types and separate audio types', () => {
    expect(inputMediaTypes('cerebras', 'vision')).toEqual(['image/png', 'image/jpeg']);
    expect(inputMediaTypes('openai', 'vision')).toContain('image/webp');
    expect(inputMediaTypes('groq', 'stt')).toContain('audio/wav');
    expect(inputMediaTypes('openai', 'text')).toEqual([]);
    expect(() => assertRequestPolicy('cerebras', { modelId: 'vision-model', operation: 'vision', media: { mimeType: 'image/webp', data: 'unused' } })).toThrow(/input media type/);
    expect(() => assertRequestPolicy('cerebras', { modelId: 'vision-model', operation: 'vision', media: { mimeType: 'image/png', data: 'unused' } })).not.toThrow();
  });
});
