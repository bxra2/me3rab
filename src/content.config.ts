import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TermStatus } from './data/statuses';

const termStatuses = Object.keys(TermStatus) as [string, ...string[]];

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    toc: z.boolean().default(false),
  }),
});

const terms = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/terms' }),
  schema: z.object({
    term: z.string(),
    translation: z.string().default(''),
    explanation: z.string().default(''),
    status: z.enum(termStatuses).default('proposed'),
    source: z.array(z.object({ name: z.string(), link: z.string() })).default([]),
    alternatives: z.array(z.object({ translation: z.string(), note: z.string().default('') })).default([]),
    derivations: z.array(z.object({ form: z.string(), gloss: z.string() })).default([]),
  }),
});

export const collections = { blog, terms };
