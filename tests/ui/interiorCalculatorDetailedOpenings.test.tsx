// @vitest-environment jsdom
// INT-010: the free interior calculator previously only ever offered
// quick doors/windows counts at flat 20/15 ft² each -- there was no way
// to enter a MEASURED opening the way the Pro tool's Room.openingMode
// 'detailed' already supports. This drives the real component through
// quick<->detailed switching, exact geometry, multiple entries, and
// count/dimension validation, mirroring
// tests/browser/detailedOpenings.test.tsx (the Pro-side equivalent).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';

afterEach(() => cleanup());

function rowValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.nextElementSibling as HTMLElement;
  return dd.textContent ?? '';
}

function fillRoom(length: string, width: string, height: string) {
  fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: length } });
  fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: width } });
  fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: height } });
}

function switchToDetailed() {
  fireEvent.change(screen.getByLabelText('Opening entry'), { target: { value: 'detailed' } });
}

describe('INT-010: quick/detailed opening entry mode', () => {
  it('defaults to quick mode with the doors/windows count fields visible', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    expect((screen.getByLabelText('Opening entry') as HTMLSelectElement).value).toBe('quick');
    expect(screen.getByLabelText('Doors (20 ft² each)')).toBeTruthy();
    expect(screen.getByLabelText('Windows (15 ft² each)')).toBeTruthy();
  });

  it('switching to detailed mode replaces the quick fields with measured opening entry UI', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    expect(screen.queryByLabelText('Doors (20 ft² each)')).toBeNull();
    expect(screen.queryByLabelText('Windows (15 ft² each)')).toBeNull();
    expect(screen.getByText('Add at least one measured opening.')).toBeTruthy();
  });

  it('one 3x6.67 door contributes EXACTLY 20.01 ft² of deduction -- exact decimal geometry, not rounded', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(row).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(row).getByLabelText('Count'), { target: { value: '1' } });

    // gross = 2*(20+16)*9 = 648; deduction = 3*6.67*1 = 20.01 EXACTLY; net = 627.99.
    expect(rowValue('Opening deduction')).toBe('20.01 ft²');
    expect(rowValue('Net wall area')).toBe('627.99 ft²');
  });

  it('multiple entries (a door and a window) sum their measured areas', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add window' }));
    const rows = screen.getAllByText('Type').map((el) => el.closest('div')!);
    fireEvent.change(within(rows[0]).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(rows[0]).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(rows[0]).getByLabelText('Count'), { target: { value: '1' } });
    fireEvent.change(within(rows[1]).getByLabelText('Width (ft)'), { target: { value: '2' } });
    fireEvent.change(within(rows[1]).getByLabelText('Height (ft)'), { target: { value: '3' } });
    fireEvent.change(within(rows[1]).getByLabelText('Count'), { target: { value: '2' } });

    // door: 3*6.67*1 = 20.01; window: 2*3*2 = 12; total deduction = 32.01.
    expect(rowValue('Opening deduction')).toBe('32.01 ft²');
    expect(rowValue('Net wall area')).toBe('615.99 ft²'); // 648 - 32.01
  });

  it('removing an entry updates the total deduction', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add window' }));
    const rows = screen.getAllByText('Type').map((el) => el.closest('div')!);
    fireEvent.change(within(rows[0]).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(rows[0]).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(rows[0]).getByLabelText('Count'), { target: { value: '1' } });
    fireEvent.change(within(rows[1]).getByLabelText('Width (ft)'), { target: { value: '2' } });
    fireEvent.change(within(rows[1]).getByLabelText('Height (ft)'), { target: { value: '3' } });
    fireEvent.change(within(rows[1]).getByLabelText('Count'), { target: { value: '2' } });

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }));
    expect(rowValue('Opening deduction')).toBe('20.01 ft²'); // only the door remains
  });

  it('a negative count is rejected as invalid, never silently truncated or coerced', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(row).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(row).getByLabelText('Count'), { target: { value: '-1' } });
    expect(screen.getByText(/count:.*not a whole number/i)).toBeTruthy();
    expect(screen.queryByText('Net wall area')).toBeNull();
  });

  it('a fractional count ("1.9") is rejected, never truncated to 1', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(row).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(row).getByLabelText('Count'), { target: { value: '1.9' } });
    expect(screen.getByText(/count:.*not a whole number/i)).toBeTruthy();
  });

  it('an incomplete measured opening (blank height) reports invalid, never crashes, and blocks the priced result', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '3' } });
    // height left blank
    expect(screen.getByText(/height must be a positive number/i)).toBeTruthy();
  });

  it('an opening area larger than the gross wall area is rejected, matching quick mode\'s own guard', () => {
    render(<InteriorCalculator />);
    fillRoom('5', '5', '8'); // gross = 2*(5+5)*8 = 160
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '20' } });
    fireEvent.change(within(row).getByLabelText('Height (ft)'), { target: { value: '20' } }); // 400 ft², exceeds gross
    fireEvent.change(within(row).getByLabelText('Count'), { target: { value: '1' } });
    expect(screen.getByText(/openings exceed the wall area/i)).toBeTruthy();
  });

  it('switching from detailed back to quick uses ONLY the quick counts -- leftover detailed entries never mix in', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    switchToDetailed();
    fireEvent.click(screen.getByRole('button', { name: '+ Add door' }));
    const row = screen.getByText('Type').closest('div')!;
    fireEvent.change(within(row).getByLabelText('Width (ft)'), { target: { value: '3' } });
    fireEvent.change(within(row).getByLabelText('Height (ft)'), { target: { value: '6.67' } });
    fireEvent.change(within(row).getByLabelText('Count'), { target: { value: '1' } });
    expect(rowValue('Opening deduction')).toBe('20.01 ft²');

    fireEvent.change(screen.getByLabelText('Opening entry'), { target: { value: 'quick' } });
    // Quick counts default to 0/0 -> no deduction at all, NOT the leftover 20.01 from detailed mode.
    expect(rowValue('Opening deduction')).toBe('0.00 ft²');
  });

  it('switching from quick (with counts entered) to detailed ignores the quick counts until a measured opening is added', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '2' } });
    expect(rowValue('Opening deduction')).toBe('40.00 ft²');

    switchToDetailed();
    expect(screen.getByText('Add at least one measured opening.')).toBeTruthy(); // not silently reusing the quick door count
  });
});
