// Task item 4: the previous session's browser demo only showed an ISSUED
// document staying unchanged while a LIVE summary changed after a catalog
// edit — that does not establish DRAFT isolation, or that an explicit
// refresh/cancel/confirm cycle actually works. This test drives the exact
// 11-step sequence through real storage (fake-indexeddb, real IndexedDB
// transactions — emulator-backed, not a hand-rolled mock) and the real
// domain/engine functions together, for both suggested and custom pricing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import { openAppDb, writeProjectWithVersionCheck, readOne, STORES } from '../../src/storage/db';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, issueRevision, createDraftFromIssued, checkIssueGate } from '../../src/domain/project';
import { previewRateRefresh, applyRateRefresh } from '../../src/domain/rateRefresh';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import type { BusinessSettings, PaintVariant, Surface, Project, EstimateRevision } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function settings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}
function variant(price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function wallSurface(): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
  };
}
function wrapProject(id: string, revision: EstimateRevision, ids: ReturnType<typeof sequentialIdSource>): Project {
  return { id, title: 'Job', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: ids.now(), updatedAt: ids.now() };
}
function buildDoc(revisionLabel: string) {
  return (r: EstimateRevision) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-05', projectAddress: '', revisionLabel });
}

describe.each(['suggested', 'custom'] as const)('Draft vs. issued isolation, 11-step sequence — priceMode=%s', (priceMode) => {
  let db: IDBPDatabase;

  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('draft A at $42 survives a live catalog change to $49; a new draft B sees $49; refresh preview/cancel/confirm behave correctly; issuing A freezes it against a later new draft revision', async () => {
    const ids = sequentialIdSource();
    const customPriceRaw = priceMode === 'custom' ? '900.00' : '';

    // 1. Create draft A using paint price $42.
    const snapshotAt42 = createSnapshot(settings(), [variant('42')], [], ids, 'catalog-rev-1');
    let draftA: EstimateRevision = { ...createDraftRevision('project-A', snapshotAt42, ids), title: 'Job A', surfaces: [wallSurface()], priceMode };
    const summaryA1 = assembleProjectEstimate(draftA, { priceMode, customPriceRaw });
    expect(summaryA1.calculationState).toBe('complete');
    draftA = { ...draftA, proposedPrice: (priceMode === 'custom' ? customPriceRaw : summaryA1.effectivePrice!.toFixed(2)), calculationState: 'complete' };

    // 2. Save it.
    const projectA = wrapProject('project-A', draftA, ids);
    await writeProjectWithVersionCheck(db, projectA, null);

    // 3. Change the live catalog to $49 (the live catalog lives independently of any saved draft's snapshot).
    const liveVariant49 = variant('49');
    const liveSnapshot49 = createSnapshot(settings(), [liveVariant49], [], ids, 'catalog-rev-2');

    // 4. Reopen and reload draft A from storage.
    const reloadedProjectA = await readOne<Project>(db, STORES.projects, 'project-A');
    const reloadedDraftA = reloadedProjectA!.revisions[0];

    // 5. Confirm draft A still uses $42, independent of the live catalog's $49.
    expect(reloadedDraftA.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');
    const summaryAReloaded = assembleProjectEstimate(reloadedDraftA, { priceMode, customPriceRaw });
    expect(summaryAReloaded.aggregate!.purchases[0].cost.toString()).toBe(
      summaryA1.aggregate!.purchases[0].cost.toString()
    ); // identical materials cost to when it was first saved — the live $49 change never touched it

    // 6. Create draft B fresh off the live catalog and confirm it uses $49.
    const draftB: EstimateRevision = { ...createDraftRevision('project-B', liveSnapshot49, ids), title: 'Job B', surfaces: [wallSurface()] };
    expect(draftB.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49');
    const summaryB = assembleProjectEstimate(draftB, { priceMode: 'suggested', customPriceRaw: '' });
    const purchasedGal = summaryB.aggregate!.purchases[0].purchasedGal;
    expect(summaryB.aggregate!.purchases[0].cost.toString()).toBe((purchasedGal * 49).toString());

    // 7. Preview a rate refresh on A, then cancel — A remains completely unchanged (in memory AND in storage).
    const preview = previewRateRefresh(reloadedDraftA, liveSnapshot49);
    expect(preview.variantChanges).toContainEqual(expect.objectContaining({ variantId: 'paint-1', field: 'pricePerGal', oldValue: '42', newValue: '49' }));
    // "Cancel" = discard the preview, never call applyRateRefresh or persist anything.
    const afterCancelReload = await readOne<Project>(db, STORES.projects, 'project-A');
    expect(afterCancelReload!.revisions[0].activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');

    // 8. Confirm the refresh on A — only NOW does A use $49.
    const refreshedA = applyRateRefresh(reloadedDraftA, liveSnapshot49, [], ids);
    expect(refreshedA.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49');
    const summaryARefreshed = assembleProjectEstimate(refreshedA, { priceMode, customPriceRaw });
    expect(summaryARefreshed.aggregate!.purchases[0].cost.toString()).toBe((summaryARefreshed.aggregate!.purchases[0].purchasedGal * 49).toString());
    if (priceMode === 'custom') {
      // Custom price is preserved verbatim through the refresh — only the underlying cost basis changed.
      expect(refreshedA.proposedPrice).toBe(draftA.proposedPrice);
    }
    const projectAAfterRefresh = { ...projectA, revisions: [{ ...refreshedA, proposedPrice: priceMode === 'custom' ? refreshedA.proposedPrice : summaryARefreshed.effectivePrice!.toFixed(2) }] };
    await writeProjectWithVersionCheck(db, projectAAfterRefresh, reloadedProjectA!.updatedAt);

    // 9. Issue A.
    const finalDraftA = projectAAfterRefresh.revisions[0];
    const issueGate = checkIssueGate(finalDraftA, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(issueGate.canIssue).toBe(true);
    const issuedA = issueRevision(finalDraftA, buildDoc('Rev 1'), ids);
    const issuedPriceOnDocument = issuedA.customerDocumentSnapshot!.proposedPrice;
    const projectAIssued: Project = { ...projectAAfterRefresh, revisions: [issuedA], activeRevisionId: issuedA.id };
    await writeProjectWithVersionCheck(db, projectAIssued, projectAAfterRefresh.updatedAt);

    // 10. Edit its scope (add a surface) or rates; create a NEW draft revision from the issued one.
    const reloadedIssued = (await readOne<Project>(db, STORES.projects, 'project-A'))!.revisions[0];
    const issuedSnapshotBeforeEdit = JSON.parse(JSON.stringify(reloadedIssued));
    const newDraftRevision = createDraftFromIssued(reloadedIssued, ids);
    const editedDraft: EstimateRevision = { ...newDraftRevision, surfaces: [...newDraftRevision.surfaces, { ...wallSurface(), id: 'wall-2', areaFt2: '200' }] };
    const summaryEdited = assembleProjectEstimate(editedDraft, { priceMode: 'suggested', customPriceRaw: '' });
    expect(summaryEdited.calculationState).toBe('complete');
    // The new draft's totals differ from the issued baseline (more wall area) — proves it's a live recompute, not a frozen copy.
    expect(summaryEdited.aggregate!.purchases[0].purchasedGal).toBeGreaterThan(summaryARefreshed.aggregate!.purchases[0].purchasedGal);

    const projectWithNewDraft: Project = { ...projectAIssued, revisions: [reloadedIssued, editedDraft] };
    await writeProjectWithVersionCheck(db, projectWithNewDraft, projectAIssued.updatedAt);

    // 11. Confirm the ORIGINAL issued inputs, rates, financial outputs, and customer document are all still unchanged.
    const finalRead = await readOne<Project>(db, STORES.projects, 'project-A');
    const originalIssuedAfterEdit = finalRead!.revisions.find((r) => r.id === issuedA.id)!;
    expect(originalIssuedAfterEdit).toEqual(issuedSnapshotBeforeEdit);
    expect(originalIssuedAfterEdit.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49'); // the rate it was issued under, not live catalog drift
    expect(originalIssuedAfterEdit.surfaces).toHaveLength(1); // scope change on the new draft never touched the issued one
    expect(originalIssuedAfterEdit.customerDocumentSnapshot!.proposedPrice).toBe(issuedPriceOnDocument);
    expect(originalIssuedAfterEdit.customerDocumentSnapshot!.status).toBe('issued');
  });
});
