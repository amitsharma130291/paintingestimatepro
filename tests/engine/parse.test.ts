// CORE + BOUND: numeric grammar (DECISIONS.md #1) and engineering-bounds
// guards (DECISIONS.md #2).
import { describe, it, expect } from 'vitest';
import { parseDecimalField, parseCountField, isPositiveDivisor, MIN_POSITIVE_DIVISOR } from '../../src/engine/parse';
import { PEP } from '../../src/engine/decimal';

describe('CORE-parse: missing vs invalid vs valid-zero', () => {
  it('CORE-parse-01: blank/undefined/null are missing, never invalid or zero', () => {
    expect(parseDecimalField(null)).toEqual({ kind: 'missing' });
    expect(parseDecimalField(undefined)).toEqual({ kind: 'missing' });
    expect(parseDecimalField('')).toEqual({ kind: 'missing' });
    expect(parseDecimalField('   ')).toEqual({ kind: 'missing' });
  });

  it('CORE-parse-02: explicit "0" is valid-zero, distinct from missing', () => {
    const r = parseDecimalField('0');
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect(r.value.toNumber()).toBe(0);
  });

  it('BOUND-grammar-accept: whitespace trimmed', () => {
    const r = parseDecimalField('  42.5  ');
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect(r.value.toString()).toBe('42.5');
  });

  it('BOUND-grammar-accept: leading zeros', () => {
    const r = parseDecimalField('007.5');
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect(r.value.toString()).toBe('7.5');
  });

  it('BOUND-grammar-accept: negative zero normalizes to zero', () => {
    const r = parseDecimalField('-0.00', { allowNegative: true });
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect(r.value.isZero()).toBe(true);
    if (r.kind === 'valid') expect(r.value.isNegative()).toBe(false);
  });

  it('BOUND-grammar-reject: mixed unit text ("12abc") is invalid, not zero', () => {
    const r = parseDecimalField('12abc');
    expect(r.kind).toBe('invalid');
  });

  it('BOUND-grammar-reject: currency/unit suffixes', () => {
    expect(parseDecimalField('$12').kind).toBe('invalid');
    expect(parseDecimalField('12ft').kind).toBe('invalid');
    expect(parseDecimalField('12%').kind).toBe('invalid');
  });

  it('BOUND-grammar-reject: thousands separators', () => {
    expect(parseDecimalField('1,234').kind).toBe('invalid');
  });

  it('BOUND-grammar-reject: scientific notation', () => {
    expect(parseDecimalField('1e5').kind).toBe('invalid');
    expect(parseDecimalField('1E5').kind).toBe('invalid');
  });

  it('BOUND-grammar-reject: negative when not allowed', () => {
    expect(parseDecimalField('-5').kind).toBe('invalid');
  });

  it('BOUND-grammar-accept: negative when explicitly allowed', () => {
    const r = parseDecimalField('-5', { allowNegative: true });
    expect(r.kind).toBe('valid');
  });

  it('BOUND-grammar-reject: NaN/Infinity text', () => {
    expect(parseDecimalField('NaN').kind).toBe('invalid');
    expect(parseDecimalField('Infinity').kind).toBe('invalid');
  });

  it('BOUND-grammar-reject: multiple decimal points / bare sign / bare dot', () => {
    expect(parseDecimalField('1.2.3').kind).toBe('invalid');
    expect(parseDecimalField('-').kind).toBe('invalid');
    expect(parseDecimalField('.').kind).toBe('invalid');
  });

  it('BOUND-precision: rejects more than the configured max fraction digits', () => {
    expect(parseDecimalField('1.12345678901').kind).toBe('invalid'); // 11 digits, default max 10
    expect(parseDecimalField('1.1234567890').kind).toBe('valid'); // exactly 10
  });

  it('CORE-parse-count: whole numbers only, with min/max', () => {
    expect(parseCountField('3').kind).toBe('valid');
    expect(parseCountField('3.5').kind).toBe('invalid');
    expect(parseCountField('-1').kind).toBe('invalid');
    expect(parseCountField('3', { max: 2 }).kind).toBe('invalid');
    expect(parseCountField(null)).toEqual({ kind: 'missing' });
  });

  it('BOUND-divisor: extraordinarily small positive divisor is rejected, not silently accepted', () => {
    expect(isPositiveDivisor(new PEP('0.0000000005'))).toBe(false); // below MIN_POSITIVE_DIVISOR
    expect(isPositiveDivisor(MIN_POSITIVE_DIVISOR)).toBe(true);
    expect(isPositiveDivisor(new PEP('150'))).toBe(true);
    expect(isPositiveDivisor(new PEP('0'))).toBe(false);
  });

  it('parseDecimalField: below_minimum is enforced and reported with its own distinct code (opts.min has no current production caller, but is part of this function\'s own public contract)', () => {
    const r = parseDecimalField('5', { min: '10' });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.code).toBe('below_minimum');
    // exactly-at-the-boundary is valid, not invalid (inclusive)
    expect(parseDecimalField('10', { min: '10' }).kind).toBe('valid');
  });

  it('parseDecimalField: above_maximum is reported with its own distinct code', () => {
    const r = parseDecimalField('20', { max: '10' });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.code).toBe('above_maximum');
    expect(parseDecimalField('10', { max: '10' }).kind).toBe('valid'); // inclusive
  });

  it('parseDecimalField: each distinct invalid reason reports its own code, not a shared/generic one', () => {
    const malformed = parseDecimalField('12abc');
    expect(malformed.kind).toBe('invalid');
    if (malformed.kind === 'invalid') expect(malformed.code).toBe('malformed_number');

    const tooManyDigits = parseDecimalField('1.12345678901'); // 11 digits, default max 10
    expect(tooManyDigits.kind).toBe('invalid');
    if (tooManyDigits.kind === 'invalid') expect(tooManyDigits.code).toBe('too_many_fraction_digits');
  });

  it('parseCountField: each distinct invalid reason reports its own code, not a shared/generic one', () => {
    const malformed = parseCountField('3.5');
    expect(malformed.kind).toBe('invalid');
    if (malformed.kind === 'invalid') expect(malformed.code).toBe('malformed_integer');

    const belowMin = parseCountField('2', { min: 5 });
    expect(belowMin.kind).toBe('invalid');
    if (belowMin.kind === 'invalid') expect(belowMin.code).toBe('below_minimum');
    expect(parseCountField('5', { min: 5 }).kind).toBe('valid'); // inclusive

    const aboveMax = parseCountField('10', { max: 5 });
    expect(aboveMax.kind).toBe('invalid');
    if (aboveMax.kind === 'invalid') expect(aboveMax.code).toBe('above_maximum');
    expect(parseCountField('5', { max: 5 }).kind).toBe('valid'); // inclusive
  });

  it('parseCountField: surrounding whitespace is trimmed, same as parseDecimalField', () => {
    expect(parseCountField('  5  ').kind).toBe('valid');
    if (parseCountField('  5  ').kind === 'valid') {
      expect((parseCountField('  5  ') as { kind: 'valid'; value: number }).value).toBe(5);
    }
  });

  it('parseCountField: a whitespace-only string is missing, not invalid -- same missing/invalid distinction parseDecimalField makes', () => {
    expect(parseCountField('   ')).toEqual({ kind: 'missing' });
  });
});
