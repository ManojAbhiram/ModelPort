## Change

Describe the user-visible behavior and the scope of this change. Link a relevant issue if one exists; do not put vulnerability details in a public PR.

## Evidence

For provider changes, include official source URLs, review date, API version, exact operations and capability provenance. Explain what remains unknown or deferred.

## Verification

List the exact commands run and their results. Explain skipped checks. Synthetic contract tests are not live provider verification.

- [ ] `npm run check`
- [ ] `npm run test:e2e` for affected browser behavior
- [ ] New behavior has deterministic fixtures or an explanation of the testing gap.
- [ ] No live or paid calls were made for this change, or any separately authorized live testing is explicitly described without credentials or private inputs.

## Security And Cost

- [ ] No API keys, environment dumps, private prompts, audio, media or sensitive browser traces are included.
- [ ] Metadata/connection/refresh/prepare paths do not invoke models, create resources or promise universally free checks.
- [ ] Inference still requires an immutable, scoped, expiring, one-use approval and host-authorized human consent.
- [ ] No automatic retries, fallback models, background generation or new unapproved execution paths were introduced.
- [ ] All outbound traffic uses the guarded transport; URL, DNS, redirect and credential-origin boundaries remain intact.
- [ ] Upload limits, response limits, credential redaction and safe output rendering are preserved.
- [ ] New dependencies, licenses and third-party materials have been reviewed.
- [ ] The provider matrix, skill or user documentation was updated where behavior changed.

## Remaining Risks

Document uncertain billing/timeout behavior, missing live verification, compatibility limits and any follow-up work. Do not describe an unimplemented safeguard as complete.
