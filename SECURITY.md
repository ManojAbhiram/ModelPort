# Security Policy

ModelPort is an early, single-user, local-first application. Its controls reduce specific risks; they are not an independent audit, protection against a compromised machine, or permission to expose the service publicly.

This policy describes ModelPort's current security contract. Core, app and provider integration are still in progress. Maintainers must reconcile these statements with code and test results before a release. No live-provider security certification or universal zero-cost guarantee is made.

## Reporting

**Do not post vulnerabilities, exploit details, keys, private prompts, recordings or sensitive media in public issues or pull requests.**

No repository owner, public GitHub origin or security mailbox is asserted by this source checkout. Before public launch, the owner must establish a monitored private disclosure route and enable [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository) when the repository supports it.

Once configured, use the repository's **Security > Advisories > Report a vulnerability** action. If that action is absent, use a private maintainer contact explicitly published by the repository owner. If neither exists, request a private reporting route without describing the vulnerability publicly; do not send sensitive details to a guessed email address or an unrelated account.

A useful private report contains the affected revision, a minimal synthetic reproduction, prerequisites, the violated boundary, expected impact and any proposed fix. Include only the minimum information needed to reproduce the issue. Never send real provider keys, real-user media or broad environment dumps.

The project has no established response-time SLA or bounty. Security fixes target the current development line; support for historical releases will be documented when releases exist.

## Threat Model

The supported environment is a trusted user running the app on their own machine. ModelPort must handle hostile browser origins, malicious endpoint/configuration values, untrusted model metadata and responses, invalid uploads, and attempts to bypass approval controls.

Trusted components include the host operating system, the selected local model server, the Node process and its dependencies, and the user who approves requests. A local process with the user's privileges, a malicious browser extension, a debugger or a system administrator can bypass assumptions or read process memory. Loopback binding does not isolate different users or processes on the same machine.

The following deployments are not currently supported:

- Public internet, LAN, reverse-proxy or tunnel exposure.
- Hosted multi-user authentication, authorization and tenant isolation.
- Protection from root/admin users, compromised dependencies or a compromised device.
- An encrypted persistent credential vault or guaranteed secure erasure from JavaScript memory, swap or crash dumps.
- Model safety guarantees, malware scanning, full audio/video codec validation, or a sandbox for generated code.
- Provider-side data retention control, refund guarantees or an enforceable dollar spending limit.

## Credentials And Privacy

Keys entered through the workbench are retained only in the Node process's managed memory. The browser necessarily handles them transiently during input and transport. Connection responses must never contain keys, and the app must not put them in browser storage, cookies, URLs, source files, generated snippets or logs.

Disconnect removes the managed connection; restarting the API clears its in-memory state. Closing a tab is not a request to delete a credential. Removing references is not cryptographic erasure, and it does not revoke a key at its provider. Rotate or revoke an exposed key through the provider's own controls.

An SDK host may explicitly supply credentials from a server-side environment or secret manager. Validate that configuration without printing the value. Such external credential storage is owned by the host and is not deleted by `disconnect()` or `dispose()`. The workbench does not require dotenv or a file containing provider keys.

Keep credentials out of prompts, model-visible context, tool results, telemetry and exception dumps. Prefer allowlisted error fields to serializing arbitrary provider/SDK errors. Do not enable tracing or request-body logging with real credentials or private content.

Approved requests can disclose text/media to the selected provider. Results can contain sensitive content and remain visible in the current browser UI. Provider retention and service terms remain authoritative. A local service may relay requests to a cloud backend; local address does not mean local computation.

## Approvals And Cost

Every inference path must consume a server-held immutable approval with a five-minute TTL, a scope and one-use semantics. Approval preparation and metadata operations must not invoke models. Request changes require a new approval.

The SDK's `execute(id, { consent: true, scope })` is a programming interface, not authentication. The embedding host must authenticate the human approver, bind scope to that session, check ownership and CSRF as appropriate, and prevent untrusted agents or clients from asserting consent or choosing another session's scope. Scope alone does not implement connection ownership or multi-tenancy.

Untrusted agent code must never receive direct execution authority, credentials, a callable approving handler, or unrestricted access to the trusted SDK instance. Instructions in a skill or prompt to "ask the user" do not enforce this boundary.

There are no automatic inference retries, fallback models or background generation. Bounded output settings and a one-request concurrency limit reduce exposure; they do not establish a maximum dollar cost, particularly for images, audio or provider-side processing.

Cancelling a pending approval prevents later use of that approval. After a request is dispatched, timeout, disconnection, local cancellation or loss of the response does not prove provider execution stopped. Mark the result uncertain and potentially billed; never silently submit again.

## Network Boundary

The app binds to loopback. Its local session lasts up to eight hours and uses an HttpOnly, SameSite=Strict cookie, CSRF protection, exact host/origin checks and fetch-site checks. The bootstrap request requires the workbench client header. This is a trusted-local-workstation boundary, not a login proving a person's OS identity. CORS, cookie attributes and browser private-network restrictions are not substitutes for authorization in a separately hosted application.

Built-in cloud profiles use fixed official HTTPS origins. Local custom profiles permit canonical `127.0.0.1` or `[::1]` hosts, ports from 1024 through 65535, and the adapter's fixed base path. The literal name `localhost` is normalized to `127.0.0.1` rather than resolved through DNS. These profiles are not arbitrary HTTP proxies or LAN discovery features. Do not weaken validation to allow Docker gateways, `0.0.0.0`, metadata services or a conveniently named internal domain without a separate design review.

The guarded Node transport must enforce approved origins and public destination IPs at connection time for cloud requests, including IPv4 and IPv6. DNS validation followed by an unrelated unchecked fetch leaves a rebinding gap. TLS validation must remain enabled. Redirects and environment-inherited proxies are not allowed escape routes.

All adapter traffic must use the guarded transport. Do not bypass it through a third-party SDK, raw fetch, automatic media download, catalog URL, provider-returned URL or remote schema reference. A known API response is not authority to fetch a different origin or forward a key there.

The application does not fetch remote input or generated-media URLs. Only supported inline media responses are accepted. Reference/catalog metadata must never select executable code, npm packages or secret destinations.

## Uploads And Responses

Media is inline and capped at 4 MiB decoded input. Allowed image MIME types are PNG, JPEG and WebP; audio types are MPEG/MP3, WAV, Ogg, WebM and FLAC. Provider-specific subsets may be narrower. Text input is capped at 16,000 characters, and upstream responses at 16 MiB.

Check type allowlists, byte limits, signatures and image dimension headers. Images are limited to 8192 pixels per side and 16,777,216 total pixels; animated PNG/WebP is rejected. Do not trust a filename, MIME header, claimed Content-Length or base64 prefix. Reject unsupported formats, malformed input and excessive dimensions before inference is approved. These checks do not establish that an audio file is fully decodable or that any accepted file is free of malicious content.

Do not extract archives, parse Office/PDF documents, transcode arbitrary files, or fetch user-provided URLs as a convenience feature. Browser previews and outputs must not execute HTML/SVG or load unsolicited remote resources. Model output and provider error messages are untrusted, including when an HTTP response succeeded.

## Metadata And Capabilities

Credential inspections and catalog refreshes use documented non-inference requests. A public model list can only establish reachability/catalog availability. Authenticated metadata does not prove model entitlement, remaining credits, rate-limit availability, successful inference, or universally zero-dollar metadata billing.

Preserve capability provenance: provider metadata, reviewed reference information, human declarations and unknown information are different states. Do not guess that every model supports every adapter operation. A declaration is an explicit user assertion, not provider verification, and must not bypass adapter-level operation limits.

Errors such as `403`, `429`, timeouts and `5xx` can represent scope, network or service conditions rather than an invalid key. Do not auto-fix a failed probe by generating content, broadening permissions, subscribing to a model or creating resources.

## Testing And Dependencies

Routine tests use synthetic fixtures and mocked transports/API responses. They must not require or discover live provider credentials. Cover approval races/replays, cross-session use, host/origin/CSRF checks, SSRF including DNS changes and IPv6, upload limits and credential-free errors.

Passing offline tests is not proof of live provider behavior or resistance to every attack. Record test versions and remaining gaps. Any live test needs a separate informed human decision about exact inputs, account, model, operation and possible cost.

Dependencies and Actions require ongoing review. CI uses read-only repository permissions and pinned official action commits; no provider secrets or publishing permissions are needed. Do not use `pull_request_target` to run untrusted contributor code. Browser reports/traces can contain sensitive input and must not be published without review.

This policy describes ModelPort's security boundaries and is independently authored. The [provider matrix](docs/PROVIDERS.md) records provider documentation sources. References to upstream projects are not claims that those projects audited ModelPort.
