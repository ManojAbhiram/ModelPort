import { randomUUID } from 'node:crypto';
import { createAdapter } from './adapters.js';
import { getProvider } from './catalog.js';
import { ModelPortError } from './errors.js';
import { assertRequestPolicy } from './policy.js';
import { safeTransport } from './transport.js';
import { MAX_RESPONSE_BYTES, normalizeConfig, validateDeclaration, validateMedia, validateRun } from './validation.js';
import type { Approval, Connection, ConnectionConfig, MetadataOptions, Operation, ProviderAdapter, ProviderDefinition, RunInput, RunResult, Transport } from './types.js';

interface SavedConnection { config: ConnectionConfig; view: Connection; revision: number }
interface PendingRequest { view: Approval; input: RunInput; scope: string; timer: ReturnType<typeof setTimeout>; bytes: number }
export interface ModelPortOptions { transport?: Transport; adapter?: ProviderAdapter; now?: () => number; approvalTtlMs?: number; metadataTimeoutMs?: number }
export interface ApprovalScope { scope?: string }

export class ModelPort {
  #connections = new Map<string, SavedConnection>();
  #pending = new Map<string, PendingRequest>();
  #adapter: ProviderAdapter;
  #now: () => number;
  #ttl: number;
  #metadataTimeout: number;
  #metadataControllers = new Set<AbortController>();
  #connecting = 0;
  #running = false;
  #disposed = false;

  constructor(options: ModelPortOptions = {}) {
    this.#adapter = options.adapter ?? createAdapter(options.transport ?? safeTransport);
    this.#now = options.now ?? Date.now;
    this.#ttl = options.approvalTtlMs ?? 5 * 60_000;
    this.#metadataTimeout = options.metadataTimeoutMs ?? 110_000;
    if (!Number.isInteger(this.#ttl) || this.#ttl < 1 || this.#ttl > 5 * 60_000) {
      throw new ModelPortError('INVALID_INPUT', 'Approvals must expire within five minutes.');
    }
    if (!Number.isInteger(this.#metadataTimeout) || this.#metadataTimeout < 1 || this.#metadataTimeout > 120_000) {
      throw new ModelPortError('INVALID_INPUT', 'The metadata transaction deadline must be between 1 and 120,000 milliseconds.');
    }
  }

  #assertOpen() {
    if (this.#disposed) throw new ModelPortError('DISPOSED', 'This ModelPort instance has been disposed.', 410);
  }

  #get(id: string): SavedConnection {
    this.#assertOpen();
    const connection = this.#connections.get(id);
    if (!connection) throw new ModelPortError('CONNECTION_NOT_FOUND', 'This connection no longer exists.', 404);
    return connection;
  }

  #removeApproval(id: string) {
    const entry = this.#pending.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#pending.delete(id);
  }

  #invalidate(connectionId: string) {
    for (const [id, entry] of this.#pending) {
      if (entry.input.connectionId === connectionId) this.#removeApproval(id);
    }
  }

  #prune() {
    for (const [id, entry] of this.#pending) {
      if (Date.parse(entry.view.expiresAt) <= this.#now()) this.#removeApproval(id);
    }
  }

  async #inspect(config: ConnectionConfig, provider: ProviderDefinition, { signal }: MetadataOptions) {
    const cancelledError = () => new ModelPortError('METADATA_CANCELLED', 'Metadata inspection was cancelled. No inference was performed.', 499);
    if (signal?.aborted) throw cancelledError();
    const controller = new AbortController();
    this.#metadataControllers.add(controller);
    const relayAbort = () => controller.abort(cancelledError());
    signal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new ModelPortError('METADATA_TIMEOUT', 'Metadata inspection exceeded the transaction deadline. No inference was performed.', 504)), this.#metadataTimeout);
    timer.unref();
    let rejectOnAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    try {
      // Race the complete transaction, not each page, so even an injected adapter
      // that ignores cancellation cannot cause a late connection commit.
      return await Promise.race([cancelled, (async () => {
        controller.signal.throwIfAborted();
        const metadata = { signal: controller.signal };
        const verification = await this.#adapter.verify(config, provider, metadata);
        controller.signal.throwIfAborted();
        const catalog = await this.#adapter.listModels(config, provider, metadata);
        controller.signal.throwIfAborted();
        return { verification, catalog };
      })()]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relayAbort);
      controller.signal.removeEventListener('abort', rejectOnAbort);
      this.#metadataControllers.delete(controller);
    }
  }

  async connect(value: ConnectionConfig, options: MetadataOptions = {}): Promise<Connection> {
    this.#assertOpen();
    if (this.#connections.size + this.#connecting >= 16) throw new ModelPortError('CONNECTION_LIMIT', 'At most 16 connections may be held in memory.', 429);
    const provider = getProvider(value?.providerId);
    const config = normalizeConfig(value, provider);
    this.#connecting++;
    try {
      const { verification, catalog } = await this.#inspect(config, provider, options);
      this.#assertOpen();
      const view: Connection = {
        id: randomUUID(), name: config.name!, providerId: provider.id, baseUrl: config.baseUrl!,
        createdAt: new Date(this.#now()).toISOString(), verification,
        models: catalog.models, ...(catalog.warning ? { catalogWarning: catalog.warning } : {}),
      };
      this.#connections.set(view.id, { config, view, revision: 0 });
      return structuredClone(view);
    } finally {
      this.#connecting--;
    }
  }

  getConnections(): Connection[] {
    this.#assertOpen();
    return structuredClone([...this.#connections.values()].map(({ view }) => view));
  }

  async refresh(connectionId: string, options: MetadataOptions = {}): Promise<Connection> {
    const connection = this.#get(connectionId);
    const revision = ++connection.revision;
    const provider = getProvider(connection.view.providerId);
    const { verification, catalog } = await this.#inspect(connection.config, provider, options);
    if (this.#get(connectionId) !== connection || connection.revision !== revision) {
      throw new ModelPortError('CONNECTION_CHANGED', 'A newer refresh or model declaration superseded this metadata request.', 409);
    }
    this.#invalidate(connectionId);
    connection.view = {
      ...connection.view, verification, models: catalog.models, catalogWarning: catalog.warning,
    };
    return structuredClone(connection.view);
  }

  declareModel(connectionId: string, value: { id: string; operations: Operation[] }): Connection {
    const connection = this.#get(connectionId);
    const declaration = validateDeclaration(value);
    const provider = getProvider(connection.view.providerId);
    if (declaration.operations.some((operation) => !provider.operations.includes(operation))) {
      throw new ModelPortError('UNSUPPORTED_OPERATION', 'A declaration cannot enable an operation that this adapter does not implement.', 422);
    }
    const others = connection.view.models.filter(({ id }) => id !== declaration.id);
    if (others.length >= 1000) throw new ModelPortError('MODEL_LIMIT', 'At most 1,000 models may be held per connection.', 429);
    connection.revision++;
    connection.view.models = [...others, {
      id: declaration.id, name: declaration.id, providerId: provider.id,
      operations: declaration.operations, capabilitySource: 'declared',
    }];
    this.#invalidate(connectionId);
    return structuredClone(connection.view);
  }

  disconnect(connectionId: string): void {
    this.#get(connectionId);
    this.#invalidate(connectionId);
    this.#connections.delete(connectionId);
  }

  prepare(value: RunInput, { scope = 'sdk' }: ApprovalScope = {}): Approval {
    this.#assertOpen();
    this.#prune();
    const input = validateRun(value);
    const connection = this.#get(input.connectionId);
    const provider = getProvider(connection.view.providerId);
    assertRequestPolicy(provider.id, input);
    const model = connection.view.models.find(({ id }) => id === input.modelId);
    if (!model) throw new ModelPortError('MODEL_NOT_FOUND', 'Discover this model or explicitly declare its capabilities before use.', 422);
    if (!provider.operations.includes(input.operation) || !model.operations.includes(input.operation)) {
      throw new ModelPortError('UNSUPPORTED_OPERATION', 'The selected model and adapter do not both support this operation. Unknown capabilities require a human declaration.', 422);
    }
    if (input.operation === 'tts') {
      input.voice = input.voice ?? provider.defaultVoice;
      if (!input.voice) throw new ModelPortError('VOICE_REQUIRED', 'Choose a provider voice ID before approving speech synthesis.');
    }
    const bytes = Buffer.byteLength(input.text || '') + (input.media?.data.length || 0);
    const heldBytes = [...this.#pending.values()].reduce((sum, item) => sum + item.bytes, 0);
    if (this.#pending.size >= 8 || heldBytes + bytes > 12 * 1024 * 1024) {
      throw new ModelPortError('APPROVAL_LIMIT', 'Cancel pending requests before preparing more. Pending data is memory-limited.', 429);
    }
    const now = this.#now();
    const view: Approval = {
      id: randomUUID(), connectionId: connection.view.id, providerId: provider.id,
      providerName: provider.name, modelId: model.id, operation: input.operation,
      capabilitySource: model.capabilitySource, verificationState: connection.view.verification.state,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.#ttl).toISOString(),
      inputPreview: input.text?.slice(0, 2000) || 'Audio file for transcription',
      inputCharacters: input.text?.length || 0, mediaBytes: input.media ? Buffer.from(input.media.data, 'base64').length : 0,
      mediaType: input.media?.mimeType, maxOutputTokens: input.maxOutputTokens, voice: input.voice,
      billingNotice: provider.kind === 'local'
        ? 'This calls your local endpoint. Local models use machine resources and may route to cloud services. Any downstream provider fees remain your responsibility. No automatic retry or fallback is made.'
        : 'This sends the reviewed input to the selected provider and may incur charges. Exact cost is unknown; a token cap is not a dollar budget. No automatic retry or fallback is made.',
    };
    const timer = setTimeout(() => this.#removeApproval(view.id), this.#ttl);
    timer.unref();
    this.#pending.set(view.id, { view, input: structuredClone(input), scope, timer, bytes });
    return structuredClone(view);
  }

  listApprovals({ scope = 'sdk' }: ApprovalScope = {}): Approval[] {
    this.#assertOpen();
    this.#prune();
    return structuredClone([...this.#pending.values()].filter((entry) => entry.scope === scope).map(({ view }) => view));
  }

  cancel(approvalId: string, { scope = 'sdk' }: ApprovalScope = {}): void {
    this.#assertOpen();
    const entry = this.#pending.get(approvalId);
    if (!entry || entry.scope !== scope) throw new ModelPortError('APPROVAL_NOT_FOUND', 'The request was consumed, expired, cancelled, or belongs to another session.', 404);
    this.#removeApproval(approvalId);
  }

  async execute(approvalId: string, { consent, scope = 'sdk' }: ApprovalScope & { consent: boolean }): Promise<RunResult> {
    this.#assertOpen();
    if (consent !== true) throw new ModelPortError('CONSENT_REQUIRED', 'Explicit human approval is required before inference.', 403);
    this.#prune();
    const entry = this.#pending.get(approvalId);
    if (!entry || entry.scope !== scope) throw new ModelPortError('APPROVAL_NOT_FOUND', 'The request was consumed, expired, cancelled, or belongs to another session.', 404);
    if (this.#running) throw new ModelPortError('RUN_IN_PROGRESS', 'Only one inference request can run at a time.', 409);
    const connection = this.#get(entry.input.connectionId);
    // Consume synchronously, before the first await. Replays cannot invoke a
    // provider again, even if the first request times out or fails.
    this.#removeApproval(approvalId);
    this.#running = true;
    const start = this.#now();
    try {
      const result = await this.#adapter.run(connection.config, getProvider(connection.view.providerId), entry.input);
      if (result.media) validateMedia(result.media, MAX_RESPONSE_BYTES);
      return { ...result, id: randomUUID(), durationMs: Math.max(0, this.#now() - start) };
    } finally {
      this.#running = false;
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const controller of this.#metadataControllers) {
      controller.abort(new ModelPortError('METADATA_CANCELLED', 'Metadata inspection was cancelled. No inference was performed.', 499));
    }
    for (const id of this.#pending.keys()) this.#removeApproval(id);
    this.#connections.clear();
  }
}
