// v7.2 correction: v7.1's PDF-evidence logo ("green logo") was actually
// a fully transparent 32x32 RGBA image (alpha 0 everywhere) -- an image
// object existed, but nothing visible ever rendered. Counting PDF image
// objects (`page.get_images()`) does not prove a logo is visible; only a
// real pixel decode does. This file is that real pixel decode, run
// against the actual shared fixture every logo test/evidence script
// uses (tests/fixtures/logoFixture.ts) -- it fails immediately, for the
// exact fixture in use, if that mistake is ever reintroduced.
//
// Uses `sharp` (an explicit devDependency as of this correction -- it
// was already present transitively via Astro's own image pipeline at
// the exact same resolved version, 0.35.4, but a test asserting real
// pixel content must depend on it explicitly rather than rely on an
// implicit transitive resolution that could silently change).
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { loadRealLogoBytes, REAL_LOGO_WIDTH_PX, REAL_LOGO_HEIGHT_PX } from '../fixtures/logoFixture';

const MIN_SUPPORTED_DIMENSION_PX = 16; // matches src/domain/logo.ts's MIN_LOGO_DIMENSION_PX

describe('Logo fixture integrity: tests/fixtures/images/pep-logo-real.png is a real, visible logo', () => {
  it('decodes as a real PNG with the documented dimensions', async () => {
    const bytes = loadRealLogoBytes();
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(REAL_LOGO_WIDTH_PX);
    expect(meta.height).toBe(REAL_LOGO_HEIGHT_PX);
  });

  it('dimensions are at or above the minimum supported logo size in both axes', async () => {
    const bytes = loadRealLogoBytes();
    const meta = await sharp(bytes).metadata();
    expect(meta.width!).toBeGreaterThanOrEqual(MIN_SUPPORTED_DIMENSION_PX);
    expect(meta.height!).toBeGreaterThanOrEqual(MIN_SUPPORTED_DIMENSION_PX);
  });

  it('is NOT fully transparent -- has real, meaningful alpha coverage (the exact defect the v7.1 fixture had)', async () => {
    const bytes = loadRealLogoBytes();
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const totalPixels = info.width! * info.height!;
    let opaqueCount = 0;
    let maxAlpha = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > maxAlpha) maxAlpha = a;
      if (a > 200) opaqueCount++;
    }
    expect(maxAlpha).toBeGreaterThan(200); // some real opaque content exists
    // A real logo covers a meaningful fraction of its own canvas -- not
    // just a handful of stray opaque pixels. The v7.1 fixture had 0.
    expect(opaqueCount / totalPixels).toBeGreaterThan(0.05);
  });

  it('has real color variation -- not a uniform/blank single-color block', async () => {
    const bytes = loadRealLogoBytes();
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 10) continue; // ignore transparent background
      // Quantize to reduce antialiasing noise to genuinely distinct colors.
      const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
      seen.add(key);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('has zero visible (fully-opaque, non-background) pixels only if genuinely blank -- this fixture is not', async () => {
    const bytes = loadRealLogoBytes();
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visiblePixelCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 128) visiblePixelCount++;
    }
    expect(visiblePixelCount).toBeGreaterThan(1000);
  });
});

describe('Regression proof: these same checks correctly REJECT the exact v7.1 defect (a fully transparent fixture)', () => {
  async function buildFullyTransparentPng(): Promise<Buffer> {
    // Reproduces the exact v7.1 mistake: a 32x32 RGBA PNG with alpha 0
    // everywhere -- a real, valid, decodable PNG (so format-only checks
    // would wrongly call it fine), just entirely invisible.
    return sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 200, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
  }

  it('a fully transparent fixture fails the "has real alpha coverage" check', async () => {
    const bytes = await buildFullyTransparentPng();
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let maxAlpha = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > maxAlpha) maxAlpha = data[i + 3];
    expect(maxAlpha).toBe(0); // confirms the synthetic fixture reproduces v7.1's exact defect
    expect(maxAlpha).not.toBeGreaterThan(200); // the same assertion the real-fixture test above requires to PASS -- this fixture fails it, as it must
    void info;
  });

  it('a fully transparent fixture has zero visible pixels', async () => {
    const bytes = await buildFullyTransparentPng();
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visiblePixelCount = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) visiblePixelCount++;
    expect(visiblePixelCount).toBe(0); // this is the v7.1 defect, reproduced and confirmed caught
  });
});
