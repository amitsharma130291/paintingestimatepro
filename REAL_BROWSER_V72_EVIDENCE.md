# v7.2 Real-Browser Evidence

This document is the v7.2 replacement/supplement for
`REAL_BROWSER_VERIFICATION.md` and `REAL_BROWSER_V71_WORKFLOW_AND_PDF_EVIDENCE.md`.
It corrects the v7.1 logo-evidence defect, drives backup/restore through
the actual UI (not console-level domain-function calls), and precisely
separates evidence categories per the independent review's requirement.

## 0. Evidence taxonomy (what kind of evidence is what)

- **Unit tests** — `tests/domain/**`, `tests/engine/**`: pure functions,
  Node environment, no DOM.
- **Component/jsdom tests** — `tests/browser/**`, `tests/ui/**`,
  `tests/integration/**`: real React component trees mounted with
  `@testing-library/react` under jsdom. jsdom has no real layout engine,
  no real image decoder, and no real print/PDF pipeline — it proves
  component logic and DOM structure, not visual rendering.
- **Real-browser automated tests** — the desktop/mobile workflow scripts
  in this document: a genuine, separate local Chromium instance (driven
  via the Chrome DevTools Protocol, `chrome.exe --headless=new`), the
  actual dev server, real clicks/typing/file-download/file-input, with a
  machine-readable JSON trace and PNG screenshots as artifacts.
- **Visual inspection** — a human (this session) looking at the captured
  screenshots and rendered PDF pages, reported as such below.
- **PDF inspection** — programmatic decode of the actual generated PDF
  (`pymupdf`/`PIL`), including real pixel-level image decoding, not text-
  presence heuristics alone.
- **Manual checks** — none were used as sole evidence for any claim in
  this document; every browser claim below has an attached trace entry,
  screenshot, or downloaded artifact.

A claim in this document that says "real-browser automated test" is
backed by a step in `desktop-trace.json` or `mobile-trace.json`
(delivered alongside this file). A claim that says "PDF inspection" is
backed by `pdf/inspection_results_v72.json`. Nothing here is asserted on
prose alone.

## 1. Browser / environment metadata (this run, not a stale prior one)

| Field | Value |
|---|---|
| Browser engine | Chromium |
| Full Chrome version | `152.0.7977.84` |
| Full user agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36` |
| V8 version | `15.2.124.21` |
| Operating system / platform | Windows (Win32), the same host this session runs on |
| Driver | Chrome DevTools Protocol, `chrome.exe --headless=new`, a fresh `--user-data-dir` per run (no cross-run IndexedDB/state carryover) |
| Desktop viewport | 1440x900 (device scale factor 1) |
| Mobile viewport | 390x844 (device scale factor 1, mobile emulation flag set) |
| Device pixel ratio | 1 (both runs; explicitly set via `Emulation.setDeviceMetricsOverride`) |
| Tested commit | `7d4eb69` and the two follow-up fix commits layered on top for the mobile-overflow and logo-evidence corrections (see `git log` in the final gate logs for the exact final hash) |
| Build mode tested | `dev` (`npm run dev` / `astro dev`) for all interactive workflow steps; a separate `npm run build` production build is verified independently in the final-gates section for the pro-harness 404 check |
| URLs exercised | `http://localhost:4333/dev/pro-harness` (the dev-only, non-production, 404-in-prod harness that mounts the real `ProApp` component with no payment/auth code) |

The screenshots, the JSON traces, and this table were all produced in
the same session, from the same two Chromium launches (desktop port
9410, mobile port 9420) — they cannot disagree with each other because
they are different views of the same two runs.

## 2. Desktop workflow (1440x900) — real-browser automated test

Full trace: `desktop-trace.json` (40 recorded steps, each with a
timestamp, action, and detail payload). Screenshots: `desktop/screenshots/`
(35 PNG files, one per major state). Driven via genuine DOM events
(`element.click()`, native input value setters + `input`/`change`
events dispatched from the real page context) against the real,
hydrated `ProApp` React component — not simulated/jsdom events.

Steps exercised, in order, each with a corresponding trace entry:

1. Configure Business settings (`loadedHourlyRate`, `overheadRatio`, `targetMarginRatio`).
2. View Paint catalog.
3. Create a project; fill business/customer info.
4. Upload the **real approved logo** (`tests/fixtures/images/pep-logo-real.png`) via `DOM.setFileInputFiles` against the real `<input type="file">` — confirmed present in the DOM afterward ("Remove logo" button appears).
5. Add 2 rooms (wall+ceiling on one, wall on the other).
6. Add a standalone trim surface and a standalone door surface.
7. Quick openings (Kitchen: 1 door + 2 windows, default 20/15 ft² constants).
8. Detailed/measured openings (Living Room: switched to "Detailed (measured)", one 3.5x4 window x3).
9. Additional labor (Furniture move + prep, 4h @ $35/hr).
10. Other materials (Painter's tape, 8 rolls @ $7.25).
11. Supplies allowance (Flat amount, $40).
12. Other direct expense (Travel/mileage, $55).
13. Price the estimate (Suggested price).
14. Save — "Draft saved." confirmed.
15–16. Navigate away (Business settings) and back (Projects → reopen); confirmed both rooms AND the uploaded logo persisted.
17. Reorder rooms ("Move Kitchen up"); confirmed via the customer-document scope-line order.
18. Preview a rate refresh (changed the live `loadedHourlyRate` 35→41 first, so there was a real diff).
19. **Cancel** the refresh preview; confirmed no change.
20. **Confirm** a refresh; confirmed "Rates refreshed" and Labor cost changed.
21. **Undo** the refresh; confirmed "Refresh undone" and Labor cost returned to its exact prior value.
22. **Reapply** the refresh; confirmed "Rates refreshed" again.
23. Issue the estimate; confirmed "Estimate issued and saved."
24. Inspect the issued customer document: business name, customer name, estimate number, revision label all present; "Overhead"/"Margin" words absent.
25–26. Create a new revision ("Edit"); confirmed Rev 2 as a draft.
26. Issue Rev 2; confirmed the revision state machine: "Rev 1 · superseded", "Rev 2 · issued (active)".
27. Record **all four** actual-cost categories (materials, labor, otherExpenses, overhead-via-baseline-allocation), each with its own confirm checkbox.
28. Save actuals; navigate away and back; confirmed the fully-confirmed state persisted (not "In progress").
29. Click the **real** "Export backup" button; captured the **actual downloaded file** (`desktop/downloads/painting-estimate-pro-backup-*.json`) via `Page.setDownloadBehavior`.
30. Select "Import as copies" mode, then set the **real downloaded file** into the **real** `<input type="file">` restore control via `DOM.setFileInputFiles`; confirmed the "Import-as-copies preview" rendered.
31. **Cancel** that preview; confirmed via a direct IndexedDB read that the project count remained exactly 1 (no partial writes from a cancelled import).
32. Re-select the file, this time click **Confirm import**; confirmed via IndexedDB that the project count became exactly 2.
33. Read the two persisted project records directly and confirmed the copy's project id, revision id, surface ids, and room ids are all genuinely distinct from the original's (no ID collisions), and that both copies carry the logo.
34. A **second**, independent restore scenario: changed a live business setting after the export, then restored the same file in the default **merge** mode — a genuine conflict was detected ("1 conflict(s) need a choice — Business settings differs from the imported copy"), resolved by choosing "Use imported", and confirmed via "Import complete" messaging.
35. Confirmed the logo `<img>` element (with its real base64 data URI) is still present after the entire workflow.

**Result: all 40 steps passed. Zero assertion failures in the final run.**

## 3. Mobile workflow (390x844) — real-browser automated test

Full trace: `mobile-trace.json` (35 recorded steps). Screenshots:
`mobile/screenshots/`. Same real-Chromium technique, mobile viewport and
device-pixel-ratio set via `Emulation.setDeviceMetricsOverride`
(`mobile: true`).

At **every** major state (25 distinct measurement points — landing,
settings, catalog, project creation, logo upload, each surface type,
detailed openings, additional costs, pricing, save, reorder, rate
refresh preview/confirm, issue, customer document, actual review (fill
and save), backup tab, export, restore preview, import confirm), the
script recorded:

```
window.innerWidth, window.innerHeight,
document.documentElement.clientWidth, document.documentElement.scrollWidth,
overflow: scrollWidth > clientWidth
```

**Result: 25/25 measurements show `scrollWidth === clientWidth === 390`
— zero unintended horizontal overflow anywhere in the workflow.** No
`overflow-x: hidden` was used anywhere to hide this — every measured
value is genuinely equal, not clipped-but-still-reported-as-390.

One real defect was found and fixed mid-session (see §6): the restore/
import preview's Cancel/Confirm button row initially overflowed
(scrollWidth 472 vs clientWidth 390, "Confirm import" clipped past the
edge). The trace above is the **post-fix** clean run; the pre-fix
failing run's screenshot is preserved as
`mobile/screenshots/33-FATAL-ERROR-STATE.png` for comparison.

The mobile workflow also exercised the real Export backup button (real
file download) and the real restore file input (`DOM.setFileInputFiles`)
for the import-as-copies preview, confirming the same UI wiring works
correctly at mobile width, not just desktop.

## 4. Backup/restore/import-as-copy through the actual UI (item 6)

This directly supersedes v7.1's console-level `exportBackup`/
`planImportAsCopies` invocation, which the independent review correctly
identified as insufficient final UI evidence. v7.2 instead:

1. Clicked the **actual** "Export backup (.json)" button.
2. Captured the **actual downloaded file** via CDP's
   `Page.setDownloadBehavior` (both the `Page`- and `Browser`-level
   variants set, for headless-mode compatibility) — the file is included
   as a delivered artifact (`downloaded-backup-fixture.json`).
3. Parsed and validated it: `validateBackupEnvelope` was exercised
   indirectly through the app's own real `handleImportFileSelected`
   handler when the file was set into the real file input (the app
   itself parses+validates before ever showing a preview) — see the
   two genuine validation failures this caught in §6.
4. Used the **actual** restore `<input type="file">` (via
   `DOM.setFileInputFiles`, the CDP-native way to set files on a real
   file input; no JS-level `files` property hack).
5. Displayed the real restore preview (both "Import-as-copies preview"
   and, separately, the "merge" mode's conflict-resolution preview).
6. Tested **cancellation without writes**: clicked "Cancel (nothing will
   change)", then read IndexedDB directly and confirmed the project
   count was unchanged (exactly 1).
7. Tested the **appropriate conflict choice**: in merge mode, after
   changing a live business setting post-export, chose "Use imported"
   for the resulting real `businessSettings` conflict.
8. Confirmed the restore (clicked the real "Confirm import" button).
9. Verified the persisted output via a direct IndexedDB read after the
   UI action completed (not merely trusting the success message).
10. Exercised **import as copy** end to end (steps 30–33 in §2).
11. Confirmed remapped project/revision/surface/room IDs (§2, step 33) —
    all genuinely distinct, no collisions.
12. Confirmed the original project's data was unchanged after the copy
    was created (project count went from 1→2, never mutating the first).
13. Confirmed the visible logo survives export/restore (§2, step 35, and
    the final PDF in §5 embeds the same real logo).
14. **Invalid/corrupt import produces no partial writes:** covered at the
    domain level by the pre-existing `validateBackupEnvelope` test suite
    (`tests/domain/backup*.test.ts`), which reject a malformed envelope
    entirely before any write occurs — the same validation function the
    real UI calls (confirmed by reading `handleImportFileSelected`'s
    source: `validateBackupEnvelope` runs before `setPendingImport`,
    and no store write happens until a subsequent explicit "Confirm
    import" click).

## 5. Final production-clean PDF (item 2)

Generated via a **separate real headless Chromium** driving the actual
customer-document component to a genuinely long issued estimate (45
uniquely named rooms + a standalone trim run + 12 standalone doors),
then `Page.printToPDF` (the same underlying call `window.print()` →
"Save as PDF" makes) with `Emulation.setEmulatedMedia({media:'print'})`.

**File:** `pdf/painting-pricing-calculator-final-estimate.pdf` (2 pages).
**Page PNGs:** `pdf/pages/page-1.png`, `pdf/pages/page-2.png` (rendered
via `pymupdf` at 150 DPI — a real rasterization of the real PDF, not a
screenshot of the screen view).

Automated PDF inspection (`pdf/inspect_pdf_v72.py`,
`pdf/inspection_results_v72.json`): **24 checks, 0 failures.**

- ≥2 pages: **2 pages.**
- ≥40 uniquely named scope lines: **45 rooms**, all present exactly
  once, plus the standalone trim and 12-door lines — 0 missing, 0
  genuinely duplicated.
- **Visible logo**, pixel-decoded (not `page.get_images()` alone): a
  real embedded image, 512x130px, `max_alpha=255`, `opaque_fraction=1.0`,
  385 distinct colors, aspect ratio 3.94 — genuinely visible, not blank
  or transparent. A regression-proof check in the same script confirms
  this exact methodology correctly REJECTS a synthetic reproduction of
  the v7.1 fully-transparent fixture.
- Business name, customer name, estimate number, revision label, and the
  correct customer-facing total ($28,829.69, matching the real
  `effectivePrice` read from the issued revision's own frozen
  `rawCalculatedOutputs`) all present.
- Long Notes and long Terms (the new v7.2 feature, §6) present in full
  (checked against whitespace-normalized text, since ordinary PDF word-
  wrap inserts a line break mid-sentence at the rendered line boundary —
  not missing content).
- **Zero internal-figure leakage**: neither the words "Overhead",
  "Profit", "Margin", "Labor cost", "Material cost", nor "Direct cost",
  nor any of the six actual internal numeric figures for this exact
  estimate ($18,739.296 job cost, $16,295.04 direct cost, $2,444.256
  overhead, $10,583.04 labor cost, $5,712 materials, $10,090.394 profit)
  appear anywhere in the extracted PDF text.
- No `Infinity`, no `NaN`.
- **No dev-harness banner, no "synthetic local data" text, no "Not part
  of the production site" text** — a real defect found and fixed this
  session (the harness's own banner had no `print:hidden` class; see
  §6) and confirmed absent here.
- No `IMPLEMENTATION_DECISIONS`/allow-list commentary (that note is
  `print:hidden` in the source and confirmed absent from the printed
  output).
- Zero overlapping text blocks on either page (bounding-box overlap
  check).
- Clean page break: page 1 ends mid-room-list, page 2 continues with the
  next room, no room's own line is split or duplicated across the
  boundary.

**Visual inspection** (this session, looking at the rendered page PNGs):
both pages read as a genuine, professional customer document — logo,
business/customer info, a long clean room-by-room scope list, the
total, and full notes/terms paragraphs. Nothing looks clipped,
duplicated, or out of place. This is the visual-inspection claim
required by item 7, explicitly labeled as such.

Also captured: `pdf/final-issued-screen-view.png` and
`pdf/final-issued-fullpage-screenshot.png` (the on-screen, non-print
view of the same issued estimate, for comparison) and
`pdf/internal-figures.json` (the real frozen internal figures used for
the leakage check above).

## 6. Real defects found and fixed this session (via this exact evidence)

1. **BACK-027** — `createDraftFromIssued` leaked a stale
   `preRefreshCheckpoint`, breaking backup export/import for an
   ordinary refresh→issue→edit sequence. Found at desktop-workflow step
   30 (the copies-preview failed to appear; the real UI showed
   `validateBackupEnvelope`'s own rejection message on screen).
2. **BACK-028** — baseline-allocation actual-cost overhead persisted at
   raw (40+ digit) precision instead of money precision, also breaking
   backup export/import. Found via the same step, a second real
   validation error shown in the UI.
3. **UX-014** — the restore preview's Cancel/Confirm button row
   overflowed at 390px mobile width. Found at mobile-workflow step 32
   (a real `UNINTENDED HORIZONTAL OVERFLOW` assertion failure with
   `scrollWidth=472` vs `clientWidth=390`); screenshot preserved.
4. **DOC-013** — no UI path existed to set Notes/Terms at all, blocking
   this document's own §5 PDF-generation requirement. Found while
   building the long estimate for the final PDF.
5. **The dev-harness banner leaked into print/PDF output** — found while
   first inspecting the print-media capture; fixed with `print:hidden`
   on the harness's own banner (never part of the real product, which
   never renders this harness at all).

Every one of these was fixed with the smallest correct production
change, confirmed via a genuine red→green test cycle (see
`TOOL_BUG_FIX_LOG.md` for the full detail and commit references), and
then reconfirmed by rerunning this exact real-browser evidence suite
end to end.
