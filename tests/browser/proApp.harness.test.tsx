// @vitest-environment jsdom
// Item 11: an isolated browser-style test harness that renders the REAL
// ProApp component (imported directly — this is normal component testing,
// not a production unlock route; ProGate itself is never modified, bypassed
// in production, or given a test-only flag) against real IndexedDB
// transactions (fake-indexeddb, already polyfilled globally). Every
// interaction below is a real click/typed-input event on real rendered
// DOM, and every assertion reads back either the DOM or actual storage —
// never a hand-constructed "final record" standing in for the workflow.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, writeAll, readAll, readOne, writeProjectWithVersionCheck, STORES } from '../../src/storage/db';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Project } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

const NOW = '2026-01-01T00:00:00.000Z';
function settings(): BusinessSettings {
  return {
    id: 'default-settings', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}

function makeLocalProject(): Project {
  const ids = sequentialIdSource();
  const snapshot = createSnapshot(settings(), [variant()], [], ids, 'catalog-rev-1');
  const revision = createDraftRevision('p1', snapshot, ids);
  return { id: 'p1', title: 'Local title', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
}

async function seed(extra: { projects?: Project[] } = {}) {
  const db = await openAppDb();
  await writeAll(db, [
    { store: STORES.businessSettings, records: [settings()] },
    { store: STORES.paintVariants, records: [variant()] },
  ]);
  // Projects go through the real version-checked write, not a raw
  // writeAll — a raw put's hardcoded `version: 1` is disconnected from
  // the actual global version counter (independent-review R04's fix) and
  // can coincidentally collide with it, masking a real concurrent-edit
  // conflict in tests that simulate "another tab" writing afterward.
  for (const p of extra.projects ?? []) await writeProjectWithVersionCheck(db, p, null);
  db.close();
}

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
}

// Opens, reads, and closes in one shot — leaving connections open across
// assertions was blocking deleteDatabase() in the next test's beforeEach.
async function readProjectsFromStorage(): Promise<Project[]> {
  const db = await openAppDb();
  try {
    return await readAll<Project>(db, STORES.projects);
  } finally {
    db.close();
  }
}
async function readProjectFromStorage(id: string): Promise<Project | undefined> {
  const db = await openAppDb();
  try {
    return await readOne<Project>(db, STORES.projects, id);
  } finally {
    db.close();
  }
}

describe('ProApp harness: new project -> add room -> save -> reload persists (real UI, real storage)', () => {
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    await seed();
  });
  afterEach(() => cleanup());

  it('creates a project via the real "+ New project" button, renames it, adds a room, saves, and the same data survives a full unmount/remount', async () => {
    const { unmount } = render(<ProApp />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    const titleInput = await screen.findByLabelText('Project title');
    fireEvent.change(titleInput, { target: { value: 'Kitchen repaint' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    const roomNameInput = await screen.findByLabelText('Room name');
    fireEvent.change(roomNameInput, { target: { value: 'Kitchen' } });
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '8' } });

    const saveButton = await screen.findByRole('button', { name: 'Save draft' });
    fireEvent.click(saveButton);
    await waitFor(async () => {
      const projects = await readProjectsFromStorage();
      expect(projects).toHaveLength(1);
    });

    const savedProjects = await readProjectsFromStorage();
    // PRO-BUG-001 fix: saveDraft() now copies the revision's title onto
    // the project's own top-level title too (previously only the revision
    // got it, leaving the project-list row permanently stuck on "New
    // project" no matter what was typed) — verified against the real
    // saveDraft() implementation, not assumed.
    expect(savedProjects[0].revisions[0].title).toBe('Kitchen repaint');
    expect(savedProjects[0].title).toBe('Kitchen repaint');
    expect(savedProjects[0].revisions[0].rooms[0].name).toBe('Kitchen');

    // Full remount — a fresh component instance re-reading from storage,
    // not the same in-memory React state.
    unmount();
    render(<ProApp />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: /^Kitchen repaint/ })); // the project-list entry, not the "+ New project" creation button
    expect(await screen.findByDisplayValue('Kitchen repaint')).toBeTruthy();
    expect(await screen.findByDisplayValue('Kitchen')).toBeTruthy();
  });
});

describe('ProApp harness: backup import conflict UI — the real Confirm/Cancel/Keep-local/Use-imported/Keep-both actions', () => {
  let localProject: Project;

  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    localProject = makeLocalProject();
    await seed({ projects: [localProject] });
  });
  afterEach(() => cleanup());

  function makeBackupFile(title: string): File {
    const envelope = {
      schemaVersion: 2, exportId: 'export-1', exportedAt: NOW, installationId: 'other-install', engineVersion: '2.1.0',
      businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [],
      projects: [{ ...localProject, title }], importProvenance: [],
    };
    return new File([JSON.stringify(envelope)], 'backup.json', { type: 'application/json' });
  }

  async function goToBackupTabAndSelectFile(file: File) {
    fireEvent.click(screen.getByRole('button', { name: 'Backup & Data' }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
  }

  it('Cancel writes nothing — the real button click leaves storage completely untouched', async () => {
    render(<ProApp />);
    await waitForLoaded();
    await goToBackupTabAndSelectFile(makeBackupFile('Imported title'));

    expect(await screen.findByText(/Import preview/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByText(/Import preview/i)).toBeNull());
    const after = await readProjectFromStorage('p1');
    expect(after!.title).toBe('Local title'); // completely untouched
  });

  it('choosing "Use imported" then clicking the real Confirm button commits the change to actual storage', async () => {
    render(<ProApp />);
    await waitForLoaded();
    await goToBackupTabAndSelectFile(makeBackupFile('Imported title'));

    const preview = await screen.findByText(/Import preview/i);
    const conflictPanel = preview.closest('div')!.parentElement as HTMLElement;
    const useImportedRadio = within(conflictPanel).getByRole('radio', { name: /Use imported/i });
    fireEvent.click(useImportedRadio);
    fireEvent.click(within(conflictPanel).getByRole('button', { name: /Confirm import/i }));

    await waitFor(async () => {
      const after = await readProjectFromStorage('p1');
      expect(after!.title).toBe('Imported title');
    });
  });

  it('choosing "Keep both" then Confirm creates a genuinely NEW project alongside the untouched original', async () => {
    render(<ProApp />);
    await waitForLoaded();
    await goToBackupTabAndSelectFile(makeBackupFile('Imported title'));

    const preview = await screen.findByText(/Import preview/i);
    const conflictPanel = preview.closest('div')!.parentElement as HTMLElement;
    const keepBothRadio = within(conflictPanel).getByRole('radio', { name: /Keep both/i });
    fireEvent.click(keepBothRadio);
    fireEvent.click(within(conflictPanel).getByRole('button', { name: /Confirm import/i }));

    await waitFor(async () => {
      const projects = await readProjectsFromStorage();
      expect(projects).toHaveLength(2);
    });
    const projects = await readProjectsFromStorage();
    expect(projects.find((p) => p.id === 'p1')!.title).toBe('Local title'); // original untouched
    expect(projects.some((p) => p.id !== 'p1' && p.title === 'Imported title')).toBe(true); // a real new copy
  });

  it('the default "Keep local" resolution, left unchanged, preserves the local project on Confirm', async () => {
    render(<ProApp />);
    await waitForLoaded();
    await goToBackupTabAndSelectFile(makeBackupFile('Imported title'));

    const preview = await screen.findByText(/Import preview/i);
    const conflictPanel = preview.closest('div')!.parentElement as HTMLElement;
    // Deliberately do NOT touch any radio button — "keep local" is the required default.
    fireEvent.click(within(conflictPanel).getByRole('button', { name: /Confirm import/i }));

    await waitFor(() => expect(screen.queryByText(/Import preview/i)).toBeNull());
    const after = await readProjectFromStorage('p1');
    expect(after!.title).toBe('Local title');
  });
});

describe('ProApp harness: the two-tab save conflict — real "Reload latest" and "Save my edit as a copy" actions', () => {
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    await seed({ projects: [makeLocalProject()] });
  });
  afterEach(() => cleanup());

  async function openProjectAndCompleteRoom() {
    fireEvent.click(screen.getByRole('button', { name: /^Local title/ }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Add room' }));
    fireEvent.change(await screen.findByLabelText('Room name'), { target: { value: 'Kitchen' } });
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '8' } });
    return screen.findByRole('button', { name: 'Save draft' });
  }

  it('"Reload latest" discards the local edit and adopts the version another tab actually saved', async () => {
    render(<ProApp />);
    await waitForLoaded();
    const saveButton = await openProjectAndCompleteRoom();

    // A concurrent "other tab" saves a real, different edit to the SAME project first.
    const current = (await readProjectFromStorage('p1'))!;
    const otherTabsEdit = { ...current, revisions: [{ ...current.revisions[0], title: 'Edited in another tab' }] };
    const db = await openAppDb();
    await writeProjectWithVersionCheck(db, otherTabsEdit, current.version);
    db.close();

    // This tab's save now conflicts.
    fireEvent.click(saveButton);
    expect(await screen.findByText(/changed elsewhere before your save landed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    await waitFor(() => expect(screen.queryByText(/changed elsewhere/i)).toBeNull());
    // The OTHER tab's edit is what's now shown — this tab's own room addition was discarded.
    expect(await screen.findByDisplayValue('Edited in another tab')).toBeTruthy();
    const after = await readProjectFromStorage('p1');
    expect(after!.revisions[0].title).toBe('Edited in another tab');
    expect(after!.revisions[0].rooms).toHaveLength(0); // this tab's Kitchen room never landed
  });

  it('"Save my edit as a copy" preserves BOTH the other tab\'s save and this tab\'s conflicting edit, as two separate projects', async () => {
    render(<ProApp />);
    await waitForLoaded();
    const saveButton = await openProjectAndCompleteRoom();

    const current = (await readProjectFromStorage('p1'))!;
    const otherTabsEdit = { ...current, revisions: [{ ...current.revisions[0], title: 'Edited in another tab' }] };
    const db = await openAppDb();
    await writeProjectWithVersionCheck(db, otherTabsEdit, current.version);
    db.close();

    fireEvent.click(saveButton);
    expect(await screen.findByText(/changed elsewhere before your save landed/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save my edit as a copy' }));
    await waitFor(async () => {
      const projects = await readProjectsFromStorage();
      expect(projects).toHaveLength(2);
    });

    const projects = await readProjectsFromStorage();
    const original = projects.find((p) => p.id === 'p1')!;
    const copy = projects.find((p) => p.id !== 'p1')!;
    expect(original.revisions[0].title).toBe('Edited in another tab'); // the other tab's save, untouched
    expect(copy.revisions[0].rooms[0].name).toBe('Kitchen'); // this tab's own edit, preserved as a new project
  });
});
