import { useEffect, useRef, useState } from 'react';
import { Notice } from '../components/Shared';

export function Demo() {
  const [text, setText] = useState('Explain what an API is in one sentence.');
  const [reviewedText, setReviewedText] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (returned) resultHeading.current?.focus(); }, [returned]);
  return <div className="page guide-page">
    <div className="page-heading"><p className="eyebrow">No key required</p><h1 tabIndex={-1}>Try the workflow.<br /><em>Keep it simulated.</em></h1><p className="page-intro">Inspect a sample request, approve it, and see a fixed example response before connecting a real provider.</p></div>
    <Notice title="Mock demo — no provider calls."><p>This walkthrough stays in your browser memory. No key, model, inference, or billing is involved. The response is canned and does not depend on your prompt.</p></Notice>
    <section className="guide-section" aria-labelledby="demo-configure">
      <h2 id="demo-configure">1. Configure a mock request</h2>
      <dl className="approval-facts"><div><dt>Provider</dt><dd>Demo provider (synthetic)</dd></div><div><dt>Model</dt><dd>demo-text (synthetic)</dd></div><div><dt>Operation</dt><dd>Text generation</dd></div><div><dt>Destination</dt><dd>None — browser simulation</dd></div></dl>
      <div className="field"><label htmlFor="demo-text">Sample prompt</label><textarea id="demo-text" value={text} maxLength={16000} disabled={reviewedText !== null} onChange={(event) => setText(event.target.value)} /></div>
      {reviewedText === null && <button className="button button-primary" type="button" disabled={!text.trim()} onClick={() => { setReviewedText(text); setReturned(false); }}>Review mock request</button>}
    </section>
    {reviewedText !== null && <section className="guide-section" aria-labelledby="demo-review"><h2 id="demo-review">2. Inspect before approving</h2><p>This frozen sample is what you chose to review. Real runs also show capability evidence, limits, media details, expiry, and possible charges.</p><div className="code-block"><pre tabIndex={0} aria-label="Mock request text">{reviewedText}</pre></div>
      {!returned && <button className="button button-primary" type="button" onClick={() => setReturned(true)}>Approve mock response</button>}
      <button className="button button-secondary" type="button" onClick={() => { setReviewedText(null); setReturned(false); }}>Reset demo</button>
    </section>}
    {returned && <section className="guide-section" aria-labelledby="demo-result"><h2 id="demo-result" ref={resultHeading} tabIndex={-1}>3. Inspect the example response</h2><Notice title="Simulated response"><p>An API is a defined way for software systems to communicate.</p></Notice><p>This fixed response does not verify any provider. With a real connection, the result panel shows returned content, elapsed time, and usage when supplied, plus code and export options.</p></section>}
    <section className="guide-section"><h2>Ready for your own request?</h2><p>Open the provider library, connect your provider, then select a model in Playground. Connecting inspects metadata; running a request requires a separate approval.</p><a className="button button-primary" href="#providers">Choose a real provider</a></section>
  </div>;
}
