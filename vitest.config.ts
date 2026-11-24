import { defineConfig } from 'vitest/config'

// Tests of the money and date sums only (src/**/*.test.ts). No browser, no database: the fake keys just let the
// Supabase client be created when a calculation file imports it.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'test-key' },
  },
})
