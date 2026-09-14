// Manual unlock path: paste in a license key (from the purchase email) to
// activate on a new device/browser where localStorage never had it. Fully
// self-verifying with no database — the key contains the real Dodo
// payment_id, so redeeming it is just "look that payment up and check it
// actually succeeded."
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDodoClient, evaluatePaymentEntitlement, PRO_PRODUCT, jsonResponse } from '../../../lib/server/dodo';
import { buildLicenseKey, parseLicenseKey } from '../../../lib/server/license';

export const POST: APIRoute = async ({ request }) => {
  let body: { licenseKey?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const parsedKey = parseLicenseKey(body?.licenseKey);
  if (!parsedKey) {
    return jsonResponse({ error: "That doesn't look like a valid license key." }, 400);
  }

  const client = getDodoClient();
  if (!client || !PRO_PRODUCT.id) {
    console.error('Dodo Payments not configured (missing API key or product id).');
    return jsonResponse({ error: "Payments aren't set up yet." }, 500);
  }

  try {
    const payment = await client.payments.retrieve(parsedKey.paymentId);
    // ACCESS-013: the same shared entitlement decision as verify.ts and the
    // webhook — a redeemed key's underlying payment must have actually
    // purchased the configured Pro product, not merely have succeeded.
    const decision = evaluatePaymentEntitlement(payment);
    if (!decision.ok) {
      return jsonResponse({ ok: false, status: decision.status });
    }
    return jsonResponse({ ok: true, paymentId: payment.payment_id, licenseKey: buildLicenseKey(payment.payment_id) });
  } catch (err) {
    console.error('License redeem failed:', err);
    return jsonResponse({ error: "Couldn't verify that license key. Please try again." }, 502);
  }
};
