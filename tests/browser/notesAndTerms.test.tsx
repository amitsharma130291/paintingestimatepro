// @vitest-environment jsdom
// v7.2 gap found while producing a production-clean customer PDF for
// item 2's exit criteria ("long notes and terms" on the final document):
// EstimateRevision.notes/.terms are part of the data model and ARE
// rendered in the customer document preview
// (`previewDocument.notes`/`.terms` in ProApp.tsx), but the Pro editor
// UI never provided any input for a user to actually SET them -- there
// was no textarea, no button, nothing. A painter had no way to add
// notes or terms to an estimate at all, despite the customer document
// having a dedicated place to show them.
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

describe('v7.2: Notes and Terms have a real editor input, persist, and appear on the customer document', () => {
  it('typing into Notes and Terms updates the live customer-document preview immediately', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    await screen.findByLabelText('Project title');

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Please keep pets in the backyard during the job.' } });
    fireEvent.change(screen.getByLabelText('Terms'), { target: { value: '50% deposit due at start; balance due on completion.' } });

    // getAllByText, not getByText: the same string legitimately appears
    // twice in the DOM -- once as the live <textarea>'s own text content
    // (a real, if easily-forgotten, DOM quirk of <textarea>, unlike
    // <input>), and once in the read-only customer-document preview this
    // test exists to prove updates live.
    await waitFor(() => expect(screen.getAllByText('Please keep pets in the backyard during the job.').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getAllByText('50% deposit due at start; balance due on completion.').length).toBeGreaterThanOrEqual(2));
  });

  it('Notes and Terms survive save and reopen', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    await screen.findByLabelText('Project title');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Two coats on all surfaces unless noted.' } });
    fireEvent.change(screen.getByLabelText('Terms'), { target: { value: 'Valid for 30 days from the date above.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^New project/ }));

    expect((await screen.findByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Two coats on all surfaces unless noted.');
    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('Valid for 30 days from the date above.');
  });

  it('Notes and Terms are frozen into the issued customerDocumentSnapshot', async () => {
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
    fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Job with notes' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
    for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Frozen note text.' } });
    fireEvent.change(screen.getByLabelText('Terms'), { target: { value: 'Frozen terms text.' } });
    await screen.findByText('Suggested price');
    fireEvent.click(screen.getByRole('button', { name: 'Suggested price' }));
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(async () => expect((await readProjects())[0]?.revisions[0].state).toBe('issued'));

    const issued = (await readProjects())[0].revisions[0];
    expect(issued.customerDocumentSnapshot!.notes).toBe('Frozen note text.');
    expect(issued.customerDocumentSnapshot!.terms).toBe('Frozen terms text.');
    expect(screen.getByText('Frozen note text.')).toBeTruthy();
    expect(screen.getByText('Frozen terms text.')).toBeTruthy();
  });
});
