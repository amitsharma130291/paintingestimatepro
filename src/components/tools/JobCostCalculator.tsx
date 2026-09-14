import { useMemo, useState } from 'react';
import { PEP, type Dec } from '../../engine/decimal';
import { parseDecimalField } from '../../engine/parse';
import { directCost, overheadAmount, estimatedJobCost } from '../../engine/cost';
import { evaluatePrice } from '../../engine/pricing';
import { money, percent, statusBadge } from './shared';

type OverheadMode = 'percent' | 'flat';
type PricingMode = 'solveForPrice' | 'enterPrice';

/**
 * Free job-cost calculator (tool-specs/02). Every cost field is
 * independent text state so a blank field is genuinely "missing" (not
 * silently 0) until the user types something — the tool only computes
 * once the active fields for the active modes are all valid.
 */
export default function JobCostCalculator() {
  const [materials, setMaterials] = useState('');
  const [laborAmount, setLaborAmount] = useState('');
  const [travel, setTravel] = useState('');
  const [otherExpense, setOtherExpense] = useState('');
  const [overheadMode, setOverheadMode] = useState<OverheadMode>('percent');
  const [overheadPercent, setOverheadPercent] = useState('15');
  const [overheadFlat, setOverheadFlat] = useState('');
  const [targetPercent, setTargetPercent] = useState('35');
  const [pricingMode, setPricingMode] = useState<PricingMode>('solveForPrice');
  const [enteredPrice, setEnteredPrice] = useState('');

  const result = useMemo(() => {
    const errors: string[] = [];
    // tool-specs/02: "At first render show empty guidance until the user
    // supplies/confirms cost data... missing active inputs block results."
    // Materials and Labor are the active cost inputs in this simplified
    // (non-itemized) build — a blank field must stay `missing` and block
    // the result, never silently become a valid $0. Travel/Other expenses
    // are genuinely optional additive line items (a job may have none),
    // so those default to $0 when blank without blocking anything.
    const pMaterials = parseDecimalField(materials);
    const pLabor = parseDecimalField(laborAmount);
    const pTravel = parseDecimalField(travel || '0');
    const pOther = parseDecimalField(otherExpense || '0');
    const pTargetPct = parseDecimalField(targetPercent);
    const pOverheadPct = parseDecimalField(overheadPercent);
    const pOverheadFlat = parseDecimalField(overheadFlat || '0');

    for (const [label, f] of [
      ['Materials', pMaterials],
      ['Labor', pLabor],
      ['Travel', pTravel],
      ['Other expenses', pOther],
      ['Target margin', pTargetPct],
    ] as const) {
      if (f.kind === 'invalid') errors.push(`${label}: ${f.message}`);
    }
    if (overheadMode === 'percent' && pOverheadPct.kind === 'invalid') errors.push(`Overhead %: ${pOverheadPct.message}`);
    if (overheadMode === 'flat' && pOverheadFlat.kind === 'invalid') errors.push(`Overhead: ${pOverheadFlat.message}`);

    if (pMaterials.kind === 'missing' || pLabor.kind === 'missing') {
      return { errors, cost: null } as const; // genuinely incomplete — no guidance-blocking error text needed, just no result yet
    }
    if (errors.length > 0 || pMaterials.kind !== 'valid' || pLabor.kind !== 'valid' || pTravel.kind !== 'valid' || pOther.kind !== 'valid' || pTargetPct.kind !== 'valid') {
      return { errors, cost: null } as const;
    }

    const targetRatio = pTargetPct.value.dividedBy(100);
    if (targetRatio.greaterThanOrEqualTo(1) || targetRatio.isNegative()) {
      return { errors: ['Target margin must be between 0% and 99%.'], cost: null } as const;
    }

    const dc = directCost(pMaterials.value, pLabor.value, pTravel.value.plus(pOther.value));
    let oh: Dec;
    if (overheadMode === 'percent') {
      if (pOverheadPct.kind !== 'valid') return { errors, cost: null } as const;
      oh = overheadAmount(dc, pOverheadPct.value.dividedBy(100));
    } else {
      oh = pOverheadFlat.kind === 'valid' ? pOverheadFlat.value : new PEP(0);
    }
    const cost = estimatedJobCost(dc, oh);

    let priceInput: Dec | null = null;
    if (pricingMode === 'enterPrice') {
      const pEntered = enteredPrice.trim() === '' ? null : parseDecimalField(enteredPrice);
      if (pEntered && pEntered.kind === 'invalid') return { errors: [`Price: ${pEntered.message}`], cost: null } as const;
      priceInput = pEntered && pEntered.kind === 'valid' ? pEntered.value : null;
    }

    const price = evaluatePrice({ cost, price: priceInput, targetMarginRatio: targetRatio });
    return { errors: [] as string[], cost, directCostValue: dc, overhead: oh, price } as const;
  }, [materials, laborAmount, travel, otherExpense, overheadMode, overheadPercent, overheadFlat, targetPercent, pricingMode, enteredPrice]);

  return (
    <div className="card p-6 sm:p-7">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-base font-semibold text-ink">Costs</h3>
          <div className="mt-3 space-y-3">
            <Field label="Materials ($)" value={materials} onChange={setMaterials} placeholder="0.00" />
            <Field label="Labor ($)" value={laborAmount} onChange={setLaborAmount} placeholder="0.00" />
            <Field label="Travel ($)" value={travel} onChange={setTravel} placeholder="0.00" />
            <Field label="Other expenses ($)" value={otherExpense} onChange={setOtherExpense} placeholder="0.00" />

            <div>
              <label className="text-sm font-medium text-ink-soft">Overhead</label>
              <div className="mt-1 flex gap-2">
                <button type="button" className={`btn ${overheadMode === 'percent' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOverheadMode('percent')}>
                  % of direct cost
                </button>
                <button type="button" className={`btn ${overheadMode === 'flat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOverheadMode('flat')}>
                  Flat $
                </button>
              </div>
              {overheadMode === 'percent' ? (
                <Field label="Overhead %" value={overheadPercent} onChange={setOverheadPercent} placeholder="15" className="mt-2" />
              ) : (
                <Field label="Overhead ($)" value={overheadFlat} onChange={setOverheadFlat} placeholder="0.00" className="mt-2" />
              )}
            </div>

            <Field label="Target margin (%)" value={targetPercent} onChange={setTargetPercent} placeholder="35" />
          </div>
        </div>

        <div>
          <h3 className="text-base font-semibold text-ink">Price</h3>
          <div className="mt-3 flex gap-2">
            <button type="button" className={`btn ${pricingMode === 'solveForPrice' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPricingMode('solveForPrice')}>
              Suggest a price
            </button>
            <button type="button" className={`btn ${pricingMode === 'enterPrice' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPricingMode('enterPrice')}>
              Check my price
            </button>
          </div>
          {pricingMode === 'enterPrice' && <Field label="Your price ($)" value={enteredPrice} onChange={setEnteredPrice} placeholder="Leave blank for unpriced" className="mt-3" />}

          {result.errors.length > 0 && (
            <div className="mt-4 rounded-[calc(var(--radius-card)-8px)] border border-bad-line bg-bad-soft p-3 text-sm text-bad">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          {result.errors.length === 0 && !result.cost && (materials.trim() === '' || laborAmount.trim() === '') && (
            <p className="mt-4 text-sm text-ink-soft">Enter materials and labor cost to see your estimated total.</p>
          )}

          {result.cost && (
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Direct cost" value={money(result.directCostValue)} />
              <Row label="Overhead" value={money(result.overhead)} />
              <Row label="Total estimated cost" value={money(result.cost)} strong />
              {pricingMode === 'solveForPrice' && result.price && (
                <>
                  <Row label="Approx. price (nearest cent)" value={money(result.price.approxPrice)} />
                  <Row label="Suggested price (meets target)" value={money(result.price.minimumTargetPrice)} strong />
                </>
              )}
              {pricingMode === 'enterPrice' && result.price && (
                <>
                  <Row label="Profit" value={money(result.price.profit)} />
                  <Row label="Margin" value={percent(result.price.marginRatio)} strong />
                  <div className="pt-1">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge(result.price).className}`}>{statusBadge(result.price).label}</span>
                  </div>
                </>
              )}
            </dl>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-ink-soft">
        These figures are implied by the costs and target you entered — not a market-rate recommendation. Margin is estimated profit divided by price.
      </p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, className = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-ink-soft">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-ink tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />
    </label>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
