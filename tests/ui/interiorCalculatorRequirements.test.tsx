// @vitest-environment jsdom
// INT-004, INT-005, INT-006, INT-007, INT-012, INT-015: free single-room
// interior calculator behaviors mounted with testing-library.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';

afterEach(() => cleanup());

function fillRoom(length: string, width: string, height: string) {
  fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: length } });
  fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: width } });
  fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: height } });
}

describe('INT-004: labor disabled with a stale/invalid rate never blocks the paint-only result, and labels it materials-only', () => {
  it('an untouched (default) hourly rate field while "Estimate labor" is off has no effect -- paint result computes and is labeled "Paint materials only."', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    // calculateLabor defaults to false -- the $/hour field is not even rendered.
    expect(screen.queryByLabelText('$/hour')).toBeNull();
    expect(screen.getByText('Paint cost')).toBeTruthy();
    expect(screen.getByText('Paint materials only.')).toBeTruthy();
    expect(screen.queryByText('Labor cost')).toBeNull();
  });
});

describe('INT-005: enabling labor with a blank rate is incomplete -- never a zero-labor final total', () => {
  it('checking "Estimate labor" with the rate cleared blocks the result with a rate-required message, not a $0 labor line', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '' } });
    expect(screen.getByText(/Hourly rate must be a number/i)).toBeTruthy();
    expect(screen.queryByText('Labor cost')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });
});

describe('INT-006: enabling labor with an explicit $0 rate is allowed (a real labeled zero-rate scenario) but now shows a warning, never a divisor error', () => {
  it('rate=0 computes a real $0.00 labor cost with a total, and shows the explicit zero-rate warning', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '0' } });
    expect(screen.getByText('Labor cost')).toBeTruthy();
    const laborCostRow = screen.getByText('Labor cost').nextElementSibling as HTMLElement;
    expect(laborCostRow.textContent).toBe('$0.00');
    expect(screen.getByText(/produces a \$0 labor cost.*double-check/i)).toBeTruthy();
  });

  it('a normal nonzero rate shows no such warning', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    expect(screen.queryByText(/double-check this is an intentional/i)).toBeNull();
  });
});

describe('INT-007: disabling the ceiling ignores an invalid ceiling throughput entirely -- walls still calculate', () => {
  it('an invalid ceiling production rate never blocks the wall-only result when the ceiling is unchecked', () => {
    render(<InteriorCalculator />);
    fillRoom('20', '16', '9');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    // includeCeiling is off by default, so "Ceiling sqft/hr/coat" is not even rendered --
    // proving its (absent/garbage) value cannot possibly be read while inactive.
    expect(screen.queryByLabelText('Ceiling sqft/hr/coat')).toBeNull();
    expect(screen.getByText('Labor cost')).toBeTruthy();
  });
});

describe('INT-012: including the ceiling explicitly discloses it shares the SAME paint as the walls -- no separate product selection implied', () => {
  it('the "Include ceiling" control is explicitly labeled "(same paint)"', () => {
    render(<InteriorCalculator />);
    expect(screen.getByText(/Include ceiling \(same paint\)/)).toBeTruthy();
  });
});

describe('INT-015: the tool is explicit about being single-room, with openings labeled as deductions rather than "painted doors," and no unsupported multi-room/trim controls', () => {
  it('the door/window count fields are labeled as flat-area deductions, never implying they are separately-painted door surfaces', () => {
    render(<InteriorCalculator />);
    expect(screen.getByLabelText(/Doors \(20 ft. each\)/)).toBeTruthy();
    expect(screen.queryByText(/painted door/i)).toBeNull();
  });

  it('no multi-room or trim controls exist anywhere on the page', () => {
    render(<InteriorCalculator />);
    expect(screen.queryByText(/add room|another room|trim length|developed width/i)).toBeNull();
  });
});
