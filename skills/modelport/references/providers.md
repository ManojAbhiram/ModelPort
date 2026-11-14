# Provider Evidence

This reference is a selection/review guide, not a frozen list of executable providers. In the ModelPort checkout, consult `docs/PROVIDERS.md`, `packages/core/src/catalog.ts`, the actual adapters and their tests. In a consuming project, inspect the installed SDK's exported registry and its version. Never invent a remote repository or assume a similarly named npm package is official.

## Classify The Requirement

Map the product task to an exact operation: text, image understanding (`vision`), image generation (`image`), file transcription (`stt`), speech synthesis (`tts`) or text embedding (`embedding`). Identify media types, input limits, retention requirements and whether network/cloud processing is acceptable.

Provider status `ready` means an adapter exists; it is not proof of account entitlement or all-model/all-operation support. `planned` means non-executable in this version. A compatible chat endpoint does not establish compatible image, embedding or audio APIs.

The current V1 excludes enterprise IAM/OAuth integrations, realtime audio, streaming, tools, remote media URLs and asynchronous specialist jobs. Providers such as AWS Bedrock, Azure, Vertex, Replicate, fal, AssemblyAI and Cartesia remain planned where the registry says so. Do not misrepresent a missing adapter as a vendor limitation.

## Evidence Levels

| Evidence | Meaning | Not established |
| --- | --- | --- |
| `provider` | Capabilities came from provider metadata | Every account can use them |
| `reference` | The adapter uses reviewed reference information | The metadata is current forever or a live test passed |
| `declared` | A human explicitly asserted operations for this model | The provider verified it or inference succeeded |
| `unknown` | No adequate capability evidence is available | That all provider operations should be enabled |

Require both provider/adapter support and model support. If model operations are empty or an ID is absent, inspect official evidence and ask the human before a declaration. Do not call `declareModel` on the human's behalf just to make `prepare` accept a request.

## Non-Inference Checks

Review the exact authentication and metadata path, not just its HTTP verb. A protected identity endpoint can establish authentication at one time; a public list cannot. No metadata request proves model access, credits, quota, successful inference or universally zero-dollar pricing.

Useful official sources reviewed for ModelPort research on 2026-11-14:

- [OpenAI models](https://platform.openai.com/docs/api-reference/models/list): list metadata is not a generation test.
- [Anthropic models](https://docs.anthropic.com/en/api/models-list): apply the documented version/auth/workspace requirements of the installed adapter.
- [Gemini model API](https://ai.google.dev/api/models): supported methods and limits are evidence, not a complete entitlement or modality proof.
- [ElevenLabs authentication](https://elevenlabs.io/docs/api-reference/authentication) and [user metadata](https://elevenlabs.io/docs/api-reference/user/get): account-read permission is not every synthesis permission.
- [Deepgram authentication](https://developers.deepgram.com/guides/fundamentals/authenticating.md): `GET /v1/auth/token` is documented for key inspection; [model metadata](https://developers.deepgram.com/guides/fundamentals/model-metadata.md) is public.
- [Replicate account API](https://replicate.com/docs/reference/http#account.get): authenticated account information is not a prediction.
- [fal models](https://fal.ai/docs/platform-apis/v1/models.md): public access is allowed, so success cannot validate a key. [Billing access](https://fal.ai/docs/platform-apis/v1/account/billing.md) needs a separate permission and is not a reason to request a broader key.

Never use an empty prompt, a one-token completion, embedding, speech synthesis, image generation, uploaded file or created job as an automatic credential probe. The [fal authentication guide](https://docs.fal.ai/model-apis/authentication) contains a key-test example that generates an image; documentation examples still require independent side-effect review.

Treat `403` as possibly restricted permission/IP/region; `429` as possible throttling; network errors and `5xx` as inconclusive. Do not auto-fix them by using another key/model, increasing permissions or accepting agreements.

## Specialist And Enterprise Boundaries

Audio and image providers have operation-specific contracts. [AssemblyAI batch transcription](https://assemblyai.com/docs/getting-started/transcribe-an-audio-file) involves job submission/polling. [Cartesia voice discovery](https://docs.cartesia.ai/api-reference/voices/list) needs versioned metadata handling. [Replicate retention](https://replicate.com/docs/topics/predictions/data-retention) and the [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue.md) illustrate why artifact URLs, retries and cancellation need more than generic HTTP compatibility.

[Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) can involve subscriptions and EULA acceptance on first use. [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html), [Azure managed identity](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity), and [Vertex authentication](https://cloud.google.com/vertex-ai/docs/authentication) are separate credential/deployment models. Never provision, escalate roles, subscribe or read ambient credentials to make a planned provider appear supported.

## Adding An Adapter

Record official URLs and the review date; enumerate exact operations, fixed origins, header authentication, catalog/probe semantics and response formats. Use a guarded injected transport and synthetic fixtures. Test errors, malformed data, pagination, unknown models, media sizes and no-inference inspection paths. Update the matrix and distinguish documentation-only, mock-tested and live-tested evidence.

Review licenses and dependencies before reuse. Model metadata must not choose an npm package, executable schema, download, shell command or credential destination. [models.dev](https://github.com/anomalyco/models.dev) is reference data, not an authority to execute an integration.
