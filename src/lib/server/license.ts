// Shared server-side license logic: no database, because a license key
// literally embeds the Dodo payment id that proves it. Verifying a key is
// just parsing it back apart and asking Dodo's API "did this payment
// succeed" — see redeem.ts and verify.ts. Painting Estimate Pro has exactly
// one paid tier ($99 lifetime), so unlike sibling sites (QR Workbench,
// BarcodeFlow) there's no tier segment or per-purchase job-scoping — this
// is the simplified single-tier variant of that same established pattern.
import { getTransporter, escapeHtml } from './mailer';
import { PRICE } from '../../data/site';

/**
 * LAUNCH-001: the owner-email summary used to hardcode "$99 lifetime" —
 * which would just go stale again at the next price change (as it already
 * had, when the launch price dropped to PRICE.amount). Prefer the payment's
 * own real total_amount/currency when available (authoritative, whatever
 * was actually charged for that specific purchase) and fall back to the
 * current site price only if the caller didn't have a payment object handy.
 */
function formatChargedAmount(payment: unknown): string {
  const p = payment as { total_amount?: number; currency?: string } | undefined;
  if (typeof p?.total_amount === 'number' && p.currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency }).format(p.total_amount / 100);
    } catch {
      // Fall through to the site-price fallback below.
    }
  }
  return PRICE.amount;
}

export const SITE_URL = 'https://paintingpricingcalculator.com';
export const SITE_NAME = 'PaintingPricing Calculator';
// Falls back to a literal so nothing breaks if OWNER_EMAIL isn't set — but
// set it in the real deployment env so this is the one place it's defined.
export const OWNER_EMAIL = import.meta.env.OWNER_EMAIL || '';

export function buildLicenseKey(paymentId: string): string {
  return `PEP-PRO-${paymentId}`;
}

// Case-insensitive on the fixed "PEP-PRO-" prefix (so a phone keyboard's
// autocapitalize doesn't break pasting), but the payment id itself is
// captured verbatim — Dodo ids are case-sensitive.
export function parseLicenseKey(rawKey: unknown): { paymentId: string } | null {
  const trimmed = String(rawKey ?? '').trim();
  const match = trimmed.match(/^pep-pro-(.+)$/i);
  if (!match) return null;
  return { paymentId: match[1] };
}

/**
 * BUG FIX: this used to point at `/#pricing` — but the code that actually
 * consumes `checkout=recover` (consumeRecoveryParams() inside
 * resolvePendingCheckout(), src/lib/license.ts) only ever runs from
 * ProGate.tsx, which is mounted on /app and /app/welcome, never on the
 * homepage. A recovery/reactivation email link built the old way landed on
 * the pricing section and did nothing — no auto-unlock. `target` must be a
 * page that actually resolves these params.
 */
export function buildRecoveryUrl({ sessionId, paymentId, target = '/app' }: { sessionId?: string | null; paymentId?: string | null; target?: '/app' | '/app/welcome' }): string {
  const url = new URL(target, SITE_URL);
  url.searchParams.set('checkout', 'recover');
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  else if (paymentId) url.searchParams.set('paymentId', paymentId);
  return url.toString();
}

function customerHtml({ licenseKey, recoveryUrl, isResend }: { licenseKey: string; recoveryUrl: string; isResend: boolean }): string {
  const heading = isResend ? "Here's your license key" : "Welcome to Pro — you're all set";
  const intro = isResend
    ? 'You asked for your Painting Estimate Pro license key to be resent — here it is.'
    : "Thanks for your purchase — your setup is done and Pro is ready to use right now.";
  const activationNote = isResend
    ? 'Click below to jump straight into Pro — it activates your license in this browser automatically.'
    : "Click below to go straight into your new workspace — this activates your license in this browser automatically, so there's nothing else to set up.";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17211d">
    <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#146c4e;margin:0 0 10px">Painting Estimate Pro</p>
    <h1 style="font-size:22px;margin:0 0 10px">${heading}</h1>
    <p style="font-size:14px;line-height:1.6;color:#4c5a52;margin:0 0 20px">${intro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #dde3dd;border-radius:8px;margin:0 0 20px">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #dde3dd;font-size:13px;color:#4c5a52">Product</td>
        <td style="padding:16px 20px;border-bottom:1px solid #dde3dd;font-size:13px;font-weight:700;text-align:right">Pro — lifetime access</td>
      </tr>
      <tr>
        <td style="padding:16px 20px;font-size:13px;color:#4c5a52">License key</td>
        <td style="padding:16px 20px;font-size:14px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right">${escapeHtml(licenseKey)}</td>
      </tr>
    </table>

    <p style="font-size:13px;line-height:1.6;color:#4c5a52;margin:0 0 18px">${activationNote}</p>

    <a href="${recoveryUrl}" style="display:inline-block;background:#146c4e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px;margin:0 0 26px">Go to app</a>

    <p style="font-size:13px;font-weight:700;margin:0 0 8px">How to activate your license if you ever forget this email, switch devices, or clear your browser</p>
    <ol style="font-size:13px;line-height:1.7;color:#4c5a52;margin:0 0 20px;padding-left:18px">
      <li>Click <strong>Go to app</strong> above, on any device — it unlocks instantly, no login.</li>
      <li>Or go to the <a href="${SITE_URL}/#pricing">pricing section</a>, open <strong>"Already purchased?"</strong>, and paste: <strong>${escapeHtml(licenseKey)}</strong></li>
      <li>Lost the key itself, not just this email? On that same section, click <strong>"Forgot your key?"</strong>, enter the email you paid with, and it gets re-sent automatically.</li>
    </ol>

    <p style="font-size:13px;color:#4c5a52;margin:0 0 20px">Pro is a one-time purchase — this key never expires and works on any device.</p>

    <hr style="border:none;border-top:1px solid #dde3dd;margin:0 0 16px" />
    <p style="font-size:12.5px;color:#4c5a52;margin:0">Questions about your purchase? Just reply to this email.</p>
  </div>`;
}

function customerText({ licenseKey, recoveryUrl, isResend }: { licenseKey: string; recoveryUrl: string; isResend: boolean }): string {
  const intro = isResend
    ? 'You asked for your Painting Estimate Pro license key to be resent — here it is.'
    : 'Thanks for your purchase -- your setup is done and Pro is ready to use right now.';
  const activationNote = isResend
    ? 'Click the link below to jump straight into Pro -- it activates your license in this browser automatically.'
    : "Click the link below to go straight into your new workspace -- this activates your license in this browser automatically, so there's nothing else to set up.";
  return [
    intro,
    '',
    'Product: Pro — lifetime access',
    `License key: ${licenseKey}`,
    '',
    activationNote,
    '',
    `Go to app: ${recoveryUrl}`,
    '',
    'How to activate your license if you ever forget this email, switch devices, or clear your browser:',
    '1. Click the "Go to app" link above, on any device -- unlocks instantly, no login.',
    `2. Or go to ${SITE_URL}/#pricing, open "Already purchased?", and paste: ${licenseKey}`,
    '3. Lost the key itself? On that same section, click "Forgot your key?", enter the email you paid with, and it gets re-sent automatically.',
    '',
    'Pro is a one-time purchase -- this key never expires and works on any device.',
    '',
    'Questions about your purchase? Just reply to this email.',
  ].join('\n');
}

export interface SendLicenseEmailsResult {
  configured: boolean;
  customerSent: boolean;
  customerError: string | null;
  ownerSent: boolean;
  ownerError: string | null;
}

/**
 * Emails the license key + recovery steps to the customer, and a copy to
 * the site owner as a standing record (the owner's inbox doubles as the
 * audit trail there is no database for). Called from verify.ts right after
 * a checkout redirect confirms payment (the common case), from the webhook
 * as a backstop for a closed-tab purchase, and from license/recover.ts on a
 * resend request. Deliberately not deduplicated between the first two — an
 * occasional duplicate purchase-confirmation email is a much smaller
 * problem than a purchase that emails nothing at all.
 */
export async function sendLicenseEmails({
  customerEmail,
  customerName,
  licenseKey,
  recoveryUrl,
  isResend = false,
  payment,
}: {
  customerEmail: string | null;
  customerName: string | null;
  licenseKey: string;
  recoveryUrl: string;
  isResend?: boolean;
  /** The full raw Dodo payment object, when the caller has it in hand
   * (verify.ts, the webhook, recover.ts all do) — included verbatim in the
   * owner's email as a pretty-printed JSON block, in addition to the
   * readable summary below, so the owner always has the complete record. */
  payment?: unknown;
}): Promise<SendLicenseEmailsResult> {
  const result: SendLicenseEmailsResult = { configured: false, customerSent: false, customerError: null, ownerSent: false, ownerError: null };
  const setup = getTransporter();
  if (!setup) {
    console.error("Can't send license email: GMAIL_USER/GMAIL_APP_PASSWORD not configured.");
    return result;
  }
  result.configured = true;
  const { transporter, gmailUser } = setup;
  const subject = isResend ? 'Your Painting Estimate Pro license key (resent)' : 'Your Painting Estimate Pro license key';
  const templateArgs = { licenseKey, recoveryUrl, isResend };

  if (customerEmail) {
    try {
      await transporter.sendMail({
        from: `"Painting Estimate Pro" <${gmailUser}>`,
        to: customerEmail,
        replyTo: OWNER_EMAIL || gmailUser,
        subject,
        text: customerText(templateArgs),
        html: customerHtml(templateArgs),
      });
      result.customerSent = true;
    } catch (err) {
      console.error('License email to customer failed:', err);
      result.customerError = String((err as Error)?.message || err);
    }
  }

  if (OWNER_EMAIL) {
    try {
      const rawJson = payment !== undefined ? JSON.stringify(payment, null, 2) : null;
      const amountLabel = formatChargedAmount(payment);
      await transporter.sendMail({
        from: `"Painting Estimate Pro" <${gmailUser}>`,
        to: OWNER_EMAIL,
        subject: `[${SITE_NAME}] Order — Pro — ${licenseKey}`,
        text: [
          `New order on ${SITE_NAME} (${SITE_URL}).`,
          '',
          `Product: Pro (${amountLabel} lifetime)`,
          `License key: ${licenseKey}`,
          `Customer: ${customerName || '(no name given)'} <${customerEmail || 'no email'}>`,
          isResend ? '(This was a resend, not a new purchase.)' : '',
          rawJson ? `\nFull payment object:\n${rawJson}` : '',
        ].filter(Boolean).join('\n'),
        html: [
          `<p>New order on <strong>${escapeHtml(SITE_NAME)}</strong> (${escapeHtml(SITE_URL)}).</p>`,
          `<ul><li>Product: Pro (${escapeHtml(amountLabel)} lifetime)</li><li>License key: ${escapeHtml(licenseKey)}</li><li>Customer: ${escapeHtml(customerName || '(no name given)')} &lt;${escapeHtml(customerEmail || 'no email')}&gt;</li></ul>`,
          isResend ? '<p><em>This was a resend, not a new purchase.</em></p>' : '',
          rawJson ? `<p style="font-weight:700;margin:16px 0 6px">Full payment object</p><pre style="background:#faf9f6;border:1px solid #dde3dd;border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;white-space:pre-wrap">${escapeHtml(rawJson)}</pre>` : '',
        ].filter(Boolean).join(''),
      });
      result.ownerSent = true;
    } catch (err) {
      console.error('License email to owner failed:', err);
      result.ownerError = String((err as Error)?.message || err);
    }
  }

  return result;
}

/**
 * Internal-only notification for a payment.failed webhook event — no
 * customer email (there's no license to send), just the owner getting the
 * complete raw object so a real decline/failure is never silent.
 */
export async function sendPaymentFailureEmail(payment: unknown): Promise<{ sent: boolean; error: string | null }> {
  if (!OWNER_EMAIL) return { sent: false, error: 'OWNER_EMAIL not configured.' };
  const setup = getTransporter();
  if (!setup) return { sent: false, error: 'GMAIL_USER/GMAIL_APP_PASSWORD not configured.' };
  const { transporter, gmailUser } = setup;

  const p = (payment ?? {}) as { payment_id?: string; error_code?: string | null; error_message?: string | null; customer?: { email?: string | null; name?: string | null } };
  const rawJson = JSON.stringify(payment, null, 2);
  const reasonLine = p.error_message || p.error_code ? `Reason: ${p.error_message || p.error_code}` : 'Reason: not provided by Dodo.';
  const attemptedAmount = formatChargedAmount(payment);

  try {
    await transporter.sendMail({
      from: `"Painting Estimate Pro" <${gmailUser}>`,
      to: OWNER_EMAIL,
      subject: `[${SITE_NAME}] Payment failed${p.payment_id ? ` — ${p.payment_id}` : ''}`,
      text: [
        `A payment attempt failed on ${SITE_NAME} (${SITE_URL}).`,
        '',
        `Customer: ${p.customer?.name || '(no name given)'} <${p.customer?.email || 'no email'}>`,
        `Attempted amount: ${attemptedAmount}`,
        reasonLine,
        '',
        `Full payment object:\n${rawJson}`,
      ].join('\n'),
      html: [
        `<p>A payment attempt failed on <strong>${escapeHtml(SITE_NAME)}</strong> (${escapeHtml(SITE_URL)}).</p>`,
        `<ul><li>Customer: ${escapeHtml(p.customer?.name || '(no name given)')} &lt;${escapeHtml(p.customer?.email || 'no email')}&gt;</li><li>Attempted amount: ${escapeHtml(attemptedAmount)}</li><li>${escapeHtml(reasonLine)}</li></ul>`,
        `<p style="font-weight:700;margin:16px 0 6px">Full payment object</p><pre style="background:#fbeeec;border:1px solid #f0d3ce;border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;white-space:pre-wrap">${escapeHtml(rawJson)}</pre>`,
      ].join(''),
    });
    return { sent: true, error: null };
  } catch (err) {
    console.error('Payment-failure email to owner failed:', err);
    return { sent: false, error: String((err as Error)?.message || err) };
  }
}
