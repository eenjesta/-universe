import { defineConfig } from 'vite';

// NO_HMR=1 is used by the shared test server (tools/shot.mjs): pages are loaded
// fresh for every screenshot, so hot updates would only cause random reloads.
const noHmr = !!process.env.NO_HMR;

export default defineConfig({
  base: './',
  server: {
    // Localhost by default; use HOST=0.0.0.0 (or `npm run dev -- --host`) to expose it.
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 5173),
    strictPort: true,
    hmr: noHmr ? false : undefined,
  },
  preview: { host: process.env.HOST || '127.0.0.1', port: 4173 },
  optimizeDeps: {
    // three is plain ESM; skipping pre-bundling avoids "new dependency found,
    // reloading" interruptions when a module imports a new three/addons file.
    exclude: ['three'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
});
