// Reliability backstop, per Dodo's own guidance: always fulfill on
// payment.succeeded from the webhook, not just the browser redirect — the
// redirect can be missed if the customer closes the tab, whereas the
// webhook is retried until acknowledged. The main unlock path (verify.ts,
// called right after the redirect back) doesn't strictly need it — it
// re-asks Dodo's API directly. This route emails the license key to the
// customer (and, as a standing record, to the owner) as a backstop; the
// redirect path only unlocks the current browser and also emails on its
// own success path, so an occasional duplicate email is expected and
// preferred over a purchase that emails nothing.
export const prerender = false;

import type { APIRoute } from 'astro';
import { Webhook } from 'standardwebhooks';
import { evaluatePaymentEntitlement, type DodoPayment } from '../../../lib/server/dodo';
import { buildLicenseKey, buildRecoveryUrl, sendLicenseEmails, sendPaymentFailureEmail } from '../../../lib/server/license';

export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
  if (!secret) {
    console.error('DODO_PAYMENTS_WEBHOOK_KEY not configured.');
    return new Response(JSON.stringify({ error: 'Webhook not configured.' }), { status: 500 });
  }

  // Signature verification needs the exact raw bytes Dodo signed — must
  // read as text before any JSON parsing, not re-serialize after the fact.
  const rawBody = await request.text();
  const headers = {
    'webhook-id': request.headers.get('webhook-id') || '',
    'webhook-signature': request.headers.get('webhook-signature') || '',
    'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
  };

  let event: { type: string; data?: Record<string, unknown> };
  try {
    const webhook = new Webhook(secret);
    await webhook.verify(rawBody, headers);
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('Dodo webhook signature verification failed:', err);
    return new Response(JSON.stringify({ error: 'Invalid signature.' }), { status: 401 });
  }

  console.log('Dodo webhook received:', event.type);

  if (event.type === 'payment.succeeded') {
    try {
      // event.data IS a full Payment object (WebhookPayload.Payment extends
      // PaymentsAPI.Payment per the SDK's own types) — the same shared
      // entitlement decision used by verify.ts/redeem.ts applies directly
      // to it, with no extra Dodo API call needed. ACCESS-013: a
      // payment.succeeded event for an unrelated product must never email
      // out a working Pro license key.
      const data = (event.data ?? {}) as unknown as DodoPayment;
      const paymentId = data.payment_id;
      const customerEmail = data.customer?.email ?? null;
      const customerName = data.customer?.name ?? null;
      const decision = paymentId ? evaluatePaymentEntitlement(data) : { ok: false as const, status: 'missing_payment_id' };

      if (!paymentId) {
        console.error("Dodo webhook: payment.succeeded with no payment_id -- can't build a license key.", data);
      } else if (!decision.ok) {
        console.error(`Dodo webhook: payment.succeeded event for ${paymentId} did not pass entitlement checks (${decision.status}) -- not emailing a license key.`, data);
      } else if (!customerEmail) {
        console.error("Dodo webhook: payment.succeeded with no customer email -- can't send it.", data);
      } else {
        const licenseKey = buildLicenseKey(paymentId);
        // Backstop for the same first-purchase confirmation verify.ts sends
        // on the browser-redirect path -- same /app target.
        const recoveryUrl = buildRecoveryUrl({ paymentId });
        await sendLicenseEmails({ customerEmail, customerName, licenseKey, recoveryUrl, payment: data });
      }
    } catch (err) {
      // Don't fail the webhook over a best-effort email — Dodo would just
      // retry it, and the browser-redirect path may have already unlocked
      // this purchase in the customer's current session regardless.
      console.error('Dodo webhook: license email failed:', err);
    }
  } else if (event.type === 'payment.failed') {
    // Internal-only notification -- no license exists to send the customer,
    // and the customer-facing failure experience (redirect + banner) is
    // driven separately by the browser-side return flow, not this webhook.
    try {
      await sendPaymentFailureEmail(event.data ?? {});
    } catch (err) {
      console.error('Dodo webhook: payment-failure email failed:', err);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
};
