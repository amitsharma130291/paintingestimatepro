// @vitest-environment jsdom
// V6-04: Number.parseInt(v, 10) || 0 let negative counts through unfiltered
// ("-1" is truthy), truncated fractions ("1.9" -> 1), and silently zeroed
// malformed text ("2abc" -> NaN -> 0). The interactive fields now reject
// in place (matching the established parseCoatsInput precedent) rather
// than committing any of those.
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

async function roomWithDeductionsOpen() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Count validation job' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '20'], ['Width (ft)', '16'], ['Height (ft)', '9']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('checkbox', { name: /deduct openings/i }));
}

describe('V6-04: quick door/window count fields reject invalid entry in place', () => {
  it('a negative doors entry never commits -- the field stays at its last valid value', async () => {
    await roomWithDeductionsOpen();
    const doors = screen.getByLabelText('Doors') as HTMLInputElement;
    expect(doors.value).toBe('0');
    fireEvent.change(doors, { target: { value: '-1' } });
    expect((screen.getByLabelText('Doors') as HTMLInputElement).value).toBe('0'); // rejected, not committed as -1
  });

  it('a fractional windows entry ("1.9") never truncates to 1', async () => {
    await roomWithDeductionsOpen();
    const windows = screen.getByLabelText('Windows') as HTMLInputElement;
    fireEvent.change(windows, { target: { value: '1.9' } });
    expect((screen.getByLabelText('Windows') as HTMLInputElement).value).toBe('0'); // rejected, not truncated to 1
  });

  it('malformed text ("2abc") never silently becomes 0 by overwriting a real prior value', async () => {
    await roomWithDeductionsOpen();
    fireEvent.change(screen.getByLabelText('Doors'), { target: { value: '2' } });
    expect((screen.getByLabelText('Doors') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('Doors'), { target: { value: '2abc' } });
    expect((screen.getByLabelText('Doors') as HTMLInputElement).value).toBe('2'); // still 2, not reset to 0
  });

  it('a valid entry still commits normally', async () => {
    await roomWithDeductionsOpen();
    fireEvent.change(screen.getByLabelText('Doors'), { target: { value: '3' } });
    expect((screen.getByLabelText('Doors') as HTMLInputElement).value).toBe('3');
  });
});
