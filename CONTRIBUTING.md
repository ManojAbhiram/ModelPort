# Contributing To ModelPort

ModelPort prioritizes truthful capability information, explicit human control, and narrow network/credential boundaries. A new provider name is not useful without a tested adapter and an honest account of what it cannot do.

Read [the product plan](docs/PRODUCT.md), [provider matrix](docs/PROVIDERS.md), [security policy](SECURITY.md), and [Code of Conduct](CODE_OF_CONDUCT.md) before changing behavior. The initial release is still being integrated; check the current contracts and tests rather than assuming a documentation example is a published API guarantee.

## Development

Use Node.js 22.12 or newer and run commands from the repository root:

```sh
npm ci
npm run dev
```

The app is at `http://127.0.0.1:5173`, with the local API on port `8787`. Production-mode serving is `npm run build` followed by `npm start`, at `http://127.0.0.1:8787`.

Do not place provider credentials in `.env`, checked-in configuration, shell examples, browser storage or test fixtures. Normal contribution work needs no live provider credentials. Do not enable an internet tunnel to share the development server.

## Checks

| Command | Scope |
| --- | --- |
| `npm run typecheck` | Build core declarations and type-check the workspaces |
| `npm test` | Unit and contract tests, after the core build |
| `npm run build` | Core, web and server production builds |
| `npm run check` | Type checking, unit tests and build |
| `npx playwright install chromium` | Install the browser needed by the browser suite |
| `npm run test:e2e` | Browser behavior with mocked app API responses |

Run `npm run check` and the browser suite before submitting a change affecting runtime behavior. Browser installation needs network access for the browser download; the tests must not need provider access. On Linux CI, `npx playwright install --with-deps chromium` also installs system dependencies.

State exactly what ran, the runtime version, and any skipped or failed checks. Do not claim live provider verification from mock responses. If a provider's documentation changed and no authorized live test exists, keep that limitation visible.

## Provider Checklist

A provider change should include all of the following evidence:

- [ ] Official documentation or an official open-source SDK URL, review date, and the API version or model family covered.
- [ ] Exact base origin, path construction, authentication headers, and a reason for every additional origin.
- [ ] A documented non-inference probe, its expected response shape and permission requirements, or an explicit `unverified`/public/unsupported outcome.
- [ ] Correct separation of authenticated metadata, public catalogs, model entitlement, credits and successful inference. Metadata is not promised universally free.
- [ ] A precise subset of `text`, `vision`, `image`, `stt`, `tts`, and `embedding`. Compatibility with one path does not imply compatibility with the others.
- [ ] Capability provenance: `provider`, `reference`, `declared`, or `unknown`. Unknown models must not inherit every provider operation.
- [ ] Bounded catalog pagination and parsing, handling of unusual envelopes, duplicate IDs and partial catalog errors.
- [ ] Request and response validation, MIME/format constraints, output limits and handling of unexpected non-JSON/binary responses.
- [ ] Use of the injected guarded transport. No direct `fetch`, SDK auto-downloads, arbitrary redirects, inherited proxies or remote media retrieval that bypass it.
- [ ] No inference in connect, refresh, credential checking, model declaration or preparation. No automatic retry, fallback, job submission or tool execution.
- [ ] Synthetic request/response fixtures covering the advertised operations and failure cases. Assert destination, method, auth header, input body and response normalization without printing credentials.
- [ ] Updated registry notes and `docs/PROVIDERS.md`, including deferred features and the distinction between documentation evidence and live testing.
- [ ] License and dependency review. No copied provider SDK implementation, proprietary material, model assets, logos or unreviewed package installation.

A manual declaration records a user's assertion; it must not be relabeled as provider evidence or a passing live test. It must remain constrained by operations the adapter actually implements.

Do not add another provider by guessing `/v1/models`, speech endpoints, or OpenAI response shapes. If a service requires enterprise IAM, asynchronous jobs or a different trust boundary, keep it planned until its design and tests are ready.

## Security Tests

- Verify immutable approval input, five-minute expiry, one-use consumption, scope isolation, cancellation and concurrent execution rejection.
- Verify that editing inputs, changing model/provider, or disconnecting cannot reuse an approval for a different request.
- Exercise cross-site requests, CSRF failures, invalid host/origin values and malicious URL forms with local fixtures only.
- Cover both IPv4 and IPv6, DNS changes at connection time, redirects, metadata/private addresses, local port/path restrictions and oversized responses.
- Test all upload signatures and image bounds with synthetic content. Include bad base64, wrong MIME, truncated files and size-limit failures. Do not claim full decoding or malware detection from these checks.
- Verify redaction and credential-free connection responses with obviously fake canary values. Avoid snapshotting whole SDK errors, headers, recordings or response bodies.
- Ensure timeouts and uncertain responses remain potentially billed failures rather than triggering a hidden retry.
- Use unknown, public-only and restricted-scope metadata fixtures to prove the UI does not imply "works", "free", or "credits available".

Tests must fail if they unexpectedly attempt provider network access. Use injected transports or explicit request interception and do not silently fall back to a real service. Do not turn a test into a live probe because a fixture is inconvenient.

## Change Scope

Keep changes focused and follow the current TypeScript/React patterns. Prefer small explicit adapters to generic code that silently ignores provider differences. Do not introduce browser credentials, a persistent credential database, remote tools, paid health checks or hosted multi-tenancy as incidental refactoring.

Document user-visible limits and unsupported operations alongside the implementation. Check keyboard navigation, narrow screens, reduced motion and clear error states for UI changes. Use original UI assets and local resources rather than external analytics, fonts or CDN dependencies.

New dependencies require a concrete purpose, license review, a lockfile update, and a check for install scripts and security advisories. Registry/model metadata must never select packages to install or code to execute.

## Reports And Pull Requests

Use a minimal synthetic reproduction. Include the affected operation, adapter, platform, Node/npm versions, expected behavior, observed behavior and sanitized errors. Do not attach raw prompts, audio, images, environment dumps, authorization headers, account IDs or provider dashboards.

Suspected vulnerabilities belong in the private channel described by [SECURITY.md](SECURITY.md), not a public bug report. There is no bounty or response-time guarantee in this early project.

Use the pull request template to record scope, evidence, tests, privacy and billing effects. Check your diff and staged files before committing. Do not submit credentials, `node_modules`, local build output or browser traces containing personal data.

AI-assisted contributions follow the same review standard. The contributor is responsible for understanding the code, checking official sources, validating licenses and reporting what was actually tested. A generated claim that a provider works is not evidence.

## CI And Dependencies

The CI definition runs on GitHub-hosted Ubuntu with Node 22 and 24, read-only repository permissions, a locked npm install, the main checks and mocked Chromium tests. It does not receive provider secrets, publish packages, deploy the app or upload browser reports. The matrix is a verification target, not a claim that an unrun workflow passed.

The checkout and Node setup actions are pinned to commit IDs verified from their official repositories. Dependabot checks npm and GitHub Actions weekly. Review dependency PRs, including transitive licenses and action permissions; do not automatically merge a security-sensitive change simply because checks pass.

## Maintainer Launch Checklist

- [ ] Inspect the complete repository and initial history for secrets and copied third-party material.
- [ ] Reconcile this documentation with the final core API, registry and tests.
- [ ] Run local checks and confirm the real remote CI result once a repository exists.
- [ ] Establish monitored security and community-reporting channels; configure private vulnerability reporting when available.
- [ ] Review dependency alerts and configure branch protection/rules for the actual repository.
- [ ] Choose the real repository owner, visibility, release process and package ownership explicitly.

No command in the normal development or CI flow commits, pushes, creates a repository or publishes a package.
