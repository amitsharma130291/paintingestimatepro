# Three-consecutive-clean-run stability log

Numerical-hardening initiative, section 11. **Rerun in full at the actual
final code-bearing commit** — the previous sequence recorded here was run
at commit `f3b6768`, which predates the `readNdjson` fail-loudly fix
(`2687807`), the TypeScript-error corrections (`6e1227f`), the
mutation-report reconciliation (`aa4febd`), and the `src/env.d.ts` fix
(`bf7746d`), so it no longer represented the state being shipped. An
intermediate rerun at `aa4febd` is also superseded, for the same reason
`FRESH_EXTRACTION_VERIFICATION_LOG.md` documents: `aa4febd` still had the
missing-`src/env.d.ts` gap, fixed in `bf7746d`. See
`FINAL_NUMERICAL_VERDICT.md` for the full commit lineage.

Commit under test: `bf7746da1815ec0044ac36a084edbd8f9a9b3410`. No file
changes between runs. Command: `npx vitest run --maxWorkers=4` (same
bounded-concurrency rationale as the original sequence below — this
project's shared-machine environment shows genuine contention at full
concurrency; capping workers avoids spurious timing-based failures in
unrelated UI tests without masking any real defect).

## Run results (current, at final commit `bf7746d`)

| Run | Test files | Tests passed | Skipped | Failed | Duration | Exit code |
|---|---|---|---|---|---|---|
| 1 | 109/109 | 1397 | 3 | 0 | 61.05s | 0 |
| 2 | 109/109 | 1397 | 3 | 0 | 65.09s | 0 |
| 3 | 109/109 | 1397 | 3 | 0 | 96.60s | 0 |

All three runs report **identical totals**, matching the independently-
reported unrestricted-Linux-environment result (109/109 files, 1397
passed, 3 skipped, 0 failed) exactly. Skipped count (3) matches the
project's own long-standing R01/R02/R14 skip set (confirmed by the
skip/only/todo sweep in the same final-gates pass — see
`FRESH_EXTRACTION_VERIFICATION_LOG.md`).

## Historical record: intermediate rerun at commit `aa4febd`, also superseded

| Run | Test files | Tests passed | Skipped | Failed | Duration | Exit code |
|---|---|---|---|---|---|---|
| 1 | 109/109 | 1397 | 3 | 0 | 79.30s | 0 |
| 2 | 109/109 | 1397 | 3 | 0 | 98.33s | 0 |
| 3 | 109/109 | 1397 | 3 | 0 | 91.83s | 0 |

Identical totals to the final sequence above — the `bf7746d` commit's
only change over `aa4febd` is adding `src/env.d.ts` (a type declaration
file with zero runtime effect), so this was expected and confirms the
rerun was not masking a regression.

## Exit criteria

- Three consecutive complete runs: **3/3**, all clean
- Zero failures across all three: **confirmed**
- Zero worker crashes, zero retries: **confirmed**
- Identical totals across all three: **confirmed** (109 files / 1397
  passed / 3 skipped / exit 0, every time)
- Run at the actual final code-bearing commit (not a superseded one):
  **confirmed** (`aa4febd`)

## Historical record: the original sequence at commit `f3b6768`

Preserved below for audit trail. This sequence is **superseded** by the
one above and must not be cited as evidence of the current, final code's
behavior — it predates the `readNdjson`, TypeScript-error, and
mutation-reconciliation corrections.

Commit under test: `f3b6768` ("test: reach 1,004 meaningful deterministic
cases (section 5)"). No file changes between runs. Command: `npx vitest
run --maxWorkers=4` (reduced concurrency — see rationale below).

### Why reduced concurrency

The default full-concurrency run (`npm test`, which spawns one worker per
test file — 109 workers) showed genuine, reproducible contention on this
shared machine during this session: two consecutive attempts each failed
14-15 unrelated browser/integration test files (all `waitFor(...'Draft
saved.'...)`-style timing assertions, none in any file touched this
session), both confirmed as contention (not defects) by isolating the
failing tests standalone, where they passed immediately. System state at
the time showed one long-running background process with ~12 hours of
accumulated CPU time (a sibling project's dev server, consistent with this
project's own long-documented shared-machine contention pattern) plus the
109-worker spawn itself. Capping concurrency to 4 workers immediately
produced a clean run, and then two more in a row.

### Run results (historical, at commit `f3b6768`)

| Run | Test files | Tests passed | Skipped | Failed | Duration | Exit code |
|---|---|---|---|---|---|---|
| 1 | 109/109 | 1397 | 3 | 0 | 91.99s | 0 |
| 2 | 109/109 | 1397 | 3 | 0 | 88.63s | 0 |
| 3 | 109/109 | 1397 | 3 | 0 | 87.88s | 0 |

All three runs reported identical totals. Skipped count (3) matched the
project's own long-standing R01/R02/R14 skip set.
