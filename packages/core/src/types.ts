export const OPERATIONS = ['text', 'vision', 'image', 'stt', 'tts', 'embedding'] as const;
export type Operation = (typeof OPERATIONS)[number];
export type AdapterKind = 'openai' | 'anthropic' | 'gemini' | 'cohere' | 'ollama' | 'elevenlabs' | 'deepgram';
export type CapabilitySource = 'provider' | 'reference' | 'declared' | 'unknown';

export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'cloud' | 'local';
  status: 'ready' | 'planned';
  adapter: AdapterKind | null;
  baseUrl: string;
  auth: 'bearer' | 'x-api-key' | 'google-api-key' | 'xi-api-key' | 'token' | 'none';
  operations: Operation[];
  catalogPath?: string;
  verification: {
    mode: 'authenticated-models' | 'identity' | 'public' | 'unsupported' | 'local';
    path?: string;
    origin?: string;
    method?: 'GET' | 'POST';
  };
  docsUrl: string;
  keyUrl?: string;
  notes: string;
  defaultVoice?: string;
}

export interface Model {
  id: string;
  name: string;
  providerId: string;
  operations: Operation[];
  capabilitySource: CapabilitySource;
  contextWindow?: number;
}

export interface Verification {
  state: 'authenticated' | 'reachable' | 'unverified';
  checkedAt: string;
  message: string;
  inferenceTested: false;
}

export interface ConnectionConfig {
  providerId: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  workspaceId?: string;
}

// This is the only connection representation allowed across the HTTP boundary.
export interface Connection {
  id: string;
  name: string;
  providerId: string;
  baseUrl: string;
  createdAt: string;
  verification: Verification;
  models: Model[];
  catalogWarning?: string;
}

export interface MediaInput {
  data: string;
  mimeType: string;
}

export interface RunInput {
  connectionId: string;
  modelId: string;
  operation: Operation;
  text?: string;
  media?: MediaInput;
  voice?: string;
  maxOutputTokens?: number;
}

export interface Approval {
  id: string;
  connectionId: string;
  providerId: string;
  providerName: string;
  /** Connection base URL; adapters append operation-specific paths. */
  destination: string;
  modelId: string;
  operation: Operation;
  capabilitySource: CapabilitySource;
  verificationState: Verification['state'];
  createdAt: string;
  expiresAt: string;
  /** Complete validated text, never truncated. Empty for transcription. */
  inputPreview: string;
  inputCharacters: number;
  mediaBytes: number;
  mediaType?: string;
  maxOutputTokens?: number;
  voice?: string;
  billingNotice: string;
}

export interface RunResult {
  id: string;
  providerId: string;
  modelId: string;
  operation: Operation;
  durationMs: number;
  text?: string;
  media?: MediaInput;
  embedding?: number[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface CatalogResult {
  models: Model[];
  warning?: string;
}

export interface MetadataOptions {
  signal?: AbortSignal;
}

// Adapter code never owns an approval. Only ModelPort may invoke its run method.
export interface ProviderAdapter {
  verify(config: ConnectionConfig, provider: ProviderDefinition, options?: MetadataOptions): Promise<Verification>;
  listModels(config: ConnectionConfig, provider: ProviderDefinition, options?: MetadataOptions): Promise<CatalogResult>;
  run(config: ConnectionConfig, provider: ProviderDefinition, input: RunInput): Promise<Omit<RunResult, 'id' | 'durationMs'>>;
}

export interface TransportRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  allowedOrigins: string[];
  allowLoopback?: boolean;
  maxResponseBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;
