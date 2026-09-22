import { defineConfig } from 'astro/config';
import rehypeSlug from 'rehype-slug';
import rehypeArabicDigits from './src/utils/rehype-arabic-digits';

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeSlug, rehypeArabicDigits],
  },
});
