import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Connection, ConnectionConfig, ProviderDefinition } from '@manojabhiram/modelport-core';
import { ArrowUpRight, KeyRound, ShieldCheck } from 'lucide-react';
import { errorMessage, request } from '../api';
import { Dialog } from './Dialog';
import { Notice, Spinner } from './Shared';

interface Props {
  provider: ProviderDefinition;
  csrfToken: string;
  onClose: () => void;
  onSave: (connection: Connection) => void;
}

export function ConnectionDialog({ provider, csrfToken, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [workspaceId, setWorkspaceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyCleared, setKeyCleared] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    const input = keyRef.current;
    return () => { if (input) input.value = ''; };
  }, []);

  function close() {
    if (savingRef.current) return;
    if (keyRef.current) keyRef.current.value = '';
    onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const config: ConnectionConfig = {
      providerId: provider.id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(keyRef.current?.value.trim() ? { apiKey: keyRef.current.value.trim() } : {}),
      ...(provider.kind === 'local' ? { baseUrl: baseUrl.trim() } : {}),
      ...(provider.adapter === 'anthropic' && workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}),
    };
    if (provider.kind === 'cloud' && !config.apiKey) { setError('An API key is required for a cloud connection.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    if (keyRef.current) keyRef.current.value = '';
    setKeyCleared(true);
    try {
      const pending = request<{ connection: Connection }>('/api/connections', csrfToken, { method: 'POST', body: config });
      // The fetch body has been serialized. Do not retain a second copy in form state.
      delete config.apiKey;
      const { connection } = await pending;
      onSave(connection);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      delete config.apiKey;
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <Dialog title={`Connect ${provider.name}`} description="Inspect credentials and discover models. No prompt will be sent." onCancel={close} busy={saving}>
    <form onSubmit={(event) => void save(event)}>
      <div className="modal-body form-stack">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field"><label htmlFor="connection-name">Connection name <span className="optional">optional</span></label><input id="connection-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={provider.name} maxLength={80} disabled={saving} data-autofocus /></div>
        <div className="field"><div className="field-label-row"><label htmlFor="connection-key"><KeyRound size={14} aria-hidden="true" /> API key {provider.kind === 'local' && <span className="optional">optional</span>}</label>{provider.keyUrl && <a href={provider.keyUrl} target="_blank" rel="noreferrer">Provider key settings <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>}</div><input id="connection-key" ref={keyRef} type="password" name="provider-api-key" maxLength={4096} autoComplete="off" spellCheck={false} autoCapitalize="none" required={provider.kind === 'cloud'} disabled={saving} aria-describedby="key-help" /><p id="key-help" className="field-help">{keyCleared ? 'Key cleared after submission. Re-enter it if you need to try again.' : 'Held only for this submission. Never written to browser storage.'}</p></div>
        {provider.adapter === 'anthropic' && <div className="field"><label htmlFor="workspace-id">Anthropic workspace ID <span className="optional">if required</span></label><input id="workspace-id" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} maxLength={120} disabled={saving} autoComplete="off" spellCheck={false} aria-describedby="workspace-help" /><p id="workspace-help" className="field-help">Required by Anthropic for unscoped API keys. Use the workspace associated with your key.</p></div>}
        {provider.kind === 'local' && <div className="field"><label htmlFor="base-url">Local base URL</label><input id="base-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} maxLength={1024} required disabled={saving} autoComplete="off" spellCheck={false} aria-describedby="base-url-help" /><p id="base-url-help" className="field-help">Loopback only: use 127.0.0.1 or [::1], a port from 1024 to 65535, and the adapter's default base path. Remote hosts are rejected. A local endpoint may still relay requests to a cloud model.</p></div>}
        <div className="security-note"><ShieldCheck size={19} aria-hidden="true" /><p>Saved keys stay in the local server's memory until disconnect or restart. Metadata checks do not prove model entitlement, credits, or successful inference.</p></div>
        <p className="field-help">Metadata inspection does not generate content. It is not a guarantee of zero provider charges.</p>
      </div>
      <div className="modal-actions"><button className="button button-secondary" type="button" onClick={close} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? <><Spinner label="Inspecting metadata" />Inspecting metadata...</> : 'Connect & inspect'}</button></div>
    </form>
  </Dialog>;
}
