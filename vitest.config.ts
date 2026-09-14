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
  },
});
