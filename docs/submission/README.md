# Build Week submission pack

Status: **blocked — do not represent as submitted or complete**
Checked: 17 July 2026, Australia/Brisbane

Official submission deadline: **22 July 2026 at 10:00 AM AEST** (21 July,
5:00 PM Pacific Time). Selected track: **Work and Productivity**. Keep every
judge-facing asset working through at least 12 August 2026.

Primary sources: [official rules](https://openai.devpost.com/rules),
[challenge page](https://openai.devpost.com/) and
[official FAQ](https://openai.devpost.com/details/faqs).

The product narrative and submission copy are ready for review. External proof
is not. `pnpm milestone:submission` evaluates the official Devpost preflight;
`pnpm milestone:build-week` separately evaluates the stricter internal product
validation contract. Neither result may be replaced by a checklist ticked by
the builder.

| Asset                                          | Current evidence state                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project description                            | Drafted in `devpost-copy.md`; not verified in Devpost                                                                                             |
| Demo script                                    | Drafted at 2:50; not rehearsed or published                                                                                                       |
| Public video URL                               | Unproven                                                                                                                                          |
| Public repository URL                          | Logged-out HTTP 200 observed; evidence input pending                                                                                              |
| Public demo URL                                | Unproven                                                                                                                                          |
| Local judge test build                         | One-command synthetic path observed; input pending                                                                                                |
| Logged-out asset review                        | Unproven                                                                                                                                          |
| Repository licence                             | AGPL-3.0-only                                                                                                                                     |
| Primary Codex `/feedback` Session ID           | Goal task ID recorded; `/feedback` confirmation due                                                                                               |
| Physical Build Week iPhone journey             | Internal validation unproven; not a Devpost field                                                                                                 |
| Live GPT-5.6 development + locked-holdout gate | Not run; no API credential was made available to this workspace, and exposed holdout-labelled fixtures cannot count as blinded promotion evidence |
| Two recipient and two client sessions          | Unproven                                                                                                                                          |
| Accessibility audit                            | Internal validation unproven; not a Devpost field                                                                                                 |
| Devpost submission                             | Not performed                                                                                                                                     |

Public repository:
`https://github.com/chrisohalloran/inspectionhub`

Primary goal task ID:
`019f5dd7-1480-7ca1-8307-3ed24a80559d`. This is retained as provenance, but
the exact `/feedback` value must still be confirmed in Codex before the form is
submitted rather than assumed to be identical.

No `OPENAI_API_KEY` is configured in this workspace. The deterministic suite
fails closed with exit code 5 when live evaluation is required, and no key was
created or copied through an unsafe fallback. The live GPT-5.6 requirement
therefore remains blocked until a project API key is configured and the bounded
live evaluation is observed.

## Official asset contract

The Devpost entry must include one selected track, a working project, the text
description, a public YouTube video shorter than three minutes, the repository
URL with relevant licensing, a README with setup/sample/test instructions and
the Codex/GPT-5.6 decision story, and the `/feedback` Codex Session ID for the
primary build task. Judges require free working access through a website,
functioning demo, test build, sandbox or test account through judging.

The video must show the working product and use English audio to explain what
was built, how Codex was used and how GPT-5.6 is integrated. The target remains
2:50, leaving a ten-second compliance margin. Do not use unlicensed music,
third-party marks, copyrighted Standards text or real customer/property data.

The product must use both Codex and GPT-5.6 meaningfully. Deterministic model
fixtures alone therefore cannot satisfy the submission: the public demo,
repository and video need an observed GPT-5.6 run with an inspector-reviewable,
source-grounded result and a visible manual fallback.

Devpost requires a working judge-access path, but does not require a separate
physical-iPhone, human-session or accessibility-audit record. Those remain
quality evidence in the internal gate. A simulator run without a website,
functioning demo or test build still does not satisfy judge access.

## Submission materials

- [Demo script](demo-script.md)
- [Devpost copy](devpost-copy.md)
- [Architecture](architecture.md)
- [Setup and verification](setup.md)
- [Local judge demo](judge-demo.md)
- [Privacy and limitations](privacy-limitations.md)
- [Codex and GPT-5.6](codex-and-gpt.md)
- [Evidence collection guide](evidence-guide.md)

Before submission, reopen the official Devpost challenge page from a logged-out
browser and record the observed fields, rules and link checks. The public video,
public repository (when public) and any public judge-access URL must work logged
out; the README and submission-description fields must be complete. Do not
replace those observations with localhost, build logs or hosting-provider
status.

The final Devpost URL and submission receipt are post-submit observations. They
are deliberately excluded from preflight so the gate does not depend on an
asset that cannot exist until after submission.

## Exact U12 boundary

The Build Week milestone does not prove live professional credential
verification; production correction/withdrawal; privileged production auth or
secret rotation; production retention/deletion/holds/restore; live payment,
calendar, email or delivery-provider results; real-customer readiness; licensed,
legal, privacy or Standards-matrix sign-off; Android support-floor durability;
canonical production domains; measured production restore; or first revenue.
The manifest lists those boundaries individually as unproven unless a later,
separate observation proves one.
