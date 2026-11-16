import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Approval, Connection, Operation, ProviderDefinition, RunInput, RunResult } from '@modelport/core';
import { inputMediaTypes, isBlockedModel } from '@modelport/core/policy';
import { ArrowRight, FileAudio, FileImage, FlaskConical, LockKeyhole, Upload as UploadIcon, X } from 'lucide-react';
import { discardApproval, errorMessage, request } from '../api';
import { CAPABILITY, formatBytes, OPERATION, OPERATIONS } from '../content';
import { readUpload } from '../media';
import type { Upload } from '../media';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { ResultPanel } from '../components/ResultPanel';
import { RunArtifacts } from '../components/RunArtifacts';
import { EmptyState, Notice, SourceBadge, Spinner, VerificationBadge } from '../components/Shared';

interface Props {
  connections: Connection[];
  providers: ProviderDefinition[];
  csrfToken: string;
  initialConnectionId?: string;
  onAdd: () => void;
  onManage: (id: string) => void;
}

interface RequestForm {
  connectionId: string;
  operation: Operation;
  modelId: string;
  text: string;
  voice: string;
  maxOutputTokens: string;
}

type Phase = 'idle' | 'preparing' | 'executing' | 'discarding';

export function Playground({ connections, providers, csrfToken, initialConnectionId, onAdd, onManage }: Props) {
  const initialConnection = connections.find((connection) => connection.id === initialConnectionId) ?? connections[0];
  const initialProvider = providers.find((provider) => provider.id === initialConnection?.providerId);
  const [form, setForm] = useState<RequestForm>({
    connectionId: initialConnection?.id ?? '',
    operation: initialProvider?.operations.includes('text') ? 'text' : initialProvider?.operations[0] ?? 'text',
    modelId: '', text: '', voice: initialProvider?.defaultVoice ?? '', maxOutputTokens: '512',
  });
  const [upload, setUpload] = useState<Upload | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [approval, setApproval] = useState<Approval | null>(null);
  const [payloadBytes, setPayloadBytes] = useState(0);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [completedApproval, setCompletedApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef<Phase>('idle');
  const approvalRef = useRef<Approval | null>(null);
  const revision = useRef(0);
  const fileRevision = useRef(0);
  const mounted = useRef(true);
  const connection = connections.find((item) => item.id === form.connectionId);
  const provider = providers.find((item) => item.id === connection?.providerId);
  const compatibleModels = connection?.models.filter((model) => model.capabilitySource !== 'unknown' && model.operations.includes(form.operation) && provider?.operations.includes(form.operation) && !isBlockedModel(provider.id, model.id)) ?? [];
  const model = compatibleModels.find((item) => item.id === form.modelId);
  const needsMedia = form.operation === 'vision' || form.operation === 'stt';
  const mediaTypes = inputMediaTypes(provider?.id ?? '', form.operation);
  const usesTokens = form.operation === 'text' || form.operation === 'vision';
  const locked = phase !== 'idle' || approval !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileRevision.current += 1;
      const pending = approvalRef.current;
      approvalRef.current = null;
      // Server expiry and single-use enforcement remain authoritative if teardown loses the network.
      if (pending) void discardApproval(csrfToken, pending.id).catch(() => {});
    };
  }, [csrfToken]);

  function invalidate() {
    revision.current += 1;
    setResult(null);
    setCompletedApproval(null);
    setError(null);
    setStatus('');
    setReviewError(null);
    const stale = approvalRef.current;
    approvalRef.current = null;
    setApproval(null);
    if (stale) void discardApproval(csrfToken, stale.id).catch((failure: unknown) => {
      if (mounted.current) setError(`The previous review was cleared locally, but its deletion could not be confirmed. It cannot run from this screen. ${errorMessage(failure)}`);
    });
  }

  function changeForm(patch: Partial<RequestForm>) {
    invalidate();
    setForm((current) => ({ ...current, ...patch }));
  }

  function clearUpload() {
    fileRevision.current += 1;
    setUpload(null);
    setFileError(null);
    setReadingFile(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function changeConnection(id: string) {
    const next = connections.find((item) => item.id === id);
    const nextProvider = providers.find((item) => item.id === next?.providerId);
    clearUpload();
    changeForm({ connectionId: id, modelId: '', operation: nextProvider?.operations.includes('text') ? 'text' : nextProvider?.operations[0] ?? 'text', voice: nextProvider?.defaultVoice ?? '' });
  }

  function changeOperation(operation: Operation) {
    clearUpload();
    changeForm({ operation, modelId: '', voice: provider?.defaultVoice ?? '' });
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !provider) return;
    invalidate();
    clearUpload();
    const fileVersion = fileRevision.current;
    setReadingFile(true);
    try {
      const nextUpload = await readUpload(file, form.operation === 'vision' ? 'image' : 'audio', provider.id);
      if (mounted.current && fileVersion === fileRevision.current) {
        invalidate();
        setUpload(nextUpload);
      }
    } catch (failure) {
      if (mounted.current && fileVersion === fileRevision.current) setFileError(errorMessage(failure));
    } finally {
      if (mounted.current && fileVersion === fileRevision.current) setReadingFile(false);
    }
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phaseRef.current !== 'idle' || readingFile || approvalRef.current) return;
    setError(null);
    if (!connection || !provider || provider.status !== 'ready' || !provider.operations.includes(form.operation)) { setError('Choose an available connection and an operation implemented by its adapter.'); return; }
    if (!model) { setError('Choose a model with established capabilities for this operation. Refresh or declare metadata in Connections first.'); return; }
    if (form.operation !== 'stt' && !form.text.trim()) { setError('Enter text for this operation before reviewing the request.'); return; }
    if (needsMedia && !upload) { setFileError('Choose a supported file before reviewing this request.'); return; }
    const maxOutputTokens = Number(form.maxOutputTokens);
    if (usesTokens && (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4096)) { setError('Maximum output tokens must be a whole number from 1 to 4096.'); return; }
    const voice = form.voice.trim() || provider.defaultVoice;
    if (form.operation === 'tts' && !voice) { setError('Enter a voice ID. This provider does not define a default voice.'); return; }
    const input: RunInput = {
      connectionId: connection.id,
      modelId: model.id,
      operation: form.operation,
      ...(form.operation !== 'stt' ? { text: form.text } : {}),
      ...(needsMedia && upload ? { media: upload.media } : {}),
      ...(usesTokens ? { maxOutputTokens } : {}),
      ...(form.operation === 'tts' ? { voice } : {}),
    };
    invalidate();
    const version = revision.current;
    const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    phaseRef.current = 'preparing';
    setPhase('preparing');
    try {
      const response = await request<{ approval: Approval }>('/api/approvals', csrfToken, { method: 'POST', body: input });
      if (!mounted.current || version !== revision.current) {
        await discardApproval(csrfToken, response.approval.id);
        return;
      }
      approvalRef.current = response.approval;
      setApproval(response.approval);
      setPayloadBytes(bytes);
      setCancelRequested(false);
    } catch (failure) {
      if (mounted.current && version === revision.current) setError(errorMessage(failure));
    } finally {
      phaseRef.current = 'idle';
      if (mounted.current) setPhase('idle');
    }
  }

  async function cancelReview() {
    const pending = approvalRef.current;
    if (!pending || phaseRef.current !== 'idle') return;
    phaseRef.current = 'discarding';
    setPhase('discarding');
    setCancelRequested(true);
    setReviewError(null);
    try {
      await discardApproval(csrfToken, pending.id);
      approvalRef.current = null;
      if (mounted.current) { setApproval(null); setStatus('Review canceled. The approval was discarded; no model was executed.'); }
    } catch (failure) {
      if (mounted.current) setReviewError(`Deletion could not be confirmed. Execution is disabled for this review; try discarding it again. ${errorMessage(failure)}`);
    } finally { phaseRef.current = 'idle'; if (mounted.current) setPhase('idle'); }
  }

  async function execute() {
    const pending = approvalRef.current;
    if (!pending || phaseRef.current !== 'idle' || cancelRequested) return;
    if (!Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt) <= Date.now()) { setReviewError('This approval has expired. Discard it and prepare a new request.'); return; }
    phaseRef.current = 'executing';
    approvalRef.current = null;
    setPhase('executing');
    const version = revision.current;
    try {
      const response = await request<{ result: RunResult }>(`/api/approvals/${encodeURIComponent(pending.id)}/execute`, csrfToken, { method: 'POST', body: { consent: true } });
      if (mounted.current && version === revision.current) { setResult(response.result); setCompletedApproval(pending); setStatus('The approved request returned. No retry or fallback was made.'); }
    } catch (failure) {
      void discardApproval(csrfToken, pending.id).catch(() => {});
      if (mounted.current) setError(`${errorMessage(failure)} No retry was made. The provider may have received this request; check provider activity before approving another attempt.`);
    } finally {
      phaseRef.current = 'idle';
      if (mounted.current) { setApproval(null); setPhase('idle'); }
    }
  }

  return <div className="page playground-page">
    <div className="page-heading"><p className="eyebrow">The playground</p><h1 tabIndex={-1}>Make the first run <em>intentional.</em></h1><p className="page-intro">One connection, one model, one operation. Review what leaves your machine before you run it.</p></div>
    {connections.length === 0 ? <EmptyState icon={<FlaskConical size={28} />} title="First, make a connection." action={<button className="button button-primary" type="button" onClick={onAdd}>Choose a provider<ArrowRight size={16} aria-hidden="true" /></button>}><p>The playground uses real models from your connections. Nothing is preconfigured, and no API key is supplied for you.</p></EmptyState>
      : <div className="playground-layout">
        <section className="request-panel" aria-labelledby="request-heading">
          <header className="panel-heading"><div><span className="panel-step">01</span><h2 id="request-heading">Set up a request</h2></div><span className="quiet-label">No execution yet</span></header>
          <form className="request-form" onSubmit={(event) => void prepare(event)} aria-busy={phase === 'preparing'}>
            {error && <Notice tone="error">{error}</Notice>}
            <fieldset className="request-fields" disabled={locked}>
              <legend className="sr-only">Request inputs</legend>
              <div className="field"><label htmlFor="run-connection">Connection</label><select id="run-connection" value={form.connectionId} onChange={(event) => changeConnection(event.target.value)} required><option value="" disabled>Choose a connection</option>{connections.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
              <div className="field"><label htmlFor="run-operation">Operation</label><select id="run-operation" value={form.operation} onChange={(event) => changeOperation(event.target.value as Operation)}>{OPERATIONS.map((operation) => <option key={operation} value={operation} disabled={!provider?.operations.includes(operation)}>{OPERATION[operation].label}{!provider?.operations.includes(operation) ? ' (not implemented)' : ''}</option>)}</select></div>
              <div className="field"><label htmlFor="run-model">Compatible model</label><select id="run-model" value={model?.id ?? ''} onChange={(event) => changeForm({ modelId: event.target.value })} required disabled={compatibleModels.length === 0} aria-describedby="model-help"><option value="" disabled>{compatibleModels.length > 0 ? 'Choose a model' : 'No compatible models'}</option>{compatibleModels.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select><p id="model-help" className="field-help">Only models with established capabilities for this operation are selectable.</p></div>
              {compatibleModels.length === 0 ? <Notice tone="warning" title="A model declaration is needed."><p>No models in this connection have known {OPERATION[form.operation].label.toLocaleLowerCase()} capabilities. Refresh metadata or deliberately declare a documented model and supported operations.</p><button className="text-button" type="button" onClick={() => onManage(form.connectionId)}>Manage model metadata<ArrowRight size={14} aria-hidden="true" /></button></Notice>
                : model && <div className="selected-model-source"><SourceBadge source={model.capabilitySource} /><p>{CAPABILITY[model.capabilitySource].description}</p></div>}
              {form.operation !== 'stt' && <div className="field"><label htmlFor="run-text">{OPERATION[form.operation].prompt}</label><textarea id="run-text" value={form.text} onChange={(event) => changeForm({ text: event.target.value })} rows={5} maxLength={16000} placeholder={OPERATION[form.operation].placeholder} required /><span className="input-character-count">{form.text.length.toLocaleString()} / 16,000 characters</span></div>}
              {needsMedia && <div className="field upload-field"><span className="field-label">{form.operation === 'vision' ? 'Image input' : 'Audio input'}</span>{upload && <div className="uploaded-file">{form.operation === 'vision' ? <FileImage size={22} aria-hidden="true" /> : <FileAudio size={22} aria-hidden="true" />}<div><strong>{upload.name}</strong><span>{formatBytes(upload.bytes)} / {upload.media.mimeType}</span></div><button className="icon-button" type="button" onClick={() => { invalidate(); clearUpload(); }} aria-label="Remove uploaded file"><X size={17} aria-hidden="true" /></button></div>}<label className={`upload-area${upload ? ' upload-area-compact' : ''}`}><input ref={fileRef} className="sr-only" type="file" accept={mediaTypes.join(',')} onChange={(event) => void chooseFile(event)} aria-describedby="upload-help" disabled={readingFile || locked} />{readingFile ? <Spinner label="Reading file locally" /> : <UploadIcon size={20} aria-hidden="true" />}<strong>{readingFile ? 'Reading file locally...' : upload ? 'Choose another file' : form.operation === 'vision' ? 'Choose an image' : 'Choose an audio file'}</strong>{!upload && <span>Inline upload. No remote media URLs.</span>}</label><p id="upload-help" className="field-help">{form.operation === 'vision' ? `Still ${mediaTypes.includes('image/webp') ? 'PNG, JPEG, WebP' : 'PNG, JPEG'}; up to 8,192 pixels per side and 16,777,216 pixels total` : 'MP3, WAV, Ogg, WebM, FLAC'}. Maximum 4 MiB. The server validates signatures{form.operation === 'vision' ? ', dimensions, and animation' : ''}. Files go to the local server for review, and to the provider only after approval.</p>{fileError && <Notice tone="error">{fileError}</Notice>}</div>}
              {form.operation === 'tts' && <div className="field"><label htmlFor="run-voice">Voice ID</label><input id="run-voice" value={form.voice} onChange={(event) => changeForm({ voice: event.target.value })} maxLength={120} required={!provider?.defaultVoice} autoComplete="off" spellCheck={false} aria-describedby="voice-help" /><p id="voice-help" className="field-help">{provider?.defaultVoice ? `Provider registry default: ${provider.defaultVoice}. Leave blank to use this voice, or enter a documented voice ID.` : 'This provider has no default voice. Enter a voice ID from its documentation or your provider account.'}</p></div>}
              {usesTokens && <div className="field token-field"><label htmlFor="run-tokens">Maximum output tokens</label><input id="run-tokens" type="number" min={1} max={4096} step={1} inputMode="numeric" value={form.maxOutputTokens} onChange={(event) => changeForm({ maxOutputTokens: event.target.value })} required aria-describedby="token-help" /><p id="token-help" className="field-help">Default 512, maximum 4,096. This is an output limit, not a dollar budget or a guarantee of cost.</p></div>}
            </fieldset>
            <div className="request-review-step"><div><span className="panel-step">02</span><p><strong>Review comes next.</strong><span>Preparing an approval does not execute a model.</span></p></div><button ref={reviewButtonRef} className="button button-primary" type="submit" disabled={locked || readingFile || !model}>{phase === 'preparing' ? <><Spinner label="Preparing review" />Preparing review...</> : <>Review request<ArrowRight size={16} aria-hidden="true" /></>}</button></div>
            <p className="request-status" role="status">{status}</p>
          </form>
        </section>
        <div className="playground-output-column"><ResultPanel result={result} preparing={phase === 'preparing'} />{result && completedApproval && <RunArtifacts key={result.id} approval={completedApproval} result={result} />}{connection && <aside className="request-boundary"><LockKeyhole size={19} aria-hidden="true" /><div><h3>Know the boundary.</h3><VerificationBadge state={connection.verification.state} /><p>Metadata is not a successful inference test. Exact cost is unknown until your provider accounts for usage. No automatic retries, no fallback models.</p></div></aside>}</div>
      </div>}
    {approval && <ApprovalDialog approval={approval} payloadBytes={payloadBytes} phase={phase} error={reviewError} cancelRequested={cancelRequested} onCancel={() => void cancelReview()} onExecute={() => void execute()} returnFocusRef={reviewButtonRef} />}
  </div>;
}
