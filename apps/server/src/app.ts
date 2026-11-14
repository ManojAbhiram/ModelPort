import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import { ModelPort, ModelPortError, OPERATIONS, PROVIDERS } from '@modelport/core';
import type { ConnectionConfig, RunInput } from '@modelport/core';

interface Session { id: string; csrf: string; expiresAt: number }
interface AppOptions {
  modelPort?: ModelPort;
  development?: boolean;
  serveWeb?: boolean;
  port?: number;
  now?: () => number;
}

function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ModelPortError('INVALID_INPUT', 'Invalid request fields or unsupported options.');
  return result.data;
}

function matchesSecret(value: unknown, expected: string): boolean {
  if (typeof value !== 'string' || value.length !== expected.length) return false;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

async function inspectForClient<T>(request: FastifyRequest, reply: FastifyReply, inspect: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onClose = () => { if (!reply.raw.writableFinished) abort(); };
  request.raw.once('aborted', abort);
  reply.raw.once('close', onClose);
  if (request.raw.aborted || reply.raw.destroyed) abort();
  try {
    return await inspect(controller.signal);
  } finally {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', onClose);
  }
}

export async function buildApp(options: AppOptions = {}) {
  const port = options.port ?? 8787;
  const now = options.now ?? Date.now;
  const modelPort = options.modelPort ?? new ModelPort();
  const sessions = new Map<string, Session>();
  const cookieName = `modelport_session_${port}`;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (options.development) {
    hosts.add('127.0.0.1:5173');
    hosts.add('localhost:5173');
  }
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 6 * 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 130_000,
    keepAliveTimeout: 5_000,
  });

  const readSession = (cookie?: string): Session | undefined => {
    const token = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const session = token ? sessions.get(token) : undefined;
    if (session && session.expiresAt > now()) return session;
    if (session) sessions.delete(session.id);
    return undefined;
  };

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'blob:', 'data:'], mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"],
        baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const host = request.headers.host?.toLowerCase();
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if (!host || !hosts.has(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) {
      throw new ModelPortError('LOCAL_ONLY', 'This workbench only accepts approved loopback hosts.', 403);
    }
    if ((origin !== undefined && !origins.has(origin)) || (fetchSite !== undefined && !['same-origin', 'none'].includes(String(fetchSite)))) {
      throw new ModelPortError('ORIGIN_REJECTED', 'Cross-origin access to the local workbench is not allowed.', 403);
    }
    const route = request.routeOptions.url ?? request.url.split('?')[0] ?? '/';
    if (!route.startsWith('/api/')) return;
    if (route === '/api/health' && request.method === 'GET') return;
    if (route === '/api/session' && request.method === 'GET') {
      if (request.headers['x-modelport-client'] !== 'workbench') {
        throw new ModelPortError('CLIENT_HEADER_REQUIRED', 'Open the workbench to create a local browser session.', 403);
      }
      return;
    }
    const session = readSession(request.headers.cookie);
    if (!session) throw new ModelPortError('SESSION_REQUIRED', 'The local session is missing or expired. Reload the workbench.', 401);
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (!matchesSecret(request.headers['x-csrf-token'], session.csrf)) {
        throw new ModelPortError('CSRF_REJECTED', 'The request does not carry a valid session approval token.', 403);
      }
      if (request.method === 'POST' && request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        throw new ModelPortError('CONTENT_TYPE_REJECTED', 'Mutating requests must use application/json.', 415);
      }
    }
  });
  await app.register(rateLimit, { max: 120, timeWindow: 60_000 });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ModelPortError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 413) return reply.code(413).send({ error: { code: 'BODY_TOO_LARGE', message: 'The request is too large. Media uploads are limited to 4 MiB.' } });
    if (status === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many local requests. Wait before trying again.' } });
    if (status >= 400 && status < 500) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'The request could not be parsed or validated.' } });
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'The request failed safely. No raw provider error or credential has been exposed.' } });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0', localOnly: true }));
  app.get('/api/session', async (request, reply) => {
    for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
    let session = readSession(request.headers.cookie);
    if (!session) {
      if (sessions.size >= 16) throw new ModelPortError('SESSION_LIMIT', 'Too many local browser sessions. Restart the workbench to clear them.', 429);
      session = { id: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'), expiresAt: now() + 8 * 60 * 60_000 };
      sessions.set(session.id, session);
    }
    reply.header('Set-Cookie', `${cookieName}=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((session.expiresAt - now()) / 1000))}`);
    return { csrfToken: session.csrf, expiresAt: new Date(session.expiresAt).toISOString() };
  });
  app.get('/api/providers', async () => ({ providers: PROVIDERS }));
  app.get('/api/connections', async () => ({ connections: modelPort.getConnections() }));
  app.post('/api/connections', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => ({
    connection: await inspectForClient(request, reply, (signal) => modelPort.connect(request.body as ConnectionConfig, { signal })),
  }));

  const idFrom = (value: unknown) => checked(z.strictObject({ id: z.string().uuid() }), value).id;
  app.post('/api/connections/:id/refresh', { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (request, reply) => {
    checked(z.strictObject({}), request.body);
    return { connection: await inspectForClient(request, reply, (signal) => modelPort.refresh(idFrom(request.params), { signal })) };
  });
  app.post('/api/connections/:id/models', async (request) => ({
    connection: modelPort.declareModel(idFrom(request.params), checked(z.strictObject({ id: z.string(), operations: z.array(z.enum(OPERATIONS)) }), request.body)),
  }));
  app.delete('/api/connections/:id', async (request) => {
    modelPort.disconnect(idFrom(request.params));
    return { ok: true };
  });

  const scopeFor = (cookie?: string) => ({ scope: readSession(cookie)!.id });
  app.get('/api/approvals', async (request) => ({ approvals: modelPort.listApprovals(scopeFor(request.headers.cookie)) }));
  app.post('/api/approvals', async (request) => ({
    approval: modelPort.prepare(request.body as RunInput, scopeFor(request.headers.cookie)),
  }));
  app.delete('/api/approvals/:id', async (request) => {
    modelPort.cancel(idFrom(request.params), scopeFor(request.headers.cookie));
    return { ok: true };
  });
  app.post('/api/approvals/:id/execute', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (request) => {
    checked(z.strictObject({ consent: z.literal(true) }), request.body);
    return { result: await modelPort.execute(idFrom(request.params), { consent: true, ...scopeFor(request.headers.cookie) }) };
  });

  if (options.serveWeb !== false && !options.development) {
    await app.register(staticFiles, { root: fileURLToPath(new URL('../../web/dist/', import.meta.url)), index: 'index.html', maxAge: 0 });
  }
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'This route does not exist.' } }));
  app.addHook('onClose', async () => {
    modelPort.dispose();
    sessions.clear();
  });
  return app;
}
