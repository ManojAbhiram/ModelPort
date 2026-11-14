import { useEffect, useRef, useState } from 'react';
import type { Connection, ProviderDefinition } from '@modelport/core';
import { ArrowUpRight, BookOpen, Cable, Check, ChevronRight, FlaskConical, LayoutGrid, ShieldCheck, X } from 'lucide-react';
import { errorMessage, request } from './api';
import type { Session } from './api';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Notice, Spinner } from './components/Shared';
import { ProviderLibrary } from './pages/ProviderLibrary';
import { Connections } from './pages/Connections';
import { Playground } from './pages/Playground';
import { IntegrationGuide } from './pages/IntegrationGuide';

type Page = 'providers' | 'connections' | 'playground' | 'guide';
const PAGES = [
  { id: 'providers', label: 'Provider library', icon: LayoutGrid },
  { id: 'connections', label: 'Connections', icon: Cable },
  { id: 'playground', label: 'Playground', icon: FlaskConical },
  { id: 'guide', label: 'Integration guide', icon: BookOpen },
] as const;

function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return PAGES.find((page) => page.id === hash)?.id ?? 'providers';
}

export function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [session, setSession] = useState<Session | null>(null);
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [connecting, setConnecting] = useState<ProviderDefinition | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(page);
  const sessionRequest = useRef<Promise<Session> | null>(null);

  useEffect(() => {
    const onLocation = () => setPage(currentPage());
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    return () => {
      window.removeEventListener('popstate', onLocation);
      window.removeEventListener('hashchange', onLocation);
    };
  }, []);

  useEffect(() => {
    document.title = `${PAGES.find((item) => item.id === page)?.label ?? 'Workbench'} | ModelPort`;
    if (previousPage.current !== page) {
      mainRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    previousPage.current = page;
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setSession(null);
    async function bootstrap() {
      try {
        // Keep one bootstrap promise in React memory across StrictMode's effect remount.
        sessionRequest.current ??= request<Session>('/api/session');
        const nextSession = await sessionRequest.current;
        if (controller.signal.aborted) return;
        if (!nextSession.csrfToken) throw new Error('The local server did not establish a workbench session.');
        const [providerData, connectionData] = await Promise.all([
          request<{ providers: ProviderDefinition[] }>('/api/providers', nextSession.csrfToken, { signal: controller.signal }),
          request<{ connections: Connection[] }>('/api/connections', nextSession.csrfToken, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setProviders(providerData.providers);
        setConnections(connectionData.connections);
        setSession(nextSession);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void bootstrap();
    return () => controller.abort();
  }, [reload]);

  function navigate(nextPage: Page, connectionId?: string) {
    if (connectionId) setSelectedConnectionId(connectionId);
    setPage(nextPage);
    setNotice('');
    if (window.location.hash !== `#${nextPage}`) window.history.pushState(null, '', `#${nextPage}`);
  }

  function updateConnection(connection: Connection) {
    setConnections((current) => current.some((item) => item.id === connection.id)
      ? current.map((item) => item.id === connection.id ? connection : item)
      : [...current, connection]);
  }

  const pageLabel = PAGES.find((item) => item.id === page)?.label;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); mainRef.current?.scrollIntoView({ block: 'start' }); }}>Skip to content</a>
    <aside className="sidebar">
      <a href="#providers" className="brand" onClick={(event) => { event.preventDefault(); navigate('providers'); }} aria-label="ModelPort provider library">
        <img src="/favicon.svg" width="38" height="38" alt="" />
        <span>ModelPort<span className="brand-caption">The integration workbench</span></span>
      </a>
      <div className="sidebar-section-label">Workspace</div>
      <nav aria-label="Main navigation" className="main-nav">
        {PAGES.map(({ id, label, icon: Icon }) => <a
          key={id}
          href={`#${id}`}
          aria-current={page === id ? 'page' : undefined}
          onClick={(event) => { event.preventDefault(); navigate(id); }}
        >
          <Icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
          {id === 'connections' && connections.length > 0 && !loading && <span className="nav-count">{connections.length}</span>}
        </a>)}
      </nav>
      <div className="sidebar-note">
        <ShieldCheck size={22} strokeWidth={1.5} aria-hidden="true" />
        <h2>Your keys.<br />Your call.</h2>
        <p>Local-first by design. Every model request starts with your approval.</p>
        <a href="#guide" onClick={(event) => { event.preventDefault(); navigate('guide'); }}>How it works <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div>
      <div className="sidebar-footer"><span className="status-dot" aria-hidden="true" /> Local-first / Open source</div>
    </aside>

    <div className="workspace">
      <header className="workspace-bar">
        <span className="breadcrumb">Workbench <ChevronRight size={14} aria-hidden="true" /> <span>{pageLabel}</span></span>
        <span className={`session-indicator${loadError ? ' session-unavailable' : ''}`}>
          {loading ? <Spinner label="Starting session" /> : <span className="status-dot" aria-hidden="true" />}
          {loading ? 'Starting local session' : loadError ? 'Server unavailable' : 'Local session active'}
        </span>
      </header>
      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {notice && <div className="toast" role="status"><Check size={17} aria-hidden="true" /><span>{notice}</span><button className="icon-button" type="button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} aria-hidden="true" /></button></div>}
        {loading ? <div className="page-loading" role="status" aria-live="polite"><Spinner label="Loading workbench" /><h1 tabIndex={-1}>Opening your workbench.</h1><p>Establishing a local session and reading provider metadata. No inference is running.</p></div>
          : loadError || !session ? <div className="page-error"><h1 tabIndex={-1}>The workbench is offline.</h1><Notice tone="error">{loadError ?? 'A local session could not be established.'}</Notice><p>Start the ModelPort server, then reconnect. No provider request has been executed.</p><button className="button button-primary" type="button" onClick={() => { sessionRequest.current = null; setReload((value) => value + 1); }}>Reconnect to local server</button></div>
          : <>
            {page === 'providers' && <ProviderLibrary providers={providers} connections={connections} onConnect={setConnecting} />}
            {page === 'connections' && <Connections providers={providers} connections={connections} csrfToken={session.csrfToken} onUpdate={updateConnection} onRemove={(id) => setConnections((current) => current.filter((item) => item.id !== id))} onAdd={() => navigate('providers')} onPlay={(id) => navigate('playground', id)} />}
            {page === 'playground' && <Playground providers={providers} connections={connections} csrfToken={session.csrfToken} initialConnectionId={selectedConnectionId} onAdd={() => navigate('providers')} onManage={(id) => navigate('connections', id)} />}
            {page === 'guide' && <IntegrationGuide />}
          </>}
      </main>
      <footer className="workspace-footer"><span>ModelPort</span><span>Connect deliberately. Build with confidence.</span></footer>
    </div>
    {connecting && session && <ConnectionDialog provider={connecting} csrfToken={session.csrfToken} onClose={() => setConnecting(null)} onSave={(connection) => {
      updateConnection(connection);
      setConnecting(null);
      navigate('connections');
      setNotice(`${connection.name} connected. Metadata inspected; no inference run.`);
    }} />}
  </div>;
}
