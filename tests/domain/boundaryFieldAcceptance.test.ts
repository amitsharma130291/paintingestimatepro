// BOUND-001, BOUND-002, BOUND-006, BOUND-007, BOUND-010, BOUND-011,
// BOUND-030, BOUND-031, BOUND-032: each of these is a FIELD-level
// acceptance boundary ("accepted at field validation; a zero-count/other
// project-level rule can still separately fail the issue gate; unusual-
// value warnings still apply independently") -- distinct from a full
// project's calculationState, which several other rows already cover.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { parseCoatsInput } from '../../src/components/tools/shared';
import { parseCountField, MAX_OPENING_COUNT } from '../../src/engine/parse';
import { requiredPriceRaw } from '../../src/engine/pricing';
import { overheadAmount } from '../../src/engine/cost';

describe('BOUND-001/002: a Pro service coats field accepts exactly the boundary values 1 and 5 (not just the interior of the range)', () => {
  it('coats=1 (the floor) and coats=5 (the ceiling) both parse as valid at the field level', () => {
    expect(parseCoatsInput('1')).toBe(1);
    expect(parseCoatsInput('5')).toBe(5);
  });
  it('one below and one above the boundary are both rejected, confirming 1/5 are genuine edges, not arbitrary accepted values', () => {
    expect(parseCoatsInput('0')).toBe('reject');
    expect(parseCoatsInput('6')).toBe('reject');
  });
});

describe('BOUND-006/007: a target margin ratio field accepts the boundary values 0 and 0.999 (the spec\'s "0 <= m < 1" range)', () => {
  it('target=0 is a valid divisor for requiredPriceRaw, never treated as an error at the field level', () => {
    expect(() => requiredPriceRaw(new PEP('100'), new PEP('0'))).not.toThrow();
    const raw = requiredPriceRaw(new PEP('100'), new PEP('0'));
    expect(raw).not.toBe('out_of_supported_range');
  });
  it('target=0.999 (just inside the exclusive upper bound) is accepted and produces a real (if extreme) required price', () => {
    expect(() => requiredPriceRaw(new PEP('100'), new PEP('0.999'))).not.toThrow();
    const raw = requiredPriceRaw(new PEP('100'), new PEP('0.999'));
    expect(raw).not.toBe('out_of_supported_range');
  });
  it('exactly 1 (the excluded upper bound) is rejected, confirming 0.999 is genuinely inside the accepted range, not an arbitrary value', () => {
    expect(() => requiredPriceRaw(new PEP('100'), new PEP('1'))).toThrow();
  });
});

describe('BOUND-010/011: an overhead ratio field accepts the boundary values 0 and 1 (CALCULATION_SPEC\'s "overheadRatio 0..1" inclusive range)', () => {
  it('overheadRatio=0 computes a valid (zero) overhead amount, never an error', () => {
    expect(overheadAmount(new PEP('100'), new PEP('0')).toString()).toBe('0');
  });
  it('overheadRatio=1 (the inclusive ceiling) computes a valid overhead amount equal to the full direct cost', () => {
    expect(overheadAmount(new PEP('100'), new PEP('1')).toString()).toBe('100');
  });
});

describe('BOUND-030/031/032: the free interior calculator\'s quick-mode door DEDUCTION count field accepts its full [0, 100000] range and rejects below it', () => {
  // This is the free tool's InteriorCalculator quick-mode doorCount --
  // a deduction count where 0 legitimately means "no door openings to
  // deduct" (already proven complete/valid at the PROJECT level by the
  // existing V6-04 test suite). This is a semantically different field
  // from a Pro DOOR SURFACE's own doorCount (how many physical doors are
  // being painted), where 0 reasonably means "this isn't a real door job"
  // and is rejected as invalid by src/domain/estimateAssembly.ts's door
  // branch -- a deliberate, different business rule for a differently
  // named field, not a boundary-validation inconsistency to fix.
  it('BOUND-030: doorCount=0 is a valid field value', () => {
    expect(parseCountField('0', { min: 0, max: MAX_OPENING_COUNT }).kind).toBe('valid');
  });
  it('BOUND-031: doorCount=100000 (the approved maximum) is a valid field value', () => {
    const result = parseCountField('100000', { min: 0, max: MAX_OPENING_COUNT });
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') expect(result.value).toBe(100000);
  });
  it('BOUND-032: doorCount=-1 is rejected as out of range, never silently clamped to 0', () => {
    const result = parseCountField('-1', { min: 0, max: MAX_OPENING_COUNT });
    expect(result.kind).toBe('invalid');
  });
  it('one above the maximum (100001) is also rejected, confirming 100000 is a genuine ceiling, not an arbitrary accepted value', () => {
    expect(parseCountField('100001', { min: 0, max: MAX_OPENING_COUNT }).kind).toBe('invalid');
  });
});
