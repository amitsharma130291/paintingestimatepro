// Numerical-hardening initiative, section 5: deterministic case ledger.
// A systematic matrix of (cost, targetMarginRatio) pairs, each an
// independently-derived-by-exact-rational-arithmetic distinct boundary
// case for requiredPriceRaw/minimumTargetPrice/approxPrice's cent-rounding
// behavior -- not a property test (fixed, named, individually inspectable
// cases) and not a duplicate of any existing fixture (a fresh grid of
// values chosen to hit exact HALF_UP ties, near-ties, and ordinary
// interior points across a wide range of cost magnitudes and margin
// bands).
//
// Expected values are computed with BigInt exact-rational arithmetic
// (independent of decimal.js, the library under test), matching the same
// technique used by docs/numerical_oracle.py's Fraction-based approach.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { requiredPriceRaw, minimumTargetPrice, approxPrice, margin } from '../../src/engine/pricing';

// ---- exact BigInt fraction helpers (independent of decimal.js) ----
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
type Frac = [bigint, bigint]; // [numerator, denominator], denominator always > 0
function frac(n: bigint, d: bigint): Frac {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return [n / g, d / g];
}
function fromDecimalString(s: string): Frac {
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [intPart, fracPart = ''] = s.split('.');
  const d = 10n ** BigInt(fracPart.length);
  let n = BigInt((intPart || '0') + fracPart);
  if (neg) n = -n;
  return frac(n, d);
}
function sub([n1, d1]: Frac, [n2, d2]: Frac): Frac { return frac(n1 * d2 - n2 * d1, d1 * d2); }
function div([n1, d1]: Frac, [n2, d2]: Frac): Frac { return frac(n1 * d2, d1 * n2); }
// HALF_UP round to `places` decimal places, exact integer arithmetic.
function halfUpCents([n, d]: Frac): bigint {
  const num = n * 100n;
  let q = num / d;
  const r = num % d;
  if (2n * (r < 0n ? -r : r) >= (d < 0n ? -d : d)) q += num < 0n !== d < 0n ? -1n : 1n;
  return q;
}
function ceilCents([n, d]: Frac): bigint {
  // ceiling of n/d expressed in cents (n,d already the raw value, not *100)
  const num = n * 100n;
  const q = num / d;
  const r = num % d;
  if (r === 0n) return q;
  return num > 0n === d > 0n ? q + 1n : q; // ceiling toward +infinity for a positive value
}
function centsToString(cents: bigint): string {
  const neg = cents < 0n;
  cents = neg ? -cents : cents;
  const whole = cents / 100n;
  const frac2 = cents % 100n;
  return `${neg ? '-' : ''}${whole}.${frac2.toString().padStart(2, '0')}`;
}

// Cost magnitudes spanning small/medium/large jobs, and target ratios
// spanning the full [0, 0.99] band in fine steps -- deliberately NOT the
// same numbers as any existing fixture, chosen to hit a mix of exact
// ties, near-ties, and ordinary interior points.
const COSTS = ['53', '67', '129', '250', '389.47', '500', '712.19', '1000', '1875.33', '2623', '5000', '9999.99'];
const TARGETS = ['0', '0.05', '0.10', '0.15', '0.20', '0.25', '0.30', '0.35', '0.40', '0.45', '0.50', '0.55', '0.60', '0.65', '0.70', '0.75', '0.80', '0.85', '0.90', '0.95'];

const cases: [string, string][] = [];
for (const cost of COSTS) for (const target of TARGETS) cases.push([cost, target]);

describe('PRICE-BOUNDARY matrix: requiredPriceRaw/minimumTargetPrice/approxPrice cent-rounding across cost x target', () => {
  it.each(cases)('cost=%s target=%s', (costStr, targetStr) => {
    const cost = new PEP(costStr);
    const target = new PEP(targetStr);

    const costF = fromDecimalString(costStr);
    const targetF = fromDecimalString(targetStr);
    const rawF = div(costF, sub([1n, 1n], targetF)); // cost / (1 - target)
    const expectedApprox = centsToString(halfUpCents(rawF));
    const expectedMin = centsToString(ceilCents(rawF));

    const raw = requiredPriceRaw(cost, target);
    expect(raw).not.toBe('out_of_supported_range');
    if (raw === 'out_of_supported_range') return;

    expect(approxPrice(raw).toFixed(2)).toBe(expectedApprox);
    const minTarget = minimumTargetPrice(raw);
    expect(minTarget.toFixed(2)).toBe(expectedMin);
    // minimumTargetPrice must always be >= the exact raw required price --
    // never rounds down below the target it promises.
    expect(minTarget.greaterThanOrEqualTo(raw)).toBe(true);
    // margin at that exact minimum price is always >= the target ratio.
    const m = margin(minTarget, cost)!;
    expect(m.greaterThanOrEqualTo(target)).toBe(true);
  });
});
