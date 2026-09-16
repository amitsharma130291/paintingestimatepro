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
	// Numerical-hardening initiative, Part 19. Validated the setup on a small
	// high-value subset first (pricing.ts + decimal.ts, the two modules
	// already the subject of NUM-DEC-001/002 -- see NUMERICAL_BUG_FIX_LOG.md
	// for the Stryker/Vitest-5 tooling bug found and fixed during that
	// validation), now scaled to the full numerically-significant engine
	// surface. `types.ts` (type-only, no runtime logic) and `index.ts` (a
	// pure re-export barrel) are omitted -- Stryker generates zero mutants
	// for either regardless, so listing them would only add dead scan time.
	mutate: [
		'src/engine/pricing.ts',
		'src/engine/decimal.ts',
		'src/engine/geometry.ts',
		'src/engine/paint.ts',
		'src/engine/labor.ts',
		'src/engine/cost.ts',
		'src/engine/serviceHealth.ts',
		'src/engine/actuals.ts',
		'src/engine/estimate.ts',
		'src/engine/document.ts',
		'src/engine/parse.ts',
	],
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
