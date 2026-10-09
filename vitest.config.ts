import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    include: ['tests/{unit,db,api}/**/*.test.ts'],
    fileParallelism: false, // todas las pruebas comparten una base de datos
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
