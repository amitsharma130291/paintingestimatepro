// @vitest-environment jsdom
// ACT-008, ACT-012, ACT-014, ACT-016: actual-cost review behaviors that
// depend on the real mounted ProApp component and real IndexedDB state.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

async function issueAKitchenEstimate() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen estimate' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  await screen.findByText('$126.00');
  fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
  await waitFor(async () => expect((await readProjects())[0]?.revisions[0].state).toBe('issued'));
}

describe('ACT-008: a missing (null) baseline proposedPrice never computes a review with a coerced $0 baseline -- it shows no review at all', () => {
  it('an issued revision whose proposedPrice was corrupted to null shows no Actual-cost figures, never a $0-baseline review', async () => {
    await issueAKitchenEstimate();
    const db = await openAppDb();
    try {
      const project = (await db.getAll(STORES.projects))[0];
      project.revisions[0].proposedPrice = null; // simulate a corrupted/legacy record
      await db.put(STORES.projects, project);
    } finally {
      db.close();
    }
    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
    expect(screen.queryByText('Actual cost')).toBeNull();
    expect(screen.queryByText(/In progress/)).toBeNull(); // no review computed at all, not even a "0/4" in-progress one
  });
});

describe('ACT-012: editing an already-entered actual amount REPLACES it -- the cost delta reflects only the new value, never the sum of both', () => {
  it('changing materials from 700 to 750 after saving updates the saved amount to exactly "750", not "700750" or a summed value', async () => {
    await issueAKitchenEstimate();
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    const materialsInputs = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(materialsInputs[0], { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    expect((await readProjects())[0].actualReviews[0].materials.amount).toBe('700');

    fireEvent.change(materialsInputs[0], { target: { value: '750' } });
    expect((materialsInputs[0] as HTMLInputElement).value).toBe('750'); // the input holds ONLY the new value
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews[0].materials.amount).toBe('750'));
  });
});

describe('ACT-014: issuing a NEW revision later never auto-rebases an existing actual review\'s baseline -- it keeps pointing at the original issued revision', () => {
  it('the original ActualReview.baselineIssuedRevisionId is unchanged after a second revision is issued', async () => {
    await issueAKitchenEstimate();
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    const originalIssuedRevisionId = (await readProjects())[0].revisions.find((r) => r.state === 'issued')!.id;
    expect((await readProjects())[0].actualReviews[0].baselineIssuedRevisionId).toBe(originalIssuedRevisionId);

    // Edit the issued revision (creates a new draft) and issue it again --
    // per DATA_CONTRACT.md "only explicit issue supersedes the previous
    // issued revision," the FIRST revision transitions to 'superseded' (it
    // is never deleted), and the new one becomes the sole 'issued' revision.
    fireEvent.click(screen.getByRole('button', { name: 'Projects' })); // back to the project detail view (the Edit button lives there, not on the Actual review tab)
    fireEvent.click(screen.getByRole('button', { name: 'Edit (creates a new draft revision)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions.find((r) => r.id === originalIssuedRevisionId)?.state).toBe('superseded'));

    const finalProject = (await readProjects())[0];
    const newIssuedRevision = finalProject.revisions.find((r) => r.state === 'issued')!;
    expect(newIssuedRevision.id).not.toBe(originalIssuedRevisionId); // a genuinely different, second issued revision
    // The original review must still point at the FIRST (now superseded) issued revision, never silently rewritten to the second.
    expect(finalProject.actualReviews).toHaveLength(1);
    expect(finalProject.actualReviews[0].baselineIssuedRevisionId).toBe(originalIssuedRevisionId);
    expect(finalProject.actualReviews[0].baselineIssuedRevisionId).not.toBe(newIssuedRevision.id);
  });
});

describe('ACT-016: the profit label is explicit that this is against the original quote, never implying cash received or actual revenue', () => {
  it('the rendered label reads exactly "Profit vs. original quote", with no "cash received" or "revenue" wording anywhere on the tab', async () => {
    await issueAKitchenEstimate();
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
    // Every category needs BOTH confirmed=true AND a real amount to count
    // toward finalization (ACT-004/ACT-009) -- overhead alone auto-fills
    // from the baseline allocation; the other three need an explicit amount.
    for (const [i] of ['materials', 'labor', 'otherExpenses'].entries()) {
      fireEvent.change(screen.getAllByPlaceholderText('0.00')[i], { target: { value: '100' } });
    }
    for (const cat of ['materials', 'labor', 'otherExpenses', 'overhead']) fireEvent.click(screen.getByRole('checkbox', { name: cat }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    expect(await screen.findByText('Profit vs. original quote')).toBeTruthy();
    expect(screen.queryByText(/cash received/i)).toBeNull();
    expect(screen.queryByText(/actual revenue/i)).toBeNull();
  });
});
