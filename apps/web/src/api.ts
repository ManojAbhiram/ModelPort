export interface Session {
  csrfToken: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, csrfToken?: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'X-ModelPort-Client': 'workbench' };
  if (method !== 'GET') {
    if (!csrfToken) throw new ApiError('Start a local session before making changes.', 'SESSION_REQUIRED', 403);
    headers['X-CSRF-Token'] = csrfToken;
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the local API. Check that the ModelPort server is running.', 'NETWORK_ERROR', 0);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('The local server returned an unreadable response.', 'INVALID_RESPONSE', response.status);
  }
  if (!response.ok) {
    const detail = (data as { error?: { message?: unknown; code?: unknown } } | null)?.error;
    throw new ApiError(
      typeof detail?.message === 'string' ? detail.message : `The request was rejected (HTTP ${response.status}).`,
      typeof detail?.code === 'string' ? detail.code : 'REQUEST_FAILED',
      response.status,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return `${error.message} If your local session expired, reload the workbench before trying again.`;
  }
  return error instanceof Error ? error.message : 'Something went wrong. No automatic retry was made.';
}

export async function discardApproval(csrfToken: string, id: string): Promise<void> {
  try {
    await request(`/api/approvals/${encodeURIComponent(id)}`, csrfToken, { method: 'DELETE' });
  } catch (error) {
    // An already removed or expired approval cannot execute and needs no further deletion.
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}
