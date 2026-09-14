// Creates a Dodo Payments checkout session server-side (the API key can't
// live in browser code). No database involved: the client hangs onto the
// returned sessionId itself and re-verifies it live against Dodo's API at
// unlock time — see verify.ts.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getDodoClient, PRO_PRODUCT, jsonResponse } from '../../../lib/server/dodo';

export const POST: APIRoute = async ({ request }) => {
  let body: { returnTo?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  // Only ever an internal path from our own startCheckout() call, but
  // validated anyway since it's used to build a redirect URL — an
  // unvalidated value here could send Dodo's return_url off-site.
  const returnTo = typeof body?.returnTo === 'string' && /^\/[a-z0-9/#-]*$/i.test(body.returnTo) ? body.returnTo : '/app';

  const client = getDodoClient();
  if (!client || !PRO_PRODUCT.id) {
    console.error('Dodo Payments not configured (missing API key or product id).');
    return jsonResponse({ error: "Payments aren't set up yet — check back soon." }, 500);
  }

  const origin = new URL(request.url).origin;
  try {
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: PRO_PRODUCT.id, quantity: 1 }],
      return_url: `${origin}${returnTo}?checkout=return`,
    });
    // Confirmed against the SDK's CheckoutSessionResponse type: the id
    // field is session_id (not id — that's only on the *retrieve* shape).
    return jsonResponse({ checkoutUrl: session.checkout_url, sessionId: session.session_id });
  } catch (err) {
    console.error('Dodo checkout session creation failed:', err);
    return jsonResponse({ error: "Couldn't start checkout. Please try again." }, 502);
  }
};
