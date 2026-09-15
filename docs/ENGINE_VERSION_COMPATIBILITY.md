# Engine Version Compatibility Policy (BACK-026)

This document resolves BACK-026 ("Import unknown future engine version
with schema=2 → Validate/display → Compatibility check per documented
policy; never silently recalc unsupported issued data") with a concrete,
implemented, and tested decision. It is not a placeholder — the policy
below is live in `src/domain/engineCompatibility.ts`,
`src/domain/estimateAssembly.ts`, and `src/domain/backup.ts`.

## Background

Two distinct version tags already exist in the data model, and this
policy only concerns one of them:

- `BackupEnvelope.schemaVersion` — the on-disk **shape** of the JSON
  envelope. Already strictly enforced (`validateBackupEnvelope` rejects
  any value other than the current `SCHEMA_VERSION`, "no silent
  migration" per DATA_CONTRACT.md). Unaffected by this document.
- `RateSnapshot.engineVersion` (`revision.activeRateSnapshot.engineVersion`)
  — which **calculation formulas** a snapshot's rates/settings were
  captured to be used with. This is the version this document is about.
- `EstimateRevision.rawCalculatedOutputs.engineVersion` — the version
  that actually **produced a frozen, issued result**. Also covered here.

## The core distinction: live recalculation vs. frozen display

Everything in this policy follows from one architectural fact: a
**draft** revision has no independent stored result — every number shown
for it is produced by running **today's** `assembleProjectEstimate` code
against the **stored** `activeRateSnapshot`. An **issued** revision's
numbers, by contrast, are captured once into `rawCalculatedOutputs` /
`customerDocumentSnapshot` at the moment of issue and are — by an
existing, separate, already-implemented rule — **never recalculated
again**, regardless of anything that happens to the app afterward.

This means the compatibility question is only ever meaningful for
drafts. Issued data has no "recalculation" step to protect against
misinterpreting.

## Decision

1. **Current supported engine version.** `ENGINE_VERSION` in
   `src/domain/entities.ts` (currently `"2.1.0"`). This is always a
   member of `RECOGNIZED_ENGINE_VERSIONS`
   (`src/domain/engineCompatibility.ts`) — a build must always trust its
   own version.

2. **`RECOGNIZED_ENGINE_VERSIONS`** is an explicit safelist of every
   engine version this build's formulas are known to be safe to
   recalculate against. Today it contains exactly one entry (there has
   only ever been one shipped version). Extending it is a **deliberate,
   audited decision** made when the engine's formulas change — never
   automatic, never inferred from a version-number comparison (a higher
   version number is not assumed compatible; an explicit audit decides).

3. **Older issued revisions with frozen outputs.** Read-only, always.
   `readFrozenCalculatedOutputs` never calls into this compatibility
   policy at all — it already only rejects a record whose *numbers*
   don't parse (`CalculationSnapshot`'s own, pre-existing schema check),
   never one whose `engineVersion` tag is merely old. The UI (Actual
   review tab) shows an **informational, non-blocking** note whenever a
   frozen baseline's `engineVersion` differs from the running app's own
   `ENGINE_VERSION`: *"Calculated with app engine version X (this app is
   Y) — these frozen figures are preserved exactly as issued and are
   never recalculated."* This is disclosure, not a warning — nothing is
   blocked, because nothing is ever recalculated.

4. **Older drafts.** A draft whose `activeRateSnapshot.engineVersion` is
   in `RECOGNIZED_ENGINE_VERSIONS` (which, absent an engine change since
   this policy shipped, is every draft that already existed) calculates
   normally with today's formulas — this is the existing, correct, and
   intended behavior: a draft is always "live" until issued, and rate
   refresh already exists as the explicit, user-confirmed mechanism for
   intentionally updating a draft's rates.

5. **Unknown/future engine versions.** A draft whose
   `activeRateSnapshot.engineVersion` is **not** in
   `RECOGNIZED_ENGINE_VERSIONS` (most realistically: the draft was
   created by a newer build, and an older build is now open — this app
   has no user-facing version pinning, so this is the one realistic path
   today, alongside a deliberately or accidentally corrupted import) is
   **never silently recalculated**. `assembleProjectEstimate` refuses at
   the very first step and returns a structured `invalid` result whose
   reason names the actual unrecognized version, the versions this build
   *does* support, and an explicit recovery instruction. No numeric
   output (materials, labor, job cost, price) is ever produced for this
   case — the existing `invalid`-state rendering path (already used for
   every other invalid-input case in the app) surfaces the message with
   no new UI code required.

6. **Backup import behavior.** `validateBackupEnvelope` rejects, before
   any write, any **draft** revision whose `activeRateSnapshot.engineVersion`
   is unrecognized — consistent with every other field this validator
   already checks atomically (a bad field on one revision or project
   rejects the whole import). An **issued** revision is explicitly
   exempt from this check at import time, for the same reason it is
   exempt from recalculation: its data is frozen and safe to store and
   display regardless of version.

7. **Read-only compatibility.** Achieved automatically by the existing
   frozen-data architecture (point 3) — no separate "read-only mode" flag
   was needed. An issued revision was already never recalculated before
   this policy existed; this document only adds the informational
   version-mismatch notice on top of that pre-existing guarantee.

8. **Migration requirements.** None today. This policy's job is to
   *prevent* a future silent break, not to migrate existing data — there
   is only one engine version in the wild so far, and it is the current
   one. When a real future engine version bump happens, extending
   `RECOGNIZED_ENGINE_VERSIONS` is the deliberate trigger point for
   whatever migration or compatibility work that specific change
   actually requires; this document does not pre-commit to a migration
   strategy for a change that hasn't been designed yet.

9. **When recalculation is permitted.** Only when
   `activeRateSnapshot.engineVersion` is in `RECOGNIZED_ENGINE_VERSIONS`.

10. **When recalculation is prohibited.** Whenever
    `activeRateSnapshot.engineVersion` is not recognized. This is an
    absolute rule enforced at the single chokepoint every draft
    calculation already passes through (the top of
    `assembleProjectEstimate`) — there is no second code path that
    computes a project estimate.

11. **User-visible recovery instructions.** The blocked-draft message
    explicitly says which version created the draft, which versions this
    build supports, and to open the draft in the app version that
    created it (or contact support) rather than continuing here. The
    frozen-baseline notice (point 3) is informational only and needs no
    recovery instruction, since nothing is blocked.

12. **Prevention of silent reinterpretation by a different engine
    version.** This is the central guarantee: an unrecognized version is
    never treated as compatible by omission, by a version-number
    comparison, or by a generic try/catch that happens to succeed. It is
    checked explicitly, by an exact membership test against a safelist
    that only grows through a deliberate code change.

## Where this lives in code

- `src/domain/engineCompatibility.ts` — `RECOGNIZED_ENGINE_VERSIONS`,
  `isRecognizedEngineVersion`, `isDraftEngineVersionSupported`.
- `src/domain/estimateAssembly.ts` — `assembleProjectEstimate` refuses to
  compute a draft against an unrecognized version (first check in the
  function, before any other validation).
- `src/domain/backup.ts` — `validateRevisionStructure` rejects an
  unrecognized-version **draft** on import; an **issued** revision is
  exempt.
- `src/components/tools/pro/ProApp.tsx` — the Actual review tab's
  informational (non-blocking) notice for a frozen baseline from a
  different engine version; the blocked-draft message reaches the screen
  through the existing `calculationState === 'invalid'` rendering path,
  with no separate UI branch required.

## Tests

- `tests/domain/engineCompatibility.test.ts` — the safelist itself, and
  that `assembleProjectEstimate` refuses (never throws, never returns a
  partial numeric result) for an unrecognized version while a recognized
  one calculates normally; confirms `readFrozenCalculatedOutputs` never
  even consults this policy.
- `tests/domain/backup.test.ts` (`BACK-026` block) — import rejects an
  unrecognized-version draft, accepts the same version on an issued
  revision, accepts the normal current-version case, and atomically
  rejects a whole multi-project import over one bad revision.
- `tests/browser/engineVersionNotice.test.tsx` — the real UI: the
  blocked-draft message rendering through the existing invalid-state
  path, and the informational frozen-baseline notice appearing only when
  versions actually differ.
