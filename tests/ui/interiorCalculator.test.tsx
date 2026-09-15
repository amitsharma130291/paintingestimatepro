// @vitest-environment jsdom
// tool-specs/03 explicitly requires: "includeWalls default true; includeCeiling
// default false; at least one enabled" and "Additional prep/cleanup hours>=0
// default0, clearly shown." Source inspection (this session, item 4's
// "missing specified free-tool inputs" pointer) found the shipped free
// interior calculator had NO includeWalls toggle at all (walls were always
// force-enabled) and no prep/cleanup hours input -- two specified inputs
// simply did not exist on the real page. This drives the REAL component,
// not an extracted logic module (none existed for this tool), through
// React Testing Library.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

describe('InteriorCalculator: baseline documented fixture (regression, tool-specs/03)', () => {
  it('20x16x9 room, 2 doors + 3 windows, 2 coats, 350 coverage, .10 waste, $42/gal -> net 563 ft², buy 4 gal, $168', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '42' } });
    expect(rowValue('Net wall area')).toBe('563.00 ft²');
    expect(rowValue('Paint needed')).toBe('4 gal');
    expect(rowValue('Paint cost')).toBe('$168.00');
  });
});

describe('INT-008/009: includeWalls toggle (ceiling-only mode) — previously did not exist, walls were always force-enabled', () => {
  it('defaults to walls included, checkbox present and checked', () => {
    render(<InteriorCalculator />);
    const wallsCheckbox = screen.getByRole('checkbox', { name: /include walls/i });
    expect(wallsCheckbox).toHaveProperty('checked', true);
  });

  it('unchecking walls (ceiling still enabled) computes a real ceiling-only result, no wall area/deduction shown', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /include walls/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /include ceiling/i }));
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '42' } });

    // Independently derived: ceiling = 20*16 = 320 ft²; raw = 320*2*1.10/350
    // = 704/350 = 2.011428571...; ceil -> 3 gallons; paintCost = 3*42 = $126.
    expect(screen.queryByText('Gross wall area')).toBeNull();
    expect(rowValue('Ceiling area')).toBe('320.00 ft²');
    expect(rowValue('Total paintable area')).toBe('320.00 ft²'); // ceiling only, no wall area
    expect(rowValue('Paint needed')).toBe('3 gal');
    expect(rowValue('Paint cost')).toBe('$126.00');
  });

  it('unchecking BOTH walls and ceiling is rejected — "at least one enabled" per tool-specs/03', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /include walls/i }));
    expect(screen.getByText(/enable at least one surface/i)).toBeTruthy();
  });

  it('opening deductions (wall-only concept) are hidden once walls are disabled', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /include ceiling/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /include walls/i }));
    expect(screen.queryByLabelText(/Doors \(20/)).toBeNull();
    expect(screen.queryByLabelText(/Windows \(15/)).toBeNull();
  });
});

describe('INT-014: additional prep/cleanup hours — previously did not exist as a field at all', () => {
  it('is shown only once "Estimate labor" is enabled, defaulting to 0', () => {
    render(<InteriorCalculator />);
    expect(screen.queryByLabelText(/prep.*cleanup hours/i)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    const prepField = screen.getByLabelText(/prep.*cleanup hours/i) as HTMLInputElement;
    expect(prepField.value).toBe('0');
  });

  it('adds directly to labor hours and cost, on top of wall production hours (independently derived)', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Wall sqft/hr/coat'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/prep.*cleanup hours/i), { target: { value: '1.5' } });

    // Independently derived: net wall area 563 ft² (documented fixture).
    // wallHours = 563*2/150 = 7.506666...; + prep 1.5 = 9.006666...
    // -> displayed "9.01" (HALF_UP to 2dp). laborCost = 9.006666...*32 =
    // 288.213333...; -> "$288.21". paintCost (4 gal * $42) = $168.00 exactly.
    // total = 168 + 288.213333... = 456.213333... -> "$456.21".
    expect(rowValue('Labor hours (approx.)')).toBe('9.01');
    expect(rowValue('Labor cost')).toBe('$288.21');
    expect(rowValue('Total')).toBe('$456.21');
  });

  it('a negative prep-hours entry is rejected as invalid, not silently clamped to zero', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Wall sqft/hr/coat'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/prep.*cleanup hours/i), { target: { value: '-1' } });
    expect(screen.getByText(/prep.*cleanup hours must be zero or positive/i)).toBeTruthy();
  });
});
