// ACCESS-002 regression: verifyAccess() must fail CLOSED on any real
// server response (misconfigured, not found, refunded, any HTTP error),
// and fail OPEN only on a genuine network failure (fetch() itself never
// reaching the server). Found live: a forged localStorage entry unlocked
// Pro forever against this repo's own unconfigured (no Dodo credentials)
// server, because the original code treated every non-2xx response the
// same as a dropped connection. See BUG_FIX_LOG.md #16.
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

describe('verifyAccess() — ACCESS-002: a forged localStorage entry must never survive a real server response', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeMemoryStorage());
    vi.stubGlobal('sessionStorage', makeMemoryStorage());
  });

  it('returns null when nothing is stored', async () => {
    const { verifyAccess } = await import('../../src/lib/license');
    vi.stubGlobal('fetch', vi.fn());
    expect(await verifyAccess()).toBeNull();
  });

  it('REGRESSION: a forged payment record is REJECTED when the server responds (even with a config-error response), not silently accepted', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'forged_id', licenseKey: 'PEP-PRO-forged_id' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "Payments aren't set up yet." }) }))
    );
    const { verifyAccess, getStoredPayment } = await import('../../src/lib/license');
    const result = await verifyAccess();
    expect(result).toBeNull();
    expect(getStoredPayment()).toBeNull(); // the forged record must be cleared, not left in place
  });

  it('a real server response saying the payment is invalid also fails closed and clears storage', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, status: 'refunded' }) }))
    );
    const { verifyAccess, getStoredPayment } = await import('../../src/lib/license');
    expect(await verifyAccess()).toBeNull();
    expect(getStoredPayment()).toBeNull();
  });

  it('a genuine network failure (fetch itself throws) fails OPEN on a previously-stored payment', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const { verifyAccess, getStoredPayment } = await import('../../src/lib/license');
    const result = await verifyAccess();
    expect(result).not.toBeNull();
    expect(getStoredPayment()).not.toBeNull(); // not cleared — a real network hiccup shouldn't lock out a real customer
  });

  it('a successful, real "ok: true" response keeps access unlocked', async () => {
    localStorage.setItem('pep_payment_v1', JSON.stringify({ sessionId: null, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, paymentId: 'pay_1', licenseKey: 'PEP-PRO-pay_1' }) }))
    );
    const { verifyAccess } = await import('../../src/lib/license');
    expect(await verifyAccess()).not.toBeNull();
  });
});
