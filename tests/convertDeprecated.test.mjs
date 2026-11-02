import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(root, 'scripts', 'convert-glossary.mjs');
const termsDir = join(root, 'src', 'content', 'terms');

/**
 * Recursively snapshots file paths, sizes, and mtimes.
 * @param {string} dir
 * @returns {string[]}
 */
function snapshot(dir) {
  const entries = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        const stat = statSync(path);
        entries.push(
          `${relative(dir, path)}:${stat.size}:${stat.mtimeMs}`
        );
      }
    }
  }

  walk(dir);
  return entries.sort();
}

test('terms:generate is deprecated and exits non-zero', () => {
  const before = snapshot(termsDir);

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /deprecated/i);
  assert.match(output, /مُهمَل/);
  assert.match(output, /sync-relations\.mjs/);

  assert.deepEqual(
    snapshot(termsDir),
    before,
    'deprecated converter must not modify src/content/terms'
  );
});

test('package.json no longer exposes the terms:generate script', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['terms:generate'], undefined);
});
