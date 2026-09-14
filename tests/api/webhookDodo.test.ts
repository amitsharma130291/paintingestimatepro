// Same ACCESS-013 product-binding gap, at the webhook.succeeded backstop.
// The webhook's own event.data IS the full Payment object per the SDK's
// own WebhookPayload.Payment type (extends PaymentsAPI.Payment), so the
// same evaluatePaymentEntitlement() decision applies directly to it — no
// extra Dodo API call needed. Driven through the REAL production handler
// (webhooks/dodo.ts's exported POST); only signature verification
// (standardwebhooks) is mocked, since re-deriving a real HMAC signature in
// a test would just reimplement signing rather than exercise anything.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PRO_ID = 'prod_pro_configured';
const mockVerify = vi.fn();

vi.mock('standardwebhooks', () => {
  return {
    Webhook: class MockWebhook {
      verify = mockVerify;
    },
  };
});

const mockSendLicenseEmails = vi.fn(async () => ({ configured: false, customerSent: false, customerError: null, ownerSent: false, ownerError: null }));
vi.mock('../../src/lib/server/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/server/license')>();
  return { ...actual, sendLicenseEmails: mockSendLicenseEmails };
});

function payment(overrides: Partial<{ status: string; refund_status: string | null; product_cart: { product_id: string; quantity: number }[] | null; payment_id: string; customer: { email: string | null; name: string | null } }> = {}) {
  return {
    payment_id: 'pay_1',
    status: 'succeeded',
    refund_status: null,
    product_cart: [{ product_id: PRO_ID, quantity: 1 }],
    customer: { email: 'buyer@example.com', name: 'Buyer' },
    ...overrides,
  };
}

async function getHandler() {
  const mod = await import('../../src/pages/api/webhooks/dodo');
  return mod.POST;
}

function makeContext(eventType: string, data: unknown) {
  const rawBody = JSON.stringify({ type: eventType, data });
  return {
    request: {
      text: async () => rawBody,
      headers: { get: (k: string) => (k === 'webhook-id' ? 'wh_1' : k === 'webhook-signature' ? 'v1,sig' : k === 'webhook-timestamp' ? '123' : null) },
    },
  } as never;
}

describe('POST /api/webhooks/dodo — real handler, mocked signature verification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
    vi.stubEnv('DODO_PAYMENTS_WEBHOOK_KEY', 'whsec_fake');
    mockVerify.mockReset();
    mockVerify.mockResolvedValue(undefined); // signature valid by default
    mockSendLicenseEmails.mockClear();
  });

  it('sends the license email for a payment.succeeded event that purchased the configured Pro product', async () => {
    const POST = await getHandler();
    const res = await POST(makeContext('payment.succeeded', payment()));
    expect(res.status).toBe(200);
    expect(mockSendLicenseEmails).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: a payment.succeeded event for an UNRELATED product must NOT send a Pro license email', async () => {
    const POST = await getHandler();
    const res = await POST(makeContext('payment.succeeded', payment({ product_cart: [{ product_id: 'prod_some_other_thing', quantity: 1 }] })));
    expect(res.status).toBe(200); // still acknowledges the webhook so Dodo doesn't retry forever
    expect(mockSendLicenseEmails).not.toHaveBeenCalled(); // but never emails a working license key for it
  });

  it('does not send an email for a refunded payment (should not normally occur on this event type, but must not fire regardless)', async () => {
    const POST = await getHandler();
    await POST(makeContext('payment.succeeded', payment({ refund_status: 'full' })));
    expect(mockSendLicenseEmails).not.toHaveBeenCalled();
  });

  it('ignores an unrelated event type entirely', async () => {
    const POST = await getHandler();
    const res = await POST(makeContext('payment.failed', payment({ status: 'failed' })));
    expect(res.status).toBe(200);
    expect(mockSendLicenseEmails).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid signature (401), never evaluating entitlement or emailing', async () => {
    mockVerify.mockRejectedValue(new Error('bad signature'));
    const POST = await getHandler();
    const res = await POST(makeContext('payment.succeeded', payment()));
    expect(res.status).toBe(401);
    expect(mockSendLicenseEmails).not.toHaveBeenCalled();
  });

  it('returns 500 when the webhook secret is not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('DODO_PRODUCT_ID_PRO', PRO_ID);
    const POST = await getHandler();
    const res = await POST(makeContext('payment.succeeded', payment()));
    expect(res.status).toBe(500);
  });
});
