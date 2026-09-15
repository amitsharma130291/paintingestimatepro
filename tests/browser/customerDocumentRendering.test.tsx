// @vitest-environment jsdom
// DOC-005, DOC-007, DOC-009, DOC-012: customer document rendering
// behaviors that specifically depend on what the real component renders,
// mounted with testing-library rather than only inspecting source.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ProApp from '../../src/components/tools/pro/ProApp';
import { openAppDb, STORES } from '../../src/storage/db';

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

async function buildToPricedDraft() {
  render(<ProApp />);
  await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ New project' }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add room' }));
  for (const [label, value] of [['Length (ft)', '10'], ['Width (ft)', '10'], ['Height (ft)', '8']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  await screen.findByText('$126.00');
}

describe('DOC-005: a confirmed no-charge ($0) issued estimate shows an explicit $0.00 price, never "PRICE PENDING"', () => {
  it('setting a custom $0 price, confirming no-charge, and issuing shows $0.00 on the document -- not a pending placeholder', async () => {
    await buildToPricedDraft();
    fireEvent.change(screen.getByLabelText('Project title'), { target: { value: 'Charity repaint' } }); // checkIssueGate requires a non-blank title
    fireEvent.click(screen.getByRole('button', { name: 'Custom price' }));
    fireEvent.change(screen.getByLabelText('Your price ($)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /intentional \$0 no-charge estimate/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Issue estimate' }));
    await waitFor(() => expect(screen.getByText('Customer-facing document')).toBeTruthy());
    const priceLine = (screen.getByText('Prices exclude taxes; taxes are not calculated by this tool.').previousElementSibling as HTMLElement).textContent;
    expect(priceLine).toBe('$0'); // an explicit, real zero -- not a pending placeholder
    expect(screen.queryByText('PRICE PENDING')).toBeNull();
  });
});

describe('DOC-006: the customer document always shows the fixed pre-tax notice, with no sales-tax figure anywhere on it', () => {
  it('the exact pre-tax disclosure text renders alongside the price', async () => {
    await buildToPricedDraft();
    expect(await screen.findByText('Prices exclude taxes; taxes are not calculated by this tool.')).toBeTruthy();
    expect(screen.queryByText(/sales tax/i)).toBeNull();
  });
});

describe('DOC-007: missing optional logo/business address/customer name render with no broken icon, no "undefined"/"null" text, and no fabricated identity', () => {
  it('a brand-new draft with every optional business/customer field left blank never shows undefined/null anywhere in the document card, and renders no <img> at all', async () => {
    await buildToPricedDraft();
    const doc = (await screen.findByText('Customer-facing document — draft preview')).closest('.card') as HTMLElement;
    expect(doc.textContent).not.toMatch(/\bundefined\b|\bnull\b/);
    expect(doc.querySelector('img')).toBeNull(); // no logo set -- no broken/empty <img> icon rendered
  });
});

describe('DOC-009: script/HTML-looking text in the customer name or notes renders as literal text, never executes or injects markup', () => {
  it('a customer name containing a <script> tag is displayed as plain visible text, with no actual <script> element created', async () => {
    await buildToPricedDraft();
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: '<script>window.__pwned = true</script>Bob' } });
    const doc = (await screen.findByText('Customer-facing document — draft preview')).closest('.card') as HTMLElement;
    expect(doc.querySelector('script')).toBeNull(); // React always escapes text content -- no script element is ever created
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(doc.textContent).toContain('<script>window.__pwned = true</script>Bob'); // shown as literal visible text
  });
});

describe('DOC-012: the customer-facing document container is NOT print:hidden, while surrounding internal editor panels are -- print selects only the customer content', () => {
  it('the document card itself has no print:hidden class, but its own internal-only status label does, and internal editor cards elsewhere do', async () => {
    await buildToPricedDraft();
    const statusLabel = await screen.findByText('Customer-facing document — draft preview');
    const docCard = statusLabel.closest('.card') as HTMLElement;
    expect(docCard.className).not.toMatch(/print:hidden/);
    expect(statusLabel.className).toMatch(/print:hidden/); // the internal "draft preview" status chip itself IS hidden in print
    // A clearly internal-only editing panel elsewhere on the page must be print:hidden.
    const businessCustomerCard = screen.getByText('Business & customer info').closest('.card') as HTMLElement;
    expect(businessCustomerCard.className).toMatch(/print:hidden/);
  });
});
