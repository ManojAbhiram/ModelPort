import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Approval } from '@modelport/core';
import { Check, LockKeyhole } from 'lucide-react';
import { CAPABILITY, formatDate, OPERATION } from '../content';
import { Dialog } from './Dialog';
import { Notice, SourceBadge, Spinner, VerificationBadge } from './Shared';

interface Props {
  approval: Approval;
  payloadBytes: number;
  phase: 'idle' | 'preparing' | 'executing' | 'discarding';
  error: string | null;
  cancelRequested: boolean;
  onCancel: () => void;
  onExecute: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

export function ApprovalDialog({ approval, payloadBytes, phase, error, cancelRequested, onCancel, onExecute, returnFocusRef }: Props) {
  const [consent, setConsent] = useState(false);
  const [now, setNow] = useState(Date.now());
  const expiresAt = Date.parse(approval.expiresAt);
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now;
  const busy = phase === 'executing' || phase === 'discarding';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <Dialog title={phase === 'executing' ? 'Running your approved request' : 'Review this request'} description={phase === 'executing' ? 'One approved attempt is in progress. No automatic retries or model fallbacks.' : 'Nothing has run yet. This immutable approval can authorize one attempt only.'} onCancel={onCancel} busy={busy} wide focusTitle returnFocusRef={returnFocusRef}>
    <div className="modal-body approval-body">
      <div className="approval-security-line"><LockKeyhole size={15} aria-hidden="true" /><span>Server-issued approval / Expires {formatDate(approval.expiresAt)}</span></div>
      {error && <Notice tone="error">{error}</Notice>}
      {expired && phase !== 'executing' && <div role="status"><Notice tone="warning">This approval has expired. Discard it and review a new request. The server is authoritative about expiration and reuse.</Notice></div>}
      <dl className="approval-facts">
        <div><dt>Provider</dt><dd>{approval.providerName}<code>{approval.providerId}</code></dd></div>
        <div className="approval-fact-wide"><dt>Destination base URL</dt><dd><code>{approval.destination}</code><span className="approval-fact-note">The adapter appends the operation path. Local endpoints may forward requests to cloud services.</span></dd></div>
        <div><dt>Model</dt><dd><code>{approval.modelId}</code></dd></div>
        <div><dt>Operation</dt><dd>{OPERATION[approval.operation].label}<code>{approval.operation}</code></dd></div>
        <div><dt>Capability provenance</dt><dd><SourceBadge source={approval.capabilitySource} /></dd></div>
        <div className="approval-fact-wide"><dt>Verification state</dt><dd><VerificationBadge state={approval.verificationState} /><span className="approval-fact-note">Metadata only. Inference, entitlement, and available credits are not verified.</span></dd></div>
        <div><dt>Voice ID</dt><dd><code>{approval.operation === 'tts' ? approval.voice ?? 'Not supplied by server' : 'Not applicable'}</code></dd></div>
        <div><dt>Maximum output tokens</dt><dd>{approval.maxOutputTokens !== undefined ? approval.maxOutputTokens.toLocaleString() : approval.operation === 'text' || approval.operation === 'vision' ? 'Not supplied by server' : 'Not applicable'}</dd></div>
        <div><dt>Text input size</dt><dd>{approval.inputCharacters.toLocaleString()} characters</dd></div>
        <div><dt>Media payload</dt><dd>{approval.mediaBytes.toLocaleString()} decoded bytes{approval.mediaType && <code>{approval.mediaType}</code>}</dd></div>
        <div className="approval-fact-wide"><dt>Workbench request body</dt><dd>{payloadBytes.toLocaleString()} bytes of JSON, including any inline base64<span className="approval-fact-note">Provider-specific request encoding can differ. This is not a price estimate.</span></dd></div>
      </dl>
      <p className="approval-source-note">{CAPABILITY[approval.capabilitySource].description}</p>
      <section className="approval-preview" aria-label="Complete text input"><h3>Complete text input</h3><pre tabIndex={0}>{approval.inputPreview || 'No text input. Inspect the attached media details above.'}</pre><p>Complete text from the server-held request. Scroll to inspect every line before approving.</p></section>
      <Notice tone="warning" title="This request may incur charges."><p>{approval.billingNotice}</p><p>Exact cost is unknown. No automatic retries or model fallbacks. Local execution also uses resources and can be cloud-backed.</p></Notice>
      <label className="consent-control"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || expired || cancelRequested} /><span>I approve sending this request and its attached media to <strong>{approval.providerName}</strong>, and accept the possibility of provider charges.</span></label>
      {phase === 'executing' && <div className="execution-status" role="status"><Spinner label="Executing approved request" /><p>Request sent. Waiting for the provider. No retry will be made; closing this browser would not undo execution.</p></div>}
    </div>
    <div className="modal-actions approval-actions"><button className="button button-secondary" type="button" onClick={onCancel} disabled={busy} data-autofocus>{phase === 'discarding' ? <><Spinner label="Discarding approval" />Discarding...</> : cancelRequested ? 'Try discarding again' : 'Cancel review'}</button><button className="button button-primary" type="button" disabled={busy || !consent || expired || cancelRequested} onClick={onExecute}>{phase === 'executing' ? <><Spinner label="Running once" />Running once...</> : <><Check size={17} aria-hidden="true" />Approve & run</>}</button></div>
  </Dialog>;
}
