// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const SITE_URL = 'https://paintingpricingcalculator.com';

export default defineConfig({
  site: SITE_URL,
  // Every real page stays statically prerendered (the marketing homepage,
  // free tools, and Pro app are unchanged). Two things opt out of
  // prerendering per-route (`export const prerender = false`): all of
  // src/pages/api/** (the Dodo Payments checkout/webhook endpoints, which
  // need a real server request -- same pattern as qrworkbench/barcodeflow)
  // and src/pages/dev/pro-harness.astro (GSC-001: its own PROD-guard 404
  // only takes effect against a real per-request server function, not a
  // build-time-only static page -- see that file's comment).
  adapter: vercel(),
  integrations: [
    // Exclude the dev-only ProApp verification harness -- it 404s in
    // production (see src/pages/dev/pro-harness.astro's own PROD guard),
    // so listing it in the sitemap would have Google crawl a URL that
    // returns nothing, wasting crawl budget and reporting a sitemap error.
    sitemap({ filter: (page) => !page.includes('/dev/') }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  // The floating dev toolbar is a dev-only overlay (never ships in
  // `astro build`), but it clutters every local/preview screenshot of this
  // marketing page. Disabling it doesn't touch HMR, type-checking, or the
  // production build.
  devToolbar: {
    enabled: false,
  },
});
