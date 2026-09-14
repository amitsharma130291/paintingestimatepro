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
