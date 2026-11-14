import { lookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ModelPortError } from './errors.js';
import type { Transport, TransportRequest } from './types.js';
import { MAX_RESPONSE_BYTES } from './validation.js';

export function isPublicAddress(address: string): boolean {
  try {
    return !address.includes('%') && ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function assertSafeTarget(request: TransportRequest): URL {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'The provider endpoint is invalid.');
  }
  if (url.username || url.password || url.hash || request.url.includes('#') || !request.allowedOrigins.includes(url.origin)) {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'The provider endpoint is outside its allowed origin.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = hostname === '127.0.0.1' || hostname === '::1';
  if (loopback) {
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!request.allowLoopback || !['http:', 'https:'].includes(url.protocol) || port < 1024 || port > 65535) {
      throw new ModelPortError('UNSAFE_ENDPOINT', 'This loopback endpoint has not been explicitly permitted.');
    }
  } else if (url.protocol !== 'https:' || (ipaddr.isValid(hostname) && !isPublicAddress(hostname))) {
    throw new ModelPortError('UNSAFE_ENDPOINT', 'Cloud requests require HTTPS and a public destination.');
  }
  return url;
}

// The vetted addresses are returned to the socket itself. A second, unchecked DNS
// lookup would allow a rebinding attack between validation and connection.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(new ModelPortError('PROVIDER_NETWORK', 'Provider DNS lookup failed.', 502), '');
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new ModelPortError('UNSAFE_ENDPOINT', 'Provider DNS resolved to a non-public address.', 400), '');
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

export const safeTransport: Transport = async (request) => {
  const url = assertSafeTarget(request);
  const abortError = () => request.signal?.reason instanceof ModelPortError && request.signal.reason.code === 'METADATA_TIMEOUT'
    ? new ModelPortError('METADATA_TIMEOUT', 'Metadata inspection exceeded the transaction deadline. No inference was performed.', 504)
    : new ModelPortError('METADATA_CANCELLED', 'Metadata inspection was cancelled. No inference was performed.', 499);
  if (request.signal?.aborted) throw abortError();
  const maximum = Math.min(request.maxResponseBytes ?? 2 * 1024 * 1024, MAX_RESPONSE_BYTES);
  const timeout = Math.min(request.timeoutMs ?? 30_000, 120_000);
  if (!Number.isInteger(maximum) || maximum < 1 || !Number.isInteger(timeout) || timeout < 1) {
    throw new ModelPortError('INVALID_INPUT', 'Invalid transport limits.');
  }
  const body = request.body === undefined ? undefined : Buffer.from(request.body);
  if (body && body.length > 6 * 1024 * 1024) throw new ModelPortError('MEDIA_TOO_LARGE', 'The outbound request is too large.');
  const headers = { ...request.headers, 'accept-encoding': 'identity', 'user-agent': 'ModelPort/0.1' };
  if (body) Object.assign(headers, { 'content-length': String(body.length) });
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name + value) || ['host', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) {
      throw new ModelPortError('INVALID_INPUT', 'An unsafe outbound HTTP header was rejected.');
    }
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error instanceof ModelPortError ? error : new ModelPortError('PROVIDER_NETWORK', 'The provider request failed. No automatic retry was made; an inference request may still have been processed.', 502));
      return true;
    };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = send(url, {
      method: request.method ?? 'GET',
      headers,
      agent: false,
      lookup: publicLookup,
      maxHeaderSize: 16 * 1024,
    }, (response) => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        done(new ModelPortError('PROVIDER_REDIRECT', 'Provider redirects are blocked to protect credentials.', 502));
        response.destroy();
        return;
      }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maximum) {
        done(new ModelPortError('RESPONSE_TOO_LARGE', 'The provider response exceeds the allowed size.', 502));
        response.destroy();
        return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        done(new ModelPortError('UNSUPPORTED_ENCODING', 'Compressed provider responses are not accepted.', 502));
        response.destroy();
        return;
      }
      // A byte limit alone does not bound the number of tiny retained Buffers.
      // Copy into one bounded allocation instead of retaining each HTTP chunk.
      const storage = Buffer.allocUnsafe(maximum);
      let length = 0;
      response.on('data', (chunk: Buffer) => {
        if (length + chunk.length > maximum) {
          done(new ModelPortError('RESPONSE_TOO_LARGE', 'The provider response exceeds the allowed size.', 502));
          response.destroy();
        } else {
          chunk.copy(storage, length);
          length += chunk.length;
        }
      });
      response.on('error', (error) => done(error));
      response.on('aborted', () => done(new ModelPortError('PROVIDER_NETWORK', 'The provider response was interrupted. Do not automatically retry a possibly billed request.', 502)));
      response.on('end', () => {
        if (!done()) return;
        const responseHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') responseHeaders[name] = value;
        }
        resolve({ status, headers: responseHeaders, body: new Uint8Array(storage.subarray(0, length)) });
      });
    });
    const timer = setTimeout(() => {
      done(new ModelPortError('PROVIDER_TIMEOUT', 'The provider timed out. It may still process and bill the request. No automatic retry was made.', 504));
      outgoing.destroy();
    }, timeout);
    timer.unref();
    const onAbort = () => {
      done(abortError());
      outgoing.destroy();
    };
    outgoing.on('error', (error) => done(error));
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) {
      onAbort();
      return;
    }
    outgoing.end(body);
  });
};
