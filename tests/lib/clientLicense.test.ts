// ACCESS-014 regression (serious, security): checkAccess() (formerly
// verifyAccess()) must NEVER grant access solely because an editable local
// `pep_payment_v1` record exists. The original code returned the raw
// stored record whenever the live check hit a NetworkFailure — meaning a
// completely fabricated record, combined with nothing more than a
// simulated (or real) network outage, unlocked Pro permanently. The
// PRE-FIX version of this exact test file asserted that behavior as
// correct (see BUG_FIX_LOG.md #23 for the verbatim old assertion) — this
// is the corrected version, now covering fabricated/malformed records,
// unavailable network, real server errors, valid entitlement,
// revoked/refunded entitlement, and the configured offline policy.
//
// Also covers ACCESS-002 (BUG_FIX_LOG #16): a real server response, for
// ANY reason, fails CLOSED — only a genuine network failure is treated
// differently, and even then it no longer grants access (see above).
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('checkAccess() — never grants access from an editable local record alone', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeMemoryStorage());
    vi.stubGlobal('sessionStorage', makeMemoryStorage());
  });

  it('reports noAccess when nothing is stored', async () => {
    const { checkAccess } = await import('../../src/lib/license');
    vi.stubGlobal('fetch', vi.fn());
    expect(await checkAccess()).toEqual({ status: 'noAccess' });
  });

  it('REGRESSION (fabricated record): an invented payment ID/license key, combined with a simulated network outage, must NOT grant access', async () => {
    // Exactly the task's own reproduction: "Put an invented payment ID and
    // license key in pep_payment_v1. Make fetch reject as it would during
    // a network outage. Call checkAccess()."
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'totally_invented_payment_id', licenseKey: 'PEP-PRO-totally_invented_payment_id' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch'); // a genuine network outage
      })
    );
    const { checkAccess, getStoredPayment } = await import('../../src/lib/license');
    const result = await checkAccess();
    expect(result.status).not.toBe('granted'); // the core fix: never granted from the local record alone
    expect(result).toEqual({ status: 'unavailable' });
    // Preserves the record (and, by extension, all local project data,
    // which lives independently in IndexedDB) so a real customer's retry
    // can succeed later without re-purchasing — this is NOT the same as
    // treating it as verified.
    expect(getStoredPayment()).not.toBeNull();
  });

  it('a malformed stored record (unparseable JSON) is treated as no record at all, not as a crash', async () => {
    localStorage.setItem('pep_payment_v1', '{not valid json');
    const { checkAccess } = await import('../../src/lib/license');
    vi.stubGlobal('fetch', vi.fn());
    expect(await checkAccess()).toEqual({ status: 'noAccess' });
  });

  it('unavailable network never grants access even across repeated retries with the SAME fabricated record', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'forged', licenseKey: 'PEP-PRO-forged' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const { checkAccess } = await import('../../src/lib/license');
    expect((await checkAccess()).status).toBe('unavailable');
    expect((await checkAccess()).status).toBe('unavailable'); // still not granted on a second attempt
  });

  it('REGRESSION (server error): a forged record is REJECTED when the server responds, even with a config-error response — never silently accepted', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'forged_id', licenseKey: 'PEP-PRO-forged_id' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Payments aren't set up yet." }) }))
    );
    const { checkAccess, getStoredPayment } = await import('../../src/lib/license');
    const result = await checkAccess();
    expect(result).toEqual({ status: 'noAccess' });
    expect(getStoredPayment()).toBeNull(); // the forged record must be cleared, not left in place
  });

  it('a revoked/refunded entitlement fails closed and clears storage', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, status: 'refunded' }) }))
    );
    const { checkAccess, getStoredPayment } = await import('../../src/lib/license');
    expect(await checkAccess()).toEqual({ status: 'noAccess' });
    expect(getStoredPayment()).toBeNull();
  });

  it('an invalid (never-existed) entitlement fails closed identically to a revoked one', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, status: 'wrong_product' }) }))
    );
    const { checkAccess } = await import('../../src/lib/license');
    expect(await checkAccess()).toEqual({ status: 'noAccess' });
  });

  it('a valid, live-confirmed entitlement is granted', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }) }))
    );
    const { checkAccess } = await import('../../src/lib/license');
    const result = await checkAccess();
    expect(result.status).toBe('granted');
  });

  it('the configured offline policy: a genuine network failure on a PREVIOUSLY-GRANTED, real payment still does not grant access — it reports unavailable, distinct from a confirmed rejection', async () => {
    // This is the deliberate policy choice (ACCESS_SPEC.md: no offline
    // signed-license infrastructure exists, so access requires successful
    // ONLINE verification every time) — even a real customer sees
    // "can't verify right now," never a silent unlock, and never a silent
    // "your purchase was revoked."
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_real', licenseKey: 'PEP-PRO-pay_real' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const { checkAccess, getStoredPayment } = await import('../../src/lib/license');
    const result = await checkAccess();
    expect(result).toEqual({ status: 'unavailable' }); // distinct from both 'granted' and 'noAccess'
    expect(getStoredPayment()).not.toBeNull(); // never treated as revoked either
  });
});
