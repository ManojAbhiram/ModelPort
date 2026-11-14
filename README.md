# ModelPort

Inspect a provider. Choose a model. Review the request before it runs.

ModelPort is a local-first workbench for developers integrating AI into a product: a server-side TypeScript SDK, a React web app, and a coding-agent skill. Bring your own credentials, distinguish catalog claims from verified metadata, and explicitly approve each inference request.

**V1 preview:** the SDK, adapters, workbench, and skill are implemented, with offline contract and browser tests. This is not a production security certification, a published npm package announcement, or a claim that live provider calls have passed. The [provider matrix](docs/PROVIDERS.md) describes adapter coverage; the registry in `packages/core` is the runtime source of truth.

## Start Locally

Requirements: Node.js **22.12 or newer**, npm, and this source checkout. Run commands from the repository root. Do not add provider keys to project files or an `.env` file.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The development API listens on `127.0.0.1:8787`; Vite proxies `/api` to it. Use the displayed loopback address rather than a LAN address or a public tunnel.

For a production build served by a single local process:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:8787**. Here, "production build" describes the build mode, not support for internet-facing or multi-user hosting.

1. Select a provider and connect with a key entered in the workbench. Local providers can have different authentication requirements.
2. Read the verification message and catalog warnings. Metadata authentication does not prove credits, model access, or successful inference.
3. Select an operation and a model with known capabilities. If metadata is incomplete, consult the provider documentation before making an explicit human capability declaration.
4. Enter text or an allowed local media file. Review the exact provider, model, operation, input, limits, and billing notice.
5. Approve that request to execute it once. Editing the request or switching the model requires a new approval.
6. Disconnect when finished. Disconnecting removes the managed credential; restarting the API clears its in-memory connections and approvals. Closing a tab alone is not credential deletion.

Connecting, refreshing metadata, declaring a capability, changing selection, and preparing a request do not run inference. Metadata requests still contact the selected service; this is not a universal guarantee of a zero-dollar provider charge.

## Operations

| SDK operation | Purpose | Input |
| --- | --- | --- |
| `text` | Text generation | Text |
| `vision` | Image understanding | Text and an inline image |
| `image` | Image generation | Text |
| `stt` | Speech-to-text | A local audio file |
| `tts` | Text-to-speech | Text and a voice where required |
| `embedding` | A text embedding | Text |

These are six operations across the registry, **not six operations on every provider or model**. Native APIs and compatible APIs have different capabilities and response shapes. A provider marked `ready` has an adapter; it does not mean every account or model is usable. A `planned` entry cannot execute.

The [provider matrix](docs/PROVIDERS.md) owns the detailed coverage and source links. Enterprise AWS Bedrock, Azure and Vertex integrations, and providers requiring additional specialist job handling, remain explicit roadmap entries where the registry says `planned`.

V1 does not provide realtime audio, microphone streaming, streamed generation, tool execution, remote input URLs, arbitrary model downloads, fine-tuning, or asynchronous specialist image/video jobs. An unsupported ModelPort operation is not a claim that the vendor lacks that operation.

## Limits And Data

| Boundary | V1 limit |
| --- | --- |
| Text input | 16,000 characters |
| Output token setting | Default 512; maximum 4,096 for `text` and `vision` only |
| Inline media input | 4 MiB of decoded bytes |
| Image dimensions | At most 8,192 pixels per side and 16,777,216 pixels total |
| Upstream response | 16 MiB |
| Approval lifetime | 5 minutes; one use |
| Pending approvals | At most 8, with 12 MiB total retained input strings |
| Connections | At most 16 per SDK instance |
| Inference concurrency | One request at a time per SDK instance |

Accepted input MIME types are `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, and `audio/flac`. Animated PNG/WebP is rejected. A provider or operation may accept a smaller subset. Base64 is an encoding, not validation. Media checks cover allowed types, size, signatures, and image dimension headers; they are **not antivirus scanning or complete codec validation**.

Only `vision` and `stt` accept `media`. Transcription omits `text`; the other operations require it. Only `tts` accepts `voice`, and only `text`/`vision` accept `maxOutputTokens`. Unsupported fields are rejected rather than silently ignored.

Credentials entered through the app are retained in the Node process, not browser storage or a credential database. The browser necessarily handles the value transiently during entry. Prompt text and media are transmitted to the selected provider only when the corresponding inference is approved. Results can remain in the current UI. Provider retention and billing policies still apply.

Loopback does not prove offline processing: a local service may route a selected model to a cloud provider. Local execution can also consume substantial CPU/GPU resources.

There are no automatic inference retries, fallback models, background titles, or dollar-budget guarantees. A timeout or lost response can mean the provider already started or completed billable work. A new attempt needs a new approval. Cancelling a pending approval prevents its later execution; it is not a refund or a guarantee that already-dispatched work stops.

## Use The SDK

`@modelport/core` is the server-side workspace package in this source tree. The workspace install resolves it locally; do not assume a package with that name on a public registry is this project. Publishing the SDK is a separate owner-controlled step.

Keep a `ModelPort` instance in a trusted server process. Importing it into a browser, edge environment without the guarded Node transport, or untrusted agent runtime is not a supported security boundary.

### Prepare For Review

This example defines server functions; it does not automatically connect or execute a model. `apiKey` must come from trusted server-side input, not a literal in source code. The host must authorize access to connections and derive `sessionScope` from its authenticated session rather than accepting a client-supplied scope.

```ts
import { ModelPort, type RunInput } from '@modelport/core';

const port = new ModelPort();

export async function connectProvider(apiKey: string) {
  if (!apiKey.trim()) throw new Error('A server-side credential is required.');
  return port.connect({ providerId: 'openai', apiKey });
}

export function prepareForReview(input: RunInput, sessionScope: string) {
  return port.prepare(input, { scope: sessionScope });
}
```

Present the returned `Approval` to the human and wait for a separate, explicit decision. Preserve its provider, model, operation, content preview, media information, expiry, and billing warning. Do not execute in the same automatic code path as `prepareForReview`.

### After Human Approval

The following is an SDK call site, **not a complete HTTP authorization handler**. Invoke it only after the host authenticates the approving human, verifies session/CSRF requirements, and confirms the approval belongs to that session. An agent, webhook, or arbitrary request body must not be able to call it as an approver.

```ts
export async function executeAfterHumanApproval(
  approvalId: string,
  sessionScope: string,
) {
  return port.execute(approvalId, { consent: true, scope: sessionScope });
}
```

`consent: true` alone does not establish human authorization. The protection is the host's authenticated decision together with the SDK's immutable, scoped, expiring, single-use stored approval. Scope isolates approvals; it does not implement user authentication, connection ownership, or hosted multi-tenancy for an embedding application.

### Public Surface

| Method | Role |
| --- | --- |
| `connect({ providerId, apiKey?, baseUrl?, workspaceId?, name? })` | Connect and inspect metadata; `baseUrl` is for approved local profiles only. `workspaceId` is for Anthropic keys that require it. |
| `getConnections()` | Read credential-free connection summaries. |
| `refresh(connectionId)` | Refresh connection metadata and models without inference; a successful refresh invalidates pending approvals for the connection. |
| `declareModel(connectionId, { id, operations })` | Record a human declaration, not a successful model test; invalidate the connection's pending approvals. |
| `prepare(input, { scope? })` | Synchronously validate and store a pending approval. |
| `listApprovals({ scope? })` | List pending approvals in the requested scope. |
| `execute(approvalId, { consent: true, scope? })` | Consume the stored approval and attempt inference once. |
| `cancel(approvalId, { scope? })` | Discard a pending approval. |
| `disconnect(connectionId)` | Remove the managed connection, its credential and its pending approvals. |
| `dispose()` | Clear managed connections/approvals and close the instance; it cannot be reused. |

`RunInput`, `Approval`, `RunResult`, and the registry types are defined in [the core contracts](packages/core/src/types.ts). SDK consumers must apply the same transport, credential, approval and output-rendering boundaries as the workbench; see [SECURITY.md](SECURITY.md).

## Coding-Agent Skill

The portable skill is [skills/modelport/SKILL.md](skills/modelport/SKILL.md), with progressive-disclosure material in `references/`. It teaches task/modality selection, server-side credentials, capability evidence, separate human approval, and offline verification. It grants no execution authority.

Use your agent's documented project-level skill loader with `skills/modelport` as the source, retaining its `references` directory. No global agent configuration is changed by ModelPort.

An optional installer is the independently maintained [Agent Skills CLI](https://github.com/vercel-labs/skills). Its current documented requirement is Node 22.20 or newer, which is higher than ModelPort's minimum. If you choose to install and trust that CLI, its documented local-source syntax from this checkout is:

```sh
npx skills add ./skills/modelport --skill modelport
```

Review the CLI's package/version, telemetry settings, chosen agent and destination before confirming installation. This command downloads/runs a separate tool and writes skill configuration; it is not part of ModelPort setup or a model test. Agent-specific discovery behavior varies.

## Verify Offline

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs type checking (including test fixtures), unit tests and the production build. Playwright boots the real local server, then tests provider workflows with mocked application API responses rather than provider credentials. Browser installation downloads Chromium; it is not an inference call. Linux CI additionally uses Playwright's `--with-deps` option to install browser system dependencies.

These checks validate local code and contracts, not live provider compatibility, credits or a security certification. Report the exact checks run and failures; do not turn a fixture-based test into a "live verified" badge. See [CONTRIBUTING.md](CONTRIBUTING.md) for provider and security test expectations.

## Project Map

| Path | Responsibility |
| --- | --- |
| `packages/core` | Registry, adapters, validation, guarded transport and approvals |
| `apps/server` | Fastify API, local session/CSRF boundary and static app serving |
| `apps/web` | React workbench |
| `skills/modelport` | Coding-agent skill and references |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product scope and acceptance criteria |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Provider coverage and evidence |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Source-linked research and licensing decisions |

## Security And Contribution

Read [SECURITY.md](SECURITY.md) before using real credentials or discussing a vulnerability. This is a trusted single-user local application, not a hardened public gateway. Do not expose it through a reverse proxy or tunnel and assume it has hosted authentication or tenant isolation.

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Reports, fixtures and screenshots must not contain API keys, account identifiers, private prompts, recordings or sensitive media.

## Publication

This checkout does not declare an existing GitHub origin or npm release. There are intentionally no repository-dependent badges or invented release links.

Publication is an explicit maintainer action, not an app feature. First review the complete source/history for secrets and third-party material, run the checks, and create a reviewed local Git commit. Install [GitHub CLI](https://cli.github.com/) and authenticate before using the [repository creation command](https://cli.github.com/manual/gh_repo_create).

The following is an example for a **new private repository**. `OWNER/modelport` is a placeholder, not this project's remote. Replace `OWNER` with the actual account or organization and confirm that no conflicting `origin` already exists before running it.

```sh
gh auth login
gh auth status
gh repo create OWNER/modelport --private --source=. --remote=origin --push
```

Before a public launch, the owner must establish monitored security/community reporting, configure the repository's private vulnerability reporting when available, review CI results and dependency alerts, and choose branch protections. Changing visibility, enabling repository settings and publishing an npm package are separate actions; this repository's workflows do not do them.

For a reviewed open-source launch directly to a new public repository, use `--public` instead of `--private` in the creation command. No GitHub repository or npm package is created automatically by this project.

## License

Original ModelPort code and documentation are [MIT licensed](LICENSE), copyright 2026 ModelPort contributors. Upstream libraries retain their own licenses. Provider services, model weights, voice rights, and generated-content terms are not licensed by this repository. Research references are not endorsements, forks, copied UI assets, or claims of affiliation.
