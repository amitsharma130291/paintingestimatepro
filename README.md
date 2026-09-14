# Painting Estimate Pro

Astro + Tailwind marketing homepage, three free tools, and a local-first Pro
workspace. See [NOTICE.md](./NOTICE.md) for the Mainline template
attribution. See [TEST_EXECUTION_REPORT.md](./TEST_EXECUTION_REPORT.md),
[IMPLEMENTATION_DECISIONS.md](./IMPLEMENTATION_DECISIONS.md), and
[BUG_FIX_LOG.md](./BUG_FIX_LOG.md) for what's built, what's tested, and
what isn't yet.

## What's here

- **Homepage** (`/`) — static Astro marketing page.
- **Free tools** (no account, nothing sent to a server):
  - `/free/estimate-template` — manual line-item estimate builder.
  - `/free/job-cost-calculator` — materials/labor/overhead → target-margin pricing.
  - `/free/interior-calculator` — single-room paint quantity + cost.
- **Pro workspace** (`/app`) — business settings, paint catalog, multi-room
  projects, Price Book Health, issued-estimate customer documents, actual-cost
  review, and backup/restore. Everything computes and persists **locally in
  your browser** (IndexedDB) — no server, no account.
- **Shared calculation engine** (`src/engine/`) — every formula lives here
  once; both the free tools and Pro call the same functions. See
  `docs/CALCULATION_SPEC.md` for the authoritative formulas.
- **Domain layer** (`src/domain/`) — business entities and lifecycle rules
  (draft/issue/duplicate, snapshots, backups) as pure, tested functions,
  independent of the UI and of IndexedDB.

**Not implemented — by design, not an oversight:** paid checkout/entitlement
(no payment provider has been selected; see `docs/ACCESS_SPEC.md` and
`TEST_EXECUTION_REPORT.md` §6), CRM, scheduling, AI estimating, accounting,
and every calculator/tool outside the three free ones above.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:4321 (or whatever port the dev server reports).

## Tests

```bash
npm run test          # runs the full vitest suite once
npm run test:watch    # watch mode
```

133 tests across `tests/engine/`, `tests/domain/`, `tests/storage/`,
`tests/property/`, `tests/mutation/`, and `tests/ui/`. See
`TEST_EXECUTION_REPORT.md` for what's covered and `test-execution-results.csv`
for the full 345-case catalogue mapping.

The specs package's independent Python arithmetic oracle
(`verify_reference.py`, checking the same 20 fixtures with exact rational
arithmetic) is not part of this repo — it ships in the original specs/TDD
zip files and was run separately during spec review, as a second check
with zero dependency on this codebase.

## Build & verify

```bash
npm run build
npm run preview
```

`npm run check` runs Astro's type/diagnostics check (0 errors as of this
delivery).

## Payment sandbox

Not configured — no provider has been selected. See
`docs/ACCESS_SPEC.md` for the requirements a provider integration must meet
before any purchase code is written.

## Before deploying

- Set the real production domain in `astro.config.mjs` (`SITE_URL`).
- Resolve the payment-provider decision and implement `ACCESS_SPEC.md`
  before enabling any purchase UI.
- Review `TEST_EXECUTION_REPORT.md` §7 (remaining risks) first.
- This project was not deployed as part of this task.
