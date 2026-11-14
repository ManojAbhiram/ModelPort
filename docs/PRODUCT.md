# ModelPort: First-Version Plan

ModelPort is an open-source, local-first integration workbench for developers adding AI to a product. It combines a reusable TypeScript SDK, a browser interface, and an installable coding-agent skill. Bring your own provider credentials, inspect available models, match a model to an operation, and explicitly approve a request before any inference occurs.

## Product principles

- One integration surface, not one lowest-common-denominator promise. Adapters expose only operations actually implemented for their provider.
- Metadata before inference. Credential checks and catalog refreshes never generate text, images, speech, or embeddings.
- Honest verification. An authenticated metadata request does not prove model entitlement, available credits, successful inference, or that a provider will never charge for metadata.
- Honest capabilities. Provider-declared, reference-derived, human-declared, and unknown model capabilities remain distinguishable.
- Human control. Every inference request requires a short-lived, immutable, single-use approval. A changed request needs a new approval. There are no automatic retries, model fallbacks, agent tool calls, or background generation.
- Local by default. The web server binds only to loopback. Keys remain in server memory and disappear on restart. This is not a multi-tenant hosted service.

## Version 1

1. A typed provider registry with native and OpenAI-compatible adapters, provider documentation links, explicit unsupported entries, and a safe extension path.
2. Read-only credential inspection, provider model discovery, conservative capability classification, and explicit human declarations when metadata is incomplete.
3. Text, image understanding, image generation, speech-to-text, text-to-speech, and embeddings where an adapter implements the operation. Audio starts with file upload, not continuous microphone recording.
4. A responsive provider library, connection management, capability-aware playground, an approval review step, and a developer integration guide.
5. A reusable approval-gated SDK and coding-agent skill for product integration. The SDK is framework-independent and server-side only.
6. Contributor guidelines, security policy, issue/PR templates, automated checks, and a source-linked research report.

## Architecture

`apps/web` (React + Vite) communicates with `apps/server` (Fastify) over a same-origin session and CSRF-protected API. The server owns an in-memory `ModelPort` SDK instance. `packages/core` owns validation, the provider registry, guarded HTTP transport, model normalization, and one-use inference approvals. Provider keys are never returned through the API.

The SDK transport only calls allowlisted official HTTPS origins or explicitly configured literal loopback endpoints. Redirects are refused, public DNS resolutions are checked at connection time, input and response sizes are capped, and requests have timeouts. Uploaded media is inline, size-limited, and signature-checked; the server never downloads user-supplied URLs.

## Deliberate limits

"Every LLM provider" is an extensibility goal, not a truthful finite release claim. Enterprise IAM/OAuth services, provider-specific asynchronous image/video jobs, realtime audio, fine-tuning, arbitrary tools, and hosted tenant management require separate adapters and threat models. The provider directory must mark these as roadmap items rather than imply OpenAI API compatibility.

Local execution can still consume CPU/GPU resources or route through a provider's cloud-backed local model. No model execution is described as free. Actual provider billing remains authoritative. V1 has no guaranteed dollar budget enforcement because metadata does not establish an enforceable price or usage cap.

## Acceptance criteria

- No model call is made by connecting, inspecting credentials, refreshing catalogs, declaring capabilities, switching selection, or preparing an approval.
- Rejected, expired, reused, cross-session, or modified approvals cannot execute.
- Keys do not appear in connection responses, storage, logs, generated examples, or committed files.
- Unsupported operations and unknown capabilities fail closed until a human explicitly declares a supported operation.
- Automated tests cover provider contracts, network boundaries, upload validation, approvals, API security, and the browser's approval workflow without live credentials or paid calls.
- The interface works with keyboard navigation, reduced motion, desktop and mobile layouts, and no external fonts, analytics, or CDN assets.

## Release sequence

Research and capability matrix; shared SDK contracts; adapters and transport; approval-gated API; workbench; security and browser tests; contributor documentation; authenticated GitHub publication by the repository owner.
