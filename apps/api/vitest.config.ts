import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several tests render real PDFs or start the whole app; the 5 s default is too tight for a
    // slow laptop or a small CI runner. A hang still fails, just later.
    testTimeout: 20_000,
  },
});
