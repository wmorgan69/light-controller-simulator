import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const project = mode === 'simulator' ? 'Devices.BuildingControl.Web' : 'Devices.Instrumentation.Web';
  return {
    build: {
      watch: process.env.DEV_VITE_USE_POLLING === '1'
        ? { chokidar: { usePolling: true, interval: 1000 } }
        : null,
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
