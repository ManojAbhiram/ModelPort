import { useState } from 'react';
import type { Connection, Operation, ProviderDefinition } from '@modelport/core';
import { ArrowRight, ArrowUpRight, Check, Search, SlidersHorizontal, Unplug } from 'lucide-react';
import { OPERATIONS, OPERATION } from '../content';
import { EmptyState, OperationTags, ProviderMark } from '../components/Shared';

interface Props {
  providers: ProviderDefinition[];
  connections: Connection[];
  onConnect: (provider: ProviderDefinition) => void;
}

export function ProviderLibrary({ providers, connections, onConnect }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ready' | 'planned'>('ready');
  const [category, setCategory] = useState<'all' | 'cloud' | 'local'>('all');
  const [operation, setOperation] = useState<Operation | 'all'>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = providers.filter((provider) => provider.status === status
    && (category === 'all' || provider.kind === category)
    && (operation === 'all' || provider.operations.includes(operation))
    && (!normalizedQuery || `${provider.name} ${provider.id} ${provider.description} ${provider.notes}`.toLocaleLowerCase().includes(normalizedQuery)));
  const readyCount = providers.filter((provider) => provider.status === 'ready').length;
  const plannedCount = providers.filter((provider) => provider.status === 'planned').length;
  const hasFilters = Boolean(query || category !== 'all' || operation !== 'all');

  function clearFilters() { setQuery(''); setCategory('all'); setOperation('all'); }

  return <div className="page provider-page">
    <section className="library-hero" aria-labelledby="library-title">
      <div>
        <p className="eyebrow">The provider library</p>
        <h1 id="library-title" tabIndex={-1}>Many models.<br /><em>One starting point.</em></h1>
        <p className="page-intro">Bring your own keys. Discover what each model can do.<br className="desktop-break" /> Take the first step without sending a prompt.</p>
      </div>
      <div className="hero-aside">
        <span className="hero-aside-label">A more deliberate workflow</span>
        <ol className="workflow-list">
          <li><span>01</span><div><strong>Connect a provider</strong><p>Your credentials, in local memory.</p></div></li>
          <li><span>02</span><div><strong>Inspect the possibilities</strong><p>Models, operations, and their sources.</p></div></li>
          <li><span>03</span><div><strong>Approve before you run</strong><p>One reviewed request. One attempt.</p></div></li>
        </ol>
      </div>
    </section>

    <section className="library-section" aria-label="Browse providers">
      <div className="library-tabs-row">
        <fieldset className="segmented-control">
          <legend className="sr-only">Provider availability</legend>
          <label><input type="radio" name="availability" checked={status === 'ready'} onChange={() => setStatus('ready')} /><span>Available <span className="tab-count">{readyCount}</span></span></label>
          <label><input type="radio" name="availability" checked={status === 'planned'} onChange={() => setStatus('planned')} /><span>Roadmap <span className="tab-count">{plannedCount}</span></span></label>
        </fieldset>
        <span className="registry-caption">From the local provider registry</span>
      </div>
      <div className="library-toolbar">
        <div className="search-field"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="provider-search">Search providers</label><input id="provider-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers..." /></div>
        <div className="filter-field"><label htmlFor="category-filter">Category</label><select id="category-filter" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">All categories</option><option value="cloud">Cloud providers</option><option value="local">Local endpoints</option></select></div>
        <div className="filter-field"><label htmlFor="operation-filter">Operation</label><select id="operation-filter" value={operation} onChange={(event) => setOperation(event.target.value as Operation | 'all')}><option value="all">All operations</option>{OPERATIONS.map((item) => <option value={item} key={item}>{OPERATION[item].label}</option>)}</select></div>
      </div>
      <div className="filter-summary"><p role="status">{filtered.length} {filtered.length === 1 ? 'provider' : 'providers'}{status === 'planned' ? ' on the roadmap' : ' available'}{hasFilters ? ' matching your filters' : ''}</p>{hasFilters && <button className="text-button" type="button" onClick={clearFilters}>Clear filters</button>}</div>

      {filtered.length === 0 ? <EmptyState icon={providers.length === 0 ? <Unplug size={26} /> : <SlidersHorizontal size={26} />} title={providers.length === 0 ? 'No providers in the registry.' : 'Nothing matches just yet.'} action={hasFilters ? <button className="button button-secondary" type="button" onClick={clearFilters}>Clear filters</button> : undefined}>
        <p>{providers.length === 0 ? 'The local server returned an empty registry. No providers have been invented or substituted.' : 'Try another search, category, or operation. Roadmap entries may not have implemented operations yet.'}</p>
      </EmptyState> : <div className="provider-grid">
        {filtered.map((provider) => {
          const connected = connections.some((connection) => connection.providerId === provider.id);
          return <article className={`provider-card${provider.status === 'planned' ? ' provider-card-planned' : ''}`} key={provider.id}>
            <div className="provider-card-top"><ProviderMark name={provider.name} kind={provider.kind} /><span className={`kind-label kind-${provider.kind}`}>{provider.kind === 'local' ? 'Local endpoint' : 'Cloud API'}</span></div>
            <div className="provider-card-title"><h2>{provider.name}</h2>{connected && <span className="connected-label"><Check size={13} aria-hidden="true" />Connected</span>}</div>
            <p className="provider-description">{provider.description}</p>
            {provider.operations.length > 0 ? <OperationTags operations={provider.operations} /> : <span className="provider-no-operations">No operations implemented</span>}
            <div className="provider-card-bottom">
              {provider.status === 'ready' ? <button className="button button-connect" type="button" onClick={() => onConnect(provider)} aria-label={`Connect ${provider.name}`}>{connected ? 'Add connection' : 'Connect'}<ArrowRight size={15} aria-hidden="true" /></button> : <span className="badge roadmap-badge">On the roadmap</span>}
              <a className="docs-link" href={provider.docsUrl} target="_blank" rel="noreferrer" aria-label={`${provider.name} documentation (opens in a new tab)`}>Docs<ArrowUpRight size={15} aria-hidden="true" /></a>
            </div>
            {provider.notes && <details className="provider-notes"><summary>Adapter notes</summary><p>{provider.notes}</p></details>}
          </article>;
        })}
      </div>}
      <p className="library-footnote">Available means the adapter is implemented, not that every model supports every operation. Connecting inspects metadata only; it does not prove credits, model access, or zero cost.</p>
    </section>
  </div>;
}
