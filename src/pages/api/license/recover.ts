// "Forgot your license key" self-service resend: query Dodo directly for
// succeeded payments on the Pro product, and match by the customer email on
// each payment. No database: Dodo's own records are the lookup.
//
// Deliberately NOT using customers.list({email}) -> payments.list({customer_id})
// — that depends on a hosted checkout actually creating a queryable Customer
// record, which isn't guaranteed. payments.list({product_id}) directly,
// filtered by payment.customer.email and payment.status client-side, only
// depends on fields confirmed present on PaymentListResponse.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDodoClient, PRO_PRODUCT, jsonResponse } from '../../../lib/server/dodo';
import { buildLicenseKey, buildRecoveryUrl, sendLicenseEmails } from '../../../lib/server/license';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 2000; // defensive cap against a runaway iterator, not a real limit at this volume

async function fetchSucceededPayments(client: ReturnType<typeof getDodoClient>, productId: string) {
  const results: Awaited<ReturnType<NonNullable<typeof client>['payments']['retrieve']>>[] = [];
  let count = 0;
  // status can't be combined with product_id in the same list() call — that
  // silently returns zero results. Neither can page_number be passed
  // explicitly (even the default 1 zeroes out otherwise-fine results) —
  // both are real quirks in the API/SDK. Async-iterating the page (the
  // SDK's own pagination) avoids page_number entirely; status is filtered
  // in JS instead.
  for await (const payment of client!.payments.list({ product_id: productId, page_size: 100 })) {
    if (payment.status === 'succeeded') results.push(payment as never);
    count += 1;
    if (count >= MAX_ITEMS) break;
  }
  return results;
}

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const email = String(body?.email || '').trim();
  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  }

  const client = getDodoClient();
  if (!client || !PRO_PRODUCT.id) {
    console.error('Dodo Payments not configured (missing API key or product id).');
    return jsonResponse({ error: "Payments aren't set up yet." }, 500);
  }

  // Always the same generic response regardless of what's found — doesn't
  // confirm or deny whether an email has ever made a purchase.
  const generic = { ok: true, message: "If that email has a completed purchase, we've sent the license key to it." };
  const target = email.toLowerCase();

  try {
    const payments = await fetchSucceededPayments(client, PRO_PRODUCT.id);
    const matches = payments.filter((p) => p.customer?.email?.toLowerCase() === target);
    console.log(`License recovery for ${email}: ${payments.length} succeeded payment(s) checked, ${matches.length} matched.`);

    for (const payment of matches) {
      const licenseKey = buildLicenseKey(payment.payment_id);
      // Reactivating an existing customer -> straight to /app (every
      // purchase/recovery flow does now -- buildRecoveryUrl always targets it).
      const recoveryUrl = buildRecoveryUrl({ paymentId: payment.payment_id });
      await sendLicenseEmails({
        customerEmail: email,
        customerName: payment.customer?.name ?? null,
        licenseKey,
        recoveryUrl,
        isResend: true,
        payment,
      });
    }
  } catch (err) {
    // Still return the generic message — a lookup failure shouldn't reveal
    // anything different from "we found nothing" to the caller.
    console.error('License recovery lookup failed:', err);
  }

  return jsonResponse(generic);
};
