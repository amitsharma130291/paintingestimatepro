// Reviewer-added RED tests. Assertions describe required behavior, not observed bugs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateBackupEnvelope, planFullRestoreMerge, applyFullRestoreResolutions } from '../../src/domain/backup';
import { checkIssueGate } from '../../src/domain/project';
import { sequentialIdSource } from '../../src/domain/ids';
import { openAppDb, STORES, writeReplaceAllBackup, writeProjectWithVersionCheck } from '../../src/storage/db';
import { envelope, settings, variant, project, service } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => { values.set(k,v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: () => null, get length() { return values.size; } };
}

describe('Independent v4 contract regressions', () => {
  // R01/R02/R14 are payment/domain behavior, explicitly out of scope for
  // this tools-only task ("Exclude payment integration, checkout,
  // licensing, authentication, domains... R01, R02, and R14 concern
  // payment/domain behavior and are outside this task"). Skipped, not
  // deleted, so the reviewer's findings stay visible and attributable;
  // they are not claimed as fixed by this pass. See TOOLS_COMPLETENESS_REPORT.md.
  it.skip('R01: temporary HTTP 503 preserves the payment and reports unavailable without granting access', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'previously-verified', licenseKey: 'PEP-PRO-previously-verified' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Temporarily unavailable' }), { status: 503 })));
    const { checkAccess, getStoredPayment } = await import('../../src/lib/license');
    expect.soft(await checkAccess()).toEqual({ status: 'unavailable' });
    expect(getStoredPayment()).not.toBeNull();
  });

  it.skip('R02: a failed checkout verification retains its session for retry', async () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    sessionStorage.setItem('pep_pending_checkout', JSON.stringify({ sessionId: 'checkout-pending' }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { resolvePendingCheckout } = await import('../../src/lib/license');
    await expect(resolvePendingCheckout()).rejects.toThrow();
    expect(sessionStorage.getItem('pep_pending_checkout')).not.toBeNull();
  });

  it('R03: replace-all leaves exactly the imported business-settings record', async () => {
    const db = await openAppDb();
    try {
      await db.clear(STORES.businessSettings);
      await db.put(STORES.businessSettings, settings());
      const imported = { ...settings(), id: 'z-imported-settings', loadedHourlyRate: '99' };
      await writeReplaceAllBackup(db, { businessSettings: imported, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [], provenance: [] });
      expect(await db.getAll(STORES.businessSettings)).toEqual([imported]);
    } finally { db.close(); }
  });

  it('R04: replacement cannot roll back a project token and let a stale draft overwrite the restored project', async () => {
    const db = await openAppDb();
    try {
      await db.clear(STORES.projects);
      const oldDraft = project();
      await writeProjectWithVersionCheck(db, oldDraft, null);
      const imported = { ...project(), title: 'Restored work', version: 1 };
      await writeReplaceAllBackup(db, { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [imported], provenance: [] });
      await expect(writeProjectWithVersionCheck(db, { ...oldDraft, title: 'Stale tab edit' }, 1)).rejects.toThrow();
    } finally { db.close(); }
  });

  it('R05: keep-both remaps an imported service to its imported paint variant', () => {
    const incoming = envelope([]);
    incoming.paintVariants[0].pricePerGal = '99';
    incoming.serviceDefinitions = [service()];
    const local = { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [] };
    const plan = planFullRestoreMerge(local, incoming);
    const merged = applyFullRestoreResolutions(local, incoming, plan, { 'paintVariant:paint-1': 'keepBoth' }, {}, sequentialIdSource());
    const importedPaint = merged.finalPaintVariants.find(v => v.pricePerGal === '99')!;
    expect(merged.finalServiceDefinitions[0].paintVariantId).toBe(importedPaint.id);
  });

  it('R06: import rejects an unusable frozen customer document', () => {
    const backup = envelope();
    backup.projects[0].revisions[0].state = 'issued';
    // The live renderer dereferences businessInfo.name and scopeLines.map().
    backup.projects[0].revisions[0].customerDocumentSnapshot = {} as never;
    expect(validateBackupEnvelope(backup, JSON.stringify(backup).length).ok).toBe(false);
  });

  it('R07: the zero-price confirmation gate treats 0.00 as zero', () => {
    const revision = project().revisions[0];
    revision.title = 'No-charge work';
    revision.calculationState = 'complete';
    revision.proposedPrice = '0.00';
    revision.surfaces = [{ enabled: true } as never]; // only field read by the gate
    expect(checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false }).canIssue).toBe(false);
  });

  it.skip('R14: purchaser recovery links use the purchased production domain', async () => {
    const { buildRecoveryUrl } = await import('../../src/lib/server/license');
    expect(new URL(buildRecoveryUrl({ paymentId: 'pay_audit' })).hostname).toBe('paintingpricingcalculator.com');
  });
});
