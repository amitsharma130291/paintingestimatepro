# Dependency Risk Assessment

Full `npm audit` output, advisory-by-advisory analysis, and the resolution
applied this session. All 3 advisories are the **same underlying CVE**
reached through three packages in one dependency chain.

## Full `npm audit` output (before the fix, clean `npm ci` install)

```
# npm audit report

path-to-regexp  4.0.0 - 6.2.2
Severity: high
path-to-regexp outputs backtracking regular expressions - https://github.com/advisories/GHSA-9wv6-86v2-598j
fix available via `npm audit fix --force`
Will install @astrojs/vercel@8.0.4, which is a breaking change
node_modules/path-to-regexp
  @vercel/routing-utils  <=3.1.0 || >=5.0.0
  Depends on vulnerable versions of path-to-regexp
  node_modules/@vercel/routing-utils
    @astrojs/vercel  <=0.0.0-vercel-routing-20250129162731 || >=8.0.5
    Depends on vulnerable versions of @vercel/routing-utils
    node_modules/@astrojs/vercel

3 high severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force
```

Machine-readable form (`npm audit --json`), `metadata.vulnerabilities`:
`{ info: 0, low: 0, moderate: 0, high: 3, critical: 0, total: 3 }`.

## Advisory 1 of 3: `path-to-regexp`

- **Package and affected version.** `path-to-regexp@6.1.0` (the version
  actually resolved before this fix). Advisory range: `4.0.0 - 6.2.2` /
  `>=4.0.0 <6.3.0`.
- **Dependency path.** `paintingestimatepro` -> `@astrojs/vercel@11.0.10`
  (direct) -> `@vercel/routing-utils@6.6.0` -> `path-to-regexp@6.1.0`.
- **Vulnerability.** [GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j),
  "path-to-regexp outputs backtracking regular expressions" (CWE-1333,
  CVSS 7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`). Certain path patterns
  compile to a regular expression vulnerable to catastrophic backtracking
  (ReDoS) when matched against a crafted input string.
- **Build-time only, or included in the deployed runtime?** Both, in a
  specific and important way. The package's files ARE physically copied
  into the deployed Vercel function bundle
  (`.vercel/output/functions/_render.func/node_modules/path-to-regexp/`),
  and the bundled `entry.mjs` does `import "@vercel/routing-utils"` at
  the top level, so the module loads into memory on every cold start.
  However, tracing `entry.mjs`'s own code: that import is side-effect-only
  (nothing else in the file references any export of `@vercel/routing-utils`
  -- confirmed by grepping the bundled file: exactly one match for
  "routing-utils", the import line itself). The actual vulnerable calls
  (`pathToRegexp(path, keys, options)` and `compile(value, ...)`, found in
  `@vercel/routing-utils/dist/superstatic.js`) are exercised by
  `@astrojs/vercel`'s **build-time** integration hook
  (`astro:build:done`), which runs once during `astro build` to generate
  `.vercel/output/config.json`'s routing rules -- not by any code path
  reachable from a live incoming HTTP request against the deployed
  function.
- **Does application-controlled or customer-controlled input reach it?**
  No. The only input ever passed to the vulnerable `pathToRegexp`/`compile`
  calls, in this deployment, is the routing configuration
  `@astrojs/vercel` derives from **this project's own page route
  filenames** under `src/pages/**` -- fixed at build time, entirely
  developer-authored, never influenced by a site visitor, a form
  submission, a URL query string, or any other request-time data. There
  is no dynamic/user-generated route pattern anywhere in this codebase
  that could reach this function with attacker-influenced content, at
  build time or otherwise. Practical exploitability against this specific
  application, as shipped, is effectively nil -- this is a supply-chain
  hygiene finding, not a demonstrated attack path against this site.
- **Available fixed version.** `path-to-regexp@6.3.0` and later fix the
  specific advisory range. `@vercel/routing-utils@6.6.0` (already the
  latest published version, confirmed via `npm view`) itself still
  depends directly on the vulnerable `path-to-regexp@6.1.0` for its own
  `pathToRegexp`/`compile` calls, while separately depending on an
  aliased `path-to-regexp-updated: "npm:path-to-regexp@6.3.0"` for some
  other internal use -- the upstream package is mid-migration and has
  not yet dropped the vulnerable direct dependency in ANY published
  version, including latest. No newer `@astrojs/vercel` release (checked
  up to and including the current latest, `11.0.10`, which is what this
  project already had installed) avoids this.
- **Nonbreaking override or patch possible?** **Yes -- applied.** Added
  a `package.json` `"overrides": { "path-to-regexp": "6.3.0" }` entry,
  forcing the plain (non-aliased) `path-to-regexp` dependency everywhere
  in the tree to resolve to `6.3.0` instead of `6.1.0`. This is the exact
  version `@vercel/routing-utils`'s own maintainers already vetted and
  aliased for use inside their own package (as `path-to-regexp-updated`),
  and it is the same major version line (6.x) as the vulnerable release,
  so no API-incompatibility risk was introduced.
- **Result of testing the corrected dependency.**
  - `npm install` (regenerating the lockfile with the override):
    "found 0 vulnerabilities".
  - `npm audit`: "found 0 vulnerabilities".
  - `npm ls path-to-regexp`: resolves to `path-to-regexp@6.3.0 overridden`
    at the exact same position in the tree.
  - Clean rebuild (`rm -rf .vercel dist && npm run build`): completed
    with no errors; `.vercel/output/config.json`'s generated routing
    rules were inspected and are structurally identical/correct (static
    asset caching rule, `_server-islands`/`_image` routes, all 5 API
    routes, the `/404` route, and the catch-all 404 fallback all present
    exactly as before).
  - Confirmed the deployed bundle now physically contains
    `path-to-regexp@6.3.0`
    (`.vercel/output/functions/_render.func/node_modules/path-to-regexp/package.json`).
  - Full gate re-run after the override: `npx astro check` (0 errors),
    `python3 docs/verify_reference.py` (20/20 fixtures pass), full test
    suite (0 regressions), production build (clean). No test, type, or
    build failure was introduced by this change.

## Advisory 2 of 3: `@vercel/routing-utils`

- **Package and affected version.** `@vercel/routing-utils` `<=3.1.0 || >=5.0.0`
  (i.e. every version capable of depending on the vulnerable
  `path-to-regexp` range) -- specifically `6.6.0` as installed.
- **Dependency path.** `paintingestimatepro` -> `@astrojs/vercel@11.0.10`
  (direct) -> `@vercel/routing-utils@6.6.0`.
- **Vulnerability.** Same advisory as above (GHSA-9wv6-86v2-598j) -- this
  entry exists in the audit purely because this package is the one that
  *depends on* the vulnerable `path-to-regexp`, not because it has an
  independent flaw of its own.
- **Build-time only, or included in the deployed runtime?** Same as
  above -- the package ships in the deployed bundle, is imported for its
  side effects, but its route-matching functions are only ever called
  from `@astrojs/vercel`'s build-time hook in this project.
- **Does application-controlled or customer-controlled input reach it?**
  No -- same reasoning as above; the only input is this project's own
  build-time route configuration.
- **Available fixed version.** None published yet that removes the
  direct dependency on vulnerable `path-to-regexp` (see above) -- this
  advisory resolves as a consequence of overriding `path-to-regexp`
  itself, not by upgrading this package.
- **Nonbreaking override or patch possible?** Not directly (there is no
  newer `@vercel/routing-utils` release to move to that fixes this on
  its own), but the `path-to-regexp` override above transitively fixes
  it: this package's own `require("path-to-regexp")` now resolves to the
  patched `6.3.0`.
- **Result of testing the corrected dependency.** Same test results as
  Advisory 1 -- `npm audit` reports 0 vulnerabilities for this package
  after the override, with the routing-generation build step confirmed
  working correctly (see above).

## Advisory 3 of 3: `@astrojs/vercel`

- **Package and affected version.** `@astrojs/vercel`
  `<=0.0.0-vercel-routing-20250129162731 || >=8.0.5` -- specifically
  `11.0.10` as installed (the project's direct, intentionally-chosen
  Vercel adapter).
- **Dependency path.** `paintingestimatepro` -> `@astrojs/vercel@11.0.10`
  (direct dependency of this project).
- **Vulnerability.** Same advisory (GHSA-9wv6-86v2-598j), inherited
  transitively through `@vercel/routing-utils` -> `path-to-regexp`, as
  above.
- **Build-time only, or included in the deployed runtime?** The adapter
  package itself is the project's build tool AND the source of the
  deployed `entry.mjs` handler -- see Advisory 1's analysis of exactly
  which of its own code paths are build-time-only versus present in the
  deployed bundle.
- **Does application-controlled or customer-controlled input reach it?**
  No -- same reasoning as above.
- **Available fixed version.** `npm audit fix --force` proposes
  downgrading to `@astrojs/vercel@8.0.4`. **This was investigated and
  rejected as unsafe/unhelpful, not applied blindly:** the project is
  already on `11.0.10` (a materially newer major version, with three
  major versions of adapter improvements and fixes in between); `8.0.4`
  is a real downgrade, not a forward fix, and would trade this
  negligible-exploitability advisory for the loss of three majors' worth
  of adapter fixes and features, while `@vercel/routing-utils@latest`
  (`6.6.0`, confirmed via `npm view`) -- what `8.0.4` would also end up
  depending on -- itself STILL depends directly on vulnerable
  `path-to-regexp@6.1.0`. Downgrading would not have actually removed
  the vulnerable code from the tree at all; it would only have moved
  where npm's audit heuristic stops flagging it, based on `8.0.4`'s
  specific declared version range rather than its actual resolved
  dependency.
- **Nonbreaking override or patch possible?** Yes -- the SAME
  `path-to-regexp` override above transitively resolves this advisory
  too, without touching `@astrojs/vercel`'s own version at all.
- **Result of testing the corrected dependency.** Same test results as
  Advisory 1: `npm audit` reports 0 vulnerabilities for this package
  after the override; `@astrojs/vercel@11.0.10` remains installed
  unchanged, and every final gate (typecheck, numerical oracle, full
  test suite, production build) passed cleanly with it in place.

## Summary

| # | Package | Fixed via | Breaking? | Result |
|---|---|---|---|---|
| 1 | `path-to-regexp` | `overrides` -> `6.3.0` | No | 0 vulnerabilities |
| 2 | `@vercel/routing-utils` | (transitive, via #1) | No | 0 vulnerabilities |
| 3 | `@astrojs/vercel` | (transitive, via #1); explicitly did NOT downgrade to the `npm audit fix --force`-suggested `8.0.4` | No | 0 vulnerabilities, adapter unchanged at `11.0.10` |

**Final state: `npm audit` reports 0 vulnerabilities of any severity.**
No breaking adapter upgrade was needed or performed. Every final gate
(clean install, typecheck, numerical oracle, full test suite x4,
production build) was re-run after this change and passed with zero
regressions.
