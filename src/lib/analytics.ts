// Minimal, privacy-conscious event tracking -- no analytics platform is
// wired up yet (checked: no GA/GTM/Plausible script anywhere in the repo),
// so this pushes to window.dataLayer (the de facto standard shape GA4/GTM
// both read) and fires a same-name DOM CustomEvent, so whichever platform
// gets added later just needs its own loader script, not a rewrite of
// every call site. Never sends estimate/customer data -- only the event
// name and the small, non-identifying detail fields each call site passes.
export function track(event: string, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ event: `pep_${event}`, ...detail });
  if (import.meta.env.DEV) console.debug(`[pep:analytics] ${event}`, detail);
  document.dispatchEvent(new CustomEvent(`pep:${event}`, { detail }));
}
