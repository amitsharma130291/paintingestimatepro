// @vitest-environment jsdom
// JOB-001, JOB-002, JOB-009, JOB-010, JOB-014, JOB-015: the free job-cost
// calculator's UI-level behaviors, mounted for real with testing-library
// rather than only inspecting jobCostCalculatorLogic.ts in isolation --
// these requirements are specifically about what actually renders.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import JobCostCalculator from '../../src/components/tools/JobCostCalculator';

afterEach(() => cleanup());

function rowValue(label: string): string {
  // "Overhead" is also a plain section label above the mode toggle buttons
  // (not a results row), so disambiguate by tag: only a <dt> is a result row.
  const dt = screen.getAllByText(label).find((el) => el.tagName === 'DT');
  if (!dt) throw new Error(`no <dt> found with text "${label}"`);
  return (dt.nextElementSibling as HTMLElement).textContent ?? '';
}

describe('JOB-001: an untouched page shows guidance, never an apparently-complete $0.00 recommendation', () => {
  it('renders the guidance message and no result rows at all on first render', () => {
    render(<JobCostCalculator />);
    expect(screen.getByText(/Enter materials, labor, and a target margin/i)).toBeTruthy();
    expect(screen.queryByText('Total estimated cost')).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});

describe('JOB-002: explicitly confirming all-zero costs is a real, labeled complete result -- distinct from untouched', () => {
  it('typing 0 into every active field reaches a complete result with $0.00 rows, not the guidance message', () => {
    render(<JobCostCalculator />);
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Overhead %'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Target margin (%)'), { target: { value: '0' } });

    expect(screen.queryByText(/Enter materials, labor, and a target margin/i)).toBeNull();
    expect(screen.getByText('Total estimated cost')).toBeTruthy();
    expect(rowValue('Materials')).toBe('$0.00');
    expect(rowValue('Labor')).toBe('$0.00');
    expect(rowValue('Total estimated cost')).toBe('$0.00');
  });
});

describe('JOB-009/JOB-010: overhead mode switches cleanly between flat $ and % of direct cost, no stale-value blending', () => {
  function setDirectCost200() {
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Target margin (%)'), { target: { value: '35' } });
  }

  it('JOB-009: flat $30 overhead with a stale 15% percent value produces overhead=$30, cost=$230 -- no percentage addition', () => {
    render(<JobCostCalculator />);
    setDirectCost200();
    // overheadPercent defaults to '15' and is never touched -- it must be
    // fully inactive once flat mode is selected.
    fireEvent.click(screen.getByRole('button', { name: 'Flat $' }));
    fireEvent.change(screen.getByLabelText('Overhead ($)'), { target: { value: '30' } });
    expect(rowValue('Direct cost')).toBe('$200.00');
    expect(rowValue('Overhead')).toBe('$30.00');
    expect(rowValue('Total estimated cost')).toBe('$230.00');
  });

  it('JOB-010: switching back to percent mode at 10% produces overhead=$20, and the $30 flat value is ignored', () => {
    render(<JobCostCalculator />);
    setDirectCost200();
    fireEvent.click(screen.getByRole('button', { name: 'Flat $' }));
    fireEvent.change(screen.getByLabelText('Overhead ($)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '% of direct cost' }));
    fireEvent.change(screen.getByLabelText('Overhead %'), { target: { value: '10' } });
    expect(rowValue('Overhead')).toBe('$20.00'); // 10% of 200, NOT the stale $30 flat value
    expect(rowValue('Total estimated cost')).toBe('$220.00');
  });
});

describe('JOB-014: changing an input after a valid result reflects current inputs immediately -- no stale result shown', () => {
  it('raising materials from $100 to $500 updates every dependent row, not just the changed field', () => {
    render(<JobCostCalculator />);
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Target margin (%)'), { target: { value: '35' } });
    expect(rowValue('Materials')).toBe('$100.00');
    const costBefore = rowValue('Total estimated cost');

    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '500' } });
    expect(rowValue('Materials')).toBe('$500.00');
    const costAfter = rowValue('Total estimated cost');
    expect(costAfter).not.toBe(costBefore);
    expect(parseFloat(costAfter.replace('$', ''))).toBeGreaterThan(parseFloat(costBefore.replace('$', '')));
  });
});

describe('JOB-015: result labels are explicit that this is an estimate, not an actual or a market recommendation', () => {
  it('shows the estimated-not-actual / not-a-market-recommendation disclaimer text', () => {
    render(<JobCostCalculator />);
    expect(screen.getByText(/not a market-rate recommendation/i)).toBeTruthy();
    expect(screen.getByText(/Margin is estimated profit divided by price/i)).toBeTruthy();
  });

  it('the suggested-price rows are explicitly labeled as suggested/approximate, not a bare "Price"', () => {
    render(<JobCostCalculator />);
    fireEvent.change(screen.getByLabelText('Materials ($)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Labor ($)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Target margin (%)'), { target: { value: '35' } });
    expect(screen.getByText('Approx. price (nearest cent)')).toBeTruthy();
    expect(screen.getByText('Suggested price (meets target)')).toBeTruthy();
  });
});
