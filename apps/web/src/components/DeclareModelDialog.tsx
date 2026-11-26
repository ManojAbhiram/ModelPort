import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Connection, Model, Operation, ProviderDefinition } from '@manojabhiram/modelport-core';
import { errorMessage, request } from '../api';
import { OPERATION } from '../content';
import { Dialog } from './Dialog';
import { Notice, Spinner } from './Shared';

interface Props {
  connection: Connection;
  provider: ProviderDefinition;
  model?: Model;
  csrfToken: string;
  onClose: () => void;
  onSave: (connection: Connection) => void;
}

export function DeclareModelDialog({ connection, provider, model, csrfToken, onClose, onSave }: Props) {
  const [id, setId] = useState(model?.id ?? '');
  const [operations, setOperations] = useState<Operation[]>(model?.operations.filter((operation) => provider.operations.includes(operation)) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!id.trim() || operations.length === 0) { setError('Enter a model ID and select at least one supported operation.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await request<{ connection: Connection }>(`/api/connections/${encodeURIComponent(connection.id)}/models`, csrfToken, { method: 'POST', body: { id: id.trim(), operations } });
      onSave(response.connection);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <Dialog title={model ? 'Declare model capabilities' : 'Add a model declaration'} description={`For ${connection.name}. This saves metadata, not an inference request.`} onCancel={onClose} busy={saving}>
    <form onSubmit={(event) => void save(event)}>
      <div className="modal-body form-stack">
        {error && <Notice tone="error">{error}</Notice>}
        <Notice tone="warning" title="A declaration is your assertion."><p>Check the provider's documentation before choosing operations. This does not verify model access, available credits, or actual behavior. Saving an existing ID replaces its capabilities with your declaration.</p></Notice>
        <div className="field"><label htmlFor="declared-model-id">Exact model ID</label><input id="declared-model-id" value={id} onChange={(event) => setId(event.target.value)} required maxLength={200} autoComplete="off" spellCheck={false} disabled={saving} data-autofocus /><p className="field-help">Use the exact ID accepted by this provider, not a display name.</p></div>
        <fieldset className="operation-checkboxes" disabled={saving}><legend>Operations you are declaring</legend><p className="field-help">Only operations implemented by the {provider.name} adapter are offered.</p>{provider.operations.map((operation) => <label key={operation}><input type="checkbox" checked={operations.includes(operation)} onChange={(event) => setOperations((current) => event.target.checked ? [...current, operation] : current.filter((item) => item !== operation))} /><span>{OPERATION[operation].label}</span></label>)}</fieldset>
        <p className="field-help">Capability provenance will be marked <strong>Human-declared</strong>.</p>
      </div>
      <div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || operations.length === 0}>{saving ? <><Spinner label="Saving declaration" />Saving...</> : 'Save declaration'}</button></div>
    </form>
  </Dialog>;
}
