// @vitest-environment jsdom
// Required deliverable: the complete Pro estimate lifecycle, driven
// through the REAL mounted ProApp end to end in one continuous session --
// proving these features chain together correctly, not just that each
// passes in isolation. Import/restore-as-copy is deliberately NOT
// re-exercised here via a simulated file upload: it is already covered
// end-to-end at the domain level (tests/domain/backup.test.ts) and the UI
// wiring to that same domain code is separately confirmed (BACK-008's
// matrix entry) -- re-simulating a <input type="file"> change event here
// would add fragility without new coverage.
//
// Chain: new project -> configure a room + a standalone surface -> save
// draft -> issue -> edit the issued revision (creates revision 2) ->
// reorder rooms on the new draft -> preview and confirm a rate refresh ->
// undo that refresh -> record a partial actual-cost review -> export a
// backup (download triggered, no errors) -- each step's real effect is
// asserted before moving to the next.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('Complete Pro estimate lifecycle (one continuous session)', () => {
  it('project setup -> save -> issue -> edit -> reorder -> refresh -> undo -> actuals -> export, each step\'s effect verified before the next', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() });

    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());

    // 1. New project with a room (two surfaces via wall+ceiling) and a standalone trim surface.
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Lifecycle test job' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' })); // a second room, used later for reordering
    const roomNames = screen.getAllByLabelText('Room name') as HTMLInputElement[];
    fireEvent.change(roomNames[0], { target: { value: 'Bedroom' } });
    fireEvent.change(roomNames[1], { target: { value: 'Kitchen' } });
    const dims = screen.getAllByLabelText(/Length \(ft\)|Width \(ft\)|Height \(ft\)/);
    fireEvent.change(dims[3], { target: { value: '10' } });
    fireEvent.change(dims[4], { target: { value: '10' } });
    fireEvent.change(dims[5], { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Trim' }));
    fireEvent.change(screen.getByLabelText('Trim length (ft)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Developed width (ft)'), { target: { value: '0.5' } });
    await waitFor(() => expect(screen.getByText('Estimated job cost')).toBeTruthy());

    // 2. Save draft -- verify it actually persisted with 2 rooms + 1 standalone surface.
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
    let stored = (await readProjects())[0];
    expect(stored.revisions[0].rooms).toHaveLength(2);
    expect(stored.revisions[0].surfaces.filter((s) => s.roomId === null)).toHaveLength(1);

    // 3. Issue -- verify state flips and a customer document exists.
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions[0].state).toBe('issued'));
    expect((await readProjects())[0].revisions[0].customerDocumentSnapshot).not.toBeNull();

    // 4. Edit the issued revision -> creates revision 2 as a new draft.
    fireEvent.click(screen.getByRole('button', { name: 'Edit (creates a new draft revision)' }));
    await waitFor(() => expect(screen.getByText(/Revision 2/)).toBeTruthy());

    // 5. Reorder the two rooms on the new draft, then save and verify the new order persisted.
    fireEvent.click(screen.getByRole('button', { name: 'Move Kitchen up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const rev2 = (await readProjects())[0].revisions.find((r) => r.revisionNumber === 2)!;
      expect(rev2.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Bedroom']);
    });

    // 6. Preview and confirm a rate refresh on the new draft. Confirming
    // only updates in-memory state (the UI's own message says "review...
    // then save") -- an explicit Save is required before the DB reflects
    // it, exactly like a real user would do. (v7.2: this previously
    // checked the DB immediately after Confirm, with no intervening save
    // -- a vacuous pass, since `undefined` also satisfies `.not.toBeNull()`;
    // no save had actually happened yet either way. Fixed to genuinely
    // exercise persistence, and to require the checkpoint to be
    // self-consistent with rev2's own id per the v7.2 createDraftFromIssued fix.)
    fireEvent.click(screen.getByRole('button', { name: 'Check for rate updates' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm refresh' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refresh' }));
    expect(screen.getByText(/Rates were refreshed on this draft/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const rev2 = (await readProjects())[0].revisions.find((r) => r.revisionNumber === 2)!;
      expect(rev2.preRefreshCheckpoint).not.toBeNull();
      expect(rev2.preRefreshCheckpoint!.id).toBe(rev2.id); // self-consistent, not a stale reference to a different revision
    });

    // 7. Undo the refresh -- the checkpoint is consumed, restoring the
    // pre-refresh snapshot -- then save so the DB reflects it.
    fireEvent.click(screen.getByRole('button', { name: 'Undo refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => {
      const rev2 = (await readProjects())[0].revisions.find((r) => r.revisionNumber === 2)!;
      expect(rev2.preRefreshCheckpoint).toBeFalsy(); // undo restores the pre-refresh snapshot, which itself carried no checkpoint
    });

    // 8. Issue revision 2, then record a genuine PARTIAL actual-cost review (never fabricating a final one).
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions.find((r) => r.revisionNumber === 2)!.state).toBe('issued'));
    fireEvent.click(screen.getByRole('button', { name: 'Actual Costs' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    expect(screen.getByText(/In progress — 1\/4 categories confirmed/)).toBeTruthy(); // genuinely partial, never a fabricated final result

    // 9. Export a backup -- the download path runs with no error.
    fireEvent.click(screen.getByRole('button', { name: 'Backup & Data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export backup (.json)' }));
    await waitFor(() => expect((URL.createObjectURL as ReturnType<typeof vi.fn>)).toHaveBeenCalled()); // handleExport awaits a fresh storage read first

    vi.unstubAllGlobals();
  });
});
