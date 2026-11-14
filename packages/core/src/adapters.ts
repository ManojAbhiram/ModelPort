import { randomBytes } from 'node:crypto';
import { ModelPortError } from './errors.js';
import { assertRequestPolicy, AUDIO_TYPES, IMAGE_TYPES } from './policy.js';
import { OPERATIONS } from './types.js';
import type {
  CatalogResult, ConnectionConfig, MediaInput, Model, Operation, ProviderAdapter,
  ProviderDefinition, RunInput, RunResult, Transport, TransportRequest, TransportResponse, Verification,
} from './types.js';

type JsonObject = Record<string, unknown>;
type Result = Omit<RunResult, 'id' | 'durationMs'>;
const MAX_PAGES = 10;
const MAX_MODELS = 1000;
const GENERATION_BYTES = 16 * 1024 * 1024;
const TEXT: Operation[] = ['text'];
const VISION: Operation[] = ['text', 'vision'];
const GPT_IMAGE_MODELS = [
  'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2-2026-04-21',
  'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
  'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'chatgpt-image-latest',
];

// Deliberately small, exact-name references. No substring or universal chat fallback.
// References are used only for models actually returned by the provider's catalog.
const REFERENCES: Record<string, Record<string, Operation[]>> = {
  openai: {
    'gpt-3.5-turbo': TEXT, 'gpt-4': TEXT, 'gpt-4-turbo': VISION,
    'gpt-4o': VISION, 'gpt-4o-mini': VISION, 'gpt-4o-2024-08-06': VISION, 'gpt-4o-mini-2024-07-18': VISION,
    'gpt-4.1': VISION, 'gpt-4.1-mini': VISION, 'gpt-4.1-nano': VISION,
    'gpt-5': VISION, 'gpt-5-mini': VISION, 'gpt-5-nano': VISION,
    o3: VISION, 'o3-mini': TEXT, 'o4-mini': VISION,
    ...Object.fromEntries(GPT_IMAGE_MODELS.map((id) => [id, ['image'] as Operation[]])),
    'whisper-1': ['stt'], 'gpt-4o-transcribe': ['stt'], 'gpt-4o-mini-transcribe': ['stt'],
    'tts-1': ['tts'], 'tts-1-hd': ['tts'], 'gpt-4o-mini-tts': ['tts'],
    'text-embedding-3-small': ['embedding'], 'text-embedding-3-large': ['embedding'], 'text-embedding-ada-002': ['embedding'],
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': VISION, 'claude-3-5-haiku-20241022': VISION,
    'claude-sonnet-4-20250514': VISION, 'claude-opus-4-20250514': VISION,
    'claude-sonnet-4-5': VISION, 'claude-haiku-4-5': VISION, 'claude-opus-4-5': VISION,
  },
  gemini: {
    'gemini-2.0-flash': VISION, 'gemini-2.0-flash-lite': VISION,
    'gemini-2.5-flash': VISION, 'gemini-2.5-flash-lite': VISION, 'gemini-2.5-pro': VISION,
  },
  groq: {
    'llama-3.3-70b-versatile': TEXT, 'llama-3.1-8b-instant': TEXT,
    'meta-llama/llama-4-scout-17b-16e-instruct': VISION,
    'meta-llama/llama-4-maverick-17b-128e-instruct': VISION,
    'whisper-large-v3': ['stt'], 'whisper-large-v3-turbo': ['stt'],
  },
  mistral: { 'mistral-embed': ['embedding'], 'codestral-embed': ['embedding'] },
  deepseek: { 'deepseek-chat': TEXT, 'deepseek-reasoner': TEXT },
  xai: { 'grok-3': TEXT, 'grok-3-mini': TEXT, 'grok-2-vision-1212': VISION, 'grok-4': VISION },
  together: {
    'Qwen/Qwen3.5-9B': VISION, 'moonshotai/Kimi-K3': VISION,
    'moonshotai/Kimi-K3.1-Pro': VISION, 'nvidia/NVIDIA-Nemotron-3.5-Super-VL': VISION,
    'thinkingmachines/Inkling-2-Small': VISION,
  },
  cerebras: {
    'llama3.1-8b': TEXT, 'llama-3.3-70b': TEXT, 'gpt-oss-120b': TEXT, 'qwen-3.8-27b': VISION,
  },
  sambanova: { 'gpt-oss-120b': TEXT },
  ollama: {
    'llama3.2': TEXT, 'llama3.2:latest': TEXT, 'llama3.2:3b': TEXT, 'llama3.1:8b': TEXT,
    llava: VISION, 'llava:latest': VISION, 'llava:7b': VISION, 'llama3.2-vision:11b': VISION,
    'nomic-embed-text': ['embedding'], 'nomic-embed-text:latest': ['embedding'],
    'mxbai-embed-large': ['embedding'], 'mxbai-embed-large:latest': ['embedding'],
  },
};

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function invalidResponse(): never {
  throw new ModelPortError('INVALID_PROVIDER_RESPONSE', 'The provider returned an unexpected or unsupported response. No retry was attempted.', 502);
}

function json(response: TransportResponse): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
  } catch {
    return invalidResponse();
  }
  if (value === null || typeof value !== 'object') return invalidResponse();
  const root = object(value);
  if (root.error != null || root.err_code != null) return invalidResponse();
  return value;
}

function rows(provider: ProviderDefinition, value: unknown): JsonObject[] {
  const root = object(value);
  let entries: unknown;
  switch (provider.adapter) {
    case 'elevenlabs': entries = value; break;
    case 'gemini':
    case 'cohere':
    case 'ollama': entries = root.models; break;
    case 'deepgram': {
      if (!Array.isArray(root.stt) || !Array.isArray(root.tts)) return invalidResponse();
      if (root.stt.length + root.tts.length > MAX_MODELS) return invalidResponse();
      return [
        ...root.stt.map((entry) => ({ ...object(entry), catalogOperation: 'stt' })),
        ...root.tts.map((entry) => ({ ...object(entry), catalogOperation: 'tts' })),
      ];
    }
    default:
      // Together's official SDK consumes a bare list, not the OpenAI envelope.
      entries = provider.id === 'together' ? value : root.data;
  }
  if (!Array.isArray(entries) || entries.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) {
    return invalidResponse();
  }
  return entries as JsonObject[];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function modelFromRow(provider: ProviderDefinition, row: JsonObject): Model | undefined {
  const identifier = provider.adapter === 'gemini' || provider.adapter === 'cohere' || provider.adapter === 'ollama'
    ? row.name
    : provider.adapter === 'elevenlabs' ? row.model_id
      : provider.adapter === 'deepgram' ? row.canonical_name : row.id;
  if (typeof identifier !== 'string' || !identifier || identifier.length > 256 || /[\x00-\x20\x7f]/.test(identifier)) return undefined;
  const id = provider.adapter === 'gemini' ? identifier.replace(/^models\//, '') : identifier;
  if (!id) return undefined;
  const evidence = new Map<Operation, boolean>();
  let hasMetadata = false;
  const capability = object(row.capabilities);

  if (provider.adapter === 'anthropic') {
    if (positiveNumber(row.max_tokens)) { evidence.set('text', true); hasMetadata = true; }
    const imageInput = object(capability.image_input).supported;
    if (typeof imageInput === 'boolean') {
      evidence.set('vision', imageInput);
      if (imageInput) evidence.set('text', true);
      hasMetadata = true;
    }
  } else if (provider.adapter === 'gemini' && Array.isArray(row.supportedGenerationMethods)) {
    const methods = row.supportedGenerationMethods;
    evidence.set('embedding', methods.includes('embedContent'));
    if (methods.includes('embedContent')) hasMetadata = true;
    if (!methods.includes('generateContent')) {
      evidence.set('text', false);
      evidence.set('vision', false);
    }
    // generateContent also serves image/audio models; it is not a text/vision capability.
  } else if (provider.id === 'mistral') {
    if (typeof capability.completion_chat === 'boolean') {
      evidence.set('text', capability.completion_chat);
      hasMetadata = true;
    }
    if (typeof capability.vision === 'boolean') {
      evidence.set('vision', capability.vision && capability.completion_chat === true);
      hasMetadata = true;
    }
  } else if (provider.id === 'openrouter' || provider.id === 'huggingface' || provider.id === 'deepseek') {
    const architecture = provider.id === 'deepseek' ? row : object(row.architecture);
    if (Array.isArray(architecture.input_modalities) && Array.isArray(architecture.output_modalities)) {
      const textOutput = architecture.output_modalities.includes('text');
      evidence.set('text', textOutput && architecture.input_modalities.includes('text'));
      evidence.set('vision', textOutput && architecture.input_modalities.includes('image'));
      hasMetadata = true;
    }
  } else if (provider.id === 'together' && typeof row.type === 'string') {
    if (['chat', 'language', 'code', 'image', 'embedding', 'moderation', 'rerank', 'audio', 'transcribe', 'video'].includes(row.type)) {
      evidence.set('text', row.type === 'chat');
      if (row.type !== 'chat') evidence.set('vision', false);
      hasMetadata = true;
    }
  } else if (provider.adapter === 'cohere' && Array.isArray(row.endpoints)) {
    evidence.set('text', row.endpoints.includes('chat'));
    evidence.set('embedding', row.endpoints.includes('embed'));
    hasMetadata = true;
  } else if (provider.adapter === 'elevenlabs' && typeof row.can_do_text_to_speech === 'boolean') {
    evidence.set('tts', row.can_do_text_to_speech);
    hasMetadata = true;
  } else if (provider.adapter === 'deepgram') {
    if (row.catalogOperation === 'stt' && typeof row.batch === 'boolean') {
      evidence.set('stt', row.batch);
      hasMetadata = true;
    } else if (row.catalogOperation === 'tts') {
      evidence.set('tts', true);
      hasMetadata = true;
    }
  }

  const shutdown = typeof row.shutdown_date === 'string' ? Date.parse(row.shutdown_date) : NaN;
  if (row.lifecycle === 'retired' || row.active === false || shutdown <= Date.now()) {
    for (const operation of OPERATIONS) evidence.set(operation, false);
    hasMetadata = true;
  }
  const reference = Object.hasOwn(REFERENCES, provider.id) && Object.hasOwn(REFERENCES[provider.id]!, id)
    ? REFERENCES[provider.id]![id]! : [];
  let referenceUsed = false;
  const operations = provider.operations.filter((operation) => {
    if (evidence.has(operation)) return evidence.get(operation) === true;
    if (!reference.includes(operation)) return false;
    referenceUsed = true;
    return true;
  });
  const display = row.display_name ?? row.displayName ?? row.name;
  const name = typeof display === 'string' && display.length > 0 && display.length <= 256 && !/[\x00-\x1f\x7f]/.test(display) ? display : id;
  const contextWindow = positiveNumber(row.max_input_tokens ?? row.inputTokenLimit ?? row.max_context_length ?? row.context_length ?? row.context_window);
  return {
    id, name, providerId: provider.id, operations,
    capabilitySource: referenceUsed ? 'reference' : hasMetadata ? 'provider' : 'unknown',
    ...(contextWindow ? { contextWindow } : {}),
  };
}

function usage(input: unknown, output?: unknown): Result['usage'] {
  const inputTokens = typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : undefined;
  const outputTokens = typeof output === 'number' && Number.isSafeInteger(output) && output >= 0 ? output : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
}

function text(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value)) return invalidResponse();
  return value;
}

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return invalidResponse();
  return text(value.filter((block) => object(block).type === 'text').map((block) => text(object(block).text, true)).join(''));
}

function vector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 65_536 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    return invalidResponse();
  }
  return value as number[];
}

function first(value: unknown): JsonObject {
  return object(Array.isArray(value) ? value[0] : undefined);
}

function imageOutput(value: unknown): MediaInput {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return invalidResponse();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return invalidResponse();
  const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : undefined;
  if (!mimeType) return invalidResponse();
  return { data: value, mimeType };
}

function audioOutput(response: TransportResponse): MediaInput {
  const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1].split(';')[0]?.trim().toLowerCase();
  if (!contentType || !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(contentType) || !response.body.length) return invalidResponse();
  return { mimeType: 'audio/mpeg', data: Buffer.from(response.body).toString('base64') };
}

function checkConfig(config: ConnectionConfig, provider: ProviderDefinition): void {
  if (config.providerId !== provider.id) throw new ModelPortError('INVALID_INPUT', 'Connection and provider do not match.');
  if (provider.kind === 'cloud' && provider.status === 'ready' && !config.apiKey) {
    throw new ModelPortError('API_KEY_REQUIRED', 'Supply your own provider API key. Public catalogs do not validate credentials.');
  }
  if ((config.apiKey && /[^\x21-\x7e]/.test(config.apiKey)) || (config.workspaceId && /[^\x21-\x7e]/.test(config.workspaceId))) {
    throw new ModelPortError('INVALID_INPUT', 'Credentials and workspace IDs must be safe HTTP header values.');
  }
}

function authHeaders(config: ConnectionConfig, provider: ProviderDefinition): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    switch (provider.auth) {
      case 'bearer': headers.authorization = `Bearer ${config.apiKey}`; break;
      case 'token': headers.authorization = `Token ${config.apiKey}`; break;
      case 'x-api-key': headers['x-api-key'] = config.apiKey; break;
      case 'google-api-key': headers['x-goog-api-key'] = config.apiKey; break;
      case 'xi-api-key': headers['xi-api-key'] = config.apiKey; break;
    }
  }
  if (provider.adapter === 'anthropic') {
    headers['anthropic-version'] = '2026-10-21';
    if (config.workspaceId) headers['anthropic-workspace-id'] = config.workspaceId;
  }
  return headers;
}

function httpError(status: number): never {
  if (status === 401) throw new ModelPortError('PROVIDER_AUTH', 'The provider rejected the credentials.', 401);
  if (status === 403) throw new ModelPortError('PROVIDER_FORBIDDEN', 'The provider denied this request. Check key scope and account restrictions.', 403);
  if (status === 429) throw new ModelPortError('PROVIDER_RATE_LIMIT', 'The provider rate limit or quota was reached. No retry was attempted.', 429);
  if (status >= 300 && status < 400) throw new ModelPortError('PROVIDER_REDIRECT', 'Provider redirects are not followed.', 502);
  throw new ModelPortError('PROVIDER_HTTP', 'The provider rejected the request or is unavailable. No retry was attempted.', status >= 400 && status <= 599 ? status : 502);
}

function assertMetadataActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  const code = reason instanceof ModelPortError && ['METADATA_CANCELLED', 'METADATA_TIMEOUT'].includes(reason.code)
    ? reason.code : 'METADATA_CANCELLED';
  throw new ModelPortError(code, code === 'METADATA_TIMEOUT'
    ? 'The metadata request timed out. No inference was attempted.'
    : 'The metadata request was cancelled. No inference was attempted.', code === 'METADATA_TIMEOUT' ? 504 : 499);
}

export function createAdapter(transport: Transport): ProviderAdapter {
  async function request(
    config: ConnectionConfig, provider: ProviderDefinition, path: string,
    options: { method?: 'GET' | 'POST'; body?: string | Uint8Array; headers?: Record<string, string>; origin?: string; public?: boolean; inference?: boolean; signal?: AbortSignal } = {},
  ): Promise<TransportResponse> {
    assertMetadataActive(options.signal);
    checkConfig(config, provider);
    let base: URL;
    let url: URL;
    try {
      // Cloud overrides are never used, even when an adapter is called outside the SDK.
      base = new URL(provider.kind === 'local' ? config.baseUrl ?? provider.baseUrl : provider.baseUrl);
      if (base.username || base.password || base.hash || base.search) throw new Error();
      if (provider.kind === 'local' && (!['127.0.0.1', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol) || Number(base.port) < 1024)) throw new Error();
      url = new URL(`${(options.origin ?? base.href).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
    } catch {
      throw new ModelPortError('UNSAFE_ENDPOINT', 'The provider endpoint is invalid or is not an allowed loopback endpoint.');
    }
    const allowedOrigins = [base.origin];
    if (provider.verification.origin) allowedOrigins.push(new URL(provider.verification.origin).origin);
    const outbound: TransportRequest = {
      url: url.href, method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...(!options.public ? authHeaders(config, provider) : {}), ...options.headers },
      ...(options.body !== undefined ? { body: options.body } : {}),
      allowedOrigins, ...(provider.kind === 'local' ? { allowLoopback: true } : {}),
      maxResponseBytes: options.inference ? GENERATION_BYTES : 4 * 1024 * 1024,
      timeoutMs: options.inference ? 120_000 : 30_000,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    let response: TransportResponse;
    try {
      response = await transport(outbound);
    } catch (error) {
      assertMetadataActive(options.signal);
      // Preserve only known transport codes, never its raw message/cause or upstream body.
      const code = error instanceof ModelPortError && [
        'UNSAFE_ENDPOINT', 'INVALID_INPUT', 'MEDIA_TOO_LARGE', 'RESPONSE_TOO_LARGE',
        'PROVIDER_REDIRECT', 'UNSUPPORTED_ENCODING', 'PROVIDER_TIMEOUT',
        'METADATA_CANCELLED', 'METADATA_TIMEOUT',
      ].includes(error.code) ? error.code : 'PROVIDER_NETWORK';
      const status = ['PROVIDER_TIMEOUT', 'METADATA_TIMEOUT'].includes(code) ? 504 : code === 'METADATA_CANCELLED' ? 499
        : ['UNSAFE_ENDPOINT', 'INVALID_INPUT', 'MEDIA_TOO_LARGE'].includes(code) ? 400 : 502;
      throw new ModelPortError(code, options.inference
        ? 'The provider request was blocked or could not be completed. No automatic retry was made; an inference request may still be processed and billed.'
        : 'The provider metadata request was blocked or could not be completed. No automatic retry was made. No inference was attempted.', status);
    }
    assertMetadataActive(options.signal);
    if (response.status < 200 || response.status >= 300) httpError(response.status);
    return response;
  }

  async function post(config: ConnectionConfig, provider: ProviderDefinition, path: string, body: JsonObject): Promise<JsonObject> {
    return object(json(await request(config, provider, path, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, inference: true,
    })));
  }

  return {
    async verify(config, provider, { signal } = {}): Promise<Verification> {
      checkConfig(config, provider);
      assertMetadataActive(signal);
      const { mode, path, origin, method } = provider.verification;
      const stamp = { checkedAt: new Date().toISOString(), inferenceTested: false as const };
      if (provider.status !== 'ready' || mode === 'unsupported' || !path) {
        return { ...stamp, state: 'unverified', message: 'No reviewed credential-only probe is implemented for this profile. No inference was attempted.' };
      }
      const value = json(await request(config, provider, path, { origin, method, public: mode === 'public', signal }));
      if (mode === 'authenticated-models' || mode === 'local' || mode === 'public') rows(provider, value);
      if (mode === 'identity') {
        const identity = object(value);
        if (provider.id === 'xai') {
          const flags = [identity.api_key_disabled, identity.api_key_blocked, identity.team_blocked];
          if (flags.some((flag) => flag === true)) httpError(403);
          if (flags.some((flag) => typeof flag !== 'boolean')) invalidResponse();
        } else if (provider.id === 'cohere') {
          if (identity.valid === false) httpError(401);
          if (identity.valid !== true) invalidResponse();
        } else if (provider.id === 'openrouter') {
          if (typeof object(identity.data).label !== 'string') invalidResponse();
        } else if (provider.id === 'huggingface') {
          if (typeof identity.name !== 'string' || !identity.name) invalidResponse();
        } else if (provider.id === 'deepgram') {
          if (!Object.keys(identity).length) invalidResponse();
        } else {
          throw new ModelPortError('UNSUPPORTED_PROVIDER', 'No identity response contract is implemented for this provider.', 422);
        }
      }
      assertMetadataActive(signal);
      if (mode === 'local' || mode === 'public') {
        return { ...stamp, state: 'reachable', message: 'The metadata endpoint is reachable. This does not establish that authentication is enabled or that credentials were accepted. No inference was attempted.' };
      }
      return { ...stamp, state: 'authenticated', message: 'A protected metadata endpoint accepted the credentials. This does not establish model entitlement, credits, inference success, or a billing guarantee. No inference was attempted.' };
    },

    async listModels(config, provider, { signal } = {}): Promise<CatalogResult> {
      checkConfig(config, provider);
      assertMetadataActive(signal);
      if (provider.status !== 'ready' || !provider.catalogPath) {
        return { models: [], warning: 'No reviewed model-list endpoint is available for this profile. Declare an exact model ID and its supported operations manually; this does not verify credentials or entitlement.' };
      }
      const models = new Map<string, Model>();
      const warnings = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let inspected = 0;
      const isPublic = ['openrouter', 'huggingface', 'deepgram'].includes(provider.id) || provider.verification.mode === 'public';
      if (isPublic) warnings.add('This catalog is public and does not authenticate a key or prove model access.');
      for (let page = 0; page < MAX_PAGES; page++) {
        const [path, query = ''] = provider.catalogPath.split('?');
        const params = new URLSearchParams(query);
        if (provider.adapter === 'anthropic') {
          params.set('limit', '100');
          if (cursor) params.set('after_id', cursor);
        } else if (provider.adapter === 'gemini') {
          params.set('pageSize', '100');
          if (cursor) params.set('pageToken', cursor);
        } else if (provider.adapter === 'cohere') {
          params.set('page_size', '100');
          if (cursor) params.set('page_token', cursor);
        }
        const value = json(await request(config, provider, `${path}${params.size ? `?${params}` : ''}`, { public: isPublic, signal }));
        const pageRows = rows(provider, value);
        const remaining = MAX_MODELS - inspected;
        for (const row of pageRows.slice(0, remaining)) {
          const model = modelFromRow(provider, row);
          if (model) {
            if (!models.has(model.id)) models.set(model.id, model);
          } else warnings.add('Some catalog entries had invalid identifiers and were omitted.');
          if (row.lifecycle === 'deprecated' || row.is_deprecated === true) warnings.add('The catalog includes deprecated models; listing does not guarantee access or continued availability.');
          if (typeof row.shutdown_date === 'string' && Number.isFinite(Date.parse(row.shutdown_date))) warnings.add('The catalog includes scheduled or past shutdown dates; models past shutdown are disabled.');
        }
        inspected += pageRows.length;
        const root = object(value);
        const next = provider.adapter === 'anthropic' && root.has_more === true ? root.last_id
          : provider.adapter === 'gemini' ? root.nextPageToken
            : provider.adapter === 'cohere' ? root.next_page_token : undefined;
        const hasMore = (provider.adapter === 'anthropic' && root.has_more === true) || (next !== undefined && next !== null && next !== '');
        if (pageRows.length > remaining || (hasMore && (inspected >= MAX_MODELS || page + 1 === MAX_PAGES))) {
          warnings.add('Catalog truncated at the limit of 10 pages or 1,000 entries. Declare missing models manually.');
          break;
        }
        if (!hasMore) break;
        if (typeof next !== 'string' || !next || next.length > 2048 || cursors.has(next) || (config.apiKey && next.includes(config.apiKey))) {
          warnings.add('Catalog truncated because the provider returned an invalid or repeated pagination cursor.');
          break;
        }
        cursor = next;
        cursors.add(cursor);
      }
      assertMetadataActive(signal);
      const result = [...models.values()];
      if (!result.length) warnings.add('No usable models were returned. Declare an exact model ID and supported operations manually.');
      if (result.some((model) => model.capabilitySource === 'unknown')) warnings.add('Unknown capabilities are disabled until explicitly declared. Catalog listing is not an inference test.');
      return { models: result, ...(warnings.size ? { warning: [...warnings].join(' ') } : {}) };
    },

    async run(config, provider, input): Promise<Result> {
      checkConfig(config, provider);
      if (provider.status !== 'ready' || !provider.adapter || !provider.operations.includes(input.operation)) {
        throw new ModelPortError('UNSUPPORTED_OPERATION', 'This provider profile does not implement the selected operation.', 422);
      }
      const { operation, modelId } = input;
      if (typeof modelId !== 'string' || !modelId || /[\x00-\x1f\x7f]/.test(modelId)) throw new ModelPortError('INVALID_INPUT', 'A valid model ID is required.');
      const result: Result = { providerId: provider.id, modelId, operation };
      const prompt = input.text ?? '';
      const cap = input.maxOutputTokens;
      if ((operation === 'text' || operation === 'vision') && (!Number.isSafeInteger(cap) || cap! < 1)) {
        throw new ModelPortError('INVALID_INPUT', 'An explicit positive output-token cap is required for text and vision.');
      }
      let media: MediaInput | undefined;
      if (operation === 'vision' || operation === 'stt') {
        media = input.media;
        const allowed: readonly string[] = operation === 'vision' ? IMAGE_TYPES : AUDIO_TYPES;
        if (!media || !allowed.includes(media.mimeType) || !media.data) throw new ModelPortError('INVALID_INPUT', 'An inline media file of a supported type is required.');
      }
      assertRequestPolicy(provider.id, input);

      if (provider.adapter === 'openai') {
        if (operation === 'text' || operation === 'vision') {
          const content = operation === 'vision' ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${media!.mimeType};base64,${media!.data}` } },
          ] : prompt;
          const modernOpenAI = provider.id === 'openai' && /^(?:o1|o3|o4|gpt-5)(?:[.-]|$)/.test(modelId);
          const body = await post(config, provider, 'chat/completions', {
            model: modelId, messages: [{ role: 'user', content }], stream: false,
            [modernOpenAI ? 'max_completion_tokens' : 'max_tokens']: cap,
            ...(provider.id === 'openrouter' ? { modalities: ['text'], provider: { allow_fallbacks: false } } : {}),
          });
          const contentOut = object(first(body.choices).message).content;
          result.text = Array.isArray(contentOut) ? textBlocks(contentOut) : text(contentOut);
          const counts = object(body.usage);
          result.usage = usage(counts.prompt_tokens, counts.completion_tokens);
          return result;
        }
        if (operation === 'embedding' && ['openai', 'mistral', 'lm-studio', 'vllm', 'custom-local'].includes(provider.id)) {
          const body = await post(config, provider, 'embeddings', { model: modelId, input: prompt, encoding_format: 'float' });
          result.embedding = vector(first(body.data).embedding);
          result.usage = usage(object(body.usage).prompt_tokens);
          return result;
        }
        if (operation === 'image' && provider.id === 'openai') {
          // Retired IDs are not inferred as capable; their legacy serialization only
          // applies if the caller explicitly declares them. Upstream may reject them.
          const gptImage = GPT_IMAGE_MODELS.includes(modelId) || modelId === 'gpt-image-1';
          if (!gptImage && !['dall-e-2', 'dall-e-3'].includes(modelId)) {
            throw new ModelPortError('UNSUPPORTED_MODEL_PROTOCOL', 'No reviewed image-generation request profile exists for this model ID.', 422);
          }
          const body = await post(config, provider, 'images/generations', {
            model: modelId, prompt, n: 1, size: '1024x1024',
            ...(gptImage ? { output_format: 'png', stream: false } : { response_format: 'b64_json' }),
          });
          // URLs are deliberately ignored, even when they point at provider-owned storage.
          result.media = imageOutput(first(body.data).b64_json);
          return result;
        }
        if (operation === 'stt' && ['openai', 'groq'].includes(provider.id)) {
          const extension: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac' };
          const boundary = `modelport-${randomBytes(24).toString('hex')}`;
          const head = `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${modelId}\r\n`
            + `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
            + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${extension[media!.mimeType]}"\r\nContent-Type: ${media!.mimeType}\r\n\r\n`;
          const body = Buffer.concat([Buffer.from(head), Buffer.from(media!.data, 'base64'), Buffer.from(`\r\n--${boundary}--\r\n`)]);
          const response = object(json(await request(config, provider, 'audio/transcriptions', {
            method: 'POST', body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, inference: true,
          })));
          result.text = text(response.text, true);
          return result;
        }
        if (operation === 'tts' && provider.id === 'openai') {
          if (!input.voice) throw new ModelPortError('VOICE_REQUIRED', 'Choose a voice before requesting speech.');
          result.media = audioOutput(await request(config, provider, 'audio/speech', {
            method: 'POST', body: JSON.stringify({ model: modelId, input: prompt, voice: input.voice, response_format: 'mp3' }),
            headers: { 'content-type': 'application/json', accept: 'audio/mpeg' }, inference: true,
          }));
          return result;
        }
      } else if (provider.adapter === 'anthropic' && (operation === 'text' || operation === 'vision')) {
        const content: JsonObject[] = [{ type: 'text', text: prompt }];
        if (media) content.push({ type: 'image', source: { type: 'base64', media_type: media.mimeType, data: media.data } });
        const body = await post(config, provider, 'messages', { model: modelId, max_tokens: cap, stream: false, messages: [{ role: 'user', content }] });
        result.text = textBlocks(body.content);
        const counts = object(body.usage);
        result.usage = usage(counts.input_tokens, counts.output_tokens);
        return result;
      } else if (provider.adapter === 'gemini' && ['text', 'vision', 'embedding'].includes(operation)) {
        const id = modelId.replace(/^models\//, '');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new ModelPortError('UNSUPPORTED_MODEL_PROTOCOL', 'Gemini requires a base model ID, not a URL or arbitrary resource path.', 422);
        const resource = `models/${encodeURIComponent(id)}`;
        if (operation === 'embedding') {
          const body = await post(config, provider, `${resource}:embedContent`, { model: `models/${id}`, content: { parts: [{ text: prompt }] } });
          result.embedding = vector(object(body.embedding).values);
        } else {
          const parts: JsonObject[] = [{ text: prompt }];
          if (media) parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
          const body = await post(config, provider, `${resource}:generateContent`, {
            contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: cap, candidateCount: 1, responseModalities: ['TEXT'] },
          });
          const outputParts = object(first(body.candidates).content).parts;
          if (!Array.isArray(outputParts)) invalidResponse();
          result.text = text(outputParts.filter((part) => typeof object(part).text === 'string' && object(part).thought !== true).map((part) => object(part).text).join(''));
          const counts = object(body.usageMetadata);
          result.usage = usage(counts.promptTokenCount, counts.candidatesTokenCount);
        }
        return result;
      } else if (provider.adapter === 'cohere' && (operation === 'text' || operation === 'embedding')) {
        if (operation === 'embedding') {
          const body = await post(config, provider, 'v2/embed', { model: modelId, texts: [prompt], input_type: 'search_document', embedding_types: ['float'], truncate: 'NONE' });
          const floats = object(body.embeddings).float;
          result.embedding = vector(Array.isArray(floats) ? floats[0] : undefined);
          result.usage = usage(object(object(body.meta).tokens).input_tokens);
        } else {
          const body = await post(config, provider, 'v2/chat', { model: modelId, messages: [{ role: 'user', content: prompt }], max_tokens: cap, stream: false });
          if (body.finish_reason === 'ERROR' || body.finish_reason === 'TIMEOUT') {
            const timedOut = body.finish_reason === 'TIMEOUT';
            throw new ModelPortError(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_GENERATION_FAILED', timedOut
              ? 'The provider generation timed out. No automatic retry was made; the request may still have been billed.'
              : 'The provider generation failed. No automatic retry was made; the request may still have been billed.', timedOut ? 504 : 502);
          }
          result.text = textBlocks(object(body.message).content);
          const counts = object(object(body.usage).tokens);
          result.usage = usage(counts.input_tokens, counts.output_tokens);
        }
        return result;
      } else if (provider.adapter === 'ollama' && ['text', 'vision', 'embedding'].includes(operation)) {
        if (operation === 'embedding') {
          const body = await post(config, provider, 'api/embed', { model: modelId, input: prompt, truncate: false });
          result.embedding = vector(Array.isArray(body.embeddings) ? body.embeddings[0] : undefined);
          result.usage = usage(body.prompt_eval_count);
        } else {
          const body = await post(config, provider, 'api/chat', {
            model: modelId, messages: [{ role: 'user', content: prompt, ...(media ? { images: [media.data] } : {}) }],
            stream: false, options: { num_predict: cap },
          });
          result.text = text(object(body.message).content);
          result.usage = usage(body.prompt_eval_count, body.eval_count);
        }
        return result;
      } else if (provider.adapter === 'elevenlabs' && operation === 'tts') {
        if (!input.voice || !/^[A-Za-z0-9_-]{1,128}$/.test(input.voice)) throw new ModelPortError('VOICE_REQUIRED', 'A valid ElevenLabs voice ID is required.');
        result.media = audioOutput(await request(config, provider, `text-to-speech/${encodeURIComponent(input.voice)}?output_format=mp3_44100_128`, {
          method: 'POST', body: JSON.stringify({ text: prompt, model_id: modelId }),
          headers: { 'content-type': 'application/json', accept: 'audio/mpeg' }, inference: true,
        }));
        return result;
      } else if (provider.adapter === 'deepgram' && operation === 'stt') {
        const params = new URLSearchParams({ model: modelId });
        const body = object(json(await request(config, provider, `listen?${params}`, {
          method: 'POST', body: Buffer.from(media!.data, 'base64'), headers: { 'content-type': media!.mimeType }, inference: true,
        })));
        const channels = object(body.results).channels;
        if (!Array.isArray(channels) || !channels.length) invalidResponse();
        result.text = channels.map((channel) => text(first(object(channel).alternatives).transcript, true)).join('\n');
        return result;
      }
      throw new ModelPortError('UNSUPPORTED_OPERATION', 'No reviewed protocol route exists for this provider and operation.', 422);
    },
  };
}
