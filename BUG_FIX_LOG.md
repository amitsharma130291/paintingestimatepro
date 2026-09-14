# Bug fix log

Four real defects were found during this implementation — three via automated tests failing red-then-green, one via manual browser testing. None were pre-existing; all were introduced and caught within this same session. A fifth is recorded further down as a continuation-session finding.

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

## Not a bug (documented false alarm)

While writing `PROPERTY 11` (application labor linearity), a strict `.equals()` assertion failed on the counterexample `area=1, coats=1, throughput=290`. Investigation showed `area*coats/290` is a non-terminating decimal (290 = 2×5×29); computing it once and doubling versus computing `(2×area)/290` directly are two independently-rounded results at the engine's 50-significant-digit precision floor, differing by `1e-52` — twelve digits past the spec's required 40-significant-digit floor and financially meaningless at any real display precision. The linearity formula itself is correct; the test's exactness requirement was wrong. Fixed by using a `1e-40` tolerance instead of bit-exact equality. See the comment in `tests/property/geometry.property.test.ts` for the full reasoning — recorded here so it isn't mistaken for an unresolved defect.
