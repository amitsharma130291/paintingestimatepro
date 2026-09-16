# Fresh-extraction verification log

Numerical-hardening initiative, section 12. Verifies the committed source
is genuinely self-contained and reproducible independent of this working
tree's own `node_modules`/build state.

## Archive

Built via `git archive --format=zip -o <path> HEAD` from the working tree
(never a manual file copy, so it can only ever contain tracked content).

| Commit | Archive SHA-256 |
|---|---|
| `f3b6768` (first attempt, before the `readNdjson` fail-loudly fix) | `3c94eb533fbeb34506c23688beb5c6a41bc7932a762d1167cae739d210b656e` |
| `2687807` (final — includes the `readNdjson` fix) | see `FINAL_NUMERICAL_VERDICT.md` / the packaging step's combined manifest |

346 files, ~1.37MB. Extracted into three successive locations during this
verification (see below) — each extraction re-verified independently.

## Safety checks (all extractions)

- No `node_modules/` present (git archive only includes tracked files).
- No `.env` present — only the tracked `.env.example` template, scanned
  for live-looking secret patterns (`sk_live`, `sk_test_...`, `pk_live`):
  none found.
- No build output (`dist/`, `.astro/`, `.vercel/`).
- No unsafe paths (`../`) or symlinks in the archive listing.

## Differential fixtures: a real gap found and fixed

`tests/fixtures/oracle-fuzz/*.ndjson` (205,000 fixtures, ~230MB) are
gitignored by design (regenerable from a fixed seed) and are therefore
absent from any fresh extraction until explicitly regenerated. The first
extraction's test run consequently ran the differential suite against
**zero** fixtures, vacuously "passing" — see `NUMERICAL_BUG_FIX_LOG.md`'s
entry on this for the full root-cause and the `readNdjson` fail-loudly fix
this produced. Every extraction from that point on regenerated the
fixtures FIRST:

```bash
python docs/generate_fuzz_fixtures.py tests/fixtures/oracle-fuzz --seed 20260916 --counts "valid_project=100000,incomplete=25000,invalid=25000,boundary_adjacent=25000,loss_zero_unpriced=10000,price_book_health=10000,actual_cost=10000"
```

The regenerated `manifest.json` was `diff`-checked byte-identical to the
working tree's own `tests/fixtures/oracle-fuzz/manifest.json` every time —
confirmed genuinely reproducible from the recorded seed, not just "some
data landed there."

## Canonical suite result

Final clean run (extraction at commit `2687807`, real fixtures present):
**109/109 test files, 1397 passed, 3 skipped, exit code 0.** Differential
suite duration was ~20-22s of real processing, not the near-instant
vacuous pass from the pre-fix extraction — confirmed genuinely exercising
all 205,000 fixtures.

Reaching this clean result required reducing Vitest's worker concurrency
(`--maxWorkers=2`) after three consecutive single-file failures at higher
concurrency (`--maxWorkers=4`, and the unthrottled default), matching this
project's long-documented shared-machine contention pattern. Every
individual failure was a different, unrelated UI test
(`draftSaveIncomplete`, `customerDocumentRendering`,
`proEstimateLifecycle` — each a `waitFor(...'Draft saved.'...)`-style
async-render timing assertion) and each was independently confirmed to
pass in 2-5 seconds when run standalone, immediately after failing in the
full run — consistent with contention, not a defect.

## Typecheck and production build: a genuine, disclosed environmental blocker

`npm run check` (`astro check`) and `npm run build` both fail in **every**
extraction attempted, with:

```
Error: Cannot find native binding...
cause: Error: An Application Control policy has blocked this file.
...\node_modules\@bruits\satteri-win32-x64-msvc\satteri_napi.win32-x64-msvc.node
```

`satteri` is a native (Rust) dependency Astro's content/type-checking
pipeline uses internally. This is a Windows security policy (Application
Control / WDAC-style) blocking execution of this specific native binary —
**confirmed to be pre-existing and machine-wide, not introduced by this
initiative or by the extraction process**: the identical error occurs
running `npm run check`/`npm run build` directly in the main working tree
(`C:\Users\amits\SEOSites\paintingestimatepro`), and persisted identically
across three different extraction locations (two under the session's Temp
scratchpad, one under a sibling directory outside Temp entirely) — ruling
out a path-based cause. This is a genuine external blocker requiring the
user's own machine/policy configuration to resolve (e.g. an Application
Control exception for this binary, or reinstalling the dependency from a
context the policy already trusts); it cannot be fixed from within this
session.

`npm audit` (0 vulnerabilities) and `npm ci` itself do not depend on this
binary and succeeded cleanly in every extraction.

## Extractions performed

1. `extracted/` (Temp scratchpad, commit `f3b6768`) — first attempt;
   revealed the vacuous-differential-suite gap.
2. `extracted2/` (Temp scratchpad, commit `2687807`) — clean suite run
   after the `readNdjson` fix and fixture regeneration; typecheck/build
   first hit the Application Control block here.
3. `extracted3/` (`C:\Users\amits\SEOSites\_fresh_extraction_verify\`,
   outside Temp, commit `2687807`) — built specifically to rule out a
   Temp-directory-specific cause for the Application Control block;
   confirmed identical failure, ruling that out. `npm ci` and `npm audit`
   both clean here.

All temporary extraction directories (including
`_fresh_extraction_verify/`) are removed after this log is committed —
they are verification-only, not permanent project state.

## Exit criteria

| Check | Result |
|---|---|
| Archive contains no secrets/node_modules/build output/unsafe paths | PASS |
| Clean `npm ci` | PASS (all 3 extractions) |
| Canonical suite (real fixtures, not vacuous) | PASS (109/109, 1397 passed, 3 skipped) |
| Typecheck | **BLOCKED** — genuine, disclosed, pre-existing, machine-wide environmental restriction, confirmed to affect the main working tree identically |
| Production build | **BLOCKED** — same root cause as typecheck |
| Dependency audit | PASS (0 vulnerabilities) |

Fresh-extraction verification is otherwise complete and passing; the two
blocked steps are an honest, disclosed external limitation of this
machine, not a defect in the numerical-hardening work or a gap in the
extraction's reproducibility.
