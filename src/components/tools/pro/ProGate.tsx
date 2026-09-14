import { useEffect, useState } from 'react';
import { resolvePendingCheckout, verifyAccess, clearStoredPayment } from '../../../lib/license';
import LicenseActions from '../LicenseActions';
import ProApp from './ProApp';

type GateState = { status: 'checking' } | { status: 'locked'; note?: string } | { status: 'unlocked' };

/**
 * Real entitlement gate in front of the Pro workspace — no more "the /app
 * route is unlinked" as the only thing standing between a visitor and the
 * paid product. On mount: resolve a just-completed Dodo checkout redirect
 * (or a webhook-emailed recovery link), then verify any already-stored
 * payment live against Dodo. Local data (projects, catalog, settings)
 * always stays in IndexedDB regardless of lock state — this only gates
 * whether the workspace UI renders, never touches storage.
 */
export default function ProGate() {
  const [state, setState] = useState<GateState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolvePendingCheckout();
        if (resolved && !('failed' in resolved)) {
          if (!cancelled) setState({ status: 'unlocked' });
          return;
        }
        const access = await verifyAccess();
        if (!cancelled) setState(access ? { status: 'unlocked' } : { status: 'locked', note: resolved && 'failed' in resolved ? "That checkout hasn't completed yet — if you just paid, give it a moment and refresh." : undefined });
      } catch {
        if (!cancelled) setState({ status: 'locked' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'checking') {
    return <div className="card p-6 text-sm text-ink-soft">Checking access…</div>;
  }

  if (state.status === 'unlocked') {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="status-note">Pro unlocked · everything below runs and saves locally in your browser.</p>
          <button
            type="button"
            className="text-link text-xs"
            onClick={() => {
              clearStoredPayment();
              setState({ status: 'locked' });
            }}
          >
            Lock this browser
          </button>
        </div>
        <ProApp />
      </div>
    );
  }

  return (
    <div className="card p-8 text-center">
      <p className="eyebrow justify-center">Pro</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Unlock the Pro workspace</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        $99 one-time · lifetime access. Multi-room projects, per-surface materials, Price Book Health, customer documents, and actual-cost review — everything computes and saves locally in your browser.
      </p>
      {state.note && <p className="mt-3 text-sm text-warn">{state.note}</p>}
      <div className="mt-6 flex flex-col items-center">
        <LicenseActions returnTo="/app" onUnlocked={() => setState({ status: 'unlocked' })} />
      </div>
    </div>
  );
}
