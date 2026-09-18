// Pure, self-contained pieces of the Dodo Payments license-key flow — no
// network access needed, since buildLicenseKey/parseLicenseKey are just
// string encoding/decoding and buildRecoveryUrl is deterministic URL
// construction. The parts that actually call Dodo's API (checkout/verify/
// redeem/recover, the webhook) are integration-shaped API routes with no
// test coverage in this session — they need a real (or sandboxed) Dodo API
// key to exercise meaningfully, which this environment doesn't have.
import { describe, it, expect } from 'vitest';
import { buildLicenseKey, parseLicenseKey, buildRecoveryUrl } from '../../src/lib/server/license';

describe('buildLicenseKey / parseLicenseKey round-trip', () => {
  it('builds a key embedding the Dodo payment id', () => {
    expect(buildLicenseKey('pay_abc123')).toBe('PEP-PRO-pay_abc123');
  });

  it('parses a well-formed key back into its payment id', () => {
    expect(parseLicenseKey('PEP-PRO-pay_abc123')).toEqual({ paymentId: 'pay_abc123' });
  });

  it('is case-insensitive on the fixed prefix only — the payment id is captured verbatim', () => {
    expect(parseLicenseKey('pep-pro-pay_AbC123')).toEqual({ paymentId: 'pay_AbC123' });
  });

  it('tolerates surrounding whitespace (pasted from an email)', () => {
    expect(parseLicenseKey('  PEP-PRO-pay_abc123  ')).toEqual({ paymentId: 'pay_abc123' });
  });

  it('rejects malformed or unrelated input rather than guessing', () => {
    expect(parseLicenseKey('not-a-key')).toBeNull();
    expect(parseLicenseKey('')).toBeNull();
    expect(parseLicenseKey(undefined)).toBeNull();
    expect(parseLicenseKey('QRW-PRO-pay_abc123')).toBeNull(); // a sibling site's key format
  });

  it('round-trips: build then parse recovers the exact original payment id', () => {
    const key = buildLicenseKey('pay_xyz789');
    expect(parseLicenseKey(key)).toEqual({ paymentId: 'pay_xyz789' });
  });
});

describe('buildRecoveryUrl', () => {
  // BUG FIX: this used to point at `/#pricing`, but nothing on the homepage
  // ever consumes `checkout=recover` -- only ProGate.tsx does, mounted on
  // /app and /app/welcome. A recovery link built the old way looked fine
  // but silently did nothing when clicked. Default target is now /app.
  it('defaults to /app, where checkout=recover is actually resolved', () => {
    const url = buildRecoveryUrl({ sessionId: 'sess_1' });
    expect(url).toContain('checkout=recover');
    expect(url).toContain('sessionId=sess_1');
    expect(url).not.toContain('paymentId=');
    expect(new URL(url).pathname).toBe('/app');
    expect(new URL(url).hash).toBe('');
  });

  it('falls back to paymentId when no sessionId is given', () => {
    const url = buildRecoveryUrl({ paymentId: 'pay_1' });
    expect(url).toContain('paymentId=pay_1');
    expect(url).not.toContain('sessionId=');
  });

  it('prefers sessionId over paymentId when both are given', () => {
    const url = buildRecoveryUrl({ sessionId: 'sess_1', paymentId: 'pay_1' });
    expect(url).toContain('sessionId=sess_1');
    expect(url).not.toContain('paymentId=');
  });

  it('accepts an explicit target for the first-purchase welcome-page landing', () => {
    const url = buildRecoveryUrl({ paymentId: 'pay_1', target: '/app/welcome' });
    expect(new URL(url).pathname).toBe('/app/welcome');
    expect(url).toContain('paymentId=pay_1');
  });
});
