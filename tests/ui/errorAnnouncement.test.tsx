// @vitest-environment jsdom
// UX-003: an invalid submission must be announced to assistive tech, not
// just shown as a silent visual cue. role="alert" is an implicit assertive
// live region -- confirmed present on every tool's error container.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import JobCostCalculator from '../../src/components/tools/JobCostCalculator';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import EstimateTemplate from '../../src/components/tools/EstimateTemplate';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe('UX-003: JobCostCalculator announces an invalid entry via role="alert"', () => {
  it('an invalid materials amount renders its error inside an alert region', () => {
    render(<JobCostCalculator />);
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '0' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Materials/i);
  });
});

describe('UX-003: InteriorCalculator announces an invalid entry via role="alert"', () => {
  it('a non-positive room length renders its error inside an alert region', () => {
    render(<InteriorCalculator />);
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '10' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/length/i);
  });
});

describe('UX-003: EstimateTemplate announces a print-blocking reason via role="alert"', () => {
  it('an untouched template\'s "add at least one line" guidance is inside an alert region', () => {
    render(<EstimateTemplate />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/complete line/i);
  });
});

describe('UX-003: the Pro estimate summary announces an invalid-surface state via role="alert"', () => {
  it('the invalid-summary message is inside an alert region, distinct from the stale-output concern (a complete result never renders alongside it)', async () => {
    const { default: ProApp } = await import('../../src/components/tools/pro/ProApp');
    const { openAppDb, STORES } = await import('../../src/storage/db');
    const db = await openAppDb();
    try {
      for (const store of Object.values(STORES)) await db.clear(store);
      await db.put(STORES.paintVariants, { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    } finally {
      db.close();
    }
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '-1' } }); // invalid
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/invalid/i));
    expect(screen.queryByText('Estimated job cost')).toBeNull(); // never a stale complete result alongside the error
  });
});
