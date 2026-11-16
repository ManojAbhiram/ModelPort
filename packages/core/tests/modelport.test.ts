import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPort } from '../src/modelport.js';
import { ModelPortError } from '../src/errors.js';
import type { CatalogResult, ProviderAdapter, RunInput, Verification } from '../src/types.js';

const instances: ModelPort[] = [];
afterEach(() => { for (const port of instances.splice(0)) port.dispose(); vi.useRealTimers(); });

function setup(now?: () => number, options: { metadataTimeoutMs?: number } = {}) {
  const adapter: ProviderAdapter = {
    verify: vi.fn<ProviderAdapter['verify']>(async () => ({ state: 'authenticated', checkedAt: new Date().toISOString(), message: 'Metadata only.', inferenceTested: false })),
    listModels: vi.fn<ProviderAdapter['listModels']>(async (_config, provider) => ({ models: [
      { id: 'test-chat', name: 'Test chat', providerId: provider.id, operations: ['text', 'vision'], capabilitySource: 'provider' },
      { id: 'unknown-model', name: 'Unknown model', providerId: provider.id, operations: [], capabilitySource: 'unknown' },
    ] })),
    run: vi.fn<ProviderAdapter['run']>(async (_config, provider, input) => ({ providerId: provider.id, modelId: input.modelId, operation: input.operation, text: input.text })),
  };
  const port = new ModelPort({ adapter, now, ...options });
  instances.push(port);
  return { port, adapter };
}

async function connected() {
  const fixture = setup();
  const connection = await fixture.port.connect({ providerId: 'openai', apiKey: 'sk-canary-never-expose' });
  const input: RunInput = { connectionId: connection.id, modelId: 'test-chat', operation: 'text', text: 'Approved input' };
  return { ...fixture, connection, input };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('approval-gated integration SDK', () => {
  it('exposes the complete immutable text and destination before approval', async () => {
    const { port, adapter, input, connection } = await connected();
    const text = 'x'.repeat(3000) + ' REVIEW THIS END';
    const approval = port.prepare({ ...input, text });
    expect(approval.inputPreview).toBe(text);
    expect(approval).toHaveProperty('destination', connection.baseUrl);
    approval.inputPreview = 'Changed view';
    expect(port.listApprovals()[0]?.inputPreview).toBe(text);
    expect(adapter.run).not.toHaveBeenCalled();
    expect((await port.execute(approval.id, { consent: true })).text).toBe(text);
  });
  it('connects, refreshes, declares, and prepares without any inference', async () => {
    const { port, adapter, connection, input } = await connected();
    await port.refresh(connection.id);
    port.declareModel(connection.id, { id: 'a-user-model', operations: ['text'] });
    const approval = port.prepare(input);
    expect(approval.maxOutputTokens).toBe(512);
    expect(adapter.verify).toHaveBeenCalledTimes(2);
    expect(adapter.listModels).toHaveBeenCalledTimes(2);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('never includes keys in views, approvals, or JSON serialization', async () => {
    const { port, connection, input } = await connected();
    expect(JSON.stringify([port, connection, port.getConnections(), port.prepare(input)])).not.toContain('sk-canary');
    connection.models[0]!.operations = [];
    expect(port.getConnections()[0]!.models[0]!.operations).toContain('text');
  });

  it('binds execution to an immutable request snapshot', async () => {
    const { port, adapter, input } = await connected();
    const approval = port.prepare(input);
    input.text = 'Changed after review';
    approval.modelId = 'another-model';
    const result = await port.execute(approval.id, { consent: true });
    expect(result.text).toBe('Approved input');
    expect(adapter.run).toHaveBeenCalledTimes(1);
    expect(result.modelId).toBe('test-chat');
  });

  it('requires human consent and the same session scope', async () => {
    const { port, adapter, input } = await connected();
    const approval = port.prepare(input, { scope: 'browser-one' });
    expect(port.listApprovals({ scope: 'browser-two' })).toEqual([]);
    await expect(port.execute(approval.id, { consent: false, scope: 'browser-one' })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    await expect(port.execute(approval.id, { consent: true, scope: 'browser-two' })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    expect(adapter.run).not.toHaveBeenCalled();
    await port.execute(approval.id, { consent: true, scope: 'browser-one' });
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('consumes approval atomically during a double-click race', async () => {
    const { port, adapter, input } = await connected();
    const approval = port.prepare(input);
    const results = await Promise.allSettled([
      port.execute(approval.id, { consent: true }), port.execute(approval.id, { consent: true }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous provider failure or restore consumed approval', async () => {
    const { port, adapter, input } = await connected();
    vi.mocked(adapter.run).mockRejectedValue(new ModelPortError('PROVIDER_TIMEOUT', 'Possibly billed.', 504));
    const approval = port.prepare(input);
    await expect(port.execute(approval.id, { consent: true })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    await expect(port.execute(approval.id, { consent: true })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('expires approvals without calling the provider', async () => {
    let now = Date.now();
    const { port, adapter } = setup(() => now);
    const connection = await port.connect({ providerId: 'openai', apiKey: 'test-key' });
    const approval = port.prepare({ connectionId: connection.id, modelId: 'test-chat', operation: 'text', text: 'Hello' });
    now += 5 * 60_000;
    await expect(port.execute(approval.id, { consent: true })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'disconnect', 'declare', 'cancel'] as const)('%s invalidates pending approval', async (action) => {
    const { port, adapter, connection, input } = await connected();
    const approval = port.prepare(input);
    if (action === 'refresh') await port.refresh(connection.id);
    if (action === 'disconnect') port.disconnect(connection.id);
    if (action === 'declare') port.declareModel(connection.id, { id: 'test-chat', operations: ['text'] });
    if (action === 'cancel') port.cancel(approval.id);
    await expect(port.execute(approval.id, { consent: true })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('fails closed on unknown models until a human declares capabilities', async () => {
    const { port, connection, input } = await connected();
    input.modelId = 'unknown-model';
    expect(() => port.prepare(input)).toThrow(/Unknown capabilities/);
    port.declareModel(connection.id, { id: input.modelId, operations: ['text'] });
    expect(port.prepare(input).capabilitySource).toBe('declared');
  });

  it('cannot extend an adapter with an unsupported human declaration', async () => {
    const { port } = setup();
    const connection = await port.connect({ providerId: 'anthropic', apiKey: 'test-key' });
    expect(() => port.declareModel(connection.id, { id: 'some-model', operations: ['image'] })).toThrow(/does not implement/);
  });

  it('limits pending memory and disallows disposed instances', async () => {
    const { port, input } = await connected();
    for (let index = 0; index < 8; index++) port.prepare(input);
    expect(() => port.prepare(input)).toThrow(/Pending data is memory-limited/);
    port.dispose();
    expect(() => port.getConnections()).toThrow(/disposed/);
  });

  it('rejects injected request fields and unreasonable output caps', async () => {
    const { port, input } = await connected();
    expect(() => port.prepare({ ...input, maxOutputTokens: 4097 })).toThrow(/Invalid request/);
    expect(() => port.prepare({ ...input, approved: true } as RunInput)).toThrow(/Invalid request/);
  });

  it.each(['openrouter/auto', 'openrouter/auto-beta', 'openrouter/auto-code', 'openrouter/auto:free'])('rejects automatic router %s before preparing an approval', async (modelId) => {
    const { port, adapter } = setup();
    const connection = await port.connect({ providerId: 'openrouter', apiKey: 'offline-test-key' });
    port.declareModel(connection.id, { id: modelId, operations: ['text'] });
    expect(() => port.prepare({ connectionId: connection.id, modelId, operation: 'text', text: 'Hello' })).toThrow(/Automatic model routing/);
    expect(port.listApprovals()).toEqual([]);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('rejects unsupported Cerebras WebP before approval while accepting PNG', async () => {
    const { port, adapter } = setup();
    const connection = await port.connect({ providerId: 'cerebras', apiKey: 'offline-test-key' });
    const input: RunInput = { connectionId: connection.id, modelId: 'test-chat', operation: 'vision', text: 'Describe this pixel.' };
    expect(() => port.prepare({ ...input, media: { mimeType: 'image/webp', data: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' } })).toThrow(/input media type/);
    expect(port.listApprovals()).toEqual([]);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/i9sAAAAASUVORK5CYII=';
    expect(port.prepare({ ...input, media: { mimeType: 'image/png', data: png } }).mediaType).toBe('image/png');
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('does not let an older refresh restore a capability disabled by newer metadata', async () => {
    const { port, adapter, connection, input } = await connected();
    const olderCatalog = deferred<CatalogResult>();
    const newerCatalog = deferred<CatalogResult>();
    vi.mocked(adapter.listModels).mockImplementationOnce(() => olderCatalog.promise).mockImplementationOnce(() => newerCatalog.promise);
    const older = port.refresh(connection.id);
    const newer = port.refresh(connection.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const model = connection.models[0]!;
    newerCatalog.resolve({ models: [{ ...model, operations: [] }] });
    await newer;
    expect(() => port.prepare(input)).toThrow(/Unknown capabilities/);
    olderCatalog.resolve({ models: [model] });
    await expect(older).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' });
    expect(port.getConnections()[0]!.models[0]!.operations).toEqual([]);
    expect(() => port.prepare(input)).toThrow(/Unknown capabilities/);
  });

  it('rejects stale refreshes without invalidating an approval created after the newer update', async () => {
    const { port, adapter, connection, input } = await connected();
    const olderCatalog = deferred<CatalogResult>();
    const newerCatalog = deferred<CatalogResult>();
    vi.mocked(adapter.listModels).mockImplementationOnce(() => olderCatalog.promise).mockImplementationOnce(() => newerCatalog.promise);
    const older = port.refresh(connection.id);
    const newer = port.refresh(connection.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    newerCatalog.resolve({ models: connection.models });
    await newer;
    const approval = port.prepare(input);
    olderCatalog.resolve({ models: [] });
    await expect(older).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' });
    expect(port.listApprovals().map(({ id }) => id)).toEqual([approval.id]);
  });

  it('keeps a human declaration made while a refresh was in flight', async () => {
    const { port, adapter, connection } = await connected();
    const catalog = deferred<CatalogResult>();
    vi.mocked(adapter.listModels).mockImplementationOnce(() => catalog.promise);
    const refreshing = port.refresh(connection.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    port.declareModel(connection.id, { id: 'test-chat', operations: ['text'] });
    catalog.resolve({ models: [] });
    await expect(refreshing).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' });
    expect(port.getConnections()[0]!.models.find(({ id }) => id === 'test-chat')?.capabilitySource).toBe('declared');
  });

  it('uses one deadline for verification and catalog inspection, not a fresh deadline per request', async () => {
    vi.useFakeTimers();
    const { port, adapter } = setup(undefined, { metadataTimeoutMs: 100 });
    const signals: AbortSignal[] = [];
    vi.mocked(adapter.verify).mockImplementation((_config, _provider, options) => new Promise((resolve) => {
      signals.push(options!.signal!);
      setTimeout(() => resolve({ state: 'authenticated', checkedAt: new Date().toISOString(), message: 'Metadata only.', inferenceTested: false }), 60);
    }));
    vi.mocked(adapter.listModels).mockImplementation((_config, _provider, options) => new Promise((resolve) => {
      signals.push(options!.signal!);
      setTimeout(() => resolve({ models: [] }), 60);
    }));
    const connecting = port.connect({ providerId: 'openai', apiKey: 'offline-test-key' });
    const timedOut = expect(connecting).rejects.toMatchObject({ code: 'METADATA_TIMEOUT', statusCode: 504 });
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]!.aborted).toBe(true);
    expect(port.getConnections()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(port.getConnections()).toEqual([]);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('cancels an abandoned connect even if the adapter ignores its signal, without a late commit', async () => {
    const { port, adapter } = setup();
    const catalog = deferred<CatalogResult>();
    vi.mocked(adapter.listModels).mockImplementationOnce(() => catalog.promise);
    const controller = new AbortController();
    const connecting = port.connect({ providerId: 'openai', apiKey: 'offline-test-key' }, { signal: controller.signal });
    const cancelled = expect(connecting).rejects.toMatchObject({ code: 'METADATA_CANCELLED', statusCode: 499 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort(new Error('Never expose this cancellation reason: secret-canary'));
    await cancelled;
    expect(vi.mocked(adapter.listModels).mock.calls[0]![2]?.signal?.aborted).toBe(true);
    catalog.resolve({ models: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(port.getConnections()).toEqual([]);
    expect(adapter.run).not.toHaveBeenCalled();
    expect((await port.connect({ providerId: 'openai', apiKey: 'offline-test-key' })).id).toBeTruthy();
  });

  it('never starts catalog inspection after cancellation during verification', async () => {
    const { port, adapter } = setup();
    const verification = deferred<Verification>();
    vi.mocked(adapter.verify).mockImplementationOnce(() => verification.promise);
    const controller = new AbortController();
    const connecting = port.connect({ providerId: 'openai', apiKey: 'offline-test-key' }, { signal: controller.signal });
    const cancelled = expect(connecting).rejects.toMatchObject({ code: 'METADATA_CANCELLED' });
    controller.abort();
    await cancelled;
    verification.resolve({ state: 'authenticated', checkedAt: new Date().toISOString(), message: 'Metadata only.', inferenceTested: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(adapter.listModels).not.toHaveBeenCalled();
    expect(port.getConnections()).toEqual([]);
  });

  it('preserves existing metadata and pending approvals when a refresh is cancelled', async () => {
    const { port, adapter, connection, input } = await connected();
    const approval = port.prepare(input);
    const catalog = deferred<CatalogResult>();
    vi.mocked(adapter.listModels).mockImplementationOnce(() => catalog.promise);
    const controller = new AbortController();
    const refreshing = port.refresh(connection.id, { signal: controller.signal });
    const cancelled = expect(refreshing).rejects.toMatchObject({ code: 'METADATA_CANCELLED' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await cancelled;
    catalog.resolve({ models: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(port.getConnections()).toEqual([connection]);
    expect(port.listApprovals().map(({ id }) => id)).toEqual([approval.id]);
  });

  it('rejects an already-cancelled metadata request without contacting an adapter', async () => {
    const { port, adapter } = setup();
    await expect(port.connect({ providerId: 'openai', apiKey: 'offline-test-key' }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'METADATA_CANCELLED' });
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.listModels).not.toHaveBeenCalled();
    expect(port.getConnections()).toEqual([]);
  });

  it('aborts active metadata work when disposed and limits deadline configuration', async () => {
    const { port, adapter } = setup();
    const verification = deferred<Verification>();
    vi.mocked(adapter.verify).mockImplementationOnce(() => verification.promise);
    const connecting = port.connect({ providerId: 'openai', apiKey: 'offline-test-key' });
    const cancelled = expect(connecting).rejects.toMatchObject({ code: 'METADATA_CANCELLED' });
    port.dispose();
    await cancelled;
    expect(vi.mocked(adapter.verify).mock.calls[0]![2]?.signal?.aborted).toBe(true);
    expect(() => new ModelPort({ metadataTimeoutMs: 120_001 })).toThrow(/metadata transaction deadline/);
    expect(() => new ModelPort({ metadataTimeoutMs: 0 })).toThrow(/metadata transaction deadline/);
  });
});
