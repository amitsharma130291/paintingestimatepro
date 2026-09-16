// @vitest-environment jsdom
// Numerical-hardening initiative, section 8: pairwise mode coverage,
// sub-model C (free interior calculator). See
// docs/generate_pairwise_cases.js / tests/pairwise/generated-cases.json /
// PAIRWISE_COVERAGE_REPORT.md.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import generated from './generated-cases.json';

afterEach(() => cleanup());

const WASTE_BAND: Record<string, string> = { zero: '0', normal: '10', highWarn: '60', max: '100' };

type Case = (typeof generated.subModels.C_freeInterior.generatedCases)[number];

describe('PAIRWISE-C: free interior calculator mode-interaction coverage', () => {
  const cases = generated.subModels.C_freeInterior.generatedCases as Case[];

  it.each(cases.map((c, i) => [i, c] as const))('case %i: %o', (_i, c) => {
    render(<InteriorCalculator />);
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Coats'), { target: { value: String(c.coats) } });
    fireEvent.change(screen.getByLabelText('Waste %'), { target: { value: WASTE_BAND[c.wasteBand] } });
    fireEvent.change(screen.getByLabelText('Coverage (sqft/gal, sample)'), { target: { value: '350' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '42' } });

    // includeWalls defaults to true -- uncheck if this case wants it off.
    if (!c.includeWalls) fireEvent.click(screen.getByRole('checkbox', { name: 'Include walls' }));
    // includeCeiling defaults to false -- check if this case wants it on.
    if (c.includeCeiling) fireEvent.click(screen.getByRole('checkbox', { name: 'Include ceiling (same paint)' }));
    if (c.includeWalls) {
      fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '2' } });
      fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '3' } });
      // deductOpenings defaults to true -- uncheck if this case wants it off.
      if (!c.deductOpenings) fireEvent.click(screen.getByRole('checkbox', { name: 'Deduct doors/windows' }));
    }

    // A valid combination always reaches a real, displayed paint cost --
    // never a crash, never a blank/incomplete result.
    expect(screen.getByText('Paint cost')).toBeTruthy();
    const paintCostText = screen.getByText('Paint cost').nextElementSibling!.textContent!;
    expect(paintCostText).toMatch(/^\$\d+\.\d{2}$/);
    const totalText = screen.getByText('Total').nextElementSibling!.textContent!;
    expect(totalText).toMatch(/^\$\d+\.\d{2}$/);
    // No negative or nonsensical total regardless of which mode combination
    // produced it.
    expect(Number(totalText.replace('$', ''))).toBeGreaterThan(0);
  });
});
