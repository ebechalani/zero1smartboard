import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite's default dev CORS (local origins only) plus 'null': the sandboxed review frame
// (opaque origin, docs/CLASSROOM.md §3.4) loads the simulator's module scripts with
// `Origin: null`. GitHub Pages already serves every file with Access-Control-Allow-Origin: *.
const LOCAL_ORIGIN = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// base './' makes the built site work from any sub-path (GitHub Pages project sites).
// Three pages (docs/CLASSROOM.md §4.15): the simulator, the teacher dashboard and the review page.
export default defineConfig({
  base: './',
  server: { cors: { origin: [LOCAL_ORIGIN, 'null'] } },
  preview: { cors: { origin: [LOCAL_ORIGIN, 'null'] } },
  // The Upload feature's compiler runs in a module Web Worker that imports the
  // Emscripten glue of the wasm tools from public/toolchain/ at run time.
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: { main: page('./index.html'), teacher: page('./teacher.html'), review: page('./review.html') },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
