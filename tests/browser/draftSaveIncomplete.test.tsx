// @vitest-environment jsdom
// V6-05/CORE-028 extended coverage: "Save draft" must persist a
// work-in-progress estimate no matter how incomplete or locally invalid its
// inputs are -- a partial room, a blank additional-cost line, an incomplete
// allowance, or a malformed numeric field the user hasn't finished
// correcting yet. The independent review's own two cases (unfinished room,
// blank prep task) are in tests/review-v6/tools-workflows.test.tsx unchanged;
// this file extends that same requirement to every other line-item kind and
// exercises reopen/correct/issue and the version-conflict/storage-failure
// paths through the real Save button.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES, writeProjectWithVersionCheck } from '../../src/storage/db';
import type { Project } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await deleteDatabase('painting-estimate-pro');
  const db = await openAppDb();
  try {
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

async function startProject(title: string) {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: title } });
}

function lastRow(labelText: string): HTMLElement {
  const rows = screen.getAllByText(labelText).map((el) => el.closest('div')!.parentElement!);
  return rows[rows.length - 1];
}

async function saveAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
}

describe('V6-05: "Save draft" persists incomplete/invalid work-in-progress input for every line-item kind', () => {
  it('a room with only length filled in still saves, and reopening shows the exact partial field back', async () => {
    await startProject('Partial room job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '12' } });
    // Width/height deliberately left blank.
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.rooms[0].lengthFt).toBe('12');
    expect(saved.rooms[0].widthFt).toBeFalsy(); // never invented -- stays at its blank default, not coerced to a number
    expect(saved.calculationState).not.toBe('complete');

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    // The PROJECT-level list label stays "New project" (set once at
    // creation; saveDraft() never renames it) even though the revision's
    // own title field holds what was typed -- matching the same pattern
    // already used by tests/browser/projectCostEntry.test.tsx.
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    expect((await screen.findByLabelText('Length (ft)') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Width (ft)') as HTMLInputElement).value).toBe('');
  });

  it('a blank additional-labor (prep task) line saves without inventing values', async () => {
    await startProject('Blank labor line job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add task' }));
    // Description/hours/rate all left blank.
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.additionalLabor).toHaveLength(1);
    expect(saved.additionalLabor[0].description).toBe('');
    expect(saved.additionalLabor[0].hours).toBe('');
  });

  it('a blank other-material line saves without inventing a quantity or cost', async () => {
    await startProject('Blank material line job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add material' }));
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.otherMaterialLines).toHaveLength(1);
    expect(saved.otherMaterialLines[0].quantity).toBe('');
    expect(saved.otherMaterialLines[0].unitCost).toBe('');
  });

  it('a blank other-expense line saves without inventing an amount', async () => {
    await startProject('Blank expense line job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add expense' }));
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.otherExpenses).toHaveLength(1);
    expect(saved.otherExpenses[0].amount).toBe('');
  });

  it('an incomplete flat allowance (mode set, amount left blank) saves the mode without inventing an amount', async () => {
    await startProject('Incomplete allowance job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'flat' } });
    fireEvent.change(await screen.findByLabelText('Amount ($)'), { target: { value: '' } }); // explicitly blanked, not just left at its default
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.suppliesAllowance.mode).toBe('flat');
    expect(saved.suppliesAllowance.amount).toBe('');
  });

  it('an invalid raw numeric entry (non-numeric text in a material quantity) is preserved verbatim, not coerced to zero', async () => {
    await startProject('Invalid numeric text job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add material' }));
    const materialRow = lastRow('Description');
    fireEvent.change(within(materialRow).getByLabelText('Quantity'), { target: { value: 'abc' } });
    await saveAndConfirm();

    const saved = (await readProjects())[0].revisions[0];
    expect(saved.otherMaterialLines[0].quantity).toBe('abc'); // preserved for correction, never zeroed
    expect(saved.calculationState).not.toBe('complete');
  });

  it('after reopening a saved incomplete draft, correcting the missing fields lets it fully calculate and issue', async () => {
    await startProject('Correction after reopen job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    await saveAndConfirm();
    expect((await readProjects())[0].revisions[0].calculationState).not.toBe('complete');

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    fireEvent.change(await screen.findByLabelText('Width (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '8' } });

    // Independently derived: gross = 2*(10+10)*8 = 320; raw = 320*2*1.1/350 = 2.0114...; buy 3 gal * $42 = $126.
    expect(await screen.findByText('$126.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions[0].state).toBe('issued'));
  });

  it('a version conflict on save (another tab wrote first) leaves the in-progress incomplete edit on screen and reports the conflict, not a silent data loss', async () => {
    await startProject('Version conflict on incomplete draft job');
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    await saveAndConfirm(); // establishes a real baseline version in storage

    const before = (await readProjects())[0];
    const db = await openAppDb();
    try {
      // Another tab commits first, advancing the stored version past what
      // this tab's in-memory draftBaselineVersion still expects -- exactly
      // the "storage failure" surface saveDraft() must handle without
      // losing the caller's unsaved, still-incomplete edit.
      await writeProjectWithVersionCheck(db, { ...before, title: 'Changed by another tab' }, before.version);
    } finally {
      db.close();
    }

    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText(/changed elsewhere before your save landed/i)).toBeTruthy());

    // The unsaved in-progress edit is still visible on screen -- nothing was lost locally.
    expect((screen.getByLabelText('Length (ft)') as HTMLInputElement).value).toBe('15');
  });
});
