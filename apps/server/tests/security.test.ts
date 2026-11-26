import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ModelPort } from '@manojabhiram/modelport-core';
import type { CatalogResult, ProviderAdapter } from '@manojabhiram/modelport-core';
import { buildApp } from '../src/app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const host = '127.0.0.1:8787';

async function setup(now?: () => number, metadataTimeoutMs?: number) {
  const adapter: ProviderAdapter = {
    verify: vi.fn<ProviderAdapter['verify']>(async () => ({ state: 'authenticated', message: 'Metadata accepted, inference not tested.', checkedAt: new Date().toISOString(), inferenceTested: false })),
    listModels: vi.fn<ProviderAdapter['listModels']>(async (_config, provider) => ({ models: [{ id: 'test-chat', name: 'Test chat', providerId: provider.id, operations: ['text'], capabilitySource: 'provider' }] })),
    run: vi.fn<ProviderAdapter['run']>(async (_config, provider, input) => ({ providerId: provider.id, modelId: input.modelId, operation: input.operation, text: input.text })),
  };
  const modelPort = new ModelPort({ adapter, now, metadataTimeoutMs });
  const app = await buildApp({ modelPort, serveWeb: false, now });
  apps.push(app);
  const session = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: { host, 'x-modelport-client': 'workbench' } });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    return { host, cookie, 'x-csrf-token': response.json().csrfToken as string, 'content-type': 'application/json' };
  };
  return { app, adapter, modelPort, session };
}

function postToServer(app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string>, path: string, body: unknown) {
  const payload = JSON.stringify(body);
  const client = httpRequest({
    hostname: '127.0.0.1', port: (app.server.address() as AddressInfo).port,
    path, method: 'POST', headers: { ...headers, 'content-length': String(Buffer.byteLength(payload)) }, agent: false,
  });
  client.on('error', () => {});
  client.end(payload);
  return client;
}

describe('local browser security boundary', () => {
  it('protects all connection data behind a session and does not set CORS access', async () => {
    const { app } = await setup();
    const response = await app.inject({ url: '/api/connections', headers: { host } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('requires an explicit bootstrap header and sets an HttpOnly SameSite cookie', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/session', headers: { host } })).statusCode).toBe(403);
    const response = await app.inject({ url: '/api/session', headers: { host, 'x-modelport-client': 'workbench' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict');
    expect(response.json().csrfToken).toHaveLength(43);
  });

  it.each([
    { host: 'attacker.example:8787' },
    { host, origin: 'https://attacker.example' },
    { host, origin: 'null' },
    { host, 'sec-fetch-site': 'cross-site' },
    { host, 'sec-fetch-site': 'same-site' },
    { host: '127.0.0.1.attacker.example:8787', 'x-forwarded-host': host },
  ])('rejects unapproved hosts, origins and cross-site requests: %j', async (headers) => {
    const { app } = await setup();
    const response = await app.inject({ url: '/api/session', headers: { ...headers, 'x-modelport-client': 'workbench' } });
    expect(response.statusCode).toBe(403);
  });

  it('rejects missing, forged, or Unicode CSRF tokens before handling credentials', async () => {
    const { app, session, adapter } = await setup();
    const headers = await session();
    for (const token of ['', 'fake-token', '\u00e9'.repeat(43)]) {
      const response = await app.inject({ method: 'POST', url: '/api/connections', headers: { ...headers, 'x-csrf-token': token }, payload: { providerId: 'openai', apiKey: 'secret-canary' } });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('secret-canary');
    }
    expect(adapter.verify).not.toHaveBeenCalled();
  });

  it('rejects form submissions, oversized bodies, and forged session cookies', async () => {
    const { app, session } = await setup();
    const headers = await session();
    const form = await app.inject({ method: 'POST', url: '/api/connections', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'providerId=openai&apiKey=secret' });
    expect(form.statusCode).toBe(415);
    const large = await app.inject({ method: 'POST', url: '/api/approvals', headers, payload: { text: 'x'.repeat(6 * 1024 * 1024) } });
    expect(large.statusCode).toBe(413);
    const forged = await app.inject({ url: '/api/connections', headers: { host, cookie: 'modelport_session_8787=forged' } });
    expect(forged.statusCode).toBe(401);
  });

  it('sanitizes unexpected provider errors rather than leaking raw keys', async () => {
    const { app, session, adapter } = await setup();
    vi.mocked(adapter.verify).mockRejectedValue(new Error('Upstream error Authorization: Bearer sk-secret-canary'));
    const response = await app.inject({ method: 'POST', url: '/api/connections', headers: await session(), payload: { providerId: 'openai', apiKey: 'sk-secret-canary' } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('sk-secret-canary');
    expect(response.body).not.toContain('Authorization');
  });

  it('expires browser sessions', async () => {
    let now = Date.now();
    const { app, session } = await setup(() => now);
    const headers = await session();
    now += 8 * 60 * 60_000 + 1;
    expect((await app.inject({ url: '/api/connections', headers })).statusCode).toBe(401);
  });
});

describe('server-enforced human approval', () => {
  it('connects and prepares without inference, then executes only the reviewed snapshot once', async () => {
    const { app, adapter, session } = await setup();
    const headers = await session();
    const connected = await app.inject({ method: 'POST', url: '/api/connections', headers, payload: { providerId: 'openai', apiKey: 'sk-secret-canary' } });
    expect(connected.statusCode).toBe(200);
    expect(connected.body).not.toContain('sk-secret-canary');
    const prepared = await app.inject({ method: 'POST', url: '/api/approvals', headers, payload: { connectionId: connected.json().connection.id, modelId: 'test-chat', operation: 'text', text: 'Human reviewed this.' } });
    expect(prepared.statusCode).toBe(200);
    expect(adapter.run).not.toHaveBeenCalled();
    const url = `/api/approvals/${prepared.json().approval.id}/execute`;
    const modified = await app.inject({ method: 'POST', url, headers, payload: { consent: true, text: 'Injected after review.' } });
    expect(modified.statusCode).toBe(400);
    const denied = await app.inject({ method: 'POST', url, headers, payload: { consent: false } });
    expect(denied.statusCode).toBe(400);
    expect(adapter.run).not.toHaveBeenCalled();
    const executed = await app.inject({ method: 'POST', url, headers, payload: { consent: true } });
    expect(executed.statusCode).toBe(200);
    expect(executed.json().result.text).toBe('Human reviewed this.');
    expect((await app.inject({ method: 'POST', url, headers, payload: { consent: true } })).statusCode).toBe(404);
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('does not let another browser session approve an existing request', async () => {
    const { app, adapter, session } = await setup();
    const first = await session();
    const second = await session();
    const connected = await app.inject({ method: 'POST', url: '/api/connections', headers: first, payload: { providerId: 'openai', apiKey: 'test-key' } });
    const prepared = await app.inject({ method: 'POST', url: '/api/approvals', headers: first, payload: { connectionId: connected.json().connection.id, modelId: 'test-chat', operation: 'text', text: 'Reviewed.' } });
    const response = await app.inject({ method: 'POST', url: `/api/approvals/${prepared.json().approval.id}/execute`, headers: second, payload: { consent: true } });
    expect(response.statusCode).toBe(404);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('cancels approvals and disconnects without generation', async () => {
    const { app, adapter, session } = await setup();
    const headers = await session();
    const connected = await app.inject({ method: 'POST', url: '/api/connections', headers, payload: { providerId: 'openai', apiKey: 'test-key' } });
    const connectionId = connected.json().connection.id;
    const prepared = await app.inject({ method: 'POST', url: '/api/approvals', headers, payload: { connectionId, modelId: 'test-chat', operation: 'text', text: 'Not sent.' } });
    const deleteHeaders = { host, cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'] };
    expect((await app.inject({ method: 'DELETE', url: `/api/approvals/${prepared.json().approval.id}`, headers: deleteHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/connections/${connectionId}`, headers: deleteHeaders })).statusCode).toBe(200);
    expect(adapter.run).not.toHaveBeenCalled();
  });
});

describe('metadata transaction lifetime', () => {
  it('returns a sanitized transaction timeout without saving credentials or retrying', async () => {
    const { app, adapter, modelPort, session } = await setup(undefined, 20);
    vi.mocked(adapter.listModels).mockImplementationOnce(() => new Promise<CatalogResult>(() => {}));
    const response = await app.inject({ method: 'POST', url: '/api/connections', headers: await session(), payload: { providerId: 'openai', apiKey: 'sk-secret-canary' } });
    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe('METADATA_TIMEOUT');
    expect(response.body).not.toContain('sk-secret-canary');
    expect(modelPort.getConnections()).toEqual([]);
    expect(adapter.listModels).toHaveBeenCalledTimes(1);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('cancels metadata after the browser disconnects and prevents a late connection commit', async () => {
    const { app, adapter, modelPort, session } = await setup();
    const headers = await session();
    let started!: () => void;
    let finish!: (catalog: CatalogResult) => void;
    let signal!: AbortSignal;
    const metadataStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(adapter.listModels).mockImplementationOnce((_config, _provider, options) => new Promise((resolve) => {
      finish = resolve;
      signal = options!.signal!;
      started();
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const client = postToServer(app, headers, '/api/connections', { providerId: 'openai', apiKey: 'offline-test-key' });
    await metadataStarted;
    const cancelled = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    client.destroy();
    await cancelled;
    finish({ models: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(signal.aborted).toBe(true);
    expect(modelPort.getConnections()).toEqual([]);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it('does not mutate metadata or pending approvals after an abandoned refresh', async () => {
    const { app, adapter, modelPort, session } = await setup();
    const headers = await session();
    const connected = await app.inject({ method: 'POST', url: '/api/connections', headers, payload: { providerId: 'openai', apiKey: 'offline-test-key' } });
    const connection = connected.json().connection;
    const approval = modelPort.prepare({ connectionId: connection.id, modelId: 'test-chat', operation: 'text', text: 'Not sent.' });
    let started!: () => void;
    let finish!: (catalog: CatalogResult) => void;
    let signal!: AbortSignal;
    const metadataStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(adapter.listModels).mockImplementationOnce((_config, _provider, options) => new Promise((resolve) => {
      finish = resolve;
      signal = options!.signal!;
      started();
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const client = postToServer(app, headers, `/api/connections/${connection.id}/refresh`, {});
    await metadataStarted;
    const cancelled = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    client.destroy();
    await cancelled;
    finish({ models: [] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(modelPort.getConnections()).toEqual([connection]);
    expect(modelPort.listApprovals().map(({ id }) => id)).toEqual([approval.id]);
    expect(adapter.run).not.toHaveBeenCalled();
  });
});
