// UX-005 (ACCEPTANCE_TESTS.md P01-P07): "GIVEN Reduce-motion preference
// enabled WHEN Navigate tools THEN Essential states remain visible;
// nonessential motion disabled/reduced." This is the exact decision +
// DOM-mutation logic BaseLayout.astro's page-load script runs, pulled out
// into a pure, importable module so it has real automated (jsdom) test
// coverage instead of being verified by reading the source only — no
// behavior change, this is the same logic BaseLayout.astro's script
// already ran inline, now called from there instead of duplicated.

/** True when entrance animations must be skipped entirely: either the
 * user's OS-level reduced-motion preference is on, or this browser has
 * no IntersectionObserver to drive the scroll-reveal at all -- in both
 * cases, gating content behind a scroll trigger would risk leaving it
 * invisible, so it is shown immediately instead. */
export function shouldSkipEntranceAnimation(
  matchMedia: (query: string) => { matches: boolean },
  hasIntersectionObserver: boolean
): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || !hasIntersectionObserver;
}

/** Marks every entrance-animated element in `root` as already-visible,
 * bypassing the scroll-triggered reveal. Used both for the reduced-motion/
 * no-IntersectionObserver case and per-element once a real scroll reveal
 * fires -- callers decide which elements to pass. */
export function markVisible(elements: Iterable<Element>): void {
  for (const el of elements) {
    el.classList.add('is-visible');
  }
}
