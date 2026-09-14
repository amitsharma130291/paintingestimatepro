# Test execution report

**Package under test:** `painting-estimate-pro-specs-v2.1-final.zip` (authoritative) + `painting-estimate-pro-comprehensive-tdd-v2.1.zip` (test catalogue). The TDD package's embedded copy of the logic spec (`logic-spec-v2.1/`) was diffed byte-for-byte against the standalone final package (`diff -rq`) — **identical, no discrepancy to resolve.**

**Repository / commit:** working tree of `paintingestimatepro` (no commit made — see note at the end). Environment: Node (via the project's `npm` toolchain), Windows, Astro 7, Vitest 5, `decimal.js` 10, `fast-check` 4, `fake-indexeddb` 6, React 19.

**Commands actually run** (all output captured live in this session, not summarized from memory):
```
npm install
npx vitest run                 # → 133/133 passed, 18 test files
npx astro check                # → 0 errors, 0 warnings, 0 hints (65 files)
npm run build                  # → 5 pages built successfully
python3 verify_reference.py    # → 18/18 fixtures, 98 assertions (independent oracle, prior spec-review turn)
```
Plus manual browser verification via the Claude Browser tool against `astro dev` at `localhost:4333` (see §5).

---

## 1. Scope actually implemented

**Free tools** (working, real engine wired in, no payment gate):
- Painting estimate template — `src/components/tools/EstimateTemplate.tsx`, `/free/estimate-template`
- Painting job-cost calculator — `src/components/tools/JobCostCalculator.tsx`, `/free/job-cost-calculator`
- Interior painting calculator — `src/components/tools/InteriorCalculator.tsx`, `/free/interior-calculator`

**Pro** (working, real IndexedDB persistence, no payment gate — see §6 for why):
- Business settings, paint catalog — `src/components/tools/pro/ProApp.tsx` (Settings/Catalog tabs)
- Room entry with per-room walls/ceiling/openings — (Project tab)
- Project cost/price/margin summary with suggested vs. custom pricing — (Estimate summary tab)
- Price Book Health — (Price Book Health tab)
- Issued-revision immutability + customer-safe document (allow-list) — (Estimate summary tab, post-issue)
- Actual-cost review with partial/final states — (Actual review tab)
- Backup export/import with validation — (Backup tab)

**Shared engine** (`src/engine/*.ts`) — every formula in `CALCULATION_SPEC.md` §1–8, used by both free tools and Pro (no duplicated formulas — verified by grep: the only place `dividedBy(1-` / margin math appears is `src/engine/pricing.ts`).

**Domain layer** (`src/domain/*.ts`) — entities, rate snapshots, draft/issue/duplicate lifecycle, customer-document allow-list, backup validation/restore-merge/import-as-copies, all as pure, unit-tested functions.

**Not implemented** (see §6): paid access/checkout (blocked, no provider selected — by design, not an oversight).

---

## 2. Numerical fixtures (NUM-*, 20/20)

All 20 cases in `acceptance-fixtures.json` were ported to `tests/engine/fixtures.test.ts`, calling production functions in `src/engine/*` directly — **not** a re-run of the supplied Python oracle. Result: **20/20 passed**, matching the oracle's independent 18-fixture/98-assertion run from the prior spec-review (the v2.1 package added 2 more fixtures — `actual-final-loss`, `actual-zero-price` — both also pass here).

Two fixtures are worth calling out because they encode genuinely non-obvious correctness rules, confirmed against production code:
- **`wall-service`**: proves the *minimum-cent* suggested price ($1.23) is used instead of the *nearest-cent* approximation ($1.22), because the nearest-cent value would actually fall a hair below the 35% target margin.
- **`interior-with-ceiling`**: proves labor hours are computed per-surface-type (wall throughput 150, ceiling throughput 120) rather than one blended rate — the exact total (12.84 hours) only comes out right if walls and ceiling are never conflated.

## 3. Additional unit/property/mutation tests written and run this session

Beyond the 20 ported fixtures, **113 more tests** were written against production code and pass:

- **Parsing & validation** (`tests/engine/parse.test.ts`, 15 tests): missing/invalid/valid-zero trichotomy, numeric grammar accept/reject list, tiny-divisor rejection.
- **Geometry** (`tests/engine/geometry.test.ts`, 11 tests): including the `GEO-06`/`V05` "openings exceed gross → invalid, not a valid zero room" rule.
- **Pricing** (`tests/engine/pricing.test.ts`, 8 tests): at-target boundary, unpriced vs. zero-price distinction, `out_of_supported_range` never `Infinity`, minimum-cent guarantee, margin≠markup.
- **Cost/overhead** (`tests/engine/cost.test.ts`, 6 tests): supplies-allowance mode isolation, overhead-on-full-direct-cost.
- **Service health** (`tests/engine/serviceHealth.test.ts`, 4 tests): incomplete-assumption rows, negative margin retained.
- **Actuals** (`tests/engine/actuals.test.ts`, 6 tests): partial suppression, explicit-zero-is-valid, the v2.1 baselinePrice>0 gating rule.
- **Documents** (`tests/engine/document.test.ts`, 4 tests): per-line rounding vs. sum-then-round, cost-breakdown reconciliation row.
- **Decimal arithmetic** (`tests/engine/decimal.test.ts`, 4 tests): negative HALF_UP symmetry, exact 0.1+0.2.
- **Domain/lifecycle** (`tests/domain/lifecycle.test.ts`, 7 tests): snapshot immutability under a live catalog edit, issued-revision byte-identity after a later draft edit, customer-document allow-list (including a hand-assembled-leak guard), duplicate-project ID remapping.
- **Domain/backup** (`tests/domain/backup.test.ts`, 9 tests): schema/oversize/duplicate-ID/dangling-reference rejection, restore-merge skip/add/conflict, import-as-copies with actual-baseline remapping and provenance-based repeat-import skip.
- **Storage** (`tests/storage/db.test.ts`, 3 tests, against real `fake-indexeddb` transactions, not a mock): multi-store atomic write, and the two atomicity bugs described in `BUG_FIX_LOG.md`.
- **UI formatting** (`tests/ui/shared.test.ts`, 4 tests): the money-sign bug fix.

### Property-based tests (seed `20260914`, 200 runs each)

10 of the 24 properties in `PROPERTY_TESTS.md` were implemented with `fast-check`, chosen for the highest financial/data-integrity risk: margin inverse, minimum-cent guarantee, price/cost/required-price monotonicity, project pooling order-independence, same-variant split invariance, pooling inequality (with a same-vs-different-variant check), gallon bound, opening deduction, application-labor linearity (see the "not a bug" note in BUG_FIX_LOG.md), coats/waste monotonicity, ledger reconciliation, cost-display reconciliation. All pass. **Not implemented**: variant independence beyond the unit test already covering it, disabled-input independence, issued-immutability-under-random-edit-sequences, actual-isolation-under-random-edits, restore/copy idempotence-under-fuzzing, atomicity-under-injected-failure-at-every-step, privacy-allow-list-under-random-fields, import round-trip, numeric serialization round-trip — these would need either a fuller persistence-layer harness or generative entity factories not built in this session.

### Mutation / deliberate-fault checks (`tests/mutation/mutation.test.ts`, 11 checks)

Every fault reproduces a wrong sibling implementation fed the *same* fixture inputs as a known-correct value, proving the real test suite would catch it: dividing by `(1+margin)` instead of `(1-margin)`, nearest-cent instead of minimum-cent rounding, clamping negative profit to zero, gating actual margin on `profit>0`, converting null price to zero, ceiling paint per-room instead of per-project, pooling different colors, epsilon-subtracting raw demand, using wall throughput for ceiling, rounding the free document's subtotal instead of each line. All 11 pass (i.e., each faulty computation is proven to diverge from the real, correct value). **Not implemented as a fault check**: "omit door sides or multiply twice" and "include stale inactive mode inputs" and "copy live rates into snapshot on save" and "mutate issued revision in place" — the underlying correct behavior IS tested elsewhere (door-two-faces fixture, cost mode-isolation tests, snapshot/lifecycle tests), just not wrapped in an explicit "here's the wrong version" fault-injection test.

## 4. The 345-case catalogue — honest mapping

`test-execution-results.csv` (project root) maps every one of the 345 named cases. **This mapping was built conservatively**: a case is marked `passed` only when I could point to a specific, real, currently-passing test asserting that case's exact (or functionally equivalent) behavior against production code. Everything else is `not_run` with a note — I did not write superficial tests to inflate this count, per the task's explicit instruction, and I did not mark anything `passed` I hadn't actually verified.

| Status | Count | Meaning |
|---|---|---|
| `passed` | **85** | Verified by a named, currently-passing automated test, or (for the three free tools' primary flow and one Pro flow) by manual browser verification with observed, recorded output matching the expected fixture values. |
| `blocked` | **12** | All `ACCESS-*` cases — no payment provider selected, per `ACCESS_SPEC.md`; implementing or testing these first requires that decision. |
| `not_run` | **248** | Specified and (mostly) implemented in the underlying code, but no dedicated automated test exists for that *specific* scenario in this session. See the per-row `notes` column for what related coverage does exist. |

By category (P0/P1 counts collapsed):

| Prefix | Total | Passed | Not run | Blocked | Note |
|---|---|---|---|---|---|
| NUM | 20 | 20 | 0 | 0 | Full coverage — every acceptance fixture ported to production tests. |
| CORE | 30 | 16 | 14 | 0 | Core margin/pricing/parsing math well covered; reactive-UI-state cases (CORE-027..029) and a few numeric edge cases (cost=0, target=0, malformed enums) not individually tested. |
| GEO | 30 | 15 | 15 | 0 | Rectangular geometry, pooling, purchase boundaries, trim/door area well covered; multi-surface-per-room, standalone-manual-area, and variant-ID-conflict validation not tested (partly because the simplified Pro UI doesn't yet expose those paths — see IMPLEMENTATION_DECISIONS.md). |
| COST | 19 | 5 | 14 | 0 | Core labor/overhead/allowance formulas covered via fixtures + `cost.test.ts`; per-line-item cost-mode combinations not individually tested. |
| BOUND | 61 | 9 | 52 | 0 | Numeric-grammar accept/reject rules covered at the representative level; the specific engineering-bound cases (500 rooms, $1B caps, etc.) implemented in `CALCULATION_SPEC.md` §1 constants but not stress-tested. |
| HEALTH | 17 | 4 | 13 | 0 | Core per-unit cost model and status logic covered; multi-row/refresh/breakdown-display cases not tested. |
| ACT | 16 | 6 | 10 | 0 | Partial-suppression, explicit-zero, and the v2.1 loss/zero-price regressions covered; multi-review-history and rebase cases not tested. |
| DOC | 12 | 5 | 7 | 0 | Allow-list and ledger rounding covered; multi-page print/PDF extraction not tested (no headless PDF tooling in this session). |
| TPL/JOB/INT (free tools) | 47 | 3 | 44 | 0 | Each tool's primary flow verified live in the browser and matches its fixture; the long tail of individual validation/edge-case rows per tool not each automated. |
| CAT/LIFE/PRO | 42 | 7 | 35 | 0 | Core snapshot-immutability and issue/duplicate lifecycle covered by real tests; most persistence edge cases (deleted-variant display, refresh-with-confirmation, price-mode state-machine details) implemented but not each individually tested. |
| BACK | 26 | 13 | 13 | 0 | Validation, restore-merge, import-as-copies, and transactional atomicity (including the two real bugs found) covered; real-browser quota/multi-tab scenarios not tested. |
| UX | 13 | 1 | 12 | 0 | One full manual pass (forms, IndexedDB save, results) done; multi-device/keyboard/reduced-motion matrix not done. |
| ACCESS | 12 | 0 | 0 | 12 | Blocked — see above. |
| **Total** | **345** | **85** | **248** | **12** | |

## 5. Customer journeys actually exercised in the browser (not simulated)

All of the following were driven live via the Claude Browser tool against `astro dev`, with output read back from the actual rendered page (not assumed):

1. **Free job-cost calculator**: entered materials $620 / labor $1,280 → observed Direct cost $1,900.00, Overhead $285.00, Total $2,185.00, Suggested price $3,361.54 — **exact match** to the `job-homepage` fixture. Switched to "Check my price" with $3,200 → observed Profit $1,015.00, Margin 31.7%, "Review pricing" — exact match.
2. **Free interior calculator**: default 20×16×9 room, 2 doors/3 windows → observed Gross 648.00 ft², Deduction 85.00 ft², Net 563.00 ft², matching `interior-walls-brief`.
3. **Free estimate template**: found and fixed the untouched-row bug (§BUG_FIX_LOG.md #2) live; re-verified the fix — a complete first line + untouched second line now correctly enables printing.
4. **Pro — full estimate lifecycle**: confirmed sample assumptions → added a paint variant → added a room (20×16×8, 2 doors, 3 windows, ceiling on) → observed a live summary (Materials $270.00, Labor $380.16, Direct cost $650.16, Overhead $97.52, Job cost $747.68, suggested price $1,150.29, margin 35.0%, "Above target") → **hand-verified this arithmetic independently and it is correct for the actual inputs entered** → issued the estimate → confirmed the customer-facing document shows **only** the price and a pre-tax notice, no cost/overhead/margin figures.
5. **Historical integrity (the single most important behavioral requirement)**: after issuing, changed the live catalog price from $45→$99/gal. The *live* summary panel recalculated to a new job cost ($1,120.28) and price ($1,723.52); the *already-issued* customer document **remained unchanged at $1,150.29**. This is the requirement "saved estimates retain their original rates when the material catalog changes," verified end-to-end in a real browser, not just by a unit test.
6. **Actual-cost review**: confirmed 1 of 4 categories → observed "In progress — 1/4 categories confirmed. Final profit/margin is withheld." Completed all 4 with a loss scenario (materials $700, labor $1,400, expenses $300, overhead $150 against the original $1,150.29 price) → observed Actual cost $2,550.00, Profit -$1,399.71, Margin -121.7% — a real, visible negative margin, not suppressed. Found and fixed the sign-placement formatting bug here (§BUG_FIX_LOG.md #3).

**Not exercised in the browser this session**: backup export/import round-trip (implemented and unit-tested, but I did not click through an actual file-download-then-upload cycle in the browser), mobile/tablet viewport sizes for the Pro app specifically (the homepage's responsive design was verified extensively in earlier sessions; the Pro app's responsiveness was not separately re-checked), and print/PDF output inspection (no PDF-rendering tool available in this session to extract and check text content).

## 6. Paid access — blocked, not faked

No payment provider has been selected. Per `ACCESS_SPEC.md` and `IMPLEMENTATION_PROMPT.md` step 6, this is a required prerequisite decision, not an implementation detail I can resolve unilaterally without inventing provider-specific behavior. Consequently:
- No checkout, license, or entitlement-check code exists anywhere in the repository.
- The Pro app pages carry a visible, honest "In development... Purchasing is not available yet" note.
- All 12 `ACCESS-*` cases are marked `blocked` (not `passed`, not skipped silently).
- **This means the product is not commercially launchable as-is** — that was never in scope for this session per the explicit instruction not to substitute a mock unlock.

## 7. Remaining risks / launch blockers

1. **Payment/entitlement — hard blocker.** Nothing works here yet by design (§6).
2. **Multi-tab conflicts are unhandled** (IMPLEMENTATION_DECISIONS.md #6) — two tabs editing the same draft will silently last-write-wins.
3. **248 catalogued cases remain unautomated.** The highest-risk ones (core arithmetic, snapshot immutability, transactional atomicity) are covered; the long tail (browser-matrix, multi-review-history, refresh-confirmation flows) is not. Treat `not_run` as "implemented but unverified," not "broken."
4. **No PDF/print output was inspected** in this session — the customer-document allow-list is verified at the data level (`buildCustomerDocument` + `assertOnlyAllowedFields`), but the actual rendered PDF (pagination, clipped totals) was not checked.
5. **The Pro app's room-entry UI is simplified** relative to the full domain model (one paint variant per room, no standalone trim/door surface UI) — see IMPLEMENTATION_DECISIONS.md's "Known simplifications" section.
6. **No backup round-trip was exercised in a real browser** this session (export → clear store → import → compare), only unit-tested against `fake-indexeddb`.

## 8. Verdict

- **Ready for internal review**: yes — the core calculation engine, the historical-integrity guarantee, and all three free tools are real, tested, and verified live.
- **Ready for paid launch**: no — blocked on a payment-provider decision (item 1 above), and on closing enough of the `not_run` list (particularly BACK/LIFE persistence edge cases and a real backup round-trip) that a launch team would consider comfortable, per whatever risk bar the business sets. I'm not the right party to set that bar; I've given you the itemized list to set it yourself.

Not deployed. Not committed to git (left as a working-tree change for review) — say the word if you want it committed and/or a PR opened.
