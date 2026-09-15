// @vitest-environment jsdom
// DATA_CONTRACT.md #3: "Explicit 'refresh with current rates' on draft
// previews changed rates and resulting price/margin... Confirm before
// applying. Keep a recoverable pre-refresh draft snapshot." Source
// inspection (item 4's "pre-refresh recovery" pointer) found
// applyRateRefresh() itself was already pure/non-destructive, but
// ProApp's confirmRateRefresh() overwrote draftEdit with the refreshed
// result and kept no reference to the pre-refresh draft anywhere -- once
// confirmed, there was no way back except an unsaved page reload (useless
// after the very next save). This drives the REAL ProApp component through
// a real live-catalog price change and refresh/undo cycle.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, writeProjectWithVersionCheck, STORES } from '../../src/storage/db';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Project, Surface } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

const NOW = '2026-01-01T00:00:00.000Z';
function settings(): BusinessSettings {
  return {
    id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function wallSurface(): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
  };
}

beforeEach(async () => {
  await deleteDatabase('painting-estimate-pro');
  const db = await openAppDb();
  const ids = sequentialIdSource();
  const snapshot = createSnapshot(settings(), [variant()], [], ids, 'catalog-rev-1');
  const revision = { ...createDraftRevision('project-A', snapshot, ids), title: 'Job A', surfaces: [wallSurface()] };
  const project: Project = { id: 'project-A', title: 'Job A', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
  await writeProjectWithVersionCheck(db, project, null);
  await db.put(STORES.businessSettings, settings());
  await db.put(STORES.paintVariants, variant());
  db.close();
});
afterEach(() => cleanup());

async function mountAndOpenProject() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Job A/ }));
}

function changeLivePaintPriceTo(newPrice: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Paint catalog' }));
  fireEvent.change(screen.getByLabelText('Price/gal ($)'), { target: { value: newPrice } });
}

describe('Pre-refresh recovery (DATA_CONTRACT.md #3): rate refresh can be undone', () => {
  it('confirming a rate refresh updates the draft cost; "Undo refresh" restores the exact pre-refresh draft', async () => {
    await mountAndOpenProject();
    // Independently derived: raw = 400*2*1.10/350 = 2.514285714...; ceil -> 3 gal; 3*42 = $126.00.
    expect(await screen.findByText('$126.00')).toBeTruthy();

    changeLivePaintPriceTo('49');
    // Switching tabs alone never closes the open project (activeProjectId
    // persists) — no need to reopen "Job A" from the list.
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

    // Still showing the OLD $126 — the live catalog edit alone never touches a saved draft's own snapshot.
    expect(await screen.findByText('$126.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check for rate updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm refresh' }));

    // Independently derived: 3 gal * $49 = $147.00.
    expect(await screen.findByText('$147.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo refresh' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo refresh' }));

    expect(await screen.findByText('$126.00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo refresh' })).toBeNull();
  });

  it('saving over a confirmed refresh clears the undo affordance — the save itself is the new recoverable point', async () => {
    await mountAndOpenProject();
    changeLivePaintPriceTo('49');
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByText('$126.00');
    fireEvent.click(screen.getByRole('button', { name: 'Check for rate updates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm refresh' }));
    expect(screen.getByRole('button', { name: 'Undo refresh' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Undo refresh' })).toBeNull();
  });
});
