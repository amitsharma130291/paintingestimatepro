import { useEffect, useState, useCallback } from 'react';
import { resolvePendingCheckout, checkAccess, clearStoredPayment, NetworkFailure } from '../../../lib/license';
import LicenseActions from '../LicenseActions';
import ProApp from './ProApp';

type GateState = { status: 'checking' } | { status: 'locked'; note?: string } | { status: 'unavailable' } | { status: 'unlocked' };

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

  const runCheck = useCallback(() => {
    let cancelled = false;
    setState({ status: 'checking' });
    (async () => {
      try {
        const resolved = await resolvePendingCheckout();
        if (resolved && !('failed' in resolved)) {
          if (!cancelled) setState({ status: 'unlocked' });
          return;
        }
        const access = await checkAccess();
        if (access.status === 'granted') {
          if (!cancelled) setState({ status: 'unlocked' });
          return;
        }
        if (access.status === 'unavailable') {
          // A genuine connectivity problem, not a rejection — never
          // unlocked, but also never told "your purchase was revoked."
          // The stored payment (and every local project) is untouched;
          // retrying once back online just works.
          if (!cancelled) setState({ status: 'unavailable' });
          return;
        }
        const statusNotes: Record<string, string> = {
          cancelled: 'That checkout was cancelled — no charge was made.',
          refunded: 'This purchase was refunded, so Pro access is no longer active. Contact support if that seems wrong.',
        };
        const status = resolved && 'failed' in resolved ? resolved.status : undefined;
        const note = status ? statusNotes[status] ?? "That checkout hasn't completed yet — if you just paid, give it a moment and refresh." : undefined;
        if (!cancelled) setState({ status: 'locked', note });
      } catch (err) {
        // A NetworkFailure surfacing from resolvePendingCheckout (the
        // checkout-return/recovery path) gets the same honest "can't
        // verify right now" treatment as one from checkAccess() — never
        // the paywall's "purchase failed" framing for what might just be
        // a dropped connection.
        if (!cancelled) setState(err instanceof NetworkFailure ? { status: 'unavailable' } : { status: 'locked' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => runCheck(), [runCheck]);

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

  if (state.status === 'unavailable') {
    return (
      <div className="card p-8 text-center">
        <p className="eyebrow justify-center">Pro</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Can't verify access right now</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          We couldn't reach the verification service — this looks like a connection problem, not a rejection. Your purchase and local projects are untouched; try again once you're back online.
        </p>
        <div className="mt-6 flex flex-col items-center">
          <button type="button" className="btn btn-primary" onClick={runCheck}>
            Try again
          </button>
        </div>
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
      <div className="mt-6 flex flex-col items-center gap-3">
        <LicenseActions returnTo="/app/welcome" onUnlocked={() => setState({ status: 'unlocked' })} />
        <a href="/help" className="text-link text-sm">
          See exactly what's inside, with screenshots
        </a>
        <a href="/#pricing" className="text-link text-xs">
          Back to full pricing details
        </a>
      </div>
    </div>
  );
}
