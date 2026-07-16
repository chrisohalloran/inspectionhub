# Devpost copy

## Project name

InspectionHub — field evidence to plain-language property reports

## One-line description

A local-first Building and Timber Pest inspection workflow that helps an
inspector capture evidence, investigate conditions, control source-grounded AI
and deliver separate, understandable reports from the field.

## The problem

A typical pre-purchase inspection can produce hundreds of photos. The inspector
then spends hours reconstructing which image belongs to which observation,
rewriting voice notes and assembling a templated report. Many recipients are
not construction experts, yet reports often foreground industry shorthand and
boilerplate over the actual condition of the property.

## What we built

InspectionHub starts with automated booking and the pre-inspection process. In
the field, the UI first says that capture is in progress; photos and voice notes
are acknowledged as saved evidence only after durable local publication and the
SQLite transaction complete, so capture does not wait for network or AI. Evidence can stay
as a coverage/dispute record or join an investigation thread with extent
checks, measurements, uncertainty and selected report candidates.

GPT-5.6 can suggest bounded report language from an exact evidence packet. A
separate verifier checks source provenance, qualifications, module taxonomy and
professional boundaries. The model cannot classify, approve, share or deliver.
The inspector reviews and approves Building and Timber Pest independently; a
package cannot render or enter the fake delivery outbox until both exact
versions are current.

The named recipient gets a progressive overview with Building major/minor
defects, a separate Timber Pest conclusion and material limitations. The report
describes observed condition and technical further investigation—it does not
give purchase, negotiation, valuation, repair-cost or legal advice.

## How we used Codex and GPT-5.6

Codex was the primary product and engineering environment: research synthesis,
adversarial UX work, architecture, schema and RLS design, implementation,
tests, security review, evaluation harnesses and submission machinery. GPT-5.6
is used where judgment adds value—planning a report draft from inspector-selected
evidence—inside deterministic authority, provenance, staleness and verifier
boundaries. The system includes a thin Responses baseline and a planner-led
candidate; promotion is evidence-based, not assumed.

## Technical implementation

The field client is Expo/React Native with an app-owned immutable evidence
store, SQLite ledger, restart reconciliation and an idempotent sync queue. A
Next.js app serves booking, inspector and named-recipient experiences. Postgres
is canonical with tenant/capability RLS, append-only events, transactional
outbox and fenced tasks. A Node worker handles verified ingestion, drafting and
report artifacts. Building and Timber Pest use separate immutable snapshots and
approvals. HTML, PDF and download bundles derive from the same canonical
version.

## Design and impact

The field interface is sunlight-readable, one-handed and explicit about local,
queued, failed and AI-review states. The recipient experience prioritises a
30-second overview without compressing distinct professional conclusions into a
score. Reducing office reconstruction could return meaningful hours to a small
inspection practice while improving the buyer's understanding of evidence and
limitations.

## Honest demo boundary

The Build Week demo uses synthetic/de-identified data and fake/test provider
adapters. It is not evidence of live payments or customer messages, Standards
or legal sign-off, production credential verification, Android support,
production restore, canonical-domain activation, real-customer readiness or
revenue. Public, physical-device, human and live-model claims must be backed by
the immutable milestone manifest before this copy is submitted.
