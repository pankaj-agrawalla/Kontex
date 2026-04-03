import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    fileParallelism: false,  // run test files sequentially — prevents beforeAll seed race conditions
  },
})
