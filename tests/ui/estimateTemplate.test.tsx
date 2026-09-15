// @vitest-environment jsdom
// TPL-001, TPL-003, TPL-004, TPL-013, TPL-015, TPL-016, TPL-017: real
// component tests for the free estimate template, mounted with
// testing-library rather than only exercising estimateTemplateLogic.ts in
// isolation -- these requirements are specifically about what the
// component actually renders/blocks.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import EstimateTemplate from '../../src/components/tools/EstimateTemplate';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

function printButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Print \/ Save as PDF/i }) as HTMLButtonElement;
}

describe('TPL-001: a totally untouched new template blocks printing until a described valid row exists', () => {
  it('the print button is disabled on first render, and stays disabled with only default (untouched) rows', () => {
    render(<EstimateTemplate />);
    expect(printButton().disabled).toBe(true);
    expect(screen.getByText(/Add at least one complete line/i)).toBeTruthy();
  });
});

describe('TPL-003: a description with a blank quantity is incomplete, never silently defaulted to 0 or 1', () => {
  it('entering only a description (clearing the default quantity) blocks printing as incomplete, not as a valid $0/x1 line', () => {
    render(<EstimateTemplate />);
    const rows = screen.getAllByRole('row').slice(1); // skip header row
    const firstRow = rows[0];
    fireEvent.change(within(firstRow).getAllByRole('textbox')[0], { target: { value: 'Trim touch-up' } });
    const qtyInput = within(firstRow).getAllByRole('textbox')[1];
    fireEvent.change(qtyInput, { target: { value: '' } }); // blank out the default "1"
    expect(printButton().disabled).toBe(true);
    expect(screen.getByText(/missing a description, quantity, or price/i)).toBeTruthy();
    expect(within(firstRow).getByText('incomplete')).toBeTruthy();
  });
});

describe('TPL-004: quantity/price entered but description blank is an incomplete row -- visible for correction, excluded from the total, and blocks printing', () => {
  it('the row stays in the editable table (never silently deleted) but contributes nothing to the total and blocks printing', () => {
    render(<EstimateTemplate />);
    const rows = screen.getAllByRole('row').slice(1);
    const firstRow = rows[0];
    const [, qtyInput, priceInput] = within(firstRow).getAllByRole('textbox');
    fireEvent.change(qtyInput, { target: { value: '2' } });
    fireEvent.change(priceInput, { target: { value: '10' } });
    // description left blank
    expect(printButton().disabled).toBe(true);
    expect(screen.getByText(/missing a description, quantity, or price/i)).toBeTruthy();
    // "Subtotal" appears in both the live editable summary and the
    // (DOM-present but CSS-hidden) print-only section -- both must agree
    // the incomplete row's 2*10=20 never entered the total.
    const subtotalLabels = screen.getAllByText('Subtotal');
    expect(subtotalLabels.length).toBeGreaterThan(0);
    for (const dt of subtotalLabels) expect((dt.nextElementSibling as HTMLElement).textContent).toBe('$0.00');
    // the row is still rendered (present in the table for the user to fix), not removed
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1);
  });
});

describe('TPL-013: blank business/customer headers print with neutral placeholders, never "undefined"/"null" or a fabricated identity', () => {
  it('leaving both header fields blank shows "Your business" and "Prepared for: ______" in the print-only section', () => {
    const { container } = render(<EstimateTemplate />);
    const printSection = container.querySelector('.print\\:block')!;
    expect(printSection).toBeTruthy();
    expect(within(printSection as HTMLElement).getByText('Your business')).toBeTruthy();
    expect(within(printSection as HTMLElement).getByText(/Prepared for: ______/)).toBeTruthy();
    expect(printSection!.textContent).not.toMatch(/undefined|null/i);
  });
});

describe('TPL-015: two valid rows with the identical description are both counted independently -- no deduplication', () => {
  it('two $10 rows named "Paint" both contribute, giving a $20 total, not $10', () => {
    render(<EstimateTemplate />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add line' }));
    const rows = screen.getAllByRole('row').slice(1);
    for (const row of rows.slice(0, 2)) {
      const [descInput, , priceInput] = within(row).getAllByRole('textbox');
      fireEvent.change(descInput, { target: { value: 'Paint' } });
      fireEvent.change(priceInput, { target: { value: '10' } });
    }
    for (const dt of screen.getAllByText('Subtotal')) expect((dt.nextElementSibling as HTMLElement).textContent).toBe('$20.00');
  });
});

describe('TPL-016: non-ASCII / unit-symbol text in a description is retained legibly, no replacement artifacts', () => {
  it('a description containing ft² and an accented business name render verbatim', () => {
    render(<EstimateTemplate />);
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Café Painters LLC' } });
    const rows = screen.getAllByRole('row').slice(1);
    const [descInput, , priceInput] = within(rows[0]).getAllByRole('textbox');
    fireEvent.change(descInput, { target: { value: 'Touch-up, 120ft² wall' } });
    fireEvent.change(priceInput, { target: { value: '50' } });
    expect(screen.getByDisplayValue('Café Painters LLC')).toBeTruthy();
    expect(screen.getByDisplayValue('Touch-up, 120ft² wall')).toBeTruthy();
  });
});

describe('TPL-017: the free template prints a full, useful document with no Pro/payment entitlement gate anywhere', () => {
  it('a complete, valid estimate can print with no entitlement/upgrade/paywall UI present at all', () => {
    render(<EstimateTemplate />);
    const rows = screen.getAllByRole('row').slice(1);
    const [descInput, , priceInput] = within(rows[0]).getAllByRole('textbox');
    fireEvent.change(descInput, { target: { value: 'Interior painting' } });
    fireEvent.change(priceInput, { target: { value: '500' } });
    expect(printButton().disabled).toBe(false);
    expect(screen.queryByText(/upgrade|pro plan|subscribe|entitlement|payment required/i)).toBeNull();
  });
});
