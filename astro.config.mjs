import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.henriquemenezzo.com',
  compressHTML: true,
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
