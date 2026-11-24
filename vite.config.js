import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const project = mode === 'simulator' ? 'Devices.Simulator.Web' : 'Devices.Instrumentation.Web';
  return {
    build: {
      outDir: resolve(`src/${project}/wwwroot/dist`),
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(`src/${project}/frontend/main.tsx`),
        output: {
          entryFileNames: 'app.js',
          assetFileNames: 'app[extname]',
          inlineDynamicImports: true
        }
      }
    }
  };
});
