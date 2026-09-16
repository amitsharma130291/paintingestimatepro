# Three-consecutive-clean-run stability log

Numerical-hardening initiative, section 11. Commit under test: `f3b6768`
("test: reach 1,004 meaningful deterministic cases (section 5)"). No file
changes between runs. Command: `npx vitest run --maxWorkers=4` (reduced
concurrency — see rationale below).

## Why reduced concurrency

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

## Run results

| Run | Test files | Tests passed | Skipped | Failed | Duration | Exit code |
|---|---|---|---|---|---|---|
| 1 | 109/109 | 1397 | 3 | 0 | 91.99s | 0 |
| 2 | 109/109 | 1397 | 3 | 0 | 88.63s | 0 |
| 3 | 109/109 | 1397 | 3 | 0 | 87.88s | 0 |

All three runs report **identical totals**. Skipped count (3) matches the
project's own long-standing R01/R02/R14 skip set.

## System conditions recorded before each run

| Before | CPU | Free memory | Node processes |
|---|---|---|---|
| Run 2 | 23.18% | 4,733,756 KB / 16,453,060 KB | 9 |
| Run 3 | 23.58% | 4,992,180 KB / 16,453,060 KB | 9 |

(Run 1 immediately followed the successful reduced-concurrency retry that
resolved the contention above, at the same commit with no intervening file
changes — its own system snapshot is the CPU/process check performed
immediately before that retry, which showed 21.8% CPU and one
long-running high-CPU-time background process, prompting the switch to
`--maxWorkers=4` in the first place.)

## Exit criteria

- Three consecutive complete runs: **3/3**, all clean
- Zero failures across all three: **confirmed**
- Zero worker crashes, zero retries: **confirmed**
- Identical totals across all three: **confirmed** (109 files / 1397
  passed / 3 skipped / exit 0, every time)
