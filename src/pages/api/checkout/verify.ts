// The single source of truth for "has this browser paid": always asks Dodo
// directly rather than trusting a client-stored flag, so there's nothing to
// forge and nothing to keep in a database. Called once right after the
// checkout redirect returns, and again before granting access on later
// visits.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDodoClient, evaluatePaymentEntitlement, PRO_PRODUCT, jsonResponse } from '../../../lib/server/dodo';
import { buildLicenseKey, buildRecoveryUrl, sendLicenseEmails } from '../../../lib/server/license';

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('sessionId');
  const paymentId = url.searchParams.get('paymentId');
  const sendEmail = url.searchParams.get('sendEmail') === '1';
  if (!sessionId && !paymentId) {
    return jsonResponse({ error: 'Missing sessionId or paymentId.' }, 400);
  }

  const client = getDodoClient();
  if (!client || !PRO_PRODUCT.id) {
    console.error('Dodo Payments not configured (missing API key or product id).');
    return jsonResponse({ error: "Payments aren't set up yet." }, 500);
  }

  try {
    // CheckoutSessionStatus (what checkoutSessions.retrieve returns) carries
    // payment_status and payment_id but not customer/metadata detail —
    // resolve to a payment_id, then read the full Payment object.
    let resolvedPaymentId = paymentId;
    if (!resolvedPaymentId) {
      const session = await client.checkoutSessions.retrieve(sessionId as string);
      if (!session.payment_id) {
        return jsonResponse({ ok: false, status: session.payment_status || 'pending' });
      }
      resolvedPaymentId = session.payment_id;
    }

    const payment = await client.payments.retrieve(resolvedPaymentId);
    // ACCESS-013: a succeeded, non-refunded payment is necessary but NOT
    // sufficient — it must also have actually purchased the CONFIGURED Pro
    // product. evaluatePaymentEntitlement() is the one shared decision
    // used identically here, in license/redeem.ts, and in the webhook.
    const decision = evaluatePaymentEntitlement(payment);
    if (!decision.ok) {
      return jsonResponse({ ok: false, status: decision.status });
    }

    const licenseKey = buildLicenseKey(payment.payment_id);

    if (sendEmail) {
      // Awaited, not fire-and-forget — a serverless function can be frozen
      // or torn down the instant the response is sent, so an un-awaited
      // send might never actually go out. This is the primary send path
      // (the webhook is the backstop for a closed-tab purchase).
      try {
        await sendLicenseEmails({
          customerEmail: payment.customer?.email ?? null,
          customerName: payment.customer?.name ?? null,
          licenseKey,
          // First-purchase confirmation -> lands on /app/welcome, per the
          // decision to keep that as the intended first landing page.
          recoveryUrl: buildRecoveryUrl({ paymentId: payment.payment_id, target: '/app/welcome' }),
          payment,
        });
      } catch (err) {
        console.error('verify.ts: license email failed:', err);
      }
    }

    return jsonResponse({ ok: true, paymentId: payment.payment_id, licenseKey });
  } catch (err) {
    console.error('Dodo checkout/payment lookup failed:', err);
    return jsonResponse({ error: "Couldn't verify payment. Please try again." }, 502);
  }
};
