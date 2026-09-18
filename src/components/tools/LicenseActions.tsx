import { useState, type FormEvent } from 'react';
import { Loader2, CheckCircle2, MailCheck } from 'lucide-react';
import { startCheckout, redeemLicenseKey, requestLicenseRecovery } from '../../lib/license';
import { PRICE } from '../../data/site';

function Spinner() {
  return <Loader2 size={15} strokeWidth={2.5} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

/**
 * The one purchase/unlock UI, used both on the homepage pricing section and
 * inside the Pro workspace's paywall — a "Buy Pro" button plus an "Already
 * purchased?" box (paste a license key, or request a resend by email).
 * Talks only to this app's own /api/checkout and /api/license routes,
 * never to Dodo directly — see src/lib/license.ts.
 */
export default function LicenseActions({ returnTo, onUnlocked }: { returnTo: string; onUnlocked?: () => void }) {
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

  async function handleBuy() {
    setBuying(true);
    setBuyError(null);
    try {
      await startCheckout(returnTo);
      // startCheckout navigates away on success; nothing further runs here.
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Couldn't start checkout.");
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
      setRedeemError(err instanceof Error ? err.message : "Couldn't verify that license key.");
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
    try {
      const message = await requestLicenseRecovery(email);
      setRecoveryMessage(message);
    } catch (err) {
      setRecoveryMessage(err instanceof Error ? err.message : "Couldn't process that request.");
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={handleBuy} disabled={buying}>
        {buying && <Spinner />}
        {buying ? (
          'Starting checkout…'
        ) : (
          <>
            Buy Pro — <span className="text-primary-ink/60 line-through">{PRICE.originalAmount}</span> {PRICE.amount} one-time
          </>
        )}
      </button>
      {buyError && <p className="mt-2 text-sm text-bad">{buyError}</p>}

      <div className="mt-6">
        <button type="button" className="text-link text-sm" onClick={() => setShowRecovery((s) => !s)}>
          Already purchased?
        </button>
        {showRecovery && (
          <div className="mt-3 max-w-sm text-left">
            {redeemSuccess ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-primary-dark">
                <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                License verified — Pro is unlocked in this browser.
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
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
                />
                <button type="submit" className="btn btn-secondary shrink-0" disabled={redeeming}>
                  {redeeming && <Spinner />}
                  {redeeming ? 'Checking…' : 'Unlock'}
                </button>
              </form>
            )}
            {redeemError && <p className="mt-2 text-sm text-bad">{redeemError}</p>}

            <button type="button" className="text-link mt-3 block text-xs" onClick={() => setShowForgot((s) => !s)}>
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
                  className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm text-ink"
                />
                <button type="submit" className="btn btn-secondary shrink-0" disabled={recovering}>
                  {recovering && <Spinner />}
                  {recovering ? 'Sending…' : 'Send my key'}
                </button>
              </form>
            )}
            {recoveryMessage && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
                <MailCheck size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {recoveryMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
