// @vitest-environment jsdom
// V5-10: CALCULATION_SPEC.md §2 requires explicit customer-entered geometry
// for trim/door services -- "no hidden defaults." addService() previously
// invented a 4ft trim width and a 3x6.67 two-sided door. The independent
// review's own test only covers trim; this extends the same check to
// every service kind that has required geometry, per its own explicit
// "test every service kind" instruction.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

async function mount() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
}

describe('V5-10 (extended): no service kind invents required geometry', () => {
  it('a new door service starts with width, height, and painted sides all unset — no invented 3x6.67 two-sided door', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '+ door service' }));
    const width = (await screen.findByLabelText(/Width/)) as HTMLInputElement;
    const height = screen.getByLabelText(/Height/) as HTMLInputElement;
    expect(width.value).toBe('');
    expect(height.value).toBe('');
  });
});
