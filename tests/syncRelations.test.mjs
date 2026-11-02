import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  computeStrictDrift,
  strictExitCode,
  syncRelations,
} from '../scripts/sync-relations.mjs';
import {
  readTerm,
  renderTermMarkdown,
} from '../scripts/lib/terms.mjs';
import { runChecks } from '../scripts/check-glossary.mjs';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'muarrib-sync-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Builds a throwaway fixture.
 * @param {Object} options
 * @param {Record<string, string>} [options.terms] slug → term name
 * @param {Object[]} options.relations
 * @param {string[]} [options.allowlist]
 */
function makeFixture({ terms = {}, relations, allowlist }) {
  const root = makeTempDir();
  const termsDir = join(root, 'terms');
  mkdirSync(termsDir);

  for (const [slug, term] of Object.entries(terms)) {
    writeFileSync(
      join(termsDir, `${slug}.md`),
      renderTermMarkdown({ term }),
      'utf8'
    );
  }

  const relationsPath = join(root, 'relations.json');
  writeFileSync(relationsPath, JSON.stringify(relations, null, 2), 'utf8');

  const allowlistPath = join(root, 'allowlist.json');
  if (allowlist !== undefined) {
    writeFileSync(allowlistPath, JSON.stringify(allowlist), 'utf8');
  }

  return { root, termsDir, relationsPath, allowlistPath };
}

const contrast = (terms, note = 'ملاحظة') => ({
  type: 'contrast',
  terms,
  note,
});

test('write=false: reports ghosts and normalized near-misses without writing', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing', metal: 'Metal' },
    relations: [
      contrast(['Existing', 'Ghostly']),
      contrast(['Metal', "'Metal'"]),
    ],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: false });

  assert.deepEqual(result.ghosts, ['Ghostly']);
  assert.deepEqual(result.nearMisses, [
    { given: "'Metal'", suggestions: ['Metal'] },
  ]);
  assert.deepEqual(result.stubsWritten, []);
  assert.deepEqual(result.skippedAllowlisted, []);
  assert.deepEqual(result.errors, []);

  assert.equal(existsSync(join(fixture.termsDir, 'ghostly.md')), false);
});

test('write=true: writes a stub and is idempotent on the second run', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Brand New'])],
    allowlist: [],
  });

  const first = syncRelations({ ...fixture, write: true });
  assert.deepEqual(first.stubsWritten, ['Brand New']);

  const stubPath = join(fixture.termsDir, 'brand-new.md');
  assert.ok(existsSync(stubPath));
  const stub = readFileSync(stubPath, 'utf8');
  assert.equal(readTerm(stub), 'Brand New');
  assert.match(stub, /status: proposed/);

  const second = syncRelations({ ...fixture, write: true });
  assert.deepEqual(second.ghosts, []);
  assert.deepEqual(second.stubsWritten, []);
  assert.deepEqual(second.nearMisses, []);
  assert.equal(readdirSync(fixture.termsDir).length, 2);
});

test('dedup: a ghost used by two relations yields one stub', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [
      contrast(['Existing', 'Ghostly']),
      contrast(['Ghostly', 'Existing']),
    ],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.stubsWritten, ['Ghostly']);
  assert.equal(readdirSync(fixture.termsDir).length, 2);
});

test('slug collision: never overwrites or silently adds -2', () => {
  const fixture = makeFixture({
    terms: {
      existing: 'Existing',
      'to-install': 'Something Else',
    },
    relations: [contrast(['Existing', 'To install'])],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.skippedCollision, ['To install']);
  assert.deepEqual(result.stubsWritten, []);
  assert.equal(existsSync(join(fixture.termsDir, 'to-install-2.md')), false);
  assert.equal(
    readTerm(readFileSync(join(fixture.termsDir, 'to-install.md'), 'utf8')),
    'Something Else',
    'existing file must be preserved'
  );
});

test('stub-vs-stub collision: second same-base ghost is skipped, no -2', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [
      contrast(['Existing', 'Foo Bar']),
      contrast(['Existing', 'Foo-Bar']),
    ],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.stubsWritten, ['Foo Bar']);
  assert.deepEqual(result.skippedCollision, ['Foo-Bar']);
  assert.equal(existsSync(join(fixture.termsDir, 'foo-bar-2.md')), false);
  assert.equal(
    readTerm(readFileSync(join(fixture.termsDir, 'foo-bar.md'), 'utf8')),
    'Foo Bar'
  );
  assert.equal(
    computeStrictDrift(result),
    1,
    'the skipped collision must be counted once, not also as an unresolved ghost'
  );
});

test('allowlist: allowlisted ghosts are skipped and not written', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'To install'])],
    allowlist: ['To install'],
  });

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.ghosts, []);
  assert.deepEqual(result.skippedAllowlisted, ['To install']);
  assert.deepEqual(result.stubsWritten, []);
  assert.equal(existsSync(join(fixture.termsDir, 'to-install.md')), false);
});

test('allowlist is applied before classification, even with suggestions', () => {
  const fixture = makeFixture({
    terms: { metal: 'Metal', bit: 'Bit' },
    relations: [contrast(['Metal', 'Net'])],
    allowlist: ['Net'],
  });

  const result = syncRelations({ ...fixture, write: true });
  assert.deepEqual(result.ghosts, []);
  assert.deepEqual(result.nearMisses, []);
  assert.deepEqual(result.skippedAllowlisted, ['Net']);
  assert.deepEqual(result.stubsWritten, []);
  assert.equal(existsSync(join(fixture.termsDir, 'net.md')), false);

  const check = runChecks({
    glossary: [],
    relations: [contrast(['Metal', 'Net'])],
    termNames: ['Metal', 'Bit'],
    allowlist: ['Net'],
  });
  assert.deepEqual(check.errors, []);
  assert.equal(
    check.warnings.some((warning) => warning.type === 'unknown'),
    false,
    'runChecks must silence the allowlisted name'
  );
});

test('allowlist: a missing file behaves as an empty allowlist', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Ghostly'])],
  });

  const result = syncRelations({ ...fixture, write: false });

  assert.deepEqual(result.ghosts, ['Ghostly']);
  assert.deepEqual(result.skippedAllowlisted, []);
  assert.deepEqual(result.errors, []);
});

test('structural errors from validateRelations are returned', () => {
  const fixture = makeFixture({
    terms: { a: 'A', b: 'B' },
    relations: [{ type: 'contrast', terms: ['A', 'B'] }],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: false });

  assert.ok(result.errors.some((error) => error.includes('note')));
});

test('classification: edit-distance similarity does not suppress a ghost', () => {
  const fixture = makeFixture({
    terms: { metal: 'Metal', bit: 'Bit' },
    relations: [contrast(['Metal', 'Net'])],
    allowlist: [],
  });

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.ghosts, ['Net']);
  assert.deepEqual(result.nearMisses, []);
  assert.deepEqual(result.stubsWritten, ['Net']);
  assert.ok(existsSync(join(fixture.termsDir, 'net.md')));
});

test('classification: normalized variant is a warn-only near-miss', () => {
  const fixture = makeFixture({
    terms: { mineral: 'Mineral', metal: 'Metal' },
    relations: [contrast(['Metal', "'Mineral'"])],
    allowlist: [],
  });
  const before = readFileSync(fixture.relationsPath, 'utf8');

  const result = syncRelations({ ...fixture, write: true });

  assert.deepEqual(result.ghosts, []);
  assert.deepEqual(result.nearMisses, [
    { given: "'Mineral'", suggestions: ['Mineral'] },
  ]);
  assert.deepEqual(result.stubsWritten, []);
  assert.equal(
    existsSync(join(fixture.termsDir, 'mineral-2.md')),
    false
  );
  assert.equal(readFileSync(fixture.relationsPath, 'utf8'), before);
});

test('strict exit codes: a write resolves drift for the same run', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Ghostly'])],
    allowlist: [],
  });

  const dry = syncRelations({ ...fixture, write: false });
  assert.ok(computeStrictDrift(dry) > 0);
  assert.equal(strictExitCode(dry, false), 0);
  assert.equal(strictExitCode(dry, true), 1);

  const fixed = syncRelations({ ...fixture, write: true });
  assert.deepEqual(fixed.stubsWritten, ['Ghostly']);
  assert.equal(computeStrictDrift(fixed), 0);
  assert.equal(strictExitCode(fixed, true), 0);

  const after = syncRelations({ ...fixture, write: false });
  assert.deepEqual(after.ghosts, []);
  assert.equal(strictExitCode(after, true), 0);
});

test('malformed relations.json becomes an error, not a throw', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [],
    allowlist: [],
  });
  writeFileSync(fixture.relationsPath, '{ not valid json', 'utf8');

  const result = syncRelations({ ...fixture, write: false });

  assert.ok(result.errors.some((error) => error.startsWith('relations.json:')));
  assert.deepEqual(result.ghosts, []);
});

test('malformed term frontmatter is a named per-file error', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Ghostly'])],
    allowlist: [],
  });
  const badPath = join(fixture.termsDir, 'broken.md');
  writeFileSync(badPath, '---\nterm: [unclosed\n---\n', 'utf8');

  const result = syncRelations({ ...fixture, write: false });

  assert.ok(
    result.errors.some(
      (error) => error.includes('terms:') && error.includes(badPath)
    )
  );
  assert.deepEqual(result.ghosts, ['Ghostly']);
});

test('runChecks reports malformed term frontmatter per file', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [],
    allowlist: [],
  });
  const badPath = join(fixture.termsDir, 'broken.md');
  writeFileSync(badPath, '---\nterm: [unclosed\n---\n', 'utf8');

  const check = runChecks({
    glossary: [],
    relations: [],
    termsDir: fixture.termsDir,
    allowlist: [],
  });

  assert.ok(
    check.errors.some(
      (error) => error.includes('terms:') && error.includes(badPath)
    )
  );
});

test('round-trip failure is skipped and does not burn a slug', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [
      contrast(['Existing', 'Foo Bar']),
      contrast(['Existing', 'Foo-Bar']),
    ],
    allowlist: [],
  });

  const result = syncRelations({
    ...fixture,
    write: true,
    renderStub: (entry) =>
      entry.term === 'Foo Bar'
        ? '---\nterm: Different\n---\n'
        : renderTermMarkdown(entry),
  });

  assert.deepEqual(result.skippedRoundTrip, ['Foo Bar']);
  assert.deepEqual(result.stubsWritten, ['Foo-Bar']);
  assert.equal(existsSync(join(fixture.termsDir, 'foo-bar-2.md')), false);
  assert.equal(
    readTerm(readFileSync(join(fixture.termsDir, 'foo-bar.md'), 'utf8')),
    'Foo-Bar'
  );
});

test('repo invariant: real relations are fully synced', () => {
  const result = syncRelations({
    relationsPath: fileURLToPath(
      new URL('../src/data/relations.json', import.meta.url)
    ),
    termsDir: fileURLToPath(
      new URL('../src/content/terms/', import.meta.url)
    ),
    allowlistPath: fileURLToPath(
      new URL('../src/data/relation-ghosts.allowlist.json', import.meta.url)
    ),
    write: false,
  });

  assert.equal(result.ghosts.length, 0);
  assert.equal(result.nearMisses.length, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skippedAllowlisted, [
    'To install',
    'To mount',
    'To choose',
    'To select',
  ]);
});

test('check-glossary: current repo warning counts are locked in', () => {
  const { errors, warnings } = runChecks();

  assert.deepEqual(errors, []);
  assert.equal(
    warnings.filter((warning) => warning.type === 'unknown').length,
    0
  );
  assert.equal(
    warnings.filter((warning) => warning.type === 'arabic-comma').length,
    2
  );
  assert.equal(
    warnings.filter((warning) => warning.type === 'shared-term').length,
    8
  );
});

test('missing termsDir + write returns a structured error', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Ghostly'])],
    allowlist: [],
  });
  const missingDir = join(fixture.root, 'missing-terms');

  const result = syncRelations({
    ...fixture,
    termsDir: missingDir,
    write: true,
  });

  assert.ok(
    result.errors.some(
      (error) =>
        error.startsWith('terms:') && error.includes(missingDir)
    )
  );
  assert.deepEqual(result.stubsWritten, []);
  assert.equal(existsSync(missingDir), false);
});

test('present-but-malformed allowlist is reported by both tools', () => {
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', 'Ghostly'])],
  });
  writeFileSync(fixture.allowlistPath, '{ broken json', 'utf8');

  const sync = syncRelations({ ...fixture, write: false });
  assert.ok(
    sync.errors.some(
      (error) =>
        error.includes('allowlist:') &&
        error.includes(fixture.allowlistPath)
    )
  );

  const check = runChecks({
    glossary: [],
    relations: [],
    termNames: [],
    allowlistPath: fixture.allowlistPath,
  });
  assert.ok(
    check.errors.some((error) => error.includes('allowlist:'))
  );
});

test('escaped names round-trip and stay idempotent', () => {
  const name = 'With\nNewline';
  const fixture = makeFixture({
    terms: { existing: 'Existing' },
    relations: [contrast(['Existing', name])],
    allowlist: [],
  });

  const first = syncRelations({ ...fixture, write: true });
  assert.deepEqual(first.stubsWritten, [name]);
  assert.deepEqual(first.skippedRoundTrip, []);

  const stubPath = join(fixture.termsDir, 'with-newline.md');
  assert.ok(existsSync(stubPath));
  assert.equal(readTerm(readFileSync(stubPath, 'utf8')), name);

  const second = syncRelations({ ...fixture, write: true });
  assert.deepEqual(second.ghosts, []);
  assert.deepEqual(second.stubsWritten, []);
});
