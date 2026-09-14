// ACCESS-013 regression, driven through the REAL production handler
// (verify.ts's exported GET), not a reimplementation of its logic. Only
// the Dodo SDK itself is mocked (the actual network boundary) — every
// other line that runs, including evaluatePaymentEntitlement()'s product
// check, is the real application code.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PRO_ID = 'prod_pro_configured';

const mockRetrievePayment = vi.fn();
const mockRetrieveSession = vi.fn();

vi.mock('dodopayments', () => {
  return {
    default: class MockDodoPayments {
      payments = { retrieve: mockRetrievePayment };
      checkoutSessions = { retrieve: mockRetrieveSession };
    },
  };
});

function payment(overrides: Partial<{ status: string; refund_status: string | null; product_cart: { product_id: string; quantity: number }[] | null; payment_id: string; customer: { email: string | null; name: string | null } }> = {}) {
  return {
    payment_id: 'pay_1',
    status: 'succeeded',
    refund_status: null,
    product_cart: [{ product_id: PRO_ID, quantity: 1 }],
    customer: { email: null, name: null },
    ...overrides,
  };
}

async function getHandler() {
  const mod = await import('../../src/pages/api/checkout/verify');
  return mod.GET;
}

function makeContext(params: Record<string, string>) {
  const url = new URL('https://example.test/api/checkout/verify?' + new URLSearchParams(params).toString());
  return { url } as never;
}

describe('GET /api/checkout/verify — real handler, mocked Dodo SDK', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test_fake');
    mockRetrievePayment.mockReset();
    mockRetrieveSession.mockReset();
  });

  it('grants access for a payment that actually purchased the configured Pro product', async () => {
    mockRetrievePayment.mockResolvedValue(payment());
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.licenseKey).toBe('PEP-PRO-pay_1');
  });

  it('REGRESSION: a real, successful payment for an UNRELATED product must NOT unlock Pro', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ product_cart: [{ product_id: 'prod_some_other_thing', quantity: 1 }] }));
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe('wrong_product');
  });

  it('rejects a checkout session that has not resolved to a payment yet (still pending)', async () => {
    mockRetrieveSession.mockResolvedValue({ payment_id: null, payment_status: 'pending' });
    const GET = await getHandler();
    const res = await GET(makeContext({ sessionId: 'sess_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'pending' });
  });

  it('resolves a session to its payment_id and applies the same product/status checks', async () => {
    mockRetrieveSession.mockResolvedValue({ payment_id: 'pay_1', payment_status: 'succeeded' });
    mockRetrievePayment.mockResolvedValue(payment({ product_cart: [{ product_id: 'prod_some_other_thing', quantity: 1 }] }));
    const GET = await getHandler();
    const res = await GET(makeContext({ sessionId: 'sess_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'wrong_product' });
  });

  it('rejects a failed payment', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ status: 'failed' }));
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'failed' });
  });

  it('rejects a fully refunded payment', async () => {
    mockRetrievePayment.mockResolvedValue(payment({ refund_status: 'full' }));
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    const body = await res.json();
    expect(body).toEqual({ ok: false, status: 'refunded' });
  });

  it('returns a clear 500 when the Pro product id is not configured, rather than silently accepting any payment', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PAYMENTS_API_KEY', 'sk_test_fake');
    mockRetrievePayment.mockResolvedValue(payment());
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    expect(res.status).toBe(500);
    expect(mockRetrievePayment).not.toHaveBeenCalled(); // never even asks Dodo — configuration is checked first
    const body = await res.json();
    expect(body.ok).not.toBe(true);
  });

  it('returns 500 with no API key configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    expect(res.status).toBe(500);
  });

  it('returns 502 on a provider/network failure rather than crashing or granting access', async () => {
    mockRetrievePayment.mockRejectedValue(new Error('ECONNRESET'));
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).not.toBe(true);
  });

  it('returns 400 when neither sessionId nor paymentId is supplied', async () => {
    const GET = await getHandler();
    const res = await GET(makeContext({}));
    expect(res.status).toBe(400);
  });

  it('handles a malformed provider response (missing status field) without throwing, and does not grant access', async () => {
    mockRetrievePayment.mockResolvedValue({ payment_id: 'pay_1', product_cart: [{ product_id: PRO_ID, quantity: 1 }] });
    const GET = await getHandler();
    const res = await GET(makeContext({ paymentId: 'pay_1' }));
    const body = await res.json();
    expect(body.ok).not.toBe(true);
  });
});
