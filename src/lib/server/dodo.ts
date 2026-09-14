import DodoPayments from 'dodopayments';

/**
 * Server-only Dodo Payments client. Never imported from client code — the
 * API key can't live in the browser bundle. One client per warm serverless
 * instance; cheap to construct, but no reason to rebuild it per request.
 */
let cached: DodoPayments | null = null;

export function getDodoClient(): DodoPayments | null {
  const apiKey = import.meta.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cached) {
    cached = new DodoPayments({
      bearerToken: apiKey,
      environment: import.meta.env.DODO_ENVIRONMENT?.trim() === 'live_mode' ? 'live_mode' : 'test_mode',
    });
  }
  return cached;
}

/**
 * Single one-time-payment product — Painting Estimate Pro has exactly one
 * paid tier ($99 lifetime), unlike sibling sites with a cheap+unlimited
 * two-tier model. The product itself is created in the Dodo dashboard, not
 * via API; this only needs its id.
 */
export const PRO_PRODUCT = {
  id: import.meta.env.DODO_PRODUCT_ID_PRO?.trim(),
  label: 'Pro',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type DodoClient = NonNullable<ReturnType<typeof getDodoClient>>;
/** The full Payment shape, inferred from the SDK's own retrieve() return
 * type rather than importing a fragile subpath — matches the pattern
 * already used by license/recover.ts. A webhook's `payment.succeeded`
 * event payload is typed by the SDK as `WebhookPayload.Payment extends
 * PaymentsAPI.Payment`, i.e. the identical shape, so this same type (and
 * the decision function below) covers both call sites. */
export type DodoPayment = Awaited<ReturnType<DodoClient['payments']['retrieve']>>;

export type EntitlementDecision = { ok: true } | { ok: false; status: string };

/**
 * The single, shared answer to "does this payment entitle its holder to
 * Painting Estimate Pro's Pro tier" — used identically by checkout
 * verification, manual license-key redemption, and the payment.succeeded
 * webhook, so a defect fixed in one path can't silently remain in another.
 *
 * A payment succeeding is NOT sufficient on its own: it must also have
 * actually purchased the CONFIGURED Pro product. Dodo's payment_id is
 * merchant-account-scoped, not product-scoped — a real, successful payment
 * for an unrelated product on the same account (or a different price/promo
 * SKU) must never unlock Pro. `PRO_PRODUCT.id` missing entirely is also a
 * hard rejection, never a silent "any product will do" fallback.
 */
export function evaluatePaymentEntitlement(payment: DodoPayment): EntitlementDecision {
  const status = String(payment.status ?? '').toLowerCase();
  if (status !== 'succeeded') return { ok: false, status: status || 'unknown' };
  // Dodo tracks a refund via a SEPARATE field — payment.status stays
  // "succeeded" even after a full refund.
  if (payment.refund_status === 'full') return { ok: false, status: 'refunded' };
  if (!PRO_PRODUCT.id) {
    console.error('evaluatePaymentEntitlement: DODO_PRODUCT_ID_PRO is not configured — refusing to grant access for any payment.');
    return { ok: false, status: 'not_configured' };
  }
  const purchasedProductIds = (payment.product_cart ?? []).map((item) => item.product_id);
  if (!purchasedProductIds.includes(PRO_PRODUCT.id)) {
    console.error(`evaluatePaymentEntitlement: payment ${payment.payment_id} succeeded but did not purchase the configured Pro product (${PRO_PRODUCT.id}); cart: ${JSON.stringify(purchasedProductIds)}.`);
    return { ok: false, status: 'wrong_product' };
  }
  return { ok: true };
}
