import { ModelPortError } from './errors.js';
import type { Operation, ProviderDefinition } from './types.js';

export const operationLabels: Record<Operation, string> = {
  text: 'Text generation',
  vision: 'Image understanding',
  image: 'Image generation',
  stt: 'Speech to text',
  tts: 'Text to speech',
  embedding: 'Embeddings',
};

function compatible(
  definition: Pick<ProviderDefinition, 'id' | 'name' | 'description' | 'baseUrl' | 'operations' | 'docsUrl' | 'keyUrl' | 'notes'>
    & Partial<Pick<ProviderDefinition, 'catalogPath' | 'verification'>>,
): ProviderDefinition {
  return {
    kind: 'cloud', status: 'ready', adapter: 'openai', auth: 'bearer',
    catalogPath: 'models', verification: { mode: 'authenticated-models', path: 'models' },
    ...definition,
  };
}

function planned(id: string, name: string, docsUrl: string, notes: string): ProviderDefinition {
  return {
    id, name, description: notes, kind: 'cloud', status: 'planned', adapter: null,
    baseUrl: '', auth: 'none', operations: [], verification: { mode: 'unsupported' }, docsUrl, notes,
  };
}

// These are implemented protocol profiles, not claims about every model a vendor sells.
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openai', name: 'OpenAI', description: 'Direct OpenAI chat, images, file transcription, speech, and embeddings.',
    kind: 'cloud', status: 'ready', adapter: 'openai', baseUrl: 'https://api.openai.com/v1', auth: 'bearer',
    operations: ['text', 'vision', 'image', 'stt', 'tts', 'embedding'], catalogPath: 'models',
    verification: { mode: 'authenticated-models', path: 'models' },
    docsUrl: 'https://platform.openai.com/docs/api-reference', keyUrl: 'https://platform.openai.com/api-keys',
    defaultVoice: 'alloy',
    notes: 'Chat Completions, not Responses-only models. Image generation uses reviewed GPT Image profiles. Retired DALL-E/GPT Image 1 IDs are not inferred as capable; past catalog shutdown dates disable models. IDs alone do not establish entitlement.',
  },
  {
    id: 'anthropic', name: 'Anthropic', description: 'Native Claude Messages with inline image input.',
    kind: 'cloud', status: 'ready', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', auth: 'x-api-key',
    operations: ['text', 'vision'], catalogPath: 'models',
    verification: { mode: 'authenticated-models', path: 'models' },
    docsUrl: 'https://platform.claude.com/docs/en/api/overview', keyUrl: 'https://platform.claude.com/settings/keys',
    notes: 'Uses anthropic-version 2026-10-21 and the supported x-api-key header. Unscoped keys may require workspaceId. Native image/audio generation and embeddings are not implemented.',
  },
  {
    id: 'gemini', name: 'Google Gemini', description: 'Native Gemini content generation and text embeddings.',
    kind: 'cloud', status: 'ready', adapter: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', auth: 'google-api-key',
    operations: ['text', 'vision', 'embedding'], catalogPath: 'models',
    verification: { mode: 'authenticated-models', path: 'models' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs', keyUrl: 'https://aistudio.google.com/apikey',
    notes: 'Keys use x-goog-api-key, never query parameters. generateContent method metadata alone does not establish text or image-input support. Audio, image generation, Live API, and Vertex AI are deferred.',
  },
  compatible({
    id: 'groq', name: 'Groq', description: 'Groq chat, image understanding, and file transcription.',
    baseUrl: 'https://api.groq.com/openai/v1', operations: ['text', 'vision', 'stt'],
    docsUrl: 'https://console.groq.com/docs/overview', keyUrl: 'https://console.groq.com/keys',
    notes: 'Uses documented chat/completions and audio/transcriptions only. Speech output, compound agents, and embeddings are not implemented.',
  }),
  compatible({
    id: 'mistral', name: 'Mistral', description: 'Mistral chat, inline images, and text embeddings.',
    baseUrl: 'https://api.mistral.ai/v1', operations: ['text', 'vision', 'embedding'],
    docsUrl: 'https://docs.mistral.ai/api', keyUrl: 'https://console.mistral.ai/api-keys',
    notes: 'Uses model capability flags where present. OCR, transcription, and speech are deferred; Mistral speech returns JSON audio_data, not OpenAI binary audio.',
  }),
  compatible({
    id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek chat with model-specific inline image support.',
    baseUrl: 'https://api.deepseek.com', operations: ['text', 'vision'],
    docsUrl: 'https://api-docs.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys',
    notes: 'Root /models and /chat/completions routes. Uses input_modalities/output_modalities and context_window when returned. Native /tools/asr and /tools/tts are not OpenAI audio routes and are deferred.',
  }),
  compatible({
    id: 'xai', name: 'xAI', description: 'Grok chat and image understanding.',
    baseUrl: 'https://api.x.ai/v1', operations: ['text', 'vision'],
    verification: { mode: 'identity', path: 'api-key' },
    docsUrl: 'https://docs.x.ai/developers', keyUrl: 'https://console.x.ai',
    notes: 'Checks key-disabled, key-blocked, and team-blocked flags. Audio, image generation, Responses, and server tools are not implemented.',
  }),
  compatible({
    id: 'openrouter', name: 'OpenRouter', description: 'OpenRouter chat with declared input/output modalities.',
    baseUrl: 'https://openrouter.ai/api/v1', operations: ['text', 'vision'],
    catalogPath: 'models?output_modalities=all', verification: { mode: 'identity', path: 'key' },
    docsUrl: 'https://openrouter.ai/docs', keyUrl: 'https://openrouter.ai/settings/keys',
    notes: 'The catalog is public; /key validates credentials separately. Sends allow_fallbacks:false. No automatic model routing, tools, image generation, or audio profiles.',
  }),
  compatible({
    id: 'together', name: 'Together AI', description: 'Serverless chat and documented vision models.',
    baseUrl: 'https://api.together.ai/v1', operations: ['text', 'vision'],
    docsUrl: 'https://docs.together.ai/docs/serverless/models', keyUrl: 'https://api.together.ai/settings/projects/~current/api-keys',
    notes: 'Uses the documented bare-array model catalog. The current serverless catalog offers no embedding models; dedicated endpoints and image/audio/video profiles are deferred.',
  }),
  compatible({
    id: 'fireworks', name: 'Fireworks AI', description: 'Explicitly declared serverless chat and vision models.',
    baseUrl: 'https://api.fireworks.ai/inference/v1', operations: ['text', 'vision'],
    catalogPath: undefined, verification: { mode: 'unsupported' },
    docsUrl: 'https://docs.fireworks.ai/api-reference/introduction', keyUrl: 'https://app.fireworks.ai/settings/users/api-keys',
    notes: 'Manual model declaration required. Control-plane discovery requires an account ID and does not prove serverless deployment; no generic inference /models endpoint is assumed. Credential inspection remains unverified; any inference requires explicit approval.',
  }),
  compatible({
    id: 'cerebras', name: 'Cerebras', description: 'Cerebras chat and documented preview vision support.',
    baseUrl: 'https://api.cerebras.ai/v1', operations: ['text', 'vision'],
    docsUrl: 'https://inference-docs.cerebras.ai', keyUrl: 'https://cloud.cerebras.ai/platform',
    notes: 'Uses protected /v1/models, not public /public/v1/models, for verification. Preview vision accepts PNG/JPEG only. Other operation types are deferred.',
  }),
  compatible({
    id: 'sambanova', name: 'SambaNova', description: 'SambaNova chat via its official SDK-documented HTTP contract.',
    baseUrl: 'https://api.sambanova.ai/v1', operations: ['text'],
    verification: { mode: 'unsupported' },
    docsUrl: 'https://github.com/sambanova/sambanova-python', keyUrl: 'https://cloud.sambanova.ai',
    notes: 'Official SDK documents /models and /chat/completions with Bearer authentication. Protected metadata credential-validation semantics were not established, so verification stays unverified. Vision/audio/embeddings are deferred.',
  }),
  compatible({
    id: 'huggingface', name: 'Hugging Face', description: 'Inference Providers router chat only.',
    baseUrl: 'https://router.huggingface.co/v1', operations: ['text', 'vision'],
    verification: { mode: 'identity', origin: 'https://huggingface.co', path: 'api/whoami-v2' },
    docsUrl: 'https://huggingface.co/docs/inference-providers', keyUrl: 'https://huggingface.co/settings/tokens',
    notes: 'The router catalog is public. Hub identity acceptance does not prove inference-provider scope or gated-model access. The /v1 router is chat-only; task-specific image, audio, and embedding APIs are deferred.',
  }),
  {
    id: 'cohere', name: 'Cohere', description: 'Native Cohere v2 chat and float text embeddings.',
    kind: 'cloud', status: 'ready', adapter: 'cohere', baseUrl: 'https://api.cohere.com', auth: 'bearer',
    operations: ['text', 'embedding'], catalogPath: 'v1/models',
    verification: { mode: 'identity', method: 'POST', path: 'v1/check-api-key' },
    docsUrl: 'https://docs.cohere.com/reference', keyUrl: 'https://dashboard.cohere.com/api-keys',
    notes: 'check-api-key is a documented read-only-purpose POST with no inference body. Model endpoints metadata establishes chat/embed support. Embeddings use search_document and truncate:NONE; reranking and multimodal embeddings are deferred.',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', description: 'Native text-to-speech with an explicit voice ID.',
    kind: 'cloud', status: 'ready', adapter: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', auth: 'xi-api-key',
    operations: ['tts'], catalogPath: 'models',
    verification: { mode: 'public', path: 'models' },
    docsUrl: 'https://elevenlabs.io/docs/api-reference', keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    notes: 'The model-list reference shows headerless requests, so catalog reachability is not treated as credential acceptance. TTS uses xi-api-key and an explicit voice ID. Uses can_do_text_to_speech metadata and returns MP3; voice cloning, residency switching, and STT are deferred.',
  },
  {
    id: 'deepgram', name: 'Deepgram', description: 'Native synchronous transcription of an uploaded audio file.',
    kind: 'cloud', status: 'ready', adapter: 'deepgram', baseUrl: 'https://api.deepgram.com/v1', auth: 'token',
    operations: ['stt'], catalogPath: 'models', verification: { mode: 'identity', path: 'auth/token' },
    docsUrl: 'https://developers.deepgram.com/docs', keyUrl: 'https://console.deepgram.com',
    notes: '/auth/token is the documented credential check; /models is public. Only STT models with batch support are enabled from metadata. No URL uploads, callbacks, summarization, realtime audio, or TTS.',
  },
  {
    id: 'ollama', name: 'Ollama', description: 'Native loopback Ollama chat, vision, and embeddings.',
    kind: 'local', status: 'ready', adapter: 'ollama', baseUrl: 'http://127.0.0.1:11434', auth: 'none',
    operations: ['text', 'vision', 'embedding'], catalogPath: 'api/tags', verification: { mode: 'local', path: 'api/tags' },
    docsUrl: 'https://docs.ollama.com/api',
    notes: 'Reachability is not authentication. /api/tags does not describe full capabilities; unknown models need a declaration. A local Ollama server can relay cloud-backed models. Audio compatibility routes are outside this native profile.',
  },
  {
    id: 'lm-studio', name: 'LM Studio', description: 'Loopback OpenAI-compatible chat, vision, and embeddings.',
    kind: 'local', status: 'ready', adapter: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', auth: 'bearer',
    operations: ['text', 'vision', 'embedding'], catalogPath: 'models', verification: { mode: 'local', path: 'models' },
    docsUrl: 'https://lmstudio.ai/docs/developer/openai-compat',
    notes: 'An optional Bearer key is forwarded only when supplied. Metadata success does not prove auth is enabled. Declare the capabilities of the actual loaded model; no GGUF filename heuristics.',
  },
  {
    id: 'vllm', name: 'vLLM', description: 'Loopback vLLM OpenAI-compatible inference.',
    kind: 'local', status: 'ready', adapter: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', auth: 'bearer',
    operations: ['text', 'vision', 'embedding'], catalogPath: 'models', verification: { mode: 'local', path: 'models' },
    docsUrl: 'https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html',
    notes: 'The configured task/chat template determines available operations. /v1/models success is reachability only; --api-key does not protect all vLLM routes. Do not expose the server as a public gateway.',
  },
  {
    id: 'custom-local', name: 'Custom Local', description: 'Explicitly configured loopback OpenAI-compatible server.',
    kind: 'local', status: 'ready', adapter: 'openai', baseUrl: 'http://127.0.0.1:8080/v1', auth: 'bearer',
    operations: ['text', 'vision', 'embedding'], catalogPath: 'models', verification: { mode: 'local', path: 'models' },
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    notes: 'Selecting this profile explicitly declares protocol compatibility, not capabilities or auth. The SDK accepts literal loopback endpoints only. No arbitrary cloud base URL, auto-detection, or protocol fallback.',
  },
  planned('perplexity', 'Perplexity', 'https://docs.perplexity.ai', 'Agent /v1/models is public and Orchestrator models are private preview. Search, preview routing, and encoded embeddings require reviewed profiles; no key-validation claim.'),
  planned('bedrock', 'AWS Bedrock', 'https://docs.aws.amazon.com/bedrock/latest/userguide', 'IAM/bearer credentials, regional endpoints, model access and subscription/EULA flows need a dedicated adapter. Never invoke a model to inspect access.'),
  planned('azure-openai', 'Azure OpenAI', 'https://learn.microsoft.com/azure/ai-foundry/openai', 'Resource/deployment URLs, API versions, and Microsoft identity need a dedicated enterprise profile.'),
  planned('vertex-ai', 'Google Vertex AI', 'https://cloud.google.com/vertex-ai/generative-ai/docs', 'Project, location, IAM/OAuth, and regional routing are separate from the Gemini API-key profile.'),
  planned('replicate', 'Replicate', 'https://replicate.com/docs/reference/http', 'Prediction jobs, polling/cancellation, model schemas, and provider-hosted media require an asynchronous adapter.'),
  planned('fal', 'fal', 'https://docs.fal.ai', 'Queue jobs and media output require a dedicated adapter. The catalog is public, and the documented Test Your Key image call is inference, not verification.'),
  planned('assemblyai', 'AssemblyAI', 'https://www.assemblyai.com/docs/api-reference/overview', 'Upload, transcription jobs, polling/cancellation, and retention controls are deferred.'),
  planned('cartesia', 'Cartesia', 'https://docs.cartesia.ai', 'Versioned speech/voice APIs and their output formats need a separately tested native profile.'),
];

export function getProvider(id: string): ProviderDefinition {
  const provider = PROVIDERS.find((entry) => entry.id === id);
  if (!provider) throw new ModelPortError('UNKNOWN_PROVIDER', 'Unknown provider.', 404);
  return structuredClone(provider);
}
