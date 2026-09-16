# State-transition coverage report

Numerical-hardening initiative, section 6. Executable suite:
`tests/domain/stateTransitions.test.ts` (10 describe blocks, 10 tests, all
passing). Each sequence walks the REAL production domain functions
end-to-end (never a duplicated/simulated state machine), asserting
numeric/state output at every step, not just the final one.

| Required sequence | Test | Result |
|---|---|---|
| `blank → incomplete → complete → invalid → complete` | `State transition: blank -> incomplete -> complete -> invalid -> complete` | PASS |
| `draft → save → reopen` | Covered as the first three steps of `State transition: draft -> saved -> reopened -> refreshed -> undone -> issued` | PASS |
| `draft → rate preview → cancel` | `State transition: draft -> rate preview -> cancel (no writes)` (new) | PASS |
| `draft → rate refresh → undo → reapply` | `State transition: draft -> rate refresh -> undo -> reapply` (new; extends the existing refresh/undo sequence with a reapply step) | PASS |
| `draft → issue` | Covered as the final step of `State transition: draft -> saved -> reopened -> refreshed -> undone -> issued` | PASS |
| `issued → edit → new draft → issue → previous superseded` | `State transition: issued -> new draft -> changed -> issued -> prior superseded` | PASS |
| `estimate → partial actuals → completed actuals → reopen` | `State transition: estimated -> partial actuals -> complete actuals -> reopened` | PASS |
| `export → preview → cancel without writes` | `State transition: exported -> previewed -> cancelled (no writes)` | PASS |
| `export → merge conflict → resolve → restore` | `State transition: export -> merge conflict -> resolve -> restore` (new) | PASS |
| `export → import as copy` | `State transition: exported -> imported as copy` | PASS |
| `supported → out-of-range → corrected` | `State transition: supported -> out-of-range -> corrected` (new) | PASS |
| `failed persistence → recoverable current work` | Already covered end-to-end at the UI layer by `tests/browser/uxRaceAndFailureGuidance.test.tsx`'s `UX-010` block (mocks a real `saveProjectSafely()` rejection against the actual `ProApp` component, confirms current work stays visible/exportable) — a duplicate domain-level test would exercise the identical failure path with no additional numeric assertion | PASS (cited, not duplicated) |

## New sequences added this session

- **`draft → rate preview → cancel`**: confirms `previewRateRefresh()` is
  genuinely read-only — a byte-identical `JSON.stringify` comparison of the
  draft before and after a preview whose diff is discarded rather than
  applied.
- **`draft → rate refresh → undo → reapply`**: extends the existing
  refresh/undo coverage with a third step — reapplying the same live rates
  after an undo reaches the exact same refreshed numeric state as the
  first application, ruling out drift across an undo cycle.
- **`export → merge conflict → resolve → restore`**: a same-project-id,
  different-content conflict between a local and an incoming backup is
  correctly flagged by `planFullRestoreMerge()`; resolving it
  `'replaceImported'` and running `applyFullRestoreResolutions()` commits a
  write carrying the imported content and the version captured at preview
  time (for the caller's version-checked transaction).
- **`supported → out-of-range → corrected`**: a project whose materials
  cost genuinely exceeds `AGG-003`'s $1,000,000,000 aggregate ceiling
  (while every individual field, including price-per-gallon, stays within
  its own bound) is flagged `outOfSupportedRange: true`; substituting a
  realistic catalog price brings the same project back to a normal
  `complete` result.

## Exit criteria

All 12 sequences from the standing spec are exercised — 6 pre-existing, 4
newly added, 1 already covered as a subsequence of an existing test, 1
already covered by an existing UI-level test cited above.
