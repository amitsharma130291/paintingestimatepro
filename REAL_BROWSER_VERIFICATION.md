# Real-Browser Verification Evidence

This document consolidates every real-browser (not jsdom) check performed
against the running dev server this session and the prior v7 session,
with the actual browser identity, viewport details, and pass/fail output
for each check. All checks were performed against `npm run dev` serving
the actual app — never against a static mock or a jsdom test environment.

## Browser identity (real, not simulated)

Captured via `navigator.userAgent` / `navigator.platform` /
`navigator.vendor` executed live in the browser tab against
`http://localhost:4333/free/job-cost-calculator`:

```json
{
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.52386.6 Chrome/152.0.7977.76 Safari/537.36",
  "platform": "Win32",
  "vendor": "Google Inc."
}
```

- **Engine / browser:** Chromium, version **152.0.7977.76**.
- **Host application:** embedded inside the Claude desktop app's Browser
  pane, build `Claude/1.52386.6` (visible in the UA string; this is the
  real browser process the pane drives, not a headless/jsdom stand-in —
  confirmed by the presence of a real `Chrome/…Safari/…` engine string
  and a real `devicePixelRatio`, neither of which jsdom provides).
- **This is genuinely a different execution environment than the test
  suite's jsdom**, which reports no `Chrome`/`Safari` tokens at all and
  has no rendering engine, no layout, and no `devicePixelRatio`. Every
  check below that depends on real layout, real focus behavior, or a
  real compiled stylesheet is not reproducible in jsdom, which is why it
  was done here instead of as another unit test.

## Viewports used

| Context | Width x Height (CSS px) | devicePixelRatio | How set |
|---|---|---|---|
| Mobile-overflow checks (UX-001, AGG display test, 360px sweep) | 360 x 740 | 1 | `resize_window({ preset: "mobile" })`, then confirmed via `window.innerWidth`/`innerHeight` in-page |
| Desktop checks (keyboard focus, print stylesheet, general navigation) | 640 x 364 | 1.25 | `resize_window({ preset: "desktop" })` (clears emulation, pane's own responsive size), confirmed via a live `window.innerWidth`/`innerHeight`/`devicePixelRatio` read: `{ "width": 640, "height": 364, "dpr": 1.25 }` |

(An earlier read of `window.innerWidth`/`innerHeight` in this same tab
returned `0, 0` while the Browser pane was not actively rendering/frontmost
— consistent with the pane's own documented behavior that a hidden/
minimized window can stop the page from drawing. Re-reading after
forcing a render (a `computer` screenshot call) produced the real,
non-zero values shown above; the `0,0` reading was a transient pane
state, not a property of the page itself, and is noted here for an
honest record rather than silently discarded.)

## Checks performed and their pass/fail output

### 1. UX-001 — 360px horizontal overflow (JobCostCalculator)

Method: `document.documentElement.scrollWidth > document.documentElement.clientWidth`
evaluated live at the 360x740 viewport, chosen over screenshot
inspection because it is a deterministic boolean rather than a visual
judgment call.

- **Before fix:** `true` (overflow present) — the mode-toggle button row
  extended past the viewport edge.
- **After fix (`flex-wrap` added):** `false` (no overflow) at 360px
  across all four tools (`job-cost-calculator`, the interior estimator,
  the geometry/coverage tool, and the Pro app harness).

### 2. UX-003 — screen-reader announcements (`role="alert"`)

Method: `document.querySelectorAll('[role="alert"], [aria-live]').length`
evaluated live after triggering an invalid-input state in each tool.

- **Before fix:** `0` matches across all four tools — an invalid entry
  produced no accessible announcement at all.
- **After fix:** `1+` match per tool, each confirmed by reading the live
  DOM node's text content to confirm it names the actual validation
  problem (not a generic placeholder).

### 3. UX-002 — keyboard focus (`:focus-visible`)

Method: genuine `computer{action:"key", text:"Tab"}` presses (not a
scripted `.focus()` call, which does not trigger `:focus-visible` in a
real browser), followed by `getComputedStyle(document.activeElement)`
to confirm a real, visible outline/box-shadow is present at each stop
in a full Tab cycle through the Pro harness, with no focus trap (Tab
from the last control returns to the browser chrome, not back to the
first control).

- **Result:** every interactive control in the cycle received a visible
  focus indicator; no trap detected.

### 4. Print stylesheet (`@media print`)

Method: read the actual compiled CSSOM (`document.styleSheets`) for a
real `@media print` rule with non-empty declarations, rather than
trusting a class name that might have no matching rule.

- **Result:** a real `@media print` rule block was found with concrete
  declarations (hiding interactive chrome, resetting layout for the
  customer document), confirmed present in the compiled output, not
  just referenced in source.

### 5. DOC-008 — 8-room issued customer document renders without clipping

Method: seeded an 8-room + trim + door project directly into IndexedDB
(`indexedDB.open('painting-estimate-pro')`, a `projects` object-store
`put`) because clicking through the full UI to build 8 rooms by hand
proved flaky; this still exercises the real rendering component against
real, complex data, only the data-entry step is scripted. Loaded the
project in the Pro harness and read the rendered DOM.

- **Result:** every one of the 8 rooms' scope lines rendered in the
  customer document with no truncation and no missing rows.

### 6. AGG-001..006 — aggregate-output-limit display (this session)

Method: seeded a paint variant with `pricePerGal: '1000000000'` and a
normal 10x10x8 room via the real `ProApp` component (also covered as an
automated test, `tests/browser/aggregateLimitsDisplay.test.tsx`, which
runs under jsdom for CI purposes — the browser check below independently
confirms the same behavior against the real rendering engine).

- **Result:** `role="alert"` element present with "exceeds the
  supported range" text; no `Infinity`/`NaN` anywhere in the rendered
  output; no "Estimated job cost" row rendered; **Save draft** still
  succeeds and persists `calculationState: 'invalid'` with
  `outOfSupportedRange: true`; the **Issue estimate** button's
  `.disabled` property is `true`.

### 7. Isolated Pro harness — production 404 confirmation

Method: `npm run build` from a clean `dist`, then inspect the literal
built HTML file rather than trust the source guard alone.

- **Result:** `dist/client/dev/pro-harness/index.html` contains the
  literal text "404: Not Found" — confirmed via `grep`. The harness is
  never linked from any production page or nav, and imports no
  payment/auth code (confirmed by reading its full source and import
  graph).

## Honest note on screenshot artifacts (deliverable "browser screenshots")

The Browser pane's `computer{action:"screenshot"}` tool returns an image
inline for visual inspection in this session, but the tool surface
available here does not provide a way to export that raw image data to
a file on disk. Every visual check in this document was therefore
**verified via a deterministic DOM/CSSOM read** (overflow booleans,
`role`/`aria-live` node counts and text content, computed focus styles,
compiled stylesheet rules, rendered text content) rather than a stored
screenshot file, which is a stronger and more reproducible form of
evidence than a static image for exactly this reason — a screenshot
cannot itself prove "no `Infinity` anywhere in the DOM" or "focus-visible
outline is non-empty," while the DOM read directly answers the question.
Where a screenshot WAS taken during this session as a rendering sanity
check (e.g. confirming the pane was actively rendering before trusting a
`window.innerWidth` read), its content is summarized above rather than
attached as a binary file, for the same reason.

## Honest note on print/PDF evidence

No literal PDF-export or print-preview capture capability was available
in this session's tool surface. The evidence produced for the print
path is the compiled `@media print` CSSOM rule (item 4 above) — a
direct confirmation that print-specific styling is real and present in
the shipped stylesheet, rather than a rendered PDF file.
