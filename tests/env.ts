/** Entorno de pruebas. La base se elige con TEST_DATABASE_URL (por defecto, la local `nce_test`). */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://nce_admin:dev@127.0.0.1:54329/nce_test';

export function applyTestEnv() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres',
    ENCRYPTION_KEY: 'llave-de-pruebas-para-cifrado',
    APP_URL: 'http://localhost:3000',
    APP_ENV: 'development',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: `.data/test-storage/${dbName}`,
    ENABLE_SIMULATOR: 'true',
    RESEND_API_KEY: '',
    SETUP_TOKEN: '',
    CRON_SECRET: 'cron-de-pruebas',
  });
}
