import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface ToastProps {
  message: string;
  detail?: string;
  variant: 'success' | 'warn';
}

/**
 * A floating confirmation, fixed to the viewport so it's visible regardless
 * of scroll position — replaces the old small "Saved." text that sat above
 * the fold and was easy to miss. Success toasts fade in then are removed by
 * the parent after a few seconds (see ProApp's auto-dismiss effect); a warn
 * toast is left up to the caller to clear since it's actionable.
 */
export default function Toast({ message, detail, variant }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // A plain timer rather than requestAnimationFrame -- rAF is throttled
    // or never fires for a backgrounded/hidden tab, which would leave the
    // toast permanently at opacity-0 whenever the window isn't focused.
    const id = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(id);
  }, [message]);

  const isWarn = variant === 'warn';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-4 top-20 z-50 w-[calc(100%-2rem)] max-w-sm rounded-card border p-4 shadow-lg transition-all duration-200 motion-reduce:transition-none sm:right-6 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
      } ${isWarn ? 'border-warn-line bg-warn-soft' : 'border-line bg-card'}`}
    >
      <div className="flex items-start gap-2.5">
        {isWarn ? (
          <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-primary-dark" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className={`text-sm font-medium ${isWarn ? 'text-warn' : 'text-ink'}`}>{message}</p>
          {detail && <p className="mt-1 text-xs text-ink-soft">{detail}</p>}
        </div>
      </div>
    </div>
  );
}
