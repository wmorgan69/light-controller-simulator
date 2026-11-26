import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'tests/**/*.component.test.jsx',
      'tests/building-control/simulator-react-model.test.mjs',
      'tests/instrumentation/instrumentation-react-telemetry.test.mjs'
    ],
    coverage: {
      provider: 'v8',
      include: ['src/*/frontend/**/*.{ts,tsx}'],
      exclude: ['src/*/frontend/main.tsx', 'src/**/*.types.ts', 'src/*/frontend/types.ts'],
      reporter: ['text', 'json-summary']
    }
  }
});
