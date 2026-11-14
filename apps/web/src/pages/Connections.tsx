import { useRef, useState } from 'react';
import type { Connection, Model, ProviderDefinition } from '@modelport/core';
import { ArrowRight, Cable, Plus, RefreshCw, Search, Unplug } from 'lucide-react';
import { errorMessage, request } from '../api';
import { CAPABILITY, formatDate } from '../content';
import { DeclareModelDialog } from '../components/DeclareModelDialog';
import { Dialog } from '../components/Dialog';
import { EmptyState, Notice, OperationTags, ProviderMark, SourceBadge, Spinner, VerificationBadge } from '../components/Shared';

interface Props {
  connections: Connection[];
  providers: ProviderDefinition[];
  csrfToken: string;
  onUpdate: (connection: Connection) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onPlay: (id: string) => void;
}

const MODEL_PAGE_SIZE = 50;

function ModelCatalog({ connection, onDeclare, canDeclare }: { connection: Connection; canDeclare: boolean; onDeclare: (model?: Model) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const models = connection.models.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(models.length / MODEL_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  if (page !== currentPage) setPage(currentPage);
  const visibleModels = models.slice((currentPage - 1) * MODEL_PAGE_SIZE, currentPage * MODEL_PAGE_SIZE);
  return <div className="model-catalog">
    <div className="model-toolbar"><div className="search-field search-field-small"><Search size={16} aria-hidden="true" /><label className="sr-only" htmlFor={`model-search-${connection.id}`}>Search models in {connection.name}</label><input id={`model-search-${connection.id}`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Filter model IDs..." aria-describedby={`model-page-${connection.id}`} /></div><button className="button button-secondary button-small" type="button" onClick={() => onDeclare()} disabled={!canDeclare}><Plus size={14} aria-hidden="true" />Declare a model</button></div>
    {connection.models.length === 0 ? <div className="catalog-empty"><h3>No model metadata returned.</h3><p>This provider may not expose a catalog. You can deliberately add a documented model ID and its supported operations. No capability is inferred from the name alone.</p></div>
      : models.length === 0 ? <p className="catalog-empty" role="status">No model IDs match this filter.</p>
        : <div className="table-scroll" role="region" aria-label={`${connection.name} model metadata`} aria-describedby={`model-page-${connection.id}`} tabIndex={0}><table className="model-table"><thead><tr><th scope="col">Model</th><th scope="col">Operations</th><th scope="col">Capability source</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleModels.map((model) => <tr key={model.id}><th scope="row"><span className="model-name">{model.name || model.id}</span>{model.name !== model.id && <code>{model.id}</code>}{model.contextWindow !== undefined && <span className="model-context">{model.contextWindow.toLocaleString()} token context</span>}</th><td>{model.operations.length > 0 ? <OperationTags operations={model.operations} /> : <span className="muted">Not established</span>}</td><td><SourceBadge source={model.capabilitySource} /></td><td><button className="text-button" type="button" onClick={() => onDeclare(model)} disabled={!canDeclare} aria-label={`Declare capabilities for ${model.id}`}>Declare</button></td></tr>)}</tbody></table></div>}
    <div className="catalog-pagination"><p id={`model-page-${connection.id}`} role="status" aria-atomic="true">{models.length.toLocaleString()} matching {models.length === 1 ? 'model' : 'models'}. Page {currentPage} of {pageCount}.</p><div role="group" aria-label={`Model pages in ${connection.name}`}><button className="button button-secondary button-small" type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>Previous</button><button className="button button-secondary button-small" type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount}>Next</button></div></div>
    <details className="provenance-key"><summary>What the capability sources mean</summary><dl>{Object.entries(CAPABILITY).map(([source, value]) => <div key={source}><dt>{value.label}</dt><dd>{value.description}</dd></div>)}</dl></details>
  </div>;
}

export function Connections({ connections, providers, csrfToken, onUpdate, onRemove, onAdd, onPlay }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [declaration, setDeclaration] = useState<{ connection: Connection; provider: ProviderDefinition; model?: Model } | null>(null);
  const [expandedCatalogs, setExpandedCatalogs] = useState<Record<string, boolean>>(() => Object.fromEntries(connections.map((connection) => [connection.id, connections.length === 1])));
  const busyRef = useRef(false);

  async function refresh(connection: Connection) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPendingId(connection.id);
    setFeedback(null);
    try {
      const response = await request<{ connection: Connection }>(`/api/connections/${encodeURIComponent(connection.id)}/refresh`, csrfToken, { method: 'POST' });
      onUpdate(response.connection);
      setFeedback({ message: `${connection.name}: metadata refreshed. No inference was run.`, error: false });
    } catch (error) { setFeedback({ message: errorMessage(error), error: true }); }
    finally { busyRef.current = false; setPendingId(null); }
  }

  async function disconnect() {
    if (!disconnecting || busyRef.current) return;
    busyRef.current = true;
    setPendingId(disconnecting.id);
    setDisconnectError(null);
    try {
      await request(`/api/connections/${encodeURIComponent(disconnecting.id)}`, csrfToken, { method: 'DELETE' });
      onRemove(disconnecting.id);
      setFeedback({ message: `${disconnecting.name} disconnected from this workbench.`, error: false });
      setDisconnecting(null);
    } catch (error) { setDisconnectError(errorMessage(error)); }
    finally { busyRef.current = false; setPendingId(null); }
  }

  return <div className="page connections-page">
    <div className="page-heading page-heading-with-action"><div><p className="eyebrow">Your workspace</p><h1 tabIndex={-1}>Connections, <em>not assumptions.</em></h1><p className="page-intro">Inspect what a provider reports. Keep track of what you know, and what you still need to verify.</p></div><button className="button button-primary" type="button" onClick={onAdd}><Plus size={17} aria-hidden="true" />Add connection</button></div>
    {feedback && <div aria-live="polite"><Notice tone={feedback.error ? 'error' : 'success'}>{feedback.message}</Notice></div>}
    {connections.length === 0 ? <EmptyState icon={<Cable size={29} />} title="No connections yet." action={<button className="button button-primary" type="button" onClick={onAdd}>Browse the provider library<ArrowRight size={16} aria-hidden="true" /></button>}><p>Connect a provider with your own credentials, or use a loopback endpoint. We will inspect metadata before you send a single prompt.</p></EmptyState>
      : <div className="connection-list">{connections.map((connection) => {
        const provider = providers.find((item) => item.id === connection.providerId);
        const expanded = expandedCatalogs[connection.id] ?? connections.length === 1;
        return <article className="connection-card" key={connection.id}>
          <header className="connection-header"><ProviderMark name={provider?.name ?? connection.providerId} kind={provider?.kind} /><div className="connection-title"><h2>{connection.name}</h2><p>{provider?.name ?? connection.providerId}<span aria-hidden="true"> / </span>Added {formatDate(connection.createdAt)}</p></div><VerificationBadge state={connection.verification.state} /></header>
          <div className="connection-verification"><p>{connection.verification.message}</p><span>Checked {formatDate(connection.verification.checkedAt)}. Inference not tested.</span></div>
          {connection.catalogWarning && <div className="connection-warning"><Notice tone="warning">{connection.catalogWarning}</Notice></div>}
          <div className="connection-actions"><button className="button button-secondary button-small" type="button" onClick={() => void refresh(connection)} disabled={pendingId !== null} aria-label={`Refresh metadata for ${connection.name}`}>{pendingId === connection.id && !disconnecting ? <Spinner label="Refreshing metadata" /> : <RefreshCw size={14} aria-hidden="true" />}Refresh metadata</button><button className="button button-secondary button-small" type="button" onClick={() => onPlay(connection.id)} disabled={pendingId !== null}>Open in playground<ArrowRight size={14} aria-hidden="true" /></button><button className="text-button text-button-danger" type="button" disabled={pendingId !== null} onClick={() => { setDisconnectError(null); setDisconnecting(connection); }} aria-label={`Disconnect ${connection.name}`}><Unplug size={14} aria-hidden="true" />Disconnect</button></div>
          <details className="catalog-disclosure" open={expanded} onToggle={(event) => { const open = event.currentTarget.open; setExpandedCatalogs((current) => current[connection.id] === open ? current : { ...current, [connection.id]: open }); }}><summary><span>Model catalog</span><span className="catalog-count">{connection.models.length} {connection.models.length === 1 ? 'model' : 'models'}</span></summary>{expanded && <ModelCatalog connection={connection} canDeclare={Boolean(provider && provider.operations.length > 0)} onDeclare={(model) => { if (provider) setDeclaration({ connection, provider, ...(model ? { model } : {}) }); }} />}</details>
        </article>;
      })}</div>}
    <div className="page-end-note"><p>Authentication is not entitlement. A catalog is not a successful model run. Refreshing replaces catalog metadata, including human declarations. Refreshing, declaring, or disconnecting invalidates pending approvals and never authorizes inference.</p></div>
    {declaration && <DeclareModelDialog {...declaration} csrfToken={csrfToken} onClose={() => setDeclaration(null)} onSave={(connection) => { onUpdate(connection); setDeclaration(null); setFeedback({ message: 'Model declaration saved as human-declared metadata. No inference was run.', error: false }); }} />}
    {disconnecting && <Dialog title={`Disconnect ${disconnecting.name}?`} description="Remove this connection and its key from the local workbench." onCancel={() => setDisconnecting(null)} busy={pendingId !== null}>
      <div className="modal-body form-stack">{disconnectError && <Notice tone="error">{disconnectError}</Notice>}<p>You will need to enter the key again to reconnect. This does not revoke the key at the provider or undo any previous usage.</p></div><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setDisconnecting(null)} disabled={pendingId !== null} data-autofocus>Keep connection</button><button className="button button-danger" type="button" onClick={() => void disconnect()} disabled={pendingId !== null}>{pendingId ? <><Spinner label="Disconnecting" />Disconnecting...</> : 'Disconnect'}</button></div>
    </Dialog>}
  </div>;
}
