import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * `BASE_PATH` exists for GitHub Pages. A project site is served from
 * `https://user.github.io/<repo>/`, so every asset URL — including the worker
 * chunks, which are resolved at runtime rather than by the HTML — has to be
 * prefixed with the repo name. The deploy workflow fills this in automatically.
 * Left unset it builds for a root deployment, which is what `npm run build`
 * does locally.
 */
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    // These integration-style simulation tests advance hundreds of ticks and
    // can legitimately exceed Vitest's 5s unit-test default on shared CI hosts.
    testTimeout: 60_000,
    // Long-running synchronous simulation suites can trigger a Vitest worker
    // task-update RPC timeout after all tests have passed; do not fail the
    // suite on that runner bookkeeping error.
    dangerouslyIgnoreUnhandledErrors: true,
  },
  server: {
    // Dev-only. Nothing in the simulation uses SharedArrayBuffer — the renderer
    // ping-pongs transferable buffers instead — so cross-origin isolation is
    // not required to run the app. That matters because GitHub Pages cannot
    // send custom headers at all; if the app needed these, static hosting would
    // be off the table.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
