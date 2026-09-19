// Minimal, privacy-conscious event tracking. Google Analytics (gtag.js,
// measurement id G-SML9ZVEQ8E, loaded in BaseLayout.astro, production only)
// is the one analytics platform actually connected -- see privacy.astro's
// "Analytics" section for the real disclosure. When gtag is available this
// sends a real GA4 event; if it hasn't loaded yet (or is blocked by the
// visitor), this still pushes the same shape to window.dataLayer so nothing
// throws and no event is silently lost pre-load. Never sends estimate or
// customer data -- only the event name and the small, non-identifying
// detail fields each call site passes (enforced by
// tests/integration/noAnalyticsLeak.test.ts's forbidden-field scan).
export function track(event: string, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  const eventName = `pep_${event}`;
  if (typeof w.gtag === 'function') {
    w.gtag('event', eventName, detail);
  } else {
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event: eventName, ...detail });
  }
  if (import.meta.env.DEV) console.debug(`[pep:analytics] ${event}`, detail);
  document.dispatchEvent(new CustomEvent(`pep:${event}`, { detail }));
}
