import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Tests must not depend on developer .env values (AI keys, ports, limits).
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret',
      EMBEDDING_API_KEY: '',
      LLM_API_KEY: '',
      AI_API_KEY: ''
    }
  }
})
