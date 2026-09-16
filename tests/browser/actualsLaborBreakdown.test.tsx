// @vitest-environment jsdom
// ACT-011 (DATA_CONTRACT.md): ActualReview.laborBreakdown
// {mode:direct|hoursRate,hours,rate} was defined in the domain model and
// validated on import, but no UI ever exposed the hoursRate mode -- actual
// labor could only ever be entered as one flat dollar amount.
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

async function issueAndOpenActuals() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.change(await screen.findByLabelText('Project title'), { target: { value: 'Labor breakdown job' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
  await waitFor(async () => expect((await readProjects())[0]?.revisions[0].state).toBe('issued'));
  fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));
}

describe('ACT-011: actual labor can be entered as hours × rate, not only a flat amount', () => {
  it('defaults to "Enter amount directly"', async () => {
    await issueAndOpenActuals();
    expect(screen.getByRole('radio', { name: /enter amount directly/i })).toHaveProperty('checked', true);
  });

  it('switching to "Hours × rate" shows hours/rate fields and computes the amount live once confirmed', async () => {
    await issueAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /hours × rate/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'labor' }));
    fireEvent.change(screen.getByLabelText('Labor hours'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Labor rate'), { target: { value: '35' } });
    expect(screen.getByText(/\$350\.00/)).toBeTruthy();
  });

  it('saves labor.amount as hours*rate and persists laborBreakdown', async () => {
    await issueAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /hours × rate/i }));
    fireEvent.change(screen.getByLabelText('Labor hours'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Labor rate'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'labor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));
    const saved = (await readProjects())[0].actualReviews[0];
    expect(saved.labor.amount).toBe('350');
    expect(saved.laborBreakdown).toEqual({ mode: 'hoursRate', hours: '10', rate: '35' });
  });

  it('reopening restores the hoursRate mode and its hours/rate values', async () => {
    await issueAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /hours × rate/i }));
    fireEvent.change(screen.getByLabelText('Labor hours'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Labor rate'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'labor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }));
    await waitFor(async () => expect((await readProjects())[0].actualReviews).toHaveLength(1));

    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Labor breakdown job/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actual review' }));

    expect(screen.getByRole('radio', { name: /hours × rate/i })).toHaveProperty('checked', true);
    expect((screen.getByLabelText('Labor hours') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Labor rate') as HTMLInputElement).value).toBe('35');
  });

  it('an incomplete hours/rate entry (blank rate) never crashes and blocks save', async () => {
    await issueAndOpenActuals();
    fireEvent.click(screen.getByRole('radio', { name: /hours × rate/i }));
    fireEvent.change(screen.getByLabelText('Labor hours'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'labor' }));
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Save actuals' }))).not.toThrow();
  });
});
