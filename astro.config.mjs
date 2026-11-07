import { defineConfig } from 'astro/config';
import rehypeSlug from 'rehype-slug';
import rehypeArabicDigits from './src/utils/rehype-arabic-digits';
import remarkSidenotes from './src/plugins/remark-sidenotes.mjs';

export default defineConfig({
  site: 'https://bxra2.github.io',
  base: '/me3rab',
  markdown: {
    remarkPlugins: [remarkSidenotes],
    rehypePlugins: [rehypeSlug, rehypeArabicDigits],
  },
});
