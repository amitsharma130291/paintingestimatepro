// Shared UI helpers for the tool islands — thin wrappers around the engine
// so every tool renders FieldState/CalculationResult consistently. No
// calculation logic lives here; it only formats/dispatches to src/engine.
import { toMoneyString, toPercentString, type Dec } from '../../engine/decimal';
import { parseDecimalField, parseCountField, type ParseOptions } from '../../engine/parse';
import type { FieldState } from '../../engine/types';
import type { PriceResult, PriceStatus } from '../../engine/types';

export function useParsed(raw: string, opts?: ParseOptions): FieldState<Dec> {
  return parseDecimalField(raw, opts);
}

// Bug fix (found during manual browser testing of Actual Review, see
// BUG_FIX_LOG.md): `${toMoneyString(x)}` for a negative Decimal produces
// "-15.00", so naively prepending "$" gives "$-15.00" instead of the
// conventional "-$15.00". Place the sign before the currency symbol.
export function money(x: Dec | null | undefined): string {
  if (!x) return '—';
  const isNegative = x.isNegative();
  const abs = toMoneyString(x.abs());
  return isNegative ? `-$${abs}` : `$${abs}`;
}

export function percent(x: Dec | null | undefined): string {
  return x ? `${toPercentString(x)}%` : '—';
}

export const STATUS_STYLE: Record<PriceStatus, { label: string; className: string }> = {
  unpriced: { label: 'No price entered', className: 'status-note' },
  zero_price: { label: 'No-charge (zero price)', className: 'tag-preview' },
  below_cost: { label: 'Below estimated cost', className: 'bg-bad-soft text-bad border border-bad-line' },
  below_target: { label: 'Review pricing', className: 'bg-warn-soft text-warn border border-warn-line' },
  at_target: { label: 'At target', className: 'bg-primary/10 text-primary-dark' },
  above_target: { label: 'Above target', className: 'bg-primary/10 text-primary-dark' },
  out_of_supported_range: { label: 'Out of supported range', className: 'bg-bad-soft text-bad border border-bad-line' },
};

export function statusBadge(result: PriceResult): { label: string; className: string } {
  return STATUS_STYLE[result.status];
}

export function fieldError(f: FieldState<Dec>): string | null {
  return f.kind === 'invalid' ? f.message : null;
}

/**
 * BOUND-003/004/005 regression: a Pro-app per-surface "coats override"
 * field used to commit `Number.parseInt(v, 10) || 1` directly — a falsy-
 * zero bug that silently turned "0" into 1, accepted any value with no
 * upper bound, and truncated "1.5" to 1 instead of rejecting it, all
 * contradicting CALCULATION_SPEC's "coats integer 1..5" and "do not
 * truncate meaningful quantities silently." This is the single validated
 * choke point every per-surface coats input must go through: blank clears
 * the override (`null`), a valid 1..5 integer commits, anything else is
 * rejected outright — the caller must NOT commit on 'reject' (leave the
 * previously-committed value in place rather than substituting a guess).
 */
export function parseCoatsInput(raw: string): number | null | 'reject' {
  if (raw.trim() === '') return null;
  const parsed = parseCountField(raw, { min: 1, max: 5 });
  return parsed.kind === 'valid' ? parsed.value : 'reject';
}
