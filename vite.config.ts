import { defineConfig } from 'vite';

/** Relative asset URLs in `dist/` — works on Netlify apex, branch previews, and subpaths. */
export default defineConfig({
  base: './',
  server: {
    host: true,
  },
});
