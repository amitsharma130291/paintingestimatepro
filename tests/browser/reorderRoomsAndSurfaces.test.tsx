// @vitest-environment jsdom
// PRO-014: accessible (keyboard-operable Move up/down, not drag-and-drop
// only) room/surface reordering through the real ProApp component + real
// IndexedDB, including persistence after save/reopen.
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

async function readProjects(): Promise<Project[]> {
  const db = await openAppDb();
  try {
    return await db.getAll(STORES.projects);
  } finally {
    db.close();
  }
}

async function mountWithTwoRooms() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Kitchen' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  const names = screen.getAllByLabelText('Room name');
  fireEvent.change(names[names.length - 1], { target: { value: 'Bedroom' } });
}

describe('PRO-014: room reordering', () => {
  it('the first room\'s Move up is disabled, and the last room\'s Move down is disabled', async () => {
    await mountWithTwoRooms();
    const upButtons = screen.getAllByRole('button', { name: /move .* up/i });
    const downButtons = screen.getAllByRole('button', { name: /move .* down/i });
    expect((upButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((downButtons[downButtons.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking Move down on the first room (Kitchen) swaps its order with the second (Bedroom)', async () => {
    await mountWithTwoRooms();
    let names = screen.getAllByLabelText('Room name') as HTMLInputElement[];
    expect(names.map((n) => n.value)).toEqual(['Kitchen', 'Bedroom']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Kitchen down' }));

    names = screen.getAllByLabelText('Room name') as HTMLInputElement[];
    expect(names.map((n) => n.value)).toEqual(['Bedroom', 'Kitchen']);
  });

  it('reordering never changes calculated totals', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    const dims = screen.getAllByLabelText(/^(Length|Width|Height) \(ft\)$/);
    // Second room's own Length/Width/Height fields (fields 4,5,6 of the 6 now on screen).
    fireEvent.change(dims[3], { target: { value: '10' } });
    fireEvent.change(dims[4], { target: { value: '10' } });
    fireEvent.change(dims[5], { target: { value: '8' } });

    function materialsValue(): string {
      const dt = screen.getByText('Materials');
      return (dt.nextElementSibling as HTMLElement).textContent ?? '';
    }
    await waitFor(() => expect(materialsValue()).not.toBe(''));
    const before = materialsValue();
    fireEvent.click(screen.getAllByRole('button', { name: /move .* down/i })[0]);
    await waitFor(() => expect(materialsValue()).toBe(before)); // unchanged after reordering
  });

  it('the new order survives save and full reopen (real IndexedDB)', async () => {
    await mountWithTwoRooms();
    fireEvent.click(screen.getByRole('button', { name: 'Move Kitchen down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.rooms.map((r) => r.name)).toEqual(['Bedroom', 'Kitchen']);

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    const names = await screen.findAllByLabelText('Room name') as HTMLInputElement[];
    expect(names.map((n) => n.value)).toEqual(['Bedroom', 'Kitchen']);
  });
});

describe('PRO-014: standalone surface reordering', () => {
  it('adding a trim then a door, then moving the door up, reorders them', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Trim' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Door' }));

    let kinds = screen.getAllByText(/^(trim|door)$/i).map((el) => el.textContent);
    expect(kinds).toEqual(['trim', 'door']);

    fireEvent.click(screen.getByRole('button', { name: 'Move this door up' }));

    kinds = screen.getAllByText(/^(trim|door)$/i).map((el) => el.textContent);
    expect(kinds).toEqual(['door', 'trim']);
  });

  it('the first standalone surface\'s Move up is disabled', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Trim' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Door' }));

    expect((screen.getByRole('button', { name: 'Move this trim up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move this door down' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
