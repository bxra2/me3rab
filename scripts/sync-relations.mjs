import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeName,
  validateRelations,
} from '../src/utils/relationGraph.mjs';
import { slugifyTerm } from '../src/data/termDefaults.js';
import {
  allocateSlug,
  parseTermNames,
  readAllowlist,
  readTerm,
  renderTermMarkdown,
} from './lib/terms.mjs';

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recursively collects the stems of every `.md` file under `dir`.
 * @param {string} dir
 * @returns {Set<string>}
 */
function readExistingSlugs(dir) {
  const slugs = new Set();

  function walk(current) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        slugs.add(basename(entry.name, '.md'));
      }
    }
  }

  walk(dir);
  return slugs;
}

/**
 * Computes unresolved drift for `--strict`. Stubs written during this run
 * resolve their ghost names.
 * @param {{
 *   ghosts: string[],
 *   nearMisses: unknown[],
 *   stubsWritten: string[],
 *   skippedCollision: string[],
 *   skippedRoundTrip: string[],
 * }} result
 * @returns {number}
 */
export function computeStrictDrift(result) {
  const written = new Set(result.stubsWritten);
  const skipped = new Set([
    ...result.skippedCollision,
    ...result.skippedRoundTrip,
  ]);
  const unresolvedGhosts = result.ghosts.filter(
    (ghost) => !written.has(ghost) && !skipped.has(ghost)
  ).length;

  return (
    unresolvedGhosts +
    result.nearMisses.length +
    result.skippedCollision.length +
    result.skippedRoundTrip.length
  );
}

/**
 * @param {Parameters<typeof computeStrictDrift>[0] & {errors: string[]}} result
 * @param {boolean} strict
 * @returns {0|1}
 */
export function strictExitCode(result, strict) {
  return result.errors.length || (strict && computeStrictDrift(result) > 0)
    ? 1
    : 0;
}

/**
 * Synchronises relations.json with the term markdown files (the source of
 * truth). Reports ghosts and near-misses, and optionally writes stub term
 * files for ghosts. A near-miss is a relation name that normalizes to an
 * existing term (e.g. a quoted variant); edit distance alone is not enough
 * to suppress a stub.
 *
 * @param {Object} options
 * @param {string} options.relationsPath
 * @param {string} options.termsDir
 * @param {string} options.allowlistPath
 * @param {boolean} [options.write]
 * @param {(entry: Object) => string} [options.renderStub]
 * @param {(markdown: string) => string|undefined} [options.readStubTerm]
 * @returns {{
 *   ghosts: string[],
 *   nearMisses: {given: string, suggestions: string[]}[],
 *   stubsWritten: string[],
 *   skippedAllowlisted: string[],
 *   skippedCollision: string[],
 *   skippedRoundTrip: string[],
 *   errors: string[]
 * }}
 */
export function syncRelations({
  relationsPath,
  termsDir,
  allowlistPath,
  write = false,
  renderStub = renderTermMarkdown,
  readStubTerm = readTerm,
}) {
  const errors = [];

  let relations = [];
  try {
    const parsed = JSON.parse(readFileSync(relationsPath, 'utf8'));
    if (Array.isArray(parsed)) {
      relations = parsed;
    } else {
      errors.push('relations.json: expected an array');
    }
  } catch (error) {
    errors.push(`relations.json: ${formatError(error)}`);
  }

  const termNames = parseTermNames(termsDir, ({ path, error }) => {
    errors.push(`terms: ${path}: ${formatError(error)}`);
  });
  const termSet = new Set(termNames);
  const allowlisted = new Set(
    readAllowlist(allowlistPath, (message) => errors.push(message))
  );

  const skippedAllowlisted = [];
  const ghostSet = new Set();
  const nearMissMap = new Map();
  const seenMembers = new Set();

  for (const relation of relations) {
    if (!relation || !Array.isArray(relation.terms)) continue;
    for (const member of relation.terms) {
      if (typeof member !== 'string' || seenMembers.has(member)) continue;
      seenMembers.add(member);

      if (termSet.has(member)) continue;
      if (allowlisted.has(member)) {
        skippedAllowlisted.push(member);
        continue;
      }

      const normalized = normalizeName(member);
      const matches = [
        ...new Set(
          termNames.filter((term) => normalizeName(term) === normalized)
        ),
      ];

      if (matches.length > 0) {
        nearMissMap.set(member, matches);
      } else {
        ghostSet.add(member);
      }
    }
  }

  try {
    const validation = validateRelations(relations, termNames);
    errors.push(...validation.errors);
  } catch (error) {
    errors.push(`relations.json: validation failed: ${formatError(error)}`);
  }

  const ghosts = [...ghostSet];
  const nearMisses = [...nearMissMap].map(([given, suggestions]) => ({
    given,
    suggestions,
  }));

  const stubsWritten = [];
  const skippedCollision = [];
  const skippedRoundTrip = [];

  if (write) {
    // Pre-existing stems plus slugs claimed by stubs written in this run.
    let usedSlugs = null;
    try {
      usedSlugs = readExistingSlugs(termsDir);
    } catch (error) {
      const message = `terms: ${termsDir}: ${formatError(error)}`;
      if (!errors.includes(message)) errors.push(message);
    }

    if (usedSlugs) {
      const knownTerms = new Set(termNames);

      for (const term of ghosts) {
        // Guard: a ghost cannot be a known term by construction, but never
        // duplicate a name if the dataset changes under us.
        if (knownTerms.has(term)) continue;

        const base = slugifyTerm(term) || 'term';
        if (usedSlugs.has(base)) {
          // Either an unrelated file already exists, or another new stub in
          // this run claimed the same slug. Never silently append -2.
          skippedCollision.push(term);
          continue;
        }

        const stub = renderStub({
          term,
          translation: '',
          explanation: '',
          status: 'proposed',
          source: [],
          alternatives: [],
          derivations: [],
        });

        if (readStubTerm(stub) !== term) {
          skippedRoundTrip.push(term);
          continue;
        }

        // Allocate only after the round-trip succeeds so a skipped term does
        // not burn a slug.
        const slug = allocateSlug(term, usedSlugs);
        writeFileSync(join(termsDir, `${slug}.md`), stub, 'utf8');
        stubsWritten.push(term);
        knownTerms.add(term);
      }
    }
  }

  return {
    ghosts,
    nearMisses,
    stubsWritten,
    skippedAllowlisted,
    skippedCollision,
    skippedRoundTrip,
    errors,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const strict = args.has('--strict');

  const relationsPath = fileURLToPath(
    new URL('../src/data/relations.json', import.meta.url)
  );
  const termsDir = fileURLToPath(
    new URL('../src/content/terms/', import.meta.url)
  );
  const allowlistPath = fileURLToPath(
    new URL('../src/data/relation-ghosts.allowlist.json', import.meta.url)
  );

  const result = syncRelations({
    relationsPath,
    termsDir,
    allowlistPath,
    write,
  });

  if (result.errors.length) {
    console.error(`sync failed (${result.errors.length}):`);
    for (const error of result.errors) console.error(` - ${error}`);
  }

  const report = (label, items, format = (item) => item) => {
    if (!items.length) return;
    console.log(`${label} (${items.length}):`);
    for (const item of items) console.log(` - ${format(item)}`);
  };

  report('ghosts', result.ghosts);
  report(
    'near-misses',
    result.nearMisses,
    (nearMiss) =>
      `"${nearMiss.given}" (did you mean: ${nearMiss.suggestions.join(', ')})`
  );
  report('skipped (allowlisted)', result.skippedAllowlisted);
  report('skipped (slug collision)', result.skippedCollision);
  report('skipped (round-trip mismatch)', result.skippedRoundTrip);
  report('stubs written', result.stubsWritten);

  const exitCode = strictExitCode(result, strict);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
