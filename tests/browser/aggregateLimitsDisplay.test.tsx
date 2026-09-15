// @vitest-environment jsdom
// AGG-004: display and draft-saving behavior for an out-of-supported-range
// aggregate, driven through the real mounted ProApp component.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import type { Project } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.paintVariants, { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '1000000000', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW });
  } finally {
    db.close();
  }
});
afterEach(() => cleanup());

async function readProjects(): Promise<Project[]> {
  const db = await openAppDb();
  try {
    return await db.getAll(STORES.projects);
  } finally {
    db.close();
  }
}

describe('AGG-004: an out-of-supported-range aggregate never crashes rendering, never shows a plausible price, and still lets the user save a recoverable draft', () => {
  it('a wall surface at an extreme catalog price shows a clear out-of-range message (never Infinity/NaN/a dollar figure), and Save draft still works', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Extreme job' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    // Never crashes -- the component tree rendered this far without throwing.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/supported range/i);
    expect(alert.textContent).not.toMatch(/Infinity|NaN/);
    expect(screen.queryByText('Estimated job cost')).toBeNull(); // never a plausible complete result alongside the error

    // Draft-saving still works -- never blocked by an out-of-range calculation.
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
    const saved = await readProjects();
    expect(saved).toHaveLength(1);
    expect(saved[0].revisions[0].calculationState).toBe('invalid');

    // Issuing is blocked, exactly like any other invalid calculation.
    expect((screen.getByRole('button', { name: 'Issue estimate' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
