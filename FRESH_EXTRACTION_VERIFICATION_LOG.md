# Fresh-extraction verification log

Numerical-hardening initiative, section 12. Verifies the committed source
is genuinely self-contained and reproducible independent of this working
tree's own `node_modules`/build state.

**Repeated in full at the actual final code-bearing commit** — see
`FINAL_NUMERICAL_VERDICT.md` for the complete commit lineage. This
rerun (at `bf7746d`) is the one that governs the current GO/NO-GO
verdict; the two earlier extraction attempts recorded at the bottom of
this document are historical and superseded.

## Archive

Built via `git archive --format=zip -o <path> HEAD` from the working tree
(never a manual file copy, so it can only ever contain tracked content).
Extracted **outside** the session's Temp directory
(`C:\Users\amits\SEOSites\_fresh_extraction_verify\`), specifically
because an intermediate Temp-directory attempt this session hit a script
bug (documented below) that was initially mistaken for an
environment-level problem — extracting under `SEOSites\` ruled that out
directly.

| Commit | Archive entries | Archive SHA-256 |
|---|---|---|
| `bf7746da1815ec0044ac36a084edbd8f9a9b3410` (final) | 355 | see `FINAL_NUMERICAL_VERDICT.md` / the packaging step's combined manifest |

## Safety checks

- No `node_modules/`, `.astro/`, `.vercel/`, or `dist/` entries (0 found,
  confirmed by direct enumeration of all 355 archive entries, not by
  sampling).
- No `.env` present — only the tracked `.env.example` template (0 `.env`
  entries found by exact-basename match across all 355 entries).
- Scanned every extracted text file for live-looking secret patterns
  (`sk_live`, `sk_test_...`, `pk_live`): one match, in
  `FRESH_EXTRACTION_VERIFICATION_LOG.md` itself, which is this
  document's own prior revision quoting the search patterns in prose —
  confirmed a false positive by direct inspection, not a real secret.
- No unsafe paths (`../`, absolute, drive-letter) or symlinks in the
  archive listing — verified programmatically (`validate_zip_safety.py`,
  also used for the final deliverable ZIPs in section 8): 0 violations
  across all 355 entries.

## A script bug that looked like an environment problem, and wasn't

The first two extraction attempts this pass appeared to show a newly
created archive (zip, then tar, tested independently) vanishing within
milliseconds of creation — visible to `ls`/PowerShell's
`Get-Item`/`[System.IO.File]::ReadAllBytes` but raising
`FileNotFoundError` when opened by Python. This was investigated
seriously (given this machine's already-disclosed Application Control
policy) before being accepted, including testing with a plain zip
outside any script and testing `.tar` archives to rule out a
zip-specific cause.

Root cause, confirmed empirically: **not** an environment or security
issue. `git-bash`/MSYS automatically rewrites a bare `/c/...`-style path
argument into `C:\...` for a native Windows binary — but only when that
path is its own whole command-line argument. A path **embedded as a
string literal inside a `python3 -c "..."` code blob** is not an
argument MSYS rewrites; it reaches Python as literal text, and this
Python build does not understand MSYS path syntax
(`os.path.abspath('/c/Users/x')` silently resolves to `'C:\c\Users\x'`,
a nonexistent path) — hence `FileNotFoundError` from Python specifically,
while every MSYS-native or true-Win32 tool (`ls`, PowerShell) saw the
real file the whole time. Fixed by converting any path embedded inside
inline Python code to its Windows-style (`cygpath -w`) form before
substitution; paths passed as ordinary positional arguments (to `git`,
`npm`, or a `.py` file) were never affected and needed no change.
Verified fixed by rerunning the full extraction to completion twice
(at `aa4febd` and then `bf7746d`) with real results at each step.

## Differential fixtures: a real gap found and fixed (from an earlier pass)

`tests/fixtures/oracle-fuzz/*.ndjson` (205,000 fixtures, ~230MB) are
gitignored by design (regenerable from a fixed seed) and are therefore
absent from any fresh extraction until explicitly regenerated. An
earlier extraction attempt in a prior pass of this initiative ran the
differential suite against **zero** fixtures before this was caught,
vacuously "passing" — see `NUMERICAL_BUG_FIX_LOG.md`'s entry on this for
the full root-cause and the `readNdjson` fail-loudly fix this produced.
Every extraction since regenerates the fixtures first:

```bash
python docs/generate_fuzz_fixtures.py tests/fixtures/oracle-fuzz --seed 20260916 --counts "valid_project=100000,incomplete=25000,invalid=25000,boundary_adjacent=25000,loss_zero_unpriced=10000,price_book_health=10000,actual_cost=10000"
```

The regenerated `manifest.json` was `diff`-checked byte-identical to the
working tree's own `tests/fixtures/oracle-fuzz/manifest.json` in the
final extraction, confirmed genuinely reproducible from the recorded
seed.

## A second real gap found by this fresh extraction: `src/env.d.ts` was never committed

The first fresh-extraction attempt at the final code-bearing commit
(`aa4febd`, before the fix below) surfaced something the main working
tree could not: `npx tsc --noEmit` failed with 7 genuine errors —
`error TS2339: Property 'env' does not exist on type 'ImportMeta'` in
`src/lib/server/dodo.ts`, `src/lib/server/license.ts`, and
`src/pages/api/webhooks/dodo.ts` — despite the identical command exiting
0 in the main working tree at the same commit.

Root cause: the only source of the `/// <reference types="astro/client"
/>` triple-slash directive that gives `import.meta.env` its Astro/Vite
typing was the auto-generated, gitignored `.astro/types.d.ts` — present
in the main working tree only because `astro dev` had been run there
before, and normally regenerated by `astro sync`/`astro dev`/`astro
check`/`astro build`. All four of those commands are blocked on this
machine by the same disclosed `satteri` Application Control policy
(confirmed directly: `npx astro sync` fails with the identical error). A
genuinely fresh checkout on this machine had no way to regenerate this
file and no committed fallback, so `tsc` alone (without Astro's own
tooling) could never see `ImportMeta.env`'s shape.

Fixed the standard way: committed `src/env.d.ts` containing the one
reference directive (the same content Astro's own project templates ship
with). Confirmed by rerunning the full fresh-extraction pipeline again
at the resulting commit (`bf7746d`): `npx tsc --noEmit` now exits 0 in a
genuinely fresh checkout with no `.astro/` directory present at all.

## Canonical suite result (at final commit `bf7746d`)

**109/109 test files, 1397 passed, 3 skipped, exit code 0** — exact match
to the main working tree's three-consecutive-clean-run sequence (see
`THREE_RUN_STABILITY_LOG.md`) and to the independently-reported
unrestricted-Linux-environment result.

## Full command-by-command result (final extraction, commit `bf7746d`)

| Step | Result |
|---|---|
| `npm ci` | PASS (673 packages, 0 vulnerabilities, `patch-package` postinstall applied) |
| Regenerate 205,000 fixtures | PASS, manifest byte-identical to working tree |
| `npm run check` (`astro check`) | **BLOCKED** — disclosed `satteri` Application Control policy (see below) |
| `npx tsc --noEmit` | **PASS, 0 errors** (independent of `astro check`; this is the check the correction task specifically asked to run "even if Astro's native dependency remains blocked") |
| `npm run test:numerical:deterministic` | PASS — 38 files, 921 passed |
| `npm run test:numerical:property` | PASS — 5 files, 26 passed (257,000 comparisons) |
| `npm run test:numerical:differential` | PASS — 1 file, 7 passed (205,000 fixtures) |
| `npm run test:numerical:parity` | PASS — 1 file, 12 passed |
| `npm run test:numerical:pairwise` | PASS — 4 files, 71 passed |
| `npm run test:numerical:state` | PASS — 1 file, 10 passed |
| `npm test` (canonical, `--maxWorkers=4`) | PASS — 109 files, 1397 passed, 3 skipped, 0 failed |
| `npm run build` (`astro build`) | **BLOCKED** — same root cause as `npm run check` |
| `npm audit` | PASS — 0 vulnerabilities |

## Typecheck and production build: `astro check`/`astro build` remain a genuine, disclosed environmental blocker

`npm run check` (`astro check`) and `npm run build` (`astro build`) both
fail in every extraction attempted this initiative, with:

```
Error: Cannot find native binding...
cause: Error: An Application Control policy has blocked this file.
...\node_modules\@bruits\satteri-win32-x64-msvc\satteri_napi.win32-x64-msvc.node
```

`satteri` is a native (Rust) dependency Astro's own config-loading
pipeline uses internally — it is pulled in by `astro check`, `astro
build`, `astro dev`, and `astro sync` alike (all four confirmed to fail
identically; `astro sync` specifically re-tested this pass to see
whether it alone might be unblocked, since it doesn't perform a full
build — it is not). This is a Windows security policy (Application
Control / WDAC-style) blocking execution of this one specific native
binary — confirmed pre-existing and machine-wide, not introduced by this
initiative or by the extraction process: the identical error occurs
running these commands directly in the main working tree, and persisted
identically across every extraction location tried this initiative
(inside the session's Temp scratchpad and outside it, under
`SEOSites\`) — ruling out a path-based cause. **Crucially, this
initiative's own `npx tsc --noEmit` check does not depend on Astro's
config-loading pipeline at all and is unaffected** — it passes cleanly,
both in the main tree and from a fresh extraction, and is the check this
correction phase specifically required to be run and fixed. `astro
check`/`astro build` remain blocked for a separate, disclosed,
environment-only reason that no source change in this repository can
resolve; per this phase's own instruction, this alone is not treated as
grounds for a NO-GO — instead, the corrected source is packaged (see
section 8/9/11) so `astro check`/`astro build` can be confirmed on an
unrestricted environment.

`npm audit` (0 vulnerabilities) and `npm ci` itself do not depend on this
binary and succeeded cleanly in every extraction.

## Exit criteria (final extraction, commit `bf7746d`)

| Check | Result |
|---|---|
| Archive contains no secrets/node_modules/build output/unsafe paths | PASS |
| Clean `npm ci` | PASS |
| 205,000 fixtures regenerate byte-identical to the recorded seed | PASS |
| `npx tsc --noEmit` (0 errors) | **PASS** |
| Canonical suite (real fixtures, not vacuous) | PASS (109/109, 1397 passed, 3 skipped) |
| All numerical suites (deterministic/property/differential/parity/pairwise/state) | PASS (921/26/7/12/71/10) |
| `astro check` / production build | **BLOCKED** — genuine, disclosed, pre-existing, machine-wide environmental restriction, confirmed to affect the main working tree and every extraction location identically; independent of and not caused by this initiative's own typecheck (which passes) |
| Dependency audit | PASS (0 vulnerabilities) |

Fresh-extraction verification is otherwise complete and passing; the
`astro check`/production-build block is an honest, disclosed external
limitation of this specific machine, not a defect in the
numerical-hardening work, not a gap in the extraction's reproducibility,
and not related to the 19 TypeScript errors this phase fixed (`npx tsc
--noEmit`, the check this phase specifically required, passes cleanly).

## Historical record: earlier extraction attempts, superseded

Preserved for audit trail. **Do not cite these as evidence of the
current, final code's behavior** — both predate the type-fix and
mutation-reconciliation corrections (and the first predates the
`readNdjson` fix entirely).

1. `extracted/` (Temp scratchpad, commit `f3b6768`) — first attempt this
   initiative; revealed the vacuous-differential-suite gap.
2. `extracted2/` (Temp scratchpad, commit `2687807`) — clean suite run
   after the `readNdjson` fix and fixture regeneration; typecheck/build
   first hit the Application Control block here.
3. `extracted3/` (`C:\Users\amits\SEOSites\_fresh_extraction_verify\`,
   outside Temp, commit `2687807`) — built specifically to rule out a
   Temp-directory-specific cause for the Application Control block;
   confirmed identical failure, ruling that out.
4. This pass's own first attempt (commit `aa4febd`, same
   `_fresh_extraction_verify\` directory reused) — surfaced the genuine
   `src/env.d.ts` gap above; its raw `npx tsc --noEmit` output (7
   errors) is preserved as the evidence that led to the fix, not as a
   claim about the current, final commit's behavior.
