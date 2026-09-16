// Contact-form submission: no database, just an email to OWNER_EMAIL (the
// same inbox every order notification already goes to — see license.ts).
// Reuses the same GMAIL_USER/GMAIL_APP_PASSWORD transport as the license
// emails, so no new environment variables are needed beyond what's already
// documented in .env.example.
export const prerender = false;

import type { APIRoute } from 'astro';
import { jsonResponse } from '../../lib/server/dodo';
import { getTransporter, escapeHtml } from '../../lib/server/mailer';
import { OWNER_EMAIL, SITE_NAME, SITE_URL } from '../../lib/server/license';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LENGTH = 5000;

interface ContactBody {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  // Honeypot: a real visitor never sees or fills this field (hidden from
  // the layout and from screen readers); a bot filling every input on the
  // page does. Silently accepted-and-dropped rather than an error, so a
  // bot gets no signal that it was caught.
  company?: string;
}

export const POST: APIRoute = async ({ request }) => {
  let body: ContactBody | null = null;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (body?.company) {
    return jsonResponse({ ok: true, message: "Thanks — we'll reply soon." });
  }

  const name = String(body?.name || '').trim().slice(0, MAX_FIELD_LENGTH);
  const email = String(body?.email || '').trim().slice(0, MAX_FIELD_LENGTH);
  const subject = String(body?.subject || '').trim().slice(0, MAX_FIELD_LENGTH);
  const message = String(body?.message || '').trim().slice(0, MAX_FIELD_LENGTH);

  if (!EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'Enter a valid email address.' }, 400);
  }
  if (!subject) {
    return jsonResponse({ error: 'Enter a subject.' }, 400);
  }
  if (!message) {
    return jsonResponse({ error: 'Enter a message.' }, 400);
  }

  const setup = getTransporter();
  if (!setup || !OWNER_EMAIL) {
    console.error("Can't send contact email: GMAIL_USER/GMAIL_APP_PASSWORD/OWNER_EMAIL not fully configured.");
    return jsonResponse({ error: "Sorry, the contact form isn't set up yet. Please try again later." }, 500);
  }
  const { transporter, gmailUser } = setup;

  try {
    await transporter.sendMail({
      from: `"${SITE_NAME}" <${gmailUser}>`,
      to: OWNER_EMAIL,
      replyTo: email,
      subject: `[${SITE_NAME}] Contact: ${subject}`,
      text: [
        `New contact-form message from ${SITE_NAME} (${SITE_URL}).`,
        '',
        `From: ${name || '(no name given)'} <${email}>`,
        `Subject: ${subject}`,
        '',
        message,
      ].join('\n'),
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#17211d">
          <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#146c4e;margin:0 0 10px">${escapeHtml(SITE_NAME)} — Contact form</p>
          <p style="font-size:13px;color:#4c5a52;margin:0 0 16px">Domain: <a href="${SITE_URL}" style="color:#146c4e">${escapeHtml(SITE_URL)}</a></p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f6;border:1px solid #dde3dd;border-radius:8px;margin:0 0 20px">
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #dde3dd;font-size:13px;color:#4c5a52">From</td>
              <td style="padding:14px 18px;border-bottom:1px solid #dde3dd;font-size:13px;font-weight:700;text-align:right">${escapeHtml(name || '(no name given)')} &lt;${escapeHtml(email)}&gt;</td>
            </tr>
            <tr>
              <td style="padding:14px 18px;font-size:13px;color:#4c5a52">Subject</td>
              <td style="padding:14px 18px;font-size:13px;font-weight:700;text-align:right">${escapeHtml(subject)}</td>
            </tr>
          </table>
          <p style="font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0">${escapeHtml(message)}</p>
        </div>`,
    });
    return jsonResponse({ ok: true, message: "Thanks — we'll reply soon." });
  } catch (err) {
    console.error('Contact email failed:', err);
    return jsonResponse({ error: "Sorry, something went wrong sending your message. Please try again." }, 500);
  }
};
