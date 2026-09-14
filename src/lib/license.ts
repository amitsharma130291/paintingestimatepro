// Client-side Dodo Payments/license wiring. No database — the license key
// itself embeds the real Dodo payment id, so "checking access" always means
// asking the server (which asks Dodo) whether that payment actually
// succeeded, never trusting a local flag alone. Painting Estimate Pro has
// one paid tier ($99 lifetime), so this is the simplified single-tier
// variant of the same pattern used on qrworkbench.com/barcodeflow.

const PENDING_KEY = 'pep_pending_checkout';
const PAYMENT_KEY = 'pep_payment_v1';

export interface StoredPayment {
  sessionId: string | null;
  paymentId: string;
  licenseKey: string;
}

export async function startCheckout(returnTo: string): Promise<void> {
  const res = await fetch('/api/checkout/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnTo }),
  });
  const data = await res.json();
  if (!res.ok || !data.checkoutUrl) {
    throw new Error(data.error || "Couldn't start checkout.");
  }
  // Survives the round trip to Dodo's hosted checkout and back since
  // sessionStorage is same-origin and untouched by the third-party
  // redirect — this is how we recognize "we just came back from paying"
  // without Dodo needing to echo anything through the return_url itself.
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ sessionId: data.sessionId }));
  window.location.href = data.checkoutUrl;
}

function consumePendingCheckout(): { sessionId: string } | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getStoredPayment(): StoredPayment | null {
  try {
    return JSON.parse(localStorage.getItem(PAYMENT_KEY) || 'null');
  } catch {
    return null;
  }
}

function storePayment(payment: StoredPayment): void {
  localStorage.setItem(PAYMENT_KEY, JSON.stringify(payment));
}

export function clearStoredPayment(): void {
  localStorage.removeItem(PAYMENT_KEY);
}

async function verify({ sessionId, paymentId, sendEmail = false }: { sessionId?: string | null; paymentId?: string | null; sendEmail?: boolean }): Promise<{ ok: boolean; status?: string; paymentId?: string; licenseKey?: string }> {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (paymentId) params.set('paymentId', paymentId);
  // Only the "we just came back from checkout" call sets this — a routine
  // access re-check must never re-trigger a purchase-confirmation email.
  if (sendEmail) params.set('sendEmail', '1');
  const res = await fetch(`/api/checkout/verify?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't verify payment.");
  return data;
}

// A customer who closes the tab right after paying (before the redirect
// back completes) never hits the sessionStorage path below — the webhook
// handler emails them a link in that case, shaped like
// ?checkout=recover&sessionId=.. (or &paymentId=..). Reading it here means
// "click the email link" and "get redirected back by Dodo" both resolve
// through one function.
function consumeRecoveryParams(): { sessionId: string | null; paymentId: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') !== 'recover') return null;
  const sessionId = params.get('sessionId');
  const paymentId = params.get('paymentId');
  if (!sessionId && !paymentId) return null;
  const url = new URL(window.location.href);
  ['checkout', 'sessionId', 'paymentId'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, '', url);
  return { sessionId, paymentId };
}

/**
 * Call once on page load. Resolves either a just-completed Dodo checkout
 * redirect (sessionStorage) or a webhook-emailed recovery link (URL
 * params), confirms the payment against Dodo's API, and remembers it.
 */
export async function resolvePendingCheckout(): Promise<StoredPayment | { failed: true; status?: string } | null> {
  // Only the sessionStorage path is "we just paid, this is the first
  // confirmation" — the URL-param path means they clicked a link from an
  // email they already have, so sending another one would be redundant.
  const freshCheckout = consumePendingCheckout();
  const pending = freshCheckout || consumeRecoveryParams();
  if (!pending) return null;
  const result = await verify({ ...pending, sendEmail: Boolean(freshCheckout) });
  if (result.ok && result.paymentId && result.licenseKey) {
    const payment: StoredPayment = { sessionId: 'sessionId' in pending ? pending.sessionId : null, paymentId: result.paymentId, licenseKey: result.licenseKey };
    storePayment(payment);
    return payment;
  }
  return { failed: true, status: result.status };
}

/**
 * Manual unlock: paste in a license key from the purchase/recovery email.
 * Works on any device, since the key is fully self-verifying against Dodo
 * — no dependency on this browser's sessionStorage/localStorage history.
 */
export async function redeemLicenseKey(licenseKey: string): Promise<StoredPayment> {
  const res = await fetch('/api/license/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't verify that license key.");
  if (!data.ok) {
    const messages: Record<string, string> = {
      failed: "That payment hasn't gone through yet.",
      cancelled: 'That checkout was cancelled — no charge was made.',
      refunded: 'This purchase was refunded, so the license is no longer active. Contact support if that seems wrong.',
    };
    throw new Error(messages[data.status] || "That license key isn't valid yet.");
  }
  const payment: StoredPayment = { sessionId: null, paymentId: data.paymentId, licenseKey: data.licenseKey };
  storePayment(payment);
  return payment;
}

/** "Forgot your key" — always resolves to a generic message, whether or
 * not anything was actually found for that email. */
export async function requestLicenseRecovery(email: string): Promise<string> {
  const res = await fetch('/api/license/recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't process that request.");
  return data.message;
}

/**
 * Call before granting access to the Pro workspace. Re-checks the stored
 * payment live against Dodo rather than trusting localStorage indefinitely
 * — there's no database, so this call *is* the license check, every time.
 */
export async function verifyAccess(): Promise<StoredPayment | null> {
  const stored = getStoredPayment();
  if (!stored) return null;
  try {
    const result = await verify({ sessionId: stored.sessionId, paymentId: stored.paymentId });
    if (!result.ok) {
      clearStoredPayment();
      return null;
    }
    return stored;
  } catch {
    // A network hiccup shouldn't lock out someone who already paid — fail
    // open on the last-known-good record. Real fraud (never actually paid)
    // is still caught, because resolvePendingCheckout() never stores a
    // payment unless Dodo confirmed it at least once.
    return stored;
  }
}
