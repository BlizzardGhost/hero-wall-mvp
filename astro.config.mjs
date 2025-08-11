import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/static'; // Astro 4 uses this entry for static

export default defineConfig({
  output: 'static',
  adapter: vercel(),
});