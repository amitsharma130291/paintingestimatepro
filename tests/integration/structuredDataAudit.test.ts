// Guards the schema.org JSON-LD added for Google's Merchant listings /
// product snippets feature (src/lib/schema.ts, wired into BaseLayout.astro,
// index.astro, and pricing.astro). Two things this project has gotten
// burned by before, re-checked here: (1) every pricing-page brief in this
// project has explicitly banned fabricated social proof -- aggregateRating/
// review must never appear since there are no real reviews; (2) the site's
// brand name has drifted across files before (Logo.astro's alt text used to
// read "Painting Pricing Calculator", with a stray space, while every other
// real reference uses "PaintingPricing Calculator") -- structured data is
// exactly the place a naming inconsistency actually matters, since Google
// cross-references the Organization name across pages.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  organizationSchema,
  websiteSchema,
  productSchema,
  faqPageSchema,
  toLdJson,
} from '../../src/lib/schema';
import { SITE_NAME as BRAND_NAME } from '../../src/lib/server/license';
import { PRICE } from '../../src/data/site';

const REPO_ROOT = join(__dirname, '..', '..');
const SITE_ORIGIN = 'https://paintingpricingcalculator.com';

describe('structured data: no fabricated social proof', () => {
  it('src/lib/schema.ts never emits aggregateRating or review as an actual object key/type (comments mentioning the ban are fine)', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'lib', 'schema.ts'), 'utf-8');
    const codeOnly = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/aggregateRating\s*:|"AggregateRating"|review\s*:|"Review"/i.test(codeOnly)).toBe(false);
  });

  it('a fully-built Product schema has no rating/review fields', () => {
    const product = productSchema(SITE_ORIGIN, {
      url: `${SITE_ORIGIN}/pricing`,
      description: 'test',
      price: '79',
      image: `${SITE_ORIGIN}/guide/overview.webp`,
    });
    expect(product).not.toHaveProperty('aggregateRating');
    expect(product).not.toHaveProperty('review');
  });
});

describe('structured data: brand and price stay consistent with the real site', () => {
  it("Organization schema's name matches the real brand name used in license emails", () => {
    expect(organizationSchema(SITE_ORIGIN).name).toBe(BRAND_NAME);
    expect(websiteSchema(SITE_ORIGIN).name).toBe(BRAND_NAME);
  });

  it("Logo.astro's alt text matches the same brand name (no stray-space typo)", () => {
    const logo = readFileSync(join(REPO_ROOT, 'src', 'components', 'Logo.astro'), 'utf-8');
    const match = logo.match(/alt="([^"]+)"/);
    expect(match?.[1]).toBe(BRAND_NAME);
  });

  it('Offer price is a bare number, never a currency-symbol string like the "$79" marketing copy', () => {
    const rawPrice = PRICE.amount.replace(/[^0-9.]/g, '');
    const product = productSchema(SITE_ORIGIN, {
      url: `${SITE_ORIGIN}/pricing`,
      description: 'test',
      price: rawPrice,
      image: `${SITE_ORIGIN}/guide/overview.webp`,
    });
    expect(product.offers.price).toMatch(/^\d+(\.\d+)?$/);
    expect(product.offers.priceCurrency).toBe('USD');
    expect(product.offers.availability).toBe('https://schema.org/InStock');
  });
});

describe('structured data: JSON-LD serialization is valid and script-safe', () => {
  it('every builder output round-trips through JSON.parse via toLdJson', () => {
    const entries = [
      organizationSchema(SITE_ORIGIN),
      websiteSchema(SITE_ORIGIN),
      productSchema(SITE_ORIGIN, {
        url: `${SITE_ORIGIN}/pricing`,
        description: 'test',
        price: '79',
        image: `${SITE_ORIGIN}/guide/overview.webp`,
      }),
      faqPageSchema([{ question: 'Q?', answer: 'A.' }]),
    ];
    for (const entry of entries) {
      expect(() => JSON.parse(toLdJson(entry))).not.toThrow();
    }
  });

  it('escapes "</script" sequences so a string value can never break out of the script tag', () => {
    const malicious = faqPageSchema([
      { question: 'Does </script><script>alert(1)</script> work?', answer: 'No.' },
    ]);
    const serialized = toLdJson(malicious);
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized).mainEntity[0].name).toContain('</script>');
  });
});

describe('structured data: pages wire real content into JSON-LD, not placeholders', () => {
  it('index.astro and pricing.astro both pass a schema prop built from src/lib/schema', () => {
    for (const page of ['index.astro', 'pricing.astro']) {
      const content = readFileSync(join(REPO_ROOT, 'src', 'pages', page), 'utf-8');
      expect(content).toMatch(/from ["']\.\.\/lib\/schema["']/);
      expect(content).toMatch(/schema=\{schema\}/);
    }
  });

  it("pricing.astro's FAQ schema is built from PricingSalesPage's shared PRICING_FAQS, not a duplicated copy", () => {
    const content = readFileSync(join(REPO_ROOT, 'src', 'pages', 'pricing.astro'), 'utf-8');
    expect(content).toMatch(/faqPageSchema\(PRICING_FAQS\)/);
  });

  it('painting-estimating-software.astro renders the same PricingSalesPage component as pricing.astro (not a separate, driftable copy) and canonicalizes to /pricing', () => {
    const content = readFileSync(join(REPO_ROOT, 'src', 'pages', 'painting-estimating-software.astro'), 'utf-8');
    expect(content).toMatch(/from ["']\.\.\/components\/PricingSalesPage\.astro["']/);
    expect(content).toMatch(/<PricingSalesPage\s*\/>/);
    expect(content).toMatch(/canonicalPath=["']\/pricing["']/);
  });

  it('painting-estimating-software is excluded from the sitemap (GSC: a sitemap should list canonical URLs, not alternates)', () => {
    const config = readFileSync(join(REPO_ROOT, 'astro.config.mjs'), 'utf-8');
    expect(config).toMatch(/painting-estimating-software/);
  });
});

describe('technical SEO hygiene: sitemap, robots.txt, and canonical URLs', () => {
  it('robots.txt exists, allows crawling, and points at the real sitemap', () => {
    const robots = readFileSync(join(REPO_ROOT, 'public', 'robots.txt'), 'utf-8');
    expect(robots).toMatch(/Allow:\s*\//);
    expect(robots).toMatch(/Sitemap:\s*https:\/\/paintingpricingcalculator\.com\/sitemap-index\.xml/);
  });

  it("astro.config.mjs excludes the dev-only /dev/ harness from the generated sitemap (it 404s in production)", () => {
    const config = readFileSync(join(REPO_ROOT, 'astro.config.mjs'), 'utf-8');
    expect(config).toMatch(/sitemap\(\{\s*filter:/);
    expect(config).toMatch(/\/dev\//);
  });

  it("BaseLayout's canonical URL strips the trailing slash Astro.url.pathname adds, matching every internal href site-wide (which never uses one)", () => {
    const layout = readFileSync(join(REPO_ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf-8');
    expect(layout).toMatch(/replace\(\/\\\/\$\/,\s*["']["']\)/);
  });
});
