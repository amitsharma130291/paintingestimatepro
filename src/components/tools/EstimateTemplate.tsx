import { useMemo, useState } from 'react';
import { PEP, type Dec } from '../../engine/decimal';
import { parseDecimalField } from '../../engine/parse';
import { computeDocumentTotals } from '../../engine/document';

interface Line {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

let nextId = 1;
function newLine(): Line {
  return { id: `line-${nextId++}`, description: '', quantity: '1', unitPrice: '' };
}

/** Free manual estimate template (tool-specs/01). A line counts as
 * "touched" once ANY field has content — an untouched blank row is simply
 * ignored, but a touched-and-incomplete row blocks a priced print. */
export default function EstimateTemplate() {
  const [businessName, setBusinessName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxPercent, setTaxPercent] = useState('0');
  const [notes, setNotes] = useState('');

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, newLine()]);
  }
  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
  }
  function duplicateEstimate() {
    setLines((ls) => ls.map((l) => ({ ...l, id: `line-${nextId++}` })));
  }

  const evaluation = useMemo(() => {
    // A fresh row's quantity defaults to "1" (tool-specs/01: "quantity...
    // initially 1") — that default alone must NOT count as "touched," or
    // every brand-new blank row would immediately register as an
    // incomplete line and block printing. Only a changed quantity,
    // a description, or a price counts as the user having started the row.
    const touched = lines.filter((l) => l.description.trim() !== '' || l.unitPrice.trim() !== '' || l.quantity.trim() !== '1');
    const incompleteRows: string[] = [];
    const validLines: { quantity: Dec; unitSellingPrice: Dec }[] = [];

    for (const l of touched) {
      const qty = parseDecimalField(l.quantity || null);
      const price = parseDecimalField(l.unitPrice || null);
      const descOk = l.description.trim() !== '';
      if (!descOk || qty.kind !== 'valid' || price.kind !== 'valid') {
        incompleteRows.push(l.id);
        continue;
      }
      validLines.push({ quantity: qty.value, unitSellingPrice: price.value });
    }

    const pTax = parseDecimalField(taxPercent);
    const taxRatio = pTax.kind === 'valid' ? pTax.value.dividedBy(100) : new PEP(0);
    const totals = computeDocumentTotals(validLines, taxEnabled && pTax.kind === 'valid', taxRatio);

    return { incompleteRows, canPrintPriced: incompleteRows.length === 0 && validLines.length > 0, totals };
  }, [lines, taxEnabled, taxPercent]);

  return (
    <div className="card p-6 sm:p-7">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name" value={businessName} onChange={setBusinessName} />
        <Field label="Customer name" value={customerName} onChange={setCustomerName} />
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">Qty</th>
              <th className="py-2 pr-3 font-medium">Unit price</th>
              <th className="py-2 pr-3 font-medium">Line total</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const incomplete = evaluation.incompleteRows.includes(l.id);
              const qty = parseDecimalField(l.quantity || null);
              const price = parseDecimalField(l.unitPrice || null);
              const lineTotal = qty.kind === 'valid' && price.kind === 'valid' ? qty.value.times(price.value).toDecimalPlaces(2).toFixed(2) : '—';
              return (
                <tr key={l.id} className={`border-b border-line-soft ${incomplete ? 'bg-warn-soft/40' : ''}`}>
                  <td className="py-2 pr-3">
                    <input className="w-full rounded-btn border border-line px-2 py-1" value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} placeholder="Painting — living room" />
                  </td>
                  <td className="py-2 pr-3">
                    <input className="w-20 rounded-btn border border-line px-2 py-1 tabular-nums" value={l.quantity} onChange={(e) => updateLine(l.id, { quantity: e.target.value })} />
                  </td>
                  <td className="py-2 pr-3">
                    <input className="w-24 rounded-btn border border-line px-2 py-1 tabular-nums" value={l.unitPrice} onChange={(e) => updateLine(l.id, { unitPrice: e.target.value })} placeholder="0.00" />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{incomplete ? <span className="text-warn">incomplete</span> : `$${lineTotal}`}</td>
                  <td className="py-2">
                    <button type="button" className="text-link text-xs" onClick={() => removeLine(l.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button" className="btn btn-secondary mt-3" onClick={addLine}>
        + Add line
      </button>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <label className="block text-sm">
          <textarea className="mt-1 w-full max-w-sm rounded-btn border border-line px-3 py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes / terms" />
        </label>

        <div className="w-full max-w-xs">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={taxEnabled} onChange={(e) => setTaxEnabled(e.target.checked)} /> Apply tax
          </label>
          {taxEnabled && (
            <label className="mt-2 block text-sm">
              <span className="font-medium text-ink-soft">Tax %</span>
              <input className="mt-1 w-full rounded-btn border border-line px-3 py-2 tabular-nums" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </label>
          )}
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="tabular-nums">${evaluation.totals.subtotal.toFixed(2)}</dd>
            </div>
            {taxEnabled && (
              <div className="flex justify-between">
                <dt className="text-ink-soft">Tax</dt>
                <dd className="tabular-nums">${evaluation.totals.tax.toFixed(2)}</dd>
              </div>
            )}
            <div className="flex justify-between font-semibold text-ink">
              <dt>Total</dt>
              <dd className="tabular-nums">${evaluation.totals.total.toFixed(2)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="btn btn-secondary" onClick={duplicateEstimate}>
          Duplicate
        </button>
        <button type="button" className="btn btn-primary" disabled={!evaluation.canPrintPriced} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        {!evaluation.canPrintPriced && <p className="self-center text-xs text-ink-soft">Add at least one complete line to print a priced estimate.</p>}
      </div>

      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">{businessName || 'Your business'}</h2>
        <p>Prepared for: {customerName || '______'}</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink-soft">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-btn border border-line bg-card px-3 py-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
    </label>
  );
}
