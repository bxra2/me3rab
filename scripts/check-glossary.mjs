import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateRelations } from '../src/utils/relationGraph.mjs';

const glossary = JSON.parse(
  readFileSync(new URL('../src/data/glossary.json', import.meta.url), 'utf8')
);
const relations = JSON.parse(
  readFileSync(new URL('../src/data/relations.json', import.meta.url), 'utf8')
);

const validStatuses = new Set(['proposed', 'coined', 'agreed', 'abandoned']);

/**
 * Parses term names from src/content/terms/*.md using a minimal
 * line-anchored parser: only `term:` at line start, value unquoted, with
 * surrounding single or double quotes stripped when present.
 * @returns {string[]}
 */
export function parseTermNames() {
  const dir = new URL('../src/content/terms/', import.meta.url);
  const names = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const content = readFileSync(new URL(file, dir), 'utf8');
    for (const line of content.split('\n')) {
      if (line.startsWith('term:')) {
        let value = line.slice('term:'.length).trim();
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        ) {
          value = value.slice(1, -1);
        }
        names.push(value);
        break;
      }
    }
  }
  return names;
}

/**
 * Runs the full glossary + relations check. Returns the list of errors and
 * warnings without exiting, so the module can be imported without side
 * effects.
 * @returns {{errors: string[], warnings: Object[]}}
 */
export function runChecks() {
  const errors = [];

  const terms = glossary.map((e) => e.term);
  const duplicates = terms.filter((t, i) => terms.indexOf(t) !== i);
  for (const term of new Set(duplicates)) {
    errors.push(`duplicate term in glossary.json: ${term}`);
  }

  for (const entry of glossary) {
    if (!entry.term) errors.push('entry with empty term');
    if (entry.status && !validStatuses.has(entry.status)) {
      errors.push(`invalid status "${entry.status}" on term "${entry.term}"`);
    }
    if (
      (entry.status === 'coined' || entry.status === 'agreed') &&
      !(entry.translation ?? entry.recommended)
    ) {
      errors.push(
        `term "${entry.term}" is ${entry.status} but has no translation`
      );
    }
  }

  const termNames = parseTermNames();
  const { errors: relErrors, warnings } = validateRelations(
    relations,
    termNames
  );
  errors.push(...relErrors);

  return { errors, warnings };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { errors, warnings } = runChecks();

  if (errors.length) {
    console.error(`check failed (${errors.length}):`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }

  if (warnings.length) {
    console.log(`check passed with ${warnings.length} warning(s):`);
    for (const w of warnings) {
      if (w.type === 'unknown') {
        const names = w.names
          .map((n) => {
            const sugg = n.suggestions.length
              ? ` (did you mean: ${n.suggestions.join(', ')})`
              : '';
            return `"${n.name}"${sugg}`;
          })
          .join(', ');
        console.log(` - relations.json[${w.relation}]: unknown term(s): ${names}`);
      } else if (w.type === 'shared-term') {
        console.log(
          ` - term "${w.term}" appears in ${w.relations.length} relations (${w.relations.join(', ')})`
        );
      } else if (w.type === 'arabic-comma') {
        console.log(
          ` - relations.json[${w.relation}]: ar value contains Arabic comma: "${w.value}"`
        );
      }
    }
  }

  console.log(
    `check passed: ${glossary.length} terms, ${relations.length} relations`
  );
}
