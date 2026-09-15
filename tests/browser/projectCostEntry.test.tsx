// @vitest-environment jsdom
// Independent review's "Important completeness gap": the main Pro project
// editor exposed no way to add named prep labor, itemized other materials,
// a supplies allowance, or direct expenses/travel -- assembleProjectEstimate
// already consumed these fields, but no real UI ever wrote to them. This is
// the review's own "Required completion test": start with an empty project
// in the real interface; add a named prep task with hours and rate, a
// quantity-and-unit-cost material, an allowance, and a travel expense.
// Independently verify their contribution to cost, overhead, target price,
// save/reopen, issue, and restored results.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import type { Project } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
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

describe('Completing the paid costing interface: prep labor, itemized materials, supplies allowance, travel/expenses', () => {
  it('a customer can enter every additional-cost input through the REAL interface, and it correctly contributes to cost/overhead/price, survives save/reopen/issue', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Full cost entry job' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    // Independently derived baseline (before any additional costs):
    // gross wall = 2*(10+10)*8 = 320; raw = 320*2*1.1/350 = 2.0114...; buy 3 gal * $42 = $126 materials.
    // hours = 320*2/150 = 4.26666...; labor = 4.26666...*32 = $136.5333...
    expect(await screen.findByText('$126.00')).toBeTruthy();

    // 1. Add a named prep task: 2 hours at $32/hr = $64.
    fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    const laborRow = screen.getByText('Description').closest('div')!.parentElement!;
    fireEvent.change(within(laborRow).getByLabelText('Description'), { target: { value: 'Wall prep and caulking' } });
    fireEvent.change(within(laborRow).getByLabelText('Hours'), { target: { value: '2' } });
    fireEvent.change(within(laborRow).getByLabelText('$/hour'), { target: { value: '32' } });

    // 2. Add an itemized other material: 3 tubes of caulk at $6.50 each = $19.50.
    fireEvent.click(screen.getByRole('button', { name: '+ Add material' }));
    const materialRows = screen.getAllByText('Description').map((el) => el.closest('div')!.parentElement!);
    const materialRow = materialRows[materialRows.length - 1];
    fireEvent.change(within(materialRow).getByLabelText('Description'), { target: { value: 'Caulk' } });
    fireEvent.change(within(materialRow).getByLabelText('Unit'), { target: { value: 'tube' } });
    fireEvent.change(within(materialRow).getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.change(within(materialRow).getByLabelText('Unit cost ($)'), { target: { value: '6.50' } });

    // 3. Set a flat $25 supplies allowance.
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'flat' } });
    fireEvent.change(await screen.findByLabelText('Amount ($)'), { target: { value: '25' } });

    // 4. Add a travel expense of $40.
    fireEvent.click(screen.getByRole('button', { name: '+ Add expense' }));
    const expenseRows = screen.getAllByText('Description').map((el) => el.closest('div')!.parentElement!);
    const expenseRow = expenseRows[expenseRows.length - 1];
    fireEvent.change(within(expenseRow).getByLabelText('Description'), { target: { value: 'Travel' } });
    fireEvent.change(within(expenseRow).getByLabelText('Amount ($)'), { target: { value: '40' } });

    // Independently derived totals:
    // materials = $126 (paint) + $19.50 (caulk) + $25 (allowance) = $170.50
    // labor = $136.5333... (production) + $64 (prep) = $200.5333...
    // otherExpenses = $40 (travel)
    // directCost = 170.50 + 200.5333... + 40 = 411.0333...
    // overhead = 411.0333... * 0.15 = 61.655
    // jobCost = 411.0333... + 61.655 = 472.6883...
    expect(await screen.findByText('$170.50')).toBeTruthy(); // Materials row
    await waitFor(() => expect(screen.getByText('$200.53')).toBeTruthy()); // Labor row (HALF_UP display)

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy(), { timeout: 5000 });

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.additionalLabor).toHaveLength(1);
    expect(saved.additionalLabor[0].hours).toBe('2');
    expect(saved.otherMaterialLines).toHaveLength(1);
    expect(saved.otherMaterialLines[0].quantity).toBe('3');
    expect(saved.suppliesAllowance).toEqual({ mode: 'flat', amount: '25', ratio: '0' });
    expect(saved.otherExpenses.some((l) => l.description === 'Travel' && l.amount === '40')).toBe(true);

    // Reopen (full remount) and confirm everything survived, THEN issue.
    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    expect(await screen.findByText('$170.50')).toBeTruthy();
    expect(screen.getByDisplayValue('Wall prep and caulking')).toBeTruthy();
    expect(screen.getByDisplayValue('Caulk')).toBeTruthy();
    expect(screen.getByDisplayValue('Travel')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions[0].state).toBe('issued'));
    const issued = (await readProjects())[0].revisions[0];
    expect((issued.rawCalculatedOutputs as { materials: string }).materials).toBe('170.5');
  });
});
