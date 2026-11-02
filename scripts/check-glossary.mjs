import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRelations } from '../src/utils/relationGraph.mjs';
import { parseTermNames, readAllowlist } from './lib/terms.mjs';

const glossaryPath = new URL('../src/data/glossary.json', import.meta.url);
const relationsPath = new URL('../src/data/relations.json', import.meta.url);
const termsDir = new URL('../src/content/terms/', import.meta.url);
const allowlistPath = new URL(
  '../src/data/relation-ghosts.allowlist.json',
  import.meta.url
);

const validStatuses = new Set(['proposed', 'coined', 'agreed', 'abandoned']);

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string|URL} value
 * @returns {string}
 */
function toPath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

/**
 * Runs the full glossary + relations check. Returns the list of errors and
 * warnings without exiting, so the module can be imported without side
 * effects. Optional overrides make the checks testable against fixtures.
 * @param {{
 *   glossary?: Object[],
 *   relations?: Object[],
 *   glossaryPath?: string|URL,
 *   relationsPath?: string|URL,
 *   termNames?: string[],
 *   termsDir?: string|URL,
 *   allowlist?: string[],
 *   allowlistPath?: string|URL,
 * }} [options]
 * @returns {{
 *   errors: string[],
 *   warnings: Object[],
 *   glossary: Object[],
 *   relations: Object[],
 * }}
 */
export function runChecks(options = {}) {
  const errors = [];

  let glossaryData;
  if (options.glossary !== undefined) {
    glossaryData = options.glossary;
  } else {
    try {
      glossaryData = JSON.parse(
        readFileSync(options.glossaryPath ?? glossaryPath, 'utf8')
      );
    } catch (error) {
      errors.push(`glossary.json: ${formatError(error)}`);
      glossaryData = [];
    }
  }
  if (!Array.isArray(glossaryData)) {
    errors.push('glossary.json: expected an array');
    glossaryData = [];
  }

  let relationsData;
  if (options.relations !== undefined) {
    relationsData = options.relations;
  } else {
    try {
      relationsData = JSON.parse(
        readFileSync(options.relationsPath ?? relationsPath, 'utf8')
      );
    } catch (error) {
      errors.push(`relations.json: ${formatError(error)}`);
      relationsData = [];
    }
  }
  if (!Array.isArray(relationsData)) {
    errors.push('relations.json: expected an array');
    relationsData = [];
  }

  const terms = glossaryData.map((e) => e.term);
  const duplicates = terms.filter((t, i) => terms.indexOf(t) !== i);
  for (const term of new Set(duplicates)) {
    errors.push(`duplicate term in glossary.json: ${term}`);
  }

  for (const entry of glossaryData) {
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

  const termNames =
    options.termNames ??
    parseTermNames(
      toPath(options.termsDir ?? termsDir),
      ({ path, error }) => {
        errors.push(`terms: ${path}: ${formatError(error)}`);
      }
    );

  const allowlisted = new Set(
    options.allowlist ??
      readAllowlist(options.allowlistPath ?? allowlistPath, (message) =>
        errors.push(message)
      )
  );

  let warnings = [];
  try {
    const validation = validateRelations(relationsData, termNames);
    errors.push(...validation.errors);
    warnings = validation.warnings;
  } catch (error) {
    errors.push(`relations: validation failed: ${formatError(error)}`);
  }

  const filteredWarnings = warnings
    .map((warning) => {
      if (warning.type === 'unknown') {
        return {
          ...warning,
          names: warning.names.filter(
            (entry) => !allowlisted.has(entry.name)
          ),
        };
      }
      if (warning.type === 'shared-term' && allowlisted.has(warning.term)) {
        return null;
      }
      return warning;
    })
    .filter(
      (warning) =>
        warning &&
        (warning.type !== 'unknown' || warning.names.length > 0)
    );

  return {
    errors,
    warnings: filteredWarnings,
    glossary: glossaryData,
    relations: relationsData,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { errors, warnings, glossary, relations } = runChecks();

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
