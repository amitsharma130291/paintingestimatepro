import { useMemo, useState } from 'react';
import { money, percent, statusBadge } from './shared';
import { evaluateJobCost, newOtherExpenseLine, type MaterialsMode, type LaborMode, type OverheadMode, type PricingMode, type OtherExpenseLine } from './jobCostCalculatorLogic';

let nextLineId = 1;

/**
 * Free job-cost calculator (tool-specs/02). Materials and labor each have
 * two modes (lumpSum/itemized, direct/hoursRate) that never blend stale
 * values from the inactive one — see jobCostCalculatorLogic.ts for the
 * pure, tested rules this component wires up.
 */
export default function JobCostCalculator() {
  const [materialsMode, setMaterialsMode] = useState<MaterialsMode>('lumpSum');
  const [materialsAmount, setMaterialsAmount] = useState('');
  const [paintGallons, setPaintGallons] = useState('');
  const [paintPricePerGal, setPaintPricePerGal] = useState('');
  const [suppliesAmount, setSuppliesAmount] = useState('');

  const [laborMode, setLaborMode] = useState<LaborMode>('direct');
  const [laborAmount, setLaborAmount] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [loadedHourlyRate, setLoadedHourlyRate] = useState('');

  const [travelAmount, setTravelAmount] = useState('');
  const [otherExpenseLines, setOtherExpenseLines] = useState<OtherExpenseLine[]>([]);

  const [overheadMode, setOverheadMode] = useState<OverheadMode>('percent');
  const [overheadPercent, setOverheadPercent] = useState('15');
  const [overheadFlat, setOverheadFlat] = useState('');
  const [targetPercent, setTargetPercent] = useState('35');
  const [pricingMode, setPricingMode] = useState<PricingMode>('solveForPrice');
  const [enteredPrice, setEnteredPrice] = useState('');

  function addExpenseLine() {
    setOtherExpenseLines((ls) => [...ls, newOtherExpenseLine(`job-line-${nextLineId++}`)]);
  }
  function updateExpenseLine(id: string, patch: Partial<OtherExpenseLine>) {
    setOtherExpenseLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeExpenseLine(id: string) {
    setOtherExpenseLines((ls) => ls.filter((l) => l.id !== id));
  }

  const result = useMemo(
    () =>
      evaluateJobCost({
        materialsMode, materialsAmount, paintGallons, paintPricePerGal, suppliesAmount,
        laborMode, laborAmount, laborHours, loadedHourlyRate,
        travelAmount, otherExpenseLines,
        overheadMode, overheadPercent, overheadFlat,
        targetPercent, pricingMode, enteredPrice,
      }),
    [materialsMode, materialsAmount, paintGallons, paintPricePerGal, suppliesAmount, laborMode, laborAmount, laborHours, loadedHourlyRate, travelAmount, otherExpenseLines, overheadMode, overheadPercent, overheadFlat, targetPercent, pricingMode, enteredPrice]
  );

  return (
    <div className="card p-6 sm:p-7">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h3 className="text-base font-semibold text-ink">Costs</h3>
          <div className="mt-3 space-y-3">
            <div>
              <div className="flex gap-2">
                <button type="button" className={`btn ${materialsMode === 'lumpSum' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMaterialsMode('lumpSum')}>
                  Materials: one amount
                </button>
                <button type="button" className={`btn ${materialsMode === 'itemized' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMaterialsMode('itemized')}>
                  Materials: paint + supplies
                </button>
              </div>
              {materialsMode === 'lumpSum' ? (
                <Field label="Materials ($)" value={materialsAmount} onChange={setMaterialsAmount} placeholder="0.00" className="mt-2" />
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Field label="Paint (gal)" value={paintGallons} onChange={setPaintGallons} placeholder="0" />
                  <Field label="Price/gal ($)" value={paintPricePerGal} onChange={setPaintPricePerGal} placeholder="0.00" />
                  <Field label="Supplies ($)" value={suppliesAmount} onChange={setSuppliesAmount} placeholder="0.00" />
                </div>
              )}
            </div>

            <div>
              <div className="flex gap-2">
                <button type="button" className={`btn ${laborMode === 'direct' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLaborMode('direct')}>
                  Labor: one amount
                </button>
                <button type="button" className={`btn ${laborMode === 'hoursRate' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLaborMode('hoursRate')}>
                  Labor: hours × rate
                </button>
              </div>
              {laborMode === 'direct' ? (
                <Field label="Labor ($)" value={laborAmount} onChange={setLaborAmount} placeholder="0.00" className="mt-2" />
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Hours" value={laborHours} onChange={setLaborHours} placeholder="0" />
                  <Field label="Loaded rate ($/hr)" value={loadedHourlyRate} onChange={setLoadedHourlyRate} placeholder="0.00" />
                </div>
              )}
            </div>

            <Field label="Travel ($)" value={travelAmount} onChange={setTravelAmount} placeholder="0.00" />

            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-soft">Other expenses</span>
                <button type="button" className="text-link text-xs" onClick={addExpenseLine}>
                  + Add line
                </button>
              </div>
              {otherExpenseLines.map((line) => (
                <div key={line.id} className="mt-1 flex gap-2">
                  <input className="w-full rounded-btn border border-line px-2 py-1 text-sm" value={line.description} onChange={(e) => updateExpenseLine(line.id, { description: e.target.value })} placeholder="Description" />
                  <input className="w-24 rounded-btn border border-line px-2 py-1 text-sm tabular-nums" value={line.amount} onChange={(e) => updateExpenseLine(line.id, { amount: e.target.value })} placeholder="0.00" />
                  <button type="button" className="text-link text-xs" onClick={() => removeExpenseLine(line.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

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

          {result.state === 'incomplete' && <p className="mt-4 text-sm text-ink-soft">Enter materials, labor, and a target margin to see your estimated total.</p>}

          {result.state === 'invalid' && (
            <div className="mt-4 rounded-[calc(var(--radius-card)-8px)] border border-bad-line bg-bad-soft p-3 text-sm text-bad">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          {result.state === 'complete' && (
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Materials" value={money(result.materials)} />
              <Row label="Labor" value={money(result.labor)} />
              <Row label="Other expenses (incl. travel)" value={money(result.otherExpenses)} />
              <Row label="Direct cost" value={money(result.directCostValue)} />
              <Row label="Overhead" value={money(result.overhead)} />
              <Row label="Total estimated cost" value={money(result.cost)} strong />
              {pricingMode === 'solveForPrice' && (
                <>
                  <Row label="Approx. price (nearest cent)" value={money(result.price.approxPrice)} />
                  <Row label="Suggested price (meets target)" value={money(result.price.minimumTargetPrice)} strong />
                </>
              )}
              {pricingMode === 'enterPrice' && (
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
