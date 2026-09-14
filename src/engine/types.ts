import type { Dec } from './decimal';

// CALCULATION_SPEC.md §1: "Inputs have distinct states: missing (null),
// invalid (an error), and valid including explicit zero."
export type FieldState<T> =
  | { kind: 'missing' }
  | { kind: 'invalid'; code: string; message: string; rawText?: string }
  | { kind: 'valid'; value: T };

export function isValid<T>(f: FieldState<T>): f is { kind: 'valid'; value: T } {
  return f.kind === 'valid';
}

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export interface FieldWarning {
  path: string;
  code: string;
  message: string;
}

// CALCULATION_SPEC.md §1: CalculationResult<T>
export type CalculationResult<T> =
  | { state: 'complete'; value: T; errors: []; warnings: FieldWarning[] }
  | { state: 'incomplete'; value: Partial<T> | null; errors: FieldError[]; warnings: FieldWarning[] }
  | { state: 'invalid'; value: null; errors: FieldError[]; warnings: FieldWarning[] };

export function complete<T>(value: T, warnings: FieldWarning[] = []): CalculationResult<T> {
  return { state: 'complete', value, errors: [], warnings };
}

export function incomplete<T>(
  errors: FieldError[],
  warnings: FieldWarning[] = [],
  value: Partial<T> | null = null
): CalculationResult<T> {
  return { state: 'incomplete', value, errors, warnings };
}

export function invalidResult<T>(errors: FieldError[], warnings: FieldWarning[] = []): CalculationResult<T> {
  return { state: 'invalid', value: null, errors, warnings };
}

// CALCULATION_SPEC.md §6: pricing status labels.
export type PriceStatus =
  | 'unpriced'
  | 'zero_price'
  | 'below_cost'
  | 'below_target'
  | 'at_target'
  | 'above_target'
  | 'out_of_supported_range';

export const STATUS_LABEL: Record<PriceStatus, string> = {
  unpriced: 'No price entered',
  zero_price: 'No-charge (zero price)',
  below_cost: 'Below estimated cost',
  below_target: 'Review pricing',
  at_target: 'At target',
  above_target: 'Above target',
  out_of_supported_range: 'Out of supported range',
};

export interface PriceResult {
  profit: Dec | null;
  marginRatio: Dec | null;
  status: PriceStatus;
  approxPrice: Dec | null;
  minimumTargetPrice: Dec | null;
}
