// @vitest-environment jsdom
// HEALTH-016: a Price Book Health row's expanded detail view must show
// the full cost breakdown (product/color, coverage, coats, waste,
// geometry, labor, overhead) behind its single "Modeled cost/unit"
// figure -- previously every row only ever showed that one aggregate
// number, an editable-inputs section, and price/margin; never the
// itemized components computeServiceUnitCost already calculates.
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

async function mountWithWallService() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
  fireEvent.click(screen.getByRole('button', { name: '+ wall service' }));
  fireEvent.change(await screen.findByLabelText('Paint variant'), { target: { value: 'paint-1' } });
}

describe('HEALTH-016: Price Book Health row detail expand/collapse', () => {
  it('the breakdown is hidden until "Details" is clicked, and shows product/coverage/coats/waste/geometry/labor/overhead', async () => {
    await mountWithWallService();
    expect(screen.queryByText('Product / color')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(await screen.findByText('Product / color')).toBeTruthy();
    expect(screen.getByText('Sample White / white')).toBeTruthy();
    expect(screen.getByText('Coverage')).toBeTruthy();
    expect(screen.getByText('350 ft²/gal')).toBeTruthy();
    expect(screen.getByText('Coats')).toBeTruthy();
    expect(screen.getByText('Waste ratio')).toBeTruthy();
    expect(screen.getByText('10.0%')).toBeTruthy(); // defaultWasteRatio 0.10
    expect(screen.getByText('Geometry')).toBeTruthy();
    expect(screen.getByText('per ft²')).toBeTruthy();
    expect(screen.getByText('Labor hours/unit')).toBeTruthy();
    expect(screen.getByText('Labor cost/unit')).toBeTruthy();
    expect(screen.getByText('Paint consumption cost/unit')).toBeTruthy();
    expect(screen.getByText('Materials/unit')).toBeTruthy();
    expect(screen.getByText('Direct cost/unit')).toBeTruthy();
    expect(screen.getByText('Overhead/unit')).toBeTruthy();
  });

  it('clicking "Hide details" collapses the breakdown again', async () => {
    await mountWithWallService();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    await screen.findByText('Product / color');

    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByText('Product / color')).toBeNull();
  });

  it('a door service\'s geometry line describes width/height/painted sides, not the wall\'s "per ft²"', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
    fireEvent.click(screen.getByRole('button', { name: '+ door service' }));
    fireEvent.change(await screen.findByLabelText('Paint variant'), { target: { value: 'paint-1' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Painted sides'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('3 × 7 ft, 2 side(s), per door')).toBeTruthy();
  });
});
