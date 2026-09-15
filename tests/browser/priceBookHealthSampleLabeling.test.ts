// UX-012 (ACCEPTANCE_TESTS.md P01-P07): "GIVEN Production homepage
// samples WHEN Inspect captions/live tool link THEN Illustration labeled;
// no claim live defaults reproduce marketing sample." Previously
// "verified" only by a human reading PriceBookHealth.astro and index.astro
// once ("Confirmed by direct reading... no remaining work") -- no
// executable test existed at all. This file replaces that with real,
// repeatable checks: (1) the sample table's own "Review pricing" flags
// are independently recomputed from each row's margin against
// TARGET_MARGIN and must match, so a future edit that changes the numbers
// without updating the flags (or vice versa) fails loudly instead of
// silently shipping a self-contradictory sample; (2) the labeling/
// disclaimer copy is asserted to contain specific never-claims-real-data
// language; (3) a source scan (same established technique as
// tests/integration/noAnalyticsLeak.test.ts) confirms no <img>/<picture>
// element exists anywhere the sample could instead be a screenshot.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATUS_PREVIEW,
  TARGET_MARGIN,
  PRICE_BOOK_SAMPLE_ROWS,
  PRICE_BOOK_SAMPLE_INTRO,
  PRICE_BOOK_SAMPLE_CALLOUT_HEADING,
  PRICE_BOOK_SAMPLE_CALLOUT_BODY,
  PRICE_BOOK_SAMPLE_FOOTNOTE,
} from '../../src/data/site';

const REPO_ROOT = join(__dirname, '..', '..');
const targetMarginRatio = parseFloat(TARGET_MARGIN) / 100; // "35%" -> 0.35

describe('UX-012: Price Book Health sample data is internally consistent, not just plausible-looking', () => {
  it('every row\'s "Review pricing" flag matches an independent recomputation of margin vs. the stated target margin', () => {
    expect(PRICE_BOOK_SAMPLE_ROWS.length).toBeGreaterThan(0);
    for (const row of PRICE_BOOK_SAMPLE_ROWS) {
      const marginRatio = parseFloat(row.margin) / 100;
      const shouldBeFlagged = marginRatio < targetMarginRatio;
      expect(row.flag, `row "${row.service}" (margin ${row.margin} vs target ${TARGET_MARGIN}) has flag=${row.flag} but recomputation says ${shouldBeFlagged}`).toBe(shouldBeFlagged);
      expect(row.status).toBe(shouldBeFlagged ? 'Review pricing' : 'Above target');
    }
  });

  it('the sample genuinely demonstrates BOTH outcomes (at least one flagged row and one unflagged row) -- otherwise "see which rates deserve a second look" would be an empty claim', () => {
    expect(PRICE_BOOK_SAMPLE_ROWS.some((r) => r.flag === true)).toBe(true);
    expect(PRICE_BOOK_SAMPLE_ROWS.some((r) => r.flag === false)).toBe(true);
  });

  it('the callout heading\'s claimed count of flagged rows matches the actual data ("Two rates to review")', () => {
    const flaggedCount = PRICE_BOOK_SAMPLE_ROWS.filter((r) => r.flag).length;
    expect(PRICE_BOOK_SAMPLE_CALLOUT_HEADING).toMatch(/rates? to review/i);
    // "Two rates" must actually mean 2, not just sound plausible.
    const numberWord = PRICE_BOOK_SAMPLE_CALLOUT_HEADING.match(/^(\w+)\s+rates?/i)?.[1]?.toLowerCase();
    const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    expect(numberWord && NUMBER_WORDS[numberWord]).toBe(flaggedCount);
  });
});

describe('UX-012: the sample is explicitly labeled as illustrative and never claims to reproduce live tool output', () => {
  it('STATUS_PREVIEW (the badge shown next to "Price Book Health") reads as illustrative/preview language, not a real-data claim', () => {
    expect(STATUS_PREVIEW).toMatch(/illustrative|preview|sample|example/i);
  });

  it('the intro copy explicitly calls this "the planned" view, never "your" live data', () => {
    expect(PRICE_BOOK_SAMPLE_INTRO).toMatch(/planned/i);
    expect(PRICE_BOOK_SAMPLE_INTRO).not.toMatch(/\byour (current|actual|live) (prices?|margins?|rates?)\b/i);
  });

  it('the callout body says "in this example", not a claim about the reader\'s own numbers', () => {
    expect(PRICE_BOOK_SAMPLE_CALLOUT_BODY).toMatch(/\bexample\b/i);
  });

  it('the footnote discloses that actual results depend on the user\'s own inputs, not the sample\'s', () => {
    expect(PRICE_BOOK_SAMPLE_FOOTNOTE).toMatch(/actual results depend on your inputs/i);
  });
});

describe('UX-012: the sample is a hand-authored table, never a screenshot or captured image', () => {
  it('PriceBookHealth.astro contains no <img>, <picture>, or background-image reference anywhere', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/components/PriceBookHealth.astro'), 'utf-8');
    expect(source).not.toMatch(/<img\b/i);
    expect(source).not.toMatch(/<picture\b/i);
    expect(source).not.toMatch(/background-image/i);
  });

  it('the homepage (index.astro) has no <img>/<picture> anywhere near the Price Book Health section include', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/pages/index.astro'), 'utf-8');
    expect(source).toMatch(/PriceBookHealth/);
    expect(source).not.toMatch(/<img\b/i);
    expect(source).not.toMatch(/<picture\b/i);
  });

  it('the rendered badge text still literally says "Sample" next to the target margin, per the required-behavior text ("Illustration labeled")', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/components/PriceBookHealth.astro'), 'utf-8');
    expect(source).toMatch(/Sample target margin/);
  });
});
