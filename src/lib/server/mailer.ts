// Shared Gmail SMTP transport, used by both the license-email flow
// (license.ts) and the contact-form endpoint (pages/api/contact.ts) — one
// GMAIL_USER/GMAIL_APP_PASSWORD pair, one place that builds the
// transporter from it.
import nodemailer, { type Transporter } from 'nodemailer';

export function getTransporter(): { transporter: Transporter; gmailUser: string } | null {
  const gmailUser = import.meta.env.GMAIL_USER?.trim();
  const gmailPass = import.meta.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!gmailUser || !gmailPass) return null;
  return { transporter: nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } }), gmailUser };
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
