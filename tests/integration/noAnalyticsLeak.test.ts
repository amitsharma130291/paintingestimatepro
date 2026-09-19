// UX-006: "no personal fields, full estimate content, or license values
// sent in analytics." No THIRD-PARTY analytics vendor is wired up (no
// script tag, no SDK dependency, confirmed below) -- src/lib/analytics.ts
// is a dormant, vendor-free event dispatcher (window.dataLayer push +
// CustomEvent) added for the /pricing sales page's conversion-event
// tracking, waiting for whatever platform eventually gets connected. It
// currently sends nothing over the network by itself. The second guard
// below re-checks the requirement now that this exists: every track()
// call site in src/ is inspected for a hardcoded list of forbidden field
// names (customer/license/payment identifiers), so a future call that
// passes one of those through would fail this test immediately.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const KNOWN_ANALYTICS_LIBRARIES = ['plausible-tracker', 'posthog-js', '@vercel/analytics', 'react-ga', 'react-ga4', '@amplitude/analytics-browser', 'mixpanel-browser'];
const ANALYTICS_CALL_PATTERN = /\b(gtag|plausible|posthog|mixpanel|amplitude)\s*\(/i;
// Any of these appearing as an object key/identifier inside a track(...)
// call is a leak: real customer/project content or a license/payment
// value, not just an event name or a static UI label.
const FORBIDDEN_TRACK_FIELD_PATTERN = /\b(customerInfo|customerName|customerEmail|customerContact|projectTitle|notes|terms|licenseKey|paymentId|sessionId|email|address|phone)\b/;

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

describe('UX-006: no analytics integration exists to leak personal fields, estimate content, or license values', () => {
  it('package.json does not depend on any known analytics/tracking library', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const lib of KNOWN_ANALYTICS_LIBRARIES) {
      expect(allDeps[lib], `found unexpected analytics dependency "${lib}" -- UX-006 needs a privacy-scrub review before this can ship`).toBeUndefined();
    }
  });

  it('astro.config.mjs does not register an analytics integration', () => {
    const config = readFileSync(join(REPO_ROOT, 'astro.config.mjs'), 'utf-8');
    expect(ANALYTICS_CALL_PATTERN.test(config)).toBe(false);
  });

  it('no source file calls a known analytics tracking function', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(join(REPO_ROOT, 'src'))) {
      const content = readFileSync(file, 'utf-8');
      if (ANALYTICS_CALL_PATTERN.test(content)) offenders.push(file);
    }
    expect(offenders, `analytics call(s) found in: ${offenders.join(', ')} -- UX-006 requires this data path never carry customerInfo/notes/license values`).toEqual([]);
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
});
