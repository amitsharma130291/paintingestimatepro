// @vitest-environment jsdom
// BACK-026: the real UI surfaces the engine-version compatibility policy
// -- a blocked draft (unrecognized engine version) shows a clear,
// actionable message through the existing invalid-state rendering path,
// and an issued revision from a different (but still displayed) engine
// version shows a purely informational, non-blocking notice in Actual
// review. See docs/ENGINE_VERSION_COMPATIBILITY.md for the full policy.
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

describe('BACK-026: a draft with an unrecognized engine version is blocked, never silently recalculated', () => {
  it('a room with a wall shows the unrecognized-engine-version message instead of a priced result', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00'); // sanity: normally calculates fine

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());

    // Simulate the draft having been created by a future build: bump its
    // stored snapshot's engineVersion directly in storage, then reopen.
    const db = await openAppDb();
    try {
      const projects = await db.getAll(STORES.projects);
      const project = projects[0];
      project.revisions[0].activeRateSnapshot.engineVersion = '99.0.0';
      await db.put(STORES.projects, project);
    } finally {
      db.close();
    }

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));

    expect(await screen.findByText(/99\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/does not recognize|not recognize/i)).toBeTruthy();
    expect(screen.queryByText('$126.00')).toBeNull(); // never silently recalculated
  });
});

describe('BACK-026: an issued revision from a different engine version still displays, with an informational (non-blocking) notice', () => {
  it('Actual review shows the frozen-baseline version notice and still shows the real frozen numbers', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Old engine job' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await screen.findByText('$126.00');
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0].revisions[0].state).toBe('issued'));

    // Simulate the frozen baseline having been produced by a DIFFERENT
    // (here, older) engine version than the one currently running.
    const db = await openAppDb();
    try {
      const project = (await db.getAll(STORES.projects))[0];
      (project.revisions[0].rawCalculatedOutputs as Record<string, unknown>).engineVersion = '1.0.0';
      await db.put(STORES.projects, project);
    } finally {
      db.close();
    }

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Old engine job/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actual Costs' }));

    expect(await screen.findByText(/1\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/preserved exactly as issued/i)).toBeTruthy();
  });
});
