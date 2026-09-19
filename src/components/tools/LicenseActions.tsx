import { useState, useEffect, type FormEvent } from 'react';
import { Loader2, CheckCircle2, MailCheck, AlertCircle } from 'lucide-react';
import { startCheckout, redeemLicenseKey, requestLicenseRecovery, getStoredPayment, NetworkFailure } from '../../lib/license';
import { BUY_CTA_LABEL } from '../../data/site';
import { track } from '../../lib/analytics';

function Spinner() {
  return <Loader2 size={15} strokeWidth={2.5} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

// A dropped connection is a temporary, retry-worthy problem — never the
// same message as "that key/email genuinely isn't valid." Both
// redeemLicenseKey() and requestLicenseRecovery() throw NetworkFailure
// specifically (not a generic Error) for exactly this case; see license.ts.
const TEMPORARY_ERROR_MESSAGE = "We couldn't check your purchase right now. Please try again in a moment.";

function describeError(err: unknown, fallback: string): string {
  if (err instanceof NetworkFailure) return TEMPORARY_ERROR_MESSAGE;
  return err instanceof Error ? err.message : fallback;
}

// The real, existing /contact page — never a fabricated support address.
function ContactSupportLink() {
  return (
    <a href="/contact" className="text-link">
      contact support
    </a>
  );
}

/**
 * The one purchase/unlock UI, used on the sales page, the homepage pricing
 * section, and inside the Pro workspace's paywall — the BUY_CTA_LABEL button
 * plus an "Already purchased?" box (paste a license key, or request a
 * resend by email).
 * Talks only to this app's own /api/checkout and /api/license routes,
 * never to Dodo directly — see src/lib/license.ts.
 */
export default function LicenseActions({
  returnTo,
  onUnlocked,
  buyLabel = BUY_CTA_LABEL,
  analyticsEvent,
}: {
  returnTo: string;
  onUnlocked?: () => void;
  /** Overrides the buy button's own text (e.g. the guarantee section's
   * "Try Painting Estimate Pro" framing) without duplicating the whole
   * component just to change one string. Defaults to the standard,
   * site-wide purchase phrase. */
  buyLabel?: string;
  /** An extra, location-specific event (e.g. "hero_cta_clicked") tracked
   * alongside the standard "checkout_started" every buy click already
   * fires — lets each placement of this same component be told apart in
   * analytics without this component knowing what "hero" or "final" mean. */
  analyticsEvent?: string;
}) {
  // Server-rendered (client:load) markup always starts as "Buy Pro" --
  // localStorage doesn't exist during SSR -- then this effect, client-side
  // only, swaps to "Go to app" for a returning customer. Same "only ever a
  // display choice, never a real access decision" caveat as the site-wide
  // data-pro-cta swap in BaseLayout.astro: /app's own ProGate is still what
  // actually re-verifies the stored license against Dodo.
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);
  useEffect(() => {
    if (getStoredPayment()) setAlreadyPurchased(true);
  }, []);

  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState(false);

  async function handleBuy() {
    setBuying(true);
    setBuyError(null);
    if (analyticsEvent) track(analyticsEvent);
    track('checkout_started');
    try {
      await startCheckout(returnTo);
      // startCheckout navigates away on success; nothing further runs here.
    } catch (err) {
      setBuyError(describeError(err, "Couldn't start checkout."));
      setBuying(false);
    }
  }

  async function handleRedeem(e: FormEvent) {
    e.preventDefault();
    const key = licenseKeyInput.trim();
    if (!key) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      await redeemLicenseKey(key);
      setRedeemSuccess(true);
      setLicenseKeyInput('');
      // ProGate passes its own onUnlocked to flip state in place (already on
      // /app). The homepage usage passes none -- default to actually taking
      // the user into the app, since redeeming there previously just showed
      // a confirmation sentence and went nowhere.
      if (onUnlocked) onUnlocked();
      else window.location.href = '/app';
    } catch (err) {
      setRedeemError(describeError(err, "Couldn't verify that license key."));
    } finally {
      setRedeeming(false);
    }
  }

  async function handleRecover(e: FormEvent) {
    e.preventDefault();
    const email = recoveryEmail.trim();
    if (!email) return;
    setRecovering(true);
    setRecoveryMessage(null);
    setRecoveryError(false);
    try {
      const message = await requestLicenseRecovery(email);
      setRecoveryMessage(message);
    } catch (err) {
      setRecoveryError(true);
      setRecoveryMessage(describeError(err, "Couldn't process that request."));
    } finally {
      setRecovering(false);
    }
  }

  if (alreadyPurchased) {
    return (
      <div>
        <a href="/app" className="btn btn-primary">
          Go to app
        </a>
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={handleBuy} disabled={buying}>
        {buying && <Spinner />}
        {buying ? 'Starting checkout…' : buyLabel}
      </button>
      {buyError && <p className="mt-2 text-sm text-bad">{buyError}</p>}

      <div className="mt-6">
        {/* Hidden once alreadyPurchased is true (the early return above) --
            never shown to a visitor this browser already recognizes as
            verified. */}
        <button type="button" className="text-link text-sm" onClick={() => setShowRecovery((s) => !s)}>
          Already purchased? Restore access
        </button>
        {showRecovery && (
          <div className="mt-3 max-w-sm text-left">
            {redeemSuccess ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-primary-dark">
                <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                Access restored. You can now open Painting Estimate Pro.
              </p>
            ) : (
              <form onSubmit={handleRedeem} className="flex gap-2">
                <input
                  type="text"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  placeholder="License key"
                  aria-label="License key"
                  autoComplete="off"
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-base text-ink sm:text-sm"
                />
                <button type="submit" className="btn btn-secondary shrink-0" disabled={redeeming}>
                  {redeeming && <Spinner />}
                  {redeeming ? 'Checking…' : 'Unlock'}
                </button>
              </form>
            )}
            {redeemError && (
              <p className="mt-2 text-sm text-bad">
                {redeemError} {!redeemError.includes(TEMPORARY_ERROR_MESSAGE) && <ContactSupportLink />}
              </p>
            )}

            <button type="button" className="text-link mt-3 block text-sm" onClick={() => setShowForgot((s) => !s)}>
              Forgot your key?
            </button>
            {showForgot && (
              <form onSubmit={handleRecover} className="mt-2 flex gap-2">
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="Email used at checkout"
                  aria-label="Email used at checkout"
                  autoComplete="email"
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-base text-ink sm:text-sm"
                />
                <button type="submit" className="btn btn-secondary shrink-0" disabled={recovering}>
                  {recovering && <Spinner />}
                  {recovering ? 'Sending…' : 'Send my key'}
                </button>
              </form>
            )}
            {recoveryMessage && (
              <p className={`mt-2 flex items-start gap-1.5 text-sm ${recoveryError ? 'text-bad' : 'text-ink-soft'}`}>
                {recoveryError ? (
                  <AlertCircle size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <MailCheck size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {recoveryMessage} {recoveryError && <ContactSupportLink />}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
