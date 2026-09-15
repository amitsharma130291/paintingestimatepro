// @vitest-environment jsdom
// CAT-008: the real "Check for default updates" flow through the Price
// Book Health UI -- preview, per-field opt-in, Confirm/Cancel, and
// confirmation that only the checked field(s) actually change.
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
    await db.put(STORES.paintVariants, { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '40', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW });
  } finally {
    db.close();
  }
});
afterEach(() => cleanup());

async function mountWithCustomizedWallService() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
  fireEvent.click(screen.getByRole('button', { name: '+ wall service' }));
  fireEvent.change(await screen.findByLabelText('Paint variant'), { target: { value: 'paint-1' } });
  fireEvent.change(screen.getByLabelText('Throughput sqft/hr/coat (blank = default)'), { target: { value: '140' } });
}

describe('CAT-008: service default-refresh preview and confirmation', () => {
  it('a service with no customizations reports nothing to refresh', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
    fireEvent.click(screen.getByRole('button', { name: '+ wall service' }));
    fireEvent.change(await screen.findByLabelText('Paint variant'), { target: { value: 'paint-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Check for default updates' }));
    expect(await screen.findByText(/no customized assumptions to review/i)).toBeTruthy();
  });

  it('shows a customized throughput with old/new values and requires an explicit checkbox before Confirm is enabled', async () => {
    await mountWithCustomizedWallService();
    fireEvent.click(screen.getByRole('button', { name: 'Check for default updates' }));

    expect(await screen.findByText(/update production rate to current default/i)).toBeTruthy();
    expect(screen.getByText('(140 → 150)')).toBeTruthy();
    const confirmButton = screen.getByRole('button', { name: 'Confirm updates' }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it('Cancel discards the preview without changing anything', async () => {
    await mountWithCustomizedWallService();
    fireEvent.click(screen.getByRole('button', { name: 'Check for default updates' }));
    await screen.findByText(/update production rate to current default/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/update production rate to current default/i)).toBeNull();
    expect((screen.getByLabelText('Throughput sqft/hr/coat (blank = default)') as HTMLInputElement).value).toBe('140');
  });

  it('checking the field and confirming reverts it to blank (resumes live-default tracking)', async () => {
    await mountWithCustomizedWallService();
    fireEvent.click(screen.getByRole('button', { name: 'Check for default updates' }));
    await screen.findByText(/update production rate to current default/i);

    fireEvent.click(screen.getByRole('checkbox', { name: /update production rate to current default/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm updates' }));

    await waitFor(() => expect(screen.queryByText(/update production rate to current default/i)).toBeNull());
    expect((screen.getByLabelText('Throughput sqft/hr/coat (blank = default)') as HTMLInputElement).value).toBe('');
  });

  it('flags a paint variant no longer in the catalog and points at the existing selector rather than offering a separate retain/replace UI', async () => {
    // The paint catalog UI has no remove-variant action at all -- a
    // dangling paintVariantId is only reachable via a restored backup
    // whose catalog no longer includes it (or a pre-existing local
    // record from before a variant was removed some other way). Seed
    // that state directly in storage, matching how a real such record
    // would already exist on disk before this page ever mounts.
    const db = await openAppDb();
    try {
      await db.put(STORES.serviceDefinitions, {
        id: 'svc-1', name: 'Wall service', unit: 'ft2', kind: 'wall', paintVariantId: 'deleted-variant', coats: null, wasteRatio: null,
        loadedHourlyRate: null, throughput: '140', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
        paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: null,
        createdAt: NOW, updatedAt: NOW,
      });
    } finally {
      db.close();
    }
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Check for default updates' }));
    expect(await screen.findByText(/paint variant no longer exists in your catalog/i)).toBeTruthy();
  });
});
