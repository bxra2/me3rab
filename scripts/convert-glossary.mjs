import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsyaml from 'js-yaml';
import { fillTermKeys, slugifyTerm } from '../src/data/termDefaults.js';

const glossaryPath = fileURLToPath(
  new URL('../src/data/glossary.json', import.meta.url)
);
const termsDir = fileURLToPath(
  new URL('../src/content/terms/', import.meta.url)
);

const glossary = JSON.parse(readFileSync(glossaryPath, 'utf8'));

mkdirSync(termsDir, { recursive: true });

// Remove any pre-existing .md files (idempotent re-run).
for (const file of readdirSync(termsDir)) {
  if (file.endsWith('.md')) {
    unlinkSync(join(termsDir, file));
  }
}

const usedSlugs = new Set();

function uniqueSlug(term) {
  const base = slugifyTerm(term) || 'term';
  let slug = base;
  let n = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

let filesWritten = 0;

for (const entry of glossary) {
  const full = fillTermKeys(entry);
  const slug = uniqueSlug(full.term);

  const frontmatter = {
    term: full.term,
    translation: full.translation,
    explanation: full.explanation,
    status: full.status,
    source: full.source,
    alternatives: full.alternatives,
    derivations: full.derivations,
  };

  const yamlBody = jsyaml.dump(frontmatter, { lineWidth: -1 });

  const content = '---\n' + yamlBody + '---\n';

  writeFileSync(join(termsDir, `${slug}.md`), content, 'utf8');
  filesWritten += 1;
}

if (filesWritten !== glossary.length) {
  throw new Error(
    `expected ${glossary.length} files but wrote ${filesWritten}`
  );
}

console.log(`Wrote ${filesWritten} term files to ${termsDir}`);
