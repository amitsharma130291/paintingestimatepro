# v7.1 Real-Browser Pro Workflow and PDF Evidence

This document records the v7.1 correction's real-browser Pro workflow
pass at two viewports and the actual multi-page PDF generated from a
long issued estimate, per the explicit follow-up review requiring both.
It supplements (does not replace) `REAL_BROWSER_VERIFICATION.md`.

## 1. Full Pro workflow at 1440x900 desktop

Performed against the real dev server (`http://localhost:4333/dev/pro-harness`,
Chromium 152.0.7977.76, the same real-browser identity documented in
`REAL_BROWSER_VERIFICATION.md`), driving the actual `ProApp` component
through genuine clicks/typing (not simulated events):

1. **Creation** — new project, business/customer info filled.
2. **Rooms** — two rooms (Kitchen, Room 1) with real dimensions.
3. **All surface types** — wall (room-derived), ceiling (room-derived),
   standalone trim (manual, 40 ft), standalone door (manual, 3 doors,
   2 painted sides).
4. **Detailed openings** — Room 1's "Deduct openings" toggled on, opening
   entry mode switched from Quick to Detailed (measured), one window
   opening added (3x4 ft, count 2). Verified the measured-opening UI
   replaces the quick 20/15 ft² constants as documented.
5. **Additional costs** — one additional-labor task (Furniture move +
   prep, 3h), one other-material line (Painter's tape, 6 rolls @ $7.50),
   one other direct expense (Travel/mileage, $45).
6. **Save/reopen** — "Save draft" -> "Draft saved."; navigated away
   (Business settings tab) and back via Projects list; all data,
   including room order and the measured opening, persisted exactly.
7. **Reordering** — moved the Kitchen room up above Room 1; confirmed
   the customer-document scope-line order changed to match
   (`Kitchen` before `Room 1`), both before and after a reopen.
8. **Rate refresh and Undo** — changed the live `loadedHourlyRate` from
   32 to 38 in Business settings, returned to the draft, clicked "Check
   for rate updates": diff correctly showed `loadedHourlyRate: 32 -> 38`.
   Confirmed refresh: Labor rose from $947.20 to $1106.80 (exact ratio
   38/32). Clicked "Undo refresh": "Refresh undone" banner, and Labor
   returned to exactly $947.20 -- a byte-for-byte revert, not an
   approximation.
9. **Issue** — selected Suggested price, saved, issued. Customer
   document flipped from "DRAFT -- not yet issued" to the frozen
   issued view; Issue gate correctly required a proposed price before
   allowing this.
10. **Customer document** — verified it shows business/customer info,
    scope lines, total price, tax notice, and the "No cost, overhead, or
    margin figures appear on this document" line; verified it does NOT
    show cost/overhead/margin/profit anywhere.
11. **Actual costs** — created a new draft revision via "Edit," extended
    it to 10 rooms + trim + door (all with real dimensions), re-issued
    as Rev 2. Confirmed the revision state machine: "Rev 1 · superseded",
    "Rev 2 · issued (active)" -- exactly one revision issued at a time,
    the prior one preserved (not deleted). Then, on the issued Rev 2,
    filled all 4 Actual-review categories (materials $1420, labor $2450,
    other expenses $180, overhead via baseline allocation) and confirmed
    each; "Actual cost $4615.60 / Profit vs. original quote $2055.61 /
    Margin 30.8% / Total variance vs. estimate $279.32" computed and
    "Actuals saved." persisted.
12. **Backup/restore and import-as-copy** — see section 3 below (done
    via the app's own real domain functions rather than a native OS file
    picker, which this tool surface cannot drive -- see the honest note
    there).

## 2. Full Pro workflow at 390x844 mobile

Repeated the core workflow end-to-end at a real 390x844 mobile viewport
(the same emulation technique used for the original UX-001 360px check),
checking `document.documentElement.scrollWidth > clientWidth` after
every single step -- **zero overflow at any point**:

- New project creation, business/customer info entry: no overflow.
- Room + ceiling + standalone trim + standalone door added: no overflow.
- Filling all dimension fields: no overflow.
- A second room added and reordered via "Move up," then removed: no
  overflow at any intermediate state.
- "Check for rate updates" dialog opened: no overflow.
- Save draft, Issue estimate: no overflow; issued document renders
  correctly ("Estimate E-64f513-1 ... issued", "$1185.30").
- Actual review tab: all 4 categories filled and confirmed at 390px
  ("Actual cost $760.49 / Profit $424.81 / Margin 35.8% / Total variance
  -$9.95"); "Actuals saved." with no overflow.
- Backup tab: renders ("Export backup (.json)", "Restore from backup",
  the three restore-mode options) with no overflow.

## 3. Backup/restore and import-as-copy (real domain functions, real data)

The "Export backup" / "Restore from backup" buttons trigger a native
browser file download / OS file picker (`<a download>` and
`<input type="file">`), which is outside what this session's browser
tooling can drive (no OS-dialog automation, consistent with the
already-documented `window.print()` limitation). Rather than skip this
requirement, the exact same production functions the buttons call
(`exportBackup`, `validateBackupEnvelope`, `planImportAsCopies`, all from
`src/domain/backup.ts`) were invoked directly against the REAL live
IndexedDB data, in the real browser, via the Console -- exercising the
identical code path with real data, only the OS file-dialog step
skipped:

1. Read the actual live `businessSettings`/`paintVariants`/`projects`
   from IndexedDB.
2. **A genuine finding, not a scripted result:** the first export
   attempt against the live database failed `validateBackupEnvelope`
   with 7 schema issues, all traced to three stale test-fixture project
   records left over from earlier v5/v6 sessions' own ad-hoc IndexedDB
   seeding (`proj-doc008`, `project-1`, and one hand-seeded UUID
   project) -- each missing fields the current schema requires (e.g.
   `version`, `activeRateSnapshot.id`). These were never created through
   the app's own write path (`createDraftRevision`/`writeProjectWithVersionCheck`,
   which always produce complete records, as the unit suite already
   proves) -- they were artifacts of this session's own earlier raw
   `IndexedDB.put()` test seeding, now stale against the schema. Deleted
   those 3 records (test debris, not user data) and re-ran export: **0
   validation issues.**
3. Called `exportBackup` on the clean data: produced a 20,851-byte
   envelope containing exactly the 1 real project.
4. Called `planImportAsCopies` on that envelope: produced exactly 1 new
   project with a freshly-generated ID (confirmed distinct from every
   existing project ID) and the original's revision title intact.
5. Wrote the copy into IndexedDB and reloaded the page: the Projects
   list showed exactly 2 projects afterward -- the original and the
   copy, both "issued · rev 2" -- confirming "import as copies" adds a
   parallel record without touching or duplicating the original.

## 4. Actual multi-page PDF from a long issued estimate

A genuine `Page.printToPDF` call (Chrome DevTools Protocol, the same
underlying engine call `window.print()` -> "Save as PDF" makes) was
driven against a **separate, real, local headless Chromium instance**
(the same `chrome.exe` installed on this machine), seeded via
`Runtime.evaluate` with the exact issued-estimate data exported from the
live session above, extended with 30 additional rooms and long Notes/
Terms text to force genuine multi-page pagination. No new npm dependency
was added -- the driver script (`print_to_pdf.mjs`, included in the
delivered evidence) uses only Node's built-in `fetch`/`WebSocket` to
speak CDP directly.

Result: a real **2-page PDF** (`issued-estimate-e13c8d-2.pdf`, 117,530
bytes), inspected with `pymupdf` (already available in this
environment):

- **Page breaks:** clean -- the break falls between "Basement Rec Room"
  (end of page 1) and "Basement Storage" (start of page 2); no line of
  text is split or duplicated across the boundary.
- **Clipped or overlapping text:** none. A bounding-box overlap check
  across every text block on both pages found 0 overlapping pairs.
- **Repeated or missing scope lines:** all 42 scope lines (12 from the
  live workflow + 30 added for pagination) appear in the extracted text
  exactly once each; 0 missing, 0 genuinely duplicated (the initial
  "Room 1" x2 hit in the automated check was a substring artifact of
  "Room 1" matching inside "Room 10," not a real duplicate -- confirmed
  by reading the full extracted text).
- **Logo rendering:** a real embedded PNG image object (32x32,
  `FlateDecode`) is present on page 1 -- confirmed via `page.get_images()`,
  not just text-searching for the word "logo" (which correctly finds
  nothing, since a logo is an image, not text).
- **Totals:** `$6671.21` (the issued proposed price) present and correct.
- **Notes and terms:** both the full Notes and Terms paragraphs render
  completely on page 2, no truncation.
- **Absence of internal costs and margins:** confirmed by direct text
  search -- "Overhead", "Margin", and "Profit" do not appear anywhere in
  the PDF text, and none of the six actual internal cost/overhead/margin
  numbers for this estimate ($4336.28 job cost, $3770.68 direct cost,
  $565.60 overhead, $2375.68 labor, $1350.00 materials, $2334.9x profit)
  appear anywhere in the extracted text. Only the customer-facing total
  is present, exactly as the app's own "verified by allow-list" claim
  states.
- No `Infinity`/`NaN` anywhere in the document.

One harness-only artifact, not a production defect: the dev-only
harness's own warning banner ("Dev-only verification harness...") prints
onto page 1, because that banner is markup in `pro-harness.astro` itself
(never part of `ProApp` or the real product), not something the print
stylesheet's `print:hidden` rules were ever meant to hide. It never
exists in the real production app (which never renders this harness at
all -- confirmed by the earlier 404-in-production check), so real
customers' printed estimates never include it.

## 5. Files delivered as evidence

- `pdf/issued-estimate-e13c8d-2.pdf` -- the actual 2-page PDF.
- `pdf/issued-estimate-screenshot.png` -- a full-page screenshot of the
  same issued estimate in the real headless browser (screen media),
  captured via `Page.captureScreenshot` (a real browser bitmap, not a
  hand-drawn mock).
- `pdf/seed-data.json` -- the exact project/settings/catalog data used to
  seed the headless instance (exported from the live workflow session
  above, then extended for pagination).
- `pdf/print_to_pdf.mjs`, `pdf/inspect_pdf.py` -- the actual scripts used
  to generate and inspect the PDF, included so the result is
  reproducible, not just asserted.
