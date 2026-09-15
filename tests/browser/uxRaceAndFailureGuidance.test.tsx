// @vitest-environment jsdom
// UX-007, UX-008, UX-010: Pro app double-submit/race safety and honest
// storage-failure guidance, mounted against the real component.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import type { Project } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
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

describe('UX-007: rapid repeated "Save draft" clicks never create a duplicate project record', () => {
  it('clicking Save draft twice in quick succession still leaves exactly one project in storage', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen' } });

    const saveButton = screen.getByRole('button', { name: 'Save draft' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton); // fired again before the first async save has settled
    await waitFor(async () => expect((await readProjects()).length).toBeGreaterThan(0));

    // Give any in-flight promise chains a chance to fully settle.
    await new Promise((r) => setTimeout(r, 50));
    expect((await readProjects())).toHaveLength(1); // never two project records from the two clicks
  });
});

describe('UX-008: a slower in-flight save can never overwrite input the user typed after clicking Save', () => {
  it('typing a new title immediately after clicking Save draft (before the save resolves) is never reverted once the save completes', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    const titleField = await screen.findByLabelText('Project title') as HTMLInputElement;
    fireEvent.change(titleField, { target: { value: 'First title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); // starts an async save capturing "First title"
    fireEvent.change(titleField, { target: { value: 'Second title, typed while saving' } }); // user keeps typing immediately after

    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
    // The field must still show what the user just typed -- never reverted
    // to "First title" by the save request that started before it.
    expect((screen.getByLabelText('Project title') as HTMLInputElement).value).toBe('Second title, typed while saving');
  });
});

describe('UX-010: a storage save failure gives actionable export guidance, never just a bare error', () => {
  it('a generic (non-conflict) save failure shows both the honest failure message and explicit export-backup guidance', async () => {
    const proStore = await import('../../src/components/tools/pro/proStore');
    const spy = vi.spyOn(proStore, 'saveProjectSafely').mockRejectedValueOnce(new Error('simulated IndexedDB failure'));

    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Save failed — your previous data was not changed.')).toBeTruthy();
    expect(screen.getByText(/Export backup \(\.json\)/i)).toBeTruthy();
    expect(screen.getByText(/avoid losing this session's changes/i)).toBeTruthy();

    spy.mockRestore();
  });
});
