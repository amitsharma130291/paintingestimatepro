// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

// Configure the real production domain before deploying.
const SITE_URL = 'https://paintingestimatepro.com';

export default defineConfig({
  site: SITE_URL,
  // The marketing homepage stays static Astro with no framework. The free
  // tools and the Pro app are focused React islands (client:load) that use
  // the shared engine in src/engine — no server runtime/adapter, everything
  // computes and persists locally in the browser.
  integrations: [sitemap(), react()],
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
