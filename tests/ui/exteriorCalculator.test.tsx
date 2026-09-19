// @vitest-environment jsdom
// The free exterior calculator reuses the exact same tested primitives as
// the interior calculator (engine/geometry, engine/paint, engine/labor) --
// grossWallArea(length, width, totalHeight) is dimensionally identical
// whether "totalHeight" is one room's wall height or stories x height-per-
// story for a whole building footprint. These tests exist to prove the
// NEW wiring (stories x height-per-story, no ceiling, exterior-specific
// defaults) produces correct results, not to re-verify the underlying
// math those engine functions already have their own test coverage for.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ExteriorCalculator from '../../src/components/tools/ExteriorCalculator';

afterEach(() => cleanup());

function rowValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.nextElementSibling as HTMLElement;
  return dd.textContent ?? '';
}

function fillHouse(length: string, width: string, stories: string, heightPerStory: string) {
  fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: length } });
  fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: width } });
  fireEvent.change(screen.getByLabelText('Stories'), { target: { value: stories } });
  fireEvent.change(screen.getByLabelText('Height per story (ft)'), { target: { value: heightPerStory } });
}

describe('ExteriorCalculator: baseline documented fixture (matches the "Load sample data" button)', () => {
  it('50x30 footprint, 1 story @ 9ft, 3 doors + 8 windows, 2 coats, 300 coverage, .15 waste, $50/gal -> gross 1440, net 1260 ft², buy 10 gal, $500', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '1', '9');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Coverage (sqft/gal, sample)'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Waste %'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '50' } });

    // Independently derived: gross = 2*(50+30)*9 = 1440 ft²; deduction =
    // 3*20 + 8*15 = 180 ft²; net = 1260 ft²; raw = 1260*2*1.15/300 = 9.66
    // gal -> ceil 10 gal; paintCost = 10*50 = $500.00.
    expect(rowValue('Gross wall area')).toBe('1440.00 ft²');
    expect(rowValue('Opening deduction')).toBe('180.00 ft²');
    expect(rowValue('Total paintable area')).toBe('1260.00 ft²');
    expect(rowValue('Paint needed')).toBe('10 gal');
    expect(rowValue('Paint cost')).toBe('$500.00');
  });

  it('the "Load sample data" button reproduces the same fixture', () => {
    render(<ExteriorCalculator />);
    fireEvent.click(screen.getByText(/load sample data/i));
    expect(rowValue('Total paintable area')).toBe('1260.00 ft²');
    expect(rowValue('Paint cost')).toBe('$500.00');
  });
});

describe('Stories x height-per-story multiplies into total wall height', () => {
  it('2 stories @ 9ft/story = 18ft total height, doubling gross area vs. 1 story', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '2', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /deduct doors\/windows/i })); // turn off, isolate story math
    // Independently derived: gross = 2*(50+30)*(2*9) = 2*80*18 = 2880 ft².
    expect(rowValue('Gross wall area')).toBe('2880.00 ft²');
    expect(rowValue('Total paintable area')).toBe('2880.00 ft²');
  });

  it('rejects a non-whole or out-of-range stories value', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '0', '9');
    expect(screen.getByText(/stories must be a whole number from 1 to 10/i)).toBeTruthy();
  });
});

describe('Missing vs. invalid vs. blocked, same trichotomy as the interior calculator', () => {
  it('blank length/width shows guidance, not an error, on first render', () => {
    render(<ExteriorCalculator />);
    expect(screen.getByText(/enter the house's length and width/i)).toBeTruthy();
  });

  it('openings exceeding the gross wall area are blocked with a specific message', () => {
    render(<ExteriorCalculator />);
    fillHouse('10', '10', '1', '8');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '50' } });
    expect(screen.getByText(/openings exceed the exterior wall area/i)).toBeTruthy();
  });

  it('a negative prep-hours entry is rejected as invalid', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '1', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    fireEvent.change(screen.getByLabelText('Prep / power-wash hours'), { target: { value: '-1' } });
    expect(screen.getByText(/prep \/ power-wash hours must be zero or positive/i)).toBeTruthy();
  });
});

describe('Labor estimate: production hours + prep, at the entered rate', () => {
  it('130 sqft/hr/coat, $32/hour, 2 prep hours, on the baseline fixture', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '1', '9');
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Coverage (sqft/gal, sample)'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Waste %'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Siding sqft/hr/coat'), { target: { value: '130' } });
    fireEvent.change(screen.getByLabelText('Prep / power-wash hours'), { target: { value: '2' } });

    // Independently derived: net 1260 ft² (baseline fixture). wallHours =
    // 1260*2/130 = 19.384615...; + prep 2 = 21.384615... -> "21.38".
    // laborCost = 21.384615...*32 = 684.307692... -> "$684.31".
    // paintCost = $500.00 (baseline). total = 500 + 684.307692... =
    // 1184.307692... -> "$1184.31".
    expect(rowValue('Labor hours (approx.)')).toBe('21.38');
    expect(rowValue('Labor cost')).toBe('$684.31');
    expect(rowValue('Total')).toBe('$1184.31');
  });

  it('a $0 hourly rate warns instead of silently producing a $0 labor cost', () => {
    render(<ExteriorCalculator />);
    fillHouse('50', '30', '1', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: /estimate labor/i }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Siding sqft/hr/coat'), { target: { value: '130' } });
    expect(screen.getByText(/an hourly rate of \$0 produces a \$0 labor cost/i)).toBeTruthy();
  });
});
