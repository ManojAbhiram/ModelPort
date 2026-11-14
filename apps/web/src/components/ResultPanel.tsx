import { useEffect, useState } from 'react';
import type { RunResult } from '@modelport/core';
import { ArrowDownToLine, ArrowUpRight, Check, Terminal } from 'lucide-react';
import { OPERATION } from '../content';
import { outputBlob } from '../media';
import { CopyButton, Notice, Spinner } from './Shared';

function ResultMedia({ result }: { result: RunResult }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const media = result.media;

  useEffect(() => {
    if (!media) return;
    let objectUrl: string | undefined;
    setUrl(null);
    setError(null);
    try {
      objectUrl = URL.createObjectURL(outputBlob(media));
      setUrl(objectUrl);
    } catch {
      setError('The returned media could not be displayed safely. No external media URL was opened.');
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [media]);

  if (!media) return null;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!url) return <p role="status"><Spinner label="Preparing local media preview" />Preparing local media preview...</p>;
  const isImage = media.mimeType.startsWith('image/');
  const extension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac' };
  return <div className="result-media">
    {isImage ? <img src={url} alt={`Generated image from ${result.providerId}, model ${result.modelId}`} onError={() => setError('The browser could not decode this image. No remote image was fetched.')} />
      : <div className="audio-result"><p>Audio is ready. Playback is manual.</p><audio controls preload="none" src={url} aria-label="Generated audio" onError={() => setError('The browser could not decode this audio. No remote media was fetched.')} /></div>}
    <a className="button button-secondary button-small" href={url} download={`modelport-output.${extension[media.mimeType] ?? 'bin'}`}><ArrowDownToLine size={14} aria-hidden="true" />Download {isImage ? 'image' : 'audio'}</a>
  </div>;
}

export function ResultPanel({ result, preparing }: { result: RunResult | null; preparing: boolean }) {
  const hasContent = result && (result.text !== undefined || result.media || result.embedding);
  return <section className="result-panel" aria-labelledby="result-heading">
    <header className="panel-heading"><div><span className="panel-step">03</span><h2 id="result-heading">The response</h2></div>{result && <span className="badge result-complete"><Check size={13} aria-hidden="true" />Returned</span>}</header>
    {!result ? <div className="result-placeholder"><div className="result-placeholder-icon"><Terminal size={29} strokeWidth={1.4} aria-hidden="true" /></div><h3>{preparing ? 'Preparing a review.' : 'Room for a first response.'}</h3><p>{preparing ? 'The server is creating an immutable approval. This step does not execute a model.' : 'Choose your inputs, review the exact request, and approve one run. Nothing is generated in the background.'}</p><div className="result-placeholder-rule" /><span>Configure <ArrowUpRight size={13} aria-hidden="true" /> Review <ArrowUpRight size={13} aria-hidden="true" /> Approve</span></div>
      : <div className="result-content">
        <div className="result-summary" role="status"><strong>{OPERATION[result.operation].label} returned</strong><span>{result.durationMs.toLocaleString()} ms / {result.providerId}</span><code>{result.modelId}</code></div>
        {result.text !== undefined && <div className="text-result"><div className="result-content-label"><h3>Text output</h3><CopyButton text={result.text} label="Copy text" /></div><pre className="result-text" tabIndex={0}>{result.text || '(The provider returned an empty text response.)'}</pre></div>}
        {result.media && <ResultMedia result={result} />}
        {result.embedding && <details className="embedding-result"><summary>View embedding vector <span>{result.embedding.length.toLocaleString()} dimensions</span></summary><div className="result-content-label"><span>Raw numeric vector</span><CopyButton text={JSON.stringify(result.embedding)} label="Copy vector" /></div><pre tabIndex={0}><code>{JSON.stringify(result.embedding, null, 2)}</code></pre></details>}
        {!hasContent && <Notice tone="warning">The provider returned no displayable text, media, or embedding data.</Notice>}
        {result.usage && (result.usage.inputTokens !== undefined || result.usage.outputTokens !== undefined) && <dl className="usage-facts">{result.usage.inputTokens !== undefined && <div><dt>Reported input tokens</dt><dd>{result.usage.inputTokens.toLocaleString()}</dd></div>}{result.usage.outputTokens !== undefined && <div><dt>Reported output tokens</dt><dd>{result.usage.outputTokens.toLocaleString()}</dd></div>}</dl>}
        <p className="result-footnote">Provider-reported usage is not a bill. Check the provider's account for actual charges. Editing any input clears this local result.</p>
      </div>}
  </section>;
}
