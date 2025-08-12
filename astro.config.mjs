// astro.config.mjs
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',                // required for Vercel adapter
  adapter: vercel({ runtime: 'edge' }),
  image: { service: { entry: 'astro/assets/services/sharp' } }
});