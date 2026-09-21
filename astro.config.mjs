import { defineConfig } from 'astro/config';
import rehypeSlug from 'rehype-slug';

export default defineConfig({
  markdown: {
    rehypePlugins: [rehypeSlug],
  },
});
