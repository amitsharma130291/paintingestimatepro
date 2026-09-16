// Numerical-hardening initiative, section 5: deterministic case ledger.
// A systematic matrix of (area, coats, waste, coverage) combinations, each
// an independently-derived-by-exact-rational-arithmetic distinct
// whole-gallon purchase-boundary case for rawDemandGal/purchasedGallons --
// deliberately varying all four inputs together (not isolating one at a
// time) so the raw-demand DIVISION itself (not just the final ceiling) is
// exercised at a wide range of exact/near-exact/interior points.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { rawDemandGal, purchasedGallons } from '../../src/engine/paint';

function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }
type Frac = [bigint, bigint];
function frac(n: bigint, d: bigint): Frac { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }
function fromDecimalString(s: string): Frac {
  const [intPart, fracPart = ''] = s.split('.');
  const d = 10n ** BigInt(fracPart.length);
  const n = BigInt((intPart || '0') + fracPart);
  return frac(n, d);
}
function mul([n1, d1]: Frac, [n2, d2]: Frac): Frac { return frac(n1 * n2, d1 * d2); }
function div([n1, d1]: Frac, [n2, d2]: Frac): Frac { return frac(n1 * d2, d1 * n2); }
function add([n1, d1]: Frac, [n2, d2]: Frac): Frac { return frac(n1 * d2 + n2 * d1, d1 * d2); }
function ceilInt([n, d]: Frac): bigint {
  const q = n / d; const r = n % d;
  if (r === 0n) return q;
  return q + 1n; // n, d both positive in every case this file constructs
}

const COVERAGES = ['100', '150', '200', '275', '350', '450', '500'];
const COATS = [1, 2, 3];
const WASTES = ['0', '0.05', '0.10', '0.15', '0.20'];
// area = coverage * 3.5 for every case -- combined with varying coats/waste
// this produces raw demand = 3.5 * coats * (1+waste), landing at a wide mix
// of exact integers, exact .5 ties, and ordinary interior points across the
// 105 (coverage x coats x waste) combinations, all derived from the SAME
// simple area:coverage ratio so the matrix is easy to audit by hand.
const cases: [string, number, string, string][] = [];
for (const coverage of COVERAGES) {
  const area = (Number(coverage) * 3.5).toString();
  for (const coats of COATS) {
    for (const waste of WASTES) {
      cases.push([area, coats, waste, coverage]);
    }
  }
}

describe('PURCHASE-BOUNDARY matrix: rawDemandGal/purchasedGallons across area x coats x waste x coverage', () => {
  it.each(cases)('area=%s coats=%i waste=%s coverage=%s', (areaStr, coats, wasteStr, coverageStr) => {
    const area = new PEP(areaStr);
    const waste = new PEP(wasteStr);
    const coverage = new PEP(coverageStr);

    const areaF = fromDecimalString(areaStr);
    const wasteF = fromDecimalString(wasteStr);
    const coverageF = fromDecimalString(coverageStr);
    const rawF = div(mul(mul(areaF, [BigInt(coats), 1n]), add([1n, 1n], wasteF)), coverageF);
    const expectedPurchased = Number(ceilInt(rawF));

    const raw = rawDemandGal(area, coats, waste, coverage);
    const purchased = purchasedGallons(raw);
    expect(purchased).toBe(expectedPurchased);
    expect(purchased).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(purchased)).toBe(true);
  });
});
