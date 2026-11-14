# ModelPort Research Notes

Reviewed: **2026-11-14**. Sources are official documentation, official open-source repositories and OWASP guidance. This report is independently authored; it is not copied upstream documentation or a third-party security assessment.

The research did not use provider credentials or make inference calls. A documented endpoint, a contract fixture and a successful live request are different kinds of evidence. Provider contracts below are documentation evidence; the separately recorded public-catalog smoke check establishes only anonymous metadata reachability.

## Decisions And Status

ModelPort combines a server-side TypeScript SDK, a React workbench and a portable coding-agent skill. The selected V1 is broader than the initial text-only research recommendation: it covers six operations through specifically implemented native/compatible adapters, with image input and audio file upload. It does not promise every operation on every provider.

The [product plan](PRODUCT.md) defines scope, the [provider matrix](PROVIDERS.md) owns current coverage, and `packages/core/src/catalog.ts` is the executable registry. Treat a provider as planned when the registry says so. The V1 SDK, app and offline tests are implemented; source research does not certify security or live inference compatibility.

| Area | Selected V1 direction |
| --- | --- |
| Runtime | Node >=22.12, original typed HTTP adapters, Fastify API, React/Vite UI |
| Operations | `text`, `vision`, `image`, `stt`, `tts`, `embedding`, restricted per adapter/model |
| Credentials | BYOK entered in the UI; managed only in server memory |
| Approval | Immutable, scoped, expiring, single-use requests; human decision enforced by the host |
| Locality | Loopback-only app; fixed cloud origins or constrained loopback provider endpoints |
| Media | Inline input/output, bounded size, signatures and image dimension headers |
| Verification | Non-inference metadata checks plus explicit capability provenance |
| Deferred | Streaming, realtime audio, tools, remote URLs, asynchronous specialist jobs, enterprise IAM and hosted multi-tenancy |

ModelPort is not a fork of AI SDK, LiteLLM or Open WebUI and does not use those projects as its runtime foundation. Their boundaries, tradeoffs and API patterns informed the design. Dependencies in the actual lockfile still require their own review.

## Public Catalog Smoke Check

On 2026-11-14, one anonymous GET to `https://openrouter.ai/api/v1/models?output_modalities=all` passed through ModelPort's guarded transport. It returned HTTP 200 with 1,134,687 response bytes and 728 catalog entries. No authorization header, credential, prompt, media, or inference request was sent. The catalog was not saved as a bundled model snapshot.

This verifies that public metadata could be retrieved and bounded at that time. It does not verify a key, account entitlement, model execution, all provider catalogs, prices, or future availability. Counts are a dated observation, not a fixed product claim.

## Open-Source Precedents

### Vercel AI SDK

Sources: [introduction](https://ai-sdk.dev/docs/introduction), [provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), [generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry), [license](https://raw.githubusercontent.com/vercel/ai/main/LICENSE).

AI SDK provides a useful separation between provider adapters, generation APIs and UI integration. Its Apache-2.0 license permits many forms of reuse subject to its terms; it does not license provider logos, hosted services or model weights.

Important defaults in the documentation reviewed:

- Plain string model identifiers can route through AI Gateway. A direct-BYOK application must choose its actual provider explicitly rather than silently introducing a gateway.
- Generation retries default to two. A human-approved single attempt must not inherit automatic retries accidentally.
- Some URL inputs can be downloaded automatically. Every such path needs the same SSRF controls as the main provider transport, or must be disabled.
- Lifecycle/telemetry callback errors are caught. Throwing in an observation callback is not an authorization gate.
- Telemetry can include inputs and outputs. An application must explicitly configure the pinned release; merely omitting an exporter is not equivalent to disabling all telemetry events.

ModelPort's selected implementation uses its own small HTTP adapters. If AI SDK is adopted later, preserve the existing approval and guarded transport boundaries rather than substituting a prompt, callback or default provider for them.

### LiteLLM

Sources: [documentation](https://docs.litellm.ai/docs/), [root license](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE).

LiteLLM is a useful reference for normalized provider responses/errors, credential configuration and proxy boundaries. A separate Python gateway is additional deployment and trust scope, so it is not required for this Node-first release.

The root license is MIT with an explicit carve-out for enterprise code. The enterprise license path referenced from that file returned 404 during review; its terms were not established. Do not treat all enterprise functionality as covered by the root MIT grant or copy that material into ModelPort.

### models.dev

Sources: [official site](https://models.dev/), [canonical anomalyco/models.dev repository](https://github.com/anomalyco/models.dev), [MIT license](https://raw.githubusercontent.com/anomalyco/models.dev/dev/LICENSE).

The repository and its default `dev` branch were verified. The README documents the catalog API at `https://models.dev/api.json`; older `sst` references may appear elsewhere. This is a community-maintained catalog, not an entitlement service for the user's account.

Model metadata can improve discovery, reference provenance and approximate context/cost information. It must not automatically grant capability support, select a package to install, change a provider origin or become executable schema/code. Prices and aliases can become stale. Any future imported snapshot needs attribution/license review and a review timestamp; ModelPort does not promise a live models.dev synchronization service in V1.

### Open WebUI

Sources: [documentation](https://docs.openwebui.com/), [security policy](https://docs.openwebui.com/security/security-policy), [data privacy](https://docs.openwebui.com/security/chat-data-privacy-and-encryption), [current license](https://raw.githubusercontent.com/open-webui/open-webui/main/LICENSE).

Open WebUI is a useful reference for local deployment, provider connection management and the consequences of powerful administrator features. Self-hosting does not itself isolate credentials or make arbitrary extensions safe.

The current license includes branding restrictions and exceptions, including a deployment-size exception at no more than 50 users in a rolling 30-day period. Do not assume that historical MIT/BSD descriptions apply to current code or that a rebranded fork is unrestricted. ModelPort uses an original UI and does not copy code or assets from it.

## License Boundaries

Original ModelPort code, skill and documentation use MIT. Architectural ideas can be implemented independently without copying upstream expression. If an upstream library becomes a dependency, its own license, notices and distribution obligations still apply; the ModelPort license does not replace them.

The following official specialist JavaScript SDK license files were also reviewed. This is not a list of ModelPort dependencies or executable provider support.

| SDK | License source |
| --- | --- |
| ElevenLabs | [MIT](https://raw.githubusercontent.com/elevenlabs/elevenlabs-js/main/LICENSE) |
| Deepgram | [MIT](https://raw.githubusercontent.com/deepgram/deepgram-js-sdk/main/LICENSE) |
| AssemblyAI | [MIT](https://raw.githubusercontent.com/AssemblyAI/assemblyai-node-sdk/main/LICENSE) |
| Cartesia | [MIT](https://raw.githubusercontent.com/cartesia-ai/cartesia-js/main/LICENSE) |
| Replicate | [Apache-2.0](https://raw.githubusercontent.com/replicate/replicate-javascript/main/LICENSE) |
| fal | [MIT](https://raw.githubusercontent.com/fal-ai/fal-js/main/LICENSE) |

These licenses say nothing about hosted-service prices, voice-cloning consent, model-weight licenses, trademarks, generated-content rights or provider retention. Review those separately before adding features. Cite security guidance instead of copying its prose or examples into a differently licensed document.

## Credential Inspection

"Non-inference" and "guaranteed free" are not interchangeable. A documented account/key/model metadata call avoids content generation, but the reviewed API references do not promise universally zero-dollar metadata access on every plan. A GET can be public or have side effects; a documented read-only-purpose operation can also use POST. Review the actual endpoint rather than relying on the HTTP verb.

Sources for common native model metadata: [OpenAI model list](https://platform.openai.com/docs/api-reference/models/list), [Anthropic model list](https://docs.anthropic.com/en/api/models-list), [Gemini model API](https://ai.google.dev/api/models).

Use separate claims for:

- Offline configuration validation: no network request, no proof that a credential works.
- Protected metadata authentication: the credential was accepted for that endpoint at that time.
- Public catalog reachability: no authentication conclusion.
- Model capabilities: provider metadata, reviewed references, explicit human declaration or unknown.
- Live inference: only a separately approved request can establish an observed result for that request.

An authenticated model list does not prove entitlement, credits, region availability, quota or successful generation. `403`, `429`, transport errors and `5xx` must not collapse into "invalid key". A failed metadata check must never trigger a one-token completion, an embedding, synthesis, upload or resource creation as a fallback.

## Specialist APIs

This section describes research, not the current coverage matrix. Consult [PROVIDERS.md](PROVIDERS.md) before selecting an executable operation.

| Provider | Official evidence | Design consequence |
| --- | --- | --- |
| ElevenLabs | [Authentication](https://elevenlabs.io/docs/api-reference/authentication), [user information](https://elevenlabs.io/docs/api-reference/user/get), [models](https://elevenlabs.io/docs/api-reference/models/list) | Server-side `xi-api-key`; keys may have scope, credit or IP restrictions. Model/voice support and character limits need separate handling. Account metadata success is not permission for every model or voice. |
| Deepgram | [Authentication and key test](https://developers.deepgram.com/guides/fundamentals/authenticating.md), [model metadata](https://developers.deepgram.com/guides/fundamentals/model-metadata.md), [API overview](https://developers.deepgram.com/reference/deepgram-api-overview.md) | `GET /v1/auth/token` is explicitly documented for key inspection. `/v1/models` is public. Prerecorded STT, streaming STT, TTS and Voice Agent are distinct surfaces, not one generic audio capability. |
| AssemblyAI | [List transcripts](https://www.assemblyai.com/docs/api-reference/transcripts/list), [batch transcription](https://assemblyai.com/docs/getting-started/transcribe-an-audio-file) | Reading existing transcript metadata is not new transcription. Upload, job submission, polling and retention introduce lifecycle/privacy work. Planned in this V1 rather than a guessed synchronous adapter. |
| Cartesia | [Voice listing](https://docs.cartesia.ai/api-reference/voices/list), [TTS models](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest) | Explicit version headers, model and voice IDs matter. Voice discovery does not prove synthesis will succeed. Planned until a native contract and tests are added. |
| Replicate | [HTTP API including account identity](https://replicate.com/docs/reference/http#account.get), [API tokens](https://replicate.com/docs/topics/security/api-tokens), [retention](https://replicate.com/docs/topics/predictions/data-retention) | `GET /v1/account` is non-inference identity evidence. Predictions are model/version-specific jobs. API prediction input/output data is removed after one hour by default. Planned: asynchronous jobs and remote artifacts are outside V1. |
| fal | [Authentication](https://docs.fal.ai/model-apis/authentication), [public model catalog](https://fal.ai/docs/platform-apis/v1/models.md), [billing access](https://fal.ai/docs/platform-apis/v1/account/billing.md), [queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue.md) | `/v1/models` allows unauthenticated access and cannot validate a key. Billing metadata requires `billing:usage:read`; do not ask for broader permissions solely for a check. Queue/media handling is planned, not implemented as generic OpenAI image generation. |

The fal authentication guide's "Test Your Key" example submits image generation. It must not be used as a no-inference credential check. The queue guide also documents automatic retries, `X-Fal-No-Retry`, publicly accessible result media, client timeouts that do not stop server work, and cancellation that may not stop an in-progress request.

Returned media URLs are not trustworthy instructions. If future adapters retrieve artifacts, apply origin/IP/size/type restrictions and send credentials only to specifically documented credential-bearing origins. V1 refuses remote input and output URLs instead.

## Enterprise Complexity

Enterprise integrations are planned because identity, scope, deployment and data-residency semantics need their own adapters and threat models.

**AWS Bedrock.** Sources: [IAM](https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html), [API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html), [STS identity](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html), [foundation-model listing](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html), [model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html), [inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html).

Bedrock supports AWS IAM credentials and separately documented short-/long-term bearer API keys. A caller identity is not model authorization. Region, entitlement and account-level restrictions matter. First third-party invocation can initiate subscription and implies EULA acceptance; never probe access by invoking or automatically creating an agreement. `GetFoundationModelAvailability` provides distinct metadata evidence. Cross-region profiles can route outside the selected region, affecting residency expectations.

**Azure.** Source: [Microsoft identity guidance](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity). Deployment names, resource endpoints, API variants, tenant roles and token refresh are not captured by a generic public model ID plus API key. Management-plane access does not prove inference access. Do not auto-provision resources or escalate roles to make a connection appear healthy.

**Vertex AI.** Sources: [authentication](https://cloud.google.com/vertex-ai/docs/authentication), [generative API authentication](https://cloud.google.com/vertex-ai/generative-ai/docs/start/gcp-auth). ADC, impersonation, workload identity federation, project/location and quotas need explicit handling. API-key support is method-specific and not interchangeable with IAM. Do not discover ambient cloud credentials or accept arbitrary credential JSON/executable credential sources from an untrusted client.

## Security Rationale

Primary guidance:

- [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/) for prompt injection, excessive agency, sensitive information and unbounded consumption.
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) for allowlists, redirects, IPv4/IPv6 and DNS/connection consistency.
- [OWASP Secrets Management](https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Secrets_Management_Cheat_Sheet.md) for minimizing access, lifecycle and logging exposure.
- [OWASP CSRF prevention](https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md) for cookie-authenticated request boundaries and origin checks.
- [OWASP File Upload guidance](https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/File_Upload_Cheat_Sheet.md) for type, signature, size and parser limits.
- [OWASP REST security](https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/REST_Security_Cheat_Sheet.md) for transport, authentication, input validation and safe errors.
- [OWASP prompt-injection guidance](https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.md) for treating model-visible content as untrusted and enforcing permissions outside the model.

Localhost is not authentication. Cross-site requests and inbound DNS rebinding require exact browser-facing host/origin/session controls. Outbound DNS validation must be tied to the actual socket connection; a preflight lookup followed by an independent resolver is insufficient. Fixed cloud origins and narrow local profile rules are more reviewable than a general fetch proxy.

Prompt wording does not grant or restrict real-world authority. Human approval must refer to the exact stored request, expire, be consumed once, and be checked by a trusted execution component. Credentials never belong in model-visible instructions. Model output must not become executable HTML, commands, packages or new provider destinations.

Fastify's [validation documentation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) warns that schemas are compiled using `new Function()`. Treat route schemas as reviewed application code, not remotely supplied model data. [Express security guidance](https://expressjs.com/en/advanced/best-practice-security.html) reinforces TLS for remote deployments, input validation, secure sessions and dependency review; it does not make a local prototype safe to expose publicly.

## Verification Risks

The release gate should exercise deterministic, no-provider-network tests for the following:

1. No inference during connection, refresh, model selection/declaration or approval preparation.
2. Replays, expiry, scope changes, input mutation and double submissions cannot bypass one-use approval.
3. A timeout does not cause a hidden retry, refund claim or "definitely not billed" result.
4. IPv6, alternate IP spellings, redirects, DNS changes, unsafe ports/paths and private metadata destinations cannot bypass egress policy.
5. Public catalogs and restricted metadata endpoints do not produce false authentication/capability claims.
6. Signatures, byte/pixel limits, malformed base64 and unsupported media fail closed without claiming full decoding or malware protection.
7. Canary keys never appear in connection views, errors, logs, telemetry, browser storage or examples.
8. Mocked browser tests cover review, separate consent, errors and mobile/keyboard behavior without real keys or private input.

Actual provider inference, exact prices, account entitlements and every supported codec remain unverified by documentation research. A later approved live test should record its precise provider/model/operation/date and must not expand a passing result into a universal claim.

## Skill And Repository Tooling

The [Agent Skills specification](https://agentskills.io/specification) defines portable `SKILL.md` frontmatter and references. Skill instructions are not authorization. ModelPort's skill contains no automatic inference or installation script and must preserve the user's current scope.

The optional [Skills CLI](https://github.com/vercel-labs/skills) documents [local-source installation](https://raw.githubusercontent.com/vercel-labs/skills/main/docs/commands.md); it is a separate tool with its own runtime requirement and telemetry policy, not a ModelPort dependency.

CI uses read-only repository permissions, no provider credentials and no deployment/publishing step. The [Playwright CI guide](https://playwright.dev/docs/ci-intro) notes that traces and reports may contain sensitive data; the initial workflow does not upload them.

Action commit pins were verified on the review date from official GitHub refs: [actions/checkout v7](https://api.github.com/repos/actions/checkout/git/ref/tags/v7) resolved to `3d3c42e5aac5ba805825da76410c181273ba90b1`; [actions/setup-node v7](https://api.github.com/repos/actions/setup-node/git/ref/tags/v7) resolved to `949feb2413d6458794dcd2491c4babbbce0c15c1`. Tags and latest documentation can change; the workflow pins commits, and updates need fresh review.

The repository owner must establish reporting channels and configure [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository) when available. A policy file does not enable GitHub settings, create a remote repository or publish a release.
