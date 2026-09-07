import { defineConfig } from 'vite';

// base './' makes the built site work from any sub-path (GitHub Pages project sites).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
