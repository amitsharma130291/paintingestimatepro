import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dedicated Vitest config for Stryker mutation-testing runs only (referenced
// via stryker.config.mjs's `vitest.configFile`). Identical to vitest.config.ts
// except it excludes tests/property/** and tests/differential/**.
//
// Root cause this works around: those two directories run tens of thousands
// of fast-check iterations / NDJSON fixture comparisons per test (individual
// tests take 20-90s, several with explicit per-test timeout overrides up to
// 90000ms). Under Stryker's `coverageAnalysis: 'all'`, EVERY mutant reruns
// the full covering-test set once per mutant. A baseline run against
// pricing.ts + decimal.ts (49 mutants) with these directories included
// produced mutation.json records showing `testsCompleted: 0` and
// `status: "Survived"` for 44/45 covered mutants -- i.e. the covering tests
// were never actually completing within Stryker's per-mutant budget, so
// every mutant was silently marked "Survived" without any test having run
// to conclusion. Confirmed as an infra/timeout artifact, not a real
// mutation-score finding, by diffing against this exact same
// coverageAnalysis:'all' + vitest-runner + concurrency:2 config in the
// sibling hvacestimatepro/packages/financial-core project (fast ~2s suite,
// no test.ts, hundreds of real kills) -- and by the fact that the ONE
// mutant Stryker did kill here was a `static: true` mutant evaluated purely
// at module-import time (no test execution required to detect it), while
// every dynamic (function-body) mutant showed testsCompleted: 0.
//
// The excluded suites (property-based + differential fuzzing) verify
// correctness at massive scale but are redundant for THIS purpose: any
// mutation Stryker introduces into pricing.ts/decimal.ts that changes a
// computed value will also be caught by the fast, deterministic unit and
// acceptance-fixture tests retained here, which assert exact expected
// numbers directly. Excluding the slow suites here does not remove them
// from `npm test` -- they still run in full under the normal vitest.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/property/**', 'tests/differential/**', '**/node_modules/**'],
    setupFiles: ['tests/setup/fake-indexeddb.ts'],
    testTimeout: 15000,
  },
});
