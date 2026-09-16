/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	packageManager: 'npm',
	testRunner: 'vitest',
	// 'all' (run the whole suite against every mutant) rather than 'perTest':
	// this project's suite includes property-based tests (fast-check) whose
	// static coverage mapping can under-attribute which concrete test covers
	// a given line, producing false survivors -- the same reasoning recorded
	// for the sibling hvacestimatepro/packages/financial-core project's own
	// stryker.config.mjs, which uses the identical setting for the identical
	// reason.
	coverageAnalysis: 'all',
	// Numerical-hardening initiative, Part 19: start with a small, high-value
	// subset (the two modules already the subject of NUM-DEC-001/002) to
	// validate the setup before scaling to the full target list (decimal
	// helpers, parsing, geometry, paint purchasing/pooling, labor, cost,
	// pricing, service health, actuals, estimate assembly, snapshot/refresh,
	// customer-document totals).
	mutate: ['src/engine/pricing.ts', 'src/engine/decimal.ts'],
	// Baseline run #3 (against the default vitest.config.ts, whole suite
	// included) produced a mutation.json where every dynamic (function-body)
	// mutant showed testsCompleted: 0 and status: "Survived" -- i.e. the
	// covering tests never ran to completion under Stryker's per-mutant
	// rerun, because tests/property/** (13,000 fast-check iterations per
	// test, several with explicit 60-90s per-test timeout overrides) and
	// tests/differential/** (100,000+ NDJSON fixture comparisons per test,
	// 60s overrides) make ONE run of the covering suite too slow to complete
	// within budget when repeated once per mutant. Proven as an infra
	// artifact, not a real score, by cross-checking hvacestimatepro's
	// identical coverageAnalysis:'all' + vitest-runner + concurrency:2 config
	// (fast ~2s suite -> hundreds of genuine kills, zero testsCompleted:0
	// survivors) and by decimal.ts's one killed mutant being the sole
	// `static: true` mutant (evaluated at import time, no test execution
	// needed) while every dynamic mutant went untested.
	//
	// Fix: point Stryker's vitest runner at vitest.mutation.config.ts, which
	// is identical to vitest.config.ts but excludes tests/property/** and
	// tests/differential/**. Both suites still run in full under the normal
	// `npm test` (vitest.config.ts is untouched) -- they are excluded ONLY
	// from Stryker's per-mutant reruns. This is sound because any mutation
	// that changes a computed value in pricing.ts/decimal.ts is also caught
	// by the fast, deterministic unit and acceptance-fixture tests retained
	// here, which assert exact expected numbers directly; the excluded
	// suites add scale and randomized coverage, not a distinct detection
	// mechanism a mutation could slip through undetected by both.
	vitest: {
		configFile: 'vitest.mutation.config.ts',
	},
	timeoutMS: 60000,
	timeoutFactor: 4,
	concurrency: 2,
	thresholds: {
		high: 100,
		low: 100,
		break: 0, // baseline run: report the score, don't fail the process yet
	},
	reporters: ['clear-text', 'progress', 'json'],
};
