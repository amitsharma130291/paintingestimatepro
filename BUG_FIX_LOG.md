# Bug fix log

14 real defects total: 3 from the original implementation session (below), 11 found and fixed during the continuation session (the draft/issued isolation and full-catalogue-audit pass, plus the Dodo Payments integration). None were pre-existing beyond their own introducing session — each was introduced and caught within the same body of work.

---

## 1. `writeAll` transaction did not reliably roll back a partial write

**Found by:** `tests/storage/db.test.ts::D-storage-02` (BACK-D12), first run.

**Reproduction:** Write a batch of 3 paint-variant records to IndexedDB in one `writeAll` call, where the 2nd record is malformed (missing its `id` keyPath). Expect: none of the 3 records persist (atomic all-or-nothing).

**Root cause:** The first implementation relied solely on IndexedDB's implicit "an unhandled request error aborts the transaction" behavior, without calling `tx.abort()` explicitly. Under `fake-indexeddb` (and this cannot be assumed safe in every real browser either), the first successfully-`put()` record (`v-ok-1`) persisted despite the third request in the same transaction failing — the transaction did not actually rollback that earlier write.

**Fix:** `src/storage/db.ts` `writeAll()` now explicitly calls `tx.abort()` in the `catch` block on any request failure, rather than relying on implicit abort. A separate fix was needed alongside this: attaching a `.catch()` handler to `tx.done` immediately (before the write loop) to avoid an unhandled promise rejection when the transaction aborts asynchronously.

**Regression test:** `tests/storage/db.test.ts::D-storage-02` and `::D-storage-03` (the latter additionally checks that a failure in one store's batch rolls back a different store's queued write in the *same* `writeAll` call).

**Verification:** Both tests pass; re-ran the full storage suite (3/3 pass) plus the full 133-test suite with no regressions.

---

## 2. Free estimate template: a brand-new blank row registered as "touched" and blocked printing

**Found by:** Manual browser testing (Claude Browser session, `/free/estimate-template`), reproducing the "add a complete line, leave the second line blank" journey from IMPLEMENTATION_PROMPT.md.

**Reproduction:** On page load, fill in only the first line's description and price. The second line is untouched. Expected: the second (empty) row is ignored, and "Print / Save as PDF" is enabled since one complete line exists. Actual: the second row showed "incomplete" and the print button stayed disabled with "Add at least one complete line."

**Root cause:** `EstimateTemplate.tsx`'s row factory defaults `quantity: '1'` (per tool-specs/01: "quantity... initially 1"). The "is this row touched" check was `description !== '' || quantity !== '' || unitPrice !== ''` — since every fresh row already has a non-empty quantity ("1") by construction, every row counted as "touched" from the moment it was created, even before a user typed anything.

**Fix:** Changed the touched-detection to `description !== '' || unitPrice !== '' || quantity !== '1'` — i.e., the default quantity value itself does not count as user interaction; only a description, a price, or a *changed* quantity does.

**Regression test:** None added at the unit level yet (this is UI-state logic inside a React component, not a pure engine function) — re-verified manually in the browser after the fix: the untouched row correctly shows "—" and the print button correctly enables. **Gap:** a component-level test (e.g. React Testing Library) for this specific behavior was not added in this session; flagged in TEST_EXECUTION_REPORT.md.

---

## 3. Negative money values rendered as `$-15.00` instead of `-$15.00`

**Found by:** Manual browser testing of the Pro app's Actual Review tab with a loss scenario (materials $1,000 + labor $2,000 + expenses $300 + overhead $150 against a $1,150.29 baseline price).

**Reproduction:** Record actuals producing a loss. The "Profit vs. original quote" row displayed `$-1399.71`.

**Root cause:** `money()` (and several inline call sites in `ProApp.tsx`) built the string as `` `$${toMoneyString(x)}` ``. For a negative `Decimal`, `toMoneyString` (which calls `.toFixed(2)`) correctly returns `"-1399.71"` — but prepending `"$"` in front of that puts the dollar sign before the minus sign.

**Fix:** `src/components/tools/shared.ts`'s `money()` now checks the sign first and places `-` before `$`: `-$1399.71`. All inline `` `$${...toFixed(2)}` `` call sites in `ProApp.tsx` were replaced with calls to the shared `money()` helper (also improving consistency — this was the kind of "don't duplicate formulas/formatting across components" issue the architecture is meant to avoid).

**Regression test:** `tests/ui/shared.test.ts` — asserts positive, negative, zero, and null formatting.

**Verification:** New test passes; full suite (133/133) still passes after the change; `astro build` and `astro check` still clean.

---

## 4. Issued customer document was permanently stamped "draft" (continuation session)

**Found by:** `tests/integration/draftIssuedIsolation.test.ts` (new, this continuation session), step 11 of the 11-step draft/issued isolation sequence required by the task — the very first run of this new integration test failed red on `expect(originalIssuedAfterEdit.customerDocumentSnapshot!.status).toBe('issued')`, receiving `'draft'` instead.

**Reproduction:** Call `issueRevision(draft, buildCustomerDocument, ids)` on any draft and inspect `issued.customerDocumentSnapshot.status`. Expected `'issued'`; actual `'draft'`, on every single issued estimate ever produced by the app — this was a 100%-reproducible defect, not an edge case, that the prior session's 133-test suite never caught because no test asserted the document's `status` field value, only that a document existed.

**Root cause:** `src/domain/project.ts`'s `issueRevision()` called `buildCustomerDocument(revision)` using the ORIGINAL pre-issue `revision` argument (`state: 'draft'`) instead of the newly-issued copy being constructed in the same function. `buildCustomerDocument()` in turn derives `status` from `revision.state === 'issued' ? 'issued' : 'draft'` — so it always saw `'draft'` at the exact moment an estimate was issued, and that wrong value was then frozen into the immutable `customerDocumentSnapshot` forever (the whole point of freezing is that it never gets a chance to self-correct later).

**Customer impact:** every issued estimate a customer receives — including ones already "verified" as immutable in the prior session's manual browser pass — would display "DRAFT" instead of a finalized status, undermining trust in exactly the estimate meant to look final and professional.

**Fix:** `issueRevision()` now constructs the `state: 'issued'` object first, then calls `buildCustomerDocument(issued)` on that, so the callback always observes the correct final state.

**Regression test:** Added an explicit assertion to the existing `tests/domain/lifecycle.test.ts::LIFE-D02` case (`expect(issued.customerDocumentSnapshot!.status).toBe('issued')`), plus full coverage via the new `tests/integration/draftIssuedIsolation.test.ts` (both pricing modes).

**Verification:** Both tests pass; full suite (158/158 at time of fix) passes with no regressions; `astro check` clean (0 errors).

---

## 5. Suggested-price mode showed a proposed price but "—" for profit and margin

**Found by:** Live manual browser testing of the rewritten Pro workspace UI (`/app`, Projects tab) immediately after the per-surface UI rewrite — created a room, entered dimensions, and observed "Proposed price $767.03 / Profit — / Margin — / No price entered" simultaneously, which is self-contradictory (a real proposed price with an "unpriced" status).

**Reproduction:** In `assembleProjectEstimate` with `priceMode: 'suggested'`, any complete project shows a non-null `effectivePrice` (the computed suggested price) alongside a `price.status === 'unpriced'` and `price.profit === null`.

**Root cause:** `src/domain/estimateAssembly.ts` computed `finalPrice` with `opts.priceMode === 'suggested' ? priced : ...` — `priced` was the evaluation at `priceInput` (always `null` in suggested mode, since there is no user-entered price), so it always carried the "unpriced" state, while `effectivePrice` (shown to the user as the proposed price) was correctly `priced.minimumTargetPrice`. The two were never reconciled in suggested mode.

**Fix:** `finalPrice` is now always re-evaluated at `effectivePrice` when one exists (`evaluatePrice({ cost: jobCost, price: effectivePrice, ... })`), regardless of pricing mode — matching how the original (pre-rewrite) prototype's inline calculation had correctly done it.

**Regression test:** `tests/domain/estimateAssembly.test.ts` — "Suggested-price mode reports real profit/margin at the effective price."

**Verification:** New test passes; full suite (159/159) passes; re-verified live in the browser after the fix — see the browser verification notes in TEST_EXECUTION_REPORT.md.

---

## 6. Surface paint-variant dropdown offered variants not in the draft's own frozen snapshot

**Found by:** Live manual browser testing — added a second paint variant ("Paint 2") to the live catalog AFTER creating and saving a draft project, then selected it for the draft's ceiling surface. The estimate summary immediately broke: "One or more enabled surfaces have invalid inputs."

**Root cause:** This is NOT a calculation-engine bug — `assembleProjectEstimate`'s existing invalid-variant check worked exactly as designed (a surface referencing a `paintVariantId` absent from the revision's OWN `activeRateSnapshot.paintVariants` must be invalid, never silently resolved against the live catalog — that is the entire mechanism behind historical-rate-snapshot immutability). The bug was in the UI: `ProApp.tsx`'s paint-variant `<select>` for room/standalone surfaces, and the "add room"/"add ceiling"/"add standalone surface" default-variant logic, all sourced options from the LIVE `catalog` state instead of the draft's own `activeRateSnapshot.paintVariants`. That let a user pick (or silently receive as a default) a variant the draft's snapshot didn't have yet, producing a confusing, unrecoverable-looking "invalid" state with no visible path forward except an explicit rate refresh.

**Fix:** Every surface-adding action and every surface's paint-variant `<select>` now reads from `draftEdit.activeRateSnapshot.paintVariants` (a new `snapshotVariants` value derived from the open draft), not the live catalog. The live catalog is still correctly used in exactly one place — the rate-refresh panel's "replace with…" picker — since that panel is specifically about pulling in live catalog changes.

**Regression test:** `tests/domain/estimateAssembly.test.ts` — "A surface referencing a variant absent from the draft's OWN snapshot is invalid, not silently substituted" (the engine-level invariant this UI bug was violating). No component-level UI test was added (same known gap as bug #2 — no React component test infra in this project); re-verified manually in the browser after the fix.

**Verification:** Full suite (160/160) passes; re-verified live — see TEST_EXECUTION_REPORT.md browser verification notes.

---

## 7. A new draft revision created from an issued estimate was silently never saved (data loss, false "Draft saved." claim)

**Found by:** Live manual browser testing of the full 11-step draft/issued isolation journey — issued an estimate, clicked "Edit (creates a new draft revision)," widened the room, clicked "Save draft" (which correctly showed "Draft saved."), then inspected the actual IndexedDB record directly via the browser's devtools-equivalent (`indexedDB.open` + read) rather than trusting the UI. The persisted project had only ONE revision (the original issued one) — the new draft revision was completely absent — and `activeRevisionId` pointed at an ID that did not exist in the `revisions` array at all.

**Reproduction:** Issue an estimate, click "Edit" to create a new draft revision (`createDraftFromIssued`, which mints a brand-new revision `id`), edit it, then save. Reload/reopen the project: only the original issued revision exists; the edited draft and all its changes are gone, even though the UI displayed a success message.

**Root cause:** Both `saveDraft()` and `issueEstimate()` in `ProApp.tsx` built the project's updated `revisions` array with `activeProject.revisions.map((r) => (r.id === revisionToSave.id ? revisionToSave : r))`. `.map()` over an array that does not already contain an element matching `revisionToSave.id` returns the array completely unchanged — it has no way to *add* a new element. Since `createDraftFromIssued` always mints a new revision id, every "edit issued → save" cycle hit this path and silently dropped the new revision while still reporting success. This is exactly the class of defect the task explicitly warns about ("never claim success on failure") — except here nothing failed at the storage layer at all; the bug was upstream, building a no-op write and then honestly reporting that no-op as having succeeded.

**Fix:** Added `upsertRevision(project, revision)` to `src/domain/project.ts` — checks whether the revision's id already exists; if not, appends it; if so, replaces it in place. `saveDraft()` and `issueEstimate()` now both go through this instead of the bare `.map()`.

**Regression test:** `tests/domain/lifecycle.test.ts` — "upsertRevision: saving a NEW draft revision must APPEND it, not silently drop it," plus a companion case proving an existing revision is still replaced in place (not duplicated).

**Verification:** Both tests pass; full suite (162/162) passes; re-ran the exact live browser sequence that found the bug (issue → edit → widen room → save → inspect IndexedDB directly) and confirmed both revisions now persist correctly with a valid `activeRevisionId` — see TEST_EXECUTION_REPORT.md.

---

## 8. Pro's issued customer document had no print affordance, and would have printed internal notes and the whole app chrome

**Found by:** Manual browser + code review while verifying task item 6 ("customer-safe printing... inspect actual multi-page customer output"). The free tools (`EstimateTemplate.tsx`) already had a `window.print()` button and `print:`-variant CSS; the Pro app's issued-estimate customer document card had neither.

**Reproduction (as it stood before this fix):** Issue an estimate in the Pro app and try to produce a customer-facing printout. There was no print button anywhere on the page. If a user pressed Ctrl+P/Cmd+P anyway, the browser would print the ENTIRE page as rendered — the tab bar, "Business settings"/"Paint catalog"/etc. buttons, any save-message banner, and (worse) an internal developer note reading "verified by allow-list, see IMPLEMENTATION_DECISIONS.md" sitting directly under the price, all sent to the customer's printout. Separately, the document also never displayed the business name/contact/address or the customer's name/address, terms, or notes — fields that exist in `CustomerDocumentSnapshot` and are already allow-listed, but were simply never rendered.

**Fix:** Added a `window.print()` "Print / Save as PDF" button directly on the customer-document card; added `print:hidden` (Tailwind's print media-query variant, confirmed present in the compiled stylesheet) to the tab bar, save-message banner, conflict banner, the "Back to projects" button, the project-title/revision-info editor card, and the internal allow-list dev note — so only the actual customer document remains visible when printing. Also rendered the previously-missing `businessInfo`, `customerInfo`, `revisionLabel`, `notes`, and `terms` fields (all already present in the allow-listed `CustomerDocumentSnapshot`, just not wired into the UI) so the printed document is actually usable as a real customer-facing estimate.

**Regression test:** No automated test — this is print-media CSS and JSX rendering, outside the pure-function engine/domain layers this session's automated suite covers. Verified manually: issued a fresh estimate, confirmed the print button appears and calls `window.print`, confirmed via `document.styleSheets` inspection that a compiled `print:hidden` rule exists, and confirmed by reading the rendered DOM that the internal dev note and app chrome all carry the `print:hidden` class while the document content does not.

**Known remaining gap:** there is still no UI to enter `businessInfo`/`customerInfo` values before issuing (no form fields for business name/customer name exist yet, only the underlying data model and document rendering support them) — noted here rather than silently left incomplete. There is also no revision switcher — once a new draft revision exists for a project, the UI has no way to go back and view/reprint an earlier issued revision's document (its data is provably intact in storage, per the draft/issued isolation tests, but not reachable from the UI without directly inspecting storage).

---

## 9. Pro app's per-surface Coats field silently accepted 0, unbounded values, and truncated fractions (BOUND-003/004/005)

**Found by:** The parallel test-catalogue audit (this session), reading `ProApp.tsx`'s source directly rather than running a new test — traced the per-surface Coats input handler and found `Number.parseInt(v, 10) || 1`.

**Reproduction:** In the Pro app's room or standalone-surface editor, typing "0" into a surface's Coats field silently became 1 (JS's `0 || 1` falsy-zero idiom); typing "6" was accepted with no upper-bound check; typing "1.5" was silently truncated to 1. All three directly contradict `CALCULATION_SPEC.md`'s "coats integer 1..5" and its explicit "do not truncate meaningful quantities silently" instruction. The free `InteriorCalculator.tsx` tool already implemented this correctly via `parseCountField(coats, {min:1, max:5})`; the Pro app's newly-rewritten per-surface field did not reuse it.

**Root cause:** The new per-surface Coats `<input>` (added this session as part of the Pro UI rewrite) was written as a raw one-line `Number.parseInt` conversion instead of going through the engine's existing validated count parser.

**Fix:** Added `parseCoatsInput()` to `src/components/tools/shared.ts` — a single validated choke point wrapping `parseCountField` with the spec's 1..5 bound, returning `null` (clears the override) for blank input, the parsed integer for 1..5, or the literal string `'reject'` for anything else. Both per-surface Coats inputs in `ProApp.tsx` now only call `onPatch` when the result isn't `'reject'` — an invalid keystroke is refused outright (the field visually reverts to its last valid committed value) rather than silently substituting a wrong number.

**Regression test:** `tests/ui/shared.test.ts` — 6 cases covering blank/0/6/1.5/valid-range/malformed input.

**Verification:** New tests pass; full suite (177/177) passes; `astro check` clean.

## 10. Trim surface with a length of exactly 0 was wrongly rejected at field validation (BOUND-026)

**Found by:** The same parallel audit, reading `estimateAssembly.ts`'s trim-geometry branch.

**Reproduction:** A standalone (or room-attached) trim surface with `trimLengthFt: '0'` was marked `invalid` at the field level, blocking the whole project. Per `CALCULATION_SPEC.md`'s "zero-demand geometry" rule (already correctly implemented for room-derived wall/ceiling area, and explicit in `IMPLEMENTATION_DECISIONS.md` #8), a zero length/count is a legitimate field value that should pass field validation — a degenerate all-zero project is a job for the ISSUE gate, not field-level rejection. The catalogue's `BOUND-026` case states this explicitly: "accepted at field validation; zero-count project can still fail issue gate."

**Root cause:** `resolveSurface`'s trim branch in `src/domain/estimateAssembly.ts` had an extra `if (!lengthField.value.greaterThan(0) || !widthField.value.greaterThan(0)) return { state: 'invalid' }` check that wall/ceiling's manual-area path legitimately needs (per decision #8, manual area DOES require positive) but trim does not.

**Fix:** Removed the positivity floor for trim's length/width — `parseDecimalField` (without `allowNegative`) already guarantees a non-negative value, so no further check was needed; a trim surface with 0 length/width now correctly resolves to a valid (zero-demand) surface.

**Regression test:** `tests/domain/estimateAssembly.test.ts` — "BOUND-026: a trim surface with trimLengthFt=0 is ACCEPTED at field validation."

**Verification:** New test passes; full suite (177/177) passes.

---

## 11. Actual-cost review was never persisted (ACT-013/014) — verified live

**Found by:** The parallel test-catalogue audit (code reading: the actuals tab's state lived entirely in `useState` with no write path to `project.actualReviews` or IndexedDB).

**Reproduction (confirmed live this session):** Recorded a $400 confirmed "materials" actual against an issued estimate, reloaded the entire page (`navigate` to `/app` fresh), reopened the same project's Actual review tab — before the fix, this would show `0/4` confirmed and an empty amount, exactly as if nothing had ever been entered.

**Fix:** `src/domain/project.ts`'s `upsertActualReview` (append-or-replace, same shape as `upsertRevision`) plus a `saveActuals()` handler and a `useEffect` that loads any existing `ActualReview` for the current issued revision when a project is opened.

**Regression test:** `tests/domain/lifecycle.test.ts` — "upsertActualReview: ACT-013/014 regression" (2 cases: first save, update-in-place).

**Verification — live, after a full page reload:** confirmed "materials" with amount $400, clicked "Save actuals," reloaded the page from scratch (`navigate`, not just re-render), reopened the same project's Actual review tab, and confirmed via direct DOM inspection that the amount field read back `"400"` and the confirmed-count read `1/4` — proving the round-trip through real IndexedDB, not just in-memory state.

---

## 12. Free job-cost calculator showed a "complete" $0.00 result before any input (JOB-001/002)

**Found by:** The parallel test-catalogue audit, reading `JobCostCalculator.tsx`'s source and noticing it contradicted its OWN header comment ("a blank field is genuinely 'missing' (not silently 0) until the user types something"). Confirmed live in the browser this session: loading `/free/job-cost-calculator` fresh showed a full costed result ($0.00 everywhere) immediately, before typing anything.

**Reproduction:** Load the free job-cost calculator with no input. Expected (per `docs/tool-specs/02-free-job-cost-calculator.md`: "At first render show empty guidance until the user supplies/confirms cost data... missing active inputs block results"): no result, guidance text only. Actual: a fully "complete"-looking $0.00 cost/price breakdown rendered immediately.

**Root cause:** `parseDecimalField(materials || '0')` and the equivalent for `laborAmount` — the `|| '0'` fallback replaced a blank (missing) field with the STRING `'0'` before parsing, so `parseDecimalField` returned `{kind: 'valid', value: 0}` instead of `{kind: 'missing'}`. This silently converted "nothing entered yet" into "the user confirmed a $0 job," for the tool's two primary, required cost inputs, on a page anyone can reach with no account.

**Fix:** Materials and Labor are now parsed directly (`parseDecimalField(materials)`, no fallback) and the result short-circuits to "no result yet" (not an error, just nothing) when either is genuinely `missing`. Travel and Other-expenses keep their `|| '0'` fallback — those are legitimately optional additive line items where "I have none" is a normal, common answer, not an active required input. Added a neutral guidance message ("Enter materials and labor cost to see your estimated total") for the genuinely-incomplete state, matching the spec's "show empty guidance" instruction.

**Regression test:** No automated test added (this is a React-component-state bug in a UI with no component-test infrastructure in this project, same category as bug #2). Verified live in the browser: fresh page load now shows only the guidance text; entering Materials alone still shows guidance (Labor still missing); entering both Materials $620 and Labor $1,280 produces Direct cost $1,900.00 / Overhead $285.00 / Total $2,185.00 / Suggested price $3,361.54 — an exact match to the `job-homepage` acceptance fixture.

**Verification:** Full suite (179/179) passes; `astro check` clean; `astro build` succeeds; live browser re-verification as above.

---

## 13. Backup restore unconditionally overwrote local projects on an ID collision (BACK-004/017)

**Found by:** The parallel test-catalogue audit, reading `ProApp.tsx`'s `handleImport` directly.

**Reproduction:** `handleImport` called `setProjects(result.envelope.projects)` and `saveProjects(result.envelope.projects)` — replacing local React state with the imported project list outright, and `put`-ing every imported project over any existing one sharing the same ID, with no comparison at all. The already-implemented, already-unit-tested `planRestoreMerge`/`planImportAsCopies` (which correctly implement `DATA_CONTRACT.md`'s "identical skip; new add; conflicting content requires an explicit choice — default keep-local, never automatic timestamp-wins") were never actually called from the shipped restore path — dead code from the product's perspective.

**Root cause:** The restore handler was written as a quick wholesale "load whatever's in the file" implementation and never wired up to the conflict-aware planning function that already existed and was already correct.

**Fix:** `handleImport` now calls `planRestoreMerge(projects, result.envelope.projects)` and only ever ADDS `plan.toAdd.projects` to the existing local list — an identical existing project is skipped (not duplicated), and a project sharing an ID with different content is left exactly as it was locally (the safe default), with an on-screen note telling the user how many projects were skipped or kept-as-is due to a conflict. This closes the silent-data-loss risk; it does **not** yet build a full per-conflict "keep local / replace / keep both" resolution UI — that remains a real, named gap (see `TEST_EXECUTION_REPORT.md` §7), but the dangerous default (silent overwrite) is gone.

**Regression test:** No new automated test for the UI wiring itself (no component-test infra in this project); the underlying `planRestoreMerge` behavior this fix now actually uses is already covered by `tests/domain/backup.test.ts::BACK-D09` (4 cases: identical-skip, new-add, conflict-defaults-keep-local, repeated-restore-no-duplicate). Not re-verified live in the browser this session (file download/re-upload through the sandboxed preview browser was not attempted) — flagged here rather than silently claimed.

**Verification:** Full suite (179/179) passes; `astro check` clean; the fix is a direct composition of an already-tested pure function, not new untested logic.

---

## 14. Dodo Payments integration: a full refund would not have revoked access (ACCESS-010)

**Found while implementing, not by a separate audit pass:** while writing `verify.ts`/`redeem.ts` against the `dodopayments` SDK's own type definitions, checked how a refund is represented on a `Payment` object.

**Reproduction (as first written):** Both routes only checked `payment.status !== 'succeeded'` to decide entitlement. Reading `node_modules/dodopayments/resources/payments.d.ts` directly confirmed `payment.status` stays `'succeeded'` even after a refund — Dodo tracks refunds on a **separate** `refund_status?: 'partial' | 'full' | null` field. A customer refunded through Dodo's dashboard would have kept a permanently-working license key, since nothing ever re-checked that field.

**Fix:** `verify.ts` and `redeem.ts` now also reject when `payment.refund_status === 'full'` (with a distinct "refunded" status surfaced to the UI), while a `'partial'` refund does **not** revoke access — full revocation is an unambiguous API fact, but whether a partial refund should still count as a valid purchase is a merchant-policy call this session did not invent an answer for.

**Regression test:** No automated test (would need a real or mocked Dodo API response with `refund_status: 'full'`, which requires either a real sandbox account or introducing a mock layer this integration doesn't otherwise use). Verified by direct SDK type inspection, not by triggering a real refund.

**Verification:** `astro check` clean; full suite (188/188) passes; this fix ships in the same commit as its own discovery, before any real payment was ever processed against this codebase.

---

## 15. Free estimate template: invalid tax silently fell back to zero and never blocked printing (TPL-010/011); no real duplicate/zero-total confirmation existed (TPL-012/014)

**Found by:** User-directed re-audit of TPL-010/011/012/014, confirming the exact defect already named: "The existing negative-tax defect is not that the parser accepts negatives. It rejects them, but the template falls back to zero tax and still permits printing."

**Reproduction (confirmed by reading the old code before touching it):** `EstimateTemplate.tsx`'s `evaluation` memo computed `taxRatio = pTax.kind === 'valid' ? pTax.value.dividedBy(100) : new PEP(0)` and passed `taxEnabled && pTax.kind === 'valid'` as the "apply tax" flag to `computeDocumentTotals` — an invalid tax percentage (blank, malformed, negative, or >100) silently disabled tax entirely rather than erroring, and `canPrintPriced` never checked tax validity at all, so printing stayed enabled throughout.

Separately: "Duplicate" only re-assigned line IDs on the SAME in-memory form (`setLines((ls) => ls.map((l) => ({ ...l, id: ... })))`) — there was no second, independent estimate at all, so "preserve the original unchanged" was structurally impossible. A valid $0.00 total could print with no confirmation step (TPL-012), and the tool had no reload persistence to test (TPL-014's broader multi-draft/estimateNumber model didn't exist).

**Fix:** Extracted all of this into a pure, tested module (`src/components/tools/estimateTemplateLogic.ts`): `validateTaxPercent` (blocks on invalid, warns above 25%, accepts exact 0 and 100), `evaluatePrintEligibility` (a zero total requires an explicit `noChargeConfirmed` checkbox, and neither that checkbox nor anything else can override an incomplete row or invalid tax), and `cloneDraftForDuplicate` (real deep clone with fresh draft/line ids and a cleared estimate number, per tool-specs/01's exact wording). Rewrote `EstimateTemplate.tsx` around a `drafts: EstimateDraft[]` array persisted to `localStorage`, so "Duplicate" creates a genuinely separate, independently-editable, independently-printable estimate while the original stays selectable and unchanged, and drafts now survive a page reload. Also added a proper print-only view (business/customer info, itemized lines, totals, notes) with `print:hidden` on all interactive chrome — the previous print view showed only a business/customer name fragment and would otherwise have printed the raw editable form.

**Regression test:** `tests/ui/estimateTemplateLogic.test.ts` (21 tests) — includes an explicit reproduction of the OLD buggy computation (reconstructed inline, not by editing production code back) proving it never blocked printing on invalid tax, contrasted with the new `validateTaxPercent` correctly flagging it; full tax boundary coverage (blank/malformed/negative/>100/exactly 100/exactly 0/>25% warning); zero-total confirmation (required, never bypassable by an incomplete row or invalid tax); duplicate independence (fresh ids, cleared estimate number, no shared references in either direction).

**Verification — live in the browser:** entered a $450 line, enabled tax, set it to `-5` — observed "Tax percentage must be a plain number between 0 and 100." and confirmed via direct DOM inspection that the Print button's `disabled` property is `true`. Changed tax to `8.5` — observed Tax $38.25 / Total $488.25 (exact arithmetic) and Print re-enabled. Clicked Duplicate — a second, independent estimate ("Untitled", cleared number) appeared with the same starting data; edited its description to "CHANGED IN DUPLICATE," switched back to the original, and confirmed via DOM inspection the original still read "Living room repaint" — untouched. Reloaded the page from scratch and confirmed both estimates persisted with their distinct data intact. Created a third estimate with an explicit $0.00 line — observed the no-charge confirmation checkbox appear and Print stay disabled until checked, then enable immediately after.

**Verification (automated):** 209/209 tests pass (21 new); `astro check` 0 errors; `astro build` succeeds.

---

## 16. (Serious, security) A forged localStorage entry unlocked Pro forever, because `verifyAccess()` couldn't tell a network outage apart from the server rejecting the payment (ACCESS-002)

**Found by:** Live browser testing while implementing UX-013's free-to-Pro handoff — planted a completely fabricated `pep_payment_v1` value in `localStorage` (`{paymentId: 'forged_fake_payment_id', ...}`) via devtools/`javascript_tool`, purely to check the handoff prompt's rendering, and observed the Pro workspace unlock instead of the paywall.

**Reproduction:** With no real Dodo credentials configured (this repo's actual current state), write any `pep_payment_v1` value to `localStorage` and load `/app`. Before this fix: Pro unlocked immediately, regardless of the fabricated payment id, because `/api/checkout/verify` genuinely can't reach Dodo (no API key) and returns a 500 — and `verifyAccess()`'s catch block treated that exactly like a dropped network connection.

**Root cause:** `src/lib/license.ts`'s `verify()` threw a single generic `Error` for BOTH a real network failure (the request never reaching the server) AND a definitive server response (500 "not configured," a 404, a "refunded" status, anything). `verifyAccess()`'s catch block then applied its "fail open for a paying customer during a network hiccup" policy to both cases identically — so ANY server-side error, including permanent misconfiguration, silently became "assume they're still entitled," which is exactly the ACCESS-002 failure mode ("paid flag manually written in localStorage — not accepted as verified entitlement") the catalogue explicitly names.

**Fix:** Introduced `NetworkFailure`, thrown only when `fetch()` itself rejects (the request never got a response at all). Any response the server actually sent — 4xx, 5xx, a parsed `{ok:false}` body — now clears the stored payment and denies access, unconditionally. Only a genuine `NetworkFailure` still fails open on a previously-confirmed payment.

**Regression test:** `tests/lib/clientLicense.test.ts` (5 tests, with an in-memory `localStorage`/`sessionStorage` polyfill and a stubbed `fetch`) — explicitly reproduces the forged-entry-against-a-server-error scenario and asserts it's now rejected and cleared, alongside a genuine `fetch()`-throws case still failing open, and a real refused/succeeded response each behaving correctly.

**Verification — live, both before and after the fix:** planted the identical forged `pep_payment_v1` record in the real browser both times. Before the fix: `/app` showed the full unlocked Pro workspace. After the fix (same forged record, never cleared in between): `/app` correctly showed the paywall again, and `localStorage.getItem('pep_payment_v1')` read back `null` — confirming the forged record was actively cleared, not just ignored.

**Verification (automated):** 219/219 tests pass (5 new); `astro check` 0 errors; `astro build` succeeds. This also corrects the earlier (incorrect) `ACCEPTANCE_MATRIX`/CSV claim that ACCESS-002 was already safely implemented — it was not, until this fix.

---

## 17. Free job-cost calculator was missing its specified materialsMode/laborMode toggles and a real other-expenses list (JOB-005/006/007/008)

**Found by:** Verifying "the full free job-cost workflow against its required inputs, outputs, validation, and rounding rules" per tool-specs/02, which specifies `materialsMode lumpSum|itemized`, `laborMode direct|hoursRate`, and `otherExpenseLines` as a real list — the shipped tool only had a single flat "Materials," "Labor," and "Other expenses" field each, with no itemized/hours×rate path and no way to add more than one other-expense line.

**Fix:** Extracted the full spec-shaped calculation into a pure, tested module (`src/components/tools/jobCostCalculatorLogic.ts`) and rebuilt `JobCostCalculator.tsx` around it: a materials mode toggle (one amount, or paint gallons × price/gal + supplies), a labor mode toggle (one amount, or hours × loaded rate), and a real add/remove list of other-expense lines alongside travel. Each mode strictly reads only its own active fields — switching modes never blends stale values from the inactive one, per the spec's explicit requirement.

**Regression test:** `tests/ui/jobCostCalculatorLogic.test.ts` (14 tests) — includes the spec's own "original brief acceptance" worked example (42hr×$32 labor, 22gal×$42+$180 supplies, $100 travel, $75 other) as an independently-derived oracle (the numbers come straight from the spec text, not from running the function under test), plus mode-isolation tests (each mode ignores the other's stale text), the JOB-001/002 missing-vs-explicit-zero distinction, multi-line expense summation, and pricing-status forwarding (unpriced/below-cost never suppressed).

**Verification — live in the browser:** switched to "paint + supplies" and "hours × rate" modes, entered the exact spec fixture values, and observed Materials $1104.00 / Labor $1344.00 / Other expenses $175.00 / Direct cost $2623.00 / Overhead $393.45 / Total $3016.45 / Approx $4640.69 / Suggested $4640.70 — an exact match to every figure in tool-specs/02's worked example.

**Verification (automated):** 233/233 tests pass (14 new); `astro check` 0 errors; `astro build` succeeds.

---

## 18. Missing revision-selection workflow — previously issued revisions became unreachable from the UI

**Found by:** Named directly in this session's task (item 7) and previously flagged as a known gap in `TEST_EXECUTION_REPORT.md` §7 — once a project had more than one revision, only the currently-"active" one was ever shown; an earlier issued revision's customer document was provably intact in storage (per the draft/issued isolation tests) but had no way to be opened or reprinted from the UI.

**Fix:** Added a revision selector to the project detail view (shown whenever a project has more than one revision) listing every revision by number and state, with the currently-active one marked. Selecting a revision loads it into the (read-only, for an issued one) view — the existing render logic already correctly shows only the customer document + "Edit" button for an issued revision and the full editor for a draft, so this only needed to make every revision *reachable*, not new rendering logic. Viewing a revision never changes which one is "active" — only issuing a new one does, which the selector's copy states explicitly.

**Regression test:** No new automated test (this is pure navigation/selection UI wiring around already-tested rendering logic — the underlying "issued revisions stay frozen and independently correct" guarantee is what `tests/integration/draftIssuedIsolation.test.ts` already proves).

**Verification:** 237/237 tests pass; `astro check` 0 errors; `astro build` succeeds. **Not verified live in the browser** — this session has no real Dodo credentials to unlock the Pro workspace UI itself (the same disclosed limitation affecting every Pro-gated feature's live verification this session), so this fix is verified by code reading and the passing automated suite only, not a browser click-through. Flagged explicitly rather than claimed as browser-verified.

---

## 19. Backup import validation had no dangling-actual-baseline check and no field-level financial validation (BACK-015/020)

**Found by:** Task item 5 ("Make backups safe and complete"), naming BACK-015 ("Actual baseline ID points to missing revision | Validate | Reject dangling reference") and BACK-020 ("Unknown enum, negative costs, nondecimal scalar in imported active financial data | Import | Reject invalid schema/ranges; no silent coercion") explicitly by catalogue text. Reading the current `validateBackupEnvelope` in `src/domain/backup.ts` confirmed it checked schema version, byte size, duplicate paint-variant IDs, and the presence of each revision's embedded rate snapshot — but never validated an `ActualReview.baselineIssuedRevisionId` against the project's own revision list, and never validated any financial scalar (`pricePerGal`, `coverageFt2PerGal`, `proposedPrice`) or enum (`RevisionState`, `PriceMode`) beyond structural presence. A crafted or corrupted backup file could import a review pointing at a revision that doesn't exist in that project, or a negative/non-numeric price, and the importer would accept it silently.

**Fix:** Extended `validateBackupEnvelope` to, for every project: (1) build the set of that project's own revision IDs and reject any `actualReviews[].baselineIssuedRevisionId` not in that set (BACK-015); (2) reject any revision whose `state` is not one of `draft|issued|superseded` or whose `priceMode` is not one of `suggested|custom` (BACK-020 enum half); (3) reject any revision's `proposedPrice` (when non-null) or any paint variant's `pricePerGal`/`coverageFt2PerGal` that fails the engine's own `parseDecimalField` non-negative-decimal grammar — reusing the exact same grammar the calculation engine trusts at runtime, rather than a second hand-rolled numeric check that could drift from it (BACK-020 scalar half). All of these are added to the existing `issues[]` accumulator, so — consistent with BACK-D11 — any single violation anywhere in the file blocks the entire import before any write, with a structured, path-qualified message per issue.

**Regression test:** `tests/domain/backup.test.ts`, two new `describe` blocks (7 tests): BACK-015 rejects a dangling `baselineIssuedRevisionId` and accepts a correctly-matching one; BACK-020 rejects a negative `pricePerGal`, a non-decimal `pricePerGal` ("forty-two"), an unknown revision `state` enum value, and a negative `proposedPrice`, while confirming a `null` `proposedPrice` (a genuinely unpriced estimate) is still accepted — proving the fix distinguishes "missing/null" from "invalid" rather than rejecting every falsy value.

**Verification (automated):** All 7 new tests written and run red against the pre-fix `validateBackupEnvelope` (confirmed failing — the function returned `ok: true` for every corrupted fixture), then green after the fix. Full suite: 244/244 tests pass (7 new since entry #18's 237); `astro check` 0 errors; `astro build` succeeds.

---

## 20. Backup import had no conflict preview/choice UI, committed non-atomically across three separate writes, and export hardcoded empty placeholders for two record types

**Found by:** A targeted audit of the actual import/export UI in `ProApp.tsx` against item 5's explicit requirement ("Implement required conflict preview/choices/confirmation/cancellation for backup import... confirmed imports must commit atomically... never export empty placeholders for record types containing user data"). The domain layer (`planRestoreMerge`) already computed a `conflicts` array and the `ImportConflict` type already modeled `kind: 'businessSettings' | 'paintVariant' | ...` resolutions, but none of it reached the UI: `handleImport` ran immediately on file selection with no preview step, hardcoded every conflict to `keepLocal` with no way to choose otherwise, and (per the file's own comment) admitted "a full per-conflict resolution UI isn't built yet." Separately, `handleImport` committed via three independent calls — `saveBusinessSettings`, `savePaintVariants`, `saveProjects` — each its own IndexedDB transaction, so a failure after the first two succeeded would leave settings/catalog persisted while projects were not; in-memory state was also applied via `setSettings`/`setCatalog`/`setProjects` *before* any of those calls, so the UI could show a partially-committed import as fully successful. Finally, `handleExport` passed literal `[]` for `otherMaterials`/`serviceDefinitions` instead of reading them from storage — currently harmless only because no UI writes to either store yet, but a landmine the moment either becomes a real feature.

**Fix:**
- **Domain layer** (`src/domain/backup.ts`): extracted the existing project-merge logic into a generic `planArrayMerge<T extends {id:string}>` (identical→skip, new→add, conflicting→conflict defaulting to `keepLocal`), reused it for paint variants, and added `planFullRestoreMerge` which merges projects AND the paint catalog AND compares the business-settings singleton directly (any difference is one `businessSettings` conflict). `planRestoreMerge` itself is preserved unchanged (implemented via the new generic helper) so no existing test broke.
- **Persistence** (`src/components/tools/pro/proStore.ts`): added `saveImportedBackup({businessSettings, paintVariants, projects})`, which commits all three in a single `writeAll` call — one IndexedDB `readwrite` transaction, all-or-nothing.
- **UI** (`ProApp.tsx`): split the single `handleImport` into `handleImportFileSelected` (parse + validate + compute the full plan into `pendingImport` state — no writes), a preview panel rendering every conflict with a per-item radio choice (Keep local / Use imported / Keep both — "keep both" omitted for the business-settings singleton, since duplicating settings has no meaning), `cancelImport` (clears `pendingImport`, writes nothing), and `confirmImport` (applies every chosen resolution — including reusing the already-tested `planImportAsCopies` remap for any project the user chooses "keep both" on, so a duplicated project still gets fresh IDs throughout its graph and a correctly-remapped actual-review baseline — then commits everything through the new atomic `saveImportedBackup`, only updating in-memory state after that write actually succeeds). `handleExport` now reads `otherMaterials`/`serviceDefinitions` from the live storage snapshot instead of hardcoding `[]`.

**Regression tests:** `tests/domain/backup.test.ts` — 3 new tests for `planFullRestoreMerge` (identical triple → zero conflicts; new vs. conflicting paint variant; differing business settings → exactly one conflict). `tests/integration/backupRestoreStorage.test.ts` — 4 new tests through real IndexedDB: cancelling leaves storage completely untouched; confirming "replace imported" overwrites the conflicting project; confirming "keep both" commits a genuinely new copy with remapped IDs and a correctly-repointed actual-review baseline (never a raw ID collision); a differing settings singleton produces exactly one conflict.

**Verification (automated):** 252/252 tests pass (11 new since entry #19's 244 — note this also includes the earlier BACK-015/020 dangling-fallback regression test recorded alongside entry #19); `astro check` 0 errors; `astro build` succeeds. **Not verified live in the browser** — this UI lives inside the Pro workspace, which (correctly, per the ACCESS-002 fix in entry #16) can no longer be unlocked locally with a forged payment record, and this session has no real Dodo credentials. Verified by the passing automated suite and code reading only; flagged explicitly rather than claimed as browser-verified, consistent with entry #18's disclosure for the same underlying limitation.

---

## 21. Free interior calculator defaulted door/window counts to blank (not zero) and had no compatible free-to-Pro handoff (INT-013/UX-013)

**Found by:** Task item 4, naming both cases directly: INT-013 ("default interior door/window counts to zero per spec, keep blank distinct from explicit zero, clearly label sample data with an intentional load action") and UX-013 (the free-to-Pro handoff must "preserve supported inputs/units/assumptions, validate transferred data, explain unsupported fields, never silently insert defaults or discard user data"). The shipped `InteriorCalculator.tsx` left `doorCount`/`windowCount` blank by default (spec requires an explicit `0` default, since a room legitimately has zero doors/windows far more often than it has an unentered count) and had no "continue in Pro" path at all — a user finishing the free tool had no way to carry that work into a Pro estimate without retyping everything.

**Fix:** Set `DEFAULTS.doorCount`/`DEFAULTS.windowCount` to `'0'` (explicit zero, distinct from the still-blank `length`/`width`, which remain genuinely unset until the user measures them) and added a labeled `loadSampleData()` action plus "(sample)" field annotations so sample values are never confused with the user's own entries. Built `src/domain/interiorHandoff.ts` — `writeInteriorHandoff`/`readInteriorHandoff` (a `sessionStorage`-backed payload, not silently merged into Pro state) and `buildProjectFromInteriorHandoff`, which maps every supported field across exactly, returns an explicit `unsupportedFieldNotes` list for anything the free tool captured that Pro's richer model doesn't (e.g. the free tool's flat labor rate vs. Pro's per-surface throughput model), and never fabricates a default for a field the user didn't actually provide. Wired a "Continue this room in Pro →" button in `InteriorCalculator.tsx` that writes the handoff payload before navigating.

**Regression test:** `tests/domain/interiorHandoff.test.ts` (5 tests) — exact field carry-over, ceiling-surface inclusion, explicit unsupported-field disclosure (labor rate), a full round-trip through the real Pro `assembleProjectEstimate` pipeline reproducing the documented $168/4-gal fixture end to end, and purity (the input payload is never mutated).

**Verification — live in the browser:** loaded the interior calculator with its defaults showing door/window counts as `0` (not blank), used "Load sample data" and confirmed every sample field is labeled "(sample)", and confirmed the default (non-sample) state keeps `length`/`width` genuinely blank while door/window counts read `0` — the missing-vs-explicit-zero distinction the spec requires. The Pro-side landing of "Continue this room in Pro" was **not** verified live (it lands inside the Pro workspace, which this environment cannot unlock without real Dodo credentials); that half is verified by the passing `interiorHandoff.test.ts` round-trip test only.

**Verification (automated):** all tests pass as part of the full 252/252 suite; `astro check` 0 errors; `astro build` succeeds.

---

## 22. (Serious, security) Checkout verification, license redemption, and the payment webhook granted Pro access for ANY successful Dodo payment, never confirming it purchased the configured product (ACCESS-013)

**Found by:** Task item 4, naming the defect directly and providing a reproduction: "supplying a successful payment for an unrelated product returned HTTP 200 with ok: true." Reading `src/pages/api/checkout/verify.ts`, `src/pages/api/license/redeem.ts`, and `src/pages/api/webhooks/dodo.ts` confirmed all three checked `payment.status === 'succeeded'` and `payment.refund_status`, but never checked `payment.product_cart` against the configured `PRO_PRODUCT.id` (already defined in `src/lib/server/dodo.ts`, used correctly at checkout-creation time in `create.ts`, but never re-checked at any of the three places that actually GRANT access). Since Dodo's `payment_id` is scoped to the merchant account, not to a specific product, a real successful payment for any other product sold on the same Dodo account — or a different/legacy price — would unlock the $99 Pro tier for free through any of the three paths.

**Reproduction (regression-first, red before fix):** wrote `tests/lib/serverDodo.test.ts`, `tests/api/checkoutVerify.test.ts`, `tests/api/licenseRedeem.test.ts`, and `tests/api/webhookDodo.test.ts` — the latter three import and call the REAL exported `GET`/`POST` handlers from the actual route files, mocking only the Dodo SDK (`dodopayments` package) and, for the webhook, `standardwebhooks`'s signature verification — never reimplementing the handlers' own logic. Run against the original code: `checkoutVerify.test.ts`'s "a real, successful payment for an UNRELATED product must NOT unlock Pro" failed with the handler returning `{ok: true, licenseKey: ...}` for a payment whose `product_cart` named a completely different product; the identical failure reproduced against `licenseRedeem.test.ts` and `webhookDodo.test.ts` (the webhook sent a working license-key email for the unrelated-product payment). Also found in the same pass: `verify.ts` and `redeem.ts` had no check at all for a missing `DODO_PRODUCT_ID_PRO` configuration (unlike `create.ts`, which already guards it) — `verify.ts` would return `ok: true` regardless, and `redeem.ts` crashed into a generic 502 instead of a clear 500.

**Fix:** added a single shared `evaluatePaymentEntitlement(payment)` function in `src/lib/server/dodo.ts` — the one place that decides whether a Dodo `Payment` object entitles its holder to Pro: status must be `succeeded`, `refund_status` must not be `full`, `PRO_PRODUCT.id` must be configured, and `payment.product_cart` must actually include that product id. Wired identically into all three call sites: `verify.ts` and `redeem.ts` now call it after retrieving the payment (replacing their duplicated inline status/refund checks) and both gained the same early `!client || !PRO_PRODUCT.id` guard `create.ts` already had; the webhook now runs the same check directly against its `payment.succeeded` event payload (which the SDK's own types confirm IS a full `Payment` object — no extra API call needed) before ever building or emailing a license key.

**Regression tests:** 34 new tests total — `tests/lib/serverDodo.test.ts` (9, pure decision-function cases: correct product, wrong product, empty/missing cart, pending, failed, full refund, partial refund allowed, malformed status, missing product configuration); `tests/api/checkoutVerify.test.ts` (11), `tests/api/licenseRedeem.test.ts` (8), and `tests/api/webhookDodo.test.ts` (6) drive the real handlers end-to-end with a mocked Dodo SDK, covering: correct-product success, the wrong-product regression itself, pending/failed/refunded payments, missing configuration (never even calling Dodo), a provider/network failure (502, never granting access), and — for the webhook — an invalid signature (401, entitlement never evaluated).

**Verification (automated):** 286/286 tests pass (34 new); `astro check` 0 errors; `astro build` succeeds. **Not verified against a real Dodo account** — this environment has no real Dodo credentials (the same disclosed limitation as every other Dodo-integration fix); the mocked-SDK integration tests above are the evidence for this fix, and real-provider acceptance remains the one genuine external dependency named in `RELEASE_READINESS.md`.

---

## 23. (Serious, security) A genuine or simulated network failure let a completely fabricated local payment record unlock Pro forever (ACCESS-014)

**Found by:** Task item 3, with an exact reproduction: "Put an invented payment ID and license key in pep_payment_v1. Make fetch reject as it would during a network outage. Call verifyAccess()." Reading `src/lib/license.ts`'s `verifyAccess()` confirmed the defect precisely: `catch (err) { if (err instanceof NetworkFailure) return stored; ... }` — `stored` is nothing more than whatever `localStorage.getItem('pep_payment_v1')` currently holds, fully editable by anyone with devtools, with no proof it was ever the product of a real verification. This was the direct, more serious relative of the already-fixed ACCESS-002 (BUG_FIX_LOG #16): that fix correctly made a real server response fail closed, but the network-failure branch itself — the one remaining path that failed OPEN — could be reached by simply fabricating a record and being offline (or simulating being offline), which is trivial for an attacker to arrange on purpose. The PRE-FIX test suite (`tests/lib/clientLicense.test.ts`) had actually encoded this as intentional, correct behavior: `expect(result).not.toBeNull(); expect(getStoredPayment()).not.toBeNull();` for "a genuine network failure ... fails OPEN on a previously-stored payment" — this test itself is the clearest evidence of the pre-fix vulnerable contract.

**Why not an offline signed license instead:** `docs/ACCESS_SPEC.md` states "If using offline signed licenses, signing must occur in a trusted service and client verification uses a public key" — but this is conditional ("if using"), not a requirement, and no signing service/keypair infrastructure exists in this codebase. Building one (server-side key management, a signed token format, client-side signature verification) would be a substantial new feature, not a defect fix, and the same spec document explicitly allows the simpler alternative it names right after: "Otherwise, require successful online verification." That is the fix applied here — never a redesign of the payment architecture.

**Fix:** `verifyAccess()` is replaced by `checkAccess()`, returning a three-way `{status: 'granted'|'noAccess'|'unavailable'}` instead of a nullable `StoredPayment`. A `NetworkFailure` now returns `{status: 'unavailable'}` — never access, but also never clears the stored record or any local project data (which lives independently in IndexedDB regardless of gate state), so a real customer's retry succeeds later without re-purchasing. A real server response continues to fail closed exactly as ACCESS-002 already fixed (any rejection clears the record and returns `noAccess`). `ProGate.tsx` now renders a distinct "Can't verify access right now" screen with a Try again button for `unavailable`, instead of either unlocking Pro or showing the paywall's "purchase failed" framing — and the same distinction now applies to a `NetworkFailure` thrown from the checkout-return/recovery path (`resolvePendingCheckout()`), not just the routine re-check.

**Regression tests:** `tests/lib/clientLicense.test.ts` fully rewritten (9 tests) covering exactly the categories the task named: a fabricated record combined with a simulated network outage (the task's own reproduction — asserts `unavailable`, never `granted`, record preserved); a malformed (unparseable) stored record; unavailable network on repeated retries; a real server error response (still fails closed, clears the record — ACCESS-002 preserved); a valid, live-confirmed entitlement (still grants); a revoked/refunded entitlement; an invalid/never-existed entitlement; and the configured offline policy explicitly (a network failure on a real, previously-valid payment still reports `unavailable`, never silently unlocking and never silently revoking).

**Verification — live in the browser:** planted the exact fabricated record from the task's reproduction (`totally_invented_payment_id`) via `javascript_tool`, monkey-patched `window.fetch` to reject (simulating the network outage), and called the real `checkAccess()` via a live dynamic import of the actual source module — confirmed `{status: 'unavailable'}`, with the fabricated record still present in `localStorage` (preserved for retry, not treated as verified). Restored the real `fetch` and re-ran the identical call against this environment's own genuinely-unconfigured dev server — confirmed `{status: 'noAccess'}` with the record cleared, proving the ACCESS-002 fail-closed path is untouched by this fix. Reloaded `/app` fresh afterward and confirmed the normal, correctly-locked paywall renders with no leftover forged access.

**Verification (automated):** 290/290 tests pass (9 rewritten, net 0 new since this replaces the prior file's 5); `astro check` 0 errors; `astro build` succeeds.

---

## 24. Backup validation covered only a small fraction of the approved schema — could crash on corrupted input and accepted many invalid graphs (item 5)

**Found by:** Task item 5, naming the gap directly: "validateBackupEnvelope validates only selected fields. Nested null entries can throw, business settings and many nested structures remain unchecked, and duplicate-ID validation covers only paint variants." Reading the validator (after this session's earlier BACK-015/020 fix) confirmed it checked schema version, file size, paint-variant duplicate IDs/financial fields, and revision-level state/priceMode/proposedPrice/snapshot-presence — but never validated `BusinessSettings`, `OtherMaterial`, `ServiceDefinition`, `Room`, `Surface`, `RateSnapshot`'s nested content, `AdditionalLaborLine`/`OtherMaterialLine`/`ExpenseLine`, `SuppliesAllowance`, or most of `EstimateRevision`'s own fields at all — and had no duplicate-ID check for anything except paint variants.

**Reproduction (regression-first, red before fix):** 14 new tests in `tests/domain/backup.test.ts`'s new `BACK-COMPLETE` block, run against the pre-fix validator: a `null` entry inside `projects[].revisions[]` threw an **uncaught `TypeError: Cannot read properties of null (reading 'id')`** — a genuine crash risk on a corrupted import, exactly what item 5 warns against; a `null` entry inside a revision's `surfaces[]` was silently accepted; a wrong-typed `overheadRatio` (a number instead of a decimal string) was accepted; a non-decimal `targetMarginRatio` string was accepted; a room missing its required `name` was accepted; duplicate revision/room/surface IDs within the same project/revision were all accepted; a paint variant with `coverageFt2PerGal: "0"` (a real divide-by-zero risk in the calculation engine) was accepted since it's technically "non-negative"; a project's `activeRevisionId` pointing at a nonexistent revision was accepted; a room's `surfaceIds` and a surface's `roomId` pointing at nonexistent siblings were both accepted; and an actual review whose baseline targeted a **draft** revision (never issued) was accepted, even though `DATA_CONTRACT.md` explicitly requires actual reviews to stay linked to an *issued* baseline.

**Fix:** rewrote `validateBackupEnvelope` around a set of small, reusable, crash-proof helpers (`isPlainObject` guards every nested object before any field access; `checkRequiredString`/`checkRequiredBoolean`/`checkEnum`/`checkRequiredInt`/`checkOptionalInt`/`checkRequiredNonNegativeDecimal`/`checkOptionalNonNegativeDecimal`/`checkRequiredPositiveDivisorDecimal`/`checkOptionalPositiveDivisorDecimal`/`checkNoDuplicateIds`), then a full per-entity validator for every type in `DATA_CONTRACT.md`'s schema: `BusinessSettings` (reused for both the top-level settings and every snapshot's embedded copy), `PaintVariant`, `OtherMaterial`, `ServiceDefinition`, `Room` (cross-referencing its `surfaceIds` against the revision's real surfaces), `Surface` (cross-referencing its `roomId`), `RateSnapshot`, `AdditionalLaborLine`, `OtherMaterialLine`, `ExpenseLine`, `SuppliesAllowance`, and `ActualReview` (now checking both that the baseline revision exists AND that its `state === 'issued'`). Duplicate-ID checks now run for paint variants, other materials, service definitions, projects, and — per project — revisions, and — per revision — rooms and surfaces. `coverageFt2PerGal` and every throughput/hourly-rate field now additionally require `isPositiveDivisor` (the same engineering bound the calculation engine itself enforces), catching zero (and near-zero) values that "non-negative" alone would let through. Every array is defended with `Array.isArray` before iterating, and every nested item is checked with `isPlainObject` before any field access — a `null`, string, or number sitting where an entity belongs is now a structured issue, never a crash. Deliberately did NOT add any check on a *derived* value (profit/margin) — only the stored cost/rate/price fields feeding those calculations are validated, so a real loss (negative derived margin) is never rejected, per the task's explicit caution.

**Regression tests:** the 14 tests above are all green post-fix, plus a positive control ("still accepts a fully well-formed envelope with rooms, surfaces, and a valid issued-baseline actual review") proving the stricter validator doesn't reject legitimate data. One pre-existing test's fixture (`BACK-015`'s "accepts a matching baseline" case) needed updating from a draft-revision baseline to an issued one, since a draft baseline is now correctly rejected — this was a fixture correction, not a weakened assertion.

**Verification (automated):** 305/305 tests pass (14 new); `astro check` 0 errors; `astro build` succeeds.

---

## 25. Import-as-copies left room/surface IDs and their cross-references untouched, and exportBackup silently wiped accumulated import provenance (item 6)

**Found by:** Task item 6, naming both defects directly. Reading `remapProjectIds` in `src/domain/backup.ts` confirmed it remapped `Project.id`, each `EstimateRevision.id`/`projectId`, and each `ActualReview.id`/`projectId`/`baselineIssuedRevisionId` — but never touched `Room.id`, `Surface.id`, `OpeningEntry.id`, or any of the three line-item arrays (`additionalLabor`, `otherMaterialLines`, `otherExpenses`), and never rewrote a room's `surfaceIds` or a surface's `roomId` to point at the new IDs. Two "independent" copies of the same source project — or the original and its copy — would carry identical room/surface IDs, a real collision risk for anything that ever keys off them. Separately, `exportBackup` always returned `importProvenance: []` regardless of what was passed in — since nothing called it with a real provenance array anyway (see entry #26), this meant every fresh export discarded the installation's entire import history, breaking "repeat import of the same export should be recognized" across an export/reimport round trip.

**Reproduction (regression-first, red before fix):** two new tests in `tests/domain/backup.test.ts`. The remap test built a project with one room referencing one surface (and vice versa via `roomId`), ran `planImportAsCopies`, and found the copy's room/surface still carried the literal original IDs `room-1`/`surf-1` — confirmed genuinely unfixed. The provenance test called `exportBackup` with a non-empty existing `importProvenance` array and found the resulting envelope's `importProvenance` was `[]` regardless.

**Fix:** added `remapRevisionChildIds(rev, ids)`, which builds fresh-ID maps for a revision's own surfaces and rooms, remaps every surface (`id`, and `roomId` rewritten via the room-ID map), every room (`id`, `surfaceIds` rewritten via the surface-ID map, and each embedded `OpeningEntry.id`), and every line in `additionalLabor`/`otherMaterialLines`/`otherExpenses` — called from `remapProjectIds` for every revision in the copied graph. `surface.paintVariantId` and `otherMaterialLine.sourceMaterialId` are deliberately left untouched, since both are legitimate references into the live, shared catalogs (not part of this project's own copied graph), matching the already-established handling of a surface's paint variant when its catalog entry is deleted. `exportBackup` gained an `importProvenance` parameter (defaulting to `[]` for a fresh installation with no import history) that is now actually included in the envelope, rather than the function silently overwriting whatever was passed with a hardcoded empty array.

**Regression tests:** the two failing tests above are now green, plus a positive control confirming `surface.paintVariantId` is preserved unchanged (not remapped) — proving the fix distinguishes "this project's own graph" from "a shared live-catalog reference" correctly, per the task's explicit "preserve legitimate shared catalog references only where the specification permits."

**Verification (automated):** 309/309 tests pass (2 new); `astro check` 0 errors; `astro build` succeeds. **Persistence of `importProvenance` across sessions, and wiring "import as copies" into the actual UI, are the subject of the next entry** — this entry fixes the domain-logic correctness of the remap and the export function's own contract; the storage/UI wiring to make repeat-import detection actually work end-to-end follows immediately after.

---

## 26. Completed items 6/7/8: real import-mode UI (merge/copies/replace-all), persisted provenance, complete record-type restoration, and version-checked import commits

**Found by:** Task items 6-8, and this session's own earlier audit (before entry #20) which found `planImportAsCopies` had zero usages outside its own tests — the "import as copies" and "replace all" modes named in `DATA_CONTRACT.md`'s "Import modes" section had no UI at all, only restore/merge existed (entry #20). Item 7 also named directly: "Export now includes otherMaterials and serviceDefinitions, but the import persistence function does not restore those collections." Item 8: "Normal project saves use version checks, but import commits write project lists without those checks."

**Fix, by layer:**
- **Domain** (`src/domain/backup.ts`): `planFullRestoreMerge` extended to merge `otherMaterials`/`serviceDefinitions` too (previously only projects and paint variants), each producing their own conflict/toAdd/toSkip sets. New `applyFullRestoreResolutions(existing, envelope, plan, resolutions, existingProjectVersions, ids)` — a PURE function turning a plan plus the user's chosen per-conflict resolutions into the exact writes to commit (final settings/catalog/materials/services, and a `projectWrites` list each carrying the `expectedVersion` captured at PREVIEW time). Extracting this out of the React component makes the exact logic ProApp.tsx runs independently testable, per the task's "tests must exercise the production function... responsible for the behavior."
- **Storage** (`src/storage/db.ts`): a new `importProvenance` object store (DB v2, upgrade-safe for existing installations). `writeImportedBackup()` commits business settings, paint catalog, other materials, service definitions, projects, and provenance in ONE transaction, with each project's write checked against its CURRENT stored version inside that same transaction — a stale write throws `ConflictError` and the entire transaction (every record type) rolls back together, never a partial commit. `writeReplaceAllBackup()` implements the "replace all" mode: every store cleared and replaced atomically with the imported file's own content, using the imported file's own provenance (this installation's history is being fully superseded, not merged) — guarded by explicit confirmation and a required pre-import backup rather than per-record version checks, since replacing everything is the deliberate point of this mode.
- **UI** (`ProApp.tsx`): a real mode selector (merge / import as copies / replace all). Merge computes `applyFullRestoreResolutions` and commits via the version-checked `writeImportedBackup`, surfacing a distinct "this changed elsewhere since you previewed it" message on `ConflictError` rather than silently overwriting or crashing. Import-as-copies reads PERSISTED provenance (not an in-memory Set that would reset on reload) to detect "already imported this export," previews copy/skip counts without generating any IDs, and lets the user force a specific already-imported source to copy again anyway — real ID generation happens exactly once, at confirm time. Replace-all requires downloading a backup of the CURRENT data before Confirm is enabled, and shows an explicit destructive-action warning.

**Regression tests:** 12 new tests across `tests/domain/backup.test.ts` (6, `applyFullRestoreResolutions` exercised directly: keepLocal writes nothing, replaceImported threads through the captured version, keepBoth produces a genuinely new copy, a brand-new project always gets `expectedVersion: null`, business-settings replace/keep, and multi-way paint-variant conflict resolution), `tests/storage/importAtomicity.test.ts` (7, real fake-indexeddb transactions: atomic multi-store commit, the literal two-tab sequence from item 8's own description, an atomic multi-project import rolling back entirely on one conflict, a failed commit leaving settings/catalog untouched too, and `writeReplaceAllBackup`'s full-wipe semantics including using the imported file's own provenance), and `tests/integration/backupRestoreStorage.test.ts` (1, chaining `planFullRestoreMerge` → `applyFullRestoreResolutions` → `writeImportedBackup` through real storage — the exact call sequence `ProApp.tsx`'s `confirmImport` runs — reproducing the two-tab conflict end-to-end through the real chain, not just one layer in isolation).

**Verification (automated):** 323/323 tests pass (12 new); `astro check` 0 errors; `astro build` succeeds. **Not verified live in the browser** — this UI lives inside the Pro workspace, which this environment cannot unlock without real Dodo credentials (the same disclosed limitation as every other Pro-gated fix this session). Verified by the passing automated suite (spanning pure-logic, real-transaction, and full-chain levels) and direct code reading only.

---

## Not a bug (documented false alarm)

While writing `PROPERTY 11` (application labor linearity), a strict `.equals()` assertion failed on the counterexample `area=1, coats=1, throughput=290`. Investigation showed `area*coats/290` is a non-terminating decimal (290 = 2×5×29); computing it once and doubling versus computing `(2×area)/290` directly are two independently-rounded results at the engine's 50-significant-digit precision floor, differing by `1e-52` — twelve digits past the spec's required 40-significant-digit floor and financially meaningless at any real display precision. The linearity formula itself is correct; the test's exactness requirement was wrong. Fixed by using a `1e-40` tolerance instead of bit-exact equality. See the comment in `tests/property/geometry.property.test.ts` for the full reasoning — recorded here so it isn't mistaken for an unresolved defect.
