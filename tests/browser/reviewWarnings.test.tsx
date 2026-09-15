// @vitest-environment jsdom
// COST-018/COST-019: CALCULATION_SPEC section 1's "waste >0.5 and overhead
// >0.5 produce nonblocking review warnings" surfaced in the real Pro UI --
// a high ratio never blocks the estimate, it only shows an informational
// notice alongside an otherwise-normal priced result.
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

describe('An overhead ratio above 0.5 shows a nonblocking warning but still prices the estimate normally', () => {
  it('setting Overhead to 0.75 keeps a real priced result and adds a warning notice', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Business settings' }));
    fireEvent.change(screen.getByLabelText(/Overhead/i), { target: { value: '0.75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await waitFor(() => expect(screen.getByText('Estimated job cost')).toBeTruthy());
    expect(screen.getByText(/overhead is set unusually high/i)).toBeTruthy();
  });

  it('the default overhead ratio (0.15) shows no such warning', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await waitFor(() => expect(screen.getByText('Estimated job cost')).toBeTruthy());
    expect(screen.queryByText(/unusually high/i)).toBeNull();
  });
});
