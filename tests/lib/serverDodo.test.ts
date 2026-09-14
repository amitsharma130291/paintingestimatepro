// ACCESS-013 regression: verify.ts/redeem.ts/the webhook all accepted ANY
// successful Dodo payment as proof of a Painting Estimate Pro purchase,
// never checking that the payment actually bought the CONFIGURED product.
// A real, successful payment for an unrelated product on the same Dodo
// merchant account (or a different/legacy price) would unlock Pro for
// free. evaluatePaymentEntitlement() is the single shared decision all
// three call sites now use — this file drives it directly with the same
// kind of Payment fixtures a real Dodo response would contain.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PRO_ID = 'prod_pro_configured';

function payment(overrides: Partial<{ status: string; refund_status: string | null; product_cart: { product_id: string; quantity: number }[] | null; payment_id: string }> = {}) {
  return {
    payment_id: 'pay_1',
    status: 'succeeded',
    refund_status: null,
    product_cart: [{ product_id: PRO_ID, quantity: 1 }],
    ...overrides,
  } as never;
}

describe('evaluatePaymentEntitlement — single shared entitlement decision', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
  });

  it('accepts a succeeded payment that purchased the configured Pro product', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment())).toEqual({ ok: true });
  });

  it('REGRESSION: rejects a succeeded payment for an UNRELATED product, even though status is "succeeded"', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    const result = evaluatePaymentEntitlement(payment({ product_cart: [{ product_id: 'prod_totally_different_thing', quantity: 1 }] }));
    expect(result).toEqual({ ok: false, status: 'wrong_product' });
  });

  it('rejects a payment with an empty/missing product_cart rather than assuming it matches', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ product_cart: [] }))).toEqual({ ok: false, status: 'wrong_product' });
    expect(evaluatePaymentEntitlement(payment({ product_cart: null }))).toEqual({ ok: false, status: 'wrong_product' });
  });

  it('rejects a pending payment', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ status: 'pending' }))).toEqual({ ok: false, status: 'pending' });
  });

  it('rejects a failed payment', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ status: 'failed' }))).toEqual({ ok: false, status: 'failed' });
  });

  it('rejects a fully refunded payment even though status is still "succeeded"', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ refund_status: 'full' }))).toEqual({ ok: false, status: 'refunded' });
  });

  it('does NOT reject a partially refunded payment (a merchant policy choice, not an API fact)', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ refund_status: 'partial' }))).toEqual({ ok: true });
  });

  it('a missing/malformed status is treated as unknown, never as success', async () => {
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment({ status: undefined as unknown as string }))).toEqual({ ok: false, status: 'unknown' });
  });

  it('REGRESSION: refuses every payment, even a perfectly valid one, when the Pro product id is not configured at all', async () => {
    vi.unstubAllEnvs(); // no DODO_PRODUCT_ID_PRO set at all
    const { evaluatePaymentEntitlement } = await import('../../src/lib/server/dodo');
    expect(evaluatePaymentEntitlement(payment())).toEqual({ ok: false, status: 'not_configured' });
  });
});
