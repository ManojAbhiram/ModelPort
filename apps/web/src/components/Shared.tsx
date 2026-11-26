import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CapabilitySource, Operation, Verification } from '@manojabhiram/modelport-core';
import { AlertCircle, Check, Copy, Info, LoaderCircle } from 'lucide-react';
import { CAPABILITY, OPERATION, VERIFICATION } from '../content';

export function Spinner({ label = 'Working' }: { label?: string }) {
  return <LoaderCircle size={16} className="spinner" role="img" aria-label={label} />;
}

export function Notice({ children, tone = 'info', title }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success'; title?: string }) {
  const Icon = tone === 'error' || tone === 'warning' ? AlertCircle : tone === 'success' ? Check : Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div>{title && <strong>{title}</strong>}{children}</div>
    </div>
  );
}

export function OperationTags({ operations }: { operations: Operation[] }) {
  return <span className="operation-tags">{operations.map((operation) => {
    const meta = OPERATION[operation];
    const Icon = meta.icon;
    return <span className="operation-tag" key={operation} title={meta.label}><Icon size={13} aria-hidden="true" />{meta.short}</span>;
  })}</span>;
}

export function SourceBadge({ source }: { source: CapabilitySource }) {
  return <span className={`badge source-${source}`} title={CAPABILITY[source].description}>{CAPABILITY[source].label}</span>;
}

export function VerificationBadge({ state }: { state: Verification['state'] }) {
  return <span className={`badge verification-${state}`}><span className="status-dot" aria-hidden="true" />{VERIFICATION[state]}</span>;
}

export function ProviderMark({ name, kind = 'cloud' }: { name: string; kind?: 'cloud' | 'local' }) {
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2);
  return <span className={`provider-mark provider-mark-${kind}`} aria-hidden="true">{letters || 'M'}</span>;
}

export function CopyButton({ text, label = 'Copy code' }: { text: string; label?: string }) {
  const [feedback, setFeedback] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  async function copy() {
    clearTimeout(timeout.current);
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('copied');
    } catch {
      setFeedback('error');
    }
    timeout.current = setTimeout(() => setFeedback('idle'), 4000);
  }

  return <span className="copy-control">
    <button className="button button-quiet button-small" type="button" onClick={() => void copy()}>
      {feedback === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {feedback === 'copied' ? 'Copied' : label}
    </button>
    <span className={feedback === 'error' ? 'copy-error' : 'sr-only'} role="status">
      {feedback === 'copied' ? 'Copied to clipboard.' : feedback === 'error' ? 'Clipboard unavailable. The code can be selected manually.' : ''}
    </span>
  </span>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state">
    <span className="empty-icon" aria-hidden="true">{icon}</span>
    <h2>{title}</h2>
    <div className="empty-description">{children}</div>
    {action}
  </div>;
}
