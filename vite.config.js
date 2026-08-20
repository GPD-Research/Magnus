import { defineConfig } from 'vite';

export default defineConfig({
  // Tauri expects a fixed port; prevent Vite from falling back to another.
  server: {
    port: 5173,
    strictPort: true,
  },
  // Allow the Tauri IPC to use the custom protocol.
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: 'dist',
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
