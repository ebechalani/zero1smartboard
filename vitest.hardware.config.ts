import { defineConfig } from 'vitest/config';

/**
 * `npm run test:hardware-sim`: the long emulator suites of the Upload feature
 * (avr8js running the real Optiboot bootloader with 32 KB images, and the
 * LCD / ultrasonic example sketches compiled by the WebAssembly toolchain
 * against our own libraries). Each test takes seconds; the normal `npm test`
 * keeps only the quick ones.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-hardware-sim/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
