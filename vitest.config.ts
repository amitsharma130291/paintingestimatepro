import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The project's own tsconfig sets jsx:"preserve" (Astro transforms JSX
  // itself for the real site build) — Vitest needs its own real JSX
  // transform to import any .tsx component file at all, for the item-11
  // component-level test harness. Scoped entirely to this Vitest config;
  // the real Astro/Vite build is untouched.
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup/fake-indexeddb.ts'],
    // The real-browser-style harness tests (jsdom + testing-library + real
    // IndexedDB transactions via fake-indexeddb) render the full ProApp
    // component tree and occasionally exceed the 5s default under full
    // suite runs, where 40+ isolated worker environments start up at once
    // and compete for CPU -- observed as intermittent "Test timed out in
    // 5000ms" failures on an otherwise-correct, deterministic test (it
    // always passes standalone or in small groups). This is CI/environment
    // contention, not a hung test or product defect; a longer timeout is
    // the correct fix rather than papering over a real one.
    testTimeout: 15000,
  },
});
