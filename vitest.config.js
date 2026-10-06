import { defineConfig } from 'vitest/config';

/**
 * `fileParallelism: false` because test/release.test.js shells out to
 * `scripts/release.mjs --check`, which rebuilds `dist/rb-partlist-shuttle.user.js`
 * while test/build.test.js reads that same file. The suite runs in ~1s either
 * way; removing the race is worth more than the parallelism.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
