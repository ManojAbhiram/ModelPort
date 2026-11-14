import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, discardApproval, request } from '../api';

afterEach(() => vi.unstubAllGlobals());

describe('workbench HTTP boundary', () => {
  it('bootstraps with the client header and same-origin credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ csrfToken: 'session-token' }));
    vi.stubGlobal('fetch', fetch);
    await request('/api/session');
    expect(fetch).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-ModelPort-Client': 'workbench' },
    }));
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it.each(['POST', 'DELETE'] as const)('sends CSRF and JSON for %s mutations', async (method) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await request('/api/connections/id', 'session-token', { method });
    expect(fetch).toHaveBeenCalledWith('/api/connections/id', expect.objectContaining({
      method, body: '{}', credentials: 'same-origin',
      headers: { 'X-ModelPort-Client': 'workbench', 'X-CSRF-Token': 'session-token', 'Content-Type': 'application/json' },
    }));
  });

  it('refuses mutations without a React session token before fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(request('/api/approvals/id/execute', undefined, { method: 'POST', body: { consent: true } })).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry an execution when a network request fails', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Network failure'));
    vi.stubGlobal('fetch', fetch);
    await expect(request('/api/approvals/id/execute', 'session-token', { method: 'POST', body: { consent: true } })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps server error codes and preserves aborts', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 'APPROVAL_NOT_FOUND', message: 'Already consumed.' } }, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(request('/api/approvals/id/execute', 'session-token', { method: 'POST' })).rejects.toMatchObject({ name: 'ApiError', status: 404, code: 'APPROVAL_NOT_FOUND', message: 'Already consumed.' });
    const abort = new DOMException('Aborted', 'AbortError');
    fetch.mockRejectedValue(abort);
    await expect(request('/api/providers')).rejects.toBe(abort);
  });

  it('treats absent approvals as discarded but surfaces failed deletion', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 'APPROVAL_NOT_FOUND', message: 'Gone.' } }, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(discardApproval('session-token', 'approval/id')).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/approvals/approval%2Fid');
    fetch.mockResolvedValue(Response.json({ error: { message: 'Session expired.' } }, { status: 403 }));
    await expect(discardApproval('session-token', 'id')).rejects.toBeInstanceOf(ApiError);
  });
});
