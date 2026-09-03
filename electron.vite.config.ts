import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    build: {
      // Keep the sprite sheet as a real file; a data: URI would be blocked by the page CSP.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          bubble: resolve(__dirname, 'src/renderer/bubble.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          panel: resolve(__dirname, 'src/renderer/panel.html'),
        },
      },
    },
  },
});
