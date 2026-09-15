import { useEffect, useMemo, useState } from 'react';
import { PEP } from '../../engine/decimal';
import { computeDocumentTotals } from '../../engine/document';
import { defaultIdSource } from '../../domain/ids';
import {
  newDraft,
  newLine,
  cloneDraftForDuplicate,
  validateTaxPercent,
  evaluateLines,
  evaluatePrintEligibility,
  type EstimateDraft,
  type Line,
} from './estimateTemplateLogic';
import { loadStoredDrafts, persistDrafts, type PersistResult } from './estimateTemplateStorage';

const ids = defaultIdSource;

/**
 * Free manual estimate template (tool-specs/01). Supports multiple
 * independent drafts (session/local storage, no account) so "Duplicate"
 * can create a genuinely separate estimate rather than re-labeling the one
 * form in place — see estimateTemplateLogic.ts for the pure rules this
 * component wires up (tax validation, zero-total confirmation, duplicate
 * cloning).
 */
export default function EstimateTemplate() {
  const [drafts, setDrafts] = useState<EstimateDraft[]>(() => [newDraft(ids)]);
  const [activeDraftId, setActiveDraftId] = useState<string>(() => drafts[0].id);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<PersistResult>({ status: 'saved' });
  const [loadNotice, setLoadNotice] = useState<string | null>(null);

  useEffect(() => {
    const result = loadStoredDrafts();
    if (result.status === 'loaded') {
      setDrafts(result.drafts);
      setActiveDraftId(result.drafts.some((d) => d.id === result.activeDraftId) ? result.activeDraftId : result.drafts[0].id);
    } else if (result.status === 'corrupted') {
      // Do not silently replace malformed data while claiming a normal
      // fresh start — say so, and name where the original bytes were kept.
      setLoadNotice(
        result.backupKey
          ? "We couldn't read your previous save (it looks corrupted) — starting a fresh estimate. The original data was kept for reference in your browser's local storage; contact support if you need help recovering it."
          : "We couldn't read your previous save (it looks corrupted) — starting a fresh estimate."
      );
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trySave(nextDrafts: EstimateDraft[], nextActiveDraftId: string) {
    setSaveStatus(persistDrafts(nextDrafts, nextActiveDraftId));
  }

  useEffect(() => {
    if (loaded) trySave(drafts, activeDraftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, activeDraftId, loaded]);

  const draft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];

  function updateDraft(patch: Partial<EstimateDraft>) {
    setDrafts((ds) => ds.map((d) => (d.id === draft.id ? { ...d, ...patch } : d)));
  }
  function updateLine(lineId: string, patch: Partial<Line>) {
    updateDraft({ lines: draft.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)), noChargeConfirmed: false });
  }
  function addLine() {
    updateDraft({ lines: [...draft.lines, newLine(ids)] });
  }
  function removeLine(lineId: string) {
    updateDraft({ lines: draft.lines.filter((l) => l.id !== lineId), noChargeConfirmed: false });
  }
  function newEstimate() {
    const created = newDraft(ids);
    setDrafts((ds) => [...ds, created]);
    setActiveDraftId(created.id);
  }
  function duplicateEstimate() {
    const clone = cloneDraftForDuplicate(draft, ids);
    setDrafts((ds) => [...ds, clone]);
    setActiveDraftId(clone.id);
  }
  function deleteEstimate(id: string) {
    setDrafts((ds) => {
      const next = ds.filter((d) => d.id !== id);
      if (next.length === 0) {
        const fresh = newDraft(ids);
        setActiveDraftId(fresh.id);
        return [fresh];
      }
      if (id === activeDraftId) setActiveDraftId(next[0].id);
      return next;
    });
  }

  const evaluation = useMemo(() => {
    const { incompleteRowIds, validLines } = evaluateLines(draft.lines);
    const taxValidation = validateTaxPercent(draft.taxEnabled, draft.taxPercent);
    const taxRatio = taxValidation.kind === 'valid' ? taxValidation.ratio : new PEP(0);
    const taxApplies = draft.taxEnabled && taxValidation.kind === 'valid';
    const totals = computeDocumentTotals(validLines, taxApplies, taxRatio);
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds,
      validLineCount: validLines.length,
      taxValidation,
      total: totals.total,
      noChargeConfirmed: draft.noChargeConfirmed,
    });
    return { incompleteRowIds, taxValidation, totals, eligibility };
  }, [draft]);

  return (
    <div className="card p-6 sm:p-7">
      <div className="print:hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
          {drafts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDraftId(d.id)}
              className={`btn ${d.id === draft.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {d.estimateNumber || 'Untitled'}
            </button>
          ))}
          <button type="button" className="btn btn-secondary" onClick={newEstimate}>
            + New estimate
          </button>
        </div>
        {loadNotice && <p className="mt-2 rounded-btn border border-warn-line bg-warn-soft p-2 text-xs text-warn">{loadNotice}</p>}
        {saveStatus.status === 'failed' && (
          <p className="mt-2 rounded-btn border border-warn-line bg-warn-soft p-2 text-xs text-warn">
            Not saved — your browser blocked local storage (private browsing, or storage is full). Your current changes are still here in this tab; print or export before closing, since they will be lost on reload.{' '}
            <button type="button" className="text-link" onClick={() => trySave(drafts, activeDraftId)}>
              Retry saving
            </button>
          </p>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Estimate {draft.estimateNumber || '(unsaved)'} · {saveStatus.status === 'saved' ? 'saved locally in your browser.' : 'not saved yet.'}
          {drafts.length > 1 && (
            <button type="button" className="text-link ml-2 text-xs" onClick={() => deleteEstimate(draft.id)}>
              Delete this estimate
            </button>
          )}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 print:hidden">
        <Field label="Business name" value={draft.businessName} onChange={(v) => updateDraft({ businessName: v })} />
        <Field label="Customer name" value={draft.customerName} onChange={(v) => updateDraft({ customerName: v })} />
      </div>

      <div className="mt-6 overflow-x-auto print:hidden">
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
            {draft.lines.map((l) => {
              const incomplete = evaluation.incompleteRowIds.includes(l.id);
              const isValidLine = l.description.trim() !== '' && !incomplete && (l.unitPrice.trim() !== '' || l.quantity.trim() !== '1');
              let lineTotalDisplay = '—';
              if (isValidLine) {
                const qtyN = new PEP(l.quantity || '0');
                const priceN = new PEP(l.unitPrice || '0');
                lineTotalDisplay = qtyN.times(priceN).toDecimalPlaces(2).toFixed(2);
              }
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
                  <td className="py-2 pr-3 tabular-nums">{incomplete ? <span className="text-warn">incomplete</span> : `$${lineTotalDisplay}`}</td>
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

      <button type="button" className="btn btn-secondary mt-3 print:hidden" onClick={addLine}>
        + Add line
      </button>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <label className="block text-sm">
          <span className="font-medium text-ink-soft">Notes / terms</span>
          <textarea className="mt-1 w-full max-w-sm rounded-btn border border-line px-3 py-2" rows={2} value={draft.notes} onChange={(e) => updateDraft({ notes: e.target.value })} placeholder="Notes / terms" />
        </label>

        <div className="w-full max-w-xs">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={draft.taxEnabled} onChange={(e) => updateDraft({ taxEnabled: e.target.checked, noChargeConfirmed: false })} /> Apply tax
          </label>
          {draft.taxEnabled && (
            <label className="mt-2 block text-sm">
              <span className="font-medium text-ink-soft">Tax % (0–100)</span>
              <input className="mt-1 w-full rounded-btn border border-line px-3 py-2 tabular-nums" value={draft.taxPercent} onChange={(e) => updateDraft({ taxPercent: e.target.value, noChargeConfirmed: false })} />
            </label>
          )}
          {evaluation.taxValidation.kind === 'invalid' && <p className="mt-1 text-xs text-bad">{evaluation.taxValidation.message}</p>}
          {evaluation.taxValidation.kind === 'valid' && evaluation.taxValidation.warning && <p className="mt-1 text-xs text-warn">{evaluation.taxValidation.warning}</p>}

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Subtotal</dt>
              <dd className="tabular-nums">${evaluation.totals.subtotal.toFixed(2)}</dd>
            </div>
            {draft.taxEnabled && evaluation.taxValidation.kind === 'valid' && (
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

          {evaluation.eligibility.isZeroTotal && (
            <label className="mt-3 flex items-start gap-2 text-xs text-ink">
              <input type="checkbox" className="mt-0.5" checked={draft.noChargeConfirmed} onChange={(e) => updateDraft({ noChargeConfirmed: e.target.checked })} />
              I confirm this is an intentional $0 no-charge estimate.
            </label>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 print:hidden">
        <button type="button" className="btn btn-secondary" onClick={duplicateEstimate}>
          Duplicate
        </button>
        <button type="button" className="btn btn-primary" disabled={!evaluation.eligibility.canPrint} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      {!evaluation.eligibility.canPrint && (
        // UX-003: same role="alert" fix as the other two free tools.
        <ul role="alert" className="mt-2 text-xs text-warn print:hidden">
          {evaluation.eligibility.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">{draft.businessName || 'Your business'}</h2>
        <p className="text-sm">Prepared for: {draft.customerName || '______'}</p>
        <p className="text-xs text-ink-soft">
          Estimate {draft.estimateNumber || '(unsaved)'} — {new Date().toLocaleDateString()}
        </p>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="py-1 pr-3">Description</th>
              <th className="py-1 pr-3">Qty</th>
              <th className="py-1 pr-3">Unit price</th>
              <th className="py-1 pr-3">Line total</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines
              .filter((l) => l.description.trim() !== '' && !evaluation.incompleteRowIds.includes(l.id) && (l.unitPrice.trim() !== '' || l.quantity.trim() !== '1'))
              .map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-1 pr-3">{l.description}</td>
                  <td className="py-1 pr-3">{l.quantity}</td>
                  <td className="py-1 pr-3">${new PEP(l.unitPrice || '0').toFixed(2)}</td>
                  <td className="py-1 pr-3">${new PEP(l.quantity || '0').times(new PEP(l.unitPrice || '0')).toDecimalPlaces(2).toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>${evaluation.totals.subtotal.toFixed(2)}</dd>
          </div>
          {draft.taxEnabled && evaluation.taxValidation.kind === 'valid' && (
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd>${evaluation.totals.tax.toFixed(2)}</dd>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd>${evaluation.totals.total.toFixed(2)}</dd>
          </div>
        </dl>
        {draft.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{draft.notes}</p>}
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
