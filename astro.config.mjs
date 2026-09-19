// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

const SITE_URL = 'https://paintingpricingcalculator.com';

export default defineConfig({
  site: SITE_URL,
  // Every page stays statically prerendered (the marketing homepage, free
  // tools, and Pro app are unchanged). Only src/pages/api/** opts out of
  // prerendering per-route (`export const prerender = false`) for the Dodo
  // Payments checkout/webhook endpoints, which need a real server request —
  // same pattern as qrworkbench/barcodeflow, not a switch to server-rendering
  // the whole site.
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
