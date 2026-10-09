import { defineConfig } from 'vitest/config';

// Pruebas del agente puente contra el simulador del lector (sin base de datos).
//   npx vitest run -c vitest.bridge.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/bridge/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
