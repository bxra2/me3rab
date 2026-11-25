import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTermMarkdown } from './lib/terms.mjs';
import { slugifyTerm } from '../src/data/termDefaults.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const termsDir = join(repoRoot, 'src', 'content', 'terms');

const rawTerm = process.argv.slice(2).join(' ').trim();

if (!rawTerm) {
  process.stderr.write('Usage: node scripts/new-term.mjs <english term...>\n');
  process.exit(1);
}

const term = rawTerm.charAt(0).toUpperCase() + rawTerm.slice(1);
const slug = slugifyTerm(term);
const targetPath = join(termsDir, `${slug}.md`);
const relativePath = relative(repoRoot, targetPath);

if (existsSync(targetPath)) {
  process.stderr.write(`Error: ${relativePath} already exists\n`);
  process.exit(1);
}

writeFileSync(targetPath, renderTermMarkdown({ term }));
process.stdout.write(`Created ${relativePath}\n`);
