import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from '../src/adapters.js';
import { getProvider, PROVIDERS } from '../src/catalog.js';
import { ModelPortError } from '../src/errors.js';
import { ModelPort } from '../src/modelport.js';
import { OPERATIONS } from '../src/types.js';
import type { ConnectionConfig, RunInput, Transport, TransportRequest, TransportResponse } from '../src/types.js';

const KEY = 'sk-contract-secret-never-in-body-or-errors';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
const IMAGE = { mimeType: 'image/png', data: PNG };
const AUDIO = { mimeType: 'audio/wav', data: Buffer.from('RIFF\0\0\0\0WAVEfmt test audio').toString('base64') };
const MP3 = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 255, 251, 144, 0]);
const CHAT = { choices: [{ message: { content: 'answer' } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };

function response(value: unknown, status = 200): TransportResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) };
}

function fixture(...responses: TransportResponse[]) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error('Unexpected extra transport request. Live provider calls are forbidden.');
    return next;
  };
  return { adapter: createAdapter(transport), requests };
}

function config(id: string): ConnectionConfig {
  return { providerId: id, ...(getProvider(id).kind === 'cloud' ? { apiKey: KEY } : {}) };
}

function input(overrides: Partial<RunInput> = {}): RunInput {
  return { connectionId: 'connection', modelId: 'declared-chat-model', operation: 'text', text: 'A short prompt', maxOutputTokens: 37, ...overrides };
}

function body(request: TransportRequest): Record<string, any> {
  expect(typeof request.body).toBe('string');
  return JSON.parse(request.body as string);
}

function metadata(id: string): unknown {
  switch (id) {
    case 'anthropic': return { data: [], has_more: false, last_id: null };
    case 'gemini': return { models: [] };
    case 'cohere': return { valid: true };
    case 'elevenlabs': return [];
    case 'deepgram': return { api_key_id: 'key-id', scopes: ['usage:read'] };
    case 'xai': return { api_key_disabled: false, api_key_blocked: false, team_blocked: false };
    case 'openrouter': return { data: { label: 'redacted-label', limit_remaining: 0 } };
    case 'huggingface': return { name: 'contract-user', type: 'user', auth: { type: 'access_token' } };
    case 'together': return [];
    case 'ollama': return { models: [] };
    default: return { data: [] };
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Tests must use the injected fake Transport, never live fetch.'); }));
});
afterEach(() => vi.unstubAllGlobals());

describe('provider registry', () => {
  it('has unique profiles, usable official origins, and explicit planned entries', () => {
    expect(new Set(PROVIDERS.map((provider) => provider.id)).size).toBe(PROVIDERS.length);
    for (const provider of PROVIDERS) {
      expect(provider.docsUrl).toMatch(/^https:\/\//);
      if (provider.status === 'planned') {
        expect(provider.adapter).toBeNull();
        expect(provider.operations).toEqual([]);
        expect(provider.baseUrl).toBe('');
        expect(provider.verification.mode).toBe('unsupported');
      } else {
        expect(provider.adapter).not.toBeNull();
        expect(provider.operations.length).toBeGreaterThan(0);
        expect(new URL(provider.baseUrl).protocol).toBe(provider.kind === 'cloud' ? 'https:' : 'http:');
      }
    }
    expect(getProvider('openai').operations).toEqual([...OPERATIONS]);
    expect(getProvider('together').operations).not.toContain('embedding');
    expect(getProvider('huggingface').operations).toEqual(['text', 'vision']);
    expect(getProvider('perplexity').status).toBe('planned');
  });

  it('rejects unknown IDs without echoing arbitrary input and isolates returned definitions', () => {
    expect(() => getProvider(KEY)).toThrow(ModelPortError);
    expect(() => getProvider(KEY)).toThrow('Unknown provider.');
    const provider = getProvider('openai');
    provider.operations.length = 0;
    provider.verification.path = 'chat/completions';
    expect(getProvider('openai').operations).toHaveLength(6);
    expect(getProvider('openai').verification.path).toBe('models');
  });
});

describe('read-only verification', () => {
  it.each(PROVIDERS.map((provider) => [provider.id]))('%s never invokes inference to verify credentials', async (id) => {
    const provider = getProvider(id);
    const { adapter, requests } = fixture(response(metadata(id)));
    const controller = new AbortController();
    const verification = await adapter.verify(config(id), provider, { signal: controller.signal });
    expect(verification.inferenceTested).toBe(false);
    expect(Number.isFinite(Date.parse(verification.checkedAt))).toBe(true);
    expect(JSON.stringify(verification)).not.toContain(KEY);
    if (provider.verification.mode === 'unsupported') {
      expect(verification.state).toBe('unverified');
      expect(requests).toHaveLength(0);
      return;
    }
    expect(verification.state).toBe(provider.kind === 'local' || provider.verification.mode === 'public' ? 'reachable' : 'authenticated');
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const expected = `${provider.verification.origin ?? provider.baseUrl}/${provider.verification.path}`;
    expect(request.url).toBe(expected);
    expect(request.method).toBe(id === 'cohere' ? 'POST' : 'GET');
    expect(request.signal).toBe(controller.signal);
    expect(request.body).toBeUndefined();
    expect(request.url).not.toMatch(/chat\/completions|\/messages|generateContent|embedContent|\/listen|text-to-speech|audio\//);
    expect(request.url).not.toContain(KEY);
    expect(request.allowedOrigins).toContain(new URL(request.url).origin);
    expect(request.allowLoopback).toBe(provider.kind === 'local' ? true : undefined);
  });

  it.each(['api_key_disabled', 'api_key_blocked', 'team_blocked'])('rejects xAI %s even on HTTP 200', async (flag) => {
    const value = { ...(metadata('xai') as object), [flag]: true };
    const { adapter, requests } = fixture(response(value));
    await expect(adapter.verify(config('xai'), getProvider('xai'))).rejects.toMatchObject({ code: 'PROVIDER_FORBIDDEN', statusCode: 403 });
    expect(requests).toHaveLength(1);
  });

  it('does not treat a missing xAI status field or false Cohere valid flag as authentication', async () => {
    const xai = fixture(response({ api_key_disabled: false, api_key_blocked: false }));
    await expect(xai.adapter.verify(config('xai'), getProvider('xai'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    const cohere = fixture(response({ valid: false, owner_id: KEY }));
    await expect(cohere.adapter.verify(config('cohere'), getProvider('cohere'))).rejects.toMatchObject({ code: 'PROVIDER_AUTH', statusCode: 401 });
  });

  it('keeps public-only and optional-auth local metadata at reachable', async () => {
    const provider = getProvider('openrouter');
    provider.verification = { mode: 'public', path: 'models?output_modalities=all' };
    const publicProbe = fixture(response({ data: [] }));
    expect((await publicProbe.adapter.verify(config('openrouter'), provider)).state).toBe('reachable');
    expect(publicProbe.requests[0]!.headers?.authorization).toBeUndefined();
    const local = fixture(response({ data: [] }));
    const cfg = { ...config('lm-studio'), apiKey: KEY };
    expect((await local.adapter.verify(cfg, getProvider('lm-studio'))).state).toBe('reachable');
    expect(local.requests[0]!.headers?.authorization).toBe(`Bearer ${KEY}`);
  });

  it.each(['openrouter', 'huggingface', 'deepgram'])('%s catalogs are public and cannot replace identity checks', async (id) => {
    const data = id === 'deepgram' ? { stt: [], tts: [] } : { data: [] };
    const { adapter, requests } = fixture(response(data));
    const catalog = await adapter.listModels(config(id), getProvider(id));
    expect(catalog.warning).toContain('public');
    expect(requests[0]!.headers?.authorization).toBeUndefined();
    expect(requests[0]!.url).toContain('/models');
    const verification = fixture(response(metadata(id)));
    expect((await verification.adapter.verify(config(id), getProvider(id))).state).toBe('authenticated');
    expect(verification.requests[0]!.headers?.authorization).toBe(`${id === 'deepgram' ? 'Token' : 'Bearer'} ${KEY}`);
    if (id === 'huggingface') {
      expect(verification.requests[0]!.url).toBe('https://huggingface.co/api/whoami-v2');
      expect(verification.requests[0]!.allowedOrigins).toEqual(['https://router.huggingface.co', 'https://huggingface.co']);
    }
  });

  it('requires an explicit cloud key, even for a public catalog or an unverified profile', async () => {
    for (const id of ['openai', 'openrouter', 'huggingface', 'fireworks', 'sambanova', 'elevenlabs']) {
      const { adapter, requests } = fixture();
      await expect(adapter.verify({ providerId: id }, getProvider(id))).rejects.toMatchObject({ code: 'API_KEY_REQUIRED' });
      await expect(adapter.listModels({ providerId: id }, getProvider(id))).rejects.toMatchObject({ code: 'API_KEY_REQUIRED' });
      expect(requests).toHaveLength(0);
    }
  });

  it('does not authenticate ElevenLabs credentials from the headerless model-list contract', async () => {
    const { adapter, requests } = fixture(response([]), response([]));
    const verification = await adapter.verify(config('elevenlabs'), getProvider('elevenlabs'));
    expect(verification).toMatchObject({ state: 'reachable', inferenceTested: false });
    expect((await adapter.listModels(config('elevenlabs'), getProvider('elevenlabs'))).warning).toContain('public');
    expect(requests.every((request) => request.headers?.['xi-api-key'] === undefined)).toBe(true);
    expect(requests.every((request) => request.url === 'https://api.elevenlabs.io/v1/models')).toBe(true);
  });

  it('uses the Anthropic version/workspace and Google key headers, never query authentication', async () => {
    const anthropic = fixture(response(metadata('anthropic')));
    await anthropic.adapter.verify({ ...config('anthropic'), workspaceId: 'wrkspc_contract' }, getProvider('anthropic'));
    expect(anthropic.requests[0]!.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2026-10-21', 'anthropic-workspace-id': 'wrkspc_contract' });
    const google = fixture(response(metadata('gemini')));
    await google.adapter.verify(config('gemini'), getProvider('gemini'));
    expect(google.requests[0]!.headers?.['x-goog-api-key']).toBe(KEY);
    expect(new URL(google.requests[0]!.url).search).toBe('');
  });
});

describe('metadata cancellation', () => {
  it.each(['verify', 'listModels'] as const)('rejects already-aborted %s without transport or leaking the reason', async (method) => {
    for (const [reason, code, statusCode] of [
      [undefined, 'METADATA_CANCELLED', 499],
      [new Error(`cancel ${KEY}`), 'METADATA_CANCELLED', 499],
      [new ModelPortError('METADATA_CANCELLED', KEY, 400), 'METADATA_CANCELLED', 499],
      [new ModelPortError('METADATA_TIMEOUT', KEY, 400), 'METADATA_TIMEOUT', 504],
      [new ModelPortError('PROVIDER_TIMEOUT', KEY, 504), 'METADATA_CANCELLED', 499],
    ] as const) {
      const controller = new AbortController();
      controller.abort(reason);
      const { adapter, requests } = fixture();
      const error = await adapter[method](config('openai'), getProvider('openai'), { signal: controller.signal }).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ModelPortError);
      expect(error).toMatchObject({ code, statusCode });
      expect(String(error)).toContain('No inference was attempted.');
      expect(String(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(error).not.toHaveProperty('cause');
      expect(requests).toHaveLength(0);
    }
  });

  it.each(['verify', 'listModels'] as const)('does not return a cancelled %s response from a transport that ignores the signal', async (method) => {
    for (const deferred of [false, true]) {
      const controller = new AbortController();
      const requests: TransportRequest[] = [];
      const adapter = createAdapter(async (request) => {
        requests.push(request);
        if (deferred) queueMicrotask(() => queueMicrotask(() => controller.abort(new Error(KEY))));
        else controller.abort(new Error(KEY));
        return response({ data: [] });
      });
      await expect(adapter[method](config('openai'), getProvider('openai'), { signal: controller.signal })).rejects.toMatchObject({ code: 'METADATA_CANCELLED', statusCode: 499 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.signal).toBe(controller.signal);
    }
  });

  it.each(['verify', 'listModels'] as const)('preserves only sanitized known metadata transport codes for %s', async (method) => {
    for (const [code, statusCode] of [['METADATA_CANCELLED', 499], ['METADATA_TIMEOUT', 504]] as const) {
      let calls = 0;
      const adapter = createAdapter(async () => {
        calls++;
        throw new ModelPortError(code, `transport ${KEY}`, 400);
      });
      const error = await adapter[method](config('openai'), getProvider('openai')).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ModelPortError);
      expect(error).toMatchObject({ code, statusCode });
      expect(String(error)).toContain('No inference was attempted.');
      expect(String(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(error).not.toHaveProperty('cause');
      expect(calls).toBe(1);
    }
  });
});

describe('catalog normalization', () => {
  it('fails closed for unknown OpenAI IDs, including misleading name fragments', async () => {
    const { adapter } = fixture(response({ data: [
      { id: 'gpt-4o' }, { id: 'gpt-4o-audio-preview' }, { id: 'not-a-gpt-4o' },
      { id: 'gpt-image-1.5' }, { id: 'text-embedding-3-small' }, { id: '__proto__' },
      { id: 'bad\nidentifier', secret: KEY },
    ] }));
    const result = await adapter.listModels(config('openai'), getProvider('openai'));
    expect(result.models.map((model) => [model.id, model.operations, model.capabilitySource])).toEqual([
      ['gpt-4o', ['text', 'vision'], 'reference'], ['gpt-4o-audio-preview', [], 'unknown'], ['not-a-gpt-4o', [], 'unknown'],
      ['gpt-image-1.5', ['image'], 'reference'], ['text-embedding-3-small', ['embedding'], 'reference'], ['__proto__', [], 'unknown'],
    ]);
    expect(result.warning).toContain('Unknown capabilities');
    expect(result.warning).toContain('invalid identifiers');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('disables shutdown metadata and does not auto-enable retired image model IDs', async () => {
    const { adapter } = fixture(response({ data: [
      { id: 'gpt-4o', shutdown_date: '2000-01-01' },
      { id: 'gpt-4o-mini', shutdown_date: '9999-12-31' },
      { id: 'gpt-image-1' }, { id: 'dall-e-2' }, { id: 'dall-e-3' },
      { id: 'gpt-image-2.5-flare' },
    ] }));
    const result = await adapter.listModels(config('openai'), getProvider('openai'));
    expect(result.models.map((model) => model.operations)).toEqual([[], ['text', 'vision'], [], [], [], ['image']]);
    expect(result.models[0]!.capabilitySource).toBe('provider');
    expect(result.warning).toContain('shutdown');
  });

  it('uses Anthropic metadata without promoting arbitrary IDs or overriding explicit negatives', async () => {
    const { adapter } = fixture(response({ data: [
      { id: 'new-claude', display_name: 'New Claude', max_tokens: 4096, max_input_tokens: 200000, capabilities: { image_input: { supported: true } } },
      { id: 'unknown-claude', capabilities: {} },
      { id: 'claude-sonnet-4-5', capabilities: { image_input: { supported: false } } },
      { id: 'retired-claude', lifecycle: 'retired', max_tokens: 4096, capabilities: { image_input: { supported: true } } },
    ], has_more: false }));
    const { models } = await adapter.listModels(config('anthropic'), getProvider('anthropic'));
    expect(models[0]).toEqual({ id: 'new-claude', name: 'New Claude', providerId: 'anthropic', operations: ['text', 'vision'], capabilitySource: 'provider', contextWindow: 200000 });
    expect(models[1]).toMatchObject({ operations: [], capabilitySource: 'unknown' });
    expect(models[2]).toMatchObject({ operations: ['text'], capabilitySource: 'reference' });
    expect(models[3]!.operations).toEqual([]);
  });

  it('does not infer Gemini text/vision from generateContent alone', async () => {
    const { adapter } = fixture(response({ models: [
      { name: 'models/unknown-image-generator', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 8192 },
      { name: 'models/new-embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['embedContent'] },
    ] }));
    const { models } = await adapter.listModels(config('gemini'), getProvider('gemini'));
    expect(models[0]).toMatchObject({ id: 'unknown-image-generator', operations: [], capabilitySource: 'unknown' });
    expect(models[1]).toMatchObject({ id: 'gemini-2.5-flash', name: 'Gemini', operations: ['text', 'vision'], capabilitySource: 'reference', contextWindow: 8192 });
    expect(models[2]).toMatchObject({ operations: ['embedding'], capabilitySource: 'provider' });
    expect(models[3]!.operations).toEqual(['embedding']);
  });

  it('normalizes Mistral flags, Cohere endpoint metadata, and ElevenLabs native capability fields', async () => {
    const mistral = fixture(response({ data: [
      { id: 'mistral-new', capabilities: { completion_chat: true, vision: true }, max_context_length: 32000 },
      { id: 'mistral-embed', capabilities: { completion_chat: false, vision: false } },
      { id: 'unknown' },
    ] }));
    const m = (await mistral.adapter.listModels(config('mistral'), getProvider('mistral'))).models;
    expect(m[0]).toMatchObject({ operations: ['text', 'vision'], capabilitySource: 'provider', contextWindow: 32000 });
    expect(m[1]).toMatchObject({ operations: ['embedding'], capabilitySource: 'reference' });
    expect(m[2]).toMatchObject({ operations: [], capabilitySource: 'unknown' });
    const cohere = fixture(response({ models: [
      { name: 'command-test', endpoints: ['chat'], context_length: 8192 },
      { name: 'embed-test', endpoints: ['embed'] }, { name: 'rerank-test', endpoints: ['rerank'] },
    ] }));
    const c = (await cohere.adapter.listModels(config('cohere'), getProvider('cohere'))).models;
    expect(c.map((model) => model.operations)).toEqual([['text'], ['embedding'], []]);
    expect(c.every((model) => model.capabilitySource === 'provider')).toBe(true);
    const eleven = fixture(response([{ model_id: 'eleven-test', name: 'Eleven', can_do_text_to_speech: true }, { model_id: 'voice-conversion', can_do_text_to_speech: false }]));
    const e = (await eleven.adapter.listModels(config('elevenlabs'), getProvider('elevenlabs'))).models;
    expect(e[0]).toMatchObject({ id: 'eleven-test', name: 'Eleven', operations: ['tts'], capabilitySource: 'provider' });
    expect(e[1]!.operations).toEqual([]);
  });

  it.each(['openrouter', 'huggingface'])('%s modality metadata is intersected with chat-only operations', async (id) => {
    const { adapter, requests } = fixture(response({ data: [
      { id: 'vision-model', name: 'Vision', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, context_length: 12345, extra: KEY },
      { id: 'image-model', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
      { id: 'unknown-model' },
    ] }));
    const result = await adapter.listModels(config(id), getProvider(id));
    expect(result.models.map((model) => model.operations)).toEqual([['text', 'vision'], [], []]);
    expect(result.models.map((model) => model.capabilitySource)).toEqual(['provider', 'provider', 'unknown']);
    expect(JSON.stringify(result)).not.toContain(KEY);
    if (id === 'openrouter') expect(new URL(requests[0]!.url).searchParams.get('output_modalities')).toBe('all');
  });

  it('uses current DeepSeek top-level modalities and context-window metadata', async () => {
    const { adapter } = fixture(response({ data: [
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, input_modalities: ['text', 'image'], output_modalities: ['text'] },
      { id: 'deepseek-v4-pro', input_modalities: ['text'], output_modalities: ['text'] },
      { id: 'deepseek-chat', input_modalities: [], output_modalities: ['text'] },
      { id: 'partial-metadata', input_modalities: ['image'] },
    ] }));
    const { models } = await adapter.listModels(config('deepseek'), getProvider('deepseek'));
    expect(models[0]).toEqual({ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', providerId: 'deepseek', operations: ['text', 'vision'], capabilitySource: 'provider', contextWindow: 1048576 });
    expect(models[1]).toMatchObject({ operations: ['text'], capabilitySource: 'provider' });
    expect(models[2]).toMatchObject({ operations: [], capabilitySource: 'provider' });
    expect(models[3]).toMatchObject({ operations: [], capabilitySource: 'unknown' });
  });

  it('handles Together bare lists without claiming serverless embeddings', async () => {
    const { adapter } = fixture(response([
      { id: 'chat-model', type: 'chat', display_name: 'Chat' },
      { id: 'Qwen/Qwen3.5-9B', type: 'chat' },
      { id: 'embedding-model', type: 'embedding' },
      { id: 'raw-completion-model', type: 'language' },
    ]));
    const { models } = await adapter.listModels(config('together'), getProvider('together'));
    expect(models.map((model) => model.operations)).toEqual([['text'], ['text', 'vision'], [], []]);
    expect(models[1]!.capabilitySource).toBe('reference');
    const invalid = fixture(response({ data: [] }));
    await expect(invalid.adapter.listModels(config('together'), getProvider('together'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('only enables Deepgram prerecorded STT for batch-capable entries', async () => {
    const { adapter } = fixture(response({
      stt: [
        { name: 'general', canonical_name: 'nova-3-general', batch: true, streaming: true },
        { name: 'stream-only', canonical_name: 'flux-general-en', batch: false, streaming: true },
        { canonical_name: 'unknown-stt' },
      ],
      tts: [{ canonical_name: 'aura-voice-en', metadata: { sample: 'https://media.example.test/sample.mp3' } }],
    }));
    const { models } = await adapter.listModels(config('deepgram'), getProvider('deepgram'));
    expect(models.map((model) => model.operations)).toEqual([['stt'], [], [], []]);
    expect(models[0]!.id).toBe('nova-3-general');
    expect(models[2]!.capabilitySource).toBe('unknown');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('keeps local filenames unknown and makes no extra model inspection calls', async () => {
    const local = fixture(response({ data: [{ id: 'gpt-4o' }, { id: 'my-model.gguf' }] }));
    expect((await local.adapter.listModels(config('lm-studio'), getProvider('lm-studio'))).models.every((model) => model.capabilitySource === 'unknown' && !model.operations.length)).toBe(true);
    const ollama = fixture(response({ models: [
      { name: 'llava:7b' }, { name: 'nomic-embed-text:latest' }, { name: 'unknown-model', details: { family: 'llama' } },
    ] }));
    expect((await ollama.adapter.listModels(config('ollama'), getProvider('ollama'))).models.map((model) => model.operations)).toEqual([['text', 'vision'], ['embedding'], []]);
    expect(ollama.requests).toHaveLength(1);
    expect(ollama.requests[0]!.url).toBe('http://127.0.0.1:11434/api/tags');
  });

  it('does not invent Fireworks discovery or any planned-provider route', async () => {
    for (const id of ['fireworks', ...PROVIDERS.filter((provider) => provider.status === 'planned').map((provider) => provider.id)]) {
      const { adapter, requests } = fixture();
      const result = await adapter.listModels(config(id), getProvider(id));
      expect(result.models).toEqual([]);
      expect(result.warning).toMatch(/Declare an exact model ID/);
      expect(requests).toEqual([]);
    }
  });

  it('uses the official SambaNova SDK model envelope without claiming protected credential validation', async () => {
    const { adapter, requests } = fixture(response({ data: [{ id: 'gpt-oss-120b' }, { id: 'unknown' }] }));
    expect((await adapter.verify(config('sambanova'), getProvider('sambanova'))).state).toBe('unverified');
    expect(requests).toHaveLength(0);
    const { models } = await adapter.listModels(config('sambanova'), getProvider('sambanova'));
    expect(models.map((model) => model.operations)).toEqual([['text'], []]);
    expect(requests[0]!.url).toBe('https://api.sambanova.ai/v1/models');
  });
});

describe('bounded pagination', () => {
  const token = 'cursor/next?origin=https://untrusted.example.test&x=1';
  it.each(['anthropic', 'gemini', 'cohere'])('%s uses escaped cursors, never provider-supplied URLs', async (id) => {
    const pages = id === 'anthropic'
      ? [{ data: [{ id: 'one' }], has_more: true, last_id: token }, { data: [{ id: 'two' }], has_more: false }]
      : id === 'gemini'
        ? [{ models: [{ name: 'models/one' }], nextPageToken: token }, { models: [{ name: 'models/two' }] }]
        : [{ models: [{ name: 'one' }], next_page_token: token }, { models: [{ name: 'two' }] }];
    const { adapter, requests } = fixture(...pages.map((page) => response(page)));
    const controller = new AbortController();
    expect((await adapter.listModels(config(id), getProvider(id), { signal: controller.signal })).models.map((model) => model.id)).toEqual(['one', 'two']);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.signal === controller.signal)).toBe(true);
    const url = new URL(requests[1]!.url);
    expect(url.origin).toBe(new URL(getProvider(id).baseUrl).origin);
    expect(url.searchParams.get(id === 'anthropic' ? 'after_id' : id === 'gemini' ? 'pageToken' : 'page_token')).toBe(token);
  });

  it.each(['anthropic', 'gemini', 'cohere'])('%s stops between pages when metadata is cancelled', async (id) => {
    const page = id === 'anthropic' ? { data: [{ id: 'one' }], has_more: true, last_id: token }
      : id === 'gemini' ? { models: [{ name: 'models/one' }], nextPageToken: token }
        : { models: [{ name: 'one' }], next_page_token: token };
    const { adapter, requests } = fixture(response(page));
    const controller = new AbortController();
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementationOnce((source) => {
      const value = parse(source);
      controller.abort(new Error(KEY));
      return value;
    });
    await expect(adapter.listModels(config(id), getProvider(id), { signal: controller.signal })).rejects.toMatchObject({ code: 'METADATA_CANCELLED', statusCode: 499 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal).toBe(controller.signal);
  });

  it.each(['anthropic', 'gemini', 'cohere'])('%s stops after ten pages with an explicit warning', async (id) => {
    const pages = Array.from({ length: 10 }, (_, index) => response(id === 'anthropic'
      ? { data: [{ id: `m-${index}` }], has_more: true, last_id: `next-${index}` }
      : id === 'gemini' ? { models: [{ name: `models/m-${index}` }], nextPageToken: `next-${index}` }
        : { models: [{ name: `m-${index}` }], next_page_token: `next-${index}` }));
    const { adapter, requests } = fixture(...pages);
    const result = await adapter.listModels(config(id), getProvider(id));
    expect(requests).toHaveLength(10);
    expect(result.models).toHaveLength(10);
    expect(result.warning).toContain('Catalog truncated');
  });

  it('caps large responses at 1,000 entries and deduplicates IDs', async () => {
    const many = fixture(response({ data: Array.from({ length: 1001 }, (_, index) => ({ id: `m-${index}` })) }));
    const result = await many.adapter.listModels(config('openai'), getProvider('openai'));
    expect(result.models).toHaveLength(1000);
    expect(result.warning).toContain('1,000 entries');
    const duplicate = fixture(response({ data: [{ id: 'same' }, { id: 'same' }] }));
    expect((await duplicate.adapter.listModels(config('openai'), getProvider('openai'))).models).toHaveLength(1);
  });

  it.each([[1000, 0], [0, 1000], [600, 400]])('accepts Deepgram at the combined limit with %i STT and %i TTS entries', async (sttCount, ttsCount) => {
    const { adapter, requests } = fixture(response({
      stt: Array.from({ length: sttCount }, (_, index) => ({ canonical_name: `stt-${index}`, batch: true })),
      tts: Array.from({ length: ttsCount }, (_, index) => ({ canonical_name: `tts-${index}` })),
    }));
    const result = await adapter.listModels(config('deepgram'), getProvider('deepgram'));
    expect(result.models).toHaveLength(1000);
    expect(result.warning ?? '').not.toContain('Catalog truncated');
    expect(requests).toHaveLength(1);
  });

  it.each([[1001, 0], [0, 1001], [500, 501]])('rejects oversized combined Deepgram catalogs with %i STT and %i TTS entries', async (sttCount, ttsCount) => {
    const { adapter, requests } = fixture(response({
      stt: Array.from({ length: sttCount }, (_, index) => ({ canonical_name: `stt-${index}`, batch: true })),
      tts: Array.from({ length: ttsCount }, (_, index) => ({ canonical_name: `tts-${index}` })),
    }));
    await expect(adapter.listModels(config('deepgram'), getProvider('deepgram'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', statusCode: 502 });
    expect(requests).toHaveLength(1);
  });

  it('rejects a dense million-entry Deepgram fixture before mapping, scanning, or spreading rows', async () => {
    const payload = Buffer.from(`{"stt":[${'{},'.repeat(999_999)}{}],"tts":[]}`);
    expect(payload.length).toBeLessThan(4 * 1024 * 1024);
    const { adapter, requests } = fixture({ status: 200, headers: { 'content-type': 'application/json' }, body: payload });
    const inspect = vi.fn((): never => { throw new Error('Oversized catalog rows must not be inspected or copied.'); });
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementationOnce((source) => {
      const value = parse(source) as { stt: unknown[]; tts: unknown[] };
      for (const entries of [value.stt, value.tts]) {
        entries.map = inspect;
        entries.some = inspect;
        entries[Symbol.iterator] = inspect;
      }
      return value;
    });
    await expect(adapter.listModels(config('deepgram'), getProvider('deepgram'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', statusCode: 502 });
    expect(inspect).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it('stops repeated/malformed/credential-reflecting cursors instead of retrying', async () => {
    for (const next of [42, '', KEY]) {
      const { adapter, requests } = fixture(response({ data: [], has_more: true, last_id: next }));
      expect((await adapter.listModels(config('anthropic'), getProvider('anthropic'))).warning).toContain('invalid or repeated');
      expect(requests).toHaveLength(1);
    }
    const { adapter, requests } = fixture(response({ models: [], nextPageToken: 'repeat' }), response({ models: [], nextPageToken: 'repeat' }));
    expect((await adapter.listModels(config('gemini'), getProvider('gemini'))).warning).toContain('invalid or repeated');
    expect(requests).toHaveLength(2);
  });
});

describe('native and compatible inference encodings', () => {
  it.each(PROVIDERS.filter((provider) => provider.adapter === 'openai').map((provider) => [provider.id]))('%s sends exactly one documented compatible chat request', async (id) => {
    const { adapter, requests } = fixture(response({ ...CHAT, raw_secret: KEY, extra: { id: 'not-returned' } }));
    const result = await adapter.run(config(id), getProvider(id), input());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal).toBeUndefined();
    expect(requests[0]!.url).toBe(`${getProvider(id).baseUrl}/chat/completions`);
    expect(body(requests[0]!)).toMatchObject({ model: 'declared-chat-model', messages: [{ role: 'user', content: 'A short prompt' }], max_tokens: 37, stream: false });
    expect(body(requests[0]!)).not.toHaveProperty('tools');
    expect(body(requests[0]!)).not.toHaveProperty('models');
    if (id === 'openrouter') {
      expect(body(requests[0]!).provider).toEqual({ allow_fallbacks: false });
      expect(body(requests[0]!).modalities).toEqual(['text']);
    }
    expect(result).toEqual({ providerId: id, modelId: 'declared-chat-model', operation: 'text', text: 'answer', usage: { inputTokens: 3, outputTokens: 5 } });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(requests[0]!.url).not.toContain(KEY);
    expect(requests[0]!.body).not.toContain(KEY);
    expect(requests[0]!.allowLoopback).toBe(getProvider(id).kind === 'local' ? true : undefined);
    if (getProvider(id).kind === 'cloud') expect(requests[0]!.headers?.authorization).toBe(`Bearer ${KEY}`);
  });

  it.each(['gpt-5', 'gpt-5-mini', 'o3', 'o4-mini', 'o1'])('uses max_completion_tokens for OpenAI %s without retrying an older format', async (modelId) => {
    const { adapter, requests } = fixture(response(CHAT));
    await adapter.run(config('openai'), getProvider('openai'), input({ modelId }));
    expect(body(requests[0]!)).toHaveProperty('max_completion_tokens', 37);
    expect(body(requests[0]!)).not.toHaveProperty('max_tokens');
    expect(requests).toHaveLength(1);
  });

  it('encodes compatible vision inline, not as a downloadable URL', async () => {
    const { adapter, requests } = fixture(response(CHAT));
    await adapter.run(config('openai'), getProvider('openai'), input({ operation: 'vision', modelId: 'gpt-4o', media: IMAGE }));
    expect(body(requests[0]!).messages[0].content).toEqual([
      { type: 'text', text: 'A short prompt' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each(['text', 'vision'] as const)('encodes native Anthropic %s and returns only text blocks', async (operation) => {
    const { adapter, requests } = fixture(response({ content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: KEY }, { type: 'text', text: ' world' }], usage: { input_tokens: 2, output_tokens: 4 }, id: 'upstream-id' }));
    const result = await adapter.run({ ...config('anthropic'), workspaceId: 'wrkspc_contract' }, getProvider('anthropic'), input({ operation, modelId: 'claude-sonnet-4-5', ...(operation === 'vision' ? { media: IMAGE } : {}) }));
    const encoded = body(requests[0]!);
    expect(requests[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(encoded.max_tokens).toBe(37);
    expect(encoded.stream).toBe(false);
    expect(encoded.messages[0].content[0]).toEqual({ type: 'text', text: 'A short prompt' });
    if (operation === 'vision') expect(encoded.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
    expect(result.text).toBe('Hello world');
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 4 });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(requests[0]!.headers?.['x-api-key']).toBe(KEY);
  });

  it.each(['text', 'vision'] as const)('encodes native Gemini %s with the approved generation cap', async (operation) => {
    const { adapter, requests } = fixture(response({ candidates: [{ content: { parts: [{ thought: true, text: KEY }, { text: 'Gemini answer' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 8 } }));
    const result = await adapter.run(config('gemini'), getProvider('gemini'), input({ operation, modelId: 'models/gemini-2.5-flash', ...(operation === 'vision' ? { media: IMAGE } : {}) }));
    expect(requests[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(requests[0]!.headers?.['x-goog-api-key']).toBe(KEY);
    const encoded = body(requests[0]!);
    expect(encoded.generationConfig).toEqual({ maxOutputTokens: 37, candidateCount: 1, responseModalities: ['TEXT'] });
    if (operation === 'vision') expect(encoded.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG } });
    expect(result.text).toBe('Gemini answer');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 8 });
    expect(requests[0]!.url).not.toContain(KEY);
  });

  it.each(['COMPLETE', 'STOP_SEQUENCE', 'MAX_TOKENS'])('encodes Cohere v2 chat and accepts legitimate %s completion', async (finishReason) => {
    const { adapter, requests } = fixture(response({ finish_reason: finishReason, message: { content: [{ type: 'text', text: 'Cohere answer' }] }, usage: { tokens: { input_tokens: 4, output_tokens: 6 } } }));
    const result = await adapter.run(config('cohere'), getProvider('cohere'), input({ modelId: 'command-test' }));
    expect(requests[0]!.url).toBe('https://api.cohere.com/v2/chat');
    expect(body(requests[0]!)).toEqual({ model: 'command-test', messages: [{ role: 'user', content: 'A short prompt' }], max_tokens: 37, stream: false });
    expect(result.text).toBe('Cohere answer');
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 6 });
  });

  it.each([['ERROR', 'PROVIDER_GENERATION_FAILED', 502], ['TIMEOUT', 'PROVIDER_TIMEOUT', 504]] as const)('rejects Cohere HTTP 200 %s partial output without retrying or restoring approval', async (finishReason, code, statusCode) => {
    const { adapter, requests } = fixture(
      response(metadata('cohere')),
      response({ models: [{ name: 'command-test', endpoints: ['chat'] }] }),
      response({ finish_reason: finishReason, message: { content: [{ type: 'text', text: `partial ${KEY}` }] }, usage: { tokens: { input_tokens: 4, output_tokens: 6 } }, error_message: KEY }),
    );
    const port = new ModelPort({ adapter });
    try {
      const connection = await port.connect(config('cohere'));
      const approval = port.prepare(input({ connectionId: connection.id, modelId: 'command-test' }));
      expect(port.listApprovals()).toHaveLength(1);
      const error = await port.execute(approval.id, { consent: true }).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ModelPortError);
      expect(error).toMatchObject({ code, statusCode });
      expect(String(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(error).not.toHaveProperty('cause');
      expect(port.listApprovals()).toHaveLength(0);
      await expect(port.execute(approval.id, { consent: true })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
      expect(requests).toHaveLength(3);
      expect(requests.filter((request) => request.url.endsWith('/v2/chat'))).toHaveLength(1);
      expect(requests[2]!.signal).toBeUndefined();
    } finally {
      port.dispose();
    }
  });

  it.each(['text', 'vision'] as const)('encodes Ollama native %s with base64 images and num_predict', async (operation) => {
    const { adapter, requests } = fixture(response({ message: { content: 'Local answer' }, prompt_eval_count: 5, eval_count: 6, done: true }));
    const cfg = { ...config('ollama'), baseUrl: 'http://[::1]:11435' };
    const result = await adapter.run(cfg, getProvider('ollama'), input({ operation, modelId: 'llava:7b', ...(operation === 'vision' ? { media: IMAGE } : {}) }));
    expect(requests[0]!.url).toBe('http://[::1]:11435/api/chat');
    expect(requests[0]!.allowedOrigins).toEqual(['http://[::1]:11435']);
    expect(requests[0]!.allowLoopback).toBe(true);
    expect(body(requests[0]!)).toMatchObject({ stream: false, options: { num_predict: 37 } });
    if (operation === 'vision') expect(body(requests[0]!).messages[0].images).toEqual([PNG]);
    expect(result.text).toBe('Local answer');
  });

  it.each([
    'dall-e-2', 'dall-e-3', 'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5',
    'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
    'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'chatgpt-image-latest',
  ])('uses the correct base64 image contract for %s', async (modelId) => {
    const { adapter, requests } = fixture(response({ data: [{ b64_json: PNG, url: 'https://media.example.test/never-download.png', revised_prompt: KEY }] }));
    const result = await adapter.run(config('openai'), getProvider('openai'), input({ modelId, operation: 'image', maxOutputTokens: undefined }));
    const encoded = body(requests[0]!);
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(encoded).toMatchObject({ n: 1, size: '1024x1024' });
    if (!modelId.startsWith('dall-e')) {
      expect(encoded.output_format).toBe('png');
      expect(encoded.stream).toBe(false);
      expect(encoded).not.toHaveProperty('response_format');
    } else expect(encoded.response_format).toBe('b64_json');
    expect(result.media).toEqual(IMAGE);
    expect(result).not.toHaveProperty('revised_prompt');
    expect(requests).toHaveLength(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('never follows image output URLs or substitutes an unreviewed image protocol', async () => {
    const { adapter, requests } = fixture(response({ data: [{ url: 'https://media.example.test/private.png?credential=secret' }] }));
    await expect(adapter.run(config('openai'), getProvider('openai'), input({ operation: 'image', modelId: 'dall-e-3' }))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(requests).toHaveLength(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const unknown = fixture();
    await expect(unknown.adapter.run(config('openai'), getProvider('openai'), input({ operation: 'image', modelId: 'unreviewed-image' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL_PROTOCOL' });
    expect(unknown.requests).toHaveLength(0);
  });

  it.each(['openai', 'groq'])('%s transcription is safe multipart with raw audio, a random boundary, and a fixed filename', async (id) => {
    const { adapter, requests } = fixture(response({ text: 'Transcript', raw: KEY }), response({ text: '' }));
    const run = input({ operation: 'stt', modelId: id === 'openai' ? 'whisper-1' : 'whisper-large-v3', text: undefined, maxOutputTokens: undefined, media: AUDIO });
    expect((await adapter.run(config(id), getProvider(id), run)).text).toBe('Transcript');
    expect((await adapter.run(config(id), getProvider(id), run)).text).toBe('');
    const request = requests[0]!;
    expect(request.url).toBe(`${getProvider(id).baseUrl}/audio/transcriptions`);
    const boundary = request.headers!['content-type']!.split('boundary=')[1]!;
    expect(boundary).toMatch(/^modelport-[a-f0-9]{48}$/);
    expect(requests[1]!.headers!['content-type']).not.toBe(request.headers!['content-type']);
    const wire = Buffer.from(request.body!).toString();
    expect(wire).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${run.modelId}\r\n`);
    expect(wire).toContain('name="response_format"\r\n\r\njson\r\n');
    expect(wire).toContain('name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF');
    expect(wire.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    expect(wire).not.toContain(KEY);
    expect(wire).not.toContain('http');
  });

  it('encodes OpenAI speech and ElevenLabs native speech as MP3 without inference during voice discovery', async () => {
    for (const id of ['openai', 'elevenlabs']) {
      const { adapter, requests } = fixture({ status: 200, headers: { 'content-type': 'audio/mpeg' }, body: MP3 });
      const voice = id === 'openai' ? 'alloy' : 'JBFqnCBsd6RMkjVDRZzb';
      const modelId = id === 'openai' ? 'tts-1' : 'eleven_multilingual_v2';
      const result = await adapter.run(config(id), getProvider(id), input({ operation: 'tts', modelId, voice, maxOutputTokens: undefined }));
      expect(result.media).toEqual({ mimeType: 'audio/mpeg', data: Buffer.from(MP3).toString('base64') });
      expect(requests).toHaveLength(1);
      if (id === 'openai') {
        expect(requests[0]!.url).toBe('https://api.openai.com/v1/audio/speech');
        expect(body(requests[0]!)).toEqual({ model: modelId, input: 'A short prompt', voice, response_format: 'mp3' });
      } else {
        expect(requests[0]!.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`);
        expect(body(requests[0]!)).toEqual({ model_id: modelId, text: 'A short prompt' });
        expect(requests[0]!.headers?.['xi-api-key']).toBe(KEY);
      }
    }
  });

  it('sends Deepgram audio as raw bytes, with only the model query and Token header', async () => {
    const { adapter, requests } = fixture(response({ results: { channels: [{ alternatives: [{ transcript: 'Deepgram transcript', words: [{ word: KEY }] }] }] }, metadata: { secret: KEY } }));
    const result = await adapter.run(config('deepgram'), getProvider('deepgram'), input({ operation: 'stt', modelId: 'nova-3', text: undefined, media: AUDIO, maxOutputTokens: undefined }));
    expect(requests[0]!.url).toBe('https://api.deepgram.com/v1/listen?model=nova-3');
    expect(requests[0]!.headers).toMatchObject({ authorization: `Token ${KEY}`, 'content-type': 'audio/wav' });
    expect(Buffer.from(requests[0]!.body!)).toEqual(Buffer.from(AUDIO.data, 'base64'));
    expect(result).toEqual({ providerId: 'deepgram', modelId: 'nova-3', operation: 'stt', text: 'Deepgram transcript' });
  });

  it.each(['openai', 'mistral', 'lm-studio', 'vllm', 'custom-local'])('%s embedding uses the float OpenAI-compatible contract', async (id) => {
    const { adapter, requests } = fixture(response({ data: [{ embedding: [0.25, -0.5], index: 0 }], usage: { prompt_tokens: 2 } }));
    const result = await adapter.run(config(id), getProvider(id), input({ operation: 'embedding', modelId: 'declared-embed-model', maxOutputTokens: undefined }));
    expect(requests[0]!.url).toBe(`${getProvider(id).baseUrl}/embeddings`);
    expect(body(requests[0]!)).toEqual({ model: 'declared-embed-model', input: 'A short prompt', encoding_format: 'float' });
    expect(result.embedding).toEqual([0.25, -0.5]);
  });

  it('encodes and normalizes native Gemini, Cohere, and Ollama embeddings', async () => {
    const cases = [
      { id: 'gemini', modelId: 'gemini-embedding-001', payload: { embedding: { values: [0.1, 0.2] } }, suffix: '/models/gemini-embedding-001:embedContent', expected: { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'A short prompt' }] } } },
      { id: 'cohere', modelId: 'embed-v4.0', payload: { embeddings: { float: [[0.1, 0.2]] } }, suffix: '/v2/embed', expected: { model: 'embed-v4.0', texts: ['A short prompt'], input_type: 'search_document', embedding_types: ['float'], truncate: 'NONE' } },
      { id: 'ollama', modelId: 'nomic-embed-text', payload: { embeddings: [[0.1, 0.2]] }, suffix: '/api/embed', expected: { model: 'nomic-embed-text', input: 'A short prompt', truncate: false } },
    ];
    for (const item of cases) {
      const { adapter, requests } = fixture(response(item.payload));
      const result = await adapter.run(config(item.id), getProvider(item.id), input({ operation: 'embedding', modelId: item.modelId, maxOutputTokens: undefined }));
      expect(requests[0]!.url).toBe(`${getProvider(item.id).baseUrl}${item.suffix}`);
      expect(body(requests[0]!)).toEqual(item.expected);
      expect(result.embedding).toEqual([0.1, 0.2]);
      expect(requests).toHaveLength(1);
    }
  });
});

describe('fail-closed routing and safe errors', () => {
  it.each(PROVIDERS.map((provider) => [provider.id]))('%s rejects every operation outside its profile before transport', async (id) => {
    const provider = getProvider(id);
    const { adapter, requests } = fixture();
    for (const operation of OPERATIONS.filter((operation) => !provider.operations.includes(operation))) {
      await expect(adapter.run(config(id), provider, input({ operation }))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    }
    expect(requests).toEqual([]);
  });

  it('does not broaden protocol routes when a profile operation array is accidentally broadened', async () => {
    for (const [id, operation] of [['gemini', 'stt'], ['groq', 'embedding'], ['mistral', 'tts'], ['anthropic', 'image'], ['huggingface', 'embedding']] as const) {
      const provider = getProvider(id);
      provider.operations.push(operation);
      const { adapter, requests } = fixture();
      await expect(adapter.run(config(id), provider, input({ operation, ...(operation === 'stt' ? { media: AUDIO } : {}), voice: 'alloy' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
      expect(requests).toHaveLength(0);
    }
  });

  it.each([
    ['groq', 'groq/compound'], ['groq', 'groq/compound-mini'],
    ['openrouter', 'openrouter/auto'], ['openrouter', 'openrouter/auto-beta'], ['openrouter', 'openrouter/auto-code'],
    ['openrouter', 'openrouter/auto-new-family'], ['openrouter', 'openrouter/auto:variant'], ['openrouter', 'model:online'],
  ])('rejects implicit routing/tools for %s %s', async (id, modelId) => {
    const { adapter, requests } = fixture();
    for (const operation of ['text', 'vision'] as const) {
      await expect(adapter.run(config(id), getProvider(id), input({ modelId, operation, ...(operation === 'vision' ? { media: IMAGE } : {}) }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL_PROTOCOL', statusCode: 422 });
    }
    expect(requests).toHaveLength(0);
  });

  it('applies the shared model policy before non-chat inference routes', async () => {
    const { adapter, requests } = fixture();
    await expect(adapter.run(config('groq'), getProvider('groq'), input({ modelId: 'groq/compound', operation: 'stt', text: undefined, maxOutputTokens: undefined, media: AUDIO }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL_PROTOCOL', statusCode: 422 });
    expect(requests).toHaveLength(0);
  });

  it('validates basic native input shape before applying the shared policy', async () => {
    const { adapter, requests } = fixture();
    await expect(adapter.run(config('openrouter'), getProvider('openrouter'), input({ modelId: 'openrouter/auto-code', maxOutputTokens: undefined }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(adapter.run(config('cerebras'), getProvider('cerebras'), input({ operation: 'vision', media: { ...IMAGE, mimeType: 'image/svg+xml' } }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(requests).toHaveLength(0);
  });

  it.each([undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects missing or unsafe output cap %s', async (maxOutputTokens) => {
    const { adapter, requests } = fixture();
    await expect(adapter.run(config('openai'), getProvider('openai'), input({ maxOutputTokens }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(requests).toHaveLength(0);
  });

  it('rejects unsafe header values, unsupported MIME, invalid voice/model paths, and non-loopback local targets', async () => {
    const { adapter, requests } = fixture();
    await expect(adapter.verify({ ...config('openai'), apiKey: 'bad\r\nheader' }, getProvider('openai'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(adapter.verify({ ...config('anthropic'), workspaceId: 'bad\nworkspace' }, getProvider('anthropic'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(adapter.run(config('openai'), getProvider('openai'), input({ operation: 'stt', media: { data: AUDIO.data, mimeType: 'audio/wav\r\nInjected: yes' } }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(adapter.run(config('cerebras'), getProvider('cerebras'), input({ operation: 'vision', media: { ...IMAGE, mimeType: 'image/webp' } }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(adapter.run(config('gemini'), getProvider('gemini'), input({ modelId: '../models/secret?key=x' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_MODEL_PROTOCOL' });
    await expect(adapter.run(config('elevenlabs'), getProvider('elevenlabs'), input({ operation: 'tts', voice: '../../voices' }))).rejects.toMatchObject({ code: 'VOICE_REQUIRED' });
    await expect(adapter.verify({ providerId: 'ollama', baseUrl: 'https://remote.example.test' }, getProvider('ollama'))).rejects.toMatchObject({ code: 'UNSAFE_ENDPOINT' });
    expect(requests).toHaveLength(0);
  });

  it('ignores cloud base URL overrides and always supplies fixed official allowed origins', async () => {
    const { adapter, requests } = fixture(response(CHAT));
    await adapter.run({ ...config('openai'), baseUrl: 'https://untrusted.example.test' }, getProvider('openai'), input());
    expect(requests[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(requests[0]!.allowedOrigins).toEqual(['https://api.openai.com']);
    expect(requests[0]!.maxResponseBytes).toBe(16 * 1024 * 1024);
    expect(requests[0]!.timeoutMs).toBeLessThanOrEqual(120000);
  });

  it.each([[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_FORBIDDEN'], [429, 'PROVIDER_RATE_LIMIT'], [500, 'PROVIDER_HTTP']] as const)('sanitizes HTTP %s without exposing keys, upstream errors, or retrying', async (status, code) => {
    const { adapter, requests } = fixture(response({ error: { message: `upstream leaked ${KEY}`, url: `https://api.example.test?key=${KEY}` } }, status));
    const error = await adapter.verify(config('openai'), getProvider('openai')).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ModelPortError);
    expect(error).toMatchObject({ code, statusCode: status });
    expect(String(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(error).not.toHaveProperty('cause');
    expect(requests).toHaveLength(1);
  });

  it.each([new Error(`network ${KEY}`), new ModelPortError('PROVIDER_TIMEOUT', `timeout ${KEY}`, 504)])('sanitizes thrown transport errors', async (failure) => {
    let calls = 0;
    const transport: Transport = async () => { calls++; throw failure; };
    const error = await createAdapter(transport).run(config('openai'), getProvider('openai'), input()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ModelPortError);
    expect(error).toMatchObject({ code: failure instanceof ModelPortError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK', statusCode: failure instanceof ModelPortError ? 504 : 502 });
    expect(String(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(calls).toBe(1);
  });

  it('rejects redirects, malformed JSON, error-shaped 200s, and incomplete catalogs without guessing', async () => {
    const malformed = fixture({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(`<html>${KEY}`) });
    await expect(malformed.adapter.verify(config('openai'), getProvider('openai'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    const redirect = fixture({ status: 302, headers: { location: 'https://untrusted.example.test' }, body: new Uint8Array() });
    await expect(redirect.adapter.verify(config('openai'), getProvider('openai'))).rejects.toMatchObject({ code: 'PROVIDER_REDIRECT' });
    expect(redirect.requests).toHaveLength(1);
    for (const payload of [{ error: { message: KEY } }, {}, { data: [null] }]) {
      const bad = fixture(response(payload));
      await expect(bad.adapter.listModels(config('openai'), getProvider('openai'))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    }
  });

  it('rejects malformed native results and encoded/non-finite embeddings without returning raw extras', async () => {
    for (const embedding of ['AAAA', [null], [1, '2'], []]) {
      const { adapter } = fixture(response({ data: [{ embedding }], raw: KEY }));
      await expect(adapter.run(config('openai'), getProvider('openai'), input({ operation: 'embedding' }))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    }
    const speech = fixture(response({ error_message: KEY, url: 'https://media.example.test/audio.mp3' }));
    await expect(speech.adapter.run(config('openai'), getProvider('openai'), input({ operation: 'tts', voice: 'alloy' }))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    for (const contentType of ['constructor', '__proto__']) {
      const unsafeMime = fixture({ status: 200, headers: { 'content-type': contentType }, body: Buffer.from(KEY) });
      await expect(unsafeMime.adapter.run(config('openai'), getProvider('openai'), input({ operation: 'tts', voice: 'alloy' }))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    }
    const blocked = fixture(response({ promptFeedback: { blockReason: KEY } }));
    await expect(blocked.adapter.run(config('gemini'), getProvider('gemini'), input({ modelId: 'gemini-2.5-flash' }))).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
