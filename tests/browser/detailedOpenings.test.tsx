// @vitest-environment jsdom
// Item 6 ("Measured opening dimensions and quick/detailed entry modes"):
// the domain layer (estimateAssembly.ts resolveSurface) already fully
// supported Room.openingMode 'detailed' and Room.openings[], but the real
// Pro room editor never exposed a way to switch to it or add a measured
// opening -- only the quick 20/15 ft² constants were reachable through the
// interface, identical in spirit to the free calculator's own INT-010 gap.
//
// The Pro room editor has no per-room net-area display (unlike the free
// interior calculator) -- only the aggregate "Estimate summary" card's
// Materials cost reflects the net area through gallon purchasing. Expected
// values below are independently derived from CALCULATION_SPEC.md's own
// formulas, then verified against the resulting Materials dollar figure,
// not against a nonexistent area readout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

// The opening row's own "Width (ft)"/"Height (ft)" fields share their
// label text with the room's own dimension fields — the opening row is
// always added AFTER those, so its inputs are the LAST match.
function lastLabeled(text: string): HTMLElement {
  const matches = screen.getAllByLabelText(text);
  return matches[matches.length - 1];
}

async function newRoomWithDeductions() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Detailed openings job' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '20'], ['Width (ft)', '16'], ['Height (ft)', '9']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('checkbox', { name: /deduct openings/i }));
}

describe('Pro room editor: quick/detailed opening entry mode', () => {
  it('defaults to quick mode with the 20/15 ft² constants applied (0 doors/0 windows -> no deduction)', async () => {
    await newRoomWithDeductions();
    // Independently derived: gross = 2*(20+16)*9 = 648; quick default 0 doors/0 windows -> net = 648.
    // raw = 648*2*1.1/350 = 4.073142857...; buy 5 gal * $42 = $210.00.
    expect(await screen.findByText('$210.00')).toBeTruthy();
  });

  it('switching to detailed mode and adding a measured opening changes materials cost using the MEASURED dimensions, not the 20/15 constants', async () => {
    await newRoomWithDeductions();
    fireEvent.change(screen.getByLabelText('Opening entry'), { target: { value: 'detailed' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add measured opening' }));
    fireEvent.change(lastLabeled('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(lastLabeled('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '1' } });

    // Independently derived: gross 648; measured opening 3*6.67*1=20.01 (NOT the quick constant 20); net = 627.99.
    // raw = 627.99*2*1.1/350 = 3.947365714...; buy 4 gal * $42 = $168.00 -- distinct from the 20/15-constant result above.
    expect(await screen.findByText('$168.00')).toBeTruthy();
  });

  it('an incomplete measured opening (blank height) reports invalid, never crashes, and blocks the priced result', async () => {
    await newRoomWithDeductions();
    fireEvent.change(screen.getByLabelText('Opening entry'), { target: { value: 'detailed' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add measured opening' }));
    fireEvent.change(lastLabeled('Width (ft)'), { target: { value: '3' } });
    // height left blank
    expect(await screen.findByText(/invalid/i)).toBeTruthy();
  });

  it('persists the detailed opening mode and its measured entry through save and reopen', async () => {
    await newRoomWithDeductions();
    fireEvent.change(screen.getByLabelText('Opening entry'), { target: { value: 'detailed' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add measured opening' }));
    fireEvent.change(lastLabeled('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(lastLabeled('Height (ft)'), { target: { value: '6.67' } });
    await screen.findByText('$168.00');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy(), { timeout: 5000 });

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    expect(await screen.findByText('$168.00')).toBeTruthy();
    expect((screen.getByLabelText('Opening entry') as HTMLSelectElement).value).toBe('detailed');
    expect((lastLabeled('Width (ft)') as HTMLInputElement).value).toBe('3');
  });
});
