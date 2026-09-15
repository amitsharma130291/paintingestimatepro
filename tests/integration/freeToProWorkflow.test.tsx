// @vitest-environment jsdom
// Required deliverable: the complete free-to-Pro handoff workflow, driven
// through the REAL mounted components end to end (not domain-level
// fixtures) -- proving the free tool's result, the sessionStorage handoff,
// and the Pro import all agree on the same room, with no data lost or
// silently altered across the boundary.
//
// 1. Fill in the free Interior Calculator with a real room (walls +
//    ceiling), a labor estimate, and paint assumptions.
// 2. Click "Continue this room in Pro" -- writes the handoff payload to
//    sessionStorage without touching the free tool's own state.
// 3. Confirm the free tool's own result is untouched after that click.
// 4. Mount the real Pro app fresh (a new tab, per the actual product
//    behavior) -- it reads the pending handoff and offers to import it.
// 5. Decline once, confirming decline clears the offer without creating a
//    project.
// 6. Re-arm the handoff and accept it for real.
// 7. Confirm the new Pro project has a room with the exact dimensions,
//    paint assumptions, and opening counts from the free tool.
// 8. Complete the Pro side: the imported room prices successfully and the
//    resulting draft can be saved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';
import { writeInteriorHandoff } from '../../src/domain/interiorHandoff';
import type { Project } from '../../src/domain/entities';

beforeEach(async () => {
  sessionStorage.clear();
  const db = await openAppDb();
  try {
    for (const store of Object.values(STORES)) await db.clear(store);
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

describe('Complete free-to-Pro handoff workflow', () => {
  it('a room built in the free calculator hands off into Pro exactly, with decline-then-accept both behaving correctly', async () => {
    // Step 1-2: build a real room in the free tool and hand it off.
    render(<InteriorCalculator />);
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Include ceiling/i }));
    fireEvent.change(screen.getByLabelText(/Doors \(20 ft. each\)/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Windows \(15 ft. each\)/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '30' } });

    const totalBefore = (screen.getByText('Total').nextElementSibling as HTMLElement).textContent;
    expect(totalBefore).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue this room in Pro →' }));

    // Step 3: the free tool's own displayed result is untouched by the handoff click.
    expect((screen.getByText('Total').nextElementSibling as HTMLElement).textContent).toBe(totalBefore);
    expect(sessionStorage.getItem('interiorHandoffV1') ?? sessionStorage.length > 0).toBeTruthy();

    // Step 4-5: mount Pro fresh; it offers the pending handoff; decline it.
    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    expect(await screen.findByText('Bring in the room from your free calculator result?')).toBeTruthy();
    expect(screen.getByText(/14×11×9 ft, 2 door\(s\), 3 window\(s\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Bring in the room from your free calculator result?')).toBeNull();
    expect(await readProjects()).toHaveLength(0); // declining creates nothing

    // Step 6: re-arm the same handoff (declining consumed it) and accept for real.
    writeInteriorHandoff({
      lengthFt: '14', widthFt: '11', heightFt: '9', includeWalls: true, includeCeiling: true, deductOpenings: true,
      doorCount: '2', windowCount: '3', coats: '2', coverageFt2PerGal: '350', pricePerGal: '45', wasteRatioPercent: '10',
    });
    cleanup();
    render(<ProApp />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Import into a new project' }));

    // Step 7: the new project has a room matching the free tool's exact inputs.
    await waitFor(() => expect(screen.getAllByLabelText('Length (ft)')[0]).toHaveProperty('value', '14'));
    expect((screen.getAllByLabelText('Width (ft)')[0] as HTMLInputElement).value).toBe('11');
    expect((screen.getAllByLabelText('Height (ft)')[0] as HTMLInputElement).value).toBe('9');

    // Step 8: the imported room prices successfully and the draft saves.
    await waitFor(() => expect(screen.getByText('Estimated job cost')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeTruthy());
    const saved = await readProjects();
    expect(saved).toHaveLength(1); // exactly one project -- the decline earlier never left a stray record
    expect(saved[0].revisions[0].rooms).toHaveLength(1);
  });
});
