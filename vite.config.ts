import { defineConfig } from "vite";

// Relative base so the built bundle works whether it is hosted at a domain
// root (Vercel / Netlify) or under a sub-path (GitHub Pages: /blueline/).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    // Three.js core is a shared renderer dependency (502 KB minified, 128 KB
    // gzip). The application and addons are now separate smaller chunks; keep
    // a 510 KB warning ceiling so this fixed core chunk still gets measured.
    chunkSizeWarningLimit: 510,
    rollupOptions: {
      output: {
        // Keep Three.js stable across app edits and separate its examples
        // modules (post-processing, vehicle geometry, mirrors) from the core.
        // This produces cacheable chunks instead of one oversized app bundle.
        manualChunks(id) {
          if (id.includes("/node_modules/three/examples/jsm/")) return "three-addons";
          if (id.includes("/node_modules/three/build/three.module.js")) return "three-core";
        },
      },
    },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    open: false,
  },
});
