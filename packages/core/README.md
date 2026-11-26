# @manojabhiram/modelport-core

Server-side TypeScript foundation for ModelPort, a local workbench to inspect, test, and approve AI API requests.

The SDK requires Node.js 22.12 or newer and uses ES modules. From the source repository root, run `npm ci`, `npm run build`, and `npm start` to use the workbench. See the [ModelPort README](https://github.com/ManojAbhiram/ModelPort#readme), [security policy](https://github.com/ManojAbhiram/ModelPort/blob/main/SECURITY.md), and [getting started guide](https://github.com/ManojAbhiram/ModelPort/blob/main/docs/GETTING-STARTED.md) for setup, limits, and responsibilities.

The SDK supports provider metadata, conservative capability discovery, and immutable, scoped, expiring, one-use inference approvals. Metadata authentication does not prove model access, credits, or successful inference. No automatic inference retries or fallback models are provided.

Keep SDK instances and credentials on a trusted Node server. The embedding host must authenticate the human, enforce connection ownership and session/CSRF controls, display the full request for review, and execute only after a separate explicit human decision. `consent: true` alone is not authorization.

MIT licensed; see the included LICENSE. Dependencies and provider services have their own terms. This package does not license models, provider trademarks, voices, or generated output.
