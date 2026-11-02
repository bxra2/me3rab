import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TermSource, TermStatus, TermMotivation, TermFormation } from './data/termStatuses';

const termStatuses = Object.keys(TermStatus) as [string, ...string[]];
const termSources = Object.keys(TermSource) as [string, ...string[]];
const termMotivations = Object.keys(TermMotivation) as [string, ...string[]];
const TermFormations = Object.keys(TermFormation) as [string, ...string[]];

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
    termSource: z.enum(termSources).default('unknown'),
    TermMotivation: z.enum(termMotivations).default('ambiguity'),
    TermFormation: z.enum(TermFormations).default('derivation'),
    source: z.array(z.object({ name: z.string(), link: z.string() })).default([]),
    alternatives: z.array(z.object({ translation: z.string(), note: z.string().default('') })).default([]),
    derivations: z.array(z.object({ form: z.string(), gloss: z.string() })).default([]),
    isComplete: z.boolean().default(false)
  }),
});

const script = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/script' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().default(0),
    toc: z.boolean().default(false),
  }),
});

export const collections = { blog, terms, script };
