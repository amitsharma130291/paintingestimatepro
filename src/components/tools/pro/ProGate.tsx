import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { resolvePendingCheckout, checkAccess, clearStoredPayment, NetworkFailure } from '../../../lib/license';
import LicenseActions from '../LicenseActions';
import ProApp from './ProApp';
import { PRICE } from '../../../data/site';

type GateState = { status: 'checking' } | { status: 'locked' } | { status: 'unavailable' } | { status: 'unlocked' };

/** Minimal branded shell for every pre-unlock state (checking/locked/
 * unavailable) now that /app/index.astro no longer wraps this in the
 * marketing Header/Footer — the unlocked state renders ProApp's own full
 * app shell instead and doesn't use this. */
function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="flex items-center gap-2 px-6 py-5">
        <a href="/" className="flex items-center gap-2">
          <img src="/brand/logo-primary-512.png" alt="PaintingPricing Calculator" width={512} height={130} className="h-8 w-auto" />
        </a>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-lg">{children}</div>
      </div>
    </div>
  );
}

// TEMPORARY: set PUBLIC_PAYWALL_DISABLED=true (in .env, and in Vercel's env
// vars if testing a deployed preview) to open /app for free while Dodo
// Payments isn't wired up yet. Unset it — the paywall below is otherwise
// untouched — once ready to charge customers.
const PAYWALL_DISABLED = import.meta.env.PUBLIC_PAYWALL_DISABLED === 'true';

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
  const [state, setState] = useState<GateState>(PAYWALL_DISABLED ? { status: 'unlocked' } : { status: 'checking' });

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
        // A real checkout/recovery attempt (not just an ordinary "haven't
        // bought yet" visit) came back non-success -- send the user to the
        // dedicated /pricing page with an above-the-fold failure banner
        // instead of a small note buried inside the locked gate. Reusing
        // the same reason vocabulary the banner itself renders.
        const status = resolved && 'failed' in resolved ? resolved.status : undefined;
        if (status) {
          if (!cancelled) window.location.href = `/pricing?payment=failed&reason=${encodeURIComponent(status)}`;
          return;
        }
        if (!cancelled) setState({ status: 'locked' });
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

  useEffect(() => {
    if (PAYWALL_DISABLED) return undefined;
    return runCheck();
  }, [runCheck]);

  if (state.status === 'checking') {
    return (
      <GateShell>
        <div className="card p-6 text-sm text-ink-soft">Checking access…</div>
      </GateShell>
    );
  }

  if (state.status === 'unlocked') {
    return (
      <ProApp
        testMode={PAYWALL_DISABLED}
        onLockBrowser={
          PAYWALL_DISABLED
            ? undefined
            : () => {
                clearStoredPayment();
                setState({ status: 'locked' });
              }
        }
      />
    );
  }

  if (state.status === 'unavailable') {
    return (
      <GateShell>
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
      </GateShell>
    );
  }

  return (
    <GateShell>
      <div className="card p-8 text-center">
        <p className="eyebrow justify-center">Pro</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Unlock the Pro workspace</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          <span className="text-ink-soft/70 line-through">{PRICE.originalAmount}</span> <span className="font-semibold text-ink">{PRICE.amount} one-time</span> · lifetime access. Multi-room projects, per-surface materials, Price Book Health, customer documents, and actual-cost review — everything computes and saves locally in your browser.
        </p>
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
    </GateShell>
  );
}
