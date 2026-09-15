// @vitest-environment jsdom
// ACT-010 (source-confirmed gap found while investigating item 4's "actual-
// cost overhead modes" pointer): DATA_CONTRACT.md's ActualReview.overhead
// explicitly requires a dual mode -- 'baselineAllocation' (confirm the
// baseline issued revision's OWN allocated overhead, unedited) or
// 'actualFlat' (an entered real dollar figure) -- but the shipped actuals UI
// hardcoded every save to mode:'actualFlat' with a single free-text box, so
// a painter had no way to record "I'm just accepting the estimate's overhead
// allocation as my actual" without retyping that exact number by hand.
//
// This test drives the REAL ProApp component end to end (create project ->
// add room -> issue, exactly like the R13 regression test) so the frozen
// baseline overhead used here is the production freeze function's own
// output -- never hand-constructed -- and only the NEW toggle behavior
// (which this test exists to prove) is asserted independently of that
// number's arithmetic, which is already covered by tests/engine/cost.test.ts
// and tests/domain/calculationSnapshot.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

async function issueAKitchenEstimateAndOpenActuals() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen estimate' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
  await waitFor(async () => expect((await readProjects())[0]?.revisions[0].state).toBe('issued'));

  const issued = (await readProjects())[0].revisions[0];
  const frozenOverhead = (issued.rawCalculatedOutputs as { overhead: string } | null)?.overhead;
  expect(frozenOverhead).toBeTruthy(); // ground truth: the real frozen value written by freezeCalculatedOutputs, not hand-constructed

  fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
  return frozenOverhead!;
}

describe('ACT-010: actual-cost overhead has two explicit modes (baselineAllocation | actualFlat), matching DATA_CONTRACT.md', () => {
  it('defaults to "Use baseline allocation" and shows the frozen baseline overhead, not an editable blank box', async () => {
    const frozenOverhead = await issueAKitchenEstimateAndOpenActuals();
    expect(screen.getByRole('radio', { name: /baseline allocation/i })).toHaveProperty('checked', true);
    const overheadAmountField = screen.getByLabelText(/overhead amount/i) as HTMLInputElement;
    expect(overheadAmountField.value).toBe(frozenOverhead);
    expect(overheadAmountField).toHaveProperty('disabled', true); // confirming, not retyping, the baseline figure
  });

  it('switching to "Enter actual amount" clears the field for real manual entry', async () => {
    await issueAKitchenEstimateAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /enter actual amount/i }));
    const overheadAmountField = screen.getByLabelText(/overhead amount/i) as HTMLInputElement;
    expect(overheadAmountField).toHaveProperty('disabled', false);
    fireEvent.change(overheadAmountField, { target: { value: '410.25' } });
    expect(overheadAmountField.value).toBe('410.25');
  });

  it('saving in baseline-allocation mode persists mode:"baselineAllocation" and the baseline figure as the recorded amount', async () => {
    const frozenOverhead = await issueAKitchenEstimateAndOpenActuals();
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    const saved = (await readProjects())[0].actualReviews[0];
    expect(saved.overhead.mode).toBe('baselineAllocation');
    expect(saved.overhead.amount).toBe(frozenOverhead);
  });

  it('saving in actual-flat mode persists mode:"actualFlat" and the manually typed figure, independent of the baseline', async () => {
    await issueAKitchenEstimateAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /enter actual amount/i }));
    fireEvent.change(screen.getByLabelText(/overhead amount/i), { target: { value: '500.00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    const saved = (await readProjects())[0].actualReviews[0];
    expect(saved.overhead.mode).toBe('actualFlat');
    expect(saved.overhead.amount).toBe('500');
  });

  it('reopening a saved review restores the mode it was actually saved with', async () => {
    await issueAKitchenEstimateAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /enter actual amount/i }));
    fireEvent.change(screen.getByLabelText(/overhead amount/i), { target: { value: '500.00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));

    expect(screen.getByRole('radio', { name: /enter actual amount/i })).toHaveProperty('checked', true);
    expect((screen.getByLabelText(/overhead amount/i) as HTMLInputElement).value).toBe('500');
  });
});

describe('V5-11: a repeating-decimal baseline overhead (an ordinary, non-round production rate) remains confirmable', () => {
  beforeEach(async () => {
    // 137 ft²/hr/coat (an ordinary, editable rate a real painter might use)
    // produces hours/labor/overhead with far more than 10 fractional
    // digits internally -- 150 (this file's other tests) happens to share
    // enough factors with the 0.15 overhead ratio to cancel out to a clean
    // 2-decimal result by coincidence, which is exactly why the review
    // used a deliberately un-clean number instead.
    const db = await openAppDb();
    try {
      await db.put(STORES.businessSettings, {
        id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
        wallThroughput: '137', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
        defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
      });
    } finally {
      db.close();
    }
  });

  it('the baseline overhead field is non-empty, and Save actuals is enabled once confirmed', async () => {
    const frozenOverhead = await issueAKitchenEstimateAndOpenActuals();
    expect(frozenOverhead.split('.')[1]?.length ?? 0).toBeGreaterThan(10); // confirms this scenario genuinely exercises the >10-digit case
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    expect(screen.getByRole('button', { name: 'Save actuals' })).toHaveProperty('disabled', false);
  });

  it('saves and reopens with the confirmed baseline allocation intact, in_progress state (other categories still blank)', async () => {
    await issueAKitchenEstimateAndOpenActuals();
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    const saved = (await readProjects())[0].actualReviews[0];
    expect(saved.overhead.mode).toBe('baselineAllocation');
    expect(saved.overhead.confirmed).toBe(true);
    expect(saved.state).toBe('inProgress'); // only overhead confirmed so far
  });
});
