// Shared server-side license logic: no database, because a license key
// literally embeds the Dodo payment id that proves it. Verifying a key is
// just parsing it back apart and asking Dodo's API "did this payment
// succeed" — see redeem.ts and verify.ts. Painting Estimate Pro has exactly
// one paid tier ($99 lifetime), so unlike sibling sites (QR Workbench,
// BarcodeFlow) there's no tier segment or per-purchase job-scoping — this
// is the simplified single-tier variant of that same established pattern.
import { getTransporter, escapeHtml } from './mailer';

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

export function buildRecoveryUrl({ sessionId, paymentId }: { sessionId?: string | null; paymentId?: string | null }): string {
  // Points at /#pricing, where the standalone "Already purchased?" box
  // lives, so a customer clicking this from their email lands somewhere
  // that explains itself, not straight into the workspace.
  const url = new URL('/', SITE_URL);
  url.hash = 'pricing';
  url.searchParams.set('checkout', 'recover');
  if (sessionId) url.searchParams.set('sessionId', sessionId);
  else if (paymentId) url.searchParams.set('paymentId', paymentId);
  return url.toString();
}

function customerHtml({ licenseKey, recoveryUrl, isResend }: { licenseKey: string; recoveryUrl: string; isResend: boolean }): string {
  const heading = isResend ? "Here's your license key" : 'Thanks for your purchase';
  const intro = isResend
    ? 'You asked for your Painting Estimate Pro license key to be resent — here it is.'
    : "Pro is unlocked — here's your license key for whenever you need to restore access.";
  const activationNote = isResend
    ? 'Click below to activate your Pro license in this browser — it only takes a second.'
    : "<strong>Your Pro access is already active</strong> in the browser you checked out in — there's nothing else to do there. If you don't see it unlocked, switched devices, or cleared your browser, click below to reactivate it instantly.";
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

    <a href="${recoveryUrl}" style="display:inline-block;background:#146c4e;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px;margin:0 0 26px">Reactivate license</a>

    <p style="font-size:13px;font-weight:700;margin:0 0 8px">How to recover access if you ever lose this email</p>
    <ol style="font-size:13px;line-height:1.7;color:#4c5a52;margin:0 0 20px;padding-left:18px">
      <li>Click <strong>Reactivate license</strong> above, on any device — it unlocks instantly, no login.</li>
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
    : "Pro is unlocked — here's your license key for whenever you need to restore access.";
  const activationNote = isResend
    ? 'Click the link below to activate your Pro license in this browser -- it only takes a second.'
    : "Your Pro access is already active in the browser you checked out in -- there's nothing else to do there. If you don't see it unlocked, switched devices, or cleared your browser, use the link below to reactivate it instantly.";
  return [
    intro,
    '',
    'Product: Pro — lifetime access',
    `License key: ${licenseKey}`,
    '',
    activationNote,
    '',
    `Reactivate license: ${recoveryUrl}`,
    '',
    'How to recover access if you ever lose this email:',
    '1. Click the reactivate link above, on any device -- unlocks instantly, no login.',
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
}: {
  customerEmail: string | null;
  customerName: string | null;
  licenseKey: string;
  recoveryUrl: string;
  isResend?: boolean;
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
      await transporter.sendMail({
        from: `"Painting Estimate Pro" <${gmailUser}>`,
        to: OWNER_EMAIL,
        subject: `[${SITE_NAME}] Order — Pro — ${licenseKey}`,
        text: `New order on ${SITE_NAME} (${SITE_URL}).\n\nProduct: Pro ($99 lifetime)\nLicense key: ${licenseKey}\nCustomer: ${customerName || '(no name given)'} <${customerEmail || 'no email'}>\n${isResend ? '(This was a resend, not a new purchase.)' : ''}`,
        html: `<p>New order on <strong>${escapeHtml(SITE_NAME)}</strong> (${escapeHtml(SITE_URL)}).</p><ul><li>Product: Pro ($99 lifetime)</li><li>License key: ${escapeHtml(licenseKey)}</li><li>Customer: ${escapeHtml(customerName || '(no name given)')} &lt;${escapeHtml(customerEmail || 'no email')}&gt;</li></ul>${isResend ? '<p><em>This was a resend, not a new purchase.</em></p>' : ''}`,
      });
      result.ownerSent = true;
    } catch (err) {
      console.error('License email to owner failed:', err);
      result.ownerError = String((err as Error)?.message || err);
    }
  }

  return result;
}
