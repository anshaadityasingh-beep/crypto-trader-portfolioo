import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    globals: false,
  },
  resolve: {
    // Allow .js extension imports to resolve to .ts source files (ESM style)
    extensions: ['.ts', '.js'],
  },
});
