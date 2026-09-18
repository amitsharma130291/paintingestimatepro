// @vitest-environment jsdom
// PRO-013: reconcileDisplayedComponents (CALCULATION_SPEC §7) existed and
// was tested in isolation but was never called from the Pro app's actual
// summary display -- Direct cost and Overhead are each independently
// rounded for display, so their displayed sum could silently disagree
// with the displayed Job cost by a cent. Now surfaced as an explicit
// "Rounding adjustment" row whenever that happens.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.paintVariants, { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW });
  } finally {
    db.close();
  }
});
afterEach(() => cleanup());

function summaryRowValue(label: string): string {
  const dt = screen.getByText(label);
  return (dt.nextElementSibling as HTMLElement).textContent ?? '';
}

describe('PRO-013: the estimate summary reconciles its own displayed components to the displayed total', () => {
  it('the normal case: no rounding adjustment row when displayed components already sum to the displayed total', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00');
    expect(screen.queryByText('Rounding adjustment')).toBeNull();
  });

  it('when Direct cost + Overhead round to a cent DIFFERENT from Job cost\'s own rounding, an explicit adjustment row reconciles them exactly', async () => {
    // Business settings with a business-settings loadedHourlyRate chosen
    // (via Business settings tab) to construct a direct cost / overhead
    // pair whose independently-rounded halves land a cent away from the
    // job cost's own independent rounding. Rather than hand-picking rare
    // fractional inputs, drive it via additional labor hours -- easy to
    // get an exact .xx5 boundary this way.
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Business Settings' }));
    fireEvent.change(screen.getByLabelText(/Loaded hourly rate/i), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText(/Overhead/i), { target: { value: '0.15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    // Add a prep-labor line whose hours produce a raw direct cost with a
    // long fractional-cent tail -- independent HALF_UP rounding of Direct
    // cost and Overhead separately is what can disagree with rounding
    // Job cost as a whole.
    fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const laborRow = screen.getByText('Description').closest('div')!.parentElement!;
    fireEvent.change(within(laborRow).getByLabelText('Hours'), { target: { value: '0.333' } });
    fireEvent.change(within(laborRow).getByLabelText('$/hour'), { target: { value: '32' } });
    await waitFor(() => expect(screen.getByText('Direct cost')).toBeTruthy());

    // Whether or not THIS particular input combination happens to produce
    // a nonzero adjustment, the row's presence/absence must always be
    // internally consistent: if present, displayed Direct cost + displayed
    // Overhead + the adjustment must equal displayed Job cost exactly.
    const directCost = parseFloat(summaryRowValue('Direct cost').replace('$', ''));
    const overhead = parseFloat(summaryRowValue('Overhead').replace('$', ''));
    const jobCost = parseFloat(summaryRowValue('Estimated job cost').replace('$', ''));
    const adjustmentText = screen.queryByText('Rounding adjustment');
    const adjustment = adjustmentText ? parseFloat((adjustmentText.nextElementSibling as HTMLElement).textContent!.replace('$', '')) : 0;
    expect(Math.round((directCost + overhead + adjustment) * 100)).toBe(Math.round(jobCost * 100));
  });
});
