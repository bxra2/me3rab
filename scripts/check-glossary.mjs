import { readFileSync } from 'node:fs';

const glossary = JSON.parse(
  readFileSync(new URL('../src/data/glossary.json', import.meta.url), 'utf8')
);
const relations = JSON.parse(
  readFileSync(new URL('../src/data/relations.json', import.meta.url), 'utf8')
);

const validStatuses = new Set(['proposed', 'coined', 'agreed', 'abandoned']);
const errors = [];

const terms = glossary.map((e) => e.term);
const duplicates = terms.filter((t, i) => terms.indexOf(t) !== i);
for (const term of new Set(duplicates)) {
  errors.push(`duplicate term in glossary.json: ${term}`);
}

const termSet = new Set(terms);

for (const entry of glossary) {
  if (!entry.term) errors.push('entry with empty term');
  if (entry.status && !validStatuses.has(entry.status)) {
    errors.push(`invalid status "${entry.status}" on term "${entry.term}"`);
  }
  if (
    (entry.status === 'coined' || entry.status === 'agreed') &&
    !entry.translation
  ) {
    errors.push(`term "${entry.term}" is ${entry.status} but has no translation`);
  }
}

relations.forEach((r, i) => {
  if (!Array.isArray(r.terms) || r.terms.length < 2) {
    errors.push(`relations.json[${i}]: needs at least two terms`);
    return;
  }
  for (const t of r.terms) {
    if (!termSet.has(t)) {
      errors.push(`relations.json[${i}]: references unknown term "${t}"`);
    }
  }
});

if (errors.length) {
  console.error(`check failed (${errors.length}):`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log(
  `check passed: ${glossary.length} terms, ${relations.length} relations`
);
