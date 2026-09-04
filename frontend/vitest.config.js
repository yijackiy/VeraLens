import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Separate from vite.config.js on purpose: the dev server's API proxy is
 * irrelevant here, and the tests must not inherit it.
 *
 * `environment: 'node'` by default — the palette and preference tests are pure
 * and a DOM would only slow them down. The two files that drive React opt into
 * jsdom with a docblock pragma.
 */
export default defineConfig({
  plugins: [react()],
  // Without this the .jsx screens transform with the classic runtime and every
  // one of them fails on "React is not defined" — none of them imports React,
  // because the app build uses the automatic runtime.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    css: false,
  },
})
