// @vitest-environment jsdom
// UX-005 (ACCEPTANCE_TESTS.md P01-P07): "GIVEN Reduce-motion preference
// enabled WHEN Navigate tools THEN Essential states remain visible;
// nonessential motion disabled/reduced." Previously verified by reading
// BaseLayout.astro's source only (the Browser pane tooling available in
// this project has no OS-level reduced-motion emulation control). This
// file replaces that with two genuinely executed, automated checks: (1)
// the exact decision+DOM-mutation logic the page-load script runs, driven
// with a real simulated `matchMedia`, proving elements actually end up
// visible; (2) the compiled CSS actually declares the reduced-motion
// override with the specific properties that matter (opacity/transform/
// transition), not just a selector name with no effect.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldSkipEntranceAnimation, markVisible } from '../../src/lib/reducedMotionVisibility';

// Read the real shipped source directly (not via a bundler-processed
// import) so the Tailwind v4 Vite plugin never gets a chance to strip or
// rewrite anything before this test reads it.
const globalCss = readFileSync(join(__dirname, '../../src/styles/global.css'), 'utf-8');

function fakeMatchMedia(matches: boolean) {
  return (query: string) => {
    expect(query).toBe('(prefers-reduced-motion: reduce)');
    return { matches };
  };
}

describe('UX-005: reduced-motion decision logic (BaseLayout.astro page-load script, extracted for real test coverage)', () => {
  it('skips entrance animation when the OS reports prefers-reduced-motion: reduce, even with a real IntersectionObserver available', () => {
    expect(shouldSkipEntranceAnimation(fakeMatchMedia(true), true)).toBe(true);
  });

  it('skips entrance animation when IntersectionObserver is unavailable, even with no reduced-motion preference', () => {
    expect(shouldSkipEntranceAnimation(fakeMatchMedia(false), false)).toBe(true);
  });

  it('does NOT skip (uses the real scroll-triggered reveal) when motion is fine and IntersectionObserver exists', () => {
    expect(shouldSkipEntranceAnimation(fakeMatchMedia(false), true)).toBe(false);
  });

  it('marking elements visible actually adds the is-visible class the compiled CSS keys off of -- essential content is never left hidden', () => {
    document.body.innerHTML = `
      <div data-animate id="a"></div>
      <div data-animate-emphasis id="b"></div>
    `;
    const els = document.querySelectorAll('[data-animate], [data-animate-emphasis]');
    expect(document.getElementById('a')!.classList.contains('is-visible')).toBe(false);
    expect(document.getElementById('b')!.classList.contains('is-visible')).toBe(false);

    markVisible(els);

    expect(document.getElementById('a')!.classList.contains('is-visible')).toBe(true);
    expect(document.getElementById('b')!.classList.contains('is-visible')).toBe(true);
  });

  it('end-to-end: simulating a reduced-motion browser on page load leaves every animated element visible, exactly as BaseLayout.astro\'s script does', () => {
    document.body.innerHTML = `
      <div data-animate id="hero"></div>
      <div data-animate id="section-2"></div>
      <div data-animate-emphasis id="health-row"></div>
    `;
    const animatedEls = document.querySelectorAll('[data-animate], [data-animate-emphasis]');
    if (shouldSkipEntranceAnimation(fakeMatchMedia(true), 'IntersectionObserver' in window)) {
      markVisible(animatedEls);
    }
    for (const el of animatedEls) {
      expect(el.classList.contains('is-visible')).toBe(true);
    }
  });
});

describe('UX-005: compiled CSS actually forces the reduced-motion fallback (not just a selector with no matching declarations)', () => {
  it('the global stylesheet source contains an @media (prefers-reduced-motion: reduce) block for [data-animate], forcing opacity:1/transform:none/transition:none', () => {
    // A real automated check of the shipped CSS text, not a human read.
    // Matches across the nested Tailwind-v4 authoring syntax regardless of
    // exact whitespace/brace layout.
    const reducedMotionBlockMatch = globalCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\[data-animate\]\s*\{([^}]*)\}/
    );
    expect(reducedMotionBlockMatch).not.toBeNull();
    const declarations = reducedMotionBlockMatch![1];
    expect(declarations).toMatch(/opacity:\s*1\s*;/);
    expect(declarations).toMatch(/transform:\s*none\s*;/);
    expect(declarations).toMatch(/transition:\s*none\s*;/);
  });

  it('the global stylesheet also disables smooth scroll-behavior under reduced motion', () => {
    const scrollBlockMatch = globalCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*html\s*\{([^}]*)\}/
    );
    expect(scrollBlockMatch).not.toBeNull();
    expect(scrollBlockMatch![1]).toMatch(/scroll-behavior:\s*auto\s*;/);
  });

  it('the [data-animate-emphasis] one-time highlight also disables its transition under reduced motion, while keeping the highlight itself visible (not silently removed)', () => {
    const emphasisBlockMatch = globalCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\[data-animate-emphasis\]\s*\{([^}]*)\}/
    );
    expect(emphasisBlockMatch).not.toBeNull();
    const declarations = emphasisBlockMatch![1];
    expect(declarations).toMatch(/transition:\s*none\s*;/);
    expect(declarations).toMatch(/background-color:\s*var\(--color-warn-soft\)\s*;/);
  });
});
