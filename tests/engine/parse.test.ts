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
});
