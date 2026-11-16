import { useState } from 'react';
import type { Approval, RunResult } from '@modelport/core';
import { exportRecord, requestExample } from '../artifacts';
import { CopyButton } from './Shared';

export function RunArtifacts({ approval, result }: { approval: Approval; result: RunResult }) {
  const [includeContent, setIncludeContent] = useState(false);
  function download() {
    const blob = new Blob([JSON.stringify(exportRecord(approval, result, includeContent), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelport-run.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="run-artifacts"><summary>Use this request in your project</summary>
    <p>Copy a server-side preparation example or download a run record. Credentials, internal IDs, and media bytes are excluded. Model names, voice IDs, and usage are included; review before sharing.</p>
    <label className="consent-control"><input type="checkbox" checked={includeContent} onChange={(event) => setIncludeContent(event.target.checked)} /><span>Include prompt text in code and export, and response text or embeddings in export. These may contain sensitive data.</span></label>
    <div className="code-block"><div className="code-block-header"><span>TypeScript / prepare for human review</span><CopyButton text={requestExample(approval, includeContent)} label="Copy request code" /></div><pre tabIndex={0}><code>{requestExample(approval, includeContent)}</code></pre></div>
    <button className="button button-secondary button-small" type="button" onClick={download}>Download run record</button>
  </details>;
}
