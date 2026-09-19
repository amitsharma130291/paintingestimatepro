// @vitest-environment jsdom
// DOC-004: an unpriced/incomplete draft's print/scope preview must exist
// at all (previously it did not -- the "Customer-facing document" block
// only ever rendered the FROZEN snapshot an issued revision carries, so
// a draft had nothing to preview before issue), must be clearly marked
// DRAFT, and must show PRICE PENDING rather than a blank or $0.00 when
// no price has actually been set.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.businessSettings, {
      id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
      wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
      defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    });
    await db.put(STORES.paintVariants, { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW });
  } finally {
    db.close();
  }
});
afterEach(() => cleanup());

describe('DOC-004: draft (pre-issue) customer document preview', () => {
  it('a brand-new, entirely empty draft already gets a DRAFT-marked preview, with no scope lines yet and PRICE PENDING', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    await screen.findByLabelText('Project title');

    expect(await screen.findByText('Customer-facing document — draft preview')).toBeTruthy();
    expect(screen.getByText(/DRAFT — not yet issued/i)).toBeTruthy();
    expect(screen.getByText('PRICE PENDING')).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('an incomplete draft (room started, no price) shows a DRAFT-marked preview with PRICE PENDING, never a blank or $0.00', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    // Width/height left blank -- room stays incomplete.

    expect(await screen.findByText('Customer-facing document — draft preview')).toBeTruthy();
    expect(screen.getByText(/DRAFT — not yet issued/i)).toBeTruthy();
    expect(screen.getByText('PRICE PENDING')).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('a COMPLETE but not-yet-issued draft shows the live proposed price immediately, still marked DRAFT', async () => {
    // BUG fix: the preview used to keep showing PRICE PENDING here until
    // the user separately clicked "Save draft", even though the Estimate
    // summary card right above it already showed a real, complete price —
    // confusing, since every OTHER field in the preview (scope lines,
    // business/customer info) already reflects live, unsaved typing. The
    // preview now mirrors the same live price the summary shows, without
    // requiring a save first; only issuing still freezes it permanently.
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00'); // materials computed -> calculation is complete

    const proposedPriceRow = screen.getByText('Proposed price').closest('div')!;
    const livePrice = within(proposedPriceRow).getByText(/^\$[\d,]+\.\d{2}$/).textContent;

    expect(screen.getByText(/DRAFT — not yet issued/i)).toBeTruthy();
    expect(screen.queryByText('PRICE PENDING')).toBeNull();
    // The exact same price string appears twice: once in the live Estimate
    // summary card, once in the customer-document preview below it.
    expect(screen.getAllByText(livePrice!).length).toBeGreaterThanOrEqual(2);
  });

  it('after issuing, the document shows the real price and drops the DRAFT marker', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen repaint' } }); // checkIssueGate requires a non-blank title
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00');
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));

    await waitFor(() => expect(screen.queryByText(/DRAFT — not yet issued/i)).toBeNull());
    expect(screen.queryByText('PRICE PENDING')).toBeNull();
    expect(screen.getByText(/^\$[\d,]+\.\d{2}$/)).toBeTruthy();
  });
});
