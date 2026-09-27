/**
 * Integration tests against the Firebase emulators (docs/CLASSROOM.md §7.1-7.2), kept out of
 * `npm test`: run `npm run test:emulator` (firebase-tools 15 + Java 21).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-emulator/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: { VITE_CLASSROOM_EMULATOR: '1' },
  },
});
