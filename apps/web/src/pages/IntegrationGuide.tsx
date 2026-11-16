import { ArrowRight, BookOpen, Code2, FolderDown, ShieldCheck } from 'lucide-react';
import { CopyButton, Notice } from '../components/Shared';

const SDK_EXAMPLE = `import { ModelPort } from '@modelport/core';

// Server-side only. Never expose this key to a browser.
const port = new ModelPort();
const connection = await port.connect({
  providerId: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});

const model = connection.models.find(
  (item) => item.operations.includes('text')
    && item.capabilitySource !== 'unknown',
);
if (!model) throw new Error('Declare a supported model first.');

// Preparing creates a review, not a model execution.
const approval = port.prepare({
  connectionId: connection.id,
  modelId: model.id,
  operation: 'text',
  text: 'Hello',
  maxOutputTokens: 512,
});

// Your host app implements this human approval screen.
const consent = await showToUser(approval);
if (consent === true) {
  const result = await port.execute(approval.id, {
    consent: true,
  });
  console.log(result.text);
} else {
  port.cancel(approval.id);
}`;

const SKILL_PATH = 'skills/modelport/SKILL.md';
const SKILL_INSTALL = `# From the ModelPort repository, in PowerShell.
# Use your target project's path when installing elsewhere.
New-Item -ItemType Directory -Force .kilo/skills/modelport
Copy-Item -Recurse skills/modelport/* .kilo/skills/modelport/`;

export function IntegrationGuide() {
  return <div className="page guide-page">
    <div className="page-heading"><p className="eyebrow">From workbench to product</p><h1 tabIndex={-1}>Your interface.<br /><em>The same deliberate foundation.</em></h1><p className="page-intro">Use the SDK behind your application, or give your coding agent the integration skill. Keep the approval boundary wherever you build.</p></div>
    <div className="guide-intro-strip"><Code2 size={23} strokeWidth={1.5} aria-hidden="true" /><p>Start in the workbench. After a response, expand <strong>Use this request in your project</strong> for request-specific TypeScript and a JSON record. Content is excluded by default; review metadata before sharing.</p></div>

    <section className="guide-section" aria-labelledby="sdk-heading">
      <div className="guide-section-heading"><span className="guide-number">01</span><div><h2 id="sdk-heading">Bring the SDK to your server.</h2><p>The example uses the <code>@modelport/core</code> workspace package. It does not assume a public npm release.</p></div></div>
      <Notice title="Server-side, not client-side."><p>Keep the SDK instance and credentials on your backend. Import only TypeScript types into browser code. Do not embed keys in bundles, generated examples, or client storage.</p></Notice>
      <div className="code-block"><div className="code-block-header"><span><Code2 size={16} aria-hidden="true" />server/inference.ts</span><CopyButton text={SDK_EXAMPLE} /></div><pre tabIndex={0} aria-label="Approval-gated SDK example"><code>{SDK_EXAMPLE}</code></pre></div>
      <div className="host-responsibility"><ShieldCheck size={21} aria-hidden="true" /><div><h3>The approval UI is your host app's responsibility.</h3><p><code>showToUser</code> is your own interface, not an SDK helper. Show the exact provider, model, operation, data preview, provenance, verification state, limits, and possible charges. Execute only after the person explicitly agrees. Never turn consent into an automatic default.</p></div></div>
    </section>

    <section className="guide-section" aria-labelledby="flow-heading">
      <div className="guide-section-heading"><span className="guide-number">02</span><div><h2 id="flow-heading">Keep the boundaries intact.</h2><p>Four steps, with no hidden generation in between.</p></div></div>
      <ol className="integration-steps">
        <li><code>connect</code><ArrowRight size={18} aria-hidden="true" /><div><h3>Read metadata first</h3><p>Inspect a credential and discover models. A reachable endpoint is not necessarily authenticated, and authentication is not model entitlement.</p></div></li>
        <li><code>prepare</code><ArrowRight size={18} aria-hidden="true" /><div><h3>Freeze a request for review</h3><p>Prepare a short-lived, immutable approval with exact inputs. Changed inputs require a new approval. Unknown capabilities must be declared deliberately.</p></div></li>
        <li><code>your UI</code><ArrowRight size={18} aria-hidden="true" /><div><h3>Ask for a real decision</h3><p>Make data transfer and potential charges explicit. Never describe an untested key, a public catalog, or a local model as a guarantee of a free run.</p></div></li>
        <li><code>execute</code><ArrowRight size={18} aria-hidden="true" /><div><h3>Run once, without surprises</h3><p>Use the approval ID with explicit consent. Expired, reused, or invalidated approvals are rejected. No automatic retries, model fallbacks, or agent tool calls.</p></div></li>
      </ol>
    </section>

    <section className="guide-section" aria-labelledby="skill-heading">
      <div className="guide-section-heading"><span className="guide-number">03</span><div><h2 id="skill-heading">Give your coding agent the context.</h2><p>The repository includes an integration skill at <code>{SKILL_PATH}</code>.</p></div></div>
      <div className="skill-install-card"><FolderDown size={25} strokeWidth={1.5} aria-hidden="true" /><div><h3>Install the skill in your project</h3><p>For Kilo, copy the whole skill folder, including <code>references/</code> and <code>LICENSE</code>, so its entry point is <code>.kilo/skills/modelport/SKILL.md</code> in your target project. Other coding agents may use a different skills directory; follow that agent's documented installation path.</p><p>The skill guides integration. It does not contain credentials or replace the SDK's runtime approval checks.</p></div></div>
      <div className="code-block code-block-light"><div className="code-block-header"><span>PowerShell / project-local skill</span><CopyButton text={SKILL_INSTALL} /></div><pre tabIndex={0} aria-label="Install the ModelPort integration skill"><code>{SKILL_INSTALL}</code></pre></div>
    </section>

    <section className="guide-limits" aria-labelledby="limits-heading"><BookOpen size={23} strokeWidth={1.5} aria-hidden="true" /><div><h2 id="limits-heading">Read the scope, not just the labels.</h2><p><strong>Available</strong> providers have implemented adapters. Each card lists only implemented operations, while an individual model may support fewer. <strong>Roadmap</strong> providers cannot be connected or executed in this release. A missing operation is not a claim that the provider can never support it.</p><p>Metadata checks do not generate content, but zero cost is not guaranteed. Provider billing remains authoritative. Local runs can consume CPU/GPU resources or use cloud-backed models. Output token caps are not enforceable dollar budgets.</p><p>Keys and approvals live in server memory. Restarting clears them. The local-first workbench is for a trusted single-user workstation, not a hosted multi-tenant service.</p></div></section>
  </div>;
}
