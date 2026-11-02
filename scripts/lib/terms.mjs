import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import jsyaml from 'js-yaml';
import { fillTermKeys, slugifyTerm } from '../../src/data/termDefaults.js';

/**
 * Returns the YAML string between the leading `---` markers.
 * @param {string} mdContent
 * @returns {string}
 */
export function extractFrontmatter(mdContent) {
  const source = String(mdContent ?? '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : '';
}

/**
 * Parses frontmatter and returns the loaded YAML value. Throws on malformed
 * YAML; callers decide whether to surface or swallow the error.
 * @param {string} mdContent
 * @returns {unknown}
 */
function loadFrontmatter(mdContent) {
  return jsyaml.load(extractFrontmatter(mdContent));
}

/**
 * Parses a term file's frontmatter and returns its `term` value. Malformed
 * frontmatter is treated as a missing term rather than a thrown error.
 * @param {string} mdContent
 * @returns {string|undefined}
 */
export function readTerm(mdContent) {
  try {
    return loadFrontmatter(mdContent)?.term;
  } catch {
    return undefined;
  }
}

/**
 * Recursively walks `termsDir` and returns the `term` value of every
 * `*.md` file. Dotfiles and dot-directories are skipped (mirrors
 * fast-glob's `dot: false`). Malformed files are skipped and reported to
 * `onError` when provided.
 * @param {string} termsDir
 * @param {(failure: {path: string, error: unknown}) => void} [onError]
 * @returns {string[]}
 */
export function parseTermNames(termsDir, onError) {
  const names = [];
  const report = (path, error) => {
    if (typeof onError === 'function') onError({ path, error });
  };

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      report(dir, error);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const term = loadFrontmatter(readFileSync(path, 'utf8'))?.term;
          if (term) names.push(term);
        } catch (error) {
          report(path, error);
        }
      }
    }
  }

  walk(termsDir);
  return names;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads an allowlist JSON array of exact names. A missing file yields an
 * empty list without reporting. A present-but-unreadable file or invalid
 * JSON also yields an empty list but calls `onError` when provided.
 * @param {string|URL} allowlistPath
 * @param {(message: string) => void} [onError]
 * @returns {string[]}
 */
export function readAllowlist(allowlistPath, onError) {
  let raw;
  try {
    raw = readFileSync(allowlistPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    if (typeof onError === 'function') {
      onError(`allowlist: ${String(allowlistPath)}: ${formatError(error)}`);
    }
    return [];
  }

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      if (typeof onError === 'function') {
        onError(`allowlist: ${String(allowlistPath)}: expected an array`);
      }
      return [];
    }
    return data.filter((name) => typeof name === 'string');
  } catch (error) {
    if (typeof onError === 'function') {
      onError(`allowlist: ${String(allowlistPath)}: ${formatError(error)}`);
    }
    return [];
  }
}

/**
 * Renders a term markdown file with a fixed frontmatter key order.
 * @param {Object} entry
 * @returns {string}
 */
export function renderTermMarkdown(entry) {
  const filled = fillTermKeys(entry);
  const frontmatter = {
    term: filled.term,
    translation: filled.translation,
    explanation: filled.explanation,
    status: filled.status,
    source: filled.source,
    alternatives: filled.alternatives,
    derivations: filled.derivations,
  };
  return '---\n' + jsyaml.dump(frontmatter, { lineWidth: -1 }) + '---\n';
}

/**
 * Allocates a unique slug, mutating `usedSlugs` in place.
 * @param {string} term
 * @param {Set<string>} usedSlugs
 * @returns {string}
 */
export function allocateSlug(term, usedSlugs) {
  const base = slugifyTerm(term) || 'term';
  let slug = base;
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(slug);
  return slug;
}
