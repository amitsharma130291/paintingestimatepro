// @vitest-environment jsdom
// UX-004: monetary result updates must be announced to a screen reader
// -- an aria-live region around the results container is the mechanism.
// Previously there was zero aria-live anywhere in the app.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import JobCostCalculator from '../../src/components/tools/JobCostCalculator';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

const NOW = '2026-01-01T00:00:00.000Z';

afterEach(() => cleanup());

describe('UX-004: recalculated results are announced via aria-live', () => {
  it('the free interior calculator\'s result summary is an aria-live="polite" region', () => {
    render(<InteriorCalculator />);
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '10' } });
    const region = screen.getByText('Total paintable area').closest('[aria-live]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-live')).toBe('polite');
  });

  it('the free job-cost calculator\'s result summary is an aria-live="polite" region once a valid job is entered', () => {
    render(<JobCostCalculator />);
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest a price' }));
    const region = screen.getByText('Materials').closest('[aria-live]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-live')).toBe('polite');
  });
});

describe('UX-004 (Pro tool): the estimate summary is an aria-live region', () => {
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

  it('the completed cost breakdown renders inside an aria-live="polite" region', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00');
    const region = screen.getByText('Materials').closest('[aria-live]');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-live')).toBe('polite');
  });
});
