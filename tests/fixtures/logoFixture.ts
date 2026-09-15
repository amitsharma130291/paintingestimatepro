// v7.2 correction: the v7.1 PDF-evidence logo fixture was a fully
// transparent 32x32 image (alpha 0 everywhere) -- an image object with
// no visible content. This module is the ONE place every logo-related
// test and evidence script gets a real, visible business logo from, so
// that mistake cannot recur silently in any individual test file.
//
// tests/fixtures/images/pep-logo-real.png is the actual approved
// "PaintingPricing Calculator" wordmark (paint-can "P" icon + wordmark,
// Evergreen/Champagne palette), supplied as the project's real brand
// asset -- not a solid square, not a placeholder, not a synthetic
// "logo-like" block. 512x130px, real PNG transparency (alpha channel
// spans the full 0-255 range), ~36% opaque coverage, 260+ distinct
// colors after quantization. See tests/domain/logoFixtureIntegrity.test.ts
// for the executable proof of those properties.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REAL_LOGO_PNG_PATH = join(__dirname, 'images', 'pep-logo-real.png');

export function loadRealLogoBytes(): Buffer {
  return readFileSync(REAL_LOGO_PNG_PATH);
}

export function loadRealLogoDataUri(): string {
  const bytes = loadRealLogoBytes();
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** The real logo's own pixel dimensions -- ASSET-CHECKS.json from the
 * approved brand kit and independently reconfirmed via sharp (see
 * tests/domain/logoFixtureIntegrity.test.ts). Exported so tests that
 * mock the browser Image-decode step (jsdom has no real decoder) can
 * report the SAME dimensions the real file actually has, rather than an
 * arbitrary made-up size. */
export const REAL_LOGO_WIDTH_PX = 512;
export const REAL_LOGO_HEIGHT_PX = 130;

/** A real File object wrapping the actual logo bytes, for jsdom
 * component tests that need a genuine File (not just a byte-count
 * placeholder like the existing pngFile() helper, which is correct for
 * byte-level format/size validation but carries no real pixel content). */
export function realLogoFile(name = 'pep-logo.png'): File {
  const bytes = new Uint8Array(loadRealLogoBytes());
  return new File([bytes], name, { type: 'image/png' });
}
