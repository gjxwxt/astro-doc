import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { file, glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema({
    extend: z.object({
      date: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
    }),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().max(300).optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    cover: z.string().optional(),
    source: z.string().optional(),
  }),
});

const library = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/library' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().max(400).optional(),
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    section: z.string().default('other'),
    sectionTitle: z.string().default('其他'),
    sectionOrder: z.number().default(999),
    kind: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourcePath: z.string().optional(),
  }),
});

const bookmarkItem = z.object({
  name: z.string().min(1),
  url: z.url(),
  description: z.string().optional(),
  featured: z.boolean().default(false),
});

const bookmarks = defineCollection({
  loader: file('./src/content/bookmarks.yaml'),
  schema: z.object({
    title: z.string(),
    order: z.number().default(99),
    items: z.array(bookmarkItem).default([]),
  }),
});

export const collections = { docs, notes, library, bookmarks };
