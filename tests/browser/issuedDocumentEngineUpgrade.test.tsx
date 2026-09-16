// @vitest-environment jsdom
// DOC-011: an issued snapshot created under an earlier engine must print
// with its frozen content/total unchanged after an engine upgrade -- no
// automatic recalculation. ProApp.tsx's previewDocument memo returns the
// stored customerDocumentSnapshot directly whenever one exists, never
// re-deriving it from buildCustomerDocument/assembleProjectEstimate again.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

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

describe('DOC-011: an issued document is frozen and never recomputed, even after the app\'s own engineVersion moves on', () => {
  it('issuing a $126 estimate, then simulating an engine upgrade on the stored revision, still shows the exact original frozen price/title on reopen', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Old-engine kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00'); // sanity: estimated job cost calculates fine before issuing
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(() => expect(screen.getByText('Customer-facing document')).toBeTruthy());
    // Capture the exact frozen proposed price shown on the just-issued document.
    const frozenPrice = (screen.getByText('Prices exclude taxes; taxes are not calculated by this tool.').previousElementSibling as HTMLElement).textContent!;

    // Simulate a future build bumping the revision's own engineVersion
    // field on the already-issued, already-frozen revision.
    const db = await openAppDb();
    try {
      const project = (await db.getAll(STORES.projects))[0];
      project.revisions[0].engineVersion = '99.0.0';
      await db.put(STORES.projects, project);
    } finally {
      db.close();
    }

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    // PRO-BUG-001 fix: issueEstimate() now copies the issued revision's
    // resolved title onto the list-displayed Project.title.
    fireEvent.click(await screen.findByRole('button', { name: /^Old-engine kitchen/ }));

    // Never recalculated, never blocked -- the frozen customer document
    // shows the exact original values, and issued data is never subject to
    // the draft-only engine-version compatibility gate (BACK-026).
    expect(screen.getByText('Customer-facing document')).toBeTruthy();
    const reopenedPrice = (screen.getByText('Prices exclude taxes; taxes are not calculated by this tool.').previousElementSibling as HTMLElement).textContent!;
    expect(reopenedPrice).toBe(frozenPrice);
    expect(screen.queryByText(/does not recognize/i)).toBeNull();
  });
});
