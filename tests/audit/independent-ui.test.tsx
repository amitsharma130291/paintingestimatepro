// @vitest-environment jsdom
// Reviewer-added RED integration tests against the real component and fake-indexeddb.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES, writeProjectWithVersionCheck } from '../../src/storage/db';
import { issueRevision } from '../../src/domain/project';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { sequentialIdSource } from '../../src/domain/ids';
import { envelope, settings, variant, project, service } from './fixtures';
import type { Project } from '../../src/domain/entities';

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.businessSettings, settings());
    await db.put(STORES.paintVariants, variant());
  } finally { db.close(); }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function readProjects(): Promise<Project[]> {
  const db = await openAppDb();
  try { return await db.getAll(STORES.projects); } finally { db.close(); }
}
async function mount() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
}
async function openActuals() {
  const p = project();
  const issued = issueRevision({ ...p.revisions[0], title: 'Audit issued work', proposedPrice: '100', calculationState: 'complete' }, r => buildCustomerDocument(r, { estimateNumber: '1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: '1' }), sequentialIdSource());
  p.revisions = [issued]; p.activeRevisionId = issued.id;
  const db = await openAppDb();
  try { await db.put(STORES.projects, p); } finally { db.close(); }
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Audit project/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
}

describe('Independent v4 user-workflow regressions', () => {
  it('R08: Price Book Health displays saved service definitions and their selling prices', async () => {
    const db = await openAppDb();
    try { await db.put(STORES.serviceDefinitions, service()); } finally { db.close(); }
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Price Book Health' }));
    expect(screen.queryByText('Custom wall service')).not.toBeNull();
  });

  it('R09: entering nonnumeric actual cost does not crash the application', async () => {
    await openActuals();
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    expect(() => fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: 'abc' } })).not.toThrow();
  });

  it('R10: confirming four blank cost categories must not persist a final review', async () => {
    await openActuals();
    for (const c of screen.getAllByRole('checkbox')) fireEvent.click(c);
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    expect((await readProjects())[0].actualReviews[0].state).toBe('inProgress');
  });

  it('R11: a copied project from version 7 can be edited and saved immediately', async () => {
    const p = project(); p.version = 7;
    const data = envelope([p]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'copies' } });
    const file = new File([JSON.stringify(data)], 'backup.json', { type: 'application/json' });
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
    await screen.findByText(/Import-as-copies preview/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByText(/Import as copies complete/);
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Audit project/ }));
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Saved after copying' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label,value] of [['Length (ft)','10'],['Width (ft)','10'],['Height (ft)','8']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(async () => expect((await readProjects())[0].revisions[0].title).toBe('Saved after copying'));
  });

  it('R12: export includes a project committed by another tab after this tab loaded', async () => {
    await mount();
    const db = await openAppDb();
    try { await writeProjectWithVersionCheck(db, project(), null); } finally { db.close(); }
    let exported: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:audit'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export backup (.json)' }));
    await waitFor(() => expect(exported).toBeDefined());
    expect(JSON.parse(await exported!.text()).projects.map((p: Project) => p.id)).toContain('p1');
  });

  it('R13: issuing a valid estimate persists its calculated outputs', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Kitchen estimate' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label,value] of [['Length (ft)','10'],['Width (ft)','10'],['Height (ft)','8']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0]?.revisions[0].state).toBe('issued'));
    expect((await readProjects())[0].revisions[0].rawCalculatedOutputs).not.toBeNull();
  });
});
