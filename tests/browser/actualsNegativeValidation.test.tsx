// @vitest-environment jsdom
// ACT-015: "Negative actual expense entered -> Invalid; no silent zero/clamp
// and no finalization." Confirms deriveActualCategory's use of
// parseDecimalField (added for independent-review R09/R10, which fixed the
// crash-on-non-numeric-text case) ALSO correctly rejects a negative amount,
// since parseDecimalField defaults to allowNegative:false. No dedicated test
// previously proved this specific case for actuals.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import { issueRevision } from '../../src/domain/project';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { sequentialIdSource } from '../../src/domain/ids';
import { settings, variant, project } from '../audit/fixtures';
import type { Project } from '../../src/domain/entities';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
    await db.put(STORES.businessSettings, settings());
    await db.put(STORES.paintVariants, variant());
  } finally {
    db.close();
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function readProjects(): Promise<Project[]> {
  const db = await openAppDb();
  try {
    return await db.getAll(STORES.projects);
  } finally {
    db.close();
  }
}

async function openActuals() {
  const p = project();
  const issued = issueRevision(
    { ...p.revisions[0], title: 'Audit issued work', proposedPrice: '100', calculationState: 'complete' },
    (r) => buildCustomerDocument(r, { estimateNumber: '1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: '1' }),
    sequentialIdSource()
  );
  p.revisions = [issued];
  p.activeRevisionId = issued.id;
  const db = await openAppDb();
  try {
    await db.put(STORES.projects, p);
  } finally {
    db.close();
  }
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Audit project/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
}

describe('ACT-015: a negative actual expense is invalid, never silently zeroed/clamped, and blocks finalization', () => {
  it('rejects a negative materials amount and disables Save actuals', async () => {
    await openActuals();
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '-50' } });
    expect(screen.getByText(/enter a plain non-negative number/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save actuals' })).toHaveProperty('disabled', true);
  });

  it('never persists a negative amount even if Save were somehow reachable — confirms the value is dropped, not clamped', async () => {
    await openActuals();
    fireEvent.click(screen.getByRole('checkbox', { name: 'materials' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'labor' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'otherExpenses' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'overhead' }));
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '-50' } });
    // The other three categories are validly confirmed-blank; only the
    // negative one is invalid, so this proves invalidity blocks the WHOLE
    // save, not just that one category's contribution.
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await new Promise((r) => setTimeout(r, 50));
    expect((await readProjects())[0].actualReviews).toHaveLength(0);
  });
});
