// UX-006: "no personal fields, full estimate content, or license values
// sent in analytics." As of this writing NO analytics/tracking
// integration exists anywhere in the app (confirmed below), so there is
// currently nothing that could leak -- the requirement is vacuously
// satisfied. This is a guard, not a feature test: it locks that state in
// so the requirement is re-examined (not silently re-verified as "still
// true") the moment anyone actually adds an analytics integration.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const KNOWN_ANALYTICS_LIBRARIES = ['plausible-tracker', 'posthog-js', '@vercel/analytics', 'react-ga', 'react-ga4', '@amplitude/analytics-browser', 'mixpanel-browser'];
const ANALYTICS_CALL_PATTERN = /\b(gtag|plausible|posthog|mixpanel|amplitude)\s*\(/i;

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
});
