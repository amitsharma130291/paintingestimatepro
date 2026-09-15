// @vitest-environment jsdom
// LIFE-014: deleting a project is destructive (removes its entire own
// history) and must never happen from a single click. It also must never
// touch any OTHER project's records -- Project embeds its own revisions/
// actualReviews (entities.ts), so a single-document IndexedDB delete is
// atomic and project-scoped by construction; this test exercises the real
// UI's confirmation gate plus the actual storage effect end-to-end.
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

async function createProjectNamed(title: string) {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '← Back to projects' }));
}

describe('LIFE-014: deleting a project requires explicit confirmation and is atomic/scoped to that project', () => {
  it('clicking Delete alone does not remove the project -- a second, explicit confirmation is required', async () => {
    await createProjectNamed('Job to keep for now');
    await screen.findByText(/^New project/); // list row still shows "New project" per the project-level title convention

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/cannot be undone/i)).toBeTruthy();

    // The project must still exist -- only the confirmation prompt appeared.
    expect((await readProjects())).toHaveLength(1);
  });

  it('clicking Cancel on the confirmation prompt leaves the project untouched', async () => {
    await createProjectNamed('Job to keep');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/cannot be undone/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
    expect((await readProjects())).toHaveLength(1);
  });

  it('confirming delete removes exactly that project from storage and the list, leaving another project untouched', async () => {
    await createProjectNamed('Job A');
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Job B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '← Back to projects' }));

    const before = await readProjects();
    expect(before).toHaveLength(2);
    const [keepId, deleteId] = [before[0].id, before[1].id];

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButtons[1]);
    await screen.findByText(/cannot be undone/i);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete permanently' }));

    await waitFor(async () => expect((await readProjects())).toHaveLength(1));
    const after = await readProjects();
    expect(after[0].id).toBe(keepId);
    expect(after.some((p) => p.id === deleteId)).toBe(false);
  });

  it('deleting the only project leaves the list in its correct empty state', async () => {
    await createProjectNamed('Job to delete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, delete permanently' }));

    await waitFor(() => expect(screen.getByText('No projects yet.')).toBeTruthy());
    expect((await readProjects())).toHaveLength(0);
  });
});
