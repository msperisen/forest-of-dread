import { defineConfig } from 'vite';

// Relative asset paths, so the build works from a subfolder
// (GitHub Pages project sites, itch.io, any static host).
export default defineConfig({
  base: './',
});
