import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeTarget, isPublicAddress, publicLookup, safeTransport } from '../src/transport.js';
import { ModelPortError } from '../src/errors.js';

const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn() }));
vi.mock('node:dns', () => ({ lookup: dnsLookup }));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function localServer(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('guarded HTTP transport', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.100.100.200', '192.168.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '224.0.0.1'])('rejects non-public address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it('recognizes public IPv4 and IPv6', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('requires an exact origin, TLS for cloud, and explicit loopback permission', () => {
    expect(() => assertSafeTarget({ url: 'https://evil.example/models', allowedOrigins: ['https://api.openai.com'] })).toThrow(/allowed origin/);
    expect(() => assertSafeTarget({ url: 'http://api.openai.com/models', allowedOrigins: ['http://api.openai.com'] })).toThrow(/HTTPS/);
    expect(() => assertSafeTarget({ url: 'http://127.0.0.1:11434/api/tags', allowedOrigins: ['http://127.0.0.1:11434'] })).toThrow(/explicitly permitted/);
    expect(() => assertSafeTarget({ url: 'https://api.openai.com@evil.example/models', allowedOrigins: ['https://evil.example'] })).toThrow();
  });

  it('rejects DNS rebinding and mixed public/private resolutions at socket lookup', async () => {
    dnsLookup.mockImplementation((_host, _options, callback) => callback(null, [
      { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
    ]));
    const error = await new Promise<unknown>((resolve) => publicLookup('api.openai.com', { all: true }, (failure) => resolve(failure)));
    expect(error).toMatchObject({ code: 'UNSAFE_ENDPOINT' });
  });

  it('returns the vetted DNS addresses directly to the connection', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }];
    dnsLookup.mockImplementation((_host, _options, callback) => callback(null, addresses));
    const result = await new Promise<unknown>((resolve, reject) => publicLookup('api.openai.com', { all: true }, (error, address) => error ? reject(error) : resolve(address)));
    expect(result).toEqual(addresses);
  });

  it('performs one bounded request to an explicitly allowed local server', async () => {
    const handler = vi.fn<RequestListener>((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"models":[]}'); });
    const origin = await localServer(handler);
    const response = await safeTransport({ url: `${origin}/models`, allowedOrigins: [origin], allowLoopback: true });
    expect(Buffer.from(response.body).toString()).toBe('{"models":[]}');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never follows redirects with credentials', async () => {
    const handler = vi.fn<RequestListener>((_request, response) => { response.writeHead(302, { Location: 'https://evil.example/steal' }); response.end(); });
    const origin = await localServer(handler);
    await expect(safeTransport({ url: `${origin}/models`, allowedOrigins: [origin], allowLoopback: true, headers: { Authorization: 'Bearer canary' } })).rejects.toMatchObject({ code: 'PROVIDER_REDIRECT' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('caps streamed responses even without Content-Length', async () => {
    const origin = await localServer((_request, response) => { response.write('123456'); response.end('7890'); });
    await expect(safeTransport({ url: origin, allowedOrigins: [origin], allowLoopback: true, maxResponseBytes: 5 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('copies many tiny chunks into bounded response storage', async () => {
    const origin = await localServer((_request, response) => {
      for (let index = 0; index < 4096; index++) response.write('x');
      response.end();
    });
    const result = await safeTransport({ url: origin, allowedOrigins: [origin], allowLoopback: true, maxResponseBytes: 4096 });
    expect(Buffer.from(result.body).toString()).toBe('x'.repeat(4096));
  });

  it('times out without retrying and reports ambiguous billing', async () => {
    const handler = vi.fn<RequestListener>(() => undefined);
    const origin = await localServer(handler);
    await expect(safeTransport({ url: origin, method: 'POST', allowedOrigins: [origin], allowLoopback: true, timeoutMs: 50 })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', message: expect.stringContaining('bill') });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not open a socket when metadata has already been cancelled', async () => {
    const handler = vi.fn<RequestListener>((_request, response) => response.end('{}'));
    const origin = await localServer(handler);
    await expect(safeTransport({ url: origin, allowedOrigins: [origin], allowLoopback: true, signal: AbortSignal.abort(new Error('secret-canary')) })).rejects.toMatchObject({ code: 'METADATA_CANCELLED', message: expect.not.stringContaining('secret-canary') });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['METADATA_CANCELLED', 'METADATA_TIMEOUT'])('destroys an active socket on %s without retrying', async (code) => {
    let received!: () => void;
    let closed!: () => void;
    const requestReceived = new Promise<void>((resolve) => { received = resolve; });
    const socketClosed = new Promise<void>((resolve) => { closed = resolve; });
    const handler = vi.fn<RequestListener>((_request, response) => {
      response.once('close', closed);
      received();
    });
    const origin = await localServer(handler);
    const controller = new AbortController();
    const pending = safeTransport({ url: origin, allowedOrigins: [origin], allowLoopback: true, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code, message: expect.not.stringContaining('secret-canary') });
    await requestReceived;
    controller.abort(new ModelPortError(code, 'secret-canary', code === 'METADATA_TIMEOUT' ? 504 : 499));
    await rejected;
    await socketClosed;
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
