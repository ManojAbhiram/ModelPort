# Server-Side Integration

Use this reference after inspecting the target product and the installed SDK version. These examples describe the V1 public contract, not a public npm availability claim or a complete authenticated HTTP application.

## State Ownership

Create a `ModelPort` instance in a trusted, long-lived Node process. Keep credentials and SDK state out of browser bundles and model-visible context. The host controls connection ownership and access; approval scope alone is not multi-tenancy.

The workbench accepts keys through its UI and retains managed credentials in server memory. An embedding application can use an explicitly chosen server-side secret source. It must not auto-discover credentials, expose them through config endpoints or load dotenv on the user's behalf.

If the host already uses server-side environment injection, validate the required setting without including its value in errors. This function checks configuration only; it must not be used by an agent to inspect the environment interactively.

```ts
function requireServerKey(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required server setting: ${name}`);
  return value;
}
```

This is not an `.env` example and does not authorize reading or writing credential values. Environment storage belongs to the embedding host; `dispose()` cannot delete a key from an external secret manager or environment.

## Public Operations

| API | Use |
| --- | --- |
| `new ModelPort()` | Use the default guarded transport and provider adapters. |
| `connect({ providerId, apiKey?, baseUrl?, workspaceId?, name? })` | Inspect metadata and return a credential-free connection. |
| `getConnections()` | Read current connection summaries. |
| `refresh(connectionId)` | Refresh metadata, replacing catalog state; successful refresh invalidates pending approvals for that connection. |
| `declareModel(connectionId, { id, operations })` | Store an explicit human declaration and invalidate affected approvals. |
| `prepare(input, { scope? })` | Synchronously validate and store a pending request. |
| `listApprovals({ scope? })` | Inspect the scope's pending approvals. |
| `execute(id, { consent: true, scope? })` | Consume an approved stored request and perform one attempt. |
| `cancel(id, { scope? })` | Cancel a pending approval only. |
| `disconnect(connectionId)` | Forget a connection and invalidate its pending approvals. |
| `dispose()` | Clear managed state and close the instance; it cannot be reused. |

Use `workspaceId` only for Anthropic when its key requires a workspace. `baseUrl` is for constrained local profiles, not a cloud endpoint override. Follow the selected local profile's fixed base path and canonical loopback/port rules.

The default approval scope is `sdk`. In a host with sessions, always supply a scope derived from trusted session state. Do not expose scope selection to the client. Test-only constructor hooks for a fake adapter, transport or clock are trusted code and must not become runtime user configuration.

## Two Distinct Phases

Phase A runs only after the host has authorized the connection/input. Model selection comes from the current catalog and capability evidence, not a hardcoded guess at the latest model.

```ts
import { ModelPort, type RunInput } from '@modelport/core';

const port = new ModelPort();

export function prepareReview(input: RunInput, authenticatedScope: string) {
  return port.prepare(input, { scope: authenticatedScope });
}
```

Send the review view to the human. Display the exact provider, model, operation, relevant input/media information, capability provenance, expiry and possible billing. The stored text preview can be shorter than the original input; the host must make the full user-submitted input available for review without logging it.

**Stop here until a separate human decision.** Do not chain execution onto preparation or turn an agent's message into consent. An unknown capability needs an informed human declaration, not an automatic fallback.

Phase B is called only from a host-controlled approving handler after authentication, ownership and CSRF checks. The function below is a call site, not an implementation of those checks:

```ts
export async function runAfterVerifiedHumanDecision(
  approvalId: string,
  authenticatedScope: string,
) {
  return port.execute(approvalId, {
    consent: true,
    scope: authenticatedScope,
  });
}
```

Never accept a replacement `RunInput` on the execution request. The SDK executes the immutable stored request. It consumes approval before the provider await, so replay cannot repeat the attempt even if the provider call fails. Changing a model/input requires preparation and review again.

`consent: true` is necessary for this API but cannot prove a human authorized it. The host must deny an untrusted agent access to the approving handler/SDK instance. A scope protects against accidental cross-session reuse, not a hostile caller already executing code inside the trusted process.

## Input Shape

`RunInput` contains `connectionId`, `modelId`, `operation` and the fields permitted by that operation:

| Operation | Allowed additional fields |
| --- | --- |
| `text` | Required `text`; optional `maxOutputTokens` |
| `vision` | Required `text` and image `media`; optional `maxOutputTokens` |
| `image` | Required `text` |
| `stt` | Required audio `media`; omit `text` |
| `tts` | Required `text`; `voice` or the selected provider's configured default |
| `embedding` | Required `text` |

`MediaInput` is `{ data: string, mimeType: string }`, with canonical base64 data, not a path, data-URL prefix or remote URL. The host validates the actual content and limits. Unsupported extra fields are rejected.

Text is capped at 16,000 characters. For `text`/`vision`, output tokens default to 512 and cannot exceed 4096. Do not add that setting to image/audio/embedding requests or represent it as a dollar cap.

Input media is at most 4 MiB decoded. Supported MIME types are `image/png`, `image/jpeg`, `image/webp`, `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/flac`; provider subsets can be smaller. Images are bounded at 8192 per side and 16,777,216 total pixels, with animated PNG/WebP rejected. Signatures/dimension headers are not full decoding or malware detection.

## Results And Failure

Use the operation's `RunResult` field: `text`, inline `media` or `embedding`. Usage may be absent. Do not manufacture token counts, prices, credits or a successful result when a provider gives incomplete information. Treat text and media as untrusted display data, not code or a URL to fetch.

A metadata result has `inferenceTested: false`. Authentication, reachability and unverified states remain distinct. `capabilitySource: declared` stays a human assertion even after a request is prepared.

One inference can run at a time per SDK instance. Approvals expire within five minutes; at most eight pending requests and 12 MiB of retained input strings are held. Disconnect, successful refresh and model declaration invalidate relevant pending approvals. Do not automatically recreate them.

There is no streaming or in-flight cancellation API in V1. `cancel()` removes a pending approval, and `dispose()` forgets managed state; neither promises to stop an already-dispatched provider call. A timeout can still incur charges. Stop, explain the uncertain state and obtain a new human decision before any new attempt.
