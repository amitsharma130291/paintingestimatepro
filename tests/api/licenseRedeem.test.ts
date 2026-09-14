// Same ACCESS-013 product-binding gap as verify.ts, but for the manual
// license-key redemption path. Driven through the REAL production handler
// (redeem.ts's exported POST); only the Dodo SDK itself is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PRO_ID = 'prod_pro_configured';

const mockRetrievePayment = vi.fn();

vi.mock('dodopayments', () => {
  return {
    default: class MockDodoPayments {
      payments = { retrieve: mockRetrievePayment };
    },
  };
});

function payment(overrides: Partial<{ status: string; refund_status: string | null; product_cart: { product_id: string; quantity: number }[] | null }> = {}) {
  return {
    payment_id: 'pay_1',
    status: 'succeeded',
    refund_status: null,
    product_cart: [{ product_id: PRO_ID, quantity: 1 }],
    ...overrides,
  };
}

async function getHandler() {
  const mod = await import('../../src/pages/api/license/redeem');
  return mod.POST;
}

function makeContext(body: unknown) {
  return { request: { json: async () => body } } as never;
}

describe('POST /api/license/redeem — real handler, mocked Dodo SDK', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test_fake');
    mockRetrievePayment.mockReset();
  });

  it('accepts a well-formed key for a payment that purchased the configured Pro product', async () => {
    mockRetrievePayment.mockResolvedValue(payment());
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.licenseKey).toBe('PEP-PRO-pay_1');
  });

  it('REGRESSION: a well-formed key whose real payment purchased an UNRELATED product must not redeem', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ product_cart: [{ product_id: 'prod_some_other_thing', quantity: 1 }] }));
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe('wrong_product');
  });

  it('rejects a malformed key before ever calling Dodo', async () => {
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'not-a-real-key' }));
    expect(res.status).toBe(400);
    expect(mockRetrievePayment).not.toHaveBeenCalled();
  });

  it('rejects a pending payment', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ status: 'pending' }));
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'pending' });
  });

  it('rejects a refunded payment', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ refund_status: 'full' }));
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'refunded' });
  });

  it('returns 500 with missing configuration, never calling Dodo', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test_fake');
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    expect(res.status).toBe(500);
    expect(mockRetrievePayment).not.toHaveBeenCalled();
  });

  it('returns 502 on a provider failure', async () => {
    mockRetrievePayment.mockRejectedValue(new Error('ECONNRESET'));
    const POST = await getHandler();
    const res = await POST(makeContext({ licenseKey: 'PEP-PRO-pay_1' }));
    expect(res.status).toBe(502);
  });

  it('rejects an invalid JSON body', async () => {
    const POST = await getHandler();
    const res = await POST({ request: { json: async () => { throw new Error('bad json'); } } } as never);
    expect(res.status).toBe(400);
  });
});
