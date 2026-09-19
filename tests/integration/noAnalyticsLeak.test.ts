// UX-006, updated: "no personal fields, full estimate content, or license
// values sent in analytics." Google Analytics (gtag.js, measurement id
// G-SML9ZVEQ8E) is now the one analytics platform actually connected --
// loaded in src/layouts/BaseLayout.astro, production only, and every
// track() call site (src/lib/analytics.ts) still only ever sends an event
// name and small, non-identifying detail fields, the same guarantee this
// test enforced when no analytics existed at all. The bar that matters now
// is the same as before, just for real: nothing customer/project/license-
// shaped ever reaches a real third party.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const KNOWN_ANALYTICS_LIBRARIES = ['plausible-tracker', 'posthog-js', '@vercel/analytics', 'react-ga', 'react-ga4', '@amplitude/analytics-browser', 'mixpanel-browser'];
// gtag is the one deliberately-connected exception -- checked separately
// below (confined to the two audited call sites) rather than banned outright.
const OTHER_ANALYTICS_CALL_PATTERN = /\b(plausible|posthog|mixpanel|amplitude)\s*\(/i;
// Any of these appearing as an object key/identifier inside a track(...)
// call is a leak: real customer/project content or a license/payment
// value, not just an event name or a static UI label.
const FORBIDDEN_TRACK_FIELD_PATTERN = /\b(customerInfo|customerName|customerEmail|customerContact|projectTitle|notes|terms|licenseKey|paymentId|sessionId|email|address|phone)\b/;
const GA_MEASUREMENT_ID = 'G-SML9ZVEQ8E';

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.astro' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('UX-006: Google Analytics is the only analytics integration, and never receives personal/project/license data', () => {
  it('package.json does not depend on any OTHER known analytics/tracking library', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const lib of KNOWN_ANALYTICS_LIBRARIES) {
      expect(allDeps[lib], `found unexpected analytics dependency "${lib}" -- only Google Analytics (loaded directly, no npm package) is approved`).toBeUndefined();
    }
  });

  it('astro.config.mjs does not register an analytics integration', () => {
    const config = readFileSync(join(REPO_ROOT, 'astro.config.mjs'), 'utf-8');
    expect(OTHER_ANALYTICS_CALL_PATTERN.test(config)).toBe(false);
  });

  it('no source file calls a non-Google analytics tracking function (plausible/posthog/mixpanel/amplitude)', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(REPO_ROOT, 'src'))) {
      const content = readFileSync(file, 'utf-8');
      if (OTHER_ANALYTICS_CALL_PATTERN.test(content)) offenders.push(file);
    }
    expect(offenders, `non-Google analytics call(s) found in: ${offenders.join(', ')} -- UX-006 requires this data path never carry customerInfo/notes/license values, and no second analytics vendor is approved`).toEqual([]);
  });

  it('gtag is only ever called from the two audited sites -- BaseLayout.astro (the loader) and lib/analytics.ts (the track() wrapper)', () => {
    const allowed = [join('src', 'layouts', 'BaseLayout.astro'), join('src', 'lib', 'analytics.ts')];
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(REPO_ROOT, 'src'))) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (allowed.some((a) => rel.endsWith(a))) continue;
      const content = readFileSync(file, 'utf-8');
      if (/\bgtag\s*\(/.test(content)) offenders.push(file);
    }
    expect(offenders, `gtag() called outside the audited wrapper in: ${offenders.join(', ')} -- route new events through track() instead so the forbidden-field guard below actually applies`).toEqual([]);
  });

  it('BaseLayout.astro loads the real GA4 measurement id and only in production', () => {
    const layout = readFileSync(join(REPO_ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf-8');
    expect(layout).toContain(GA_MEASUREMENT_ID);
    expect(layout).toMatch(/analyticsEnabled\s*=\s*import\.meta\.env\.PROD/);
  });

  it('no track(...) call site in src/ passes a customer, project, license, or payment field', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(REPO_ROOT, 'src'))) {
      if (file.endsWith(join('lib', 'analytics.ts'))) continue; // the dispatcher's own definition, not a call site
      const content = readFileSync(file, 'utf-8');
      const calls = content.match(/\btrack\([^;]*?\)/gs) ?? [];
      for (const call of calls) {
        if (FORBIDDEN_TRACK_FIELD_PATTERN.test(call)) offenders.push(`${file}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(offenders, `forbidden field referenced in a track() call: ${offenders.join(' | ')}`).toEqual([]);
  });

  it("privacy.astro discloses Google Analytics (not an absolute \"no analytics\" claim that would now be false)", () => {
    const privacy = readFileSync(join(REPO_ROOT, 'src', 'pages', 'privacy.astro'), 'utf-8');
    expect(privacy).toMatch(/Google Analytics/);
    expect(privacy).not.toMatch(/no third-party analytics/i);
  });
});
