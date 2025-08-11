import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/static'; // Astro 4 uses entry exports

export default defineConfig({
  output: 'static',
  adapter: vercel(),
});